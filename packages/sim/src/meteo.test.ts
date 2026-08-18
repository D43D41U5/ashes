/**
 * LA MÉTÉO, TRANCHE 1 (spec `meteo.md`) — les critères A1, A2, A9, A10 du front inerte,
 * plus la pureté de la géométrie et la distribution des types par acte.
 *
 * Le calendrier est couplé 1 jour = 1 cycle (`calendarScaleForSeasonCycles`) : l'aube du
 * cycle c EST le jour c+1, et on SAUTE aux bords de cycle (le tick se pose, puis `step()`
 * joue le tick entier — jamais une phase seule ; patron brume.test.ts). Les élections sont
 * des fonctions pures du JOUR (`hash2`) : les comptes ci-dessous sont DÉTERMINISTES —
 * relevés à la sonde, pas espérés statistiquement.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, METEO, TERRAIN_GRASS } from './balance'
import { brumeJourEligible } from './brume'
import { createEmptyMap } from './map'
import {
  advanceMeteo, frontMeteoPos, meteoIntensity, meteoJourEligible, meteoTypeBrut,
  type MeteoFront, type MeteoType,
} from './meteo'
import { createSim, snapshot, step, type SimState } from './sim'
import { actForDay, calendarScaleForSeasonCycles, TICKS_PER_CYCLE } from './time'

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
