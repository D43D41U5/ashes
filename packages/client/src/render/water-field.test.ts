/**
 * LE CHAMP DE RIVE (spec eau-vivante R1-R2) — le SDF de berge, testé en pur.
 * Le zéro DOIT tomber sur l'arête entre une tuile d'eau et sa voisine de terre :
 * c'est lui qui aligne l'écume du shader, l'immersion des acteurs et le trait de
 * rive du masque binaire — trois lecteurs, une seule vérité.
 */
import { describe, expect, it } from 'vitest'
import { buildRiveField, riveAt, RIVE_MAX_TILES } from './water-field'

const EAU = 4
const TERRE = 1

/** Une mare 4×4 au centre d'un pré 12×12. */
function mare(): { terrain: number[]; w: number; h: number } {
  const w = 12
  const h = 12
  const terrain = new Array(w * h).fill(TERRE)
  for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) terrain[y * w + x] = EAU
  return { terrain, w, h }
}

describe('le champ de rive — un SDF de berge (eau-vivante R1)', () => {
  it('est positif dans l’eau, négatif sur terre, et le zéro tombe sur l’arête', () => {
    const { terrain, w, h } = mare()
    const f = buildRiveField(terrain, w, h)
    // Centres : tuile d'eau du bord (4,5) → +0,5 ; tuile de terre adjacente (3,5) → −0,5.
    expect(f.sd[5 * w + 4]).toBeCloseTo(0.5, 5)
    expect(f.sd[5 * w + 3]).toBeCloseTo(-0.5, 5)
    // Le bilinéaire croise 0 EXACTEMENT sur l'arête x=4 (entre les centres 3,5 et 4,5).
    expect(riveAt(f, 4.0, 5.5)).toBeCloseTo(0, 5)
    // Et il est continu : un cran dedans, un cran dehors.
    expect(riveAt(f, 4.25, 5.5)).toBeCloseTo(0.25, 5)
    expect(riveAt(f, 3.75, 5.5)).toBeCloseTo(-0.25, 5)
  })

  it('croît vers le cœur de l’eau et vers l’intérieur des terres', () => {
    const { terrain, w, h } = mare()
    const f = buildRiveField(terrain, w, h)
    // Cœur de la mare (5,5)-(6,6) : à 1,5 tuile du bord le plus proche… en fait 2 tuiles
    // de centre à centre − 0,5 = 1,5.
    expect(f.sd[5 * w + 5]).toBeCloseTo(1.5, 5)
    // Terre à 3 tuiles du bord de l'eau.
    expect(f.sd[5 * w + 1]).toBeCloseTo(-2.5, 5)
    // Loin de tout : borné à ±RIVE_MAX_TILES (le coin du pré).
    expect(f.sd[0]).toBeGreaterThanOrEqual(-RIVE_MAX_TILES)
    expect(f.sd[0]).toBeLessThan(-2)
  })

  it('encode la texture en 128 + d×16, alpha plein (jamais prémultiplié à tort)', () => {
    const { terrain, w, h } = mare()
    const f = buildRiveField(terrain, w, h)
    const i = 5 * w + 4 // +0,5 tuile → 136
    expect(f.data[i * 4]).toBe(136)
    expect(f.data[i * 4 + 3]).toBe(255)
    const j = 5 * w + 3 // −0,5 tuile → 120
    expect(f.data[j * 4]).toBe(120)
  })

  it('la diagonale approche l’euclidien (chanfrein 3-4 : 4/3 ≈ √2)', () => {
    const { terrain, w, h } = mare()
    const f = buildRiveField(terrain, w, h)
    // La terre en diagonale du coin d'eau (3,3) touche l'eau (4,4) : 4/3 − 0,5 ≈ 0,83.
    expect(f.sd[3 * w + 3]).toBeCloseTo(-(4 / 3 - 0.5), 5)
  })
})
