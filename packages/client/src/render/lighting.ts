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

export function lerpColor(c1: number, c2: number, t: number): number {
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

/**
 * LA BRUME DU MATIN (spec da-feeling R14) — un ÉVÉNEMENT de l'aube, pas un état.
 *
 * Elle se lève dans la nuit finissante (4h30), est pleine quand le jour point (6h), et le
 * soleil la dissout en pente CONTINUE jusqu'à 8h30 (règle maison « feel = pente continue » :
 * on interpole sur tout l'intervalle, bornes exactes, jamais un palier). Rend [0..1] — la
 * nappe (`world/morning-mist.ts`) y applique son plafond d'alpha. Fonction PURE de l'heure,
 * comme `daylight` : testable, et une seule vérité pour qui voudra s'y accorder (sons d'aube).
 */
const BRUME_KEYS: DayKey[] = [
  { hour: 0, value: 0 },
  { hour: 4.5, value: 0 },
  { hour: 5.5, value: 1 }, // elle se lève vite (l'air froid se condense d'un coup)
  { hour: 6.5, value: 1 }, // pleine à l'heure où le jour point
  { hour: 8.5, value: 0 }, // le soleil la mange, lentement
  { hour: 24, value: 0 },
]

export function brumeDuMatin(hour: number): number {
  const { lo, hi, t } = bracket(BRUME_KEYS, hour)
  return lerp(lo.value, hi.value, t)
}

/** Portée maximale de la marée de brume, en tuiles depuis l'eau. */
export const FRONT_BRUME_MAX_TILES = 9

/**
 * LA MARÉE DE L'AUBE (variante V1, choisie par Alexis le 2026-07-26) — le FRONT de brume,
 * en tuiles gagnées depuis l'eau : il monte de la berge vers l'intérieur des terres
 * (4h30 → 6h), reste étale (→ 6h48), puis le soleil le REPOUSSE vers l'eau (→ 8h30) —
 * l'ordre spatial de la dissolution est l'inverse de la naissance, les dernières flaques
 * flottent sur les mares. Fonction PURE de l'heure, pente continue, testée — le pendant
 * spatial de `brumeDuMatin` (qui reste l'enveloppe d'alpha) : les deux partagent la fenêtre,
 * la brume s'amincit donc en même temps qu'elle recule.
 */
const FRONT_KEYS: DayKey[] = [
  { hour: 0, value: 0 },
  { hour: 4.5, value: 0 },
  { hour: 6, value: 1 }, // la marée monte en 1h30 — on la VOIT venir
  { hour: 6.8, value: 1 }, // étale
  { hour: 8.5, value: 0 }, // le soleil la repousse, plus lentement qu'elle n'est montée
  { hour: 24, value: 0 },
]

export function frontDeBrume(hour: number): number {
  const { lo, hi, t } = bracket(FRONT_KEYS, hour)
  return FRONT_BRUME_MAX_TILES * lerp(lo.value, hi.value, t)
}

interface TintKey {
  hour: number
  color: number
  alpha: number
}

/**
 * Le bleu froid de la nuit — REHAUSSÉ de `0x0b1030` à `0x0b104e` le 2026-07-24, avec le passage
 * du voile de l'heure en `MULTIPLY` (cf. `night-veil.ts`).
 *
 * Ce n'est PAS un choix d'ambiance, c'est la conversion de l'ancien. En blend NORMAL, la moitié
 * de la froideur venait du terme ADDITIF (`teinte·α`) — le même terme qui relevait les noirs.
 * Le multiply le supprime : la couleur doit donc porter seule la teinte que le mélange offrait.
 *
 * Premier calcul : conserver le RAPPORT bleu/rouge du rendu précédent (1,61 sur un gris moyen)
 * → B = 78. Rendu, mesuré : INSUFFISANT. Un multiply conserve la teinte PROPRE de la surface,
 * donc un sol brun sous un multiplicateur à peine bleu reste brun — la nuit avait la lisibilité
 * qu'on cherchait mais elle avait perdu sa FROIDEUR, qui était portée par le terme additif.
 * On refroidit donc le multiplicateur lui-même : `M = (0,303 · 0,320 · 0,540)`, bleu 1,8× le
 * rouge. Le plancher de `M_r` est `1-α = 0,28` — aucune couleur ne refroidira davantage à cette
 * opacité, et monter l'opacité rendrait la nuit injouable. C'est le froid maximal disponible.
 *
 * À gris moyen le rendu passe de (44, 47, 70) à (39, 41, 69) — et surtout un noir qui redevient
 * NOIR au lieu de plafonner à (8, 11, 35).
 */
const NIGHT_COLOR = 0x080e5c // bleu froid
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
 * Le scintillement d'une flamme : deux ondes incommensurables (√2 : leur rapport
 * est irrationnel, donc elles ne se rejoignent jamais) plus une troisième, rapide
 * et faible, pour le crépitement. Une seule sinusoïde donnerait un clignotant de
 * chantier — la flamme, elle, ne se répète pas.
 *
 * `seed` décale la phase par Feu : deux foyers voisins ne battent pas ensemble.
 */
