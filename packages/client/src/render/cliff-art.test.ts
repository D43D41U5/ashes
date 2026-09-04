import { describe, expect, it } from 'vitest'
import {
  CLIFF_TILE_PX,
  dessinDeParoi,
  dessinDuDessus,
  PAROI_RANGEES,
  roleDeFalaise,
  VARIANTES_PAROI,
  type RectArt,
} from './cliff-art'

/**
 * On PEINT les rectangles et on relit les pixels : c'est la sortie qui est affirmée, jamais la
 * liste d'entrée. Un rect qui en recouvre un autre change ce qu'on voit — une garde qui lirait la
 * liste ne le verrait pas.
 */
function peindre(rects: readonly RectArt[]): Int32Array {
  const T = CLIFF_TILE_PX
  const px = new Int32Array(T * T).fill(-1)
  for (const r of rects) {
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= T && r.y + r.h <= T, `rect hors tuile : ${JSON.stringify(r)}`).toBe(true)
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) px[y * T + x] = r.c
    }
  }
  return px
}
const at = (px: Int32Array, x: number, y: number): number => px[y * CLIFF_TILE_PX + x]!

/** Une colonne de roche de `hauteur` tuiles en (0, y0). Hors de la colonne : du sol — SAUF hors
 *  carte, qui est de la roche (l'anneau de bordure), exactement comme dans le jeu. */
function colonne(hauteur: number, y0 = 4, hauteurCarte = 20) {
  return (tx: number, ty: number): boolean => {
    if (ty < 0 || ty >= hauteurCarte) return true
    return tx === 0 && ty >= y0 && ty < y0 + hauteur
  }
}

describe('roleDeFalaise — le rôle se COMPTE, il ne se stocke pas', () => {
  it('une masse épaisse : du dessus partout, puis l’arête, puis le pied', () => {
    for (let h = PAROI_RANGEES + 1; h <= 8; h++) {
      const roche = colonne(h)
      const roles = Array.from({ length: h }, (_, k) => roleDeFalaise(roche, 0, 4 + k))
      for (let k = 0; k < h - PAROI_RANGEES; k++) {
        expect(roles[k]!.role, `h=${h} rangée ${k}`).toBe('dessus')
      }
      const arete = roles[h - 2]!
      const pied = roles[h - 1]!
      expect(arete).toEqual({ role: 'paroi', arete: true, pied: false })
      expect(pied).toEqual({ role: 'paroi', arete: false, pied: true })
    }
  })

  it('une masse de deux rangées : l’arête et le pied, sans dessus', () => {
    const roche = colonne(2)
    expect(roleDeFalaise(roche, 0, 4)).toEqual({ role: 'paroi', arete: true, pied: false })
    expect(roleDeFalaise(roche, 0, 5)).toEqual({ role: 'paroi', arete: false, pied: true })
  })

  it('une masse d’UNE rangée (le mur de frontière d’aujourd’hui) est à la fois arête et pied', () => {
    const roche = colonne(1)
    expect(roleDeFalaise(roche, 0, 4)).toEqual({ role: 'paroi', arete: true, pied: true })
  })

  it('le bord SUD du monde ne se dresse pas devant le vide', () => {
    // Une colonne qui descend jusqu'à la dernière rangée : le hors-carte est de la roche, donc
    // toutes ses tuiles ont deux roches sous elles — du dessus, pas une paroi.
    const roche = colonne(6, 14, 20)
    for (let k = 0; k < 6; k++) expect(roleDeFalaise(roche, 0, 14 + k).role).toBe('dessus')
  })

  it('balayage exhaustif : le pied est UNIQUE par colonne, et il est la tuile la plus au sud', () => {
    for (let h = 1; h <= 8; h++) {
      const roche = colonne(h)
      const pieds = Array.from({ length: h }, (_, k) => 4 + k).filter((ty) => roleDeFalaise(roche, 0, ty).pied)
      expect(pieds, `h=${h}`).toEqual([4 + h - 1])
    }
  })
})

describe('dessinDeParoi — ce qu’on voit, pixel par pixel', () => {
  it('couvre toute la tuile, sur les 16 masques et toutes les variantes', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (let v = 0; v < VARIANTES_PAROI; v++) {
        const px = peindre(dessinDeParoi(mask, v))
        expect(px.some((c) => c === -1), `masque ${mask} variante ${v} : un pixel nu`).toBe(false)
      }
    }
  })

  it('l’arête prend le jour en HAUT, le pied s’assombrit en BAS — et jamais l’inverse', () => {
    for (let v = 0; v < VARIANTES_PAROI; v++) {
      const avecArete = peindre(dessinDeParoi(1, v))
      const sansArete = peindre(dessinDeParoi(0, v))
      // la rangée du haut est plus claire avec l'arête qu'elle ne l'est sans
      for (let x = 1; x < 15; x++) {
        expect(at(avecArete, x, 0)).toBeGreaterThan(at(sansArete, x, 0))
      }
      // ⚠ **SUR LA MOYENNE DE LA RANGÉE, ET PLUS PIXEL PAR PIXEL** — depuis que la fracture est
      // ROMPUE (2026-09-01 : le joint continu rendait un appareillage de blocs sur la pierre
      // claire, il s'interrompt maintenant par tronçons). Un pixel du pied peut donc être plus
      // clair que celui de l'arête à la même abscisse : c'est le joint qui manque là, pas la
      // chute qui s'inverse. Ce qu'on affirme reste ce qui compte — **la paroi s'assombrit en
      // descendant** —, énoncé sur la seule mesure que la rupture ne perturbe pas.
      const avecPied = peindre(dessinDeParoi(8, v))
      const moyenne = (px: Int32Array, y: number): number => {
        let s = 0
        for (let x = 0; x < 16; x++) s += at(px, x, y)
        return s / 16
      }
      expect(moyenne(avecPied, 15), `variante ${v}`).toBeLessThan(moyenne(avecArete, 15))
    }
  })

  it('le soleil est au nord-OUEST : le bord ouest est plus clair que le bord est', () => {
    for (let v = 0; v < VARIANTES_PAROI; v++) {
      const px = peindre(dessinDeParoi(2 | 4, v))
      for (let y = 2; y < 14; y++) {
        expect(at(px, 0, y), `variante ${v} rangée ${y}`).toBeGreaterThan(at(px, 15, y))
      }
    }
  })
})

describe('dessinDuDessus — inchangé par le retour de la paroi', () => {
  it('couvre la tuile et pose son liseré nord quand le bord est ouvert', () => {
    const nu = peindre(dessinDuDessus(0, 0))
    expect(nu.some((c) => c === -1)).toBe(false)
    const liseré = peindre(dessinDuDessus(1, 0))
    for (let x = 0; x < 16; x++) expect(at(liseré, x, 0)).toBeGreaterThan(at(nu, x, 0))
  })
})
