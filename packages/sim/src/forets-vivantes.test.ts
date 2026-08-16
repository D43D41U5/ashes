/**
 * FORÊTS VIVANTES — les gardes du chantier (spec `forets-vivantes.md`).
 *
 * A1 : le tas de feuilles se fouille et rend des VERS, et le gibier vient aux vers posés.
 * A2 : la litière qui craque — le bruit du sol croît de la lisière au cœur, un seul canal.
 * (Les gardes de CARTE — où naissent les tas — vivent dans `zone-content.test.ts`, sur les
 * mondes de production déjà générés.)
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, HUNT, NODE_DEFS, TERRAIN_FOREST, TERRAIN_GRASS } from './balance'
import { countOf } from './items'
import { createEmptyMap, profondeurAt, type WorldMap } from './map'
import { spawnMonster } from './monsters'
import { deriverProfondeur } from './profondeur'
import { CREUX } from './racine-relief'
import { avatarThreat, bruitDuSol } from './faune'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'

/** Une carte : prairie, et un massif de feuillus 24×24 (assez pour un cœur), profondeur dérivée. */
function carteAvecMassif(): WorldMap {
  const map = createEmptyMap(160, 160, TERRAIN_GRASS)
  for (let ty = 60; ty < 84; ty++) {
    for (let tx = 60; tx < 84; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  }
  const zone = new Int32Array(map.width * map.height)
  map.profondeur = deriverProfondeur(map.terrain, zone, 0, map.width, map.height)
  return map
}

function makeSim(faunaCap = 0, hour = 12): SimState {
  return createSim(1234, {
    map: carteAvecMassif(),
    faunaCap,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(hour),
  })
}

function tick(state: SimState, inputs: MoveInput[] = []): void {
  step(state, inputs)
}

describe('A1 (§1) — le tas de feuilles se fouille, et les vers appâtent', () => {
  it('fouiller un tas à mains nues rend des VERS', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 70.5, 71.9)
    const e = sim.entities.find((x) => x.id === a)!
    sim.nodes.push({ id: 9001, type: 'leaf_pile', tx: 70, ty: 70, stock: NODE_DEFS.leaf_pile.stock, regrowAt: 0 })
    for (let coups = 0; coups < 30 && countOf(e.inventory, 'worms') === 0; coups++) {
      step(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 9001 } }])
      e.cooldownUntil = 0 // la cadence n'est pas le sujet
    }
    expect(countOf(e.inventory, 'worms')).toBeGreaterThan(0)
  })

  it('le gibier vient aux VERS posés — le patron du test des baies', () => {
    const sim = makeSim(6)
    const id = spawnMonster(sim, 'rabbit', 80.5, 100.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    delete m.burrowX
    delete m.burrowY
    sim.groundItems.push({ id: 1, x: 80.5, y: 106.5, item: 'worms', count: 1, expiresAt: 1e9 })
    sim.nextGroundItemId = 2
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && m.baitUntil === undefined; t++) tick(sim)
    expect(m.baitUntil, 'le lapin ignore les vers — BAIT_ITEMS ne les connaît pas').toBeDefined()
  })
})

describe('A2 (§2) — la litière qui craque : le bruit du sol', () => {
  it('bruitDuSol : 1 hors feuillu et en lisière, croissance STRICTE vers le cœur, plafond au cap', () => {
    const sim = makeSim()
    expect(bruitDuSol(sim, 10, 10)).toBe(1) //   le pré ne craque pas
    expect(bruitDuSol(sim, 60, 72)).toBe(1) //   la lisière (d = 1) non plus
    // La pente : strictement croissante le long d'un rayon vers le centre du massif.
    let prec = 1
    for (let tx = 61; tx <= 71; tx++) {
      const d = profondeurAt(sim.map, tx, 72)
      const b = bruitDuSol(sim, tx, 72)
      if (d >= CREUX.PROF_CAP) {
        expect(b).toBeCloseTo(HUNT.LITIERE_BRUIT_COEUR, 10)
      }
      expect(b, `en (${tx},72), d=${d}`).toBeGreaterThanOrEqual(prec)
      prec = b
    }
    expect(prec).toBeCloseTo(HUNT.LITIERE_BRUIT_COEUR, 10)
  })

  it('sans champ de profondeur, tout est INERTE (le banc, les cartes d\'avant)', () => {
    const map = createEmptyMap(64, 64, TERRAIN_FOREST) // pas de map.profondeur
    const sim = createSim(1, { map, faunaCap: 0, worldEvents: false })
    expect(bruitDuSol(sim, 30, 30)).toBe(1)
  })

  it('le même marcheur s\'ENTEND plus au cœur qu\'en lisière — un seul canal (avatarThreat)', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 61.5, 72.5) // lisière (d ≈ 2)
    const e = sim.entities.find((x) => x.id === a)!
    const bruitLisiere = avatarThreat(sim, e).noise
    e.x = 71.5 //                              le cœur du massif
    const bruitCoeur = avatarThreat(sim, e).noise
    expect(bruitCoeur).toBeGreaterThan(bruitLisiere)
  })

  it('en jeu : la même approche au même pas ALERTE plus vite au cœur (temps jusqu\'au seuil)', () => {
    // Le NIVEAU sature (plafond 1) : on mesure le TEMPS jusqu'à l'alerte — la mesure qui
    // ne sature pas (le patron « distances de levée » de chasse.md, transposé au temps).
    const mesurer = (x: number, y: number): number => {
      const sim = makeSim(0, 12)
      const id = spawnMonster(sim, 'deer', x, y)
      const m = sim.monsters.find((mm) => mm.entityId === id)!
      spawnEntity(sim, x, y + 9) // à 9 tuiles au sud, gait walk (le spawn), aucun input
      let t = 0
      for (; t < 30 * BALANCE.TICK_RATE_HZ && m.suspicion < HUNT.SUSPICION_ALERT; t++) tick(sim)
      return t
    }
    const auCoeur = mesurer(71.5, 63.5) //     le cerf au cœur, l'homme dessous (d élevé)
    const enLisiere = mesurer(61.5, 63.5) //   la même géométrie, collée à la lisière ouest
    expect(auCoeur, `cœur ${auCoeur} ticks vs lisière ${enLisiere}`).toBeLessThan(enLisiere)
  })
})
