/**
 * LA MÉTÉO (spec `meteo.md`) — tranche 1 : les critères A1, A2, A9, A10 du front inerte,
 * plus la pureté de la géométrie et la distribution des types par acte. Tranche 2 : le
 * FROID des fronts (R4, critère A3) — section « R4 — le froid des fronts », patron des
 * tests thermiques A4/A5 de la Brume. Tranche 3 : LA FAUNE SE TERRE (R6, critère A5) —
 * section en fin de fichier, prédicat `meteoQuiet` + le comportement calqué sur les
 * gardes A17 de faune.test.ts.
 *
 * Le calendrier est couplé 1 jour = 1 cycle (`calendarScaleForSeasonCycles`) : l'aube du
 * cycle c EST le jour c+1, et on SAUTE aux bords de cycle (le tick se pose, puis `step()`
 * joue le tick entier — jamais une phase seule ; patron brume.test.ts). Les élections sont
 * des fonctions pures du JOUR (`hash2`) : les comptes ci-dessous sont DÉTERMINISTES —
 * relevés à la sonde, pas espérés statistiquement.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, CENDREUX, FAUNA, METEO, TEMPERATURE, TERRAIN_GRASS } from './balance'
import { brumeJourEligible } from './brume'
import { drainEvents } from './events'
import { fireActive, fireState, fireWarmthFactor, fuelTicksRemaining } from './fire'
import { countOf } from './items'
import { createEmptyMap } from './map'
import {
  advanceMeteo, frontMeteoPos, meteoFeuConso, meteoIntensity, meteoJourEligible, meteoMouille, meteoQuiet,
  meteoTypeBrut, type BandeMeteo, type MeteoFront, type MeteoType,
} from './meteo'
import { createSim, snapshot, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { advanceTemperature, ambientTemperature, baselineTemperature, isSheltered } from './temperature'
import {
  actForDay, calendarScaleForSeasonCycles, cycleOffsetForStartHour, DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE,
} from './time'
import { addStructure, applyVillageAction, grantItems, structureAt } from './village'
import { foundNpcVillage } from './worldgen'

/** 1 jour de saison = 1 cycle : l'aube du cycle c est le jour c+1. */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

function tickAubeDuJour(day: number): number {
  return (day - 1) * TICKS_PER_CYCLE
}

