/**
 * Les PNJ — villageois simulés (spec pnj, GDD §10 RimWorld-light).
 *
 * Principe fondateur (R1) : un PNJ agit par le MÊME pipeline d'actions
 * validées qu'un joueur — son IA émet des intentions, jamais des résultats.
 * IA à deux étages (R3) : besoins critiques (manger, dormir), sinon le
 * tableau du village. Des seuils et une file — pas de GOAP.
 * Tout est déterministe : égalités départagées par id, aucun aléa.
 */
import { BALANCE, COMBAT, type NodeType } from './balance'
import { isBlockedAt, moveAvatar, type MoveWorld } from './collision'
import { startAttack } from './combat'
import { applyEconomyAction, type ResourceNode } from './economy'
import { countOf, type ItemId } from './items'
import { findPath } from './pathfinding'
import { spawnEntity, type Entity, type SimState } from './sim'
import { getGameTime, TICKS_PER_CYCLE } from './time'
import { applyVillageAction, type Structure, type TaskKind, type Village } from './village'

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
}

const TASK_DEFS: Record<
  Exclude<TaskKind, 'cook_stew'>,
  { nodeType: NodeType; item: ItemId; carry: number }
> = {
  gather_berries: { nodeType: 'berry_bush', item: 'berries', carry: BALANCE.NPC_CARRY_TARGETS.berries },
  gather_wood: { nodeType: 'tree', item: 'wood', carry: BALANCE.NPC_CARRY_TARGETS.wood },
  gather_fiber: { nodeType: 'fiber_plant', item: 'fiber', carry: BALANCE.NPC_CARRY_TARGETS.fiber },
}

const RANGE = BALANCE.INTERACT_RANGE - 0.2 // marge : on agit un peu en dedans de la portée
const TICKS_PER_HOUR = TICKS_PER_CYCLE / 24

// ─── Aides ────────────────────────────────────────────────────────────────

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function moveWorldFor(state: SimState, villageId: number): MoveWorld {
  return { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: villageId }
}

/** Les coffres-greniers du village : accès `village`, dans l'ordre des ids (spec R5-R6). */
function granaries(state: SimState, villageId: number): Structure[] {
  return state.structures.filter(
    (s) => s.type === 'chest' && s.villageId === villageId && s.access === 'village',
  )
}

