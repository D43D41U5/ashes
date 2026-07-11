import { describe, expect, it } from 'vitest'
import { createEmptyMap, poisAt, poiCenter } from './map'
import { POI, TERRAIN_GRASS } from './balance'
import { chronicleFromEvents } from './chronicle'
import { POI_CHARGES, poiFamily } from './poi-discovery'
import { POI_TYPES } from './poi'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { ambientTemperature, isSheltered, naturalWarmth } from './temperature'
import { DAY_TICKS_PER_CYCLE } from './time'

/** Carte de test : 3 zones, dont une SANS `kind` (un simple toponyme). */
function mapWithZones() {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push({ name: 'le Belvédère I', x: 10, y: 10, w: 2, h: 2, kind: 'belvedere' }) // poiId 0
  map.zones.push({ name: 'le Pont', x: 20, y: 20, w: 4, h: 4 }) //                          poiId 1 — PAS un POI
  map.zones.push({ name: 'le Cairn I', x: 30, y: 30, w: 1, h: 1, kind: 'cairn' }) //        poiId 2
  return map
}

describe('poisAt', () => {
  it('retourne le poiId de la zone foulée', () => {
    expect(poisAt(mapWithZones(), 10.5, 10.5)).toEqual([0])
  })

  it('ignore les zones sans kind (les toponymes ne sont pas des lieux)', () => {
    expect(poisAt(mapWithZones(), 21, 21)).toEqual([])
  })

  it('ne retourne rien hors de toute zone', () => {
    expect(poisAt(mapWithZones(), 50, 50)).toEqual([])
  })

  it('retourne TOUTES les zones qui se recouvrent, pas seulement la première', () => {
    const map = mapWithZones()
    map.zones.push({ name: 'la Grotte I', x: 10, y: 10, w: 2, h: 2, kind: 'grotte' }) // poiId 3, superposée
    expect(poisAt(map, 10.5, 10.5)).toEqual([0, 3])
  })
})

describe('poiCenter', () => {
  it('donne le centre du rectangle', () => {
    expect(poiCenter({ name: 'x', x: 10, y: 20, w: 4, h: 2 })).toEqual({ x: 12, y: 21 })
  })
})

describe('POI_CHARGES', () => {
  it('charge les onze lieux de famille reward, et EUX SEULS', () => {
    const charged = Object.keys(POI_CHARGES).sort()
    expect(charged).toEqual(
      ['arbre', 'arche', 'belvedere', 'cairn', 'cascade', 'erratique', 'grotte', 'petroglyphes', 'sanctuaire', 'source_chaude', 'tarn'].sort(),
    )
  })

  it('ne charge que des POI de famille reward', () => {
    for (const kind of Object.keys(POI_CHARGES)) {
      expect(poiFamily(kind)).toBe('reward')
    }
  })

  it('répartit les onze en 4 savoir / 3 répit / 4 récit', () => {
    const count = (d: string) => Object.values(POI_CHARGES).filter((c) => c.devise === d).length
    expect(count('savoir')).toBe(4)
    expect(count('repit')).toBe(3)
    expect(count('recit')).toBe(4)
  })
})

/** Une sim de test avec une carte à zones et un joueur posé où on veut. */
function simWith(zones: { name: string; x: number; y: number; w: number; h: number; kind?: string }[]) {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push(...zones)
  const state = createSim(1, { map })
  const playerId = spawnEntity(state, 0.5, 0.5)
  return { state, playerId }
}

/** Téléporte le joueur et joue un tick sans input (le pas est déjà fait). */
function walkTo(state: SimState, playerId: number, x: number, y: number) {
  const p = state.entities.find((e) => e.id === playerId)!
  p.x = x
  p.y = y
  state.events.length = 0
  step(state, [])
}

