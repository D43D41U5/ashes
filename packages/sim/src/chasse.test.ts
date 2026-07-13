/**
 * LA CHASSE, palier I (spec chasse, C1-C7) — critères A1-A7 et A9.
 *
 * A8 (dégénérescence) n'a pas de test à lui : c'est la suite EXISTANTE qui le
 * porte — les tests faune passent avec la méfiance active, et les deux qui ont
 * bougé (A5/A6 faune) documentent leur delta sur place.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, FAUNA, HUNT, MONSTER_DEFS, SLOTS, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_ROCK, TERRAINS, WEAPON_PROFILES } from './balance'
import { drainEvents } from './events'
import { carryRatio, carryTier, countOf, inventoryOf, type ItemId } from './items'
import { bloodBias, gaitNoise } from './faune'
import { createEmptyMap, type WorldMap } from './map'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { spawnMonster, type Monster } from './monsters'
import { grantItems } from './village'
import { applyDamage } from './combat'

/** Prairie partout, un carré de forêt au nord-ouest (même monde que faune.test). */
function makeMap(): WorldMap {
  const map = createEmptyMap(160, 160, TERRAIN_GRASS)
  for (let ty = 10; ty < 50; ty++) {
    for (let tx = 10; tx < 50; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  }
  return map
}

/**
 * Midi : l'heure des cerfs, et l'heure où le monde est le plus lisible.
 *
 * CALME PLAT par défaut (spec chasse C17) : l'odorat est un canal à PART — il
 * ignore le couvert, l'allure et le dos tourné, donc il rendrait chaque banc
 * d'approche dépendant du point cardinal d'où l'on vient. On le coupe (vecteur
 * nul = pas de vent, jamais) et on le mesure dans son banc à lui (A18).
 */
function makeSim(hour = 12, wind: { x: number; y: number } = { x: 0, y: 0 }): SimState {
  const sim = createSim(1234, { map: makeMap(), faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(hour) })
  sim.wind = wind
  return sim
}

const entity = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!
const monsterOf = (sim: SimState, id: number) => sim.monsters.find((m) => m.entityId === id)

function tick(sim: SimState, inputs: MoveInput[] = []): void {
  step(sim, inputs)
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))
}

/**
 * Une bête PIQUÉE : elle ne broute plus (thinkAt gelé), son regard est posé.
 * C'est le banc d'essai de l'APPROCHE — on mesure la perception, pas l'errance.
 */
function pinBeast(sim: SimState, type: 'deer' | 'boar', x: number, y: number, facing = { x: 1, y: 0 }): { id: number; m: Monster } {
  const id = spawnMonster(sim, type, x, y)
  const m = monsterOf(sim, id)!
  m.thinkAt = Number.MAX_SAFE_INTEGER
  entity(sim, id).facing = facing
  return { id, m }
}

/** Donne l'objet ET LE MET EN MAIN (même montage que combat.test). */
function grantHeld(sim: SimState, entityId: number, item: ItemId): void {
  grantItems(sim, entityId, { [item]: 1 })
  const e = entity(sim, entityId)
  e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === item)
}

/** Frappe et laisse le wind-up de L'ARME TENUE se résoudre. */
function strike(sim: SimState, attackerId: number, dx: number, dy: number, windupTicks: number): void {
  tick(sim, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }])
  for (let t = 0; t < windupTicks + 1; t++) tick(sim)
}

/**
 * L'avatar marche plein nord (vers -y) à l'allure donnée, jusqu'à ce que la
 * bête soit LEVÉE (ou qu'on soit au contact). Rend la distance vraie au moment
 * de la levée — c'est LA mesure de l'approche.
 */
function approachUntilFlee(
  sim: SimState,
  avatarId: number,
  m: Monster,
  beastId: number,
  opts: { sprint?: boolean; sneak?: boolean } = {},
  pattern: 'continuous' | 'stopgo' = 'continuous',
): number {
  let closest = Infinity
  for (let t = 0; t < 90 * BALANCE.TICK_RATE_HZ; t++) {
    const phase = pattern === 'stopgo' ? t % 50 : 0 // 20 ticks de pas, 30 de gel
    const moving = pattern === 'continuous' || phase < 20
    tick(sim, [{ entityId: avatarId, dx: 0, dy: moving ? -1 : 0, sprint: opts.sprint ?? false, sneak: opts.sneak ?? false }])
    const d = dist(entity(sim, beastId), entity(sim, avatarId))
    closest = Math.min(closest, d)
    if (m.fleeSince >= 0) return d
    if (d <= 2.0) return closest // au contact sans l'avoir levée : l'approche est GAGNÉE
  }
  return closest
}

