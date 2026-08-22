/**
 * LE MANTEAU — gardes du module pur (spec `sol-dessine.md` R16).
 *
 * Un petit monde bâti à la main : une moitié sous la neige, une moitié nue, un lac gelé. La
 * propriété affirmée est une propriété de l'image cuite — balayée sur tout un bord, jamais un
 * pixel choisi.
 */
import { describe, expect, it } from 'vitest'
import { PAVE, PAVE_PX, prioriteDe } from './paves'
import {
  NEIGE_PAVE, TUILE_GLACE_GUE, TUILE_GLACE_LAC, TUILE_NEIGE, TUILE_NEIGE_PROFONDE, TUILE_NUE, TUILE_STRUCTURELLE,
  cuireManteau, trameDeGlace, tuileDeNiveau, type EtatTuile,
} from './manteau'
import { DESSOUS, GLACE_GUE, GLACE_LAC, MANTEAU, MANTEAU_PROFOND } from './paves'

const N = PAVE.CHUNK
const S = N * PAVE_PX
const P = PAVE_PX

function cuire(etatAt: (tx: number, ty: number) => EtatTuile) {
  return cuireManteau({ cx: 0, cy: 0, etatAt, trameNeige: null, trameGlace: trameDeGlace() })
}
const px = (img: Uint8ClampedArray | null, x: number, y: number): [number, number, number, number] => {
  if (!img) return [0, 0, 0, 0]
  const o = (y * S + x) * 4
  return [img[o]!, img[o + 1]!, img[o + 2]!, img[o + 3]!]
}
const R = (c: number) => (c >> 16) & 0xff

describe('les terrains virtuels', () => {
  it('la neige domine tout, la profonde domine la poudreuse, le dessous et la glace sont des surfaces de rang 0', () => {
    expect(prioriteDe(MANTEAU)).toBeGreaterThan(prioriteDe(17)) // plus haut que la fleuraie
    expect(prioriteDe(MANTEAU_PROFOND)).toBeGreaterThan(prioriteDe(MANTEAU))
    expect(tuileDeNiveau(0)).toBe(TUILE_NUE)
    expect(tuileDeNiveau(1)).toBe(TUILE_NEIGE)
    expect(tuileDeNiveau(2)).toBe(TUILE_NEIGE_PROFONDE)
    expect(prioriteDe(DESSOUS)).toBe(0)
    expect(prioriteDe(GLACE_GUE)).toBe(0)
    expect(prioriteDe(GLACE_LAC)).toBe(0)
  })
})

