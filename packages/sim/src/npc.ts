/**
 * Les PNJ — villageois simulés (spec pnj, GDD §10 RimWorld-light).
 *
 * Principe fondateur (R1) : un PNJ agit par le MÊME pipeline d'actions
 * validées qu'un joueur — son IA émet des intentions, jamais des résultats.
 * IA à deux étages (R3) : besoins critiques (npc-needs.ts), sinon le
 * tableau du village (village-board.ts). Des seuils et une file — pas de GOAP.
 * Tout est déterministe : égalités départagées par id, aucun aléa.
 *
 * Ce module garde l'orchestration (advanceNpcs), l'exécution des tâches
 * (récolter, cuisiner, réparer), la navigation (followPath/setPathTo), la
 * milice (handleDefense) et le peuplement (spawnNpcsAround). Les besoins,
 * les expéditions et le tableau vivent dans leurs modules.
 */
import { isThreatTo } from './alignment'
import { BALANCE, COMBAT, NPC_AI, STRUCTURE_HP, TICK_DT_S, type NodeType } from './balance'
import { isBlockedAt, moveAvatar, type MoveWorld } from './collision'
import { startAttack } from './combat'
import { applyEconomyAction, type ResourceNode } from './economy'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { countOf, type ItemId } from './items'
import { handleHunger, handleSleep } from './npc-needs'
import { assignErrands, handleErrand } from './npc-errands'
import { findPath } from './pathfinding'
import { spawnEntity, type Entity, type SimState } from './sim'
import { TICKS_PER_CYCLE } from './time'
import { applyVillageAction, type TaskKind, type Village } from './village'
import { granaries, refreshBoard } from './village-board'

export interface NpcTaskState {
  id: number
  kind: TaskKind
  stage: 'work' | 'fetch' | 'craft' | 'store'
  nodeId: number | null
}

export interface Npc {
  entityId: number
  villageId: number
  homeId: number | null
  /** 0-100 — besoin de sommeil (spec R4). Sur le PNJ, pas sur l'Entity. */
  energy: number
  sleeping: boolean
  task: NpcTaskState | null
  path: { tx: number; ty: number }[]
  stuck: number
  /** Expédition en cours (spec alignement R13-R14) : raid de Meute ou don de Foyer. */
  errand: {
    kind: 'raid' | 'gift'
    targetVillageId: number
    stage: 'fetch' | 'go' | 'smash' | 'loot' | 'home'
  } | null
}

const TASK_DEFS: Record<
  Exclude<TaskKind, 'cook_stew' | 'repair'>,
  { nodeType: NodeType; item: ItemId; carry: number }
> = {
  gather_berries: { nodeType: 'berry_bush', item: 'berries', carry: BALANCE.NPC_CARRY_TARGETS.berries },
  gather_wood: { nodeType: 'tree', item: 'wood', carry: BALANCE.NPC_CARRY_TARGETS.wood },
  gather_fiber: { nodeType: 'fiber_plant', item: 'fiber', carry: BALANCE.NPC_CARRY_TARGETS.fiber },
}

const RANGE = BALANCE.INTERACT_RANGE - 0.2 // marge : on agit un peu en dedans de la portée
export const TICKS_PER_HOUR = TICKS_PER_CYCLE / 24

// ─── Aides ────────────────────────────────────────────────────────────────

function moveWorldFor(state: SimState, villageId: number): MoveWorld {
  return { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: villageId }
}

function nearestAliveNode(state: SimState, entity: Entity, type: NodeType): ResourceNode | undefined {
  let best: ResourceNode | undefined
  let bestD = Infinity
  for (const n of state.nodes) {
    if (n.type !== type || n.stock <= 0) continue
    const d = distSq(entity.x, entity.y, n.tx + 0.5, n.ty + 0.5)
    if (d < bestD || (d === bestD && best && n.id < best.id)) {
      best = n
      bestD = d
    }
  }
  return best
}

