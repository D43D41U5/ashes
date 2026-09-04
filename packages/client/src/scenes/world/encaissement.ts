/**
 * L'ENCAISSEMENT — la forme, dans le temps, d'un corps qui vient de prendre un coup.
 *
 * Module PUR (aucun Phaser) : `attack-fx.ts` le consomme pour peindre. Il est ici, et
 * testé, pour la raison qui a déjà sorti `shakeOffset` de `hit-fx` et `frontDeBrume` de
 * la brume — une courbe de feel se règle en la LISANT, pas en relançant le jeu.
 *
 * ═══ CE QU'IL CORRIGE, ET C'ÉTAIT MESURABLE À LA LECTURE ═══
 *
 * Le retour de coup existait, mais il ne pouvait pas se voir :
 *
 *   1. LA TEINTE DURAIT UNE IMAGE. `AttackFx.impact()` posait `setTint(IMPACT_TINT)`
 *      dans le drainage d'événements — or `SnapshotView.syncActor` repose la teinte de
 *      CHAQUE acteur à CHAQUE image (`beastTint`). Le flash rouge était donc écrasé à
 *      l'image suivante : ~16 ms à 60 fps. C'est exactement le défaut que `peindreBande`
 *      avait été écrit pour corriger sur l'archer, et que l'impact n'avait jamais reçu.
 *      → La teinte se peint désormais APRÈS `interpolate`, comme le recul, et elle TIENT.
 *   2. LE RECUL ÉTAIT SOUS LE SEUIL. Trois pixels sur une tuile de seize, résorbés en
 *      160 ms d'une course en (1−t)² : l'écart est déjà à moitié mangé au bout de 47 ms.
 *      Un coup de hache dans un cerf et une gifle rendaient le même écart.
 *      → L'amplitude SUIT LES DÉGÂTS, et le retour attend.
 *   3. IL N'Y AVAIT PAS DE TEMPS D'ARRÊT. Rien ne s'arrêtait jamais : le corps encaissait
 *      en glissant, sans une image d'immobilité. Or c'est l'ARRÊT qui fait le poids d'un
 *      coup — le reste n'en est que la retombée.
 *   4. LA TEINTE NE POUVAIT PAS BLANCHIR (corrigé le 2026-08-31). `peindreRecul` posait
 *      `setTint(0xff8877)` en laissant le MODE à `MULTIPLY` — or multiplier des texels par
 *      (1 · 0,53 · 0,47) ne sait qu'ASSOMBRIR et rougir. Sur un loup déjà sombre, le
 *      « flash » ne montait pas au-dessus du sprite : il s'y enfonçait. Un flash est de la
 *      LUMIÈRE, et la lumière se pose en `FILL` — l'aplat garde l'alpha, donc la
 *      silhouette (`peindreBande` le prouve sur l'archer depuis toujours). Le corps est
 *      donc BLANC tant qu'il est cloué, puis il reprend sa silhouette et la teinte se
 *      retire par `teinte` — qui était calculée et jetée.
 *
 * ═══ LA FRONTIÈRE, INCHANGÉE (attack-fx, « la règle du jus ») ═══
 *
 * Rien ici ne touche la simulation. Le temps d'arrêt est un HOLD DE SPRITE — le corps
 * peint reste où il est pendant `ARRET_MS` — jamais un gel de la boucle : le client
 * interpole des snapshots, et figer le monde accumulerait une dette d'interpolation
 * qu'il faudrait rendre d'un claquement. On peint par-dessus la vérité ; on ne la
 * bouscule pas.
 */

/** Le temps d'arrêt : le corps est CLOUÉ, à l'écart plein. Court — c'est un temps, pas une pause. */
export const ARRET_MS = 70
/** Toute la réaction, temps d'arrêt compris. Au-delà, le corps a repris sa vie. */
export const ENCAISSE_MS = 260

/** L'écart le plus faible — un coup qui ne fait presque rien se sent quand même. */
export const RECUL_MIN_PX = 4
/** L'écart le plus fort. Neuf pixels sur une tuile de seize : on le voit, le corps ne change pas de case. */
export const RECUL_MAX_PX = 9
/** Les dégâts qui valent le plein écart. La lance frappe à 16, chargée bien au-delà. */
export const DEGATS_PLEIN = 18

/** L'écrasement au plus tassé, en fraction de la taille : le corps se ramasse sous le coup. */
export const ECRASE_MAX = 0.13

/** LE FLASH — l'aplat posé sur le corps cloué. Blanc franc : c'est de la lumière, pas une
 *  couleur d'équipe ; toute autre teinte se lirait comme une INFORMATION (le rouge est
 *  déjà pris par l'arc de l'en-face, la crème par le sien). */