describe("l'allure (A1, C2)", () => {
  it('A1 — sneak ralentit de moitié, et le snapshot porte la posture', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 80.5, 100.5)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 1 }])
    const walked = entity(sim, a).y - 100.5
    expect(entity(sim, a).gait).toBe('walk')

    const sim2 = makeSim()
    const b = spawnEntity(sim2, 80.5, 100.5)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim2, [{ entityId: b, dx: 0, dy: 1, sneak: true }])
    const sneaked = entity(sim2, b).y - 100.5
    expect(entity(sim2, b).gait).toBe('sneak')
    expect(sneaked / walked).toBeCloseTo(HUNT.SNEAK_SPEED_FACTOR, 1)

    // À l'arrêt, la posture le dit aussi.
    tick(sim2, [{ entityId: b, dx: 0, dy: 0 }])
    expect(entity(sim2, b).gait).toBe('still')
  })

  it('A1 — la distance de levée ordonne les allures : sprint > marche > pas lent', () => {
    const run = (opts: { sprint?: boolean; sneak?: boolean }): number => {
      const sim = makeSim()
      const { m, id } = pinBeast(sim, 'deer', 80.5, 60.5)
      const a = spawnEntity(sim, 80.5, 87)
      return approachUntilFlee(sim, a, m, id, opts)
    }
    const sprint = run({ sprint: true })
    const walk = run({})
    const sneak = run({ sneak: true })
    expect(sprint).toBeGreaterThan(walk)
    expect(walk).toBeGreaterThan(sneak)
    // « Nettement plus près » (spec A1). Depuis l'ESPACE VITAL (faune R6bis), la
    // levée du rampeur plafonne à PERSONAL_SPACE quand sa jauge a atteint l'alerte
    // en chemin — l'écart mesuré se serre d'autant (1,5 → ~1,4). Une tuile et
    // quart reste « nettement » : le rampeur gagne ~30 % de distance.
    expect(walk - sneak).toBeGreaterThan(1.2)
  })

  it('C2 — le portage interdit le silence : chargé LOURD, on sonne comme un marcheur', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 80.5, 100.5)
    const e = entity(sim, a)
    e.gait = 'sneak'
    expect(gaitNoise(e)).toBe(HUNT.NOISE_SNEAK)
    grantItems(sim, a, { stone: 999 }) // de quoi passer le palier lourd (le sac tronque le reste)
    const tier = carryTier(carryRatio(e.inventory))
    expect(tier === 'light' || tier === 'medium').toBe(false)
    expect(gaitNoise(e)).toBe(HUNT.NOISE_WALK)
  })
})

describe('le stop-and-go (A2, C1)', () => {
  it('A2 — se figer fait redescendre la jauge', () => {
    const sim = makeSim()
    const { m } = pinBeast(sim, 'deer', 80.5, 60.5)
    const a = spawnEntity(sim, 80.5, 73) // à 12,5 tuiles : dans le champ, pas dessus
    // Une seconde de marche : la jauge monte (le pas s'entend).
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: -1 }])
    const risen = m.suspicion
    expect(risen).toBeGreaterThan(0.05)
    // On se FIGE (à ~8,5 tuiles, une silhouette immobile ne pèse plus rien) :
    // la jauge redescend — c'est la moitié « soleil » du 1, 2, 3, soleil.
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(m.suspicion).toBeLessThan(risen)
  })

  it("A2 — l'approche par à-coups atteint plus près que l'approche continue", () => {
    const run = (pattern: 'continuous' | 'stopgo'): number => {
      const sim = makeSim()
      const { m, id } = pinBeast(sim, 'deer', 80.5, 60.5)
      const a = spawnEntity(sim, 80.5, 72.5) // à 12 tuiles
      return approachUntilFlee(sim, a, m, id, { sneak: true }, pattern)
    }
    expect(run('stopgo')).toBeLessThan(run('continuous'))
  })
})

describe('le regard et le couvert (A3-A4, C3-C4)', () => {
  /** Approche en PAS LENT sur `ticks`, en ligne droite selon dy. */
  function sneakFor(sim: SimState, id: number, dy: -1 | 1, ticks: number): void {
    for (let t = 0; t < ticks; t++) tick(sim, [{ entityId: id, dx: 0, dy, sneak: true }])
  }

  it('A3 — même approche, même allure : de face, la jauge monte ; dans le dos, presque rien', () => {
    // Deux sims jumelles : le cerf regarde le NORD. Un rampeur vient du nord
    // (plein regard), l'autre du sud (dans son dos). Même distance de départ (8),
    // même durée (2 s → il finit à 4 tuiles).
    const front = makeSim()
    const f = pinBeast(front, 'deer', 80.5, 60.5, { x: 0, y: -1 })
    const fa = spawnEntity(front, 80.5, 52.5)
    sneakFor(front, fa, 1, 2 * BALANCE.TICK_RATE_HZ)

    const back = makeSim()
    const b = pinBeast(back, 'deer', 80.5, 60.5, { x: 0, y: -1 })
    const ba = spawnEntity(back, 80.5, 68.5)
    sneakFor(back, ba, -1, 2 * BALANCE.TICK_RATE_HZ)

    expect(f.m.suspicion).toBeGreaterThanOrEqual(HUNT.SUSPICION_CURIOUS)
    expect(b.m.suspicion).toBeLessThan(HUNT.SUSPICION_CURIOUS)
    expect(b.m.suspicion).toBeLessThan(f.m.suspicion / 2)
  })

  it('A4 — le fourré cache : le même rampeur, en forêt, ne monte presque pas la jauge', () => {
    // Contrôle en prairie rase : un rampeur de face, de 9,5 à 5 tuiles.
    const open = makeSim()
    const o = pinBeast(open, 'deer', 100.5, 60.5, { x: 0, y: -1 })
    const oa = spawnEntity(open, 100.5, 51)
    for (let t = 0; t < 45; t++) tick(open, [{ entityId: oa, dx: 0, dy: 1, sneak: true }])
    expect(o.m.suspicion).toBeGreaterThanOrEqual(HUNT.SUSPICION_CURIOUS)

    // La même approche, DANS la forêt (le cerf, lui, broute en lisière).
    const wood = makeSim()
    const w = pinBeast(wood, 'deer', 30.5, 53.5, { x: 0, y: -1 })
    const wa = spawnEntity(wood, 30.5, 44)
    for (let t = 0; t < 45; t++) tick(wood, [{ entityId: wa, dx: 0, dy: 1, sneak: true }])
    expect(w.m.suspicion).toBeLessThan(HUNT.SUSPICION_CURIOUS)
    expect(w.m.suspicion).toBeLessThan(o.m.suspicion / 2)
  })
})

