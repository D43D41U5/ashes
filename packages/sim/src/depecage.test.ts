/**
 * LE DÉPEÇAGE (spec `depecage.md`) — la carcasse est un réservoir qu'on ouvre en restant dessus.
 * Les critères A1-A14.
 *
 * Montage : une prairie nue, un chasseur avec un couteau de fortune EN MAIN, et une carcasse
 * PLANTÉE à une tuile (le réservoir posé à la main — on juge le geste, pas la mise à mort, qui a
 * son banc dans `combat.test`/`chasse.test`). Un test passe quand même par `die()` pour prouver que
 * la mort d'une bête pose bien le marqueur `carcass` et l'os dans le réservoir (R1).
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, BUTCHER, FAUNA, MONSTER_DEFS, SLOTS, TERRAIN_GRASS, type MonsterType } from './balance'
import { die, type Corpse } from './combat'
import { cutTicks, partsEligibles } from './economy'
import { drainEvents, type SimEvent } from './events'
import { countOf, inventoryOf, type ItemBag, type ItemId } from './items'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { createSim, snapshot, spawnEntity, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { grantItems } from './village'
import { foundNpcVillage } from './worldgen'

// ── LE BANC ───────────────────────────────────────────────────────────────────
const CHASSEUR = { x: 10.5, y: 10.5 }
const BETE = { x: 11.5, y: 10.5 } // à une tuile : à portée (`INTERACT_RANGE` 1,5)

interface Banc {
  sim: SimState
  id: number
  corpse: Corpse
}

/** Un chasseur, son couteau en main (ou pas), et une carcasse plantée de ce qu'on veut. */
function banc(
  species: MonsterType,
  items: ItemBag,
  opts: { couteau?: boolean; seed?: number; xp?: number; faunaCap?: number; heure?: number } = {},
): Banc {
  const sim = createSim(opts.seed ?? 2026, {
    map: createEmptyMap(40, 40, TERRAIN_GRASS),
    faunaCap: opts.faunaCap ?? 0,
    worldEvents: false,
    meteoActive: false,
    cycleOffset: cycleOffsetForStartHour(opts.heure ?? 12, 1),
  })
  sim.wind = { x: 0, y: 0 }
  const id = spawnEntity(sim, CHASSEUR.x, CHASSEUR.y)
  const e = sim.entities.find((x) => x.id === id)!
  if (opts.couteau !== false) tenir(sim, id, 'crude_knife')
  if (opts.xp !== undefined) e.skills.hunting = opts.xp
  const corpse = planter(sim, species, items)
  drainEvents(sim)
  return { sim, id, corpse }
}

function planter(sim: SimState, species: MonsterType, items: ItemBag, at = BETE): Corpse {
  const corpse: Corpse = {
    id: sim.nextCorpseId,
    x: at.x,
    y: at.y,
    inventory: inventoryOf(SLOTS.CORPSE, items),
    decayAt: sim.tick + 100_000,
    diedAt: sim.tick,
    carcass: { species, parts: Object.values(items).reduce((n, k) => n + (k ?? 0), 0) },
  }
  sim.nextCorpseId += 1
  sim.corpses.push(corpse)
  return corpse
}

/** Donne l'objet ET LE MET EN MAIN — l'outil tenu fait foi (inventaire R9). */
function tenir(sim: SimState, id: number, item: ItemId): void {
  grantItems(sim, id, { [item]: 1 })
  const e = sim.entities.find((x) => x.id === id)!
  e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === item)
}

const entity = (b: Banc): Entity => b.sim.entities.find((e) => e.id === b.id)!
const idle = (b: Banc): MoveInput => ({ entityId: b.id, dx: 0, dy: 0 })
const carcasse = (b: Banc): Corpse | undefined => b.sim.corpses.find((c) => c.id === b.corpse.id)
const des = (evs: SimEvent[], type: SimEvent['type']): SimEvent[] => evs.filter((e) => e.type === type)

/** L'appui (premier tick) puis le MAINTIEN (`hold`) pendant `n` ticks — ce que le client envoie.
 *  `dejaAppuye` : on continue un maintien en cours (tout en `hold`, comme le client). */
