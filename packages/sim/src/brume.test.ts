/**
 * LA BRUME (spec `brume.md`) — les critères A1-A8.
 *
 * La carte-banc porte un champ de Cendre SYNTHÉTIQUE (distance = x : la Cendrière est à
 * l'ouest), et le calendrier est couplé 1 jour = 1 cycle (`calendarScaleForSeasonCycles`)
 * pour que le crépuscule du cycle c soit exactement le jour c+1. On SAUTE aux bords de
 * cycle (le tick se pose, puis `step()` joue le tick entier — jamais une phase seule).
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, BRUME, CENDREUX, TEMPERATURE, TERRAIN_GRASS } from './balance'
import { advanceBrume, brumeCentre, brumeJourEligible, dansLaBrume } from './brume'
import { drainEvents, type SimEvent } from './events'
import { distSq } from './geometry'
import { createEmptyMap, type WorldMap } from './map'
import { rngNext } from './rng'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { advanceTemperature, ambientTemperature, baselineTemperature } from './temperature'
import { calendarScaleForSeasonCycles, DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE } from './time'
import { grantItems } from './village'
import { foundNpcVillage } from './worldgen'

/** 1 jour de saison = 1 cycle : le crépuscule du cycle c EST le jour c+1. */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

function tickCrepusculeDuJour(day: number): number {
  return (day - 1) * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE
}

/** Une carte AVEC Cendrière : champ de cendre = x (la Cendrière est le bord ouest). */
function carteACendre(width = 70, height = 40): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  map.cendre = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) map.cendre.push(x)
  map.cendreMax = 8
  return map
}

/** Le premier jour d'acte II-III (avant l'évacuation) que `hash2` élit — ou son contraire. */
function jourDeBrume(eligible: boolean, depuis = 22): number {
  for (let d = depuis; d <= 54; d++) if (brumeJourEligible(d) === eligible) return d
  throw new Error('aucun jour ne convient — le hash aurait 33 tirages identiques')
}

function simBrume(seed = 2026): SimState {
  return createSim(seed, { map: carteACendre(), calendarScale: SCALE })
}

function types(events: SimEvent[]): SimEvent['type'][] {
  return events.map((e) => e.type)
}

describe('l’annonce (A3, A8)', () => {
  it('au crépuscule d’un jour éligible : corridor élu, gibier tu, chronique prévenue', () => {
    const d = jourDeBrume(true)
    const sim = simBrume()
    sim.tick = tickCrepusculeDuJour(d)
    drainEvents(sim)
    step(sim, [])

    expect(sim.brume?.phase).toBe('annoncee')
    expect(types(drainEvents(sim))).toContain('brume_annonce')
    // La levée à l'aube suivante, le retrait au crépuscule d'après.
    expect(sim.brume!.riseTick).toBe(d * TICKS_PER_CYCLE)
    expect(sim.brume!.retreatTick).toBe(d * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE)
    // R6 — le silence EST le signe : le corridor est couvert jusqu'au retrait.
    const quiets = sim.faunaQuiet.filter((q) => q.until === sim.brume!.retreatTick)
    expect(quiets.length).toBeGreaterThanOrEqual(3)
    // Le corridor va du bord du front vers la profondeur (la Cendrière est à l'ouest).
    expect(sim.brume!.x1).toBeGreaterThan(sim.brume!.x0)
  })

  it('un jour que le hash n’élit pas reste sans Brume', () => {
    const d = jourDeBrume(false)
    const sim = simBrume()
    sim.tick = tickCrepusculeDuJour(d)
    drainEvents(sim)
    step(sim, [])
    expect(sim.brume ?? null).toBeNull()
    expect(types(drainEvents(sim))).not.toContain('brume_annonce')
  })

  it('A8 — worldEvents=false : aucune annonce, jamais', () => {
    const sim = createSim(2026, { map: carteACendre(), calendarScale: SCALE, worldEvents: false })
    sim.tick = tickCrepusculeDuJour(jourDeBrume(true))
    drainEvents(sim)
    step(sim, [])
    expect(sim.brume ?? null).toBeNull()
  })

  it('une carte SANS champ de Cendre (les bancs) ne voit jamais de Brume', () => {
    const sim = createSim(2026, { calendarScale: SCALE })
    sim.tick = tickCrepusculeDuJour(jourDeBrume(true))
    drainEvents(sim)
    step(sim, [])
    expect(sim.brume ?? null).toBeNull()
  })

  it('l’acte I n’a pas de Brume (CHANCE_PER_DAY[0] = 0)', () => {
    expect(BRUME.CHANCE_PER_DAY[0]).toBe(0)
    for (let d = 1; d <= BALANCE.ACT_BOUNDARIES[0]!; d++) expect(brumeJourEligible(d)).toBe(false)
  })
})

