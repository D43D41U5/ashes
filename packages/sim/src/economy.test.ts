import { describe, expect, it } from 'vitest'
import {
  ALIGNMENT,
  BALANCE,
  SLOTS,
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
} from './balance'
import { generateNodes, nodeAt, skillLevel, treeJitter, type ResourceNode } from './economy'
import { drainEvents } from './events'
import { countOf, freeRoomFor, inventoryOf, makeInventory, stackSize, type ItemId } from './items'
import { createEmptyMap, zoneAt } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { TICKS_PER_SEASON_DAY } from './time'
import { grantItems } from './village'

let nextNodeId = 100
function makeNode(type: ResourceNode['type'], tx: number, ty: number): ResourceNode {
  nextNodeId += 1
  const stocks = { tree: 10, rock: 12, fiber_plant: 6, berry_bush: 8, iron_vein: 8, coal_seam: 8 }
  return { id: nextNodeId, type, tx, ty, stock: stocks[type], regrowAt: 0 }
}

function makeSim(nodes: ResourceNode[]): SimState {
  return createSim(1, { map: createEmptyMap(32, 32, TERRAIN_GRASS), nodes })
}

function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

/** Récolte en respectant le cooldown (avance le temps entre les coups). */
function swing(sim: SimState, entityId: number, nodeId: number, times: number): void {
  for (let i = 0; i < times; i++) {
    act(sim, entityId, { type: 'harvest', nodeId })
    for (let t = 1; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
  }
}

function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

const me = (sim: SimState) => sim.entities[0]!

/**
 * Donne l'objet ET LE MET EN MAIN. Depuis que l'objet tenu fait foi (spec
 * inventaire R9), `grantItems` seul ne suffit plus : un outil dans le sac ne
 * récolte pas. C'est LE geste que le joueur fait à la hotbar.
 */
function grantHeld(sim: SimState, entityId: number, item: ItemId): void {
  grantItems(sim, entityId, { [item]: 1 })
  const entity = sim.entities.find((e) => e.id === entityId)!
  entity.activeSlot = entity.inventory.findIndex((s) => s !== null && s.item === item)
}

describe('la récolte (A1)', () => {
  it('récolte, cooldown, portée, épuisement et repousse', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    drainEvents(sim)

    const simTree = () => sim.nodes[0]!
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    expect(countOf(me(sim).inventory, 'wood')).toBe(1)
    expect(simTree().stock).toBe(9)

    // Trop tôt (cooldown), puis trop loin.
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    me(sim).x = 20
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    expect(rejections(sim)).toEqual(['trop tôt', 'trop loin'])
    me(sim).x = 10.3

    // Épuiser : le nœud se vide, puis repousse à plein.
    swing(sim, id, tree.id, 9)
    expect(simTree().stock).toBe(0)
    expect(simTree().regrowAt).toBeGreaterThan(sim.tick)
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'node_depleted' && e.nodeId === tree.id)).toBe(true)
    const regrowAt = simTree().regrowAt
    while (sim.tick <= regrowAt) step(sim, [])
    expect(simTree().stock).toBe(10)
  })
})

describe('la récolte sous archétype Meute (économie anémique, spec alignement R8)', () => {
  it('à mains nues, un membre de Meute récolte au moins 1 — anémique, pas nulle', () => {
    const bush = makeNode('berry_bush', 11, 10)
    const sim = makeSim([bush])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantItems(sim, id, { wood: 10 })
    act(sim, id, { type: 'light_fire' })
    // Fige l'archétype Meute (harvestFactor lit warmth/engagement du village).
    const village = sim.villages[0]!
    village.engagement = ALIGNMENT.ARCHETYPE_ENGAGEMENT + 10
    village.warmth = -(ALIGNMENT.ARCHETYPE_WARMTH + 10)
    drainEvents(sim)

    act(sim, id, { type: 'harvest', nodeId: bush.id })
    // floor(1 × 1 × MEUTE_HARVEST_MALUS) vaudrait 0 : le coup paierait le
    // cooldown et l'XP sans rien rapporter (et un PNJ Meute en cueillette
    // bouclerait sans jamais remplir son quota).
    expect(countOf(me(sim).inventory, 'berries')).toBeGreaterThanOrEqual(1)
    const harvested = drainEvents(sim).find((e) => e.type === 'resource_harvested')
    expect(harvested).toBeDefined()
    expect(harvested!.type === 'resource_harvested' && harvested!.count).toBeGreaterThanOrEqual(1)
  })
})

