import { describe, expect, it } from 'vitest'
import { BALANCE, YEAR_DAYS } from '@ashes/sim'
import { cendreTelegraphForDay } from './cendre-telegraph'

// L'OUVERTURE DU GRAND FROID (S11) : c'est là que la Cendre s'ébranle, plus à l'acte III.
// Dérivé d'`ACT_DAYS` comme la source, pour que le test suive une refonte de cadence.
const CENDRE_DAY = 3 * BALANCE.ACT_DAYS + 1

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
    for (const day of [1, 10, CENDRE_DAY - 2, CENDRE_DAY, CENDRE_DAY + 5, YEAR_DAYS]) {
      expect(cendreTelegraphForDay(day)).toBeNull()
    }
  })

  it('ANNUEL : l’hiver de l’an 2 est prévenu comme le premier, et le dit (T3)', () => {
    const an2 = YEAR_DAYS + CENDRE_DAY
    expect(cendreTelegraphForDay(an2 - 3)).toMatch(/hiver revient/i)
    expect(cendreTelegraphForDay(an2 - 1)).toMatch(/demain/i)
    expect(cendreTelegraphForDay(an2)).toBeNull()
    // Et jamais « la fin » ni « la méga-horde » : l'arc oscille, la méga-horde est morte.
    for (const d of [CENDRE_DAY - 3, CENDRE_DAY - 1, an2 - 3, an2 - 1]) {
      expect(cendreTelegraphForDay(d)).not.toMatch(/la fin|méga-horde/i)
    }
  })

  it('le jour de la Cendre lui-même ne re-télégraphie pas (le déferlement se voit)', () => {
    expect(cendreTelegraphForDay(CENDRE_DAY)).toBeNull()
  })
})
