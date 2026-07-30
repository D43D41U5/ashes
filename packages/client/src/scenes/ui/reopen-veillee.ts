/**
 * ROUVRIR LA MÊME VALLÉE À NEUF — la sortie par la stèle de fin de saison.
 *
 * Elle RECHARGE LA PAGE, et ce n'est pas de la paresse : elle doit EFFACER la case avant de
 * repartir, et l'invariant de `clearSlot` exige qu'aucun Worker ne vive à cet instant (voir
 * `persistence-store.ts`). Le rechargement rend cette preuve gratuite, et le deep-link
 * `?solo&fresh` fait le ménage en un seul endroit.
 *
 * L'AUTRE SORTIE — « retour au menu principal », le geste du menu pause — ne recharge PLUS depuis le
 * 2026-07-29 : elle n'efface rien, donc elle n'a pas ce prix à payer. Elle vit dans
 * `WorldScene.quitterVersMondes`, qui arrête la scène (donc tue le Worker) et rend la main à
 * `MenuScene`.
 */

/**
 * ROUVRIR une Veillée NEUVE — MÊME case, MÊME seed, vidée de nos marques. C'est le geste de la
 * stèle de fin de saison : la vallée se réveille du froid, on n'en change pas.
 *
 * Le deep-link `?solo&fresh` que `MenuScene` consomme fait le ménage (sauvegarde ET brouillard)
 * avant de démarrer — une SEULE source de ce contrat.
 */
export function reopenFreshVeillee(slot: number, seed: number): void {
  window.location.href = `${window.location.pathname}?solo&fresh&slot=${slot}&seed=${seed}`
}
