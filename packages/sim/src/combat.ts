/**
 * Le combat — endurance, télégraphes, blessures, mort (spec combat, GDD §7).
 *
 * Un combat de coût, pas de skill pur : tout se paie en endurance, les
 * blessures sont le vrai prix des coups, et la mort lâche tout ce qu'on
 * porte. Le même pipeline résout les coups des joueurs, des PNJ et des
 * monstres — personne ne triche.
 */
import { COMBAT, MONSTER_DEFS, WEAPON_DAMAGE } from './balance'
import { emitEvent } from './events'
import { addItems, countOf, removeItems, type ItemId } from './items'
import type { Entity, SimState } from './sim'

export interface Corpse {
  id: number
  x: number
  y: number
  inventory: Entity['inventory']
  decayAt: number
}

export type CombatAction =
  | { type: 'attack'; dx: number; dy: number }
  | { type: 'bandage'; targetEntityId?: number }
  | { type: 'loot_corpse'; corpseId: number }

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

/** L'arme portée la plus dangereuse — l'outil n'est pas une arme (spec R5). */
export function weaponDamage(entity: Entity): number {
  let best: number = COMBAT.UNARMED_DAMAGE
  for (const item of Object.keys(WEAPON_DAMAGE) as ItemId[]) {
    const dmg = WEAPON_DAMAGE[item] ?? 0
    if (countOf(entity.inventory, item) > 0 && dmg > best) best = dmg
  }
  return best
}

function bestWeaponItem(entity: Entity): ItemId | null {
  let best: ItemId | null = null
  let bestDmg: number = COMBAT.UNARMED_DAMAGE
  for (const item of Object.keys(WEAPON_DAMAGE) as ItemId[]) {
    const dmg = WEAPON_DAMAGE[item] ?? 0
    if (countOf(entity.inventory, item) > 0 && dmg > bestDmg) {
      best = item
      bestDmg = dmg
    }
  }
  return best
}

export function applyCombatAction(state: SimState, actorId: number, action: CombatAction): void {
  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return
  const reject = (reason: string): void => {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason })
  }

  switch (action.type) {
    case 'attack': {
      startAttack(state, actor, action.dx, action.dy, reject)
      return
    }

    case 'bandage': {
      if (state.tick < actor.cooldownUntil) return reject('trop tôt')
      const target =
        action.targetEntityId !== undefined
          ? state.entities.find((e) => e.id === action.targetEntityId)
          : actor
      if (!target) return reject('cible inconnue')
      if (distSq(actor.x, actor.y, target.x, target.y) > 1.5 * 1.5) return reject('trop loin')
      if (!target.wounds.bleeding && !target.wounds.leg && !target.wounds.arm) return reject('rien à soigner')
      if (!removeItems(actor.inventory, { fiber: COMBAT.BANDAGE_FIBER_COST })) return reject('il faut des fibres')
      // Une blessure par bandage : le saignement d'abord (il tue).
      if (target.wounds.bleeding) delete target.wounds.bleeding
      else if (target.wounds.leg) delete target.wounds.leg
      else delete target.wounds.arm
      actor.cooldownUntil = state.tick + 12
      emitEvent(state, { type: 'entity_bandaged', tick: state.tick, entityId: target.id, byEntityId: actorId })
      return
    }

    case 'loot_corpse': {
      const corpse = state.corpses.find((c) => c.id === action.corpseId)
      if (!corpse) return reject('rien ici')
      if (distSq(actor.x, actor.y, corpse.x, corpse.y) > 1.5 * 1.5) return reject('trop loin')
      addItems(actor.inventory, corpse.inventory)
      state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
      emitEvent(state, { type: 'corpse_looted', tick: state.tick, corpseId: corpse.id, byEntityId: actorId })
      return
    }
  }
}

