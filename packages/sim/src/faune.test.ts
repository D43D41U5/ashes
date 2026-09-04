import { describe, it, expect } from 'vitest'
import {
  BALANCE,
  COMBAT,
  FAUNA,
  HUNT,
  MONSTER_DEFS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  TERRAIN_ROCK,
  TERRAIN_SHALLOW_WATER,
  STRUCTURE_HP,
  SLOTS,
} from './balance'
import { countOf, inventoryOf } from './items'
import { createEmptyMap, profondeurAt, type WorldMap } from './map'
import { deriverProfondeur, estCoeur } from './profondeur'
import { createSim, spawnEntity, snapshot, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { spawnMonster, type Monster } from './monsters'
import { activityAt, isPredator, isPrey, octantOf, placeHuntingGrounds, predatorBias, sentinelOf, wolfVigor } from './faune'
import { drainEvents } from './events'
import { applyDamage, die } from './combat'
import { spawnPoiMonsters } from './poi'
import { distSq } from './geometry'

/** Une carte de test : prairie partout, un carré de forêt au nord-ouest. */
function makeMap(): WorldMap {
  const map = createEmptyMap(160, 160, TERRAIN_GRASS)
  for (let ty = 10; ty < 50; ty++) {
    for (let tx = 10; tx < 50; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  }
  return map
}

/**
 * Une sim de test à une HEURE donnée. Depuis R10, l'heure n'est plus un détail :
 * elle décide qui est éveillé et qui naît. Midi par défaut — c'est l'heure des
 * cerfs, et l'heure où le monde est le plus lisible.
 */
/**
 * LE PLAFOND DU BANC. `FAUNA.CAP` (240) est devenu un GARDE-FOU DE SERVEUR le
 * jour où le budget est passé au COIN DE CHASSE (R17) : ce n'est plus une valeur
 * de jeu. Ce qu'un joueur ressent, c'est `GROUND_CAP` — et un banc sans coins
 * peuple un monde uniforme de cette taille-là.
 */
const BENCH_CAP = FAUNA.GROUND_CAP

function makeSim(faunaCap = BENCH_CAP, hour = 12): SimState {
  // `worldEvents: false` : le banc de FAUNE mesure la faune. La NUIT QUI CHASSE
  // (chantier tension) sème ses propres loups autour du joueur — elle fausserait
  // chaque comptage de meute. Même raison que les hordes : un banc ne traîne pas un
  // système qu'il n'a pas demandé.
  const sim = createSim(1234, {
    map: makeMap(),
    faunaCap,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(hour, 1),
  })
  // CALME PLAT (spec chasse C17). L'odorat est un canal à PART : il ignore le
  // couvert, l'allure et le dos tourné — il rendrait donc chaque banc de ce
  // fichier dépendant de la direction d'approche. On le coupe ici (le vecteur
  // nul = pas de vent, jamais), et on le mesure dans SON banc à lui (chasse.test).
  sim.wind = { x: 0, y: 0 }
  return sim
}

function tick(state: SimState, inputs: MoveInput[] = []): void {
  step(state, inputs)
}

function entity(state: SimState, id: number): Entity {
  return state.entities.find((e) => e.id === id)!
}

function ambientCount(state: SimState): number {
  return state.monsters.filter((m) => m.ambient).length
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))
}

/** Frappe la bête et laisse le coup se résoudre (même montage que combat.test.ts). */
function strike(state: SimState, attackerId: number, dx: number, dy: number): void {
  tick(state, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }])
  for (let t = 0; t < COMBAT.WINDUP_TICKS + 1; t++) tick(state)
}

describe('le gradient RICHESSE ↔ DANGER (V2-19, tension.md T11bis)', () => {
  it('predatorBias monte avec le TIER de zone, à distance radiale égale', () => {
    // Carte 80×80, deux zones (pas 40) : ouest = racine (T0), est = karst (T1).
    const map = createEmptyMap(80, 80, TERRAIN_GRASS)
    map.zonePas = 40
    map.zoneGrid = [0, 1, 0, 1] // cols=2 : bloc (0,·)=racine, (1,·)=karst
    map.zoneDefs = [
      { slug: 'racine', nom: 'la racine', tier: 0 },
      { slug: 'karst', nom: 'le Karst', tier: 1 },
    ]
    // `home` placé pour que (10,10) [T0] et (50,10) [T1] soient à distance ÉGALE et dans la
    // bande radiale médiane (facteur radial = 1) : seul le TIER les départage.
    const sim = createSim(1, { map, home: { x: 30, y: 60 } })
    const bas = predatorBias(sim, 10, 10) // T0
    const haut = predatorBias(sim, 50, 10) // T1
    expect(haut).toBeGreaterThan(bas)
    expect(bas).toBeCloseTo(1, 5) // radial médian × (1 + 0.35×0)
    expect(haut).toBeCloseTo(1.35, 5) // radial médian × (1 + 0.35×1)
  })

  it('sans zones (banc plat), le tier est ignoré — comportement historique préservé', () => {
    const map = createEmptyMap(80, 80, TERRAIN_GRASS)
    const sim = createSim(1, { map, home: { x: 30, y: 60 } })
    expect(predatorBias(sim, 50, 10)).toBeCloseTo(1, 5) // pas de zoneDefs → tier 0 → facteur 1
  })
})

describe('les définitions (R8 — trois étages de gibier)', () => {
  it('lapin, cerf et sanglier sont du GIBIER ; le Cendreux n’en est pas', () => {
    expect(isPrey('rabbit')).toBe(true)
    expect(isPrey('deer')).toBe(true)
    expect(isPrey('boar')).toBe(true)
    expect(isPrey('cendreux')).toBe(false)
    expect(isPrey('cendreux')).toBe(false)
  })

  it('le gibier monte en PV et en viande : lapin < sanglier < cerf', () => {
    expect(MONSTER_DEFS.rabbit.hp).toBeLessThan(MONSTER_DEFS.boar.hp)
    expect(MONSTER_DEFS.boar.hp).toBeLessThan(MONSTER_DEFS.deer.hp)
    expect(MONSTER_DEFS.rabbit.loot.raw_meat).toBe(1)
    expect(MONSTER_DEFS.boar.loot.raw_meat).toBe(3)
    expect(MONSTER_DEFS.deer.loot.quartier).toBe(2) // V0-5 : le gros gibier rend des quartiers lourds
  })

  it('le gibier court plus vite qu’un joueur qui marche — la chasse est un geste', () => {
    expect(MONSTER_DEFS.rabbit.speed).toBeGreaterThan(BALANCE.WALK_SPEED_TILES_PER_S)
    expect(MONSTER_DEFS.deer.speed).toBeGreaterThan(BALANCE.WALK_SPEED_TILES_PER_S)
  })

  it('seul le sanglier charge (R7)', () => {
    expect(MONSTER_DEFS.boar.chargeChance).toBeGreaterThan(0)
    expect(MONSTER_DEFS.rabbit.chargeChance).toBe(0)
    expect(MONSTER_DEFS.deer.chargeChance).toBe(0)
  })
})

describe('le peuplement (A1-A3)', () => {
  it('A1 — l’anneau se peuple jusqu’au plafond, et ne le dépasse JAMAIS', () => {
    const sim = makeSim(12)
    spawnEntity(sim, 80.5, 80.5) // en pleine prairie : habitat du lapin et du cerf
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      expect(ambientCount(sim)).toBeLessThanOrEqual(12)
    }
    expect(ambientCount(sim)).toBe(12)
  })

  it('A1 — deux avatars ne doublent pas la population : le plafond est global', () => {
    const sim = makeSim(10)
    spawnEntity(sim, 80.5, 80.5)
    spawnEntity(sim, 100.5, 100.5)
    // ON LIT LE PLAFOND SUR TOUTE LA MINUTE, pas sur un tick choisi. La population
    // RESPIRE : une bête qui s'éloigne des deux avatars se dissipe et le semeur la
    // remplace à la demi-seconde qui suit, si bien qu'un instantané peut tomber sur
    // un creux d'un tick (mesuré : 8 pile à la 60ᵉ seconde, 10 partout autour). Ce
    // que la règle promet, c'est un plafond ATTEINT et JAMAIS dépassé, deux avatars
    // ou un seul — et ça, ça se lit à chaque tick.
    let plafond = 0
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      plafond = Math.max(plafond, ambientCount(sim))
      expect(ambientCount(sim)).toBeLessThanOrEqual(10)
    }
    expect(plafond).toBe(10)
  })

  it('A1 — un monde sans plafond (banc de test) ne peuple rien et ne tire RIEN au PRNG', () => {
    const sim = makeSim(0)
    spawnEntity(sim, 80.5, 80.5)
    const rngBefore = sim.rngState
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(ambientCount(sim)).toBe(0)
    expect(sim.rngState).toBe(rngBefore) // le peuplement n'a pas touché au flux
  })

  it('A2 — aucune bête ne naît dans le champ, ni hors de son habitat, ni sur du bloquant', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 80.5, 80.5)
    const seen = new Set<number>()
    for (let t = 0; t < 90 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      for (const m of sim.monsters) {
        if (!m.ambient || seen.has(m.entityId)) continue
        seen.add(m.entityId)
        const e = entity(sim, m.entityId)
        const d = dist(e, entity(sim, a))
        // LA BORNE QUI COMPTE : jamais dans le champ. Elle vaut pour TOUT le
        // monde, membres de harde compris — c'est elle qui interdit qu'un cerf
        // se matérialise sous les yeux du joueur.
        expect(d).toBeGreaterThanOrEqual(FAUNA.SPAWN_RING_MIN)
        // Le bord extérieur tolère l'essaimage d'une harde autour de son aîné.
        expect(d).toBeLessThanOrEqual(FAUNA.SPAWN_RING_MAX + FAUNA.HERD_SPAWN_SPREAD + 1)
        // Née chez elle : le biome a choisi l'espèce (R2).
        const terrain = sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!
        expect(MONSTER_DEFS[m.type].habitat).toContain(terrain)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('A2 — le biome choisit l’espèce : la forêt donne des sangliers, jamais des lapins', () => {
    const sim = makeSim()
    spawnEntity(sim, 30.5, 30.5) // au cœur du carré de forêt
    for (let t = 0; t < 120 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const born = sim.monsters.filter((m) => m.ambient)
    expect(born.length).toBeGreaterThan(0)
    for (const m of born) {
      const e = entity(sim, m.entityId)
      const terrain = sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!
      // Une bête née en forêt est un sanglier ou un cerf — jamais un lapin.
      if (terrain === TERRAIN_FOREST) expect(m.type).not.toBe('rabbit')
    }
  })

  it('A3 — la faune se dissipe dans le sillage de l’avatar ; la bête de LIEU reste', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 80.5, 80.5)
    // Un sanglier de tanière : résident, jamais ambiant.
    const denId = spawnMonster(sim, 'boar', 82.5, 80.5)
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(ambientCount(sim)).toBeGreaterThan(0)

    // L'avatar part très loin : plus personne ne regarde derrière lui.
    const player = entity(sim, a)
    player.x = 20.5
    player.y = 140.5
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    // Toutes les bêtes laissées derrière ont disparu, entité comprise.
    for (const m of sim.monsters.filter((x) => x.ambient)) {
      expect(dist(entity(sim, m.entityId), player)).toBeLessThanOrEqual(FAUNA.DESPAWN_RADIUS)
    }
    // Le sanglier de tanière, lui, est toujours là — il appartient à son lieu.
    expect(sim.monsters.some((m) => m.entityId === denId)).toBe(true)
    expect(sim.entities.some((e) => e.id === denId)).toBe(true)
  })
})

describe('le comportement (A4-A7)', () => {
  /** Une bête posée à la main, loin de tout : on regarde ce qu'elle fait. */
  function loneBeast(
    type: 'rabbit' | 'boar' | 'deer',
    x: number,
    y: number,
    /** L'heure DE LA BÊTE : le sanglier est nocturne, le cerf diurne (R10). */
    hour = type === 'boar' ? 2 : 12,
  ): { sim: SimState; id: number; m: Monster } {
    const sim = makeSim(0, hour) // pas de peuplement : on veut UNE bête, la nôtre
    const id = spawnMonster(sim, type, x, y)
    return { sim, id, m: sim.monsters.find((mm) => mm.entityId === id)! }
  }

  it('A4 — sans menace, la bête broute : elle se déplace, et reste dans son habitat', () => {
    const { sim, id } = loneBeast('boar', 30.5, 30.5) // en forêt
    // On cumule le chemin PARCOURU, pas le déplacement net : un brouteur revient
    // sur ses pas (il l'a fait, exactement, et le test naïf a menti).
    let travelled = 0
    let prev = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < 400; t++) {
      tick(sim)
      const e = entity(sim, id)
      travelled += dist(e, prev)
      prev = { x: e.x, y: e.y }
      const terrain = sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!
      expect(terrain).toBe(TERRAIN_FOREST) // jamais sorti de la forêt
    }
    expect(travelled).toBeGreaterThan(1) // il a brouté, donc bougé
  })

  it('A4 — le brouteur flâne : il est bien plus lent qu’à la course', () => {
    const { sim, id } = loneBeast('boar', 30.5, 30.5)
    const start = { x: entity(sim, id).x, y: entity(sim, id).y }
    const seconds = 10
    for (let t = 0; t < seconds * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const covered = dist(entity(sim, id), start)
    // Même en ligne droite, brouter ne peut pas dépasser GRAZE_SPEED × vitesse.
    expect(covered).toBeLessThan(MONSTER_DEFS.boar.speed * FAUNA.GRAZE_SPEED * seconds)
  })

  it('A5 — un avatar qui approche fige la bête (méfiance) ; trop près, elle détale', () => {
    // Depuis la spec chasse (C1), l'alerte n'est plus un MUR mais une JAUGE : la
    // bête se fige quand sa méfiance franchit SUSPICION_CURIOUS — ce qui prend
    // quelques secondes à distance d'alerte, et le regard (C4) module la montée.
    // Le cerf : alerte à 14, fuite à 9, plafond de perception 17,5.
    const { sim, id, m } = loneBeast('deer', 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 90) // à 9,5 tuiles : entendu, pas encore fui
    // On laisse la jauge monter jusqu'au figement (borne large : 8 s — le cerf
    // broute, son regard tourne, la montée n'est pas une rampe régulière).
    let settled = -1
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (m.suspicion >= HUNT.SUSPICION_CURIOUS) {
        settled = t
        break
      }
    }
    expect(settled).toBeGreaterThanOrEqual(0) // elle a fini par le percevoir
    expect(m.fleeSince).toBe(-1) // …mais elle n'a PAS fui : elle regarde
    // Figée : plus un pas tant que la menace reste plantée là.
    const frozen = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, id).x).toBe(frozen.x)
    expect(entity(sim, id).y).toBe(frozen.y)
    // Et elle REGARDE la menace (chasse C1) : le regard pointe vers l'avatar.
    const e = entity(sim, id)
    const av = entity(sim, a)
    const d0 = dist(e, av)
    const dot = (e.facing.x * (av.x - e.x) + e.facing.y * (av.y - e.y)) / d0
    expect(dot).toBeGreaterThan(0.9)

    // L'avatar entre dans la zone de fuite : la jauge sature, la distance CROÎT.
    av.x = e.x
    av.y = e.y + 6 // à 6 tuiles < flightRange 9, plein regard
    const before = dist(entity(sim, id), av)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(dist(entity(sim, id), entity(sim, a))).toBeGreaterThan(before)
  })

  it('A6 — la fuite est en à-coups : elle court, puis elle souffle', () => {
    const { sim, id, m } = loneBeast('deer', 80.5, 80.5)
    spawnEntity(sim, 80.5, 84.5) // dans flightRange : la jauge va saturer

    // Depuis la spec chasse (C1), la fuite ne part plus au premier tick : la
    // méfiance doit SATURER (~1 s à bout portant). On attend le départ…
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && m.fleeSince < 0; t++) tick(sim)
    expect(m.fleeSince).toBeGreaterThanOrEqual(0)

    // …et on mesure le PREMIER cycle : le tick qui a levé la bête a déjà couru
    // la phase 0, on lit donc les phases 1..fin. (Plus tard, elle aurait déjà
    // SEMÉ un marcheur immobile — la peur d'une menace qu'on n'entend plus
    // retombe avant le second cycle, et c'est voulu : elle est LOIN.)
    const cycle = FAUNA.BURST_RUN_TICKS + FAUNA.BURST_PAUSE_TICKS
    const perTick: number[] = []
    let prev = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 1; t < cycle; t++) {
      tick(sim)
      const e = entity(sim, id)
      perTick.push(dist(e, prev))
      prev = { x: e.x, y: e.y }
    }
    const running = perTick.slice(0, FAUNA.BURST_RUN_TICKS - 1)
    const blowing = perTick.slice(FAUNA.BURST_RUN_TICKS - 1)
    expect(Math.min(...running)).toBeGreaterThan(0) // elle court
    expect(Math.max(...blowing)).toBe(0) // puis elle s'arrête net
  })

  /** Fige la décision de la bête : le dé de charge ne se relancera plus. */
  function decide(m: Monster, fleeing: boolean): void {
    m.fleeing = fleeing
    m.thinkAt = Number.MAX_SAFE_INTEGER
  }

  it('A7 — un sanglier qui ne charge jamais fuit son agresseur', () => {
    const { sim, id, m } = loneBeast('boar', 30.5, 30.5)
    const a = spawnEntity(sim, 29.5, 30.5) // le sanglier est à +x : on frappe vers +x
    const before = dist(entity(sim, id), entity(sim, a))
    strike(sim, a, 1, 0)
    expect(entity(sim, id).hp).toBeLessThan(MONSTER_DEFS.boar.hp) // il a bien été touché

    decide(m, true) // ce test-ci porte sur la FUITE
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(dist(entity(sim, id), entity(sim, a))).toBeGreaterThan(before)
  })

  it('A7 — un sanglier qui charge rend le coup ; un lapin, jamais', () => {
    const { sim, id, m } = loneBeast('boar', 30.5, 30.5)
    const a = spawnEntity(sim, 29.5, 30.5)
    strike(sim, a, 1, 0)
    decide(m, false) // acculé : il charge
    for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, id).hp).toBeLessThan(MONSTER_DEFS.boar.hp)
    expect(entity(sim, a).hp).toBeLessThan(100) // le sanglier a rendu le coup

    // Le lapin, lui, n'a pas de charge : frappé, il part, et ne touche jamais.
    const hare = loneBeast('rabbit', 80.5, 80.5)
    const b = spawnEntity(hare.sim, 79.5, 80.5)
    const dBefore = dist(entity(hare.sim, hare.id), entity(hare.sim, b))
    strike(hare.sim, b, 1, 0)
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(hare.sim)
    expect(entity(hare.sim, b).hp).toBe(100) // il n'a pas rendu le coup
    expect(dist(entity(hare.sim, hare.id), entity(hare.sim, b))).toBeGreaterThan(dBefore)
  })
})

