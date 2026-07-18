import { describe, expect, it } from 'vitest'
import { createEmptyMap, zoneIdAt, type WorldMap } from './map'

describe('WorldMap.zoneIdAt', () => {
  it('lit la grille de zones au pas du bloc ; -1 sur une carte sans zones', () => {
    const map: WorldMap = createEmptyMap(4, 4, 1)
    expect(zoneIdAt(map, 1, 1)).toBe(-1) // pas de grille → -1 (garde de connexité inerte)

    // 2×2 blocs au pas de 2 : chaque quart de la carte est une zone.
    map.zoneGrid = [3, 5, 7, 9]
    map.zonePas = 2
    expect(zoneIdAt(map, 0, 0)).toBe(3) // bloc (0,0)
    expect(zoneIdAt(map, 3, 0)).toBe(5) // bloc (1,0)
    expect(zoneIdAt(map, 0, 3)).toBe(7) // bloc (0,1)
    expect(zoneIdAt(map, 3, 3)).toBe(9) // bloc (1,1)
    // Deux tuiles voisines de blocs différents rendent des ids différents : c'est ce qui laisse la
    // garde de `carveDistanceToMain` refuser de percer une frontière de zone.
    expect(zoneIdAt(map, 1, 0)).not.toBe(zoneIdAt(map, 2, 0))
  })
})
