/**
 * Le temps — fonctions pures du numéro de tick (spec monde R1-R4).
 *
 * Deux échelles distinctes :
 * - Le CYCLE (jour/nuit diégétique) : durée réelle fixe, jamais accélérée —
 *   c'est le rythme moment-à-moment des sessions.
 * - Le CALENDRIER (jour de saison, actes) : accéléré par `calendarScale`
 *   (1 en multi ; grand en Veillée et en test pour jouer une saison vite).
 */
import { BALANCE, TEMPERATURE, phaseOf, tourOf } from './balance'
import { emitEvent } from './events'
import type { SimState } from './sim'

export const TICKS_PER_CYCLE = BALANCE.CYCLE_REAL_MINUTES * 60 * BALANCE.TICK_RATE_HZ
export const DAY_TICKS_PER_CYCLE = Math.round(TICKS_PER_CYCLE * BALANCE.CYCLE_DAY_FRACTION)
/** Durée de la pente du froid nocturne, en ticks — dérivée de `NIGHT_RAMP_HOURS`, jamais écrite. */
export const NIGHT_RAMP_TICKS = Math.round((TEMPERATURE.NIGHT_RAMP_HOURS / 24) * TICKS_PER_CYCLE)
/** Ticks par jour de saison à l'échelle 1 (un jour réel). */
export const TICKS_PER_SEASON_DAY = 86400 * BALANCE.TICK_RATE_HZ

/**
 * L'ACTE EST UN ENTIER NON BORNÉ (spec `saison-sans-fin.md` R2 : il ne porte plus les chiffres,
 * il NOMME). Le type `1 | 2 | 3` d'origine figeait dans le temps ce que la spec délie — comme
 * `act_started.act` le figeait dans le bus. Les consommateurs passent par des LOIS totales
 * (`actLaw`, `balance.ts`), jamais par une table indexée : un acte 7 ne rend rien d'indéfini.
 * `actForDay` plafonne ENCORE à 3 — c'est le calendrier des tours (T2) qui le libère.
 */
export type Act = number

export interface GameTime {
  tick: number
  /**
   * Heure murale du cycle, dans [0, 24) — minuit (0h) au cœur de la nuit, midi en
   * plein jour. Le cycle démarre à l'aube (CYCLE_DAWN_HOUR) ; avec DAWN=6 et
   * DAY_FRACTION=0.625 : jour 6h→21h, nuit 21h→6h (bascule reflétée par `isNight`).
   */
  hourOfCycle: number
  isNight: boolean
  /**
   * LA PART DE NUIT, dans [0, 1] — le froid nocturne en PENTE (voir `partDeNuit`). Vaut 1
   * partout où `isNight` est vrai ; ce sont les lisières du JOUR qui la portent entre 0 et 1.
   * `isNight` reste le booléen des COMPORTEMENTS (la chasse nocturne, le brûlage, le ralliement
   * au feu ne se font pas « à 40 % ») ; `nuit` est celui du FROID, qui, lui, a une pente.
   */
  nuit: number
  /** Jour de saison, à partir de 1. Peut dépasser SEASON_DAYS (la Cendre finale). */
  seasonDay: number
  act: Act
  /** L'année, à partir de 1 — le TOUR des lois (T2). */
  tour: number
  /** La saison dans l'année, 1..ACTS_PER_YEAR — la PHASE des lois (T2). */
  phase: number
}

export function seasonDayAtTick(tick: number, calendarScale: number): number {
  return Math.floor((tick * calendarScale) / TICKS_PER_SEASON_DAY) + 1
}

/**
 * L'ACTE D'UN JOUR — NON BORNÉ (saison-sans-fin A1, T2). Un acte tous les `ACT_DAYS` jours, à
 * vie : l'an 1 a ses actes 1-4 (jours 1-84), l'an 2 ses actes 5-8, et ainsi de suite. Monotone
 * non décroissant par construction ; un jour < 1 est l'acte 1.
 */
export function actForDay(day: number): Act {
  const d = day < 1 ? 1 : Math.floor(day)
  return Math.floor((d - 1) / BALANCE.ACT_DAYS) + 1
}

