/**
 * SONDE JETABLE — l'animation du cerf (spec faune R26, « Et ça se VOIT »).
 *
 * Pilote le VRAI jeu (vite dev, debug armé) et photographie les quatre états que
 * `render/allure.ts` produit : les deux frames de marche, le bond de fuite EN
 * L'AIR (sprite décollé, ombre au sol atténuée — les deux MESURÉS en pixels),
 * la tête levée du broutage, et — bonus — la frame de lever.
 *
 * Recette du dépôt (skill verif-navigateur) :
 *   • le TP et l'heure passent par `sendAction` (debug armé sur DEV) ;
 *   • pour FIGER une image : `send({type:'pause'})` (le worker s'arrête) puis
 *     `game.loop.sleep()` — et on REPEINT par `game.step` avant la capture,
 *     sinon les pixels montrent l'état d'avant (leçon « debug empilé ») ;
 *   • `page.screenshot` seulement boucle endormie (SwiftShader, ~1 s/frame).
 *
 * Usage : node tools/probe-anim-cerf.mjs   (SMOKE_URL et SMOKE_OUT comme smoke.mjs)
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3164/'
const URL = BASE.includes('?') ? BASE : `${BASE}?solo`
const OUT = resolve(process.env.SMOKE_OUT ?? 'scratchpad/anim-cerf')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.error(`!! ERREUR DE PAGE : ${e.message}`))

// ── Les prises sur la page ──────────────────────────────────────────────────

/** Tout ce que la sonde lit d'un cerf : sa frame AFFICHÉE, sa position écran,
 *  et la géométrie sprite/ombre qui mesure le bond. */
const lister = () =>
  page.evaluate(() => {
    const sc = window.__BRAISES__.scene
    const cam = sc.cameras.main
    const BOISE = new Set([3, 13, 14, 22]) // forest, pine, larch, old_growth (balance.ts)
    const m0 = sc.map
    const out = []
    for (const m of sc.view.monsters ?? []) {
      if (m.type !== 'deer') continue
      const rec = sc.view.others.get(m.entityId)
      if (!rec) continue
      const b = rec.buffer[rec.buffer.length - 1]
      out.push({
        id: m.entityId,
        x: b.x, y: b.y,
        flee: m.fleeSince, susp: m.suspicion,
        key: rec.textureKey,
        sx: (rec.sprite.x - cam.worldView.x) * cam.zoom,
        sy: (rec.sprite.y - cam.worldView.y) * cam.zoom,
        lift: rec.shadow.y - rec.sprite.y,
        ombreAlpha: rec.shadow.alpha,
        // À DÉCOUVERT ? Une bête sous futaie se photographie sous sa canopée — la
        // capture ne montre alors pas ce qu'on juge. On préfère l'herbe nue.
        ouvert: !BOISE.has(m0.terrain[Math.floor(b.y) * m0.width + Math.floor(b.x)]),
      })
    }
    return { p: sc.registry.get('playerPos'), cerfs: out }
  })

const agir = (action) => page.evaluate((a) => window.__BRAISES__.scene.sendAction(a), action)

/** FIGER : le worker d'abord (plus de snapshots), la boucle ensuite. */
const geler = () =>
  page.evaluate(() => {
    const sc = window.__BRAISES__.scene
    sc.send({ type: 'pause' })
    sc.game.loop.sleep()
  })

const degeler = () =>
  page.evaluate(() => {
    const sc = window.__BRAISES__.scene
    sc.game.loop.wake()
    sc.send({ type: 'resume' })
  })

/** Repeindre N images à un t CONNU, boucle endormie — les pixels rejoignent l'état.
 *  ⚠ On CONTINUE L'HORLOGE DE LA SCÈNE, jamais `performance.now()` : boucle endormie,
 *  la scène est restée à T0 — sauter à l'heure murale enjamberait toute fenêtre en
 *  niveau (les 280 ms du lever, la tenue de tête). */
const repeindre = (n, dt) =>
  page.evaluate(({ n, dt }) => {
    const g = window.__BRAISES__.scene.game
    let t = g.loop.now ?? performance.now()
    for (let i = 0; i < n; i++) {
      t += dt
      g.step(t, dt)
    }
  }, { n, dt })

