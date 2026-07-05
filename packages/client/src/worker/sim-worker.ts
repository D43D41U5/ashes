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
  isBlockingTile,
  nodeAt,
  rngRoll,
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
/** Une action au plus par tick (spec village R1) — la dernière reçue gagne. */
let pendingAction: PlayerAction | undefined

/**
 * PNJ de test : des marcheurs sans cervelle qui exercent l'interpolation.
 * L'aléatoire de leurs INPUTS appartient à l'hôte (comme un joueur est
 * imprévisible) — le déterminisme de /sim n'est pas concerné.
 */
interface Wanderer {
  id: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  ticksLeft: number
}
const wanderers: Wanderer[] = []
let hostRng = 0

const roll = (): number => {
  const { value, next } = rngRoll(hostRng)
  hostRng = next
  return value
}

const dir = (v: number): -1 | 0 | 1 => (Math.floor(v * 3) - 1) as -1 | 0 | 1

function spawnWanderers(state: SimState, count: number): void {
  let placed = 0
  while (placed < count) {
    const x = 4 + Math.floor(roll() * (state.map.width - 8))
    const y = 4 + Math.floor(roll() * (state.map.height - 8))
    if (isBlockingTile(state.map, x, y) || nodeAt(state.nodes, x, y)) continue
    wanderers.push({ id: spawnEntity(state, x + 0.5, y + 0.5), dx: 0, dy: 0, ticksLeft: 0 })
    placed += 1
  }
}

function tick(): void {
  if (!sim) return
  const inputs: MoveInput[] = [
    { entityId: playerId, ...playerInput, ...(pendingAction ? { action: pendingAction } : {}) },
  ]
  pendingAction = undefined
  for (const w of wanderers) {
    if (w.ticksLeft <= 0) {
      w.dx = dir(roll())
      w.dy = dir(roll())
      w.ticksLeft = 12 + Math.floor(roll() * 36) // nouvelle intention toutes les 1-4 s
    }
    w.ticksLeft -= 1
    inputs.push({ entityId: w.id, dx: w.dx, dy: w.dy })
  }
  step(sim, inputs)
  post({
    type: 'snapshot',
    tick: sim.tick,
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

self.addEventListener('message', (event: MessageEvent<ClientToHost>) => {
  const msg = event.data
  if (msg.type === 'init') {
    // La « chair » : les nœuds de ressources sont générés depuis la seed.
    const nodes = generateNodes(msg.map, msg.seed)
    sim = createSim(msg.seed, { map: msg.map, calendarScale: msg.calendarScale, nodes })
    hostRng = msg.seed ^ 0x9e3779b9
    // Un village 100 % PNJ vit déjà dans la vallée (mode Veillée, GDD §10).
    foundNpcVillage(sim, 24, 14, 4)
    // La menace et le gibier : zombies au sud de la route, sangliers épars.
    spawnMonster(sim, 'zombie', 20, 46)
    spawnMonster(sim, 'zombie', 30, 50)
    spawnMonster(sim, 'zombie', 44, 44)
    spawnMonster(sim, 'boar', 16, 22)
    spawnMonster(sim, 'boar', 34, 24)
    playerId = spawnEntity(sim, msg.playerSpawn.x, msg.playerSpawn.y)
    // Plus de kit de départ : la boucle commence les mains vides (spec économie).
    spawnWanderers(sim, 6)
    post({ type: 'ready', playerId })
    setInterval(tick, 1000 / BALANCE.TICK_RATE_HZ)
  } else if (msg.type === 'input') {
    playerInput = { dx: msg.dx, dy: msg.dy, sprint: msg.sprint, block: msg.block }
  } else if (msg.type === 'action') {
    pendingAction = msg.action
  }
})
