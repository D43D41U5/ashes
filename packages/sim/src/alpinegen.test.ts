import { describe, expect, it } from 'vitest'
import { computeElevation } from './alpinegen'

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
