import { describe, expect, it } from 'vitest'
import { ALIGNMENT, BALANCE, SEASON, SLOTS, TERRAIN_GRASS, TERRAIN_ROAD, WORLD_EVENTS } from './balance'
import { chronicleFromEvents, formatChronicleLine } from './chronicle'
import { drainEvents, type SimEvent } from './events'
import { inventoryOf } from './items'
import { createEmptyMap } from './map'
import { foundNpcVillage } from './worldgen'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { actForDay, cycleOffsetForStartHour, dayTicksAt, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, YEAR_DAYS, getGameTime } from './time'
import type { ResourceNode } from './economy'

/** 1 cycle jour/nuit = 1 jour de saison : la saison entière tient en 60 cycles. */
const FAST = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE

/**
 * LE MONDE OUVRE AU JOUR 51 (spec `saisons.md` S2) — comme le vrai jeu, et pas au jour 1.
 *
 * Ce banc mesure L'ARC D'UNE SAISON JOUÉE : ses soixante cycles vont donc du jour 51 au jour
 * 111, et ils traversent les Pluies (j61) puis le Grand Froid (j91) — les deux saisons dont
 * l'endgame parle. Ouvert au jour 1, il ne verrait que l'Éclosion et l'Ardeur, et « la
 * chronique raconte le Grand Froid » deviendrait invérifiable.
 *
 * Rien d'autre ne bouge : `finDeSaison` et l'ouverture de l'évacuation se comptent DEPUIS
 * L'OUVERTURE (S2, `worldevents.ts`), donc chaque `N * TICKS_PER_CYCLE` de ce fichier garde
 * exactement le sens qu'il avait — un décalage de N jours après le premier matin.
 */
function makeSim(withRoad = true): SimState {
  const map = createEmptyMap(40, 40, TERRAIN_GRASS)
  if (withRoad) for (let tx = 0; tx < 40; tx++) map.terrain[20 * 40 + tx] = TERRAIN_ROAD
  return createSim(41, { map, calendarScale: FAST, jourDeDepart: BALANCE.JOUR_DE_DEPART })
}

function runTo(sim: SimState, tick: number, collect?: SimEvent[]): void {
  while (sim.tick < tick) {
    step(sim, [])
    if (collect) collect.push(...drainEvents(sim))
  }
}

