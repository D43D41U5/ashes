/**
 * La frontière de TRANSPORT client ⇄ hôte (spec client R1-R3).
 *
 * Le jeu ne connaît que cette interface : un Worker aujourd'hui (Veillée),
 * une connexion Colyseus en Phase LAN — « seul le transport change ». La
 * scène ne doit jamais instancier un Worker ou un socket elle-même.
 */
import type { ClientToHost, HostToClient } from '@braises/sim'
import { Client, type Room } from 'colyseus.js'

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

/** Code WebSocket d'une fermeture NORMALE : un `leave()` consenti (le nôtre) le porte. */
const NORMAL_CLOSE = 1000

/**
 * L'hôte LAN : la sim vit sur un serveur Colyseus, ce client s'y branche. Même
 * interface que `createWorkerHost` — « seul le transport change ». `joinOrCreate`
 * est asynchrone alors que l'interface est synchrone : les envois d'avant-connexion
 * (le `join` que la scène poste aussitôt) sont mis en file et vidés à la connexion.
 * On enregistre le handler de messages AVANT de vider la file, donc avant que le
 * serveur ne réponde `ready` — pas de course.
 */
export function createColyseusHost(url: string): HostConnection {
  const client = new Client(url)
  let room: Room | undefined
  const outbox: ClientToHost[] = []
  let messageCb: ((msg: HostToClient) => void) | undefined
  let errorCb: ((message: string) => void) | undefined
  /** Coupé volontairement (terminate) : on tait alors les erreurs de fermeture. */
  let closed = false

  // LATENCE ARTIFICIELLE (dev, spec Tranche B) : `VITE_FAKE_LAG_MS` retarde l'envoi
  // ET la réception, chacun de la moitié → un RTT simulé sans joueur distant. Un délai
  // FIXE préserve l'ordre (FIFO). Sert à éprouver réconciliation (avatar local sans
  // rubber-band) et interpolation (distants lisses) au ping cible. Inerte en prod (env absente).
  const halfLagMs = Math.max(0, Number(import.meta.env.VITE_FAKE_LAG_MS ?? 0)) / 2
  const afterLag = (fn: () => void): void => {
    if (halfLagMs > 0) window.setTimeout(fn, halfLagMs)
    else fn()
  }

  const fail = (message: string): void => {
    if (!closed) errorCb?.(message)
  }

  client
    .joinOrCreate('zone')
    .then((joined) => {
      if (closed) {
        void joined.leave()
        return
      }
      room = joined
      // Le payload EST notre message protocole (le serveur a fait `send(msg.type, msg)`).
      // Le payload EST notre message protocole (le serveur a fait `send(msg.type, msg)`).
      joined.onMessage('*', (channel, payload) => {
        // Le chat arrive sur son PROPRE canal `chatmsg`, en TABLEAU `[from, x, y, text]` — on
        // reconstruit le message protocole `ChatBroadcast`. Tout le reste (snapshot, ready…)
        // EST déjà le message tel quel (le serveur a fait `send(msg.type, msg)`).
        const p = payload as [number, number, number, string]
        const msg = channel === 'chatmsg' ? ({ type: 'chat', from: p[0], x: p[1], y: p[2], text: p[3] } as HostToClient) : (payload as HostToClient)
        afterLag(() => messageCb?.(msg))
      })
      joined.onError((code, message) => fail(message ?? `erreur du serveur (${code})`))
      joined.onLeave((code) => {
        if (code !== NORMAL_CLOSE) fail('connexion au serveur perdue')
      })
      for (const msg of outbox) afterLag(() => joined.send(msg.type, msg))
      outbox.length = 0
    })
    .catch((err: unknown) => {
      fail(`connexion au serveur impossible (${url}) : ${err instanceof Error ? err.message : String(err)}`)
    })

  return {
    send: (msg) => {
      const r = room
      if (r) afterLag(() => r.send(msg.type, msg))
      else outbox.push(msg)
    },
    onMessage: (cb) => {
      messageCb = cb
    },
    onError: (cb) => {
      errorCb = cb
    },
    terminate: () => {
      closed = true
      void room?.leave()
    },
  }
}
