import { describe, expect, it } from 'vitest'
import { BALANCE, FIRE, RECIPES, SLOTS, TERRAIN_GRASS, TORCHE } from './balance'
import { drainEvents } from './events'
import { addItems, makeInventory, type Slot } from './items'
import { applyEconomyAction } from './economy'
import { createEmptyMap } from './map'
import { fireStateAt } from './fire'
import { createSim, spawnEntity, step, type Entity, type SimState } from './sim'
import { advanceTemperature } from './temperature'
import { partDeFlamme, ticksDeFlamme, torcheVive } from './torche'
import { addStructure, applyVillageAction, createVillage, type Structure } from './village'

/**
 * LA TORCHE (spec `docs/specs/torche.md`) — critères T1 à T10.
 *
 * Le cœur de ce fichier n'est PAS l'horloge (un compteur ne surprend personne) : ce sont les
 * TROIS INTERDITS (T9), qui sont la seule raison pour laquelle la torche avait été abandonnée
 * le 2026-07-12, et la seule chose qu'une régression pourrait rouvrir en silence. Une torche qui
 * se mettrait à chauffer ou à repousser ne casserait AUCUN autre test du dépôt.
 */
function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
}
const ent = (sim: SimState, id: number): Entity => sim.entities.find((e) => e.id === id)!
const held = (sim: SimState, id: number): Slot | null => {
  const e = ent(sim, id)
  return e.inventory[e.activeSlot] ?? null
}

/** Un joueur planté au centre, torche ÉTEINTE en main (case 0 de la ceinture). */
function porteur(sim: SimState, item: 'torche' | 'torche_vive' = 'torche'): number {
  // AU CENTRE DE SA TUILE (48,5 · 48,5), comme le jeu place un avatar — et non sur le COIN.
  // Sur le coin, un feu à une tuile tombait à √2,5 du porteur, soit hors du bras (1,5) : le
  // montage inventait un « trop loin » que le jeu ne connaît pas.
  const id = spawnEntity(sim, 48.5, 48.5)
  const e = ent(sim, id)
  e.inventory = makeInventory(SLOTS.PLAYER)
  e.inventory[0] = { item, count: 1, ...(item === 'torche_vive' ? { wear: 0 } : {}) }
  e.activeSlot = 0
  return id
}

/**
 * Un feu LIBRE et allumé (bûche en cours) à `d` tuiles du joueur.
 *
 * ⚠ LIBRE (`villageId` 0) EXPRÈS, et ce n'est pas un détail de montage : `fireStateAt` rend
 * `'lit'` SANS RIEN REGARDER pour tout feu de village (« Foyer : inchangé tant que l'upkeep
 * n'est pas migré », S16). Monté sur un Foyer, ce fichier aurait donc eu trois sondes qui ne
 * peuvent pas échouer — braises, éteint, et le refus qui va avec. C'est aussi le feu du jeu
 * réel dans ce cas d'usage : on prend sa torche au feu de camp qu'on vient de poser.
 */
function feu(sim: SimState, d = 1): Structure {
  const s = addStructure(sim, 'fire', 48 + d, 48, 0, 0)
  s.fuel = makeInventory(FIRE.FUEL_SLOTS)
  addItems(s.fuel, { wood: 3 })
  s.burnAt = sim.tick
  s.burnSlot = 0
  return s
}
/** Le même feu, ramené à l'état demandé. */
function braises(sim: SimState, s: Structure): void {
  s.fuel = makeInventory(FIRE.FUEL_SLOTS)
  delete s.burnAt
  delete s.burnSlot
  s.emberUntil = sim.tick + 1000
}
function eteint(sim: SimState, s: Structure): void {
  braises(sim, s)
  s.emberUntil = sim.tick - 1
}

const allumer = (sim: SimState, id: number, s: Structure): void => {
  applyVillageAction(sim, id, { type: 'light_torch', structureId: s.id })
}
const refus = (sim: SimState): string[] =>
  drainEvents(sim).filter((e) => e.type === 'action_rejected').map((e) => e.reason)

