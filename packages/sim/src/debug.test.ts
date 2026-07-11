/**
 * Les outils de dev sont dans la sim, donc ils sont testés comme le reste —
 * et surtout : on teste qu'ils sont INERTES quand `debug` n'est pas armé.
 * C'est ce qui rend sûr de les laisser dans le même canal d'action que le jeu.
 */
import { describe, expect, it } from 'vitest'
import { applyDamage } from './combat'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { TERRAIN_GRASS } from './balance'
import { getGameTime } from './time'

function makeSim(debug: boolean): { sim: SimState; player: number } {
  const sim = createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS), debug })
  const player = spawnEntity(sim, 10, 10)
  return { sim, player }
}

function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

describe('debug — téléportation', () => {
  it('pose l’avatar sur la tuile visée', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_teleport', x: 40.5, y: 33.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBeCloseTo(40.5)
    expect(e.y).toBeCloseTo(33.5)
  })

  it('borne la cible à la carte (hors-bornes = terrain indéfini)', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_teleport', x: -500, y: 99999 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBe(0.5)
    expect(e.y).toBe(63.5)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_teleport', x: 40.5, y: 33.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBe(10)
    expect(e.y).toBe(10)
  })
})

describe('debug — heure forcée', () => {
  it('amène l’horloge à l’heure demandée sans toucher au calendrier', () => {
    const { sim, player } = makeSim(true)
    const dayBefore = getGameTime(sim).seasonDay
    act(sim, player, { type: 'debug_set_hour', hour: 23 })
    const time = getGameTime(sim)
    // Le tick a avancé d'un cran pendant le step : on tolère la minute de jeu.
    expect(time.hourOfCycle).toBeGreaterThan(22.9)
    expect(time.isNight).toBe(true)
    expect(time.seasonDay).toBe(dayBefore)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    const before = sim.cycleOffset
    act(sim, player, { type: 'debug_set_hour', hour: 23 })
    expect(sim.cycleOffset).toBe(before)
  })
})

describe('debug — invulnérabilité', () => {
  it('encaisse un coup mortel sans perdre de PV ni mourir', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_god', on: true })
    const e = sim.entities.find((x) => x.id === player)!
    applyDamage(sim, e, 9999, 0)
    expect(e.hp).toBe(100)
    expect(sim.entities.some((x) => x.id === player)).toBe(true)
  })

  it('gèle la faim (elle serait sinon drainée à chaque tick)', () => {
    const { sim, player } = makeSim(true)
    const e = sim.entities.find((x) => x.id === player)!
    e.hunger = 3
    act(sim, player, { type: 'debug_god', on: true })
    for (let i = 0; i < 200; i++) step(sim, [{ entityId: player, dx: 0, dy: 0 }])
    expect(e.hunger).toBe(100)
    expect(e.temperature).toBe(100)
  })

  it('se coupe : l’avatar redevient mortel', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_god', on: true })
    act(sim, player, { type: 'debug_god', on: false })
    const e = sim.entities.find((x) => x.id === player)!
    applyDamage(sim, e, 30, 0)
    expect(e.hp).toBe(70)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_god', on: true })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.god).toBeUndefined()
    applyDamage(sim, e, 30, 0)
    expect(e.hp).toBe(70)
  })
})
