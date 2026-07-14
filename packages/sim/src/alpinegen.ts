/**
 * Le substrat alpin (SP1a) — champ d'élévation, d'humidité, et bandes de terrain
 * façon Whittaker. Pur et déterministe (noise.ts, arithmétique autorisée). Pas
 * d'hydrologie ni de features ici (SP1b). Toutes les échelles/amplitudes sont des
 * fractions de min(width,height) → scalable à toute taille.
 */
import { fbm2, fbmWarp2, hash2, ridgedFbm2 } from './noise'
import { boxBlur } from './geometry'
import { createEmptyMap, type WorldMap } from './map'
import { sealBorderRing } from './valleygen'
import { carveHydrology } from './alpine-hydro'
import {
  CARACTERES, derivePays, elevBiasAt, paysAt, paysToponymes, wetBiasAt,
  type Caractere, type Contree,
} from './pays'
import { placePois } from './poi'
import {
  TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW,
  TERRAIN_HEATH, TERRAIN_ALPINE_MEADOW, TERRAIN_PINE, TERRAIN_LARCH,
  TERRAIN_GLACIER, TERRAIN_BOULDERS, TERRAIN_FLOWER_MEADOW, TERRAIN_PEAT_BOG,
  TERRAIN_REED_MARSH, TERRAIN_ALPINE_FLOWERS, TERRAIN_BURNT_FOREST, TERRAIN_OLD_GROWTH,
  TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER, TERRAINS,
} from './balance'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Constantes de forme du relief — contenu de carte, réglées à la vignette.
 *  Le principe : une FORME DE VALLÉE macro (fond bas → murs hauts, dérivée de la
 *  distance au bord) donne la composition ; le bruit/les crêtes n'ajoutent que du
 *  détail organique par-dessus. Sans ça, l'intérieur est un bruit isotrope sans
 *  vallée (leçon vignette #1). */
export const ALPINE = {
  RIM_FRAC: 0.05,      // épaisseur de l'anneau de pics (fraction de min(W,H))
  RISE_FRAC: 0.62,     // à quelle fraction du demi-min les murs atteignent le sommet
                       //  (petit = fond large ; ~0.6 = « entre les deux »)
  ORGANIC_FRAC: 0.42,  // échelle du bruit macro qui brise le bol en vallée organique
  ORGANIC_AMP: 0.42,   // amplitude de cette déformation (spurs, combes, cols)
  DETAIL_FRAC: 0.14,   // échelle du détail de pente
  DETAIL_AMP: 0.16,    // amplitude du détail
  RIDGE_FRAC: 0.24,    // échelle des arêtes ridged
  RIDGE_AMP: 0.30,     // amplitude des crêtes (sur les pentes)
  WARP_FRAC: 0.06,     // amplitude de domain warping
  HILL_FRAC: 0.02,     // vallons À L'ÉCHELLE DU JEU (~24 tuiles) : le relief qu'on
                       //  voit en marchant (le reste est trop basse fréquence).
                       //  Appliqués APRÈS la gen (addReliefBumps), sur la TERRE
                       //  seulement — RENDU pur, invisibles à moisture/bandes/hydro.
  HILL_AMP: 0.1,       // amplitude des vallons (dosée : trop = repli du warp)
}

/**
 * Le relief et l'écoulement, calculés ENSEMBLE — ils partagent le champ
 * `org` (la déformation organique de la vallée), et le calculer deux fois
 * coûtait une passe de bruit entière pour rien : `fbmWarp2` est le poste de
 * dépense n°1 de la génération, et `org` en est un appel complet par tuile.
 * La fusion supprime la passe `flow` telle quelle (~10 % du temps total), au
 * bit près par construction — c'est littéralement la même expression.
 */
export interface AlpineRelief {
  /** Le relief RÉEL : forme de vallée + détail + crêtes, enceinte scellée. */
  elevation: number[]
  /**
   * Le champ d'ÉCOULEMENT — la même forme de vallée macro (enceinte + fond +
   * organique) SANS le détail ni les crêtes. L'eau le suit sans se piéger dans
   * les micro-cuvettes du relief fin ; l'hydrologie trace dessus, puis creuse
   * dans le terrain réel.
   *
   * (À ne pas confondre avec le `computeFlowField` de `pathfinding.ts`, qui est
   * le champ de distance des hordes — même mot, deux métiers.)
   */
  flow: number[]
}

export function computeRelief(width: number, height: number, seed: number): AlpineRelief {
  const D = Math.min(width, height)
  const rimDepth = Math.max(2, Math.round(D * ALPINE.RIM_FRAC))
  const rise = D * 0.5 * ALPINE.RISE_FRAC
  const organic = D * ALPINE.ORGANIC_FRAC
  const detailScale = D * ALPINE.DETAIL_FRAC
  const ridge = D * ALPINE.RIDGE_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const el = new Array<number>(width * height)
  const flow = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sud EXCLU (grand y = bord bas = vers la caméra) : la vallée s'ouvre de ce
      // côté, ni forme de vallée ni enceinte n'y montent → zéro repli du warp
      // (spec relief-continu §3). Fermeture sud = bord de carte (déjà bornant).
      const edge = Math.min(x, y, width - 1 - x)
      // Forme de vallée macro : 1 au bord (murs/pics) → 0 au fond (edge ≥ rise).
      const valley = 1 - Math.min(1, edge / rise)
      // Brise le bol concentrique → vallée organique (éperons, combes, cols).
      const org = ALPINE.ORGANIC_AMP * (fbmWarp2(x, y, organic, (seed ^ 0x1a2b3c) | 0, warp) - 0.5)
      const rim = clamp01((rimDepth - edge) / rimDepth) // enceinte : bord toujours haut
      const i = y * width + x

      // Détail de pente + arêtes ridged (petite amplitude, texture sur les murs).
      const detail = ALPINE.DETAIL_AMP * (fbmWarp2(x, y, detailScale, (seed ^ 0x4d5e6f) | 0, warp) - 0.5)
      const crest = ALPINE.RIDGE_AMP * (ridgedFbm2(x, y, ridge, (seed ^ 0x7a8b9c) | 0) - 0.4)
      el[i] = clamp01(Math.max(rim, valley + org + detail + crest))

      // PAS de clamp/max sur l'écoulement : ce champ ne sert qu'à LOCALISER (lac =
      // min, tête de vallée = max). Clamper le fond à 0 créait une vaste zone plate
      // d'où le min sortait toujours au même endroit (nord). `valley+org+rim` a un
      // vrai minimum unique (org le plus négatif dans le fond) qui varie avec la
      // seed ; le rim ne fait que rehausser le bord.
      flow[i] = valley + org + rim
    }
  }
  return { elevation: el, flow }
}

