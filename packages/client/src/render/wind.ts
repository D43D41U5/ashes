/**
 * Le vent — le monde respire (chantier ambiance).
 *
 * Une fonction pure du lieu et de l'instant : `sway(tx, ty, timeMs)` rend
 * l'inclinaison d'un brin planté là, maintenant. Aucun état, aucune allocation —
 * elle est appelée pour chaque prop visible, à chaque frame.
 *
 * Ce module est CLIENT : `Math.sin` y est parfaitement légitime (l'invariant de
 * déterminisme inter-moteurs ne contraint que `/sim`, et rien ici ne remonte
 * jamais dans la simulation — le vent ne pousse personne).
 *
 * La forme : une onde qui TRAVERSE la carte (la rafale se voit venir), sous une
 * enveloppe plus lente qui enfle et retombe (le vent souffle par bouffées). Sans
 * l'enveloppe, tout oscille à l'identique pour toujours — et l'œil lit une
 * machine, pas un souffle.
 */

/** Angle maximal d'un brin à pleine rafale (radians) — ~7°. */
const MAX_SWAY = 0.12
/** Vitesse de l'onde principale (rad/ms). */
const WAVE_SPEED = 0.0021
/** Serrage spatial de l'onde : plus c'est haut, plus les rafales sont courtes. */
const WAVE_TIGHTNESS = 0.22
/** Bouffées : vitesse et serrage de l'enveloppe lente. */
const GUST_SPEED = 0.00035
const GUST_TIGHTNESS = 0.035

/**
 * Combien chaque prop prend le vent. Un roseau plie, un rocher non — et c'est
 * ce contraste qui fait que le vent se VOIT : si tout bougeait pareil, l'écran
 * entier respirerait comme une seule image, ce qui ne ressemble à rien.
 */
export const WIND_TAKE: Record<string, number> = {
  reed: 1.3,
  grass_tuft: 1,
  fern: 0.85,
  flower: 0.9,
  low_bush: 0.5,
  larch: 0.4,
  pine: 0.32,
  conifer: 0.3,
  big_trunk: 0.12,
  burnt_trunk: 0.1,
  // Tout le reste — cailloux, blocs, souches, lichen, sphaigne, congères — ne
  // prend pas le vent. L'absence est délibérée : un caillou qui frémit trahit.
}

/**
 * L'inclinaison, en radians, d'un prop planté en (tx, ty) à l'instant `timeMs`.
 * `take` module l'amplitude (voir WIND_TAKE) ; 0 rend exactement 0.
 */
export function windSway(tx: number, ty: number, timeMs: number, take: number): number {
  if (take === 0) return 0
  // L'onde se propage vers le sud-est : la rafale arrive de la crête.
  const phase = timeMs * WAVE_SPEED - (tx * 0.75 + ty * 0.45) * WAVE_TIGHTNESS
  const gust = 0.45 + 0.55 * Math.sin(timeMs * GUST_SPEED - (tx + ty) * GUST_TIGHTNESS)
  return MAX_SWAY * take * Math.sin(phase) * gust
}
