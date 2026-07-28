/**
 * L'OMBRE DES STOCKS DE NŒUDS — le diff qui évite d'envoyer 125 686 nœuds par tick.
 *
 * Le protocole transmet les nœuds UNE fois (au `ready`), puis seulement les stocks qui
 * ont bougé. Il faut donc, à chaque tick, comparer l'état courant à ce que le client sait
 * déjà : c'est cette « ombre ». Elle appartient au TRANSPORT, jamais au `SimState` — elle
 * n'est ni sérialisée, ni sauvegardée, ni rejouée.
 *
 * ── POURQUOI CE CODE VIT DANS /sim ──────────────────────────────────────────────
 *
 * Ce n'est pas de la logique de jeu, et ça n'a rien à faire dans un hôte non plus : les
 * DEUX hôtes en ont besoin, et ils en tenaient chacun leur copie (`server/tick-driver.ts`
 * et `client/worker/sim-worker.ts`), identiques caractère pour caractère à un bloc près.
 * Ce « à un bloc près » est exactement le mal qu'on corrige : le serveur avait reçu une
 * réconciliation des nœuds disparus, le worker solo ne l'a jamais eue — deux hôtes, deux
 * comportements, sur ce que CLAUDE.md appelle « une simulation, pas deux jeux ».
 *
 * `protocol.ts` vit déjà ici et EST le protocole réseau (CLAUDE.md) ; `NodeDelta` y est
 * défini. Le calcul d'un `NodeDelta[]` est donc de la mécanique de protocole, pure, sans
 * horloge ni E/S — elle passe le garde-fou de pureté sans exception.
 *
 * ── POURQUOI UN TABLEAU TYPÉ ET PAS UNE `Map` ───────────────────────────────────
 *
 * L'ombre était une `Map<id, stock>`. MESURÉ sur le monde de production (125 686 nœuds,
 * temps CPU, variantes alternées) :
 *
 *     `step` seul .................................  2,45 ms/tick
 *     `step` + diff par `Map` .....................  14,47 ms/tick   (+12,02)
 *     `step` + diff par tableau typé ..............   2,72 ms/tick   (+0,27)
 *
 * Le coût n'était PAS la longueur du balayage — parcourir 125 686 nœuds coûte 0,27 ms.
 * C'étaient les 125 686 `Map.get`/`Map.set`, à ~95 ns pièce. Et côté Veillée solo, le
 * même diff coûtait **9,6 ms/tick, soit 19 % du budget et TROIS FOIS le prix de la
 * simulation elle-même**, vingt fois par seconde, pour émettre zéro delta.
 *
 * Indexé par `id` plutôt que par position dans le tableau : c'est un peu moins rapide
 * (×9 au lieu de ×45) et ça vaut très largement la différence, parce que ça supprime
 * TROIS hypothèses fragiles au lieu de les documenter —
 *   • l'ordre de `state.nodes` n'a plus besoin d'être stable (la Cendre remplace le
 *     tableau 42 fois par saison, dont 11 fois SANS en changer la longueur) ;
 *   • les entrées des nœuds DÉTRUITS ne fuient plus : elles occupent une case d'un
 *     tableau de taille fixe au lieu de gonfler une `Map` à vie (c'était 26 805 entrées
 *     périmées au jour 60, 21 % du total) — il n'y a donc plus rien à purger, ni de
 *     purge à oublier d'un côté ;
 *   • un nœud SEMÉ en cours de partie (aucun système ne le fait aujourd'hui, mais le
 *     jour où l'agriculture le fera) est vu tout seul : `id` inconnu ⇒ delta émis.
 *
 * Les identifiants sont denses par construction (MESURÉ : 28 trous pour 125 690 ids),
 * donc le tableau ne gaspille rien ; il grandit tout seul si un id le dépasse.
 */
import type { ResourceNode } from './economy'
import type { NodeDelta } from './protocol'

/** Un stock ne peut pas être négatif : −1 marque donc « ce nœud, le client ne le connaît pas ». */
const JAMAIS_VU = -1

/**
 * Ce que le destinataire sait déjà des stocks, indexé par `node.id`. État d'HÔTE :
 * jamais dans `SimState`, jamais sérialisé.
 */
export interface NodeShadow {
  /** Dernier stock transmis par identifiant, ou `JAMAIS_VU`. Grandit si un id la dépasse. */
  stocks: Int32Array
}

function tailleePour(nodes: readonly ResourceNode[]): number {
  let maxId = 0
  for (const n of nodes) if (n.id > maxId) maxId = n.id
  return maxId + 1
}

/** Une ombre VIERGE, dimensionnée pour ces nœuds : le premier diff les émettra tous. */
export function createNodeShadow(nodes: readonly ResourceNode[]): NodeShadow {
  const stocks = new Int32Array(tailleePour(nodes))
  stocks.fill(JAMAIS_VU)
  return { stocks }
}

/**
 * Amorce l'ombre sur l'état COURANT : « le destinataire connaît déjà tout ça ». Les deux
 * hôtes le font juste après avoir envoyé la liste complète des nœuds (`ready`), pour que
 * le premier tick n'émette pas 125 686 deltas redondants.
 */
export function seedNodeShadow(shadow: NodeShadow, nodes: readonly ResourceNode[]): void {
  for (const n of nodes) {
    if (n.id >= shadow.stocks.length) agrandir(shadow, n.id)
    shadow.stocks[n.id] = n.stock
  }
}

/** Agrandit l'ombre pour accueillir `id`, en conservant ce qu'elle savait. */
function agrandir(shadow: NodeShadow, id: number): void {
  const taille = Math.max(id + 1, shadow.stocks.length * 2)
  const neuf = new Int32Array(taille)
  neuf.fill(JAMAIS_VU)
  neuf.set(shadow.stocks)
  shadow.stocks = neuf
}

/**
 * Les nœuds dont le stock a bougé depuis le dernier appel, et avance l'ombre. Zéro clone
 * des ~125 000 nœuds : on ne construit que ce qui change.
 *
 * Un nœud à `stock 0` a pu DÉRIVER (spec recolte-vivante) — l'épuisement est le seul
 * instant où un nœud bouge — donc on joint sa position (le client le déménage) ET son
 * `regrowAt` (le client anime la repousse au lieu de popper).
 *
 * À appeler EXACTEMENT UNE FOIS par tick et par ombre : le second appel ne verrait plus
 * rien, l'ombre ayant déjà avancé.
 */
export function collectNodeDeltas(nodes: readonly ResourceNode[], shadow: NodeShadow): NodeDelta[] {
  const deltas: NodeDelta[] = []
  let stocks = shadow.stocks
  for (const n of nodes) {
    if (n.id >= stocks.length) {
      agrandir(shadow, n.id)
      stocks = shadow.stocks
    }
    if (stocks[n.id] === n.stock) continue
    stocks[n.id] = n.stock
    deltas.push(
      n.stock === 0
        ? { id: n.id, stock: 0, tx: n.tx, ty: n.ty, regrowAt: n.regrowAt }
        : { id: n.id, stock: n.stock },
    )
  }
  return deltas
}
