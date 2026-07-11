import { describe, expect, it } from 'vitest'
import {
  actorPlacement,
  AMBIENT_DEPTH,
  CANOPY_DEPTH,
  CROWN_ALPHA_MIN,
  CROWN_R_IN,
  CROWN_R_OUT,
  crownAlpha,
  crownDepth,
  clutterDepth,
  corpseDepth,
  GROUND_FIRE_DEPTH,
  lookaheadOffset,
  nodeDepth,
  OVERLAY_DEPTH,
  structureDepth,
  TIE_ACTOR,
  Y_SORT_BASE,
  ySortDepth,
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
  it('sous la borne, renvoie strength × écart au centre sans clamp', () => {
    // écart 100 px × strength 0.2 = 20 px < 6 tuiles (96 px) → passe tel quel
    const off = lookaheadOffset(CX + 100, CY, CX, CY, 0.2, 6, TILE)
    expect(off).toEqual({ x: 20, y: 0 })
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
    expect(p.depth).toBeCloseTo(ySortDepth(10.3, TILE, TIE_ACTOR), 5)
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

const actorAt = (y: number): number => actorPlacement(0, y, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6).depth

describe('structureDepth (R13)', () => {
  it('trie une structure par son bord bas, dans la même couche que les acteurs', () => {
    expect(structureDepth(9, TILE)).toBeCloseTo(Y_SORT_BASE + 10 * TILE + 0.6, 5) // pieds = ty+1
  })
  it('un acteur au nord d’une structure (feetY < ty+1) passe DERRIÈRE elle', () => {
    const wallDepth = structureDepth(9, TILE) // pieds à y=10
    expect(actorAt(9)).toBeLessThan(wallDepth) // feetY=9.3 → dessous → occulté
  })
  it('un acteur au sud d’une structure passe DEVANT elle', () => {
    expect(actorAt(10)).toBeGreaterThan(structureDepth(9, TILE)) // feetY=10.3
  })
})

describe('les props verticaux trient avec les acteurs', () => {
  it('un arbre au SUD du joueur le masque (le bug : les nœuds étaient à plat)', () => {
    // Arbre sur la tuile 10 → pieds à y=11. Joueur sur la tuile 9 → feetY=9.8.
    expect(nodeDepth(10, TILE)).toBeGreaterThan(actorAt(9.5))
  })
  it('un arbre au NORD du joueur est masqué par lui', () => {
    expect(nodeDepth(10, TILE)).toBeLessThan(actorAt(11.5))
  })
  it('un conifère du décor trie lui aussi avec les acteurs', () => {
    expect(clutterDepth(12, TILE)).toBeGreaterThan(actorAt(9.5))
    expect(clutterDepth(8, TILE)).toBeLessThan(actorAt(9.5))
  })
  it('le décor trie sur ses pieds RÉELS, décalage sub-tuile compris', () => {
    // Deux props de la rangée ty=5 : celui posé plus bas dans la tuile passe devant.
    expect(clutterDepth(6 + 0.3, TILE)).toBeGreaterThan(clutterDepth(6 - 0.3, TILE))
  })
})

describe('départage à pieds ÉGAUX (constantes TIE_*)', () => {
  it('décor < nœud < structure < acteur', () => {
    const feet = 10
    expect(clutterDepth(feet, TILE)).toBeLessThan(nodeDepth(feet - 1, TILE))
    expect(nodeDepth(feet - 1, TILE)).toBeLessThan(structureDepth(feet - 1, TILE))
    expect(structureDepth(feet - 1, TILE)).toBeLessThan(actorAt(feet - 0.3))
    expect(corpseDepth(feet, TILE)).toBeLessThan(clutterDepth(feet, TILE))
  })
  it('un départage ne renverse JAMAIS un écart de profondeur réel (< 1 px monde)', () => {
    // Un acteur (tie le plus fort) reste derrière un décor d'un pixel plus bas.
    expect(actorAt(10 - 0.3)).toBeLessThan(clutterDepth(10 + 1 / TILE, TILE))
  })
})

describe('budget des profondeurs', () => {
  it('le sol plat reste sous la bande de tri', () => {
    expect(GROUND_FIRE_DEPTH).toBeLessThan(Y_SORT_BASE)
  })
  it('la vallée canonique (3600 tuiles) ne perce pas la canopée ni la nuit', () => {
    // Le bug latent : depth = BASE + y suffisait pour 192 tuiles, pas pour 3600.
    const leBasDeLaCarte = actorAt(3600)
    expect(leBasDeLaCarte).toBeLessThan(CANOPY_DEPTH)
    expect(leBasDeLaCarte).toBeLessThan(AMBIENT_DEPTH)
    expect(leBasDeLaCarte).toBeLessThan(OVERLAY_DEPTH)
  })
})

describe('houppiers : la bande de profondeur (A9)', () => {
  it('un houppier coiffe TOUT acteur atteignable sur la vallée canonique (3600 tuiles)', () => {
    const acteurLePlusAuSud = ySortDepth(3600, TILE, TIE_ACTOR)
    expect(crownDepth(0, TILE)).toBeGreaterThan(acteurLePlusAuSud)
  })

  it('un houppier reste SOUS la canopée, la nuit et les halos', () => {
    expect(crownDepth(3601, TILE)).toBeLessThan(CANOPY_DEPTH)
  })

  it('deux houppiers se trient entre eux par leur rangée', () => {
    expect(crownDepth(11, TILE)).toBeGreaterThan(crownDepth(10, TILE))
  })
})

describe('houppiers : le disque de découvert (A8)', () => {
  it('sous la cime (d ≤ R_IN) le houppier s\'efface à A_MIN', () => {
    expect(crownAlpha(0)).toBe(CROWN_ALPHA_MIN)
    expect(crownAlpha(CROWN_R_IN)).toBe(CROWN_ALPHA_MIN)
  })

  it('au-delà de R_OUT la forêt est un couvert opaque', () => {
    expect(crownAlpha(CROWN_R_OUT)).toBe(1)
    expect(crownAlpha(50)).toBe(1)
  })

  it('entre les deux, l\'alpha croît continûment (pas de scintillement en marchant)', () => {
    const mid = crownAlpha((CROWN_R_IN + CROWN_R_OUT) / 2)
    expect(mid).toBeGreaterThan(CROWN_ALPHA_MIN)
    expect(mid).toBeLessThan(1)
    let prev = crownAlpha(0)
    for (let d = 0; d <= 6; d += 0.05) {
      const a = crownAlpha(d)
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9) // monotone croissante
      prev = a
    }
  })

  it('les jointures sont continues (R_IN et R_OUT)', () => {
    expect(crownAlpha(CROWN_R_IN + 1e-6)).toBeCloseTo(CROWN_ALPHA_MIN, 5)
    expect(crownAlpha(CROWN_R_OUT - 1e-6)).toBeCloseTo(1, 5)
  })
})
