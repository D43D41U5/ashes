# Chantier 1 « Le sac » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'inventaire-dictionnaire infini de Braises par un inventaire **à cases, borné et positionnel** (façon Rust), avec une **ceinture** dont la case active est *l'objet réellement tenu en main*, et le HUD/écran d'inventaire/panneau de loot qui vont avec.

**Architecture:** `Inventory` devient `Slot[]` (la longueur EST la capacité). L'astuce qui rend la migration tenable : **l'API historique survit** — `countOf`/`hasItems`/`addItems`/`removeItems` gardent leurs signatures, réimplémentées par-dessus les cases, et prennent un `ItemBag` (= l'ancien `Inventory`, renommé : le type des coûts, butins et transferts en gros). Les 44 sites d'appel de la sim parlent en sacs et ne bougent pas. Ensuite seulement on ajoute ce qui exploite les cases : capacité à la récolte, objet en main, gestes case-à-case, UI.

**Tech Stack:** TypeScript pur (`packages/sim`, zéro dépendance), Vitest, Phaser 4 (`packages/client`), pnpm workspace.

**Spec:** `docs/specs/inventaire.md` — les critères A1-A21 y sont numérotés ; chaque tâche cite les siens.

## Global Constraints

Copiés depuis `CLAUDE.md` et la spec. **Ils s'appliquent à TOUTES les tâches.**

- **`/sim` est pur** : zéro import de Phaser, Colyseus ou API Node. Un lint ESLint le fait respecter — ne jamais le contourner.
- **`/sim` est déterministe au bit près** : pas de `Math.random` (PRNG seedé dans `rng.ts`), pas de `Date`/`performance`/timers. **Pas de `Math.sin/cos/pow/hypot/exp/log/**`** — seuls `+ - * /`, `Math.sqrt/abs/floor/ceil/round/trunc/sign/min/max/imul/fround` sont autorisés.
- **État de sim JSON-sérialisable** : pas de classes, pas de `Map`/`Set` dans `SimState`. Un `Slot[]` avec des `null` est conforme ; un `Map<number, Slot>` ne l'est pas.
- **Tout nombre d'équilibrage vit dans `packages/sim/src/balance.ts`**, jamais en dur dans la logique.
- **Événements de domaine** : tout fait de jeu discret est émis comme `SimEvent` (`events.ts`) au moment où la logique l'exécute. Une action refusée émet `action_rejected`.
- **Le code et les commentaires sont en français** ; les identifiants de code en anglais.
- **Avant chaque commit** : `pnpm check && pnpm test && pnpm lint` doivent passer. Ils sont rapides — les lancer souvent.
- **Un test ne vaut que si on a vu son rouge** (décision actée 2026-07-11) : à l'étape « vérifier que le test échoue », si le test passe **avant** l'implémentation, c'est le TEST qui est cassé, pas une bonne nouvelle. Le corriger jusqu'à obtenir un rouge qui dit la bonne chose.

---

## Structure des fichiers

**Créés :**
- `packages/sim/src/items.test.ts` — les tests purs du socle à cases (A1-A5, A13-A15).
- `packages/client/src/render/item-art.ts` — les icônes d'items, dessinées en code (16 px).
- `packages/client/src/scenes/ui/hotbar.ts` — la ceinture (bas centre).
- `packages/client/src/scenes/ui/vitals.ts` — les jauges (bas gauche).
- `packages/client/src/scenes/ui/inventory-panel.ts` — l'écran TAB : grille, glisser-déposer, panneau de loot.
- `packages/client/src/scenes/ui/slot-view.ts` — le dessin d'UNE case (partagé par la hotbar, la grille et le loot).

**Modifiés en profondeur :**
- `packages/sim/src/items.ts` — le socle (réécrit).
- `packages/sim/src/balance.ts` — `STACK_SIZES`, `STACK_DEFAULT`, tailles de sacs.
- `packages/sim/src/economy.ts` — capacité à la récolte, objet en main.
- `packages/sim/src/combat.ts` — arme tenue, usure dans la case, cadavre à cases.
- `packages/sim/src/inventory-actions.ts` (créé) — `set_active_slot`, `move_slot`, `split_slot`, `transfer`.
- `packages/sim/src/sim.ts` — `Entity.activeSlot`, suppression de `Entity.wear`, `spawnEntity`.
- `packages/client/src/scenes/UIScene.ts` — devient un assembleur (il délègue aux 4 modules ci-dessus).
- `packages/client/src/hud-state.ts`, `packages/client/src/scenes/world/hud-bridge.ts`, `keymap.ts`, `input-bindings.ts`.

**Touchés mécaniquement (tâche 1 seulement, `?? {}` → `?? []`) :** `village.ts`, `village-board.ts`, `npc.ts`, `npc-needs.ts`, `npc-errands.ts`, `worldgen.ts`, `worldevents.ts`, `faune.ts`, `cendreux.ts`, `scenario.ts`.

---

### Task 1: Le socle à cases (et la migration mécanique de la sim)

Cette tâche est **atomique par nature** : basculer le type `Inventory` casse la compilation partout, donc le socle et la migration de ses appelants forment un seul livrable. Le comportement de jeu ne change **pas encore** (personne n'exploite le reliquat de `addItems`) — c'est voulu : on prouve d'abord que le socle ne casse rien.

**Files:**
- Modify: `packages/sim/src/items.ts` (réécriture)
- Modify: `packages/sim/src/balance.ts` (ajout d'un bloc)
- Test: `packages/sim/src/items.test.ts` (créer)
- Modify (mécanique) : `sim.ts`, `village.ts`, `village-board.ts`, `economy.ts`, `combat.ts`, `npc.ts`, `npc-needs.ts`, `npc-errands.ts`, `worldgen.ts`, `worldevents.ts`, `faune.ts`, `cendreux.ts`, `scenario.ts`, `index.ts`
- Modify: `packages/client/src/scenes/world/hud-bridge.ts`, `packages/client/src/hud-state.ts`, `packages/client/src/scenes/UIScene.ts` (le strict minimum pour que le client compile — l'UI vient aux tâches 6-7)

**Interfaces:**
- Produces:
  ```ts
  export type ItemBag = Partial<Record<ItemId, number>>          // coûts, butins, transferts en gros
  export interface Slot { item: ItemId; count: number; wear?: number }
  export type Inventory = (Slot | null)[]                        // la longueur EST la capacité

  export function makeInventory(size: number): Inventory          // n cases à null
  export function stackSize(item: ItemId): number
  export function countOf(inv: Inventory, item: ItemId): number   // signature INCHANGÉE
  export function hasItems(inv: Inventory, cost: ItemBag): boolean// signature INCHANGÉE
  export function addItems(inv: Inventory, items: ItemBag): ItemBag // NOUVEAU retour : le reliquat
  export function removeItems(inv: Inventory, cost: ItemBag): boolean // signature INCHANGÉE, tout-ou-rien
  export function toBag(inv: Inventory): ItemBag                  // agrège les cases
  export function itemsIn(inv: Inventory): ItemId[]               // les ItemId présents, sans doublon, ordre des cases
  export function isEmpty(inv: Inventory): boolean
  export function freeRoomFor(inv: Inventory, item: ItemId): number // combien d'unités de `item` tiennent encore
  ```
- Consumes: rien (première tâche).

- [ ] **Step 1: Poser les nombres dans `balance.ts`**

Ajouter à la fin de `packages/sim/src/balance.ts` :

```ts
/**
 * L'INVENTAIRE À CASES (spec inventaire R5, R7). Piles COURTES, exprès : les
 * coûts de Braises sont à un chiffre (un mur = 2 bois), donc des piles de 1000
 * façon Rust rendraient la capacité purement décorative — et le coffre inutile.
 * Les outils et les armes ont une pile de 1 : chaque exemplaire occupe sa case,
 * donc chaque exemplaire porte son usure.
 */
export const STACK_DEFAULT = 20
export const STACK_SIZES: Partial<Record<import('./items').ItemId, number>> = {
  wood: 20,
  stone: 20,
  fiber: 20,
  iron_ore: 20,
  coal: 20,
  components: 10,
  berries: 10,
  stew: 5,
  iron_ingot: 5,
  raw_meat: 5,
  cooked_meat: 5,
  // Outils et armes : un par case (l'usure est portée par la case).
  axe: 1,
  pickaxe: 1,
  iron_axe: 1,
  iron_pickaxe: 1,
  spear: 1,
}

/** Tailles de sac (spec inventaire R7). La longueur du tableau EST la capacité. */
export const SLOTS = {
  /** Les N premières cases du sac du joueur SONT la ceinture (la hotbar). */
  BELT: 6,
  PLAYER: 18,
  /** Les PNJ ont un GRAND sac : leur boucle de corvées n'a pas de notion de « plein »
   *  et lui en apprendre une rouvrirait le risque de livelock. Une DONNÉE, pas une
   *  règle à part — la sim n'a qu'un seul jeu de règles. */
  NPC: 40,
  CHEST: 24,
  /** Assez grand pour que le cadavre ne tronque JAMAIS le butin (spec R11). */
  CORPSE: 48,
} as const
```

- [ ] **Step 2: Écrire les tests du socle (ils doivent échouer)**

Créer `packages/sim/src/items.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { addItems, countOf, freeRoomFor, hasItems, isEmpty, itemsIn, makeInventory, removeItems, toBag } from './items'

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
```

- [ ] **Step 3: Lancer les tests, vérifier le ROUGE**

Run: `pnpm --filter @braises/sim test items`
Expected: FAIL — `makeInventory is not exported` / erreurs de type.

- [ ] **Step 4: Réécrire `items.ts`**

Remplacer intégralement `packages/sim/src/items.ts` (garder le bloc `ItemId` / `StructureType` / `AccessLevel` / `SkillId` à l'identique, il ne change pas) :

```ts
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
      if (slot === null || slot.item !== item) continue
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
```

- [ ] **Step 5: Migrer les appelants (mécanique — le comportement ne change pas)**

Le compilateur est le guide : `pnpm check` liste tout. Les changements, exhaustivement :

1. **`sim.ts`** — `spawnEntity` : `inventory: {}` → `inventory: makeInventory(SLOTS.PLAYER)`. Supprimer `wear: {}` **NON — la tâche 3 s'en charge** ; ici on garde `wear` tel quel (`Partial<Record<ItemId, number>>`), il n'est pas concerné par le type `Inventory`. Importer `makeInventory` et `SLOTS`.
   *Attention :* les PNJ sont des `Entity` créées par `spawnEntity` puis enregistrées dans `state.npcs`. Pour leur donner `SLOTS.NPC`, ajouter un paramètre optionnel : `spawnEntity(state, x, y, slots = SLOTS.PLAYER)` et passer `SLOTS.NPC` depuis `npc.ts` (chercher l'appelant qui crée les PNJ — `foundNpcVillage` / le peuplement) et depuis `faune.ts`/`monsters.ts` pour les bêtes (`SLOTS.NPC` convient : leur inventaire est vide, seule la table de loot compte).
2. **`village.ts`** — `addStructure` : `if (type === 'chest') structure.inventory = {}` → `makeInventory(SLOTS.CHEST)`. Le test de conteneur détruit `Object.keys(s.inventory).length > 0` → `!isEmpty(s.inventory)`, et le cadavre reçoit `inventory: makeInventory(SLOTS.CORPSE)` + `addItems(..., toBag(s.inventory))`. `Structure.inventory?: Inventory` (le type suit tout seul). `grantItems` : inchangé (il prend un `ItemBag`, renommer le paramètre).
   Le type de `VillageAction.give` / `deposit` / `withdraw` ne change pas (ils sont par item + count).
3. **`village-board.ts`, `npc.ts`, `npc-needs.ts`, `npc-errands.ts`, `scenario.ts`** — remplacer partout `countOf(x.inventory ?? {}, …)` par `countOf(x.inventory ?? [], …)`.
4. **`npc-errands.ts:208`** — `for (const item of Object.keys(entity.inventory) as …)` → `for (const item of itemsIn(entity.inventory))`.
5. **`worldgen.ts:35`** — `chest.inventory = { berries: 10, wood: 10, fiber: 2 }` → `addItems(chest.inventory!, { berries: 10, wood: 10, fiber: 2 })` (le coffre a déjà ses cases via `addStructure`).
6. **`worldgen.ts:45`** — `entity.inventory.spear = 1` → `addItems(entity.inventory, { spear: 1 })`.
7. **`worldevents.ts:90`** — le convoi : `inventory: { ...CONVOY_LOOT }` → construire un `Inventory` : `const inv = makeInventory(SLOTS.CHEST); addItems(inv, CONVOY_LOOT)` puis `inventory: inv`.
8. **`worldevents.ts:207,209`** — `lootValue(s.inventory)` / `lootValue(m.inventory)` : `lootValue` prend un `ItemBag` → passer `toBag(...)`.
9. **`faune.ts:710-711,727`** — accès direct `meal.inventory.raw_meat` : remplacer par `countOf(meal.inventory, 'raw_meat')` et `removeItems(meal.inventory, { raw_meat: 1 })` (la logique « il en restait, on en retire un » devient une seule ligne, sans écriture directe de case).
10. **`cendreux.ts:51`** — `ent.inventory = { ...corpse.inventory }` → `ent.inventory = makeInventory(SLOTS.NPC); addItems(ent.inventory, toBag(corpse.inventory))`.
11. **`combat.ts`** — `Corpse.inventory` reste `Entity['inventory']` (suit le type). `loot_corpse` : `addItems(actor.inventory, corpse.inventory)` → `addItems(actor.inventory, toBag(corpse.inventory))` (le reliquat sera exploité en tâche 4 ; ici on l'ignore). `killEntity` : `const loot = ...spread...` → construire un `Inventory` de `SLOTS.CORPSE` et y `addItems` d'abord le butin de monstre, puis `toBag(entity.inventory)`. Le test `Object.keys(loot).length > 0` → `!isEmpty(loot)`. `entity.inventory = {}` (respawn) → `entity.inventory = makeInventory(SLOTS.PLAYER)`.
12. **`economy.ts`** — aucun changement de logique : `addItems(actor.inventory, { [def.item]: yielded })` compile tel quel (le reliquat est ignoré — la tâche 2 s'en occupe).
13. **`index.ts`** — exporter les nouveaux symboles : `export type { ItemBag, Slot, Inventory }` et `export { makeInventory, toBag, itemsIn, isEmpty, stackSize, freeRoomFor, countOf, hasItems, addItems, removeItems }`.
14. **Client, minimum vital** : `hud-state.ts` → `inv: Inventory` (le type suit) ; `UIScene.ts` → la ligne `ITEM_LABELS.filter(([item]) => (inv[item] ?? 0) > 0).map(...)` ne compile plus. **Remplacement provisoire, une ligne** (la vraie UI arrive en tâche 6) :
    ```ts
    const bag = toBag(inv)
    const invText = ITEM_LABELS.filter(([item]) => (bag[item] ?? 0) > 0)
      .map(([item, label]) => `${label} ${bag[item]}`)
      .join(' · ')
    ```
    (importer `toBag` depuis `@braises/sim`).

- [ ] **Step 6: Vérifier le VERT complet**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: PASS. **Tous les tests existants passent sans qu'une seule assertion ait été modifiée** — c'est ce qui prouve que le socle n'a rien changé au jeu (critère A20). Si un test de `sim.test.ts`/`replay.test.ts`/`events.test.ts` échoue, c'est un vrai bug de migration : le corriger, **jamais assouplir le test**.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sim): l'inventaire devient un tableau de cases — le socle

Inventory = Slot[] (la longueur EST la capacité). ItemBag prend le rôle
de l'ancien dictionnaire (coûts, butins, transferts en gros).

countOf/hasItems/addItems/removeItems gardent leurs signatures : les 44
sites d'appel de la sim n'ont pas bougé. addItems retourne désormais le
reliquat — personne ne l'exploite encore (tâche 2).

Comportement de jeu inchangé : tous les tests passent sans qu'une seule
assertion ait été touchée."
```

---

### Task 2: Le sac se remplit — la récolte respecte la capacité

**Files:**
- Modify: `packages/sim/src/economy.ts` (le `case 'harvest'`)
- Test: `packages/sim/src/economy.test.ts` (existe — y ajouter)

**Interfaces:**
- Consumes: `addItems` (retourne le reliquat), `freeRoomFor`, `makeInventory` (Task 1).
- Produces: rien de nouveau — un changement de comportement.

**Critères de la spec :** A10, A11.

- [ ] **Step 1: Écrire les tests (ils doivent échouer)**

Ajouter à `packages/sim/src/economy.test.ts` (adapter les helpers de création de sim au style déjà présent dans le fichier — lire ses tests existants d'abord) :

```ts
it('A10 : le nœud garde ce qui ne rentre pas dans le sac', () => {
  const state = /* sim avec un joueur adjacent à un arbre — cf. helpers du fichier */
  const player = state.entities[0]!
  const tree = state.nodes.find((n) => n.type === 'tree')!
  const stockBefore = tree.stock

  // On sature le sac SAUF 2 places de bois : une seule case libre... non —
  // on remplit toutes les cases sauf une pile de bois à (stackSize - 2).
  player.inventory = makeInventory(2)
  player.inventory[0] = { item: 'wood', count: stackSize('wood') - 2 }
  player.inventory[1] = { item: 'stone', count: stackSize('stone') } // pile pleine, case bloquée
  expect(freeRoomFor(player.inventory, 'wood')).toBe(2)

  applyEconomyAction(state, player.id, { type: 'harvest', nodeId: tree.id })

  // Le rendement nu est de 1 × (1 + bonus) ≥ 2 ici ; quoi qu'il arrive on ne
  // prend que 2 bois, et le stock ne baisse QUE de 2.
  expect(countOf(player.inventory, 'wood')).toBe(stackSize('wood'))
  expect(stockBefore - tree.stock).toBe(2)
})

it('A11 : sac plein → refus « sac plein », rien ne bouge, pas de cooldown ni d’XP', () => {
  const state = /* idem */
  const player = state.entities[0]!
  const tree = state.nodes.find((n) => n.type === 'tree')!
  const stockBefore = tree.stock

  player.inventory = makeInventory(1)
  player.inventory[0] = { item: 'stone', count: stackSize('stone') } // aucune place

  drainEvents(state) // vider le bus avant de mesurer
  applyEconomyAction(state, player.id, { type: 'harvest', nodeId: tree.id })

  expect(tree.stock).toBe(stockBefore) // le coup n'a pas eu lieu
  expect(player.cooldownUntil).toBe(0) // pas de cooldown armé
  expect(player.skills.woodcutting ?? 0).toBe(0) // pas d'XP
  const events = drainEvents(state)
  expect(events).toContainEqual(expect.objectContaining({ type: 'action_rejected', reason: 'sac plein' }))
})
```

- [ ] **Step 2: Lancer, vérifier le ROUGE**

Run: `pnpm --filter @braises/sim test economy`
Expected: FAIL — A10 : le stock baisse du rendement entier (l'excédent s'évapore) ; A11 : aucun `action_rejected`, le cooldown est armé.

- [ ] **Step 3: Implémenter**

Dans `packages/sim/src/economy.ts`, `case 'harvest'`, **remplacer** le bloc qui va de `const yielded = ...` jusqu'à `node.stock -= yielded` (inclus) par :

```ts
      const level = levelOf(actor, def.skill)
      // La Meute a une économie anémique (spec alignement R8) — mais jamais
      // nulle : plancher à 1, sinon le coup paie cooldown et XP pour rien.
      const wanted = Math.min(
        node.stock,
        Math.max(1, Math.floor(mult * (1 + BALANCE.SKILL_YIELD_BONUS * level) * harvestFactor(state, actorId))),
      )
      // LE SAC EST BORNÉ (spec inventaire R10) : le nœud garde ce qui ne rentre
      // pas. Rien ne tombe au sol, rien ne s'évapore — et si RIEN ne rentre, le
      // coup n'a pas eu lieu (ni stock, ni cooldown, ni XP).
      const room = freeRoomFor(actor.inventory, def.item)
      if (room <= 0) return reject('sac plein')
      const yielded = Math.min(wanted, room)
      addItems(actor.inventory, { [def.item]: yielded })
      node.stock -= yielded
```

Ajouter `freeRoomFor` à l'import depuis `./items`.

- [ ] **Step 4: Vérifier le VERT**

Run: `pnpm --filter @braises/sim test economy` → PASS
Run: `pnpm check && pnpm test && pnpm lint` → PASS (aucune régression ailleurs)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sim): le nœud garde ce qui ne rentre pas dans le sac

La récolte est bornée par la place réelle : le stock du nœud ne baisse que
de ce qui est entré. Sac plein = refus, sans cooldown ni XP (le coup n'a
pas eu lieu). Spec inventaire R10, critères A10-A11."
```

---

### Task 3: L'objet en main fait foi

Le cœur du chantier. La sim cesse de choisir le meilleur outil à la place du joueur.

**Files:**
- Modify: `packages/sim/src/sim.ts` (`Entity.activeSlot`, suppression de `Entity.wear`, `spawnEntity`)
- Modify: `packages/sim/src/economy.ts` (`toolMultiplier`, usure, `requiresTool`)
- Modify: `packages/sim/src/combat.ts` (`weaponDamage`, usure de l'arme)
- Create: `packages/sim/src/inventory-actions.ts` (`set_active_slot` — les autres gestes viennent en tâche 5)
- Modify: `packages/sim/src/sim.ts` (brancher `InventoryAction` dans `PlayerAction`)
- Test: `packages/sim/src/economy.test.ts`, `packages/sim/src/combat.test.ts`, `packages/sim/src/inventory-actions.test.ts` (créer)

**Interfaces:**
- Consumes: le socle de la Task 1, la capacité de la Task 2.
- Produces:
  ```ts
  // sim.ts
  interface Entity { /* … */ activeSlot: number }   // -1 = mains nues ; `wear` est SUPPRIMÉ
  // inventory-actions.ts
  export type InventoryAction = { type: 'set_active_slot'; slot: number }
  export function applyInventoryAction(state: SimState, actorId: number, action: InventoryAction): void
  export function heldSlot(entity: Entity): Slot | null   // la case active, ou null (mains nues)
  export function wearHeld(state: SimState, entity: Entity, amount: number): void  // use l'objet tenu ; le casse à TOOL_DURABILITY
  ```

**Critères de la spec :** A5 (usure par case), A6, A7, A8, A9, A16.

- [ ] **Step 1: Écrire les tests (ils doivent échouer)**

Créer `packages/sim/src/inventory-actions.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { SLOTS } from './balance'
import { drainEvents } from './events'
import { applyInventoryAction, heldSlot } from './inventory-actions'
import { createSim, spawnEntity } from './sim'

function playerSim() {
  const state = createSim(1)
  const id = spawnEntity(state, 5, 5)
  return { state, entity: state.entities.find((e) => e.id === id)! }
}

describe('la case active', () => {
  it('naît à -1 (mains nues)', () => {
    const { entity } = playerSim()
    expect(entity.activeSlot).toBe(-1)
    expect(heldSlot(entity)).toBeNull()
  })

  it('set_active_slot désigne une case de la ceinture', () => {
    const { state, entity } = playerSim()
    entity.inventory[2] = { item: 'axe', count: 1 }
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: 2 })
    expect(entity.activeSlot).toBe(2)
    expect(heldSlot(entity)?.item).toBe('axe')
  })

  it('A16 : une case hors de la CEINTURE est refusée', () => {
    const { state, entity } = playerSim()
    drainEvents(state)
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: SLOTS.BELT }) // 1re case du sac
    expect(entity.activeSlot).toBe(-1) // inchangé
    expect(drainEvents(state)).toContainEqual(
      expect.objectContaining({ type: 'action_rejected', reason: 'hors de la ceinture' }),
    )
  })

  it('-1 est accepté (rengainer)', () => {
    const { state, entity } = playerSim()
    entity.activeSlot = 0
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: -1 })
    expect(entity.activeSlot).toBe(-1)
  })

  it('une case active VIDE vaut mains nues', () => {
    const { state, entity } = playerSim()
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: 0 })
    expect(entity.activeSlot).toBe(0)
    expect(heldSlot(entity)).toBeNull() // la case 0 est vide
  })
})
```

Ajouter à `packages/sim/src/economy.test.ts` (style des helpers du fichier) :

```ts
it('A6 : hache EN MAIN → rendement ×2, et l’usure monte dans la case active', () => {
  const state = /* joueur adjacent à un arbre */
  const player = state.entities[0]!
  player.inventory[0] = { item: 'axe', count: 1 }
  player.activeSlot = 0
  const tree = state.nodes.find((n) => n.type === 'tree')!

  applyEconomyAction(state, player.id, { type: 'harvest', nodeId: tree.id })

  expect(countOf(player.inventory, 'wood')).toBe(2) // ×2 : la hache est en main
  expect(player.inventory[0]).toEqual({ item: 'axe', count: 1, wear: 1 })
})

it('A7 : hache DANS LE SAC mais pas en main → mains nues (×1), aucune usure', () => {
  const state = /* même seed, même arbre */
  const player = state.entities[0]!
  player.inventory[0] = { item: 'axe', count: 1 }
  player.activeSlot = -1 // mains nues, la hache est pourtant là
  const tree = state.nodes.find((n) => n.type === 'tree')!

  applyEconomyAction(state, player.id, { type: 'harvest', nodeId: tree.id })

  expect(countOf(player.inventory, 'wood')).toBe(1) // ×1 : la sim ne choisit plus pour toi
  expect(player.inventory[0]).toEqual({ item: 'axe', count: 1 }) // pas d'usure
})

it('A8 : filon de fer sans pioche EN MAIN → refus, stock intact, aucun XP', () => {
  const state = /* joueur adjacent à un iron_vein */
  const player = state.entities[0]!
  player.inventory[0] = { item: 'pickaxe', count: 1 }
  player.activeSlot = -1 // dans le sac, pas en main
  const vein = state.nodes.find((n) => n.type === 'iron_vein')!
  const before = vein.stock
  drainEvents(state)

  applyEconomyAction(state, player.id, { type: 'harvest', nodeId: vein.id })

  expect(vein.stock).toBe(before)
  expect(player.skills.mining ?? 0).toBe(0)
  expect(drainEvents(state)).toContainEqual(
    expect.objectContaining({ type: 'action_rejected', reason: 'il faut une pioche en main' }),
  )
})

it('A5 : deux haches, deux usures indépendantes — celle qu’on tient casse seule', () => {
  const state = /* joueur adjacent à un arbre à gros stock */
  const player = state.entities[0]!
  player.inventory[0] = { item: 'axe', count: 1, wear: BALANCE.TOOL_DURABILITY - 1 }
  player.inventory[1] = { item: 'axe', count: 1 }
  player.activeSlot = 0
  const tree = state.nodes.find((n) => n.type === 'tree')!

  applyEconomyAction(state, player.id, { type: 'harvest', nodeId: tree.id })

  expect(player.inventory[0]).toBeNull() // la hache TENUE a cassé
  expect(player.inventory[1]).toEqual({ item: 'axe', count: 1 }) // l'autre est intacte
})
```

Ajouter à `packages/sim/src/combat.test.ts` :

```ts
it('A9 : les dégâts viennent de l’arme TENUE, pas de la meilleure du sac', () => {
  const state = /* un attaquant et une cible à portée — cf. helpers du fichier */
  const attacker = /* … */
  attacker.inventory[0] = { item: 'spear', count: 1 }

  attacker.activeSlot = 0
  expect(weaponDamage(attacker)).toBe(WEAPON_DAMAGE.spear)

  attacker.activeSlot = -1 // la lance est dans le sac
  expect(weaponDamage(attacker)).toBe(COMBAT.UNARMED_DAMAGE)
})
```

- [ ] **Step 2: Lancer, vérifier le ROUGE**

Run: `pnpm --filter @braises/sim test`
Expected: FAIL — `activeSlot` n'existe pas, `applyInventoryAction`/`heldSlot` non exportés, A7 rend 2 (la sim fouille encore le sac).

- [ ] **Step 3: `Entity.activeSlot` + suppression de `Entity.wear`**

Dans `packages/sim/src/sim.ts` :
- Dans `interface Entity`, **supprimer** le champ `wear` et **ajouter** :
  ```ts
  /**
   * La case de CEINTURE tenue en main (spec inventaire R8). `-1` = mains nues.
   * C'est elle, et elle seule, qui décide de l'outil et de l'arme : la sim ne
   * fouille plus le sac à la place du joueur (R9).
   */
  activeSlot: number
  ```
- Dans `spawnEntity` : retirer `wear: {}`, ajouter `activeSlot: -1`.
- Brancher l'action : `export type PlayerAction = VillageAction | EconomyAction | CombatAction | InventoryAction | DebugAction`, et dans le dispatch d'actions du `step` (chercher où `applyVillageAction`/`applyEconomyAction`/`applyCombatAction` sont appelées — le même `if/else` par type d'action), ajouter la branche `applyInventoryAction`. Suivre exactement le motif existant (une fonction `isXxxAction` par famille, ou un `switch` — lire le code et l'imiter).

- [ ] **Step 4: Créer `inventory-actions.ts`**

```ts
/**
 * Les gestes d'inventaire du joueur (spec inventaire R13-R16).
 *
 * Toutes valident portée et propriété DANS la sim (serveur autoritatif) et
 * émettent `action_rejected` en cas de refus. Le client ne fait qu'anticiper
 * l'affichage — aucune logique d'inventaire ne descend chez lui.
 */
import { BALANCE, SLOTS } from './balance'
import { emitEvent } from './events'
import type { Slot } from './items'
import type { Entity, SimState } from './sim'

export type InventoryAction = { type: 'set_active_slot'; slot: number }

export function isInventoryAction(action: { type: string }): action is InventoryAction {
  return action.type === 'set_active_slot'
}

/** La case tenue en main — `null` si mains nues ou si la case active est vide. */
export function heldSlot(entity: Entity): Slot | null {
  if (entity.activeSlot < 0) return null
  return entity.inventory[entity.activeSlot] ?? null
}

/**
 * Use l'objet TENU de `amount`, et le casse à `TOOL_DURABILITY` (spec R6).
 * L'usure vit dans la CASE : deux haches ne partagent plus un compteur.
 */
export function wearHeld(entity: Entity, amount: number): void {
  const slot = heldSlot(entity)
  if (slot === null) return
  slot.wear = (slot.wear ?? 0) + amount
  if (slot.wear >= BALANCE.TOOL_DURABILITY) entity.inventory[entity.activeSlot] = null
}

export function applyInventoryAction(state: SimState, actorId: number, action: InventoryAction): void {
  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return
  const reject = (reason: string): void => {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason })
  }

  switch (action.type) {
    case 'set_active_slot': {
      if (!Number.isInteger(action.slot)) return reject('case invalide')
      if (action.slot === -1) {
        actor.activeSlot = -1 // rengainer
        return
      }
      // Seule la CEINTURE se tient en main : le sac se fouille, il ne s'empoigne pas.
      if (action.slot < 0 || action.slot >= SLOTS.BELT) return reject('hors de la ceinture')
      if (action.slot >= actor.inventory.length) return reject('hors de la ceinture')
      actor.activeSlot = action.slot
      return
    }
  }
}
```

- [ ] **Step 5: `economy.ts` — l'outil vient de la main**

Remplacer `toolMultiplier` :

```ts
/**
 * Le rendement vient de l'objet TENU (spec inventaire R9) : fer ×3, basique ×2,
 * mains nues ×1. La sim NE FOUILLE PLUS LE SAC — oublier sa hache a un coût.
 */
function toolMultiplier(entity: Entity, family: 'axe' | 'pickaxe' | null): { mult: number; held: boolean } {
  const slot = heldSlot(entity)
  if (!family || slot === null) return { mult: 1, held: false }
  const tier = TOOL_TIERS[family]
  if (slot.item === tier.iron) return { mult: 3, held: true }
  if (slot.item === tier.basic) return { mult: 2, held: true }
  return { mult: 1, held: false } // on tient autre chose : ça ne sert à rien ici
}
```

Dans `case 'harvest'`, remplacer `const { mult, toolItem } = toolMultiplier(actor, def.tool)` par `const { mult, held } = toolMultiplier(actor, def.tool)`, puis :
- `if (def.requiresTool && !toolItem)` → `if (def.requiresTool && !held) return reject('il faut une pioche en main')`
- Le bloc d'usure `if (toolItem) { actor.wear[toolItem] = ... }` → :
  ```ts
      if (held) {
        const wear = Math.max(
          BALANCE.TOOL_WEAR_MIN,
          1 - BALANCE.SKILL_WEAR_REDUCTION * levelOf(actor, 'crafting'),
        )
        wearHeld(actor, wear)
      }
  ```
Importer `heldSlot, wearHeld` depuis `./inventory-actions`.

- [ ] **Step 6: `combat.ts` — l'arme vient de la main**

Remplacer `weaponDamage` et **supprimer** `bestWeaponItem` :

```ts
/**
 * Les dégâts viennent de l'arme TENUE (spec inventaire R9), pas de la meilleure
 * du sac. Un outil n'est pas une arme (spec combat R5) : seul ce qui figure dans
 * WEAPON_DAMAGE frappe fort.
 */
export function weaponDamage(entity: Entity): number {
  const slot = heldSlot(entity)
  if (slot === null) return COMBAT.UNARMED_DAMAGE
  const dmg = WEAPON_DAMAGE[slot.item]
  return dmg !== undefined && dmg > COMBAT.UNARMED_DAMAGE ? dmg : COMBAT.UNARMED_DAMAGE
}
```

Le bloc d'usure au contact (« L'arme s'use au contact ») devient :

```ts
  // L'arme s'use au contact — dans SA case (spec inventaire R6).
  if (struck && windup.damage === undefined) {
    const held = heldSlot(attacker)
    if (held !== null && WEAPON_DAMAGE[held.item] !== undefined) wearHeld(attacker, 1)
  }
```

Dans le respawn du joueur (`killEntity`), remplacer `entity.wear = {}` par `entity.activeSlot = -1` (et l'inventaire vide vient déjà de la Task 1).

Importer `heldSlot, wearHeld` depuis `./inventory-actions`.

- [ ] **Step 7: Vérifier le VERT**

Run: `pnpm --filter @braises/sim test` → PASS
Run: `pnpm check && pnpm test && pnpm lint` → PASS

**Attention aux PNJ :** ils n'ont pas de `activeSlot` armé (ils naissent à `-1`) — donc ils récoltent désormais à mains nues et frappent sans arme. **C'est une régression de gameplay réelle.** Correction *dans cette tâche* : dans `npc.ts`, au moment où un PNJ va récolter (chercher la logique qui déclenche `harvest`), armer sa case active sur le meilleur outil qu'il porte :

```ts
/** Les PNJ n'ont pas d'UI : on leur arme la main sur le meilleur outil porté. */
function equipBestTool(entity: Entity, family: 'axe' | 'pickaxe' | null): void {
  if (!family) { entity.activeSlot = -1; return }
  const tier = TOOL_TIERS[family]
  const iron = entity.inventory.findIndex((s) => s !== null && s.item === tier.iron)
  const basic = entity.inventory.findIndex((s) => s !== null && s.item === tier.basic)
  const idx = iron >= 0 ? iron : basic
  entity.activeSlot = idx >= 0 && idx < SLOTS.BELT ? idx : -1
}
```

*(Un PNJ dont l'outil est au-delà de la ceinture reste à mains nues — c'est cohérent avec la règle, et sans conséquence : les PNJ ne portent presque rien. Si un test PNJ existant casse à cause de ça, `equipBestTool` doit d'abord DÉPLACER l'outil dans la ceinture — utiliser `moveSlot` de la Task 5 serait circulaire, donc faire un simple échange de cases sur place.)*

Écrire un test de non-régression PNJ :

```ts
it('un PNJ bûcheron récolte toujours avec sa hache (il arme sa main tout seul)', () => {
  // Poser un PNJ avec une hache et un arbre ; avancer les ticks ; vérifier
  // que le bois entre à un rythme d'outil (×2), pas à mains nues.
})
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sim): l'objet en main fait foi — la sim ne choisit plus pour toi

Entity.activeSlot (case de ceinture tenue, -1 = mains nues). toolMultiplier
et weaponDamage lisent la case active, et elle seule : miner du fer avec la
pioche DANS LE SAC est désormais un refus.

Entity.wear disparaît : l'usure descend dans la case (Slot.wear). Deux haches
ne partagent plus un compteur — c'était un bug de conception qui dormait.

Les PNJ arment leur main tout seuls (equipBestTool) : ils n'ont pas d'UI.

Spec inventaire R6, R8, R9 — critères A5, A6, A7, A8, A9, A16."
```

---

### Task 4: La mort, le cadavre, le coffre

**Files:**
- Modify: `packages/sim/src/combat.ts` (`killEntity`, `loot_corpse`)
- Test: `packages/sim/src/combat.test.ts`

**Interfaces:**
- Consumes: `makeInventory`, `toBag`, `addItems` (retourne le reliquat), `SLOTS` (Task 1).
- Produces: rien de nouveau.

**Critères de la spec :** A12, et la conservation (A21) sur le loot.

- [ ] **Step 1: Écrire les tests (ils doivent échouer)**

```ts
it('A12 : la mort lâche TOUT — le cadavre prend les cases, l’entité repart nue', () => {
  const state = /* un joueur avec des affaires */
  const player = state.entities[0]!
  addItems(player.inventory, { wood: 30, axe: 1, berries: 4 })
  player.activeSlot = 0

  killEntity(state, player /* signature réelle à lire dans combat.ts */)

  const corpse = state.corpses.at(-1)!
  expect(toBag(corpse.inventory)).toEqual({ wood: 30, axe: 1, berries: 4 })
  expect(isEmpty(player.inventory)).toBe(true)
  expect(player.activeSlot).toBe(-1)
})

it('A12bis : le butin de monstre s’ajoute au cadavre sans jamais être tronqué', () => {
  const state = /* un sanglier (MONSTER_DEFS.boar.loot) qui meurt */
  // … le tuer …
  const corpse = state.corpses.at(-1)!
  const bag = toBag(corpse.inventory)
  for (const [item, count] of Object.entries(MONSTER_DEFS.boar.loot)) {
    expect(bag[item as ItemId]).toBeGreaterThanOrEqual(count as number)
  }
})

it('A21 : looter un cadavre avec un sac plein n’ÉVAPORE rien — le cadavre garde le reste', () => {
  const state = /* un joueur adjacent à un cadavre chargé */
  const player = state.entities[0]!
  const corpse = state.corpses[0]!
  addItems(corpse.inventory, { wood: 40 })
  player.inventory = makeInventory(1)
  player.inventory[0] = { item: 'stone', count: stackSize('stone') } // sac plein

  const totalBefore = countOf(player.inventory, 'wood') + countOf(corpse.inventory, 'wood')
  applyCombatAction(state, player.id, { type: 'loot_corpse', corpseId: corpse.id })
  const stillThere = state.corpses.find((c) => c.id === corpse.id)

  expect(stillThere).toBeDefined() // le cadavre ne disparaît PAS s'il reste du butin
  expect(countOf(player.inventory, 'wood') + countOf(stillThere!.inventory, 'wood')).toBe(totalBefore)
})
```

- [ ] **Step 2: Lancer, vérifier le ROUGE**

Run: `pnpm --filter @braises/sim test combat`
Expected: FAIL — le cadavre est supprimé même quand le sac est plein (le butin s'évapore).

- [ ] **Step 3: Implémenter**

Dans `combat.ts`, `case 'loot_corpse'` :

```ts
    case 'loot_corpse': {
      const corpse = state.corpses.find((c) => c.id === action.corpseId)
      if (!corpse) return reject('rien ici')
      if (distSq(actor.x, actor.y, corpse.x, corpse.y) > BALANCE.INTERACT_RANGE * BALANCE.INTERACT_RANGE) return reject('trop loin')
      // Sac borné (spec inventaire R10/A21) : on prend ce qui rentre, le cadavre
      // GARDE le reste. Aucun item ne s'évapore — et le cadavre ne disparaît que
      // s'il a été vidé.
      const leftover = addItems(actor.inventory, toBag(corpse.inventory))
      corpse.inventory = makeInventory(SLOTS.CORPSE)
      addItems(corpse.inventory, leftover)
      if (isEmpty(corpse.inventory)) {
        state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
        emitEvent(state, { type: 'corpse_looted', tick: state.tick, corpseId: corpse.id, byEntityId: actorId })
      } else {
        reject('sac plein')
      }
      return
    }
```

Dans `killEntity`, la construction du butin :

```ts
  // Le cadavre reçoit tout ce qui était porté (spec R9) — plus la table de loot
  // du monstre (le sanglier donne sa viande). Assez de cases pour ne JAMAIS
  // tronquer (SLOTS.CORPSE).
  const loot = makeInventory(SLOTS.CORPSE)
  if (monster) addItems(loot, MONSTER_DEFS[monster.type].loot)
  addItems(loot, toBag(entity.inventory))
```

et remplacer les `Object.keys(loot).length > 0` par `!isEmpty(loot)`.

Dans le respawn joueur : `entity.inventory = makeInventory(SLOTS.PLAYER)` et `entity.activeSlot = -1` (déjà posé en Task 3 — vérifier).

- [ ] **Step 4: Vérifier le VERT**

Run: `pnpm check && pnpm test && pnpm lint` → PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sim): la mort lâche tout, et le loot ne s'évapore jamais

Le cadavre naît avec assez de cases pour ne rien tronquer ; looter avec un
sac plein laisse le reste SUR le cadavre (il ne disparaît que vidé).
Spec inventaire R11-R12, critères A12, A21."
```

---

### Task 5: Les gestes — move_slot, split_slot, transfer

**Files:**
- Modify: `packages/sim/src/inventory-actions.ts`
- Test: `packages/sim/src/inventory-actions.test.ts`

**Interfaces:**
- Consumes: Task 3 (`applyInventoryAction`, `heldSlot`), `hasAccess` (village.ts), `Structure`, `Corpse`.
- Produces:
  ```ts
  export type SlotRef = { side: 'player' | 'container'; slot: number }
  export type InventoryAction =
    | { type: 'set_active_slot'; slot: number }
    | { type: 'move_slot'; from: number; to: number }
    | { type: 'split_slot'; from: number; to: number; count: number }
    | { type: 'transfer'; kind: 'structure' | 'corpse'; containerId: number; from: SlotRef; to: SlotRef; count: number }
  ```

**Critères de la spec :** A13, A14, A15, A17, A18, A19, A21.

- [ ] **Step 1: Écrire les tests (ils doivent échouer)**

```ts
describe('les gestes case-à-case', () => {
  it('A13 : move_slot fusionne deux piles du même item, le débord reste à la source', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 15 }
    entity.inventory[1] = { item: 'wood', count: 12 } // stackSize('wood') = 20
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 20 })
    expect(entity.inventory[1]).toEqual({ item: 'wood', count: 7 }) // le débord RESTE
  })

  it('A13bis : une fusion qui tient entièrement vide la case source', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 5 }
    entity.inventory[1] = { item: 'wood', count: 3 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 8 })
    expect(entity.inventory[1]).toBeNull()
  })

  it('A14 : move_slot de deux items différents ÉCHANGE les cases', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 5 }
    entity.inventory[1] = { item: 'axe', count: 1, wear: 3 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(entity.inventory[0]).toEqual({ item: 'axe', count: 1, wear: 3 }) // l'usure suit l'objet
    expect(entity.inventory[1]).toEqual({ item: 'wood', count: 5 })
  })

  it('deux outils ne fusionnent JAMAIS (pile de 1) : ils s’échangent', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'axe', count: 1, wear: 1 }
    entity.inventory[1] = { item: 'axe', count: 1, wear: 9 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(entity.inventory[0]).toEqual({ item: 'axe', count: 1, wear: 9 })
    expect(entity.inventory[1]).toEqual({ item: 'axe', count: 1, wear: 1 })
  })

  it('A15 : split_slot scinde vers une case VIDE ; refuse une case occupée et un outil', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 20 }
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 3, count: 8 })
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 12 })
    expect(entity.inventory[3]).toEqual({ item: 'wood', count: 8 })

    // case occupée → refus
    entity.inventory[4] = { item: 'stone', count: 1 }
    drainEvents(state)
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 4, count: 2 })
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 12 }) // inchangé
    expect(drainEvents(state)).toContainEqual(expect.objectContaining({ type: 'action_rejected' }))

    // outil (pile 1) → refus
    entity.inventory[5] = { item: 'axe', count: 1 }
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 5, to: 6, count: 1 })
    expect(entity.inventory[5]).toEqual({ item: 'axe', count: 1 })
    expect(entity.inventory[6]).toBeNull()
  })
})

