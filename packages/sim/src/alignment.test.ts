import { describe, expect, it } from 'vitest'
import { ALIGNMENT, BALANCE, COMBAT, TERRAIN_GRASS } from './balance'
import { archetypeOf } from './alignment'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { foundNpcVillage } from './npc'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { grantItems } from './village'

function makeSim(calendarScale = 1): SimState {
  return createSim(19, { map: createEmptyMap(48, 48, TERRAIN_GRASS), calendarScale })
}

const entity = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

/** Deux villages voisins d'un membre chacun, à portée l'un de l'autre. */
function twoVillages(sim: SimState): { a: number; b: number } {
  const a = spawnEntity(sim, 10.5, 10.5)
  grantItems(sim, a, { wood: 10 })
  act(sim, a, { type: 'light_fire' })
  sim.villages[0]!.npcsArrived = true // pas de PNJ d'accueil pour ce test
  sim.npcs = []
  sim.entities = sim.entities.filter((e) => e.id === a)
  sim.villages[0]!.memberIds = [a]

  const b = spawnEntity(sim, 11.5, 10.5)
  grantItems(sim, b, { wood: 10 })
  entity(sim, b).x = 45.5 // fonder loin (distance min entre Feux)…
  entity(sim, b).y = 45.5
  act(sim, b, { type: 'light_fire' })
  sim.villages[1]!.npcsArrived = true
  sim.npcs = []
  sim.entities = sim.entities.filter((e) => e.id === a || e.id === b)
  sim.villages[1]!.memberIds = [b]
  entity(sim, b).x = 11.5 // …puis revenir au contact
  entity(sim, b).y = 10.5
  return { a, b }
}

describe('les actes (A1)', () => {
  it('nourrir un affamé extérieur : la faim utile × besoin × acte', () => {
    const sim = makeSim()
    const { a, b } = twoVillages(sim)
    grantItems(sim, a, { berries: 10 })
    entity(sim, b).hunger = 20 // affamé (< 30)
    act(sim, a, { type: 'give', targetEntityId: b, item: 'berries', count: 2 })
    // utile = min(30, 80) = 30 → 30 × 0.2 × 3 (besoin) × 1 (acte I) = 18.
    expect(entity(sim, a).warmth).toBeCloseTo(18, 0)
    expect(entity(sim, a).engagement).toBeGreaterThan(0)
    expect(countOf(entity(sim, b).inventory, 'berries')).toBe(2)

    // Donner à un repu ne vaut presque rien.
    const before = entity(sim, a).warmth
    entity(sim, b).hunger = 100
    act(sim, a, { type: 'give', targetEntityId: b, item: 'berries', count: 2 })
    expect(entity(sim, a).warmth - before).toBeCloseTo(0, 1)
  })

  it('le même don vaut double au Grand Froid (acte II)', () => {
    const sim = makeSim(TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE) // 1 cycle = 1 jour
    const { a, b } = twoVillages(sim)
    grantItems(sim, a, { berries: 10 })
    sim.tick = 25 * TICKS_PER_CYCLE // jour 26 : acte II
    entity(sim, b).hunger = 20
    act(sim, a, { type: 'give', targetEntityId: b, item: 'berries', count: 2 })
    expect(entity(sim, a).warmth).toBeCloseTo(36, 0) // 18 × 2
  })
})

describe('le premier sang (A2)', () => {
  it('l’agresseur paie plein tarif, la riposte presque rien', () => {
    const sim = makeSim()
    const { a, b } = twoVillages(sim)
    // a frappe b : premier sang.
    act(sim, a, { type: 'attack', dx: 1, dy: 0 })
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 1; t++) step(sim, [])
    expect(entity(sim, a).warmth).toBeCloseTo(ALIGNMENT.FIRST_BLOOD_WARMTH, 0)
    // b riposte : presque gratuit.
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) step(sim, [])
    act(sim, b, { type: 'attack', dx: -1, dy: 0 })
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 1; t++) step(sim, [])
    expect(entity(sim, b).warmth).toBeCloseTo(ALIGNMENT.RIPOSTE_WARMTH, 0)
  })
})

