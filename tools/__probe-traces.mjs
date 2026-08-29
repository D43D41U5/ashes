/**
 * SONDE JETABLE — les traces du coin de chasse (spec faune R24, A38).
 *
 * Photographie les trois sortes de traces dans le VRAI jeu (vite dev, debug armé) :
 * les fumées au gagnage, les empreintes le long de la coulée, le frottis en lisière
 * du massif. Recette verif-navigateur : TP par sendAction, boucle endormie avant
 * chaque capture, repeinte par game.step (leçon « debug empilé »).
 *
 * Usage : SMOKE_URL=http://localhost:3170/ node tools/__probe-traces.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3170/'
const URL = BASE.includes('?') ? BASE : `${BASE}?solo`
const OUT = resolve(
  process.env.SMOKE_OUT ?? '/tmp/claude-1001/-home-alexis-projects-ashes/139b6603-6f5e-4a25-bccc-3e1fe98f3e92/scratchpad/traces-coin',
)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.error(`!! ERREUR DE PAGE : ${e.message}`))

console.log(`→ ${URL}`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__BRAISES__?.scene?.view !== undefined && window.__BRAISES__.scene.grounds?.length > 0, null, {
  timeout: 240_000,
})

// Les cibles se calculent DANS la page, sur les données du jeu qui tourne.
const cibles = await page.evaluate(() => {
  const sc = window.__BRAISES__.scene
  const g = sc.grounds[0]
  const map = sc.map
  const width = map.width
  // La coulée attachée au coin : celle dont la FIN (l'eau) est la plus proche (≤ 28).
  let cheminMilieu = null
  const coulees = map.coulees ?? []
  let debut = 0
  let best = 28 * 28
  let bestSeg = null
  for (let k = 0; k <= coulees.length; k++) {
    if (k < coulees.length && coulees[k] >= 0) continue
    if (k > debut) {
      const fin = coulees[k - 1]
      const fx = fin % width
      const fy = (fin - fx) / width
      const d2 = (g.x - fx - 0.5) * (g.x - fx - 0.5) + (g.y - fy - 0.5) * (g.y - fy - 0.5)
      if (d2 < best) {
        best = d2
        bestSeg = [debut, k]
      }
    }
    debut = k + 1
  }
  if (bestSeg) {
    const i = coulees[Math.floor((bestSeg[0] + bestSeg[1]) / 2)]
    cheminMilieu = { x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 }
  }
  // La lisière boisée la plus proche du coin (le frottis y vit).
  const BOISE = new Set([3, 13, 14, 22, 24]) // forest, pine, larch, old_growth, willow — indicatif
  let lisiere = null
  let dBest = Infinity
  for (let ty = Math.max(1, Math.floor(g.y) - 40); ty < Math.min(map.height - 1, Math.floor(g.y) + 40); ty++) {
    for (let tx = Math.max(1, Math.floor(g.x) - 40); tx < Math.min(width - 1, Math.floor(g.x) + 40); tx++) {
      if (!BOISE.has(map.terrain[ty * width + tx])) continue
      const bord =
        !BOISE.has(map.terrain[ty * width + tx - 1]) ||
        !BOISE.has(map.terrain[ty * width + tx + 1]) ||
        !BOISE.has(map.terrain[(ty - 1) * width + tx]) ||
        !BOISE.has(map.terrain[(ty + 1) * width + tx])
      if (!bord) continue
      const d2 = (g.x - tx) * (g.x - tx) + (g.y - ty) * (g.y - ty)
      if (d2 < dBest) {
        dBest = d2
        lisiere = { x: tx + 0.5, y: ty + 0.5 }
      }
    }
  }
  return { coin: { x: g.x, y: g.y }, cheminMilieu, lisiere }
})
console.log('cibles :', JSON.stringify(cibles))

const agir = async (action, ms) => {
  await page.evaluate((a) => window.__BRAISES__.scene.sendAction(a), action)
  await page.waitForTimeout(ms)
}

await agir({ type: 'debug_set_hour', hour: 12 }, 1500)

async function photographier(nom, cible) {
  if (!cible) {
    console.log(`(pas de cible pour ${nom})`)
    return
  }
  await agir({ type: 'debug_teleport', x: cible.x, y: cible.y }, 2500)
  // Boucle endormie, puis on REPEINT quelques images à t connu — sinon la
  // capture montre l'état d'avant le TP (leçon « debug empilé »).
  await page.evaluate(() => {
    const sc = window.__BRAISES__.scene
    sc.game.loop.sleep()
    const t0 = performance.now()
    for (let k = 0; k < 4; k++) sc.game.step(t0 + k * 16, 16)
  })
  await page.screenshot({ path: `${OUT}/${nom}.png` })
  await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
  await page.waitForTimeout(400)
  console.log(`✓ ${nom}.png`)
}

await photographier('traces-gagnage', cibles.coin)
await photographier('traces-coulee', cibles.cheminMilieu)
await photographier('traces-lisiere', cibles.lisiere)

await browser.close()
console.log(`OUT = ${OUT}`)
