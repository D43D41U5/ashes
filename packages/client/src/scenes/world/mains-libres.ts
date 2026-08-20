/**
 * LES MAINS LIBRES — LE JOUEUR COMMANDE-T-IL SON AVATAR, À CET INSTANT ?
 *
 * Une règle pure, extraite de `WorldScene.update()` pour la même raison que `framing.ts` et
 * `interp.ts` avant elle : ce qui vit dans la scène n'est atteint par aucun test, et c'est là
 * que les trois trous suivants ont vécu.
 *
 * ① ON MARCHAIT EN TAPANT — corrigé de longue date, c'est la garde d'origine.
 * ② ON MARCHAIT MORT. Le geste maintenu (`tickHold`) était bien gardé par `dying`, le PAS ne
 *    l'était pas. Or on meurt en FUYANT : la prédiction continuait donc d'intégrer le cap sous
 *    l'écran noir, et l'avatar réveillé au Feu s'en éloignait à l'aveugle.
 * ③ ON MARCHAIT LE MENU PAUSE OUVERT. `syncPause()` fige l'HÔTE, jamais la prédiction : en solo
 *    l'avatar glissait sur un monde immobile puis se faisait rappeler d'un téléport franc au
 *    premier snapshot ; en multi le serveur IGNORE `pause` (« le monde des autres ne s'arrête
 *    pas »), donc on marchait pour de vrai. Un menu pause qui laisse jouer n'en est pas un.
 *
 * Les trois se ressemblent tellement qu'ils ont été écrits séparément et corrigés séparément.
 * Ici ils sont UNE règle, avec ses huit cas affirmés — et le prochain état qui doit figer le
 * pas est un champ de plus, pas une condition oubliée dans une ligne de 200 caractères.
 *
 * ⚠ CE QUI N'EST PAS ICI, ET POURQUOI. La carte plein écran et l'écran personnage ouvrent eux
 * aussi un panneau, et ils ne figent PAS le pas aujourd'hui. C'est peut-être un défaut, mais
 * c'est une question de JEU (peut-on marcher en consultant sa carte ?), pas une question de
 * code : elle revient à Alexis, et le jour où elle tombe, c'est un champ ici et un cas de plus
 * dans la garde. Le menu PAUSE, lui, n'est pas une question — d'où sa présence.
 */

/** L'état du joueur au moment où l'on lit ses touches. Trois faits, trois sources distinctes. */
export interface EtatDesMains {
  /** Un champ de saisie a le clavier : recherche du panneau d'artisanat, ou chat. */
  saisit: boolean
  /** Le voile de mort court : on est tombé, on n'a pas encore repris la main au Feu. */
  meurt: boolean
  /** Le MENU PAUSE est ouvert (et lui seul — voir l'avertissement en tête de fichier). */
  enPause: boolean
}

/**
 * Le joueur peut-il commander son avatar ? Faux ⇒ déplacement, sprint, pas lent et parade
 * sont muets — pas seulement le déplacement : une stance qu'on tient encore sous un menu est
 * le même mensonge, en plus discret.
 */
export function mainsLibres(e: EtatDesMains): boolean {
  return !e.saisit && !e.meurt && !e.enPause
}