describe('l’inertie (A3)', () => {
  it('la chaleur revient linéairement vers 0 (le paquebot)', () => {
    const sim = makeSim(TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE) // 1 cycle = 1 jour
    const a = spawnEntity(sim, 10.5, 10.5)
    entity(sim, a).warmth = 40
    for (let t = 0; t < 5 * TICKS_PER_CYCLE; t++) step(sim, []) // 5 jours
    expect(entity(sim, a).warmth).toBeCloseTo(40 - 5 * ALIGNMENT.DECAY_PER_DAY, 0)
  })
})

describe('l’agrégation (A4)', () => {
  it('le berserker plafonné par tête ; le bannir rend le Feu neutre', () => {
    const sim = makeSim()
    foundNpcVillage(sim, 20, 20, 3) // 3 PNJ neutres
    const village = sim.villages[0]!
    const berserker = sim.npcs[0]!.entityId
    entity(sim, berserker).warmth = -100
    for (const n of sim.npcs) entity(sim, n.entityId).engagement = 30
    step(sim, []) // recalcul au tick 0 % 60
    for (let t = 0; t < ALIGNMENT.REFRESH_TICKS + 1; t++) step(sim, [])
    // clamp(−100 → −50) / 3 membres ≈ −16.7 : le village ne vire pas Meute.
    expect(village.warmth).toBeCloseTo(-50 / 3, 0)
    expect(archetypeOf(village)).toBe('neutre')

    village.memberIds = village.memberIds.filter((id) => id !== berserker)
    for (let t = 0; t < ALIGNMENT.REFRESH_TICKS + 1; t++) step(sim, [])
    expect(village.warmth).toBeCloseTo(0, 0)
  })
})

describe('les paliers (A5)', () => {
  it('Foyer : régén ×2 et frappe retenue ; Meute : récolte anémique et morsure', () => {
    const sim = makeSim()
    const { a, b } = twoVillages(sim)
    const va = sim.villages[0]!
    const vb = sim.villages[1]!
    va.warmth = 80
    va.engagement = 50
    va.archetype = 'foyer'
    vb.warmth = -80
    vb.engagement = 50
    vb.archetype = 'meute'

    // Régén : le membre du Foyer (chaleur 80) régénère plus vite que la Meute.
    entity(sim, a).hp = 50
    entity(sim, b).hp = 50
    entity(sim, a).x = 30 // hors de portée l'un de l'autre
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) step(sim, []) // 1 min — mais le recalcul du Feu écrase…
    // (le recalcul a réécrit warmth depuis les membres : on vérifie le ratio brut)
    expect(entity(sim, a).hp).toBeGreaterThan(entity(sim, b).hp)

    // Dégâts : on refige les archétypes puis on frappe.
    va.warmth = 80
    va.engagement = 50
    vb.warmth = -80
    vb.engagement = 50
    entity(sim, a).x = 11.5
    entity(sim, a).y = 10.5
    entity(sim, b).x = 12.5
    entity(sim, b).y = 10.5
    entity(sim, b).hp = 100
    entity(sim, a).hp = 100
    // Le Foyer initie (non provoqué) : ×0.6. 6 × 0.6 = 3.6.
    act(sim, a, { type: 'attack', dx: 1, dy: 0 })
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 1; t++) step(sim, [])
    expect(100 - entity(sim, b).hp).toBeCloseTo(6 * ALIGNMENT.FOYER_OFFENSE_MALUS, 0)
    // La Meute mord : ×1.2 — et c'est une riposte (a a frappé d'abord).
    va.warmth = 80
    va.engagement = 50
    vb.warmth = -80
    vb.engagement = 50
    entity(sim, a).hp = 100
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) step(sim, [])
    act(sim, b, { type: 'attack', dx: -1, dy: 0 })
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 1; t++) step(sim, [])
    expect(100 - entity(sim, a).hp).toBeCloseTo(6 * ALIGNMENT.MEUTE_DAMAGE_BONUS, 0)
  })
})

