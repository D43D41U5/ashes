/**
 * L'IMPASSE — le filet sous toutes les machines à états (2026-08-28).
 *
 * Demande d'Alexis (capture `tremblement.png`) : « je ne veux plus JAMAIS voir
 * une entité trembler. » Ces bancs éprouvent LE FILET lui-même (la signature, le
 * renoncement, la récidive, l'exception du sang) puis LA SCÈNE DE LA CAPTURE :
 * une bête seule dont le but tire de l'autre côté d'une rivière — le montage
 * exact que la suite n'essayait jamais (sanglier/lapin : pas de harde, donc
 * aucune des hystérésis de `faune.test` ne les couvre).
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, IMPASSE, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { advanceImpasse } from './impasse'
import { createEmptyMap, type WorldMap } from './map'
import { spawnMonster, type Monster } from './monsters'
import { createSim, spawnEntity, step, type Entity, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'

function entityOf(sim: SimState, id: number): Entity {
  return sim.entities.find((e) => e.id === id)!
}

function monsterOf(sim: SimState, entityId: number): Monster {
  return sim.monsters.find((m) => m.entityId === entityId)!
}

/** Une sim nue : le filet se teste seul, sans peuplement ni menace. */
function makeSim(map?: WorldMap): SimState {
  return createSim(1234, {
    map: map ?? createEmptyMap(80, 80, TERRAIN_GRASS),
    faunaCap: 0,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(12, 1),
  })
}

describe("l'impasse — la signature (du mouvement qui ne mène nulle part)", () => {
  it('une bête qui oscille sur place RENONCE en une fenêtre', () => {
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 40.5, 40.5)
    const m = monsterOf(sim, id)
    const e = entityOf(sim, id)

    // On joue le rôle d'une machine à états cassée : ±0,3 tuile, chaque tick.
    for (let t = 0; t <= IMPASSE.FENETRE_TICKS + 1; t++) {
      e.x = 40.5 + (t % 2 === 0 ? 0.3 : -0.3)
      advanceImpasse(sim)
      if (m.renonceJusqua !== undefined) break
      sim.tick += 1
    }
    expect(m.renonceJusqua, 'le tremblement doit être attrapé à la première fenêtre').toBeDefined()
    expect(m.renonceJusqua! - sim.tick).toBe(IMPASSE.RENONCE_TICKS)
    // …et les intentions transitoires sont rendues.
    expect(m.wanderDx).toBe(0)
    expect(m.wanderDy).toBe(0)
    expect(m.homing).toBeUndefined()
    expect(m.ranging).toBeUndefined()
    expect(m.regagne).toBeUndefined()
  })

  it('un voyageur ne déclenche jamais : son net est grand', () => {
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 10.5, 40.5)
    const m = monsterOf(sim, id)
    const e = entityOf(sim, id)
    for (let t = 0; t < IMPASSE.FENETRE_TICKS * 4; t++) {
      e.x += 0.15 // il va quelque part — brut ET net grandissent ensemble
      advanceImpasse(sim)
      sim.tick += 1
    }
    expect(m.renonceJusqua).toBeUndefined()
  })

  it("une bête immobile ne déclenche pas — et ne porte pas un octet de guet", () => {
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 40.5, 40.5)
    const m = monsterOf(sim, id)
    for (let t = 0; t < IMPASSE.FENETRE_TICKS * 2 + 2; t++) {
      advanceImpasse(sim)
      sim.tick += 1
    }
    expect(m.renonceJusqua).toBeUndefined()
    expect(m.impDepuis, 'la fenêtre d’une bête à l’arrêt se rend').toBeUndefined()
    expect(m.impAncreX).toBeUndefined()
  })

  it('la récidive rapprochée DOUBLE le souffle ; la rémission efface l’ardoise', () => {
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 40.5, 40.5)
    const m = monsterOf(sim, id)
    const e = entityOf(sim, id)

    const tremble = (): void => {
      for (let t = 0; t < IMPASSE.FENETRE_TICKS * 2; t++) {
        e.x = 40.5 + (t % 2 === 0 ? 0.3 : -0.3)
        advanceImpasse(sim)
        if (m.renonceJusqua !== undefined && m.renonceJusqua > sim.tick) return
        sim.tick += 1
      }
    }

    tremble()
    expect(m.renonceCoups).toBe(1)
    const fin1 = m.renonceJusqua!
    sim.tick = fin1 + 1 // le souffle expire, la récidive est encore fraîche

    tremble()
    expect(m.renonceCoups).toBe(2)
    expect(m.renonceJusqua! - (fin1 + 1 + IMPASSE.FENETRE_TICKS)).toBeGreaterThanOrEqual(IMPASSE.RENONCE_TICKS * 2 - 2)

    // Loin de toute récidive : l'ardoise s'efface au premier guet venu.
    sim.tick = m.renonceJusqua! + IMPASSE.RECIDIVE_TICKS + 1
    advanceImpasse(sim)
    expect(m.renonceCoups).toBeUndefined()
    expect(m.renonceJusqua).toBeUndefined()
  })
})

