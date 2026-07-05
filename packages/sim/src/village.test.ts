import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { getVillageOf, grantItems, structureAt } from './village'

/** Carte 96×96 (assez grande pour FIRE_MIN_DISTANCE) avec un landmark. */
function makeSim(): SimState {
  const map = createEmptyMap(96, 96, TERRAIN_GRASS)
  map.zones = [{ name: 'le Pont', x: 60, y: 60, w: 6, h: 6 }]
  return createSim(1, { map })
}

/** Joue un tick avec une seule action, sans déplacement. */
function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

function founder(sim: SimState, x: number, y: number): number {
  const id = spawnEntity(sim, x, y)
  grantItems(sim, id, { wood: 100, stone: 20 })
  act(sim, id, { type: 'light_fire' })
  return id
}

describe('le Feu (A1)', () => {
  it('fonder un village : Chef, Feu posé, bois débité, événement émis', () => {
    const sim = makeSim()
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 10 })
    drainEvents(sim)
    act(sim, id, { type: 'light_fire' })
    const village = getVillageOf(sim, id)
    expect(village?.chiefId).toBe(id)
    expect(structureAt(sim.structures, 10, 10)?.type).toBe('fire')
    expect(countOf(sim.entities[0]!.inventory, 'wood')).toBe(0)
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'village_founded' && e.chiefId === id)).toBe(true)
  })

  it('refuse sans matériaux', () => {
    const sim = makeSim()
    const id = spawnEntity(sim, 10.5, 10.5)
    drainEvents(sim)
    act(sim, id, { type: 'light_fire' })
    expect(rejections(sim)).toEqual(['matériaux insuffisants'])
    expect(sim.villages).toHaveLength(0)
  })

  it('refuse dans un landmark', () => {
    const sim = makeSim()
    const id = spawnEntity(sim, 62.5, 62.5) // dans « le Pont »
    grantItems(sim, id, { wood: 10 })
    drainEvents(sim)
    act(sim, id, { type: 'light_fire' })
    expect(rejections(sim)).toEqual(['les landmarks sont inconstructibles'])
  })

  it('refuse trop près d’un autre Feu, accepte au-delà', () => {
    const sim = makeSim()
    founder(sim, 10.5, 10.5)
    const near = spawnEntity(sim, 30.5, 10.5) // à 20 tuiles < 48
    grantItems(sim, near, { wood: 10 })
    drainEvents(sim)
    act(sim, near, { type: 'light_fire' })
    expect(rejections(sim)).toEqual(['trop proche d’un autre Feu'])
    const far = spawnEntity(sim, 80.5, 80.5) // ~99 tuiles > 48
    grantItems(sim, far, { wood: 10 })
    act(sim, far, { type: 'light_fire' })
    expect(sim.villages).toHaveLength(2)
  })

  it('refuse si déjà membre d’un village', () => {
    const sim = makeSim()
    const id = founder(sim, 10.5, 10.5)
    drainEvents(sim)
    act(sim, id, { type: 'light_fire' })
    expect(rejections(sim)).toEqual(['déjà membre d’un village'])
  })
})

describe('la construction (A2)', () => {
  it('un mur : débité, posé, bloquant', () => {
    const sim = makeSim()
    const id = founder(sim, 10.5, 10.5)
    const before = countOf(sim.entities[0]!.inventory, 'wood')
    act(sim, id, { type: 'build', structure: 'wall', tx: 12, ty: 10 })
    expect(countOf(sim.entities[0]!.inventory, 'wood')).toBe(before - 2)
    expect(structureAt(sim.structures, 12, 10)?.type).toBe('wall')
    // Le mur bloque : marcher vers l'est clampe flush contre lui.
    for (let t = 0; t < 30; t++) step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    expect(sim.entities[0]!.x).toBe(12 - BALANCE.AVATAR_HITBOX_TILES / 2)
  })

  it('refuse hors rayon, tuile occupée, sans matériaux, sans village', () => {
    const sim = makeSim()
    const id = founder(sim, 10.5, 10.5)
    drainEvents(sim)
    act(sim, id, { type: 'build', structure: 'wall', tx: 10 + BALANCE.FIRE_BUILD_RADIUS + 2, ty: 10 })
    act(sim, id, { type: 'build', structure: 'wall', tx: 10, ty: 10 }) // sur le Feu
    const poor = spawnEntity(sim, 12.5, 12.5)
    act(sim, poor, { type: 'build', structure: 'wall', tx: 13, ty: 13 })
    expect(rejections(sim)).toEqual([
      'hors du rayon du Feu',
      'tuile occupée',
      'sans village — allumer un Feu d’abord',
    ])
  })
})

