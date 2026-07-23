/**
 * LES RÉFUGIÉS (V2-25, GDD §520) — « l'événement d'alignement par excellence, et la seule
 * source de PNJ supplémentaires hors paliers du Feu ».
 *
 * Un groupe de survivants s'arrête sur une route. On peut les RECRUTER (ils rejoignent son
 * village en PNJ — de la population), les NOURRIR (on leur offre des vivres — chaleur/Foyer),
 * les REFOULER (ne rien faire : ils repartent) ou les DÉPOUILLER (prendre leur maigre bien —
 * prédation/Meute). Les villages se les disputent : c'est le générateur d'alignement le plus
 * pur du jeu.
 *
 * MODÈLE : un OBJET D'ÉTAT (`RefugeeGroup`), comme le convoi ou l'évacuation — pas un PNJ qui
 * pense. Il stationne, puis s'en va. L'ARRIVÉE est POSITIONNÉE PAR `hash2` du jour (comme la
 * dérive des nœuds) : elle ne tire RIEN dans `state.rng`, donc ne décale pas le flux seedé et
 * ne casse aucun test de déterminisme sans rapport (invariant §2, leçon RNG connue).
 */
import { REFUGEES, SLOTS, TERRAIN_ROAD } from './balance'
import { recordAct } from './alignment'
import { emitEvent } from './events'
import { inventoryOf, pourInto, removeItems } from './items'
import { hash2 } from './noise'
import { spawnNpcsAround } from './npc'
import { seasonDayAtTick } from './time'
import type { Entity, RefugeeGroup, SimState } from './sim'
import type { Village } from './village'

const REFUGEE_SALT = 0x9e37f1c5

/**
 * Cadence d'ARRIVÉE (un groupe tous les `PERIOD_DAYS` jours, une fois par jour-clé) + DÉPART
 * des groupes que personne n'a pris en charge (refoulés). Appelée chaque tick par `step`.
 */
export function advanceRefugees(state: SimState): void {
  if (!state.worldEvents) return
  const day = seasonDayAtTick(state.tick, state.calendarScale)
  if (day > 0 && day !== state.lastRefugeeDay && day % REFUGEES.PERIOD_DAYS === 0) {
    state.lastRefugeeDay = day
    spawnRefugees(state, day)
  }
  for (const g of state.refugeeGroups) {
    if (state.tick >= g.until) emitEvent(state, { type: 'refugees_left', tick: state.tick, groupId: g.id })
  }
  state.refugeeGroups = state.refugeeGroups.filter((g) => state.tick < g.until)
}

/** Pose un groupe sur une route, position dérivée du JOUR (`hash2`) — déterministe, sans RNG. */
function spawnRefugees(state: SimState, day: number): void {
  const roadTiles: number[] = []
  for (let i = 0; i < state.map.terrain.length; i++) {
    if (state.map.terrain[i] === TERRAIN_ROAD) roadTiles.push(i)
  }
  if (roadTiles.length === 0) return
  const key = roadTiles[Math.floor(hash2(day, 0, REFUGEE_SALT) * roadTiles.length)]!
  const tx = key % state.map.width
  const ty = Math.floor(key / state.map.width)
  const group: RefugeeGroup = {
    id: state.nextRefugeeGroupId,
    tx,
    ty,
    count: REFUGEES.COUNT,
    inventory: inventoryOf(SLOTS.CHEST, REFUGEES.LOOT),
    until: state.tick + REFUGEES.STAY_TICKS,
  }
  state.refugeeGroups.push(group)
  state.nextRefugeeGroupId += 1
  emitEvent(state, { type: 'refugees_arrived', tick: state.tick, groupId: group.id, tx, ty, count: group.count })
}

function removeGroup(state: SimState, groupId: number): void {
  state.refugeeGroups = state.refugeeGroups.filter((g) => g.id !== groupId)
}

// ─── LES VERBES (appelés par le dispatch d'actions de `village.ts`) ──────────────────────

/**
 * RECRUTER — les survivants rejoignent le village en PNJ (la seule source de population hors
 * paliers du Feu, §520). Chaleur (Foyer). Le groupe s'en va, absorbé.
 */
export function recruitRefugees(state: SimState, entity: Entity, group: RefugeeGroup, village: Village): void {
  spawnNpcsAround(state, village, group.count)
  recordAct(state, entity.id, REFUGEES.WARMTH_SAVE)
  emitEvent(state, {
    type: 'refugees_recruited',
    tick: state.tick,
    groupId: group.id,
    villageId: village.id,
    byEntityId: entity.id,
    count: group.count,
  })
  removeGroup(state, group.id)
}

/** NOURRIR — on offre des vivres (chaleur/Foyer) sans les recruter. Échoue sans les vivres. */
export function feedRefugees(state: SimState, entity: Entity, group: RefugeeGroup): boolean {
  if (!removeItems(entity.inventory, REFUGEES.FEED_COST)) return false
  recordAct(state, entity.id, REFUGEES.WARMTH_SAVE)
  emitEvent(state, { type: 'refugees_fed', tick: state.tick, groupId: group.id, byEntityId: entity.id })
  return true
}

/** DÉPOUILLER — on prend leur maigre bien : prédation (Meute). Le groupe s'en va, vidé. */
export function robRefugees(state: SimState, entity: Entity, group: RefugeeGroup): void {
  pourInto(group.inventory, entity.inventory)
  recordAct(state, entity.id, REFUGEES.WARMTH_ROB)
  emitEvent(state, { type: 'refugees_robbed', tick: state.tick, groupId: group.id, byEntityId: entity.id })
  removeGroup(state, group.id)
}
