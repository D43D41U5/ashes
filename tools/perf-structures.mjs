/**
 * ═══ INSTRUMENT JETABLE — MESURE A9 (docs/specs/lieux-batis.md) — NE PAS COMMITTER ═══
 *
 * Mesure, dans le VRAI jeu (build de prod, Chromium SwiftShader), le coût CPU JS du chemin
 * structures : `syncStructures` par snapshot (et ses sous-coûts doorPairs/nappe/pans) côté
 * client, et le clone structuré du postMessage côté worker. S'appuie sur l'instrumentation
 * jetable posée dans `snapshot-view.ts` et `sim-worker.ts` (fenêtres d'1 s sur
 * `window.__PERF_STRUCT__`).
 *
 * Usage : PLAYWRIGHT_BROWSERS_PATH=0 node tools/perf-structures.mjs [runs=3] [mesureS=30]
 *         NOBUILD=1 pour sauter le build (si dist est déjà à jour).
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4183 // pas celui du smoke : pas de collision si l'un traîne
const RUNS = Number(process.argv[2] ?? 3)
const MESURE_S = Number(process.argv[3] ?? 30)

if (!process.env.NOBUILD) {
  await new Promise((ok, ko) => {
    const b = spawn('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore' })
    b.on('exit', (c) => (c === 0 ? ok() : ko(new Error(`pnpm build a échoué (${c})`))))
  })
}
const srv = spawn(
  'pnpm',
  ['--filter', '@ashes/client', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', detached: true },
)
const stop = () => {
  try { process.kill(-srv.pid) } catch { /* déjà mort */ }
}

const r1 = (x) => Math.round(x * 100) / 100

try {
  for (let run = 1; run <= RUNS; run++) {
    const browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', (e) => console.error(`!! PAGE : ${e.message}`))
    for (let i = 0; ; i += 1) {
      try {
        await page.goto(`http://localhost:${PORT}/?solo`, { waitUntil: 'networkidle', timeout: 10000 })
        break
      } catch (e) {
        if (i >= 15) throw e
        await page.waitForTimeout(1000)
      }
    }
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(4000) // chauffe : création des sprites, premiers snapshots
    const avant = await page.evaluate(() => (window.__PERF_STRUCT__ ?? []).length)
    await page.waitForTimeout(MESURE_S * 1000)
    const fen = await page.evaluate(() => window.__PERF_STRUCT__ ?? [])
    await browser.close()

    // On ne juge que les fenêtres nées PENDANT la période de mesure (ni la chauffe, ni la
    // dernière, partielle).
    const utiles = fen.slice(avant, -1)
    if (utiles.length < 5) {
      console.error(`run ${run} : trop peu de fenêtres (${utiles.length}) — mesure invalide`)
      continue
    }
    const somme = (f) => utiles.reduce((a, w) => a + f(w), 0)
    const pire = (f) => utiles.reduce((a, w) => Math.max(a, f(w)), 0)
    const n = somme((w) => w.n)
    console.log(`\n── run ${run} — ${utiles[0].count} structures, ${utiles.length} fenêtres d'1 s, ${n} snapshots ──`)
    console.log(`syncStructures  : moy ${r1(somme((w) => w.syncMs) / n)} ms/snap · PIRE SECONDE ${r1(pire((w) => w.syncMs))} ms/s · pire appel ${r1(pire((w) => w.maxMs))} ms`)
    console.log(`  doorPairs     : moy ${r1(somme((w) => w.doorMs) / n)} ms/snap · pire seconde ${r1(pire((w) => w.doorMs))} ms/s`)
    console.log(`  nappe         : moy ${r1(somme((w) => w.nappeMs) / n)} ms/snap · pire seconde ${r1(pire((w) => w.nappeMs))} ms/s`)
    console.log(`  pans          : moy ${r1(somme((w) => w.pansMs) / n)} ms/snap · pire seconde ${r1(pire((w) => w.pansMs))} ms/s`)
    console.log(`postMessage     : moy ${r1(somme((w) => w.postMs) / n)} ms/tick · PIRE SECONDE ${r1(pire((w) => w.postMs))} ms/s · pire envoi ${r1(pire((w) => w.maxPostMs))} ms`)
    console.log(`clone structures: moy ${r1(somme((w) => w.cloneMs) / n)} ms/tick · pire seconde ${r1(pire((w) => w.cloneMs))} ms/s · pire clone ${r1(pire((w) => w.maxCloneMs))} ms`)
  }
} finally {
  stop()
}
