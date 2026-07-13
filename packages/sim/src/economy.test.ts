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
import { heldSlot } from './inventory-actions'
import { countOf, durabilityOf, freeRoomFor, inventoryOf, makeInventory, stackSize, type ItemId } from './items'
import { createEmptyMap, zoneAt } from './map'
import { equipBestTool } from './npc'
import { createSim, spawnEntity, step, type Entity, type PlayerAction, type SimState } from './sim'
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

/**
 * LAISSE MIJOTER : avance le temps jusqu'à ce que la file de l'entité se vide
 * (spec craft-file). Le craft n'est plus instantané — un test qui enfile et
 * regarde son sac dans la foulée ne verra rien. Borné : une file qui ne se vide
 * pas (station quittée, sac plein) doit faire ÉCHOUER le test, pas le figer.
 */
function drain(sim: SimState, entityId: number, maxTicks = 2000): void {
  const who = (): Entity => sim.entities.find((e) => e.id === entityId)!
  for (let t = 0; t < maxTicks && who().craftQueue.length > 0; t++) step(sim, [])
  expect(who().craftQueue).toHaveLength(0)
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

    // Fondre : à portée du four (le joueur est entre les deux stations). Deux
    // clics = UNE ligne « ×2 » (spec craft-file F3), et il faut laisser mijoter.
    act(sim, id, { type: 'craft', recipeId: 'iron_ingot' })
    act(sim, id, { type: 'craft', recipeId: 'iron_ingot' })
    expect(me(sim).craftQueue).toHaveLength(1)
    expect(me(sim).craftQueue[0]!.count).toBe(2)
    drain(sim, id)
    expect(countOf(me(sim).inventory, 'iron_ingot')).toBe(2)

    // Hache de fer à l'atelier.
    act(sim, id, { type: 'craft', recipeId: 'iron_axe' })
    drain(sim, id)
    expect(countOf(me(sim).inventory, 'iron_axe')).toBe(1)

    // Loin des stations : rejeté avec le nom de la station.
    me(sim).x = 25.5
    act(sim, id, { type: 'craft', recipeId: 'iron_ingot' })
    expect(rejections(sim)).toEqual(['station requise hors de portée : furnace'])
  })

  // Un sac plein n'est pas forcément un sac SANS place pour la sortie : les
  // intrants, en partant, LIBÈRENT des cases. Refuser d'après la place AVANT de
  // les consommer refuserait à tort un craft parfaitement légal.
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
    drain(sim, id)

    expect(countOf(me(sim).inventory, 'axe')).toBe(1)
    expect(countOf(me(sim).inventory, 'wood')).toBe(0)
    expect(countOf(me(sim).inventory, 'fiber')).toBe(0)
    expect(countOf(me(sim).inventory, 'stone')).toBe(300)
    expect(rejections(sim)).toEqual([])
  })
})

/**
 * La COUCHE 1 — le craft de fortune (spec `craft-fortune.md`). Ce qu'un survivant
 * nu peut faire à la minute 0 : tresser, tailler, ficeler. Le fil rouge tenu par
 * ces tests : **la fortune accélère, elle n'ouvre rien** — le fer et le charbon
 * restent derrière un outil FORGÉ, donc derrière un bâtiment (GDD §8).
 */
