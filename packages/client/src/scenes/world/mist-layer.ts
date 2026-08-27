/**
 * LA BRUME — un shader de NAPPES porté par une MARÉE (V1 « la marée de l'aube »,
 * choisie par Alexis le 2026-07-26 parmi trois variantes documentées).
 *
 * Le retour qui a tout réécrit : « toute blanche, elle ne progresse pas depuis l'eau vers le
 * rivage, frontière dure et droite autour de l'eau. » Le diagnostic (MESURÉ) : l'ancienne
 * assise ne connaissait que le bord du masque dilaté — jamais la distance à l'EAU — et posait
 * 98 % des cellules au-dessus du seuil : un drap laiteux uniforme, coupé au couteau.
 *
 * LA RECETTE NOUVELLE :
 *   • le masque porte un CHAMP DE DISTANCE À L'EAU (canal R, en quinzièmes de tuile, bâti au
 *     boot par l'appelant — le geste du champ de cendre : calculé une fois, jamais rangé).
 *     UNE lecture de texture par fragment, là où l'assise en sondait TREIZE ;
 *   • `uFront` est la MARÉE : la couverture est une rampe de ~2,5 tuiles derrière le front
 *     (`frontDeBrume(hour)` — fonction pure, testée), trouée par le bruit. L'eau elle-même
 *     fume tant que le front vit ;
 *   • `uFrange` FROISSE cette frontière (Alexis, 2026-08-22). Ce module a longtemps promis que
 *     le bord « épouse chaque méandre, jamais une droite » : c'était FAUX, et mesurable. Le
 *     front est une iso-distance de la berge — là où la berge est droite (la rivière du Gué),
 *     il l'était aussi, à 0 px de déviation sur 248 lignes. On déforme donc le DOMAINE avant
 *     d'y lire la distance : deux octaves, des lobes lents et une frange rapide, portés par le
 *     vent. Le champ de distance n'est pas touché — la carte reste juste ;
 *   • DEUX couches de bruit-valeur dérivent au vent (et sa perpendiculaire — la parallaxe
 *     interne fait le VOLUME), champ POSTÉRISÉ en crans francs : trous, corps, crêtes claires.
 *     Les seuils sont CALIBRÉS SUR LA MAQUETTE validée à l'œil (l'artefact aux 3 variantes) ;
 *   • le hash est un POLYNÔME DE PERMUTATION (34x²+x mod 289) — pas de `fract(sin·43758)` :
 *     c'était le seul risque réel de divergence SwiftShader/GPU identifié (range-reduction du
 *     sin sur de grands arguments). Le temps est replié CPU-côté pour la même raison ;
 *   • tout se décide par cellule de 4 px monde (le grain de l'art), masque NEAREST ;
 *   • sortie PRÉMULTIPLIÉE — le contrat du pipeline, PROUVÉ dans la source de Phaser 4.2.0
 *     (blend NORMAL = ONE, ONE_MINUS_SRC_ALPHA — du fixed-function, identique sur tout GPU).
 *
 * Deux consommatrices : la BRUME DU MATIN (champ = distance aux eaux/marais, front = la marée
 * horaire) et la COMBE BRUMEUSE (champ = distance à son empreinte, front constant — son halo).
 * Elles partagent le shader mais PAS leur opacité : chacune apporte son `ReglageCrans` (le poids
 * des trois paliers et son rail). Le 26/07 la marée du matin a été rendue plus transparente en
 * haut de l'échelle sur retour d'Alexis ; la Combe, dont la brume EST l'identité, garde les
 * valeurs de la maquette. Une constante partagée aurait retouché les deux d'un coup.
 */
import Phaser from 'phaser'
import { TILE_PX, crownDepth } from '../../render/framing'

