/**
 * Les besoins des PNJ (spec pnj R3, étage 1) — manger, dormir, l'énergie.
 *
 * Les besoins critiques priment sur le tableau du village : un PNJ affamé
 * mange (inventaire, puis grenier), un PNJ épuisé dort la nuit (chez lui,
 * sinon au Feu). Chaque handler retourne true s'il a consommé le tick.
 */
import { BALANCE, NPC_AI } from './balance'
import { applyEconomyAction } from './economy'
import { countOf, freeRoomFor, type ItemId } from './items'
import { followPath, near, setPathTo, TICKS_PER_HOUR, withdraw, type Npc } from './npc'
import type { Entity, SimState } from './sim'
import { fireBubble, isSheltered } from './temperature'
import { getGameTime } from './time'
import type { Structure, Village } from './village'
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
  // Aller retirer au grenier. ANTI-LIVELOCK (comme handleCold) : un sac plein ne
  // peut RIEN retirer. Un grenier qui a de quoi manger mais qu'on ne peut pas
  // porter n'est pas un grenier : on ne s'y rend pas, on n'y tente pas un retrait
  // à 20 Hz — on ne mange pas, mais on retourne travailler. La faim ne tue pas ;
  // le figeage, si (le PNJ ne ferait plus jamais rien d'autre).
  const canCarry = (item: ItemId): boolean => freeRoomFor(entity.inventory, item) > 0
  const eatable = (c: Structure): ItemId | null => {
    const inv = c.inventory ?? []
    if (countOf(inv, 'stew') > 0 && canCarry('stew')) return 'stew'
    if (countOf(inv, 'berries') > 0 && canCarry('berries')) return 'berries'
    return null
  }
  const chest = granaries(state, village.id).find((c) => eatable(c) !== null)
  if (!chest) return false // rien à manger (ou plus une case pour le porter) : on travaille
  if (near(entity, chest.tx, chest.ty)) {
    const item = eatable(chest)
    if (item === null) return false
    const count = item === 'stew' ? 1 : Math.min(NPC_AI.EAT_BERRIES_WITHDRAW, countOf(chest.inventory ?? [], 'berries'))
    // Le retrait est MESURÉ : s'il ne rapporte rien, on rend la main plutôt que
    // de se figer devant le coffre (spec inventaire R11).
    return withdraw(state, entity, chest.id, item, count) > 0
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

/**
 * Le froid (spec IA chaleur). Sous NPC_COLD_SEEK, un PNJ à découvert rentre à SON feu.
 * Rend la main dès qu'il se réchauffe (bulle de feu / abri) → il mange et travaille au coin
 * du feu (le village se blottit autour du Foyer). Anti-livelock : si le feu est inatteignable,
 * on rend la main plutôt que de figer le PNJ (mort de froid légitime, pas un yo-yo).
 */
export function handleCold(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
  // Assez chaud ? (hystérésis : une fois en recherche, on continue jusqu'au confort)
  if (!npc.seekingWarmth && entity.temperature >= BALANCE.NPC_COLD_SEEK) return false
  if (entity.temperature >= BALANCE.NPC_COLD_RESUME) {
    npc.seekingWarmth = false
    return false
  }
  // Déjà en train de se réchauffer ? → on laisse manger/travailler au coin du feu.
  if (fireBubble(state, entity.x, entity.y) > 0 || isSheltered(state, Math.floor(entity.x), Math.floor(entity.y))) {
    npc.seekingWarmth = false
    return false
  }
  // Froid et à découvert → repli vers son propre feu.
  npc.seekingWarmth = true
  const home = npc.homeId !== null ? state.structures.find((s) => s.id === npc.homeId) : undefined
  const target = home ?? state.structures.find((s) => s.type === 'fire' && s.villageId === village.id)
  if (!target) return false
  if (npc.path.length === 0) {
    if (!setPathTo(state, npc, entity, target.tx, target.ty)) return false // ANTI-LIVELOCK
  }
  followPath(state, npc, entity)
  return true
}
