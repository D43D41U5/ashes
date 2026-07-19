/**
 * Le replay log SERVEUR — le journal fidèle d'une session multi (roadmap L1).
 *
 * `recordAndStep` (/sim) ne capte QUE les inputs par tick : il ignore les avatars
 * qui APPARAISSENT et DISPARAISSENT en cours de partie (join/déconnexion). Or c'est
 * l'essence du multi. Ce wrapper ajoute, par tick, le « lifecycle » — les spawns
 * (position) et les despawns (entityId) survenus depuis le tick précédent —, appliqué
 * AVANT le `step`. Rejouer = reconstruire le monde (scénario déterministe), puis, tick
 * par tick, appliquer le lifecycle puis stepper les inputs : on retombe au bit près.
 *
 * PUR — aucune dépendance Colyseus, testé dans `replay-log.test.ts`. C'est l'outil de
 * debug, le banc de charge, et le futur « tribunal » de modération (GDD §11).
 */
import { despawnAvatar, spawnEntity, step, type MoveInput, type SimState } from '@braises/sim'

/** Les naissances/départs d'avatars survenus dans l'intervalle d'un tick. */
export interface Lifecycle {
  /** Avatars nés (leur position de spawn) — l'entityId est ré-attribué à l'identique au replay. */
  joins: { x: number; y: number }[]
  /** Avatars partis (leur entityId). */
  leaves: number[]
}

export interface TickRecord {
  lifecycle: Lifecycle
  inputs: MoveInput[]
}

/** Le journal complet d'une session. Le monde se reconstruit du scénario (seed), pas d'ici. */
export interface ServerReplayLog {
  ticks: TickRecord[]
}

export function createServerReplayLog(): ServerReplayLog {
  return { ticks: [] }
}

/** Un lifecycle vide (aucun join/leave ce tick) — la valeur la plus fréquente. */
export function emptyLifecycle(): Lifecycle {
  return { joins: [], leaves: [] }
}

/**
 * Applique le lifecycle d'un tick À L'ÉTAT, dans l'ordre : les naissances d'abord
 * (elles consomment le PRNG, comme en direct), puis les départs. À appeler EN TÊTE
 * de tick, avant `step` — même contrat que le serveur live (jamais au milieu d'un step).
 */
export function applyLifecycle(state: SimState, lifecycle: Lifecycle): void {
  for (const j of lifecycle.joins) spawnEntity(state, j.x, j.y)
  for (const id of lifecycle.leaves) despawnAvatar(state, id)
}

/** Enregistre un tick (lifecycle + inputs). Le serveur l'appelle après avoir déjà
 *  appliqué le lifecycle EN DIRECT (spawn au join, despawn au leave) : ici on ne fait
 *  que CONSIGNER ce qui s'est passé, pour le rejouer plus tard. */
export function recordTick(log: ServerReplayLog, lifecycle: Lifecycle, inputs: MoveInput[]): void {
  log.ticks.push({ lifecycle, inputs })
}

/**
 * Rejoue le journal. `buildWorld` reconstruit le monde initial exactement comme la
 * partie (scénario déterministe : `() => createZone().sim`) — miroir du `setup` de
 * `runReplay` (/sim). On retombe au bit près sur l'état final de la session.
 */
export function replayServer(log: ServerReplayLog, buildWorld: () => SimState): SimState {
  const state = buildWorld()
  for (const rec of log.ticks) {
    applyLifecycle(state, rec.lifecycle)
    step(state, rec.inputs)
  }
  return state
}
