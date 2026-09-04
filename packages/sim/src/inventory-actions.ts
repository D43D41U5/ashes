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
import { BALANCE, HUNT, SLOTS } from './balance'
import { atteignableEntreEtages, atteintLeSol, niveauDuCorps, poserLEtageDuCorps } from './etages'
import { emitEvent } from './events'
import { fireSlotLocked, fireZoneAccepts, fireZoneInventory, type FireZone } from './fire'
import { distSq } from './geometry'
import {
  addItems,
  durabilityOf,
  isEmpty,
  isStackable,
  moveSlotWithin,
  pourOntoSlot,
  type Inventory,
  type ItemId,
  type Slot,
} from './items'
import type { Entity, SimState } from './sim'
import { creditForeignDeposit, hasAccess, type Structure } from './village'

/** Une case, d'un côté ou de l'autre du panneau de loot (spec R20). */
export interface SlotRef {
  side: 'player' | 'container'
  slot: number
  /**
   * LA ZONE-CONTENEUR, pour un feu-station : `fuel` (combustible), `cookIn` (entrées), `cookOut`
   * (sorties). Absente = l'inventaire du conteneur (coffre, dépouille). Ignorée côté `player`. C'est
   * ce qui fait des cases du feu de VRAIS conteneurs (dépôt/retrait/déplacement), à un verrou près.
   */
  zone?: FireZone
}

