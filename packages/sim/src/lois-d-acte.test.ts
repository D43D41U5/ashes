/**
 * LES LOIS D'ACTE (spec `saison-sans-fin.md` A1/A2/A3/A5, tranches T1-T2) — totales, cycliques,
 * plafonnées.
 *
 * Balayées sur 200 actes (50 ans), jamais sur trois cas choisis. Les paliers 1..3 sont épinglés à
 * des LITTÉRAUX, pas aux tables qu'on teste : « une garde écrite avec la constante qu'elle teste
 * ne garde rien » — et c'est ce qui a attrapé une inversion dans le plan (ALIGNMENT/FIRE_UPKEEP).
 *
 * A2 S'ÉNONCE SUR LE TOUR `k`, PAS SUR L'ACTE : l'arc oscille (décision d'Alexis 2026-08-21), une
 * loi cyclique n'est pas monotone en acte — c'est la concession assumée de l'option. À PHASE
 * fixée, elle monte d'année en année, atteint son plafond et n'en bouge plus.
 *
 * A3 n'est PAS testé ici : il se tient par le compilateur (une loi n'est pas indexable).
 */
import { describe, expect, it } from 'vitest'
import {
  ACTS_PER_YEAR, ALIGNMENT, BALANCE, BRUME, CENDREUX, FIRE_UPKEEP, METEO, NIGHT_HUNT, SEASON, TEMPERATURE,
  actLaw, actTable, phaseOf, tourOf, type ActLaw,
} from './balance'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step } from './sim'
import { actForDay, phaseForDay, tourForDay, YEAR_DAYS } from './time'

const ACTES_BALAYES = 200

/** Les huit lois numériques, avec leurs paliers ÉPINGLÉS (les valeurs du 2026-08-21). */
const LOIS: { nom: string; loi: ActLaw; paliers: readonly [number, number, number] }[] = [
  { nom: 'TEMPERATURE.ACT_COLD', loi: TEMPERATURE.ACT_COLD, paliers: [0, 25, 50] },
  { nom: 'BALANCE.ACT_HUNGER_FACTOR', loi: BALANCE.ACT_HUNGER_FACTOR, paliers: [1, 2, 3] },
  { nom: 'SEASON.REGROW_ACT_FACTOR', loi: SEASON.REGROW_ACT_FACTOR, paliers: [1, 1.5, 2] },
  { nom: 'ALIGNMENT.ACT_FACTOR', loi: ALIGNMENT.ACT_FACTOR, paliers: [1, 2, 3] }, // le don vaut double au Grand Froid, triple à la Cendre
  { nom: 'FIRE_UPKEEP.ACT_FACTOR', loi: FIRE_UPKEEP.ACT_FACTOR, paliers: [1, 1.5, 2] },
  { nom: 'NIGHT_HUNT.CHANCE_PER_MIN', loi: NIGHT_HUNT.CHANCE_PER_MIN, paliers: [0.12, 0.3, 0.55] },
  { nom: 'BRUME.CHANCE_PER_DAY', loi: BRUME.CHANCE_PER_DAY, paliers: [0, 0.35, 0.5] },
  { nom: 'METEO.CHANCE_PER_CYCLE', loi: METEO.CHANCE_PER_CYCLE, paliers: [0.5, 0.65, 0.8] },
]

describe('l’année : quatre actes de 21 jours (décision d’Alexis, 2026-08-21)', () => {
  it('ACTS_PER_YEAR = 4, ACT_DAYS = 21, YEAR_DAYS = 84 — épinglés en littéraux', () => {
    expect(ACTS_PER_YEAR).toBe(4)
    expect(BALANCE.ACT_DAYS).toBe(21)
    expect(YEAR_DAYS).toBe(84)
  })

  it('tour et phase se dérivent de l’acte, totalement', () => {
    expect([tourOf(1), tourOf(4), tourOf(5), tourOf(8), tourOf(9)]).toEqual([1, 1, 2, 2, 3])
    expect([phaseOf(1), phaseOf(2), phaseOf(3), phaseOf(4), phaseOf(5), phaseOf(8)]).toEqual([1, 2, 3, 4, 1, 4])
    expect([tourOf(0), tourOf(-3), phaseOf(0)]).toEqual([1, 1, 1])
    expect([tourForDay(84), tourForDay(85), phaseForDay(85), phaseForDay(168), phaseForDay(169)]).toEqual([1, 2, 1, 4, 1])
  })
})

