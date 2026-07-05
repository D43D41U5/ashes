import { describe, expect, it } from 'vitest'
import { rngFloat, rngNext, rngRoll } from './rng'

describe('rng', () => {
  it('produit la même séquence pour la même seed', () => {
    const drawSequence = (seed: number) => {
      let state = seed
      const values: number[] = []
      for (let i = 0; i < 100; i++) {
        const { value, next } = rngRoll(state)
        values.push(value)
        state = next
      }
      return values
    }
    expect(drawSequence(42)).toEqual(drawSequence(42))
  })

  it('produit des séquences différentes pour des seeds différentes', () => {
    expect(rngFloat(rngNext(1))).not.toBe(rngFloat(rngNext(2)))
  })

  it('reste dans [0, 1)', () => {
    let state = 7
    for (let i = 0; i < 1000; i++) {
      const { value, next } = rngRoll(state)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      state = next
    }
  })
})
