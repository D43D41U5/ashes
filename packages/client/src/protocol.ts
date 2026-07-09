/**
 * Protocole client ⇄ hôte de simulation (spec client R1-R3).
 *
 * L'hôte est aujourd'hui un Web Worker (mode Veillée) et demain un serveur
 * (Phase LAN) : ces messages sont la répétition générale du réseau. On ne
 * transmet jamais de position côté client, seulement des intentions.
 */
import type {
  Corpse,
  Entity,
  GameTime,
  Monster,
  Npc,
  PlayerAction,
  ResourceNode,
  SimEvent,
  Structure,
  Village,
  WorldMap,
} from '@braises/sim'

/** À incrémenter à tout changement incompatible — vérifié au `ready`. */
export const PROTOCOL_VERSION = 1

/**
 * Le client demande à REJOINDRE — il ne choisit ni la seed, ni la carte, ni
 * le rythme : ce sont des décisions d'hôte (scénario côté Worker aujourd'hui,
 * serveur en LAN). Il reçoit tout ça dans `ready`.
 */
export interface JoinMessage {
  type: 'join'
  protocolVersion: number
}

export interface InputMessage {
  type: 'input'
  /** Numéro croissant : l'hôte l'acquitte, le client rejoue les non-acquittés (spec reconciliation R1). */
  seq: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint: boolean
  block: boolean
}

/** Une action ponctuelle (construire, fonder…) — appliquée au prochain tick. */
export interface ActionMessage {
  type: 'action'
  action: PlayerAction
}

/**
 * Pause/reprise de l'hôte — SOLO uniquement (onglet caché : le rAF du rendu
 * est suspendu mais pas le timer du Worker ; sans pause, l'avatar répéterait
 * son dernier input sans pilote). Un serveur LAN ignorera ces messages :
 * le monde des autres ne s'arrête pas.
 */
export interface PauseMessage {
  type: 'pause'
}
export interface ResumeMessage {
  type: 'resume'
}

export type ClientToHost = JoinMessage | InputMessage | ActionMessage | PauseMessage | ResumeMessage

export interface ReadyMessage {
  type: 'ready'
  protocolVersion: number
  playerId: number
  map: WorldMap
  seed: number
  calendarScale: number
  playerSpawn: { x: number; y: number }
}

export interface SnapshotMessage {
  type: 'snapshot'
  tick: number
  /** `seq` du dernier input du joueur appliqué à ce tick — ancre de réconciliation (spec R2). */
  lastProcessedInput: number
  time: GameTime
  entities: Entity[]
  structures: Structure[]
  villages: Village[]
  nodes: ResourceNode[]
  npcs: Npc[]
  monsters: Monster[]
  corpses: Corpse[]
  events: SimEvent[]
}

export type HostToClient = ReadyMessage | SnapshotMessage
