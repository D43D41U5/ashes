import { describe, expect, it } from 'vitest'
import { seasonActFactor } from './alignment'
import { ALIGNMENT, BALANCE, COMBAT, FOOD_VALUES, SLOTS, TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { applyInventoryAction, heldSlot, wearHeld } from './inventory-actions'
import { countOf, inventoryOf, makeInventory, type Inventory, type ItemId } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type Entity, type PlayerAction, type SimState } from './sim'
import { grantItems, structureAt, type Structure } from './village'

function playerSim(): { state: SimState; entity: Entity } {
  const state = createSim(1)
  const id = spawnEntity(state, 5, 5)
  return { state, entity: state.entities.find((e) => e.id === id)! }
}

/** Carte 96×96 : assez grande pour deux Feux au-delà de FIRE_MIN_DISTANCE. */
function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
}

function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

function entity(sim: SimState, id: number): Entity {
  return sim.entities.find((e) => e.id === id)!
}

function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

function founder(sim: SimState, x: number, y: number): number {
  const id = spawnEntity(sim, x, y)
  // Le marteau EN PREMIER (case 0 = ceinture : `set_active_slot` n'accepte qu'elle),
  // et EN MAIN : sans lui on ne bâtit plus rien (spec recolte.md G12).
  grantItems(sim, id, { hammer: 1 })
  grantItems(sim, id, { wood: 100, stone: 20 })
  act(sim, id, { type: 'light_fire' })
  act(sim, id, { type: 'set_active_slot', slot: 0 })
  return id
}

/** Un chef, son coffre PRIVÉ (le défaut) à portée, et un étranger à portée. */
function chestSim(): { sim: SimState; chief: number; stranger: number; chest: Structure } {
  const sim = makeSim()
  const chief = founder(sim, 10.5, 10.5)
  act(sim, chief, { type: 'build', structure: 'chest', tx: 11, ty: 10 })
  const chest = structureAt(sim.structures, 11, 10)!
  const stranger = spawnEntity(sim, 11.8, 10.5)
  // Sac NET : le reliquat de matériaux du fondateur brouillerait les index de case
  // (ces tests raisonnent sur des INDEX). Le marteau part avec — le seul test qui
  // bâtit encore après coup se le redonne lui-même (G12).
  entity(sim, chief).inventory = makeInventory(SLOTS.PLAYER)
  drainEvents(sim)
  return { sim, chief, stranger, chest }
}

/**
 * Forge une action à partir d'un littéral que TypeScript refuserait : le client
 * est HOSTILE (invariant §3), il envoie ce qu'il veut sur le fil. Un test de
 * sécurité doit pouvoir mentir sur un champ que le type interdit à la compilation.
 */
function forge(action: unknown): PlayerAction {
  return action as PlayerAction
}

/** A21 : la somme des `count` par item sur (joueur + conteneur). Doit être INVARIANTE. */
function census(...invs: Inventory[]): Partial<Record<ItemId, number>> {
  const bag: Partial<Record<ItemId, number>> = {}
  for (const inv of invs) {
    for (const slot of inv) {
      if (slot === null) continue
      bag[slot.item] = (bag[slot.item] ?? 0) + slot.count
    }
  }
  return bag
}

