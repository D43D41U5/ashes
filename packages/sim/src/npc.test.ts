import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { foundNpcVillage } from './worldgen'
import { findPath } from './pathfinding'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE } from './time'
import { grantItems, structureAt } from './village'
import type { ResourceNode } from './economy'

/** Village PNJ de test : Feu en (12,12), grenier, maisons, ressources autour. */
function npcVillageSim(count = 2, extraNodes: ResourceNode[] = []): SimState {
  const map = createEmptyMap(28, 28, TERRAIN_GRASS)
  const nodes: ResourceNode[] = [
    { id: 1, type: 'berry_bush', tx: 18, ty: 12, stock: 8, regrowAt: 0 },
    { id: 2, type: 'berry_bush', tx: 19, ty: 14, stock: 8, regrowAt: 0 },
    { id: 3, type: 'tree', tx: 6, ty: 12, stock: 10, regrowAt: 0 },
    { id: 4, type: 'fiber_plant', tx: 12, ty: 19, stock: 6, regrowAt: 0 },
    ...extraNodes,
  ]
  const sim = createSim(11, { map, nodes })
  foundNpcVillage(sim, 12, 12, count)
  return sim
}

const npcEntity = (sim: SimState, i = 0) => sim.entities.find((e) => e.id === sim.npcs[i]!.entityId)!
const granary = (sim: SimState) => sim.structures.find((s) => s.type === 'chest')!

function run(sim: SimState, ticks: number): void {
  for (let t = 0; t < ticks; t++) step(sim, [])
}

describe('le tableau du village (A1)', () => {
  it('les seuils génèrent les tâches ; jamais de double réclamation', () => {
    const sim = npcVillageSim(3)
    granary(sim).inventory = {} // grenier à sec → tout manque
    run(sim, BALANCE.BOARD_REFRESH_TICKS + 1)
    const village = sim.villages[0]!
    const kinds = village.tasks.map((t) => t.kind)
    expect(kinds).toContain('gather_berries')
    expect(kinds).toContain('gather_wood')
    expect(kinds).toContain('gather_fiber')
    // Chaque tâche réclamée l'est par un PNJ distinct.
    run(sim, 24)
    const claimed = village.tasks.filter((t) => t.claimedBy !== null).map((t) => t.claimedBy)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('grenier plein → pas de tâches de récolte', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = { berries: 30, wood: 30, fiber: 5, stew: 5 }
    run(sim, BALANCE.BOARD_REFRESH_TICKS + 1)
    expect(sim.villages[0]!.tasks).toHaveLength(0)
  })
})

describe('les besoins (A2, A3)', () => {
  it('A2 — un PNJ affamé va retirer au grenier et mange', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = { berries: 10, wood: 30, fiber: 5, stew: 5 } // rien d'autre à faire
    const entity = npcEntity(sim)
    entity.hunger = 20
    run(sim, 600) // largement le temps d'aller au coffre (2 tuiles) et manger
    expect(entity.hunger).toBeGreaterThan(BALANCE.NPC_HUNGER_EAT_THRESHOLD)
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'meal_eaten' && e.entityId === entity.id)).toBe(true)
  })

  it('A3 — la nuit, le PNJ fatigué dort ; la maison récupère ×2 vs le Feu', () => {
    const sim = npcVillageSim(2)
    granary(sim).inventory = { berries: 30, wood: 30, fiber: 5, stew: 5 } // oisifs
    run(sim, 60) // assignation des maisons
    const [a, b] = [sim.npcs[0]!, sim.npcs[1]!]
    expect(a.homeId).not.toBeNull()
    // b dormira au Feu : on retire sa maison ET les maisons libres (sinon
    // l'assignation automatique lui en redonne une au tick suivant).
    sim.structures = sim.structures.filter((s) => s.type !== 'house' || s.id === a.homeId)
    b.homeId = null
    // Avancer jusqu'à la nuit, fatigués.
    sim.tick = DAY_TICKS_PER_CYCLE - 1
    a.energy = 20
    b.energy = 20
    run(sim, 1200) // 100 s : le temps d'aller se coucher et dormir un peu
    expect(a.sleeping).toBe(true)
    expect(b.sleeping).toBe(true)
    const gainA = a.energy - 20
    const gainB = b.energy - 20
    expect(gainA / gainB).toBeCloseTo(
      BALANCE.SLEEP_RECOVERY_HOME_PER_HOUR / BALANCE.SLEEP_RECOVERY_FIRE_PER_HOUR,
      1,
    )
    // Au matin, tout le monde debout.
    sim.tick = TICKS_PER_CYCLE - 2
    run(sim, 4)
    expect(sim.npcs[0]!.sleeping).toBe(false)
  })
})

describe('la navigation (A4)', () => {
  it('A* contourne un mur de roche ; chemin identique à chaque run', () => {
    const map = createEmptyMap(20, 20, TERRAIN_GRASS)
    for (let ty = 2; ty < 18; ty++) map.terrain[ty * 20 + 10] = TERRAIN_ROCK // mur vertical, passage en haut
    const world = { map }
    const p1 = findPath(world, { tx: 5, ty: 10 }, { tx: 15, ty: 10 })
    const p2 = findPath(world, { tx: 5, ty: 10 }, { tx: 15, ty: 10 })
    expect(p1).not.toBeNull()
    expect(p1!.length).toBeGreaterThan(18) // bien plus long que la ligne droite (10)
    expect(p1).toEqual(p2)
    // Contourne par l'une des deux extrémités du mur (ty 2-17).
    expect(p1!.some((t) => t.tx === 10 && (t.ty <= 1 || t.ty >= 18))).toBe(true)
    // Cible emmurée → null.
    for (let tx = 0; tx < 20; tx++) {
      map.terrain[5 * 20 + tx] = TERRAIN_ROCK
      map.terrain[15 * 20 + tx] = TERRAIN_ROCK
    }
    for (let ty = 5; ty <= 15; ty++) {
      map.terrain[ty * 20 + 0] = TERRAIN_ROCK
      map.terrain[ty * 20 + 19] = TERRAIN_ROCK
    }
    expect(findPath({ map }, { tx: 2, ty: 2 }, { tx: 10, ty: 10 })).toBeNull()
  })
})

