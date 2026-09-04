/**
 * LE CHAMP DE RIVE (spec eau-vivante R1-R2) — le SDF de berge, testé en pur.
 * Le zéro DOIT tomber sur l'arête entre une tuile d'eau et sa voisine de terre :
 * c'est lui qui aligne l'écume du shader, l'immersion des acteurs et le trait de
 * rive du masque binaire — trois lecteurs, une seule vérité.
 */
import { describe, expect, it } from 'vitest'
import {
  buildRiveField,
  buildWaterField,
  CHUTE_LEVRE_E,
  CHUTE_LEVRE_N,
  CHUTE_LEVRE_O,
  CHUTE_PIED_N,
  CHUTE_RIDEAU_E,
  CHUTE_RIDEAU_O,
  chutesDe,
  MASQUE_EAU,
  riveAt,
  RIVE_MAX_TILES,
} from './water-field'

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

  it('G et B valent 128 PARTOUT — « pas de courant » se décode (0,0) exactement', () => {
    // Ces canaux portent le courant (flow-field), décodé (v−128/255)·255/112 par le
    // shader : un octet à 0 y mettrait une dérive diagonale plein pot (revue, bloquant).
    // Les TROIS chemins d'écriture (terre loin, eau loin, cellule près de la rive)
    // doivent poser 128 — la mare 4×4 dans un pré les traverse tous.
    const { terrain, w, h } = mare()
    const f = buildRiveField(terrain, w, h)
    for (let i = 0; i < w * h; i++) {
      expect(f.data[i * 4 + 1]).toBe(128)
      expect(f.data[i * 4 + 2]).toBe(128)
    }
  })

  it('la diagonale approche l’euclidien (chanfrein 3-4 : 4/3 ≈ √2)', () => {
    const { terrain, w, h } = mare()
    const f = buildRiveField(terrain, w, h)
    // La terre en diagonale du coin d'eau (3,3) touche l'eau (4,4) : 4/3 − 0,5 ≈ 0,83.
    expect(f.sd[3 * w + 3]).toBeCloseTo(-(4 / 3 - 0.5), 5)
  })
})