describe('la case active', () => {
  it('naît à -1 (mains nues)', () => {
    const { entity } = playerSim()
    expect(entity.activeSlot).toBe(-1)
    expect(heldSlot(entity)).toBeNull()
  })

  it('set_active_slot désigne une case de la ceinture', () => {
    const { state, entity } = playerSim()
    entity.inventory[2] = { item: 'axe', count: 1 }
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: 2 })
    expect(entity.activeSlot).toBe(2)
    expect(heldSlot(entity)?.item).toBe('axe')
  })

  it('A16 : une case hors de la CEINTURE est refusée', () => {
    const { state, entity } = playerSim()
    drainEvents(state)
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: SLOTS.BELT }) // 1re case du sac
    expect(entity.activeSlot).toBe(-1) // inchangé
    expect(drainEvents(state)).toContainEqual(
      expect.objectContaining({ type: 'action_rejected', reason: 'hors de la ceinture' }),
    )
  })

  it('A16 : une case au-delà du sac est refusée', () => {
    const { state, entity } = playerSim()
    entity.inventory = entity.inventory.slice(0, 2) // un sac de 2 cases
    drainEvents(state)
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: 4 })
    expect(entity.activeSlot).toBe(-1)
    expect(drainEvents(state)).toContainEqual(
      expect.objectContaining({ type: 'action_rejected', reason: 'hors de la ceinture' }),
    )
  })

  it('-1 est accepté (rengainer)', () => {
    const { state, entity } = playerSim()
    entity.activeSlot = 0
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: -1 })
    expect(entity.activeSlot).toBe(-1)
  })

  it('une case active VIDE vaut mains nues', () => {
    const { state, entity } = playerSim()
    applyInventoryAction(state, entity.id, { type: 'set_active_slot', slot: 0 })
    expect(entity.activeSlot).toBe(0)
    expect(heldSlot(entity)).toBeNull() // la case 0 est vide
  })

  it('R8 : un activeSlot hors ceinture n’arme AUCUNE main, même posé de force', () => {
    const { entity } = playerSim()
    // On court-circuite `set_active_slot` : c'est précisément le cas que la garde
    // de LECTURE doit tenir, quand un futur site d'écriture (déplacer/scinder une
    // case) laisserait traîner un index hors ceinture. R8 doit être infalsifiable.
    entity.inventory[SLOTS.BELT] = { item: 'iron_axe', count: 1 }
    entity.activeSlot = SLOTS.BELT
    expect(heldSlot(entity)).toBeNull() // le sac se fouille, il ne s'empoigne pas
  })
})

describe('wearHeld (A5 : l’usure vit dans la case)', () => {
  it('use l’objet TENU, et le casse à TOOL_DURABILITY — sans toucher l’autre hache', () => {
    const { entity } = playerSim()
    entity.inventory[0] = { item: 'axe', count: 1 }
    entity.inventory[1] = { item: 'axe', count: 1 }
    entity.activeSlot = 0

    wearHeld(entity, 1)
    expect(entity.inventory[0]).toEqual({ item: 'axe', count: 1, wear: 1 })
    expect(entity.inventory[1]).toEqual({ item: 'axe', count: 1 }) // l'autre est neuve

    wearHeld(entity, BALANCE.TOOL_DURABILITY - 1)
    expect(entity.inventory[0]).toBeNull() // celle qu'on TIENT a cassé
    expect(entity.inventory[1]).toEqual({ item: 'axe', count: 1 })
  })

  it('mains nues : ne casse rien, ne crée rien', () => {
    const { entity } = playerSim()
    entity.inventory[0] = { item: 'axe', count: 1 }
    entity.activeSlot = -1
    wearHeld(entity, 10)
    expect(entity.inventory[0]).toEqual({ item: 'axe', count: 1 })
  })
})

