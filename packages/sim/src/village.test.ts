import { describe, expect, it } from 'vitest'
import { seasonActFactor } from './alignment'
import { ALIGNMENT, BALANCE, COMBAT, FOOD_VALUES, SLOTS, TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { countOf, inventoryOf } from './items'
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

describe('la vraisemblance des actions (anti-cheat, GDD §11)', () => {
  it('bâtir et démolir exigent d’être à portée', () => {
    const sim = makeSim()
    const id = founder(sim, 10.5, 10.5)
    drainEvents(sim)
    // Dans le rayon du Feu mais hors de portée de bras : refusé.
    act(sim, id, { type: 'build', structure: 'wall', tx: 10 + BALANCE.BUILD_RANGE + 2, ty: 10 })
    expect(rejections(sim)).toEqual(['trop loin'])
    // À portée : accepté. Puis on s'éloigne : la démolition est refusée.
    act(sim, id, { type: 'build', structure: 'wall', tx: 12, ty: 10 })
    const wall = structureAt(sim.structures, 12, 10)!
    sim.entities[0]!.x = 12.5 + BALANCE.BUILD_RANGE + 1
    act(sim, id, { type: 'demolish', structureId: wall.id })
    expect(rejections(sim)).toEqual(['trop loin'])
    expect(structureAt(sim.structures, 12, 10)).toBeDefined()
  })

  it('le Chef qui démolit le mur d’un membre rembourse le PROPRIÉTAIRE', () => {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 10.5)
    const member = spawnEntity(sim, 10.8, 10.5)
    act(sim, chief, { type: 'invite', targetEntityId: member })
    grantItems(sim, member, { wood: 2 })
    act(sim, member, { type: 'build', structure: 'wall', tx: 13, ty: 10 })
    const wall = structureAt(sim.structures, 13, 10)!
    drainEvents(sim)
    const chiefWoodBefore = countOf(sim.entities.find((e) => e.id === chief)!.inventory, 'wood')
    act(sim, chief, { type: 'demolish', structureId: wall.id })
    expect(structureAt(sim.structures, 13, 10)).toBeUndefined()
    // floor(2 × 0.5) = 1 bois — au propriétaire, pas au démolisseur.
    expect(countOf(sim.entities.find((e) => e.id === member)!.inventory, 'wood')).toBe(1)
    expect(countOf(sim.entities.find((e) => e.id === chief)!.inventory, 'wood')).toBe(chiefWoodBefore)
  })

  it('set_access exige la portée et émet access_changed', () => {
    const sim = makeSim()
    const id = founder(sim, 10.5, 10.5)
    act(sim, id, { type: 'build', structure: 'chest', tx: 12, ty: 10 })
    const chest = structureAt(sim.structures, 12, 10)!
    drainEvents(sim)
    // Trop loin de la serrure : refusé, l'accès ne change pas.
    act(sim, id, { type: 'set_access', structureId: chest.id, access: 'public' })
    expect(rejections(sim)).toEqual(['trop loin'])
    expect(chest.access).toBe('private')
    // À portée : changé, et le fait est un événement de domaine.
    sim.entities[0]!.x = 12.0
    act(sim, id, { type: 'set_access', structureId: chest.id, access: 'public' })
    expect(chest.access).toBe('public')
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'access_changed' && e.structureId === chest.id && e.access === 'public')).toBe(true)
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

/**
 * Le sac est BORNÉ (spec inventaire) : tout transfert peut désormais ne pas
 * tenir. Le critère A21 est absolu — « aucun item ne se crée ni ne se détruit ».
 * Ces tests tiennent les quatre transferts du village contre cette règle.
 */
describe('la conservation des items (A21)', () => {
  const entity = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!
  /** Un sac de joueur SANS un seul interstice : ni case libre, ni pile incomplète. */
  const fullBag = () => inventoryOf(SLOTS.PLAYER, { wood: 20 * SLOTS.PLAYER })

  function chestSim() {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 10.5)
    act(sim, chief, { type: 'build', structure: 'chest', tx: 11, ty: 10 })
    const chestId = structureAt(sim.structures, 11, 10)!.id
    drainEvents(sim)
    return { sim, chief, chestId }
  }

  it('démolir avec un sac plein : le remboursement se RÉPAND au sol, il ne s’évapore pas', () => {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 10.5)
    act(sim, chief, { type: 'build', structure: 'wall', tx: 12, ty: 10 })
    const wall = structureAt(sim.structures, 12, 10)!.id
    entity(sim, chief).inventory = fullBag() // plus une case
    drainEvents(sim)
    const t0 = sim.tick

    act(sim, chief, { type: 'demolish', structureId: wall })

    expect(structureAt(sim.structures, 12, 10)).toBeUndefined()
    expect(countOf(entity(sim, chief).inventory, 'wood')).toBe(20 * SLOTS.PLAYER) // rien n'est rentré
    // …donc le bois du remboursement (floor(2 × 0.5) = 1) gît sur la tuile démolie.
    const corpse = sim.corpses.find((c) => c.x === 12.5 && c.y === 10.5)
    expect(corpse).toBeDefined()
    expect(countOf(corpse!.inventory, 'wood')).toBe(1)
    expect(corpse!.decayAt).toBe(t0 + COMBAT.CORPSE_TICKS)
  })

  it('déposer dans un coffre plein : refus, et le stock reste à la source', () => {
    const { sim, chief, chestId } = chestSim()
    const chest = sim.structures.find((s) => s.id === chestId)!
    chest.inventory = inventoryOf(SLOTS.CHEST, { stone: 20 * SLOTS.CHEST })
    grantItems(sim, chief, { berries: 10 })
    drainEvents(sim)

    act(sim, chief, { type: 'deposit', structureId: chestId, item: 'berries', count: 10 })

    expect(rejections(sim)).toEqual(['destination pleine'])
    expect(countOf(entity(sim, chief).inventory, 'berries')).toBe(10)
    expect(countOf(chest.inventory!, 'berries')).toBe(0)
  })

  it('déposer plus que la place : on ne transfère que ce qui rentre, le reste RESTE', () => {
    const { sim, chief, chestId } = chestSim()
    const chest = sim.structures.find((s) => s.id === chestId)!
    // 23 cases de pierre + une pile de baies à 7/10 → place réelle : 3 baies.
    chest.inventory = inventoryOf(SLOTS.CHEST, { stone: 20 * (SLOTS.CHEST - 1), berries: 7 })
    grantItems(sim, chief, { berries: 10 })
    drainEvents(sim)

    act(sim, chief, { type: 'deposit', structureId: chestId, item: 'berries', count: 10 })

    expect(countOf(chest.inventory!, 'berries')).toBe(10) // 7 + 3
    expect(countOf(entity(sim, chief).inventory, 'berries')).toBe(7) // 10 − 3 : rien ne s'évapore
  })

  it('retirer d’un coffre avec un sac plein : refus, le coffre garde tout', () => {
    const { sim, chief, chestId } = chestSim()
    const chest = sim.structures.find((s) => s.id === chestId)!
    act(sim, chief, { type: 'deposit', structureId: chestId, item: 'wood', count: 5 })
    entity(sim, chief).inventory = fullBag()
    // Le sac est plein de bois… mais en piles PLEINES : pas un interstice.
    drainEvents(sim)

    act(sim, chief, { type: 'withdraw', structureId: chestId, item: 'wood', count: 5 })

    expect(rejections(sim)).toEqual(['destination pleine'])
    expect(countOf(chest.inventory!, 'wood')).toBe(5)
    expect(countOf(entity(sim, chief).inventory, 'wood')).toBe(20 * SLOTS.PLAYER)
  })

  it('le don au grenier d’un autre village est crédité sur ce qui est VRAIMENT déposé', () => {
    const sim = makeSim()
    const donneur = founder(sim, 10.5, 10.5)
    const chief2 = founder(sim, 70.5, 70.5) // au-delà de FIRE_MIN_DISTANCE
    act(sim, chief2, { type: 'build', structure: 'chest', tx: 71, ty: 70 })
    const granary = structureAt(sim.structures, 71, 70)!
    act(sim, chief2, { type: 'set_access', structureId: granary.id, access: 'village' })
    // Le grenier étranger ne peut plus prendre que 3 baies.
    granary.inventory = inventoryOf(SLOTS.CHEST, { stone: 20 * (SLOTS.CHEST - 1), berries: 7 })

    const moi = entity(sim, donneur)
    moi.x = 71.5
    moi.y = 71.4 // à portée du grenier étranger
    moi.warmth = 0
    grantItems(sim, donneur, { berries: 10 })
    drainEvents(sim)

    act(sim, donneur, { type: 'deposit', structureId: granary.id, item: 'berries', count: 10 })

    const gifts = drainEvents(sim).flatMap((e) => (e.type === 'gift_given' ? [e] : []))
    expect(gifts).toHaveLength(1)
    expect(gifts[0]!.count).toBe(3) // pas 10 : on ne se fait pas créditer d'un don qui n'a pas eu lieu
    // 3 baies créditées, pas 10 (la chaleur du tick suivant a déjà un peu décanté).
    const attendu =
      FOOD_VALUES.berries! * 3 * ALIGNMENT.FOREIGN_DEPOSIT_WARMTH_PER_FOOD * seasonActFactor(sim)
    expect(moi.warmth).toBeCloseTo(attendu, 3)
  })

  it('donner à quelqu’un dont le sac est plein : refus, aucun item ne change de mains', () => {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 10.5)
    const cible = spawnEntity(sim, 10.8, 10.5)
    entity(sim, cible).inventory = fullBag()
    grantItems(sim, chief, { berries: 10 })
    drainEvents(sim)

    act(sim, chief, { type: 'give', targetEntityId: cible, item: 'berries', count: 10 })

    expect(rejections(sim)).toEqual(['le sac de la cible est plein'])
    expect(countOf(entity(sim, chief).inventory, 'berries')).toBe(10)
    expect(countOf(entity(sim, cible).inventory, 'berries')).toBe(0)
  })

  it('donner plus que la place : on ne donne que ce qui rentre, et la chaleur suit', () => {
    const sim = makeSim()
    const chief = founder(sim, 10.5, 10.5)
    const cible = spawnEntity(sim, 10.8, 10.5)
    // 17 cases pleines + une pile de baies à 7/10 → place réelle : 3 baies.
    entity(sim, cible).inventory = inventoryOf(SLOTS.PLAYER, {
      wood: 20 * (SLOTS.PLAYER - 1),
      berries: 7,
    })
    entity(sim, cible).hunger = 100 // faim rassasiée : la chaleur utile est nulle…
    grantItems(sim, chief, { berries: 10 })
    drainEvents(sim)

    act(sim, chief, { type: 'give', targetEntityId: cible, item: 'berries', count: 10 })

    expect(countOf(entity(sim, cible).inventory, 'berries')).toBe(10) // 7 + 3
    expect(countOf(entity(sim, chief).inventory, 'berries')).toBe(7)
    const gifts = drainEvents(sim).flatMap((e) => (e.type === 'gift_given' ? [e] : []))
    expect(gifts[0]?.count).toBe(3) // …mais l'événement dit la vérité : 3 baies
  })
})
