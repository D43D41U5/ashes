import { describe, expect, it } from 'vitest'
import { BALANCE } from '@ashes/sim'
import { cendreTelegraphForDay } from './cendre-telegraph'

const CENDRE_DAY = 2 * BALANCE.ACT_DAYS + 1 // premier jour de l'acte III

describe('le télégraphe de la Cendre (GDD §536)', () => {
  it('annonce la Cendre TROIS jours avant', () => {
    expect(cendreTelegraphForDay(CENDRE_DAY - 3)).toMatch(/approche/i)
  })

  it('rappelle l’urgence LA VEILLE — et nomme la parade (le Feu)', () => {
    const line = cendreTelegraphForDay(CENDRE_DAY - 1)
    expect(line).toMatch(/demain/i)
    expect(line).toMatch(/Feu/)
  })

  it('reste MUET les autres jours (pas de bruit d’alerte quotidien)', () => {
    for (const day of [1, 10, CENDRE_DAY - 2, CENDRE_DAY, CENDRE_DAY + 5, BALANCE.SEASON_DAYS]) {
      expect(cendreTelegraphForDay(day)).toBeNull()
    }
  })

  it('le jour de la Cendre lui-même ne re-télégraphie pas (le déferlement se voit)', () => {
    expect(cendreTelegraphForDay(CENDRE_DAY)).toBeNull()
  })
})
