/**
 * Lumière & ambiance — fonctions PURES de l'heure murale et du terrain.
 * Aucune dépendance Phaser : testé en unitaire (lighting.test.ts), comme
 * framing.ts. Le rendu (couches, blend) vit dans les scènes ; ici, uniquement
 * les courbes. Côté client, Math.sin/floor/round sont autorisés (l'interdit des
 * approximations est sim-only).
 */

/** Alpha maximal de la teinte de nuit — plafonné pour que la nuit reste lisible. */
export const NIGHT_ALPHA_MAX = 0.5

const GLOW_MAX_ALPHA = 0.9
const GLOW_MIN_RADIUS_TILES = 3
const GLOW_SPAN_TILES = 5

function lerp(a: number, c: number, t: number): number {
  return a + (c - a) * t
}

function lerpColor(c1: number, c2: number, t: number): number {
  const rr = Math.round(lerp((c1 >> 16) & 0xff, (c2 >> 16) & 0xff, t))
  const gg = Math.round(lerp((c1 >> 8) & 0xff, (c2 >> 8) & 0xff, t))
  const bb = Math.round(lerp(c1 & 0xff, c2 & 0xff, t))
  return (rr << 16) | (gg << 8) | bb
}

/** Paire de keyframes encadrant `hour` (horloge murale) + facteur d'interpolation. */
function bracket<T extends { hour: number }>(keys: T[], hour: number): { lo: T; hi: T; t: number } {
  const h = ((hour % 24) + 24) % 24
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i]
    const hi = keys[i + 1]
    if (lo && hi && h >= lo.hour && h <= hi.hour) {
      const span = hi.hour - lo.hour
      return { lo, hi, t: span === 0 ? 0 : (h - lo.hour) / span }
    }
  }
  const last = keys[keys.length - 1]
  if (!last) throw new Error('bracket: keys must be non-empty')
  return { lo: last, hi: last, t: 0 }
}

/**
 * Couleur du Feu selon l'alignement — MÊME formule que snapshot-view (DRY) :
 * warmth > 0 → bleu (Foyer), warmth < 0 → rouge (Meute), 0 → blanc.
 */
export function warmthColor(warmth: number): number {
  const t = Math.max(-1, Math.min(1, warmth / 100))
  const red = t > 0 ? Math.floor(255 - 130 * t) : 255
  const green = Math.floor(255 - 90 * Math.abs(t))
  const blue = t < 0 ? Math.floor(255 + 140 * t) : 255
  return (red << 16) | (green << 8) | blue
}

interface DayKey {
  hour: number
  value: number
}
/** Facteur de lumière du jour : 0 = nuit noire … 1 = plein midi. */
const DAYLIGHT_KEYS: DayKey[] = [
  { hour: 0, value: 0 },
  { hour: 5, value: 0 },
  { hour: 6, value: 0.15 },
  { hour: 8, value: 0.7 },
  { hour: 10, value: 1 },
  { hour: 15, value: 1 },
  { hour: 18, value: 0.7 },
  { hour: 20, value: 0.2 },
  { hour: 21, value: 0.05 },
  { hour: 24, value: 0 },
]

export function daylight(hour: number): number {
  const { lo, hi, t } = bracket(DAYLIGHT_KEYS, hour)
  return lerp(lo.value, hi.value, t)
}

/**
 * Densité de couvert par code terrain sim (0 = ciel ouvert). Les codes en dur
 * reflètent `TERRAIN_FOREST` (3) et `TERRAIN_MARSH` (8) de sim/balance.ts — même
 * convention que `WorldScene.TERRAIN_COLORS`. Aucun lien à la compilation : si
 * ces codes sont renumérotés côté sim, mettre à jour ici (et TERRAIN_COLORS).
 */
export function canopyDensity(terrain: number): number {
  if (terrain === 3) return 0.45 // forêt (TERRAIN_FOREST)
  if (terrain === 8) return 0.15 // marais (TERRAIN_MARSH)
  return 0
}

/** Opacité globale de la couche canopée : l'ombre du sous-bois se lit surtout de jour. */
export function canopyStrength(day: number): number {
  return lerp(0.4, 1, day)
}

interface TintKey {
  hour: number
  color: number
  alpha: number
}

const NIGHT_COLOR = 0x0b1030 // bleu froid
const GOLDEN_COLOR = 0xc8702a // ambre chaud (heure dorée)
const NEUTRAL_COLOR = 0x101018

/** Keyframes de la teinte d'ambiance sur 24 h (bornes 0 h et 24 h identiques). */
const AMBIENT_KEYS: TintKey[] = [
  { hour: 0, color: NIGHT_COLOR, alpha: NIGHT_ALPHA_MAX },
  { hour: 5, color: NIGHT_COLOR, alpha: 0.44 },
  { hour: 6, color: GOLDEN_COLOR, alpha: 0.32 },
  { hour: 8, color: GOLDEN_COLOR, alpha: 0.1 },
  { hour: 10, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 15, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 18, color: GOLDEN_COLOR, alpha: 0.12 },
  { hour: 20, color: GOLDEN_COLOR, alpha: 0.34 },
  { hour: 21, color: NIGHT_COLOR, alpha: 0.42 },
  { hour: 24, color: NIGHT_COLOR, alpha: NIGHT_ALPHA_MAX },
]

export function ambientTint(hour: number): { color: number; alpha: number } {
  const { lo, hi, t } = bracket(AMBIENT_KEYS, hour)
  return { color: lerpColor(lo.color, hi.color, t), alpha: lerp(lo.alpha, hi.alpha, t) }
}

/**
 * Halo d'un Feu : couleur d'alignement, plus fort la nuit (∝ 1 - day) et pour un
 * village plus engagé (∝ |warmth|). `radius` en tuiles, `alpha` pour blend ADD.
 */
export function fireGlow(warmth: number, day: number): { color: number; radius: number; alpha: number } {
  const engage = Math.min(1, Math.abs(warmth) / 100)
  const dark = 1 - day
  const alpha = Math.min(GLOW_MAX_ALPHA, GLOW_MAX_ALPHA * dark * (0.6 + 0.4 * engage))
  const radius = GLOW_MIN_RADIUS_TILES + GLOW_SPAN_TILES * engage
  return { color: warmthColor(warmth), radius, alpha }
}
