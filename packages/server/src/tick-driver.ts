/**
 * Le pilote de tick — la partie PURE de la boucle serveur : rassembler les inputs
 * des clients en `MoveInput[]` pour `step`, suivre l'ombre des stocks de nœuds, et
 * projeter le corps commun d'un snapshot. Isolé de Colyseus exprès : c'est ici que
 * vit le déterminisme (ordre des inputs, deltas), et ça se teste headless
 * (`tick-driver.test.ts`). `zone-room.ts` ne fait que brancher le transport dessus.
 */
import { drainEvents, getGameTime, type MoveInput, type NodeDelta, type PlayerAction, type SimState, type SnapshotMessage } from '@ashes/sim'
import type { SanitizedInput } from './validate'

/**
 * L'état serveur d'un client connecté. `input` est le DERNIER input reçu, appliqué
 * à chaque tick et répété si rien de neuf n'arrive (comme le worker solo) ; `ack`
 * est le `seq` du dernier input accepté, renvoyé à CE client comme `lastProcessedInput`
 * (ancre de sa réconciliation). `pendingAction` : une action au plus par tick.
 */
export interface ClientState {
  entityId: number
  input: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; sprint: boolean; sneak: boolean; block: boolean }
  ack: number
  pendingAction?: PlayerAction
  /** Jetons de parole restants (voir `CHAT_BUCKET`). Décrémentés à l'émission, regarnis au tick. */
  chatTokens: number
}

/**
 * LE SEAU DE JETONS DU CHAT — la seule chose qui empêche un client de faire tousser la
 * boucle autoritative avec du texte.
 *
 * Rien ne bornait le chat : ni `sanitizeChat`, ni la room, ni Colyseus. MESURÉ sur un
 * serveur `ws` en boucle locale : 47 400 trames de chat par seconde acceptées d'un seul
 * client — chacune relayée à TOUS les autres, donc amplifiée ×50. Le budget d'un tick est
 * de 50 ms ; il n'en restait rien pour simuler la vallée.
 *
 * Un seau plutôt qu'un « un par tick » : un humain ne doit JAMAIS perdre un message qu'il
 * a tapé, même s'il en envoie deux coup sur coup. La rafale (`MAX`) couvre l'humain
 * pressé, le régime permanent (un jeton tous les `REFILL_TICKS`) coupe la machine.
 */
export const CHAT_BUCKET = {
  /** Rafale : quatre messages d'affilée passent sans attendre. */
  MAX: 4,
  /** Régime permanent : un jeton toutes les 10 ticks = 2 messages/seconde. Très au-dessus
   *  de la frappe humaine, très en dessous de ce qu'il faut pour noyer un tick. */
  REFILL_TICKS: 10,
} as const

/** Un client tout juste connecté : immobile, rien d'acquitté, le seau plein. */
export function newClientState(entityId: number): ClientState {
  return {
    entityId,
    input: { dx: 0, dy: 0, sprint: false, sneak: false, block: false },
    ack: 0,
    chatTokens: CHAT_BUCKET.MAX,
  }
}

/**
 * Ce client a-t-il le droit de parler maintenant ? Consomme un jeton et répond `true`,
 * ou répond `false` (le message est jeté, sans réponse — on ne renvoie pas d'accusé à
 * un flot, ce serait l'amplifier).
 */
export function spendChatToken(state: ClientState): boolean {
  if (state.chatTokens < 1) return false
  state.chatTokens -= 1
  return true
}

/** Regarnit les seaux : un jeton par client tous les `REFILL_TICKS`, plafonné à `MAX`. */
export function refillChatTokens(clients: Iterable<ClientState>, tick: number): void {
  if (tick % CHAT_BUCKET.REFILL_TICKS !== 0) return
  for (const c of clients) if (c.chatTokens < CHAT_BUCKET.MAX) c.chatTokens += 1
}

/** Applique un input assaini à l'état d'un client : il devient le dernier input, et son `seq` l'ack. */
export function acceptInput(state: ClientState, input: SanitizedInput): void {
  state.input = { dx: input.dx, dy: input.dy, sprint: input.sprint, sneak: input.sneak, block: input.block }
  state.ack = input.seq
}

/**
 * Un `MoveInput` par client, TRIÉ PAR `entityId`. `step` applique les inputs dans
 * l'ordre du tableau : trier rend l'issue indépendante de l'ordre d'itération de la
 * table des clients (qui n'est pas un contrat de jeu) et garantit le déterminisme
 * live↔live et vs replay. Consomme `pendingAction` (une par tick, puis effacée).
 */
export function gatherInputs(clients: Iterable<ClientState>): MoveInput[] {
  const inputs: MoveInput[] = []
  for (const c of clients) {
    inputs.push({ entityId: c.entityId, ...c.input, ...(c.pendingAction ? { action: c.pendingAction } : {}) })
    delete c.pendingAction // consommée : une action au plus par tick (exactOptionalPropertyTypes)
  }
  inputs.sort((a, b) => a.entityId - b.entityId)
  return inputs
}

/**
 * Le diff des stocks de nœuds a ÉMIGRÉ dans `/sim` (`node-shadow.ts`) : il était écrit
 * DEUX fois — ici et dans `client/worker/sim-worker.ts` —, identiques à un bloc près, et
 * ce bloc-là faisait déjà diverger le solo du multi. C'est de la mécanique de protocole,
 * pure, dont les deux hôtes ont besoin : elle vit désormais à un seul endroit, à côté du
 * protocole qu'elle sert. Au passage l'ombre est devenue un tableau typé indexé par `id`
 * (MESURÉ : 12,02 ms/tick → 0,27 ms sur le monde de production).
 *
 * Ré-exporté ici pour que les appelants du serveur n'aient pas à changer d'import.
 */
export { collectNodeDeltas } from '@ashes/sim'

/**
 * Le corps COMMUN d'un snapshot — tout sauf `lastProcessedInput`, qui diffère par
 * destinataire (chaque client reçoit `{ ...base, lastProcessedInput: ack }`). Draine
 * les événements de /sim : à appeler EXACTEMENT UNE FOIS par tick (sinon les clients
 * au-delà du premier perdraient events et deltas). Les tableaux sont partagés par
 * référence — pas de clone : entre deux ticks la sim ne mute pas, l'envoi Colyseus
 * sérialise immédiatement.
 */
export function buildSnapshotBase(sim: SimState, nodeDeltas: NodeDelta[]): Omit<SnapshotMessage, 'lastProcessedInput'> {
  return {
    type: 'snapshot',
    tick: sim.tick,
    time: getGameTime(sim),
    entities: sim.entities,
    structures: sim.structures,
    villages: sim.villages,
    functions: sim.functions,
    nodeDeltas,
    npcs: sim.npcs,
    monsters: sim.monsters,
    corpses: sim.corpses,
    reveils: sim.reveils,
    refugeeGroups: sim.refugeeGroups,
    blood: sim.blood,
    wind: sim.wind,
    groundItems: sim.groundItems,
    // LE FRONT MÉTÉO (spec meteo.md) : le record d'élection, cinq champs — le client en
    // recalcule la bande, le gradient et jusqu'aux éclairs. Rien d'autre ne transite.
    meteo: sim.meteo ?? null,
    events: drainEvents(sim),
  }
}
