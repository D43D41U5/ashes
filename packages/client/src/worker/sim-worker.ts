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
  createSim,
  drainEvents,
  foundNpcVillage,
  spawnMonster,
  generateNodes,
  getGameTime,
  spawnEntity,
  step,
  type MoveInput,
  type PlayerAction,
  type SimState,
} from '@braises/sim'
import type { ClientToHost, HostToClient } from '../protocol'

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
  if (msg.type === 'init') {
    if (sim) return // déjà initialisé : un second init empilerait une seconde boucle
    // La « chair » : les nœuds de ressources sont générés depuis la seed.
    const nodes = generateNodes(msg.map, msg.seed)
    sim = createSim(msg.seed, { map: msg.map, calendarScale: msg.calendarScale, nodes })
    // Les voisins à caractère (spec alignement R12) : un Foyer au nord qui
    // donne, une Meute à l'est qui raide la nuit.
    foundNpcVillage(sim, 24, 14, 4, 'foyer')
    foundNpcVillage(sim, 52, 40, 3, 'meute')
    // La menace et le gibier : zombies au sud de la route, sangliers épars.
    spawnMonster(sim, 'zombie', 20, 46)
    spawnMonster(sim, 'zombie', 30, 50)
    spawnMonster(sim, 'zombie', 44, 44)
    spawnMonster(sim, 'boar', 16, 22)
    spawnMonster(sim, 'boar', 34, 24)
    playerId = spawnEntity(sim, msg.playerSpawn.x, msg.playerSpawn.y)
    // Plus de kit de départ : la boucle commence les mains vides (spec économie).
    post({ type: 'ready', playerId })
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