/**
 * Le sac est BORNÉ (spec inventaire R10) : le nœud garde ce qui ne rentre pas.
 * Rien ne tombe au sol, rien ne s'évapore — et si RIEN ne rentre, le coup n'a
 * pas eu lieu (ni stock, ni cooldown, ni XP).
 */
describe('la capacité à la récolte (A10, A11)', () => {
  /** Bûcheron de niveau 25 (skillLevel = √(xp/100)) : ×3 (fer) × 2 (niveau) = 6 bois par coup. */
  const MASTER_XP = 62500

  it('A10 : le nœud garde ce qui ne rentre pas dans le sac', () => {
    // Contrôle : le MÊME coup, sac vide, rend bien 6 bois — c'est ce rendement-là
    // qu'on va écrêter (sinon le test passerait pour une mauvaise raison).
    const refTree = makeNode('tree', 11, 10)
    const ref = makeSim([refTree])
    const refId = spawnEntity(ref, 10.3, 10.5)
    ref.entities[0]!.skills.woodcutting = MASTER_XP
    grantHeld(ref, refId, 'iron_axe')
    act(ref, refId, { type: 'harvest', nodeId: refTree.id })
    expect(countOf(me(ref).inventory, 'wood')).toBe(6)

    const tree = makeNode('tree', 11, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    me(sim).skills.woodcutting = MASTER_XP
    // Trois cases : une pile de bois à 18/20 (2 places), une pile de pierre PLEINE
    // (la case est bloquée), la hache. Il ne reste QUE 2 places de bois.
    me(sim).inventory = makeInventory(3)
    me(sim).inventory[0] = { item: 'wood', count: stackSize('wood') - 2 }
    me(sim).inventory[1] = { item: 'stone', count: stackSize('stone') }
    me(sim).inventory[2] = { item: 'iron_axe', count: 1 }
    me(sim).activeSlot = 2 // la hache est EN MAIN (spec inventaire R9)
    expect(freeRoomFor(me(sim).inventory, 'wood')).toBe(2)
    const stock0 = sim.nodes[0]!.stock
    drainEvents(sim)

    act(sim, id, { type: 'harvest', nodeId: tree.id })

    expect(countOf(me(sim).inventory, 'wood')).toBe(stackSize('wood')) // 18 + 2
    expect(stock0 - sim.nodes[0]!.stock).toBe(2) // les 4 autres restent DANS l'arbre
    // …et l'événement ne ment pas à la chronique : 2 bois, pas 6.
    const harvested = drainEvents(sim).find((e) => e.type === 'resource_harvested')
    expect(harvested!.type === 'resource_harvested' && harvested!.count).toBe(2)
  })

  // LE POINT DE CONCEPTION : on ÉCRÊTE, on ne refuse pas tant qu'il reste UNE place.
  // Un refus ne pose AUCUN cooldown : un `harvest` qui refuserait un coup à 6 bois
  // parce qu'il ne reste qu'une place se ferait retenter à 20 Hz, pour toujours
  // (la garde de `npc.ts` ne libère la corvée qu'à ZÉRO place — les deux se complètent).
  it('une seule place pour un coup qui en rendrait 6 : on écrête, on ne refuse pas', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    me(sim).skills.woodcutting = MASTER_XP
    me(sim).inventory = makeInventory(2)
    me(sim).inventory[0] = { item: 'wood', count: stackSize('wood') - 1 }
    me(sim).inventory[1] = { item: 'iron_axe', count: 1 }
    me(sim).activeSlot = 1 // la hache est EN MAIN (spec inventaire R9)
    expect(freeRoomFor(me(sim).inventory, 'wood')).toBe(1)
    const stock0 = sim.nodes[0]!.stock
    drainEvents(sim)

    act(sim, id, { type: 'harvest', nodeId: tree.id })

    expect(countOf(me(sim).inventory, 'wood')).toBe(stackSize('wood'))
    expect(stock0 - sim.nodes[0]!.stock).toBe(1)
    expect(rejections(sim)).toEqual([]) // aucun refus : le coup a bien eu lieu
    expect(me(sim).cooldownUntil).toBeGreaterThan(sim.tick) // …et il coûte son cooldown (un refus, lui, n'en pose aucun)
  })

  it('A11 : sac plein → refus « sac plein », rien ne bouge : ni stock, ni cooldown, ni XP', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    me(sim).inventory = makeInventory(1)
    me(sim).inventory[0] = { item: 'stone', count: stackSize('stone') } // aucune place
    me(sim).cooldownUntil = 0
    const stock0 = sim.nodes[0]!.stock
    drainEvents(sim)

    act(sim, id, { type: 'harvest', nodeId: tree.id })

    expect(sim.nodes[0]!.stock).toBe(stock0) // le coup n'a pas eu lieu
    expect(countOf(me(sim).inventory, 'wood')).toBe(0)
    expect(me(sim).cooldownUntil).toBe(0) // pas de cooldown armé
    expect(me(sim).skills.woodcutting ?? 0).toBe(0) // pas d'XP
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'resource_harvested')).toBe(false)
    expect(events.flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))).toEqual(['sac plein'])
  })
})