function simMeteo(seed = 2026, meteoActive = true): SimState {
  return createSim(seed, { map: createEmptyMap(70, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive })
}

/** Joue l'élection de chaque jour par SAUTS d'aube et relève les fronts élus. */
function frontsDeSaison(sim: SimState, jours = BALANCE.SEASON_DAYS): MeteoFront[] {
  const fronts: MeteoFront[] = []
  for (let d = 1; d <= jours; d++) {
    sim.tick = tickAubeDuJour(d)
    step(sim, [])
    if (sim.meteo) fronts.push({ ...sim.meteo })
  }
  return fronts
}

describe('A1 — même seed, mêmes élections', () => {
  it('types, bords et fenêtres identiques sur 60 jours ; état bit-identique au rejeu', () => {
    const a = simMeteo()
    const fa = frontsDeSaison(a)
    const b = simMeteo()
    const fb = frontsDeSaison(b)
    expect(fa.length).toBeGreaterThan(0) // la saison a bien une météo — sinon on ne mesure rien
    expect(fa).toEqual(fb)
    expect(snapshot(a)).toBe(snapshot(b))
  })

  it('un front paraît EXACTEMENT les jours que `meteoJourEligible` élit — jamais un autre', () => {
    const sim = simMeteo()
    for (let d = 1; d <= BALANCE.SEASON_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      step(sim, [])
      expect(sim.meteo !== null && sim.meteo !== undefined).toBe(meteoJourEligible(d))
      if (sim.meteo) expect(sim.meteo.day).toBe(d)
    }
  })

  it('l’élection du jour est gardée par `lastMeteoDay` : rejouée au même tick, elle ne bouge plus', () => {
    const sim = simMeteo()
    const d = [...Array(60)].findIndex((_, i) => meteoJourEligible(i + 1)) + 1
    sim.tick = tickAubeDuJour(d)
    advanceMeteo(sim)
    expect(sim.meteo?.day).toBe(d)
    const apres = snapshot(sim)
    advanceMeteo(sim)
    expect(snapshot(sim)).toBe(apres)
  })
})

describe('A2 — zéro tirage sur le PRNG d’état', () => {
  it('le flux RNG est bit-identique météo armée ou pas, sur une saison entière', () => {
    const avec = simMeteo(2026, true)
    const sans = simMeteo(2026, false)
    let fronts = 0
    for (let d = 1; d <= BALANCE.SEASON_DAYS; d++) {
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
  it('la traversée tient dans le cycle — la construction qui rend le chevauchement impossible', () => {
    expect(METEO.TRAVERSEE_TICKS).toBeLessThanOrEqual(TICKS_PER_CYCLE)
    expect(METEO.TRAVERSEE_TICKS).toBeGreaterThan(0)
  })

  it('saison × 3 seeds : les fenêtres élues ne se chevauchent jamais', () => {
    for (const seed of [1, 7, 2026]) {
      const fronts = frontsDeSaison(simMeteo(seed))
      expect(fronts.length).toBeGreaterThan(0)
      for (let i = 1; i < fronts.length; i++) {
        expect(fronts[i]!.startTick).toBeGreaterThanOrEqual(fronts[i - 1]!.endTick)
      }
    }
  })

  it('R3 — un jour éligible à la Brume n’élit JAMAIS un blizzard : il se dégrade en neige', () => {
    const sim = simMeteo()
    let degrades = 0
    for (let d = 1; d <= 600; d++) {
      sim.tick = tickAubeDuJour(d)
      advanceMeteo(sim)
      const front = sim.meteo
      if (!front || front.day !== d) continue
      if (brumeJourEligible(d)) {
        expect(front.type).not.toBe('blizzard')
        if (meteoTypeBrut(d) === 'blizzard') {
          expect(front.type).toBe('neige')
          degrades++
        }
      } else {
        expect(front.type).toBe(meteoTypeBrut(d)) // hors Brume, l'élu brut passe tel quel
      }
    }
    // La règle a MORDU : le domaine balayé contient de vrais jours blizzard × Brume
    // (76 relevés à la sonde) — sinon ce test mesurerait l'instrument, pas la règle.
    expect(degrades).toBeGreaterThan(0)
  })
})

describe('A10 — l’interrupteur dédié, faux par défaut', () => {
  it('sans `meteoActive`, advanceMeteo ne touche pas UN octet de l’état — sur toute la saison', () => {
    const sim = createSim(2026, { map: createEmptyMap(70, 40, TERRAIN_GRASS), calendarScale: SCALE })
    expect('meteoActive' in sim).toBe(false) // la clé n'existe même pas : l'empreinte d'avant le système
    for (let d = 1; d <= BALANCE.SEASON_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      const avant = snapshot(sim)
      advanceMeteo(sim)
      expect(snapshot(sim)).toBe(avant) // le module dans la boucle EST le module hors de la boucle
    }
    expect(sim.meteo ?? null).toBeNull()
    expect(sim.lastMeteoDay).toBeUndefined()
  })

  it('une saison entière au step, météo éteinte : jamais de front', () => {
    const sim = simMeteo(2026, false)
    for (let d = 1; d <= BALANCE.SEASON_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      step(sim, [])
    }
    expect(sim.meteo ?? null).toBeNull()
    expect(sim.lastMeteoDay).toBeUndefined()
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
    for (let d = 1; d <= BALANCE.SEASON_DAYS; d++) {
      sim.tick = tickAubeDuJour(d)
      step(sim, [])
      if (sim.meteo) elu++
    }
    expect(elu).toBeGreaterThan(0)
  })
})

describe('la géométrie est pure — la bande se calcule du tick, elle n’est jamais rangée', () => {
  const DUR = METEO.TRAVERSEE_TICKS
  const fabrique = (edge: MeteoFront['edge']): MeteoFront => ({
    type: 'pluie', day: 30, edge, startTick: 1000, endTick: 1000 + DUR,
  })

  it('les 4 bords : bord AVANT au bord d’entrée au startTick, bande sortie au endTick, linéaire entre', () => {
    const [W, H] = [90, 200]
    for (const edge of [0, 1, 2, 3] as const) {
      const f = fabrique(edge)
      const versPositif = edge === 0 || edge === 2
      const axis = edge <= 1 ? 'x' : 'y'
      const span = axis === 'x' ? W : H
      const largeur = METEO.LARGEUR.pluie

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
    const largeur = METEO.LARGEUR.pluie
    const rampe = METEO.RAMPE * largeur
    sim.meteo = { type: 'pluie', day: 30, edge: 0, startTick: 0, endTick: METEO.TRAVERSEE_TICKS }
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
    const rampe = METEO.RAMPE * METEO.LARGEUR.pluie
    sim.meteo = { type: 'pluie', day: 30, edge: 3, startTick: 0, endTick: METEO.TRAVERSEE_TICKS }
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
    sim.meteo = { type: 'pluie', day: 30, edge: 0, startTick: 5000, endTick: 5000 + METEO.TRAVERSEE_TICKS }
    for (const tick of [0, 4999, 5000 + METEO.TRAVERSEE_TICKS]) {
      sim.tick = tick
      for (let x = 0; x < 90; x += 3) expect(meteoIntensity(sim, x, 100)).toBe(0)
    }
  })
})

describe('la distribution des types par acte (élections déterministes du jour)', () => {
  it('acte I sans neige ni blizzard et pluie en tête ; acte III aux neiges et blizzards — 3 seeds', () => {
    const compte = (fronts: MeteoFront[], acte: number, type: MeteoType): number =>
      fronts.filter((f) => actForDay(f.day) === acte && f.type === type).length
    for (const seed of [1, 7, 2026]) {
      const fronts = frontsDeSaison(simMeteo(seed))
      const acte1 = fronts.filter((f) => actForDay(f.day) === 1)
      expect(acte1.length).toBeGreaterThan(0)
      expect(compte(fronts, 1, 'neige') + compte(fronts, 1, 'blizzard')).toBe(0)
      expect(compte(fronts, 1, 'pluie')).toBeGreaterThanOrEqual(compte(fronts, 1, 'brouillard'))
      expect(compte(fronts, 1, 'pluie')).toBeGreaterThanOrEqual(compte(fronts, 1, 'orage'))
      const acte3 = fronts.filter((f) => actForDay(f.day) === 3)
      expect(acte3.length).toBeGreaterThan(0)
      expect(compte(fronts, 3, 'neige') + compte(fronts, 3, 'blizzard')).toBeGreaterThan(acte3.length / 2)
    }
  })
})

describe('R4 — le froid des fronts (A3)', () => {
  /**
   * Un front posé À LA MAIN au midi du jour 25 — acte II, plein JOUR, plaine `grass`
   * (patron de la nappe statique des tests Brume). `u` est la fraction de traversée
   * écoulée : elle place la bande où le test la veut. Le tick ne bouge pas pendant les
   * boucles d'`advanceTemperature` : la bande non plus.
   */
  function simSousFront(type: MeteoType, u: number): { sim: SimState; bande: BandeMeteo } {
    const sim = createSim(7, { map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    const midi = 24 * TICKS_PER_CYCLE + Math.floor(DAY_TICKS_PER_CYCLE / 2)
    const startTick = midi - Math.round(u * METEO.TRAVERSEE_TICKS)
    sim.tick = midi
    sim.meteo = { type, day: 25, edge: 0, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
    return { sim, bande: frontMeteoPos(sim.meteo, midi, sim.map.width, sim.map.height)! }
  }

  /** Le blizzard aux 16 % de sa traversée : son CŒUR (intensité 1) couvre l'ouest de la
   *  carte, son bord de fuite passe vers x≈320 — l'est est encore HORS bande. Les deux
   *  régimes coexistent sur la carte, et la prémisse se PROUVE à chaque montage. */
  function simSousBlizzard(): { sim: SimState; coeur: number; hors: number } {
    const { sim, bande } = simSousFront('blizzard', 0.16)
    const coeur = 40.5
    const hors = 380.5
    expect(meteoIntensity(sim, coeur, 20.5)).toBe(1)
    expect(meteoIntensity(sim, hors, 20.5)).toBe(0)
    expect(bande.hi).toBeLessThan(hors) // le refuge est DEVANT le front, pas dans son dos
    return { sim, coeur, hors }
  }

  it('A3 — au cœur du blizzard, la plaine de JOUR devient létale en acte II ; en sortir laisse fuir', () => {
    const { sim, coeur, hors } = simSousBlizzard()
    // 90 − 25 − 55 = 10 < HYPOTHERMIA (l'arithmétique de la spec R4) ; à côté, la plaine reste douce.
    expect(baselineTemperature(sim, coeur, 20.5)).toBeLessThan(TEMPERATURE.HYPOTHERMIA)
    expect(baselineTemperature(sim, hors, 20.5)).toBeGreaterThan(TEMPERATURE.COMFORT)

    const id = spawnEntity(sim, coeur, 20.5)
    const e = sim.entities.find((en) => en.id === id)!
    e.temperature = 25
    for (let i = 0; i < 2600; i++) advanceTemperature(sim)
    expect(e.temperature).toBeLessThan(TEMPERATURE.HYPOTHERMIA) // la dérive l'a mené sous le seuil…
    expect(e.hp).toBeLessThan(100) // …et les PV baissent
    expect(e.hp).toBeGreaterThan(0) // mais pas un couperet : il est encore debout

    // IL FUIT : hors bande la température REMONTE par la dérive, et les dégâts s'arrêtent.
    e.x = hors
    const tempFuite = e.temperature
    for (let i = 0; i < 1600; i++) advanceTemperature(sim)
    expect(e.temperature).toBeGreaterThan(tempFuite)
    expect(e.temperature).toBeGreaterThan(TEMPERATURE.HYPOTHERMIA)
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
    expect(baselineTemperature(sim, feu.tx + 0.5, feu.ty + 0.5)).toBeLessThan(TEMPERATURE.HYPOTHERMIA)
    // …mais l'ambiant est PLANCHERÉ par la bulle : le max ne peut pas descendre.
    expect(ambientTemperature(sim, feu.tx + 0.5, feu.ty + 0.5)).toBeGreaterThan(TEMPERATURE.HYPOTHERMIA)

    const id = spawnEntity(sim, feu.tx + 0.5, feu.ty + 0.5)
    const e = sim.entities.find((en) => en.id === id)!
    for (let i = 0; i < 4000; i++) advanceTemperature(sim)
    expect(e.temperature).toBeGreaterThan(TEMPERATURE.HYPOTHERMIA)
    expect(e.hp).toBe(100) // aucun dégât de froid dans la bulle
  })

  it('A3 planchers — la tenue d’hiver PLANCHE : jamais sous TENUE_FLOOR, zéro dégât', () => {
    // La calibration qui rend le plancher SÛR : au-dessus de l'hypothermie, donc sans dégât.
    expect(TEMPERATURE.TENUE_FLOOR).toBeGreaterThan(TEMPERATURE.HYPOTHERMIA)
    const { sim, coeur } = simSousBlizzard()
    const id = spawnEntity(sim, coeur, 20.5)
    const e = sim.entities.find((en) => en.id === id)!
    grantItems(sim, id, { tenue_hiver: 1 })
    e.temperature = 60
    for (let i = 0; i < 8000; i++) {
      advanceTemperature(sim)
      expect(e.temperature).toBeGreaterThanOrEqual(TEMPERATURE.TENUE_FLOOR) // JAMAIS sous le plancher
    }
    expect(e.temperature).toBeLessThan(45) // le blizzard a bien mordu : c'est le plancher qui a tenu
    expect(e.hp).toBe(100)
  })

  it('R4 gradient — traversée perpendiculaire : la température descend vers le cœur, remonte en face, jamais un mur', () => {
    const { sim, bande } = simSousFront('neige', 0.5)
    const rampe = METEO.RAMPE * METEO.LARGEUR.neige
    // La bande est ENTIÈREMENT sur la carte, cœur compris : le balayage traverse bien les
    // cinq régimes (dehors, rampe, cœur, rampe, dehors) — la prémisse de la garde exhaustive.
    expect(bande.lo).toBeGreaterThan(10)
    expect(bande.hi).toBeLessThan(sim.map.width - 10)
    expect(bande.hi - bande.lo).toBeGreaterThan(2 * rampe)

    const mid = (bande.lo + bande.hi) / 2
    const pas = 0.05
    const penteMax = METEO.COLD.neige * (pas / rampe) + 1e-9
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
    expect(baselineTemperature(sim, mid, 20.5)).toBe(baselineTemperature(sim, 2.5, 20.5) - METEO.COLD.neige)
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
    // Le gate feu-station S5 (`cendreuxStep`) lit `baselineTemperature` : au cœur d'un
    // blizzard le froid de base tombe sous COLD_ATTRACT_THRESHOLD, et un Cendreux pris
    // dedans peut ramper vers un feu allumé EN PLEIN JOUR — comportement assumé, le même
    // que sous la nappe (test R5 de brume.test.ts, calqué ici). Ce test l'ÉPINGLE : si un
    // calibrage de COLD.blizzard le faisait disparaître (ou l'étendait hors bande), on le
    // saurait — le froid météo MODULE le gate, il ne le casse pas.
    const { sim, coeur, hors } = simSousBlizzard()
    expect(baselineTemperature(sim, coeur, 20.5)).toBeLessThan(CENDREUX.COLD_ATTRACT_THRESHOLD)
    expect(baselineTemperature(sim, hors, 20.5)).toBeGreaterThanOrEqual(CENDREUX.COLD_ATTRACT_THRESHOLD)
  })
})

describe('R6 — la faune se terre (A5)', () => {
  /** Un front posé à la main au midi du jour 25, bande sur la carte à la fraction `u` de sa
   *  traversée (patron `simSousFront` de la section R4 — chaque section porte son montage). */
  function simSousFront(type: MeteoType, u: number): { sim: SimState; bande: BandeMeteo } {
    const sim = createSim(7, { map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true })
    const midi = 24 * TICKS_PER_CYCLE + Math.floor(DAY_TICKS_PER_CYCLE / 2)
    const startTick = midi - Math.round(u * METEO.TRAVERSEE_TICKS)
    sim.tick = midi
    sim.meteo = { type, day: 25, edge: 0, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
    return { sim, bande: frontMeteoPos(sim.meteo, midi, sim.map.width, sim.map.height)! }
  }

  it('sous une PLUIE active, le silence couvre la bande et RIEN qu’elle — balayage des deux côtés du bord', () => {
    const { sim, bande } = simSousFront('pluie', 0.5)
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
    const { sim } = simSousFront('pluie', 0.5)
    const front = sim.meteo!
    sim.tick = front.endTick // la fenêtre est close : le prédicat tombe AVANT même la purge
    for (let x = 0.5; x < sim.map.width; x += 2) expect(meteoQuiet(sim, x, 20.5)).toBe(false)
    advanceMeteo(sim) // l'ordonnanceur passe : le record est purgé
    expect(sim.meteo ?? null).toBeNull()
    for (let x = 0.5; x < sim.map.width; x += 2) expect(meteoQuiet(sim, x, 20.5)).toBe(false)
  })

  it('BROUILLARD — le gate est bit-identique à sans front : QUIET.brouillard est faux', () => {
    expect(METEO.QUIET.brouillard).toBe(false)
    const { sim, bande } = simSousFront('brouillard', 0.5)
    expect(meteoIntensity(sim, (bande.lo + bande.hi) / 2, 20.5)).toBe(1) // le front est bien LÀ…
    const front = sim.meteo ?? null
    for (let x = 0.5; x < sim.map.width; x += 0.5) {
      for (const y of [0.5, 20.5, 39.5]) {
        sim.meteo = front
        const avec = meteoQuiet(sim, x, y)
        sim.meteo = null
        expect(avec).toBe(meteoQuiet(sim, x, y)) // …et il ne fait taire PERSONNE, au bit près
      }
    }
  })

  it('A5 — Brume annoncée + pluie active : les points `faunaQuiet` tiennent PENDANT et APRÈS, advanceMeteo n’y touche jamais', () => {
    // Une carte À CENDRIÈRE (champ synthétique : distance = x, patron brume.test.ts) — la
    // Brume en a besoin ; la météo, non.
    const map = createEmptyMap(70, 40, TERRAIN_GRASS)
    map.cendre = []
    for (let y = 0; y < 40; y++) for (let x = 0; x < 70; x++) map.cendre.push(x)
    map.cendreMax = 8
    const sim = createSim(2026, { map, calendarScale: SCALE, meteoActive: true })

    // Le premier jour d'acte II-III que la Brume élit ; son annonce tombe au crépuscule.
    let d = 22
    while (d <= 54 && !brumeJourEligible(d)) d++
    sim.tick = (d - 1) * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE
    step(sim, [])
    expect(sim.brume?.phase).toBe('annoncee')
    expect(sim.faunaQuiet.length).toBeGreaterThanOrEqual(3) // les points du corridor sont posés
    const ref = JSON.stringify(sim.faunaQuiet)

    // Une pluie posée sur une fenêtre COMPRESSÉE, close avant le prochain bord de cycle :
    // aucun échantillon ne traverse une élection (la coexistence ne dépend pas de la durée
    // de la fenêtre — la géométrie est une fonction pure du record).
    const debut = sim.tick
    sim.meteo = { type: 'pluie', day: d, edge: 0, startTick: debut, endTick: debut + 14400 }
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
      cycleOffset: cycleOffsetForStartHour(12),
    })
    const ambients = (): number => sim.monsters.filter((m) => m.ambient).length
    const a = spawnEntity(sim, 80.5, 80.5)
    grantItems(sim, a, { tenue_hiver: 1 }) // le blizzard mord (T2) : la tenue PLANCHE — on mesure la faune, pas le froid
    let plafond = 0
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(sim, [])
      plafond = Math.max(plafond, ambients())
    }
    expect(plafond).toBeGreaterThanOrEqual(FAUNA.GROUND_CAP) // l'anneau s'est rempli : la précondition du gate

    // UN BLIZZARD — large comme la carte : l'anneau de naissance (±42) déborderait une
    // bande de pluie (60). Fenêtre COMPRESSÉE : la géométrie est pure, TRAVERSEE_TICKS est
    // le choix de l'ÉLECTION, pas de la géométrie. Posé pour couvrir TOUTE la carte
    // pendant la phase sous front, et sortir vite.
    const D = 2000
    const total = sim.map.width + METEO.LARGEUR.blizzard
    const startTick = sim.tick - Math.round((250 / total) * D) // avance ≈ 250 : carte couverte, marge aux deux bords
    sim.meteo = { type: 'blizzard', day: 1, edge: 0, startTick, endTick: startTick + D }
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

  /** Plaine nue au midi du jour 25 (patron des sections R4/R6), SANS front — les feux se
   *  posent à sec, la pluie arrive ensuite. `worldEvents: false` : un banc de FEU mesure
   *  le feu. Le tick est à mi-cycle : aucun bord d'élection dans les fenêtres mesurées. */
  function simCalme(): SimState {
    const sim = createSim(7, {
      map: createEmptyMap(400, 40, TERRAIN_GRASS), calendarScale: SCALE, meteoActive: true, worldEvents: false,
    })
    sim.tick = 24 * TICKS_PER_CYCLE + Math.floor(DAY_TICKS_PER_CYCLE / 2)
    return sim
  }

  /** Pose un front (bord ouest, fenêtre `D`) pour que sa bande, au tick COURANT, commence
   *  en `lo` — et le prouve (l'arrondi du startTick la décale d'un millième de tuile). */
  function poseFront(sim: SimState, type: MeteoType, lo: number, D = D_LENT): BandeMeteo {
    const largeur = METEO.LARGEUR[type]
    const u = (lo + largeur) / (sim.map.width + largeur)
    const startTick = sim.tick - Math.round(u * D)
    sim.meteo = { type, day: 25, edge: 0, startTick, endTick: startTick + D }
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

    // La pluie arrive sur `avec` : bande [95.5, 155.5], cœur [104.5, 146.5], rampe de 9.
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
    const rampe = METEO.RAMPE * METEO.LARGEUR.pluie
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
    const sim = simCalme()
    const id = poseur(sim, 200, 20, 1)
    poseFeu(sim, id, 200, 21)
    const feu = structureAt(sim.structures, 200, 21)!
    // Blizzard COMPRESSÉ (D = 4000) posé à mi-traversée : le cœur couvre déjà le feu, la
    // fenêtre restante (~2000 ticks) se joue en entier — « toute la traversée ».
    const D = 4000
    poseFront(sim, 'blizzard', -600, D)
    const finDeFenetre = sim.meteo!.endTick
    expect(meteoIntensity(sim, feu.tx, feu.ty)).toBe(1)
    drainEvents(sim)

    // Phase 1, encore au CŒUR (la bande avance de 0,5 tuile/tick) : ×FEU_CONSO.blizzard exact.
    const b0 = fuelTicksRemaining(sim.tick, feu)
    const N = 700
    for (let t = 0; t < N; t++) {
      step(sim, [])
      expect(fireState(sim, feu)).toBe('lit') // JAMAIS éteint par la météo
      expect(fireWarmthFactor(sim, feu)).toBeGreaterThan(0)
    }
    expect(meteoIntensity(sim, feu.tx, feu.ty)).toBe(1) // le cœur couvrait toute la phase mesurée
    expect(b0 - fuelTicksRemaining(sim.tick, feu)).toBe(N * METEO.FEU_CONSO.blizzard)

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
    // L'orage arrive, plein cœur sur le feu — là où la POSE d'un feu neuf serait refusée.
    poseFront(sim, 'orage', 95.5)
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
