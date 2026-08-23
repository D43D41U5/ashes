import { describe, expect, it } from 'vitest'
import { BALANCE, TEMPERATURE } from './balance'
import { drainEvents, type SimEvent } from './events'
import { createSim, step } from './sim'
import {
  actForDay,
  calendarScaleForSeasonCycles,
  cycleOffsetForStartHour,
  DAY_TICKS_PER_CYCLE,
  getGameTime,
  NIGHT_RAMP_TICKS,
  partDeNuit,
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
      nuit: 1, // l'aube est le FOND du froid : la pente ne le rend qu'au fil de la matinée

      seasonDay: 1,
      act: 1,
      tour: 1, // l'an 1 (saison-sans-fin T2)
      phase: 1, // le printemps
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

  it('cycleOffsetForStartHour : démarrer à minuit met le cycle en nuit, calendrier intact', () => {
    const sim = createSim(1, { cycleOffset: cycleOffsetForStartHour(0) })
    const t = getGameTime(sim)
    expect(t.hourOfCycle).toBe(0)
    expect(t.isNight).toBe(true)
    expect(t.seasonDay).toBe(1) // le décalage ne touche QUE le cycle, pas le calendrier
    // createSim émet night_started (pas day_started) quand on démarre de nuit.
    const types = drainEvents(sim).map((e) => e.type)
    expect(types).toContain('night_started')
    expect(types).not.toContain('day_started')
  })

  it('cycleOffsetForStartHour(6) = 0 : l’aube est le départ par défaut', () => {
    expect(cycleOffsetForStartHour(BALANCE.CYCLE_DAWN_HOUR)).toBe(0)
    expect(createSim(1).cycleOffset).toBe(0)
    expect(getGameTime(createSim(1)).hourOfCycle).toBe(BALANCE.CYCLE_DAWN_HOUR)
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
    // Les bornes des trois premiers actes sont INCHANGÉES par T2 (21 / 42 / 63) — épinglées
    // en littéraux, pas à la constante qu'on teste.
    expect(actForDay(21)).toBe(1)
    expect(actForDay(22)).toBe(2)
    expect(actForDay(42)).toBe(2)
    expect(actForDay(43)).toBe(3)
    expect(actForDay(63)).toBe(3)
    expect(actForDay(64)).toBe(4) // la tranche neuve : le cœur de l'hiver
    expect(actForDay(85)).toBe(5) // l'an 2 commence — et c'est un printemps
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

describe('couplage cycle↔calendrier (V0-9 — l’endgame observable en solo)', () => {
  // Le tick où finit la saison : `seasonDayAtTick` bascule à SEASON_DAYS+1.
  const seasonEndTick = (scale: number): number => (BALANCE.SEASON_DAYS * TICKS_PER_SEASON_DAY) / scale
  // Le premier CRÉPUSCULE (night_started) qui tombe dans l'acte III, pour un décalage de
  // départ donné. C'est là que déferle la méga-horde (worldevents R2) : s'il tombe APRÈS la
  // fin de saison, l'endgame est invisible.
  const firstAct3Nightfall = (scale: number, cycleOffset: number): number => {
    const base = (((DAY_TICKS_PER_CYCLE - cycleOffset) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
    for (let t = base; t <= 200 * TICKS_PER_CYCLE; t += TICKS_PER_CYCLE) {
      if (actForDay(seasonDayAtTick(t, scale)) === 3) return t
    }
    return Infinity
  }

  it('l’échelle DÉRIVÉE fait tomber la méga-horde DANS la saison — quel que soit l’heure de départ', () => {
    // Un éventail de cadences jouables (≥ 4 pour que l'acte III reste observable quel que
    // soit le décalage) — dont le défaut de la Veillée (6).
    for (const cycles of [4, 6, 8, 12]) {
      const scale = calendarScaleForSeasonCycles(cycles)
      // La saison dure EXACTEMENT `cycles` cycles (contrat du couplage).
      expect(seasonEndTick(scale)).toBeCloseTo(cycles * TICKS_PER_CYCLE, 3)
      // Pour toute heure de départ, un crépuscule d'acte III précède la fin de saison.
      for (const hour of [0, 6, 9, 15, 21]) {
        const offset = cycleOffsetForStartHour(hour)
        expect(firstAct3Nightfall(scale, offset)).toBeLessThan(seasonEndTick(scale))
      }
    }
  })

  it('RÉGRESSION : l’ancienne échelle codée en dur (720) laissait la méga-horde APRÈS la fin de saison', () => {
    // Le bug que le couplage règle : à 720, la saison ne dure que ~2,5 cycles et le premier
    // crépuscule d'acte III (départ 9 h, comme la Veillée) tombe SUR la fin de saison (tick
    // 144 000 = jour 61) ou au-delà — donc jamais DANS les jours jouables (le test de
    // couplage, lui, exige un `< seasonEndTick` strict). L'endgame est inobservable.
    const offset = cycleOffsetForStartHour(9)
    expect(firstAct3Nightfall(720, offset)).toBeGreaterThanOrEqual(seasonEndTick(720))
  })
})

describe('la nuit tombe en PENTE (`partDeNuit`, décision 2026-08-23)', () => {
  const MARCHE_MAX = TEMPERATURE.NIGHT_COLD / NIGHT_RAMP_TICKS

  it('GARDE EXHAUSTIVE — aucun saut de froid sur tout le cycle, tick par tick', () => {
    // Le défaut réparé : `isNight` était un booléen, donc `NIGHT_COLD` tombait de douze degrés
    // en UN tick à 21 h et remontait de douze à 6 h. On balaie le cycle ENTIER (pas des points
    // choisis) et on affirme UNE propriété : le froid ne bouge jamais de plus d'un pas de rampe.
    let pire = 0
    let ou = -1
    let precedent = partDeNuit(TICKS_PER_CYCLE - 1) // la couture du cycle est un tick comme un autre
    for (let t = 0; t < TICKS_PER_CYCLE; t++) {
      const v = partDeNuit(t)
      const saut = Math.abs(v - precedent) * TEMPERATURE.NIGHT_COLD
      if (saut > pire) { pire = saut; ou = t }
      precedent = v
    }
    expect(pire, `plus grand saut au cycleTick ${ou}`).toBeLessThanOrEqual(MARCHE_MAX + 1e-9)
  })

  it('LA NUIT EST BIT-EXACTE : `isNight` ⟹ part de nuit PLEINE, sur toute la nuit', () => {
    // Ce que cette garde PIN : les deux pentes vivent du côté du JOUR. Les faire déborder sur
    // la nuit renverrait des loups dans les nuits d'acte III (`nighthunt` tire contre l'éveil,
    // « le vivant a quitté la vallée » est une promesse testée à zéro) et rétrécirait toutes
    // les hordes (`planifierHorde` lit l'éveil AU TICK DU CRÉPUSCULE). Voir `partDeNuit`.
    for (let t = DAY_TICKS_PER_CYCLE; t < TICKS_PER_CYCLE; t++) expect(partDeNuit(t)).toBe(1)
  })

  it('le plein jour ne porte aucun froid de nuit, et les lisières sont des pentes bornées', () => {
    // Entre les deux rampes : zéro, franc. Sur les rampes : monotone et dans [0, 1].
    for (let t = NIGHT_RAMP_TICKS; t <= DAY_TICKS_PER_CYCLE - NIGHT_RAMP_TICKS; t += 137) {
      expect(partDeNuit(t)).toBe(0)
    }
    expect(partDeNuit(0)).toBe(1) // l'aube : le fond du froid
    expect(partDeNuit(NIGHT_RAMP_TICKS / 2)).toBeCloseTo(0.5, 9)
    expect(partDeNuit(DAY_TICKS_PER_CYCLE - NIGHT_RAMP_TICKS / 2)).toBeCloseTo(0.5, 9)
    for (let t = 0; t < TICKS_PER_CYCLE; t += 7) {
      const v = partDeNuit(t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
