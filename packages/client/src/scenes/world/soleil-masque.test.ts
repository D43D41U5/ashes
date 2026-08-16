import { describe, expect, it } from 'vitest'
import { clairiereForet } from '@ashes/sim'
import { masqueSoleil, type ArbreCouvert, type ChampSoleil } from './soleil-masque'

/** Un bois d'essai : 40×40, profondeur 0 hors d'un carré central, pente 1→8 dedans. */
function bois(): ChampSoleil {
  const width = 40
  const height = 40
  const profondeur = new Array<number>(width * height).fill(0)
  for (let ty = 4; ty < 36; ty++) {
    for (let tx = 4; tx < 36; tx++) {
      // La profondeur croît vers le centre (20,20), plafonnée à 8 — un massif jouet.
      const d = Math.max(1, 8 - Math.floor(Math.max(Math.abs(tx - 20), Math.abs(ty - 20)) / 2))
      profondeur[ty * width + tx] = d
    }
  }
  return { width, height, profondeur }
}

/** Une graine SANS clairière dans le massif jouet — la pénombre s'y lit sans exemption. */
function graineSansClairiere(): number {
  for (let seed = 1; seed < 500; seed++) {
    let libre = true
    for (let ty = 4; ty < 36 && libre; ty++) {
      for (let tx = 4; tx < 36 && libre; tx++) {
        if (clairiereForet(seed, tx, ty) > 0) libre = false
      }
    }
    if (libre) return seed
  }
  throw new Error('aucune graine sans clairière dans la fenêtre — élargir la recherche')
}

const lit = (m: Uint8Array, carte: ChampSoleil, tx: number, ty: number): number => m[ty * carte.width + tx]! / 255

describe('masqueSoleil — la lumière est ce que la canopée laisse passer', () => {
  const carte = bois()
  const seed = graineSansClairiere()

  it('sous une couronne, éteint au tronc, retombée CONTINUE vers le bord', () => {
    const arbres: ArbreCouvert[] = [{ tx: 20, ty: 20, rayonTuiles: 3 }]
    const m = masqueSoleil(carte, seed, arbres)
    expect(lit(m, carte, 20, 20)).toBeLessThan(0.02) // le pied du tronc : nuit de canopée
    const auTronc = lit(m, carte, 20, 20)
    const aMiCouronne = lit(m, carte, 22, 20)
    const auBord = lit(m, carte, 23, 20)
    const dehors = lit(m, carte, 25, 20)
    expect(aMiCouronne).toBeGreaterThan(auTronc)
    expect(auBord).toBeGreaterThan(aMiCouronne)
    expect(dehors).toBeGreaterThan(auBord)
  })

  it('un trou de canopée AU CŒUR reste une tache de lumière — c’est l’amendement', () => {
    // Une couronne autour du trou, aucun arbre sur (20,20) même : le cœur du massif.
    const arbres: ArbreCouvert[] = [
      { tx: 16, ty: 20, rayonTuiles: 2.5 },
      { tx: 24, ty: 20, rayonTuiles: 2.5 },
      { tx: 20, ty: 16, rayonTuiles: 2.5 },
      { tx: 20, ty: 24, rayonTuiles: 2.5 },
    ]
    const m = masqueSoleil(carte, seed, arbres)
    // Le trou est éclairé à la pénombre de cœur (×0,7), jamais éteint.
    expect(lit(m, carte, 20, 20)).toBeGreaterThan(0.6)
  })

  it('la pénombre est une PENTE CONTINUE de la lisière (1) au cœur (0,7)', () => {
    const m = masqueSoleil(carte, seed, []) // aucun arbre : l'ouverture vaut 1 partout
    const lisiere = lit(m, carte, 4, 20) // d = 1
    const coeur = lit(m, carte, 20, 20) // d = 8
    expect(lisiere).toBeCloseTo(1, 1)
    expect(coeur).toBeCloseTo(0.7, 1)
    // Et entre les deux, ça DESCEND sans marche brutale ni remontée.
    let prev = lisiere
    for (let tx = 5; tx <= 20; tx++) {
      const v = lit(m, carte, tx, 20)
      expect(v).toBeLessThanOrEqual(prev + 0.001)
      prev = v
    }
  })

  it('abattre un arbre ÉCLAIRE sa trouée', () => {
    const avant = masqueSoleil(carte, seed, [{ tx: 12, ty: 12, rayonTuiles: 3 }])
    const apres = masqueSoleil(carte, seed, [])
    expect(lit(apres, carte, 12, 12)).toBeGreaterThan(lit(avant, carte, 12, 12) + 0.5)
  })

  it('hors des bois (profondeur 0), aucune tache — même sous un arbre isolé', () => {
    const m = masqueSoleil(carte, seed, [{ tx: 1, ty: 1, rayonTuiles: 3 }])
    expect(lit(m, carte, 1, 1)).toBe(0)
    expect(lit(m, carte, 2, 2)).toBe(0)
  })

  it('une clairière (A22) échappe à la pénombre : chambre de lumière pleine', () => {
    // On cherche une graine AVEC une clairière dans le massif, et on lit sa tuile.
    for (let s = 1; s < 4000; s++) {
      for (let ty = 18; ty < 24; ty++) {
        for (let tx = 18; tx < 24; tx++) {
          if (clairiereForet(s, tx, ty) > 0) {
            const m = masqueSoleil(carte, s, [])
            expect(lit(m, carte, tx, ty)).toBeCloseTo(1, 1) // pleine, malgré d profond
            return
          }
        }
      }
    }
    throw new Error('aucune clairière trouvée sur 4000 graines — la fenêtre est-elle trop étroite ?')
  })

  it('deux appels rendent le MÊME masque (aucun tirage par appel)', () => {
    const arbres: ArbreCouvert[] = [{ tx: 20, ty: 20, rayonTuiles: 3 }, { tx: 10, ty: 30, rayonTuiles: 2 }]
    expect(masqueSoleil(carte, seed, arbres)).toEqual(masqueSoleil(carte, seed, arbres))
  })
})