describe('les seuils, la panique, la nervosité (A5, C1)', () => {
  it('A5 — la panique : on ne marche pas SUR un cerf, si discret soit-on', () => {
    const sim = makeSim()
    const { m } = pinBeast(sim, 'deer', 80.5, 60.5)
    const a = spawnEntity(sim, 80.5, 62) // à 1,5 tuile : DESSUS
    tick(sim, [{ entityId: a, dx: 0, dy: 0, sneak: true }])
    expect(m.suspicion).toBe(1)
    for (let t = 0; t < 5; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(m.fleeSince).toBeGreaterThanOrEqual(0)
  })

  it("A5 — franchir le seuil d'alerte se DATE (alertSince) et se PAIE (nervosité)", () => {
    const sim = makeSim()
    const { m } = pinBeast(sim, 'deer', 80.5, 60.5)
    spawnEntity(sim, 80.5, 66.5) // à 6 tuiles, gait `walk` par défaut : ça s'entend fort
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ && m.alertSince === undefined; t++) tick(sim)
    expect(m.alertSince).toBeDefined()
    expect(m.nervous).toBeGreaterThanOrEqual(HUNT.NERVOUS_FACTOR)
  })
})

describe('la mise à mort propre (A6, C6) et le cri de mort (A7, C7)', () => {
  it('A6 — la lance couche un cerf non alerté d’un seul coup PROPRE', () => {
    const sim = makeSim()
    const { id } = pinBeast(sim, 'deer', 80.5, 60.5)
    const a = spawnEntity(sim, 80.5, 62.6) // à 2,1 tuiles (allonge 2,3 ; panique 1,8)
    grantHeld(sim, a, 'spear')
    drainEvents(sim)
    strike(sim, a, 0, -1, WEAPON_PROFILES.spear.light.windupTicks)
    // 16 × 3 = 48 ≥ 45 : un coup, un mort — et l'événement le DIT.
    expect(sim.entities.find((e) => e.id === id)).toBeUndefined()
    const slain = drainEvents(sim).find((e) => e.type === 'monster_slain')
    expect(slain).toMatchObject({ monsterType: 'deer', clean: true })
  })

  it('A6 — la bête ALERTÉE ne rend plus de coup propre : le sanglier qui MENACE prend les dégâts nominaux', () => {
    // Le banc de l'« alerté » est le SANGLIER : c'est la seule bête qui reste
    // sous le fer une fois alertée (le cerf, lui, fuit — et le coup ne porte
    // plus du tout, ce qui est une autre façon de dire la même règle).
    const sim = makeSim(2)
    const { id, m } = pinBeast(sim, 'boar', 30.5, 30.5)
    const a = spawnEntity(sim, 30.5, 32.35) // à 1,85 < THREAT_RANGE : il va MENACER
    grantHeld(sim, a, 'crude_spear')
    // Il se plante face à l'intrus — et un sanglier qui menace est un sanglier
    // ALERTÉ (C6) : on laisse sa machine le dire avant de frapper.
    for (let t = 0; t < BALANCE.TICK_RATE_HZ && m.alertSince === undefined; t++) tick(sim)
    expect(m.alertSince).toBeDefined()
    strike(sim, a, 0, -1, WEAPON_PROFILES.crude_spear.light.windupTicks)
    expect(entity(sim, id).hp).toBe(MONSTER_DEFS.boar.hp - WEAPON_PROFILES.crude_spear.light.damage)
  })

  it("A6 — l'épieu propre prend le sanglier qui fouge… mais pas le cerf", () => {
    // Le sanglier (30 PV) : 10 × 3 = 30 — la fenêtre de la FOUILLE (R14). L'épieu
    // porte à 1,9 : on frappe de 1,85 — juste au-delà de sa menace de fougeur (1,8).
    const boarSim = makeSim(2) // 2 h du matin : ses heures
    const { id: boarId, m: boar } = pinBeast(boarSim, 'boar', 30.5, 30.5)
    boar.rootUntil = boarSim.tick + 10_000 // groin au sol : sa menace s'effondre
    const hunter = spawnEntity(boarSim, 30.5, 32.35)
    grantHeld(boarSim, hunter, 'crude_spear')
    drainEvents(boarSim)
    strike(boarSim, hunter, 0, -1, WEAPON_PROFILES.crude_spear.light.windupTicks)
    expect(boarSim.entities.find((e) => e.id === boarId)).toBeUndefined()
    expect(drainEvents(boarSim).find((e) => e.type === 'monster_slain')).toMatchObject({ monsterType: 'boar', clean: true })

    // Le cerf (45 PV) : 30 < 45 — l'épieu ne suffit pas, même propre. On le MURE
    // de tous côtés : sinon il détale (et depuis LE CROCHET, chasse C15, il
    // détale même DE BIAIS — il se dérobait au cône étroit de l'épieu, et le
    // coup fendait l'air : c'est le banc qui l'a dit, pas le raisonnement).
    const deerSim = makeSim()
    const { id: deerId } = pinBeast(deerSim, 'deer', 80.5, 60.5)
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      deerSim.map.terrain[(60 + oy) * deerSim.map.width + (80 + ox)] = TERRAIN_ROCK
    }
    // À 1,5 tuile : même MURÉ, le cerf se dérobe d'un cinquième de tuile DANS sa
    // propre case (son corps y a du jeu) — à 1,85 il sortait de la portée de
    // l'épieu (1,9) et le coup fendait l'air. Le banc a tranché, pas le calcul.
    const h2 = spawnEntity(deerSim, 80.5, 62)
    grantHeld(deerSim, h2, 'crude_spear')
    strike(deerSim, h2, 0, -1, WEAPON_PROFILES.crude_spear.light.windupTicks)
    const hp = entity(deerSim, deerId).hp
    // 45 − 30 = 15, et 15 < 22,5 (MORTAL_BELOW × 45) : LA PLAIE EST MORTELLE
    // (C8) — il saigne désormais, et ses PV glissent. On mesure donc une
    // fourchette : le coup a bien porté ×3, et le sang a commencé son travail.
    const attendu = MONSTER_DEFS.deer.hp - WEAPON_PROFILES.crude_spear.light.damage * HUNT.CLEAN_KILL_FACTOR
    expect(hp).toBeLessThanOrEqual(attendu)
    expect(hp).toBeGreaterThan(attendu - 1)
    expect(monsterOf(deerSim, deerId)!.bleedMortal).toBe(true)
  })

  it('A7 — LE CRI DE MORT : tuer proprement une bête de harde alarme les siens, le tick même', () => {
    const sim = makeSim()
    const first = pinBeast(sim, 'deer', 80.5, 60.5)
    const second = pinBeast(sim, 'deer', 86.5, 60.5) // à 6 tuiles < HERD_ALARM_RADIUS
    first.m.herdId = 777
    second.m.herdId = 777
    const a = spawnEntity(sim, 80.5, 62.6)
    grantHeld(sim, a, 'spear')
    strike(sim, a, 0, -1, WEAPON_PROFILES.spear.light.windupTicks)
    expect(sim.entities.find((e) => e.id === first.id)).toBeUndefined() // le premier est tombé…
    // …et le second EST DEBOUT, sans avoir rien vu. (Le cri l'a mis à 1 au tick
    // de la mort ; le tick d'écoulement suivant a déjà rogné un cheveu.)
    expect(second.m.suspicion).toBeGreaterThan(0.95)
    expect(second.m.alertSince).toBeDefined() // plus de coup propre sur lui (C7)
  })

  it("A7 — contre-test : une bête SOLITAIRE tuée n'alarme personne", () => {
    const sim = makeSim()
    const first = pinBeast(sim, 'deer', 80.5, 60.5)
    const second = pinBeast(sim, 'deer', 86.5, 60.5) // même distance, PAS de harde
    const a = spawnEntity(sim, 80.5, 62.6)
    grantHeld(sim, a, 'spear')
    strike(sim, a, 0, -1, WEAPON_PROFILES.spear.light.windupTicks)
    expect(sim.entities.find((e) => e.id === first.id)).toBeUndefined()
    expect(second.m.suspicion).toBeLessThan(0.1)
  })
})