describe('la harde (A10 — le grégarisme)', () => {
  it('A10 — un cerf ne naît jamais seul : il arrive en harde', () => {
    const sim = makeSim()
    spawnEntity(sim, 80.5, 80.5)
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    const deer = sim.monsters.filter((m) => m.type === 'deer')
    expect(deer.length).toBeGreaterThan(0)
    for (const d of deer) expect(d.herdId).toBeDefined()

    // Chaque harde compte au moins 2 têtes (le solitaire n'existe pas).
    const parHarde = new Map<number, number>()
    for (const d of deer) parHarde.set(d.herdId!, (parHarde.get(d.herdId!) ?? 0) + 1)
    expect(Math.max(...parHarde.values())).toBeGreaterThanOrEqual(2)

    // Le lapin et le sanglier, eux, restent solitaires.
    for (const m of sim.monsters.filter((x) => x.type === 'rabbit' || x.type === 'boar')) {
      expect(m.herdId).toBeUndefined()
    }
  })

  /** Une harde posée à la main : n cerfs, même herdId, groupés. */
  function makeHerd(sim: SimState, n: number, x: number, y: number): Monster[] {
    const herdId = sim.nextHerdId++
    const out: Monster[] = []
    for (let i = 0; i < n; i++) {
      const id = spawnMonster(sim, 'deer', x + i * 2.5, y)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      m.herdId = herdId
      out.push(m)
    }
    return out
  }

  it('A10 — LA CONTAGION : il suffit qu’un cerf vous repère pour que TOUTE la harde parte', () => {
    const sim = makeSim(0)
    // Cinq cerfs en ligne, espacés de 2,5 tuiles (le dernier à 90,5). Le joueur
    // se poste à 6 tuiles du PREMIER — dans sa zone de fuite. Le dernier, lui,
    // est à 11,7 tuiles : il VOIT le joueur (alertRange 14) mais ne fuirait pas
    // de lui-même (flightRange 9). S'il part, c'est par contagion, pas autrement.
    const herd = makeHerd(sim, 5, 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 86.5)
    const loin = herd.at(-1)!
    const dLoin = dist(entity(sim, loin.entityId), entity(sim, a))
    expect(dLoin).toBeGreaterThan(MONSTER_DEFS.deer.flightRange!) // il ne fuirait pas seul

    const avant = dist(entity(sim, loin.entityId), entity(sim, a))
    // On observe PENDANT la course : une bête qui a fui assez loin se calme et
    // remet son compteur à -1 — le lire à la fin ne prouverait rien.
    let aFui = false
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (loin.fleeSince >= 0) aFui = true
    }

    // Le cerf du bout, qui n'avait aucune raison de partir, a détalé lui aussi.
    expect(aFui).toBe(true)
    expect(dist(entity(sim, loin.entityId), entity(sim, a))).toBeGreaterThan(avant)
  })

  it('A10 — sans harde, un cerf isolé au même endroit ne bouge pas d’un pouce', () => {
    // Le contre-test : c'est bien le GRÉGARISME qui fait partir le cerf du bout,
    // pas la simple proximité du joueur. Même montage, mais sans herdId.
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'deer', 90.5, 80.5) // exactement où était le cerf du bout
    spawnEntity(sim, 80.5, 86.5)
    const solo = entity(sim, id)
    const d0 = dist(solo, { x: 80.5, y: 86.5 })
    expect(d0).toBeGreaterThan(MONSTER_DEFS.deer.flightRange!)
    expect(d0).toBeLessThan(MONSTER_DEFS.deer.alertRange!) // il le VOIT : il se fige

    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(sim.monsters.find((m) => m.entityId === id)!.fleeSince).toBe(-1) // il n'a jamais fui
  })

  it('A10 — la cohésion : une harde dispersée se regroupe en broutant', () => {
    const sim = makeSim(0)
    const herd = makeHerd(sim, 4, 80.5, 80.5)
    // On en éloigne un très au-delà de l'écart toléré.
    const errant = entity(sim, herd[0]!.entityId)
    errant.x = 80.5 + FAUNA.HERD_SPREAD * 3
    errant.y = 80.5

    const centre = () => {
      const autres = herd.slice(1).map((m) => entity(sim, m.entityId))
      return {
        x: autres.reduce((s, e) => s + e.x, 0) / autres.length,
        y: autres.reduce((s, e) => s + e.y, 0) / autres.length,
      }
    }
    const avant = dist(errant, centre())
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(dist(entity(sim, herd[0]!.entityId), centre())).toBeLessThan(avant)
  })
})

describe('le gibier (A8)', () => {
  it('A8 — tuer un lapin donne 1 viande crue et émet monster_slain avec le bon type', () => {
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'rabbit', 80.5, 80.5)
    const a = spawnEntity(sim, 79.7, 80.5)
    drainEvents(sim)
    // Mains nues : 6 dégâts, 8 PV → deux coups. Le lapin détale entre les deux :
    // on le rattrape, comme à la chasse.
    while (sim.monsters.some((m) => m.entityId === id)) {
      const beast = entity(sim, id)
      const hunter = entity(sim, a)
      hunter.x = beast.x - 0.8
      hunter.y = beast.y
      strike(sim, a, 1, 0)
    }
    const events = drainEvents(sim)
    const slain = events.find((e) => e.type === 'monster_slain')
    expect(slain).toBeDefined()
    expect(slain && 'monsterType' in slain && slain.monsterType).toBe('rabbit')
    const corpse = sim.corpses.at(-1)!
    expect(countOf(corpse.inventory, 'raw_meat')).toBe(1)
  })
})

describe('le rythme jour/nuit (A11 — R10)', () => {
  it('A11 — chaque espèce a ses heures : le cerf le jour, le sanglier et le loup la nuit', () => {
    // Midi : le cerf est en pleine vigueur, le nocturne dort.
    expect(activityAt('deer', 12)).toBe(1)
    expect(activityAt('boar', 12)).toBe(0)
    expect(activityAt('wolf', 12)).toBe(0)

    // 2h du matin : l'inverse exact.
    expect(activityAt('wolf', 2)).toBe(1)
    expect(activityAt('boar', 2)).toBe(1)
    expect(activityAt('deer', 2)).toBe(0)

    // Le lapin est crépusculaire : deux bosses, et un creux en plein midi.
    expect(activityAt('rabbit', 6.5)).toBeGreaterThan(0.5) // l'aube
    expect(activityAt('rabbit', 20)).toBeGreaterThan(0.5) // le soir
    expect(activityAt('rabbit', 13)).toBe(0) // le plein jour : terré

    // Un mort-vivant n'a pas d'heures : il est toujours d'attaque.
    expect(activityAt('cendreux', 3)).toBe(1)
    expect(activityAt('cendreux', 15)).toBe(1)
  })

  it('A11 — la NUIT appartient aux loups et aux sangliers : le peuplement bascule', () => {
    const compte = (hour: number): Record<string, number> => {
      // TOUT en forêt : l'anneau de naissance (28-42 tuiles) doit tomber dans un
      // biome où les quatre espèces peuvent naître, sinon on ne mesure que la
      // géographie. (Le premier montage l'a fait, et ne trouvait aucun loup.)
      const map = createEmptyMap(160, 160, TERRAIN_FOREST)
      const sim = createSim(1234, {
        map,
        faunaCap: BENCH_CAP,
        worldEvents: false, // (voir plus haut : la nuit qui chasse fausserait le comptage)
        cycleOffset: cycleOffsetForStartHour(hour, 1),
      })
      spawnEntity(sim, 80.5, 80.5)
      for (let t = 0; t < 90 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
      const par: Record<string, number> = {}
      for (const m of sim.monsters) par[m.type] = (par[m.type] ?? 0) + 1
      return par
    }
    const jour = compte(12)
    const nuit = compte(2)

    // De nuit, la forêt donne nettement plus de loups et de sangliers qu'à midi.
    expect((nuit.wolf ?? 0) + (nuit.boar ?? 0)).toBeGreaterThan((jour.wolf ?? 0) + (jour.boar ?? 0))
    // Et de jour, plus de cerfs que de nuit.
    expect(jour.deer ?? 0).toBeGreaterThan(nuit.deer ?? 0)
  })

  it('A11 — hors de ses heures la bête se couche… mais reste réveillable', () => {
    // Un cerf à 2h du matin : il dort, donc il ne broute pas.
    const dormeur = makeSim(0, 2)
    const id = spawnMonster(dormeur, 'deer', 80.5, 80.5)
    const depart = { x: 80.5, y: 80.5 }
    for (let t = 0; t < 200; t++) tick(dormeur)
    expect(dist(entity(dormeur, id), depart)).toBe(0) // pas un pas

    // Mais qu'on l'approche, et il détale quand même : dormir n'est pas mourir.
    const a = spawnEntity(dormeur, 80.5, 84.5) // dans sa flightRange (9)
    const avant = dist(entity(dormeur, id), entity(dormeur, a))
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(dormeur)
    expect(dist(entity(dormeur, id), entity(dormeur, a))).toBeGreaterThan(avant)
  })

  it('A21 (§2quater) — la bête à bout de sang se COUCHE AU CŒUR : la meilleure couche est la plus profonde', () => {
    // Le couché C11, sur une carte qui a un CŒUR : le bois 40×40 de makeMap, champ de
    // profondeur dérivé. La couche se choisit au couvert EFFECTIF (§2quater R41) — le cœur
    // (couvert × COVER_COEUR) bat la lisière, et la bête blessée va mourir AU FOND du bois :
    // on la retrouve par le sang, pas en battant la carte.
    const sim = makeSim()
    const zone = new Int32Array(sim.map.width * sim.map.height) // une seule « zone » : id 0
    sim.map.profondeur = deriverProfondeur(sim.map.terrain, zone, 0, sim.map.width, sim.map.height)
    const id = spawnMonster(sim, 'deer', 48.5, 30.5) // lisière est du bois (d = 2)
    expect(estCoeur(profondeurAt(sim.map, 48, 30))).toBe(false)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const a = spawnEntity(sim, 55.5, 120.5) // très loin : aucune menace perçue
    applyDamage(sim, entity(sim, id), MONSTER_DEFS.deer.hp - 22, a) // mortelle, elle tient debout
    expect(m.bleedMortal).toBe(true)
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ && !m.bedded; t++) tick(sim)
    expect(m.bedded).toBe(true)
    const e = entity(sim, id)
    expect(
      estCoeur(profondeurAt(sim.map, Math.floor(e.x), Math.floor(e.y))),
      `couchée en (${e.x.toFixed(1)}, ${e.y.toFixed(1)}), profondeur ${profondeurAt(sim.map, Math.floor(e.x), Math.floor(e.y))}`,
    ).toBe(true)
  })
})

