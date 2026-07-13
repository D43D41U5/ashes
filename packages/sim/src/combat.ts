/**
 * Le combat — endurance, télégraphes, blessures, mort (spec combat, GDD §7).
 *
 * Un combat de coût, pas de skill pur : tout se paie en endurance, les
 * blessures sont le vrai prix des coups, et la mort lâche tout ce qu'on
 * porte. Le même pipeline résout les coups des joueurs, des PNJ et des
 * monstres — personne ne triche.
 */
import { damageModifier, hasAggressionBetween, isOutsider, recordAct, recordHostility, regenFactor } from './alignment'
import {
  ALIGNMENT,
  BALANCE,
  CARRY,
  CENDREUX,
  COMBAT,
  FAUNA,
  MONSTER_DEFS,
  SLOTS,
  WEAPON_DAMAGE,
  WEAPON_PROFILES,
  type Strike,
  type WeaponKind,
  type WeaponProfile,
} from './balance'
import { willRiseAsCendreux } from './cendreux'
import { resolveMove } from './collision'
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
  /**
   * J'APPUIE : la charge commence (et se re-vise, tant que le clic tient).
   * `hold` : ce n'est pas l'appui, c'est le MAINTIEN — le client en émet un toutes les
   * 100 ms pour rafraîchir la visée. Il est donc SILENCIEUX quand il échoue : sans
   * ça, garder le doigt appuyé pendant une récupération punitive (jusqu'à 1,5 s)
   * cracherait quinze « trop tôt » dans le flux d'événements que l'alignement et la
   * chronique consomment. Le flux n'est pas une poubelle (recolte.md G6). Et c'est
   * aussi ce qui rend le maintien FORGIVING : la charge démarre d'elle-même à la
   * seconde où la récupération s'achève, sans relâcher ni recliquer.
   */
  | { type: 'attack_charge'; dx: number; dy: number; hold?: boolean }
  /** JE RELÂCHE : le coup part — simple ou chargé, selon ce que la sim a compté. */
  | { type: 'attack_release'; dx: number; dy: number }
  | { type: 'bandage'; targetEntityId?: number }
  | { type: 'loot_corpse'; corpseId: number }

/**
 * L'ARME TENUE décide de TOUT (spec inventaire R9) : pas la meilleure du sac. Une
 * lance au fond du sac ne frappe pas plus fort qu'un poing. Un outil n'est pas une
 * arme (spec combat R5) — ce qui n'a pas de profil frappe à mains nues, manche compris.
 */
export function weaponKind(entity: Entity): WeaponKind {
  const slot = heldSlot(entity)
  if (slot === null) return 'unarmed'
  const kind = slot.item as WeaponKind
  return WEAPON_PROFILES[kind] !== undefined && kind !== 'unarmed' ? kind : 'unarmed'
}

/** Les deux coups de ce qu'on tient — c'est la seule règle d'arme du jeu. */
export function weaponProfile(entity: Entity): WeaponProfile {
  return WEAPON_PROFILES[weaponKind(entity)]
}

/** Dégâts du coup SIMPLE de l'arme tenue (le coup chargé, lui, fait bien plus mal). */
export function weaponDamage(entity: Entity): number {
  return weaponProfile(entity).light.damage
}

/**
 * Le coup que ce corps porterait s'il RELÂCHAIT MAINTENANT. C'est la fonction que le
 * télégraphe interroge : la zone dessinée à l'écran est celle-ci, toujours — jamais
 * une approximation décorative (voir `attack-fx.ts`).
 */
export function pendingStrike(entity: Entity): Strike {
  const profile = weaponProfile(entity)
  return isChargeFull(entity, profile) ? profile.charged : profile.light
}

/**
 * À QUELLE DISTANCE UNE IA DÉCLENCHE SON COUP. Ce n'était qu'une constante
 * (`MELEE_ENGAGE_RANGE`) tant que tout le monde frappait à 1,4 — et cette constante
 * est devenue un MENSONGE le jour où l'arme a décidé de la portée : un PNJ à mains
 * nues (1,1) déclenchait à 1,2, donc frappait TOUJOURS dans le vide, donc mangeait la
 * récupération punitive à chaque coup. La milice est devenue un sac de frappe en une
 * ligne de balance. Une IA engage à la portée de CE QU'ELLE TIENT, avec une marge :
 * on entre dans sa zone, on ne s'arrête pas pile sur son bord.
 *
 * Les BÊTES gardent `MELEE_ENGAGE_RANGE` : elles ne tiennent rien, et leur morsure a
 * sa portée à elle (`beastStrike`, 1,4).
 */
export function engageRange(entity: Entity): number {
  return weaponProfile(entity).light.range * COMBAT.ENGAGE_MARGIN
}