describe('A1 — actForDay est TOTAL, monotone, non borné', () => {
  it('balayé sur 1..10 000 : jamais undefined, jamais en recul, et il dépasse 3', () => {
    let precedent = 0
    for (let jour = 1; jour <= 10_000; jour++) {
      const a = actForDay(jour)
      expect(Number.isInteger(a), `acte non entier au jour ${jour}`).toBe(true)
      expect(a, `l'acte recule au jour ${jour}`).toBeGreaterThanOrEqual(precedent)
      precedent = a
    }
    expect(actForDay(10_000)).toBe(Math.floor(9_999 / 21) + 1)
    // Les bornes de l'arc nominal, INCHANGÉES : 21 / 42 / 63.
    expect([actForDay(21), actForDay(22), actForDay(42), actForDay(43), actForDay(63), actForDay(64)]).toEqual([1, 2, 2, 3, 3, 4])
    // Et un jour < 1 répond encore.
    expect(actForDay(0)).toBe(1)
  })
})

describe('A2 — à PHASE fixée, chaque loi monte par tour, atteint son plafond, et le TIENT', () => {
  for (const { nom, loi, paliers } of LOIS) {
    it(nom, () => {
      // L'arc nominal, AU BIT PRÈS : les actes 1..3 rendent leurs paliers, le 4e tient le 3e.
      expect(loi(1)).toBe(paliers[0])
      expect(loi(2)).toBe(paliers[1])
      expect(loi(3)).toBe(paliers[2])
      expect(loi(4)).toBe(paliers[2]) // le cœur de l'hiver garde la valeur de la Cendre
      // Le printemps REVIENT : l'an 2 commence là où l'an 1 commençait (pas = 0 tant que les
      // pentes ne sont pas décidées — l'an 2 rejoue l'an 1).
      expect(loi(5)).toBe(paliers[0] + loi.pas)

      for (let phase = 1; phase <= ACTS_PER_YEAR; phase++) {
        let precedent = -Infinity
        let plafondAtteintAuTour = -1
        for (let tour = 1; tour * ACTS_PER_YEAR <= ACTES_BALAYES; tour++) {
          const act = (tour - 1) * ACTS_PER_YEAR + phase
          const v = loi(act)
          expect(Number.isFinite(v), `${nom}(${act}) n'est pas un nombre fini`).toBe(true)
          expect(v, `${nom} recule à l'acte ${act} (phase ${phase}, tour ${tour})`).toBeGreaterThanOrEqual(precedent)
          expect(v, `${nom} dépasse son plafond à l'acte ${act}`).toBeLessThanOrEqual(loi.plafond)
          if (plafondAtteintAuTour < 0 && v === loi.plafond) plafondAtteintAuTour = tour
          // Une fois le plafond atteint, il est TENU — une garde qui tolérerait un repli
          // cacherait exactement le défaut qu'elle prétend garder.
          if (plafondAtteintAuTour >= 0) expect(v, `${nom} quitte son plafond à l'acte ${act}`).toBe(loi.plafond)
          precedent = v
        }
        // Les phases les plus dures (3 et 4) atteignent le plafond dès l'an 1 ; les autres
        // l'atteignent SI une pente existe — sinon elles restent sous lui à jamais, et c'est
        // la forme de l'année.
        if (phase >= 3 || loi.pas > 0) expect(plafondAtteintAuTour, `${nom} (phase ${phase}) n'atteint jamais son plafond`).toBeGreaterThan(0)
      }
    })
  }

  it('hors domaine (acte 0, négatif, non entier), une loi répond encore — jamais undefined', () => {
    for (const { loi, paliers } of LOIS) {
      expect(loi(0)).toBe(paliers[0])
      expect(loi(-4)).toBe(paliers[0])
      expect(loi(2.7)).toBe(paliers[1]) // floor : on est dans l'acte 2 tant qu'on n'a pas passé le 3
      expect(Number.isFinite(loi(1e9))).toBe(true)
    }
  })
})

