/**
 * Le substrat alpin (SP1a) — champ d'élévation, d'humidité, et bandes de terrain
 * façon Whittaker. Pur et déterministe (noise.ts, arithmétique autorisée). Pas
 * d'hydrologie ni de features ici (SP1b). Toutes les échelles/amplitudes sont des
 * fractions de min(width,height) → scalable à toute taille.
 */
import { fbm2, fbmWarp2, hash2, ridgedFbm2 } from './noise'
import { createEmptyMap, type WorldMap } from './map'
import { sealBorderRing } from './valleygen'
import { carveHydrology } from './alpine-hydro'
import {
  TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_MARSH, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW,
  TERRAIN_HEATH, TERRAIN_ALPINE_MEADOW, TERRAIN_PINE, TERRAIN_LARCH,
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
}

export function computeElevation(width: number, height: number, seed: number): number[] {
  const D = Math.min(width, height)
  const rimDepth = Math.max(2, Math.round(D * ALPINE.RIM_FRAC))
  const rise = D * 0.5 * ALPINE.RISE_FRAC
  const organic = D * ALPINE.ORGANIC_FRAC
  const detailScale = D * ALPINE.DETAIL_FRAC
  const ridge = D * ALPINE.RIDGE_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const el = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y)
      // Forme de vallée macro : 1 au bord (murs/pics) → 0 au fond (edge ≥ rise).
      const valley = 1 - Math.min(1, edge / rise)
      // Brise le bol concentrique → vallée organique (éperons, combes, cols).
      const org = ALPINE.ORGANIC_AMP * (fbmWarp2(x, y, organic, (seed ^ 0x1a2b3c) | 0, warp) - 0.5)
      // Détail de pente + arêtes ridged (petite amplitude, texture sur les murs).
      const detail = ALPINE.DETAIL_AMP * (fbmWarp2(x, y, detailScale, (seed ^ 0x4d5e6f) | 0, warp) - 0.5)
      const crest = ALPINE.RIDGE_AMP * (ridgedFbm2(x, y, ridge, (seed ^ 0x7a8b9c) | 0) - 0.4)
      let h = valley + org + detail + crest
      const rim = clamp01((rimDepth - edge) / rimDepth) // enceinte : bord toujours haut
      h = Math.max(rim, h)
      el[y * width + x] = clamp01(h)
    }
  }
  return el
}

/**
 * Champ d'ÉCOULEMENT — la forme de vallée macro (enceinte + fond + organique)
 * SANS le détail ni les crêtes. L'eau le suit sans se piéger dans les micro-pits
 * du relief fin ; l'hydrologie (SP1b) trace dessus, puis creuse dans le terrain
 * réel. Même valley/org/rim que computeElevation → cohérent avec le relief.
 */
export function computeFlowField(width: number, height: number, seed: number): number[] {
  const D = Math.min(width, height)
  const rimDepth = Math.max(2, Math.round(D * ALPINE.RIM_FRAC))
  const rise = D * 0.5 * ALPINE.RISE_FRAC
  const organic = D * ALPINE.ORGANIC_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const f = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y)
      const valley = 1 - Math.min(1, edge / rise)
      const org = ALPINE.ORGANIC_AMP * (fbmWarp2(x, y, organic, (seed ^ 0x1a2b3c) | 0, warp) - 0.5)
      const rim = clamp01((rimDepth - edge) / rimDepth)
      // PAS de clamp/max ici : ce champ ne sert qu'à LOCALISER (lac = min, tête de
      // vallée = max). Clamper le fond à 0 créait une vaste zone plate d'où le min
      // sortait toujours au même endroit (nord). `valley+org+rim` a un vrai minimum
      // unique (org le plus négatif dans le fond) qui varie avec la seed ; le rim
      // ne fait que rehausser le bord.
      f[y * width + x] = valley + org + rim
    }
  }
  return f
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
  SNOW: 0.83,     // ≥ SNOW : neige ; SCREE..SNOW : roche
  MARSH_WET: 0.70,   // fond très humide → marais
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
    if (wet > BANDS.MARSH_WET) return TERRAIN_MARSH
    if (wet < BANDS.HEATH_WET) return TERRAIN_HEATH // fond sec = lande
    return TERRAIN_GRASS // alpage/prairie
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
  if (elevation < BANDS.ALPINE) return TERRAIN_ALPINE_MEADOW // pelouse d'altitude
  if (elevation < BANDS.SCREE) return TERRAIN_SCREE
  if (elevation < BANDS.SNOW) return TERRAIN_ROCK
  return TERRAIN_SNOW
}

