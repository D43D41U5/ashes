/**
 * La room Colyseus d'une zone LAN — le TRANSPORT autour de `/sim`, rien de plus.
 *
 * Elle est le jumeau réseau de `client/src/worker/sim-worker.ts` : posséder une
 * instance de /sim, la cadencer au tick fixe, relayer inputs et snapshots. Aucune
 * logique de jeu ici (elle vit dans /sim), et — décision d'architecture L1 — on
 * n'utilise PAS `@colyseus/schema` : on transporte nos messages `protocol.ts` tels
 * quels (`client.send(type, payload)` / `onMessage('*')`). SimState reste ainsi la
 * seule et même source, JSON-sérialisable, jamais remodelée en Schema.
 */
import {
  BALANCE,
  despawnAvatar,
  PROTOCOL_VERSION,
  spawnEntity,
  step,
  type ReadyMessage,
} from '@braises/sim'
import { Room, type Client as ColyseusClient } from '@colyseus/core'
import { LAN_SEED, MAX_PLAYERS, nextSpawnNear, SERVER_NAME, type LanWorld } from './scenario'
import { getZone } from './zone-singleton'
import {
  acceptInput,
  buildSnapshotBase,
  collectNodeDeltas,
  gatherInputs,
  newClientState,
  type ClientState,
} from './tick-driver'
import { isJoinMessage, sanitizeAction, sanitizeChat, sanitizeInput } from './validate'
import {
  createServerReplayLog,
  emptyLifecycle,
  recordTick,
  type Lifecycle,
  type ServerReplayLog,
} from './replay-log'

export class ZoneRoom extends Room {
  override maxClients = MAX_PLAYERS

  private world!: LanWorld
  /** L'état serveur par client, indexé par `sessionId` Colyseus. */
  private readonly states = new Map<string, ClientState>()
  /** Ombre des stocks de nœuds (état du TRANSPORT) — n'envoie que les deltas. */
  private readonly nodeShadow = new Map<number, number>()
  /** Combien de joueurs ont rejoint — sert d'index de spawn (anneau déterministe). */
  private joinCount = 0
  /** Journal fidèle de la session (inputs + lifecycle par tick) — rejouable au bit près.
   *  En mémoire : L1 est éphémère (pas de PostgreSQL) ; borné par la durée de session. */
  private readonly replayLog: ServerReplayLog = createServerReplayLog()
  /** Spawns/départs survenus DEPUIS le dernier tick — consignés puis remis à zéro à chaque tick. */
  private pendingLifecycle: Lifecycle = emptyLifecycle()
  /**
   * Chats dits depuis le dernier tick, avec la POSITION de l'émetteur — diffusés à TOUS les
   * clients au tick suivant sur le canal `chatmsg`, puis vidés. Le filtrage par proximité est
   * fait CÔTÉ CLIENT (chacun compare sa position à celle de l'émetteur), et l'émetteur ignore
   * son propre écho (il l'affiche en local). Le chat ne touche pas /sim — couche de transport.
   */
  private pendingChats: { from: number; x: number; y: number; text: string }[] = []

  override onCreate(): void {
    // La zone survit à un instant sans joueur (session dev) au lieu de se
    // réinitialiser dès qu'elle se vide.
    this.autoDispose = false
    // MÉTADONNÉES lues par l'écran principal du client (nom + seed du monde) : le
    // serveur est la source de vérité, le menu les AFFICHE (via `getAvailableRooms`).
    void this.setMetadata({ name: SERVER_NAME, seed: LAN_SEED })
    // Récupère le monde PRÉ-BÂTI (voir zone-singleton) : instantané, la boucle
    // d'événements n'est jamais gelée pendant le matchmaking.
    this.world = getZone()
    // Amorce l'ombre : le premier tick n'émet pas 60k deltas redondants.
    for (const n of this.world.sim.nodes) this.nodeShadow.set(n.id, n.stock)
    this.onMessage('*', (client, _type, message) => this.onClientMessage(client, message))
    // Un `step` par fire, exactement comme le worker : le déterminisme porte sur le
    // NUMÉRO de tick, pas sur l'horloge murale — l'instant du fire n'a aucune incidence.
    this.setSimulationInterval(() => this.tick(), 1000 / BALANCE.TICK_RATE_HZ)
  }

  override onJoin(): void {
    // Rien à la connexion Colyseus elle-même : on attend le message protocole `join`
    // (voir `isJoinMessage`) pour spawner et répondre `ready`, comme le worker solo.
  }

  override onLeave(client: ColyseusClient): void {
    // Départ CONSENTI comme rupture de socket : Colyseus appelle `onLeave` dans les
    // deux cas. L'avatar s'en va pour de bon (miroir de la mort d'un PNJ).
    const state = this.states.get(client.sessionId)
    if (!state) return
    despawnAvatar(this.world.sim, state.entityId)
    this.states.delete(client.sessionId)
    this.pendingLifecycle.leaves.push(state.entityId) // consigné pour le replay
  }

