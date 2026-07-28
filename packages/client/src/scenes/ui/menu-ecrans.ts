/**
 * LA NAVIGATION DU MENU — quels écrans existent, et lequel « REPRENDRE » propose.
 *
 * Module PUR (aucun DOM, l'horloge en paramètre) : c'est la partie du menu qui DÉCIDE, et elle
 * se teste sans navigateur. `menu-dom.ts` ne fait ensuite que la peindre.
 */
import type { SlotMeta } from '../../worker/persistence-store'
import type { DerniereMulti } from '../../derniere-partie'

/** Les cinq écrans du menu. `accueil` est la racine ; les autres se referment vers elle. */
export type Ecran = 'accueil' | 'jouer' | 'vallees' | 'serveurs' | 'options'

/**
 * CE QUE « REPRENDRE » ROUVRIRAIT — la partie la plus récemment jouée, quel que soit son mode.
 *
 * Les deux branches ne portent PAS la même richesse, et c'est structurel (décision d'Alexis) :
 * une Veillée est sur ce disque, donc on sait son jour et sa seed ; une vallée partagée vit sur
 * un serveur, donc on ne sait que son nom et quand on y est allé. Voir `derniere-partie.ts`.
 */
export type Reprise =
  | { genre: 'solo'; slot: number; meta: SlotMeta; at: number }
  | { genre: 'multi'; url: string; nom: string; at: number }

/**
 * La plus récente des deux — ou `null` s'il n'y a rien à reprendre (l'accueil n'affiche alors
 * pas le bouton du tout : un « REPRENDRE » grisé sur un premier lancement est une promesse
 * qu'on montre à quelqu'un qui ne peut pas la tenir).
 *
 * On compare des horloges MURALES venues de deux stockages différents (IndexedDB pour le solo,
 * localStorage pour le multi) : elles sont écrites par la même machine, donc comparables. Une
 * date à 0 (inconnue) perd toujours — mais ne disqualifie pas la partie, elle la classe dernière.
 */
export function repriseLaPlusRecente(slots: readonly (SlotMeta | null)[], multi: DerniereMulti | null): Reprise | null {
  let meilleur: Reprise | null = null
  slots.forEach((meta, slot) => {
    if (!meta) return
    if (!meilleur || meta.savedAt > meilleur.at) meilleur = { genre: 'solo', slot, meta, at: meta.savedAt }
  })
  if (multi && (!meilleur || multi.at > (meilleur as Reprise).at)) {
    return { genre: 'multi', url: multi.url, nom: multi.nom, at: multi.at }
  }
  return meilleur
}
