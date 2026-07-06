import { describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, MONSTER_DEFS, TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { foundNpcVillage } from './npc'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { grantItems } from './village'

function makeSim(): SimState {
  return createSim(5, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
}

const entity = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

function tick(sim: SimState, inputs: MoveInput[] = []): void {
  step(sim, inputs)
}

/** Attaque et laisse le wind-up se résoudre. */
function strike(sim: SimState, attackerId: number, dx: number, dy: number, targetInputs: MoveInput[] = []): void {
  tick(sim, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }, ...targetInputs])
  for (let t = 0; t < COMBAT.WINDUP_TICKS; t++) tick(sim, targetInputs)
  // Cooldown avant la prochaine attaque.
  for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim, [])
}

describe('l’endurance (A1)', () => {
  it('attaquer coûte, à 0 c’est refusé ; la régén dépend de la faim', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    drainEvents(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    expect(entity(sim, a).stamina).toBeLessThanOrEqual(100 - COMBAT.ATTACK_STAMINA)

    entity(sim, a).stamina = 5
    delete entity(sim, a).windup
    entity(sim, a).cooldownUntil = 0
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    const reasons = drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
    expect(reasons).toContain('à bout de souffle')

    // Régén : repu (>70) vs affamé (0), à l'arrêt.
    const fed = spawnEntity(sim, 20, 20)
    const starved = spawnEntity(sim, 25, 25)
    entity(sim, fed).stamina = 50
    entity(sim, starved).stamina = 50
    entity(sim, starved).hunger = 0
    tick(sim)
    const fedGain = entity(sim, fed).stamina - 50
    const starvedGain = entity(sim, starved).stamina - 50
    expect(fedGain / starvedGain).toBeCloseTo(COMBAT.FED_REGEN_BONUS / COMBAT.STARVED_REGEN_MALUS, 2)
  })

  it('le sprint accélère ×1.5 et draine', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    tick(sim, [{ entityId: a, dx: 1, dy: 0 }])
    const normal = entity(sim, a).x - 10
    const before = entity(sim, a).stamina
    tick(sim, [{ entityId: a, dx: 1, dy: 0, sprint: true }])
    const sprinted = entity(sim, a).x - 10 - normal
    expect(sprinted / normal).toBeCloseTo(COMBAT.SPRINT_FACTOR, 2)
    expect(entity(sim, a).stamina).toBeLessThan(before)
  })
})

describe('le télégraphe (A2)', () => {
  it('le coup ne porte qu’à la fin du wind-up ; sortir de l’arc esquive', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    // Coup qui touche : b immobile.
    strike(sim, a, 1, 0)
    expect(entity(sim, b).hp).toBeCloseTo(100 - COMBAT.UNARMED_DAMAGE, 1)

    // b s'écarte PENDANT le wind-up : le coup fend l'air.
    entity(sim, b).hp = 100
    entity(sim, b).x = 11
    entity(sim, b).y = 10
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < COMBAT.WINDUP_TICKS; t++) {
      tick(sim, [{ entityId: b, dx: 0, dy: 1, sprint: true }]) // fuit vers le sud
    }
    expect(entity(sim, b).hp).toBe(100)
    // Et l'attaquant était immobile pendant son wind-up.
    expect(entity(sim, a).x).toBe(10)
  })
})

describe('le blocage directionnel (A3)', () => {
  it('de face −70 %, de dos plein pot, et ça coûte de l’endurance', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11.2, 10)
    // b bloque face à a (facing ouest).
    entity(sim, b).facing = { x: -1, y: 0 }
    const staminaBefore = entity(sim, b).stamina
    strike(sim, a, 1, 0, [{ entityId: b, dx: 0, dy: 0, block: true }])
    const blocked = 100 - entity(sim, b).hp
    expect(blocked).toBeCloseTo(COMBAT.UNARMED_DAMAGE * (1 - COMBAT.BLOCK_REDUCTION), 1)
    expect(entity(sim, b).stamina).toBeLessThan(staminaBefore)

    // Même coup dans le dos (b regarde à l'est, a frappe depuis l'ouest).
    entity(sim, b).hp = 100
    strike(sim, a, 1, 0, [{ entityId: b, dx: 0, dy: 0, block: true }])
    // (le facing de b a été écrasé ? non : b ne bouge pas, on le force)
    entity(sim, b).hp = 100
    entity(sim, b).facing = { x: 1, y: 0 }
    strike(sim, a, 1, 0, [{ entityId: b, dx: 0, dy: 0, block: true }])
    expect(100 - entity(sim, b).hp).toBeCloseTo(COMBAT.UNARMED_DAMAGE, 1)
  })
})

