/**
 * Les monstres — zombie et sanglier (spec combat R11-R12).
 *
 * Le zombie est l'école de guerre : lent, télégraphié long, on apprend à
 * lire les wind-ups contre lui. Le sanglier est la chasse : neutre, fuit,
 * charge parfois blessé. IA dans /sim, aléa via le PRNG de la sim.
 */
import { BALANCE, COMBAT, MONSTER_DEFS, TICK_DT_S, type MonsterType } from './balance'
import { startAttack } from './combat'
import { moveAvatar } from './collision'
import { distSq } from './geometry'
import { rngRoll } from './rng'
import { spawnEntity, type Entity, type SimState } from './sim'
import { computeFlowField } from './pathfinding'
import { structureAt, structureBlocks } from './village'

export interface Monster {
  entityId: number
  type: MonsterType
  targetId: number | null
  /** Prochain tick de décision (l'IA pense à 2 Hz, agit à BALANCE.TICK_RATE_HZ). */
  thinkAt: number
  wanderDx: -1 | 0 | 1
  wanderDy: -1 | 0 | 1
  fleeing: boolean
  lastAttackerId: number | null
  path?: { tx: number; ty: number }[]
}

export function spawnMonster(state: SimState, type: MonsterType, x: number, y: number): number {
  const id = spawnEntity(state, x, y)
  const entity = state.entities.find((e) => e.id === id)!
  entity.hp = MONSTER_DEFS[type].hp
  state.monsters.push({
    entityId: id,
    type,
    targetId: null,
    thinkAt: 0,
    wanderDx: 0,
    wanderDy: 0,
    fleeing: false,
    lastAttackerId: null,
  })
  return id
}

function roll(state: SimState): number {
  const { value, next } = rngRoll(state.rngState)
  state.rngState = next
  return value
}

/** Les proies : avatars (joueurs et PNJ), pas les autres monstres. */
function nearestPrey(state: SimState, entity: Entity, range: number): Entity | undefined {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  let best: Entity | undefined
  let bestD = range * range
  for (const e of state.entities) {
    if (e.id === entity.id || monsterIds.has(e.id) || e.hp <= 0) continue
    const d = distSq(entity.x, entity.y, e.x, e.y)
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e
      bestD = d
    }
  }
  return best
}

function moveToward(state: SimState, monster: Monster, entity: Entity, tx: number, ty: number, flee: boolean): void {
  const def = MONSTER_DEFS[monster.type]
  let dx = tx - entity.x
  let dy = ty - entity.y
  if (flee) {
    dx = -dx
    dy = -dy
  }
  const sx = (dx > 0.15 ? 1 : dx < -0.15 ? -1 : 0) as -1 | 0 | 1
  const sy = (dy > 0.15 ? 1 : dy < -0.15 ? -1 : 0) as -1 | 0 | 1
  const scale = (def.speed / BALANCE.WALK_SPEED_TILES_PER_S) * (entity.wounds.leg ? COMBAT.LEG_WOUND_SPEED : 1)
  const moved = moveAvatar(
    { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null },
    entity.x,
    entity.y,
    sx,
    sy,
    TICK_DT_S,
    scale,
  )
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
}

/**
 * Champs de flux du tick, un par horde active (dérivés purs, jamais
 * sérialisés). Le cache vit le temps d'un advanceMonsters : partagé entre
 * les monstres d'une même horde, jamais entre ticks ni entre instances de
 * sim — un cache au niveau module servirait le champ d'une autre partie
 * dès que deux sims cohabitent dans le même processus (rooms LAN).
 */
type FlowCache = Map<number, Int32Array>

/**
 * Descente de gradient vers le Feu ciblé (spec événements R3). Si la
 * meilleure tuile est bouchée par une structure, on la frappe. Retourne
 * true si le monstre appartient à une horde (et a donc agi).
 */
function hordeStep(state: SimState, monster: Monster, entity: Entity, flows: FlowCache): boolean {
  const horde = state.hordes.find((h) => h.memberEntityIds.includes(monster.entityId))
  if (!horde) return false
  const village = state.villages.find((v) => v.id === horde.targetVillageId)
  if (!village) return true

  let field = flows.get(horde.id)
  if (!field) {
    field = computeFlowField(state.map, state.nodes, village.fireTx, village.fireTy)
    flows.set(horde.id, field)
  }

  const width = state.map.width
  const height = state.map.height
  const tx = Math.floor(entity.x)
  const ty = Math.floor(entity.y)
  let bestTx = tx
  let bestTy = ty
  let bestD = field[ty * width + tx] ?? -1
  if (bestD === -1) bestD = Infinity
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = tx + dx
    const ny = ty + dy
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
    const d = field[ny * width + nx]
    if (d !== undefined && d !== -1 && d < bestD) {
      bestD = d
      bestTx = nx
      bestTy = ny
    }
  }
  if (bestTx === tx && bestTy === ty) return true // au but ou coincé hors champ

  // La tuile du gradient est-elle bouchée par une structure ? On la frappe.
  const blocker = structureAt(state.structures, bestTx, bestTy)
  if (blocker && structureBlocks(blocker, null)) {
    if (!entity.windup && state.tick >= entity.cooldownUntil) {
      const def = MONSTER_DEFS[monster.type]
      const started = startAttack(state, entity, bestTx + 0.5 - entity.x, bestTy + 0.5 - entity.y, {
        windupTicks: def.windupTicks,
        damage: def.damage,
        structureId: blocker.id,
      })
      // Un coup refusé (endurance…) ne consomme pas le cooldown.
      if (started) entity.cooldownUntil = state.tick + def.attackCooldownTicks
    }
    return true
  }

  moveToward(state, monster, entity, bestTx + 0.5, bestTy + 0.5, false)
  return true
}

