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

/** Bruit de valeur lissé — interpolation bilinéaire du hash aux quatre coins. */
export function valueNoise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  // smoothstep — un polynôme, donc exact
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x0 + 1, y0, seed)
  const n01 = hash2(x0, y0 + 1, seed)
  const n11 = hash2(x0 + 1, y0 + 1, seed)
  const nx0 = n00 + (n10 - n00) * sx
  const nx1 = n01 + (n11 - n01) * sx
  return nx0 + (nx1 - nx0) * sy
}

/** Bruit fractal (3 octaves) à l'échelle `scale` (en tuiles) → [0, 1). */
export function fbm2(x: number, y: number, scale: number, seed = 0): number {
  const a = valueNoise2(x / scale, y / scale, seed)
  const b = valueNoise2((x * 2) / scale, (y * 2) / scale, (seed ^ 0x9e3779b9) | 0)
  const c = valueNoise2((x * 4) / scale, (y * 4) / scale, (seed ^ 0x51ab3f77) | 0)
  return (a * 4 + b * 2 + c) / 7
}
