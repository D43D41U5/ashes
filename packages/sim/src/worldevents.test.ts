import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_ROCK, WORLD_EVENTS } from './balance'
import { drainEvents, type SimEvent } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { foundNpcVillage } from './npc'
import { computeFlowField } from './pathfinding'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { grantItems, structureAt } from './village'
import { spawnConvoy, spawnHorde } from './worldevents'

function run(sim: SimState, ticks: number): void {
  for (let t = 0; t < ticks; t++) step(sim, [])
}

function collect(sim: SimState, kept: SimEvent['type'][]): SimEvent[] {
  return drainEvents(sim).filter((e) => kept.includes(e.type))
}

describe('le flow field (A1)', () => {
  it('le gradient contourne une chicane ; identique à chaque run', () => {
    const map = createEmptyMap(20, 20, TERRAIN_GRASS)
    // Deux murs de roche en chicane.
    for (let tx = 0; tx < 15; tx++) map.terrain[6 * 20 + tx] = TERRAIN_ROCK
    for (let tx = 5; tx < 20; tx++) map.terrain[12 * 20 + tx] = TERRAIN_ROCK
    const a = computeFlowField(map, [], 10, 2)
    const b = computeFlowField(map, [], 10, 2)
    expect(a).toEqual(b)
    // Depuis le sud (10, 18), la distance existe et dépasse largement la ligne droite.
    expect(a[18 * 20 + 10]).toBeGreaterThan(20)

    // Et une horde la remonte jusqu'au Feu.
    const sim = createSim(3, { map })
    foundNpcVillage(sim, 10, 2, 0) // village sans PNJ : personne ne défend
    const z = spawnMonster(sim, 'zombie', 10.5, 18.5)
    sim.hordes.push({ id: 1, targetVillageId: sim.villages[0]!.id, memberEntityIds: [z] })
    sim.nextHordeId = 2
    for (let t = 0; t < 3000; t++) {
      step(sim, [])
      const e = sim.entities.find((en) => en.id === z)
      if (e && Math.abs(e.x - 10.5) < 2 && Math.abs(e.y - 2.5) < 2) break
    }
    const e = sim.entities.find((en) => en.id === z)!
    expect(Math.abs(e.y - 2.5)).toBeLessThan(3) // arrivé au Feu malgré la chicane
  })
})

describe('les murs face à la horde (A2)', () => {
  function walledSim() {
    const map = createEmptyMap(20, 20, TERRAIN_GRASS)
    const sim = createSim(4, { map })
    foundNpcVillage(sim, 10, 5, 0)
    // Un mur barre le couloir sud (le seul accès n'est pas muré ailleurs,
    // mais le gradient passe par lui : le zombie frappe ce qui le bloque).
    const owner = spawnEntity(sim, 10.5, 6.5)
    sim.villages[0]!.memberIds.push(owner)
    grantItems(sim, owner, { wood: 50 })
    for (let tx = 8; tx <= 12; tx++) {
      step(sim, [{ entityId: owner, dx: 0, dy: 0, action: { type: 'build', structure: 'wall', tx, ty: 8 } }])
    }
    return { sim, owner }
  }

  it('les zombies frappent le mur qui bloque, il casse, la horde passe', () => {
    const { sim } = walledSim()
    const z = spawnMonster(sim, 'zombie', 10.5, 12.5)
    sim.hordes.push({ id: 1, targetVillageId: sim.villages[0]!.id, memberEntityIds: [z] })
    drainEvents(sim)
    const wall = structureAt(sim.structures, 10, 8)!
    for (let t = 0; t < 6000 && structureAt(sim.structures, 10, 8); t++) step(sim, [])
    expect(structureAt(sim.structures, 10, 8)).toBeUndefined()
    expect(drainEvents(sim).some((e) => e.type === 'structure_destroyed' && e.structureId === wall.id)).toBe(true)
  })

  it('réparé à temps, le mur tient (+50 PV par bois)', () => {
    const { sim, owner } = walledSim()
    const wall = structureAt(sim.structures, 10, 8)!
    wall.hp = 40
    step(sim, [{ entityId: owner, dx: 0, dy: 1 }]) // s'approcher du mur
    for (let t = 0; t < 20; t++) step(sim, [{ entityId: owner, dx: 0, dy: 1 }])
    step(sim, [{ entityId: owner, dx: 0, dy: 0, action: { type: 'repair', structureId: wall.id } }])
    expect(wall.hp).toBe(90)
  })
})

describe('l’alarme (A3)', () => {
  it('une seule alarme par vague ; les dormeurs se réveillent', () => {
    const sim = createSim(6, { map: createEmptyMap(30, 30, TERRAIN_GRASS) })
    foundNpcVillage(sim, 15, 15, 2)
    // Nuit : tout le monde dort.
    sim.tick = DAY_TICKS_PER_CYCLE
    for (const npc of sim.npcs) {
      npc.energy = 10
      npc.sleeping = true
    }
    drainEvents(sim)
    spawnMonster(sim, 'zombie', 21, 15) // dans le rayon de 10
    run(sim, 30)
    const alarms = collect(sim, ['alarm_raised'])
    expect(alarms).toHaveLength(1)
    expect(sim.npcs.some((n) => !n.sleeping)).toBe(true) // la milice est debout
    run(sim, 60)
    expect(collect(sim, ['alarm_raised'])).toHaveLength(0) // pas de spam
  })
})

