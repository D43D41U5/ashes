import { describe, expect, it } from 'vitest'
import { isBlockingTile, terrainAt } from './map'
import { TERRAIN_FOREST } from './balance'
import { generateValley, type ValleySkeleton } from './valleygen'

/** Petit squelette d'exercice — chaque primitive y est représentée. */
export const TEST_SKELETON: ValleySkeleton = {
  width: 48,
  height: 48,
  borderThickness: 3,
  ridges: [{ points: [{ x: 4, y: 20 }, { x: 20, y: 20 }], halfWidth: 1 }],
  river: { points: [{ x: 30, y: 4 }, { x: 30, y: 44 }], halfWidth: 2 },
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
