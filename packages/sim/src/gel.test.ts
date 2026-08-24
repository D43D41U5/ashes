/**
 * LE GEL (spec `gel.md`) — les critères A1 à A13, un `describe` par critère (plus A17 de
 * `saisons.md`, qui a repris à sa charge la feuillaison quand l'année s'est mise à tourner).
 *
 * Le calendrier est couplé 1 jour de saison = 1 cycle (`calendarScaleForSeasonCycles`,
 * patron `meteo.test.ts`) : le tick dit à la fois la SAISON et l'HEURE, et c'est tout ce dont
 * le gel a besoin. Les fronts sont FABRIQUÉS à la main quand la garde a besoin d'un froid
 * précis — le record de `state.meteo` est de la donnée plate, et sa géométrie est une
 * fonction pure du tick : on peut donc poser exactement le froid qu'on veut mesurer, au lieu
 * d'attendre qu'une saison veuille bien en tirer un.
 *
 * ═══ L'ANNÉE TOURNE (spec `saisons.md`, 2026-08-23) ═══
 *
 * Les trois actes en escalier ont laissé la place à quatre SAISONS de trente jours et à une
 * COURBE continue de température. Les jours-témoins ne sont donc plus « le milieu de l'acte
 * n » mais le CŒUR de chaque saison, et ils se dérivent d'`ACT_DAYS` — les jours écrits en
 * dur du calendrier d'avant auraient désigné, sous la nouvelle cadence, tout autre chose.
 * Les trois régimes de froid que le gel traverse sont : l'Ardeur (rien ne gèle), les Pluies
 * (les gués prennent la nuit), le Grand Froid (la vallée s'ouvre).
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE, GEL, TEMPERATURE, TERRAINS,
  TERRAIN_DEEP_WATER, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_SHALLOW_WATER, TERRAIN_SNOW, TERRAIN_WILLOW,
  YEAR_DAYS,
} from './balance'
import { drainEvents } from './events'
import { placeHuntingGrounds } from './faune'
import {
  advanceDegel, bandeDuCycle, estGele, feuillageDenude, gelPossible, jourDeDefeuillaison,
  jourDeRefeuillaison, neigeAuSol, vitesseSurGlace,
} from './gel'
import { createEmptyMap, isBlockingTile, isWater, MARCHABLE, setTile, terrainAt, type WorldMap } from './map'
import { modificateurDeSaison } from './modificateur'
import { fenetreDe, frontDuCycle, largeurDe, neigeA, type MeteoFront } from './meteo'
import { spawnMonster } from './monsters'
import { computeFlowField, findPath } from './pathfinding'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import {
  ambientTemperature, baselineTemperature, climatFlore, climatMaximal, dehorsSansMeteo, socleDuJour,
} from './temperature'
import {
  calendarScaleForSeasonCycles, dayTicksPourJour, gameTimeAt, jourDeSaison, NIGHT_RAMP_TICKS,
  phaseForDay, TICKS_PER_CYCLE, tourForDay,
} from './time'
import { addStructure } from './village'

/** 1 jour de saison = 1 cycle : le tick porte la saison ET l'heure. */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

/** Le tick d'un jour de saison, de jour ou en pleine nuit. La LONGUEUR DU JOUR est
 *  saisonnière depuis S6 (`dayTicksPourJour`) : le crépuscule bouge avec l'année, et un
 *  montage qui le figerait mesurerait la nuit là où il croit voir le jour. */
function tickDe(jour: number, nuit = false): number {
  const base = (jour - 1) * TICKS_PER_CYCLE
  const jourTicks = dayTicksPourJour(jour)
  // Au CŒUR de la phase, jamais à sa frontière : l'hystérésis relit `RETARD_TICKS` en
  // arrière, et une pose au ras de l'aube lirait la nuit d'avant (ou l'inverse).
  return base + (nuit ? jourTicks + Math.floor((TICKS_PER_CYCLE - jourTicks) / 2) : Math.floor(jourTicks / 2))
}

/** Le cœur d'une saison, DÉRIVÉ de la cadence des actes — 15 / 45 / 75 / 105 aujourd'hui. */
const coeurDe = (phase: number): number => Math.round((phase - 0.5) * BALANCE.ACT_DAYS)
/** Les quatre jours-témoins. `ARDEUR` est le plus chaud de l'année, `GRAND_FROID` le plus froid. */
const ECLOSION = coeurDe(1)
const ARDEUR = coeurDe(2)
const PLUIES = coeurDe(3)
const GRAND_FROID = coeurDe(4)
/** Les trois régimes que le gel traverse, du plus doux au plus dur — l'ordre compte. */
const JOUR_SAISON = [ARDEUR, PLUIES, GRAND_FROID] as const
/** L'aube du cycle d'un jour de saison (le calendrier est couplé : 1 jour = 1 cycle). */
const aubeDe = (jour: number): number => (jour - 1) * TICKS_PER_CYCLE

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

/**
 * Pose un front FABRIQUÉ. LE JOUR SE DÉRIVE DU TICK D'ENTRÉE : c'est `front.day` qui porte la
 * SAISON, donc la largeur de la bande ET la durée de sa fenêtre (S7-S8 : les deux sont
 * saisonnières, `largeurDe`/`fenetreDe` en sont les seuls écrivains). Un front daté d'un jour
 * mais joué à un autre aurait la bande de l'un et le froid de l'autre — le test mesurerait
 * alors son propre montage.
 *
 * ⚠ La fenêtre se LIT (`fenetreDe`), elle ne se pose pas : une durée écrite à la main ferait
 * traverser la carte à une bande d'automne en une demi-journée, et la géométrie qu'on mesure
 * ne serait plus celle du jeu.
 */
function poserFront(state: SimState, type: MeteoFront['type'], edge: MeteoFront['edge'], startTick: number): MeteoFront {
  const cycle = Math.floor(startTick / TICKS_PER_CYCLE)
  const day = jourDeSaison(state, startTick)
  const front: MeteoFront = { type, cycle, day, edge, startTick, endTick: startTick + fenetreDe({ type, day }) }
  state.meteo = front
  return front
}

/** Le même front, calé pour que `state.tick` tombe au CŒUR de sa fenêtre — là où la bande
 *  couvre la carte et où le froid du front est plein. */
