/**
 * Items, cases et inventaires (spec inventaire R1-R6).
 *
 * L'inventaire est POSITIONNEL et BORNÉ : un tableau de cases dont la LONGUEUR
 * EST LA CAPACITÉ (pas de champ « capacité » à tenir cohérent). Une case vide
 * est `null` — l'état reste JSON-sérialisable, sans classe ni Map (invariant §3).
 *
 * DEUX TYPES, à ne pas confondre :
 *   - `Inventory` = ce qu'on PORTE (des cases, une capacité, des usures).
 *   - `ItemBag`   = ce qu'on COMPTE (un coût, un butin, un transfert en gros).
 * Les coûts (`STRUCTURE_COSTS`, `RECIPES.inputs`) et les butins sont des sacs.
 *
 * C'est ce qui rend la migration tenable : `countOf`/`hasItems`/`addItems`/
 * `removeItems` gardent leurs signatures (Inventory + ItemBag), donc les ~44
 * sites d'appel de la sim — PNJ, butin, worldgen, tableau du village — n'ont pas
 * bougé. Seul `addItems` change de sémantique : il peut ne pas tout faire tenir,
 * et RETOURNE ce qui n'a pas tenu (spec R4).
 *
 * Déterminisme : aucun tirage. Le remplissage suit l'ordre des cases, point.
 */
import { STACK_DEFAULT, STACK_SIZES } from './balance'

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
  | 'spear'
  | 'raw_meat'
  | 'cooked_meat'
  | 'components'

/** Une case occupée. `wear` absent = neuf ; un empilable n'a jamais d'usure. */
export interface Slot {
  item: ItemId
  count: number
  wear?: number
}

/** Ce qu'on PORTE. La longueur EST la capacité ; `null` = case vide. */
export type Inventory = (Slot | null)[]

/** Ce qu'on COMPTE : un coût, un butin, un transfert en gros. */
export type ItemBag = Partial<Record<ItemId, number>>

export type StructureType = 'fire' | 'wall' | 'door' | 'chest' | 'workshop' | 'furnace' | 'house'

export type AccessLevel = 'private' | 'village' | 'public'

/** Les quatre métiers V4 (spec économie R12). */
export type SkillId = 'woodcutting' | 'mining' | 'foraging' | 'crafting'

export function makeInventory(size: number): Inventory {
  return Array.from({ length: size }, () => null)
}

/**
 * Un sac de `size` cases, DÉJÀ garni. Pour les appelants qui dimensionnent
 * eux-mêmes le sac et savent que le contenu y tient (cadavre, coffre du
 * monde-gen, carcasse de convoi) : le reliquat n'est pas rendu.
 */
export function inventoryOf(size: number, items: ItemBag): Inventory {
  const inv = makeInventory(size)
  addItems(inv, items)
  return inv
}

export function stackSize(item: ItemId): number {
  return STACK_SIZES[item] ?? STACK_DEFAULT
}

/** Un item empilable ne porte pas d'usure : deux piles fusionnent, deux outils jamais. */
export function isStackable(item: ItemId): boolean {
  return stackSize(item) > 1
}

export function countOf(inv: Inventory, item: ItemId): number {
  let total = 0
  for (const slot of inv) if (slot !== null && slot.item === item) total += slot.count
  return total
}

export function hasItems(inv: Inventory, cost: ItemBag): boolean {
  return (Object.keys(cost) as ItemId[]).every((item) => countOf(inv, item) >= (cost[item] ?? 0))
}

/** Combien d'unités de `item` tiennent encore : les piles incomplètes + les cases vides. */
export function freeRoomFor(inv: Inventory, item: ItemId): number {
  const max = stackSize(item)
  let room = 0
  for (const slot of inv) {
    if (slot === null) room += max
    else if (slot.item === item && slot.wear === undefined) room += max - slot.count
  }
  return room
}

/**
 * Ajoute `items`. RETOURNE ce qui n'a pas tenu (vide = tout est rentré, spec R4).
 * Ordre déterministe : on complète d'abord les piles existantes (dans l'ordre des
 * cases), puis on ouvre les cases vides (dans l'ordre des cases). Une case portant
 * une usure ne se complète jamais — un outil entamé n'absorbe pas un outil neuf.
 */
