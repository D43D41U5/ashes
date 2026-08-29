/** SONDE JETABLE — de quoi le bandeau du bord de carte est-il fait ? */
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage()
await page.goto('http://localhost:3100/?solo', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData')), null, { timeout: 120000 })
const info = await page.evaluate(() => {
  const m = window.__BRAISES__.scene.map
  const t = (x, y) => m.terrain[y * m.width + x]
  const compte = {}
  for (let y = 0; y < 40; y++) for (let x = 0; x < m.width; x += 7) { const v = t(x, y); compte[v] = (compte[v] ?? 0) + 1 }
  return { w: m.width, h: m.height, bande: compte, diagonale: [t(2, 2), t(20, 20), t(40, 40), t(60, 60), t(90, 90)] }
})
console.log(JSON.stringify(info))
await browser.close()
