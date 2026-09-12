/**
 * ═══ LA PISTE DE SANG (spec `piste-de-sang.md`) — critères PA1-PA8 ═══
 *
 * Trois décisions d'Alexis du 2026-09-12 : les loups VIVANTS remontent le sang (sol et eau, une
 * seule règle) ; la piste GUIDE, elle ne réveille pas ; EN SILENCE jusqu'au contact. PA9 (le
 * déterminisme et le coût) se relève hors suite : `tools/empreinte-sim.mts` avant/après, et la
 * sonde `tools/__cout-piste.mts`.
 *
 * Le montage : une forêt nue (le loup y est chez lui — `goHome` ne le tire nulle part), l'heure
 * du loup (2 h), un rôdeur de nuit (`nightHunter` : il CHASSE, sans meute ni gîte) et un avatar
 * qui saigne. Les pistes sont soit VERSÉES par le vrai chemin (`advanceBlood`, l'avatar marche
 * en saignant), soit POSÉES à la main quand c'est la géométrie qu'on éprouve (PA3, PA8) — les
 * gouttes sont de l'état, la spec le dit, et un tableau écrit à la main est le même tableau.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, FAUNA, HUNT, MONSTER_DEFS, PISTE, SANG, STRUCTURE_HP, TERRAIN_DEEP_WATER, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_MARSH, TERRAIN_SHALLOW_WATER } from './balance'
import { attacheAuFil } from './coulee'
import { drainEvents, type SimEvent } from './events'
import { distSq } from './geometry'
import { createEmptyMap, setTile, type WorldMap } from './map'
import { spawnMonster, type Monster } from './monsters'
import { spawnPoiMonsters } from './poi'
import { createSim, spawnEntity, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { EAU } from './zonegen-water'

/* ─── LE BANC ─────────────────────────────────────────────────────────────────────── */

const HEURE_DU_LOUP = 2

function entity(s: SimState, id: number): Entity {
  return s.entities.find((e) => e.id === id)!
}

function foret(): WorldMap {
  return createEmptyMap(200, 200, TERRAIN_FOREST)
}

function sim(map: WorldMap = foret(), seed = 7): SimState {
  return createSim(seed, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(HEURE_DU_LOUP, 1) })
}

/** Un rôdeur de nuit : il CHASSE (P1) sans meute ni gîte, et il est brave seul. */
function rodeur(s: SimState, x: number, y: number): Monster {
  const id = spawnMonster(s, 'wolf', x, y)
  const m = s.monsters.find((mm) => mm.entityId === id)!
  m.nightHunter = true
  return m
}

/** Un avatar posé là, qui saigne (ou non) — le sang est le sang, même passe que les bêtes. */
function homme(s: SimState, x: number, y: number, saigne: boolean): number {
  const id = spawnEntity(s, x, y)
  if (saigne) entity(s, id).wounds.bleeding = true
  return id
}

/** Il MARCHE `n` ticks vers (dx, dy) ; sa plaie ne le tue pas pendant le banc. */
function marche(s: SimState, id: number, n: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
  for (let t = 0; t < n; t++) {
    step(s, [{ entityId: id, dx, dy }])
    entity(s, id).hp = 100
  }
}

/** Il PIÉTINE (un pas à droite, un pas à gauche) : figé en forêt il serait quasi invisible, et
 *  l'acquisition — qui n'est pas ce qu'on mesure — ne viendrait jamais (patron de `loup.test`). */
function pietine(id: number, t: number): MoveInput[] {
  return [{ entityId: id, dx: t % 2 === 0 ? 1 : -1, dy: 0 }]
}

function evenements(s: SimState, type: SimEvent['type']): SimEvent[] {
  return drainEvents(s).filter((e) => e.type === type)
}

/** Une piste POSÉE : `n` gouttes de `x0` vers l'est, une par `BLOOD_EVERY_TICKS`, de plus en
 *  plus fraîches — le pas de marche d'un homme (4 t/s × 0,8 s = 3,2 tuiles), sous `PISTE.PAS`. */
function poseLaPiste(s: SimState, x0: number, y: number, n: number, etage?: number, homme: boolean = true): void {
  const pas = BALANCE.WALK_SPEED_TILES_PER_S * (HUNT.BLOOD_EVERY_TICKS / BALANCE.TICK_RATE_HZ)
  for (let k = 0; k < n; k++) {
    s.blood.push({ x: x0 + k * pas, y, tick: s.tick - (n - k) * HUNT.BLOOD_EVERY_TICKS, ...(etage !== undefined ? { etage } : {}), ...(homme ? { homme: true as const } : {}) })
  }
}

/* ─── PA1 / PA2 — IL VIENT DE LOIN, ET EN SILENCE ──────────────────────────────────── */

