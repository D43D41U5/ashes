import { describe, it, expect } from 'vitest'
import { createSim, spawnEntity, type Entity, type SimState } from './sim'

/** spawnEntity retourne un id → on récupère l'objet entité. */
function spawn(state: SimState, x: number, y: number): Entity {
  const id = spawnEntity(state, x, y)
  return state.entities.find((e) => e.id === id)!
}

/** Remplit toute la carte d'un terrain + une élévation uniformes. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