/** Le seul relief, pour qui n'a pas besoin de l'écoulement (tests, outils). */
export function computeElevation(width: number, height: number, seed: number): number[] {
  return computeRelief(width, height, seed).elevation
}

export function computeMoisture(width: number, height: number, elevation: number[], seed: number): number[] {
  const D = Math.min(width, height)
  const scale = D * 0.3
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const m = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const noise = fbmWarp2(x, y, scale, (seed ^ 0x2fed01) | 0, warp)
      // Surtout piloté par le bruit (poches humides localisées) + un léger biais
      // basse altitude — sinon TOUT le fond devient marais. Le fond reste de
      // l'alpage, le marais ne prend que les vraies cuvettes détrempées.
      m[i] = clamp01(0.8 * noise + 0.2 * (1 - elevation[i]!))
    }
  }
  return m
}

/** Seuils de bande (altitude) et d'humidité — contenu de carte, réglés à la
 *  vignette. Les terrains MINÉRAUX (scree/rock/snow) restent en bandes hautes
 *  disjointes → l'ordre altitude↔terrain reste structurel (testé). La variété
 *  vient du 2e axe (humidité × quartiers macro) DANS les bandes basses. */
export const BANDS = {
  FLOOR: 0.32,    // < FLOOR : fond de vallée (prairie / marais / lande)
  LARCH: 0.48,    // LARCH..FOREST : haut de la forêt = mélèzes épars (limite des arbres)
  FOREST: 0.55,   // FLOOR..FOREST : pentes boisées (dense ↔ éparse selon humidité)
  ALPINE: 0.64,   // FOREST..ALPINE : alpage d'altitude (pelouse au-dessus des arbres)
  SCREE: 0.73,    // ALPINE..SCREE : éboulis
  SNOW: 0.83,     // SCREE..SNOW : roche
  GLACIER: 0.95,  // SNOW..GLACIER : neige ; ≥ GLACIER : glace (glacier rare, plus hauts sommets)
  /**
   * Fond très humide → zone humide (tourbière / roselière).
   *
   * ÉTAIT À 0,70, ET NE SE DÉCLENCHAIT JAMAIS. Mesuré sur la vraie carte : sur le
   * fond de vallée (`el < FLOOR`), `wet` a pour médiane 0,41-0,48 et pour **maximum
   * 0,65 à 0,72** selon la seed — le seuil était donc AU NIVEAU DU MAXIMUM. Résultat :
   * `peat_bog` et `reed_marsh` étaient **absents de la carte** (0,00 % sur les seeds
   * 2026 et 42 ; 0,06 % sur la 7), et avec eux mouraient les deux terrains les plus
   * lents du jeu (0,45 et 0,55) et le seul lieu qui les habite (la Fondrière, dont
   * ZÉRO tuile de la carte satisfaisait le biome).
   *
   * Ce n'était pas une intention, c'était un chiffre qui a raté : le commentaire
   * d'origine (2026-07-07) dit « le fond reste de l'alpage, le marais ne prend que
   * les vraies cuvettes détrempées » — le marais devait exister, en poches.
   *
   * 0,58 = le p90 du fond, à peu près : **le dixième le plus détrempé de la vallée**
   * devient zone humide. Mesuré : 11,6 % / 15,4 % / 1,7 % du fond selon la seed —
   * l'écart est VOULU (une vallée a le droit d'être plus sèche qu'une autre), et
   * aucune n'est à zéro.
   */
  MARSH_WET: 0.58,
  HEATH_WET: 0.30,   // fond sec → lande (bruyère)
  FOREST_WET: 0.34,  // pente humide → forêt dense ; sinon adret sec (arbres épars sur lande)
}