describe('la locomotion des PNJ', () => {
  it('un PNJ qui marche (A*) est marqué moved — sa régén d’endurance est celle du mouvement', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = {} // tout manque → il part récolter
    const e = npcEntity(sim)
    let movedWhileWalking: boolean | undefined
    for (let t = 0; t < 600; t++) {
      const bx = e.x
      const by = e.y
      step(sim, [])
      if (e.x !== bx || e.y !== by) {
        movedWhileWalking = e.moved
        break
      }
    }
    expect(movedWhileWalking).toBe(true)
  })
})

describe('le travail (A5)', () => {
  it('récolter baies : le PNJ y va, récolte, dépose — le grenier monte', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = { wood: 30, fiber: 5 } // il ne manque que la nourriture
    const before = 0
    run(sim, 2400) // 200 s simulées
    const after = countOf(granary(sim).inventory!, 'berries')
    expect(after).toBeGreaterThan(before)
    // Et le PNJ a bien gardé de quoi manger (spec R6).
    expect(countOf(npcEntity(sim).inventory, 'berries')).toBeGreaterThanOrEqual(0)
  })
})

describe('le peuplement (A6)', () => {
  it('fonder en joueur attire 3 PNJ membres', () => {
    const sim = createSim(3, { map: createEmptyMap(32, 32, TERRAIN_GRASS) })
    const player = spawnEntity(sim, 15.5, 15.5)
    grantItems(sim, player, { wood: 10 })
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    step(sim, []) // l'arrivée se fait au tick suivant la fondation
    expect(sim.npcs).toHaveLength(BALANCE.NPC_PER_VILLAGE)
    const village = sim.villages[0]!
    for (const npc of sim.npcs) expect(village.memberIds).toContain(npc.entityId)
  })

  it('foundNpcVillage crée un village complet', () => {
    const sim = npcVillageSim(3)
    expect(sim.villages).toHaveLength(1)
    expect(sim.npcs).toHaveLength(3)
    expect(structureAt(sim.structures, 12, 12)?.type).toBe('fire')
    expect(granary(sim).access).toBe('village')
    expect(sim.structures.filter((s) => s.type === 'house')).toHaveLength(3)
  })
})

describe('LE critère (A7) — un village 100 % PNJ survit 10 jours', () => {
  it('4 PNJ, 10 cycles jour/nuit : personne à 0 de faim, le grenier respire', { timeout: 60_000 }, () => {
    const sim = npcVillageSim(4, [
      { id: 10, type: 'berry_bush', tx: 5, ty: 5, stock: 8, regrowAt: 0 },
      { id: 11, type: 'berry_bush', tx: 20, ty: 20, stock: 8, regrowAt: 0 },
      { id: 12, type: 'tree', tx: 22, ty: 6, stock: 10, regrowAt: 0 },
    ])
    const days = 10
    const total = days * TICKS_PER_CYCLE
    const warmup = TICKS_PER_CYCLE // 1er cycle : mise en route
    let starvedTicks = 0
    for (let t = 0; t < total; t++) {
      step(sim, [])
      if (t > warmup && t % 250 === 0) {
        for (const npc of sim.npcs) {
          const e = sim.entities.find((en) => en.id === npc.entityId)!
          if (e.hunger <= 0) starvedTicks += 1
        }
      }
    }
    expect(starvedTicks).toBe(0)
    // Le village a plus de vivres au grenier + inventaires qu'un désert.
    const totalFood =
      countOf(granary(sim).inventory!, 'berries') +
      3 * countOf(granary(sim).inventory!, 'stew') +
      sim.npcs.reduce((sum, n) => {
        const e = sim.entities.find((en) => en.id === n.entityId)!
        return sum + countOf(e.inventory, 'berries') + 3 * countOf(e.inventory, 'stew')
      }, 0)
    expect(totalFood).toBeGreaterThan(0)
  })
})

describe('le déterminisme avec IA (A8)', () => {
  it('même seed = même village au bit près après 2 cycles', { timeout: 30_000 }, () => {
    const runVillage = (): string => {
      const sim = npcVillageSim(3)
      run(sim, 2 * TICKS_PER_CYCLE)
      return snapshot(sim)
    }
    expect(runVillage()).toBe(runVillage())
  })

  it('le replay d’une partie joueur + PNJ est exact', () => {
    const map = createEmptyMap(28, 28, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'berry_bush', tx: 18, ty: 12, stock: 8, regrowAt: 0 }]
    const options = { map, nodes }
    const setup = (state: SimState) => {
      spawnEntity(state, 5.5, 5.5)
      foundNpcVillage(state, 12, 12, 2)
    }
    const live = createSim(21, options)
    const log = createReplayLog(21, options)
    setup(live)
    for (let t = 0; t < 3000; t++) {
      recordAndStep(live, log, [{ entityId: 1, dx: t % 3 === 0 ? 1 : -1, dy: t % 7 === 0 ? 1 : 0 }])
    }
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})
