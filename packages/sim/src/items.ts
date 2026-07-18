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
import {
  BALANCE,
  CARRY,
  ITEM_WEIGHT,
  SPOIL,
  SPOIL_CYCLES,
  STACK_DEFAULT,
  STACK_SIZES,
  TOOL_DURABILITIES,
  type CarryTier,
} from './balance'

export type ItemId =
  | 'wood'
  | 'stone'
  | 'fiber'
  | 'berries'
  | 'stew'
  | 'iron_ore'
  | 'coal'
  /** ── LES RESSOURCES STRUCTURANTES DES ZONES (spec worldgen R9) ──
   *  Chacune n'existe QUE dans sa zone. C'est ce qui remplace la récompense de distance, qui
   *  était arithmétiquement morte : *loin* ne veut plus dire « plus », ça veut dire
   *  « **le seul endroit où ça existe** ». */
  /** LE GROS BOIS — la Vieille Sylve. La charpente, les grands bâtiments. */
  | 'hardwood'
  /** LA TOURBE — la Tourbière. Un combustible qui brûle longtemps et sale. */
  | 'peat'
  /** LA PIERRE DE TAILLE — les Hauts Alpages. Ce qui tient debout sous un siège. */
  | 'cut_stone'
  /** LA CENDRE — le Versant Brûlé. Pas un combustible : un composant. Et du lore. */
  | 'ash'
  | 'iron_ingot'
  /** La CORDE : le liant de la couche 1 — tout objet de fortune y passe (spec craft-fortune C8). */
  | 'rope'
  | 'crude_axe'
  | 'crude_pickaxe'
  | 'crude_spear'
  | 'axe'
  | 'pickaxe'
  | 'iron_axe'
  | 'iron_pickaxe'
  | 'spear'
  /** Le MARTEAU DE CONSTRUCTION : sans lui EN MAIN, on ne bâtit rien (spec recolte.md G12). */
  | 'hammer'
  | 'raw_meat'
  | 'cooked_meat'
  | 'components'
  /**
   * LE FEU DE CAMP, EN OBJET. On le fabrique (10 bois), on le PORTE, on le POSE au
   * sol : il devient alors une structure `fire` SANS village (villageId 0) — une
   * simple source de chaleur et une station de cuisine. Ce n'est qu'en s'en
   * APPROCHANT qu'on peut choisir d'en fonder un foyer (action `found_village`).
   * Fonder n'est plus le geste d'allumer : c'est une décision qui vient après.
   */
  | 'campfire'
  /**
   * LES COMPOSANTS EN OBJET (spec construction R20) — l'atome actif d'une fonction.
   * On les fabrique, on les PORTE, on les POSE (action `place_component`, flux feu de
   * camp) : ils deviennent alors la structure du même nom, qui — GROUPÉE — fait
   * émerger une fonction (Forge = enclume + four…). Le four (`furnace`) reste aussi
   * bâtissable à l'ancienne (héritage V3). Les tranches suivantes en ajoutent.
   */
  | 'enclume'
  | 'furnace'
  | 'four_acier'

/** Une case occupée. `wear` absent = neuf ; un empilable n'a jamais d'usure. */
export interface Slot {
  item: ItemId
  count: number
  wear?: number
  /**
   * LA FRAÎCHEUR (1 = frais, 0 = pourri). Absente = l'objet ne pourrit pas.
   *
   * Elle ne BLOQUE PAS l'empilement, contrairement à l'usure : deux piles de baies
   * fusionnent, et leur fraîcheur se MOYENNE (pondérée par les quantités) — c'est
   * la règle de Don't Starve, et c'est la seule qui évite l'enfer : sans elle, un
   * sac finirait avec quinze cases d'une baie chacune, toutes à une fraîcheur
   * différente. On ne demande aucune microgestion au joueur.
   */
  fresh?: number
}

/** Ce qu'on PORTE. La longueur EST la capacité ; `null` = case vide. */
export type Inventory = (Slot | null)[]

/** Ce qu'on COMPTE : un coût, un butin, un transfert en gros. */
export type ItemBag = Partial<Record<ItemId, number>>

/**
 * LES STRUCTURES (spec construction R8). Deux familles :
 *  · BARRIÈRES — passives, statiques, posées librement en nombre : `wall`, `door`,
 *    `floor`, `roof`, `chest`. Murs/portes BLOQUENT (ou closent) ; sols/toits sont
 *    des pièces MOLLES (sans collision, R14).
 *  · COMPOSANTS — les atomes actifs (enclume, four…), qui GROUPÉS font émerger une
 *    fonction (R9). Ils s'ajoutent au fil des tranches (Forge, Atelier, Grenier…).
 * `fire` reste l'ancre sui generis (R1). `workshop`/`furnace`/`house` : héritage V3.
 */
