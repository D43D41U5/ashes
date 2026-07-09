import { describe, expect, it } from 'vitest'
import { hillshadeAt, HILLSHADE_MAX, HILLSHADE_MIN, stepShadeAt, STEP_SHADE } from './hillshade'

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

describe('stepShadeAt', () => {
  /** Palier 1 partout, sauf une bande haute (palier 2) à l'ouest de x=5. */
  const lvl = (tx: number, ty: number): number => {
    if (tx < 0 || ty < 0 || tx > 9 || ty > 9) return -1
    return tx < 5 ? 2 : 1
  }

  it('assombrit la tuile basse au pied d\'une marche à l\'ouest', () => {
    expect(stepShadeAt(5, 5, lvl)).toBe(STEP_SHADE)
  })

  it('n\'assombrit pas la tuile haute', () => {
    expect(stepShadeAt(4, 5, lvl)).toBe(1)
  })

  it('n\'assombrit pas en terrain de palier constant', () => {
    expect(stepShadeAt(8, 5, lvl)).toBe(1)
  })

  it('vaut 1 quand la carte n\'a pas de paliers (échantillon -1)', () => {
    expect(stepShadeAt(3, 3, () => -1)).toBe(1)
  })
})