describe('transfer joueur ⇄ conteneur', () => {
  it('A17 : déposer dans un coffre PRIVÉ d’autrui est permis (boîte aux dons) ; retirer est refusé', () => {
    // Monter un village avec un coffre `access: 'private'` appartenant à un AUTRE.
    // deposit (player → container) : accepté.
    // withdraw (container → player) : action_rejected 'accès refusé'.
  })

  it('A18 : hors de INTERACT_RANGE → refus, les deux inventaires inchangés', () => { /* … */ })

  it('A19/A21 : conteneur plein → on ne transfère que ce qui rentre, le reste RESTE à la source', () => {
    // Coffre à 1 case, déjà pleine d'un autre item. Le transfert ne bouge rien.
    // Coffre à 1 case avec `wood 18` : transférer 7 bois → 2 passent, 5 restent.
    // Invariant : la somme des `count` par item sur (joueur + coffre) est CONSTANTE.
  })
})
```

*(Les trois derniers tests décrivent l'intention ; l'implémenteur écrit les fixtures dans le style des helpers de `village.test.ts` — y lire comment un coffre et un second joueur y sont montés.)*

- [ ] **Step 2: Lancer, vérifier le ROUGE**

Run: `pnpm --filter @braises/sim test inventory-actions`
Expected: FAIL — actions inconnues.

- [ ] **Step 3: Implémenter dans `inventory-actions.ts`**

Ajouter, à côté de `set_active_slot` :

```ts
/** Déplace/échange/fusionne DEUX cases du même inventaire (spec R14). */
function moveWithin(inv: Inventory, from: number, to: number): boolean {
  if (from === to) return false
  if (from < 0 || to < 0 || from >= inv.length || to >= inv.length) return false
  const src = inv[from]
  if (src === null) return false
  const dst = inv[to]
  // Fusion : même item, empilable, et aucun des deux n'est un objet usé.
  if (dst !== null && dst.item === src.item && isStackable(src.item)) {
    const max = stackSize(src.item)
    const room = max - dst.count
    const moved = Math.min(room, src.count)
    if (moved <= 0) return false
    dst.count += moved
    src.count -= moved
    if (src.count <= 0) inv[from] = null // le débord RESTE à la source (spec A13)
    return true
  }
  // Sinon : échange sec (l'usure suit l'objet, elle vit dans la case).
  inv[to] = src
  inv[from] = dst
  return true
}
```

Et les trois branches du `switch` :

```ts
    case 'move_slot': {
      if (!Number.isInteger(action.from) || !Number.isInteger(action.to)) return reject('case invalide')
      if (!moveWithin(actor.inventory, action.from, action.to)) return reject('déplacement impossible')
      return
    }

    case 'split_slot': {
      const { from, to, count } = action
      if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(count)) return reject('case invalide')
      if (from < 0 || to < 0 || from >= actor.inventory.length || to >= actor.inventory.length) return reject('case invalide')
      const src = actor.inventory[from]
      if (src === null) return reject('case vide')
      if (actor.inventory[to] !== null) return reject('case occupée')
      if (!isStackable(src.item)) return reject('objet non empilable')
      if (count <= 0 || count >= src.count) return reject('quantité invalide')
      src.count -= count
      actor.inventory[to] = { item: src.item, count }
      return
    }

    case 'transfer': {
      const { kind, containerId, from, to, count } = action
      if (!Number.isInteger(count) || count <= 0) return reject('quantité invalide')
      if (from.side === to.side) return reject('transfert sur place')

      // Le conteneur : coffre (structure) ou cadavre.
      const container =
        kind === 'structure'
          ? state.structures.find((s) => s.id === containerId)
          : state.corpses.find((c) => c.id === containerId)
      if (!container) return reject('conteneur inconnu')
      const inv = container.inventory
      if (inv === undefined) return reject('pas un conteneur')

      const range = BALANCE.INTERACT_RANGE
      const cx = kind === 'structure' ? (container as Structure).tx + 0.5 : (container as Corpse).x
      const cy = kind === 'structure' ? (container as Structure).ty + 0.5 : (container as Corpse).y
      if (distSq(actor.x, actor.y, cx, cy) > range * range) return reject('trop loin')

      // Permissions INCHANGÉES (spec village R10-R12) : déposer est ouvert à tous
      // (la boîte aux dons), RETIRER exige l'accès. Un cadavre n'a pas de serrure.
      const withdrawing = from.side === 'container'
      if (withdrawing && kind === 'structure' && !hasAccess(state, actorId, container as Structure)) {
        return reject('accès refusé')
      }

      const srcInv = from.side === 'player' ? actor.inventory : inv
      const dstInv = to.side === 'player' ? actor.inventory : inv
      const src = srcInv[from.slot]
      if (src === undefined || src === null) return reject('case vide')
      const moving = Math.min(count, src.count)

      // Un objet USÉ (un outil) voyage AVEC son usure : on déplace la case entière,
      // on ne la reconstruit pas — sinon l'usure serait blanchie par un aller-retour
      // au coffre. Les empilables, eux, passent par le sac (fusion/ouverture de case).
      if (src.wear !== undefined || !isStackable(src.item)) {
        const dst = dstInv[to.slot]
        if (dst !== undefined && dst !== null) return reject('case occupée')
        if (to.slot < 0 || to.slot >= dstInv.length) return reject('case invalide')
        dstInv[to.slot] = src
        srcInv[from.slot] = null
      } else {
        // Empilable : on retire d'abord ce qu'on peut placer — jamais l'inverse
        // (sinon un conteneur plein DUPLIQUERAIT ce qui ne rentre pas).
        const room = freeRoomFor(dstInv, src.item)
        const actually = Math.min(moving, room)
        if (actually <= 0) return reject('destination pleine')
        src.count -= actually
        if (src.count <= 0) srcInv[from.slot] = null
        addItems(dstInv, { [src.item]: actually })
      }

      onDeposit(state, actorId, kind, container, from, to)
      return
    }