export type StructureType =
  | 'fire'
  | 'wall'
  | 'door'
  | 'floor'
  | 'roof'
  | 'chest'
  | 'workshop'
  | 'furnace'
  | 'house'
  // ── LES COMPOSANTS (atomes actifs, R8). Groupés, ils font émerger une fonction. ──
  | 'enclume'
  | 'four_acier'

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

/** Cet objet pourrit-il ? (absent de la table = non : le bois ne moisit pas). */
export function isPerishable(item: ItemId): boolean {
  return SPOIL_CYCLES[item] !== undefined
}

/** Les trois crans de fraîcheur — c'est ce que le joueur LIT dans sa case. */
export type SpoilTier = 'fresh' | 'stale' | 'spoiled'

export function spoilTier(fresh: number): SpoilTier {
  if (fresh > SPOIL.STALE_AT) return 'fresh'
  if (fresh > SPOIL.SPOILED_AT) return 'stale'
  return 'spoiled'
}

/**
 * Ce que rend VRAIMENT un aliment, selon son état. Le rassis nourrit moitié moins,
 * l'avarié presque rien : une réserve qu'on laisse traîner n'est pas une réserve,
 * c'est un souvenir. (Don't Starve : ⅓ puis ⅙ — on est un cran plus doux.)
 */
export function nutritionFactor(fresh: number | undefined): number {
  if (fresh === undefined) return 1
  const tier = spoilTier(fresh)
  if (tier === 'fresh') return 1
  return tier === 'stale' ? SPOIL.NUTRITION_STALE : SPOIL.NUTRITION_SPOILED
}

/**
 * Fusionne la fraîcheur de deux piles : MOYENNE PONDÉRÉE par les quantités. Verser
 * dix baies fraîches sur deux baies rassies donne une pile presque fraîche — et
 * non douze baies rassies (qui puniraient le rangement) ni douze fraîches (qui
 * feraient du coffre une machine à remonter le temps).
 */
function mergedFresh(dstFresh: number, dstCount: number, srcFresh: number, srcCount: number): number {
  const total = dstCount + srcCount
  if (total <= 0) return dstFresh
  return (dstFresh * dstCount + srcFresh * srcCount) / total
}

/**
 * Combien de coups un objet encaisse avant de se consommer (spec craft-fortune C6).
 *
 * La durabilité vit dans l'OBJET, plus dans une constante unique : c'est tout le
 * prix de la fortune. Un hachereau ficelé récolte aussi bien qu'une hache
 * d'atelier (×2) — il tient cinq fois moins longtemps. Sans ce barème par objet,
 * l'outil d'atelier ne serait « le même, mais bâti » : rien.
 */
export function durabilityOf(item: ItemId): number {
  return TOOL_DURABILITIES[item] ?? BALANCE.TOOL_DURABILITY
}

/**
 * LE POIDS PORTÉ (spec portage.md P1). Pur, exact, sans tirage — il entre dans la
 * vitesse, donc dans la prédiction du client : la moindre approximation ferait
 * diverger l'avatar de son autorité, et le ferait se téléporter à chaque
 * réconciliation.
 */
export function carryWeight(inv: Inventory): number {
  let total = 0
  for (const slot of inv) {
    if (slot !== null) total += ITEM_WEIGHT[slot.item] * slot.count
  }
  return total
}

/**
 * La charge, en FRACTION de la capacité. `1` = plein ; au-delà, on est SURCHARGÉ
 * (on rampe, on ne sprinte plus, l'endurance ne revient plus — mais on n'est
 * jamais bloqué : ramasser reste possible, spec P4).
 */
export function carryRatio(inv: Inventory): number {
  return carryWeight(inv) / CARRY.CAPACITY
}

/**
 * LE PALIER de charge (spec portage.md P5). Quatre crans : léger, moyen, lourd,
 * surchargé. Les trois premiers sont des marches — on les FRANCHIT, on ne les
 * subit pas : entre deux crans, une baie de plus ne coûte rien, et c'est ce qui
 * rend la décision de charger LISIBLE.
 *
 * C'est aussi la seule règle de couleur du HUD : le médaillon de poids en dérive
 * (le client ne redéfinit pas ses propres seuils — ils divergeraient).
 */