describe('la pression (A1)', () => {
  it('la repousse ralentit ×2 à l’Ardeur — la sécheresse arrête ce que le froid arrêtera (S13)', () => {
    const node: ResourceNode = { id: 1, type: 'berry_bush', tx: 10, ty: 10, stock: 1, regrowAt: 0 }
    // MIDI aux DEUX mesures : depuis la rampe de nuit (`partDeNuit`), le tick 0 est l'aube et
    // porte le plein froid nocturne. Ce cas mesure le facteur d'ACTE — pas celui de l'heure.
    const sim = createSim(41, {
      map: createEmptyMap(40, 40, TERRAIN_GRASS),
      calendarScale: FAST,
      nodes: [node],
      cycleOffset: cycleOffsetForStartHour(12),
    })
    const a = spawnEntity(sim, 10.3, 10.5)
    // Le buisson DÉRIVE à l'épuisement (spec recolte-vivante) : on se replante dessus
    // avant chaque coup, sinon le second passe hors de portée et ne rase rien.
    const surLeNoeud = (): void => {
      sim.entities[0]!.x = sim.nodes[0]!.tx + 0.5
      sim.entities[0]!.y = sim.nodes[0]!.ty + 0.5
    }

    // Premier coup au jour 1 — l'Éclosion, le seul vrai répit de l'année (S13).
    surLeNoeud()
    step(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 1 } }])
    const regrowEclosion = sim.nodes[0]!.regrowAt - sim.tick + 1

    // MI-ARDEUR (jour 45) : la deuxième saison de l'année, celle où la repousse est la plus
    // lente après le Grand Froid (S13 — la sécheresse arrête ce que le froid arrêtera). Ce
    // montage-ci ouvre au jour 1, donc le cycle N porte le jour N+1.
    // LE RAPPORT NE PORTE QUE LE PALIER D'ACTE, dans les deux états du monde — et il faut le
    // dire, parce que le chemin de repousse a un défaut : `economy.ts` passe l'ACTE à
    // `effetsDuJour`, qui attend un JOUR. Aujourd'hui la lecture tombe donc sur les jours 1
    // et 2, tous deux la Crue — sans `repousse`. Une fois le défaut corrigé, ce seront les
    // VRAIS jours qui seront lus : l'Éclosion (la Crue) et l'Ardeur de l'an 1 (ordinaire),
    // neutres elles aussi. Aucun tirage de S18 ne s'invite dans le rapport, ni avant ni après.
    const MI_ARDEUR = BALANCE.ACT_DAYS + Math.floor(BALANCE.ACT_DAYS / 2)
    sim.tick = (MI_ARDEUR - 1) * TICKS_PER_CYCLE // l'Ardeur
    sim.nodes[0]!.stock = 1
    sim.nodes[0]!.regrowAt = 0
    // L'ÉPUISEMENT LOCAL (chantier tension) rallonge la repousse à chaque fois qu'on
    // rase le MÊME nœud. Ce test-ci mesure le facteur d'ACTE : on remet donc le
    // compteur d'usure à zéro, sinon on mesurerait les deux règles en même temps.
    delete sim.nodes[0]!.depletions
    delete sim.nodes[0]!.forgetAt
    sim.entities[0]!.cooldownUntil = 0
    surLeNoeud()
    step(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 1 } }])
    const regrowArdeur = sim.nodes[0]!.regrowAt - sim.tick + 1
    // Les actes se DÉRIVENT des jours mesurés : déplacer un jour ne peut plus faire mentir
    // l'attendu en silence.
    expect(regrowArdeur / regrowEclosion).toBeCloseTo(
      SEASON.REGROW_ACT_FACTOR(actForDay(MI_ARDEUR)) / SEASON.REGROW_ACT_FACTOR(actForDay(1)),
      1,
    )
  })
})

describe('la Cendre (A2)', () => {
  it('PLUS de méga-horde scriptée (décision ⑲) — la pente continue est seule au pouvoir', () => {
    // L'ancien test affirmait « la méga-horde déferle au premier crépuscule de l'acte III » ;
    // le script est SUPPRIMÉ : la cadence et la taille montent jour après jour (`seasonRamp`),
    // et la nuit la plus dure est naturellement la pire. On affirme ici la disparition du
    // rail — un crépuscule du GRAND FROID sans présage ne lève rien du tout. C'est là qu'il
    // faut le demander : la rampe y est au sommet (S15), donc si un rail survivait quelque
    // part, ce serait cette nuit-là.
    const sim = makeSim()
    foundNpcVillage(sim, 20, 10, 0)
    // Le premier jour du Grand Froid (j91), en cycles depuis l'ouverture du monde.
    const PREMIER_GRAND_FROID = 3 * BALANCE.ACT_DAYS + 1
    sim.tick = (PREMIER_GRAND_FROID - BALANCE.JOUR_DE_DEPART) * TICKS_PER_CYCLE
    // La longueur du jour est SAISONNIÈRE (S6) : le crépuscule se demande au cycle, jamais
    // à une constante — l'hiver le fait tomber bien plus tôt.
    sim.tick += dayTicksAt(sim, sim.tick) - 5 // veille du crépuscule
    sim.presage = null
    const events: SimEvent[] = []
    runTo(sim, sim.tick + 20, events)
    expect(events.filter((e) => e.type === 'horde_spawned')).toHaveLength(0)
    // Et la taille du sommet de la rampe reste sous la main du plafond global : la table
    // n'a plus de case « 16 » à part — le sommet EST la fin de la pente.
    expect(WORLD_EVENTS.HORDE_TAILLE.FIN).toBeGreaterThan(WORLD_EVENTS.HORDE_TAILLE.DEBUT)
  })
})