describe('la meute de loups (A12 — R11)', () => {
  /** Une meute posée à la main, la nuit (l'heure du loup). */
  function makePack(n: number, x: number, y: number): { sim: SimState; pack: Monster[] } {
    const sim = makeSim(0, 2)
    const herdId = sim.nextHerdId++
    const pack: Monster[] = []
    for (let i = 0; i < n; i++) {
      const id = spawnMonster(sim, 'wolf', x + i * 1.2, y)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      m.herdId = herdId
      pack.push(m)
    }
    return { sim, pack }
  }

  it('A12 — le loup est un PRÉDATEUR, pas du gibier', () => {
    expect(isPredator('wolf')).toBe(true)
    expect(isPrey('wolf')).toBe(false)
    expect(isPredator('deer')).toBe(false)
    expect(MONSTER_DEFS.wolf.speed).toBeGreaterThan(BALANCE.WALK_SPEED_TILES_PER_S) // on ne le sème pas en marchant
  })

  it('A12 — LE COURAGE : une meute engage l’homme ; un loup SEUL rôde sans mordre', () => {
    // Trois loups groupés : ils ont leurs frères, ils attaquent.
    const meute = makePack(3, 80.5, 80.5)
    const a = spawnEntity(meute.sim, 86.5, 80.5) // dans l'aggro (13)
    for (let t = 0; t < 12 * BALANCE.TICK_RATE_HZ; t++) tick(meute.sim)
    expect(entity(meute.sim, a).hp).toBeLessThan(100) // la meute a mordu

    // Le même loup, SEUL : il suit, il pèse — mais il ne mord pas.
    const solo = makePack(1, 80.5, 80.5)
    const b = spawnEntity(solo.sim, 86.5, 80.5)
    for (let t = 0; t < 12 * BALANCE.TICK_RATE_HZ; t++) tick(solo.sim)
    expect(entity(solo.sim, b).hp).toBe(100) // pas une morsure
  })

  it('A12 — LA ROMPUE : un loup qui saigne décroche au lieu de mourir au contact', () => {
    const { sim, pack } = makePack(3, 80.5, 80.5)
    const a = spawnEntity(sim, 82.5, 80.5)
    const blesse = entity(sim, pack[0]!.entityId)
    blesse.hp = Math.floor(MONSTER_DEFS.wolf.hp * FAUNA.PACK_BREAK_HP) - 1 // sous le seuil

    const avant = dist(blesse, entity(sim, a))
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    // Il s'éloigne, et il ne tient plus de cible.
    expect(dist(entity(sim, pack[0]!.entityId), entity(sim, a))).toBeGreaterThan(avant)
    expect(pack[0]!.targetId).toBeNull()
  })

  it('A12 — L’ÉCOSYSTÈME : le loup préfère le cerf à l’homme, et le cerf fuit le loup', () => {
    const { sim, pack } = makePack(3, 80.5, 80.5)
    // Un cerf à 10 tuiles, un joueur à 8 : le joueur est PLUS PRÈS, et pourtant
    // c'est le cerf qui est chassé (PREY_PREFERENCE).
    const cerf = spawnMonster(sim, 'deer', 90.5, 80.5)
    const a = spawnEntity(sim, 80.5, 88.5)

    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(pack[0]!.targetId).toBe(cerf)
    expect(pack[0]!.targetId).not.toBe(a)

    // Et le cerf, lui, DÉTALE — sans avoir été frappé : il fuit à la VUE du
    // prédateur, exactement comme il fuirait un chasseur.
    //
    // On n'exige PAS que la distance au loup croisse : le loup court à 4,8 et le
    // cerf à 4,6. La meute GAGNE du terrain, et c'est le comportement voulu — un
    // cerf n'échappe pas à des loups en ligne droite. Ce qu'on vérifie, c'est
    // qu'il fuit, et qu'il fuit DANS LE BON SENS (il s'éloigne de sa position
    // de départ, du côté opposé au loup).
    const m = sim.monsters.find((x) => x.entityId === cerf)!
    // Le POINT d'où le loup l'a levé — figé, pas la référence vivante : le loup
    // avance, et se mesurer à une cible qui bouge ne prouve rien.
    const leve = { x: entity(sim, pack[0]!.entityId).x, y: entity(sim, pack[0]!.entityId).y }
    const depart = { x: entity(sim, cerf).x, y: entity(sim, cerf).y }
    let aFui = false
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (sim.entities.some((e) => e.id === cerf) && m.fleeSince >= 0) aFui = true
    }
    expect(aFui).toBe(true)
    if (sim.entities.some((e) => e.id === cerf)) {
      expect(dist(entity(sim, cerf), leve)).toBeGreaterThan(dist(depart, leve))
    }
  })

  it('A12 — L’ENCERCLEMENT : la meute prend la proie de plusieurs CÔTÉS, pas en file', () => {
    // Trois loups partis du MÊME point, à l'ouest de la proie. S'ils fonçaient
    // droit dessus, ils resteraient tous à l'ouest — une file indienne, qu'on fuit
    // en ligne droite. On veut les retrouver répartis AUTOUR d'elle.
    const { sim, pack } = makePack(3, 70.5, 80.5)
    const a = spawnEntity(sim, 80.5, 80.5)
    const proie = entity(sim, a)

    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    // De quels côtés (relatifs à la proie) les loups se sont-ils postés ?
    const cotes = new Set<string>()
    for (const w of pack) {
      const e = entity(sim, w.entityId)
      cotes.add(`${e.x < proie.x ? 'O' : 'E'}${e.y < proie.y ? 'N' : 'S'}`)
      expect(dist(e, { x: 70.5, y: 80.5 })).toBeGreaterThan(2) // chacun est venu
    }
    // Au moins deux côtés distincts : le cercle se ferme, la proie est prise.
    expect(cotes.size).toBeGreaterThanOrEqual(2)
  })

  it('A12 — LA TRAQUE : le loup rampe vers son poste, et le gibier ne le voit pas venir', () => {
    // La meute part à 14 tuiles — hors de la zone de fuite du cerf (9), sinon on
    // ne mesurerait que le fait qu'il était déjà levé.
    const { sim, pack } = makePack(3, 66.5, 80.5)
    // Le cerf fuit un chasseur à 9 tuiles. Un loup qui RAMPE est camouflé (0,42) :
    // il ne « pèse » à 9 que lorsqu'il est réellement à 3,8 — soit déjà dans le
    // cercle. C'est exactement ce qui laisse à la meute le temps de se placer.
    const cerf = spawnMonster(sim, 'deer', 80.5, 80.5)
    const m = sim.monsters.find((x) => x.entityId === cerf)!

    // Il approche : tant qu'il rampe, il avance LENTEMENT.
    let stalked = false
    let pasMax = 0
    let prev = { x: entity(sim, pack[0]!.entityId).x, y: entity(sim, pack[0]!.entityId).y }
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      const e = entity(sim, pack[0]!.entityId)
      if (pack[0]!.stalking) {
        stalked = true
        pasMax = Math.max(pasMax, dist(e, prev))
      }
      prev = { x: e.x, y: e.y }
    }
    expect(stalked).toBe(true) // il a bien traqué

    // Le pas d'un loup en traque ne dépasse jamais son allure de traque.
    const pasPlein = MONSTER_DEFS.wolf.speed / BALANCE.TICK_RATE_HZ
    expect(pasMax).toBeLessThan(pasPlein * FAUNA.STALK_SPEED * 1.6) // (×1.6 : la diagonale)

    // Et le cerf n'a pas bougé : il ne les a pas vus venir. C'est TOUT l'intérêt —
    // sans camouflage, il détalerait avant que le cercle ne soit refermé.
    expect(m.fleeSince).toBe(-1)
    expect(dist(entity(sim, cerf), { x: 80.5, y: 80.5 })).toBeLessThan(1)
  })

  it('A12 — sans camouflage, le même loup lèverait le cerf : la furtivité EST la manœuvre', () => {
    // Le contre-test. Un loup à la MÊME distance, mais qui ne rampe pas (il court
    // déjà, donc `stalking` est faux) : le cerf le repère et détale.
    const sim = makeSim(0, 2)
    const cerf = spawnMonster(sim, 'deer', 80.5, 80.5)
    const m = sim.monsters.find((x) => x.entityId === cerf)!
    const loupId = spawnMonster(sim, 'wolf', 74.5, 80.5) // à 6 tuiles : dans la flightRange (9)
    const loup = sim.monsters.find((x) => x.entityId === loupId)!
    delete loup.herdId // un loup SEUL : `packInPlace` est vrai → il se rue, il ne rampe pas

    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(loup.stalking).toBeFalsy() // il ne traque pas : il court
    expect(m.fleeSince).toBeGreaterThanOrEqual(0) // et le cerf, lui, l'a vu
  })

  /**
   * ═══ LA POURSUITE (R13) — « on ne sème pas des loups » ═══
   *
   * Le camouflage tombe « quand la proie a compris et détale » (R11) — mais ce test ne
   * lisait que l'état d'un ANIMAL, donc il était toujours faux pour un homme, et la meute
   * rampait derrière lui À 2,0 TUILES/S pendant qu'il marchait à 4. MESURÉ avant correctif
   * (`tools/diag-loup.mts`, 4 graines) : parti à 12 tuiles, l'homme finissait à 87, jamais
   * touché, sur TOUS les bancs. Décision d'Alexis (2026-08-01) : l'homme qui S'ÉLOIGNE lève
   * la meute.
   */
  it('A12bis — un homme qui MARCHE ne sème pas une meute : elle le rattrape', () => {
    const { sim } = makePack(4, 80.5, 80.5) // `makePack` pose la nuit : l'heure du loup
    const a = spawnEntity(sim, 80.5, 92.5)
    entity(sim, a).hp = 100

    let mordu = -1
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ && mordu < 0; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 1 }]) // il s'en va, plein sud, sans jamais courir
      if (entity(sim, a).hp < 100) mordu = t
    }
    expect(mordu).toBeGreaterThanOrEqual(0)
    expect(mordu).toBeLessThan(35 * BALANCE.TICK_RATE_HZ)
    // (L'ENCERCLEMENT ne se juge pas ici : une meute qui court APRÈS un homme le prend
    // par-derrière, en file — c'est le banc du figé, plus bas, qui montre le cercle.)
  })

  /**
   * L'homme qui NE fuit PAS est TRAQUÉ : la meute rampe vers ses postes et n'en finit
   * qu'une fois le cercle bouclé. C'est l'autre moitié de la décision — et le moment de jeu
   * que la traque existe pour produire.
   */
  it('A12bis — un homme qui se FIGE est traqué, pas chargé : la meute rampe d’abord', () => {
    const { sim, pack } = makePack(4, 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 92.5)
    entity(sim, a).hp = 100

    // Trois secondes de marche : elle le repère et hurle. Puis il ne bouge plus.
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 1 }])
    expect(pack.some((w) => w.targetId === a)).toBe(true)

    let rampe = 0
    let ticks = 0
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      // ⚠ ON LE MAINTIENT DEBOUT (2026-08-27). Ce banc mesure la GÉOMÉTRIE de la traque,
      // pas la survie — celle-ci a ses propres gardes (A14, `faune.md` R13). Or l'homme
      // MOURAIT dans la fenêtre, sur les douze graines éprouvées et déjà sans les corps
      // solides (`tools/diag-corps.mts`, colonne « tombe en A12bis » : 12/12 à poussée
      // nulle) : `die()` le renvoyait à son point d'entrée, à douze tuiles de là, et
      // l'assertion des « deux côtés » relevait donc la position de la meute autour d'un
      // RESSUSCITÉ. Elle passait par chance, et elle rougissait au moindre reroutage —
      // mesuré NON MONOTONE en la force des corps (12/12 à 0,25 et 0,75, 1/12 à 0,5 et 1),
      // signature d'une garde qui ne mesure pas ce qu'elle croit. Debout, le cercle se
      // ferme 12/12 à TOUTES les forces : c'est la propriété, et c'est elle qu'on affirme.
      entity(sim, a).hp = 100
      tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
      for (const w of pack) {
        ticks++
        if (w.stalking) rampe++
      }
    }
    expect(rampe / ticks).toBeGreaterThan(0.1) // elle a VRAIMENT rampé

    // …et le cercle s'est fermé AUTOUR de lui : au moins deux côtés tenus.
    const proie = entity(sim, a)
    const cotes = new Set<string>()
    for (const w of pack) {
      const e = entity(sim, w.entityId)
      if (dist(e, proie) <= FAUNA.ENCIRCLE_RADIUS + FAUNA.POST_TOLERANCE + 1) {
        cotes.add(`${e.x < proie.x ? 'O' : 'E'}${e.y < proie.y ? 'N' : 'S'}`)
      }
    }
    expect(cotes.size).toBeGreaterThanOrEqual(2)
  })

  /**
   * UN TRAÎNARD NE CONDAMNE PAS LA MEUTE. `packInPlace` comptait TOUS les frères vivants :
   * un loup resté à quarante tuiles — occupé ailleurs, ou parti mourir — empêchait la ruée
   * pour toujours, et les autres rampaient jusqu'à perdre la cible. L'encerclement est
   * l'affaire de ceux qui encerclent.
   */
  it('A12bis — un frère resté au loin ne fait plus traîner la meute', () => {
    const { sim, pack } = makePack(4, 80.5, 80.5)
    for (const w of pack) {
      w.groundX = 80.5
      w.groundY = 80.5
    }
    const a = spawnEntity(sim, 80.5, 92.5)
    entity(sim, a).hp = 100

    // Il marche assez pour être repéré, PUIS il se fige : il n'est plus fuyard, donc la
    // ruée ne peut venir que du cercle bouclé — c'est `packInPlace`, et rien d'autre, qu'on
    // mesure ici. Puis un frère s'en va à cent tuiles.
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 1 }])
    entity(sim, pack[3]!.entityId).x = 180.5
    entity(sim, pack[3]!.entityId).y = 180.5

    let mordu = -1
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ && mordu < 0; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
      if (entity(sim, a).hp < 100) mordu = t
    }
    expect(mordu).toBeGreaterThanOrEqual(0)
    // MESURÉ : 4,7 s quand seuls les encercleurs comptent, 5,8 s quand l'absent compte aussi
    // (les autres rampent en l'attendant, et n'en finissent qu'en le croisant par hasard).
    expect(mordu).toBeLessThan(5.3 * BALANCE.TICK_RATE_HZ)
  })

  /**
   * LE CAP NE SE SCIE PAS. La zone morte du pas se dérivait du CORPS (0,10 tuile) alors que
   * le déport latéral d'un loup lancé vaut 0,17 : elle ne pouvait pas amortir le pas qu'elle
   * visait. Un loup qui poursuit droit devant alternait nord-est / nord-ouest à CHAQUE TICK
   * — et comme le pas diagonal est normalisé (×0,707), sa vitesse utile tombait de 4,8 à
   * 3,4 tuiles/s, SOUS les 4,0 d'un homme qui marche. Il ne pouvait pas rattraper.
   */
  it('A12bis — une meute lancée ne SCIE PAS son cap', () => {
    const { sim, pack } = makePack(4, 80.5, 80.5)
    // AVEC LEUR CANTON, comme toute meute du monde réel (R17) : c'est lui qui les met en
    // patrouille quand la cible échappe, et c'est là que le cap se sciait.
    for (const w of pack) {
      w.groundX = 80.5
      w.groundY = 80.5
    }
    const a = spawnEntity(sim, 80.5, 92.5)
    entity(sim, a).hp = 100

    // La PIRE SECONDE de retournements du regard, par loup : c'est ce que l'écran montre, et
    // c'est le symptôme du cap scié — VINGT par seconde avant correctif (banc `diag-loup`),
    // dix-sept ici. C'est un défaut de LISIBILITÉ : la vitesse utile de la meute, elle, ne
    // bouge pas (vérifié : même temps jusqu'à la morsure avec et sans).
    let pire = 0
    const suivi = pack.map(() => ({ flip: false, fenetre: 0, n: 0 }))
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 1 }])
      const fenetre = Math.floor(t / BALANCE.TICK_RATE_HZ)
      pack.forEach((w, i) => {
        const s = suivi[i]!
        if (fenetre !== s.fenetre) {
          pire = Math.max(pire, s.n)
          s.fenetre = fenetre
          s.n = 0
        }
        const e = entity(sim, w.entityId)
        if (Math.abs(e.facing.x) > 0.25) {
          const f = e.facing.x < 0
          if (f !== s.flip) s.n++
          s.flip = f
        }
      })
    }
    for (const s of suivi) pire = Math.max(pire, s.n)
    expect(pire).toBeLessThanOrEqual(4)
  })

  it('A12 — L’APPEL : un loup dont un frère chasse converge sur la MÊME proie', () => {
    const { sim, pack } = makePack(3, 80.5, 80.5)
    // Une proie hors de l'aggro (13) du dernier loup, mais dans le rayon d'appel.
    const proie = spawnEntity(sim, 92.5, 80.5)
    const dernier = pack.at(-1)!
    expect(dist(entity(sim, dernier.entityId), entity(sim, proie))).toBeLessThan(MONSTER_DEFS.wolf.aggroRange)

    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    // Toute la meute converge sur la même cible — un seul animal à trois têtes.
    for (const w of pack) expect(w.targetId).toBe(proie)
  })
})

describe('le mâle alpha (A13 — R12)', () => {
  /**
   * Une meute NÉE du peuplement — c'est lui qui distribue les alphas. On s'arrête
   * DÈS QU'ELLE EXISTE : laisser tourner, c'est laisser l'alpha aller se battre
   * avec un sanglier, et mesurer ses PV ne veut alors plus rien dire (vécu).
   */
  /**
   * LA MEUTE NE NAÎT PLUS DU PEUPLEMENT (loup.md L4, 2026-08-28) : l'ambiant ne
   * lève que des rôdeurs solitaires — le clan vit en Louvière. Le banc pose donc
   * sa meute à la main, comme `populateLouviere` la composerait ; et une harde
   * de cerfs à côté, pour le contre-test (une harde n'a pas de chef).
   */
  function packSauvage(): { sim: SimState; alpha: Monster; meute: Monster[] } {
    const map = createEmptyMap(160, 160, TERRAIN_FOREST)
    const sim = createSim(99, { map, faunaCap: 0, cycleOffset: cycleOffsetForStartHour(2, 1) })
    spawnEntity(sim, 80.5, 80.5)
    const herdId = sim.nextHerdId++
    const alphaId = spawnMonster(sim, 'wolf', 100.5, 100.5)
    const chef = sim.monsters.find((m) => m.entityId === alphaId)!
    chef.alpha = true
    chef.alphaId = alphaId
    chef.herdId = herdId
    entity(sim, alphaId).hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP
    for (let i = 1; i <= 2; i++) {
      const id = spawnMonster(sim, 'wolf', 100.5 + i * 1.5, 100.5)
      const m = sim.monsters.find((x) => x.entityId === id)!
      m.herdId = herdId
      m.alphaId = alphaId
    }
    const deerHerd = sim.nextHerdId++
    for (let i = 0; i < 3; i++) {
      const id = spawnMonster(sim, 'deer', 60.5 + i * 2, 60.5)
      sim.monsters.find((x) => x.entityId === id)!.herdId = deerHerd
    }
    const meute = sim.monsters.filter((m) => m.alphaId === alphaId)
    return { sim, alpha: chef, meute }
  }

  it('A13 — chaque meute a UN alpha, et un seul ; les hardes de cerfs n’en ont pas', () => {
    const { sim, alpha, meute } = packSauvage()
    expect(alpha).toBeDefined()
    expect(meute.length).toBeGreaterThan(1)

    // Un seul chef par meute — jamais deux.
    for (const m of sim.monsters.filter((x) => x.type === 'wolf' && x.herdId !== undefined)) {
      const freres = sim.monsters.filter((x) => x.herdId === m.herdId)
      expect(freres.filter((x) => x.alpha).length).toBe(1)
    }
    // Le cerf n'a pas de chef : une harde n'est pas une meute.
    for (const d of sim.monsters.filter((m) => m.type === 'deer')) {
      expect(d.alpha).toBeFalsy()
      expect(d.alphaId).toBeUndefined()
    }
  })

  it('A13 — l’alpha est PLUS COSTAUD : il porte plus de PV que les siens', () => {
    const { sim, alpha, meute } = packSauvage()
    const pvAlpha = entity(sim, alpha.entityId).hp
    expect(pvAlpha).toBe(MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP)

    const suivant = meute.find((m) => !m.alpha)!
    expect(pvAlpha).toBeGreaterThan(entity(sim, suivant.entityId).hp)
    expect(FAUNA.ALPHA_DAMAGE).toBeGreaterThan(1) // et il frappe plus fort
  })

  it('A13 — TUER L’ALPHA DISPERSE LA MEUTE sur-le-champ', () => {
    const sim = makeSim(0, 2)
    // Le joueur est un MANNEQUIN : on le remet à 100 PV après chaque tick. Sans
    // ça, quatre loups le tuent en trois secondes et le test ne mesure plus la
    // dispersion mais la létalité de la meute (qui, elle, est déjà prouvée).
    const soigne = (id: number): boolean => {
      const e = entity(sim, id)
      const mordu = e.hp < 100
      e.hp = 100
      return mordu
    }
    const herdId = sim.nextHerdId++
    const alphaId = spawnMonster(sim, 'wolf', 80.5, 80.5)
    const chef = sim.monsters.find((m) => m.entityId === alphaId)!
    chef.alpha = true
    chef.alphaId = alphaId
    chef.herdId = herdId
    entity(sim, alphaId).hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP

    const suivants: Monster[] = []
    for (let i = 1; i <= 3; i++) {
      const id = spawnMonster(sim, 'wolf', 80.5 + i * 1.2, 80.5)
      const m = sim.monsters.find((x) => x.entityId === id)!
      m.herdId = herdId
      m.alphaId = alphaId
      suivants.push(m)
    }

    // Un joueur à portée : la meute (4 loups) le chasse, et le mord.
    const a = spawnEntity(sim, 86.5, 80.5)
    let mordu = false
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (soigne(a)) mordu = true
    }
    expect(mordu).toBe(true) // ils ont mordu
    for (const w of suivants) expect(w.routed).toBeFalsy()

    // On abat le chef.
    const distances = suivants.map((w) => dist(entity(sim, w.entityId), entity(sim, a)))
    die(sim, entity(sim, alphaId), a)
    tick(sim)

    // La meute éclate SUR-LE-CHAMP : plus de meute, plus de cible, chacun pour soi.
    for (const w of suivants) {
      expect(w.routed).toBe(true)
      expect(w.herdId).toBeUndefined()
      expect(w.targetId).toBeNull()
    }

    // Et ils s'enfuient VRAIMENT : chacun s'éloigne du joueur, et plus personne
    // ne le mord. C'est ce qui fait d'une meute un problème résoluble.
    let remordu = false
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (soigne(a)) remordu = true
    }
    expect(remordu).toBe(false) // plus une seule morsure
    suivants.forEach((w, i) => {
      expect(dist(entity(sim, w.entityId), entity(sim, a))).toBeGreaterThan(distances[i]!)
    })
  })
})

describe('la rencontre (A14 — R13) — ce doit être un moment', () => {
  /** Une meute complète (alpha + 3), la nuit, prête à chasser. */
  function meute(sim: SimState, x: number, y: number): Monster[] {
    const herdId = sim.nextHerdId++
    const alphaId = spawnMonster(sim, 'wolf', x, y)
    const chef = sim.monsters.find((m) => m.entityId === alphaId)!
    chef.alpha = true
    chef.alphaId = alphaId
    chef.herdId = herdId
    entity(sim, alphaId).hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP
    const out = [chef]
    for (let i = 1; i <= 3; i++) {
      const id = spawnMonster(sim, 'wolf', x + i * 1.2, y)
      const m = sim.monsters.find((z) => z.entityId === id)!
      m.herdId = herdId
      m.alphaId = alphaId
      out.push(m)
    }
    return out
  }

  it('A14 — LA MORT est l’issue probable : un homme désarmé ne survit pas à une meute', () => {
    const sim = makeSim(0, 2)
    meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 84.5, 80.5)

    // Il se bat, à mains nues, du mieux qu'il peut — et il meurt.
    let mort = false
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && !mort; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } }])
      if (entity(sim, a).hp <= 0 || sim.entities.find((e) => e.id === a)?.hp === 50) mort = true
    }
    expect(mort).toBe(true)

    // Et la raison est arithmétique, pas anecdotique. L'endurance (100, à 15 le
    // coup) n'autorise que 6 coups avant l'épuisement, soit 36 dégâts : tout juste
    // de quoi abattre UN loup sur quatre — et pas même de quoi entamer l'alpha,
    // qui en porte 66. Une lance (16) change tout : c'est LÀ qu'est la porte.
    const budget = Math.floor(100 / COMBAT.ATTACK_STAMINA) * COMBAT.UNARMED_DAMAGE
    expect(budget).toBeLessThan(MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP) // même pas l'alpha seul
    const meutePv = MONSTER_DEFS.wolf.hp * (3 + FAUNA.ALPHA_HP)
    expect(budget).toBeLessThan(meutePv / 4) // face à la meute, c'est une aumône
  })

  it('A14 — LE HURLEMENT : la meute s’annonce avant de frapper (GDD §9bis)', () => {
    const sim = makeSim(0, 2)
    const pack = meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 90.5, 80.5) // à 10 tuiles : dans l'aggro (13)
    drainEvents(sim)

    tick(sim)
    const howls = drainEvents(sim).filter((e) => e.type === 'wolf_howl')
    expect(howls).toHaveLength(1) // UN hurlement, pas quatre
    const howl = howls[0]!
    expect(howl.type === 'wolf_howl' && howl.targetEntityId).toBe(a)
    expect(howl.type === 'wolf_howl' && howl.packSize).toBe(4)

    // Et il ne se répète pas : un avertissement qui se rabâche n'avertit plus.
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(drainEvents(sim).filter((e) => e.type === 'wolf_howl')).toHaveLength(0)
    for (const w of pack) expect(w.howledAt).toBe(a)
  })

  it('A14 — LA POURSUITE : on ne sème pas une meute en courant un peu', () => {
    const sim = makeSim(0, 2)
    const pack = meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 90.5, 80.5)
    tick(sim)
    expect(pack[0]!.targetId).toBe(a) // elle l'a choisi

    // Il détale à 18 tuiles — bien au-delà de l'aggro (13), donc « hors de vue »
    // au sens de l'acquisition. La meute, elle, le tient toujours.
    entity(sim, a).x = 98.5
    tick(sim)
    expect(dist(entity(sim, a), entity(sim, pack[0]!.entityId))).toBeGreaterThan(MONSTER_DEFS.wolf.aggroRange)
    expect(pack[0]!.targetId).toBe(a) // …et elle le SUIT toujours

    // Ce n'est qu'au-delà de PURSUIT_RANGE qu'elle renonce.
    entity(sim, a).x = 80.5 + FAUNA.PURSUIT_RANGE + 3
    tick(sim)
    expect(pack[0]!.targetId).toBeNull()
  })

  it('A14 — LE FEU : atteindre un Feu allumé rompt la poursuite', () => {
    const sim = makeSim(0, 2)
    const pack = meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 90.5, 80.5)
    tick(sim)
    expect(pack[0]!.targetId).toBe(a)

    // On plante un Feu, et le fuyard l'atteint.
    sim.structures.push({
      id: sim.nextStructureId++,
      type: 'fire',
      tx: 95,
      ty: 80,
      villageId: 0,
      ownerId: 0,
      hp: STRUCTURE_HP.fire,
      access: 'public',
    })
    entity(sim, a).x = 95.5
    entity(sim, a).y = 80.5
    tick(sim)

    // La meute le lâche : elle n'approche pas du Foyer.
    expect(pack[0]!.targetId).toBeNull()

    // Et elle ne le reprend pas tant qu'il y reste.
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    for (const w of pack) expect(w.targetId).toBeNull()
    expect(entity(sim, a).hp).toBe(100) // pas une morsure
  })
})

