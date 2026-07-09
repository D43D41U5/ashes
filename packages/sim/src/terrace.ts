/**
 * Terrassement — quantifie l'altitude CONTINUE en PALIERS discrets
 * (spec docs/superpowers/specs/2026-07-09-relief-terrasses-design.md).
 *
 * `elevation` reste le grain continu (ombrage, futur coût de pente) ; `level`
 * est l'entier qui portera murs et plateaux (tranches 2+). Il se DÉRIVE, il ne
 * s'invente pas.
 *
 * Pur et déterministe : uniquement `+`, `*`, `/`, `Math.floor` — aucune
 * transcendante (invariant /sim §2). Le lissage n'est pas cosmétique : sans lui,
 * quantifier un champ qui porte crêtes et bruit de détail donne des
 * micro-terrasses déchiquetées sur chaque bosse.
 */
import { TERRACE } from './balance'

const clampIndex = (i: number, n: number): number => (i < 0 ? 0 : i >= n ? n - 1 : i)

/**
 * Moyenne locale SÉPARABLE (box blur), rayon `r`, bords clampés sur la bordure.
 * Retourne un NOUVEAU tableau ; `src` n'est jamais muté.
 *
 * Coût O(width × height × r × passes) — la vallée canonique (1200×1800, r=6,
 * 2 passes) tient dans quelques centaines de ms, une fois, à la génération.
 */
export function smoothField(
  src: number[],
  width: number,
  height: number,
  r: number,
  passes: number,
): number[] {
  const cur = src.slice()
  const tmp = new Array<number>(width * height).fill(0)
  const taps = 2 * r + 1
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let d = -r; d <= r; d++) sum += cur[row + clampIndex(x + d, width)]!
        tmp[row + x] = sum / taps
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let d = -r; d <= r; d++) sum += tmp[clampIndex(y + d, height) * width + x]!
        cur[y * width + x] = sum / taps
      }
    }
  }
  return cur
}

/** Altitude continue [0,1] → palier entier [0, TERRACE.LEVELS-1]. */
export function computeLevel(elevation: number[], width: number, height: number): number[] {
  const smooth = smoothField(elevation, width, height, TERRACE.SMOOTH_RADIUS, TERRACE.SMOOTH_PASSES)
  const n = width * height
  const top = TERRACE.LEVELS - 1
  const level = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const q = Math.floor(smooth[i]! * TERRACE.LEVELS)
    level[i] = q < 0 ? 0 : q > top ? top : q
  }
  return level
}
