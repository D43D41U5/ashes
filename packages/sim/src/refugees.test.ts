/**
 * LES RÉFUGIÉS (V2-25, GDD §520) — arrivée cadencée, et les quatre gestes : recruter (+PNJ,
 * Foyer), nourrir (Foyer), refouler (ils repartent), dépouiller (Meute). Headless, sim-first.
 */
import { describe, expect, it } from 'vitest'
import { REFUGEES, TERRAIN_GRASS, TERRAIN_ROAD } from './balance'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { advanceRefugees } from './refugees'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { applyVillageAction, getVillageOf, grantItems } from './village'

/** Une carte avec une route (bande) pour que les réfugiés aient où arriver. */
function roadSim(): SimState {
  const map = createEmptyMap(96, 96, TERRAIN_GRASS)
  for (let x = 10; x < 40; x++) map.terrain[20 * 96 + x] = TERRAIN_ROAD
  return createSim(42, { map, worldEvents: true, calendarScale: 720 })
}

/** Amène la sim au jour 6 (PERIOD_DAYS, échelle 720 → tick 12000) et déclenche l'arrivée. */
function spawnAGroup(sim: SimState) {
  sim.tick = 12000 // seasonDayAtTick(12000, 720) = 6 ; 6 % 6 === 0 → arrivée
  advanceRefugees(sim)
  return sim.refugeeGroups[0]!
}

describe('les réfugiés (V2-25)', () => {
  it('arrivent sur une route à la cadence, et émettent refugees_arrived', () => {
    const sim = roadSim()
    drainEvents(sim)
    const g = spawnAGroup(sim)
    expect(sim.refugeeGroups).toHaveLength(1)
    expect(g.count).toBe(REFUGEES.COUNT)
    expect(sim.map.terrain[g.ty * 96 + g.tx]).toBe(TERRAIN_ROAD)
    expect(drainEvents(sim).some((e) => e.type === 'refugees_arrived')).toBe(true)
  })

  it('RECRUTER : les survivants rejoignent le village (+PNJ) et réchauffent (Foyer)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const id = spawnEntity(sim, g.tx + 0.5, g.ty + 0.5) // à portée du groupe
    grantItems(sim, id, { wood: 30, stone: 20 })
    applyVillageAction(sim, id, { type: 'light_fire' })
    const v = getVillageOf(sim, id)!
    const membersBefore = v.memberIds.length
    const me = sim.entities.find((e) => e.id === id)!
    const warmthBefore = me.warmth
    applyVillageAction(sim, id, { type: 'recruit_refugees', groupId: g.id })
    expect(sim.refugeeGroups).toHaveLength(0) // le groupe est absorbé
    expect(getVillageOf(sim, id)!.memberIds.length).toBeGreaterThan(membersBefore) // +PNJ
    expect(me.warmth).toBeGreaterThan(warmthBefore) // Foyer
  })

  it('DÉPOUILLER : on prend leur bien, et ça refroidit (Meute)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const loot = countOf(g.inventory, 'fiber')
    expect(loot).toBeGreaterThan(0)
    const id = spawnEntity(sim, g.tx + 0.5, g.ty + 0.5)
    const me = sim.entities.find((e) => e.id === id)!
    applyVillageAction(sim, id, { type: 'rob_refugees', groupId: g.id })
    expect(sim.refugeeGroups).toHaveLength(0)
    expect(countOf(me.inventory, 'fiber')).toBe(loot) // le bien a changé de mains
    expect(me.warmth).toBeLessThan(0) // prédation
  })

  it('REFOULER : sans intervention, ils repartent à `until` (refugees_left)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    drainEvents(sim)
    sim.tick = g.until // l'heure du départ (un autre groupe peut arriver ce jour-là : on suit LE nôtre)
    advanceRefugees(sim)
    expect(sim.refugeeGroups.some((x) => x.id === g.id)).toBe(false) // le groupe d'origine est parti
    expect(drainEvents(sim).some((e) => e.type === 'refugees_left' && e.groupId === g.id)).toBe(true)
  })

  it('trop loin : le geste est refusé (rien ne se passe)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const id = spawnEntity(sim, g.tx + 20, g.ty + 20) // hors de portée
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'rob_refugees', groupId: g.id } }])
    expect(sim.refugeeGroups).toHaveLength(1) // toujours là
  })
})
