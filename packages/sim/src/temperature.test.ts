import { describe, it, expect } from 'vitest'
import { COMBAT } from './balance'
import { createSim, spawnEntity, type Entity, type SimState } from './sim'
import {
  advanceTemperature,
  ambientTemperature,
  coldDamagePerTick,
  coldEffectRamp,
  coldSpeedFactor,
  coldStaminaRegenFactor,
  driftStep,
} from './temperature'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/** spawnEntity retourne un id → on récupère l'objet entité. */
function spawn(state: SimState, x: number, y: number): Entity {
  const id = spawnEntity(state, x, y)
  return state.entities.find((e) => e.id === id)!
}

/** Remplit toute la carte d'un terrain + une élévation uniformes. */
function flatMap(state: SimState, terrain: number, elevation: number): void {
  const n = state.map.width * state.map.height
  state.map.terrain = new Array(n).fill(terrain)
  state.map.elevation = new Array(n).fill(elevation)
}

describe('jauge temperature', () => {
  it('un nouvel avatar naît à température 100', () => {
    const state = createSim(1)
    expect(spawn(state, 5, 5).temperature).toBe(100)
  })
})

describe('ambientTemperature', () => {
  it('fond de vallée, jour, acte I = confort (≥60)', () => {
    const state = createSim(1) // tick 0 = aube (jour), acte I
    flatMap(state, 1 /* grass */, 0)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThanOrEqual(60)
  })

  it('glacier en altitude = glacial (≤20)', () => {
    const state = createSim(1)
    flatMap(state, 15 /* glacier */, 0.85)
    expect(ambientTemperature(state, 5, 5)).toBeLessThanOrEqual(20)
  })

  it("près d'un feu, la cible remonte au chaud (>60)", () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85) // sinon glacial
    state.structures.push({ type: 'fire', tx: 5, ty: 5 } as never)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThan(60)
  })

  it('sous abri, le froid nocturne est amorti (~moitié)', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit dès le tick 0
    flatMap(state, 1 /* grass */, 0)
    const exposed = ambientTemperature(state, 5, 5)
    state.structures.push({ type: 'house', tx: 5, ty: 5 } as never)
    const sheltered = ambientTemperature(state, 5, 5)
    expect(sheltered).toBeGreaterThan(exposed)
    expect(sheltered - exposed).toBeCloseTo(10, 5) // pénalité nocturne 20 → 10
  })
})

describe('dérive thermostat', () => {
  it("driftStep rapproche de l'ambiant ; une meilleure isolation ralentit", () => {
    const d1 = driftStep(100, 0, 1)
    const d2 = driftStep(100, 0, 2)
    expect(d1).toBeLessThan(100) // refroidit vers 0
    expect(100 - d2).toBeLessThan(100 - d1) // isolation 2 → moins de perte
  })

  it('un humain sur glacier refroidit strictement', () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85)
    const e = spawn(state, 5, 5)
    const before = e.temperature
    advanceTemperature(state)
    expect(e.temperature).toBeLessThan(before)
  })

  it('reste au confort (≥60) sur un ambiant doux, indéfiniment', () => {
    const state = createSim(1, { calendarScale: 1 }) // reste en acte I
    flatMap(state, 1, 0)
    const e = spawn(state, 5, 5)
    for (let i = 0; i < 5000; i++) advanceTemperature(state)
    expect(e.temperature).toBeGreaterThanOrEqual(60)
  })

  it('les monstres sont ignorés (pas de température)', () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85)
    const e = spawn(state, 5, 5)
    state.monsters.push({ entityId: e.id, type: 'zombie' } as never)
    const before = e.temperature
    advanceTemperature(state)
    expect(e.temperature).toBe(before)
  })
})

describe('hypothermie', () => {
  it('aucun dégât au-dessus du seuil, dégât croissant en dessous', () => {
    expect(coldDamagePerTick(60)).toBe(0)
    expect(coldDamagePerTick(20)).toBe(0)
    expect(coldDamagePerTick(10)).toBeGreaterThan(0)
    expect(coldDamagePerTick(0)).toBeGreaterThan(coldDamagePerTick(10))
  })

  it('mourir de froid émet entity_died cause=cold', () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85)
    const e = spawn(state, 5, 5)
    e.temperature = 0
    // hp sous le dégât max d'un tick (HYPOTHERMIA_DAMAGE_MAX ≈ 0.3) pour mourir dès ce tick.
    e.hp = 0.2
    state.events.length = 0
    advanceTemperature(state)
    const died = state.events.find((ev) => ev.type === 'entity_died')
    expect(died).toBeDefined()
    expect((died as { cause?: string }).cause).toBe('cold')
    // L'avatar meurt puis respawn au Feu de son village (R10) : hp remonte à RESPAWN_HP,
    // il ne reste pas figé à 0.
    expect(e.hp).toBe(COMBAT.RESPAWN_HP)
  })

  it('un humain nu sur glacier de nuit atteint l\'hypothermie par la seule dérive, puis perd des PV (critère #3)', () => {
    const state = createSim(1)
    flatMap(state, 15 /* glacier */, 0.85)
    const e = spawn(state, 5, 5)

    let ticks = 0
    const maxTicks = 20000
    while (e.temperature >= 20 && ticks < maxTicks) {
      advanceTemperature(state)
      ticks += 1
    }
    expect(ticks).toBeLessThan(maxTicks) // l'hypothermie doit être atteinte avant la borne

    const hpAtHypothermia = e.hp
    for (let i = 0; i < 50; i++) advanceTemperature(state)
    expect(e.hp).toBeLessThan(hpAtHypothermia)
    expect(e.hp).toBeLessThan(100)
  })

  it('le respawn au Feu dégèle la température (fix #1)', () => {
    const state = createSim(1)
    const e = spawn(state, 5, 5)
    e.temperature = 0
    e.hp = 0.2
    advanceTemperature(state)
    expect(e.temperature).toBe(COMBAT.RESPAWN_TEMPERATURE)
  })
})

describe("tyrannie de l'acte", () => {
  it('même lieu/heure : ambiant strictement décroissant I → II → III', () => {
    const ambientAtDay = (day: number): number => {
      const state = createSim(1, { calendarScale: 1 })
      flatMap(state, 9 /* scree, offset biome 0 */, 0.4)
      state.tick = (day - 1) * TICKS_PER_SEASON_DAY
      return ambientTemperature(state, 5, 5)
    }
    const a1 = ambientAtDay(10) // acte I  (≤ 21)
    const a2 = ambientAtDay(30) // acte II (Grand Froid, 22-42)
    const a3 = ambientAtDay(50) // acte III (Cendre, > 42)
    expect(a2).toBeLessThan(a1)
    expect(a3).toBeLessThan(a2)
  })
})

describe('engourdissement (malus)', () => {
  it("rampe : 0 au confort, 1 à l'hypothermie, linéaire", () => {
    expect(coldEffectRamp(60)).toBe(0)
    expect(coldEffectRamp(20)).toBe(1)
    expect(coldEffectRamp(40)).toBeCloseTo(0.5, 5)
  })
  it("facteurs = 1 au confort, < 1 dès l'engourdissement", () => {
    expect(coldSpeedFactor(70)).toBe(1)
    expect(coldStaminaRegenFactor(70)).toBe(1)
    expect(coldSpeedFactor(20)).toBeLessThan(1)
    expect(coldStaminaRegenFactor(20)).toBeLessThan(1)
  })
})
