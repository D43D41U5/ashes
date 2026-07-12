/**
 * Les expéditions des PNJ (spec alignement R13-R14) — raids de Meute la
 * nuit, dons de Foyer au matin.
 *
 * L'expédition est une machine à étapes (fetch/go/smash/loot/home) qui passe
 * par le MÊME pipeline d'actions validées qu'un joueur (spec pnj R1) : le
 * raid casse le grenier par startAttack, le don dépose par applyVillageAction.
 */
import { ALIGNMENT, BALANCE, COMBAT, NPC_AI } from './balance'
import { applyCombatAction, startAttack } from './combat'
import { distSq } from './geometry'
import { countOf, itemsIn } from './items'
import { deposit, dropTask, equipBestWeapon, followPath, near, setPathTo, withdraw, type Npc } from './npc'
import type { Entity, SimState } from './sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE } from './time'
import type { Structure, Village } from './village'
import { granaries } from './village-board'

/** Looter un cadavre par le pipeline standard (raid, spec alignement R13). */
function applyCombatLoot(state: SimState, entityId: number, corpseId: number): void {
  applyCombatAction(state, entityId, { type: 'loot_corpse', corpseId })
}

/** Le grenier d'un AUTRE village (cible de raid ou de don). */
function foreignGranary(state: SimState, targetVillageId: number): Structure | undefined {
  return state.structures.find(
    (s) => s.type === 'chest' && s.villageId === targetVillageId && s.access === 'village',
  )
}

function nearestOtherVillage(state: SimState, village: Village): Village | undefined {
  let best: Village | undefined
  let bestD = Infinity
  for (const v of state.villages) {
    if (v.id === village.id || !foreignGranary(state, v.id)) continue
    const d = distSq(v.fireTx, v.fireTy, village.fireTx, village.fireTy)
    if (d < bestD) {
      best = v
      bestD = d
    }
  }
  return best
}

/** Assigne les expéditions : raids de Meute à la nuit, dons de Foyer au matin. */
export function assignErrands(state: SimState): void {
  const cycleTick = state.tick % TICKS_PER_CYCLE
  if (cycleTick === DAY_TICKS_PER_CYCLE) {
    for (const village of state.villages) {
      if (village.archetype !== 'meute') continue
      // On ne raide pas quand la meute est exsangue (< 3 vivants).
      if (state.npcs.filter((n) => n.villageId === village.id).length < NPC_AI.RAID_MIN_ALIVE) continue
      const target = nearestOtherVillage(state, village)
      if (!target) continue
      const raiders = state.npcs.filter((n) => n.villageId === village.id && !n.errand).slice(0, NPC_AI.RAIDERS_PER_RAID)
      for (const raider of raiders) {
        raider.errand = { kind: 'raid', targetVillageId: target.id, stage: 'go' }
        raider.sleeping = false
        raider.path = []
        if (raider.task) dropTask(village, raider, false)
      }
    }
  }
  if (cycleTick === 0 && state.tick > 0) {
    for (const village of state.villages) {
      // À l'aube, les raiders décrochent.
      for (const npc of state.npcs) {
        if (npc.villageId === village.id && npc.errand?.kind === 'raid' && npc.errand.stage !== 'home') {
          npc.errand.stage = 'home'
          npc.path = []
        }
      }
      if (village.archetype !== 'foyer') continue
      const granary = granaries(state, village.id)[0]
      // Un Foyer donne dès que le grenier couvre DEUX dons : un pour le
      // voisin, un de réserve pour les siens — généreux, pas suicidaire.
      if (!granary || countOf(granary.inventory ?? [], 'berries') < 2 * ALIGNMENT.GIFT_BERRIES) continue
      const target = nearestOtherVillage(state, village)
      if (!target) continue
      const giver = state.npcs.find((n) => n.villageId === village.id && !n.errand)
      if (giver) {
        giver.errand = { kind: 'gift', targetVillageId: target.id, stage: 'fetch' }
        giver.path = []
        if (giver.task) dropTask(village, giver, false)
      }
    }
  }
}