describe('move_slot — glisser une case sur une autre (R14)', () => {
  it('A13 : deux piles du même item FUSIONNENT, le débord reste à la SOURCE', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 15 }
    entity.inventory[1] = { item: 'wood', count: 12 } // stackSize('wood') = 20
    const avant = census(entity.inventory)

    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })

    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 20 })
    expect(entity.inventory[1]).toEqual({ item: 'wood', count: 7 }) // le débord RESTE
    expect(census(entity.inventory)).toEqual(avant) // A21
  })

  it('A13bis : une fusion qui tient entièrement vide la case source', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 5 }
    entity.inventory[1] = { item: 'wood', count: 3 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 8 })
    expect(entity.inventory[1]).toBeNull()
  })

  it('A14 : deux items DIFFÉRENTS s’échangent — et l’usure suit l’objet', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 5 }
    entity.inventory[1] = { item: 'axe', count: 1, wear: 3 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(entity.inventory[0]).toEqual({ item: 'axe', count: 1, wear: 3 })
    expect(entity.inventory[1]).toEqual({ item: 'wood', count: 5 })
  })

  it('deux outils ne fusionnent JAMAIS (pile de 1) : ils s’échangent, chacun son usure', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'axe', count: 1, wear: 1 }
    entity.inventory[1] = { item: 'axe', count: 1, wear: 9 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(entity.inventory[0]).toEqual({ item: 'axe', count: 1, wear: 9 })
    expect(entity.inventory[1]).toEqual({ item: 'axe', count: 1, wear: 1 })
  })

  it('vers une case VIDE : la case déménage entière, usure comprise', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'iron_pickaxe', count: 1, wear: 7 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 0, to: 9 })
    expect(entity.inventory[0]).toBeNull()
    expect(entity.inventory[9]).toEqual({ item: 'iron_pickaxe', count: 1, wear: 7 })
  })

  it('deux piles PLEINES du même item s’échangent (rien à fusionner) — aucun item perdu', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 20 }
    entity.inventory[1] = { item: 'wood', count: 6 }
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 1, to: 0 })
    expect(census(entity.inventory)).toEqual({ wood: 26 })
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 6 })
    expect(entity.inventory[1]).toEqual({ item: 'wood', count: 20 })
  })

  it('refuse une case vide, une case hors bornes, une case sur elle-même, un index non entier', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 5 }
    drainEvents(state)
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 3, to: 0 }) // source vide
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 0, to: 99 }) // hors bornes
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: -1, to: 0 })
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 0, to: 0 }) // sur place
    applyInventoryAction(state, entity.id, { type: 'move_slot', from: 0.5, to: 1 })
    expect(rejections(state)).toEqual([
      'déplacement impossible',
      'déplacement impossible',
      'déplacement impossible',
      'déplacement impossible',
      'case invalide',
    ])
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 5 })
    expect(census(entity.inventory)).toEqual({ wood: 5 })
  })
})

describe('split_slot — scinder une pile (R15)', () => {
  it('A15 : scinde vers une case VIDE', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 20 }
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 3, count: 8 })
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 12 })
    expect(entity.inventory[3]).toEqual({ item: 'wood', count: 8 })
    expect(census(entity.inventory)).toEqual({ wood: 20 }) // A21
  })

  it('A15 : refuse une case OCCUPÉE, un OUTIL, une quantité invalide', () => {
    const { state, entity } = playerSim()
    entity.inventory[0] = { item: 'wood', count: 12 }
    entity.inventory[4] = { item: 'stone', count: 1 }
    entity.inventory[5] = { item: 'axe', count: 1 }
    drainEvents(state)

    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 4, count: 2 })
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 5, to: 6, count: 1 }) // outil
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 6, count: 12 }) // toute la pile
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 6, count: 0 })
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 6, count: -3 })
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 6, count: 1.5 })
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 2, to: 6, count: 1 }) // source vide
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 99, count: 1 }) // hors bornes
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: -1, to: 6, count: 1 })
    applyInventoryAction(state, entity.id, { type: 'split_slot', from: 0, to: 0, count: 1 }) // sur place

    expect(rejections(state)).toEqual([
      'case occupée',
      'objet non empilable',
      'quantité invalide',
      'quantité invalide',
      'quantité invalide',
      'case invalide',
      'case vide',
      'case invalide',
      'case invalide',
      'case invalide',
    ])
    expect(entity.inventory[0]).toEqual({ item: 'wood', count: 12 }) // inchangé
    expect(entity.inventory[5]).toEqual({ item: 'axe', count: 1 })
    expect(entity.inventory[6]).toBeNull()
    expect(census(entity.inventory)).toEqual({ wood: 12, stone: 1, axe: 1 })
  })
})

