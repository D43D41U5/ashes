/**
 * Replay log — journal des inputs, jour 1 (GDD §11).
 *
 * Le serveur (ou le Worker en mode Veillée) journalise la seed et les inputs
 * de chaque tick ; rejouer le log reconstruit l'état exact. C'est l'outil de
 * debug, le banc de test de charge, et plus tard le « tribunal » de
 * modération.
 */
import { createSim, step, type MoveInput, type SimState } from './sim'

export interface ReplayLog {
  seed: number
  /** inputs[t] = les inputs appliqués au tick t. */
  ticks: MoveInput[][]
}

export function createReplayLog(seed: number): ReplayLog {
  return { seed, ticks: [] }
}

/** Enregistre les inputs d'un tick puis avance la simulation. */
export function recordAndStep(state: SimState, log: ReplayLog, inputs: MoveInput[]): void {
  log.ticks.push(inputs)
  step(state, inputs)
}

/**
 * Rejoue un log complet depuis la seed. Le `setup` reproduit ce qui s'est
 * passé avant le premier tick (spawns initiaux) — il doit être le même code
 * que celui de la partie originale.
 */
export function runReplay(log: ReplayLog, setup: (state: SimState) => void): SimState {
  const state = createSim(log.seed)
  setup(state)
  for (const inputs of log.ticks) {
    step(state, inputs)
  }
  return state
}
