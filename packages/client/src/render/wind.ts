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

import { VENT } from '@ashes/sim'

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

/**
 * ═══ LA FORCE PLIE PLUS QUE LE CAP (2026-08-25) ═══
 *
 * Le brin penchait DANS le sens du vent depuis C17 — mais toujours d'autant, qu'il souffle à
 * peine ou qu'un front traverse la vallée. Le monde avait donc un vent qui change de force
 * (`state.windForce`, depuis l'unification) et un décor qui n'en savait rien.
 *
 * On multiplie l'inclinaison ET l'oscillation par la part de souffle au-dessus de l'ambiance :
 * `1` à l'ambiance (le décor d'avant, au bit près) jusqu'à `1 + PRISE_FORCE` au cœur d'une
 * bande. Ce n'est pas un effet de plus : c'est ce qui fait qu'on VOIT le front arriver sur les
 * herbes, avant même la première goutte.
 */
const PRISE_FORCE = 0.6

/** La part de souffle au-dessus de l'ambiance, depuis la force de la sim. Hors front elle vaut
 *  exactement 0 (`AMBIANT` divisé par lui-même) — donc le décor ne bouge pas d'un pixel tant
 *  qu'aucun front ne souffle. */
function partDeSouffle(force: number): number {
  return Math.min(1, Math.max(0, (force - VENT.AMBIANT) / (1 - VENT.AMBIANT)))
}

/**
 * ═══ DEUX CAPS, ET IL EN FAUT DEUX (Alexis, 2026-08-25 : « les houppiers et les plantes tremblent
 * encore plus qu'avant dès qu'il y a un changement de direction du vent ») ═══
 *
 * Premier correctif du jour : le décor pliait sur le cap BRUT de la sim, qui avance par crans de
 * 45°, donc toutes les tiges se redressaient d'un coup à chaque bascule. On lui a donné le cap
 * RALLIÉ (`VentLisse.cap`) — et ça a fait TREMBLER, plus fort qu'avant.
 *
 * LA RAISON EST DANS LA PHASE, ET ELLE EST ARITHMÉTIQUE. L'onde et la bouffée se propagent le
 * long du vent : leur phase vaut `(tx·wx + ty·wy) × serrage`, une projection de la position
 * ABSOLUE sur le cap. Faire tourner `w` en douceur fait donc BALAYER cette projection d'un
 * montant proportionnel à |position| — sur une carte de 1581 × 852, un virage de 45° promène la
 * phase de plusieurs centaines de radians, soit des dizaines d'oscillations complètes en
 * quelques secondes. Un cap qui SAUTAIT ne faisait qu'un saut de phase, une fois.
 *
 * MESURÉ (pire écart d'assiette entre deux images, houppier, virage est → nord-est) :
 *
 *              tuile        cap qui saute      cap rallié (le défaut)
 *           (   8,   8)         0,0610                 0,0036
 *           (1500, 800)         0,0173                 0,0576   ← ×3,3, et SOUTENU
 *
 * Près de l'origine le ralliement est bien meilleur ; à la place où le jeu se joue, il est trois
 * fois pire — et surtout il dure des secondes au lieu d'une image. Les deux mesures ne se
 * contredisent pas : c'est la même formule, lue à deux distances.
 *
 * D'OÙ LE PARTAGE, et il suit la nature de chaque terme :
 *   · L'ASSIETTE (l'inclinaison de fond, et le stretch) prend le cap RALLIÉ. C'est elle qu'on lit
 *     comme « la tige penche par là », c'est elle qui sautait, et elle ne dépend PAS de la
 *     position — la faire varier en continu est gratuit.
 *   · L'ONDE ET LA BOUFFÉE prennent le cap qui SAUTE. Leur phase dépend de la position ; un saut
 *     de phase sur une onde qui traverse la carte ne se lit pas comme un saut, il se lit comme
 *     une rafale qui change de sens — ce qui est exactement le fait qu'on veut montrer.
 */