```

**L'effet d'alignement du don (préservé à l'identique, spec R16).** Extraire de `village.ts` (`case 'deposit'`) la partie « déposer de la nourriture au grenier d'un AUTRE village = un don » dans une fonction partagée, appelée par `deposit` **et** par `transfer` — la dupliquer serait garantir qu'elles divergent :

```ts
// dans village.ts, exportée
export function recordForeignDeposit(state: SimState, actorId: number, s: Structure, item: ItemId, count: number): void {
  if (s.access !== 'village') return
  const actorVillage = getVillageOf(state, actorId)
  const foodValue = FOOD_VALUES[item]
  if (foodValue === undefined || actorVillage?.id === s.villageId) return
  recordAct(state, actorId, foodValue * count * ALIGNMENT.FOREIGN_DEPOSIT_WARMTH_PER_FOOD * seasonActFactor(state))
  emitEvent(state, { type: 'gift_given', tick: state.tick, byEntityId: actorId, toVillageId: s.villageId, item, count })
}
```

`village.ts case 'deposit'` appelle `recordForeignDeposit(...)` à la place de son bloc inline ; `transfer` l'appelle quand `to.side === 'container' && kind === 'structure'` avec l'item et la quantité **réellement** déposés. Écrire un test qui prouve que les deux chemins émettent le même `gift_given`.

- [ ] **Step 4: Vérifier le VERT**

Run: `pnpm check && pnpm test && pnpm lint` → PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sim): les gestes case-à-case — move, split, transfer

move_slot fusionne (le débord reste à la source) ou échange ; split_slot
scinde vers une case vide ; transfer passe du joueur au coffre/cadavre en
préservant à l'IDENTIQUE les permissions (déposer ouvert à tous, retirer
sur accès) et l'effet d'alignement du don (recordForeignDeposit, désormais
partagée avec deposit — la dupliquer serait garantir qu'elles divergent).

Invariant testé : aucun item ne se crée ni ne se détruit (A21).
Spec inventaire R14-R16 — critères A13-A19."
```