describe('le déterminisme (A9)', () => {
  it('A9 — même seed + mêmes inputs (sneak compris) = même état, même flux', () => {
    const script = (sim: SimState): { state: string; events: unknown[] } => {
      const { m, id } = pinBeast(sim, 'deer', 80.5, 60.5)
      const a = spawnEntity(sim, 80.5, 72.5)
      grantHeld(sim, a, 'spear')
      for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ; t++) {
        tick(sim, [{ entityId: a, dx: 0, dy: -1, sneak: t % 50 < 20 }])
      }
      strike(sim, a, 0, -1, WEAPON_PROFILES.spear.light.windupTicks)
      void m
      void id
      return { state: JSON.stringify(sim), events: drainEvents(sim) }
    }
    const one = script(makeSim())
    const two = script(makeSim())
    expect(one.state).toBe(two.state)
    expect(one.events).toEqual(two.events)
  })
})

/* ══ CHASSE II — LE SANG (A10-A14) ═══════════════════════════════════════════ */

describe('la plaie (A10, C8) et le sang au sol (A11, C9)', () => {
  /** Frappe une bête à `damage` PV près, sans passer par une arme. */
  function wound(sim: SimState, id: number, damage: number, byId: number): void {
    applyDamage(sim, entity(sim, id), damage, byId)
  }

  it('A10 — LA PLAIE MORTELLE : sous le seuil, elle saigne JUSQU’À MOURIR', () => {
    const sim = makeSim()
    const { id, m } = pinBeast(sim, 'deer', 80.5, 60.5)
    const a = spawnEntity(sim, 80.5, 90.5) // loin : il ne la presse pas
    // 45 → 20 PV : sous MORTAL_BELOW (0,5 × 45 = 22,5).
    wound(sim, id, MONSTER_DEFS.deer.hp - 20, a)
    expect(m.bleedMortal).toBe(true)

    // Elle s'éteint seule, en ~20 / BLEED_HP_PER_S secondes.
    const limite = (20 / HUNT.BLEED_HP_PER_S + 10) * BALANCE.TICK_RATE_HZ
    let morte = false
    for (let t = 0; t < limite && !morte; t++) {
      tick(sim)
      morte = sim.entities.find((e) => e.id === id) === undefined
    }
    expect(morte).toBe(true)
  })

  it('A10 — LA PLAIE LÉGÈRE se referme : la bête SURVIT, et la piste s’éteint', () => {
    const sim = makeSim()
    const { id, m } = pinBeast(sim, 'deer', 80.5, 60.5)
    const a = spawnEntity(sim, 80.5, 90.5)
    wound(sim, id, 10, a) // 45 → 35 PV : au-dessus du seuil
    expect(m.bleedMortal).toBeUndefined()
    expect(m.bleedUntil).toBeDefined()

    for (let t = 0; t < HUNT.LIGHT_BLEED_TICKS + 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(sim.entities.find((e) => e.id === id)).toBeDefined() // vivante
    expect(m.bleedUntil).toBeUndefined() // et la plaie s'est refermée
    const gouttes = sim.blood.length
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(sim.blood.length).toBeLessThanOrEqual(gouttes) // plus une goutte de plus
  })

  it('A11 — LE SANG AU SOL : des gouttes, bornées, et AUCUN événement', () => {
    const sim = makeSim()
    const { id } = pinBeast(sim, 'deer', 80.5, 60.5)
    const a = spawnEntity(sim, 80.5, 90.5)
    wound(sim, id, MONSTER_DEFS.deer.hp - 20, a)
    drainEvents(sim)
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(sim.blood.length).toBeGreaterThan(2) // elle sème
    expect(sim.blood.length).toBeLessThanOrEqual(HUNT.BLOOD_CAP) // et jamais au-delà du plafond
    // Haute fréquence ≠ domaine : aucune goutte n'entre dans le flux d'événements.
    const flux = drainEvents(sim).map((e) => e.type)
    expect(flux.some((t) => t.includes('blood'))).toBe(false)
  })

  it('A11 — un AVATAR qui saigne sème aussi (le sang est le sang)', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 80.5, 80.5)
    entity(sim, a).wounds.bleeding = true
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 1, dy: 0 }])
    expect(sim.blood.length).toBeGreaterThan(2)
  })

  it('A11 — les gouttes EXPIRENT : la piste refroidit', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 80.5, 80.5)
    entity(sim, a).wounds.bleeding = true
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 1, dy: 0 }])
    expect(sim.blood.length).toBeGreaterThan(0)
    delete entity(sim, a).wounds.bleeding
    for (let t = 0; t < HUNT.BLOOD_TTL + 10; t++) tick(sim)
    expect(sim.blood.length).toBe(0)
  })
})

