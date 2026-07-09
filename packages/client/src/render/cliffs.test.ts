import { describe, expect, it } from 'vitest'
import { cliffPiecesAt, cliffPlacement, faceHeightPx, MAX_DROP, SIDE_PX, STEP_PX } from './cliffs'
import { corpseDepth, TIE_ACTOR, TILE_PX, ySortDepth } from './framing'
import type { SampleLevel } from './hillshade'

/** Plateau (palier 3) au nord de ty=4 ; sol bas (palier 1) au sud. Carte 10×10. */
const plateauNord: SampleLevel = (tx, ty) => {
  if (tx < 0 || ty < 0 || tx > 9 || ty > 9) return -1
  return ty <= 4 ? 3 : 1
}

/** Plateau (palier 2) à l'OUEST de tx=5 ; sol bas (palier 1) à l'est. */
const plateauOuest: SampleLevel = (tx, ty) => {
  if (tx < 0 || ty < 0 || tx > 9 || ty > 9) return -1
  return tx < 5 ? 2 : 1
}

describe('cliffPiecesAt', () => {
  it('la tuile basse sous un plateau porte une FACE', () => {
    expect(cliffPiecesAt(5, 5, plateauNord)).toEqual([{ tx: 5, ty: 5, kind: 'face', drop: 2 }])
  })

  it('la tuile basse à l’est d’un plateau porte une TRANCHE ouest', () => {
    expect(cliffPiecesAt(5, 5, plateauOuest)).toEqual([{ tx: 5, ty: 5, kind: 'side_w', drop: 1 }])
  })

  it('la tuile basse à l’ouest d’un plateau porte une TRANCHE est', () => {
    const plateauEst: SampleLevel = (tx, ty) => (tx < 0 || ty < 0 || tx > 9 || ty > 9 ? -1 : tx > 5 ? 2 : 1)
    expect(cliffPiecesAt(5, 5, plateauEst)).toEqual([{ tx: 5, ty: 5, kind: 'side_e', drop: 1 }])
  })

  it('un coin intérieur porte DEUX pièces — c’est ce qui recolle le mur en escalier', () => {
    // haut au nord ET à l'ouest : le contour tourne sur cette tuile
    const coin: SampleLevel = (tx, ty) => (tx < 0 || ty < 0 || tx > 9 || ty > 9 ? -1 : ty < 5 || tx < 5 ? 2 : 1)
    expect(cliffPiecesAt(5, 5, coin).map((p) => p.kind)).toEqual(['face', 'side_w'])
  })

  it('aucune pièce en terrain de palier constant', () => {
    expect(cliffPiecesAt(5, 2, plateauNord)).toEqual([])
    expect(cliffPiecesAt(5, 7, plateauNord)).toEqual([])
  })

  it('aucune pièce sur la tuile HAUTE — le mur appartient au bas', () => {
    expect(cliffPiecesAt(5, 4, plateauNord)).toEqual([])
  })

  it('aucune pièce sur une carte sans paliers', () => {
    expect(cliffPiecesAt(5, 5, () => -1)).toEqual([])
  })

  it('aucune pièce hors carte', () => {
    expect(cliffPiecesAt(-1, 5, plateauNord)).toEqual([])
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

describe('cliffPlacement — la face', () => {
  const face = { tx: 5, ty: 5, kind: 'face' as const, drop: 2 }

  it('occupe le haut de la tuile basse, pieds faceHeightPx plus bas', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(p.px).toBe((5 + 0.5) * TILE_PX)
    expect(p.py).toBe(5 * TILE_PX + faceHeightPx(2))
    expect(p.py - p.displayH).toBe(5 * TILE_PX) // bord haut EXACTEMENT sur la frontière de palier
    expect(p.displayW).toBe(TILE_PX)
    expect(p.texture).toBe('cliff-face-2')
  })

  it('plafonne la clé de texture', () => {
    expect(cliffPlacement({ tx: 0, ty: 0, kind: 'face', drop: 99 }, TILE_PX).texture).toBe(`cliff-face-${MAX_DROP}`)
  })

  it('un acteur AU PIED se dessine DEVANT', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(ySortDepth(8, TILE_PX, TIE_ACTOR)).toBeGreaterThan(p.depth)
  })

  it('un acteur resté SUR LE PLATEAU se dessine DERRIÈRE', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(ySortDepth(5, TILE_PX, TIE_ACTOR)).toBeLessThan(p.depth)
  })

  it('à pieds égaux, un cadavre passe devant la paroi', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(corpseDepth(p.py / TILE_PX, TILE_PX)).toBeGreaterThan(p.depth)
  })
})

describe('cliffPlacement — les tranches', () => {
  it('la tranche EST colle au bord est de la tuile, sur toute sa hauteur', () => {
    const p = cliffPlacement({ tx: 5, ty: 5, kind: 'side_e', drop: 1 }, TILE_PX)
    expect(p.px).toBe(6 * TILE_PX - SIDE_PX / 2)
    expect(p.py).toBe(6 * TILE_PX)
    expect(p.displayW).toBe(SIDE_PX)
    expect(p.displayH).toBe(TILE_PX) // pas de rupture entre deux marches successives
    expect(p.texture).toBe('cliff-side-1')
  })

  it('la tranche OUEST est son miroir', () => {
    const p = cliffPlacement({ tx: 5, ty: 5, kind: 'side_w', drop: 1 }, TILE_PX)
    expect(p.px).toBe(5 * TILE_PX + SIDE_PX / 2)
    expect(p.py).toBe(6 * TILE_PX)
  })

  it('une tranche et la face de la tuile au sud se touchent sans trou', () => {
    const tranche = cliffPlacement({ tx: 5, ty: 5, kind: 'side_e', drop: 1 }, TILE_PX)
    const faceDessous = cliffPlacement({ tx: 5, ty: 6, kind: 'face', drop: 1 }, TILE_PX)
    expect(tranche.py).toBe(faceDessous.py - faceDessous.displayH) // pied de l'une = tête de l'autre
  })
})