describe('le sanglier (A15 — R14) — il ne fuit pas, il décide', () => {
  /** Un sanglier en forêt, à SON heure (il est nocturne). */
  function sanglier(x = 30.5, y = 30.5): { sim: SimState; id: number; m: Monster } {
    const sim = makeSim(0, 2)
    const id = spawnMonster(sim, 'boar', x, y)
    return { sim, id, m: sim.monsters.find((z) => z.entityId === id)! }
  }

  /** Le laisse fouir. Rend faux s'il ne s'y est jamais mis. */
  function attendreLaFouille(sim: SimState, m: Monster): boolean {
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (m.rootUntil !== undefined) return true
    }
    return false
  }

  it('A15 — LA FOUILLE : il fouge, immobile, groin au sol', () => {
    const { sim, id, m } = sanglier()
    expect(attendreLaFouille(sim, m)).toBe(true)
    const pos = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < 10 && m.rootUntil !== undefined; t++) tick(sim)
    expect(dist(entity(sim, id), pos)).toBe(0)
  })

  it('A15 — la fouille EST la fenêtre : on l’approche sans le lever', () => {
    const { sim, id, m } = sanglier()
    expect(attendreLaFouille(sim, m)).toBe(true)

    // Un chasseur se glisse à 2,5 tuiles — DANS sa portée de menace normale (4,5),
    // mais hors de sa portée diminuée par la fouille (4,5 × 0,4 = 1,8).
    spawnEntity(sim, entity(sim, id).x + 2.5, entity(sim, id).y)
    tick(sim)
    expect(m.threatSince).toBeUndefined() // il n'a rien vu : il fouge encore
    expect(m.rootUntil).toBeDefined()
  })

  it('A15 — LA MENACE : il ne fuit pas, il se plante face à vous… puis il charge', () => {
    const { sim, id, m } = sanglier()
    spawnEntity(sim, 33.5, 30.5) // à 3 tuiles : dans THREAT_RANGE (4,5)

    tick(sim)
    expect(m.threatSince).toBeDefined() // il menace
    expect(m.chargeUntil).toBeUndefined() // …mais il ne charge pas encore

    // Il est FIGÉ pendant l'avertissement, et tourné vers l'intrus.
    const pos = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < FAUNA.THREAT_TICKS - 2; t++) tick(sim)
    expect(dist(entity(sim, id), pos)).toBe(0)
    expect(entity(sim, id).facing.x).toBeGreaterThan(0.9) // il regarde vers lui
    expect(m.chargeUntil).toBeUndefined()

    // L'avertissement passé, la charge part.
    for (let t = 0; t < 5; t++) tick(sim)
    expect(m.chargeUntil).toBeDefined()
  })

  it('A15 — reculer pendant l’avertissement SUFFIT : il ne charge pas', () => {
    const { sim, m } = sanglier()
    const a = spawnEntity(sim, 33.5, 30.5)
    tick(sim)
    expect(m.threatSince).toBeDefined()

    // On recule hors de sa portée de menace, avant la fin du compte à rebours.
    entity(sim, a).x = 40.5
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(m.threatSince).toBeUndefined()
    expect(m.chargeUntil).toBeUndefined() // il n'a jamais chargé
    expect(entity(sim, a).hp).toBe(100)
  })

  it('A15 — LA CHARGE : plus rapide qu’un sprint, DROITE, et elle encorne UNE fois', () => {
    const { sim, id, m } = sanglier()
    const a = spawnEntity(sim, 34.5, 30.5)

    // On l'attend, planté là — le mauvais choix.
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ && m.chargeUntil === undefined; t++) tick(sim)
    expect(m.chargeUntil).toBeDefined()
    const cap = { x: m.chargeDx!, y: m.chargeDy! }

    let pasMax = 0
    let prev = { x: entity(sim, id).x, y: entity(sim, id).y }
    let garde = 0
    while (m.chargeUntil !== undefined && garde++ < 200) {
      tick(sim)
      const e = entity(sim, id)
      pasMax = Math.max(pasMax, dist(e, prev))
      prev = { x: e.x, y: e.y }
      // Le cap ne bouge JAMAIS : il ne corrige pas sa course. C'est ce verrou
      // qui rend l'esquive possible.
      if (m.chargeDx !== undefined) {
        expect(m.chargeDx).toBe(cap.x)
        expect(m.chargeDy).toBe(cap.y)
      }
    }

    // Elle va plus vite qu'un sprint de joueur : on ne la distance pas. Le
    // rapport se lit sur les DÉFINITIONS, pas sur les pas mesurés : le terrain
    // (la forêt freine tout le monde à 0,8) s'appliquerait aussi au joueur, et
    // comparer une charge en forêt à un sprint en plaine ne prouverait rien.
    expect(MONSTER_DEFS.boar.speed * FAUNA.CHARGE_SPEED).toBeGreaterThan(
      BALANCE.WALK_SPEED_TILES_PER_S * COMBAT.SPRINT_FACTOR,
    )
    // Et sur le terrain, elle est bien une CHARGE : plus rapide que son allure.
    expect(pasMax).toBeGreaterThan(MONSTER_DEFS.boar.speed / BALANCE.TICK_RATE_HZ)
    expect(entity(sim, a).hp).toBeLessThan(100) // et elle a porté…
    expect(entity(sim, a).hp).toBeGreaterThanOrEqual(100 - MONSTER_DEFS.boar.damage) // …UNE fois
  })

  it('A15 — S’ÉCARTER : la charge passe à côté, et il reste ESSOUFFLÉ, offert', () => {
    const { sim, id, m } = sanglier()
    const a = spawnEntity(sim, 34.5, 30.5)

    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ && m.chargeUntil === undefined; t++) tick(sim)
    expect(m.chargeUntil).toBeDefined()

    // Le bon geste : on s'écarte LATÉRALEMENT. La charge est verrouillée sur l'est,
    // elle ne suivra pas.
    entity(sim, a).y = 36.5
    let garde = 0
    while (m.chargeUntil !== undefined && garde++ < 200) tick(sim)

    expect(entity(sim, a).hp).toBe(100) // elle a fendu l'air
    expect(m.windedUntil).toBeDefined() // et il souffle

    // Il est IMMOBILE tant qu'il souffle : c'est la fenêtre pour le frapper.
    const pos = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < FAUNA.WINDED_TICKS - 2; t++) tick(sim)
    expect(m.windedUntil).toBeDefined()
    expect(dist(entity(sim, id), pos)).toBe(0)
  })
})

describe('la satiété (A16 — R15) — un prédateur mange', () => {
  function meutePosee(sim: SimState, x: number, y: number, n = 3): Monster[] {
    const herdId = sim.nextHerdId++
    const alphaId = spawnMonster(sim, 'wolf', x, y)
    const chef = sim.monsters.find((m) => m.entityId === alphaId)!
    chef.alpha = true
    chef.alphaId = alphaId
    chef.herdId = herdId
    entity(sim, alphaId).hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP
    const out = [chef]
    for (let i = 1; i < n; i++) {
      const id = spawnMonster(sim, 'wolf', x + i * 1.2, y)
      const m = sim.monsters.find((z) => z.entityId === id)!
      m.herdId = herdId
      m.alphaId = alphaId
      out.push(m)
    }
    return out
  }

  it('A16 — il va à la carcasse, il mange, et il devient REPU', () => {
    const sim = makeSim(0, 2)
    const pack = meutePosee(sim, 80.5, 80.5, 1)
    sim.corpses.push({ id: sim.nextCorpseId++, x: 86.5, y: 80.5, inventory: inventoryOf(SLOTS.CORPSE, { raw_meat: 3 }), decayAt: 1e9, diedAt: sim.tick })

    let mange = false
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && !mange; t++) {
      tick(sim)
      mange = pack[0]!.eatingUntil !== undefined
    }
    expect(mange).toBe(true) // il s'y est rendu et il mange

    for (let t = 0; t < FAUNA.EAT_TICKS + 2; t++) tick(sim)
    expect(pack[0]!.faim!).toBeLessThan(1 - FAUNA.FAIM_PAR_PROIE + 0.05) // la jauge a mangé (loup.md L6)
    expect(countOf(sim.corpses[0]!.inventory, 'raw_meat')).toBe(2) // et il a entamé la carcasse
  })

  it('A16 — REPU, il ne chasse plus : on passe à côté d’une meute rassasiée', () => {
    const sim = makeSim(0, 2)
    const pack = meutePosee(sim, 80.5, 80.5)
    for (const w of pack) w.faim = 0 // repus : la jauge à zéro, pas de sortie (loup.md L6)

    const a = spawnEntity(sim, 86.5, 80.5) // à 6 tuiles : bien dans leur aggro (13)
    drainEvents(sim)
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    for (const w of pack) expect(w.targetId).toBeNull()
    expect(entity(sim, a).hp).toBe(100) // pas une morsure
    expect(drainEvents(sim).filter((e) => e.type === 'wolf_howl')).toHaveLength(0) // pas un hurlement
  })

  it('A16 — mais REPU N’EST PAS INOFFENSIF : frappé, il se défend', () => {
    const sim = makeSim(0, 2)
    const pack = meutePosee(sim, 80.5, 80.5, 1)
    pack[0]!.faim = 0
    const a = spawnEntity(sim, 79.5, 80.5)

    strike(sim, a, 1, 0) // on le frappe

    // ⚠ ON OBSERVE TANT QUE LE SUJET TIENT DEBOUT (2026-08-31). Huit secondes collé à un
    // loup, à mains nues, c'est une mort — et depuis que le mort RESTE à terre, la meute
    // le lâche (la faune ne prend pas pour cible ce qui est à `hp = 0`). Le test lisait
    // donc l'état d'APRÈS : il ne passait que parce que la mort relevait aussitôt son
    // homme sur place, à deux pas du loup, indéfiniment. La riposte, elle, se mesure de
    // son vivant — c'est ce qu'A16 affirme.
    let riposte = false
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && entity(sim, a).hp > 0; t++) {
      tick(sim)
      if (pack[0]!.targetId === a && entity(sim, a).hp < 100) {
        riposte = true // il a pris son agresseur pour cible ET rendu le coup
        break
      }
    }
    expect(riposte).toBe(true)
  })

  it('CONSERVATION — une carcasse MIXTE mangée jusqu’à l’os garde son bois et sa hache', () => {
    const sim = makeSim(0, 2)
    const pack = meutePosee(sim, 80.5, 80.5, 1)
    // Un mort qui portait de la viande ET du bois ET une hache : la carcasse est
    // un conteneur, pas un simple steak. Le prédateur ne mange que la viande.
    sim.corpses.push({
      id: sim.nextCorpseId++,
      x: 82.5,
      y: 80.5,
      inventory: inventoryOf(SLOTS.CORPSE, { raw_meat: 1, wood: 5, axe: 1 }),
      decayAt: 1e9,
      diedAt: 0,
    })
    const corpseId = sim.corpses[0]!.id

    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && (pack[0]!.faim ?? 1) > 0.9; t++) tick(sim)
    expect(pack[0]!.faim!).toBeLessThan(0.9) // il a mangé la bouchée : la jauge est tombée

    const meal = sim.corpses.find((c) => c.id === corpseId)
    expect(meal).toBeDefined() // la carcasse n’a PAS disparu : elle n’est pas vide
    expect(countOf(meal!.inventory, 'raw_meat')).toBe(0) // la viande est mangée…
    expect(countOf(meal!.inventory, 'wood')).toBe(5) // …mais le bois est INTACT
    expect(countOf(meal!.inventory, 'axe')).toBe(1) // …et la hache aussi
  })

  it('ANTI-LIVELOCK — la carcasse vidée de sa viande n’aimante plus le loup', () => {
    const sim = makeSim(0, 2)
    const pack = meutePosee(sim, 80.5, 80.5, 1)
    sim.corpses.push({
      id: sim.nextCorpseId++,
      x: 82.5,
      y: 80.5,
      inventory: inventoryOf(SLOTS.CORPSE, { raw_meat: 1, wood: 5 }),
      decayAt: 1e9,
      diedAt: 0,
    })

    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && (pack[0]!.faim ?? 1) > 0.9; t++) tick(sim)
    // On le rend AFFAMÉ de nouveau : la carcasse ne porte plus que du bois.
    pack[0]!.faim = 1
    delete pack[0]!.mealCorpseId
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    expect(pack[0]!.eatingUntil).toBeUndefined() // il ne se remet JAMAIS à ronger du bois
  })
})

describe('la pression de chasse (A17 — R16) — ni farm, ni désert', () => {
  it('A17 — LE FARM EST FERMÉ : plus une seule naissance autour d’une mise à mort', () => {
    const sim = makeSim(BENCH_CAP, 12)
    const a = spawnEntity(sim, 80.5, 80.5)
    // La PRÉCONDITION se lit sur toute la minute, pas sur le tick d'arrivée : la population
    // RESPIRE (une bête qui s'éloigne se dissipe, le semeur la remplace à la demi-seconde),
    // si bien qu'un instantané tombe parfois sur un creux d'une unité. Ce qu'il faut ici,
    // c'est que l'anneau soit PLEIN avant qu'on tue — donc que le plafond ait été atteint.
    let plafond = 0
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      plafond = Math.max(plafond, ambientCount(sim))
    }
    expect(plafond).toBe(BENCH_CAP)
    expect(ambientCount(sim)).toBeGreaterThan(BENCH_CAP - 3)

    // Le chasseur REJOINT sa proie et l'abat — c'est la situation réelle : on ne
    // tue pas du gibier à trente tuiles, on va le chercher. Le silence se pose
    // donc là où le chasseur se trouve, et couvre tout son anneau de naissance.
    const proie = sim.monsters.find((m) => m.ambient)!
    const p = entity(sim, proie.entityId)
    entity(sim, a).x = p.x
    entity(sim, a).y = p.y
    const avant = new Set(sim.monsters.filter((m) => m.ambient).map((m) => m.entityId))
    die(sim, p, a)
    expect(sim.faunaQuiet).toHaveLength(1)

    // Le peuplement NE REMPLACE RIEN : les bois se sont tus. Sans cette règle,
    // l'anneau remplaçait la bête abattue en une demi-seconde, et un joueur planté
    // là récoltait de la viande à l'infini sans faire un pas.
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const nouveaux = sim.monsters.filter((m) => m.ambient && !avant.has(m.entityId))
    expect(nouveaux).toHaveLength(0)
    expect(ambientCount(sim)).toBeLessThan(BENCH_CAP)
  })

  it('A17 — mais ce n’est PAS un désert : lever le camp suffit, et le calme revient', () => {
    const sim = makeSim(BENCH_CAP, 12)
    const a = spawnEntity(sim, 80.5, 80.5)
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    const proie = sim.monsters.find((m) => m.ambient)!
    const p = entity(sim, proie.entityId)
    entity(sim, a).x = p.x
    entity(sim, a).y = p.y
    die(sim, p, a)
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const bloque = ambientCount(sim)

    // LEVER LE CAMP : le chasseur s'en va au-delà du rayon de silence. Le gibier
    // est là — ailleurs. La chasse est une ressource de TERRITOIRE, pas de temps.
    const chasse = { x: entity(sim, a).x, y: entity(sim, a).y }
    entity(sim, a).x = 20.5
    entity(sim, a).y = 20.5
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(ambientCount(sim)).toBeGreaterThan(bloque)

    // Et la zone chassée se rouvre d'elle-même, le temps passé : ce n'est pas une
    // terre brûlée, c'est une bête qui a eu peur. On ne regarde que LA zone du
    // chasseur : l'écosystème vit (un loup peut tuer ailleurs pendant ce temps,
    // et poser SA zone de silence — c'est le monde qui marche, pas le test qui rate).
    const auCamp = (): number =>
      sim.faunaQuiet.filter((z) => distSq(z.x, z.y, chasse.x, chasse.y) < 1).length
    expect(auCamp()).toBe(1)
    for (let t = 0; t < FAUNA.QUIET_TICKS; t++) tick(sim)
    expect(auCamp()).toBe(0) // le calme est revenu là où l'on a chassé
  })

  it('A17 — tuer un LOUP ne fait taire personne (un prédateur mort ne chasse plus)', () => {
    const sim = makeSim(BENCH_CAP, 2)
    const a = spawnEntity(sim, 80.5, 80.5)
    const loupId = spawnMonster(sim, 'wolf', 82.5, 80.5)
    die(sim, entity(sim, loupId), a)
    expect(sim.faunaQuiet).toHaveLength(0)
  })

  it('A17 — LA TANIÈRE REVIT : sa bête abattue revient, mais hors de vue et sans hâte', () => {
    // Une carte avec un vrai lieu à bête. On prend la Veillée : elle en a.
    const sim = makeSim(0, 12)
    sim.map.zones.push({ x: 40, y: 40, w: 6, h: 6, kind: 'taniere', name: 'la Tanière' })
    spawnPoiMonsters(sim, sim.seed)
    const bete = sim.monsters.find((m) => m.homePoi !== undefined)
    expect(bete).toBeDefined()

    // Un chasseur, TRÈS loin (sinon la tanière ne se repeuple pas sous ses yeux).
    const a = spawnEntity(sim, 140.5, 140.5)
    die(sim, entity(sim, bete!.entityId), a)
    expect(sim.monsters.some((m) => m.homePoi !== undefined)).toBe(false)

    // Elle ne revient pas tout de suite — ce n'est pas un robinet.
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(sim.monsters.some((m) => m.homePoi !== undefined)).toBe(false)
    expect(sim.denRespawns).toHaveLength(1)

    // …mais elle revient.
    for (let t = 0; t < FAUNA.DEN_RESPAWN_TICKS; t++) tick(sim)
    expect(sim.monsters.some((m) => m.homePoi !== undefined)).toBe(true)
    expect(sim.denRespawns).toHaveLength(0)
  })

  it('A17 — la tanière ne se repeuple JAMAIS sous les yeux d’un joueur', () => {
    const sim = makeSim(0, 12)
    sim.map.zones.push({ x: 40, y: 40, w: 6, h: 6, kind: 'taniere', name: 'la Tanière' })
    spawnPoiMonsters(sim, sim.seed)
    const bete = sim.monsters.find((m) => m.homePoi !== undefined)!

    // Le joueur CAMPE la tanière.
    const a = spawnEntity(sim, 43.5, 43.5)
    die(sim, entity(sim, bete.entityId), a)

    for (let t = 0; t < FAUNA.DEN_RESPAWN_TICKS * 2; t++) tick(sim)
    expect(sim.monsters.some((m) => m.homePoi !== undefined)).toBe(false) // rien devant lui

    // Il s'en va : la tanière revit.
    entity(sim, a).x = 140.5
    entity(sim, a).y = 140.5
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(sim.monsters.some((m) => m.homePoi !== undefined)).toBe(true)
  })
})