describe('la bête diminuée et le couché (A12, C10-C11)', () => {
  it('A12 — DIMINUÉE : à moitié saignée, elle fuit mesurablement moins vite', () => {
    const course = (hp: number): number => {
      const sim = makeSim()
      const id = spawnMonster(sim, 'deer', 80.5, 110.5)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      entity(sim, id).hp = hp
      spawnEntity(sim, 80.5, 114.5)
      // Aucun input : l'avatar garde `gait: walk` (spawn) — il SONNE comme un
      // marcheur, et la bête le perçoit. Un `{dx:0,dy:0}` le mettrait à `still`,
      // donc quasi imperceptible : elle ne fuirait jamais, et le banc mesurerait
      // du BROUTAGE en croyant mesurer une fuite (piège payé une fois).
      for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && m.fleeSince < 0; t++) tick(sim)
      expect(m.fleeSince).toBeGreaterThanOrEqual(0)
      const from = { x: entity(sim, id).x, y: entity(sim, id).y }
      for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
      return dist(entity(sim, id), from)
    }
    const saine = course(MONSTER_DEFS.deer.hp)
    const saignee = course(Math.floor(MONSTER_DEFS.deer.hp * 0.3))
    expect(saignee).toBeLessThan(saine * 0.95)
  })

  it('A12 — LE COUCHÉ : à bout et non pressée, elle gagne un couvert et s’y tapit', () => {
    // Le cerf saigne en lisière de forêt : le meilleur couvert est à quelques tuiles.
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 55.5, 30.5) // prairie, à ~6 tuiles de la forêt (x<50)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const a = spawnEntity(sim, 55.5, 120.5) // très loin : aucune menace perçue
    // 45 → 22 PV : mortelle (< 22,5), mais il lui reste de quoi gagner le couvert.
    applyDamage(sim, entity(sim, id), MONSTER_DEFS.deer.hp - 22, a)
    expect(m.bleedMortal).toBe(true)

    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ && !m.bedded; t++) tick(sim)
    expect(m.bedded).toBe(true)
    // Tapie : sa perception s'est effondrée, et elle ne bouge plus.
    const at = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, id).x).toBe(at.x)
    expect(entity(sim, id).y).toBe(at.y)
    // Et elle s'est mise à COUVERT : sa tuile cache mieux que la prairie rase.
    const terrain = sim.map.terrain[Math.floor(at.y) * sim.map.width + Math.floor(at.x)]!
    expect(TERRAINS[terrain]!.cover).toBeLessThan(1)
  })

  it('A12 — RELANCÉE, la bête couchée repart (le sang ne la cloue pas au sol)', () => {
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 55.5, 30.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const a = spawnEntity(sim, 55.5, 120.5)
    applyDamage(sim, entity(sim, id), MONSTER_DEFS.deer.hp - 22, a) // mortelle, mais elle tient debout
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ && !m.bedded; t++) tick(sim)
    expect(m.bedded).toBe(true)

    // Le chasseur la retrouve : elle se relève et repart.
    const e = entity(sim, id)
    entity(sim, a).x = e.x
    entity(sim, a).y = e.y + 3
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(m.bedded).toBeUndefined()
    expect(m.fleeSince).toBeGreaterThanOrEqual(0)
  })
})

