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
  drainEvents,
  getGameTime,
  step,
  type MoveInput,
  type PlayerAction,
  type SimState,
  PROTOCOL_VERSION,
  type ClientToHost,
  type HostToClient,
  type NodeDelta,
} from '@braises/sim'
import { createVeillee, LOAD_PHASES, VEILLEE_CALENDAR_SCALE } from './veillee'

const post = (message: HostToClient): void => {
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage(message)
}

let sim: SimState | undefined
let playerId = 0
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

/** Diff local (zéro clone) : nœuds dont le stock a bougé depuis le dernier tick. */
function collectNodeDeltas(state: SimState): NodeDelta[] {
  const deltas: NodeDelta[] = []
  for (const n of state.nodes) {
    if (nodeStockShadow.get(n.id) !== n.stock) {
      nodeStockShadow.set(n.id, n.stock)
      deltas.push({ id: n.id, stock: n.stock })
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
    // LE SANG, LE VENT, LES PILES (spec chasse C9/C17/C18). Trois listes bornées
    // (BLOOD_CAP, un vecteur, des piles qui périssent) : le snapshot ne grossit pas.
    blood: sim.blood,
    wind: sim.wind,
    groundItems: sim.groundItems,
    events: drainEvents(sim),
  })
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
    if (sim) return // déjà en jeu : un second join empilerait une seconde boucle
    // Le scénario appartient à l'hôte (veillee.ts) : le client ne choisit rien.
    // Chaque passe est annoncée AU FIL de la génération : le worker calcule sans
    // relâche, mais ses `postMessage` sont livrés au fil de l'eau au thread
    // principal — qui, lui, est libre de peindre sa barre. C'est tout l'intérêt de
    // générer dans un Worker : l'attente n'est pas un écran figé.
    const world = createVeillee((phase) => {
      post({ type: 'progress', phase, done: LOAD_PHASES.indexOf(phase), total: LOAD_PHASES.length })
    })
    sim = world.sim
    playerId = world.playerId
    // Liste complète des nœuds envoyée UNE fois ; on amorce l'ombre pour que le
    // premier tick n'émette pas 60k deltas redondants.
    for (const n of sim.nodes) nodeStockShadow.set(n.id, n.stock)
    post({
      type: 'ready',
      protocolVersion: PROTOCOL_VERSION,
      playerId,
      map: sim.map,
      seed: sim.seed,
      nodes: sim.nodes,
      grounds: sim.grounds,
      calendarScale: VEILLEE_CALENDAR_SCALE,
      playerSpawn: world.spawn,
    })
    // ON NE TIQUE PAS ENCORE. Le client a encore ~3 s de montage devant lui (bake du
    // terrain, maillages, décor) : tiquer pendant ce temps, c'est faire vivre le monde
    // sans personne pour le voir — et surtout, les snapshots de ces 60 ticks tomberaient
    // dans le vide alors qu'ils emportent des flux À USAGE UNIQUE (`drainEvents` vide la
    // file d'événements, `collectNodeDeltas` avance son ombre) : la chronique y perdrait
    // ses premiers faits, dont « Acte I ». Le client dit `resume` quand il est debout.
    // (Un serveur LAN, lui, ignorera ce silence : son monde n'attend personne — le client
    // a de toute façon une garde qui jette les snapshots reçus avant d'être monté.)
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
