import { describe, expect, it } from 'vitest'
import { AGRICULTURE, BALANCE, FOOD_VALUES, TERRAIN_GRASS } from './balance'
import { cropStage, isCropMature, pousseDe } from './agriculture'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { addStructure, getVillageOf, grantItems, type Structure } from './village'

/** Le cœur d'une saison, DÉRIVÉ d'`ACT_DAYS` — jamais un numéro de jour écrit à la main. */
const coeurDe = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + Math.round(BALANCE.ACT_DAYS / 2)
/** Le refus commun à « pas de graine du tout » et « graine d'une autre saison » (S16). */
const HORS_SAISON = 'aucune graine de saison — il faut sa fenêtre, ou une serre'

/**
 * LE MONTAGE NOMME SA SAISON ET SON HEURE — obligatoire depuis que le socle est une COURBE du
 * jour de l'année (`saisons.md` S4). Le semis de plein air se heurte à deux gardes qui n'ont
 * plus rien de théorique : la terre gelée (`floreGelee`) et la FENÊTRE de la culture (S16).
 * Le cœur de l'ARDEUR à MIDI, donc — le potager y est la parade constructible de l'été, et
 * on n'y est marginal sur aucun des deux seuils (l'aube du jour 1 porte le plein écart de
 * nuit sur une Éclosion encore gelée : la terre y refuse la graine).
 */
function makeSim(): SimState {
  return createSim(1, {
    map: createEmptyMap(96, 96, TERRAIN_GRASS),
    jourDeDepart: coeurDe(2),
    cycleOffset: cycleOffsetForStartHour(12, coeurDe(2)),
  })
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
    // `cropStage`/`isCropMature` ne lisent que `plantedAt` et la culture : un objet minimal
    // suffit (pas de cast). Sans culture nommée, la parcelle se lit comme celle d'HIVER —
    // la seule qui existait avant le catalogue de saison (S16).
    const vide = {}
    expect(cropStage(vide, 100)).toBe(-1)
    expect(isCropMature(vide, 100)).toBe(false)
    const POUSSE = pousseDe('hiver')
    const semee = { plantedAt: 1000 }
    expect(cropStage(semee, 1000)).toBe(0)
    expect(cropStage(semee, 1000 + POUSSE / 2)).toBeCloseTo(0.5)
    expect(cropStage(semee, 1000 + POUSSE)).toBe(1)
    expect(cropStage(semee, 1000 + POUSSE * 2)).toBe(1) // plafonné
    expect(isCropMature(semee, 1000 + POUSSE - 1)).toBe(false)
    expect(isCropMature(semee, 1000 + POUSSE)).toBe(true)
  })

  it('S16 — chaque culture porte SON temps de pousse : le vert est mûr quand l’hiver germe encore', () => {
    const VERT = pousseDe('vert')
    expect(VERT).toBeLessThan(pousseDe('hiver')) // le vert d'Éclosion est le plus rapide des quatre
    expect(isCropMature({ plantedAt: 1000, culture: 'vert' }, 1000 + VERT)).toBe(true)
    expect(isCropMature({ plantedAt: 1000, culture: 'hiver' }, 1000 + VERT)).toBe(false)
    // Le stade est une FRACTION de la pousse de sa culture, pas un compte de ticks absolu.
    expect(cropStage({ plantedAt: 1000, culture: 'vert' }, 1000 + VERT / 2)).toBeCloseTo(0.5)
    expect(cropStage({ plantedAt: 1000, culture: 'hiver' }, 1000 + VERT / 2)).toBeLessThan(0.5)
  })
})

