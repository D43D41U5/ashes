/**
 * LE SOL DESSINÉ — chantier 2 : ce qui pousse est mou (spec `sol-dessine.md`, R1-R4, R6).
 *
 * Décision d'Alexis du 2026-08-22 : la végétation des Prés Bas se décide À LA TUILE, le champ
 * d'humidité restant au motif. Les gardes ci-dessous sont les MESURES qui ont tranché, devenues
 * contrat : avant ce chantier, 100 % des bords de tache tombaient sur un multiple de 8.
 *
 * A1-A3 se mesurent sur les VRAIES cartes (seeds de garde 2026/7/42) ; R1 sur un champ bâti à la
 * main, pour que la lecture se vérifie indépendamment du worldgen.
 */
import { describe, expect, it } from 'vitest'
import {
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_BOULDERS,
  TERRAIN_BURNT_FOREST,
  TERRAIN_CLIFF,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_JUNIPER_HEATH,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PEAT_BOG,
  TERRAIN_PINE,
  TERRAIN_REED_MARSH,
  TERRAIN_ROCK,
  TERRAIN_SCREE,
  TERRAIN_SNOW,
  TERRAIN_WET_MEADOW,
} from './balance'
import { MONDE } from './zonegraph'
import { type CarteZonee } from './zonegen'
import { carteDeTest } from '../../../tools/carte-cache'
import { CREUX, humAt, type Creux } from './racine-relief'

const SEEDS = [2026, 7, 42]
const mondes: CarteZonee[] = SEEDS.map((seed) => carteDeTest(seed))

/** L'échelle à cinq étages — les terrains que la passe des Prés Bas décide. */
const ECHELLE = new Set([TERRAIN_WET_MEADOW, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_FLOWER_MEADOW, TERRAIN_JUNIPER_HEATH])

interface Releve {
  /** Transitions entre deux terrains de l'échelle, et combien tombent sur la grille de 8. */
  bordsX: number
  bordsXGrille: number
  bordsY: number
  bordsYGrille: number
  /** Tuiles de l'échelle, et combien n'ont AUCUN voisin (4-connexité) de leur terrain. */
  tuiles: number
  isolees: number
}

function relever(c: CarteZonee): Releve {
  const { width, height, terrain } = c.map
  const racine = c.graphe.racine
  const r: Releve = { bordsX: 0, bordsXGrille: 0, bordsY: 0, bordsYGrille: 0, tuiles: 0, isolees: 0 }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (c.zone[i] !== racine) continue
      const t = terrain[i]!
      if (!ECHELLE.has(t)) continue
      r.tuiles++
      const droite = terrain[i + 1]!
      const bas = terrain[i + width]!
      if (ECHELLE.has(droite) && droite !== t) {
        r.bordsX++
        if ((x + 1) % CREUX.MOTIF === 0) r.bordsXGrille++
      }
      if (ECHELLE.has(bas) && bas !== t) {
        r.bordsY++
        if ((y + 1) % CREUX.MOTIF === 0) r.bordsYGrille++
      }
      if (droite !== t && bas !== t && terrain[i - 1] !== t && terrain[i - width] !== t) r.isolees++
    }
  }
  return r
}

describe('A1 (R2) — aucun bord de végétation ne privilégie la grille de 8', () => {
  it('la part des bords sur la grille est celle d’une géométrie indifférente (≈ 1/8), en x et en y', () => {
    for (const c of mondes) {
      const seed = c.graphe.seed
      const r = relever(c)
      // La PRÉMISSE : il y a de quoi mesurer (des dizaines de milliers de bords par seed).
      expect(r.bordsX, `seed ${seed} : pas assez de bords en x`).toBeGreaterThan(5000)
      expect(r.bordsY, `seed ${seed} : pas assez de bords en y`).toBeGreaterThan(5000)
      // MESURÉ le 2026-08-22 : 12,0-12,6 % en x, 11,9-12,5 % en y (attendu 12,5 %). Avant : 100 %.
      expect(r.bordsXGrille / r.bordsX, `seed ${seed} : bords x sur la grille`).toBeLessThanOrEqual(0.25)
      expect(r.bordsYGrille / r.bordsY, `seed ${seed} : bords y sur la grille`).toBeLessThanOrEqual(0.25)
    }
  })
})

