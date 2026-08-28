import { describe, it, expect } from 'vitest'
import { FAUNA, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { applyDamage } from './combat'
import { createEmptyMap, type WorldMap } from './map'
import { spawnMonster, type Monster } from './monsters'
import { createSim, spawnEntity, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { distSq } from './geometry'

/**
 * ═══ LE DORTOIR (spec faune R26, critères A41-A43) ═══
 *
 * Un canton dessiné à la main : de l'herbe, DEUX massifs boisés (13×13 — bien
 * au-dessus du plancher d'une cellule), de l'eau, un coin de chasse au milieu.
 * Deux hardes, pour la règle « une harde = SON dortoir ».
 */

const GROUND = { x: 120.5, y: 60.5 }
const MASSIF_A = { x0: 140, y0: 30 } // centres ~ (146, 36)
const MASSIF_B = { x0: 140, y0: 78 } // centres ~ (146, 84)

function makeMap(): WorldMap {
  const map = createEmptyMap(200, 120, TERRAIN_GRASS)
  for (const m of [MASSIF_A, MASSIF_B]) {
    for (let ty = m.y0; ty < m.y0 + 13; ty++) {
      for (let tx = m.x0; tx < m.x0 + 13; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
    }
  }
  for (let ty = 0; ty < 120; ty++) {
    for (let tx = 100; tx < 103; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
  }
  return map
}

function makeSim(hour: number): SimState {
  const sim = createSim(1234, {
    map: makeMap(),
    faunaCap: 0,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(hour, 1),
  })
  sim.wind = { x: 0, y: 0 }
  return sim
}

/** Une harde de cerfs posée près du coin, attachée au coin. */
function harde(sim: SimState, n: number, x: number, y: number): Monster[] {
  const herdId = sim.nextHerdId++
  const membres: Monster[] = []
  for (let i = 0; i < n; i++) {
    const id = spawnMonster(sim, 'deer', x + i * 0.7, y)
    const m = sim.monsters.find((mo) => mo.entityId === id)!
    m.herdId = herdId
    m.groundX = GROUND.x
    m.groundY = GROUND.y
    membres.push(m)
  }
  return membres
}

function entityOf(sim: SimState, m: Monster): Entity {
  return sim.entities.find((e) => e.id === m.entityId)!
}

/** La place assignée d'une bête — la même dérivation que la sim (rang dans la harde). */
function placeDe(membres: Monster[], m: Monster): { x: number; y: number } {
  const PLACES: readonly (readonly [number, number])[] = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2],
  ]
  let rank = 0
  for (const other of membres) if (other.entityId < m.entityId) rank++
  const p = PLACES[rank % PLACES.length]!
  return { x: m.dortoirX! + p[0] * FAUNA.DORTOIR_SPREAD, y: m.dortoirY! + p[1] * FAUNA.DORTOIR_SPREAD }
}

describe('A41 — le dortoir tenu : chaque harde dans SON massif, espacée', () => {
  it('à minuit, deux hardes dorment dans deux massifs distincts, chacun à sa place', () => {
    const sim = makeSim(22)
    const a = harde(sim, 4, GROUND.x, GROUND.y)
    const b = harde(sim, 4, GROUND.x + 3, GROUND.y + 3)
    for (let t = 0; t < 900; t++) step(sim, [])

    for (const membres of [a, b]) {
      for (const m of membres) {
        expect(m.dodo, `bête ${m.entityId} devrait dormir`).toBe(true)
        expect(m.dortoirX).toBeDefined()
        // Toute la harde partage LE MÊME dortoir…
        expect(m.dortoirX).toBe(membres[0]!.dortoirX)
        expect(m.dortoirY).toBe(membres[0]!.dortoirY)
        // …et chacune est couchée À SA place (« chacun son arbre »).
        const e = entityOf(sim, m)
        const p = placeDe(membres, m)
        expect(distSq(e.x, e.y, p.x, p.y), `bête ${m.entityId} loin de sa place`).toBeLessThanOrEqual(1.0 * 1.0)
      }
    }
    // UNE HARDE = SON DORTOIR : jamais deux hardes dans le même massif.
    const dA = { x: a[0]!.dortoirX!, y: a[0]!.dortoirY! }
    const dB = { x: b[0]!.dortoirX!, y: b[0]!.dortoirY! }
    expect(distSq(dA.x, dA.y, dB.x, dB.y)).toBeGreaterThanOrEqual(FAUNA.DORTOIR_EXCLUSION * FAUNA.DORTOIR_EXCLUSION)
  })

  it('à midi, personne ne dort', () => {
    const sim = makeSim(12)
    const a = harde(sim, 4, GROUND.x, GROUND.y)
    for (let t = 0; t < 400; t++) step(sim, [])
    for (const m of a) expect(m.dodo).toBeUndefined()
  })
})

describe('A42 — le sommeil bride les sens, le guetteur se lève, le premier sang réveille tout', () => {
  /** Une harde endormie au dortoir, et son point d'approche. */
  function hardeEndormie(): { sim: SimState; membres: Monster[]; dortoir: { x: number; y: number } } {
    const sim = makeSim(22)
    const membres = harde(sim, 4, GROUND.x, GROUND.y)
    for (let t = 0; t < 900; t++) step(sim, [])
    for (const m of membres) expect(m.dodo).toBe(true)
    return { sim, membres, dortoir: { x: membres[0]!.dortoirX!, y: membres[0]!.dortoirY! } }
  }

  function approche(sim: SimState, marcheur: number, e: Entity, cible: { x: number; y: number }, sprint: boolean): MoveInput {
    const dx = cible.x - e.x
    const dy = cible.y - e.y
    return {
      entityId: marcheur,
      dx: (Math.abs(dx) > 0.3 ? Math.sign(dx) : 0) as -1 | 0 | 1,
      dy: (Math.abs(dy) > 0.3 ? Math.sign(dy) : 0) as -1 | 0 | 1,
      ...(sprint ? { sprint: true } : {}),
    }
  }

  it('en MARCHANT on arrive à portée de tir ; en COURANT, exactement UNE bête se lève', () => {
    const { sim, membres, dortoir } = hardeEndormie()
    const marcheur = spawnEntity(sim, dortoir.x - 20, dortoir.y)
    const me = (): Entity => sim.entities.find((e) => e.id === marcheur)!

    // La marche : jusqu'à 6 tuiles du dortoir — personne ne bronche (A42).
    for (let t = 0; t < 400; t++) {
      const e = me()
      if (distSq(e.x, e.y, dortoir.x, dortoir.y) <= 6 * 6) break
      step(sim, [approche(sim, marcheur, e, dortoir, false)])
    }
    expect(distSq(me().x, me().y, dortoir.x, dortoir.y)).toBeLessThanOrEqual(6.5 * 6.5)
    for (const m of membres) {
      expect(m.dodo, 'la marche ne réveille pas une harde endormie').toBe(true)
      expect(m.guet).toBeUndefined()
    }

    // Le sprint TANGENTIEL à ~4 tuiles — du bruit, sans marcher sur personne
    // (la panique de contact, PANIC_RANGE, est un autre chemin) : le GUETTEUR
    // se lève, seul.
    let guets = 0
    for (let t = 0; t < 400 && guets === 0; t++) {
      const e = me()
      const d = Math.sqrt(distSq(e.x, e.y, dortoir.x, dortoir.y))
      let input: MoveInput
      if (d < 3.8) input = { entityId: marcheur, dx: -1, dy: 0, sprint: true }
      else if (d > 4.6) input = approche(sim, marcheur, e, dortoir, true)
      else input = { entityId: marcheur, dx: 0, dy: (Math.floor(t / 10) % 2 === 0 ? 1 : -1) as -1 | 0 | 1, sprint: true }
      step(sim, [input])
      guets = membres.filter((m) => m.guet === true).length
      if (membres.some((m) => m.fleeSince >= 0)) break
    }
    expect(guets, 'le bruit lève un guetteur').toBe(1)
    expect(membres.filter((m) => m.dodo === true).length, 'les autres dorment encore').toBe(3)

    // Il continue de venir : le guetteur le repère — toute la harde part.
    for (let t = 0; t < 300; t++) {
      const e = me()
      step(sim, [approche(sim, marcheur, e, dortoir, true)])
      if (membres.every((m) => m.fleeSince >= 0)) break
    }
    expect(membres.every((m) => m.fleeSince >= 0), 'le guetteur lève la harde entière').toBe(true)
    for (const m of membres) expect(m.dodo).toBeUndefined()
  })

  it('le premier sang réveille tout le monde — la deuxième flèche ne trouve plus une dormeuse', () => {
    const { sim, membres } = hardeEndormie()
    const chasseur = spawnEntity(sim, GROUND.x, GROUND.y)
    const proie = entityOf(sim, membres[0]!)
    applyDamage(sim, proie, 999, chasseur) // la mise à mort — et le CRI (chasse C7)
    step(sim, [])
    const survivantes = membres.filter((m) => sim.monsters.includes(m))
    expect(survivantes.length).toBe(3)
    for (const m of survivantes) {
      expect(m.fleeSince, `bête ${m.entityId} devrait fuir`).toBeGreaterThanOrEqual(0)
      expect(m.dodo).toBeUndefined()
    }
  })
})

describe('A43 — les trajets : au dortoir le soir, au gagnage le matin', () => {
  it('du crépuscule au matin — la harde se couche avant la nuit pleine et repart après l’aube', () => {
    const sim = makeSim(18)
    const membres = harde(sim, 4, GROUND.x, GROUND.y)

    // 18 h → 21 h : la vigueur tombe, la harde gagne son massif et se couche.
    const parHeure = Math.round((30 * 60 * 20) / 24) // TICKS_PER_CYCLE / 24
    for (let t = 0; t < parHeure * 3; t++) step(sim, [])
    for (const m of membres) expect(m.dodo, 'couchée avant la nuit pleine').toBe(true)
    const dortoir = { x: membres[0]!.dortoirX!, y: membres[0]!.dortoirY! }

    // 21 h → 9 h : la nuit passe, l'aube rend les sens, la pâture reprend — la
    // harde a QUITTÉ le dortoir. (La descente de la coulée, elle, a sa propre
    // suite — chasse R5quater.)
    for (let t = 0; t < parHeure * 12; t++) step(sim, [])
    let cx = 0
    let cy = 0
    for (const m of membres) {
      expect(m.dodo, 'debout après l’aube').toBeUndefined()
      const e = entityOf(sim, m)
      cx += e.x / membres.length
      cy += e.y / membres.length
    }
    expect(distSq(cx, cy, dortoir.x, dortoir.y), 'le centre de la harde a quitté le massif').toBeGreaterThan(6 * 6)
  }, 120_000)
})
