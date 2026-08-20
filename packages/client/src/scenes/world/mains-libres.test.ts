import { describe, expect, it } from 'vitest'
import { mainsLibres, type EtatDesMains } from './mains-libres'

describe('les mains libres : le joueur commande-t-il son avatar ?', () => {
  const CHAMPS = ['saisit', 'meurt', 'enPause'] as const

  it('P0.6/P0.7 — exhaustif : les mains ne sont libres QUE si les trois faits sont faux', () => {
    // GARDE EXHAUSTIVE, pas trois cas choisis : c'est en ajoutant un état à la main dans une
    // condition existante que `meurt` et `enPause` ont été oubliés, un par un.
    for (let masque = 0; masque < 1 << CHAMPS.length; masque++) {
      const e = Object.fromEntries(
        CHAMPS.map((c, i) => [c, (masque & (1 << i)) !== 0]),
      ) as unknown as EtatDesMains
      const aucunEmpechement = CHAMPS.every((c) => !e[c])
      expect([masque, mainsLibres(e)]).toEqual([masque, aucunEmpechement])
    }
  })

  it('P0.6 — mourir en tenant une direction ne commande plus rien', () => {
    expect(mainsLibres({ saisit: false, meurt: true, enPause: false })).toBe(false)
  })

  it('P0.7 — le menu pause met VRAIMENT en pause', () => {
    expect(mainsLibres({ saisit: false, meurt: false, enPause: true })).toBe(false)
  })

  it('la garde voit ce qu’elle garde : au repos, on commande bien', () => {
    expect(mainsLibres({ saisit: false, meurt: false, enPause: false })).toBe(true)
  })
})