/** La charge est-elle mûre — assez longue ET payable ? */
function isChargeFull(entity: Entity, profile: WeaponProfile): boolean {
  return (
    entity.charge !== undefined &&
    entity.charge.ticks >= profile.chargeTicks &&
    entity.stamina >= profile.charged.stamina
  )
}

/**
 * Le coup des BÊTES : l'arc historique (1,4 tuile, 90°), leurs dégâts, leur cadence.
 * Elles gardent leur rythme de `MONSTER_DEFS` — d'où `recovery: 0`, « je n'impose
 * rien ». Une bête ne tient pas d'arme : lui faire suivre WEAPON_PROFILES lui
 * donnerait la portée d'un poing, et la nuit qu'on vient de calibrer s'effondrerait.
 */
function beastStrike(damage: number, windupTicks: number): Strike {
  return {
    shape: 'cone',
    range: COMBAT.ATTACK_RANGE,
    arcCos: COMBAT.ATTACK_ARC_COS,
    radius: 0,
    damage,
    stamina: COMBAT.ATTACK_STAMINA,
    windupTicks,
    recoveryHit: 0,
    recoveryWhiff: 0,
    lunge: 0,
    weave: false,
  }
}

/**
 * LA ZONE, TESTÉE. Deux primitives, et le cas 360° tombe tout seul (`arcCos = -1` :
 * tout cosinus lui est supérieur, donc tout ce qui est à portée est touché).
 */
