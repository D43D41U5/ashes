import { describe, expect, it } from 'vitest'
import { COOK_SLOT, FIRE, TERRAIN_GRASS } from './balance'
import { addItems, countOf, inventoryOf, makeInventory } from './items'
import { willRiseAsCendreux } from './cendreux'
import { drainEvents } from './events'
import { advanceFire, fireState } from './fire'
import { createEmptyMap } from './map'
import { advanceMonsters, spawnMonster } from './monsters'
import { createSim, spawnEntity, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE } from './time'
import { fireBubble } from './temperature'
import { addStructure, applyStructureDamage, applyVillageAction, grantItems, type Structure } from './village'

/**
 * LE FEU COMME STATION (spec `docs/specs/feu-station.md`) — l'état du feu LIBRE
 * (allumé/braises/éteint), sa combustion (3 SLOTS de bois, brûlés une bûche à la fois), la cuisson
 * (3 ENTRÉES → 3 SORTIES), et le fait que ses bénéfices SUIVENT son état. Rapide, déterministe,
 * seed + inputs → état. La combustion se déclenche à `tick >= burnAt + BURN_TICKS` ; pour l'éprouver
 * sans avancer le tick, on place `burnAt` dans le PASSÉ (bûche déjà à échéance).
 */
function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
}
const ent = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!
/** Met N bûches dans les slots combustible du feu. */
function wood(fire: Structure, n: number): void {
  fire.fuel = makeInventory(FIRE.FUEL_SLOTS)
  if (n > 0) addItems(fire.fuel, { wood: n })
}
/** Rend le feu ÉTEINT/en braises : plus de bûche, fenêtre de braises ouverte. */
function douse(sim: SimState, fire: Structure, emberFor = 100): void {
  fire.fuel = makeInventory(FIRE.FUEL_SLOTS)
  delete fire.burnAt
  fire.emberUntil = sim.tick + emberFor
}

describe('Le Feu-station : combustible & état (spec feu-station, A1)', () => {
  it('A1 — le feu libre naît avec du bois, brûle une bûche, passe en braises, s’éteint ; nourrir rallume', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, owner) // FEU LIBRE (villageId 0), à portée
    expect(countOf(fire.fuel!, 'wood')).toBe(FIRE.FUEL_START_WOOD)
    expect(fireState(sim, fire)).toBe('lit')

    // Une seule bûche, à échéance : un tick de combustion la consomme → braises.
    wood(fire, 1)
    fire.burnAt = sim.tick - FIRE.BURN_TICKS
    drainEvents(sim)
    advanceFire(sim)
    expect(countOf(fire.fuel!, 'wood')).toBe(0)
    expect(fireState(sim, fire)).toBe('ember') // les flammes meurent → braises
    expect(drainEvents(sim).filter((e) => e.type === 'fire_extinguished').length).toBe(1)

    // La fenêtre de braises passée → éteint.
    sim.tick = fire.emberUntil!
    expect(fireState(sim, fire)).toBe('out')

    // Nourrir (quick-feed, feu libre) rallume et referme la fenêtre.
    grantItems(sim, owner, { wood: 3 })
    drainEvents(sim)
    applyVillageAction(sim, owner, { type: 'feed_fire' })
    expect(countOf(fire.fuel!, 'wood')).toBe(3)
    expect(fireState(sim, fire)).toBe('lit')
    expect(fire.emberUntil).toBeUndefined()
    expect(drainEvents(sim).some((e) => e.type === 'fire_relit')).toBe(true)
  })

  it('A1 — l’extinction n’émet fire_extinguished qu’UNE fois, jamais en boucle', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    wood(fire, 1)
    fire.burnAt = sim.tick - FIRE.BURN_TICKS // s'éteint dès le 1er tick de combustion
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

    douse(sim, fire)
    const ember = fireBubble(sim, 10, 10)
    expect(ember).toBeGreaterThan(0)
    expect(ember).toBeLessThan(lit) // braises = chaleur atténuée (S3)

    sim.tick = fire.emberUntil!
    expect(fireBubble(sim, 10, 10)).toBe(0) // éteint = aucune chaleur
  })

  it('A3 — le rempart anti-levée garde en allumé ET en braises, tombe à l’extinction', () => {
    const sim = makeSim()
    const victim = spawnEntity(sim, 10, 11)
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0) // allumé, à portée de garde
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(false) // veillé par le feu

    douse(sim, fire)
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(false) // les braises gardent encore

    sim.tick = fire.emberUntil!
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(true) // éteint : plus de rempart
  })
})

