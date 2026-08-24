import { describe, expect, it } from 'vitest'
import { BALANCE, CENDREUX, COOK_SLOT, FIRE, TERRAIN_GRASS } from './balance'
import { addItems, countOf, inventoryOf, makeInventory, stackSize } from './items'
import { willRiseAsCendreux } from './cendreux'
import { drainEvents } from './events'
import { advanceFire, fireState, type FireZone } from './fire'
import { applyInventoryAction } from './inventory-actions'
import { createEmptyMap } from './map'
import { advanceMonsters, spawnMonster } from './monsters'
import { createSim, spawnEntity, type SimState } from './sim'
import { cycleOffsetForStartHour, getGameTime } from './time'
import { baselineTemperature, fireBubble } from './temperature'
import { addStructure, applyStructureDamage, applyVillageAction, grantItems, type Structure } from './village'

/**
 * LE FEU COMME STATION (spec `docs/specs/feu-station.md`) — l'état du feu LIBRE
 * (allumé/braises/éteint), sa combustion (3 SLOTS de bois, brûlés une bûche à la fois), la cuisson
 * (3 ENTRÉES → 3 SORTIES), et le fait que ses bénéfices SUIVENT son état. Rapide, déterministe,
 * seed + inputs → état. La combustion se déclenche à `tick >= burnAt + BURN_TICKS` ; pour l'éprouver
 * sans avancer le tick, on place `burnAt` dans le PASSÉ (bûche déjà à échéance).
 */
function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
}
const ent = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!
/** Met N bûches dans les slots combustible du feu. */
function wood(fire: Structure, n: number): void {
  fire.fuel = makeInventory(FIRE.FUEL_SLOTS)
  if (n > 0) addItems(fire.fuel, { wood: n })
}
/** Rend le feu ÉTEINT/en braises : plus de bûche, fenêtre de braises ouverte. */
function douse(sim: SimState, fire: Structure, emberFor = 100): void {
  fire.fuel = makeInventory(FIRE.FUEL_SLOTS)
  delete fire.burnAt
  delete fire.burnSlot
  fire.emberUntil = sim.tick + emberFor
}

// ── Les cases du feu comme CONTENEURS (spec feu-station) : dépôt/retrait/déplacement par `transfer`. ──
const bagSlot = (sim: SimState, id: number, item: string): number =>
  sim.entities.find((e) => e.id === id)!.inventory.findIndex((s) => s?.item === item)
const emptyBag = (sim: SimState, id: number): number =>
  sim.entities.find((e) => e.id === id)!.inventory.findIndex((s) => s === null)
/** Glisser depuis le SAC vers une zone du feu (dépôt). */
function drop(sim: SimState, id: number, fire: Structure, zone: FireZone, toSlot: number, item: string, count: number): void {
  applyInventoryAction(sim, id, {
    type: 'transfer', kind: 'structure', containerId: fire.id,
    from: { side: 'player', slot: bagSlot(sim, id, item) },
    to: { side: 'container', slot: toSlot, zone }, count,
  })
}
/** Glisser d'une zone du feu vers le SAC (retrait). */
function take(sim: SimState, id: number, fire: Structure, zone: FireZone, fromSlot: number, count: number): void {
  applyInventoryAction(sim, id, {
    type: 'transfer', kind: 'structure', containerId: fire.id,
    from: { side: 'container', slot: fromSlot, zone },
    to: { side: 'player', slot: emptyBag(sim, id) }, count,
  })
}