/**
 * Terrain d'une tuile selon ALTITUDE × HUMIDITÉ (`wet` = humidité locale + biais
 * macro des quartiers). Le fond se décline en marais/prairie/lande ; les pentes
 * en forêt dense (ubac humide) ou clairsemée sur lande (adret sec) ; puis un
 * alpage d'altitude, puis le minéral. `tx,ty,seed` servent au grain fin
 * (trouées de forêt / arbres épars). Encourage l'exploration : chaque quartier
 * a un caractère.
 */
function bandFor(elevation: number, wet: number, tx: number, ty: number, seed: number): number {
  if (elevation < BANDS.FLOOR) {
    if (wet > BANDS.MARSH_WET) {
      // Zone humide : tourbière (le plus détrempé) ou roselière.
      return fbm2(tx, ty, 10, (seed ^ 0x0b06) | 0) < 0.5 ? TERRAIN_PEAT_BOG : TERRAIN_REED_MARSH
    }
    if (wet < BANDS.HEATH_WET) return TERRAIN_HEATH // fond sec = lande
    return TERRAIN_GRASS // prairie (les prés fleuris/blocs sont semés ensuite)
  }
  if (elevation < BANDS.FOREST) {
    if (elevation > BANDS.LARCH) {
      // Limite des arbres : MÉLÈZES épars (clairs, dorés) mêlés de pelouse d'altitude.
      return fbm2(tx, ty, 7, (seed ^ 0x9a3d) | 0) < 0.55 ? TERRAIN_LARCH : TERRAIN_ALPINE_MEADOW
    }
    if (wet > BANDS.FOREST_WET) {
      // Ubac humide : forêt DENSE de conifères (épicéas/sapins), rares trouées.
      return fbm2(tx, ty, 6, seed) < 0.92 ? TERRAIN_FOREST : TERRAIN_GRASS
    }
    // Adret sec : forêt CLAIRE de pins, ouverte, sur fond de lande.
    return fbm2(tx, ty, 6, (seed ^ 0x515f) | 0) < 0.5 ? TERRAIN_PINE : TERRAIN_HEATH
  }
  if (elevation < BANDS.ALPINE) {
    // Alpage d'altitude, parsemé de pelouses fleuries (edelweiss/gentiane).
    return fbm2(tx, ty, 12, (seed ^ 0x0f10) | 0) > 0.72 ? TERRAIN_ALPINE_FLOWERS : TERRAIN_ALPINE_MEADOW
  }
  if (elevation < BANDS.SCREE) return TERRAIN_SCREE
  if (elevation < BANDS.SNOW) return TERRAIN_ROCK
  if (elevation < BANDS.GLACIER) return TERRAIN_SNOW
  return TERRAIN_GLACIER // les plus hauts sommets = glace
}