/** Frappe la structure qui bloque la direction de chasse, s'il y en a une. */
function attackBlockingStructure(state: SimState, monster: Monster, entity: Entity, tx: number, ty: number): void {
  const ex = Math.floor(entity.x)
  const ey = Math.floor(entity.y)
  const dx = tx - entity.x
  const dy = ty - entity.y
  // Voisines dans l'ordre de l'axe dominant.
  const candidates: [number, number][] =
    Math.abs(dx) >= Math.abs(dy)
      ? [
          [ex + Math.sign(dx), ey],
          [ex, ey + Math.sign(dy)],
        ]
      : [
          [ex, ey + Math.sign(dy)],
          [ex + Math.sign(dx), ey],
        ]
  for (const [cx, cy] of candidates) {
    const s = structureAt(state.structures, cx, cy)
    if (s && structureBlocks(s, null)) {
      const def = MONSTER_DEFS[monster.type]
      if (startAttack(state, entity, cx + 0.5 - entity.x, cy + 0.5 - entity.y, { windupTicks: def.windupTicks, damage: def.damage, structureId: s.id })) {
        entity.cooldownUntil = state.tick + def.attackCooldownTicks
      }
      return
    }
  }
}

export function advanceMonsters(state: SimState): void {
  const flows: FlowCache = new Map()
  for (const monster of [...state.monsters]) {
    const entity = state.entities.find((e) => e.id === monster.entityId)
    if (!entity) continue
    const def = MONSTER_DEFS[monster.type]
    if (entity.windup) continue // en train de frapper : immobile

    if (monster.type === 'zombie') {
      if (state.tick >= monster.thinkAt) {
        monster.thinkAt = state.tick + def.thinkEveryTicks
        const prey = nearestPrey(state, entity, def.aggroRange)
        monster.targetId = prey?.id ?? null
        if (!prey && roll(state) < def.wanderChance) {
          monster.wanderDx = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
          monster.wanderDy = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
        }
      }
      const target = monster.targetId !== null ? state.entities.find((e) => e.id === monster.targetId) : undefined
      if (target) {
        const d2 = distSq(entity.x, entity.y, target.x, target.y)
        if (d2 <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
          if (startAttack(state, entity, target.x - entity.x, target.y - entity.y, { windupTicks: def.windupTicks, damage: def.damage })) {
            entity.cooldownUntil = state.tick + def.attackCooldownTicks
          }
        } else {
          moveToward(state, monster, entity, target.x, target.y, false)
          // Bloqué en chasse par une structure (mur, porte) : on la frappe.
          if (!entity.moved && !entity.windup && state.tick >= entity.cooldownUntil) {
            attackBlockingStructure(state, monster, entity, target.x, target.y)
          }
        }
      } else if (hordeStep(state, monster, entity, flows)) {
        // membre de horde sans proie : il coule vers le Feu (flow field)
      } else if (monster.wanderDx !== 0 || monster.wanderDy !== 0) {
        moveToward(state, monster, entity, entity.x + monster.wanderDx, entity.y + monster.wanderDy, false)
      }
      continue
    }

    // Le sanglier : paisible tant qu'on ne le touche pas.
    const wounded = entity.hp < def.hp
    const attackedBy = monster.lastAttackerId !== null ? state.entities.find((e) => e.id === monster.lastAttackerId) : undefined
    if (wounded && attackedBy) {
      if (state.tick >= monster.thinkAt) {
        monster.thinkAt = state.tick + def.thinkEveryTicks
        // Blessé : fuit, mais charge parfois (spec R12).
        monster.fleeing = roll(state) >= def.chargeChance
      }
      const d2 = distSq(entity.x, entity.y, attackedBy.x, attackedBy.y)
      if (!monster.fleeing && d2 <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
        if (startAttack(state, entity, attackedBy.x - entity.x, attackedBy.y - entity.y, { windupTicks: def.windupTicks, damage: def.damage })) {
          entity.cooldownUntil = state.tick + def.attackCooldownTicks
        }
      } else {
        moveToward(state, monster, entity, attackedBy.x, attackedBy.y, monster.fleeing)
      }
    }
  }
}

