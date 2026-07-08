import { describe, it, expect } from 'vitest'
import { createSim, spawnEntity, type Entity, type SimState } from './sim'
import { ambientTemperature } from './temperature'
import { DAY_TICKS_PER_CYCLE } from './time'

/** spawnEntity retourne un id → on récupère l'objet entité. */
function spawn(state: SimState, x: number, y: number): Entity {
  const id = spawnEntity(state, x, y)
  return state.entities.find((e) => e.id === id)!
}

/** Remplit toute la carte d'un terrain + une élévation uniformes. */
function flatMap(state: SimState, terrain: number, elevation: number): void {
  const n = state.map.width * state.map.height
  state.map.terrain = new Array(n).fill(terrain)
  state.map.elevation = new Array(n).fill(elevation)
}

describe('jauge temperature', () => {
  it('un nouvel avatar naît à température 100', () => {
    const state = createSim(1)
    expect(spawn(state, 5, 5).temperature).toBe(100)
  })
})

describe('ambientTemperature', () => {
  it('fond de vallée, jour, acte I = confort (≥60)', () => {
    const state = createSim(1) // tick 0 = aube (jour), acte I
    flatMap(state, 1 /* grass */, 0)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThanOrEqual(60)
  })

  it('glacier en altitude = glacial (≤20)', () => {
    const state = createSim(1)
    flatMap(state, 15 /* glacier */, 0.85)
    expect(ambientTemperature(state, 5, 5)).toBeLessThanOrEqual(20)
  })

  it("près d'un feu, la cible remonte au chaud (>60)", () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85) // sinon glacial
    state.structures.push({ type: 'fire', tx: 5, ty: 5 } as never)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThan(60)
  })

  it('sous abri, le froid nocturne est amorti (~moitié)', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit dès le tick 0
    flatMap(state, 1 /* grass */, 0)
    const exposed = ambientTemperature(state, 5, 5)
    state.structures.push({ type: 'house', tx: 5, ty: 5 } as never)
    const sheltered = ambientTemperature(state, 5, 5)
    expect(sheltered).toBeGreaterThan(exposed)
    expect(sheltered - exposed).toBeCloseTo(10, 5) // pénalité nocturne 20 → 10
  })
})
