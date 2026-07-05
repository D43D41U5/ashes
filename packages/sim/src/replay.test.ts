import { describe, expect, it } from 'vitest'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, type MoveInput, type SimState } from './sim'

describe('replay', () => {
  it('CONTRAT : rejouer le log reconstruit exactement la partie originale', () => {
    const setup = (state: SimState) => {
      spawnEntity(state, 0, 0)
      spawnEntity(state, 20, 20)
    }

    // Partie « live » : on joue en enregistrant.
    const live = createSim(2026)
    const log = createReplayLog(2026)
    setup(live)
    for (let t = 0; t < 300; t++) {
      const inputs: MoveInput[] = [
        { entityId: 1, dx: t % 2 === 0 ? 1 : -1, dy: 0 },
        { entityId: 2, dx: 0, dy: t % 5 === 0 ? 1 : 0 },
      ]
      recordAndStep(live, log, inputs)
    }

    // Replay : reconstruit depuis la seed et le journal seulement.
    const replayed = runReplay(log, setup)

    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})