describe('le sang appelle les loups (A13, C12)', () => {
  it('A13 — la carcasse FRAÎCHE porte loin ; la vieille, non', () => {
    const essai = (age: number): boolean => {
      const sim = makeSim(2) // 2 h : les heures du loup
      const id = spawnMonster(sim, 'wolf', 30.5, 30.5)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      // Une carcasse à 25 tuiles : hors de CARCASS_SEEK (16), dans CARCASS_SEEK_FRESH (40).
      sim.corpses.push({
        id: sim.nextCorpseId++,
        x: 30.5,
        y: 55.5,
        inventory: inventoryOf(SLOTS.CORPSE, { raw_meat: 3 }),
        decayAt: 1e9,
        diedAt: sim.tick - age,
      })
      const from = dist(entity(sim, id), { x: 30.5, y: 55.5 })
      for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
      void m
      return dist(entity(sim, id), { x: 30.5, y: 55.5 }) < from - 2 // il s'en approche ?
    }
    expect(essai(0)).toBe(true) // fraîche : il la sent, il y va
    expect(essai(HUNT.CARCASS_FRESH_TICKS + 1)).toBe(false) // vieille : trop loin pour lui
  })

  it('A13 — le prédateur PRÉFÈRE ce qui saigne (y compris vous)', () => {
    const sim = makeSim(2)
    const wolfId = spawnMonster(sim, 'wolf', 30.5, 30.5)
    const wolf = sim.monsters.find((m) => m.entityId === wolfId)!
    // Deux hommes à la MÊME distance : l'un intact, l'autre qui saigne.
    const sain = spawnEntity(sim, 30.5, 38.5)
    const blesse = spawnEntity(sim, 30.5, 22.5)
    entity(sim, blesse).wounds.bleeding = true
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(wolf.targetId).toBe(blesse)
    void sain
  })

  it('A13 — LE BIAIS DE SPAWN : près d’une carcasse fraîche, le monde donne des prédateurs', () => {
    const sim = makeSim(2)
    expect(bloodBias(sim, 40.5, 40.5)).toBe(1) // rien : le monde est neutre
    sim.corpses.push({
      id: sim.nextCorpseId++,
      x: 40.5,
      y: 40.5,
      inventory: inventoryOf(SLOTS.CORPSE, { raw_meat: 3 }),
      decayAt: 1e9,
      diedAt: sim.tick,
    })
    expect(bloodBias(sim, 40.5, 40.5)).toBe(HUNT.BLOOD_PREDATOR_BIAS) // la mort appelle
    expect(bloodBias(sim, 120.5, 120.5)).toBe(1) // mais elle ne porte pas jusqu'au bout du monde
  })
})

/* ══ CHASSE III — LA RUSE (A15-A19) ══════════════════════════════════════════ */

