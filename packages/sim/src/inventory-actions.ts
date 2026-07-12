/**
 * Les gestes d'inventaire du joueur (spec inventaire R13-R16).
 *
 * Ce module porte LA règle du chantier : **l'objet en main fait foi** (R9).
 * `economy.ts` et `combat.ts` ne lisent plus que la case active — la sim a cessé
 * de fouiller le sac à la place du joueur. Oublier sa hache a un coût, et c'est
 * ce coût, et lui seul, qui donne son poids à la ceinture.
 *
 * Toutes les actions valident DANS la sim (serveur autoritatif, invariant §3) et
 * émettent `action_rejected` en cas de refus. Le client n'anticipe que
 * l'affichage — aucune logique d'inventaire ne descend chez lui.
 *
 * Les GESTES (R14-R16) ne réimplémentent aucune règle de versement : ils appellent
 * `pourOntoSlot`/`moveSlotWithin` (items.ts) — le geste « glisser une case sur une
 * autre » — et `creditForeignDeposit` (village.ts) — l'effet d'alignement du don.
 * Recopier l'une ou l'autre ici, ce serait signer leur divergence.
 */
import { BALANCE, SLOTS } from './balance'
import { emitEvent } from './events'
import { distSq } from './geometry'
import {
  durabilityOf,
  isEmpty,
  isStackable,
  moveSlotWithin,
  pourOntoSlot,
  type Inventory,
  type Slot,
} from './items'
import type { Entity, SimState } from './sim'
import { creditForeignDeposit, hasAccess, type Structure } from './village'

/** Une case, d'un côté ou de l'autre du panneau de loot (spec R20). */
export interface SlotRef {
  side: 'player' | 'container'
  slot: number
}

export type InventoryAction =
  | { type: 'set_active_slot'; slot: number }
  | { type: 'move_slot'; from: number; to: number }
  | { type: 'split_slot'; from: number; to: number; count: number }
  | {
      type: 'transfer'
      kind: 'structure' | 'corpse'
      containerId: number
      from: SlotRef
      to: SlotRef
      count: number
    }

const INVENTORY_ACTION_TYPES: string[] = ['set_active_slot', 'move_slot', 'split_slot', 'transfer']

export function isInventoryAction(action: { type: string }): action is InventoryAction {
  return INVENTORY_ACTION_TYPES.includes(action.type)
}

/**
 * La case tenue en main — `null` si mains nues OU si la case active est vide.
 *
 * La borne de ceinture se REVALIDE ici, à la LECTURE : R8 (« seule une case de la
 * ceinture se tient en main ») cesse ainsi de dépendre de la vigilance de chaque
 * site d'écriture — il n'y a plus d'`activeSlot` hors ceinture qui puisse armer
 * une main, quel que soit le chemin qui l'a posé. C'est LA définition de R8, pas
 * une seconde copie de la règle.
 */
export function heldSlot(entity: Entity): Slot | null {
  if (entity.activeSlot < 0 || entity.activeSlot >= SLOTS.BELT) return null
  return entity.inventory[entity.activeSlot] ?? null
}

/**
 * Use l'objet TENU de `amount`, et le casse à SA durabilité (spec R6, C6).
 *
 * L'usure vit dans la CASE : deux haches ne partagent plus un compteur (c'était
 * un bug de conception qui dormait — `Entity.wear` agrégeait par type d'item).
 * Le SEUIL, lui, vit dans l'OBJET (`durabilityOf`) : un hachereau de fortune
 * casse au 20ᵉ coup là où une hache d'atelier en tient 100 — c'est tout ce que
 * paie la couche 1, qui rend pourtant autant. Mains nues : rien à user.
 */
