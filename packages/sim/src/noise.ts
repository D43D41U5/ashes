/**
 * Le bruit déterministe de /sim — hash 2D et bruit de valeur fractal.
 *
 * Uniquement des opérations exactes au bit près (imul, >>>, + - * /,
 * polynômes) : même résultat sur tout moteur JS (invariant n°2). C'est la
 * source de « chair » procédurale de la génération de carte — PAS une source
 * d'aléatoire de gameplay (ça, c'est rng.ts, dont l'état vit dans SimState).
 */

/** Hash 2D seedé → [0, 1). Avec seed = 0 : identique au hash2 historique. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + Math.imul(seed | 0, 974634749)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Bruit gradient (Perlin) 2D → [0, 1). Vaut 0.5 aux nœuds entiers (le fade
 * quintique y annule les coins voisins) : les features naissent ENTRE les
 * nœuds, pas calées sur la grille des entiers — remède à l'artefact « patates
 * alignées » du value noise. N'utilise que + - * / floor min max et hash2 :
 * exact au bit près entre moteurs JS (invariant n°2).
 */
const GRAD2: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
]
// Étalement du produit scalaire brut (~[-0.7, 0.7]) vers [0, 1). Clampé pour
// garantir l'intervalle quelle que soit la seed. Constante de contenu.
const GRAD_SCALE = 0.7

function gradAt(ix: number, iy: number, seed: number): readonly [number, number] {
  const idx = Math.min(7, Math.floor(hash2(ix, iy, seed) * 8))
  return GRAD2[idx]!
}

export function gradientNoise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const g00 = gradAt(x0, y0, seed)
  const g10 = gradAt(x0 + 1, y0, seed)
  const g01 = gradAt(x0, y0 + 1, seed)
  const g11 = gradAt(x0 + 1, y0 + 1, seed)
  const d00 = g00[0] * fx + g00[1] * fy
  const d10 = g10[0] * (fx - 1) + g10[1] * fy
  const d01 = g01[0] * fx + g01[1] * (fy - 1)
  const d11 = g11[0] * (fx - 1) + g11[1] * (fy - 1)
  // fade quintique 6t⁵−15t⁴+10t³ (polynôme → exact, C² continu)
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const nx0 = d00 + (d10 - d00) * u
  const nx1 = d01 + (d11 - d01) * u
  const n = nx0 + (nx1 - nx0) * v
  return Math.min(0.9999999, Math.max(0, n * GRAD_SCALE + 0.5))
}

/** Bruit fractal (3 octaves) à l'échelle `scale` (en tuiles) → [0, 1). */
export function fbm2(x: number, y: number, scale: number, seed = 0): number {
  const a = gradientNoise2(x / scale, y / scale, seed)
  const b = gradientNoise2((x * 2) / scale, (y * 2) / scale, (seed ^ 0x9e3779b9) | 0)
  const c = gradientNoise2((x * 4) / scale, (y * 4) / scale, (seed ^ 0x51ab3f77) | 0)
  return (a * 4 + b * 2 + c) / 7
}