describe('la torche — le craft (T1)', () => {
  it('T1 · se taille à la main, loin de tout, et sort ÉTEINTE', () => {
    expect(RECIPES.torche.requiert).toBeNull()
    const sim = makeSim()
    // AU CENTRE DE SA TUILE (48,5 · 48,5), comme le jeu place un avatar — et non sur le COIN.
  // Sur le coin, un feu à une tuile tombait à √2,5 du porteur, soit hors du bras (1,5) : le
  // montage inventait un « trop loin » que le jeu ne connaît pas.
  const id = spawnEntity(sim, 48.5, 48.5)
    ent(sim, id).inventory = makeInventory(SLOTS.PLAYER)
    addItems(ent(sim, id).inventory, { wood: 1, fiber: 3 })
    applyEconomyAction(sim, id, { type: 'craft', recipeId: 'torche' })
    expect(ent(sim, id).craftQueue.length).toBe(1) // les intrants sont partis, la file tourne
    for (let i = 0; i < 20 * 10; i++) step(sim, [])
    const sac = ent(sim, id).inventory.filter((s) => s !== null).map((s) => s!.item)
    expect(sac).toContain('torche')
    expect(sac).not.toContain('torche_vive') // T-C : jamais craftée allumée
  })
})

describe('la torche — prendre le feu au foyer (T2-T5)', () => {
  it('le montage lui-même est valide : ce feu SAIT être allumé, en braises et mort', () => {
    // La prémisse d'abord (mémoire « une sonde qui ne peut pas échouer ») : sans ça, les trois
    // tests qui suivent seraient verts sur un feu que `fireStateAt` déclare `'lit'` d'office.
    const sim = makeSim()
    const s = feu(sim)
    expect(fireStateAt(sim.tick, s)).toBe('lit')
    braises(sim, s)
    expect(fireStateAt(sim.tick, s)).toBe('ember')
    eteint(sim, s)
    expect(fireStateAt(sim.tick, s)).toBe('out')
  })

  it('T2 · au feu allumé : la MÊME case devient vive, wear à 0, événement émis', () => {
    const sim = makeSim()
    const id = porteur(sim)
    const s = feu(sim)
    const avant = ent(sim, id).inventory[0]
    drainEvents(sim)
    allumer(sim, id, s)
    const apres = ent(sim, id).inventory[0]
    expect(apres).toBe(avant) // la MÊME case-objet : ni échange, ni nouvelle case
    expect(apres?.item).toBe('torche_vive')
    expect(apres?.wear).toBe(0)
    const evts = drainEvents(sim)
    expect(evts.some((e) => e.type === 'torche_allumee' && e.entityId === id && e.structureId === s.id)).toBe(true)
  })

  it('T2bis · le sac PLEIN ne peut pas faire échouer un allumage', () => {
    const sim = makeSim()
    const id = porteur(sim)
    const e = ent(sim, id)
    for (let i = 1; i < e.inventory.length; i++) e.inventory[i] = { item: 'stone', count: 1 }
    allumer(sim, id, feu(sim))
    expect(held(sim, id)?.item).toBe('torche_vive')
  })

  it('T3 · les BRAISES donnent le feu — refuser serait une double peine', () => {
    const sim = makeSim()
    const id = porteur(sim)
    const s = feu(sim)
    braises(sim, s)
    allumer(sim, id, s)
    expect(held(sim, id)?.item).toBe('torche_vive')
  })

  it('T4 · refus : feu éteint, hors de portée, pas un feu, main vide, torche déjà vive', () => {
    // (a) le feu est mort
    let sim = makeSim()
    let id = porteur(sim)
    let s = feu(sim)
    eteint(sim, s)
    drainEvents(sim)
    allumer(sim, id, s)
    expect(held(sim, id)?.item).toBe('torche')
    expect(refus(sim)).toEqual(['ce feu est éteint'])

    // (b) HORS DE PORTÉE — bien au-delà du bras, sans ambiguïté
    sim = makeSim()
    id = porteur(sim)
    s = feu(sim, Math.ceil(BALANCE.INTERACT_RANGE) + 2)
    drainEvents(sim)
    allumer(sim, id, s)
    expect(held(sim, id)?.item).toBe('torche')
    expect(refus(sim)).toEqual(['trop loin'])

    // (c) ce n'est pas un feu
    sim = makeSim()
    id = porteur(sim)
    const village = createVillage(sim, { chiefId: 0, tx: 49, ty: 48, npcsArrived: false })
    const mur = addStructure(sim, 'wall', 49, 48, village.id, 0)
    drainEvents(sim)
    applyVillageAction(sim, id, { type: 'light_torch', structureId: mur.id })
    expect(refus(sim)).toEqual(['pas un feu'])

    // (d) MAINS NUES
    sim = makeSim()
    id = porteur(sim)
    ent(sim, id).activeSlot = -1
    s = feu(sim)
    drainEvents(sim)
    allumer(sim, id, s)
    expect(refus(sim)).toEqual(['pas de torche en main'])

    // (e) elle brûle DÉJÀ — rallumer ne doit pas remettre le compteur à zéro
    sim = makeSim()
    id = porteur(sim, 'torche_vive')
    ent(sim, id).inventory[0]!.wear = 500
    s = feu(sim)
    drainEvents(sim)
    allumer(sim, id, s)
    expect(held(sim, id)?.wear).toBe(500)
    expect(refus(sim)).toEqual(['pas de torche en main'])
  })

  it('T4bis · la portée EST celle du bras — pas une portée à elle (la zone morte de l’heure passée)', () => {
    // La sim a un temps accepté à 2 tuiles quand le client n'offre le geste qu'à 1,5 : entre
    // les deux, le clic ne faisait RIEN et rien ne le disait. Cette garde scelle l'unification —
    // à `INTERACT_RANGE` pile ça passe, un peu au-delà ça refuse.
    const sim = makeSim()
    const id = porteur(sim)
    const s = feu(sim, 1)
    // On se place EXACTEMENT à la portée de bras du centre du feu, puis un cheveu au-delà.
    ent(sim, id).x = s.tx + 0.5 - BALANCE.INTERACT_RANGE
    ent(sim, id).y = s.ty + 0.5
    allumer(sim, id, s)
    expect(held(sim, id)?.item).toBe('torche_vive')

    const loin = makeSim()
    const id2 = porteur(loin)
    const s2 = feu(loin, 1)
    ent(loin, id2).x = s2.tx + 0.5 - BALANCE.INTERACT_RANGE - 0.01
    ent(loin, id2).y = s2.ty + 0.5
    drainEvents(loin)
    allumer(loin, id2, s2)
    expect(held(loin, id2)?.item).toBe('torche')
    expect(refus(loin)).toEqual(['trop loin'])
  })

  it('T5 · prendre le feu ne COÛTE rien au foyer', () => {
    const sim = makeSim()
    const id = porteur(sim)
    const s = feu(sim)
    const avant = JSON.stringify({ fuel: s.fuel, burnAt: s.burnAt, burnSlot: s.burnSlot, ember: s.emberUntil })
    allumer(sim, id, s)
    expect(JSON.stringify({ fuel: s.fuel, burnAt: s.burnAt, burnSlot: s.burnSlot, ember: s.emberUntil })).toBe(avant)
  })
})