describe('la nappe fait l’aller-retour (R1)', () => {
  it('levée à l’aube, point profond à mi-fenêtre, retrait au crépuscule', () => {
    const d = jourDeBrume(true)
    const sim = simBrume()
    sim.tick = tickCrepusculeDuJour(d)
    step(sim, [])
    const brume = sim.brume!

    sim.tick = brume.riseTick
    drainEvents(sim)
    step(sim, [])
    expect(brume.phase).toBe('nappe')
    expect(types(drainEvents(sim))).toContain('brume_levee')

    // À la levée le centre est à l'ENTRÉE ; à mi-fenêtre, au POINT PROFOND.
    const debut = brumeCentre(brume, brume.riseTick)!
    expect(distSq(debut.x, debut.y, brume.x0, brume.y0)).toBeLessThan(0.01)
    const milieu = brumeCentre(brume, (brume.riseTick + brume.retreatTick) / 2)!
    expect(distSq(milieu.x, milieu.y, brume.x1, brume.y1)).toBeLessThan(0.01)
    // Et dansLaBrume suit le centre, pas le corridor entier.
    sim.tick = Math.floor((brume.riseTick + brume.retreatTick) / 2)
    expect(dansLaBrume(sim, brume.x1, brume.y1)).toBe(true)
    expect(dansLaBrume(sim, brume.x0 - BRUME.RAYON - 2, brume.y0)).toBe(false)
  })
})