describe('déterminisme (A9)', () => {
  it('A9 — même seed, mêmes inputs, même monde peuplé — au bit près', () => {
    const run = (): string => {
      const sim = makeSim()
      const a = spawnEntity(sim, 80.5, 80.5)
      for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) {
        tick(sim, [{ entityId: a, dx: t % 80 < 40 ? 1 : -1, dy: 0 }])
      }
      return snapshot(sim)
    }
    expect(run()).toBe(run())
  })

  it('A9 — l’état reste JSON-sérialisable (pas de Map, pas de Set, pas de classe)', () => {
    const sim = makeSim()
    spawnEntity(sim, 80.5, 80.5)
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(ambientCount(sim)).toBeGreaterThan(0)
    const round = JSON.parse(JSON.stringify(sim)) as SimState
    expect(snapshot(round)).toBe(snapshot(sim))
  })
})

describe('la carte bloquante ne piège pas le peuplement', () => {
  it('une bête ne naît jamais sur une tuile bloquante', () => {
    const map = createEmptyMap(160, 160, TERRAIN_GRASS)
    // Un damier de rochers : une naissance non gardée tomberait dedans.
    for (let ty = 0; ty < 160; ty++) {
      for (let tx = 0; tx < 160; tx++) {
        if ((tx + ty) % 2 === 0) map.terrain[ty * map.width + tx] = TERRAIN_ROCK
      }
    }
    const sim = createSim(7, { map, faunaCap: BENCH_CAP })
    spawnEntity(sim, 80.5, 80.5)
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    for (const m of sim.monsters) {
      const e = entity(sim, m.entityId)
      const terrain = sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!
      expect(terrain).not.toBe(TERRAIN_ROCK)
    }
  })
})

describe('la fuite engagée (A18 — R6) et l’espace vital (A19 — R6bis)', () => {
  /** Une harde posée à la main : n cerfs alignés, même identité. */
  function makeHerdOf(sim: SimState, n: number, cx: number, cy: number, spread = 2.5): Monster[] {
    const herdId = sim.nextHerdId
    sim.nextHerdId += 1
    const members: Monster[] = []
    for (let i = 0; i < n; i++) {
      const id = spawnMonster(sim, 'deer', cx + i * spread, cy)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      m.herdId = herdId
      members.push(m)
    }
    return members
  }

  /** Un pas de POURSUITE : l'avatar sprinte droit sur la bête, cap recalculé. */
  function chaseTick(sim: SimState, aId: number, preyId: number): void {
    const a = entity(sim, aId)
    const p = entity(sim, preyId)
    const dx = (p.x - a.x > 0.3 ? 1 : p.x - a.x < -0.3 ? -1 : 0) as -1 | 0 | 1
    const dy = (p.y - a.y > 0.3 ? 1 : p.y - a.y < -0.3 ? -1 : 0) as -1 | 0 | 1
    tick(sim, [{ entityId: aId, dx, dy, sprint: true }])
  }

  it('A18 — ON NE RATTRAPE PAS UN CERF : dix secondes de sprint, la distance CROÎT', () => {
    const sim = makeSim(0)
    // Au sud de la carte : un cerf en surrégime couvre ~70 tuiles en 10 s — il
    // lui faut de la piste (le premier banc l'acculait au bord du monde).
    const id = spawnMonster(sim, 'deer', 80.5, 110.5)
    const a = spawnEntity(sim, 80.5, 115) // à 4,5 tuiles : la poursuite commence tout de suite
    const d0 = dist(entity(sim, id), entity(sim, a))
    let closest = Infinity
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      chaseTick(sim, a, id)
      closest = Math.min(closest, dist(entity(sim, id), entity(sim, a)))
    }
    const d1 = dist(entity(sim, id), entity(sim, a))
    expect(closest).toBeGreaterThan(1.2) // jamais au contact
    expect(d1).toBeGreaterThan(d0 + 3) // et l'écart se CREUSE : le surrégime paie
  })

  it('A18 — la fuite est ENGAGÉE : la menace disparue, il court jusqu’à FLEE_GOAL du point de peur', () => {
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'deer', 80.5, 60.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const a = spawnEntity(sim, 80.5, 65) // gait `walk` par défaut : il sera levé vite
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && m.fleeSince < 0; t++) tick(sim)
    expect(m.fleeSince).toBeGreaterThanOrEqual(0)
    const from = { x: m.fleeFromX!, y: m.fleeFromY! }
    expect(dist(from, entity(sim, a))).toBeLessThan(2) // la peur vient bien de l'avatar

    // La menace S'ÉVAPORE (téléportée à l'autre bout) : il continue quand même.
    entity(sim, a).x = 20.5
    entity(sim, a).y = 140.5
    for (let t = 0; t < 15 * BALANCE.TICK_RATE_HZ && m.fleeSince >= 0; t++) tick(sim)
    expect(m.fleeSince).toBe(-1) // l'engagement s'est conclu…
    expect(dist(entity(sim, id), from)).toBeGreaterThanOrEqual(FAUNA.FLEE_GOAL - 2) // …LOIN du point de peur
    // Et la retombée n'est pas le calme : alerté, nerveux au plafond.
    expect(m.suspicion).toBe(HUNT.SUSPICION_ALERT)
    expect(m.nervous).toBe(HUNT.NERVOUS_MAX)
  })

  it('A18 — le souffle est un luxe de la marge : serré de près, AUCUNE pause', () => {
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'deer', 80.5, 60.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const a = spawnEntity(sim, 80.5, 64.5)
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && m.fleeSince < 0; t++) tick(sim)
    expect(m.fleeSince).toBeGreaterThanOrEqual(0)

    // PHASE 1 — la menace COLLE (re-téléportée à 8 tuiles derrière, chaque tick) :
    // on traverse une fenêtre de souffle entière sans qu'il s'arrête une seule fois.
    const cycle = FAUNA.BURST_RUN_TICKS + FAUNA.BURST_PAUSE_TICKS
    while ((sim.tick - m.fleeSince) % cycle !== FAUNA.BURST_RUN_TICKS) {
      entity(sim, a).x = entity(sim, id).x
      entity(sim, a).y = entity(sim, id).y + 8
      tick(sim)
    }
    let prev = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < 6; t++) {
      entity(sim, a).x = entity(sim, id).x
      entity(sim, a).y = entity(sim, id).y + 8
      tick(sim)
      const e = entity(sim, id)
      expect(dist(e, prev)).toBeGreaterThan(0) // il court PENDANT sa fenêtre de souffle
      prev = { x: e.x, y: e.y }
    }

    // PHASE 2 — la menace décroche (repart au loin) : au prochain souffle, il souffle.
    entity(sim, a).x = 20.5
    entity(sim, a).y = 140.5
    while ((sim.tick - m.fleeSince) % cycle !== FAUNA.BURST_RUN_TICKS && m.fleeSince >= 0) tick(sim)
    expect(m.fleeSince).toBeGreaterThanOrEqual(0) // l'engagement court toujours (borne : FLEE_GOAL)
    prev = { x: entity(sim, id).x, y: entity(sim, id).y }
    tick(sim)
    expect(dist(entity(sim, id), prev)).toBe(0) // le souffle est revenu
  })

  it("A19 — L'ESPACE VITAL : repérée une silhouette immobile à bout portant, la bête détale", () => {
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'deer', 80.5, 60.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const a = spawnEntity(sim, 80.5, 63.5) // à 3 tuiles < PERSONAL_SPACE
    m.suspicion = HUNT.SUSPICION_ALERT + 0.05 // elle l'a REPÉRÉ (le cas du joueur AFK)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ && m.fleeSince < 0; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0 }]) // l'avatar ne bouge PAS d'un pouce
    }
    expect(m.fleeSince).toBeGreaterThanOrEqual(0) // levée quand même : trop près, c'est trop près
  })

  it("A19 — contre-test : JAMAIS repérée, elle broute à la même distance sans broncher", () => {
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'deer', 80.5, 60.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    spawnEntity(sim, 80.5, 63.5) // même distance… mais la jauge reste sous le seuil
    const still = (aId: number): MoveInput => ({ entityId: aId, dx: 0, dy: 0 })
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [still(sim.entities[1]!.id)])
    expect(m.fleeSince).toBe(-1)
    expect(m.suspicion).toBeLessThan(HUNT.SUSPICION_ALERT)
  })

  it("A19 — L'IMPATIENCE : alertée trop longtemps, elle s'écarte au trot (sans fuir)", () => {
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'deer', 80.5, 60.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const a = spawnEntity(sim, 80.5, 68.5) // à 8 tuiles, gait `walk` : bien perçu, hors espace vital
    // La jauge monte et se cale sous 1 (menace plantée) : elle FIXE.
    for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ && (m.alertSince === undefined); t++) tick(sim)
    expect(m.alertSince).toBeDefined()
    const dAlert = dist(entity(sim, id), entity(sim, a))
    // L'impatience passée, elle s'écarte — la distance CROÎT, sans état de fuite.
    for (let t = 0; t < FAUNA.IMPATIENCE_TICKS + 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(dist(entity(sim, id), entity(sim, a))).toBeGreaterThan(dAlert + 1.5)
    expect(m.fleeSince).toBe(-1)
  })

  it('A20 — LA DÉRIVE : sans menace, le troupeau TRAVERSE le paysage — groupé', () => {
    const sim = makeSim(0)
    const herd = makeHerdOf(sim, 4, 76.5, 80.5)
    const center = (): { x: number; y: number } => {
      let sx = 0
      let sy = 0
      for (const m of herd) {
        sx += entity(sim, m.entityId).x
        sy += entity(sim, m.entityId).y
      }
      return { x: sx / herd.length, y: sy / herd.length }
    }
    const c0 = center()
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const c1 = center()
    expect(dist(c0, c1)).toBeGreaterThan(5) // le CENTRE a bougé : ce n'est plus un tremblement
    for (const m of herd) {
      expect(dist(entity(sim, m.entityId), c1)).toBeLessThan(FAUNA.HERD_SPREAD + 2) // et il est resté GROUPÉ
    }
  })

  it('A20 — LA SÉPARATION : deux cerfs l’un sur l’autre s’écartent', () => {
    const sim = makeSim(0)
    const herd = makeHerdOf(sim, 2, 80.5, 80.5, 0.4) // posés à 0,4 tuile
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const a = entity(sim, herd[0]!.entityId)
    const b = entity(sim, herd[1]!.entityId)
    expect(dist(a, b)).toBeGreaterThanOrEqual(FAUNA.HERD_SEPARATION - 0.1)
  })

  it('A20 — LA FUITE GROUPÉE : le cri de mort donne à toute la harde le MÊME point de peur', () => {
    const sim = makeSim(0)
    const herd = makeHerdOf(sim, 3, 78.5, 60.5)
    const hunter = spawnEntity(sim, 78.5, 62.5)
    const victim = entity(sim, herd[0]!.entityId)
    const vx = victim.x
    const vy = victim.y
    applyDamage(sim, victim, 999, hunter)
    // Les survivants portent le point de peur du frère tombé — le même pour tous.
    for (const m of [herd[1]!, herd[2]!]) {
      expect(m.fleeFromX).toBe(vx)
      expect(m.fleeFromY).toBe(vy)
    }
    // Et ils fuient — le même lieu, tous les deux, et LOIN.
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const s1 = entity(sim, herd[1]!.entityId)
    const s2 = entity(sim, herd[2]!.entityId)
    expect(herd[1]!.fleeSince).toBeGreaterThanOrEqual(0)
    expect(herd[2]!.fleeSince).toBeGreaterThanOrEqual(0)
    expect(dist(s1, { x: vx, y: vy })).toBeGreaterThan(8)
    expect(dist(s2, { x: vx, y: vy })).toBeGreaterThan(8)
  })

  it('A20/C14 — LA SCISSION : la harde levée éclate en DEUX groupes, et chaque moitié TIENT', () => {
    // Quatre cerfs : rangs 0-3, donc deux moitiés de deux (pairs / impairs).
    const sim = makeSim(0)
    const herd = makeHerdOf(sim, 4, 78.5, 60.5, 1.5)
    const hunter = spawnEntity(sim, 78.5 + 2.25, 66.5) // plein sud du centre : ils fuient au nord
    void hunter
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && herd.some((m) => m.fleeSince < 0); t++) tick(sim)
    expect(herd.every((m) => m.fleeSince >= 0)).toBe(true)
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    // Les deux moitiés, par rang (l'ordre des entityId — le même que la sim).
    const ranked = [...herd].sort((a, b) => a.entityId - b.entityId)
    const pairs = [ranked[0]!, ranked[2]!].map((m) => entity(sim, m.entityId))
    const impairs = [ranked[1]!, ranked[3]!].map((m) => entity(sim, m.entityId))
    const centre = (g: { x: number; y: number }[]): { x: number; y: number } => ({
      x: (g[0]!.x + g[1]!.x) / 2,
      y: (g[0]!.y + g[1]!.y) / 2,
    })

    // CHAQUE MOITIÉ TIENT (la cohésion joue DANS la moitié, pas dans la harde).
    expect(dist(pairs[0]!, pairs[1]!)).toBeLessThan(FAUNA.HERD_SPREAD + 3)
    expect(dist(impairs[0]!, impairs[1]!)).toBeLessThan(FAUNA.HERD_SPREAD + 3)
    // ET LES DEUX MOITIÉS DIVERGENT : on ne peut pas courir après « la harde ».
    expect(dist(centre(pairs), centre(impairs))).toBeGreaterThan(FAUNA.HERD_SPREAD + 3)
  })

  it('A20 — LE REPOS GROUPÉ : à l’heure du sommeil, la harde éparpillée se resserre puis dort', () => {
    const sim = makeSim(0, 2) // 2 h du matin : le cerf dort
    const herd = makeHerdOf(sim, 3, 74.5, 80.5, 6) // éparpillés sur 12 tuiles
    for (let t = 0; t < 25 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    let sx = 0
    let sy = 0
    for (const m of herd) {
      sx += entity(sim, m.entityId).x
      sy += entity(sim, m.entityId).y
    }
    const c = { x: sx / herd.length, y: sy / herd.length }
    for (const m of herd) expect(dist(entity(sim, m.entityId), c)).toBeLessThan(FAUNA.REST_SPREAD + 1)
    // Et une fois resserrée, elle DORT : plus un pas en une seconde.
    const before = herd.map((m) => ({ x: entity(sim, m.entityId).x, y: entity(sim, m.entityId).y }))
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim)
    herd.forEach((m, i) => {
      expect(entity(sim, m.entityId).x).toBe(before[i]!.x)
      expect(entity(sim, m.entityId).y).toBe(before[i]!.y)
    })
  })

  it('A21 — LA SENTINELLE : une seule, elle tourne, elle veille pendant que les autres broutent', () => {
    const sim = makeSim(0)
    const herd = makeHerdOf(sim, 4, 76.5, 80.5)
    // Exactement UNE sentinelle, membre de la harde.
    const s0 = sentinelOf(herd, sim.tick)
    expect(herd.map((m) => m.entityId)).toContain(s0)
    // Le rôle TOURNE : sur quatre relèves, au moins deux gardes différentes.
    const seen = new Set<number>()
    for (let shift = 0; shift < 4; shift++) seen.add(sentinelOf(herd, sim.tick + shift * FAUNA.SENTINEL_SHIFT))
    expect(seen.size).toBeGreaterThanOrEqual(2)
    // Une meute de LOUPS n'a pas de sentinelle.
    const wolves = [spawnMonster(sim, 'wolf', 120.5, 120.5), spawnMonster(sim, 'wolf', 122.5, 120.5), spawnMonster(sim, 'wolf', 124.5, 120.5)]
    const pack = wolves.map((id) => sim.monsters.find((m) => m.entityId === id)!)
    pack.forEach((m) => (m.herdId = 999))
    expect(sentinelOf(pack, sim.tick)).toBe(-1)

    // La garde VEILLE : plantée sur place, son regard balaie.
    // (On se cale en début de relève pour observer UNE garde stable.)
    while (sim.tick % FAUNA.SENTINEL_SHIFT !== 0) tick(sim)
    const guardId = sentinelOf(herd, sim.tick)
    const g = entity(sim, guardId)
    const at = { x: g.x, y: g.y }
    const facing0 = { x: g.facing.x, y: g.facing.y }
    for (let t = 0; t < FAUNA.SENTINEL_SWEEP_TICKS + 2; t++) tick(sim)
    expect(entity(sim, guardId).x).toBe(at.x) // elle n'a pas brouté d'un pas
    expect(entity(sim, guardId).y).toBe(at.y)
    const facing1 = entity(sim, guardId).facing
    expect(facing1.x !== facing0.x || facing1.y !== facing0.y).toBe(true) // et son regard a TOURNÉ
  })

  it('A21 — la sentinelle voit plus loin que les brouteuses relâchées', () => {
    const sim = makeSim(0)
    const herd = makeHerdOf(sim, 3, 78.5, 80.5, 2)
    while (sim.tick % FAUNA.SENTINEL_SHIFT !== 0) tick(sim) // début de relève : garde stable 20 s
    const guardId = sentinelOf(herd, sim.tick)
    const guard = herd.find((m) => m.entityId === guardId)!
    // Un marcheur plein nord, à 16 tuiles du groupe : dans le champ ACCRU de la
    // garde (24,5 = 17,5 × 1,4), hors du champ RELÂCHÉ des brouteuses (~18,6).
    spawnEntity(sim, entity(sim, guardId).x, entity(sim, guardId).y - 16)
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(guard.suspicion).toBeGreaterThanOrEqual(HUNT.SUSPICION_CURIOUS) // la garde l'a vu
    for (const m of herd) {
      if (m.entityId === guardId) continue
      expect(m.suspicion).toBeLessThan(HUNT.SUSPICION_CURIOUS) // les brouteuses, non
    }
  })
})