describe('l’évacuation (A3)', () => {
  // LES JOURS SE COMPTENT DEPUIS L'OUVERTURE, plus depuis un jour absolu (S2) : l'arche
  // s'ouvre `SEASON_DAYS − EVAC_DAY` jours avant la fin, quel que soit le jour où le monde a
  // commencé — un monde né au jour 51 ouvrait sinon son évacuation à son quatrième cycle.
  // `(EVAC_DAY − 1)` cycles après le premier matin : c'est ce décalage-là, pas la date.
  it('s’ouvre cinq jours avant la fin de saison, sur la route', () => {
    const sim = makeSim()
    sim.tick = (SEASON.EVAC_DAY - 1) * TICKS_PER_CYCLE - 5
    const events: SimEvent[] = []
    runTo(sim, sim.tick + 20, events)
    const opened = events.find((e) => e.type === 'evacuation_opened')
    expect(opened).toBeDefined()
    const { tx, ty } = opened as { tx: number; ty: number }
    expect(sim.map.terrain[ty * 40 + tx]).toBe(TERRAIN_ROAD)
    expect(sim.evacuation).toEqual({ tx, ty })
  })

  it('l’arche LÈVE L’ANCRE trois jours après l’ouverture — et UNE SEULE FOIS : partie, elle ne revient pas', () => {
    const sim = makeSim()
    sim.tick = (SEASON.EVAC_DAY - 1) * TICKS_PER_CYCLE - 5
    const events: SimEvent[] = []
    runTo(sim, sim.tick + 20, events) // l'arche s'ouvre
    const evac = sim.evacuation
    expect(evac).not.toBeNull()
    // Un survivant monte À BORD (dans le rayon), un autre reste au loin.
    const aboard = spawnEntity(sim, evac!.tx + 0.5, evac!.ty + 0.5)
    const ashore = spawnEntity(sim, evac!.tx + 20, evac!.ty + 20)
    // On pousse jusqu'au départ (EVAC_DEPART_DAYS jours plus tard), PUIS BIEN AU-DELÀ.
    // L'ancien test s'arrêtait 30 ticks après et demandait `some(ark_departed)` : il était
    // AVEUGLE à la boucle ouvre→part émise à chaque tick (57 600 événements/jour mesurés au
    // banc de saison, 2026-08-16) — la présence était vraie, l'unicité était fausse.
    sim.tick = (SEASON.EVAC_DAY + SEASON.EVAC_DEPART_DAYS - 1) * TICKS_PER_CYCLE - 5
    runTo(sim, sim.tick + 200, events)
    // Et le LENDEMAIN du départ ne rouvre rien non plus.
    sim.tick = (SEASON.EVAC_DAY + SEASON.EVAC_DEPART_DAYS) * TICKS_PER_CYCLE + 5
    runTo(sim, sim.tick + 20, events)
    expect(sim.evacuatedIds).toContain(aboard) // sauvé
    expect(sim.evacuatedIds).not.toContain(ashore) // laissé
    expect(sim.evacuation).toBeNull() // l'arche est partie, le marqueur disparaît
    expect(events.filter((e) => e.type === 'ark_departed')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'evacuation_opened')).toHaveLength(1)
    // Un embarqué compte UNE fois au verdict — pas une fois par tick de boucle.
    expect(new Set(sim.evacuatedIds).size).toBe(sim.evacuatedIds.length)
  })
})

