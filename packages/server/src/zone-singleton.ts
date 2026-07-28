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
 *
 * ── POURQUOI LE MONDE SE RÉCLAME AU LIEU DE SE SERVIR ───────────────────────────
 *
 * Un monde partagé + `getZone()` en libre-service, c'est UNE simulation pour N rooms.
 * Le chemin existe : le client fait `joinOrCreate('zone')` ; à `maxClients` (50) la
 * room #1 se verrouille toute seule (`@colyseus/core`), et `joinOrCreate` en CRÉE une
 * seconde — qui récupérait le MÊME `SimState` et armait un SECOND
 * `setSimulationInterval` dessus. La vallée aurait alors avancé à 40 Hz, chaque room
 * ignorant les inputs de l'autre, et les deux journaux de replay auraient été deux faux
 * témoignages du même monde. Rien n'aurait planté : le temps aurait juste doublé.
 *
 * Le monde se RÉCLAME donc, et une seconde room est refusée à la création — la vallée
 * est pleine, ce qui est la vérité, plutôt que dédoublée, ce qui est un mensonge.
 */
import { createZone, type LanWorld } from './scenario'

let cached: LanWorld | undefined
/** Qui simule ce monde en ce moment (la room propriétaire), ou personne. */
let holder: object | undefined

/** Le monde de la zone — bâti au premier appel, réutilisé ensuite. Ne réclame rien :
 *  c'est le pré-chauffage du démarrage (voir `index.ts`) et la lecture des tests. */
export function getZone(): LanWorld {
  if (!cached) cached = createZone()
  return cached
}

/**
 * Réclame le monde pour `owner`. LÈVE si une autre room le simule déjà — Colyseus fait
 * alors échouer la création de room, et le joueur en trop reçoit un refus franc au lieu
 * d'entrer dans une vallée fantôme.
 */
export function claimZone(owner: object): LanWorld {
  if (holder !== undefined && holder !== owner) {
    throw new Error('zone : une seule simulation par processus — la vallée est déjà tenue par une autre room.')
  }
  holder = owner
  return getZone()
}

/** Rend le monde (dispose de la room). Le monde LUI-MÊME survit : le tick reprendra où il en était. */
export function releaseZone(owner: object): void {
  if (holder === owner) holder = undefined
}
