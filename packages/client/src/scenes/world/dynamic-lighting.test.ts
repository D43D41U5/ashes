import { describe, expect, it } from 'vitest'
import { daylight } from '../../render/lighting'
import { intensitesDuCiel } from './dynamic-lighting'

/**
 * LA LUNE NE DOIT JAMAIS ÉCLAIRER PLUS FORT QUE LE SOLEIL TANT QU'IL FAIT JOUR.
 *
 * Le défaut tenait dans un commentaire faux : la lune était dite « BEAUCOUP plus faible que
 * le soleil (~1.2) » — mais 0,32 était comparé au COEFFICIENT du soleil, pas à sa VALEUR.
 * Le soleil vaut `day × 1.2` et décroît ; la lune valait `(1 − day) × 0.32` et croissait.
 * Deux droites qui se croisent : à `daylight = 0,2105`, soit **de 19 h 56 à 6 h 22**, la lune
 * était la source dominante. À 20 h pile (`daylight = 0,2` exactement, c'est une clé de la
 * courbe), soleil 0,240 contre lune 0,256.
 *
 * Conséquence mesurée sur les captures : le contraste avatar/sol passait de 2,60:1 à midi à
 * **1,20:1 à 20 h**, avec INVERSION de polarité (l'avatar, plus clair que le sol au zénith,
 * devenait plus sombre) — les deux teintes opposées, ambre rasant et bleu lunaire,
 * s'annulant en gris neutre. À l'heure exacte où le jeu dit de rentrer au feu, on se perdait
 * soi-même dans le décor. (Audit UX 2026-08-20.)
 *
 * On balaie donc TOUT le domaine plutôt que trois heures choisies : c'est un rapport entre
 * deux nombres, il se prouve sur son domaine entier.
 */
describe('les deux sources du ciel', () => {
  it('le SOLEIL domine partout où il fait encore jour — balayage exhaustif de la journée', () => {
    const fautes: string[] = []
    for (let h = 0; h < 24; h += 0.05) {
      const d = daylight(h)
      const { soleil, lune } = intensitesDuCiel(d)
      // « Il fait encore jour » = le soleil éclaire. Sous ce seuil on est de nuit, et il est
      // normal — voulu — que la lune soit la seule source.
      if (d > 0.15 && lune > soleil) fautes.push(`${h.toFixed(2)}h (jour ${d.toFixed(3)}) : lune ${lune.toFixed(3)} > soleil ${soleil.toFixed(3)}`)
    }
    expect(fautes).toEqual([])
  })

  it('20 h — l’heure exacte du défaut : le soleil repasse devant', () => {
    const { soleil, lune } = intensitesDuCiel(daylight(20))
    expect(daylight(20)).toBeCloseTo(0.2, 5) // la clé de courbe qui rendait le défaut net
    expect(soleil).toBeGreaterThan(lune)
    expect(lune).toBe(0) // à 20 h il fait encore jour : la lune n'est pas levée
  })

  it('la LUNE existe quand même — sinon la nuit tombe à l’aplat noir', () => {
    const minuit = intensitesDuCiel(daylight(0))
    expect(minuit.soleil).toBe(0)
    expect(minuit.lune).toBeGreaterThan(0.3) // pleine force : le relief bleuté des houppiers
  })

  it('elle monte SANS MARCHE entre le crépuscule et la nuit', () => {
    // Une lune qui s'allumerait d'un coup se verrait comme un interrupteur. On vérifie la
    // continuité sur le passage : aucun saut de plus d'un dixième entre deux crans voisins.
    let precedent = intensitesDuCiel(0.3).lune
    for (let d = 0.3; d >= 0; d -= 0.005) {
      const { lune } = intensitesDuCiel(d)
      expect(Math.abs(lune - precedent)).toBeLessThan(0.1)
      precedent = lune
    }
  })

  it('et le soleil garde sa pleine force à midi', () => {
    expect(intensitesDuCiel(daylight(12)).soleil).toBeCloseTo(1.2, 5)
  })
})