/** Démarre un wind-up d'attaque (utilisé par joueurs, PNJ et monstres). */
export function startAttack(
  state: SimState,
  actor: Entity,
  dx: number,
  dy: number,
  reject?: (reason: string) => void,
  windupTicks: number = COMBAT.WINDUP_TICKS,
  damageOverride?: number,
): boolean {
  if (actor.windup) {
    reject?.('déjà en train de frapper')
    return false
  }
  if (state.tick < actor.cooldownUntil) {
    reject?.('trop tôt')
    return false
  }
  if (actor.stamina < COMBAT.ATTACK_STAMINA) {
    reject?.('à bout de souffle')
    return false
  }
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.0001) {
    reject?.('direction invalide')
    return false
  }
  // Renormalisation côté sim : vraisemblance (GDD §11).
  const nx = dx / len
  const ny = dy / len
  actor.stamina -= COMBAT.ATTACK_STAMINA
  actor.facing = { x: nx, y: ny }
  actor.windup = { dx: nx, dy: ny, ticksLeft: windupTicks, ...(damageOverride !== undefined ? { damage: damageOverride } : {}) }
  return true
}

/** Résout le coup à la fin du wind-up : arc de 90°, portée 1.4 (spec R4). */
function resolveStrike(state: SimState, attacker: Entity): void {
  const windup = attacker.windup!
  const baseDamage = windup.damage ?? weaponDamage(attacker)
  const damage = attacker.wounds.arm ? baseDamage * COMBAT.ARM_WOUND_DAMAGE : baseDamage
  const rangeSq = COMBAT.ATTACK_RANGE * COMBAT.ATTACK_RANGE

  let struck = false
  for (const target of state.entities) {
    if (target.id === attacker.id || target.hp <= 0) continue
    const tx = target.x - attacker.x
    const ty = target.y - attacker.y
    const d2 = tx * tx + ty * ty
    if (d2 > rangeSq || d2 === 0) continue
    const dist = Math.sqrt(d2)
    const cos = (tx * windup.dx + ty * windup.dy) / dist
    if (cos < COMBAT.ATTACK_ARC_COS) continue

    let dealt = damage
    // Blocage directionnel (spec R6) : réduit si l'attaque arrive de face.
    if (target.blocking && target.stamina > 0) {
      const facingCos = (-tx * target.facing.x - ty * target.facing.y) / dist
      if (facingCos >= COMBAT.BLOCK_ARC_COS) {
        dealt = damage * (1 - COMBAT.BLOCK_REDUCTION)
        target.stamina = Math.max(0, target.stamina - (COMBAT.BLOCK_STAMINA_BASE + damage / 2))
      }
    }
    applyDamage(state, target, dealt, attacker.id)
    struck = true
  }

  // L'arme s'use au contact.
  if (struck && windup.damage === undefined) {
    const weapon = bestWeaponItem(attacker)
    if (weapon) {
      attacker.wear[weapon] = (attacker.wear[weapon] ?? 0) + 1
      if ((attacker.wear[weapon] ?? 0) >= 100) {
        removeItems(attacker.inventory, { [weapon]: 1 })
        delete attacker.wear[weapon]
      }
    }
  }
  delete attacker.windup
}

export function applyDamage(state: SimState, target: Entity, damage: number, byEntityId: number): void {
  const before = target.hp
  target.hp = Math.max(0, target.hp - damage)
  // Un monstre frappé mémorise son agresseur (le sanglier fuit ou charge).
  const targetMonster = state.monsters.find((m) => m.entityId === target.id)
  if (targetMonster) targetMonster.lastAttackerId = byEntityId
  emitEvent(state, {
    type: 'entity_damaged',
    tick: state.tick,
    entityId: target.id,
    byEntityId,
    amount: damage,
  })

  // Les paliers de blessure (spec R7) : le PRNG de la sim décide du membre.
  for (const threshold of COMBAT.WOUND_THRESHOLDS) {
    if (before > threshold && target.hp <= threshold && target.hp > 0) {
      state.rngState = (state.rngState + 0x6d2b79f5) >>> 0
      let t = state.rngState
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const roll = ((t ^ (t >>> 14)) >>> 0) / 4294967296
      const wound = roll < 0.34 ? 'leg' : roll < 0.67 ? 'arm' : 'bleeding'
      target.wounds[wound] = true
      emitEvent(state, { type: 'wound_inflicted', tick: state.tick, entityId: target.id, wound })
    }
  }

  if (target.hp <= 0) die(state, target, byEntityId)
}