describe('les outils (A2)', () => {
  it('A6 : la hache EN MAIN double, s’use DANS SA CASE, et casse au bout de la durabilité', () => {
    // Un seul très gros arbre : on teste l'usure, pas la repousse.
    const tree = makeNode('tree', 11, 10)
    tree.stock = 100000
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantHeld(sim, id, 'axe')
    const held = () => me(sim).inventory[me(sim).activeSlot]

    act(sim, id, { type: 'harvest', nodeId: tree.id })
    expect(countOf(me(sim).inventory, 'wood')).toBe(2) // ×2 avec la hache EN MAIN
    expect(held()).toEqual({ item: 'axe', count: 1, wear: 1 }) // l'usure vit dans la case

    for (let t = 1; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    swing(sim, id, tree.id, BALANCE.TOOL_DURABILITY - 1)
    expect(countOf(me(sim).inventory, 'axe')).toBe(0) // consommée au 100e coup
    expect(held()).toBeNull() // la case s'est vidée
  })

  it('A7 : hache DANS LE SAC mais pas en main → ×1, aucune usure (la sim ne choisit plus)', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantItems(sim, id, { axe: 1 }) // portée, pas tenue
    me(sim).activeSlot = -1
    drainEvents(sim)

    act(sim, id, { type: 'harvest', nodeId: tree.id })

    expect(countOf(me(sim).inventory, 'wood')).toBe(1) // ×1 : mains nues
    expect(me(sim).inventory[0]).toEqual({ item: 'axe', count: 1 }) // pas d'usure
    expect(rejections(sim)).toEqual([]) // l'arbre cède quand même : il n'exige pas d'outil
  })

  it('A7 bis : une case active VIDE vaut mains nues, même avec la hache juste à côté', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    me(sim).inventory[1] = { item: 'axe', count: 1 }
    me(sim).activeSlot = 0 // une case VIDE

    act(sim, id, { type: 'harvest', nodeId: tree.id })

    expect(countOf(me(sim).inventory, 'wood')).toBe(1)
    expect(me(sim).inventory[1]).toEqual({ item: 'axe', count: 1 })
  })

  it('tenir AUTRE CHOSE qu’un outil de la famille ne sert à rien (×1, aucune usure)', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantHeld(sim, id, 'pickaxe') // une pioche… devant un arbre

    act(sim, id, { type: 'harvest', nodeId: tree.id })

    expect(countOf(me(sim).inventory, 'wood')).toBe(1) // ×1
    expect(me(sim).inventory[0]).toEqual({ item: 'pickaxe', count: 1 }) // intacte
  })

  it('A8 : le filon ne cède rien sans pioche EN MAIN — même si elle est dans le sac', () => {
    const vein = makeNode('iron_vein', 11, 10)
    const sim = makeSim([vein])
    const id = spawnEntity(sim, 10.3, 10.5)
    drainEvents(sim)
    act(sim, id, { type: 'harvest', nodeId: vein.id })
    expect(rejections(sim)).toEqual(['il faut une pioche en main'])

    // La pioche est là — DANS LE SAC. C'est toujours non : stock intact, aucun XP.
    grantItems(sim, id, { pickaxe: 1 })
    me(sim).activeSlot = -1
    const stock0 = sim.nodes[0]!.stock
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    act(sim, id, { type: 'harvest', nodeId: vein.id })
    expect(rejections(sim)).toEqual(['il faut une pioche en main'])
    expect(sim.nodes[0]!.stock).toBe(stock0)
    expect(countOf(me(sim).inventory, 'iron_ore')).toBe(0)
    expect(me(sim).skills.mining ?? 0).toBe(0)

    // En main : le filon cède.
    me(sim).activeSlot = me(sim).inventory.findIndex((s) => s !== null && s.item === 'pickaxe')
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    act(sim, id, { type: 'harvest', nodeId: vein.id })
    expect(countOf(me(sim).inventory, 'iron_ore')).toBe(2)
  })

  it('A5 : deux haches, deux usures indépendantes — celle qu’on TIENT casse seule', () => {
    const tree = makeNode('tree', 11, 10)
    tree.stock = 100000
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    me(sim).inventory[0] = { item: 'axe', count: 1, wear: BALANCE.TOOL_DURABILITY - 1 }
    me(sim).inventory[1] = { item: 'axe', count: 1 }
    me(sim).activeSlot = 0

    act(sim, id, { type: 'harvest', nodeId: tree.id })

    expect(me(sim).inventory[0]).toBeNull() // la hache TENUE a cassé
    expect(me(sim).inventory[1]).toEqual({ item: 'axe', count: 1 }) // l'autre est intacte
  })
})

