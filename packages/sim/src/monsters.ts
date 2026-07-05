/**
 * Les monstres — zombie et sanglier (spec combat R11-R12).
 *
 * Le zombie est l'école de guerre : lent, télégraphié long, on apprend à
 * lire les wind-ups contre lui. Le sanglier est la chasse : neutre, fuit,
 * charge parfois blessé. IA dans /sim, aléa via le PRNG de la sim.
 */
import { BALANCE, MONSTER_DEFS, type MonsterType } from './balance'
import { startAttack } from './combat'
import { moveAvatar } from './collision'
import { rngRoll } from './rng'
import { spawnEntity, type Entity, type SimState } from './sim'

export interface Monster {
  entityId: number
  type: MonsterType
  targetId: number | null
  /** Prochain tick de décision (l'IA pense à 2 Hz, agit à 12). */
  thinkAt: number
  wanderDx: -1 | 0 | 1
  wanderDy: -1 | 0 | 1
  fleeing: boolean
  lastAttackerId: number | null
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

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
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
  const scale = (def.speed / BALANCE.WALK_SPEED_TILES_PER_S) * (entity.wounds.leg ? 0.6 : 1)
  const moved = moveAvatar(
    { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null },
    entity.x,
    entity.y,
    sx,
    sy,
    1 / BALANCE.TICK_RATE_HZ,
    scale,
  )
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
}

export function advanceMonsters(state: SimState): void {
  for (const monster of [...state.monsters]) {
    const entity = state.entities.find((e) => e.id === monster.entityId)
    if (!entity) continue
    const def = MONSTER_DEFS[monster.type]
    if (entity.windup) continue // en train de frapper : immobile

    if (monster.type === 'zombie') {
      if (state.tick >= monster.thinkAt) {
        monster.thinkAt = state.tick + 6
        const prey = nearestPrey(state, entity, def.aggroRange)
        monster.targetId = prey?.id ?? null
        if (!prey && roll(state) < 0.3) {
          monster.wanderDx = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
          monster.wanderDy = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
        }
      }
      const target = monster.targetId !== null ? state.entities.find((e) => e.id === monster.targetId) : undefined
      if (target) {
        const d2 = distSq(entity.x, entity.y, target.x, target.y)
        if (d2 <= 1.2 * 1.2) {
          startAttack(state, entity, target.x - entity.x, target.y - entity.y, undefined, def.windupTicks, def.damage)
          entity.cooldownUntil = state.tick + def.attackCooldownTicks
        } else {
          moveToward(state, monster, entity, target.x, target.y, false)
        }
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
        monster.thinkAt = state.tick + 12
        // Blessé : fuit, mais charge parfois (spec R12).
        monster.fleeing = roll(state) >= 0.25
      }
      const d2 = distSq(entity.x, entity.y, attackedBy.x, attackedBy.y)
      if (!monster.fleeing && d2 <= 1.2 * 1.2) {
        startAttack(state, entity, attackedBy.x - entity.x, attackedBy.y - entity.y, undefined, def.windupTicks, def.damage)
        entity.cooldownUntil = state.tick + def.attackCooldownTicks
      } else {
        moveToward(state, monster, entity, attackedBy.x, attackedBy.y, monster.fleeing)
      }
    }
  }
}

