/**
 * LA CHUTE D'UN ARBRE — ce qui se prouve sans navigateur.
 *
 * Le piège de cette animation est une PROJECTION : un arbre qui tombe vers le nord
 * s'enfonce dans la profondeur, et à l'écran sa pointe ne bouge pas. La chute serait
 * jouée, la donnée dirait « animation en cours », et le joueur ne verrait rien. C'est
 * exactement le genre d'échec qu'aucune capture ne rattrape (on regarderait au bon
 * endroit et il n'y aurait rien à voir) — donc il se prouve ici, sur toute la rose des
 * directions, jamais sur trois cas choisis.
 */
import { describe, expect, it } from 'vitest'
import { ARBRES } from '../../render/arbre-art'
import { angleChute, courbeChute, deplacementPointe, POINTE_MIN_PX } from './chute-arbre'

/** Les deux fûts du jeu : l'arbre ordinaire et le gros bois. */
const FUTS = [ARBRES.tree.futH, ARBRES.old_tree.futH]

describe('deplacementPointe — la géométrie de la projection, sans détour', () => {
  it('est NUL vers le nord : un arbre qui part dans la profondeur ne tourne pas', () => {
    expect(deplacementPointe(-Math.PI / 2, 30)).toBeCloseTo(0, 6)
  })

  it('est MAXIMAL vers le sud : il tombe vers la caméra, la pointe fait deux hauteurs', () => {
    expect(deplacementPointe(Math.PI / 2, 30)).toBeCloseTo(60, 6)
  })

  it('croît avec la hauteur du fût — un gros bois se voit tomber de plus loin', () => {
    expect(deplacementPointe(0, ARBRES.old_tree.futH)).toBeGreaterThan(deplacementPointe(0, ARBRES.tree.futH))
  })
})

describe('angleChute — aucune direction ne produit une chute invisible', () => {
  it.each(FUTS)('fût de %i px : la pointe parcourt toujours le minimum visible', (futH: number) => {
    // BALAYAGE EXHAUSTIF. La faute qu'on chasse est un TROU dans la rose des directions :
    // elle ne se prouve pas absente sur quelques azimuts.
    for (let deg = 0; deg < 360; deg += 3) {
      const rad = (deg * Math.PI) / 180
      const alpha = angleChute(Math.cos(rad), Math.sin(rad), futH)
      // De la rotation du sprite on RETROUVE l'azimut réellement joué (α = π/2 − φ), et
      // c'est celui-là qu'on mesure — pas celui qu'on avait demandé.
      const phiJoue = Math.PI / 2 - alpha
      expect(deplacementPointe(phiJoue, futH)).toBeGreaterThanOrEqual(POINTE_MIN_PX - 1e-9)
    }
  })

  it('garde le CÔTÉ demandé quand il rabat une chute plein nord', () => {
    // Nord-est → rabattu, mais toujours vers l'EST (sin de la rotation > 0).
    expect(Math.sin(angleChute(0.3, -1, 30))).toBeGreaterThan(0)
    // Nord-ouest → toujours vers l'OUEST.
    expect(Math.sin(angleChute(-0.3, -1, 30))).toBeLessThan(0)
  })

  it('ne touche PAS aux directions qui se voient déjà', () => {
    // Plein est : la pointe parcourt 1,41 fût, largement au-dessus du minimum — l'angle
    // doit sortir intact (π/2), sans rabattement parasite.
    expect(angleChute(1, 0, 30)).toBeCloseTo(Math.PI / 2, 6)
    // Plein sud : le maximum, intact lui aussi.
    expect(angleChute(0, 1, 30)).toBeCloseTo(0, 6)
  })

  it('une direction NULLE reste une chute, pas un NaN', () => {
    const a = angleChute(0, 0, 30)
    expect(Number.isNaN(a)).toBe(false)
    expect(deplacementPointe(Math.PI / 2 - a, 30)).toBeGreaterThanOrEqual(POINTE_MIN_PX - 1e-9)
  })
})

describe('courbeChute — un arbre ACCÉLÈRE, puis s’arrête net', () => {
  it('part de zéro et finit à l’aplomb du sol', () => {
    expect(courbeChute(0)).toBe(0)
    expect(courbeChute(1)).toBe(1)
    expect(courbeChute(-1)).toBe(0)
    expect(courbeChute(3)).toBe(1)
  })

  it('ACCÉLÈRE : la première moitié couvre moins de terrain que la seconde', () => {
    // C'est tout ce qui sépare un arbre qui tombe d'une barrière qui se baisse.
    expect(courbeChute(0.5)).toBeLessThan(0.5)
  })

  it('ne recule jamais pendant la chute — un arbre ne se relève pas à mi-course', () => {
    let precedent = 0
    for (let k = 0; k <= 0.86; k += 0.01) {
      const v = courbeChute(k)
      expect(v).toBeGreaterThanOrEqual(precedent - 1e-9)
      precedent = v
    }
  })

  it('DÉPASSE puis revient : le contrecoup du fût qui touche le sol', () => {
    const sommet = Math.max(...Array.from({ length: 40 }, (_, i) => courbeChute(0.86 + (i / 40) * 0.14)))
    expect(sommet).toBeGreaterThan(1) // il dépasse…
    expect(sommet).toBeLessThan(1.08) // …d'un cheveu, pas d'un ressort
    expect(courbeChute(1)).toBe(1) // …et il revient se poser exactement à plat
  })
})
