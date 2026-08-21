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
  /**
   * Heure murale du cycle, dans [0, 24) — minuit (0h) au cœur de la nuit, midi en
   * plein jour. Le cycle démarre à l'aube (CYCLE_DAWN_HOUR) ; avec DAWN=6 et
   * DAY_FRACTION=0.625 : jour 6h→21h, nuit 21h→6h (bascule reflétée par `isNight`).
   */
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

/**
 * LA RAMPE DE SAISON — une pression qui monte JOUR APRÈS JOUR, pas par actes (décisions
 * d'Alexis 2026-08-21 : « une table de trois valeurs, et une table est plate »).
 *
 * CLAMPÉE au jour `SEASON_DAYS`, et ce n'est pas un détail : `seasonDayAtTick` est NON BORNÉ
 * (« peut dépasser SEASON_DAYS — la Cendre finale »), et `advanceWorldEvents` continue après
 * `seasonEnded`. Les tables d'actes étaient clampées par construction (`actForDay` rend 3 pour
 * toujours) ; une rampe nue aurait extrapolé — horde certaine chaque nuit du jour 75, plafonds
 * qui grimpent sans fin — très exactement là où T15 (« on ne doit pas être submergé ») compte
 * le plus. Le jour 60 est le sommet, la Cendre finale y RESTE.
 */
export function seasonRamp(debut: number, fin: number, day: number): number {
  const frac = Math.min(day, BALANCE.SEASON_DAYS) / BALANCE.SEASON_DAYS
  return debut + (fin - debut) * frac
}

/**
 * LE COUPLAGE VEILLÉE (V0-9) — dérive le `calendarScale` pour qu'une saison de `SEASON_DAYS`
 * jours s'étende sur EXACTEMENT `cycles` cycles jour/nuit.
 *
 * Le problème que ça règle (réserve de la spec saison) : en Veillée, le calendrier est
 * accéléré indépendamment du cycle. À une échelle trop forte, les 60 jours défilent en 2,5
 * cycles → le premier crépuscule de l'acte III (où déferle la méga-horde) tombe APRÈS la fin
 * de saison, et toute la pression de l'endgame est INOBSERVABLE en solo. En liant l'échelle
 * au nombre de cycles, la saison dure `cycles` cycles pile : chaque nuit est un pas
 * observable du calendrier, et l'acte III tient dans la saison.
 *
 * `cycles` est la CALIBRATION — durée de session, densité d'escalade (à régler en playtest,
 * cf. `VEILLEE_SEASON_CYCLES` côté client). Le couplage, lui, est MÉCANIQUE : il tient quel
 * que soit `CYCLE_REAL_MINUTES`, on ne re-calera jamais l'échelle à la main. Pur, déterministe
 * (× et /) — n'affecte que le mapping tick→jour, jamais le flux RNG.
 */
export function calendarScaleForSeasonCycles(cycles: number): number {
  return (BALANCE.SEASON_DAYS * TICKS_PER_SEASON_DAY) / (cycles * TICKS_PER_CYCLE)
}

/**
 * Décalage de phase (ticks) pour qu'une partie DÉMARRE à `startHour` (horloge
 * murale, 0-24). N'affecte que le cycle jour/nuit, jamais le calendrier de
 * saison. Ex. `cycleOffsetForStartHour(0)` → commencer à minuit (en pleine nuit).
 */
export function cycleOffsetForStartHour(startHour: number): number {
  const fromDawn = (((startHour - BALANCE.CYCLE_DAWN_HOUR) % 24) + 24) % 24
  return Math.round((fromDawn / 24) * TICKS_PER_CYCLE)
}

/**
 * L'HEURE DU MONDE À UN TICK QUELCONQUE — la même loi que `getGameTime`, prise sur un tick
 * fourni plutôt que sur celui de l'état.
 *
 * Elle existe pour L'HYSTÉRÉSIS DU DÉGEL (spec `gel.md` G8) : le gel doit savoir s'il faisait
 * franchement froid ICI il y a un instant, ce qui demande de relire l'heure du passé proche.
 * Le tick est la seule horloge (spec `monde.md` R1) — donc ce passé se RECALCULE, il ne se
 * range pas. `getGameTime` n'est plus qu'elle, prise sur `state.tick` : mêmes expressions,
 * même ordre, au bit près.
 */
export function gameTimeAt(state: SimState, tick: number): GameTime {
  const cycleTick = (tick + state.cycleOffset) % TICKS_PER_CYCLE
  const seasonDay = seasonDayAtTick(tick, state.calendarScale)
  // Le cycle démarre à l'aube ; on décale la phase vers une horloge murale.
  const wallHour = (cycleTick / TICKS_PER_CYCLE) * 24 + BALANCE.CYCLE_DAWN_HOUR
  return {
    tick,
    hourOfCycle: wallHour % 24,
    isNight: cycleTick >= DAY_TICKS_PER_CYCLE,
    seasonDay,
    act: actForDay(seasonDay),
  }
}

export function getGameTime(state: SimState): GameTime {
  return gameTimeAt(state, state.tick)
}

/**
 * Incrémente le tick et émet les événements de temps franchis.
 * Appelé une fois par step(), en fin de tick.
 */
export function advanceTime(state: SimState): void {
  const dayBefore = seasonDayAtTick(state.tick, state.calendarScale)
  state.tick += 1

  const cycleTick = (state.tick + state.cycleOffset) % TICKS_PER_CYCLE
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
