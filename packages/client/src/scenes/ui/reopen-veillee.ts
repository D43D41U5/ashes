/**
 * LES DEUX SORTIES D'UNE PARTIE — rouvrir la même vallée à neuf, ou revenir aux vallées.
 *
 * Toutes deux RECHARGENT LA PAGE, et ce n'est pas de la paresse : un Worker vivant garde en
 * mémoire l'identité du monde qu'il a ouvert (`carteEcrite`, la base des nœuds, la chronique).
 * Repartir sans recharger demanderait de prouver qu'aucun de ces états ne survit au changement
 * de monde — alors que l'invariant de `clearSlot` exige justement qu'aucun Worker ne vive quand
 * on efface. Un rechargement rend cette preuve gratuite. (Voir `persistence-store.ts`.)
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

/**
 * REVENIR À L'ÉCRAN DES VALLÉES — sans rien détruire. Le geste du menu pause depuis que le
 * joueur tient cinq mondes : quitter n'est plus « effacer », c'est changer de vallée. (Ce qu'on
 * efface, on l'efface DANS la liste, où l'on voit ce qu'on perd.)
 *
 * L'appelant doit s'être assuré que la partie est SAUVÉE (voir `WorldScene.quitVersMondes`) :
 * ici, on ne fait que naviguer.
 */
export function reopenMondes(): void {
  window.location.href = window.location.pathname
}