describe('les blessures (A4)', () => {
  it('les paliers blessent, la jambe ralentit, le saignement se bande — sur un allié aussi', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    grantItems(sim, a, { spear: 1, fiber: 9 })
    drainEvents(sim)

    // Lance ×16 : 100 → 84 → 68 → 52 (palier 66) → 36 → 20 (palier 33).
    for (let i = 0; i < 5; i++) strike(sim, a, 1, 0)
    const wounds = entity(sim, b).wounds
    expect(Object.keys(wounds).length).toBeGreaterThanOrEqual(1)
    const woundEvents = drainEvents(sim).filter((e) => e.type === 'wound_inflicted')
    expect(woundEvents.length).toBe(2) // les deux paliers franchis

    // Effets mesurables : on force les trois blessures pour tester chacune.
    entity(sim, b).wounds = { leg: true, bleeding: true }
    const x0 = entity(sim, b).x
    tick(sim, [{ entityId: b, dx: 1, dy: 0 }])
    const legStep = entity(sim, b).x - x0
    const hpBefore = entity(sim, b).hp
    tick(sim)
    expect(entity(sim, b).hp).toBeLessThan(hpBefore) // ça saigne

    // a bande son allié : le saignement d'abord, puis la jambe.
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'bandage', targetEntityId: b } }])
    expect(entity(sim, b).wounds.bleeding).toBeUndefined()
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'bandage', targetEntityId: b } }])
    expect(entity(sim, b).wounds.leg).toBeUndefined()
    const x1 = entity(sim, b).x
    tick(sim, [{ entityId: b, dx: 1, dy: 0 }])
    expect(legStep / (entity(sim, b).x - x1)).toBeCloseTo(COMBAT.LEG_WOUND_SPEED, 2)
  })
})