function inStrikeZone(strike: Strike, ax: number, ay: number, dx: number, dy: number, tx: number, ty: number): boolean {
  if (strike.shape === 'disc') {
    // Le disque est posé DEVANT le corps, à `range` : l'overhead s'écrase au sol.
    const ox = tx - (ax + dx * strike.range)
    const oy = ty - (ay + dy * strike.range)
    return ox * ox + oy * oy <= strike.radius * strike.radius
  }
  const rx = tx - ax
  const ry = ty - ay
  const d2 = rx * rx + ry * ry
  if (d2 > strike.range * strike.range || d2 === 0) return false
  if (strike.arcCos <= -1) return true // le tourbillon : tout le tour
  const dist = Math.sqrt(d2)
  return (rx * dx + ry * dy) / dist >= strike.arcCos
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

    /**
     * LE CLIC S'ENFONCE. On ne frappe pas encore : on ARME. La sim compte les ticks
     * de maintien (`advanceCombat`), et c'est elle seule qui décide, au relâchement,
     * si le coup part simple ou chargé — le client ne fait que dire « je maintiens,
     * et je vise par là ». Tant que le clic tient, la visée se RAFRAÎCHIT : on charge
     * un tourbillon en pivotant vers le loup qui contourne.
     */
    case 'attack_charge': {
      // Le MAINTIEN ne se plaint pas (voir `CombatAction`) : seul l'APPUI a droit à
      // un refus. Un doigt posé sur le bouton n'est pas une demande répétée.
      const plainte = action.hold === true ? (): void => {} : reject
      if (actor.windup) return plainte('déjà en train de frapper')
      if (state.tick < actor.cooldownUntil) return plainte('trop tôt')
      const len = Math.sqrt(action.dx * action.dx + action.dy * action.dy)
      if (len < 0.0001) return plainte('direction invalide')
      if (actor.charge) {
        actor.charge.dx = action.dx / len
        actor.charge.dy = action.dy / len
        return
      }
      // Le coup SIMPLE doit être payable pour seulement commencer à armer : sans
      // cette garde, un joueur à bout de souffle chargerait dans le vide et ne
      // comprendrait le refus qu'au relâchement — un demi-tour trop tard.
      if (actor.stamina < weaponProfile(actor).light.stamina) return plainte('à bout de souffle')
      actor.charge = { dx: action.dx / len, dy: action.dy / len, ticks: 0 }
      actor.facing = { x: action.dx / len, y: action.dy / len }
      return
    }

    /** LE CLIC SE LÈVE : le coup part. Chargé s'il a mûri ET qu'on peut le payer. */
    case 'attack_release': {
      const charge = actor.charge
      delete actor.charge
      if (!charge) return // rien d'armé : le relâchement est muet, ce n'est pas un refus
      const profile = weaponProfile(actor)
      // La charge se juge AVANT de dépenser (isChargeFull lit `stamina`) ; on vise
      // là où le curseur est MAINTENANT, pas là où il était à l'appui.
      const charged = charge.ticks >= profile.chargeTicks && actor.stamina >= profile.charged.stamina
      const len = Math.sqrt(action.dx * action.dx + action.dy * action.dy)
      const dx = len < 0.0001 ? charge.dx : action.dx
      const dy = len < 0.0001 ? charge.dy : action.dy
      startAttack(state, actor, dx, dy, { reject, strike: charged ? profile.charged : profile.light, charged })
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

/** Options de `startAttack` — les défauts sont ceux du coup simple de l'arme tenue. */
export interface StartAttackOptions {
  /** Rapporte la raison d'un refus (émission d'`action_rejected` côté joueur). */
  reject?: (reason: string) => void
  /** Durée du télégraphe (bêtes) — défaut : celui du coup. */
  windupTicks?: number
  /** Dégâts imposés (bêtes) — elles frappent avec l'arc historique, pas une arme. */
  damage?: number
  /** Cible structure (siège) au lieu de la zone contre les entités. */
  structureId?: number
  /** La FORME du coup — défaut : le coup simple de ce qu'on tient. */
  strike?: Strike
  /** Le coup est CHARGÉ (le client le peint autrement ; la sim le transporte). */
  charged?: boolean
}

/** Démarre un wind-up d'attaque (utilisé par joueurs, PNJ et monstres). */
export function startAttack(
  state: SimState,
  actor: Entity,
  dx: number,
  dy: number,
  opts: StartAttackOptions = {},
): boolean {
  const { reject, windupTicks, damage, structureId, charged } = opts
  if (actor.windup) {
    reject?.('déjà en train de frapper')
    return false
  }
  if (state.tick < actor.cooldownUntil) {
    reject?.('trop tôt')
    return false
  }
  // La FORME du coup, dans l'ordre : imposée (relâchement d'une charge) > bête
  // (dégâts imposés) > l'arme tenue. Une bête garde l'arc historique : elle ne
  // tient rien, et lui donner le profil des poings lui volerait sa portée.
  const base =
    opts.strike ?? (damage !== undefined ? beastStrike(damage, windupTicks ?? COMBAT.WINDUP_TICKS) : weaponProfile(actor).light)
  const strike: Strike = windupTicks !== undefined && opts.strike === undefined ? { ...base, windupTicks } : base

  if (actor.stamina < strike.stamina) {
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
  actor.stamina -= strike.stamina
  actor.facing = { x: nx, y: ny }
  // LE PIED CHANGE À CHAQUE COUP : gauche, droite, gauche… La sim tient le compte —
  // sans quoi, en multi, chacun verrait l'autre danser sur un rythme différent.
  const side: 1 | -1 = actor.swingSide === 1 ? 1 : -1
  actor.swingSide = side === 1 ? -1 : 1
  actor.windup = {
    dx: nx,
    dy: ny,
    ticksLeft: strike.windupTicks,
    strike,
    side,
    ...(charged ? { charged: true as const } : {}),
    ...(structureId !== undefined ? { structureId } : {}),
  }
  return true
}

/**
 * LE PAS DU COUP. On avance EN frappant : la sim déplace le corps (la position est
 * autoritative — jamais Phaser, invariant §3), collision comprise. Le pas des poings
 * DÉVIE d'un côté puis de l'autre, mais la VISÉE, elle, ne bouge pas : on frappe où
 * l'on regarde, seul le pied change de bord.
 *
 * LA CHARGE TRAVERSE, ET C'EST ASSUMÉ (décision utilisateur, 2026-07-13). Le coup se
 * résout à la FIN du wind-up, depuis la position d'ARRIVÉE : un bond de trois tuiles
 * DÉPASSE le loup qui n'en est qu'à deux, et le laisse dans le dos — le cône, lui,
 * pointe devant. La charge devient donc une arme de DISTANCE : on la lance sur ce qui
 * est loin, pas sur ce qui est collé. Mal jugée, elle fend l'air et cloue sur place
 * (`recoveryWhiff` : 1,5 s). C'est le prix, et il est lisible.
 *
 * (J'avais d'abord fait s'ARRÊTER la charge sur la chair. C'était une mécanique de plus
 * pour sauver le joueur de sa propre visée — et une charge qui s'arrête toute seule
 * n'est plus une décision, c'est une assistance.)
 */
function advanceLunge(state: SimState, entity: Entity): void {
  const windup = entity.windup!
  const strike = windup.strike
  if (strike.lunge <= 0 || strike.windupTicks <= 0) return
  let dx = windup.dx
  let dy = windup.dy
  if (strike.weave) {
    const s = (windup.side ?? 1) * COMBAT.WEAVE_SIN
    const c = COMBAT.WEAVE_COS
    dx = windup.dx * c - windup.dy * s
    dy = windup.dx * s + windup.dy * c
  }
  const step = strike.lunge / strike.windupTicks
  const world = {
    map: state.map,
    structures: state.structures,
    nodes: state.nodes,
    moverVillageId: getVillageOf(state, entity.id)?.id ?? null,
  }
  const moved = resolveMove(world, entity.x, entity.y, dx * step, dy * step)
  entity.x = moved.x
  entity.y = moved.y
}

/** Résout le coup à la fin du wind-up : la ZONE du `strike` porté (spec R4). */
function resolveStrike(state: SimState, attacker: Entity): void {
  const windup = attacker.windup!
  const strike = windup.strike

  // Coup porté à une structure (les hordes frappent les murs, spec événements R1).
  if (windup.structureId !== undefined) {
    const s = state.structures.find((st) => st.id === windup.structureId)
    if (s && distSq(attacker.x, attacker.y, s.tx + 0.5, s.ty + 0.5) <= COMBAT.STRUCTURE_STRIKE_RANGE * COMBAT.STRUCTURE_STRIKE_RANGE) {
      applyStructureDamage(state, s.id, strike.damage, attacker.id)
    }
    delete attacker.windup
    return
  }

  const damage = attacker.wounds.arm ? strike.damage * COMBAT.ARM_WOUND_DAMAGE : strike.damage

  // Une bête ne mord pas les siens. Le pipeline de résolution ne connaît pas les
  // camps (« personne ne triche ») et frappe TOUT ce qui est dans la zone — ce qui
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
    if (!inStrikeZone(strike, attacker.x, attacker.y, windup.dx, windup.dy, target.x, target.y)) continue
    const tx = target.x - attacker.x
    const ty = target.y - attacker.y
    const dist = Math.sqrt(tx * tx + ty * ty)

    let dealt = damage * damageModifier(state, attacker.id, target.id)
    // Blocage directionnel (spec R6) : réduit si l'attaque arrive de face.
    if (target.blocking && target.stamina > 0 && dist > 0) {
      const facingCos = (-tx * target.facing.x - ty * target.facing.y) / dist
      if (facingCos >= COMBAT.BLOCK_ARC_COS) {
        dealt = damage * (1 - COMBAT.BLOCK_REDUCTION)
        target.stamina = Math.max(0, target.stamina - (COMBAT.BLOCK_STAMINA_BASE + damage / 2))
      }
    }
    applyDamage(state, target, dealt, attacker.id)
    struck = true
  }

  // L'arme s'use au contact — dans SA case (spec inventaire R6). Une bête ne tient
  // rien : la garde `heldSlot` suffit, inutile de tester d'où venaient les dégâts.
  if (struck) {
    const held = heldSlot(attacker)
    if (held !== null && WEAPON_DAMAGE[held.item] !== undefined) wearHeld(attacker, 1)
  }

  // LA RÉCUPÉRATION — et c'est le WHIFF qui punit. Toucher rend la main ; fendre
  // l'air laisse planté, arme lourde en avant, à découvert. C'est ce qui interdit de
  // charger à l'aveugle, et c'est là que le loup trouve sa fenêtre.
  //
  // Elle ne fait que REPOUSSER : `max`, jamais une affectation sèche. La leçon a
  // coûté un test — les PNJ et les bêtes posent LEUR cadence au DÉBUT du coup
  // (`cooldownUntil = tick + attackCooldownTicks`, monsters.ts/npc.ts) ; une
  // récupération plus courte que ce qu'ils s'étaient imposé la RACCOURCISSAIT, et la
  // milice s'est mise à frapper deux fois plus vite. Une récupération est un plancher
  // de temps mort, pas une autorisation de frapper plus tôt.
  const recovery = struck ? strike.recoveryHit : strike.recoveryWhiff
  if (recovery > 0) attacker.cooldownUntil = Math.max(attacker.cooldownUntil, state.tick + recovery)
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

export function die(state: SimState, entity: Entity, byEntityId: number, cause?: 'cold' | 'hunger'): void {
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
  delete entity.charge
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

  // LA CHARGE MONTE. On ne la laisse pas croître au-delà de sa maturité : la barre
  // du client lit `ticks / chargeTicks`, et une charge qui déborderait mentirait sur
  // ce qui va sortir. Maintenir plus longtemps ne rend pas le coup plus fort — ça
  // coûte seulement l'endurance qu'on ne régénère pas (voir plus bas).
  for (const entity of state.entities) {
    if (!entity.charge) continue
    if (entity.windup) {
      delete entity.charge // on ne charge pas pendant qu'on frappe
      continue
    }
    const max = weaponProfile(entity).chargeTicks
    if (entity.charge.ticks < max) entity.charge.ticks += 1
  }

  // Wind-ups (copie : resolveStrike peut tuer et retirer des entités).
  for (const entity of [...state.entities]) {
    if (entity.windup) {
      advanceLunge(state, entity) // on AVANCE en frappant (le pas, le pic, l'élan)
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
  // TENIR UNE CHARGE COÛTE : le souffle ne revient pas tant que le clic est enfoncé.
  // C'est le seul frein à se promener indéfiniment « prêt à frapper fort » — sans
  // lui, la charge serait gratuite dès qu'on ne se bat pas.
  for (const entity of state.entities) {
    if (entity.windup || entity.blocking || entity.charge) continue
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
