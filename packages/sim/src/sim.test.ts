import { describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, TICK_DT_S } from './balance'
import { createSim, snapshot, spawnEntity, speedScaleFor, step, type MoveInput } from './sim'

describe('sim', () => {
  it('déplace une entité selon la vitesse de BALANCE', () => {
    const sim = createSim(1)
    const id = spawnEntity(sim, 5, 5)
    step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    expect(sim.entities[0]?.x).toBeCloseTo(5 + BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S)
    expect(sim.entities[0]?.y).toBe(5)
    expect(sim.tick).toBe(1)
  })

  it('normalise le déplacement diagonal', () => {
    const sim = createSim(1)
    const id = spawnEntity(sim, 5, 5)
    step(sim, [{ entityId: id, dx: 1, dy: 1 }])
    const { x, y } = sim.entities[0]!
    const dx = x - 5
    const dy = y - 5
    const distance = Math.sqrt(dx * dx + dy * dy)
    expect(distance).toBeCloseTo(BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S)
  })

  it('moved retombe à false dès qu’une entité ne bouge plus', () => {
    const sim = createSim(1)
    const id = spawnEntity(sim, 5, 5)
    step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    expect(sim.entities[0]!.moved).toBe(true)
    // Plus d'input du tout (joueur silencieux) : moved ne doit pas rester
    // figé sur sa dernière valeur — la régén d'endurance en dépend.
    step(sim, [])
    expect(sim.entities[0]!.moved).toBe(false)
  })

  it('ignore les inputs visant une entité inconnue', () => {
    const sim = createSim(1)
    expect(() => step(sim, [{ entityId: 999, dx: 1, dy: 0 }])).not.toThrow()
    expect(sim.tick).toBe(1)
  })

  it('speedScaleFor est LA formule de vitesse : endurance à 0 annule sprint ET blocage', () => {
    // Sac VIDE : le portage ne pèse pas sur ce test-là (il a le sien, plus bas).
    const base = { hunger: 100, wounds: {}, stamina: 100, temperature: 100, inventory: [] }
    const moving = { sprint: true, block: false, moving: true }
    expect(speedScaleFor(base, moving).scale).toBe(COMBAT.SPRINT_FACTOR)
    expect(speedScaleFor({ ...base, stamina: 0 }, moving).scale).toBe(1)
    expect(speedScaleFor(base, { sprint: false, block: true, moving: true }).scale).toBe(COMBAT.BLOCK_MOVE_FACTOR)
    expect(speedScaleFor({ ...base, stamina: 0 }, { sprint: false, block: true, moving: true }).scale).toBe(1)
    expect(
      speedScaleFor(
        { hunger: 0, wounds: { leg: true }, stamina: 100, temperature: 100, inventory: [] },
        { sprint: false, block: false, moving: false },
      ).scale,
    ).toBe(BALANCE.HUNGER_SPEED_MALUS * COMBAT.LEG_WOUND_SPEED)
  })

  it('step applique la même formule : sprinter essoufflé = vitesse de marche', () => {
    const sim = createSim(1)
    const id = spawnEntity(sim, 5, 5)
    sim.entities[0]!.stamina = 0
    step(sim, [{ entityId: id, dx: 1, dy: 0, sprint: true }])
    // Pas ×1.5 : l'endurance à 0 annule le sprint (le client prédit pareil).
    expect(sim.entities[0]!.x).toBeCloseTo(5 + BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S)
  })

  it('CONTRAT : même seed + mêmes inputs = même état, au bit près', () => {
    const run = () => {
      const sim = createSim(1234)
      const a = spawnEntity(sim, 5, 5)
      const b = spawnEntity(sim, 10, 10)
      for (let t = 0; t < 500; t++) {
        const inputs: MoveInput[] = [
          { entityId: a, dx: t % 3 === 0 ? 1 : 0, dy: t % 2 === 0 ? -1 : 1 },
          { entityId: b, dx: -1, dy: 0 },
        ]
        step(sim, inputs)
      }
      return snapshot(sim)
    }
    expect(run()).toBe(run())
  })
})
