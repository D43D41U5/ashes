import { describe, expect, it } from 'vitest'
import { fbm2, fbmWarp2, gradientNoise2, hash2, ridgedFbm2 } from './noise'

describe('le bruit déterministe', () => {
  it('hash2 est stable, seedé, et dans [0, 1)', () => {
    expect(hash2(12, 34)).toBe(hash2(12, 34))
    expect(hash2(12, 34)).not.toBe(hash2(34, 12))
    expect(hash2(12, 34, 7)).not.toBe(hash2(12, 34, 8))
    for (let i = 0; i < 1000; i++) {
      const v = hash2(i, i * 31, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('hash2 sans seed reproduit le hash historique de demo-map (shading client)', () => {
    let h = (12 * 374761393 + 34 * 668265263) >>> 0
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
    const expected = ((h ^ (h >>> 16)) >>> 0) / 4294967296
    expect(hash2(12, 34)).toBe(expected)
  })

  it('gradientNoise2 vaut exactement 0.5 aux nœuds entiers (signature du bruit gradient)', () => {
    // Le fade quintique annule la contribution des coins voisins aux entiers.
    expect(gradientNoise2(5, 9, 3)).toBe(0.5)
    expect(gradientNoise2(0, 0, 0)).toBe(0.5)
    expect(gradientNoise2(-4, 12, 99)).toBe(0.5)
  })

  it('gradientNoise2 est stable, dans [0, 1), et continu', () => {
    expect(gradientNoise2(3.2, 5.7, 1)).toBe(gradientNoise2(3.2, 5.7, 1))
    for (let i = 0; i < 1000; i++) {
      const v = gradientNoise2(i * 1.3, i * 0.7, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    const a = gradientNoise2(3.0, 5.0, 1)
    const b = gradientNoise2(3.002, 5.0, 1)
    expect(Math.abs(a - b)).toBeLessThan(0.02)
  })

  it('gradientNoise2 a une moyenne empirique proche de 0.5 (symétrique autour de 0)', () => {
    let sum = 0
    let n = 0
    for (let i = 0; i < 400; i++) {
      sum += gradientNoise2(i * 0.37 + 0.13, i * 0.61 + 0.29, 7)
      n += 1
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.05)
  })

  it('fbm2 est stable et dans [0, 1)', () => {
    expect(fbm2(40, 60, 24, 2026)).toBe(fbm2(40, 60, 24, 2026))
    for (let i = 0; i < 500; i++) {
      const v = fbm2(i * 1.7, i * 0.9, 24, 99)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('fbmWarp2 à amplitude 0 est identique à fbm2 (bit à bit)', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 1.9 + 0.3
      const y = i * 0.8 + 0.7
      expect(fbmWarp2(x, y, 24, 2026, 0)).toBe(fbm2(x, y, 24, 2026))
    }
  })

  it('fbmWarp2 à amplitude > 0 déplace l\'échantillonnage (diffère de fbm2)', () => {
    let differ = 0
    for (let i = 0; i < 200; i++) {
      const x = i * 1.9 + 0.3
      const y = i * 0.8 + 0.7
      if (fbmWarp2(x, y, 24, 2026, 8) !== fbm2(x, y, 24, 2026)) differ += 1
    }
    expect(differ).toBeGreaterThan(150) // la grande majorité des points bougent
  })

  it('fbmWarp2 est stable et dans [0, 1)', () => {
    expect(fbmWarp2(40, 60, 24, 7, 8)).toBe(fbmWarp2(40, 60, 24, 7, 8))
    for (let i = 0; i < 400; i++) {
      const v = fbmWarp2(i * 1.3, i * 0.7, 16, 5, 8)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('ridgedFbm2 est stable, dans [0,1], et « crêté » (variance haute)', () => {
    expect(ridgedFbm2(12, 34, 20, 7)).toBe(ridgedFbm2(12, 34, 20, 7))
    let min = 1, max = 0
    for (let i = 0; i < 800; i++) {
      const v = ridgedFbm2(i * 1.3, i * 0.7, 20, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      min = Math.min(min, v); max = Math.max(max, v)
    }
    // Un bruit ridged doit couvrir une large plage (crêtes ↔ creux).
    expect(max - min).toBeGreaterThan(0.6)
  })
})

/**
 * LES TÉMOINS DE BIT-EXACTITUDE — la garde qui manquait à l'invariant n°2.
 *
 * Tous les autres tests de ce fichier vérifient des PROPRIÉTÉS (bornes,
 * continuité, moyenne, stabilité intra-run). Aucun ne mord si le bruit change
 * de valeurs : une réécriture qui décale tout de 1e-16 les passe TOUS, et
 * pourtant elle casse le contrat « même seed → même carte » — silencieusement,
 * puisque la carte reste plausible.
 *
 * Ces valeurs sont donc figées ici EN DUR, relevées sur l'implémentation
 * d'origine (commit 6613b36) avant l'optimisation des gradients à plat. Elles
 * ne « testent » rien de sémantique : elles ancrent le bruit. Un échec ici
 * n'est jamais un test à mettre à jour à la légère — c'est la carte de tous
 * les joueurs, tous les replays et tous les scénarios enregistrés qui viennent
 * de changer. Si le changement est VOULU, il se décide et se consigne
 * (docs/decisions.md) ; sinon, c'est une régression.
 *
 * `toBe` (égalité stricte), jamais `toBeCloseTo` : la précision approchée est
 * précisément ce que l'invariant interdit.
 */
describe('bit-exactitude du bruit (invariant n°2)', () => {
  const PTS: readonly (readonly [number, number])[] = [
    [0, 0], [1, 1], [3.25, 7.75], [40, 60], [123.5, 456.25], [-7.5, 12.125], [1199, 1799],
  ]
  const SEED = 2026 // la seed du jeu

  it('hash2 rend exactement les valeurs d’origine', () => {
    const golden = [
      0.7262400619219989, 0.32611275278031826, 0.6127055876422673, 0.708349711727351,
      0.16241328208707273, 0.6032342112157494, 0.5408256405498832,
    ]
    PTS.forEach(([x, y], i) => {
      expect(hash2(Math.floor(x), Math.floor(y), SEED)).toBe(golden[i])
    })
  })

  it('gradientNoise2 rend exactement les valeurs d’origine', () => {
    const golden = [
      0.5, 0.5, 0.42311573028564453, 0.5, 0.612060546875, 0.8719902038574219, 0.5,
    ]
    PTS.forEach(([x, y], i) => expect(gradientNoise2(x, y, SEED)).toBe(golden[i]))
  })

  it('fbm2 rend exactement les valeurs d’origine', () => {
    const golden = [
      0.5, 0.5439038023884537, 0.5298622892255099, 0.4623750734861846,
      0.6222123649057745, 0.5470947381605876, 0.5494005324931976,
    ]
    PTS.forEach(([x, y], i) => expect(fbm2(x, y, 24, SEED)).toBe(golden[i]))
  })

  it('fbmWarp2 rend exactement les valeurs d’origine', () => {
    const golden = [
      0.5, 0.5273517754396571, 0.5555557907415977, 0.35218242010439427,
      0.647045087735606, 0.5591176324206643, 0.704201161498206,
    ]
    PTS.forEach(([x, y], i) => expect(fbmWarp2(x, y, 24, SEED, 8)).toBe(golden[i]))
  })

  it('ridgedFbm2 rend exactement les valeurs d’origine', () => {
    const golden = [
      1, 0.7733166401053091, 0.6259217899047418, 1,
      0.329831567535295, 0.6342778699729029, 0.754069765983466,
    ]
    PTS.forEach(([x, y], i) => expect(ridgedFbm2(x, y, 20, SEED)).toBe(golden[i]))
  })
})
