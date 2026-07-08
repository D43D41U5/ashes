import { describe, it, expect } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { placePois, POI_TYPES } from './poi'
import { terrainAt } from './map'

describe('placePois', () => {
  it('assigne chaque POI à un biome autorisé pour son type', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    placePois(map, 5)
    const bySlug = new Map(POI_TYPES.map((t) => [t.slug, t]))
    for (const z of map.zones) {
      const t = bySlug.get(z.kind!)
      if (!t) continue
      const terr = terrainAt(map, Math.floor(z.x + z.w / 2), Math.floor(z.y + z.h / 2))
      expect(t.biomes.includes(terr)).toBe(true) // biome-cohérence
    }
  })
  it('respecte les plafonds durs (gisement rare, cairn fréquent)', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    placePois(map, 5)
    const count = (slug: string) => map.zones.filter((z) => z.kind === slug).length
    const gis = POI_TYPES.find((t) => t.slug === 'gisement')!
    expect(count('gisement')).toBeLessThanOrEqual(gis.cap)
  })
  it('déterministe : même seed → mêmes zones', () => {
    const a = generateAlpineTerrain(200, 300, 9); placePois(a, 9)
    const b = generateAlpineTerrain(200, 300, 9); placePois(b, 9)
    expect(a.zones).toEqual(b.zones)
  })
  it('pose des zones gisement/carriere (pour generateNodes)', () => {
    const map = generateAlpineTerrain(360, 540, 5); placePois(map, 5)
    // au moins un des deux kinds ressource présent sur une carte de cette taille
    expect(map.zones.some((z) => z.kind === 'gisement' || z.kind === 'carriere')).toBe(true)
  })
})
