import { describe, expect, it } from 'vitest'
import { ALIGNMENT, BALANCE, SEASON, SLOTS, TERRAIN_GRASS, TERRAIN_ROAD } from './balance'
import { chronicleFromEvents } from './chronicle'
import { drainEvents, type SimEvent } from './events'
import { inventoryOf } from './items'
import { createEmptyMap } from './map'
import { foundNpcVillage } from './worldgen'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import type { ResourceNode } from './economy'

/** 1 cycle jour/nuit = 1 jour de saison : la saison entière tient en 60 cycles. */
const FAST = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE

function makeSim(withRoad = true): SimState {
  const map = createEmptyMap(40, 40, TERRAIN_GRASS)
  if (withRoad) for (let tx = 0; tx < 40; tx++) map.terrain[20 * 40 + tx] = TERRAIN_ROAD
  return createSim(41, { map, calendarScale: FAST })
}

function runTo(sim: SimState, tick: number, collect?: SimEvent[]): void {
  while (sim.tick < tick) {
    step(sim, [])
    if (collect) collect.push(...drainEvents(sim))
  }
}

describe('la pression (A1)', () => {
  it('la repousse ralentit ×1.5 en acte II', () => {
    const node: ResourceNode = { id: 1, type: 'berry_bush', tx: 10, ty: 10, stock: 1, regrowAt: 0 }
    const sim = createSim(41, { map: createEmptyMap(40, 40, TERRAIN_GRASS), calendarScale: FAST, nodes: [node] })
    const a = spawnEntity(sim, 10.3, 10.5)

    step(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 1 } }])
    const regrowAct1 = sim.nodes[0]!.regrowAt - sim.tick + 1

    sim.tick = 25 * TICKS_PER_CYCLE // acte II
    sim.nodes[0]!.stock = 1
    sim.nodes[0]!.regrowAt = 0
    // L'ÉPUISEMENT LOCAL (chantier tension) rallonge la repousse à chaque fois qu'on
    // rase le MÊME nœud. Ce test-ci mesure le facteur d'ACTE : on remet donc le
    // compteur d'usure à zéro, sinon on mesurerait les deux règles en même temps.
    delete sim.nodes[0]!.depletions
    delete sim.nodes[0]!.forgetAt
    sim.entities[0]!.cooldownUntil = 0
    step(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 1 } }])
    const regrowAct2 = sim.nodes[0]!.regrowAt - sim.tick + 1
    expect(regrowAct2 / regrowAct1).toBeCloseTo(SEASON.REGROW_ACT_FACTOR[1]! / SEASON.REGROW_ACT_FACTOR[0]!, 1)
  })
})

describe('la Cendre (A2)', () => {
  it('la méga-horde déferle au premier crépuscule de l’acte III, une seule fois', () => {
    const sim = makeSim()
    foundNpcVillage(sim, 20, 10, 0)
    sim.tick = 42 * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE - 5 // veille du crépuscule, jour 43
    const events: SimEvent[] = []
    runTo(sim, sim.tick + 20, events)
    const mega = events.filter((e) => e.type === 'horde_spawned' && e.size === SEASON.MEGA_HORDE_SIZE)
    expect(mega).toHaveLength(1)
    expect(sim.megaHordeSpawned).toBe(true)
  })
})

describe('l’évacuation (A3)', () => {
  it('s’ouvre au jour 55, sur la route', () => {
    const sim = makeSim()
    sim.tick = (SEASON.EVAC_DAY - 1) * TICKS_PER_CYCLE - 5
    const events: SimEvent[] = []
    runTo(sim, sim.tick + 20, events)
    const opened = events.find((e) => e.type === 'evacuation_opened')
    expect(opened).toBeDefined()
    const { tx, ty } = opened as { tx: number; ty: number }
    expect(sim.map.terrain[ty * 40 + tx]).toBe(TERRAIN_ROAD)
    expect(sim.evacuation).toEqual({ tx, ty })
  })
})

