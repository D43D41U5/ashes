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
  BALANCE, GEL, METEO, TEMPERATURE, TERRAINS,
  TERRAIN_DEEP_WATER, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_SHALLOW_WATER, TERRAIN_SNOW, TERRAIN_WILLOW,
  YEAR_DAYS,
} from './balance'
import { palierDuSol, terrainAEtage } from './etages'
import { CARACTERES_DE_FOYER, foyersDeLaCarte, froidDeCendre } from './cendre'
import { FUMEROLLE, souffleMaxParPalier } from './fumerolle'
import { drainEvents } from './events'
import { placeHuntingGrounds } from './faune'
import {
  advanceDegel, bandeDuCycle, estGele, feuillageDenude, gelPossible, gelPossibleAuPalier,
  jourDeDefeuillaison, jourDeRefeuillaison, neigeAuSol, plafondDuPalier, plancherDuPalier,
  vitesseSurGlace,
} from './gel'
import { createEmptyMap, isBlockingTile, isWater, MARCHABLE, setTile, terrainAt, type WorldMap } from './map'
import { modificateurDeSaison } from './modificateur'
import { coldMaximal, fenetreDe, frontDuCycle, largeurDe, meteoColdAt, neigeA, type MeteoFront } from './meteo'
import { spawnMonster } from './monsters'
import { computeFlowField, findPath } from './pathfinding'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { TERRASSES } from './terrasses'
import {
  ambientTemperature, baselineTemperature, baselineTemperatureAt, climatFlore, climatMaximal,
  dehorsSansMeteo, froidDeFumerolleDeTuile, socleDuJour, sousLaRoche,
} from './temperature'
import {
  calendarScaleForSeasonCycles, dayTicksPourJour, gameTimeAt, jourDeSaison, NIGHT_RAMP_TICKS,
  phaseForDay, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, tourForDay,
} from './time'
import { addStructure, type Structure } from './village'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { carteDeTest } from '../../../tools/carte-cache'
/**
 * ⚠ UN FOYER LIBRE NAÎT ÉTEINT DEPUIS `braise.md` B-R17 (2026-10-04) : un `addStructure` nu ne
 * brûle plus rien. Les gardes de ce fichier éprouvent un feu QUI BRÛLE, donc le montage lui donne
 * la flamme — c'est la prémisse perdue qu'on refabrique, pas un contournement de la loi : la loi
 * elle-même est éprouvée par le vrai chemin joueur dans `braise.test.ts` (B-A17).
 */
const allume = <S extends Structure>(sim: SimState, s: S): S => {
  s.allumee = true
  // …ET L'ANCRE DE COMBUSTION AVEC. `addStructure` ne la pose plus (un foyer naît éteint, donc rien
  // ne brûle à sa naissance) ; la production l'ancre au premier tick de flamme, clause « Sécurité »
  // d'`advanceFire`. Ici on la pose AVEC la flamme, pour rendre exactement l'état de naissance
  // d'avant la loi — c'est ce que ces montages supposent quand ils règlent `burnAt` à la main.
  if (s.fuel && s.burnAt === undefined) { s.burnAt = sim.tick; s.burnSlot = 0 }
  return s
}

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
    const feu = allume(sim, addStructure(sim, 'fire', RIVIERE_X0 - 1, 6, 0, 0))
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

/* ─────────── LES DEUX BORNES PAR PALIER — étape 2 de `braise.md` § 3 (2026-10-02) ─────────── */

