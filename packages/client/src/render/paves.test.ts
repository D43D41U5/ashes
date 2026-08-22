/**
 * LES PAVÉS — gardes du module pur (spec `sol-dessine.md` R9-R10).
 *
 * Tout se vérifie sur un petit monde bâti à la main : deux terrains, un bord, de l'eau. La
 * propriété affirmée à chaque fois est UNE propriété de l'image cuite — jamais un pixel choisi.
 */
import { describe, expect, it } from 'vitest'
import { PAVE, PAVE_PX, PRIORITE_PAVE, cuireChunk, estStructurel, frange, prioriteDe } from './paves'

const N = PAVE.CHUNK
const S = N * PAVE_PX

/** Un chunk (0,0) dont le terrain est donné par une fonction ; couleur unie, grain plat. */
function cuire(terrainAt: (tx: number, ty: number) => number, couleur = 0x808080): Uint8ClampedArray {
  return cuireChunk({ cx: 0, cy: 0, terrainAt, couleurAt: () => couleur, trameDe: () => null })
}
const px = (img: Uint8ClampedArray, x: number, y: number): [number, number, number, number] => {
  const o = (y * S + x) * 4
  return [img[o]!, img[o + 1]!, img[o + 2]!, img[o + 3]!]
}

describe('l’ordre de recouvrement', () => {
  it('un structurel vaut −1, un terrain inconnu 0, les autres leur rang', () => {
    for (const t of [0, 4, 6, 7, 23]) {
      expect(estStructurel(t)).toBe(true)
      expect(prioriteDe(t)).toBe(-1)
    }
    expect(prioriteDe(99)).toBe(0)
    expect(prioriteDe(17)).toBe(PRIORITE_PAVE[17])
    // La fleuraie recouvre l'herbe, qui recouvre la litière, qui recouvre la roche.
    expect(prioriteDe(17)).toBeGreaterThan(prioriteDe(1))
    expect(prioriteDe(1)).toBeGreaterThan(prioriteDe(3))
    expect(prioriteDe(3)).toBeGreaterThan(prioriteDe(5))
  })

  it('la frange est bornée, irrégulière et déterministe', () => {
    const vus = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const d = frange(i, i * 7, i % 4, i % 4)
      expect(d).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(d).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      vus.add(d)
      expect(frange(i, i * 7, i % 4, i % 4)).toBe(d)
    }
    expect(vus.size).toBe(PAVE.FRANGE_MAX - PAVE.FRANGE_MIN + 1)
  })
})

describe('la cuisson d’un chunk', () => {
  it('un chunk d’un seul terrain est opaque, de la couleur donnée, avec ses seuls brins', () => {
    const img = cuire(() => 1, 0x406080)
    let plats = 0
    let transparents = 0
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const [r, g, b, a] = px(img, x, y)
        if (a !== 255) transparents++
        if (r === 0x40 && g === 0x60 && b === 0x80) plats++
      }
    }
    expect(transparents).toBe(0)
    // Deux brins de 3 px par tuile : au plus 6 × N² pixels marqués, le reste à plat.
    expect(plats).toBeGreaterThanOrEqual(S * S - 6 * N * N)
    expect(plats).toBeLessThan(S * S) // et il y a bien des brins
  })

  it('R10 — l’eau reste transparente, et aucune frange ne déborde dessus', () => {
    // Moitié gauche herbe, moitié droite eau peu profonde.
    const img = cuire((tx) => (tx < N / 2 ? 1 : 4))
    let eauOpaque = 0
    let herbeTransparente = 0
    for (let y = 0; y < S; y++) {
      for (let x = (N / 2) * PAVE_PX; x < S; x++) if (px(img, x, y)[3] !== 0) eauOpaque++
      // Et l'herbe, elle, est opaque jusqu'à son bord.
      if (px(img, (N / 2) * PAVE_PX - 1, y)[3] !== 255) herbeTransparente++
    }
    expect(eauOpaque).toBe(0)
    expect(herbeTransparente).toBe(0)
  })

  it('R9 — le pavé du dessus déborde sur le dessous d’une frange de 2 à 5 px, jamais l’inverse', () => {
    // Gauche : fleuraie (dessus). Droite : herbe (dessous). Bord à x = S/2.
    const bord = (N / 2) * PAVE_PX
    const FLEUR = 0xff0000, HERBE = 0x00ff00
    const img = cuireChunk({
      cx: 0, cy: 0,
      terrainAt: (tx) => (tx < N / 2 ? 17 : 1),
      couleurAt: (tx) => (tx < N / 2 ? FLEUR : HERBE),
      trameDe: () => null,
    })
    const rouge = (x: number, y: number): boolean => { const [r, g] = px(img, x, y); return r > g }
    let debordMin = 99, debordMax = 0
    let herbeSurFleuraie = 0
    for (let y = 0; y < S; y++) {
      // De ce côté-ci du bord, tout est fleuraie (rien ne déborde sur elle).
      for (let x = 0; x < bord; x++) if (!rouge(x, y)) herbeSurFleuraie++
      // De l'autre, la fleuraie avance de d px puis l'herbe reprend.
      let d = 0
      while (d < 8 && rouge(bord + d, y)) d++
      debordMin = Math.min(debordMin, d)
      debordMax = Math.max(debordMax, d)
      expect(rouge(bord + d, y)).toBe(false)
    }
    expect(herbeSurFleuraie).toBe(0)
    expect(debordMin).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
    expect(debordMax).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
    expect(debordMax).toBeGreaterThan(debordMin) // irrégulière : plusieurs profondeurs sur un bord
  })

  it('R9 — le bord bas d’un pavé porte un liseré sombre, et le terrain dessous une ombre', () => {
    // Haut : fleuraie (dessus). Bas : herbe. Bord horizontal à y = S/2.
    const bord = (N / 2) * PAVE_PX
    const img = cuire((_tx, ty) => (ty < N / 2 ? 17 : 1), 0x808080)
    // Ligne par ligne, la luminance moyenne : le liseré (×0,55) sur la dernière ligne du pavé
    // (frange comprise, donc entre bord et bord+5), puis l'ombre (×0,72) dessous, puis le plat.
    const lum = (y: number): number => {
      let s = 0
      for (let x = 0; x < S; x++) s += px(img, x, y)[0]!
      return s / S
    }
    const plat = lum(bord - 10)
    expect(plat).toBeGreaterThan(0x80 * 0.95) // loin des bords : à plat (brins mis à part)
    let sombreVu = false
    for (let y = bord; y < bord + PAVE.FRANGE_MAX + 1; y++) if (lum(y) < plat * 0.8) sombreVu = true
    expect(sombreVu, 'un liseré/une ombre sous le bord bas').toBe(true)
    expect(lum(bord + 12)).toBeGreaterThan(plat * 0.95) // douze px plus bas : le plat a repris
  })

  it('la cuisson est déterministe et indifférente au chunk voisin (pas de couture)', () => {
    // Un monde en damier de 8 tuiles ; le chunk (1,0) recuit → identique.
    const monde = (tx: number, ty: number): number => ((Math.floor(tx / 8) + Math.floor(ty / 8)) % 2 ? 17 : 1)
    const a = cuireChunk({ cx: 1, cy: 0, terrainAt: monde, couleurAt: () => 0x808080, trameDe: () => null })
    const b = cuireChunk({ cx: 1, cy: 0, terrainAt: monde, couleurAt: () => 0x808080, trameDe: () => null })
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    expect(diff).toBe(0)
  })
})
