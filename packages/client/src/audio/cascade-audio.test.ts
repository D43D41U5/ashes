/**
 * LA CASCADE A UNE VOIX (B1, reprise de l'eau — 2026-09-12).
 *
 * Ce qu'on garde : la loi de la cible (pure) — silence sans colonne ou hors de portée, une colonne
 * « ici » au gain d'une colonne, les colonnes s'ajoutent en PUISSANCE (√N, plafonnées), le côté
 * suit la chute, le voile suit la distance sans jamais monter au-dessus du timbre, la roche la
 * tait ; et la machine à états — pas de nappe tant que rien n'est à portée, une seule cible posée
 * par changement, `taire` qui éteint.
 */
import { describe, expect, it } from 'vitest'
import { CASCADE, cibleDeLaCascade, SonsDeLaCascade, type ColonneDeChute } from './cascade-audio'
import type { FormeDeNappe, Nappe } from './engine'
import { COMPENSATION_PAN, PAN_MAX, PLEIN_TUILES, PORTEE_TUILES } from './spatial'

/** Une chute de `n` colonnes, lèvre en `(x0..x0+n−1, y)`, eau du pied en `y + 1`. */
const chute = (x0: number, y: number, n = 1): ColonneDeChute[] =>
  Array.from({ length: n }, (_, k) => ({ tx: x0 + k, ty: y }))

/** L'auditeur au pied de la première colonne : à la lèvre, dx = 0,5, dy = 0. */
const ICI = { x: 10.5, y: 21 }

describe('cibleDeLaCascade — la loi', () => {
  it('sans colonne, ou sous la roche, le silence (et le timbre de repos)', () => {
    expect(cibleDeLaCascade([], 0, 0)).toEqual({ gain: 0, hz: CASCADE.HZ, pan: 0, colonnes: 0 })
    expect(cibleDeLaCascade(chute(10, 20), ICI.x, ICI.y, 0).gain).toBe(0)
  })

  it('une colonne « ici » : le gain d’une colonne, compensé pour le panner, au centre, sans voile', () => {
    const c = cibleDeLaCascade(chute(10, 20), ICI.x, ICI.y)
    expect(c.colonnes).toBe(1)
    expect(c.gain).toBeCloseTo(CASCADE.GAIN_COLONNE * COMPENSATION_PAN, 6)
    expect(c.pan).toBeCloseTo(0, 6)
    expect(c.hz).toBe(CASCADE.HZ)
  })

  it('hors de portée (au-delà de PORTEE_TUILES × MASSE), la chute ne dit rien', () => {
    const bout = PORTEE_TUILES * CASCADE.PORTEE
    const loin = cibleDeLaCascade(chute(10, 20), ICI.x, ICI.y + bout + 1)
    expect(loin.gain).toBe(0)
    expect(loin.colonnes).toBe(0)
    const presque = cibleDeLaCascade(chute(10, 20), ICI.x, ICI.y + bout - 0.5)
    expect(presque.gain).toBeGreaterThan(0)
    expect(presque.gain).toBeLessThan(CASCADE.GAIN_COLONNE * COMPENSATION_PAN * 0.05)
  })

  it('les colonnes s’ajoutent en puissance : quatre colonnes ≈ √4 = 2 fois une, jamais quatre', () => {
    // Quatre colonnes serrées, toutes sous `PLEIN_TUILES × MASSE` (4,5 t) de l'auditeur : chacune
    // pèse 1 — la somme des puissances est exactement 4.
    const une = cibleDeLaCascade(chute(10, 20, 1), 12, 21).gain
    const quatre = cibleDeLaCascade(chute(10, 20, 4), 12, 21).gain
    expect(quatre / une).toBeCloseTo(2, 3)
  })

  it('le plafond : une chute de vingt colonnes ne dépasse pas GAIN_MAX au tympan', () => {
    const c = cibleDeLaCascade(chute(0, 20, 20), 10, 21)
    expect(c.gain / COMPENSATION_PAN).toBeCloseTo(CASCADE.GAIN_MAX, 6)
    // Et le plafond mord vraiment : sans lui, ce serait √20 × 0,028 ≈ 0,125.
    expect(CASCADE.GAIN_COLONNE * Math.sqrt(20)).toBeGreaterThan(CASCADE.GAIN_MAX)
  })

  it('le côté suit la chute : à droite de l’auditeur, pan > 0 ; à gauche, pan < 0 ; borné à PAN_MAX', () => {
    const droite = cibleDeLaCascade(chute(30, 20), 10, 21)
    const gauche = cibleDeLaCascade(chute(-10, 20), 10, 21)
    expect(droite.pan).toBeGreaterThan(0.3)
    expect(gauche.pan).toBeLessThan(-0.3)
    expect(Math.abs(droite.pan)).toBeLessThanOrEqual(PAN_MAX + 1e-9)
    // Deux chutes symétriques, une de chaque côté : le barycentre est au centre.
    // (à 10,5 : les deux lèvres sont à ±20 tuiles exactement.)
    expect(cibleDeLaCascade([...chute(30, 20), ...chute(-10, 20)], 10.5, 21).pan).toBeCloseTo(0, 6)
  })

  it('le voile : de près le timbre nu, de loin une coupe plus basse — jamais au-dessus du timbre', () => {
    const pres = cibleDeLaCascade(chute(10, 20), ICI.x, ICI.y + PLEIN_TUILES * CASCADE.PORTEE - 0.1)
    expect(pres.hz).toBe(CASCADE.HZ)
    // Au bout de la queue, le voile de `placer` descend vers 800 Hz — sous le timbre (900).
    const loin = cibleDeLaCascade(chute(10, 20), ICI.x, ICI.y + PORTEE_TUILES * CASCADE.PORTEE - 0.3)
    expect(loin.hz).toBeLessThan(CASCADE.HZ)
    expect(loin.hz).toBeGreaterThan(100)
  })

  it('les constantes : un lit permanent reste sous les lits du ciel, et le gain croît avec la proximité', () => {
    expect(CASCADE.GAIN_MAX).toBeLessThanOrEqual(0.06)
    expect(CASCADE.GAIN_COLONNE).toBeLessThan(CASCADE.GAIN_MAX)
    let precedent = Infinity
    for (let d = 0; d < PORTEE_TUILES * CASCADE.PORTEE; d += 1) {
      const g = cibleDeLaCascade(chute(10, 20), ICI.x, ICI.y + d).gain
      expect(g).toBeLessThanOrEqual(precedent + 1e-9)
      precedent = g
    }
  })
})

