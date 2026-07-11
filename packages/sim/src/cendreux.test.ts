import { describe, it, expect } from 'vitest'
import { BALANCE, COMBAT, MONSTER_DEFS, CENDREUX, SLOTS } from './balance'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { countOf, inventoryOf } from './items'
import { die } from './combat'
import { advanceCendreux } from './cendreux'
import { spawnMonster, advanceMonsters } from './monsters'
import { DAY_TICKS_PER_CYCLE } from './time'
import { grantItems } from './village'
import { foundNpcVillage } from './worldgen'

function tick(state: SimState, inputs: MoveInput[] = []): void {
  step(state, inputs)
}

/** Attaque et laisse le wind-up se résoudre — même montage que combat.test.ts. */
function strike(state: SimState, attackerId: number, dx: number, dy: number): void {
  tick(state, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }])
  for (let t = 0; t < COMBAT.WINDUP_TICKS; t++) tick(state)
  for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(state)
}

describe('type cendreux (fondation)', () => {
  it('MONSTER_DEFS.cendreux : PV bas, dégâts hauts, très lent', () => {
    const d = MONSTER_DEFS.cendreux
    expect(d.hp).toBe(20) // 2 coups d'arme basique
    expect(d.damage).toBe(34) // 3 coups tuent un avatar 100 PV
    expect(d.speed).toBeLessThan(2) // très lent (joueur = 4)
  })
  it('constantes CENDREUX présentes', () => {
    expect(CENDREUX.WITNESS_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.HEARTH_WARD_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.RISE_DELAY).toBeGreaterThan(0)
    expect(CENDREUX.WARMTH_SEEK_RANGE).toBeGreaterThan(0)
  })
})

function humanAt(state: SimState, x: number, y: number) {
  const id = spawnEntity(state, x, y)
  const e = state.entities.find((en) => en.id === id)!
  return e
}

describe('la levée — critère à la mort', () => {
  it('mort cold, seul, loin d\'un feu → cadavre marqué risesAt', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 5) < 1 && Math.abs(c.y - 5) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })
  it('mort cold mais un feu à portée → pas de marquage', () => {
    const state = createSim(1)
    state.structures.push({ type: 'fire', tx: 5, ty: 5, villageId: 0 } as never)
    const e = humanAt(state, 6, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)
    expect(corpse).toBeUndefined()
  })
  it('mort non-cold → pas de marquage', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0) // combat
    expect(state.corpses.find((c) => c.risesAt !== undefined)).toBeUndefined()
  })
})

describe('le réveil', () => {
  it('à risesAt : un cendreux naît, porte le loot, le cadavre disparaît, event émis', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    e.inventory = inventoryOf(SLOTS.PLAYER, { berries: 3 })
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.tick = corpse.risesAt!
    state.events.length = 0
    advanceCendreux(state)
    const risen = state.monsters.find((m) => m.type === 'cendreux')
    expect(risen).toBeDefined()
    const ent = state.entities.find((en) => en.id === risen!.entityId)!
    expect(countOf(ent.inventory, 'berries')).toBe(3) // loot hérité
    expect(state.corpses.find((c) => c.id === corpse.id)).toBeUndefined()
    expect(state.events.some((ev) => ev.type === 'cendreux_risen')).toBe(true)
  })
  it('annulation : un feu à portée au réveil → pas de cendreux', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.structures.push({ type: 'fire', tx: 5, ty: 5, villageId: 0 } as never) // veillé
    state.tick = corpse.risesAt!
    advanceCendreux(state)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeUndefined()
    expect(state.corpses.find((c) => c.id === corpse.id)?.risesAt).toBeUndefined()
  })
})

