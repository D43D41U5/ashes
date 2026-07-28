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
import {
  deserializeSim,
  serializeSim,
  deserializeCarte,
  serializeCarte,
  deserializePartie,
  serializePartie,
  SAVE_FORMAT_VERSION,
  SAVE_REQUIRED_KEYS,
} from './persistence'

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

/**
 * LA CARTE À PART — la coupe qui rend l'autosave abordable.
 *
 * MESURÉ (2026-07-28, Worker du navigateur) : une sauvegarde pèse 69,7 Mo dont **86,9 % de
 * carte immuable**, et la sérialiser arrête le monde ~2,5 s toutes les 30 s. On l'écrit donc
 * une fois et on ne réécrit plus que la partie. La promesse à tenir est double : rien ne se
 * perd (le recollage rend l'état AU BIT PRÈS), et rien ne passe (la garde de forme reste).
 *
 * L'immuabilité de la carte elle-même, elle, se prouve ailleurs : `carte-immuable.test.ts`.
 */
describe('la carte se sauve à part', () => {
  it('recoller partie + carte rend le MÊME état, au bit près', () => {
    const sim = makeSim()
    spawnEntity(sim, 20.5, 20.5)
    idle(sim, 40)
    const carte = deserializeCarte(serializeCarte(sim.map, sim.seed))
    const repris = deserializePartie(serializePartie(sim), carte)
    expect(snapshot(repris)).toBe(snapshot(sim))
    // Et la carte est bien celle du monde, pas une carte vide qui aurait passé par chance.
    expect(repris.map.terrain.length).toBe(sim.map.terrain.length)
    expect(repris.map.width).toBe(sim.map.width)
  })

  it('REPREND le pas : couper la carte ne change pas le futur du monde', () => {
    const live = makeSim()
    spawnEntity(live, 20.5, 20.5)
    idle(live, 120)

    const sauve = makeSim()
    spawnEntity(sauve, 20.5, 20.5)
    idle(sauve, 60)
    const repris = deserializePartie(serializePartie(sauve), deserializeCarte(serializeCarte(sauve.map, sauve.seed)))
    idle(repris, 60)

    expect(snapshot(repris)).toBe(snapshot(live))
  })

  /**
   * LES DEUX FAILLES QUE L'AUDIT DE DÉTERMINISME A TROUVÉES (2026-07-28) — et qui ne se
   * voyaient pas, parce qu'aucune ne JETAIT. Un monde faux rendu sans une erreur est pire
   * qu'un plantage : le joueur continue de jouer une vallée qui a déjà menti.
   */
  it('REFUSE la carte d’un AUTRE monde — sans la seed, on recollait n’importe quoi', () => {
    const a = makeSim()
    const b = createSim(99, { map: createEmptyMap(96, 96, TERRAIN_GRASS), worldEvents: true })
    const carteDeB = deserializeCarte(serializeCarte(b.map, b.seed))
    expect(() => deserializePartie(serializePartie(a), carteDeB)).toThrow(/autre monde/)
    // Et sa propre carte passe toujours, évidemment.
    expect(() => deserializePartie(serializePartie(a), deserializeCarte(serializeCarte(a.map, a.seed)))).not.toThrow()
  })

  it('REFUSE une carte TRONQUÉE plutôt que d’éteindre la saison en silence', () => {
    const sim = makeSim()
    const attendu = sim.map.width * sim.map.height

    // Un relief à moitié écrit : l'avatar pouvait se retrouver hors carte, sans une erreur.
    const courte = JSON.parse(serializeCarte(sim.map, sim.seed)) as { carte: Record<string, unknown> }
    courte.carte.terrain = (courte.carte.terrain as number[]).slice(0, 500)
    expect(() => deserializeCarte(JSON.stringify(courte))).toThrow(/tronquée/)

    // Le pire cas, et le plus sournois : un champ de cendre plus court que la carte. Sur les
    // tuiles manquantes, `undefined < front` vaut FAUX — donc elles ne brûlent JAMAIS, et le
    // front de la saison s'arrête sans un bruit. Rien, avant, ne l'aurait dit.
    const cendreCourte = JSON.parse(serializeCarte({ ...sim.map, cendre: new Array(attendu).fill(1) }, sim.seed)) as {
      carte: Record<string, unknown>
    }
    cendreCourte.carte.cendre = (cendreCourte.carte.cendre as number[]).slice(0, 10)
    expect(() => deserializeCarte(JSON.stringify(cendreCourte))).toThrow(/cendre tronqué/)

    // Une carte sans cendre du tout reste licite : toutes les cartes n'ont pas de Cendrière.
    const sansCendre = { ...sim.map }
    delete (sansCendre as { cendre?: number[] }).cendre
    expect(() => deserializeCarte(serializeCarte(sansCendre, sim.seed))).not.toThrow()
  })

  it('la PARTIE ne porte plus la carte — mais garde sa clé, donc l’ordre', () => {
    const sim = makeSim()
    const partie = JSON.parse(serializePartie(sim)) as { partie: Record<string, unknown> }
    expect(partie.partie.map).toBeNull() // vidée, pas retirée
    // La clé reste EXACTEMENT à sa place : c'est ce qui garde `snapshot()` identique entre un
    // monde repris et un monde continu (le contrat « au bit près » du projet).
    expect(Object.keys(partie.partie)).toEqual(Object.keys(sim))
    // Et elle est franchement plus légère que l'état d'un seul tenant.
    expect(serializePartie(sim).length).toBeLessThan(serializeSim(sim).length)
  })

  it('garde la MÊME exigence de forme : un champ manquant est refusé, et nommé', () => {
    const ampute = makeSim() as unknown as Record<string, unknown>
    delete ampute.blood
    ampute.map = null
    const texte = JSON.stringify({ v: SAVE_FORMAT_VERSION, partie: ampute })
    const carte = { carte: createEmptyMap(96, 96, TERRAIN_GRASS), seed: ampute.seed as number }
    expect(() => deserializePartie(texte, carte)).toThrow(/antérieur/)
    expect(() => deserializePartie(texte, carte)).toThrow(/blood/)
  })

  it('refuse une carte ou une partie d’une VERSION inconnue', () => {
    const sim = makeSim()
    const carte = createEmptyMap(8, 8, TERRAIN_GRASS)
    expect(() => deserializeCarte(JSON.stringify({ v: SAVE_FORMAT_VERSION + 1, carte }))).toThrow(/incompatible/)
    expect(() =>
      deserializePartie(JSON.stringify({ v: SAVE_FORMAT_VERSION + 1, partie: sim }), { carte, seed: sim.seed }),
    ).toThrow(/incompatible/)
  })

  it('refuse une carte illisible plutôt que de rendre un monde amputé', () => {
    expect(() => deserializeCarte('{')).toThrow(/illisible/)
    expect(() => deserializeCarte(JSON.stringify({ v: SAVE_FORMAT_VERSION }))).toThrow(/illisible/)
    // Une enveloppe correcte mais sans relief : le pire cas, celui qui passerait en silence.
    expect(() => deserializeCarte(JSON.stringify({ v: SAVE_FORMAT_VERSION, seed: 1, carte: { width: 8 } }))).toThrow(/relief/)
  })
})