describe('les tables totales — ce qui n’est pas une pente REVIENT avec les saisons', () => {
  it('CENDREUX.CONVERGE_TILES reste une TABLE assumée (20 / 80 / 10000), cyclique', () => {
    // Une PORTÉE de perception, pas une intensité (plan pression-croissante) : T1 l'a rendue
    // totale sans la continuifier — la continuifier serait une décision d'Alexis.
    expect([1, 2, 3, 4].map((a) => CENDREUX.CONVERGE_TILES(a))).toEqual([20, 80, 10000, 10000])
    expect(CENDREUX.CONVERGE_TILES(5)).toBe(20) // le printemps de l'an 2 : la portée de printemps
    for (let act = 1; act <= ACTES_BALAYES; act++) expect([20, 80, 10000]).toContain(CENDREUX.CONVERGE_TILES(act))
  })

  it('METEO.TYPES rend une mixture à tout acte, dont les poids somment à 1, et le printemps revient', () => {
    for (let act = 1; act <= ACTES_BALAYES; act++) {
      const table = METEO.TYPES(act)
      const somme = Object.values(table).reduce((t, p) => t + p, 0)
      expect(Math.abs(somme - 1), `la mixture de l'acte ${act} ne somme pas à 1`).toBeLessThan(1e-9)
    }
    expect(METEO.TYPES(4)).toBe(METEO.TYPES(3)) // l'hiver profond garde le ciel de la Cendre
    expect(METEO.TYPES(5)).toBe(METEO.TYPES(1)) // identité : le même objet, pas une copie
    expect('blizzard' in METEO.TYPES(1)).toBe(false) // l'acte I ne tire pas de blizzard
  })
})

describe('le bâtisseur lui-même — la formule de l’arc oscillant', () => {
  it('actLaw : min(plafond, paliers[phase] + pas × (tour − 1))', () => {
    const loi = actLaw([3, 5, 8], 2, 13)
    expect(loi.paliers).toEqual([3, 5, 8])
    expect(loi.plafond).toBe(13)
    expect(loi.pas).toBe(2)
    // An 1 : 3, 5, 8, 8 — an 2 : 5, 7, 10, 10 — an 3 : 7, 9, 12, 12 — an 4 : 9, 11, 13, 13 (plafond)
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(loi)).toEqual([3, 5, 8, 8, 5, 7, 10, 10, 7, 9, 12, 12, 9, 11, 13, 13])
    expect(loi(400)).toBe(13) // et le plafond tient à jamais
  })

  it('sans pas ni plafond déclaré : le plafond est le plus haut palier, et l’année se répète', () => {
    const loi = actLaw([1, 1.5, 2])
    expect(loi.plafond).toBe(2)
    expect(loi.pas).toBe(0)
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(loi)).toEqual([1, 1.5, 2, 2, 1, 1.5, 2, 2])
  })

  it('actTable : générique, cyclique par phase, le dernier palier tenu jusqu’à la fin de l’année', () => {
    const t = actTable(['a', 'b'] as const)
    expect([t(-1), t(1), t(2), t(3), t(4), t(5), t(6)]).toEqual(['a', 'a', 'b', 'b', 'b', 'a', 'b'])
  })
})

describe('A5 — le solo ne se réinitialise jamais', () => {
  it('à 10 × 60 jours, la sim tourne encore, et l’acte y est strictement au-dessus de celui du jour 60', () => {
    const map = createEmptyMap(40, 40, 0)
    const sim = createSim(11, { map, calendarScale: 720, debug: true, worldEvents: false })
    const joueur = spawnEntity(sim, 20.5, 20.5)
    step(sim, [{ entityId: joueur, dx: 0, dy: 0, action: { type: 'debug_set_season_day', day: 600 } }])
    for (let i = 0; i < 40; i++) step(sim, [{ entityId: joueur, dx: 0, dy: 0 }])
    expect(sim.entities.some((e) => e.id === joueur)).toBe(true)
    expect(actForDay(600)).toBeGreaterThan(actForDay(60))
    expect(tourForDay(600)).toBe(8) // la huitième année
  }, 60_000)
})
