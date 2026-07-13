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
 *
 * Les huit gradients sont stockés À PLAT (deux Int8Array) plutôt qu'en tableau
 * de paires : `gradientNoise2` en lit trente-deux par tuile, et le double
 * déréférencement d'un tableau de tableaux coûtait plus cher que le hash
 * lui-même. À plat, la génération entière gagne 15 % — au bit près (mesuré :
 * zéro écart sur 2,16 M de valeurs).
 */
const GRAD_X = new Int8Array([1, -1, 0, 0, 1, -1, 1, -1])
const GRAD_Y = new Int8Array([0, 0, 1, -1, 1, 1, -1, -1])
// Étalement du produit scalaire brut vers [0, 1), clampé pour garantir
// l'intervalle quelle que soit la seed. Calibré à 1.0 : donne à fbm2 un
// contraste comparable à l'ancien value noise (écart-type ≈ 0.17), condition
// pour préserver l'organicité du sous-projet 1 (ondulation des berges,
// dé-confettisage de la roche) — à 0.7 la cloche gradient était trop serrée.
// ~6 % des valeurs sont clampées (plateaux bénins). Constante de contenu.
const GRAD_SCALE = 1.0

/**
 * L'indice du gradient au nœud (ix, iy) — le corps de `hash2`, mais la seed
 * arrive DÉJÀ mélangée (`Math.imul(seed, 974634749)`) : elle est constante sur
 * les quatre coins d'une même cellule, et l'imul sortait donc quatre fois pour
 * rien. Le résultat est identique à `hash2(ix, iy, seed)` au bit près.
 *
 * MESURE À CONSIGNER (elle contredit l'intuition) : le treillis est appelé
 * 433 fois par point distinct (604 M appels pour 1,4 M nœuds) — une redondance
 * qui hurle « mémoïse ». On l'a fait : un cache direct-mapped atteint 99,7 % de
 * hits… et tourne 1,75× plus LENTEMENT, à toutes les tailles de table (de 3 Ko
 * à 13 Mo). `hash2` est une poignée d'opérations d'ALU ; toute table assez
 * grande pour porter le treillis sort du cache du processeur, et un défaut de
 * cache coûte vingt fois le hash. **Recalculer coûte moins cher que se
 * souvenir.** Ne pas retenter.
 */
function gradIndex(ix: number, iy: number, mixedSeed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + mixedSeed) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return Math.min(7, Math.floor((((h ^ (h >>> 16)) >>> 0) / 4294967296) * 8))
}

export function gradientNoise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const s = Math.imul(seed | 0, 974634749)
  const i00 = gradIndex(x0, y0, s)
  const i10 = gradIndex(x0 + 1, y0, s)
  const i01 = gradIndex(x0, y0 + 1, s)
  const i11 = gradIndex(x0 + 1, y0 + 1, s)
  const d00 = GRAD_X[i00]! * fx + GRAD_Y[i00]! * fy
  const d10 = GRAD_X[i10]! * (fx - 1) + GRAD_Y[i10]! * fy
  const d01 = GRAD_X[i01]! * fx + GRAD_Y[i01]! * (fy - 1)
  const d11 = GRAD_X[i11]! * (fx - 1) + GRAD_Y[i11]! * (fy - 1)
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

/**
 * Domain warping — décale les coordonnées d'échantillonnage par un champ de
 * bruit basse fréquence avant d'évaluer fbm2. C'est le multiplicateur
 * d'organicité : il tord toute frontière qu'il touche (biomes) sans changer
 * la quantité échantillonnée. `warpAmp` en tuiles ; 0 ⇒ pas de warp.
 * N'utilise que + - * et fbm2 → exact.
 */
export function fbmWarp2(x: number, y: number, scale: number, seed: number, warpAmp: number): number {
  const qx = fbm2(x, y, scale * 2, (seed ^ 0x1b56c4f9) | 0)
  const qy = fbm2(x, y, scale * 2, (seed ^ 0x7d2ac03b) | 0)
  return fbm2(x + warpAmp * (qx * 2 - 1), y + warpAmp * (qy * 2 - 1), scale, seed | 0)
}

/**
 * Bruit fractal « ridged » — crêtes vives pour des arêtes alpines. Chaque
 * octave : r = 1 − |2·grad − 1| (pic quand grad ≈ 0.5) élevé au carré (arêtes
 * plus nettes), sommé sur 4 octaves normalisées. N'utilise que abs + − × / :
 * exact au bit près, pas de trigo.
 */
export function ridgedFbm2(x: number, y: number, scale: number, seed = 0): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let o = 0; o < 4; o++) {
    const g = gradientNoise2((x * freq) / scale, (y * freq) / scale, (seed ^ (o * 0x68e31da)) | 0)
    const r = 1 - Math.abs(2 * g - 1)
    sum += r * r * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}
