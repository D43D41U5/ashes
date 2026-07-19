/**
 * @braises/server — Node + Colyseus : la boucle autoritative de la Phase LAN.
 *
 * La simulation ne change pas en passant ici — c'est tout l'intérêt (invariant
 * « une seule simulation »). Ce module ne fait qu'ouvrir le transport WebSocket et
 * déclarer la zone ; tout le jeu vit dans `/sim`, piloté par `ZoneRoom`.
 *
 * Lancer : `pnpm --filter @braises/server dev` (ou `start`). Le client s'y branche
 * via `VITE_SERVER_URL=ws://localhost:2567`.
 */
import { matchMaker, Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { ZoneRoom } from './zone-room'
import { getZone } from './zone-singleton'

const PORT = Number(process.env.PORT ?? 2567)

// PRÉ-BÂTIR le monde MAINTENANT, avant d'écouter : la génération (~10 s de CPU
// synchrone) se fait pendant que personne n'attend. `onCreate` récupérera ensuite
// ce singleton instantanément, sans jamais geler la boucle pendant un matchmaking.
console.log('[braises/server] génération de la vallée…')
getZone()
console.log('[braises/server] vallée prête.')

// HEARTBEAT tolérant. Le défaut (ping 3 s × 2 = ~6 s) terminait le navigateur PENDANT
// son montage du monde (bake des maillages, plusieurs secondes) : occupé, il tardait à
// pong. À 5 s × 4 = ~20 s, il passe le cap, puis pongue normalement — on GARDE donc la
// détection des connexions mortes (mesuré : un navigateur survit >24 s, tick qui avance).
const gameServer = new Server({ transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 4 }) })
gameServer.define('zone', ZoneRoom)

gameServer
  .listen(PORT)
  .then(async () => {
    // Créer la zone D'AVANCE : l'écran principal du client la liste (nom, seed,
    // N/50) via le matchmaking AVANT que quiconque n'ait rejoint. Sans ça, la room
    // n'existerait qu'au premier join et le menu montrerait un serveur vide.
    await matchMaker.createRoom('zone', {})
    console.log(`[braises/server] zone LAN à l'écoute sur ws://localhost:${PORT}`)
  })
  .catch((err: unknown) => {
    console.error('[braises/server] échec du démarrage :', err)
    process.exitCode = 1
  })