export function carryTier(ratio: number): CarryTier {
  if (ratio <= CARRY.LIGHT_MAX) return 'light'
  if (ratio <= CARRY.MEDIUM_MAX) return 'medium'
  if (ratio <= CARRY.HEAVY_MAX) return 'heavy'
  return 'overloaded'
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
      // Ce qui ARRIVE est frais (récolté, cuisiné, versé d'un coffre à l'instant) :
      // la pile se moyenne, elle ne se réinitialise pas.
      if (slot.fresh !== undefined) slot.fresh = mergedFresh(slot.fresh, slot.count, 1, put)
      slot.count += put
      remaining -= put
    }
    // 2) ouvrir les cases vides
    for (let i = 0; i < inv.length; i++) {
      if (remaining <= 0) break
      if (inv[i] !== null) continue
      const put = Math.min(max, remaining)
      inv[i] = isPerishable(item) ? { item, count: put, fresh: 1 } : { item, count: put }
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
    // LA FRAÎCHEUR VOYAGE AVEC L'OBJET. Passer par `addItems` la remettrait à 1 :
    // sortir des baies rassies d'un coffre les rendrait fraîches — le coffre
    // serait une machine à remonter le temps, et la péremption ne coûterait rien.
    if (slot.fresh !== undefined) return addPerishable(inv, slot.item, slot.count, slot.fresh)
    const leftover = addItems(inv, { [slot.item]: slot.count })
    return leftover[slot.item] ?? 0
  }
  const empty = inv.indexOf(null)
  if (empty < 0) return slot.count
  inv[empty] = { item: slot.item, count: slot.count, wear: slot.wear }
  return 0
}

/**
 * Verse `count` unités d'un périssable, EN GARDANT sa fraîcheur (moyennée à la
 * fusion). Retourne ce qui n'a pas tenu. C'est le jumeau d'`addItems` pour ce qui
 * pourrit — et la seule porte par laquelle une fraîcheur entre dans un sac.
 */
function addPerishable(inv: Inventory, item: ItemId, count: number, fresh: number): number {
  const max = stackSize(item)
  let remaining = count
  for (const slot of inv) {
    if (remaining <= 0) break
    if (slot === null || slot.item !== item || slot.wear !== undefined) continue
    const room = max - slot.count
    if (room <= 0) continue
    const put = Math.min(room, remaining)
    slot.fresh = mergedFresh(slot.fresh ?? 1, slot.count, fresh, put)
    slot.count += put
    remaining -= put
  }
  for (let i = 0; i < inv.length && remaining > 0; i++) {
    if (inv[i] !== null) continue
    const put = Math.min(max, remaining)
    inv[i] = { item, count: put, fresh }
    remaining -= put
  }
  return remaining
}

/**
 * Verse au plus `count` unités de la case `i` de `from` DANS LE SAC `to` (n'importe
 * quelle case, selon l'ordre de `addItems`), USURE COMPRISE. La source garde ce qui
 * n'a pas tenu. Retourne ce qui a RÉELLEMENT bougé (0 = rien n'est passé).
 *
 * LE NOYAU des transferts en vrac : `pourInto` (tout un sac) et `transferItems`
 * (par item + quantité, village.ts) n'en sont plus que des boucles. Ils encodaient
 * la MÊME règle deux fois — un correctif appliqué à l'un n'aurait jamais migré vers
 * l'autre, et deux copies d'une règle finissent toujours par diverger.
 *
 * La règle, justement (spec inventaire R10-R11, critère A21) : on POUSSE d'abord,
 * on ne retire de la source QUE ce qui a atterri. L'ordre inverse DUPLIQUE (si la
 * destination refuse) ou DÉTRUIT (si on vide la source pour rien) — et un transfert
 * qui « réussit » en jetant le reliquat fait tourner à vide la boucle de PNJ qui
 * comptait dessus. On prend ce qui rentre, la source garde le reste, personne ne ment.
 */
export function pourSlot(from: Inventory, i: number, to: Inventory, count: number): number {
  const slot = from[i]
  if (slot === null || slot === undefined) return 0
  const take = Math.min(count, slot.count)
  if (take <= 0) return 0
  if (slot.wear !== undefined) {
    // Une case usée ne se scinde pas et ne fusionne avec rien : elle part ENTIÈRE
    // vers une case vide, ou pas du tout. Reconstruire l'objet à l'arrivée le
    // rendrait NEUF — le coffre serait une lessiveuse à outils (spec R6).
    if (take < slot.count || addSlot(to, slot) > 0) return 0
    from[i] = null
    return slot.count
  }
  const carried: Slot = { item: slot.item, count: take }
  if (slot.fresh !== undefined) carried.fresh = slot.fresh // la fraîcheur suit l'objet
  const put = take - addSlot(to, carried)
  if (put <= 0) return 0
  slot.count -= put
  if (slot.count <= 0) from[i] = null
  return put
}

