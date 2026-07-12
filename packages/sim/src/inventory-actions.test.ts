import { describe, expect, it } from 'vitest'
import { BALANCE, SLOTS } from './balance'
import { drainEvents } from './events'
import { applyInventoryAction, heldSlot, wearHeld } from './inventory-actions'
import { createSim, spawnEntity, type Entity, type SimState } from './sim'

function playerSim(): { state: SimState; entity: Entity } {
  const state = createSim(1)
  const id = spawnEntity(state, 5, 5)
  return { state, entity: state.entities.find((e) => e.id === id)! }
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
