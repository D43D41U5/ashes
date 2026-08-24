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
  createNodeShadow,
  despawnAvatar,
  filtreParInteret,
  PROTOCOL_VERSION,
  seedNodeShadow,
  spawnEntity,
  step,
  type NodeShadow,
  type ReadyMessage,
} from '@ashes/sim'
import { Room, type Client as ColyseusClient, type RoomException } from '@colyseus/core'
import { baseDeNaissance, LAN_SEED, MAX_PLAYERS, nextSpawnNear, SERVER_NAME, type LanWorld } from './scenario'
import { claimZone, releaseZone } from './zone-singleton'
import {
  acceptInput,
  buildSnapshotBase,
  collectNodeDeltas,
  gatherInputs,
  newClientState,
  refillChatTokens,
  spendChatToken,
  type ClientState,
} from './tick-driver'
import { actionEnvelopeType, isJoinMessage, sanitizeAction, sanitizeChat, sanitizeInput } from './validate'
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
  /** Ombre des stocks de nœuds (état du TRANSPORT) — n'envoie que les deltas.
   *  Tableau typé indexé par `id`, partagé avec le worker Veillée (voir `/sim/node-shadow.ts`). */
  private nodeShadow!: NodeShadow
  /** Combien de joueurs ont rejoint — sert d'index de spawn (anneau déterministe). */
  private joinCount = 0
  /** Journal fidèle de la session (inputs + lifecycle par tick), sur une FENÊTRE GLISSANTE
   *  bornée — un journal sans fin était une fuite mémoire mesurée (voir `replay-log.ts`). */
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
  /** La simulation est-elle condamnée (un `step` a levé) ? Le tick devient alors un no-op. */
  private condamnee = false
  /** Actions refusées SUR LA FORME depuis le dernier compte rendu — voir `tick`. */
  private refusDeForme = new Map<string, number>()

  override onCreate(): void {
    // La zone survit à un instant sans joueur (session dev) au lieu de se
    // réinitialiser dès qu'elle se vide.
    this.autoDispose = false
    // MÉTADONNÉES lues par l'écran principal du client (nom + seed du monde) : le
    // serveur est la source de vérité, le menu les AFFICHE (via `getAvailableRooms`).
    void this.setMetadata({ name: SERVER_NAME, seed: LAN_SEED })
    // RÉCLAME le monde pré-bâti (voir zone-singleton) : instantané, la boucle d'événements
    // n'est jamais gelée pendant le matchmaking. Lève si une autre room le simule déjà —
    // deux `setSimulationInterval` sur un même `SimState` feraient avancer la vallée à 40 Hz.
    this.world = claimZone(this)
    // Amorce l'ombre : le premier tick n'émet pas 125k deltas redondants.
    this.nodeShadow = createNodeShadow(this.world.sim.nodes)
    seedNodeShadow(this.nodeShadow, this.world.sim.nodes)
    this.onMessage('*', (client, _type, message) => this.onClientMessage(client, message))
    // Un `step` par fire, exactement comme le worker : le déterminisme porte sur le
    // NUMÉRO de tick, pas sur l'horloge murale — l'instant du fire n'a aucune incidence.
    this.setSimulationInterval(() => this.tick(), 1000 / BALANCE.TICK_RATE_HZ)
  }

  override onDispose(): void {
    // Le monde survit à la room (le tick reprendra où il en était) mais il redevient
    // libre : sans ça, une room recréée après un incident se heurterait à son propre fantôme.
    releaseZone(this)
  }

  override onJoin(): void {
    // Rien à la connexion Colyseus elle-même : on attend le message protocole `join`
    // (voir `isJoinMessage`) pour spawner et répondre `ready`, comme le worker solo.
  }

  /**
   * LA FRONTIÈRE D'ERREUR — sans elle, une exception coûtait le SERVEUR ENTIER.
   *
   * Colyseus n'enveloppe `setSimulationInterval` et `onMessage` dans un try/catch QUE si
   * la room définit ce hook (`Room.js` : `if (this.onUncaughtException !== undefined)`).
   * Sans lui, l'exception remontait au `process`, où le `registerGracefulShutdown` posé
   * par `new Server()` l'attrapait et éteignait TOUT — la zone, le matchmaking, les
   * cinquante joueurs. Un message malformé suffisait (MESURÉ : `{type:'attack',
   * dx:{toString:'nope'}}` levait « Cannot convert object to primitive value » dans le
   * tick). `validate.ts` ferme désormais ce chemin-là ; ce hook est pour le PROCHAIN,
   * celui qu'on n'a pas vu.
   *
   * On ne réagit pas pareil selon l'origine, parce que l'état n'est pas dans le même
   * danger :
   *
   *   • `setSimulationInterval` — l'exception a coupé un `step` EN DEUX. L'état est
   *     peut-être à moitié avancé ; continuer produirait un monde qui ne correspond plus
   *     à son propre journal de replay, et le replay est la seule chose qui nous dise
   *     un jour ce qui s'est passé. On arrête donc la ZONE (et elle seule) : les joueurs
   *     sont déconnectés proprement, le processus survit, la trace reste.
   *   • tout le reste (`onMessage` en tête) — rien n'a touché /sim, ou alors de façon
   *     contenue. On journalise et le monde continue de tourner : un client qui plante
   *     son propre message ne fait pas s'arrêter la vallée des autres.
   *
   * ATTENTION AU `rethrow` DE COLYSEUS (`Utils.js:117`, 5ᵉ paramètre de `wrapTryCatch`) : il
   * vaut `true` pour `onCreate` — le refus délibéré de `claimZone` remonte donc bien et fait
   * échouer la création de room, comme voulu — mais `false` pour `setSimulationInterval` :
   * l'exception y est AVALÉE et **l'intervalle continue de tirer toutes les 50 ms**. Sans le
   * drapeau `condamnee` ci-dessous, le tick serait reparti sur un état à moitié avancé
   * pendant que `disconnect()` (asynchrone) était encore en vol.
   */
  override onUncaughtException(err: RoomException<this>, methodName: string): void {
    if (methodName === 'onCreate') {
      // Pas un accident : c'est `claimZone` qui refuse une seconde simulation du même monde.
      // Colyseus relance derrière nous, la création de room échoue, le joueur est refusé.
      console.warn('[braises/server] création de zone refusée :', (err as Error).message)
      return
    }
    console.error(`[braises/server] exception non rattrapée dans ${methodName} :`, err)
    if (methodName === 'setSimulationInterval') {
      console.error('[braises/server] la simulation est suspecte (step interrompu) — on ferme la zone plutôt que de rejouer faux.')
      this.condamnee = true
      this.setSimulationInterval(undefined) // on désarme TOUT DE SUITE : `disconnect` est asynchrone
      void this.disconnect()
    }
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
    // R30 — le centre de l'anneau de naissance SUIT LE FRONT DE CENDRE : sur un serveur qui
    // tourne des semaines, celui qui rejoint au jour 31 ne doit pas naître dans ce qui a brûlé
    // au jour 30. Tant que rien ne brûle, c'est exactement la base d'origine (voir `baseDeNaissance`).
    const spawn = nextSpawnNear(this.world.sim.map, baseDeNaissance(this.world), this.joinCount)
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
      jourDeDepart: this.world.sim.jourDeDepart,
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
    // Une action REFUSÉE SUR LA FORME ne repart pas en `action_rejected` (elle n'a jamais
    // atteint /sim) : on la compte ici, sinon un bug de notre propre client disparaîtrait
    // sans laisser de trace. Le compte rendu est périodique et agrégé (voir `tick`) : un
    // client hostile ne peut pas s'en servir pour noyer les journaux.
    const pretendu = actionEnvelopeType(message)
    if (pretendu !== null) {
      this.refusDeForme.set(pretendu, (this.refusDeForme.get(pretendu) ?? 0) + 1)
      return
    }
    const chatText = sanitizeChat(message)
    if (chatText) {
      // Le seau de jetons AVANT le relais : un client qui déborde se fait jeter ici,
      // avant tout coût (recherche de l'émetteur, mémoire, amplification ×50).
      if (spendChatToken(state)) this.relayChat(state.entityId, chatText)
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

  /** COMPTE RENDU des refus de forme, agrégé, au plus une fois toutes les 100 ticks (5 s).
   *  Agrégé et périodique exprès : un flot de messages malformés ne doit pas coûter une
   *  ligne de journal chacun — ce serait remplacer un déni de service par un autre. */
  private rapporterLesRefus(tick: number): void {
    if (tick % 100 !== 0 || this.refusDeForme.size === 0) return
    const detail = [...this.refusDeForme].map(([t, n]) => `${t}×${n}`).join(' ')
    console.warn(`[braises/server] actions refusées sur la forme (5 s) : ${detail}`)
    this.refusDeForme.clear()
  }

  private tick(): void {
    if (this.condamnee) return // un `step` a levé : on ne rejoue pas sur un état suspect
    this.rapporterLesRefus(this.world.sim.tick)
    refillChatTokens(this.states.values(), this.world.sim.tick)
    const inputs = gatherInputs(this.states.values())
    // JOURNAL : le lifecycle (déjà appliqué EN DIRECT à l'arrivée/au départ) et les
    // inputs de CE tick, avant le step — rejouer applique le lifecycle puis steppe,
    // et retombe au bit près. On remet le lifecycle en attente à zéro.
    recordTick(this.replayLog, this.pendingLifecycle, inputs)
    this.pendingLifecycle = emptyLifecycle()
    step(this.world.sim, inputs)

    // Corps COMMUN du snapshot ; seul `lastProcessedInput` diffère par destinataire.
    const base = buildSnapshotBase(this.world.sim, collectNodeDeltas(this.world.sim.nodes, this.nodeShadow))
    for (const [sessionId, state] of this.states) {
      // Seuls les clients ayant fait leur `join` protocole ont un état (et un avatar) :
      // les autres, connectés mais pas encore annoncés, ne reçoivent pas de snapshot.
      const client = this.clients.getById(sessionId)
      if (!client) continue
      // LA ZONE D'INTÉRÊT : chacun ne reçoit que ce qui l'entoure. Le corps commun reste
      // partagé quand rien n'est rogné — on ne paie une copie que pour ce qui sort du rayon.
      const moi = this.world.sim.entities.find((e) => e.id === state.entityId)
      const vu = moi ? filtreParInteret(base, moi) : base
      client.send('snapshot', { ...vu, lastProcessedInput: state.ack })
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