describe('A3 (R4) — une tache est une forme, pas un semis', () => {
  it('moins de 1 % des tuiles de l’échelle sont sans aucun voisin de leur terrain', () => {
    for (const c of mondes) {
      const r = relever(c)
      // MESURÉ le 2026-08-22 : 0,04 % sur les trois seeds. Le plafond de 1 % borne l'amplitude
      // du grain fin (`GRAIN_TUILE_AMPLITUDE`) : trop fort, c'est ici que ça rougit.
      expect(r.isolees / r.tuiles, `seed ${c.graphe.seed} : tuiles isolées`).toBeLessThanOrEqual(0.01)
    }
  })
})

describe('R1 — la lecture à la tuile interpole le champ, elle ne le recalcule pas', () => {
  /** Un champ de 3×3 cellules, valeurs choisies, grain fin coupé (sel 0 → fbm2 quand même ; on
   *  borne par l'amplitude). */
  function champ(valeurs: number[]): Creux {
    const n = valeurs.length
    return {
      mx0: 0, my0: 0, cols: 3, rows: 3,
      alt: new Float64Array(n), altLarge: new Float64Array(n), dedans: new Uint8Array(n).fill(1),
      distEau: new Int32Array(n), hum: Float64Array.from(valeurs),
      seuilBassin: 0, seuilPrairie: 2, seuilBois: 1, seuilFleuraie: 0, seuilLande: -1, selGrain: 7,
      // Roche NEUTRE : le banc éprouve l'interpolation du champ, pas le second axe.
      roche: new Float64Array(n), seuilCalcaire: -0.5, seuilArgile: 1.5,
    }
  }
  const M = CREUX.MOTIF
  const demiGrain = CREUX.GRAIN_TUILE_AMPLITUDE / 2

  it('au centre d’une cellule, la tuile lit la valeur de sa cellule (± le grain fin)', () => {
    const c = champ([0, 0, 0, 0, 1, 0, 0, 0, 0])
    // Centre de la cellule (1,1) : tuile (M + M/2 − 0,5) → en entiers, la tuile M + M/2 - 1 et
    // M + M/2 encadrent le centre ; on lit les deux, chacune à ≤ 1/M de l'écart près.
    const x = M + M / 2
    const h = humAt(c, x, x)
    expect(Math.abs(h - 1)).toBeLessThanOrEqual(demiGrain + 2 / M)
    // Loin de la bosse, la valeur retombe à 0 (± grain) — le champ n'est PAS recalculé.
    const h0 = humAt(c, 1, 1)
    expect(Math.abs(h0)).toBeLessThanOrEqual(demiGrain + 2 / M)
  })

  it('entre deux centres, la lecture est la moyenne des deux cellules (± le grain fin)', () => {
    const c = champ([0, 1, 0, 0, 1, 0, 0, 1, 0])
    // À mi-chemin horizontal entre la cellule (0,1) [valeur 0] et la cellule (1,1) [valeur 1].
    const x = M // la frontière des cellules 0 et 1 est à mi-chemin de leurs centres
    const y = M + M / 2
    const h = humAt(c, x, y)
    expect(Math.abs(h - 0.5)).toBeLessThanOrEqual(demiGrain + 2 / M)
  })

  it('au bord de la grille, aucune lecture hors tableau — la cellule manquante est la cellule elle-même', () => {
    const c = champ([1, 1, 1, 1, 1, 1, 1, 1, 1])
    for (const [x, y] of [[0, 0], [3 * M - 1, 0], [0, 3 * M - 1], [3 * M - 1, 3 * M - 1], [-5, -5], [3 * M + 5, 3 * M + 5]]) {
      const h = humAt(c, x!, y!)
      expect(Number.isFinite(h)).toBe(true)
      expect(Math.abs(h - 1)).toBeLessThanOrEqual(demiGrain)
    }
  })

  it('est déterministe et pure : deux lectures, même résultat', () => {
    const c = champ([0.2, 0.4, 0.6, 0.1, 0.9, 0.3, 0.5, 0.5, 0.5])
    for (let y = 0; y < 3 * M; y += 3) {
      for (let x = 0; x < 3 * M; x += 3) expect(humAt(c, x, y)).toBe(humAt(c, x, y))
    }
  })
})