/**
 * LES QUARTIERS MACRO ONT LAISSÉ LA PLACE AUX PAYS (2026-07-14).
 *
 * `paintAlpineBands` mélangeait ici deux champs de bruit basse fréquence
 * (`macroWet`, `macroRock`) appelés « quartiers macro ». L'intention était juste —
 * donner des tempéraments régionaux — mais l'outil ne pouvait pas la porter : un
 * bruit continu ne fabrique pas de LIEUX, il fabrique un dégradé. Pas de
 * frontière, donc pas de dedans ni de dehors ; pas de centre, donc pas de nom. On
 * ne va pas « à la Tourbière » quand la tourbière est un champ scalaire.
 *
 * Mesuré : le rapport de distinction entre blocs lointains et blocs voisins valait
 * **1,58** — la carte avait bien une structure, mais c'était le GRADIENT
 * concentrique du relief (le bord monte, le fond descend), pas des quartiers.
 *
 * `pays.ts` les remplace par un semis de sites nommés, à maille absolue. Et ça
 * coûte MOINS CHER : les deux `fbmWarp2` valaient 18 `gradientNoise2` par tuile ;
 * le warp des pays en vaut 6.
 */
/**
 * La loi de `wet` est CONSERVÉE, seule sa VARIATION change — et ce choix mérite
 * son paragraphe, parce que le rater casse tous les biomes en silence.
 *
 * L'ancienne formule valait `0,55·humidité + 0,45·macroWet − 0,22·macroRock`. Les
 * deux champs macro sont des bruits de moyenne 0,5 : leur contribution MOYENNE
 * était donc `0,45×0,5 − 0,22×0,5 = 0,115`, constante. En les remplaçant par le
 * biais du pays (de moyenne ≈ 0 par construction de la table), on garde le même
 * poids sur l'humidité locale et on rend cette constante EXPLICITE. La moyenne de
 * `wet` ne bouge pas d'un cheveu, et les seuils de `BANDS` — calibrés dessus,
 * chèrement (cf. `MARSH_WET`) — restent valides.
 *
 * Ce qui change, c'est l'écart-type de la part régionale : les bruits macro le
 * portaient à ~0,09, le biais des pays le porte à ~0,15. Les contrées se
 * distinguent donc PLUS — c'est exactement ce qu'on cherchait — sans que la
 * vallée dans son ensemble ne s'assèche ni ne se noie.
 *
 * (Première version, non recalée : poids 0,7 et base 0,15 → la moyenne passait de
 * 0,44 à 0,52 et la vallée se couvrait de **26 % de tourbières** contre 5 %, la
 * lande tombant à 1 %. Un déplacement de moyenne de huit centièmes suffit à
 * renverser la végétation d'un pays.)
 */
const MOISTURE_WEIGHT = 0.55
const WET_BASE = 0.115 // = 0,45×0,5 − 0,22×0,5 : la moyenne des anciens champs macro

export function paintAlpineBands(map: WorldMap, moisture: number[], contree: Contree, seed: number): void {
  const { width, height } = map
  const el = map.elevation!
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      const e = paysAt(contree, tx, ty)
      // L'humidité locale (les poches), décalée par le CARACTÈRE du pays (le tempérament).
      const wet = clamp01(MOISTURE_WEIGHT * moisture[i]! + WET_BASE + wetBiasAt(e))
      // L'altitude APPARENTE — le seul levier du pays au-dessus de 0,55, où `bandFor`
      // ne lit plus l'humidité. L'altitude RÉELLE (`el`) n'est jamais touchée : le
      // relief, l'eau, le froid et le rendu la lisent telle quelle. Seul le tapis
      // végétal se laisse tromper.
      const vu = clamp01(el[i]! + elevBiasAt(e))
      map.terrain[i] = bandFor(vu, wet, tx, ty, seed)
    }
  }
}

