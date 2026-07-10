/**
 * Lumière & ambiance — fonctions PURES de l'heure murale et du terrain.
 * Aucune dépendance Phaser : testé en unitaire (lighting.test.ts), comme
 * framing.ts. Le rendu (couches, blend) vit dans les scènes ; ici, uniquement
 * les courbes. Côté client, Math.sin/floor/round sont autorisés (l'interdit des
 * approximations est sim-only).
 */

/** Alpha maximal de la teinte de nuit — plafonné pour que la nuit reste tout juste lisible. */
export const NIGHT_ALPHA_MAX = 0.72

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

/** Direction VERS le soleil en espace-tuile (x est+, y sud+), de norme = FORCE
 *  directionnelle de l'ombre portée : 0 = soleil au zénith ou nuit (pas d'ombre),
 *  1 = soleil rasant. Balaie est→ouest sur la journée (aube 6h → couchant 18h) :
 *  ombres vers l'ouest le matin, vers l'est le soir, quasi nulles à midi.
 *  Client (pas /sim) → sin/cos autorisés. */
export function sunDirection(hour: number): { x: number; y: number } {
  const h = ((hour % 24) + 24) % 24
  if (h <= 6 || h >= 18) return { x: 0, y: 0 } // nuit : pas de soleil
  const az = Math.PI * ((h - 6) / 12) // 0 = est (aube) → π = ouest (couchant)
  return { x: Math.cos(az), y: 0 } // |cos| = force : 1 au ras, 0 à midi (zénith)
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
  { hour: 5, color: NIGHT_COLOR, alpha: 0.62 },
  { hour: 6, color: GOLDEN_COLOR, alpha: 0.32 },
  { hour: 8, color: GOLDEN_COLOR, alpha: 0.1 },
  { hour: 10, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 15, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 18, color: GOLDEN_COLOR, alpha: 0.12 },
  { hour: 20, color: GOLDEN_COLOR, alpha: 0.34 },
  { hour: 21, color: NIGHT_COLOR, alpha: 0.6 },
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