---

### Task 6: Le client — la hotbar et les vitales

**Files:**
- Create: `packages/client/src/render/item-art.ts`
- Create: `packages/client/src/scenes/ui/slot-view.ts`
- Create: `packages/client/src/scenes/ui/hotbar.ts`
- Create: `packages/client/src/scenes/ui/vitals.ts`
- Modify: `packages/client/src/scenes/UIScene.ts` (retirer le pavé de texte du bas, appeler les nouveaux modules)
- Modify: `packages/client/src/hud-state.ts` (`inv: Inventory`, `activeSlot: number`)
- Modify: `packages/client/src/scenes/world/hud-bridge.ts` (publier `activeSlot`)
- Modify: `packages/client/src/scenes/world/keymap.ts` + `input-bindings.ts` (touches 1-6, molette, `B`)
- Modify: `packages/client/src/scenes/BootScene.ts` (générer les textures d'icônes)
- Test: `packages/client/src/render/item-art.test.ts` (les 16 items ont une icône)

**Interfaces:**
- Consumes: `Inventory`, `Slot`, `ItemId`, `SLOTS`, `stackSize` (`@braises/sim`).
- Produces:
  ```ts
  // item-art.ts
  export const ITEM_ICON_PX = 16
  export function itemIconKey(item: ItemId): string          // 'it-wood'
  export function generateItemIcons(scene: Phaser.Scene): void  // appelée par BootScene
  export const ITEM_LABELS: Record<ItemId, string>            // 'Bois', 'Pioche de fer'…
  // slot-view.ts
  export interface SlotView { root: Phaser.GameObjects.Container; update(slot: Slot | null, active: boolean): void }
  export function createSlotView(scene: Phaser.Scene, x: number, y: number, size: number): SlotView
  // hotbar.ts
  export interface Hotbar { update(inv: Inventory, activeSlot: number): void }
  export function createHotbar(scene: Phaser.Scene): Hotbar
  // vitals.ts
  export interface Vitals { update(s: { hp: number; stamina: number; hunger: number; temperature: number; wounds: Entity['wounds'] }): void }
  export function createVitals(scene: Phaser.Scene): Vitals
  ```

- [ ] **Step 1: Le test des icônes (il doit échouer)**

`packages/client/src/render/item-art.test.ts` — un test de complétude, pas de pixels : aucun item ne doit être sans icône ni sans nom français.

```ts
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
```

- [ ] **Step 2: Lancer, vérifier le ROUGE**

Run: `pnpm --filter @braises/client test item-art`
Expected: FAIL — module inexistant.

- [ ] **Step 3: `item-art.ts` — les icônes, dessinées en code**

Suivre **exactement** le motif de `BootScene.ts` (lire `generateTexture` sur `st-*` / `nd-*`). Une fonction par item, 16×16, silhouette lisible d'abord (règle 3 de `poi-art.ts` : on lit une FORME, jamais une texture), lumière au nord-ouest. Squelette :

```ts
/**
 * Les icônes d'items — dessinées EN CODE, comme tout l'art du projet
 * (cf. poi-art.ts). 16 px : on lit une SILHOUETTE, jamais une texture.
 * Palette alignée sur celle du monde (bois chaud, pierre froide, fer bleuté).
 */
import type Phaser from 'phaser'
import type { ItemId } from '@braises/sim'

export const ITEM_ICON_PX = 16

export const ITEM_LABELS: Record<ItemId, string> = {
  wood: 'Bois', stone: 'Pierre', fiber: 'Fibre', berries: 'Baies', stew: 'Ragoût',
  iron_ore: 'Minerai de fer', coal: 'Charbon', iron_ingot: 'Lingot de fer',
  axe: 'Hache', pickaxe: 'Pioche', iron_axe: 'Hache de fer', iron_pickaxe: 'Pioche de fer',
  spear: 'Lance', raw_meat: 'Viande crue', cooked_meat: 'Viande cuite', components: 'Composants',
}

export function itemIconKey(item: ItemId): string {
  return `it-${item}`
}

/** Appelée UNE fois par BootScene : peuple le cache de textures. */
export function generateItemIcons(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 })
  const draw = (item: ItemId, paint: (g: Phaser.GameObjects.Graphics) => void): void => {
    g.clear()
    paint(g)
    g.generateTexture(itemIconKey(item), ITEM_ICON_PX, ITEM_ICON_PX)
  }

  // Deux bûches croisées, bout clair au NO.
  draw('wood', (g) => {
    g.fillStyle(0x7a5a34).fillRect(2, 6, 12, 4)
    g.fillStyle(0x8d6b40).fillRect(2, 6, 12, 1)
    g.fillStyle(0x6a4c2c).fillRect(4, 10, 12, 4)
    g.fillStyle(0xc3a678).fillRect(2, 6, 2, 4) // le cœur du bois, en bout
  })

  // … une entrée par item (16 au total). Garder chaque dessin sous ~6 lignes :
  // une silhouette, une face claire, une ombre. Pas de détail à 16 px.

  g.destroy()
}
```

**Les 16 icônes sont à écrire.** Repères de silhouette (à respecter — c'est la lisibilité, pas de la décoration) : `stone` galets gris empilés · `fiber` botte d'herbe nouée · `berries` trois baies rouges sur tige · `stew` bol fumant · `iron_ore` roche à mouchetures ocre · `coal` éclats noirs anguleux · `iron_ingot` lingot trapézoïdal bleuté · `axe` manche + fer triangulaire · `pickaxe` manche + tête en T · `iron_axe`/`iron_pickaxe` idem en bleuté avec un liseré clair · `spear` hampe + pointe · `raw_meat` pièce rouge avec os · `cooked_meat` idem, brun doré · `components` engrenage/ferraille.

Appeler `generateItemIcons(this)` dans `BootScene.preload`/`create` (là où les autres `generateTexture` sont faits).

- [ ] **Step 4: `slot-view.ts` — le dessin d'UNE case**

Partagé par la hotbar, la grille et le loot : une seule définition de ce qu'est une case à l'écran (fond, bordure, icône, compteur, barre d'usure, surlignage actif).

```ts
/**
 * UNE case, à l'écran. Partagée par la ceinture, la grille du sac et le panneau
 * de loot : si la case se dessine à trois endroits, elle se dessine une fois.
 */
import type { Slot } from '@braises/sim'
import { stackSize } from '@braises/sim'
import Phaser from 'phaser'
import { BALANCE_UI } from './ui-theme' // couleurs — cf. la palette déjà utilisée par UIScene
import { ITEM_ICON_PX, itemIconKey } from '../../render/item-art'

export interface SlotView {
  root: Phaser.GameObjects.Container
  update(slot: Slot | null, active: boolean): void
}

export function createSlotView(scene: Phaser.Scene, x: number, y: number, size: number): SlotView {
  const bg = scene.add.rectangle(0, 0, size, size, 0x14141a, 0.85).setStrokeStyle(2, 0x4a4438)
  const icon = scene.add.image(0, 0, itemIconKey('wood')).setVisible(false)
  icon.setScale((size - 10) / ITEM_ICON_PX)
  const count = scene.add
    .text(size / 2 - 3, size / 2 - 3, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e8e0c8', stroke: '#14141a', strokeThickness: 3 })
    .setOrigin(1, 1)
  // La barre d'usure : présente SEULEMENT quand l'objet est entamé.
  const wearBg = scene.add.rectangle(0, size / 2 - 5, size - 8, 3, 0x14141a).setVisible(false)
  const wearBar = scene.add.rectangle(-(size - 8) / 2, size / 2 - 5, size - 8, 3, 0x4e9c5a).setOrigin(0, 0.5).setVisible(false)
  const root = scene.add.container(x, y, [bg, icon, count, wearBg, wearBar])

  return {
    root,
    update(slot, active) {
      bg.setStrokeStyle(2, active ? 0xe8c66a : 0x4a4438) // la case tenue est OR
      if (slot === null) {
        icon.setVisible(false)
        count.setText('')
        wearBg.setVisible(false)
        wearBar.setVisible(false)
        return
      }
      icon.setTexture(itemIconKey(slot.item)).setVisible(true)
      count.setText(slot.count > 1 ? String(slot.count) : '')
      const worn = slot.wear !== undefined && slot.wear > 0
      wearBg.setVisible(worn)
      wearBar.setVisible(worn)
      if (worn) {
        const left = Math.max(0, 1 - (slot.wear ?? 0) / BALANCE.TOOL_DURABILITY)
        wearBar.width = (size - 8) * left
        wearBar.fillColor = left > 0.5 ? 0x4e9c5a : left > 0.2 ? 0xe8c66a : 0xc0503e
      }
    },
  }
}
```

*(Importer `BALANCE` depuis `@braises/sim` pour `TOOL_DURABILITY`. Si `ui-theme.ts` n'existe pas, inliner les couleurs — ne pas créer un module pour trois constantes.)*

- [ ] **Step 5: `hotbar.ts` et `vitals.ts`**

`createHotbar` : `SLOTS.BELT` `SlotView` centrées en bas (`scene.scale.width / 2`), taille 48 px, 4 px d'écart, avec le numéro de touche (1-6) en petit sous chaque case. `update(inv, activeSlot)` passe `inv[i]` et `i === activeSlot`.

`createVitals` : quatre jauges empilées en bas à gauche (PV rouge `0xc0503e`, endurance verte `0x4e9c5a`, faim ocre `0xd9a441`, température bleue `0x6aa8d9`), chacune 140×10 px avec son icône 12 px et sa valeur ; sous elles, la ligne des blessures (reprendre `woundsText` de `UIScene`, texte `#ff9a7a`). **Retirer de `UIScene` :** `bottomBar` (le pavé de texte), `hpBar`/`staminaBar` en haut à droite et `woundsText` — ils sont remplacés. **Garder** le bandeau du haut (jour/acte/heure/zone/village/tableau) : c'est de l'information de monde, Rust n'en a pas mais Braises en a besoin.

- [ ] **Step 6: Les touches**

`keymap.ts` : remplacer `BUILD_BINDINGS` (1-5) et `CRAFT_BINDINGS` (6-0) par :

```ts
/** La CEINTURE : touches 1-6 → case active 0-5 (spec inventaire R17). */
export const BELT_BINDINGS: readonly [string, number][] = [
  ['ONE', 0], ['TWO', 1], ['THREE', 2], ['FOUR', 3], ['FIVE', 4], ['SIX', 5],
]
```

et ajouter à `KEYMAP` : `toggleInventory: ['TAB']`, `cycleBuildable: ['B']`. **Garder** `eatBerries: ['E']`, `eatStew: ['R']`.

**Les touches de craft (6-0) sont prises par la ceinture.** Le panneau de craft est le chantier 2 : d'ici là, supprimer les raccourcis rendrait le craft **inaccessible** et le jeu injouable entre deux chantiers. Ils sont donc **déplacés sur SHIFT+1…5** (mêmes recettes, même ordre que l'actuel `CRAFT_BINDINGS`) : dans le handler `down` de chaque touche, lire `event.shiftKey` — SHIFT enfoncé → `craft`, sinon → `set_active_slot`. Une ligne d'aide le dit à l'écran. Béquille assumée, supprimée par le chantier 2.

`input-bindings.ts` :
- `BELT_BINDINGS` → `deps.sendAction({ type: 'set_active_slot', slot })` (et `setHud('activeSlot', slot)` en optimiste).
- molette (`scene.input.on('wheel')`, seulement si l'inventaire et la carte sont fermés) → case suivante/précédente, bornée à `[0, SLOTS.BELT)`.
- `B` → fait défiler `selected` (mur → porte → coffre → atelier → four), `setHud('selected', …)`.
- `TAB` → `setHud('inventoryOpen', !…)`.
- SHIFT+1..5 → `craft` des 5 recettes (dépannage jusqu'au chantier 2).

- [ ] **Step 7: `hud-bridge.ts` + `hud-state.ts`**

`hud-state.ts` : `inv: Inventory` (le type suit), ajouter `activeSlot: number`, `inventoryOpen: boolean`, `openContainer: { kind: 'structure' | 'corpse'; id: number } | null`.
`hud-bridge.ts` : `setHud(registry, 'activeSlot', me.activeSlot)` à côté de `inv`.

- [ ] **Step 8: Vérifier**

Run: `pnpm check && pnpm test && pnpm lint && pnpm build` → PASS
Run: `pnpm smoke` → le jeu se charge, aucune erreur console.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(client): la ceinture et les vitales — le HUD parle en cases

Icônes d'items dessinées en code (item-art.ts, 16 px, silhouette d'abord).
SlotView partagée par la ceinture, la grille et le loot. Le pavé de texte du
bas disparaît : jauges en bas à gauche, ceinture en bas au centre.

1-6 tiennent une case, la molette fait défiler, B choisit la structure à
bâtir (béquille jusqu'au chantier 3), SHIFT+1-5 craftent (jusqu'au chantier 2)."
```

---

### Task 7: Le client — l'écran d'inventaire et le panneau de loot

**Files:**
- Create: `packages/client/src/scenes/ui/inventory-panel.ts`
- Modify: `packages/client/src/scenes/UIScene.ts` (monter le panneau, le brancher sur `TAB`)
- Modify: `packages/client/src/scenes/world/input-bindings.ts` (ouvrir le conteneur à portée ; le clic monde ne doit RIEN faire quand le panneau est ouvert)
- Test: `packages/client/src/scenes/ui/inventory-panel.test.ts` (la logique de glisser-déposer, pure — pas de rendu)

**Interfaces:**
- Consumes: `SlotView` (Task 6), les actions `move_slot`/`split_slot`/`transfer` (Task 5).
- Produces:
  ```ts
  export interface InventoryPanel {
    update(inv: Inventory, activeSlot: number, container: { inv: Inventory; title: string } | null): void
    setVisible(v: boolean): void
  }
  export function createInventoryPanel(scene: Phaser.Scene, send: (a: PlayerAction) => void): InventoryPanel
  /** PUR et testable : quel geste produit quelle action ? (aucun Phaser ici) */
  export function dragToAction(drag: DragIntent): PlayerAction | null
  ```

- [ ] **Step 1: Le test de la logique de glisser (il doit échouer)**

La règle : **la traduction geste → action est pure**, donc testable sans navigateur. C'est là que vivent les bugs ; le dessin, lui, se vérifie à l'œil.

```ts
import { describe, expect, it } from 'vitest'
import { dragToAction } from './inventory-panel'

describe('dragToAction', () => {
  it('glisser d’une case du sac à une autre → move_slot', () => {
    expect(dragToAction({ from: { side: 'player', slot: 7 }, to: { side: 'player', slot: 2 }, split: false, count: 5, container: null }))
      .toEqual({ type: 'move_slot', from: 7, to: 2 })
  })

  it('SHIFT-glisser sur une case vide → split_slot (la moitié)', () => {
    expect(dragToAction({ from: { side: 'player', slot: 0 }, to: { side: 'player', slot: 4 }, split: true, count: 10, container: null }))
      .toEqual({ type: 'split_slot', from: 0, to: 4, count: 10 })
  })

  it('glisser du sac vers le conteneur ouvert → transfer', () => {
    expect(dragToAction({
      from: { side: 'player', slot: 3 },
      to: { side: 'container', slot: 1 },
      split: false,
      count: 12,
      container: { kind: 'structure', id: 42 },
    })).toEqual({
      type: 'transfer', kind: 'structure', containerId: 42,
      from: { side: 'player', slot: 3 }, to: { side: 'container', slot: 1 }, count: 12,
    })
  })

  it('glisser vers un conteneur alors qu’AUCUN n’est ouvert → aucune action', () => {
    expect(dragToAction({ from: { side: 'player', slot: 3 }, to: { side: 'container', slot: 1 }, split: false, count: 1, container: null }))
      .toBeNull()
  })

  it('glisser une case sur elle-même → aucune action', () => {
    expect(dragToAction({ from: { side: 'player', slot: 3 }, to: { side: 'player', slot: 3 }, split: false, count: 1, container: null }))
      .toBeNull()
  })
})
```

- [ ] **Step 2: Lancer, vérifier le ROUGE** — `pnpm --filter @braises/client test inventory-panel` → FAIL.

- [ ] **Step 3: Implémenter `dragToAction` (pur) puis le panneau**

```ts
export interface DragIntent {
  from: SlotRef
  to: SlotRef
  /** SHIFT maintenu au lâcher. */
  split: boolean
  /** Quantité concernée (la pile entière, ou la moitié si `split`). */
  count: number
  container: { kind: 'structure' | 'corpse'; id: number } | null
}

export function dragToAction(d: DragIntent): PlayerAction | null {
  if (d.from.side === d.to.side && d.from.slot === d.to.slot) return null
  if ((d.from.side === 'container' || d.to.side === 'container') && d.container === null) return null
  if (d.from.side === 'container' || d.to.side === 'container') {
    return { type: 'transfer', kind: d.container!.kind, containerId: d.container!.id, from: d.from, to: d.to, count: d.count }
  }
  if (d.split) return { type: 'split_slot', from: d.from.slot, to: d.to.slot, count: d.count }
  return { type: 'move_slot', from: d.from.slot, to: d.to.slot }
}
```

Le panneau (Phaser) :
- Un `Container` centré, fond `0x14141a` alpha 0.94, bordure `0x6b5a3a` (reprendre le style du journal dans `UIScene`).
- **Grille du joueur** : `SLOTS.PLAYER` cases (6 par ligne), la **première ligne** (la ceinture) séparée des autres par un filet — on doit VOIR que c'est la ceinture.
- **Panneau de loot** : quand `container !== null`, une seconde grille à gauche, titrée (« Coffre », « Dépouille »).
- **Glisser-déposer** : `setInteractive({ draggable: true })` sur chaque `SlotView.root` ; sur `dragstart` mémoriser la source et créer une icône fantôme suivant le pointeur ; sur `drop` (Phaser émet `drop` avec la zone cible) construire le `DragIntent` (`split = shiftKey`, `count = split ? Math.floor(src.count / 2) : src.count`) et envoyer `dragToAction(...)` via `send`. Rendre chaque case `dropZone`.
- **Clic droit** = envoi rapide : sac ↔ ceinture si aucun conteneur ; joueur ↔ conteneur si un conteneur est ouvert. Cible = **la première case compatible** (pile incomplète du même item, sinon première case vide) — la calculer avec une fonction pure `firstFitSlot(inv, item): number | null`, **testée** dans le même fichier de test.
- **Infobulle** au survol : nom (`ITEM_LABELS`) + usure en % si l'objet est entamé.
- **Optimisme** (spec R22) : après avoir envoyé l'action, appliquer le geste sur une **copie locale** de l'inventaire affichée jusqu'au prochain snapshot. Le plus simple et le plus sûr : ne PAS répliquer la logique de la sim ; se contenter de marquer le panneau « en attente » (les cases concernées à 60 % d'alpha) et laisser le snapshot suivant faire foi. Dans un Worker local, l'aller-retour est d'un tick — invisible. *(Ne pas réimplémenter `moveWithin` côté client : ce serait une seconde source de vérité, exactement ce que l'invariant §3 interdit.)*

- [ ] **Step 4: Ouvrir le conteneur** (`input-bindings.ts`)

`TAB` bascule `inventoryOpen`. À l'ouverture, si un coffre ou un cadavre est à `INTERACT_RANGE` de la position prédite, poser `openContainer` dans le HUD (le plus proche gagne ; un cadavre prime sur un coffre — on loote ce qu'on vient de tuer). Quand `inventoryOpen` est vrai, le `pointerdown` du monde **ne fait rien** (comme il le fait déjà pour `mapOpen`).

- [ ] **Step 5: Vérifier**

Run: `pnpm check && pnpm test && pnpm lint && pnpm build` → PASS
Run: `pnpm smoke --headed` → ouvrir TAB, glisser une pile, vérifier à l'œil que la case bouge après le snapshot.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): l'écran d'inventaire — grille, glisser-déposer, loot

TAB ouvre la grille (la ceinture est la première ligne, elle se voit) ; à
portée d'un coffre ou d'une dépouille, son contenu s'ouvre à côté et le
glisser traverse les deux.

dragToAction est PURE et testée : la traduction geste → action est là où
vivent les bugs. Le geste est optimiste en affichage seulement — aucune
logique d'inventaire ne descend dans le client (invariant §3)."
```

---

### Task 8: La passe finale — le jeu, pas les tests

**Files:** ceux que la vérification désigne.

- [ ] **Step 1: Piloter le VRAI jeu**

Run: `pnpm smoke --headed`
Vérifier, à l'œil, dans cet ordre :
1. La ceinture est visible, vide, aucune case active.
2. Couper un arbre à mains nues → 1 bois par coup, la case se remplit.
3. Crafter une hache (SHIFT+2 près d'un atelier), la mettre en case 1, appuyer `1` → la case s'entoure d'or.
4. Recouper l'arbre → 2 bois par coup, **la barre d'usure apparaît et descend**.
5. Remplir le sac → « sac plein », le nœud ne bouge plus.
6. Poser un coffre (`B` puis clic), `TAB` à côté → le coffre s'ouvre, glisser une pile dedans.
7. Mourir → la dépouille contient tout, le respawn est nu, `activeSlot` à −1.

- [ ] **Step 2: Consigner les écarts**

Tout ce qui ne se comporte pas comme le point 1-7 est un bug : le **reproduire par un test `/sim`** (seed + inputs → état attendu) avant de le corriger. C'est la règle du projet — les bugs se reproduisent avant d'être corrigés.

- [ ] **Step 3: Mettre à jour la doc**

`docs/decisions.md` : une ligne de bilan du chantier (ce qui a été livré, les écarts au plan et pourquoi). `docs/specs/inventaire.md` : passer le statut à *implémenté*, et corriger toute règle que le contact du code a démentie.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "docs: bilan du chantier « le sac » — écarts au plan et statut de la spec"
```

---

## Self-Review

**Couverture de la spec.** R1-R6 → Task 1 (A1-A5). R7-R9 → Task 3 (A6-A9, A16). R10 → Task 2 (A10-A11). R11-R12 → Task 4 (A12). R13-R16 → Tasks 3 et 5 (A13-A19). R17-R18 → Task 6. R19-R20 → Task 7. R21 → Task 6 (`item-art.ts`). R22 → Task 7 (l'optimisme est un affichage, pas une logique). A20 (non-régression) → Task 1, Step 6. A21 (conservation) → Tasks 4 et 5.

**Pièges identifiés et traités dans le plan, à ne pas redécouvrir à la dure :**
1. **Les PNJ à mains nues** (Task 3, Step 7). Faire lire la case active à `toolMultiplier` prive les PNJ de leurs outils — ils n'ont pas d'UI pour armer leur main. `equipBestTool` est dans le plan ; sans lui, l'économie des villages PNJ s'effondre en silence et aucun test unitaire ne le dit.
2. **L'usure blanchie par un aller-retour au coffre** (Task 5). Un `transfer` qui reconstruirait la case au lieu de la déplacer effacerait `wear` — une lessiveuse à outils. D'où le chemin « objet usé = on déplace la case entière ».
3. **La duplication d'items par un conteneur plein** (Task 5). Dans `transfer`, retirer de la source **après** avoir mesuré la place, jamais l'inverse.
4. **Le don qui diverge** (Task 5). `deposit` et `transfer` doivent partager `recordForeignDeposit` — deux copies de la règle d'alignement finiraient par ne plus dire la même chose.
5. **Le craft inaccessible entre deux chantiers** (Task 6). Les touches 1-6 passent à la ceinture ; sans le repli SHIFT+1-5, le jeu devient injouable jusqu'au chantier 2.
6. **Le test vert qui ne teste rien** (contrainte globale). Cinq fois sur le chantier précédent. À chaque « vérifier que le test échoue », si le rouge n'apparaît pas, c'est le test qu'il faut réparer.
