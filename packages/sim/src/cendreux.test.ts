import { describe, it, expect } from 'vitest'
import { MONSTER_DEFS, CENDREUX } from './balance'

describe('type cendreux (fondation)', () => {
  it('MONSTER_DEFS.cendreux : PV bas, dégâts hauts, très lent', () => {
    const d = MONSTER_DEFS.cendreux
    expect(d.hp).toBe(20) // 2 coups d'arme basique
    expect(d.damage).toBe(34) // 3 coups tuent un avatar 100 PV
    expect(d.speed).toBeLessThan(2) // très lent (joueur = 4)
  })
  it('constantes CENDREUX présentes', () => {
    expect(CENDREUX.WITNESS_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.HEARTH_WARD_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.RISE_DELAY).toBeGreaterThan(0)
    expect(CENDREUX.WARMTH_SEEK_RANGE).toBeGreaterThan(0)
  })
})
