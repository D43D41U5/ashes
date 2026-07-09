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
} from '@braises/sim'
import { PROTOCOL_VERSION, type ClientToHost, type HostToClient } from '../protocol'
import { createVeillee, VEILLEE_CALENDAR_SCALE } from './veillee'

const post = (message: HostToClient): void => {
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage(message)
}

let sim: SimState | undefined
let playerId = 0
let playerInput: Pick<MoveInput, 'dx' | 'dy' | 'sprint' | 'block'> = { dx: 0, dy: 0 }
/** `seq` du dernier input reçu — l'hôte l'applique chaque tick et l'acquitte dans le snapshot. */
let lastProcessedInput = 0
/** Une action au plus par tick (spec village R1) — la dernière reçue gagne. */
let pendingAction: PlayerAction | undefined

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
    nodes: sim.nodes,
    npcs: sim.npcs,
    monsters: sim.monsters,
    corpses: sim.corpses,
    events: drainEvents(sim),
  })
}

/** Handle de la boucle de tick — pause/reprise (et garde anti-double-init). */
let ticker: ReturnType<typeof setInterval> | undefined

function startTicker(): void {
  if (ticker === undefined) ticker = setInterval(tick, 1000 / BALANCE.TICK_RATE_HZ)
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
    const world = createVeillee()
    sim = world.sim
    playerId = world.playerId
    post({
      type: 'ready',
      protocolVersion: PROTOCOL_VERSION,
      playerId,
      map: sim.map,
      seed: sim.seed,
      calendarScale: VEILLEE_CALENDAR_SCALE,
      playerSpawn: world.spawn,
    })
    startTicker()
  } else if (msg.type === 'input') {
    playerInput = { dx: msg.dx, dy: msg.dy, sprint: msg.sprint, block: msg.block }
    lastProcessedInput = msg.seq
  } else if (msg.type === 'action') {
    pendingAction = msg.action
  } else if (msg.type === 'pause') {
    stopTicker()
  } else if (msg.type === 'resume') {
    if (sim) startTicker()
  }
})
