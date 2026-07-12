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
import {
  BALANCE,
  COMBAT,
  NODE_DEFS,
  NPC_AI,
  SLOTS,
  STRUCTURE_HP,
  TICK_DT_S,
  WEAPON_DAMAGE,
  WORLD_EVENTS,
  type NodeType,
} from './balance'
import { isBlockedAt, moveAvatar, type MoveWorld } from './collision'
import { startAttack } from './combat'
import { applyEconomyAction, toolYield, type ResourceNode } from './economy'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { countOf, freeRoomFor, type ItemId } from './items'
import { handleCold, handleHunger, handleSleep } from './npc-needs'
import { assignErrands, handleErrand } from './npc-errands'
import { findPath } from './pathfinding'
import { spawnEntity, type Entity, type SimState } from './sim'
import { TICKS_PER_CYCLE } from './time'
import { applyVillageAction, type TaskKind, type Village, type VillageAction } from './village'
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
  /** En cours de repli vers un feu à cause du froid (hystérésis, spec IA chaleur). */
  seekingWarmth: boolean
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

// ─── La main du PNJ (spec inventaire R8-R9) ───────────────────────────────
//
// L'objet TENU fait foi — pour tout le monde, PNJ compris : la sim ne fouille
// plus le sac. Mais un PNJ n'a pas de hotbar pour s'armer la main. Sans ces deux
// gardes il récolterait à mains nues sa hache dans le dos, et la milice
// affronterait les hordes au poing, sa lance de naissance (worldgen) au fond du
// sac : une économie et une défense qui s'effondrent EN SILENCE — aucun refus,
// aucun événement, juste des chiffres qui baissent. On ne change PAS la règle,
// on fait pour eux le geste que le joueur fait à la ceinture.

/**
 * Ramène une case dans la CEINTURE (seule région qui se tient en main, R7-R8) et
 * retourne son nouvel index. Un simple ÉCHANGE de cases : rien ne se crée, rien
 * ne se perd. Sans ça, une hache tombée en case 20 du grand sac d'un PNJ (40
 * cases) ne servirait jamais — il la porterait toute la saison sans pouvoir s'en
 * servir.
 */
function liftIntoBelt(entity: Entity, index: number): number {
  if (index < SLOTS.BELT) return index
  let dest = 0 // ceinture pleine : on troque, la case délogée part au sac
  for (let i = 0; i < SLOTS.BELT && i < entity.inventory.length; i++) {
    if (entity.inventory[i] === null) {
      dest = i
      break
    }
  }
  const displaced = entity.inventory[dest] ?? null
  entity.inventory[dest] = entity.inventory[index]!
  entity.inventory[index] = displaced
  return dest
}

/** Empoigne la meilleure case selon `score` (0 = inutile ici), sinon mains nues. */
function equipBest(entity: Entity, score: (item: ItemId) => number): void {
  let bestIndex = -1
  let bestScore = 0
  for (let i = 0; i < entity.inventory.length; i++) {
    const slot = entity.inventory[i]
    if (slot === null || slot === undefined) continue
    const s = score(slot.item)
    if (s > bestScore) {
      bestScore = s
      bestIndex = i // égalité : la première case gagne (déterminisme)
    }
  }
  entity.activeSlot = bestIndex < 0 ? -1 : liftIntoBelt(entity, bestIndex)
}

/** Le meilleur outil PORTÉ pour cette famille (le barème vient de `toolYield`). */
export function equipBestTool(entity: Entity, family: 'axe' | 'pickaxe' | null): void {
  equipBest(entity, (item) => toolYield(item, family) - 1) // 0 = ce n'est pas un outil d'ici
}

/** L'arme la plus dangereuse PORTÉE (le barème vient de `WEAPON_DAMAGE`). */
export function equipBestWeapon(entity: Entity): void {
  equipBest(entity, (item) => WEAPON_DAMAGE[item] ?? 0)
}

// ─── Les transferts du PNJ, MESURÉS (spec inventaire R11) ─────────────────
//
// Sacs et greniers sont bornés : un dépôt (grenier plein) ou un retrait (sac
// plein) peut ne déplacer AUCUNE unité. Une corvée qui ne regarde pas ce que le
// transfert a réellement bougé se retente au tick suivant, à l'identique, pour
// toujours : c'est le livelock. Tout appelant DOIT lire ce retour et lâcher sa
// tâche quand il vaut 0.

function measured(state: SimState, entity: Entity, action: VillageAction, item: ItemId): number {
  const before = countOf(entity.inventory, item)
  applyVillageAction(state, entity.id, action)
  return Math.abs(countOf(entity.inventory, item) - before)
}