/**
 * Sème des PATCHES organiques (contour warpé, clairières internes) qui
 * convertissent un terrain source en un autre — bosquets, prés fleuris, chaos de
 * blocs, vieille forêt, brûlis. Générique : densité, taille, remplissage, source,
 * cible. Densités → scalables ; tout est déterministe.
 */
interface Scatter {
  density: number
  rMinFrac: number
  rMaxFrac: number
  warp: number
  fill: number
  isSource: (t: number) => boolean
  to: number
  salt: number
  /**
   * LE PAYS DÉCIDE. Multiplicateur de densité selon le caractère du pays où tombe
   * la graine (1 = neutre, 0 = jamais). C'est ce qui donne à la Vieille Sylve ses
   * gros bois et au Versant Brûlé ses cendres — sans quoi le « caractère » d'un
   * pays ne serait qu'un mot sur une carte, et les bosquets rares tomberaient
   * n'importe où, uniformément.
   *
   * Mise en œuvre : on sème `densité × MAX(multiplicateurs)` graines, et chacune
   * est REJETÉE avec probabilité `1 − mult/max`. La densité finale vaut donc bien
   * `densité × mult` dans chaque pays, et le tirage reste déterministe (hash2).
   */
  paysMult?: (c: Caractere | undefined) => number
}

function scatterPatches(map: WorldMap, contree: Contree, seed: number, cfg: Scatter): void {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(4, Math.round(D * 0.06))
  const interior = (W - 2 * margin) * (H - 2 * margin)
  // Le semis est dimensionné sur le pays le PLUS généreux ; le rejet ramène chaque
  // pays à sa juste densité.
  const maxMult = cfg.paysMult
    ? Math.max(cfg.paysMult(undefined), ...CARACTERES.map((c) => cfg.paysMult!(c)))
    : 1
  const count = Math.round(cfg.density * interior * maxMult)
  const rMin = Math.max(2, Math.round(D * cfg.rMinFrac))
  const rMax = Math.max(rMin + 1, Math.round(D * cfg.rMaxFrac))
  for (let k = 0; k < count; k++) {
    const x = margin + Math.floor(hash2(k * 613 + cfg.salt, seed, 0x1d1) * (W - 2 * margin))
    const y = margin + Math.floor(hash2(seed, k * 613 + cfg.salt, 0x2e3) * (H - 2 * margin))
    if (!cfg.isSource(map.terrain[y * W + x]!)) continue
    if (cfg.paysMult && maxMult > 0) {
      const m = cfg.paysMult(paysAt(contree, x, y).pays.caractere)
      if (hash2(x, y, (seed ^ cfg.salt ^ 0x7a1e) | 0) > m / maxMult) continue // ce pays n'en veut pas
    }
    const r = rMin + Math.floor(hash2(k, (seed ^ cfg.salt) | 0, 0x4f7) * (rMax - rMin + 1))
    const s = (seed ^ (k * cfg.salt)) | 0
    const rr = Math.ceil(r * (1 + cfg.warp)) + 1
    const scale = Math.max(3, r)
    const fine = Math.max(3, Math.round(r * 0.5))
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        const tx = x + dx
        const ty = y + dy
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
        const i = ty * W + tx
        if (!cfg.isSource(map.terrain[i]!)) continue
        const wx = dx + cfg.warp * r * (fbm2(tx, ty, scale, s) * 2 - 1)
        const wy = dy + cfg.warp * r * (fbm2(tx, ty, scale, (s ^ 0x9e3779b9) | 0) * 2 - 1)
        if (wx * wx + wy * wy > r * r) continue
        if (fbm2(tx, ty, fine, (s ^ 0x2b7f) | 0) > cfg.fill) continue // clairière interne
        map.terrain[i] = cfg.to
      }
    }
  }
}

const isGrass = (t: number): boolean => t === TERRAIN_GRASS
const isMeadowish = (t: number): boolean =>
  t === TERRAIN_GRASS || t === TERRAIN_ALPINE_MEADOW || t === TERRAIN_ALPINE_FLOWERS
const isDenseForest = (t: number): boolean => t === TERRAIN_FOREST
const isAnyForest = (t: number): boolean =>
  t === TERRAIN_FOREST || t === TERRAIN_PINE || t === TERRAIN_LARCH

