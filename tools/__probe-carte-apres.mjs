/**
 * SONDE JETABLE — l'écran CARTE APRÈS la refonte (savoir-cendre + trois états + art de carte).
 *
 * Quatre prises :
 *   1. carte au spawn : disque VIF + encre (l'état d'ouverture)
 *   2. après un aller-retour téléporté : les anciens disques GRISÉS, l'actuel VIF
 *   3. près d'une fosse au jour 140 : la cendre VUE dans le disque, puis re-téléporté
 *      au spawn → la cendre reste sur la carte, GRISÉE (la mémoire du front)
 *   4. la carte ENTIÈRE sous la levée debug (`carte-lecture`) — le rendu à juger
 *
 * Recette : vite de CE worktree sur :3100 (debug armé), SwiftShader, loop.sleep avant capture.
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
await page.waitForFunction(
  () => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData') && window.__BRAISES__.scene.registry.get('playerPos')),
  null,
  { timeout: 120000 },
)
await page.waitForTimeout(2000)

const shot = async (nom) => {
  await page.waitForTimeout(3500) // 1 fps sous SwiftShader : laisser la bascule SE RENDRE
  await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
  await page.screenshot({ timeout: 120000, path: `${OUT}/${nom}.png` })
  await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
  console.log(`→ ${OUT}/${nom}.png`)
}
const tp = async (x, y) => {
  await page.evaluate(([tx, ty]) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: tx, y: ty }), [x, y])
  await page.waitForTimeout(900) // snapshots + revele + estampille + repeint
}

// ── PRISE 1 : l'ouverture — disque vif dans l'encre ──
await page.keyboard.press('m')
await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('mapOpen')), null, { timeout: 20000 })
await page.waitForTimeout(1500)
await shot('carte-apres-1-spawn')

// ── PRISE 2 : un aller-retour — la mémoire se grise derrière soi ──
const spawn = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
await tp(spawn.x + 60, spawn.y)
await tp(spawn.x + 120, spawn.y + 40)
await tp(spawn.x, spawn.y) // retour : les deux étapes doivent se griser
await page.waitForTimeout(800)
await shot('carte-apres-2-memoire')

// ── PRISE 3 : la cendre, vue puis souvenue ──
// La fosse : la tuile de moindre coût du champ de cheminement (cout*FOYERS_MAX+foyer).
const fosse = await page.evaluate(() => {
  const sc = window.__BRAISES__.scene
  const m = sc.map
  const champ = m.cendreCout
  if (!champ) return null
  let best = -1
  let bi = -1
  for (let i = 0; i < champ.length; i++) {
    const v = champ[i]
    if (v === undefined || v < 0) continue
    if (best < 0 || v < best) { best = v; bi = i }
  }
  return bi < 0 ? null : { x: bi % m.width, y: Math.floor(bi / m.width) }
})
if (!fosse) {
  console.error('!! aucune fosse sur cette carte — la prise cendre saute')
} else {
  await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_season_day', day: 140 }))
  await page.waitForTimeout(1200)
  await tp(fosse.x + 0.5, fosse.y - 14.5) // au bord de la tache, pas dedans
  await page.waitForTimeout(1200)
  await shot('carte-apres-3a-cendre-vive')
  await tp(spawn.x, spawn.y)
  await page.waitForTimeout(800)
  await shot('carte-apres-3b-cendre-souvenue')
}

await browser.close()
