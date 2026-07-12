import { describe, expect, it } from 'vitest'
import { ITEM_LABELS, itemIconKey } from './item-art'

// La liste EXHAUSTIVE des ItemId de la sim — si la sim en ajoute un, ce test casse,
// et c'est le but : un item sans icône serait une case vide à l'écran.
const ALL_ITEMS = [
  'wood', 'stone', 'fiber', 'berries', 'stew', 'iron_ore', 'coal', 'iron_ingot',
  'axe', 'pickaxe', 'iron_axe', 'iron_pickaxe', 'spear', 'raw_meat', 'cooked_meat', 'components',
] as const

describe('item-art', () => {
  it('chaque item a une clé de texture et un nom français', () => {
    for (const item of ALL_ITEMS) {
      expect(itemIconKey(item)).toBe(`it-${item}`)
      expect(ITEM_LABELS[item]).toBeTruthy()
    }
  })
})