describe("l'impasse — le renoncement dans le monde (le pilote)", () => {
  it('une bête qui a renoncé souffle sur place : sa machine ne joue pas', () => {
    const sim = makeSim()
    const id = spawnMonster(sim, 'deer', 40.5, 40.5)
    const m = monsterOf(sim, id)
    m.renonceJusqua = sim.tick + 40
    m.wanderDx = 1 // même avec un cap : le pilote la saute
    const avant = { ...entityOf(sim, id) }
    for (let t = 0; t < 20; t++) step(sim, [])
    const apres = entityOf(sim, id)
    expect(apres.x).toBe(avant.x)
    expect(apres.y).toBe(avant.y)
  })

  it('LE SANG lève le souffle : blessée, bourreau vivant, elle rejoue tout de suite', () => {
    const sim = makeSim()
    const bourreau = spawnEntity(sim, 41.5, 40.5)
    const id = spawnMonster(sim, 'deer', 40.5, 40.5)
    const m = monsterOf(sim, id)
    const e = entityOf(sim, id)
    e.hp -= 5
    m.lastAttackerId = bourreau
    m.renonceJusqua = sim.tick + 200
    const avant = { x: e.x, y: e.y }
    for (let t = 0; t < 30; t++) step(sim, [])
    const d = Math.sqrt((e.x - avant.x) * (e.x - avant.x) + (e.y - avant.y) * (e.y - avant.y))
    expect(d, 'on ne cloue jamais une proie sous les crocs').toBeGreaterThan(0.5)
  })
})

describe('la scène de la capture — le but de l’autre côté de la rivière', () => {
  /**
   * `tremblement.png` : des bêtes au bord de l'eau, en aller-retour sur 10 px, en
   * boucle. Le mécanisme (carte des oscillations ①/②) : `migrationTarget` et le
   * canton tirent SANS regarder l'habitat ; un but de l'autre côté de la rivière
   * menait la bête à la lisière, demi-tour (`stepStaysHome`), et la pensée
   * suivante re-visait le même but. Sanglier et lapin n'ont PAS de harde : aucune
   * hystérésis de `faune.test` ne les couvrait.
   *
   * Le montage : forêt | rivière | forêt, un sanglier SEUL à l'ouest, son coin de
   * chasse à l'est — de l'autre côté de l'eau. On compte les inversions de cap
   * horizontales dans la PIRE seconde (la mesure de `diag-cerf`) : le tremblement
   * en faisait une dizaine, une bête saine en fait au plus deux ou trois.
   */
  function riviere(): WorldMap {
    const map = createEmptyMap(120, 120, TERRAIN_FOREST)
    for (let ty = 0; ty < 120; ty++) {
      for (let tx = 58; tx < 62; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
    }
    return map
  }

  function pireSeconde(flipsParTick: number[]): number {
    const parSeconde = BALANCE.TICK_RATE_HZ
    let pire = 0
    for (let d = 0; d + parSeconde <= flipsParTick.length; d += parSeconde) {
      let somme = 0
      for (let k = d; k < d + parSeconde; k++) somme += flipsParTick[k]!
      if (somme > pire) pire = somme
    }
    return pire
  }

  it('un sanglier seul, coin de chasse outre-rivière : il ne gratte pas la rive', () => {
    const sim = makeSim(riviere())
    const id = spawnMonster(sim, 'boar', 56.5, 60.5) // à deux tuiles de l'eau
    const m = monsterOf(sim, id)
    m.groundX = 80.5 // son canton est DE L'AUTRE CÔTÉ
    m.groundY = 60.5
    spawnEntity(sim, 10.5, 10.5) // loin : aucune menace

    const e = entityOf(sim, id)
    let prevX = e.x
    let lastSign = 0
    const flips: number[] = []
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(sim, [])
      const dx = e.x - prevX
      const sign = dx > 0.001 ? 1 : dx < -0.001 ? -1 : 0
      let f = 0
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) f = 1
      if (sign !== 0) lastSign = sign
      flips.push(f)
      prevX = e.x
    }
    // Le tremblement de la capture : ~10 inversions dans la pire seconde,
    // sans fin. Une bête saine vire au rythme de sa réflexion (1 s) — deux ou
    // trois fois au plus, et le veto de cap fait taire le but qui bute.
    expect(pireSeconde(flips)).toBeLessThanOrEqual(3)
  })

  it('un lapin seul à la lisière de son pré : le demi-tour ne devient pas une boucle', () => {
    const map = createEmptyMap(120, 120, TERRAIN_GRASS)
    // Une lisière franche : au nord, un terrain qui n'est pas le sien.
    for (let ty = 0; ty < 55; ty++) {
      for (let tx = 0; tx < 120; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
    }
    const sim = makeSim(map)
    const id = spawnMonster(sim, 'rabbit', 60.5, 56.5) // à une tuile et demie de l'eau
    const m = monsterOf(sim, id)
    m.groundX = 60.5
    m.groundY = 40.5 // le cœur de son canton est DANS l'eau : le pire cas
    spawnEntity(sim, 10.5, 110.5)

    const e = entityOf(sim, id)
    let prevY = e.y
    let lastSign = 0
    const flips: number[] = []
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(sim, [])
      const dy = e.y - prevY
      const sign = dy > 0.001 ? 1 : dy < -0.001 ? -1 : 0
      let f = 0
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) f = 1
      if (sign !== 0) lastSign = sign
      flips.push(f)
      prevY = e.y
    }
    expect(pireSeconde(flips)).toBeLessThanOrEqual(3)
  })
})