/** Le canal R du masque encode min(distance, DIST_FIELD_MAX)/DIST_FIELD_MAX — tuiles. */
export const DIST_FIELD_MAX = 15

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uMask;   // R : distance à l'eau (0 = l'eau), en 1/15 de tuile
uniform vec4 uQuad;        // le RECT MONDE de ce quad : origine xy, taille zw, en px
uniform vec2 uMapTiles;
uniform float uTilePx;
uniform vec2 uOff1;        // dérive INTÉGRÉE des nappes (tuiles) — ∫vent·dt côté CPU, replié
uniform vec2 uOff2;        // dérive intégrée des volutes (vent + perpendiculaire), replié
uniform float uDensity;    // 0..1 — l'heure (ou l'identité du lieu) décide
uniform float uFront;      // la MARÉE : tuiles gagnées depuis l'eau (0 = eau seule)
uniform float uDay;        // 0 nuit · 1 plein jour — LA NUIT ASSOMBRIT LA BRUME (revue du 26/07)
uniform vec3 uPoids;       // opacité des trois crans (mince, corps, crête) — PROPRE à chaque brume
uniform float uPlafond;    // plafond d'alpha : un RAIL de sécurité, jamais un plateau actif
// ── LES TROIS BOUTONS DE LA PLANCHE (comparaison du 2026-08-22, demande d'Alexis) ──
uniform float uMode;       // 0 = crans postérisés (rendu d'origine) · 1 = GRADIENT PAR TUILE
uniform float uRelief;     // écartement de l'échelle d'opacité autour de son barreau MÉDIAN (1 = telle quelle)
uniform float uJitter;     // amplitude du décalage PROPRE à chaque tuile (0 = aucun réseau visible)
uniform float uFrange;     // amplitude (tuiles) du FROISSEMENT de la frontière — 0 = iso-distance nue
uniform float uDebug;      // 1 = peindre la COUVERTURE en gris opaque (l'instrument, pas le jeu)
// ── LA BRUME EST UNE NAPPE D'ÉPAISSEUR (2026-08-25) : la pile de bandes, et sa condition. ──
uniform float uBande;      // 0 = un quad plein monde (la Combe) · 1 = une BANDE de la pile
uniform float uPart;       // 0..1 — LA CONDITION du matin (écart jour/nuit × calme), sur l'alpha FINAL

const float GRAIN = 4.0;    // le pixel de l'art : toute la brume se décide par cellule de 4 px
const float DIST_MAX = 15.0;
const float RAMPE = 2.5;    // la rampe du front, en tuiles — plus raide, il redevient une ligne

vec2 texUv(vec2 tile) { return vec2(tile.x / uMapTiles.x, 1.0 - tile.y / uMapTiles.y); }
// Au CENTRE du texel (revue : la première rangée de grain d'une tuile pouvait échantillonner
// le texel voisin en v, selon l'arrondi du GPU) — floor est la sémantique voulue (champ par
// tuile), +0,5 met le sample hors de portée de tout arrondi.
float distEau(vec2 tile) { return texture2D(uMask, texUv(floor(tile) + 0.5)).r * DIST_MAX; }

/** Hash SANS sinus : polynôme de permutation (34x²+x mod 289), domaine replié — le même
 *  résultat sur tout GPU, là où fract(sin·43758) divergeait selon la range-reduction.
 *  TROIS étages croisés (revue, MESURÉ) : à deux, 34 ≡ 0 (mod 17) rend le champ exactement
 *  invariant sous (+17, −17) cellules — le même archipel dupliqué en anti-diagonale toutes
 *  les 39 tuiles ; le troisième étage, resalé par p.x, brise l'invariance. */
