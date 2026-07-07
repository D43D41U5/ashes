/**
 * Le générateur de vallée — squelette déclaratif + chair procédurale (GDD §9,
 * design 2026-07-06). Le squelette est de la donnée artisanale (rivière,
 * crêtes, routes, landmarks) ; la génération remplit les biomes depuis la
 * seed. Tout est exact au bit près (noise.ts, arithmétique autorisée).
 *
 * C'est l'équivalent en code du couple « squelette Tiled + remplissage » des
 * vraies cartes de saison : quand Tiled arrivera (V9/S0), l'import remplira
 * le même WorldMap — l'architecture ne bouge pas.
 */
import {
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
  TERRAIN_WALL,
} from './balance'
import { createEmptyMap, type WorldMap } from './map'
import { fbm2, fbmWarp2, hash2 } from './noise'
import { carveMines } from './valleygen-mines'
import {
  isWater,
  type Paint,
  paintPolyline,
  setTile,
  stampBlob,
  stampDisk,
  type ValleyPoint,
  type ValleySkeleton,
} from './valleygen-primitives'
import { paintPonds, paintStreams } from './valleygen-water'

export type { ValleyPoint, ValleyRegion, ValleySkeleton } from './valleygen-primitives'

const DEFAULT_BIOME = { forest: 0.3, rock: 0.05, marsh: 0 }

// Amplitude du warp des biomes (tuiles) : fraction de la plus petite dimension
// de carte → scalable. À 192×192 ≈ 8 tuiles (modéré : crédible sans chaos).
// Contenu de carte, pas d'équilibrage. Seeds décorrélés du warp de lookup.
const BIOME_WARP_FRAC = 0.04
const BIOME_WARP_SCALE = 40
const BIOME_WARP_SEED_X = 0x2c1a9f
const BIOME_WARP_SEED_Y = 0x5f3e7b

export function generateValley(skeleton: ValleySkeleton, seed: number): WorldMap {
  const map = createEmptyMap(skeleton.width, skeleton.height, TERRAIN_GRASS)
  paintBiomes(map, skeleton, seed)
  paintBorder(map, skeleton, seed)
  for (const ridge of skeleton.ridges) {
    paintRidge(map, ridge.points, ridge.halfWidth, seed)
  }
  const mineZones = carveMines(map, skeleton, seed)
  paintRiver(map, skeleton)
  paintStreams(map, skeleton, seed)
  paintPonds(map, skeleton, seed)
  sealBorderRing(map) // ni ruisseau ni étang ne perce l'anneau externe
  paintRoads(map, skeleton)
  paintCrossings(map, skeleton)
  for (const c of skeleton.clearings) stampDisk(map, c.x, c.y, c.r, paintClear)
  for (const r of skeleton.ruins) paintRuin(map, r.x, r.y)
  map.zones = [...mineZones, ...skeleton.landmarks.map((z) => ({ ...z }))]
  return map
}

/** Une crête à largeur bruitée — un mur de roche irrégulier, pas un ruban net. */
function paintRidge(map: WorldMap, points: ValleyPoint[], halfWidth: number, seed: number): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1) * 2
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const px = Math.round(a.x + (b.x - a.x) * t)
      const py = Math.round(a.y + (b.y - a.y) * t)
      const hw = halfWidth + Math.floor(halfWidth * (fbm2(px, py, 6, (seed ^ 0x1d3a) | 0) * 2 - 1))
      stampDisk(map, px, py, Math.max(1, hw), () => TERRAIN_ROCK)
    }
  }
}

/** La chair : biomes par région, seuils sur bruit fractal WARPÉ (frontières
 *  organiques au lieu de coutures rectangulaires). Même warp pour le lookup de
 *  région et pour le seuil → frontière et texture bougent ensemble. */
function paintBiomes(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const warpAmp = Math.max(2, Math.round(Math.min(map.width, map.height) * BIOME_WARP_FRAC))
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      // Coordonnée de lookup warpée : la frontière de région devient irrégulière.
      const wx = fbm2(tx, ty, BIOME_WARP_SCALE, (seed ^ BIOME_WARP_SEED_X) | 0)
      const wy = fbm2(tx, ty, BIOME_WARP_SCALE, (seed ^ BIOME_WARP_SEED_Y) | 0)
      const lx = tx + warpAmp * (wx * 2 - 1)
      const ly = ty + warpAmp * (wy * 2 - 1)
      const region = skeleton.regions.find(
        (r) => lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h,
      )
      const marsh = region?.marsh ?? DEFAULT_BIOME.marsh
      const forest = region?.forest ?? DEFAULT_BIOME.forest
      const rock = region?.rock ?? DEFAULT_BIOME.rock
      if (marsh > 0 && fbmWarp2(tx, ty, 16, (seed ^ 0x33aa17) | 0, warpAmp) < marsh) {
        setTile(map, tx, ty, TERRAIN_MARSH)
      } else if (fbmWarp2(tx, ty, 24, seed, warpAmp) < forest) {
        setTile(map, tx, ty, TERRAIN_FOREST)
      } else if (rock > 0 && fbmWarp2(tx, ty, 4, (seed ^ 0x7f4a21) | 0, warpAmp) > 1 - rock) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
  }
}

