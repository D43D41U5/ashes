import { describe, expect, it } from 'vitest'
import { AGRICULTURE, FOOD_VALUES, TERRAIN_GRASS } from './balance'
import { cropStage, isCropMature } from './agriculture'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { addStructure, getVillageOf, grantItems, type Structure } from './village'

function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
}
function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}
function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}
/** Un Chef, son Feu allumé, et une PARCELLE de son village à portée (11,10). Rend {id, plotId}. */
function withPlot(sim: SimState): { id: number; plotId: number } {
  const id = spawnEntity(sim, 10.5, 10.5)
  grantItems(sim, id, { wood: 10 })
  act(sim, id, { type: 'light_fire' })
  const plotId = addStructure(sim, 'parcelle', 11, 10, getVillageOf(sim, id)!.id, id).id
  drainEvents(sim)
  return { id, plotId }
}
const plot = (sim: SimState, plotId: number): Structure => sim.structures.find((s) => s.id === plotId)!

describe('agriculture — la pousse est PURE (aucune entité, aucun PRNG)', () => {
  it('une parcelle vide n’a pas de stade ; semée, le stade croît de 0 à 1 avec le tick', () => {
    // `cropStage`/`isCropMature` ne lisent que `plantedAt` : un objet minimal suffit (pas de cast).
    const vide = {}
    expect(cropStage(vide, 100)).toBe(-1)
    expect(isCropMature(vide, 100)).toBe(false)
    const semee = { plantedAt: 1000 }
    expect(cropStage(semee, 1000)).toBe(0)
    expect(cropStage(semee, 1000 + AGRICULTURE.GROW_TICKS / 2)).toBeCloseTo(0.5)
    expect(cropStage(semee, 1000 + AGRICULTURE.GROW_TICKS)).toBe(1)
    expect(cropStage(semee, 1000 + AGRICULTURE.GROW_TICKS * 2)).toBe(1) // plafonné
    expect(isCropMature(semee, 1000 + AGRICULTURE.GROW_TICKS - 1)).toBe(false)
    expect(isCropMature(semee, 1000 + AGRICULTURE.GROW_TICKS)).toBe(true)
  })
})

