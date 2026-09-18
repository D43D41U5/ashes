/**
 * ═══ LE CHAMP SUR LE GPU — la chaîne de passes de la GI (spec `lumiere-globale.md`, LG-R1 à LG-R4) ═══
 *
 * L'oracle (`champ-ref.ts`) calcule le champ idéal sur le CPU ; cette chaîne le calcule PAR IMAGE sur
 * le GPU, au grain (un texel = 4 px monde, LG-R2), en cinq passes Shader → texture, hors liste
 * d'affichage, rendues par `renderImmediate()` depuis l'`update` de la scène — le patron « chaîne B »
 * du spike du 2026-09-14 (`tools/__gi-spike`, T6 : exact sous SwiftShader). Elle se garde CONTRE
 * l'oracle (LG-A2 : `verifier()` relit les cibles par `readPixels` et les compare texel par texel).
 *
 * ═══ LES PASSES ═══
 *   0. les OCCLUDEURS — deux textures-canvas au DOUBLE du grain (8 sous-texels par tuile), écrites
 *      depuis `grilleDuMonde` (donc depuis `occlusionAuGrain` de la sim, LG-R11) : `gi-occ` (R = code,
 *      1 cellule, 2 bande, 3 les deux ; G = la sorte d'albédo de la bande) et `gi-alb` (l'albédo de la
 *      cellule). Au double du grain, tout est EXACT : une cellule = 2×2 sous-texels, une bande de mur
 *      (± ½ texel autour de son arête, débord d'un demi-texel) = un sous-texel de chaque côté — la
 *      marche du rayon (Amanatides–Woo, la règle du coin de la sim) traverse un seul raster ;
 *   1. DIRECT (1×) — par texel libre, pour chaque source à portée : les 16 rayons de `MOTIF_SOURCE`
 *      vers le disque de la source, `profilFeu` × la part vue × la teinte ;
 *   2. FACES (2×) — chaque texel a quatre CASES (est, ouest, sud, nord) : la face d'une cellule pleine
 *      vers sa voisine libre la plus éclairée, et la face d'une bande vers le texel éclairé d'en face,
 *      × leur albédo (LG-R4 « faces ») ;
 *   2b. le DRAPEAU (1×) — un texel a-t-il une face ? (pour que le rebond saute les cases vides) ;
 *   3. REBOND (1×) — par texel libre, la somme Lambert des faces à portée qu'il voit (LG-R4 « rebond ») ;
 *   4. SOMME (1×) — direct + rebond sous le genou, et une cellule pleine lit sa face éclairée : c'est
 *      `gi-champ`, la texture que la composition lira (LG-R5, tranche C).
 *
 * ═══ LE REPÈRE ═══
 * Les shaders travaillent en coordonnées de GRILLE (i vers l'est, j vers le SUD, comme l'oracle et la
 * sim) et ne convertissent qu'au bord : `gl_FragCoord.y` compte depuis le BAS du framebuffer, donc la
 * rangée j s'écrit en `gh − 1 − j` — et une cible rendue-vers-texture, dessinée telle quelle dans la
 * liste d'affichage, sort À L'ENDROIT (spike, T1d). Les textures-canvas, elles, se lisent rangée 0 en
 * haut : deux lecteurs, `occ2`/`alb2` (canvas) et `rt(…)` (cible).
 *
 * ⚠ `antialias: true` met toute cible en LINEAR : chaque cible prend `setFilter(NEAREST)` à sa création,
 * et les canvas le REPRENNENT après chaque `refresh()` (mémoire « refresh() remet LINEAR », LG-R2).
 * ⚠ Un uniforme TABLEAU s'adresse « nom[0] » (Phaser 4.2 ignore l'autre nom en silence) : on pousse
 * les deux noms, comme `water-layer.ts`.
 */
import Phaser from 'phaser'
import { LUMIERE, MOTIF_SOURCE, type MondeEclaire } from '@ashes/sim'
import { TILE_PX } from '../framing'
import { HOLE_ERASE_PEAK } from '../lighting'
import { champRef, composerM, masqueDAstre, ombreDesCartes, ombrePleineDAstre, type Astre, type CarteDOmbre, type CartesDOmbre, type Emetteur, type GrilleGi } from './champ-ref'
import { grilleDuMonde, type Fenetre } from './grille'
import { ALBEDO, GI, longueurDOmbre, profilFeu, type Albedo } from './reglages'
import { Silhouettes } from './silhouettes'

/** Une source vue par le champ : en px MONDE, la portée en tuiles, la force (le battement, l'agonie). */
export interface SourceGi {
  readonly worldX: number
  readonly worldY: number
  readonly radiusTiles: number
  readonly force: number
}

/**
 * UNE CARTE D'OMBRE TELLE QUE LA VUE LA POSE (LG-R8 : le fût ou la cime d'un arbre, « debout sur son
 * pied ») — la clé de la texture du sprite et sa pose EXACTE, en px MONDE : position, origine, rotation
 * du vent, étirement, miroir, et le pied autour duquel la projection tourne. `snapshot-view` les
 * relève sur les sprites qu'il vient de poser ; la GI les convertit en px de grille (`CarteDOmbre`).
 */
export interface CarteMonde {
  readonly cle: string
  readonly x: number
  readonly y: number
  readonly originX: number
  readonly originY: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
  readonly flipX: boolean
  readonly flipY: boolean
  readonly piedX: number
  readonly piedY: number
}

/** Ce que `verifier()` rend : l'écart entre une cible relue et l'oracle, en NIVEAUX (sur 255). */
export interface EcartCible {
  /** Le nombre de texels comparés (les libres, à portée d'une source). */
  readonly n: number
  /** La moyenne des écarts absolus, sur les texels et les canaux. */
  readonly moyenne: number
  /** La part des texels dont un canal s'écarte de plus de 3 niveaux. */
  readonly partSup3: number
  /** Le plus grand écart. */
  readonly max: number
  /** Le nombre de texels que l'oracle éclaire (la prémisse : la scène a de la lumière). */
  readonly eclaires: number
}

export interface VerdictGi {
  readonly fenetre: Fenetre
  readonly gw: number
  readonly gh: number
  readonly sources: number
  readonly bandes: number
  /** Les cartes d'arbres dessinées (LG-R8) — la prémisse de la garde du masque sur les arbres. */
  readonly cartes: number
  readonly direct: EcartCible
  readonly champ: EcartCible
  /**
   * LE MASQUE D'ASTRE (LG-R8), relu dans l'ALPHA de `gi-direct`, contre `masqueDAstre`.
   *
   * ⚠ IL SE JUGE À PART, ET C'EST STRUCTUREL. La garde LG-A2 tourne à `uMn = 0`, où la composition
   * est neutre — c'est ce qui la garde comparable au champ d'avant. Mais S n'entre QUE par `uMn`
   * (`uMn × (1 − a × S)`) : à `uMn = 0`, l'ombre d'astre est invisible dans `gi-champ`, et un A/B
   * qui l'y chercherait comparerait deux images tout à zéro. `eclaires` compte ici les texels que
   * l'oracle met à l'ombre : c'est la PRÉMISSE, une garde à zéro ombre n'a rien éprouvé.
   */
  readonly masque: EcartCible
  /**
   * LA COMPOSITION (LG-R5, LG-R8) : `gi-champ` contre `composerM`, soit Mn × (1 − a·S) comblé par la
   * lumière. C'est la SEULE des trois cibles qui éprouve la force `a` et la PÉNOMBRE — le masque ne
   * relit que l'ombre pleine, sans force ni bord doux, et la moyenne du champ ne les verrait pas
   * (485 texels sur 34 952 valent un demi-niveau, moins que l'écart entre deux images). `eclaires`
   * compte les texels que l'astre touche, pénombre comprise : c'est la prémisse.
   */
  readonly compose: EcartCible
  /** La pureté (LG-A3) de la cible relue : 100 % des octets sont ceux d'un texel (toujours, en RTT). */
  readonly purete: number
}

const PX_PAR_TEXEL = TILE_PX / LUMIERE.TEXELS_PAR_TUILE

/**
 * LE PLAFOND DU COMPILATEUR pour la marche d'ombre d'astre — GLSL ES 1.0 exige une borne de boucle
 * CONSTANTE, alors que le vrai nombre de pas arrive en uniforme (`uPasOmbre`, taillé sur l'astre du
 * moment). Celui-ci doit donc couvrir le PLUS GRAND lanceur de la spec, pas celui qu'on éprouve.
 *
 * ⚠ C'EST UNE TRONCATURE SILENCIEUSE QU'ON ÉVITE, PAS UNE ERREUR. Un mur (32 px) demande 16 pas ;
 * un arbre (96 px, LG-R9) en demande 44. Une borne écrite à la main sur le mur ne lèverait rien :
 * elle rendrait l'ombre des arbres COURTE, et la garde resterait verte puisque l'oracle et le GPU
 * s'accorderaient sur les texels atteints. La borne se DÉRIVE donc, et suit la spec toute seule.
 *
 * Le facteur reprend `update()` au pire cas : dérive ±1, donc |dx| = cisaillement × ℓ, et la marche
 * court sur le réseau 2× — d'où 2 × (1 + cisaillement) × ℓ, plus les 2 pas de garde.
 */
const PAS_OMBRE_MAX =
  Math.ceil(2 * (1 + GI.ASTRE.CISAILLEMENT) * longueurDOmbre(GI.ASTRE.HAUTEUR_MAX_LANCEUR_PX, PX_PAR_TEXEL)) + 2
/**
 * LE RANG DE LA SOMME EST NOMMÉ — il ne se déduit PAS de la longueur de la chaîne.
 *
 * `gi-champ` naît de la passe 5. Les deux suivantes (`gi-lumiere`, `gi-face-directe`) servent la
 * passe des CORPS (LG-R7) et ne nourrissent personne en amont. Le quad du regard doit donc se
 * montrer dès que la SOMME a tourné.
 *
 * ⚠ C'était écrit `n >= PASSES_GI` — juste tant que les deux nombres étaient égaux, et devenu faux
 * à la seconde où la chaîne s'allonge : une sonde qui demande 5 passes aurait gardé le quad
 * INVISIBLE, sans erreur ni message. Le genre de régression qu'on impute ensuite au shader.
 */
