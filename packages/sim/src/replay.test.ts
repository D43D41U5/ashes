import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { createEmptyMap } from './map'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, type MoveInput, type SimOptions, type SimState } from './sim'
import { type PlayerAction } from './sim'
import { grantItems } from './village'

describe('replay', () => {
  it('CONTRAT (A6) : rejouer le log reconstruit exactement la partie — carte, temps et actions compris', () => {
    // Murs, calendrier accéléré, ET des actions de village : le replay doit
    // reproduire collisions, franchissements de jours, fondation, coffre.
    const map = createEmptyMap(24, 24, TERRAIN_GRASS)
    for (let ty = 4; ty < 20; ty++) map.terrain[ty * 24 + 12] = TERRAIN_ROCK
    const options: SimOptions = { map, calendarScale: 720 }

    const setup = (state: SimState) => {
      spawnEntity(state, 5, 5)
      spawnEntity(state, 20, 20)
      // Marteau en case 0, COFFRE en case 1 (le coffre se pose en objet tenu, décision
      // d'Alexis : plus au marteau), et EN MAIN via les actions ci-dessous (bâtir exige G12).
      grantItems(state, 1, { hammer: 1 })
      grantItems(state, 1, { chest: 1 })
      grantItems(state, 1, { wood: 40, stone: 10 })
    }

    // Actions planifiées à des ticks précis (le joueur 1 fonde et construit).
    const actionAt = (t: number): PlayerAction | undefined => {
      if (t === 10) return { type: 'light_fire' }
      if (t === 20) return { type: 'set_active_slot', slot: 1 } // le coffre en main
      if (t === 50) return { type: 'place_component', tx: 6, ty: 5 } // posé comme un composant
      if (t === 55) return { type: 'set_active_slot', slot: 0 } // le marteau
      if (t === 60) return { type: 'deposit', structureId: 2, item: 'wood', count: 7 }
      if (t === 90) return { type: 'build', structure: 'wall', tx: 4, ty: 4 }
      if (t === 120) return { type: 'demolish', structureId: 4 }
      return undefined
    }

    // Partie « live » : on joue en enregistrant.
    const live = createSim(2026, options)
    const log = createReplayLog(2026, options)
    setup(live)
    for (let t = 0; t < 3000; t++) {
      const action = actionAt(t)
      const inputs: MoveInput[] = [
        { entityId: 1, dx: t < 10 ? 0 : 1, dy: t % 5 === 0 ? 1 : 0, ...(action ? { action } : {}) },
        { entityId: 2, dx: -1, dy: t % 7 === 0 ? -1 : 0 },
      ]
      recordAndStep(live, log, inputs)
    }
    expect(live.villages).toHaveLength(1)

    // Replay : reconstruit depuis la seed et le journal seulement.
    const replayed = runReplay(log, setup)

    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})
