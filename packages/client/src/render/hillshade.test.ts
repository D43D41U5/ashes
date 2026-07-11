import { describe, expect, it } from 'vitest'
import { hillshadeAt, HILLSHADE_MAX, HILLSHADE_MIN } from './hillshade'

/** Échantillonneur d'altitude sur une pente : altitude = a*tx + b*ty. */
const slope = (a: number, b: number) => (tx: number, ty: number) => a * tx + b * ty

describe('hillshadeAt', () => {
  it('un terrain plat ne change pas la couleur', () => {
    expect(hillshadeAt(5, 5, () => 0.5)).toBeCloseTo(1, 10)
  })

  it('une pente qui monte vers l\'est/le sud s\'assombrit (soleil au nord-ouest)', () => {
    expect(hillshadeAt(5, 5, slope(0.01, 0.01))).toBeLessThan(1)
  })

  it('une pente qui monte vers l\'ouest/le nord s\'éclaircit', () => {
    expect(hillshadeAt(5, 5, slope(-0.01, -0.01))).toBeGreaterThan(1)
  })

  it('reste borné même sur une falaise verticale', () => {
    expect(hillshadeAt(5, 5, slope(10, 10))).toBe(HILLSHADE_MIN)
    expect(hillshadeAt(5, 5, slope(-10, -10))).toBe(HILLSHADE_MAX)
  })
})
