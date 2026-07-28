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
import { deserializeSim, serializeSim, SAVE_FORMAT_VERSION, SAVE_REQUIRED_KEYS } from './persistence'

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

  /**
   * LE FILET QUI MANQUAIT. Le numéro de version ne protège que si quelqu'un pense à
   * l'incrémenter — or `SimState` gagne des champs au fil des systèmes livrés. Une
   * sauvegarde d'AVANT l'ajout porte le même numéro, passe la garde de version, et
   * repart amputée : `step` jette au premier tick, à chaque lancement, alors que
   * l'hôte promet de « repartir à neuf » sur une sauvegarde illisible.
   *
   * Ce test rend la chose IMPOSSIBLE À OUBLIER : toucher à la forme de `SimState` le
   * fait rougir, et il faut alors trancher — incrémenter la version, ou déclarer le
   * champ optionnel avec son repli.
   */
  it('la liste des champs requis COLLE à la forme réelle de SimState', () => {
    expect([...SAVE_REQUIRED_KEYS].sort()).toEqual(Object.keys(makeSim()).sort())
  })

  it('…et elle la colle QUELLES QUE SOIENT les options du monde', () => {
    // Le piège du garde lui-même : une liste tirée d'un `createSim` MINIMAL rejetterait
    // une sauvegarde légitime le jour où une option ajoute un champ. On confronte donc
    // aussi le monde le plus garni — la forme que les hôtes sauvegardent réellement.
    const garni = createSim(3, {
      map: createEmptyMap(64, 64, TERRAIN_GRASS),
      calendarScale: 300,
      nodes: [],
      cycleOffset: 100,
      faunaCap: 50,
      grounds: [{ x: 5, y: 5 }],
      home: { x: 3, y: 3 },
      debug: true,
      worldEvents: true,
    })
    expect(Object.keys(garni).sort()).toEqual([...SAVE_REQUIRED_KEYS].sort())
    // Et le monde nu : les deux bornes de l'éventail donnent la même forme.
    expect(Object.keys(createSim(1)).sort()).toEqual([...SAVE_REQUIRED_KEYS].sort())
  })

  it("refuse une sauvegarde d'un format ANTÉRIEUR (même version, champ manquant)", () => {
    const ampute = makeSim() as unknown as Record<string, unknown>
    // La sauvegarde d'hier : tout y est SAUF un champ ajouté depuis. Le numéro, lui, n'a pas bougé.
    delete ampute.blood
    const vieille = JSON.stringify({ v: SAVE_FORMAT_VERSION, sim: ampute })
    expect(() => deserializeSim(vieille)).toThrow(/antérieur/)
    // …et le message NOMME ce qui manque : on ne cherche pas à l'aveugle.
    expect(() => deserializeSim(vieille)).toThrow(/blood/)
  })

  it('accepte toujours une sauvegarde COMPLÈTE (aucune régression de reprise)', () => {
    const sim = makeSim()
    spawnEntity(sim, 20.5, 20.5)
    idle(sim, 30)
    expect(() => deserializeSim(serializeSim(sim))).not.toThrow()
  })
})
