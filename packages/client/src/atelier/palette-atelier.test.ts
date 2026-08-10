/**
 * LA GARDE DE COUVERTURE DU PICKER (spec `lieux-batis.md` N6) : la taxonomie par thèmes est
 * ÉDITORIALE — une table explicite — et une table explicite prend du retard en silence dès
 * que la légende grandit. Ici, elle ne peut pas : tout caractère de légende doit avoir un
 * THÈME et une AIDE, et la table ne porte aucun caractère mort.
 */
import { describe, expect, it } from 'vitest'
import { LEGENDE } from '@ashes/sim'
import { AIDE_PALETTE } from './aide'
import { THEME_DE } from './palette'

describe('le picker par thèmes (garde N6)', () => {
  const cars = ['·', ...Object.keys(LEGENDE)]

  it('tout caractère de légende a un THÈME et une AIDE', () => {
    for (const c of cars) {
      expect(THEME_DE[c], `« ${c} » sans thème — ajoute-le à THEME_DE (palette.ts)`).toBeDefined()
      expect(AIDE_PALETTE[c], `« ${c} » sans aide — ajoute-le à AIDE_PALETTE (aide.ts)`).toBeTruthy()
    }
  })

  it('la table ne porte aucun caractère mort', () => {
    for (const c of Object.keys(THEME_DE)) {
      expect(cars, `« ${c} » n'est plus en légende — retire-le de THEME_DE`).toContain(c)
    }
  })
})
