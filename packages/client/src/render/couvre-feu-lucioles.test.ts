import { describe, expect, it } from 'vitest'
import { dayTicksPourJour, leverPourJour, TICKS_PER_CYCLE, YEAR_DAYS } from '@ashes/sim'
import {
  LUCIOLES_DECLIN_H,
  LUCIOLES_EXTINCTION_H,
  LUCIOLES_REOUVERTURE_H,
  partDeNuitDesLucioles,
} from './couvre-feu-lucioles'
import { daylight, heureSolaire } from './lighting'

/**
 * LE SEUIL DE NUIT DES LUCIOLES, RECOPIÉ À DESSEIN — il est privé de `ambient-life.ts`, qui
 * importe Phaser et n'a donc pas sa place dans une garde pure. L'importer ne garderait rien de
 * toute façon : une garde écrite avec la constante qu'elle teste ne garde rien.
 */
const SEUIL = 0.45

/** La rampe d'obscurité que `ambient-life` applique — elle commande le NOMBRE d'essaims comme
 *  leur lueur, d'un seul tenant. C'est le FACTEUR que le couvre-feu multiplie. */
function rampeDObscurite(hourOfCycle: number, jour: number): number {
  const h = heureSolaire(hourOfCycle, dayTicksPourJour(jour), leverPourJour(jour))
  const obscurite = 1 - daylight(h)
  const t = (obscurite - SEUIL) / (1 - SEUIL)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** Ce que voient VRAIMENT les essaims : la composition des deux. C'est elle qui porte la
 *  promesse — aucune des deux moitiés ne la tient seule. */
function partVue(hourOfCycle: number, jour: number): number {
  return rampeDObscurite(hourOfCycle, jour) * partDeNuitDesLucioles(hourOfCycle, leverPourJour(jour))
}

/** L'heure murale à `u` heures du lever de ce jour-là. */
const heureA = (u: number, jour: number): number => ((leverPourJour(jour) + u) % 24 + 24) % 24

/** Les jours de l'année, tous — les quatre cardinaux n'en sont que les extrêmes. */
const ANNEE = Array.from({ length: YEAR_DAYS }, (_, i) => i + 1)

describe('le couvre-feu de l’aube des lucioles', () => {
  it('reste un FACTEUR borné dans [0, 1], à toute heure et à tout lever', () => {
    for (const lever of [4.75, 6.76, 8.72, 0, 23.5]) {
      for (let h = 0; h < 24; h += 0.01) {
        const v = partDeNuitDesLucioles(h, lever)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('vaut ZÉRO une heure pleine avant le lever, et encore zéro à la minute d’avant', () => {
    for (const jour of ANNEE) {
      const lever = leverPourJour(jour)
      expect(partDeNuitDesLucioles(heureA(24 - LUCIOLES_EXTINCTION_H, jour), lever)).toBe(0)
      expect(partDeNuitDesLucioles(heureA(24 - LUCIOLES_EXTINCTION_H - 0.017, jour), lever)).toBeGreaterThan(0)
    }
  })

  it('DÉCLINE en pente continue sur l’heure qui précède l’extinction — jamais une marche', () => {
    const lever = 6.758779 // l’équinoxe ; la pente ne dépend pas de la saison, l’heure murale si
    const a = (u: number) => partDeNuitDesLucioles((((lever + u) % 24) + 24) % 24, lever)
    const debut = 24 - LUCIOLES_EXTINCTION_H - LUCIOLES_DECLIN_H - 0.5
    let avant = a(debut)
    expect(avant).toBe(1) // on part bien du plein, sinon la pente n’est pas celle qu’on croit
    // 0,01 h de pas ⇒ au plus 0,01 de saut si la pente vaut 1/h. Une marche se verrait.
    for (let u = debut; u <= 24 - LUCIOLES_EXTINCTION_H; u += 0.01) {
      const v = a(u)
      expect(v).toBeLessThanOrEqual(avant + 1e-9) // elle ne remonte jamais
      expect(Math.abs(v - avant)).toBeLessThanOrEqual(0.011)
      avant = v
    }
    expect(a(24 - LUCIOLES_EXTINCTION_H)).toBe(0)
  })

  /**
   * LE CAS DISCRIMINANT — celui qu’un gain naïf « 24 − u < 1 » rate. Une demi-heure APRÈS le
   * lever, l’obscurité vaut encore ~0,85 : sans la réouverture différée, les essaims éteints à
   * T−1 h se rallumeraient à T+0 h 30, en plein point du jour.
   */
  it('reste éteint APRÈS le lever, alors que l’obscurité, elle, dit encore « nuit »', () => {
    for (const jour of ANNEE) {
      // LA PRÉMISSE, et c’est le chiffre du défaut : À L’INSTANT MÊME DU LEVER, la rampe
      // d’obscurité vaut encore ~0,73 — deux essaims sur trois, en plein point du jour. Une
      // demi-heure plus tard elle tient toujours entre 0,27 (Grand Froid) et 0,42 (équinoxe).
      expect(rampeDObscurite(heureA(0, jour), jour)).toBeGreaterThan(0.7)
      expect(rampeDObscurite(heureA(0.5, jour), jour)).toBeGreaterThan(0.2)
      for (const u of [0, 0.5, 1, 2, 3.9]) {
        expect(partDeNuitDesLucioles(heureA(u, jour), leverPourJour(jour))).toBe(0)
        expect(partVue(heureA(u, jour), jour)).toBe(0)
      }
    }
  })

  it('éteint TOUTE la bande interdite — balayage de l’année entière, au pas de six minutes', () => {
    for (const jour of ANNEE) {
      // De l’extinction (T−1 h) jusqu’à la réouverture (T+4 h) : le produit est nul partout.
      for (let u = 24 - LUCIOLES_EXTINCTION_H; u < 24 + LUCIOLES_REOUVERTURE_H; u += 0.1) {
        expect(partVue(heureA(u % 24, jour), jour)).toBe(0)
      }
    }
  })

  /**
   * LA RÉOUVERTURE EST UNE MARCHE, ET ELLE TOMBE SUR UN ZÉRO. C’est ce qui autorise le `if`
   * plutôt qu’une seconde rampe : à `LUCIOLES_REOUVERTURE_H`, la courbe de jour est au plafond,
   * donc la rampe d’obscurité vaut exactement 0 et personne ne voit le saut.
   */
  it('rouvre sur un zéro : la rampe d’obscurité est nulle de part et d’autre de la marche', () => {
    for (const jour of ANNEE) {
      // La marche elle-même : 0 juste avant, 1 juste après.
      expect(partDeNuitDesLucioles(heureA(LUCIOLES_REOUVERTURE_H - 0.01, jour), leverPourJour(jour))).toBe(0)
      expect(partDeNuitDesLucioles(heureA(LUCIOLES_REOUVERTURE_H + 0.01, jour), leverPourJour(jour))).toBe(1)
      // Et elle tombe sur un zéro DE PART ET D’AUTRE : personne ne peut la voir.
      for (let d = -0.5; d <= 0.5; d += 0.05) {
        expect(rampeDObscurite(heureA(LUCIOLES_REOUVERTURE_H + d, jour), jour)).toBe(0)
      }
    }
  })

  /**
   * LA CONTRE-ÉPREUVE — sans quoi les zéros ci-dessus seraient obtenus par accident. On affirme
   * ① que la nuit garde bel et bien ses lucioles en son cœur, et ② que c’est le couvre-feu, et
   * LUI SEUL, qui éteint T−1 h : l’obscurité y est encore presque pleine, donc le code d’avant
   * y rendait un essaim à pleine force.
   */
  it('laisse la nuit pleine intacte, et c’est BIEN lui qui éteint l’aube', () => {
    for (const jour of ANNEE) {
      // Le cœur de nuit : à mi-chemin entre le crépuscule (u = jourH) et le lever (u = 24).
      const jourH = (24 * dayTicksPourJour(jour)) / TICKS_PER_CYCLE
      const minuit = (jourH + 24) / 2
      expect(partVue(heureA(minuit, jour), jour)).toBeGreaterThan(0.9)
      // Et à T−1 h, l’obscurité seule ne demandait rien de moins : c’est bien l’heure qui tranche.
      expect(rampeDObscurite(heureA(24 - LUCIOLES_EXTINCTION_H, jour), jour)).toBeGreaterThan(0.85)
    }
  })
})
