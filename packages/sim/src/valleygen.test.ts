import { describe, expect, it } from 'vitest'
import { isBlockingTile, terrainAt } from './map'
import {
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_ROAD,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_WALL,
} from './balance'
import { generateValley, type ValleySkeleton } from './valleygen'

/** Petit squelette d'exercice — chaque primitive y est représentée. */
export const TEST_SKELETON: ValleySkeleton = {
  width: 48,
  height: 48,
  borderThickness: 3,
  ridges: [{ points: [{ x: 4, y: 20 }, { x: 20, y: 20 }], halfWidth: 1 }],
  river: { points: [{ x: 30, y: 4 }, { x: 30, y: 40 }], halfWidth: 2 },
  lake: { x: 30, y: 40, r: 4 },
  roads: [[{ x: 8, y: 30 }, { x: 40, y: 30 }]],
  crossings: [{ kind: 'bridge', x: 30, y: 30 }],
  clearings: [{ x: 10, y: 30, r: 3 }],
  ruins: [{ x: 12, y: 34 }],
  regions: [{ x: 4, y: 4, w: 40, h: 12, forest: 0.9 }],
  landmarks: [{ name: 'le Pont', x: 27, y: 27, w: 7, h: 7 }],
}

describe('generateValley — le socle', () => {
  it('est déterministe : même squelette + même seed → même carte, bit à bit', () => {
    const a = generateValley(TEST_SKELETON, 7)
    const b = generateValley(TEST_SKELETON, 7)
    expect(a.terrain).toEqual(b.terrain)
    expect(a.zones).toEqual(b.zones)
    const c = generateValley(TEST_SKELETON, 8)
    expect(c.terrain).not.toEqual(a.terrain)
  })

  it("l'enceinte est étanche : tout le bord est bloquant", () => {
    const map = generateValley(TEST_SKELETON, 7)
    for (let i = 0; i < 48; i++) {
      expect(isBlockingTile(map, i, 0)).toBe(true)
      expect(isBlockingTile(map, i, 47)).toBe(true)
      expect(isBlockingTile(map, 0, i)).toBe(true)
      expect(isBlockingTile(map, 47, i)).toBe(true)
    }
  })

  it('la région forestière est majoritairement boisée', () => {
    const map = generateValley(TEST_SKELETON, 7)
    let forest = 0
    let total = 0
    for (let ty = 8; ty < 14; ty++) {
      for (let tx = 10; tx < 28; tx++) {
        total += 1
        if (terrainAt(map, tx, ty) === TERRAIN_FOREST) forest += 1
      }
    }
    expect(forest / total).toBeGreaterThan(0.6)
  })

  it('la crête est un mur de roche', () => {
    const map = generateValley(TEST_SKELETON, 7)
    for (let tx = 6; tx <= 18; tx++) expect(isBlockingTile(map, tx, 20)).toBe(true)
  })

  it('les zones sont copiées depuis les landmarks (pas de référence partagée)', () => {
    const map = generateValley(TEST_SKELETON, 7)
    expect(map.zones).toEqual(TEST_SKELETON.landmarks)
    expect(map.zones[0]).not.toBe(TEST_SKELETON.landmarks[0])
  })
})

describe("generateValley — rivière, routes, franchissements", () => {
  const map = generateValley(TEST_SKELETON, 7)

  it("la rivière coule : eau profonde au centre, berges en eau peu profonde", () => {
    expect(terrainAt(map, 30, 20)).toBe(TERRAIN_DEEP_WATER)
    expect(terrainAt(map, 33, 20)).toBe(TERRAIN_SHALLOW_WATER)
  })

  it("le lac est en eau, bordé de berges", () => {
    expect(terrainAt(map, 30, 40)).toBe(TERRAIN_DEEP_WATER)
  })

  it("le pont porte la route par-dessus la rivière — la traversée est continue", () => {
    expect(terrainAt(map, 30, 30)).toBe(TERRAIN_ROAD)
    for (let tx = 9; tx <= 39; tx++) {
      expect(isBlockingTile(map, tx, 30)).toBe(false)
    }
  })

  it("un gué traverse en eau peu profonde (marchable, lent)", () => {
    const ford: ValleySkeleton = {
      ...TEST_SKELETON,
      crossings: [{ kind: "ford", x: 30, y: 30 }],
    }
    const m = generateValley(ford, 7)
    expect(terrainAt(m, 30, 30)).toBe(TERRAIN_SHALLOW_WATER)
    expect(isBlockingTile(m, 30, 30)).toBe(false)
  })

  it("la route ne remplace jamais l'eau hors franchissement", () => {
    // la rivière coupe la route : sans le pont, l'eau resterait de l'eau
    const sans: ValleySkeleton = { ...TEST_SKELETON, crossings: [] }
    const m = generateValley(sans, 7)
    expect(terrainAt(m, 30, 30)).toBe(TERRAIN_DEEP_WATER)
  })

  it("la clairière est nettoyée (herbe ou route uniquement)", () => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = terrainAt(map, 10 + dx, 30 + dy)
        expect([TERRAIN_GRASS, TERRAIN_ROAD]).toContain(t)
      }
    }
  })

  it("la ruine pose des murs brisés sur sol nettoyé", () => {
    expect(terrainAt(map, 12, 34)).toBe(TERRAIN_WALL)
    expect(isBlockingTile(map, 14, 35)).toBe(false) // la brèche
  })
})

describe('stampBlob — contours organiques (Lac)', () => {
  it("le Lac n'est plus un disque parfait : son contour est irrégulier", () => {
    const map = generateValley(TEST_SKELETON, 7)
    const { x, y, r } = TEST_SKELETON.lake
    // Sur l'anneau du rayon nominal, un disque parfait donnerait un mélange net ;
    // un contour bruité met de l'eau au-delà de r ET de la terre en-deçà.
    let waterBeyond = 0
    let landWithin = 0
    for (let ty = y - r - 3; ty <= y + r + 3; ty++) {
      for (let tx = x - r - 3; tx <= x + r + 3; tx++) {
        const d2 = (tx - x) * (tx - x) + (ty - y) * (ty - y)
        const t = terrainAt(map, tx, ty)
        const wet = t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER
        if (d2 > (r + 1) * (r + 1) && wet) waterBeyond++
        if (d2 < (r - 1) * (r - 1) && !wet) landWithin++
      }
    }
    // Au moins l'un des deux est franc : le bord ondule, pas un cercle net.
    expect(waterBeyond + landWithin).toBeGreaterThan(8)
  })

  it('reste déterministe : même seed → même carte', () => {
    expect(generateValley(TEST_SKELETON, 7).terrain).toEqual(generateValley(TEST_SKELETON, 7).terrain)
  })
})
