/** SONDE JETABLE — la carte ZOOMÉE sur le disque de vue, à la fosse (jour 140) puis en mémoire. */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = process.env.SMOKE_OUT
  ? resolve(process.env.SMOKE_OUT)
  : '/tmp/claude-1001/-home-alexis-projects-ashes--claude-worktrees-cerf-revu/93500dbc-3385-43ef-9a7d-8d33bd4d77d9/scratchpad/carte'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.error(`!! ERREUR DE PAGE : ${e.message}`))
await page.goto('http://localhost:3100/?solo', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData') && window.__BRAISES__.scene.registry.get('playerPos')), null, { timeout: 300000 })
console.log('· prêt, monde chargé')
await page.waitForTimeout(2000)

const tp = async (x, y) => {
  await page.evaluate(([tx, ty]) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: tx, y: ty }), [x, y])
  await page.waitForTimeout(1200)
}
const zoomSurJoueur = async (facteur) => {
  await page.evaluate((z) => {
    const sc = window.__BRAISES__.scene
    const ui = sc.scene.get('ui')
    const pos = sc.registry.get('playerPos')
    const m = sc.registry.get('mapData')
    ui.mapZoom = z
    const scale = ui.mapFit * z
    ui.mapLayer.setScale(scale)
    const lx = pos.x * 16 - (m.width * 16) / 2
    const ly = pos.y * 16 - (m.height * 16) / 2
    ui.mapLayer.x = ui.scale.width / 2 - scale * lx
    ui.mapLayer.y = ui.mapCenterY - scale * ly
  }, facteur)
}
const shot = async (nom) => {
  await page.waitForTimeout(3500)
  await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
  await page.screenshot({ timeout: 120000, path: `${OUT}/${nom}.png` })
  await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
  console.log(`→ ${OUT}/${nom}.png`)
}

const spawn = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
const fosse = await page.evaluate(() => {
  const m = window.__BRAISES__.scene.map
  const champ = m.cendreCout
  let best = -1, bi = -1
  for (let i = 0; i < champ.length; i++) {
    const v = champ[i]
    if (v === undefined || v < 0) continue
    if (best < 0 || v < best) { best = v; bi = i }
  }
  return { x: bi % m.width, y: Math.floor(bi / m.width) }
})
await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_season_day', day: 140 }))
await page.waitForTimeout(1500)
await tp(fosse.x + 0.5, fosse.y - 14.5)
// Par l'ÉTAT, pas le clavier : `mapOpen` se dérive de l'écran personnage sur l'onglet carte.
await page.evaluate(() => {
  const reg = window.__BRAISES__.scene.registry
  reg.set('characterMenuOpen', true)
  reg.set('characterTab', 'carte')
})
console.log('· onglet carte demandé')
await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('mapOpen')), null, { timeout: 180000 })
console.log('· carte ouverte')
await zoomSurJoueur(5)
await shot('carte-zoom-1-fosse-vive')
await tp(spawn.x, spawn.y)
await zoomSurJoueur(5)
await shot('carte-zoom-2-spawn-vif')
