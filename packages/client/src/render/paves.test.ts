/**
 * LES PAVÉS — gardes du module pur (spec `sol-dessine.md` R9-R10).
 *
 * Tout se vérifie sur un petit monde bâti à la main : deux terrains, un bord, de l'eau. La
 * propriété affirmée à chaque fois est UNE propriété de l'image cuite — jamais un pixel choisi.
 */
import { describe, expect, it } from 'vitest'
import { PAVE, PAVE_PX, PRIORITE_PAVE, SURFACES, cuireChunk, estEau, estStructurel, estSurface, frange, prioriteDe } from './paves'

const N = PAVE.CHUNK
const S = N * PAVE_PX

/** Un chunk (0,0) dont le terrain est donné par une fonction ; couleur unie, grain plat. Le SOL. */
function cuire(terrainAt: (tx: number, ty: number) => number, couleur = 0x808080): Uint8ClampedArray {
  return cuireChunk({ cx: 0, cy: 0, terrainAt, couleurAt: () => couleur, trameDe: () => null }).sol
}
const px = (img: Uint8ClampedArray, x: number, y: number): [number, number, number, number] => {
  const o = (y * S + x) * 4
  return [img[o]!, img[o + 1]!, img[o + 2]!, img[o + 3]!]
}

describe('l’ordre de recouvrement', () => {
  it('un structurel vaut −1, l’eau et un terrain inconnu 0, les autres leur rang', () => {
    for (const t of [0, 7, 23]) {
      expect(estStructurel(t)).toBe(true)
      expect(prioriteDe(t)).toBe(-1)
    }
    for (const t of [4, 6]) {
      expect(estEau(t)).toBe(true)
      expect(estStructurel(t)).toBe(false)
      expect(prioriteDe(t)).toBe(0) // l'eau cède à toute terre, et ne recouvre rien
    }
    expect(prioriteDe(99)).toBe(0)
    expect(prioriteDe(17)).toBe(PRIORITE_PAVE[17])
    // LE MARAIS EST UNE SURFACE : au-dessus de l'eau, sous TOUTE terre — aucune égalité possible
    // (une égalité est une couture nue : c'était le défaut marais / prairie humide).
    for (const t of [8, 18]) {
      expect(estSurface(t)).toBe(true)
      expect(prioriteDe(t)).toBeGreaterThan(prioriteDe(4))
    }
    for (const [t, rang] of Object.entries(PRIORITE_PAVE)) {
      expect(estSurface(Number(t))).toBe(false)
      expect(rang, `la terre ${t} domine toute surface`).toBeGreaterThan(Math.max(...Object.values(SURFACES)))
    }
    expect(prioriteDe(19)).toBeGreaterThan(prioriteDe(8)) // roselière sur marais
    expect(prioriteDe(25)).toBeGreaterThan(prioriteDe(19)) // prairie humide sur roselière (A11)
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

  it('R10 — la falaise reste transparente dans le sol, et aucune frange ne déborde dessus', () => {
    // Moitié gauche herbe, moitié droite falaise.
    const cuit = cuireChunk({ cx: 0, cy: 0, terrainAt: (tx) => (tx < N / 2 ? 1 : 23), couleurAt: () => 0x808080, trameDe: () => null })
    const img = cuit.sol
    let falaiseOpaque = 0
    let herbeTransparente = 0
    for (let y = 0; y < S; y++) {
      for (let x = (N / 2) * PAVE_PX; x < S; x++) if (px(img, x, y)[3] !== 0) falaiseOpaque++
      // Et l'herbe, elle, est opaque jusqu'à son bord.
      if (px(img, (N / 2) * PAVE_PX - 1, y)[3] !== 255) herbeTransparente++
    }
    expect(falaiseOpaque).toBe(0)
    expect(herbeTransparente).toBe(0)
    expect(cuit.surplomb).toBeNull() // pas d'eau : pas de surplomb
  })

  it('LA BERGE — la terre déborde sur l’eau dans le SURPLOMB, l’eau nue reste au shader', () => {
    // Haut : herbe. Bas : eau peu profonde. Bord à y = S/2.
    const bord = (N / 2) * PAVE_PX
    const cuit = cuireChunk({ cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 1 : 4), couleurAt: () => 0x808080, trameDe: () => null })
    const sur = cuit.surplomb
    expect(sur).not.toBeNull()
    // Dans le SOL, l'eau est transparente partout (la frange n'y est pas : elle passe au-dessus du shader).
    let solSurEau = 0
    for (let y = bord; y < S; y++) for (let x = 0; x < S; x++) if (px(cuit.sol, x, y)[3] !== 0) solSurEau++
    expect(solSurEau).toBe(0)
    // Dans le SURPLOMB : rien sur la terre ; sur l'eau, une frange OPAQUE de 2-5 px (gris 0x80 ×
    // liseré/plat, donc un pixel GRIS, pas un voile), puis un voile d'ombre (noir, alpha < 255),
    // puis à 4 px le ressac (blanc, alpha < 255), puis plus rien.
    let surTerre = 0
    for (let y = 0; y < bord; y++) for (let x = 0; x < S; x++) if (px(sur!, x, y)[3] !== 0) surTerre++
    expect(surTerre).toBe(0)
    let frangeMin = 99, frangeMax = 0, ombres = 0, ressacs = 0, nus = 0
    for (let x = 0; x < S; x++) {
      let d = 0
      while (d < 8 && px(sur!, x, bord + d)[3] === 255) d++
      frangeMin = Math.min(frangeMin, d)
      frangeMax = Math.max(frangeMax, d)
      // Sous la frange : ombre (noir translucide) sur 3 px, ressac (blanc translucide) au 4e.
      const [r1, , , a1] = px(sur!, x, bord + d)
      if (a1 > 0 && a1 < 255 && r1 === 0) ombres++
      const [r4, , , a4] = px(sur!, x, bord + d + 3)
      if (a4 > 0 && a4 < 255 && r4 === 255) ressacs++
      if (px(sur!, x, bord + d + 6)[3] === 0) nus++
    }
    expect(frangeMin).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
    expect(frangeMax).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
    expect(ombres).toBe(S)
    expect(ressacs).toBe(S)
    expect(nus).toBe(S)
  })

  it('LE HAUT-FOND RESTE UNE SURFACE — rien ne déborde entre haut-fond et profond', () => {
    const cuit = cuireChunk({ cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 4 : 6), couleurAt: () => 0x808080, trameDe: () => null })
    let marques = 0
    for (let i = 3; i < cuit.sol.length; i += 4) if (cuit.sol[i] !== 0) marques++
    if (cuit.surplomb) for (let i = 3; i < cuit.surplomb.length; i += 4) if (cuit.surplomb[i] !== 0) marques++
    expect(marques).toBe(0)
  })

  it('LE MARAIS EST UNE SURFACE — la prairie humide y est une berge : liseré, ombre, ressac ; le marais nu est plat', () => {
    // Haut : prairie humide. Bas : marais. Bord à y = S/2. Tout dans le SOL (le marais n'est pas
    // de l'eau : pas de surplomb).
    const bord = (N / 2) * PAVE_PX
    const cuit = cuireChunk({ cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 25 : 8), couleurAt: () => 0x808080, trameDe: () => null })
    expect(cuit.surplomb).toBeNull()
    const img = cuit.sol
    const lum = (y: number): number => {
      let s = 0
      for (let x = 0; x < S; x++) s += px(img, x, y)[0]!
      return s / S
    }
    // Colonne par colonne : la frange (plat ou liseré), puis l'ombre (×0,72), la pénombre, puis
    // le ressac (×1,22 — PLUS CLAIR que le plat) au 4e px sous le bord bas, puis le plat.
    let ombres = 0, ressacs = 0
    for (let x = 0; x < S; x++) {
      let d = 0
      while (d < PAVE.FRANGE_MAX + 1 && px(img, x, bord + d)[0]! <= 0x80 * 0.6) d++ // le liseré, s'il tombe ici
      // Cherche dans les 8 px sous le bord : une ombre puis, plus bas, un pixel plus clair que 0x80.
      let ombreVue = false
      for (let y = bord; y < bord + 10; y++) {
        const r = px(img, x, y)[0]!
        if (r > 0 && r < 0x80 * 0.8) ombreVue = true
        else if (ombreVue && r > 0x80 * 1.1) { ressacs++; break }
      }
      if (ombreVue) ombres++
    }
    expect(ombres).toBe(S)
    expect(ressacs).toBe(S)
    // Le marais nu, loin du bord : plat, SANS brin — une surface n'a pas de brin.
    let marques = 0
    for (let y = bord + 16; y < S; y++) for (let x = 0; x < S; x++) if (px(img, x, y)[0] !== 0x80) marques++
    expect(marques).toBe(0)
    // La prairie humide, elle, porte ses brins.
    expect(lum(bord - 24)).not.toBe(0x80)
  })

  it('LE MARAIS EST UNE SURFACE — sur l’eau, il déborde d’une frange seule : ni liseré, ni ombre, ni ressac', () => {
    // Haut : marais. Bas : eau peu profonde. Bord à y = S/2.
    const bord = (N / 2) * PAVE_PX
    const cuit = cuireChunk({ cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 8 : 4), couleurAt: () => 0x808080, trameDe: () => null })
    const sur = cuit.surplomb
    expect(sur).not.toBeNull()
    // Dans le sol, le marais est plat partout jusqu'au bord : aucun liseré (×0,55) sur sa dernière ligne.
    let liseres = 0
    for (let y = 0; y < bord; y++) for (let x = 0; x < S; x++) if (px(cuit.sol, x, y)[0]! < 0x80 * 0.9) liseres++
    expect(liseres).toBe(0)
    // Dans le surplomb : une frange OPAQUE de 2-5 px de marais, puis RIEN — pas de voile d'ombre,
    // pas de ressac (une surface ne porte pas d'ombre).
    let frangeMin = 99, frangeMax = 0, voiles = 0
    for (let x = 0; x < S; x++) {
      let d = 0
      while (d < 8 && px(sur!, x, bord + d)[3] === 255) d++
      frangeMin = Math.min(frangeMin, d)
      frangeMax = Math.max(frangeMax, d)
      for (let y = bord + d; y < bord + d + 8; y++) if (px(sur!, x, y)[3] !== 0) voiles++
    }
    expect(frangeMin).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
    expect(frangeMax).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
    expect(voiles).toBe(0)
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
    }).sol
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
    const a = cuireChunk({ cx: 1, cy: 0, terrainAt: monde, couleurAt: () => 0x808080, trameDe: () => null }).sol
    const b = cuireChunk({ cx: 1, cy: 0, terrainAt: monde, couleurAt: () => 0x808080, trameDe: () => null }).sol
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    expect(diff).toBe(0)
  })
})