/** L'avatar part de (60,100) et s'éloigne de 40 tuiles vers l'est en saignant (ou non) ; PUIS le
 *  loup est posé sur le DÉPART de la piste — il ne l'a jamais vu, et l'homme est au-delà de
 *  `aggroRange` ET de `PURSUIT_RANGE`. Rend le montage prêt à jouer. */
function loinDerriere(saigne: boolean): { s: SimState; loup: Monster; a: number } {
  const s = sim()
  const a = homme(s, 60.5, 100.5, saigne)
  marche(s, a, 200, 1, 0) // 10 s à 4 t/s : 40 tuiles de piste
  const e = entity(s, a)
  expect(e.x, 'la prémisse : il est parti loin').toBeGreaterThan(60.5 + FAUNA.PURSUIT_RANGE + 5)
  const loup = rodeur(s, 61.5, 100.5)
  drainEvents(s)
  return { s, loup, a }
}

describe('PA1 — il vient de loin : la piste mène à qui saigne', () => {
  it('l’homme est à 40 tuiles, hors de vue et hors de poursuite ; le loup remonte le sang et le PREND POUR CIBLE', () => {
    const { s, loup, a } = loinDerriere(true)
    const loupE = entity(s, loup.entityId)
    const distDepart = Math.sqrt(distSq(loupE.x, loupE.y, entity(s, a).x, entity(s, a).y))
    expect(distDepart).toBeGreaterThan(FAUNA.PURSUIT_RANGE)
    let acquisAu = -1
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ && acquisAu < 0; t++) {
      step(s, pietine(a, t))
      entity(s, a).hp = 100
      if (loup.targetId === a) acquisAu = t
    }
    expect(acquisAu, 'il n’a jamais pris l’homme pour cible').toBeGreaterThanOrEqual(0)
    const d = Math.sqrt(distSq(loupE.x, loupE.y, entity(s, a).x, entity(s, a).y))
    expect(d, 'et il est venu à portée').toBeLessThanOrEqual(MONSTER_DEFS.wolf.aggroRange + 1)
    expect(loup.piste, 'la piste est effacée à l’acquisition').toBeUndefined()
  })

  it('LE TÉMOIN : le même montage, l’homme ne saigne pas — le loup ne vient pas', () => {
    const { s, loup, a } = loinDerriere(false)
    expect(s.blood.length, 'la prémisse du témoin : aucune goutte').toBe(0)
    const loupE = entity(s, loup.entityId)
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, pietine(a, t))
      expect(loup.targetId).not.toBe(a)
    }
    const d = Math.sqrt(distSq(loupE.x, loupE.y, entity(s, a).x, entity(s, a).y))
    expect(d, 'il est resté loin').toBeGreaterThan(FAUNA.PURSUIT_RANGE)
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
  })
})

describe('PA2 — en silence : pas un hurlement avant le contact', () => {
  it('UN `wolf_on_trail` à la prise, ZÉRO `wolf_howl` pendant la remontée, UN à l’acquisition', () => {
    const { s, loup, a } = loinDerriere(true)
    let hurlementsAvant = 0
    let prises = 0
    let acquis = false
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ && !acquis; t++) {
      step(s, pietine(a, t))
      entity(s, a).hp = 100
      for (const e of drainEvents(s)) {
        if (e.type === 'wolf_on_trail') prises++
        if (e.type === 'wolf_howl') hurlementsAvant++
      }
      if (loup.targetId === a) acquis = true
    }
    expect(acquis).toBe(true)
    expect(prises, 'la prise de piste est UN fait, pas un par tick').toBe(1)
    // Le hurlement de l'acquisition tombe au tick même où la cible est prise : il est compté
    // dans la boucle ci-dessus. Un seul, donc — et aucun AVANT.
    expect(hurlementsAvant, 'un seul hurlement, celui du contact').toBe(1)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) step(s, pietine(a, t))
    expect(evenements(s, 'wolf_howl'), 'et il ne se répète pas').toHaveLength(0)
  })
})

/* ─── PA3 — LA PISTE A UN SENS ─────────────────────────────────────────────────────── */

describe('PA3 — la piste a un sens : le temps donne la direction', () => {
  it('posé au MILIEU d’une piste, le loup va vers le bout FRAIS — jamais vers la queue', () => {
    const s = sim()
    s.tick += 2000
    poseLaPiste(s, 60, 100.5, 30) // de x=60 (vieille) à x≈153 (fraîche)
    const tete = s.blood[s.blood.length - 1]!
    const queue = s.blood[0]!
    const loup = rodeur(s, 106.5, 100.5) // au milieu, sur la piste
    const e = entity(s, loup.entityId)
    let dTete = Math.sqrt(distSq(e.x, e.y, tete.x, tete.y))
    let xMin = e.x
    for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, [])
      const d = Math.sqrt(distSq(e.x, e.y, tete.x, tete.y))
      expect(d, `au tick ${t}, la distance à la tête ne remonte pas`).toBeLessThanOrEqual(dTete + 0.01)
      dTete = d
      xMin = Math.min(xMin, e.x)
    }
    expect(xMin, 'il n’a jamais reculé vers la queue').toBeGreaterThanOrEqual(106.5 - 0.5)
    expect(e.x, 'il a bien avancé vers la tête').toBeGreaterThan(106.5 + 15)
    expect(Math.sqrt(distSq(e.x, e.y, queue.x, queue.y))).toBeGreaterThan(40)
  })
})