export function addItems(inv: Inventory, items: ItemBag): ItemBag {
  const leftover: ItemBag = {}
  for (const item of Object.keys(items) as ItemId[]) {
    let remaining = items[item] ?? 0
    if (remaining <= 0) continue
    const max = stackSize(item)
    // 1) compléter les piles existantes
    for (const slot of inv) {
      if (remaining <= 0) break
      if (slot === null || slot.item !== item || slot.wear !== undefined) continue
      const room = max - slot.count
      if (room <= 0) continue
      const put = Math.min(room, remaining)
      slot.count += put
      remaining -= put
    }
    // 2) ouvrir les cases vides
    for (let i = 0; i < inv.length; i++) {
      if (remaining <= 0) break
      if (inv[i] !== null) continue
      const put = Math.min(max, remaining)
      inv[i] = { item, count: put }
      remaining -= put
    }
    if (remaining > 0) leftover[item] = remaining
  }
  return leftover
}

/**
 * Verse UNE case dans un inventaire, USURE COMPRISE. Retourne ce qui n'a pas tenu
 * (0 = tout est rentré).
 *
 * C'est la SEULE façon de faire voyager un objet usé. Passer par
 * `addItems(toBag(…))` reconstruirait une case NEUVE : déposer une hache usée
 * dans un coffre la réparerait gratuitement — une lessiveuse à outils. Une case
 * usée ne se fond donc dans rien : elle part ENTIÈRE vers une case vide, ou pas
 * du tout (l'appelant, lui, garde la sienne — rien ne se détruit).
 */
export function addSlot(inv: Inventory, slot: Slot): number {
  if (slot.wear === undefined) {
    const leftover = addItems(inv, { [slot.item]: slot.count })
    return leftover[slot.item] ?? 0
  }
  const empty = inv.indexOf(null)
  if (empty < 0) return slot.count
  inv[empty] = { item: slot.item, count: slot.count, wear: slot.wear }
  return 0
}

/**
 * Verse dans `to` TOUT ce qui rentre de `from`, case par case, USURE COMPRISE.
 * `from` GARDE ce qui n'a pas tenu. Retourne le nombre d'unités réellement
 * déplacées (0 = rien n'est passé, la destination est saturée).
 *
 * C'est LA règle des conteneurs bornés (spec inventaire R10-R11, critère A21) :
 * un transfert qui « réussit » en jetant le reliquat détruit des items — et une
 * boucle de PNJ qui comptait sur cette destruction pour terminer se met à tourner
 * à vide. On prend ce qui rentre, la source garde le reste, personne ne ment.
 */
export function pourInto(from: Inventory, to: Inventory): number {
  let moved = 0
  for (let i = 0; i < from.length; i++) {
    const slot = from[i]
    if (slot === null || slot === undefined) continue
    const left = addSlot(to, slot) // une case usée part ENTIÈRE, ou pas du tout
    const put = slot.count - left
    if (put <= 0) continue
    moved += put
    if (left <= 0) from[i] = null
    else slot.count = left
  }
  return moved
}

/**
 * Retire `cost`. TOUT OU RIEN (sémantique historique préservée) : si le compte
 * n'y est pas, l'inventaire n'est pas touché. On vide les cases dans l'ordre ; une
 * case n'est jamais laissée à `count: 0` (elle redevient `null`).
 */
export function removeItems(inv: Inventory, cost: ItemBag): boolean {
  if (!hasItems(inv, cost)) return false
  for (const item of Object.keys(cost) as ItemId[]) {
    let remaining = cost[item] ?? 0
    for (let i = 0; i < inv.length && remaining > 0; i++) {
      const slot = inv[i]
      if (slot === null || slot === undefined || slot.item !== item) continue
      const taken = Math.min(slot.count, remaining)
      slot.count -= taken
      remaining -= taken
      if (slot.count <= 0) inv[i] = null
    }
  }
  return true
}

/** Agrège les cases en un sac (pour les consommateurs qui comptent, pas qui portent). */
export function toBag(inv: Inventory): ItemBag {
  const bag: ItemBag = {}
  for (const slot of inv) {
    if (slot === null) continue
    bag[slot.item] = (bag[slot.item] ?? 0) + slot.count
  }
  return bag
}

/** Les items présents, sans doublon, dans l'ordre des cases. */
export function itemsIn(inv: Inventory): ItemId[] {
  const seen: ItemId[] = []
  for (const slot of inv) {
    if (slot !== null && !seen.includes(slot.item)) seen.push(slot.item)
  }
  return seen
}

export function isEmpty(inv: Inventory): boolean {
  return inv.every((slot) => slot === null)
}