/**
 * Tous les biomes-patches, dans l'ordre (les bosquets créent la forêt réutilisée
 * par la vieille forêt / le brûlis).
 *
 * LES QUATRE DERNIERS SUIVENT LE PAYS. Sans `paysMult`, la vieille forêt et le
 * brûlis tombaient uniformément sur toute la carte : deux bosquets rares posés au
 * hasard, sans rapport avec l'endroit. C'est précisément ce que reprochait l'audit
 * (« l'identité d'une région est de la texture ») — un nom sur une carte ne fait
 * pas un pays. Désormais, la Vieille Sylve porte SIX fois plus de gros bois que la
 * moyenne et le Versant Brûlé SEPT fois plus de cendres : on sait où l'on est en
 * regardant ses pieds.
 */
function paintScatterBiomes(map: WorldMap, contree: Contree, seed: number): void {
  // Bosquets — bois distribué dans le fond. Neutre : tous les pays en ont.
  scatterPatches(map, contree, seed, { density: 0.00018, rMinFrac: 0.012, rMaxFrac: 0.06, warp: 0.5, fill: 0.82, isSource: isGrass, to: TERRAIN_FOREST, salt: 0x2777 })
  // La VIEILLE FORÊT — le gros bois. C'est la Sylve, et presque rien ailleurs.
  //
  // DENSITÉ TRIPLÉE (2026-07-14), et pour une raison de JEU, pas d'esthétique :
  // l'Arbre remarquable n'a qu'un seul biome possible, la vieille forêt, et c'est
  // un lieu CHARGÉ (récit — il doit exister sur chaque carte, spec `lieux.md`).
  // À l'ancienne densité, la vieille forêt tombait à 0,6 % de la carte une fois
  // concentrée dans les Sylves : le semis de Poisson n'y posait plus aucun point
  // sur deux seeds testées, et la garde de réservation passait au rouge. Une
  // Vieille Sylve doit être VRAIMENT pleine de gros bois — c'est ce qui la nomme.
  scatterPatches(map, contree, seed, { density: 0.00004, rMinFrac: 0.02, rMaxFrac: 0.05, warp: 0.45, fill: 0.95, isSource: isDenseForest, to: TERRAIN_OLD_GROWTH, salt: 0x51a3, paysMult: (c) => c?.oldGrowth ?? 0.3 })
  // LE BRÛLIS — la cendre. C'est le Versant Brûlé, et presque rien ailleurs.
  scatterPatches(map, contree, seed, { density: 0.00002, rMinFrac: 0.015, rMaxFrac: 0.045, warp: 0.55, fill: 0.9, isSource: isAnyForest, to: TERRAIN_BURNT_FOREST, salt: 0x71c9, paysMult: (c) => c?.burnt ?? 0.3 })
  // Les PRÉS FLEURIS — la Prairie et les Hauts Alpages.
  scatterPatches(map, contree, seed, { density: 0.00006, rMinFrac: 0.015, rMaxFrac: 0.04, warp: 0.5, fill: 0.72, isSource: isGrass, to: TERRAIN_FLOWER_MEADOW, salt: 0x3b1d, paysMult: (c) => c?.flowers ?? 0.6 })
  // LE CHAOS DE BLOCS — le Pierrier, et la Lande qui l'annonce.
  scatterPatches(map, contree, seed, { density: 0.00009, rMinFrac: 0.01, rMaxFrac: 0.03, warp: 0.55, fill: 0.4, isSource: isMeadowish, to: TERRAIN_BOULDERS, salt: 0x6e2f, paysMult: (c) => c?.boulders ?? 0.5 })
}

/**
 * Couloirs d'avalanche : depuis un point haut, une traînée de BLOCS/débris dévale
 * la pente (steepest-descent sur l'altitude), rasant la forêt jusqu'au fond. 1 à 3
 * par carte. Un vrai « couloir » lisible qui raconte quelque chose.
 */