function frontSurLeTick(state: SimState, type: MeteoFront['type'], edge: MeteoFront['edge']): MeteoFront {
  const fenetre = fenetreDe({ type, day: jourDeSaison(state, state.tick) })
  return poserFront(state, type, edge, state.tick - Math.floor(fenetre / 2))
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// LA PROMESSE G2 — la table, avant tout le reste
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('G2 — deux seuils, deux promesses (la table des six régimes)', () => {
  /**
   * C'EST LA GARDE QUI PROTÈGE LE CALIBRAGE. Les seuils ont été calculés contre cette table
   * exacte (voir l'en-tête du bloc `GEL`) : si quelqu'un retouche la courbe `SOCLE` ou
   * `ECART_NUIT`, c'est ICI que ça doit rougir — pas six mois plus tard dans un playtest.
   *
   * ⚠ **LES SIX RÉGIMES SE LISENT SUR LA COURBE, plus sur une table par acte** (spec
   * `saisons.md` S4-S5). Le point de mesure n'est donc plus « l'acte n » mais le CŒUR d'une
   * saison, là où la courbe est à son extrême et où deux jours voisins disent la même chose.
   */
  const attendu: { jour: number; nuit: boolean; t: number; gue: boolean; lac: boolean }[] = [
    // ⚠ EN DEGRÉS CELSIUS. Les littéraux SONT le calibrage — ils restent écrits, sinon la
    // garde ne garde plus rien —, et chacun vaut `SOCLE(jour, tour) − ECART_NUIT(jour) × nuit`
    // (biome 0 : l'eau n'a pas d'entrée dans `BIOME_OFFSET`).
    { jour: ARDEUR, nuit: false, t: 26, gue: false, lac: false }, // l'Ardeur, jour : le sommet de l'année
    { jour: ARDEUR, nuit: true, t: 20, gue: false, lac: false }, // l'Ardeur, nuit : RIEN ne gèle, pas un flocon
    { jour: PLUIES, nuit: false, t: 8, gue: false, lac: false }, // les Pluies, jour : l'eau tient encore
    { jour: PLUIES, nuit: true, t: -2, gue: true, lac: false }, // les Pluies, NUIT : les gués prennent
    { jour: GRAND_FROID, nuit: false, t: -2, gue: true, lac: false }, // le Grand Froid, jour
    { jour: GRAND_FROID, nuit: true, t: -16, gue: true, lac: true }, // le Grand Froid, NUIT : la vallée s'ouvre
  ]

  it('LA PRÉMISSE DE TOUT LE FICHIER : les trois saisons-témoins n’ont aucun caractère à l’an 1', () => {
    /**
     * Chaque littéral de température de ce fichier — la table ci-dessous, le −2 °C d'A8, la
     * bande morte d'A11, la marge de l'Ardeur — lit `socleDuJour`, et `socleDuJour` applique
     * le CARACTÈRE DE LA SAISON (S18) : `T.SOCLE(jour + socleJours, tour) + socleDegres`. Un
     * Été pourri (−4 °C) ou des Gelées tardives (−15 jours) déplaceraient tous ces nombres
     * d'un coup, et le fichier rougirait sans dire pourquoi. On l'affirme donc une fois, ici.
     *
     * L'Éclosion, elle, tire bien un caractère à l'an 1 — la Crue. Elle ne touche PAS la
     * courbe (S10 : c'est le niveau d'EAU qu'elle pousse), donc `ECLOSION` reste un témoin
     * honnête pour les balayages qui l'emploient.
     */
    for (const phase of [2, 3, 4]) {
      expect(modificateurDeSaison(1, phase), `phase ${phase} à l'an 1`).toBeNull()
    }
    for (const jour of [ARDEUR, PLUIES, GRAND_FROID]) {
      expect(socleDuJour(jour, tourForDay(jour))).toBe(TEMPERATURE.SOCLE(jour, tourForDay(jour)))
    }
  })

  it('la température de chaque régime est bien celle du calcul, et les seuils y mordent comme promis', () => {
    const sim = simGel()
    for (const cas of attendu) {
      sim.tick = tickDe(cas.jour, cas.nuit)
      const nom = `jour ${cas.jour} (phase ${phaseForDay(cas.jour)}) ${cas.nuit ? 'nuit' : 'jour'}`
      // LA PRÉMISSE DE LA TABLE : le littéral est bien la courbe, pas un nombre recopié.
      const parLaCourbe = socleDuJour(cas.jour, tourForDay(cas.jour))
        - (cas.nuit ? TEMPERATURE.ECART_NUIT(cas.jour) : 0)
      expect(cas.t, `la table dit ${nom}`).toBe(parLaCourbe)
      expect(baselineTemperature(sim, GUE_X, 5), `température ${nom}`).toBe(cas.t)
      expect(estGele(sim, GUE_X, 5), `gué ${nom}`).toBe(cas.gue)
      expect(estGele(sim, RIVIERE_X0, 5), `lac ${nom}`).toBe(cas.lac)
    }
  })

  it("l'Ardeur ne gèle JAMAIS, pas une nuit, pas sous l'averse — la marge de calibrage est réelle", () => {
    // A3 le promet (« l'Ardeur ne voit pas un flocon ») : on balaie donc la saison ENTIÈRE,
    // pas son seul cœur — c'est aux BORDS que la courbe s'approche du seuil.
    const sim = simGel({ meteoActive: true })
    let vu = 0
    let mordu = 0
    for (let jour = BALANCE.ACT_DAYS + 1; jour <= 2 * BALANCE.ACT_DAYS; jour++) {
      for (const nuit of [false, true]) {
        for (const type of ['pluie', 'orage', 'brouillard'] as const) {
          sim.tick = tickDe(jour, nuit)
          sim.meteo = null
          const clair = baselineTemperature(sim, GUE_X, 5)
          frontSurLeTick(sim, type, 0)
          const sousLeFront = baselineTemperature(sim, GUE_X, 5)
          if (sousLeFront < clair) mordu++ // la prémisse : le front couvre bien le point
          // +2 °C au-dessus du dégel franc du gué : la marge est ÉCRITE, pas dérivée du seuil
          // qu'elle protège — sinon déplacer `SEUIL_GUE` déplacerait la garde avec lui.
          expect(sousLeFront, `jour ${jour} ${nuit ? 'nuit' : 'jour'} ${type}`).toBeGreaterThanOrEqual(4)
          expect(estGele(sim, GUE_X, 5)).toBe(false)
          expect(estGele(sim, RIVIERE_X0, 5)).toBe(false)
          vu++
        }
      }
    }
    expect(vu).toBe(BALANCE.ACT_DAYS * 2 * 3)
    // Les deux tiers des passes portent un front FROID (pluie, orage) : il a mordu partout.
    expect(mordu).toBe(BALANCE.ACT_DAYS * 2 * 2)
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
    sim.tick = tickDe(GRAND_FROID, true)
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
// A2 — la carte reste immuable, gel actif, sur une ANNÉE entière
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

  it('une année entière jouée nuit et jour ne réécrit pas une tuile', () => {
    const sim = simGel({ meteoActive: true })
    const joueur = spawnEntity(sim, 5.5, 5.5)
    const avant = empreinte(sim.map)

    // On PARCOURT L'ANNÉE, pas une demi-saison : depuis que l'année boucle (S1), le lac ne
    // prend qu'au Grand Froid — un balayage borné à `SEASON_DAYS` s'arrêterait à l'Ardeur et
    // ne verrait pas une seule glace. Chaque jour, un peu de jour et un peu de nuit, et le
    // joueur marche vers la rivière (donc il finit par la traverser quand elle prend).
    let geleAuMoinsUneFois = false
    for (let d = 1; d <= YEAR_DAYS; d++) {
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
    chaud.tick = tickDe(ARDEUR, false)
    froid.tick = tickDe(GRAND_FROID, true)
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
    sim.tick = tickDe(GRAND_FROID, true)
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
    sim.tick = tickDe(PLUIES, false)
    spawnEntity(sim, 5.5, 5.5)
    const avant = snapshot(sim)
    advanceDegel(sim)
    expect(snapshot(sim)).toBe(avant)
  })

  it('deux sims de même graine restent bit-identiques sur mille ticks, gel armé', () => {
    const jouer = (): SimState => {
      const sim = simGel({ meteoActive: true })
      const joueur = spawnEntity(sim, 5.5, 5.5)
      sim.tick = tickDe(GRAND_FROID, true)
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

    for (const jour of [ECLOSION, ...JOUR_SAISON]) {
      for (const nuit of [false, true]) {
        // LES QUATRE CLASSES (R11) — `neige` et `blizzard` ne s'élisent plus : c'est le
        // FROID au point qui en décide, et le balayage saison × nuit ci-dessus les traverse.
        for (const type of ['brouillard', 'pluie', 'orage', 'vent_de_cendre'] as const) {
          sim.tick = tickDe(jour, nuit)
          const front = frontSurLeTick(sim, type, 0)
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
    /**
     * DEUX SAISONS, ET IL EN FAUT DEUX. La rampe d'un orage ne balaie plus les mêmes
     * températures selon la saison où il tombe (S7 : la géométrie est saisonnière, et R12
     * fait mordre l'orage à proportion du froid qu'il TROUVE) :
     *  · aux Pluies de jour (+8 °C), l'orage est une pluie violente — il retranche 4 °C au
     *    plus, et c'est la promesse « au-dessus du dégel franc, le gué rend la main » qui se
     *    vérifie sur toute la largeur ;
     *  · au Grand Froid de jour (−2 °C), il sature (22 °C) — la rampe traverse alors le seuil
     *    du lac, et ce sont les deux autres implications qui mordent.
     * La carte est LARGE (2 000) parce que les bandes le sont devenues : sur 60 tuiles, le
     * cœur du front écrase tout et il n'y a plus de rampe à balayer.
     */
    const LARGE = 2000
    let vuGueRendu = 0
    let vuLacGele = 0
    let vuSousLeSeuil = 0
    for (const jour of [PLUIES, GRAND_FROID]) {
      const sim = simGel({ map: carteDEssai(LARGE, 12), meteoActive: true })
      sim.tick = tickDe(jour, false)
      frontSurLeTick(sim, 'orage', 0)
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
          vuLacGele += 1
        }
        if (t >= GEL.SEUIL_GUE + GEL.HYSTERESIS) {
          expect(estGele(sim, tx, 4)).toBe(false)
          vuGueRendu += 1
        }
        if (t < GEL.SEUIL_PROFOND) {
          expect(estGele(sim, tx, 3)).toBe(true)
          vuSousLeSeuil += 1
        }
      }
      expect(temperaturesVues).toBe(map.width)
    }
    // LES TROIS IMPLICATIONS ONT MORDU — sans quoi le balayage serait vrai par vacuité.
    expect(vuGueRendu).toBeGreaterThan(0)
    expect(vuLacGele).toBeGreaterThan(0)
    expect(vuSousLeSeuil).toBeGreaterThan(0)
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

    sim.tick = tickDe(PLUIES, false) // les Pluies, jour (+8 °C) : la rivière est libre
    const bloque = marcher(200)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)
    expect(bloque).toBeLessThan(RIVIERE_X0) // il bute sur la rive

    sim.tick = tickDe(GRAND_FROID, true) // le Grand Froid, nuit (−16 °C) : elle a pris
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
    sim.tick = tickDe(PLUIES, false)
    expect(findPath(monde(sim), depart, arrivee, 8192)).toBeNull()
    expect(computeFlowField(sim.map, [], [], depart.tx, depart.ty, sim)[clef]).toBe(-1)

    // Gelée : les DEUX passent, et l'avatar aussi (garde du dessus). Une seule loi.
    sim.tick = tickDe(GRAND_FROID, true)
    const chemin = findPath(monde(sim), depart, arrivee, 8192)
    expect(chemin).not.toBeNull()
    expect(chemin!.some((p) => p.tx >= RIVIERE_X0 && p.tx < RIVIERE_X1)).toBe(true) // il passe SUR la glace
    expect(computeFlowField(sim.map, [], [], depart.tx, depart.ty, sim)[clef]).toBeGreaterThan(0)
  })

  it('sans l’état, le monde est HORS DU TEMPS : la carte seule décide (worldgen, bancs)', () => {
    const sim = simGel()
    sim.tick = tickDe(GRAND_FROID, true)
    const sansEtat = { map: sim.map, structures: sim.structures, nodes: sim.nodes, moverVillageId: null }
    const arrivee = { tx: RIVIERE_X1 + 3, ty: 6 }
    expect(findPath(sansEtat, { tx: RIVIERE_X0 - 3, ty: 6 }, arrivee, 8192)).toBeNull()
    expect(findPath(monde(sim), { tx: RIVIERE_X0 - 3, ty: 6 }, arrivee, 8192)).not.toBeNull()
  })

  it('on GLISSE sur la glace : le gué passe de 0,5 à VITESSE_GLACE', () => {
    const sim = simGel()
    expect(TERRAINS[TERRAIN_SHALLOW_WATER]!.speedFactor).toBe(0.5) // la prémisse
    sim.tick = tickDe(ARDEUR, false)
    expect(vitesseSurGlace(sim, GUE_X, 5)).toBeUndefined()
    sim.tick = tickDe(GRAND_FROID, true)
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
    froid.tick = tickDe(GRAND_FROID, true)
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
    sim.tick = tickDe(GRAND_FROID, true)
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
    // ⚠ LA FENÊTRE D'UN FRONT DÉBORDE LA PHASE DE JOUR (S8 : elle vaut les trois quarts du
    // cycle au Grand Froid, le cycle ENTIER aux Pluies) : suivre une traversée à l'horloge,
    // c'est TOUJOURS traverser un crépuscule, et l'on mesurerait alors la nuit au lieu du
    // front. On fige donc le tick — Grand Froid, plein jour, −2 °C — et l'on fait bouger LA
    // BANDE : la même question (« la bande couvre-t-elle ce point à ce tick ? »), sans
    // variable parasite.
    //
    // POURQUOI LE GRAND FROID ET NON LES PLUIES (R11-R12) : un orage ne mord de
    // `ORAGE_FROID.COLD` que là où le monde est DÉJÀ sous la limite de neige — c'est le
    // refroidissement éolien. Aux Pluies de jour (+8 °C) il ne retranche que `COLD.orage` :
    // plus de blizzard à observer. Au Grand Froid de jour (−2 °C) il sature, et le LAC
    // bascule. Le GUÉ, lui, est pris par la SAISON à cette date (−2 < SEUIL_GUE = 0) :
    // affirmé séparément — la marge se lit sur le lac.
    const sim = simGel({ meteoActive: true })
    const t = tickDe(GRAND_FROID, false)
    const fenetre = fenetreDe({ type: 'orage', day: GRAND_FROID })
    sim.tick = t
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBe(-2) // le ciel clair de référence
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)
    expect(estGele(sim, GUE_X, 6)).toBe(true) // le gué du Grand Froid est pris par la SAISON, pas par un front

    // AVANT l'entrée : la fenêtre s'ouvre plus tard, la bande est encore dehors.
    poserFront(sim, 'orage', 0, t + 5000)
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBe(-2)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)

    // PENDANT, au cœur de la fenêtre : le froid plein (−2 − ORAGE_FROID.COLD, borné à
    // AMBIANT_MIN → sous SEUIL_PROFOND).
    poserFront(sim, 'orage', 0, t - Math.floor(fenetre / 2))
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBeLessThan(GEL.SEUIL_PROFOND)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(true)
    expect(estGele(sim, GUE_X, 6)).toBe(true)

    // APRÈS la sortie : la fenêtre est close, la vallée retrouve ses −2 — et rend le LAC.
    poserFront(sim, 'orage', 0, t - fenetre - 5000)
    expect(baselineTemperature(sim, RIVIERE_X0, 6)).toBe(-2)
    expect(estGele(sim, RIVIERE_X0, 6)).toBe(false)
  })

  it('un front gèle SA BANDE et rien d’autre — la glace suit la bande dans l’ESPACE', () => {
    /**
     * POURQUOI LA CARTE EST SI LARGE.
     *
     * Avant, une bande de NEIGE (70 tuiles) discriminait sur une carte de 400. Elle ne le peut
     * plus, et c'est structurel : un front ne mord vraiment (`ORAGE_FROID.COLD`) que là où le
     * monde est DÉJÀ sous la limite de neige (0 °C) — or 0 est aussi le seuil du gué. Là où un
     * front pourrait faire basculer un gué, la saison l'a déjà pris ; et une pluie (COLD 4)
     * ne descend jamais un lac du Grand Froid (−2 − 4 = −6) sous son seuil (−10).
     *
     * Le seul contraste qui subsiste est celui de l'ORAGE : au Grand Froid DE JOUR, la plaine
     * est à −2 — le lac tient (−2 ≥ −10), et sous la bande il plonge (−24, borné à
     * AMBIANT_MIN). Mais la géométrie est saisonnière depuis S7 et l'orage d'hiver fait
     * 1 600 tuiles : pour qu'un « ailleurs » EXISTE, c'est la CARTE qu'il faut agrandir, pas
     * la bande qu'il faut rétrécir. On la prend à 2 000 — et l'on PROUVE au montage que la
     * bande n'y tient pas toute.
     */
    const LARGE = 2000
    const map = createEmptyMap(LARGE, 12, TERRAIN_GRASS)
    for (let tx = 0; tx < LARGE; tx++) setTile(map, tx, 5, TERRAIN_DEEP_WATER)
    const sim = simGel({ map, meteoActive: true })
    sim.tick = tickDe(GRAND_FROID, false) // le Grand Froid, JOUR : la plaine est à −2 °C, le lac tient
    const front = frontSurLeTick(sim, 'orage', 0)
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

describe('A9 / A13 / A17 — les feuillus se dénudent, REVERDISSENT, les conifères tiennent (G6)', () => {
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

    // AU CŒUR DE L'ARDEUR la forêt est pleine — et ce n'est plus « au jour 1 » : depuis S14 la
    // fenêtre nue ENJAMBE LE TOUR DE L'AN (fin des Pluies → printemps), donc le premier jour de
    // l'année est un jour d'arbres nus, pas de bourgeons.
    sim.tick = tickDe(ARDEUR, false)
    for (let ty = 1; ty <= 5; ty++) expect(feuillageDenude(sim, 5, ty), `ty=${ty} à l'Ardeur`).toBe(false)

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
    for (const jour of [ARDEUR, GEL.JOUR_DEFEUILLAISON + 3, GRAND_FROID]) {
      const tk = tickDe(jour, true)
      clair.tick = tk
      gele.tick = tk
      gele.meteo = null
      frontSurLeTick(gele, 'orage', 0)
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

  it('A17 — DEUX BASCULES PAR AN, jamais plus : la forêt se dépouille et reverdit, sur trois ans', () => {
    /**
     * ⚠ CE QUE CETTE GARDE PROMETTAIT, ET CE QU'ELLE PROMET MAINTENANT (spec `saisons.md`
     * S14). Elle affirmait la MONOTONIE — « une feuille qui tombe ne remonte pas » —, ce qui
     * était vrai d'un arc à sens unique et FAUX sous une année qui boucle : la forêt serait
     * restée nue à partir du jour 83, an 2, an 5, an 10. Ce qui reste vrai, et qui est la vraie
     * promesse, c'est qu'un feuillu ne change d'état que DEUX FOIS PAR AN — nu à la fin des
     * Pluies, vert à l'Éclosion — et **jamais deux fois dans un même cycle** : c'est le
     * clignotement que `feuillageDenude` documente avoir refusé en se keyant sur le jour et
     * non sur le thermomètre.
     */
    const sim = simGel({ map: carteBoisee(), meteoActive: true })
    const suivies = [[5, 1], [17, 1], [33, 2], [8, 3], [21, 3], [39, 4], [12, 5]] as const
    const ANS = 3
    const bascules = new Map<string, number>()
    const dernier = new Map<string, boolean>()
    for (let d = 1; d <= ANS * YEAR_DAYS; d++) {
      for (const nuit of [false, true]) {
        sim.tick = tickDe(d, nuit)
        for (const [tx, ty] of suivies) {
          const clef = `${tx},${ty}`
          const nu = feuillageDenude(sim, tx, ty)
          const avant = dernier.get(clef)
          // JAMAIS DEUX FOIS DANS UN MÊME CYCLE : l'état du soir est celui du matin.
          if (nuit && avant !== undefined) {
            expect(nu, `clignotement en ${clef} au jour ${d}`).toBe(avant)
          }
          if (avant !== undefined && avant !== nu) bascules.set(clef, (bascules.get(clef) ?? 0) + 1)
          dernier.set(clef, nu)
        }
      }
    }
    for (const [tx, ty] of suivies) {
      const clef = `${tx},${ty}`
      const caduc = [TERRAIN_FOREST, TERRAIN_WILLOW, TERRAIN_OLD_GROWTH].includes(terrainAt(sim.map, tx, ty))
      // Un feuillu bascule deux fois l'an (nu, puis vert) ; un conifère ne bascule jamais.
      expect(bascules.get(clef) ?? 0, `bascules en ${clef}`).toBe(caduc ? 2 * ANS : 0)
    }
    // ET LA FORÊT EST BIEN VERTE L'ÉTÉ, NUE L'HIVER — chaque année, pas seulement la première.
    for (let an = 1; an <= ANS; an++) {
      const decalage = (an - 1) * YEAR_DAYS
      for (const [tx, ty] of suivies) {
        const caduc = [TERRAIN_FOREST, TERRAIN_WILLOW, TERRAIN_OLD_GROWTH].includes(terrainAt(sim.map, tx, ty))
        if (!caduc) continue
        sim.tick = tickDe(decalage + ARDEUR, false)
        expect(feuillageDenude(sim, tx, ty), `an ${an}, l'Ardeur, ${tx},${ty}`).toBe(false)
        sim.tick = tickDe(decalage + GRAND_FROID, false)
        expect(feuillageDenude(sim, tx, ty), `an ${an}, le Grand Froid, ${tx},${ty}`).toBe(true)
      }
    }
  })

  it('la forêt se dépouille — et reverdit — PROGRESSIVEMENT, pas toute le même matin', () => {
    for (const [loi, debut] of [
      [jourDeDefeuillaison, GEL.JOUR_DEFEUILLAISON],
      [jourDeRefeuillaison, GEL.JOUR_REFEUILLAISON],
    ] as const) {
      const jours = new Set<number>()
      for (let tx = 0; tx < 60; tx++) for (let ty = 0; ty < 6; ty++) jours.add(Math.floor(loi(tx, ty)))
      expect(jours.size).toBeGreaterThan(2)
      for (const j of jours) {
        expect(j).toBeGreaterThanOrEqual(debut)
        expect(j).toBeLessThanOrEqual(debut + GEL.DEFEUILLAISON_JOURS)
      }
    }
    // ET LE MÊME ARBRE MÈNE LES DEUX : celui qui s'est dépouillé le premier reverdit le premier
    // (même `hash2`, même sel) — sans quoi la forêt se désynchroniserait d'une saison à l'autre.
    for (let tx = 0; tx < 20; tx++) {
      for (let ty = 0; ty < 6; ty++) {
        expect(jourDeDefeuillaison(tx, ty) - GEL.JOUR_DEFEUILLAISON)
          .toBeCloseTo(jourDeRefeuillaison(tx, ty) - GEL.JOUR_REFEUILLAISON, 12)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A10 — la neige au sol
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A10 — la neige tient après le front, puis fond (G7)', () => {
  const sonde = simGel({ meteoActive: true })

  /** Le point d'observation d'un front : celui que sa bande QUITTE en premier — la neige y
   *  fond le plus longtemps sous nos yeux. (Il se dérive du bord d'entrée, comme le dépôt.) */
  const pointDe = (f: MeteoFront): number => (f.edge === 0 || f.edge === 2 ? 2 : sonde.map.width - 3)
  const TY = 5

  /** La bande de ce cycle couvre-t-elle ce point à ce tick ? On LIT la géométrie du jeu
   *  (`bandeDuCycle`), on ne la recopie pas : une garde qui refait la bande ne garde rien. */
  function sousLaBande(state: SimState, c: number, tick: number, tx: number, ty: number): boolean {
    const b = bandeDuCycle(state, c, tick)
    if (!b) return false
    const k = b.axis === 'x' ? tx : ty
    return k >= b.lo && k < b.hi
  }

  /**
   * CE CYCLE DÉPOSE-T-IL DE LA NEIGE EN CE POINT ? — le seul critère qui compte, et il a
   * changé avec les saisons (S7-S9).
   *
   * L'ancien critère jugeait la CLASSE du front (« il précipite »), parce qu'un front tombait
   * un jour sur deux et qu'un cycle neigeux isolé se trouvait tout seul. Sous les épisodes
   * (S9), les Pluies et le Grand Froid portent des séries de quatre à cinq cycles mouillés
   * d'affilée : **aucun cycle précipitant n'est plus jamais isolé**, et la recherche d'avant
   * ne rend rien du tout — mesuré, sur quatre mille cycles.
   *
   * Ce qui SALIT une mesure de fonte, ce n'est pas qu'il pleuve à côté : c'est qu'il NEIGE
   * ici. On demande donc à chaque voisin la seule question utile — sa bande a-t-elle couvert
   * ce point à un instant où il neigeait ? C'est plus large que l'ancien test (un front tiède
   * à ses deux bouts peut neiger en son milieu, et cela compte) et plus étroit là où il
   * fallait (une averse d'été qui balaie le point ne dépose rien).
   */
  function depose(state: SimState, c: number, scale: number, tx: number, ty: number): boolean {
    const f = frontDuCycle(c, scale, state.jourDeDepart)
    if (!f || (f.type !== 'pluie' && f.type !== 'orage')) return false
    const pas = Math.max(1, Math.floor((f.endTick - f.startTick) / 64))
    for (let t = f.startTick; t < f.endTick; t += pas) {
      if (sousLaBande(state, c, t, tx, ty) && neigeA(dehorsSansMeteo(state, tx, ty, t))) return true
    }
    return false
  }

  /**
   * Un cycle qui enneige son point d'observation, PRÉCÉDÉ d'une mémoire vide (pour partir de
   * zéro) et SUIVI d'assez de cycles sans dépôt pour que la couverture ait le temps de fondre
   * sans qu'une nouvelle neige ne la repose. Sans ça, la garde de décroissance mesurerait la
   * MÉTÉO, pas la fonte — et rougirait pour rien.
   */
  function cycleNeigeuxIsole(scale: number, secsAutour: number): number | null {
    // La fenêtre de recherche est LARGE (l'année tourne : les saisons froides et douces
    // alternent, et un dépôt ISOLÉ vit au bord d'une saison froide — il s'en présente
    // quelques-uns par an, pas un par saison).
    for (let c = GEL.MEMOIRE_CYCLES; c < 4000; c++) {
      const f = frontDuCycle(c, scale, sonde.jourDeDepart)
      if (!f) continue
      const tx = pointDe(f)
      if (!depose(sonde, c, scale, tx, TY)) continue
      let seul = true
      // APRÈS : personne ne repose de la neige pendant qu'on regarde celle-ci fondre.
      for (let k = 1; k <= secsAutour; k++) if (depose(sonde, c + k, scale, tx, TY)) seul = false
      // AVANT : et personne n'en a laissé qui traînerait encore au moment où l'on part de 0.
      for (let k = 1; k <= GEL.MEMOIRE_CYCLES; k++) if (depose(sonde, c - k, scale, tx, TY)) seul = false
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
    // TROIS cycles sans dépôt derrière, et pas deux : le balayage court deux cycles PLEINS
    // à partir de `endTick`, qui vit déjà au bout du sien — il mord donc sur le troisième.
    const c = cycleNeigeuxIsole(SCALE, 3)
    expect(c).not.toBeNull()
    const front = frontDuCycle(c!, SCALE, sonde.jourDeDepart)!
    const sim = simGel({ meteoActive: true })
    // Le point au BOUT de la traversée, comme le test voisin : la bande l'a quitté tôt, il
    // reste de la neige à regarder fondre.
    const tx = pointDe(front)
    const ty = TY
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
    sim.tick = frontDuCycle(c!, SCALE, sim.jourDeDepart)!.endTick
    expect(neigeAuSol(sim, 5, 5)).toBe(0)
  })

  it('après le passage du front : la couverture existe, puis décroît', () => {
    // ⚠ ON NE CHOISIT PAS LA MÉTÉO : le Grand Froid porte des ÉPISODES de quatre à cinq
    // cycles mouillés d'affilée (S9), si bien qu'une longue accalmie n'existe tout simplement
    // pas. On cherche donc le seul montage qui mesure la FONTE et non le calendrier : un
    // dépôt précédé d'une mémoire vide (pour partir de zéro) et suivi de deux cycles sans
    // dépôt EN CE POINT (pour voir décroître sans qu'on en repose).
    const c = cycleNeigeuxIsole(SCALE, 2)
    expect(c).not.toBeNull()
    const front = frontDuCycle(c!, SCALE, sonde.jourDeDepart)!
    const sim = simGel({ meteoActive: true })

    // Le point est choisi au bout de la traversée : la bande l'a quitté tôt, on a de la marge.
    const tx = pointDe(front)
    const ty = TY

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

  it('elle DISPARAÎT : une mémoire sans le moindre dépôt rend exactement zéro', () => {
    // Une fenêtre de `MEMOIRE_CYCLES` cycles sans dépôt — au-delà, la neige d'avant est
    // hors de portée du rembobinage, et la couverture est nulle AU BIT PRÈS.
    //
    // ⚠ L'ABSENCE SE JUGE EN CHAQUE POINT BALAYÉ, jamais sur la classe du front : une averse
    // d'été traverse la carte sans rien laisser, et l'écarter ferait chercher une accalmie
    // qui, sous les épisodes (S9), n'existe presque plus.
    const points: number[] = []
    for (let tx = 0; tx < sonde.map.width; tx += 7) points.push(tx)
    let sec: number | null = null
    for (let c = GEL.MEMOIRE_CYCLES; c < 400 && sec === null; c++) {
      let vide = true
      for (let k = 0; k < GEL.MEMOIRE_CYCLES; k++) {
        for (const tx of points) if (depose(sonde, c - k, SCALE, tx, TY)) vide = false
      }
      if (vide) sec = c
    }
    expect(sec).not.toBeNull()
    const sim = simGel({ meteoActive: true })
    sim.tick = sec! * TICKS_PER_CYCLE + Math.floor(TICKS_PER_CYCLE / 2)
    for (const tx of points) expect(neigeAuSol(sim, tx, TY), `tx=${tx}`).toBe(0)
  })

  it('elle est PURE : deux appels, même réponse, et l’état ne bouge pas', () => {
    const c = cycleNeigeux(SCALE)!
    const front = frontDuCycle(c, SCALE, sonde.jourDeDepart)!
    const sim = simGel({ meteoActive: true })
    sim.tick = front.endTick + 100
    const avant = snapshot(sim)
    const a = neigeAuSol(sim, 4, 5)
    expect(neigeAuSol(sim, 4, 5)).toBe(a)
    expect(snapshot(sim)).toBe(avant)
  })

  it('elle FOND plus vite au chaud qu’au froid — la fonte paie le temps ET la température', () => {
    /**
     * DEUX POINTS, UN SEUL MONDE — et c'est ce qui rend la comparaison honnête.
     *
     * Le montage d'avant tordait le CALENDRIER pour poser le même tick à deux saisons
     * différentes. Il ne le peut plus, pour deux raisons : l'élection des fronts dépend elle
     * aussi de `calendarScale` (les épisodes se lisent sur le jour du bloc, S9), donc les deux
     * mondes n'auraient plus la même météo — on comparerait deux ciels, pas deux fontes ; et la
     * courbe du socle est SYMÉTRIQUE (S4 : mi-Éclosion et mi-Pluies valent toutes deux +8 °C),
     * si bien que « l'acte I contre l'acte III » ne dit plus rien du froid.
     *
     * On fait donc varier le seul terme qui ne touche à rien d'autre : le BIOME. Les deux
     * points sont pris SUR LA MÊME COORDONNÉE DE TRAVERSÉE — la bande les couvre au même tick
     * et à la même intensité. C'est exactement ce que `FONTE_CYCLES` promet : « la même neige
     * tient un jour sur le Névé et une heure au bord de l'eau ».
     */
    const sim = simGel({ meteoActive: true })
    let choisi: MeteoFront | null = null
    let doux = { tx: 0, ty: TY }
    let gel = { tx: 0, ty: TY }
    for (let c = GEL.MEMOIRE_CYCLES; c < 4000 && choisi === null; c++) {
      const f = frontDuCycle(c, SCALE, sim.jourDeDepart)
      if (!f) continue
      const d = { tx: pointDe(f), ty: TY }
      // Le second point se décale PERPENDICULAIREMENT à la traversée : la bande ne fait pas la
      // différence entre les deux, seul le terrain la fait.
      const g = f.edge <= 1
        ? { tx: d.tx, ty: d.ty + 3 }
        : { tx: d.tx * 2 > sim.map.width ? d.tx - 3 : d.tx + 3, ty: d.ty }
      // LE NÉVÉ SE POSE AVANT DE JUGER : il est seize degrés plus froid, donc il retient de la
      // neige que la plaine n'aurait pas gardée — l'isolement se juge sur les DEUX points.
      const avant = terrainAt(sim.map, g.tx, g.ty)
      setTile(sim.map, g.tx, g.ty, TERRAIN_SNOW) // BIOME_OFFSET −16 °C
      let ok = depose(sim, c, SCALE, d.tx, d.ty) && depose(sim, c, SCALE, g.tx, g.ty)
      for (let k = 1; k <= GEL.MEMOIRE_CYCLES && ok; k++) {
        if (depose(sim, c - k, SCALE, d.tx, d.ty) || depose(sim, c - k, SCALE, g.tx, g.ty)) ok = false
      }
      if (ok) {
        choisi = f
        doux = d
        gel = g
      } else setTile(sim.map, g.tx, g.ty, avant)
    }
    expect(choisi, 'aucun cycle ne dépose de la neige sur les deux points à la fois').not.toBeNull()
    const front = choisi!

    // LE DÉPÔT DE RÉFÉRENCE, à la sortie de la bande.
    sim.tick = front.endTick
    const depotDoux = neigeAuSol(sim, doux.tx, doux.ty)
    const depotGel = neigeAuSol(sim, gel.tx, gel.ty)
    expect(depotDoux).toBeGreaterThan(0)
    expect(depotGel).toBeGreaterThan(0)

    // UN DEMI-CYCLE PLUS TARD. On compare la PART FONDUE et non ce qui reste : les deux points
    // n'ont pas reçu le même dépôt (le Névé est sous la limite de neige quand la plaine ne
    // l'est pas encore), et comparer des restes confondrait la chute avec la fonte.
    sim.tick = front.endTick + Math.floor(TICKS_PER_CYCLE / 2)
    expect(baselineTemperature(sim, gel.tx, gel.ty))
      .toBeLessThan(baselineTemperature(sim, doux.tx, doux.ty))
    const fonduDoux = (depotDoux - neigeAuSol(sim, doux.tx, doux.ty)) / depotDoux
    const fonduGel = (depotGel - neigeAuSol(sim, gel.tx, gel.ty)) / depotGel
    expect(fonduGel).toBeLessThan(fonduDoux)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// A11 — l'hystérésis : zéro clignotement
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('A11 — le dégel a de l’hystérésis, et la glace ne clignote pas (G8)', () => {
  it('BANDE MORTE : au-dessus du seuil mais sous seuil+HYSTERESIS, la glace TIENT', () => {
    /**
     * LE MONTAGE, ET POURQUOI IL EST COMME ÇA. Il faut un point dont la température MONTE
     * continûment à travers la bande morte du lac — donc LA QUEUE d'un front qui s'éloigne.
     * Trois contraintes se combinent :
     *  · un ORAGE au GRAND FROID, DE JOUR (−2 °C) : le monde y est sous la limite de neige,
     *    donc le refroidissement éolien SATURE (R12) et le front mord de 22 — T = −2 − 22 ×
     *    intensité franchit `[−10, −8)` pour une intensité dans `(0,27 ; 0,36]`, en pleine
     *    RAMPE. Une pluie (COLD 4) ne descend qu'à −6 et ne toucherait jamais la bande morte ;
     *  · une carte LARGE (400) : la rampe d'un orage d'hiver fait 240 tuiles, et c'est elle
     *    qu'on balaie — le cœur, lui, écrase tout au plancher ;
     *  · on n'observe QUE le PLEIN JOUR. La fenêtre d'un front d'hiver (les trois quarts du
     *    cycle, S8) est désormais PLUS LONGUE que la journée (25 920 ticks) : elle ne peut plus
     *    tenir dedans. On CALE donc le front pour que sa queue quitte le point à la fin de la
     *    fenêtre d'observation — son entrée dans le cycle d'avant, ce que le calendrier permet
     *    (la veille est un jour de Grand Froid, même géométrie) — au lieu de suivre passivement
     *    une traversée qui déborderait sur la nuit.
     */
    const map = createEmptyMap(400, 12, TERRAIN_GRASS)
    for (let tx = 0; tx < 400; tx++) setTile(map, tx, 5, TERRAIN_DEEP_WATER)
    const sim = simGel({ map, meteoActive: true })
    const aube = aubeDe(GRAND_FROID)
    const jourTicks = dayTicksPourJour(GRAND_FROID)
    // On saute les deux LISIÈRES du jour : depuis la rampe (`partDeNuit`), l'écart de nuit y
    // monte et descend, et le froid cesse d'être monotone — on veut le PLEIN jour, pas ses
    // bords nocturnes.
    const debut = aube + NIGHT_RAMP_TICKS + 200
    const fin = aube + jourTicks - NIGHT_RAMP_TICKS - 200

    const POINT = 100
    const fenetre = fenetreDe({ type: 'orage', day: GRAND_FROID })
    const largeur = largeurDe({ type: 'orage', day: GRAND_FROID })
    // La QUEUE (`lo`) atteint POINT quand l'avancée vaut `POINT + largeur` — on pose ce
    // moment-là à la FIN du balayage, si bien que la température y monte tout du long.
    const uSortie = (POINT + largeur) / (map.width + largeur)
    const front = poserFront(sim, 'orage', 0, Math.round(fin - uSortie * fenetre))
    // LES PRÉMISSES DU CALAGE : la géométrie posée est bien celle du Grand Froid (la veille en
    // est un jour, donc `poserFront` lit la même saison), et le balayage tient en plein jour.
    expect(front.endTick - front.startTick).toBe(fenetre)
    expect(largeurDe(front)).toBe(largeur)
    expect(gameTimeAt(sim, debut).nuit).toBe(0)
    expect(gameTimeAt(sim, fin).nuit).toBe(0)

    let vuDecisif = 0
    let vuBandeMorte = 0
    for (let t = debut; t < fin; t += 10) {
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
    const front = poserFront(sim, 'orage', 0, tickDe(PLUIES, false))
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
    // LES BORNES ET LES CŒURS DES QUATRE SAISONS — l'ancien balayage listait les frontières
    // d'actes de 21 jours, qui ne désignent plus rien sous la cadence de 30 (S1).
    for (const jour of [1, ECLOSION, BALANCE.ACT_DAYS, BALANCE.ACT_DAYS + 1, ARDEUR,
      2 * BALANCE.ACT_DAYS, 2 * BALANCE.ACT_DAYS + 1, PLUIES, 3 * BALANCE.ACT_DAYS,
      3 * BALANCE.ACT_DAYS + 1, GRAND_FROID, YEAR_DAYS]) {
      for (const nuit of [false, true]) {
        for (const type of [null, 'pluie', 'orage', 'brouillard'] as const) {
          sim.tick = tickDe(jour, nuit)
          if (type === null) sim.meteo = null
          else frontSurLeTick(sim, type, 0)
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
    sim.tick = tickDe(GRAND_FROID, true) // la rivière a pris
    const milieu = { x: RIVIERE_X0 + 1.5, y: 6.5 }
    expect(estGele(sim, RIVIERE_X0 + 1, 6)).toBe(true)

    const joueur = spawnEntity(sim, milieu.x, milieu.y)
    const bete = spawnMonster(sim, 'wolf', milieu.x, milieu.y + 1)
    const corps = [joueur, bete]

    // LE DÉGEL : le jour se lève sur le Grand Froid (−2 ≥ SEUIL_PROFOND + HYSTERESIS = −8).
    sim.tick = tickDe(GRAND_FROID, false)
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
    sim.tick = tickDe(PLUIES, true) // les Pluies, nuit : −2 °C — le lac ne prend PAS seul
    const front = frontSurLeTick(sim, 'orage', 0)
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
      sim.tick = tickDe(GRAND_FROID, true)
      spawnEntity(sim, surLaGlace ? RIVIERE_X0 + 1.5 : 5.5, 6.5)
      sim.tick = tickDe(GRAND_FROID, false) // le dégel
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
    sim.tick = tickDe(GRAND_FROID, true)
    const joueur = spawnEntity(sim, RIVIERE_X0 + 1.5, 6.5)
    const pvAvant = sim.entities.find((e) => e.id === joueur)!.hp
    sim.tick = tickDe(GRAND_FROID, false)
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
   * au Grand Froid, l'économie entière.
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
      // Les quatre cœurs de saison et les quatre bords : la courbe y prend ses extrêmes ET
      // ses valeurs de raccord (les frontières d'actes de 21 jours d'avant ne disent plus rien).
      for (const jour of [1, ECLOSION, BALANCE.ACT_DAYS + 1, ARDEUR,
        2 * BALANCE.ACT_DAYS + 1, PLUIES, 3 * BALANCE.ACT_DAYS + 1, GRAND_FROID, YEAR_DAYS]) {
        for (const nuit of [false, true]) {
          for (const meteo of [null, 'pluie', 'orage', 'brouillard'] as const) {
            for (const brume of [false, true]) {
              sim.tick = tickDe(jour, nuit)
              if (meteo === null) sim.meteo = null
              else frontSurLeTick(sim, meteo, 0)
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
    sim.tick = tickDe(ARDEUR, false)
    expect(climatMaximal(sim, sim.tick)).toBe(climatFlore(sim, PROBE_X, PROBE_Y, sim.tick))
  })
})
