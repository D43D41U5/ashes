/**
 * LA RÉCOLTE VIVANTE (spec `docs/specs/recolte-vivante.md`) — critères d'acceptation.
 *
 * Deux mécaniques : le RENDEMENT EN CHAÎNE (la compétence gate l'usage effectif de
 * l'outil, gate doux ; quatre paliers distincts ; micro-marche additive) et la DÉRIVE
 * DU BOSQUET (un nœud de bois/plante épuisé rouvre ailleurs, seedé ; la pierre reste).
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, NODE_DEFS, TERRAIN_GRASS, TOOL_YIELD } from './balance'
import { effectiveTier, maxTierByLevel, nodeAt, type ResourceNode } from './economy'
import { drainEvents } from './events'
import { countOf, type ItemId } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { grantItems } from './village'

let idc = 500
function node(type: ResourceNode['type'], tx: number, ty: number, stock = NODE_DEFS[type].stock): ResourceNode {
  return { id: ++idc, type, tx, ty, stock, regrowAt: 0 }
}
function makeSim(nodes: ResourceNode[]): SimState {
  return createSim(7, { map: createEmptyMap(48, 48, TERRAIN_GRASS), nodes })
}
const me = (s: SimState): SimState['entities'][number] => s.entities[0]!
function act(s: SimState, id: number, action: PlayerAction): void {
  step(s, [{ entityId: id, dx: 0, dy: 0, action }])
}
/** Donne l'outil ET le met en main (l'objet tenu fait foi, spec inventaire R9). */
function grantHeld(s: SimState, id: number, item: ItemId): void {
  grantItems(s, id, { [item]: 1 })
  const e = s.entities.find((x) => x.id === id)!
  e.activeSlot = e.inventory.findIndex((sl) => sl !== null && sl.item === item)
}
/** Place l'acteur JUSTE AU SUD du nœud (à portée < INTERACT_RANGE, mais hors de son
 *  emprise bloquante : se planter SUR un rocher plein-tuile ferait éjecter l'acteur
 *  hors de portée par la collision, et le coup se ferait refuser). */
function standOn(s: SimState, id: number, n: ResourceNode): void {
  const e = s.entities.find((x) => x.id === id)!
  e.x = n.tx + 0.5
  e.y = n.ty + 1.4
}

