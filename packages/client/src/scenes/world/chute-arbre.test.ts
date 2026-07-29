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

/**
 * OÙ TOMBE LA POINTE, VRAIMENT — la mesure se prend sur le SPRITE, pas sur l'azimut.
 *
 * L'ancienne garde inversait la rotation avec la formule qu'elle était censée vérifier
 * (`φ = π/2 − α`) : elle mesurait donc la direction DEMANDÉE, quelle que soit celle qui
 * était jouée, et une symétrie nord↔sud lui était invisible — c'est exactement la faute
 * qui a survécu jusqu'au 29/07. On repart du seul fait que le rendu utilise : un fût
 * d'origine (0.5, 1) qui pointe vers le HAUT, tourné de `α`, a sa pointe en
 * `h·(sin α, −cos α)`.
 */
const pointe = (alpha: number, futH: number): { x: number; y: number } => ({
  x: futH * Math.sin(alpha),
  y: -futH * Math.cos(alpha),
})

describe('angleChute — aucune direction ne produit une chute invisible', () => {
  it.each(FUTS)('fût de %i px : la pointe parcourt toujours le minimum visible', (futH: number) => {
    // BALAYAGE EXHAUSTIF. La faute qu'on chasse est un TROU dans la rose des directions :
    // elle ne se prouve pas absente sur quelques azimuts.
    for (let deg = 0; deg < 360; deg += 3) {
      const rad = (deg * Math.PI) / 180
      const p = pointe(angleChute(Math.cos(rad), Math.sin(rad), futH), futH)
      // Distance parcourue par la pointe, du repos (0, −h) à sa place couchée.
      const parcours = Math.sqrt(p.x * p.x + (p.y + futH) * (p.y + futH))
      expect(parcours).toBeGreaterThanOrEqual(POINTE_MIN_PX - 1e-9)
    }
  })

  it.each(FUTS)('fût de %i px : l’arbre tombe DU CÔTÉ demandé, jamais du côté opposé', (futH: number) => {
    // LA GARDE QUI MANQUAIT. Le rabattement a le droit de changer l'azimut ; il n'a jamais
    // le droit de changer d'hémisphère (il ne fait que rapprocher la chute du sud, en
    // gardant son bord). Un arbre qui s'abat sur le bûcheron rend ce produit NÉGATIF —
    // c'est ce que faisait `π/2 − φ` sur toute la rose sauf l'axe est-ouest.
    for (let deg = 0; deg < 360; deg += 3) {
      const rad = (deg * Math.PI) / 180
      const dx = Math.cos(rad)
      const dy = Math.sin(rad)
      const p = pointe(angleChute(dx, dy, futH), futH)
      expect(p.x * dx + p.y * dy).toBeGreaterThan(0)
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
    // Plein sud : le maximum, intact lui aussi — un demi-tour, le fût vient à la caméra.
    // (Cette ligne attendait 0, c'est-à-dire un arbre qui ne bouge pas : la faute EN GARDE.)
    expect(angleChute(0, 1, 30)).toBeCloseTo(Math.PI, 6)
    // Plein ouest : le chemin le plus court, donc −π/2 et non 3π/2 — pas de pirouette.
    expect(angleChute(-1, 0, 30)).toBeCloseTo(-Math.PI / 2, 6)
  })

  it('ne fait JAMAIS plus d’un demi-tour : le sol est du bon côté', () => {
    // La borne qui interdit la pirouette, sur toute la rose et les deux fûts.
    for (const futH of FUTS) {
      for (let deg = 0; deg < 360; deg += 3) {
        const rad = (deg * Math.PI) / 180
        expect(Math.abs(angleChute(Math.cos(rad), Math.sin(rad), futH))).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })

  it('une direction NULLE reste une chute, pas un NaN', () => {
    const a = angleChute(0, 0, 30)
    expect(Number.isNaN(a)).toBe(false)
    const p = pointe(a, 30)
    expect(Math.sqrt(p.x * p.x + (p.y + 30) * (p.y + 30))).toBeGreaterThanOrEqual(POINTE_MIN_PX - 1e-9)
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
