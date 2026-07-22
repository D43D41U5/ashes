import { describe, expect, it } from 'vitest'
import { FIRE_UPKEEP, STRUCTURE_HP, TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, type SimState } from './sim'
import { addStructure, advanceUpkeep, applyStructureDamage, applyVillageAction, createVillage, grantItems } from './village'

/**
 * L'UPKEEP DU FEU (V1-11, spec construction R16-R17, critère A7) — le seul évier
 * PERMANENT de l'économie de flux. On teste `advanceUpkeep` en isolation (rapide,
 * déterministe) : la combustion, la dégradation À SEC des murs (jamais des composants),
 * les braises dormantes, et le geste qui tient tout — nourrir le Feu.
 */
function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
}
const ent = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

describe("L'upkeep du Feu (V1-11, spec construction R16-R17, A7)", () => {
  it('le Feu BRÛLE son combustible chaque tick — sans jamais s’éteindre (braises dormantes)', () => {
    const sim = makeSim()
    const v = createVillage(sim, { chiefId: 0, tx: 10, ty: 10, npcsArrived: true })
    const before = v.fuel
    for (let t = 0; t < 500; t++) advanceUpkeep(sim)
    expect(v.fuel).toBeLessThan(before) // il brûle…
    expect(sim.villages).toContain(v) // …mais le Feu ne meurt jamais de faim (le village demeure)
  })

  it('A7 : à SEC, les murs/barrières cèdent — mais JAMAIS les composants (R17)', () => {
    const sim = makeSim()
    const v = createVillage(sim, { chiefId: 0, tx: 10, ty: 10, npcsArrived: true })
    v.fuel = 0
    const wall = addStructure(sim, 'wall', 12, 10, v.id, 0)
    const comp = addStructure(sim, 'enclume', 14, 10, v.id, 0) // un composant : intouchable
    const wallHp0 = wall.hp
    const compHp0 = comp.hp
    for (let t = 0; t < 400; t++) advanceUpkeep(sim)
    expect(sim.structures.find((s) => s.id === wall.id)!.hp).toBeLessThan(wallHp0) // le mur s’use
    expect(sim.structures.find((s) => s.id === comp.id)!.hp).toBe(compHp0) // le composant, jamais
  })

  it('le passage à sec émet fire_starved UNE seule fois (au franchissement)', () => {
    const sim = makeSim()
    const v = createVillage(sim, { chiefId: 0, tx: 10, ty: 10, npcsArrived: true })
    v.fuel = FIRE_UPKEEP.DRAIN_PER_TICK * 1.5 // à un souffle du sec
    drainEvents(sim)
    let starved = 0
    for (let t = 0; t < 50; t++) {
      advanceUpkeep(sim)
      starved += drainEvents(sim).filter((e) => e.type === 'fire_starved').length
    }
    expect(starved).toBe(1)
  })

  it('nourrir le Feu : le bois porté devient du combustible (le geste qui tient l’upkeep)', () => {
    const sim = makeSim()
    const chief = spawnEntity(sim, 10, 10)
    const v = createVillage(sim, { chiefId: chief, tx: 10, ty: 10, npcsArrived: true })
    v.fuel = 0
    grantItems(sim, chief, { wood: 5 })
    applyVillageAction(sim, chief, { type: 'feed_fire' })
    expect(v.fuel).toBeGreaterThan(0)
    expect(countOf(ent(sim, chief).inventory, 'wood')).toBeLessThan(5) // du bois a été consommé
    expect(drainEvents(sim).some((e) => e.type === 'fire_fed' && e.villageId === v.id)).toBe(true)
  })

  it('nourrir le Feu ne le remplit jamais AU-DELÀ de sa capacité (pas de gaspillage)', () => {
    const sim = makeSim()
    const chief = spawnEntity(sim, 10, 10)
    const v = createVillage(sim, { chiefId: chief, tx: 10, ty: 10, npcsArrived: true })
    v.fuel = FIRE_UPKEEP.CAPACITY - 1 // presque plein
    grantItems(sim, chief, { wood: 20 })
    applyVillageAction(sim, chief, { type: 'feed_fire' })
    expect(v.fuel).toBe(FIRE_UPKEEP.CAPACITY) // plafonné
    expect(countOf(ent(sim, chief).inventory, 'wood')).toBe(19) // 1 seul bois avalé
  })
})

describe('Le Feu tuable → la ruine (V1-12/V2-20)', () => {
  it('le Feu NOURRI est inviolable ; à SEC il tombe → le village devient une ruine pillable', () => {
    const sim = makeSim()
    const v = createVillage(sim, { chiefId: 0, tx: 10, ty: 10, npcsArrived: true })
    const fire = addStructure(sim, 'fire', 10, 10, v.id, 0)
    const chest = addStructure(sim, 'chest', 11, 10, v.id, 0, 'village')

    // NOURRI : aucun dégât ne mord (le totem inviolable).
    v.fuel = 100
    applyStructureDamage(sim, fire.id, 99999, 0)
    expect(sim.structures.find((s) => s.id === fire.id)!.hp).toBe(STRUCTURE_HP.fire)

    // À SEC : un assaut suffisant l'abat → le village TOMBE.
    v.fuel = 0
    drainEvents(sim)
    applyStructureDamage(sim, fire.id, 99999, 0)
    expect(sim.structures.some((s) => s.id === fire.id)).toBe(false) // le Feu est tombé
    expect(sim.villages.some((vg) => vg.id === v.id)).toBe(false) // le village a quitté l'état
    // La ruine se PILLE : le coffre survivant s'ouvre à tous, sans propriétaire.
    const ruin = sim.structures.find((s) => s.id === chest.id)!
    expect(ruin.access).toBe('public')
    expect(ruin.villageId).toBe(0)
  })

  it('la chute émet village_fell (pour la chronique)', () => {
    const sim = makeSim()
    const v = createVillage(sim, { chiefId: 0, tx: 10, ty: 10, npcsArrived: true })
    const fire = addStructure(sim, 'fire', 10, 10, v.id, 0)
    v.fuel = 0
    drainEvents(sim)
    applyStructureDamage(sim, fire.id, 99999, 0)
    expect(drainEvents(sim).some((e) => e.type === 'village_fell' && e.villageId === v.id)).toBe(true)
  })
})
