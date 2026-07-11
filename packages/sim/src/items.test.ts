import { describe, expect, it } from 'vitest'
import {
  addItems,
  countOf,
  freeRoomFor,
  hasItems,
  isEmpty,
  itemsIn,
  makeInventory,
  removeItems,
  toBag,
  type Inventory,
} from './items'

describe('le socle à cases', () => {
  // A1 — remplissage : on ouvre les cases dans l'ordre, on respecte la taille de pile.
  it('A1 : addItems remplit dans l’ordre des cases et coupe aux tailles de pile', () => {
    const inv = makeInventory(4)
    const left = addItems(inv, { wood: 45 }) // STACK_SIZES.wood = 20
    expect(inv).toEqual([
      { item: 'wood', count: 20 },
      { item: 'wood', count: 20 },
      { item: 'wood', count: 5 },
      null,
    ])
    expect(left).toEqual({})
  })

  // A2 — on COMPLÈTE les piles existantes avant d'ouvrir une case vide.
  it('A2 : addItems complète les piles incomplètes avant d’ouvrir une case vide', () => {
    const inv = makeInventory(3)
    inv[0] = { item: 'wood', count: 15 }
    inv[2] = { item: 'wood', count: 20 } // déjà pleine
    const left = addItems(inv, { wood: 10 })
    expect(inv).toEqual([
      { item: 'wood', count: 20 }, // +5 : on complète d'abord
      { item: 'wood', count: 5 }, // puis on ouvre la case vide
      { item: 'wood', count: 20 },
    ])
    expect(left).toEqual({})
  })

  // A3 — sac plein : rien ne bouge, et le reliquat le DIT.
  it('A3 : addItems sur un sac plein ne change rien et retourne le reliquat', () => {
    const inv = makeInventory(1)
    inv[0] = { item: 'wood', count: 20 } // pleine, et aucune autre case
    const left = addItems(inv, { stone: 3 })
    expect(inv).toEqual([{ item: 'wood', count: 20 }])
    expect(left).toEqual({ stone: 3 })
  })

  it('A3bis : addItems retourne le reliquat PARTIEL quand une partie seulement rentre', () => {
    const inv = makeInventory(2)
    inv[0] = { item: 'wood', count: 18 } // 2 places
    inv[1] = { item: 'stone', count: 20 } // pleine
    const left = addItems(inv, { wood: 7 })
    expect(inv[0]).toEqual({ item: 'wood', count: 20 })
    expect(left).toEqual({ wood: 5 })
  })

  // A4 — removeItems reste TOUT-OU-RIEN.
  it('A4 : removeItems est tout-ou-rien et ne laisse jamais une case à 0', () => {
    const inv = makeInventory(2)
    inv[0] = { item: 'wood', count: 5 }
    inv[1] = { item: 'wood', count: 5 }
    expect(removeItems(inv, { wood: 12 })).toBe(false)
    expect(toBag(inv)).toEqual({ wood: 10 }) // inchangé
    expect(removeItems(inv, { wood: 8 })).toBe(true)
    expect(inv).toEqual([null, { item: 'wood', count: 2 }])
  })

  // A5 — deux outils = deux cases = deux usures indépendantes.
  it('A5 : deux outils occupent deux cases distinctes (pile de 1)', () => {
    const inv = makeInventory(4)
    addItems(inv, { axe: 2 })
    expect(inv[0]).toEqual({ item: 'axe', count: 1 })
    expect(inv[1]).toEqual({ item: 'axe', count: 1 })
    expect(countOf(inv, 'axe')).toBe(2)
  })

  it('countOf / hasItems agrègent toutes les cases', () => {
    const inv = makeInventory(3)
    inv[0] = { item: 'wood', count: 5 }
    inv[2] = { item: 'wood', count: 7 }
    expect(countOf(inv, 'wood')).toBe(12)
    expect(countOf(inv, 'stone')).toBe(0)
    expect(hasItems(inv, { wood: 12 })).toBe(true)
    expect(hasItems(inv, { wood: 13 })).toBe(false)
  })

  // R6 — la garde qui tue le bug de conception : une case ENTAMÉE n'avale pas
  // du neuf. Aucun code de production n'écrit encore `wear` dans une case (c'est
  // la tâche 3) : sans ces deux tests la garde a l'air morte, et quelqu'un la
  // « simplifiera ».
  it('R6 : une case usée n’absorbe jamais un ajout — addItems ouvre une case neuve', () => {
    const outils = makeInventory(2)
    outils[0] = { item: 'axe', count: 1, wear: 3 } // hache entamée
    expect(addItems(outils, { axe: 1 })).toEqual({})
    expect(outils).toEqual([
      { item: 'axe', count: 1, wear: 3 }, // l'usure reste sur SA case
      { item: 'axe', count: 1 }, // la neuve prend la sienne
    ])
    // Même sur un EMPILABLE : une pile usée ne se complète pas (la case usée est
    // hors du jeu de l'empilement, quelle que soit la taille de pile).
    const piles = makeInventory(2)
    piles[0] = { item: 'wood', count: 5, wear: 2 }
    expect(addItems(piles, { wood: 3 })).toEqual({})
    expect(piles).toEqual([
      { item: 'wood', count: 5, wear: 2 },
      { item: 'wood', count: 3 },
    ])
  })

  it('R6 : freeRoomFor ignore la place d’une case usée', () => {
    const inv: Inventory = [{ item: 'wood', count: 5, wear: 2 }]
    // 15 unités « tiendraient » dans la pile — mais elle est usée : place réelle 0.
    expect(freeRoomFor(inv, 'wood')).toBe(0)
    expect(addItems(inv, { wood: 1 })).toEqual({ wood: 1 })
  })

  it('toBag / itemsIn / isEmpty / freeRoomFor', () => {
    const inv = makeInventory(3)
    expect(isEmpty(inv)).toBe(true)
    addItems(inv, { wood: 25, stone: 1 })
    expect(isEmpty(inv)).toBe(false)
    expect(toBag(inv)).toEqual({ wood: 25, stone: 1 })
    expect(itemsIn(inv)).toEqual(['wood', 'stone'])
    // 3 cases : [wood 20][wood 5][stone 1] → il reste 15 de place dans la pile de bois.
    expect(freeRoomFor(inv, 'wood')).toBe(15)
    expect(freeRoomFor(inv, 'berries')).toBe(0) // aucune case libre
  })
})