/** Capture un cadre autour d'un point écran (clampé au viewport). */
async function capturer(nom, sx, sy) {
  const w = 380
  const h = 300
  const x = Math.max(0, Math.min(1280 - w, Math.round(sx - w / 2)))
  const y = Math.max(0, Math.min(800 - h, Math.round(sy - h / 2)))
  await page.screenshot({ path: `${OUT}/${nom}.png`, clip: { x, y, width: w, height: h }, timeout: 90000 })
  console.log(`   📷 ${nom}.png (cadre ${w}×${h} @ ${x},${y})`)
}

/**
 * LE GROS PLAN D'UNE BÊTE FIGÉE : caméra recentrée sur elle, zoom 3, une image
 * d'un millimètre de temps pour repeindre (la fenêtre du lever n'en souffre pas),
 * capture serrée, puis la caméra rend la main (le follow la reprend au réveil).
 */
async function grosPlan(nom, id) {
  await page.evaluate(({ id, zoom }) => {
    const sc = window.__BRAISES__.scene
    const rec = sc.view.others.get(id)
    if (rec) {
      sc.cameras.main.setZoom(zoom)
      sc.cameras.main.centerOn(rec.sprite.x, rec.sprite.y - 8)
    }
  }, { id, zoom: 3 })
  await repeindre(1, 1)
  const s = (await lister()).cerfs.find((c) => c.id === id)
  if (s) {
    console.log(`      ${nom} : id=${id} clé=${s.key} monde=(${s.x.toFixed(1)},${s.y.toFixed(1)}) écran=(${s.sx.toFixed(0)},${s.sy.toFixed(0)}) ouvert=${s.ouvert}`)
    await capturer(nom, s.sx, s.sy)
    if (process.env.PLEIN_CADRE === '1') {
      await page.screenshot({ path: `${OUT}/${nom}-plein.png`, timeout: 90000 })
    }
  }
  await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(2))
  return s ?? null
}

/**
 * GELER D'ABORD, CHERCHER ENSUITE — jamais l'inverse. Chasser un état vivant puis
 * geler perdait la course à chaque fois (la tête tient 1,6 s, l'air d'un bond
 * ~0,3 s ; la latence poll→gel les mange). On fige le monde À UN INSTANT QUELCONQUE,
 * on repeint deux images (les pixels rejoignent l'état gelé), et on capture TOUT ce
 * qui manque dans l'état figé. Rend la table des relevés capturés.
 */
async function scanFige(cibles) {
  await geler()
  await repeindre(2, 120)
  const s = await lister()
  const pris = {}
  for (const [nom, cond] of Object.entries(cibles)) {
    // À DÉCOUVERT d'abord (une bête sous futaie se photographie sous sa canopée),
    // puis la plus proche du joueur — le sol est peint autour de lui.
    const candidats = s.cerfs
      .filter(cond)
      .sort((a, b) =>
        (b.ouvert ? 1 : 0) - (a.ouvert ? 1 : 0)
        || Math.hypot(a.x - s.p.x, a.y - s.p.y) - Math.hypot(b.x - s.p.x, b.y - s.p.y))
    const hit = candidats[0]
    if (hit) {
      const rel = await grosPlan(nom, hit.id)
      if (rel) pris[nom] = { ...hit, sx: rel.sx, sy: rel.sy }
    }
  }
  await degeler()
  return pris
}

// ── Le montage ──────────────────────────────────────────────────────────────

console.log(`→ ${URL}`)
for (let i = 0; ; i += 1) {
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 10000 })
    break
  } catch (e) {
    if (i >= 15) throw e
    await page.waitForTimeout(1000)
  }
}
// 180 s : machine sous charge (load ~6, autres sessions) — la garde à horloge murale
// rougit seule sinon (leçon « gate machine calme »).
await page.waitForFunction(() => window.__BRAISES__?.scene?.registry?.get('mapData'), null, { timeout: 180000 })
await page.waitForTimeout(1500)

await agir({ type: 'debug_god', on: true })
// LE CERF EST DIURNE (R10) : de nuit, il ne naît pas et il dort. Plein jour d'abord.
await agir({ type: 'debug_set_hour', hour: 10 })
await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(2))
await page.waitForTimeout(800)