/* ─── PA4 — ELLE GUIDE, ELLE NE RÉVEILLE PAS ───────────────────────────────────────── */

const DEN = { x: 100, y: 100 }
/** Le gîte du banc de `loup.test` : une Louvière poussée à la main, peuplée par l'hôte. */
function gite(): { s: SimState; adultes: Monster[]; alpha: Monster; centre: { x: number; y: number } } {
  const map = foret()
  map.zones.push({ name: 'la Louvière I', x: DEN.x, y: DEN.y, w: 3, h: 3, kind: 'louviere' })
  const s = createSim(4242, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(HEURE_DU_LOUP, 1) })
  spawnPoiMonsters(s, 4242)
  const clan = s.monsters.filter((m) => m.homePoi !== undefined && m.petit !== true)
  const alpha = clan.find((m) => m.alpha === true)!
  return { s, adultes: clan, alpha, centre: { x: DEN.x + 1.5, y: DEN.y + 1.5 } }
}

/** Une piste qui TRAVERSE le gîte, versée par un homme qui saigne d'ouest en est. */
function pisteATraversLeGite(s: SimState): number {
  const a = homme(s, DEN.x - 20 + 0.5, DEN.y + 1.5, true)
  marche(s, a, 220, 1, 0) // 44 tuiles : il ressort loin à l'est
  expect(entity(s, a).x).toBeGreaterThan(DEN.x + 20)
  drainEvents(s)
  return a
}

describe('PA4 — elle guide, elle ne réveille pas (L5, R15)', () => {
  it('un clan TRANQUILLE (non affamé, sans sortie) la laisse passer : la vie du gîte continue, personne ne la remonte', () => {
    const { s, adultes, centre } = gite()
    for (const m of adultes) m.faim = 0.2 // repus : sous FAIM_DEPART, pas de sortie
    const a = pisteATraversLeGite(s)
    // La garde L5 telle qu'elle est écrite (`loup.test.ts`) : la RONDE sort de `DEN_HOME_RADIUS`
    // — un adulte à la fois, jamais au-delà de `DEN_PATROL_RADIUS`. Ce qu'on affirme ici, c'est
    // que la piste n'y change RIEN : le rayon de la ronde tient, et personne ne part vers l'est.
    let pireDehors = 0
    for (let t = 0; t < 15 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, pietine(a, t))
      entity(s, a).hp = 100
      let dehors = 0
      for (const m of adultes) {
        const e = entity(s, m.entityId)
        const d = Math.sqrt(distSq(e.x, e.y, centre.x, centre.y))
        if (d > FAUNA.DEN_HOME_RADIUS + 1) dehors++
        expect(d, 'personne ne quitte l’emprise de la ronde').toBeLessThanOrEqual(FAUNA.DEN_PATROL_RADIUS + 4)
      }
      pireDehors = Math.max(pireDehors, dehors)
    }
    expect(pireDehors, 'la ronde est SEULE : un adulte à la fois').toBeLessThanOrEqual(1)
    for (const m of adultes) {
      expect(m.piste).toBeUndefined()
      expect(m.pisteEau).toBeUndefined()
    }
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
  })

  /** Un SOLITAIRE posé sur le départ d'une piste que l'homme a laissée derrière lui — et l'homme
   *  est hors de vue : ce qui sépare les deux montages est la seule condition de chasse. */
  function solitaireSurLaPiste(faim: number): { s: SimState; loup: Monster; a: number } {
    const s = sim()
    const a = homme(s, 60.5, 100.5, true)
    marche(s, a, 200, 1, 0)
    const id = spawnMonster(s, 'wolf', 61.5, 100.5)
    const loup = s.monsters.find((mm) => mm.entityId === id)!
    loup.faim = faim // pas de `nightHunter` : c'est la FAIM qui décide de la sortie (L7, solitaire)
    drainEvents(s)
    return { s, loup, a }
  }

  it('un solitaire TRANQUILLE (repu, sans sortie) posé sur la piste ne la prend pas', () => {
    const { s, loup, a } = solitaireSurLaPiste(0.2)
    const e = entity(s, loup.entityId)
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, pietine(a, t))
      entity(s, a).hp = 100
    }
    expect(loup.sortie, 'la prémisse : il n’est pas en chasse').toBeUndefined()
    expect(loup.piste).toBeUndefined()
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
    expect(e.x, 'il n’a pas remonté la piste').toBeLessThan(61.5 + 10)
  })

  it('LE TÉMOIN : le même solitaire AFFAMÉ part en sortie — et la suit', () => {
    const { s, loup, a } = solitaireSurLaPiste(1)
    const e = entity(s, loup.entityId)
    let prises = 0
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, pietine(a, t))
      entity(s, a).hp = 100
      prises += evenements(s, 'wolf_on_trail').length
    }
    expect(loup.sortie, 'la prémisse : la faim l’a mis en chasse').toBe(true)
    expect(prises, 'il a pris la piste').toBe(1)
    expect(e.x, 'et il l’a remontée').toBeGreaterThan(61.5 + 20)
  })

  it('un loup REPU (`satedUntil`) ne la suit pas, même rôdeur de nuit', () => {
    const s = sim()
    const a = homme(s, 60.5, 100.5, true)
    marche(s, a, 200, 1, 0)
    const loup = rodeur(s, 61.5, 100.5)
    loup.satedUntil = s.tick + 100_000
    drainEvents(s)
    const e = entity(s, loup.entityId)
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) step(s, pietine(a, t))
    expect(loup.piste).toBeUndefined()
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
    expect(e.x, 'il n’a pas remonté la piste').toBeLessThan(61.5 + 10)
  })
})

