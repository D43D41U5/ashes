import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { createEmptyMap } from './map'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, type MoveInput, type SimOptions, type SimState } from './sim'

describe('replay', () => {
  it('CONTRAT (A5) : rejouer le log reconstruit exactement la partie, carte et temps compris', () => {
    // Une carte avec des murs et un calendrier accéléré : le replay doit
    // reproduire les collisions ET les franchissements de jours.
    const map = createEmptyMap(24, 24, TERRAIN_GRASS)
    for (let ty = 4; ty < 20; ty++) map.terrain[ty * 24 + 12] = TERRAIN_ROCK
    const options: SimOptions = { map, calendarScale: 720 }

    const setup = (state: SimState) => {
      spawnEntity(state, 5, 5)
      spawnEntity(state, 20, 20)
    }

    // Partie « live » : on joue en enregistrant.
    const live = createSim(2026, options)
    const log = createReplayLog(2026, options)
    setup(live)
    for (let t = 0; t < 3000; t++) {
      const inputs: MoveInput[] = [
        { entityId: 1, dx: 1, dy: t % 5 === 0 ? 1 : 0 },
        { entityId: 2, dx: -1, dy: t % 7 === 0 ? -1 : 0 },
      ]
      recordAndStep(live, log, inputs)
    }

    // Replay : reconstruit depuis la seed et le journal seulement.
    const replayed = runReplay(log, setup)

    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})
