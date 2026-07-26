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
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { sunDirection } from '../../render/lighting'
import { buildRiveField, buildWaterField, type RiveField } from '../../render/water-field'

/** Juste au-dessus du sol (−1), sous l'ombre du relief (−0,5) : le versant qui
 *  tombe dans l'eau l'assombrit, comme il assombrit la berge. */
const WATER_DEPTH = GROUND_MAP_DEPTH + 0.25

/** Plafond de foyers reflétés — DOIT égaler le `MAX_FIRES` du shader. */
const MAX_FIRES = 8

/** Plafond de marcheurs à remous — DOIT égaler le `MAX_WADERS` du shader. */
const MAX_WADERS = 8

/** Un acteur qui marche dans le haut-fond : il émet des anneaux (spec da-feeling R11). */
export interface WaterWader {
  /** Position, en TUILES. */
  x: number
  y: number
  /** Décalage de phase (s) : les anneaux de deux marcheurs ne battent pas ensemble. */
  phase: number
  /** Force 0..1 — pleine en marche, s'éteint en ~0,7 s après l'arrêt. */
  strength: number
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

uniform sampler2D uField;    // R masque (binaire) · G élévation · B profondeur
uniform sampler2D uSeabed;   // le bake du terrain : le FOND, vu à travers l'eau
uniform sampler2D uRive;     // R : distance SIGNÉE à la rive (+eau/−terre), 128 = la rive — spec eau-vivante R1
uniform vec2 uWorldPx;       // taille du monde, en pixels
uniform vec2 uMapTiles;      // taille du monde, en tuiles
uniform float uTilePx;
uniform float uReliefH;
uniform float uTime;         // secondes
uniform vec3 uSun;           // le soleil, en 3D — voir sunVector()
uniform float uDay;          // 0 nuit · 1 plein jour

// LES FEUX SUR L'EAU. Une poignée de foyers, poussés chaque frame depuis l'état sim (même
// fireGlow que la flaque au sol et le trou du voile → en phase). xy = tuile du foyer,
// z = portée (tuiles), w = force (0..1, ∝ nuit·flicker : nulle de jour, vive la nuit).
#define MAX_FIRES 8
uniform int uFireCount;
uniform vec4 uFires[MAX_FIRES];
#define MAX_WADERS 8
uniform int uWaderCount;
uniform vec4 uWaders[MAX_WADERS]; // xy tuile · z phase (s) · w force (s'éteint après l'arrêt)

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

float maskAt(vec2 tile) { return texture2D(uField, texUv(tile)).r; }
float elevAt(vec2 tile) { return texture2D(uField, texUv(tile)).g; }

/** Hash de cellule SANS sinus (polynôme de permutation mod 289, 3 étages — le patron
 *  éprouvé de la brume) : portable au bit près, sert aux plaques d'écume et à la frange
 *  du sol humide. */
float permute(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float cellHash(vec2 c) {
  vec2 p = mod(c, 289.0);
  return fract(permute(permute(permute(p.x) + p.y) + p.x) / 289.0);
}

/** LA DISTANCE À LA RIVE (spec eau-vivante R1-R2) : le SDF de berge, lu en BILINÉAIRE
 *  MANUEL (la texture reste NEAREST — on interpole nous-mêmes 4 texels) : une distance
 *  CONTINUE, sous-tuile, qui croise 0 pile sur le trait de rive du masque binaire. */
float riveTexel(vec2 tile) { return (texture2D(uRive, texUv(tile)).r - 0.501960784) * 15.9375; }
float rive(vec2 tile) {
  vec2 p = tile - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  float a = riveTexel(i + vec2(0.5, 0.5));
  float b = riveTexel(i + vec2(1.5, 0.5));
  float c = riveTexel(i + vec2(0.5, 1.5));
  float d = riveTexel(i + vec2(1.5, 1.5));
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
  vec2 q = p + 0.25 * vec2(sin(p.y * 1.3 + t * 0.5), cos(p.x * 1.1 - t * 0.4));
  float h = 0.0;
  h += 0.60 * sin(dot(q, vec2(0.92, 0.39)) * 1.9 + t * 1.3);
  h += 0.30 * sin(dot(q, vec2(-0.44, 0.90)) * 3.1 - t * 1.7);
  h += 0.14 * sin(dot(q, vec2(0.31, -0.95)) * 5.3 + t * 2.2);
  return h * 0.62;
}

// LE GRAIN. 4 px monde — exactement le pixel de lumière du Feu (fire-ground-glow.ts,
// LIGHT_PX), lui-même multiple de la grille 2 px de l'art. Toute l'eau se calcule PAR
// CELLULE de 4 px : c'est ce qui la rend pixel-art, du même monde que le reste.
const float GRAIN = 4.0;

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
  float lo = flatPx.y / uTilePx;
  float hi = lo + uReliefH / uTilePx;
  for (int i = 0; i < 12; i++) {
    float mid = 0.5 * (lo + hi);
    float screenY = mid * uTilePx - elevAt(vec2(tx, mid)) * uReliefH;
    if (screenY < flatPx.y) lo = mid; else hi = mid;
  }
  float ty = 0.5 * (lo + hi);
  vec2 tile = vec2(tx, ty);
  vec2 uv = tile / uMapTiles;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  vec4 field = texture2D(uField, texUv(tile));
  float mask = field.r;
  float dRive = rive(tile); // + dans l'eau, − sur terre, 0 sur le trait de rive

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
    gl_FragColor = vec4(vec3(0.16, 0.14, 0.09) * aH, aH);
    return;
  }

