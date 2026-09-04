/**
 * L'EAU — un vrai shader, sur un quad à l'échelle du monde.
 *
 * Le sol est un maillage dont les sommets sont SOULEVÉS par l'élévation
 * (`screenY = worldY·TILE − elev·H`, voir render/warp.ts). Un shader, lui, part
 * d'un pixel écran et doit retrouver la tuile dont il parle : il DÉFAIT donc le
 * cisaillement, par BISECTION sur `screenY(ty)` — qui est strictement croissant
 * (`assertNoFold`), donc toujours inversible ainsi. Exactement la méthode de
 * `warp.unproject`, celle du picking : le rendu et le picking ne divergent pas.
 *
 * (La première version itérait un point fixe et affirmait qu'il convergeait. C'était
 * FAUX sur les versants : voir la démonstration dans `main()`. L'eau se décollait de
 * ses berges dès qu'on quittait le plat.)
 *
 * Le quad couvre le MONDE ENTIER (pas la vue) : plus rien à repositionner par
 * frame, et le GPU ne colorie de toute façon que les pixels à l'écran. Hors de
 * l'eau, le shader `discard` — on ne paie que la surface mouillée.
 *
 * AUCUNE logique de jeu ici : de l'habillage, et rien d'autre.
 */
import Phaser from 'phaser'
import { eauSouillee, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER, zoneSlugAt, type EtatDeCendre, type WorldMap } from '@ashes/sim'
import { buildFlowField, COURANT_VITESSE, TAPER_RIVE_MAX, TAPER_RIVE_MIN, type FlowField } from '../../render/flow-field'
import { GROUND_MAP_DEPTH, LIFT_TUILES, strateDEtage, TILE_PX } from '../../render/framing'
import type { Relief } from '../../render/relief'
import { sunDirection, moonDirection, clarteDeLune, lueurDeLune, LUNE_PLEINE_JOUR } from '../../render/lighting'
import type { HeureSolaire } from '../../render/lighting'
import { buildFondField, buildRiveField, buildWaterField, MILIEU_VASE, REGIME_LAC_MORT, REGIME_SUIE, type RiveField } from '../../render/water-field'

/** Période du cycle d'advection dual-phase (s). Courte À DESSEIN : sur la rampe du taper
 *  de berge, les deux couches divergent d'au plus 0,25·T·vitesse — à 3 s l'écart (0,41
 *  tuile) reste sous le grain visuel (revue adversariale : à 5 s, la bande de rive
 *  « respirait » en cisaillement). */
const DUAL_T = 3.0

/** Juste au-dessus du sol (−1), sous l'ombre du relief (−0,5) : le versant qui
 *  tombe dans l'eau l'assombrit, comme il assombrit la berge. */
const WATER_DEPTH = GROUND_MAP_DEPTH + 0.25

/** Bornes du taper de berge, INJECTÉES dans le GLSL — la même rampe que
 *  `flow-field.taperRive` côté CPU (les feuilles) : une seule vérité. */
const TAPER_MIN = TAPER_RIVE_MIN.toFixed(2)
const TAPER_MAX = TAPER_RIVE_MAX.toFixed(2)

/** Plafond de foyers reflétés — DOIT égaler le `MAX_FIRES` du shader. */
const MAX_FIRES = 8

/** Plafond d'émetteurs de remous — DOIT égaler le `MAX_WADERS` du shader. 8 marcheurs
 *  (le plafond historique, servi en priorité de vue) + jusqu'à 6 pierres de gué (Alexis,
 *  2026-08-28 : « autour des pierres, le même effet qu'autour du joueur dans l'eau »). */
const MAX_WADERS = 14

/** Un acteur qui marche dans le haut-fond : il émet des anneaux (spec da-feeling R11). */
export interface WaterWader {
  /** Position, en TUILES. */
  x: number
  y: number
  /** Décalage de phase (s) : les anneaux de deux marcheurs ne battent pas ensemble. */
  phase: number
  /** Force 0..1 — pleine en marche, s'éteint en ~0,7 s après l'arrêt. */
  strength: number
  /** Cap de marche NORMALISÉ (spec eau-vivante R6) — {0,0} à l'arrêt : anneaux isotropes.
   *  En marche, les anneaux sont fenêtrés à l'ARRIÈRE du cap et traînés : le sillage. */
  dirX: number
  dirY: number  /**
   * UNE PIERRE, PAS UN PAS. Les pierres du gué émettent les MÊMES anneaux qu'un marcheur —
   * l'eau se brise dessus en continu — mais JAMAIS sa turbidité : la vase se soulève sous un
   * pas et retombe ; un caillou qui troublerait l'eau à vie éteindrait caustiques et fond
   * autour de lui pour toujours. Les pierres se placent EN QUEUE du tableau : le shader coupe
   * la turbidité à partir du premier drapeau (`uWaderPierre`).
   */
  pierre?: boolean
}

/** Un Feu qui se reflète sur l'eau, poussé par frame depuis l'état sim. */
export interface WaterFire {
  /** Centre du foyer, en TUILES. */
  x: number
  y: number
  /** Portée du reflet, en tuiles. */
  radius: number
  /** Force 0..1 (∝ nuit, via `fireGlow.alpha`) — nulle de jour. */
  strength: number
}

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uField;    // R masque (≥ 128) + drapeaux de chute · G profondeur CASE À CASE (geste 01) · B régime (06/10) + palier (unités)
uniform sampler2D uSeabed;   // le bake du terrain : la couleur de RIVE (l'écume s'y teinte)
uniform sampler2D uFond;     // le LIT réel (geste 03) : sable, galets, vase — vu à travers l'eau
uniform sampler2D uRive;     // R : distance SIGNÉE à la rive (128 = la rive) · G/B : le COURANT (128 = nul)
uniform vec2 uWorldPx;       // taille du monde, en pixels
uniform vec2 uMapTiles;      // taille du monde, en tuiles
uniform float uTilePx;
uniform float uReliefH;
uniform float uTime;         // secondes
uniform vec3 uSun;           // le soleil, en 3D — voir sunVector()
uniform float uDay;          // 0 nuit · 1 plein jour
uniform float uLune;         // la lueur de lune (phase × altitude), 0..1 — voir lueurDeLune()
uniform vec3 uMoonV;         // la lune, en 3D — même recette que uSun (voir astreVector())

// LES FEUX SUR L'EAU. Une poignée de foyers, poussés chaque frame depuis l'état sim (même
// fireGlow que la flaque au sol et le trou du voile → en phase). xy = tuile du foyer,
// z = portée (tuiles), w = force (0..1, ∝ nuit·flicker : nulle de jour, vive la nuit).
#define MAX_FIRES 8
uniform int uFireCount;
uniform vec4 uFires[MAX_FIRES];
#define MAX_WADERS 14
uniform int uWaderCount;
uniform vec4 uWaders[MAX_WADERS]; // xy tuile · z phase (s) · w force (s'éteint après l'arrêt)
uniform vec2 uWaderDirs[MAX_WADERS]; // cap de marche normalisé — {0,0} = à l'arrêt (isotrope)
uniform int uWaderPierre; // l'index de la 1re PIERRE (en queue) : anneaux oui, turbidité non

// LE CHEMIN DE L'ASTRE (spec eau-vivante R12) — le couloir de lumière du soleil bas / de la
// lune. ANCRÉ À LA CAMÉRA : le glitter est vue-dépendant, c'est sa physique (chaque
// observateur a son chemin). L'azimut vient de la SOURCE UNIQUE sunDirection, côté CPU.
uniform vec2 uCam;        // centre caméra, en tuiles
uniform float uAstre;     // 0 = pas de chemin · 1 = plein (fenêtres aube/couchant/lune)
uniform vec3 uAstreCol;   // la couleur du ciel de l'astre (orange à l'aube, os sous la lune)
uniform float uAstreDirX; // l'azimut du couloir : est(+) → ouest(−)

// L'ADVECTION DUAL-PHASE (chantier « l'eau suit le flow ») — les phases se calculent
// CÔTÉ CPU, en double (uTime non borné + fract en mediump = crossfade qui saute).
uniform float uPh0;  // phase de la couche 0, 0..1 (couche 1 : +0,5, wrap)
uniform float uAdv0; // (ph0 − 0,5) · T · vitesse — l'offset d'advection (tuiles), pré-multiplié
uniform float uAdv1; // idem couche 1

// LES TERRASSES (spec « terrasses.md » T-R7) : UN QUAD PAR PALIER qui porte de l'eau, posé
// « palier × lift » plus haut que le monde et trié dans la strate du palier. Chaque quad ne
// peint que les tuiles de SON palier (les autres : discard) — l'eau du palier 2 se dessine
// ainsi au-dessus du sol du palier 1, jamais dessous. Et comme le voile de nuit ne monte pas
// jusqu'aux strates hautes, le quad y porte sa nuit lui-même (« uTeinte », blanc au palier 0).
uniform float uPalierVu;
uniform vec3 uTeinte;

/**
 * LA PERSPECTIVE. Le monde ne se lit PAS à la verticale : les arbres sont debout,
 * les acteurs sont des billboards, le relief est un cisaillement — tout dit une
 * caméra oblique, autour de 45°. Le plan de l'eau est donc vu EN FUITE, et une
 * ride circulaire doit y apparaître ÉCRASÉE de moitié sur l'axe Y.
 *
 * Un clapot isotrope se lit comme vu d'aplomb, et contredit tout le reste de
 * l'image — c'est le genre de faute qu'on ne sait pas nommer mais qu'on voit.
 * On évalue donc la houle dans un espace où Y est DILATÉ : les motifs, une fois
 * rendus, s'y retrouvent comprimés d'autant.
 */
const float YSQUASH = 2.0;
const vec2 PLANE = vec2(1.0, YSQUASH);

/**
 * LE MONDE À L'ENDROIT. Le quad reçoit des coordonnées de texture GL, dont l'axe V
 * MONTE (bottom-up), alors que le monde, lui, DESCEND (ty croît vers le sud). Et les
 * textures uploadées par Phaser sont retournées de la même façon — c'est pour ça que
 * le maillage du sol passe flipV (voir GroundLayer).
 *
 * Ces deux retournements s'ANNULENT tant qu'on ne fait que lire un texel : le shader
 * pouvait donc travailler dans un monde à l'envers sans que ça se voie... sauf pour le
 * CISAILLEMENT, qui, lui, est antisymétrique : soulever vers le haut dans un monde
 * retourné, c'est enfoncer vers le bas dans le vrai. L'eau se retrouvait décalée de
 * DEUX fois le lift sur les versants (exact à élévation 0, à 13 tuiles de sa berge à
 * 0,73). On remet donc le monde à l'endroit UNE fois, ici, et on retourne le V au
 * moment de lire la texture — plus jamais deux conventions dans la même formule.
 */
vec2 texUv(vec2 tile) { return vec2(tile.x / uMapTiles.x, 1.0 - tile.y / uMapTiles.y); }

// Le masque se lit en SEUIL : l'eau vaut ≥ 128 (les 7 bits du dessous portent les chutes).
float maskAt(vec2 tile) { return step(0.25, texture2D(uField, texUv(tile)).r); }
// CARTE PLATE (R35 caduque) : le canal G porte désormais la PROFONDEUR (geste 01), plus
// l'élévation. Si le relief revenait, il lui faudrait son propre canal — d'ici là, la
// bissection (gatée par uReliefH > 0, jamais vrai) lit un monde plat, ce qui est vrai.
float elevAt(vec2 tile) { return 0.0; }

