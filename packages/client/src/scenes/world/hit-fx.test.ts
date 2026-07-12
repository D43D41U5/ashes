import { describe, expect, it } from 'vitest'
import { SHAKE_MS, shakeOffset } from './hit-fx'

describe('shakeOffset — le tressaillement s’AMORTIT (G10)', () => {
  it('vaut zéro hors de la fenêtre du coup', () => {
    expect(shakeOffset(0, 0)).toBe(0) // t = 0 : l’oscillation démarre à sin(0)
    expect(shakeOffset(SHAKE_MS, 0)).toBe(0)
    expect(shakeOffset(SHAKE_MS + 500, 0)).toBe(0)
    expect(shakeOffset(-10, 0)).toBe(0)
  })

  it('bouge pendant la fenêtre, et jamais au-delà de l’amplitude', () => {
    let peak = 0
    for (let t = 0; t < SHAKE_MS; t += 2) peak = Math.max(peak, Math.abs(shakeOffset(t, 0)))
    expect(peak).toBeGreaterThan(0.4)
    expect(peak).toBeLessThanOrEqual(1.6)
  })

  it('décroît : la fin du tressaillement est plus douce que son début', () => {
    const early = Math.max(...Array.from({ length: 30 }, (_, i) => Math.abs(shakeOffset(i * 1.5, 0))))
    const late = Math.max(
      ...Array.from({ length: 30 }, (_, i) => Math.abs(shakeOffset(SHAKE_MS * 0.6 + i * 1.5, 0))),
    )
    // Un tremblement d’amplitude CONSTANTE lirait comme un bug de rendu, pas comme un impact.
    expect(late).toBeLessThan(early)
  })
})
