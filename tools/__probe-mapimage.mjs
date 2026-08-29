/** SONDE JETABLE — quelle texture l'onglet CARTE affiche-t-il vraiment ? */
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.error(`!! ERREUR DE PAGE : ${e.message}`))
await page.goto('http://localhost:3100/?solo', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData') && window.__BRAISES__.scene.registry.get('playerPos')), null, { timeout: 120000 })
await page.waitForTimeout(1500)
await page.keyboard.press('m')
await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('mapOpen')), null, { timeout: 20000 })
await page.waitForTimeout(800)
const avant = await page.evaluate(() => {
  const ui = window.__BRAISES__.scene.scene.get('ui')
  return { tex: ui?.mapImage?.texture?.key, savoir: window.__BRAISES__.scene.textures.exists('carte-savoir'), lecture: window.__BRAISES__.scene.textures.exists('carte-lecture') }
})
await page.evaluate(() => { window.__BRAISES__.scene.registry.set('debugOn', true) })
await page.waitForTimeout(1200)
const apres = await page.evaluate(() => {
  const ui = window.__BRAISES__.scene.scene.get('ui')
  return { tex: ui?.mapImage?.texture?.key, toutVu: ui?.mapToutVu }
})
const bande = await page.evaluate(() => {
  const sc = window.__BRAISES__.scene
  const ctx = sc.textures.get('carte-lecture').getSourceImage().getContext('2d')
  const m = sc.map
  const x = Math.floor(m.width / 2)
  const ligne = {}
  for (const y of [5, 15, 25, 35, 45, 55, 65, 75, 85, 100, 120]) {
    ligne[y] = { px: [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3), terrain: m.terrain[y * m.width + x] }
  }
  return ligne
})
console.log(JSON.stringify({ avant, apres, bande }))
await page.waitForTimeout(4000) // laisser QUELQUES frames à 1 fps : la bascule doit se rendre
await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
await page.screenshot({ timeout: 120000, path: '/tmp/claude-1001/-home-alexis-projects-ashes--claude-worktrees-cerf-revu/93500dbc-3385-43ef-9a7d-8d33bd4d77d9/scratchpad/carte/carte-apres-4-entiere.png' })
console.log('capture ok')
await browser.close()
