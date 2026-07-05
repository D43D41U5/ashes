import { describe, expect, it } from 'vitest'
import { BALANCE, TICK_DT_S } from './balance'
import { createSim, snapshot, spawnEntity, step, type MoveInput } from './sim'

describe('sim', () => {
  it('déplace une entité selon la vitesse de BALANCE', () => {
    const sim = createSim(1)
    const id = spawnEntity(sim, 0, 0)
    step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    expect(sim.entities[0]?.x).toBeCloseTo(BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S)
    expect(sim.entities[0]?.y).toBe(0)
    expect(sim.tick).toBe(1)
  })

  it('normalise le déplacement diagonal', () => {
    const sim = createSim(1)
    const id = spawnEntity(sim, 0, 0)
    step(sim, [{ entityId: id, dx: 1, dy: 1 }])
    const distance = Math.hypot(sim.entities[0]!.x, sim.entities[0]!.y)
    expect(distance).toBeCloseTo(BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S)
  })

  it('ignore les inputs visant une entité inconnue', () => {
    const sim = createSim(1)
    expect(() => step(sim, [{ entityId: 999, dx: 1, dy: 0 }])).not.toThrow()
    expect(sim.tick).toBe(1)
  })

  it('CONTRAT : même seed + mêmes inputs = même état, au bit près', () => {
    const run = () => {
      const sim = createSim(1234)
      const a = spawnEntity(sim, 5, 5)
      const b = spawnEntity(sim, 10, 10)
      for (let t = 0; t < 500; t++) {
        const inputs: MoveInput[] = [
          { entityId: a, dx: t % 3 === 0 ? 1 : 0, dy: t % 2 === 0 ? -1 : 1 },
          { entityId: b, dx: -1, dy: 0 },
        ]
        step(sim, inputs)
      }
      return snapshot(sim)
    }
    expect(run()).toBe(run())
  })
})
