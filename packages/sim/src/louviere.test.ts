import { describe, it, expect } from 'vitest'
import { carteDeTest } from '../../../tools/carte-cache'
import { FAUNA, MONSTER_DEFS, TERRAINS, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { placeHuntingGrounds } from './faune'
import { distSq } from './geometry'
import { createEmptyMap } from './map'
import { advanceDens, capFor, POI_TYPES, spawnPoiMonsters } from './poi'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { MONDE_JOUE } from './zonegraph'

/**
 * LA LOUVIÈRE (décision d'Alexis, 2026-08-28) — le loup est une bête de LIEU.
 *
 * Trois promesses, chacune avec ce qui la ferait rougir :
 *   1. La meute naît PLEINE au worldgen (alpha compris) — rougirait : un lieu à
 *      un loup, ou une meute sans chef.
 *   2. Elle se reforme LOUP PAR LOUP, et le DOYEN est promu si le chef est tombé
 *      — rougirait : un lieu orphelin pour la saison (la coquille vide du vieux
 *      sanglier), ou une meute reformée sans alpha.
 *   3. Elle a SON coin de chasse : le gibier broute là où la meute rôde —
 *      rougirait : une Louvière sans coin à portée sur la vraie carte.
 */

const CARTE = carteDeTest(5)

/** Un petit monde à Louvière : forêt partout (l'habitat du loup), un lieu au centre. */
function mondeALouviere(): SimState {
  const map = createEmptyMap(120, 120, TERRAIN_FOREST)
  map.zones.push({ name: 'la Louvière', x: 58, y: 58, w: 3, h: 3, kind: 'louviere' })
  return createSim(1, { map })
}

describe('la meute pleine au worldgen', () => {
  it('une Louvière pose une meute entière — un alpha, une harde, des résidents', () => {
    const sim = mondeALouviere()
    spawnPoiMonsters(sim, 1)

    const loups = sim.monsters.filter((m) => m.type === 'wolf')
    const [lo, hi] = MONSTER_DEFS.wolf.herdSize!
    expect(loups.length).toBeGreaterThanOrEqual(lo)
    expect(loups.length).toBeLessThanOrEqual(hi)

    // Un chef, un seul — et toute la meute retient son nom (R12).
    const alphas = loups.filter((m) => m.alpha === true)
    expect(alphas.length).toBe(1)
    for (const m of loups) {
      expect(m.alphaId).toBe(alphas[0]!.entityId)
      expect(m.herdId).toBe(alphas[0]!.herdId)
      expect(m.homePoi).toBeDefined() // résident : il appartient au lieu
      expect(m.ambient).toBeUndefined() // …donc il ne se dissipe jamais (A3)
    }
    // L'alpha porte ses PV de chef, pleins.
    const chefEntity = sim.entities.find((e) => e.id === alphas[0]!.entityId)!
    expect(chefEntity.hp).toBeCloseTo(MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP, 5)

    // Et chaque loup est né sur une tuile marchable.
    for (const m of loups) {
      const e = sim.entities.find((ent) => ent.id === m.entityId)!
      expect(TERRAINS[sim.map.terrain[Math.floor(e.y) * sim.map.width + Math.floor(e.x)]!]?.walkable).toBe(true)
    }
  })

  it('déterministe : même seed → même meute, mêmes positions', () => {
    const a = mondeALouviere()
    const b = mondeALouviere()
    spawnPoiMonsters(a, 7)
    spawnPoiMonsters(b, 7)
    expect(a.entities.map((e) => [e.x, e.y])).toEqual(b.entities.map((e) => [e.x, e.y]))
    expect(a.monsters.map((m) => [m.herdId, m.alpha ?? false])).toEqual(b.monsters.map((m) => [m.herdId, m.alpha ?? false]))
  })
})

describe('le retour, loup par loup — et le doyen promu', () => {
  it('le chef tombé, la meute dispersée : le respawn reforme la meute autour du DOYEN', () => {
    const sim = mondeALouviere()
    spawnPoiMonsters(sim, 1)
    const loups = (): typeof sim.monsters => sim.monsters.filter((m) => m.type === 'wolf')
    const avant = loups().length

    // R12 : l'alpha meurt, la meute éclate. On rejoue la mort et la dispersion
    // telles que le combat les produit (retrait du mort, déroute des survivants).
    const chef = loups().find((m) => m.alpha === true)!
    sim.monsters = sim.monsters.filter((m) => m.entityId !== chef.entityId)
    sim.entities = sim.entities.filter((e) => e.id !== chef.entityId)
    for (const m of loups()) {
      m.routed = true
      delete m.herdId
    }

    // Le respawn est LENT, et il rend UN loup à la fois.
    advanceDens(sim, 1) // arme le minuteur
    expect(loups().length).toBe(avant - 1)
    sim.tick += FAUNA.DEN_RESPAWN_TICKS + 1
    advanceDens(sim, 1) // l'heure est venue — personne ne campe le lieu
    expect(loups().length).toBe(avant)

    // La meute s'est REFORMÉE : un alpha (le doyen — le plus ancien entityId),
    // une seule harde, et plus un seul dérouté.
    const pack = loups()
    const alphas = pack.filter((m) => m.alpha === true)
    expect(alphas.length).toBe(1)
    const doyen = pack.reduce((x, y) => (x.entityId < y.entityId ? x : y))
    expect(alphas[0]!.entityId).toBe(doyen.entityId)
    for (const m of pack) {
      expect(m.alphaId).toBe(doyen.entityId)
      expect(m.herdId).toBe(doyen.herdId)
      expect(m.routed).toBeUndefined()
    }
  })

  it('jamais sous les yeux : un avatar qui campe le lieu suspend le retour', () => {
    const sim = mondeALouviere()
    spawnPoiMonsters(sim, 1)
    const avant = sim.monsters.filter((m) => m.type === 'wolf').length
    const mort = sim.monsters.find((m) => m.type === 'wolf' && m.alpha !== true)!
    sim.monsters = sim.monsters.filter((m) => m.entityId !== mort.entityId)
    sim.entities = sim.entities.filter((e) => e.id !== mort.entityId)

    spawnEntity(sim, 59.5, 59.5) // un campeur au cœur du lieu
    advanceDens(sim, 1)
    sim.tick += FAUNA.DEN_RESPAWN_TICKS + 1
    advanceDens(sim, 1)
    expect(sim.monsters.filter((m) => m.type === 'wolf').length).toBe(avant - 1) // on attend
  })
})

describe('la laisse du territoire', () => {
  it('un loup emmené hors de son territoire y RENTRE quand plus rien ne le retient', () => {
    const sim = mondeALouviere()
    spawnPoiMonsters(sim, 1)
    const loup = sim.monsters.find((m) => m.type === 'wolf')!
    const e = sim.entities.find((ent) => ent.id === loup.entityId)!
    // Loin du lieu (59.5, 59.5), mais toujours DANS son habitat (tout est forêt) :
    // `goHome` n'a rien à dire, seule la laisse peut le ramener.
    e.x = 59.5 + FAUNA.DEN_TERRITORY + 14
    e.y = 59.5
    const d0 = Math.sqrt(distSq(e.x, e.y, 59.5, 59.5))

    for (let t = 0; t < 60 * 20 && distSq(e.x, e.y, 59.5, 59.5) > FAUNA.DEN_COMFORT * FAUNA.DEN_COMFORT; t++) {
      step(sim, [])
    }
    const d1 = Math.sqrt(distSq(e.x, e.y, 59.5, 59.5))
    expect(d1).toBeLessThan(d0) // il est rentré, pas resté planté
    expect(d1).toBeLessThanOrEqual(FAUNA.DEN_TERRITORY) // …et il est chez lui
  })
})

describe("l'interrupteur de la nuit qui chasse", () => {
  /**
   * « Désactive ce système pour l'instant » (décision d'Alexis, 2026-08-28) :
   * l'hôte du VRAI jeu passe `nightHunt: false`, et plus rien ne se lève sur un
   * dormeur. Le témoin (même montage, interrupteur au défaut) prouve que la
   * pression mesurée existait — sans lui, un zéro dirait ce qu'on veut entendre.
   */
  function nuitSousPression(nightHunt: boolean | undefined): number {
    const map = createEmptyMap(120, 120, TERRAIN_FOREST)
    const sim = createSim(31, {
      map,
      // Le Grand Froid à 2 h du matin : la nuit qui chasse à son maximum (0,55/min).
      jourDeDepart: 50,
      cycleOffset: cycleOffsetForStartHour(2, 50),
      ...(nightHunt === undefined ? {} : { nightHunt }),
    })
    spawnEntity(sim, 60.5, 60.5)
    for (let t = 0; t < 14400; t++) step(sim, []) // douze minutes réelles de nuit
    // `faunaCap` vaut 0 (pas de peuplement ambiant) et aucun lieu : tout monstre
    // né ici vient de la nuit qui chasse — loup ou Cendreux, peu importe l'espèce.
    return sim.monsters.length
  }

  it("éteinte par l'hôte : RIEN ne se lève — et le témoin armé prouve la pression", () => {
    expect(nuitSousPression(false)).toBe(0)
    expect(nuitSousPression(undefined)).toBeGreaterThan(0) // le défaut reste armé (bancs)
  })
})

describe('le coin de chasse de la Louvière (la garde du lien)', () => {
  it('sans coin Poisson à portée, `placeHuntingGrounds` en SÈME un pour la Louvière — et sans Louvière, rien', () => {
    // Un monde qui ne peut porter un coin QUE près de la Louvière : l'eau et le
    // dortoir n'existent que là. Les graines du Poisson, ailleurs, échouent toutes.
    const bati = (): ReturnType<typeof createEmptyMap> => {
      const map = createEmptyMap(300, 300, TERRAIN_GRASS)
      for (let ty = 140; ty < 146; ty++) for (let tx = 120; tx < 126; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER // la mare
      for (let ty = 150; ty < 158; ty++) for (let tx = 150; tx < 158; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST // le massif-dortoir
      return map
    }
    const sans = bati()
    expect(placeHuntingGrounds(sans, 5).length).toBe(0) // le témoin : ce monde ne fait AUCUN coin tout seul

    const avec = bati()
    avec.zones.push({ name: 'la Louvière', x: 138, y: 138, w: 3, h: 3, kind: 'louviere' })
    const grounds = placeHuntingGrounds(avec, 5)
    expect(grounds.length).toBeGreaterThanOrEqual(1)
    const den = { x: 138 + 1.5, y: 138 + 1.5 }
    const proche = grounds.some((g) => distSq(g.x, g.y, Math.floor(den.x) + 0.5, Math.floor(den.y) + 0.5) <= FAUNA.GROUND_RADIUS * FAUNA.GROUND_RADIUS)
    expect(proche).toBe(true)
  })

  /**
   * DEUX MONDES, DEUX RECENSEMENTS — la leçon coûte cher à chaque fois qu'on
   * l'oublie : la vallée entière ('vallee', le défaut de `carteDeTest`) N'EST PAS
   * le monde joué (`MONDE_JOUE` = le T0 seul). La première version de la Louvière
   * (zones Sylve + Alpages) passait ce banc sur la vallée… et donnait ZÉRO
   * Louvière dans la partie réelle — attrapé au smoke, pas ici. D'où `pres_bas`
   * (décision d'Alexis, 2026-08-28) et ce recensement dédoublé.
   */
  function recense(carte: { map: typeof CARTE.map }, seed: number): void {
    const louvieres = carte.map.zones.filter((z) => z.kind === 'louviere')
    expect(louvieres.length).toBeGreaterThanOrEqual(1) // le filet de réservation la garantit
    // Rare et marquante : le cap (3) suit la surface de la carte (`capFor`) — on
    // le DÉRIVE, on ne réécrit pas le nombre (l'étalon d'un plafond est sa loi).
    const type = POI_TYPES.find((t) => t.slug === 'louviere')!
    expect(louvieres.length).toBeLessThanOrEqual(capFor(carte.map, type))

    const grounds = placeHuntingGrounds(carte.map, seed)
    for (const z of louvieres) {
      const cx = Math.floor(z.x + z.w / 2) + 0.5
      const cy = Math.floor(z.y + z.h / 2) + 0.5
      const couverte = grounds.some((g) => distSq(g.x, g.y, cx, cy) <= FAUNA.GROUND_RADIUS * FAUNA.GROUND_RADIUS)
      expect(couverte, `la Louvière « ${z.name} » (${z.x},${z.y}) n'a aucun coin de chasse à portée`).toBe(true)
    }
  }

  it('recensement sur la vallée entière : des Louvières naissent, et chacune a son coin à portée', () => {
    recense(CARTE, 5)
  })

  it('recensement sur le MONDE JOUÉ (T0 seul) : la partie réelle a ses Louvières, chacune avec son coin', () => {
    recense(carteDeTest(5, undefined, MONDE_JOUE), 5)
  })
})