/**
 * L'enceinte montagneuse — épaisseur à deux octaves (baies + crénelage) et
 * quelques éboulis détachés vers l'intérieur. Le dernier anneau reste
 * bloquant : on ne sort jamais de la carte. Amplitudes fractions de
 * borderThickness → scalable.
 */
function paintBorder(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const base = skeleton.borderThickness
  const lowAmp = base * 1.5   // baies et avancées (basse fréquence)
  const highAmp = base * 0.5  // crénelage (haute fréquence)
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const d = Math.min(tx, ty, map.width - 1 - tx, map.height - 1 - ty)
      const low = fbm2(tx, ty, base * 6, (seed ^ 0xb0bd91) | 0)
      const high = fbm2(tx, ty, base * 1.5, (seed ^ 0x2f1c07) | 0)
      const th = base + Math.floor(lowAmp * low + highAmp * high)
      if (d < th) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      } else if (d < th + base && hash2(tx, ty, (seed ^ 0x5ee7) | 0) < 0.06) {
        // Éboulis détaché : roche isolée juste devant l'enceinte (densité).
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
  }
  // Le dernier anneau, toujours bloquant quoi qu'ait fait le bruit.
  sealBorderRing(map)
}

/** Force l'anneau externe en roche — l'ultime garantie « on ne sort pas de la carte ». */
export function sealBorderRing(map: WorldMap): void {
  for (let i = 0; i < map.width; i++) {
    setTile(map, i, 0, TERRAIN_ROCK)
    setTile(map, i, map.height - 1, TERRAIN_ROCK)
  }
  for (let j = 0; j < map.height; j++) {
    setTile(map, 0, j, TERRAIN_ROCK)
    setTile(map, map.width - 1, j, TERRAIN_ROCK)
  }
}

/** Nettoie en herbe — sans toucher l'eau ni la route. */
const paintClear: Paint = (cur) => (isWater(cur) || cur === TERRAIN_ROAD ? undefined : TERRAIN_GRASS)

function paintRiver(map: WorldMap, skeleton: ValleySkeleton): void {
  const { points, halfWidth } = skeleton.river
  paintPolyline(map, points, halfWidth + 1, () => TERRAIN_SHALLOW_WATER)
  paintPolyline(map, points, halfWidth, () => TERRAIN_DEEP_WATER)
  const { x, y, r } = skeleton.lake
  stampBlob(map, x, y, r + 2, () => TERRAIN_SHALLOW_WATER, 0xa17e5 | 0, 0.18)
  stampBlob(map, x, y, r, () => TERRAIN_DEEP_WATER, 0xa17e5 | 0, 0.18)
}

/** Les routes percent tout SAUF l'eau — le franchissement est une décision. */
function paintRoads(map: WorldMap, skeleton: ValleySkeleton): void {
  const paintRoad: Paint = (cur) => (isWater(cur) ? undefined : TERRAIN_ROAD)
  for (const road of skeleton.roads) paintPolyline(map, road, 1, paintRoad)
}

/** Pont : la route enjambe l'eau. Gué : l'eau devient peu profonde. */
function paintCrossings(map: WorldMap, skeleton: ValleySkeleton): void {
  const r = skeleton.river.halfWidth + 2
  for (const c of skeleton.crossings) {
    stampDisk(map, c.x, c.y, r, () => (c.kind === 'bridge' ? TERRAIN_ROAD : TERRAIN_SHALLOW_WATER))
  }
}

/** Un pan de bâtiment effondré — murs percés de brèches, sol nettoyé. */
const RUIN_WALLS: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [2, 0], [4, 0],
  [0, 1], [4, 1],
  [0, 3], [1, 3], [3, 3], [4, 3],
]

function paintRuin(map: WorldMap, x: number, y: number): void {
  stampDisk(map, x + 2, y + 1, 4, paintClear)
  for (const [dx, dy] of RUIN_WALLS) setTile(map, x + dx, y + dy, TERRAIN_WALL)
}
