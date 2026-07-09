import { describe, expect, it } from 'vitest'
import { createEmptyMap, elevationAt, levelAt, type WorldMap } from './map'

describe('WorldMap.elevation', () => {
  it('elevationAt lit le champ, 0 hors carte ou si absent', () => {
    const map: WorldMap = createEmptyMap(4, 4, 1)
    expect(elevationAt(map, 1, 1)).toBe(0) // absent → 0
    map.elevation = new Array(16).fill(0)
    map.elevation[1 * 4 + 2] = 0.7
    expect(elevationAt(map, 2, 1)).toBeCloseTo(0.7)
    expect(elevationAt(map, -1, 0)).toBe(0) // hors carte
  })
})

describe('WorldMap.level', () => {
  it('levelAt lit le champ, 0 hors carte ou si absent', () => {
    const map: WorldMap = createEmptyMap(4, 4, 1)
    expect(levelAt(map, 1, 1)).toBe(0) // absent → 0
    map.level = new Array(16).fill(0)
    map.level[1 * 4 + 2] = 3
    expect(levelAt(map, 2, 1)).toBe(3)
    expect(levelAt(map, -1, 0)).toBe(0) // hors carte
    expect(levelAt(map, 4, 0)).toBe(0) // hors carte
  })
})
