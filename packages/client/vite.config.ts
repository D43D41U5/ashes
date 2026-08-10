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
// Les accès fichiers de l'ATELIER (plugin plus bas) — déclarés localement, même règle que
// `child_process` ci-dessus : ce fichier tourne sur Node, le paquet n'embarque pas ses types.
declare module 'node:fs' {
  export function readdirSync(chemin: string): string[]
  export function readFileSync(chemin: string, encodage: 'utf8'): string
  export function writeFileSync(chemin: string, contenu: string): void
}
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
// (Pas de `node:path` : son module ne se laisse pas augmenter ici — les chemins se collent
// à la main, on est sur Linux des deux côtés, hôte comme conteneur.)

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

/**
 * L'ENDPOINT DE L'ATELIER (spec `atelier-plans.md` A5/A9) — `apply: 'serve'` : il n'existe
 * qu'en dev, le build de prod ne le connaît pas (comme `atelier.html`, hors de `dist`).
 *
 * GET  /atelier/api/plans          → [{ kind, texte }] — les .plan, prose comprise.
 * POST /atelier/api/plans          → réécrit `<kind>.plan` PUIS relance le compilateur
 *      (`tools/plans-compile.mts` — le MÊME émetteur que `pnpm plans`, jamais un deuxième).
 *      S'il refuse, le .plan est RESTAURÉ : le disque reste cohérent avec le module généré.
 *
 * Borné : kinds `[a-z_]+` et lieux DÉJÀ existants (pas de création de fichier par HTTP) —
 * l'endpoint édite le dossier des plans, il n'écrit rien d'autre. Sur la stack Docker le
 * dépôt est monté `:ro` : l'écriture échoue proprement, l'Atelier propose le presse-papier.
 */
function atelierPlansPlugin(): Plugin {
  return {
    name: 'braises:atelier-plans',
    apply: 'serve',
    configureServer(server) {
      const racine = `${server.config.root}/../..`
      const dossier = `${racine}/packages/sim/src/plans`
      server.middlewares.use('/atelier/api/plans', (req, res) => {
        const repondre = (code: number, corps: unknown): void => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(corps))
        }
        if (req.method === 'GET') {
          const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.plan')).sort()
          repondre(200, fichiers.map((f) => ({ kind: f.slice(0, -'.plan'.length), texte: readFileSync(`${dossier}/${f}`, 'utf8') })))
          return
        }
        if (req.method !== 'POST') {
          repondre(405, { erreur: 'méthode inconnue' })
          return
        }
        // L'EN-TÊTE `x-atelier` FORCE UN PREFLIGHT (revue du 2026-08-10) : sans lui, un POST
        // « simple request » partait de n'importe quelle page web pendant que `pnpm dev`
        // tourne — et le serveur écoute au-delà de localhost (`host: true`).
        if (req.headers['x-atelier'] !== '1') {
          repondre(403, { erreur: 'en-tête x-atelier requis (le POST vient de la page atelier)' })
          return
        }
        // `setEncoding` : un caractère multi-octets (« · », l'accent d'une prose) à cheval sur
        // deux chunks deviendrait U+FFFD en décodant chaque Buffer isolément.
        req.setEncoding('utf8')
        let corps = ''
        req.on('data', (morceau) => {
          corps += String(morceau)
          if (corps.length > 300_000) { corps = ''; req.destroy() }
        })
        req.on('end', () => {
          let json: { kind?: unknown; texte?: unknown }
          try {
            json = JSON.parse(corps) as { kind?: unknown; texte?: unknown }
          } catch {
            repondre(400, { erreur: 'corps JSON illisible' })
            return
          }
          try {
            const { kind, texte } = json
            if (typeof kind !== 'string' || !/^[a-z_]+$/.test(kind)) { repondre(400, { erreur: 'kind invalide' }); return }
            if (typeof texte !== 'string' || texte.length > 100_000) { repondre(400, { erreur: 'texte invalide' }); return }
            const chemin = `${dossier}/${kind}.plan`
            let avant: string
            try { avant = readFileSync(chemin, 'utf8') } catch { repondre(404, { erreur: `${kind}.plan n'existe pas — la création passe par le dépôt` }); return }
            writeFileSync(chemin, texte)
            try {
              execSync(`node --import tsx ${racine}/tools/plans-compile.mts`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
            } catch (e) {
              writeFileSync(chemin, avant) //  le disque reste cohérent avec le généré
              repondre(422, { erreur: `le compilateur refuse : ${String((e as { stderr?: string }).stderr ?? e).slice(0, 400)}` })
              return
            }
            repondre(200, { ok: true })
          } catch (e) {
            repondre(500, { erreur: String(e).slice(0, 400) })
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [fullReloadOnSimChange(), buildIdPlugin(), atelierPlansPlugin()],
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
