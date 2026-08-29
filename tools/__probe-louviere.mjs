/**
 * SONDE JETABLE — pourquoi la carte JOUÉE n'a pas de Louvière ?
 * Compte les zones par kind dans la Veillée réelle (vite dev sur URL).
 */
import { chromium } from 'playwright'

const URL = process.env.URL ?? 'http://localhost:3100/'
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] })
const p = await b.newPage()
await p.goto(URL)
await p.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData')), null, { timeout: 150000 })
const info = await p.evaluate(() => {
  const sc = window.__BRAISES__.scene
  const m = sc.map
  const compte = {}
  for (const z of m.zones ?? []) compte[z.kind ?? 'sans'] = (compte[z.kind ?? 'sans'] ?? 0) + 1
  return { w: m.width, h: m.height, zones: (m.zones ?? []).length, compte }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
