/**
 * Les besoins des PNJ (spec pnj R3, étage 1) — manger, dormir, l'énergie.
 *
 * Les besoins critiques priment sur le tableau du village : un PNJ affamé
 * mange (inventaire, puis grenier), un PNJ épuisé dort la nuit (chez lui,
 * sinon au Feu). Chaque handler retourne true s'il a consommé le tick.
 */
import { BALANCE, NPC_AI } from './balance'
import { applyEconomyAction } from './economy'
import { countOf } from './items'
import { followPath, near, setPathTo, TICKS_PER_HOUR, type Npc } from './npc'
import type { Entity, SimState } from './sim'
import { getGameTime } from './time'
import { applyVillageAction, type Village } from './village'
import { granaries } from './village-board'

/** Retourne true si le besoin a consommé le tick. */
export function handleHunger(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
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
        count: Math.min(NPC_AI.EAT_BERRIES_WITHDRAW, countOf(inv, 'berries')),
      })
    }
    return true
  }
  if (npc.path.length === 0) setPathTo(state, npc, entity, chest.tx, chest.ty)
  followPath(state, npc, entity)
  return true
}

export function handleSleep(state: SimState, npc: Npc, entity: Entity): boolean {
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
