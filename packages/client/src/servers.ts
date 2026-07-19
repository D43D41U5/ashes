/**
 * Les serveurs multi proposés par l'écran principal (`MenuScene`). Un seul pour
 * l'instant : « La Vallée ».
 *
 * `seed` et `maxClients` MIROITENT la config serveur (`packages/server/src/scenario.ts`).
 * Colyseus 0.16 a retiré le listing public des rooms — on ne peut donc pas les LIRE à
 * distance ; on les affiche depuis cette config. Le serveur reste l'AUTORITÉ (il fait
 * respecter `maxClients` et joue la `seed`) : ici, c'est de l'affichage.
 */
export interface ServerEntry {
  /** Nom affiché. */
  name: string
  /** URL WebSocket du serveur Colyseus (ex. `ws://localhost:2567`). */
  url: string
  /** La seed du monde (mirroir de `LAN_SEED`). */
  seed: number
  /** Le plafond de joueurs (mirroir de `MAX_PLAYERS`). */
  maxClients: number
}

/**
 * L'URL par défaut du serveur. On la DÉRIVE de l'hôte de la PAGE — jamais `localhost` :
 * en dev distant (VPS + navigateur perso), `localhost` pointe la machine du JOUEUR, pas
 * le serveur. La page vient de `http://ashes.test/` (ou de l'IP du VPS) → le serveur est
 * sur le MÊME hôte, port 2567 : `ws://ashes.test:2567`. En https, on passe en `wss`.
 * `VITE_SERVER_URL` surcharge (ex. une route Traefik dédiée). Le VPS doit exposer 2567.
 */
const SERVER_PORT = 2567
const derivedUrl = (): string => {
  if (typeof location === 'undefined') return `ws://localhost:${SERVER_PORT}`
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.hostname}:${SERVER_PORT}`
}
const DEFAULT_URL = import.meta.env.VITE_SERVER_URL ?? derivedUrl()

export const SERVERS: ServerEntry[] = [{ name: 'La Vallée', url: DEFAULT_URL, seed: 2026, maxClients: 50 }]
