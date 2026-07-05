/**
 * Le banc de test permanent (GDD §10, roadmap V10) : joue des saisons
 * entières headless et produit un rapport — l'outil de calibrage de
 * balance.ts, pour les humains comme pour les agents.
 */
import { TERRAIN_GRASS, TERRAIN_ROAD } from './balance'
import { chronicleFromEvents } from './chronicle'
import { generateNodes } from './economy'
import { drainEvents, type SimEvent } from './events'
import { createEmptyMap } from './map'
import { foundNpcVillage } from './npc'
import { createSim, step } from './sim'
import { TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { countOf } from './items'

export interface ScenarioReport {
  days: number
  ticks: number
  villages: {
    name: string
    archetype: string
    membersAlive: number
    granaryFood: number
    granaryWood: number
  }[]
  starvationSamples: number
  deaths: number
  hordesSpawned: number
  chronicle: string[]
}

/** Joue `days` jours complets (1 cycle = 1 jour) sur un monde de référence. */
export function runScenario(seed: number, days: number): ScenarioReport {
  const map = createEmptyMap(48, 48, TERRAIN_GRASS)
  for (let tx = 0; tx < 48; tx++) map.terrain[24 * 48 + tx] = TERRAIN_ROAD
  map.zones = [{ name: 'la Mine', kind: 'gisement', x: 36, y: 6, w: 10, h: 8 }]
  const nodes = generateNodes(map, seed)
  const sim = createSim(seed, { map, nodes, calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE })
  foundNpcVillage(sim, 12, 12, 4, 'foyer')
  foundNpcVillage(sim, 36, 36, 3, 'meute')
  foundNpcVillage(sim, 12, 36, 3, 'neutre')

  const events: SimEvent[] = [...drainEvents(sim)]
  let starvationSamples = 0
  let deaths = 0
  let hordesSpawned = 0
  const total = days * TICKS_PER_CYCLE
  for (let t = 0; t < total; t++) {
    step(sim, [])
    for (const e of drainEvents(sim)) {
      events.push(e)
      if (e.type === 'entity_died' && !e.wasMonster) deaths += 1
      if (e.type === 'horde_spawned') hordesSpawned += 1
    }
    if (t % 500 === 0) {
      for (const npc of sim.npcs) {
        const entity = sim.entities.find((en) => en.id === npc.entityId)
        if (entity && entity.hunger <= 0) starvationSamples += 1
      }
    }
  }

  const names = Object.fromEntries(sim.villages.map((v) => [v.id, v.name]))
  return {
    days,
    ticks: total,
    villages: sim.villages.map((v) => {
      const granary = sim.structures.find(
        (s) => s.type === 'chest' && s.villageId === v.id && s.access === 'village',
      )
      return {
        name: v.name,
        archetype: v.archetype,
        membersAlive: sim.entities.filter((e) => v.memberIds.includes(e.id) && e.hp > 0).length,
        granaryFood:
          countOf(granary?.inventory ?? {}, 'berries') + 3 * countOf(granary?.inventory ?? {}, 'stew'),
        granaryWood: countOf(granary?.inventory ?? {}, 'wood'),
      }
    }),
    starvationSamples,
    deaths,
    hordesSpawned,
    chronicle: chronicleFromEvents(events, sim.calendarScale, names),
  }
}