describe('la règle de base : un lieu foulé entre dans la carte', () => {
  it('au tick 0, le joueur ne connaît AUCUN lieu', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([])
  })

  it('fouler un Gisement (aucune charge) suffit à le connaître, et émet poi_discovered', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0])
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(1)
  })

  it('le retraverser n’émet plus rien (idempotent)', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    walkTo(state, playerId, 10.5, 10.5)
    walkTo(state, playerId, 10.6, 10.6) // toujours dedans, tick suivant
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0])
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('une zone SANS kind (un toponyme) n’entre jamais dans la carte', () => {
    const { state, playerId } = simWith([{ name: 'le Pont', x: 10, y: 10, w: 2, h: 2 }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([])
  })

  it('entrer dans un lieu par un vrai pas (input) le fait connaître DÈS ce tick — pas au suivant', () => {
    // Le joueur est posé juste avant la frontière de la zone [10,12)×[10,12) :
    // à vitesse de marche (4 tuiles/s à 20 Hz = 0,2 tuile/tick), un seul pas
    // vers l'est le fait franchir la frontière (9,85 → 10,05) dans le tick.
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    const p = state.entities.find((e) => e.id === playerId)!
    p.x = 9.85
    p.y = 10.5
    state.events.length = 0

    const input: MoveInput = { entityId: playerId, dx: 1, dy: 0 }
    step(state, [input])

    const after = state.entities.find((e) => e.id === playerId)!
    // Le pas a bien franchi la frontière — sinon le test ne discrimine rien.
    expect(after.x).toBeGreaterThanOrEqual(10)
    expect(after.knownPois).toEqual([0])
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(1)
  })
})

