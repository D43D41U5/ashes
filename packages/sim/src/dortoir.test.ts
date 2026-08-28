import { describe, it, expect } from 'vitest'
import { FAUNA, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { applyDamage } from './combat'
import { createEmptyMap, type WorldMap } from './map'
import { spawnMonster, type Monster } from './monsters'
import { createSim, spawnEntity, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { distSq } from './geometry'
import { entretienDesCoins } from './faune'
import { drainEvents } from './events'

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

describe('A44 (R27) — le coin vivant : le dortoir se remplace, le coin meurt et renaît ailleurs', () => {
  // Une plus grande vallée : les massifs A et B au canton, un massif C avec son
  // eau LOIN à l'est — le seul site de renaissance possible.
  const MASSIF_C = { x0: 340, y0: 140 }
  function grandeMap(): WorldMap {
    const map = createEmptyMap(400, 200, TERRAIN_GRASS)
    for (const m of [MASSIF_A, MASSIF_B, MASSIF_C]) {
      for (let ty = m.y0; ty < m.y0 + 13; ty++) {
        for (let tx = m.x0; tx < m.x0 + 13; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
      }
    }
    for (let ty = 0; ty < 200; ty++) {
      for (let tx = 100; tx < 103; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
      for (let tx = 310; tx < 313; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
    }
    return map
  }
  function grandeSim(hour: number): SimState {
    const sim = createSim(1234, {
      map: grandeMap(),
      faunaCap: 0,
      grounds: [{ x: GROUND.x, y: GROUND.y }],
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(hour, 1),
      // LES DEUX HORLOGES : au scale 1, un jour de saison = 24 h RÉELLES — la
      // bascule (où vit l'entretien R27) est inatteignable en steppant. On
      // accélère le calendrier, pas le monde : un jour ≈ 2 000 ticks.
      calendarScale: 864,
    })
    sim.wind = { x: 0, y: 0 }
    return sim
  }
  /** Un bâti posé au cœur d'un massif — l'OCCUPATION de R27. */
  function occupe(sim: SimState, massif: { x0: number; y0: number }, id: number): void {
    sim.structures.push({ id, type: 'fire', tx: massif.x0 + 6, ty: massif.y0 + 6, villageId: 0 } as never)
  }

  it('une maison dans le massif-dortoir ne tue pas le coin : la harde change de massif', () => {
    const sim = grandeSim(22)
    occupe(sim, MASSIF_A, 9100) // le plus proche est pris : le coin survit par B
    const membres = harde(sim, 4, GROUND.x, GROUND.y)
    for (let t = 0; t < 900; t++) step(sim, [])
    expect(sim.grounds.length, 'le coin vit').toBe(1)
    for (const m of membres) {
      expect(m.dodo).toBe(true)
      expect(m.dortoirY!, 'le dortoir est dans le massif B, pas dans la cour').toBeGreaterThan(MASSIF_B.y0 - 2)
    }
  })

  it("tous les massifs perdus : le coin s'éteint au jour suivant, la harde se lève, un coin renaît vers l'est", () => {
    const sim = grandeSim(22)
    occupe(sim, MASSIF_A, 9100)
    occupe(sim, MASSIF_B, 9101)
    spawnEntity(sim, GROUND.x - 10, GROUND.y) // un témoin : la harde reste regardée, donc visible
    const membres = harde(sim, 4, GROUND.x, GROUND.y)

    // On traverse la bascule de jour (l'entretien R27 y vit — le même carrefour
    // que le front de cendre). Borné : si le coin n'a pas bougé en 8 000 ticks,
    // c'est rouge.
    let bascule = -1
    for (let t = 0; t < 6000; t++) { // ~3 jours de saison au scale du banc
      step(sim, [])
      if (sim.grounds.length === 0 || sim.grounds[0]!.x !== GROUND.x) {
        bascule = t
        break
      }
    }
    expect(bascule, "l'entretien quotidien a jugé le coin").toBeGreaterThan(0)

    // L'ancien coin est MORT, un nouveau est né — loin, vers le seul site viable.
    expect(sim.grounds.length, 'la vallée ne perd pas son coin : il renaît').toBe(1)
    const neuf = sim.grounds[0]!
    expect(distSq(neuf.x, neuf.y, GROUND.x, GROUND.y)).toBeGreaterThan(100 * 100)
    expect(neuf.x, 'né du côté du massif C et de son eau').toBeGreaterThan(280)

    // Et la harde de l'ancien coin s'est LEVÉE : sans territoire, rendue à
    // l'ambiant (elle se dissipera hors de portée de vue), en fuite du cœur mort.
    step(sim, [])
    for (const m of membres) {
      if (!sim.monsters.includes(m)) continue // déjà dissipée hors de vue : c'est le contrat
      expect(m.groundX).toBeUndefined()
      expect(m.ambient).toBe(true)
      expect(m.fleeSince).toBeGreaterThanOrEqual(0)
    }
  }, 60_000)
})

describe('A38 (R24) — la pastille du coin : découverte à l’approche, mémoire, oubli au constat', () => {
  const MASSIF_C = { x0: 340, y0: 140 }
  function carte(): WorldMap {
    const map = createEmptyMap(400, 200, TERRAIN_GRASS)
    for (const m of [MASSIF_A, MASSIF_B, MASSIF_C]) {
      for (let ty = m.y0; ty < m.y0 + 13; ty++) {
        for (let tx = m.x0; tx < m.x0 + 13; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
      }
    }
    for (let ty = 0; ty < 200; ty++) {
      for (let tx = 100; tx < 103; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
      for (let tx = 310; tx < 313; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
    }
    return map
  }

  it('approcher le cœur pose la pastille ; le coin mort la garde jusqu’au retour, qui l’éteint', () => {
    const sim = createSim(1234, {
      map: carte(),
      faunaCap: 0,
      grounds: [{ x: GROUND.x, y: GROUND.y }],
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(12, 1),
    })
    sim.wind = { x: 0, y: 0 }
    const joueurId = spawnEntity(sim, GROUND.x - 40, GROUND.y)
    const joueur = sim.entities.find((e) => e.id === joueurId)!

    // Trop loin : rien. La carte ne donne pas ce qu'on n'a pas vu.
    step(sim, [])
    expect(joueur.knownGrounds ?? []).toHaveLength(0)

    // À portée de vue du cœur : la pastille se pose, et l'événement le dit.
    joueur.x = GROUND.x - 20
    drainEvents(sim)
    step(sim, [])
    expect(joueur.knownGrounds).toHaveLength(1)
    expect(drainEvents(sim).some((e) => e.type === 'coin_decouvert' && e.entityId === joueur.id)).toBe(true)

    // Le coin meurt LOIN du joueur (parti à l'autre bout) : LA CARTE EST UNE
    // MÉMOIRE — la pastille reste, le joueur n'a rien constaté.
    joueur.x = 20
    sim.structures.push({ id: 9100, type: 'fire', tx: MASSIF_A.x0 + 6, ty: MASSIF_A.y0 + 6, villageId: 0 } as never)
    sim.structures.push({ id: 9101, type: 'fire', tx: MASSIF_B.x0 + 6, ty: MASSIF_B.y0 + 6, villageId: 0 } as never)
    entretienDesCoins(sim)
    expect(sim.grounds.some((g) => g.x === GROUND.x && g.y === GROUND.y)).toBe(false)
    step(sim, [])
    expect(joueur.knownGrounds, 'la pastille du coin mort tient à distance').toHaveLength(1)

    // Le RETOUR constate : la pastille s'éteint, et l'événement le dit.
    joueur.x = GROUND.x - 15
    drainEvents(sim)
    step(sim, [])
    expect(joueur.knownGrounds).toHaveLength(0)
    expect(drainEvents(sim).some((e) => e.type === 'coin_disparu' && e.entityId === joueur.id)).toBe(true)
  })
})