describe('le rendement en chaîne (D3)', () => {
  it('A5 : quatre paliers d’outil strictement croissants', () => {
    // À niveau assez haut pour débloquer le fer, le palier effectif = le palier réel.
    const lvl = 100 // largement > GATE_IRON_LEVEL
    expect(maxTierByLevel(lvl)).toBe('iron')
    // effectiveTier ne rabaisse pas ce que le niveau maîtrise.
    expect(effectiveTier('none', lvl)).toBe('none')
    expect(effectiveTier('crude', lvl)).toBe('crude')
    expect(effectiveTier('basic', lvl)).toBe('basic')
    expect(effectiveTier('iron', lvl)).toBe('iron')
    // Le barème lui-même est strictement croissant (Y1) : chaque outil paie au sac.
    expect(TOOL_YIELD.none).toBeLessThan(TOOL_YIELD.crude)
    expect(TOOL_YIELD.crude).toBeLessThan(TOOL_YIELD.basic)
    expect(TOOL_YIELD.basic).toBeLessThan(TOOL_YIELD.iron)
  })

  it('A4 : gate DOUX — un outil trop bon rend comme le palier maîtrisé, jamais rien', () => {
    // maxTierByLevel : crude toujours, basic dès GATE_BASIC, iron dès GATE_IRON.
    expect(maxTierByLevel(0)).toBe('crude')
    expect(maxTierByLevel(BALANCE.GATE_BASIC_LEVEL)).toBe('basic')
    expect(maxTierByLevel(BALANCE.GATE_IRON_LEVEL)).toBe('iron')
    // Un fer en mains novices (niveau 0) est rabaissé à crude — mais jamais à none.
    expect(effectiveTier('iron', 0)).toBe('crude')
    expect(effectiveTier('basic', 0)).toBe('crude')
    // Entre les deux seuils : basic OK, iron encore rabaissé à basic.
    expect(effectiveTier('iron', BALANCE.GATE_BASIC_LEVEL)).toBe('basic')
  })

  it('A4 (comportement) : le gate touche le RENDEMENT, pas l’ACCÈS', () => {
    // Hache de fer, niveau 0 : le coup PORTE (pas de refus) mais rend au palier crude (2).
    const tree = node('tree', 10, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantHeld(sim, id, 'iron_axe')
    drainEvents(sim)
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    expect(countOf(me(sim).inventory, 'wood')).toBe(2) // crude, pas iron (4)
    expect(drainEvents(sim).some((e) => e.type === 'action_rejected')).toBe(false)
  })

  it('A4 (accès) : une pioche d’atelier OUVRE le filon de fer même à mining 0', () => {
    // iron_vein exige minTool `basic` ; une pioche d'atelier est `basic` → accès OK,
    // même si le RENDEMENT est gaté à crude (le blocage circulaire est évité, Y3).
    const vein = node('iron_vein', 10, 10, 4)
    const sim = makeSim([vein])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantHeld(sim, id, 'pickaxe') // outil d'atelier = palier basic
    drainEvents(sim)
    act(sim, id, { type: 'harvest', nodeId: vein.id })
    expect(countOf(me(sim).inventory, 'iron_ore')).toBe(2) // crude-capped, mais ÇA A PORTÉ
    expect(drainEvents(sim).some((e) => e.type === 'action_rejected')).toBe(false)
  })
})

describe('la dérive du bosquet (D1)', () => {
  it('A2 : un nœud de bois épuisé DÉRIVE — tuile voisine valide, dans le rayon', () => {
    // NB : createSim CLONE les nœuds — on lit `sim.nodes[0]`, pas la ref d'origine.
    const sim = makeSim([node('tree', 24, 24, 1)]) // un coup suffit
    const tree = sim.nodes[0]!
    const id = spawnEntity(sim, 24.5, 24.5)
    standOn(sim, id, tree)
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    // Il a bougé…
    expect(tree.tx === 24 && tree.ty === 24).toBe(false)
    // …dans le rayon…
    expect(Math.abs(tree.tx - 24)).toBeLessThanOrEqual(BALANCE.RELOCATE_RADIUS)
    expect(Math.abs(tree.ty - 24)).toBeLessThanOrEqual(BALANCE.RELOCATE_RADIUS)
    // …et l'index tuile→nœud suit : l'ancienne libre, la nouvelle occupée.
    expect(nodeAt(sim.nodes, 24, 24)).toBeUndefined()
    expect(nodeAt(sim.nodes, tree.tx, tree.ty)).toBe(tree)
  })

  it('A3 : un nœud de PIERRE ne bouge jamais (repousse sur place)', () => {
    const sim = makeSim([node('rock', 24, 24, 1)])
    const rock = sim.nodes[0]!
    const id = spawnEntity(sim, 24.5, 24.5)
    grantHeld(sim, id, 'pickaxe')
    standOn(sim, id, rock)
    act(sim, id, { type: 'harvest', nodeId: rock.id })
    expect(rock.tx).toBe(24)
    expect(rock.ty).toBe(24)
    expect(rock.stock).toBe(0)
    expect(rock.regrowAt).toBeGreaterThan(0)
  })

  it('A1 : la dérive est DÉTERMINISTE (même seed → même tuile cible)', () => {
    const run = (): { tx: number; ty: number } => {
      idc = 900 // même id des deux côtés → même hash → même cible
      const sim = makeSim([node('tree', 24, 24, 1)])
      const tree = sim.nodes[0]!
      const id = spawnEntity(sim, 24.5, 24.5)
      standOn(sim, id, tree)
      act(sim, id, { type: 'harvest', nodeId: tree.id })
      return { tx: tree.tx, ty: tree.ty }
    }
    const first = run()
    expect(first.tx === 24 && first.ty === 24).toBe(false) // a bien dérivé
    expect(run()).toEqual(first) // …vers la MÊME tuile, à chaque fois
  })

  it('A1 : la dérive ne CONSOMME PAS le flux RNG seedé', () => {
    // Deux sims identiques au coup près, SAUF le stock de l'arbre : l'une (stock 1)
    // s'épuise et DÉRIVE ; l'autre (stock 5) baisse juste. Un même `step` de récolte.
    // La relocalisation est positionnelle (`hash2`) et ne tire RIEN dans `rngState` — si
    // c'était faux, l'état RNG divergerait entre les deux (invariant §2, fragilité connue).
    idc = 950
    const drift = makeSim([node('tree', 24, 24, 1)])
    idc = 950
    const still = makeSim([node('tree', 24, 24, 5)])
    for (const s of [drift, still]) {
      const id = spawnEntity(s, 24.5, 24.5)
      standOn(s, id, s.nodes[0]!)
      act(s, id, { type: 'harvest', nodeId: s.nodes[0]!.id })
    }
    expect(drift.nodes[0]!.tx !== 24 || drift.nodes[0]!.ty !== 24).toBe(true) // a bien dérivé
    expect(still.nodes[0]!.tx).toBe(24) // n'a pas dérivé (contrôle)
    expect(drift.rngState).toBe(still.rngState) // …et pourtant même flux RNG
  })
})
