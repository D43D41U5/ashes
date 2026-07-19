import { describe, expect, it } from 'vitest'
import {
  createEmptyMap,
  createSim,
  snapshot,
  spawnEntity,
  step,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  type MoveInput,
  type SimOptions,
} from '@braises/sim'
import {
  applyLifecycle,
  createServerReplayLog,
  emptyLifecycle,
  recordTick,
  replayServer,
  type Lifecycle,
} from './replay-log'

/**
 * Le replay serveur doit reconstruire une session multi AU BIT PRÈS — spawns et
 * despawns mid-partie compris, ce que le ReplayLog nu de /sim ne capte pas. On joue
 * une partie « live » en enregistrant, puis on rejoue depuis le journal seul.
 */
describe('replay serveur — lifecycle + inputs (L1)', () => {
  const options = (): SimOptions => {
    const map = createEmptyMap(24, 24, TERRAIN_GRASS)
    for (let ty = 4; ty < 20; ty++) map.terrain[ty * 24 + 12] = TERRAIN_ROCK
    return { map, calendarScale: 720 }
  }

  it('rejoue une session avec join/leave mid-partie au bit près', () => {
    const opts = options()

    const inputsFor = (t: number, ids: number[]): MoveInput[] =>
      ids
        .map((id) => ({ entityId: id, dx: (id % 2 === 0 ? 1 : -1) as -1 | 1, dy: (t % 3 === 0 ? 1 : 0) as 0 | 1, sprint: t % 4 === 0 }))
        .sort((a, b) => a.entityId - b.entityId)

    // ── Partie LIVE : lifecycle appliqué en direct, enregistré, puis step ──
    const live = createSim(2026, opts)
    const log = createServerReplayLog()
    spawnEntity(live, 5, 5) // joueur 1 : présent dès le tick 0 (spawn de setup, hors journal)

    for (let t = 0; t < 200; t++) {
      const life: Lifecycle = emptyLifecycle()
      if (t === 30) life.joins.push({ x: 20, y: 6 }) // joueur 2 arrive (id 2)
      if (t === 60) life.joins.push({ x: 6, y: 18 }) // joueur 3 arrive (id 3)
      if (t === 150) life.leaves.push(2) // joueur 2 se déconnecte
      applyLifecycle(live, life)
      const inputs = inputsFor(t, live.entities.map((e) => e.id))
      recordTick(log, life, inputs)
      step(live, inputs)
    }

    // ── REPLAY : depuis le journal seul (setup = même seed/options + le spawn du j1) ──
    const replayed = replayServer(log, () => {
      const s = createSim(2026, opts)
      spawnEntity(s, 5, 5)
      return s
    })

    expect(snapshot(replayed)).toBe(snapshot(live))
    expect(replayed.entities.map((e) => e.id).sort()).toEqual([1, 3])
  })
})