// SON ADRESSE (R17/R23) : la faune vit aux COINS DE CHASSE — entre eux, la vallée
// est vide. On visite les coins du plus proche au plus loin, et on marche un peu
// à chaque fois : la faune naît HORS-CHAMP (R1), un guetteur immobile ne voit rien naître.
// `grounds` arrive avec le `ready` de l'hôte — l'ATTENDRE, pas le lire au vol :
// une lecture trop tôt a rendu « 0 coin » sur un monde qui en avait dix.
await page.waitForFunction(() => (window.__BRAISES__.scene.grounds ?? []).length > 0, null, { timeout: 30000 }).catch(() => {})
await page.waitForFunction(() => window.__BRAISES__.scene.registry.get('playerPos') !== undefined, null, { timeout: 30000 })
const coins = await page.evaluate(() => {
  const sc = window.__BRAISES__.scene
  const p = sc.registry.get('playerPos') ?? { x: 0, y: 0 }
  return (sc.grounds ?? [])
    .map((g) => ({ x: g.x, y: g.y, d: Math.hypot(g.x - p.x, g.y - p.y) }))
    .sort((a, b) => a.d - b.d)
})
console.log(`${coins.length} coin(s) de chasse sur la carte`)
let etat = await lister()
for (let c = 0; c < Math.min(coins.length, 6) && etat.cerfs.length === 0; c++) {
  await agir({ type: 'debug_teleport', x: coins[c].x, y: coins[c].y })
  await page.waitForTimeout(1200)
  for (let essai = 0; essai < 8 && etat.cerfs.length === 0; essai++) {
    await page.keyboard.down(essai % 2 === 0 ? 'KeyD' : 'KeyS')
    await page.waitForTimeout(1200)
    await page.keyboard.up(essai % 2 === 0 ? 'KeyD' : 'KeyS')
    await page.waitForTimeout(400)
    etat = await lister()
  }
  console.log(`   coin ${coins[c].x.toFixed(0)},${coins[c].y.toFixed(0)} : ${etat.cerfs.length} cerf(s)`)
}
if (etat.cerfs.length === 0) {
  const recensement = await page.evaluate(() => {
    const par = {}
    for (const m of window.__BRAISES__.scene.view.monsters ?? []) par[m.type] = (par[m.type] ?? 0) + 1
    return par
  })
  console.error(`!! aucun cerf aux coins visités — bêtes autour : ${JSON.stringify(recensement)}`)
  await browser.close()
  process.exit(1)
}
console.log(`${etat.cerfs.length} cerf(s) en vue — clés : ${etat.cerfs.map((c) => c.key).join(', ')}`)

// On se poste à 13 tuiles À L'EST du premier cerf (hors flightRange 9, dans le
// cadre au zoom 2 : 13 tuiles = 416 px d'écran) et on ne bouge plus.
const ancre = etat.cerfs[0]
await agir({ type: 'debug_teleport', x: ancre.x + 13, y: ancre.y })
await page.waitForTimeout(1500)

// ── Phase 1 : la marche (2 frames) et la tête levée — par scans figés ───────
// REPRENABLE : chaque capture déjà sur disque est acquise, un run tué se relance
// et ne refait que ce qui manque (leçon « smoke --dev : le HMR tue la prise »).
const deja = (nom) => existsSync(`${OUT}/${nom}.png`)
const mesure = (nom, rel) =>
  console.log(`   ✓ ${nom} — lift=${rel.lift.toFixed(1)} px, ombre α=${rel.ombreAlpha.toFixed(2)}`)
{
  const cibles = {}
  for (const cle of ['walk-0', 'walk-1', 'graze-tete', 'lever']) {
    if (!deja(`cerf-${cle}`)) cibles[`cerf-${cle}`] = (c) => c.key === `spr-deer-${cle}`
  }
  const t0 = Date.now()
  while (Object.keys(cibles).length > 0 && Date.now() - t0 < 120000) {
    const pris = await scanFige(cibles)
    for (const [nom, rel] of Object.entries(pris)) {
      mesure(nom, rel)
      delete cibles[nom]
    }
    if (Object.keys(cibles).length > 0) await page.waitForTimeout(1100)
  }
  const restent = Object.keys(cibles).filter((n) => n !== 'cerf-lever')
  if (restent.length > 0) console.log(`   (non vues en phase 1 : ${restent.join(', ')})`)
}