  /**
   * Le join PROTOCOLE (pas la connexion Colyseus) : spawn l'avatar entre deux ticks
   * (JS mono-thread : jamais au milieu d'un `step`) et renvoie l'état de MONDE. Le
   * monde tourne déjà — on envoie l'état COURANT (nœuds au stock à jour).
   */
  private handleJoin(client: ColyseusClient): void {
    if (this.states.has(client.sessionId)) return // `join` en double : on ignore
    const spawn = nextSpawnNear(this.world.sim.map, this.world.base, this.joinCount)
    this.joinCount += 1
    const entityId = spawnEntity(this.world.sim, spawn.x, spawn.y)
    this.states.set(client.sessionId, newClientState(entityId))
    // Consigné pour le replay : ce spawn sera rejoué (même position → même entityId).
    this.pendingLifecycle.joins.push({ x: spawn.x, y: spawn.y })

    const ready: ReadyMessage = {
      type: 'ready',
      protocolVersion: PROTOCOL_VERSION,
      playerId: entityId,
      map: this.world.sim.map,
      seed: this.world.sim.seed,
      nodes: this.world.sim.nodes,
      grounds: this.world.sim.grounds,
      calendarScale: this.world.sim.calendarScale,
      playerSpawn: spawn,
    }
    client.send('ready', ready)
  }

  private onClientMessage(client: ColyseusClient, message: unknown): void {
    if (isJoinMessage(message)) {
      this.handleJoin(client)
      return
    }
    const state = this.states.get(client.sessionId)
    if (!state) return
    const input = sanitizeInput(message, state.ack)
    if (input) {
      acceptInput(state, input)
      return
    }
    const action = sanitizeAction(message)
    if (action) {
      // Une action au plus par tick (spec village R1) — la dernière reçue gagne.
      state.pendingAction = action
      return
    }
    const chatText = sanitizeChat(message)
    if (chatText) {
      this.relayChat(state.entityId, chatText)
      return
    }
    // `pause`/`resume`/`debug_speed` et tout message inconnu : ignorés. Le monde des
    // autres ne s'arrête pas, et l'hôte de prod n'obéit pas à un client sur son horloge.
  }

  /**
   * LE CHAT DE PROXIMITÉ : on retient le message avec la POSITION de l'émetteur (lue sur /sim,
   * sans muter l'état déterministe). Il part au tick suivant sur le canal `chatmsg` ; le FILTRAGE
   * par distance se fait CÔTÉ CLIENT (voir `ChatBroadcast`). C'est une couche de transport, pas
   * de simulation — le chat ne passe jamais par /sim.
   */
  private relayChat(fromEntityId: number, text: string): void {
    const speaker = this.world.sim.entities.find((e) => e.id === fromEntityId)
    if (!speaker) return
    this.pendingChats.push({ from: fromEntityId, x: speaker.x, y: speaker.y, text })
  }

  private tick(): void {
    const inputs = gatherInputs(this.states.values())
    // JOURNAL : le lifecycle (déjà appliqué EN DIRECT à l'arrivée/au départ) et les
    // inputs de CE tick, avant le step — rejouer applique le lifecycle puis steppe,
    // et retombe au bit près. On remet le lifecycle en attente à zéro.
    recordTick(this.replayLog, this.pendingLifecycle, inputs)
    this.pendingLifecycle = emptyLifecycle()
    step(this.world.sim, inputs)

    // Corps COMMUN du snapshot ; seul `lastProcessedInput` diffère par destinataire.
    const base = buildSnapshotBase(this.world.sim, collectNodeDeltas(this.world.sim, this.nodeShadow))
    for (const [sessionId, state] of this.states) {
      // Seuls les clients ayant fait leur `join` protocole ont un état (et un avatar) :
      // les autres, connectés mais pas encore annoncés, ne reçoivent pas de snapshot.
      const client = this.clients.getById(sessionId)
      if (client) client.send('snapshot', { ...base, lastProcessedInput: state.ack })
    }

    // LE CHAT : diffusé à TOUS les joueurs sur son propre canal `chatmsg`, en TABLEAU
    // `[from, x, y, text]` (voir `ChatBroadcast`). Le client FILTRE par proximité et
    // l'émetteur ignore son propre écho (`msg.from === playerId`).
    for (const c of this.pendingChats) {
      const cx = Math.floor(c.x)
      const cy = Math.floor(c.y)
      for (const [sessionId] of this.states) this.clients.getById(sessionId)?.send('chatmsg', [c.from, cx, cy, c.text])
    }
    this.pendingChats = []
  }
}
