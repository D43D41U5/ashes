/**
 * Les événements du monde — hordes, carcasses, alarmes (spec événements).
 *
 * Le robinet à sessions (GDD §6) : la nuit apporte la menace, la route
 * apporte l'opportunité. Tout est tiré au PRNG de la sim et cadencé par le
 * calendrier — la pression monte avec les actes (GDD §2).
 */
import { COMBAT, CONVOY_LOOT, TERRAIN_ROAD, WORLD_EVENTS } from './balance'
import { isBlockedAt } from './collision'
import { rngRoll } from './rng'
import { spawnMonster } from './monsters'
import type { SimState } from './sim'
import { actForDay, DAY_TICKS_PER_CYCLE, seasonDayAtTick, TICKS_PER_CYCLE } from './time'
import { emitEvent } from './events'

export interface Horde {
  id: number
  targetVillageId: number
  memberEntityIds: number[]
}

function roll(state: SimState): number {
  const { value, next } = rngRoll(state.rngState)
  state.rngState = next
  return value
}


/** Fait apparaître une horde en bord de carte, ciblant le village le plus proche. */
export function spawnHorde(state: SimState, size: number): Horde | null {
  if (state.villages.length === 0) return null
  const { width, height } = state.map
  // Un point d'entrée sur un bord, marchable.
  let ex = 1
  let ey = 1
  for (let tries = 0; tries < 40; tries++) {
    const side = Math.floor(roll(state) * 4)
    const along = 2 + Math.floor(roll(state) * (Math.max(width, height) - 4))
    ex = side === 0 ? 1 : side === 1 ? width - 2 : Math.min(along, width - 2)
    ey = side === 0 || side === 1 ? Math.min(along, height - 2) : side === 2 ? 1 : height - 2
    if (!isBlockedAt({ map: state.map, nodes: state.nodes }, ex, ey)) break
  }

  let target = state.villages[0]!
  let bestD = Infinity
  for (const v of state.villages) {
    const d = (v.fireTx - ex) * (v.fireTx - ex) + (v.fireTy - ey) * (v.fireTy - ey)
    if (d < bestD) {
      target = v
      bestD = d
    }
  }

  const horde: Horde = { id: state.nextHordeId, targetVillageId: target.id, memberEntityIds: [] }
  state.nextHordeId += 1
  for (let i = 0; i < size; i++) {
    const ox = ex + (i % 3) - 1
    const oy = ey + Math.floor(i / 3) - 1
    const sx = Math.max(1, Math.min(state.map.width - 2, ox))
    const sy = Math.max(1, Math.min(state.map.height - 2, oy))
    horde.memberEntityIds.push(spawnMonster(state, 'zombie', sx + 0.5, sy + 0.5))
  }
  state.hordes.push(horde)
  emitEvent(state, {
    type: 'horde_spawned',
    tick: state.tick,
    hordeId: horde.id,
    size,
    targetVillageId: target.id,
  })
  return horde
}

/** Fait apparaître une carcasse de convoi sur la route, gardée (spec R6). */
export function spawnConvoy(state: SimState): void {
  const roadTiles: number[] = []
  for (let i = 0; i < state.map.terrain.length; i++) {
    if (state.map.terrain[i] === TERRAIN_ROAD) roadTiles.push(i)
  }
  if (roadTiles.length === 0) return
  const key = roadTiles[Math.floor(roll(state) * roadTiles.length)]!
  const tx = key % state.map.width
  const ty = Math.floor(key / state.map.width)
  state.corpses.push({
    id: state.nextCorpseId,
    x: tx + 0.5,
    y: ty + 0.5,
    inventory: { ...CONVOY_LOOT },
    decayAt: state.tick + WORLD_EVENTS.CONVOY_DECAY_TICKS,
  })
  state.nextCorpseId += 1
  for (let i = 0; i < WORLD_EVENTS.CONVOY_GUARDS; i++) {
    spawnMonster(state, 'zombie', tx + 0.5 + (i === 0 ? 1 : -1), ty + 1.5)
  }
  emitEvent(state, { type: 'convoy_spawned', tick: state.tick, tx, ty })
}

/** L'ordonnanceur du monde (spec R8) : appelé chaque tick par step(). */
export function advanceWorldEvents(state: SimState): void {
  const cycleTick = state.tick % TICKS_PER_CYCLE
  const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))

  // La nuit tombe : peut-être une horde (spec R5).
  if (cycleTick === DAY_TICKS_PER_CYCLE && state.villages.length > 0) {
    if (roll(state) < WORLD_EVENTS.HORDE_CHANCE_PER_NIGHT[act - 1]!) {
      spawnHorde(state, WORLD_EVENTS.HORDE_SIZE[act - 1]!)
    }
  }

  // L'aube : les hordes survivantes se dissipent (le tick 0 n'est pas une aube).
  if (cycleTick === 0 && state.tick > 0 && state.hordes.length > 0) {
    for (const horde of state.hordes) {
      for (const id of horde.memberEntityIds) {
        state.entities = state.entities.filter((e) => e.id !== id)
        state.monsters = state.monsters.filter((m) => m.entityId !== id)
      }
      emitEvent(state, { type: 'horde_dispersed', tick: state.tick, hordeId: horde.id })
    }
    state.hordes = []
  }

  // La carcasse de convoi, tous les N jours de saison (spec R6).
  const day = seasonDayAtTick(state.tick, state.calendarScale)
  if (
    day !== state.lastConvoyDay &&
    day % WORLD_EVENTS.CONVOY_PERIOD_DAYS === 0 &&
    state.map.terrain.includes(TERRAIN_ROAD)
  ) {
    state.lastConvoyDay = day
    spawnConvoy(state)
  }

  // L'alarme (spec R4) : une par vague et par village.
  for (const village of state.villages) {
    if (state.tick < village.lastAlarmAt + WORLD_EVENTS.ALARM_COOLDOWN_TICKS) continue
    const radius = COMBAT.DEFEND_RADIUS
    const threatened = state.monsters.some((m) => {
      const e = state.entities.find((en) => en.id === m.entityId)
      if (!e) return false
      const dx = e.x - (village.fireTx + 0.5)
      const dy = e.y - (village.fireTy + 0.5)
      return dx * dx + dy * dy <= radius * radius
    })
    if (threatened) {
      village.lastAlarmAt = state.tick
      emitEvent(state, { type: 'alarm_raised', tick: state.tick, villageId: village.id })
    }
  }

  // Nettoyage des hordes vidées par la milice.
  state.hordes = state.hordes.filter((h) =>
    h.memberEntityIds.some((id) => state.entities.some((e) => e.id === id)),
  )
}