/**
 * Verse dans `to` TOUT ce qui rentre de `from`, case par case, USURE COMPRISE.
 * `from` GARDE ce qui n'a pas tenu. Retourne le nombre d'unités réellement déplacées.
 */
export function pourInto(from: Inventory, to: Inventory): number {
  let moved = 0
  for (let i = 0; i < from.length; i++) {
    const slot = from[i]
    if (slot === null || slot === undefined) continue
    moved += pourSlot(from, i, to, slot.count)
  }
  return moved
}

/**
 * Verse au plus `count` unités de la case `i` de `from` SUR LA CASE `j` de `to` —
 * le geste du joueur, qui vise UNE case (glisser-déposer, spec R14-R16). Retourne
 * ce qui a bougé ; 0 = la case visée ne peut rien recevoir (rien n'a été détruit).
 *
 * La case visée doit être VIDE, ou porter une pile du MÊME item empilable : on y
 * fond alors ce qui rentre, et le DÉBORD RESTE À LA SOURCE (A13). Un outil (pile de
 * 1) et toute case usée voyagent ENTIERS, vers une case vide seulement — jamais
 * reconstruits, donc jamais réparés au passage (A21 + R6).
 *
 * La case posée est toujours un objet NEUF : jamais la référence de la case source,
 * qui serait alors présente dans DEUX inventaires à la fois.
 *
 * NB : distinct de `pourSlot`, qui vise un SAC (« range ça où tu peux »). Deux
 * destinations, deux règles — l'une n'est pas une copie de l'autre.
 */
export function pourOntoSlot(
  from: Inventory,
  i: number,
  to: Inventory,
  j: number,
  count: number,
): number {
  const src = from[i]
  if (src === null || src === undefined) return 0
  if (j < 0 || j >= to.length) return 0
  const take = Math.min(count, src.count)
  if (take <= 0) return 0
  const dst = to[j] ?? null

  if (src.wear !== undefined || !isStackable(src.item)) {
    if (dst !== null || take < src.count) return 0
    const carried: Slot = { item: src.item, count: src.count }
    if (src.wear !== undefined) carried.wear = src.wear
    to[j] = carried
    from[i] = null
    return carried.count
  }

  const max = stackSize(src.item)
  const room = dst === null ? max : dst.item === src.item && dst.wear === undefined ? max - dst.count : 0
  const put = Math.min(take, room)
  if (put <= 0) return 0
  if (dst === null) {
    const posee: Slot = { item: src.item, count: put }
    if (src.fresh !== undefined) posee.fresh = src.fresh
    to[j] = posee
  } else {
    // Deux piles qui fusionnent MOYENNENT leur fraîcheur (jamais la meilleure des
    // deux : ranger ses vieilles baies sous les neuves les rajeunirait).
    if (dst.fresh !== undefined || src.fresh !== undefined) {
      dst.fresh = mergedFresh(dst.fresh ?? 1, dst.count, src.fresh ?? 1, put)
    }
    dst.count += put
  }
  src.count -= put
  if (src.count <= 0) from[i] = null
  return put
}

/**
 * Le geste R14 : glisser la case `from` sur la case `to` du MÊME sac. Deux piles du
 * même item empilable fusionnent (débord à la source) ; sinon les deux cases
 * S'ÉCHANGENT. `false` = geste impossible (case vide, hors bornes, sur elle-même).
 *
 * Un ÉCHANGE, pas une reconstruction : l'usure vit dans la case, donc elle suit
 * l'objet sans qu'on ait à la recopier. C'est aussi le geste dont `liftIntoBelt`
 * (npc.ts) a besoin pour armer la main d'un PNJ — la règle n'existe qu'ici.
 */
export function moveSlotWithin(inv: Inventory, from: number, to: number): boolean {
  if (from === to) return false
  if (from < 0 || to < 0 || from >= inv.length || to >= inv.length) return false
  const src = inv[from]
  if (src === null || src === undefined) return false
  if (pourOntoSlot(inv, from, inv, to, src.count) > 0) return true
  // Rien n'a pu se fondre (items différents, outil, ou pile déjà pleine) : on échange.
  const dst = inv[to] ?? null
  inv[to] = src
  inv[from] = dst
  return true
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
