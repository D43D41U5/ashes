/**
 * Relief continu — le sol se déforme par l'élévation (Y-shear vertical). Math
 * PURE, aucun import Phaser. Source de vérité du RENDU (`lift`, transcrit dans le
 * tracé du sol) ET du PICKING (`unproject`) — les deux ne peuvent pas diverger.
 * Spec : docs/superpowers/specs/2026-07-10-relief-continu-warp-design.md.
 *
 * Convention : `screenY = worldY·TILE − elevation·H`, X jamais cisaillé.
 */
import type { SampleElevation } from './hillshade'

export interface Warp {
  /** Décalage écran (px) à SOUSTRAIRE du py plat d'un point monde (tuiles). */
  lift(txf: number, tyf: number): number
  /** Écran-monde PLAT (px, tel que `positionToCamera` le rend) → monde VRAI (px).
   *  X exact ; Y par résolution 1-D monotone de colonne. LE picking. */
  unproject(flatPxX: number, flatPxY: number): { x: number; y: number }
  /** Facteur d'élévation à l'écran (px/unité) — exposé pour un futur tracé GPU. */
  readonly h: number
}

/** Échantillonnage BILINÉAIRE du champ à une position fractionnaire (tuiles) :
 *  le versant est lisse, jamais en gradins. */
export function elevAtBilinear(txf: number, tyf: number, sample: SampleElevation): number {
  const x0 = Math.floor(txf)
  const y0 = Math.floor(tyf)
  const fx = txf - x0
  const fy = tyf - y0
  const a = sample(x0, y0)
  const b = sample(x0 + 1, y0)
  const c = sample(x0, y0 + 1)
  const d = sample(x0 + 1, y0 + 1)
  const top = a + (b - a) * fx
  const bot = c + (d - c) * fx
  return top + (bot - top) * fy
}

export function createWarp(sample: SampleElevation, h: number, tilePx: number): Warp {
  const lift = (txf: number, tyf: number): number => elevAtBilinear(txf, tyf, sample) * h
  const unproject = (flatPxX: number, flatPxY: number): { x: number; y: number } => {
    const txf = flatPxX / tilePx // X n'est jamais cisaillé → exact.
    // flatPxY = tyVrai·tilePx − elev(txf, tyVrai)·h. elev ∈ [0,1] ⇒ lift ∈ [0,h]
    // ⇒ tyVrai ∈ [flatPxY/tile, flatPxY/tile + h/tile]. screenY(ty) monotone
    // croissant (garde anti-repli) → bissection sur cet encadrement.
    const lo0 = flatPxY / tilePx
    let lo = lo0
    let hi = lo0 + h / tilePx
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      const screenY = mid * tilePx - lift(txf, mid)
      if (screenY < flatPxY) lo = mid
      else hi = mid
    }
    return { x: flatPxX, y: ((lo + hi) / 2) * tilePx }
  }
  return { lift, unproject, h }
}

/** Gradient d'élévation maximal vers le SUD (ty croissant). `H·ce gradient <
 *  tilePx` garantit `screenY` monotone donc l'absence de repli. */
export function maxSouthGradient(elevation: number[], width: number, height: number): number {
  let max = 0
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const g = elevation[(y + 1) * width + x]! - elevation[y * width + x]!
      if (g > max) max = g
    }
  }
  return max
}

/** Assert de dev : le `H` visé ne replie jamais le sol sur ce champ. */
export function assertNoFold(
  elevation: number[],
  width: number,
  height: number,
  h: number,
  tilePx: number,
): void {
  const g = maxSouthGradient(elevation, width, height)
  if (g * h >= tilePx) {
    throw new Error(
      `relief: H=${h} replie le sol (gradient sud max ${g}, H·g=${g * h} ≥ tile ${tilePx}). ` +
        `Baisse RELIEF_H ou adoucis la pente sud.`,
    )
  }
}