float permute(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float cellHash(vec2 c) {
  vec2 p = mod(c, 289.0);
  return fract(permute(permute(permute(p.x) + p.y) + p.x) / 289.0);
}

/** Bruit-valeur lissé : le CHAMP est continu (les contours des crans glissent sans sauter) ;
 *  c'est la POSTÉRISATION qui rend les marches — même partage des rôles que le clapot. */
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cellHash(i);
  float b = cellHash(i + vec2(1.0, 0.0));
  float c = cellHash(i + vec2(0.0, 1.0));
  float d = cellHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** LE CHAMP BRUT en un point (coordonnées TUILE) — deux couches qui ne vont pas du même pas :
 *  les grosses nappes suivent le vent, lentement ; les volutes fines filent plus vite,
 *  déportées vers la perpendiculaire (la brume roule sur elle-même). Les offsets sont
 *  INTÉGRÉS côté CPU (revue, MESURÉ : uWind·t avec un vent VARIABLE faisait défiler le
 *  champ à w + t·dw/dt — 15× la consigne dès 10 min d'uptime, pire d'heure en heure). */
float champAt(vec2 t) {
  float nappes = vnoise((t + uOff1) / 5.5);
  float volutes = vnoise((t + uOff2 + vec2(17.3, 9.1)) / 2.3);
  return nappes * 0.62 + volutes * 0.38;
}

/** LA VALEUR D'UNE TUILE : le champ pris à son CENTRE, plus son décalage propre ('uJitter').
 *  Le décalage est VERROUILLÉ AU MONDE, pas à la nappe : le manteau est fait des tuiles du
 *  terrain, la densité glisse dessous — c'est la demande (« des carrés, comme les tuiles »). */
float valTuile(vec2 i) {
  return champAt(i + 0.5) + (cellHash(i) - 0.5) * uJitter;
}

/** LE GRADIENT PAR TUILE : une valeur par tuile, rampée LINÉAIREMENT vers ses quatre voisines.
 *  Linéaire et NON lissée — c'est tout le point : la dérivée casse au bord de la tuile, donc
 *  le réseau se devine, mais l'intérieur est une pente et non un aplat. Une 'smoothstep' ici
 *  effacerait justement l'arête qu'on cherche à garder. */
float champTuile(vec2 t) {
  vec2 p = t - 0.5;              // coordonnées entières = CENTRES de tuiles
  vec2 i = floor(p);
  vec2 f = p - i;                // pas de f*f*(3-2f) : la rampe est LINÉAIRE
  float a = valTuile(i);
  float b = valTuile(i + vec2(1.0, 0.0));
  float c = valTuile(i + vec2(0.0, 1.0));
  float e = valTuile(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}

void main() {
  // Le monde à l'endroit (V texture monte, ty descend). Le grain dépend du MODE : cellules de
  // 4 px (le pixel de l'art) pour les crans, coordonnée pleine pour le gradient par tuile —
  // c'est 'champTuile' qui y porte alors la structure, et elle la porte à la TUILE.
  // Le quad n'est plus forcément le monde entier : depuis la pile de bandes, il porte SON rect
  // monde ('uQuad'). Plein monde, 'uQuad = (0, 0, worldW, worldH)' — l'expression d'avant, au
  // bit près.
  vec2 worldPx = uQuad.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uQuad.zw;
  vec2 tileBrut = worldPx / uTilePx;
  vec2 tile = floor(worldPx / GRAIN) * GRAIN / uTilePx;

  if (uDensity <= 0.003) discard;

  // LA MARÉE : couverture = rampe derrière le front. L'eau (dist < 0,5) garde un plancher —
  // elle fume du premier au dernier instant de la fenêtre, c'est la SOURCE, visible comme telle.
  // 'distEau' planche déjà à la tuile : la marée est la MÊME dans les deux modes, et c'est
  // voulu — la planche ne compare que la TEXTURE de la nappe, pas sa géographie.
  float dist = distEau(tileBrut);
  // LA FRONTIÈRE SE FROISSE (demande d'Alexis, 2026-08-22 : « une frontière plus organique, pas
  // simplement droite »). Le front est une ISO-DISTANCE de la berge : là où la berge est droite
  // — une rivière rectiligne, le Gué — il est droit lui aussi, et ça se lit comme une coupure au
  // cordeau. On ne touche PAS le champ de distance : on déforme le DOMAINE avant de le lire.
  // La distance PERÇUE gagne deux octaves, une lente qui creuse de grands lobes (des langues de
  // brume qui poussent plus loin par endroits) et une rapide qui frange le bord tuile à tuile.
  // Les deux dérivent au vent : la frontière RESPIRE au lieu de rester posée.
  float distV = dist;
  if (uFrange > 0.001) {
    distV += (vnoise((tileBrut + uOff1) / 9.0) - 0.5) * 2.0 * uFrange
           + (vnoise((tileBrut + uOff2 + vec2(41.7, 23.9)) / 3.2) - 0.5) * uFrange * 0.7;
  }
  float couv = clamp((uFront - distV) / RAMPE, 0.0, 1.0);
  // Le plancher de l'EAU se lit sur la distance VRAIE : la source fume toujours, quoi que le
  // froissement raconte au-dessus d'elle — un lobe ne doit jamais assécher la rivière.
  couv = min(1.0, couv + (1.0 - step(0.5, dist)) * 0.35);
  // L'INSTRUMENT : la couverture peinte telle quelle, opaque. Sur une capture de jeu, le bord de
  // la brume se confond avec les lisières du terrain, et un différentiel post-hoc vaut
  // α·(brume − sol) — donc il montre l'ALBÉDO du sol autant que la nappe (mesuré : les arbres et
  // le sable ressortaient plus que la frontière). Ici, la frontière est nue.
  if (uDebug > 0.5) {
    gl_FragColor = vec4(vec3(couv), 1.0);
    return;
  }
  float d = uDensity * couv;
  if (d <= 0.008) discard;

  // Le champ : cellules de 4 px en mode CRANS, une valeur par tuile rampée en mode GRADIENT.
  float champ = uMode < 0.5 ? champAt(tile) : champTuile(tileBrut);

  // LES CRANS — coefficients de la MAQUETTE validée : la densité de la marée OUVRE les
  // plaques (min(1, d·2,6)·0,55), le champ les DÉCOUPE (·0,65). Vers le front, d chute →
  // seules les cellules de champ fort survivent : le bord s'effrange plaque à plaque.
  float v = champ * 0.65 + min(1.0, d * 2.6) * 0.55 - 0.28;
  // LA COUVERTURE EST LA MÊME DANS LES DEUX MODES, et il le faut : la postérisation arrondit
  // ('floor(v·4+0,5)/4 ≥ 0,25' ⇔ 'v ≥ 0,125'), donc couper le gradient à 'v < 0,25' lui aurait
  // retiré toute la frange mince — on aurait comparé deux SURFACES, pas deux textures.
  if (v < 0.125) discard;

  float poids;
  float lum;
  if (uMode < 0.5) {
    float lvl = floor(v * 4.0 + 0.5) / 4.0;
    float crete = step(0.72, lvl);
    float corps = step(0.48, lvl) * (1.0 - crete);
    float mince = 1.0 - corps - crete;
    poids = uPoids.x * mince + uPoids.y * corps + uPoids.z * crete;
    lum = 0.93 + 0.07 * corps + 0.19 * crete;
  } else {
    // LES MÊMES TROIS BARREAUX, parcourus en CONTINU : les centres des trois bandes de la
    // postérisation tombent sur v = 0,25 / 0,50 / 0,75 — on interpole entre eux. Le gradient
    // REMPLIT donc l'intervalle d'opacité, il ne l'élargit pas : ça, c'est 'uRelief', et lui seul.
    float t = clamp((v - 0.25) / 0.5, 0.0, 1.0);
    poids = t < 0.5 ? mix(uPoids.x, uPoids.y, t * 2.0) : mix(uPoids.y, uPoids.z, t * 2.0 - 1.0);
    lum = t < 0.5 ? mix(0.93, 1.0, t * 2.0) : mix(1.0, 1.12, t * 2.0 - 1.0);
  }
  // LE RELIEF — l'écartement de l'échelle autour de son barreau MÉDIAN. 1 = l'échelle mesurée
  // en juillet, intacte. Au-delà, le mince s'efface et la crête blanchit : c'est exactement
  // l'arbitrage « gradient lisible ↔ transparence maximale », et il ne se tranche qu'à l'œil.
  poids = max(0.0, uPoids.y + (poids - uPoids.y) * uRelief);

  vec3 teinte = vec3(0.84, 0.87, 0.91) * lum;
  // LA NUIT L'ASSOMBRIT ICI — pas par le voile : en mode éclairé (le défaut), le voile descend
  // SOUS les sprites, donc sous la brume. MAIS l'aube éclaire la brume AVANT le sol (le ciel
  // l'allume par au-dessus) : l'éclat suit la RACINE du jour — mesuré à 6h12 : la version
  // linéaire (mix dès uDay=0,2) rendait la marée iso-luminante avec le sol de l'aube, delta
  // ~13 niveaux RGB, invisible à l'œil dans SA propre fenêtre. Le plancher nocturne reste
  // bleuté et au-dessus du noir pour que la Combe demeure une présence à 23h, pas un amer.
  float eclat = sqrt(clamp(uDay, 0.0, 1.0));
  teinte *= mix(vec3(0.42, 0.46, 0.60), vec3(1.0), eclat);
  // L'OPACITÉ DES CRANS EST PROPRE À CHAQUE BRUME (uPoids) : la marée du matin a la sienne,
  // plus transparente en haut de l'échelle (retour d'Alexis du 26/07) ; la Combe garde la
  // sienne — son halo permanent est SON identité, on ne la retouche pas par ricochet.
  // GARDE-FOU (revue, MESURÉ) : le plafond doit rester AU-DESSUS du pic (d_max·2,2·uPoids.z),
  // sinon corps et crête s'y écrasent ensemble — les crans fusionnent et le drap uniforme
  // (« toute blanche ») revient en silence. Chaque appelant justifie son couple (poids, plafond).
  float a = min(uPlafond, d * 2.2 * poids);
  // ── LA CONDITION DU MATIN S'APPLIQUE ICI, SUR L'ALPHA FINAL, ET PAS SUR 'uDensity' ──
  // Baisser 'uDensity' aurait été le geste évident, et il est FAUX : 'd' entre dans 'v' par
  // 'min(1, d·2,6)·0,55', donc il ne fait pas que pâlir la nappe — il l'ÉVIDE. MESURÉ sur la
  // formule : à part 0,4, 'v' plafonne à 0,587, le cran de CRÊTE (0,72) n'est jamais atteint
  // et 29 % du champ passe sous le 'discard' — on n'aurait pas une brume plus légère, on
  // aurait une AUTRE brume, avec sa frange mangée et sa calibration ('CRANS_MAREE', mesurée
  // au smoke 'blancheur') hors de ses gonds. Multiplier APRÈS le rail préserve les trois
  // crans et leurs écarts : la nappe pâlit sans changer de texture, et « on disperse
  // proprement » veut dire exactement ça.
  a *= clamp(uPart, 0.0, 1.0);
  // ── L'ÉCUME DE LA PILE (patron 'meteo-layer.ts', même raison, même preuve) ──
  // Les bandes se chevauchent de moitié et chacune porte une rampe TRIANGULAIRE (nulle à ses
  // bords, pleine au milieu). Deux triangles décalés d'une demi-longueur SOMMENT À UNE
  // CONSTANTE (fenêtre de Bartlett), donc le SOL — couvert par deux bandes en tout point —
  // garde une opacité rigoureusement uniforme, tandis que le haut d'une cime émergée, couvert
  // par UNE seule bande, reçoit la rampe nue et se fond sur 'bandePx' pixels. On compose en
  // TRANSMITTANCE (jamais en alpha) : c'est la seule composition où deux couches empilées
  // rendent exactement 'a' — additionner ferait lire le chevauchement en rayures.
  if (uBande > 0.5) {
    float pv = clamp((worldPx.y - uQuad.y) / max(1.0, uQuad.w), 0.0, 1.0);
    float ecume = 1.0 - abs(2.0 * pv - 1.0);
    a = 1.0 - pow(1.0 - clamp(a, 0.0, 1.0), ecume);
  }
  // PRÉMULTIPLIÉ — le contrat du pipeline Phaser (prouvé dans la source : le blend NORMAL
  // du Shader GO est ONE, ONE_MINUS_SRC_ALPHA). Non prémultiplié = le mur blanc d'origine.
  gl_FragColor = vec4(teinte * a, a);
}
`

/** Périodes de repli des offsets, en TUILES : le bruit est périodique 289 cellules par axe,
 *  et une cellule vaut 5,5 (nappes) ou 2,3 (volutes) tuiles — le repli est SANS couture. */
const PERIODE_NAPPES = 289 * 5.5
const PERIODE_VOLUTES = 289 * 2.3

/** Le réglage d'OPACITÉ d'une brume : ce que pèsent ses trois crans, et son rail. Les valeurs
 *  par défaut sont celles de la maquette validée à l'œil — la Combe brumeuse les garde. */
export interface ReglageCrans {
  /** Opacité relative des crans (mince, corps, crête) — ordre croissant obligatoire : c'est
   *  l'écart entre les paliers qui fait lire le VOLUME. Deux crans au même poids = un drap. */
  poids: [number, number, number]
  /** Rail d'alpha. À tenir AU-DESSUS de densité_max·2,2·poids[2] : un plafond qui mord est
   *  un plateau, et un plateau écrase corps et crête l'un sur l'autre. */
  plafond: number
}

const CRANS_MAQUETTE: ReglageCrans = { poids: [0.34, 0.66, 0.9], plafond: 0.72 }

/**
 * ═══ LA NAPPE : CE QUI DONNE UNE ÉPAISSEUR À LA BRUME (2026-08-25) ═══
 *
 * Une brume peinte sur UN quad ne peut être qu'AU-DESSUS ou AU-DESSOUS de ce qu'elle traverse :
 * au-dessus, elle coiffe le monde comme un film (c'est ce que la marée du matin faisait depuis
 * juillet) ; au-dessous, elle laisse tous les sprites ENTIERS. Ni l'un ni l'autre n'est du
 * brouillard. Pour qu'un arbre soit **dedans** et non **dessus**, il faut couper les silhouettes
 * à une HAUTEUR — et le tri Y sait déjà le faire, exactement :
 *
 *   Un sprite dont les pieds sont à la ligne monde `F` peint les lignes `[F − haut, F]`, donc
 *   son pixel de la ligne `r` est à la hauteur `F − r` au-dessus du sol. Une bande qui couvre
 *   la ligne `r`, dessinée à la profondeur d'un sprite dont les pieds seraient `H` plus bas,
 *   recouvre exactement les sprites tels que `F ≤ r + H` — c'est-à-dire exactement les pixels
 *   dont la hauteur ne dépasse pas `H`. Empiler ces bandes, c'est une nappe d'épaisseur `H`.
 *
 * La pile vit dans la bande des HOUPPIERS (`crownDepth`), pas dans la bande de tri Y : un arbre
 * est peint en deux sprites, le fût dans le tri Y et la cime à `CROWN_BASE` (900 000, au-dessus
 * de tous les acteurs). Une nappe glissée sous les acteurs ne mordrait donc JAMAIS une cime —
 * la mesure du scénario `brouillardsol` l'avait relevé sur le brouillard météo : coupe à 20 px
 * au lieu de 51,3, soit pile la hauteur où le fût cède la place au houppier.
 *
 * ⚠ CE QUE ÇA EMPORTE, et c'est la même exclusion mutuelle que pour le brouillard météo : une
 * bande recouvre TOUT ce qui passe sous elle — fûts, acteurs, murs, et les TOITS
 * (`ROOF_DEPTH` = 800 000, sous les houppiers), qui sont donc avalés entiers. Avec un algorithme
 * du peintre, on ne peut donner une hauteur qu'à UNE bande de profondeur à la fois.
 */
export interface ReglageNappe {
  /** L'ÉPAISSEUR de la nappe, en pixels monde — jusqu'où elle mange les silhouettes. */
  hauteur: number
  /** Le PAS de la pile, en pixels monde. Il porte DEUX choses : l'épaisseur du FONDU au bas
   *  d'une cime émergée (le dégradé court sur `bandePx`), et la précision de la coupe (au
   *  `bandePx / 2` près). Les quads font `2 × bandePx` — c'est le chevauchement de moitié que
   *  l'écume exige. */
  bandePx: number
}

/** Plafond du nombre de bandes vivantes — il borne la mémoire ET le coût. Sous ce plafond, un
 *  `bandePx` trop fin ÉLARGIT les bandes au lieu d'en créer mille. */
const BANDES_MAX = 48

/** Départage d'une bande contre un houppier de MÊMES pieds : la bande passe après, donc elle
 *  l'avale. Les houppiers n'ont pas de `TIE_*` — ils ne se trient que sur leurs pieds. */
const TIE_NAPPE = 0.5

/** La profondeur d'une bande AVANT sa première pose : `posterLesBandes` la recalcule à chaque
 *  image, et une bande jamais posée reste invisible. */
const BANDE_DEPTH_INITIALE = 900_000

export class MistLayer {
  /** LU À CHAQUE FRAME, donc réglable À CHAUD : le smoke `blancheur` balaie des candidats sur
   *  une seule scène (même monde, même heure, même caméra) et les MESURE contre le même monde
   *  nu. Un « encore plus transparent » se tranche sur des chiffres, pas sur un souvenir. */
  crans: ReglageCrans
  /** LA PLANCHE DE COMPARAISON (2026-08-22) — relus à chaque frame comme `crans`, donc on pose
   *  plusieurs candidats sur LA MÊME scène. Défauts = le rendu d'origine, au bit près.
   *  `mode` 0 = crans postérisés · 1 = gradient par tuile ; `relief` écarte l'échelle
   *  d'opacité ; `jitter` donne à chaque tuile son décalage propre (le réseau se lit). */
  mode = 0
  relief = 1
  jitter = 0
  frange = 0
  /** Instrument seulement : 1 peint la couverture en gris opaque. Jamais armé en jeu. */
  debug = 0
  /** LA PILE — une entrée par bande en mode nappe, un seul quad plein monde sinon. */
  private shaders: Phaser.GameObjects.Shader[] = []
  /** Le rect MONDE de chaque quad (`uQuad`), muté en place : les fermetures d'uniformes le
   *  lisent à chaque image, comme `crans`. */
  private quads: { x: number; y: number; w: number; h: number }[] = []
  private readonly nappe: ReglageNappe | null
  private bandesVives = 0
  private density = 0
  private part = 1
  private front = 0
  private day = 1
  private wind = { x: 0.28, y: 0.1 }
  /** Dérives INTÉGRÉES (∫vent·dt, en tuiles) — voir la revue du 26/07 : multiplier un vent
   *  VARIABLE par l'uptime faisait défiler le champ de plus en plus vite, sans borne. */
  private off1 = { x: 0, y: 0 }
  private off2 = { x: 0, y: 0 }
  private lastMs: number | null = null

  constructor(
    scene: Phaser.Scene,
    maskKey: string,
    width: number,
    height: number,
    depth: number,
    crans: ReglageCrans = CRANS_MAQUETTE,
    /** Posé → la brume est une NAPPE D'ÉPAISSEUR (pile de bandes dans la bande des houppiers).
     *  Absent → un quad plein monde à `depth`, le rendu d'avant au bit près (la Combe). */
    nappe: ReglageNappe | null = null,
  ) {
    this.crans = crans
    this.nappe = nappe
    const worldW = width * TILE_PX
    const worldH = height * TILE_PX
    const combien = nappe ? BANDES_MAX : 1
    for (let i = 0; i < combien; i++) {
      // Plein monde : le quad EST la carte, donc `uQuad` reproduit l'expression d'avant. En
      // bandes, `posterLesBandes` réécrit ce rect à chaque image.
      this.quads.push(nappe ? { x: 0, y: 0, w: TILE_PX, h: TILE_PX } : { x: 0, y: 0, w: worldW, h: worldH })
      const q = this.quads[i]!
      const sh = scene.add
        .shader(
          {
            name: nappe ? `braises-mist-nappe-${maskKey}` : `braises-mist-${maskKey}`,
            fragmentSource: FRAGMENT,
            setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
              setUniform('uMask', 0)
              setUniform('uQuad', [q.x, q.y, q.w, q.h])
              setUniform('uMapTiles', [width, height])
              setUniform('uTilePx', TILE_PX)
              setUniform('uOff1', [this.off1.x, this.off1.y])
              setUniform('uOff2', [this.off2.x, this.off2.y])
              setUniform('uDensity', this.density)
              setUniform('uFront', this.front)
              setUniform('uDay', this.day)
              setUniform('uPoids', this.crans.poids)
              setUniform('uPlafond', this.crans.plafond)
              setUniform('uMode', this.mode)
              setUniform('uRelief', this.relief)
              setUniform('uJitter', this.jitter)
              setUniform('uFrange', this.frange)
              setUniform('uDebug', this.debug)
              setUniform('uBande', nappe ? 1 : 0)
              setUniform('uPart', this.part)
            },
          },
          q.x,
          q.y,
          q.w,
          q.h,
          [maskKey],
        )
        .setOrigin(0, 0)
        .setDepth(nappe ? BANDE_DEPTH_INITIALE : depth)
      if (nappe) sh.setVisible(false)
      this.shaders.push(sh)
    }
  }

  /** LE QUAD DE TÊTE — ce que les sondes du smoke lisent (`maree`, `blancheur`). En mode
   *  nappe c'est la première bande : sa visibilité est celle de toute la pile. */
  get shader(): Phaser.GameObjects.Shader | null {
    return this.shaders[0] ?? null
  }

  /**
   * LA PILE, POSÉE SUR LA VUE — bandes ANCRÉES AU MONDE (`floor(vue.y / bande) × bande`) et non
   * au bord de la caméra : ancrées à la caméra, elles glisseraient d'un pixel à chaque pas et la
   * hauteur de coupe de chaque arbre TREMBLERAIT pendant qu'on marche.
   */
  private posterLesBandes(camera: Phaser.Cameras.Scene2D.Camera): void {
    const nappe = this.nappe!
    const vue = camera.worldView
    // Le `bandePx` demandé peut être plus fin que ce que le plafond permet : on l'ÉLARGIT
    // alors, plutôt que de tronquer la pile et de laisser le bas de l'écran sans brume.
    const bande = Math.max(nappe.bandePx, Math.ceil(vue.height / (BANDES_MAX - 3)))
    const y0 = Math.floor(vue.y / bande) * bande
    // TROIS BANDES DE MARGE : chaque ligne doit être couverte par DEUX bandes pour que la somme
    // des triangles de l'écume soit constante. Les rangs 0 et n−1 ont leur moitié non appariée
    // hors cadre.
    const n = Math.min(BANDES_MAX, Math.ceil(vue.height / bande) + 3)
    const marge = TILE_PX * 2
    for (let i = 0; i < n; i++) {
      const haut = y0 + (i - 1) * bande
      const q = this.quads[i]!
      q.x = vue.x - marge
      q.y = haut
      q.w = vue.width + marge * 2
      q.h = bande * 2 // le double du pas : c'est ce qui fait le chevauchement de moitié
      const sh = this.shaders[i]!
      sh.setPosition(q.x, q.y).setDisplaySize(q.w, q.h)
      // LA COUPE EST CENTRÉE SUR `hauteur`, PAS POSÉE À SON PIED : le seuil se réfère au QUART
      // haut du quad (`haut + bande / 2`), si bien que le fondu de l'écume court de
      // `hauteur − bandePx / 2` à `hauteur + bandePx / 2` — sa médiane reste `hauteur`.
      const milieu = haut + bande / 2
      sh.setDepth(crownDepth((milieu + nappe.hauteur) / TILE_PX, TILE_PX) + TIE_NAPPE)
      sh.setVisible(true)
    }
    for (let i = n; i < this.bandesVives; i++) this.shaders[i]!.setVisible(false)
    this.bandesVives = n
  }

  private eteindreLesBandes(): void {
    for (let i = 0; i < this.bandesVives; i++) this.shaders[i]!.setVisible(false)
    this.bandesVives = 0
  }

  /** Chaque frame : le vent fait dériver les nappes par INTÉGRATION (off += vent·dt, replié
   *  modulo la période exacte du bruit — sans couture, coordonnées bornées ~1 600 tuiles :
   *  la précision fp32 et le hash tiennent sur une session illimitée), la marée et la
   *  densité viennent de l'appelant, le jour (daylight) décide de la teinte. */
  update(
    nowMs: number,
    density: number,
    front: number,
    wind?: { x: number; y: number },
    day = 1,
    /** LA CONDITION du matin (0..1) — appliquée à l'alpha FINAL par le fragment. */
    part = 1,
    /** Requise en mode NAPPE : la pile se pose sur la vue. */
    camera?: Phaser.Cameras.Scene2D.Camera,
  ): void {
    // dt borné : une frame hoquetée (onglet en arrière-plan) ne téléporte pas le champ.
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000))
    this.lastMs = nowMs
    if (wind) this.wind = wind
    const w = this.wind
    const plie = (v: number, periode: number): number => ((v % periode) + periode) % periode
    this.off1.x = plie(this.off1.x + w.x * 0.55 * dt, PERIODE_NAPPES)
    this.off1.y = plie(this.off1.y + w.y * 0.55 * dt, PERIODE_NAPPES)
    // Les volutes : plus vite que les nappes, déportées vers la perpendiculaire du vent.
    this.off2.x = plie(this.off2.x + (w.x * 1.1 - w.y * 0.7) * dt, PERIODE_VOLUTES)
    this.off2.y = plie(this.off2.y + (w.y * 1.1 + w.x * 0.7) * dt, PERIODE_VOLUTES)
    this.density = density
    this.front = front
    this.day = day
    this.part = part
    // LA CONDITION ÉTEINT LA COUCHE, elle ne la laisse pas tourner à vide : un matin sans brume
    // ne doit pas coûter une passe de fragments pour un alpha nul.
    const vivante = density * part > 0.003
    if (!this.nappe) {
      this.shader?.setVisible(vivante)
      return
    }
    if (vivante && camera) this.posterLesBandes(camera)
    else this.eteindreLesBandes()
  }

  destroy(): void {
    for (const sh of this.shaders) sh.destroy()
    this.shaders = []
    this.quads = []
    this.bandesVives = 0
  }
}

/** LA BRUME COIFFE LE MONDE (retour d'Alexis : « au-dessus du personnage ») : au-dessus des
 *  houppiers, SOUS les oiseaux et le voile de nuit — la nuit l'assombrit comme le reste, et
 *  l'aube bleutée la teinte d'elle-même. Les BANCS voyageurs (V2), eux, vivent dans la bande
 *  des houppiers : c'est leur raison d'être — passer devant un arbre, derrière l'autre. */
export const MIST_DEPTH = 1_020_000
