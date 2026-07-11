/**
 * Le combat — endurance, télégraphes, blessures, mort (spec combat, GDD §7).
 *
 * Un combat de coût, pas de skill pur : tout se paie en endurance, les
 * blessures sont le vrai prix des coups, et la mort lâche tout ce qu'on
 * porte. Le même pipeline résout les coups des joueurs, des PNJ et des
 * monstres — personne ne triche.
 */
import { damageModifier, hasAggressionBetween, isOutsider, recordAct, recordHostility, regenFactor } from './alignment'
import { ALIGNMENT, BALANCE, CENDREUX, COMBAT, MONSTER_DEFS, WEAPON_DAMAGE } from './balance'
import { willRiseAsCendreux } from './cendreux'
import { isInvulnerable } from './debug'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { addItems, countOf, removeItems, type ItemId } from './items'
import { rngRoll } from './rng'
import type { Entity, SimState } from './sim'
import { coldStaminaRegenFactor } from './temperature'
import { applyStructureDamage, getVillageOf } from './village'

export interface Corpse {
  id: number
  x: number
  y: number
  inventory: Entity['inventory']
  decayAt: number
  risesAt?: number
}

export type CombatAction =
  | { type: 'attack'; dx: number; dy: number }
  | { type: 'bandage'; targetEntityId?: number }
  | { type: 'loot_corpse'; corpseId: number }

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
      startAttack(state, actor, action.dx, action.dy, { reject })
      return
    }

    case 'bandage': {
      if (state.tick < actor.cooldownUntil) return reject('trop tôt')
      const target =
        action.targetEntityId !== undefined
          ? state.entities.find((e) => e.id === action.targetEntityId)
          : actor
      if (!target) return reject('cible inconnue')
      if (distSq(actor.x, actor.y, target.x, target.y) > BALANCE.INTERACT_RANGE * BALANCE.INTERACT_RANGE) return reject('trop loin')
      if (!target.wounds.bleeding && !target.wounds.leg && !target.wounds.arm) return reject('rien à soigner')
      if (!removeItems(actor.inventory, { fiber: COMBAT.BANDAGE_FIBER_COST })) return reject('il faut des fibres')
      // Une blessure par bandage : le saignement d'abord (il tue).
      if (target.wounds.bleeding) delete target.wounds.bleeding
      else if (target.wounds.leg) delete target.wounds.leg
      else delete target.wounds.arm
      actor.cooldownUntil = state.tick + COMBAT.BANDAGE_COOLDOWN_TICKS
      // Soigner un extérieur est un acte chaud (spec alignement R2).
      if (target.id !== actorId && isOutsider(state, actorId, target.id)) {
        recordAct(state, actorId, ALIGNMENT.HEAL_OUTSIDER_WARMTH)
      }
      emitEvent(state, { type: 'entity_bandaged', tick: state.tick, entityId: target.id, byEntityId: actorId })
      return
    }

    case 'loot_corpse': {
      const corpse = state.corpses.find((c) => c.id === action.corpseId)
      if (!corpse) return reject('rien ici')
      if (distSq(actor.x, actor.y, corpse.x, corpse.y) > BALANCE.INTERACT_RANGE * BALANCE.INTERACT_RANGE) return reject('trop loin')
      addItems(actor.inventory, corpse.inventory)
      state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
      emitEvent(state, { type: 'corpse_looted', tick: state.tick, corpseId: corpse.id, byEntityId: actorId })
      return
    }
  }
}

/** Options de `startAttack` — les défauts sont ceux du coup de joueur nu. */
export interface StartAttackOptions {
  /** Rapporte la raison d'un refus (émission d'`action_rejected` côté joueur). */
  reject?: (reason: string) => void
  /** Durée du télégraphe (défaut : COMBAT.WINDUP_TICKS). */
  windupTicks?: number
  /** Dégâts imposés (monstres) — défaut : l'arme portée au moment du coup. */
  damage?: number
  /** Cible structure (siège) au lieu de l'arc contre les entités. */
  structureId?: number
}

/** Démarre un wind-up d'attaque (utilisé par joueurs, PNJ et monstres). */
export function startAttack(
  state: SimState,
  actor: Entity,
  dx: number,
  dy: number,
  opts: StartAttackOptions = {},
): boolean {
  const { reject, windupTicks = COMBAT.WINDUP_TICKS, damage, structureId } = opts
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
  actor.windup = {
    dx: nx,
    dy: ny,
    ticksLeft: windupTicks,
    ...(damage !== undefined ? { damage } : {}),
    ...(structureId !== undefined ? { structureId } : {}),
  }
  return true
}

/** Résout le coup à la fin du wind-up : arc de 90°, portée 1.4 (spec R4). */
function resolveStrike(state: SimState, attacker: Entity): void {
  const windup = attacker.windup!

  // Coup porté à une structure (les hordes frappent les murs, spec événements R1).
  if (windup.structureId !== undefined) {
    const s = state.structures.find((st) => st.id === windup.structureId)
    if (s && distSq(attacker.x, attacker.y, s.tx + 0.5, s.ty + 0.5) <= COMBAT.STRUCTURE_STRIKE_RANGE * COMBAT.STRUCTURE_STRIKE_RANGE) {
      applyStructureDamage(state, s.id, windup.damage ?? weaponDamage(attacker), attacker.id)
    }
    delete attacker.windup
    return
  }

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

    let dealt = damage * damageModifier(state, attacker.id, target.id)
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
      if ((attacker.wear[weapon] ?? 0) >= BALANCE.TOOL_DURABILITY) {
        removeItems(attacker.inventory, { [weapon]: 1 })
        delete attacker.wear[weapon]
      }
    }
  }
  delete attacker.windup
}

