/**
 * SONDE JETABLE — photographier l'écran CARTE (onglet M) tel qu'il est AUJOURD'HUI.
 *
 * Deux prises : (1) la carte du joueur (brouillard réel, spawn), (2) la carte entière
 * sous la levée debug — c'est elle qui montre le rendu du terrain à juger.
 *
 * Recette harnais : voir tools/smoke.mjs (SwiftShader, loop.sleep avant capture).
 *   node tools/__probe-carte-avant.mjs   (exige le vite de CE worktree sur :3100)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = process.env.SMOKE_OUT
  ? resolve(process.env.SMOKE_OUT)
  : '/tmp/claude-1001/-home-alexis-projects-ashes--claude-worktrees-cerf-revu/93500dbc-3385-43ef-9a7d-8d33bd4d77d9/scratchpad/carte'
mkdirSync(OUT, { recursive: true })
const URL = 'http://localhost:3100/?solo'

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.error(`!! ERREUR DE PAGE : ${e.message}`))

for (let i = 0; ; i += 1) {
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 10000 })
    break
  } catch (e) {
    if (i >= 15) throw e
    await page.waitForTimeout(1000)
  }
}

// Le jeu est prêt quand la scène expose la carte et un joueur.
await page.waitForFunction(
  () => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData') && window.__BRAISES__.scene.registry.get('playerPos')),
  null,
  { timeout: 120000 },
)
await page.waitForTimeout(2000) // laisser le monde se peindre (SwiftShader est lent)

// ── PRISE 1 : la carte du joueur (brouillard réel) ──
await page.keyboard.press('m')
await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('mapOpen')), null, { timeout: 20000 })
await page.waitForTimeout(1500) // deux-trois images : le calque se peint
await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
await page.screenshot({ timeout: 120000, path: `${OUT}/carte-avant-joueur.png` })
await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
console.log(`→ ${OUT}/carte-avant-joueur.png`)

// ── PRISE 2 : la carte ENTIÈRE (levée debug — un affichage, jamais une écriture) ──
await page.evaluate(() => window.__BRAISES__.scene.registry.set('debugOn', true))
await page.waitForTimeout(1200)
await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
await page.screenshot({ timeout: 120000, path: `${OUT}/carte-avant-entiere.png` })
await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
console.log(`→ ${OUT}/carte-avant-entiere.png`)

await browser.close()
