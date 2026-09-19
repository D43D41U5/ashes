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
import { champRef, composerM, hauteurDesMarches, masqueDAstre, ombreDesCartes, ombreDesMarches, ombrePleineDAstre, type Astre, type CarteDOmbre, type CartesDOmbre, type Emetteur, type GrilleGi } from './champ-ref'
import { grilleDuMonde, type Fenetre } from './grille'
import { ALBEDO, GI, longueurDOmbre, profilFeu, type Albedo } from './reglages'
import { Silhouettes } from './silhouettes'

/**
 * Une source vue par le champ : en px MONDE **LOGIQUES** (la tuile, jamais la position dessinée — LG-R14 :
 * *« la terrasse lit le champ à sa tuile LOGIQUE »*), la portée en tuiles, la force (le battement,
 * l'agonie), et le PALIER de son sol : sa flamme est à `palier × PALIER_TEXELS + FLAMME_TEXELS` texels
 * au-dessus du palier 0, ce que la sim pose (`lumiereDuFeu`, `niveauDeLaTuile`).
 */
export interface SourceGi {
  readonly worldX: number
  readonly worldY: number
  readonly radiusTiles: number
  readonly force: number
  /** Le palier du sol de la source (`palierDuSol`, `niveauDuCorps`) — 0 absent. */
  readonly palier?: number
  /**
   * LA COULEUR de la source à force 1 (LG-R20) : la teinte du feu (`GI.TEINTE_FEU`) quand elle manque —
   * un feu, une torche. Le jour d'une gueule est à la couleur de l'heure (`couleurDuJour`), et c'est
   * la seule source qui n'est pas une flamme : chaque émetteur porte donc SA teinte (`uSrcRgb`).
   */
  readonly rgb?: readonly [number, number, number]
  /**
   * LE JOUR D'UNE GUEULE (LG-R20) : pas une flamme — la loi des anneaux de la sim, Tchebychev à la PAIRE
   * (`demiPx` de demi-largeur autour de `worldX`), linéaire jusqu'à la portée, à sa force propre ; et ses
   * rayons vont au disque posé contre la fente, à (`cibleDx`, `cibleDy`) px de (`worldX`, `worldY`) —
   * `sourceDUnePorte`. En px monde, comme le reste ; voir `Emetteur.jour`.
   */
  readonly jour?: { readonly demiPx: number; readonly cibleDx: number; readonly cibleDy: number }
}

/**
 * ═══ UN CREUX (LG-R3, LG-R20) — le champ SOUS LA ROCHE ═══
 *
 * Dedans, le plancher n'est plus le voile de nuit (un Mn PLAT par canal) : c'est le NOIR de la cave,
 * ouvert autour du corps par le PRÈS et le SOUFFLE, et les trouées du masque où le dehors garde SA
 * nuit — ce que `cave-veil.ts` peignait à l'écran avec ses brosses, et que le champ peint désormais
 * dans SA texture `gi-mn`, au grain, avec LES MÊMES brosses (`render/cave-brosses.ts` : une loi, deux
 * lecteurs). Les lumières, elles — le jour d'une gueule, la torche, le bivouac —, sont des
 * ÉMETTEURS du champ, et apprennent l'ombre de la roche comme le feu (planche 28).
 *
 * TOUT EST LOGIQUE ICI (LG-R14) : `joueur` et les rangées des trouées sont en px et en tuiles de la
 * grille de la sim ; `lift` dit de combien la salle est DESSINÉE plus haut (`p × LIFT_TUILES` rangées,
 * `palierDUneSalle`), et c'est le quad qui remonte, pas la grille.
 */
