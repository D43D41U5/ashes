import { describe, expect, it } from 'vitest'
import { cliffAt, cliffPlacement, faceHeightPx, MAX_DROP, STEP_PX } from './cliffs'
import { corpseDepth, TILE_PX, ySortDepth, TIE_ACTOR } from './framing'
import type { SampleLevel } from './hillshade'

/** Plateau (palier 3) au nord de ty=4 ; sol bas (palier 1) au sud. Carte 10×10. */
const lvl: SampleLevel = (tx, ty) => {
  if (tx < 0 || ty < 0 || tx > 9 || ty > 9) return -1
  return ty <= 4 ? 3 : 1
}

describe('cliffAt', () => {
  it('la tuile HAUTE dont le voisin sud est plus bas porte une face', () => {
    expect(cliffAt(5, 4, lvl)).toEqual({ tx: 5, ty: 4, drop: 2 })
  })

  it('pas de face en terrain de palier constant', () => {
    expect(cliffAt(5, 2, lvl)).toBeNull()
    expect(cliffAt(5, 7, lvl)).toBeNull()
  })

  it('pas de face sur une MONTÉE vers le sud', () => {
    const monte: SampleLevel = (_tx, ty) => (ty <= 4 ? 1 : 3)
    expect(cliffAt(5, 4, monte)).toBeNull()
  })

  it('pas de face au bord de carte (voisin sud hors carte)', () => {
    expect(cliffAt(5, 9, lvl)).toBeNull()
  })

  it('pas de face sur une carte sans paliers', () => {
    expect(cliffAt(5, 4, () => -1)).toBeNull()
  })
})

describe('faceHeightPx', () => {
  it('une marche d’un palier fait STEP_PX de haut', () => {
    expect(faceHeightPx(1)).toBe(STEP_PX)
  })

  it('croît avec le décrochement', () => {
    expect(faceHeightPx(3)).toBe(3 * STEP_PX)
  })

  it('plafonne à MAX_DROP (l’art n’est cuit que jusque-là)', () => {
    expect(faceHeightPx(99)).toBe(MAX_DROP * STEP_PX)
  })
})

describe('cliffPlacement', () => {
  const face = { tx: 5, ty: 4, drop: 2 }

  it('pend depuis l’arête : bord haut à la frontière, pieds en dessous', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(p.px).toBe((5 + 0.5) * TILE_PX)
    expect(p.py).toBe((4 + 1) * TILE_PX + faceHeightPx(2))
    expect(p.displayW).toBe(TILE_PX)
    expect(p.displayH).toBe(faceHeightPx(2))
    expect(p.drop).toBe(2)
  })

  it('plafonne le drop rapporté (clé de texture)', () => {
    expect(cliffPlacement({ tx: 0, ty: 0, drop: 99 }, TILE_PX).drop).toBe(MAX_DROP)
  })

  it('un acteur AU PIED se dessine DEVANT la paroi', () => {
    const p = cliffPlacement(face, TILE_PX)
    const acteurAuPied = ySortDepth(7, TILE_PX, TIE_ACTOR) // pieds rangée 7, bien au sud
    expect(acteurAuPied).toBeGreaterThan(p.depth)
  })

  it('un acteur SUR LE PLATEAU se dessine DERRIÈRE la paroi', () => {
    const p = cliffPlacement(face, TILE_PX)
    const acteurSurPlateau = ySortDepth(5, TILE_PX, TIE_ACTOR) // pieds au bord de l'arête
    expect(acteurSurPlateau).toBeLessThan(p.depth)
  })

  it('à pieds égaux, un cadavre passe devant la paroi', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(corpseDepth(p.py / TILE_PX, TILE_PX)).toBeGreaterThan(p.depth)
  })
})
