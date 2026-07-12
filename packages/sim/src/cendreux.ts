/**
 * La levée des Cendreux (spec 2026-07-08). Critère de mort, réveil, IA. Pur/déterministe.
 */
import { CENDREUX, COMBAT, MONSTER_DEFS } from './balance'
import { startAttack } from './combat'
import { distSq } from './geometry'
import { emitEvent } from './events'
import { isEmpty, pourInto } from './items'
import { moveToward, nearestPrey, spawnMonster, type Monster } from './monsters'
import { findPath } from './pathfinding'
import { getGameTime } from './time'
import type { Entity, SimState } from './sim'
import { spillOnGround } from './village'

/** Vrai si cette mort (déjà connue `cold`) donnera un Cendreux : seul ET loin d'un feu. */
export function willRiseAsCendreux(state: SimState, entity: Entity): boolean {
  // Loin d'un feu : aucune structure feu dans HEARTH_WARD_RADIUS.
  const hearthWardR = CENDREUX.HEARTH_WARD_RADIUS
  const nearFire = state.structures.some(
    (s) => s.type === 'fire' && distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y) <= hearthWardR * hearthWardR,
  )
  if (nearFire) return false
  // Seul : aucun allié vivant (même village) dans WITNESS_RADIUS.
  const witnessR = CENDREUX.WITNESS_RADIUS
  const village = state.villages.find((v) => v.memberIds.includes(entity.id))
  if (village) {
    const hasAlly = state.entities.some(
      (e) => e.id !== entity.id && e.hp > 0 && village.memberIds.includes(e.id) &&
        distSq(e.x, e.y, entity.x, entity.y) <= witnessR * witnessR,
    )
    if (hasAlly) return false
  }
  return true
}

/** Réveil : les cadavres marqués se lèvent en Cendreux (ou sont annulés par un feu). */
export function advanceCendreux(state: SimState): void {
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  for (const corpse of [...state.corpses]) {
    if (corpse.risesAt === undefined || state.tick < corpse.risesAt) continue
    // Veillé par un feu à portée → annulation.
    const warded = state.structures.some(
      (s) => s.type === 'fire' && distSq(s.tx + 0.5, s.ty + 0.5, corpse.x, corpse.y) <= ward * ward,
    )
    if (warded) {
      delete corpse.risesAt
      corpse.decayAt = state.tick + COMBAT.CORPSE_TICKS
      continue
    }
    // Levée : le cadavre devient le Cendreux, portant son loot.
    const id = spawnMonster(state, 'cendreux', corpse.x, corpse.y)
    const ent = state.entities.find((e) => e.id === id)!
    // Les CASES passent au Cendreux (spec inventaire R6) : la levée n'est pas un
    // atelier de réparation — une hache usée se relève usée. `pourInto` conserve
    // l'usure (il ne reconstruit pas de case neuve), sinon mourir de froid
    // réparerait tout l'outillage porté et le Cendreux serait une lessiveuse.
    // Ce qui NE TIENT PAS dans les 40 cases du Cendreux (un cadavre gavé au-delà
    // pendant la fenêtre de levée) ne s'évapore pas : il tombe au sol (A21).
    pourInto(corpse.inventory, ent.inventory)
    state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
    if (!isEmpty(corpse.inventory)) spillOnGround(state, corpse.x, corpse.y, {}, corpse.inventory)
    emitEvent(state, { type: 'cendreux_risen', tick: state.tick, entityId: id, x: corpse.x, y: corpse.y })
  }
}

/** La source de chaleur la plus proche dans `range` : un feu OU un vivant. */
export function nearestWarmth(
  state: SimState,
  entity: Entity,
  range: number,
): { x: number; y: number; prey?: Entity } | undefined {
  const r2 = range * range
  let best: { x: number; y: number; prey?: Entity } | undefined
  let bestD = r2
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    const d = distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y)
    if (d < bestD) {
      bestD = d
      best = { x: s.tx + 0.5, y: s.ty + 0.5 }
    }
  }
  const prey = nearestPrey(state, entity, range)
  if (prey) {
    const d = distSq(prey.x, prey.y, entity.x, entity.y)
    if (d < bestD) {
      bestD = d
      best = { x: prey.x, y: prey.y, prey }
    }
  }
  return best
}

/** IA du Cendreux : dormant le jour (rampe vers une proie en vue), cherche la chaleur la nuit. A*. */
export function cendreuxStep(state: SimState, monster: Monster, entity: Entity): void {
  const def = MONSTER_DEFS.cendreux
  if (entity.windup) return
  const night = getGameTime(state).isNight

  // Cible du tick de décision.
  if (state.tick >= (monster.thinkAt ?? 0)) {
    monster.thinkAt = state.tick + def.thinkEveryTicks
    let goal: { x: number; y: number; prey?: Entity } | undefined
    if (night) {
      goal = nearestWarmth(state, entity, CENDREUX.WARMTH_SEEK_RANGE)
    } else {
      const prey = nearestPrey(state, entity, def.aggroRange)
      if (prey) goal = { x: prey.x, y: prey.y, prey }
    }
    monster.targetId = goal?.prey?.id ?? null
    if (goal) {
      const world = { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null }
      const path = findPath(
        world,
        { tx: Math.floor(entity.x), ty: Math.floor(entity.y) },
        { tx: Math.floor(goal.x), ty: Math.floor(goal.y) },
      )
      monster.path = path ?? []
    } else {
      monster.path = []
    }
  }

  // Attaque si une proie ciblée est au contact.
  const target = monster.targetId !== null ? state.entities.find((e) => e.id === monster.targetId) : undefined
  if (target && distSq(entity.x, entity.y, target.x, target.y) <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
    if (
      state.tick >= entity.cooldownUntil &&
      startAttack(state, entity, target.x - entity.x, target.y - entity.y, {
        windupTicks: def.windupTicks,
        damage: def.damage,
      })
    ) {
      entity.cooldownUntil = state.tick + def.attackCooldownTicks
    }
    return
  }
  // Sinon, avancer d'un pas vers le prochain nœud du chemin (A*).
  const wp = monster.path?.[0]
  if (wp) {
    const dx = wp.tx + 0.5 - entity.x
    const dy = wp.ty + 0.5 - entity.y
    if (dx * dx + dy * dy < 0.45 * 0.45) monster.path!.shift()
    else moveToward(state, monster, entity, wp.tx + 0.5, wp.ty + 0.5, false)
  }
}