/** Fait suivre le chemin au PNJ. Retourne true s'il marche encore. */
export function followPath(state: SimState, npc: Npc, entity: Entity): boolean {
  const waypoint = npc.path[0]
  if (!waypoint) return false
  const wx = waypoint.tx + 0.5
  const wy = waypoint.ty + 0.5
  const dx = wx - entity.x
  const dy = wy - entity.y
  // Waypoints intermédiaires : rayon large (> pas par tick, sinon le PNJ
  // orbite sans jamais « atteindre »). Dernier waypoint : rayon précis —
  // 0.2 > pas/2, donc l'oscillation converge toujours en ≤ 2 ticks.
  const radius = npc.path.length > 1 ? 0.45 : 0.2
  if (dx * dx + dy * dy < radius * radius) {
    npc.path.shift()
    return npc.path.length > 0
  }
  const sx = (dx > 0.05 ? 1 : dx < -0.05 ? -1 : 0) as -1 | 0 | 1
  const sy = (dy > 0.05 ? 1 : dy < -0.05 ? -1 : 0) as -1 | 0 | 1
  const speedScale = entity.hunger <= 0 ? BALANCE.HUNGER_SPEED_MALUS : 1
  const moved = moveAvatar(moveWorldFor(state, npc.villageId), entity.x, entity.y, sx, sy, TICK_DT_S, speedScale)
  if (moved.x === entity.x && moved.y === entity.y) {
    npc.stuck += 1
    if (npc.stuck > 2 * BALANCE.TICK_RATE_HZ) {
      npc.path = [] // recalcul au prochain tick de décision
      npc.stuck = 0
    }
  } else {
    npc.stuck = 0
  }
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
  return true
}

/** Calcule un chemin vers une tuile (ou une voisine marchable si elle bloque). */
export function setPathTo(state: SimState, npc: Npc, entity: Entity, tx: number, ty: number): boolean {
  const world = moveWorldFor(state, npc.villageId)
  const from = { tx: Math.floor(entity.x), ty: Math.floor(entity.y) }
  const targets = isBlockedAt(world, tx, ty)
    ? ([
        [tx + 1, ty],
        [tx - 1, ty],
        [tx, ty + 1],
        [tx, ty - 1],
      ] as const)
        .filter(([nx, ny]) => !isBlockedAt(world, nx, ny))
        .sort((a, b) => distSq(a[0] + 0.5, a[1] + 0.5, entity.x, entity.y) - distSq(b[0] + 0.5, b[1] + 0.5, entity.x, entity.y))
    : [[tx, ty] as const]
  for (const [gx, gy] of targets) {
    const path = findPath(world, from, { tx: gx, ty: gy })
    if (path) {
      npc.path = path
      return true
    }
  }
  npc.path = []
  return false
}

export function near(entity: Entity, tx: number, ty: number, r = RANGE): boolean {
  return distSq(entity.x, entity.y, tx + 0.5, ty + 0.5) <= r * r
}

// ─── Réclamer/rendre les tâches du tableau (spec R5) ─────────────────────

function claimTask(village: Village, npc: Npc): void {
  const free = village.tasks
    .filter((t) => t.claimedBy === null)
    .sort((a, b) => b.priority - a.priority || a.id - b.id)[0]
  if (!free) return
  free.claimedBy = npc.entityId
  const stage = free.kind === 'cook_stew' || free.kind === 'repair' ? 'fetch' : 'work'
  npc.task = { id: free.id, kind: free.kind, stage, nodeId: null }
  npc.path = []
}

export function dropTask(village: Village, npc: Npc, completed: boolean): void {
  if (npc.task) {
    if (completed) village.tasks = village.tasks.filter((t) => t.id !== npc.task!.id)
    else {
      const t = village.tasks.find((task) => task.id === npc.task!.id)
      if (t) t.claimedBy = null
    }
  }
  npc.task = null
  npc.path = []
}

// ─── Exécution des tâches ─────────────────────────────────────────────────

function canAct(state: SimState, entity: Entity): boolean {
  return state.tick >= entity.cooldownUntil
}

function executeGather(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  const def = TASK_DEFS[task.kind as Exclude<TaskKind, 'cook_stew' | 'repair'>]

  if (task.stage === 'work') {
    if (countOf(entity.inventory, def.item) >= def.carry) {
      task.stage = 'store'
      npc.path = []
      return
    }
    let node = task.nodeId !== null ? state.nodes.find((n) => n.id === task.nodeId) : undefined
    if (!node || node.stock <= 0) {
      node = nearestAliveNode(state, entity, def.nodeType)
      if (!node) {
        // Rien à récolter dans le monde : si on porte déjà quelque chose, on le range.
        if (countOf(entity.inventory, def.item) > 0) task.stage = 'store'
        else dropTask(village, npc, false)
        return
      }
      task.nodeId = node.id
      npc.path = []
    }
    if (near(entity, node.tx, node.ty)) {
      if (canAct(state, entity)) applyEconomyAction(state, entity.id, { type: 'harvest', nodeId: node.id })
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, node.tx, node.ty)) {
      dropTask(village, npc, false) // inaccessible
      return
    }
    followPath(state, npc, entity)
    return
  }

  // stage 'store' : déposer au grenier (en gardant de quoi manger, spec R6).
  const chest = granaries(state, village.id)[0]
  if (!chest) {
    dropTask(village, npc, false)
    return
  }
  if (near(entity, chest.tx, chest.ty)) {
    const keep = def.item === 'berries' ? NPC_AI.FOOD_KEEP : 0
    const count = countOf(entity.inventory, def.item) - keep
    if (count > 0) {
      applyVillageAction(state, entity.id, { type: 'deposit', structureId: chest.id, item: def.item, count })
    }
    dropTask(village, npc, true)
    return
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) {
    dropTask(village, npc, false)
    return
  }
  followPath(state, npc, entity)
}