/** Marteau en main — sans lui, `build` est refusé (spec recolte.md G12). */
function equipHammer(sim: SimState, id: number): void {
  grantItems(sim, id, { hammer: 1 })
  const slot = sim.entities.find((e) => e.id === id)!.inventory.findIndex((s) => s?.item === 'hammer')
  act(sim, id, { type: 'set_active_slot', slot })
}

describe('l’artisanat (A3)', () => {
  it('la chaîne T2 : lingot au four seulement, hache de fer à l’atelier seulement', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 30, stone: 20, iron_ore: 4, coal: 2 })
    act(sim, id, { type: 'light_fire' })
    equipHammer(sim, id)
    act(sim, id, { type: 'build', structure: 'furnace', tx: 11, ty: 10 })
    act(sim, id, { type: 'build', structure: 'workshop', tx: 9, ty: 10 })
    drainEvents(sim)

    // Fondre : à portée du four (le joueur est entre les deux stations).
    act(sim, id, { type: 'craft', recipeId: 'iron_ingot' })
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    act(sim, id, { type: 'craft', recipeId: 'iron_ingot' })
    expect(countOf(me(sim).inventory, 'iron_ingot')).toBe(2)

    // Hache de fer à l'atelier.
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    act(sim, id, { type: 'craft', recipeId: 'iron_axe' })
    expect(countOf(me(sim).inventory, 'iron_axe')).toBe(1)

    // Loin des stations : rejeté avec le nom de la station.
    me(sim).x = 25.5
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    act(sim, id, { type: 'craft', recipeId: 'iron_ingot' })
    expect(rejections(sim)).toEqual(['station requise hors de portée : furnace'])
  })

  // Le sac est BORNÉ : consommer les matériaux SANS place pour la sortie détruirait
  // l'objet fabriqué — et `item_crafted` mentirait à la chronique. On teste la place
  // AVANT de consommer (symétrique de R10 : « le coup n'a pas eu lieu »).
  it('sac plein : le craft est refusé AVANT de consommer — ni matériaux, ni cooldown, ni XP, ni événement', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 10 })
    act(sim, id, { type: 'light_fire' }) // le Feu est la station de `cooked_meat`
    // Sac SANS un interstice : une pile pleine de viande crue (5) + 17 piles de bois.
    // Retirer 1 viande crue ne LIBÈRE aucune case : la case 0 reste occupée.
    me(sim).inventory = inventoryOf(SLOTS.PLAYER, { raw_meat: 5, wood: 20 * (SLOTS.PLAYER - 1) })
    me(sim).cooldownUntil = 0
    drainEvents(sim)

    act(sim, id, { type: 'craft', recipeId: 'cooked_meat' })

    expect(countOf(me(sim).inventory, 'raw_meat')).toBe(5) // les matériaux sont intacts
    expect(countOf(me(sim).inventory, 'cooked_meat')).toBe(0)
    expect(me(sim).cooldownUntil).toBeLessThanOrEqual(sim.tick) // le coup n'a pas eu lieu
    expect(me(sim).skills.crafting ?? 0).toBe(0)
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'item_crafted')).toBe(false)
    expect(events.flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))).toEqual(['sac plein'])
  })

  // …mais un sac plein n'est pas forcément un sac SANS place pour la sortie : les
  // intrants, en partant, LIBÈRENT des cases. Mesurer la place avant de les
  // consommer refuse à tort un craft parfaitement légal.
  it('sac 18/18 dont les intrants libèrent une case : la hache est bel et bien forgée', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 16, stone: 4 }) // le Feu (10 bois) + l'atelier (6 bois, 4 pierres)
    act(sim, id, { type: 'light_fire' })
    equipHammer(sim, id)
    act(sim, id, { type: 'build', structure: 'workshop', tx: 11, ty: 10 })
    // 18 cases pleines : 16 de pierre (303), 1 de bois (5), 1 de fibre (2).
    // La recette (wood 5, stone 3, fiber 2) VIDE les cases de bois et de fibre.
    me(sim).inventory = inventoryOf(SLOTS.PLAYER, { stone: 303, wood: 5, fiber: 2 })
    me(sim).cooldownUntil = 0
    drainEvents(sim)

    act(sim, id, { type: 'craft', recipeId: 'axe' })

    expect(countOf(me(sim).inventory, 'axe')).toBe(1)
    expect(countOf(me(sim).inventory, 'wood')).toBe(0)
    expect(countOf(me(sim).inventory, 'fiber')).toBe(0)
    expect(countOf(me(sim).inventory, 'stone')).toBe(300)
    expect(rejections(sim)).toEqual([])
  })

  it('sac 18/18 dont les intrants ne libèrent RIEN : refus — et les intrants sont rendus', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 16, stone: 4 }) // le Feu (10 bois) + l'atelier (6 bois, 4 pierres)
    act(sim, id, { type: 'light_fire' })
    equipHammer(sim, id)
    act(sim, id, { type: 'build', structure: 'workshop', tx: 11, ty: 10 })
    // 18 cases pleines dont AUCUNE ne se vide : 5 de bois (100), 2 de fibre (40),
    // 11 de pierre (220) — la recette entame des piles, elle n'en clôt aucune.
    me(sim).inventory = inventoryOf(SLOTS.PLAYER, { wood: 100, fiber: 40, stone: 220 })
    me(sim).cooldownUntil = 0
    drainEvents(sim)

    act(sim, id, { type: 'craft', recipeId: 'axe' })

    expect(countOf(me(sim).inventory, 'axe')).toBe(0)
    // Rien ne se détruit : le coup n'a pas eu lieu (spec R10).
    expect(countOf(me(sim).inventory, 'wood')).toBe(100)
    expect(countOf(me(sim).inventory, 'fiber')).toBe(40)
    expect(countOf(me(sim).inventory, 'stone')).toBe(220)
    expect(me(sim).cooldownUntil).toBeLessThanOrEqual(sim.tick)
    expect(rejections(sim)).toEqual(['sac plein'])
  })
})