describe("l'heure du loup (A22 — R10bis) et le retour au pays (A23 — bug du gel)", () => {
  it('A22 — la vigueur du loup : maximale la nuit, minimale à midi, jamais nulle', () => {
    const nuit = wolfVigor(2)
    const midi = wolfVigor(12)
    expect(nuit).toBeGreaterThan(midi)
    expect(nuit).toBeCloseTo(1, 5)
    expect(midi).toBeGreaterThan(0) // le plancher tient : on incline le monde, on ne l'éteint pas
    expect(midi).toBeLessThan(0.6)
  })

  it('A22 — à MIDI il ne prend pas la cible qu’il aurait prise la NUIT', () => {
    // Même géométrie, deux heures : un homme à 10 tuiles d'un loup solitaire.
    const poser = (hour: number): Monster => {
      const sim = makeSim(0, hour)
      const id = spawnMonster(sim, 'wolf', 30.5, 30.5) // en forêt : chez lui
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      spawnEntity(sim, 30.5, 40.5) // à 10 tuiles : sous l'aggro de nuit (13), au-delà de celle de midi (~6)
      for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
      return m
    }
    expect(poser(2).targetId).not.toBeNull() // la nuit : il l'a choisi
    expect(poser(12).targetId).toBeNull() // à midi : il dort à moitié, l'homme passe
  })

  it('A22 — mais le plancher TIENT : collé à une meute de jour, on est mordu quand même', () => {
    const sim = makeSim(0, 12) // plein midi
    const ids = [spawnMonster(sim, 'wolf', 30.5, 30.5), spawnMonster(sim, 'wolf', 31.5, 30.5), spawnMonster(sim, 'wolf', 32.5, 30.5)]
    const pack = ids.map((id) => sim.monsters.find((m) => m.entityId === id)!)
    pack.forEach((m) => (m.herdId = 42)) // une vraie meute : le courage est là
    const a = spawnEntity(sim, 31.5, 32.5) // à DEUX tuiles : on leur marche dessus
    const hp0 = entity(sim, a).hp
    for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, a).hp).toBeLessThan(hp0) // ils mordent : une meute de jour reste mortelle
  })

  it('A23 — LE GEL : une bête jetée hors de son habitat RENTRE CHEZ ELLE (et ne se fige plus)', () => {
    // Le lapin vit en prairie. On le pose en pleine forêt (hors habitat), là où
    // la fuite engagée peut désormais l'expédier — et il y restait planté à jamais.
    const sim = makeSim(0)
    const id = spawnMonster(sim, 'rabbit', 30.5, 30.5) // au cœur du carré de forêt (10..50)
    const start = { x: entity(sim, id).x, y: entity(sim, id).y }
    const inHabitat = (): boolean => {
      const e = entity(sim, id)
      const t = sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!
      return t === TERRAIN_GRASS
    }
    expect(inHabitat()).toBe(false) // il est bien dehors au départ

    // Il MARCHE (contre-test de la régression : 0,000 tuile en 10 s, avant le correctif).
    let travelled = 0
    let prev = start
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      const e = entity(sim, id)
      travelled += dist(e, prev)
      prev = { x: e.x, y: e.y }
    }
    expect(travelled).toBeGreaterThan(1)
    expect(inHabitat()).toBe(true) // et il est RENTRÉ : la prairie, chez lui
  })
})

describe('le tremblement de la harde (R9 — le rappel est COLLANT)', () => {
  /**
   * PLAYTEST : « j'ai vu des cerfs TREMBLER en pâturant aux abords d'une forêt ».
   *
   * Ce n'était pas la forêt : c'était la COHÉSION. La bête broutait vers
   * l'extérieur ; à `HERD_SPREAD` la cohésion la rappelait d'un pas ; sous le
   * seuil, la cohésion lâchait — mais son CAP d'errance pointait toujours dehors,
   * donc elle ressortait aussitôt. Deux à trois allers-retours par SECONDE.
   *
   * Le seuil n'avait aucune hystérésis, contrairement à la peur (qui se déclenche
   * à `flightRange` et ne retombe qu'à `SAFE_RANGE`). Ce banc mesure le nombre de
   * changements de sens vertical : 254 en 30 s avant le correctif, ~20 après.
   */
  it('une harde qui broute ne TREMBLE pas : peu de changements de sens', () => {
    const sim = makeSim(0)
    const herdId = sim.nextHerdId++
    const herd: Monster[] = []
    for (const [x, y] of [[78.5, 78.5], [80.5, 79.5], [82.5, 81.5], [79.5, 82.5]] as const) {
      const id = spawnMonster(sim, 'deer', x, y)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      m.herdId = herdId
      herd.push(m)
    }
    spawnEntity(sim, 80.5, 200.5) // très loin : aucune menace, elles BROUTENT

    let flips = 0
    const lastSign = herd.map(() => 0)
    const prev = herd.map((m) => ({ x: entity(sim, m.entityId).x, y: entity(sim, m.entityId).y }))
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      herd.forEach((m, i) => {
        const e = entity(sim, m.entityId)
        const dy = e.y - prev[i]!.y
        const sign = dy > 0.001 ? 1 : dy < -0.001 ? -1 : 0
        if (sign !== 0 && lastSign[i] !== 0 && sign !== lastSign[i]) flips++
        if (sign !== 0) lastSign[i] = sign
        prev[i] = { x: e.x, y: e.y }
      })
    }
    // Une bête qui broute change de cap à sa cadence de réflexion (~1,2 s), donc
    // au plus ~25 fois par bête en 30 s dans le pire cas — et bien moins en
    // pratique (la persistance du cap). Le TREMBLEMENT, lui, en faisait 254.
    expect(flips).toBeLessThan(60)

    // Et la harde tient toujours : le correctif ne l'a pas dispersée.
    let sx = 0
    let sy = 0
    for (const m of herd) {
      sx += entity(sim, m.entityId).x
      sy += entity(sim, m.entityId).y
    }
    const c = { x: sx / herd.length, y: sy / herd.length }
    for (const m of herd) {
      expect(dist(entity(sim, m.entityId), c)).toBeLessThan(FAUNA.HERD_SPREAD + 2)
    }
  })
})

describe('les seuils qui commandent un mouvement veulent leur hystérésis (R9/R9bis)', () => {
  /** Compte les changements de sens vertical — la mesure du frémissement. */
  function flipsOf(sim: SimState, herd: Monster[], secondes: number): number {
    let flips = 0
    const lastSign = herd.map(() => 0)
    const prev = herd.map((m) => ({ y: entity(sim, m.entityId).y }))
    for (let t = 0; t < secondes * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      herd.forEach((m, i) => {
        const y = entity(sim, m.entityId).y
        const dy = y - prev[i]!.y
        const sign = dy > 0.001 ? 1 : dy < -0.001 ? -1 : 0
        if (sign !== 0 && lastSign[i] !== 0 && sign !== lastSign[i]) flips++
        if (sign !== 0) lastSign[i] = sign
        prev[i] = { y }
      })
    }
    return flips
  }

  function poserHarde(sim: SimState, points: readonly (readonly [number, number])[]): Monster[] {
    const herdId = sim.nextHerdId++
    const herd: Monster[] = []
    for (const [x, y] of points) {
      const id = spawnMonster(sim, 'deer', x, y)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      m.herdId = herdId
      herd.push(m)
    }
    spawnEntity(sim, 80.5, 150.5) // très loin : aucune menace, elles broutent
    return herd
  }

  /**
   * LA SÉPARATION. Repousser seulement la voisine LA PLUS PROCHE donnait un
   * billard : en s'écartant de B, la bête se rapproche de C ; au tick suivant
   * elle s'écarte de C et revient sur B. Cinq bêtes entassées frémissaient à
   * 2,5× le rythme de l'errance normale (128 contre 51 en 30 s). La SOMME des
   * répulsions pointe vers l'extérieur du groupe : une direction stable.
   */
  it('cinq cerfs ENTASSÉS ne frémissent pas plus qu’une harde au large', () => {
    const serres = makeSim(0)
    const a = poserHarde(serres, [[80.0, 80.0], [80.6, 80.2], [80.3, 80.7], [80.9, 80.8], [80.2, 80.4]])
    const entasses = flipsOf(serres, a, 30)

    const large = makeSim(0)
    const b = poserHarde(large, [[78.0, 80.0], [80.5, 80.0], [83.0, 80.0], [79.2, 82.4], [81.8, 82.4]])
    const temoin = flipsOf(large, b, 30)

    // Entassées, elles ne doivent pas s'agiter davantage qu'au large : la
    // séparation résout le voisinage d'un coup, elle ne le ping-pong pas.
    expect(entasses).toBeLessThan(temoin * 2)

    // Et elles se sont bien ÉCARTÉES : plus personne sous le seuil de contact.
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const p = entity(serres, a[i]!.entityId)
        const q = entity(serres, a[j]!.entityId)
        expect(dist(p, q)).toBeGreaterThan(FAUNA.HERD_SEPARATION - 0.1)
      }
    }
  })

  /**
   * LE RETOUR AU PAYS. Rendre la main dès que `floor()` dit « habitat », c'est
   * lâcher la bête PILE SUR LA LISIÈRE — où le moindre pas de cohésion ou de
   * séparation (qui ne connaissent pas les biomes) la rejette dehors, et où
   * `goHome` la rappelle aussitôt. Elle rentre donc jusqu'au CŒUR de sa tuile.
   */
  it('une harde jetée hors de son habitat rentre — et NE DANSE PAS sur la lisière', () => {
    // La carte du banc : forêt au nord-ouest (10..50), prairie ailleurs. Le cerf
    // vit dans les deux — on le pose donc sur du ROC… non : on le pose en prairie
    // au sud d'un mur de roche, et on mesure au retour. Plus simple : une harde
    // posée dans la forêt À CHEVAL sur la lisière est déjà chez elle. On force
    // donc le cas HORS habitat par le seul terrain qui n'est le sien nulle part.
    const sim = makeSim(0)
    for (let ty = 88; ty < 96; ty++) {
      for (let tx = 70; tx < 92; tx++) sim.map.terrain[ty * sim.map.width + tx] = TERRAIN_MARSH
    }
    const herd = poserHarde(sim, [[79.5, 90.5], [80.5, 90.9], [81.5, 91.2], [80.0, 91.5]])
    expect(herd.every((m) => sim.map.terrain[Math.floor(entity(sim, m.entityId).y) * sim.map.width + Math.floor(entity(sim, m.entityId).x)] === TERRAIN_MARSH)).toBe(true)

    const flips = flipsOf(sim, herd, 30)

    // Toutes rentrées — et AUCUNE n'est restée plantée sur la frontière.
    for (const m of herd) {
      const e = entity(sim, m.entityId)
      const terr = sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!
      expect(terr).not.toBe(TERRAIN_MARSH)
    }
    // Et elles ne frémissent pas : ~0,4 changement de sens par bête et par seconde
    // au pire (le trajet de retour lui-même en compte quelques-uns).
    expect(flips).toBeLessThan(30 * herd.length)
  })

  /**
   * ═══ LA PIRE SECONDE — la bonne unité de mesure du tremblement ═══
   *
   * « Parfois ils tremblent » (Alexis, 2026-08-01) est une plainte de POINTE, pas
   * de moyenne : une bête qui fait vingt demi-tours en une seconde puis se tient
   * tranquille une minute rend une moyenne rassurante et un écran qui vibre. On
   * mesure donc le PIRE, par bête et par seconde — et un demi-tour, c'est le pas
   * de ce tick qui renverse celui d'avant.
   */
  function pireDemiTours(sim: SimState, herd: Monster[], secondes: number): number {
    let pire = 0
    const suivi = herd.map((m) => {
      const e = entity(sim, m.entityId)
      return { x: e.x, y: e.y, capX: 0, capY: 0, fenetre: 0, n: 0 }
    })
    for (let t = 0; t < secondes * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      const fenetre = Math.floor(t / BALANCE.TICK_RATE_HZ)
      herd.forEach((m, i) => {
        const s = suivi[i]!
        if (fenetre !== s.fenetre) {
          pire = Math.max(pire, s.n)
          s.fenetre = fenetre
          s.n = 0
        }
        const e = entity(sim, m.entityId)
        const dx = e.x - s.x
        const dy = e.y - s.y
        if (dx * dx + dy * dy > 1e-9) {
          if (dx * s.capX + dy * s.capY < 0) s.n++
          s.capX = dx
          s.capY = dy
        }
        s.x = e.x
        s.y = e.y
      })
    }
    for (const s of suivi) pire = Math.max(pire, s.n)
    return pire
  }

  /**
   * LA BÊTE COINCÉE ENTRE DEUX VOISINES. La somme des répulsions est NORMALISÉE :
   * pleine force jusqu'au point d'équilibre, et un pas de longueur fixe. Serrée
   * entre deux congénères, la bête dépassait donc l'équilibre à chaque pas et
   * repartait en sens inverse au tick suivant — MESURÉ : vingt demi-tours dans la
   * pire seconde, le sprite se retournant à chaque fois. Une zone morte au
   * voisinage de l'équilibre, et l'immobilité plutôt que le retour au broutage
   * (qui la renvoyait aussitôt sur sa voisine), ramènent ça au bruit de fond.
   */
  it('une harde qui broute au coude à coude ne vibre pas sur place', () => {
    // La configuration MESURÉE (`tools/diag-cerf.mts`, banc « harde · midi · groupée ») :
    // cinq bêtes en ligne à 2,5 tuiles, dans leur canton. C'est le voisinage qui produit
    // l'équilibre — chacune tiraillée entre deux voisines — et il faut le laisser
    // s'installer : deux minutes, pas dix secondes.
    const sim = makeSim(0)
    const herd = poserHarde(sim, [[80.5, 80.5], [83.0, 80.5], [85.5, 80.5], [88.0, 80.5], [90.5, 80.5]])
    for (const m of herd) {
      m.groundX = 80.5
      m.groundY = 80.5
    }
    // Avant correctif : 20 demi-tours dans la pire seconde — un aller-retour PAR TICK.
    expect(pireDemiTours(sim, herd, 120)).toBeLessThanOrEqual(8)
  })

  /**
   * LA FRONTIÈRE DU CANTON (R17). Le retour au territoire rendait la main au
   * franchissement EXACT de `GROUND_RADIUS` : un pas de trot vers l'intérieur
   * (WARY_SPEED, deux fois plus long qu'un pas de broutage) faisait rentrer la
   * bête, deux pas de broutage la ressortaient — un cycle de TROIS TICKS, mesuré.
   * Elle rentre maintenant jusqu'à `GROUND_COMFORT`.
   */
  it('une bête sortie de son canton y rentre FRANCHEMENT — pas jusqu’à la frontière', () => {
    const sim = makeSim(0)
    const [m] = poserHarde(sim, [[80.5, 127.2]])
    m!.groundX = 80.5
    m!.groundY = 80.5
    const loin = () => Math.sqrt(distSq(entity(sim, m!.entityId).x, entity(sim, m!.entityId).y, 80.5, 80.5))
    expect(loin()).toBeGreaterThan(FAUNA.GROUND_RADIUS) // elle est bien dehors

    // On la suit jusqu'à ce qu'elle LÂCHE le retour : c'est là que tout se joue.
    let t = 0
    while (t < 60 * BALANCE.TICK_RATE_HZ && (t === 0 || m!.ranging)) {
      tick(sim)
      t++
    }
    expect(m!.ranging).toBeUndefined() // elle a fini de rentrer
    // …et elle a rendu la main BIEN dedans. Lâchée pile sur la frontière, le premier
    // pas de broutage la ressortait et le trot la ramenait : trois ticks de période,
    // le sprite se retournant à chaque fois (mesuré 2026-08-01). La marge est écrite
    // EN DUR — une garde qui se relit sur `GROUND_COMFORT` passerait même si le
    // confort valait le rayon, c'est-à-dire même sans hystérésis du tout.
    expect(FAUNA.GROUND_RADIUS - loin()).toBeGreaterThanOrEqual(2)
  })

  /**
   * LE REPOS GROUPÉ (R10 × R9bis). Le rappel du dormeur n'avait pas d'hystérésis :
   * le centre de la harde bouge dès qu'une dormeuse se recale, donc celle qui
   * venait de rentrer sous `REST_SPREAD` s'en retrouvait dehors au tick suivant et
   * repartait d'un pas. De nuit, c'est le seul mouvement de l'écran.
   */
  it('une dormeuse rappelée revient jusqu’au CONFORT, et se rendort pour de bon', () => {
    const sim = makeSim(FAUNA.GROUND_CAP, 21) // 21 h : hors des heures du cerf
    const herd = poserHarde(sim, [[80.5, 80.5], [84.5, 80.5], [80.5, 84.5]])
    const ecartee = herd[0]!
    const centre = () => {
      const e = entity(sim, ecartee.entityId)
      let sx = 0
      let sy = 0
      for (const m of herd.slice(1)) {
        sx += entity(sim, m.entityId).x
        sy += entity(sim, m.entityId).y
      }
      return Math.sqrt(distSq(e.x, e.y, sx / (herd.length - 1), sy / (herd.length - 1)))
    }
    expect(centre()).toBeGreaterThan(FAUNA.REST_SPREAD) // elle dort trop loin des siennes

    let t = 0
    while (t < 60 * BALANCE.TICK_RATE_HZ && (t === 0 || ecartee.regrouping)) {
      tick(sim)
      t++
    }
    expect(ecartee.regrouping).toBeUndefined()
    // Marge EN DUR, pour la même raison qu'au canton : relue sur `REST_COMFORT`, la
    // garde passerait même sans hystérésis.
    expect(FAUNA.REST_SPREAD - centre()).toBeGreaterThanOrEqual(0.5)

    // Et la harde couchée finit immobile : plus un pas dans la dernière seconde.
    for (let k = 0; k < 30 * BALANCE.TICK_RATE_HZ; k++) tick(sim)
    const avant = herd.map((m) => ({ x: entity(sim, m.entityId).x, y: entity(sim, m.entityId).y }))
    for (let k = 0; k < BALANCE.TICK_RATE_HZ; k++) tick(sim)
    herd.forEach((m, i) => {
      expect(entity(sim, m.entityId).x).toBe(avant[i]!.x)
      expect(entity(sim, m.entityId).y).toBe(avant[i]!.y)
    })
  })
})

