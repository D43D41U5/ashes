/**
 * L'hôte Worker du mode Veillée (spec client R9).
 *
 * Rôle d'HÔTE uniquement : posséder l'instance de /sim, cadencer les ticks,
 * relayer inputs et snapshots. Aucune logique de jeu ici — elle vit dans
 * /sim, et ce fichier sera remplacé par le serveur en Phase LAN sans que
 * la simulation change.
 */
import {
  BALANCE,
  CHRONICLE_EVENT_TYPES,
  deserializeSim,
  drainEvents,
  getGameTime,
  serializeSim,
  step,
  type MoveInput,
  type PlayerAction,
  type SimEvent,
  type SimState,
  PROTOCOL_VERSION,
  type ClientToHost,
  type HostToClient,
  type NodeDelta,
} from '@braises/sim'
import { createVeillee, LOAD_PHASES } from './veillee'
import { loadSlot, saveSlot } from './persistence-store'

const post = (message: HostToClient): void => {
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage(message)
}

let sim: SimState | undefined
let playerId = 0
/**
 * LE RÉCIT RETENU PAR L'HÔTE (persistance P1-6) : le log borné des faits chronique-dignes,
 * accumulé au fil des ticks pour être SAUVÉ — une Veillée reprise doit retrouver sa
 * chronique. Le client tient sa propre copie d'affichage ; celle-ci n'existe que pour le
 * disque. Borné : la persistance ne grossit pas sans fin sur une longue saison.
 */
let chronicleLog: SimEvent[] = []
const CHRONICLE_CAP = 400
/** Garde anti-double-boot : le chargement du disque est ASYNCHRONE (IndexedDB). */
let booting = false
/** Une écriture disque à la fois — les sérialisations lourdes ne se chevauchent pas. */
let saving = false
/** Une sauvegarde a été demandée pendant qu'une autre était en vol : on la rejoue à la fin,
 *  avec l'état le plus frais. Sans ça, la SORTIE (`pause`) qui tombe pile sur un autosave était
 *  silencieusement perdue — le trou du garde `saving` tombait exactement sur le cas à protéger. */
let pendingPersist = false
/** Cadence de l'autosave de sécurité (ms d'horloge murale, concern d'hôte). */
const AUTOSAVE_MS = 30_000
let autosaveTimer: ReturnType<typeof setInterval> | undefined
let playerInput: Pick<MoveInput, 'dx' | 'dy' | 'sprint' | 'sneak' | 'block'> = { dx: 0, dy: 0 }
/** `seq` du dernier input reçu — l'hôte l'applique chaque tick et l'acquitte dans le snapshot. */
let lastProcessedInput = 0
/** Une action au plus par tick (spec village R1) — la dernière reçue gagne. */
let pendingAction: PlayerAction | undefined
/** Ombre du stock par nœud (dernier envoyé) — état du TRANSPORT, pas du /sim.
 * Permet de ne transmettre que les nœuds dont le stock a changé (deltas),
 * sans cloner les ~60k nœuds à chaque tick. Rempli à l'envoi de la liste
 * complète (ready). */
const nodeStockShadow = new Map<number, number>()

/** Diff local (zéro clone) : nœuds dont le stock a bougé depuis le dernier tick. Un nœud
 *  qui tombe à `stock 0` a pu DÉRIVER (spec recolte-vivante) : on joint alors sa position
 *  (l'épuisement est le seul instant où un nœud se déplace) pour que le client le déménage. */
function collectNodeDeltas(state: SimState): NodeDelta[] {
  const deltas: NodeDelta[] = []
  for (const n of state.nodes) {
    if (nodeStockShadow.get(n.id) !== n.stock) {
      nodeStockShadow.set(n.id, n.stock)
      deltas.push(
        n.stock === 0
          ? { id: n.id, stock: 0, tx: n.tx, ty: n.ty, regrowAt: n.regrowAt }
          : { id: n.id, stock: n.stock },
      )
    }
  }
  return deltas
}

