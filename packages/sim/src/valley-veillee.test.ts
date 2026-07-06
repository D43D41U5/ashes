import { describe, expect, it } from 'vitest'
import { isBlockingTile, zoneAt, type WorldMap } from './map'
import { TERRAINS } from './balance'
import { generateNodes } from './economy'
import { generateValley } from './valleygen'
import { VEILLEE_SITES, VEILLEE_SKELETON } from './valley-veillee'

/** Flood-fill 4-voisins depuis (sx, sy) → indices de tuiles atteignables. */
function reachable(map: WorldMap, sx: number, sy: number): Set<number> {
  expect(isBlockingTile(map, sx, sy), 'tuile de départ du flood-fill non marchable').toBe(false)
  const seen = new Set<number>()
  const stack = [sy * map.width + sx]
  seen.add(stack[0]!)
  while (stack.length > 0) {
    const idx = stack.pop()!
    const tx = idx % map.width
    const ty = (idx - tx) / map.width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = tx + dx
      const ny = ty + dy
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue
      const nidx = ny * map.width + nx
      if (seen.has(nidx) || isBlockingTile(map, nx, ny)) continue
      seen.add(nidx)
      stack.push(nidx)
    }
  }
  return seen
}

describe("la Vallée de la Veillée — critères d'acceptation", () => {
  const map = generateValley(VEILLEE_SKELETON, 2026)
  const from = reachable(map, Math.floor(VEILLEE_SITES.spawn.x), Math.floor(VEILLEE_SITES.spawn.y))

  it('R1 — déterminisme : même seed → même carte', () => {
    const again = generateValley(VEILLEE_SKELETON, 2026)
    expect(again.terrain).toEqual(map.terrain)
    expect(again.zones).toEqual(map.zones)
  })

  it('R2 — connectivité : chaque landmark a au moins une tuile atteignable depuis le spawn', () => {
    for (const zone of map.zones) {
      let ok = false
      for (let ty = zone.y; ty < zone.y + zone.h && !ok; ty++) {
        for (let tx = zone.x; tx < zone.x + zone.w && !ok; tx++) {
          if (from.has(ty * map.width + tx)) ok = true
        }
      }
      expect(ok, `zone « ${zone.name} » injoignable depuis le spawn`).toBe(true)
    }
  })

  it('R2bis — les sites (spawn, villages, monstres) sont sur des tuiles marchables atteignables', () => {
    const sites = [
      VEILLEE_SITES.spawn, VEILLEE_SITES.foyer, VEILLEE_SITES.meute, VEILLEE_SITES.neutre,
      ...VEILLEE_SITES.boars, ...VEILLEE_SITES.zombies,
    ]
    for (const s of sites) {
      expect(from.has(Math.floor(s.y) * map.width + Math.floor(s.x))).toBe(true)
    }
  })

  it('R3 — les landmarks attendus existent ; la Mine est un gisement', () => {
    const names = map.zones.map((z) => z.name)
    for (const n of [
      'la Clairière', 'la Croisée', 'le Pont', 'le Gué', 'le Col', 'le Hameau abandonné',
      'la Mine du Levant', 'le Lac', 'le Plateau', 'la Vieille Forêt',
      'les Collines du Levant', 'le Marais', 'la Plaine',
    ]) {
      expect(names, `landmark « ${n} » absent`).toContain(n)
    }
    const mine = map.zones.find((z) => z.name === 'la Mine du Levant')!
    expect(mine.kind).toBe('gisement')
    // zoneAt au centre de la Mine doit retourner la Mine (ordre des zones :
    // spécifiques d'abord) — generateNodes en dépend pour poser le minerai.
    expect(zoneAt(map, mine.x + mine.w / 2, mine.y + mine.h / 2)?.name).toBe('la Mine du Levant')
  })

  it('R4 — sanité : 55-85 % de tuiles marchables, dimensions 192×192', () => {
    expect(map.width).toBe(192)
    expect(map.height).toBe(192)
    const walkable = map.terrain.filter((t) => TERRAINS[t]?.walkable).length
    expect(walkable / map.terrain.length).toBeGreaterThan(0.55)
    expect(walkable / map.terrain.length).toBeLessThan(0.85)
  })

  it('R5 — la chair : minerai à la Mine, T1 en Plaine, fibres au Marais', () => {
    const nodes = generateNodes(map, 2026)
    const inZone = (name: string, type: string): number => {
      const z = map.zones.find((zz) => zz.name === name)!
      return nodes.filter(
        (n) => n.type === type && n.tx >= z.x && n.tx < z.x + z.w && n.ty >= z.y && n.ty < z.y + z.h,
      ).length
    }
    expect(inZone('la Mine du Levant', 'iron_vein')).toBeGreaterThan(0)
    expect(inZone('la Mine du Levant', 'coal_seam')).toBeGreaterThan(0)
    expect(inZone('la Plaine', 'berry_bush')).toBeGreaterThan(3)
    expect(inZone('la Plaine', 'tree')).toBeGreaterThan(3)
    expect(inZone('le Marais', 'fiber_plant')).toBeGreaterThan(5)
  })

  it('R5bis — le minerai de la Mine est atteignable depuis le spawn (pas enclavé dans la roche)', () => {
    const nodes = generateNodes(map, 2026)
    const reachableOf = (type: string): number =>
      nodes.filter((n) => n.type === type && from.has(n.ty * map.width + n.tx)).length
    expect(reachableOf('iron_vein')).toBeGreaterThan(0)
    expect(reachableOf('coal_seam')).toBeGreaterThan(0)
  })
})