const PASSE_SOMME = 5
/** Le nombre de passes de la chaîne entière : direct, faces, drapeau, rebond, somme, lumière, face
 *  directe. `debugGi` en porte le compte — le panneau bascule entre 0 et tout, une sonde peut
 *  s'arrêter avant. */
export const PASSES_GI = 7
const CODE_CELLULE = 1
const CODE_BANDE = 2
const NEAREST = Phaser.Textures.FilterMode.NEAREST

const ENTETE = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 outTexCoord;
uniform vec2 uTaille;
`

/** Les lecteurs communs : le raster 2×, une cible, la marche. */
const COMMUN = `
uniform sampler2D uOcc;
// La borne de marche, en pas du raster 2×, taillée à l'appelant : un rayon direct ne va pas plus
// loin que le rayon de sa source, un rayon de rebond pas plus loin que GI.PORTEE_REBOND. La borne
// littérale de la boucle reste constante (GLSL ES 1.0 l'exige) ; c'est la sortie qui se règle.
uniform float uPasMax;
// LE RASTER 2×, RANGÉE 0 EN BAS — comme les cibles, et non l'inverse. \`ecrireOccludeurs\` remplit
// l'ImageData rangée 0 en haut, mais l'upload la retourne : une lecture non retournée voit le
// monde à l'envers. MESURÉ le 17/09 sur un monde à un seul occludeur — une tache posée rangée 92
// portait son ombre depuis la rangée 67, et la même tache rangée 74 depuis la 85, soit gh-1-j à
// chaque fois (l'ombre de la GI marchait ainsi sur le miroir du monde : LG-A2 à 19,1 niveaux).
// TOUTE lecture de \`uOcc\`/\`uAlb\` passe par ici — en rater une remet l'albédo à l'envers.
vec2 uvRaster(vec2 c) {
  vec2 T2 = 2.0 * uTaille;
  return (vec2(c.x, T2.y - 1.0 - c.y) + 0.5) / T2;
}
float code2(vec2 c) {
  if (c.x < 0.0 || c.y < 0.0 || c.x >= 2.0 * uTaille.x || c.y >= 2.0 * uTaille.y) return 0.0;
  return floor(texture2D(uOcc, uvRaster(c)).r * 255.0 / 40.0 + 0.5);
}
bool plein1(vec2 t) {
  vec2 b = 2.0 * t;
  return code2(b) > 0.0 && code2(b + vec2(1.0, 0.0)) > 0.0 && code2(b + vec2(0.0, 1.0)) > 0.0 && code2(b + vec2(1.0, 1.0)) > 0.0;
}
bool dansCadre(vec2 t) { return t.x >= 0.0 && t.y >= 0.0 && t.x < uTaille.x && t.y < uTaille.y; }
vec2 uvCible(vec2 t) { return (vec2(t.x, uTaille.y - 1.0 - t.y) + 0.5) / uTaille; }
vec2 dirDe(int k) { return k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0); }
// Le segment p → q (coordonnées continues de grille) entre-t-il dans un occludeur ? La règle de
// segmentBloque (sim) sur le raster 2× : départ et arrivée exclus, une cellule n'est visitée que si
// le segment y entre avant sa fin, à égalité on avance en y d'abord.
bool bloque(vec2 p, vec2 q) {
  // L'EXTRÉMITÉ S'ÉPARGNE AU TEXEL, PAS AU SOUS-TEXEL. La fonction traverse de l'oracle n'inspecte
  // jamais le texel de départ ni celui d'arrivée, et ce sont des texels ENTIERS ; le raster 2×
  // n'en épargnerait qu'un quart et bloquerait sur les trois autres, que l'oracle laisse passer.
  // Éprouvé en Node sur 130 864 segments (tools/__gi-traversee.mts) : 559 désaccords avec la règle
  // au sous-texel, ZÉRO avec celle-ci. On garde le raster 2× pour les bandes, qui y tombent juste.
  vec2 s1 = floor(p);
  vec2 e1 = floor(q);
  if (s1 == e1) return false;
  vec2 P = 2.0 * p;
  vec2 Q = 2.0 * q;
  vec2 c = floor(P);
  vec2 d = Q - P;
  vec2 s = vec2(d.x > 0.0 ? 1.0 : -1.0, d.y > 0.0 ? 1.0 : -1.0);
  float INF = 1.0e30;
  vec2 td = vec2(d.x != 0.0 ? abs(1.0 / d.x) : INF, d.y != 0.0 ? abs(1.0 / d.y) : INF);
  float tx = d.x != 0.0 ? (d.x > 0.0 ? c.x + 1.0 - P.x : P.x - c.x) * td.x : INF;
  float ty = d.y != 0.0 ? (d.y > 0.0 ? c.y + 1.0 - P.y : P.y - c.y) * td.y : INF;
  for (int n = 0; n < 192; n++) {
    if (float(n) >= uPasMax) return false;
    if (tx < ty) {
      if (tx >= 1.0) return false;
      c.x += s.x;
      tx += td.x;
    } else {
      if (ty >= 1.0) return false;
      c.y += s.y;
      ty += td.y;
    }
    vec2 c1 = floor(c * 0.5);
    if (c1 == e1) return false;
    if (c1 == s1) continue;
    if (code2(c) > 0.0) return true;
  }
  return false;
}
`

const FRAG_DIRECT = `
uniform vec4 uSrc[${GI.MAX_SOURCES}];
uniform float uNb;
uniform vec3 uTeinte;
uniform vec2 uMotif[16];
uniform float uTailleSource;
uniform float uPic;
// Le vecteur d'ombre, EN TEXELS : (cisaillement × ℓ × dérive, ℓ). Nul quand aucun astre ne porte.
uniform vec2 uOmbre;
uniform float uPasOmbre;
// Les cartes projetées des arbres (\`gi-arbres\`, LG-R8) : alpha 1 sous une silhouette, 0 ailleurs.
uniform sampler2D uArbres;
// ═══ LE RAYON D'OMBRE (LG-R8) ═══
// Un mur occupe TOUTE hauteur de 0 à H : son ombre est sa bande BALAYÉE par le vecteur d'ombre, une
// somme de Minkowski et non une trace. On rétro-projette donc depuis le centre du texel et l'on
// demande si le segment p → p - uOmbre entre dans une bande — mot pour mot le \`coupeBande\` de
// l'oracle, lu sur le raster 2× où une bande tombe juste. Trois choses en tombent gratuitement :
// l'ombre se compte depuis la FACE (LG-R10), les deux orientations marchent, et rien ne va au nord.
//
// ⚠ CE N'EST PAS \`bloque\`, ET ÇA NE PEUT PAS L'ÊTRE — pour trois raisons, chacune suffisante :
//   · il ÉPARGNE le texel de départ, or la bande occupe une sous-rangée de ce texel-là et c'est de
//     là que part la première rangée d'ombre ;
//   · il teste TOUT occludeur (\`code2 > 0\`), or un bloc n'est pas lanceur (LG-R15) : seules les
//     bandes le sont, soit \`code2 >= 2\` (2 = bande, 3 = bande sur cellule, cf. l. 829) ;
//   · sa borne \`uPasMax\` est taillée sur la plus GRANDE source du cadre — 192 pas. Ce rayon-ci
//     mesure ℓ = 3,2 texels et n'en veut jamais plus de seize.
float ombreDAstre(vec2 t) {
  if (uOmbre.y <= 0.0) return 0.0;
  // LES CARTES (LG-R8) : les arbres, projetés dans \`gi-arbres\` sous la même loi — rastérisés par
  // l'oracle et téléversés (\`ecrireLesCartes\`). Un texel couvert par une carte est à l'ombre pleine,
  // l'union avec l'ombre des bandes.
  if (texture2D(uArbres, uvCible(t)).a >= 0.5) return 1.0;
  vec2 P = 2.0 * (t + 0.5);
  vec2 D = -2.0 * uOmbre;
  // ⚠ P TOMBE TOUJOURS SUR UN COIN DU RÉSEAU 2× — P = 2t + 1, entier sur les deux axes. \`floor\` y
  // prendrait le sous-texel du côté +x, +y, celui dont le rayon SORT ; il faut celui dans lequel il
  // ENTRE, donné par le signe de D. Sans cela le texel qui porte la moitié haute d'une bande se met
  // lui-même à l'ombre, alors que son centre est EXACTEMENT sur le bord et que \`coupeBande\` l'exclut
  // (intervalles ouverts, LG-R10) : c'est « l'ombre se compte depuis la face », au sous-texel.
  vec2 c = vec2(D.x > 0.0 ? P.x : P.x - 1.0, D.y > 0.0 ? P.y : P.y - 1.0);
  // Le sous-texel de DÉPART compte — \`coupeBande\` part de t0 = 0. Sur un axe où D est NUL le rayon
  // longe la frontière : le point n'est strictement dans la bande que si les DEUX sous-texels qui
  // se touchent là le sont, ce qui est mot pour mot la branche \`dx === 0\` de l'oracle.
  if (code2(c) >= 2.0
      && (D.x != 0.0 || code2(c + vec2(1.0, 0.0)) >= 2.0)
      && (D.y != 0.0 || code2(c + vec2(0.0, 1.0)) >= 2.0)) return 1.0;
  vec2 s = vec2(D.x > 0.0 ? 1.0 : -1.0, D.y > 0.0 ? 1.0 : -1.0);
  float INF = 1.0e30;
  vec2 td = vec2(D.x != 0.0 ? abs(1.0 / D.x) : INF, D.y != 0.0 ? abs(1.0 / D.y) : INF);
  float tx = D.x != 0.0 ? (D.x > 0.0 ? c.x + 1.0 - P.x : P.x - c.x) * td.x : INF;
  float ty = D.y != 0.0 ? (D.y > 0.0 ? c.y + 1.0 - P.y : P.y - c.y) * td.y : INF;
  for (int n = 0; n < ${PAS_OMBRE_MAX}; n++) {
    if (float(n) >= uPasOmbre) break;
    if (tx < ty) {
      if (tx >= 1.0) break;
      c.x += s.x;
      tx += td.x;
    } else {
      if (ty >= 1.0) break;
      c.y += s.y;
      ty += td.y;
    }
    if (code2(c) >= 2.0) return 1.0;
  }
  return 0.0;
}
float profil(float t) {
  float s = 1.0 - clamp(t, 0.0, 1.0);
  return s * s * (3.0 - 2.0 * s);
}
void main() {
  vec2 fb = floor(gl_FragCoord.xy);
  vec2 t = vec2(fb.x, uTaille.y - 1.0 - fb.y);
  // L'ALPHA PORTE L'OMBRE PLEINE DE L'ASTRE — canal libre, ses deux lecteurs ne prennent que .rgb.
  // Un occludeur y met ZÉRO et non un : il ne prend aucune ombre d'astre (LG-R8), et la passe somme
  // dilate la pénombre en LISANT cet alpha — un 1 ici la ferait fuir à travers les blocs.
  if (plein1(t)) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }
  vec2 p = t + 0.5;
  vec3 acc = vec3(0.0);
  for (int k = 0; k < ${GI.MAX_SOURCES}; k++) {
    if (float(k) >= uNb) break;
    vec4 s = uSrc[k];
    float f = uPic * profil(distance(p, s.xy) / s.z) * s.w;
    if (f <= 0.0) continue;
    float vus = 0.0;
    for (int m = 0; m < 16; m++) {
      if (!bloque(p, s.xy + uMotif[m] * uTailleSource)) vus += 1.0;
    }
    if (vus <= 0.0) continue;
    acc += uTeinte * (f * vus / 16.0);
  }
  gl_FragColor = vec4(min(acc, vec3(1.0)), ombreDAstre(t));
}`

const FRAG_FACES = `
uniform sampler2D uAlb;
uniform sampler2D uDirect;
uniform vec3 uAlbBande[${GI.MAX_ALBEDOS_BANDE}];
vec3 direct1(vec2 t) {
  if (!dansCadre(t)) return vec3(0.0);
  return texture2D(uDirect, uvCible(t)).rgb;
}
vec3 albBande(vec2 c) {
  int i = int(floor(texture2D(uOcc, uvRaster(c)).g * 255.0 / 32.0 + 0.5));
  for (int k = 0; k < ${GI.MAX_ALBEDOS_BANDE}; k++) if (k == i) return uAlbBande[k];
  return uAlbBande[0];
}
void main() {
  vec2 fb = floor(gl_FragCoord.xy);
  vec2 c2 = vec2(fb.x, 2.0 * uTaille.y - 1.0 - fb.y);
  vec2 X = floor(c2 / 2.0);
  vec2 sub = c2 - 2.0 * X;
  int k = int(sub.x + 2.0 * sub.y + 0.5);
  vec2 dir = dirDe(k);
  vec3 em = vec3(0.0);
  // 1. La cellule pleine : sa face regarde sa voisine libre la plus éclairée (est, ouest, sud, nord ;
  //    la première au max l'emporte), et renvoie le max par canal de ses voisines libres.
  if (plein1(X)) {
    vec3 mx = vec3(0.0);
    float best = -1.0;
    int arg = -1;
    for (int n = 0; n < 4; n++) {
      vec2 N = X + dirDe(n);
      if (!dansCadre(N) || plein1(N)) continue;
      vec3 dl = direct1(N);
      mx = max(mx, dl);
      float sm = dl.r + dl.g + dl.b;
      if (sm > best) { best = sm; arg = n; }
    }
    if (mx.r + mx.g + mx.b > 1.0e-4 && arg == k) em += mx * texture2D(uAlb, uvRaster(2.0 * X)).rgb;
  }
  // 2. Une bande sur l'arête entre X et sa voisine k (les deux sous-texels de X de ce côté sont de
  //    bande — un débord n'en marque qu'un) : la face renvoie la lumière du texel libre d'en face.
  vec2 N = X + dir;
  if (dansCadre(N) && !plein1(N)) {
    vec2 a = 2.0 * X + (k == 0 ? vec2(1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, 0.0));
    vec2 b = a + (k <= 1 ? vec2(0.0, 1.0) : vec2(1.0, 0.0));
    if (code2(a) >= 2.0 && code2(b) >= 2.0) {
      vec3 dl = direct1(N);
      if (dl.r + dl.g + dl.b > 1.0e-4) em += dl * albBande(a);
    }
  }
  gl_FragColor = vec4(min(em, vec3(1.0)), (em.r + em.g + em.b) > 0.0 ? 1.0 : 0.0);
}`

/**
 * LE DRAPEAU — DEUX CANAUX, DEUX LOIS SANS RAPPORT, UNE SEULE PASSE.
 *
 * `.r` — ce texel a-t-il une face qui ÉMET ? C'est le crible du rebond : `gi-rebond` saute les
 * texels éteints au lieu de lire leurs quatre faces (il ne lit que `.r`, et rien d'autre).
 *
 * `.g` — L'OMBRE D'ASTRE ÉTENDUE (LG-R8), l'ombre pleine PLUS ses deux texels de pénombre.
 * Elle vivait dans `gi-somme`, qui la RECALCULAIT : une trentaine de lectures de texture par
 * texel, à chaque image, pour un résultat que rien ne faisait varier entre les deux passes —
 * `gi-direct` (sa seule entrée) est écrit à la passe 1, le drapeau est la passe 3, la somme la
 * passe 5. Ici, c'est une lecture. Et elle devient RELISIBLE, ce que la pénombre n'était pas.
 *
 * Pourquoi ce canal-ci : l'alpha reste à 1 (un `gi-champ` translucide changerait son quad
 * MULTIPLY), `.r` est pris par le crible, et `.b` ne sert à personne.
 */
const FRAG_DRAPEAU = `
uniform sampler2D uFaces;
uniform sampler2D uDirect;
uniform vec2 uPen;
float ombreLue(vec2 t) { return dansCadre(t) ? texture2D(uDirect, uvCible(t)).a : 0.0; }
// Les cinq sauts de la pénombre : jx ∈ [-1, 1], jy ∈ [0, 1], moins le centre — la MOITIÉ SUD du
// voisinage de Tchebychev. C'est cette demi-couronne, et elle seule, qui interdit à l'ombre de
// remonter vers le nord (LG-R8).
vec2 sautOmbre(int k) {
  return k == 0 ? vec2(-1.0, 0.0) : k == 1 ? vec2(1.0, 0.0) : k == 2 ? vec2(-1.0, 1.0) : k == 3 ? vec2(0.0, 1.0) : vec2(1.0, 1.0);
}
// ═══ LA PÉNOMBRE, DEHORS (LG-R8) ═══
// Deux fronts de Tchebychev à travers le SOL LIBRE : une dilatation se LIT et ne se marche pas,
// 5 puis 25 lectures au lieu de quinze rayons. Un texel est à ⅔ s'il touche l'ombre pleine ; à ⅓
// s'il touche un texel à ⅔ — et ce texel intermédiaire doit être LIBRE, sinon la pénombre
// traverserait un bloc, ce que l'oracle refuse.
float ombreEtendue(vec2 t) {
  if (ombreLue(t) >= 1.0) return 1.0;
  for (int i = 0; i < 5; i++) if (ombreLue(t - sautOmbre(i)) >= 1.0) return uPen.x;
  for (int i = 0; i < 5; i++) {
    vec2 n = t - sautOmbre(i);
    if (!dansCadre(n) || plein1(n) || ombreLue(n) >= 1.0) continue;
    for (int j = 0; j < 5; j++) if (ombreLue(n - sautOmbre(j)) >= 1.0) return uPen.y;
  }
  return 0.0;
}
void main() {
  vec2 fb = floor(gl_FragCoord.xy);
  vec2 t = vec2(fb.x, uTaille.y - 1.0 - fb.y);
  vec2 b = 2.0 * t;
  vec2 T2 = 2.0 * uTaille;
  float a = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 c = b + vec2(k == 1 || k == 3 ? 1.0 : 0.0, k >= 2 ? 1.0 : 0.0);
    a = max(a, texture2D(uFaces, (vec2(c.x, T2.y - 1.0 - c.y) + 0.5) / T2).a);
  }
  gl_FragColor = vec4(a, ombreEtendue(t), 0.0, 1.0);
}`

const FRAG_REBOND = `
uniform sampler2D uFaces;
uniform sampler2D uDrapeau;
uniform float uGain;
uniform float uPortee;
uniform float uNb;
vec3 face(vec2 X, int k) {
  vec2 T2 = 2.0 * uTaille;
  vec2 c = 2.0 * X + vec2(k == 1 || k == 3 ? 1.0 : 0.0, k >= 2 ? 1.0 : 0.0);
  return texture2D(uFaces, (vec2(c.x, T2.y - 1.0 - c.y) + 0.5) / T2).rgb;
}
void main() {
  vec2 fb = floor(gl_FragCoord.xy);
  vec2 t = vec2(fb.x, uTaille.y - 1.0 - fb.y);
  if (plein1(t)) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 p = t + 0.5;
  vec3 acc = vec3(0.0);
  // Sans lumière directe il n'y a rien à faire rebondir : \`direct\` est noir, donc les faces
  // n'émettent rien, donc le drapeau est nul partout. La sortie ne change AUCUN pixel — ce n'est
  // pas une approximation — et elle épargne les 625 lectures par texel du nid ci-dessous : 429 ms
  // des 629 ms de la chaîne, mesurés le 17/09 à 224 × 160, une source.
  if (uNb <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  for (int dy = -${GI.PORTEE_REBOND}; dy <= ${GI.PORTEE_REBOND}; dy++) {
    for (int dx = -${GI.PORTEE_REBOND}; dx <= ${GI.PORTEE_REBOND}; dx++) {
      vec2 X = t + vec2(float(dx), float(dy));
      if (!dansCadre(X)) continue;
      if (texture2D(uDrapeau, uvCible(X)).r <= 0.0) continue;
      vec2 f = X + 0.5;
      vec2 dv = p - f;
      float d = length(dv);
      if (d < 1.0e-6 || d > uPortee) continue;
      for (int k = 0; k < 4; k++) {
        vec3 e = face(X, k);
        if (e.r + e.g + e.b <= 0.0) continue;
        vec2 n = dirDe(k);
        float cs = dot(dv, n) / d;
        if (cs <= 0.0) continue;
        if (bloque(p, f + n)) continue;
        acc += e * (uGain * cs * (1.0 - d / uPortee) / (1.0 + d));
      }
    }
  }
  gl_FragColor = vec4(min(acc, vec3(1.0)), 1.0);
}`

/**
 * ═══ LA FACE ÉCLAIRÉE — UNE LOI, UN TEXTE, TROIS PASSES ═══
 *
 * *« Une cellule opaque reçoit la lumière de sa face éclairée »* (`champ-ref.ts:158`). Trois passes
 * en ont besoin — `gi-somme`, `gi-lumiere`, `gi-face-directe` — et GLSL ES 1.0 n'a pas de pointeur
 * de fonction : le texte s'INSTANCIE deux fois depuis cette source unique, au lieu d'être recopié.
 * C'est la raison même pour laquelle la route à deux cibles a été préférée à la relecture des
 * quatre textures depuis la passe des corps ; la dupliquer ici dépenserait la pièce deux fois.
 *
 * ⚠ **C'EST UN MAX PAR CANAL, PAS UNE ÉLECTION DE VOISIN** — et je l'avais craint à l'envers.
 * `recu` rend `[r, gg, b, vx, vy]` où le rgb est le max **canal par canal** sur les 4 voisines
 * libres ; `vx, vy` (« laquelle ») ne sert qu'aux `Face` du rebond. Et `champ-ref.ts:317-324`
 * appelle `recu` **DEUX FOIS**, une sur `light`, une sur `direct` : les deux maxima sont
 * INDÉPENDANTS. Partager une élection entre les deux passes serait donc l'écart, pas la fidélité.
 *
 * Sur un texel LIBRE, chaque champ vaut sa valeur nue — `directFace` part de
 * `new Float32Array(direct)` et seuls les opaques sont réécrits.
 */
const VALEUR_LUMIERE = `
vec3 valeurDe(vec2 t) {
  vec3 d = texture2D(uDirect, uvCible(t)).rgb;
  vec3 r = texture2D(uRebond, uvCible(t)).rgb;
  float m = max(r.r, max(r.g, r.b));
  float s = m > 0.0 ? 1.0 / (1.0 + m / uPlafond) : 1.0;
  return min(d + r * s, vec3(1.0));
}`

/** La part DIRECTE seule — sans rebond et sans genou : `Champ.directFace` (LG-R7, φ ne se divise pas). */
const VALEUR_DIRECTE = `
vec3 valeurDe(vec2 t) { return texture2D(uDirect, uvCible(t)).rgb; }`

const FACE_ECLAIREE = `
vec3 faceEclairee(vec2 t) {
  if (!plein1(t)) return valeurDe(t);
  vec3 l = vec3(0.0);
  for (int n = 0; n < 4; n++) {
    vec2 N = t + dirDe(n);
    if (!dansCadre(N) || plein1(N)) continue;
    l = max(l, valeurDe(N));
  }
  return l;
}`

const FRAG_SOMME = `
uniform sampler2D uDirect;
uniform sampler2D uRebond;
// L'ombre d'astre ÉTENDUE, déjà dilatée — \`gi-drapeau\`.g, passe 3 (voir \`FRAG_DRAPEAU\`). La
// somme la LIT : elle ne la recalcule plus, et \`gi-direct\`, sa seule entrée, n'a pas bougé entre
// les deux passes.
uniform sampler2D uDrapeau;
uniform float uPlafond;
uniform vec3 uMn;
// La force de l'ombre d'astre (SHADOW_ALPHA × forceDeLOmbre, nulle à la nouvelle lune).
uniform float uA;
${VALEUR_LUMIERE}
${FACE_ECLAIREE}
void main() {
  vec2 fb = floor(gl_FragCoord.xy);
  vec2 t = vec2(fb.x, uTaille.y - 1.0 - fb.y);
  // \`faceEclairee\` porte MOT POUR MOT la branche qui vivait ici (libre → \`lumiere(t)\` ; opaque →
  // max par canal sur les 4 voisines libres). Le comportement ne bouge pas, et LG-A2 le dira.
  vec3 l = faceEclairee(t);
  // Un occludeur ne prend AUCUNE ombre d'astre (LG-R8) : son plancher reste le voile nu.
  float s = plein1(t) ? 0.0 : texture2D(uDrapeau, uvCible(t)).g;
  // LG-R5, LA LOI QUI COMPOSE : M = 1 - (1 - Mn) * (1 - L), soit Mn + L * (1 - Mn). La lumiere
  // comble l'ecart entre le plancher du voile et 1, jamais au-dessus : c'est la phrase de design
  // elle-meme, le feu ne remplit que l'ombre. A uMn = 0 la formule rend L a l'identique, et c'est
  // ce qui garde LG-A2 intact (l'oracle compare gi-champ a L) sans passe ni texture de plus.
  // Et LE PLANCHER SE CREUSE D'ABORD : Mn × (1 - a × S), l'ombre que l'astre retire au voile avant
  // que la lumière ne la comble. C'est \`composerM\` de l'oracle, terme pour terme.
  vec3 plancher = uMn * (1.0 - uA * s);
  gl_FragColor = vec4(1.0 - (1.0 - plancher) * (1.0 - l), 1.0);
}`

/**
 * ═══ LES DEUX CIBLES DE LA PASSE DES CORPS (LG-R7) ═══
 *
 * La passe des corps lit `Champ.light` et `Champ.directFace` sous chaque pixel. **Aucune des cinq
 * cibles existantes ne les porte**, et c'est ce qui a décidé ces deux passes plutôt qu'une lecture
 * directe :
 *   · `gi-champ` porte M, LG-R5 **déjà composée** — le lire comme `L` composerait le corps deux fois ;
 *   · `gi-direct` a l'ombre PLEINE en alpha, sans pénombre (elle naît dans la somme), et ne dit
 *     rien de la face d'un opaque ;
 *   · `gi-faces` est `albédo × direct du voisin libre` : la SOURCE du rebond, pas la face reçue ;
 *   · `lumiere()` n'était qu'une aide INTERNE à `FRAG_SOMME`, jamais écrite nulle part.
 *
 * L'autre route — rééchantillonner `gi-direct` + `gi-rebond` + `gi-occ` + `gi-drapeau` depuis le
 * shader des corps, avec la branche du voisin opaque — coûtait **20 lectures de texture par pixel
 * de corps**. Ici : deux passes sur une grille au quart de la résolution du monde.
 *
 * Les deux partagent `FACE_ECLAIREE` avec la somme ; seule `valeurDe` change.
 */
const FRAG_LUMIERE = `
uniform sampler2D uDirect;
uniform sampler2D uRebond;
uniform float uPlafond;
${VALEUR_LUMIERE}
${FACE_ECLAIREE}
void main() {
  vec2 fb = floor(gl_FragCoord.xy);
  vec2 t = vec2(fb.x, uTaille.y - 1.0 - fb.y);
  gl_FragColor = vec4(faceEclairee(t), 1.0);
}`

const FRAG_FACE_DIRECTE = `
uniform sampler2D uDirect;
${VALEUR_DIRECTE}
${FACE_ECLAIREE}
void main() {
  vec2 fb = floor(gl_FragCoord.xy);
  vec2 t = vec2(fb.x, uTaille.y - 1.0 - fb.y);
  gl_FragColor = vec4(faceEclairee(t), 1.0);
}`

type Uniformes = Record<string, number | number[] | Float32Array>
type Poser = (name: string, value: unknown) => void

/** Le champ de la GI sur le GPU, pour une scène : à créer une fois, `update` par image. */
export class ChampGpu {
  private fenetre: Fenetre = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private gw = 0
  private gh = 0
  private ox = 0
  private oy = 0
  private grille: (GrilleGi & { ox: number; oy: number }) | null = null
  private empreinte = ''
  private occ: Phaser.Textures.CanvasTexture | null = null
  private alb: Phaser.Textures.CanvasTexture | null = null
  private passes: Phaser.GameObjects.Shader[] = []
  private direct: Phaser.GameObjects.Shader | null = null
  private champ: Phaser.GameObjects.Shader | null = null
  private image: Phaser.GameObjects.Image | null = null
  /** Les sources de l'image courante, en texels de la grille (pour l'oracle). */
  private emetteurs: Emetteur[] = []
  private uSrc = new Float32Array(GI.MAX_SOURCES * 4)
  private uNb = 0
  /** La borne de marche du direct, en pas du raster 2× — recalculée par image avec les sources. */
  private uPasMaxDirect = 0
  private uMotif = new Float32Array(32)
  private uAlbBande = new Float32Array(GI.MAX_ALBEDOS_BANDE * 3)
  /**
   * Mn — LE PLANCHER DU VOILE, PAR CANAL (LG-R5), et rien d'autre : la GI ne le RECALCULE pas,
   * elle le REÇOIT, comme la brosse du voile et le champ partagent déjà `profilDuTrou` (LG-R4,
   * une loi, deux lecteurs). LG-A5 l'exige au chiffre près : « le Mn du champ vaut celui du code
   * à ≤ 0,005 par canal ».
   *
   * ZÉRO tant que la composition n'est pas câblée (tranche C2) — et ce zéro n'est pas un
   * bouche-trou : à Mn = 0, M = 1 − (1 − 0)(1 − L) = L À L'IDENTIQUE. La garde LG-A2 lit donc
   * exactement le champ qu'elle lisait avant, sans sixième passe et sans seconde cible.
   */
  private uMn: number[] = [0, 0, 0]
  /**
   * L'ASTRE QUI JETTE L'OMBRE (LG-R8), REÇU et jamais recalculé. `deriveDOmbre` et `forceDeLOmbre`
   * sont la loi de `scenes/world/dynamic-lighting.ts`, que `WorldScene` pousse déjà aux socles et
   * aux falaises (`view.deriveOmbre`, `view.forceOmbre`) : la GI lit le MÊME nombre à la MÊME heure.
   * L'opacité arrive DÉJÀ multipliée par `SHADOW_ALPHA`, qui vit dans `scenes/world/` — `render/gi/`
   * ne remonte pas d'une couche pour aller la chercher.
   *
   * `null` : pas d'ombre d'astre du tout (nouvelle lune, crépuscule, composition coupée).
   */
  private astre: Astre | null = null
  private uA = 0
  /** Le vecteur d'ombre poussé au shader, en texels : (cisaillement × ℓ × dérive, ℓ). */
  private uOmbre: number[] = [0, 0]
  private uPasOmbre = 0
  private albBandes: Albedo[] = []
  /**
   * ═══ LES CARTES DES ARBRES (LG-R8) ═══
   * `gi-arbres` : la texture-canvas au grain qui porte l'ombre projetée de chaque fût et de chaque
   * cime (`ecrireLesCartes`) ; la passe 1 la lit dans son alpha. `cartesMonde` arrive de la vue à
   * chaque image (`poserLesCartes`), `cartes` en est la traduction en px de grille, avec la silhouette
   * binaire — c'est ce que l'oracle lit (LG-A2, `masque()`), et c'est lui qui rastérise.
   */
  private arbres: Phaser.Textures.CanvasTexture | null = null
  /** L'image téléversée, réutilisée d'une image à l'autre ; `arbresVides` : la cible est à zéro. */
  private imageArbres: ImageData | null = null
  private arbresVides = true
  private masqueCartes: Float32Array = new Float32Array(0)
  private readonly silhouettes: Silhouettes
  private cartesMonde: readonly CarteMonde[] = []
  private cartes: CarteDOmbre[] = []
  /** Le coût de la dernière image, étape par étape, en ms — le budget de LG-A14 se lit ici. */
  readonly temps = { bati: 0, grille: 0, occludeurs: 0, cartes: 0, rendu: 0, total: 0 }

  constructor(private readonly scene: Phaser.Scene) {
    MOTIF_SOURCE.forEach((p, k) => {
      this.uMotif[k * 2] = p[0]
      this.uMotif[k * 2 + 1] = p[1]
    })
    this.silhouettes = new Silhouettes(scene)
  }

  /** Les cartes de l'image (LG-R8), relevées par la vue sur les sprites qu'elle vient de poser. */
  poserLesCartes(cartes: readonly CarteMonde[]): void {
    this.cartesMonde = cartes
  }

  /** Les cartes de l'image en px de grille, pour l'oracle. */
  private cartesDOmbre(): CartesDOmbre {
    return { cartes: this.cartes, pxParTexel: PX_PAR_TEXEL }
  }

  /**
   * ═══ LES CARTES PROJETÉES (LG-R8, LG-R9) — rastérisées par l'oracle, téléversées au grain ═══
   *
   * Un point de la carte à la hauteur z tombe à q × z au sud de son pied (q = ℓ/H = 0,4), cisaillé de
   * k = cisaillement × dérive par px de longueur : l'affine M = [[1, −q·k], [0, −q]] autour du pied.
   * C'est `ombreDesCartes` — l'oracle — qui lit chaque texel de l'emprise à l'envers de M jusqu'au
   * pixel de la silhouette, et c'est SON masque que la passe 1 lit, écrit ici dans `gi-arbres`
   * (alpha 255 sous une carte, 0 ailleurs).
   *
   * ═══ POURQUOI LE GPU NE DESSINE PAS LES CARTES — MESURÉ, PAS PRÉFÉRÉ ═══
   * La première forme les dessinait : un sprite-relais par carte, sous `DynamicTexture.capture` avec
   * M en matrice parente et une silhouette binaire en NEAREST. Sonde `tools/__gi-arbres.mjs`, 18/09,
   * 80 cartes à 14 h, la cible relue contre l'oracle texel par texel :
   *   · le lot de quads multi-textures PERDAIT 188 texels sur 1082 (0 dessinées une à une, 0 avec un
   *     atlas d'une seule texture) — le choix de la texture se fait sur une égalité flottante d'un
   *     varying (`outTexDatum == float(INDEX)`, Phaser 4 `GetTexture-glsl.js`), qui rate des pixels
   *     sous SwiftShader, transparents, jamais gagnés ;
   *   · même en atlas, 21 texels sur 1463 restaient en désaccord : 12 à égalité exacte (le centre du
   *     texel juste sur un bord de pixel), 9 à moins de 0,22 px d'un bord. Une carte couchée à 0,4
   *     met dix pixels de silhouette dans un texel : au sous-pixel près du rastériseur, ce n'est plus
   *     « le pixel sous le centre du texel » qu'il lit.
   * Au CPU, les cartes de l'image coûtent une fraction de milliseconde (`temps.cartes`) et le masque
   * est, au bit, celui de l'oracle. La garde du masque (LG-A9) n'éprouve plus la rastérisation — c'est
   * `champ-ref.test.ts` qui le fait, sur toutes les variantes — mais le TÉLÉVERSEMENT et la LECTURE :
   * l'orientation (`uvCible`), le grain, le seuil, l'union avec l'ombre des bandes.
   *
   * Sans astre ou sans carte, la cible est vidée une fois et laissée vide : la passe 1 n'y lit rien.
   */
  private ecrireLesCartes(): void {
    const g = this.grille
    const astre = this.astre
    this.cartes = []
    if (!g || !astre || this.cartesMonde.length === 0) {
      if (!this.arbresVides) this.televerserLesCartes(null)
      return
    }
    const ox = this.ox * PX_PAR_TEXEL
    const oy = this.oy * PX_PAR_TEXEL
    // L'emprise d'une carte, en px : la plus haute cime (96 px, LG-R9) couchée à 0,4 puis cisaillée,
    // plus sa largeur. Une carte dont le pied est plus loin que ça du cadre ne peut rien y jeter.
    const MARGE = GI.ASTRE.HAUTEUR_MAX_LANCEUR_PX * (1 + GI.ASTRE.CISAILLEMENT) + 64
    const x0 = ox - MARGE
    const x1 = ox + this.gw * PX_PAR_TEXEL + MARGE
    const y0 = oy - MARGE
    const y1 = oy + this.gh * PX_PAR_TEXEL + MARGE
    for (const c of this.cartesMonde) {
      if (c.piedX < x0 || c.piedX > x1 || c.piedY < y0 || c.piedY > y1) continue
      const silhouette = this.silhouettes.prendre(c.cle)
      if (silhouette === null) continue
      this.cartes.push({
        silhouette,
        x: c.x - ox, y: c.y - oy, originX: c.originX, originY: c.originY,
        rotation: c.rotation, scaleX: c.scaleX, scaleY: c.scaleY, flipX: c.flipX, flipY: c.flipY,
        piedX: c.piedX - ox, piedY: c.piedY - oy,
      })
    }
    if (this.cartes.length === 0) {
      if (!this.arbresVides) this.televerserLesCartes(null)
      return
    }
    const n = this.gw * this.gh
    if (this.masqueCartes.length !== n) this.masqueCartes = new Float32Array(n)
    else this.masqueCartes.fill(0)
    ombreDesCartes(g, this.masqueCartes, astre, this.cartesDOmbre())
    this.televerserLesCartes(this.masqueCartes)
  }

  /** Le masque des cartes (1 = à l'ombre) dans l'alpha de `gi-arbres` ; `null` vide la cible. */
  private televerserLesCartes(s: Float32Array | null): void {
    const ct = this.arbres
    if (!ct) return
    const w = this.gw
    const h = this.gh
    const ctx = ct.getContext()
    if (!this.imageArbres || this.imageArbres.width !== w || this.imageArbres.height !== h) this.imageArbres = ctx.createImageData(w, h)
    const D = this.imageArbres.data
    D.fill(0)
    if (s) for (let k = 0; k < w * h; k++) if (s[k] === 1) D[k * 4 + 3] = 255
    ctx.putImageData(this.imageArbres, 0, 0)
    ct.refresh()
    // `refresh()` remet LINEAR : on reprend NEAREST à chaque écriture (mémoire du projet).
    ct.setFilter(NEAREST)
    this.arbresVides = s === null
  }

  /** La chaîne ne vit qu'en WebGL : `null` en Canvas. */
  static creer(scene: Phaser.Scene): ChampGpu | null {
    return scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? new ChampGpu(scene) : null
  }

  /**
   * Une image : la fenêtre suit la caméra (plus la marge), les occludeurs se réécrivent quand la fenêtre,
   * l'étage ou le bâti changent, les sources deviennent des uniformes, et les cinq passes rendent.
   */
  update(
    passes: number,
    cam: Phaser.Cameras.Scene2D.Camera,
    monde: MondeEclaire,
    niveau: number,
    sources: readonly SourceGi[],
    depth: number,
    mn: readonly [number, number, number] | null = null,
    /** L'astre : `deriveDOmbre` tel quel, et `a` = `SHADOW_ALPHA` × `forceDeLOmbre` (LG-R8). Les DEUX
     *  se prennent à la MÊME image, d'un seul endroit : une opacité d'une image et une géométrie
     *  d'une autre feraient un décalage qui se lit comme un tremblement. */
    astre: { readonly derive: number; readonly a: number } | null = null,
  ): void {
    const n = Math.max(1, Math.min(PASSES_GI, Math.floor(passes)))
    const v = cam.worldView
    const tDebut = performance.now()
    const T = LUMIERE.TEXELS_PAR_TUILE
    const x0 = Math.floor(v.x / TILE_PX) - GI.MARGE_TUILES
    const y0 = Math.floor(v.y / TILE_PX) - GI.MARGE_TUILES
    // La fenêtre s'alloue par PALIERS et ne rétrécit JAMAIS. `floor` et `ceil` franchissent leurs
    // seuils séparément : une caméra qui glisse ferait osciller la taille d'une tuile, et chaque
    // oscillation détruirait neuf textures et sept shaders — puis, `destroy` effaçant l'empreinte,
    // reforcerait une grille entière à 39 ms. Une image sur deux, en déplacement.
    const P = GI.PALIER_TEXELS
    const besoinW = (Math.ceil((v.x + v.width) / TILE_PX) + GI.MARGE_TUILES - x0 + 1) * T
    const besoinH = (Math.ceil((v.y + v.height) / TILE_PX) + GI.MARGE_TUILES - y0 + 1) * T
    const gw = Math.max(this.gw, Math.ceil(besoinW / P) * P)
    const gh = Math.max(this.gh, Math.ceil(besoinH / P) * P)
    if (gw !== this.gw || gh !== this.gh) this.batir(gw, gh)
    // La fenêtre couvre exactement ce qui est alloué — jamais le besoin nu : grille, occludeurs,
    // uniformes et image doivent parler de la MÊME surface que les cibles de rendu.
    const f: Fenetre = { x0, y0, x1: x0 + gw / T - 1, y1: y0 + gh / T - 1 }
    // Les passes se bâtissent à la demande, dans l'ordre — une sonde peut n'en demander qu'une.
    while (this.passes.length < n) this.batirPasse(this.passes.length + 1)
    this.temps.bati = performance.now() - tDebut
    this.fenetre = f
    this.ox = f.x0 * T
    this.oy = f.y0 * T
    // Les occludeurs : réécrits quand la fenêtre bouge ou que le monde change de forme. Le bâti et
    // les nœuds se comptent — un mur bâti, un fût abattu changent le compte ; une arête retournée
    // sur place ne le change pas (à relever si ça se voit).
    const empreinte = `${f.x0},${f.y0},${f.x1},${f.y1},${niveau},${monde.structures.length},${monde.nodes?.length ?? -1}`
    this.temps.grille = 0
    this.temps.occludeurs = 0
    if (empreinte !== this.empreinte) {
      this.empreinte = empreinte
      const tG = performance.now()
      this.grille = grilleDuMonde(monde, niveau, f)
      const tO = performance.now()
      this.ecrireOccludeurs(this.grille)
      this.temps.grille = tO - tG
      this.temps.occludeurs = performance.now() - tO
    }
    // Les sources : en texels de la grille, les plus proches du centre de la vue d'abord.
    const cx = (v.x + v.width / 2) / PX_PAR_TEXEL - this.ox
    const cy = (v.y + v.height / 2) / PX_PAR_TEXEL - this.oy
    const em: Emetteur[] = []
    for (const s of sources) {
      const x = s.worldX / PX_PAR_TEXEL - this.ox
      const y = s.worldY / PX_PAR_TEXEL - this.oy
      const rayon = (s.radiusTiles * TILE_PX) / PX_PAR_TEXEL
      if (rayon <= 0 || s.force <= 0) continue
      if (x + rayon < 0 || y + rayon < 0 || x - rayon > gw || y - rayon > gh) continue
      em.push({ x, y, rayon, taille: GI.TAILLE_SOURCE, rgb: [GI.TEINTE_FEU[0] * s.force, GI.TEINTE_FEU[1] * s.force, GI.TEINTE_FEU[2] * s.force] })
    }
    em.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2))
    this.emetteurs = em.slice(0, GI.MAX_SOURCES)
    this.uNb = this.emetteurs.length
    this.emetteurs.forEach((e, k) => {
      this.uSrc[k * 4] = e.x
      this.uSrc[k * 4 + 1] = e.y
      this.uSrc[k * 4 + 2] = e.rayon
      this.uSrc[k * 4 + 3] = e.rgb[0] / GI.TEINTE_FEU[0]
    })
    // La borne de marche du direct : un rayon ne va jamais plus loin que le rayon de sa source,
    // plus le disque émissif — converti en pas du raster 2×, sur les deux axes.
    let rMax = 0
    for (const e of this.emetteurs) if (e.rayon > rMax) rMax = e.rayon
    this.uPasMaxDirect = Math.ceil(4 * (rMax + GI.TAILLE_SOURCE)) + 2
    // Mn, REÇU et jamais recalculé (LG-A5). `null` = pas de composition : à Mn = 0 la passe somme
    // rend L à l'identique, donc la vue de debug et la garde LG-A2 lisent le champ d'avant.
    this.uMn[0] = mn ? mn[0] : 0
    this.uMn[1] = mn ? mn[1] : 0
    this.uMn[2] = mn ? mn[2] : 0
    // L'ASTRE (LG-R8, LG-R9) : `longueur` est celle d'un mur (les bandes, marchées au shader) ;
    // `longueurParHauteur` projette les cartes des arbres (`ecrireLesCartes`). Une roche n'est pas
    // lanceur (LG-R15), une marche attend LG-R14. `a` nul = pas d'ombre : on n'en garde aucune trace,
    // et le masque rend zéro partout au bit.
    this.uA = astre && astre.a > 0 ? astre.a : 0
    this.astre =
      this.uA > 0
        ? {
            derive: astre!.derive,
            longueur: longueurDOmbre(GI.ASTRE.HAUTEUR_MUR_PX, PX_PAR_TEXEL),
            cisaillement: GI.ASTRE.CISAILLEMENT,
            penombre: GI.ASTRE.PENOMBRE,
            longueurParHauteur: GI.ASTRE.LONGUEUR_PAR_HAUTEUR,
          }
        : null
    // Le MÊME vecteur pour le shader, et la borne de sa marche : comptée en pas du raster 2×, un
    // segment ne traverse jamais plus de |Dx| + |Dy| + 2 sous-texels. Seize, là où `uPasMaxDirect`
    // en veut 192 — une borne de rayon direct est taillée sur la plus grande SOURCE du cadre.
    const dxO = this.astre ? this.astre.cisaillement * this.astre.longueur * this.astre.derive : 0
    const dyO = this.astre ? this.astre.longueur : 0
    this.uOmbre[0] = dxO
    this.uOmbre[1] = dyO
    this.uPasOmbre = Math.ceil(2 * (Math.abs(dxO) + dyO)) + 2
    // Les cartes des arbres, rastérisées et téléversées AVANT la passe 1 qui les lit (LG-R8).
    const tC = performance.now()
    this.ecrireLesCartes()
    this.temps.cartes = performance.now() - tC
    const tR = performance.now()
    for (let k = 0; k < n; k++) this.passes[k]!.renderImmediate()
    // ⚠ `renderImmediate` ne fait que SOUMETTRE. Ce temps-ci est celui qui occupe le thread
    // principal — le budget d'image de LG-A14 — et non celui de l'exécution GPU, qui ne tombe qu'à
    // la première relecture. Mesuré le 17/09 : 1,7 ms de soumission pour 487 ms d'exécution.
    this.temps.rendu = performance.now() - tR
    this.temps.total = performance.now() - tDebut
    if (this.image) {
      // ═══ LE QUAD DU CHAMP — LE REGARD EN ADD, LA COMPOSITION EN MULTIPLY (LG-R5) ═══
      //
      // Hors composition (`mn === null`), c'est le regard de la tranche B : le champ posé sur le
      // monde en ADD, pour VOIR la lumière au grain.
      //   En composition, il porte M = 1 − (1 − Mn)(1 − L) en MULTIPLY, À LA PLACE du multiplicateur
      // du voile — qui se tait alors ENTIÈREMENT, SON TROU COMPRIS. Ce trou EST le L de la torche :
      // le laisser poserait la lumière deux fois. Mesuré le 17/09 — voile rendu, l'écart au look
      // d'aujourd'hui près de la torche MONTE de 6,60 à 16,9.
      //   « LA LUMIÈRE MULTIPLIE » (LG-R5) : une seule loi compose la nuit et le jour, et c'est
      // celle-ci. Un quad d'écran en SCREEN a été essayé par-dessus, pour porter la lumière sur les
      // CORPS ; il est retiré. LG-R7 ne demande pas un calque : elle demande la lumière du sol lue
      // SOUS CHAQUE PIXEL du sprite, répartie entre ses sources, chaque part passée par sa normal
      // map. Un uniforme d'écran ignore la normale, la répartition et φ — c'est la tranche D.
      this.image
        .setPosition(this.ox * PX_PAR_TEXEL, this.oy * PX_PAR_TEXEL)
        .setDisplaySize(gw * PX_PAR_TEXEL, gh * PX_PAR_TEXEL)
        .setDepth(depth)
        .setBlendMode(mn ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.ADD)
        .setVisible(n >= PASSE_SOMME)
    }
  }

  /** Le nombre de passes bâties (une sonde le lit). */
  get passesBaties(): number {
    return this.passes.length
  }

  setVisible(visible: boolean): void {
    this.image?.setVisible(visible)
  }

  /** La clé de la texture du champ (1×), pour la composition (tranche C). */
  get cle(): string {
    return 'gi-champ'
  }

  /** L'origine du raster en px monde et sa taille en texels — pour qui lit `gi-champ`. */
  get cadre(): { readonly x: number; readonly y: number; readonly gw: number; readonly gh: number; readonly pxParTexel: number } {
    return { x: this.ox * PX_PAR_TEXEL, y: this.oy * PX_PAR_TEXEL, gw: this.gw, gh: this.gh, pxParTexel: PX_PAR_TEXEL }
  }

  /**
   * LES TROIS TEXTURES QUE LA PASSE DES CORPS ÉCHANTILLONNE (LG-R7) — et pas une de plus.
   *
   * `gi-lumiere` porte `L` nu (`Champ.light`), `gi-face-directe` porte `directFace`, et l'ombre
   * d'astre `S` se lit dans le **`.g` de `gi-drapeau`** — l'ombre ÉTENDUE, pénombre comprise, telle
   * que `FRAG_SOMME` la lit elle-même. Les trois raisons de ne pas prendre les voisines évidentes
   * sont écrites aux passes 6 et 7 : `gi-champ` porte M, LG-R5 DÉJÀ composée (le corps se
   * composerait deux fois) ; `gi-direct` n'a en alpha que l'ombre PLEINE, sans pénombre.
   *
   * ⚠ **`null` TANT QUE LES PASSES 6 ET 7 N'EXISTENT PAS.** Elles ne se bâtissent qu'à
   * `debugGi >= PASSES_GI` (`batirPasse`, appelée `while (this.passes.length < n)`), et une clé
   * absente rendrait `textures.get` → la texture `__MISSING` de Phaser, silencieusement : le corps
   * lirait un damier à la place de sa lumière. Le `null` remonte donc jusqu'au nœud, qui a sa
   * propre garde visible du shader (`uGiCadre.z <= 0.0`).
   */
  texturesDesCorps(): {
    readonly lumiere: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
    readonly faceDirecte: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
    readonly ombre: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
  } | null {
    const tex = this.scene.textures
    const prise = (cle: string): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null => {
      if (!tex.exists(cle)) return null
      return tex.get(cle).source[0]?.glTexture ?? null
    }
    const lumiere = prise('gi-lumiere')
    const faceDirecte = prise('gi-face-directe')
    const ombre = prise('gi-drapeau')
    if (!lumiere || !faceDirecte || !ombre) return null
    return { lumiere, faceDirecte, ombre }
  }

  destroy(): void {
    for (const p of this.passes) p.destroy()
    this.passes = []
    this.direct = null
    this.champ = null
    this.image?.destroy()
    this.image = null
    for (const k of ['gi-direct', 'gi-faces', 'gi-drapeau', 'gi-rebond', 'gi-champ', 'gi-lumiere', 'gi-face-directe', 'gi-occ', 'gi-alb', 'gi-arbres']) {
      if (this.scene.textures.exists(k)) this.scene.textures.remove(k)
    }
    this.occ = null
    this.alb = null
    this.arbres = null
    this.imageArbres = null
    this.arbresVides = true
    this.gw = 0
    this.gh = 0
    this.empreinte = ''
  }

  // ─── LA GARDE (LG-A1, LG-A2, LG-A3) : les cibles relues contre l'oracle, sur la MÊME grille ───

  /**
   * Relit une cible (RGBA, rangée 0 au NORD, comme la grille). `direct` et `champ` pour LG-A2 ; les
   * trois textures que les corps échantillonnent (`texturesDesCorps`) pour la garde LG-A8, qui doit
   * composer sa référence sur CE que le shader a lu — les cibles du GPU, pas l'oracle CPU.
   */
  lire(cible: 'direct' | 'champ' | 'gi-lumiere' | 'gi-face-directe' | 'gi-drapeau'): Uint8Array {
    const sh =
      cible === 'direct' ? this.direct
      : cible === 'champ' ? this.champ
      : (this.passes.find((p) => (p as unknown as { texture?: { key?: string } | null }).texture?.key === cible) ?? null)
    if (!sh || !sh.drawingContext) return new Uint8Array(0)
    const r = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer
    const gl = r.gl
    r.glWrapper.updateBindingsFramebuffer({ bindings: { framebuffer: sh.drawingContext.framebuffer } })
    const w = sh.width
    const h = sh.height
    const bas = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bas)
    // Le framebuffer compte ses rangées depuis le bas : on remet le nord en tête.
    const haut = new Uint8Array(w * h * 4)
    for (let j = 0; j < h; j++) haut.set(bas.subarray((h - 1 - j) * w * 4, (h - j) * w * 4), j * w * 4)
    return haut
  }

  /** L'oracle sur la grille et les sources de l'image courante. */
  oracle(): ReturnType<typeof champRef> | null {
    if (!this.grille) return null
    return champRef(this.grille, this.emetteurs, { rebond: GI.REBOND, porteeRebond: GI.PORTEE_REBOND, plafondRebond: GI.PLAFOND_REBOND, profil: profilFeu })
  }

  /**
   * LE MASQUE D'ASTRE de l'image courante, par l'oracle (LG-R8) — `null` sans astre. Il vit à côté
   * d'`oracle()` et de `lire()` parce qu'il sert à la même chose : la garde s'y compare, et les
   * planches le montrent. Une seule expression du masque, lue par les deux.
   */
  masque(): Float32Array | null {
    return this.grille && this.astre ? masqueDAstre(this.grille, this.astre, this.cartesDOmbre()) : null
  }

  /** Les cartes des arbres projetées à cette image (LG-R8) — la prémisse de la garde du masque. */
  get cartesProjetees(): number {
    return this.cartes.length
  }

  /** Les cibles `direct` et `champ` contre l'oracle, en niveaux. À appeler APRÈS un `update`. */
  verifier(): VerdictGi | null {
    const o = this.oracle()
    const g = this.grille
    if (!o || !g) return null
    const ecart = (lu: Uint8Array, ref: Float32Array): EcartCible => {
      let n = 0
      let somme = 0
      let sup3 = 0
      let max = 0
      let eclaires = 0
      for (let k = 0; k < g.gw * g.gh; k++) {
        if (g.occ[k] === 1) continue
        // Tout texel libre que l'oracle OU la lecture dit non noir. L'ancien critère — « dans le
        // rayon d'un émetteur » — excluait précisément les texels que le rebond éclaire depuis une
        // FACE, loin au-delà des sources : ceux que la passe a le plus de chances de rater. LG-A2
        // ne se juge pas sur un sous-ensemble choisi par la seule lumière directe.
        const vuRef = ref[k * 3]! > 0 || ref[k * 3 + 1]! > 0 || ref[k * 3 + 2]! > 0
        const vuLu = lu[k * 4]! > 0 || lu[k * 4 + 1]! > 0 || lu[k * 4 + 2]! > 0
        if (!vuRef && !vuLu) continue
        n++
        let pire = 0
        let lumineux = false
        for (let c = 0; c < 3; c++) {
          // L'attendu s'arrondit comme l'octet auquel on le compare : sinon la quantification
          // facture un demi-niveau d'écart sur chaque texel.
          const attendu = Math.round(Math.min(1, ref[k * 3 + c]!) * 255)
          if (attendu > 0) lumineux = true
          const d = Math.abs(lu[k * 4 + c]! - attendu)
          somme += d
          if (d > pire) pire = d
        }
        if (lumineux) eclaires++
        if (pire > 3) sup3++
        if (pire > max) max = pire
      }
      return { n, moyenne: n > 0 ? somme / (n * 3) : 0, partSup3: n > 0 ? sup3 / n : 0, max, eclaires }
    }
    const direct = this.lire('direct')
    const champ = this.lire('champ')
    const vide: EcartCible = { n: 0, moyenne: 0, partSup3: 0, max: 0, eclaires: 0 }
    // LE MASQUE EST UN SCALAIRE PAR TEXEL, relu dans l'alpha — son écart se compte donc à part des
    // deux autres, qui comparent des triplets. `eclaires` porte ici le nombre de texels que l'oracle
    // met à l'ombre : sans lui, une garde verte sur une scène sans ombre ne dirait rien.
    const ecartMasque = (lu: Uint8Array): EcartCible => {
      // L'ALPHA DE `gi-direct` PORTE L'OMBRE PLEINE, PAS LE MASQUE ENTIER — la pénombre se dilate
      // dans la passe somme, où plus rien n'est relisible (un alpha < 1 sur `gi-champ` changerait
      // son quad MULTIPLY). On compare donc LE MÊME ÉTAGE des deux côtés, exactement, plutôt que le
      // masque entier à peu près ; la pénombre est épinglée au texel par `champ-ref.test.ts`.
      const ref = this.grille && this.astre ? ombrePleineDAstre(this.grille, this.astre, this.cartesDOmbre()) : null
      if (lu.length === 0 || !ref) return vide
      let n = 0
      let somme = 0
      let sup3 = 0
      let max = 0
      let ombres = 0
      for (let k = 0; k < g.gw * g.gh; k++) {
        if (g.occ[k] === 1) continue
        n++
        const attendu = Math.round(ref[k]! * 255)
        if (attendu > 0) ombres++
        const d = Math.abs(lu[k * 4 + 3]! - attendu)
        somme += d
        if (d > 3) sup3++
        if (d > max) max = d
      }
      return { n, moyenne: n > 0 ? somme / n : 0, partSup3: n > 0 ? sup3 / n : 0, max, eclaires: ombres }
    }
    /**
     * ═══ LA COMPOSITION, PROUVÉE EN PIXELS (LG-R5, LG-R8) ═══
     *
     * `gi-champ` est le SEUL endroit où `a` et la pénombre entrent dans l'image : la passe somme creuse
     * le plancher de Mn × (1 − a·S) avant que la lumière ne le comble. Rien en amont ne les porte —
     * l'alpha de `gi-direct` n'a que l'ombre PLEINE, sans force ni bord doux. Sans cette garde-ci, un
     * uniforme qui n'arriverait jamais au shader (`uA`, `uPen` — le piège du nom WebGL, déjà payé une
     * fois sur un tableau) laisserait TOUT vert et l'ombre absente de l'écran, parce que 485 texels
     * assombris sur 34 952 ne déplacent la moyenne du champ que d'un demi-niveau, moins que l'écart
     * entre deux images. On compare donc `gi-champ` à `composerM`, terme pour terme, sur le masque
     * ENTIER — c'est la seule des trois cibles qui éprouve la PÉNOMBRE.
     *
     * ⚠ ET SA PRÉMISSE EST UNE INTERSECTION, PAS UN COMPTE D'OMBRES. Sur une scène SANS SOURCE,
     * `o.light` est nul partout, `composerM` tombe sur sa branche `if (l <= 0) return plancher`, et
     * la garde ne prouve plus que le PLANCHER : verte en n'ayant jamais éprouvé le terme de
     * comblement ni l'ORDRE qui le compose. `eclaires` compte donc les texels où l'ombre ET la
     * lumière se rencontrent — une torche qui éclaire DANS l'ombre d'un mur.
     */
    const ecartCompose = (lu: Uint8Array): EcartCible => {
      const s = this.masque()
      if (lu.length === 0 || !s || this.uA <= 0) return vide
      let n = 0
      let somme = 0
      let sup3 = 0
      let max = 0
      let croises = 0
      for (let k = 0; k < g.gw * g.gh; k++) {
        if (g.occ[k] === 1) continue
        n++
        // LA PRÉMISSE : là où l'ombre ET la lumière se rencontrent. Compter les seuls texels que
        // l'astre touche ne prouverait que la MOITIÉ de `composerM` — son plancher — puisque sans
        // lumière la fonction sort avant de composer quoi que ce soit.
        if (s[k]! > 0 && (o.light[k * 3]! > 0 || o.light[k * 3 + 1]! > 0 || o.light[k * 3 + 2]! > 0)) croises++
        let pire = 0
        for (let c = 0; c < 3; c++) {
          const attendu = Math.round(composerM(this.uMn[c]!, s[k]!, this.uA, o.light[k * 3 + c]!) * 255)
          const d = Math.abs(lu[k * 4 + c]! - attendu)
          somme += d
          if (d > pire) pire = d
        }
        if (pire > 3) sup3++
        if (pire > max) max = pire
      }
      return { n, moyenne: n > 0 ? somme / (n * 3) : 0, partSup3: n > 0 ? sup3 / n : 0, max, eclaires: croises }
    }
    return {
      fenetre: this.fenetre,
      gw: this.gw,
      gh: this.gh,
      sources: this.emetteurs.length,
      bandes: g.murs.length,
      cartes: this.cartes.length,
      direct: direct.length > 0 ? ecart(direct, o.direct) : vide,
      champ: champ.length > 0 ? ecart(champ, o.light) : vide,
      masque: ecartMasque(direct),
      compose: ecartCompose(champ),
      purete: 1,
    }
  }

  // ─── LA CONSTRUCTION ───

  /** Les deux textures-canvas de la fenêtre ; les passes viennent ensuite, une à une (`batirPasse`). */
  private batir(gw: number, gh: number): void {
    this.destroy()
    this.gw = gw
    this.gh = gh
    const tex = this.scene.textures
    this.occ = tex.createCanvas('gi-occ', gw * 2, gh * 2)
    this.alb = tex.createCanvas('gi-alb', gw * 2, gh * 2)
    // LA CIBLE DES CARTES (LG-R8), au grain — bâtie AVANT la passe 1, qui la lie par sa clé. Une
    // texture-canvas comme `gi-occ` : l'oracle la rastérise, `ecrireLesCartes` la téléverse.
    this.arbres = tex.createCanvas('gi-arbres', gw, gh)
    this.imageArbres = null
    this.arbresVides = false
  }

  /** La passe `k` (1 à `PASSES_GI`), dans l'ordre : chacune lit les cibles des précédentes. */
  private batirPasse(k: number): void {
    const gw = this.gw
    const gh = this.gh
    const tex = this.scene.textures
    const taille = [gw, gh]
    const mk = (name: string, frag: string, w: number, h: number, textures: string[], cle: string, uniformes: () => Uniformes): Phaser.GameObjects.Shader => {
      const sh = new Phaser.GameObjects.Shader(
        this.scene,
        {
          name,
          fragmentSource: ENTETE + COMMUN + frag,
          setupUniforms: (set: Poser) => {
            set('uTaille', taille)
            const u = uniformes()
            for (const k of Object.keys(u)) {
              const v = u[k]!
              set(k, v)
              if (typeof v !== 'number') set(k + '[0]', v)
            }
          },
        },
        0,
        0,
        w,
        h,
        textures,
      )
      sh.setOrigin(0, 0)
      sh.setRenderToTexture(cle)
      tex.get(cle).setFilter(NEAREST)
      this.passes.push(sh)
      return sh
    }
    if (k === 1) {
      this.direct = mk('gi-direct', FRAG_DIRECT, gw, gh, ['gi-occ', 'gi-arbres'], 'gi-direct', () => ({
        uOcc: 0, uArbres: 1, uSrc: this.uSrc, uNb: this.uNb, uTeinte: [GI.TEINTE_FEU[0], GI.TEINTE_FEU[1], GI.TEINTE_FEU[2]],
        uMotif: this.uMotif, uTailleSource: GI.TAILLE_SOURCE, uPic: HOLE_ERASE_PEAK,
        uPasMax: this.uPasMaxDirect,
        uOmbre: this.uOmbre, uPasOmbre: this.uPasOmbre,
      }))
    } else if (k === 2) {
      mk('gi-faces', FRAG_FACES, gw * 2, gh * 2, ['gi-occ', 'gi-alb', 'gi-direct'], 'gi-faces', () => ({
        uOcc: 0, uAlb: 1, uDirect: 2, uAlbBande: this.uAlbBande,
      }))
    } else if (k === 3) {
      mk('gi-drapeau', FRAG_DRAPEAU, gw, gh, ['gi-occ', 'gi-faces', 'gi-direct'], 'gi-drapeau', () => ({
        uOcc: 0, uFaces: 1, uDirect: 2, uPen: [GI.ASTRE.PENOMBRE[0], GI.ASTRE.PENOMBRE[1]],
      }))
    } else if (k === 4) {
      mk('gi-rebond', FRAG_REBOND, gw, gh, ['gi-occ', 'gi-faces', 'gi-drapeau'], 'gi-rebond', () => ({
        uOcc: 0, uFaces: 1, uDrapeau: 2, uGain: GI.REBOND, uPortee: GI.PORTEE_REBOND, uNb: this.uNb,
        // Un rayon de rebond ne dépasse jamais `uPortee` texels : quatre pas de raster par texel
        // sur les deux axes, plus la marge d'entrée. 50 pas au lieu de 192.
        uPasMax: 4 * GI.PORTEE_REBOND + 2,
      }))
    } else if (k === 5) {
      this.champ = mk('gi-somme', FRAG_SOMME, gw, gh, ['gi-occ', 'gi-direct', 'gi-rebond', 'gi-drapeau'], 'gi-champ', () => ({
        uOcc: 0, uDirect: 1, uRebond: 2, uDrapeau: 3, uPlafond: GI.PLAFOND_REBOND, uMn: this.uMn,
        uA: this.uA,
      }))
      // Le quad du champ : ADD pour le REGARD (tranche B), MULTIPLY quand il COMPOSE (LG-R5) —
      // `update` tranche par image, selon que `mn` est là ou non.
      this.image = this.scene.add.image(0, 0, 'gi-champ').setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD).setVisible(false)
    } else if (k === 6) {
      // ─── CE QUE LA PASSE DES CORPS LIT, ET QUE `gi-champ` N'EST PAS ───
      // `gi-champ` porte M = 1 − (1 − Mn(1 − aS))(1 − L), LG-R5 DÉJÀ composée : le lire comme `L`
      // composerait le corps une seconde fois. `gi-lumiere` publie `L` nu — `Champ.light`.
      mk('gi-lumiere', FRAG_LUMIERE, gw, gh, ['gi-occ', 'gi-direct', 'gi-rebond'], 'gi-lumiere', () => ({
        uOcc: 0, uDirect: 1, uRebond: 2, uPlafond: GI.PLAFOND_REBOND,
      }))
    } else if (k === 7) {
      // Et `gi-direct` n'est pas `directFace` non plus : son alpha porte l'ombre PLEINE, sans
      // pénombre (elle naît dans la somme), et sur un opaque il ne dit rien de sa face.
      mk('gi-face-directe', FRAG_FACE_DIRECTE, gw, gh, ['gi-occ', 'gi-direct'], 'gi-face-directe', () => ({
        uOcc: 0, uDirect: 1,
      }))
    }
  }

  /** Les deux textures-canvas au double du grain, depuis la grille de la sim. */
  private ecrireOccludeurs(g: GrilleGi): void {
    if (!this.occ || !this.alb) return
    const w2 = g.gw * 2
    const h2 = g.gh * 2
    const co = this.occ.getContext()
    const ca = this.alb.getContext()
    const io = co.createImageData(w2, h2)
    const ia = ca.createImageData(w2, h2)
    const O = io.data
    const A = ia.data
    for (let k = 0; k < w2 * h2; k++) {
      O[k * 4 + 3] = 255
      A[k * 4 + 3] = 255
    }
    for (let j = 0; j < g.gh; j++)
      for (let i = 0; i < g.gw; i++) {
        const k = j * g.gw + i
        if (g.occ[k] !== 1) continue
        for (let sj = 0; sj < 2; sj++)
          for (let si = 0; si < 2; si++) {
            const q = ((j * 2 + sj) * w2 + i * 2 + si) * 4
            O[q] = CODE_CELLULE * 40
            A[q] = Math.round(g.albedo[k * 3]! * 255)
            A[q + 1] = Math.round(g.albedo[k * 3 + 1]! * 255)
            A[q + 2] = Math.round(g.albedo[k * 3 + 2]! * 255)
          }
      }
    // Les bandes : en sous-texels, leurs bornes (± ½ texel autour de l'arête, débord d'un demi-texel)
    // tombent sur des entiers — le raster 2× les porte exactement.
    this.albBandes = []
    this.uAlbBande.fill(0)
    const indexAlb = (a: Albedo): number => {
      let i = this.albBandes.findIndex((b) => b[0] === a[0] && b[1] === a[1] && b[2] === a[2])
      if (i < 0) {
        if (this.albBandes.length >= GI.MAX_ALBEDOS_BANDE) return 0
        i = this.albBandes.length
        this.albBandes.push(a)
        this.uAlbBande[i * 3] = a[0]
        this.uAlbBande[i * 3 + 1] = a[1]
        this.uAlbBande[i * 3 + 2] = a[2]
      }
      return i
    }
    if (g.murs.length > 0 && this.albBandes.length === 0) indexAlb(ALBEDO.BATI_DEFAUT)
    g.murs.forEach((m, im) => {
      const ia2 = indexAlb(g.albedoMurs[im] ?? ALBEDO.BATI_DEFAUT)
      const x0 = Math.max(0, Math.round(m.x0 * 2))
      const x1 = Math.min(w2, Math.round(m.x1 * 2))
      const y0 = Math.max(0, Math.round(m.y0 * 2))
      const y1 = Math.min(h2, Math.round(m.y1 * 2))
      for (let j2 = y0; j2 < y1; j2++)
        for (let i2 = x0; i2 < x1; i2++) {
          const q = (j2 * w2 + i2) * 4
          O[q] = (O[q]! === CODE_CELLULE * 40 ? CODE_CELLULE + CODE_BANDE : CODE_BANDE) * 40
          O[q + 1] = ia2 * 32
        }
    })
    co.putImageData(io, 0, 0)
    ca.putImageData(ia, 0, 0)
    this.occ.refresh()
    this.alb.refresh()
    // `refresh()` remet LINEAR : on reprend NEAREST à chaque écriture (LG-R2).
    this.occ.setFilter(NEAREST)
    this.alb.setFilter(NEAREST)
  }
}