describe('le manteau cuit', () => {
  // La moitié haute (ty < 8) sous la neige, la moitié basse nue.
  const neigeEnHaut = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE : TUILE_NUE)

  it('la neige est OPAQUE sur tout son corps ; le sol nu est transparent', () => {
    const { sol } = cuire(neigeEnHaut)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const a = px(sol, x, y)[3]
        if (y < 8 * P) expect(a, `neige opaque en (${x},${y})`).toBe(255)
        else expect(a, `sol nu transparent en (${x},${y})`).toBe(0)
      }
    }
  })

  it('sur le sol nu, le surplomb porte une frange de neige opaque de 2-5 px, puis un voile d’ombre, puis rien — jamais de ressac', () => {
    const { surplomb } = cuire(neigeEnHaut)
    expect(surplomb).not.toBeNull()
    const bord = 8 * P
    for (let x = 0; x < S; x++) {
      let y = bord
      let frange = 0
      while (y < S && px(surplomb, x, y)[3] === 255) { frange++; y++ }
      expect(frange, `frange en x=${x}`).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(frange, `frange en x=${x}`).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      // Le bas de la frange est le bord du pavé : il porte le LISERÉ (l'épaisseur de la neige).
      expect(px(surplomb, x, y - 1)[0], `liseré en x=${x}`).toBeLessThan(R(NEIGE_PAVE.NEIGE) * 0.7)
      // Et le corps de la frange, au-dessus, est de la neige claire.
      if (frange > 2) expect(px(surplomb, x, bord)[0]).toBeGreaterThan(R(NEIGE_PAVE.NEIGE) * 0.9) // sous 3 px : liseré + tranche seuls
      // L'ombre : un voile NOIR translucide.
      let ombre = 0
      while (y < S && px(surplomb, x, y)[3] > 0 && px(surplomb, x, y)[0] === 0) { ombre++; y++ }
      expect(ombre, `ombre en x=${x}`).toBeGreaterThanOrEqual(2)
      // Puis plus rien : pas de ressac (un pixel BLANC translucide), pas de seconde marque.
      for (; y < S; y++) expect(px(surplomb, x, y)[3], `rien sous l'ombre en (${x},${y})`).toBe(0)
    }
  })

  it('la glace est une surface opaque dans le sol, plate, sans frange sur le sol nu', () => {
    const glaceAGauche = (tx: number): EtatTuile => (tx < 8 ? TUILE_GLACE_LAC : TUILE_NUE)
    const { sol, surplomb } = cuire(glaceAGauche)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < 8 * P; x++) expect(px(sol, x, y)[3]).toBe(255)
      for (let x = 8 * P; x < S; x++) expect(px(sol, x, y)[3]).toBe(0)
    }
    // Aucun débordement : le surplomb, s'il existe, est vide.
    if (surplomb) for (let i = 3; i < surplomb.length; i += 4) expect(surplomb[i]).toBe(0)
    // Le givre : des cellules plus claires, mais la glace reste bleue (R < B).
    let claires = 0
    for (let y = 0; y < 8 * P; y++) for (let x = 0; x < 8 * P; x++) {
      const c = px(sol, x, y)
      expect(c[2]).toBeGreaterThan(c[0])
      if (c[0] > R(NEIGE_PAVE.GLACE_LAC) + 4) claires++
    }
    expect(claires / (64 * P * P)).toBeGreaterThan(0.1)
    expect(claires / (64 * P * P)).toBeLessThan(0.35)
  })

  it('la neige déborde sur la glace : frange opaque et ombre dans le surplomb, glace opaque dessous', () => {
    const neigeSurLac = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE : TUILE_GLACE_GUE)
    const { sol, surplomb } = cuire(neigeSurLac)
    expect(surplomb).not.toBeNull()
    const bord = 8 * P
    for (let x = 0; x < S; x++) {
      let y = bord
      let frange = 0
      while (y < S && px(surplomb, x, y)[3] === 255) { frange++; y++ }
      expect(frange).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(frange).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      // Sous la frange, la glace est là, opaque, et OMBRÉE (plus sombre que la glace nue).
      const ombree = px(sol, x, y)
      const nue = px(sol, x, S - 1)
      expect(ombree[3]).toBe(255)
      expect(nue[3]).toBe(255)
      expect(ombree[2]).toBeLessThan(nue[2] * 0.95)
    }
  })

  it('la neige ne déborde pas sur une falaise et garde son liseré contre elle', () => {
    const falaiseEnBas = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE : TUILE_STRUCTURELLE)
    const { sol, surplomb } = cuire(falaiseEnBas)
    expect(surplomb).toBeNull()
    for (let x = 0; x < S; x++) {
      expect(px(sol, x, 8 * P - 1)[0]).toBeLessThan(R(NEIGE_PAVE.NEIGE) * 0.7)
      for (let y = 8 * P; y < S; y++) expect(px(sol, x, y)[3]).toBe(0)
    }
  })

  it('la profonde est un pavé SUR la poudreuse : frange, liseré et ombre dans le sol de la couche (gel.md G9)', () => {
    const profondeEnHaut = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE_PROFONDE : TUILE_NEIGE)
    const { sol, surplomb } = cuire(profondeEnHaut)
    expect(surplomb).toBeNull() // rien n'est surplombé : tout est dans le sol de la couche
    const bord = 8 * P
    for (let x = 0; x < S; x++) {
      // Tout est opaque (deux neiges).
      for (let y = 0; y < S; y++) expect(px(sol, x, y)[3]).toBe(255)
      // Sous le bord de la tuile, la frange de la profonde, qui finit par un liseré sombre…
      let y = bord
      while (y < S && px(sol, x, y)[0] > R(NEIGE_PAVE.NEIGE) * 0.7) y++
      const lisere = y
      expect(lisere - bord, `frange en x=${x}`).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN - 1)
      expect(lisere - bord, `frange en x=${x}`).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      expect(px(sol, x, lisere)[0]).toBeLessThan(R(NEIGE_PAVE.NEIGE) * 0.7)
      // … puis l'ombre portée sur la poudreuse : plus sombre que la poudreuse nue du bas.
      const ombre = px(sol, x, lisere + 1)
      const nue = px(sol, x, S - 1)
      expect(ombre[0]).toBeLessThan(nue[0] * 0.9)
    }
  })

  it('la cuisson est déterministe', () => {
    const a = cuire(neigeEnHaut)
    const b = cuire(neigeEnHaut)
    expect(a.sol).toEqual(b.sol)
    expect(a.surplomb).toEqual(b.surplomb)
  })
})
