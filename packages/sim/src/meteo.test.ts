/**
 * LA MÉTÉO (spec `meteo.md`) — tranche 1 : les critères A1, A2, A9, A10 du front inerte,
 * plus la pureté de la géométrie et la distribution des types par acte. Tranche 2 : le
 * FROID des fronts (R4, critère A3) — section « R4 — le froid des fronts », patron des
 * tests thermiques A4/A5 de la Brume. Tranche 3 : LA FAUNE SE TERRE (R6, critère A5) —
 * section « R6 », prédicat `meteoQuiet` + le comportement calqué sur les gardes A17 de
 * faune.test.ts. Tranche 5 : VITESSE ET PERCEPTION (R7, critère A7) — section « R7 —
 * vitesse et perception (A7) » : les deux lois continues, la marche sous la pluie contre
 * la marche au sec, et les trois lois de détection (loup, Cendreux, gibier) voilées AU
 * POINT DE LA CIBLE. Tranche 6 : LA FOUDRE (R8, critère A6) — section « R8 — la foudre
 * (A6) » en fin de fichier : l'élection pure par créneau (déterminisme, cadence exacte,
 * télégraphe), la résolution (l'abri supprime et épargne, jamais létal à PV pleins, la
 * cause `lightning`, zéro tirage) et le repli des PNJ vers l'abri. Tranche 7 : L'ANNONCE
 * (R9) — section « R9 — l'annonce (blizzard) » : l'écrivain unique (`meteoTypeDuCycle`),
 * le triplet annonce → entre → passe de chaque front blizzard, le silence des autres
 * fronts, la chronique (l'annonce seule y entre) et le zéro-tirage.
 *
 * AMENDEMENT 2026-08-22 (spec R11-R13, `docs/decisions.md`) : LA NEIGE SE DÉRIVE DU FROID.
 * `neige` et `blizzard` ne sont plus des types élus — un front porte une CLASSE (`pluie`,
 * `orage`, `brouillard`, `vent_de_cendre`) et l'ASPECT se lit au point (`meteoAspectAt`) :
 * il neige là où la pluie ferait geler un gué, un orage y est un blizzard. Les montages
 * « sous blizzard » de ce fichier posent donc un ORAGE au cœur du GRAND FROID, de JOUR
 * (T₀ = −2 °C < la limite de neige → `partDeBlizzard` = 1 → la ligne `ORAGE_FROID`, le
 * blizzard d'avant au bit près) ; les montages « sous neige », une PLUIE là où T₀ < +4 °C.
 * La section « R11-R13 » en fin de fichier porte les gardes neuves A12-A15.
 *
 * AMENDEMENT 2026-08-23 (spec `saisons.md` S1-S18) : L'ANNÉE TOURNE, ET LE CIEL EST PAR
 * SAISON. Quatre saisons de `ACT_DAYS` = 30 jours — l'Éclosion, l'Ardeur, les Pluies, le
 * Grand Froid — donc `YEAR_DAYS` = 120 : les balayages « une saison » de ce fichier
 * parcourent le TOUR ENTIER, et les montages s'ancrent au CŒUR d'une saison nommée
 * (`coeurDe`), jamais sur un numéro de jour hérité de l'arc de 21 jours. Le froid n'est plus
 * une marche par acte mais une COURBE du jour de l'année (S4), la fréquence, la mixture, la
 * largeur et la fenêtre d'un front sont des réglages de saison (S7-S9, `METEO.PAR_SAISON`),
 * et — décision d'Alexis — **seule la VIOLENCE fait taire le gibier** : `QUIET.pluie` est
 * passé à faux, les montages « le silence » posent donc un ORAGE.
 *
 * Le calendrier est couplé 1 jour = 1 cycle (`calendarScaleForSeasonCycles`) : l'aube du
 * cycle c EST le jour c+1, et on SAUTE aux bords de cycle (le tick se pose, puis `step()`
 * joue le tick entier — jamais une phase seule ; patron brume.test.ts). Les élections sont
 * des fonctions pures du CYCLE (`hash2` sur l'index de BLOC, S9) : les comptes ci-dessous
 * sont DÉTERMINISTES — relevés à la sonde, pas espérés statistiquement, et ils ne dépendent
 * PAS de la graine (le PRNG d'état n'est jamais tiré : spec R10).
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE, CENDREUX, FAUNA, GEL, METEO, MONSTER_DEFS, TEMPERATURE, TERRAIN_GLACIER, TERRAIN_GRASS,
  TERRAIN_MARSH, TERRAIN_SNOW,
} from './balance'
import { brumeJourEligible } from './brume'
import { CHRONICLE_EVENT_TYPES, chronicleFromEvents } from './chronicle'
import { drainEvents, type SimEvent } from './events'
import { avatarThreat, faunaStep, wolfStep, wolfVigor } from './faune'
import { fireActive, fireState, fireWarmthFactor, fuelTicksRemaining } from './fire'
import { countOf } from './items'
import { createEmptyMap, setTile } from './map'
import { effetsDuJour } from './modificateur'
import { neigeAuSol } from './gel'
import { advanceFoudre } from './foudre'
import { distSq } from './geometry'
import {
  advanceMeteo, aspectSousFront, episodeDuBloc, fenetreDe, FOUDRE_CRENEAU_TICKS, foudreImpactAt,
  foudreTelegrapheAt, partDeBlizzard, frontDuCycle, frontEstBlizzard, frontMeteoPos, frontMouille,
  largeurDe, meteoAspectAt, meteoColdAt, meteoFeuConso, meteoIntensity, meteoIntensityAt,
  meteoCycleEligible, meteoMouille, meteoQuiet, meteoSpeedFactor, meteoSpeedFactorAt,
  meteoTypeBrut, meteoTypeDuCycle, meteoVisionFactor, neigeA, partDeNeige,
  type BandeMeteo, type MeteoAspect, type MeteoFront, type MeteoType,
} from './meteo'
import { nearestPrey, spawnMonster, type Monster } from './monsters'
import { createSim, snapshot, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import {
  advanceTemperature, AMBIANT_HYPOTHERMIE, ambientTemperature, baselineTemperature, cibleCorporelle,
  dehorsSansMeteo, fireBubble, isSheltered, socleDuJour,
} from './temperature'
import {
  actForDay, calendarScaleForSeasonCycles, cycleOffsetForStartHour, dayTicksPourJour, phaseForDay,
  TICKS_PER_CYCLE, YEAR_DAYS,
} from './time'
import { addStructure, applyVillageAction, grantItems, structureAt } from './village'
import { foundNpcVillage } from './worldgen'

/** 1 jour de saison = 1 cycle : l'aube du cycle c est le jour c+1. */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

/**
 * LE CŒUR D'UNE SAISON, en jour de l'année — 1 l'Éclosion, 2 l'Ardeur, 3 les Pluies, 4 le
 * Grand Froid (S3). Les montages s'y ancrent : c'est là que la courbe du socle touche son
 * cardinal (+8 / +26 / +8 / −2) et que la table `PAR_SAISON` dit le plus franchement ce
 * qu'elle dit. Dérivé d'`ACT_DAYS` : recaler la longueur d'une saison recale les montages.
 */
function coeurDe(phase: number): number {
  return (phase - 1) * BALANCE.ACT_DAYS + Math.floor(BALANCE.ACT_DAYS / 2)
}
const MI_ECLOSION = coeurDe(1)
const MI_ARDEUR = coeurDe(2)
const MI_PLUIES = coeurDe(3)
const MI_GRAND_FROID = coeurDe(4)
/** UN JOUR DE DÉGEL de l'Éclosion, deux jours après le cardinal (+9,2 °C) : les montages qui
 *  encadrent un seuil s'y posent, parce que mi-Éclosion tombe PILE sur +8 — la valeur de
 *  `CENDREUX.TORPEUR.CONVERGE_SOUS`. Un seuil testé sur la valeur qu'il vaut ne garde rien. */
const JOUR_DEGEL = MI_ECLOSION + 2

function tickAubeDuJour(day: number): number {
  return (day - 1) * TICKS_PER_CYCLE
}

/** Le MIDI du jour — la longueur du jour est saisonnière depuis S6 (0,72 de cycle au cœur de
 *  l'Ardeur, 0,48 au cœur du Grand Froid) : le midi d'hiver n'est plus celui d'été. */
function tickMidiDuJour(day: number): number {
  return tickAubeDuJour(day) + Math.floor(dayTicksPourJour(day) / 2)
}

/** Le MILIEU DE LA NUIT du jour — l'autre bout de la même horloge saisonnière. */
function tickMinuitDuJour(day: number): number {
  const jour = dayTicksPourJour(day)
  return tickAubeDuJour(day) + jour + Math.floor((TICKS_PER_CYCLE - jour) / 2)
}

function simMeteo(seed = 2026, meteoActive = true): SimState {
  return createSim(seed, { map: createEmptyMap(70, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive })
}

/** Joue l'élection de chaque jour par SAUTS d'aube et relève les fronts élus. L'ANNÉE ENTIÈRE
 *  par défaut (S1) : un balayage de soixante jours ne verrait que l'Éclosion et l'Ardeur, et
 *  raterait les deux saisons qui portent le ciel — les Pluies et le Grand Froid. */
function frontsDeLAnnee(sim: SimState, jours = YEAR_DAYS): MeteoFront[] {
  const fronts: MeteoFront[] = []
  for (let d = 1; d <= jours; d++) {
    sim.tick = tickAubeDuJour(d)
    step(sim, [])
    if (sim.meteo) fronts.push({ ...sim.meteo })
  }
  return fronts
}

describe('A1 — même seed, mêmes élections', () => {
  it('types, bords et fenêtres identiques sur une ANNÉE ; état bit-identique au rejeu', () => {
    const a = simMeteo()
    const fa = frontsDeLAnnee(a)
    const b = simMeteo()
    const fb = frontsDeLAnnee(b)
    expect(fa.length).toBeGreaterThan(0) // l'année a bien une météo — sinon on ne mesure rien
    expect(fa).toEqual(fb)
    expect(snapshot(a)).toBe(snapshot(b))
  })

  it('un front paraît EXACTEMENT les jours que `meteoCycleEligible` élit — jamais un autre', () => {
    const sim = simMeteo()
    for (let d = 1; d <= YEAR_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      step(sim, [])
      expect(sim.meteo !== null && sim.meteo !== undefined).toBe(meteoCycleEligible(d - 1, SCALE, sim.jourDeDepart))
      if (sim.meteo) expect(sim.meteo.day).toBe(d)
    }
  })

  it('l’élection du jour est gardée par `lastMeteoCycle` : rejouée au même tick, elle ne bouge plus', () => {
    const sim = simMeteo()
    const d = [...Array(YEAR_DAYS)].findIndex((_, i) => meteoCycleEligible(i, SCALE, sim.jourDeDepart)) + 1
    sim.tick = tickAubeDuJour(d)
    advanceMeteo(sim)
    expect(sim.meteo?.day).toBe(d)
    const apres = snapshot(sim)
    advanceMeteo(sim)
    expect(snapshot(sim)).toBe(apres)
  })
})

describe('A2 — zéro tirage sur le PRNG d’état', () => {
  it('le flux RNG est bit-identique météo armée ou pas, sur une année entière', () => {
    const avec = simMeteo(2026, true)
    const sans = simMeteo(2026, false)
    let fronts = 0
    for (let d = 1; d <= YEAR_DAYS; d++) {
      avec.tick = tickAubeDuJour(d)
      sans.tick = tickAubeDuJour(d)
      step(avec, [])
      step(sans, [])
      expect(avec.rngState).toBe(sans.rngState)
      if (avec.meteo) fronts++
    }
    expect(fronts).toBeGreaterThan(0) // la météo a bien tourné : la comparaison porte sur du vrai
  })
})

describe('A9 — un seul front, et jamais de blizzard un jour de Brume', () => {
  it('la fenêtre tient dans le cycle — À TOUTE SAISON : la construction qui rend le chevauchement impossible', () => {
    // La fenêtre est SAISONNIÈRE depuis S8 (un cycle ENTIER aux Pluies, ¾ au Grand Froid) : ce
    // n'est plus une constante qu'on borne, c'est une table qu'on balaie. À 1 cycle, la fenêtre
    // finit PILE au cycle suivant — où la purge précède l'élection (`advanceMeteo`) : l'unicité
    // du front tient encore, mais elle tient sur l'ordre des deux gestes, plus sur une marge.
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      for (const type of ['pluie', 'brouillard', 'orage', 'vent_de_cendre'] as const) {
        const f = fenetreDe({ type, day: jour })
        expect(f, `${type} au jour ${jour}`).toBeLessThanOrEqual(TICKS_PER_CYCLE)
        expect(f, `${type} au jour ${jour}`).toBeGreaterThan(0)
      }
    }
  })

  it('année × 3 seeds : les fenêtres élues ne se chevauchent jamais', () => {
    for (const seed of [1, 7, 2026]) {
      const fronts = frontsDeLAnnee(simMeteo(seed))
      expect(fronts.length).toBeGreaterThan(0)
      for (let i = 1; i < fronts.length; i++) {
        expect(fronts[i]!.startTick).toBeGreaterThanOrEqual(fronts[i - 1]!.endTick)
      }
    }
  })

  it('R3 — un jour éligible à la Brume n’élit JAMAIS un orage : il se dégrade en pluie (et jamais de blizzard, donc)', () => {
    const sim = simMeteo()
    let degrades = 0
    for (let d = 1; d <= 600; d++) {
      sim.tick = tickAubeDuJour(d)
      advanceMeteo(sim)
      const front = sim.meteo
      if (!front || front.day !== d) continue
      if (brumeJourEligible(d)) {
        expect(front.type).not.toBe('orage')
        expect(frontEstBlizzard(sim, front)).toBe(false) // le blizzard est un orage : écarté avec lui
        if (meteoTypeBrut(d - 1, SCALE, sim.jourDeDepart) === 'orage') {
          expect(front.type).toBe('pluie')
          degrades++
        }
      } else {
        expect(front.type).toBe(meteoTypeBrut(d - 1, SCALE, sim.jourDeDepart)) // hors Brume, l'élu brut passe tel quel
      }
    }
    // La règle a MORDU : le domaine balayé contient de vrais jours orage × Brume — sinon ce
    // test mesurerait l'instrument, pas la règle.
    expect(degrades).toBeGreaterThan(0)
  })
})

describe('A10 — l’interrupteur dédié, faux par défaut', () => {
  it('sans `meteoActive`, advanceMeteo ne touche pas UN octet de l’état — sur toute l’année', () => {
    const sim = createSim(2026, { map: createEmptyMap(70, 40, TERRAIN_GRASS), calendarScale: SCALE })
    expect('meteoActive' in sim).toBe(false) // la clé n'existe même pas : l'empreinte d'avant le système
    for (let d = 1; d <= YEAR_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      const avant = snapshot(sim)
      advanceMeteo(sim)
      expect(snapshot(sim)).toBe(avant) // le module dans la boucle EST le module hors de la boucle
    }
    expect(sim.meteo ?? null).toBeNull()
    expect(sim.lastMeteoCycle).toBeUndefined()
  })

  it('une année entière au step, météo éteinte : jamais de front', () => {
    const sim = simMeteo(2026, false)
    for (let d = 1; d <= YEAR_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      step(sim, [])
    }
    expect(sim.meteo ?? null).toBeNull()
    expect(sim.lastMeteoCycle).toBeUndefined()
  })

  it('armée à la demande : `meteoActive` vient des options de l’hôte', () => {
    expect(simMeteo().meteoActive).toBe(true)
  })

  it('SÉPARÉ de `worldEvents` (R10) : la pluie tombe sur un banc sans convois ni hordes', () => {
    // Le banc d'économie veut la météo SEULE : `worldEvents: false, meteoActive: true`
    // doit élire des fronts — l'ordonnanceur ne vit pas dans le bloc des événements.
    const sim = createSim(2026, {
      map: createEmptyMap(70, 40, TERRAIN_GRASS),
      calendarScale: SCALE,
      worldEvents: false,
      meteoActive: true,
    })
    let elu = 0
    for (let d = 1; d <= YEAR_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      step(sim, [])
      if (sim.meteo) elu++
    }
    expect(elu).toBeGreaterThan(0)
  })
})

/**
 * LES VARIANTES PARAMÉTRÉES PAR LE TICK (chantier de rendu) — `meteoIntensityAt` et
 * `meteoSpeedFactorAt` sont les portes par lesquelles LE CLIENT lit la météo : il n'a pas
 * de `SimState`, il a une façade reconstituée du snapshot (`etat-gel.ts`). Ce sont les
 * MÊMES lois, extraites — et cette garde existe pour qu'elles le RESTENT : le jour où
 * quelqu'un calibrera la rampe d'un seul côté, le ciel dessiné cesserait d'être le ciel
 * simulé, et un rendu qui ment sur le froid qu'il apporte est pire qu'un rendu absent.
 *
 * Depuis R12 le pas sous un orage dépend du froid du monde (heure, biome) : la variante
 * prend donc l'ÉTAT et le tick — et on la balaie sur un VRAI état (un monde vide), les
 * quatre classes, les quatre bords, toute la traversée, tout l'axe perpendiculaire, au CŒUR
 * DE L'ARDEUR (+26 °C : la pente R12 est à zéro) et au CŒUR DU GRAND FROID (−2 °C : elle
 * sature) — les deux bouts de la courbe du socle, pour que la pente soit vraiment exercée.
 */