export function wearHeld(entity: Entity, amount: number): void {
  const slot = heldSlot(entity)
  if (slot === null) return
  slot.wear = (slot.wear ?? 0) + amount
  if (slot.wear >= durabilityOf(slot.item)) entity.inventory[entity.activeSlot] = null
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

    case 'move_slot': {
      if (!Number.isInteger(action.from) || !Number.isInteger(action.to)) return reject('case invalide')
      if (!moveSlotWithin(actor.inventory, action.from, action.to)) return reject('déplacement impossible')
      return
    }

    case 'split_slot': {
      const { from, to, count } = action
      if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(count)) {
        return reject('case invalide')
      }
      const inv = actor.inventory
      if (from === to || from < 0 || to < 0 || from >= inv.length || to >= inv.length) {
        return reject('case invalide')
      }
      const src = inv[from]
      if (src === null || src === undefined) return reject('case vide')
      if (inv[to] !== null) return reject('case occupée')
      if (!isStackable(src.item)) return reject('objet non empilable')
      // Scinder, c'est LAISSER quelque chose : `count === src.count` serait un
      // simple déplacement (move_slot), pas une scission.
      if (count <= 0 || count >= src.count) return reject('quantité invalide')
      pourOntoSlot(inv, from, inv, to, count)
      return
    }

    case 'transfer': {
      const { kind, containerId, from, to, count } = action
      if (!Number.isInteger(count) || count <= 0) return reject('quantité invalide')
      if (!Number.isInteger(from.slot) || !Number.isInteger(to.slot)) return reject('case invalide')
      if (from.side === to.side) return reject('transfert sur place')
      // `side` vient d'un client HOSTILE : le TYPE ne le borne qu'à la compilation.
      // Un `side` qui ment (ni 'player' ni 'container') échappe à toute comparaison
      // d'égalité — il SAUTE la garde de retrait `from.side === 'container'` (donc
      // `hasAccess` n'est jamais consulté) et se fait traiter comme le conteneur.
      // On borne chaque champ à ses valeurs légales : comparer des champs entre eux
      // ne suffit pas (leçon de la faille rouverte).
      if (from.side !== 'player' && from.side !== 'container') return reject('case invalide')
      if (to.side !== 'player' && to.side !== 'container') return reject('case invalide')

      // Le conteneur : un coffre (structure) ou une dépouille.
      const structure = kind === 'structure' ? findStructure(state, containerId) : undefined
      const corpse = kind === 'corpse' ? state.corpses.find((c) => c.id === containerId) : undefined
      if (kind === 'structure' && structure === undefined) return reject('conteneur inconnu')
      if (kind === 'corpse' && corpse === undefined) return reject('conteneur inconnu')
      const box: Inventory | undefined = structure ? structure.inventory : corpse?.inventory
      if (box === undefined) return reject('pas un conteneur')

      const range = BALANCE.INTERACT_RANGE
      const cx = structure ? structure.tx + 0.5 : corpse!.x
      const cy = structure ? structure.ty + 0.5 : corpse!.y
      if (distSq(actor.x, actor.y, cx, cy) > range * range) return reject('trop loin')

      // Permissions INCHANGÉES (spec village R10-R12) : DÉPOSER est ouvert à tous —
      // c'est la boîte aux dons, un mécanisme d'alignement — et seul RETIRER exige
      // l'accès. Une dépouille n'a pas de serrure.
      if (from.side === 'container' && structure && !hasAccess(state, actorId, structure)) {
        return reject('accès refusé')
      }

      const srcInv = from.side === 'player' ? actor.inventory : box
      const dstInv = to.side === 'player' ? actor.inventory : box
      if (from.slot < 0 || from.slot >= srcInv.length) return reject('case invalide')
      if (to.slot < 0 || to.slot >= dstInv.length) return reject('case invalide')
      const src = srcInv[from.slot]
      if (src === null || src === undefined) return reject('case vide')
      const item = src.item // la case source peut disparaître : on retient l'item AVANT

      // Le versement mesure la place AVANT de retirer quoi que ce soit : ce qui ne
      // rentre pas reste à la source (A19/A21). Et une case OCCUPÉE ne s'échange
      // jamais avec la source, contrairement à `move_slot` : un échange serait un
      // RETRAIT déguisé — n'importe qui viderait un coffre privé en y glissant un
      // caillou.
      const moved = pourOntoSlot(srcInv, from.slot, dstInv, to.slot, count)
      if (moved === 0) {
        const dst = dstInv[to.slot]
        if (dst === null || dst === undefined) return reject('quantité invalide')
        return reject(dst.item === item ? 'destination pleine' : 'case occupée')
      }

      // Le don de nourriture au grenier d'un AUTRE village (spec alignement R11) :
      // la MÊME fonction que `deposit`, sur la quantité RÉELLEMENT déposée.
      if (to.side === 'container' && structure) {
        creditForeignDeposit(state, actorId, structure, item, moved)
      }
      // Une dépouille vidée s'efface, comme après un `loot_corpse` : sinon fouiller
      // case à case laisserait traîner des tas vides jusqu'à leur décomposition.
      if (corpse && from.side === 'container' && isEmpty(corpse.inventory)) {
        state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
        emitEvent(state, {
          type: 'corpse_looted',
          tick: state.tick,
          corpseId: corpse.id,
          byEntityId: actorId,
        })
      }
      return
    }
  }
}

function findStructure(state: SimState, id: number): Structure | undefined {
  return state.structures.find((s) => s.id === id)
}
