import { describe, expect, it } from 'vitest'
import { fbm2, fbmWarp2, gradientNoise2, hash2 } from './noise'

describe('le bruit déterministe', () => {
  it('hash2 est stable, seedé, et dans [0, 1)', () => {
    expect(hash2(12, 34)).toBe(hash2(12, 34))
    expect(hash2(12, 34)).not.toBe(hash2(34, 12))
    expect(hash2(12, 34, 7)).not.toBe(hash2(12, 34, 8))
    for (let i = 0; i < 1000; i++) {
      const v = hash2(i, i * 31, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('hash2 sans seed reproduit le hash historique de demo-map (shading client)', () => {
    let h = (12 * 374761393 + 34 * 668265263) >>> 0
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
    const expected = ((h ^ (h >>> 16)) >>> 0) / 4294967296
    expect(hash2(12, 34)).toBe(expected)
  })

  it('gradientNoise2 vaut exactement 0.5 aux nœuds entiers (signature du bruit gradient)', () => {
    // Le fade quintique annule la contribution des coins voisins aux entiers.
    expect(gradientNoise2(5, 9, 3)).toBe(0.5)
    expect(gradientNoise2(0, 0, 0)).toBe(0.5)
    expect(gradientNoise2(-4, 12, 99)).toBe(0.5)
  })

  it('gradientNoise2 est stable, dans [0, 1), et continu', () => {
    expect(gradientNoise2(3.2, 5.7, 1)).toBe(gradientNoise2(3.2, 5.7, 1))
    for (let i = 0; i < 1000; i++) {
      const v = gradientNoise2(i * 1.3, i * 0.7, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    const a = gradientNoise2(3.0, 5.0, 1)
    const b = gradientNoise2(3.002, 5.0, 1)
    expect(Math.abs(a - b)).toBeLessThan(0.02)
  })

  it('gradientNoise2 a une moyenne empirique proche de 0.5 (symétrique autour de 0)', () => {
    let sum = 0
    let n = 0
    for (let i = 0; i < 400; i++) {
      sum += gradientNoise2(i * 0.37 + 0.13, i * 0.61 + 0.29, 7)
      n += 1
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.05)
  })

  it('fbm2 est stable et dans [0, 1)', () => {
    expect(fbm2(40, 60, 24, 2026)).toBe(fbm2(40, 60, 24, 2026))
    for (let i = 0; i < 500; i++) {
      const v = fbm2(i * 1.7, i * 0.9, 24, 99)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('fbmWarp2 à amplitude 0 est identique à fbm2 (bit à bit)', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 1.9 + 0.3
      const y = i * 0.8 + 0.7
      expect(fbmWarp2(x, y, 24, 2026, 0)).toBe(fbm2(x, y, 24, 2026))
    }
  })

  it('fbmWarp2 à amplitude > 0 déplace l\'échantillonnage (diffère de fbm2)', () => {
    let differ = 0
    for (let i = 0; i < 200; i++) {
      const x = i * 1.9 + 0.3
      const y = i * 0.8 + 0.7
      if (fbmWarp2(x, y, 24, 2026, 8) !== fbm2(x, y, 24, 2026)) differ += 1
    }
    expect(differ).toBeGreaterThan(150) // la grande majorité des points bougent
  })

  it('fbmWarp2 est stable et dans [0, 1)', () => {
    expect(fbmWarp2(40, 60, 24, 7, 8)).toBe(fbmWarp2(40, 60, 24, 7, 8))
    for (let i = 0; i < 400; i++) {
      const v = fbmWarp2(i * 1.3, i * 0.7, 16, 5, 8)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
