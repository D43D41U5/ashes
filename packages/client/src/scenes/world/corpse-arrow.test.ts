import { describe, expect, it } from 'vitest'
import { corpseArrow, corpseSecondsLeft, type WorldView } from './corpse-arrow'

// Une vue caméra 800×600 monde, centrée sur l'avatar en (1000, 1000).
const view: WorldView = { x: 600, y: 700, width: 800, height: 600 }
const SW = 800
const SH = 600

describe('la flèche vers la dépouille (mort-suite 2)', () => {
  it('dépouille à DROITE de l’avatar → flèche à droite du centre, angle ~0', () => {
    const a = corpseArrow(1000, 1000, 2000, 1000, view, SW, SH)
    expect(a.x).toBeGreaterThan(SW / 2)
    expect(a.y).toBeCloseTo(SH / 2, 0)
    expect(a.angle).toBeCloseTo(0, 5)
  })

  it('dépouille EN HAUT (y plus petit) → flèche au-dessus du centre, angle ~ -π/2', () => {
    const a = corpseArrow(1000, 1000, 1000, 200, view, SW, SH)
    expect(a.y).toBeLessThan(SH / 2)
    expect(a.angle).toBeCloseTo(-Math.PI / 2, 5)
  })

  it('la flèche se pose sur un rayon fixe du centre (près du bord)', () => {
    const a = corpseArrow(1000, 1000, 5000, 1000, view, SW, SH, 0.4)
    const R = Math.min(SW, SH) * 0.4
    expect(Math.hypot(a.x - SW / 2, a.y - SH / 2)).toBeCloseTo(R, 3)
  })

  it('dépouille DANS le cadre → onScreen vrai (le client peut cacher la flèche)', () => {
    const a = corpseArrow(1000, 1000, 1050, 1010, view, SW, SH)
    expect(a.onScreen).toBe(true)
  })

  it('dépouille HORS cadre → onScreen faux', () => {
    const a = corpseArrow(1000, 1000, 3000, 1000, view, SW, SH)
    expect(a.onScreen).toBe(false)
  })

  it('le compte à rebours décante en secondes, borné à 0', () => {
    expect(corpseSecondsLeft(1000, 600, 20)).toBe(20) // (1000-600)/20
    expect(corpseSecondsLeft(1000, 1200, 20)).toBe(0) // déjà décanté
  })
})
