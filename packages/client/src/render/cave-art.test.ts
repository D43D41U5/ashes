/**
 * ═══ LA CAVE — les gardes du dessin (spec `etages.md` §17, « le rendu ») ═══
 *
 * Même phrase que `plateau-art.test.ts` : **une profondeur se lit à la VALEUR.** Une cave est un
 * CREUX dans une masse ; ce que ces gardes affirment, c'est l'ORDRE des valeurs qui le creuse —
 * le sol plus clair que la roche qui l'entoure (sinon la salle est un trou, pas un lieu), la
 * gueule plus noire que la paroi qu'elle fend et plus noire en HAUT qu'en bas (le fond s'enfonce,
 * le seuil prend le jour), la nappe de jour plus forte au seuil qu'au fond, la paroi de cave plus
 * sombre et plus FROIDE que celle de la falaise (pas de ciel, pas de soleil).
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_BOULDERS, TERRAIN_SCREE } from '@ashes/sim'
import { dessinDeParoi, PAROI_RANGEES } from './cliff-art'
import {
  dessinDeLaGueule, dessinDeLaGueuleEntiere, dessinDeLaRocheDeCave, dessinDeLevre, dessinDeParoiDeCave, dessinDuJour,
  dessinDuSolDeCave, GUEULE_LARGEUR, GUEULE_RANGEES, JOUR_RANGEES, lum, PERIODE_CAVE, ROCHE_PX, type RectArtA,
} from './cave-art'

/** Le pixel (x, y) — le dernier rectangle qui le couvre, composé avec son alpha sur `fond`. */
function pixel(rects: readonly RectArtA[], x: number, y: number, fond = -1): number {
  let c = fond
  for (const r of rects) {
    if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) continue
    const a = r.a ?? 1
    if (a >= 1 || c < 0) { c = r.c; continue }
    const m = (d: number): number => Math.round(((c >> d) & 255) * (1 - a) + ((r.c >> d) & 255) * a)
    c = (m(16) << 16) | (m(8) << 8) | m(0)
  }
  return c
}

/** La luminance moyenne d'une figure w×h. */
function valeur(rects: readonly RectArtA[], w = 16, h = 16, fond = 0): number {
  let s = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += lum(pixel(rects, x, y, fond))
  return s / (w * h)
}

describe('cave-art — le sol et la roche', () => {
  it('le sol de la salle domine la roche de la masse : la salle est un lieu, pas un trou', () => {
    const roche = valeur(dessinDeLaRocheDeCave(), ROCHE_PX, ROCHE_PX)
    for (const t of [TERRAIN_SCREE, TERRAIN_BOULDERS]) {
      for (let phase = 0; phase < PERIODE_CAVE * PERIODE_CAVE; phase++) {
        expect(valeur(dessinDuSolDeCave(phase, t))).toBeGreaterThan(roche * 1.6)
      }
    }
  })
  it('le sol est opaque et couvre la tuile entière (sinon la roche se voit au travers)', () => {
    const r = dessinDuSolDeCave(0, TERRAIN_SCREE)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(pixel(r, x, y)).toBeGreaterThanOrEqual(0)
  })
  it('la lèvre est plus claire que le sol : le fil qui reste quand la lumière est partie', () => {
    const sol = valeur(dessinDuSolDeCave(5, TERRAIN_SCREE))
    for (const cote of [1, 2, 4, 8]) {
      const l = dessinDeLevre(cote)
      const px = cote === 1 ? pixel(l, 8, 0) : cote === 8 ? pixel(l, 8, 15) : cote === 2 ? pixel(l, 15, 8) : pixel(l, 0, 8)
      expect(lum(px)).toBeGreaterThan(sol * 1.3)
    }
  })
})

describe('cave-art — la paroi du dedans', () => {
  it('plus sombre et plus froide que la paroi de la falaise : pas de ciel, pas de soleil', () => {
    for (const mask of [1, 8, 9, 3, 12]) {
      const dehors = dessinDeParoi(mask, 0)
      const dedans = dessinDeParoiDeCave(mask, 0)
      expect(valeur(dedans)).toBeLessThan(valeur(dehors) * 0.8)
      const cd = pixel(dedans, 8, 8)
      const ce = pixel(dehors, 8, 8)
      const froideur = (c: number): number => (c & 255) / Math.max(1, (c >> 16) & 255)
      expect(froideur(cd)).toBeGreaterThan(froideur(ce))
    }
  })
  it('la paroi de cave a la hauteur de la falaise : même roche, même rangée', () => {
    expect(PAROI_RANGEES).toBeGreaterThanOrEqual(1)
    expect(GUEULE_RANGEES).toBe(3)
  })
})

