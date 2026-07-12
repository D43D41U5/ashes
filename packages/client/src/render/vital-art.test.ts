import { describe, expect, it } from 'vitest'
import { VITAL_PAINTS, vitalIconKey, type VitalId } from './vital-art'

// Les quatre jauges du HUD, dérivées du Record (donc exhaustives par le type).
const ALL_VITALS = Object.keys(VITAL_PAINTS) as VitalId[]

describe('vital-art', () => {
  it('chaque vitale a une clé de texture', () => {
    for (const id of ALL_VITALS) {
      expect(vitalIconKey(id)).toBe(`vt-${id}`)
    }
  })

  // Même garde-fou que pour les items : une jauge sans dessin donnerait une
  // texture manquante — un carré blanc dans le HUD, en silence.
  it('chaque vitale a une fonction de dessin', () => {
    expect(ALL_VITALS).toHaveLength(4)
    for (const id of ALL_VITALS) {
      expect(typeof VITAL_PAINTS[id]).toBe('function')
    }
  })
})
