/**
 * LE CHAMP DE NEIGE — ce que le lissage spatial doit garantir (R14).
 *
 * Deux propriétés, et elles se contredisent si on n'y prend pas garde : la marche de biome
 * doit s'ÉTALER (sinon on peint la grille des tuiles), et le signal doit SURVIVRE (un lissage
 * qui rend tout gris ne dit plus ni neige ni pluie). Les deux sont affirmées ici.
 */
import { describe, expect, it } from 'vitest'
import { ChampNeige, PAS_TUILES } from './meteo-melange'

const CADRE = { x0: 0, y0: 0, x1: 64, y1: 40 }

/** La mesure du cas signalé : un marais (part 1) à gauche d'une lisière, un pré (part 0) à
 *  droite — une MARCHE d'une tuile, exactement ce que `BIOME_OFFSET` produit. */
const marche = (seuil: number) => (x: number): number => (x < seuil ? 1 : 0)

describe('R14 — le champ de neige étale la marche sans l’effacer', () => {
  it('une MARCHE d’une tuile devient une rampe de la maille — aucun saut de plus de 1/maille par tuile', () => {
    const champ = new ChampNeige()
    champ.maj((x) => marche(32)(x), CADRE, 0)
    let pire = 0
    for (let x = 8; x < 56; x += 1) {
      pire = Math.max(pire, Math.abs(champ.part(x + 1, 20) - champ.part(x, 20)))
    }
    // Le bilinéaire ne peut pas monter plus vite que la maille : c'est LA garantie du lissage.
    expect(pire).toBeLessThanOrEqual(1 / PAS_TUILES + 1e-6)
    // Et elle est SERRÉE : sans lissage, ce pire vaudrait 1. La garde ne peut pas passer par
    // accident sur un champ constant — les deux extrêmes sont affirmés juste en dessous.
    expect(pire).toBeGreaterThan(0)
  })

  it('LE SIGNAL SURVIT — loin de la lisière, c’est franchement 1 d’un côté et franchement 0 de l’autre', () => {
    const champ = new ChampNeige()
    champ.maj((x) => marche(32)(x), CADRE, 0)
    expect(champ.part(4, 20)).toBe(1)
    expect(champ.part(60, 20)).toBe(0)
    // La transition est LOCALE : elle tient dans deux mailles autour de la lisière.
    expect(champ.part(32 - 2 * PAS_TUILES, 20)).toBe(1)
    expect(champ.part(32 + 2 * PAS_TUILES, 20)).toBe(0)
  })

  it('ANCRÉE AU MONDE — un panoramique ne fait pas bouger la valeur d’un point qui, lui, n’a pas bougé', () => {
    const a = new ChampNeige()
    const b = new ChampNeige()
    a.maj((x) => marche(32)(x), CADRE, 0)
    // Le même monde, vu par une caméra décalée d'une demi-maille : la grille retombe sur les
    // mêmes nœuds (multiples de la maille en coordonnées MONDE), donc la même valeur.
    b.maj((x) => marche(32)(x), { x0: 2, y0: 3, x1: 66, y1: 43 }, 0)
    for (let x = 10; x < 54; x += 0.5) {
      expect(b.part(x, 20), `x=${x}`).toBeCloseTo(a.part(x, 20), 6)
    }
  })

  it('ELLE NE RELÈVE PAS À CHAQUE IMAGE — le cadre couvert et le relevé frais suffisent', () => {
    const champ = new ChampNeige()
    let appels = 0
    const mesure = (x: number): number => { appels++; return marche(32)(x) }
    champ.maj(mesure, CADRE, 0)
    const premier = appels
    expect(premier).toBeGreaterThan(0)
    // Cent images plus tard, au même endroit et dans la même seconde : pas une mesure de plus.
    for (let i = 1; i <= 100; i++) champ.maj(mesure, CADRE, i * 8)
    expect(appels).toBe(premier)
    // Le temps passe : le relevé se refait (l'heure fait dériver le froid du monde).
    champ.maj(mesure, CADRE, 5000)
    expect(appels).toBeGreaterThan(premier)
  })

  it('SANS RELEVÉ, IL NE NEIGE PAS — et `vider` remet à cet état', () => {
    const champ = new ChampNeige()
    expect(champ.part(10, 10)).toBe(0)
    champ.maj(() => 1, CADRE, 0)
    expect(champ.part(10, 10)).toBe(1)
    champ.vider()
    expect(champ.part(10, 10)).toBe(0)
  })
})
