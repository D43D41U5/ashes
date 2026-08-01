import { BARRIER_TYPES, STRUCTURE_COSTS, WALL_TIERS, piece } from '@ashes/sim'
import { describe, expect, it } from 'vitest'
import { BUILDABLES, pieceCost } from './build-menu'

/**
 * LE MENU DU MARTEAU (spec construction R20) : sa logique — quelles pièces, à quel
 * coût selon le matériau — se prouve ici. Le Phaser autour ne fait que placer.
 */
describe('le menu du marteau', () => {
  it('D1 : le menu du marteau se DÉRIVE du registre — plus une liste écrite ici', () => {
    // La règle (décision d'Alexis, 2026-08-01) : « ce qui EST le bâtiment se bâtit au
    // marteau ; ce qui est DANS le bâtiment se fabrique puis se pose ». Le menu n'est plus
    // une liste : c'est la lecture d'un champ (`pose`), donc une pièce structurelle neuve y
    // apparaît d'elle-même, avec son nom français et son coût.
    expect([...BUILDABLES]).toEqual(BARRIER_TYPES)
    // Ce que ça donne aujourd'hui : les cinq d'origine, plus la clôture et l'encadrement,
    // qui avaient coût, PV et dessin depuis le monde bâti sans aucune route vers le joueur.
    expect([...BUILDABLES]).toEqual(['wall', 'palissade', 'door', 'floor', 'roof', 'cloture', 'encadrement'])
    // Et RIEN qui se tienne en main : ni le coffre, ni un composant.
    for (const p of BUILDABLES) expect(piece(p).pose).toBe('marteau')
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