describe('le savoir — quatre lieux qui rendent la carte', () => {
  it('le Belvédère révèle tout dans son rayon, et RIEN au-delà', () => {
    // La carte se construit RELATIVEMENT au rayon, jamais sur des distances en dur :
    // `REVEAL_BELVEDERE_TILES` est un bouton d'équilibrage (il est passé de 40 à 300
    // au calibrage en jeu du 2026-07-11). Un test qui casse quand on tourne un bouton
    // teste le bouton, pas le comportement.
    const R = POI.REVEAL_BELVEDERE_TILES
    const dedans = Math.floor(R / 2) // sans ambiguïté à l'intérieur
    const dehors = Math.ceil(R * 2) //  sans ambiguïté à l'extérieur
    const map = createEmptyMap(dehors + 8, 16, TERRAIN_GRASS)
    map.zones.push({ name: 'le Belvédère I', x: 4, y: 4, w: 2, h: 2, kind: 'belvedere' }) //     0 — centre (5,5)
    map.zones.push({ name: 'la Grotte I', x: 4 + dedans, y: 4, w: 2, h: 2, kind: 'grotte' }) //  1 — DEDANS
    map.zones.push({ name: 'le Tarn I', x: 4 + dehors, y: 4, w: 2, h: 2, kind: 'tarn' }) //      2 — DEHORS
    const state = createSim(1, { map })
    const playerId = spawnEntity(state, 0.5, 0.5)

    walkTo(state, playerId, 5, 5)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toContain(0) // lui-même, par la règle de base
    expect(known).toContain(1) // dans le rayon
    expect(known).not.toContain(2) // au-delà : le Belvédère ne voit pas TOUT
  })

  it('le Belvédère ne se déclenche qu’une fois', () => {
    const { state, playerId } = simWith([
      { name: 'le Belvédère I', x: 10, y: 10, w: 2, h: 2, kind: 'belvedere' },
      { name: 'la Grotte I', x: 20, y: 10, w: 2, h: 2, kind: 'grotte' },
    ])
    walkTo(state, playerId, 11, 11)
    walkTo(state, playerId, 11.1, 11.1)
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('la garde de fraîcheur : un Cairn foulé plusieurs ticks de suite ne re-scanne pas son voisinage', () => {
    // Ce test doit discriminer la garde `if (fresh)` d'`advancePois` — contrairement
    // au test du Belvédère ci-dessus, où `isCandidate` exclurait de toute façon la
    // Grotte (déjà connue) même sans la garde. Ici, deux candidats à des distances
    // différentes : si la charge du Cairn rejouait au 2e tick, le candidat moyen
    // (le Tarn) tomberait puisqu'il devient alors LE plus proche encore inconnu.
    const { state, playerId } = simWith([
      { name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }, //   0 — centre (10.5,10.5)
      { name: 'la Grotte I', x: 12, y: 10, w: 1, h: 1, kind: 'grotte' }, // 1 — proche
      { name: 'le Tarn I', x: 20, y: 10, w: 1, h: 1, kind: 'tarn' }, //     2 — moyen
    ])
    walkTo(state, playerId, 10.5, 10.5) // 1er tick : foule le Cairn → révèle la Grotte (la plus proche)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0, 1])

    walkTo(state, playerId, 10.5, 10.5) // 2e tick : toujours dans l'emprise du Cairn, sans avoir bougé
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toEqual([0, 1]) // le Tarn ne doit PAS apparaître au 2e tick
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('le Cairn révèle exactement UN lieu — le plus proche encore inconnu', () => {
    const { state, playerId } = simWith([
      { name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }, //  0 — centre (10.5, 10.5)
      { name: 'la Grotte I', x: 14, y: 10, w: 1, h: 1, kind: 'grotte' }, // 1 — proche
      { name: 'le Tarn I', x: 30, y: 10, w: 1, h: 1, kind: 'tarn' }, //     2 — loin
    ])
    walkTo(state, playerId, 10.5, 10.5)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toEqual([0, 1]) // lui-même + le plus proche. PAS le Tarn.
  })

  it('à distance exactement égale, le Cairn départage par poiId croissant', () => {
    const { state, playerId } = simWith([
      { name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }, //   0 — centre (10.5, 10.5)
      { name: 'la Grotte I', x: 20, y: 10, w: 1, h: 1, kind: 'grotte' }, // 1 — centre (20.5,10.5), à +10 en x
      { name: 'le Tarn I', x: 0, y: 10, w: 1, h: 1, kind: 'tarn' }, //      2 — centre (0.5,10.5), à −10 en x : ÉGALITÉ
    ])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0, 1]) // le plus petit poiId gagne
  })

  it('un Cairn sans aucun autre lieu sur la carte ne révèle rien de plus', () => {
    const { state, playerId } = simWith([{ name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0]) // lui-même, et c'est tout
  })

  it('un voisin déjà connu est exclu des candidats — le Cairn saute au suivant, pas au silence', () => {
    // Un simple « le voisinage est vide » ne teste pas l'exclusion par `knownPois`
    // (bestId === -1 dans les deux cas, avec ou sans la garde). Ici, deux candidats
    // réels sur la carte : la Grotte (proche) est déjà connue, le Tarn (plus loin)
    // ne l'est pas. Si `isCandidate` n'excluait plus les lieux déjà connus, la
    // Grotte redeviendrait « la plus proche » au sens de la boucle 'nearest', et
    // comme `know()` la refuserait silencieusement (déjà dans `knownPois`), le
    // Tarn ne serait JAMAIS atteint : le Cairn ne révélerait plus rien du tout.
    const { state, playerId } = simWith([
      { name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }, //   0 — centre (10.5,10.5)
      { name: 'la Grotte I', x: 12, y: 10, w: 1, h: 1, kind: 'grotte' }, // 1 — proche, DÉJÀ CONNUE du joueur
      { name: 'le Tarn I', x: 20, y: 10, w: 1, h: 1, kind: 'tarn' }, //     2 — plus loin, encore inconnu
    ])
    const player = state.entities.find((e) => e.id === playerId)!
    player.knownPois.push(1) // le joueur connaît déjà la Grotte avant même de fouler le Cairn

    walkTo(state, playerId, 10.5, 10.5)

    expect(player.knownPois.sort((a, b) => a - b)).toEqual([0, 1, 2]) // le Cairn ET le Tarn, pas de re-révélation de la Grotte
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(2) // le Cairn (règle de base) + le Tarn (charge)
  })

  it('un Cairn dont tout le voisinage réel est déjà connu ne révèle rien de plus', () => {
    const { state, playerId } = simWith([
      { name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }, //   0 — centre (10.5,10.5)
      { name: 'la Grotte I', x: 12, y: 10, w: 1, h: 1, kind: 'grotte' }, // 1 — voisine, déjà connue
      { name: 'le Tarn I', x: 20, y: 10, w: 1, h: 1, kind: 'tarn' }, //     2 — voisin, déjà connu
    ])
    const player = state.entities.find((e) => e.id === playerId)!
    player.knownPois.push(1, 2) // tout le voisinage est déjà connu, seul le Cairn ne l'est pas encore

    walkTo(state, playerId, 10.5, 10.5)

    expect(player.knownPois.sort((a, b) => a - b)).toEqual([0, 1, 2]) // juste le Cairn lui-même
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(1) // seulement le Cairn
  })

  it('les Pétroglyphes ne révèlent qu’un lieu ANCIEN', () => {
    const { state, playerId } = simWith([
      { name: 'les Pétroglyphes I', x: 10, y: 10, w: 1, h: 1, kind: 'petroglyphes' }, // 0
      { name: 'la Grotte I', x: 12, y: 10, w: 1, h: 1, kind: 'grotte' }, //              1 — proche mais PAS ancien
      { name: 'les Ruines I', x: 20, y: 10, w: 1, h: 1, kind: 'ruines' }, //             2 — ancien, plus loin
    ])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0, 2]) // saute la Grotte
  })

  it('l’Arche ne révèle que des abris (family shelter)', () => {
    const { state, playerId } = simWith([
      { name: 'l’Arche I', x: 10, y: 10, w: 1, h: 1, kind: 'arche' }, //     0
      { name: 'le Tarn I', x: 12, y: 10, w: 1, h: 1, kind: 'tarn' }, //      1 — reward, pas shelter
      { name: 'la Cabane I', x: 14, y: 10, w: 1, h: 1, kind: 'cabane' }, //  2 — shelter ✓
      { name: 'les Ruines I', x: 16, y: 10, w: 1, h: 1, kind: 'ruines' }, // 3 — shelter ✓
    ])
    walkTo(state, playerId, 10.5, 10.5)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toContain(2)
    expect(known).toContain(3)
    expect(known).not.toContain(1)
  })
})

describe('le récit — la première fois seulement', () => {
  it('la première arrivée au Sanctuaire émet poi_first_visit, la seconde non', () => {
    const { state, playerId } = simWith([{ name: 'le Sanctuaire I', x: 10, y: 10, w: 2, h: 2, kind: 'sanctuaire' }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.events.filter((e) => e.type === 'poi_first_visit')).toHaveLength(1)
    expect(state.visitedPois).toEqual([0])

    // Un SECOND joueur y va à son tour : c'est SA découverte, mais plus une première.
    const other = spawnEntity(state, 0.5, 0.5)
    walkTo(state, other, 10.5, 10.5)
    expect(state.events.filter((e) => e.type === 'poi_first_visit')).toHaveLength(0)
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(1) // lui, il découvre
  })

  it('un PNJ qui traverse le Sanctuaire ne produit RIEN — ni carte, ni découverte, ni première', () => {
    const { state } = simWith([{ name: 'le Sanctuaire I', x: 10, y: 10, w: 2, h: 2, kind: 'sanctuaire' }])
    const npcEntityId = spawnEntity(state, 10.5, 10.5)
    state.npcs.push({
      entityId: npcEntityId,
      villageId: 1,
      homeId: null,
      energy: 100,
      sleeping: false,
      seekingWarmth: false,
      task: null,
      path: [],
      stuck: 0,
      errand: null,
    })
    state.events.length = 0
    step(state, [])
    expect(state.entities.find((e) => e.id === npcEntityId)!.knownPois).toEqual([])
    expect(state.visitedPois).toEqual([])
    expect(state.events.filter((e) => e.type === 'poi_first_visit')).toHaveLength(0)
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('la chronique écrit une ligne pour le Sanctuaire (devise récit)', () => {
    const { state, playerId } = simWith([{ name: 'le Sanctuaire I', x: 10, y: 10, w: 2, h: 2, kind: 'sanctuaire' }])
    walkTo(state, playerId, 10.5, 10.5)
    const lines = chronicleFromEvents(state.events, state.calendarScale, {})
    expect(lines.some((l) => l.includes('le Sanctuaire I'))).toBe(true)
  })

  it('la chronique NE parle PAS d’un Gisement (devise absente) ni d’un Cairn (devise savoir)', () => {
    const { state, playerId } = simWith([
      { name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' },
      { name: 'le Cairn I', x: 30, y: 30, w: 1, h: 1, kind: 'cairn' },
    ])
    walkTo(state, playerId, 10.5, 10.5)
    const eventsA = [...state.events]
    walkTo(state, playerId, 30.5, 30.5)
    const lines = chronicleFromEvents([...eventsA, ...state.events], state.calendarScale, {})
    expect(lines.some((l) => l.includes('Gisement'))).toBe(false)
    expect(lines.some((l) => l.includes('Cairn'))).toBe(false)
  })

  it('le bus reste COMPLET : la première visite est émise pour tous les POI, pas seulement les lieux de récit', () => {
    // Le partage des rôles (R12-R13) : la logique n'a pas le droit de filtrer par
    // devise — c'est le formateur qui choisit. Sans ce test, un filtre `devise ===
    // 'recit'` glissé dans `advancePois` laisserait TOUS les autres tests verts :
    // la chronique, elle, n'écrirait de toute façon rien de plus.
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    walkTo(state, playerId, 10.5, 10.5)
    const firsts = state.events.filter((e) => e.type === 'poi_first_visit')
    expect(firsts).toHaveLength(1) // un Gisement n'a AUCUNE charge, et pourtant il entre dans le bus
    expect(firsts[0]).toMatchObject({ poiId: 0, kind: 'gisement', name: 'le Gisement I', byEntityId: playerId })
    expect(state.visitedPois).toEqual([0])
  })
})

/**
 * Une sim qui démarre LA NUIT. Indispensable pour mesurer une source chaude :
 * de jour, en Acte I, l'ambiante d'un fond de vallée vaut ~90 et la source ~75 —
 * `ambientTemperature` prend le `max`, donc la source serait INVISIBLE et le test
 * vert-menteur. Une source chaude ne se voit que quand il fait froid (critère A5).
 */
function simDeNuit(zones: { name: string; x: number; y: number; w: number; h: number; kind?: string }[]) {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push(...zones)
  const state = createSim(1, { map, cycleOffset: DAY_TICKS_PER_CYCLE }) // 0 = aube ; ici : tombée de nuit
  const playerId = spawnEntity(state, 0.5, 0.5)
  return { state, playerId }
}

describe('le répit — la vallée comme réseau', () => {
  it('la Source chaude réchauffe : c’est un feu qu’on n’a pas allumé', () => {
    const { state } = simDeNuit([{ name: 'la Source chaude I', x: 10, y: 10, w: 2, h: 2, kind: 'source_chaude' }])
    const surLaSource = ambientTemperature(state, 11, 11) // le centre de la zone
    const aCote = ambientTemperature(state, 11 + POI.HOTSPRING_RANGE_TILES + 2, 11) // hors rayon

    expect(surLaSource).toBeGreaterThan(aCote)
    expect(surLaSource).toBeGreaterThanOrEqual(POI.HOTSPRING_WARMTH - 1) // planchée par la source
    expect(state.structures).toHaveLength(0) // et personne n'a rien allumé
  })

  it('la chaleur de la source décroît avec la distance, et s’annule au bord du rayon', () => {
    const { state } = simDeNuit([{ name: 'la Source chaude I', x: 10, y: 10, w: 2, h: 2, kind: 'source_chaude' }])
    const auContact = naturalWarmth(state, 11, 11)
    const aMiChemin = naturalWarmth(state, 11 + POI.HOTSPRING_RANGE_TILES / 2, 11)
    const auBord = naturalWarmth(state, 11 + POI.HOTSPRING_RANGE_TILES, 11)

    expect(auContact).toBeCloseTo(POI.HOTSPRING_WARMTH)
    expect(aMiChemin).toBeCloseTo(POI.HOTSPRING_WARMTH / 2)
    expect(auBord).toBe(0)
  })

  it('la Grotte abrite', () => {
    const { state } = simWith([{ name: 'la Grotte I', x: 10, y: 10, w: 2, h: 2, kind: 'grotte' }])
    expect(isSheltered(state, 10, 10)).toBe(true)
    expect(isSheltered(state, 13, 13)).toBe(false)
  })

  it('le Tarn accélère la régén d’endurance', () => {
    const { state, playerId } = simWith([{ name: 'le Tarn I', x: 10, y: 10, w: 2, h: 2, kind: 'tarn' }])
    const p = state.entities.find((e) => e.id === playerId)!

    p.x = 11
    p.y = 11
    p.stamina = 50
    step(state, [])
    const surLeTarn = p.stamina - 50

    p.x = 30
    p.y = 30
    p.stamina = 50
    step(state, [])
    const ailleurs = p.stamina - 50

    expect(surLeTarn).toBeGreaterThan(ailleurs)
  })
})

describe('la règle qui protège l’émerveillement', () => {
  it('AUCUN lieu de famille reward n’ajoute d’item à l’inventaire (critère A9)', () => {
    const rewardKinds = POI_TYPES.filter((t) => t.family === 'reward').map((t) => t.slug)
    expect(rewardKinds).toHaveLength(11) // garde-fou : si ça change, ce test doit être relu

    const zones = rewardKinds.map((kind, i) => ({
      name: `${kind} I`,
      x: 4 + i * 5,
      y: 10,
      w: 2,
      h: 2,
      kind,
    }))
    const { state, playerId } = simWith(zones)
    const p = state.entities.find((e) => e.id === playerId)!

    for (const z of zones) {
      p.x = z.x + 1
      p.y = z.y + 1
      step(state, [])
    }
    expect(p.inventory).toEqual({}) // les mains vides, après les onze
  })
})