describe('les hordes nocturnes (A4, A5)', () => {
  it('spawn à la nuit, dissipation à l’aube ; plus grosses en acte II', () => {
    // Échelle : 1 tick ≈ 1 jour — non : on teste en cycle réel, acte forcé.
    const mkSim = (startDay: number) => {
      const sim = createSim(8, {
        map: createEmptyMap(40, 40, TERRAIN_GRASS),
        calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE, // 1 cycle = 1 jour de saison
      })
      foundNpcVillage(sim, 20, 20, 0)
      sim.tick = startDay * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE - 1
      return sim
    }

    // Acte I (jour 1) : on force la chance à 1 en essayant plusieurs nuits.
    let sim = mkSim(0)
    let spawned: SimEvent[] = []
    for (let night = 0; night < 8 && spawned.length === 0; night++) {
      run(sim, TICKS_PER_CYCLE)
      spawned = [...spawned, ...collect(sim, ['horde_spawned'])]
    }
    expect(spawned.length).toBeGreaterThan(0)
    const size1 = (spawned[0] as { size: number }).size
    expect(size1).toBe(WORLD_EVENTS.HORDE_SIZE[0])
    // Dissipation : à l'aube suivante, plus un zombie de horde.
    run(sim, TICKS_PER_CYCLE)
    expect(sim.hordes).toHaveLength(0)

    // Acte II (jour 25) : taille supérieure.
    sim = mkSim(24)
    spawned = []
    for (let night = 0; night < 8 && spawned.length === 0; night++) {
      run(sim, TICKS_PER_CYCLE)
      spawned = [...spawned, ...collect(sim, ['horde_spawned'])]
    }
    expect((spawned[0] as { size: number }).size).toBe(WORLD_EVENTS.HORDE_SIZE[1])
  })
})

describe('la carcasse de convoi (A6)', () => {
  it('apparaît sur la route, gardée ; son butin se ramasse', () => {
    const map = createEmptyMap(30, 30, TERRAIN_GRASS)
    for (let tx = 0; tx < 30; tx++) map.terrain[15 * 30 + tx] = TERRAIN_ROAD
    const sim = createSim(12, { map })
    drainEvents(sim)
    spawnConvoy(sim)
    const events = collect(sim, ['convoy_spawned'])
    expect(events).toHaveLength(1)
    const { tx, ty } = events[0] as { tx: number; ty: number }
    expect(map.terrain[ty * 30 + tx]).toBe(TERRAIN_ROAD)
    expect(sim.monsters).toHaveLength(WORLD_EVENTS.CONVOY_GUARDS)
    const corpse = sim.corpses[0]!
    expect(countOf(corpse.inventory, 'components')).toBe(2)

    // Un joueur ramasse (les gardiens sont écartés pour le test).
    for (const m of [...sim.monsters]) {
      sim.entities = sim.entities.filter((e) => e.id !== m.entityId)
    }
    sim.monsters = []
    const player = spawnEntity(sim, corpse.x, corpse.y)
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(countOf(sim.entities.find((e) => e.id === player)!.inventory, 'iron_ingot')).toBe(3)
  })
})

describe('LE scénario (A7) — tient ou casse', () => {
  it('(a) horde de 4 contre milice armée de 4 : le village tient (≤ 1 perte)', { timeout: 30_000 }, () => {
    const sim = createSim(14, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
    foundNpcVillage(sim, 20, 20, 4)
    spawnHorde(sim, 4)
    for (let t = 0; t < 8000 && sim.monsters.length > 0; t++) step(sim, [])
    expect(sim.monsters).toHaveLength(0)
    expect(sim.npcs.length).toBeGreaterThanOrEqual(3)
  })

  it('(b) horde de 10 contre 2 PNJ : le village casse', { timeout: 30_000 }, () => {
    const sim = createSim(15, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
    foundNpcVillage(sim, 20, 20, 2)
    spawnHorde(sim, 10)
    for (let t = 0; t < 8000 && sim.npcs.length > 0 && sim.monsters.length > 0; t++) step(sim, [])
    expect(sim.npcs.length).toBeLessThan(2) // des morts — la défense a cassé
  })
})

describe('le déterminisme (A8)', () => {
  it('replay exact avec hordes, alarmes et carcasses', () => {
    const map = createEmptyMap(30, 30, TERRAIN_GRASS)
    for (let tx = 0; tx < 30; tx++) map.terrain[22 * 30 + tx] = TERRAIN_ROAD
    const options = { map, calendarScale: 720 }
    const setup = (state: SimState) => {
      foundNpcVillage(state, 15, 10, 3)
      spawnEntity(state, 5.5, 5.5)
      spawnHorde(state, 3)
      spawnConvoy(state)
    }
    const live = createSim(77, options)
    const log = createReplayLog(77, options)
    setup(live)
    const playerId = live.entities.find((e) => !live.npcs.some((n) => n.entityId === e.id) && !live.monsters.some((m) => m.entityId === e.id))!.id
    for (let t = 0; t < 2500; t++) {
      recordAndStep(live, log, [{ entityId: playerId, dx: t % 3 === 0 ? 1 : -1, dy: t % 5 === 0 ? 1 : 0 }])
    }
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})
