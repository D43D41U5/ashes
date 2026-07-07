/**
 * Le réseau d'eau procédural (design 2026-07-06, volet B) — ruisseaux et
 * étangs, entièrement par densité (scalable). Les ruisseaux sont peu profonds
 * et FRANCHISSABLES : décor, jamais obstacle ; un seul vrai franchissement
 * politique reste (la rivière). Tout est déterministe (noise.ts + hash).
 */
import { TERRAIN_DEEP_WATER, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER, TERRAINS } from './balance'
import type { WorldMap } from './map'
import { fbm2, hash2 } from './noise'
import {
  isWater,
  type Paint,
  paintPolyline,
  stampBlob,
  type ValleySkeleton,
} from './valleygen-primitives'

const paintShallow: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? undefined : TERRAIN_SHALLOW_WATER)

// Méandre des ruisseaux (tuiles) : amplitude franche relative à leur portée,
// longueur d'onde courte → plusieurs ondulations sur un ruisseau. Contenu de
// carte (comme le méandre de la rivière), pas d'équilibrage.
const STREAM_MEANDER_AMP = 2
const STREAM_MEANDER_SCALE = 8

/** Surface marchable actuelle (mesure de densité). */
function walkableCount(map: WorldMap): number {
  let n = 0
  for (let i = 0; i < map.terrain.length; i++) {
    const t = map.terrain[i] ?? 0
    if (TERRAINS[t]?.walkable) n++
  }
  return n
}

/** La tuile d'eau existante la plus proche de (sx, sy), ou null. Balayage borné. */
function nearestWater(map: WorldMap, sx: number, sy: number, maxR: number): { x: number; y: number } | null {
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue // seulement l'anneau
        const tx = sx + dx, ty = sy + dy
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
        if (isWater(map.terrain[ty * map.width + tx] ?? 0)) return { x: tx, y: ty }
      }
    }
  }
  return null
}

/**
 * Ruisseaux : des sources échantillonnées dans les zones rocheuses/hautes
 * dévalent vers l'eau la plus proche. Nombre = round(densité × surface).
 */
export function paintStreams(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const density = skeleton.water?.streamDensity ?? 0
  if (density <= 0) return
  const count = Math.round(density * walkableCount(map))
  const maxReach = Math.max(map.width, map.height)
  for (let k = 0; k < count; k++) {
    // Source seedée, biaisée vers les hauteurs (fort fbm de bordure).
    let best: { x: number; y: number; score: number } | null = null
    for (let s = 0; s < 24; s++) {
      const hx = 4 + Math.floor(hash2(k * 131 + s, seed, 0x511) * (map.width - 8))
      const hy = 4 + Math.floor(hash2(seed, k * 131 + s, 0x733) * (map.height - 8))
      const score = fbm2(hx, hy, 12, (seed ^ 0x9a11) | 0)
      if (!best || score > best.score) best = { x: hx, y: hy, score }
    }
    if (!best) continue
    const target = nearestWater(map, best.x, best.y, maxReach)
    if (!target) continue // pas d'eau atteinte → pas de mare pendante
    // Méandre : le ruisseau serpente au lieu de filer tout droit vers l'eau.
    // Fondu à 0 aux bouts (paintPolyline) → la source et la jonction à l'eau ne
    // bougent pas, seul le milieu ondule. Seed varié par ruisseau (k) pour que
    // deux ruisseaux ne serpentent pas à l'identique. Amplitude franche, en
    // fraction de portée typique → scalable (contenu de carte, pas d'équilibrage).
    const meander = { amp: STREAM_MEANDER_AMP, scale: STREAM_MEANDER_SCALE, seed: (seed ^ (k * 0x2777)) | 0 }
    paintPolyline(map, [{ x: best.x, y: best.y }, target], 0, paintShallow, meander)
  }
}

/**
 * Étangs : petites poches d'eau, rares (densité basse). Berge bruitée.
 * Nombre = round(densité × surface). Positionnés loin de l'eau/route existante.
 */
export function paintPonds(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const density = skeleton.water?.pondDensity ?? 0
  if (density <= 0) return
  const count = Math.round(density * walkableCount(map))
  for (let k = 0; k < count; k++) {
    const cx = 6 + Math.floor(hash2(k * 977, seed, 0x1b7) * (map.width - 12))
    const cy = 6 + Math.floor(hash2(seed, k * 977, 0x2c9) * (map.height - 12))
    const cur = map.terrain[cy * map.width + cx] ?? 0
    // roads peints après (dans generateValley) : cur === TERRAIN_ROAD est inerte ici,
    // garde conservée pour clarté si l'ordre des passes change un jour.
    if (cur === TERRAIN_ROAD || isWater(cur)) continue // pas sur une route ni dans l'eau
    const r = 2 + Math.floor(hash2(k, seed, 0x3f1) * 3) // 2..4
    // Rejeter un candidat dont le footprint mord la bordure ou touche une clairière :
    // la bordure serait rescellée (fuite corrigée) mais un cœur d'eau profonde
    // pourrait subsister dans une clairière de spawn/village (creusée après, épargnée).
    const margin = skeleton.borderThickness + 1
    const reach = Math.ceil((r + 1) + 0.3 * (r + 1)) + 1 // rayon max du blob externe
    if (cx - reach < margin || cx + reach >= map.width - margin) continue
    if (cy - reach < margin || cy + reach >= map.height - margin) continue
    let nearClearing = false
    for (const c of skeleton.clearings) {
      const ddx = cx - c.x, ddy = cy - c.y
      if (ddx * ddx + ddy * ddy <= (c.r + reach) * (c.r + reach)) { nearClearing = true; break }
    }
    if (nearClearing) continue
    stampBlob(map, cx, cy, r + 1, paintShallow, (seed ^ (k * 31)) | 0, 0.3)
    if (r >= 3) stampBlob(map, cx, cy, r - 1, () => TERRAIN_DEEP_WATER, (seed ^ (k * 31)) | 0, 0.3)
  }
}
