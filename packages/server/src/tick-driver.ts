/**
 * Le pilote de tick — la partie PURE de la boucle serveur : rassembler les inputs
 * des clients en `MoveInput[]` pour `step`, suivre l'ombre des stocks de nœuds, et
 * projeter le corps commun d'un snapshot. Isolé de Colyseus exprès : c'est ici que
 * vit le déterminisme (ordre des inputs, deltas), et ça se teste headless
 * (`tick-driver.test.ts`). `zone-room.ts` ne fait que brancher le transport dessus.
 */
import { drainEvents, getGameTime, type MoveInput, type NodeDelta, type PlayerAction, type SimState, type SnapshotMessage } from '@braises/sim'
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
}

/** Un client tout juste connecté : immobile, rien d'acquitté. */
export function newClientState(entityId: number): ClientState {
  return { entityId, input: { dx: 0, dy: 0, sprint: false, sneak: false, block: false }, ack: 0 }
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
 * Diff local des stocks de nœuds depuis le dernier tick (zéro clone des ~60k nœuds).
 * `shadow` est l'état du TRANSPORT (dernier stock envoyé), pas du /sim — amorcé à la
 * création de la zone avec les stocks courants, puis avancé ici. Une seule fois par
 * tick, globalement : le corps du snapshot est partagé par tous les clients.
 */
export function collectNodeDeltas(sim: SimState, shadow: Map<number, number>): NodeDelta[] {
  const deltas: NodeDelta[] = []
  for (const n of sim.nodes) {
    if (shadow.get(n.id) !== n.stock) {
      shadow.set(n.id, n.stock)
      deltas.push({ id: n.id, stock: n.stock })
    }
  }
  return deltas
}

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
    blood: sim.blood,
    wind: sim.wind,
    groundItems: sim.groundItems,
    events: drainEvents(sim),
  }
}
