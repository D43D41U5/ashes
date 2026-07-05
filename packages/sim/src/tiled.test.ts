import { describe, expect, it } from 'vitest'
import { zoneAt } from './map'
import { importTiledMap, type TiledMapFile } from './tiled'

// Carte 4×3, tileset firstgid 1 : gid = 1 + id de terrain.
// Terrains : herbe (1) partout, route (2) sur la 2e ligne.
const fixture: TiledMapFile = {
  width: 4,
  height: 3,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [{ firstgid: 1 }],
  layers: [
    {
      type: 'tilelayer',
      name: 'terrain',
      width: 4,
      height: 3,
      data: [2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2],
    },
    {
      type: 'tilelayer',
      name: 'obstacles',
      width: 4,
      height: 3,
      data: [0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    {
      type: 'objectgroup',
      name: 'zones',
      objects: [
        { name: 'le Pont', x: 16, y: 16, width: 32, height: 16 },
        { name: 'le Col', x: 0, y: 32, width: 16, height: 16 },
      ],
    },
    { type: 'tilelayer', name: 'decorations' },
  ],
}

describe('import Tiled (A4)', () => {
  it('restitue dimensions, terrains, obstacles et zones nommées', () => {
    const { map } = importTiledMap(fixture)
    expect(map.width).toBe(4)
    expect(map.height).toBe(3)
    // gid 2 → herbe (1), gid 3 → route (2).
    expect(map.terrain[0]).toBe(1)
    expect(map.terrain[4]).toBe(2)
    // L'obstacle (gid 6 → roche, id 5) prime sur le terrain.
    expect(map.terrain[2]).toBe(5)
    expect(map.zones).toEqual([
      { name: 'le Pont', x: 1, y: 1, w: 2, h: 1 },
      { name: 'le Col', x: 0, y: 2, w: 1, h: 1 },
    ])
    expect(zoneAt(map, 2.5, 1.5)?.name).toBe('le Pont')
    expect(zoneAt(map, 3.5, 0.5)).toBeUndefined()
  })

  it('ignore les couches inconnues avec un avertissement, jamais en silence', () => {
    const { warnings } = importTiledMap(fixture)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('decorations')
  })

  it('refuse une carte sans couche terrain', () => {
    expect(() => importTiledMap({ ...fixture, layers: [] })).toThrow(/terrain/)
  })
})