function granaryStocks(state: SimState, villageId: number): Record<'berries' | 'stew' | 'wood' | 'fiber', number> {
  const stocks = { berries: 0, stew: 0, wood: 0, fiber: 0 }
  for (const chest of granaries(state, villageId)) {
    stocks.berries += countOf(chest.inventory ?? {}, 'berries')
    stocks.stew += countOf(chest.inventory ?? {}, 'stew')
    stocks.wood += countOf(chest.inventory ?? {}, 'wood')
    stocks.fiber += countOf(chest.inventory ?? {}, 'fiber')
  }
  return stocks
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
function followPath(state: SimState, npc: Npc, entity: Entity): boolean {
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
  const moved = moveAvatar(moveWorldFor(state, npc.villageId), entity.x, entity.y, sx, sy, 1 / BALANCE.TICK_RATE_HZ, speedScale)
  if (moved.x === entity.x && moved.y === entity.y) {
    npc.stuck += 1
    if (npc.stuck > 24) {
      npc.path = [] // recalcul au prochain tick de décision
      npc.stuck = 0
    }
  } else {
    npc.stuck = 0
  }
  entity.x = moved.x
  entity.y = moved.y
  return true
}

/** Calcule un chemin vers une tuile (ou une voisine marchable si elle bloque). */
function setPathTo(state: SimState, npc: Npc, entity: Entity, tx: number, ty: number): boolean {
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

function near(entity: Entity, tx: number, ty: number, r = RANGE): boolean {
  return distSq(entity.x, entity.y, tx + 0.5, ty + 0.5) <= r * r
}

// ─── Le tableau du village (spec R5) ─────────────────────────────────────

function refreshBoard(state: SimState, village: Village): void {
  if (granaries(state, village.id).length === 0) {
    village.tasks = village.tasks.filter((t) => t.claimedBy !== null)
    return
  }
  const stocks = granaryStocks(state, village.id)
  const foodScore = stocks.berries + stocks.stew * 3

  const wanted: Partial<Record<TaskKind, number>> = {
    gather_berries: foodScore < BALANCE.VILLAGE_FOOD_TARGET ? 2 : 0,
    gather_wood: stocks.wood < BALANCE.VILLAGE_WOOD_TARGET ? 1 : 0,
    gather_fiber: stocks.fiber < 2 ? 1 : 0,
    cook_stew:
      stocks.stew < BALANCE.VILLAGE_STEW_TARGET && stocks.berries >= 5 && stocks.fiber >= 1 ? 1 : 0,
  }
  const priorities: Record<TaskKind, number> = {
    cook_stew: 3,
    gather_berries: 2,
    gather_fiber: 2,
    gather_wood: 1,
  }

  for (const kind of Object.keys(wanted) as TaskKind[]) {
    const want = wanted[kind] ?? 0
    const existing = village.tasks.filter((t) => t.kind === kind)
    for (let i = existing.length; i < want; i++) {
      village.tasks.push({ id: village.nextTaskId, kind, priority: priorities[kind], claimedBy: null })
      village.nextTaskId += 1
    }
    // On retire l'excédent NON réclamé (celui qui travaille finit son geste).
    let excess = existing.length - want
    if (excess > 0) {
      village.tasks = village.tasks.filter((t) => {
        if (t.kind === kind && t.claimedBy === null && excess > 0) {
          excess -= 1
          return false
        }
        return true
      })
    }
  }
}

function claimTask(village: Village, npc: Npc): void {
  const free = village.tasks
    .filter((t) => t.claimedBy === null)
    .sort((a, b) => b.priority - a.priority || a.id - b.id)[0]
  if (!free) return
  free.claimedBy = npc.entityId
  npc.task = { id: free.id, kind: free.kind, stage: free.kind === 'cook_stew' ? 'fetch' : 'work', nodeId: null }
  npc.path = []
}

function dropTask(village: Village, npc: Npc, completed: boolean): void {
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
  const def = TASK_DEFS[task.kind as Exclude<TaskKind, 'cook_stew'>]

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
    const keep = def.item === 'berries' ? 2 : 0
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

// ─── La milice émergente (spec combat R13) ────────────────────────────────

/** Un monstre menace-t-il le village ? Si oui, tout PNJ le combat. */
function handleDefense(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
  let threat: Entity | undefined
  let bestD = COMBAT.DEFEND_RADIUS * COMBAT.DEFEND_RADIUS
  for (const monster of state.monsters) {
    const m = state.entities.find((e) => e.id === monster.entityId)
    if (!m) continue
    const d = distSq(m.x, m.y, village.fireTx + 0.5, village.fireTy + 0.5)
    if (d < bestD) {
      threat = m
      bestD = d
    }
  }
  if (!threat) return false

  npc.sleeping = false // l'alarme silencieuse : on se lève
  if (entity.windup) return true
  const d2 = distSq(entity.x, entity.y, threat.x, threat.y)
  if (d2 <= 1.2 * 1.2) {
    if (state.tick >= entity.cooldownUntil && entity.stamina >= COMBAT.ATTACK_STAMINA) {
      startAttack(state, entity, threat.x - entity.x, threat.y - entity.y)
      entity.cooldownUntil = state.tick + 12
    }
    return true
  }
  // Marche gloutonne vers la menace (le village est un terrain ouvert).
  const sx = (threat.x - entity.x > 0.2 ? 1 : threat.x - entity.x < -0.2 ? -1 : 0) as -1 | 0 | 1
  const sy = (threat.y - entity.y > 0.2 ? 1 : threat.y - entity.y < -0.2 ? -1 : 0) as -1 | 0 | 1
  const moved = moveAvatar(moveWorldFor(state, npc.villageId), entity.x, entity.y, sx, sy, 1 / BALANCE.TICK_RATE_HZ)
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
  return true
}

// ─── Les besoins (spec R3, étage 1) ───────────────────────────────────────

/** Retourne true si le besoin a consommé le tick. */
function handleHunger(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
  if (entity.hunger >= BALANCE.NPC_HUNGER_EAT_THRESHOLD) return false
  if (countOf(entity.inventory, 'stew') > 0) {
    applyEconomyAction(state, entity.id, { type: 'eat', item: 'stew' })
    return true
  }
  if (countOf(entity.inventory, 'berries') > 0) {
    applyEconomyAction(state, entity.id, { type: 'eat', item: 'berries' })
    return true
  }
  // Aller retirer au grenier.
  const chest = granaries(state, village.id).find(
    (c) => countOf(c.inventory ?? {}, 'stew') > 0 || countOf(c.inventory ?? {}, 'berries') > 0,
  )
  if (!chest) return false // rien à manger : on continue à travailler (pas de deadlock)
  if (near(entity, chest.tx, chest.ty)) {
    const inv = chest.inventory ?? {}
    if (countOf(inv, 'stew') > 0) {
      applyVillageAction(state, entity.id, { type: 'withdraw', structureId: chest.id, item: 'stew', count: 1 })
    } else {
      applyVillageAction(state, entity.id, {
        type: 'withdraw',
        structureId: chest.id,
        item: 'berries',
        count: Math.min(3, countOf(inv, 'berries')),
      })
    }
    return true
  }
  if (npc.path.length === 0) setPathTo(state, npc, entity, chest.tx, chest.ty)
  followPath(state, npc, entity)
  return true
}

function handleSleep(state: SimState, npc: Npc, entity: Entity): boolean {
  const night = getGameTime(state).isNight
  if (npc.sleeping) {
    const home = npc.homeId !== null ? state.structures.find((s) => s.id === npc.homeId) : undefined
    const atHome = home !== undefined && near(entity, home.tx, home.ty, 1.0)
    const perHour = atHome ? BALANCE.SLEEP_RECOVERY_HOME_PER_HOUR : BALANCE.SLEEP_RECOVERY_FIRE_PER_HOUR
    npc.energy = Math.min(100, npc.energy + perHour / TICKS_PER_HOUR)
    if (!night) npc.sleeping = false
    else return true
  }
  if (night && npc.energy < BALANCE.NPC_ENERGY_SLEEP_THRESHOLD) {
    const home = npc.homeId !== null ? state.structures.find((s) => s.id === npc.homeId) : undefined
    const village = state.villages.find((v) => v.id === npc.villageId)
    const target = home ?? state.structures.find((s) => s.type === 'fire' && s.villageId === village?.id)
    if (!target) return false
    if (near(entity, target.tx, target.ty, 1.0)) {
      npc.sleeping = true
      npc.path = []
      return true
    }
    if (npc.path.length === 0) setPathTo(state, npc, entity, target.tx, target.ty)
    followPath(state, npc, entity)
    return true
  }
  return false
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
    if (handleSleep(state, npc, entity)) continue
    if (handleHunger(state, village, npc, entity)) continue

    if (!npc.task) {
      claimTask(village, npc)
      if (!npc.task) continue // rien à faire : oisif
    }
    if (npc.task.kind === 'cook_stew') executeCook(state, village, npc, entity)
    else executeGather(state, village, npc, entity)
  }
}

// ─── Peuplement ───────────────────────────────────────────────────────────

const RING_OFFSETS = [
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

function spawnNpcsAround(state: SimState, village: Village, count: number): void {
  const world = moveWorldFor(state, village.id)
  let spawned = 0
  for (const [dx, dy] of RING_OFFSETS) {
    if (spawned >= count) break
    const tx = village.fireTx + dx
    const ty = village.fireTy + dy
    if (isBlockedAt(world, tx, ty)) continue
    const id = spawnEntity(state, tx + 0.5, ty + 0.5)
    village.memberIds.push(id)
    state.npcs.push({
      entityId: id,
      villageId: village.id,
      homeId: null,
      energy: 100,
      sleeping: false,
      task: null,
      path: [],
      stuck: 0,
    })
    spawned += 1
  }
}

/**
 * Crée un village 100 % PNJ complet (spec R10) : Feu, grenier approvisionné,
 * maisons et villageois. L'outil du mode Veillée, des tests et du peuplement.
 */
export function foundNpcVillage(state: SimState, tx: number, ty: number, count: number): Village {
  // Le monde-gen a le droit de faire place nette.
  const reserved = [[0, 0], [0, -2], ...RING_OFFSETS.slice(0, count + 2)].map(([dx, dy]) => [tx + dx, ty + dy])
  const houseSpots = ([[-3, 0], [3, 0], [-3, 2], [3, 2], [0, 3], [0, -3]] as const).slice(0, count)
  reserved.push(...houseSpots.map(([dx, dy]) => [tx + dx, ty + dy]))
  state.nodes = state.nodes.filter((n) => !reserved.some(([rx, ry]) => n.tx === rx && n.ty === ry))

  const villageId = state.nextVillageId
  state.nextVillageId += 1
  const village: Village = {
    id: villageId,
    chiefId: 0, // pas de chef humain — le village s'appartient
    memberIds: [],
    fireTx: tx,
    fireTy: ty,
    tasks: [],
    nextTaskId: 1,
    npcsArrived: true, // on peuple nous-mêmes
  }
  state.villages.push(village)

  const addStructure = (type: Structure['type'], sx: number, sy: number, inventory?: Structure['inventory']): Structure => {
    const s: Structure = {
      id: state.nextStructureId,
      type,
      tx: sx,
      ty: sy,
      villageId,
      ownerId: 0,
      access: 'village',
      ...(inventory ? { inventory } : {}),
    }
    state.nextStructureId += 1
    state.structures.push(s)
    return s
  }

  addStructure('fire', tx, ty)
  addStructure('chest', tx, ty - 2, { berries: 10, wood: 10, fiber: 2 })
  for (const [dx, dy] of houseSpots) addStructure('house', tx + dx, ty + dy)
  spawnNpcsAround(state, village, count)
  // Un village PNJ naît armé : chacun sa lance (spec combat R13).
  for (const npc of state.npcs) {
    if (npc.villageId !== villageId) continue
    const entity = state.entities.find((e) => e.id === npc.entityId)
    if (entity) entity.inventory.spear = 1
  }
  return village
}