/** L'année du jour, à partir de 1 (le TOUR `k` des lois). */
export function tourForDay(day: number): number {
  return tourOf(actForDay(day))
}

/** La saison dans l'année, 1..ACTS_PER_YEAR (la PHASE des lois). */
export function phaseForDay(day: number): number {
  return phaseOf(actForDay(day))
}

/** La longueur d'une année en jours de jeu — dérivée, jamais écrite. */
export const YEAR_DAYS = BALANCE.ACT_DAYS * BALANCE.ACTS_PER_YEAR

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
 * LA PART DE NUIT À CE POINT DU CYCLE — le multiplicateur de `NIGHT_COLD` (décision d'Alexis
 * 2026-08-23 ; le pourquoi et le prix sont en tête de `NIGHT_RAMP_HOURS`, `balance.ts`).
 *
 * 0 en plein jour, 1 sur TOUTE la nuit, et une PENTE LINÉAIRE de `NIGHT_RAMP_TICKS` sur les
 * deux lisières du JOUR : le froid monte dans la dernière heure et demie de jour (le soir se
 * sent venir) et se retire dans la première (l'aube est le fond du froid, il lâche au soleil).
 *
 * ═══ LES DEUX PENTES SONT DU CÔTÉ DU JOUR, ET C'EST STRUCTUREL ═══
 *
 * `cycleTick >= DAY_TICKS_PER_CYCLE ⟹ 1`, sans exception : **la nuit est bit-exacte avec
 * l'avant-rampe.** C'est ce qui compte, et deux mesures du 2026-08-23 le disent :
 *   · AU TICK DU CRÉPUSCULE, `planifierHorde` lit l'éveil pour dimensionner la marche du soir
 *     (`porteeDeNuit`). Une rampe centrée sur 21h y aurait mis 0,5 : toutes les hordes du jeu
 *     auraient rétréci, en silence.
 *   · SUR LA NUIT ENTIÈRE, `nighthunt` tire l'espèce contre l'éveil. Faire retomber le froid
 *     avant l'aube renvoie des loups dans les nuits d'acte III — or « le vivant a quitté la
 *     vallée » est une PROMESSE de la spec (R11), testée à zéro. Une pente côté nuit la rompt,
 *     quelle que soit sa largeur.
 *
 * Le prix, assumé : le tick de l'aube (`cycleTick` 0) porte désormais le plein froid de la
 * nuit — c'est physiquement juste (l'aube est le fond du froid), mais c'est le tick 0 de
 * `createSim`, donc de presque tout montage de test. Sept d'entre eux disaient « de jour, il
 * fait doux » en se posant pile sur l'aube : ils ont été déplacés à midi, ce que la règle
 * maison prescrivait déjà (« jamais poser un état pile sur l'aube »). AUCUNE partie réelle
 * n'y touche : la Veillée comme le LAN démarrent à 9 h.
 *
 * Continue partout — le pas maximal vaut `NIGHT_COLD / NIGHT_RAMP_TICKS` (0,0033 °C mesuré,
 * contre 12 avant), gardé par un balayage dans `time.test.ts`. Le `max` des deux lisières
 * plutôt qu'un `if` : une rampe plus longue que la demi-journée dégrade proprement au lieu de
 * trouer la fonction. Pur : / et comparaisons (invariant #2).
 */
export function partDeNuit(cycleTick: number): number {
  if (cycleTick >= DAY_TICKS_PER_CYCLE) return 1
  const aube = 1 - cycleTick / NIGHT_RAMP_TICKS
  const crepuscule = 1 - (DAY_TICKS_PER_CYCLE - cycleTick) / NIGHT_RAMP_TICKS
  const v = aube > crepuscule ? aube : crepuscule
  return v < 0 ? 0 : v > 1 ? 1 : v
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
    nuit: partDeNuit(cycleTick),
    seasonDay,
    act: actForDay(seasonDay),
    tour: tourForDay(seasonDay),
    phase: phaseForDay(seasonDay),
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