describe('la mort (A5)', () => {
  it('cadavre lootable, respawn au Feu épuisé, compétences intactes', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantItems(sim, a, { wood: 10, spear: 1 })
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    const victim = entity(sim, a)
    victim.skills.woodcutting = 500
    victim.x = 20
    victim.y = 20
    victim.inventory = { berries: 7 }
    victim.hp = 1
    drainEvents(sim)

    const killer = spawnEntity(sim, 21, 20)
    strike(sim, killer, -1, 0)

    // Respawn au Feu (10,10), épuisé, compétences gardées, mains vides.
    expect(victim.x).toBeCloseTo(10.5, 5)
    expect(victim.hp).toBe(COMBAT.RESPAWN_HP)
    expect(victim.exhaustedUntil).toBeGreaterThan(sim.tick)
    expect(victim.skills.woodcutting).toBe(500)
    expect(countOf(victim.inventory, 'berries')).toBe(0)

    // Le cadavre est là, lootable par n'importe qui.
    expect(sim.corpses).toHaveLength(1)
    const corpse = sim.corpses[0]!
    expect(countOf(corpse.inventory, 'berries')).toBe(7)
    tick(sim, [{ entityId: killer, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(countOf(entity(sim, killer).inventory, 'berries')).toBe(7)
    expect(sim.corpses).toHaveLength(0)
  })
})

describe('les monstres (A6)', () => {
  it('le zombie aggro, télégraphe, frappe — et meurt à la lance', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantItems(sim, a, { spear: 1 })
    const z = spawnMonster(sim, 'zombie', 14, 10)
    drainEvents(sim)

    // Il approche et frappe : le joueur immobile finit par prendre des dégâts.
    for (let t = 0; t < 400 * (BALANCE.TICK_RATE_HZ / 12) && entity(sim, a).hp === 100; t++) tick(sim)
    expect(entity(sim, a).hp).toBeLessThan(100)

    // On le tue : 3 coups de lance (40 PV / 16).
    const zombie = entity(sim, z)
    for (let i = 0; i < 4 && sim.entities.some((e) => e.id === z); i++) {
      strike(sim, a, zombie.x - entity(sim, a).x, zombie.y - entity(sim, a).y)
    }
    expect(sim.entities.some((e) => e.id === z)).toBe(false)
    expect(drainEvents(sim).some((e) => e.type === 'monster_slain' && e.monsterType === 'zombie')).toBe(true)
  })

  it('une attaque refusée (à bout de souffle) ne consomme pas le cooldown', () => {
    const sim = makeSim()
    spawnEntity(sim, 10.5, 10.5) // la proie, adjacente
    const z = spawnMonster(sim, 'zombie', 11.5, 10.5)
    const zombie = entity(sim, z)
    zombie.stamina = 0 // startAttack refusera (ATTACK_STAMINA)
    tick(sim)
    // Le coup n'est pas parti : pas de wind-up — et le cooldown ne doit pas
    // être posé pour un coup qui n'a jamais eu lieu.
    expect(zombie.windup).toBeUndefined()
    expect(zombie.cooldownUntil).toBe(0)
  })

  it('le sanglier fuit quand on le frappe, et sa viande se cuit', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantItems(sim, a, { spear: 1, wood: 10 })
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    const b = spawnMonster(sim, 'boar', 11.2, 10)

    strike(sim, a, 1, 0)
    const boar = entity(sim, b)
    expect(boar.hp).toBeLessThan(MONSTER_DEFS.boar.hp)
    const distBefore = Math.abs(boar.x - entity(sim, a).x)
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    // Il a réagi : fui (distance accrue) ou chargé — dans les deux cas il a bougé.
    expect(Math.abs(boar.x - entity(sim, a).x)).not.toBeCloseTo(distBefore, 1)

    // L'achever, looter, cuire, manger.
    while (sim.entities.some((e) => e.id === b)) {
      const target = entity(sim, b)
      entity(sim, a).x = target.x - 1
      entity(sim, a).y = target.y
      entity(sim, a).stamina = 100
      strike(sim, a, 1, 0)
    }
    const corpse = sim.corpses[0]!
    entity(sim, a).x = corpse.x
    entity(sim, a).y = corpse.y
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(countOf(entity(sim, a).inventory, 'raw_meat')).toBe(3)
    entity(sim, a).x = 10.5
    entity(sim, a).y = 10.5
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) tick(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'craft', recipeId: 'cooked_meat' } }])
    expect(countOf(entity(sim, a).inventory, 'cooked_meat')).toBe(1)
  })
})

describe('la milice (A7)', () => {
  it('trois zombies marchent sur le village : la milice tient, personne ne meurt', { timeout: 30_000 }, () => {
    const sim = createSim(9, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
    foundNpcVillage(sim, 20, 20, 4)
    spawnMonster(sim, 'zombie', 27, 20)
    spawnMonster(sim, 'zombie', 20, 27)
    spawnMonster(sim, 'zombie', 14, 15)

    for (let t = 0; t < 300 * BALANCE.TICK_RATE_HZ && sim.monsters.length > 0; t++) tick(sim) // ~5 min de marge
    expect(sim.monsters).toHaveLength(0) // tous abattus
    expect(sim.npcs).toHaveLength(4) // aucun mort
  })
})

describe('le déterminisme (A8)', () => {
  it('replay exact avec combat, blessures et monstres', () => {
    const options = { map: createEmptyMap(40, 40, TERRAIN_GRASS) }
    const setup = (state: SimState) => {
      spawnEntity(state, 10, 10)
      grantItems(state, 1, { spear: 1, fiber: 6 })
      spawnMonster(state, 'zombie', 14, 10)
      spawnMonster(state, 'boar', 8, 12)
    }
    const live = createSim(33, options)
    const log = createReplayLog(33, options)
    setup(live)
    for (let t = 0; t < 2000; t++) {
      const action =
        t % 40 === 0 ? ({ type: 'attack', dx: 1, dy: 0.2 } as const) : t % 97 === 0 ? ({ type: 'bandage' } as const) : undefined
      recordAndStep(live, log, [
        {
          entityId: 1,
          dx: t % 3 === 0 ? 1 : -1,
          dy: t % 5 === 0 ? 1 : 0,
          sprint: t % 7 === 0,
          block: t % 11 === 0,
          ...(action ? { action } : {}),
        },
      ])
    }
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})
