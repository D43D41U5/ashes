import { describe, expect, it } from 'vitest'
import { ECHO_S, GOUTTE, GOUTTE_ECHO, SonsDeLaGrotte } from './grotte-audio'
import { PORTEE } from './spatial'
import type { SoundSpec } from './sound'

describe('les sons de la grotte (SonsDeLaGrotte)', () => {
  it('une goutte = un ploc qui MONTE puis son écho, plus bas, plus sourd, plus tard — les deux LÀ OÙ elle tombe', () => {
    const joues: { spec: SoundSpec; delay: number; at: { x: number; y: number } | undefined }[] = []
    const s = new SonsDeLaGrotte()
    s.goutte(12.5, 40.5, (spec, delay = 0, at) => joues.push({ spec, delay, at }))
    expect(joues).toHaveLength(2)
    const [ploc, echo] = joues as [typeof joues[0], typeof joues[0]]
    // Le ploc monte (la bulle se referme), l'écho aussi — et il est plus bas que le ploc.
    expect(ploc.spec.freqEnd!).toBeGreaterThan(ploc.spec.freq)
    expect(echo.spec.freq).toBeLessThan(ploc.spec.freq)
    expect(echo.spec.gain).toBeLessThan(ploc.spec.gain / 2)
    expect(echo.spec.lowpass).toBeDefined()
    expect(ploc.delay).toBe(0)
    expect(echo.delay).toBe(ECHO_S)
    // Spatialisées toutes les deux sur la tuile d'impact, à la portée du GESTE : pas un cri.
    expect(ploc.at).toEqual({ x: 12.5, y: 40.5 })
    expect(echo.at).toEqual({ x: 12.5, y: 40.5 })
    expect(ploc.spec.portee).toBe(PORTEE.GESTE)
    expect(echo.spec.portee).toBe(PORTEE.GESTE)
    expect(s.sonde.gouttes).toBe(1)
  })

  it('deux gouttes n’ont pas la même hauteur (pas d’horloge), dans ±18 % de la note', () => {
    const freqs: number[] = []
    const s = new SonsDeLaGrotte()
    for (let i = 0; i < 12; i++) s.goutte(0, 0, (spec, delay = 0) => { if (delay === 0) freqs.push(spec.freq) })
    expect(new Set(freqs).size).toBeGreaterThan(1)
    for (const f of freqs) {
      expect(f).toBeGreaterThanOrEqual(GOUTTE.freq * 0.82 - 1e-9)
      expect(f).toBeLessThanOrEqual(GOUTTE.freq * 1.18 + 1e-9)
    }
  })

  it('gains bas : sous le plafond des one-shots (0,15), et l’écho sous la goutte', () => {
    expect(GOUTTE.gain).toBeLessThanOrEqual(0.15)
    expect(GOUTTE_ECHO.gain).toBeLessThan(GOUTTE.gain)
  })
})
