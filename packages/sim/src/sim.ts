/**
 * Noyau de la simulation : état + boucle de tick à pas fixe.
 *
 * Contrat de déterminisme : `step(state, inputs)` est une fonction pure du
 * point de vue de l'extérieur — même état + mêmes inputs = même état suivant,
 * sur n'importe quelle machine. Tout le multi, le replay log et les tests
 * headless reposent sur ce contrat.
 *
 * L'état est un objet JSON-sérialisable (pas de classes, pas de Map) pour
 * que snapshot = JSON.stringify et que le transport Worker/réseau soit
 * trivial.
 */
import { BALANCE, TICK_DT_S } from './balance'
import { emitEvent, type SimEvent } from './events'
import { rngNext } from './rng'

export interface Entity {
  id: number
  /** Position en tuiles (flottants — la grille de collision viendra ensuite). */
  x: number
  y: number
}

export interface SimState {
  /** Numéro de tick — l'unique notion de temps dans /sim. */
  tick: number
  /** Seed d'origine, conservée pour l'en-tête du replay log. */
  seed: number
  /** État courant du PRNG (avance à chaque tirage). */
  rngState: number
  nextEntityId: number
  entities: Entity[]
  /** Buffer d'événements de domaine, drainé par l'hôte (voir events.ts). */
  events: SimEvent[]
}

/** Intention de déplacement d'un avatar pour un tick donné. */
export interface MoveInput {
  entityId: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
}

export function createSim(seed: number): SimState {
  return {
    tick: 0,
    seed,
    rngState: seed >>> 0,
    nextEntityId: 1,
    entities: [],
    events: [],
  }
}

export function spawnEntity(state: SimState, x: number, y: number): number {
  const id = state.nextEntityId
  state.nextEntityId += 1
  state.entities.push({ id, x, y })
  // Consomme un pas de PRNG : le spawn fait partie de l'histoire déterministe.
  state.rngState = rngNext(state.rngState)
  emitEvent(state, { type: 'entity_spawned', tick: state.tick, entityId: id, x, y })
  return id
}

/** Avance la simulation d'exactement un tick. Mute `state` en place. */
export function step(state: SimState, inputs: MoveInput[]): void {
  const speed = BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S
  for (const input of inputs) {
    const entity = state.entities.find((e) => e.id === input.entityId)
    if (!entity) continue
    // Normalisation diagonale simple ; la collision AABB remplacera ceci.
    const norm = input.dx !== 0 && input.dy !== 0 ? Math.SQRT1_2 : 1
    entity.x += input.dx * speed * norm
    entity.y += input.dy * speed * norm
  }
  state.tick += 1
}

/** Snapshot canonique — sert d'égalité d'état dans les tests et le replay. */
export function snapshot(state: SimState): string {
  return JSON.stringify(state)
}