describe('le retrait paie (A6)', () => {
  function jusquAuRetrait(): { sim: SimState; retraits: SimEvent[]; jour: number } {
    const d = jourDeBrume(true)
    const sim = simBrume()
    sim.tick = tickCrepusculeDuJour(d)
    step(sim, [])
    sim.tick = sim.brume!.riseTick
    step(sim, [])
    sim.tick = sim.brume!.retreatTick
    drainEvents(sim)
    step(sim, [])
    return { sim, retraits: drainEvents(sim), jour: d }
  }

  it('filon posé au point profond, gardé par des traînards à échéance', () => {
    const { sim, retraits } = jusquAuRetrait()
    expect(sim.brume ?? null).toBeNull()
    expect(types(retraits)).toContain('brume_retiree')
    const decouverte = retraits.find((e) => e.type === 'filon_decouvert')
    expect(decouverte).toBeTruthy()

    const filon = sim.brumeFilon!
    const node = sim.nodes.find((n) => n.id === filon.nodeId)!
    expect(node.stock).toBe(BRUME.FILON_STOCK)
    expect(['iron_vein', 'coal_seam']).toContain(node.type)
    expect(node.regrowAt).toBe(0) // un événement, pas un gisement

    const gardes = sim.monsters.filter((m) => m.type === 'cendreux' && m.expiresAt !== undefined)
    expect(gardes.length).toBe(BRUME.TRAINARDS)
  })

  it('vidé, le filon se retire dans la seconde — en SILENCE (node_depleted a déjà parlé)', () => {
    const { sim } = jusquAuRetrait()
    const filonId = sim.brumeFilon!.nodeId
    sim.nodes.find((n) => n.id === filonId)!.stock = 0
    for (let i = 0; i < 25; i++) step(sim, []) // la vérification est cadencée (20 ticks)
    expect(sim.nodes.some((n) => n.id === filonId)).toBe(false)
    expect(sim.brumeFilon ?? null).toBeNull()
    expect(types(drainEvents(sim))).not.toContain('filon_retire')
  })

  it('périmé (FILON_JOURS passés), le filon se retire — et LE DIT (`filon_retire`)', () => {
    const { sim } = jusquAuRetrait()
    const filon = sim.brumeFilon!
    sim.tick = filon.expiresDay * TICKS_PER_CYCLE + 10 // un tick quelconque du jour suivant
    for (let i = 0; i < 25; i++) step(sim, [])
    expect(sim.nodes.some((n) => n.id === filon.nodeId)).toBe(false)
    expect(sim.brumeFilon ?? null).toBeNull()
    expect(types(drainEvents(sim))).toContain('filon_retire')
  })

  it('deux Brumes successives : ids JAMAIS réutilisés, l’ancien filon se retire en le disant', () => {
    const { sim, jour } = jusquAuRetrait()
    const id1 = sim.brumeFilon!.nodeId
    const d2 = jourDeBrume(true, jour + 1)
    sim.tick = tickCrepusculeDuJour(d2)
    step(sim, [])
    sim.tick = sim.brume!.riseTick
    step(sim, [])
    sim.tick = sim.brume!.retreatTick
    step(sim, [])
    const evts = types(drainEvents(sim))
    const id2 = sim.brumeFilon!.nodeId
    expect(id2).not.toBe(id1)
    expect(id2).toBeGreaterThan(id1) // l'espace d'ids croît avec le jour (axiome PART_DU_NOEUD)
    expect(sim.nodes.some((n) => n.id === id1)).toBe(false)
    expect(evts).toContain('filon_retire') // périmé au passage du jour, ou remplacé au retrait
  })
})

describe('le froid de la nappe (A4, A5)', () => {
  /** Une nappe STATIQUE posée à la main au midi du jour 25 (acte II, plein jour). */
  function simSousNappe(): { sim: SimState; midi: number } {
    const sim = simBrume(7)
    const midi = 24 * TICKS_PER_CYCLE + Math.floor(DAY_TICKS_PER_CYCLE / 2)
    sim.tick = midi
    sim.brume = {
      phase: 'nappe',
      day: 25,
      riseTick: midi - 10,
      retreatTick: midi + 100000,
      x0: 40.5,
      y0: 20.5,
      x1: 40.5,
      y1: 20.5,
    }
    return { sim, midi }
  }

  it('A4 — la plaine de JOUR devient létale sous la nappe, et reste douce à côté', () => {
    const { sim } = simSousNappe()
    expect(baselineTemperature(sim, 40.5, 20.5)).toBeLessThan(TEMPERATURE.HYPOTHERMIA)
    expect(baselineTemperature(sim, 10.5, 20.5)).toBeGreaterThan(TEMPERATURE.COMFORT)
  })

  it('A4 — on y refroidit par DÉRIVE : le temps de fuir, pas un couperet', () => {
    const { sim } = simSousNappe()
    const id = spawnEntity(sim, 40.5, 20.5)
    const e = sim.entities.find((en) => en.id === id)!
    e.temperature = 25
    for (let i = 0; i < 50; i++) advanceTemperature(sim)
    expect(e.temperature).toBeLessThan(25) // ça descend…
    expect(e.temperature).toBeGreaterThan(20) // …mais pas d'un coup
  })

  it('A5 — la tenue d’hiver PLANCHE : sous la nappe, on remonte vers TENUE_FLOOR', () => {
    const { sim } = simSousNappe()
    const id = spawnEntity(sim, 40.5, 20.5)
    const e = sim.entities.find((en) => en.id === id)!
    grantItems(sim, id, { tenue_hiver: 1 })
    e.temperature = 25
    for (let i = 0; i < 50; i++) advanceTemperature(sim)
    expect(e.temperature).toBeGreaterThan(25) // le plancher tire vers le haut
  })

  it('A5 — la bulle d’un Feu de village tient la nappe dehors', () => {
    const { sim } = simSousNappe()
    foundNpcVillage(sim, 40, 20, 0)
    expect(ambientTemperature(sim, 40.5, 20.5)).toBeGreaterThan(TEMPERATURE.HYPOTHERMIA)
  })

  it('R5 — le gate d’attraction des Cendreux s’ALLUME de jour sous la nappe (assumé : la Brume est hantée)', () => {
    // Le gate feu-station S5 lit `baselineTemperature` : sous la nappe le froid de base tombe
    // sous COLD_ATTRACT_THRESHOLD, et un Cendreux pris dedans peut ramper vers un feu allumé
    // EN PLEIN JOUR. Comportement neuf, thématiquement juste — ce test l'ÉPINGLE : si un
    // calibrage de COLD_MALUS le faisait disparaître (ou l'étendait hors nappe), on le saurait.
    const { sim } = simSousNappe()
    expect(baselineTemperature(sim, 40.5, 20.5)).toBeLessThan(CENDREUX.COLD_ATTRACT_THRESHOLD)
    expect(baselineTemperature(sim, 10.5, 20.5)).toBeGreaterThanOrEqual(CENDREUX.COLD_ATTRACT_THRESHOLD)
  })
})

describe('la garde des Feux (R3, A7)', () => {
  it('des Feux qui barrent toutes les lignes : la Brume renonce', () => {
    const d = jourDeBrume(true)
    const sim = simBrume()
    // Trois Feux à x=18, espacés de 14 : tout corridor ouest→est passe à moins de
    // RAYON + GARDE_FEU (= 14) de l'un d'eux — les huit essais doivent échouer.
    foundNpcVillage(sim, 18, 6, 0)
    foundNpcVillage(sim, 18, 20, 0)
    foundNpcVillage(sim, 18, 34, 0)
    sim.tick = tickCrepusculeDuJour(d)
    drainEvents(sim)
    step(sim, [])
    expect(sim.brume ?? null).toBeNull()
  })
})

describe('déterminisme (A1, A2/R9)', () => {
  it('R9 — l’annonce et la levée ne tirent RIEN ; le retrait, exactement les pas des traînards', () => {
    const d = jourDeBrume(true)
    const sim = simBrume()
    sim.tick = tickCrepusculeDuJour(d)
    const avant = sim.rngState
    advanceBrume(sim)
    expect(sim.brume?.phase).toBe('annoncee')
    expect(sim.rngState).toBe(avant)

    sim.tick = sim.brume!.riseTick
    advanceBrume(sim)
    expect(sim.brume?.phase).toBe('nappe')
    expect(sim.rngState).toBe(avant)

    sim.tick = sim.brume!.retreatTick
    advanceBrume(sim)
    expect(sim.brume ?? null).toBeNull()
    let attendu = avant
    for (let i = 0; i < BRUME.TRAINARDS; i++) attendu = rngNext(attendu)
    expect(sim.rngState).toBe(attendu) // les seuls pas : ceux, délibérés, de spawnEntity
  })

  it('A1 — deux mondes, même seed, mêmes sauts : états identiques au retrait', () => {
    const d = jourDeBrume(true)
    const joue = (): SimState => {
      const sim = simBrume()
      sim.tick = tickCrepusculeDuJour(d)
      step(sim, [])
      sim.tick = sim.brume!.riseTick
      step(sim, [])
      sim.tick = sim.brume!.retreatTick
      step(sim, [])
      return sim
    }
    expect(snapshot(joue())).toBe(snapshot(joue()))
  })
})