/* ─── P1 — UN LOUP QUI SAIGNE NE PISTE PAS ─────────────────────────────────────────── */

describe('P1 — un loup qui SAIGNE ne piste pas : ses propres gouttes ne sont pas une piste', () => {
  it('blessé léger, en chasse, sans cible : il ne prend pas son propre sang, et il ne reste pas planté dessus', () => {
    const s = sim()
    const loup = rodeur(s, 100.5, 100.5)
    loup.bleedUntil = s.tick + 100_000 // une plaie légère qui coule tout le banc
    entity(s, loup.entityId).hp = MONSTER_DEFS.wolf.hp // au-dessus du seuil de rompue
    const e = entity(s, loup.entityId)
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) step(s, [])
    expect(s.blood.length, 'la prémisse : il a bien laissé son sang derrière lui').toBeGreaterThan(5)
    expect(loup.piste).toBeUndefined()
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
    expect(Math.sqrt(distSq(e.x, e.y, 100.5, 100.5)), 'il vit sa vie de chasse — il a bougé').toBeGreaterThan(1)
  })

  it('le FRÈRE qui saigne à côté : le sang d’une bête n’est pas une piste — zéro prise, et personne n’est cloué', () => {
    // Quand le sang était le sang (première écriture), MESURÉ (`tools/__frere-qui-saigne.mts`,
    // 3 graines) : le second loup prenait et reperdait la piste vivante de son frère à chaque
    // goutte neuve — 9 à 23 `wolf_on_trail` par 90 s, sans que ça change sa marche. Le tri par
    // `homme` (P1) l'éteint à la source : le frère n'a pas de piste.
    const s = sim()
    const frere = rodeur(s, 100.5, 100.5)
    frere.bleedUntil = s.tick + 60 * BALANCE.TICK_RATE_HZ
    entity(s, frere.entityId).hp = MONSTER_DEFS.wolf.hp
    const loup = rodeur(s, 104.5, 100.5)
    const e = entity(s, loup.entityId)
    let prises = 0
    for (let t = 0; t < 90 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, [])
      prises += evenements(s, 'wolf_on_trail').length
      expect(loup.piste, 'jamais sur la piste du frère').toBeUndefined()
    }
    expect(s.blood.length, 'la prémisse : le frère a bien saigné').toBeGreaterThan(5)
    expect(prises).toBe(0)
    expect(Math.sqrt(distSq(e.x, e.y, 104.5, 100.5)), 'et il vit sa vie de chasse').toBeGreaterThan(1)
  })
})