/** LA PROFONDEUR, LERPÉE SOUS LA TUILE (geste 01, repris sur retour d'Alexis : les
 *  paliers par tuile étaient « trop rectilignes, trop francs »). Bilinéaire MANUEL du
 *  canal G (la texture reste NEAREST — même patron que riveFlow) : la rampe traverse la
 *  tuile frontière en continu, et l'ondulation des poids CPU (±0,08 par tuile) devient
 *  des iso-lignes COURBES — la transition cesse d'être un escalier de rectangles. Les
 *  CENTRES de tuile gardent leurs valeurs exactes : la mesure du gué (A4) lit là. */
float depthAt(vec2 tile) { return texture2D(uField, texUv(tile)).g; }
float depthBilin(vec2 tile) {
  vec2 pd = tile - 0.5;
  vec2 id = floor(pd);
  vec2 fd = pd - id;
  float a = depthAt(id + vec2(0.5, 0.5));
  float b = depthAt(id + vec2(1.5, 0.5));
  float c = depthAt(id + vec2(0.5, 1.5));
  float d = depthAt(id + vec2(1.5, 1.5));
  return mix(mix(a, b, fd.x), mix(c, d, fd.x), fd.y);
}

/** Hash de cellule SANS sinus (polynôme de permutation mod 289, 3 étages — le patron
 *  éprouvé de la brume) : portable au bit près, sert aux plaques d'écume et à la frange
 *  du sol humide. */