function tick(): void {
  if (!sim) return
  const inputs: MoveInput[] = [
    { entityId: playerId, ...playerInput, ...(pendingAction ? { action: pendingAction } : {}) },
  ]
  pendingAction = undefined
  step(sim, inputs)
  const events = drainEvents(sim)
  // On RETIENT au passage les faits chronique-dignes, pour la sauvegarde : c'est ici
  // qu'ils transitent, une seule fois. Le client, lui, les reçoit dans le snapshot et
  // tient sa propre copie d'affichage — les deux filtrent sur la MÊME liste (/sim).
  for (const e of events) if (CHRONICLE_EVENT_TYPES.has(e.type)) chronicleLog.push(e)
  if (chronicleLog.length > CHRONICLE_CAP) chronicleLog.splice(0, chronicleLog.length - CHRONICLE_CAP)
  post({
    type: 'snapshot',
    tick: sim.tick,
    lastProcessedInput,
    time: getGameTime(sim),
    entities: sim.entities,
    structures: sim.structures,
    villages: sim.villages,
    functions: sim.functions,
    nodeDeltas: collectNodeDeltas(sim),
    npcs: sim.npcs,
    monsters: sim.monsters,
    corpses: sim.corpses,
    refugeeGroups: sim.refugeeGroups,
    // LE SANG, LE VENT, LES PILES (spec chasse C9/C17/C18). Trois listes bornées
    // (BLOOD_CAP, un vecteur, des piles qui périssent) : le snapshot ne grossit pas.
    blood: sim.blood,
    wind: sim.wind,
    groundItems: sim.groundItems,
    events,
  })
}

/**
 * ÉCRIT la Veillée sur le disque (autosave + sortie). Sérialiser tout l'état (dont ~60k
 * nœuds) est lourd : on n'en lance jamais deux à la fois (`saving`), et jamais avant que le
 * monde existe. C'est une opération d'HÔTE — horloge murale comprise (interdite à /sim).
 */
async function persist(): Promise<void> {
  if (!sim) return
  // Une écriture est déjà en vol : on ne la double pas, mais on RETIENT la demande — sinon un
  // `pause` (la vraie prise de sortie) qui coïncide avec un autosave serait perdu, alors même
  // que le joueur a quitté proprement. On rejouera avec l'état frais dès la fin de l'écriture.
  if (saving) {
    pendingPersist = true
    return
  }
  saving = true
  try {
    await saveSlot({ sim: serializeSim(sim), playerId, chronicle: chronicleLog, savedAt: Date.now() })
  } catch {
    // Un disque plein ou refusé ne doit pas tuer la partie : on perd la sauvegarde, pas la
    // session. (Le prochain autosave retentera.)
  } finally {
    saving = false
    // Une demande est tombée pendant l'écriture (typiquement la sortie) : on la rejoue MAINTENANT
    // avec l'état le plus récent. Tant que l'onglet vit, la sortie est ainsi sauvée sans attendre
    // les 30 s de l'autosave. (Sur une vraie fermeture d'onglet, IndexedDB reste best-effort.)
    if (pendingPersist) {
      pendingPersist = false
      void persist()
    }
  }
}

/**
 * NAÎTRE OU REPRENDRE (persistance P1-6). On tente d'abord de RELIRE la Veillée sauvée : si
 * une case existe et se relit, on reprend CE monde (la reprise est la promesse de GATE 1 —
 * « le même monde, 5 sessions »). Sinon — première partie, ou sauvegarde d'une version
 * incompatible/corrompue — on en GÉNÈRE une neuve. Une sauvegarde illisible ne bloque
 * jamais : on repart à neuf plutôt que d'échouer au seuil.
 *
 * Le scénario appartient à l'hôte (veillee.ts) : le client ne choisit rien. Chaque passe de
 * génération est annoncée au fil de l'eau (barre de chargement) ; une reprise, elle, est
 * quasi instantanée — on annonce alors une barre pleine d'un coup.
 */