export interface CreuxGi {
  /** Le lift de l'étage en px monde : la salle se dessine `lift` px plus haut que sa tuile logique. */
  readonly lift: number
  /** Le noir de la cave (`NOIR`) et l'alpha de son voile (`NOIR_ALPHA`) : uniforme sans joueur ; avec
   *  un joueur le plancher est OPAQUE et le près l'ouvre à `1 − alphaVoile` autour du corps. */
  readonly noir: number
  readonly alphaVoile: number
  /** Le multiplicateur de la nuit du DEHORS, par canal, peint dans les trouées : la surface qu'on
   *  voit par la trouée garde sa nuit (`multiplicateurParCanal(voileDeNuit)`). */
  readonly nuit: readonly [number, number, number]
  /** Le joueur en px monde LOGIQUES — le près et le souffle s'y centrent ; `null` : voile uniforme. */
  readonly joueur: { readonly x: number; readonly y: number } | null
  /** Les bandes ouvertes du masque (`EtageLayer`, rangée LOGIQUE `r`, colonnes `a`…`b` incluses). */
  readonly trouees: readonly { readonly r: number; readonly a: number; readonly b: number }[]
  readonly nTrouees: number
  /** Les brosses, une cellule par texel : le près (`ensurePres`), le souffle (`SOI_KEY`, `SOI_PIC`). */
  readonly pres: { readonly side: number; readonly alpha: Float32Array }
  readonly soi: { readonly side: number; readonly alpha: Float32Array; readonly pic: number }
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
  /** Les hauteurs DISTINCTES des bandes du champ (LG-R9) — la prémisse de la garde du masque sur la
   *  marche à hauteur : à une seule hauteur, le GPU et l'oracle s'accorderaient même en l'ignorant. */
  readonly hauteursDeBande: number
  /** Les cartes d'arbres dessinées (LG-R8) — la prémisse de la garde du masque sur les arbres. */
  readonly cartes: number
  /** Les paliers DISTINCTS du champ (LG-R14) — la prémisse des gardes de la marche : à un seul palier,
   *  le GPU et l'oracle s'accorderaient même en l'ignorant. 1 sur une fenêtre plate ou dans un creux. */
  readonly paliers: number
  /** Les texels libres que les MARCHES SEULES mettent à l'ombre d'astre, par l'oracle (LG-A15) — la
   *  prémisse de la garde du masque sur les marches : sans un lanceur de cette sorte dans le champ,
   *  elle n'a rien éprouvé. 0 sans astre. */
  readonly marchesOmbrees: number
  /** SOUS L'ÉPREUVE DES HAUTEURS (`eprouverLesHauteurs`) : les texels libres que la grille du MONDE
   *  — celle d'avant l'épreuve — met à l'ombre pleine, SOUS LE MÊME ASTRE que `masque` ; `null` hors
   *  épreuve. C'est l'« avant » de la prémisse « l'épreuve raccourcit l'ombre » : lu au même instant
   *  — le soleil court entre deux `verifier()`, et l'ombre bouge de dizaines de texels avec lui. */
  readonly ombresSansEpreuve: number | null
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
/** Le lift d'un palier en texels (LG-R14), lu dans la sim — le même nombre que `grille.ts` met dans `marches.hauteur`. */
const H_PALIER = LUMIERE.PALIER_TEXELS

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
// ═══ LES MARCHES (LG-R14) — \`gi-paliers\`, au grain : R = le palier de la tuile, G = 1 sur une PORTE ═══
// Le raster de la sim (\`occlusionAuGrain\`, \`paliers\`/\`portes\`), téléversé par \`ecrireOccludeurs\`.
// Pas dans \`gi-occ\` : ses trois canaux sont pris (code, albédo de bande, hauteur de bande) et son
// alpha est PRÉMULTIPLIÉ à l'upload (\`createUint8ArrayTexture\`, pma = true) — un alpha < 255 y
// écraserait le code. Une texture de plus, une lecture par changement de texel, et rien à décoder.
uniform sampler2D uPaliers;
const float H_PALIER = ${H_PALIER.toFixed(1)};
vec2 palierDe(vec2 t) {
  vec4 v = texture2D(uPaliers, uvCible(t));
  return vec2(floor(v.r * 255.0 + 0.5), v.g);
}
// Le segment p → q (coordonnées continues de grille) entre-t-il dans un occludeur ? La règle de
// segmentBloque (sim) sur le raster 2× : départ et arrivée exclus, une cellule n'est visitée que si
// le segment y entre avant sa fin, à égalité on avance en y d'abord.
//
// ET LA MARCHE (LG-R14), mot pour mot celle de la sim : le rayon est une droite de la hauteur z0 (le
// sol du récepteur) à z1 (la flamme), en texels au-dessus du palier 0 ; quand il CHANGE DE TEXEL, si
// le palier change et qu'aucun des deux texels n'est une porte, il est bloqué s'il franchit l'arête
// STRICTEMENT sous le haut de la marche. Le départ et l'arrivée s'épargnent la SORTE, jamais la
// marche. Hors du cadre, le palier est inconnu : on garde le dernier vu — l'oracle fait de même.
bool bloque(vec2 p, vec2 q, float z0, float z1) {
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
  vec2 cPrec = s1;
  vec2 pp = dansCadre(s1) ? palierDe(s1) : vec2(0.0);
  for (int n = 0; n < 192; n++) {
    if (float(n) >= uPasMax) return false;
    // \`t\` : le paramètre d'ENTRÉE dans le sous-texel suivant — la hauteur du rayon s'y juge.
    float t;
    if (tx < ty) {
      if (tx >= 1.0) return false;
      t = tx;
      c.x += s.x;
      tx += td.x;
    } else {
      if (ty >= 1.0) return false;
      t = ty;
      c.y += s.y;
      ty += td.y;
    }
    vec2 c1 = floor(c * 0.5);
    if (c1 != cPrec) {
      if (dansCadre(c1)) {
        vec2 pn = palierDe(c1);
        if (pn.x != pp.x && pp.y < 0.5 && pn.y < 0.5 && z0 + t * (z1 - z0) < max(pp.x, pn.x) * H_PALIER) return true;
        pp = pn;
      }
      cPrec = c1;
    }
    if (c1 == e1) return false;
    if (c1 == s1) continue;
    if (code2(c) > 0.0) return true;
  }
  return false;
}
`

const FRAG_DIRECT = `
uniform vec4 uSrc[${GI.MAX_SOURCES}];
// La hauteur de la flamme de chaque source, en texels au-dessus du palier 0 (LG-R14, \`Emetteur.z\`).
uniform float uSrcZ[${GI.MAX_SOURCES}];
uniform float uNb;
// La couleur de chaque source, DÉJÀ multipliée par sa force (\`Emetteur.rgb\`) : le feu et la torche à la
// teinte du feu, le jour d'une gueule à la couleur de l'heure (LG-R20).
uniform vec3 uSrcRgb[${GI.MAX_SOURCES}];
// LE JOUR D'UNE GUEULE (LG-R20) : x = la demi-largeur de la paire en texels (< 0 : une flamme, la loi
// d'en dessous ne s'applique pas) ; yz = où vont les rayons, depuis le centre — le disque contre la fente.
uniform vec3 uSrcJour[${GI.MAX_SOURCES}];
uniform vec2 uMotif[16];
uniform float uTailleSource;
uniform float uPic;
// Le vecteur d'ombre, EN TEXELS : (cisaillement × ℓ × dérive, ℓ) — l'ombre de la PLUS HAUTE bande du
// champ (\`uHauteurMarche\`, en texels). Nul quand aucun astre ne porte.
uniform vec2 uOmbre;
uniform float uPasOmbre;
uniform float uHauteurMarche;
// LG-R9 — LA PART D'UNE BANDE : sa hauteur (canal bleu de \`uOcc\`, en huitièmes de texel) rapportée à
// celle de la marche. Un mur de 8 sous une marche de 8 : 1 ; une palissade de 6 : 0,75 — le rayon qui
// entre dans sa bande AU-DELÀ des trois quarts de sa longueur ne lui doit aucune ombre.
float hauteurRel(vec2 c) {
  return floor(texture2D(uOcc, uvRaster(c)).b * 255.0 + 0.5) / (8.0 * uHauteurMarche);
}
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
  // Le paramètre d'ENTRÉE dans le sous-texel courant, le long de D (0 = le départ, 1 = le bout de la
  // marche) : c'est lui qu'une bande compare à sa part (LG-R9).
  float tEntree = 0.0;
  // LES MARCHES (LG-R14, \`ombreDesMarches\`) : le palier du texel de DÉPART — la hauteur d'une marche
  // se compte depuis le sol du récepteur — et le palier et la porte du dernier texel traversé : une
  // marche est une ARÊTE, elle se franchit entre deux texels consécutifs, en montant.
  vec2 p0 = palierDe(t);
  vec2 cPrec = t;
  float pPrec = p0.x;
  float portePrec = p0.y;
  for (int n = 0; n < ${PAS_OMBRE_MAX}; n++) {
    if (float(n) >= uPasOmbre) break;
    if (tx < ty) {
      if (tx >= 1.0) break;
      tEntree = tx;
      c.x += s.x;
      tx += td.x;
    } else {
      if (ty >= 1.0) break;
      tEntree = ty;
      c.y += s.y;
      ty += td.y;
    }
    // Une MONTÉE dont le haut domine le sol du départ, entrée avant la part de sa marche — (haut − bas)
    // paliers sur la hauteur de la marche d'ombre — met le texel à l'ombre ; sauf si le texel quitté ou
    // le texel entré est une porte : un connecteur n'est pas une arête (la colonne de la rampe reste
    // claire, LG-A15). Hors du cadre, le palier est inconnu : on garde le dernier vu, comme l'oracle.
    vec2 c1 = floor(c * 0.5);
    if (c1 != cPrec) {
      if (dansCadre(c1)) {
        vec2 pn = palierDe(c1);
        if (pn.x > pPrec && pn.x > p0.x && portePrec < 0.5 && pn.y < 0.5 && tEntree < (pn.x - p0.x) * H_PALIER / uHauteurMarche) return 1.0;
        pPrec = pn.x;
        portePrec = pn.y;
      }
      cPrec = c1;
    }
    // STRICT, comme les intervalles ouverts de \`coupeBande\` (LG-R10) : un rayon dont la part s'achève
    // exactement au bord d'une bande n'y entre pas. Une bande à la hauteur de la marche (part 1) n'est
    // jamais exclue, la boucle s'arrêtant avant 1.
    if (code2(c) >= 2.0 && tEntree < hauteurRel(c)) return 1.0;
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
  // Le sol de ce texel, en texels au-dessus du palier 0 (LG-R14) : d'ici part chaque rayon.
  float z0 = palierDe(t).x * H_PALIER;
  vec3 acc = vec3(0.0);
  for (int k = 0; k < ${GI.MAX_SOURCES}; k++) {
    if (float(k) >= uNb) break;
    vec4 s = uSrc[k];
    vec3 j = uSrcJour[k];
    float f;
    vec2 cible = s.xy;
    if (j.x >= 0.0) {
      // LE JOUR (LG-R20) : l'anneau de la sim — Tchebychev à la paire, nul sur sa largeur, linéaire jusqu'à
      // la portée, à sa force propre (le pic du feu est celui d'un trou de voile, pas du jour) ; ses rayons
      // vont au disque posé contre la fente (\`sourceDUnePorte\`), et non au centre de la paire.
      vec2 e = abs(p - s.xy);
      f = max(0.0, 1.0 - max(max(0.0, e.x - j.x), e.y) / s.z) * s.w;
      cible = s.xy + j.yz;
    } else {
      f = uPic * profil(distance(p, s.xy) / s.z) * s.w;
    }
    if (f <= 0.0) continue;
    float vus = 0.0;
    for (int m = 0; m < 16; m++) {
      if (!bloque(p, cible + uMotif[m] * uTailleSource, z0, uSrcZ[k])) vus += 1.0;
    }
    if (vus <= 0.0) continue;
    acc += uSrcRgb[k] * (f * vus / 16.0);
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
  // Un occludeur ne prend AUCUNE ombre d'astre (LG-R8), pénombre comprise : l'oracle (\`masqueDAstre\`)
  // ne dilate jamais sur un texel plein, et \`gi-somme\` y lisait déjà 0. Ici pour que la passe des
  // CORPS — qui lit ce canal sans \`uOcc\` — voie le même 0 qu'elle.
  if (plein1(t)) return 0.0;
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
  // Le sol de ce texel (LG-R14) ; une face rebondit au sol de son texel éclairé (\`champRef\`, \`zf\`).
  float z0 = palierDe(t).x * H_PALIER;
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
        if (bloque(p, f + n, z0, palierDe(X + n).x * H_PALIER)) continue;
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
// SOUS LA ROCHE (LG-R3, LG-R20) : le plancher n'est plus plat — \`gi-mn\`, au grain, porte le noir de la
// cave ouvert par le près et le souffle, et la nuit du dehors dans les trouées (voir \`CreuxGi\`).
// \`uMnMode\` > 0,5 : on le lit là ; sinon \`uMn\`, le voile de nuit par canal.
uniform sampler2D uMnTex;
uniform float uMnMode;
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
  vec3 mn = uMnMode > 0.5 ? texture2D(uMnTex, uvCible(t)).rgb : uMn;
  vec3 plancher = mn * (1.0 - uA * s);
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
  /** La grille du monde, gardée le temps d'une épreuve des hauteurs (`eprouverLesHauteurs`) ; `null` sinon. */
  private grilleAvantEpreuve: (GrilleGi & { ox: number; oy: number }) | null = null
  /**
   * Les occludeurs et leurs albédos : deux textures nées d'un `Uint8Array` (`addUint8Array`), et non
   * d'un canvas — les octets se réécrivent en place et `TextureSource.update()` les téléverse tels quels
   * (`texImage2D` depuis le tableau), sans passer par `putImageData` ni relire un canvas 2D. C6, LG-A14 :
   * MESURÉ sous SwiftShader, le changement de fenêtre coûtait 25,6 ms d'occludeurs par le canvas.
   * Phaser retourne l'upload (`flipY` vaut pour un tableau comme pour un canvas) : la lecture par
   * `lireOcc`/`lireAlb` des shaders reste la même.
   */
  private occ: Phaser.Textures.Texture | null = null
  private alb: Phaser.Textures.Texture | null = null
  private occOctets: Uint8Array | null = null
  private albOctets: Uint8Array | null = null
  /** Les marches (LG-R14) : `gi-paliers`, au grain — R = palier, G = porte ; alpha 255 (prémultiplié à l'upload). */
  private paliers: Phaser.Textures.Texture | null = null
  private paliersOctets: Uint8Array | null = null
  private passes: Phaser.GameObjects.Shader[] = []
  private direct: Phaser.GameObjects.Shader | null = null
  private champ: Phaser.GameObjects.Shader | null = null
  private image: Phaser.GameObjects.Image | null = null
  /** Les sources de l'image courante, en texels de la grille (pour l'oracle) — et la FORCE que chacune
   *  a reçue (LG-R6), telle quelle, pour que la garde LG-A7 lise ce que la chaîne a reçu et non ce
   *  qu'elle en a fait (`rgb` est déjà la teinte × la force). */
  private emetteurs: (Emetteur & { readonly force: number })[] = []
  private uSrc = new Float32Array(GI.MAX_SOURCES * 4)
  /** La hauteur de la flamme de chaque source, en texels au-dessus du palier 0 (LG-R14, `Emetteur.z`). */
  private uSrcZ = new Float32Array(GI.MAX_SOURCES)
  /** La couleur × la force de chaque source (`Emetteur.rgb`, LG-R20) — ce que le direct accumule. */
  private uSrcRgb = new Float32Array(GI.MAX_SOURCES * 3)
  /** Le jour d'une gueule (LG-R20) : (demi-largeur, cible − centre) en texels ; x < 0 pour une flamme. */
  private uSrcJour = new Float32Array(GI.MAX_SOURCES * 3)
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
   * LE PLANCHER D'UN CREUX (LG-R3, LG-R20) : `gi-mn`, une texture au grain écrite sur le CPU à chaque
   * image sous la roche — le noir de la cave, le près, le souffle, la nuit des trouées —, et lue par la
   * somme à la place de `uMn` (`uMnMode` = 1). Hors d'un creux elle n'est ni écrite ni lue.
   */
  private mn: Phaser.Textures.Texture | null = null
  private mnOctets: Uint8Array | null = null
  /** L'alpha du noir par texel, le temps d'une image (réutilisé, jamais réalloué). */
  private mnAlpha: Float32Array | null = null
  private uMnMode = 0
  /** Le creux de l'image courante — `null` au sol ; le quad se lève de son `lift`. */
  private creux: CreuxGi | null = null
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
  /** Le vecteur d'ombre poussé au shader, en texels : (cisaillement × ℓ × dérive, ℓ) — ℓ est la
   *  longueur de la PLUS HAUTE bande du champ (`hauteurMarche`), et chaque bande n'en prend que sa part
   *  (LG-R9, `hauteurRel` dans le shader). */
  private uOmbre: number[] = [0, 0]
  private uPasOmbre = 0
  /** La hauteur, en texels, dont `uOmbre` est l'ombre : le max des bandes du champ, un mur à défaut. */
  private hauteurMarche = GI.ASTRE.HAUTEUR_MUR_PX / PX_PAR_TEXEL
  private albBandes: Albedo[] = []
  /**
   * ═══ LES CARTES DES ARBRES (LG-R8) ═══
   * `gi-arbres` : la texture d'octets au grain (comme `gi-occ`) qui porte l'ombre projetée de chaque
   * fût et de chaque cime (`ecrireLesCartes`) ; la passe 1 la lit dans son alpha. `cartesMonde` arrive
   * de la vue à chaque image (`poserLesCartes`), `cartes` en est la traduction en px de grille, avec la
   * silhouette binaire — c'est ce que l'oracle lit (LG-A2, `masque()`), et c'est lui qui rastérise.
   */
  private arbres: Phaser.Textures.Texture | null = null
  /** Les octets téléversés, réécrits en place d'une image à l'autre ; `arbresVides` : la cible est à zéro. */
  private arbresOctets: Uint8Array | null = null
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
    const D = this.arbresOctets
    if (!this.arbres || !D) return
    // Tout à zéro, quatre octets d'un coup, puis l'alpha seul (l'octet haut, petit-boutiste) sous une carte.
    new Uint32Array(D.buffer).fill(0)
    if (s) {
      const n = this.gw * this.gh
      for (let k = 0; k < n; k++) if (s[k] === 1) D[k * 4 + 3] = 255
    }
    // Le téléversement, depuis les octets mêmes — UN seul, le filtre NEAREST posé à la naissance (`batir`)
    // tient. MESURÉ le 2026-09-19 (`tools/__perf-gi.mjs`) : la texture-canvas d'avant en coûtait deux par
    // image — `refresh()`, puis le `setFilter` que `refresh()` obligeait — après un `putImageData`.
    this.arbres.source[0]?.update()
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
    /**
     * LE RÉGIME (LG-R14) : au sol, chaque tuile répond à SON palier et la marche se juge en hauteur ;
     * dans un creux (une cave, un chapeau), tout se lit à `niveau`, la loi d'avant les terrasses. La
     * scène le dit (`!souterrain`) : un chapeau a un niveau ≥ 0 sans être le sol.
     */
    auSol = niveau >= 0,
    /** LE CREUX (LG-R3, LG-R20) : sous la roche, le plancher est `gi-mn` et le quad se lève du lift de
     *  l'étage. `null` au sol — et un creux SANS astre : sous la roche il n'y a pas de ciel. */
    creux: CreuxGi | null = null,
  ): void {
    const n = Math.max(1, Math.min(PASSES_GI, Math.floor(passes)))
    const v = cam.worldView
    const tDebut = performance.now()
    const T = LUMIERE.TEXELS_PAR_TUILE
    // LA FENÊTRE EST LOGIQUE (LG-R14) : la caméra regarde des px DESSINÉS, et dans un creux la salle
    // est dessinée `lift` px plus haut que sa tuile — ce que la vue montre en `v.y` est la rangée
    // logique `(v.y + lift) / TILE_PX`. Le quad, lui, se pose `lift` px plus haut (ci-dessous).
    const lift = creux?.lift ?? 0
    const x0 = Math.floor(v.x / TILE_PX) - GI.MARGE_TUILES
    const y0 = Math.floor((v.y + lift) / TILE_PX) - GI.MARGE_TUILES
    // La fenêtre s'alloue par PALIERS et ne rétrécit JAMAIS. `floor` et `ceil` franchissent leurs
    // seuils séparément : une caméra qui glisse ferait osciller la taille d'une tuile, et chaque
    // oscillation détruirait neuf textures et sept shaders — puis, `destroy` effaçant l'empreinte,
    // reforcerait une grille entière à 39 ms. Une image sur deux, en déplacement.
    const P = GI.PALIER_TEXELS
    const besoinW = (Math.ceil((v.x + v.width) / TILE_PX) + GI.MARGE_TUILES - x0 + 1) * T
    const besoinH = (Math.ceil((v.y + lift + v.height) / TILE_PX) + GI.MARGE_TUILES - y0 + 1) * T
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
    const empreinte = `${f.x0},${f.y0},${f.x1},${f.y1},${niveau},${auSol ? 's' : 'c'},${monde.structures.length},${monde.nodes?.length ?? -1}`
    this.temps.grille = 0
    this.temps.occludeurs = 0
    if (empreinte !== this.empreinte) {
      this.empreinte = empreinte
      // Une grille neuve met fin à toute épreuve des hauteurs : son « avant » ne serait plus la sienne.
      this.grilleAvantEpreuve = null
      const tG = performance.now()
      this.grille = grilleDuMonde(monde, niveau, f, auSol)
      const tO = performance.now()
      this.ecrireOccludeurs(this.grille)
      this.temps.grille = tO - tG
      this.temps.occludeurs = performance.now() - tO
    }
    // Les sources : en texels de la grille, les plus proches du centre de la vue d'abord.
    const cx = (v.x + v.width / 2) / PX_PAR_TEXEL - this.ox
    const cy = (v.y + lift + v.height / 2) / PX_PAR_TEXEL - this.oy
    const em: (Emetteur & { readonly force: number })[] = []
    for (const s of sources) {
      const x = s.worldX / PX_PAR_TEXEL - this.ox
      const y = s.worldY / PX_PAR_TEXEL - this.oy
      const rayon = (s.radiusTiles * TILE_PX) / PX_PAR_TEXEL
      if (rayon <= 0 || s.force <= 0) continue
      if (x + rayon < 0 || y + rayon < 0 || x - rayon > gw || y - rayon > gh) continue
      // LA FLAMME, en texels au-dessus du palier 0 (LG-R14) : le sol de son palier, plus la flamme —
      // `hauteurDuPalier(niveauSource) + FLAMME_TEXELS`, ce que la sim pose dans `partVisible`. Dans un
      // creux la grille n'a pas de marches et cette hauteur ne rencontre rien.
      const z = (auSol ? (s.palier ?? 0) : 0) * H_PALIER + LUMIERE.FLAMME_TEXELS
      // SA COULEUR (LG-R20) : la teinte du feu à défaut — le jour d'une gueule apporte la sienne.
      const teinte = s.rgb ?? GI.TEINTE_FEU
      // …ET SA LOI (LG-R20) : le jour d'une gueule, converti en texels ; une flamme n'a rien à dire.
      const jour = s.jour
        ? { demi: s.jour.demiPx / PX_PAR_TEXEL, cible: [x + s.jour.cibleDx / PX_PAR_TEXEL, y + s.jour.cibleDy / PX_PAR_TEXEL] as const }
        : null
      em.push({ x, y, rayon, taille: GI.TAILLE_SOURCE, rgb: [teinte[0] * s.force, teinte[1] * s.force, teinte[2] * s.force], z, force: s.force, ...(jour ? { jour } : {}) })
    }
    em.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2))
    this.emetteurs = em.slice(0, GI.MAX_SOURCES)
    this.uNb = this.emetteurs.length
    this.emetteurs.forEach((e, k) => {
      this.uSrc[k * 4] = e.x
      this.uSrc[k * 4 + 1] = e.y
      this.uSrc[k * 4 + 2] = e.rayon
      // La force est DANS `rgb` (teinte × force, ce que l'oracle accumule) : le poids scalaire vaut 1.
      this.uSrc[k * 4 + 3] = 1
      this.uSrcZ[k] = e.z ?? 0
      this.uSrcRgb[k * 3] = e.rgb[0]
      this.uSrcRgb[k * 3 + 1] = e.rgb[1]
      this.uSrcRgb[k * 3 + 2] = e.rgb[2]
      const j = e.jour
      this.uSrcJour[k * 3] = j ? j.demi : -1
      this.uSrcJour[k * 3 + 1] = j ? j.cible[0] - e.x : 0
      this.uSrcJour[k * 3 + 2] = j ? j.cible[1] - e.y : 0
    })
    // La borne de marche du direct : un rayon ne va jamais plus loin que le rayon de sa source (plus la
    // largeur de la paire et le décalage de sa cible, pour le jour), plus le disque émissif — converti
    // en pas du raster 2×, sur les deux axes.
    let rMax = 0
    for (const e of this.emetteurs) {
      const j = e.jour
      const portee = e.rayon + (j ? j.demi + Math.hypot(j.cible[0] - e.x, j.cible[1] - e.y) : 0)
      if (portee > rMax) rMax = portee
    }
    this.uPasMaxDirect = Math.ceil(4 * (rMax + GI.TAILLE_SOURCE)) + 2
    // Mn, REÇU et jamais recalculé (LG-A5). `null` = pas de composition : à Mn = 0 la passe somme
    // rend L à l'identique, donc la vue de debug et la garde LG-A2 lisent le champ d'avant.
    this.uMn[0] = mn ? mn[0] : 0
    this.uMn[1] = mn ? mn[1] : 0
    this.uMn[2] = mn ? mn[2] : 0
    // LE PLANCHER D'UN CREUX (LG-R3, LG-R20) : peint au grain, à chaque image sous la roche.
    this.creux = mn ? creux : null
    this.uMnMode = this.creux ? 1 : 0
    if (this.creux) this.peindreLePlancherDuCreux(this.creux)
    // L'ASTRE (LG-R8, LG-R9) : `longueur` est l'étalon d'un mur (le sentinel de l'astre nul) ;
    // `longueurParHauteur` projette les cartes des arbres (`ecrireLesCartes`), chaque bande à sa
    // hauteur (`BandeGrille.hauteur`, marchée au shader) et chaque marche à la sienne (LG-R14,
    // `ombreDesMarches`). Une roche n'est pas lanceur (LG-R15). `a` nul = pas d'ombre : on n'en garde
    // aucune trace, et le masque rend zéro partout au bit.
    // …et JAMAIS dans un creux : sous la roche il n'y a pas de ciel qui porte une ombre.
    this.uA = astre && astre.a > 0 && !creux ? astre.a : 0
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
    // Le vecteur du shader est l'ombre de la PLUS HAUTE bande du champ (`hauteurMarche`, LG-R9) : le
    // rayon la marche entière, et chaque bande rencontrée ne compte que jusqu'à sa part (`hauteurRel`).
    // La borne de la marche : comptée en pas du raster 2×, un segment ne traverse jamais plus de
    // |Dx| + |Dy| + 2 sous-texels. Seize, là où `uPasMaxDirect` en veut 192 — une borne de rayon
    // direct est taillée sur la plus grande SOURCE du cadre.
    const lM = this.astre ? this.astre.longueurParHauteur * this.hauteurMarche : 0
    const dxO = this.astre ? this.astre.cisaillement * lM * this.astre.derive : 0
    const dyO = lM
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
      //   DANS UN CREUX (LG-R3, LG-R20), le quad se LÈVE du lift de l'étage : la grille est logique, la
      // salle est dessinée plus haut — même geste que le corps qui s'y tient (`decalageDEtage`). Et
      // il se pose à la profondeur du voile de cave (`CAVE_VEIL_DEPTH`, passée par la scène) : au-dessus
      // de la salle et de sa roche, sous les lueurs ADD qui restent (braise, nappe).
      this.image
        .setPosition(this.ox * PX_PAR_TEXEL, this.oy * PX_PAR_TEXEL - lift)
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
    readonly champ: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
  } | null {
    const tex = this.scene.textures
    const prise = (cle: string): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null => {
      if (!tex.exists(cle)) return null
      return tex.get(cle).source[0]?.glTexture ?? null
    }
    const lumiere = prise('gi-lumiere')
    const faceDirecte = prise('gi-face-directe')
    const ombre = prise('gi-drapeau')
    // ET `gi-champ`, POUR LES SOLS SEULEMENT (LG-R14) : le `M` composé, celui du quad. Un corps ne le
    // lit jamais (il se composerait deux fois, voir ci-dessus) ; une image de sol n'a QUE lui à lire.
    const champ = prise('gi-champ')
    if (!lumiere || !faceDirecte || !ombre || !champ) return null
    return { lumiere, faceDirecte, ombre, champ }
  }

  destroy(): void {
    for (const p of this.passes) p.destroy()
    this.passes = []
    this.direct = null
    this.champ = null
    this.image?.destroy()
    this.image = null
    for (const k of ['gi-direct', 'gi-faces', 'gi-drapeau', 'gi-rebond', 'gi-champ', 'gi-lumiere', 'gi-face-directe', 'gi-occ', 'gi-alb', 'gi-paliers', 'gi-arbres', 'gi-mn']) {
      if (this.scene.textures.exists(k)) this.scene.textures.remove(k)
    }
    this.occ = null
    this.alb = null
    this.mn = null
    this.mnOctets = null
    this.mnAlpha = null
    this.occOctets = null
    this.albOctets = null
    this.paliers = null
    this.paliersOctets = null
    this.arbres = null
    this.arbresOctets = null
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
  lire(cible: 'direct' | 'champ' | 'gi-faces' | 'gi-drapeau' | 'gi-rebond' | 'gi-lumiere' | 'gi-face-directe'): Uint8Array {
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

  /**
   * LE POINT DE SYNCHRONISATION (LG-A14) — UN texel de la dernière cible bâtie, relu par `readPixels`.
   * `renderImmediate` ne fait que SOUMETTRE (mesuré le 17/09 : 1,7 ms de soumission pour 487 ms
   * d'exécution) ; seule une relecture attend que le GPU ait tout exécuté — dans l'ordre, donc les
   * passes d'avant aussi — et `gl.finish()` n'attend rien sous SwiftShader (spec LG-A14). Le banc de
   * l'Atelier chronomètre `update` PUIS ceci, et compte l'ensemble comme le coût d'une image.
   * `false` : aucune passe bâtie, rien à attendre.
   */
  synchroniser(): boolean {
    const sh = this.passes[this.passes.length - 1]
    if (!sh || !sh.drawingContext) return false
    const r = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer
    const gl = r.gl
    r.glWrapper.updateBindingsFramebuffer({ bindings: { framebuffer: sh.drawingContext.framebuffer } })
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.texelDeSynchro)
    return true
  }
  private readonly texelDeSynchro = new Uint8Array(4)

  /**
   * Oublie l'empreinte de la grille : le prochain `update` la rebâtit (grille + occludeurs) comme à
   * un changement de fenêtre — c'est ainsi que le banc chronomètre CE coût-là (C6, LG-A14), qui ne
   * tombe qu'une image sur les huit tuiles de route de la caméra.
   */
  invaliderLaGrille(): void {
    this.empreinte = ''
  }

  /** La grille de l'image courante (les occludeurs que l'oracle ET la chaîne lisent) — `null` avant la première image. */
  get grilleDuChamp(): GrilleGi | null {
    return this.grille
  }

  /** L'OMBRE PLEINE d'astre de l'image courante, par l'oracle — ce que l'alpha de `gi-direct` porte ; `null` sans astre. */
  ombrePleine(): Float32Array | null {
    return this.grille && this.astre ? ombrePleineDAstre(this.grille, this.astre, this.cartesDOmbre()) : null
  }

  /**
   * Le raster 2× des occludeurs tel que la chaîne le lit (`gi-occ`, RGBA, rangée 0 au NORD) — pour la
   * garde de la passe 0 du banc : chaque sous-texel d'une cellule pleine porte le code de cellule.
   */
  lireOccludeurs(): { readonly w: number; readonly h: number; readonly data: Uint8Array } | null {
    if (!this.occOctets) return null
    return { w: this.gw * 2, h: this.gh * 2, data: this.occOctets }
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

  /**
   * L'OMBRE PLEINE DES MARCHES SEULES (LG-R14, LG-A15), par l'oracle — ni bande ni arbre : ce que la
   * falaise, et elle seule, jette sur le sol plus bas. `null` sans astre. La garde smoke `gi-marche`
   * s'en sert pour DIRE quel texel doit son ombre à la marche (la prémisse), et vérifie la règle sur
   * l'alpha de `gi-direct` depuis la carte, pas depuis l'oracle.
   */
  ombreDesMarchesSeules(): Float32Array | null {
    if (!this.grille || !this.astre) return null
    const s = new Float32Array(this.grille.gw * this.grille.gh)
    ombreDesMarches(this.grille, s, this.astre)
    return s
  }

  /** Les cartes des arbres projetées à cette image (LG-R8) — la prémisse de la garde du masque. */
  get cartesProjetees(): number {
    return this.cartes.length
  }

  /** Les cibles `direct` et `champ` contre l'oracle, en niveaux. À appeler APRÈS un `update`. */
  /**
   * L'ÉPREUVE DES HAUTEURS (LG-R9, garde smoke `gi`) — le monde généré ne dresse que des murs : à une
   * seule hauteur de bande, le GPU et l'oracle s'accorderaient même en ignorant la hauteur (MESURÉ le
   * 2026-09-18 : 60 bandes chargées, toutes `wall`). On REJOUE donc le champ avec une bande sur deux
   * abaissée à `hauteur` texels (une palissade : 6) dans la grille que LES DEUX lisent — le raster
   * d'occludeurs est réécrit, la prochaine image rend, et `verifier()` compare comme d'habitude.
   * `null` rend la grille au monde : l'empreinte s'efface et la prochaine image la relit dans la sim.
   * Une épreuve, pas un réglage : rien ici n'entre dans le rendu joué.
   */
  eprouverLesHauteurs(hauteur: number | null): void {
    if (hauteur === null) {
      this.grilleAvantEpreuve = null
      this.empreinte = ''
      return
    }
    // L'épreuve se rejoue depuis la grille du MONDE, jamais depuis une épreuve précédente — et cette
    // grille-là reste lisible à `verifier()` (`ombresSansEpreuve`) tant que l'épreuve dure.
    const g = this.grilleAvantEpreuve ?? this.grille
    if (!g) return
    this.grilleAvantEpreuve = g
    this.grille = { ...g, murs: g.murs.map((m, i) => (i % 2 === 1 ? { ...m, hauteur } : m)) }
    this.ecrireOccludeurs(this.grille)
  }

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
      // Dans un creux, le plancher est `gi-mn` (par texel) et non `uMn` : `composerM` ne le lit pas —
      // et il n'y a pas d'astre (`uA` = 0), la garde y est vide de toute façon.
      if (lu.length === 0 || !s || this.uA <= 0 || this.uMnMode > 0) return vide
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
    const marches = this.ombreDesMarchesSeules()
    let marchesOmbrees = 0
    if (marches) for (let k = 0; k < g.gw * g.gh; k++) if (g.occ[k] !== 1 && marches[k]! > 0) marchesOmbrees++
    // L'« avant » de l'épreuve des hauteurs, sous l'astre de CETTE image (la grille du monde n'a que
    // ses bandes de plus : même `occ`, mêmes marches, mêmes cartes).
    let ombresSansEpreuve: number | null = null
    if (this.grilleAvantEpreuve && this.astre) {
      const s = ombrePleineDAstre(this.grilleAvantEpreuve, this.astre, this.cartesDOmbre())
      ombresSansEpreuve = 0
      for (let k = 0; k < g.gw * g.gh; k++) if (g.occ[k] !== 1 && Math.round(s[k]! * 255) > 0) ombresSansEpreuve++
    }
    return {
      fenetre: this.fenetre,
      gw: this.gw,
      gh: this.gh,
      sources: this.emetteurs.length,
      bandes: g.murs.length,
      hauteursDeBande: new Set(g.murs.map((m) => m.hauteur)).size,
      cartes: this.cartes.length,
      paliers: g.marches ? new Set(g.marches.paliers).size : 1,
      marchesOmbrees,
      ombresSansEpreuve,
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
    this.occOctets = new Uint8Array(gw * 2 * gh * 2 * 4)
    this.albOctets = new Uint8Array(gw * 2 * gh * 2 * 4)
    this.paliersOctets = new Uint8Array(gw * gh * 4)
    this.occ = tex.addUint8Array('gi-occ', this.occOctets, gw * 2, gh * 2)
    this.alb = tex.addUint8Array('gi-alb', this.albOctets, gw * 2, gh * 2)
    // Les marches (LG-R14), au grain : une tuile porte un seul palier, le raster 2× n'y ajouterait rien.
    this.paliers = tex.addUint8Array('gi-paliers', this.paliersOctets, gw, gh)
    // LE PLANCHER D'UN CREUX (LG-R3, LG-R20), au grain, alpha 255 : Mn y est déjà COMPOSÉ sur le CPU
    // (le noir × son alpha + (1 − alpha), la nuit du dehors dans les trouées), la somme le lit tel quel.
    this.mnOctets = new Uint8Array(gw * gh * 4)
    new Uint32Array(this.mnOctets.buffer).fill(0xffffffff)
    this.mnAlpha = new Float32Array(gw * gh)
    this.mn = tex.addUint8Array('gi-mn', this.mnOctets, gw, gh)
    // NEAREST une fois pour toutes (LG-R2) : `setFilter` téléverse la texture entière (Phaser 4.2,
    // `setTextureFilter` → `update`), et `TextureSource.update()` garde ensuite le filtre du wrapper —
    // le remettre à chaque écriture doublait l'upload du changement de fenêtre.
    this.occ?.setFilter(NEAREST)
    this.alb?.setFilter(NEAREST)
    this.paliers?.setFilter(NEAREST)
    this.mn?.setFilter(NEAREST)
    // LA CIBLE DES CARTES (LG-R8), au grain — bâtie AVANT la passe 1, qui la lie par sa clé. Des octets
    // comme `gi-occ` : l'oracle la rastérise, `ecrireLesCartes` l'écrit en place et la téléverse.
    // Née à zéro et téléversée telle quelle (`createUint8ArrayTexture`) : la cible est vide.
    this.arbresOctets = new Uint8Array(gw * gh * 4)
    this.arbres = tex.addUint8Array('gi-arbres', this.arbresOctets, gw, gh)
    this.arbres?.setFilter(NEAREST)
    this.arbresVides = true
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
      this.direct = mk('gi-direct', FRAG_DIRECT, gw, gh, ['gi-occ', 'gi-arbres', 'gi-paliers'], 'gi-direct', () => ({
        uOcc: 0, uArbres: 1, uPaliers: 2, uSrc: this.uSrc, uSrcZ: this.uSrcZ, uSrcRgb: this.uSrcRgb, uSrcJour: this.uSrcJour, uNb: this.uNb,
        uMotif: this.uMotif, uTailleSource: GI.TAILLE_SOURCE, uPic: HOLE_ERASE_PEAK,
        uPasMax: this.uPasMaxDirect,
        uOmbre: this.uOmbre, uPasOmbre: this.uPasOmbre, uHauteurMarche: this.hauteurMarche,
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
      mk('gi-rebond', FRAG_REBOND, gw, gh, ['gi-occ', 'gi-faces', 'gi-drapeau', 'gi-paliers'], 'gi-rebond', () => ({
        uOcc: 0, uFaces: 1, uDrapeau: 2, uPaliers: 3, uGain: GI.REBOND, uPortee: GI.PORTEE_REBOND, uNb: this.uNb,
        // Un rayon de rebond ne dépasse jamais `uPortee` texels : quatre pas de raster par texel
        // sur les deux axes, plus la marge d'entrée. 50 pas au lieu de 192.
        uPasMax: 4 * GI.PORTEE_REBOND + 2,
      }))
    } else if (k === 5) {
      this.champ = mk('gi-somme', FRAG_SOMME, gw, gh, ['gi-occ', 'gi-direct', 'gi-rebond', 'gi-drapeau', 'gi-mn'], 'gi-champ', () => ({
        uOcc: 0, uDirect: 1, uRebond: 2, uDrapeau: 3, uMnTex: 4, uPlafond: GI.PLAFOND_REBOND, uMn: this.uMn,
        uMnMode: this.uMnMode,
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

  /**
   * ═══ LE PLANCHER D'UN CREUX, PEINT AU GRAIN (LG-R3, LG-R20) ═══
   *
   * Ce que `CaveVeil.update` peignait à l'écran, mot pour mot, mais dans la grille : le noir OPAQUE
   * (ou à `alphaVoile` sans joueur), les trouées du masque où le dehors garde SA nuit, puis le PRÈS qui
   * ouvre le noir à `1 − alphaVoile` autour du corps et le SOUFFLE (`SOI_PIC`) — deux effacements, avec
   * les MÊMES brosses (`render/cave-brosses.ts`, une cellule par texel, NEAREST : la brosse à l'écran
   * se dessinait à 4 px monde la cellule, soit un texel). Les lumières ne sont PLUS effacées ici :
   * le jour, la torche, le bivouac sont des émetteurs du champ, et c'est la loi LG-R5 qui les compose.
   *
   * Un effacement est `alpha ×= 1 − brosse` (le mode ERASE du voile : dst × (1 − src.a)) ; Mn en sort
   * COMPOSÉ comme le MULTIPLY d'une couleur `noir` à cet alpha : `noir × alpha + (1 − alpha)`.
   */
  private peindreLePlancherDuCreux(c: CreuxGi): void {
    if (!this.mn || !this.mnOctets || !this.mnAlpha) return
    const gw = this.gw
    const gh = this.gh
    const A = this.mnAlpha
    A.fill(c.joueur ? 1 : c.alphaVoile)
    // LES TROUÉES : là où rien ne surplombe, le voile s'ouvre ENTIÈREMENT — et le dehors garde sa
    // nuit, peinte à la place (le voile de nuit se tait quand le champ compose).
    const T = LUMIERE.TEXELS_PAR_TUILE
    for (let i = 0; i < c.nTrouees; i++) {
      const t = c.trouees[i]!
      const j0 = t.r * T - this.oy
      const i0 = t.a * T - this.ox
      const i1 = (t.b + 1) * T - this.ox
      for (let j = Math.max(0, j0); j < Math.min(gh, j0 + T); j++) {
        for (let k = Math.max(0, i0); k < Math.min(gw, i1); k++) A[j * gw + k] = -1
      }
    }
    const effacer = (b: { readonly side: number; readonly alpha: Float32Array }, wx: number, wy: number, force: number): void => {
      if (force <= 0.002) return
      const f = Math.min(1, force)
      const cells = (b.side - 1) / 2
      // Le centre de la brosse en texels de grille (continu) ; la cellule `i` couvre
      // [cx − side/2 + i, +1) — un texel prend la cellule qui contient son centre (NEAREST).
      const cx = wx / PX_PAR_TEXEL - this.ox
      const cy = wy / PX_PAR_TEXEL - this.oy
      const k0 = Math.max(0, Math.floor(cx - cells - 0.5))
      const k1 = Math.min(gw - 1, Math.ceil(cx + cells + 0.5))
      const j0 = Math.max(0, Math.floor(cy - cells - 0.5))
      const j1 = Math.min(gh - 1, Math.ceil(cy + cells + 0.5))
      for (let j = j0; j <= j1; j++) {
        const bj = Math.floor(j + 0.5 - (cy - b.side / 2))
        if (bj < 0 || bj >= b.side) continue
        for (let k = k0; k <= k1; k++) {
          const bi = Math.floor(k + 0.5 - (cx - b.side / 2))
          if (bi < 0 || bi >= b.side) continue
          const a = A[j * gw + k]!
          if (a < 0) continue
          A[j * gw + k] = a * (1 - f * b.alpha[bj * b.side + bi]!)
        }
      }
    }
    if (c.joueur) {
      effacer(c.pres, c.joueur.x, c.joueur.y, 1 - c.alphaVoile)
      effacer(c.soi, c.joueur.x, c.joueur.y, c.soi.pic)
    }
    const O = this.mnOctets
    const nr = (c.noir >> 16) & 0xff
    const ng = (c.noir >> 8) & 0xff
    const nb = c.noir & 0xff
    const tr = Math.round(Math.min(1, c.nuit[0]) * 255)
    const tg = Math.round(Math.min(1, c.nuit[1]) * 255)
    const tb = Math.round(Math.min(1, c.nuit[2]) * 255)
    for (let k = 0; k < gw * gh; k++) {
      const a = A[k]!
      if (a < 0) {
        O[k * 4] = tr
        O[k * 4 + 1] = tg
        O[k * 4 + 2] = tb
      } else {
        const u = 1 - a
        O[k * 4] = Math.round(nr * a + 255 * u)
        O[k * 4 + 1] = Math.round(ng * a + 255 * u)
        O[k * 4 + 2] = Math.round(nb * a + 255 * u)
      }
      O[k * 4 + 3] = 255
    }
    this.mn.source[0]?.update()
  }

  /** Les deux textures-canvas au double du grain, depuis la grille de la sim. */
  private ecrireOccludeurs(g: GrilleGi): void {
    if (!this.occ || !this.alb || !this.occOctets || !this.albOctets || !this.paliers || !this.paliersOctets) return
    const w2 = g.gw * 2
    const h2 = g.gh * 2
    const O = this.occOctets
    const A = this.albOctets
    // Tout à zéro, alpha à 255 — quatre octets d'un coup (petit-boutiste : l'alpha est l'octet haut).
    new Uint32Array(O.buffer).fill(0xff000000)
    new Uint32Array(A.buffer).fill(0xff000000)
    // LES MARCHES (LG-R14) : R = le palier, G = 255 sur une porte, alpha 255 — l'upload prémultiplie
    // par l'alpha (`createUint8ArrayTexture`, pma = true), un alpha plein laisse les canaux intacts.
    const M = this.paliersOctets
    new Uint32Array(M.buffer).fill(0xff000000)
    if (g.marches) {
      for (let k = 0; k < g.gw * g.gh; k++) {
        M[k * 4] = g.marches.paliers[k]!
        M[k * 4 + 1] = g.marches.portes[k] === 1 ? 255 : 0
      }
    }
    this.paliers.source[0]?.update()
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
    // LA HAUTEUR DE CHAQUE BANDE (LG-R9) va dans le canal BLEU, en huitièmes de texel (un mur de 8
    // texels : 64 ; une palissade de 6 : 48) ; là où deux bandes se recouvrent, la plus haute l'emporte —
    // l'union de leurs ombres est celle de la plus haute sur le sous-texel partagé. Le rayon d'ombre
    // marche à la hauteur de la PLUS HAUTE bande du champ (`hauteurMarche`) et compare son paramètre
    // d'entrée à la part de la bande rencontrée (`hauteurRel`) : une bande de 6 sur 8 n'ombre que les
    // trois quarts de la marche.
    this.hauteurMarche = GI.ASTRE.HAUTEUR_MUR_PX / PX_PAR_TEXEL
    for (const m of g.murs) if (m.hauteur > this.hauteurMarche) this.hauteurMarche = m.hauteur
    // …ET LA PLUS HAUTE MARCHE du champ (LG-R14) : elle lance comme un mur de sa hauteur, le rayon
    // d'ombre doit aller jusque-là, et chaque marche ne compte que jusqu'à sa part (`ombreDAstre`).
    const hMarches = hauteurDesMarches(g)
    if (hMarches > this.hauteurMarche) this.hauteurMarche = hMarches
    g.murs.forEach((m, im) => {
      const ia2 = indexAlb(g.albedoMurs[im] ?? ALBEDO.BATI_DEFAUT)
      const h8 = Math.min(255, Math.max(0, Math.round(m.hauteur * 8)))
      const x0 = Math.max(0, Math.round(m.x0 * 2))
      const x1 = Math.min(w2, Math.round(m.x1 * 2))
      const y0 = Math.max(0, Math.round(m.y0 * 2))
      const y1 = Math.min(h2, Math.round(m.y1 * 2))
      for (let j2 = y0; j2 < y1; j2++)
        for (let i2 = x0; i2 < x1; i2++) {
          const q = (j2 * w2 + i2) * 4
          const code = O[q]! / 40
          const cellule = code === CODE_CELLULE || code === CODE_CELLULE + CODE_BANDE
          const dejaBande = code === CODE_BANDE || code === CODE_CELLULE + CODE_BANDE
          O[q] = (cellule ? CODE_CELLULE + CODE_BANDE : CODE_BANDE) * 40
          O[q + 1] = ia2 * 32
          O[q + 2] = dejaBande ? Math.max(O[q + 2]!, h8) : h8
        }
    })
    // Le téléversement, depuis les octets mêmes — le filtre NEAREST posé à la naissance (`batir`) tient.
    this.occ.source[0]?.update()
    this.alb.source[0]?.update()
  }
}