float permute(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float cellHash(vec2 c) {
  vec2 p = mod(c, 289.0);
  return fract(permute(permute(permute(p.x) + p.y) + p.x) / 289.0);
}

/** LA DISTANCE À LA RIVE (spec eau-vivante R1-R2) + LE COURANT, dans les MÊMES 4 texels :
 *  le SDF de berge (canal R) et le vecteur courant (G/B, cuit de flow-field.ts), lus en
 *  BILINÉAIRE MANUEL (la texture reste NEAREST — on interpole nous-mêmes) : distance
 *  CONTINUE qui croise 0 pile sur le trait de rive, courant CONTINU entre les tuiles.
 *  x = distance (tuiles, +eau/−terre) · yz = courant (aval, norme ≤ 1, nul hors rivière). */
vec3 riveFlowTexel(vec2 tile) {
  vec3 t = texture2D(uRive, texUv(tile)).rgb;
  return vec3((t.r - 0.501960784) * 15.9375, (t.gb - vec2(0.501960784)) * 2.2767857);
}
vec3 riveFlow(vec2 tile) {
  vec2 p = tile - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec3 a = riveFlowTexel(i + vec2(0.5, 0.5));
  vec3 b = riveFlowTexel(i + vec2(1.5, 0.5));
  vec3 c = riveFlowTexel(i + vec2(0.5, 1.5));
  vec3 d = riveFlowTexel(i + vec2(1.5, 1.5));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/**
 * LE LARGE. Le masque est binaire : sondé sur un anneau de quelques tuiles, sa
 * moyenne dit à quel point on est loin de la terre — 1 au milieu de l'eau, 0
 * contre la berge. C'est une distance au rivage, mais qui suit la berge au lieu
 * de suivre une grille, et elle ne coûte pas un canal de texture.
 *
 * Deux anneaux SERRÉS (1,2 et 2,4 tuiles), et c'est délibéré : la première
 * version mesurait sur cinq tuiles, si bien que dans une rivière large de dix
 * TOUT était « rivage » — l'écume couvrait la rivière entière et l'eau virait au
 * lait. Une berge est une ligne, pas un dégradé.
 */
float openness(vec2 tile) {
  const int N = 8;
  float sum = 0.0;
  for (int i = 0; i < N; i++) {
    float a = 6.2831853 * float(i) / float(N);
    vec2 d = vec2(cos(a), sin(a));
    sum += maskAt(tile + d * 1.2) * 0.6;
    sum += maskAt(tile + d * 2.4) * 0.4;
  }
  return sum / float(N);
}

/**
 * LE CLAPOT. Pas une houle : un lac de montagne ne roule pas des vagues d'océan.
 * Six octaves courtes (longueurs d'onde de la demi-tuile à quelques tuiles) sous
 * un domaine deux fois déformé — c'est la déformation qui casse la grille. La
 * première version empilait quatre grandes ondes : on lisait des bandes en
 * diagonale, et l'œil repère une somme de sinusoïdes en une seconde.
 */
float chop(vec2 p, float t) {
  // CALME. Trois ondes larges seulement (plus les octaves fines qui peignaient le
  // marbre), sous une seule déformation de domaine — la houle sert de RELIEF à
  // poster­iser, pas de texture à lire. Le grain vient de la quantification (main),
  // pas d'ondes courtes.
  //
  // LES VITESSES DE PHASE SONT RÉÉQUILIBRÉES (chantier « l'eau suit le flow ») : les
  // trois ondes d'origine (+1.3, −1.7, +2.2) filaient TOUTES vers la gauche — dérive
  // nette (−0.47, +0.02) tuile/s, le « tapis roulant » vu par le joueur, mare comprise.
  // Or l'espace des vitesses qui ANNULE la dérive pondérée par l'amplitude est une
  // droite : s ∝ (0.012, 0.273, 1). D'où (0.04, 0.89, 3.27) — dérive nette (0.000,
  // 0.000) tuile/s : l'onde dominante quasi stationnaire (sa vie vient du warp), les
  // deux petites vivantes. Le MOUVEMENT dirigé, lui, vient du courant (advection).
  // Le warp gagne un rien de vivacité (0.5→0.65, 0.4→0.5 — dérive moyenne nulle par
  // construction) pour compenser la grande onde ralentie.
  vec2 q = p + 0.25 * vec2(sin(p.y * 1.3 + t * 0.65), cos(p.x * 1.1 - t * 0.5));
  float h = 0.0;
  h += 0.60 * sin(dot(q, vec2(0.92, 0.39)) * 1.9 + t * 0.04);
  h += 0.30 * sin(dot(q, vec2(-0.44, 0.90)) * 3.1 + t * 0.89);
  h += 0.14 * sin(dot(q, vec2(0.31, -0.95)) * 5.3 + t * 3.27);
  return h * 0.62;
}

/**
 * LE CLAPOT QUI SUIT LE COURANT — l'advection DUAL-PHASE (flow map classique).
 *
 * Advecter naïvement (p − courant·t) étire le motif sans fin aux gradients de courant.
 * On échantillonne donc DEUX couches dont l'offset repart cycliquement (période T,
 * décalées d'un demi-cycle) et on fond l'une vers l'autre — le poids s'annule PILE
 * quand une couche wrap : le saut est invisible, le motif translate vers l'AVAL.
 *
 * Trois garde-fous de la revue adversariale :
 *   • le fondu PRÉSERVE LA VARIANCE (÷ sqrt(w² + (1−w)²)) — un mix linéaire aplatissait
 *     h de 30 % deux fois par cycle, et h porte TOUT (paliers, glints step 0.55, écume) ;
 *   • l'offset de décorrélation (46.37, 2.97) met les TROIS ondes en quadrature
 *     (cos δ ≈ 0) — le premier venu (37.3, 17.1) ANNULAIT l'onde 2 à mi-fondu ;
 *   • le GATE par la norme du courant : eau sans courant → la couche 0 SEULE, qui y
 *     est EXACTEMENT le clapot d'origine (offset nul) — mares et bord d'écume au bit
 *     près, et la branche cohérente s'y épargne la seconde couche.
 */
float chopCourant(vec2 ps, float t, vec2 adv0, vec2 adv1, float gate, float wD, float rn) {
  float e0 = chop(ps - adv0, t);
  if (gate < 0.001) return e0;
  float e1 = chop(ps - adv1 + vec2(46.37, 2.97), t);
  return mix(e0, (wD * e0 + (1.0 - wD) * e1) * rn, gate);
}

// LE GRAIN. 4 px monde — exactement le pixel de lumière du Feu (fire-ground-glow.ts,
// LIGHT_PX), lui-même multiple de la grille 2 px de l'art. Toute l'eau se calcule PAR
// CELLULE de 4 px : c'est ce qui la rend pixel-art, du même monde que le reste.
const float GRAIN = 4.0;

// ═══ LES CHUTES QUI NE FONT PAS FACE (spec terrasses.md T-R8quater) ═══
//
// Une marche d'eau dont la paroi regarde le nord, l'est ou l'ouest n'a PAS de face à peindre :
// la projection la réduit à un pli d'un pixel. Ce qui se voit d'une chute vue de haut, c'est SA
// LÈVRE (le bourrelet blanc où l'eau bascule, sur la tuile haute) et SON PIED (l'écume, les
// bulles, la brume sur l'eau basse, là où l'écran la montre à côté de la lèvre). QUI est lèvre et
// QUI est pied se décide au CPU (water-field.ts, « chutesDe » — les 7 bits sous le masque) : ici
// on ne fait que peindre, sur la grille de l'ART (cellules de 2 px monde, la moitié du grain de
// l'eau : à 4 px la lèvre ferait 9 px d'écran, une barre), en crans d'alpha fixes et au pas de
// temps — jamais un dégradé, jamais un glissé. La nappe qui FAIT face (paroi sud) reste un
// sprite de la paroi (T-R8) : le quad d'eau se dessine SOUS elle, il ne peut pas la peindre.
const float GRAIN_CHUTE = 2.0;
const float CHUTE_HZ = 10.0; // le pas de temps des tirets qui tombent
// Les normales des faces, K = 3,5 comme le versant (la lèvre regarde le nord ET le haut).
const vec3 N_LEVRE = vec3(0.0, -0.9615, 0.2747);
const vec3 N_EST = vec3(0.9615, 0.0, 0.2747);
const vec3 N_OUEST = vec3(-0.9615, 0.0, 0.2747);
// La lumière d'une face : ambiante + soleil (lambert, de jour) + lune (de nuit) — la même loi
// que le versant, donc le blanc de la lèvre est chaud le matin sur une chute qui regarde l'est.
float eclaireFace(vec3 N) {
  float s = max(dot(N, normalize(uSun)), 0.0) * uDay;
  float m = max(dot(N, normalize(uMoonV)), 0.0) * uLune * (1.0 - uDay);
  return 0.62 + 0.38 * clamp(s + m, 0.0, 1.0);
}
// Le PIED d'une chute latérale, à k cellules du rideau (k = 0 : le rideau lui-même) :
// des tirets qui tombent (une phase par colonne), deux cellules d'écume trouée (la seconde à
// moitié), puis des bulles qui dérivent en s'éloignant. « graine » distingue les chutes d'un même rang.
vec3 pied(vec3 col, float k, float cx, float cy, float fr, float graine, vec3 blanc, vec3 clair, vec3 sombre) {
  if (k < 0.5) {
    float phase = floor(cellHash(vec2(cx, 23.0)) * 7.0);
    float ph = mod(cy - fr + phase, 7.0);
    if (ph < 2.0) return mix(col, blanc, 0.9);
    if (ph < 4.0) return mix(col, clair, 0.9);
    return mix(col, sombre, 0.6);
  }
  // Le pied tient en CINQ cellules (10 px monde, moins d'une tuile) : la maquette en avait dix
  // sur une grille 2,25 fois plus fine — à l'échelle de l'art, la même largeur d'écume bordait
  // chaque côte d'une tuile entière de blanc, et deux côtes se touchaient. UNE cellule d'écume
  // pleine (trouée un quart), une seconde à moitié (trouée de moitié), puis trois de bulles.
  if (k < 1.5) return cellHash(vec2(cx + 97.0 * mod(fr, 3.0), cy)) > 0.25 ? mix(col, blanc, 0.85) : col;
  if (k < 2.5) return cellHash(vec2(cx + 97.0 * mod(fr, 3.0), cy)) > 0.5 ? mix(col, blanc, 0.4) : col;
  if (k < 5.5 && cellHash(vec2(k - fr + graine, cy)) < 0.1667) return mix(col, blanc, 0.35 - 0.1 * (k - 3.0));
  return col;
}

void main() {
  // Pixel du quad → position monde PLATE, PUIS PLANCHÉE sur la grille de 4 px MONDE.
  // On REMET LE MONDE À L'ENDROIT ici (V est bottom-up, cf. texUv). On plancher en espace
  // MONDE, pas écran : le quad est fixe, donc la grille ne GROUILLE pas quand la caméra
  // glisse — les pixels d'eau sont accrochés au terrain, comme ceux du Feu.
  vec2 rawPx = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uWorldPx;
  vec2 flatPx = (floor(rawPx / GRAIN) + 0.5) * GRAIN;
  float tx = flatPx.x / uTilePx; // X n'est jamais cisaillé : exact.

  // On DÉFAIT le cisaillement du relief pour retrouver la tuile réelle — PAR BISECTION.
  //
  // screenY(ty) = ty·TILE − elev(tx, ty)·H est strictement CROISSANT (c'est exactement ce
  // que garantit assertNoFold), donc l'encadrement [py/TILE, py/TILE + H/TILE] contient la
  // solution et se coupe en deux, toujours. 12 tours ramènent l'incertitude à 9,4/4096 de
  // tuile, soit un vingtième de pixel. C'est la MÊME méthode que warp.unproject, celle du
  // picking : le rendu et le picking ne peuvent donc pas se contredire.
  //
  // (Avant, un point fixe. Il tenait, mais il affirmait converger toujours — ce qui n'est
  // vrai que si |d elev / d ty|·H/TILE < 1, et assertNoFold ne borne le gradient que vers
  // le SUD. La bissection, elle, ne demande que la monotonie, qui est GARANTIE.)
  // CARTE PLATE : uReliefH = 0 rend la bissection INERTE (l'écran EST le monde) — on la
  // saute alors tout à fait : 12 tours × 1 lecture texture sur CHAQUE pixel du quad,
  // ~20-25 % du coût du fragment, pour rien (revue perf — c'est ce gain qui paie
  // l'advection dual-phase). La branche est UNIFORME : aucun coût de divergence.
  float ty = flatPx.y / uTilePx;
  if (uReliefH > 0.0) {
    float lo = ty;
    float hi = lo + uReliefH / uTilePx;
    for (int i = 0; i < 12; i++) {
      float mid = 0.5 * (lo + hi);
      float screenY = mid * uTilePx - elevAt(vec2(tx, mid)) * uReliefH;
      if (screenY < flatPx.y) lo = mid; else hi = mid;
    }
    ty = 0.5 * (lo + hi);
  }
  vec2 tile = vec2(tx, ty);
  vec2 uv = tile / uMapTiles;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  vec4 field = texture2D(uField, texUv(tile));
  // LE PALIER de la tuile, dans les unités du canal B (voir « buildWaterField ») : pas le nôtre,
  // pas notre affaire — un autre quad la peint, à sa hauteur.
  float palierTuile = mod(floor(field.b * 255.0 + 0.5), 100.0);
  if (abs(palierTuile - uPalierVu) > 0.5) discard;
  float mask = step(0.25, field.r);
  // LE RÉGIME (geste 10) : 0 = eau normale · ~0,78 = LAC MORT. (L'eau morte du marais,
  // régime 120, a été RETIRÉE — regardée, refusée par Alexis le 2026-07-26.)
  // LE LAC MORT : « parfaitement immobile, trop claire, sans un poisson ». Le malaise
  // vient de l'EXCÈS de clarté — jamais d'un filtre sombre.
  float lacMort = step(0.63, field.b);
  // LE BIEF SOUILLÉ (cendre.md R26d) : canal B à ~0,39 — entre le rien et le lac mort.
  // La suie est un LAVAGE, pas un régime d'immobilité : l'eau bouge encore, mais grise.
  float suie = step(0.30, field.b) * (1.0 - lacMort);
  vec3 rf = riveFlow(tile); // x : distance à la rive (+eau/−terre) · yz : le courant
  float dRive = rf.x;
  // (Le marnage — la ligne d'eau qui respirait par crans — a été RETIRÉ : regardé,
  //  refusé par Alexis le 2026-07-26. La ligne d'eau est fixe, comme avant.)

  // LE TRAIT DE RIVE. Masque NEAREST → 0 ou 1 franc. Le bord tombe PILE sur la
  // frontière des tuiles (multiple de 16 px, donc de 4) : coins CARRÉS, et l'encoche
  // bleue des anciens coins « arrondis » (l'iso-contour 0,5 du filtrage linéaire qui
  // rognait l'angle) disparaît d'elle-même.
  if (mask < 0.5) {
    // ═══ LE SOL HUMIDE (spec eau-vivante R10') — la terre SAIT qu'elle touche l'eau ═══
    // Le quad ne jette plus tout de suite : sur ~0,55 tuile au contact, le sol
    // s'assombrit d'un palier — bande DENTELÉE par cellule (des cellules sèches dans la
    // frange, jamais un liseré), en crans francs. Sortie PRÉMULTIPLIÉE sombre : le bake
    // du sol (dessous, à −1) transparaît assombri — c'est le même sol, mouillé.
    float humide = 1.0 - clamp((-dRive - 0.05) / 0.5, 0.0, 1.0);
    if (humide <= 0.0) discard;
    float nSec = cellHash(flatPx / GRAIN + vec2(37.0, 11.0));
    humide *= step(0.3, humide * 0.75 + nSec * 0.45);
    float cran = floor(humide * 3.0 + 0.5) / 3.0;
    if (cran <= 0.0) discard;
    float aH = 0.26 * cran;
    gl_FragColor = vec4(vec3(0.16, 0.14, 0.09) * aH * uTeinte, aH);
    return;
  }

  float open = openness(tile);            // 0 contre la berge · 1 au large
  // La vase du fond monte VITE en s'éloignant de la berge : une eau de pré est trouble, on ne voit
  // pas loin. Rampe resserrée → le marron du fond couvre l'essentiel du plan d'eau, pas juste son cœur.
  // LA PROFONDEUR (geste 01) : 0 sur le haut-fond, ~0,70 sur la tuile frontière (poids
  // ondulé côté CPU), 1 au cœur — LERPÉE sous la tuile (voir depthBilin) : une rampe
  // continue aux iso-lignes courbes, plus jamais un cran dur ni un escalier de rectangles.
  float deep = depthBilin(tile) * smoothstep(0.03, 0.35, open);
  float t = uTime;

  // Le clapot meurt sur les hauts-fonds : on ne clapote pas dans deux doigts d'eau.
  float amp = 0.35 + 0.65 * smoothstep(0.0, 0.45, open);
  amp *= 1.0 - 0.95 * lacMort; // le Lac Mort est PARFAITEMENT immobile (geste 10)
  amp *= 1.0 - 0.45 * suie; // l'eau CHARGÉE est molle (R26d) — elle coule, elle ne danse plus
  vec2 p = tile * PLANE; // le plan de l'eau, redressé (voir YSQUASH)

  // ═══ LA TURBIDITÉ (geste 07, eau-fond) — l'eau garde la trace du passage ═══
  //
  // Les pas soulèvent la vase : un nuage brun en DEUX crans francs traîne derrière
  // chaque marcheur (le même fenêtrage arrière que le sillage) et meurt avec sa force
  // (w s'éteint ~0,7 s après l'arrêt — plusieurs marcheurs au même gué gardent l'eau
  // trouble ENSEMBLE : un passage se lit). L'eau trouble cache son fond : elle éteint
  // localement caustiques et lit visible — c'est sa définition. Rien en profond, où
  // le fond est déjà invisible.
  float turb = 0.0;
  for (int i = 0; i < MAX_WADERS; i++) {
    if (i >= uWaderCount) break;
    if (i >= uWaderPierre) break; // les pierres (en queue) ne soulèvent pas la vase
    vec4 wt = uWaders[i];
    if (wt.w <= 0.0) continue;
    vec2 dirT = uWaderDirs[i];
    float marcheT = step(0.01, dot(dirT, dirT));
    vec2 centreT = wt.xy - dirT * 0.55 * marcheT; // le nuage traîne derrière le cap
    float dT = length(tile - centreT);
    float arriereT = mix(1.0, max(0.3, step(-0.1, dot(tile - wt.xy, -dirT) / max(dT, 0.001))), marcheT);
    turb += ((1.0 - step(1.0, dT)) * 0.5 + (1.0 - step(0.55, dT)) * 0.5) * wt.w * arriereT;
  }
  turb = floor(clamp(turb, 0.0, 1.0) * (1.0 - deep) * 3.0 + 0.5) / 3.0; // crans, jamais un dégradé

  // ═══ LE COURANT (chantier « l'eau suit le flow ») — la surface AVANCE vers l'aval ═══
  //
  // Le vecteur vient du fil de la worldgen (flow-field.ts, cuit dans G/B de uRive) ; il
  // MEURT contre la berge (taper — l'écume et le trait de rive restent ancrés, mêmes
  // bornes que le CPU des feuilles) et le clapot advecté vole à la MÊME vitesse que les
  // feuilles qui flottent dessus (COURANT_VITESSE, pré-multipliée dans uAdv0/uAdv1).
  // L'offset s'applique en espace PLANE (y dilaté) : la vitesse ÉCRAN est la bonne.
  vec2 flow = rf.yz * smoothstep(${TAPER_MIN}, ${TAPER_MAX}, dRive);
  float gate = smoothstep(0.02, 0.10, length(flow));
  vec2 adv0 = flow * PLANE * uAdv0;
  vec2 adv1 = flow * PLANE * uAdv1;
  float wD = 1.0 - abs(2.0 * uPh0 - 1.0);
  float rn = inversesqrt(wD * wD + (1.0 - wD) * (1.0 - wD));
  float h = chopCourant(p, t, adv0, adv1, gate, wD, rn) * amp;

  // La normale, par différences finies — prises DANS LE PLAN de l'eau, puis
  // ramenées à l'écran : la pente en Y y est vue de biais, donc raccourcie. Le pas
  // vaut une CELLULE (4 px) : une normale au grain de l'image, pas plus fine qu'elle.
  // Le courant du CENTRE advecte les 4 échantillons (le vecteur est gelé sur le
  // stencil : différencier le champ de courant peindrait une fausse pente à chaque
  // gradient de flow) — la réfraction du lit coule donc vers l'aval avec le reste.
  float e = GRAIN / uTilePx;
  float hx = (chopCourant(p + vec2(e, 0.0), t, adv0, adv1, gate, wD, rn) - chopCourant(p - vec2(e, 0.0), t, adv0, adv1, gate, wD, rn)) * amp;
  float hy = (chopCourant(p + vec2(0.0, e), t, adv0, adv1, gate, wD, rn) - chopCourant(p - vec2(0.0, e), t, adv0, adv1, gate, wD, rn)) * amp;
  vec3 n = normalize(vec3(-hx * 0.85, -hy * 0.85 / YSQUASH, 1.0));

  // LA RÉFRACTION. On rééchantillonne le FOND décalé par la normale : le fond ondule
  // sous la surface. Le décalage s'annule contre la berge — sinon il irait chercher
  // l'herbe d'à côté et la peindrait dans l'eau. Le fond n'est PLUS le bake (qui, sous
  // l'eau, contient… la couleur d'eau) : c'est le LIT inféré du geste 03 — sable près
  // des berges, galets sous le courant, vase qui fonce au large.
  // (Au Lac Mort, la réfraction ne meurt PAS en profond : on voit le fond partout — geste 10.)
  vec2 refr = tile + (n.xy / PLANE) * 0.55 * (1.0 - deep * (1.0 - lacMort)) * smoothstep(0.0, 0.4, open);
  vec3 bed = texture2D(uFond, texUv(refr)).rgb; // la texture est retournée comme le champ

  // ═══ LE FOND MARRON SOUS LA SURFACE, LE CIEL RÉFLÉCHI DESSUS ═══
  //
  // Une eau de pré est trouble et terreuse — MAIS sa surface RÉFLÉCHIT LE CIEL (retour d'Alexis :
  // sans ça le plan d'eau vire au marron sombre partout). On compose donc deux étages :
  //   • SOUS la surface (réfraction) : la vase brune du fond sur le gué, qui cède à une eau trouble
  //     en profondeur (au large, on ne voit plus le fond) ;
  //   • SUR la surface (réflexion) : le ciel, d'autant plus présent que l'eau est profonde — c'est
  //     lui qui éclaircit le large et donne sa couleur au plan d'eau.
  float bedLum = dot(bed, vec3(0.299, 0.587, 0.114));
  // LE GUÉ SE LIT EN LUMINANCE (spec da-feeling R10) : mesuré sur capture, profond/haut-fond ne
  // contrastaient qu'à 1,29:1 — la lecture ne tenait qu'au canal bleu. La molette est ICI, sur la
  // vase (plus sableuse, gain relevé) : le haut-fond s'éclaircit, le large garde son ciel — la
  // doctrine « la réflexion croît avec la profondeur » (R45) n'est pas touchée. Cible ≥ 1,4:1.
  vec3 mud = vec3(0.46, 0.36, 0.21) * (1.0 + 0.8 * bedLum);  // la vase du fond, brune — ÇA RESTE DE L'EAU
  // (l'essai « sable clair » a fait lire la rivière comme une route : rollback, regardé)
  vec3 murk = vec3(0.11, 0.155, 0.15);                       // l'eau profonde trouble (vert-de-gris)
  vec3 bottom = mix(mud, murk, deep);                        // ce qu'on voit SOUS la surface

  // ═══ LE LIT STRIÉ PAR LE COURANT (geste 04, eau-fond) — le courant a SCULPTÉ le fond ═══
  //
  // REPRIS sur retour d'Alexis (« trop rectilignes, trop franches ») : plus des zébrures
  // moitié-moitié, mais des CRÊTES de sable étroites (~15 % du cycle), ROMPUES par
  // cellule, dont la phase est CHAHUTÉE par blocs d'une tuile et demie — des rides
  // brisées, jamais une rayure. Statiques (le courant les a faites, il ne les anime
  // pas), un demi-cran clair seulement. Éteintes en profond et sous le seuil de courant ;
  // les lacs restent lisses.
  float fmag = length(rf.yz);
  if (fmag > 0.12) {
    vec2 fperp = vec2(-rf.z, rf.y) / fmag;
    float jitter = (cellHash(floor(tile / 1.5) + vec2(29.0, 71.0)) - 0.5) * 2.6;
    float crete = step(0.72, sin(dot(tile, fperp) * 6.9 + jitter));
    crete *= step(0.35, cellHash(flatPx / GRAIN + vec2(43.0, 23.0)));
    bottom *= 1.0 + crete * 0.10 * (1.0 - deep) * smoothstep(0.12, 0.3, fmag);
  }

  // ═══ LES CAUSTIQUES POSTERISÉES (geste 05, eau-fond) — le soleil au fond du gué ═══
  //
  // Un filet de lumière sur le LIT du haut-fond seul : deux tons, crans francs, calculé
  // par cellule de 4 px comme tout le reste — jamais un dégradé. Il n'existe qu'en plein
  // jour (uDay × hauteur du soleil), meurt en profond (on ne voit plus le fond) et près
  // de la berge (le lit visible garde la main). Vitesses LENTES à dessein — la doctrine
  // R12 : rien ne bouge sans mesure, et la sonde optique ne corrèle qu'à ω·dt ≲ 1 rad.
  // Alpha bas : c'est le deuxième candidat au « lait » après l'écume, la leçon est écrite.
  float caustGate = uDay * clamp(uSun.z, 0.0, 1.0) * (1.0 - deep) * smoothstep(0.1, 0.4, open) * (1.0 - turb);
  if (caustGate > 0.02) {
    vec2 cq = p * 3.3;
    float web = sin(cq.x + sin(cq.y * 1.13 + t * 0.33)) * sin(cq.y - sin(cq.x * 0.87 - t * 0.26));
    float caust = step(0.55, web) * 0.5 + step(0.82, web) * 0.5; // deux tons, crans francs
    bottom += vec3(0.34, 0.31, 0.22) * caust * 0.55 * caustGate;
  }

  // (Les herbiers en blobs shader ont été RETIRÉS — hors DA, retour d'Alexis. Ils
  //  vivent désormais dans le LANGAGE DU SOL : des tuiles d'algues dans uFond, posées
  //  par buildFondField sur le haut-fond calme — des aplats de tuile, comme le bake.)
  // ═══ LE LIT VISIBLE (spec eau-vivante R10') — l'eau montre son fond avant de se saturer ═══
  // Près du trait de rive, le VRAI lit (le bake réfracté) gagne, par crans francs : on
  // devine le sable et la vase du bord, puis l'eau prend le dessus en ~1 tuile. C'est le
  // volume vertical qui manquait — et il donne au haut-fond clair son CONTEXTE (le « banc
  // de sable » consigné se lit désormais comme le bord qu'il est).
  float litGagne = 1.0 - clamp((dRive - 0.15) / 0.85, 0.0, 1.0);
  litGagne = floor(litGagne * 3.0 + 0.5) / 3.0;
  bottom = mix(bottom, bed * (0.72 + 0.34 * bedLum), litGagne * 0.55 * (1.0 - 0.7 * turb));
  // La vase soulevée (geste 07) voile le fond de sa propre couleur.
  bottom = mix(bottom, mud * 0.85, turb * 0.5);
  // LE LAC MORT (geste 10) : la transparence ANORMALE — le fond net loin de la berge,
  // l'inverse de partout ailleurs. C'est l'excès de clarté qui met mal à l'aise.
  bottom = mix(bottom, bed * (0.95 + 0.35 * bedLum), lacMort * 0.85);

  // Le ciel réfléchi : bleu pâle de jour, éteint la nuit (uDay), réchauffé quand le soleil rase.
  // Le ciel réfléchi, UN CRAN plus profond (0.52,0.62,0.70 → lac de montagne) : le gradient
  // de réflexion (la doctrine R45) est intact, mais le large cesse d'être plus CLAIR que le
  // gué — c'est lui qui plafonnait le contraste de lisibilité (mesuré 1,29:1 puis 1,11:1).
  vec3 daySky = vec3(0.34, 0.45, 0.56);
  // LE CIEL DE NUIT SUIT LA LUNE. Une eau de pleine lune est le miroir le plus clair du
  // paysage ; une eau de nouvelle lune, un trou noir — plus sombre que l'ancienne constante,
  // c'est le noir qui est l'écart. uLune = lueurDeLune (phase × altitude), la MÊME loi que le
  // voile : la nappe ne s'argente jamais quand la terre reste noire. Pente CONTINUE en uLune,
  // et la teinte qui monte est l'os du couloir lunaire (uAstreCol) — une seule lune.
  vec3 nightSky = vec3(0.03, 0.05, 0.09) + uLune * 0.22 * vec3(0.75, 0.8, 0.88);
  vec3 sky = mix(nightSky, daySky, uDay);
  sky += vec3(0.12, 0.05, -0.03) * uDay * max(0.0, 1.0 - uSun.z); // chaleur au ras du matin/soir

  // La part de ciel : un socle (l'eau en réfléchit toujours un peu), FORTE au large, faible sur le
  // gué (là on regarde le fond presque à la verticale). C'est ce mélange qui remplace le marron
  // uniforme — le fond reste brun là où on le voit, le large prend la lumière du ciel.
  float skyMix = clamp(0.16 + 0.69 * deep, 0.0, 0.9);
  skyMix = mix(skyMix, 0.06, lacMort); // le Lac Mort : on regarde À TRAVERS (geste 10)
  skyMix *= 1.0 - 0.6 * suie; // la suie ÉTEINT le ciel : l'eau ne reflète plus, elle porte
  vec3 col = mix(bottom, sky, skyMix);
  col = mix(col, col * vec3(0.88, 1.05, 1.04), lacMort); // la froideur irréelle du Lac Mort
  // LE LAVAGE DE SUIE (cendre.md R26d) : vers le gris de la cendre fraîche — désaturé, un
  // rien plus chaud que le lac mort. La couleur se calibre contre son fond : le sol cendré
  // fait ~#5c5854, le bief doit s'en séparer d'un cran de valeur, pas de teinte.
  col = mix(col, vec3(dot(col, vec3(0.333))) * vec3(0.78, 0.74, 0.72), 0.55 * suie);

  // ═══ LE CLAPOT PIXEL : la houle POSTERISÉE en paliers francs ═══
  //
  // On ne module plus la couleur par une pente CONTINUE (c'était le marbre) : on
  // quantifie la hauteur en quelques crans, et chaque cran est un APLAT. La cellule
  // est claire (crête), moyenne (plat) ou sombre (creux) — quelques teintes d'eau,
  // jamais un dégradé lissé. Le grain spatial est déjà donné (flatPx planché) ; ici
  // on quantifie la VALEUR. C'est le pendant, pour l'eau, du Feu qui vacille par
  // paliers d'alpha et non par variation continue.
  float lvl = floor(h * 3.0 + 0.5) / 3.0;         // crans de 1/3
  col *= 1.0 + clamp(lvl, -0.5, 0.5) * 0.20;

  // L'ÉCLAT DUR, et RARE. La cellule brille ou ne brille PAS : un pixel net posé sur
  // la CRÊTE la plus haute — là où les ondes s'additionnent — et seulement de jour, du
  // côté éclairé. La porte est sur la HAUTEUR (h près de son maximum), pas sur le lambert :
  // au zénith le lambert est fort partout et faisait grésiller toute la nappe de blanc.
  // Ici les éclats sont clairsemés et se déplacent avec les crêtes — un scintillement,
  // pas de la neige. On a retiré le lobe large (pow continu) qui repeignait le marbre.
  vec3 L = normalize(vec3(uSun.x, uSun.y / YSQUASH, uSun.z));
  float lambert = max(dot(n, L), 0.0);
  float glint = step(0.55, h) * step(0.15, lambert);
  // Au Lac Mort les reflets sont PARFAITS — plus durs qu'ailleurs (geste 10).
  col += vec3(1.0, 0.97, 0.88) * glint * 0.38 * uDay * (1.0 + 0.6 * lacMort);

  // L'ÉCLAT DE LUNE (2026-08-29) : le même éclat dur et RARE, la nuit, du côté de la LUNE —
  // même porte de crête (jamais un lobe continu : c'est le lobe qui repeignait le marbre et
  // faisait grésiller la nappe), teinte d'OS (celle du couloir), et ∝ lueurDeLune : un
  // scintillement froid sous la pleine lune, rien du tout sous la neuve.
  vec3 Lm = normalize(vec3(uMoonV.x, uMoonV.y / YSQUASH, uMoonV.z));
  float glintLune = step(0.55, h) * step(0.15, dot(n, Lm));
  col += vec3(0.75, 0.8, 0.88) * glintLune * 0.34 * (1.0 - uDay) * uLune * (1.0 + 0.6 * lacMort);

  // ═══ LE FEU SUR L'EAU ═══
  //
  // Chaque foyer proche allume la nappe — c'est l'image de Braises, la nuit : le camp
  // qui se reflète dans l'eau à ses pieds. Deux termes, comme le soleil, mais d'une
  // source PONCTUELLE :
  //   • un LAVAGE chaud (l'eau prend la teinte de la braise), qui décroît avec la distance ;
  //   • des ÉCLATS DURS sur les crêtes qui FONT FACE au foyer — un pixel ambré, jamais une
  //     veine (même porte que le soleil : hauteur de crête × orientation).
  // La force w porte déjà la nuit (fireGlow.alpha ∝ 1−jour) : rien de jour, vif la nuit.
  // Tout se calcule par cellule (flatPx planché) → reflets et éclats sont pixel, cohérents.
  float fireWash = 0.0;
  float fireSpark = 0.0;
  for (int i = 0; i < MAX_FIRES; i++) {
    if (i >= uFireCount) break;
    vec4 f = uFires[i];
    vec2 toF = f.xy - tile;                 // tuiles, vers le foyer
    float reach = max(f.z, 0.001);
    float fall = clamp(1.0 - length(toF) / reach, 0.0, 1.0);
    fall = fall * fall * f.w;               // douceur quadratique × force (nuit)
    fireWash += fall;
    // Direction 3D vers le foyer (y écrasé comme le soleil, cf. YSQUASH), un peu au-dessus de l'eau.
    vec3 Lf = normalize(vec3(toF.x, toF.y / YSQUASH, 1.6));
    float sf = max(dot(n, Lf), 0.0);
    fireSpark += step(0.28, h) * step(0.5, sf) * fall;
  }
  col += vec3(1.0, 0.52, 0.20) * clamp(fireWash, 0.0, 1.2) * 0.75; // la braise, en lavage
  col += vec3(1.0, 0.86, 0.62) * clamp(fireSpark, 0.0, 1.0) * 0.95; // les éclats chauds, durs

  // ═══ LES REMOUS (spec da-feeling R11) — l'eau vit par ses ÉVÉNEMENTS ═══
  //
  // Un marcheur dans le haut-fond émet des ANNEAUX : rayon ∝ l'âge (répété), qui MEURENT en
  // s'élargissant. Le langage du clapot : bande FRANCHE (step), calculée par cellule (flatPx
  // déjà planché) — jamais un dégradé. La force w vient du CPU : pleine en marche, elle
  // s'éteint en ~0,7 s après l'arrêt — un avatar immobile ne remue pas l'eau.
  float ripple = 0.0;
  float brise = 0.0; // L'EAU BLANCHE des pierres : l'amont qui se brise + la traînée qui mousse
  for (int i = 0; i < MAX_WADERS; i++) {
    if (i >= uWaderCount) break;
    vec4 wd = uWaders[i];
    if (wd.w <= 0.0) continue;
    // LE SILLAGE (spec eau-vivante R6) : en marche, le centre d'émission RECULE le long du
    // cap avec l'âge de l'anneau — les anneaux se sèment DERRIÈRE le marcheur et le V
    // émerge tout seul (personne ne simule un sillage : on émet des décals qui vieillissent).
    // Et l'anneau est FENÊTRÉ à l'arrière : devant le marcheur, l'eau n'a pas encore bougé.
    // À l'arrêt (dir = {0,0}), tout ceci s'annule : les ronds isotropes de R11, intacts.
    vec2 dir = uWaderDirs[i];
    float marche = step(0.01, dot(dir, dir));
    // LA CADENCE : ~0,87 s par anneau sous un PAS — mais une PIERRE bat deux fois plus lent
    // (Alexis : « la fréquence des remous est trop élevée ») : un pas est un événement, un
    // obstacle est un régime — son remous se reforme sans hâte, et l'anneau plus lent vit
    // plus longtemps sur son trajet vers l'aval (même fract, période double).
    float cadence = i >= uWaderPierre ? 0.55 : 1.15;
    float age = fract((t - wd.z) * cadence);
    vec2 centre = wd.xy - dir * age * (0.9 * marche);
    vec2 v = tile - centre;
    float dw = length(v);
    float r = 0.25 + age * 1.5;                // il naît au pied, meurt à ~1,75 tuile
    // La fenêtre arrière : palier FRANC sur l'orientation (jamais un dégradé) — on garde
    // un fond isotrope de 35 % pour que le pied du marcheur reste ancré dans son eau.
    float arriere = mix(1.0, max(0.35, step(-0.15, dot(v, -dir) / max(dw, 0.001))), marche);
    // Largeur ≈ la CELLULE (4 px = 0,25 tuile) : plus fin, l'anneau raterait les cellules du grain.
    float band = step(abs(dw - r), 0.27) * (1.0 - age) * (1.0 - step(1.9, dw)) * arriere;
    // Le second anneau, en quinconce : la traîne du pas précédent, semée un cran plus loin.
    float age2 = fract((t - wd.z) * cadence + 0.5);
    vec2 centre2 = wd.xy - dir * age2 * (0.9 * marche);
    vec2 v2 = tile - centre2;
    float dw2 = length(v2);
    float r2 = 0.25 + age2 * 1.5;
    float arriere2 = mix(1.0, max(0.35, step(-0.15, dot(v2, -dir) / max(dw2, 0.001))), marche);
    band += step(abs(dw2 - r2), 0.22) * (1.0 - age2) * 0.6 * (1.0 - step(1.9, dw2)) * arriere2;
    ripple += band * wd.w;

    // ═══ L'EAU SE BRISE SUR LA PIERRE (Alexis, 2026-08-28 : « un effet blanc sur le devant
    // de la pierre vis-à-vis du courant, et un peu derrière dans la traînée ») ═══
    //
    // PIERRES SEULEMENT (i >= uWaderPierre), et SEULEMENT s'il y a un courant (marche) : dans
    // une eau immobile rien ne se brise. Le cap dir pointe vers l'AMONT (la pierre « marche »
    // contre le courant) — le CROISSANT d'écume colle donc au côté +dir, la TRAÎNÉE part en
    // -dir. Le langage de l'écume de rive, à l'identique : paliers FRANCS (step), pointillé
    // par cellule de 4 px, jamais un dégradé — et les points se retirent au fil de l'eau
    // (le hash glisse avec pasT), comme la mousse réelle qui se reforme sans se figer.
    if (i >= uWaderPierre) {
      vec2 vp = tile - wd.xy;
      float dp = length(vp);
      float versAmont = dot(vp, dir) / max(dp, 0.001);
      // ① LE COLLIER AMONT, À LA LIGNE DE FLOTTAISON : le point d'émission est déjà au PIED
      //    du billboard (WorldScene), et la distance est ÉCRASÉE EN Y (×1,8 — la grammaire
      //    des ombres de contact : ce qui entoure un billboard est une ellipse couchée).
      //    L'écume enlace donc la BASE de la pierre — visible sur ses flancs — au lieu de
      //    flotter à mi-corps ou de se cacher derrière le sprite. L'horizon est LARGE
      //    (cos > 0,15 ≈ ±81°) : la brisure s'enroule jusqu'aux épaules aval. Elle RESPIRE
      //    sur la cadence des anneaux : deux crans, jamais éteinte.
      float dpE = length(vec2(vp.x, vp.y * 1.8));
      float croissant = step(abs(dpE - 0.5), 0.17) * step(0.15, versAmont)
        * (0.7 + 0.3 * step(0.5, age));
      // ② LA TRAÎNÉE AVAL : un cône pointillé derrière la pierre — l'axe est -dir, la
      //    demi-largeur s'ouvre avec la distance, la densité tombe en DEUX crans (0→0,9 tuile
      //    pleine, 0,9→1,6 clairsemée). Le pointillé vit : son hash est resemé 2 fois/s.
      float aval = -dot(vp, dir);
      float lat = abs(vp.x * dir.y - vp.y * dir.x);
      // Le cône part de la ligne de flottaison (le pied) — un cran de garde (0,1) pour ne
      // pas mordre sous le sprite, puis il s'ouvre.
      float cone = step(0.1, aval) * step(aval, 1.6) * step(lat, 0.20 + 0.26 * aval);
      float dens = mix(0.62, 0.86, step(0.9, aval)); // loin = plus clairsemé (seuil plus haut)
      // (pasT de l'écume de rive est déclaré plus BAS dans main — on cadence le nôtre ici.)
      float pasEcume = floor(t * 2.0) / 2.0;
      float points = step(dens, cellHash(flatPx / GRAIN + vec2(pasEcume * 3.0, 17.0)));
      brise += (croissant + cone * points * 0.8) * wd.w * marche;
    }
  }
  // La crête du remous ÉCLAIRCIT (l'eau retournée prend la lumière) — un palier, pas un halo.
  col = mix(col, col * 1.3 + vec3(0.07, 0.07, 0.05), clamp(ripple, 0.0, 1.0) * 0.6);
  // …et L'EAU BRISÉE BLANCHIT : la couleur de l'écume de rive, plafonnée — du blanc cassé,
  // pas un phare. (Le même ton que l'écume, déclaré avant elle : une seule eau blanche.)
  col = mix(col, vec3(1.0, 0.99, 0.94), clamp(brise, 0.0, 0.65));

  // ═══ LE CHEMIN DE L'ASTRE (spec eau-vivante R12) ═══
  //
  // Quand le soleil rase (aube, couchant) ou sous la lune, un COULOIR traverse l'eau selon
  // l'azimut : la palette y monte d'UN palier vers le ciel de l'astre, et les étincelles y
  // explosent — des CELLULES qui s'allument au palier max quelques pas de temps, jamais un
  // spéculaire lissé (la doctrine des FX de lumière pixellisés). Bords en dither au grain ;
  // la géométrie du couloir est CONTINUE (pente continue), le rendu par paliers.
  if (uAstre > 0.001) {
    vec2 A = normalize(vec2(uAstreDirX, 0.35));
    vec2 rel = tile - uCam;
    float dPerp = abs(rel.x * (-A.y) + rel.y * A.x);
    float dedans = step(dPerp, 0.9);
    dedans = max(dedans, step(dPerp, 1.7) * step(0.5, cellHash(flatPx / GRAIN + vec2(71.0, 13.0))));
    if (dedans > 0.0) {
      // Au Lac Mort, le chemin de l'astre est RENFORCÉ (geste 10) : le seul éclat du lieu.
      col = mix(col, uAstreCol, 0.16 * (1.0 + 0.8 * lacMort) * uAstre * dedans);
      float scint = step(0.25, h) * step(0.84, cellHash(flatPx / GRAIN + vec2(floor(t * 6.0), 3.0)));
      col += uAstreCol * scint * dedans * 0.55 * (1.0 + 0.8 * lacMort) * uAstre;
    }
  }

  // L'ÉCUME, et elle vient DE LA BERGE. Des lignes parallèles au rivage qui
  // avancent vers la terre : le clapot qui vient mourir sur la rive, et non un
  // liseré blanc collé au bord. C'est open qui sert d'abscisse — il croît
  // quand on s'éloigne de la berge, donc une phase en open donne des bandes qui
  // épousent la rive quelle que soit sa forme.
  float band = sin(open * 26.0 - t * 2.1 + h * 1.4);
  float lap = step(0.55, band) * (1.0 - step(0.22, open)); // bandes FRANCHES, pas de dégradé
  float rim = 1.0 - step(0.10, open);                      // le tout dernier cran, dur

  // LA COULEUR DU RIVAGE. Plutôt qu'un beige unique, l'écume prend la couleur de la
  // tuile de terre la plus proche (herbe, sable, roche…). Le masque croît vers l'eau,
  // donc son gradient pointe vers le large : l'opposé mène à la berge. On y échantillonne
  // le bake du terrain (uSeabed contient la couleur de CHAQUE tuile, terre comprise).
  vec2 grad = vec2(maskAt(tile + vec2(0.7, 0.0)) - maskAt(tile - vec2(0.7, 0.0)),
                   maskAt(tile + vec2(0.0, 0.7)) - maskAt(tile - vec2(0.0, 0.7)));
  vec2 toShore = length(grad) > 1e-4 ? -normalize(grad) : vec2(0.0);
  // La tuile de terre LA PLUS PROCHE (un cran au-delà de la rive), ASSOMBRIE : une
  // berge mouillée est plus sombre que le sol sec — sans ça la teinte du pré clair
  // se lit comme un liseré qui brille.
  vec3 shoreCol = texture2D(uSeabed, texUv(tile + toShore)).rgb * 0.62;
  col = mix(col, shoreCol, clamp(rim * 0.26 + lap * 0.28, 0.0, 0.5) * (1.0 - lacMort));

  // ═══ L'ÉCUME DE RIVE (spec eau-vivante R9) — des PLAQUES qui lèchent le bord ═══
  //
  // Chaque cellule de 4 px a SA phase : son front d'écume avance et recule par PAS
  // (le temps est planché à ~6 Hz — l'eau pixel s'anime par crans, jamais en glissé),
  // si bien que la ligne se dissout en plaques qui gagnent et rendent du terrain une
  // à une. Des TROUS assumés (l'écume respire), deux tons (crête claire, corps).
  // LA LEÇON RESTE ÉCRITE : l'écume sur 5 tuiles a déjà fait virer l'eau au lait —
  // ici TOUT vit sous ~0,7 tuile du trait de rive, et la 2e bande est residuelle.
  float pasT = floor(t * 6.0) / 6.0;
  float nCell = cellHash(flatPx / GRAIN);
  float front = 0.18 + 0.14 * sin(pasT * 4.4 + nCell * 6.2831853);
  // L'écume vit sur les CRÊTES du clapot qui vient mourir au bord (h haut) — jamais un
  // cadre statique : la première écriture cernait le plan d'eau d'un liseré blanc continu
  // (regardé, refusé — c'est le mot exact de la spec). Les plaques naissent et meurent
  // avec les vaguelettes, les trous sont assumés.
  float surCrete = step(0.02, h + 0.22 * nCell);
  float dansEcume = step(dRive, front) * step(0.02, dRive) * step(0.34, nCell) * surCrete;
  float crete2 = dansEcume * step(dRive, front * 0.5) * step(0.55, nCell);
  // La 2e bande, au large du premier repli : RARE (le clapot qui se reforme), pointillée.
  float d2 = abs(dRive - (0.95 + 0.12 * sin(pasT * 2.6 + nCell * 6.2831853)));
  float bande2 = step(d2, 0.06) * step(0.74, cellHash(flatPx / GRAIN + vec2(53.0, 29.0)));
  vec3 ecumeCol = vec3(1.0, 0.99, 0.94);
  // Le Lac Mort n'écume pas (geste 10) — rien n'y bat.
  col = mix(col, ecumeCol * 0.82, clamp(dansEcume * 0.38 + bande2 * 0.2, 0.0, 0.6) * (1.0 - lacMort));
  col = mix(col, ecumeCol, crete2 * 0.55 * (1.0 - lacMort));

  // ═══ LES CHUTES QUI NE FONT PAS FACE (T-R8quater) — voir les fonctions au-dessus de main ═══
  float drapeaux = max(floor(field.r * 255.0 + 0.5) - 128.0, 0.0);
  if (drapeaux > 0.5) {
    float levreN = mod(drapeaux, 2.0); drapeaux = floor(drapeaux * 0.5);
    float levreE = mod(drapeaux, 2.0); drapeaux = floor(drapeaux * 0.5);
    float levreO = mod(drapeaux, 2.0); drapeaux = floor(drapeaux * 0.5);
    float rideauE = mod(drapeaux, 2.0); drapeaux = floor(drapeaux * 0.5);
    float rideauO = mod(drapeaux, 2.0); drapeaux = floor(drapeaux * 0.5);
    float piedN = drapeaux; // 0 · 1 · 2
    vec2 tl = floor(tile);
    vec2 cel = floor(rawPx / GRAIN_CHUTE);                          // la cellule de 2 px, monde
    vec2 dans = floor((rawPx - tl * uTilePx) / GRAIN_CHUTE);         // 0..7 dans la tuile
    float cN = dans.y, cS = 7.0 - dans.y, cO = dans.x, cE = 7.0 - dans.x;
    float fr = floor(t * CHUTE_HZ);
    // Les trois tons du mock « Quatre chutes » : le blanc de l'écume (qui prend la braise des
    // foyers, comme le reste de la nappe), le clair, le sombre du pli.
    vec3 blanc = ecumeCol + vec3(1.0, 0.52, 0.20) * clamp(fireWash, 0.0, 1.2) * 0.35;
    vec3 clair = mix(col, blanc, 0.42);
    vec3 sombre = mix(col, vec3(0.04, 0.08, 0.16), 0.45);
    // LA LÈVRE NORD (tuile haute) : le bourrelet sur deux cellules, et, en amont, l'eau qui
    // ACCÉLÈRE — des traînées claires qui remontent vers la lèvre, plus denses en approchant.
    if (levreN > 0.5) {
      float lit = eclaireFace(N_LEVRE);
      if (cN < 0.5) col = blanc * lit;
      else if (cN < 1.5) col = (cellHash(vec2(cel.x, 1.0)) < 0.66 ? clair : blanc) * lit; // regardé le 2026-09-03 : à mi-mélange la 2e cellule ne se lisait pas
      else if (cN < 5.5) {
        float tt = 1.0 - (cN - 2.0) / 4.0;
        float phase = floor(cellHash(vec2(cel.x, 22.0)) * 7.0);
        if (cellHash(vec2(cel.x, floor((cel.y + fr + phase) / 3.0))) < 0.3 * tt) col = mix(col, clair, 0.7);
      }
    }
    // LES LÈVRES EST / OUEST (tuile haute) : une colonne d'une cellule, blanche aux trois quarts,
    // éclairée comme un flanc — chaude à l'aube côté est, au couchant côté ouest.
    if (levreE > 0.5 && cE < 0.5) col = (cellHash(vec2(1.0, cel.y)) < 0.75 ? blanc : clair) * eclaireFace(N_EST);
    if (levreO > 0.5 && cO < 0.5) col = (cellHash(vec2(2.0, cel.y)) < 0.75 ? blanc : clair) * eclaireFace(N_OUEST);
    // LE PIED (tuile basse) : rideau, écume et bulles depuis le bord qui touche la chute.
    if (rideauE > 0.5) col = pied(col, cO, cel.x, cel.y, fr, 13.0 * tl.x, blanc, clair, sombre);
    if (rideauO > 0.5) col = pied(col, cE, cel.x, cel.y, fr, 17.0 * tl.x, blanc, clair, sombre);
    // LE PIED NORD (tuile basse) : la lèvre est juste sous mon bord sud (ou une tuile plus loin) ;
    // le même profil que le pied latéral — une cellule d'écume pleine, une à moitié, trois de
    // bulles qui dérivent vers le nord — puis la brume : une colonne sur quatre, un point qui
    // monte au ralenti.
    if (piedN > 0.5) {
      float d = cS + 1.0 + (piedN - 1.0) * 8.0; // cellules depuis la lèvre, 1..16
      if (d < 1.5) {
        if (cellHash(vec2(cel.x + 97.0 * mod(fr, 3.0), cel.y)) > 0.25) col = mix(col, blanc, 0.85);
      } else if (d < 2.5) {
        if (cellHash(vec2(cel.x + 97.0 * mod(fr, 3.0), cel.y)) > 0.5) col = mix(col, blanc, 0.4);
      } else if (d < 5.5) {
        if (cellHash(vec2(cel.x, d - fr + 13.0 * tl.y)) < 0.1667) col = mix(col, blanc, 0.35 - 0.1 * (d - 3.0));
      } else if (cellHash(vec2(cel.x, 7.0)) < 0.25) {
        float m = mod(floor(fr * 0.5) + floor(cellHash(vec2(cel.x, 8.0)) * 9.0), 9.0);
        if (abs(d - 6.0 - m) < 0.5) col = mix(col, blanc, 0.35 - 0.1 * floor(m / 3.0));
      }
    }
  }

  // (Le « tombant » — liseré sombre + écume qui casse sur la tuile frontière — a été
  //  RETIRÉ avec la reprise de la transition : il durcissait un bord qu'Alexis voulait
  //  fondu. La rampe bilinéaire de depthBilin porte seule la lecture du profond.)

  // Translucide sur le gué, opaque au large : on voit où l'on passe. PAS de fondu
  // d'alpha au bord : sinon l'eau devient transparente pile sur la rive et laisse
  // transparaître la tuile d'eau du SOL (bakée en cyan clair) — le liseré clair.
  // On garde donc l'eau assez opaque jusqu'à sa ligne de coupe, bord net.
  float a = mix(0.88, 0.96, deep);
  a = mix(a, 0.90, lacMort); // le Lac Mort laisse TOUT voir (geste 10)
  gl_FragColor = vec4(col * uTeinte, a);
}
`

/**
 * LE SOLEIL DE L'EAU — DÉRIVÉ DE LA SOURCE UNIQUE. `lighting.sunDirection(hour)` est LE
 * soleil du jeu (il pilote aussi `DynamicLighting`) : un vecteur PLAN, `x = cos(azimut)`
 * (est+ à l'aube → ouest− au couchant ; |x| = 1 au ras, 0 à midi), `y` toujours nul.
 *
 * On ne RECALCULE donc plus l'azimut ici : c'était un SECOND soleil, qui pouvait dériver du
 * premier. On PART de `sunDirection` et on lui rajoute ce qu'une SURFACE réclame de plus qu'un
 * versant — une hauteur. L'altitude se reconstruit de `x` seul (`|x|` petit = près du zénith) :
 * `alt = √(1 − x²) = sin(azimut)`. Même heure, MÊME soleil que le reste du monde ; ce module
 * n'en tire qu'une VRAIE direction 3D pour le spéculaire. (Nourrir le spéculaire du vecteur plan
 * brut donnerait, à midi, une nappe blanche : `x = 0` s'y lit « lumière droit devant ». D'où la
 * hauteur reconstruite. La nuit, `sunDirection` rend `{0,0}` → soleil au zénith, mais `uDay=0`
 * l'éteint : pas de garde de nuit à ajouter.)
 */
/**
 * LES FENÊTRES DU CHEMIN DE L'ASTRE (spec eau-vivante R12) — pure de l'heure et du jour :
 * l'aube et le couchant allument un couloir CHAUD quand le soleil rase ; la nuit claire,
 * la lune en tient un d'OS, plus discret. Pentes continues partout (règle maison).
 * L'azimut du couloir vient de `sunDirection` (source unique) ; la lune, que la sim ne
 * connaît pas, prend un couchant figé — une direction inventée mais CONSTANTE.
 */
export function cheminDeLAstre(hour: HeureSolaire, day: number, jourLune = LUNE_PLEINE_JOUR): { force: number; col: [number, number, number]; dirX: number } {
  const rampe = (h: number, a: number, b: number, c: number, d: number): number =>
    h <= a || h >= d ? 0 : h < b ? (h - a) / (b - a) : h <= c ? 1 : 1 - (h - c) / (d - c)
  const aube = rampe(hour, 5.6, 6.3, 7.2, 8.3)
  const couchant = rampe(hour, 16.6, 17.4, 18.6, 19.6)
  const soleil = Math.max(aube, couchant)
  if (soleil > 0) {
    return { force: soleil, col: [1.0, 0.62, 0.3], dirX: sunDirection(hour).x || (aube > 0 ? 1 : -1) }
  }
  // La lune : la nuit franche seulement (le jour l'éteint). Son couloir suivait un couchant
  // FIGÉ (`dirX: -0.4`, « une direction inventée mais CONSTANTE ») faute que la sim connaisse
  // la lune. Elle la connaît depuis le 2026-08-25 : le couloir vient de `moonDirection`, comme
  // celui du soleil vient de `sunDirection`, et sa force suit la PHASE — une nouvelle lune ne
  // pose aucun couloir sur l'eau, ce qui est exactement ce qu'on voit dehors.
  const lune = Math.max(0, 1 - day / 0.06) * 0.5 * clarteDeLune(jourLune)
  return { force: lune, col: [0.75, 0.8, 0.88], dirX: moonDirection(hour, jourLune).x || -0.4 }
}

/** La direction PLANE d'un astre (`sunDirection`/`moonDirection`) relevée en VRAIE direction
 *  3D pour le spéculaire — une seule recette pour les deux astres, sinon leurs éclats
 *  divergeraient d'une constante qu'on ne saurait plus calibrer. */
function astreVector(gx: number): { x: number; y: number; z: number } {
  const alt = Math.sqrt(Math.max(0, 1 - gx * gx)) // sin(azimut) : 0 à l'horizon, 1 au zénith
  const grazing = 1 - 0.7 * alt
  return {
    x: gx * grazing,
    y: -0.3 * grazing, // biais NORD fixe (comme le SUN_NORTH du pipeline) : la lumière vient d'en haut
    z: 0.3 + 0.85 * alt,
  }
}

function sunVector(hour: HeureSolaire): { x: number; y: number; z: number } {
  // la source UNIQUE : est(+) → ouest(−), |x| = force au ras
  return astreVector(sunDirection(hour).x)
}

export class WaterLayer {
  /** Un quad par palier qui porte de l'eau (voir `uPalierVu`) — un seul sur une carte plate. */
  private shaders: { palier: number; shader: Phaser.GameObjects.Shader }[] = []
  /** LA NUIT AUX PALIERS HAUTS — la même teinte plate que les pavés (`PaveLayer.teinte`) : le
   *  voile ne monte pas jusqu'aux strates des terrasses, l'eau y porte sa nuit elle-même. */
  teinte = 0xffffff
  /** Le palier de chaque tuile, cuit dans le canal B du champ — regardé à la recuisson de la
   *  suie, qui rebâtit le champ entier. */
  private readonly palierParTuile: Uint8Array | null
  private fieldKey: string | null = null
  private riveKey: string | null = null
  private fondKey: string | null = null
  /** Le champ de rive (spec eau-vivante R1-R2) — la MÊME distance que le shader, lisible
   *  CPU (`riveAt`) : immersion des acteurs, événements de franchissement, volume du
   *  clapotis. Nul si la carte est sèche. */
  readonly rive: RiveField | null = null
  /** LE SDF DU MARAIS (peche.md R13) — la même distance signée, pour le sol mou. */
  readonly vase: RiveField | null = null
  /** Le champ de courant (« l'eau suit le flow ») — la MÊME donnée que le shader, lisible
   *  CPU : les feuilles dérivent dessus. Nul si la carte n'a pas de rivière. */
  readonly flow: FlowField | null = null
  /** La période du fondu dual-phase (s) — la sonde smoke mesure l'advection entre deux
   *  instants espacés d'exactement T (même état de fondu : seule la translation reste). */
  readonly dualT = DUAL_T
  /** Le dernier jour de saison dont le BIEF SOUILLÉ a été recuit (cendre.md R26d). */
  private jourDeSuie = Number.NaN

  /**
   * ═══ LE RÉGIME DE L'EAU (geste 10 + cendre.md R26d) ═══
   * LE LAC MORT : « une eau parfaitement immobile, trop claire, sans un poisson » — l'EAU de
   * la zone porte son régime, une lecture du terrain, zéro changement /sim. ET LE BIEF
   * SOUILLÉ : la loi `eauSouillee` de la sim, lue TELLE QUELLE (`EtatDeCendre` est la forme
   * que le rendu tient déjà pour `tuileCendree`) — jamais une recopie. Sans état de cendre
   * (le premier bake, avant le premier snapshot), seul le lac mort est posé.
   */
  private regimeDe(etat?: EtatDeCendre): Uint8Array {
    const { width, height } = this.map
    const terr = this.map.terrain
    const regime = new Uint8Array(width * height)
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx
        const t = terr[i]
        if (t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER) continue
        if (zoneSlugAt(this.map, tx, ty) === 'lac_mort') regime[i] = REGIME_LAC_MORT
        else if (etat && eauSouillee(etat, tx, ty)) regime[i] = REGIME_SUIE
      }
    }
    return regime
  }

  /**
   * LA RECUISSON DU BIEF (cendre.md R26d) — une fois par bascule de jour de saison : la
   * souillure suit l'âge des foyers, qui n'avance qu'au jour. Repeint le canal B du champ
   * dans SA texture — le masque, la profondeur et les anneaux repartent du même bake.
   */
  recuireSuie(etat: EtatDeCendre, jour: number): void {
    if (!this.fieldKey || jour === this.jourDeSuie) return
    this.jourDeSuie = jour
    const { width, height } = this.map
    const field = buildWaterField(this.map.terrain, width, height, this.regimeDe(etat), this.palierParTuile ?? undefined)
    const tex = this.scene.textures.get(this.fieldKey) as Phaser.Textures.CanvasTexture
    if (!tex || !('getContext' in tex)) return
    const ctx = tex.getContext()
    const img = ctx.createImageData(width, height)
    img.data.set(field.data)
    ctx.putImageData(img, 0, 0)
    tex.refresh()
    // `refresh()` RÉUPLOADE via canvasToTexture, qui REMET LE FILTRE À LINEAR dès que le jeu
    // tourne en `antialias` (Phaser 4, WebGLRenderer.canvasToTexture) : le NEAREST posé à la
    // création ne survit pas à la première recuisson. Vu le 2026-09-03 sur les drapeaux de
    // chute — le canal R interpolé entre deux tuiles (1 et 32, 32 et 64) fabriquait des bits
    // de rideau sur toute la tuile, et le shader peignait des tirets là où il n'y a pas de
    // rideau. Le masque de rive y perdait aussi ses coins carrés. Le filtre se REPOSE après
    // chaque refresh.
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    /** La texture du terrain baké (1 px/tuile) — elle sert de FOND réfracté. */
    seabedKey: string,
    /** Le relief cuit (`render/relief.ts`) : le palier de chaque tuile. Absent ou inactif, un
     *  seul quad au palier 0, comme avant les terrasses. */
    relief?: Relief,
  ) {
    const { width, height } = map
    // LES PALIERS QUI PORTENT DE L'EAU (T-R7) : un quad chacun, pas un de plus — un quad plein
    // écran qui ne peint rien coûte quand même son passage sur chaque pixel.
    let palierParTuile: Uint8Array | null = null
    let paliersMouilles = 1 // masque de bits : le palier 0 toujours
    if (relief?.actif) {
      palierParTuile = new Uint8Array(width * height)
      paliersMouilles = 0
      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          const i = ty * width + tx
          const p = relief.palier(tx, ty)
          palierParTuile[i] = p
          const t = map.terrain[i]
          if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) paliersMouilles |= 1 << p
        }
      }
    }
    this.palierParTuile = palierParTuile
    // ═══ LE RÉGIME DE L'EAU (geste 10) ═══
    // LE LAC MORT : « une eau parfaitement immobile, trop claire, sans un poisson »
    // (worldgen.md, case fantastique). L'EAU de la zone porte son régime — le rendu
    // seul : le lore reste une décision d'Alexis. (L'eau morte du marais a été retirée :
    // regardée, refusée le 2026-07-26.) Zéro changement /sim : une lecture du terrain.
    // Carte plate : le canal G du champ porte la profondeur case à case (geste 01).
    // (Le régime du PREMIER bake ne porte que le lac mort — la suie arrive au premier
    //  snapshot, par `recuireSuie` ; le fond, lui, garde le régime statique : la teinte du
    //  bief est l'affaire du champ d'eau, pas du lit.)
    const regime = this.regimeDe()
    const field = buildWaterField(map.terrain, width, height, regime, palierParTuile ?? undefined)
    if (!field.hasWater) return // une carte sèche ne paie pas une couche d'eau

    // Le champ vit dans une texture canvas : 1 px/tuile, comme le bake du sol.
    const key = 'water-field'
    this.fieldKey = key
    const tex = this.scene.textures.createCanvas(key, width, height)
    if (!tex) return
    const ctx = tex.getContext()
    const img = ctx.createImageData(width, height)
    img.data.set(field.data)
    ctx.putImageData(img, 0, 0)
    tex.refresh()
    // NEAREST, comme le sol et le Feu. Le masque binaire reste 0 ou 1 : le bord de
    // l'eau tombe pile sur la frontière des tuiles, les coins sont CARRÉS, et
    // l'ancienne encoche bleue (l'iso-contour 0,5 du filtrage linéaire qui rognait les
    // angles convexes et découvrait la tuile d'eau bakée du sol) n'existe plus. C'est
    // ce même filtre qui rend berge, écume et clapot chunky — pixel-art, pas marbre.
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST)

    // LE CHAMP DE RIVE (spec eau-vivante R1) : le SDF de berge, dans SA texture — le champ
    // d'eau garde son masque binaire (le trait) et son canal G (réservé au relief).
    const rive = buildRiveField(map.terrain, width, height)
    ;(this as { rive: RiveField | null }).rive = rive
    // ═══ LE CHAMP DE VASE (peche.md R13, 2026-08-24) — le MÊME SDF, un autre milieu ═══
    // Le marais est un sol mou où l'on s'enfonce, et « s'enfoncer » est une PENTE, pas une
    // marche : sans ce champ, franchir l'arête d'une tuile faisait descendre le corps d'un
    // coup. Sans texture — il ne sert qu'au CPU (l'immersion des acteurs), pas au shader.
    ;(this as { vase: RiveField | null }).vase = buildRiveField(map.terrain, width, height, MILIEU_VASE, false)
    // LE COURANT (« l'eau suit le flow ») : le champ de flow-field.ts, cuit dans les
    // canaux G/B de la MÊME texture (128 + dir×112 ; 128 pile = pas de courant — le
    // défaut que buildRiveField pose déjà partout). Le shader advecte le clapot avec.
    const flow = buildFlowField(map)
    ;(this as { flow: FlowField | null }).flow = flow
    if (flow) {
      for (const [j, v] of flow.courant) {
        rive.data[j * 4 + 1] = Math.round(128 + Math.max(-1, Math.min(1, v.x)) * 112)
        rive.data[j * 4 + 2] = Math.round(128 + Math.max(-1, Math.min(1, v.y)) * 112)
      }
    }
    const riveKey = 'water-rive'
    this.riveKey = riveKey
    const riveTex = this.scene.textures.createCanvas(riveKey, width, height)
    if (riveTex) {
      const rctx = riveTex.getContext()
      const rimg = rctx.createImageData(width, height)
      rimg.data.set(rive.data)
      rctx.putImageData(rimg, 0, 0)
      riveTex.refresh()
      riveTex.setFilter(Phaser.Textures.FilterMode.NEAREST) // le bilinéaire est MANUEL, dans le shader
    }

    // LA MÉMOIRE DU FOND (geste 03) : le lit inféré — sable/galets/vase/algues — dans
    // sa texture 1 px/tuile. La réfraction et le lit visible le lisent à la place du
    // bake ; le bake reste la vérité de la couleur de rive.
    //
    // UPLOAD DIRECT depuis le tableau typé (`addUint8Array`, budget A10) : le chemin
    // canvas (createCanvas + putImageData + readback à l'upload) coûtait ~2 copies
    // plein-cadre de 15 Mo de plus sur SwiftShader — la 3e texture d'eau faisait
    // déborder le boot (1 382-1 489 ms mesurés contre 700-900 avant elle). A = 255
    // partout : la prémultiplication est l'identité, l'upload brut est sûr.
    const fond = buildFondField(map.terrain, rive.sd, flow?.courant ?? null, width, height, regime)
    const fondKey = 'water-fond'
    this.fondKey = fondKey
    const fondTex = this.scene.textures.addUint8Array(
      fondKey,
      new Uint8Array(fond.buffer, fond.byteOffset, fond.byteLength),
      width,
      height,
    )
    fondTex?.setFilter(Phaser.Textures.FilterMode.NEAREST) // des aplats de tuile, comme le bake

    const worldW = width * TILE_PX
    const worldH = height * TILE_PX

    // Le quad du palier `p` se pose `p × lift` plus haut que le monde : son pixel (x, y) montre
    // la tuile logique (x, y + p × lift), exactement comme une part de pavés (`pave-layer.ts`).
    // Le shader, lui, travaille en tuiles LOGIQUES (les feux, les marcheurs, la caméra lui
    // arrivent ainsi) : rien à défaire, seule la position du quad change.
    for (let p = 0; paliersMouilles >> p; p++) {
      if (!(paliersMouilles & (1 << p))) continue
      const shader = this.creerQuad(p, worldW, worldH, key, seabedKey, riveKey, fondKey)
      this.shaders.push({ palier: p, shader })
    }
  }

  private creerQuad(
    palier: number, worldW: number, worldH: number,
    key: string, seabedKey: string, riveKey: string, fondKey: string,
  ): Phaser.GameObjects.Shader {
    const { width, height } = this.map
    return this.scene.add
      .shader(
        {
          name: 'braises-water',
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            // ⚠ UN TABLEAU S'ADRESSE « nom[0] » — le nom WebGL d'un uniforme tableau EST
            // `uWaders[0]` (spec `getActiveUniform`), et le wrapper Phaser 4.2 indexe ses
            // uniformes sur ce nom BRUT : `setUniform('uWaders', …)` ne trouve rien et est
            // ignoré en silence (`if (!uniform) return`). MESURÉ (A/B au même instant, sonde
            // `guePierres`) : 0 pixel de remous à l'écran avec 5 émetteurs côté TS — anneaux,
            // sillage, turbidité ET reflets de feu, tous morts sans un mot. On pousse les
            // deux noms : l'inconnu est ignoré, le bon est servi, quel que soit le driver.
            const setTableau = (name: string, value: unknown): void => {
              setUniform(name, value)
              setUniform(name + '[0]', value)
            }
            setUniform('uField', 0)
            setUniform('uSeabed', 1)
            setUniform('uRive', 2)
            setUniform('uFond', 3)
            setUniform('uWorldPx', [worldW, worldH])
            setUniform('uMapTiles', [width, height])
            setUniform('uTilePx', TILE_PX)
            // Carte PLATE : plus de cisaillement de relief. `uReliefH = 0` neutralise le terme
            // `elev·H` du shader (l'écran EST le monde), le canal d'élévation du champ vaut 0.
            setUniform('uReliefH', 0)
            setUniform('uTime', this.timeS)
            setUniform('uSun', [this.sun.x, this.sun.y, this.sun.z])
            setUniform('uDay', this.day)
            setUniform('uLune', this.lune)
            setUniform('uMoonV', [this.moon.x, this.moon.y, this.moon.z])
            setUniform('uFireCount', this.fireCount)
            setTableau('uFires', this.fireData)
            setUniform('uWaderCount', this.waderCount)
            setUniform('uWaderPierre', this.waderPierre)
            setTableau('uWaders', this.waderData)
            setTableau('uWaderDirs', this.waderDirData)
            setUniform('uCam', [this.cam.x, this.cam.y])
            setUniform('uAstre', this.astre.force)
            setUniform('uAstreCol', this.astre.col)
            setUniform('uAstreDirX', this.astre.dirX)
            setUniform('uPh0', this.ph0)
            setUniform('uAdv0', this.adv0)
            setUniform('uAdv1', this.adv1)
            setUniform('uPalierVu', palier)
            setUniform('uTeinte', palier === 0 ? [1, 1, 1] : this.teinteVec())
          },
        },
        0,
        -palier * LIFT_TUILES * TILE_PX,
        worldW,
        worldH,
        [key, seabedKey, riveKey, fondKey],
      )
      .setOrigin(0, 0)
      .setDepth(WATER_DEPTH + strateDEtage(palier))
  }

  /** La teinte de nuit en vec3, mémoïsée sur sa valeur (poussée à chaque rendu de chaque quad). */
  private teinteCache: { teinte: number; vec: [number, number, number] } = { teinte: 0xffffff, vec: [1, 1, 1] }
  private teinteVec(): [number, number, number] {
    const t = this.teinte
    if (t !== this.teinteCache.teinte) {
      this.teinteCache = { teinte: t, vec: [((t >> 16) & 255) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255] }
    }
    return this.teinteCache.vec
  }

  /** Combien de quads d'eau sont posés — la sonde des terrasses (un par palier mouillé). */
  quadsVivants(): number {
    return this.shaders.length
  }

  private timeS = 0
  /** Les phases dual-phase, calculées CPU en double (voir les uniformes du shader). */
  private ph0 = 0
  private adv0 = -0.5 * DUAL_T * COURANT_VITESSE
  private adv1 = 0
  private sun = { x: 0, y: 0.3, z: 1 }
  private moon = { x: 0, y: 0.3, z: 1 }
  private day = 1
  /** La lueur de lune (phase × altitude) — le ciel nocturne réfléchi et l'éclat la suivent. */
  private lune = 0
  private cam = { x: 0, y: 0 }
  private astre: { force: number; col: [number, number, number]; dirX: number } = {
    force: 0,
    col: [1, 0.62, 0.3],
    dirX: 1,
  }
  private fireCount = 0
  /** vec4 par foyer, à plat (xy tuile · z portée · w force) — un seul tampon, muté par frame. */
  private readonly fireData = new Float32Array(MAX_FIRES * 4)
  /** vec4 par marcheur (xy tuile · z phase s · w force) — les remous (spec da-feeling R11). */
  private readonly waderData = new Float32Array(MAX_WADERS * 4)
  /** vec2 par marcheur : le cap normalisé du sillage (eau-vivante R6), {0,0} à l'arrêt. */
  private readonly waderDirData = new Float32Array(MAX_WADERS * 2)
  /** L'index de la première pierre dans `waderData` — voir `uWaderPierre`. */
  private waderPierre = 0
  private waderCount = 0

  /**
   * L'heure décide du soleil sur l'eau ; `fires` allume la nappe la nuit (reflet du camp) ;
   * `waders` fait naître les remous sous les pas (au-delà des plafonds : ignorés en silence).
   */
  update(
    nowMs: number,
    hour: HeureSolaire,
    daylight: number,
    fires: WaterFire[] = [],
    waders: WaterWader[] = [],
    camTile?: { x: number; y: number },
    /** Le jour de saison AVEC ses décimales — la phase de la lune, pour le couloir lunaire. */
    jourLune = LUNE_PLEINE_JOUR,
  ): void {
    if (this.shaders.length === 0) return
    this.timeS = nowMs / 1000
    this.ph0 = (this.timeS / DUAL_T) % 1
    this.adv0 = (this.ph0 - 0.5) * DUAL_T * COURANT_VITESSE
    this.adv1 = (((this.ph0 + 0.5) % 1) - 0.5) * DUAL_T * COURANT_VITESSE
    this.sun = sunVector(hour)
    this.moon = astreVector(moonDirection(hour, jourLune).x)
    this.day = daylight
    this.lune = lueurDeLune(hour, jourLune)
    this.astre = cheminDeLAstre(hour, daylight, jourLune)
    if (camTile) this.cam = camTile
    const n = Math.min(MAX_FIRES, fires.length)
    this.fireCount = n
    for (let i = 0; i < n; i++) {
      const f = fires[i]
      if (!f) continue
      const o = i * 4
      this.fireData[o] = f.x
      this.fireData[o + 1] = f.y
      this.fireData[o + 2] = f.radius
      this.fireData[o + 3] = f.strength
    }
    for (let i = n; i < MAX_FIRES; i++) this.fireData[i * 4 + 3] = 0 // slots morts : force nulle
    const m = Math.min(MAX_WADERS, waders.length)
    this.waderCount = m
    // LA FRONTIÈRE MARCHEURS/PIERRES : l'index du premier drapeau `pierre` (les pierres sont
    // EN QUEUE par contrat d'appel — WorldScene les pousse après les marcheurs). Sans pierre,
    // la frontière vaut m : la turbidité couvre tout le monde, comme avant.
    const premierePierre = waders.findIndex((w) => w.pierre === true)
    this.waderPierre = premierePierre < 0 ? m : Math.min(premierePierre, m)
    for (let i = 0; i < m; i++) {
      const wd = waders[i]
      if (!wd) continue
      const o = i * 4
      this.waderData[o] = wd.x
      this.waderData[o + 1] = wd.y
      this.waderData[o + 2] = wd.phase
      this.waderData[o + 3] = wd.strength
      this.waderDirData[i * 2] = wd.dirX
      this.waderDirData[i * 2 + 1] = wd.dirY
    }
    for (let i = m; i < MAX_WADERS; i++) {
      this.waderData[i * 4 + 3] = 0
      this.waderDirData[i * 2] = 0
      this.waderDirData[i * 2 + 1] = 0
    }
  }

  destroy(): void {
    for (const q of this.shaders) q.shader.destroy()
    this.shaders = []
    if (this.fieldKey) this.scene.textures.remove(this.fieldKey)
    if (this.riveKey) this.scene.textures.remove(this.riveKey)
    if (this.fondKey) this.scene.textures.remove(this.fondKey)
  }
}