describe('l’artisanat de fortune (craft-fortune A1-A5)', () => {
  it('A1-A2 : la corde se tresse À LA MAIN, sans structure — mais la hache exige toujours son atelier', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { fiber: 3, wood: 5, stone: 3 })
    drainEvents(sim)

    // Aucun village, aucun Feu, aucune station — et pourtant la corde sort.
    act(sim, id, { type: 'craft', recipeId: 'rope' })
    drain(sim, id) // le craft prend du TEMPS désormais (spec craft-file)
    expect(sim.structures).toHaveLength(0)
    expect(countOf(me(sim).inventory, 'rope')).toBe(1)
    expect(countOf(me(sim).inventory, 'fiber')).toBe(0)
    expect(rejections(sim)).toEqual([])
    expect(me(sim).skills.crafting ?? 0).toBeGreaterThan(0) // l'XP d'artisan tombe comme ailleurs

    // La nullabilité n'ouvre QUE les recettes qui la déclarent : la hache, elle,
    // veut toujours son atelier. Sinon la couche 1 aurait dissous tout l'établi.
    act(sim, id, { type: 'craft', recipeId: 'axe' })
    expect(countOf(me(sim).inventory, 'axe')).toBe(0)
    expect(rejections(sim)).toEqual(['station requise hors de portée : workshop'])
  })

  it('A3 : le pic de fortune N’OUVRE PAS le filon — seul l’outil forgé entame le fer', () => {
    const vein = makeNode('iron_vein', 11, 10)
    const sim = makeSim([vein])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantHeld(sim, id, 'crude_pickaxe')
    drainEvents(sim)

    act(sim, id, { type: 'harvest', nodeId: vein.id })
    expect(rejections(sim)).toEqual(['il faut un outil forgé en main'])
    expect(countOf(me(sim).inventory, 'iron_ore')).toBe(0)
    expect(sim.nodes[0]!.stock).toBe(8) // le filon n'a rien lâché
    expect(me(sim).inventory[0]).toEqual({ item: 'crude_pickaxe', count: 1 }) // pas même usé

    // La pioche d'atelier, elle, ouvre : trois pierres ne valent pas une forge.
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    grantHeld(sim, id, 'pickaxe')
    act(sim, id, { type: 'harvest', nodeId: vein.id })
    expect(countOf(me(sim).inventory, 'iron_ore')).toBe(2)
  })

  it('A3bis : mais la PIERRE ne se refuse à personne — la fortune est faite de pierre', () => {
    const rock = makeNode('rock', 11, 10)
    const sim = makeSim([rock])
    const id = spawnEntity(sim, 10.3, 10.5)
    drainEvents(sim)

    // Mains nues, sans rien : le caillou vient. C'est ce qui interdit le blocage
    // circulaire (spec C3) — tout outil de fortune est fait de pierre.
    act(sim, id, { type: 'harvest', nodeId: rock.id })
    expect(countOf(me(sim).inventory, 'stone')).toBe(1)
    expect(rejections(sim)).toEqual([])
  })

  it('A4 : le hachereau rend AUTANT que la hache (×2) — et casse cinq fois plus vite', () => {
    const tree = makeNode('tree', 11, 10)
    tree.stock = 100_000
    const sim = makeSim([tree])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantHeld(sim, id, 'crude_axe')

    // Le rendement : ×2, comme l'outil d'atelier.
    swing(sim, id, tree.id, 1)
    expect(countOf(me(sim).inventory, 'wood')).toBe(2)

    // La vie : 20 coups (durabilityOf), là où la hache d'atelier en tient 100.
    // Au 20e, il ne reste plus rien en main.
    expect(durabilityOf('crude_axe')).toBe(20)
    expect(durabilityOf('axe')).toBe(BALANCE.TOOL_DURABILITY)
    swing(sim, id, tree.id, 19)
    expect(countOf(me(sim).inventory, 'crude_axe')).toBe(0)
    expect(heldSlot(me(sim))).toBeNull()

    // Sans outil, le coup suivant retombe à ×1 : la fortune ne laisse rien derrière.
    const before = countOf(me(sim).inventory, 'wood')
    swing(sim, id, tree.id, 1)
    expect(countOf(me(sim).inventory, 'wood')).toBe(before + 1)
  })

  it('A5 : le PNJ empoigne la hache d’atelier, pas le hachereau — on classe au rang', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    // Le hachereau EN PREMIER dans le sac : au rendement (×2 = ×2), la première
    // case aurait gagné. C'est le rang qui départage.
    grantItems(sim, id, { crude_axe: 1, axe: 1 })

    equipBestTool(me(sim), 'axe')

    expect(heldSlot(me(sim))?.item).toBe('axe')
  })
})