  float open = openness(tile);            // 0 contre la berge · 1 au large
  // La vase du fond monte VITE en s'éloignant de la berge : une eau de pré est trouble, on ne voit
  // pas loin. Rampe resserrée → le marron du fond couvre l'essentiel du plan d'eau, pas juste son cœur.
  float deep = field.b * smoothstep(0.03, 0.35, open);
  float t = uTime;

  // Le clapot meurt sur les hauts-fonds : on ne clapote pas dans deux doigts d'eau.
  float amp = 0.35 + 0.65 * smoothstep(0.0, 0.45, open);
  vec2 p = tile * PLANE; // le plan de l'eau, redressé (voir YSQUASH)
  float h = chop(p, t) * amp;

  // La normale, par différences finies — prises DANS LE PLAN de l'eau, puis
  // ramenées à l'écran : la pente en Y y est vue de biais, donc raccourcie. Le pas
  // vaut une CELLULE (4 px) : une normale au grain de l'image, pas plus fine qu'elle.
  float e = GRAIN / uTilePx;
  float hx = (chop(p + vec2(e, 0.0), t) - chop(p - vec2(e, 0.0), t)) * amp;
  float hy = (chop(p + vec2(0.0, e), t) - chop(p - vec2(0.0, e), t)) * amp;
  vec3 n = normalize(vec3(-hx * 0.85, -hy * 0.85 / YSQUASH, 1.0));

  // LA RÉFRACTION. On rééchantillonne le FOND (le bake du terrain) décalé par la
  // normale : le fond ondule sous la surface. Le décalage s'annule contre la
  // berge — sinon il irait chercher l'herbe d'à côté et la peindrait dans l'eau.
  vec2 refr = tile + (n.xy / PLANE) * 0.55 * (1.0 - deep) * smoothstep(0.0, 0.4, open);
  vec3 bed = texture2D(uSeabed, texUv(refr)).rgb; // le bake est retourné comme le champ

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
  // ═══ LE LIT VISIBLE (spec eau-vivante R10') — l'eau montre son fond avant de se saturer ═══
  // Près du trait de rive, le VRAI lit (le bake réfracté) gagne, par crans francs : on
  // devine le sable et la vase du bord, puis l'eau prend le dessus en ~1 tuile. C'est le
  // volume vertical qui manquait — et il donne au haut-fond clair son CONTEXTE (le « banc
  // de sable » consigné se lit désormais comme le bord qu'il est).
  float litGagne = 1.0 - clamp((dRive - 0.15) / 0.85, 0.0, 1.0);
  litGagne = floor(litGagne * 3.0 + 0.5) / 3.0;
  bottom = mix(bottom, bed * (0.72 + 0.34 * bedLum), litGagne * 0.55);