describe('Le Feu-station : combustible & état (spec feu-station, A1)', () => {
  it('A1 — le feu libre naît avec du bois, brûle une bûche, passe en braises, s’éteint ; nourrir rallume', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, owner) // FEU LIBRE (villageId 0), à portée
    expect(countOf(fire.fuel!, 'wood')).toBe(FIRE.FUEL_START_WOOD)
    expect(fireState(sim, fire)).toBe('lit')

    // Une seule bûche, à échéance : un tick de combustion la consomme → braises.
    wood(fire, 1)
    fire.burnAt = sim.tick - FIRE.BURN_TICKS
    drainEvents(sim)
    advanceFire(sim)
    expect(countOf(fire.fuel!, 'wood')).toBe(0)
    expect(fireState(sim, fire)).toBe('ember') // les flammes meurent → braises
    expect(drainEvents(sim).filter((e) => e.type === 'fire_extinguished').length).toBe(1)

    // La fenêtre de braises passée → éteint.
    sim.tick = fire.emberUntil!
    expect(fireState(sim, fire)).toBe('out')

    // Nourrir (quick-feed, feu libre) rallume et referme la fenêtre.
    grantItems(sim, owner, { wood: 3 })
    drainEvents(sim)
    applyVillageAction(sim, owner, { type: 'feed_fire' })
    expect(countOf(fire.fuel!, 'wood')).toBe(3)
    expect(fireState(sim, fire)).toBe('lit')
    expect(fire.emberUntil).toBeUndefined()
    expect(drainEvents(sim).some((e) => e.type === 'fire_relit')).toBe(true)
  })

  it('A1 — l’extinction n’émet fire_extinguished qu’UNE fois, jamais en boucle', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    wood(fire, 1)
    fire.burnAt = sim.tick - FIRE.BURN_TICKS // s'éteint dès le 1er tick de combustion
    drainEvents(sim)
    let out = 0
    for (let t = 0; t < 30; t++) {
      advanceFire(sim)
      out += drainEvents(sim).filter((e) => e.type === 'fire_extinguished').length
    }
    expect(out).toBe(1) // une seule bascule — pas de spam tant que le feu reste à sec
    expect(fireState(sim, fire)).toBe('ember')
  })
})

describe('Le Feu-station : les bénéfices suivent l’état (spec feu-station, A2/A3)', () => {
  it('A2 — chaleur pleine allumé, ATTÉNUÉE en braises, NULLE éteint', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    const lit = fireBubble(sim, 10, 10)
    expect(lit).toBeGreaterThan(0)

    douse(sim, fire)
    const ember = fireBubble(sim, 10, 10)
    expect(ember).toBeGreaterThan(0)
    expect(ember).toBeLessThan(lit) // braises = chaleur atténuée (S3)

    sim.tick = fire.emberUntil!
    expect(fireBubble(sim, 10, 10)).toBe(0) // éteint = aucune chaleur
  })

  it('A3 — le rempart anti-levée garde en allumé ET en braises, tombe à l’extinction', () => {
    const sim = makeSim()
    const victim = spawnEntity(sim, 10, 11)
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0) // allumé, à portée de garde
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(false) // veillé par le feu

    douse(sim, fire)
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(false) // les braises gardent encore

    sim.tick = fire.emberUntil!
    expect(willRiseAsCendreux(sim, ent(sim, victim))).toBe(true) // éteint : plus de rempart
  })
})