/**
 * LA FILE DE CRAFT (spec `craft-file.md`). Le craft est entré dans le TEMPS : on
 * enfile, les intrants partent, l'objet vient. Ce que ces tests tiennent, c'est
 * qu'entre les deux **rien ne se perd** — ni quand on s'éloigne de la station, ni
 * quand le sac est plein, ni quand on annule.
 */
describe('la file de craft (craft-file A1-A6)', () => {
  const ticksOf = (seconds: number) => Math.round(seconds * BALANCE.TICK_RATE_HZ)

  it('A1 : enfiler débite les intrants TOUT DE SUITE — et ne rend rien avant l’échéance', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { fiber: 3 })
    drainEvents(sim)

    act(sim, id, { type: 'craft', recipeId: 'rope' })
    expect(countOf(me(sim).inventory, 'fiber')).toBe(0) // débité au clic
    expect(countOf(me(sim).inventory, 'rope')).toBe(0) // et rien en retour
    // `act` EST un tick : l'action passe, puis le monde tourne — la file a déjà
    // descendu d'un cran. C'est l'ordre de `step`, et il n'y a pas de raison de
    // faire une exception pour le craft.
    expect(me(sim).craftQueue).toEqual([
      { recipeId: 'rope', count: 1, remainingTicks: ticksOf(3) - 1, totalTicks: ticksOf(3), paused: false },
    ])

    // Jusqu'au dernier tick : toujours rien.
    for (let t = 0; t < ticksOf(3) - 2; t++) step(sim, [])
    expect(countOf(me(sim).inventory, 'rope')).toBe(0)
    expect(me(sim).craftQueue[0]!.remainingTicks).toBe(1)

    step(sim, []) // le dernier tick : la corde sort
    expect(countOf(me(sim).inventory, 'rope')).toBe(1)
    expect(me(sim).craftQueue).toHaveLength(0)
    expect(me(sim).skills.crafting ?? 0).toBeGreaterThan(0) // l'XP tombe à la LIVRAISON
  })

  it('A2 : cinq clics = UNE ligne « ×5 », et quinze fibres débitées', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { fiber: 15 })

    for (let i = 0; i < 5; i++) act(sim, id, { type: 'craft', recipeId: 'rope' })

    expect(me(sim).craftQueue).toHaveLength(1)
    expect(me(sim).craftQueue[0]!.count).toBe(5)
    expect(countOf(me(sim).inventory, 'fiber')).toBe(0)

    drain(sim, id)
    expect(countOf(me(sim).inventory, 'rope')).toBe(5)
  })

  it('A3 : quitter la station MET EN PAUSE (et ne perd rien) — la couche 1, elle, continue', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 10, stone: 8, iron_ore: 2, coal: 1, fiber: 3 })
    act(sim, id, { type: 'light_fire' })
    equipHammer(sim, id)
    act(sim, id, { type: 'build', structure: 'furnace', tx: 11, ty: 10 })
    act(sim, id, { type: 'craft', recipeId: 'iron_ingot' })
    act(sim, id, { type: 'craft', recipeId: 'rope' }) // à la main : rien à quitter (F8)

    for (let t = 0; t < 20; t++) step(sim, [])
    const advanced = me(sim).craftQueue[0]!.remainingTicks
    expect(advanced).toBeLessThan(me(sim).craftQueue[0]!.totalTicks) // ça descend

    // ON S'ÉLOIGNE DU FOUR. Le compteur GÈLE : l'ordre n'est ni perdu, ni annulé.
    me(sim).x = 25.5
    for (let t = 0; t < 60; t++) step(sim, [])
    expect(me(sim).craftQueue[0]!.paused).toBe(true)
    expect(me(sim).craftQueue[0]!.remainingTicks).toBe(advanced) // pas un tick de plus
    expect(countOf(me(sim).inventory, 'iron_ingot')).toBe(0)

    // ON REVIENT : il repart d'où il en était, et sort.
    me(sim).x = 10.5
    drain(sim, id)
    expect(countOf(me(sim).inventory, 'iron_ingot')).toBe(1)
    expect(countOf(me(sim).inventory, 'rope')).toBe(1) // la corde, elle, n'a jamais calé
  })

  it('A4 : sac plein à l’échéance → LA FILE ATTEND ; rien n’est détruit, rien n’est crédité', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 10 })
    act(sim, id, { type: 'light_fire' }) // la station de `cooked_meat`
    // Sac SANS interstice : une pile PLEINE de viande crue (5) + 17 piles de bois.
    // Retirer 1 viande crue ne libère aucune case — la viande cuite n'aura nulle
    // part où aller.
    me(sim).inventory = inventoryOf(SLOTS.PLAYER, { raw_meat: 5, wood: 20 * (SLOTS.PLAYER - 1) })
    drainEvents(sim)

    act(sim, id, { type: 'craft', recipeId: 'cooked_meat' })
    for (let t = 0; t < ticksOf(5) + 40; t++) step(sim, [])

    // L'unité est FAITE (compteur à zéro) mais BLOQUÉE : elle attend une case.
    expect(me(sim).craftQueue[0]!.remainingTicks).toBe(0)
    expect(countOf(me(sim).inventory, 'cooked_meat')).toBe(0)
    // Rien n'est crédité tant que rien n'est livré : la chronique ne ment pas.
    expect(drainEvents(sim).some((e) => e.type === 'item_crafted')).toBe(false)
    expect(me(sim).skills.crafting ?? 0).toBe(0)

    // On vide une case : l'objet tombe au tick suivant. Rien n'a été perdu.
    me(sim).inventory[1] = null
    step(sim, [])
    expect(countOf(me(sim).inventory, 'cooked_meat')).toBe(1)
    expect(me(sim).craftQueue).toHaveLength(0)
  })

  it('A5 : annuler rembourse TOUT (unité en cours comprise) — et un sac trop plein refuse l’annulation', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { fiber: 9 })
    act(sim, id, { type: 'craft', recipeId: 'rope' })
    act(sim, id, { type: 'craft', recipeId: 'rope' })
    act(sim, id, { type: 'craft', recipeId: 'rope' })
    for (let t = 0; t < 30; t++) step(sim, []) // la 1re unité est bien entamée
    drainEvents(sim)

    // Sac saturé : le remboursement (9 fibres) ne tient pas → REFUS, la ligne reste.
    me(sim).inventory = inventoryOf(SLOTS.PLAYER, { stone: 20 * SLOTS.PLAYER })
    act(sim, id, { type: 'cancel_craft', index: 0 })
    expect(rejections(sim)).toEqual(['sac plein'])
    expect(me(sim).craftQueue).toHaveLength(1)

    // On fait de la place : l'annulation rend les NEUF fibres — la progression de
    // l'unité en cours ne coûte rien (modèle Rust).
    me(sim).inventory = makeInventory(SLOTS.PLAYER)
    act(sim, id, { type: 'cancel_craft', index: 0 })
    expect(me(sim).craftQueue).toHaveLength(0)
    expect(countOf(me(sim).inventory, 'fiber')).toBe(9)
    expect(countOf(me(sim).inventory, 'rope')).toBe(0)
  })

  it('A6 : l’Artisan ÉCONOMISE LE TEMPS — plus il monte, plus la corde va vite', () => {
    const sim = makeSim([])
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { fiber: 3 })

    act(sim, id, { type: 'craft', recipeId: 'rope' })
    const novice = me(sim).craftQueue[0]!.totalTicks
    expect(novice).toBe(ticksOf(3)) // niveau 0 : la durée de base

    me(sim).craftQueue = []
    me(sim).skills.crafting = 2500 // niveau 5
    grantItems(sim, id, { fiber: 3 })
    act(sim, id, { type: 'craft', recipeId: 'rope' })
    const maitre = me(sim).craftQueue[0]!.totalTicks

    expect(maitre).toBeLessThan(novice)
    expect(maitre).toBeGreaterThanOrEqual(1) // jamais moins d'un tick
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
