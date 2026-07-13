/**
 * Le combat — endurance, télégraphes, blessures, mort (spec combat, GDD §7).
 *
 * Un combat de coût, pas de skill pur : tout se paie en endurance, les
 * blessures sont le vrai prix des coups, et la mort lâche tout ce qu'on
 * porte. Le même pipeline résout les coups des joueurs, des PNJ et des
 * monstres — personne ne triche.
 */
import { damageModifier, hasAggressionBetween, isOutsider, recordAct, recordHostility, regenFactor } from './alignment'
import { ALIGNMENT, BALANCE, CARRY, CENDREUX, COMBAT, FAUNA, MONSTER_DEFS, SLOTS, WEAPON_DAMAGE } from './balance'
import { willRiseAsCendreux } from './cendreux'
import { isInvulnerable } from './debug'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { heldSlot, wearHeld } from './inventory-actions'
import { addItems, addSlot, isEmpty, makeInventory, pourInto, removeItems, carryRatio } from './items'
import { staminaPoiFactor } from './poi-discovery'
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

/**
 * Les dégâts viennent de l'arme TENUE (spec inventaire R9), pas de la meilleure
 * du sac : une lance au fond du sac ne frappe pas plus fort qu'un poing. Un outil
 * n'est pas une arme (spec combat R5) — seul ce qui figure dans WEAPON_DAMAGE
 * frappe fort.
 */
export function weaponDamage(entity: Entity): number {
  const slot = heldSlot(entity)
  if (slot === null) return COMBAT.UNARMED_DAMAGE
  const dmg = WEAPON_DAMAGE[slot.item]
  return dmg !== undefined && dmg > COMBAT.UNARMED_DAMAGE ? dmg : COMBAT.UNARMED_DAMAGE
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
      // Sac BORNÉ (spec inventaire R11, critère A21) : on prend ce qui rentre,
      // case à case — l'usure voyage avec la case (R6), une hache usée trouvée
      // sur un cadavre reste une hache usée. Le cadavre GARDE le reste : rien ne
      // s'évapore. Et il ne disparaît QUE vidé — sans quoi looter avec un sac
      // plein effacerait le butin qu'on n'a pas pu emporter.
      const moved = pourInto(corpse.inventory, actor.inventory)
      if (isEmpty(corpse.inventory)) {
        state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
        emitEvent(state, { type: 'corpse_looted', tick: state.tick, corpseId: corpse.id, byEntityId: actorId })
        return
      }
      // Rien n'a bougé : l'action n'a pas eu lieu, et elle le dit.
      if (moved === 0) return reject('sac plein')
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

  // Une bête ne mord pas les siens. Le pipeline de résolution ne connaît pas les
  // camps (« personne ne triche ») et frappe TOUT ce qui est dans l'arc — ce qui
  // était sans conséquence tant que les monstres arrivaient en file. Depuis
  // l'encerclement (spec faune R11), les loups se placent de part et d'autre de
  // la proie : l'arc de 90° attrapait le frère d'en face, et la meute se décimait
  // toute seule (attrapé par le test de dispersion). La harde/meute est la SEULE
  // exception, et elle est étroite : deux zombies d'une même horde n'ont pas de
  // `herdId`, et continuent donc de se gêner comme avant.
  const herdOf = (id: number): number | undefined => state.monsters.find((m) => m.entityId === id)?.herdId
  const attackerHerd = herdOf(attacker.id)

  let struck = false
  for (const target of state.entities) {
    if (target.id === attacker.id || target.hp <= 0) continue
    if (attackerHerd !== undefined && herdOf(target.id) === attackerHerd) continue
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

  // L'arme s'use au contact — dans SA case (spec inventaire R6).
  if (struck && windup.damage === undefined) {
    const held = heldSlot(attacker)
    if (held !== null && WEAPON_DAMAGE[held.item] !== undefined) wearHeld(attacker, 1)
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
  // loot du monstre (le sanglier donne sa viande). Son sac est assez grand pour
  // que rien ne soit jamais tronqué (spec inventaire R11).
  const loot = makeInventory(SLOTS.CORPSE)
  if (monster) addItems(loot, MONSTER_DEFS[monster.type].loot)
  // Les CASES passent au cadavre (spec inventaire R11), pas un sac reconstruit :
  // sinon la mort réparerait les outils qu'on portait (l'usure vit dans la case).
  for (const slot of entity.inventory) if (slot !== null) addSlot(loot, slot)
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
  } else if (!isEmpty(loot)) {
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

    // LA PRESSION DE CHASSE (spec faune R16). Le gibier déserte ce qu'on vient de
    // chasser : plus une seule naissance ambiante autour d'ici pendant un moment.
    // Sans cette règle, l'anneau de peuplement remplace la bête abattue en une
    // demi-seconde, et la chasse devient un robinet qu'on ouvre sans bouger.
    //
    // Un LOUP ne compte pas : tuer un prédateur n'a jamais fait fuir le gibier.
    const wild = MONSTER_DEFS[monster.type]
    if ((wild.habitat?.length ?? 0) > 0 && !wild.predator) {
      state.faunaQuiet = state.faunaQuiet.filter((q) => q.until > state.tick)
      state.faunaQuiet.push({ x: entity.x, y: entity.y, until: state.tick + FAUNA.QUIET_TICKS })
    }
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
  entity.inventory = makeInventory(entity.inventory.length)
  entity.activeSlot = -1 // la mort lâche tout, et rengaine (spec inventaire R12)
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
    // SURCHARGÉ, ON NE FUIT PAS (spec portage.md P7) : l'endurance ne revient
    // presque plus. Un porteur surchargé est une PROIE — il ne se bat pas, il ne
    // fuit pas, il rentre. C'est le PvP léger des routes que veut le GDD §8bis.
    if (carryRatio(entity.inventory) > 1) perS *= CARRY.OVERLOAD_STAMINA_REGEN
    perS *= coldStaminaRegenFactor(entity.temperature)
    perS *= staminaPoiFactor(state, entity.x, entity.y) // le Tarn est une halte
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
