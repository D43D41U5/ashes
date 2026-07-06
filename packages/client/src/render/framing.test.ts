import { describe, expect, it } from 'vitest'
import {
  ACTOR_DEPTH_BASE,
  actorPlacement,
  lookaheadOffset,
  structureDepth,
  zoomForFraming,
} from './framing'

const TILE = 16

describe('zoomForFraming (R10)', () => {
  it('dérive le zoom du cadrage voulu : 20 tuiles de haut sur 720 px → 2,25', () => {
    expect(zoomForFraming(20, TILE, 720)).toBeCloseTo(2.25, 5)
  })
  it('un cadrage plus serré donne un zoom plus fort', () => {
    expect(zoomForFraming(18, TILE, 720)).toBeGreaterThan(zoomForFraming(20, TILE, 720))
  })
})

describe('lookaheadOffset (R11)', () => {
  const CX = 640
  const CY = 360
  it('pointeur au centre → aucun décalage', () => {
    expect(lookaheadOffset(CX, CY, CX, CY, 0.2, 6, TILE)).toEqual({ x: 0, y: 0 })
  })
  it('décale vers le curseur (signe conservé)', () => {
    const off = lookaheadOffset(CX + 100, CY - 50, CX, CY, 0.2, 6, TILE)
    expect(off.x).toBeGreaterThan(0)
    expect(off.y).toBeLessThan(0)
  })
  it('borne le décalage à maxTiles (clamp radial)', () => {
    // strength énorme → doit être clampé à 6 tuiles = 96 px, en magnitude
    const off = lookaheadOffset(CX + 640, CY, CX, CY, 10, 6, TILE)
    const mag = Math.sqrt(off.x * off.x + off.y * off.y)
    expect(mag).toBeCloseTo(6 * TILE, 5)
  })
  it('le clamp est radial (diagonale bornée à maxTiles, pas maxTiles par axe)', () => {
    const off = lookaheadOffset(CX + 640, CY + 360, CX, CY, 10, 6, TILE)
    const mag = Math.sqrt(off.x * off.x + off.y * off.y)
    expect(mag).toBeCloseTo(6 * TILE, 5)
  })
})

describe('actorPlacement (R12 + R13)', () => {
  it('ancre les pieds au bas de l’emprise logique et découple la taille de l’art', () => {
    const p = actorPlacement(5, 10, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    // feetY = 10 + 0.6/2 = 10.3
    expect(p.px).toBeCloseTo(80, 5) // 5 * 16, centre horizontal inchangé
    expect(p.py).toBeCloseTo(10.3 * TILE, 5) // pieds
    expect(p.displayW).toBeCloseTo(16, 5) // 1 tuile — indépendant du 12×12 natif
    expect(p.displayH).toBeCloseTo(25.6, 5) // 1,6 tuile : le sprite « monte »
    expect(p.depth).toBeCloseTo(ACTOR_DEPTH_BASE + 10.3, 5)
  })
  it('la taille d’affichage ne dépend QUE de l’emprise et de tilePx (A9)', () => {
    const a = actorPlacement(0, 0, { widthTiles: 2, heightTiles: 2 }, 32, 0.6)
    expect(a.displayW).toBe(64)
    expect(a.displayH).toBe(64)
  })
  it('un acteur plus au sud (y plus grand) a une depth plus grande → rendu devant', () => {
    const nord = actorPlacement(0, 5, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    const sud = actorPlacement(0, 8, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    expect(sud.depth).toBeGreaterThan(nord.depth)
  })
})

describe('structureDepth (R13)', () => {
  it('trie une structure par son bord bas, dans la même couche que les acteurs', () => {
    expect(structureDepth(9)).toBeCloseTo(ACTOR_DEPTH_BASE + 10, 5) // pieds = ty+1
  })
  it('un acteur au nom d’une structure (feetY < ty+1) passe DERRIÈRE elle', () => {
    const wallDepth = structureDepth(9) // pieds à y=10
    const actorNord = actorPlacement(0, 9, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6) // feetY=9.3
    expect(actorNord.depth).toBeLessThan(wallDepth) // dessous → occulté
  })
})
