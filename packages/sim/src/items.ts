/**
 * Items et inventaires — le strict nécessaire pour V3 (spec village R3).
 * La récolte, l'usure et les tiers arrivent avec l'économie (V4) ; ici on
 * pose seulement les stacks et leurs opérations, canoniques et sérialisables.
 */

export type ItemId =
  | 'wood'
  | 'stone'
  | 'fiber'
  | 'berries'
  | 'stew'
  | 'iron_ore'
  | 'coal'
  | 'iron_ingot'
  | 'axe'
  | 'pickaxe'
  | 'iron_axe'
  | 'iron_pickaxe'

/** Stacks d'items. Invariant : jamais de clé à 0 (snapshot canonique). */
export type Inventory = Partial<Record<ItemId, number>>

export type StructureType = 'fire' | 'wall' | 'door' | 'chest' | 'workshop' | 'furnace'

export type AccessLevel = 'private' | 'village' | 'public'

/** Les quatre métiers V4 (spec économie R12). */
export type SkillId = 'woodcutting' | 'mining' | 'foraging' | 'crafting'

export function countOf(inv: Inventory, item: ItemId): number {
  return inv[item] ?? 0
}

export function hasItems(inv: Inventory, cost: Inventory): boolean {
  return (Object.keys(cost) as ItemId[]).every((item) => countOf(inv, item) >= (cost[item] ?? 0))
}

export function addItems(inv: Inventory, items: Inventory): void {
  for (const item of Object.keys(items) as ItemId[]) {
    const count = items[item] ?? 0
    if (count > 0) inv[item] = countOf(inv, item) + count
  }
}

/** Retire `cost` de `inv`. Refuse tout ou rien. */
export function removeItems(inv: Inventory, cost: Inventory): boolean {
  if (!hasItems(inv, cost)) return false
  for (const item of Object.keys(cost) as ItemId[]) {
    const remaining = countOf(inv, item) - (cost[item] ?? 0)
    if (remaining > 0) inv[item] = remaining
    else delete inv[item]
  }
  return true
}
