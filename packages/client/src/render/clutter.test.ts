import { describe, expect, it } from 'vitest'
import { TERRAIN_FOREST, TERRAIN_DEEP_WATER, TERRAIN_REED_MARSH, TERRAIN_WILLOW } from '@ashes/sim'
import { BIOME_CLUTTER, clutterAt, distToWater, type SampleTerrain } from './clutter'

const allForest: SampleTerrain = () => TERRAIN_FOREST
const SEED = 2026

describe('clutterAt', () => {
  it('rien sur un terrain sans décor (eau)', () => {
    expect(clutterAt(5, 5, TERRAIN_DEEP_WATER, SEED, () => TERRAIN_DEEP_WATER)).toEqual([])
  })

  it('déterministe (INV-5)', () => {
    const a = clutterAt(12, 34, TERRAIN_FOREST, SEED, allForest)
    const b = clutterAt(12, 34, TERRAIN_FOREST, SEED, allForest)
    expect(a).toEqual(b)
  })

  it('ne pose que des props de la table du biome (INV-2 cohérence)', () => {
    const allowed = new Set(BIOME_CLUTTER[TERRAIN_FOREST]!.props)
    for (let ty = 0; ty < 40; ty++) {
      for (let tx = 0; tx < 40; tx++) {
        for (const p of clutterAt(tx, ty, TERRAIN_FOREST, SEED, allForest)) {
          expect(allowed.has(p.kind)).toBe(true)
          expect(p.ox).toBeGreaterThan(-0.5)
          expect(p.ox).toBeLessThan(0.5)
          expect(p.oy).toBeGreaterThan(-0.5)
          expect(p.oy).toBeLessThan(0.5)
        }
      }
    }
  })

  it('répartition organique : sur-dispersion sur forêt homogène (INV-6)', () => {
    const cell = 8
    const N = 96
    const cols = N / cell
    const counts = new Array<number>((N / cell) * (N / cell)).fill(0)
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const k = clutterAt(tx, ty, TERRAIN_FOREST, SEED, allForest).length
        counts[Math.floor(ty / cell) * cols + Math.floor(tx / cell)]! += k
      }
    }
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length
    const variance = counts.reduce((s, c) => s + (c - mean) * (c - mean), 0) / counts.length
    expect(mean).toBeGreaterThan(0)
    expect(variance / mean).toBeGreaterThan(1.5)
  })
})

describe('distToWater (affinité réaliste, INV-6)', () => {
  // Colonne d'eau en x = 0 ; le reste roselière.
  const grid: SampleTerrain = (tx) => (tx <= 0 ? TERRAIN_DEEP_WATER : TERRAIN_REED_MARSH)

  it('0 au contact, croît en s\'éloignant, plafonne', () => {
    expect(distToWater(1, 5, grid, 3)).toBe(1)
    expect(distToWater(2, 5, grid, 3)).toBe(2)
    expect(distToWater(10, 5, grid, 3)).toBe(3) // plafonné au cap
  })

  it('les roseaux sont plus denses au bord de l\'eau qu\'au loin', () => {
    // Colonne au contact (tx=1, distToWater=1) vs colonne au loin (tx=12, plafond).
    let near = 0
    let far = 0
    for (let ty = 0; ty < 60; ty++) {
      near += clutterAt(1, ty, TERRAIN_REED_MARSH, SEED, grid).length
      far += clutterAt(12, ty, TERRAIN_REED_MARSH, SEED, grid).length
    }
    expect(near).toBeGreaterThan(far)
  })
})

describe('la berge de la saulaie (décision d\'Alexis, 2026-08-15 : « habille la berge »)', () => {
  // Colonne d'eau en x = 0 ; le reste saulaie (resp. forêt, pour le contre-cas).
  const bergeSaulaie: SampleTerrain = (tx) => (tx <= 0 ? TERRAIN_DEEP_WATER : TERRAIN_WILLOW)
  const bergeForet: SampleTerrain = (tx) => (tx <= 0 ? TERRAIN_DEEP_WATER : TERRAIN_FOREST)

  it('la saulaie au contact de l\'eau porte des props — la forêt, elle, garde sa berge nue', () => {
    let saulaie = 0
    let foret = 0
    for (let ty = 0; ty < 60; ty++) {
      saulaie += clutterAt(1, ty, TERRAIN_WILLOW, SEED, bergeSaulaie).length
      foret += clutterAt(1, ty, TERRAIN_FOREST, SEED, bergeForet).length
    }
    expect(saulaie).toBeGreaterThan(0) // la berge est habillée
    expect(foret).toBe(0) //              la règle de berge nue tient pour un bois ordinaire
  })

  it('plus dense au bord qu\'au loin — le régime de berge des roseaux', () => {
    // 800 rangées et pas 60 : le gradient de la saulaie est doux (×1,35 au contact contre
    // ×1,86 pour les roseaux) et le champ d'amas basse fréquence l'enterre sur un petit
    // échantillon (MESURÉ : ratio 0,95 à N=60, 1,27 à N=800).
    let near = 0
    let far = 0
    for (let ty = 0; ty < 800; ty++) {
      near += clutterAt(1, ty, TERRAIN_WILLOW, SEED, bergeSaulaie).length
      far += clutterAt(12, ty, TERRAIN_WILLOW, SEED, bergeSaulaie).length
    }
    expect(near).toBeGreaterThan(far)
  })

  it('la frange au sec ne fond PAS : loin de l\'eau, la saulaie garde son régime de bois', () => {
    // Tuile à tuile : à distance plafonnée de l'eau (tx=12), le semis est IDENTIQUE à celui
    // d'une saulaie sans eau du tout — le fondu 0.7 des roseaux ne s'applique jamais (la
    // frange est déjà effilochée côté sim par le hash 'RIPI', on ne la vide pas deux fois).
    const sansEau: SampleTerrain = () => TERRAIN_WILLOW
    for (let ty = 0; ty < 60; ty++) {
      expect(clutterAt(12, ty, TERRAIN_WILLOW, SEED, bergeSaulaie))
        .toEqual(clutterAt(12, ty, TERRAIN_WILLOW, SEED, sansEau))
    }
  })
})
