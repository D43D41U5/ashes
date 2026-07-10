import { describe, expect, it } from 'vitest'
import type { SampleElevation } from './hillshade'
import { assertNoFold, createWarp, elevAtBilinear, maxSouthGradient } from './warp'

/** Champ plat à altitude constante. */
const flat = (v: number): SampleElevation => () => v
/** Champ = rampe linéaire en ty (monte vers le sud), pente `slope` par tuile. */
const rampSouth = (slope: number): SampleElevation => (_tx, ty) => Math.max(0, Math.min(1, ty * slope))

describe('elevAtBilinear', () => {
  it('interpole entre deux tuiles voisines', () => {
    const s: SampleElevation = (tx) => (tx === 0 ? 0 : tx === 1 ? 1 : 0)
    expect(elevAtBilinear(0.5, 0, s)).toBeCloseTo(0.5, 6)
  })
})

describe('createWarp.lift', () => {
  it('soulève de elev·H', () => {
    const w = createWarp(flat(0.5), 40, 16)
    expect(w.lift(3, 7)).toBeCloseTo(20, 6) // 0.5 × 40
  })
})

describe('createWarp.unproject', () => {
  it('X exact : jamais cisaillé', () => {
    const w = createWarp(flat(0.3), 40, 16)
    expect(w.unproject(123, 456).x).toBe(123)
  })

  it('aller-retour : unproject(project(p)) ≈ p sur un versant', () => {
    const H = 40, TILE = 16
    const w = createWarp(rampSouth(0.02), H, TILE)
    // Un point monde vrai (tuiles) → son py écran-monde plat, puis on ré-inverse.
    for (const tyTrue of [1, 5, 12, 20]) {
      const txTrue = 4
      const flatY = tyTrue * TILE - w.lift(txTrue, tyTrue)
      const flatX = txTrue * TILE
      const back = w.unproject(flatX, flatY)
      expect(back.x / TILE).toBeCloseTo(txTrue, 4)
      expect(back.y / TILE).toBeCloseTo(tyTrue, 3)
    }
  })

  it('sol plat : unproject = identité (elev constante nulle)', () => {
    const w = createWarp(flat(0), 40, 16)
    const back = w.unproject(80, 160)
    expect(back.x).toBe(80)
    expect(back.y).toBeCloseTo(160, 4)
  })
})

describe('garde anti-repli', () => {
  it('maxSouthGradient lit la plus forte montée vers le sud', () => {
    // 2×3 : colonne x=0 monte de 0→0.5→0.9 (gradients sud 0.5 puis 0.4).
    const elevation = [0, 0, 0.5, 0.1, 0.9, 0.2]
    expect(maxSouthGradient(elevation, 2, 3)).toBeCloseTo(0.5, 6)
  })

  it('assertNoFold passe quand H·gradient < TILE', () => {
    const elevation = [0, 0.1, 0.2, 0.3] // 1×4, gradient sud max 0.1
    expect(() => assertNoFold(elevation, 1, 4, 40, 16)).not.toThrow() // 0.1×40=4 < 16
  })

  it('assertNoFold jette quand H·gradient ≥ TILE', () => {
    const elevation = [0, 0.5, 1, 1] // 1×4, gradient sud max 0.5
    expect(() => assertNoFold(elevation, 1, 4, 40, 16)).toThrow(/replie/) // 0.5×40=20 ≥ 16
  })
})
