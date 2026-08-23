/**
 * LE GEL (spec `gel.md`) — les critères A1 à A13, un `describe` par critère.
 *
 * Le calendrier est couplé 1 jour de saison = 1 cycle (`calendarScaleForSeasonCycles`,
 * patron `meteo.test.ts`) : le tick dit à la fois l'ACTE et l'HEURE, et c'est tout ce dont
 * le gel a besoin. Les fronts sont FABRIQUÉS à la main quand la garde a besoin d'un froid
 * précis — le record de `state.meteo` est de la donnée plate, et sa géométrie est une
 * fonction pure du tick : on peut donc poser exactement le froid qu'on veut mesurer, au lieu
 * d'attendre qu'une saison veuille bien en tirer un.
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE, GEL, METEO, TEMPERATURE, TERRAINS,
  TERRAIN_DEEP_WATER, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_SHALLOW_WATER, TERRAIN_WILLOW,
} from './balance'
import { drainEvents } from './events'
import { placeHuntingGrounds } from './faune'
import {
  advanceDegel, estGele, feuillageDenude, gelPossible, jourDeDefeuillaison, neigeAuSol,
  vitesseSurGlace,
} from './gel'
import { createEmptyMap, isBlockingTile, isWater, MARCHABLE, setTile, terrainAt, type WorldMap } from './map'
import { frontDuCycle, largeurDe, neigeA, type MeteoFront } from './meteo'
import { spawnMonster } from './monsters'
import { computeFlowField, findPath } from './pathfinding'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { ambientTemperature, baselineTemperature, climatFlore, climatMaximal, dehorsSansMeteo } from './temperature'
import { actForDay, calendarScaleForSeasonCycles, DAY_TICKS_PER_CYCLE, NIGHT_RAMP_TICKS, TICKS_PER_CYCLE, seasonDayAtTick } from './time'
import { addStructure } from './village'

/** 1 jour de saison = 1 cycle : le tick porte l'acte ET l'heure. */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

/** Le tick d'un jour de saison, de jour ou en pleine nuit. */
function tickDe(jour: number, nuit = false): number {
  const base = (jour - 1) * TICKS_PER_CYCLE
  // Au CŒUR de la phase, jamais à sa frontière : l'hystérésis relit `RETARD_TICKS` en
  // arrière, et une pose au ras de l'aube lirait la nuit d'avant (ou l'inverse).
  return base + (nuit ? DAY_TICKS_PER_CYCLE + Math.floor((TICKS_PER_CYCLE - DAY_TICKS_PER_CYCLE) / 2) : Math.floor(DAY_TICKS_PER_CYCLE / 2))
}

/** Les jours-témoins de chaque acte : le milieu de l'acte, loin de ses bornes. */
const JOUR_ACTE = [10, 30, 50] as const

/**
 * LA CARTE D'ESSAI : de l'herbe, une RIVIÈRE d'eau profonde qui coupe la carte en deux du
 * nord au sud, et un GUÉ d'eau peu profonde à côté. Tout ce qu'il faut pour poser les deux
 * seuils, la traversée et le repli.
 */
const RIVIERE_X0 = 20
const RIVIERE_X1 = 23 // exclu
const GUE_X = 30

function carteDEssai(w = 60, h = 24): WorldMap {
  const map = createEmptyMap(w, h, TERRAIN_GRASS)
  for (let ty = 0; ty < h; ty++) {
    for (let tx = RIVIERE_X0; tx < RIVIERE_X1; tx++) setTile(map, tx, ty, TERRAIN_DEEP_WATER)
    setTile(map, GUE_X, ty, TERRAIN_SHALLOW_WATER)
  }
  return map
}

function simGel(options: { map?: WorldMap; meteoActive?: boolean } = {}): SimState {
  return createSim(2026, {
    map: options.map ?? carteDEssai(),
    calendarScale: SCALE,
    meteoActive: options.meteoActive ?? false,
  })
}

/** Un front FABRIQUÉ, actif de `state.tick − avance` à `+ TRAVERSEE_TICKS`. */
/**
 * Pose un front. LE JOUR SE DÉRIVE DU TICK D'ENTRÉE, il ne vaut plus 1 : depuis R13 c'est
 * `front.day` qui porte l'acte, donc la LARGEUR d'un orage (55 tuiles en acte I, la carte en
 * acte III). Un front daté du jour 1 mais joué au jour 50 aurait la bande de l'un et le froid
 * de l'autre — le test mesurerait alors son propre montage. (Calendrier couplé : 1 jour de
 * saison = 1 cycle, d'où `day = cycle + 1`.)
 */