describe('Le Feu-station : la cuisson 3 entrées → 3 sorties, passive (spec feu-station, A5/A6/A7)', () => {
  const COOK = COOK_SLOT.fire!.raw_meat!.ticks

  it('A5 — la cuisson est PASSIVE : elle avance joueur PARTI, le cuit part en SORTIE, il le reprend', () => {
    const sim = makeSim()
    const cook = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, cook) // allumé (du bois), à portée
    grantItems(sim, cook, { raw_meat: 1 })
    drop(sim, cook, fire, 'cookIn', 0, 'raw_meat', 1) // glissé dans la 1re ENTRÉE
    expect(fire.cookIn?.[0]?.item).toBe('raw_meat')
    expect(fire.cookIn?.[0]?.count).toBe(1)
    expect(countOf(ent(sim, cook).inventory, 'raw_meat')).toBe(0) // sortie du sac

    // Le joueur s'en va LOIN (au-delà d'INTERACT_RANGE) : la cuisson continue quand même.
    ent(sim, cook).x = 60
    ent(sim, cook).y = 60
    drainEvents(sim)
    for (let t = 0; t < COOK; t++) advanceFire(sim)
    expect(fire.cookIn?.[0]).toBeNull() // l'entrée s'est vidée
    expect(countOf(fire.cookOut!, 'cooked_meat')).toBe(1) // le cuit est en SORTIE
    expect(drainEvents(sim).some((e) => e.type === 'meat_cooked')).toBe(true)

    // Il revient et reprend la SORTIE (glissée vers le sac).
    ent(sim, cook).x = 10
    ent(sim, cook).y = 10
    take(sim, cook, fire, 'cookOut', 0, 1)
    expect(fire.cookOut?.[0]).toBeNull()
    expect(countOf(ent(sim, cook).inventory, 'cooked_meat')).toBe(1)
  })

  it('A6 — pas de brûlé : la viande cuite reste au chaud INDÉFINIMENT en sortie', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    fire.cookOut = inventoryOf(FIRE.COOK_OUTPUTS, { cooked_meat: 1 }) // déjà cuite, en sortie
    for (let t = 0; t < 3000; t++) advanceFire(sim)
    expect(countOf(fire.cookOut!, 'cooked_meat')).toBe(1) // ne se dégrade jamais
  })

  it('A7 — la cuisson exige la FLAMME : ni éteint ni braises ne cuisent ; rallumé, ça reprend', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    fire.cookIn = [{ item: 'raw_meat', count: 1 }, null, null] // une unité déjà engagée
    fire.cookRemaining = [10, null, null]
    const start = fire.cookRemaining[0]!

    // ÉTEINT : aucune progression (le compteur se FIGE).
    douse(sim, fire, 5)
    sim.tick = fire.emberUntil! // → 'out'
    advanceFire(sim)
    advanceFire(sim)
    expect(fire.cookRemaining![0]).toBe(start)

    // BRAISES : toujours aucune (S8 exige la flamme).
    fire.emberUntil = sim.tick + 100 // pas de bois, tick < emberUntil → 'ember'
    advanceFire(sim)
    expect(fire.cookRemaining![0]).toBe(start)

    // RALLUMÉ : ça reprend.
    wood(fire, FIRE.FUEL_START_WOOD)
    fire.burnAt = sim.tick
    fire.burnSlot = 0
    delete fire.emberUntil
    advanceFire(sim)
    expect(fire.cookRemaining![0]).toBe(start - 1)
  })

  it('les 3 ENTRÉES cuisent EN PARALLÈLE, chacune UNE unité de sa pile à la fois', () => {
    const sim = makeSim()
    const cook = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, cook)
    grantItems(sim, cook, { raw_meat: 5 })
    drop(sim, cook, fire, 'cookIn', 0, 'raw_meat', 2) // une PILE de 2 dans l'entrée 0
    drop(sim, cook, fire, 'cookIn', 1, 'raw_meat', 1)
    drop(sim, cook, fire, 'cookIn', 2, 'raw_meat', 1)
    expect(fire.cookIn!.map((s) => s?.count ?? 0)).toEqual([2, 1, 1]) // 4 posées, 1 reste au sac
    expect(countOf(ent(sim, cook).inventory, 'raw_meat')).toBe(1)

    drainEvents(sim)
    for (let t = 0; t < COOK; t++) advanceFire(sim) // UNE passe de cuisson
    // Chaque entrée a cuit UNE unité EN PARALLÈLE → 3 cuits ; l'entrée 0 garde sa 2e unité.
    expect(countOf(fire.cookOut!, 'cooked_meat')).toBe(3)
    expect(fire.cookIn![0]?.count).toBe(1)
    expect(fire.cookIn![1]).toBeNull()
    expect(fire.cookIn![2]).toBeNull()
  })
})