function executeCook(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  const chest = granaries(state, village.id)[0]
  if (!chest) return dropTask(village, npc, false)

  if (task.stage === 'fetch') {
    const needBerries = 4 - countOf(entity.inventory, 'berries')
    const needFiber = 1 - countOf(entity.inventory, 'fiber')
    if (needBerries <= 0 && needFiber <= 0) {
      task.stage = 'craft'
      npc.path = []
      return
    }
    if (near(entity, chest.tx, chest.ty)) {
      const inv = chest.inventory ?? {}
      if (needBerries > 0 && countOf(inv, 'berries') >= needBerries) {
        applyVillageAction(state, entity.id, { type: 'withdraw', structureId: chest.id, item: 'berries', count: needBerries })
      } else if (needFiber > 0 && countOf(inv, 'fiber') >= needFiber) {
        applyVillageAction(state, entity.id, { type: 'withdraw', structureId: chest.id, item: 'fiber', count: needFiber })
      } else {
        dropTask(village, npc, false) // le grenier s'est vidé entre-temps
      }
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }

  if (task.stage === 'craft') {
    if (countOf(entity.inventory, 'stew') > 0) {
      task.stage = 'store'
      npc.path = []
      return
    }
    const fire = state.structures.find((s) => s.type === 'fire' && s.villageId === village.id)
    if (!fire) return dropTask(village, npc, false)
    if (near(entity, fire.tx, fire.ty)) {
      if (canAct(state, entity)) applyEconomyAction(state, entity.id, { type: 'craft', recipeId: 'stew' })
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, fire.tx, fire.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }

  // stage 'store'
  if (near(entity, chest.tx, chest.ty)) {
    const count = countOf(entity.inventory, 'stew')
    if (count > 0) {
      applyVillageAction(state, entity.id, { type: 'deposit', structureId: chest.id, item: 'stew', count })
    }
    dropTask(village, npc, true)
    return
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return dropTask(village, npc, false)
  followPath(state, npc, entity)
}

/** Réparer : chercher du bois au grenier si besoin, puis marteler (spec événements R2). */
function executeRepair(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  const target = state.structures.find((s) => s.id === village.tasks.find((t) => t.id === task.id)?.structureId)
  if (!target || target.hp >= STRUCTURE_HP[target.type]) return dropTask(village, npc, true)

  if (task.stage === 'fetch' && countOf(entity.inventory, 'wood') === 0) {
    const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? {}, 'wood') > 0)
    if (!chest) return dropTask(village, npc, false) // pas de bois : on abandonne
    if (near(entity, chest.tx, chest.ty)) {
      applyVillageAction(state, entity.id, {
        type: 'withdraw',
        structureId: chest.id,
        item: 'wood',
        count: Math.min(NPC_AI.REPAIR_WOOD_WITHDRAW, countOf(chest.inventory ?? {}, 'wood')),
      })
      task.stage = 'work'
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }
  task.stage = 'work'

  if (near(entity, target.tx, target.ty)) {
    if (state.tick >= entity.cooldownUntil) {
      applyVillageAction(state, entity.id, { type: 'repair', structureId: target.id })
      if (countOf(entity.inventory, 'wood') === 0) task.stage = 'fetch'
    }
    return
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, target.tx, target.ty)) return dropTask(village, npc, false)
  followPath(state, npc, entity)
}

// ─── La milice émergente (spec combat R13) ────────────────────────────────

/** Une menace (monstre ou raider agresseur) près du Feu ? Tout PNJ la combat. */
function handleDefense(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
  let threat: Entity | undefined
  let bestD = COMBAT.DEFEND_RADIUS * COMBAT.DEFEND_RADIUS
  for (const e of state.entities) {
    if (e.id === entity.id || e.hp <= 0 || !isThreatTo(state, e.id, village)) continue
    const d = distSq(e.x, e.y, village.fireTx + 0.5, village.fireTy + 0.5)
    if (d < bestD) {
      threat = e
      bestD = d
    }
  }
  if (!threat) return false

  npc.sleeping = false // l'alarme silencieuse : on se lève
  if (entity.windup) return true
  const d2 = distSq(entity.x, entity.y, threat.x, threat.y)
  if (d2 <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
    if (state.tick >= entity.cooldownUntil && entity.stamina >= COMBAT.ATTACK_STAMINA) {
      if (startAttack(state, entity, threat.x - entity.x, threat.y - entity.y)) {
        entity.cooldownUntil = state.tick + COMBAT.ATTACK_COOLDOWN_TICKS
      }
    }
    return true
  }
  // Marche gloutonne vers la menace (le village est un terrain ouvert).
  const sx = (threat.x - entity.x > 0.2 ? 1 : threat.x - entity.x < -0.2 ? -1 : 0) as -1 | 0 | 1
  const sy = (threat.y - entity.y > 0.2 ? 1 : threat.y - entity.y < -0.2 ? -1 : 0) as -1 | 0 | 1
  const moved = moveAvatar(moveWorldFor(state, npc.villageId), entity.x, entity.y, sx, sy, TICK_DT_S)
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
  return true
}

// ─── La passe PNJ du tick ─────────────────────────────────────────────────

export function advanceNpcs(state: SimState): void {
  // Arrivée des PNJ d'accueil (spec R9) + rafraîchissement des tableaux.
  for (const village of state.villages) {
    if (!village.npcsArrived) {
      village.npcsArrived = true
      spawnNpcsAround(state, village, BALANCE.NPC_PER_VILLAGE)
    }
    if (state.tick % BALANCE.BOARD_REFRESH_TICKS === 0) refreshBoard(state, village)
  }
  assignErrands(state)

  for (const npc of state.npcs) {
    const entity = state.entities.find((e) => e.id === npc.entityId)
    const village = state.villages.find((v) => v.id === npc.villageId)
    if (!entity || !village) continue

    if (!npc.sleeping) {
      npc.energy = Math.max(0, npc.energy - BALANCE.ENERGY_AWAKE_PER_CYCLE_HOUR / TICKS_PER_HOUR)
    }
    // Assignation de maison : première maison libre du village (spec R7).
    if (npc.homeId === null) {
      const taken = new Set(state.npcs.map((n) => n.homeId))
      const home = state.structures.find((s) => s.type === 'house' && s.villageId === village.id && !taken.has(s.id))
      if (home) npc.homeId = home.id
    }

    // La défense du village prime sur tout (spec combat R13).
    if (handleDefense(state, village, npc, entity)) continue
    // Puis l'expédition en cours (raid ou don, spec alignement R13-R14).
    if (handleErrand(state, village, npc, entity)) continue
    if (handleSleep(state, npc, entity)) continue
    if (handleHunger(state, village, npc, entity)) continue

    if (!npc.task) {
      claimTask(village, npc)
      if (!npc.task) continue // rien à faire : oisif
    }
    if (npc.task.kind === 'cook_stew') executeCook(state, village, npc, entity)
    else if (npc.task.kind === 'repair') executeRepair(state, village, npc, entity)
    else executeGather(state, village, npc, entity)
  }
}

// ─── Peuplement ───────────────────────────────────────────────────────────

/** Anneau de tuiles autour du Feu où poser les PNJ d'accueil (spec R9). */
export const RING_OFFSETS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
  [2, 2],
  [-2, -2],
] as const

export function spawnNpcsAround(state: SimState, village: Village, count: number): void {
  const world = moveWorldFor(state, village.id)
  let spawned = 0
  for (const [dx, dy] of RING_OFFSETS) {
    if (spawned >= count) break
    const tx = village.fireTx + dx
    const ty = village.fireTy + dy
    if (isBlockedAt(world, tx, ty)) continue
    const id = spawnEntity(state, tx + 0.5, ty + 0.5)
    village.memberIds.push(id)
    emitEvent(state, { type: 'member_joined', tick: state.tick, villageId: village.id, entityId: id })
    state.npcs.push({
      entityId: id,
      villageId: village.id,
      homeId: null,
      energy: 100,
      sleeping: false,
      task: null,
      path: [],
      stuck: 0,
      errand: null,
    })
    spawned += 1
  }
}
