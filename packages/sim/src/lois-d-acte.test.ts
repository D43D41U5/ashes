/**
 * LES LOIS D'ACTE (spec `saison-sans-fin.md` A2/A3, tranche T1) — totales, monotones, plafonnées.
 *
 * Balayées sur 200 actes, jamais sur trois cas choisis. Et les paliers 1..3 sont épinglés à des
 * LITTÉRAUX, pas aux tables qu'on teste : « une garde écrite avec la constante qu'elle teste ne
 * garde rien » (leçon consignée) — si quelqu'un recalibre une loi, ce test doit rougir et lui
 * faire relire la décision, pas suivre en silence.
 *
 * A3 n'est PAS testé ici : il se tient par le compilateur (une loi n'est pas indexable — voir
 * l'en-tête d'`actLaw` dans `balance.ts`).
 */
import { describe, expect, it } from 'vitest'
import { ALIGNMENT, BALANCE, BRUME, CENDREUX, FIRE_UPKEEP, METEO, NIGHT_HUNT, SEASON, TEMPERATURE, actLaw, actTable, type ActLaw } from './balance'
import { actForDay } from './time'

const ACTES_BALAYES = 200

/** Les neuf lois numériques, avec leurs paliers ÉPINGLÉS (les valeurs du 2026-08-21). */
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

describe('A2 — chaque loi est TOTALE, MONOTONE, et atteint son plafond pour ne plus en bouger', () => {
  for (const { nom, loi, paliers } of LOIS) {
    it(nom, () => {
      // Les paliers de l'arc nominal, AU BIT PRÈS — c'est la promesse de T1 : comportement
      // identique sur les actes 1..3.
      expect(loi(1)).toBe(paliers[0])
      expect(loi(2)).toBe(paliers[1])
      expect(loi(3)).toBe(paliers[2])
      expect(loi.plafond).toBe(paliers[2])

      let precedent = -Infinity
      let plafondAtteintA = -1
      for (let act = 1; act <= ACTES_BALAYES; act++) {
        const v = loi(act)
        expect(Number.isFinite(v), `${nom}(${act}) n'est pas un nombre fini`).toBe(true)
        expect(v, `${nom} recule à l'acte ${act}`).toBeGreaterThanOrEqual(precedent)
        if (plafondAtteintA < 0 && v === loi.plafond) plafondAtteintA = act
        // Une fois le plafond atteint, il est TENU — une garde qui tolérerait un repli
        // cacherait exactement le défaut qu'elle prétend garder.
        if (plafondAtteintA >= 0) expect(v, `${nom} quitte son plafond à l'acte ${act}`).toBe(loi.plafond)
        precedent = v
      }
      expect(plafondAtteintA, `${nom} n'atteint jamais son plafond`).toBeGreaterThan(0)
    })
  }

  it('hors domaine (acte 0, négatif, non entier), une loi répond encore — jamais undefined', () => {
    for (const { loi, paliers } of LOIS) {
      expect(loi(0)).toBe(paliers[0])
      expect(loi(-4)).toBe(paliers[0])
      expect(loi(2.7)).toBe(paliers[1]) // floor : on est dans l'acte 2 tant qu'on n'a pas passé le 3
      expect(loi(1e9)).toBe(paliers[2])
    }
  })
})

describe('les tables totales — ce qui n’est pas une pente répond quand même à tout acte', () => {
  it('CENDREUX.CONVERGE_TILES reste une TABLE assumée (20 / 80 / 10000), tenue au-delà', () => {
    // Une PORTÉE de perception, pas une intensité (plan pression-croissante) : T1 la rend totale
    // sans la continuifier — la continuifier serait une décision d'Alexis.
    expect(CENDREUX.CONVERGE_TILES(1)).toBe(20)
    expect(CENDREUX.CONVERGE_TILES(2)).toBe(80)
    expect(CENDREUX.CONVERGE_TILES(3)).toBe(10000)
    for (let act = 3; act <= ACTES_BALAYES; act++) expect(CENDREUX.CONVERGE_TILES(act)).toBe(10000)
  })

  it('METEO.TYPES rend une mixture à tout acte, dont les poids somment à 1', () => {
    for (let act = 1; act <= ACTES_BALAYES; act++) {
      const table = METEO.TYPES(act)
      const somme = Object.values(table).reduce((t, p) => t + p, 0)
      expect(Math.abs(somme - 1), `la mixture de l'acte ${act} ne somme pas à 1`).toBeLessThan(1e-9)
    }
    // Au-delà de l'acte III, c'est LA MÊME mixture (identité, pas une copie qui dériverait).
    expect(METEO.TYPES(9)).toBe(METEO.TYPES(3))
    expect('blizzard' in METEO.TYPES(1)).toBe(false) // l'acte I ne tire pas de blizzard
  })
})

describe('le bâtisseur lui-même', () => {
  it('actLaw : paliers exposés, plafond = dernier palier, clamp des deux côtés', () => {
    const loi = actLaw([3, 5, 8, 13])
    expect(loi.paliers).toEqual([3, 5, 8, 13])
    expect(loi.plafond).toBe(13)
    expect([loi(0), loi(1), loi(2), loi(3), loi(4), loi(5), loi(400)]).toEqual([3, 3, 5, 8, 13, 13, 13])
  })

  it('actTable : générique, même clamp', () => {
    const t = actTable(['a', 'b'] as const)
    expect([t(-1), t(1), t(2), t(3)]).toEqual(['a', 'a', 'b', 'b'])
  })
})

describe('le calendrier, tel qu’il est ENCORE (T2 le libérera)', () => {
  it('actForDay est monotone non décroissant sur 1..400, et plafonne à 3 — documenté, pas caché', () => {
    let precedent = 0
    for (let jour = 1; jour <= 400; jour++) {
      const a = actForDay(jour)
      expect(a).toBeGreaterThanOrEqual(precedent)
      precedent = a
    }
    // Le plafond à 3 est l'état ACTUEL, et c'est exactement ce que T2 retire (A1 de la spec).
    // Cette ligne doit rougir le jour où T2 arrive — c'est son rôle.
    expect(actForDay(400)).toBe(3)
  })
})