describe('les variantes paramétrées par le tick sont les mêmes lois, au bit près (le client lit par là)', () => {
  const TYPES: MeteoType[] = ['pluie', 'brouillard', 'orage', 'vent_de_cendre']

  it('meteoIntensityAt et meteoSpeedFactorAt égalent EXACTEMENT leurs jumelles à état', () => {
    const [W, H] = [140, 160]
    let compares = 0
    let pleins = 0 // des pas d'orage à la ligne ORAGE_FROID : la pente R12 a bien été montée
    for (const day of [MI_ARDEUR, MI_GRAND_FROID]) {
      const state = createSim(5, { map: createEmptyMap(W, H, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
      for (const type of TYPES) {
        for (const edge of [0, 1, 2, 3] as const) {
          const start = tickAubeDuJour(day) + 500
          const front: MeteoFront = { type, cycle: day - 1, day, edge, startTick: start, endTick: start + METEO.TRAVERSEE_TICKS }
          state.meteo = front
          for (let k = 0; k <= 12; k++) {
            const tick = front.startTick + Math.round((k / 12) * (METEO.TRAVERSEE_TICKS - 1))
            state.tick = tick
            for (let c = -20; c <= Math.max(W, H) + 20; c += 7) {
              const x = edge <= 1 ? c : 40
              const y = edge <= 1 ? 40 : c
              expect(meteoIntensityAt(front, tick, W, H, x, y)).toBe(meteoIntensity(state, x, y))
              const v = meteoSpeedFactorAt(state, tick, x, y)
              expect(v).toBe(meteoSpeedFactor(state, x, y))
              if (type === 'orage' && v === METEO.ORAGE_FROID.SPEED) pleins++
              compares += 2
            }
          }
        }
      }
    }
    // La garde prouve sa prémisse : elle a bien comparé quelque chose, et pas zéro fois —
    // et l'orage a bien été pris au plein froid, pas seulement par temps doux.
    expect(compares).toBeGreaterThan(10_000)
    expect(pleins).toBeGreaterThan(0)
  })

  it('sans front, la variante rend le neutre (1) — le client sans météo ne peint rien', () => {
    const state = createSim(5, { map: createEmptyMap(100, 100, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    // `null` (le champ purgé) ET `undefined` (un snapshot qui ne porte pas la clé) : les deux
    // arrivent vraiment côté client, et les deux doivent rendre le neutre.
    for (const front of [null, undefined]) {
      ;(state as { meteo: MeteoFront | null | undefined }).meteo = front
      expect(meteoSpeedFactorAt(state, 1000, 50, 50)).toBe(1)
    }
  })
})

describe('la géométrie est pure — la bande se calcule du tick, elle n’est jamais rangée', () => {
  const DUR = METEO.TRAVERSEE_TICKS
  // MI-ARDEUR : c'est la saison dont la bande de pluie (60 tuiles) tient tout entière sur une
  // carte de test — aux Pluies elle en fait 4500 et la géométrie n'aurait plus de « dehors ».
  const fabrique = (edge: MeteoFront['edge']): MeteoFront => ({
    type: 'pluie', cycle: 0, day: MI_ARDEUR, edge, startTick: 1000, endTick: 1000 + DUR,
  })

  it('les 4 bords : bord AVANT au bord d’entrée au startTick, bande sortie au endTick, linéaire entre', () => {
    const [W, H] = [90, 200]
    for (const edge of [0, 1, 2, 3] as const) {
      const f = fabrique(edge)
      const versPositif = edge === 0 || edge === 2
      const axis = edge <= 1 ? 'x' : 'y'
      const span = axis === 'x' ? W : H
      const largeur = largeurDe(f)

      expect(frontMeteoPos(f, f.startTick - 1, W, H)).toBeNull()
      expect(frontMeteoPos(f, f.endTick, W, H)).toBeNull()

      const debut = frontMeteoPos(f, f.startTick, W, H)!
      expect(debut.axis).toBe(axis)
      expect(debut.hi - debut.lo).toBeCloseTo(largeur, 9)
      // Au startTick, la bande est encore ENTIÈREMENT dehors, bord avant collé au bord d'entrée.
      if (versPositif) expect(debut.hi).toBe(0)
      else expect(debut.lo).toBe(span)

      // Mi-fenêtre : le bord avant a parcouru la moitié de (span + largeur), exactement.
      const milieu = frontMeteoPos(f, f.startTick + DUR / 2, W, H)!
      const avanceMi = (span + largeur) / 2
      if (versPositif) expect(milieu.hi).toBeCloseTo(avanceMi, 9)
      else expect(milieu.lo).toBeCloseTo(span - avanceMi, 9)

      // Linéarité : quarts équidistants — pas d'ease, pas de pas.
      const q1 = frontMeteoPos(f, f.startTick + DUR / 4, W, H)!
      const q3 = frontMeteoPos(f, f.startTick + (3 * DUR) / 4, W, H)!
      expect(milieu.lo - q1.lo).toBeCloseTo(q3.lo - milieu.lo, 9)
      // Et la traversée avance dans le bon sens.
      if (versPositif) expect(q3.lo).toBeGreaterThan(q1.lo)
      else expect(q3.lo).toBeLessThan(q1.lo)

      // Juste avant le endTick, le bord ARRIÈRE touche le bord opposé (à un pas de tick près).
      const fin = frontMeteoPos(f, f.endTick - 1, W, H)!
      const pasParTick = (span + largeur) / DUR
      if (versPositif) expect(span - fin.lo).toBeLessThanOrEqual(pasParTick + 1e-9)
      else expect(fin.hi).toBeLessThanOrEqual(pasParTick + 1e-9)

      // Pure : deux appels, même réponse ; et le front n'a pas bougé d'un octet.
      const copie = JSON.stringify(f)
      expect(frontMeteoPos(f, f.startTick + DUR / 2, W, H)).toEqual(milieu)
      expect(JSON.stringify(f)).toBe(copie)
    }
  })

  it('meteoIntensity — balayage perpendiculaire exhaustif : 0 dehors, 1 au cœur, rampe continue et monotone', () => {
    const sim = createSim(3, { map: createEmptyMap(90, 200, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    sim.meteo = { type: 'pluie', cycle: 0, day: MI_ARDEUR, edge: 0, startTick: 0, endTick: METEO.TRAVERSEE_TICKS }
    const rampe = METEO.RAMPE * largeurDe(sim.meteo)
    sim.tick = METEO.TRAVERSEE_TICKS / 2 // la bande est pleinement SUR la carte
    const bande = frontMeteoPos(sim.meteo, sim.tick, sim.map.width, sim.map.height)!
    expect(bande.lo).toBeGreaterThan(0)
    expect(bande.hi).toBeLessThan(sim.map.width) // le balayage traverse bien les TROIS régimes
    const avant = snapshot(sim)

    const pas = 0.05
    const n = Math.round((sim.map.width + 10) / pas)
    let prev = 0
    for (let k = 0; k <= n; k++) {
      const x = -5 + k * pas
      const i = meteoIntensity(sim, x, 100)
      expect(i).toBe(meteoIntensity(sim, x, 100)) // pure : deux appels, même réponse
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThanOrEqual(1)
      if (x <= bande.lo || x >= bande.hi) expect(i).toBe(0)
      if (x >= bande.lo + rampe && x <= bande.hi - rampe) expect(i).toBe(1)
      // Jamais un mur : la pente est bornée par 1/rampe sur TOUT le domaine.
      expect(Math.abs(i - prev)).toBeLessThanOrEqual(pas / rampe + 1e-9)
      // Monotone dans chaque rampe : montée au bord d'entrée, descente au bord de fuite.
      if (x - pas >= bande.lo && x <= bande.lo + rampe) expect(i).toBeGreaterThanOrEqual(prev)
      if (x - pas >= bande.hi - rampe && x <= bande.hi) expect(i).toBeLessThanOrEqual(prev)
      prev = i
      // La bande couvre TOUT l'axe perpendiculaire (géométrie cardinale) : y est indifférent.
      if (k % 200 === 0) {
        expect(meteoIntensity(sim, x, 0)).toBe(i)
        expect(meteoIntensity(sim, x, 199)).toBe(i)
      }
    }
    expect(snapshot(sim)).toBe(avant) // zéro mutation d'état sur tout le balayage
  })

  it('meteoIntensity — bord sud (axe y, traversée vers −y) : mêmes trois régimes', () => {
    const sim = createSim(3, { map: createEmptyMap(90, 200, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    sim.meteo = { type: 'pluie', cycle: 0, day: MI_ARDEUR, edge: 3, startTick: 0, endTick: METEO.TRAVERSEE_TICKS }
    const rampe = METEO.RAMPE * largeurDe(sim.meteo)
    sim.tick = METEO.TRAVERSEE_TICKS / 2
    const bande = frontMeteoPos(sim.meteo, sim.tick, sim.map.width, sim.map.height)!
    expect(bande.axis).toBe('y')
    const pas = 0.05
    const n = Math.round((sim.map.height + 10) / pas)
    let prev = 0
    for (let k = 0; k <= n; k++) {
      const y = -5 + k * pas
      const i = meteoIntensity(sim, 45, y)
      if (y <= bande.lo || y >= bande.hi) expect(i).toBe(0)
      if (y >= bande.lo + rampe && y <= bande.hi - rampe) expect(i).toBe(1)
      expect(Math.abs(i - prev)).toBeLessThanOrEqual(pas / rampe + 1e-9)
      prev = i
    }
  })

  it('hors fenêtre — front élu mais pas encore entré, ou déjà sorti : intensité 0 partout', () => {
    const sim = createSim(3, { map: createEmptyMap(90, 200, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    sim.meteo = { type: 'pluie', cycle: 0, day: MI_ARDEUR, edge: 0, startTick: 5000, endTick: 5000 + METEO.TRAVERSEE_TICKS }
    for (const tick of [0, 4999, 5000 + METEO.TRAVERSEE_TICKS]) {
      sim.tick = tick
      for (let x = 0; x < 90; x += 3) expect(meteoIntensity(sim, x, 100)).toBe(0)
    }
  })
})

describe('la distribution des ASPECTS par saison (élections déterministes du cycle, aspect dérivé du froid — R11)', () => {
  /** L'aspect d'un front EN PLAINE, à l'heure demandée du jour de ce front, au cœur de sa
   *  bande — ce que le joueur de la plaine voit tomber. */
  function aspectEnPlaine(sim: SimState, f: MeteoFront, tick: number): MeteoAspect | null {
    // Au cœur : on déplace la fenêtre du front pour que sa bande couvre le point à cette
    // heure — la géométrie est pure, seul le FROID (heure, saison, biome) décide de l'aspect.
    // La bande CENTRÉE sur le point observé : son cœur y est, quelle que soit sa largeur
    // (celle de sa saison — S7).
    const u = (20.5 + largeurDe(f) / 2) / (sim.map.width + largeurDe(f))
    const start = tick - Math.round(u * METEO.TRAVERSEE_TICKS)
    const pose: MeteoFront = { ...f, edge: 0, startTick: start, endTick: start + METEO.TRAVERSEE_TICKS }
    expect(meteoIntensityAt(pose, tick, sim.map.width, sim.map.height, 20.5, 20.5)).toBe(1)
    return aspectSousFront(sim, pose, 20.5, 20.5, tick)
  }

  it('A3 — l’ARDEUR ne voit pas un flocon (jour ET nuit) ; le GRAND FROID ne voit que ça', () => {
    // L'ancienne garde disait « acte I sans neige, acte III aux neiges » : sous une année qui
    // tourne, la saison SANS flocon n'est plus la première mais l'ÉTÉ (l'Éclosion, elle,
    // s'ouvre gelée et dégèle — c'est le contenu du printemps, S4). C'est le critère A3 de
    // `saisons.md`, et c'est la garde qui attrape la perte de S5 : avec un écart jour/nuit
    // fixe, les nuits d'Ardeur retomberaient sous la limite de neige.
    const compte = (fronts: MeteoFront[], phase: number, type: MeteoType): number =>
      fronts.filter((f) => phaseForDay(f.day) === phase && f.type === type).length
    const sim = simMeteo()
    const fronts = frontsDeLAnnee(sim)

    const ardeur = fronts.filter((f) => phaseForDay(f.day) === 2)
    expect(ardeur.length).toBeGreaterThan(0)
    for (const f of ardeur) {
      for (const tick of [tickMidiDuJour(f.day), tickMinuitDuJour(f.day)]) {
        expect(['neige', 'blizzard'], `jour ${f.day} au tick ${tick}`).not.toContain(aspectEnPlaine(sim, f, tick))
      }
      expect(frontEstBlizzard(sim, f), `jour ${f.day}`).toBe(false) // et rien à annoncer (R9)
    }
    // La mixture est celle de la SAISON : l'Ardeur est la saison de l'orage (0,5), les Pluies
    // celle de la pluie (0,7). C'est le branchement `actForDay → PAR_SAISON` qu'on épingle.
    expect(compte(fronts, 2, 'orage')).toBeGreaterThanOrEqual(compte(fronts, 2, 'pluie'))
    expect(compte(fronts, 2, 'orage')).toBeGreaterThanOrEqual(compte(fronts, 2, 'brouillard'))
    expect(compte(fronts, 3, 'pluie')).toBeGreaterThanOrEqual(compte(fronts, 3, 'brouillard'))
    expect(compte(fronts, 3, 'pluie')).toBeGreaterThanOrEqual(compte(fronts, 3, 'orage'))

    // LE GRAND FROID : tout ce qui précipite tombe en neige ou en blizzard, en plaine même à midi.
    const grandFroid = fronts.filter((f) => phaseForDay(f.day) === 4)
    expect(grandFroid.length).toBeGreaterThan(0)
    const precipitants = grandFroid.filter((f) => f.type === 'pluie' || f.type === 'orage')
    expect(precipitants.length).toBeGreaterThan(grandFroid.length / 2)
    for (const f of precipitants) {
      expect(['neige', 'blizzard'], `jour ${f.day}`).toContain(aspectEnPlaine(sim, f, tickMidiDuJour(f.day)))
    }
  })

  it('les types `neige` et `blizzard` n’existent plus dans AUCUNE mixture — l’aspect ne s’élit pas (A12)', () => {
    // Les quatre saisons, sur deux tours : `PAR_SAISON` est une `actTable`, donc l'Éclosion de
    // l'an 2 est une Éclosion — la garde balaie le cycle entier plutôt que trois actes figés.
    for (let acte = 1; acte <= 2 * 4; acte++) {
      const types = METEO.PAR_SAISON(acte).types
      expect('neige' in types, `acte ${acte}`).toBe(false)
      expect('blizzard' in types, `acte ${acte}`).toBe(false)
    }
  })
})

describe('R4 — le froid des fronts (A3)', () => {
  /**
   * Un front posé À LA MAIN au MIDI d'un jour choisi — plein JOUR, plaine `grass` (patron de
   * la nappe statique des tests Brume). `u` est la fraction de traversée écoulée : elle place
   * la bande où le test la veut. Le tick ne bouge pas pendant les boucles
   * d'`advanceTemperature` : la bande non plus.
   *
   * Le JOUR n'est pas décoratif : c'est lui qui porte la SAISON, donc le froid du monde
   * (`T₀`, la courbe S4 — dont dépend la morsure d'un orage, `partDeBlizzard` R12) ET la
   * géométrie du front (`largeurDe`/`fenetreDe`, S7-S8). Le tick ET `front.day` bougent
   * ensemble : un front d'hiver daté d'un jour d'été aurait la largeur de l'un et le froid
   * de l'autre. Par défaut MI-ARDEUR — la seule saison dont la bande de pluie (60 tuiles)
   * laisse un « dehors » sur une carte de 400.
   */
  function simSousFront(type: MeteoType, u: number, jour = MI_ARDEUR): { sim: SimState; bande: BandeMeteo } {
    const sim = createSim(7, { map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    const midi = tickMidiDuJour(jour)
    const startTick = midi - Math.round(u * METEO.TRAVERSEE_TICKS)
    sim.tick = midi
    sim.meteo = { type, cycle: jour - 1, day: jour, edge: 0, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
    return { sim, bande: frontMeteoPos(sim.meteo, midi, sim.map.width, sim.map.height)! }
  }

  /**
   * LE BLIZZARD, DÉRIVÉ (R11-R12) — un ORAGE au midi du CŒUR DU GRAND FROID : la plaine y est
   * à `T₀` = −2 °C, sous la limite de neige (+4), donc `partDeBlizzard` sature à 1 et l'orage
   * mord de `ORAGE_FROID.COLD` — le blizzard d'avant, au bit près, mais sans un type pour le
   * nommer. Sa bande fait 1 600 tuiles (S7 : le « carte entière » du blizzard) ; aux 16 % de
   * sa traversée son bord AVANT est à x≈320, si bien que son CŒUR couvre l'ouest et que l'est
   * est encore HORS bande. Les deux régimes coexistent sur la carte, et chaque prémisse se
   * PROUVE au montage — l'aspect compris.
   */
  function simSousBlizzard(): { sim: SimState; coeur: number; hors: number } {
    const { sim, bande } = simSousFront('orage', 0.16, MI_GRAND_FROID)
    const coeur = 40.5
    const hors = 380.5
    expect(meteoIntensity(sim, coeur, 20.5)).toBe(1)
    expect(meteoIntensity(sim, hors, 20.5)).toBe(0)
    expect(bande.hi).toBeLessThan(hors) // le refuge est DEVANT le front, pas dans son dos
    // LA PRÉMISSE DE R11 : ce qui tombe ici EST un blizzard — pas un orage tiède qu'on
    // croirait mordre. Sans cette ligne, un recalibrage de `SEUIL_NEIGE` viderait en silence
    // les quatre gardes qui suivent.
    expect(aspectSousFront(sim, sim.meteo, coeur, 20.5, sim.tick)).toBe('blizzard')
    expect(partDeBlizzard(dehorsSansMeteo(sim, coeur, 20.5, sim.tick))).toBe(1)
    return { sim, coeur, hors }
  }

  it('A3 — au cœur du blizzard, la plaine de JOUR devient létale au Grand Froid ; en sortir laisse fuir', () => {
    const { sim, coeur, hors } = simSousBlizzard()
    // −2 − 22 = −24, borné à AMBIANT_MIN, sous AMBIANT_HYPOTHERMIE (l'arithmétique de la
    // spec R4, lue par R12) ; à côté, la plaine du cœur de l'hiver n'est pas DOUCE — la
    // courbe l'a posée à −2 °C — mais elle reste au-dessus de l'hypothermie de l'AIR :
    // c'est ce qui fait du refuge un refuge.
    expect(baselineTemperature(sim, coeur, 20.5)).toBeLessThan(AMBIANT_HYPOTHERMIE)
    expect(baselineTemperature(sim, hors, 20.5)).toBeGreaterThan(AMBIANT_HYPOTHERMIE)

    const id = spawnEntity(sim, coeur, 20.5)
    const e = sim.entities.find((en) => en.id === id)!
    // ⚠ UN CORPS, EN °C : 30, déjà refroidi. L'ancien 25 était une jauge — en degrés c'est
    // `CORPS_MORTEL`, l'homme mourait au premier tick et c'est le RESPAWN qu'on mesurait.
    e.temperature = 30
    for (let i = 0; i < 2600; i++) advanceTemperature(sim)
    expect(e.temperature).toBeLessThan(TEMPERATURE.CORPS_HYPOTHERMIE) // la dérive l'a mené sous le seuil…
    expect(e.hp).toBeLessThan(100) // …et les PV baissent
    expect(e.hp).toBeGreaterThan(0) // mais pas un couperet : il est encore debout

    // IL FUIT : hors bande la température REMONTE par la dérive, et les dégâts s'arrêtent.
    e.x = hors
    const tempFuite = e.temperature
    for (let i = 0; i < 1600; i++) advanceTemperature(sim)
    expect(e.temperature).toBeGreaterThan(tempFuite)
    expect(e.temperature).toBeGreaterThan(TEMPERATURE.CORPS_HYPOTHERMIE)
    const pv = e.hp
    for (let i = 0; i < 500; i++) advanceTemperature(sim)
    expect(e.hp).toBe(pv) // réchauffé, plus un PV ne part
  })

  it('A3 planchers — la bulle d’un Feu ACTIF tient le blizzard dehors : zéro dégât au cœur', () => {
    const { sim, coeur } = simSousBlizzard()
    foundNpcVillage(sim, Math.floor(coeur), 20, 0)
    const feu = sim.structures.find((s) => s.type === 'fire')!
    expect(fireActive(sim, feu)).toBe(true) // la prémisse : le Feu du village est bien allumé
    expect(meteoIntensity(sim, feu.tx + 0.5, feu.ty + 0.5)).toBe(1) // et il est bien au cœur
    // Le froid de BASE reste létal (le feu ne réchauffe pas le monde)…
    expect(baselineTemperature(sim, feu.tx + 0.5, feu.ty + 0.5)).toBeLessThan(AMBIANT_HYPOTHERMIE)
    // …mais l'ambiant est PLANCHERÉ par la bulle : le max ne peut pas descendre.
    expect(ambientTemperature(sim, feu.tx + 0.5, feu.ty + 0.5)).toBeGreaterThan(AMBIANT_HYPOTHERMIE)

    const id = spawnEntity(sim, feu.tx + 0.5, feu.ty + 0.5)
    const e = sim.entities.find((en) => en.id === id)!
    for (let i = 0; i < 4000; i++) advanceTemperature(sim)
    expect(e.temperature).toBeGreaterThan(TEMPERATURE.CORPS_HYPOTHERMIE)
    expect(e.hp).toBe(100) // aucun dégât de froid dans la bulle
  })

  it('A3 planchers — la tenue d’hiver PLANCHE : le corps ne descend jamais sous sa cible, zéro dégât', () => {
    // La calibration qui rend le plancher SÛR : au-dessus de l'hypothermie, donc sans dégât.
    expect(TEMPERATURE.TENUE_FLOOR).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
    // ⚠ LES TROIS BORNES D'AVANT ÉTAIENT DE LA JAUGE, ET ELLES NE GARDAIENT PLUS RIEN : un
    // corps posé à 60 (au-dessus de `CORPS_SAIN` = 37 en °C) qu'on comparait à `TENUE_FLOOR`
    // (−5,2, une borne d'AMBIANT) et à « moins de 45 ». Le plancher se dit sur ce qu'il borne
    // vraiment : l'ambiant ressenti sous tenue vaut `TENUE_FLOOR`, donc le corps converge vers
    // `cibleCorporelle(TENUE_FLOOR)` et ne passe jamais dessous.
    const plancherDuCorps = cibleCorporelle(TEMPERATURE.TENUE_FLOOR)
    expect(plancherDuCorps).toBeGreaterThan(TEMPERATURE.CORPS_HYPOTHERMIE) // sinon la tenue ne protège de rien
    const { sim, coeur } = simSousBlizzard()
    const id = spawnEntity(sim, coeur, 20.5)
    const e = sim.entities.find((en) => en.id === id)!
    grantItems(sim, id, { tenue_hiver: 1 })
    e.temperature = TEMPERATURE.CORPS_SAIN
    for (let i = 0; i < 8000; i++) {
      advanceTemperature(sim)
      expect(e.temperature).toBeGreaterThanOrEqual(plancherDuCorps) // JAMAIS sous le plancher
    }
    expect(e.temperature).toBeLessThan(TEMPERATURE.CORPS_SAIN) // le blizzard a bien mordu…
    expect(e.temperature).toBeGreaterThan(TEMPERATURE.CORPS_HYPOTHERMIE) // …c'est le plancher qui a tenu
    expect(e.hp).toBe(100)
  })

  it('R4 gradient — traversée perpendiculaire : la température descend vers le cœur, remonte en face, jamais un mur', () => {
    // Une PLUIE de mi-Ardeur à midi : son froid ne dépend pas de `T₀` (seul l'orage a une
    // pente, R12), donc la seule variable du balayage est la géométrie — ce que ce test mesure.
    const { sim, bande } = simSousFront('pluie', 0.5)
    const rampe = METEO.RAMPE * largeurDe(sim.meteo!)
    // La bande est ENTIÈREMENT sur la carte, cœur compris : le balayage traverse bien les
    // cinq régimes (dehors, rampe, cœur, rampe, dehors) — la prémisse de la garde exhaustive.
    expect(bande.lo).toBeGreaterThan(10)
    expect(bande.hi).toBeLessThan(sim.map.width - 10)
    expect(bande.hi - bande.lo).toBeGreaterThan(2 * rampe)

    const mid = (bande.lo + bande.hi) / 2
    const pas = 0.05
    const penteMax = METEO.COLD.pluie * (pas / rampe) + 1e-9
    let prev = baselineTemperature(sim, 0.5, 20.5)
    const n = Math.round((sim.map.width - 1) / pas)
    for (let k = 1; k <= n; k++) {
      const x = 0.5 + k * pas
      const t = baselineTemperature(sim, x, 20.5)
      // Jamais un saut : la pente est bornée par COLD/rampe sur TOUT le domaine, pas des points choisis.
      expect(Math.abs(t - prev)).toBeLessThanOrEqual(penteMax)
      // Monotone : décroissante du bord au cœur, croissante du cœur au bord d'en face.
      if (x <= mid) expect(t).toBeLessThanOrEqual(prev)
      else expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
    // Le cœur porte la pleine morsure, exactement COLD sous la plaine intacte.
    expect(baselineTemperature(sim, mid, 20.5)).toBe(baselineTemperature(sim, 2.5, 20.5) - METEO.COLD.pluie)
  })

  it('R4 types doux — sous brouillard, baselineTemperature est BIT-IDENTIQUE à sans front (COLD.brouillard = 0)', () => {
    expect(METEO.COLD.brouillard).toBe(0)
    const { sim, bande } = simSousFront('brouillard', 0.5)
    expect(meteoIntensity(sim, (bande.lo + bande.hi) / 2, 20.5)).toBe(1) // le front est bien LÀ…
    const front = sim.meteo ?? null
    for (let x = 0.5; x < sim.map.width; x += 0.5) {
      for (const y of [0.5, 20.5, 39.5]) {
        sim.meteo = front
        const avec = baselineTemperature(sim, x, y)
        sim.meteo = null
        expect(avec).toBe(baselineTemperature(sim, x, y)) // …et il ne refroidit RIEN, au bit près
      }
    }
    sim.meteo = front
  })

  it('R5 Brume, même logique — le gate d’attraction des Cendreux s’allume de JOUR au cœur du blizzard, pas à côté', () => {
    // Le gate feu-station S5 (`cendreuxStep`) lit `baselineTemperature` : sous un front le
    // froid de base tombe sous TORPEUR.CONVERGE_SOUS, et un Cendreux pris dedans peut ramper
    // vers un feu allumé EN PLEIN JOUR — comportement assumé, le même que sous la nappe
    // (test R5 de brume.test.ts, calqué ici). Ce test l'ÉPINGLE : si un calibrage du froid
    // météo le faisait disparaître (ou l'étendait hors bande), on le saurait — le froid météo
    // MODULE le gate, il ne le casse pas.
    //
    // ⚠ LE BLIZZARD NE PEUT PLUS SERVIR DE TÉMOIN, et c'est une conséquence de R11 qu'il faut
    // NOMMER : un orage n'est un blizzard que là où `T₀ < SEUIL_NEIGE + COLD.pluie` (+4 °C),
    // or +4 est DÉJÀ sous `CONVERGE_SOUS` (+8) — partout où un blizzard existe, le gate est
    // ouvert de toute façon, bande ou pas. Le contraste se montre donc sur une PLUIE d'un jour
    // de DÉGEL de l'Éclosion, à midi : la courbe y pose la plaine à +9,2 °C (le gate est
    // fermé), et le cœur de la bande à +5,2 (il s'ouvre). C'est le même énoncé, pris là où la
    // géographie discrimine encore — et le jour est choisi À CÔTÉ du seuil, jamais dessus :
    // mi-Éclosion vaut +8 tout rond, soit `CONVERGE_SOUS` au bit près.
    const { sim, bande } = simSousFront('pluie', 0.16, JOUR_DEGEL)
    const coeur = 40.5
    const hors = 380.5
    expect(meteoIntensity(sim, coeur, 20.5)).toBe(1)
    expect(meteoIntensity(sim, hors, 20.5)).toBe(0)
    expect(bande.hi).toBeLessThan(hors)
    expect(baselineTemperature(sim, coeur, 20.5)).toBeLessThan(CENDREUX.TORPEUR.CONVERGE_SOUS)
    expect(baselineTemperature(sim, hors, 20.5)).toBeGreaterThanOrEqual(CENDREUX.TORPEUR.CONVERGE_SOUS)
  })

  it('R12 — un BLIZZARD ouvre le gate des Cendreux PARTOUT, bande ou pas : la limite de neige est sous CONVERGE_SOUS', () => {
    // Le corollaire de la note ci-dessus, affirmé plutôt que sous-entendu : la construction
    // même de R11 (`SEUIL_NEIGE` = 0 °C) place tout monde à blizzard sous `CONVERGE_SOUS`
    // (+8). Si quelqu'un remonte l'un ou descend l'autre, ce test tombe et la note redevient
    // fausse.
    expect(METEO.SEUIL_NEIGE).toBeLessThan(CENDREUX.TORPEUR.CONVERGE_SOUS)
    const { sim, coeur, hors } = simSousBlizzard()
    expect(baselineTemperature(sim, coeur, 20.5)).toBeLessThan(CENDREUX.TORPEUR.CONVERGE_SOUS)
    expect(baselineTemperature(sim, hors, 20.5)).toBeLessThan(CENDREUX.TORPEUR.CONVERGE_SOUS)
  })
})

/**
 * ⚠ CE QUI FAIT TAIRE LE GIBIER, C'EST LA VIOLENCE, PAS L'HUMIDITÉ (décision d'Alexis
 * 2026-08-23, spec `saisons.md` S7/A15) : `QUIET.pluie` est passé à FAUX. Les montages de
 * cette section posaient une PLUIE — ils posent un ORAGE. Le renversement se mesure : un
 * front des Pluies couvre la carte ENTIÈRE ~35 min sur 45, deux jours sur trois ; le silence
 * du gibier avait été calibré pour une averse de 90 s balayant 60 tuiles, et appliqué à ce
 * ciel-là il vidait 52 % de la saison de toute naissance ambiante.
 */
describe('R6 — la faune se terre (A5)', () => {
  /** Un front posé à la main au midi d'un jour de MI-ARDEUR, bande sur la carte à la fraction
   *  `u` de sa traversée (patron `simSousFront` de la section R4 — chaque section porte son
   *  montage). Mi-Ardeur : la seule saison dont la bande (60 tuiles) laisse un DEHORS sur une
   *  carte de 400 — c'est la géométrie que le balayage des deux côtés du bord exige. */
  function simSousFront(type: MeteoType, u: number, jour = MI_ARDEUR): { sim: SimState; bande: BandeMeteo } {
    const sim = createSim(7, { map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    const midi = tickMidiDuJour(jour)
    const startTick = midi - Math.round(u * METEO.TRAVERSEE_TICKS)
    sim.tick = midi
    sim.meteo = { type, cycle: jour - 1, day: jour, edge: 0, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
    return { sim, bande: frontMeteoPos(sim.meteo, midi, sim.map.width, sim.map.height)! }
  }

  it('sous un ORAGE actif, le silence couvre la bande et RIEN qu’elle — balayage des deux côtés du bord', () => {
    const { sim, bande } = simSousFront('orage', 0.5)
    // La prémisse de la garde exhaustive : les DEUX dehors existent sur la carte.
    expect(bande.lo).toBeGreaterThan(2)
    expect(bande.hi).toBeLessThan(sim.map.width - 2)
    for (let k = 0; k <= 4 * sim.map.width; k++) {
      const x = 0.125 + k * 0.25 // jamais pile sur un bord de bande : le dedans/dehors est net
      const dedans = x > bande.lo && x < bande.hi
      for (const y of [0.5, 20.5, 39.5]) expect(meteoQuiet(sim, x, y)).toBe(dedans)
    }
    // Dès la RAMPE (intensité > 0), le gibier se tait — pas seulement au cœur.
    const dansLaRampe = bande.lo + 0.5
    expect(meteoIntensity(sim, dansLaRampe, 20.5)).toBeGreaterThan(0)
    expect(meteoIntensity(sim, dansLaRampe, 20.5)).toBeLessThan(1)
    expect(meteoQuiet(sim, dansLaRampe, 20.5)).toBe(true)
  })

  it('après le passage — la fenêtre close ÉTEINT le silence, et advanceMeteo purge le record', () => {
    const { sim } = simSousFront('orage', 0.5)
    const front = sim.meteo!
    sim.tick = front.endTick // la fenêtre est close : le prédicat tombe AVANT même la purge
    for (let x = 0.5; x < sim.map.width; x += 2) expect(meteoQuiet(sim, x, 20.5)).toBe(false)
    advanceMeteo(sim) // l'ordonnanceur passe : le record est purgé
    expect(sim.meteo ?? null).toBeNull()
    for (let x = 0.5; x < sim.map.width; x += 2) expect(meteoQuiet(sim, x, 20.5)).toBe(false)
  })

  it('BROUILLARD et PLUIE — le gate est bit-identique à sans front : seule la VIOLENCE fait taire (S7)', () => {
    expect(METEO.QUIET.brouillard).toBe(false)
    expect(METEO.QUIET.pluie).toBe(false) // ⚠ passé à FAUX le 2026-08-23 : l'humidité ne terre plus rien
    for (const type of ['brouillard', 'pluie'] as const) {
      const { sim, bande } = simSousFront(type, 0.5)
      expect(meteoIntensity(sim, (bande.lo + bande.hi) / 2, 20.5), type).toBe(1) // le front est bien LÀ…
      const front = sim.meteo ?? null
      for (let x = 0.5; x < sim.map.width; x += 0.5) {
        for (const y of [0.5, 20.5, 39.5]) {
          sim.meteo = front
          const avec = meteoQuiet(sim, x, y)
          sim.meteo = null
          expect(avec, type).toBe(meteoQuiet(sim, x, y)) // …et il ne fait taire PERSONNE, au bit près
        }
      }
    }
  })

  it('A15 — la garde se lit par ASPECT : la NEIGE d’hiver laisse naître, le BLIZZARD terre', () => {
    // Le piège que la spec nomme (S7) : `QUIET` est keyée par CLASSE, or la neige EST la classe
    // `pluie` et le blizzard la classe `orage` (ils se dérivent au point, R11). Un booléen
    // basculé commanderait donc DEUX saisons d'un coup. On balaie les quatre ASPECTS — pas les
    // deux classes — au cœur du Grand Froid, là où pluie et orage tombent tous deux en flocons.
    const attendu: Record<MeteoAspect, boolean> = {
      pluie: false, brouillard: false, neige: false, orage: true, blizzard: true, vent_de_cendre: true,
    }
    let vus = 0
    for (const type of ['pluie', 'brouillard', 'orage', 'vent_de_cendre'] as const) {
      // MI-GRAND FROID pour que `pluie` se lise `neige` et `orage` `blizzard` ; MI-ARDEUR pour
      // les lire dans leur aspect doux. La même classe, deux aspects, une seule réponse par aspect.
      for (const jour of [MI_ARDEUR, MI_GRAND_FROID]) {
        const { sim, bande } = simSousFront(type, 0.5, jour)
        const coeur = Math.min(sim.map.width - 0.5, Math.max(0.5, (bande.lo + bande.hi) / 2))
        expect(meteoIntensity(sim, coeur, 20.5), `${type} au jour ${jour}`).toBeGreaterThan(0)
        const aspect = aspectSousFront(sim, sim.meteo, coeur, 20.5, sim.tick)!
        expect(meteoQuiet(sim, coeur, 20.5), `aspect ${aspect} (${type}, jour ${jour})`).toBe(attendu[aspect])
        vus++
      }
    }
    expect(vus).toBe(8) // la garde prouve sa prémisse : les huit couples classe × saison ont été lus
  })

  it('A5 — Brume annoncée + pluie active : les points `faunaQuiet` tiennent PENDANT et APRÈS, advanceMeteo n’y touche jamais', () => {
    // Une carte AVEC CHARNIER (patron brume.test.ts) — la Brume s'y ancre ; la météo, non.
    // Elle portait un champ de FRONT synthétique, devenu inerte à son retrait (2026-08-24).
    const map = createEmptyMap(70, 40, TERRAIN_GRASS)
    map.zones.push({ name: 'Le Charnier', x: 2, y: 18, w: 5, h: 5, kind: 'charnier' })
    const sim = createSim(2026, { map, calendarScale: SCALE, meteoActive: true })

    // Le premier jour que la Brume élit ; son annonce tombe au crépuscule. On le CHERCHE à
    // partir des Pluies : la Brume est un mécanisme de FROID et sa chance est nulle avant
    // (S13, `BRUME.CHANCE_PER_DAY` : 0 · 0 · 0,35 · 0,5) — un jour d'été n'en lèverait jamais.
    let d = 2 * BALANCE.ACT_DAYS + 1
    while (d <= YEAR_DAYS && !brumeJourEligible(d)) d++
    expect(d).toBeLessThanOrEqual(YEAR_DAYS) // la garde prouve sa prémisse : l'année A des Brumes
    sim.tick = tickAubeDuJour(d) + dayTicksPourJour(d)
    step(sim, [])
    expect(sim.brume?.phase).toBe('annoncee')
    expect(sim.faunaQuiet.length).toBeGreaterThanOrEqual(3) // les points du corridor sont posés
    const ref = JSON.stringify(sim.faunaQuiet)

    // Un ORAGE posé sur une fenêtre COMPRESSÉE, close avant le prochain bord de cycle :
    // aucun échantillon ne traverse une élection (la coexistence ne dépend pas de la durée
    // de la fenêtre — la géométrie est une fonction pure du record). Un orage, et non une
    // pluie : depuis S7 seule la VIOLENCE fait taire, et c'est bien le silence qu'on mesure.
    const debut = sim.tick
    sim.meteo = { type: 'orage', cycle: d - 1, day: d, edge: 0, startTick: debut, endTick: debut + 14400 }
    const front = { ...sim.meteo }

    let couverts = 0
    for (let t = debut; t <= debut + 20000; t += 720) {
      sim.tick = t
      advanceMeteo(sim)
      expect(JSON.stringify(sim.faunaQuiet)).toBe(ref) // le prédicat météo ne TOUCHE pas au tableau
      const bande = frontMeteoPos(front, t, sim.map.width, sim.map.height)
      if (t < front.endTick && bande && bande.lo < 35 && bande.hi > 35) {
        expect(meteoQuiet(sim, 35, 20.5)).toBe(true) // le front fait bien taire PENDANT…
        couverts++
      }
    }
    expect(couverts).toBeGreaterThan(0) // la fenêtre a bien vu la bande sur la carte : la garde a mordu
    expect(sim.meteo ?? null).toBeNull() // …le record est purgé APRÈS…
    // …et les points de la Brume TIENNENT : leur échéance est le RETRAIT de la nappe, bien
    // après la fin du front — aucune purge croisée, par construction.
    expect(JSON.stringify(sim.faunaQuiet)).toBe(ref)
    for (const q of sim.faunaQuiet) expect(q.until).toBeGreaterThan(sim.tick)
  })

  it('LE COMPORTEMENT (calqué sur A17 de faune.test.ts) — sous le front, pas UNE naissance ; le front passé, le gibier revient', () => {
    // Le montage des gardes « pression de chasse » : prairie 160×160, plafond GROUND_CAP,
    // midi, `worldEvents: false` (un banc de FAUNE mesure la faune — et l'ordonnanceur
    // météo vit derrière cet interrupteur : le front est donc POSÉ à la main, et le
    // silence se lit par le prédicat pur, exactement comme le gate le lit en jeu). La
    // population ambiante remplit l'anneau, on OUVRE des places, et on regarde qui naît.
    // Ici, ce qui fait taire n'est pas une mise à mort : c'est le FRONT. (On RETIRE des
    // bêtes au lieu de les tuer — `die()` poserait un `faunaQuiet` de pression de chasse,
    // et le silence mesuré doit être météo et rien d'autre. Prairie pure : pas de loups —
    // aucun habitat —, donc pas de mise à mort qui poserait le sien.)
    const sim = createSim(1234, {
      map: createEmptyMap(160, 160, TERRAIN_GRASS),
      faunaCap: FAUNA.GROUND_CAP,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
    })
    const ambients = (): number => sim.monsters.filter((m) => m.ambient).length
    const a = spawnEntity(sim, 80.5, 80.5)
    grantItems(sim, a, { tenue_hiver: 1 }) // le front mord (T2) : la tenue PLANCHE — on mesure la faune, pas le froid
    let plafond = 0
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(sim, [])
      plafond = Math.max(plafond, ambients())
    }
    expect(plafond).toBeGreaterThanOrEqual(FAUNA.GROUND_CAP) // l'anneau s'est rempli : la précondition du gate

    // UN ORAGE DU GRAND FROID — large comme la carte (S7 : la table de sa saison lui donne
    // 1 600 tuiles, le « carte entière » du blizzard) : l'anneau de naissance (±42) déborderait
    // la bande d'une averse d'Ardeur (60). C'est le silence qu'on mesure ici, et il ne dépend
    // QUE de la classe (`METEO.QUIET.orage`) — le jour ne sert donc qu'à la largeur. Fenêtre
    // COMPRESSÉE : la géométrie est pure, la fenêtre est le choix de l'ÉLECTION, pas de la
    // géométrie.
    const D = 2000
    const orage = { type: 'orage' as const, cycle: MI_GRAND_FROID - 1, day: MI_GRAND_FROID, edge: 0 as const }
    const largeur = largeurDe(orage)
    expect(largeur).toBeGreaterThan(sim.map.width) // la prémisse : la bande peut couvrir la carte
    const total = sim.map.width + largeur
    const startTick = sim.tick - Math.round((250 / total) * D) // avance ≈ 250 : carte couverte, marge aux deux bords
    sim.meteo = { ...orage, startTick, endTick: startTick + D }
    expect(meteoQuiet(sim, 0.5, 0.5)).toBe(true)
    expect(meteoQuiet(sim, 159.5, 159.5)).toBe(true) // prémisse : l'empreinte couvre tout

    // On OUVRE des places (dissipation directe, pas une mise à mort) : la population passe
    // sous le plafond, le semeur VOUDRAIT remplir.
    expect(ambients()).toBeGreaterThan(FAUNA.GROUND_CAP - 6)
    const retires = new Set(
      sim.monsters.filter((m) => m.ambient).slice(0, ambients() - (FAUNA.GROUND_CAP - 6)).map((m) => m.entityId),
    )
    sim.monsters = sim.monsters.filter((m) => !retires.has(m.entityId))
    sim.entities = sim.entities.filter((e) => !retires.has(e.id))
    expect(sim.faunaQuiet).toHaveLength(0) // rien d'autre ne fait taire : le silence mesuré est MÉTÉO

    const avant = new Set(sim.monsters.filter((m) => m.ambient).map((m) => m.entityId))
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])
    expect(meteoQuiet(sim, 80.5, 80.5)).toBe(true) // l'empreinte couvre ENCORE (la bande a peu avancé)
    expect(sim.monsters.filter((m) => m.ambient && !avant.has(m.entityId))).toHaveLength(0) // pas UNE naissance sous le front
    const bloque = ambients() // le compte BLOQUÉ, relevé pendant le silence plein — avant que le bord de fuite n'ouvre l'ouest

    // LE FRONT PASSE — la fenêtre close ÉTEINT le silence (le prédicat est une fonction
    // pure du tick ; la purge du record par advanceMeteo est la garde « après le passage »
    // ci-dessus) — et le gibier REVIENT : la fenêtre de chasse lisible de la spec R6.
    while (sim.tick < startTick + D) step(sim, [])
    step(sim, [])
    expect(meteoQuiet(sim, 80.5, 80.5)).toBe(false)
    const avantRetour = new Set(sim.monsters.filter((m) => m.ambient).map((m) => m.entityId))
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])
    expect(sim.monsters.filter((m) => m.ambient && !avantRetour.has(m.entityId)).length).toBeGreaterThan(0)
    expect(ambients()).toBeGreaterThan(bloque)
  })
})

describe('R5 — le Feu sous la pluie (A4)', () => {
  /** Fenêtre très ÉTIRÉE : la bande est quasi immobile pendant une mesure de combustion
   *  (~0,001 tuile/tick) — la géométrie est pure, la durée est un choix d'ÉLECTION, pas de
   *  géométrie (patron « fenêtre compressée » de R6, dans l'autre sens). */
  const D_LENT = 400000

  /** Plaine nue au midi d'un jour de MI-ÉCLOSION (patron des sections R4/R6), SANS front — les
   *  feux se posent à sec, la pluie arrive ensuite. `worldEvents: false` : un banc de FEU mesure
   *  le feu. Le tick est à mi-cycle : aucun bord d'élection dans les fenêtres mesurées.
   *  Le MIDI se lit sur la longueur du jour de la SAISON (S6) — celui d'hiver n'est plus
   *  celui d'été — et le jour porte la saison, donc le froid du monde ET la géométrie du
   *  front (`largeurDe`/`fenetreDe`, S7-S8) : il voyage avec le front qu'on posera. */
  function simCalme(jour = MI_ECLOSION): SimState {
    const sim = createSim(7, {
      map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true, worldEvents: false,
    })
    sim.tick = tickMidiDuJour(jour)
    return sim
  }

  /** Pose un front (bord ouest, fenêtre `D`) pour que sa bande, au tick COURANT, commence
   *  en `lo` — et le prouve (l'arrondi du startTick la décale d'un millième de tuile). La
   *  largeur passe par `largeurDe` (S7) : la recopier de la table poserait une bande d'Ardeur
   *  sous un orage d'hiver, et la prémisse mentirait. */
  function poseFront(sim: SimState, type: MeteoType, lo: number, D = D_LENT, jour = MI_ECLOSION): BandeMeteo {
    const largeur = largeurDe({ type, day: jour })
    const u = (lo + largeur) / (sim.map.width + largeur)
    const startTick = sim.tick - Math.round(u * D)
    sim.meteo = { type, cycle: jour - 1, day: jour, edge: 0, startTick, endTick: startTick + D }
    const bande = frontMeteoPos(sim.meteo, sim.tick, sim.map.width, sim.map.height)!
    expect(Math.abs(bande.lo - lo)).toBeLessThan(0.05)
    return bande
  }

  function act(sim: SimState, id: number, action: PlayerAction): void {
    step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
  }

  function refus(sim: SimState): string[] {
    return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
  }

  /** Un poseur muni de feux de camp (en main) et de bois. Il posera par l'INPUT
   *  (`place_campfire`), jamais par `addStructure` — le chemin que le replay rejoue. */
  function poseur(sim: SimState, x: number, y: number, feux: number): number {
    const id = spawnEntity(sim, x + 0.5, y + 0.5)
    grantItems(sim, id, { campfire: feux, wood: 20 })
    const e = sim.entities.find((en) => en.id === id)!
    e.activeSlot = e.inventory.findIndex((s) => s?.item === 'campfire')
    return id
  }

  /** Se poste une tuile au sud de (tx,ty) et y pose le feu de camp tenu — en reprenant
   *  un feu de camp en main d'abord (ils ne s'empilent pas : chaque pose vide sa case). */
  function poseFeu(sim: SimState, id: number, tx: number, ty: number): void {
    const e = sim.entities.find((en) => en.id === id)!
    e.activeSlot = e.inventory.findIndex((s) => s?.item === 'campfire')
    e.x = tx + 0.5
    e.y = ty + 1.5
    act(sim, id, { type: 'place_campfire', tx, ty })
  }

  it('A4 conso — cœur : ×FEU_CONSO.pluie EXACTEMENT ; hors bande : rien ; rampe : strictement entre — et zéro tirage', () => {
    // Le jumeau à sec (même seed, mêmes gestes) est le témoin : la mesure ET la garde RNG.
    const avec = simCalme()
    const sans = simCalme()
    for (const sim of [avec, sans]) {
      const id = poseur(sim, 125, 20, 3)
      poseFeu(sim, id, 125, 21) // futur CŒUR de bande
      poseFeu(sim, id, 100, 21) // future RAMPE (bord arrière + rampe/2)
      poseFeu(sim, id, 300, 21) // hors bande, DEVANT le front — le feu de l'observateur lointain
      expect(refus(sim)).toEqual([]) // à sec, les trois poses passent
    }
    const chaud = structureAt(avec.structures, 125, 21)!
    const tiede = structureAt(avec.structures, 100, 21)!
    const froid = structureAt(avec.structures, 300, 21)!

    // La pluie arrive sur `avec` : à l'Éclosion la bande fait 120 tuiles — [95.5, 215.5],
    // cœur [113.5, 197.5], rampe de 18.
    poseFront(avec, 'pluie', 95.5)
    // Les prémisses, AU POINT DU FEU (fire.ts lit s.tx, s.ty) : trois régimes distincts.
    expect(meteoIntensity(avec, chaud.tx, chaud.ty)).toBe(1)
    expect(meteoIntensity(avec, froid.tx, froid.ty)).toBe(0)
    const iTiede = meteoIntensity(avec, tiede.tx, tiede.ty)
    expect(iTiede).toBeGreaterThan(0)
    expect(iTiede).toBeLessThan(1)

    const N = 600 // < BURN_TICKS même accéléré : la mesure ne traverse aucun rollover de bûche
    const b0 = {
      chaud: fuelTicksRemaining(avec.tick, chaud),
      tiede: fuelTicksRemaining(avec.tick, tiede),
      froid: fuelTicksRemaining(avec.tick, froid),
    }
    for (let t = 0; t < N; t++) {
      step(avec, [])
      step(sans, [])
    }
    // Le CŒUR consume ×FEU_CONSO.pluie, au bit près (1 + 0.5×1 par tick, halves binaires exactes).
    expect(b0.chaud - fuelTicksRemaining(avec.tick, chaud)).toBe(N * METEO.FEU_CONSO.pluie)
    // Le feu HORS bande ne sait RIEN : le multiplicateur s'évalue au point du FEU.
    expect(b0.froid - fuelTicksRemaining(avec.tick, froid)).toBe(N)
    // La RAMPE : strictement entre 1× et le plein — la pente continue, jamais un mur.
    const dTiede = b0.tiede - fuelTicksRemaining(avec.tick, tiede)
    expect(dTiede).toBeGreaterThan(N)
    expect(dTiede).toBeLessThan(N * METEO.FEU_CONSO.pluie)
    // Et le jumeau à sec confirme les deux contrats : ses feux consument N tout court…
    expect(b0.chaud - fuelTicksRemaining(sans.tick, structureAt(sans.structures, 125, 21)!)).toBe(N)
    // …et le flux RNG est BIT-IDENTIQUE : la pluie sur les feux ne tire rien (spec R10).
    expect(avec.rngState).toBe(sans.rngState)
  })

  it('A4 brouillard — les feux sont BIT-IDENTIQUES à sans front : MOUILLE.brouillard est faux', () => {
    expect(METEO.MOUILLE.brouillard).toBe(false)
    const avec = simCalme()
    const sans = simCalme()
    for (const sim of [avec, sans]) {
      const id = poseur(sim, 125, 20, 1)
      poseFeu(sim, id, 125, 21)
    }
    poseFront(avec, 'brouillard', 95.5)
    expect(meteoIntensity(avec, 125, 21)).toBe(1) // le front est bien LÀ, plein cœur…
    for (let t = 0; t < 400; t++) {
      step(avec, [])
      step(sans, [])
    }
    // …et pas UN octet des structures ne diffère : ni ancre de bûche, ni budget, ni état.
    expect(JSON.stringify(avec.structures)).toBe(JSON.stringify(sans.structures))
    expect(avec.rngState).toBe(sans.rngState)
  })

  it('S7 L’ORAGE SEC DE L’ARDEUR — il tonne, il ne mouille pas : feux bit-identiques au sec, et la pose passe', () => {
    // La seule table d'effet que la SAISON commande, et par une exception NOMMÉE plutôt que
    // par une quatrième colonne : un orage d'été n'éteint rien, n'accélère rien et ne casse
    // pas la sécheresse. Les trois autres saisons, elles, mouillent.
    expect(frontMouille({ type: 'orage', day: MI_ARDEUR })).toBe(false)
    for (const jour of [MI_ECLOSION, MI_PLUIES, MI_GRAND_FROID]) {
      expect(frontMouille({ type: 'orage', day: jour }), `jour ${jour}`).toBe(true)
    }
    // Et la pluie mouille à TOUTE saison — l'exception vise l'orage, pas l'été.
    for (const jour of [MI_ECLOSION, MI_ARDEUR, MI_PLUIES, MI_GRAND_FROID]) {
      expect(frontMouille({ type: 'pluie', day: jour }), `jour ${jour}`).toBe(true)
    }

    // LE COMPORTEMENT, contre un jumeau à sec (même seed, mêmes gestes) : plein cœur d'un
    // orage d'Ardeur, le feu brûle exactement comme au clair, et un feu NEUF se pose.
    const avec = simCalme(MI_ARDEUR)
    const sans = simCalme(MI_ARDEUR)
    for (const sim of [avec, sans]) {
      const id = poseur(sim, 125, 20, 2)
      poseFeu(sim, id, 125, 21)
    }
    poseFront(avec, 'orage', 95.5, D_LENT, MI_ARDEUR)
    expect(meteoIntensity(avec, 125, 21)).toBe(1) // la prémisse : le feu est bien au cœur…
    expect(meteoMouille(avec, 125, 21)).toBe(false) // …et le ciel qui le couvre est SEC
    expect(meteoFeuConso(avec, 125, 21)).toBe(1)
    for (let t = 0; t < 400; t++) {
      step(avec, [])
      step(sans, [])
    }
    expect(JSON.stringify(avec.structures)).toBe(JSON.stringify(sans.structures))
    expect(avec.rngState).toBe(sans.rngState)
    // La porte du refus (`place_campfire`) reste ouverte : rien ne tombe du ciel.
    drainEvents(avec)
    const poseurId = avec.entities[0]!.id
    poseFeu(avec, poseurId, 127, 21)
    expect(refus(avec)).toEqual([])
    expect(structureAt(avec.structures, 127, 21)?.type).toBe('fire')
  })

  it('A4 Foyer — l’upkeep du village sous pluie au cœur draine ×FEU_CONSO.pluie ; hors bande et sous brouillard, bit-identique', () => {
    // Le jumeau à sec, encore : deux villages PNJ identiques dans chaque sim — l'un au
    // futur cœur de bande, l'autre loin DEVANT le front. Fondés par le worldgen
    // (`foundNpcVillage`, pas un input — et le Foyer est LE feu que le §8 vise :
    // « la tâche communautaire zéro devient plus pressante »).
    const avec = simCalme()
    const sans = simCalme()
    for (const sim of [avec, sans]) {
      foundNpcVillage(sim, 125, 21, 0)
      foundNpcVillage(sim, 300, 21, 0)
    }
    poseFront(avec, 'pluie', 95.5)
    expect(meteoIntensity(avec, 125, 21)).toBe(1) // le Feu du 1er village est au cœur…
    expect(meteoIntensity(avec, 300, 21)).toBe(0) // …celui du 2e, hors bande
    const f0 = avec.villages.map((v) => v.fuel)
    const N = 600
    for (let t = 0; t < N; t++) {
      step(avec, [])
      step(sans, [])
    }
    // Au cœur, la faim du Foyer accélère de ×FEU_CONSO.pluie (ratio : l'acte se simplifie).
    const dCoeur = f0[0]! - avec.villages[0]!.fuel
    const dSec = f0[0]! - sans.villages[0]!.fuel
    expect(dSec).toBeGreaterThan(0) // l'upkeep draine bien : la comparaison porte sur du vrai
    expect(dCoeur / dSec).toBeCloseTo(METEO.FEU_CONSO.pluie, 9)
    // Hors bande : BIT-identique au jumeau (×1 exactement — le Foyer d'à côté ne sait rien).
    expect(avec.villages[1]!.fuel).toBe(sans.villages[1]!.fuel)
    // Et personne n'est à sec : la pluie n'éteint rien, elle presse la tâche — c'est tout.
    expect(avec.villages[0]!.fuel).toBeGreaterThan(0)

    // BROUILLARD plein cœur : le drain du Foyer est bit-identique à sans front.
    const avecB = simCalme()
    const sansB = simCalme()
    for (const sim of [avecB, sansB]) foundNpcVillage(sim, 125, 21, 0)
    poseFront(avecB, 'brouillard', 95.5)
    expect(meteoIntensity(avecB, 125, 21)).toBe(1)
    for (let t = 0; t < 300; t++) {
      step(avecB, [])
      step(sansB, [])
    }
    expect(avecB.villages[0]!.fuel).toBe(sansB.villages[0]!.fuel)
  })

  it('meteoFeuConso — balayage perpendiculaire exhaustif : 1 dehors, le plein au cœur, entre les deux dans la rampe, pente bornée, pur', () => {
    const sim = simCalme()
    const bande = poseFront(sim, 'pluie', 170)
    const rampe = METEO.RAMPE * largeurDe(sim.meteo!)
    const plein = METEO.FEU_CONSO.pluie
    const avant = snapshot(sim)
    const pas = 0.05
    let prev = 1
    for (let k = 0; k <= Math.round(sim.map.width / pas); k++) {
      const x = k * pas
      const c = meteoFeuConso(sim, x, 20)
      expect(c).toBe(meteoFeuConso(sim, x, 20)) // pur : deux appels, même réponse
      if (x <= bande.lo || x >= bande.hi) expect(c).toBe(1)
      if (x >= bande.lo + rampe && x <= bande.hi - rampe) expect(c).toBe(plein)
      if (x > bande.lo + 0.1 && x < bande.lo + rampe - 0.1) {
        expect(c).toBeGreaterThan(1) // la rampe : strictement entre 1 et le plein
        expect(c).toBeLessThan(plein)
      }
      // Jamais un mur : la pente est bornée par (plein−1)/rampe sur TOUT le domaine.
      expect(Math.abs(c - prev)).toBeLessThanOrEqual((plein - 1) * (pas / rampe) + 1e-9)
      prev = c
      // `meteoMouille` suit l'empreinte, exactement — la porte du refus lit la même bande.
      if (k % 100 === 0) expect(meteoMouille(sim, x, 20)).toBe(x > bande.lo && x < bande.hi)
    }
    expect(snapshot(sim)).toBe(avant) // zéro mutation d'état sur tout le balayage
  })

  it('A4 jamais d’extinction — un feu nourri SOUS blizzard reste chaud sur toute la traversée ; au cœur il consume ×2, il ne meurt pas', () => {
    // CŒUR DU GRAND FROID, MIDI : la plaine y est à −2 °C, sous la limite de neige (+4) —
    // l'orage qu'on pose EST un blizzard (R11-R12), et sa faim de bois monte à
    // `ORAGE_FROID.FEU_CONSO` par la pente.
    const sim = simCalme(MI_GRAND_FROID)
    const id = poseur(sim, 200, 20, 1)
    poseFeu(sim, id, 200, 21)
    const feu = structureAt(sim.structures, 200, 21)!
    // Blizzard COMPRESSÉ (D = 4000) posé à mi-traversée : le cœur couvre déjà le feu, la
    // fenêtre restante (~2000 ticks) se joue en entier — « toute la traversée ».
    const D = 4000
    poseFront(sim, 'orage', -600, D, MI_GRAND_FROID)
    expect(aspectSousFront(sim, sim.meteo, feu.tx + 0.5, feu.ty + 0.5, sim.tick)).toBe('blizzard')
    const finDeFenetre = sim.meteo!.endTick
    expect(meteoIntensity(sim, feu.tx, feu.ty)).toBe(1)
    drainEvents(sim)

    // Phase 1, encore au CŒUR (la bande avance de 0,5 tuile/tick) : ×ORAGE_FROID.FEU_CONSO exact.
    const b0 = fuelTicksRemaining(sim.tick, feu)
    const N = 700
    for (let t = 0; t < N; t++) {
      step(sim, [])
      expect(fireState(sim, feu)).toBe('lit') // JAMAIS éteint par la météo
      expect(fireWarmthFactor(sim, feu)).toBeGreaterThan(0)
    }
    expect(meteoIntensity(sim, feu.tx, feu.ty)).toBe(1) // le cœur couvrait toute la phase mesurée
    expect(b0 - fuelTicksRemaining(sim.tick, feu)).toBe(N * METEO.ORAGE_FROID.FEU_CONSO)

    // Phase 2 : le RESTE de la fenêtre — rampe de fuite comprise — jusqu'après la sortie.
    while (sim.tick < finDeFenetre) {
      step(sim, [])
      expect(fireState(sim, feu)).toBe('lit')
      expect(fireWarmthFactor(sim, feu)).toBeGreaterThan(0)
    }
    expect(meteoIntensity(sim, feu.tx, feu.ty)).toBe(0) // le front est passé…
    expect(fireState(sim, feu)).toBe('lit') // …le feu est toujours là
    expect(drainEvents(sim).some((e) => e.type === 'fire_extinguished')).toBe(false)
  })

  it('R5 refus — feu neuf à découvert sous la pluie : refusé, observable, l’objet reste en main, zéro tirage ; le front parti, la même pose passe', () => {
    const sim = simCalme()
    const id = poseur(sim, 125, 20, 1)
    poseFront(sim, 'pluie', 95.5)
    expect(meteoMouille(sim, 125, 21)).toBe(true) // la prémisse : la tuile visée est mouillée
    drainEvents(sim)
    // L'action SEULE d'abord (la garde chirurgicale) : le refus ne tire RIEN sur le PRNG.
    const rng0 = sim.rngState
    applyVillageAction(sim, id, { type: 'place_campfire', tx: 125, ty: 21 })
    expect(sim.rngState).toBe(rng0)
    expect(refus(sim)).toEqual(['un feu neuf ne prend pas sous la pluie'])
    expect(structureAt(sim.structures, 125, 21)).toBeUndefined()
    const e = sim.entities.find((en) => en.id === id)!
    expect(countOf(e.inventory, 'campfire')).toBe(1) // l'objet n'est PAS consommé par un refus
    // Par l'INPUT aussi — le chemin réel, celui que le replay rejoue.
    act(sim, id, { type: 'place_campfire', tx: 125, ty: 21 })
    expect(refus(sim)).toEqual(['un feu neuf ne prend pas sous la pluie'])
    // Le front parti : la MÊME pose, au même endroit, passe.
    sim.meteo = null
    act(sim, id, { type: 'place_campfire', tx: 125, ty: 21 })
    expect(refus(sim)).toEqual([])
    expect(structureAt(sim.structures, 125, 21)?.type).toBe('fire')
  })

  it('R5 abri — LE TOIT RÉVEILLE L’ÉCHAPPÉE : sous un toit, un feu neuf prend SOUS LA PLUIE', () => {
    /**
     * ⚠ **LA GARDE D’À CÔTÉ DIT QUE CETTE ÉCHAPPÉE EST « DORMANTE », ET ELLE NE L’EST PLUS.**
     * Elle l’était pour une raison qui n’a rien à voir avec R5 : les deux seuls abris que
     * `isSheltered` connaissait refusaient la pose par une AUTRE porte — la `house` occupe sa
     * tuile (« tuile occupée »), la Grotte est un landmark. On ne pouvait donc jamais OBSERVER
     * le contrat, seulement constater qu’un autre motif sortait avant lui.
     *
     * Depuis que le TOIT abrite (2026-09-02), il existe enfin un abri qui ne ferme aucune de ces
     * portes : `roof` est `bloque: 'non'` et `occupe: 'toit'` — il ne prend pas la tuile, il n’est
     * pas un landmark. La pose DOIT donc passer, sous la pluie, et c’est R5 qui tient debout pour
     * la première fois. Ce qui ferait rougir : retirer `roofAt` d’`isSheltered` — le motif météo
     * ressort, et l’échappée se rendort.
     */
    const sim = simCalme()
    const id = poseur(sim, 125, 20, 1)
    addStructure(sim, 'roof', 125, 21, 0, 0)
    poseFront(sim, 'pluie', 95.5)
    expect(meteoMouille(sim, 125, 21), 'la prémisse : il pleut bien là').toBe(true)
    expect(isSheltered(sim, 125, 21), 'et la tuile est couverte').toBe(true)
    drainEvents(sim)
    act(sim, id, { type: 'place_campfire', tx: 125, ty: 21 })
    expect(refus(sim), 'aucun refus : le feu prend sous le toit').toEqual([])
    expect(structureAt(sim.structures, 125, 21)?.type ?? 'rien').not.toBe('rien')
  })

  it('R5 abri — sur une tuile abritée le refus météo ne mord JAMAIS : maison et grotte le prouvent chacune par sa porte', () => {
    // Les deux abris d'`isSheltered` (maison, grotte) refusent AUJOURD'HUI la pose par des
    // portes pré-existantes (tuile occupée, landmark) : l'échappée abritée du contrat R5
    // est dormante. Ces gardes épinglent qu'elle CÈDE — le motif météo ne sort jamais sur
    // une tuile abritée — et le jour où ces portes s'ouvrent, elles tiendront telles quelles.
    const MOTIF = 'un feu neuf ne prend pas sous la pluie'

    // LA MAISON — la plus probante : le refus météo est évalué AVANT « tuile occupée »,
    // donc s'il ne cédait pas à l'abri, c'est SON motif qui sortirait. (`addStructure`
    // direct : un décor d'héritage, pas un geste de jeu à rejouer — le worldgen fait pareil.)
    const simM = simCalme()
    const idM = poseur(simM, 125, 20, 1)
    addStructure(simM, 'house', 125, 21, 0, 0)
    poseFront(simM, 'pluie', 95.5)
    expect(meteoMouille(simM, 125, 21)).toBe(true)
    expect(isSheltered(simM, 125, 21)).toBe(true)
    drainEvents(simM)
    act(simM, idM, { type: 'place_campfire', tx: 125, ty: 21 })
    expect(refus(simM)).toEqual(['tuile occupée'])

    // LA GROTTE — même contrat, porte landmark.
    const simG = simCalme()
    simG.map.zones.push({ name: 'la Grotte I', x: 125, y: 21, w: 1, h: 1, kind: 'grotte' })
    const idG = poseur(simG, 125, 20, 1)
    poseFront(simG, 'pluie', 95.5)
    expect(meteoMouille(simG, 125, 21)).toBe(true)
    expect(isSheltered(simG, 125, 21)).toBe(true)
    drainEvents(simG)
    act(simG, idG, { type: 'place_campfire', tx: 125, ty: 21 })
    const raisons = refus(simG)
    expect(raisons).not.toContain(MOTIF)
    expect(raisons).toEqual(['les landmarks sont inconstructibles'])
  })

  it('R5 ciblé — le refus ne fuit pas sur les murs : le marteau bâtit sous la pluie', () => {
    const sim = simCalme()
    const id = poseur(sim, 125, 20, 1)
    grantItems(sim, id, { hammer: 1, wood: 20 })
    // Fonder À SEC (la fondation passe par la pose d'un feu, gardée par R5)…
    poseFeu(sim, id, 125, 21)
    const feu = structureAt(sim.structures, 125, 21)!
    act(sim, id, { type: 'found_village', structureId: feu.id })
    expect(sim.villages).toHaveLength(1)
    // …puis la pluie arrive, et le marteau continue de bâtir : R5 ne garde QUE le feu neuf.
    poseFront(sim, 'pluie', 95.5)
    expect(meteoMouille(sim, 127, 21)).toBe(true)
    const e = sim.entities.find((en) => en.id === id)!
    e.activeSlot = e.inventory.findIndex((s) => s?.item === 'hammer')
    drainEvents(sim)
    act(sim, id, { type: 'build', structure: 'wall', tx: 127, ty: 21 })
    expect(refus(sim)).toEqual([])
    expect(structureAt(sim.structures, 127, 21)?.type).toBe('wall')
  })

  it('R5 rallumage sacré — un feu ÉTEINT se réalimente et se rallume SOUS l’orage au cœur de bande', () => {
    const sim = simCalme()
    const id = poseur(sim, 125, 20, 1)
    poseFeu(sim, id, 125, 21)
    const feu = structureAt(sim.structures, 125, 21)!
    // On l'ÉPUISE : plus une bûche, braises échues — état « out », chaleur nulle.
    for (let i = 0; i < feu.fuel!.length; i++) feu.fuel![i] = null
    delete feu.burnAt
    delete feu.burnSlot
    feu.emberUntil = sim.tick
    expect(fireState(sim, feu)).toBe('out')
    expect(fireWarmthFactor(sim, feu)).toBe(0)
    // L'orage arrive, plein cœur sur le feu — là où la POSE d'un feu neuf serait refusée. Sa
    // bande est CENTRÉE sur le feu : un orage d'Éclosion est large de 120 tuiles (S7) et sa
    // rampe de 18 — poser son bord à 10 tuiles du feu ne l'aurait mis QUE dans la rampe. Et
    // l'orage de l'ÉCLOSION mouille (seul celui de l'Ardeur est sec, `ORAGE_SEC_PHASE`).
    poseFront(sim, 'orage', 125 - largeurDe({ type: 'orage', day: MI_ECLOSION }) / 2)
    expect(meteoMouille(sim, feu.tx, feu.ty)).toBe(true)
    expect(meteoIntensity(sim, feu.tx, feu.ty)).toBe(1)
    drainEvents(sim)
    // `feed_fire` — la RÉALIMENTATION, un chemin distinct de la pose : il passe, toujours.
    act(sim, id, { type: 'feed_fire', structureId: feu.id })
    const evts = drainEvents(sim)
    expect(evts.some((e2) => e2.type === 'action_rejected')).toBe(false)
    expect(evts.some((e2) => e2.type === 'fire_relit')).toBe(true) // l'ancre de respawn s'est rallumée
    expect(fireState(sim, feu)).toBe('lit')
    expect(fireWarmthFactor(sim, feu)).toBe(1)
    // Et il brûle au rythme de l'orage : la pression continue — jamais la mort.
    const b0 = fuelTicksRemaining(sim.tick, feu)
    for (let t = 0; t < 200; t++) step(sim, [])
    expect(b0 - fuelTicksRemaining(sim.tick, feu)).toBe(200 * METEO.FEU_CONSO.orage)
    expect(fireState(sim, feu)).toBe('lit')
  })
})

describe('R7 — vitesse et perception (A7)', () => {
  /**
   * Un monde au MIDI DU CŒUR DE L'ARDEUR — plein été, plein jour, plaine `grass` (patron
   * `simSousFront` de R4) : la courbe y pose la plaine à +26 °C, si bien que sous la pluie
   * (`COLD.pluie` = 4) il reste +22 — au-dessus de l'AIR DOUX, donc le corps tient ses 37 et
   * AUCUN ralentissement de froid ne se mélange aux mesures de vitesse. C'est aussi la seule
   * saison dont les bandes (pluie 60, brouillard 50) laissent un DEHORS sur une carte de 400 :
   * la géométrie que ces gardes exigent. Le front se pose À LA MAIN à mi-traversée : bande
   * pleinement sur la carte, cœur large, deux régimes à la fois.
   */
  function simR7(): SimState {
    const sim = createSim(11, { map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    sim.tick = tickMidiDuJour(MI_ARDEUR)
    return sim
  }
  function poseFrontR7(sim: SimState, type: MeteoType): BandeMeteo {
    const startTick = sim.tick - Math.round(0.5 * METEO.TRAVERSEE_TICKS)
    sim.meteo = { type, cycle: MI_ARDEUR - 1, day: MI_ARDEUR, edge: 0, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
    return frontMeteoPos(sim.meteo, sim.tick, sim.map.width, sim.map.height)!
  }

  it('les LOIS — 1 sans front ; balayage perpendiculaire : 1 dehors, plein facteur au cœur, rampe continue, monotone et bornée, pur', () => {
    const sim = createSim(3, { map: createEmptyMap(90, 200, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    // Sans front : 1 AU BIT PRÈS, partout, pour les deux lois.
    for (const x of [-5, 0, 45, 89]) {
      expect(meteoSpeedFactor(sim, x, 100)).toBe(1)
      expect(meteoVisionFactor(sim, x, 100)).toBe(1)
    }
    sim.meteo = { type: 'pluie', cycle: 0, day: MI_ARDEUR, edge: 0, startTick: 0, endTick: METEO.TRAVERSEE_TICKS }
    sim.tick = METEO.TRAVERSEE_TICKS / 2 // la bande est pleinement SUR la carte
    const bande = frontMeteoPos(sim.meteo, sim.tick, sim.map.width, sim.map.height)!
    expect(bande.lo).toBeGreaterThan(0)
    expect(bande.hi).toBeLessThan(sim.map.width) // le balayage traverse les TROIS régimes
    const rampe = METEO.RAMPE * largeurDe(sim.meteo)
    const avant = snapshot(sim)
    const pas = 0.05
    const n = Math.round((sim.map.width + 10) / pas)
    const lois = [
      { f: meteoSpeedFactor, plein: METEO.SPEED.pluie },
      { f: meteoVisionFactor, plein: METEO.VISION.pluie },
    ] as const
    for (const { f, plein } of lois) {
      let prev = 1
      for (let k = 0; k <= n; k++) {
        const x = -5 + k * pas
        const v = f(sim, x, 100)
        expect(v).toBe(f(sim, x, 100)) // pure : deux appels, même réponse
        expect(v).toBeGreaterThanOrEqual(plein)
        expect(v).toBeLessThanOrEqual(1)
        if (x <= bande.lo || x >= bande.hi) expect(v).toBe(1)
        if (x >= bande.lo + rampe && x <= bande.hi - rampe) expect(v).toBeCloseTo(plein, 12)
        // Jamais un mur : la pente est bornée par (1 − plein)/rampe sur TOUT le domaine.
        expect(Math.abs(v - prev)).toBeLessThanOrEqual(((1 - plein) * pas) / rampe + 1e-9)
        // Monotone dans chaque rampe : le facteur DESCEND à l'entrée, REMONTE à la sortie.
        if (x - pas >= bande.lo && x <= bande.lo + rampe) expect(v).toBeLessThanOrEqual(prev)
        if (x - pas >= bande.hi - rampe && x <= bande.hi) expect(v).toBeGreaterThanOrEqual(prev)
        prev = v
      }
    }
    expect(snapshot(sim)).toBe(avant) // zéro mutation, zéro tirage sur tout le balayage
  })

  it('les types DOUX — brouillard : SPEED vaut 1 au bit près jusqu’au cœur, et sa VISION tombe au plein 0,5 ; pluie : VISION 0,85', () => {
    const sim = simR7()
    const bande = poseFrontR7(sim, 'brouillard')
    const coeur = (bande.lo + bande.hi) / 2
    expect(meteoIntensity(sim, coeur, 20.5)).toBe(1)
    for (const x of [bande.lo - 1, bande.lo + 2, coeur, bande.hi - 2, bande.hi + 1]) {
      expect(meteoSpeedFactor(sim, x, 20.5)).toBe(1) // SPEED.brouillard = 1 : le pas ne sait rien
    }
    expect(meteoVisionFactor(sim, coeur, 20.5)).toBeCloseTo(METEO.VISION.brouillard, 12)
    poseFrontR7(sim, 'pluie')
    const bp = frontMeteoPos(sim.meteo!, sim.tick, sim.map.width, sim.map.height)!
    expect(meteoVisionFactor(sim, (bp.lo + bp.hi) / 2, 20.5)).toBeCloseTo(METEO.VISION.pluie, 12)
  })

  it('A7 vitesse — sous PLUIE au cœur, l’avatar marche SPEED.pluie × la distance du même avatar au sec ; brouillard : bit-identique ; RNG intact', () => {
    const marche = (front: MeteoType | null): SimState => {
      const sim = simR7()
      if (front) poseFrontR7(sim, front)
      const id = spawnEntity(sim, 185.5, 20.5)
      for (let t = 0; t < 60; t++) step(sim, [{ entityId: id, dx: 1, dy: 0 }])
      return sim
    }
    const sec = marche(null)
    const pluie = marche('pluie')
    const brouillard = marche('brouillard')
    const eSec = sec.entities[0]!
    const ePluie = pluie.entities[0]!
    const eBrouillard = brouillard.entities[0]!
    // Prémisses : le marcheur mouillé est resté AU CŒUR du départ à l'arrivée, et le froid
    // n'a rien mordu (COLD.pluie = 4 °C sur les +26 du cœur de l'Ardeur : les deux corps
    // restent au CONFORT).
    expect(meteoIntensity(pluie, 185.5, 20.5)).toBe(1)
    expect(meteoIntensity(pluie, ePluie.x, ePluie.y)).toBe(1)
    expect(eSec.temperature).toBeGreaterThanOrEqual(TEMPERATURE.CORPS_CONFORT)
    expect(ePluie.temperature).toBeGreaterThanOrEqual(TEMPERATURE.CORPS_CONFORT)
    // La mesure : SPEED.pluie × la distance du sec — ni plus, ni moins, sur N ticks identiques.
    expect(eSec.x).toBeGreaterThan(185.5) // on a bien marché
    expect(ePluie.x - 185.5).toBeCloseTo((eSec.x - 185.5) * METEO.SPEED.pluie, 9)
    // Brouillard (SPEED 1) : la marche est BIT-IDENTIQUE au sec.
    expect(eBrouillard.x).toBe(eSec.x)
    expect(eBrouillard.y).toBe(eSec.y)
    // Zéro tirage nouveau : le flux RNG des trois mondes est le même.
    expect(pluie.rngState).toBe(sec.rngState)
    expect(brouillard.rngState).toBe(sec.rngState)
  })

  it('A7 perception — l’aggro du LOUP (la plus grande portée, 13) : la CIBLE au cœur du brouillard n’est acquise qu’à aggroRange × VISION.brouillard ; l’OBSERVATEUR voilé, cible au clair : portée INCHANGÉE', () => {
    const HOUR = 3 // l'heure du loup (R10bis) : sa pleine vigueur, donc sa pleine portée
    const vigor = wolfVigor(HOUR)
    expect(vigor).toBeGreaterThan(0)
    const reachClair = MONSTER_DEFS.wolf.aggroRange * vigor
    /** Un loup et une proie posés nus, la LOI appelée directement (`wolfStep`, furtivité
     *  neutralisée à 1) : ce qui reste dans `reach`, c'est la géométrie et la météo. */
    const chasse = (front: boolean, wolfX: number, proieX: number): { sim: SimState; m: Monster; proieId: number } => {
      const sim = simR7()
      if (front) poseFrontR7(sim, 'brouillard')
      const proieId = spawnEntity(sim, proieX, 20.5)
      const wolfId = spawnMonster(sim, 'wolf', wolfX, 20.5)
      const m = sim.monsters.find((mm) => mm.entityId === wolfId)!
      const we = sim.entities.find((e) => e.id === wolfId)!
      const proie = sim.entities.find((e) => e.id === proieId)!
      const byId = new Map(sim.entities.map((e) => [e.id, e] as const))
      wolfStep(sim, m, we, [proie], byId, new Map([[wolfId, m] as const]), new Map<number, Monster[]>(), HOUR,
        (id) => id === proieId, () => 1)
      return { sim, m, proieId }
    }
    // Ciel clair, presque à pleine portée : ACQUISE — l'étalon de la loi.
    const clair = chasse(false, 200.5 - reachClair * 0.99, 200.5)
    expect(clair.m.targetId).toBe(clair.proieId)
    // Même distance, la cible au CŒUR du brouillard : plus rien (13 → 6,5).
    const voile = chasse(true, 200.5 - reachClair * 0.99, 200.5)
    expect(meteoIntensity(voile.sim, 200.5, 20.5)).toBe(1) // prémisse : le cœur, vraiment
    expect(voile.m.targetId).toBeNull()
    // La frontière EFFECTIVE est aggroRange × VISION.brouillard : un cheveu dedans, acquise…
    const dedans = chasse(true, 200.5 - reachClair * METEO.VISION.brouillard * 0.99, 200.5)
    expect(dedans.m.targetId).toBe(dedans.proieId)
    // …un cheveu dehors, rien.
    const dehors = chasse(true, 200.5 - reachClair * METEO.VISION.brouillard * 1.01, 200.5)
    expect(dehors.m.targetId).toBeNull()
    // L'OBSERVATEUR en plein brouillard, la cible AU CLAIR : la portée ne bouge PAS —
    // la sémantique « au point de la CIBLE » (on n'aveugle pas le loup au soleil).
    const embusque = chasse(true, 216.5, 216.5 + reachClair * 0.99)
    expect(meteoIntensity(embusque.sim, 216.5, 20.5)).toBe(1) // le loup est dans le rideau…
    expect(meteoIntensity(embusque.sim, 216.5 + reachClair * 0.99, 20.5)).toBe(0) // …la cible au soleil
    expect(embusque.m.targetId).toBe(embusque.proieId)
  })

  it('R7 Cendreux — `nearestPrey`, la loi de TOUS ses consommateurs : la proie voilée n’existe qu’à portée × VISION, l’œil voilé voit la proie au clair à pleine portée ; zéro tirage', () => {
    const sim = simR7()
    poseFrontR7(sim, 'brouillard')
    const obsId = spawnEntity(sim, 200.5, 20.5)
    const preyId = spawnEntity(sim, 205, 20.5)
    const obs = sim.entities.find((e) => e.id === obsId)!
    const prey = sim.entities.find((e) => e.id === preyId)!
    const R = MONSTER_DEFS.cendreux.aggroRange // 5 — la vue du Cendreux, jour comme horde
    const rng0 = sim.rngState
    // Les deux au cœur, à 4,5 tuiles : la pleine portée (5) la verrait — le voile (5 × 0,5) non.
    expect(meteoIntensity(sim, prey.x, prey.y)).toBe(1)
    expect(nearestPrey(sim, obs, R)).toBeUndefined()
    // Sous la frontière effective (2,5) : vue.
    prey.x = 202.9
    expect(nearestPrey(sim, obs, R)?.id).toBe(preyId)
    // L'œil reste au cœur, la proie sort AU CLAIR : pleine portée retrouvée — le facteur
    // se lit au point de la PROIE, jamais de l'œil.
    obs.x = 216.5
    prey.x = 228.5 // 12 tuiles, hors bande
    expect(meteoIntensity(sim, obs.x, 20.5)).toBe(1)
    expect(meteoIntensity(sim, prey.x, 20.5)).toBe(0)
    expect(nearestPrey(sim, obs, 12.5)?.id).toBe(preyId)
    expect(sim.rngState).toBe(rng0) // la loi ne tire rien
  })

  it('R7 gibier — le sens INVERSE : le CHASSEUR au cœur du brouillard n’éveille plus le cerf à 12 tuiles ; le cerf trempé, chasseur au clair : jauge BIT-IDENTIQUE au sec', () => {
    const D = 12 // sous la portée perçue du cerf (alertRange 14 × PERCEIVE_FACTOR), loin de la panique
    const traque = (cerfX: number, front: boolean): { sim: SimState; m: Monster } => {
      const sim = simR7()
      if (front) poseFrontR7(sim, 'brouillard')
      // Le chasseur à l'EST (le vent d'état souffle vers +x : il n'est jamais au vent du
      // cerf — l'odorat ne court-circuite pas la mesure), au pas de MARCHE (gait par défaut).
      const hunterId = spawnEntity(sim, cerfX + D, 20.5)
      const cerfId = spawnMonster(sim, 'deer', cerfX, 20.5)
      const m = sim.monsters.find((mm) => mm.entityId === cerfId)!
      const ce = sim.entities.find((e) => e.id === cerfId)!
      const hunter = sim.entities.find((e) => e.id === hunterId)!
      const byId = new Map(sim.entities.map((e) => [e.id, e] as const))
      faunaStep(sim, m, ce, [avatarThreat(sim, hunter)], byId, new Map<number, Monster[]>(), 12)
      return { sim, m }
    }
    // Ciel clair : à 12 tuiles, un chasseur qui MARCHE fait monter la jauge dès ce tick.
    const clair = traque(171.5, false)
    expect(clair.m.suspicion).toBeGreaterThan(0)
    // Chasseur au CŒUR du brouillard, cerf au clair : la distance effective double — rien ne monte.
    const voile = traque(171.5, true)
    expect(meteoIntensity(voile.sim, 171.5, 20.5)).toBe(0) // le cerf est au clair…
    expect(meteoIntensity(voile.sim, 171.5 + D, 20.5)).toBe(1) // …le chasseur en plein rideau
    expect(voile.m.suspicion).toBe(0)
    // Le CERF sous le brouillard, chasseur au clair : ses sens à LUI ne sont pas voilés —
    // la jauge monte EXACTEMENT comme au sec (le facteur se lit au point de la CIBLE regardée).
    const trempe = traque(216.5, true)
    expect(meteoIntensity(trempe.sim, 216.5, 20.5)).toBe(1)
    expect(meteoIntensity(trempe.sim, 216.5 + D, 20.5)).toBe(0)
    expect(trempe.m.suspicion).toBe(clair.m.suspicion)
  })
})

describe('R8 — la foudre (A6)', () => {
  const [W, H] = [400, 40]

  /** Un orage du CŒUR DE L'ARDEUR (+26 °C : `partDeBlizzard` est à zéro, aucun froid létal ne se
   *  mêle aux mesures ; et c'est la saison dont la bande de 60 tuiles tombe franchement sur
   *  une carte de 400), sur le premier CYCLE dont les impacts sont tous espacés de plus de
   *  `FOUDRE_TELEGRAPHE_TICKS` — la prémisse du test de télégraphe exact (deux impacts
   *  trop rapprochés se chevaucheraient : `foudreTelegrapheAt` ne peut annoncer qu'UN
   *  coup à la fois). On la CHERCHE au lieu de la supposer : la clé de hash est le cycle,
   *  et un jour codé en dur redeviendrait faux au moindre recalibrage. */
  function fabriqueOrageAuCycle(cycle: number): MeteoFront {
    const startTick = cycle * TICKS_PER_CYCLE + 1000
    return { type: 'orage', cycle, day: MI_ARDEUR, edge: 0, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
  }

  function fabriqueOrage(): MeteoFront {
    for (let cycle = 0; cycle < 200; cycle++) {
      const front = fabriqueOrageAuCycle(cycle)
      const ticks = impactsDeFenetre(front).map((i) => i.tick)
      let minGap = Infinity
      for (let i = 1; i < ticks.length; i++) minGap = Math.min(minGap, ticks[i]! - ticks[i - 1]!)
      if (ticks.length > 0 && minGap > METEO.FOUDRE_TELEGRAPHE_TICKS) return front
    }
    throw new Error('aucun cycle d’orage aux impacts assez espacés — recalibrer FOUDRE_PAR_MIN')
  }

  /** Balaye TOUTE la fenêtre tick à tick et relève chaque impact résolu. */
  function impactsDeFenetre(front: MeteoFront): { tick: number; x: number; y: number }[] {
    const liste: { tick: number; x: number; y: number }[] = []
    for (let t = front.startTick; t < front.endTick; t++) {
      const p = foudreImpactAt(front, t, W, H)
      if (p) liste.push({ tick: t, ...p })
    }
    return liste
  }

  /** Une sim posée AU TICK du premier impact qui tombe FRANCHEMENT sur la carte (marge 3
   *  tuiles) — le montage des gardes de résolution : on pose des corps autour du point,
   *  puis `advanceFoudre` (la phase seule, exacte) ou `step` (le chemin du vrai jeu). */
  function simAuTickDImpact(): { sim: SimState; imp: { tick: number; x: number; y: number } } {
    const sim = createSim(7, { map: createEmptyMap(W, H, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    const front = fabriqueOrage()
    sim.meteo = { ...front }
    const imp = impactsDeFenetre(front).find((i) => i.x > 3 && i.x < W - 3 && i.y > 3 && i.y < H - 3)!
    expect(imp).toBeDefined() // la prémisse : la fenêtre a bien un impact en plein champ
    sim.tick = imp.tick
    return { sim, imp }
  }

  it('déterminisme et cadence — mêmes impacts aux deux balayages, un par créneau PLEIN, tous DANS la bande de LEUR tick', () => {
    const front = fabriqueOrage()
    const a = impactsDeFenetre(front)
    expect(a).toEqual(impactsDeFenetre(front)) // pur : deux balayages, même liste
    // LA CADENCE EXACTE, par construction : un impact par créneau plein — le dernier
    // créneau, partiel, n'en porte pas — soit FOUDRE_PAR_MIN × minutes de traversée.
    expect(a.length).toBe(Math.floor(METEO.TRAVERSEE_TICKS / FOUDRE_CRENEAU_TICKS))
    const minutes = METEO.TRAVERSEE_TICKS / (60 * BALANCE.TICK_RATE_HZ)
    expect(a.length).toBe(Math.floor(minutes * METEO.FOUDRE_PAR_MIN)) // 22,5 min × 3 = 67
    expect(a.length).toBeGreaterThan(0)
    for (let k = 0; k < a.length; k++) {
      const imp = a[k]!
      // Chaque créneau plein porte EXACTEMENT le sien, dans l'ordre.
      expect(Math.floor((imp.tick - front.startTick) / FOUDRE_CRENEAU_TICKS)).toBe(k)
      // Et l'impact est DANS l'empreinte de bande À SON tick — la bande BOUGE, on la
      // recalcule au tick d'impact, jamais à celui de l'appelant.
      const bande = frontMeteoPos(front, imp.tick, W, H)!
      expect(imp.x).toBeGreaterThanOrEqual(bande.lo)
      expect(imp.x).toBeLessThanOrEqual(bande.hi)
      expect(imp.y).toBeGreaterThanOrEqual(0)
      expect(imp.y).toBeLessThan(H)
    }
    // Hors type orage, hors fenêtre : rien — la foudre est à l'orage seul.
    expect(foudreImpactAt({ ...front, type: 'pluie' }, a[0]!.tick, W, H)).toBeNull()
    expect(foudreImpactAt(front, front.startTick - 1, W, H)).toBeNull()
    expect(foudreImpactAt(front, front.endTick, W, H)).toBeNull()
  })

  it('télégraphe — chaque impact est annoncé EXACTEMENT FOUDRE_TELEGRAPHE_TICKS avant, au même point, compte à rebours tenu jusqu’au coup', () => {
    const T = METEO.FOUDRE_TELEGRAPHE_TICKS
    const front = fabriqueOrage()
    const impacts = impactsDeFenetre(front)
    // LA PRÉMISSE de l'exactitude, PROUVÉE : sur CE front, deux impacts ne sont jamais à
    // moins de T ticks — sinon le télégraphe montrerait le plus proche (vrai aussi, mais
    // la garde « exactement T avant » ne se lirait plus).
    for (let i = 1; i < impacts.length; i++) expect(impacts[i]!.tick - impacts[i - 1]!.tick).toBeGreaterThan(T)
    for (const imp of impacts) {
      // T ticks avant : l'annonce paraît, au point EXACT, compte à rebours plein…
      expect(foudreTelegrapheAt(front, imp.tick - T, W, H)).toEqual({ x: imp.x, y: imp.y, ticksLeft: T })
      // …elle TIENT en descendant vers le coup (mi-course et dernier tick)…
      for (const d of [Math.floor(T / 2), 1]) {
        expect(foudreTelegrapheAt(front, imp.tick - d, W, H)).toEqual({ x: imp.x, y: imp.y, ticksLeft: d })
      }
      // …T+1 avant il n'y avait RIEN (le télégraphe ne déborde pas sa fenêtre), et au
      // tick de frappe le relais passe à `foudreImpactAt`.
      expect(foudreTelegrapheAt(front, imp.tick - T - 1, W, H)).toBeNull()
      expect(foudreTelegrapheAt(front, imp.tick, W, H)).toBeNull()
    }
  })

  it('jamais létal à PV pleins — la constante, ET l’avatar sous l’impact réel au step survit debout', () => {
    expect(METEO.FOUDRE_DEGATS).toBeLessThan(100) // les PV pleins d'un avatar
    const { sim, imp } = simAuTickDImpact()
    const id = spawnEntity(sim, imp.x, imp.y)
    const e = sim.entities.find((en) => en.id === id)!
    expect(e.hp).toBe(100)
    step(sim, []) // le chemin du VRAI jeu : la phase foudre dans la boucle entière
    expect(e.hp).toBeGreaterThan(0) // frappé, jamais foudroyé à mort
    expect(Math.abs(e.hp - (100 - METEO.FOUDRE_DEGATS))).toBeLessThan(0.5) // FOUDRE_DEGATS, à la régén du tick près
  })

  it('la résolution exacte — FOUDRE_DEGATS au corps exposé dans le rayon, rien au-delà, zéro tirage RNG', () => {
    const { sim, imp } = simAuTickDImpact()
    const dedansId = spawnEntity(sim, imp.x + METEO.FOUDRE_RAYON * 0.7, imp.y)
    const dehorsId = spawnEntity(sim, imp.x + METEO.FOUDRE_RAYON + 0.2, imp.y)
    const rng0 = sim.rngState
    advanceFoudre(sim)
    expect(sim.entities.find((en) => en.id === dedansId)!.hp).toBe(100 - METEO.FOUDRE_DEGATS)
    expect(sim.entities.find((en) => en.id === dehorsId)!.hp).toBe(100) // le rayon borne, exactement
    expect(sim.rngState).toBe(rng0) // la résolution ne touche pas UN octet du flux seedé
  })

  it('l’abri SUPPRIME — maison sur la tuile d’impact : personne ne prend rien, pas de report ; sans la maison, le même voisin est touché', () => {
    // AVEC la maison sur la tuile visée : l'impact est supprimé ENTIÈREMENT.
    const avec = simAuTickDImpact()
    addStructure(avec.sim, 'house', Math.floor(avec.imp.x), Math.floor(avec.imp.y), 0, 0)
    const vAvec = spawnEntity(avec.sim, avec.imp.x + 1, avec.imp.y) // dans le rayon, tuile VOISINE, à découvert
    const eAvec = avec.sim.entities.find((en) => en.id === vAvec)!
    expect(isSheltered(avec.sim, Math.floor(eAvec.x), Math.floor(eAvec.y))).toBe(false) // la prémisse : LUI n'est pas abrité
    const liste0 = impactsDeFenetre(avec.sim.meteo!)
    advanceFoudre(avec.sim)
    expect(eAvec.hp).toBe(100) // supprimé : le ciel ne se venge pas ailleurs
    // …et la suppression ne décale RIEN : chaque créneau est indépendant par hash — la
    // liste des impacts, recalculée après coup, est identique au bit près.
    expect(impactsDeFenetre(avec.sim.meteo!)).toEqual(liste0)
    // SANS la maison : le même monde, le même voisin — touché. La garde a mordu.
    const sans = simAuTickDImpact()
    const vSans = spawnEntity(sans.sim, sans.imp.x + 1, sans.imp.y)
    advanceFoudre(sans.sim)
    expect(sans.sim.entities.find((en) => en.id === vSans)!.hp).toBe(100 - METEO.FOUDRE_DEGATS)
  })

  it('l’abri ÉPARGNE le corps — sous toit dans le rayon d’un impact voisin : 0 dégât ; le même corps à découvert : touché', () => {
    const abrite = simAuTickDImpact()
    const bx = abrite.imp.x + 1.1 // tuile voisine de celle de l'impact, toujours dans le rayon
    const by = abrite.imp.y
    addStructure(abrite.sim, 'house', Math.floor(bx), Math.floor(by), 0, 0)
    const corpsId = spawnEntity(abrite.sim, bx, by)
    const corps = abrite.sim.entities.find((en) => en.id === corpsId)!
    // Les prémisses, PROUVÉES : le corps est dans le rayon, SA tuile est abritée, celle
    // de l'IMPACT ne l'est pas (l'impact n'est donc PAS supprimé — c'est le corps qu'on teste).
    expect(distSq(bx, by, abrite.imp.x, abrite.imp.y)).toBeLessThanOrEqual(METEO.FOUDRE_RAYON * METEO.FOUDRE_RAYON)
    expect(isSheltered(abrite.sim, Math.floor(bx), Math.floor(by))).toBe(true)
    expect(isSheltered(abrite.sim, Math.floor(abrite.imp.x), Math.floor(abrite.imp.y))).toBe(false)
    // Le TÉMOIN exposé de l'autre côté prouve que la frappe a bien eu lieu.
    const temoinId = spawnEntity(abrite.sim, abrite.imp.x - 1, abrite.imp.y)
    advanceFoudre(abrite.sim)
    expect(corps.hp).toBe(100) // sous toit : épargné — l'abri immunise, période
    expect(abrite.sim.entities.find((en) => en.id === temoinId)!.hp).toBe(100 - METEO.FOUDRE_DEGATS)
    // Le MÊME corps, même position, SANS le toit : touché.
    const decouvert = simAuTickDImpact()
    const nuId = spawnEntity(decouvert.sim, decouvert.imp.x + 1.1, decouvert.imp.y)
    advanceFoudre(decouvert.sim)
    expect(decouvert.sim.entities.find((en) => en.id === nuId)!.hp).toBe(100 - METEO.FOUDRE_DEGATS)
  })

  it('la mort a sa cause — à 1 PV sous l’impact : `entity_died` porte `lightning`, le respawn suit, zéro tirage même en tuant', () => {
    const { sim, imp } = simAuTickDImpact()
    const id = spawnEntity(sim, imp.x, imp.y)
    sim.entities.find((en) => en.id === id)!.hp = 1
    drainEvents(sim)
    const rng0 = sim.rngState
    advanceFoudre(sim)
    const evts = drainEvents(sim)
    const mort = evts.find((ev) => ev.type === 'entity_died')
    expect(mort).toMatchObject({ entityId: id, byEntityId: 0, wasMonster: false, cause: 'lightning' })
    // …et l'avatar RESTE À TERRE (2026-08-31) : la foudre passe par le chemin de mort
    // EXISTANT, lequel ne relève plus tout seul. Le réveil appartient au geste du joueur.
    expect(evts.some((ev) => ev.type === 'entity_respawned')).toBe(false)
    expect(sim.entities.find((en) => en.id === id)!.downedAt).toBe(sim.tick)
    expect(sim.rngState).toBe(rng0) // `die` ne tire rien : le flux seedé est intact jusque dans la mort
  })

  it('les monstres meurent par LEUR chemin — un cerf à 1 PV sous l’impact : `monster_slain`, retiré du monde', () => {
    const { sim, imp } = simAuTickDImpact()
    const cerfId = spawnMonster(sim, 'deer', imp.x, imp.y)
    sim.entities.find((en) => en.id === cerfId)!.hp = 1
    drainEvents(sim)
    advanceFoudre(sim)
    const evts = drainEvents(sim)
    expect(evts.some((ev) => ev.type === 'entity_died' && ev.entityId === cerfId && ev.wasMonster && ev.cause === 'lightning')).toBe(true)
    expect(evts.some((ev) => ev.type === 'monster_slain' && ev.byEntityId === 0)).toBe(true)
    expect(sim.monsters.some((m) => m.entityId === cerfId)).toBe(false)
    expect(sim.entities.some((en) => en.id === cerfId)).toBe(false)
  })

  /** Un village PNJ au midi du cœur de l'Ardeur sous un orage ÉTIRÉ (patron D_LENT de R5 :
   *  bande quasi immobile — la couverture tient toute la mesure). `worldEvents: false` : un
   *  banc de PNJ mesure les PNJ. L'orage d'Ardeur est SEC (`ORAGE_SEC_PHASE`) et c'est sans
   *  effet ici : `handleOrage` se déclenche sur la CLASSE du front, jamais sur `MOUILLE` —
   *  on se met à l'abri de la foudre, pas de l'eau. */
  function simVillageSousOrage(count: number): SimState {
    const sim = createSim(7, {
      map: createEmptyMap(W, H, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true, worldEvents: false,
    })
    sim.tick = tickMidiDuJour(MI_ARDEUR)
    foundNpcVillage(sim, 125, 21, count)
    const D = 400000
    const largeur = largeurDe({ type: 'orage', day: MI_ARDEUR })
    const u = (95.5 + largeur) / (W + largeur)
    const startTick = sim.tick - Math.round(u * D)
    sim.meteo = { type: 'orage', cycle: MI_ARDEUR - 1, day: MI_ARDEUR, edge: 0, startTick, endTick: startTick + D }
    expect(meteoIntensity(sim, 125.5, 21.5)).toBe(1) // la prémisse : le village est au cœur
    return sim
  }

  it('R8 PNJ — couverts par l’orage, les villageois gagnent la tuile abritée du village et y RESTENT', () => {
    const sim = simVillageSousOrage(3)
    const village = sim.villages[0]!
    addStructure(sim, 'house', 135, 21, village.id, 0) // hors de l'empreinte du campement (huts ≤ ±8), au cœur de bande
    expect(meteoIntensity(sim, 135.5, 21.5)).toBe(1)
    const npcs = sim.npcs.filter((n) => n.villageId === village.id)
    expect(npcs).toHaveLength(3)
    // La prémisse : personne n'est abrité au départ — le geste va se VOIR.
    for (const n of npcs) {
      const e = sim.entities.find((en) => en.id === n.entityId)!
      expect(isSheltered(sim, Math.floor(e.x), Math.floor(e.y))).toBe(false)
    }
    for (let t = 0; t < 600; t++) step(sim, [])
    for (const n of npcs) {
      const e = sim.entities.find((en) => en.id === n.entityId)!
      expect(e.hp).toBeGreaterThan(0)
      expect(isSheltered(sim, Math.floor(e.x), Math.floor(e.y))).toBe(true) // au sec, hors de portée de la foudre
    }
    // …et ils y RESTENT tant que l'orage couvre.
    for (let t = 0; t < 200; t++) step(sim, [])
    for (const n of npcs) {
      const e = sim.entities.find((en) => en.id === n.entityId)!
      expect(isSheltered(sim, Math.floor(e.x), Math.floor(e.y))).toBe(true)
    }
  })

  it('R8 PNJ — sans maison, le repli est la BULLE DU FEU (le refuge lisible), et il y tient', () => {
    const sim = simVillageSousOrage(1)
    const npc = sim.npcs[0]!
    const e = sim.entities.find((en) => en.id === npc.entityId)!
    // Éloigné à découvert, toujours au cœur de bande, hors bulle (FIRE_RANGE) : le geste se mesure.
    e.x = 110.5
    e.y = 21.5
    expect(meteoIntensity(sim, e.x, e.y)).toBe(1)
    expect(fireBubble(sim, e.x, e.y)).toBe(0)
    for (let t = 0; t < 400; t++) step(sim, [])
    expect(fireBubble(sim, e.x, e.y)).toBeGreaterThan(0) // replié dans la bulle de SON Feu…
    for (let t = 0; t < 200; t++) step(sim, [])
    expect(fireBubble(sim, e.x, e.y)).toBeGreaterThan(0) // …et il y tient tant que l'orage couvre
  })
})

// ═══ R9 — L'ANNONCE (BLIZZARD) ══════════════════════════════════════════════════════════

describe('R9 — l’annonce (blizzard)', () => {
  /** La NUIT d'un jour — l'écart MINIMAL annonce → entrée (du crépuscule de la veille à l'aube
   *  qui élit). Saisonnière depuis S6 : 12,6 min réelles au cœur de l'Ardeur, 23,4 au cœur du
   *  Grand Froid — ce n'est plus une constante, c'est la nuit DE CE JOUR-LÀ. */
  const nuitDuJour = (jour: number): number => TICKS_PER_CYCLE - dayTicksPourJour(jour)

  type EvtBlizzard = Extract<SimEvent, { type: 'blizzard_annonce' | 'blizzard_entre' | 'blizzard_passe' }>

  /**
   * CE FRONT EST-IL UN BLIZZARD (R9 × R11) — la fonction de la sim, jamais une seconde lecture :
   * un ORAGE dont l'aspect en plaine à découvert, au milieu de sa fenêtre, est `blizzard`.
   * Depuis R11 « blizzard » n'est plus un type qu'on lit sur le record, c'est un SENS qu'on
   * lui demande — et c'est exactement ce que l'annonce interroge.
   */
  function estBlizzard(sim: SimState, f: Pick<MeteoFront, 'type' | 'startTick' | 'endTick'>): boolean {
    return frontEstBlizzard(sim, f)
  }

  /** Le premier jour de l'ANNÉE dont l'élection (fonction pure) rend un blizzard. On le CHERCHE
   *  sur le tour entier : le blizzard ne s'élit plus, il se DÉRIVE du froid trouvé au milieu de
   *  la fenêtre (R11), donc il tombe là où la courbe et le tirage se rencontrent — pas dans une
   *  saison qu'on pourrait nommer d'avance. */
  function jourDeBlizzard(sim: SimState): number {
    for (let d = 1; d <= YEAR_DAYS; d++) {
      const f = frontDuCycle(d - 1, sim.calendarScale, sim.jourDeDepart)
      if (f && f.day === d && estBlizzard(sim, f)) return d
    }
    throw new Error('aucun blizzard sur l’année — la table PAR_SAISON ou la courbe du socle a changé, recalibrer le test')
  }

  /**
   * Joue les TICK-CLÉS de l'ANNÉE — chaque aube (l'élection), chaque crépuscule sauf le
   * dernier (l'annonce de demain ; le dernier annoncerait un jour dont le front ne
   * serait jamais joué ici), et l'entrée/sortie de chaque front élu — et relève les fronts
   * et les événements blizzard. Un tick déjà joué (fin de front = aube suivante, entrée à
   * l'aube même) n'est jamais rejoué : la marche est strictement monotone.
   */
  function anneeRelevee(sim: SimState, jours = YEAR_DAYS): { fronts: MeteoFront[]; evts: EvtBlizzard[] } {
    const fronts: MeteoFront[] = []
    const evts: EvtBlizzard[] = []
    const visite = (t: number): void => {
      if (t < sim.tick) return
      sim.tick = t
      step(sim, [])
      for (const e of drainEvents(sim)) {
        if (e.type === 'blizzard_annonce' || e.type === 'blizzard_entre' || e.type === 'blizzard_passe') evts.push(e)
      }
    }
    for (let d = 1; d <= jours; d++) {
      visite(tickAubeDuJour(d))
      const front = sim.meteo
      const ticks: number[] = []
      if (front && front.day === d) {
        fronts.push({ ...front })
        ticks.push(front.startTick, front.endTick)
      }
      if (d < jours) ticks.push(tickAubeDuJour(d) + dayTicksPourJour(d)) // le crépuscule : l'annonce de demain
      for (const t of ticks.sort((a, b) => a - b)) visite(t)
    }
    return { fronts, evts }
  }

  it('UN SEUL ÉCRIVAIN : le front élu à l’aube EST `meteoTypeDuCycle`, jour par jour', () => {
    // La construction anti-mensonge (leçon « écrivain unique » du journal, 2026-08-18) :
    // l'annonce lit la MÊME fonction que l'aube. Si cette égalité tient sur toute l'année,
    // un deuxième chemin d'élection n'existe pas — le reste de la section en découle.
    const sim = simMeteo()
    for (let d = 1; d <= YEAR_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      step(sim, [])
      expect(sim.meteo && sim.meteo.day === d ? sim.meteo.type : null)
        .toBe(meteoTypeDuCycle(d - 1, SCALE, sim.jourDeDepart))
    }
  })

  it('A3 — l’ARDEUR n’a pas de blizzard : la saison de l’orage est la saison sans un flocon', () => {
    // L'ancienne garde disait « l'acte I n'a pas de blizzard » et en tirait que chaque blizzard
    // a sa veille. Sous une année qui tourne, ce n'est plus la première saison qui est douce :
    // l'Éclosion s'OUVRE gelée (+3 °C le jour) et dégèle — un orage de printemps peut très bien
    // y devenir un blizzard. La saison sans flocon, c'est l'ARDEUR (A3) : la courbe y tient la
    // plaine entre +17,6 et +26 le jour, et l'écart de nuit saisonnier (S5) la laisse à +9,7 au
    // pire — bien au-dessus de la limite de neige. C'est aussi la saison de l'orage (0,5 dans sa
    // mixture) : le domaine balayé a de quoi mordre. La veille d'un blizzard, elle, n'est plus
    // garantie par la saison mais par la construction — le triplet ci-dessous l'affirme.
    const sim = simMeteo()
    let orages = 0
    for (let d = BALANCE.ACT_DAYS + 1; d <= 2 * BALANCE.ACT_DAYS; d++) {
      const f = frontDuCycle(d - 1, sim.calendarScale, sim.jourDeDepart)
      if (!f) continue
      if (f.type === 'orage') orages++
      expect(estBlizzard(sim, f), `jour ${d}`).toBe(false)
    }
    expect(orages).toBeGreaterThan(0) // la garde prouve sa prémisse : l'Ardeur A des orages
  })

  it('année × 2 seeds : CHAQUE front blizzard a son triplet annonce → entre → passe, ordre strict — et RIEN d’autre', () => {
    for (const seed of [7, 2026]) {
      const { fronts, evts } = anneeRelevee(simMeteo(seed))
      const blizzards = fronts.filter((f) => estBlizzard(simMeteo(seed), f))
      expect(blizzards.length).toBeGreaterThan(0) // sinon on mesure l'instrument, pas la règle
      expect(evts.length).toBe(3 * blizzards.length) // le silence des autres types, COMPTÉ
      for (const f of blizzards) {
        const annonce = evts.find((e) => e.type === 'blizzard_annonce' && e.day === f.day)
        const entre = evts.find((e) => e.type === 'blizzard_entre' && e.day === f.day)
        const passe = evts.find((e) => e.type === 'blizzard_passe' && e.day === f.day)
        expect(annonce, `annonce du blizzard du jour ${f.day} (seed ${seed})`).toBeTruthy()
        expect(entre?.tick).toBe(f.startTick) // l'ENTRÉE réelle : le tick où la bande devient active
        expect(passe?.tick).toBe(f.endTick) // la purge
        // L'annonce précède l'entrée d'AU MOINS un crépuscule → aube (le critère R9) — la nuit
        // de la VEILLE, celle que la saison a taillée (S6).
        expect(f.startTick - annonce!.tick).toBeGreaterThanOrEqual(nuitDuJour(f.day - 1))
        expect(annonce!.tick).toBeLessThan(entre!.tick)
        expect(entre!.tick).toBeLessThan(passe!.tick)
      }
    }
  })

  it('tous les autres fronts n’émettent RIEN — leur annonce est géométrique, on les voit venir', () => {
    const { fronts, evts } = anneeRelevee(simMeteo())
    const sim = simMeteo()
    expect(fronts.some((f) => !estBlizzard(sim, f))).toBe(true) // le domaine balayé a bien des fronts ordinaires
    const joursBlizzard = new Set(fronts.filter((f) => estBlizzard(sim, f)).map((f) => f.day))
    for (const e of evts) expect(joursBlizzard.has(e.day), `${e.type} au jour ${e.day}`).toBe(true)
  })

  it('meteoActive=false : ZÉRO événement météo sur toute l’année', () => {
    const { fronts, evts } = anneeRelevee(simMeteo(2026, false))
    expect(fronts).toEqual([])
    expect(evts).toEqual([])
  })

  it('l’annonce dit VRAI : le lendemain de chaque annonce, le front blizzard est LÀ', () => {
    // La fonction unique rend le mensonge impossible — on l'affirme quand même.
    const { fronts, evts } = anneeRelevee(simMeteo())
    const annonces = evts.filter((e) => e.type === 'blizzard_annonce')
    expect(annonces.length).toBeGreaterThan(0)
    const sim = simMeteo()
    for (const a of annonces) {
      const f = fronts.find((fr) => fr.day === a.day)
      expect(f, `jour ${a.day}`).toBeTruthy()
      expect(estBlizzard(sim, f!), `jour ${a.day}`).toBe(true)
      expect(a.tick).toBeLessThan(tickAubeDuJour(a.day)) // dite la VEILLE, avant l'aube qui élit
    }
  })

  it('gardée par jour (patron `lastBrumeDay`) : rejouée au même crépuscule, UNE seule annonce', () => {
    const sim = simMeteo()
    const jour = jourDeBlizzard(sim)
    sim.tick = tickAubeDuJour(jour) - nuitDuJour(jour - 1) // le crépuscule de la veille
    advanceMeteo(sim)
    advanceMeteo(sim)
    expect(drainEvents(sim).filter((e) => e.type === 'blizzard_annonce')).toHaveLength(1)
  })

  it('R9 ne tire RIEN : `rngState` intact de l’annonce à la purge', () => {
    const sim = simMeteo()
    drainEvents(sim) // le `day_started` de l'initialisation n'est pas à R9
    const d = jourDeBlizzard(sim)
    const avant = sim.rngState
    sim.tick = tickAubeDuJour(d) - nuitDuJour(d - 1)
    advanceMeteo(sim) // l'annonce
    sim.tick = tickAubeDuJour(d)
    advanceMeteo(sim) // l'élection
    sim.tick = sim.meteo!.startTick
    advanceMeteo(sim) // l'entrée
    sim.tick = sim.meteo!.endTick
    advanceMeteo(sim) // la purge
    expect(drainEvents(sim).map((e) => e.type)).toEqual(['blizzard_annonce', 'blizzard_entre', 'blizzard_passe'])
    expect(sim.rngState).toBe(avant)
    expect(sim.meteo ?? null).toBeNull()
  })

  it('la chronique : l’annonce y entre (un battement, daté de la VEILLE) — l’entrée et la sortie non, le patron Brume', () => {
    expect(CHRONICLE_EVENT_TYPES.has('blizzard_annonce')).toBe(true)
    expect(CHRONICLE_EVENT_TYPES.has('blizzard_entre')).toBe(false)
    expect(CHRONICLE_EVENT_TYPES.has('blizzard_passe')).toBe(false)
    const d = jourDeBlizzard(simMeteo())
    const entrees = chronicleFromEvents(
      [{ type: 'blizzard_annonce', tick: tickAubeDuJour(d) - nuitDuJour(d - 1), day: d }],
      SCALE,
      1, // le jour d'ouverture du monde des montages (S2 : le vrai jeu, lui, ouvre au jour 61)
      {},
      simMeteo().map, // la carte : le formateur y cherche la clef de LIEU (annales R13)
    )
    expect(entrees).toHaveLength(1)
    expect(entrees[0]!.weight).toBe('battement')
    expect(entrees[0]!.text).toContain('blizzard')
    expect(entrees[0]!.day).toBe(d - 1) // datée du soir où on l'a su, pas du jour du front
    // L'entrée et la sortie ne racontent rien de plus : le FORMATEUR les ignore aussi.
    const muets: SimEvent[] = [
      { type: 'blizzard_entre', tick: tickAubeDuJour(d), day: d },
      { type: 'blizzard_passe', tick: tickAubeDuJour(d) + 1, day: d },
    ]
    expect(chronicleFromEvents(muets, SCALE, 1, {}, simMeteo().map)).toEqual([])
  })
})

/**
 * ═══ LA GARDE QUI MANQUAIT — la météo doit être VIVANTE DANS TOUS LES CALENDRIERS ═══
 *
 * Elle naît d'un défaut MESURÉ, pas d'une inquiétude. Tant que l'élection était keyée sur
 * le JOUR DE SAISON mais n'était ÉVALUÉE qu'aux bords de cycle, la Veillée — qui compresse
 * les 60 jours en `VEILLEE_SEASON_CYCLES` = 6 cycles — ne tirait que 6 jours sur 60, TOUJOURS
 * les mêmes (1, 11, 21…), dans tous les mondes : deux fronts de neige pour une saison solo
 * entière, jamais un éclair, jamais une annonce. Toute la suite passait au vert : elle
 * mesurait un calendrier (1 jour = 1 cycle) qu'AUCUN mode livré ne joue.
 *
 * La leçon maison « deux horloges : cadence et péremption » : ce qui se compte en TEMPS RÉEL
 * (la traversée d'un front) doit s'ÉLIRE en temps réel. On balaie donc les trois calendriers
 * réels, et on affirme le nombre de fronts contre le nombre de CYCLES joués.
 */
describe('la météo est vivante dans TOUS les calendriers (le défaut de cadence, gardé)', () => {
  /** Les trois calendriers RÉELS — celui des tests, celui du solo, celui du LAN. */
  const CALENDRIERS = [
    { nom: 'tests (1 jour = 1 cycle)', scale: SCALE },
    { nom: 'Veillée (60 jours en 6 cycles)', scale: calendarScaleForSeasonCycles(6) },
    { nom: 'LAN (calendarScale 1)', scale: 1 },
  ]
  const CYCLES = 40

  function frontsSurCycles(scale: number): MeteoType[] {
    const sim = createSim(2026, { map: createEmptyMap(70, 40, TERRAIN_GRASS), calendarScale: scale, meteoActive: true })
    const vus: MeteoType[] = []
    for (let c = 0; c < CYCLES; c++) {
      sim.tick = c * TICKS_PER_CYCLE
      step(sim, [])
      if (sim.meteo && sim.meteo.cycle === c) vus.push(sim.meteo.type)
    }
    return vus
  }

  it('chaque calendrier élit en proportion des CYCLES joués — jamais du calendrier de l’hôte', () => {
    for (const { nom, scale } of CALENDRIERS) {
      const fronts = frontsSurCycles(scale)
      // La cadence est réelle : la densité d'une saison vaut `moyenne(episode) / BLOC_EPISODE`
      // (S9), quel que soit `calendarScale`. Bornes larges (la saison la fait varier d'un tiers
      // aux trois quarts) mais qui EXCLUENT le défaut : 40 cycles ne peuvent plus rendre 1 ou 2
      // fronts. Relevé : 19 · 24 · 21 fronts sur les trois calendriers — la borne garde sa marge.
      expect(fronts.length, nom).toBeGreaterThan(CYCLES * 0.35)
      expect(fronts.length, nom).toBeLessThanOrEqual(CYCLES)
    }
  })

  it('la VEILLÉE voit PLUSIEURS ciels sur une année — pas un seul type, six fois', () => {
    // Le cœur du défaut : six tirages figés ne montraient QUE de la neige du Grand Froid.
    // Une année solo doit faire passer plusieurs ciels devant le joueur.
    const types = new Set(frontsSurCycles(calendarScaleForSeasonCycles(6)))
    expect(types.size).toBeGreaterThanOrEqual(2)
  })

  it('la SAISON commande toujours la mixture : le même bloc rend un autre ciel selon la saison qu’il ouvre', () => {
    // La cadence est devenue réelle, mais la SAISON garde ce qui lui revient (S7) : l'Ardeur
    // est la saison de l'ORAGE (0,5 de sa mixture), les Pluies celle de la PLUIE (0,7). On
    // interroge `episodeDuBloc` sur le MÊME index de bloc avec deux jours d'ouverture
    // différents : le tirage est identique, seule la table change — c'est le branchement
    // `actForDay(jourDuBloc) → PAR_SAISON` qu'on épingle, pas les poids.
    let orageArdeur = 0
    let oragePluies = 0
    let differents = 0
    for (let bloc = 0; bloc < 300; bloc++) {
      const ardeur = episodeDuBloc(bloc, MI_ARDEUR).type
      const pluies = episodeDuBloc(bloc, MI_PLUIES).type
      if (ardeur === 'orage') orageArdeur++
      if (pluies === 'orage') oragePluies++
      if (ardeur !== pluies) differents++
    }
    expect(differents).toBeGreaterThan(0) // la garde prouve sa prémisse : la table MORD
    expect(orageArdeur).toBeGreaterThan(oragePluies)
    // Et l'ASPECT ne s'élit toujours pas : aucune mixture ne peut rendre `neige` ni `blizzard`.
    for (let bloc = 0; bloc < 300; bloc++) {
      for (const jour of [MI_ECLOSION, MI_ARDEUR, MI_PLUIES, MI_GRAND_FROID]) {
        expect(['pluie', 'brouillard', 'orage', 'vent_de_cendre']).toContain(episodeDuBloc(bloc, jour).type)
      }
    }
  })

  it('A5 — les épisodes existent et sont BORNÉS : la série est celle de la fourchette de sa saison', () => {
    // S9 : un bloc de `BLOC_EPISODE` cycles porte exactement UN épisode, dont la longueur est
    // tirée dans la fourchette de la saison. C'est le mécanisme qu'on mesure — sur
    // `episodeDuCycle`, jamais sur les constantes — et non la longueur des SÉRIES observées :
    // deux épisodes de blocs voisins peuvent se toucher, et `episodeDuBloc` le documente
    // (« une longue tempête émerge parfois, personne ne l'a écrite »).
    for (const jour of [MI_ECLOSION, MI_ARDEUR, MI_PLUIES, MI_GRAND_FROID]) {
      // LA FOURCHETTE EN VIGUEUR EST CELLE DE LA TABLE — mais seulement tant qu'aucun CARACTÈRE
      // ne la force : le Déluge tient quatre à six cycles (S18), et `episodeDuBloc` lit
      // `effetsDuJour(jour).episode` AVANT la saison. Sans cette ligne, la garde serait écrite
      // sur une table que la source ne lit pas toujours — et rougirait sur du code juste.
      expect(effetsDuJour(jour).episode, `un caractère force la fourchette au jour ${jour}`).toBeUndefined()
      const [min, max] = METEO.PAR_SAISON(actForDay(jour)).episode
      for (let bloc = 0; bloc < 200; bloc++) {
        const ep = episodeDuBloc(bloc, jour)
        const duree = ep.fin - ep.debut
        expect(duree, `bloc ${bloc}, jour ${jour}`).toBeGreaterThanOrEqual(min)
        expect(duree, `bloc ${bloc}, jour ${jour}`).toBeLessThanOrEqual(max)
        // L'épisode tient DANS son bloc : début et fin nets, jamais un débordement.
        expect(ep.debut).toBeGreaterThanOrEqual(bloc * METEO.BLOC_EPISODE)
        expect(ep.fin).toBeLessThanOrEqual((bloc + 1) * METEO.BLOC_EPISODE)
      }
    }
    // Aux Pluies (deux jours sur trois), l'année porte au moins une série de trois cycles
    // consécutifs sous le ciel — le critère A5, mesuré sur `frontDuCycle`.
    const sim = simMeteo()
    let serie = 0
    let plusLongue = 0
    for (let d = 2 * BALANCE.ACT_DAYS + 1; d <= 3 * BALANCE.ACT_DAYS; d++) {
      serie = frontDuCycle(d - 1, SCALE, sim.jourDeDepart) ? serie + 1 : 0
      plusLongue = Math.max(plusLongue, serie)
    }
    expect(plusLongue).toBeGreaterThanOrEqual(3)
  })
})

// ═══ R11-R12 — LA NEIGE SE DÉRIVE DU FROID · S7 — LA GÉOMÉTRIE EST SAISONNIÈRE ═══════════
//
// Les gardes que le reste du fichier CONSOMME sans les affirmer : l'aspect suit le froid au
// point (A12), le refroidissement éolien est une pente bornée et monotone (A13), et la
// géométrie du front est une table par SAISON — R13 (la largeur commandée par le froid) est
// retirée, pas bordée (A14).

describe('A12 — l’ASPECT se dérive du froid, il ne s’élit pas (R11)', () => {
  /** Une carte où la plaine et le NÉVÉ se touchent : deux climats, un seul ciel.
   *  LARGEUR 40 ET NON 120, ET C'EST LA PRÉMISSE : la bande d'une pluie fait au plus étroit
   *  60 tuiles (l'Ardeur, `PAR_SAISON`) — sur une carte plus large, les bords ne seraient PAS
   *  couverts et l'aspect y serait `null`. Le montage affirme cette prémisse plus bas (aucun
   *  point du balayage n'est hors bande), au lieu de la supposer. */
  const LARGE_DEUX_CLIMATS = 40
  function simDeuxClimats(jour: number, nuit: boolean): SimState {
    const L = LARGE_DEUX_CLIMATS
    const map = createEmptyMap(L, 40, TERRAIN_GRASS)
    for (let ty = 0; ty < 40; ty++) for (let tx = L / 2; tx < L; tx++) setTile(map, tx, ty, TERRAIN_SNOW)
    const sim = createSim(11, { map, calendarScale: SCALE, meteoActive: true })
    sim.tick = nuit ? tickMinuitDuJour(jour) : tickMidiDuJour(jour)
    // Une PLUIE dont la bande couvre TOUTE la carte : ce qui reste de variable est le FROID.
    const D = METEO.TRAVERSEE_TICKS
    sim.meteo = { type: 'pluie', cycle: jour - 1, day: jour, edge: 0, startTick: sim.tick - Math.floor(D / 2), endTick: sim.tick + Math.ceil(D / 2) }
    return sim
  }

  it('LE SEUIL EST CELUI DU GUÉ — une seule loi pour la glace et pour le flocon', () => {
    expect(METEO.SEUIL_NEIGE).toBe(GEL.SEUIL_GUE)
  })

  it('un MÊME front de pluie tombe en pluie sur la plaine et en NEIGE sur le Névé, dès le PRINTEMPS', () => {
    // Mi-Éclosion, midi : la courbe pose la plaine à +8 °C (au-dessus de la limite de neige,
    // +4) et le Névé à +8 + BIOME_OFFSET[neige] = −8, bien dessous. Le socle est une COURBE du
    // jour de l'année depuis S4 : ce n'est plus `BASE` qu'on lit, c'est `socleDuJour`.
    const sim = simDeuxClimats(MI_ECLOSION, false)
    const socle = socleDuJour(MI_ECLOSION, 1)
    expect(dehorsSansMeteo(sim, 9.5, 20.5, sim.tick)).toBe(socle) // midi, plaine : ni nuit ni biome
    const neve = TEMPERATURE.BIOME_OFFSET[TERRAIN_SNOW]
    expect(neve, 'le Névé doit AVOIR un offset de biome, sinon la garde ne compare rien').toBeLessThan(0)
    expect(dehorsSansMeteo(sim, 29.5, 20.5, sim.tick)).toBe(socle + neve!)
    expect(meteoAspectAt(sim, 9.5, 20.5)).toBe('pluie')
    expect(meteoAspectAt(sim, 29.5, 20.5)).toBe('neige')
  })

  it('sur la MÊME plaine des PLUIES : pluie de jour, neige de nuit — l’heure suffit', () => {
    // Mi-Pluies : +8 °C le jour, −2 la nuit (l'écart saisonnier vaut 10 à l'équinoxe, S5) —
    // la limite de neige (+4) passe entre les deux, et c'est l'HEURE qui décide.
    expect(meteoAspectAt(simDeuxClimats(MI_PLUIES, false), 9.5, 20.5)).toBe('pluie') // +8 °C ≥ la limite
    expect(meteoAspectAt(simDeuxClimats(MI_PLUIES, true), 9.5, 20.5)).toBe('neige') // −2 °C, dessous
  })

  it('BALAYAGE — l’aspect est `neige` exactement là où `neigeA(T₀)`, sur toute la carte et sur les quatre saisons', () => {
    let vus = 0
    let neiges = 0
    for (const jour of [MI_ECLOSION, MI_ARDEUR, MI_PLUIES, MI_GRAND_FROID]) {
      for (const nuit of [false, true]) {
        const sim = simDeuxClimats(jour, nuit)
        for (let tx = 0.5; tx < LARGE_DEUX_CLIMATS; tx += 0.5) {
          // LA PRÉMISSE, AFFIRMÉE POINT PAR POINT : le balayage ne saute aucun bord parce que
          // la bande les couvre tous — sans quoi l'aspect y serait `null` et la garde se
          // dégraderait en silence (le pire mode d'échec d'un balayage).
          expect(meteoIntensity(sim, tx, 20.5), `hors bande, x=${tx}`).toBeGreaterThan(0)
          const t0 = dehorsSansMeteo(sim, tx, 20.5, sim.tick)
          const attendu = neigeA(t0) ? 'neige' : 'pluie'
          expect(meteoAspectAt(sim, tx, 20.5), `jour ${jour}, nuit ${nuit}, x=${tx}`).toBe(attendu)
          vus++
          if (attendu === 'neige') neiges++
        }
      }
    }
    // La garde prouve sa prémisse : les DEUX aspects ont été vus, et pas qu'une poignée de fois.
    expect(vus).toBeGreaterThan(200)
    expect(neiges).toBeGreaterThan(0)
    expect(neiges).toBeLessThan(vus)
  })

  it('`neigeAuSol` n’accumule QUE sous la neige : là où il PLEUT sur la plaine, il NEIGE sur le Névé', () => {
    // Le front rembobiné d'un vrai cycle (l'élection, pas un front fabriqué), lu bien après sa
    // sortie sur les deux climats.
    //
    // ON CHERCHE LE JOUR AU LIEU DE LE SUPPOSER (patron `fabriqueOrage`/`jourDeBlizzard`) :
    // sous une COURBE continue, le contraste « pluie sur la plaine, neige sur le Névé »
    // n'appartient plus à une saison entière. Il vit sur la fenêtre où le socle de NUIT est
    // encore au-dessus de la limite (la plaine ne neige à AUCUNE heure) et où le socle de JOUR
    // moins l'offset du Névé est déjà dessous (le Névé neige à TOUTE heure). Un jour écrit en
    // dur redeviendrait faux au premier recalibrage de la courbe.
    //
    // DEPUIS R14 LES DEUX BORNES SONT CELLES DU GRÉSIL, pas la limite : « au-dessus de la
    // limite » ne veut plus dire « rien au sol », il veut dire « moins de la moitié ». Le
    // contraste FRANC — rien d'un côté, tout de l'autre — vit une demi-rampe plus loin de
    // chaque côté. C'est exactement ce que la zone de grésil a coûté à cette garde, et le
    // `vu > 0` final affirme qu'il reste des jours pour la tenir.
    const LIMITE = METEO.SEUIL_NEIGE + METEO.COLD.pluie
    const SEC = LIMITE + METEO.NEIGE_RAMPE / 2 // au-dessus : `partDeNeige` vaut 0, il PLEUT
    const BLANC = LIMITE - METEO.NEIGE_RAMPE / 2 // en dessous : elle vaut 1, il NEIGE
    const neve = TEMPERATURE.BIOME_OFFSET[TERRAIN_SNOW]!
    const contraste = (jour: number): boolean =>
      socleDuJour(jour, 1) - TEMPERATURE.ECART_NUIT(jour) >= SEC && socleDuJour(jour, 1) + neve <= BLANC

    const map = createEmptyMap(120, 40, TERRAIN_GRASS)
    for (let ty = 0; ty < 40; ty++) for (let tx = 60; tx < 120; tx++) setTile(map, tx, ty, TERRAIN_SNOW)
    const sim = createSim(11, { map, calendarScale: SCALE, meteoActive: true })
    let vu = 0
    for (let c = 0; c < YEAR_DAYS; c++) {
      if (!contraste(c + 1)) continue
      const f = frontDuCycle(c, SCALE, sim.jourDeDepart)
      if (!f || (f.type !== 'pluie' && f.type !== 'orage')) continue
      sim.tick = f.endTick + 200
      // Les deux prémisses, RELUES sur le monde au tick de lecture : la plaine est au-dessus
      // de la limite, le Névé dessous. Sans elles, un « 0 » sur la plaine ne dirait rien.
      expect(dehorsSansMeteo(sim, 20.5, 20.5, sim.tick), `plaine, cycle ${c}`).toBeGreaterThanOrEqual(SEC)
      expect(dehorsSansMeteo(sim, 90.5, 20.5, sim.tick), `Névé, cycle ${c}`).toBeLessThanOrEqual(BLANC)
      expect(neigeAuSol(sim, 20, 20), `plaine, cycle ${c}`).toBe(0) // il a PLU : rien au sol
      expect(neigeAuSol(sim, 90, 20), `Névé, cycle ${c}`).toBeGreaterThan(0) // il a NEIGÉ
      vu++
    }
    expect(vu).toBeGreaterThan(0) // la garde prouve sa prémisse : l'année a bien de tels fronts
  })
})

describe('A16 — la neige est une PART, pas un oui/non (R14)', () => {
  const LIMITE = METEO.SEUIL_NEIGE + METEO.COLD.pluie
  const DEMI = METEO.NEIGE_RAMPE / 2

  it('BALAYAGE du domaine de T₀ : 1 en dessous, 0 au-dessus, monotone entre — et `neigeA` en est le passage à 0,5', () => {
    let plein = 0
    let nul = 0
    let gresil = 0
    let precedent = 1
    // Pas de 0,125 : exactement représentable en binaire, donc aucun point ne tombe à un
    // cheveu de la limite — l'équivalence `neigeA ⟺ part > 0,5` s'affirme sans zone grise.
    for (let t0 = LIMITE - 3 * DEMI; t0 <= LIMITE + 3 * DEMI; t0 += 0.125) {
      const p = partDeNeige(t0)
      expect(p, `t0=${t0}`).toBeGreaterThanOrEqual(0)
      expect(p, `t0=${t0}`).toBeLessThanOrEqual(1)
      expect(p, `t0=${t0}`).toBeLessThanOrEqual(precedent) // décroissante en T₀, sans exception
      precedent = p
      if (t0 <= LIMITE - DEMI) { expect(p, `t0=${t0}`).toBe(1); plein++ }
      if (t0 >= LIMITE + DEMI) { expect(p, `t0=${t0}`).toBe(0); nul++ }
      if (p > 0 && p < 1) gresil++
      // LE SEUIL D'AVANT EST LE MILIEU DE LA PENTE — une loi, deux écritures, jamais deux lois.
      expect(neigeA(t0), `t0=${t0}`).toBe(p > 0.5)
    }
    // La garde prouve sa prémisse : les TROIS régimes ont été vus, et pas une fois chacun.
    expect(plein).toBeGreaterThan(10)
    expect(nul).toBeGreaterThan(10)
    expect(gresil).toBeGreaterThan(10)
    expect(partDeNeige(LIMITE)).toBe(0.5) // la limite est le point à moitié, par construction
  })

  it('LA MARCHE DE BIOME LA PLUS LARGE DE LA VALLÉE ne fait pas basculer le ciel à elle seule', () => {
    // C'EST LA GARDE QUI COMPTE, et elle regarde `BIOME_OFFSET`, pas la rampe : le défaut
    // corrigé est géométrique (six pas de marais vers pré retournaient tout le ciel), et il
    // reviendrait à l'identique — sous le nom de « pente » — si la rampe redescendait à la
    // taille d'une marche. Les GATES de froid sont hors jeu : la neige (−16) et le glacier
    // (−30) sont des changements de climat, pas des lisières qu'on traverse en marchant.
    const gates: number[] = [TERRAIN_SNOW, TERRAIN_GLACIER]
    const vallee = Object.entries(TEMPERATURE.BIOME_OFFSET)
      .filter(([id]) => !gates.includes(Number(id)))
      .map(([, v]) => v)
    // Le sol nu (0) participe : il n'a pas d'entrée dans la table, c'est le repli `?? 0`.
    const marche = Math.max(0, ...vallee) - Math.min(0, ...vallee)
    expect(marche).toBe(4) // forêt (+2) contre marais (−2) — la plus large de la vallée
    // Au plus DEUX TIERS du mélange par marche : la lisière devient une transition.
    expect(marche).toBeLessThanOrEqual(METEO.NEIGE_RAMPE * 2 / 3)
  })

  it('LE CAS SIGNALÉ — le pré est SOUS la limite de neige de moins d’une demi-rampe : il s’y dépose du grésil, et le marais en reçoit plus', () => {
    // Le scénario d'Alexis, en test : une lisière marais/pré, un front qui précipite dessus.
    //
    // CE QUI DISCRIMINE LES DEUX LOIS, et rien d'autre ne le fait : on CHERCHE un front dont
    // toute la traversée laisse le pré dans la MOITIÉ HAUTE de la zone de grésil (`T₀` entre
    // la limite et une demi-rampe au-dessus, à chaque instant de la fenêtre — brume comprise,
    // puisqu'on relit `dehorsSansMeteo` et non le socle). Sous l'ancien oui/non, `neigeA` y est
    // FAUX partout : le dépôt vaut exactement 0. Sous R14 il vaut la part, donc > 0 — et le
    // marais, deux degrés plus froid, en reçoit strictement plus. C'est la MÊME tuile, le
    // MÊME front : seule la loi change.
    const map = createEmptyMap(120, 40, TERRAIN_GRASS)
    for (let ty = 0; ty < 40; ty++) for (let tx = 60; tx < 120; tx++) setTile(map, tx, ty, TERRAIN_MARSH)
    const sim = createSim(11, { map, calendarScale: SCALE, meteoActive: true })
    const MARGE = 0.25 // on se tient à l'écart des deux bords : aucune tranche ne les frôle
    let trouve = 0
    for (let c = 0; c < YEAR_DAYS; c++) {
      const f = frontDuCycle(c, SCALE, sim.jourDeDepart)
      if (!f || (f.type !== 'pluie' && f.type !== 'orage')) continue
      // LA PRÉMISSE, RELUE SUR LE MONDE le long de toute la fenêtre du front — deux moitiés :
      //   • JAMAIS sous la limite : `neigeA` est faux à chaque tranche, donc l'ancienne loi
      //     dépose EXACTEMENT zéro sur le pré. C'est ce qui rend le `> 0` discriminant.
      //   • AU MOINS UNE FOIS dans la zone de grésil : il y a quelque chose à déposer.
      // Elle se lit SUR LES SEULS INSTANTS OÙ LA BANDE COUVRE LA TUILE (`meteoIntensityAt` > 0 —
      // la fonction de la sim, pas une copie) : c'est cette fenêtre-là que `neigeAuSol` intègre,
      // et pas la fenêtre du front, qui est bien plus longue.
      let jamaisSousLaLimite = true
      let dansLeGresil = 0
      let couvert = 0
      for (let i = 0; i <= 60; i++) {
        const t = f.startTick + Math.round(((f.endTick - f.startTick) * i) / 60)
        if (meteoIntensityAt(f, t, 120, 40, 20.5, 20.5) <= 0) continue
        couvert++
        const t0 = dehorsSansMeteo(sim, 20.5, 20.5, t)
        if (t0 <= LIMITE + MARGE) jamaisSousLaLimite = false
        if (t0 < LIMITE + DEMI - MARGE) dansLeGresil++
      }
      // ⚠ UN SEUL ÉCHANTILLON DANS LA BANDE NE SUFFIT PAS, et c'est ce qui a rougi le
      // 2026-08-26 quand la journée a pris les heures de la France : `neigeAuSol` intègre par
      // TRANCHES, une grille bien plus grossière que ces soixante points. Un instant de grésil
      // qu'aucune tranche ne visite dépose zéro — la prémisse était vraie, la conclusion
      // fausse, et la garde accusait la loi. On exige donc que le pré passe UN TIERS de sa
      // couverture dans la bande : n'importe quelle grille d'intégration l'y trouve.
      if (couvert < 4 || !jamaisSousLaLimite || dansLeGresil * 3 < couvert) continue
      sim.tick = f.endTick + 200
      const pre = neigeAuSol(sim, 20, 20)
      const marais = neigeAuSol(sim, 90, 20)
      expect(pre, `pré, cycle ${c}`).toBeGreaterThan(0) // 0 sous l'ancienne loi : rien n'y neigeait
      expect(marais, `marais, cycle ${c}`).toBeGreaterThan(pre) // deux degrés plus froid
      expect(pre, `pré, cycle ${c}`).toBeLessThan(1) // du GRÉSIL, pas une vraie neige
      trouve++
    }
    // La garde prouve sa prémisse : l'année porte de tels fronts.
    expect(trouve).toBeGreaterThan(0)
  })
})

describe('A13 — le refroidissement éolien est une PENTE bornée et monotone (R12)', () => {
  it('BALAYAGE de tout le domaine de `T₀` : 1 sous la limite, 0 au-dessus, monotone entre', () => {
    const haut = METEO.SEUIL_NEIGE + METEO.COLD.pluie // au-dessus, un orage est une pluie violente
    const bas = haut - METEO.BLIZZARD_RAMPE // en dessous, c'est le blizzard d'avant
    expect(partDeBlizzard(haut)).toBe(0)
    expect(partDeBlizzard(bas)).toBe(1)
    let prec = partDeBlizzard(TEMPERATURE.AMBIANT_MIN)
    expect(prec).toBe(1)
    let vuIntermediaire = 0
    for (let t = TEMPERATURE.AMBIANT_MIN; t <= TEMPERATURE.AMBIANT_MAX; t += 0.1) {
      const u = partDeBlizzard(t)
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(1)
      expect(u, `T₀=${t}`).toBeLessThanOrEqual(prec + 1e-12) // MONOTONE décroissante, partout
      if (u > 0 && u < 1) vuIntermediaire++
      prec = u
    }
    expect(vuIntermediaire).toBeGreaterThan(10) // la pente EXISTE : ce n'est pas un seuil déguisé
  })

  it('un ORAGE D’ÉTÉ ne mord pas plus qu’une averse — même la NUIT du cœur de l’Ardeur', () => {
    // La nuit d'été est le pire cas de la saison chaude, et c'est là que la garde compte : la
    // courbe pose la plaine à +26 le jour et l'écart de nuit saisonnier (S5) n'en retire que 6
    // — +20 °C, très au-dessus de la limite de neige. `partDeBlizzard` reste à zéro : l'orage ne
    // retranche que sa ligne DOUCE. Sans S5 (un écart fixe à 12), la nuit d'Ardeur tomberait
    // à +14 et la pente commencerait à mordre.
    const sim = createSim(3, { map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    sim.tick = tickMinuitDuJour(MI_ARDEUR)
    const D = METEO.TRAVERSEE_TICKS
    sim.meteo = { type: 'orage', cycle: MI_ARDEUR - 1, day: MI_ARDEUR, edge: 0, startTick: sim.tick - Math.floor(D / 2), endTick: sim.tick + Math.ceil(D / 2) }
    expect(meteoIntensity(sim, 200.5, 20.5)).toBe(1) // au cœur
    const nuitDArdeur = socleDuJour(MI_ARDEUR, 1) - TEMPERATURE.ECART_NUIT(MI_ARDEUR)
    expect(dehorsSansMeteo(sim, 200.5, 20.5, sim.tick)).toBe(nuitDArdeur) // +20 °C
    expect(partDeBlizzard(nuitDArdeur)).toBe(0) // la pente R12 est à zéro : l'orage est une averse
    expect(baselineTemperature(sim, 200.5, 20.5)).toBe(nuitDArdeur - METEO.COLD.orage)
    expect(meteoColdAt(sim, 200.5, 20.5, sim.tick)).toBe(METEO.COLD.orage)
  })

  it('le MÊME orage, au cœur du Grand Froid et de JOUR, retranche la ligne `ORAGE_FROID` — et passe sous l’hypothermie', () => {
    const sim = createSim(3, { map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    sim.tick = tickMidiDuJour(MI_GRAND_FROID)
    const D = METEO.TRAVERSEE_TICKS
    sim.meteo = { type: 'orage', cycle: MI_GRAND_FROID - 1, day: MI_GRAND_FROID, edge: 0, startTick: sim.tick - Math.floor(D / 2), endTick: sim.tick + Math.ceil(D / 2) }
    expect(meteoIntensity(sim, 200.5, 20.5)).toBe(1)
    expect(dehorsSansMeteo(sim, 200.5, 20.5, sim.tick)).toBe(socleDuJour(MI_GRAND_FROID, 1)) // −2 °C, le cardinal
    expect(meteoColdAt(sim, 200.5, 20.5, sim.tick)).toBe(METEO.ORAGE_FROID.COLD)
    expect(baselineTemperature(sim, 200.5, 20.5)).toBeLessThan(AMBIANT_HYPOTHERMIE)
  })
})

describe('A14 — la GÉOMÉTRIE du front est un réglage de SAISON (S7 ; R13 est retirée)', () => {
  it('la largeur ne lit plus le FROID : même phase, autre tour — le socle glisse, la largeur ne bouge pas', () => {
    // R13 faisait interpoler la largeur d'un orage sur `ACT_COLD(acte) / plafond`. S7 la
    // RETIRE et la remplace par une table par saison. La garde qui sépare les deux : prendre
    // deux tours de la MÊME phase là où S12 fait glisser le cardinal (les Pluies perdent deux
    // degrés par an). Si la largeur suivait encore le froid, elle bougerait avec lui.
    const anSuivant = MI_PLUIES + YEAR_DAYS
    expect(socleDuJour(anSuivant, 2)).toBeLessThan(socleDuJour(MI_PLUIES, 1)) // la prémisse : le froid GLISSE
    for (const type of ['pluie', 'brouillard', 'orage', 'vent_de_cendre'] as const) {
      expect(largeurDe({ type, day: anSuivant }), type).toBe(largeurDe({ type, day: MI_PLUIES }))
      expect(fenetreDe({ type, day: anSuivant }), type).toBe(fenetreDe({ type, day: MI_PLUIES }))
    }
  })

  it('elle est CYCLIQUE — l’Éclosion de l’an 2 est une Éclosion, sur toute classe et tout jour', () => {
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      for (const type of ['pluie', 'brouillard', 'orage', 'vent_de_cendre'] as const) {
        expect(largeurDe({ type, day: jour + YEAR_DAYS }), `${type} au jour ${jour}`)
          .toBe(largeurDe({ type, day: jour }))
        expect(fenetreDe({ type, day: jour + YEAR_DAYS }), `${type} au jour ${jour}`)
          .toBe(fenetreDe({ type, day: jour }))
      }
    }
  })

  it('l’identité de chaque saison SE LIT dans la géométrie : l’orage sec est bref, l’hiver couvre, l’automne dure', () => {
    // Les ordres de grandeur que S7 tranche, dits comme des RANGS plutôt que recopiés de la
    // table : l'Ardeur cogne sur une bande étroite (« une minute — la foudre sans l'eau »),
    // le Grand Froid déroule le « carte entière » du blizzard, et les Pluies occupent le
    // cycle ENTIER (« il pleut du matin au soir »).
    const orage = (jour: number): number => largeurDe({ type: 'orage', day: jour })
    expect(orage(MI_ARDEUR)).toBeLessThan(orage(MI_ECLOSION))
    expect(orage(MI_ECLOSION)).toBeLessThan(orage(MI_GRAND_FROID))
    // La fenêtre suit la même logique : un demi-cycle en été, trois quarts en hiver, le cycle
    // entier à l'automne — et jamais plus (l'unicité du front en dépend, garde A9).
    expect(fenetreDe({ type: 'pluie', day: MI_ARDEUR })).toBeLessThan(fenetreDe({ type: 'pluie', day: MI_GRAND_FROID }))
    expect(fenetreDe({ type: 'pluie', day: MI_GRAND_FROID })).toBeLessThan(fenetreDe({ type: 'pluie', day: MI_PLUIES }))
    expect(fenetreDe({ type: 'pluie', day: MI_PLUIES })).toBe(TICKS_PER_CYCLE)
  })

  it('la GÉOMÉTRIE la lit — un orage du Grand Froid couvre la VALLÉE ENTIÈRE, celui de l’Ardeur non', () => {
    // Mesuré sur `frontMeteoPos`, pas sur la table : à mi-traversée d'une carte à l'échelle de
    // la vallée jouée (~1580 de large), la bande d'hiver ne laisse AUCUN point à découvert —
    // « trop large pour être esquivé, la réponse est PRÉPARER » (R9) — quand celle d'été en
    // laisse la plus grande part au clair.
    const [W, H] = [1580, 1580]
    const couverture = (jour: number): number => {
      const D = METEO.TRAVERSEE_TICKS
      const f: MeteoFront = { type: 'orage', cycle: jour - 1, day: jour, edge: 0, startTick: 0, endTick: D }
      let couverts = 0
      for (let x = 0.5; x < W; x += 1) if (meteoIntensityAt(f, Math.floor(D / 2), W, H, x, 790.5) > 0) couverts++
      return couverts / W
    }
    expect(couverture(MI_GRAND_FROID)).toBe(1)
    expect(couverture(MI_ARDEUR)).toBeLessThan(0.1)
  })
})