describe('P1 — le sang de l’HOMME seulement : la goutte dit qui saigne', () => {
  // MESURÉ sans ce tri, sur le banc A26 de `faune.test.ts` (quatre loups ambiants, un coin de
  // trente bêtes, 2 h du matin, 150 s) : 9 → 19 sangliers tués par les loups, le coin vidé de
  // 15 à 5 bêtes, et deux fois plus de loups tués par les sangliers qu'ils talonnaient. R18
  // (« le reste du coin va au gibier ») tombait ; la spec vise l'homme qui saigne et sa parade.
  it('la goutte d’une bête ne porte pas `homme`, celle d’un avatar si — et la souillure retient l’homme qui y a saigné, même après la bête', () => {
    // Deux marais (ils se souillent toujours, Q7) : la bête saigne dans l'un, l'homme dans l'autre.
    const map = foret()
    for (let y = 116; y <= 124; y++) for (let x = 116; x <= 124; x++) setTile(map, x, y, TERRAIN_MARSH)
    for (let y = 99; y <= 101; y++) for (let x = 99; x <= 101; x++) setTile(map, x, y, TERRAIN_MARSH)
    const s = sim(map)
    const bete = rodeur(s, 120.5, 120.5)
    bete.bleedUntil = s.tick + 100_000
    entity(s, bete.entityId).hp = MONSTER_DEFS.wolf.hp
    homme(s, 100.5, 100.5, true)
    for (let t = 0; t < 8; t++) step(s, []) // la première goutte de la bête tombe au premier tick, dans son marais
    for (let t = 0; t < HUNT.BLOOD_EVERY_TICKS; t++) step(s, []) // et l'homme goutte sur `tick % BLOOD_EVERY_TICKS`
    const deBete = s.blood.filter((g) => g.x >= 116 && g.x < 125)
    const dHomme = s.blood.filter((g) => Math.abs(g.x - 100.5) < 1 && Math.abs(g.y - 100.5) < 1)
    expect(deBete.length, 'la prémisse : la bête a saigné').toBeGreaterThan(0)
    expect(dHomme.length, 'la prémisse : l’homme a saigné').toBeGreaterThan(0)
    for (const g of deBete) expect(g.homme).toBeUndefined()
    for (const g of dHomme) expect(g.homme).toBe(true)
    const iHomme = 100 * s.map.width + 100
    const sBete = s.souillures.find((t) => t.i !== iHomme)
    const sHomme = s.souillures.find((t) => t.i === iHomme)
    expect(sBete, 'la prémisse : le marais de la bête est souillé').toBeDefined()
    expect(sBete!.homme).toBeUndefined()
    expect(sHomme?.homme).toBe(true)
    // L'homme vient saigner là où la bête a saigné : la souillure RAFRAÎCHIE retient l'homme.
    const ox = sBete!.i % s.map.width
    const oy = (sBete!.i - ox) / s.map.width
    homme(s, ox + 0.5, oy + 0.5, true)
    for (let t = 0; t < HUNT.BLOOD_EVERY_TICKS; t++) step(s, [])
    expect(s.souillures.find((t) => t.i === sBete!.i)?.homme, 'rafraîchie par l’homme').toBe(true)
  })

  it('AU SOL : la même piste, posée par une bête, n’est pas remontée — le TÉMOIN d’homme l’est', () => {
    const joue = (deLHomme: boolean): { prises: number; piste: number | undefined; avance: number } => {
      const s = sim()
      s.tick += 2000 // des ticks de goutte positifs (comme PA3)
      poseLaPiste(s, 60.5, 100.5, 12, undefined, deLHomme)
      const loup = rodeur(s, 61.5, 100.5)
      const e = entity(s, loup.entityId)
      drainEvents(s)
      let prises = 0
      for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) {
        step(s, [])
        prises += evenements(s, 'wolf_on_trail').length
      }
      return { prises, piste: loup.piste, avance: e.x - 61.5 }
    }
    const bete = joue(false)
    expect(bete.prises).toBe(0)
    expect(bete.piste).toBeUndefined()
    const temoin = joue(true)
    expect(temoin.prises).toBe(1)
    expect(temoin.avance, 'le témoin : il remonte vers l’est').toBeGreaterThan(bete.avance + 5)
  })
})

/* ─── PA5 — L'EAU PORTE L'APPEL VERS L'AMONT ───────────────────────────────────────── */

const RIVIERE_Y = 30
const X0 = 5
const X1 = 150
/** Une rivière horizontale, le fil peint amont → aval (x croissant) — le banc de `qualite-eau`. */
function carteRiviere(): WorldMap {
  const map = createEmptyMap(160, 60, TERRAIN_GRASS)
  const fil: number[] = []
  for (let x = X0; x <= X1; x++) {
    for (let dy = -EAU.RIVIERE_DEMI_LIT; dy <= EAU.RIVIERE_DEMI_LIT; dy++) setTile(map, x, RIVIERE_Y + dy, TERRAIN_SHALLOW_WATER)
    setTile(map, x, RIVIERE_Y, TERRAIN_DEEP_WATER)
    fil.push(RIVIERE_Y * map.width + x)
  }
  map.fil = fil
  return map
}

const Y_HAUT = 20
const Y_BAS = 25
const X_COUDE = 60
/** Le méandre de `qualite-eau` (A2bis) : l'amont vers l'est à `Y_HAUT`, le coude, l'aval vers
 *  l'ouest à `Y_BAS` — les deux biefs à portée d'attache d'une même tuile. */