describe('les deux bornes par palier : « ici rien ne gèle » et « ici tout gèle »', () => {
  const SEED = 2026
  const carte = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
  const map = carte.map

  /** MIDI et CŒUR DE NUIT d'un jour de SAISON. ⚠ Un jour de saison vaut `TICKS_PER_SEASON_DAY`
   *  (1 728 000 ticks) et NON un cycle jour/nuit : une sonde qui comptait des cycles a rendu un
   *  tableau tout propre et parfaitement faux le 2026-10-01 (journal du jour). On s'aligne donc
   *  sur le début du cycle qui porte le jour visé, et l'on VÉRIFIE le jour obtenu. */
  /** Les quatre moments d'un cycle, en PART du jour puis de la nuit. ⚠ L'aube et le crépuscule
   *  ne sont pas du décor : `partDeNuit` y est une RAMPE, donc c'est là que la température
   *  traverse un seuil — et donc là que la bande morte et sa relecture du passé décident. Une
   *  garde qui ne visite que midi et le cœur de nuit ne voit jamais la traversée. */
  const MOMENTS = [
    ['midi', false, 0.5], ['aube', false, 0.04], ['crépuscule', false, 0.96], ['cœur de nuit', true, 0.5],
  ] as const
  function tickAu(state: SimState, jour: number, nuit: boolean, part: number): number {
    const t0 = (jour - 1) * TICKS_PER_SEASON_DAY + TICKS_PER_CYCLE
    const cs = t0 - (((t0 + state.cycleOffset) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
    const d = dayTicksPourJour(jour)
    const t = cs + (nuit ? d + Math.floor((TICKS_PER_CYCLE - d) * part) : Math.floor(d * part))
    expect(jourDeSaison(state, t), `le tick ${t} doit tomber au jour ${jour}`).toBe(jour)
    return t
  }
  function tickDe(state: SimState, jour: number, nuit: boolean): number {
    // Un cycle DANS le jour avant d'aligner : sans cette marge, l'alignement vers le bas
    // retomberait la veille au jour 1 (t0 = 0) et la garde se jugerait sur une autre saison.
    const t0 = (jour - 1) * TICKS_PER_SEASON_DAY + TICKS_PER_CYCLE
    const cs = t0 - (((t0 + state.cycleOffset) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
    const d = dayTicksPourJour(jour)
    const t = cs + (nuit ? d + Math.floor((TICKS_PER_CYCLE - d) / 2) : Math.floor(d / 2))
    expect(jourDeSaison(state, t), `le tick ${t} doit tomber au jour ${jour}`).toBe(jour)
    return t
  }
  const coeurDe = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2
  const INSTANTS = [1, 2, 3, 4].flatMap((ph) => [[`saison ${ph} jour`, coeurDe(ph), false], [`saison ${ph} nuit`, coeurDe(ph), true]] as const)

  /**
   * TOUTE l'eau de la carte, rangée par palier — **un balayage, pas un échantillon**.
   *
   * ⚠ Un échantillon borné avait été écrit d'abord (les 120 premières tuiles par palier) et il
   * était PIRE qu'inutile : l'ordre de balayage part du haut de la carte, donc « les 120
   * premières » sont toutes voisines, et les tuiles capables de rompre le majorant sont
   * précisément les rares — abritées, karstiques, en bord de carte. Un titre qui dit « aucune
   * tuile » doit avoir regardé chaque tuile.
   */
  function eauParPalier(): Map<number, number[]> {
    const parPalier = new Map<number, number[]>()
    for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
      const t = terrainAt(map, tx, ty)
      if (t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER) continue
      const p = palierDuSol(map, tx, ty)
      const l = parPalier.get(p)
      if (l) l.push(ty * map.width + tx)
      else parPalier.set(p, [ty * map.width + tx])
    }
    return parPalier
  }
  const EAU = eauParPalier()
  const TOTAL_EAU = [...EAU.values()].reduce((n, l) => n + l.length, 0)
  const sim0 = createSim(SEED, { map, calendarScale: 1, meteoActive: false })
  /** Du SEC, échantillonné en grille — pour éprouver l'inversion de l'ordre (seuil avant porte). */
  const SEC: number[] = (() => {
    const l: number[] = []
    for (let ty = 0; ty < map.height && l.length < 400; ty += 7) for (let tx = 0; tx < map.width && l.length < 400; tx += 11) {
      if (!isWater(terrainAt(map, tx, ty))) l.push(ty * map.width + tx)
    }
    return l
  })()

  it('LE PLAFOND NE PEUT PAS RENCONTRER `GROTTE_AMBIANT` — prémisse affirmée sur l’ARITÉ, pas sur un comptage', () => {
    // ⚠ `airNonBorneAt` rend `GROTTE_AMBIANT` (13 °C) dès qu'une tuile est sous la roche, QUEL QUE
    // SOIT son palier : une eau sous un plafond de roche rendrait le majorant faux de 31 °C au
    // palier 3 (13 contre −18). La prémisse est donc à prouver — mais PAS comme je l'avais écrite.
    //
    // ⚠ **MA PREMIÈRE VERSION DE CETTE GARDE NE POUVAIT PAS ÉCHOUER, et son chiffre ne mesurait
    //   rien.** Elle appelait `sousLaRoche(sim0, tx, ty)` — **trois** arguments — alors que la
    //   fonction s'ouvre sur `etage !== undefined && etage < 0 && …` : à trois arguments elle rend
    //   **toujours faux**, sans jamais toucher la carte. Mon « 0 tuile sur 321 649 » était donc une
    //   tautologie déguisée en mesure. C'est affirmé ici, et le chiffre est retiré partout.
    //
    // CE QUI PROUVE VRAIMENT LA PRÉMISSE, en deux clauses :
    //   ① **l'arité** — `estGele` lit `baselineTemperature(state, tx, ty)` SANS `etage`, donc la
    //     branche grotte est structurellement inatteignable. C'est le fait porteur : la prémisse
    //     ne redeviendra vivante que le jour où `estGele` ou l'une des deux bornes prendra un étage.
    //   ② **la carte** — aucune tuile d'eau n'existe à un étage CREUSÉ (`−(palier+1)`, G-R1), ce qui
    //     se lit avec `terrainAEtage` et non avec `sousLaRoche`.
    // ① est un CONTRÔLE POSITIF de ② : il montre que ma sonde d'avant mesurait la première et
    // croyait mesurer la seconde.
    expect(sousLaRoche(sim0, 0, 0), '① `sousLaRoche` à trois arguments rend faux par construction')
      .toBe(false)
    let sous = 0
    const exemples: string[] = []
    for (const [p, tuiles] of EAU) for (const i of tuiles) {
      const tx = i % map.width, ty = Math.floor(i / map.width)
      // L'étage creusé sous CE palier, celui que `sousLaRoche` aurait reçu si on le lui passait.
      if (terrainAEtage(map, -(p + 1), tx, ty) === 0) continue
      sous++
      if (exemples.length < 5) exemples.push(`(${tx},${ty}) palier ${p}`)
    }
    expect(TOTAL_EAU, 'la garde ne passe pas à vide').toBeGreaterThan(10000)
    expect(sous, `② eau à un étage creusé — le plafond n’y est plus un majorant : ${exemples.join(' · ')}`).toBe(0)
  })

  it('LE PLANCHER TIENT COMPTE DES FROIDS LOCAUX — fumerolle et cendre, le trou reproduit le 2026-10-02', () => {
    // ⚠ ═══ LA GARDE DE NON-RÉGRESSION DU DÉFAUT LE PLUS SÉRIEUX DE L'ÉTAPE 2 ═══
    //
    // `expositionSansMeteo` retranche CINQ termes : `biome − nuit − brume − FUMEROLLE − CENDRE`.
    // `plancherDuPalier` en omettait les deux derniers, qui sont des froids ≥ 0 — il n'était donc
    // pas un minorant, et la porte locale affirmait « ici rien ne gèle » sur des gués à −3,6 °C.
    // **REPRODUIT avant d'être corrigé** : 1 540 divergences sur l'année, graine 2026, cendre
    // vieillie — 416 tuiles d'eau portent un souffle jusqu'à 8,09 °C, aux paliers 0, 1 et 2.
    //
    // ⚠ **LE DÉFAUT EST PLUS VIEUX QUE L'ÉTAPE 2 ET CELLE-CI LE RÉVEILLE** : avant le 2026-09-30 la
    //   porte coupait 120/240 et le trou était VIVANT ; le froid d'étage l'a masqué (0/240) ; la
    //   rendre locale la fait couper à nouveau. Une borne qu'on rend utile redevient faillible.
    //
    // ⚠ **ET C'EST POURQUOI CETTE GARDE VIEILLIT LA CENDRE** : `createSim` laisse `cendreAge` vide,
    //   donc les deux froids valent 0 par court-circuit et le balayage exhaustif ci-dessus — qui
    //   n'a pas de cendre — est AVEUGLE à ce défaut. Un montage qui ne porte pas la prémisse ne
    //   peut pas voir ce qui en dépend.
    // ⚠ **LES DEUX RÉGIMES DE CENDRE, et ce n'est pas du zèle** : les deux froids n'ont pas la
    //   même condition d'existence — le souffle exige un `cendreAge` non vide, le froid de cendre
    //   non (`profondeurNueDeCendre` lit `?? 0` et calcule quand même). Une garde qui ne jouerait
    //   que la cendre vieillie laisserait la borne du régime NEUF sans aucune épreuve, or c'est
    //   celui d'une partie qui vient de naître.
    const seuilRef = (terrain: number): number | undefined =>
      terrain === TERRAIN_SHALLOW_WATER ? GEL.SEUIL_GUE : terrain === TERRAIN_DEEP_WATER ? GEL.SEUIL_PROFOND : undefined
    let chaudesVues = 0
    for (const [nomRegime, ages] of [
      ['cendre VIEILLIE (120 j)', foyersDeLaCarte(map).map(() => 120)],
      ['cendre NEUVE (cendreAge vide)', [] as number[]],
    ] as const) {
      const sim = createSim(SEED, { map, calendarScale: 1, meteoActive: false })
      sim.cendreAge = [...ages]
      const chaudes: { tx: number; ty: number; p: number }[] = []
      let pireFroid = 0
      for (const [p, tuiles] of EAU) for (const i of tuiles) {
        const tx = i % map.width, ty = Math.floor(i / map.width)
        const froid = froidDeFumerolleDeTuile(sim, tx, ty) + froidDeCendre(sim, tx, ty)
        if (froid <= 0) continue
        chaudes.push({ tx, ty, p })
        if (froid > pireFroid) pireFroid = froid
      }
      chaudesVues += chaudes.length
      // ⚠ LA PRÉMISSE N'EST AFFIRMÉE QUE POUR LE RÉGIME QUI LA PORTE. En cendre neuve il n'y a
      //   AUCUNE bouche éveillée (MESURÉ : 0 tuile d'eau sur 321 649 porte un froid local), donc
      //   exiger ici « plus de 100 tuiles chaudes » rendrait la garde rouge pour une bonne raison.
      //   Ce régime-là éprouve l'AUTRE chose : que la borne reste JUSTE quand on ne la pénalise pas.
      if (ages.length > 0) {
        expect(chaudes.length, `${nomRegime} : des tuiles d’eau portant un froid local`).toBeGreaterThan(100)
        expect(pireFroid, `${nomRegime} : et un froid qui franchit l’hystérésis`).toBeGreaterThan(GEL.HYSTERESIS)
      }
      // En cendre neuve on n'a pas de tuile « chaude » : on éprouve alors un échantillon d'eau du
      // palier 0, là où la borne est la plus serrée et donc la plus prompte à se tromper.
      const cibles = chaudes.length > 0 ? chaudes
        : (EAU.get(0) ?? []).slice(0, 400).map((i) => ({ tx: i % map.width, ty: Math.floor(i / map.width), p: 0 }))
      expect(cibles.length, `${nomRegime} : des cibles`).toBeGreaterThan(100)
      const fautes: string[] = []
      let geles = 0
      // ⚠ L'ANNÉE ENTIÈRE × LES QUATRE MOMENTS DU CYCLE. La fenêtre du défaut est étroite et on ne
      //   la devine pas : celle de 2026 s'ouvrait au JOUR 1, qu'aucun des huit cardinaux du
      //   balayage exhaustif ne visite — et l'aube et le crépuscule sont les instants où la
      //   température TRAVERSE un seuil, donc où la bande morte décide.
      for (let jour = 1; jour <= YEAR_DAYS; jour++) for (const [quand, nuit, part] of MOMENTS) {
        sim.tick = tickAu(sim, jour, nuit, part)
        for (const k of cibles) {
          const seuil = seuilRef(terrainAt(map, k.tx, k.ty))!
          const t = baselineTemperature(sim, k.tx, k.ty)
          let attendu: boolean
          if (t < seuil) attendu = true
          else if (t >= seuil + GEL.HYSTERESIS) attendu = false
          else attendu = baselineTemperatureAt(sim, k.tx, k.ty, Math.max(0, sim.tick - GEL.RETARD_TICKS)) < seuil
          const obtenu = estGele(sim, k.tx, k.ty)
          if (attendu) geles++
          if (obtenu !== attendu && fautes.length < 8) {
            fautes.push(`${nomRegime} · jour ${jour} ${quand} · p${k.p} (${k.tx},${k.ty}) : estGele=${obtenu}, la vérité est ${attendu} · T=${t} · porte p${k.p}=${gelPossibleAuPalier(sim, k.p)}`)
          }
        }
      }
      // ⚠ NON-VACUITÉ : si aucune cible ne gelait jamais, l'égalité serait triviale.
      expect(geles, `${nomRegime} : des instants où ces tuiles sont RÉELLEMENT prises`).toBeGreaterThan(100)
      expect(fautes, fautes.join('\n')).toHaveLength(0)
    }
    expect(chaudesVues, 'au moins un régime porte des tuiles chaudes').toBeGreaterThan(100)
  })

  it('LE PLAFOND EST UN MAJORANT **ET** `estGele` N’A PAS BOUGÉ D’UNE TUILE — balayage de toute l’eau', () => {
    // ═══ LE CONTRAT ENTIER DE L'ÉTAPE 2, EN UN SEUL BALAYAGE ═══
    //
    // Deux affirmations se vérifient ici, et elles sont réunies pour une raison de COÛT : toutes
    // deux ont besoin de la MÊME lecture de température, qui est le poste cher (MESURÉ le
    // 2026-10-02 : 2,0 s pour 321 649 tuiles à un instant). Les séparer la paierait deux fois.
    //
    //  ① LE PLAFOND EST UN VRAI MAJORANT. C'est la garde de soudure de `plafondDuPalier` : sa
    //    preuve tient à une propriété de l'EAU — l'exposition est SIGNÉE (le biome peut
    //    RÉCHAUFFER, +2 en forêt) mais `BIOME_OFFSET` n'a aucune entrée pour 4 ni 6. Le jour où
    //    une eau prendrait un offset positif, le plafond deviendrait faux ; c'est ici qu'on
    //    l'apprendrait. (L'autre prémisse — aucune eau sous la roche — a sa garde juste au-dessus.)
    //
    //  ② `estGele` REND EXACTEMENT CE QU'IL RENDAIT. La référence recalcule le prédicat SANS
    //    aucune borne : si les deux coïncident sur chaque tuile d'eau de la carte et à huit
    //    instants, les bornes n'ont rien changé au JEU — elles ont seulement évité des lectures.
    //
    // ⚠ ET C'EST UN BALAYAGE, PAS UN ÉCHANTILLON (voir `eauParPalier`) : les tuiles capables de
    //   rompre le majorant sont les rares, et un échantillon pris dans l'ordre de balayage les
    //   manque par construction.
    const sim = sim0
    const seuilRef = (terrain: number): number | undefined =>
      terrain === TERRAIN_SHALLOW_WATER ? GEL.SEUIL_GUE : terrain === TERRAIN_DEEP_WATER ? GEL.SEUIL_PROFOND : undefined
    const majorant: string[] = []
    const divergences: string[] = []
    let vus = 0, geles = 0
    for (const [, jour, nuit] of INSTANTS) {
      sim.tick = tickDe(sim, jour, nuit)
      for (const [p, tuiles] of [...EAU, [-1, SEC] as const]) {
        const plafond = p < 0 ? undefined : plafondDuPalier(sim, p)
        for (const i of tuiles) {
          const tx = i % map.width, ty = Math.floor(i / map.width)
          const seuil = seuilRef(terrainAt(map, tx, ty))
          // ① le majorant — sur l'eau seulement, c'est son domaine
          const t = seuil === undefined ? 0 : baselineTemperature(sim, tx, ty)
          if (plafond !== undefined && t > plafond && majorant.length < 8) {
            majorant.push(`jour ${jour}${nuit ? ' nuit' : ''}, p${p} (${tx},${ty}) : ${t} > plafond ${plafond}`)
          }
          // ② l'équivalence — la référence réemploie la lecture déjà faite
          let attendu: boolean
          if (seuil === undefined) attendu = false
          else if (t < seuil) attendu = true
          else if (t >= seuil + GEL.HYSTERESIS) attendu = false
          else attendu = baselineTemperatureAt(sim, tx, ty, Math.max(0, sim.tick - GEL.RETARD_TICKS)) < seuil
          const obtenu = estGele(sim, tx, ty)
          vus++
          if (obtenu) geles++
          if (obtenu !== attendu && divergences.length < 8) {
            divergences.push(`jour ${jour}${nuit ? ' nuit' : ''}, p${palierDuSol(map, tx, ty)} (${tx},${ty}) terrain ${terrainAt(map, tx, ty)} : estGele=${obtenu} mais la référence dit ${attendu}`)
          }
        }
      }
    }
    expect(vus, 'la garde ne passe pas à vide').toBeGreaterThan(TOTAL_EAU)
    // ⚠ LES DEUX ISSUES SONT VISITÉES : sans ces deux lignes, une référence qui rendrait TOUJOURS
    // faux coïnciderait avec un `estGele` cassé dans le même sens, et l'équivalence serait triviale.
    expect(geles, 'des tuiles GELÉES dans le balayage').toBeGreaterThan(1000)
    expect(vus - geles, 'des tuiles LIBRES dans le balayage').toBeGreaterThan(1000)
    expect(majorant, majorant.join('\n')).toHaveLength(0)
    expect(divergences, divergences.join('\n')).toHaveLength(0)
  })

  it('LA PORTE LOCALE COUPE LÀ OÙ LA GLOBALE NE COUPAIT PLUS — c’est toute la récupération', () => {
    // ⚠ CE QUE CETTE GARDE PROUVE, ET QUI EST LE MOTIF DE L'ÉTAPE 2 : depuis le froid d'étage, la
    // porte de la VALLÉE est vraie toute l'année (0/240 points, journal du 2026-09-30), donc elle
    // ne court-circuite plus rien. Au palier 0, aux saisons douces, la porte LOCALE coupe encore.
    const sim = sim0
    let coupe = 0
    for (const [nom, jour, nuit] of INSTANTS) {
      sim.tick = tickDe(sim, jour, nuit)
      // La porte de la vallée ne coupe JAMAIS — c'est le défaut qu'on répare, et on l'affirme.
      expect(gelPossible(sim), `porte de la vallée à ${nom}`).toBe(true)
      if (!gelPossibleAuPalier(sim, 0)) coupe++
    }
    // Et elle coupe sur une PART des instants, jamais sur tous : si elle coupait partout, elle
    // affirmerait que rien ne gèle même au cœur de l'hiver.
    expect(coupe, `instants où la porte du palier 0 coupe, sur ${INSTANTS.length}`).toBeGreaterThan(0)
    expect(coupe, 'elle ne doit PAS couper partout').toBeLessThan(INSTANTS.length)
    // LA MONOTONIE : plus on monte, moins la porte peut couper. Une borne qui ne serait pas
    // monotone en palier accuserait son propre calcul.
    for (const [nom, jour, nuit] of INSTANTS) {
      sim.tick = tickDe(sim, jour, nuit)
      for (let p = 1; p < TERRASSES.PALIERS; p++) {
        if (gelPossibleAuPalier(sim, p - 1)) {
          expect(gelPossibleAuPalier(sim, p), `${nom} : p${p - 1} peut geler mais p${p} non`).toBe(true)
        }
      }
    }
  })

  it('LE PLAFOND TRANCHE EN ALTITUDE : au plus haut palier, toute l’eau est prise à toute saison', () => {
    // La moitié du gain qui vient du PLAFOND — et c'est la conséquence de la décision ⓐ du
    // 2026-10-01 (les lacs d'altitude sont des ponts). Si cette garde tombait, le plafond ne
    // récupérerait plus rien et l'étape 2 serait à moitié inutile.
    const sim = sim0
    const haut = TERRASSES.PALIERS - 1
    const tuiles = EAU.get(haut) ?? []
    expect(tuiles.length, `de l’eau au palier ${haut}`).toBeGreaterThan(0)
    for (const [nom, jour, nuit] of INSTANTS) {
      sim.tick = tickDe(sim, jour, nuit)
      expect(plafondDuPalier(sim, haut), `plafond du palier ${haut} à ${nom}`).toBeLessThan(GEL.SEUIL_PROFOND)
      for (const i of tuiles.slice(0, 20)) {
        expect(estGele(sim, i % map.width, Math.floor(i / map.width)), `${nom} : (${i % map.width},${Math.floor(i / map.width)}) au palier ${haut}`).toBe(true)
      }
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // LE SOUFFLE MAX PAR PALIER — le majorant local précalculé (2026-10-02, « on suit ta reco »)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  /** Le majorant GLOBAL — celui que `plancherDuPalier` retranchait partout avant le champ, et
   *  celui sur lequel il retombe quand le champ manque (carte d'avant, façade client, banc). */
  const SOUFFLE_GLOBAL = FUMEROLLE.FROID * Math.max(1, ...Object.values(CARACTERES_DE_FOYER).map((e) => e.froid ?? 1))

  /** Toutes les fosses à un âge donné — la cendre vieillie, que `createSim` ne pose jamais. */
  const agesDe = (age: number): number[] => foyersDeLaCarte(map).map(() => age)

  it('LE SOUFFLE MAX PAR PALIER EST UN MAJORANT — et il est ATTEINT AU BIT, les quatre paliers', () => {
    // ═══ LE CONTRAT DU CHAMP, ET IL EST DOUBLE ═══
    //
    // ① **MAJORANT** : `souffleMax[p] ≥ froidDeFumerolle` sur CHAQUE tuile d'eau du palier `p`, à
    //   tout âge de la cendre. Sans ça `plancherDuPalier` cesse d'être un minorant et la porte
    //   « ici rien ne gèle » mentirait sur un gué pris — le défaut du matin, en plus petit.
    // ② **EXACT** : à la limite (toutes les bouches éveillées), il est ÉGAL au pire souffle
    //   réellement pris, aux quatre paliers. Un majorant trop lâche serait SAIN MAIS INERTE —
    //   la leçon du plafond, dont le terme de palier mis à `×0` ne faisait rougir aucune garde
    //   de justesse. Ici l'égalité au bit est ce qui atteste qu'il mesure la bonne chose.
    //
    // ⚠ L'ÂGE EST POUSSÉ AU-DELÀ DU JOUABLE, ET C'EST LE SENS DU CHAMP : il majore pour TOUTE la
    //   durée d'une partie, donc il se juge quand la corruption a tout atteint. Aux âges jouables
    //   il est simplement plus lâche (MESURÉ : à 120 jours, les paliers 1-3 n'ont pas encore
    //   réveillé leurs bouches — 5,25 / 6,27 / 0 pour une borne de 8,09 / 9,75 / 9,75).
    const champ = map.souffleMax
    expect(champ, 'la carte du monde JOUÉ porte le champ (worldgen, passe de queue)').toBeDefined()
    expect(champ).toHaveLength(TERRASSES.PALIERS)
    const sim = createSim(SEED, { map, calendarScale: 1, meteoActive: false })
    for (const [nom, age, exact] of [['âge jouable (120 j)', 120, false], ['à la LIMITE', 100000, true]] as const) {
      sim.cendreAge = agesDe(age)
      const pire = new Array<number>(TERRASSES.PALIERS).fill(0)
      let chaudes = 0
      const fautes: string[] = []
      for (const [p, tuiles] of EAU) for (const i of tuiles) {
        const tx = i % map.width, ty = Math.floor(i / map.width)
        const f = froidDeFumerolleDeTuile(sim, tx, ty)
        if (f <= 0) continue
        chaudes++
        if (f > pire[p]!) pire[p] = f
        if (f > champ![p]! && fautes.length < 8) fautes.push(`${nom} · p${p} (${tx},${ty}) : souffle ${f} > borne ${champ![p]}`)
      }
      expect(fautes, fautes.join('\n')).toHaveLength(0)
      // ⚠ CONTRÔLE POSITIF : sans tuile chaude, « aucun dépassement » est une tautologie.
      expect(chaudes, `${nom} : des tuiles d’eau prennent vraiment un souffle`).toBeGreaterThan(100)
      if (exact) {
        for (let p = 0; p < TERRASSES.PALIERS; p++) {
          expect(pire[p], `p${p} : le majorant est ATTEINT, au bit`).toBe(champ![p])
        }
        // Et il est STRICTEMENT meilleur que le majorant global — c'est tout son objet.
        expect(Math.max(...champ!)).toBeLessThan(SOUFFLE_GLOBAL)
      }
    }
  })

  it('LE CHAMP DU WORLDGEN EST EXACTEMENT UN RECALCUL — il ne doit rien au PRNG ni à l’ordre des passes', () => {
    // La passe est posée en TOUTE FIN de `generateZonedTerrain` et ne tire pas un nombre : si elle
    // en tirait un, elle déplacerait la naissance et les villages (journal du 2026-09-22, « l'ordre
    // d'une passe déplace les villages »). Le recalcul à froid, hors de toute génération, doit
    // rendre le même tableau au bit — c'est ce qui le prouve, et c'est aussi ce qui autorise une
    // sauvegarde à se relire : le champ est une FONCTION de (carte, graine), pas un état.
    expect(souffleMaxParPalier(map, SEED)).toEqual(map.souffleMax)
    // Et sans champ de cendre, rien ne fume : la passe rend des zéros et le worldgen ne pose alors
    // PAS le champ (il est gaté) — l'absence doit être une absence, jamais un `[0,0,0,0]`, qui
    // serait un repli par zéro et rendrait le plancher FAUX au lieu de lent.
    expect(souffleMaxParPalier(carteDEssai(), SEED)).toEqual(new Array(TERRASSES.PALIERS).fill(0))
  })

  it('RETIRER LE CHAMP NE CHANGE PAS UN VERDICT — mais la porte du palier 0 coupe DEUX FOIS MOINS', () => {
    // ═══ LES DEUX MOITIÉS DE LA DÉCISION DU 2026-10-02 ═══
    //
    // ① **LE REPLI EST SAIN** : une carte d'avant ce jour-là (ou un faux `SimState` de façade
    //   client) n'a pas le champ et retombe sur le majorant global. Ça doit être PLUS LENT et
    //   JAMAIS FAUX — donc pas un verdict de `estGele` ne bouge entre les deux.
    // ② **LE CHAMP SERT** : et ça se compte. Situé, le terme tombe de 12,6 à 8,09 °C au palier 0
    //   et la porte y recoupe des points de l'année que le majorant global ne coupait plus.
    //   MESURÉ : **126 points sur 480 contre 74** (et au banc, la cuisson du pire écran du palier
    //   0 passe de 66 ms à 5,7 ms au jour 65 — `tools/profil-gel-structures.mts`).
    //
    // ⚠ CE N'EST PAS UN REMBOURSEMENT COMPLET, et la garde ne prétend pas le contraire : 8,09 °C
    //   est le pire souffle VRAI du palier 0 (garde ci-dessus), donc aucun majorant par palier ne
    //   peut faire mieux, et les 73 jours restants coûtent toujours 66 ms.
    const ages = agesDe(120)
    const avec = createSim(SEED, { map, calendarScale: 1, meteoActive: false })
    avec.cendreAge = [...ages]
    const sans = createSim(SEED, { map, calendarScale: 1, meteoActive: false })
    sans.cendreAge = [...ages]
    // ⚠ ON MUTE LA CARTE **DE LA SIM**, pas `map` : `createSim` déclone la carte, donc les deux
    //   sims ont chacune la leur et `map` (partagée par tout ce fichier) reste intacte.
    delete (sans.map as { souffleMax?: number[] }).souffleMax
    expect(avec.map.souffleMax, 'le témoin a bien son champ').toBeDefined()
    expect(sans.map.souffleMax, 'et le repli n’en a pas').toBeUndefined()

    // Les tuiles qui PEUVENT diverger : celles qui portent un froid local (le champ ne change
    // rien ailleurs — il ne se lit que sous `cendreAge` non vide).
    const chaudes: number[] = []
    for (const [, tuiles] of EAU) for (const i of tuiles) {
      const tx = i % map.width, ty = Math.floor(i / map.width)
      if (froidDeFumerolleDeTuile(avec, tx, ty) + froidDeCendre(avec, tx, ty) > 0) chaudes.push(i)
    }
    expect(chaudes.length, 'des tuiles à froid local').toBeGreaterThan(100)
    // …plus un échantillon de l'eau FROIDE de chaque palier : le champ change la PORTE, qui vaut
    // pour tout le palier, pas seulement pour les tuiles chaudes.
    const cibles = [...chaudes, ...[...EAU.values()].flatMap((l) => l.filter((_, k) => k % 997 === 0))]
    let coupeAvec = 0, coupeSans = 0, points = 0, geles = 0
    const fautes: string[] = []
    for (let jour = 1; jour <= YEAR_DAYS; jour++) for (const [quand, nuit, part] of MOMENTS) {
      avec.tick = tickAu(avec, jour, nuit, part)
      sans.tick = avec.tick
      points++
      if (!gelPossibleAuPalier(avec, 0)) coupeAvec++
      if (!gelPossibleAuPalier(sans, 0)) coupeSans++
      for (const i of cibles) {
        const tx = i % map.width, ty = Math.floor(i / map.width)
        const a = estGele(avec, tx, ty)
        if (a) geles++
        const b = estGele(sans, tx, ty)
        if (a !== b && fautes.length < 8) fautes.push(`jour ${jour} ${quand} (${tx},${ty}) : avec=${a}, sans=${b}`)
      }
    }
    expect(fautes, fautes.join('\n')).toHaveLength(0)
    // NON-VACUITÉ : si rien ne gelait jamais, l'égalité ci-dessus serait triviale.
    expect(geles, 'des instants où ces tuiles sont RÉELLEMENT prises').toBeGreaterThan(100)
    // ② — et la porte coupe strictement plus souvent avec le champ. ⚠ La garde s'énonce en LOI
    //    (« strictement plus ») et garde le chiffre mesuré en commentaire : un seuil chiffré se
    //    périmerait au premier réglage du semis de fumerolles.
    expect(coupeSans, `la porte doit déjà couper quelque part sans le champ (sur ${points} points)`).toBeGreaterThan(0)
    expect(coupeAvec, `le champ rend des points à la porte (mesuré le 02/10 : 126 contre 74 sur 480)`).toBeGreaterThan(coupeSans)
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // LES DEUX TROUS DE COUVERTURE RAPPORTÉS PAR `determinisme-sim` LE 2026-10-03
  // ═════════════════════════════════════════════════════════════════════════════════════════

  it('LES DEUX BORNES TIENNENT SOUS UN FRONT — et la marge météo du plancher est EXACTEMENT nulle', () => {
    // ⚠ TOUT LE BLOC CI-DESSUS TOURNE EN `meteoActive: false`, DONC SANS FRONT : la moitié météo
    // des deux preuves n'était éprouvée par aucun test, alors que chacune tient à une inégalité
    // qui vit dans `meteo.ts` et non ici — donc à une table qu'un réglage de météo peut changer
    // sans jamais toucher au gel.
    //
    //  ① LE PLAFOND (« ici tout gèle ») ne retranche AUCUN terme météo : sa justesse exige que la
    //    météo ne puisse que REFROIDIR, c'est-à-dire `meteoColdAt ≥ 0`. Un `COLD` négatif — un
    //    redoux de pluie, un vent tiède — rendrait le majorant faux et la porte mentirait.
    //    C'est affirmé ici dans sa forme FORTE et locale : `T(avec front) ≤ T(sans front)`, sur
    //    la même tuile au même tick. (Le majorant SANS météo, lui, est balayé exhaustivement par
    //    la garde ③ ; ce qui manquait est le terme qui s'y ajoute.)
    //
    //  ② LE PLANCHER (« ici rien ne gèle ») retranche `coldMaximal(type)` — le PLEIN froid de la
    //    classe — là où la tuile ne prend que `effetOrage(…) × intensite`. Il faut donc
    //    `effetOrage ≤ coldMaximal` ET `intensite ≤ 1` ; sans ça la borne cesse d'être un
    //    minorant et la porte affirme « rien ne gèle » sous un blizzard.
    //
    // ⚠ ET ② EST TENDUE À ZÉRO — c'est pourquoi la garde la MESURE au lieu de s'en remettre à la
    //   lecture des tables : sous un ORAGE, `partDeBlizzard` sature à 1 dès que T₀ passe sous
    //   `LIMITE_NEIGE − BLIZZARD_RAMPE`, donc `effetOrage` vaut `ORAGE_FROID.COLD` (22) =
    //   `coldMaximal`, et `intensite` vaut exactement 1 dès qu'on est à plus de `RAMPE × largeur`
    //   des deux bords de la bande. Une borne LARGE passerait ① et ② sans rien protéger — la
    //   leçon de `F-borne-bis` : on exige donc le CONTACT, au bit.
    const sim = createSim(SEED, { map, calendarScale: 1, meteoActive: true })
    // LA CENDRE VIEILLIE EN PLUS DU FRONT : les cinq termes de l'exposition et le terme météo
    // sont vivants ENSEMBLE, ce qu'aucune garde ne jouait — et c'est le montage le plus dur.
    sim.cendreAge = agesDe(120)
    const seuilRef = (terrain: number): number | undefined =>
      terrain === TERRAIN_SHALLOW_WATER ? GEL.SEUIL_GUE : terrain === TERRAIN_DEEP_WATER ? GEL.SEUIL_PROFOND : undefined
    /** Les tuiles à froid local (là où les cinq termes jouent) + une sur 31 de toute l'eau. Le
     *  balayage exhaustif est déjà payé par la garde ③ ; le terme qui s'ajoute ici est CONTINU
     *  en tuile (une rampe de bande), donc un échantillon le voit — et on le VÉRIFIE plus bas
     *  en exigeant que le front morde vraiment sur ces cibles. */
    const cibles: { tx: number; ty: number; p: number }[] = []
    for (const [p, tuiles] of EAU) for (let k = 0; k < tuiles.length; k++) {
      const i = tuiles[k]!
      const tx = i % map.width, ty = Math.floor(i / map.width)
      if (k % 31 === 0 || froidDeFumerolleDeTuile(sim, tx, ty) + froidDeCendre(sim, tx, ty) > 0) cibles.push({ tx, ty, p })
    }
    expect(cibles.length, 'des cibles').toBeGreaterThan(400)

    const CLASSES = Object.keys(METEO.COLD) as MeteoFront['type'][]
    expect(CLASSES, 'la garde doit VOIR les quatre classes de front').toHaveLength(4)
    const majorant: string[] = []
    const minorant: string[] = []
    const divergences: string[] = []
    const refroidi: string[] = []
    /** La marge du minorant, et les instants où la porte COUPE vraiment, par classe — ce qui dit
     *  laquelle des quatre classes éprouve le court-circuit, et laquelle ne peut pas. */
    let margeMin = Number.POSITIVE_INFINITY
    const coupures = new Map<string, number>()
    /** Le pire froid RÉELLEMENT appliqué, par classe — contre `coldMaximal`, qui est ce que le
     *  plancher retranche. Mordre = l'écart `sans − avec` est non nul sur une cible. */
    const pire = new Map<string, number>()
    const morsures = new Map<string, number>()
    let vus = 0, geles = 0
    for (const type of CLASSES) {
      // `vent_de_cendre` entre toujours par le même bord dans le jeu (`meteo.ts:283`) : on garde
      // sa géométrie, les trois autres balaient depuis l'ouest.
      const edge: MeteoFront['edge'] = type === 'vent_de_cendre' ? 3 : 0
      for (const [nom, jour, nuit] of INSTANTS) {
        sim.tick = tickDe(sim, jour, nuit)
        // LE TÉMOIN D'ABORD, sur la même tuile et le même tick : c'est lui qui donne à ① sa
        // forme locale, et il ne coûte qu'une lecture puisqu'on les compare deux à deux.
        sim.meteo = null
        const sans = cibles.map((k) => baselineTemperature(sim, k.tx, k.ty))
        const front = frontSurLeTick(sim, type, edge)
        expect(sim.meteo, `${type} à ${nom} : le front est posé`).toBe(front)
        const plafonds = new Map<number, number>()
        const planchers = new Map<number, number>()
        for (const [p] of EAU) {
          plafonds.set(p, plafondDuPalier(sim, p))
          planchers.set(p, plancherDuPalier(sim, p))
          if (!gelPossibleAuPalier(sim, p)) coupures.set(type, (coupures.get(type) ?? 0) + 1)
        }
        for (let k = 0; k < cibles.length; k++) {
          const { tx, ty, p } = cibles[k]!
          const seuil = seuilRef(terrainAt(map, tx, ty))!
          const t = baselineTemperature(sim, tx, ty)
          const plafond = plafonds.get(p)!
          // ① le majorant, et sa forme locale — la météo ne peut que refroidir.
          if (t > plafond && majorant.length < 8) majorant.push(`${type} · ${nom} · p${p} (${tx},${ty}) : ${t} > plafond ${plafond}`)
          // ② en DIRECT, et c'est la clause qui compte : l'équivalence de `estGele` ne peut PAS
          //   voir un plancher faux sous l'orage, parce qu'il y retranche 22 °C de plus et que la
          //   porte n'y coupe alors JAMAIS (`coupures`, affirmé plus bas) — un court-circuit qui ne
          //   s'exécute pas ne peut pas se tromper. On lit donc la BORNE elle-même.
          const plancher = planchers.get(p)!
          if (t < plancher && minorant.length < 8) minorant.push(`${type} · ${nom} · p${p} (${tx},${ty}) : ${t} < plancher ${plancher}`)
          if (t - plancher < margeMin) margeMin = t - plancher
          if (t > sans[k]! && refroidi.length < 8) refroidi.push(`${type} · ${nom} · p${p} (${tx},${ty}) : avec front ${t} > sans front ${sans[k]} — la météo RÉCHAUFFE`)
          if (t !== sans[k]) morsures.set(type, (morsures.get(type) ?? 0) + 1)
          // ② l'équivalence : le plancher n'a pas changé un verdict sous le front.
          let attendu: boolean
          if (t < seuil) attendu = true
          else if (t >= seuil + GEL.HYSTERESIS) attendu = false
          else attendu = baselineTemperatureAt(sim, tx, ty, Math.max(0, sim.tick - GEL.RETARD_TICKS)) < seuil
          const obtenu = estGele(sim, tx, ty)
          vus++
          if (obtenu) geles++
          if (obtenu !== attendu && divergences.length < 8) {
            divergences.push(`${type} · ${nom} · p${p} (${tx},${ty}) : estGele=${obtenu}, la vérité est ${attendu} · T=${t} · porte p${p}=${gelPossibleAuPalier(sim, p)}`)
          }
          const froid = meteoColdAt(sim, tx, ty, sim.tick)
          if (froid > (pire.get(type) ?? 0)) pire.set(type, froid)
        }
      }
    }
    expect(majorant, majorant.join('\n')).toHaveLength(0)
    expect(minorant, minorant.join('\n')).toHaveLength(0)
    expect(refroidi, refroidi.join('\n')).toHaveLength(0)
    // ⚠ ET LA BORNE EST APPROCHÉE, sinon la clause ci-dessus serait SAINE MAIS INERTE : une marge
    //   lâche de plus d'un étage entier ne verrait aucune erreur de composition plus petite qu'elle.
    //   MESURÉ le 2026-10-03 : **2,0 °C** — le minorant est presque exact quelque part dans
    //   l'année, donc la clause voit une erreur de composition de quelques degrés.
    expect(margeMin, 'le minorant est approché à moins d’un étage').toBeLessThan(TEMPERATURE.FROID_PAR_ETAGE)
    expect(margeMin, 'et il n’est jamais franchi').toBeGreaterThanOrEqual(0)
    expect(divergences, divergences.join('\n')).toHaveLength(0)
    // ⚠ NON-VACUITÉ, EN TROIS CLAUSES — sans elles, un front qui n'aurait jamais atteint une
    //   cible rendrait les trois égalités ci-dessus triviales.
    expect(geles, 'des cibles RÉELLEMENT prises sous un front').toBeGreaterThan(100)
    expect(vus - geles, 'et des cibles LIBRES').toBeGreaterThan(100)
    for (const type of CLASSES) {
      if (METEO.COLD[type] === 0) {
        // LE BROUILLARD NE REFROIDIT PAS, AU BIT : `meteoColdSousFront` court-circuite sur
        // `cold === 0`, donc la température est identique bit pour bit. C'est le contrôle
        // NÉGATIF de la mesure : il montre que « 0 morsure » a bien le sens qu'on lui donne.
        expect(morsures.get(type) ?? 0, `${type} (COLD 0) ne doit pas changer un bit`).toBe(0)
        expect(pire.get(type) ?? 0, `${type} : froid appliqué nul`).toBe(0)
        continue
      }
      expect(morsures.get(type) ?? 0, `${type} : le front doit MORDRE sur des cibles`).toBeGreaterThan(100)

      // ② chiffrée : le plein froid de la classe majore ce qui est vraiment appliqué.
      expect(pire.get(type) ?? 0, `${type} : appliqué ≤ coldMaximal`).toBeLessThanOrEqual(coldMaximal(type))
    }
    // ⚠ LA PORTE DOIT COUPER QUELQUE PART, sinon le court-circuit n'est jamais exercé et
    //   l'équivalence de `estGele` est vraie pour rien. MESURÉ le 2026-10-03 : **2 coupures pour
    //   la pluie, le brouillard et le vent de cendre, et ZÉRO pour l'orage** — qui retranche 22 °C
    //   de plus et fait donc plonger le plancher sous le seuil à TOUS les paliers. C'est exactement
    //   pourquoi le minorant est examiné EN DIRECT plus haut : sous l'orage, aucune équivalence de
    //   verdict ne peut prendre la borne en défaut, seule la lecture de la borne le peut.
    expect([...coupures.values()].reduce((a, b) => a + b, 0), 'une classe au moins fait COUPER la porte').toBeGreaterThan(0)
    // ET LE CONTACT : sous l'orage, `partDeBlizzard` sature et la bande a un cœur — le pire
    // appliqué vaut EXACTEMENT ce que le plancher retranche. La marge est nulle : c'est ce qui
    // rend ② fragile, donc digne d'une garde.
    expect(pire.get('orage'), 'l’orage touche sa borne, au bit').toBe(coldMaximal('orage'))
  })

  it('LE PLANCHER DÉCROÎT EN PALIER — l’inégalité qui autorise `gelPossible` à ne lire que le sommet', () => {
    // `gelPossible` DÉLÈGUE à `gelPossibleAuPalier(PALIERS − 1)` (et elle nourrit `collision.ts`,
    // donc le tick, donc le replay) : toute sa justesse tient à ce que le plus HAUT palier ait le
    // plancher le plus BAS. C'était trivial jusqu'au 2026-10-02 — le seul terme de palier était
    // `− FROID_PAR_ETAGE × p`, monotone par construction. **Mon `souffleMax` par palier l'a rendu
    // CONDITIONNEL** : le plancher vaut `… − FROID_PAR_ETAGE × p − souffleMax[p]`, et `souffleMax`
    // n'est PAS monotone (MESURÉ : 8,09 / 8,09 / 9,75 / 9,75 — il CROÎT avec le palier, donc dans
    // le mauvais sens pour cette preuve). La décroissance tient si et seulement si
    //
    //      FROID_PAR_ETAGE  >  souffleMax[p] − souffleMax[p+1]   pour tout p,
    //
    // et on ne l'obtient pas du champ (qu'un réglage du semis de fumerolles change) mais des DEUX
    // TABLES : `souffleMax` est borné par le majorant GLOBAL, qui est lui-même dérivé de la table
    // des caractères de foyer. 28 contre 12,6 — large, mais rien ne le gardait.
    const champ = map.souffleMax
    expect(champ, 'la carte du monde JOUÉ porte le champ').toBeDefined()
    expect(champ).toHaveLength(TERRASSES.PALIERS)
    // ① LA LOI, sur les tables seules — vraie pour TOUT champ possible, pas pour celui-ci.
    expect(TEMPERATURE.FROID_PAR_ETAGE, 'un étage coûte plus froid que le pire souffle concevable')
      .toBeGreaterThan(SOUFFLE_GLOBAL)
    for (let p = 0; p < TERRASSES.PALIERS; p++) {
      expect(champ![p], `souffleMax[${p}] est un froid ≥ 0`).toBeGreaterThanOrEqual(0)
      expect(champ![p], `souffleMax[${p}] est borné par le majorant global`).toBeLessThanOrEqual(SOUFFLE_GLOBAL)
    }
    // ② LA CONSÉQUENCE sur le champ réel : le froid cumulé croît STRICTEMENT avec le palier.
    for (let p = 1; p < TERRASSES.PALIERS; p++) {
      expect(TEMPERATURE.FROID_PAR_ETAGE * p + champ![p]!, `le palier ${p} doit être plus froid que ${p - 1}`)
        .toBeGreaterThan(TEMPERATURE.FROID_PAR_ETAGE * (p - 1) + champ![p - 1]!)
    }
    // ③ ET SUR LA VALEUR, L'ANNÉE ENTIÈRE, DANS LES DEUX RÉGIMES DE CENDRE — car c'est la seule
    //   façon de l'éprouver.
    //
    // ⚠ **MA PREMIÈRE VERSION DE ③ NE POUVAIT PAS ÉCHOUER, et je l'ai écrite avant de le voir.**
    //   Elle affirmait l'implication entre PORTES — « si `p` peut geler, la vallée peut geler » —
    //   et cette implication est vraie quoi que fasse le plancher : `gelPossible` est le palier 3,
    //   dont la porte est OUVERTE à tout instant de l'année (26 °C de socle contre 84 °C de froid
    //   d'étage, journal du 2026-09-30 : 0/240 points où elle coupe). Une implication dont le
    //   conséquent est une tautologie ne garde rien. C'est pourquoi `plancherDuPalier` est
    //   désormais exportée : la monotonie vit dans la VALEUR, pas dans le verdict.
    //
    // ⚠ ET LES DEUX RÉGIMES DE CENDRE, pour la raison déjà apprise ce jour-là : sans `cendreAge`,
    //   le plancher ne lit même pas `souffleMax` (court-circuit) et sa monotonie redevient celle
    //   du seul terme d'étage — donc le régime NEUF est aveugle au conditionnel qu'on garde ici.
    let compares = 0
    let pireEcart = Number.POSITIVE_INFINITY
    const fautes: string[] = []
    for (const [nomRegime, ages] of [['cendre VIEILLIE (120 j)', agesDe(120)], ['cendre NEUVE', [] as number[]]] as const) {
      const sim = createSim(SEED, { map, calendarScale: 1, meteoActive: false })
      sim.cendreAge = [...ages]
      for (let jour = 1; jour <= YEAR_DAYS; jour++) for (const [quand, nuit, part] of MOMENTS) {
        sim.tick = tickAu(sim, jour, nuit, part)
        for (let p = 1; p < TERRASSES.PALIERS; p++) {
          const haut = plancherDuPalier(sim, p)
          const bas = plancherDuPalier(sim, p - 1)
          compares++
          if (bas - haut < pireEcart) pireEcart = bas - haut
          if (haut >= bas && fautes.length < 8) {
            fautes.push(`${nomRegime} · jour ${jour} ${quand} : plancher p${p} = ${haut} ≥ plancher p${p - 1} = ${bas}`)
          }
        }
      }
    }
    expect(fautes, fautes.join('\n')).toHaveLength(0)
    expect(compares, 'la garde ne passe pas à vide').toBeGreaterThan(1000)
    // L'ÉCART MINIMAL EST LA MARGE RÉELLE DE LA PREUVE, et on l'affirme en LOI : il vaut
    // `FROID_PAR_ETAGE + souffleMax[p] − souffleMax[p−1]`, donc au pire `FROID_PAR_ETAGE −
    // SOUFFLE_GLOBAL`. MESURÉ le 2026-10-03 : 28 °C (les paliers 0→1 et 2→3, où le souffle ne
    // bouge pas) — large, mais c'est un chiffre de table, pas une garantie de structure.
    expect(pireEcart, 'la marge de la décroissance').toBeGreaterThanOrEqual(
      TEMPERATURE.FROID_PAR_ETAGE - SOUFFLE_GLOBAL)
  })
})