describe('la curiosité est un VERROU, pas une comparaison (chasse C1)', () => {
  /**
   * La jauge de méfiance POURSUIT son stimulus, tick par tick. Comparer sa valeur
   * NUE à `SUSPICION_CURIOUS` faisait donc battre, au ras du seuil, les trois
   * choses qui en dépendent : le gel (elle s'arrête et regarde), la silhouette et
   * la teinte. MESURÉ : quinze bascules dans la pire seconde d'une approche
   * stop-and-go. L'état se lève à `SUSPICION_CURIOUS` et ne retombe qu'à
   * `SUSPICION_CALM` — et c'est `wary`, jamais la jauge, que tout le monde lit.
   */
  it('le verrou tient sous le seuil de montée, et lâche au seuil de calme', () => {
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 80.5, 80.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.thinkAt = Number.MAX_SAFE_INTEGER // elle ne broute pas : on mesure la jauge

    // Personne autour : la jauge ne monte pas, le verrou reste ouvert.
    tick(sim)
    expect(m.wary).toBeUndefined()

    // On la pose au-dessus du seuil : le verrou se lève. (Au-dessus AVEC de la
    // marge : sans stimulus la jauge décroît, et le tick la ferait passer dessous.)
    m.suspicion = HUNT.SUSPICION_CURIOUS + 0.05
    tick(sim)
    expect(m.wary).toBe(true)

    // Elle redescend SOUS le seuil de montée — le verrou TIENT (c'est tout le sujet).
    m.suspicion = (HUNT.SUSPICION_CURIOUS + HUNT.SUSPICION_CALM) / 2
    tick(sim)
    expect(m.wary).toBe(true)

    // …et il ne lâche qu'au seuil de calme.
    m.suspicion = HUNT.SUSPICION_CALM - 0.01
    tick(sim)
    expect(m.wary).toBeUndefined()
  })

  /**
   * L'ALARME EST UN CRI, PAS UN ÉTAT (R9). Alarmer sur « une sœur COURT en ce
   * moment » rendait l'alarme permanente tant qu'une bête tenait sa course :
   * celle qui avait fini la sienne se faisait relever, voyait sa fuite s'achever
   * DANS LE MÊME TICK (elle était déjà à FLEE_GOAL du point de peur), retombait,
   * et se faisait relever au suivant — une levée par tick.
   */
  it('une bête qui a fini sa fuite ne se fait pas relever à chaque tick par sa harde', () => {
    const sim = makeSim(0) // sans peuplement ambiant : on mesure CETTE harde, pas le monde
    const herdId = sim.nextHerdId++
    const herd: Monster[] = []
    for (const [x, y] of [[80.5, 80.5], [83.0, 80.5], [85.5, 80.5]] as const) {
      const id = spawnMonster(sim, 'deer', x, y)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      m.herdId = herdId
      herd.push(m)
    }
    // L'APPROCHE STOP-AND-GO (C1) : deux secondes de pas, trois de gel. C'est le
    // régime où une sœur tient sa course pendant que les autres ont fini la leur —
    // et c'est exactement là que l'alarme permanente relevait une bête déjà rentrée.
    const a = spawnEntity(sim, 82.5, 94.5)

    // On compte les BASCULES de l'état « levée », par bête et par seconde : la pire
    // seconde est la mesure (avant correctif : 5 à 13 selon la graine ; après : 1).
    let pire = 0
    const etat = herd.map(() => false)
    const parSeconde = herd.map(() => 0)
    for (let t = 0; t < 120 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: sim.tick % 100 < 40 ? -1 : 0 }])
      if (t % BALANCE.TICK_RATE_HZ === 0) {
        pire = Math.max(pire, ...parSeconde)
        parSeconde.fill(0)
      }
      herd.forEach((m, i) => {
        const fuit = m.fleeSince >= 0
        if (fuit !== etat[i]) parSeconde[i]!++
        etat[i] = fuit
      })
    }
    expect(pire).toBeLessThanOrEqual(2)
  })

  /**
   * LE PAS SE RANGE EN HUIT, ET AU BON ENDROIT. La zone morte de `moveToward` se
   * mesure en TUILES : appliquée à un vecteur unitaire, elle coupe l'axe à 6° au
   * lieu de 22,5°, et le secteur « plein nord » ne fait plus que 11° de large. Une
   * poussée de séparation équilibrée pointe justement le long d'un axe : elle
   * alternait donc nord-ouest / nord-est à chaque tick.
   */
  it('octantOf rend TOUJOURS le secteur le plus proche — balayé sur tout le tour', () => {
    // Balayage EXHAUSTIF des directions (le périmètre d'un grand carré : 1 600 caps,
    // tout le tour), et une seule propriété affirmée — le secteur rendu est celui qui
    // maximise le produit scalaire, c'est-à-dire le plus proche. Pas de trigonométrie :
    // le lint l'interdit jusque dans les bancs de /sim, et elle n'apporte rien ici.
    const HUIT = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const
    const caps: [number, number][] = []
    for (let i = -200; i < 200; i++) {
      caps.push([i, 200], [i, -200], [200, i], [-200, i])
    }
    for (const [x, y] of caps) {
      const q = octantOf(x, y)
      expect(q.x === 0 && q.y === 0).toBe(false) // une direction a toujours son secteur
      const score = (ax: number, ay: number) => (x * ax + y * ay) / Math.sqrt(ax * ax + ay * ay)
      let best = -Infinity
      for (const [ax, ay] of HUIT) best = Math.max(best, score(ax, ay))
      expect(score(q.x, q.y)).toBeGreaterThanOrEqual(best - 1e-9)
    }
  })
})