describe('Le Feu-station : la cuisson 3 entrées → 3 sorties, passive (spec feu-station, A5/A6/A7)', () => {
  const COOK = COOK_SLOT.fire!.raw_meat!.ticks

  it('A5 — la cuisson est PASSIVE : elle avance joueur PARTI, le cuit part en SORTIE, il le reprend', () => {
    const sim = makeSim()
    const cook = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, cook) // allumé (du bois), à portée
    grantItems(sim, cook, { raw_meat: 1 })
    applyVillageAction(sim, cook, { type: 'cook_put', structureId: fire.id, item: 'raw_meat' })
    expect(fire.cookIn?.[0]?.item).toBe('raw_meat') // dans la 1re entrée libre
    expect(countOf(ent(sim, cook).inventory, 'raw_meat')).toBe(0) // sortie du sac

    // Le joueur s'en va LOIN (au-delà d'INTERACT_RANGE) : la cuisson continue quand même.
    ent(sim, cook).x = 60
    ent(sim, cook).y = 60
    drainEvents(sim)
    for (let t = 0; t < COOK; t++) advanceFire(sim)
    expect(fire.cookIn?.[0]).toBeNull() // l'entrée s'est vidée
    expect(countOf(fire.cookOut!, 'cooked_meat')).toBe(1) // le cuit est en SORTIE
    expect(drainEvents(sim).some((e) => e.type === 'meat_cooked')).toBe(true)

    // Il revient et reprend la SORTIE.
    ent(sim, cook).x = 10
    ent(sim, cook).y = 10
    applyVillageAction(sim, cook, { type: 'cook_take_out', structureId: fire.id, slot: 0 })
    expect(fire.cookOut?.[0]).toBeNull()
    expect(countOf(ent(sim, cook).inventory, 'cooked_meat')).toBe(1)
  })

  it('A6 — pas de brûlé : la viande cuite reste au chaud INDÉFINIMENT en sortie', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    fire.cookOut = inventoryOf(FIRE.COOK_OUTPUTS, { cooked_meat: 1 }) // déjà cuite, en sortie
    for (let t = 0; t < 3000; t++) advanceFire(sim)
    expect(countOf(fire.cookOut!, 'cooked_meat')).toBe(1) // ne se dégrade jamais
  })

  it('A7 — la cuisson exige la FLAMME : ni éteint ni braises ne cuisent ; rallumé, ça reprend', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    fire.cookIn = [{ item: 'raw_meat', remainingTicks: 10 }, null, null]
    const start = fire.cookIn[0]!.remainingTicks

    // ÉTEINT : aucune progression.
    douse(sim, fire, 5)
    sim.tick = fire.emberUntil! // → 'out'
    advanceFire(sim)
    advanceFire(sim)
    expect(fire.cookIn![0]!.remainingTicks).toBe(start)

    // BRAISES : toujours aucune (S8 exige la flamme).
    fire.emberUntil = sim.tick + 100 // pas de bois, tick < emberUntil → 'ember'
    advanceFire(sim)
    expect(fire.cookIn![0]!.remainingTicks).toBe(start)

    // RALLUMÉ : ça reprend.
    wood(fire, FIRE.FUEL_START_WOOD)
    fire.burnAt = sim.tick
    delete fire.emberUntil
    advanceFire(sim)
    expect(fire.cookIn![0]!.remainingTicks).toBe(start - 1)
  })

  it('les 3 ENTRÉES cuisent EN PARALLÈLE ; une 4e est refusée (entrées pleines)', () => {
    const sim = makeSim()
    const cook = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, cook)
    grantItems(sim, cook, { raw_meat: 5 })
    for (let i = 0; i < 4; i++) applyVillageAction(sim, cook, { type: 'cook_put', structureId: fire.id, item: 'raw_meat' })
    expect(fire.cookIn!.filter(Boolean).length).toBe(3) // 3 posées, la 4e refusée
    expect(countOf(ent(sim, cook).inventory, 'raw_meat')).toBe(2) // 3 sorties du sac, 2 restent
  })
})

describe('Le Feu-station : le feu ATTIRE les Cendreux quand il fait froid (spec feu-station, A4)', () => {
  const nightSim = (): SimState => createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE, map: createEmptyMap(96, 96, TERRAIN_GRASS) })

  it('A4 — la NUIT (froid), un Cendreux chemine vers un feu ALLUMÉ à portée', () => {
    const sim = nightSim()
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    addStructure(sim, 'fire', 15, 5, 0, 0) // feu libre avec bois (allumé), dans WARMTH_SEEK_RANGE (20)
    advanceMonsters(sim)
    expect(monster.path?.length ?? 0).toBeGreaterThan(0) // il rampe vers le phare
  })

  it('A4 — un feu ÉTEINT n’est PAS un phare : il n’attire pas', () => {
    const sim = nightSim()
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    const fire = addStructure(sim, 'fire', 15, 5, 0, 0)
    douse(sim, fire, 0) // pas de bois, emberUntil = tick → 'out'
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

describe('Le Feu-station : nourrir un feu CIBLÉ par le modal (spec feu-station, S15)', () => {
  it('feed_fire { structureId } alimente CE feu libre et le rallume depuis les braises', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, owner)
    douse(sim, fire) // en braises
    grantItems(sim, owner, { wood: 5 })
    drainEvents(sim)
    applyVillageAction(sim, owner, { type: 'feed_fire', structureId: fire.id })
    expect(countOf(fire.fuel!, 'wood')).toBe(5) // CE feu, celui du modal, est nourri
    expect(fire.emberUntil).toBeUndefined() // rallumé
    expect(drainEvents(sim).some((e) => e.type === 'fire_relit' && e.structureId === fire.id)).toBe(true)
  })

  it('feed_fire { structureId } vise le BON feu même quand un autre est plus proche', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10.5, 10.5)
    const proche = addStructure(sim, 'fire', 10, 10, 0, owner) // le plus proche (distSq 0)
    const cible = addStructure(sim, 'fire', 11, 10, 0, owner) // celui qu'on a ouvert (à portée)
    wood(proche, 5)
    wood(cible, 5)
    grantItems(sim, owner, { wood: 5 })
    applyVillageAction(sim, owner, { type: 'feed_fire', structureId: cible.id })
    expect(countOf(cible.fuel!, 'wood')).toBeGreaterThan(5) // c'est LA CIBLE qui monte
    expect(countOf(proche.fuel!, 'wood')).toBe(5) // pas le plus proche
  })
})

describe('Le Feu-station : destructibilité découplée du combustible (spec feu-station, A11)', () => {
  it('A11 — un feu LIBRE allumé reste destructible (pas d’invulnérabilité liée au combustible)', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    expect(countOf(fire.fuel!, 'wood')).toBeGreaterThan(0)
    applyStructureDamage(sim, fire.id, 99999, 0)
    expect(sim.structures.some((s) => s.id === fire.id)).toBe(false) // il tombe malgré le combustible
  })
})