describe('intégration Cendreux', () => {
  it('stats : meurt en 2 coups de hache (10), tue un avatar 100 PV en 3 coups', () => {
    expect(Math.ceil(MONSTER_DEFS.cendreux.hp / 10)).toBe(2) // 2 coups d'arme basique (hache 10)
    expect(Math.ceil(100 / MONSTER_DEFS.cendreux.damage)).toBe(3) // 3 coups sur 100 PV
  })
  it('zombie inchangé (aggro + errance)', () => {
    const state = createSim(1)
    const id = spawnMonster(state, 'zombie', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    humanAt(state, 7, 5)
    advanceMonsters(state)
    expect(monster.targetId).not.toBeNull() // aggro comme avant
  })
})

describe('IA cendreux (jour/nuit)', () => {
  it('jour, sans proie → immobile', () => {
    const state = createSim(1) // tick 0 = jour
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const ent = state.entities.find((e) => e.id === id)!
    const x0 = ent.x, y0 = ent.y
    for (let i = 0; i < 40; i++) advanceMonsters(state)
    expect(ent.x).toBe(x0); expect(ent.y).toBe(y0) // dormant
  })
  it('jour, une proie en vue → se rapproche (chemin posé)', () => {
    const state = createSim(1)
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    humanAt(state, 8, 5) // proie dans aggroRange 5
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
  })
  it('nuit → dérive vers une source de chaleur (feu) dans le rayon', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    state.structures.push({ type: 'fire', tx: 15, ty: 5, villageId: 0 } as never) // dans WARMTH_SEEK_RANGE 20
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
  })
})

describe('le critère « allié » — branche village de willRiseAsCendreux', () => {
  // Un village PNJ pose un Feu (ward 12) à (12,12) : on déplace la mort et
  // l'allié loin de là (>12) pour isoler la branche « seul », jamais exercée
  // par les tests ci-dessus (qui ne montent jamais de village).

  it('un allié vivant du même village à portée (WITNESS_RADIUS) empêche la levée', () => {
    const state = createSim(1)
    foundNpcVillage(state, 12, 12, 2) // Feu en (12,12), ward 12
    const dier = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    const ally = state.entities.find((e) => e.id === state.npcs[1]!.entityId)!
    dier.x = 200; dier.y = 200 // loin de tout feu (>> HEARTH_WARD_RADIUS)
    ally.x = 204; ally.y = 200 // distance 4 <= WITNESS_RADIUS (8) : témoin vivant
    die(state, dier, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 200) < 1 && Math.abs(c.y - 200) < 1)
    expect(corpse?.risesAt).toBeUndefined() // pas seul → pas de levée
  })

  it('même montage mais l\'allié est hors WITNESS_RADIUS → cadavre marqué', () => {
    const state = createSim(1)
    foundNpcVillage(state, 12, 12, 2)
    const dier = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    const ally = state.entities.find((e) => e.id === state.npcs[1]!.entityId)!
    dier.x = 200; dier.y = 200
    ally.x = 220; ally.y = 200 // distance 20 > WITNESS_RADIUS (8)
    die(state, dier, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 200) < 1 && Math.abs(c.y - 200) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })

  it('même montage mais l\'allié est déjà mort (hp 0) → ne compte pas comme témoin', () => {
    const state = createSim(1)
    foundNpcVillage(state, 12, 12, 2)
    const dier = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    const ally = state.entities.find((e) => e.id === state.npcs[1]!.entityId)!
    dier.x = 200; dier.y = 200
    ally.x = 204; ally.y = 200 // à portée, mais...
    ally.hp = 0 // ...mort : ne fait plus office de témoin
    die(state, dier, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 200) < 1 && Math.abs(c.y - 200) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })
})

