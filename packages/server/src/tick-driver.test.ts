import { describe, expect, it } from 'vitest'
import { createSim } from '@ashes/sim'
import {
  acceptInput,
  CHAT_BUCKET,
  buildSnapshotBase,
  gatherInputs,
  newClientState,
  refillChatTokens,
  spendChatToken,
  type ClientState,
} from './tick-driver'

describe('tick-driver — le pilote pur de la boucle serveur (L1)', () => {
  it("acceptInput adopte le dernier input et l'acquitte", () => {
    const state = newClientState(7)
    expect(state).toEqual({
      entityId: 7,
      input: { dx: 0, dy: 0, sprint: false, sneak: false, block: false },
      ack: 0,
      chatTokens: CHAT_BUCKET.MAX,
    })
    acceptInput(state, { seq: 3, dx: 1, dy: 0, sprint: true, sneak: false, block: false })
    expect(state.ack).toBe(3)
    expect(state.input).toEqual({ dx: 1, dy: 0, sprint: true, sneak: false, block: false })
  })

  it('gatherInputs : un MoveInput par client, TRIÉ par entityId, action consommée une fois', () => {
    const a: ClientState = { entityId: 5, input: { dx: 1, dy: 0, sprint: false, sneak: false, block: false }, ack: 1, chatTokens: 0 }
    const b: ClientState = {
      entityId: 2,
      input: { dx: -1, dy: 0, sprint: false, sneak: false, block: false },
      ack: 1,
      chatTokens: 0,
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

  // LES TESTS DU DIFF DE NŒUDS ont suivi le code : l'implémentation vit désormais dans
  // /sim (`node-shadow.ts`), partagée par les deux hôtes, et ses gardes sont dans
  // `packages/sim/src/node-shadow.test.ts` — dont un test DIFFÉRENTIEL contre la `Map`
  // remplacée. Les dupliquer ici ne testerait plus que le ré-export.

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

describe('tick-driver — le seau de jetons du chat (déni de service)', () => {
  it('laisse passer la rafale, puis coupe', () => {
    const s = newClientState(1)
    for (let i = 0; i < CHAT_BUCKET.MAX; i++) expect(spendChatToken(s)).toBe(true)
    expect(spendChatToken(s)).toBe(false)
    expect(spendChatToken(s)).toBe(false)
  })

  it('regarnit un jeton tous les REFILL_TICKS, sans jamais dépasser la rafale', () => {
    const s = newClientState(1)
    while (spendChatToken(s)) { /* on vide le seau */ }
    // Des ticks qui ne sont pas des multiples : rien ne revient.
    for (let t = 1; t < CHAT_BUCKET.REFILL_TICKS; t++) refillChatTokens([s], t)
    expect(spendChatToken(s)).toBe(false)
    // Le tick de recharge : un seul jeton, pas deux.
    refillChatTokens([s], CHAT_BUCKET.REFILL_TICKS)
    expect(spendChatToken(s)).toBe(true)
    expect(spendChatToken(s)).toBe(false)
    // Cent recharges ne remplissent pas plus que la rafale.
    for (let k = 1; k <= 100; k++) refillChatTokens([s], k * CHAT_BUCKET.REFILL_TICKS)
    let passes = 0
    while (spendChatToken(s)) passes++
    expect(passes).toBe(CHAT_BUCKET.MAX)
  })

  it('borne le débit permanent bien en dessous de ce qui noierait un tick', () => {
    // 20 Hz × 60 s = 1 200 ticks. Un client qui SPAMME sans relâche pendant une minute.
    const s = newClientState(1)
    let passes = 0
    for (let t = 1; t <= 1_200; t++) {
      refillChatTokens([s], t)
      // Il tente dix fois par tick (200 messages/seconde) : le seau, lui, ne bouge pas.
      for (let i = 0; i < 10; i++) if (spendChatToken(s)) passes++
    }
    // Plafond : la rafale initiale + un jeton par recharge. Soit ~2 messages/seconde.
    expect(passes).toBe(CHAT_BUCKET.MAX + 1_200 / CHAT_BUCKET.REFILL_TICKS)
    expect(passes).toBeLessThan(130) // 12 000 tentatives → 124 messages relayés
  })
})