function carteMeandre(): WorldMap {
  const map = createEmptyMap(80, 50, TERRAIN_GRASS)
  const fil: number[] = []
  const pousse = (x: number, y: number): void => {
    for (let dy = -EAU.RIVIERE_DEMI_LIT; dy <= EAU.RIVIERE_DEMI_LIT; dy++) setTile(map, x, y + dy, TERRAIN_SHALLOW_WATER)
    setTile(map, x, y, TERRAIN_DEEP_WATER)
    fil.push(y * map.width + x)
  }
  for (let x = X0; x <= X_COUDE; x++) pousse(x, Y_HAUT)
  for (let y = Y_HAUT + 1; y <= Y_BAS; y++) pousse(X_COUDE, y)
  for (let x = X_COUDE - 1; x >= X0; x--) pousse(x, Y_BAS)
  map.fil = fil
  return map
}

/** Une souillure à pleine force dans le gué de `(tx, ty)`, attachée au fil comme la vraie —
 *  du sang d'homme, sauf à dire le contraire. */
function souille(s: SimState, tx: number, ty: number, homme: boolean = true): void {
  s.souillures.push({ i: ty * s.map.width + tx, tick: s.tick, crans: 4, pas: attacheAuFil(s.map, tx, ty), ...(homme ? { homme: true as const } : {}) })
}

/** Le loup est-il plus près de l'origine qu'au départ, d'au moins `gain` tuiles ? */
function gagne(s: SimState, loup: Monster, ox: number, oy: number, ticks: number): number {
  const e = entity(s, loup.entityId)
  const avant = Math.sqrt(distSq(e.x, e.y, ox, oy))
  for (let t = 0; t < ticks; t++) step(s, [])
  return avant - Math.sqrt(distSq(e.x, e.y, ox, oy))
}

describe('PA5 — l’eau porte l’appel vers l’AMONT', () => {
  const GUE_X = 60
  const GUE_Y = RIVIERE_Y + EAU.RIVIERE_DEMI_LIT // le bord du lit, en haut-fond
  const BERGE_Y = GUE_Y + 1 // la berge : à ≤ FLAIR de l'eau teinte

  it('posé en AVAL, hors de vue, le loup gagne l’origine — et annonce la prise une fois', () => {
    const s = sim(carteRiviere())
    souille(s, GUE_X, GUE_Y)
    expect(s.souillures[0]!.pas, 'la prémisse : la souillure est sur le fleuve').toBeGreaterThanOrEqual(0)
    const loup = rodeur(s, GUE_X + 30 + 0.5, BERGE_Y + 0.5) // 30 pas en aval, sur la berge
    drainEvents(s)
    const gain = gagne(s, loup, GUE_X + 0.5, GUE_Y + 0.5, 4 * BALANCE.TICK_RATE_HZ)
    expect(gain, 'il a remonté vers l’origine').toBeGreaterThan(10)
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(1)
  })

  it('LE TÉMOIN : le même loup posé en AMONT n’est pas appelé', () => {
    const s = sim(carteRiviere())
    souille(s, GUE_X, GUE_Y)
    const loup = rodeur(s, GUE_X - 30 + 0.5, BERGE_Y + 0.5) // 30 pas en amont
    drainEvents(s)
    const gain = gagne(s, loup, GUE_X + 0.5, GUE_Y + 0.5, 4 * BALANCE.TICK_RATE_HZ)
    expect(gain, 'il n’a pas descendu vers l’origine').toBeLessThan(5)
    expect(loup.pisteEau).toBeUndefined()
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
  })

  it('DANS L’EAU : une eau où seule une bête a saigné n’appelle personne (P1)', () => {
    const s = sim(carteRiviere())
    souille(s, GUE_X, GUE_Y, false)
    const loup = rodeur(s, GUE_X + 30 + 0.5, BERGE_Y + 0.5) // le montage exact de la prise, en aval
    drainEvents(s)
    const gain = gagne(s, loup, GUE_X + 0.5, GUE_Y + 0.5, 4 * BALANCE.TICK_RATE_HZ)
    expect(gain, 'il n’a pas remonté').toBeLessThan(5)
    expect(loup.pisteEau).toBeUndefined()
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
  })

  it('au-delà de `DILUTION_PAS` pas en aval, la rivière s’est lavée : rien', () => {
    const s = sim(carteRiviere())
    souille(s, GUE_X, GUE_Y)
    const loup = rodeur(s, GUE_X + SANG.DILUTION_PAS + 8 + 0.5, BERGE_Y + 0.5)
    drainEvents(s)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) step(s, [])
    expect(loup.pisteEau).toBeUndefined()
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
  })

  it('arrivé à l’origine sans une goutte au sol, il LÂCHE — et ne reprend pas la même eau en boucle', () => {
    const s = sim(carteRiviere())
    souille(s, GUE_X, GUE_Y)
    const loup = rodeur(s, GUE_X + 12 + 0.5, BERGE_Y + 0.5)
    drainEvents(s)
    let prises = 0
    for (let t = 0; t < 12 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, [])
      prises += evenements(s, 'wolf_on_trail').length
    }
    expect(loup.pisteEau, 'plus de trajet d’eau').toBeUndefined()
    expect(loup.pisteVue, 'le sang consommé est mémorisé').toBeDefined()
    expect(prises, 'UNE prise pour toute la scène').toBe(1)
  })

  it('LE MÉANDRE NE COUD PAS : posé dans le bief d’EN FACE, à portée de flair du bief saigné, il n’est pas appelé', () => {
    const s = sim(carteMeandre())
    const X_VERSE = 30
    souille(s, X_VERSE, Y_HAUT + 1) // dans le bief AMONT (à 1 de son fil, à 4 de l'autre)
    expect(s.souillures[0]!.pas, 'la prémisse : la souillure est attachée à l’AMONT').toBeLessThanOrEqual(X_COUDE - X0)
    // Le loup dans l'eau du bief AVAL, une tuile sous SON fil : à 6 du fil amont — dans la borne
    // `ATTACHE + FLAIR`, donc un « premier pas trouvé » l'aurait attaché à l'amont, n = 0, appelé.
    const loup = rodeur(s, X_VERSE + 0.5, Y_BAS + 1 + 0.5)
    drainEvents(s)
    expect(Y_BAS + 1 - Y_HAUT).toBeLessThanOrEqual(SANG.ATTACHE + PISTE.FLAIR)
    expect(attacheAuFil(s.map, X_VERSE, Y_BAS + 1), 'la prémisse : sa tuile s’attache au bief AVAL').toBeGreaterThan(X_COUDE - X0)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) step(s, [])
    expect(loup.pisteEau).toBeUndefined()
    expect(evenements(s, 'wolf_on_trail')).toHaveLength(0)
  })
})