function flicker(timeMs: number, seed: number): number {
  const t = timeMs * 0.001 + seed
  const slow = Math.sin(t * 2.1)
  const fast = Math.sin(t * 3.7 * Math.SQRT2)
  const crackle = Math.sin(t * 11.3)
  return 1 + 0.09 * slow + 0.06 * fast + 0.025 * crackle
}

/**
 * Halo d'un Feu : couleur d'alignement, plus fort la nuit (∝ 1 - day) et pour un
 * village plus engagé (∝ |warmth|). `radius` en tuiles, `alpha` pour blend ADD.
 *
 * `timeMs`/`seed` font PALPITER le halo. Sans eux, la fonction est pure de
 * l'heure — et un feu parfaitement immobile est la chose la plus morte du monde.
 */
export function fireGlow(
  warmth: number,
  day: number,
  timeMs = 0,
  seed = 0,
): { color: number; radius: number; alpha: number } {
  const engage = Math.min(1, Math.abs(warmth) / 100)
  const dark = 1 - day
  const beat = flicker(timeMs, seed)
  const alpha = Math.min(GLOW_MAX_ALPHA, GLOW_MAX_ALPHA * dark * (0.6 + 0.4 * engage) * beat)
  const radius = (GLOW_MIN_RADIUS_TILES + GLOW_SPAN_TILES * engage) * beat
  return { color: warmthColor(warmth), radius, alpha }
}

/**
 * LA CLAIRIÈRE — la portée, en tuiles, du trou que le Feu creuse dans le voile de nuit.
 *
 * ═══ POURQUOI CE N'EST PAS `fireGlow.radius` ═══
 *
 * Ça l'était, et c'était le défaut. `fireGlow.radius` va de 3 à 8 tuiles avec l'engagement du
 * village : c'est le rayon d'un halo COSMÉTIQUE, calibré pour une lueur qu'on additionne. Le
 * trou du voile, lui, ne colore rien — il RETIRE de la nuit. Le faire monter sur ce rayon-là
 * donnait, MESURÉ à minuit sur un Feu à warmth 100, un sol relevé de (17,15,18) à (30,23,24)
 * à VINGT-CINQ tuiles du foyer, et jusque dans les coins de l'écran : la nuit disparaissait de
 * la vallée dès qu'un village s'engageait.
 *
 * D'où la décision d'Alexis (2026-08-03, `docs/decisions.md`) : **portée CONSTANTE — l'engagement
 * se lit à la flamme**, où il se lit déjà (le sprite du Feu est teinté par `warmthColor` : bleu
 * Foyer, rouge Meute). Cette fonction ne prend donc PAS `warmth` en argument, et c'est le fond
 * de l'affaire : ce qui n'est pas paramétrable ne peut pas se recoupler par distraction.
 *
 * Elle PULSE, en revanche — même `flicker`, même graine que le halo et la flaque : les trois
 * battent en phase avec la flamme, sinon la clairière respirerait à contretemps du feu qui la
 * creuse. L'appelant module encore par l'ÉTAT du foyer (braises, éteint).
 */
const HOLE_RADIUS_TILES = 6

export function fireHoleRadius(timeMs = 0, seed = 0): number {
  return HOLE_RADIUS_TILES * flicker(timeMs, seed)
}