function tenirAppuye(b: Banc, n: number, dejaAppuye = false, corpseId = b.corpse.id): SimEvent[] {
  const out: SimEvent[] = []
  for (let t = 0; t < n; t++) {
    step(b.sim, [{ ...idle(b), action: { type: 'butcher_start', corpseId, hold: dejaAppuye || t > 0 } }])
    out.push(...drainEvents(b.sim))
  }
  return out
}
const lacher = (b: Banc): void => step(b.sim, [{ ...idle(b), action: { type: 'butcher_stop' } }])
const attendre = (b: Banc, n: number): void => {
  for (let i = 0; i < n; i++) step(b.sim, [idle(b)])
}
/** Tient jusqu'à ce que la découpe s'arrête d'elle-même (réservoir vide, ou plus rien d'éligible). */
function toutDepecer(b: Banc, max = 40 * BALANCE.TICK_RATE_HZ): SimEvent[] {
  const out = tenirAppuye(b, 1)
  for (let t = 0; t < max && entity(b).butchering !== undefined; t++) out.push(...tenirAppuye(b, 1, true))
  return out
}

const CERF_PROPRE: ItemBag = { quartier: 2, raw_hide: 1 }

// ── R1 — LA MORT POSE LE RÉSERVOIR ────────────────────────────────────────────
describe('R1 — la mort d’une bête laisse une CARCASSE, avec son os', () => {
  it('le cerf tué est une carcasse (espèce posée), son loot porte les os ; un humain mort n’en est pas une', () => {
    const b = banc('deer', {})
    b.sim.corpses = []
    const cerfId = spawnMonster(b.sim, 'deer', 14.5, 14.5)
    const cerf = b.sim.entities.find((e) => e.id === cerfId)!
    die(b.sim, cerf, b.id)
    const c = b.sim.corpses[0]!
    expect(c.carcass?.species).toBe('deer')
    expect(c.carcass?.parts).toBe(MONSTER_DEFS.deer.loot.quartier! + MONSTER_DEFS.deer.loot.bone!)
    expect(countOf(c.inventory, 'quartier')).toBe(MONSTER_DEFS.deer.loot.quartier)
    expect(countOf(c.inventory, 'bone')).toBe(MONSTER_DEFS.deer.loot.bone)
    // Tuer n'instruit pas (D7) : aucune XP de chasse à la mise à mort.
    expect(entity(b).skills.hunting ?? 0).toBe(0)

    const autreId = spawnEntity(b.sim, 16.5, 16.5)
    const autre = b.sim.entities.find((e) => e.id === autreId)!
    grantItems(b.sim, autreId, { wood: 3 })
    die(b.sim, autre, b.id)
    const depouille = b.sim.corpses.find((x) => x.id !== c.id)!
    expect(depouille.carcass).toBeUndefined()
  })
})

// ── A1 — LE CLIC DE COFFRE NE VIDE PLUS UNE BÊTE ──────────────────────────────
describe('A1 — une bête ne se fouille pas', () => {
  it('`loot_corpse` et `transfer` sur une carcasse sont refusés, l’inventaire reste ; une dépouille humaine se loote comme avant', () => {
    const b = banc('deer', CERF_PROPRE)
    step(b.sim, [{ ...idle(b), action: { type: 'loot_corpse', corpseId: b.corpse.id } }])
    let evs = drainEvents(b.sim)
    expect(evs.some((e) => e.type === 'action_rejected' && e.reason === 'il faut le dépecer')).toBe(true)
    expect(countOf(carcasse(b)!.inventory, 'quartier')).toBe(2)
    expect(countOf(entity(b).inventory, 'quartier')).toBe(0)

    const slot = carcasse(b)!.inventory.findIndex((s) => s !== null)
    step(b.sim, [
      {
        ...idle(b),
        action: { type: 'transfer', kind: 'corpse', containerId: b.corpse.id, from: { side: 'container', slot }, to: { side: 'player', slot: 10 }, count: 1 },
      },
    ])
    evs = drainEvents(b.sim)
    expect(evs.some((e) => e.type === 'action_rejected' && e.reason === 'il faut le dépecer')).toBe(true)
    expect(countOf(carcasse(b)!.inventory, 'quartier')).toBe(2)

    // La dépouille humaine (sans `carcass`) : le coffre, comme avant (inventaire A21).
    const humain: Corpse = { id: 99, x: 10.5, y: 11.5, inventory: inventoryOf(SLOTS.CORPSE, { wood: 4 }), decayAt: 1e9, diedAt: 0 }
    b.sim.corpses.push(humain)
    step(b.sim, [{ ...idle(b), action: { type: 'loot_corpse', corpseId: 99 } }])
    expect(countOf(entity(b).inventory, 'wood')).toBe(4)
    expect(b.sim.corpses.some((c) => c.id === 99)).toBe(false)
  })
})

