/**
 * LE DÉSÉQUILIBRE — la forme, dans le temps, d'un corps qui vient de FENDRE L'AIR.
 *
 * Module PUR (aucun Phaser), pour la raison qui a déjà sorti `encaissement` d'`attack-fx`
 * et `shakeOffset` de `hit-fx` : une courbe de feel se règle en la LISANT.
 *
 * ═══ CE QU'IL REND VISIBLE, ET C'ÉTAIT LA MEILLEURE MÉCANIQUE INVISIBLE DU JEU ═══
 *
 * `recoveryWhiff` (spec combat R4quater) cloue sur place jusqu'à 1,6 s après une charge
 * ratée. C'est ce qui interdit de frapper à l'aveugle, et c'est très exactement la fenêtre
 * où le loup entre. **Rien ne le montrait.** Le joueur voyait son coup passer dans le vide,
 * puis mourait pendant une immobilité qu'il ne s'expliquait pas — il croyait avoir mal
 * cliqué, ou le jeu ne pas répondre. Une punition qu'on ne voit pas n'enseigne rien : elle
 * se vit comme une injustice.
 *
 * ═══ LA FORME : LE CORPS PART AVEC SON GESTE, PUIS SE RATTRAPE ═══
 *
 * Un coup qui rate n'a rencontré aucune résistance : l'élan continue. Le corps PENCHE
 * dans l'axe du coup, garde ouverte, et se redresse en luttant contre son propre poids —
 * d'où une sortie LENTE (là où l'encaissement, lui, part fort et meurt : `(1−u)²`). Ici
 * c'est l'inverse — `sin` d'une demi-arche : rien ne claque, tout traîne. Un raté ne
 * pique pas, il PÈSE.
 *
 * ⚠ RIEN ICI NE TOUCHE LA SIMULATION — c'est la même frontière qu'`encaissement` : on
 * peint par-dessus la vérité, on ne la bouscule pas. La sim, elle, a déjà cloué l'acteur
 * par son `cooldownUntil` ; le dessin ne fait que le DIRE.
 */

/** L'écart le plus fort, en pixels — le corps emporté par son geste. */
export const PENCHE_MAX_PX = 7
/** L'inclinaison la plus forte, en radians : la garde qui s'ouvre. */
export const INCLINE_MAX = 0.09
/**
 * Sous cette durée, on ne peint RIEN. Une récupération courte — celle d'un coup qui a
 * TOUCHÉ — n'est pas une punition : la marquer apprendrait au joueur que toucher coûte.
 *
 * 0,7 s, et la garde le VÉRIFIE sur tout l'arsenal plutôt que de le croire : la plus
 * longue des récupérations de TOUCHE est celle du tourbillon de hache (0,6 s), la plus
 * courte des récupérations de RATÉ d'un coup chargé vaut 1,2 s. Le seuil se pose dans
 * l'intervalle, et il y est seul. *(Premier jet à 0,5 s : c'était la valeur EXACTE du
 * `recoveryHit` de l'overhead des poings, qui se peignait donc — un coup réussi affiché
 * comme une punition.)*
 */
export const SEUIL_MS = 700

/** L'état peint d'un corps qui se rattrape, à un instant donné. */
export interface Desequilibre {
  /** Part de l'écart, 1 au plus penché puis résorbée. */
  penche: number
  /** Part de l'inclinaison — elle suit l'écart : c'est le même corps. */
  incline: number
}

const REPOS: Desequilibre = { penche: 0, incline: 0 }

/**
 * L'ÉTAT À `t` MILLISECONDES DU COUP MANQUÉ, pour une récupération de `duree` ms.
 *
 * Une demi-arche de sinus : nul au départ (le corps est encore dans son geste), maximal
 * au tiers, nul à la fin. Il n'y a pas de discontinuité à recoudre — le corps part de sa
 * position vraie et y revient, donc le dessin ne peut pas laisser de marche.
 */
export function desequilibre(t: number, duree: number): Desequilibre {
  if (duree < SEUIL_MS || t < 0 || t >= duree) return REPOS
  const u = t / duree
  // `sin(π·u^0.6)` : le pic est tiré vers le DÉBUT (u ≈ 0,3), et la queue s'étire. On
  // penche vite et l'on se redresse longtemps — c'est ce qui fait lire « il est planté ».
  const k = Math.sin(Math.PI * Math.pow(u, 0.6))
  return { penche: k, incline: k }
}
