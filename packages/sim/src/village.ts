/**
 * Le village — Feu, structures, propriété, actions (spec village).
 *
 * « Des serrures, pas des lois » (GDD §5) : le serveur fait respecter la
 * propriété et les permissions, les humains font la politique. Toute action
 * est validée ici, entièrement côté sim (portée, coût, permissions) — c'est
 * le début de la validation de vraisemblance anti-cheat (GDD §11). Une
 * action refusée émet `action_rejected` (feedback client, testabilité) ;
 * une action validée émet son événement de domaine.
 */
import { BALANCE, STRUCTURE_COSTS, TERRAINS } from './balance'
import { emitEvent } from './events'
import {
  addItems,
  countOf,
  hasItems,
  removeItems,
  type AccessLevel,
  type Inventory,
  type ItemId,
  type StructureType,
} from './items'
import { terrainAt, zoneAt } from './map'
import type { SimState } from './sim'

export interface Structure {
  id: number
  type: StructureType
  tx: number
  ty: number
  villageId: number
  /** Le bâtisseur. 0 = le village lui-même (le Feu). */
  ownerId: number
  access: AccessLevel
  /** Contenu, pour les structures-conteneurs (coffre). */
  inventory?: Inventory
}

export interface Village {
  id: number
  chiefId: number
  memberIds: number[]
  fireTx: number
  fireTy: number
}

export type VillageAction =
  | { type: 'light_fire' }
  | { type: 'build'; structure: Exclude<StructureType, 'fire'>; tx: number; ty: number }
  | { type: 'demolish'; structureId: number }
  | { type: 'deposit'; structureId: number; item: ItemId; count: number }
  | { type: 'withdraw'; structureId: number; item: ItemId; count: number }
  | { type: 'set_access'; structureId: number; access: AccessLevel }
  | { type: 'invite'; targetEntityId: number }
  | { type: 'banish'; targetEntityId: number }

/** Défauts d'accès (spec village R10) : le coffre est à moi, la porte au village. */
const DEFAULT_ACCESS: Record<StructureType, AccessLevel> = {
  fire: 'village',
  wall: 'village',
  door: 'village',
  chest: 'private',
  workshop: 'village',
  furnace: 'village',
}

export function structureAt(structures: Structure[], tx: number, ty: number): Structure | undefined {
  return structures.find((s) => s.tx === tx && s.ty === ty)
}

export function getVillageOf(state: SimState, entityId: number): Village | undefined {
  return state.villages.find((v) => v.memberIds.includes(entityId))
}

/** Une structure bloque-t-elle ce déplaceur ? (spec village R8) */
export function structureBlocks(s: Structure, moverVillageId: number | null): boolean {
  if (s.type === 'fire') return false
  if (s.type === 'door') return s.villageId !== moverVillageId
  return true
}

/** A-t-on accès à une structure ? La propriété prime sur tout (spec R10-R12). */
export function hasAccess(state: SimState, entityId: number, s: Structure): boolean {
  if (s.ownerId === entityId) return true
  if (s.access === 'public') return true
  if (s.access === 'village') return getVillageOf(state, entityId)?.id === s.villageId
  return false
}

/**
 * Dev/test uniquement — remplacé par la récolte en V4 (spec R3).
 * À appeler dans la phase de setup, qui est rejouée par le replay.
 */
