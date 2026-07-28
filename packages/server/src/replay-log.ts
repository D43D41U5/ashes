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
 * ── POURQUOI CE JOURNAL EST BORNÉ ────────────────────────────────────────────────
 *
 * Il ne l'était pas : `recordTick` poussait un `TickRecord` par tick, sans fin, dans un
 * tableau vivant en mémoire. Le commentaire d'origine s'en remettait à la durée de
 * session — sauf que `zone-room.ts` met `autoDispose = false` et que `index.ts` crée la
 * zone DÈS le démarrage : le tick tourne à 20 Hz même quand PERSONNE n'est connecté, et
 * la session, c'est la vie du processus.
 *
 * MESURÉ (bancs de session) : 186 octets/tick serveur VIDE, 4 460 octets/tick à
 * 50 joueurs — soit ~321 Mo par jour à vide et ~321 Mo par HEURE en charge. L'OOM a été
 * reproduit, et bien AVANT lui la dégradation : des pauses GC Mark-Compact de 178 puis
 * 728 ms, contre un budget de tick de 50 ms. Le serveur bégaye des minutes avant de
 * mourir. C'est la définition d'une fuite mémoire.
 *
 * On BORNE donc le journal à une fenêtre glissante (`REPLAY_TICKS`), et — c'est le point
 * qui compte — on refuse de MENTIR : le nombre de ticks tombés est compté (`dropped`), et
 * `replayServer` REFUSE de rejouer un journal tronqué plutôt que de rendre un monde qui
 * ressemble à la partie sans en être. Un journal partiel reste consultable (la queue :
 * « qu'a fait ce joueur »), il n'est simplement plus un témoignage reconstituable.
 *
 * La TAILLE de la fenêtre est un arbitrage mémoire ↔ profondeur d'enquête, réglable par
 * `BRAISES_REPLAY_TICKS` (0 = journal désactivé, empreinte nulle).
 *
 * PUR — aucune dépendance Colyseus, testé dans `replay-log.test.ts`. C'est l'outil de
 * debug, le banc de charge, et le futur « tribunal » de modération (GDD §11).
 */
import { despawnAvatar, spawnEntity, step, type MoveInput, type SimState } from '@ashes/sim'

/**
 * La profondeur du journal, en ticks. 12 000 = 10 minutes à 20 Hz : assez pour tenir la
 * queue d'un incident, et borné à ~53 Mo dans le pire cas mesuré (50 joueurs à
 * 4 460 o/tick), ~2 Mo sur une zone au repos. Réglable par `BRAISES_REPLAY_TICKS` ;
 * `0` désactive l'enregistrement (le journal reste vide, empreinte nulle).
 */
export const REPLAY_TICKS = Math.max(0, Number(process.env.BRAISES_REPLAY_TICKS ?? 12_000) || 0)

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

/** Le journal d'une session, BORNÉ. Le monde se reconstruit du scénario (seed), pas d'ici. */
export interface ServerReplayLog {
  /** La fenêtre retenue, du plus ancien au plus récent. Jamais plus de `capacity` entrées. */
  ticks: TickRecord[]
  /** Combien de ticks la fenêtre a laissé tomber. `> 0` ⇒ le journal n'est plus rejouable. */
  dropped: number
  /** La profondeur de la fenêtre. `0` : on n'enregistre rien du tout. */
  capacity: number
}

export function createServerReplayLog(capacity: number = REPLAY_TICKS): ServerReplayLog {
  return { ticks: [], dropped: 0, capacity: Math.max(0, Math.floor(capacity)) }
}

/** Un lifecycle vide (aucun join/leave ce tick) — la valeur la plus fréquente. */
export function emptyLifecycle(): Lifecycle {
  return { joins: [], leaves: [] }
}

/** Ce lifecycle a-t-il quoi que ce soit à dire ? (Un tick sur mille, en pratique.) */
export function lifecycleIsEmpty(l: Lifecycle): boolean {
  return l.joins.length === 0 && l.leaves.length === 0
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

/**
 * Enregistre un tick (lifecycle + inputs). Le serveur l'appelle après avoir déjà appliqué
 * le lifecycle EN DIRECT (spawn au join, despawn au leave) : ici on ne fait que CONSIGNER.
 *
 * La fenêtre glisse : au-delà de `capacity`, le plus ancien tick tombe et `dropped`
 * l'inscrit. Un simple tableau plutôt qu'un anneau à index, pour que le journal reste
 * JSON-sérialisable et lisible tel quel par ce qui le consomme — le `shift()` que ça coûte
 * a été MESURÉ à pleine fenêtre (12 000 entrées) : **55,5 µs par tick, soit 0,11 % d'un
 * budget de 50 ms**. Le prix de la lisibilité est payé, et il est connu.
 */
export function recordTick(log: ServerReplayLog, lifecycle: Lifecycle, inputs: MoveInput[]): void {
  if (log.capacity === 0) {
    log.dropped += 1
    return
  }
  log.ticks.push({ lifecycle, inputs })
  while (log.ticks.length > log.capacity) {
    log.ticks.shift()
    log.dropped += 1
  }
}

/**
 * Rejoue le journal. `buildWorld` reconstruit le monde initial exactement comme la
 * partie (scénario déterministe : `() => createZone().sim`) — miroir du `setup` de
 * `runReplay` (/sim). On retombe au bit près sur l'état final de la session.
 *
 * REFUSE un journal tronqué : sans ses premiers ticks, le monde rejoué serait un
 * inconnu qui ressemble à la partie. Mieux vaut une erreur franche qu'un faux témoin.
 */
export function replayServer(log: ServerReplayLog, buildWorld: () => SimState): SimState {
  if (log.dropped > 0) {
    throw new Error(
      `replayServer : journal tronqué (${log.dropped} ticks tombés, fenêtre de ${log.capacity}) — ` +
        `le monde ne peut pas être reconstruit depuis la graine. Élargir BRAISES_REPLAY_TICKS pour enquêter plus loin.`,
    )
  }
  const state = buildWorld()
  for (const rec of log.ticks) {
    applyLifecycle(state, rec.lifecycle)
    step(state, rec.inputs)
  }
  return state
}
