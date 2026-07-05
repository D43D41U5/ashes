import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_ROCK, TICK_DT_S } from './balance'
import { overlapsBlocking } from './collision'
import { createEmptyMap, type WorldMap } from './map'
import { rngRoll } from './rng'
import { createSim, spawnEntity, step, type MoveInput } from './sim'

const SPEED = BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2

function setTile(map: WorldMap, tx: number, ty: number, id: number): void {
  map.terrain[ty * map.width + tx] = id
}

describe('collisions (A3)', () => {
  it('clampe flush contre un mur et ne le traverse pas', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    for (let ty = 0; ty < 12; ty++) setTile(map, 6, ty, TERRAIN_ROCK)
    const sim = createSim(1, { map })
    const id = spawnEntity(sim, 4.5, 4.5)
    for (let t = 0; t < 30; t++) step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    expect(sim.entities[0]!.x).toBe(6 - HALF)
    expect(sim.entities[0]!.y).toBe(4.5)
  })

  it('glisse le long du mur en déplacement diagonal', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    for (let ty = 0; ty < 12; ty++) setTile(map, 6, ty, TERRAIN_ROCK)
    const sim = createSim(1, { map })
    const id = spawnEntity(sim, 6 - HALF, 4.5)
    step(sim, [{ entityId: id, dx: 1, dy: 1 }])
    const e = sim.entities[0]!
    expect(e.x).toBe(6 - HALF)
    expect(e.y).toBeCloseTo(4.5 + SPEED * Math.SQRT1_2)
  })

  it('ne sort jamais de la carte (le hors-carte bloque)', () => {
    const sim = createSim(1, { map: createEmptyMap(8, 8, TERRAIN_GRASS) })
    const id = spawnEntity(sim, 1, 1)
    for (let t = 0; t < 100; t++) step(sim, [{ entityId: id, dx: -1, dy: -1 }])
    expect(sim.entities[0]!.x).toBe(HALF)
    expect(sim.entities[0]!.y).toBe(HALF)
  })

  it('le terrain module la vitesse (route plus rapide que l’herbe)', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    for (let tx = 0; tx < 12; tx++) setTile(map, tx, 2, TERRAIN_ROAD)
    const sim = createSim(1, { map })
    const onRoad = spawnEntity(sim, 2.5, 2.5)
    const onGrass = spawnEntity(sim, 2.5, 6.5)
    step(sim, [
      { entityId: onRoad, dx: 1, dy: 0 },
      { entityId: onGrass, dx: 1, dy: 0 },
    ])
    expect(sim.entities[0]!.x).toBeCloseTo(2.5 + SPEED * 1.25)
    expect(sim.entities[1]!.x).toBeCloseTo(2.5 + SPEED)
  })

  it('marche aléatoire de 10 000 ticks dans un labyrinthe : jamais dans un mur', () => {
    const map = createEmptyMap(24, 24, TERRAIN_GRASS)
    for (let ty = 0; ty < 24; ty++) {
      for (let tx = 0; tx < 24; tx++) {
        const clearStart = tx < 4 && ty < 4
        if (!clearStart && (tx * 7 + ty * 13) % 5 === 0) setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
    const sim = createSim(42, { map })
    const id = spawnEntity(sim, 1.5, 1.5)
    let rng = 42
    const dir = (v: number): -1 | 0 | 1 => (Math.floor(v * 3) - 1) as -1 | 0 | 1
    for (let t = 0; t < 10_000; t++) {
      const a = rngRoll(rng)
      const b = rngRoll(a.next)
      rng = b.next
      const input: MoveInput = { entityId: id, dx: dir(a.value), dy: dir(b.value) }
      step(sim, [input])
      const e = sim.entities[0]!
      if (overlapsBlocking({ map: sim.map }, e.x, e.y)) {
        throw new Error(`entité dans un mur au tick ${t} : (${e.x}, ${e.y})`)
      }
    }
  })
})
