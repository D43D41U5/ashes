import { describe, expect, it } from 'vitest'
import type { ItemId } from '@braises/sim'
import { ITEM_LABELS, ITEM_PAINTS, itemIconKey } from './item-art'

// La liste des items se DÉRIVE des labels (un Record<ItemId, …>, donc exhaustif
// par le type) : impossible d'oublier un item ici, la sim en est la source.
const ALL_ITEMS = Object.keys(ITEM_LABELS) as ItemId[]

describe('item-art', () => {
  it('chaque item a une clé de texture et un nom français', () => {
    for (const item of ALL_ITEMS) {
      expect(itemIconKey(item)).toBe(`it-${item}`)
      expect(ITEM_LABELS[item]).toBeTruthy()
    }
  })

  // Le vrai garde-fou : un dessin PAR item. Sans lui, un nouvel ItemId aurait
  // label + clé (concaténation « toujours vraie ») mais aucune texture → case
  // vide. Le type `Record<ItemId, …>` ferme le trou au build ; ce test le
  // vérifie aussi au runtime (au cas où le type serait affaibli).
  it('chaque item a une fonction de dessin', () => {
    for (const item of ALL_ITEMS) {
      expect(typeof ITEM_PAINTS[item]).toBe('function')
    }
  })
})