describe('le crochet et le terrier (A16-A17, C15-C16)', () => {
  /**
   * LES JAMBES D'UNE FUITE : le cap tenu pendant chaque burst. Le crochet se
   * mesure LÀ — d'une jambe à l'autre — et pas sur un déplacement net, où deux
   * virages opposés s'annulent et donnent une belle ligne droite (le premier
   * banc s'y est laissé prendre : cos 0,993, alors que la bête zigzaguait).
   */
  function fleeLegs(sim: SimState, id: number, m: Monster, legs: number): { x: number; y: number }[] {
    const cycle = FAUNA.BURST_RUN_TICKS + FAUNA.BURST_PAUSE_TICKS
    const out: { x: number; y: number }[] = []
    let prev: { x: number; y: number } | null = null
    for (let n = 0; n < legs; n++) {
      // On se cale sur le DÉBUT d'un burst, puis on mesure la course seule.
      while (m.fleeSince >= 0 && (sim.tick - m.fleeSince) % cycle !== 0) tick(sim)
      if (m.fleeSince < 0) break
      const a = { x: entity(sim, id).x, y: entity(sim, id).y }
      for (let t = 0; t < FAUNA.BURST_RUN_TICKS - 2; t++) tick(sim)
      const b = { x: entity(sim, id).x, y: entity(sim, id).y }
      const v = { x: b.x - a.x, y: b.y - a.y }
      const l = Math.sqrt(v.x * v.x + v.y * v.y) // pas `hypot` : interdit dans /sim (invariant §2)
      if (l > 0.2) out.push({ x: v.x / l, y: v.y / l })
      prev = b
      tick(sim)
    }
    void prev
    return out
  }

  /** L'angle le plus fermé entre deux jambes consécutives (cos min = virage max). */
  function sharpestTurn(legs: { x: number; y: number }[]): number {
    let worst = 1
    for (let i = 1; i < legs.length; i++) {
      const cos = legs[i - 1]!.x * legs[i]!.x + legs[i - 1]!.y * legs[i]!.y
      worst = Math.min(worst, cos)
    }
    return worst
  }

  it('A16 — LE CROCHET : à découvert le lapin VIRE d’un burst à l’autre ; en COUVERT, il file droit', () => {
    const lever = (x: number, y: number): { sim: SimState; id: number; m: Monster } => {
      const sim = makeSim(6) // aube : les heures du lapin
      const id = spawnMonster(sim, 'rabbit', x, y)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      delete m.burrowX // on mesure le CROCHET, pas la course au trou
      delete m.burrowY
      spawnEntity(sim, x, y + 4) // pas d'input : il MARCHE, donc il s'entend
      for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && m.fleeSince < 0; t++) tick(sim)
      expect(m.fleeSince).toBeGreaterThanOrEqual(0)
      return { sim, id, m }
    }

    // À DÉCOUVERT (prairie rase, cover 1) : il crochète.
    const open = lever(80.5, 110.5)
    const openLegs = fleeLegs(open.sim, open.id, open.m, 4)
    expect(openLegs.length).toBeGreaterThanOrEqual(2)
    expect(sharpestTurn(openLegs)).toBeLessThan(0.9) // au moins un vrai virage (>25°)

    // EN COUVERT (pleine forêt) : il file. Le terrain décide du geste.
    const wood = lever(30.5, 40.5)
    const woodLegs = fleeLegs(wood.sim, wood.id, wood.m, 4)
    expect(woodLegs.length).toBeGreaterThanOrEqual(2)
    expect(sharpestTurn(woodLegs)).toBeGreaterThan(0.98) // tout droit
  })

  it('A17 — LE TERRIER : levé, le lapin court CHEZ LUI, et il y disparaît', () => {
    const sim = makeSim(6)
    const id = spawnMonster(sim, 'rabbit', 80.5, 100.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.burrowX = 80.5 // son trou est au NORD, à 12 tuiles
    m.burrowY = 88.5
    spawnEntity(sim, 80.5, 104.5) // le chasseur vient du SUD : la route est libre
    drainEvents(sim)

    let parti = false
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && !parti; t++) {
      tick(sim)
      parti = sim.entities.find((e) => e.id === id) === undefined
    }
    expect(parti).toBe(true) // il est rentré : la chasse est PERDUE
    expect(drainEvents(sim).some((e) => e.type === 'prey_escaped')).toBe(true)
  })

  it('A17 — mais un chasseur SUR la ligne du terrier le force au détour', () => {
    const sim = makeSim(6)
    const id = spawnMonster(sim, 'rabbit', 80.5, 100.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.burrowX = 80.5
    m.burrowY = 88.5 // le trou au nord…
    spawnEntity(sim, 80.5, 96.5) // …et le chasseur PLANTÉ DESSUS (au nord, entre les deux)
    for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(sim.entities.find((e) => e.id === id)).toBeDefined() // il n'a PAS pu rentrer
    // Il a fui à l'opposé (vers le sud) : la ligne était coupée.
    expect(entity(sim, id).y).toBeGreaterThan(100.5)
  })
})

describe('le vent (A18, C17)', () => {
  it('A18 — SOUS LE VENT, la bête ne sent rien ; AU VENT, elle sent tout', () => {
    // Le vent souffle vers l'EST (+x) : l'odeur d'un homme placé à l'OUEST du
    // cerf descend donc jusqu'à lui, quoi qu'il fasse.
    const essai = (dx: -1 | 1): number => {
      const sim = makeSim(12, { x: 1, y: 0 })
      const { m } = pinBeast(sim, 'deer', 80.5, 60.5, { x: 0, y: -1 }) // il regarde le NORD
      const a = spawnEntity(sim, 80.5 + dx * 12, 60.5) // à 12 tuiles, de flanc
      // Immobile ET accroupi : invisible et inaudible. Seul le NEZ peut le trahir.
      for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0, sneak: true }])
      return m.suspicion
    }
    const auVent = essai(-1) // à l'ouest : SON odeur descend le vent jusqu'au cerf
    const sousLeVent = essai(1) // à l'est : le vent emporte son odeur AILLEURS
    expect(auVent).toBeGreaterThanOrEqual(HUNT.SUSPICION_CURIOUS)
    expect(sousLeVent).toBeLessThan(0.05)
  })

  it('A18 — le vent TOURNE, et sans consommer un seul tirage du PRNG', () => {
    const sim = makeSim(12, { x: 1, y: 0 })
    const rng0 = sim.rngState
    const vents = new Set<string>()
    for (let t = 0; t < HUNT.WIND_SHIFT_TICKS * 6; t++) {
      tick(sim)
      vents.add(`${sim.wind.x},${sim.wind.y}`)
    }
    expect(vents.size).toBeGreaterThan(1) // il a tourné
    expect(sim.rngState).toBe(rng0) // et il n'a rien coûté au flux déterministe
  })
})

