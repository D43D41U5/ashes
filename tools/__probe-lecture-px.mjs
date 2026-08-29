/** SONDE JETABLE — les pixels de la texture carte-lecture, aux quatre bords et au centre. */
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage()
await page.goto('http://localhost:3100/?solo', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData')), null, { timeout: 120000 })
await page.waitForFunction(() => window.__BRAISES__.scene.textures.exists('carte-lecture'), null, { timeout: 60000 })
const info = await page.evaluate(() => {
  const sc = window.__BRAISES__.scene
  const src = sc.textures.get('carte-lecture').getSourceImage()
  const ctx = src.getContext('2d')
  const m = sc.map
  const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)
  return {
    w: src.width, h: src.height,
    hautGauche: px(10, 10), hautMilieu: px(Math.floor(m.width / 2), 10),
    basMilieu: px(Math.floor(m.width / 2), m.height - 10),
    gaucheMilieu: px(10, Math.floor(m.height / 2)), droiteMilieu: px(m.width - 10, Math.floor(m.height / 2)),
    centre: px(Math.floor(m.width / 2), Math.floor(m.height / 2)),
    terrainHautMilieu: m.terrain[10 * m.width + Math.floor(m.width / 2)],
  }
})
console.log(JSON.stringify(info))
await browser.close()
