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
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_WALL,
} from './balance'
import { createEmptyMap, type WorldMap, type Zone } from './map'
import { fbm2, hash2 } from './noise'

export interface ValleyPoint {
  x: number
  y: number
}

/** Rectangle de biome : seuils de densité [0, 1] pour la chair procédurale. */
export interface ValleyRegion {
  x: number
  y: number
  w: number
  h: number
  forest?: number
  rock?: number
  marsh?: number
}

export interface ValleySkeleton {
  width: number
  height: number
  /** Épaisseur minimale de l'enceinte montagneuse (bruitée par-dessus). */
  borderThickness: number
  /** Crêtes internes — ex. le mur qui isole le Plateau, percé au Col. */
  ridges: { points: ValleyPoint[]; halfWidth: number }[]
  river: { points: ValleyPoint[]; halfWidth: number }
  lake: { x: number; y: number; r: number }
  roads: ValleyPoint[][]
  crossings: { kind: 'bridge' | 'ford'; x: number; y: number }[]
  /** Clairières forcées en herbe — spawn, sites de village. */
  clearings: { x: number; y: number; r: number }[]
  /** Tampons de ruines (murs brisés) — le Hameau. */
  ruins: ValleyPoint[]
  regions: ValleyRegion[]
  /** Deviennent map.zones dans cet ordre — les plus spécifiques d'abord. */
  landmarks: Zone[]
}

const DEFAULT_BIOME = { forest: 0.3, rock: 0.05, marsh: 0 }

export function generateValley(skeleton: ValleySkeleton, seed: number): WorldMap {
  const map = createEmptyMap(skeleton.width, skeleton.height, TERRAIN_GRASS)
  paintBiomes(map, skeleton, seed)
  paintBorder(map, skeleton, seed)
  for (const ridge of skeleton.ridges) {
    paintPolyline(map, ridge.points, ridge.halfWidth, () => TERRAIN_ROCK)
  }
  paintRiver(map, skeleton)
  paintRoads(map, skeleton)
  paintCrossings(map, skeleton)
  for (const c of skeleton.clearings) stampDisk(map, c.x, c.y, c.r, paintClear)
  for (const r of skeleton.ruins) paintRuin(map, r.x, r.y)
  map.zones = skeleton.landmarks.map((z) => ({ ...z }))
  return map
}

function setTile(map: WorldMap, tx: number, ty: number, id: number): void {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return
  map.terrain[ty * map.width + tx] = id
}

/** Décide du terrain à poser selon l'existant ; undefined = ne pas toucher. */
type Paint = (current: number) => number | undefined

/** Tamponne un disque (distance euclidienne au carré — pas de trigo). */
function stampDisk(map: WorldMap, cx: number, cy: number, r: number, paint: Paint): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
      const next = paint(map.terrain[ty * map.width + tx] ?? 0)
      if (next !== undefined) setTile(map, tx, ty, next)
    }
  }
}

/**
 * Tamponne un disque à contour perturbé par le bruit fractal — une berge
 * organique au lieu d'un cercle net. `wobble` est une fraction du rayon.
 * N'utilise que + - * / et fbm2 (déterministe, exact) : pas de trigo.
 */
function stampBlob(
  map: WorldMap, cx: number, cy: number, r: number, paint: Paint, seed: number, wobble: number,
): void {
  const amp = wobble * r
  const rr = Math.ceil(r + amp) + 1
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
      // Seuil bruité : rayon effectif r + amp·(fbm−½)·2, comparé au carré.
      const noisy = r + amp * (fbm2(tx, ty, r, seed) * 2 - 1)
      if (dx * dx + dy * dy > noisy * noisy) continue
      const next = paint(map.terrain[ty * map.width + tx] ?? 0)
      if (next !== undefined) setTile(map, tx, ty, next)
    }
  }
}

/** Trace une polyligne en tamponnant des disques le long des segments. */
function paintPolyline(map: WorldMap, points: ValleyPoint[], halfWidth: number, paint: Paint): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1) * 2
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      stampDisk(map, Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t), halfWidth, paint)
    }
  }
}

/** La chair : biomes par région, seuils sur bruit fractal. */
function paintBiomes(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const region = skeleton.regions.find(
        (r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h,
      )
      const marsh = region?.marsh ?? DEFAULT_BIOME.marsh
      const forest = region?.forest ?? DEFAULT_BIOME.forest
      const rock = region?.rock ?? DEFAULT_BIOME.rock
      if (marsh > 0 && fbm2(tx, ty, 16, (seed ^ 0x33aa17) | 0) < marsh) {
        setTile(map, tx, ty, TERRAIN_MARSH)
      } else if (fbm2(tx, ty, 24, seed) < forest) {
        setTile(map, tx, ty, TERRAIN_FOREST)
      } else if (hash2(tx, ty, (seed ^ 0x7f4a21) | 0) < rock) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
  }
}

/** L'enceinte montagneuse — épaisseur bruitée, aucun passage. */
function paintBorder(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const d = Math.min(tx, ty, map.width - 1 - tx, map.height - 1 - ty)
      const th = skeleton.borderThickness + Math.floor(4 * fbm2(tx, ty, 12, (seed ^ 0xb0bd91) | 0))
      if (d < th) setTile(map, tx, ty, TERRAIN_ROCK)
    }
  }
}

const isWater = (t: number): boolean => t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER

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
