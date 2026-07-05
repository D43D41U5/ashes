/**
 * Le temps — fonctions pures du numéro de tick (spec monde R1-R4).
 *
 * Deux échelles distinctes :
 * - Le CYCLE (jour/nuit diégétique) : durée réelle fixe, jamais accélérée —
 *   c'est le rythme moment-à-moment des sessions.
 * - Le CALENDRIER (jour de saison, actes) : accéléré par `calendarScale`
 *   (1 en multi ; grand en Veillée et en test pour jouer une saison vite).
 */
import { BALANCE } from './balance'
import { emitEvent } from './events'
import type { SimState } from './sim'

export const TICKS_PER_CYCLE = BALANCE.CYCLE_REAL_MINUTES * 60 * BALANCE.TICK_RATE_HZ
export const DAY_TICKS_PER_CYCLE = Math.round(TICKS_PER_CYCLE * BALANCE.CYCLE_DAY_FRACTION)
/** Ticks par jour de saison à l'échelle 1 (un jour réel). */
export const TICKS_PER_SEASON_DAY = 86400 * BALANCE.TICK_RATE_HZ

export type Act = 1 | 2 | 3

export interface GameTime {
  tick: number
  /** Heure fictive du cycle, dans [0, 24). Jour : [0, 15), nuit : [15, 24). */
  hourOfCycle: number
  isNight: boolean
  /** Jour de saison, à partir de 1. Peut dépasser SEASON_DAYS (la Cendre finale). */
  seasonDay: number
  act: Act
}

export function seasonDayAtTick(tick: number, calendarScale: number): number {
  return Math.floor((tick * calendarScale) / TICKS_PER_SEASON_DAY) + 1
}

export function actForDay(day: number): Act {
  if (day <= BALANCE.ACT_BOUNDARIES[0]) return 1
  if (day <= BALANCE.ACT_BOUNDARIES[1]) return 2
  return 3
}

export function getGameTime(state: SimState): GameTime {
  const cycleTick = state.tick % TICKS_PER_CYCLE
  const seasonDay = seasonDayAtTick(state.tick, state.calendarScale)
  return {
    tick: state.tick,
    hourOfCycle: (cycleTick / TICKS_PER_CYCLE) * 24,
    isNight: cycleTick >= DAY_TICKS_PER_CYCLE,
    seasonDay,
    act: actForDay(seasonDay),
  }
}

/**
 * Incrémente le tick et émet les événements de temps franchis.
 * Appelé une fois par step(), en fin de tick.
 */
export function advanceTime(state: SimState): void {
  const dayBefore = seasonDayAtTick(state.tick, state.calendarScale)
  state.tick += 1

  const cycleTick = state.tick % TICKS_PER_CYCLE
  if (cycleTick === 0) emitEvent(state, { type: 'day_started', tick: state.tick })
  if (cycleTick === DAY_TICKS_PER_CYCLE) emitEvent(state, { type: 'night_started', tick: state.tick })

  const dayAfter = seasonDayAtTick(state.tick, state.calendarScale)
  // À très grande échelle, un tick peut franchir plusieurs jours : on émet chacun.
  for (let day = dayBefore + 1; day <= dayAfter; day++) {
    emitEvent(state, { type: 'season_day_started', tick: state.tick, day })
    if (actForDay(day) !== actForDay(day - 1)) {
      emitEvent(state, { type: 'act_started', tick: state.tick, act: actForDay(day) })
    }
  }
}