function die(state: SimState, entity: Entity, byEntityId: number): void {
  emitEvent(state, { type: 'entity_died', tick: state.tick, entityId: entity.id, byEntityId })

  const monster = state.monsters.find((m) => m.entityId === entity.id)
  const npc = state.npcs.find((n) => n.entityId === entity.id)

  // Le cadavre reçoit tout ce qui était porté (spec R9) — ou la table de
  // loot du monstre (le sanglier donne sa viande).
  const loot = monster ? { ...MONSTER_DEFS[monster.type].loot } : { ...entity.inventory }
  if (Object.keys(loot).length > 0) {
    state.corpses.push({
      id: state.nextCorpseId,
      x: entity.x,
      y: entity.y,
      inventory: loot,
      decayAt: state.tick + COMBAT.CORPSE_TICKS,
    })
    state.nextCorpseId += 1
  }

  if (monster) {
    state.monsters = state.monsters.filter((m) => m.entityId !== entity.id)
    state.entities = state.entities.filter((e) => e.id !== entity.id)
    emitEvent(state, { type: 'monster_slain', tick: state.tick, monsterType: monster.type, byEntityId })
    return
  }

  if (npc) {
    // Les PNJ meurent pour de bon (spec R10) : la main-d'œuvre est un stock.
    state.npcs = state.npcs.filter((n) => n.entityId !== entity.id)
    state.entities = state.entities.filter((e) => e.id !== entity.id)
    for (const village of state.villages) {
      village.memberIds = village.memberIds.filter((id) => id !== entity.id)
      for (const task of village.tasks) if (task.claimedBy === entity.id) task.claimedBy = null
    }
    return
  }

  // Joueur : respawn au Feu de son village, épuisé, compétences intactes (R10).
  const village = state.villages.find((v) => v.memberIds.includes(entity.id))
  entity.inventory = {}
  entity.wear = {}
  entity.wounds = {}
  delete entity.windup
  entity.hp = COMBAT.RESPAWN_HP
  entity.hunger = COMBAT.RESPAWN_HUNGER
  entity.stamina = COMBAT.RESPAWN_STAMINA
  entity.exhaustedUntil = state.tick + COMBAT.EXHAUSTION_TICKS
  if (village) {
    entity.x = village.fireTx + 0.5
    entity.y = village.fireTy + 0.5
  } else {
    entity.x = entity.homeX
    entity.y = entity.homeY
  }
  emitEvent(state, { type: 'entity_respawned', tick: state.tick, entityId: entity.id })
}

/** Passe combat du tick : wind-ups, saignements, régénérations, cadavres. */
export function advanceCombat(state: SimState): void {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))

  // Wind-ups (copie : resolveStrike peut tuer et retirer des entités).
  for (const entity of [...state.entities]) {
    if (entity.windup) {
      entity.windup.ticksLeft -= 1
      if (entity.windup.ticksLeft <= 0) resolveStrike(state, entity)
    }
  }

  for (const entity of [...state.entities]) {
    // Saignement : draine jusqu'au bandage (spec R7) — peut tuer.
    if (entity.wounds.bleeding) {
      const before = entity.hp
      entity.hp = Math.max(0, entity.hp - COMBAT.BLEED_HP_PER_S / 12)
      if (before > 0 && entity.hp <= 0) die(state, entity, 0)
      continue
    }
    // PV : remontent lentement si bien nourri.
    if (entity.hp > 0 && entity.hp < 100 && entity.hunger > 50) {
      entity.hp = Math.min(100, entity.hp + COMBAT.HP_REGEN_PER_MIN / 720)
    }
  }

  // Endurance : régén contextuelle (spec R1-R2). Les monstres régénèrent plein.
  for (const entity of state.entities) {
    if (entity.windup || entity.blocking) continue
    let perS = entity.moved ? COMBAT.STAMINA_REGEN_MOVING_PER_S : COMBAT.STAMINA_REGEN_IDLE_PER_S
    if (!monsterIds.has(entity.id)) {
      if (entity.hunger > 70) perS *= COMBAT.FED_REGEN_BONUS
      else if (entity.hunger <= 0) perS *= COMBAT.STARVED_REGEN_MALUS
      if (state.tick < entity.exhaustedUntil) perS *= 0.5
    }
    entity.stamina = Math.min(100, entity.stamina + perS / 12)
  }

  state.corpses = state.corpses.filter((c) => c.decayAt > state.tick)
}