export function applyDamage(state: SimState, target: Entity, damage: number, byEntityId: number): void {
  // Invulnérabilité de DEV : le coup n'a jamais lieu (ni PV, ni blessure, ni
  // événement) — sinon la chronique se remplirait de faits qui n'en sont pas.
  if (isInvulnerable(state, target)) return
  const before = target.hp
  target.hp = Math.max(0, target.hp - damage)
  // Un monstre frappé mémorise son agresseur (le sanglier fuit ou charge).
  const targetMonster = state.monsters.find((m) => m.entityId === target.id)
  if (targetMonster) targetMonster.lastAttackerId = byEntityId

  // L'alignement (spec alignement R2, R4) : frapper l'extérieur est un acte.
  if (!targetMonster && byEntityId !== 0 && isOutsider(state, byEntityId, target.id)) {
    const targetVillage = getVillageOf(state, target.id)
    const killerVillage = getVillageOf(state, byEntityId)
    const cost = recordHostility(state, byEntityId, targetVillage?.id ?? null)
    recordAct(state, byEntityId, cost)
    if (target.hp <= 0 && before > 0) {
      // Tuer l'agresseur en défense ne coûte presque rien (GDD : la riposte).
      const defensive =
        targetVillage !== undefined &&
        killerVillage !== undefined &&
        hasAggressionBetween(state, targetVillage.id, killerVillage.id)
      recordAct(state, byEntityId, defensive ? ALIGNMENT.RIPOSTE_KILL_WARMTH : ALIGNMENT.KILL_WARMTH)
    }
  }
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
      const { value: roll, next } = rngRoll(state.rngState)
      state.rngState = next
      const wound = roll < 0.34 ? 'leg' : roll < 0.67 ? 'arm' : 'bleeding'
      target.wounds[wound] = true
      emitEvent(state, { type: 'wound_inflicted', tick: state.tick, entityId: target.id, wound })
    }
  }

  if (target.hp <= 0) die(state, target, byEntityId)
}

export function die(state: SimState, entity: Entity, byEntityId: number, cause?: 'cold'): void {
  const monster = state.monsters.find((m) => m.entityId === entity.id)
  emitEvent(state, {
    type: 'entity_died',
    tick: state.tick,
    entityId: entity.id,
    byEntityId,
    wasMonster: monster !== undefined,
    ...(cause ? { cause } : {}),
  })
  const npc = state.npcs.find((n) => n.entityId === entity.id)

  // Le cadavre reçoit tout ce qui était porté (spec R9) — ou la table de
  // loot du monstre (le sanglier donne sa viande).
  const loot = monster ? { ...MONSTER_DEFS[monster.type].loot, ...entity.inventory } : { ...entity.inventory }
  // La levée des Cendreux (spec 2026-07-08) : mort de froid, seul, loin d'un
  // feu → le cadavre est marqué et ne décante pas avant la levée.
  const willRise = !monster && cause === 'cold' && willRiseAsCendreux(state, entity)
  if (willRise) {
    state.corpses.push({
      id: state.nextCorpseId,
      x: entity.x,
      y: entity.y,
      inventory: loot,
      decayAt: state.tick + COMBAT.CORPSE_TICKS,
      risesAt: state.tick + CENDREUX.RISE_DELAY,
    })
    state.nextCorpseId += 1
  } else if (Object.keys(loot).length > 0) {
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
  entity.temperature = COMBAT.RESPAWN_TEMPERATURE
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
      entity.hp = Math.max(0, entity.hp - COMBAT.BLEED_HP_PER_S / BALANCE.TICK_RATE_HZ)
      if (before > 0 && entity.hp <= 0) die(state, entity, 0)
      continue
    }
    // PV : remontent lentement si bien nourri — modulé par la chaleur du Feu.
    // Réservé aux avatars (joueurs/PNJ) : les monstres n'ont ni Foyer ni
    // nourriture (leur `hunger` reste à 100, jamais drainé) et le plafond 100
    // ci-dessous dépasse le PV max propre de la plupart des types
    // (MONSTER_DEFS[type].hp) — sans cette garde un monstre entamé regrimpe
    // passivement au-delà de son max.
    if (!monsterIds.has(entity.id) && entity.hp > 0 && entity.hp < 100 && entity.hunger > 50) {
      entity.hp = Math.min(100, entity.hp + (COMBAT.HP_REGEN_PER_MIN / (60 * BALANCE.TICK_RATE_HZ)) * regenFactor(state, entity))
    }
  }

  // Endurance : régén contextuelle (spec R1-R2). Les monstres régénèrent plein.
  for (const entity of state.entities) {
    if (entity.windup || entity.blocking) continue
    let perS = entity.moved ? COMBAT.STAMINA_REGEN_MOVING_PER_S : COMBAT.STAMINA_REGEN_IDLE_PER_S
    perS *= coldStaminaRegenFactor(entity.temperature)
    if (!monsterIds.has(entity.id)) {
      if (entity.hunger > 70) perS *= COMBAT.FED_REGEN_BONUS
      else if (entity.hunger <= 0) perS *= COMBAT.STARVED_REGEN_MALUS
      if (state.tick < entity.exhaustedUntil) perS *= COMBAT.EXHAUSTED_REGEN_FACTOR
    }
    entity.stamina = Math.min(100, entity.stamina + perS / BALANCE.TICK_RATE_HZ)
  }

  // Un cadavre marqué (levée à venir) ne décante pas avant sa levée.
  state.corpses = state.corpses.filter((c) => c.risesAt !== undefined || c.decayAt > state.tick)
}