/* ─── PA6 — ELLE SE PERD ───────────────────────────────────────────────────────────── */

describe('PA6 — elle se perd : le blessé a bandé', () => {
  it('le loup atteint la dernière goutte, puis reprend sa vie — il ne reste pas planté, et ne reprend pas sa propre piste', () => {
    const s = sim()
    const a = homme(s, 60.5, 100.5, true)
    marche(s, a, 100, 1, 0) // 20 tuiles de sang…
    delete entity(s, a).wounds.bleeding // …il bande…
    marche(s, a, 150, 1, 0) // …et s'en va 30 tuiles plus loin, sans une goutte
    const derniere = s.blood[s.blood.length - 1]!
    expect(derniere.x).toBeLessThan(85)
    const loup = rodeur(s, 61.5, 100.5)
    drainEvents(s)
    const e = entity(s, loup.entityId)
    let perduAu = -1
    let prises = 0
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && perduAu < 0; t++) {
      step(s, pietine(a, t))
      prises += evenements(s, 'wolf_on_trail').length
      if (loup.pisteVue !== undefined && loup.piste === undefined) perduAu = t
    }
    expect(perduAu, 'il a perdu la piste').toBeGreaterThanOrEqual(0)
    expect(Math.sqrt(distSq(e.x, e.y, derniere.x, derniere.y)), 'au bout de la piste').toBeLessThanOrEqual(PISTE.FLAIR + 0.5)
    expect(loup.targetId, 'l’homme est hors de portée : pas de cible').not.toBe(a)
    // Et ensuite : il vit — pas de reprise en boucle, et il n'est pas cloué sur la goutte.
    const xPerdu = e.x
    const yPerdu = e.y
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, pietine(a, t))
      prises += evenements(s, 'wolf_on_trail').length
    }
    expect(prises, 'UNE prise, jamais une reprise de la même piste').toBe(1)
    expect(loup.piste).toBeUndefined()
    expect(Math.sqrt(distSq(e.x, e.y, xPerdu, yPerdu)), 'il a bougé depuis').toBeGreaterThan(0.5)
  })
})

/* ─── PA7 — LE FEU TIENT ───────────────────────────────────────────────────────────── */

describe('PA7 — le Feu tient', () => {
  it('une piste qui mène à un homme au Feu : aucune acquisition, aucune morsure', () => {
    const { s, loup, a } = loinDerriere(true)
    const e = entity(s, a)
    s.structures.push({
      id: s.nextStructureId++, type: 'fire', tx: Math.floor(e.x), ty: Math.floor(e.y) - 1,
      villageId: 0, ownerId: 0, hp: STRUCTURE_HP.fire, access: 'public',
    })
    const loupE = entity(s, loup.entityId)
    let plusPres = Infinity
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, pietine(a, t))
      expect(loup.targetId).not.toBe(a)
      // Il SAIGNE, donc il perd des PV tout seul (une fraction par tick) ; une morsure en ôte
      // huit d'un coup. On regarde avant de le remettre à 100.
      expect(e.hp, 'pas une morsure').toBeGreaterThan(95)
      e.hp = 100
      plusPres = Math.min(plusPres, Math.sqrt(distSq(loupE.x, loupE.y, e.x, e.y)))
    }
    // Et la piste s'est arrêtée AU BORD DE LA LUMIÈRE (P8) : il est venu, mais pas sous le Feu.
    expect(plusPres, 'il est venu jusqu’à la lumière').toBeLessThan(FAUNA.FIRE_WARD + PISTE.PAS + 2)
    expect(plusPres, 'et pas dessous').toBeGreaterThan(FAUNA.FIRE_WARD - PISTE.FLAIR - 1)
  })
})