  // Le ciel réfléchi : bleu pâle de jour, éteint la nuit (uDay), réchauffé quand le soleil rase.
  // Le ciel réfléchi, UN CRAN plus profond (0.52,0.62,0.70 → lac de montagne) : le gradient
  // de réflexion (la doctrine R45) est intact, mais le large cesse d'être plus CLAIR que le
  // gué — c'est lui qui plafonnait le contraste de lisibilité (mesuré 1,29:1 puis 1,11:1).
  vec3 daySky = vec3(0.34, 0.45, 0.56);
  vec3 nightSky = vec3(0.05, 0.08, 0.13);
  vec3 sky = mix(nightSky, daySky, uDay);
  sky += vec3(0.12, 0.05, -0.03) * uDay * max(0.0, 1.0 - uSun.z); // chaleur au ras du matin/soir

  // La part de ciel : un socle (l'eau en réfléchit toujours un peu), FORTE au large, faible sur le
  // gué (là on regarde le fond presque à la verticale). C'est ce mélange qui remplace le marron
  // uniforme — le fond reste brun là où on le voit, le large prend la lumière du ciel.
  float skyMix = clamp(0.16 + 0.69 * deep, 0.0, 0.9);
  vec3 col = mix(bottom, sky, skyMix);

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
  col += vec3(1.0, 0.97, 0.88) * glint * 0.38 * uDay;

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
  for (int i = 0; i < MAX_WADERS; i++) {
    if (i >= uWaderCount) break;
    vec4 wd = uWaders[i];
    if (wd.w <= 0.0) continue;
    float dw = length(tile - wd.xy);
    float age = fract((t - wd.z) * 1.15);      // un anneau tous les ~0,87 s
    float r = 0.25 + age * 1.5;                // il naît au pied, meurt à ~1,75 tuile
    // Largeur ≈ la CELLULE (4 px = 0,25 tuile) : plus fin, l'anneau raterait les cellules du grain.
    float band = step(abs(dw - r), 0.27) * (1.0 - age) * (1.0 - step(1.9, dw));
    // Le second anneau, en quinconce : la traîne du pas précédent.
    float age2 = fract((t - wd.z) * 1.15 + 0.5);
    float r2 = 0.25 + age2 * 1.5;
    band += step(abs(dw - r2), 0.22) * (1.0 - age2) * 0.6 * (1.0 - step(1.9, dw));
    ripple += band * wd.w;
  }
  // La crête du remous ÉCLAIRCIT (l'eau retournée prend la lumière) — un palier, pas un halo.
  col = mix(col, col * 1.3 + vec3(0.07, 0.07, 0.05), clamp(ripple, 0.0, 1.0) * 0.6);

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
  col = mix(col, shoreCol, clamp(rim * 0.26 + lap * 0.28, 0.0, 0.5));

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
  col = mix(col, ecumeCol * 0.82, clamp(dansEcume * 0.38 + bande2 * 0.2, 0.0, 0.6));
  col = mix(col, ecumeCol, crete2 * 0.55);

