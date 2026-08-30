/**
 * ═══ A1-A4 — LA TRACTION (spec `traction.md`) ═══
 *
 * Le banc est une plaine nue (la traction est une loi de corde, pas de géographie) ; la
 * charge est un cadavre fabriqué par une VRAIE mort (`die` — jamais un cadavre posé à la
 * main : le banc ne fabrique pas sa prémisse).
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { die } from './combat'
import { drainEvents } from './events'
import { gaitNoise } from './faune'
import { HUNT } from './balance'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { TRACTABLES, TRACTION } from './traction'

function banc(): { sim: SimState; id: number; corpseId: number } {
  const sim = createSim(2026, { map: createEmptyMap(80, 40, TERRAIN_GRASS), faunaCap: 0, worldEvents: false, meteoActive: false })
  const id = spawnEntity(sim, 20.5, 20.5)
  // LA CHARGE : un Cendreux abattu à côté — il laisse TOUJOURS un cadavre (R31a).
  const cid = spawnMonster(sim, 'cendreux', 21.5, 20.5)
  die(sim, sim.entities.find((e) => e.id === cid)!, id)
  drainEvents(sim)
  return { sim, id, corpseId: sim.corpses[sim.corpses.length - 1]!.id }
}

const corpse = (sim: SimState, id: number) => sim.corpses.find((c) => c.id === id)!
const atteler = (b: { sim: SimState; id: number; corpseId: number }) =>
  step(b.sim, [{ entityId: b.id, dx: 0, dy: 0, action: { type: 'atteler', kind: 'corpse', id: b.corpseId } }])
const marcher = (b: { sim: SimState; id: number }, dx: -1 | 0 | 1, n: number, sprint = false) => {
  for (let i = 0; i < n; i++) step(b.sim, [{ entityId: b.id, dx, dy: 0, sprint }])
}

describe('A1 — la longe tire, au pas', () => {
  it('attelée, la charge suit à la longe ; immobile, elle ne bouge pas d’un pixel', () => {
    const b = banc()
    atteler(b)
    expect(b.sim.entities.find((e) => e.id === b.id)!.attelage).toEqual({ kind: 'corpse', id: b.corpseId })
    const avant = { x: corpse(b.sim, b.corpseId).x, y: corpse(b.sim, b.corpseId).y }
    // Immobile : rien ne bouge (la longe n'est pas tendue).
    step(b.sim, [{ entityId: b.id, dx: 0, dy: 0 }])
    expect(corpse(b.sim, b.corpseId).x).toBe(avant.x)
    // Dix tuiles de marche : la charge est à ≤ LONGE + un pas du tireur.
    marcher(b, 1, 120)
    const e = b.sim.entities.find((q) => q.id === b.id)!
    const c = corpse(b.sim, b.corpseId)
    const d = Math.sqrt((e.x - c.x) * (e.x - c.x) + (e.y - c.y) * (e.y - c.y))
    expect(e.x - 20.5, 'le tireur a vraiment marché').toBeGreaterThan(5)
    expect(d).toBeLessThanOrEqual(TRACTION.LONGE + BALANCE.WALK_SPEED_TILES_PER_S / BALANCE.TICK_RATE_HZ + 0.01)
  })

  it('le prix : la marche attelée est plus lente du FACTEUR, et le sprint n’accélère rien', () => {
    const distance = (sprint: boolean, attele: boolean): number => {
      const b = banc()
      if (attele) atteler(b)
      const x0 = b.sim.entities.find((e) => e.id === b.id)!.x
      marcher(b, 1, 40, sprint)
      return b.sim.entities.find((e) => e.id === b.id)!.x - x0
    }
    const libre = distance(false, false)
    const attele = distance(false, true)
    expect(attele / libre).toBeCloseTo(TRACTABLES.corpse.facteur, 1)
    // LE SPRINT ATTELÉ = LA MARCHE ATTELÉE, au bit près.
    expect(distance(true, true)).toBe(attele)
  })
})

describe('A2 — la rupture casse, jamais ne téléporte', () => {
  it('un téléport du tireur : attelage_rompu, la charge n’a pas bougé, on re-attelle', () => {
    const b = banc()
    atteler(b)
    const avant = { x: corpse(b.sim, b.corpseId).x, y: corpse(b.sim, b.corpseId).y }
    const e = b.sim.entities.find((q) => q.id === b.id)!
    e.x += 10 // le téléport (la forme du debug_teleport, sans le debug)
    step(b.sim, [{ entityId: b.id, dx: 0, dy: 0 }])
    expect(drainEvents(b.sim).some((ev) => ev.type === 'attelage_rompu'), 'la corde a claqué').toBe(true)
    expect(e.attelage).toBeUndefined()
    expect(corpse(b.sim, b.corpseId).x, 'la charge est restée').toBe(avant.x)
    // Revenir et renouer : la rupture n'est pas une malédiction.
    e.x -= 10
    atteler(b)
    expect(e.attelage).toBeDefined()
  })
})

describe('A3 — une charge, un tireur, des mains libres', () => {
  it('le second tireur est refusé « déjà attelée » ; hors de portée, « trop loin »', () => {
    const b = banc()
    atteler(b)
    const id2 = spawnEntity(b.sim, 22.5, 20.5)
    drainEvents(b.sim)
    step(b.sim, [{ entityId: id2, dx: 0, dy: 0, action: { type: 'atteler', kind: 'corpse', id: b.corpseId } }])
    const rejets = drainEvents(b.sim).filter((ev) => ev.type === 'action_rejected')
    expect((rejets[0] as { reason?: string })?.reason).toBe('déjà attelée')
    const loin = spawnEntity(b.sim, 30.5, 20.5)
    step(b.sim, [{ entityId: loin, dx: 0, dy: 0, action: { type: 'atteler', kind: 'corpse', id: b.corpseId } }])
    expect(drainEvents(b.sim).some((ev) => ev.type === 'action_rejected' && (ev as { reason?: string }).reason === 'trop loin')).toBe(true)
  })

  it('un coup porté détache — les mains ne font qu’une chose', () => {
    const b = banc()
    atteler(b)
    step(b.sim, [{ entityId: b.id, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    expect(b.sim.entities.find((e) => e.id === b.id)!.attelage).toBeUndefined()
  })
})

describe('A4 — le prix s’entend', () => {
  it('attelé, le pas ne descend jamais sous le bruit de la marche — même accroupi', () => {
    const b = banc()
    atteler(b)
    const e = b.sim.entities.find((q) => q.id === b.id)!
    e.gait = 'sneak'
    expect(gaitNoise(e)).toBeGreaterThanOrEqual(HUNT.NOISE_WALK)
    // LE TÉMOIN : détaché, l'accroupi retrouve son silence — la prémisse de l'exemption.
    delete e.attelage
    expect(gaitNoise(e)).toBe(HUNT.NOISE_SNEAK)
  })
})