// ── A2 — TENIR DÉCOUPE À LA CADENCE ───────────────────────────────────────────
describe('A2 — le maintien découpe à la cadence', () => {
  it('une part à CUT_TICKS, la deuxième à 2 × CUT_TICKS, chacune dite par `carcass_cut`', () => {
    const b = banc('boar', { raw_meat: 3 })
    const n = BUTCHER.CUT_TICKS
    let evs = tenirAppuye(b, n - 1)
    expect(des(evs, 'carcass_cut')).toHaveLength(0)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(0)
    evs = tenirAppuye(b, 1, true)
    expect(des(evs, 'carcass_cut')).toHaveLength(1)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(1)
    expect(countOf(carcasse(b)!.inventory, 'raw_meat')).toBe(2)
    evs = tenirAppuye(b, n - 1, true)
    expect(des(evs, 'carcass_cut')).toHaveLength(0)
    evs = tenirAppuye(b, 1, true)
    expect(des(evs, 'carcass_cut')).toHaveLength(1)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(2)
    expect(entity(b).butchering).toBeDefined()
  })
})

// ── A3 — CE QUI EST PRIS EST PRIS ─────────────────────────────────────────────
describe('A3 — arrêter garde l’acquis, reprendre repart de là', () => {
  it('lâcher après une coupe : le sac garde la part, la bête garde le reste ; reprendre en sort une autre', () => {
    const b = banc('boar', { raw_meat: 3 })
    tenirAppuye(b, BUTCHER.CUT_TICKS)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(1)
    lacher(b)
    expect(entity(b).butchering).toBeUndefined()
    attendre(b, 50)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(1)
    expect(countOf(carcasse(b)!.inventory, 'raw_meat')).toBe(2)
    const evs = tenirAppuye(b, BUTCHER.CUT_TICKS)
    expect(des(evs, 'carcass_cut')).toHaveLength(1)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(2)
    expect(countOf(carcasse(b)!.inventory, 'raw_meat')).toBe(1)
  })
})

// ── A4 — LE TIRAGE EST HONNÊTE ET REJOUABLE ───────────────────────────────────
describe('A4 — la part qui sort se tire, et le tirage se rejoue', () => {
  it('sur 200 graines, la peau sort en première coupe ~1 fois sur 3 ; même graine → même ordre', () => {
    let peauDAbord = 0
    const ordres = new Map<number, string>()
    for (let seed = 1; seed <= 200; seed++) {
      const b = banc('deer', CERF_PROPRE, { seed })
      const evs = toutDepecer(b)
      const ordre = des(evs, 'carcass_cut').map((e) => (e as { item: ItemId }).item)
      expect(ordre).toHaveLength(3)
      if (ordre[0] === 'raw_hide') peauDAbord += 1
      ordres.set(seed, ordre.join(','))
    }
    expect(peauDAbord).toBeGreaterThan(200 * 0.15)
    expect(peauDAbord).toBeLessThan(200 * 0.55)
    for (const seed of [7, 42, 133]) {
      const b = banc('deer', CERF_PROPRE, { seed })
      const ordre = des(toutDepecer(b), 'carcass_cut').map((e) => (e as { item: ItemId }).item)
      expect(ordre.join(',')).toBe(ordres.get(seed))
    }
    // Le tirage respecte les QUANTITÉS : deux quartiers et une peau, c'est deux chances sur trois.
    expect(partsEligibles(planter(banc('deer', {}).sim, 'deer', CERF_PROPRE), 0)).toEqual(['quartier', 'quartier', 'raw_hide'])
  })
})