async function boot(): Promise<void> {
  let spawn: { x: number; y: number } | undefined
  let resumed = false
  try {
    const rec = await loadSlot()
    if (rec) {
      const state = deserializeSim(rec.sim) // JETTE si version incompatible → on tombe dans le catch
      sim = state
      playerId = rec.playerId
      chronicleLog = rec.chronicle ?? []
      const me = state.entities.find((e) => e.id === playerId)
      if (me) spawn = { x: me.x, y: me.y }
      resumed = true
    }
  } catch {
    // Sauvegarde absente, illisible ou d'une version incompatible : on repart à neuf.
    sim = undefined
    resumed = false
  }

  if (!sim) {
    const world = createVeillee((phase) => {
      post({ type: 'progress', phase, done: LOAD_PHASES.indexOf(phase), total: LOAD_PHASES.length })
    })
    sim = world.sim
    playerId = world.playerId
    spawn = world.spawn
    chronicleLog = []
  } else if (resumed) {
    // Reprise : aucune passe de génération n'a tourné — on remplit la barre d'un coup pour
    // que le seuil de chargement se lève (il attend `worldReady`, posé au `ready`).
    post({ type: 'progress', phase: LOAD_PHASES[LOAD_PHASES.length - 1]!, done: LOAD_PHASES.length, total: LOAD_PHASES.length })
  }

  // Liste complète des nœuds envoyée UNE fois ; on amorce l'ombre pour que le premier tick
  // n'émette pas 60k deltas redondants.
  for (const n of sim.nodes) nodeStockShadow.set(n.id, n.stock)
  post({
    type: 'ready',
    protocolVersion: PROTOCOL_VERSION,
    playerId,
    map: sim.map,
    seed: sim.seed,
    nodes: sim.nodes,
    grounds: sim.grounds,
    // L'échelle du MONDE, pas la constante : à la reprise d'une sauvegarde faite avec un autre
    // `VEILLEE_SEASON_CYCLES`, la sim garde son échelle figée — le client doit recevoir CELLE-LÀ
    // (sinon la chronique daterait ses lignes avec la mauvaise échelle). Neuf = les deux égales.
    calendarScale: sim.calendarScale,
    // Le spawn EST la position de l'avatar : à la reprise, on relit celle du /sim sauvé
    // (là où l'on s'est arrêté), pas le point de fondation. Repli sur (0,0)-évité : un
    // monde neuf a toujours son `world.spawn` ; une reprise a toujours son entité.
    playerSpawn: spawn ?? { x: sim.map.width / 2, y: sim.map.height / 2 },
    // La chronique n'accompagne QUE la reprise (sur un monde neuf, le récit démarre vide).
    ...(resumed ? { chronicle: chronicleLog } : {}),
  })
  booting = false
  // L'autosave de sécurité tourne dès qu'un monde existe (la sortie, elle, sauve sur `pause`).
  if (autosaveTimer === undefined) autosaveTimer = setInterval(() => void persist(), AUTOSAVE_MS)
  // ON NE TIQUE PAS ENCORE : le client a ~3 s de montage (bake terrain, maillages, décor).
  // Tiquer maintenant ferait vivre le monde sans témoin, et ses snapshots — porteurs de flux
  // À USAGE UNIQUE (`drainEvents`, `collectNodeDeltas`) — tomberaient dans le vide. Le client
  // dit `resume` quand il est debout. (Un serveur LAN ignorera ce silence : son monde n'attend
  // personne, et le client jette de toute façon les snapshots reçus avant d'être monté.)
}

/** Handle de la boucle de tick — pause/reprise (et garde anti-double-init). */
let ticker: ReturnType<typeof setInterval> | undefined
/** DEV : accélération de la CADENCE (le tick reste fixe — on en joue plus par seconde). */
let speedFactor = 1

function startTicker(): void {
  if (ticker === undefined) ticker = setInterval(tick, 1000 / (BALANCE.TICK_RATE_HZ * speedFactor))
}

function stopTicker(): void {
  if (ticker !== undefined) {
    clearInterval(ticker)
    ticker = undefined
  }
}

self.addEventListener('message', (event: MessageEvent<ClientToHost>) => {
  const msg = event.data
  if (msg.type === 'join') {
    if (sim || booting) return // déjà en jeu (ou en cours de boot async) : pas de second monde
    booting = true
    void boot()
  } else if (msg.type === 'input') {
    playerInput = { dx: msg.dx, dy: msg.dy, sprint: msg.sprint, sneak: msg.sneak, block: msg.block }
    lastProcessedInput = msg.seq
  } else if (msg.type === 'action') {
    pendingAction = msg.action
  } else if (msg.type === 'chat') {
    // SOLO : personne d'autre à portée. L'émetteur voit son propre message par ÉCHO
    // LOCAL (WorldScene, à l'envoi) — le worker n'a donc rien à renvoyer.
  } else if (msg.type === 'pause') {
    stopTicker()
    // LA SORTIE (onglet caché) est LE moment de sauver : c'est là qu'on quitte, et le
    // navigateur peut ne plus jamais nous rendre la main. L'autosave périodique n'est que
    // le filet ; ceci est la vraie prise.
    void persist()
  } else if (msg.type === 'resume') {
    if (sim) startTicker()
  } else if (msg.type === 'debug_speed') {
    // Hors dev, la sim n'est pas armée en debug : accélérer la cadence resterait
    // sans effet de triche, mais on refuse quand même — l'hôte de prod n'a pas
    // à obéir à un client sur son horloge.
    if (!import.meta.env.DEV) return
    speedFactor = Math.min(16, Math.max(1, msg.factor))
    if (ticker !== undefined) {
      stopTicker() // relancer l'intervalle : c'est sa PÉRIODE qui change
      startTicker()
    }
  }
})