/** Une `zone` de client hostile : on la borne aux valeurs légales (comme `side`), `undefined` compris. */
function isFireZone(zone: unknown): zone is FireZone | undefined {
  return zone === undefined || zone === 'fuel' || zone === 'cookIn' || zone === 'cookOut'
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
  /**
   * JE JETTE CE QUE JE TIENS (spec chasse C18, décision utilisateur n°4). Une
   * unité de la case active tombe au sol, dans une PILE (`state.groundItems`) —
   * ramassable à l'unité, périssable. C'est le geste qui rend exécutables :
   * l'APPÂT (poser des baies, et attendre), le JET DE VIANDE à une meute qui
   * vous serre (faune R15, promis par le GDD §9bis et jamais tenu), et
   * l'allègement d'un porteur en fuite — une case à la fois.
   */
  | { type: 'drop_held' }
  /** JE RAMASSE une pile au sol (portée de bras). */
  | { type: 'pick_up'; pileId: number }

/**
 * LES TYPES DE CETTE FAMILLE — `Record<Union, true>` et non `string[]`, exprès.
 *
 * C'était une liste de chaînes écrite à la main, doublant l'union juste au-dessus. Or
 * `isInventoryAction` est un PRÉDICAT DE TYPE : le compilateur le croit sur parole. Une
 * variante ajoutée à `InventoryAction` sans être recopiée ici compilait donc sans un mot,
 * et l'action tombait dans le vide au routage (`sim.ts` la passe à la famille suivante).
 * C'est la seule des quatre familles d'actions que le compilateur ne gardait pas — les
 * trois autres ont un `else` typé qui joue le rôle d'un garde `never`.
 *
 * Avec un `Record` total, une variante de plus NE COMPILE PLUS tant qu'elle n'est pas
 * déclarée ici. Même remède que la table `FORMES` du serveur, et pour la même raison :
 * une vérité écrite deux fois finit toujours par diverger, sauf si le compilateur tient
 * la seconde copie.
 */
const INVENTORY_ACTION_TYPES: Record<InventoryAction['type'], true> = {
  set_active_slot: true,
  move_slot: true,
  split_slot: true,
  transfer: true,
  drop_held: true,
  pick_up: true,
}

export function isInventoryAction(action: { type: string }): action is InventoryAction {
  // `hasOwn` et pas `in` : `'toString' in table` est vrai sur tout objet, et le `type`
  // vient parfois du réseau.
  return Object.hasOwn(INVENTORY_ACTION_TYPES, action.type)
}

/**
 * POSER DES CHOSES AU SOL — le seul chemin (spec chasse C18).
 *
 * Les piles FUSIONNENT si l'on pose deux fois le même item au même endroit : sans ça,
 * dix baies jetées feraient dix piles superposées, et dix bêtes convergeraient sur dix
 * appâts qui n'en sont qu'un. Depuis le tir (`tir.md` T6) l'enjeu a doublé : vingt
 * flèches décochées sur le même loup feraient vingt tas d'une flèche, à ramasser un
 * par un — la récupération, qui doit être le geste simple qui paie l'économie de
 * munition, deviendrait une corvée de vingt clics.
 *
 * N'ÉMET AUCUN ÉVÉNEMENT : jeter est un fait de domaine (`item_dropped`, que
 * l'alignement consomme), une flèche qui retombe n'en est pas un. C'est à l'appelant
 * de dire si son geste compte, pas à la pile de le supposer.
 */
export function poserAuSol(state: SimState, x: number, y: number, item: ItemId, count: number, niveau?: number): void {
  // ═══ CE QU'ON LÂCHE SUR UN PLATEAU Y RESTE (spec `etages.md` E-R22) ═══
  //
  // `niveau` est l'étage de QUI lâche (`niveauDuCorps`) ; absent, la pile est au palier de sa
  // tuile — le sol, comme toujours. Sans ce nombre, une pile lâchée depuis le chapeau d'une mesa
  // vivait « au sol », c'est-à-dire DANS la roche du chapeau : E-R5 la disait « trop loin » à
  // qui venait de la poser, et elle attendait là son expiration. Le pendant exact de
  // `Corpse.etage`, normalisé de la même main (`poserLEtageDuCorps` : absent au palier).
  const etage = niveau ?? niveauDuCorps(state.map, { x, y })
  const near = state.groundItems.find(
    (p) => p.item === item && distSq(x, y, p.x, p.y) <= 0.5 * 0.5 && niveauDuCorps(state.map, p) === etage,
  )
  if (near) {
    near.count += count
    near.expiresAt = state.tick + HUNT.GROUND_TTL // le tas se renouvelle
    return
  }
  const pile = { id: state.nextGroundItemId, x, y, item, count, expiresAt: state.tick + HUNT.GROUND_TTL }
  poserLEtageDuCorps(state.map, pile, etage)
  state.groundItems.push(pile)
  state.nextGroundItemId += 1
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
      let { count } = action
      const { kind, containerId, from, to } = action
      if (!Number.isInteger(count) || count <= 0) return reject('quantité invalide')
      if (!Number.isInteger(from.slot) || !Number.isInteger(to.slot)) return reject('case invalide')
      // `side`/`zone` viennent d'un client HOSTILE : le TYPE ne les borne qu'à la compilation.
      // Un `side` qui ment (ni 'player' ni 'container') échappe à toute comparaison d'égalité — il
      // SAUTE la garde de retrait `from.side === 'container'` (donc `hasAccess` n'est jamais consulté)
      // et se fait traiter comme le conteneur. On borne CHAQUE champ à ses valeurs légales : comparer
      // des champs entre eux ne suffit pas (leçon de la faille rouverte). La `zone` de même.
      if (from.side !== 'player' && from.side !== 'container') return reject('case invalide')
      if (to.side !== 'player' && to.side !== 'container') return reject('case invalide')
      if (!isFireZone(from.zone) || !isFireZone(to.zone)) return reject('zone invalide')
      // Même côté : le sac sur lui-même, c'est `move_slot` ; deux cases-conteneur DIFFÉRENTES (zones
      // ou slots) se déplacent bien l'une vers l'autre (réorganiser un feu), la MÊME case est un no-op.
      if (from.side === to.side) {
        if (from.side === 'player') return reject('transfert sur place')
        if (from.zone === to.zone && from.slot === to.slot) return reject('transfert sur place')
      }

      // Le conteneur : un coffre/feu (structure) ou une dépouille.
      const structure = kind === 'structure' ? findStructure(state, containerId) : undefined
      const corpse = kind === 'corpse' ? state.corpses.find((c) => c.id === containerId) : undefined
      if (kind === 'structure' && structure === undefined) return reject('conteneur inconnu')
      if (kind === 'corpse' && corpse === undefined) return reject('conteneur inconnu')
      // UNE BÊTE NE SE FOUILLE PAS (spec `depecage.md` R3) : son réservoir s'ouvre au couteau.
      if (corpse?.carcass !== undefined) return reject('il faut le dépecer')

      const range = BALANCE.INTERACT_RANGE
      const cx = structure ? structure.tx + 0.5 : corpse!.x
      const cy = structure ? structure.ty + 0.5 : corpse!.y
      if (distSq(actor.x, actor.y, cx, cy) > range * range) return reject('trop loin')
      // Le contenant vit au sol (spec `etages.md` E-R5) : pas de bras à travers un plancher.
      if (!atteintLeSol(state.map, actor, Math.floor(cx), Math.floor(cy))) return reject('trop loin')

      // Permissions INCHANGÉES (spec village R10-R12) : DÉPOSER est ouvert à tous —
      // c'est la boîte aux dons, un mécanisme d'alignement — et seul RETIRER exige
      // l'accès. Une dépouille n'a pas de serrure.
      if (from.side === 'container' && structure && !hasAccess(state, actorId, structure)) {
        return reject('accès refusé')
      }

      // La case-conteneur d'un côté : une ZONE du feu (combustible/entrées/sorties) OU l'inventaire du
      // coffre/de la dépouille. `undefined` = pas un conteneur ICI (ex. combustible d'un Foyer, S16).
      const boxOf = (ref: SlotRef): Inventory | undefined =>
        structure ? (ref.zone ? fireZoneInventory(structure, ref.zone) : structure.inventory) : corpse?.inventory
      const srcInv = from.side === 'player' ? actor.inventory : boxOf(from)
      const dstInv = to.side === 'player' ? actor.inventory : boxOf(to)
      if (srcInv === undefined || dstInv === undefined) return reject('pas un conteneur')
      if (from.slot < 0 || from.slot >= srcInv.length) return reject('case invalide')
      if (to.slot < 0 || to.slot >= dstInv.length) return reject('case invalide')
      const src = srcInv[from.slot]
      if (src === null || src === undefined) return reject('case vide')
      const item = src.item // la case source peut disparaître : on retient l'item AVANT

      // Case SPÉCIALISÉE du feu (spec feu-station) : la SORTIE n'accepte que des cuits, le combustible
      // que du bois, l'ENTRÉE que ce qui s'y cuit. Le filtre borne le DÉPÔT vers une zone.
      if (to.side === 'container' && structure && to.zone && !fireZoneAccepts(structure, to.zone, item)) {
        return reject('ça ne va pas dans ce slot')
      }
      // VERROU DE CONSOMMATION (spec feu-station) : l'unité EN COURS (bûche qui brûle, aliment qui
      // cuit) ne quitte pas sa case. Une pile se déplace de `count − verrou` — on PLAFONNE, et on ne
      // refuse que si RIEN n'est mobile.
      if (from.side === 'container' && structure && from.zone) {
        const movable = src.count - fireSlotLocked(structure, from.zone, from.slot)
        if (movable <= 0) return reject('en cours de consommation')
        if (count > movable) count = movable
      }

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

      // Le don de nourriture au grenier d'un AUTRE village (spec alignement R11) : les VRAIS coffres
      // SEULEMENT (pas les zones techniques d'un feu). Sur la quantité RÉELLEMENT déposée.
      if (to.side === 'container' && structure && to.zone === undefined) {
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

    /**
     * JE JETTE CE QUE JE TIENS (spec chasse C18). Une unité de la case active
     * tombe au sol. Ce geste, et lui seul, rend exécutables l'appât, le jet de
     * viande à une meute et l'allègement du porteur en fuite.
     */
    case 'drop_held': {
      const held = heldSlot(actor)
      if (held === null) return reject('rien en main')
      const item = held.item

      poserAuSol(state, actor.x, actor.y, item, 1, niveauDuCorps(state.map, actor))

      held.count -= 1
      if (held.count <= 0) actor.inventory[actor.activeSlot] = null
      emitEvent(state, { type: 'item_dropped', tick: state.tick, entityId: actorId, item, x: actor.x, y: actor.y })
      return
    }

    /** JE RAMASSE une pile au sol — à l'unité, comme on l'a jetée. */
    case 'pick_up': {
      const pile = state.groundItems.find((p) => p.id === action.pileId)
      if (!pile) return reject('rien à ramasser')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, pile.x, pile.y) > range * range) return reject('trop loin')
      // Une pile gît sur SON plancher (E-R22) : on ne la ramasse pas à travers la roche (E-R5) —
      // ni depuis le plateau ce qui est au sol, ni depuis le sol ce qu'on a lâché là-haut.
      if (!atteignableEntreEtages(state.map, actor.x, actor.y, niveauDuCorps(state.map, actor), pile.x, pile.y, niveauDuCorps(state.map, pile))) {
        return reject('trop loin')
      }

      // `addItems` rend ce qui N'A PAS tenu (le reste), pas ce qui est entré :
      // ce qui rentre est donc la différence. Un sac plein ne fait pas
      // disparaître la pile — elle reste au sol, entière.
      const leftover = addItems(actor.inventory, { [pile.item]: pile.count })
      const taken = pile.count - (leftover[pile.item] ?? 0)
      if (taken <= 0) return reject('sac plein')
      pile.count -= taken
      if (pile.count <= 0) state.groundItems = state.groundItems.filter((p) => p.id !== pile.id)
      return
    }
  }
}

function findStructure(state: SimState, id: number): Structure | undefined {
  return state.structures.find((s) => s.id === id)
}