/** Dépose au conteneur ; retourne ce qui a VRAIMENT quitté le sac (0 = plein). */
export function deposit(
  state: SimState,
  entity: Entity,
  structureId: number,
  item: ItemId,
  count: number,
): number {
  return measured(state, entity, { type: 'deposit', structureId, item, count }, item)
}

/** Retire du conteneur ; retourne ce qui est VRAIMENT entré dans le sac (0 = plein). */
export function withdraw(
  state: SimState,
  entity: Entity,
  structureId: number,
  item: ItemId,
  count: number,
): number {
  return measured(state, entity, { type: 'withdraw', structureId, item, count }, item)
}

// ─── Réclamer/rendre les tâches du tableau (spec R5) ─────────────────────

/**
 * Ce que la corvée doit pouvoir FAIRE ENTRER dans le sac : la récolte y met sa
 * récolte, la cuisine y met ses ingrédients ET son ragoût, la réparation son bois.
 *
 * Sans place pour ça, la corvée est impossible — et un PNJ qui la réclame quand
 * même la rendrait au premier transfert à vide… pour la re-réclamer au tick suivant
 * (même priorité, même id, rien n'a bougé dans le monde) : une boucle sèche à
 * 20 Hz. Les gardes des exécutants libèrent la tâche POUR LES AUTRES ; celle-ci
 * empêche CE PNJ de la reprendre. Il faut les deux.
 *
 * `stew` est dans la liste parce que le piège ne se ferme pas qu'au `fetch` : un
 * PNJ peut atteindre le feu ses ingrédients en poche et n'avoir aucune case pour
 * le ragoût — le craft refuse alors à chaque tick, sans jamais poser de cooldown.
 */
const TASK_INTAKE: Record<TaskKind, ItemId[]> = {
  gather_berries: ['berries'],
  gather_wood: ['wood'],
  gather_fiber: ['fiber'],
  cook_stew: ['berries', 'fiber', 'stew'],
  repair: ['wood'],
}

/** Le sac peut-il recevoir ce que cette corvée va y mettre ? (conservateur : tout ou rien) */
function canTakeInFor(entity: Entity, kind: TaskKind): boolean {
  return TASK_INTAKE[kind].every((item) => freeRoomFor(entity.inventory, item) > 0)
}

function claimTask(village: Village, npc: Npc, entity: Entity): void {
  const free = village.tasks
    .filter((t) => t.claimedBy === null && canTakeInFor(entity, t.kind))
    .sort((a, b) => b.priority - a.priority || a.id - b.id)[0]
  if (!free) return
  free.claimedBy = npc.entityId
  const stage = free.kind === 'cook_stew' || free.kind === 'repair' ? 'fetch' : 'work'
  npc.task = { id: free.id, kind: free.kind, stage, nodeId: null }
  npc.path = []
}

/**
 * Le PNJ rend sa corvée. `clearFromBoard` dit ce qu'il advient de la TÂCHE, pas si
 * le travail a été fait :
 *   - `false` → elle retourne au tableau, libre. Pour un empêchement PROPRE À CE
 *     PNJ (sac fermé, cible inatteignable) : un autre la prendra, et TASK_INTAKE
 *     interdit à celui-ci de la re-réclamer au tick suivant.
 *   - `true`  → elle QUITTE le tableau. Pour un empêchement qui vaudrait pour
 *     n'importe qui (grenier plein) : la relâcher, ce serait la voir re-réclamée au
 *     tick suivant par le même PNJ, à l'identique, à 20 Hz. La retirer est le SEUL
 *     temps mort dont on dispose — `refreshBoard` la reposte au prochain
 *     rafraîchissement si le besoin du village tient toujours.
 */