describe('Le Feu-station : les cases sont de vrais CONTENEURS + verrou de consommation (spec feu-station, A8/A9)', () => {
  it('A8 — le COMBUSTIBLE : on retire le surplus, jamais la bûche qui BRÛLE', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, owner) // 10 bois en case 0, burnSlot 0, allumé
    expect(fire.burnSlot).toBe(0)
    take(sim, owner, fire, 'fuel', 0, 999) // je tire tout ce que je peux
    expect(countOf(fire.fuel!, 'wood')).toBe(1) // la bûche EN COURS reste, verrouillée
    expect(countOf(ent(sim, owner).inventory, 'wood')).toBe(9) // les 9 autres sont à moi
    expect(fireState(sim, fire)).toBe('lit') // il lui reste sa bûche
  })

  it('A8 — la case qui brûle est ANCRÉE : déposer ailleurs ne détourne pas la flamme (dodge)', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, owner)
    // La bûche en cours est en case 1 (case 0 vide), comme après un réagencement.
    fire.fuel = makeInventory(FIRE.FUEL_SLOTS)
    fire.fuel[1] = { item: 'wood', count: 5 }
    fire.burnAt = sim.tick
    fire.burnSlot = 1
    grantItems(sim, owner, { wood: 1 })
    drop(sim, owner, fire, 'fuel', 0, 'wood', 1) // je dépose 1 bois en case 0 (froide)
    advanceFire(sim) // un tick : la flamme ne DÉMÉNAGE pas en case 0
    expect(fire.burnSlot).toBe(1)
    take(sim, owner, fire, 'fuel', 0, 9) // la case 0 (froide) part ENTIÈREMENT
    expect(fire.fuel![0]).toBeNull()
    take(sim, owner, fire, 'fuel', 1, 9) // la case 1 (en feu) garde SA bûche
    expect(fire.fuel![1]?.count).toBe(1)
  })

  it('A9 — les ENTRÉES : on récupère la pile SAUF l’unité qui cuit', () => {
    const sim = makeSim()
    const cook = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, cook)
    grantItems(sim, cook, { raw_meat: 3 })
    drop(sim, cook, fire, 'cookIn', 0, 'raw_meat', 3)
    advanceFire(sim) // une unité s'engage → verrou posé
    expect(fire.cookRemaining![0]).not.toBeNull()
    take(sim, cook, fire, 'cookIn', 0, 3) // je veux tout reprendre
    expect(fire.cookIn![0]?.count).toBe(1) // celle qui cuit reste
    expect(countOf(ent(sim, cook).inventory, 'raw_meat')).toBe(2)
  })

  it('A9 — cases SPÉCIALISÉES : le combustible refuse la viande, l’ENTRÉE refuse le bois', () => {
    const sim = makeSim()
    const p = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, p)
    grantItems(sim, p, { raw_meat: 1, wood: 1 })
    drop(sim, p, fire, 'fuel', 1, 'raw_meat', 1) // viande dans le COMBUSTIBLE : refusé
    expect(countOf(ent(sim, p).inventory, 'raw_meat')).toBe(1) // rien n'a bougé
    drop(sim, p, fire, 'cookIn', 0, 'wood', 1) // bois dans l'ENTRÉE : refusé
    expect(countOf(ent(sim, p).inventory, 'wood')).toBe(1)
    expect(fire.cookIn?.[0] == null).toBe(true)
  })

  it('A9 — un FOYER n’a PAS de zone combustible : y glisser du bois est refusé (S16)', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const foyer = addStructure(sim, 'fire', 10, 10, 1, owner) // villageId 1 = Foyer (upkeep village.fuel)
    grantItems(sim, owner, { wood: 1 })
    drop(sim, owner, foyer, 'fuel', 0, 'wood', 1)
    expect(countOf(ent(sim, owner).inventory, 'wood')).toBe(1) // refusé : le Foyer tient sur village.fuel
    expect(foyer.fuel).toBeUndefined()
  })

  it('A17 — SORTIES pleines : l’unité reste PRÊTE, aucun cuit dupliqué ni perdu (conservation)', () => {
    const sim = makeSim()
    const cook = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, cook)
    // Sorties saturées (3 cases × la pile max) : plus AUCUNE place.
    const full = FIRE.COOK_OUTPUTS * stackSize('cooked_meat')
    fire.cookOut = inventoryOf(FIRE.COOK_OUTPUTS, { cooked_meat: full })
    grantItems(sim, cook, { raw_meat: 3 })
    drop(sim, cook, fire, 'cookIn', 0, 'raw_meat', 3)
    const dur = COOK_SLOT.fire!.raw_meat!.ticks
    for (let t = 0; t < dur * 5; t++) advanceFire(sim) // de quoi cuire plusieurs fois si ça débordait
    expect(countOf(fire.cookOut!, 'cooked_meat')).toBe(full) // PAS d'inflation : rien ne sort tant que c'est plein
    expect(fire.cookIn![0]?.count).toBe(3) // les 3 crus RESTENT (l'unité en tête reste PRÊTE, jamais consumée dans le vide)
  })
})