// ── A5 — PAS DE LAME, PAS DE DÉCOUPE ──────────────────────────────────────────
describe('A5 — le couteau est obligatoire, viande comprise', () => {
  it('mains nues ou hache en main → refus « il faut une lame » ; au couteau la découpe part et la lame s’use', () => {
    const b = banc('boar', { raw_meat: 3 }, { couteau: false })
    step(b.sim, [{ ...idle(b), action: { type: 'butcher_start', corpseId: b.corpse.id } }])
    let evs = drainEvents(b.sim)
    expect(evs.some((e) => e.type === 'action_rejected' && e.reason === 'il faut une lame')).toBe(true)
    expect(entity(b).butchering).toBeUndefined()

    tenir(b.sim, b.id, 'crude_axe')
    step(b.sim, [{ ...idle(b), action: { type: 'butcher_start', corpseId: b.corpse.id } }])
    evs = drainEvents(b.sim)
    expect(evs.some((e) => e.type === 'action_rejected' && e.reason === 'il faut une lame')).toBe(true)

    // Le maintien (`hold`) ne crache pas de refus : un doigt posé sans lame est MUET.
    step(b.sim, [{ ...idle(b), action: { type: 'butcher_start', corpseId: b.corpse.id, hold: true } }])
    expect(des(drainEvents(b.sim), 'action_rejected')).toHaveLength(0)

    tenir(b.sim, b.id, 'crude_knife')
    const lame = entity(b).inventory[entity(b).activeSlot]!
    const usureAvant = lame.wear ?? 0
    evs = tenirAppuye(b, BUTCHER.CUT_TICKS)
    expect(des(evs, 'carcass_cut')).toHaveLength(1)
    expect((lame.wear ?? 0) - usureAvant).toBe(1)
  })

  it('ranger la lame en pleine découpe l’arrête, muette', () => {
    const b = banc('boar', { raw_meat: 3 })
    tenirAppuye(b, 3)
    expect(entity(b).butchering).toBeDefined()
    entity(b).activeSlot = -1
    const evs = tenirAppuye(b, 3, true)
    expect(entity(b).butchering).toBeUndefined()
    expect(des(evs, 'action_rejected')).toHaveLength(0)
  })
})

// ── A6 — L'OS S'OUVRE AU PALIER ───────────────────────────────────────────────
describe('A6 — l’os est la couche du chasseur aguerri', () => {
  it('niveau 0 : la viande sort, la découpe s’arrête, l’os reste ; niveau ≥ BONE_LEVEL : l’os sort', () => {
    const novice = banc('boar', { raw_meat: 3, bone: 1 })
    const evs = toutDepecer(novice)
    expect(des(evs, 'carcass_cut').map((e) => (e as { item: ItemId }).item).sort()).toEqual(['raw_meat', 'raw_meat', 'raw_meat'])
    expect(countOf(entity(novice).inventory, 'bone')).toBe(0)
    expect(countOf(carcasse(novice)!.inventory, 'bone')).toBe(1)
    expect(entity(novice).butchering).toBeUndefined()
    expect(des(evs, 'action_rejected')).toHaveLength(0)
    // Et ré-appuyer sur l'os seul LE DIT — le maintien, lui, reste muet.
    step(novice.sim, [{ ...idle(novice), action: { type: 'butcher_start', corpseId: novice.corpse.id } }])
    expect(drainEvents(novice.sim).some((e) => e.type === 'action_rejected' && e.reason === "rien que de l'os")).toBe(true)
    step(novice.sim, [{ ...idle(novice), action: { type: 'butcher_start', corpseId: novice.corpse.id, hold: true } }])
    expect(des(drainEvents(novice.sim), 'action_rejected')).toHaveLength(0)
    expect(entity(novice).butchering).toBeUndefined()

    const xp = 100 * BUTCHER.BONE_LEVEL * BUTCHER.BONE_LEVEL // skillLevel = floor(sqrt(xp/100))
    const aguerri = banc('boar', { raw_meat: 3, bone: 1 }, { xp })
    toutDepecer(aguerri)
    expect(countOf(entity(aguerri).inventory, 'bone')).toBe(1)
    expect(countOf(entity(aguerri).inventory, 'raw_meat')).toBe(3)
    expect(carcasse(aguerri)).toBeUndefined() // vidée : elle disparaît
  })
})

