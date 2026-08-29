import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const OUT = '/tmp/claude-1001/-home-alexis-projects-ashes/139b6603-6f5e-4a25-bccc-3e1fe98f3e92/scratchpad/traces-coin'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.error(`!! ${e.message}`))
await page.goto('http://localhost:3199/?solo', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__BRAISES__?.scene?.tracesLayer != null && window.__BRAISES__.scene.tracesLayer.images.length >= 0, null, { timeout: 240_000 })
const releve = await page.evaluate(() => {
  const sc = window.__BRAISES__.scene
  const ims = sc.tracesLayer.images
  const parCle = {}
  for (const im of ims) parCle[im.texture.key] = (parCle[im.texture.key] ?? 0) + 1
  const une = (cle) => {
    const im = ims.find((i) => i.texture.key === cle)
    return im ? { x: im.x / 16, y: im.y / 16 } : null
  }
  return { total: ims.length, parCle, fumees: une('spr-trace-fumees'), frottis: une('spr-trace-frottis'), empreinte: une('spr-trace-empreinte') }
})
console.log('RELEVÉ couche traces :', JSON.stringify(releve))
if (releve.total === 0) {
  console.error('✗ AUCUNE trace posée — la couche est vide')
  process.exit(1)
}
const agir = async (a, ms) => {
  await page.evaluate((x) => window.__BRAISES__.scene.sendAction(x), a)
  await page.waitForTimeout(ms)
}
async function zoomSur(nom, cible) {
  if (!cible) {
    console.log(`(pas de ${nom} sur cette carte)`)
    return
  }
  await agir({ type: 'debug_teleport', x: cible.x + 1, y: cible.y + 1 }, 2500)
  await page.evaluate((c) => {
    const sc = window.__BRAISES__.scene
    sc.cameras.main.setZoom(5)
    sc.cameras.main.centerOn(c.x * 16, c.y * 16)
    sc.game.loop.sleep()
    const t0 = performance.now()
    for (let k = 0; k < 4; k++) sc.game.step(t0 + k * 16, 16)
  }, cible)
  await page.screenshot({ path: `${OUT}/zoom-${nom}.png` })
  await page.evaluate(() => {
    const sc = window.__BRAISES__.scene
    sc.cameras.main.setZoom(2)
    sc.game.loop.wake()
  })
  await page.waitForTimeout(400)
  console.log(`✓ zoom-${nom}.png`)
}
await zoomSur('fumees', releve.fumees)
await zoomSur('frottis', releve.frottis)
await zoomSur('empreinte', releve.empreinte)
await browser.close()