export function grantItems(state: SimState, entityId: number, items: Inventory): void {
  const entity = state.entities.find((e) => e.id === entityId)
  if (entity) addItems(entity.inventory, items)
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

export function applyVillageAction(state: SimState, actorId: number, action: VillageAction): void {
  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return
  const reject = (reason: string): void => {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason })
  }

  switch (action.type) {
    case 'light_fire': {
      const tx = Math.floor(actor.x)
      const ty = Math.floor(actor.y)
      if (getVillageOf(state, actorId)) return reject('déjà membre d’un village')
      if (!hasItems(actor.inventory, STRUCTURE_COSTS.fire)) return reject('matériaux insuffisants')
      if (zoneAt(state.map, actor.x, actor.y)) return reject('les landmarks sont inconstructibles')
      if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) return reject('terrain inconstructible')
      if (structureAt(state.structures, tx, ty)) return reject('tuile occupée')
      const min = BALANCE.FIRE_MIN_DISTANCE
      if (state.villages.some((v) => distSq(v.fireTx, v.fireTy, tx, ty) < min * min)) {
        return reject('trop proche d’un autre Feu')
      }
      removeItems(actor.inventory, STRUCTURE_COSTS.fire)
      const villageId = state.nextVillageId
      state.nextVillageId += 1
      state.villages.push({ id: villageId, chiefId: actorId, memberIds: [actorId], fireTx: tx, fireTy: ty })
      addStructure(state, 'fire', tx, ty, villageId, 0)
      emitEvent(state, { type: 'village_founded', tick: state.tick, villageId, chiefId: actorId, tx, ty })
      return
    }

    case 'build': {
      const village = getVillageOf(state, actorId)
      if (!village) return reject('sans village — allumer un Feu d’abord')
      const { tx, ty } = action
      const radius = BALANCE.FIRE_BUILD_RADIUS
      if (distSq(village.fireTx, village.fireTy, tx, ty) > radius * radius) {
        return reject('hors du rayon du Feu')
      }
      if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) return reject('terrain inconstructible')
      if (structureAt(state.structures, tx, ty)) return reject('tuile occupée')
      if (!removeItems(actor.inventory, STRUCTURE_COSTS[action.structure])) {
        return reject('matériaux insuffisants')
      }
      addStructure(state, action.structure, tx, ty, village.id, actorId)
      return
    }

    case 'demolish': {
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s) return reject('structure inconnue')
      if (s.type === 'fire') return reject('un Feu ne s’éteint pas')
      const village = state.villages.find((v) => v.id === s.villageId)
      if (s.ownerId !== actorId && village?.chiefId !== actorId) {
        return reject('ni propriétaire ni Chef')
      }
      const refund: Inventory = {}
      const cost = STRUCTURE_COSTS[s.type]
      for (const item of Object.keys(cost) as ItemId[]) {
        const back = Math.floor((cost[item] ?? 0) * BALANCE.DEMOLISH_REFUND)
        if (back > 0) refund[item] = back
      }
      addItems(actor.inventory, refund)
      state.structures = state.structures.filter((st) => st.id !== s.id)
      emitEvent(state, { type: 'structure_removed', tick: state.tick, structureId: s.id })
      return
    }

    case 'deposit':
    case 'withdraw': {
      if (!Number.isInteger(action.count) || action.count <= 0) return reject('quantité invalide')
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s || s.inventory === undefined) return reject('pas un conteneur')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      if (!hasAccess(state, actorId, s)) return reject('accès refusé')
      const [from, to] =
        action.type === 'deposit' ? [actor.inventory, s.inventory] : [s.inventory, actor.inventory]
      if (countOf(from, action.item) < action.count) return reject('stock insuffisant')
      removeItems(from, { [action.item]: action.count })
      addItems(to, { [action.item]: action.count })
      return
    }

    case 'set_access': {
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s) return reject('structure inconnue')
      if (s.ownerId !== actorId) return reject('pas le propriétaire')
      s.access = action.access
      return
    }

    case 'invite': {
      const village = getVillageOf(state, actorId)
      if (!village || village.chiefId !== actorId) return reject('seul le Chef invite')
      const target = state.entities.find((e) => e.id === action.targetEntityId)
      if (!target) return reject('cible inconnue')
      if (getVillageOf(state, target.id)) return reject('déjà membre d’un village')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, target.x, target.y) > range * range) return reject('trop loin')
      village.memberIds.push(target.id)
      emitEvent(state, { type: 'member_joined', tick: state.tick, villageId: village.id, entityId: target.id })
      return
    }

    case 'banish': {
      const village = getVillageOf(state, actorId)
      if (!village || village.chiefId !== actorId) return reject('seul le Chef bannit')
      if (action.targetEntityId === village.chiefId) return reject('le Chef ne se bannit pas')
      if (!village.memberIds.includes(action.targetEntityId)) return reject('pas un membre')
      village.memberIds = village.memberIds.filter((id) => id !== action.targetEntityId)
      emitEvent(state, {
        type: 'member_banished',
        tick: state.tick,
        villageId: village.id,
        entityId: action.targetEntityId,
      })
      return
    }
  }
}

function addStructure(
  state: SimState,
  type: StructureType,
  tx: number,
  ty: number,
  villageId: number,
  ownerId: number,
): void {
  const id = state.nextStructureId
  state.nextStructureId += 1
  const structure: Structure = { id, type, tx, ty, villageId, ownerId, access: DEFAULT_ACCESS[type] }
  if (type === 'chest') structure.inventory = {}
  state.structures.push(structure)
  emitEvent(state, {
    type: 'structure_built',
    tick: state.tick,
    structureId: id,
    structure: type,
    villageId,
    ownerId,
    tx,
    ty,
  })
}