// ── A7 — LE NIVEAU ACCÉLÈRE, PLAFONNÉ ─────────────────────────────────────────
describe('A7 — la cadence est un gain plat, planché', () => {
  it('cutTicks(4) < cutTicks(0), et cutTicks(40) = CUT_TICKS_MIN', () => {
    const lvl = (n: number): Entity => entity(banc('boar', {}, { xp: 100 * n * n }))
    expect(cutTicks(lvl(0))).toBe(BUTCHER.CUT_TICKS)
    expect(cutTicks(lvl(4))).toBeLessThan(cutTicks(lvl(0)))
    expect(cutTicks(lvl(4))).toBe(BUTCHER.CUT_TICKS - 4 * BUTCHER.SPEED_PER_LEVEL)
    expect(cutTicks(lvl(40))).toBe(BUTCHER.CUT_TICKS_MIN)
  })
})

// ── A8 — BOUGER ARRÊTE, SANS RIEN PERDRE ──────────────────────────────────────
describe('A8 — un pas arrête la découpe', () => {
  it('bouger pendant le maintien efface `butchering`, sans refus ; sac et carcasse cohérents', () => {
    const b = banc('boar', { raw_meat: 3 })
    tenirAppuye(b, BUTCHER.CUT_TICKS)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(1)
    step(b.sim, [{ entityId: b.id, dx: -1, dy: 0, action: { type: 'butcher_start', corpseId: b.corpse.id, hold: true } }])
    step(b.sim, [{ entityId: b.id, dx: -1, dy: 0, action: { type: 'butcher_start', corpseId: b.corpse.id, hold: true } }])
    const evs = drainEvents(b.sim)
    expect(entity(b).butchering).toBeUndefined()
    expect(des(evs, 'action_rejected')).toHaveLength(0)
    expect(countOf(entity(b).inventory, 'raw_meat') + countOf(carcasse(b)!.inventory, 'raw_meat')).toBe(3)
  })
})

// ── A9 — LE MAINTIEN EXPIRE ───────────────────────────────────────────────────
describe('A9 — sans `hold`, la découpe s’éteint', () => {
  it('un appui jamais rafraîchi s’arrête après HOLD_GRACE_TICKS, sans coupe', () => {
    const b = banc('boar', { raw_meat: 3 })
    step(b.sim, [{ ...idle(b), action: { type: 'butcher_start', corpseId: b.corpse.id } }])
    expect(entity(b).butchering).toBeDefined()
    attendre(b, BUTCHER.HOLD_GRACE_TICKS - 1) // l'appui lui-même a déjà avancé d'un tick
    expect(entity(b).butchering).toBeDefined()
    attendre(b, 1)
    expect(entity(b).butchering).toBeUndefined()
    attendre(b, 2 * BUTCHER.CUT_TICKS)
    expect(des(drainEvents(b.sim), 'carcass_cut')).toHaveLength(0)
    expect(countOf(entity(b).inventory, 'raw_meat')).toBe(0)
  })
})

// ── A10 — L'XP VIENT DE LA COUPE ──────────────────────────────────────────────
describe('A10 — la chasse trouve son arbre via le dépeçage', () => {
  it('chaque coupe monte `hunting` ; un cerf entier en apprend plus qu’un lapin', () => {
    const cerf = banc('deer', CERF_PROPRE)
    const evsCerf = toutDepecer(cerf)
    const xpCerf = entity(cerf).skills.hunting ?? 0
    expect(des(evsCerf, 'carcass_cut')).toHaveLength(3)
    expect(xpCerf).toBeCloseTo(3 * BUTCHER.XP_PER_CUT, 6)

    const lapin = banc('rabbit', { raw_meat: 1 })
    toutDepecer(lapin)
    const xpLapin = entity(lapin).skills.hunting ?? 0
    expect(xpLapin).toBeGreaterThan(0)
    expect(xpCerf).toBeGreaterThan(xpLapin)
  })
})