describe('les chutes qui ne font pas face (terrasses.md T-R8quater) — les drapeaux du canal R', () => {
  /** Un canal d'eau 3 tuiles de large, 12 de long, tout en eau, dont les paliers se dictent. */
  function canal(palierDe: (x: number, y: number) => number): { terrain: number[]; palier: number[]; w: number; h: number } {
    const w = 3
    const h = 12
    const terrain = new Array(w * h).fill(EAU)
    const palier = new Array(w * h).fill(0)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) palier[y * w + x] = palierDe(x, y)
    return { terrain, palier, w, h }
  }

  it('une marche vers le NORD : la lèvre sur la tuile haute, le pied trois tuiles au nord sur la basse, la brume une de plus', () => {
    // Le fleuve coule vers le nord : palier 1 au sud (y ≥ 8), palier 0 au nord.
    const { terrain, palier, w, h } = canal((_x, y) => (y >= 8 ? 1 : 0))
    const f = chutesDe(terrain, w, h, palier)
    const at = (x: number, y: number): number => f[y * w + x]!
    expect(at(1, 8)).toBe(CHUTE_LEVRE_N) // la première tuile haute, sa voisine nord un palier plus bas
    expect(at(1, 9)).toBe(0) // la haute derrière elle : rien
    // Sa lèvre se dessine au rang 8 − 2 = 6 ; la tuile basse (1, 5) se dessine au rang 5 : juste au-dessus.
    expect(at(1, 5)).toBe(CHUTE_PIED_N)
    expect(at(1, 4)).toBe(CHUTE_PIED_N * 2) // une tuile plus loin : la brume
    expect(at(1, 3)).toBe(0)
    // Les basses cachées sous le quad haut (6 et 7) ne portent rien : on ne les verra pas.
    expect(at(1, 7)).toBe(0)
    expect(at(1, 6)).toBe(0)
  })

  it('une marche vers l’EST : la lèvre-colonne sur la haute, le rideau sur les basses une et deux tuiles au nord du pied', () => {
    // La côte : palier 1 à l'ouest (x = 0), palier 0 à l'est (x ≥ 1).
    const { terrain, palier, w, h } = canal((x) => (x === 0 ? 1 : 0))
    const f = chutesDe(terrain, w, h, palier)
    const at = (x: number, y: number): number => f[y * w + x]!
    expect(at(0, 5)).toBe(CHUTE_LEVRE_E)
    expect(at(2, 5)).toBe(0) // à deux tuiles de la couture : rien
    // La paroi de la lèvre (0, 7) occupe, à l'écran, les rangs 5 et 6 : les basses (1, 5) et (1, 6).
    expect(at(1, 5) & CHUTE_RIDEAU_E).toBe(CHUTE_RIDEAU_E)
    expect(at(1, 5) & CHUTE_RIDEAU_O).toBe(0)
    // Au bout sud du canal, la basse (1, 11) n'a plus de lèvre au sud d'elle.
    expect(at(1, 11) & CHUTE_RIDEAU_E).toBe(0)
  })

  it('une marche vers l’OUEST est le miroir exact de la marche vers l’est', () => {
    const { terrain, palier, w, h } = canal((x) => (x === 2 ? 1 : 0))
    const f = chutesDe(terrain, w, h, palier)
    const at = (x: number, y: number): number => f[y * w + x]!
    expect(at(2, 5)).toBe(CHUTE_LEVRE_O)
    expect(at(1, 5) & CHUTE_RIDEAU_O).toBe(CHUTE_RIDEAU_O)
    expect(at(1, 5) & CHUTE_RIDEAU_E).toBe(0)
  })

  it('une marche en ESCALIER (lèvres est d’une tuile, en diagonale) ne garde que ses lèvres nord', () => {
    // Palier 1 sous la diagonale y ≥ 8 − x… : chaque colonne monte une tuile plus tôt que sa voisine ouest.
    const { terrain, palier, w, h } = canal((x, y) => (y >= 9 - x ? 1 : 0))
    const f = chutesDe(terrain, w, h, palier)
    const at = (x: number, y: number): number => f[y * w + x]!
    expect(at(1, 8)).toBe(CHUTE_LEVRE_N) // (1, 8) est haute, (1, 7) basse ; (2, 8) est haute aussi
    expect(at(2, 7) & CHUTE_LEVRE_O).toBe(0) // une lèvre ouest d'une seule tuile : effacée
    expect(at(2, 7) & CHUTE_LEVRE_N).toBe(CHUTE_LEVRE_N)
    expect(Array.from(f).every((v) => (v & (CHUTE_RIDEAU_E | CHUTE_RIDEAU_O)) === 0)).toBe(true)
  })

  it('un décroché de DEUX paliers n’est pas une chute : sa paroi n’est pas celle qu’on a dessinée', () => {
    const { terrain, palier, w, h } = canal((_x, y) => (y >= 8 ? 2 : 0))
    const f = chutesDe(terrain, w, h, palier)
    expect(Array.from(f).every((v) => v === 0)).toBe(true)
  })

  it('le canal R reste un masque : ≥ 128 dans l’eau (128 + drapeaux), 0 sur la terre', () => {
    const { terrain, palier, w, h } = canal((_x, y) => (y >= 8 ? 1 : 0))
    terrain[0] = TERRE
    const f = buildWaterField(terrain, w, h, undefined, palier)
    expect(f.data[0]).toBe(0)
    expect(f.data[(1 * w + 1) * 4]).toBe(MASQUE_EAU)
    expect(f.data[(8 * w + 1) * 4]).toBe(MASQUE_EAU + CHUTE_LEVRE_N)
    // Et sans paliers (la carte plate), aucun drapeau : le masque vaut exactement 128.
    const plat = buildWaterField(terrain, w, h)
    expect(plat.data[(8 * w + 1) * 4]).toBe(MASQUE_EAU)
  })
})
