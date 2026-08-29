/** SONDE JETABLE — la carte ENTIÈRE (levée debug) seule. Vite de CE worktree sur :3100. */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = process.env.SMOKE_OUT
  ? resolve(process.env.SMOKE_OUT)
  : '/tmp/claude-1001/-home-alexis-projects-ashes--claude-worktrees-cerf-revu/93500dbc-3385-43ef-9a7d-8d33bd4d77d9/scratchpad/carte'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.error(`!! ERREUR DE PAGE : ${e.message}`))

for (let i = 0; ; i += 1) {
  try {
    await page.goto('http://localhost:3100/?solo', { waitUntil: 'networkidle', timeout: 10000 })
    break
  } catch (e) {
    if (i >= 15) throw e
    await page.waitForTimeout(1000)
  }
}
await page.waitForFunction(
  () => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData') && window.__BRAISES__.scene.registry.get('playerPos')),
  null,
  { timeout: 120000 },
)
await page.waitForTimeout(2000)
await page.keyboard.press('m')
await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('mapOpen')), null, { timeout: 20000 })
await page.evaluate(() => { window.__BRAISES__.scene.registry.set('debugOn', true) })
await page.waitForTimeout(1500)
await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
await page.screenshot({ timeout: 120000, path: `${OUT}/carte-apres-4-entiere.png` })
console.log(`→ ${OUT}/carte-apres-4-entiere.png`)
await browser.close()