describe('la faim (A4)', () => {
  it('décroît, double en acte II, manger restaure', () => {
    // Échelle extrême : 1 tick = ~1 jour de saison → l'acte II arrive au tick 21.
    const sim = createSim(1, {
      map: createEmptyMap(32, 32, TERRAIN_GRASS),
      calendarScale: TICKS_PER_SEASON_DAY,
    })
    const id = spawnEntity(sim, 10.5, 10.5)
    const h0 = me(sim).hunger
    for (let t = 0; t < 10; t++) step(sim, [])
    const decayAct1 = (h0 - me(sim).hunger) / 10
    while (sim.tick < 30) step(sim, [])
    const h1 = me(sim).hunger
    for (let t = 0; t < 10; t++) step(sim, [])
    const decayAct2 = (h1 - me(sim).hunger) / 10
    expect(decayAct2 / decayAct1).toBeCloseTo(2, 5)

    grantItems(sim, id, { berries: 2, stew: 1 })
    me(sim).hunger = 20
    act(sim, id, { type: 'eat', item: 'berries' })
    expect(me(sim).hunger).toBeCloseTo(35, 1)
    act(sim, id, { type: 'eat', item: 'stew' })
    expect(me(sim).hunger).toBeCloseTo(85, 1)
  })

  it('à 0 : vitesse divisée par 2, restaurée après un repas', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { berries: 1 })
    me(sim).hunger = 0.000001 // tombera à 0 au premier tick
    step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    const x1 = me(sim).x
    step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    const slowStep = me(sim).x - x1
    act(sim, id, { type: 'eat', item: 'berries' })
    const x2 = me(sim).x
    step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    const fullStep = me(sim).x - x2
    expect(slowStep).toBeCloseTo(fullStep * BALANCE.HUNGER_SPEED_MALUS, 6)
  })
})