function poserFront(state: SimState, type: MeteoFront['type'], edge: MeteoFront['edge'], startTick: number): MeteoFront {
  const cycle = Math.floor(startTick / TICKS_PER_CYCLE)
  const front: MeteoFront = {
    type,
    cycle,
    day: cycle + 1,
    edge,
    startTick,
    endTick: startTick + METEO.TRAVERSEE_TICKS,
  }
  state.meteo = front
  return front
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// LA PROMESSE G2 — la table, avant tout le reste
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('G2 — deux seuils, deux promesses (la table des six régimes)', () => {
  /**
   * C'EST LA GARDE QUI PROTÈGE LE CALIBRAGE. Les seuils ont été calculés contre cette table
   * exacte (voir l'en-tête du bloc `GEL`) : si quelqu'un retouche `ACT_COLD` ou `NIGHT_COLD`,
   * c'est ICI que ça doit rougir — pas six mois plus tard dans un playtest.
   */
  const attendu: { jour: number; nuit: boolean; t: number; gue: boolean; lac: boolean }[] = [
    // ⚠ EN DEGRÉS CELSIUS depuis le 2026-08-22. Les littéraux SONT le calibrage — ils restent
    // écrits, sinon la garde ne garde plus rien —, et chacun vaut
    // `BASE − ACT_COLD(acte) − NIGHT_COLD × nuit` (biome 0). L'ancienne jauge en regard.
    { jour: JOUR_ACTE[0], nuit: false, t: 18, gue: false, lac: false }, // acte I, jour (ex-90)
    { jour: JOUR_ACTE[0], nuit: true, t: 6, gue: false, lac: false }, // acte I, nuit (ex-60) : RIEN ne gèle
    { jour: JOUR_ACTE[1], nuit: false, t: 8, gue: false, lac: false }, // acte II, jour (ex-65)
    { jour: JOUR_ACTE[1], nuit: true, t: -4, gue: true, lac: false }, // acte II, NUIT (ex-35) : les gués prennent
    { jour: JOUR_ACTE[2], nuit: false, t: -2, gue: true, lac: false }, // acte III, jour (ex-40)
    { jour: JOUR_ACTE[2], nuit: true, t: -14, gue: true, lac: true }, // acte III, NUIT (ex-10) : la vallée s'ouvre
  ]

  it('la température de chaque régime est bien celle du calcul, et les seuils y mordent comme promis', () => {
    const sim = simGel()
    for (const cas of attendu) {
      sim.tick = tickDe(cas.jour, cas.nuit)
      const nom = `jour ${cas.jour} (acte ${actForDay(cas.jour)}) ${cas.nuit ? 'nuit' : 'jour'}`
      // LA PRÉMISSE DE LA TABLE : le littéral est bien la formule, pas un nombre recopié.
      const parLaFormule = TEMPERATURE.BASE - TEMPERATURE.ACT_COLD(actForDay(cas.jour)) - (cas.nuit ? TEMPERATURE.NIGHT_COLD : 0)
      expect(cas.t, `la table dit ${nom}`).toBe(parLaFormule)
      expect(baselineTemperature(sim, GUE_X, 5), `température ${nom}`).toBe(cas.t)
      expect(estGele(sim, GUE_X, 5), `gué ${nom}`).toBe(cas.gue)
      expect(estGele(sim, RIVIERE_X0, 5), `lac ${nom}`).toBe(cas.lac)
    }
  })

  it("l'acte I ne gèle JAMAIS, même la nuit sous l'averse — la marge de calibrage est réelle", () => {
    const sim = simGel({ meteoActive: true })
    sim.tick = tickDe(JOUR_ACTE[0], true)
    // La pluie et l'orage sont les seuls fronts froids de l'acte I (METEO.TYPES[0]), à 10.
    poserFront(sim, 'pluie', 0, sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2))
    expect(baselineTemperature(sim, GUE_X, 5)).toBeLessThanOrEqual(50)
    expect(estGele(sim, GUE_X, 5)).toBe(false)
    expect(estGele(sim, RIVIERE_X0, 5)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// LE SOCLE DU CHEMIN CHAUD — la table de marchabilité que le gel a substituée
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('le point unique du gel repose sur `MARCHABLE` — et cette équivalence est PROUVÉE', () => {
  /**
   * `terrainBloque` a remplacé `isBlockingTile` par une lecture de `MARCHABLE` sur le chemin
   * le plus chaud de la collision (`blockedSubAt`, une fois par sous-tuile balayée). Cette
   * substitution ne tenait jusqu'ici que sur un commentaire de `map.ts`. On la balaie donc
   * SUR TOUT LE DOMAINE — les 256 ids possibles, pas ceux que les suites emploient — car une
   * garde écrite avec les cas qu'on a en tête ne garde que ceux-là.
   */
  it('`MARCHABLE[id] !== 1` ⇔ `isBlockingTile`, pour les 256 ids ET hors carte', () => {
    const map = createEmptyMap(4, 4, TERRAIN_GRASS)
    for (let id = 0; id < 256; id++) {
      setTile(map, 1, 1, id)
      expect(MARCHABLE[id] !== 1, `id ${id}`).toBe(isBlockingTile(map, 1, 1))
    }
    // Hors carte : `terrainAt` rend 0 (void), les deux lois doivent bloquer pareil.
    for (const [tx, ty] of [[-1, 0], [0, -1], [4, 0], [0, 4]] as const) {
      expect(MARCHABLE[terrainAt(map, tx, ty)] !== 1).toBe(isBlockingTile(map, tx, ty))
      expect(isBlockingTile(map, tx, ty)).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A1 — pureté
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A1 — `estGele` est PURE', () => {
  it('deux appels, même réponse ; et un balayage complet ne bouge pas un bit du snapshot', () => {
    const sim = simGel({ meteoActive: true })
    sim.tick = tickDe(JOUR_ACTE[2], true)
    spawnEntity(sim, 5.5, 5.5)
    const avant = snapshot(sim)

    let gelees = 0
    for (let ty = 0; ty < sim.map.height; ty++) {
      for (let tx = 0; tx < sim.map.width; tx++) {
        const a = estGele(sim, tx, ty)
        const b = estGele(sim, tx, ty)
        expect(b).toBe(a)
        if (a) gelees += 1
        feuillageDenude(sim, tx, ty)
        neigeAuSol(sim, tx, ty)
        vitesseSurGlace(sim, tx, ty)
      }
    }
    // La garde prouve sa prémisse : un balayage qui ne gèle rien ne prouverait pas grand-chose.
    expect(gelees).toBeGreaterThan(0)
    expect(snapshot(sim)).toBe(avant)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A2 — la carte reste immuable, gel actif, sur une saison entière
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A2 — la carte reste immuable, gel actif', () => {
  /** L'empreinte du terrain — la même méthode que `carte-immuable.test.ts` (imul, 32 bits). */
  function empreinte(map: WorldMap): string {
    let h = 0x811c9dc5
    for (let i = 0; i < map.terrain.length; i++) {
      h = (Math.imul(h ^ (i + 0x9e3779b9), 0x85ebca6b) ^ Math.imul(map.terrain[i]! | 0, 0xc2b2ae35)) | 0
    }
    return `${h >>> 0}/${map.terrain.length}`
  }

  it('une saison entière jouée nuit et jour ne réécrit pas une tuile', () => {
    const sim = simGel({ meteoActive: true })
    const joueur = spawnEntity(sim, 5.5, 5.5)
    const avant = empreinte(sim.map)

    // On PARCOURT la saison : chaque jour, un peu de jour et un peu de nuit, et le joueur
    // marche vers la rivière (donc il finit par la traverser quand elle prend).
    let geleAuMoinsUneFois = false
    for (let d = 1; d <= BALANCE.SEASON_DAYS; d++) {
      for (const nuit of [false, true]) {
        sim.tick = tickDe(d, nuit)
        for (let t = 0; t < 4; t++) {
          step(sim, [{ entityId: joueur, dx: 1, dy: 0 }])
          drainEvents(sim)
        }
        if (estGele(sim, RIVIERE_X0, 5)) geleAuMoinsUneFois = true
      }
    }
    expect(geleAuMoinsUneFois).toBe(true) // sans ça, rien à garder
    expect(empreinte(sim.map)).toBe(avant)
  })

  it('`isWater` et `terrainAt` rendent la même chose gelé ou non — le gel ne RECLASSE rien (G3)', () => {
    const chaud = simGel()
    const froid = simGel()
    chaud.tick = tickDe(JOUR_ACTE[0], false)
    froid.tick = tickDe(JOUR_ACTE[2], true)
    expect(estGele(froid, RIVIERE_X0, 5)).toBe(true) // la prémisse

    for (let ty = 0; ty < froid.map.height; ty++) {
      for (let tx = 0; tx < froid.map.width; tx++) {
        expect(terrainAt(froid.map, tx, ty)).toBe(terrainAt(chaud.map, tx, ty))
        expect(isWater(terrainAt(froid.map, tx, ty))).toBe(isWater(terrainAt(chaud.map, tx, ty)))
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A3 — zéro tirage, zéro champ neuf
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A3 — zéro tirage sur le PRNG, zéro octet dans l’état', () => {
  it('les prédicats ne touchent NI `rngState` NI aucun champ', () => {
    const sim = simGel({ meteoActive: true })
    sim.tick = tickDe(JOUR_ACTE[2], true)
    const rngAvant = sim.rngState
    const clefsAvant = Object.keys(sim).sort()
    const avant = snapshot(sim)

    for (let i = 0; i < 500; i++) {
      estGele(sim, RIVIERE_X0, i % 20)
      neigeAuSol(sim, RIVIERE_X0, i % 20)
      feuillageDenude(sim, 5, i % 20)
      gelPossible(sim)
    }
    expect(sim.rngState).toBe(rngAvant)
    expect(Object.keys(sim).sort()).toEqual(clefsAvant)
    expect(snapshot(sim)).toBe(avant)
  })

  it('la passe de dégel est INERTE quand personne ne se tient sur de l’eau profonde', () => {
    const sim = simGel()
    sim.tick = tickDe(JOUR_ACTE[1], false)
    spawnEntity(sim, 5.5, 5.5)
    const avant = snapshot(sim)
    advanceDegel(sim)
    expect(snapshot(sim)).toBe(avant)
  })

  it('deux sims de même graine restent bit-identiques sur mille ticks, gel armé', () => {
    const jouer = (): SimState => {
      const sim = simGel({ meteoActive: true })
      const joueur = spawnEntity(sim, 5.5, 5.5)
      sim.tick = tickDe(JOUR_ACTE[2], true)
      for (let t = 0; t < 1000; t++) {
        step(sim, [{ entityId: joueur, dx: t % 3 === 0 ? 1 : 0, dy: t % 3 === 1 ? 1 : 0 }])
        drainEvents(sim)
      }
      return sim
    }
    expect(snapshot(jouer())).toBe(snapshot(jouer()))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A4 — les deux seuils mordent DANS L'ORDRE (balayage exhaustif du domaine)
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A4 — les deux seuils mordent DANS L’ORDRE', () => {
  it('SEUIL_PROFOND est strictement sous SEUIL_GUE, hystérésis comprise', () => {
    // La raison profonde pour laquelle l'ordre ne peut PAS s'inverser : même dans sa bande
    // morte, le lac est plus froid que le seuil nu du gué.
    expect(GEL.SEUIL_PROFOND).toBeLessThan(GEL.SEUIL_GUE)
    expect(GEL.SEUIL_PROFOND + GEL.HYSTERESIS).toBeLessThan(GEL.SEUIL_GUE)
  })

  it('sur TOUT le domaine atteignable : lac gelé ⇒ gué gelé, jamais l’inverse', () => {
    const sim = simGel({ meteoActive: true })
    // Deux tuiles d'eau CÔTE À CÔTE, donc au même froid à la tuile près : l'une profonde,
    // l'autre un gué. C'est le montage qui rend la comparaison honnête.
    const LAC = 4
    const GUE = 5
    let vuGueSeul = 0
    let vuLesDeux = 0
    let vuAucun = 0
    let echantillons = 0

    for (const jour of JOUR_ACTE) {
      for (const nuit of [false, true]) {
        // LES QUATRE CLASSES (R11) — `neige` et `blizzard` ne s'élisent plus : c'est le
        // FROID au point qui en décide, et le balayage acte × nuit ci-dessus les traverse.
        for (const type of ['brouillard', 'pluie', 'orage', 'vent_de_cendre'] as const) {
          sim.tick = tickDe(jour, nuit)
          const front = poserFront(sim, type, 0, sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2))
          void front
          // On balaie TOUTE la largeur de la carte au pas de la tuile : le point traverse la
          // bande, ses deux rampes et le ciel clair de part et d'autre — le domaine complet.
          for (let ty = 0; ty < sim.map.height; ty++) {
            const map = sim.map
            map.terrain[ty * map.width + LAC] = TERRAIN_DEEP_WATER
            map.terrain[ty * map.width + GUE] = TERRAIN_SHALLOW_WATER
          }
          for (let ty = 0; ty < sim.map.height; ty++) {
            const lac = estGele(sim, LAC, ty)
            const gue = estGele(sim, GUE, ty)
            echantillons += 1
            if (lac) expect(gue, `lac gelé sans gué gelé à ty=${ty}, T=${baselineTemperature(sim, LAC, ty)}`).toBe(true)
            if (lac && gue) vuLesDeux += 1
            else if (gue) vuGueSeul += 1
            else vuAucun += 1
          }
        }
      }
    }
    expect(echantillons).toBeGreaterThan(500)
    // Les trois régimes existent VRAIMENT : sinon l'implication serait vraie par vacuité.
    expect(vuAucun).toBeGreaterThan(0)
    expect(vuGueSeul).toBeGreaterThan(0)
    expect(vuLesDeux).toBeGreaterThan(0)
  })

  it('balayage FIN de la rampe d’un front : la loi tient à chaque pas d’intensité', () => {
    const sim = simGel({ meteoActive: true })
    sim.tick = tickDe(JOUR_ACTE[1], false) // acte II, jour : base 65
    poserFront(sim, 'orage', 0, sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2))
    const map = sim.map
    for (let tx = 0; tx < map.width; tx++) {
      map.terrain[3 * map.width + tx] = TERRAIN_DEEP_WATER
      map.terrain[4 * map.width + tx] = TERRAIN_SHALLOW_WATER
    }
    let temperaturesVues = 0
    for (let tx = 0; tx < map.width; tx++) {
      const t = baselineTemperature(sim, tx, 3)
      temperaturesVues += 1
      if (estGele(sim, tx, 3)) {
        expect(estGele(sim, tx, 4)).toBe(true) // l'ordre
        expect(t).toBeLessThan(GEL.SEUIL_PROFOND + GEL.HYSTERESIS) // jamais au-delà du dégel franc
      }
      if (t >= GEL.SEUIL_GUE + GEL.HYSTERESIS) expect(estGele(sim, tx, 4)).toBe(false)
      if (t < GEL.SEUIL_PROFOND) expect(estGele(sim, tx, 3)).toBe(true)
    }
    expect(temperaturesVues).toBe(map.width)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A5 — traversée : avatar ET horde, par la MÊME loi
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A5 — ce qui traverse, traverse pour tout le monde (G4)', () => {
  /** Le monde de collision d'un marcheur ordinaire. */
  const monde = (sim: SimState) => ({ map: sim.map, structures: sim.structures, nodes: sim.nodes, moverVillageId: null, etat: sim })

  it('l’avatar franchit la rivière gelée, et pas la rivière libre', () => {
    const sim = simGel()
    const joueur = spawnEntity(sim, RIVIERE_X0 - 1.5, 6.5)
    const marcher = (n: number): number => {
      for (let t = 0; t < n; t++) {
        step(sim, [{ entityId: joueur, dx: 1, dy: 0 }])
        drainEvents(sim)
      }
      return sim.entities.find((e) => e.id === joueur)!.x
    }

    sim.tick = tickDe(JOUR_ACTE[1], false) // acte II, jour : la rivière est libre
    const bloque = marcher(200)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)
    expect(bloque).toBeLessThan(RIVIERE_X0) // il bute sur la rive

    sim.tick = tickDe(JOUR_ACTE[2], true) // acte III, nuit : elle a pris
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(true)
    const passe = marcher(400)
    expect(passe).toBeGreaterThan(RIVIERE_X1) // il est de l'autre côté
  })

  it('l’A* et le champ de flux de la horde lisent la MÊME glace', () => {
    const sim = simGel()
    const depart = { tx: RIVIERE_X0 - 3, ty: 6 }
    const arrivee = { tx: RIVIERE_X1 + 3, ty: 6 }
    const clef = arrivee.ty * sim.map.width + arrivee.tx

    // Libre : la rivière coupe la carte du nord au sud — aucun chemin, aucun gradient.
    sim.tick = tickDe(JOUR_ACTE[1], false)
    expect(findPath(monde(sim), depart, arrivee, 8192)).toBeNull()
    expect(computeFlowField(sim.map, [], [], depart.tx, depart.ty, sim)[clef]).toBe(-1)

    // Gelée : les DEUX passent, et l'avatar aussi (garde du dessus). Une seule loi.
    sim.tick = tickDe(JOUR_ACTE[2], true)
    const chemin = findPath(monde(sim), depart, arrivee, 8192)
    expect(chemin).not.toBeNull()
    expect(chemin!.some((p) => p.tx >= RIVIERE_X0 && p.tx < RIVIERE_X1)).toBe(true) // il passe SUR la glace
    expect(computeFlowField(sim.map, [], [], depart.tx, depart.ty, sim)[clef]).toBeGreaterThan(0)
  })

  it('sans l’état, le monde est HORS DU TEMPS : la carte seule décide (worldgen, bancs)', () => {
    const sim = simGel()
    sim.tick = tickDe(JOUR_ACTE[2], true)
    const sansEtat = { map: sim.map, structures: sim.structures, nodes: sim.nodes, moverVillageId: null }
    const arrivee = { tx: RIVIERE_X1 + 3, ty: 6 }
    expect(findPath(sansEtat, { tx: RIVIERE_X0 - 3, ty: 6 }, arrivee, 8192)).toBeNull()
    expect(findPath(monde(sim), { tx: RIVIERE_X0 - 3, ty: 6 }, arrivee, 8192)).not.toBeNull()
  })

  it('on GLISSE sur la glace : le gué passe de 0,5 à VITESSE_GLACE', () => {
    const sim = simGel()
    expect(TERRAINS[TERRAIN_SHALLOW_WATER]!.speedFactor).toBe(0.5) // la prémisse
    sim.tick = tickDe(JOUR_ACTE[0], false)
    expect(vitesseSurGlace(sim, GUE_X, 5)).toBeUndefined()
    sim.tick = tickDe(JOUR_ACTE[2], true)
    expect(vitesseSurGlace(sim, GUE_X, 5)).toBe(GEL.VITESSE_GLACE)
    expect(vitesseSurGlace(sim, RIVIERE_X0, 5)).toBe(GEL.VITESSE_GLACE)
    expect(GEL.VITESSE_GLACE).toBeGreaterThan(1) // on glisse plus vite que sur l'herbe
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A6 — G3 tenu : l'eau reste de l'eau pour la faune
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A6 — un lac gelé reste un point d’eau (G3)', () => {
  it('les coins de chasse sont IDENTIQUES quelle que soit la saison — ils ne voient que la carte', () => {
    const map = carteDEssai(120, 80)
    const chaud = createSim(2026, { map, calendarScale: SCALE })
    const froid = createSim(2026, { map, calendarScale: SCALE })
    froid.tick = tickDe(JOUR_ACTE[2], true)
    expect(estGele(froid, RIVIERE_X0, 5)).toBe(true) // la prémisse : la vallée a bien gelé

    // `placeHuntingGrounds` ne prend QUE la carte — la garde est structurelle autant que
    // comportementale : le gel ne peut pas l'atteindre, et on le vérifie quand même.
    const a = placeHuntingGrounds(chaud.map, 2026)
    const b = placeHuntingGrounds(froid.map, 2026)
    expect(b).toEqual(a)
  })

  it('`isWater` ne bouge pas d’un bit — il n’y a qu’UNE définition de l’eau', () => {
    expect(isWater(TERRAIN_DEEP_WATER)).toBe(true)
    expect(isWater(TERRAIN_SHALLOW_WATER)).toBe(true)
    expect(isWater(TERRAIN_GRASS)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A7 — le Feu ne dégèle rien
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A7 — un Feu ne dégèle rien (G1)', () => {
  it('la glace sous un feu ardent est dans le même état qu’à dix tuiles', () => {
    const sim = simGel()
    sim.tick = tickDe(JOUR_ACTE[2], true)
    // Le feu se pose sur la RIVE, juste à côté de la rivière — dans son rayon de chaleur —
    // et il BRÛLE VRAIMENT : sans bûche, `fireWarmthFactor` rend 0 et la garde serait verte
    // pour la mauvaise raison (leçon « une garde prouve sa prémisse »).
    const feu = addStructure(sim, 'fire', RIVIERE_X0 - 1, 6, 0, 0)
    feu.fuel = [{ item: 'wood', count: 40 }]
    feu.burnAt = sim.tick

    const sousLeFeu = { tx: RIVIERE_X0, ty: 6 }
    const auLoin = { tx: RIVIERE_X0, ty: 6 + Math.ceil(TEMPERATURE.FIRE_RANGE) + 6 }

    // LA PRÉMISSE : le feu chauffe VRAIMENT ici, et pas là-bas. Sans elle, la garde serait
    // verte parce que le feu est éteint.
    expect(ambientTemperature(sim, sousLeFeu.tx, sousLeFeu.ty))
      .toBeGreaterThan(ambientTemperature(sim, auLoin.tx, auLoin.ty))

    // ET POURTANT : le gel lit la BASELINE, qui ignore le feu.
    expect(baselineTemperature(sim, sousLeFeu.tx, sousLeFeu.ty)).toBe(baselineTemperature(sim, auLoin.tx, auLoin.ty))
    expect(estGele(sim, sousLeFeu.tx, sousLeFeu.ty)).toBe(estGele(sim, auLoin.tx, auLoin.ty))
    expect(estGele(sim, sousLeFeu.tx, sousLeFeu.ty)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A8 — le blizzard gèle ce qu'il traverse, et dégèle en s'éloignant
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A8 — un blizzard gèle ce qu’il traverse', () => {
  it('avant, pendant, après : la glace suit la BANDE, pas le calendrier', () => {
    // ⚠ LA FENÊTRE D'UN FRONT DURE EXACTEMENT UNE PHASE DE JOUR (`TRAVERSEE_TICKS` =
    // `DAY_TICKS_PER_CYCLE`) : suivre une traversée entière à l'horloge, c'est TOUJOURS
    // traverser un crépuscule, et l'on mesurerait alors la nuit au lieu du front. On fige
    // donc le tick — acte III, plein jour, −2 °C — et l'on fait bouger LA BANDE : la même
    // question (« la bande couvre-t-elle ce point à ce tick ? »), sans variable parasite.
    //
    // POURQUOI L'ACTE III ET NON LE II (R11-R12) : un orage ne mord de `ORAGE_FROID.COLD` que
    // là où le monde est DÉJÀ sous la limite de neige — c'est le refroidissement éolien. En
    // acte II de jour (+8 °C) il ne retranche que `COLD.orage` : plus de blizzard à observer.
    // En acte III de jour (−2 °C) il sature, et le LAC bascule. Le GUÉ, lui, est pris par la
    // SAISON à cet acte (−2 < SEUIL_GUE = 0) : affirmé séparément — la marge se lit sur le lac.
    const sim = simGel({ meteoActive: true })
    const t = tickDe(JOUR_ACTE[2], false)
    sim.tick = t
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBe(-2) // le ciel clair de référence (ex-jauge 40)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)
    expect(estGele(sim, GUE_X, 6)).toBe(true) // le gué d'acte III est pris par la saison, pas par un front

    // AVANT l'entrée : la fenêtre s'ouvre plus tard, la bande est encore dehors.
    poserFront(sim, 'orage', 0, t + 5000)
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBe(-2)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)

    // PENDANT, au cœur de la fenêtre : le froid plein (−2 − ORAGE_FROID.COLD, borné à
    // AMBIANT_MIN → sous SEUIL_PROFOND).
    poserFront(sim, 'orage', 0, t - Math.floor(METEO.TRAVERSEE_TICKS / 2))
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBeLessThan(GEL.SEUIL_PROFOND)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(true)
    expect(estGele(sim, GUE_X, 6)).toBe(true)

    // APRÈS la sortie : la fenêtre est close, la vallée retrouve ses −2 — et rend le LAC.
    poserFront(sim, 'orage', 0, t - METEO.TRAVERSEE_TICKS - 5000)
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBe(-2)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)
  })

  it('un front gèle SA BANDE et rien d’autre — la glace suit la bande dans l’ESPACE', () => {
    /**
     * CE QUI A CHANGÉ AVEC R11-R13, ET POURQUOI LA CARTE EST SI LARGE.
     *
     * Avant, une bande de NEIGE (70 tuiles) discriminait sur une carte de 400. Elle ne le peut
     * plus, et c'est structurel : un front ne mord vraiment (`ORAGE_FROID.COLD`) que là où le
     * monde est DÉJÀ sous la limite de neige (0 °C) — or 0 est aussi le seuil du gué. Là où un
     * front pourrait faire basculer un gué, la saison l'a déjà pris ; et une pluie (COLD 4)
     * ne descend jamais un lac d'acte III (−2 − 4 = −6) sous son seuil (−10).
     *
     * Le seul contraste qui subsiste est celui de l'ORAGE : nuit d'acte II, la plaine est à −4
     * — le lac tient (−4 ≥ −10), et sous la bande il plonge. Mais un orage d'acte II fait
     * ~830 tuiles de large (R13) : pour qu'un « ailleurs » EXISTE, c'est la CARTE qu'il faut
     * agrandir, pas la bande qu'il faut rétrécir. On la prend à 2 000 — et l'on PROUVE au
     * montage que la bande n'y tient pas toute.
     */
    const LARGE = 2000
    const map = createEmptyMap(LARGE, 12, TERRAIN_GRASS)
    for (let tx = 0; tx < LARGE; tx++) setTile(map, tx, 5, TERRAIN_DEEP_WATER)
    const sim = simGel({ map, meteoActive: true })
    sim.tick = tickDe(JOUR_ACTE[1], true) // acte II, NUIT : la plaine est à −4 °C, le lac tient
    const front = poserFront(sim, 'orage', 0, sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2))
    expect(largeurDe(front)).toBeLessThan(LARGE) // la prémisse : il Y A un ailleurs

    let dedans = 0
    let dehors = 0
    for (let tx = 0; tx < LARGE; tx++) {
      if (estGele(sim, tx, 5)) dedans += 1
      else dehors += 1
    }
    expect(dedans).toBeGreaterThan(0)
    expect(dehors).toBeGreaterThan(0)
    // La bande est CONTIGUË : une seule zone gelée, pas un damier.
    let transitions = 0
    for (let tx = 1; tx < LARGE; tx++) if (estGele(sim, tx, 5) !== estGele(sim, tx - 1, 5)) transitions += 1
    expect(transitions).toBeLessThanOrEqual(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A9 / A13 — la feuillaison
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A9 / A13 — les feuillus se dénudent, les conifères tiennent (G6)', () => {
  function carteBoisee(): WorldMap {
    const map = createEmptyMap(40, 12, TERRAIN_GRASS)
    const bandes = [TERRAIN_FOREST, TERRAIN_WILLOW, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH]
    for (let i = 0; i < bandes.length; i++) {
      for (let tx = 0; tx < 40; tx++) setTile(map, tx, i + 1, bandes[i]!)
    }
    return map
  }

  it('les trois feuillus se dénudent, pine et larch JAMAIS — et le `cover` ne bouge pas', () => {
    const sim = simGel({ map: carteBoisee() })
    const coverAvant = [TERRAIN_FOREST, TERRAIN_WILLOW, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH]
      .map((t) => TERRAINS[t]!.cover)

    sim.tick = tickDe(1, false)
    for (let ty = 1; ty <= 5; ty++) expect(feuillageDenude(sim, 5, ty), `ty=${ty} au jour 1`).toBe(false)

    // Bien après la fenêtre de défeuillaison : les trois feuillus y sont TOUS passés.
    sim.tick = tickDe(GEL.JOUR_DEFEUILLAISON + GEL.DEFEUILLAISON_JOURS + 2, false)
    for (let ty = 1; ty <= 3; ty++) expect(feuillageDenude(sim, 5, ty), `feuillu ty=${ty}`).toBe(true)
    expect(feuillageDenude(sim, 5, 4)).toBe(false) // pine
    expect(feuillageDenude(sim, 5, 5)).toBe(false) // larch

    // ET LE FROID N'Y CHANGE RIEN — la feuillaison est une fonction du JOUR et de la TUILE,
    // jamais du thermomètre. On l'affirme par une ÉGALITÉ plutôt que par un cas : deux mondes
    // au même tick, l'un sous un blizzard qui mord, l'autre à ciel clair, doivent rendre le
    // MÊME verdict sur les cinq essences — dedans comme au dehors de la bande, et à trois
    // dates dont une AU MILIEU de la fenêtre de défeuillaison (là où un couplage se verrait).
    const clair = simGel({ map: carteBoisee(), meteoActive: true })
    const gele = simGel({ map: carteBoisee(), meteoActive: true })
    let mordu = 0
    for (const jour of [1, GEL.JOUR_DEFEUILLAISON + 3, JOUR_ACTE[2]]) {
      const tk = tickDe(jour, true)
      clair.tick = tk
      gele.tick = tk
      gele.meteo = null
      poserFront(gele, 'orage', 0, tk - Math.floor(METEO.TRAVERSEE_TICKS / 2))
      clair.meteo = null
      for (let ty = 1; ty <= 5; ty++) {
        for (const tx of [5, 20, 39]) {
          if (baselineTemperature(gele, tx, ty) < baselineTemperature(clair, tx, ty)) mordu++
          expect(feuillageDenude(gele, tx, ty), `jour ${jour}, essence ty=${ty}, tx=${tx}`)
            .toBe(feuillageDenude(clair, tx, ty))
        }
      }
    }
    expect(mordu).toBeGreaterThan(0) // la garde prouve sa prémisse : le front a bien mordu quelque part

    expect([TERRAIN_FOREST, TERRAIN_WILLOW, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH]
      .map((t) => TERRAINS[t]!.cover)).toEqual(coverAvant)
  })

  it('A13 — MONOTONE sur une saison jouée nuit et jour : jamais de retour au vert', () => {
    const sim = simGel({ map: carteBoisee(), meteoActive: true })
    const suivies = [[5, 1], [17, 1], [33, 2], [8, 3], [21, 3], [39, 4], [12, 5]] as const
    const dernier = new Map<string, boolean>()
    let bascules = 0
    for (let d = 1; d <= BALANCE.SEASON_DAYS; d++) {
      for (const nuit of [false, true]) {
        sim.tick = tickDe(d, nuit)
        for (const [tx, ty] of suivies) {
          const clef = `${tx},${ty}`
          const nu = feuillageDenude(sim, tx, ty)
          const avant = dernier.get(clef)
          if (avant !== undefined && avant !== nu) {
            expect(nu, `retour au vert en ${clef} au jour ${d}`).toBe(true) // false → true seulement
            bascules += 1
          }
          dernier.set(clef, nu)
        }
      }
    }
    expect(bascules).toBeGreaterThan(0) // la garde prouve sa prémisse : ça a bien basculé
  })

  it('la forêt se dépouille PROGRESSIVEMENT — pas toute le même matin', () => {
    const jours = new Set<number>()
    for (let tx = 0; tx < 60; tx++) for (let ty = 0; ty < 6; ty++) jours.add(Math.floor(jourDeDefeuillaison(tx, ty)))
    expect(jours.size).toBeGreaterThan(2)
    for (const j of jours) {
      expect(j).toBeGreaterThanOrEqual(GEL.JOUR_DEFEUILLAISON)
      expect(j).toBeLessThanOrEqual(GEL.JOUR_DEFEUILLAISON + GEL.DEFEUILLAISON_JOURS)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A10 — la neige au sol
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A10 — la neige tient après le front, puis fond (G7)', () => {
  /**
   * UN CYCLE QUI DÉPOSE VRAIMENT DE LA NEIGE — pas de front inventé ici : on veut prouver que
   * le rembobinage retrouve les VRAIES élections. Depuis R11 « neigeux » n'est plus une
   * propriété du TYPE : il faut que le front PRÉCIPITE (pluie ou orage) **et** que le monde
   * soit sous la limite de neige pendant sa traversée. `PREMIER_CYCLE_FROID` borne la
   * recherche à l'acte III, où la plaine est à 40 le jour et 10 la nuit — sous la limite (55)
   * à toute heure, donc toute précipitation y tombe en neige.
   */
  const sonde = simGel({ meteoActive: true })
  function estNeigeux(c: number, scale: number): boolean {
    const f = frontDuCycle(c, scale)
    if (!f || (f.type !== 'pluie' && f.type !== 'orage')) return false
    // …ET le monde sous la limite de neige d'un bout à l'autre de sa fenêtre : sinon la bande
    // dépose de l'EAU sur la moitié de sa traversée, et la couverture qu'on mesure ne serait
    // plus celle du front mais celle de l'heure. (La saison TOURNE — `actForDay` n'est pas
    // borné — donc un cycle lointain peut retomber sur une phase douce : c'est le froid qu'on
    // interroge, jamais le numéro d'acte.)
    return neigeA(dehorsSansMeteo(sonde, 4, 5, f.startTick)) && neigeA(dehorsSansMeteo(sonde, 4, 5, f.endTick))
  }

  /**
   * L'ISOLEMENT SE JUGE PLUS LARGE QUE LE DÉPÔT — et il le faut. Un cycle voisin qui précipite
   * SANS être froid à ses deux bouts peut tout de même enneiger la fin de sa traversée (il fait
   * nuit au milieu), et reposerait de la neige sur celle qu'on regarde fondre. On écarte donc
   * tout voisin qui PRÉCIPITE, froid ou non : la garde de décroissance mesure la fonte, jamais
   * le calendrier.
   */
  function precipite(c: number, scale: number): boolean {
    const f = frontDuCycle(c, scale)
    return f !== null && (f.type === 'pluie' || f.type === 'orage')
  }

  /**
   * Un cycle neigeux SUIVI d'assez de cycles SECS pour que la couverture ait le temps de
   * fondre sans qu'une nouvelle neige ne vienne la reposer. Sans cette condition, la garde
   * de décroissance mesurerait la MÉTÉO, pas la fonte — et rougirait pour rien.
   */
  function cycleNeigeuxIsole(scale: number, secsAutour: number): number | null {
    // La fenêtre de recherche est LARGE (l'année tourne : les saisons froides et douces
    // alternent, et un cycle neigeux ISOLÉ vit au bord d'une saison froide — il s'en présente
    // quelques-uns par an, pas un par acte).
    for (let c = GEL.MEMOIRE_CYCLES; c < 4000; c++) {
      if (!estNeigeux(c, scale)) continue
      let seul = true
      // APRÈS : personne ne repose de la neige pendant qu'on regarde celle-ci fondre.
      for (let k = 1; k <= secsAutour; k++) if (precipite(c + k, scale)) seul = false
      // AVANT : et personne n'en a laissé qui traînerait encore au moment où l'on part de 0.
      for (let k = 1; k <= GEL.MEMOIRE_CYCLES; k++) if (precipite(c - k, scale)) seul = false
      if (seul) return c
    }
    return null
  }
  const cycleNeigeux = (scale: number): number | null => cycleNeigeuxIsole(scale, 0)

  it('G7 — LA NEIGE NE REMONTE JAMAIS : monotone dans le temps, quoi que fasse le thermomètre', () => {
    // LA GARDE NÉE D'UN DÉFAUT MESURÉ. La vitesse de fonte dépend de la température, qui
    // varie d'heure en heure : tant qu'on appliquait la vitesse DE L'INSTANT à tout le temps
    // écoulé, la neige REMONTAIT au crépuscule — 0,709 le jour contre 0,842 la nuit, un saut
    // de 0,133 quand 1 200 ticks n'en déplacent que 0,007. Dix-neuf fois. Le crépuscule est
    // le pire cas exprès : c'est LÀ que la marche du thermomètre est la plus franche.
    const c = cycleNeigeuxIsole(SCALE, 2)
    expect(c).not.toBeNull()
    const front = frontDuCycle(c!, SCALE)!
    const sim = simGel({ meteoActive: true })
    // Le point au BOUT de la traversée, comme le test voisin : la bande l'a quitté tôt, il
    // reste de la neige à regarder fondre.
    const tx = front.edge === 0 || front.edge === 2 ? 2 : sim.map.width - 3
    const ty = 5
    const depart = front.endTick
    // On balaie DEUX cycles pleins au pas fin : le pas jour/nuit y passe deux fois.
    const PAS = Math.floor(TICKS_PER_CYCLE / 64)
    let precedent = Infinity
    let vue = 0
    for (let t = depart; t <= depart + 2 * TICKS_PER_CYCLE; t += PAS) {
      sim.tick = t
      const n = neigeAuSol(sim, tx, ty)
      expect(n, `remontée au tick ${t}`).toBeLessThanOrEqual(precedent + 1e-9) // JAMAIS une remontée
      precedent = n
      if (n > 0) vue++
    }
    expect(vue).toBeGreaterThan(0) // la prémisse : il y avait bien de la neige à voir fondre
  })

  it('nulle sans météo armée — même si le cycle aurait élu une neige', () => {
    const c = cycleNeigeux(SCALE)
    expect(c).not.toBeNull()
    const sim = simGel({ meteoActive: false })
    sim.tick = c! * TICKS_PER_CYCLE + METEO.TRAVERSEE_TICKS
    expect(neigeAuSol(sim, 5, 5)).toBe(0)
  })

  it('après le passage du front : la couverture existe, puis décroît', () => {
    // ⚠ ON NE CHOISIT PAS LA MÉTÉO : en acte III, un cycle sur deux élit une neige ou un
    // blizzard (`METEO.TYPES[2]`), si bien qu'une longue accalmie n'existe tout simplement
    // pas. On cherche donc le seul montage qui mesure la FONTE et non le calendrier : un
    // front neigeux précédé d'une mémoire vide (pour partir de zéro) et suivi de deux
    // cycles secs (pour voir décroître sans qu'on en repose).
    const c = cycleNeigeuxIsole(SCALE, 2)
    expect(c).not.toBeNull()
    const front = frontDuCycle(c!, SCALE)!
    const sim = simGel({ meteoActive: true })

    // Le point est choisi au bout de la traversée : la bande l'a quitté tôt, on a de la marge.
    const tx = front.edge === 0 || front.edge === 2 ? 2 : sim.map.width - 3
    const ty = 5

    sim.tick = front.startTick - 1
    expect(neigeAuSol(sim, tx, ty)).toBe(0) // rien n'est encore tombé

    sim.tick = front.endTick
    expect(neigeAuSol(sim, tx, ty)).toBeGreaterThan(0) // il en est tombé

    const releves: number[] = []
    for (let k = 0; k <= 2; k++) {
      sim.tick = front.endTick + k * TICKS_PER_CYCLE
      releves.push(neigeAuSol(sim, tx, ty))
    }
    // Décroissance STRICTE tant qu'il reste de la neige, et jamais de remontée une fois à
    // zéro : « 0 puis 0 » est une fin de fonte, pas un défaut — l'ancienne assertion butait
    // sur son propre plancher depuis que la fonte s'INTÈGRE (elle est plus rapide, et juste).
    for (let i = 1; i < releves.length; i++) {
      const avant = releves[i - 1]!
      const apres = releves[i]!
      if (avant > 0) expect(apres, `couverture au cycle +${i}`).toBeLessThan(avant)
      else expect(apres, `couverture au cycle +${i}`).toBe(0)
    }
    expect(releves[releves.length - 1]!).toBeLessThan(releves[0]!) // elle a bien fondu
    for (const v of releves) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1) // c'est une COUVERTURE, pas un compteur
    }
  })

  it('elle DISPARAÎT : une mémoire sans le moindre front neigeux rend exactement zéro', () => {
    // Une fenêtre de `MEMOIRE_CYCLES` cycles secs d'affilée — au-delà, la neige d'avant est
    // hors de portée du rembobinage, et la couverture est nulle AU BIT PRÈS.
    let sec: number | null = null
    for (let c = GEL.MEMOIRE_CYCLES; c < 400 && sec === null; c++) {
      let vide = true
      for (let k = 0; k < GEL.MEMOIRE_CYCLES; k++) if (estNeigeux(c - k, SCALE)) vide = false
      if (vide) sec = c
    }
    expect(sec).not.toBeNull()
    const sim = simGel({ meteoActive: true })
    sim.tick = sec! * TICKS_PER_CYCLE + Math.floor(TICKS_PER_CYCLE / 2)
    for (let tx = 0; tx < sim.map.width; tx += 7) expect(neigeAuSol(sim, tx, 5)).toBe(0)
  })

  it('elle est PURE : deux appels, même réponse, et l’état ne bouge pas', () => {
    const c = cycleNeigeux(SCALE)!
    const front = frontDuCycle(c, SCALE)!
    const sim = simGel({ meteoActive: true })
    sim.tick = front.endTick + 100
    const avant = snapshot(sim)
    const a = neigeAuSol(sim, 4, 5)
    expect(neigeAuSol(sim, 4, 5)).toBe(a)
    expect(snapshot(sim)).toBe(avant)
  })

  it('elle FOND plus vite au chaud qu’au froid — la fonte paie le temps ET la température', () => {
    const c = cycleNeigeux(SCALE)!
    const front = frontDuCycle(c, SCALE)!
    // Deux mondes identiques, à deux actes différents : le même front, deux fontes.
    const froid = simGel({ meteoActive: true })
    const chaud = simGel({ meteoActive: true })
    const ecart = Math.floor(TICKS_PER_CYCLE / 2)
    froid.tick = front.endTick + ecart
    chaud.tick = front.endTick + ecart
    // On force les températures par l'ACTE : `frontDuCycle` ne dépend que du cycle, pas de
    // `calendarScale`… si : on change donc la seule chose qui compte, le jour de saison vu.
    //
    // ON VISE L'ACTE, PAS UN MULTIPLICATEUR : « × 8 » tombait jadis « bien plus tard dans la
    // saison », donc en acte III pour toujours. Depuis que l'année tourne (saison-sans-fin T2 —
    // 84 jours, quatre actes), × 8 dépasse le jour 84 et atterrit AU PRINTEMPS DE L'AN 2, où il
    // fait doux : le montage mesurait un monde qui n'existe plus. On cherche donc le plus petit
    // facteur qui pose le même tick dans la Cendre (acte III) — et on l'AFFIRME.
    //
    // ⚠ LA RECHERCHE EST BORNÉE, et elle doit l'être : un `while` nu bouclait sans fin dès que
    // le tick de départ changeait d'ordre de grandeur — les facteurs ENTIERS enjambent alors
    // l'acte III d'un bond (un cycle tardif × un facteur entier saute d'un acte à l'autre).
    // On balaie donc un continuum FIN, et l'on AFFIRME qu'on a trouvé.
    // LES DEUX BOUTS SE CHOISISSENT, et c'est neuf : le cycle neigeux est désormais cherché
    // sur le FROID (il tombe donc lui-même dans une saison froide), si bien que laisser
    // `chaud` au calendrier nominal donnait DEUX mondes d'acte III — 40 contre 40, et la
    // garde comparait un monde à lui-même. On pose donc explicitement l'acte de chacun.
    // Balayage GÉOMÉTRIQUE : l'acte I d'un tick tardif demande un calendrier BEAUCOUP plus
    // lent (facteur ≪ 1), l'acte III un peu plus rapide — un pas additif partant de 1 ne
    // couvrirait jamais le premier.
    const calendrierPourActe = (tick: number, acte: number): number => {
      for (let f = 0.0005; f <= 500; f *= 1.002) {
        if (actForDay(seasonDayAtTick(tick, SCALE * f)) === acte) return SCALE * f
      }
      return 0
    }
    froid.calendarScale = calendrierPourActe(froid.tick, 3)
    chaud.calendarScale = calendrierPourActe(chaud.tick, 1)
    expect(froid.calendarScale, 'aucun calendrier ne place ce tick en acte III').toBeGreaterThan(0)
    expect(chaud.calendarScale, 'aucun calendrier ne place ce tick en acte I').toBeGreaterThan(0)
    expect(actForDay(seasonDayAtTick(froid.tick, froid.calendarScale))).toBe(3)
    expect(actForDay(seasonDayAtTick(chaud.tick, chaud.calendarScale))).toBe(1)
    expect(baselineTemperature(froid, 4, 5)).toBeLessThan(baselineTemperature(chaud, 4, 5))
    expect(neigeAuSol(froid, 4, 5)).toBeGreaterThanOrEqual(neigeAuSol(chaud, 4, 5))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A11 — l'hystérésis : zéro clignotement
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A11 — le dégel a de l’hystérésis, et la glace ne clignote pas (G8)', () => {
  it('BANDE MORTE : au-dessus du seuil mais sous seuil+HYSTERESIS, la glace TIENT', () => {
    /**
     * LE MONTAGE, ET POURQUOI IL EST COMME ÇA. Il faut un point dont la température MONTE
     * continûment à travers la bande morte du lac — donc la queue d'un front qui s'éloigne.
     * Trois contraintes se combinent :
     *  · un ORAGE sur un acte III de JOUR (40) : le monde y est sous la limite de neige, donc
     *    le refroidissement éolien SATURE (R12) et le front mord de 55 — T = 40 − 55 × intensité
     *    franchit `[20, 25)` pour une intensité dans `(0,27 ; 0,36]`, en pleine RAMPE. Une
     *    pluie (COLD 10) ne descend qu'à 30 et ne toucherait jamais la bande morte ;
     *  · une carte LARGE (400) : la rampe d'un orage d'acte III fait 240 tuiles, et c'est
     *    elle qu'on balaie — le cœur, lui, écrase tout à 0 ;
     *  · on n'observe QUE la phase de jour — `TRAVERSEE_TICKS` vaut exactement une phase, si
     *    bien qu'une fenêtre entière traverse toujours un crépuscule (on mesurerait la nuit).
     */
    const map = createEmptyMap(400, 12, TERRAIN_GRASS)
    for (let tx = 0; tx < 400; tx++) setTile(map, tx, 5, TERRAIN_DEEP_WATER)
    const sim = simGel({ map, meteoActive: true })
    const aube = (JOUR_ACTE[2] - 1) * TICKS_PER_CYCLE
    const front = poserFront(sim, 'orage', 0, aube)
    void front

    const POINT = 100
    let vuDecisif = 0
    let vuBandeMorte = 0
    // On saute les deux LISIÈRES du jour : depuis la rampe (`partDeNuit`), `NIGHT_COLD` y
    // monte et descend, et le froid cesse d'être monotone — la promesse de la note ci-dessus
    // (« on n'observe QUE la phase de jour ») veut le PLEIN jour, pas ses bords nocturnes.
    for (let t = aube + NIGHT_RAMP_TICKS + 200; t < aube + DAY_TICKS_PER_CYCLE - NIGHT_RAMP_TICKS - 200; t += 10) {
      sim.tick = t
      const temp = baselineTemperature(sim, POINT, 5)
      if (temp < GEL.SEUIL_PROFOND) {
        vuDecisif += 1
        expect(estGele(sim, POINT, 5)).toBe(true)
      } else if (vuDecisif > 0 && temp < GEL.SEUIL_PROFOND + GEL.HYSTERESIS) {
        // LE CŒUR DE LA GARDE : au-dessus du seuil, et pourtant gelée. Un seuil nu aurait
        // rendu la glace ici — c'est très exactement le clignotement que G8 interdit.
        vuBandeMorte += 1
        expect(temp).toBeGreaterThanOrEqual(GEL.SEUIL_PROFOND)
        expect(estGele(sim, POINT, 5), `bande morte à T=${temp}, tick ${t}`).toBe(true)
      }
    }
    expect(vuDecisif).toBeGreaterThan(0)
    expect(vuBandeMorte).toBeGreaterThan(0)
  })

  it('ZÉRO CLIGNOTEMENT : sur une traversée complète, l’état change au plus deux fois', () => {
    // Le domaine EXHAUSTIF de la traversée : chaque tick de la fenêtre, du premier au
    // dernier — la température monte puis descend, et la glace n'a droit qu'à un aller-retour.
    const sim = simGel({ meteoActive: true })
    const front = poserFront(sim, 'orage', 0, tickDe(JOUR_ACTE[1], false))
    for (const [tx, ty] of [[RIVIERE_X0, 6], [RIVIERE_X0 + 1, 2], [GUE_X, 9]] as const) {
      let bascules = 0
      let precedent: boolean | null = null
      for (let t = front.startTick - 200; t <= front.endTick + 200; t += 20) {
        sim.tick = t
        const gele = estGele(sim, tx, ty)
        if (precedent !== null && gele !== precedent) bascules += 1
        precedent = gele
      }
      expect(bascules, `bascules en ${tx},${ty}`).toBeLessThanOrEqual(2)
      expect(bascules).toBeGreaterThan(0) // la garde prouve sa prémisse
    }
  })

  it('la borne bon marché est CONSERVATRICE : `gelPossible` faux ⇒ rien n’est gelé', () => {
    const sim = simGel({ meteoActive: true })
    for (const jour of [1, 10, 21, 22, 30, 42, 43, 50, 60]) {
      for (const nuit of [false, true]) {
        for (const type of [null, 'pluie', 'orage', 'brouillard'] as const) {
          sim.tick = tickDe(jour, nuit)
          if (type === null) sim.meteo = null
          else poserFront(sim, type, 0, sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2))
          // Les régimes où le gel EST possible ne sont pas jugés ici — c'est la table de G2
          // et le balayage de A4 qui les couvrent. Ce `continue` ne cache donc rien : la
          // seule chose affirmée ici est l'implication « borne fausse ⇒ rien de gelé ».
          if (gelPossible(sim)) continue
          for (let ty = 0; ty < sim.map.height; ty += 3) {
            expect(estGele(sim, RIVIERE_X0, ty)).toBe(false)
            expect(estGele(sim, GUE_X, ty)).toBe(false)
          }
        }
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A12 — personne ne reste emmuré
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A12 — le dégel ne laisse personne emmuré (G8bis)', () => {
  const marchable = (sim: SimState, x: number, y: number): boolean => {
    const t = terrainAt(sim.map, Math.floor(x), Math.floor(y))
    return TERRAINS[t]?.walkable === true || estGele(sim, Math.floor(x), Math.floor(y))
  }

  it('avatar, PNJ et monstre pris au milieu du lac se retrouvent sur du marchable', () => {
    const sim = simGel()
    sim.tick = tickDe(JOUR_ACTE[2], true) // la rivière a pris
    const milieu = { x: RIVIERE_X0 + 1.5, y: 6.5 }
    expect(estGele(sim, RIVIERE_X0 + 1, 6)).toBe(true)

    const joueur = spawnEntity(sim, milieu.x, milieu.y)
    const bete = spawnMonster(sim, 'wolf', milieu.x, milieu.y + 1)
    const corps = [joueur, bete]

    // LE DÉGEL : le jour se lève sur l'acte III (40 ≥ SEUIL_PROFOND + HYSTERESIS).
    sim.tick = tickDe(JOUR_ACTE[2], false)
    expect(estGele(sim, RIVIERE_X0 + 1, 6)).toBe(false) // la prémisse : la glace a bien fondu
    step(sim, [])
    drainEvents(sim)

    for (const id of corps) {
      const e = sim.entities.find((x) => x.id === id)
      expect(e, `entité ${id}`).toBeDefined()
      expect(marchable(sim, e!.x, e!.y), `entité ${id} en ${e!.x},${e!.y}`).toBe(true)
    }
  })

  it('idem quand un front tiède efface le gel qu’un blizzard avait posé', () => {
    const sim = simGel({ meteoActive: true })
    sim.tick = tickDe(JOUR_ACTE[1], true) // acte II nuit : 35 — le lac ne prend PAS seul
    const front = poserFront(sim, 'orage', 0, sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2))
    expect(estGele(sim, RIVIERE_X0 + 1, 6)).toBe(true) // le blizzard l'a posé

    const joueur = spawnEntity(sim, RIVIERE_X0 + 1.5, 6.5)
    sim.meteo = null // le front s'éloigne : 35 > SEUIL_PROFOND + HYSTERESIS (25)
    void front
    expect(estGele(sim, RIVIERE_X0 + 1, 6)).toBe(false)
    step(sim, [])
    drainEvents(sim)

    const e = sim.entities.find((x) => x.id === joueur)!
    expect(marchable(sim, e.x, e.y)).toBe(true)
  })

  it('le repli qui FIRE ne consomme pas un pas de PRNG — A3 tient jusque dans la passe', () => {
    /**
     * A3 garde les prédicats et la passe INERTE ; celle-ci garde la passe qui MORD. C'est la
     * seule qui mute l'état, donc la seule d'où un replay pourrait diverger dans six mois —
     * et le repli est justement du genre de code qui se met un jour à « chercher une tuile au
     * hasard ». On compare deux mondes identiques au tick près : l'un avec quelqu'un sur la
     * glace qui fond, l'autre sans. Le flux seedé doit être le MÊME.
     */
    const monde = (surLaGlace: boolean): SimState => {
      const sim = simGel()
      sim.tick = tickDe(JOUR_ACTE[2], true)
      spawnEntity(sim, surLaGlace ? RIVIERE_X0 + 1.5 : 5.5, 6.5)
      sim.tick = tickDe(JOUR_ACTE[2], false) // le dégel
      step(sim, [])
      drainEvents(sim)
      return sim
    }
    const avec = monde(true)
    const sans = monde(false)
    // La prémisse : le repli a bien DÉPLACÉ quelqu'un — sans quoi on compare deux inertes.
    expect(avec.entities[0]!.x).not.toBe(RIVIERE_X0 + 1.5)
    expect(avec.rngState).toBe(sans.rngState)
  })

  it('la glace ne CÈDE pas : personne ne perd de PV à en sortir', () => {
    const sim = simGel()
    sim.tick = tickDe(JOUR_ACTE[2], true)
    const joueur = spawnEntity(sim, RIVIERE_X0 + 1.5, 6.5)
    const pvAvant = sim.entities.find((e) => e.id === joueur)!.hp
    sim.tick = tickDe(JOUR_ACTE[2], false)
    step(sim, [])
    drainEvents(sim)
    expect(sim.entities.find((e) => e.id === joueur)!.hp).toBe(pvAvant)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// LA BORNE DE LA FLORE — tendue à ZÉRO, et jusqu'ici gardée par RIEN
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('`climatMaximal` est CONSERVATRICE (la borne O(1) du gel de la flore)', () => {
  /**
   * `floreEntierementGelee` est un COURT-CIRCUIT DUR : vrai, `floreGelee` rend vrai sans même
   * lire la carte. Il commande la cueillette, la repousse et le semis — c'est-à-dire, en
   * acte III, l'économie entière.
   *
   * Or sa borne recopie la formule de `froidDuMonde` en majorant le biome, et la marge est
   * EXACTEMENT ZÉRO : sur une tuile de forêt sans front ni nappe, `climatMaximal` vaut très
   * précisément `climatFlore`. Le jour où quelqu'un ajoute un terme RÉCHAUFFANT au froid du
   * monde — un couvert, un retour de l'altitude, un `brumeColdAt` négatif — la borne devient
   * fausse en silence et le jeu déclare gelée la flore de TOUTE la vallée.
   *
   * Sa jumelle `gelPossible` porte un ⚠ ET une garde (« la borne bon marché est
   * CONSERVATRICE », plus haut dans ce fichier). Celle-ci n'avait ni l'un ni l'autre — et
   * l'asymétrie compte : une `gelPossible` fausse coûte de la perf, une
   * `floreEntierementGelee` fausse change le jeu.
   *
   * La garde est EXHAUSTIVE sur le domaine, pas sur des points choisis : tous les terrains
   * du registre × la saison × jour/nuit × les quatre régimes de météo × avec et sans nappe.
   */
  const PROBE_X = 5
  const PROBE_Y = 5

  /** Une nappe qui couvre la vallée entière : on ne teste pas la géométrie, on teste le TERME. */
  const nappePartout = (state: SimState): void => {
    state.brume = {
      phase: 'nappe',
      day: 1,
      riseTick: 0,
      retreatTick: Number.MAX_SAFE_INTEGER,
      x0: 0,
      y0: 0,
      x1: state.map.width - 1,
      y1: state.map.height - 1,
    }
  }

  it('F-borne — sur tout terrain, toute heure, toute météo, sous nappe ou non : maximal ≥ lieu', () => {
    const sim = simGel({ meteoActive: true })
    const terrains = Object.keys(TERRAINS).map(Number)
    expect(terrains.length, 'la garde doit d’abord VOIR le registre des terrains').toBeGreaterThan(20)

    const fautes: string[] = []
    for (const terrain of terrains) {
      setTile(sim.map, PROBE_X, PROBE_Y, terrain)
      for (const jour of [1, 21, 22, 42, 43, 60]) {
        for (const nuit of [false, true]) {
          for (const meteo of [null, 'pluie', 'orage', 'brouillard'] as const) {
            for (const brume of [false, true]) {
              sim.tick = tickDe(jour, nuit)
              if (meteo === null) sim.meteo = null
              else poserFront(sim, meteo, 0, sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2))
              if (brume) nappePartout(sim)
              else sim.brume = null
              const borne = climatMaximal(sim, sim.tick)
              const lieu = climatFlore(sim, PROBE_X, PROBE_Y, sim.tick)
              if (borne < lieu) {
                fautes.push(`terrain ${terrain} j${jour}${nuit ? ' nuit' : ''} ${meteo ?? 'clair'}${brume ? ' +brume' : ''} : borne ${borne} < lieu ${lieu}`)
              }
            }
          }
        }
      }
    }
    expect(fautes.slice(0, 5)).toEqual([])
    expect(fautes).toHaveLength(0)
  })

  it('F-borne-bis — et elle est bien TENDUE : il existe un cas où les deux se touchent', () => {
    // Sans ce second test, la garde ci-dessus passerait tout aussi bien sur une borne
    // grossièrement large — et on croirait avoir protégé quelque chose de fragile alors
    // qu'on protège quelque chose d'inutile. Le ⚠ de l'en-tête tient à CE fait : marge zéro.
    const sim = simGel({ meteoActive: true })
    setTile(sim.map, PROBE_X, PROBE_Y, 3) // forêt : le biome le plus doux (BIOME_MAX)
    sim.meteo = null
    sim.brume = null
    sim.tick = tickDe(1, false)
    expect(climatMaximal(sim, sim.tick)).toBe(climatFlore(sim, PROBE_X, PROBE_Y, sim.tick))
  })
})
