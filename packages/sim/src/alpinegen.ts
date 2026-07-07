/**
 * Le substrat alpin (SP1a) — champ d'élévation, d'humidité, et bandes de terrain
 * façon Whittaker. Pur et déterministe (noise.ts, arithmétique autorisée). Pas
 * d'hydrologie ni de features ici (SP1b). Toutes les échelles/amplitudes sont des
 * fractions de min(width,height) → scalable à toute taille.
 */
import { fbmWarp2, ridgedFbm2 } from './noise'
import { createEmptyMap, type WorldMap } from './map'
import { sealBorderRing } from './valleygen'
import { carveHydrology } from './alpine-hydro'
import {
  TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_MARSH, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW,
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
      f[y * width + x] = clamp01(Math.max(rim, valley + org))
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

/** Seuils de bande sur l'altitude — contenu de carte, réglés à la vignette. */
export const BANDS = {
  FLOOR: 0.32,   // < FLOOR : fond (prairie / marsh) — fond de vallée généreux
  FOREST: 0.56,  // < FOREST : pentes boisées (conifères)
  SCREE: 0.68,   // < SCREE : éboulis
  SNOW: 0.76,    // ≥ SNOW : neige ; entre SCREE et SNOW : roche (sommets enneigés)
  MARSH_MOIST: 0.80,   // seuil haut → marais rare, seulement les vraies cuvettes
}

/** Terrain d'une tuile selon altitude × humidité. Chaque terrain occupe UNE
 *  plage d'altitude (bandes disjointes) → l'ordre altitude↔terrain est
 *  structurel ; seul le fond (prairie/tourbière) est départagé par l'humidité.
 *  La variété intra-bande plus riche (forêt sèche/humide, alpage d'altitude)
 *  viendra avec des sous-terrains dédiés — hors SP1a. */
function bandFor(elevation: number, moisture: number): number {
  if (elevation < BANDS.FLOOR) {
    return moisture > BANDS.MARSH_MOIST ? TERRAIN_MARSH : TERRAIN_GRASS
  }
  if (elevation < BANDS.FOREST) return TERRAIN_FOREST
  if (elevation < BANDS.SCREE) return TERRAIN_SCREE
  if (elevation < BANDS.SNOW) return TERRAIN_ROCK
  return TERRAIN_SNOW
}

export function paintAlpineBands(map: WorldMap, moisture: number[]): void {
  const { width, height } = map
  const el = map.elevation!
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      map.terrain[i] = bandFor(el[i]!, moisture[i]!)
    }
  }
}

export function generateAlpineTerrain(width: number, height: number, seed: number): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  map.elevation = computeElevation(width, height, seed)
  const moisture = computeMoisture(width, height, map.elevation, seed)
  paintAlpineBands(map, moisture)
  const flow = computeFlowField(width, height, seed)
  carveHydrology(map, flow, seed) // lac, rivière (thalweg), ruisseaux, tarns — l'eau suit l'écoulement
  sealBorderRing(map) // l'anneau externe reste bloquant quoi qu'ait creusé l'eau
  return map
}
