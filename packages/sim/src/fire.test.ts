import { describe, expect, it } from 'vitest'
import { COOK_SLOT, FIRE, TERRAIN_GRASS } from './balance'
import { countOf } from './items'
import { willRiseAsCendreux } from './cendreux'
import { drainEvents } from './events'
import { advanceFire, fireState } from './fire'
import { createEmptyMap } from './map'
import { advanceMonsters, spawnMonster } from './monsters'
import { createSim, spawnEntity, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE } from './time'
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

describe('Le Feu-station : la cuisson au slot, passive (spec feu-station, A5/A6/A7)', () => {
  const COOK = COOK_SLOT.fire!.raw_meat!.ticks

  it('A5 — la cuisson est PASSIVE : elle avance même joueur PARTI, puis il reprend la viande grillée', () => {
    const sim = makeSim()
    const cook = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, cook) // allumé (plein), à portée
    grantItems(sim, cook, { raw_meat: 1 })
    applyVillageAction(sim, cook, { type: 'cook_put', structureId: fire.id, item: 'raw_meat' })
    expect(fire.cook?.item).toBe('raw_meat')
    expect(countOf(ent(sim, cook).inventory, 'raw_meat')).toBe(0) // sortie du sac

    // Le joueur s'en va LOIN (au-delà d'INTERACT_RANGE) : la cuisson continue quand même.
    ent(sim, cook).x = 60
    ent(sim, cook).y = 60
    drainEvents(sim)
    for (let t = 0; t < COOK; t++) advanceFire(sim)
    expect(fire.cook?.item).toBe('cooked_meat') // cuit SANS le joueur (travail de la station)
    expect(drainEvents(sim).some((e) => e.type === 'meat_cooked')).toBe(true)

    // Il revient et reprend.
    ent(sim, cook).x = 10
    ent(sim, cook).y = 10
    applyVillageAction(sim, cook, { type: 'cook_take', structureId: fire.id })
    expect(fire.cook).toBeUndefined()
    expect(countOf(ent(sim, cook).inventory, 'cooked_meat')).toBe(1)
  })

  it('A6 — pas de brûlé : la viande cuite reste au chaud INDÉFINIMENT dans le slot', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    fire.cook = { item: 'cooked_meat', remainingTicks: 0 } // déjà cuite
    for (let t = 0; t < 3000; t++) advanceFire(sim)
    expect(fire.cook?.item).toBe('cooked_meat') // ne se dégrade jamais
  })

  it('A7 — la cuisson exige la FLAMME : ni éteint ni braises ne cuisent ; rallumé, ça reprend', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    fire.cook = { item: 'raw_meat', remainingTicks: 10 }
    const start = fire.cook.remainingTicks

    // ÉTEINT : aucune progression.
    fire.fuel = 0
    fire.emberUntil = sim.tick + 5
    sim.tick = fire.emberUntil // → 'out'
    advanceFire(sim)
    advanceFire(sim)
    expect(fire.cook!.remainingTicks).toBe(start)

    // BRAISES : toujours aucune (S8 exige la flamme).
    fire.emberUntil = sim.tick + 100 // fuel toujours 0, tick < emberUntil → 'ember'
    advanceFire(sim)
    expect(fire.cook!.remainingTicks).toBe(start)

    // RALLUMÉ : ça reprend.
    fire.fuel = FIRE.FUEL_START
    delete fire.emberUntil
    advanceFire(sim)
    expect(fire.cook!.remainingTicks).toBe(start - 1)
  })
})

describe('Le Feu-station : le feu ATTIRE les Cendreux quand il fait froid (spec feu-station, A4)', () => {
  const nightSim = (): SimState => createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE, map: createEmptyMap(96, 96, TERRAIN_GRASS) })

  it('A4 — la NUIT (froid), un Cendreux chemine vers un feu ALLUMÉ à portée', () => {
    const sim = nightSim()
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    addStructure(sim, 'fire', 15, 5, 0, 0) // feu libre PLEIN (allumé), dans WARMTH_SEEK_RANGE (20)
    advanceMonsters(sim)
    expect(monster.path?.length ?? 0).toBeGreaterThan(0) // il rampe vers le phare
  })

  it('A4 — un feu ÉTEINT n’est PAS un phare : il n’attire pas', () => {
    const sim = nightSim()
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    const fire = addStructure(sim, 'fire', 15, 5, 0, 0)
    fire.fuel = 0
    fire.emberUntil = sim.tick // tick >= emberUntil → 'out'
    advanceMonsters(sim)
    expect(monster.path?.length ?? 0).toBe(0)
  })

  it('A4 — de JOUR en zone TEMPÉRÉE (pas froid), aucun appel vers le feu', () => {
    const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) }) // jour, herbe, acte I → base 90
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    addStructure(sim, 'fire', 15, 5, 0, 0) // allumé, mais il fait chaud → pas de phare
    advanceMonsters(sim)
    expect(monster.path?.length ?? 0).toBe(0)
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
