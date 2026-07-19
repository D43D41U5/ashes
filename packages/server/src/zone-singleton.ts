/**
 * Le monde de la zone, bâti UNE fois pour le processus.
 *
 * `createZone()` génère le terrain (~10 s de CPU synchrone) : le faire dans
 * `ZoneRoom.onCreate` gèlerait la boucle d'événements PENDANT la requête de
 * matchmaking du premier joueur — le socket lâche (« socket hang up »). On le
 * bâtit donc au DÉMARRAGE du serveur (avant `listen`, quand aucun client
 * n'attend), et `onCreate` ne fait que récupérer ce singleton, instantanément.
 *
 * En L1 il n'y a qu'une zone : ce monde unique survit aussi à une éventuelle
 * recréation de room (le tick reprend là où il en était), ce qui est le
 * comportement voulu d'« une seule zone persistante le temps de la session ».
 */
import { createZone, type LanWorld } from './scenario'

let cached: LanWorld | undefined

/** Le monde de la zone — bâti au premier appel, réutilisé ensuite. */
export function getZone(): LanWorld {
  if (!cached) cached = createZone()
  return cached
}