function paintAvalanches(map: WorldMap, seed: number): void {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const el = map.elevation!
  const margin = Math.max(3, Math.round(D * 0.08))
  const count = 1 + Math.floor(hash2(seed, 0x7a3c, 0x3) * 2.99) // 1..3
  const aw = Math.max(2, Math.round(D * 0.012))
  const isBlockable = (t: number): boolean => {
    const d = TERRAINS[t]
    return d !== undefined && d.walkable && t !== TERRAIN_SHALLOW_WATER
  }
  for (let k = 0; k < count; k++) {
    // Source haute (pente, pas le pic scellé).
    let sx = margin, sy = margin, se = -1
    for (let s = 0; s < 40; s++) {
      const x = margin + Math.floor(hash2(k * 71 + s, seed, 0x2a1) * (W - 2 * margin))
      const y = margin + Math.floor(hash2(seed, k * 71 + s, 0x3b2) * (H - 2 * margin))
      const e = el[y * W + x]!
      if (e > se && e > 0.6 && e < 0.85) { se = e; sx = x; sy = y }
    }
    if (se < 0) continue
    let x = sx, y = sy
    for (let step = 0; step < W + H; step++) {
      if (el[y * W + x]! < BANDS.FLOOR) break // arrivé au fond
      // rase une bande de blocs
      for (let dy = -aw; dy <= aw; dy++) {
        for (let dx = -aw; dx <= aw; dx++) {
          if (dx * dx + dy * dy > aw * aw) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          if (isBlockable(map.terrain[ny * W + nx]!)) map.terrain[ny * W + nx] = TERRAIN_BOULDERS
        }
      }
      // descend au voisin le plus bas
      let bx = -1, by = -1, be = el[y * W + x]!
      for (let d = 0; d < 8; d++) {
        const nx = x + NX8[d]!, ny = y + NY8[d]!
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const e = el[ny * W + nx]!
        if (e < be) { be = e; bx = nx; by = ny }
      }
      if (bx < 0) break
      x = bx; y = by
    }
  }
}

const NX8 = [-1, 0, 1, -1, 1, -1, 0, 1]
const NY8 = [-1, -1, -1, 0, 0, 1, 1, 1]

/**
 * Les passes de la génération, dans l'ordre où elles tournent. Elles sont
 * PUBLIQUES parce que la vallée met plusieurs secondes à naître : l'hôte les
 * annonce une à une, et l'écran de chargement du client COMPTE ce qui est fait —
 * sa barre n'est rien d'autre. Ce sont des identifiants de travail, pas des
 * libellés : le client ne les affiche pas (il raconte autre chose).
 */
export const WORLDGEN_PHASES = [
  'elevation',
  'pays',
  'moisture',
  'bands',
  'hydrology',
  'biomes',
  'avalanches',
  'border',
  'pois',
  'bumps',
] as const
export type WorldgenPhase = (typeof WORLDGEN_PHASES)[number]

/**
 * `onPhase` est un RAPPORTEUR, pas un levier : il reçoit le nom de la passe qui
 * commence et ne rend rien. La génération reste donc pure et déterministe — même
 * seed, même carte, et la même suite de passes dans le même ordre.
 */
export function generateAlpineTerrain(
  width: number,
  height: number,
  seed: number,
  onPhase: (phase: WorldgenPhase) => void = () => {},
): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  onPhase('elevation')
  // Relief et écoulement naissent du MÊME passage (ils partagent `org`) — voir
  // `computeRelief`. L'écoulement n'a donc plus de passe à lui.
  const relief = computeRelief(width, height, seed)
  map.elevation = relief.elevation
  const flow = relief.flow

  onPhase('pays')
  // LES PAYS, avant les biomes : ils décident du tempérament de chaque contrée, et
  // ce tempérament décale l'humidité, donc la bande de biome. Leur caractère se
  // tire sur l'altitude de BASE (celle d'avant l'érosion) — un caractère de fond
  // ne naît pas sur un pic.
  const contree = derivePays(width, height, seed, (x, y) => map.elevation![y * width + x] ?? 0)
  // Les noms se posent en toponymes AVANT tout le reste : ils sont les premières
  // zones de la carte, et le survol les lit (spec lieux : on cache les lieux,
  // jamais la forme du pays).
  map.zones.push(...paysToponymes(contree, map))

  onPhase('moisture')
  const moisture = computeMoisture(width, height, map.elevation, seed)
  onPhase('bands')
  paintAlpineBands(map, moisture, contree, seed)
  onPhase('hydrology')
  carveHydrology(map, flow, seed) // lac, fleuve (thalweg), gués, ruisseaux, tarns
  onPhase('biomes')
  paintScatterBiomes(map, contree, seed) // bosquets, prés, blocs, vieille forêt, brûlis — SELON LE PAYS
  onPhase('avalanches')
  paintAvalanches(map, seed) // couloirs d'avalanche (blocs qui dévalent)
  onPhase('border')
  sealBorderRing(map) // l'anneau externe reste bloquant quoi qu'ait creusé l'eau
  onPhase('pois')
  placePois(map, seed) // POIs APRÈS le scellage : le biome sous le centre d'un POI est le terrain FINAL
  //                      (sinon un POI validé sur du bord verrait son terrain réécrit en roche par le scellage → incohérence)
  onPhase('bumps')
  addReliefBumps(map, seed) // DERNIER : vallons de RENDU sur la terre (eau plate) — voir plus bas
  return map
}