describe('la spécialisation (A5)', () => {
  it('le niveau augmente le rendement ; les autres métiers freinent l’XP', () => {
    const tree = makeNode('tree', 11, 10)
    tree.stock = 1000
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantHeld(sim, id, 'iron_axe')

    // Niveau 0 : ×3 (fer). Niveau 10 : floor(3 × 1.4) = 4.
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    expect(countOf(me(sim).inventory, 'wood')).toBe(3)
    me(sim).skills.woodcutting = 10000 // niveau 10 (setup de test)
    expect(skillLevel(10000)).toBe(10)
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    expect(countOf(me(sim).inventory, 'wood')).toBe(7)

    // Pression de spécialisation : le bûcheron de niveau 10 apprend la mine 6× plus lentement.
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    const rock = makeNode('rock', 10, 11)
    sim.nodes.push(rock)
    act(sim, id, { type: 'harvest', nodeId: rock.id })
    expect(me(sim).skills.mining).toBeCloseTo(1 / (1 + 0.5 * 10), 6)
  })
})

describe('la chair procédurale (A6)', () => {
  it('déterministe, et le T2 seulement dans les gisements', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    map.zones = [{ name: 'la Mine', kind: 'gisement', x: 40, y: 8, w: 12, h: 10 }]
    const a = generateNodes(map, 42)
    const b = generateNodes(map, 42)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(20)
    expect(generateNodes(map, 43)).not.toEqual(a)

    for (const n of a) {
      const inMine = zoneAt(map, n.tx + 0.5, n.ty + 0.5)?.kind === 'gisement'
      if (n.type === 'iron_vein' || n.type === 'coal_seam') expect(inMine).toBe(true)
      else expect(inMine).toBe(false)
    }
    expect(a.some((n) => n.type === 'iron_vein')).toBe(true)
    expect(nodeAt(a, a[0]!.tx, a[0]!.ty)).toBe(a[0])
  })

  it('placement positionnel : rendre une tuile lointaine non-marchable ne redistribue pas les nœuds ailleurs', () => {
    const a = generateNodes(createEmptyMap(40, 40, TERRAIN_GRASS), 7)
    const mod = createEmptyMap(40, 40, TERRAIN_GRASS)
    mod.terrain[2 * 40 + 2] = TERRAIN_DEEP_WATER // UNE tuile lointaine non-marchable
    const b = generateNodes(mod, 7)
    // Les id sont réassignés en row-major (la tuile (2,2) disparaît → décalage d'id),
    // donc on compare par (tx,ty,type) en excluant la tuile modifiée : tout le RESTE
    // doit être identique — preuve que le placement est LOCAL, pas rippling.
    const key = (n: ResourceNode): string => `${n.tx},${n.ty},${n.type}`
    const notAt22 = (n: ResourceNode): boolean => !(n.tx === 2 && n.ty === 2)
    expect(b.filter(notAt22).map(key).sort()).toEqual(a.filter(notAt22).map(key).sort())
  })

  it('le marais est riche en baies et fibres (spec vallée 2026-07-06)', () => {
    const map = createEmptyMap(20, 20, TERRAIN_MARSH)
    const nodes = generateNodes(map, 7)
    const berries = nodes.filter((n) => n.type === 'berry_bush').length
    const fibers = nodes.filter((n) => n.type === 'fiber_plant').length
    expect(berries).toBeGreaterThan(0)
    expect(fibers).toBeGreaterThan(0)
    // ~3× plus dense que l'herbe : 400 tuiles → attendre nettement plus que ~11
    expect(berries + fibers).toBeGreaterThan(25)
  })
})

