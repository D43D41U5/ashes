import { describe, expect, it } from 'vitest'
import { drainEvents, type SimEvent } from './events'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'

describe('events', () => {
  it('la création émet le début du jour 1, de l’acte I et du cycle', () => {
    const sim = createSim(1)
    expect(drainEvents(sim)).toEqual([
      { type: 'season_day_started', tick: 0, day: 1 },
      { type: 'act_started', tick: 0, act: 1 },
      { type: 'day_started', tick: 0 },
    ])
  })

  it('émet un événement de spawn horodaté au tick courant', () => {
    const sim = createSim(1)
    drainEvents(sim)
    step(sim, [])
    const id = spawnEntity(sim, 3, 4)
    expect(drainEvents(sim)).toEqual([{ type: 'entity_spawned', tick: 1, entityId: id, x: 3, y: 4 }])
  })

  it('drainer vide le buffer', () => {
    const sim = createSim(1)
    spawnEntity(sim, 5, 5)
    drainEvents(sim)
    expect(drainEvents(sim)).toEqual([])
  })

  it('CONTRAT : le replay reproduit exactement le flux d’événements du live', () => {
    const setup = (state: SimState) => {
      spawnEntity(state, 5, 5)
    }
    const inputsAt = (t: number): MoveInput[] => [{ entityId: 1, dx: t % 2 === 0 ? 1 : -1, dy: 0 }]

    // Partie live : on draine à chaque tick, comme le fera l'hôte réel.
    const live = createSim(77, { calendarScale: 720 })
    const log = createReplayLog(77, { calendarScale: 720 })
    setup(live)
    const liveStream: SimEvent[] = [...drainEvents(live)]
    for (let t = 0; t < 3000; t++) {
      recordAndStep(live, log, inputsAt(t))
      liveStream.push(...drainEvents(live))
    }
    // À l'échelle 720, 3000 ticks franchissent des jours de saison : le flux
    // contient bien des événements de temps, pas seulement le spawn.
    expect(liveStream.some((e) => e.type === 'season_day_started' && e.day > 1)).toBe(true)

    // Replay : on collecte le flux d'un coup à la fin.
    const replayed = runReplay(log, setup)
    const replayedStream = drainEvents(replayed)

    expect(replayedStream).toEqual(liveStream)
  })
})
