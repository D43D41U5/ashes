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
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_JUNIPER_HEATH,
  TERRAIN_WET_MEADOW,
} from './balance'
import { generateZonedTerrain, type CarteZonee } from './zonegen'
import { CREUX, humAt, type Creux } from './racine-relief'

const SEEDS = [2026, 7, 42]
const mondes: CarteZonee[] = SEEDS.map((seed) => generateZonedTerrain(seed))

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
