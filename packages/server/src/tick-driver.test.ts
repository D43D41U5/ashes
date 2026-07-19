import { describe, expect, it } from 'vitest'
import { createSim, type SimState } from '@braises/sim'
import {
  acceptInput,
  buildSnapshotBase,
  collectNodeDeltas,
  gatherInputs,
  newClientState,
  type ClientState,
} from './tick-driver'

describe('tick-driver — le pilote pur de la boucle serveur (L1)', () => {
  it("acceptInput adopte le dernier input et l'acquitte", () => {
    const state = newClientState(7)
    expect(state).toEqual({ entityId: 7, input: { dx: 0, dy: 0, sprint: false, sneak: false, block: false }, ack: 0 })
    acceptInput(state, { seq: 3, dx: 1, dy: 0, sprint: true, sneak: false, block: false })
    expect(state.ack).toBe(3)
    expect(state.input).toEqual({ dx: 1, dy: 0, sprint: true, sneak: false, block: false })
  })

  it('gatherInputs : un MoveInput par client, TRIÉ par entityId, action consommée une fois', () => {
    const a: ClientState = { entityId: 5, input: { dx: 1, dy: 0, sprint: false, sneak: false, block: false }, ack: 1 }
    const b: ClientState = {
      entityId: 2,
      input: { dx: -1, dy: 0, sprint: false, sneak: false, block: false },
      ack: 1,
      pendingAction: { type: 'harvest', nodeId: 9 },
    }
    // Passés dans le DÉSORDRE (5 puis 2) : la sortie doit être triée par entityId.
    const first = gatherInputs([a, b])
    expect(first.map((i) => i.entityId)).toEqual([2, 5])
    expect(first.find((i) => i.entityId === 2)?.action).toEqual({ type: 'harvest', nodeId: 9 })
    expect(first.find((i) => i.entityId === 5)?.action).toBeUndefined()
    // L'action est CONSOMMÉE : au tick suivant, plus d'action, mais le dernier input persiste (répété).
    const second = gatherInputs([a, b])
    expect(second.find((i) => i.entityId === 2)?.action).toBeUndefined()
    expect(second.find((i) => i.entityId === 2)?.dx).toBe(-1)
  })

  it("collectNodeDeltas n'émet que les stocks qui ont bougé, et avance l'ombre", () => {
    const sim = { nodes: [{ id: 1, stock: 10 }, { id: 2, stock: 5 }] } as unknown as SimState
    const shadow = new Map<number, number>()
    // Première passe : tout est nouveau (l'ombre est vide).
    expect(collectNodeDeltas(sim, shadow)).toEqual([{ id: 1, stock: 10 }, { id: 2, stock: 5 }])
    // Rien n'a bougé : aucun delta.
    expect(collectNodeDeltas(sim, shadow)).toEqual([])
    // Un seul stock change → un seul delta.
    sim.nodes[0]!.stock = 8
    expect(collectNodeDeltas(sim, shadow)).toEqual([{ id: 1, stock: 8 }])
  })

  it('buildSnapshotBase draine les events UNE fois et projette le corps commun', () => {
    const sim = createSim(2026)
    // createSim a émis les events d'ouverture (jour/acte/nuit) dans le buffer.
    const base = buildSnapshotBase(sim, [])
    expect(base.type).toBe('snapshot')
    expect(base.tick).toBe(sim.tick)
    expect(base.events.length).toBeGreaterThan(0)
    // Le drain a vidé le buffer : une seconde projection n'a plus d'events (piège du
    // multi — appeler par client priverait tous les clients sauf le premier).
    const second = buildSnapshotBase(sim, [])
    expect(second.events).toEqual([])
  })
})
