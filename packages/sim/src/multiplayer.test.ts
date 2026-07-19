import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { createEmptyMap } from './map'
import {
  createSim,
  despawnAvatar,
  snapshot,
  spawnEntity,
  step,
  type MoveInput,
  type SimOptions,
  type SimState,
} from './sim'
import { type Village } from './village'

/**
 * Le multi-joueurs sur le moteur mono : plusieurs avatars steppés ENSEMBLE dans
 * un seul `step`, exactement ce que fera le serveur LAN (jalon L1). On vérifie
 * ici les deux propriétés dont dépend l'autorité réseau : le déterminisme au bit
 * près à N avatars, et le retrait propre d'un avatar qui se déconnecte.
 */
describe('multi-joueurs (L1)', () => {
  // Trois avatars aux quatre coins d'un monde à mur central — assez pour exercer
  // collisions, croisements et faim partagée. Rejoué à l'identique par deux runs.
  const buildOptions = (): SimOptions => {
    const map = createEmptyMap(24, 24, TERRAIN_GRASS)
    for (let ty = 4; ty < 20; ty++) map.terrain[ty * 24 + 12] = TERRAIN_ROCK
    return { map, calendarScale: 720 }
  }
  const spawnThree = (state: SimState): void => {
    spawnEntity(state, 5, 5)
    spawnEntity(state, 20, 6)
    spawnEntity(state, 6, 18)
  }
  // Un jeu d'inputs scriptés, un par avatar par tick — trois pilotes distincts.
  const inputsAt = (t: number): MoveInput[] => [
    { entityId: 1, dx: 1, dy: t % 5 === 0 ? 1 : 0, sprint: t % 3 === 0 },
    { entityId: 2, dx: -1, dy: t % 7 === 0 ? -1 : 0 },
    { entityId: 3, dx: t % 2 === 0 ? 1 : 0, dy: -1, sneak: true },
  ]

  it('A1 : trois avatars steppés ensemble sont déterministes au bit près', () => {
    const runOnce = (): SimState => {
      const state = createSim(2026, buildOptions())
      spawnThree(state)
      for (let t = 0; t < 400; t++) step(state, inputsAt(t))
      return state
    }
    expect(snapshot(runOnce())).toBe(snapshot(runOnce()))
  })

  it("A1bis : l'ordre du tableau d'inputs, à ENTITÉS DISTINCTES, ne change pas l'état", () => {
    // Le déplacement de chaque avatar est indépendant — steppé dans l'ordre du
    // tableau (sim.ts), mais sans contention entre avatars distincts. Le serveur
    // construira quand même `MoveInput[]` trié par entityId (garde vs la contention
    // d'ACTIONS même-tuile) ; ce test établit la base : à mouvements seuls, l'ordre
    // est neutre, donc trier ne peut pas introduire de divergence.
    const forward = createSim(7, buildOptions())
    const reversed = createSim(7, buildOptions())
    spawnThree(forward)
    spawnThree(reversed)
    for (let t = 0; t < 200; t++) {
      step(forward, inputsAt(t))
      step(reversed, [...inputsAt(t)].reverse())
    }
    expect(snapshot(reversed)).toBe(snapshot(forward))
  })

  it('A2 : despawn mid-partie — déterministe et sans trace', () => {
    const runOnce = (): SimState => {
      const state = createSim(2026, buildOptions())
      spawnThree(state)
      for (let t = 0; t < 400; t++) {
        // L'avatar 2 se déconnecte au tick 150 : retrait EN TÊTE de tick.
        if (t === 150) despawnAvatar(state, 2)
        // Après le départ, l'input de l'avatar 2 est ignoré (entité absente) —
        // exactement ce que fera le serveur (il cesse de le rassembler).
        const inputs = inputsAt(t).filter((i) => !(t >= 150 && i.entityId === 2))
        step(state, inputs)
      }
      return state
    }
    const state = runOnce()
    expect(state.entities.map((e) => e.id).sort()).toEqual([1, 3])
    expect(snapshot(runOnce())).toBe(snapshot(state))
  })

  it("A3 : despawn nettoie l'appartenance au village et les tâches réclamées", () => {
    const state = createSim(2026, buildOptions())
    const chief = spawnEntity(state, 8, 8)
    const member = spawnEntity(state, 9, 9)
    // Un village injecté directement (le contrat de nettoyage est testé en
    // isolation, sans dépendre des mécaniques de fondation) : le membre appartient
    // au village ET a réclamé une tâche.
    const village: Village = {
      id: 1,
      name: 'Braises',
      chiefId: chief,
      memberIds: [chief, member],
      fireTx: 8,
      fireTy: 8,
      tier: 1,
      tasks: [{ id: 1, kind: 'gather_wood', priority: 1, claimedBy: member }],
      nextTaskId: 2,
      npcsArrived: false,
      lastAlarmAt: -1,
      warmth: 0,
      engagement: 0,
      archetype: 'neutre',
    }
    state.villages.push(village)

    despawnAvatar(state, member)

    expect(state.entities.some((e) => e.id === member)).toBe(false)
    expect(village.memberIds).toEqual([chief])
    expect(village.tasks[0]!.claimedBy).toBeNull()
  })

  it("A4 : despawn d'un id absent est un no-op (pas d'event, pas de PRNG)", () => {
    const state = createSim(2026, buildOptions())
    spawnEntity(state, 5, 5)
    const before = snapshot(state)
    despawnAvatar(state, 999)
    expect(snapshot(state)).toBe(before)
  })
})