describe('la fin de saison (A4)', () => {
  it('verdicts par archétype au lendemain de la fin, émis une seule fois', { timeout: 30_000 }, () => {
    const sim = makeSim()
    foundNpcVillage(sim, 10, 10, 3, 'foyer')
    foundNpcVillage(sim, 30, 30, 2, 'meute')
    for (let t = 0; t < ALIGNMENT.REFRESH_TICKS + 1; t++) step(sim, []) // classer les archétypes
    // Un grenier Meute gonflé pour le score de butin.
    const meuteChest = sim.structures.find((s) => s.type === 'chest' && s.villageId === sim.villages[1]!.id)!
    meuteChest.inventory = inventoryOf(SLOTS.CHEST, { components: 5, iron_ingot: 4, wood: 10 })

    // Le dernier jour de la saison — `SEASON_DAYS` cycles après l'ouverture ; le cycle qu'on
    // joue ensuite le franchit, et c'est ce franchissement qui rend les verdicts.
    sim.tick = BALANCE.SEASON_DAYS * TICKS_PER_CYCLE - 5
    const events: SimEvent[] = []
    runTo(sim, sim.tick + TICKS_PER_CYCLE, events)
    const ends = events.filter((e) => e.type === 'season_ended')
    expect(ends).toHaveLength(1)
    const verdicts = (ends[0] as Extract<SimEvent, { type: 'season_ended' }>).verdicts
    const foyer = verdicts.find((v) => v.archetype === 'foyer')!
    const meute = verdicts.find((v) => v.archetype === 'meute')!
    expect(foyer.score).toBeGreaterThan(0) // des vies sauvées
    expect(foyer.outcome).toContain('vie')
    expect(meute.score).toBeGreaterThanOrEqual(5 * 10 + 4 * 5 + 10) // composants + lingots + bois
    expect(meute.outcome).toContain('bras pleins')
  })
})

describe('la saison SANS fin (saison-sans-fin R4, T4) — ni verdict ni Arche en solo', () => {
  /** Le même monde, mais réglé « jamais » : c'est ce que la Veillée passe. */
  function simSansFin(): SimState {
    const map = createEmptyMap(40, 40, TERRAIN_GRASS)
    for (let tx = 0; tx < 40; tx++) map.terrain[20 * 40 + tx] = TERRAIN_ROAD
    return createSim(41, { map, calendarScale: FAST, jourDeDepart: BALANCE.JOUR_DE_DEPART, finDeSaison: null })
  }

  it('réglé « jamais », la fin de saison n’est qu’un jour : aucune évacuation, aucune Arche, aucun verdict — jusqu’à l’an 2', () => {
    const sim = simSansFin()
    // Sans village : l'ouverture et la fin ne dépendent que du jour — un village ne ferait que
    // ralentir le cycle. Par SAUTS aux deux jours-clés, un cycle chacun (le patron du test de
    // verdict) : l'ouverture de l'arche et le lendemain de la fin ; puis un tick DANS L'AN 2.
    const events: SimEvent[] = []
    for (const jour of [SEASON.EVAC_DAY, BALANCE.SEASON_DAYS + 1]) {
      sim.tick = jour * TICKS_PER_CYCLE - 5
      runTo(sim, sim.tick + TICKS_PER_CYCLE, events)
    }
    // Le premier jour de l'an 2 (j121 sous une année de 120 jours), compté depuis l'ouverture.
    sim.tick = (YEAR_DAYS + 1 - BALANCE.JOUR_DE_DEPART) * TICKS_PER_CYCLE
    runTo(sim, sim.tick + 2, events)
    expect(events.filter((e) => e.type === 'evacuation_opened')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'ark_departed')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'season_ended')).toHaveLength(0)
    expect(sim.evacuation).toBeNull()
    expect(sim.arkDeparted).toBe(false)
    expect(sim.seasonEnded).toBe(false)
    // Et le monde a bien traversé l'année : l'acte a tourné.
    expect(getGameTime(sim).tour).toBe(2)
  }, 60_000)

  it('une VIEILLE sauvegarde sans le champ vaut « jamais » — une Veillée d’avant le pivot ne finit plus non plus', () => {
    const sim = makeSim() // le défaut (la saison nominale)…
    delete (sim as Partial<SimState>).finDeSaison // …puis le champ absent, comme dans une sauvegarde d'avant
    const events: SimEvent[] = []
    for (const jour of [SEASON.EVAC_DAY, BALANCE.SEASON_DAYS + 1]) {
      sim.tick = jour * TICKS_PER_CYCLE - 5
      runTo(sim, sim.tick + TICKS_PER_CYCLE, events)
    }
    expect(events.some((e) => e.type === 'evacuation_opened' || e.type === 'season_ended')).toBe(false)
  }, 60_000)

  it('le DÉFAUT reste la saison nominale — SEASON_DAYS jours À PARTIR de l’ouverture', () => {
    // La saison se compte DEPUIS le premier matin (S2) : le monde né au jour 51 rendait
    // sinon ses verdicts dix cycles trop tôt. C'est la DURÉE qu'on affirme, pas la date.
    const sim = makeSim()
    expect(sim.finDeSaison! - sim.jourDeDepart + 1).toBe(BALANCE.SEASON_DAYS)
    expect(createSim(7, { finDeSaison: 30 }).finDeSaison).toBe(30)
    expect(createSim(7, { finDeSaison: null }).finDeSaison).toBeNull()
  })
})

