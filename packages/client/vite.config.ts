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

export default defineConfig({
  plugins: [fullReloadOnSimChange()],
  // `allowedHosts: true` : le serveur de dev est derrière Traefik, qui lui
  // transmet le Host demandé par le navigateur (ashes.test, l'IP nue du VPS…).
  // Les lister ici reviendrait à figer l'adresse de la machine dans le dépôt.
  server: { port: 3000, host: true, allowedHosts: true },
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