describe('transfer — joueur ⇄ conteneur (R16)', () => {
  it('A17 : déposer dans le coffre PRIVÉ d’autrui est permis (la boîte aux dons) ; retirer est refusé', () => {
    const { sim, stranger, chest } = chestSim()
    grantItems(sim, stranger, { wood: 5 })
    const sac = entity(sim, stranger).inventory
    drainEvents(sim)

    // Déposer : ouvert à tous.
    act(sim, stranger, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 5,
    })
    expect(chest.inventory![0]).toEqual({ item: 'wood', count: 5 })
    expect(countOf(sac, 'wood')).toBe(0)

    // Retirer : verrouillé.
    act(sim, stranger, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'container', slot: 0 },
      to: { side: 'player', slot: 0 },
      count: 5,
    })
    expect(rejections(sim)).toEqual(['accès refusé'])
    expect(chest.inventory![0]).toEqual({ item: 'wood', count: 5 }) // rien n'a bougé
    expect(countOf(sac, 'wood')).toBe(0)
  })

  it('une case de destination OCCUPÉE ne s’échange pas avec la source (un échange serait un RETRAIT déguisé)', () => {
    const { sim, chief, stranger, chest } = chestSim()
    grantItems(sim, chief, { stone: 3 })
    act(sim, chief, { type: 'deposit', structureId: chest.id, item: 'stone', count: 3 })
    grantItems(sim, stranger, { wood: 5 })
    drainEvents(sim)

    act(sim, stranger, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 }, // occupée par la pierre du chef
      count: 5,
    })

    expect(rejections(sim)).toEqual(['case occupée'])
    expect(chest.inventory![0]).toEqual({ item: 'stone', count: 3 }) // la pierre du chef est restée
    expect(countOf(entity(sim, stranger).inventory, 'stone')).toBe(0) // et n'a pas été volée
    expect(countOf(entity(sim, stranger).inventory, 'wood')).toBe(5)
  })

  it('A18 : hors de INTERACT_RANGE → refus, les deux inventaires inchangés', () => {
    const { sim, chief, chest } = chestSim()
    grantItems(sim, chief, { wood: 5 })
    entity(sim, chief).x = 10.5 + BALANCE.INTERACT_RANGE + 2
    const avant = census(entity(sim, chief).inventory, chest.inventory!)
    drainEvents(sim)

    act(sim, chief, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 5,
    })

    expect(rejections(sim)).toEqual(['trop loin'])
    expect(census(entity(sim, chief).inventory, chest.inventory!)).toEqual(avant)
    expect(chest.inventory!.every((s) => s === null)).toBe(true)
  })

  it('A19/A21 : case de destination presque pleine → seul ce qui rentre passe, le reste RESTE à la source', () => {
    const { sim, chief, chest } = chestSim()
    grantItems(sim, chief, { wood: 7 })
    chest.inventory![0] = { item: 'wood', count: 18 } // il ne reste que 2 places
    const sac = entity(sim, chief).inventory
    const avant = census(sac, chest.inventory!)
    drainEvents(sim)

    act(sim, chief, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 7,
    })

    expect(chest.inventory![0]).toEqual({ item: 'wood', count: 20 })
    expect(countOf(sac, 'wood')).toBe(5) // 5 restent à la source
    expect(census(sac, chest.inventory!)).toEqual(avant) // A21 : rien créé, rien détruit
    expect(rejections(sim)).toEqual([]) // 2 unités ont bougé : ce n'est pas un refus

    // Et la case PLEINE ne prend plus rien du tout.
    act(sim, chief, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 5,
    })
    expect(rejections(sim)).toEqual(['destination pleine'])
    expect(census(sac, chest.inventory!)).toEqual(avant)
  })

  /**
   * LA LESSIVEUSE À OUTILS (spec R6). Un transfert qui reconstruit la case à
   * l'arrivée (`addItems(toBag(…))`) rend l'outil NEUF : un aller-retour au coffre
   * réparerait gratuitement toute une hache. L'objet voyage AVEC sa case.
   */
  it('une hache usée déposée dans un coffre puis reprise reste USÉE', () => {
    const { sim, chief, chest } = chestSim()
    entity(sim, chief).inventory[0] = { item: 'axe', count: 1, wear: 5 }
    drainEvents(sim)

    act(sim, chief, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 2 },
      count: 1,
    })
    expect(chest.inventory![2]).toEqual({ item: 'axe', count: 1, wear: 5 })
    expect(entity(sim, chief).inventory[0]).toBeNull()

    act(sim, chief, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'container', slot: 2 },
      to: { side: 'player', slot: 7 },
      count: 1,
    })
    expect(chest.inventory![2]).toBeNull()
    expect(entity(sim, chief).inventory[7]).toEqual({ item: 'axe', count: 1, wear: 5 }) // TOUJOURS usée
    expect(rejections(sim)).toEqual([])
  })

  it('la case posée n’est JAMAIS la case source (aucun aliasing entre deux inventaires)', () => {
    const { sim, chief, chest } = chestSim()
    const sac = entity(sim, chief).inventory
    sac[0] = { item: 'wood', count: 5 }

    // Un transfert PARTIEL : la case source SURVIT au geste. Si la destination
    // recevait sa référence, le même objet vivrait dans DEUX inventaires à la fois
    // — et le bois du coffre et celui du sac ne seraient qu'un seul et même bois.
    act(sim, chief, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 2,
    })
    expect(sac[0]).toEqual({ item: 'wood', count: 3 })
    expect(chest.inventory![0]).toEqual({ item: 'wood', count: 2 })
    expect(chest.inventory![0]).not.toBe(sac[0]) // deux objets, pas un seul

    chest.inventory![0]!.count = 99
    expect(sac[0]).toEqual({ item: 'wood', count: 3 }) // le sac n'a pas bougé d'un poil
  })

  it('un CADAVRE se fouille case à case, sans serrure — et disparaît quand il est vidé', () => {
    const sim = makeSim()
    const id = spawnEntity(sim, 20.5, 20.5)
    sim.corpses.push({
      id: 1,
      x: 20.5,
      y: 20.5,
      inventory: inventoryOf(SLOTS.CORPSE, { cooked_meat: 2 }),
      decayAt: sim.tick + COMBAT.CORPSE_TICKS,
    })
    sim.nextCorpseId = 2
    drainEvents(sim)

    act(sim, id, {
      type: 'transfer',
      kind: 'corpse',
      containerId: 1,
      from: { side: 'container', slot: 0 },
      to: { side: 'player', slot: 0 },
      count: 1,
    })
    expect(entity(sim, id).inventory[0]).toEqual({ item: 'cooked_meat', count: 1 })
    expect(sim.corpses).toHaveLength(1) // il reste de la viande : le tas demeure

    act(sim, id, {
      type: 'transfer',
      kind: 'corpse',
      containerId: 1,
      from: { side: 'container', slot: 0 },
      to: { side: 'player', slot: 1 },
      count: 1,
    })
    expect(countOf(entity(sim, id).inventory, 'cooked_meat')).toBe(2)
    expect(sim.corpses).toHaveLength(0) // vidé : le tas s'efface
    expect(drainEvents(sim)).toContainEqual(expect.objectContaining({ type: 'corpse_looted' }))
  })

  it('refuse un conteneur inconnu, une structure sans coffre, un transfert sur place, une quantité invalide', () => {
    const { sim, chief, chest } = chestSim()
    // Marteau EN MAIN : bâtir l'exige (G12). Donné AVANT le bois pour tomber en case 0.
    grantItems(sim, chief, { hammer: 1 })
    act(sim, chief, { type: 'set_active_slot', slot: 0 })
    grantItems(sim, chief, { wood: 20 })
    act(sim, chief, { type: 'build', structure: 'wall', tx: 10, ty: 11 }) // une structure SANS coffre
    const wall = structureAt(sim.structures, 10, 11)!
    entity(sim, chief).inventory = makeInventory(SLOTS.PLAYER)
    entity(sim, chief).inventory[0] = { item: 'wood', count: 5 }
    drainEvents(sim)
    const base = {
      type: 'transfer',
      kind: 'structure',
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 1,
    } as const

    act(sim, chief, { ...base, containerId: 9999 })
    act(sim, chief, { ...base, containerId: wall.id })
    act(sim, chief, { ...base, containerId: chest.id, count: 0 })
    act(sim, chief, { ...base, containerId: chest.id, count: 1.5 })
    act(sim, chief, { ...base, containerId: chest.id, to: { side: 'player', slot: 1 } })
    act(sim, chief, { ...base, containerId: chest.id, from: { side: 'player', slot: 99 } })
    act(sim, chief, { ...base, containerId: chest.id, from: { side: 'player', slot: 3 } }) // vide

    expect(rejections(sim)).toEqual([
      'conteneur inconnu',
      'pas un conteneur',
      'quantité invalide',
      'quantité invalide',
      'transfert sur place',
      'case invalide',
      'case vide',
    ])
    expect(census(entity(sim, chief).inventory, chest.inventory!)).toEqual({ wood: 5 })
  })

  /**
   * R16 : « les effets d'alignement du dépôt de nourriture chez autrui sont
   * préservés à l'IDENTIQUE ». Les deux chemins (`deposit` en gros, `transfer`
   * case-à-case) doivent produire le même `gift_given` et la même chaleur — c'est
   * la même règle, appelée au même endroit (`creditForeignDeposit`).
   */
  it('A17 : le don au grenier d’un AUTRE village crédite la même chaleur que `deposit`', () => {
    function donner(via: 'deposit' | 'transfer'): { warmth: number; gifts: unknown[] } {
      const sim = makeSim()
      const donneur = founder(sim, 10.5, 10.5)
      const chief2 = founder(sim, 70.5, 70.5)
      act(sim, chief2, { type: 'build', structure: 'chest', tx: 71, ty: 70 })
      const granary = structureAt(sim.structures, 71, 70)!
      act(sim, chief2, { type: 'set_access', structureId: granary.id, access: 'village' })
      // Le grenier ne peut plus prendre que 3 baies (stackSize('berries') = 10).
      granary.inventory = inventoryOf(SLOTS.CHEST, { stone: 20 * (SLOTS.CHEST - 1), berries: 7 })

      const moi = entity(sim, donneur)
      moi.x = 71.5
      moi.y = 71.4
      moi.warmth = 0
      moi.inventory = makeInventory(SLOTS.PLAYER)
      moi.inventory[0] = { item: 'berries', count: 10 }
      drainEvents(sim)

      if (via === 'deposit') {
        act(sim, donneur, { type: 'deposit', structureId: granary.id, item: 'berries', count: 10 })
      } else {
        const berriesSlot = granary.inventory.findIndex((s) => s?.item === 'berries')
        act(sim, donneur, {
          type: 'transfer',
          kind: 'structure',
          containerId: granary.id,
          from: { side: 'player', slot: 0 },
          to: { side: 'container', slot: berriesSlot },
          count: 10,
        })
      }
      const gifts = drainEvents(sim).filter((e) => e.type === 'gift_given')
      expect(countOf(granary.inventory, 'berries')).toBe(10) // 7 + 3
      expect(countOf(moi.inventory, 'berries')).toBe(7) // le reste est resté au sac
      return { warmth: moi.warmth, gifts }
    }

    const attendu =
      FOOD_VALUES.berries! * 3 * ALIGNMENT.FOREIGN_DEPOSIT_WARMTH_PER_FOOD * seasonActFactor(makeSim())
    const parDeposit = donner('deposit')
    const parTransfer = donner('transfer')

    expect(parDeposit.gifts).toHaveLength(1)
    expect(parTransfer.gifts).toEqual(parDeposit.gifts) // le MÊME événement, au même compte (3)
    expect(parTransfer.warmth).toBe(parDeposit.warmth) // …et la MÊME chaleur, au bit près
    // (3 baies créditées, pas 10 ; seasonActFactor a décanté d'un cheveu depuis le tick 0)
    expect(parTransfer.warmth).toBeCloseTo(attendu, 3)
  })

  it('déposer chez SOI n’est pas un don (aucun `gift_given`, aucune chaleur)', () => {
    const { sim, chief, chest } = chestSim()
    grantItems(sim, chief, { berries: 5 })
    act(sim, chief, { type: 'set_access', structureId: chest.id, access: 'village' })
    entity(sim, chief).warmth = 0
    drainEvents(sim)

    act(sim, chief, {
      type: 'transfer',
      kind: 'structure',
      containerId: chest.id,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 5,
    })

    expect(chest.inventory![0]).toEqual({ item: 'berries', count: 5 }) // le dépôt a bien eu lieu…
    expect(drainEvents(sim).filter((e) => e.type === 'gift_given')).toEqual([]) // …mais ce n'est pas un don
    expect(entity(sim, chief).warmth).toBe(0)
  })
})