describe('les nœuds carrière (mines simples)', () => {
  it('une zone carrière ne pose que de la pierre (spec mines 2026-07-06)', () => {
    const map = createEmptyMap(20, 20, TERRAIN_GRASS)
    map.zones = [{ name: 'la Carrière', kind: 'carriere', x: 4, y: 4, w: 12, h: 12 }]
    const nodes = generateNodes(map, 5)
    const inZone = nodes.filter((n) => n.tx >= 4 && n.tx < 16 && n.ty >= 4 && n.ty < 16)
    expect(inZone.length).toBeGreaterThan(0)
    expect(inZone.every((n) => n.type === 'rock')).toBe(true)
    expect(inZone.some((n) => n.type === 'iron_vein' || n.type === 'coal_seam')).toBe(false)
  })
})

describe('clustering spatial des nœuds (densité-feeling 2026-07-09)', () => {
  // Grille homogène de forêt : p(arbre) = 0.22, density 0.025.
  const W = 300
  const H = 300
  const D = 0.025
  const forestMap = () => createEmptyMap(W, H, TERRAIN_FOREST)

  it('déterministe sous-échantillonné (INV-3)', () => {
    const a = generateNodes(forestMap(), 99, D)
    const b = generateNodes(forestMap(), 99, D)
    expect(a).toEqual(b)
  })

  it('budget préservé à ±10 % (INV-4)', () => {
    const nodes = generateNodes(forestMap(), 99, D)
    const expected = W * H * D * 0.22 // ≈ 495
    expect(nodes.length).toBeGreaterThan(expected * 0.9)
    expect(nodes.length).toBeLessThan(expected * 1.1)
  })

  it('sur-dispersion : les nœuds se regroupent (INV-6)', () => {
    const nodes = generateNodes(forestMap(), 99, D)
    // Bucketing en cellules 20×20 → variance/moyenne >> 1 (Poisson uniforme ≈ 1).
    const cell = 20
    const cols = W / cell
    const counts = new Array<number>((W / cell) * (H / cell)).fill(0)
    for (const n of nodes) {
      const ci = Math.floor(n.tx / cell)
      const cj = Math.floor(n.ty / cell)
      counts[cj * cols + ci]! += 1
    }
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length
    const variance = counts.reduce((s, c) => s + (c - mean) * (c - mean), 0) / counts.length
    expect(variance / mean).toBeGreaterThan(1.5) // clustering ⇒ sur-dispersion
  })
})