// ── Phase 2 : le bond de fuite — en l'air ET à l'appui, mesurés ─────────────
{
  const cibles = {}
  if (!deja('cerf-bond-air')) cibles['cerf-bond-air'] = (c) => c.key === 'spr-deer-flee' && c.lift > 5
  if (!deja('cerf-bond-appui')) cibles['cerf-bond-appui'] = (c) => c.key === 'spr-deer-flee-sol' && c.flee >= 0
  const t0 = Date.now()
  while (Object.keys(cibles).length > 0 && Date.now() - t0 < 150000) {
    // Personne ne fuit ? On saute SUR le plus proche : flightRange 9, à 3 tuiles il détale.
    const s = await lister()
    const fuyards = s.cerfs.filter((c) => c.flee >= 0)
    if (fuyards.length === 0) {
      const calmes = s.cerfs.filter((c) => c.flee < 0)
      if (calmes.length === 0) {
        console.log('   (plus un cerf en vue — la harde a été dispersée)')
        break
      }
      await agir({ type: 'debug_teleport', x: calmes[0].x + 3, y: calmes[0].y })
      await page.waitForTimeout(900)
      continue
    }
    const pris = await scanFige(cibles)
    for (const [nom, rel] of Object.entries(pris)) {
      mesure(nom, rel)
      delete cibles[nom]
    }
    if (Object.keys(cibles).length > 0) await page.waitForTimeout(400)
  }
  if (cibles['cerf-bond-air']) console.error("!! le bond en l'air n'a pas été photographié")
  else if (cibles['cerf-bond-appui']) console.log("   (l'appui n'a pas été photographié — fenêtre courte, l'air suffit au verdict)")
}

// ── Phase 3 (bonus) : la frame de lever, par le cadran ──────────────────────
if (!deja('cerf-lever')) {
  console.log('phase 3 : la nuit couche la harde, midi la lève — on guette la frame de lever')
  await agir({ type: 'debug_set_hour', hour: 3 })
  let unCouche = false
  const t0 = Date.now()
  while (!deja('cerf-lever') && Date.now() - t0 < 120000) {
    await page.waitForTimeout(1400)
    const s = await lister()
    unCouche = s.cerfs.some((c) => c.key === 'spr-deer-bed')
    if (unCouche) break
    // Au passage : un COUCHER en cours montre déjà la frame (le geste est symétrique).
    if (s.cerfs.some((c) => c.key === 'spr-deer-lever')) {
      const pris = await scanFige({ 'cerf-lever': (c) => c.key === 'spr-deer-lever' })
      if (pris['cerf-lever']) mesure('cerf-lever (au coucher)', pris['cerf-lever'])
    }
  }
  if (unCouche && !deja('cerf-lever')) {
    // Boucle endormie : midi arrive, la transition démarre — et on avance par pas
    // de 60 ms POUR RESTER DANS sa fenêtre de 280 ms. `repeindre` continue
    // l'horloge de la SCÈNE : sauter à l'heure murale enjamberait la fenêtre.
    await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
    await agir({ type: 'debug_set_hour', hour: 12 })
    await page.waitForTimeout(800) // les snapshots de midi arrivent
    await page.evaluate(() => window.__BRAISES__.scene.send({ type: 'pause' }))
    let vu = false
    for (let i = 0; i < 8 && !vu; i++) {
      await repeindre(1, 60)
      const s = await lister()
      const lev = s.cerfs
        .filter((c) => c.key === 'spr-deer-lever')
        .sort((a, b) => (b.ouvert ? 1 : 0) - (a.ouvert ? 1 : 0))[0]
      if (lev) {
        const rel = await grosPlan('cerf-lever', lev.id)
        if (rel) {
          mesure('cerf-lever (bed → debout, 280 ms en niveau)', lev)
          vu = true
        }
      } else if (i === 7) {
        console.log(`   clés au pas ${i} : ${s.cerfs.map((c) => c.key).join(', ')}`)
      }
    }
    if (!vu) console.log('   (frame de lever non vue — fenêtre de 280 ms, partie sans elle)')
    await degeler()
  }
}

await browser.close()
console.log(`\ncaptures → ${OUT}`)