/** Une nappe de papier : elle note chaque réglage. */
function fausseNappe(): { nappe: Nappe; reglages: { niveau: number; hz: number; pan: number | undefined }[]; arrets: number } {
  const reglages: { niveau: number; hz: number; pan: number | undefined }[] = []
  const etat = { arrets: 0 }
  const nappe: Nappe = {
    regler: (niveau, hz, _fondu, pan) => { reglages.push({ niveau, hz, pan }) },
    arreter: () => { etat.arrets += 1 },
  }
  return { nappe, reglages, get arrets() { return etat.arrets } }
}

describe('SonsDeLaCascade — la machine', () => {
  it('sans colonne à portée, la nappe ne s’ouvre même pas ; à la première, elle s’ouvre et reçoit sa cible avec son côté', () => {
    const sons = new SonsDeLaCascade()
    const f = fausseNappe()
    let ouvertures = 0
    const ouvre = (forme: FormeDeNappe): Nappe => { ouvertures += 1; expect(forme).toBe('cascade'); return f.nappe }
    sons.update(ouvre, chute(10, 20), 500, 500, 1, 0)
    expect(ouvertures).toBe(0)
    expect(sons.sonde.colonnes).toBe(0)
    sons.update(ouvre, chute(30, 20), 10, 21, 1, 1000)
    expect(ouvertures).toBe(1)
    expect(f.reglages).toHaveLength(1)
    expect(f.reglages[0]!.pan).toBeGreaterThan(0.3)
    expect(sons.sonde.gain).toBeCloseTo(f.reglages[0]!.niveau / COMPENSATION_PAN, 9)
  })

  it('la cadence : deux lectures dans la même fenêtre n’en font qu’une ; une cible inchangée n’est pas reposée', () => {
    const sons = new SonsDeLaCascade()
    const f = fausseNappe()
    const ouvre = (): Nappe => f.nappe
    sons.update(ouvre, chute(30, 20), 10, 21, 1, 0)
    sons.update(ouvre, chute(30, 20), 20, 21, 1, CASCADE.CADENCE_MS / 2) // trop tôt : ignoré
    expect(f.reglages).toHaveLength(1)
    sons.update(ouvre, chute(30, 20), 10, 21, 1, CASCADE.CADENCE_MS + 1) // même cible : pas reposée
    expect(f.reglages).toHaveLength(1)
    sons.update(ouvre, chute(30, 20), 20, 21, 1, 2 * CASCADE.CADENCE_MS + 2) // plus près : reposée
    expect(f.reglages).toHaveLength(2)
    expect(f.reglages[1]!.niveau).toBeGreaterThan(f.reglages[0]!.niveau)
  })

  it('l’audio dort : la cible n’est pas mémorisée, et se pose au réveil', () => {
    const sons = new SonsDeLaCascade()
    const f = fausseNappe()
    let eveille = false
    const ouvre = (): Nappe | null => (eveille ? f.nappe : null)
    sons.update(ouvre, chute(30, 20), 10, 21, 1, 0)
    expect(f.reglages).toHaveLength(0)
    eveille = true
    sons.update(ouvre, chute(30, 20), 10, 21, 1, CASCADE.CADENCE_MS + 1)
    expect(f.reglages).toHaveLength(1)
  })

  it('taire : la nappe s’arrête, la sonde retombe, et la machine repart de zéro', () => {
    const sons = new SonsDeLaCascade()
    const f = fausseNappe()
    sons.update(() => f.nappe, chute(30, 20), 10, 21, 1, 0)
    sons.taire()
    expect(f.arrets).toBe(1)
    expect(sons.sonde).toEqual({ gain: 0, pan: 0, hz: CASCADE.HZ, colonnes: 0 })
    // Repartie : elle rouvre une nappe (le contexte réveillé de la Veillée suivante).
    let ouvertures = 0
    sons.update(() => { ouvertures += 1; return f.nappe }, chute(30, 20), 10, 21, 1, 0)
    expect(ouvertures).toBe(1)
  })
})
