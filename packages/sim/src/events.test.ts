import { describe, expect, it } from 'vitest'
import { drainEvents, type SimEvent } from './events'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'

describe('events', () => {
  it('émet un événement de spawn horodaté au tick courant', () => {
    const sim = createSim(1)
    step(sim, [])
    const id = spawnEntity(sim, 3, 4)
    expect(drainEvents(sim)).toEqual([{ type: 'entity_spawned', tick: 1, entityId: id, x: 3, y: 4 }])
  })

  it('drainer vide le buffer', () => {
    const sim = createSim(1)
    spawnEntity(sim, 0, 0)
    drainEvents(sim)
    expect(drainEvents(sim)).toEqual([])
  })

  it('CONTRAT : le replay reproduit exactement le flux d’événements du live', () => {
    const setup = (state: SimState) => {
      spawnEntity(state, 0, 0)
    }
    const inputsAt = (t: number): MoveInput[] => [{ entityId: 1, dx: t % 2 === 0 ? 1 : -1, dy: 0 }]

    // Partie live : on draine à chaque tick, comme le fera l'hôte réel.
    const live = createSim(77)
    const log = createReplayLog(77)
    setup(live)
    const liveStream: SimEvent[] = [...drainEvents(live)]
    for (let t = 0; t < 100; t++) {
      recordAndStep(live, log, inputsAt(t))
      liveStream.push(...drainEvents(live))
    }

    // Replay : on collecte le flux d'un coup à la fin.
    const replayed = runReplay(log, setup)
    const replayedStream = drainEvents(replayed)

    expect(replayedStream).toEqual(liveStream)
  })
})
