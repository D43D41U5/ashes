/**
 * LA PERSISTANCE — critères de `docs/specs/persistence-veillee.md`.
 *
 * Sim-first, headless : un état sérialisé se relit à l'identique ET REPREND le pas au
 * bit près. C'est ce qui fait de la Veillée un monde qu'on retrouve (GATE 1 : « fun
 * 5 sessions d'affilée » suppose de reprendre le même monde).
 */
import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map'
import { TERRAIN_GRASS } from './balance'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { deserializeSim, serializeSim, SAVE_FORMAT_VERSION } from './persistence'

function makeSim(): SimState {
  // `worldEvents` armé : le pire cas de déterminisme (RNG, hordes, convois) doit
  // survivre au round-trip, pas seulement un monde inerte.
  return createSim(7, { map: createEmptyMap(96, 96, TERRAIN_GRASS), worldEvents: true })
}

/** Avance le pas `n` fois sans input : le monde vit seul (déterministe par l'état). */
function idle(sim: SimState, n: number): void {
  for (let i = 0; i < n; i++) step(sim, [])
}

describe('persistance de la Veillée', () => {
  it('round-trip : l’état désérialisé est identique au bit près', () => {
    const sim = makeSim()
    spawnEntity(sim, 20.5, 20.5)
    idle(sim, 40)
    const restored = deserializeSim(serializeSim(sim))
    expect(snapshot(restored)).toBe(snapshot(sim))
  })

  it('REPREND le pas : sauver, reprendre, avancer → même flux qu’en continu', () => {
    // Référence : une Veillée qui tourne 120 pas d'affilée.
    const live = makeSim()
    spawnEntity(live, 20.5, 20.5)
    idle(live, 120)

    // Reprise : la même, sauvée au pas 60, rechargée, puis poussée à 120.
    const paused = makeSim()
    spawnEntity(paused, 20.5, 20.5)
    idle(paused, 60)
    const resumed = deserializeSim(serializeSim(paused))
    idle(resumed, 60)

    // La reprise et le continu convergent au même état : la sauvegarde n'a rien perdu.
    expect(snapshot(resumed)).toBe(snapshot(live))
  })

  it('rejette une version de format inconnue', () => {
    const sim = makeSim()
    const future = JSON.stringify({ v: SAVE_FORMAT_VERSION + 1, sim })
    expect(() => deserializeSim(future)).toThrow(/incompatible/)
  })

  it('rejette une chaîne illisible ou sans enveloppe', () => {
    expect(() => deserializeSim('{ pas du json')).toThrow(/illisible/)
    expect(() => deserializeSim(JSON.stringify({ tick: 0 }))).toThrow(/enveloppe/)
  })
})