export function dropTask(village: Village, npc: Npc, clearFromBoard: boolean): void {
  if (npc.task) {
    if (clearFromBoard) village.tasks = village.tasks.filter((t) => t.id !== npc.task!.id)
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
    // LA TRAVERSÉE : le sac s'est fermé PENDANT la corvée. TASK_INTAKE ne s'évalue
    // qu'à la réclamation — entre elle et le nœud, la faim a pu voler la dernière
    // case au grenier, ou un joueur gaver le PNJ. Sans cette garde il récolte quand
    // même : la récolte n'a nulle part où aller, le nœud se vide dans le vide, et
    // la chronique reçoit des `resource_harvested` qui mentent (demain, quand la
    // récolte refusera honnêtement, ce sera un livelock sec à 20 Hz).
    if (freeRoomFor(entity.inventory, def.item) === 0) {
      if (countOf(entity.inventory, def.item) > 0) {
        task.stage = 'store' // ce qu'il porte déjà part au grenier : ça libère des cases
        npc.path = []
        return
      }
      return dropTask(village, npc, false) // TASK_INTAKE l'empêchera de la reprendre
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
      if (canAct(state, entity)) {
        // La main d'abord : sans outil EN MAIN, la récolte tombe à ×1 (R9).
        equipBestTool(entity, NODE_DEFS[node.type].tool)
        applyEconomyAction(state, entity.id, { type: 'harvest', nodeId: node.id })
      }
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
    if (count > 0) deposit(state, entity, chest.id, def.item, count)
    // Grenier plein (dépôt à 0) : le PNJ GARDE sa récolte — rien ne se détruit —
    // et la corvée quitte le tableau quand même. Ce n'est pas « accompli » : c'est
    // le seul temps mort disponible (cf. dropTask). La relâcher libre, ce serait
    // la re-réclamer au tick suivant, ici même, pour l'éternité.
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
      const inv = chest.inventory ?? []
      // Un retrait qui ne rapporte rien (sac plein) : on lâche la tâche — elle
      // retourne au tableau, pour un PNJ qui a de la place. Celui-ci ne la
      // reprendra pas : TASK_INTAKE le rend inéligible tant que son sac est plein.
      if (needBerries > 0 && countOf(inv, 'berries') >= needBerries) {
        if (withdraw(state, entity, chest.id, 'berries', needBerries) === 0) dropTask(village, npc, false)
      } else if (needFiber > 0 && countOf(inv, 'fiber') >= needFiber) {
        if (withdraw(state, entity, chest.id, 'fiber', needFiber) === 0) dropTask(village, npc, false)
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
      if (canAct(state, entity)) {
        applyEconomyAction(state, entity.id, { type: 'craft', recipeId: 'stew' })
        // Le craft a refusé (le ragoût n'a nulle part où aller — un refus ne pose
        // aucun cooldown, donc on le retenterait 20 fois par seconde). On lâche :
        // TASK_INTAKE interdit de re-réclamer tant qu'il n'y a pas de case.
        if (countOf(entity.inventory, 'stew') === 0) return dropTask(village, npc, false)
      }
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, fire.tx, fire.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }

  // stage 'store' — grenier plein : le PNJ garde le ragoût et lâche la corvée.
  if (near(entity, chest.tx, chest.ty)) {
    const count = countOf(entity.inventory, 'stew')
    if (count > 0) deposit(state, entity, chest.id, 'stew', count)
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

  // « Assez de bois pour UN coup de marteau », pas « du bois » : avec un seul bois
  // et un coût à 2, `repair` refuserait à chaque tick (un refus ne pose pas de
  // cooldown) sans jamais renvoyer au grenier. On lit le coût, on ne le redit pas.
  const enoughWood = (): boolean => countOf(entity.inventory, 'wood') >= WORLD_EVENTS.REPAIR_WOOD_COST

  if (task.stage === 'fetch' && !enoughWood()) {
    const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? [], 'wood') > 0)
    if (!chest) return dropTask(village, npc, false) // pas de bois : on abandonne
    if (near(entity, chest.tx, chest.ty)) {
      const got = withdraw(
        state,
        entity,
        chest.id,
        'wood',
        Math.min(NPC_AI.REPAIR_WOOD_WITHDRAW, countOf(chest.inventory ?? [], 'wood')),
      )
      // Sac plein : sans bois, l'étape 'work' renverrait aussitôt vers 'fetch' —
      // un aller-retour perpétuel entre le grenier et la structure. On lâche : la
      // tâche retourne au tableau (un autre PNJ la prendra), et TASK_INTAKE
      // interdit à CELUI-CI de la re-réclamer au tick suivant.
      if (got === 0) return dropTask(village, npc, false)
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
      if (!enoughWood()) task.stage = 'fetch'
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
      // La lance en main, pas dans le dos : les dégâts viennent de l'arme TENUE (R9).
      equipBestWeapon(entity)
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
    if (handleCold(state, village, npc, entity)) continue
    if (handleHunger(state, village, npc, entity)) continue

    if (!npc.task) {
      claimTask(village, npc, entity)
      if (!npc.task) continue // rien à faire (ou plus une case pour le faire) : oisif
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
    // Le grand sac du PNJ (spec inventaire R7) : il porte une journée de corvées
    // sans jamais buter sur sa borne. Quand il bute quand même (un raider chargé
    // de butin, un joueur qui le gave), les corvées le VOIENT — TASK_INTAKE — et
    // il devient oisif, pas figé.
    const id = spawnEntity(state, tx + 0.5, ty + 0.5, SLOTS.NPC)
    village.memberIds.push(id)
    emitEvent(state, { type: 'member_joined', tick: state.tick, villageId: village.id, entityId: id })
    state.npcs.push({
      entityId: id,
      villageId: village.id,
      homeId: null,
      energy: 100,
      sleeping: false,
      seekingWarmth: false,
      task: null,
      path: [],
      stuck: 0,
      errand: null,
    })
    spawned += 1
  }
}