describe('agriculture — semer & récolter (A2-A4)', () => {
  it('A2 — semer la graine de LA SAISON pose `plantedAt` et retire la graine ; re-semer est rejeté', () => {
    const sim = makeSim() // le cœur de l'Ardeur : la saison du fruit (S16)
    const { id, plotId } = withPlot(sim)
    grantItems(sim, id, { graine_fruit: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    expect(typeof plot(sim, plotId).plantedAt).toBe('number') // semée : le tick de mise en terre est posé
    expect(plot(sim, plotId).culture).toBe('fruit') // la parcelle porte CE qu'on y a mis
    expect(countOf(sim.entities.find((e) => e.id === id)!.inventory, 'graine_fruit')).toBe(0)
    // Re-semer la même parcelle (déjà semée) : rejeté.
    grantItems(sim, id, { graine_fruit: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    expect(rejections(sim)).toContain('déjà semé')
  })

  it('A2bis — semer sans graine est rejeté ; hors sa fenêtre, la graine RESTE en main (S16)', () => {
    const sim = makeSim()
    const { id, plotId } = withPlot(sim)
    act(sim, id, { type: 'plant', structureId: plotId })
    expect(rejections(sim)).toContain(HORS_SAISON)
    // Une graine d'une AUTRE saison ne germe pas — et elle n'est jamais consumée : elle attend
    // son heure. C'est ce qui rend la fenêtre lisible sans être punitive.
    grantItems(sim, id, { graine_tubercule: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    expect(rejections(sim)).toContain(HORS_SAISON)
    expect(plot(sim, plotId).plantedAt).toBeUndefined()
    expect(countOf(sim.entities.find((e) => e.id === id)!.inventory, 'graine_tubercule')).toBe(1)
  })

  it('A3 — récolter avant maturité est rejeté ; au temps de pousse de SA culture, la parcelle est mûre', () => {
    const sim = makeSim()
    const { id, plotId } = withPlot(sim)
    grantItems(sim, id, { graine_fruit: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    act(sim, id, { type: 'harvest_crop', structureId: plotId })
    expect(rejections(sim)).toContain('pas encore mûr')
    // On fait « passer le temps » en reculant la mise en terre d'un temps de pousse (maturité PURE).
    plot(sim, plotId).plantedAt = sim.tick - pousseDe('fruit')
    expect(isCropMature(plot(sim, plotId), sim.tick)).toBe(true)
  })

  it('A4 — récolter une parcelle mûre verse le rendement de sa culture PLUS une graine, et la vide', () => {
    const sim = makeSim()
    const { id, plotId } = withPlot(sim)
    const fruit = AGRICULTURE.CULTURES.fruit
    grantItems(sim, id, { graine_fruit: 1 })
    act(sim, id, { type: 'plant', structureId: plotId })
    plot(sim, plotId).plantedAt = sim.tick - pousseDe('fruit') // mûre
    drainEvents(sim)
    act(sim, id, { type: 'harvest_crop', structureId: plotId })
    const inv = sim.entities.find((e) => e.id === id)!.inventory
    expect(countOf(inv, fruit.recolte)).toBe(fruit.rendement)
    // S16 — la boucle se referme sans repasser par les baies : on ressort avec sa semence.
    expect(countOf(inv, fruit.graine)).toBe(1)
    expect(plot(sim, plotId).plantedAt).toBeUndefined() // vide, on peut resemer
    expect(plot(sim, plotId).culture).toBeUndefined()
    expect(drainEvents(sim).some((e) => e.type === 'crop_harvested' && e.yield === fruit.rendement)).toBe(true)
  })

  it('A5 — le légume nourrit (FOOD_VALUES.legume), et c’est modeste (garde-fou §8bis)', () => {
    expect(FOOD_VALUES.legume).toBeGreaterThan(0)
    expect(FOOD_VALUES.legume).toBeLessThanOrEqual(FOOD_VALUES.raw_meat!) // pas mieux que la viande crue
    // Le rendement net dépasse le coût en graine (un vrai filet), mais reste modeste.
    for (const c of Object.values(AGRICULTURE.CULTURES)) expect(c.rendement).toBeGreaterThan(0)
    // S16 — les QUATRE cultures : chacune nourrit, aucune n'approche un plat cuisiné. Le potager
    // reste « sûr, renouvelable, MÉDIOCRE » — il nourrit une saison, il ne remplace pas la chasse.
    for (const c of Object.values(AGRICULTURE.CULTURES)) {
      expect(FOOD_VALUES[c.recolte]).toBeGreaterThan(0)
      expect(FOOD_VALUES[c.recolte]!).toBeLessThan(FOOD_VALUES.cooked_meat!)
      expect(c.rendement).toBeGreaterThan(1)
    }
  })
})

describe('agriculture — la SERRE : semer quand tout gèle dehors (le Grand Froid, cultures d’hiver)', () => {
  it('au cœur du Grand Froid, la terre à ciel ouvert GÈLE (parcelle refusée) mais la SERRE, non', () => {
    // Le monde OUVRE au cœur de l'hiver (`jourDeDepart`, spec `saisons.md` S2) : le calendrier
    // est à sa place dès le tick 0 et n'en bouge plus, tandis que les ticks RÉELS courent
    // normalement — la pousse (comptée en ticks) est donc intacte, seule la saison change.
    const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart: coeurDe(4) })
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

  it('S16 — sous verre la saison n’a plus cours : une graine HORS fenêtre germe quand même', () => {
    // Le tubercule est la culture des Pluies ; semé au Grand Froid, il n'a rien à faire en
    // pleine terre — et c'est exactement ce que la serre achète (« elle affranchit de la fenêtre »).
    const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart: coeurDe(4) })
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 10 })
    act(sim, id, { type: 'light_fire' })
    const serreId = addStructure(sim, 'serre', 9, 10, getVillageOf(sim, id)!.id, id).id
    grantItems(sim, id, { graine_tubercule: 1 })
    drainEvents(sim)
    act(sim, id, { type: 'plant', structureId: serreId })
    expect(sim.structures.find((s) => s.id === serreId)!.culture).toBe('tubercule')
  })

  it('terroir — le meilleur palier : hivernal comme la serre, ET plus généreux qu’elle', () => {
    /** Sème la culture d'hiver sous `type`, la fait mûrir, la récolte — rend le compte de légumes. */
    const recolteSous = (type: 'serre' | 'terroir'): number => {
      const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart: coeurDe(4) })
      const id = spawnEntity(sim, 10.5, 10.5)
      grantItems(sim, id, { wood: 10 })
      act(sim, id, { type: 'light_fire' })
      const sid = addStructure(sim, type, 11, 10, getVillageOf(sim, id)!.id, id).id
      grantItems(sim, id, { graine: 1 })
      drainEvents(sim)
      // Semé au cœur du Grand Froid : les deux sont hivernaux par leur TYPE.
      act(sim, id, { type: 'plant', structureId: sid })
      expect(typeof sim.structures.find((s) => s.id === sid)!.plantedAt).toBe('number')
      sim.structures.find((s) => s.id === sid)!.plantedAt = sim.tick - pousseDe('hiver') // mûr
      act(sim, id, { type: 'harvest_crop', structureId: sid })
      return countOf(sim.entities.find((e) => e.id === id)!.inventory, 'legume')
    }
    const serre = recolteSous('serre')
    const terroir = recolteSous('terroir')
    expect(serre).toBe(AGRICULTURE.CULTURES.hiver.rendement) // la serre rend la culture, ni plus ni moins
    expect(terroir).toBeGreaterThan(serre) // le meilleur palier majore, sur la MÊME culture
    expect(terroir - serre).toBe(AGRICULTURE.BONUS_TERROIR) // …et il majore d'exactement ce qu'il déclare
  })
})
