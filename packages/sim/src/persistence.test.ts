/**
 * LA PERSISTANCE — critères de `docs/specs/persistence-veillee.md`.
 *
 * Sim-first, headless : un état sérialisé se relit à l'identique ET REPREND le pas au
 * bit près. C'est ce qui fait de la Veillée un monde qu'on retrouve (GATE 1 : « fun
 * 5 sessions d'affilée » suppose de reprendre le même monde).
 */
import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map'
import { TERRAIN_GRASS, VENT } from './balance'
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
  creerCoffre,
} from './persistence'
import { appliqueDiffNoeuds, baseDepuisNoeuds, diffNoeuds, PART_DU_NOEUD, type DiffNoeuds } from './node-baseline'
import type { ResourceNode } from './economy'

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

  /**
   * L'AUTRE BRANCHE DU MÊME ARBITRAGE (spec `cendreux.md` R21). Le garde ci-dessus oblige à
   * trancher ; voici le cas où l'on a tranché « repli » plutôt que « bosser la version ».
   *
   * `reveils` — les sols qui travaillent — dure QUATRE SECONDES. Rendre illisibles toutes les
   * vallées en cours pour un champ pareil serait absurde : on le recolle à vide, et le joueur
   * perd un réveil qu'il n'aurait de toute façon pas fini de voir. Ce test protège la
   * distinction : un champ éphémère se comble, un champ qui compte fait toujours refuser.
   */
  it('un champ ÉPHÉMÈRE absent se comble ; un champ qui compte fait toujours refuser', () => {
    const sim = makeSim()
    const sansReveils = JSON.parse(serializeSim(sim)) as { v: number; sim: Record<string, unknown> }
    delete sansReveils.sim.reveils
    const relu = deserializeSim(JSON.stringify(sansReveils))
    expect(relu.reveils).toEqual([]) // recollé, pas refusé

    // LA FIN DE SAISON (saison-sans-fin T4) : une vallée d'avant le pivot n'a pas le champ —
    // elle se relit avec « jamais », la règle du solo, au lieu d'être refusée ou de finir.
    const sansFin = JSON.parse(serializeSim(sim)) as { v: number; sim: Record<string, unknown> }
    delete sansFin.sim.finDeSaison
    expect(deserializeSim(JSON.stringify(sansFin)).finDeSaison).toBeNull()

    // LA FORCE DU VENT (`vent.md` V3, 2026-08-24) : DÉRIVÉE — le premier tick la recalcule du
    // front. Une vallée d'avant l'unification se relit donc, au lieu d'être orpheline pour un
    // champ qui se reconstitue en cinquante millisecondes.
    const sansVent = JSON.parse(serializeSim(sim)) as { v: number; sim: Record<string, unknown> }
    delete sansVent.sim.windForce
    const reluVent = deserializeSim(JSON.stringify(sansVent))
    expect(reluVent.windForce).toBe(VENT.AMBIANT)
    // …ET ELLE SE REFAIT VRAIMENT : le repli n'est pas un pansement, c'est une amorce.
    step(reluVent, [])
    expect(reluVent.windForce).toBeGreaterThan(0)

    // …et la porte ne s'est pas ouverte pour autant : un champ NON éphémère manque toujours.
    const sansMonstres = JSON.parse(serializeSim(sim)) as { v: number; sim: Record<string, unknown> }
    delete sansMonstres.sim.monsters
    expect(() => deserializeSim(JSON.stringify(sansMonstres))).toThrow(/monsters/)
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
/** Un monde AVEC des nœuds — sans eux, le diff de nœuds ne prouverait rien. */
function makeSimNoeuds(): SimState {
  const nodes: ResourceNode[] = []
  for (let i = 0; i < 40; i++) {
    nodes.push({ id: i + 1, type: i % 2 === 0 ? 'tree' : 'berry_bush', tx: 10 + i, ty: 20, stock: 5, regrowAt: 0 })
  }
  return createSim(7, { map: createEmptyMap(96, 96, TERRAIN_GRASS), nodes, worldEvents: true })
}

/**
 * LE COFFRE, tel que l'hôte le tient — et c'est LE MÊME OBJET que l'hôte tient, désormais.
 *
 * Ce helper recopiait la politique de `sim-worker.ts` à la main, et le disait : « reproduire
 * ça ici est le seul moyen de tester ce que sim-worker fait vraiment ». Un test qui éprouve
 * un sosie ne garde pas l'original — et c'est précisément par là qu'est passée la faille de
 * la base non reprise (voir « une écriture refusée n'engage rien » plus bas). `creerCoffre`
 * vit maintenant dans `persistence.ts` et l'hôte l'appelle : ce qu'on teste ici est joué.
 */
function coffre(sim: SimState) {
  const c = creerCoffre()
  const naissance = c.prochaine(sim)
  if (naissance.quoi !== 'naissance') throw new Error('le premier geste d’un coffre est une naissance')
  c.reussi()
  return {
    naissance: () => deserializeCarte(naissance.carte),
    ecrire: (s: SimState) => {
      const e = c.prochaine(s)
      c.reussi()
      return e.partie
    },
  }
}

describe('la carte se sauve à part', () => {
  it('recoller partie + carte rend le MÊME état, au bit près', () => {
    const sim = makeSim()
    spawnEntity(sim, 20.5, 20.5)
    const c = coffre(sim)
    idle(sim, 40)
    const repris = deserializePartie(c.ecrire(sim), c.naissance())
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
    const c = coffre(sauve)
    idle(sauve, 60)
    const repris = deserializePartie(c.ecrire(sauve), c.naissance())
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
    const ca = coffre(a)
    const carteDeB = deserializeCarte(serializeCarte(b.map, b.seed, b.nodes))
    expect(() => deserializePartie(ca.ecrire(a), carteDeB)).toThrow(/autre monde/)
    // Et sa propre carte passe toujours, évidemment.
    expect(() => deserializePartie(ca.ecrire(a), ca.naissance())).not.toThrow()
  })

  it('REFUSE une carte TRONQUÉE plutôt que d’éteindre la saison en silence', () => {
    const sim = makeSim()
    const attendu = sim.map.width * sim.map.height

    // Un relief à moitié écrit : l'avatar pouvait se retrouver hors carte, sans une erreur.
    const courte = JSON.parse(serializeCarte(sim.map, sim.seed, sim.nodes)) as { carte: Record<string, unknown> }
    courte.carte.terrain = (courte.carte.terrain as number[]).slice(0, 500)
    expect(() => deserializeCarte(JSON.stringify(courte))).toThrow(/tronquée/)

    // Le pire cas, et le plus sournois : un champ de cendre plus court que la carte. Sur les
    // tuiles manquantes, `undefined < front` vaut FAUX — donc elles ne brûlent JAMAIS, et le
    // front de la saison s'arrête sans un bruit. Rien, avant, ne l'aurait dit.
    const cendreCourte = JSON.parse(serializeCarte({ ...sim.map, cendre: new Array(attendu).fill(1) }, sim.seed, sim.nodes)) as {
      carte: Record<string, unknown>
    }
    cendreCourte.carte.cendre = (cendreCourte.carte.cendre as number[]).slice(0, 10)
    expect(() => deserializeCarte(JSON.stringify(cendreCourte))).toThrow(/cendre tronqué/)

    // Une carte sans cendre du tout reste licite : toutes les cartes n'ont pas de Cendrière.
    const sansCendre = { ...sim.map }
    delete (sansCendre as { cendre?: number[] }).cendre
    expect(() => deserializeCarte(serializeCarte(sansCendre, sim.seed, sim.nodes))).not.toThrow()
  })

  it('la PARTIE ne porte plus la carte — mais garde sa clé, donc l’ordre', () => {
    const sim = makeSim()
    const partie = JSON.parse(serializePartie(sim, baseDepuisNoeuds(sim.nodes))) as { partie: Record<string, unknown> }
    expect(partie.partie.map).toBeNull() // vidée, pas retirée
    expect(partie.partie.nodes).toBeNull()
    // La clé reste EXACTEMENT à sa place : c'est ce qui garde `snapshot()` identique entre un
    // monde repris et un monde continu (le contrat « au bit près » du projet).
    expect(Object.keys(partie.partie)).toEqual(Object.keys(sim))
    // Et elle est franchement plus légère que l'état d'un seul tenant.
    expect(serializePartie(sim, baseDepuisNoeuds(sim.nodes)).length).toBeLessThan(serializeSim(sim).length)
  })

  it('garde la MÊME exigence de forme : un champ manquant est refusé, et nommé', () => {
    const ampute = makeSim() as unknown as Record<string, unknown>
    delete ampute.blood
    ampute.map = null
    const texte = JSON.stringify({
      v: SAVE_FORMAT_VERSION,
      partie: ampute,
      noeuds: { bouges: [], disparus: [], nes: [], empreinte: 0 },
    })
    const carte = { carte: createEmptyMap(96, 96, TERRAIN_GRASS), nodes: [], seed: ampute.seed as number }
    expect(() => deserializePartie(texte, carte)).toThrow(/antérieur/)
    expect(() => deserializePartie(texte, carte)).toThrow(/blood/)
  })

  it('refuse une carte ou une partie d’une VERSION inconnue', () => {
    const sim = makeSim()
    const carte = createEmptyMap(8, 8, TERRAIN_GRASS)
    expect(() => deserializeCarte(JSON.stringify({ v: SAVE_FORMAT_VERSION + 1, carte }))).toThrow(/incompatible/)
    expect(() =>
      deserializePartie(JSON.stringify({ v: SAVE_FORMAT_VERSION + 1, partie: sim }), { carte, nodes: [], seed: sim.seed }),
    ).toThrow(/incompatible/)
  })

  it('refuse une carte illisible plutôt que de rendre un monde amputé', () => {
    expect(() => deserializeCarte('{')).toThrow(/illisible/)
    expect(() => deserializeCarte(JSON.stringify({ v: SAVE_FORMAT_VERSION }))).toThrow(/illisible/)
    // Une enveloppe correcte mais sans relief : le pire cas, celui qui passerait en silence.
    expect(() => deserializeCarte(JSON.stringify({ v: SAVE_FORMAT_VERSION, seed: 1, nodes: [], carte: { width: 8 } }))).toThrow(/relief/)
  })
})

/**
 * LE DIFF DES NŒUDS — le second palier du gel (voir `node-baseline.ts`).
 *
 * Une fois la carte sortie, les nœuds faisaient 9,12 des 9,20 Mo restants. On n'écrit plus
 * que ce qui a bougé depuis la naissance du monde. Ce qui se joue ici est simple à dire et
 * facile à rater : un nœud récolté, épuisé, oublié, brûlé par la Cendre ou né en cours de
 * partie doit se retrouver EXACTEMENT tel qu'il était — sinon le joueur reprend une vallée
 * qui a oublié ce qu'il lui a fait, et rien ne le lui dira.
 */
describe('les nœuds ne se réécrivent plus en entier', () => {
  it('un monde intact : le diff est VIDE, et le recollage rend le même état', () => {
    const sim = makeSimNoeuds()
    const c = coffre(sim)
    const enveloppe = JSON.parse(c.ecrire(sim)) as { noeuds: DiffNoeuds }
    expect(enveloppe.noeuds.bouges).toEqual([])
    expect(enveloppe.noeuds.disparus).toEqual([])
    expect(enveloppe.noeuds.nes).toEqual([])
    expect(snapshot(deserializePartie(c.ecrire(sim), c.naissance()))).toBe(snapshot(sim))
  })

  it('RÉCOLTÉ, ÉPUISÉ, OUBLIÉ : chaque champ mobile revient à l’identique', () => {
    const sim = makeSimNoeuds()
    const c = coffre(sim)

    // Les quatre champs qui bougent, chacun dans un état différent — y compris les deux
    // optionnels, qui doivent revenir ABSENTS quand ils le sont (le monde les `delete`).
    sim.nodes[0]!.stock = 0
    sim.nodes[0]!.regrowAt = 4242
    sim.nodes[1]!.depletions = 3
    sim.nodes[1]!.forgetAt = 999
    sim.nodes[2]!.stock = 2

    const enveloppe = JSON.parse(c.ecrire(sim)) as { noeuds: DiffNoeuds }
    expect(enveloppe.noeuds.bouges).toHaveLength(3) // et TROIS, pas quarante

    const repris = deserializePartie(c.ecrire(sim), c.naissance())
    expect(snapshot(repris)).toBe(snapshot(sim))
    expect(repris.nodes[1]!.depletions).toBe(3)
    expect(Object.hasOwn(repris.nodes[0]!, 'depletions')).toBe(false)
  })

  it('OUBLIÉ PUIS RÉ-ÉPUISÉ : les clés reviennent dans l’ordre canonique', () => {
    // Le cas tordu : `depletions`/`forgetAt` sont posés, `delete`és quand le monde oublie,
    // puis reposés. Ils se retrouvent alors à la FIN de l'objet. Reconstruire par étalement
    // de la base les aurait remis à leur ancienne place — et `snapshot()` aurait divergé.
    const sim = makeSimNoeuds()
    const c = coffre(sim)
    const n = sim.nodes[5]!
    n.depletions = 2
    n.forgetAt = 100
    delete n.depletions
    delete n.forgetAt
    n.depletions = 1
    n.forgetAt = 700

    const repris = deserializePartie(c.ecrire(sim), c.naissance())
    expect(Object.keys(repris.nodes[5]!)).toEqual(Object.keys(n))
    expect(snapshot(repris)).toBe(snapshot(sim))
  })

  it('BRÛLÉS ET NÉS : la Cendre en retire, un lieu bâti en pose — l’ordre tient', () => {
    const sim = makeSimNoeuds()
    const c = coffre(sim)
    // La Cendre filtre (elle préserve l'ordre), un POI pousse à la fin : les deux seules
    // façons dont `state.nodes` change de composition dans tout le dépôt.
    sim.nodes = sim.nodes.filter((n) => n.id % 3 !== 0)
    sim.nodes.push({ id: 500, type: 'rock', tx: 4, ty: 4, stock: 9, regrowAt: 0 })

    const enveloppe = JSON.parse(c.ecrire(sim)) as { noeuds: DiffNoeuds }
    expect(enveloppe.noeuds.disparus.length).toBeGreaterThan(10)
    expect(enveloppe.noeuds.nes).toHaveLength(1)

    const repris = deserializePartie(c.ecrire(sim), c.naissance())
    expect(repris.nodes.map((n) => n.id)).toEqual(sim.nodes.map((n) => n.id))
    expect(snapshot(repris)).toBe(snapshot(sim))
  })

  it('REFUSE de recoller si quelqu’un a RÉORDONNÉ les nœuds', () => {
    // Le recollage suppose que `state.nodes` n'est jamais trié — vrai aujourd'hui (quatre
    // écrits, tous `filter` ou `push`). Le jour où ça changera, la reprise doit CRIER, pas
    // rendre un monde décalé en silence. C'est la seule garde possible d'ici.
    const base = [
      { id: 1, type: 'tree' as const, tx: 0, ty: 0, stock: 3, regrowAt: 0 },
      { id: 2, type: 'rock' as const, tx: 1, ty: 0, stock: 3, regrowAt: 0 },
      { id: 3, type: 'tree' as const, tx: 2, ty: 0, stock: 3, regrowAt: 0 },
    ]
    const b = baseDepuisNoeuds(base)
    const melanges = [base[2]!, base[0]!, base[1]!]
    const diff = diffNoeuds(melanges, b)
    expect(() => appliqueDiffNoeuds(base, diff)).toThrow(/irrecollables/)
    // …et l'ordre d'origine passe, évidemment.
    expect(appliqueDiffNoeuds(base, diffNoeuds(base, b)).map((n) => n.id)).toEqual([1, 2, 3])
  })

  it('le DIFF EST CUMULATIF : deux sauvegardes de suite se recollent chacune seule', () => {
    // La base reste celle de la NAISSANCE. Une sauvegarde tardive doit donc se recoller sans
    // qu'on ait gardé les précédentes — sinon en perdre une perdrait toute la suite.
    const sim = makeSimNoeuds()
    const c = coffre(sim)
    sim.nodes[0]!.stock = 1
    const tot = c.ecrire(sim)
    sim.nodes[1]!.stock = 2
    const tard = c.ecrire(sim)

    expect(deserializePartie(tot, c.naissance()).nodes[0]!.stock).toBe(1)
    const repris = deserializePartie(tard, c.naissance())
    expect(repris.nodes[0]!.stock).toBe(1)
    expect(repris.nodes[1]!.stock).toBe(2)
  })
})

/**
 * LA GARDE DE LA GARDE — aucun champ mobile d'un nœud ne se perd en route.
 *
 * `node-baseline.ts` classait les champs d'un nœud à la main. Le jour où `ResourceNode` en
 * gagne un — un stade de pousse, un propriétaire —, le diff ne le verrait pas bouger et le
 * recollage le laisserait tomber. Et la perte serait INTERMITTENTE : les nœuds touchés par
 * le joueur oublieraient, les autres non (ceux-là reviennent intacts de la naissance).
 *
 * `PART_DU_NOEUD` est un `Record<keyof ResourceNode, …>` : ajouter un champ rend `/sim`
 * ROUGE tant que personne ne dit s'il voyage. Ce test-ci va plus loin — il écrit une valeur
 * reconnaissable dans CHAQUE champ déclaré mobile et exige de la retrouver. Classer ne suffit
 * donc pas : il faut que le code le porte.
 */
describe('la table des champs d’un nœud', () => {
  it('déclare TOUT champ de ResourceNode, et le code porte tous les mobiles', () => {
    const nu: ResourceNode = { id: 1, type: 'tree', tx: 3, ty: 4, stock: 5, regrowAt: 0 }
    const base = baseDepuisNoeuds([nu])

    // Une valeur reconnaissable dans chaque champ MOBILE — quelle que soit la liste du jour.
    const touche = { ...nu } as unknown as Record<string, unknown>
    const mobiles = Object.entries(PART_DU_NOEUD).filter(([, p]) => p === 'mobile').map(([k]) => k)
    expect(mobiles.length).toBeGreaterThan(0)
    mobiles.forEach((k, i) => { touche[k] = 4242 + i })

    const courant = [touche as unknown as ResourceNode]
    const repris = appliqueDiffNoeuds([nu], diffNoeuds(courant, base))

    // Aller-retour EXACT : ni champ perdu, ni valeur écrasée, ni clé en trop.
    expect(repris).toEqual(courant)
    expect(Object.keys(repris[0]!).sort()).toEqual(Object.keys(touche).sort())
  })

  it('les champs FIXES reviennent de la naissance, jamais du diff', () => {
    // Ils ne voyagent pas : c'est tout l'intérêt. On vérifie qu'ils survivent quand même à
    // un nœud retouché — sinon un nœud récolté perdrait son type ou sa position.
    const nu: ResourceNode = { id: 7, type: 'rock', tx: 11, ty: 12, stock: 5, regrowAt: 0 }
    const base = baseDepuisNoeuds([nu])
    const courant: ResourceNode[] = [{ ...nu, stock: 1 }]
    const repris = appliqueDiffNoeuds([nu], diffNoeuds(courant, base))
    for (const [k, part] of Object.entries(PART_DU_NOEUD)) {
      if (part !== 'fixe') continue
      expect((repris[0] as unknown as Record<string, unknown>)[k], k).toEqual((nu as unknown as Record<string, unknown>)[k])
    }
  })
})

describe('une écriture refusée n’engage rien (la Veillée perdue en silence)', () => {
  /**
   * LE SCÉNARIO, ET POURQUOI IL EST PLAUSIBLE. La sauvegarde de NAISSANCE est la plus lourde
   * (elle emporte la carte, ~86,9 % du total) : c'est celle qu'un IndexedDB plein, évincé ou
   * refusé rejette en premier. L'hôte le savait et retentait — mais il tenait DEUX drapeaux
   * pour un seul fait : la carte n'était marquée écrite qu'au succès, la base des nœuds l'était
   * avant toute écriture et n'était jamais reprise. Le second essai partait donc avec la carte
   * de T2 et un diff contre la base de T1.
   *
   * Ce qui suit affirme les deux moitiés : que le coffre se rattrape, ET que sans ce
   * rattrapage la reprise est bel et bien perdue — sinon la garde ne prouverait pas sa prémisse.
   */
  const naitUnNoeud = (sim: SimState): void => {
    // Un nœud NÉ en cours de partie : c'est ce que fait le filon au retrait de la Brume
    // (`brume.ts`), et ce que l'agriculture fera. C'est lui qui rend les deux états
    // irréconciliables — un nœud absent de la base de T1 mais présent dans la carte de T2.
    const id = Math.max(0, ...sim.nodes.map((n) => n.id)) + 1
    sim.nodes.push({ id, type: 'iron_vein', tx: 30, ty: 30, stock: 6, regrowAt: 0 })
  }

  it('P0.5 — première écriture REFUSÉE, seconde acceptée : la reprise rend le même état', () => {
    const sim = makeSimNoeuds()
    spawnEntity(sim, 20.5, 20.5)
    const c = creerCoffre()

    const t1 = c.prochaine(sim)
    expect(t1.quoi).toBe('naissance')
    c.echoue() // le disque refuse : RIEN n'est parti

    idle(sim, 20)
    naitUnNoeud(sim)

    const t2 = c.prochaine(sim)
    // La naissance n'ayant pas abouti, le coffre en redemande une — carte comprise.
    expect(t2.quoi).toBe('naissance')
    c.reussi()
    if (t2.quoi !== 'naissance') throw new Error('inatteignable')

    const repris = deserializePartie(t2.partie, deserializeCarte(t2.carte))
    expect(snapshot(repris)).toBe(snapshot(sim))
  })

  it('P0.5bis — la garde prouve sa prémisse : garder la base de T1 PERD la vallée', () => {
    // On rejoue à la main ce que faisait l'hôte fautif : base prise à T1, carte écrite à T2.
    const sim = makeSimNoeuds()
    spawnEntity(sim, 20.5, 20.5)
    const baseT1 = baseDepuisNoeuds(sim.nodes) // posée AVANT l'écriture qui va échouer

    idle(sim, 20)
    naitUnNoeud(sim)

    const carteT2 = serializeCarte(sim.map, sim.seed, sim.nodes) // la seconde écriture, elle, passe
    const partieT2 = serializePartie(sim, baseT1) // …mais diffée contre la base d'AVANT
    expect(() => deserializePartie(partieT2, deserializeCarte(carteT2))).toThrow()
  })

  it('P0.5ter — en régime, un échec ne redemande PAS la carte (on ne réécrit pas 60 Mo pour rien)', () => {
    const sim = makeSimNoeuds()
    const c = creerCoffre()
    c.prochaine(sim)
    c.reussi() // la naissance est au disque

    idle(sim, 10)
    const a = c.prochaine(sim)
    expect(a.quoi).toBe('partie')
    c.echoue() // celle-ci rate

    idle(sim, 10)
    const b = c.prochaine(sim)
    expect(b.quoi).toBe('partie') // la carte est au disque : elle n'a pas à repartir
  })
})
