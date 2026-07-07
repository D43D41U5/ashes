/**
 * Le substrat alpin (SP1a) — champ d'élévation, d'humidité, et bandes de terrain
 * façon Whittaker. Pur et déterministe (noise.ts, arithmétique autorisée). Pas
 * d'hydrologie ni de features ici (SP1b). Toutes les échelles/amplitudes sont des
 * fractions de min(width,height) → scalable à toute taille.
 */
import { fbmWarp2, ridgedFbm2 } from './noise'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Constantes de forme du relief — contenu de carte, réglées à la vignette. */
export const ALPINE = {
  RIM_FRAC: 0.06,     // épaisseur de l'anneau de pics (fraction de min(W,H))
  MACRO_FRAC: 0.55,   // grande structure de vallée
  MID_FRAC: 0.18,     // reliefs secondaires
  RIDGE_FRAC: 0.26,   // arêtes ridged
  WARP_FRAC: 0.05,    // amplitude de domain warping
  BASE_WEIGHT: 0.6,   // part du relief doux vs ridged
  RIDGE_WEIGHT: 0.4,
}

export function computeElevation(width: number, height: number, seed: number): number[] {
  const D = Math.min(width, height)
  const rimDepth = Math.max(2, Math.round(D * ALPINE.RIM_FRAC))
  const macro = D * ALPINE.MACRO_FRAC
  const mid = D * ALPINE.MID_FRAC
  const ridge = D * ALPINE.RIDGE_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const el = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y)
      const rim = clamp01((rimDepth - edge) / rimDepth) // 1 au bord → pics
      const base =
        0.7 * fbmWarp2(x, y, macro, (seed ^ 0x1a2b3c) | 0, warp) +
        0.3 * fbmWarp2(x, y, mid, (seed ^ 0x4d5e6f) | 0, warp)
      const ridged = ridgedFbm2(x, y, ridge, (seed ^ 0x7a8b9c) | 0)
      const interior = ALPINE.BASE_WEIGHT * base + ALPINE.RIDGE_WEIGHT * ridged
      el[y * width + x] = clamp01(Math.max(rim, interior))
    }
  }
  return el
}

export function computeMoisture(width: number, height: number, elevation: number[], seed: number): number[] {
  const D = Math.min(width, height)
  const scale = D * 0.3
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const m = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const noise = fbmWarp2(x, y, scale, (seed ^ 0x2fed01) | 0, warp)
      // Plus bas = plus humide (l'eau descend). 0.6 bruit + 0.4 (1 − altitude).
      m[i] = clamp01(0.6 * noise + 0.4 * (1 - elevation[i]!))
    }
  }
  return m
}
