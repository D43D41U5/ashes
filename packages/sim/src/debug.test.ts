/**
 * Les outils de dev sont dans la sim, donc ils sont testés comme le reste —
 * et surtout : on teste qu'ils sont INERTES quand `debug` n'est pas armé.
 * C'est ce qui rend sûr de les laisser dans le même canal d'action que le jeu.
 */
import { describe, expect, it } from 'vitest'
import { applyDamage } from './combat'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { MORTS, NIGHT_HUNT, TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { getGameTime } from './time'

function makeSim(debug: boolean): { sim: SimState; player: number } {
  const sim = createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS), debug })
  const player = spawnEntity(sim, 10, 10)
  return { sim, player }
}

function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

describe('debug — téléportation', () => {
  it('pose l’avatar sur la tuile visée', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_teleport', x: 40.5, y: 33.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBeCloseTo(40.5)
    expect(e.y).toBeCloseTo(33.5)
  })

  it('borne la cible à la carte (hors-bornes = terrain indéfini)', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_teleport', x: -500, y: 99999 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBe(0.5)
    expect(e.y).toBe(63.5)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_teleport', x: 40.5, y: 33.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBe(10)
    expect(e.y).toBe(10)
  })
})

describe('debug — heure forcée', () => {
  it('amène l’horloge à l’heure demandée sans toucher au calendrier', () => {
    const { sim, player } = makeSim(true)
    const dayBefore = getGameTime(sim).seasonDay
    act(sim, player, { type: 'debug_set_hour', hour: 23 })
    const time = getGameTime(sim)
    // Le tick a avancé d'un cran pendant le step : on tolère la minute de jeu.
    expect(time.hourOfCycle).toBeGreaterThan(22.9)
    expect(time.isNight).toBe(true)
    expect(time.seasonDay).toBe(dayBefore)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    const before = sim.cycleOffset
    act(sim, player, { type: 'debug_set_hour', hour: 23 })
    expect(sim.cycleOffset).toBe(before)
  })
})

describe('debug — invulnérabilité', () => {
  it('encaisse un coup mortel sans perdre de PV ni mourir', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_god', on: true })
    const e = sim.entities.find((x) => x.id === player)!
    applyDamage(sim, e, 9999, 0)
    expect(e.hp).toBe(100)
    expect(sim.entities.some((x) => x.id === player)).toBe(true)
  })

  it('gèle la faim (elle serait sinon drainée à chaque tick)', () => {
    const { sim, player } = makeSim(true)
    const e = sim.entities.find((x) => x.id === player)!
    e.hunger = 3
    act(sim, player, { type: 'debug_god', on: true })
    for (let i = 0; i < 200; i++) step(sim, [{ entityId: player, dx: 0, dy: 0 }])
    expect(e.hunger).toBe(100)
    expect(e.temperature).toBe(100)
  })

  it('se coupe : l’avatar redevient mortel', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_god', on: true })
    act(sim, player, { type: 'debug_god', on: false })
    const e = sim.entities.find((x) => x.id === player)!
    applyDamage(sim, e, 30, 0)
    expect(e.hp).toBe(70)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_god', on: true })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.god).toBeUndefined()
    applyDamage(sim, e, 30, 0)
    expect(e.hp).toBe(70)
  })
})

/**
 * RÉVEILLER LE SOL À LA DEMANDE (spec `cendreux.md` R21bis).
 *
 * Ce qui doit être vrai, et qui n'est pas évident : que ce soit un VRAI réveil et pas un
 * raccourci. Un debug qui planterait autre chose que ce que plante la nuit ferait constater
 * une animation qui n'existe pas dans le jeu — c'est le pire service qu'un outil de debug
 * puisse rendre, et c'est exactement ce que `debug_set_season_day` a déjà appris au projet
 * (se poser PILE sur le jour visé ne franchissait aucune bascule, et le monde mentait).
 */
describe('debug — réveiller le sol', () => {
  it('plante un réveil dans la couronne du MORT, pas dans celle du loup', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_reveil' })
    expect(sim.reveils).toHaveLength(1)
    const r = sim.reveils[0]!
    const dx = r.x - 10
    const dy = r.y - 10
    const d = Math.sqrt(dx * dx + dy * dy)
    expect(d).toBeGreaterThanOrEqual(NIGHT_HUNT.SPAWN_DIST_UNDEAD - NIGHT_HUNT.SPAWN_RING_UNDEAD)
    expect(d).toBeLessThanOrEqual(NIGHT_HUNT.SPAWN_DIST_UNDEAD + NIGHT_HUNT.SPAWN_RING_UNDEAD)
  })

  it('le plante POUR celui qui a appuyé, et il mûrit à la durée normale', () => {
    const { sim, player } = makeSim(true)
    const avant = sim.tick
    act(sim, player, { type: 'debug_reveil' })
    const r = sim.reveils[0]!
    expect(r.preyId).toBe(player)
    expect(r.at).toBe(avant + MORTS.REVEIL_TICKS)
  })

  it('ÇA S’ANNONCE — le raclement part, comme pour la nuit', () => {
    const { sim, player } = makeSim(true)
    drainEvents(sim)
    act(sim, player, { type: 'debug_reveil' })
    const prowl = drainEvents(sim).filter((e) => e.type === 'cendreux_prowl')
    expect(prowl).toHaveLength(1)
    expect(prowl[0]!.targetEntityId).toBe(player)
  })

  it('NE CONSOMME AUCUN TIRAGE : une touche de debug ne décale pas le monde', () => {
    // La garde la plus importante du lot. Le flux seedé doit être insensible à ce qu'on
    // presse en dev, sinon deux parties « même seed, mêmes inputs » divergeraient selon
    // qu'on a regardé un réveil ou non — et l'invariant n°2 avec elles.
    const { sim, player } = makeSim(true)
    const avant = sim.rngState
    act(sim, player, { type: 'debug_reveil' })
    expect(sim.rngState).toBe(avant)
  })

  it('rend un vrai Cendreux, avec les trois marques du rôdeur', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_reveil' })
    for (let i = 0; i <= MORTS.REVEIL_TICKS; i++) step(sim, [])
    expect(sim.reveils).toHaveLength(0)
    const m = sim.monsters.find((x) => x.type === 'cendreux')
    expect(m).toBeDefined()
    expect(m!.ambient).toBe(true)
    expect(m!.nightHunter).toBe(true)
    expect(m!.huntTargetId).toBe(player)
  })

  it('LE FEU L’ÉTOUFFE QUAND MÊME — la parade se teste par ce chemin aussi', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_reveil' })
    const r = sim.reveils[0]!
    sim.structures.push({
      id: 9001, type: 'fire', tx: Math.floor(r.x), ty: Math.floor(r.y), villageId: 0, hp: 100, lit: true,
    } as never)
    drainEvents(sim)
    step(sim, [])
    expect(sim.reveils).toHaveLength(0)
    expect(drainEvents(sim).some((e) => e.type === 'reveil_etouffe')).toBe(true)
    expect(sim.monsters.some((m) => m.type === 'cendreux')).toBe(false)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_reveil' })
    expect(sim.reveils).toHaveLength(0)
  })
})