  // Translucide sur le gué, opaque au large : on voit où l'on passe. PAS de fondu
  // d'alpha au bord : sinon l'eau devient transparente pile sur la rive et laisse
  // transparaître la tuile d'eau du SOL (bakée en cyan clair) — le liseré clair.
  // On garde donc l'eau assez opaque jusqu'à sa ligne de coupe, bord net.
  float a = mix(0.88, 0.96, deep);
  gl_FragColor = vec4(col, a);
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
function sunVector(hour: number): { x: number; y: number; z: number } {
  const gx = sunDirection(hour).x // la source UNIQUE : est(+) → ouest(−), |gx| = force au ras
  const alt = Math.sqrt(Math.max(0, 1 - gx * gx)) // sin(azimut) : 0 à l'horizon, 1 au zénith
  const grazing = 1 - 0.7 * alt
  return {
    x: gx * grazing,
    y: -0.3 * grazing, // biais NORD fixe (comme le SUN_NORTH du pipeline) : la lumière vient d'en haut
    z: 0.3 + 0.85 * alt,
  }
}

export class WaterLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  private fieldKey: string | null = null
  private riveKey: string | null = null
  /** Le champ de rive (spec eau-vivante R1-R2) — la MÊME distance que le shader, lisible
   *  CPU (`riveAt`) : immersion des acteurs, événements de franchissement, volume du
   *  clapotis. Nul si la carte est sèche. */
  readonly rive: RiveField | null = null

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    /** La texture du terrain baké (1 px/tuile) — elle sert de FOND réfracté. */
    seabedKey: string,
  ) {
    const { width, height } = map
    // Carte plate : plus de champ d'élévation (le canal G du champ d'eau reste à 0).
    const field = buildWaterField(map.terrain, undefined, width, height)
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

    const worldW = width * TILE_PX
    const worldH = height * TILE_PX

    this.shader = this.scene.add
      .shader(
        {
          name: 'braises-water',
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uField', 0)
            setUniform('uSeabed', 1)
            setUniform('uRive', 2)
            setUniform('uWorldPx', [worldW, worldH])
            setUniform('uMapTiles', [width, height])
            setUniform('uTilePx', TILE_PX)
            // Carte PLATE : plus de cisaillement de relief. `uReliefH = 0` neutralise le terme
            // `elev·H` du shader (l'écran EST le monde), le canal d'élévation du champ vaut 0.
            setUniform('uReliefH', 0)
            setUniform('uTime', this.timeS)
            setUniform('uSun', [this.sun.x, this.sun.y, this.sun.z])
            setUniform('uDay', this.day)
            setUniform('uFireCount', this.fireCount)
            setUniform('uFires', this.fireData)
            setUniform('uWaderCount', this.waderCount)
            setUniform('uWaders', this.waderData)
          },
        },
        0,
        0,
        worldW,
        worldH,
        [key, seabedKey, riveKey],
      )
      .setOrigin(0, 0)
      .setDepth(WATER_DEPTH)
  }

  private timeS = 0
  private sun = { x: 0, y: 0.3, z: 1 }
  private day = 1
  private fireCount = 0
  /** vec4 par foyer, à plat (xy tuile · z portée · w force) — un seul tampon, muté par frame. */
  private readonly fireData = new Float32Array(MAX_FIRES * 4)
  /** vec4 par marcheur (xy tuile · z phase s · w force) — les remous (spec da-feeling R11). */
  private readonly waderData = new Float32Array(MAX_WADERS * 4)
  private waderCount = 0

  /**
   * L'heure décide du soleil sur l'eau ; `fires` allume la nappe la nuit (reflet du camp) ;
   * `waders` fait naître les remous sous les pas (au-delà des plafonds : ignorés en silence).
   */
  update(nowMs: number, hour: number, daylight: number, fires: WaterFire[] = [], waders: WaterWader[] = []): void {
    if (!this.shader) return
    this.timeS = nowMs / 1000
    this.sun = sunVector(hour)
    this.day = daylight
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
    for (let i = 0; i < m; i++) {
      const wd = waders[i]
      if (!wd) continue
      const o = i * 4
      this.waderData[o] = wd.x
      this.waderData[o + 1] = wd.y
      this.waderData[o + 2] = wd.phase
      this.waderData[o + 3] = wd.strength
    }
    for (let i = m; i < MAX_WADERS; i++) this.waderData[i * 4 + 3] = 0
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
    if (this.fieldKey) this.scene.textures.remove(this.fieldKey)
    if (this.riveKey) this.scene.textures.remove(this.riveKey)
  }
}