/* ─── P6 — UN MUR ENTRE DEUX GOUTTES : IL SE COGNE, PUIS IL LÂCHE ──────────────────── */

describe('P6 — un mur entre deux gouttes : il se cogne une seconde, puis il lâche', () => {
  // Revue `determinisme-sim` du 2026-09-12, MESURÉ sur la première écriture : la goutte suivante
  // derrière la palissade que l'homme a contournée, le loup la poussait 170 s — jusqu'au TTL de
  // la goutte —, impasse muette (un corps qui pousse un mur n'a pas de chemin brut).
  /** L'homme saigne et CONTOURNE par le nord une palissade nord-sud en x = 100 (y 95..105). */
  function contourne(avecMur: boolean): { s: SimState; loup: Monster; a: number } {
    const s = sim()
    if (avecMur) {
      for (let y = 95; y <= 105; y++) {
        s.structures.push({ id: s.nextStructureId++, type: 'wall', tx: 100, ty: y, villageId: 0, ownerId: 0, hp: STRUCTURE_HP.wall, access: 'public' })
      }
    }
    const a = homme(s, 90.5, 100.5, true)
    marche(s, a, 40, 1, 0) // → x ≈ 98,5
    marche(s, a, 40, 0, -1) // → y ≈ 92,5 : au-dessus du mur
    marche(s, a, 20, 1, 0) // → x ≈ 102,5
    marche(s, a, 40, 0, 1) // → y ≈ 100,5
    marche(s, a, 150, 1, 0) // → x ≈ 132 : hors de vue et de poursuite depuis le mur
    const loup = rodeur(s, 90.5, 100.5)
    drainEvents(s)
    return { s, loup, a }
  }

  it('AVEC le mur : au plus quelques secondes retenu, la piste est lâchée, et il vit — le TÉMOIN sans mur l’acquiert', () => {
    const joue = (avecMur: boolean): { retenu: number; acquisAu: number; piste: number | undefined; bouge: number } => {
      const { s, loup, a } = contourne(avecMur)
      const e = entity(s, loup.entityId)
      let retenu = 0
      let acquisAu = -1
      let px = e.x
      let py = e.y
      let bouge = 0
      for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
        step(s, pietine(a, t))
        entity(s, a).hp = 100
        const d = Math.abs(e.x - px) + Math.abs(e.y - py)
        if (loup.piste !== undefined && d < 1e-6) retenu++
        if (loup.piste === undefined) bouge += d
        px = e.x
        py = e.y
        if (acquisAu < 0 && loup.targetId === a) acquisAu = t
      }
      return { retenu, acquisAu, piste: loup.piste, bouge }
    }
    const temoin = joue(false)
    expect(temoin.acquisAu, 'sans mur, la piste mène à l’homme').toBeGreaterThanOrEqual(0)
    const mur = joue(true)
    expect(mur.retenu, 'retenu au mur moins de deux fois la fenêtre de cognement').toBeLessThanOrEqual(2 * FAUNA.STUCK_TICKS)
    expect(mur.piste, 'la piste est lâchée').toBeUndefined()
    expect(mur.bouge, 'et il vit sa vie de chasse après').toBeGreaterThan(5)
  })
})

/* ─── PA8 — LA ROCHE ARRÊTE LA PISTE ───────────────────────────────────────────────── */

describe('PA8 — la roche arrête la piste', () => {
  it('une piste qui monte sur un étage sans chemin n’est pas suivie au-delà du pied', () => {
    const s = sim()
    s.tick += 2000
    poseLaPiste(s, 60, 100.5, 10) // 10 gouttes au sol, jusqu'à x≈89
    const pied = s.blood[s.blood.length - 1]!.x
    s.tick += 200
    poseLaPiste(s, pied + 3.2, 100.5, 10, 1) // puis 10 gouttes à l'ÉTAGE 1, plus fraîches — sans rampe
    const loup = rodeur(s, 61.5, 100.5)
    const e = entity(s, loup.entityId)
    let xMax = e.x
    for (let t = 0; t < 12 * BALANCE.TICK_RATE_HZ; t++) {
      step(s, [])
      xMax = Math.max(xMax, e.x)
    }
    expect(xMax, 'il est allé jusqu’au pied').toBeGreaterThan(pied - PISTE.FLAIR - 0.5)
    expect(xMax, 'et pas au-delà').toBeLessThan(pied + PISTE.FLAIR + 1)
    expect(loup.piste, 'la piste est perdue au pied').toBeUndefined()
  })
})
