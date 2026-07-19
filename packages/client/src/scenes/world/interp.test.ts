import { describe, expect, it } from 'vitest'
import { pushSample, sampleAt, type Sample } from './interp'

describe('interpolation des entités distantes (tampon de gigue)', () => {
  const buf = (): Sample[] => {
    const b: Sample[] = []
    pushSample(b, 100, 0, 0)
    pushSample(b, 200, 10, 0)
    pushSample(b, 300, 10, 10)
    return b
  }

  it('interpole entre les deux relevés qui encadrent la cible', () => {
    // target 150 : à mi-chemin entre (100→200), x va de 0 à 10.
    expect(sampleAt(buf(), 150)).toEqual({ x: 5, y: 0 })
    // target 250 : à mi-chemin entre (200→300), y va de 0 à 10.
    expect(sampleAt(buf(), 250)).toEqual({ x: 10, y: 5 })
  })

  it('tombe pile sur un relevé', () => {
    expect(sampleAt(buf(), 200)).toEqual({ x: 10, y: 0 })
  })

  it('cible avant le premier relevé (démarrage à froid) → le premier', () => {
    expect(sampleAt(buf(), 50)).toEqual({ x: 0, y: 0 })
  })

  it('cible après le dernier (tampon affamé) → GÈLE sur le dernier, pas d’extrapolation', () => {
    expect(sampleAt(buf(), 999)).toEqual({ x: 10, y: 10 })
  })

  it('buffer vide → null (l’appelant garde sa position)', () => {
    expect(sampleAt([], 100)).toBeNull()
  })

  it('borne la taille du tampon en jetant les plus vieux', () => {
    const b: Sample[] = []
    for (let i = 0; i < 30; i++) pushSample(b, i, i, 0)
    expect(b.length).toBe(12)
    expect(b[0]!.at).toBe(18) // 30 - 12
    expect(b[b.length - 1]!.at).toBe(29)
  })
})