/**
 * Ajoute les VALLONS de rendu (haute fréquence) à `elevation`, sur la TERRE
 * seulement — l'eau (plans d'eau) garde le niveau macro LISSE, donc rend plate.
 *
 * Appliqué EN DERNIER, exprès : moisture, bandes de biome et surtout l'hydrologie
 * (drainage priority-flood qui « comble les cuvettes ») ont tourné sur le champ
 * LISSE pour lequel ils sont conçus — sinon les vallons créent de fausses
 * dépressions et parasitent rivières/tarns. Purement visuel : seul le warp et
 * l'ombrage du client lisent `elevation`.
 *
 * DEUX FAUTES CORRIGÉES ICI (2026-07-14), et elles FAISAIENT PLANTER LE JEU.
 *
 * Le client soulève chaque tuile de `elevation × RELIEF_H` pixels pour donner du
 * relief. Si le sol descend vers le sud plus vite que `TILE_PX / RELIEF_H` par
 * tuile, l'image SE REPLIE sur elle-même — et `assertNoFold` (WorldScene.ts) lève
 * alors une exception, **sans garde de développement** : le jeu ne démarre pas.
 * Mesuré : **4 seeds sur 16** dépassaient le plafond. Le jeu ne survivait que
 * parce que `veillee.ts` code la seed 2026 en dur.
 *
 * 1. LE WARP ÉTAIT TROIS FOIS PLUS GRAND QUE LE MOTIF QU'IL DÉFORMAIT. Les
 *    vallons ont une longueur d'onde de `HILL_FRAC × D` = **24 tuiles**, et on
 *    leur appliquait un domain warp de `WARP_FRAC × D` = **72 tuiles**
 *    d'amplitude. Déplacer le point d'échantillonnage de trois longueurs d'onde,
 *    ce n'est plus tordre un motif : c'est le tirer au sort à chaque tuile. Le
 *    champ obtenu a des pentes énormes. `fbm2` suffit — et il économise au
 *    passage six `gradientNoise2` par tuile.
 *
 * 2. LE VALLON S'ARRÊTAIT NET AU BORD DE L'EAU. Le `continue` sur les tuiles
 *    d'eau laisse l'eau plate — c'est voulu — mais il laissait aussi une MARCHE
 *    de la hauteur du vallon (jusqu'à ±0,05) sur la berge d'en face. On fond donc
 *    le vallon à l'approche de l'eau, par un masque terre/eau adouci (deux flous
 *    séparables). L'eau reste EXACTEMENT plate ; c'est la terre qui vient la
 *    rejoindre en pente douce.
 */
export function addReliefBumps(map: WorldMap, seed: number): void {
  const { width, height } = map
  const D = Math.min(width, height)
  const hill = D * ALPINE.HILL_FRAC
  const el = map.elevation!
  const N = width * height

  // Masque de TERRE (1) / eau (0), puis adouci : il devient le fondu du vallon.
  const fade = new Array<number>(N)
  for (let i = 0; i < N; i++) {
    const t = map.terrain[i]
    fade[i] = t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER ? 0 : 1
  }
  boxBlur(fade, width, height, SHORE_FADE_TILES)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const t = map.terrain[i]
      if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) continue // l'eau reste plate
      // `fbm2`, PAS `fbmWarp2` : voir la faute n°1 ci-dessus.
      const bump = ALPINE.HILL_AMP * (fbm2(x, y, hill, (seed ^ 0x2c3d4e) | 0) - 0.5)
      el[i] = clamp01(el[i]! + fade[i]! * bump)
    }
  }
}

/** Sur combien de tuiles le vallon s'éteint en approchant de l'eau. */
const SHORE_FADE_TILES = 4
