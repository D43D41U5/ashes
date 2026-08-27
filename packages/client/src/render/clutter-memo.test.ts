import { describe, expect, it } from 'vitest'
import { TERRAIN_FOREST, TERRAIN_GRASS, terrainCendre } from '@ashes/sim'
import { clutterAt, type SampleTerrain } from './clutter'
import { MAX_TUILES_MEMO, MemoireDuDecor } from './clutter-memo'

/** LA CONVERSION QUE LE JEU FAIT VRAIMENT quand le front atteint la tuile — pas un id choisi
 *  à la main : c'est `terrainCendre` que `ClutterLayer` appelle, et son résultat qui devient la
 *  clé. Un pré cendré, donc. */
const CENDRE_DU_PRE = terrainCendre(TERRAIN_GRASS)!

const SEED = 4242
const forest: SampleTerrain = () => TERRAIN_FOREST

/** La mémoire, et le `clutterAt` nu auquel on la compare — même graine, même échantillonneur. */
const monter = (sample: SampleTerrain = forest) => new MemoireDuDecor(SEED, sample)

describe('MemoireDuDecor — le décor retenu à la tuile', () => {
  it('rend EXACTEMENT ce que rendrait clutterAt, sur toute une fenêtre', () => {
    const m = monter()
    let nonVides = 0
    for (let ty = 0; ty < 24; ty++) {
      for (let tx = 0; tx < 24; tx++) {
        const attendu = clutterAt(tx, ty, TERRAIN_FOREST, SEED, forest, 0, undefined)
        expect(m.props(ty * 64 + tx, tx, ty, TERRAIN_FOREST, 0)).toEqual(attendu)
        if (attendu.length > 0) nonVides++
      }
    }
    // Sans ça, une fenêtre qui ne pousserait RIEN rendrait tout ce qui précède vrai par vacuité.
    expect(nonVides).toBeGreaterThan(0)
  })

  it('ne rappelle PAS clutterAt sur une tuile déjà vue — c’est tout l’objet', () => {
    const m = monter()
    for (let i = 0; i < 50; i++) m.props(7, 3, 4, TERRAIN_FOREST, 0)
    expect(m.calculs).toBe(1)
    expect(m.taille).toBe(1)
  })

  it('rend le MÊME tableau (identité) tant que le terrain ne bouge pas — zéro allocation', () => {
    const m = monter()
    const a = m.props(7, 3, 4, TERRAIN_FOREST, 0)
    expect(m.props(7, 3, 4, TERRAIN_FOREST, 0)).toBe(a)
  })

  /**
   * LE CAS QUI TUE UN CACHE POSÉ SUR LA SEULE TUILE. La Cendre convertit le terrain à la volée
   * quand le front arrive : si la clé ne portait que l'index, la tuile garderait son pré d'avant
   * l'incendie pour toute la partie, en silence — et un front qui n'arrive jamais dans un cache
   * est exactement le défaut qu'on ne voit pas venir.
   */
  it('RECALCULE quand le terrain change sous la tuile (la cendre arrive)', () => {
    const m = monter()
    const avant = m.props(7, 3, 4, TERRAIN_GRASS, 0)
    expect(m.calculs).toBe(1)
    const apres = m.props(7, 3, 4, CENDRE_DU_PRE, 0)
    expect(m.calculs).toBe(2)
    expect(apres).not.toBe(avant)
    expect(apres).toEqual(clutterAt(3, 4, CENDRE_DU_PRE, SEED, forest, 0, undefined))
    // Et le nouveau terrain est retenu à son tour : on ne recalcule pas en boucle.
    m.props(7, 3, 4, CENDRE_DU_PRE, 0)
    expect(m.calculs).toBe(2)
    // Le pré ne « revient » pas non plus tout seul : ce qui a brûlé ne reverdit pas d'une image
    // à l'autre. (Et si la cendre reculait un jour, la règle marcherait dans ce sens-là aussi.)
    expect(m.props(7, 3, 4, TERRAIN_GRASS, 0)).toEqual(avant)
    expect(m.calculs).toBe(3)
  })

  it('vide tout au débordement, et reste juste après la purge', () => {
    const m = monter()
    for (let i = 0; i < MAX_TUILES_MEMO; i++) m.props(i, i % 512, Math.floor(i / 512), TERRAIN_FOREST, 0)
    expect(m.taille).toBe(MAX_TUILES_MEMO)
    expect(m.purges).toBe(0)
    // La tuile de trop déclenche la purge — et rend malgré tout la bonne réponse.
    const attendu = clutterAt(1, 99, TERRAIN_FOREST, SEED, forest, 0, undefined)
    expect(m.props(999_999, 1, 99, TERRAIN_FOREST, 0)).toEqual(attendu)
    expect(m.purges).toBe(1)
    expect(m.taille).toBe(1)
  })

  it('vider() rend la mémoire vide sans rien casser', () => {
    const m = monter()
    m.props(7, 3, 4, TERRAIN_FOREST, 0)
    m.vider()
    expect(m.taille).toBe(0)
    expect(m.props(7, 3, 4, TERRAIN_FOREST, 0)).toEqual(clutterAt(3, 4, TERRAIN_FOREST, SEED, forest, 0, undefined))
  })
})