describe('agriculture — semer & récolter (A2-A4)', () => {
  it('A2 — semer une graine pose `plantedAt` et retire la graine ; re-semer est rejeté', () => {
    const sim = makeSim()
    const { id, plotId } = withPlot(sim)
    grantItems(sim, id, { graine: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    expect(typeof plot(sim, plotId).plantedAt).toBe('number') // semée : le tick de mise en terre est posé
    expect(countOf(sim.entities.find((e) => e.id === id)!.inventory, 'graine')).toBe(0)
    // Re-semer la même parcelle (déjà semée) : rejeté.
    grantItems(sim, id, { graine: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    expect(rejections(sim)).toContain('déjà semé')
  })

  it('A2bis — semer sans graine est rejeté', () => {
    const sim = makeSim()
    const { id, plotId } = withPlot(sim)
    act(sim, id, { type: 'plant', structureId: plotId })
    expect(rejections(sim)).toContain('il faut une graine')
  })

  it('A3 — récolter avant maturité est rejeté ; à `GROW_TICKS` la parcelle est mûre', () => {
    const sim = makeSim()
    const { id, plotId } = withPlot(sim)
    grantItems(sim, id, { graine: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    act(sim, id, { type: 'harvest_crop', structureId: plotId })
    expect(rejections(sim)).toContain('pas encore mûr')
    // On fait « passer le temps » en reculant la mise en terre d'un temps de pousse (maturité PURE).
    plot(sim, plotId).plantedAt = sim.tick - AGRICULTURE.GROW_TICKS
    expect(isCropMature(plot(sim, plotId), sim.tick)).toBe(true)
  })

  it('A4 — récolter une parcelle mûre verse YIELD légumes et la vide (replantable)', () => {
    const sim = makeSim()
    const { id, plotId } = withPlot(sim)
    grantItems(sim, id, { graine: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    plot(sim, plotId).plantedAt = sim.tick - AGRICULTURE.GROW_TICKS // mûre
    drainEvents(sim)
    act(sim, id, { type: 'harvest_crop', structureId: plotId })
    const inv = sim.entities.find((e) => e.id === id)!.inventory
    expect(countOf(inv, 'legume')).toBe(AGRICULTURE.YIELD)
    expect(plot(sim, plotId).plantedAt).toBeUndefined() // vide, on peut resemer
    expect(drainEvents(sim).some((e) => e.type === 'crop_harvested' && e.yield === AGRICULTURE.YIELD)).toBe(true)
  })

  it('A5 — le légume nourrit (FOOD_VALUES.legume), et c’est modeste (garde-fou §8bis)', () => {
    expect(FOOD_VALUES.legume).toBeGreaterThan(0)
    expect(FOOD_VALUES.legume).toBeLessThanOrEqual(FOOD_VALUES.raw_meat!) // pas mieux que la viande crue
    // Le rendement net dépasse le coût en graine (un vrai filet), mais reste modeste.
    expect(AGRICULTURE.YIELD).toBeGreaterThan(0)
  })
})

describe('agriculture — la SERRE : semer quand tout gèle dehors (acte III, cultures d’hiver)', () => {
  it('en acte III, la terre à ciel ouvert GÈLE (parcelle refusée) mais la SERRE, non', () => {
    // On force l'acte III par une échelle calendaire élevée : le CALENDRIER zoome (jour ≫ 42),
    // les ticks RÉELS non — donc la pousse (en ticks) est intacte, seul l'acte change.
    const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), calendarScale: 100_000_000 })
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 10 })
    act(sim, id, { type: 'light_fire' })
    const vid = getVillageOf(sim, id)!.id
    const parcelleId = addStructure(sim, 'parcelle', 11, 10, vid, id).id
    const serreId = addStructure(sim, 'serre', 9, 10, vid, id).id
    grantItems(sim, id, { graine: 2 })
    drainEvents(sim)
    // La parcelle de plein air : la terre est gelée.
    act(sim, id, { type: 'plant', structureId: parcelleId })
    expect(rejections(sim)).toContain('la terre est gelée — il faut une serre')
    expect(sim.structures.find((s) => s.id === parcelleId)!.plantedAt).toBeUndefined()
    // La serre (cultures d'hiver) : on peut encore semer.
    act(sim, id, { type: 'plant', structureId: serreId })
    expect(typeof sim.structures.find((s) => s.id === serreId)!.plantedAt).toBe('number')
  })

  it('terroir — le meilleur palier : hivernal (semé en acte III) ET rendement supérieur', () => {
    const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), calendarScale: 100_000_000 })
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 10 })
    act(sim, id, { type: 'light_fire' })
    const terroirId = addStructure(sim, 'terroir', 11, 10, getVillageOf(sim, id)!.id, id).id
    grantItems(sim, id, { graine: 1 })
    drainEvents(sim)
    // Semé en acte III (le terroir est hivernal comme la serre).
    act(sim, id, { type: 'plant', structureId: terroirId })
    expect(typeof sim.structures.find((s) => s.id === terroirId)!.plantedAt).toBe('number')
    // Mûr → récolte SUPÉRIEURE à la parcelle (YIELD_TERROIR > YIELD).
    sim.structures.find((s) => s.id === terroirId)!.plantedAt = sim.tick - AGRICULTURE.GROW_TICKS
    act(sim, id, { type: 'harvest_crop', structureId: terroirId })
    expect(countOf(sim.entities.find((e) => e.id === id)!.inventory, 'legume')).toBe(AGRICULTURE.YIELD_TERROIR)
    expect(AGRICULTURE.YIELD_TERROIR).toBeGreaterThan(AGRICULTURE.YIELD)
  })
})
