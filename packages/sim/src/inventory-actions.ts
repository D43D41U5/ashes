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
 * (`move_slot`, `split_slot` et `transfer` viennent en tâche 5.)
 */
import { BALANCE, SLOTS } from './balance'
import { emitEvent } from './events'
import type { Slot } from './items'
import type { Entity, SimState } from './sim'

export type InventoryAction = { type: 'set_active_slot'; slot: number }

export function isInventoryAction(action: { type: string }): action is InventoryAction {
  return action.type === 'set_active_slot'
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
 * Use l'objet TENU de `amount`, et le casse à `TOOL_DURABILITY` (spec R6).
 *
 * L'usure vit dans la CASE : deux haches ne partagent plus un compteur (c'était
 * un bug de conception qui dormait — `Entity.wear` agrégeait par type d'item).
 * Mains nues : rien à user, rien à casser.
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