describe('le critère « joueur » (A7) — respawn au Feu ET cadavre marqué au lieu de la mort', () => {
  it('un joueur membre du village, seul, loin du Feu, meurt de froid : les deux effets à la fois', () => {
    const state = createSim(1)
    const village = foundNpcVillage(state, 12, 12, 1) // 1 PNJ, reste près du Feu
    const player = spawnEntity(state, 200, 200)
    village.memberIds.push(player) // le joueur devient membre du village
    const entity = state.entities.find((e) => e.id === player)!
    const deathX = entity.x
    const deathY = entity.y

    die(state, entity, 0, 'cold')

    // Effet 1 : respawn au Feu du village, PV de respawn.
    const respawned = state.entities.find((e) => e.id === player)!
    expect(respawned.x).toBe(village.fireTx + 0.5)
    expect(respawned.y).toBe(village.fireTy + 0.5)
    expect(respawned.hp).toBe(COMBAT.RESPAWN_HP)
    // Effet 2 : un cadavre marqué existe là où le joueur est mort (pas au Feu).
    const corpse = state.corpses.find((c) => Math.abs(c.x - deathX) < 1 && Math.abs(c.y - deathY) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })
})

describe('tuer un Cendreux : 2 coups d\'arme basique, cadavre + loot redéposé (critères 6, 8)', () => {
  it('un Cendreux levé (loot hérité) survit à 1 coup de hache, meurt au 2e, redépose le loot', () => {
    const state = createSim(1)
    // Un PNJ (pas un joueur) : à sa mort il est retiré pour de bon (spec R10),
    // donc pas de respawn qui viendrait traîner près du site et fausser le
    // pipeline de coups réel plus bas (qui frappe toute entité à portée/arc).
    foundNpcVillage(state, 12, 12, 1) // Feu en (12,12), ward 12
    const human = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    human.x = 200; human.y = 200 // loin de tout feu et de tout témoin (spec levée « seul »)
    human.inventory = inventoryOf(SLOTS.NPC, { berries: 3 })
    die(state, human, 0, 'cold')
    const originalCorpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.tick = originalCorpse.risesAt!
    advanceCendreux(state)
    const risen = state.monsters.find((m) => m.type === 'cendreux')!
    const cendreuxEnt = state.entities.find((en) => en.id === risen.entityId)!
    expect(countOf(cendreuxEnt.inventory, 'berries')).toBe(3) // loot hérité (déjà couvert, ici en contexte)
    expect(cendreuxEnt.hp).toBe(MONSTER_DEFS.cendreux.hp) // 20

    // Un attaquant armé d'une hache (iron_axe, 10 dégâts) à portée de corps-à-
    // corps (1 tuile) : le Cendreux est déjà dans son propre MELEE_ENGAGE_RANGE
    // donc il ne se déplace pas — la position reste stable pour les deux coups.
    const attackerId = spawnEntity(state, cendreuxEnt.x + 1, cendreuxEnt.y)
    grantItems(state, attackerId, { iron_axe: 1 })

    // Deux coups via le vrai pipeline de wind-up (`startAttack` + `advanceCombat`
    // résolu dans `step`), pas de l'arithmétique sur constantes. Avant le fix
    // (combat.ts) la régén de PV s'appliquait à tort aux monstres avec un
    // plafond fixe de 100 au lieu de leur PV max propre (20 ici) et grignotait
    // juste assez pendant les deux wind-ups pour empêcher le KO exact.
    const attacker = () => state.entities.find((e) => e.id === attackerId)!
    strike(state, attackerId, cendreuxEnt.x - attacker().x, cendreuxEnt.y - attacker().y)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeDefined() // 1 coup : encore en vie
    expect(cendreuxEnt.hp).toBe(10)

    strike(state, attackerId, cendreuxEnt.x - attacker().x, cendreuxEnt.y - attacker().y)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeUndefined() // 2e coup : mort
    expect(state.entities.find((en) => en.id === cendreuxEnt.id)).toBeUndefined()

    // Le loot hérité du cadavre d'origine est redéposé dans un nouveau cadavre.
    const lootCorpse = state.corpses.find((c) => c.id !== originalCorpse.id && countOf(c.inventory, 'berries') === 3)
    expect(lootCorpse).toBeDefined()
  })
})
