/**
 * Vignette de revue (outil de dev, headless) — transforme une carte alpine en
 * image RGB downscalée : couleur de biome modulée par un hillshade calculé sur
 * le gradient d'élévation. Pur (aucun accès disque ici — le script Node écrit le
 * PNG). Sert à juger l'ambiance « ça sent l'alpin » avant que le rendu jeu (SP2)
 * existe. Pas du code de gameplay : n'a pas besoin d'être bit-exact.
 */
import { TERRAINS } from './balance'
import { elevationAt, type WorldMap } from './map'

/** Couleur de base par nom de terrain (placeholder alpin — la vraie palette = SP3). */
const BIOME_RGB: Record<string, [number, number, number]> = {
  grass: [110, 150, 78],
  forest: [42, 82, 54],
  marsh: [86, 104, 74],
  scree: [150, 146, 138],
  rock: [110, 106, 102],
  snow: [238, 242, 248],
  shallow_water: [120, 170, 190],
  deep_water: [58, 110, 140],
  road: [178, 156, 120],
  void: [20, 20, 20],
}

export function renderVignette(map: WorldMap, maxDim = 512): { w: number; h: number; rgb: Uint8Array } {
  const step = Math.max(1, Math.ceil(Math.max(map.width, map.height) / maxDim))
  const w = Math.floor(map.width / step)
  const h = Math.floor(map.height / step)
  const rgb = new Uint8Array(w * h * 3)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const tx = px * step
      const ty = py * step
      const t = TERRAINS[map.terrain[ty * map.width + tx] ?? 0]
      const base = BIOME_RGB[t?.name ?? 'void'] ?? BIOME_RGB.void!
      // Hillshade : pente selon le gradient d'élévation, éclairée depuis le NO.
      const dzdx = elevationAt(map, tx + step, ty) - elevationAt(map, tx - step, ty)
      const dzdy = elevationAt(map, tx, ty + step) - elevationAt(map, tx, ty - step)
      // Normale (−dzdx, −dzdy, k)·soleil(1,1,1)/… → un scalaire ; k règle l'intensité.
      const shade = clampShade(0.75 + 6 * (-dzdx - dzdy))
      const o = (py * w + px) * 3
      rgb[o] = clampByte(base[0] * shade)
      rgb[o + 1] = clampByte(base[1] * shade)
      rgb[o + 2] = clampByte(base[2] * shade)
    }
  }
  return { w, h, rgb }
}

const clampShade = (s: number): number => (s < 0.35 ? 0.35 : s > 1.5 ? 1.5 : s)
const clampByte = (v: number): number => {
  const r = Math.round(v)
  return r < 0 ? 0 : r > 255 ? 255 : r
}