describe('les coins de chasse (A24 — R17)', () => {
  /**
   * LE GIBIER A DES ADRESSES. La faune était un brouillard uniforme : elle
   * naissait autour du joueur où qu'il aille, donc la carte ne s'apprenait pas.
   * Elle vit maintenant dans des COINS DE CHASSE fixes — des prés à portée
   * d'eau — et la vallée, entre eux, est VIDE.
   */
  it('A24 — le semis pose les coins dans des BIOMES OUVERTS, À PORTÉE D’EAU, et espacés', () => {
    // Une carte franche : un grand pré, un lac au milieu, de la roche autour.
    const map = createEmptyMap(400, 400, TERRAIN_ROCK)
    for (let ty = 40; ty < 360; ty++) {
      for (let tx = 40; tx < 360; tx++) map.terrain[ty * map.width + tx] = TERRAIN_GRASS
    }
    for (let ty = 190; ty < 210; ty++) {
      for (let tx = 190; tx < 210; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
    }
    // …et des DORTOIRS (R23) : quatre bosquets autour du lac — depuis 2026-08-28
    // un coin sans couvert à portée n'est plus un coin, l'organe fait partie du montage.
    for (const [bx, by] of [[150, 150], [240, 150], [150, 240], [240, 240]] as const) {
      for (let ty = by; ty < by + 16; ty++) {
        for (let tx = bx; tx < bx + 16; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
      }
    }
    const grounds = placeHuntingGrounds(map, 7)
    expect(grounds.length).toBeGreaterThan(0)

    for (const g of grounds) {
      const terrain = map.terrain[Math.floor(g.y) * map.width + Math.floor(g.x)]!
      // …DANS un biome OUVERT (jamais sur la roche, jamais dans l'eau).
      expect(terrain).toBe(TERRAIN_GRASS)
      // …et À PORTÉE D'EAU : le lac est au centre, donc tous les coins sont près.
      const dEau = dist(g, { x: 200, y: 200 }) // pas `**` : interdit dans /sim (invariant §2)
      expect(dEau).toBeLessThan(FAUNA.GROUND_WATER_NEAR + 30)
    }
    // …et ESPACÉS : deux coins ne se touchent jamais.
    for (let i = 0; i < grounds.length; i++) {
      for (let j = i + 1; j < grounds.length; j++) {
        const d = dist(grounds[i]!, grounds[j]!)
        expect(d).toBeGreaterThanOrEqual(FAUNA.GROUND_SPACING - 1)
      }
    }
  })

  it('A24 — RIEN ne naît hors d’un coin : la vallée entre les coins est VIDE', () => {
    const sim = createSim(1234, {
      map: makeMap(),
      faunaCap: BENCH_CAP,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
      grounds: [{ x: 20.5, y: 20.5 }], // UN seul coin, tout au nord-ouest
    })
    sim.wind = { x: 0, y: 0 }
    // Le joueur est à l'autre bout, très loin du coin.
    const a = spawnEntity(sim, 140.5, 140.5)
    for (let t = 0; t < 90 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(ambientCount(sim)).toBe(0) // le désert

    // …et DANS le coin, ça vit.
    const dedans = createSim(1234, {
      map: makeMap(),
      faunaCap: BENCH_CAP,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
      grounds: [{ x: 80.5, y: 80.5 }],
    })
    dedans.wind = { x: 0, y: 0 }
    const b = spawnEntity(dedans, 80.5, 80.5)
    for (let t = 0; t < 90 * BALANCE.TICK_RATE_HZ; t++) tick(dedans, [{ entityId: b, dx: 0, dy: 0 }])
    expect(ambientCount(dedans)).toBeGreaterThan(5)
  })

  it('A24 — la bête EST D’ICI : jetée hors de son coin, elle y revient', () => {
    const sim = createSim(1234, {
      map: makeMap(),
      faunaCap: BENCH_CAP,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
      grounds: [{ x: 80.5, y: 80.5 }],
    })
    sim.wind = { x: 0, y: 0 }
    const a = spawnEntity(sim, 80.5, 80.5)
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ && ambientCount(sim) === 0; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const bete = sim.monsters.find((m) => m.ambient)!
    expect(bete.groundX).toBe(80.5) // elle sait d'où elle est
    expect(bete.groundY).toBe(80.5)

    // On la jette LOIN, hors de son territoire — comme le ferait une fuite engagée.
    const e = entity(sim, bete.entityId)
    e.x = 80.5
    e.y = 140.5 // à 60 tuiles : bien au-delà de GROUND_RADIUS
    const avant = dist(e, { x: 80.5, y: 80.5 })
    for (let t = 0; t < 25 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const encoreLa = sim.monsters.find((m) => m.entityId === bete.entityId)
    if (encoreLa) {
      // Elle est REVENUE vers son coin (ou elle s'est dissipée en route : la
      // dissipation est une autre règle, et elle ne prouve rien contre celle-ci).
      expect(dist(entity(sim, bete.entityId), { x: 80.5, y: 80.5 })).toBeLessThan(avant - 5)
    }
  })
})

describe('le moteur tient le MULTI (A25 — R17)', () => {
  /**
   * LE BUDGET APPARTIENT AU COIN, PLUS AU MONDE.
   *
   * Un plafond global ne survit pas au multijoueur : trente bêtes pour TOUT le
   * monde, c'est trois bêtes par joueur à dix joueurs — un monde mort. Pire, le
   * peuplement tirait UN SEUL avatar au sort par tick : à dix joueurs, chacun
   * attendait quatre secondes entre deux naissances.
   *
   * Chaque coin de chasse porte donc SA population. Ce banc le prouve sur la
   * VRAIE vallée — c'est le seul endroit où les coins existent.
   */
  /** Une prairie franche, et QUATRE coins de chasse posés loin les uns des autres. */
  function makeMulti(): { map: WorldMap; grounds: { x: number; y: number }[] } {
    const map = createEmptyMap(500, 500, TERRAIN_GRASS)
    const grounds = [
      { x: 120.5, y: 120.5 },
      { x: 380.5, y: 120.5 },
      { x: 120.5, y: 380.5 },
      { x: 380.5, y: 380.5 },
    ]
    return { map, grounds }
  }

  it('A25 — quatre joueurs dans quatre coins : CHACUN a sa clairière pleine', () => {
    const { map, grounds } = makeMulti()
    const N = grounds.length
    const sim = createSim(2026, {
      map,
      faunaCap: FAUNA.CAP,
      grounds,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
    })
    const ids = []
    for (let i = 0; i < N; i++) ids.push(spawnEntity(sim, grounds[i]!.x, grounds[i]!.y))
    const inputs: MoveInput[] = ids.map((id) => ({ entityId: id, dx: 0, dy: 0 }))
    for (let t = 0; t < 120 * BALANCE.TICK_RATE_HZ; t++) tick(sim, inputs)

    // Chacun a SA clairière — pas un N-ième d'un plafond partagé.
    for (const id of ids) {
      const e = entity(sim, id)
      const autour = sim.monsters.filter((m) => {
        if (!m.ambient) return false
        const me = entity(sim, m.entityId)
        return distSq(me.x, me.y, e.x, e.y) <= FAUNA.DESPAWN_RADIUS * FAUNA.DESPAWN_RADIUS
      }).length
      expect(autour).toBeGreaterThan(FAUNA.GROUND_CAP / 2)
    }
    // …et le monde n'a pas explosé pour autant : le garde-fou tient.
    expect(sim.monsters.filter((m) => m.ambient).length).toBeLessThanOrEqual(FAUNA.CAP)
  })

  it('A25 — mais deux joueurs dans le MÊME coin le PARTAGENT (c’est le même pré)', () => {
    const { map, grounds } = makeMulti()
    const g = grounds[0]!
    const sim = createSim(2026, {
      map,
      faunaCap: FAUNA.CAP,
      grounds,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
    })
    const a = spawnEntity(sim, g.x - 8, g.y)
    const b = spawnEntity(sim, g.x + 8, g.y)
    const inputs: MoveInput[] = [
      { entityId: a, dx: 0, dy: 0 },
      { entityId: b, dx: 0, dy: 0 },
    ]
    for (let t = 0; t < 120 * BALANCE.TICK_RATE_HZ; t++) tick(sim, inputs)
    // Un seul coin peuplé : sa population, et pas le double.
    const dansLeCoin = sim.monsters.filter(
      (m) => m.ambient && m.groundX === g.x && m.groundY === g.y,
    ).length
    expect(dansLeCoin).toBeLessThanOrEqual(FAUNA.GROUND_CAP)
    expect(dansLeCoin).toBeGreaterThan(FAUNA.GROUND_CAP / 2)
  })
})

describe('le quota de prédateurs (A26 — R18)', () => {
  /**
   * LA NUIT ÉTAIT UN MUR. Mesuré sur la vraie vallée : un coin de chasse se
   * remplissait de DIX-NEUF LOUPS (cinq ou six meutes), et neuf coins sur
   * dix-neuf en portaient dix ou plus. Le loup ne débordait pas du plafond : il
   * le RAFLAIT — hors de leurs heures, le cerf et le lapin tombent au plancher
   * pendant qu'il est à son maximum, et il naît par trois ou quatre.
   *
   * On ne l'a pas rendu plus rare (ça viderait la nuit de son sens) : on borne sa
   * PART. Le reste du coin va au gibier — qui la nuit DORT (R10).
   */
  it('A26 — la nuit, les prédateurs ne dépassent JAMAIS leur part du coin', () => {
    const map = createEmptyMap(400, 400, TERRAIN_FOREST) // la forêt : l'habitat du loup
    const grounds = [{ x: 200.5, y: 200.5 }]
    const sim = createSim(2026, {
      map,
      faunaCap: FAUNA.CAP,
      grounds,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(2, 1), // 2 h du matin : l'heure du loup
    })
    const a = spawnEntity(sim, 200.5, 200.5)
    // ⚠ L'OBSERVATEUR DOIT RESTER DEBOUT (2026-08-31). Le peuplement ambiant se fait autour
    // des avatars VIVANTS : planté deux minutes et demie dans une forêt à l'heure du loup, le
    // nôtre se fait tuer, et depuis que le mort RESTE à terre la clairière se vide — on
    // mesurerait alors le vide, pas le quota. Jusqu'ici la mort relevait toute seule et ce
    // montage tenait sans le dire ; il le dit.
    for (let t = 0; t < 150 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [entity(sim, a).downedAt !== undefined
        ? { entityId: a, dx: 0, dy: 0, action: { type: 'respawn' } }
        : { entityId: a, dx: 0, dy: 0 }])
    }

    const ambient = sim.monsters.filter((m) => m.ambient)
    const loups = ambient.filter((m) => m.type === 'wolf').length
    const quota = Math.floor(FAUNA.GROUND_CAP * FAUNA.PREDATOR_SHARE)
    expect(loups).toBeLessThanOrEqual(quota) // le mur est tombé
    // …et la clairière EST peuplée — une nuit habitée, pas une nuit vide. Le
    // plancher a baissé d'une taille de meute (loup.md L4, 2026-08-28) : l'ambiant
    // ne lève plus de meutes, le clan vit en Louvière — et le gibier, lui, DORT à
    // 2 h (SPAWN_FLOOR). Le quart du coin est ce que la nuit ambiante porte seule.
    // (− une bête depuis le DORTOIR (R26, mergé le même jour) : la harde couchée au
    // massif tire une composition un cheveu plus basse à 2 h — 7 sur cette graine.
    // Le propos de la garde est « habitée, pas vide » : le quart moins une tient.)
    expect(ambient.length).toBeGreaterThanOrEqual(FAUNA.GROUND_CAP / 4 - 1)
  })

  it('A26 — mais la nuit reste À EUX : ils sont là, et en meute', () => {
    const map = createEmptyMap(400, 400, TERRAIN_FOREST)
    const sim = createSim(7, {
      map,
      faunaCap: FAUNA.CAP,
      grounds: [{ x: 200.5, y: 200.5 }],
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(2, 1),
    })
    const a = spawnEntity(sim, 200.5, 200.5)
    for (let t = 0; t < 150 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const loups = sim.monsters.filter((m) => m.ambient && m.type === 'wolf')
    expect(loups.length).toBeGreaterThanOrEqual(1) // la nuit n'est pas devenue une promenade
    // …mais ce sont des RÔDEURS SOLITAIRES (loup.md L4) : l'ambiant n'ouvre plus
    // de meute — le clan vit en Louvière, et lui seul.
    for (const l of loups) expect(l.herdId).toBeUndefined()
  })

  it('A26 — et le jour, le quota ne change RIEN : le loup y était déjà rare', () => {
    const map = createEmptyMap(400, 400, TERRAIN_FOREST)
    const sim = createSim(2026, {
      map,
      faunaCap: FAUNA.CAP,
      grounds: [{ x: 200.5, y: 200.5 }],
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
    })
    const a = spawnEntity(sim, 200.5, 200.5)
    for (let t = 0; t < 120 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const loups = sim.monsters.filter((m) => m.ambient && m.type === 'wolf').length
    expect(loups).toBeLessThanOrEqual(Math.floor(FAUNA.GROUND_CAP * FAUNA.PREDATOR_SHARE))
  })
})

describe('la clairière et la souille (A27 — R17)', () => {
  /**
   * LE SANGLIER NE VIT PAS AU PRÉ (retour utilisateur).
   *
   * Poser TOUS les coins de chasse dans des prairies était une faute : le
   * sanglier n'y naissait que parce que le disque du coin (46 tuiles) débordait
   * sur les bois voisins — d'où VINGT-TROIS SANGLIERS dans une prairie à cerfs.
   *
   * La vallée porte donc deux natures de coin, et le terrain les distingue tout
   * seul. La règle tient en une ligne : le gibier doit pouvoir vivre sur la tuile
   * DU COIN, pas seulement sur celle où il tombe. Le prédateur, lui, va où va le
   * gibier — il n'a pas de pré à lui, il suit les hardes.
   */
  it('A27 — dans une CLAIRIÈRE (pré), pas un seul sanglier ; dans une SOUILLE (bois), il est chez lui', () => {
    // Un monde franc : la moitié nord en forêt, la moitié sud en prairie, un lac
    // au milieu (les deux coins sont à portée d'eau).
    const map = createEmptyMap(300, 300, TERRAIN_GRASS)
    for (let ty = 0; ty < 150; ty++) {
      for (let tx = 0; tx < 300; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
    }

    const compo = (gx: number, gy: number, hour: number): Record<string, number> => {
      const sim = createSim(2026, {
        map,
        faunaCap: FAUNA.CAP,
        grounds: [{ x: gx, y: gy }],
        worldEvents: false,
        cycleOffset: cycleOffsetForStartHour(hour, 1),
      })
      const a = spawnEntity(sim, gx, gy)
      for (let t = 0; t < 150 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
      const par: Record<string, number> = {}
      for (const m of sim.monsters) if (m.ambient) par[m.type] = (par[m.type] ?? 0) + 1
      return par
    }

    // LA CLAIRIÈRE : posée en pleine prairie, mais assez près de la lisière pour
    // que son disque déborde sur les bois — c'est LE cas qui produisait le bug.
    const clairiere = compo(150.5, 175.5, 2) // 2 h : l'heure du sanglier
    expect(clairiere.boar ?? 0).toBe(0) // pas un seul, et c'est tout le propos
    expect((clairiere.deer ?? 0) + (clairiere.rabbit ?? 0)).toBeGreaterThan(5)

    // LA SOUILLE : posée dans les bois. Le sanglier y est CHEZ LUI.
    const souille = compo(150.5, 120.5, 2)
    expect(souille.boar ?? 0).toBeGreaterThan(3)
  })

  it('A27 — le semis pose les DEUX natures : des prés ET des bois', () => {
    const map = createEmptyMap(900, 900, TERRAIN_GRASS)
    // Une grande forêt à l'est, de la prairie à l'ouest, et de l'eau qui traverse.
    for (let ty = 0; ty < 900; ty++) {
      for (let tx = 450; tx < 900; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
      for (let tx = 0; tx < 900; tx++) {
        if (ty % 300 < 6) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
      }
    }
    const grounds = placeHuntingGrounds(map, 3)
    const pres = grounds.filter((g) => map.terrain[Math.floor(g.y) * map.width + Math.floor(g.x)] === TERRAIN_GRASS)
    const bois = grounds.filter((g) => map.terrain[Math.floor(g.y) * map.width + Math.floor(g.x)] === TERRAIN_FOREST)
    expect(pres.length).toBeGreaterThan(0) // des clairières
    expect(bois.length).toBeGreaterThan(0) // ET des souilles
  })

  /**
   * A37 (R23, 2026-08-28) — LE TROISIÈME ORGANE : LE DORTOIR. Un coin exige un
   * massif boisé à portée, en plus de son herbe et de son eau. Contre-épreuve
   * par construction : le premier montage passait AVANT la règle (des coins y
   * naissaient), il doit rendre zéro depuis.
   */
  it('A37 — sans un massif boisé à portée, AUCUN point ne devient un coin', () => {
    // De l'herbe et de l'eau à profusion — mais pas un arbre sur toute la carte.
    const map = createEmptyMap(300, 300, TERRAIN_GRASS)
    for (let ty = 0; ty < 300; ty++) {
      for (let tx = 0; tx < 300; tx++) {
        if (tx % 60 < 4) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
      }
    }
    expect(placeHuntingGrounds(map, 7).length).toBe(0)
  })

  it('A37 — le même monde, boisé, porte des coins — et CHACUN a son dortoir à portée', () => {
    const map = createEmptyMap(300, 300, TERRAIN_GRASS)
    for (let ty = 0; ty < 300; ty++) {
      for (let tx = 0; tx < 300; tx++) {
        if (tx % 60 < 4) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
      }
    }
    // Des bosquets de 12×12 semés tous les 48 : partout, un massif à portée.
    for (let by = 24; by < 300 - 12; by += 48) {
      for (let bx = 24; bx < 300 - 12; bx += 48) {
        for (let ty = by; ty < by + 12; ty++) {
          for (let tx = bx; tx < bx + 12; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
        }
      }
    }
    const grounds = placeHuntingGrounds(map, 7)
    expect(grounds.length).toBeGreaterThan(0)
    // La garde est EXHAUSTIVE sur la sortie : chaque coin rendu a, à portée de
    // `GROUND_COVER_NEAR` (+ une maille de quantification), au moins le plancher
    // de tuiles boisées — recompté ici en brut, sans passer par la grille du code.
    const marge = FAUNA.GROUND_COVER_NEAR + FAUNA.GROUND_WATER_CELL
    for (const g of grounds) {
      let bois = 0
      for (let ty = Math.max(0, Math.floor(g.y) - marge); ty <= Math.min(299, Math.floor(g.y) + marge); ty++) {
        for (let tx = Math.max(0, Math.floor(g.x) - marge); tx <= Math.min(299, Math.floor(g.x) + marge); tx++) {
          if (map.terrain[ty * map.width + tx] === TERRAIN_FOREST) bois++
        }
      }
      expect(bois, `coin (${g.x}, ${g.y}) sans dortoir`).toBeGreaterThanOrEqual(FAUNA.GROUND_COVER_MIN_TILES)
    }
  })
})

describe('LE BOND (A28-A29 — R19) — un loup ne peut pas mordre ce qui avance', () => {
  /** Une meute complète (alpha + 3), posée où on veut. */
  function meute(sim: SimState, x: number, y: number): Monster[] {
    const herdId = sim.nextHerdId++
    const alphaId = spawnMonster(sim, 'wolf', x, y)
    const chef = sim.monsters.find((m) => m.entityId === alphaId)!
    chef.alpha = true
    chef.alphaId = alphaId
    chef.herdId = herdId
    entity(sim, alphaId).hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP
    const out = [chef]
    for (let i = 1; i <= 3; i++) {
      const id = spawnMonster(sim, 'wolf', x + i * 1.2, y)
      const m = sim.monsters.find((z) => z.entityId === id)!
      m.herdId = herdId
      m.alphaId = alphaId
      out.push(m)
    }
    return out
  }

  /**
   * A28 — AFFIRMÉ COMME UNE PROPRIÉTÉ, SUR TOUT L'ESPACE.
   *
   * On ne choisit pas une direction de fuite : on les prend TOUTES (les huit du
   * compas), et on affirme UNE chose — la meute finit par entamer l'homme. Un banc
   * sur un seul cap aurait pu passer par la géométrie de ce cap-là (la meute
   * naissant en ligne, elle est mieux placée pour couper vers l'est que vers le
   * nord). C'est une règle de mouvement : elle se prouve sur tout le cercle.
   */
  it('A28 — la meute entame un homme qui MARCHE, par quelque relèvement qu’il parte', () => {
    const HUIT: readonly (readonly [-1 | 0 | 1, -1 | 0 | 1])[] = [
      [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
    ]
    for (const [dx, dy] of HUIT) {
      const sim = makeSim(0, 2) // 2 h du matin : l'heure du loup, pleine vigueur
      const l = Math.sqrt(dx * dx + dy * dy)
      // La meute DANS SON DOS, à 3,2 tuiles : à portée de bond, hors de portée de crocs.
      meute(sim, 80.5 - (dx / l) * 3.2, 80.5 - (dy / l) * 3.2)
      const a = spawnEntity(sim, 80.5, 80.5)
      const pv = entity(sim, a).hp

      let entame = false
      // 8 s : il parcourt 32 tuiles au plus, la carte en fait 160 — jamais le bord.
      for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && !entame; t++) {
        tick(sim, [{ entityId: a, dx, dy }])
        if (entity(sim, a).hp < pv) entame = true
      }
      expect(entame, `relèvement ${dx},${dy}`).toBe(true)
    }
  })

  /**
   * LE CONTRE-TEST, et il est ARITHMÉTIQUE — c'est la raison d'être de R19, et elle
   * doit lever si quelqu'un raccourcit un jour le wind-up ou rallonge la portée.
   *
   * La morsure PLANTÉE fige le loup le temps de son wind-up ; pendant ce temps un
   * homme qui marche parcourt PLUS que la portée de la morsure. Elle ne peut donc
   * pas, par construction, atteindre une proie qui avance — MESURÉ avant le bond :
   * 46 coups armés, zéro dégât, sur quatre loups collés à une tuile.
   */
  it('A28 (contre-test) — la morsure plantée ne PEUT pas rattraper un homme qui marche', () => {
    const parcouru = BALANCE.WALK_SPEED_TILES_PER_S * (MONSTER_DEFS.wolf.windupTicks / BALANCE.TICK_RATE_HZ)
    expect(parcouru).toBeGreaterThan(COMBAT.MELEE_ENGAGE_RANGE)
    // Et le bond, lui, couvre plus que ce que la proie gagne pendant qu'il s'engage.
    const vol = MONSTER_DEFS.wolf.speed * FAUNA.LEAP_SPEED * (FAUNA.LEAP_TICKS / BALANCE.TICK_RATE_HZ)
    const fuite = BALANCE.WALK_SPEED_TILES_PER_S * (FAUNA.LEAP_TICKS / BALANCE.TICK_RATE_HZ)
    expect(vol - fuite).toBeGreaterThan(FAUNA.LEAP_RANGE - COMBAT.MELEE_ENGAGE_RANGE)
  })

  /**
   * A29 — on ARME le bond à la main. C'est délibéré : les trois clauses testées ici
   * (cap verrouillé, un coup par bond, retombée) sont des propriétés du GESTE, pas
   * de la décision de bondir — que A28 couvre déjà de bout en bout. Les isoler rend
   * chaque clause lisible, et le test cesse de dépendre du courage, de l'heure et
   * de la géométrie de la meute.
   */
  function armeUnBond(sim: SimState, wolfEntityId: number, dx: number, dy: number): Monster {
    const m = sim.monsters.find((z) => z.entityId === wolfEntityId)!
    m.leapUntil = sim.tick + FAUNA.LEAP_TICKS
    m.leapDx = dx
    m.leapDy = dy
    m.leapHit = false
    return m
  }

  it('A29 — le cap est VERROUILLÉ : le pas de côté esquive, tout droit non', () => {
    // Tout droit : il est touché.
    const droit = makeSim(0, 2)
    const loupD = spawnMonster(droit, 'wolf', 80.5, 80.5)
    // À la distance où le bond part VRAIMENT : c'est elle qui décide de l'esquive.
    const aD = spawnEntity(droit, 80.5 + FAUNA.LEAP_RANGE, 80.5)
    const pvD = entity(droit, aD).hp
    armeUnBond(droit, loupD, 1, 0)
    for (let t = 0; t < FAUNA.LEAP_TICKS; t++) tick(droit, [{ entityId: aD, dx: 1, dy: 0 }])
    expect(entity(droit, aD).hp).toBeLessThan(pvD)

    // MÊME bond, même départ : il se décale LATÉRALEMENT. Le loup passe à côté.
    const cote = makeSim(0, 2)
    const loupC = spawnMonster(cote, 'wolf', 80.5, 80.5)
    // À la distance où le bond part VRAIMENT : c'est elle qui décide de l'esquive.
    const aC = spawnEntity(cote, 80.5 + FAUNA.LEAP_RANGE, 80.5)
    const pvC = entity(cote, aC).hp
    armeUnBond(cote, loupC, 1, 0)
    for (let t = 0; t < FAUNA.LEAP_TICKS; t++) tick(cote, [{ entityId: aC, dx: 0, dy: 1 }])
    expect(entity(cote, aC).hp).toBe(pvC)
  })

  it('A29 — UN coup par bond, même s’il reste au contact plusieurs ticks', () => {
    const sim = makeSim(0, 2)
    const loup = spawnMonster(sim, 'wolf', 80.5, 80.5)
    const a = spawnEntity(sim, 82.0, 80.5) // devant lui : il va le traverser
    entity(sim, a).hp = 1000 // increvable : on compte les coups, pas la mort
    armeUnBond(sim, loup, 1, 0)

    let pv = entity(sim, a).hp
    let coups = 0
    let ticksAuContact = 0
    for (let t = 0; t < FAUNA.LEAP_TICKS; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
      const e = entity(sim, a)
      const w = entity(sim, loup)
      if (distSq(e.x, e.y, w.x, w.y) <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) ticksAuContact++
      if (e.hp < pv) {
        coups++
        pv = e.hp
      }
    }
    expect(ticksAuContact).toBeGreaterThan(1) // la garde a bien quelque chose à garder
    expect(coups).toBe(1)
  })

  it('A29 — il RETOMBE : immobile et offert après son bond', () => {
    const sim = makeSim(0, 2)
    const loup = spawnMonster(sim, 'wolf', 80.5, 80.5)
    spawnEntity(sim, 120.5, 120.5) // un homme au loin : il ne redécide rien de sitôt
    const m = armeUnBond(sim, loup, 1, 0)
    for (let t = 0; t < FAUNA.LEAP_TICKS + 1; t++) tick(sim)

    expect(m.leapUntil).toBeUndefined()
    expect(m.windedUntil).toBeDefined()
    const pose = { x: entity(sim, loup).x, y: entity(sim, loup).y }
    for (let t = 0; t < FAUNA.LEAP_RECOVER_TICKS - 1; t++) {
      tick(sim)
      expect(entity(sim, loup).x).toBe(pose.x)
      expect(entity(sim, loup).y).toBe(pose.y)
    }
  })
})

describe('LE PASSAGE (A30-A31 — R20) — un trouve, les autres suivent', () => {
  /** Une barre de roche en travers, avec UNE ouverture de 3 tuiles à `ouvertureX`. */
  function barre(sim: SimState, ouvertureX: number): void {
    for (let tx = 0; tx < sim.map.width; tx++) {
      if (tx >= ouvertureX && tx < ouvertureX + 3) continue
      for (let ty = 86; ty < 89; ty++) sim.map.terrain[ty * sim.map.width + tx] = TERRAIN_ROCK
    }
  }

  function meute(sim: SimState, x: number, y: number): Monster[] {
    const herdId = sim.nextHerdId++
    const out: Monster[] = []
    for (let i = 0; i < 4; i++) {
      const id = spawnMonster(sim, 'wolf', x + i * 1.5, y)
      const m = sim.monsters.find((z) => z.entityId === id)!
      m.herdId = herdId
      m.groundX = x
      m.groundY = y
      out.push(m)
    }
    return out
  }

  /**
   * L'homme FAIT LES CENT PAS. Il ne peut pas rester immobile : à l'arrêt il n'est
   * repéré qu'à 3 tuiles (furtivité C5) et la meute ne le chasserait jamais — le banc
   * mesurerait la discrétion, pas le passage. Il ne peut pas fuir non plus : il
   * mesurerait une course. Il va donc et vient sur place, vu et à sa portée.
   */
  function centPas(sim: SimState, id: number, secondes: number, pack: Monster[]): { mordu: boolean; recherches: number; copies: number } {
    const pv = entity(sim, id).hp
    let mordu = false
    let recherches = 0
    let copies = 0
    const vuPathAt = new Map<number, number>()
    const avaitChemin = new Map<number, boolean>()
    for (let t = 0; t < secondes * BALANCE.TICK_RATE_HZ; t++) {
      const va = Math.floor(t / (2 * BALANCE.TICK_RATE_HZ)) % 2 === 0 ? 1 : -1
      tick(sim, [{ entityId: id, dx: va as 1 | -1, dy: 0 }])
      if (entity(sim, id).hp < pv) mordu = true
      // UNE RECHERCHE PAYÉE se lit à `pathAt` qui change — il est écrit sur TOUTE la
      // meute d'un coup. UNE COPIE, c'est un loup qui acquiert un chemin sans que
      // personne n'ait payé ce tick-là. C'est exactement la distinction à garder.
      let paye = false
      for (const w of pack) {
        if (w.pathAt !== undefined && vuPathAt.get(w.entityId) !== w.pathAt) {
          paye = true
          vuPathAt.set(w.entityId, w.pathAt)
        }
      }
      if (paye) recherches++
      for (const w of pack) {
        const a = (w.path?.length ?? 0) > 0
        if (a && avaitChemin.get(w.entityId) !== true && !paye) copies++
        avaitChemin.set(w.entityId, a)
      }
    }
    return { mordu, recherches, copies }
  }

  it('A30 — un mur dont le trou n’est PAS en face n’annule plus la meute', () => {
    const sim = makeSim(0, 2)
    barre(sim, 95) // ouverture à 15 tuiles sur la droite
    const pack = meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 92.5) // de l'autre côté, à 12 tuiles
    expect(centPas(sim, a, 30, pack).mordu).toBe(true)
  })

  it('A30 — UN SEUL paie la recherche, les autres COPIENT (la meute est intelligente, pas le loup)', () => {
    const sim = makeSim(0, 2)
    barre(sim, 95)
    const pack = meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 92.5)
    const r = centPas(sim, a, 30, pack)
    // La transmission a EU LIEU : des loups sont partis sur un chemin que personne
    // n'a payé pour eux.
    expect(r.copies).toBeGreaterThan(0)
    // ET LE CONTRAT DE COÛT TIENT : la MEUTE paie au plus une recherche par palier de
    // refroidissement — pas un loup, pas quatre. Sans le partage, quatre loups coincés
    // en paieraient quatre par palier, et c'est exactement le défaut que le Cendreux en
    // horde a déjà coûté une fois (`cendreux.ts` : un A* par bête et par demi-seconde).
    const fenetres = Math.ceil((30 * BALANCE.TICK_RATE_HZ) / FAUNA.PATH_COOLDOWN_TICKS)
    expect(r.recherches).toBeLessThanOrEqual(fenetres)
    expect(r.recherches).toBeLessThan(fenetres * pack.length)
  })

  it('A31 — il reste une BÊTE : un détour de 40 tuiles le dépasse', () => {
    const sim = makeSim(0, 2)
    barre(sim, 120) // ouverture à 40 tuiles : au-delà de ce qu'il sait comprendre
    const pack = meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 92.5)
    expect(centPas(sim, a, 30, pack).mordu).toBe(false)
  })

  it('A31 — EN PLAINE il ne cherche RIEN : pas de chemin sans obstacle', () => {
    const sim = makeSim(0, 2) // aucune roche : la voie est libre
    const pack = meute(sim, 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 92.5)
    const r = centPas(sim, a, 30, pack)
    expect(r.mordu).toBe(true) // il se fait bien attraper, lui
    expect(r.recherches).toBe(0) // …sans qu'un seul A* ait été payé
    expect(r.copies).toBe(0)
  })
})
