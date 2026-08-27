/**
 * LE SOUFFLE D'UN ESSAIM DE LUCIOLES — math PURE, aucun import Phaser (même patron que
 * `framing.ts` et `lighting.ts` : ce qui se prouve par un nombre sort de la scène).
 *
 * ═══ POURQUOI PAS UN SINUS (demande d'Alexis, 2026-08-26 : « organique en intensité ») ═══
 *
 * Un sinus unique est une respiration de machine : même amplitude, même durée, indéfiniment.
 * L'œil apprend la période en trois cycles et la lueur devient un métronome — le travers qu'on
 * reprochait déjà à la moyenne des clignotements individuels (sept à douze sinus de MÊME
 * fréquence, dont la moyenne est une constante).
 *
 * TROIS sinus de fréquences INCOMMENSURABLES entre elles (rapports ≈ 1,64 et 1,79 — aucun
 * rationnel simple), d'amplitudes décroissantes, sur des phases dérivées de celle de l'essaim.
 * La somme ne se referme jamais sur une période courte : la lueur monte, s'attarde, retombe à
 * demi, repart. Ce sont les RAPPORTS qui font l'organique, pas le nombre de termes — trois
 * sinus commensurables (0,5 / 1,0 / 1,5) rendraient une forme d'onde plus riche mais tout
 * aussi cyclique, et l'œil l'apprendrait pareil.
 *
 * MESURÉ, sur les 40 premiers maxima locaux : **26 hauteurs de pic distinctes** contre **1**
 * pour le sinus seul. C'est la garde de `souffle-essaim.test.ts`, et c'est la définition
 * opératoire d'« organique » : deux respirations de suite ne se ressemblent pas.
 */

/** Les trois pulsations (rad/s). La plus lente porte, les deux autres décalent. */
export const SOUFFLE_RAD_S: readonly [number, number, number] = [0.55, 0.9, 1.61]
/** Leurs amplitudes — elles somment à 0,5, donc le brut couvre exactement [0, 1]. */
export const SOUFFLE_AMP: readonly [number, number, number] = [0.3, 0.14, 0.06]
/** Plancher : un essaim ne s'éteint JAMAIS tout à fait, il faiblit. */
export const SOUFFLE_PLANCHER = 0.35

/**
 * Le souffle à l'instant `t` (secondes), pour un essaim de déphasage `phase`. Rendu dans
 * [`SOUFFLE_PLANCHER`, 1] — c'est un FACTEUR, que l'appelant multiplie par l'intensité de sa
 * source (le point light) et par l'alpha de sa flaque, pour que les deux battent ensemble.
 */
export function souffleDEssaim(t: number, phase: number): number {
  const brut =
    0.5 +
    SOUFFLE_AMP[0] * Math.sin(SOUFFLE_RAD_S[0] * t + phase) +
    SOUFFLE_AMP[1] * Math.sin(SOUFFLE_RAD_S[1] * t + phase * 1.7) +
    SOUFFLE_AMP[2] * Math.sin(SOUFFLE_RAD_S[2] * t + phase * 2.9)
  return SOUFFLE_PLANCHER + (1 - SOUFFLE_PLANCHER) * Math.max(0, Math.min(1, brut))
}