/**
 * ═══ R20-R21 — LES FRONTIÈRES UNIVERSELLES : le monde entier passe à la tuile (2026-08-27) ═══
 *
 * Retour d'Alexis : *« beaucoup de frontières de biomes sont trop droites (scree vs boulder par
 * exemple) ; il faudrait trouver une gestion universelle des frontières entre biomes de même
 * hauteur. »* La cause était UNE ligne — `solDe` échantillonnait au centre du motif de 8, donc
 * toute zone hors Racine sortait en damier. Ce que R1 avait réparé pour le pré n'avait jamais
 * quitté la Racine.
 *
 * LA MESURE N'EST PAS CELLE DE R2, ET C'EST VOULU. R2 demande « ce bord tombe-t-il sur la grille
 * de 8 ? » — le grain fin suffit à le faire mentir : une frontière peut être hors grille et
 * parfaitement rectiligne. On mesure donc ce qu'Alexis a VU : la longueur des SEGMENTS DE BORD
 * rectilignes. Un bord organique casse tous les 1 à 2 tuiles ; un bord décidé par cellule fait
 * des runs de 8 et plus.
 *
 * SUR LA VALLÉE ENTIÈRE, pas sur le monde joué : les zones fautives (Karst, Sylve, Alpages,
 * Tourbière, Brûlé, Aiguilles, Gouffre, Glacier) n'existent que là. Les cartes sont en cache
 * (`carteDeTest`) — la vallée est déjà générée par une trentaine d'autres tests.
 */