describe('Le Feu-station : le feu ATTIRE les Cendreux quand il fait froid (spec feu-station, A4)', () => {
  /**
   * LE CADRAN DU CENDREUX EST LA TEMPÉRATURE, PAS L'HORLOGE — et depuis que le socle est une
   * COURBE du jour de l'année (`saisons.md` S4), l'heure seule ne dit plus s'il fait froid : la
   * nuit du cœur de l'Ardeur est à +20 °C, très au-dessus de `CONVERGE_SOUS`, tandis que le
   * cœur du Grand Froid mord même à midi. Les trois montages nomment donc leur JOUR ET leur
   * heure, et chacun PROUVE son climat avant de juger le chemin.
   */
  const coeurDe = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + Math.round(BALANCE.ACT_DAYS / 2)
  /** Minuit au cœur du Grand Froid : la nuit la plus franche de l'année. */
  const nightSim = (): SimState =>
    createSim(1, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      jourDeDepart: coeurDe(4),
      cycleOffset: cycleOffsetForStartHour(0),
    })

  it('A4 — la NUIT du Grand Froid, un Cendreux chemine vers un feu ALLUMÉ à portée', () => {
    const sim = nightSim()
    expect(getGameTime(sim).isNight).toBe(true)
    expect(baselineTemperature(sim, 5, 5)).toBeLessThan(CENDREUX.TORPEUR.CONVERGE_SOUS) // le froid mord
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    addStructure(sim, 'fire', 15, 5, 0, 0) // feu libre avec bois (allumé), dans WARMTH_SEEK_RANGE (20)
    advanceMonsters(sim)
    expect(monster.path?.length ?? 0).toBeGreaterThan(0) // il rampe vers le phare
  })

  it('A4 — un feu ÉTEINT n’est PAS un phare : il n’attire pas', () => {
    const sim = nightSim()
    expect(baselineTemperature(sim, 5, 5)).toBeLessThan(CENDREUX.TORPEUR.CONVERGE_SOUS) // même froid, seul le feu change
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    const fire = addStructure(sim, 'fire', 15, 5, 0, 0)
    douse(sim, fire, 0) // pas de bois, emberUntil = tick → 'out'
    advanceMonsters(sim)
    expect(monster.path?.length ?? 0).toBe(0)
  })

  it('A4 — de JOUR en zone TEMPÉRÉE (pas froid), aucun appel vers le feu', () => {
    // MIDI AU CŒUR DE L'ARDEUR : l'heure ne suffit plus. Le tick 0 porte le plein écart de
    // nuit (`partDeNuit` : l'aube est le fond du froid), et un midi d'Éclosion est encore à
    // +8 °C, pile sur le seuil. Ce cas veut le jour franchement TEMPÉRÉ — l'été à +26.
    const sim = createSim(1, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      jourDeDepart: coeurDe(2),
      cycleOffset: cycleOffsetForStartHour(12),
    })
    expect(getGameTime(sim).isNight).toBe(false)
    expect(baselineTemperature(sim, 5, 5)).toBeGreaterThan(CENDREUX.TORPEUR.CONVERGE_SOUS) // il fait doux
    const id = spawnMonster(sim, 'cendreux', 5, 5)
    const monster = sim.monsters.find((m) => m.entityId === id)!
    addStructure(sim, 'fire', 15, 5, 0, 0) // allumé, mais il fait chaud → pas de phare
    advanceMonsters(sim)
    expect(monster.path?.length ?? 0).toBe(0)
  })
})

describe('Le Feu-station : nourrir un feu CIBLÉ par le modal (spec feu-station, S15)', () => {
  it('feed_fire { structureId } alimente CE feu libre et le rallume depuis les braises', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10, 10)
    const fire = addStructure(sim, 'fire', 10, 10, 0, owner)
    douse(sim, fire) // en braises
    grantItems(sim, owner, { wood: 5 })
    drainEvents(sim)
    applyVillageAction(sim, owner, { type: 'feed_fire', structureId: fire.id })
    expect(countOf(fire.fuel!, 'wood')).toBe(5) // CE feu, celui du modal, est nourri
    expect(fire.emberUntil).toBeUndefined() // rallumé
    expect(drainEvents(sim).some((e) => e.type === 'fire_relit' && e.structureId === fire.id)).toBe(true)
  })

  it('feed_fire { structureId } vise le BON feu même quand un autre est plus proche', () => {
    const sim = makeSim()
    const owner = spawnEntity(sim, 10.5, 10.5)
    const proche = addStructure(sim, 'fire', 10, 10, 0, owner) // le plus proche (distSq 0)
    const cible = addStructure(sim, 'fire', 11, 10, 0, owner) // celui qu'on a ouvert (à portée)
    wood(proche, 5)
    wood(cible, 5)
    grantItems(sim, owner, { wood: 5 })
    applyVillageAction(sim, owner, { type: 'feed_fire', structureId: cible.id })
    expect(countOf(cible.fuel!, 'wood')).toBeGreaterThan(5) // c'est LA CIBLE qui monte
    expect(countOf(proche.fuel!, 'wood')).toBe(5) // pas le plus proche
  })
})

describe('Le Feu-station : destructibilité découplée du combustible (spec feu-station, A11)', () => {
  it('A11 — un feu LIBRE allumé reste destructible (pas d’invulnérabilité liée au combustible)', () => {
    const sim = makeSim()
    const fire = addStructure(sim, 'fire', 10, 10, 0, 0)
    expect(countOf(fire.fuel!, 'wood')).toBeGreaterThan(0)
    applyStructureDamage(sim, fire.id, 99999, 0)
    expect(sim.structures.some((s) => s.id === fire.id)).toBe(false) // il tombe malgré le combustible
  })
})