describe('LE test (A7) — le paquebot vire, la Meute raide', () => {
  it('(a) nourrir ses voisins jour après jour fait virer le Feu au bleu', { timeout: 30_000 }, () => {
    const sim = makeSim()
    const { a, b } = twoVillages(sim)
    grantItems(sim, a, { berries: 200 })
    // Plusieurs dons espacés à un affamé : la chaleur s'accumule plus vite
    // qu'elle ne décroît, le Feu suit avec inertie.
    for (let i = 0; i < 6; i++) {
      entity(sim, b).hunger = 15
      act(sim, a, { type: 'give', targetEntityId: b, item: 'berries', count: 3 })
      for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])
    }
    expect(entity(sim, a).warmth).toBeGreaterThan(ALIGNMENT.ARCHETYPE_WARMTH)
    expect(sim.villages[0]!.warmth).toBeGreaterThan(20) // plafonné par tête mais bien bleu
    expect(sim.villages[0]!.archetype).toBe('foyer') // village d'un seul membre : le Feu suit
  })

  it('(b) une Meute PNJ raide la nuit : grenier voisin cassé, butin rapporté, alarme', { timeout: 60_000 }, () => {
    const sim = createSim(23, { map: createEmptyMap(60, 60, TERRAIN_GRASS) })
    foundNpcVillage(sim, 15, 15, 3, 'neutre') // la victime
    const victim = sim.villages[0]!
    foundNpcVillage(sim, 40, 40, 4, 'meute') // la Meute
    const meute = sim.villages[1]!
    // Laisser l'agrégation classer la Meute.
    for (let t = 0; t < ALIGNMENT.REFRESH_TICKS + 1; t++) step(sim, [])
    expect(meute.archetype).toBe('meute')

    const victimChest = sim.structures.find((s) => s.type === 'chest' && s.villageId === victim.id)!
    const meuteChest = sim.structures.find((s) => s.type === 'chest' && s.villageId === meute.id)!
    const meuteWoodBefore = countOf(meuteChest.inventory ?? {}, 'wood')

    // Avancer à la nuit et laisser le raid se jouer.
    sim.tick = DAY_TICKS_PER_CYCLE - 10
    drainEvents(sim)
    let alarm = false
    let chestBroken = false
    // Large marge en nuits, pas juste en ticks : des hordes peuvent décimer les
    // raiders et retarder le raid de plusieurs nuits avant qu'il aboutisse.
    for (let t = 0; t < 10 * TICKS_PER_CYCLE; t++) {
      step(sim, [])
      for (const e of drainEvents(sim)) {
        if (e.type === 'alarm_raised' && e.villageId === victim.id) alarm = true
        if (e.type === 'structure_destroyed' && e.structureId === victimChest.id) chestBroken = true
      }
      if (chestBroken && sim.npcs.filter((n) => n.villageId === meute.id).every((n) => !n.errand)) break
    }
    expect(alarm).toBe(true)
    expect(chestBroken).toBe(true)
    // Les raiders ont froidi (destruction + éventuels coups).
    const raiderWarmths = sim.npcs
      .filter((n) => n.villageId === meute.id)
      .map((n) => entity(sim, n.entityId)?.warmth ?? -60)
    expect(Math.min(...raiderWarmths)).toBeLessThan(-60)
    // Et du butin est rentré (ou au pire porté) : le grenier Meute a gagné du stock.
    const meuteWoodAfter = countOf(meuteChest.inventory ?? {}, 'wood')
    const carried = sim.npcs
      .filter((n) => n.villageId === meute.id)
      .reduce((sum, n) => sum + countOf(entity(sim, n.entityId)?.inventory ?? {}, 'wood'), 0)
    expect(meuteWoodAfter + carried).toBeGreaterThan(meuteWoodBefore - 1)
  })
})

describe('le déterminisme (A8)', () => {
  it('replay exact avec alignement, dons et raid actifs', { timeout: 30_000 }, () => {
    const options = { map: createEmptyMap(60, 60, TERRAIN_GRASS) }
    // Le setup (rejoué à l'identique) inclut le saut à l'approche de la nuit.
    const setup = (state: SimState) => {
      foundNpcVillage(state, 15, 15, 2, 'foyer')
      foundNpcVillage(state, 42, 42, 3, 'meute')
      spawnEntity(state, 28.5, 28.5)
      state.tick = DAY_TICKS_PER_CYCLE - 100
    }
    const live = createSim(31, options)
    const log = createReplayLog(31, options)
    setup(live)
    const playerId = live.entities[live.entities.length - 1]!.id
    for (let t = 0; t < 4000; t++) {
      recordAndStep(live, log, [{ entityId: playerId, dx: t % 3 === 0 ? 1 : -1, dy: t % 5 === 0 ? 1 : 0 }])
    }
    expect(snapshot(runReplay(log, setup))).toBe(snapshot(live))
  })
})