describe('R20 — aucune frontière de biome ne sort en gros carrés (vallée entière)', () => {
  const vallees: CarteZonee[] = SEEDS.map((seed) => carteDeTest(seed, MONDE.JOUEURS_CIBLE, 'vallee'))

  /**
   * LES PAIRES QUE `solDe` DÉCIDE — celles dont ce chantier répond. Chacune était entre 87 % et
   * 100 % de segments longs avant, mesurée sur la seed 2026.
   *
   * Les deux dernières sont le CONTOUR des bosquets de crête (R23) : Alexis les a signalées après
   * coup — *« il y a toujours des patterns carrés, au niveau de pine et larch vs le reste »* — et
   * R21, qui n'avait réparé que l'essence à l'intérieur du bois, les laissait à 69,6 %.
   *
   * ⚠ Ce qui n'y est PAS y manque exprès, et c'est consigné dans la spec : la frange de la
   * saulaie ('RIPI'), la succession du Versant Brûlé (`STADES_BRULE`) et la frange de marais ont
   * chacun leur propre peintre, encore au motif — un chantier chacun. Les affirmer ici ferait
   * rougir la garde pour un défaut qu'elle ne couvre pas.
   */
  const PAIRES: readonly (readonly [number, number, string])[] = [
    [TERRAIN_SCREE, TERRAIN_BOULDERS, 'éboulis / chaos de blocs'],
    [TERRAIN_PINE, TERRAIN_LARCH, 'pins / mélèzes'],
    [TERRAIN_BOULDERS, TERRAIN_BURNT_FOREST, 'chaos de blocs / brûlé'],
    [TERRAIN_ALPINE_MEADOW, TERRAIN_ALPINE_FLOWERS, 'alpage / fleurs alpines'],
    [TERRAIN_PEAT_BOG, TERRAIN_REED_MARSH, 'tourbe / roselière'],
    [TERRAIN_LARCH, TERRAIN_OLD_GROWTH, 'mélèzes / vieille futaie'],
    [TERRAIN_PINE, TERRAIN_OLD_GROWTH, 'pins / vieille futaie'],
    [TERRAIN_SCREE, TERRAIN_SNOW, 'éboulis / neige'],
    [TERRAIN_GRASS, TERRAIN_LARCH, 'herbe / mélèzes (contour du bosquet de crête)'],
    [TERRAIN_GRASS, TERRAIN_PINE, 'herbe / pins (contour du bosquet de crête)'],
  ]

  /** Le plafond : la part des bords portés par un segment rectiligne de ≥ 8 tuiles. */
  const PLAFOND = 0.25
  const LONG = 8

  /**
   * La part des bords (a|b) portés par un segment rectiligne d'au moins `LONG` tuiles.
   *
   * Un « segment » est une suite maximale d'arêtes colinéaires SÉPARANT LES MÊMES DEUX TERRAINS
   * DANS LE MÊME SENS : les arêtes verticales s'enfilent selon y, les horizontales selon x. Le
   * sens compte — un bord qui serpente change de sens, et deux serpents accolés ne doivent pas
   * se compter comme une droite.
   */
  function partDesLongsSegments(c: CarteZonee, a: number, b: number): { part: number; bords: number } {
    const { width, height, terrain } = c.map
    let bords = 0
    let longs = 0
    const paire = (u: number, v: number): boolean => (u === a && v === b) || (u === b && v === a)

    // Arêtes verticales (entre (x,y) et (x+1,y)), enfilées selon y.
    const vus = new Uint8Array(width * height)
    for (let x = 0; x + 1 < width; x++) {
      for (let y = 0; y < height; y++) {
        const i = y * width + x
        const g = terrain[i]!
        const d = terrain[i + 1]!
        if (!paire(g, d)) continue
        bords++
        if (vus[i] === 1) continue
        let len = 0
        for (let yy = y; yy < height && terrain[yy * width + x] === g && terrain[yy * width + x + 1] === d; yy++) {
          vus[yy * width + x] = 1
          len++
        }
        if (len >= LONG) longs += len
      }
    }
    // Arêtes horizontales (entre (x,y) et (x,y+1)), enfilées selon x.
    const vusH = new Uint8Array(width * height)
    for (let y = 0; y + 1 < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const h = terrain[i]!
        const bas = terrain[i + width]!
        if (!paire(h, bas)) continue
        bords++
        if (vusH[i] === 1) continue
        let len = 0
        for (let xx = x; xx < width && terrain[y * width + xx] === h && terrain[(y + 1) * width + xx] === bas; xx++) {
          vusH[y * width + xx] = 1
          len++
        }
        if (len >= LONG) longs += len
      }
    }
    return { part: bords === 0 ? 0 : longs / bords, bords }
  }

  for (const [a, b, nom] of PAIRES) {
    it(`${nom} : ≤ ${PLAFOND * 100} % des bords sur un segment droit de ${LONG}+ tuiles`, () => {
      for (let i = 0; i < vallees.length; i++) {
        const { part, bords } = partDesLongsSegments(vallees[i]!, a, b)
        // La garde EXIGE SA PRÉMISSE : une paire absente de la carte rendrait 0 % et passerait
        // pour un succès. 400 bords, c'est de quoi mesurer une forme — et pas plus, parce que
        // le partage pin/mélèze varie d'une graine à l'autre : la seed 42 penche du côté des
        // mélèzes et ne laisse que 880 bords herbe/pins, ce qui reste une frontière bien réelle.
        expect(bords, `${nom}, seed ${SEEDS[i]} : la paire a disparu de la carte`).toBeGreaterThan(400)
        expect(part, `${nom}, seed ${SEEDS[i]} : ${(part * 100).toFixed(1)} % (${bords} bords)`)
          .toBeLessThanOrEqual(PLAFOND)
      }
    })
  }

  /**
   * R21 — LE MUR RESTE DROIT. C'est la moitié de la règle qu'Alexis a posée (« entre biomes de
   * MÊME HAUTEUR ») : la roche du vide et la falaise SONT une hauteur, et R32 continue de les
   * gouverner. Sans cette garde, un chantier futur pourrait attendrir le mur en croyant bien
   * faire — et la carte perdrait ce qui la rend lisible.
   */
  it('le mur du vide, lui, garde ses arêtes de bloc', () => {
    const { part, bords } = partDesLongsSegments(vallees[0]!, TERRAIN_ROCK, TERRAIN_CLIFF)
    expect(bords).toBeGreaterThan(1000)
    expect(part).toBeGreaterThan(0.9)
  })
})
