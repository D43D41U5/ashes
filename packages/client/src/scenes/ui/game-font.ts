/**
 * LA POLICE DES VOILES DOM — JetBrains Mono, la police de la maquette, EMBARQUÉE.
 *
 * Les écrans rendus ISO à la maquette (menu 9A, chargement 8B) sont du DOM, pas du
 * canvas Phaser (voir `menu-dom.ts` / `loading.ts`). Ils partagent cette police —
 * mais chacun a sa propre durée de vie (le menu se détruit AVANT que le chargement
 * n'apparaisse). Si chaque voile déclarait son `@font-face` dans SON `<style>`, la
 * déclaration partirait avec lui. On l'injecte donc UNE fois dans `<head>`, hors de
 * tout voile : elle survit à tous.
 *
 * On n'importe que les deux fichiers utiles (latin, 400 + 700) en `?url` — Vite les
 * copie hashés dans le build. On évite ainsi la feuille CSS multi-sous-ensembles de
 * `@fontsource` (latin, grec, cyrillique, vietnamien…), fragile selon l'hôte.
 */
import jbm400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url'
import jbm700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url'

/** La pile de polices à poser sur un voile DOM. `ui-monospace`/`monospace` en secours. */
export const GAME_FONT = "'JetBrains Mono',ui-monospace,monospace"

let injected = false

/** Déclare `@font-face` (400 + 700) dans `<head>`, une seule fois. Idempotent. */
export function ensureGameFont(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const s = document.createElement('style')
  s.textContent =
    `@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:block;src:url(${jbm400}) format('woff2');}` +
    `@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:700;font-display:block;src:url(${jbm700}) format('woff2');}`
  document.head.appendChild(s)
}
