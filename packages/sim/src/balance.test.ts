import { describe, expect, it } from 'vitest'
import { TERRAINS, TERRAIN_SCREE, TERRAIN_SNOW } from './balance'

describe('terrains d\'altitude alpins', () => {
  it('scree est marchable et lent (éboulis)', () => {
    expect(TERRAIN_SCREE).toBe(9)
    expect(TERRAINS[TERRAIN_SCREE]).toEqual({ name: 'scree', walkable: true, speedFactor: 0.7 })
  })
  it('snow est bloquant (pics)', () => {
    expect(TERRAIN_SNOW).toBe(10)
    expect(TERRAINS[TERRAIN_SNOW]!.walkable).toBe(false)
  })
})
