import { describe, expect, it } from 'vitest'
import {
  computeElevation, computeFlowField, computeMoisture, paintAlpineBands,
} from './alpinegen'
import { carveHydrology } from './alpine-hydro'
import { TERRAIN_DEEP_WATER, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { createEmptyMap, type WorldMap } from './map'

/** Reconstruit le préfixe hydrologique de `generateAlpineTerrain` (jusqu'à
 *  carveHydrology inclus) et renvoie la carte + les traces (source, exutoire)
 *  des ruisseaux de fonte. */
function buildHydro(W: number, H: number, seed: number): {
  map: WorldMap; streams: Array<{ source: { x: number; y: number }; outlet: { x: number; y: number } }>
} {
  const map = createEmptyMap(W, H, TERRAIN_GRASS)
  map.elevation = computeElevation(W, H, seed)
  const moisture = computeMoisture(W, H, map.elevation, seed)
  paintAlpineBands(map, moisture, seed)
  const flow = computeFlowField(W, H, seed)
  const streams = carveHydrology(map, flow, seed)
  return { map, streams }
}

/** Vrai s'il existe un chemin d'eau 4-connexe (arêtes seulement) de `src` à
 *  `dst` sur le masque d'eau de la carte. */
function water4Connected(
  map: WorldMap, src: { x: number; y: number }, dst: { x: number; y: number },
): boolean {
  const W = map.width, H = map.height
  const isW = (x: number, y: number): boolean => {
    const t = map.terrain[y * W + x]
    return t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER
  }
  if (!isW(src.x, src.y)) return false
  const seen = new Uint8Array(W * H)
  const stack = [src.y * W + src.x]
  seen[src.y * W + src.x] = 1
  const NX = [1, -1, 0, 0]
  const NY = [0, 0, 1, -1]
  while (stack.length > 0) {
    const c = stack.pop()!
    const cx = c % W, cy = (c / W) | 0
    if (cx === dst.x && cy === dst.y) return true
    for (let d = 0; d < 4; d++) {
      const nx = cx + NX[d]!, ny = cy + NY[d]!
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      if (seen[ni] || !isW(nx, ny)) continue
      seen[ni] = 1
      stack.push(ni)
    }
  }
  return false
}

describe('carveHydrology — continuité des ruisseaux de fonte', () => {
  const W = 160, H = 240

  it('chaque ruisseau relie sa source à son exutoire en 4-connexité (flot non cassé sur les diagonales)', () => {
    for (const seed of [1, 5, 42, 100, 2026]) {
      const { map, streams } = buildHydro(W, H, seed)
      expect(streams.length, `seed ${seed} : aucun ruisseau tracé`).toBeGreaterThan(0)
      for (const s of streams) {
        expect(
          water4Connected(map, s.source, s.outlet),
          `seed ${seed} : ruisseau (${s.source.x},${s.source.y})→(${s.outlet.x},${s.outlet.y}) discontinu en 4-connexité`,
        ).toBe(true)
      }
    }
  })
})