describe('la porte (A3)', () => {
  function doorSim() {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 12.5)
    // Couloir de murs avec une porte en (14, 12).
    act(sim, chief, { type: 'build', structure: 'wall', tx: 14, ty: 11 })
    act(sim, chief, { type: 'build', structure: 'door', tx: 14, ty: 12 })
    act(sim, chief, { type: 'build', structure: 'wall', tx: 14, ty: 13 })
    return { sim, chief }
  }

  const tryCross = (sim: SimState, id: number): number => {
    const e = sim.entities.find((en) => en.id === id)!
    e.x = 13.2
    e.y = 12.5
    for (let t = 0; t < 40; t++) step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    return e.x
  }

  it('membre : passe ; étranger : bloqué ; invité : passe ; banni : bloqué', () => {
    const { sim, chief } = doorSim()
    expect(tryCross(sim, chief)).toBeGreaterThan(15)

    const stranger = spawnEntity(sim, 11.5, 12.5)
    expect(tryCross(sim, stranger)).toBe(14 - BALANCE.AVATAR_HITBOX_TILES / 2)

    // Invitation (à portée du Chef), puis la porte s'ouvre.
    sim.entities[0]!.x = 11.5
    sim.entities[0]!.y = 12.5
    sim.entities.find((e) => e.id === stranger)!.x = 11.8
    sim.entities.find((e) => e.id === stranger)!.y = 12.5
    act(sim, chief, { type: 'invite', targetEntityId: stranger })
    expect(getVillageOf(sim, stranger)).toBeDefined()
    expect(tryCross(sim, stranger)).toBeGreaterThan(15)

    // Bannissement : la serrure obéit au tick suivant.
    act(sim, chief, { type: 'banish', targetEntityId: stranger })
    expect(getVillageOf(sim, stranger)).toBeUndefined()
    expect(tryCross(sim, stranger)).toBe(14 - BALANCE.AVATAR_HITBOX_TILES / 2)
  })
})

describe('le coffre (A4)', () => {
  function chestSim() {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 10.5)
    act(sim, chief, { type: 'build', structure: 'chest', tx: 11, ty: 10 })
    const chestId = structureAt(sim.structures, 11, 10)!.id
    const member = spawnEntity(sim, 10.8, 10.5)
    act(sim, chief, { type: 'invite', targetEntityId: member })
    grantItems(sim, member, { wood: 10 })
    drainEvents(sim)
    return { sim, chief, member, chestId }
  }

  it('dépôt/retrait par le propriétaire ; privé pour les autres ; village après partage', () => {
    const { sim, chief, member, chestId } = chestSim()
    act(sim, chief, { type: 'deposit', structureId: chestId, item: 'wood', count: 5 })
    const chest = sim.structures.find((s) => s.id === chestId)!
    expect(countOf(chest.inventory!, 'wood')).toBe(5)

    act(sim, member, { type: 'withdraw', structureId: chestId, item: 'wood', count: 1 })
    expect(rejections(sim)).toEqual(['accès refusé'])

    act(sim, chief, { type: 'set_access', structureId: chestId, access: 'village' })
    act(sim, member, { type: 'withdraw', structureId: chestId, item: 'wood', count: 2 })
    expect(countOf(chest.inventory!, 'wood')).toBe(3)
    expect(countOf(sim.entities.find((e) => e.id === member)!.inventory, 'wood')).toBe(12)
  })

  it('l’étranger peut déposer (le don, spec alignement R11) mais jamais retirer', () => {
    const { sim, chief, chestId } = chestSim()
    const stranger = spawnEntity(sim, 11.8, 10.5)
    grantItems(sim, stranger, { wood: 5 })
    drainEvents(sim)
    // Déposer est ouvert : la boîte aux dons.
    act(sim, stranger, { type: 'deposit', structureId: chestId, item: 'wood', count: 1 })
    expect(countOf(sim.structures.find((s) => s.id === chestId)!.inventory!, 'wood')).toBe(1)
    // Retirer reste verrouillé ; portée et quantités toujours contrôlées.
    act(sim, stranger, { type: 'withdraw', structureId: chestId, item: 'wood', count: 1 })
    sim.entities[0]!.x = 20.5 // le chef s'éloigne
    act(sim, chief, { type: 'deposit', structureId: chestId, item: 'wood', count: 1 })
    sim.entities[0]!.x = 10.5
    act(sim, chief, { type: 'deposit', structureId: chestId, item: 'wood', count: -3 })
    expect(rejections(sim)).toEqual(['accès refusé', 'trop loin', 'quantité invalide'])
  })
})

describe('la démolition (A5)', () => {
  it('propriétaire : remboursé 50 % ; Feu : jamais ; non-propriétaire : refusé ; Chef : oui', () => {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 10.5)
    const member = spawnEntity(sim, 10.8, 10.5)
    act(sim, chief, { type: 'invite', targetEntityId: member })
    grantItems(sim, member, { wood: 10 })

    // Le membre bâtit deux murs (2 bois chacun).
    act(sim, member, { type: 'build', structure: 'wall', tx: 13, ty: 10 })
    act(sim, member, { type: 'build', structure: 'wall', tx: 13, ty: 11 })
    const wall1 = structureAt(sim.structures, 13, 10)!.id
    const wall2 = structureAt(sim.structures, 13, 11)!.id
    drainEvents(sim)

    act(sim, member, { type: 'demolish', structureId: wall1 })
    expect(structureAt(sim.structures, 13, 10)).toBeUndefined()
    expect(countOf(sim.entities.find((e) => e.id === member)!.inventory, 'wood')).toBe(7) // 6 + 1 remboursé

    const fireId = sim.structures.find((s) => s.type === 'fire')!.id
    act(sim, member, { type: 'demolish', structureId: fireId })
    expect(rejections(sim)).toEqual(['un Feu ne s’éteint pas'])

    // Un autre membre non-propriétaire : refusé ; le Chef : autorisé.
    const other = spawnEntity(sim, 10.8, 10.5)
    act(sim, chief, { type: 'invite', targetEntityId: other })
    drainEvents(sim)
    act(sim, other, { type: 'demolish', structureId: wall2 })
    expect(rejections(sim)).toEqual(['ni propriétaire ni Chef'])
    act(sim, chief, { type: 'demolish', structureId: wall2 })
    expect(structureAt(sim.structures, 13, 11)).toBeUndefined()
  })
})