/** Constantes des QUARTIERS macro — grands secteurs au tempérament distinct. */
const MACRO = {
  WET_FRAC: 0.7,   // échelle du champ « humide/sec » (grand → quartiers larges)
  ROCK_FRAC: 0.6,  // échelle du champ « barren/rocheux »
  M_WEIGHT: 0.55,  // part de l'humidité LOCALE
  W_WEIGHT: 0.45,  // part du biais macro humide
  R_WEIGHT: 0.22,  // le biais macro rocheux ASSÈCHE (→ landes, forêt éparse)
}

export function paintAlpineBands(map: WorldMap, moisture: number[], seed: number): void {
  const { width, height } = map
  const el = map.elevation!
  const D = Math.min(width, height)
  const wetScale = D * MACRO.WET_FRAC
  const rockScale = D * MACRO.ROCK_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      // Quartiers macro : humidité régionale + un biais « rocheux/barren » qui assèche.
      const macroWet = fbmWarp2(tx, ty, wetScale, (seed ^ 0x00a1c3) | 0, warp)
      const macroRock = fbmWarp2(tx, ty, rockScale, (seed ^ 0x00b2d4) | 0, warp)
      const wet = clamp01(MACRO.M_WEIGHT * moisture[i]! + MACRO.W_WEIGHT * macroWet - MACRO.R_WEIGHT * macroRock)
      map.terrain[i] = bandFor(el[i]!, wet, tx, ty, seed)
    }
  }
}

/** Bosquets du fond de vallée — pour distribuer le bois hors des pentes.
 *  Contenu de carte, réglé à la vignette. */
export const GROVE = {
  DENSITY: 0.00018,   // bosquets par tuile intérieure (densité doublée)
  R_MIN_FRAC: 0.012,  // petit copse
  R_MAX_FRAC: 0.06,   // grand bois
  WARP: 0.5,          // irrégularité du contour (comme les plans d'eau)
  FILL: 0.82,         // densité interne (< 1 → clairières : forêt ÉPARSE)
}

/** Pose un bosquet organique (contour warpé) sur la PRAIRIE uniquement, avec des
 *  clairières internes → un bouquet d'arbres épars, jamais un pavé rond. */
function paintGrove(map: WorldMap, cx: number, cy: number, r: number, seed: number): void {
  const W = map.width
  const H = map.height
  const rr = Math.ceil(r * (1 + GROVE.WARP)) + 1
  const scale = Math.max(3, r)
  const fine = Math.max(3, Math.round(r * 0.5))
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
      const i = ty * W + tx
      if (map.terrain[i] !== TERRAIN_GRASS) continue // seulement l'alpage (pas d'eau/roche/route)
      const wx = dx + GROVE.WARP * r * (fbm2(tx, ty, scale, seed) * 2 - 1)
      const wy = dy + GROVE.WARP * r * (fbm2(tx, ty, scale, (seed ^ 0x9e3779b9) | 0) * 2 - 1)
      if (wx * wx + wy * wy > r * r) continue
      if (fbm2(tx, ty, fine, (seed ^ 0x2b7f) | 0) > GROVE.FILL) continue // clairière interne
      map.terrain[i] = TERRAIN_FOREST
    }
  }
}

/** Sème des bosquets de tailles DIVERSES dans le fond de vallée (prairie) → le
 *  bois n'est plus qu'au bord de carte. Densité → scalable. */
function paintForestGroves(map: WorldMap, seed: number): void {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(4, Math.round(D * 0.06))
  const interior = (W - 2 * margin) * (H - 2 * margin)
  const count = Math.round(GROVE.DENSITY * interior)
  const rMin = Math.max(2, Math.round(D * GROVE.R_MIN_FRAC))
  const rMax = Math.max(rMin + 1, Math.round(D * GROVE.R_MAX_FRAC))
  for (let k = 0; k < count; k++) {
    const x = margin + Math.floor(hash2(k * 613 + 1, seed, 0x1d1) * (W - 2 * margin))
    const y = margin + Math.floor(hash2(seed, k * 613 + 1, 0x2e3) * (H - 2 * margin))
    if (map.terrain[y * W + x] !== TERRAIN_GRASS) continue // source dans l'alpage
    const r = rMin + Math.floor(hash2(k, seed, 0x4f7) * (rMax - rMin + 1)) // taille diverse
    paintGrove(map, x, y, r, (seed ^ (k * 0x2777)) | 0)
  }
}

export function generateAlpineTerrain(width: number, height: number, seed: number): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  map.elevation = computeElevation(width, height, seed)
  const moisture = computeMoisture(width, height, map.elevation, seed)
  paintAlpineBands(map, moisture, seed)
  const flow = computeFlowField(width, height, seed)
  carveHydrology(map, flow, seed) // lac, rivière (thalweg), ruisseaux, tarns — l'eau suit l'écoulement
  paintForestGroves(map, seed) // bosquets épars dans le fond → bois distribué (après l'eau : n'écrase pas l'eau)
  sealBorderRing(map) // l'anneau externe reste bloquant quoi qu'ait creusé l'eau
  return map
}
