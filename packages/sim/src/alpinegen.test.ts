import { describe, expect, it } from 'vitest'
import { computeElevation, computeMoisture, generateAlpineTerrain } from './alpinegen'
import { isBlockingTile, terrainAt } from './map'
import {
  TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_MARSH, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW,
} from './balance'

describe('computeElevation — le relief alpin', () => {
  const W = 120, H = 180

  it('déterministe : même dims + seed → même champ', () => {
    expect(computeElevation(W, H, 7)).toEqual(computeElevation(W, H, 7))
    expect(computeElevation(W, H, 8)).not.toEqual(computeElevation(W, H, 7))
  })

  it('dans [0,1]', () => {
    const el = computeElevation(W, H, 7)
    for (const v of el) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })

  it('enceinte scellée : le bord est haut (pics), le centre plus bas en moyenne', () => {
    const el = computeElevation(W, H, 7)
    const at = (x: number, y: number): number => el[y * W + x]!
    // anneau de bord ≈ 1
    let borderMin = 1
    for (let x = 0; x < W; x++) { borderMin = Math.min(borderMin, at(x, 0), at(x, H - 1)) }
    for (let y = 0; y < H; y++) { borderMin = Math.min(borderMin, at(0, y), at(W - 1, y)) }
    expect(borderMin).toBeGreaterThan(0.9)
    // moyenne d'une fenêtre centrale nettement < 1
    let sum = 0, n = 0
    for (let y = H / 2 - 10; y < H / 2 + 10; y++) for (let x = W / 2 - 10; x < W / 2 + 10; x++) { sum += at(x, y); n++ }
    expect(sum / n).toBeLessThan(0.7)
  })

  it('intérieur varié : forte variance (crêtes ↔ creux), pas un plat', () => {
    const el = computeElevation(W, H, 7)
    let min = 1, max = 0
    for (let y = 20; y < H - 20; y++) for (let x = 20; x < W - 20; x++) {
      const v = el[y * W + x]!; min = Math.min(min, v); max = Math.max(max, v)
    }
    expect(max - min).toBeGreaterThan(0.5)
  })
})

describe('computeMoisture', () => {
  const W = 100, H = 100
  it('déterministe, dans [0,1], et corrélé négativement à altitude', () => {
    const el = computeElevation(W, H, 3)
    const m = computeMoisture(W, H, el, 3)
    expect(m).toEqual(computeMoisture(W, H, el, 3))
    for (const v of m) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    // moyenne d'humidité des tuiles basses > celle des tuiles hautes
    let loSum = 0, loN = 0, hiSum = 0, hiN = 0
    for (let i = 0; i < el.length; i++) {
      if (el[i]! < 0.3) { loSum += m[i]!; loN++ }
      else if (el[i]! > 0.7) { hiSum += m[i]!; hiN++ }
    }
    expect(loSum / loN).toBeGreaterThan(hiSum / hiN)
  })
})

describe('generateAlpineTerrain — bandes & assemblage', () => {
  const W = 160, H = 240

  it('déterministe (terrain + elevation)', () => {
    const a = generateAlpineTerrain(W, H, 5)
    const b = generateAlpineTerrain(W, H, 5)
    expect(a.terrain).toEqual(b.terrain)
    expect(a.elevation).toEqual(b.elevation)
  })

  it('enceinte scellée : tout le bord est bloquant', () => {
    const map = generateAlpineTerrain(W, H, 5)
    for (let x = 0; x < W; x++) { expect(isBlockingTile(map, x, 0)).toBe(true); expect(isBlockingTile(map, x, H - 1)).toBe(true) }
    for (let y = 0; y < H; y++) { expect(isBlockingTile(map, 0, y)).toBe(true); expect(isBlockingTile(map, W - 1, y)).toBe(true) }
  })

  it('bandes ordonnées : la neige est en moyenne plus haute que la roche > éboulis > forêt > prairie', () => {
    const map = generateAlpineTerrain(W, H, 5)
    const avgEl: Record<number, { s: number; n: number }> = {}
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const t = terrainAt(map, tx, ty); const e = map.elevation![ty * W + tx]!
      ;(avgEl[t] ??= { s: 0, n: 0 }); avgEl[t]!.s += e; avgEl[t]!.n += 1
    }
    const mean = (t: number): number => (avgEl[t] ? avgEl[t]!.s / avgEl[t]!.n : 0)
    expect(mean(TERRAIN_SNOW)).toBeGreaterThan(mean(TERRAIN_ROCK))
    expect(mean(TERRAIN_ROCK)).toBeGreaterThan(mean(TERRAIN_SCREE))
    expect(mean(TERRAIN_SCREE)).toBeGreaterThan(mean(TERRAIN_FOREST))
    expect(mean(TERRAIN_FOREST)).toBeGreaterThan(mean(TERRAIN_GRASS))
  })

  it('variété : au moins 5 terrains distincts présents au-dessus d\'un seuil de surface', () => {
    const map = generateAlpineTerrain(W, H, 5)
    const count: Record<number, number> = {}
    for (const t of map.terrain) count[t] = (count[t] ?? 0) + 1
    const present = [TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW, TERRAIN_MARSH]
      .filter((t) => (count[t] ?? 0) > W * H * 0.01)
    expect(present.length).toBeGreaterThanOrEqual(5)
  })

  it('scalabilité : proportions de bandes stables entre deux tailles (mêmes seuils)', () => {
    const small = generateAlpineTerrain(120, 180, 5)
    const big = generateAlpineTerrain(240, 360, 5)
    const frac = (m: typeof small, t: number): number => m.terrain.filter((x) => x === t).length / m.terrain.length
    // la part de neige varie peu avec la taille (même modèle, mêmes seuils)
    expect(Math.abs(frac(small, TERRAIN_SNOW) - frac(big, TERRAIN_SNOW))).toBeLessThan(0.08)
  })
})