describe('la fin de saison (A4)', () => {
  it('verdicts par archétype au jour 61, émis une seule fois', { timeout: 30_000 }, () => {
    const sim = makeSim()
    foundNpcVillage(sim, 10, 10, 3, 'foyer')
    foundNpcVillage(sim, 30, 30, 2, 'meute')
    for (let t = 0; t < ALIGNMENT.REFRESH_TICKS + 1; t++) step(sim, []) // classer les archétypes
    // Un grenier Meute gonflé pour le score de butin.
    const meuteChest = sim.structures.find((s) => s.type === 'chest' && s.villageId === sim.villages[1]!.id)!
    meuteChest.inventory = inventoryOf(SLOTS.CHEST, { components: 5, iron_ingot: 4, wood: 10 })

    sim.tick = BALANCE.SEASON_DAYS * TICKS_PER_CYCLE - 5
    const events: SimEvent[] = []
    runTo(sim, sim.tick + TICKS_PER_CYCLE, events)
    const ends = events.filter((e) => e.type === 'season_ended')
    expect(ends).toHaveLength(1)
    const verdicts = (ends[0] as Extract<SimEvent, { type: 'season_ended' }>).verdicts
    const foyer = verdicts.find((v) => v.archetype === 'foyer')!
    const meute = verdicts.find((v) => v.archetype === 'meute')!
    expect(foyer.score).toBeGreaterThan(0) // des vies sauvées
    expect(foyer.outcome).toContain('vie')
    expect(meute.score).toBeGreaterThanOrEqual(5 * 10 + 4 * 5 + 10) // composants + lingots + bois
    expect(meute.outcome).toContain('bras pleins')
  })
})

describe('la chronique (A5)', () => {
  it('raconte la saison : noms, jours croissants, actes, verdicts', { timeout: 120_000 }, () => {
    const sim = makeSim()
    foundNpcVillage(sim, 10, 10, 3, 'foyer')
    foundNpcVillage(sim, 30, 30, 3, 'meute')
    const events: SimEvent[] = []
    events.push(...drainEvents(sim))
    // Sauter de veille de nuit en veille de nuit pour traverser 61 jours vite,
    // en jouant ~40 ticks autour de chaque bascule (spawns, verdicts).
    for (let day = 0; day <= BALANCE.SEASON_DAYS; day++) {
      sim.tick = day * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE - 5
      runTo(sim, sim.tick + 40, events)
      sim.tick = (day + 1) * TICKS_PER_CYCLE - 5
      runTo(sim, sim.tick + 40, events)
    }
    const names = Object.fromEntries(sim.villages.map((v) => [v.id, v.name]))
    const chronicle = chronicleFromEvents(events, sim.calendarScale, names)

    expect(chronicle.length).toBeGreaterThan(4)
    expect(chronicle.some((l) => l.includes('Feu s\'est allumé'))).toBe(true)
    expect(chronicle.some((l) => l.includes('Grand Froid'))).toBe(true)
    expect(chronicle.some((l) => l.includes('méga-horde'))).toBe(true)
    expect(chronicle.some((l) => l.includes('évacuation'))).toBe(true)
    expect(chronicle.some((l) => l.includes('éteint. Ce qu\'on retiendra'))).toBe(true)
    expect(chronicle.some((l) => l.includes(sim.villages[0]!.name))).toBe(true)
    // Les jours sont datés en ordre croissant.
    const days = chronicle.map((l) => /^Jour (\d+)/.exec(l)?.[1]).filter(Boolean).map(Number)
    expect([...days].sort((a, b) => a - b)).toEqual(days)
  })
})

describe('le déterminisme (A6)', () => {
  it('deux saisons accélérées identiques au bit près', { timeout: 60_000 }, () => {
    const run = (): string => {
      const sim = makeSim()
      foundNpcVillage(sim, 10, 10, 2, 'foyer')
      foundNpcVillage(sim, 30, 30, 2, 'meute')
      for (let day = 0; day <= BALANCE.SEASON_DAYS; day += 4) {
        sim.tick = day * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE - 5
        for (let t = 0; t < 30; t++) step(sim, [])
      }
      return snapshot(sim)
    }
    expect(run()).toBe(run())
  })
})

