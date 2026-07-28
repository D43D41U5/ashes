/**
 * CE QU'UNE LIGNE DE L'ÉCRAN DES MONDES DIT — en toutes lettres, et rien de plus.
 *
 * Module PUR (aucun DOM, aucune horloge implicite : `maintenant` est un paramètre) parce que
 * c'est la seule partie de l'écran qui puisse mentir. « jour 14 », « il y a 2 h » : ce sont des
 * promesses sur une sauvegarde qu'on n'a pas ouverte, et un joueur qui efface la mauvaise case
 * perd des heures. On les prouve donc au test, pas à l'œil.
 */
import type { SlotMeta } from '../../worker/persistence-store'

/** Le nom d'une case — sa POSITION dans la liste, stable d'une session à l'autre. */
export function nomDeCase(slot: number): string {
  return `VALLÉE ${slot + 1}`
}

/**
 * L'état d'une vallée : le jour atteint, et la seed qui l'a semée.
 *
 * `seasonDay: 0` et `seed: 0` sont les inconnus de `metaDepuisSauvegarde` (sauvegarde d'un
 * format qu'on n'a pas su ouvrir). On dit alors « jour ? » plutôt que d'inventer un jour 1 :
 * la case reste occupée, donc effaçable, et personne ne croit à une partie fraîche.
 */
export function etatDeMonde(meta: SlotMeta): string {
  const jour = meta.seasonDay > 0 ? `jour ${meta.seasonDay}` : 'jour ?'
  return meta.seed > 0 ? `${jour} · seed ${meta.seed}` : jour
}

/** Une minute, une heure, un jour — en millisecondes d'horloge murale. */
const MINUTE = 60_000
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

/**
 * DEPUIS QUAND cette vallée dort. Rendu court (une colonne étroite), et JAMAIS une date :
 * « il y a 2 h » se lit sans compter, « 14:32 » demande de savoir quel jour on est.
 *
 * Rend `''` quand on ne sait pas (`savedAt` absent) ou quand l'horodatage est dans le futur —
 * ce qui arrive pour de vrai : une sauvegarde faite avant un recalage d'horloge système. Mieux
 * vaut ne rien dire que d'annoncer « il y a -3 h ».
 */
export function depuisQuand(savedAt: number, maintenant: number): string {
  if (!savedAt || savedAt > maintenant) return ''
  const ecart = maintenant - savedAt
  if (ecart < MINUTE) return "à l'instant"
  if (ecart < HEURE) return `il y a ${Math.floor(ecart / MINUTE)} min`
  if (ecart < JOUR) return `il y a ${Math.floor(ecart / HEURE)} h`
  const jours = Math.floor(ecart / JOUR)
  return jours === 1 ? 'hier' : `il y a ${jours} jours`
}