/**
 * `SlotRef.side` n'est qu'un type à la COMPILATION. À l'exécution, seule la sim
 * fait autorité (client hostile, invariant §3) : un `side` qui ment doit être
 * REFUSÉ, pas seulement comparé à l'autre. Sinon il saute `hasAccess` et se fait
 * traiter comme le conteneur — deux failles rouvertes par la même porte.
 */
describe('transfer — un `side` hors des valeurs légales (anti-cheat)', () => {
  it('un `side` bidon ne VOLE pas un coffre privé (hasAccess reste consulté)', () => {
    const { sim, chief, stranger, chest } = chestSim()
    grantItems(sim, chief, { stone: 3 })
    act(sim, chief, { type: 'deposit', structureId: chest.id, item: 'stone', count: 3 })
    const sac = entity(sim, stranger).inventory
    drainEvents(sim)

    // `from.side` ment : ni 'player' ni 'container'. Il échappe à `from.side === to.side`
    // (≠ tout), SAUTE la garde de retrait `from.side === 'container'` (donc hasAccess
    // n'est jamais consulté), et se fait traiter comme le CONTENEUR par `srcInv`.
    act(
      sim,
      stranger,
      forge({
        type: 'transfer',
        kind: 'structure',
        containerId: chest.id,
        from: { side: 'voleur', slot: 0 },
        to: { side: 'player', slot: 0 },
        count: 3,
      }),
    )

    expect(rejections(sim)).toEqual(['case invalide'])
    expect(chest.inventory![0]).toEqual({ item: 'stone', count: 3 }) // rien n'a été volé
    expect(countOf(sac, 'stone')).toBe(0)
  })

  it('un `side` bidon versant sur la MÊME case ne crédite pas un don FANTÔME', () => {
    // Un grenier étranger (accès village) avec des baies : `creditForeignDeposit`
    // s'y armerait sur un vrai dépôt.
    const sim = makeSim()
    const donor = founder(sim, 10.5, 10.5)
    const chief2 = founder(sim, 70.5, 70.5)
    act(sim, chief2, { type: 'build', structure: 'chest', tx: 71, ty: 70 })
    const granary = structureAt(sim.structures, 71, 70)!
    act(sim, chief2, { type: 'set_access', structureId: granary.id, access: 'village' })
    granary.inventory![0] = { item: 'berries', count: 5 } // stackSize('berries') = 10, il reste de la place
    const me = entity(sim, donor)
    me.x = 71.5
    me.y = 71.4
    me.warmth = 0
    drainEvents(sim)

    // `from.side` ment ET vise la MÊME case que `to.side='container'` : `srcInv` et
    // `dstInv` deviennent tous deux le grenier, `pourOntoSlot` verse une pile sur
    // elle-même (put > 0, rien de NET ne bouge), et `moved > 0` déclenche un don.
    act(
      sim,
      donor,
      forge({
        type: 'transfer',
        kind: 'structure',
        containerId: granary.id,
        from: { side: 'voleur', slot: 0 },
        to: { side: 'container', slot: 0 },
        count: 5,
      }),
    )

    const events = drainEvents(sim)
    expect(events.filter((e) => e.type === 'gift_given')).toEqual([]) // aucun don n'a eu lieu
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'action_rejected', reason: 'case invalide' }),
    )
    expect(me.warmth).toBe(0) // aucune chaleur créditée
    expect(granary.inventory![0]).toEqual({ item: 'berries', count: 5 }) // le grenier n'a pas bougé
  })

  it('un `to.side` bidon est refusé AVANT tout versement (pas de dépôt silencieux)', () => {
    // `from.side` LÉGAL, `to.side` qui ment : sans borne, `dstInv` retomberait sur le
    // conteneur (`to.side === 'player' ? … : box`) et l'objet filerait dans le coffre
    // — un versement fantôme, hors de toute case visée. Doit être un REFUS net.
    const { sim, chief, chest } = chestSim()
    grantItems(sim, chief, { wood: 5 })
    const sac = entity(sim, chief).inventory
    drainEvents(sim)

    act(
      sim,
      chief,
      forge({
        type: 'transfer',
        kind: 'structure',
        containerId: chest.id,
        from: { side: 'player', slot: 0 },
        to: { side: 'voleur', slot: 0 },
        count: 5,
      }),
    )

    expect(rejections(sim)).toEqual(['case invalide'])
    expect(countOf(sac, 'wood')).toBe(5) // le bois est resté au sac
    expect(chest.inventory!.every((s) => s === null)).toBe(true) // rien n'est tombé dans le coffre
  })
})
