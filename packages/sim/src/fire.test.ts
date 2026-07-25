import { describe, expect, it } from 'vitest'
import { FIRE, TERRAIN_GRASS } from './balance'
import { willRiseAsCendreux } from './cendreux'
import { drainEvents } from './events'
import { advanceFire, fireState } from './fire'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, type SimState } from './sim'
import { fireBubble } from './temperature'
import { addStructure, applyStructureDamage, applyVillageAction, grantItems } from './village'

/**
 * LE FEU COMME STATION (spec `docs/specs/feu-station.md`) — l'état du feu LIBRE
 * (allumé/braises/éteint), sa combustion, et le fait que ses bénéfices SUIVENT son
 * état (chaleur, garde anti-levée, destructibilité). On teste `advanceFire`, `fireState`
 * et les consommateurs en isolation : rapide, déterministe, seed + inputs → état.
 */
function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
}
const ent = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

describe('Le Feu-station : combustible & état (spec feu-station, A1)', () => {
  it('A1 — le feu libre naît PLEIN, brûle, passe en braises, s’éteint ; nourrir le rallume', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, owner) // FEU LIBRE (villageId 0), à portée d'interaction
    expect(fire.fuel).toBe(FIRE.FUEL_START)
    expect(fireState(sim, fire)).toBe('lit')

    // À un souffle du sec, puis on brûle : deux ticks vident la réserve.
    fire.fuel = FIRE.DRAIN_PER_TICK * 1.5
    drainEvents(sim)
    advanceFire(sim)
    advanceFire(sim)
    expect(fire.fuel).toBe(0)
    expect(fireState(sim, fire)).toBe('ember') // les flammes meurent → braises
    expect(drainEvents(sim).filter((e) => e.type === 'fire_extinguished').length).toBe(1)

    // La fenêtre de braises passée → éteint.
    sim.tick = fire.emberUntil!
    expect(fireState(sim, fire)).toBe('out')

    // Nourrir (quick-feed, feu libre) rallume et referme la fenêtre.
    grantItems(sim, owner, { wood: 3 })
    drainEvents(sim)
    applyVillageAction(sim, owner, { type: 'feed_fire' })
    expect(fireState(sim, fire)).toBe('lit')
    expect(fire.emberUntil).toBeUndefined()
    expect(drainEvents(sim).some((e) => e.type === 'fire_relit')).toBe(true)
  })

  it('A1 — l’extinction n’émet fire_extinguished qu’UNE fois, jamais en boucle', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    fire.fuel = FIRE.DRAIN_PER_TICK * 0.5 // s'éteint dès le 1er tick
    drainEvents(sim)
    let out = 0
    for (let t = 0; t < 30; t++) {
      advanceFire(sim)
      out += drainEvents(sim).filter((e) => e.type === 'fire_extinguished').length
    }
    expect(out).toBe(1) // une seule bascule — pas de spam tant que le feu reste à sec
    expect(fireState(sim, fire)).toBe('ember')
  })
})

describe('Le Feu-station : les bénéfices suivent l’état (spec feu-station, A2/A3)', () => {
  it('A2 — chaleur pleine allumé, ATTÉNUÉE en braises, NULLE éteint', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    const lit = fireBubble(sim, 10, 10)
    expect(lit).toBeGreaterThan(0)

    fire.fuel = 0
    fire.emberUntil = sim.tick + 100
    const ember = fireBubble(sim, 10, 10)
    expect(ember).toBeGreaterThan(0)
    expect(ember).toBeLessThan(lit) // braises = chaleur atténuée (S3)

    sim.tick = fire.emberUntil
    expect(fireBubble(sim, 10, 10)).toBe(0) // éteint = aucune chaleur
  })

  it('A3 — le rempart anti-levée garde en allumé ET en braises, tombe à l’extinction', () => {
    const sim = makeSim()
    const victim = spawnEntity(sim, 10, 11)
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0) // allumé, à portée de garde
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(false) // veillé par le feu

    fire.fuel = 0
    fire.emberUntil = sim.tick + 100
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(false) // les braises gardent encore

    sim.tick = fire.emberUntil
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(true) // éteint : plus de rempart
  })
})

describe('Le Feu-station : destructibilité découplée du combustible (spec feu-station, A11)', () => {
  it('A11 — un feu LIBRE allumé reste destructible (pas d’invulnérabilité liée au combustible)', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    expect(fire.fuel).toBeGreaterThan(0)
    applyStructureDamage(sim, fire.id, 99999, 0)
    expect(sim.structures.some((s) => s.id === fire.id)).toBe(false) // il tombe malgré le combustible
  })
})
