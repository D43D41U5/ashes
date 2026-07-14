import { defineConfig, type Plugin } from 'vite'

/**
 * LE HMR NE SAIT PAS HOT-PATCHER `/sim`.
 *
 * La simulation tourne dans un Web Worker (mode Veillée). Quand un module de
 * `/sim` change, le HMR de Vite tente un patch partiel — mais le Worker n'y
 * participe pas comme le thread principal, et Vite finit par servir des versions
 * DÉSYNCHRONISÉES (un `village.ts` frais qui importe un `items.ts` périmé) : le
 * navigateur lève alors « does not provide an export named X » sur un export qui
 * existe pourtant sur disque. Symptôme récurrent, cause structurelle.
 *
 * Un changement dans `/sim` exige DE TOUTE FAÇON de reconstruire le Worker en
 * entier pour être fiable (invariant du projet). On force donc un RECHARGEMENT
 * COMPLET de la page dès qu'un fichier de `/sim` bouge : le Worker renaît avec un
 * graphe de modules cohérent, et la classe de bug disparaît. Le coût — une
 * frappe dans `/sim` recharge la page au lieu de hot-patcher — n'en est pas un :
 * le hot-patch de `/sim` n'était jamais digne de confiance.
 */
function fullReloadOnSimChange(): Plugin {
  return {
    name: 'braises:full-reload-on-sim-change',
    handleHotUpdate({ file, server }) {
      if (file.includes('/packages/sim/') && !file.includes('.test.')) {
        server.ws.send({ type: 'full-reload' })
        return [] // on a déclenché le reload : pas de patch partiel (source de la désync)
      }
    },
  }
}

/**
 * LE WATCHER EST AVEUGLE DANS LE CONTENEUR — et il l'était EN SILENCE.
 *
 * Le dépôt est monté en bind (`.:/app:ro`, cf. `docker-compose.yml`) : les
 * notifications inotify de l'hôte ne traversent PAS le montage. Le Vite du
 * conteneur ne recevait donc aucun événement de fichier — il servait un graphe de
 * modules figé au démarrage, et le plugin ci-dessus n'a jamais tiré une seule fois.
 * Vécu le 2026-07-14 : `sentiers.ts` supprimé sur l'hôte, `pnpm check`, `test`,
 * `lint` et `smoke` tous verts — et le jeu servi par `ashes.test` importait encore
 * le fichier disparu, une heure durant. Le symptôme ne dit RIEN de la cause : on
 * croit que le code n'est pas parti, alors que c'est le serveur qui ne l'a pas vu
 * partir. Seul un `docker compose restart client` rafraîchissait quoi que ce soit.
 *
 * Le scrutin est le seul recours : chokidar interroge le disque au lieu d'attendre
 * qu'on l'appelle. Il coûte du CPU en continu — d'où le pilotage par variable
 * d'environnement (`BRAISES_POLL=1`, posée par le compose) : le conteneur scrute,
 * l'hôte garde inotify, qui marche très bien chez lui et ne coûte rien.
 *
 * `process` est DÉCLARÉ ICI, ET PAS IMPORTÉ : ce fichier de config tourne sur Node,
 * mais le paquet client n'embarque pas les types Node (le navigateur n'en a que
 * faire). On déclare le strict nécessaire, localement.
 */
declare const process: { env: Record<string, string | undefined> }
const SCRUTE = process.env.BRAISES_POLL === '1'

export default defineConfig({
  plugins: [fullReloadOnSimChange()],
  // `allowedHosts: true` : le serveur de dev est derrière Traefik, qui lui
  // transmet le Host demandé par le navigateur (ashes.test, l'IP nue du VPS…).
  // Les lister ici reviendrait à figer l'adresse de la machine dans le dépôt.
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
    // 300 ms : sous le seuil où l'on tend la main vers F5. Le scrutin ignore
    // `node_modules` (défaut de Vite) — il ne balaie que les sources du dépôt.
    ...(SCRUTE ? { watch: { usePolling: true, interval: 300 } } : {}),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Capital Manif : isoler le chunk Phaser (~2 Mo) pour la stabilité du cache.
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
})
