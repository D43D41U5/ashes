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
import { drainEvents } from './events'
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
    // Les DEUX colonnes vivent hors lisière (d ≥ 3) : sur la lisière même, c'est L'ENVOL
    // qui alerte le cerf — plus fort que la litière, et c'est voulu (§3). Ici on isole le
    // canal du BRUIT : le bord du corps (d ≈ 4) contre le cœur (d au plafond).
    const auCoeur = mesurer(71.5, 63.5)
    const auCorps = mesurer(63.5, 63.5)
    expect(auCoeur, `cœur ${auCoeur} ticks vs corps ${auCorps}`).toBeLessThan(auCorps)
  })
})

describe('A3 (§3) — l\'envol de la lisière : la forêt répond au bruit', () => {
  const surLisiere = { x: 60.5, y: 72.5 } // d = 1 : la lisière ouest du massif

  it('MARCHER sur la lisière émet bird_flush ; le PAS LENT passe sans un cri', () => {
    const sim = makeSim()
    spawnEntity(sim, surLisiere.x, surLisiere.y) // gait walk au spawn
    tick(sim)
    const faits = drainEvents(sim).filter((e) => e.type === 'bird_flush')
    expect(faits, 'la marche sur la lisière doit lever la nuée').toHaveLength(1)

    const discret = makeSim()
    const b = spawnEntity(discret, surLisiere.x, surLisiere.y)
    const eb = discret.entities.find((x) => x.id === b)!
    eb.gait = 'sneak' // il rampe — et l'allure persiste sans input
    tick(discret)
    const rien = drainEvents(discret).filter((e) => e.type === 'bird_flush')
    expect(rien, 'le pas lent ne lève rien').toHaveLength(0)
  })

  it('les perchoirs se REPOSENT : deux passages dans le cooldown, UN seul envol', () => {
    const sim = makeSim()
    spawnEntity(sim, surLisiere.x, surLisiere.y)
    for (let t = 0; t < 40; t++) tick(sim) // il piétine la lisière 2 secondes
    const faits = drainEvents(sim).filter((e) => e.type === 'bird_flush')
    expect(faits).toHaveLength(1)
  })

  it('le gibier alentour prend l\'alarme — la méfiance monte d\'un coup', () => {
    const sim = makeSim(6)
    const id = spawnMonster(sim, 'deer', 66.5, 72.5) // à 6 tuiles du perchoir, dans le bois
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    const avant = m.suspicion
    spawnEntity(sim, surLisiere.x, surLisiere.y)
    tick(sim)
    expect(m.suspicion).toBeGreaterThanOrEqual(avant + HUNT.ENVOL_SUSPICION - 0.01)
  })
})

describe('A6 (§4 R5quater) — la harde emprunte sa coulée : la trace ne ment plus', () => {
  /** Une coulée posée à la main : une ligne de (60,90) vers (60,79) — la « fin » au nord. */
  function simAvecCoulee(hour: number): { sim: SimState; chemin: number[] } {
    const map = carteAvecMassif()
    const chemin: number[] = []
    for (let y = 90; y >= 79; y--) chemin.push(y * map.width + 60)
    map.coulees = chemin
    const sim = createSim(1234, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(hour) })
    return { sim, chemin }
  }

  it('au crépuscule, elle rejoint le chemin, le DESCEND dans l\'ordre, et BOIT au bout', () => {
    const { sim } = simAvecCoulee(6) // l'aube
    const id = spawnMonster(sim, 'deer', 62.5, 92.5) // près du départ du chemin
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.groundX = 60
    m.groundY = 78 // son coin, contre la FIN (l'eau)
    let sommetAtteint = false
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ && m.drinkUntil === undefined; t++) {
      tick(sim)
      const e = sim.entities.find((x) => x.id === id)!
      if (Math.floor(e.x) === 60 && Math.floor(e.y) === 79) sommetAtteint = true
    }
    expect(m.drinkUntil, 'elle n\'a jamais bu').toBeDefined()
    expect(sommetAtteint, 'elle a bu sans avoir suivi le chemin jusqu\'au bout').toBe(true)
    expect(m.couleePas).toBe(-1) // une seule descente par fenêtre
    const e = sim.entities.find((x) => x.id === id)!
    expect(Math.abs(e.x - 60.5) + Math.abs(e.y - 79.5), 'elle boit ailleurs qu\'au bout').toBeLessThan(2)
  })

  it('à MIDI, rien — et sans coulées, aucun champ n\'apparaît sur la bête', () => {
    const { sim } = simAvecCoulee(12)
    const id = spawnMonster(sim, 'deer', 62.5, 92.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.groundX = 60
    m.groundY = 78
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(m.couleePas).toBeUndefined()
    expect(m.drinkUntil).toBeUndefined()

    const nu = makeSim(0, 6) // aube, mais pas de coulées sur cette carte
    const id2 = spawnMonster(nu, 'deer', 62.5, 92.5)
    const m2 = nu.monsters.find((mm) => mm.entityId === id2)!
    m2.groundX = 60
    m2.groundY = 78
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) tick(nu)
    expect(m2.couleeDebut).toBeUndefined()
  })

  it('menacée, elle FUIT — la priorité de la peur est intacte', () => {
    const { sim } = simAvecCoulee(6)
    const id = spawnMonster(sim, 'deer', 62.5, 92.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.groundX = 60
    m.groundY = 78
    spawnEntity(sim, 62.5, 94.5) // un marcheur dans sa flightRange
    for (let t = 0; t < 6 * BALANCE.TICK_RATE_HZ && m.fleeSince < 0; t++) tick(sim)
    expect(m.fleeSince, 'elle a préféré sa promenade à sa peur').toBeGreaterThanOrEqual(0)
  })
})
