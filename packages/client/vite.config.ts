import { defineConfig, type Plugin } from 'vite'

/**
 * LE NUMÉRO DE BUILD (demande d'Alexis) — pour vérifier d'un coup d'œil que le jeu SERVI
 * correspond au dernier code produit. Horodatage + hash git court (marqué `+` si l'arbre a des
 * changements non commités ; le hash tombe en dev-conteneur, où `git` est absent → horodatage seul).
 *
 * Servi par un MODULE VIRTUEL (`virtual:braises-build-id`), PAS un `define`. Raison : un `define`
 * est figé au démarrage de Vite, or le jeu tourne en conteneur où l'on édite À CHAUD (HMR) sans
 * redémarrer le serveur — le numéro serait resté bloqué à l'heure de démarrage pendant que le code
 * changeait sous lui, ce qui est exactement le contraire du but. Le plugin RÉÉVALUE le module (et
 * donc l'horodatage) à chaque changement de source : après un reload, le numéro reflète l'instant
 * du dernier changement. En build de prod, `load()` ne tourne qu'une fois → l'heure du build.
 *
 * `node:child_process` est déclaré localement, comme `process` plus bas : ce fichier tourne sur
 * Node, mais le paquet client n'embarque pas @types/node.
 */
declare module 'node:child_process' {
  export function execSync(
    command: string,
    options: { encoding: 'utf8'; stdio?: readonly ('ignore' | 'pipe' | 'inherit')[] },
  ): string
}
import { execSync } from 'node:child_process'

function buildId(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  // `stdio` muet sur stderr : le conteneur Docker (node:alpine) n'a PAS `git` — sans ça il
  // crachait « git: not found » à chaque démarrage de Vite. Le catch retombe sur l'horodatage.
  const git = (cmd: string): string =>
    execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let rev = ''
  try {
    rev = ` · ${git('git rev-parse --short HEAD')}`
    if (git('git status --porcelain')) rev += '+'
  } catch {
    /* hors dépôt git, ou git absent (conteneur) : l'horodatage seul fait le travail */
  }
  return stamp + rev
}

/** Le module virtuel `virtual:braises-build-id` (voir l'en-tête). Réévalué à chaque changement
 *  de source en dev → le numéro suit le code ; évalué une fois en build → l'heure du build. */
function buildIdPlugin(): Plugin {
  const VIRTUAL = 'virtual:braises-build-id'
  const RESOLVED = '\0' + VIRTUAL
  return {
    name: 'braises:build-id',
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined
    },
    load(id) {
      return id === RESOLVED ? `export const BUILD_ID = ${JSON.stringify(buildId())}` : undefined
    },
    configureServer(server) {
      // Toute modif de source INVALIDE le module virtuel : son `load()` se rejouera au prochain
      // reload (déclenché par le changement lui-même) avec un horodatage frais. Découplé du
      // retour de `handleHotUpdate` pour ne pas gêner le plugin de full-reload de `/sim`.
      server.watcher.on('all', () => {
        const mod = server.moduleGraph.getModuleById(RESOLVED)
        if (mod) server.moduleGraph.invalidateModule(mod)
      })
    },
  }
}

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
  plugins: [fullReloadOnSimChange(), buildIdPlugin()],
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