describe('la chronique (A5)', () => {
  it('raconte la saison : noms, jours croissants, actes, verdicts', { timeout: 120_000 }, () => {
    const sim = makeSim()
    foundNpcVillage(sim, 10, 10, 3, 'foyer')
    foundNpcVillage(sim, 30, 30, 3, 'meute')
    const events: SimEvent[] = []
    events.push(...drainEvents(sim))
    // Sauter de veille de nuit en veille de nuit pour traverser la saison vite, en jouant
    // ~40 ticks autour de chaque bascule (spawns, verdicts). Le crépuscule se demande au
    // CYCLE (S6) : il recule de dix minutes réelles entre l'Ardeur et le Grand Froid, et une
    // constante l'aurait manqué la moitié de la saison.
    for (let day = 0; day <= BALANCE.SEASON_DAYS; day++) {
      sim.tick = day * TICKS_PER_CYCLE
      sim.tick += dayTicksAt(sim, sim.tick) - 5
      runTo(sim, sim.tick + 40, events)
      sim.tick = (day + 1) * TICKS_PER_CYCLE - 5
      runTo(sim, sim.tick + 40, events)
    }
    const names = Object.fromEntries(sim.villages.map((v) => [v.id, v.name]))
    const chronicle = chronicleFromEvents(events, sim.calendarScale, sim.jourDeDepart, names).map(formatChronicleLine)

    expect(chronicle.length).toBeGreaterThan(4)
    expect(chronicle.some((l) => l.includes('Feu s\'est allumé'))).toBe(true)
    // La saison jouée s'ouvre à la fin de l'Ardeur et va jusqu'au cœur de l'hiver : la
    // chronique dit donc les DEUX bascules de saison qu'elle a traversées (S1-S3).
    expect(chronicle.some((l) => l.includes('les Pluies'))).toBe(true)
    expect(chronicle.some((l) => l.includes('Grand Froid'))).toBe(true)
    // Plus de méga-horde nommée (décision ⑲) : le grand mot du récit est « a déferlé »,
    // et il n'est plus GARANTI un jour fixe — la pente le rend probable, pas scripté.
    expect(chronicle.some((l) => l.includes('méga-horde'))).toBe(false)
    expect(chronicle.some((l) => l.includes('arche'))).toBe(true) // l'évacuation est une ARCHE qui part (V2-24)
    expect(chronicle.some((l) => l.includes('éteint. Ce qu\'on retiendra'))).toBe(true)
    expect(chronicle.some((l) => l.includes(sim.villages[0]!.name))).toBe(true)
    // Les jours sont datés en ordre croissant.
    const days = chronicle.map((l) => /^Jour (\d+)/.exec(l)?.[1]).filter(Boolean).map(Number)
    expect([...days].sort((a, b) => a - b)).toEqual(days)
  })
})

describe('le déterminisme (A6)', () => {
  it('deux saisons accélérées identiques au bit près', { timeout: 60_000 }, () => {
    const run = (): string => {
      const sim = makeSim()
      foundNpcVillage(sim, 10, 10, 2, 'foyer')
      foundNpcVillage(sim, 30, 30, 2, 'meute')
      for (let day = 0; day <= BALANCE.SEASON_DAYS; day += 4) {
        sim.tick = day * TICKS_PER_CYCLE
        sim.tick += dayTicksAt(sim, sim.tick) - 5
        for (let t = 0; t < 30; t++) step(sim, [])
      }
      return snapshot(sim)
    }
    expect(run()).toBe(run())
  })
})