describe("l'appât et les piles au sol (A19, C18)", () => {
  /** Jette ce qu'on tient. */
  function drop(sim: SimState, id: number): void {
    tick(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'drop_held' } }])
  }

  it('A19 — JETER pose une pile, RAMASSER la reprend, et elle PÉRIT', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 80.5, 80.5)
    grantHeld(sim, a, 'berries')
    drop(sim, a)
    expect(sim.groundItems).toHaveLength(1)
    expect(sim.groundItems[0]!.item).toBe('berries')

    // On la ramasse : elle revient au sac.
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'pick_up', pileId: sim.groundItems[0]!.id } }])
    expect(sim.groundItems).toHaveLength(0)
    expect(countOf(inventoryOf(SLOTS.PLAYER, {}), 'berries')).toBe(0) // (garde de forme)

    // On la rejette, et on laisse le temps passer : le monde ne se jonche pas.
    drop(sim, a)
    expect(sim.groundItems).toHaveLength(1)
    for (let t = 0; t < HUNT.GROUND_TTL + 5; t++) tick(sim)
    expect(sim.groundItems).toHaveLength(0)
  })

  it("A19 — L'APPÂT : le lapin vient aux baies, et il n'y voit plus rien", () => {
    const sim = makeSim(6)
    const id = spawnMonster(sim, 'rabbit', 80.5, 100.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    delete m.burrowX
    delete m.burrowY
    // Les baies posées à 6 tuiles, et personne alentour.
    sim.groundItems.push({ id: 1, x: 80.5, y: 106.5, item: 'berries', count: 1, expiresAt: 1e9 })
    sim.nextGroundItemId = 2

    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && m.baitUntil === undefined; t++) tick(sim)
    expect(m.baitUntil).toBeDefined() // il mange
    expect(dist(entity(sim, id), { x: 80.5, y: 106.5 })).toBeLessThanOrEqual(HUNT.BAIT_RANGE + 0.1)
  })

  it('A19 — LA VIANDE JETÉE détourne une meute : elle mange au lieu de mordre', () => {
    const sim = makeSim(2)
    const ids = [spawnMonster(sim, 'wolf', 30.5, 30.5), spawnMonster(sim, 'wolf', 31.5, 30.5), spawnMonster(sim, 'wolf', 32.5, 30.5)]
    const pack = ids.map((id) => sim.monsters.find((m) => m.entityId === id)!)
    pack.forEach((m) => (m.herdId = 7))
    const a = spawnEntity(sim, 31.5, 38.5) // à 8 tuiles, et il MARCHE : ils l'ont choisi
    grantHeld(sim, a, 'raw_meat')
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(pack.some((m) => m.targetId === a)).toBe(true) // la meute vient

    // ON JETTE LA VIANDE. Le geste que faune R15 promettait, enfin exécutable.
    drop(sim, a)
    expect(sim.groundItems).toHaveLength(1)
    let mange = false
    for (let t = 0; t < 25 * BALANCE.TICK_RATE_HZ && !mange; t++) {
      tick(sim)
      mange = pack.some((m) => m.eatingUntil !== undefined)
    }
    expect(mange).toBe(true) // ils ont autre chose à faire que vous
  })
})

describe('le déterminisme des paliers II-III (A14)', () => {
  it('A14 — replay : sang, couché, vent, piles et crochet tiennent au bit près', () => {
    // Un monde qui exerce TOUT ce que les paliers II et III ont ajouté : une bête
    // blessée qui saigne et se couche, un lapin qui crochète et court au terrier,
    // un loup qui sent la carcasse, du vent qui tourne, une pile jetée au sol.
    const script = (): { state: string; events: unknown[] } => {
      const sim = makeSim(2, { x: 1, y: 0 }) // 2 h : les loups ; et il y a du VENT
      const cerf = spawnMonster(sim, 'deer', 80.5, 60.5)
      const lapin = spawnMonster(sim, 'rabbit', 90.5, 70.5)
      spawnMonster(sim, 'wolf', 40.5, 40.5)
      const a = spawnEntity(sim, 80.5, 66.5)
      grantHeld(sim, a, 'berries')

      applyDamage(sim, entity(sim, cerf), MONSTER_DEFS.deer.hp - 20, a) // plaie MORTELLE
      sim.corpses.push({
        id: sim.nextCorpseId++,
        x: 45.5,
        y: 45.5,
        inventory: inventoryOf(SLOTS.CORPSE, { raw_meat: 3 }),
        decayAt: 1e9,
        diedAt: sim.tick,
      })
      void lapin

      for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) {
        const action = t === 20 ? ({ type: 'drop_held' } as const) : undefined
        tick(sim, [{ entityId: a, dx: t % 3 === 0 ? 1 : 0, dy: 0, sneak: t % 7 === 0, ...(action ? { action } : {}) }])
      }
      return { state: JSON.stringify(sim), events: drainEvents(sim) }
    }
    const un = script()
    const deux = script()
    expect(un.state).toBe(deux.state)
    expect(un.events).toEqual(deux.events)
    // Et le monde a bien VÉCU : du sang, une pile, un vent.
    const etat = JSON.parse(un.state) as SimState
    expect(etat.blood.length).toBeGreaterThan(0)
    expect(etat.groundItems.length + etat.monsters.filter((m) => m.baitUntil !== undefined).length).toBeGreaterThan(0)
  })
})
