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
  flower: 0.9,
  low_bush: 0.5,
  bush: 0.45,
  larch: 0.4,
  pine: 0.32,
  conifer: 0.3,
  big_trunk: 0.12,
  burnt_trunk: 0.1,
  // Tout le reste — cailloux, blocs, souches, lichen, sphaigne, congères — ne
  // prend pas le vent. L'absence est délibérée : un caillou qui frémit trahit.
}

/**
 * LE VENT DIT LA VÉRITÉ (spec chasse C17/C19). Il n'est plus décoratif : la sim
 * a un vent, l'odeur le descend, et approcher SOUS LE VENT est la moitié d'une
 * chasse. Une règle qu'on ne voit pas est une injustice — alors les herbes se
 * couchent dans SON sens, et la rafale traverse la carte DANS son sens.
 *
 * Deux termes, et le premier est le nouveau :
 *   — L'INCLINAISON DE FOND. Le brin penche là où le vent pousse (signe de
 *     `wind.x`). C'est ce qu'on lit en un dixième de seconde, sans y penser :
 *     « ça souffle vers l'est, donc j'approche par l'est ».
 *   — L'OSCILLATION, comme avant — mais l'onde se propage désormais LE LONG du
 *     vent, et non plus toujours vers le sud-est.
 */
const BASE_LEAN = 0.09 // l'inclinaison permanente, ~5° : le vent est une direction

export function windSway(
  tx: number,
  ty: number,
  timeMs: number,
  take: number,
  wind: { x: number; y: number } = { x: 1, y: 0 },
): number {
  if (take === 0) return 0
  // Calme plat (le vecteur nul) : rien ne penche, rien n'oscille. C'est un monde
  // qui n'a pas de vent — et l'odorat n'y trahit personne (voir /sim, C17).
  const wl = Math.sqrt(wind.x * wind.x + wind.y * wind.y)
  if (wl < 0.001) return 0
  const wx = wind.x / wl
  const wy = wind.y / wl

  // L'onde remonte le vent : la rafale se voit VENIR de l'amont.
  const phase = timeMs * WAVE_SPEED - (tx * wx + ty * wy) * WAVE_TIGHTNESS * 1.6
  const gust = 0.45 + 0.55 * Math.sin(timeMs * GUST_SPEED - (tx * wx + ty * wy) * GUST_TIGHTNESS * 1.6)
  const oscillation = MAX_SWAY * take * Math.sin(phase) * gust
  // Le brin PENCHE dans le sens du vent (sa composante horizontale : c'est elle
  // qu'un billboard 2D peut montrer), et il oscille autour de cette inclinaison.
  return BASE_LEAN * take * wx + oscillation
}