/** Exécute l'expédition du PNJ. Retourne true si elle a consommé le tick. */
export function handleErrand(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
  const errand = npc.errand
  if (!errand) return false
  const done = (): boolean => {
    npc.errand = null
    npc.path = []
    return true
  }

  if (errand.kind === 'gift') {
    if (errand.stage === 'fetch') {
      const own = granaries(state, village.id)[0]
      if (!own) return done()
      if (countOf(entity.inventory, 'berries') >= ALIGNMENT.GIFT_BERRIES) {
        errand.stage = 'go'
        npc.path = []
        return true
      }
      if (near(entity, own.tx, own.ty)) {
        // Retrait MESURÉ : sac plein (ou grenier vidé entre-temps) → rien ne sort.
        // Partir « donner » les mains vides, c'est une expédition à vide qui se
        // fera refuser son dépôt à l'arrivée. On décroche ici.
        if (withdraw(state, entity, own.id, 'berries', ALIGNMENT.GIFT_BERRIES) === 0) return done()
        errand.stage = 'go'
        return true
      }
      if (npc.path.length === 0 && !setPathTo(state, npc, entity, own.tx, own.ty)) return done()
      followPath(state, npc, entity)
      return true
    }
    if (errand.stage === 'go') {
      const target = foreignGranary(state, errand.targetVillageId)
      if (!target) return done()
      if (near(entity, target.tx, target.ty)) {
        // Le dépôt est ouvert (spec R11) : le don du Foyer. Mesuré, et jamais à
        // vide : un `count: 0` ne serait qu'un `action_rejected` de plus.
        const count = countOf(entity.inventory, 'berries')
        if (count === 0) return done()
        deposit(state, entity, target.id, 'berries', count) // grenier plein : il garde et rentre
        errand.stage = 'home'
        npc.path = []
        return true
      }
      if (npc.path.length === 0 && !setPathTo(state, npc, entity, target.tx, target.ty)) return done()
      followPath(state, npc, entity)
      return true
    }
    // home
    if (near(entity, village.fireTx, village.fireTy, 2)) return done()
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, village.fireTx, village.fireTy)) return done()
    followPath(state, npc, entity)
    return true
  }

  // Le raid (spec R13). Blessé : on décroche (le combat de coût, GDD §7).
  if (entity.hp < NPC_AI.RAID_DISENGAGE_HP && errand.stage !== 'home') {
    errand.stage = 'home'
    npc.path = []
  }
  // En chemin : on frappe qui n'est pas des nôtres.
  const foe = state.entities.find(
    (e) =>
      e.id !== entity.id &&
      e.hp > 0 &&
      !village.memberIds.includes(e.id) &&
      !state.monsters.some((m) => m.entityId === e.id) &&
      distSq(e.x, e.y, entity.x, entity.y) <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE,
  )
  if (foe && !entity.windup && state.tick >= entity.cooldownUntil && entity.stamina >= COMBAT.ATTACK_STAMINA) {
    equipBestWeapon(entity) // l'arme TENUE fait foi (spec inventaire R9)
    if (startAttack(state, entity, foe.x - entity.x, foe.y - entity.y)) {
      entity.cooldownUntil = state.tick + BALANCE.TICK_RATE_HZ
    }
    return true
  }
  if (entity.windup) return true

  if (errand.stage === 'go') {
    const target = foreignGranary(state, errand.targetVillageId)
    if (!target) return done()
    if (near(entity, target.tx, target.ty)) {
      errand.stage = 'smash'
      npc.path = []
      return true
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, target.tx, target.ty)) return done()
    followPath(state, npc, entity)
    return true
  }
  if (errand.stage === 'smash') {
    const target = foreignGranary(state, errand.targetVillageId)
    if (!target) {
      errand.stage = 'loot'
      return true
    }
    if (state.tick >= entity.cooldownUntil && entity.stamina >= COMBAT.ATTACK_STAMINA) {
      equipBestWeapon(entity) // le siège aussi frappe avec l'arme TENUE (R9)
      if (startAttack(state, entity, target.tx + 0.5 - entity.x, target.ty + 0.5 - entity.y, { structureId: target.id })) {
        entity.cooldownUntil = state.tick + COMBAT.ATTACK_COOLDOWN_TICKS
      }
    }
    return true
  }
  if (errand.stage === 'loot') {
    const corpse = state.corpses.find((c) => distSq(c.x, c.y, entity.x, entity.y) <= NPC_AI.CORPSE_SEARCH_RANGE * NPC_AI.CORPSE_SEARCH_RANGE)
    if (corpse) {
      applyCombatLoot(state, entity.id, corpse.id)
    }
    errand.stage = 'home'
    npc.path = []
    return true
  }
  // home : rentrer et déposer le butin au grenier.
  const own = granaries(state, village.id)[0]
  if (own && near(entity, own.tx, own.ty)) {
    for (const item of itemsIn(entity.inventory)) {
      if (item === 'spear') continue
      const count = countOf(entity.inventory, item)
      if (count > 0) {
        // Le grenier est borné : un dépôt peut ne RIEN déplacer. Reprendre la
        // boucle telle quelle, c'est retenter ce dépôt à chaque tick jusqu'à la
        // fin des temps — le raider ne rentrerait jamais. Il garde son butin et
        // décroche : l'expédition est finie.
        if (deposit(state, entity, own.id, item, count) === 0) return done()
        return true // un dépôt par tick
      }
    }
    return done()
  }
  const homeTarget = own ?? { tx: village.fireTx, ty: village.fireTy }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, homeTarget.tx, homeTarget.ty)) return done()
  followPath(state, npc, entity)
  return true
}