export function windSway(
  tx: number,
  ty: number,
  timeMs: number,
  take: number,
  wind: { x: number; y: number } = { x: 1, y: 0 },
  /** LA FORCE DE LA SIM (`state.windForce` : `VENT.AMBIANT` à 1, ou 0 par calme plat). Par
   *  défaut l'ambiance — le décor d'avant, inchangé. */
  force: number = VENT.AMBIANT,
  /**
   * LE CAP LE LONG DUQUEL L'ONDE SE PROPAGE — voir l'en-tête ci-dessus. Il doit CHANGER RAREMENT
   * (le cap de la sim, par crans) : c'est le seul terme dont la phase dépend de la position, donc
   * le seul qu'on ne peut pas faire tourner en douceur sans faire trembler la carte entière.
   * Par défaut, celui de l'assiette — le contrat d'avant, au bit près.
   */
  ondeCap: { x: number; y: number } = wind,
): number {
  if (take === 0) return 0
  // Calme plat (le vecteur nul) : rien ne penche, rien n'oscille. C'est un monde
  // qui n'a pas de vent — et l'odorat n'y trahit personne (voir /sim, C17).
  const wl = Math.sqrt(wind.x * wind.x + wind.y * wind.y)
  if (wl < 0.001) return 0
  const wx = wind.x / wl
  const wy = wind.y / wl

  // L'onde remonte le vent : la rafale se voit VENIR de l'amont. ⚠ SUR `ondeCap`, PAS SUR `wind` :
  // c'est ici que la phase dépend de la POSITION, donc ici qu'un cap qui tourne en douceur ferait
  // trembler tout ce qui est loin de l'origine (voir l'en-tête). Repli sur le cap de l'assiette si
  // le cap d'onde est nul — un vecteur nul n'a pas de direction de propagation.
  const ol = Math.sqrt(ondeCap.x * ondeCap.x + ondeCap.y * ondeCap.y)
  const ox = ol < 0.001 ? wx : ondeCap.x / ol
  const oy = ol < 0.001 ? wy : ondeCap.y / ol
  const proj = tx * ox + ty * oy
  const phase = timeMs * WAVE_SPEED - proj * WAVE_TIGHTNESS * 1.6
  const gust = 0.45 + 0.55 * Math.sin(timeMs * GUST_SPEED - proj * GUST_TIGHTNESS * 1.6)
  // La force du vent plie davantage — inclinaison ET oscillation, du même facteur : c'est le
  // même air qui pousse, il n'y a aucune raison qu'il ne fasse qu'une des deux.
  const prise = 1 + PRISE_FORCE * partDeSouffle(force)
  const oscillation = MAX_SWAY * take * Math.sin(phase) * gust * prise
  // Le brin PENCHE dans le sens du vent (sa composante horizontale : c'est elle
  // qu'un billboard 2D peut montrer), et il oscille autour de cette inclinaison.
  //
  // ⚠ LIMITE CONNUE, ET ELLE EST GÉOMÉTRIQUE : un vent PLEIN NORD ou PLEIN SUD n'a pas de
  // composante horizontale, donc aucun brin ne peut la montrer — une rotation de billboard ne
  // sait pencher qu'à gauche ou à droite. Ce que le vent du nord change, sur ces caps-là, c'est
  // la chute du rideau (`souffleDuCiel`) et la dérive de la fumée, pas l'assiette des tiges.
  return BASE_LEAN * take * wx * prise + oscillation
}

/**
 * ═══ LE STRETCH — CE QU'UN BILLBOARD PEUT DIRE D'UN VENT NORD-SUD (essai, 2026-08-25) ═══
 *
 * Une rotation ne sait pencher qu'à gauche ou à droite : sous un cap plein nord ou plein sud,
 * `windSway` rend zéro d'assiette, et le décor ne disait rien de la moitié des fronts.
 *
 * Ce qu'un billboard PEUT dire, c'est sa HAUTEUR APPARENTE. La vue est de dessus : une tige
 * couchée vers le BAS de l'écran (le vent pousse au sud) part vers la caméra — elle se
 * raccourcit. Couchée vers le HAUT (le vent pousse au nord), elle s'éloigne et s'étire dans la
 * profondeur. Le pivot est aux PIEDS (origine 0,5 / 1) partout où ce facteur s'applique, donc
 * l'échelle plie la tige depuis sa base, exactement comme la rotation.
 *
 * ⚠ CE N'EST PAS UNE PROJECTION EXACTE, ET ÇA NE PEUT PAS L'ÊTRE : en toute rigueur, pencher
 * vers l'avant comme vers l'arrière RACCOURCIT (c'est un cosinus, il est pair). Un raccourci
 * pair ne distinguerait pas le nord du sud, donc ne dirait rien d'une DIRECTION — ce qui est
 * toute la demande. On lit donc l'écran comme une vue légèrement plongeante : vers le bas ça
 * tasse, vers le haut ça tire. C'est une convention de lecture, assumée comme telle.
 *
 * Rend un FACTEUR d'échelle verticale (1 = au repos) : l'appelant le multiplie à la sienne.
 */
const MAX_STRETCH = 0.12

export function windStretch(
  take: number,
  wind: { x: number; y: number } = { x: 1, y: 0 },
  force: number = VENT.AMBIANT,
): number {
  if (take === 0) return 1
  const wl = Math.sqrt(wind.x * wind.x + wind.y * wind.y)
  // Calme plat : la tige est droite, à sa hauteur. Le même contrat que `windSway`.
  if (wl < 0.001) return 1
  const wy = wind.y / wl
  const prise = 1 + PRISE_FORCE * partDeSouffle(force)
  // Le signe : `wind.y > 0` pousse vers le SUD, donc vers le bas de l'écran, donc vers la
  // caméra — la tige se tasse. Borné, parce qu'un roseau à pleine prise sortirait sinon du
  // domaine où l'illusion tient (un brin deux fois plus haut n'est plus un brin couché).
  const f = 1 - MAX_STRETCH * take * wy * prise
  return Math.min(1.3, Math.max(0.7, f))
}
