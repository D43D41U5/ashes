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
import { BALANCE, COMBAT, TERRAIN_GRASS, TICK_DT_S } from './balance'
import { moveAvatar } from './collision'
import { advanceCombat, applyCombatAction, type CombatAction, type Corpse } from './combat'
import { advanceEconomy, applyEconomyAction, type EconomyAction, type ResourceNode } from './economy'
import { emitEvent, type SimEvent } from './events'
import type { Inventory, ItemId, SkillId } from './items'
import { createEmptyMap, type WorldMap } from './map'
import { advanceMonsters, type Monster } from './monsters'
import { rngNext } from './rng'
import { advanceNpcs, type Npc } from './npc'
import { advanceTime } from './time'
import { applyVillageAction, getVillageOf, type VillageAction, type Structure, type Village } from './village'

/** L'union des actions possibles dans un tick (village + économie + combat). */
export type PlayerAction = VillageAction | EconomyAction | CombatAction

export interface Entity {
  id: number
  /** Position du centre, en tuiles (déplacement continu, spec monde R5). */
  x: number
  y: number
  inventory: Inventory
  /** Jauge 0-100. À 0 : vitesse ÷2 (spec économie R7-R8). */
  hunger: number
  /** XP par métier (niveau dérivé — voir skillLevel). */
  skills: Partial<Record<SkillId, number>>
  /** Usure agrégée par type d'outil (spec économie R6). */
  wear: Partial<Record<ItemId, number>>
  /** Tick avant lequel récolte/craft sont refusés (rythme borné). */
  cooldownUntil: number
  /** Combat (spec combat R1-R7). */
  hp: number
  stamina: number
  wounds: { leg?: true; arm?: true; bleeding?: true }
  facing: { x: number; y: number }
  blocking: boolean
  /** A bougé ce tick (module la régén d'endurance). */
  moved: boolean
  exhaustedUntil: number
  windup?: { dx: number; dy: number; ticksLeft: number; damage?: number }
  /** Point de respawn hors village (position d'apparition). */
  homeX: number
  homeY: number
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
  nodes: ResourceNode[]
  npcs: Npc[]
  monsters: Monster[]
  corpses: Corpse[]
  nextCorpseId: number
  nextVillageId: number
  nextStructureId: number
  /** Buffer d'événements de domaine, drainé par l'hôte (voir events.ts). */
  events: SimEvent[]
}

export interface SimOptions {
  map?: WorldMap
  calendarScale?: number
  /** Nœuds de ressources — typiquement `generateNodes(map, seed)`. */
  nodes?: ResourceNode[]
}

/** Intention d'un avatar pour un tick : déplacement, postures, au plus une action. */
export interface MoveInput {
  entityId: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint?: boolean
  block?: boolean
  action?: PlayerAction
}

export function createSim(seed: number, options: SimOptions = {}): SimState {
  const state: SimState = {
    tick: 0,
    seed,
    rngState: seed >>> 0,
    calendarScale: options.calendarScale ?? BALANCE.DEFAULT_CALENDAR_SCALE,
    // Copies profondes (JSON — l'état est JSON-sérialisable par design) :
    // les options sont des ENTRÉES immuables. Les partager par référence
    // corromprait le replay log (bug attrapé par le test A7 — la sim live
    // mutait les nœuds du log, le replay partait d'arbres vides).
    map: options.map ? (JSON.parse(JSON.stringify(options.map)) as WorldMap) : createEmptyMap(64, 64, TERRAIN_GRASS),
    nextEntityId: 1,
    entities: [],
    villages: [],
    structures: [],
    nodes: options.nodes ? (JSON.parse(JSON.stringify(options.nodes)) as ResourceNode[]) : [],
    npcs: [],
    monsters: [],
    corpses: [],
    nextCorpseId: 1,
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
  state.entities.push({
    id,
    x,
    y,
    inventory: {},
    hunger: 100,
    skills: {},
    wear: {},
    cooldownUntil: 0,
    hp: 100,
    stamina: 100,
    wounds: {},
    facing: { x: 1, y: 0 },
    blocking: false,
    moved: false,
    exhaustedUntil: 0,
    homeX: x,
    homeY: y,
  })
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
    const action = input.action
    if (action) {
      if (action.type === 'harvest' || action.type === 'craft' || action.type === 'eat') {
        applyEconomyAction(state, input.entityId, action)
      } else if (action.type === 'attack' || action.type === 'bandage' || action.type === 'loot_corpse') {
        applyCombatAction(state, input.entityId, action)
      } else {
        applyVillageAction(state, input.entityId, action)
      }
    }

    // Postures (spec combat) : bloquer, viser, sprinter.
    entity.blocking = (input.block ?? false) && entity.stamina > 0
    if (input.dx !== 0 || input.dy !== 0) {
      const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy)
      entity.facing = { x: input.dx / len, y: input.dy / len }
    }

    if (entity.windup) {
      entity.moved = false
      continue // le wind-up immobilise (spec R4)
    }
    let speedScale = 1
    if (entity.hunger <= 0) speedScale *= BALANCE.HUNGER_SPEED_MALUS
    if (entity.wounds.leg) speedScale *= COMBAT.LEG_WOUND_SPEED
    if (entity.blocking) speedScale *= COMBAT.BLOCK_MOVE_FACTOR
    else if (input.sprint && entity.stamina > 0 && (input.dx !== 0 || input.dy !== 0)) {
      speedScale *= COMBAT.SPRINT_FACTOR
      entity.stamina = Math.max(0, entity.stamina - COMBAT.SPRINT_STAMINA_PER_S / BALANCE.TICK_RATE_HZ)
    }
    const world = {
      map: state.map,
      structures: state.structures,
      nodes: state.nodes,
      moverVillageId: getVillageOf(state, input.entityId)?.id ?? null,
    }
    const moved = moveAvatar(world, entity.x, entity.y, input.dx, input.dy, TICK_DT_S, speedScale)
    entity.moved = moved.x !== entity.x || moved.y !== entity.y
    entity.x = moved.x
    entity.y = moved.y
  }
  // Les PNJ agissent après les joueurs, puis les monstres, puis la résolution.
  advanceNpcs(state)
  advanceMonsters(state)
  advanceCombat(state)
  advanceTime(state)
  advanceEconomy(state)
}

/** Snapshot canonique — sert d'égalité d'état dans les tests et le replay. */
export function snapshot(state: SimState): string {
  return JSON.stringify(state)
}