describe('cave-art — la gueule, vue de dehors', () => {
  it('la gueule fait DEUX tuiles de large : 32 px, et rien au-delà', () => {
    expect(GUEULE_LARGEUR).toBe(32)
    const tout = dessinDeLaGueuleEntiere()
    expect(Math.max(...tout.map((r) => r.x + r.w))).toBeLessThanOrEqual(GUEULE_LARGEUR)
    expect(Math.min(...tout.map((r) => r.x))).toBeGreaterThanOrEqual(0)
    // Au seuil (dernière ligne de paroi), l'ouverture dépasse la tuile et demie : une porte.
    const r = dessinDeLaGueule(1)
    let g = GUEULE_LARGEUR
    let d = -1
    for (let x = 0; x < GUEULE_LARGEUR; x++) if (pixel(r, x, 15) >= 0) { g = Math.min(g, x); d = Math.max(d, x) }
    expect(d - g + 1).toBeGreaterThanOrEqual(24)
  })
  it('le linteau est de la roche : les coins du haut sont transparents, la paroi se voit à travers', () => {
    expect(pixel(dessinDeLaGueule(0), 0, 0)).toBe(-1)
    expect(pixel(dessinDeLaGueule(0), GUEULE_LARGEUR - 1, 0)).toBe(-1)
    // Et la fissure du haut est ÉTROITE : la roche tient encore à 8 px du centre.
    expect(pixel(dessinDeLaGueule(0), 8, 5)).toBe(-1)
    expect(pixel(dessinDeLaGueule(0), 23, 5)).toBe(-1)
  })
  it('le fond est plus noir en haut qu\'au seuil : la fente s\'enfonce vers le nord', () => {
    const haut = pixel(dessinDeLaGueule(0), 15, 6)
    const bas = pixel(dessinDeLaGueule(1), 15, 8)
    expect(haut).toBeGreaterThanOrEqual(0)
    expect(bas).toBeGreaterThanOrEqual(0)
    expect(lum(haut)).toBeLessThan(lum(bas))
  })
  it('le fond de la gueule est plus noir que la paroi qu\'elle fend', () => {
    const paroi = valeur(dessinDeParoi(1, 0))
    expect(lum(pixel(dessinDeLaGueule(1), 15, 8))).toBeLessThan(paroi * 0.4)
  })
  it('le dégradé du fond ne repart pas au noir à la couture des rangées', () => {
    // Dernière ligne ouverte de la rangée 0 (abs 15) et première de la rangée 1 (abs 16), même
    // colonne : le fond s'éclaircit en descendant, il ne peut pas RECULER entre les deux.
    const bas0 = pixel(dessinDeLaGueule(0), 15, 15)
    const haut1 = pixel(dessinDeLaGueule(1), 15, 0)
    expect(bas0).toBeGreaterThanOrEqual(0)
    expect(haut1).toBeGreaterThanOrEqual(0)
    expect(lum(haut1)).toBeGreaterThanOrEqual(lum(bas0))
  })
  it('la gueule entière est UNE image de trois rangées, sans couture : chaque rangée s\'y retrouve', () => {
    const tout = dessinDeLaGueuleEntiere()
    for (let rang = 0; rang < GUEULE_RANGEES; rang++) {
      for (const [x, y] of [[15, 8], [2, 8], [29, 8], [0, 0], [31, 15]] as const) {
        expect(pixel(tout, x, y + rang * 16)).toBe(pixel(dessinDeLaGueule(rang), x, y))
      }
    }
    expect(Math.max(...tout.map((r) => r.y + r.h))).toBeLessThanOrEqual(GUEULE_RANGEES * 16)
  })
  it('la lèvre ouest est claire, la joue est sombre : le jour vient de l\'ouest', () => {
    const r = dessinDeLaGueule(1)
    // Sur la ligne 8 de la rangée 1 (abs 24) le profil est [3, 28] : lèvre en 2, joue en 29.
    expect(lum(pixel(r, 2, 8))).toBeGreaterThan(lum(pixel(r, 29, 8)) * 3)
  })
})

describe('cave-art — la nappe de jour', () => {
  it('décroît du seuil (en bas) vers le fond (en haut), sur JOUR_RANGEES rangées', () => {
    const r = dessinDuJour()
    const h = JOUR_RANGEES * 16
    const mx = GUEULE_LARGEUR / 2
    const alphaA = (y: number): number => r.filter((q) => y >= q.y && y < q.y + q.h && q.x <= mx && mx < q.x + q.w).reduce((m, q) => Math.max(m, q.a ?? 1), 0)
    let prev = alphaA(h - 1)
    for (let y = h - 5; y >= 0; y -= 4) {
      const a = alphaA(y)
      expect(a).toBeLessThanOrEqual(prev)
      prev = a
    }
    expect(alphaA(h - 1)).toBeGreaterThan(alphaA(0) * 5)
  })
})