describe('nodeAt indexé O(1) (densité-nœuds 2026-07-09)', () => {
  it('rend EXACTEMENT le même nœud que le scan linéaire (INV collision préservée)', () => {
    const map = createEmptyMap(80, 80, TERRAIN_FOREST)
    const nodes = generateNodes(map, 4242)
    const linear = (tx: number, ty: number): ResourceNode | undefined =>
      nodes.find((n) => n.tx === tx && n.ty === ty)
    // Toutes les tuiles (occupées ET vides) doivent coïncider avec le find.
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        expect(nodeAt(nodes, tx, ty)).toBe(linear(tx, ty))
      }
    }
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('reflète la déplétion en direct (l’index tient une référence, pas une copie)', () => {
    const map = createEmptyMap(20, 20, TERRAIN_FOREST)
    const nodes = generateNodes(map, 7)
    const first = nodes[0]!
    const found = nodeAt(nodes, first.tx, first.ty)
    expect(found).toBe(first)
    found!.stock = 0
    // La même référence est renvoyée : le stock mis à 0 est visible (la collision
    // lit stock>0 en direct, donc un arbre épuisé cesse de bloquer).
    expect(nodeAt(nodes, first.tx, first.ty)!.stock).toBe(0)
  })
})

describe('treeJitter — décalage déterministe de l’origine des arbres', () => {
  const J = BALANCE.TREE_JITTER_TILES

  it('est déterministe : deux appels sur la même tuile rendent le même décalage', () => {
    const a = treeJitter(37, 91)
    const b = treeJitter(37, 91)
    expect(a).toEqual(b)
  })

  it('est borné à ±J sur un large échantillon de tuiles', () => {
    for (let ty = 0; ty < 40; ty++) {
      for (let tx = 0; tx < 40; tx++) {
        const { dx, dy } = treeJitter(tx, ty)
        expect(Math.abs(dx)).toBeLessThanOrEqual(J)
        expect(Math.abs(dy)).toBeLessThanOrEqual(J)
      }
    }
  })

  it('n’est pas diagonal : dx et dy sont décorrélés (au moins une tuile avec dx ≠ dy)', () => {
    let seenDifferent = false
    for (let tx = 0; tx < 20 && !seenDifferent; tx++) {
      const { dx, dy } = treeJitter(tx, 5)
      if (dx !== dy) seenDifferent = true
    }
    expect(seenDifferent).toBe(true)
  })

  it('couvre le négatif ET le positif sur les deux axes (pas de biais d’un côté)', () => {
    let hasNegX = false, hasPosX = false, hasNegY = false, hasPosY = false
    for (let ty = 0; ty < 40; ty++) {
      for (let tx = 0; tx < 40; tx++) {
        const { dx, dy } = treeJitter(tx, ty)
        if (dx < 0) hasNegX = true
        if (dx > 0) hasPosX = true
        if (dy < 0) hasNegY = true
        if (dy > 0) hasPosY = true
      }
    }
    expect(hasNegX && hasPosX && hasNegY && hasPosY).toBe(true)
  })
})
