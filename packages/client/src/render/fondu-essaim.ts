/**
 * LE FONDU D'UN ESSAIM DE LUCIOLES — math PURE, aucun import Phaser (même patron que
 * `souffle-essaim.ts`, qui porte la RESPIRATION d'un essaim établi ; ici c'est sa NAISSANCE
 * et sa MORT, deux choses différentes qui ne doivent pas se lire dans le même fichier).
 *
 * ═══ POURQUOI (demande d'Alexis, 2026-08-26 : « qu'elles n'apparaissent et ne disparaissent
 * pas d'un coup ») ═══
 *
 * Un essaim naissait ALLUMÉ. Sa lumière et sa flaque montaient bien avec la nuit (le facteur
 * `nuit` de `ambient-life`), mais l'alpha des mouches, lui, ne dépendait de RIEN d'autre que
 * de leur clignotement : à l'image où l'essaim se posait, sept à douze lueurs additives
 * s'inscrivaient d'un coup sur le noir, à 10-28 tuiles du joueur — donc en plein cadre. Et il
 * mourait de même, par `destroy()`, entre deux images.
 *
 * DEUX IDÉES, et la seconde est celle qui fait l'effet :
 *
 *  ① UNE RAMPE, adoucie aux deux bouts (`adoucir`, smoothstep). Une rampe linéaire se voit
 *     démarrer et se voit s'arrêter — ce sont les CASSURES de pente que l'œil attrape, pas la
 *     vitesse. Le smoothstep a une dérivée nulle en 0 et en 1 : la lueur s'insinue.
 *
 *  ② LES MOUCHES NE S'ALLUMENT PAS ENSEMBLE. Un essaim dont les douze lueurs montent à
 *     l'unisson reste un interrupteur, juste plus lent — un fondu de diaporama. Chacune porte
 *     donc un RETARD propre, et l'essaim s'éveille par contagion : une, puis trois, puis la
 *     nuée. À l'extinction, la même bousculade en sens inverse.
 *
 * L'étalement (`ECLOSION_ETALEMENT`) est la part de la fenêtre de fondu qu'on dépense à
 * décaler les mouches ; le reste est la durée de montée de CHACUNE. À 0,55, la dernière
 * mouche part quand la première a fini — l'essaim se remplit sans qu'on voie jamais un front.
 */

/** Durée de la montée d'un essaim (secondes). Réglage de DA : c'est ce qu'on allonge si
 *  l'apparition se voit encore. */
export const FONDU_ENTREE_S = 2.2
/** Et de sa descente. Plus court : on part plus vite qu'on n'arrive, sinon un essaim qui
 *  s'éteint à l'aube traîne alors que le ciel, lui, a déjà tourné. */
export const FONDU_SORTIE_S = 1.4
/** Part de la fenêtre dépensée à étaler les mouches (le reste = montée d'une mouche). */
export const ECLOSION_ETALEMENT = 0.55

/** Smoothstep : pente nulle aux deux bouts. `t` hors [0,1] est borné. */
export function adoucir(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/**
 * Ce que vaut le fondu POUR UNE MOUCHE, à l'avancement `fade` de son essaim (0 → 1) et pour
 * son `retard` propre (0 → 1, tiré à la naissance). Rendu dans [0, 1] — c'est un FACTEUR, que
 * l'appelant multiplie par l'alpha COMPLET de la mouche, plancher additif compris : un halo
 * additif à 0,05 se voit sur une nuit noire, et douze encore mieux.
 */
export function fonduLuciole(fade: number, retard: number): number {
  const r = retard < 0 ? 0 : retard > 1 ? 1 : retard
  return adoucir((fade - r * ECLOSION_ETALEMENT) / (1 - ECLOSION_ETALEMENT))
}