export const FLASH_BLANC = 0xffffff
/** LA TEINTE DE LA RETOMBÉE, en `MULTIPLY` : le sang monte sous la peau après le coup. */
export const IMPACT_TINT = 0xff8877

/**
 * LA TEINTE DE RETOMBÉE À `part` DE SON PLEIN — et le blanc est le ZÉRO de cette échelle.
 *
 * En mode `MULTIPLY`, 0xffffff est l'IDENTITÉ : multiplier par 1 ne change rien. Une teinte
 * qui se retire ne va donc pas vers le noir (ce serait une ombre) mais vers le BLANC.
 * L'inverse — la faute naturelle — éteindrait le corps au lieu de le rendre.
 */
export function teinteImpact(part: number): number {
  const p = part <= 0 ? 0 : part >= 1 ? 1 : part
  let couleur = 0
  for (let d = 16; d >= 0; d -= 8) {
    const cible = (IMPACT_TINT >> d) & 0xff
    couleur = (couleur << 8) | Math.round(255 + (cible - 255) * p)
  }
  return couleur
}

/** L'état peint d'un corps frappé, à un instant donné. */
export interface Encaissement {
  /** Part de l'écart de recul, 1 au plein écart puis résorbée. */
  recul: number
  /** Part de l'écrasement, 1 au plus tassé. Le corps s'aplatit ET s'élargit. */
  ecrase: number
  /**
   * Le corps est-il encore dans le temps d'arrêt ? C'est là — et LÀ SEULEMENT — qu'il est
   * un APLAT BLANC : cloué ET blanc, un seul événement pour l'œil. Passé l'arrêt, il
   * retrouve sa silhouette et la teinte se retire (`teinte`).
   */
  arret: boolean
  /** Part de la teinte d'impact APRÈS le flash, 1 pleine puis fondue jusqu'à rien. */
  teinte: number
}

const REPOS: Encaissement = { recul: 0, ecrase: 0, arret: false, teinte: 0 }

/**
 * L'ÉTAT À `t` MILLISECONDES DU COUP.
 *
 * Deux temps, et la couture est CONTINUE (les trois parts valent 1 des deux côtés de
 * `ARRET_MS`) : le corps est cloué à l'écart plein, puis il revient en (1−u)². La
 * détente part donc fort et meurt — c'est un encaissement, pas un déplacement.
 */
export function encaissement(t: number): Encaissement {
  if (t < 0 || t >= ENCAISSE_MS) return REPOS
  if (t < ARRET_MS) return { recul: 1, ecrase: 1, arret: true, teinte: 1 }
  const u = (t - ARRET_MS) / (ENCAISSE_MS - ARRET_MS)
  const k = (1 - u) * (1 - u)
  return { recul: k, ecrase: k, arret: false, teinte: 1 - u }
}

/**
 * L'AMPLITUDE DU RECUL, EN PIXELS, POUR DES DÉGÂTS DONNÉS.
 *
 * Pente CONTINUE entre les deux bornes, plate au-delà : un coup de poing (6) et un coup
 * de lance (16) ne peuvent pas rendre le même écart, sinon l'arme ne se sent pas — et
 * c'est l'identité par la FORME de `combat.md` R4bis rendue à l'œil.
 */
export function amplitudeRecul(degats: number): number {
  const part = degats <= 0 ? 0 : degats >= DEGATS_PLEIN ? 1 : degats / DEGATS_PLEIN
  return RECUL_MIN_PX + (RECUL_MAX_PX - RECUL_MIN_PX) * part
}

/** La secousse de caméra d'un coup PORTÉ, en fraction de cadre — l'unité de `camera.shake`. */
export const SECOUSSE_PORTE_MIN = 0.0022
export const SECOUSSE_PORTE_MAX = 0.0055
/** Sa durée, en ms : elle doit couvrir le temps d'arrêt, sans quoi le corps repart avant la caméra. */
export const SECOUSSE_PORTE_MS = 80

/**
 * LA SECOUSSE D'UN COUP QUE J'AI PORTÉ.
 *
 * Elle reste FRANCHEMENT sous celle qu'on encaisse (0,006) : frapper et être frappé ne
 * doivent pas se ressentir pareil, sinon la seule information qui compte dans une mêlée
 * — « qui prend ? » — se noie. Mais elle suit les dégâts, comme le recul : un tourbillon
 * de hache dans trois corps ne peut pas rendre le même cadre qu'une gifle.
 */
export function secousseDuCoup(degats: number): number {
  const part = degats <= 0 ? 0 : degats >= DEGATS_PLEIN ? 1 : degats / DEGATS_PLEIN
  return SECOUSSE_PORTE_MIN + (SECOUSSE_PORTE_MAX - SECOUSSE_PORTE_MIN) * part
}
