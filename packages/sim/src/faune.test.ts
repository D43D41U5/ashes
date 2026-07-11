import { describe, it, expect } from 'vitest'
import {
  BALANCE,
  COMBAT,
  FAUNA,
  MONSTER_DEFS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  STRUCTURE_HP,
} from './balance'
import { createEmptyMap, type WorldMap } from './map'
import { createSim, spawnEntity, snapshot, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { spawnMonster, type Monster } from './monsters'
import { activityAt, isPredator, isPrey } from './faune'
import { drainEvents } from './events'
import { die } from './combat'
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
function makeSim(faunaCap = FAUNA.CAP, hour = 12): SimState {
  return createSim(1234, { map: makeMap(), faunaCap, cycleOffset: cycleOffsetForStartHour(hour) })
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

describe('les définitions (R8 — trois étages de gibier)', () => {
  it('lapin, cerf et sanglier sont du GIBIER ; zombie et cendreux n’en sont pas', () => {
    expect(isPrey('rabbit')).toBe(true)
    expect(isPrey('deer')).toBe(true)
    expect(isPrey('boar')).toBe(true)
    expect(isPrey('zombie')).toBe(false)
    expect(isPrey('cendreux')).toBe(false)
  })

  it('le gibier monte en PV et en viande : lapin < sanglier < cerf', () => {
    expect(MONSTER_DEFS.rabbit.hp).toBeLessThan(MONSTER_DEFS.boar.hp)
    expect(MONSTER_DEFS.boar.hp).toBeLessThan(MONSTER_DEFS.deer.hp)
    expect(MONSTER_DEFS.rabbit.loot.raw_meat).toBe(1)
    expect(MONSTER_DEFS.boar.loot.raw_meat).toBe(3)
    expect(MONSTER_DEFS.deer.loot.raw_meat).toBe(5)
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
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(ambientCount(sim)).toBe(10)
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

  it('A5 — un avatar dans alertRange fige la bête ; dans flightRange, elle détale', () => {
    // Le cerf : alerte à 14, fuite à 9.
    const { sim, id } = loneBeast('deer', 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 92.5) // à 12 tuiles : vu, pas encore fui
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    const frozen = { x: entity(sim, id).x, y: entity(sim, id).y }
    expect(frozen.x).toBe(80.5) // figé, au demi-pixel près
    expect(frozen.y).toBe(80.5)

    // L'avatar entre dans la zone de fuite : la distance doit CROÎTRE.
    entity(sim, a).y = 86.5 // à 6 tuiles < flightRange 9
    const before = dist(entity(sim, id), entity(sim, a))
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(dist(entity(sim, id), entity(sim, a))).toBeGreaterThan(before)
  })

  it('A6 — la fuite est en à-coups : elle court, puis elle souffle', () => {
    const { sim, id } = loneBeast('deer', 80.5, 80.5)
    spawnEntity(sim, 80.5, 84.5) // dans flightRange : la fuite s'enclenche

    // On mesure le terrain couvert tick par tick sur un cycle complet de burst.
    const perTick: number[] = []
    let prev = { x: entity(sim, id).x, y: entity(sim, id).y }
    for (let t = 0; t < FAUNA.BURST_RUN_TICKS + FAUNA.BURST_PAUSE_TICKS; t++) {
      tick(sim)
      const e = entity(sim, id)
      perTick.push(dist(e, prev))
      prev = { x: e.x, y: e.y }
    }
    const running = perTick.slice(0, FAUNA.BURST_RUN_TICKS)
    const blowing = perTick.slice(FAUNA.BURST_RUN_TICKS)
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
    expect(corpse.inventory.raw_meat).toBe(1)
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
    expect(activityAt('zombie', 3)).toBe(1)
    expect(activityAt('zombie', 15)).toBe(1)
  })

  it('A11 — la NUIT appartient aux loups et aux sangliers : le peuplement bascule', () => {
    const compte = (hour: number): Record<string, number> => {
      // TOUT en forêt : l'anneau de naissance (28-42 tuiles) doit tomber dans un
      // biome où les quatre espèces peuvent naître, sinon on ne mesure que la
      // géographie. (Le premier montage l'a fait, et ne trouvait aucun loup.)
      const map = createEmptyMap(160, 160, TERRAIN_FOREST)
      const sim = createSim(1234, { map, faunaCap: FAUNA.CAP, cycleOffset: cycleOffsetForStartHour(hour) })
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
  function packSauvage(): { sim: SimState; alpha: Monster; meute: Monster[] } {
    const map = createEmptyMap(160, 160, TERRAIN_FOREST)
    const sim = createSim(99, { map, faunaCap: FAUNA.CAP, cycleOffset: cycleOffsetForStartHour(2) })
    spawnEntity(sim, 80.5, 80.5)
    let alpha: Monster | undefined
    for (let t = 0; t < 90 * BALANCE.TICK_RATE_HZ && !alpha; t++) {
      tick(sim)
      alpha = sim.monsters.find((m) => m.type === 'wolf' && m.alpha)
    }
    const meute = sim.monsters.filter((m) => m.alphaId === alpha!.entityId)
    return { sim, alpha: alpha!, meute }
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
    sim.corpses.push({ id: sim.nextCorpseId++, x: 86.5, y: 80.5, inventory: { raw_meat: 3 }, decayAt: 1e9 })

    let mange = false
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && !mange; t++) {
      tick(sim)
      mange = pack[0]!.eatingUntil !== undefined
    }
    expect(mange).toBe(true) // il s'y est rendu et il mange

    for (let t = 0; t < FAUNA.EAT_TICKS + 2; t++) tick(sim)
    expect(pack[0]!.satedUntil).toBeDefined() // il est repu
    expect(sim.corpses[0]!.inventory.raw_meat).toBe(2) // et il a entamé la carcasse
  })

  it('A16 — REPU, il ne chasse plus : on passe à côté d’une meute rassasiée', () => {
    const sim = makeSim(0, 2)
    const pack = meutePosee(sim, 80.5, 80.5)
    for (const w of pack) w.satedUntil = 1e9 // repus

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
    pack[0]!.satedUntil = 1e9
    const a = spawnEntity(sim, 79.5, 80.5)

    strike(sim, a, 1, 0) // on le frappe
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    expect(pack[0]!.targetId).toBe(a) // il a pris son agresseur pour cible
    expect(entity(sim, a).hp).toBeLessThan(100) // et il a rendu le coup
  })
})

describe('la pression de chasse (A17 — R16) — ni farm, ni désert', () => {
  it('A17 — LE FARM EST FERMÉ : plus une seule naissance autour d’une mise à mort', () => {
    const sim = makeSim(FAUNA.CAP, 12)
    const a = spawnEntity(sim, 80.5, 80.5)
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(ambientCount(sim)).toBe(FAUNA.CAP)

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
    expect(ambientCount(sim)).toBeLessThan(FAUNA.CAP)
  })

  it('A17 — mais ce n’est PAS un désert : lever le camp suffit, et le calme revient', () => {
    const sim = makeSim(FAUNA.CAP, 12)
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
    // terre brûlée, c'est une bête qui a eu peur.
    const q = sim.faunaQuiet[0]
    if (q) expect(distSq(q.x, q.y, chasse.x, chasse.y)).toBeLessThan(1)
    for (let t = 0; t < FAUNA.QUIET_TICKS; t++) tick(sim)
    expect(sim.faunaQuiet).toHaveLength(0) // le calme est revenu
  })

  it('A17 — tuer un LOUP ne fait taire personne (un prédateur mort ne chasse plus)', () => {
    const sim = makeSim(FAUNA.CAP, 2)
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
    const sim = createSim(7, { map, faunaCap: FAUNA.CAP })
    spawnEntity(sim, 80.5, 80.5)
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    for (const m of sim.monsters) {
      const e = entity(sim, m.entityId)
      const terrain = sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!
      expect(terrain).not.toBe(TERRAIN_ROCK)
    }
  })
})