// ── A11 — LE LOUP MANGE LE RÉSERVOIR, QUARTIERS COMPRIS ───────────────────────
describe('A11 — le loup mange dans le même réservoir', () => {
  it('un cadavre de CERF (quartiers) attire un loup affamé, qui en mange un ; la carcasse en a un de moins', () => {
    const b = banc('deer', {}, { heure: 2 })
    b.sim.corpses = []
    const corpse = planter(b.sim, 'deer', { quartier: 2, raw_hide: 1 }, { x: 30.5, y: 30.5 })
    entity(b).x = 2.5
    entity(b).y = 2.5
    const loupId = spawnMonster(b.sim, 'wolf', 24.5, 30.5)
    const loup = b.sim.monsters.find((m) => m.entityId === loupId)!
    loup.alpha = true
    loup.alphaId = loupId
    loup.herdId = b.sim.nextHerdId++
    let mange = false
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && !mange; t++) {
      step(b.sim, [idle(b)])
      mange = loup.eatingUntil !== undefined
    }
    expect(mange).toBe(true)
    for (let t = 0; t < FAUNA.EAT_TICKS + 2; t++) step(b.sim, [idle(b)])
    const apres = b.sim.corpses.find((c) => c.id === corpse.id)!
    expect(countOf(apres.inventory, 'quartier')).toBe(1)
    expect(countOf(apres.inventory, 'raw_hide')).toBe(1) // il ne mange pas la peau
  })
})

// ── A12 — SAC PLEIN ───────────────────────────────────────────────────────────
describe('A12 — sac plein : la part reste sur la bête', () => {
  it('la coupe est refusée « sac plein », la découpe s’arrête, rien ne s’évapore', () => {
    const b = banc('boar', { raw_meat: 3 })
    const e = entity(b)
    for (let i = 0; i < e.inventory.length; i++) if (e.inventory[i] === null) e.inventory[i] = { item: 'stone', count: 1 }
    const evs = tenirAppuye(b, BUTCHER.CUT_TICKS)
    expect(evs.some((ev) => ev.type === 'action_rejected' && ev.reason === 'sac plein')).toBe(true)
    expect(des(evs, 'carcass_cut')).toHaveLength(0)
    expect(e.butchering).toBeUndefined()
    expect(countOf(carcasse(b)!.inventory, 'raw_meat')).toBe(3)
  })
})

// ── A13 — DÉTERMINISME ────────────────────────────────────────────────────────
describe('A13 — même graine, mêmes inputs : mêmes parts, mêmes événements', () => {
  it('deux sims jumelles convergent au bit près, découpe comprise', () => {
    const joue = (): { etat: string; evs: string } => {
      const b = banc('deer', { quartier: 2, raw_hide: 1, bone: 2 }, { seed: 77, xp: 500 })
      const evs = tenirAppuye(b, 2 * BUTCHER.CUT_TICKS)
      lacher(b)
      attendre(b, 10)
      evs.push(...toutDepecer(b))
      return { etat: snapshot(b.sim), evs: JSON.stringify(evs) }
    }
    const a = joue()
    const c = joue()
    expect(a.etat).toBe(c.etat)
    expect(a.evs).toBe(c.evs)
  })
})

// ── A14 — LES RAIDERS NE DÉPÈCENT PAS ─────────────────────────────────────────
describe('A14 — un raider PNJ ne dépèce pas', () => {
  it('en stade `loot` près d’une carcasse, il rentre les mains vides et l’expédition avance', () => {
    const sim = createSim(11, { map: createEmptyMap(28, 28, TERRAIN_GRASS), worldEvents: false })
    foundNpcVillage(sim, 12, 12, 1)
    const npc = sim.npcs[0]!
    const e = sim.entities.find((x) => x.id === npc.entityId)!
    e.hunger = 100
    const corpse = planter(sim, 'boar', { raw_meat: 3 }, { x: e.x, y: e.y })
    npc.errand = { kind: 'raid', targetVillageId: sim.villages[0]!.id, stage: 'loot' }
    drainEvents(sim)
    const stages: (string | null)[] = []
    for (let t = 0; t < 60; t++) {
      step(sim, [])
      stages.push(npc.errand?.stage ?? null)
    }
    expect(stages.filter((s) => s === 'loot')).toHaveLength(0)
    expect(countOf(e.inventory, 'raw_meat')).toBe(0)
    expect(countOf(sim.corpses.find((c) => c.id === corpse.id)!.inventory, 'raw_meat')).toBe(3)
  })
})
