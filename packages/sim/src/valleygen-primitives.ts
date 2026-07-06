/**
 * Primitives partagées de la génération de vallée (audit lot 6, revue finale
 * IMP4) — tampons de formes, tracé de polylignes, helper eau, et les types de
 * squelette. Génériques, indépendants du générateur qui les appelle : extraits
 * de valleygen.ts pour que valleygen-water.ts et valleygen-mines.ts n'aient
 * plus besoin d'importer valleygen.ts en retour (cycle d'import cassé).
 */
import {
  TERRAIN_DEEP_WATER,
  TERRAIN_SHALLOW_WATER,
} from './balance'
import type { WorldMap, Zone } from './map'
import { fbm2 } from './noise'

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
  /** Densités du réseau d'eau procédural (par tuile marchable). Optionnel. */
  water?: { streamDensity?: number; pondDensity?: number }
  /** Mines creusées depuis la bordure. `deep` = artisanales (gisement T2) ;
   *  `simpleDensity` = carrières procédurales, en carrières par 100 tuiles de périmètre. */
  mines?: {
    deep: { x: number; y: number; toward: 'top' | 'bottom' | 'left' | 'right' }[]
    simpleDensity?: number
  }
}

export function setTile(map: WorldMap, tx: number, ty: number, id: number): void {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return
  map.terrain[ty * map.width + tx] = id
}

/** Décide du terrain à poser selon l'existant ; undefined = ne pas toucher. */
export type Paint = (current: number) => number | undefined

/** Tamponne un disque (distance euclidienne au carré — pas de trigo). */
export function stampDisk(map: WorldMap, cx: number, cy: number, r: number, paint: Paint): void {
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
export function stampBlob(
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
export function paintPolyline(map: WorldMap, points: ValleyPoint[], halfWidth: number, paint: Paint): void {
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

export const isWater = (t: number): boolean => t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER
