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
import { avanceesDepuisAges, foyersDeLaCarte } from './cendre'
import { toutesLesFumerolles } from './fumerolle'
import { MONDE_JOUE } from './zonegraph'
import { carteDeTest } from '../../../tools/carte-cache'
import { placeZoneNodes } from './zone-content'
import { drainEvents, type SimEvent } from './events'
import { distSq } from './geometry'
import { createEmptyMap, type WorldMap } from './map'
import { modificateurDuJour } from './modificateur'
import { rngNext } from './rng'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { advanceTemperature, AMBIANT_HYPOTHERMIE, ambientTemperature, baselineTemperature } from './temperature'
import { calendarScaleForSeasonCycles, dayTicksPourJour, TICKS_PER_CYCLE } from './time'
import { grantItems } from './village'
import { foundNpcVillage } from './worldgen'

/** La graine du monde RÉEL rejoué en fin de fichier. */
const SEED_REEL = 2026

/** 1 jour de saison = 1 cycle : le crépuscule du cycle c EST le jour c+1. */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

/**
 * LES DEUX SAISONS FROIDES — les seules où la Brume se lève (spec `saisons.md` S13 : la loi
 * lit **0 à l'Éclosion ET à l'Ardeur**, une nappe à −22 °C en plein été n'ayant aucun sens).
 * Les jours 61 à 120 : les Pluies, puis le Grand Froid.
 */
const PREMIER_JOUR_FROID = 2 * BALANCE.ACT_DAYS + 1
const DERNIER_JOUR_FROID = 4 * BALANCE.ACT_DAYS

/**
 * LE CRÉPUSCULE DU JOUR `day`. La longueur du jour est SAISONNIÈRE depuis S6 (0,72 du cycle
 * au cœur de l'Ardeur, 0,48 au cœur du Grand Froid) : elle se dérive donc du jour. Une
 * constante raterait l'égalité exacte qui porte l'annonce — et l'événement se perdrait sans
 * un mot, ce que `estCrepuscule` existe pour empêcher.
 */
function tickCrepusculeDuJour(day: number): number {
  return (day - 1) * TICKS_PER_CYCLE + dayTicksPourJour(day)
}

/**
 * Une carte AVEC UN CHARNIER au bord ouest — l'ancre de la Brume.
 *
 * ⚠ ELLE PORTAIT UN CHAMP DE FRONT (`map.cendre` = x, « la Cendrière est à l'ouest »). Le front
 *   retiré le 2026-08-24, ce champ ne commande plus rien : le montage restait vert à la
 *   compilation et rendait `elireCorridor` MUET, donc neuf critères sur les huit de la spec
 *   tombaient d'un coup. La prémisse du banc est désormais un CHARNIER — la vraie ancre — et
 *   elle est AFFIRMÉE plus bas, pour qu'un prochain déplacement de l'ancre casse ici bruyamment
 *   au lieu de rendre le banc silencieux.
 */
function carteACendre(width = 70, height = 40): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  map.zones.push({ name: 'Le Charnier', x: 2, y: Math.floor(height / 2) - 2, w: 5, h: 5, kind: 'charnier' })
  return map
}

/** Le premier jour des saisons FROIDES que `hash2` élit — ou son contraire. */
function jourDeBrume(eligible: boolean, depuis = PREMIER_JOUR_FROID): number {
  for (let d = depuis; d <= DERNIER_JOUR_FROID; d++) if (brumeJourEligible(d) === eligible) return d
  const tirages = DERNIER_JOUR_FROID - depuis + 1
  throw new Error(`aucun jour de ${depuis} à ${DERNIER_JOUR_FROID} ne convient — le hash aurait ${tirages} tirages identiques`)
}

/**
 * ⚠ `finDeSaison: null` — **la saison ne finit pas, elle tourne** (le réglage du solo, T4).
 * La Brume vit désormais aux jours 61-120, au-delà des `SEASON_DAYS` = 60 de la fin de saison
 * par défaut : sans ça, chaque montage jouerait l'évacuation, l'Arche et le verdict de fin de
 * saison par-dessus la nappe qu'on mesure.
 */
function simBrume(seed = 2026): SimState {
  return createSim(seed, { map: carteACendre(), calendarScale: SCALE, finDeSaison: null })
}

describe('la prémisse du banc', () => {
  it('la carte porte bien une ancre de Brume — sinon tout ce fichier ne mesure RIEN', () => {
    // Une garde prouve sa prémisse : sans ancre, `elireCorridor` rend `null` et chaque critère
    // ci-dessous échoue pour une raison qui n'a rien à voir avec ce qu'il teste.
    expect(foyersDeLaCarte(carteACendre()).length, 'aucun charnier sur la carte-banc').toBe(1)
  })
})

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
    // Le retrait tombe au crépuscule du jour SUIVANT — donc sur SA longueur de jour (S6) :
    // une nappe de fin d'automne se retire plus tôt que celle qui l'a précédée.
    expect(sim.brume!.retreatTick).toBe(d * TICKS_PER_CYCLE + dayTicksPourJour(d + 1))
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
    const sim = createSim(2026, { map: carteACendre(), calendarScale: SCALE, worldEvents: false, finDeSaison: null })
    sim.tick = tickCrepusculeDuJour(jourDeBrume(true))
    drainEvents(sim)
    step(sim, [])
    expect(sim.brume ?? null).toBeNull()
  })

  it('une carte SANS champ de Cendre (les bancs) ne voit jamais de Brume', () => {
    const sim = createSim(2026, { calendarScale: SCALE, finDeSaison: null })
    sim.tick = tickCrepusculeDuJour(jourDeBrume(true))
    drainEvents(sim)
    step(sim, [])
    expect(sim.brume ?? null).toBeNull()
  })

  it('l’Éclosion et l’Ardeur n’ont pas de Brume (la loi y lit 0)', () => {
    // S13 — LA BRUME EST UN MÉCANISME DE FROID, et la refonte des saisons lui a coûté un
    // palier : posée telle quelle, l'ancienne table de trois valeurs donnait 35 % par jour
    // d'une nappe à −22 °C au cœur de l'été. Les DEUX saisons douces lisent zéro.
    expect(BRUME.CHANCE_PER_DAY(1)).toBe(0)
    expect(BRUME.CHANCE_PER_DAY(2)).toBe(0)
    for (let d = 1; d < PREMIER_JOUR_FROID; d++) expect(brumeJourEligible(d)).toBe(false)
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

/**
 * LE JOUR OÙ LA NAPPE SE MESURE — le onzième jour des Pluies, et il tient les DEUX bouts
 * (mesuré) : la plaine de midi y est encore douce (+10,4 °C, au-dessus d'`AMBIANT_DOUX` comme
 * du gate des Cendreux) et la nappe l'y rend létale (10,4 − 22 = −11,6, sous
 * `AMBIANT_HYPOTHERMIE`). Le cœur des Pluies (j75, +8 °C) aurait posé le monde à découvert
 * PILE sur `TORPEUR.CONVERGE_SOUS` = 8 : un verdict qui se serait joué au bit de flottant près.
 */
const JOUR_DE_NAPPE = 2 * BALANCE.ACT_DAYS + 11

describe('le froid de la nappe (A4, A5)', () => {
  it('LA PRÉMISSE — aucun caractère de saison ne décale le jour où la nappe se mesure', () => {
    // UNE GARDE PROUVE SA PRÉMISSE. Les deux marges ci-dessous (1,6 °C sous l'hypothermie,
    // 2,4 au-dessus du gate des Cendreux) supposent une saison ORDINAIRE. Or S18 tire un
    // caractère par saison, et celui des Pluies — l'Été indien — décale la lecture du socle
    // de quinze jours : sous lui, ce jour lirait le 56ᵉ (+19 °C) et la nappe cesserait de
    // tuer. Sans cette ligne, le test tomberait sur « la plaine n'est pas létale », muet.
    expect(modificateurDuJour(JOUR_DE_NAPPE)).toBeNull()
  })

  /** Une nappe STATIQUE posée à la main au midi d'un jour des Pluies (plein jour). */
  function simSousNappe(): { sim: SimState; midi: number } {
    const sim = simBrume(7)
    const midi = (JOUR_DE_NAPPE - 1) * TICKS_PER_CYCLE + Math.floor(dayTicksPourJour(JOUR_DE_NAPPE) / 2)
    sim.tick = midi
    sim.brume = {
      phase: 'nappe',
      day: JOUR_DE_NAPPE,
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
    expect(baselineTemperature(sim, 40.5, 20.5)).toBeLessThan(AMBIANT_HYPOTHERMIE)
    expect(baselineTemperature(sim, 10.5, 20.5)).toBeGreaterThan(TEMPERATURE.AMBIANT_DOUX)
  })

  it('A4 — on y refroidit par DÉRIVE : le temps de fuir, pas un couperet', () => {
    const { sim } = simSousNappe()
    const id = spawnEntity(sim, 40.5, 20.5)
    const e = sim.entities.find((en) => en.id === id)!
    // ⚠ UN CORPS, EN °C (2026-08-22) : 30 °C, déjà refroidi mais au-dessus de l'hypothermie.
    // L'ancien littéral 25 était une JAUGE ; en degrés il vaut `CORPS_MORTEL`, donc le corps
    // partait mort et l'assertion passait par le respawn — le bon vert pour la mauvaise raison.
    e.temperature = 30
    for (let i = 0; i < 50; i++) advanceTemperature(sim)
    expect(e.temperature).toBeLessThan(30) // ça descend…
    expect(e.temperature).toBeGreaterThan(TEMPERATURE.CORPS_HYPOTHERMIE) // …mais pas d'un coup
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
    expect(ambientTemperature(sim, 40.5, 20.5)).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
  })

  it('R5 — le gate d’attraction des Cendreux s’ALLUME de jour sous la nappe (assumé : la Brume est hantée)', () => {
    // Le gate d'attraction (`TORPEUR.CONVERGE_SOUS`, ex-COLD_ATTRACT_THRESHOLD) lit
    // `baselineTemperature` : sous la nappe le froid de base tombe sous le seuil, et un
    // Cendreux pris dedans peut ramper vers un feu allumé EN PLEIN JOUR. Comportement
    // assumé, thématiquement juste — ce test l'ÉPINGLE : si un calibrage de COLD_MALUS le
    // faisait disparaître (ou l'étendait hors nappe), on le saurait.
    const { sim } = simSousNappe()
    expect(baselineTemperature(sim, 40.5, 20.5)).toBeLessThan(CENDREUX.TORPEUR.CONVERGE_SOUS)
    expect(baselineTemperature(sim, 10.5, 20.5)).toBeGreaterThanOrEqual(CENDREUX.TORPEUR.CONVERGE_SOUS)
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

/**
 * ═══ ET MAINTENANT SUR LE MONDE QU'ON JOUE ═══
 *
 * Tout ce qui précède tourne sur une prairie de 70 × 40 avec un charnier posé à la main. C'est
 * exactement le montage qui a laissé la Brume MOURIR en silence (cf. le bandeau de `carteACendre`) :
 * un banc peut satisfaire trivialement des conditions que le vrai monde ne satisfait pas. Or
 * `elireCorridor` en pose cinq sur son point profond — marchable, sans nœud, sans structure, hors
 * cendre — et une sur le segment entier (aucun Feu de village à `RAYON + GARDE_FEU`). Autour d'un
 * charnier RÉEL, dense en nœuds et en pièces, rien ne garantit qu'elles tombent juste.
 *
 * On rejoue donc le vrai générateur sur le vrai plan, taille réduite (le même compromis assumé que
 * `replay-monde-reel.test.ts` : ce qui fait échouer une élection, c'est la VARIÉTÉ du contenu, pas
 * le nombre de tuiles).
 */
describe('la Brume se lève sur le MONDE RÉEL, pas seulement sur le banc', () => {
  const carteReelle = carteDeTest(SEED_REEL, 8, MONDE_JOUE)
  const nodesReels = placeZoneNodes(carteReelle)

  function simReelle(): SimState {
    return createSim(SEED_REEL, {
      map: carteReelle.map,
      nodes: nodesReels,
      calendarScale: SCALE,
      finDeSaison: null,
    })
  }

  it('la prémisse : le vrai monde porte des charniers ET son champ de cheminement', () => {
    expect(foyersDeLaCarte(carteReelle.map).length, 'aucun charnier sur le monde joué').toBeGreaterThan(0)
    expect(carteReelle.map.cendreCout, 'le champ de cheminement de la cendre manque').toBeDefined()
  }, 120_000)

  it('AU MOINS UN jour de la fenêtre froide annonce — la promesse, pas un jour choisi', () => {
    // ⚠ ON BALAIE TOUTE LA FENÊTRE, et c'est la bonne forme. `elireCorridor` a le DROIT de rendre
    //   `null` un jour donné (ses huit essais peuvent tous tomber sur un point profond occupé) :
    //   exiger un jour précis ferait une garde plus serrée que la spec. Ce qu'on exige, c'est que
    //   le mécanisme EXISTE dans une partie réelle — ce qui était faux, sans un rouge, ce matin.
    let annonces = 0
    let essayes = 0
    for (let d = PREMIER_JOUR_FROID; d <= DERNIER_JOUR_FROID && annonces === 0; d++) {
      if (!brumeJourEligible(d)) continue
      essayes++
      const sim = simReelle()
      sim.tick = tickCrepusculeDuJour(d)
      drainEvents(sim)
      step(sim, [])
      if (sim.brume?.phase === 'annoncee') annonces++
    }
    expect(essayes, 'la fenêtre froide n’a élu aucun jour — le banc mesure son décor').toBeGreaterThan(0)
    expect(annonces, `aucune Brume sur ${essayes} jours éligibles du monde réel`).toBeGreaterThan(0)
  }, 120_000)

  it('LA BRANCHE FUMEROLLE : cendre mûre, le corridor part d’une BOUCHE', () => {
    // Les bouches ne s'ouvrent qu'au cœur d'une cendre déjà profonde — bien après la première
    // fenêtre froide. On VIEILLIT donc les foyers à la main : ce test porte sur la branche du
    // code, pas sur le calendrier (que `cendre.test.ts` garde de son côté).
    const foyers = foyersDeLaCarte(carteReelle.map)
    const ages = foyers.map(() => 900)
    const bouches = toutesLesFumerolles(carteReelle.map, avanceesDepuisAges(ages, foyers.length), SEED_REEL)
    expect(bouches.length, 'prémisse : aucune fumerolle même à cendre mûre').toBeGreaterThan(0)

    let vu = false
    for (let d = PREMIER_JOUR_FROID; d <= DERNIER_JOUR_FROID && !vu; d++) {
      if (!brumeJourEligible(d)) continue
      const sim = simReelle()
      sim.cendreAge = ages
      sim.tick = tickCrepusculeDuJour(d)
      drainEvents(sim)
      step(sim, [])
      if (!sim.brume) continue
      vu = true
      const surUneBouche = bouches.some(
        (b) => b.tx + 0.5 === sim.brume!.x0 && b.ty + 0.5 === sim.brume!.y0,
      )
      expect(surUneBouche, `origine (${sim.brume.x0},${sim.brume.y0}) hors de toute bouche`).toBe(true)
    }
    expect(vu, 'aucune Brume levée : la branche fumerolle n’a jamais été exécutée').toBe(true)
  }, 120_000)
})
