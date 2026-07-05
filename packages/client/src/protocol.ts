/**
 * Protocole client ⇄ hôte de simulation (spec client R1-R3).
 *
 * L'hôte est aujourd'hui un Web Worker (mode Veillée) et demain un serveur
 * (Phase LAN) : ces messages sont la répétition générale du réseau. On ne
 * transmet jamais de position côté client, seulement des intentions.
 */
import type { Entity, GameTime, SimEvent, WorldMap } from '@braises/sim'

export interface InitMessage {
  type: 'init'
  seed: number
  map: WorldMap
  calendarScale: number
  playerSpawn: { x: number; y: number }
}

export interface InputMessage {
  type: 'input'
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
}

export type ClientToHost = InitMessage | InputMessage

export interface ReadyMessage {
  type: 'ready'
  playerId: number
}

export interface SnapshotMessage {
  type: 'snapshot'
  tick: number
  time: GameTime
  entities: Entity[]
  events: SimEvent[]
}

export type HostToClient = ReadyMessage | SnapshotMessage
