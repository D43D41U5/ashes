// JETABLE (2026-08-25) — le même serveur de dev, mais SANS HMR ni surveillance de fichiers.
// Motif : une autre session édite `packages/client` en même temps, et chaque édition rechargeait
// la page en plein scénario smoke (« Execution context was destroyed »), ce qui fait accuser le
// code neuf par un ✗ qui n'est qu'un rechargement. `import.meta.env.DEV` reste VRAI (c'est le
// serveur de dev, pas un build), donc les leviers de debug — heure, TP — restent armés.
import base from './vite.config'

export default {
  ...base,
  server: { ...(base as { server?: object }).server, hmr: false, watch: { ignored: ['**/*'] } },
}