describe("la torche — l'horloge (T6-T8)", () => {
  it('T6 · elle meurt EXACTEMENT à BURN_TICKS, et une seule fois', () => {
    const sim = makeSim()
    const id = porteur(sim, 'torche_vive')
    for (let i = 0; i < TORCHE.BURN_TICKS - 1; i++) step(sim, [])
    expect(held(sim, id)?.item).toBe('torche_vive') // encore vive au dernier tick
    drainEvents(sim)
    step(sim, [])
    const slot = held(sim, id)
    expect(slot?.item).toBe('torche') // le fagot reste : c'est la flamme qui est partie
    expect(slot?.count).toBe(1)
    expect(slot?.wear).toBeUndefined()
    expect(drainEvents(sim).filter((e) => e.type === 'torche_eteinte').length).toBe(1)
    // …et elle ne meurt pas deux fois
    for (let i = 0; i < 50; i++) step(sim, [])
    expect(drainEvents(sim).filter((e) => e.type === 'torche_eteinte').length).toBe(0)
  })

  it('T7 · une torche vive AU SAC ne brûle pas — ce qui brûle est ce qu’on voit brûler', () => {
    const sim = makeSim()
    const id = porteur(sim, 'torche_vive')
    const e = ent(sim, id)
    e.inventory[3] = { item: 'torche_vive', count: 1, wear: 0 }
    e.activeSlot = -1 // rien en main : rien ne doit brûler
    for (let i = 0; i < TORCHE.BURN_TICKS + 10; i++) step(sim, [])
    expect(ent(sim, id).inventory[0]?.item).toBe('torche_vive')
    expect(ent(sim, id).inventory[0]?.wear).toBe(0)
    expect(ent(sim, id).inventory[3]?.item).toBe('torche_vive')
    expect(ent(sim, id).inventory[3]?.wear).toBe(0)
  })

  it('T8 · partDeFlamme descend de 1 à 0, monotone, sur TOUTE la combustion', () => {
    const sim = makeSim()
    const id = porteur(sim, 'torche_vive')
    expect(partDeFlamme(held(sim, id))).toBe(1)
    let precedent = 1
    // On échantillonne tout le domaine (pas trois ticks choisis) : une garde de géométrie
    // se balaie, elle ne se pique pas.
    for (let i = 0; i < TORCHE.BURN_TICKS; i++) {
      step(sim, [])
      const p = partDeFlamme(held(sim, id))
      expect(p).toBeLessThanOrEqual(precedent)
      expect(p).toBeGreaterThanOrEqual(0)
      precedent = p
    }
    expect(precedent).toBe(0)
    expect(ticksDeFlamme(held(sim, id))).toBe(0)
    expect(torcheVive(ent(sim, id))).toBeNull() // elle n'est plus vive : plus de lumière
  })
})

