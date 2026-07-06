/**
 * La frontière de TRANSPORT client ⇄ hôte (spec client R1-R3).
 *
 * Le jeu ne connaît que cette interface : un Worker aujourd'hui (Veillée),
 * une connexion Colyseus en Phase LAN — « seul le transport change ». La
 * scène ne doit jamais instancier un Worker ou un socket elle-même.
 */
import type { ClientToHost, HostToClient } from './protocol'

export interface HostConnection {
  send(msg: ClientToHost): void
  onMessage(cb: (msg: HostToClient) => void): void
  /** Erreur fatale de l'hôte (exception du Worker, transport rompu). */
  onError(cb: (message: string) => void): void
  terminate(): void
}

/** L'hôte Veillée : la sim dans un Web Worker, sur cette machine. */
export function createWorkerHost(): HostConnection {
  const worker = new Worker(new URL('./worker/sim-worker.ts', import.meta.url), { type: 'module' })
  return {
    send: (msg) => worker.postMessage(msg),
    onMessage: (cb) =>
      worker.addEventListener('message', (e: MessageEvent<HostToClient>) => cb(e.data)),
    onError: (cb) => {
      worker.addEventListener('error', (e) => cb(e.message || 'erreur du worker'))
      worker.addEventListener('messageerror', () => cb('message illisible du worker'))
    },
    terminate: () => worker.terminate(),
  }
}
