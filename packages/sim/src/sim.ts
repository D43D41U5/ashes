/**
 * Noyau de la simulation : état + boucle de tick à pas fixe.
 *
 * Contrat de déterminisme : `step(state, inputs)` est une fonction pure du
 * point de vue de l'extérieur — même état + mêmes inputs = même état suivant,
 * sur n'importe quelle machine. Tout le multi, le replay log et les tests
 * headless reposent sur ce contrat.
 *
 * L'état est un objet JSON-sérialisable (pas de classes, pas de Map) pour
 * que snapshot = JSON.stringify et que le transport Worker/réseau soit
 * trivial.
 */
import { BALANCE, TERRAIN_GRASS, TICK_DT_S } from './balance'
import { moveAvatar } from './collision'
import { emitEvent, type SimEvent } from './events'
import type { Inventory } from './items'
import { createEmptyMap, type WorldMap } from './map'
import { rngNext } from './rng'
import { advanceTime } from './time'
import { applyAction, getVillageOf, type PlayerAction, type Structure, type Village } from './village'

export interface Entity {
  id: number
  /** Position du centre, en tuiles (déplacement continu, spec monde R5). */
  x: number
  y: number
  inventory: Inventory
}

export interface SimState {
  /** Numéro de tick — l'unique notion de temps dans /sim. */
  tick: number
  /** Seed d'origine, conservée pour l'en-tête du replay log. */
  seed: number
  /** État courant du PRNG (avance à chaque tirage). */
  rngState: number
  /** Jours de saison écoulés par jour réel (1 en multi, libre en Veillée/test). */
  calendarScale: number
  map: WorldMap
  nextEntityId: number
  entities: Entity[]
  villages: Village[]
  structures: Structure[]
  nextVillageId: number
  nextStructureId: number
  /** Buffer d'événements de domaine, drainé par l'hôte (voir events.ts). */
  events: SimEvent[]
}

export interface SimOptions {
  map?: WorldMap
  calendarScale?: number
}

/** Intention d'un avatar pour un tick : déplacement + au plus une action. */
export interface MoveInput {
  entityId: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  action?: PlayerAction
}

export function createSim(seed: number, options: SimOptions = {}): SimState {
  const state: SimState = {
    tick: 0,
    seed,
    rngState: seed >>> 0,
    calendarScale: options.calendarScale ?? BALANCE.DEFAULT_CALENDAR_SCALE,
    map: options.map ?? createEmptyMap(64, 64, TERRAIN_GRASS),
    nextEntityId: 1,
    entities: [],
    villages: [],
    structures: [],
    nextVillageId: 1,
    nextStructureId: 1,
    events: [],
  }
  // Le tick 0 est le début du jour 1, de l'acte I et d'un cycle de jour.
  emitEvent(state, { type: 'season_day_started', tick: 0, day: 1 })
  emitEvent(state, { type: 'act_started', tick: 0, act: 1 })
  emitEvent(state, { type: 'day_started', tick: 0 })
  return state
}

export function spawnEntity(state: SimState, x: number, y: number): number {
  const id = state.nextEntityId
  state.nextEntityId += 1
  state.entities.push({ id, x, y, inventory: {} })
  // Consomme un pas de PRNG : le spawn fait partie de l'histoire déterministe.
  state.rngState = rngNext(state.rngState)
  emitEvent(state, { type: 'entity_spawned', tick: state.tick, entityId: id, x, y })
  return id
}

/** Avance la simulation d'exactement un tick. Mute `state` en place. */
export function step(state: SimState, inputs: MoveInput[]): void {
  for (const input of inputs) {
    const entity = state.entities.find((e) => e.id === input.entityId)
    if (!entity) continue
    // L'action d'abord (un mur bâti ce tick bloque dès ce tick), le pas ensuite.
    if (input.action) applyAction(state, input.entityId, input.action)
    const world = {
      map: state.map,
      structures: state.structures,
      moverVillageId: getVillageOf(state, input.entityId)?.id ?? null,
    }
    const moved = moveAvatar(world, entity.x, entity.y, input.dx, input.dy, TICK_DT_S)
    entity.x = moved.x
    entity.y = moved.y
  }
  advanceTime(state)
}

/** Snapshot canonique — sert d'égalité d'état dans les tests et le replay. */
export function snapshot(state: SimState): string {
  return JSON.stringify(state)
}