describe('la torche — LES TROIS INTERDITS (T9)', () => {
  /**
   * T-A. La garde compare DEUX MONDES IDENTIQUES à un détail près (la torche), et non une
   * température à un seuil : c'est la seule forme qui attrape un terme qu'on AJOUTERAIT plus
   * tard à `advanceTemperature` — un seuil, lui, resterait vert tant que le terme est petit.
   */
  it('T-A · elle ne chauffe pas : même température qu’à mains nues, au bit près', () => {
    const avec = makeSim()
    const idA = porteur(avec, 'torche_vive')
    const sans = makeSim()
    const idB = porteur(sans, 'torche_vive')
    ent(sans, idB).activeSlot = -1 // le SEUL écart : l'un la tient, l'autre non

    for (let i = 0; i < 600; i++) {
      advanceTemperature(avec)
      advanceTemperature(sans)
    }
    expect(ent(avec, idA).temperature).toBe(ent(sans, idB).temperature)
  })

  /**
   * T-B. Idem pour l'agression : on fait tourner DEUX simulations jumelles, seedées à
   * l'identique, dont l'une porte une torche vive — et on compare l'état COMPLET des bêtes.
   * Une meute qui reculerait d'une seule tuile ferait rougir.
   */
  it('T-B · elle ne repousse rien : les bêtes se comportent à l’identique', () => {
    const trace = (torche: boolean): string => {
      const sim = createSim(7, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
      const id = porteur(sim, torche ? 'torche_vive' : 'torche')
      for (let i = 0; i < 400; i++) step(sim, [{ entityId: id, dx: 0, dy: 0 }])
      return JSON.stringify(sim.monsters)
    }
    expect(trace(true)).toBe(trace(false))
  })
})

describe('la torche — déterminisme (T10)', () => {
  it('T10 · craft + allumage + mort de la flamme rejouent au bit près', () => {
    const partie = (): string => {
      const sim = createSim(11, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
      const id = porteur(sim)
      const s = feu(sim)
      for (let i = 0; i < 30; i++) step(sim, [{ entityId: id, dx: 0, dy: 0 }])
      allumer(sim, id, s)
      for (let i = 0; i < TORCHE.BURN_TICKS + 20; i++) step(sim, [{ entityId: id, dx: 0, dy: 0 }])
      return JSON.stringify(sim)
    }
    expect(partie()).toBe(partie())
  })

  it('T10bis · allumer une torche ne DÉCALE PAS le flux seedé du monde', () => {
    // Le monde doit être le MÊME, torche ou pas : le PRNG n'est jamais touché par l'horloge
    // (un compteur entier), ni par l'allumage. C'est le raisonnement de `morts.ts` A28.
    const monde = (allume: boolean): string => {
      const sim = createSim(3, { map: createEmptyMap(96, 96, TERRAIN_GRASS) })
      const id = porteur(sim)
      const s = feu(sim)
      if (allume) allumer(sim, id, s)
      for (let i = 0; i < 500; i++) step(sim, [{ entityId: id, dx: 0, dy: 0 }])
      return JSON.stringify({ rng: sim.rngState, monsters: sim.monsters, nodes: sim.nodes.length })
    }
    expect(monde(true)).toBe(monde(false))
  })
})
