import { STRUCTURE_COSTS, WALL_TIERS } from '@braises/sim'
import { describe, expect, it } from 'vitest'
import { BUILDABLES, pieceCost } from './build-menu'

/**
 * LE MENU DU MARTEAU (spec construction R20) : sa logique — quelles pièces, à quel
 * coût selon le matériau — se prouve ici. Le Phaser autour ne fait que placer.
 */
describe('le menu du marteau', () => {
  it('R20 : les pièces sont les BARRIÈRES structurelles seules (décision d’Alexis)', () => {
    // Mur, porte, sol, toit — et RIEN d'autre : le coffre, le four, l'établi et les
    // composants se tiennent et se posent (flux feu de camp), pas au marteau.
    expect([...BUILDABLES]).toEqual(['wall', 'door', 'floor', 'roof'])
  })

  it('R8 : le matériau change le coût des murs/portes, pas celui des pièces molles', () => {
    // Mur : bois → pierre → métal, chacun son coût (le palier de matériau, R8).
    expect(pieceCost('wall', 'wood')).toEqual(WALL_TIERS.wood.wall.cost)
    expect(pieceCost('wall', 'stone')).toEqual(WALL_TIERS.stone.wall.cost)
    expect(pieceCost('door', 'metal')).toEqual(WALL_TIERS.metal.door.cost)
    // Sol/toit : pièces sans palier — le matériau ne les touche pas.
    expect(pieceCost('floor', 'stone')).toEqual(STRUCTURE_COSTS.floor)
    expect(pieceCost('roof', 'metal')).toEqual(STRUCTURE_COSTS.roof)
  })
})
