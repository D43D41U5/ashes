import { describe, expect, it } from 'vitest'
import { BALANCE } from './balance'
import { drainEvents, type SimEvent } from './events'
import { createSim, step } from './sim'
import {
  actForDay,
  DAY_TICKS_PER_CYCLE,
  getGameTime,
  seasonDayAtTick,
  TICKS_PER_CYCLE,
  TICKS_PER_SEASON_DAY,
} from './time'

describe('temps (A1 — fonction pure du tick)', () => {
  it('début de partie : jour 1, acte I, à l’aube (horloge murale), de jour', () => {
    const sim = createSim(1)
    // Le cycle démarre à l'aube ; l'horloge murale la place à CYCLE_DAWN_HOUR.
    expect(getGameTime(sim)).toEqual({
      tick: 0,
      hourOfCycle: BALANCE.CYCLE_DAWN_HOUR,
      isNight: false,
      seasonDay: 1,
      act: 1,
    })
  })

  it('le cycle bascule en nuit à la fraction de jour, puis reboucle à l’aube', () => {
    const sim = createSim(1)
    sim.tick = DAY_TICKS_PER_CYCLE - 1
    expect(getGameTime(sim).isNight).toBe(false)
    sim.tick = DAY_TICKS_PER_CYCLE
    expect(getGameTime(sim).isNight).toBe(true)
    // La nuit tombe à 21h murales (aube 6h + 15h de jour).
    expect(getGameTime(sim).hourOfCycle).toBe(BALANCE.CYCLE_DAWN_HOUR + 24 * BALANCE.CYCLE_DAY_FRACTION)
    sim.tick = TICKS_PER_CYCLE
    expect(getGameTime(sim).isNight).toBe(false)
    expect(getGameTime(sim).hourOfCycle).toBe(BALANCE.CYCLE_DAWN_HOUR)
  })

  it('minuit (0h murale) tombe en pleine nuit', () => {
    const sim = createSim(1)
    // Minuit = 18h après l'aube de 6h → phase 0.75 du cycle, bien dans la nuit.
    sim.tick = Math.round(TICKS_PER_CYCLE * 0.75)
    expect(getGameTime(sim).hourOfCycle).toBe(0)
    expect(getGameTime(sim).isNight).toBe(true)
  })

  it('le jour de saison avance avec le calendrier, modulé par calendarScale', () => {
    expect(seasonDayAtTick(TICKS_PER_SEASON_DAY - 1, 1)).toBe(1)
    expect(seasonDayAtTick(TICKS_PER_SEASON_DAY, 1)).toBe(2)
    // À l'échelle 720, un jour de saison passe 720 fois plus vite.
    expect(seasonDayAtTick(TICKS_PER_SEASON_DAY / 720, 720)).toBe(2)
  })

  it('les actes changent aux jours 22 et 43 (bornes GDD §2)', () => {
    expect(actForDay(BALANCE.ACT_BOUNDARIES[0])).toBe(1)
    expect(actForDay(BALANCE.ACT_BOUNDARIES[0] + 1)).toBe(2)
    expect(actForDay(BALANCE.ACT_BOUNDARIES[1])).toBe(2)
    expect(actForDay(BALANCE.ACT_BOUNDARIES[1] + 1)).toBe(3)
    expect(actForDay(BALANCE.SEASON_DAYS)).toBe(3)
  })
})

describe('temps (A2 — une saison accélérée headless)', () => {
  // Le timeout par défaut de vitest (5 s) EST l'assertion de performance :
  // la spec exige < 60 s, on tourne en fait en bien moins.
  it('60 jours à l’échelle 720 émettent 60 débuts de jour et 3 actes, dans l’ordre', () => {
    const scale = 720
    const sim = createSim(9, { calendarScale: scale })
    const days: number[] = []
    const acts: number[] = []
    const collect = (events: SimEvent[]) => {
      for (const e of events) {
        if (e.type === 'season_day_started') days.push(e.day)
        if (e.type === 'act_started') acts.push(e.act)
      }
    }
    collect(drainEvents(sim))

    // Jusqu'au dernier tick du jour 60 (le tick suivant entamerait le jour 61).
    const ticksForSeason = (BALANCE.SEASON_DAYS * TICKS_PER_SEASON_DAY) / scale - 1
    for (let t = 0; t < ticksForSeason; t++) {
      step(sim, [])
      collect(drainEvents(sim))
    }

    expect(days).toEqual(Array.from({ length: BALANCE.SEASON_DAYS }, (_, i) => i + 1))
    expect(acts).toEqual([1, 2, 3])
    expect(getGameTime(sim).seasonDay).toBe(BALANCE.SEASON_DAYS)
  })
})
