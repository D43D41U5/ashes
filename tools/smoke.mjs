/**
 * Smoke test navigateur — pilote le VRAI jeu et rapporte ce qu'il voit.
 *
 * Zéro dépendance hors du projet : Playwright est une devDependency du
 * workspace, et le navigateur vit sous `node_modules` (PLAYWRIGHT_BROWSERS_PATH=0,
 * posé par le script `pnpm smoke:install`). Aucun cache partagé, aucun autre dépôt.
 *
 * Usage :
 *   pnpm smoke                      # build + preview + scénario par défaut
 *   pnpm smoke --scenario lieux     # un scénario nommé (voir SCENARIOS)
 *   pnpm smoke --headed             # à l'œil, fenêtre ouverte
 *   pnpm smoke --dev                # contre le serveur de dev DOCKER (debug armé)
 *
 * Sans `--dev`, le script bâtit, sert et éteint son propre serveur : rien à
 * lancer à côté, rien à tuer après.
 *
 * Avec `--dev`, il vise le serveur de dev du projet — celui du conteneur, sur
 * http://ashes.test (docker compose : service `client` derrière Traefik — la route
 * du proxy partagé est `Host(ashes.test)` ; `ashes.localhost` est périmé). Le nom
 * ne résout pas hors du proxy : Chromium reçoit un --host-resolver-rules qui le
 * mappe sur 127.0.0.1, rien à ajouter dans /etc/hosts.
 * On ne lance PAS un `pnpm dev` local : le conteneur tourne en root et son
 * cache `.vite` (bind-monté) devient root-owned, ce qui fait échouer un `vite`
 * lancé côté hôte avec EACCES. Le conteneur doit donc être up :
 *     docker compose up -d client
 * Et si son HMR se corrompt (SyntaxError « does not provide an export named X »
 * alors que `pnpm check` passe — ce n'est PAS un bug de code) :
 *     docker compose exec -T client sh -c "rm -rf /app/node_modules/.vite" \
 *       && docker compose restart client
 *
 * Le jeu s'expose via `window.__BRAISES__.scene` (posé par WorldScene) : c'est
 * la seule porte d'entrée, et elle est volontairement étroite — le smoke test
 * LIT l'état, il ne le fabrique pas.
 *
 * NB — le mode debug (TP, heure, invulnérabilité) est armé sur `import.meta.env.DEV`
 * (voir worker/veillee.ts). Il est donc ÉTEINT dans un build de production : un
 * scénario qui a besoin de se téléporter doit passer par `--dev`. C'est voulu —
 * la sim de production n'obéit pas aux tricheurs.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Où atterrissent les captures. Paramétrable (SMOKE_OUT) : le dossier par défaut
// peut être verrouillé — le nôtre l'a été, écrit en ROOT par le conteneur de dev —
// et un outil de diagnostic qui ne peut plus rien écrire ne diagnostique rien.
const OUT = process.env.SMOKE_OUT ? resolve(process.env.SMOKE_OUT) : resolve(ROOT, 'scratchpad/smoke')
const PORT = 4173

const args = process.argv.slice(2)
const headed = args.includes('--headed')
const dev = args.includes('--dev')
const scenario = args[args.indexOf('--scenario') + 1] ?? 'default'
// `?solo` : le deep-link qui saute l'écran principal et démarre droit en Veillée
// (voir MenuScene). Sans lui, tous les scénarios resteraient bloqués sur le menu.
const BASE_URL = process.env.SMOKE_URL ?? (dev ? 'http://ashes.test/' : `http://localhost:${PORT}/`)
const URL = BASE_URL.includes('?') ? BASE_URL : `${BASE_URL}?solo`

mkdirSync(OUT, { recursive: true })

/**
 * Bâtit puis sert le jeu, et rend de quoi l'éteindre.
 * En `--dev`, on ne sert rien : le serveur de dev est celui du conteneur (cf. l'en-tête).
 */
async function serve() {
  if (dev) return () => {}

  await new Promise((ok, ko) => {
    const b = spawn('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore' })
    b.on('exit', (c) => (c === 0 ? ok() : ko(new Error(`pnpm build a échoué (${c})`))))
  })
  const srv = spawn(
    'pnpm',
    ['--filter', '@braises/client', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  )
  return () => {
    try {
      process.kill(-srv.pid) // le groupe entier : vite essaime
    } catch {
      /* déjà mort */
    }
  }
}

/** Ce que le jeu sait dire de lui-même, lu au registry (le HUD est la vitrine). */
const PROBE = () => {
  const reg = window.__BRAISES__.scene.registry
  const map = reg.get('mapData')
  return {
    tick: reg.get('debugInfo')?.tick ?? null,
    player: reg.get('playerPos'),
    knownPois: reg.get('knownPois') ?? [],
    pois: map.zones
      .map((z, poiId) => ({ poiId, kind: z.kind, name: z.name, x: z.x + z.w / 2, y: z.y + z.h / 2 }))
      .filter((z) => z.kind !== undefined),
    chronicle: reg.get('chronicle') ?? [],
  }
}

const SCENARIOS = {
  /**
   * T0-EXPLORATION (2026-07-25) — la Racine donne envie de marcher (spec t0-exploration).
   *
   * Ce qui ne se prouve qu'au navigateur : que les nouveautés SE VOIENT. On lit d'abord l'état
   * (map.seuils exposé, lieux nouveaux présents, sentes peintes), puis on va REGARDER : un seuil
   * et ses bornes, la rivière et un gué, le Bois Noir, le Cercle, la Combe et sa brume, la
   * lisière sud calcinée, la Tour de guet. Exige `--dev` (TP).
   */
  async t0(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1000)

    const etat = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const m = sc.map
      const compte = (k) => (m.zones ?? []).filter((z) => z.kind === k).length
      let routes = 0
      for (let i = 0; i < m.terrain.length; i += 7) if (m.terrain[i] === 2) routes++
      return {
        seuils: (m.seuils ?? []).length,
        borneTex: sc.textures?.exists?.('seuil-borne') ?? false,
        borneBrisee: sc.textures?.exists?.('seuil-borne-brisee') ?? false,
        tour: compte('tour_guet'), pierres: compte('pierre_levee'), cercle: compte('cercle_pierres'),
        bois: compte('bois_noir'), combe: compte('combe_brumeuse'),
        fermes: compte('ferme_ruinee'), charrettes: compte('charrette'),
        gues: (m.zones ?? []).filter((z) => z.name === 'le Gué').length,
        routesEchantillon: routes, // 1 tuile sur 7 : l'ordre de grandeur suffit
      }
    })
    console.log(`état : ${JSON.stringify(etat)}`)
    if (etat.seuils === 0) console.error('!! map.seuils est VIDE — les bornes n\'ont rien à annoncer')
    if (!etat.borneTex || !etat.borneBrisee) console.error('!! les textures de borne manquent')
    if (etat.tour !== 1 || etat.cercle !== 1 || etat.bois !== 1 || etat.combe !== 1) {
      console.error('!! il manque un repère ou un set-piece unique')
    }
    if (etat.gues < 2) console.error(`!! ${etat.gues} gué(s) — la rivière est un goulot`)
    if (etat.routesEchantillon === 0) console.error('!! aucune sente sur la carte')

    // Plein jour, puis on va REGARDER chaque nouveauté.
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)
    const viser = async (nom, x, y) => {
      await page.evaluate(({ x: px, y: py }) => {
        window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py })
      }, { x, y })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/t0-${nom}.png` })
      console.log(`   → ${nom} @(${Math.round(x)}, ${Math.round(y)})`)
    }
    const cibles = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const centre = (k) => {
        const z = (m.zones ?? []).find((q) => q.kind === k)
        return z ? { x: z.x + z.w / 2, y: z.y + z.h / 2 } : null
      }
      const gue = (m.zones ?? []).find((q) => q.name === 'le Gué')
      // Le seuil le plus proche du Bois Noir, pour voir des bornes ENTIÈRES (pas un secours).
      const s = (m.seuils ?? []).find((q) => !q.secours) ?? (m.seuils ?? [])[0]
      return {
        seuil: s ? { x: s.x, y: s.y } : null,
        gue: gue ? { x: gue.x + 3.5, y: gue.y + 3.5 } : null,
        bois: centre('bois_noir'), cercle: centre('cercle_pierres'), combe: centre('combe_brumeuse'),
        tour: centre('tour_guet'), ferme: centre('ferme_ruinee'),
      }
    })
    if (cibles.seuil) await viser('seuil-bornes', cibles.seuil.x, cibles.seuil.y)
    if (cibles.gue) await viser('gue', cibles.gue.x, cibles.gue.y)
    if (cibles.bois) await viser('bois-noir', cibles.bois.x, cibles.bois.y)
    if (cibles.cercle) await viser('cercle', cibles.cercle.x, cibles.cercle.y)
    if (cibles.combe) await viser('combe', cibles.combe.x, cibles.combe.y)
    if (cibles.tour) await viser('tour-guet', cibles.tour.x, cibles.tour.y)
    if (cibles.ferme) await viser('ferme', cibles.ferme.x, cibles.ferme.y)
    // La lisière sud : au bord de la Racine, côté Cendrière (le gradient + la braise du front).
    const sud = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const g = (m.zones ?? []).find((q) => q.kind === 'bois_noir')
      return g ? { x: g.x + 20 } : { x: 700 }
    })
    const racineSud = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      // La dernière rangée d'herbe/lande avant le mur sud de la Racine : on balaie depuis le bas.
      const defs = m.zoneDefs ?? []
      const idRacine = defs.findIndex((d) => d.slug === 'pres_bas')
      const cols = Math.ceil(m.width / m.zonePas)
      let best = null
      for (let j = Math.ceil(m.height / m.zonePas) - 1; j >= 0 && !best; j--) {
        for (let i = 0; i < cols; i++) {
          if (m.zoneGrid[j * cols + i] === idRacine) { best = { x: i * m.zonePas, y: j * m.zonePas }; break }
        }
      }
      return best
    })
    if (racineSud) await viser('lisiere-sud', sud.x, racineSud.y - 6)
    // L'ONGLET CARTE : la rivière, les sentes et la lisière doivent se lire aussi SUR LA CARTE
    // (le bake `map-demo` sert aux deux — si ça se voit ici, c'est cuit pareil au sol).
    await page.keyboard.press('m')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/t0-carte.png` })
    await page.keyboard.press('m')
    console.log(`captures → ${OUT}/t0-*.png`)
    return etat
  },

  /**
   * LE FEELING (spec da-feeling, 2026-07-25) — eau lisible, brume du matin, aube qui chante.
   *
   * Ce qui ne se prouve qu'au navigateur : A4 (le gué contraste ≥ 1,4:1 EN LUMINANCE — mesuré
   * en projetant des tuiles connues profond/haut-fond sur la capture), A5 (les remous d'un
   * marcheur — capture à REGARDER), A6 (la brume à 5h30/6h/8h : visible sur l'eau ; à 12h :
   * rien), A7 (la sonde `aube.chirps` compte dans la fenêtre, se tait dehors). Exige `--dev`.
   */
  async feeling(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1000)

    const gue = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const g = (m.zones ?? []).find((z) => z.name === 'le Gué')
      return g ? { x: g.x + 3.5, y: g.y + 3.5 } : null
    })
    if (!gue) { console.error('!! aucun Gué sur cette carte'); return }

    const heure = async (h) => {
      // TÊTU : le protocole ne porte qu'UNE action par input — un envoi peut se faire manger.
      // On renvoie jusqu'à ce que l'heure LUE colle (mesuré : un set_hour(12) perdu laissait
      // la brume de 8h sous l'étiquette « midi »).
      for (let essai = 0; essai < 4; essai++) {
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), h)
        await page.waitForTimeout(600)
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
        if (Math.abs(lu - h) < 0.3) return
      }
      console.error(`!! set_hour(${h}) n'a jamais pris`)
    }
    const tp = async (x, y) => {
      await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: x, py: y })
      await page.waitForTimeout(1400)
    }

    // ── A4 : le contraste du gué, en pleine lumière ──
    await tp(gue.x, gue.y)
    await heure(11)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/feeling-gue-jour.png` })
    const contraste = await page.evaluate(async () => {
      const sc = window.__BRAISES__.scene
      const m = sc.map
      const cam = sc.cameras.main
      // Des tuiles profond/haut-fond DANS la vue, projetées en pixels écran.
      const vis = { x0: cam.worldView.x / 16 + 2, y0: cam.worldView.y / 16 + 2, x1: (cam.worldView.x + cam.worldView.width) / 16 - 2, y1: (cam.worldView.y + cam.worldView.height) / 16 - 2 }
      const deeps = []
      const shallows = []
      const terr = (tx, ty) => m.terrain[ty * m.width + tx]
      const entoure = (tx, ty, ok) => ok(terr(tx + 1, ty)) && ok(terr(tx - 1, ty)) && ok(terr(tx, ty + 1)) && ok(terr(tx, ty - 1))
      for (let ty = Math.ceil(vis.y0); ty < vis.y1 && (deeps.length < 40 || shallows.length < 40); ty++) {
        for (let tx = Math.ceil(vis.x0); tx < vis.x1; tx++) {
          const t = terr(tx, ty)
          // HORS BERGE : le profond au cœur du profond, le haut-fond au cœur de l'eau — l'écume
          // de rive et les transitions fausseraient la mesure (c'est le CORPS des deux eaux qu'on juge).
          if (t === 6 && deeps.length < 40 && entoure(tx, ty, (q) => q === 6)) deeps.push([tx, ty])
          else if (t === 4 && shallows.length < 40 && entoure(tx, ty, (q) => q === 4)) shallows.push([tx, ty])
        }
      }
      // CINQ captures espacées, moyennées (3 → 5, revue eau-vivante : avec 17 tuiles
      // toutes-profondes dans la vue, 3 instantanés laissaient ±0,06 de bruit inter-run
      // sur un seuil tenu à +0,05 — le gate claquait au faux rouge ~1 run sur 25) : le
      // clapot postérisé bruite, on mesure l'EAU, pas la phase de sa houle. Les alphas
      // 1, 1/2, 1/3, 1/4, 1/5 composent une moyenne équipondérée des cinq.
      const shots = []
      for (let k = 0; k < 5; k++) {
        shots.push(await new Promise((ok) => sc.game.renderer.snapshot((img) => ok(img))))
        await new Promise((ok) => setTimeout(ok, 300))
      }
      const cv = document.createElement('canvas')
      cv.width = shots[0].width; cv.height = shots[0].height
      // `willReadFrequently` : la sonde `lum` fait jusqu'à 80 relectures 1×1 sur CE canvas —
      // sans le drapeau, chacune est un aller-retour GPU→CPU (et Chrome le dit en console).
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      for (let k = 0; k < 5; k++) {
        ctx.globalAlpha = 1 / (k + 1)
        ctx.drawImage(shots[k], 0, 0)
      }
      ctx.globalAlpha = 1
      const shot = shots[0]
      const lum = (pts) => {
        let somme = 0, n = 0
        for (const [tx, ty] of pts) {
          // Projection SIMPLE : fraction de la vue → fraction du snapshot.
          const fx = ((tx + 0.5) * 16 - cam.worldView.x) / cam.worldView.width
          const fy = ((ty + 0.5) * 16 - cam.worldView.y) / cam.worldView.height
          if (fx < 0 || fx > 1 || fy < 0 || fy > 1) continue
          const px = ctx.getImageData(Math.round(fx * shot.width), Math.round(fy * shot.height), 1, 1).data
          somme += 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]
          n++
        }
        return n ? somme / n : 0
      }
      const ld = lum(deeps)
      const ls = lum(shallows)
      return { deep: Math.round(ld), shallow: Math.round(ls), nD: deeps.length, nS: shallows.length, ratio: +(Math.max(ld, ls) / Math.max(1, Math.min(ld, ls))).toFixed(2) }
    })
    console.log(`A4 — gué : profond ${contraste.deep} vs haut-fond ${contraste.shallow} (n=${contraste.nD}/${contraste.nS}) → ${contraste.ratio}:1 ${contraste.ratio >= 1.4 ? '✓' : '✗ (< 1,4)'}`)

    // ── A5 : les remous — sondés PAR L'ÉTAT (lastWaderCount), puis regardés ──
    // La sonde échantillonne EN BOUCLE pendant la marche et garde le MAX (revue eau-vivante :
    // le point unique à 900 ms ratait le marcheur — l'horloge headless va ~12× trop vite,
    // l'avatar bute au mur du profond et la force meurt AVANT la lecture ; 2 rouges sur 3).
    await page.waitForTimeout(1200) // immobile depuis le TP : le remous doit être mort
    const wImmobile = await page.evaluate(() => window.__BRAISES__.scene.lastWaderCount)
    let wMarche = 0
    await page.keyboard.down('KeyA')
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(160)
      const w = await page.evaluate(() => window.__BRAISES__.scene.lastWaderCount)
      wMarche = Math.max(wMarche, w)
    }
    await page.screenshot({ path: `${OUT}/feeling-remous.png` })
    await page.keyboard.up('KeyA')
    await page.waitForTimeout(1100) // l'extinction fait 0,7 s
    const wArret = await page.evaluate(() => window.__BRAISES__.scene.lastWaderCount)
    console.log(`A5 — remous : immobile ${wImmobile} ${wImmobile === 0 ? '✓' : '✗'} · en marche (max) ${wMarche} ${wMarche >= 1 ? '✓' : '✗'} · 1,1 s après l'arrêt ${wArret} ${wArret === 0 ? '✓' : '✗'}`)

    // ── A6 : la brume, aux quatre heures qui la racontent ──
    for (const [h, nom] of [[5.5, '0530'], [6, '0600'], [8, '0800'], [12, '1200']]) {
      await heure(h)
      await page.waitForTimeout(800)
      const brume = await page.evaluate(() => {
        const mm = window.__BRAISES__.scene.morningMist
        const ly = mm?.layer
        const lu = window.__BRAISES__.scene.lastTime?.hourOfCycle
        return ly?.shader ? { h: +(lu ?? -1).toFixed(2), visible: ly.shader.visible, densite: +ly.density.toFixed(3) } : null
      })
      await page.screenshot({ path: `${OUT}/feeling-brume-${nom}.png` })
      console.log(`A6 — ${h}h : brume ${JSON.stringify(brume)}`)
      if (h === 6 && (!brume || !brume.visible || brume.densite < 0.1)) console.error('!! la brume de 6h est invisible')
      if (h === 12 && brume?.visible) console.error('!! il reste de la brume à midi')
    }

    // ── A7 : les oiseaux comptent à l'aube, se taisent à midi ──
    await heure(6)
    const c0 = await page.evaluate(() => window.__BRAISES__.scene.aube.chirps)
    await page.waitForTimeout(5000)
    const c1 = await page.evaluate(() => window.__BRAISES__.scene.aube.chirps)
    await heure(12)
    await page.waitForTimeout(600) // l'heure s'installe AVANT la base de mesure (sinon course)
    const c15 = await page.evaluate(() => window.__BRAISES__.scene.aube.chirps)
    await page.waitForTimeout(3000)
    const c2 = await page.evaluate(() => window.__BRAISES__.scene.aube.chirps)
    console.log(`A7 — pépiements : aube +${c1 - c0} en 5 s ${c1 > c0 ? '✓' : '✗'} · midi +${c2 - c15} en 3 s ${c2 === c15 ? '✓' : '✗'}`)
    console.log(`captures → ${OUT}/feeling-*.png`)
    return { contraste }
  },

  /**
   * LA MARÉE DE L'AUBE (brume V1+V2, choix d'Alexis du 2026-07-26) — le front mesuré, les
   * bancs comptés, et les captures qui se REGARDENT.
   *
   * Sondes d'état (le smoke LIT, il ne fabrique pas) : `morningMist.layer.front` doit suivre
   * `frontDeBrume(h)` (montée 4h30→6h, étale, retrait →8h30, zéro à midi) ; `mistBanks.bancs`
   * doit compter ≥ 1 banc près de la rivière dans la fenêtre, 0 à midi. Exige `--dev`.
   */
  async maree(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1000)

    const gue = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const g = (m.zones ?? []).find((z) => z.name === 'le Gué')
      return g ? { x: g.x + 3.5, y: g.y + 3.5 } : null
    })
    if (!gue) { console.error('!! aucun Gué sur cette carte'); return }
    await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: gue.x, py: gue.y })
    await page.waitForTimeout(1400)

    const heure = async (h) => {
      for (let essai = 0; essai < 4; essai++) {
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), h)
        await page.waitForTimeout(600)
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
        if (Math.abs(lu - h) < 0.3) return
      }
      console.error(`!! set_hour(${h}) n'a jamais pris`)
    }

    // Le front ATTENDU à chaque heure sondée (copie de frontDeBrume — 9 tuiles au max) :
    const attendu = { 5: 3, 6.2: 9, 7.6: 4.76, 12: 0 }
    let bancsVus = 0
    for (const [h, nom] of [[5, '0500'], [6.2, '0612'], [7.6, '0736'], [12, '1200']]) {
      await heure(h)
      // On laisse VIVRE : les bancs naissent au compte-gouttes (un contrôle par 700 ms).
      await page.waitForTimeout(h === 12 ? 1200 : 4500)
      const sonde = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const ly = sc.morningMist?.layer
        return {
          h: +(sc.lastTime?.hourOfCycle ?? -1).toFixed(2),
          front: ly ? +ly.front.toFixed(2) : null,
          densite: ly ? +ly.density.toFixed(3) : null,
          visible: ly?.shader?.visible ?? null,
          bancs: sc.mistBanks?.bancs?.length ?? -1,
        }
      })
      await page.screenshot({ path: `${OUT}/maree-${nom}.png` })
      const cible = attendu[h]
      // L'heure du jeu AVANCE entre le set_hour et la sonde : on juge le front CONTRE l'heure
      // LUE, à la tolérance de la pente la plus raide (6 tuiles/h de jeu × la dérive lue).
      const derive = Math.abs(sonde.h - h)
      const tolerance = 0.6 + derive * 6.5
      const ecart = sonde.front === null ? Infinity : Math.abs(sonde.front - cible)
      console.log(`maree — ${h}h : ${JSON.stringify(sonde)} (front attendu ${cible} ± ${tolerance.toFixed(1)})`)
      // UNE SONDE DÉBRANCHÉE N'EST PAS UN ZÉRO (revue : un champ privé renommé cassait tout
      // en silence) : -1/null = le harnais ne lit plus l'état, c'est une erreur à part entière.
      if (sonde.bancs === -1 || sonde.visible === null || sonde.densite === null)
        console.error('!! sonde brume débranchée (champ privé renommé ? morningMist/mistBanks absents ?)')
      if (ecart > tolerance) console.error(`!! front hors marée à ${h}h : ${sonde.front} pour ${cible} attendu`)
      if (h !== 12 && sonde.front > 3 && (sonde.densite ?? 0) < 0.2)
        console.error(`!! densité anémique à ${h}h (${sonde.densite}) alors que la marée est à ${sonde.front} tuiles`)
      if (h === 12 && sonde.visible) console.error('!! il reste de la brume à midi')
      if (h === 12 && (sonde.densite ?? 0) > 0) console.error(`!! densité non nulle à midi (${sonde.densite})`)
      if (h === 12 && sonde.bancs > 0) console.error(`!! ${sonde.bancs} banc(s) encore vivants à midi`)
      if (h !== 12) bancsVus = Math.max(bancsVus, sonde.bancs)
    }
    console.log(`maree — bancs voyageurs : maximum vu ${bancsVus} ${bancsVus >= 1 ? '✓' : '✗'}`)
    if (bancsVus < 1) console.error('!! aucun banc voyageur né près de la rivière dans toute la fenêtre')
    console.log(`captures → ${OUT}/maree-*.png — à REGARDER (le front qui monte, les bancs, le retrait)`)
    return { bancsVus }
  },

  /**
   * LA BLANCHEUR DE LA BRUME — combien de blanc chaque brume AJOUTE au monde, et laquelle.
   *
   * Instrument né du retour d'Alexis du 2026-07-26 (« augmente la transparence des parties les
   * plus blanches ») : une plainte sur le blanc ne se règle qu'avec un nombre. On ne lit pas la
   * luminance de la frame — le sol de l'aube et le voile de l'heure la portent autant que la
   * nappe. On mesure la CONTRIBUTION PROPRE de chaque calque : on l'ÉTEINT sur la même scène,
   * au même cadrage, et on lit l'ÉCART.
   *
   *   • station GUÉ à 6h12 (pleine marée) : tout → sans les bancs → sans rien ;
   *   • station COMBE à midi (la marée est morte, les bancs aussi) : la brume permanente seule.
   *     C'est le TÉMOIN de non-régression — elle partage le shader `mist-layer` mais garde SES
   *     réglages : toute retouche des crans de la matinale doit la laisser au même chiffre.
   *
   * Le seuil ABSOLU de blanc ne discrimine pas : mesuré le 26/07, la marée de 6h12 plafonne à
   * ~183 de luminance (l'aube est sombre, `eclat = sqrt(uDay)` retient la nappe) — zéro pixel
   * au-dessus de 190, brume ou pas. Ce qu'on lit est donc l'ÉCART PIXEL À PIXEL entre la frame
   * avec et la frame sans : `lum_avec − lum_sans = a·(teinte − fond)`, c'est-à-dire l'opacité
   * de la nappe, là où elle est. Son p99 EST « la partie la plus blanche ».
   *
   * Et l'écart se juge contre un PLANCHER DE BRUIT : deux frames prises à 400 ms d'intervalle
   * avec la MÊME brume (l'eau clapote, la nappe dérive, les feuilles bougent). Un effet plus
   * petit que ce plancher n'est pas un effet. Exige `--dev`.
   *
   * NB — éteindre un calque se fait par `destroy()` : c'est SANS RETOUR pour la page. D'où le
   * `goto` qui recharge le monde entre la station du Gué et celle de la Combe. Toute station
   * ajoutée ici doit recharger de même, ou mesurer un monde déjà amputé.
   *
   * BALAYAGE (`BRUME_SWEEP="0,34/0,46/0,56  0,34/0,42/0,50"`, triplets mince/corps/crête) : les
   * crans de la marée sont lus à chaque frame, donc on peut poser plusieurs candidats sur LA
   * MÊME scène et les mesurer tous contre LE MÊME monde nu — c'est ainsi qu'on tranche un
   * « encore plus transparent » sans rejouer le monde entre deux essais. Le rail suit le pic
   * du candidat (+0,03). Une capture par candidat, à REGARDER.
   */
  async blancheur(page) {
    if (!dev) {
      console.log("\n(la blancheur exige le mode debug pour régler l'heure — relancer avec --dev)")
      return {}
    }

    /** Capture une frame, garde sa luminance (Rec. 709, pixels du MONDE — le HUD est exclu)
     *  sous `window.__blanc[nom]` pour les écarts, et rend ses percentiles. */
    const capture = (nom) =>
      page.evaluate(async (n) => {
        const s = window.__BRAISES__.scene
        const img = await new Promise((ok) => s.game.renderer.snapshot((i) => ok(i)))
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        const larg = c.width >> 1
        const haut = (c.height - 140) >> 1
        const lum = new Float32Array(larg * haut)
        for (let y = 0; y < haut; y++) {
          for (let x = 0; x < larg; x++) {
            const i = (y * 2 * c.width + x * 2) * 4
            lum[y * larg + x] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
          }
        }
        window.__blanc = window.__blanc ?? {}
        window.__blanc[n] = lum
        const tri = Array.from(lum).sort((a, b) => a - b)
        const pc = (q) => Math.round(tri[Math.floor(q * (tri.length - 1))] * 100) / 100
        const moy = Math.round((tri.reduce((a, b) => a + b, 0) / tri.length) * 100) / 100
        return { moy, p50: pc(0.5), p90: pc(0.9), p99: pc(0.99), p999: pc(0.999), max: pc(1) }
      }, nom)

    /** L'écart pixel à pixel entre deux captures : ce que le calque éteint AJOUTAIT. */
    const ecart = (a, b) =>
      page.evaluate(([na, nb]) => {
        const A = window.__blanc[na]
        const B = window.__blanc[nb]
        const d = new Float32Array(A.length)
        for (let i = 0; i < A.length; i++) d[i] = A[i] - B[i]
        const tri = Array.from(d).sort((x, y) => x - y)
        const pc = (q) => Math.round(tri[Math.floor(q * (tri.length - 1))] * 100) / 100
        const part = (seuil) => Math.round((tri.filter((v) => v >= seuil).length / tri.length) * 10000) / 100
        return {
          moy: Math.round((tri.reduce((x, y) => x + y, 0) / tri.length) * 100) / 100,
          p50: pc(0.5),
          p90: pc(0.9),
          p99: pc(0.99),
          p999: pc(0.999),
          max: pc(1),
          sup40: part(40),
          sup60: part(60),
        }
      }, [a, b])

    const heure = async (h) => {
      for (let essai = 0; essai < 4; essai++) {
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), h)
        await page.waitForTimeout(600)
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
        if (Math.abs(lu - h) < 0.3) return
      }
      console.error(`!! set_hour(${h}) n'a jamais pris`)
    }
    const tp = async (x, y) => {
      await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: x, py: y })
      await page.waitForTimeout(1400)
    }
    /** La zone brute (x,y,w,h) — le cadrage se décide ici, pas dans une fonction lointaine. */
    const zone = async (cle) =>
      page.evaluate((k) => {
        const z = (window.__BRAISES__.scene.map.zones ?? []).find((z) => z.kind === k || z.name === k)
        return z ? { x: z.x, y: z.y, w: z.w, h: z.h } : null
      }, cle)

    const out = {}

    // ── STATION GUÉ, 6h12 : la pleine marée (même cadrage que le scénario `maree`) ──
    const gue = await zone('le Gué')
    if (!gue) {
      console.error('!! aucun Gué sur cette carte')
      return {}
    }
    await tp(gue.x + 3.5, gue.y + 3.5)
    await heure(6.2)
    await page.waitForTimeout(4500) // les bancs naissent au compte-gouttes
    await page.screenshot({ path: `${OUT}/blancheur-gue-avec.png` })
    // Les BANCS voyageurs sont un autre objet (sprites bakés, leurs propres crans) : on les
    // éteint AVANT de mesurer — ce qu'on règle ici est la nappe de la marée, elle seule.
    const bancs = await page.evaluate(() => {
      const n = window.__BRAISES__.scene.mistBanks?.bancs?.length ?? -1
      window.__BRAISES__.scene.mistBanks?.destroy()
      return n
    })
    await page.waitForTimeout(600)
    out.gueA = await capture('gueA')
    await page.waitForTimeout(400)
    out.gueB = await capture('gueB') // même brume, 400 ms plus tard → le plancher de bruit

    // ── BALAYAGE : d'autres crans, sur la MÊME scène (les uniformes sont relus par frame) ──
    const candidats = (process.env.BRUME_SWEEP ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/,/g, '.').split('/').map(Number))
      .filter((p) => p.length === 3 && p.every((v) => Number.isFinite(v)))
    const poidsCourants = await page.evaluate(() => window.__BRAISES__.scene.morningMist?.layer?.crans?.poids ?? null)
    for (let k = 0; k < candidats.length; k++) {
      const poids = candidats[k]
      await page.evaluate(
        ({ p }) => {
          const ly = window.__BRAISES__.scene.morningMist?.layer
          if (ly) ly.crans = { poids: p, plafond: Math.round((0.38 * 2.2 * p[2] + 0.03) * 1000) / 1000 }
        },
        { p: poids },
      )
      // L'HEURE SE REMET À L'HEURE entre deux candidats : l'horloge du jeu avance pendant le
      // balayage (mesuré : le monde nu gagnait ~8 niveaux de µ en une poignée de secondes) et
      // un fond plus clair rend TOUTE nappe plus discrète — le dernier candidat aurait gagné
      // par le lever du jour, pas par ses crans. Répéter le réglage courant en fin de liste
      // donne le résidu : deux lignes identiques doivent rendre deux fois le même chiffre.
      await heure(6.2)
      await page.waitForTimeout(1200) // le fondu d'air met ~0,9 s à se poser
      await page.screenshot({ path: `${OUT}/blancheur-sweep-${k + 1}.png` })
      await capture(`sweep${k}`)
    }
    await heure(6.2)
    await page.waitForTimeout(1200)

    await page.evaluate(() => window.__BRAISES__.scene.morningMist?.destroy())
    await page.waitForTimeout(400)
    out.gueSans = await capture('gueSans')
    await page.screenshot({ path: `${OUT}/blancheur-gue-sans.png` })
    out.bruitGue = await ecart('gueA', 'gueB')
    out.maree = await ecart('gueB', 'gueSans')
    out.sweep = []
    for (let k = 0; k < candidats.length; k++) out.sweep.push({ poids: candidats[k], ...(await ecart(`sweep${k}`, 'gueSans')) })

    // ── STATION COMBE, midi : la brume permanente, seule au monde (TÉMOIN) ──
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    const combe = await zone('combe_brumeuse')
    if (combe) {
      await tp(combe.x + combe.w / 2, combe.y + combe.h / 2)
      await heure(12)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/blancheur-combe-avec.png` })
      out.combeA = await capture('combeA')
      await page.waitForTimeout(400)
      out.combeB = await capture('combeB')
      await page.evaluate(() => window.__BRAISES__.scene.combeMist?.destroy())
      await page.waitForTimeout(400)
      out.combeSans = await capture('combeSans')
      await page.screenshot({ path: `${OUT}/blancheur-combe-sans.png` })
      out.bruitCombe = await ecart('combeA', 'combeB')
      out.combe = await ecart('combeB', 'combeSans')
    } else console.error('!! aucune Combe brumeuse sur cette carte')

    const col = (v) => String(v).padStart(8)
    console.log(`\n  (${bancs} banc(s) voyageur(s) vivants avant la mesure du Gué — éteints pour mesurer la marée seule)`)
    console.log('\n  LUMINANCE de la frame        µ     p50     p90     p99   p99,9     max')
    const lig = (nom, m) => console.log(`  ${nom.padEnd(24)}${col(m.moy)}${col(m.p50)}${col(m.p90)}${col(m.p99)}${col(m.p999)}${col(m.max)}`)
    lig('gué 6h12 — avec marée', out.gueB)
    lig('gué 6h12 — sans', out.gueSans)
    if (out.combeB) {
      lig('combe 12h — avec brume', out.combeB)
      lig('combe 12h — sans', out.combeSans)
    }
    console.log("\n  ÉCART pixel à pixel (l'opacité de la nappe, en niveaux de luminance)")
    console.log('                                               µ     p50     p90     p99   p99,9     max    >40%    >60%')
    const ligE = (nom, m) =>
      console.log(`  ${nom.padEnd(40)}${col(m.moy)}${col(m.p50)}${col(m.p90)}${col(m.p99)}${col(m.p999)}${col(m.max)}${col(m.sup40)}${col(m.sup60)}`)
    ligE('gué — bruit (témoin)', out.bruitGue)
    ligE(`gué — LA MARÉE ${poidsCourants ? `[${poidsCourants.join('/')}]` : ''}`.trim(), out.maree)
    for (const s of out.sweep) ligE(`gué — candidat [${s.poids.join('/')}]`, s)
    if (out.combe) {
      ligE('combe — bruit (témoin)', out.bruitCombe)
      ligE('combe — brume du lieu', out.combe)
    }
    console.log(
      `\n  LES PARTIES LES PLUS BLANCHES de la marée : p99 = ${out.maree.p99} niveaux ajoutés ` +
        `(plancher de bruit p99 = ${out.bruitGue.p99}) · ${out.maree.sup60} % de l'écran au-dessus de +60`,
    )
    if (out.combe)
      console.log(`  TÉMOIN Combe (ne doit PAS bouger) : p99 = ${out.combe.p99} · >60 ${out.combe.sup60} %`)
    console.log(`\n  captures → ${OUT}/blancheur-*.png`)
    return out
  },

  /**
   * L'EAU VIVANTE (spec eau-vivante, chantier du 2026-07-26) — les sondes des dix gestes.
   *
   * Le smoke LIT l'état : l'immersion (crop du sprite dans l'eau, zéro sur terre), la gerbe
   * et les traces (compteurs), les poissons (population + fuite), les feuilles (courant),
   * les reflets (pool), le contraste du gué (A2 : la berge ne l'a pas cassé). Les captures
   * se REGARDENT. Exige `--dev`.
   */
  async 'eau-vivante'(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1000)
    const gue = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const g = (m.zones ?? []).find((z) => z.name === 'le Gué')
      return g ? { x: g.x + 4.5, y: g.y + 2.5 } : null
    })
    if (!gue) { console.error('!! aucun Gué sur cette carte'); return }
    const tp = async (x, y) => {
      await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: x, py: y })
      await page.waitForTimeout(1400)
    }
    const heure = async (h) => {
      for (let essai = 0; essai < 4; essai++) {
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), h)
        await page.waitForTimeout(600)
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
        if (Math.abs(lu - h) < 0.3) return
      }
      console.error(`!! set_hour(${h}) n'a jamais pris`)
    }

    // ── L'IMMERSION + LES REFLETS : dans l'eau, coupé et reflété ; état sondé ──
    await tp(gue.x, gue.y)
    await heure(11)
    await page.waitForTimeout(900)
    const dansLEau = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      return {
        crop: sc.playerSprite.isCropped,
        ombre: sc.playerSprite.getData('shadow')?.alpha ?? -1,
        anneau: sc.playerSprite.getData('flottaison')?.visible ?? false,
        reflets: sc.reflets?.vivants ?? -1,
      }
    })
    console.log(`eau — immersion : ${JSON.stringify(dansLEau)}`)
    if (!dansLEau.crop) console.error('!! le sprite n’est pas coupé dans l’eau (immersion morte)')
    if (dansLEau.ombre > 0.05) console.error(`!! l’ombre de contact flotte sur l’eau (alpha ${dansLEau.ombre})`)
    if (!dansLEau.anneau) console.error('!! pas d’anneau de flottaison')
    if (dansLEau.reflets < 1) console.error('!! aucun reflet vivant dans l’eau')
    await page.screenshot({ path: `${OUT}/eau-immersion.png` })

    // ── LA VIE : poissons (population + distance) et feuilles (courant) ──
    await page.waitForTimeout(6000)
    const vie = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const p = sc.predicted
      return {
        poissons: sc.poissons?.vivants ?? -1,
        dMin: p && sc.poissons ? +sc.poissons.distanceMin(p.x, p.y).toFixed(2) : null,
        feuilles: sc.feuilles?.vivantes ?? -1,
        fil: (sc.map.fil ?? []).length,
      }
    })
    console.log(`eau — vie : ${JSON.stringify(vie)}`)
    if (vie.poissons < 1) console.error('!! aucun poisson-ombre né en 7 s près de la rivière')
    if (vie.dMin !== null && vie.dMin < 1.2) console.error(`!! un poisson n’a pas fui (d ${vie.dMin} < 1,2 t)`)
    if (vie.fil < 2) console.error('!! map.fil absent ou vide — le courant n’existe pas')
    if (vie.feuilles < 1) console.error('!! aucune feuille au fil de l’eau en 7 s')
    // A9 : la feuille avance vers l'AVAL — déplacement projeté sur le courant local > 0
    // (revue : sans cette sonde, un courant INVERSÉ passerait vert).
    const aval = await page.evaluate(async () => {
      const f = window.__BRAISES__.scene.feuilles
      if (!f || f.vivantes < 1) return null
      const avant = f.feuilles.map((x) => ({ x: x.x, y: x.y }))
      await new Promise((ok) => setTimeout(ok, 1200))
      let somme = 0
      let n = 0
      for (let i = 0; i < Math.min(avant.length, f.feuilles.length); i++) {
        const a = avant[i]
        const b = f.feuilles[i]
        const c = f.courantEn(a.x, a.y)
        if (!c) continue
        somme += (b.x - a.x) * c.x + (b.y - a.y) * c.y
        n++
      }
      return n > 0 ? +(somme / n).toFixed(3) : null
    })
    console.log(`eau — aval : déplacement projeté ${aval} t ${aval !== null && aval > 0 ? '✓' : '✗'}`)
    if (aval !== null && aval <= 0) console.error('!! les feuilles ne dérivent PAS vers l’aval')
    // A10 : le boot des couches d'eau se CHRONOMÈTRE. La sonde couvre TOUT le bloc eau
    // (dont la construction PRÉ-EXISTANTE de WaterLayer et deux uploads de texture
    // 1581×2372 sur SwiftShader) — mesuré 700-900 ms sur la VM sans GPU, build dev ;
    // buildRiveField seul : ~200 ms en Node à chaud. Budget re-chiffré APRÈS mesure :
    // < 1 200 ms pour le bloc, une fois, au boot d'un monde qui met des secondes à naître.
    const boot = await page.evaluate(() => window.__BRAISES__.scene.bootEauMs)
    console.log(`eau — boot des couches d'eau : ${boot} ms ${boot >= 0 && boot < 1200 ? '✓' : '✗ (budget 1 200 ms)'}`)
    if (boot < 0) console.error('!! sonde bootEauMs débranchée')
    else if (boot >= 1200) console.error(`!! boot de l'eau ${boot} ms — budget A10 dépassé`)

    // ── HORS DE L'EAU : tout doit s'éteindre (crop, anneau, reflet du joueur) ──
    await tp(gue.x, gue.y - 8)
    await page.waitForTimeout(900)
    const surTerre = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      return { crop: sc.playerSprite.isCropped, anneau: sc.playerSprite.getData('flottaison')?.visible ?? false }
    })
    console.log(`eau — sur terre : ${JSON.stringify(surTerre)}`)
    if (surTerre.crop) console.error('!! le sprite reste coupé SUR TERRE')
    if (surTerre.anneau) console.error('!! l’anneau de flottaison survit sur terre')

    // ── LA GERBE ET LES TRACES : marcher dedans, ressortir — compteurs sondés en chemin ──
    // (le rendu headless traîne derrière la prédiction : on marche LONGTEMPS, on somme)
    let ploufsVus = 0
    let tracesVues = 0
    await page.keyboard.down('KeyS')
    for (let k = 0; k < 8; k++) {
      await page.waitForTimeout(450)
      const s = await page.evaluate(() => ({ p: window.__BRAISES__.scene.eauEvents?.ploufsVivants ?? 0, t: window.__BRAISES__.scene.eauEvents?.tracesVivantes ?? 0 }))
      ploufsVus = Math.max(ploufsVus, s.p)
      tracesVues = Math.max(tracesVues, s.t)
    }
    await page.keyboard.up('KeyS')
    await page.keyboard.down('KeyW')
    for (let k = 0; k < 16; k++) {
      await page.waitForTimeout(700)
      const s = await page.evaluate(() => ({ p: window.__BRAISES__.scene.eauEvents?.ploufsVivants ?? 0, t: window.__BRAISES__.scene.eauEvents?.tracesVivantes ?? 0 }))
      ploufsVus = Math.max(ploufsVus, s.p)
      tracesVues = Math.max(tracesVues, s.t)
    }
    await page.keyboard.up('KeyW')
    console.log(`eau — événements : gerbe max ${ploufsVus} ${ploufsVus >= 1 ? '✓' : '✗'} · traces max ${tracesVues} ${tracesVues >= 1 ? '✓' : '✗'}`)
    if (ploufsVus < 1) console.error('!! aucune gerbe sur tout l’aller-retour')
    if (tracesVues < 1) console.error('!! aucune empreinte mouillée sur tout l’aller-retour')

    // ── A5′ : LE SILLAGE SE MESURE (revue : « derrière > devant » n'était pas prouvé sur
    // capture — la première paire livrée disait même l'inverse, noyée par le gradient E-O
    // du chenal). Marche NORD-SUD (le gradient du gué est E-O), boîtes 3×2 tuiles à ±2 t
    // de la position PRÉDITE (celle où les anneaux vivent), cumul sur les frames où un
    // wader vit. Mesuré à la mise au point : derrière 11,7 % vs devant 2,0 % (×5,7).
    // Les POISSONS s'éteignent d'abord : ils fuient DEVANT le marcheur en semant leur
    // écume claire (chantier poissons) — la boîte « avant » s'en trouvait polluée
    // (constaté : un run inversé 2,6 % vs 7,1 %). La sonde mesure le sillage du
    // MARCHEUR ; leurs propres sondes (A8) ont déjà été lues plus haut. ──
    await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      sc.poissons?.destroy()
      sc.poissons = null
    })
    await tp(gue.x - 1, gue.y - 2)
    await page.keyboard.down('KeyS')
    let sAvant = 0
    let sArriere = 0
    let sFrames = 0
    for (let k = 0; k < 14; k++) {
      await page.waitForTimeout(260)
      const m = await page.evaluate(async () => {
        const sc = window.__BRAISES__.scene
        if ((sc.lastWaderCount ?? 0) < 1) return null
        const p = sc.predicted
        const cam = sc.cameras.main
        const snap = await new Promise((ok) => sc.game.renderer.snapshot((img) => ok(img)))
        const cv = document.createElement('canvas')
        cv.width = snap.width; cv.height = snap.height
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(snap, 0, 0)
        const boite = (dyT) => {
          const fx = (p.x * 16 - cam.worldView.x) / cam.worldView.width
          const fy = ((p.y + dyT) * 16 - cam.worldView.y) / cam.worldView.height
          const cx = Math.round(fx * snap.width)
          const cy = Math.round(fy * snap.height)
          let clairs = 0, n = 0
          for (let dy = -16; dy <= 16; dy += 2) for (let dx = -24; dx <= 24; dx += 2) {
            const px = cx + dx, py = cy + dy
            if (px < 0 || py < 40 || px >= snap.width || py >= snap.height - 60) continue
            const d = ctx.getImageData(px, py, 1, 1).data
            const lum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]
            if (lum > 172) clairs++
            n++
          }
          return n ? clairs / n : 0
        }
        return { av: boite(2.0), ar: boite(-2.0) } // marche SUD : avant = sud, arrière = nord
      })
      if (m) { sAvant += m.av; sArriere += m.ar; sFrames++ }
    }
    await page.keyboard.up('KeyS')
    const mAv = sAvant / Math.max(1, sFrames)
    const mAr = sArriere / Math.max(1, sFrames)
    console.log(`eau — sillage (A5′) : ${sFrames} frames · arrière ${(mAr * 100).toFixed(1)} % vs avant ${(mAv * 100).toFixed(1)} % ${sFrames >= 1 && mAr > mAv ? '✓' : '✗'}`)
    if (sFrames < 1) console.error('!! sillage : aucune frame avec wader vivant — sonde muette')
    else if (mAr <= mAv) console.error('!! sillage : l’éclaircissement n’est PAS derrière le marcheur')
    console.log(`captures → ${OUT}/eau-*.png — à REGARDER`)
    return { dansLEau, vie, ploufsVus, tracesVues }
  },

  /**
   * LE COURANT SE MESURE (chantier « l'eau suit le flow », 2026-07-26) — la surface de la
   * rivière doit AVANCER vers l'aval, l'eau dormante ne doit dériver nulle part.
   *
   * Mesure OPTIQUE, en page, zéro dépendance : des snapshots datés (renderer.snapshot,
   * horloge sc.time.now — celle du shader), une ROI d'eau projetée via cam.worldView
   * (le motif A5′), et la corrélation croisée (SSD sur luminance centrée) entre paires.
   * Le déplacement est projeté sur le courant local ET sa perpendiculaire — l'auto-contrôle
   * qui distingue une vraie advection le long du fil d'une dérive de phase globale (le bug
   * d'origine : trois ondes qui filaient toutes vers la gauche, rivière comme mare).
   *
   * Pièges connus et parés : feuilles et poissons dérivent AU-DESSUS de l'eau et
   * corrompraient la corrélation (on les éteint) ; le joueur reste À TERRE, immobile
   * (aucun remous), souris au centre (pas de lookahead caméra) ; midi (pas d'astre, feux
   * éteints) ; la ROI vit au MILIEU du lit (sd ≥ 2 — hors taper de berge) ; 3 candidats
   * rivière, le meilleur v∥ juge (un reflet statique sous-estime, jamais ne surestime).
   * Exige `--dev`.
   */
  async 'eau-courant'(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1000)
    await page.mouse.move(640, 400)
    const heure = async (h) => {
      for (let essai = 0; essai < 4; essai++) {
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), h)
        await page.waitForTimeout(600)
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
        if (Math.abs(lu - h) < 0.3) return
      }
      console.error(`!! set_hour(${h}) n'a jamais pris`)
    }
    await heure(11)

    // ── Les points de mesure : 3 candidats au milieu du lit + une eau dormante loin du fil ──
    const spots = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const m = sc.map
      const rive = sc.water?.rive
      if (!m.fil || m.fil.length < 2 || !rive) return null
      const EAU = (t) => t === 4 || t === 6
      const sd = (tx, ty) => rive.sd[Math.floor(ty) * m.width + Math.floor(tx)]
      // La rivière : des points du fil à sd ≥ 2, sur des TRONÇONS FRANCS (|flow| ≥ 0,85 —
      // aux coudes le champ flouté raccourcit et la tangente brute du fil ment : la 1re
      // version y mesurait un courant « absent » alors que le zigzag seul était en cause),
      // espacés de 200 pas pour juger des biefs distincts. La direction vient du CHAMP
      // réel (sc.water.flow) — exactement ce que le shader advecte, pas une re-dérivation.
      const flowMap = sc.water?.flow?.courant
      const rivieres = []
      for (let i = Math.floor(m.fil.length * 0.1); i < m.fil.length * 0.95; i++) {
        const t = m.fil[i]
        const tx = (t % m.width) + 0.5
        const ty = Math.floor(t / m.width) + 0.5
        if (!EAU(m.terrain[Math.floor(ty) * m.width + Math.floor(tx)])) continue
        if (sd(tx, ty) < 2) continue
        if (rivieres.length && i - rivieres[rivieres.length - 1].i < 200) continue
        const v = flowMap?.get(Math.floor(ty) * m.width + Math.floor(tx))
        if (!v) continue
        const nv = Math.hypot(v.x, v.y)
        if (nv < 0.85) continue
        rivieres.push({ i, x: tx, y: ty, cx: v.x / nv, cy: v.y / nv })
        if (rivieres.length >= 3) break
      }
      // L'eau dormante : loin de TOUT le fil (grille grossière de cellules 8×8 — aucune
      // cellule de fil à moins de 2 cellules ⇒ ≥ 8 tuiles du fil, hors couloir de courant).
      // sd VISÉ dans [2,5 .. 6,5] : assez du bord pour être hors taper, assez PRÈS pour
      // qu'une tuile de terre existe à ≤ 9 tuiles — le zoom (2,5) ne montre que ±10 tuiles
      // de haut : un spot au cœur d'un grand lac (sd 7,9) mettait la ROI HORS CHAMP,
      // clampée au bord de l'écran — elle mesurait n'importe quoi (constaté).
      const filCells = new Set()
      for (const t of m.fil) filCells.add(((t % m.width) >> 3) + ',' + (Math.floor(t / m.width) >> 3))
      let dormante = null
      for (let ty = 2; ty < m.height - 2; ty += 2) {
        for (let tx = 2; tx < m.width - 2; tx += 2) {
          if (!EAU(m.terrain[ty * m.width + tx])) continue
          const s = sd(tx + 0.5, ty + 0.5)
          if (s < 2.5 || s > 6.5 || (dormante && s <= dormante.sd)) continue
          let pres = false
          const cx = tx >> 3
          const cy = ty >> 3
          for (let oy = -2; oy <= 2 && !pres; oy++)
            for (let ox = -2; ox <= 2 && !pres; ox++) if (filCells.has(cx + ox + ',' + (cy + oy))) pres = true
          if (!pres) dormante = { x: tx + 0.5, y: ty + 0.5, sd: s }
        }
      }
      // Un pied À TERRE près d'un point : la première tuile sèche en spirale (le joueur
      // immobile n'émet ni remous ni gerbe, et son sprite reste loin de la ROI). r ≤ 9 :
      // au-delà, la cible sortirait du cadre (demi-champ vertical 10 tuiles au zoom 2,5).
      const terre = (px, py) => {
        for (let r = 4; r < 10; r++)
          for (let oy = -r; oy <= r; oy++)
            for (let ox = -r; ox <= r; ox++) {
              if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue
              const tx = Math.floor(px) + ox
              const ty = Math.floor(py) + oy
              if (tx < 2 || ty < 2 || tx >= m.width - 2 || ty >= m.height - 2) continue
              if (sd(tx + 0.5, ty + 0.5) <= -1.5) return { x: tx + 0.5, y: ty + 0.5 }
            }
        return null
      }
      return {
        rivieres: rivieres.map((r) => ({ ...r, pied: terre(r.x, r.y) })).filter((r) => r.pied),
        dormante: dormante ? { ...dormante, pied: terre(dormante.x, dormante.y) } : null,
      }
    })
    if (!spots || spots.rivieres.length < 1) { console.error('!! eau-courant : aucun point de mesure sur le fil'); return }
    // Feuilles et poissons dérivent au-dessus de l'eau : ils fausseraient la corrélation.
    await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      sc.feuilles?.destroy(); sc.feuilles = null
      sc.poissons?.destroy(); sc.poissons = null
    })

    /** TP au pied, ROI sur l'eau, snapshots datés, corrélation par paires → médianes. */
    const mesure = async (spot) => {
      await heure(11) // l'horloge headless file (~12×) : re-fixer midi AVANT chaque spot
      await page.evaluate(({ x, y }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y }), spot.pied)
      // 4,5 s : la caméra se pose ET le brouillard de guerre finit de se révéler — son
      // fondu en dither traînait dans la ROI et dégénérait la corrélation (constaté :
      // argmin épinglé au coin de la fenêtre sur une eau parfaitement immobile).
      await page.waitForTimeout(4500)
      return page.evaluate(async ({ cible }) => {
        const sc = window.__BRAISES__.scene
        const cam = sc.cameras.main
        // LA CAMÉRA LENTE. Une corrélation rigide sur un champ d'ondes n'est IDENTIFIABLE
        // qu'à petit dt : dès que la phase propre d'une onde tourne de ≫ 1 rad entre deux
        // prises (ω max 3,27 rad/s → dt ≲ 0,3 s), le motif ne se raccorde plus que modulo
        // son réseau — l'argmin saute d'alias en alias (constaté : ±83 px, et la période
        // écran de l'onde dominante vaut PILE le déplacement attendu à dt = T). Or une
        // frame SwiftShader ≈ 1,1-1,5 s de jeu. On met donc L'EAU SEULE au ralenti pendant
        // la mesure (le temps passé à water.update est rescalé ×0,15 — instrumentation du
        // rendu, même famille que game.loop.sleep() ; la sim n'y touche pas), et on mesure
        // les vitesses en temps d'eau EFFECTIF — la même arithmétique de shader, échantillonnée
        // assez fin pour être lisible. Restauré à la fin.
        const RALENTI = 0.15
        const CAPT = 12
        const ROI = 120 // px écran de côté
        // La cible DOIT être dans le cadre, marge comprise — une ROI clampée au bord de
        // l'écran mesure un autre morceau de monde (constaté sur le cœur d'un grand lac).
        {
          const wv = sc.cameras.main.worldView
          const cx = cible.x * 16
          const cy = cible.y * 16
          const marge = (ROI / 2 + 8) / (1280 / wv.width)
          if (cx < wv.x + marge || cx > wv.right - marge || cy < wv.y + marge || cy > wv.bottom - marge) return null
        }
        const water = sc.water
        const origUpdate = water.update.bind(water)
        let base = null
        let hourFige = null
        let dayFige = null
        water.update = (nowMs, hour, day, ...rest) => {
          if (base === null) {
            base = nowMs
            // L'heure et la lumière aussi : l'horloge headless court ~12× — sans gel, le
            // soleil balaie ~2 h de jeu pendant la rafale et le champ d'éclats rase GLISSE
            // en x avec l'azimut (mesuré : un fantôme +0,53 t/s, vy pile 0, sur eau morte).
            hourFige = hour
            dayFige = day
          }
          const t = base + (nowMs - base) * RALENTI
          water.__probeT = t
          return origUpdate(t, hourFige, dayFige, ...rest)
        }
        const prises = []
        let fpsSum = 0
        for (let k = 0; k < CAPT; k++) {
          const snap = await new Promise((ok) => sc.game.renderer.snapshot((img) => ok(img)))
          const tGame = water.__probeT ?? sc.time.now
          fpsSum += sc.game.loop.actualFps
          const cv = document.createElement('canvas')
          cv.width = snap.width; cv.height = snap.height
          const ctx = cv.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(snap, 0, 0)
          const scaleX = snap.width / cam.worldView.width
          const scaleY = snap.height / cam.worldView.height
          const cx = Math.round((cible.x * 16 - cam.worldView.x) * scaleX)
          const cy = Math.round((cible.y * 16 - cam.worldView.y) * scaleY)
          const x0 = Math.max(0, Math.min(snap.width - ROI, cx - ROI / 2))
          const y0 = Math.max(0, Math.min(snap.height - ROI, cy - ROI / 2))
          const img = ctx.getImageData(x0, y0, ROI, ROI).data
          const lum = new Float32Array(ROI * ROI)
          let moy = 0
          for (let i = 0; i < ROI * ROI; i++) {
            const v = 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]
            lum[i] = v; moy += v
          }
          moy /= ROI * ROI
          for (let i = 0; i < ROI * ROI; i++) lum[i] -= moy
          prises.push({ lum, tGame, scaleX, scaleY })
        }
        water.update = origUpdate
        delete water.__probeT
        // La corrélation par paires VOISINES (dt d'eau effectif 0,12-0,6 s) : SSD grossière
        // (pas de 4) puis raffinée (±3), et l'hypothèse nulle en garde-fou.
        const ssdEn = (A, B, dx, dy, pas) => {
          let ssd = 0
          let n = 0
          for (let y = Math.max(0, dy); y < Math.min(ROI, ROI + dy); y += pas)
            for (let x = Math.max(0, dx); x < Math.min(ROI, ROI + dx); x += pas) {
              const d = B.lum[y * ROI + x] - A.lum[(y - dy) * ROI + (x - dx)]
              ssd += d * d; n++
            }
          return n >= 200 ? ssd / n : Infinity
        }
        const vitesses = []
        for (let a = 0; a < prises.length; a++) {
          for (let b = a + 1; b < Math.min(prises.length, a + 5); b++) {
            const A = prises[a]
            const B = prises[b]
            const dt = (B.tGame - A.tGame) / 1000
            // [0,3 .. 0,7] s d'eau effective : en deçà, le décalage vrai (< 4-5 px) reste
            // SOUS le grain de postérisation (cellules de 4 px ancrées au monde) et
            // l'argmin colle à zéro (constaté — le test binaire gelé, lui, voyait 18 px
            // au pixel près) ; au-delà, la phase propre des ondes brouille le raccord.
            if (dt < 0.3 || dt > 0.7) continue
            const S = Math.min(40, Math.ceil(1.0 * 16 * A.scaleX * dt) + 8)
            let best = Infinity
            let bx = 0
            let by = 0
            for (let dy = -S; dy <= S; dy += 4) for (let dx = -S; dx <= S; dx += 4) {
              const s = ssdEn(A, B, dx, dy, 2)
              if (s < best) { best = s; bx = dx; by = dy }
            }
            for (let dy = by - 3; dy <= by + 3; dy++) for (let dx = bx - 3; dx <= bx + 3; dx++) {
              const s = ssdEn(A, B, dx, dy, 2)
              if (s < best) { best = s; bx = dx; by = dy }
            }
            if (!Number.isFinite(best)) continue
            // Un argmin ÉPINGLÉ au bord de la fenêtre n'est pas une mesure : c'est une
            // corrélation dégénérée (paysage SSD monotone — brouillard en fondu, ROI
            // pauvre en texture…). On jette la paire plutôt que d'avaler un extrême.
            if (Math.abs(bx) >= S - 1 || Math.abs(by) >= S - 1) continue
            // Pas de garde « hypothèse nulle » ici : à petit dt la fenêtre S (≤ 40 px)
            // exclut l'alias de l'onde dominante (période écran ~59 px) — et sur des
            // aplats postérisés, un petit décalage vrai ne bat jamais l'offset 0 de
            // beaucoup (il ne change que les frontières de cellules) : le garde snapait
            // tout à zéro (constaté). La médiane des paires fait le tri du bruit.
            // px écran → tuiles/s (16 px monde par tuile, worldView redonne le zoom)
            vitesses.push({ vx: bx / A.scaleX / 16 / dt, vy: by / A.scaleY / 16 / dt })
          }
        }
        const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
        const vx = med(vitesses.map((v) => v.vx))
        const vy = med(vitesses.map((v) => v.vy))
        return { vx: +vx.toFixed(3), vy: +vy.toFixed(3), paires: vitesses.length, fps: +(fpsSum / CAPT).toFixed(1) }
      }, { cible: { x: spot.x, y: spot.y } })
    }

    // ── LA RIVIÈRE : v∥ (le long du fil, aval +) doit dominer, v⊥ rester du bruit.
    // Le verdict exige 2 candidats sur 3 : à la mise au point, la dérive de phase globale
    // (le bug) donnait UN v∥ positif par chance d'orientation — un seul ne prouve rien. ──
    const rivMesures = []
    for (const r of spots.rivieres) {
      const m = await mesure(r)
      if (!m || m.paires < 2) continue
      const vPar = m.vx * r.cx + m.vy * r.cy
      const vPerp = -m.vx * r.cy + m.vy * r.cx
      console.log(`courant — rivière (${r.x.toFixed(0)},${r.y.toFixed(0)}) fil(${r.cx.toFixed(2)},${r.cy.toFixed(2)}) : v∥ ${vPar.toFixed(3)} t/s · v⊥ ${vPerp.toFixed(3)} · ${m.paires} paires · ${m.fps} fps`)
      rivMesures.push({ ...m, vPar, vPerp })
    }
    // ── L'EAU DORMANTE : aucune dérive, dans aucune direction ──
    let dortM = null
    if (spots.dormante?.pied) {
      dortM = await mesure(spots.dormante)
      const norme = dortM ? Math.hypot(dortM.vx, dortM.vy) : NaN
      console.log(`courant — eau dormante (${spots.dormante.x.toFixed(0)},${spots.dormante.y.toFixed(0)}, sd ${spots.dormante.sd.toFixed(1)}) : |v| ${norme.toFixed(3)} t/s (${dortM?.vx}, ${dortM?.vy}) · ${dortM?.paires} paires`)
      if (norme > 0.1) console.error(`!! l'eau dormante DÉRIVE (|v| ${norme.toFixed(3)} > 0,1 t/s) — le tapis roulant`)
    } else console.error('!! eau-courant : aucune eau dormante loin du fil sur cette carte')
    if (rivMesures.length < 1) console.error('!! eau-courant : aucune paire de mesure exploitable sur la rivière')
    else {
      const passent = rivMesures.filter((m) => m.vPar > 0.2 && Math.abs(m.vPerp) < Math.abs(m.vPar) * 0.5 + 0.1)
      const ok = passent.length >= Math.min(2, rivMesures.length)
      console.log(`courant — verdict rivière : ${passent.length}/${rivMesures.length} candidats suivent le fil (v∥ > 0,2 t/s, v⊥ dominé ; attendu ~0,55 vers l'AVAL) ${ok ? '✓' : '✗'}`)
      if (!ok) console.error('!! la surface de la rivière ne suit PAS le fil')
    }
    return { rivieres: rivMesures, dormante: dortM }
  },

  /**
   * LES LIEUX BASCULÉS (spec da-feeling §3, critère A2) — la planche de la vague B.
   *
   * Pour CHAQUE texture `poi-*_lit` : l'étendue des canaux nx/ny de sa normale (une masse
   * dont la normale est plate tombera en blob bleu la nuit — c'est LE juge). Puis on va
   * REGARDER quelques lieux représentatifs, de jour et de nuit. Exige `--dev` (TP + heure).
   */
  async 'lieux-lit'(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(800)

    const mesures = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const range = (key, ch) => {
        const tex = s.textures.get(key)
        const src = tex && tex.dataSource && tex.dataSource[0]
        if (!src) return null
        const img = src.image
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data
        let mn = 1, mx = -1
        for (let i = ch; i < d.length; i += 4) {
          const v = (d[i] / 255) * 2 - 1
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        return +(mx - mn).toFixed(2)
      }
      const out = []
      for (const key of s.textures.getTextureKeys()) {
        if (!/^poi-.+_lit$/.test(key) || key.includes('-curl')) continue
        out.push({ key, nx: range(key, 0), ny: range(key, 1) })
      }
      return out.sort((a, b) => (a.key < b.key ? -1 : 1))
    })
    let plats = 0
    for (const m of mesures) {
      // Une COURONNE est une tranche mince du même canvas : sa plage ny est structurellement
      // étroite (le corps, lui, est jugé plein cadre) — le seuil ne vaut que pour les corps.
      const crown = m.key.includes('-crown')
      const plat = (m.nx ?? 0) < 0.9 || (!crown && (m.ny ?? 0) < 0.9)
      if (plat) plats++
      console.log(`${m.key.padEnd(30)} nx:${m.nx} ny:${m.ny}${plat ? '  ✗ PLAT (blob bleu la nuit)' : ''}`)
    }
    console.log(`${mesures.length} lieux _lit mesurés — ${plats === 0 ? '✓ aucune normale plate' : `✗ ${plats} suspect(s)`}`)

    // ── ON VA REGARDER : cinq lieux, midi puis nuit noire ──
    const cibles = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const un = (k) => {
        const z = (m.zones ?? []).find((q) => q.kind === k)
        return z ? { k, x: z.x + z.w / 2, y: z.y + z.h / 2 } : null
      }
      return ['chene', 'cairn', 'tour_guet', 'grotte', 'cascade', 'combe_brumeuse'].map(un).filter(Boolean)
    })
    const heure = async (h) => {
      for (let essai = 0; essai < 4; essai++) {
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), h)
        await page.waitForTimeout(600)
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
        if (Math.abs(lu - h) < 0.3) return
      }
    }
    for (const [h, tag] of [[11, 'jour'], [23, 'nuit']]) {
      await heure(h)
      for (const c of cibles) {
        await page.evaluate(({ x, y }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y: y + 4 }), c)
        await page.waitForTimeout(1200)
        await page.screenshot({ path: `${OUT}/lit-${c.k}-${tag}.png` })
      }
      console.log(`captures ${tag} : ${cibles.map((c) => c.k).join(', ')}`)
    }
    return { mesures: mesures.length, plats }
  },

  /**
   * L'ONGLET CARTE (2026-07-25) — la carte est devenue le 3ᵉ onglet de l'écran personnage,
   * rendue par Phaser SOUS le panneau DOM effacé. Ce qui ne se prouve qu'au navigateur : que
   * le panneau ne mange NI la molette NI le glisser (pointer-events), que M ouvre/referme
   * l'écran entier, et que la carte tient dans sa BOÎTE — la marge au-dessus de la ceinture,
   * mesurée au pixel du renderer, y compris AU ZOOM (où elle débordait avant les bandes).
   */
  async carte(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    const lire = () => page.evaluate(() => {
      const ui = window.__BRAISES__.scene.scene.get('ui')
      const r = window.__BRAISES__.scene.registry
      const l = ui.mapLayer
      const b = document.querySelector('.hch-belt')?.getBoundingClientRect() ?? null
      const cv = document.querySelector('canvas').getBoundingClientRect()
      // Bas de la carte à l'écran (px navigateur) : centre + demi-hauteur scalée, ramené au canvas.
      const k = cv.height / 720
      const bas = cv.top + (l.y + (ui.mapTexH * l.scaleY) / 2) * k
      return {
        mapOpen: Boolean(r.get('mapOpen')), tab: r.get('characterTab'),
        x: +l.x.toFixed(1), y: +l.y.toFixed(1), scale: +l.scaleX.toFixed(4),
        basCarte: +bas.toFixed(1), hautCeinture: b ? +b.top.toFixed(1) : null,
      }
    })
    await page.keyboard.press('m')
    await page.waitForTimeout(500)
    const a = await lire()
    console.log(`ouverture : mapOpen=${a.mapOpen} tab=${a.tab} · échelle ${a.scale} · centre y ${a.y}`)
    console.log(a.basCarte < a.hautCeinture
      ? `   ✓ MARGE : bas de carte ${a.basCarte} < haut de ceinture ${a.hautCeinture} (${(a.hautCeinture - a.basCarte).toFixed(0)} px)`
      : `   ✗ la carte mord la ceinture (${a.basCarte} vs ${a.hautCeinture})`)
    // MOLETTE : zoom ancré au curseur, au centre de l'écran.
    await page.mouse.move(640, 400)
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60) }
    const z = await lire()
    console.log(z.scale > a.scale ? `   ✓ la molette zoome (${a.scale} → ${z.scale})` : `   ✗ la molette ne zoome plus (${z.scale})`)
    // GLISSER : clic gauche maintenu.
    await page.mouse.move(640, 400); await page.mouse.down()
    await page.mouse.move(760, 430, { steps: 8 }); await page.waitForTimeout(80); await page.mouse.up()
    const p = await lire()
    console.log(p.x !== z.x || p.y !== z.y ? `   ✓ le glisser déplace (Δ ${(p.x - z.x).toFixed(0)}, ${(p.y - z.y).toFixed(0)})` : `   ✗ le glisser ne déplace plus`)
    // GLISSER DEPUIS LA CEINTURE : elle reste affichée sur cet onglet, mais ses cases sont du
    // DOM cliquable — si elles gardent le pointeur, elles VOLENT le geste (et leur clic droit
    // déplacerait un objet dans un sac qu'on ne voit même pas).
    // On vise le CENTRE D'UNE CASE, lu dans le DOM : entre deux cases il y a un interstice de
    // 3 px qui laisse passer le pointeur — y tomber ne prouverait rien.
    const cell = await page.evaluate(() => {
      const r = document.querySelectorAll('.hch-cell-belt')[2].getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })
    await page.mouse.move(cell.x, cell.y); await page.mouse.down()
    await page.mouse.move(cell.x, cell.y - 55, { steps: 8 }); await page.waitForTimeout(80); await page.mouse.up()
    const c = await lire()
    console.log(c.y !== p.y
      ? `   ✓ un glisser PARTI DE LA CEINTURE déplace la carte (Δy ${(c.y - p.y).toFixed(0)})`
      : `   ✗ la ceinture vole le geste (la carte n'a pas bougé)`)
    // LA BOÎTE TIENT-ELLE AU ZOOM ? On lit les VRAIS pixels rendus (snapshot du renderer) :
    // au-dessus de MAP_BOX_TOP et sous MAP_BOX_BOTTOM, il ne doit rester que le fond #14100c.
    const px = await page.evaluate(async () => {
      const s = window.__BRAISES__.scene
      const img = await new Promise((ok) => s.game.renderer.snapshot((i) => ok(i)))
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const cx = c.getContext('2d', { willReadFrequently: true })
      cx.drawImage(img, 0, 0)
      const d = cx.getImageData(0, 0, c.width, c.height).data
      const at = (x, y) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]] }
      return { w: c.width, h: c.height, haut: at(200, 20), dansBoite: at(c.width >> 1, 300), bas: at(c.width >> 1, c.height - 40) }
    })
    const fond = (p) => p[0] === 0x14 && p[1] === 0x10 && p[2] === 0x0c
    console.log(`   pixels (${px.w}×${px.h}) haut ${px.haut} · boîte ${px.dansBoite} · bas ${px.bas}`)
    console.log(fond(px.haut) && fond(px.bas)
      ? `   ✓ au zoom, la carte reste DANS sa boîte (bandes haut/bas au fond nu)`
      : `   ✗ au zoom, la carte déborde de sa boîte`)
    await page.screenshot({ path: `${OUT}/carte-onglet-zoom.png` })
    // Retour : M referme TOUT (l'écran personnage compris).
    await page.keyboard.press('m'); await page.waitForTimeout(300)
    const f = await page.evaluate(() => ({
      map: Boolean(window.__BRAISES__.scene.registry.get('mapOpen')),
      menu: Boolean(window.__BRAISES__.scene.registry.get('characterMenuOpen')),
    }))
    console.log(!f.map && !f.menu ? `   ✓ M referme l'écran entier` : `   ✗ reste ouvert : map=${f.map} menu=${f.menu}`)
    // TAB ouvre sur PERSONNAGE, puis M bascule sur CARTE sans refermer.
    await page.keyboard.press('Tab'); await page.waitForTimeout(300)
    const t1 = await page.evaluate(() => window.__BRAISES__.scene.registry.get('characterTab'))
    await page.keyboard.press('m'); await page.waitForTimeout(300)
    const t2 = await page.evaluate(() => ({
      tab: window.__BRAISES__.scene.registry.get('characterTab'),
      menu: Boolean(window.__BRAISES__.scene.registry.get('characterMenuOpen')),
    }))
    console.log(t1 === 'perso' ? `   ✓ TAB ouvre sur PERSONNAGE` : `   ✗ TAB ouvre sur ${t1}`)
    console.log(t2.tab === 'carte' && t2.menu ? `   ✓ M bascule sur CARTE sans refermer` : `   ✗ ${JSON.stringify(t2)}`)
    return {}
  },

  /**
   * LE CUBIQUE (DA 2026-07-24) — décor passé en normal-map + fleurs en VARIÉTÉS. On MESURE ce qui se
   * mesure (géométrie du miroir, étendue des facettes de la normale) et on CAPTURE ce qui se juge à
   * l'œil (variété des fleurs, penche des nœuds-plantes au vent). Tourne en build de PROD — aucun TP.
   */
  async cubique(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(800)

    // 1) MIROIR — `cl-grass_tuft_lit` vs `_lit_m` : les colonnes opaques doivent être {15 − x}. C'est
    //    LE fix de variété (un flip Phaser casserait la normale ; on pré-retourne le canvas).
    const mir = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const cols = (key) => {
        const img = s.textures.get(key).getSourceImage()
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0)
        const d = cx.getImageData(0, 0, cv.width, cv.height).data
        const set = new Set()
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) set.add(x)
        return { w: cv.width, cols: [...set].sort((a, b) => a - b) }
      }
      const a = cols('cl-grass_tuft_lit'), b = cols('cl-grass_tuft_lit_m')
      const expected = a.cols.map((x) => a.w - 1 - x).sort((x, y) => x - y)
      return { lit: a.cols, mir: b.cols, expected, match: JSON.stringify(expected) === JSON.stringify(b.cols) }
    })
    console.log(`MIROIR grass_tuft — lit:[${mir.lit}] mir:[${mir.mir}] attendu:[${mir.expected}] → ${mir.match ? '✓ MIROITÉ' : '✗ PAS MIROITÉ'}`)

    // 2) FACETTES — étendue de la normale nx sur la tête, par variété de fleur, vs grass (censé plat)
    //    et bush (cube de référence). Large étendue = vraies facettes = cubique.
    const fac = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      // `ch` : 0 = nx (facing gauche/droite), 1 = ny (facing haut/bas — c'est LUI qui porte l'arête
      // BASSE d'un bloc, donc lui que polluerait une ombre comptée comme de la matière).
      const range = (key, x0, y0, x1, y1, ch = 0) => {
        const tex = s.textures.get(key)
        const src = tex && tex.dataSource && tex.dataSource[0]
        const nrm = src ? (src.image || src) : null
        if (!nrm) return null
        const cv = document.createElement('canvas'); cv.width = nrm.width; cv.height = nrm.height
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(nrm, 0, 0)
        const d = cx.getImageData(0, 0, cv.width, cv.height).data
        let mn = 1, mx = -1
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const nx = (d[(y * cv.width + x) * 4 + ch] / 255) * 2 - 1
          if (nx < mn) mn = nx; if (nx > mx) mx = nx
        }
        return mx <= mn ? 0 : +(mx - mn).toFixed(2)
      }
      const nxRange = range
      const flowers = []
      for (let i = 0; s.textures.exists(`cl-flower-${i}_lit`); i++) flowers.push(nxRange(`cl-flower-${i}_lit`, 4, 2, 12, 10))
      // LES CAILLOUX — l'ombre au pied de chaque bloc (2026-07-25) est peinte APRÈS la dérivation de
      // la normale, justement pour que la normale l'ignore (`normalFromCanvas` seuille l'ALPHA : une
      // bande semi-opaque y passerait pour de la matière et affaisserait l'arête basse). On mesure donc
      // nx ET ny sur la fenêtre blocs+bande : si la séquence se casse un jour, ny s'écroule ici.
      const pebbles = { nx: [], ny: [] }
      for (let i = 0; s.textures.exists(`cl-pebbles-${i}_lit`); i++) {
        pebbles.nx.push(range(`cl-pebbles-${i}_lit`, 3, 8, 15, 16, 0))
        pebbles.ny.push(range(`cl-pebbles-${i}_lit`, 3, 8, 15, 16, 1))
      }
      return { flowers, pebbles, grass: nxRange('cl-grass_tuft_lit', 4, 7, 13, 15), bush: nxRange('cl-bush_lit', 2, 3, 14, 14) }
    })
    console.log(`FACETTES nx (étendue) — fleurs:[${fac.flowers.join(', ')}]  grass(≈plat):${fac.grass}  bush(cube réf):${fac.bush}`)
    console.log(`CAILLOUX — normale AVEUGLE à l'ombre ? nx:[${fac.pebbles.nx.join(', ')}]  ny:[${fac.pebbles.ny.join(', ')}]`)

    // 3) ATLAS — chaque variété d'une famille, peinte (haut) + albédo lit (bas), ×8 NEAREST : la
    //    VARIÉTÉ forme+couleur, sans dépendre de ce qui a poussé au spawn.
    for (const kind of ['flower', 'pebbles']) {
      const atlas = await page.evaluate((k) => {
        const s = window.__BRAISES__.scene
        let n = 0; while (s.textures.exists(`cl-${k}-${n}`)) n++
        const SC = 8, cell = 16 * SC
        const cv = document.createElement('canvas'); cv.width = n * cell; cv.height = 2 * cell
        const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false
        cx.fillStyle = '#3b4a2e'; cx.fillRect(0, 0, cv.width, cv.height)
        for (let i = 0; i < n; i++) {
          cx.drawImage(s.textures.get(`cl-${k}-${i}`).getSourceImage(), i * cell, 0, cell, cell)
          cx.drawImage(s.textures.get(`cl-${k}-${i}_lit`).getSourceImage(), i * cell, cell, cell, cell)
        }
        return cv.toDataURL('image/png')
      }, kind)
      writeFileSync(`${OUT}/cubique-${kind}-atlas.png`, Buffer.from(atlas.split(',')[1], 'base64'))
    }

    // 4) IN-WORLD — un nœud-plante penche au vent, la roche NON (BASE_LEAN visible même à l'arrêt), et
    //    les fleurs lues sous l'éclairage-défaut. On regarde autour du spawn.
    const near = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const p = s.registry.get('playerPos')
      const kinds = {}
      for (const n of s.view.nodes) kinds[n.type] = (kinds[n.type] ?? 0) + 1
      return { player: `${p.x.toFixed(0)},${p.y.toFixed(0)}`, nodeKinds: kinds }
    })
    console.log(`spawn ${near.player} — nœuds en vue : ${JSON.stringify(near.nodeKinds)}`)
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(3.4))
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/cubique-monde.png` })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(6))
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/cubique-zoom.png` })
    console.log(`captures : cubique-fleurs-atlas.png · cubique-monde.png · cubique-zoom.png`)
  },

  /**
   * LE BLOC ERRATIQUE EN DA CUBIQUE — 3 variantes à choisir (demande d'Alexis 2026-07-25).
   *
   * On LIT les vraies textures `poi-erratique-<i>_lit` (albédo + normale en dataSource, générées
   * au boot par render/poi-lit.ts) et on compose une planche : pour chaque variante, la SILHOUETTE
   * (test ombre chinoise), l'albédo aplati, la normale, puis le rendu JOUR et le rendu NUIT calculés
   * avec les CONSTANTES EXACTES de dynamic-lighting.ts (ambiante/soleil/lune) — le seul moyen de voir
   * qu'une masse ne tombe pas en blob bleu la nuit. En bas : les silhouettes des 3, alignées avec le
   * Cairn et la Grotte, pour vérifier qu'on les distingue. Enfin 3 sprites RÉELS `setLighting(true)`
   * dans le monde (pipeline Phaser Light2D authentique) comme contre-épreuve du jour.
   *
   * Autonome (aucun `--dev`) : ne pilote aucune horloge, calcule l'éclairage hors-ligne à partir
   * des mêmes normales et des mêmes constantes.
   */
  async erratique(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(800)

    const dataUrl = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const SC = 5, S = 42
      // Lit un canvas de texture (albédo) ou sa normale (dataSource) en ImageData 42×42.
      const readPix = (img) => {
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0)
        return { w: cv.width, h: cv.height, d: cx.getImageData(0, 0, cv.width, cv.height).data }
      }
      const albedoOf = (key) => readPix(s.textures.get(key).getSourceImage())
      const normalOf = (key) => {
        const src = s.textures.get(key).dataSource && s.textures.get(key).dataSource[0]
        return readPix(src.image || src)
      }
      // Éclairage hors-ligne, per-pixel : out = albédo × (ambiante + couleurLumière × intensité × max(0,N·L)).
      // Constantes reprises TELLES QUELLES de dynamic-lighting.ts / poi-art.ts (lumière NO, rule 4).
      const norml = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] }
      const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      const shade = (alb, nrm, amb, lightRGB, intensity, L) => {
        const [ar, ag, ab] = hex(amb), [lr, lg, lb] = hex(lightRGB)
        const out = document.createElement('canvas'); out.width = S; out.height = S
        const ox = out.getContext('2d'); const od = ox.createImageData(S, S)
        for (let i = 0; i < S * S; i++) {
          const a = alb.d[i * 4 + 3]
          if (a <= 8) { od.data[i * 4 + 3] = 0; continue }
          const nx = (nrm.d[i * 4] / 255) * 2 - 1
          const ny = -((nrm.d[i * 4 + 1] / 255) * 2 - 1) // FLIP_G : le vert stocké est -ny
          const nz = (nrm.d[i * 4 + 2] / 255) * 2 - 1
          const dot = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
          const mix = (alc, ambc, lc) => Math.min(255, Math.round(alc * (ambc / 255 + (lc / 255) * intensity * dot)))
          od.data[i * 4] = mix(alb.d[i * 4], ar, lr)
          od.data[i * 4 + 1] = mix(alb.d[i * 4 + 1], ag, lg)
          od.data[i * 4 + 2] = mix(alb.d[i * 4 + 2], ab, lb)
          od.data[i * 4 + 3] = a
        }
        ox.putImageData(od, 0, 0)
        return out
      }
      const L_SUN = norml(-0.45, -0.6, 0.75) // soleil : rasant du NORD-OUEST (rule 4 / SUN_NORTH)
      const L_MOON = norml(0.0, -0.7, 0.7) //   lune : voile froid venu d'en haut
      const dayOf = (alb, nrm) => shade(alb, nrm, 0xb6ad9c, 0xfff2e6, 1.2, L_SUN)
      const nightOf = (alb, nrm) => shade(alb, nrm, 0x33415f, 0xaec2e6, 0.32, L_MOON)
      // Masque de silhouette (ombre chinoise) : noir plein là où l'albédo est opaque.
      const silhouetteOf = (alb) => {
        const out = document.createElement('canvas'); out.width = alb.w; out.height = alb.h
        const ox = out.getContext('2d'); const od = ox.createImageData(alb.w, alb.h)
        // Cream clair sur fond sombre : une ombre chinoise DOIT trancher (le bug précédent la peignait
        // à la couleur du fond → invisible). On lit la FORME, rien d'autre.
        for (let i = 0; i < alb.w * alb.h; i++) if (alb.d[i * 4 + 3] > 8) { od.data[i * 4 + 3] = 255; od.data[i * 4] = 206; od.data[i * 4 + 1] = 212; od.data[i * 4 + 2] = 200 }
        ox.putImageData(od, 0, 0); return out
      }

      let n = 0; while (s.textures.exists(`poi-erratique-${n}_lit`)) n++
      const NAMES = ['monolithe fendu', 'bloc coiffé', 'bloc et son éclat']
      // JOUR/NUIT ici = APERÇU hors-ligne (indicatif) ; la vérité est dans erratique-jour/nuit.png (pipeline réel).
      const COLS = ['silhouette', 'albédo', 'normale', 'jour (aperçu)', 'nuit (aperçu)']
      const tile = S * SC, GAP = 16, LBL = 22, PADX = 150, HEAD = 40
      const W = PADX + COLS.length * (tile + GAP) + GAP
      const H = HEAD + n * (tile + LBL + GAP) + 40 + tile + LBL + 30

      const c = document.createElement('canvas'); c.width = W; c.height = H
      const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, W, H)
      ctx.textBaseline = 'alphabetic'

      ctx.fillStyle = '#ffd94a'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'left'
      ctx.fillText('LE BLOC ERRATIQUE — 3 variantes en DA cubique (albédo plat + normale, éclairage réel jour/nuit)', 14, 26)
      // en-têtes de colonnes
      ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'
      COLS.forEach((cLabel, j) => {
        ctx.fillStyle = cLabel.startsWith('jour') ? '#ffd08a' : cLabel.startsWith('nuit') ? '#9fb6e6' : '#7f8a96'
        ctx.fillText(cLabel, PADX + j * (tile + GAP) + tile / 2, HEAD + 12)
      })

      const put = (canvas, x, y) => ctx.drawImage(canvas, x, y, tile, tile)
      for (let i = 0; i < n; i++) {
        const alb = albedoOf(`poi-erratique-${i}_lit`), nrm = normalOf(`poi-erratique-${i}_lit`)
        const y = HEAD + 22 + i * (tile + LBL + GAP)
        // nom de variante, à gauche
        ctx.fillStyle = '#e6ddc8'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left'
        ctx.fillText(`${i}`, 14, y + 24)
        ctx.fillStyle = '#b9c2cc'; ctx.font = '12px monospace'
        ctx.fillText(NAMES[i] ?? '', 30, y + 24)
        // les 5 colonnes : silhouette · albédo · normale · jour · nuit
        put(silhouetteOf(alb), PADX + 0 * (tile + GAP), y)
        put(s.textures.get(`poi-erratique-${i}_lit`).getSourceImage(), PADX + 1 * (tile + GAP), y)
        const nsrc = s.textures.get(`poi-erratique-${i}_lit`).dataSource[0]
        put(nsrc.image || nsrc, PADX + 2 * (tile + GAP), y)
        put(dayOf(alb, nrm), PADX + 3 * (tile + GAP), y)
        put(nightOf(alb, nrm), PADX + 4 * (tile + GAP), y)
      }

      // ── OMBRE CHINOISE : les 3 variantes alignées avec le Cairn et la Grotte ──
      const yS = HEAD + 22 + n * (tile + LBL + GAP) + 24
      ctx.fillStyle = '#7fd0a8'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left'
      ctx.fillText('OMBRE CHINOISE — se distingue-t-il de ses voisins de pierre ?', 14, yS - 6)
      const sil = [
        ...Array.from({ length: n }, (_, i) => ({ label: `err.${i}`, sil: silhouetteOf(albedoOf(`poi-erratique-${i}_lit`)) })),
        { label: 'cairn', sil: silhouetteOf(albedoOf('poi-cairn')) },
        { label: 'grotte', sil: silhouetteOf(albedoOf('poi-grotte')) },
      ]
      let sx = 14
      for (const { label, sil: cvs } of sil) {
        const w = cvs.width * SC, h = cvs.height * SC
        ctx.drawImage(cvs, sx, yS + (tile - h) + 4, w, h)
        ctx.fillStyle = '#93a1ad'; ctx.font = '12px monospace'; ctx.textAlign = 'center'
        ctx.fillText(label, sx + w / 2, yS + tile + 22)
        sx += w + GAP
      }
      // ── COMPARAISON DU BAS DE LA NORMALE — bord qui plonge (avant) vs base plantée (après) ──
      const SC2 = 6, T = 42 * SC2
      const CO = ['normale · avant', 'normale · après', 'jour · avant', 'jour · après']
      const PADX2 = 170, GAP2 = 14, HEAD2 = 66
      const WB = PADX2 + CO.length * (T + GAP2) + GAP2
      const HB = HEAD2 + n * (T + 30) + 10
      const cB = document.createElement('canvas'); cB.width = WB; cB.height = HB
      const bx = cB.getContext('2d'); bx.imageSmoothingEnabled = false
      bx.fillStyle = '#14171c'; bx.fillRect(0, 0, WB, HB)
      bx.fillStyle = '#ffd94a'; bx.font = 'bold 17px monospace'; bx.textAlign = 'left'
      bx.fillText('LE BAS DE LA NORMALE — bord qui plonge (avant) vs base plantée (après)', 14, 26)
      bx.fillStyle = '#9fb6e6'; bx.font = '12px monospace'
      bx.fillText('même albédo, même ombre de contact : seule la normale du bord du bas change.', 14, 46)
      bx.font = 'bold 12px monospace'; bx.textAlign = 'center'
      CO.forEach((cl, j) => { bx.fillStyle = cl.includes('avant') ? '#d69090' : '#8ac9a0'; bx.fillText(cl, PADX2 + j * (T + GAP2) + T / 2, HEAD2 - 8) })
      const putB = (cv, x, y) => bx.drawImage(cv, x, y, T, T)
      const nImg = (key) => { const d = s.textures.get(key).dataSource[0]; return d.image || d }
      for (let i = 0; i < n; i++) {
        const alb = albedoOf(`poi-erratique-${i}_lit`)
        const nCurl = normalOf(`poi-erratique-${i}-curl_lit`)
        const nPlant = normalOf(`poi-erratique-${i}_lit`)
        const y = HEAD2 + i * (T + 30)
        bx.fillStyle = '#e6ddc8'; bx.font = 'bold 12px monospace'; bx.textAlign = 'left'
        bx.fillText(`${i}`, 12, y + T / 2 - 6)
        bx.fillStyle = '#b9c2cc'; bx.font = '11px monospace'
        bx.fillText(NAMES[i] ?? '', 12, y + T / 2 + 10)
        putB(nImg(`poi-erratique-${i}-curl_lit`), PADX2 + 0 * (T + GAP2), y)
        putB(nImg(`poi-erratique-${i}_lit`), PADX2 + 1 * (T + GAP2), y)
        putB(dayOf(alb, nCurl), PADX2 + 2 * (T + GAP2), y)
        putB(dayOf(alb, nPlant), PADX2 + 3 * (T + GAP2), y)
      }
      return { planche: c.toDataURL('image/png'), base: cB.toDataURL('image/png') }
    })
    writeFileSync(`${OUT}/erratique-variantes.png`, Buffer.from(dataUrl.planche.split(',')[1], 'base64'))
    writeFileSync(`${OUT}/erratique-base.png`, Buffer.from(dataUrl.base.split(',')[1], 'base64'))
    console.log(`✓ planche des 3 variantes → ${OUT}/erratique-variantes.png`)
    console.log(`✓ comparaison base plantée → ${OUT}/erratique-base.png`)

    // ── CONTRE-ÉPREUVE : 3 sprites RÉELS sous le pipeline Phaser Light2D — jour PUIS nuit ──
    // C'est la VÉRITÉ (l'aperçu hors-ligne de la planche sous-estime la lumière). On pose les sprites,
    // on capture au jour in-world, puis on GÈLE le contrôleur d'éclairage sur le préréglage NUIT
    // (constantes de dynamic-lighting.ts) pour voir si une masse tient ou tombe en blob bleu.
    const info = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const cam = s.cameras.main
      const cx = cam.worldView.x + cam.worldView.width / 2
      const cy = cam.worldView.y + cam.worldView.height / 2 + 20
      let n = 0; while (s.textures.exists(`poi-erratique-${n}_lit`)) n++
      for (let i = 0; i < n; i++) {
        const img = s.add.image(cx + (i - 1) * 72, cy, `poi-erratique-${i}_lit`).setOrigin(0.5, 1).setDepth(800000)
        img.setLighting(true)
      }
      const reg = s.registry.get('debugInfo')
      return { n, hour: reg?.hour ?? null, cx, cy }
    })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(3.4))
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/erratique-jour.png` })

    // ── CÂBLAGE RÉEL : les VRAIS POI erratiques posés par PoiLayer (choix déterministe des 3) ──
    // On lit ce que PoiLayer a réellement attribué, on vérifie que les 3 variantes sont réparties,
    // et on CENTRE la caméra (sans debug) sur un erratique réel pour le capturer tel qu'en jeu.
    const wired = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const placed = (s.pois && s.pois.placed) || []
      const errs = placed.filter((p) => (p.body.texture.key || '').startsWith('poi-erratique-'))
      const dist = {}
      for (const p of errs) { const k = p.body.texture.key; dist[k] = (dist[k] || 0) + 1 }
      const t = errs[0] ? { x: errs[0].body.x, y: errs[0].body.y, key: errs[0].body.texture.key } : null
      if (t) { s.cameras.main.stopFollow(); s.cameras.main.centerOn(t.x, t.y - 60) }
      return { count: errs.length, dist, target: t }
    })
    console.log(`CÂBLAGE — ${wired.count} POI erratiques en jeu · variantes posées : ${JSON.stringify(wired.dist)}`)
    if (wired.target) {
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${OUT}/erratique-inworld-poi.png` })
      console.log(`✓ POI erratique RÉEL (PoiLayer, ${wired.target.key}) → erratique-inworld-poi.png`)
    }
    // recentre sur les 3 sprites témoins pour la capture nuit
    await page.evaluate((c) => window.__BRAISES__.scene.cameras.main.centerOn(c.cx, c.cy), { cx: info.cx, cy: info.cy })
    await page.waitForTimeout(300)

    // NUIT : on gèle le contrôleur (sinon il réécrit l'ambiante chaque frame depuis l'heure in-world)
    // et on impose le préréglage nuit — mêmes lumières que le jeu (this.sun/this.moon), valeurs de nuit.
    const night = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const dl = s.dynLight
      if (!dl) return { ok: false }
      dl.update = () => {} // GEL : plus de réécriture par frame
      const v = s.cameras.main.worldView
      s.lights.setAmbientColor(0x33415f) // AMBIENT_NIGHT
      dl.sun.intensity = 0
      dl.moon.intensity = 0.32 // MOON_INTENSITY
      dl.moon.x = v.x + v.width / 2
      dl.moon.y = v.y - 1600 // au NORD, au-dessus de la vue (SUN_NORTH)
      return { ok: true }
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/erratique-nuit.png` })
    console.log(`✓ ${info.n} sprites réels (pipeline Phaser) → erratique-jour.png (heure ${info.hour}) · erratique-nuit.png ${night.ok ? '' : '(⚠ dynLight introuvable)'}`)
  },

  /**
   * LES ZONES SE DISTINGUENT-ELLES D'UN COUP D'ŒIL ?
   *
   * C'est le principe n°3 du directeur de jeu, et c'est le SEUL test qui vaille : on se pose au
   * cœur de chaque zone, on regarde, et on répond oui ou non. Aucune propriété testable ne dira
   * jamais si une Vieille Sylve se distingue d'un Versant Brûlé — il faut la VOIR.
   *
   * Exige `--dev` (le TP n'est armé que là).
   */
  async zones(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })

    const zones = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      if (!m.zoneDefs) return []
      // Le centre de chaque zone : la moyenne des tuiles qu'elle possède (grille grossière).
      const cols = Math.ceil(m.width / m.zonePas)
      const acc = m.zoneDefs.map(() => ({ x: 0, y: 0, n: 0 }))
      for (let i = 0; i < m.zoneGrid.length; i++) {
        const z = m.zoneGrid[i]
        const gx = (i % cols) * m.zonePas
        const gy = Math.floor(i / cols) * m.zonePas
        acc[z].x += gx; acc[z].y += gy; acc[z].n++
      }
      return m.zoneDefs.map((d, i) => ({
        slug: d.slug, nom: d.nom, tier: d.tier,
        x: Math.round(acc[i].x / Math.max(1, acc[i].n)),
        y: Math.round(acc[i].y / Math.max(1, acc[i].n)),
      }))
    })

    // Plein jour, une bonne fois : on juge la ZONE, pas la nuit.
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    for (const z of zones) {
      // UNE ACTION PAR TICK. Le protocole n'en porte qu'une par input : en envoyant le TP et
      // l'heure dans le même souffle, la seconde ÉCRASE la première — et la caméra ne bougeait
      // pas d'un pouce (mesuré : douze captures, douze fois le même pré).
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
      }, z)
      await page.waitForTimeout(1600) // le TP, puis le fondu de l'air de la zone (~0,9 s)
      const ou = await page.evaluate(() => {
        const p = window.__BRAISES__.scene.predicted
        return { x: Math.round(p.x), y: Math.round(p.y) }
      })
      await page.screenshot({ path: `${OUT}/zone-${z.slug}.png` })
      const arrive = Math.abs(ou.x - z.x) < 30 && Math.abs(ou.y - z.y) < 30
      console.log(`T${z.tier} ${z.nom.padEnd(22)} visé (${z.x}, ${z.y}) → ${arrive ? 'OK' : `ÉCHOUÉ, on est en (${ou.x}, ${ou.y})`}`)
    }
  },

  /**
   * SORTIR L'ART EN PNG — pour qu'il se REGARDE et se RETOUCHE hors du code.
   *
   * L'art est peint au boot ; il n'existe donc nulle part sous forme de fichier. Ce scénario le
   * fait exister : il prend chaque texture du cache et l'écrit en PNG sous `art-export/`, rangée
   * par famille, plus une planche-contact pour tout voir d'un coup.
   *
   * TROIS CHOSES QU'ON N'EXPORTE PAS, et chacune pour une raison :
   *   • les CHAMPS pleine-carte (nappe d'eau, masques de brume, terrain) — repeints à chaque
   *     partie depuis les données de la sim, propres à la graine : les retoucher ne mène nulle part ;
   *   • les SURFACES de composition (le voile de nuit) — une cible de rendu WebGL, pas un dessin ;
   *   • les cartes de NORMALES des textures `_lit` — `normalFromCanvas` les redérive de l'albédo à
   *     chaque boot. Retoucher l'albédo suffit : le relief suit tout seul.
   *
   * Les clés qui partagent le MÊME dessin (typiquement `x` et `x_lit`) sortent en UN fichier, et
   * les doublons sont listés dans `art-export/index.html`. Sans ça, on retoucherait `cl-bush.png`
   * pendant que le jeu affiche `cl-bush_lit`.
   *
   * Autonome (aucun `--dev`).
   */
  async png(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(2000)

    const dessins = await page.evaluate(() => {
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/
      const list = window.__BRAISES__.scene.textures.list
      const out = []
      for (const k of Object.keys(list)) {
        if (k.startsWith('__') || UUID.test(k)) continue
        const t = list[k]
        const s = t.source?.[0]
        if (!s?.isCanvas) continue // une cible de rendu WebGL n'a pas de canvas à sortir
        if (s.width > 500) continue // les champs pleine-carte : repeints par graine, pas de l'art
        out.push({ key: k, w: s.width, h: s.height, png: t.getSourceImage().toDataURL('image/png') })
      }
      return out
    })

    // MÊME DESSIN, PLUSIEURS CLÉS. On dédoublonne sur le contenu du PNG, et le fichier prend le
    // nom le plus COURT du groupe (donc `cl-bush` plutôt que `cl-bush_lit`) : c'est celui qu'on a
    // envie d'ouvrir. Les autres clés sont déclarées comme alias dans la planche.
    const parImage = new Map()
    for (const d of dessins) {
      const g = parImage.get(d.png) ?? { cles: [], w: d.w, h: d.h }
      g.cles.push(d.key)
      parImage.set(d.png, g)
    }

    const DIR = resolve(ROOT, 'art-export')
    rmSync(DIR, { recursive: true, force: true }) // un export périmé qui traîne ment sur ce qui existe
    const famille = (k) => (k.includes('-') ? k.slice(0, k.indexOf('-')) : 'divers')
    const fichiers = []
    for (const [png, g] of parImage) {
      g.cles.sort((a, b) => a.length - b.length || a.localeCompare(b))
      const nom = g.cles[0]
      const fam = famille(nom)
      mkdirSync(`${DIR}/${fam}`, { recursive: true })
      writeFileSync(`${DIR}/${fam}/${nom}.png`, Buffer.from(png.split(',')[1], 'base64'))
      fichiers.push({ fam, nom, w: g.w, h: g.h, alias: g.cles.slice(1) })
    }
    fichiers.sort((a, b) => a.fam.localeCompare(b.fam) || a.nom.localeCompare(b.nom))

    // QUEL FICHIER EST CELUI QU'ON VOIT ? Le rendu bascule sur `<clé>_lit` dès que l'éclairage est
    // armé — c'est-à-dire presque toujours (`snapshot-view.ts`). Quand l'albédo `_lit` DIFFÈRE de
    // sa base, les deux sortent en deux fichiers, et retoucher la base ne changerait rien à
    // l'écran. La planche le dit, sinon on retouche le repli en croyant retoucher le jeu.
    const noms = new Set(fichiers.map((f) => f.nom))
    for (const f of fichiers) {
      f.ecran = f.nom.endsWith('_lit') || f.nom.endsWith('_lit_m')
      f.repli = noms.has(`${f.nom}_lit`)
    }

    // LA PLANCHE-CONTACT. Du pixel art de 12 px ne se juge pas à 12 px : on l'affiche au ×4, en
    // NEAREST, sur le fond du jeu. C'est la seule façon de VOIR ce qu'on a.
    const fams = [...new Set(fichiers.map((f) => f.fam))]
    const vignette = (f) =>
      '<figure class="' + (f.repli ? 'repli' : '') + '"><img src="' + f.fam + '/' + f.nom + '.png" width="' + f.w * 4 + '" height="' + f.h * 4 + '">' +
      '<figcaption>' + f.nom + (f.ecran ? ' <b>◆</b>' : '') + (f.repli ? ' <i>repli</i>' : '') +
      '<br><small>' + f.w + '×' + f.h +
      (f.alias.length ? ' · = ' + f.alias.join(', ') : '') + '</small></figcaption></figure>'
    const html = [
      '<!doctype html><meta charset="utf-8"><title>BRAISES — planche d\'art</title>',
      '<style>body{background:#0e0e12;color:#cfc7b6;font:13px/1.5 monospace;margin:24px}',
      'h1{font-size:18px}h2{font-size:15px;color:#e8c66a;border-bottom:1px solid #2a2622;padding-bottom:4px;margin-top:32px}',
      'img{image-rendering:pixelated;background:#1a1720;display:block;margin:0 auto 6px}',
      'section{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end}',
      'figure{margin:0;text-align:center;max-width:200px}small{color:#8a8272}',
      'figure.repli{opacity:.45}b{color:#e8c66a}i{color:#8a8272;font-style:normal}</style>',
      '<h1>' + fichiers.length + ' dessins · ' + dessins.length + ' clés · ×4, NEAREST</h1>',
      '<p>Retoucher un PNG ne change RIEN au jeu tant que le chargeur n\'est pas branché : ' +
        'l\'art est encore peint par code au boot. Voir docs/inventaire-sprites.md.</p>',
      '<p><b>◆</b> = ce que l\'écran affiche vraiment (l\'éclairage est armé en jeu). ' +
        '<i>repli</i> grisé = la version non éclairée du même sujet, doublée par un <code>_lit</code> ' +
        'différent : la retoucher ne se verrait pas. <code>=</code> liste les autres clés qui ' +
        'partagent EXACTEMENT ce dessin — un fichier, plusieurs usages.</p>',
      ...fams.map((fam) =>
        '<h2>' + fam + '-* (' + fichiers.filter((f) => f.fam === fam).length + ')</h2><section>' +
        fichiers.filter((f) => f.fam === fam).map(vignette).join('') + '</section>',
      ),
    ].join('\n')
    writeFileSync(`${DIR}/index.html`, html)

    const alias = fichiers.filter((f) => f.alias.length)
    console.log(`\n${dessins.length} clés exportables → ${fichiers.length} fichiers PNG (${alias.length} dessins portent plusieurs clés)`)
    for (const fam of fams) {
      console.log(`  ${String(fichiers.filter((f) => f.fam === fam).length).padStart(4)}  ${fam}-*`)
    }
    console.log(`\n${fichiers.filter((f) => f.ecran).length} fichiers sont ce que l'écran affiche (◆), ${fichiers.filter((f) => f.repli).length} sont des replis non éclairés`)

    // ON REGARDE LA PLANCHE. Une planche-contact qu'on n'a pas vue peut être une page de cadres
    // vides (chemin faux, PNG vide) sans que rien ne le dise. Dans un ONGLET NEUF : capturer la
    // page du jeu après l'avoir quittée fait échouer le compositeur (contexte WebGL démonté).
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 1400 } })
    const onglet = await ctx.newPage()
    await onglet.goto(`file://${DIR}/index.html`)
    await onglet.waitForTimeout(500)
    await onglet.screenshot({ path: `${OUT}/art-planche.png` })
    await ctx.close()
    console.log(`\nart-export/index.html — la planche-contact (aperçu : ${OUT}/art-planche.png)`)
    console.log(`art → ${DIR}`)
  },

  /**
   * QU'EST-CE QU'ON DESSINE, AU JUSTE ? (inventaire des textures)
   *
   * Tout l'art du jeu est peint par code au boot — aucun binaire dans le dépôt. La CONSÉQUENCE,
   * c'est qu'on n'a pas de dossier d'assets à ouvrir pour savoir ce qui existe : la seule liste
   * qui ne mente pas est celle que Phaser tient en mémoire. On la lit.
   *
   * On ne compte pas des fichiers : on lit `textures.list`, avec pour chaque entrée sa taille, son
   * nombre de frames et sa NATURE (canvas peint une fois vs. surface de composition redessinée
   * chaque frame). C'est cette distinction qui sépare l'ART du décor technique.
   *
   * Autonome (aucun `--dev`) : rien à téléporter, on lit ce que le boot a produit. Les familles
   * conditionnelles (cendre du jour 58, brumes de la Combe…) n'y seront pas — c'est attendu, et
   * le delta est justement ce qu'un inventaire doit dire.
   */
  async textures(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(2000) // les couches du monde (eau, brume, poissons) montent après le boot

    const inv = await page.evaluate(() => {
      const list = window.__BRAISES__.scene.textures.list
      return Object.keys(list).map((k) => {
        const t = list[k]
        const s = t.source?.[0]
        return {
          key: k,
          w: s?.width ?? 0,
          h: s?.height ?? 0,
          frames: t.frameTotal ?? 0,
          canvas: Boolean(s?.isCanvas),
          // Une DynamicTexture porte sa propre caméra et se redessine : c'est une SURFACE,
          // pas un dessin. `isRenderTexture` la trahit quel que soit le renderer.
          dynamique: Boolean(s?.isRenderTexture || t.renderTarget || t.camera),
        }
      })
    })

    inv.sort((a, b) => a.key.localeCompare(b.key))
    writeFileSync(`${OUT}/inventaire-textures.json`, JSON.stringify(inv, null, 2))

    // TROIS CHOSES QUI NE SONT PAS DE L'ART, et qu'il faut sortir du compte sous peine de
    // publier un nombre faux :
    //   • les natives de Phaser (`__DEFAULT`…) ;
    //   • un canvas par `Phaser.Text` VIVANT — Phaser leur donne une clé UUID. C'est du texte ;
    //   • les surfaces de composition (DynamicTexture), redessinées chaque frame : le voile de
    //     nuit est une surface plein écran, pas un dessin.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/
    const natives = inv.filter((t) => t.key.startsWith('__'))
    const surfaces = inv.filter((t) => t.dynamique)
    const textes = inv.filter((t) => UUID.test(t.key) && !t.dynamique)
    const art = inv.filter((t) => !t.key.startsWith('__') && !UUID.test(t.key) && !t.dynamique)

    // `_lit` (albédo + normale) et `_lit_m` (miroir pré-retourné) sont DÉRIVÉS d'un dessin de
    // base : les compter comme des sprites doublerait l'inventaire pour rien.
    const litm = art.filter((t) => t.key.endsWith('_lit_m'))
    const lit = art.filter((t) => t.key.endsWith('_lit'))
    const base = art.filter((t) => !t.key.endsWith('_lit') && !t.key.endsWith('_lit_m'))
    // Un « champ » est peint à la taille de la CARTE (nappe d'eau, masque de brume) : c'est une
    // couche, pas un sujet.
    const champs = base.filter((t) => t.w > 500)

    console.log(`\n${inv.length} textures : ${natives.length} natives Phaser + ${textes.length} canvas de texte + ${surfaces.length} surface(s) de composition + ${art.length} dessins`)
    console.log(`dessins : ${base.length} de base (dont ${champs.length} champs pleine-carte → ${base.length - champs.length} SPRITES) + ${lit.length} _lit + ${litm.length} _lit_m`)

    // Par famille : le préfixe avant le premier tiret dit à quel système appartient le dessin.
    const familles = {}
    for (const t of base) {
      const f = t.key.includes('-') ? t.key.slice(0, t.key.indexOf('-')) : '(sans préfixe)'
      ;(familles[f] ??= { base: 0, lit: 0, m: 0 }).base++
    }
    for (const t of lit) {
      const f = t.key.includes('-') ? t.key.slice(0, t.key.indexOf('-')) : '(sans préfixe)'
      ;(familles[f] ??= { base: 0, lit: 0, m: 0 }).lit++
    }
    for (const t of litm) {
      const f = t.key.includes('-') ? t.key.slice(0, t.key.indexOf('-')) : '(sans préfixe)'
      ;(familles[f] ??= { base: 0, lit: 0, m: 0 }).m++
    }
    console.log(`\n  base   _lit  _lit_m  famille`)
    for (const [f, a] of Object.entries(familles).sort((x, y) => y[1].base - x[1].base)) {
      console.log(`  ${String(a.base).padStart(4)}  ${String(a.lit).padStart(5)}  ${String(a.m).padStart(6)}  ${f}-*`)
    }
    console.log(`\nchamps : ${champs.map((t) => `${t.key} (${t.w}×${t.h})`).join(', ')}`)
    if (surfaces.length) console.log(`surfaces : ${surfaces.map((t) => `${t.w}×${t.h}`).join(', ')}`)
    console.log(`\ninventaire complet → ${OUT}/inventaire-textures.json`)
    console.log(`(le relevé commenté vit dans docs/inventaire-sprites.md — le tenir à jour)`)
  },

  /**
   * LA CARTE RESSEMBLE-T-ELLE AU CROQUIS ?
   *
   * On dézoome à mort et on regarde le monde d'un coup. C'est le seul test qui puisse répondre à la
   * seule question qui compte ici : *est-ce que ça a la forme qu'Alexis a dessinée ?* Aucune
   * propriété testable ne le dira jamais — il faut la VOIR.
   *
   * Exige `--dev` (le TP n'est armé que là).
   */
  async atlas(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })

    // ON NE DEMANDE PAS À PHASER DE DÉZOOMER. La première écriture le faisait, et la page GELAIT :
    // le sol se maille à la vue, et « la vue » devenait alors les 3,75 M de tuiles de la carte. On
    // dessine donc l'atlas NOUS-MÊMES, dans un canvas, depuis les données de la sim — c'est cent
    // fois plus rapide, et c'est exactement ce qu'on veut voir : la FORME, pas le rendu.
    const png = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const PAS = 4 // une tuile sur quatre : assez pour la forme, seize fois moins de pixels
      const W = Math.floor(m.width / PAS)
      const H = Math.floor(m.height / PAS)
      const cv = document.createElement('canvas')
      cv.width = W
      cv.height = H
      const ctx = cv.getContext('2d')
      const img = ctx.createImageData(W, H)
      // La carte est PLATE : une teinte par ZONE (le squelette du monde), la roche-mur en gris,
      // le hors-carte en noir. C'est la couleur, plus la hauteur, qui distingue les pays.
      const cols = m.zonePas ? Math.ceil(m.width / m.zonePas) : 0
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const t = j * PAS * m.width + i * PAS
          const terr = m.terrain[t]
          const o = (j * W + i) * 4
          let r, g, b
          if (terr === 0) { r = 6; g = 6; b = 10 } // hors-carte
          else if (terr === 23 || terr === 5) { r = 70; g = 66; b = 78 } // roche-mur (falaise + vide plein)
          else if (m.zoneGrid) {
            const z = m.zoneGrid[Math.floor((j * PAS) / m.zonePas) * cols + Math.floor((i * PAS) / m.zonePas)] ?? 0
            r = 40 + ((z * 53) % 200)
            g = 70 + ((z * 97) % 160)
            b = 50 + ((z * 29) % 190)
          } else { r = 60; g = 100; b = 70 }
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
      // Les seuils, en rouge : on doit VOIR où l'on passe.
      ctx.fillStyle = '#ff2d2d'
      for (const s of window.__BRAISES__.scene.map.zones ?? []) void s
      return cv.toDataURL('image/png')
    })
    const b64 = png.split(',')[1]
    writeFileSync(`${OUT}/atlas.png`, Buffer.from(b64, 'base64'))
    console.log(`la vallée entière → ${OUT}/atlas.png`)
  },

  /**
   * LES MURS DE ROCHE DES FRONTIÈRES SE VOIENT-ILS ? (carte PLATE, pivot RimWorld)
   *
   * Plus de hauteur : une frontière de zone est une bande de ROCHE PLATE infranchissable, qu'on
   * longe comme une arête de montagne. Aucune propriété testable ne dira si elle se LIT à l'écran —
   * alors on va se planter à côté de quelques-unes et on REGARDE.
   *
   * Exige `--dev` (le TP n'est armé que là).
   */
  async paroi(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })

    // On cherche des murs de roche (terrain 23) bordés de sol des deux côtés — une frontière qu'on
    // longe — et on se plante juste à côté, au ras du mur.
    const sites = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const isCliff = (x, y) => m.terrain[y * m.width + x] === 23
      const walk = (x, y) => { const t = m.terrain[y * m.width + x]; return t !== 23 && t !== 0 && t !== 5 }
      const out = []
      for (let y = 30; y < m.height - 30 && out.length < 4; y += 11) {
        for (let x = 30; x < m.width - 30 && out.length < 4; x += 11) {
          if (isCliff(x, y) && walk(x - 2, y) && walk(x + 2, y)) out.push({ x: x - 3, y })
        }
      }
      return out
    })

    if (sites.length === 0) {
      console.log('AUCUN MUR DE ROCHE TROUVÉ — les zones ne seraient pas cloisonnées, ce qui est une faute.')
      return
    }

    let i = 0
    for (const s of sites) {
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
      }, s)
      await page.waitForTimeout(1400)
      await page.screenshot({ path: `${OUT}/paroi-${i}.png` })
      console.log(`mur de roche de frontière, vu depuis (${s.x}, ${s.y})`)
      i += 1
    }
  },

  /**
   * LA CENDRE AVANCE — et la vallée recule.
   *
   * On saute au dernier jour de la saison et on regarde. Sans cet outil, personne ne verrait
   * jamais ce mécanisme : en Veillée, l'acte III arrive au bout d'une heure et demie de jeu. Une
   * mécanique qu'on ne peut pas ATTEINDRE est une mécanique morte — ce projet en a déjà enterré
   * cinq, toutes trouvées EN PILOTANT LE JEU.
   *
   * Exige `--dev` : le debug n'est armé que là (inerte en build de production).
   */
  async cendre(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })

    // Le client ne TIENT pas la sim : il tient la vue du dernier snapshot. C'est elle qu'on lit —
    // le smoke lit l'état du jeu, il ne le fabrique pas.
    const lire = () => {
      const s = window.__BRAISES__.scene
      const n = s.view?.nodes
      return {
        jour: s.lastTime?.seasonDay ?? null,
        noeuds: n ? (n.size ?? n.length ?? null) : null,
      }
    }

    const avant = await page.evaluate(lire)

    // On saute au jour 58 — l'acte III, la Cendre. Le debug n'est armé qu'en `--dev`.
    await page.evaluate(() => {
      window.__BRAISES__.scene.sendAction({ type: 'debug_set_season_day', day: 58 })
    })
    await page.waitForTimeout(4000)
    const apres = await page.evaluate(lire)

    console.log(`jour ${avant.jour} → ${apres.jour} · nœuds ${avant.noeuds} → ${apres.noeuds}`)
    if (apres.noeuds !== null && avant.noeuds !== null && apres.noeuds >= avant.noeuds) {
      console.log('⚠ la cendre n\'a rien brûlé — le front n\'avance pas')
    }
    await page.screenshot({ path: `${OUT}/cendre.png` })
  },

  /**
   * LE MODAL DU FEU (spec feu-station S17-S19). On se donne un feu de camp, on le POSE,
   * et on OUVRE son modal comme le fait la touche E : deux slots (combustible + cuisson),
   * la jauge d'état, le bouton contextuel « Fonder un Foyer ». Le smoke LIT ce que le jeu
   * affiche (openFireView), il ne le fabrique pas. Exige `--dev` (grant/place/teleport armés).
   */
  async feu(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })

    // Un feu de camp + de quoi remplir le sac (pour VOIR le composant sac/ceinture partagé),
    // et on gagne du terrain DÉGAGÉ (le spawn est un village).
    // Le client n'envoie QU'UNE action par frame : on ESPACE les grants (sinon seul le dernier
    // survit). Un feu de camp + de quoi remplir le sac (bois, viande) pour voir le composant.
    for (const item of ['campfire', 'wood', 'wood', 'wood', 'wood', 'wood', 'raw_meat', 'raw_meat', 'raw_meat', 'raw_meat']) {
      await page.evaluate((it) => window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: it }), item)
      await page.waitForTimeout(130)
    }
    // On gagne du terrain DÉGAGÉ (le spawn est un village).
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.sendAction({ type: 'debug_teleport', x: s.predicted.x, y: s.predicted.y - 16 })
    })
    await page.waitForTimeout(700)

    // On TIENT le feu (case active), puis on le POSE — une tentative PAR FRAME (une action/frame),
    // la 1re tuile libre gagne et consomme le feu ; on s'arrête dès qu'un feu libre apparaît.
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const inv = s.registry.get('inv') ?? []
      const slot = inv.findIndex((c) => c && c.item === 'campfire')
      if (slot >= 0 && slot < 6) s.sendAction({ type: 'set_active_slot', slot })
    })
    await page.waitForTimeout(150)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1], [2, 0], [0, -2], [2, -1], [-2, 1]]) {
      await page.evaluate(([ox, oy]) => {
        const s = window.__BRAISES__.scene
        s.sendAction({ type: 'place_campfire', tx: Math.floor(s.predicted.x) + ox, ty: Math.floor(s.predicted.y) + oy })
      }, [dx, dy])
      await page.waitForTimeout(150)
      const done = await page.evaluate(() => (window.__BRAISES__.scene.view?.structures ?? []).some((st) => st.type === 'fire' && st.villageId === 0))
      if (done) break
    }

    // On repère le feu LIBRE qu'on vient de poser et on se TÉLÉPORTE à son pied.
    const feu = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const fires = (s.view?.structures ?? []).filter((st) => st.type === 'fire')
      const target = fires.find((st) => st.villageId === 0) ?? fires[0]
      if (!target) return null
      s.sendAction({ type: 'debug_teleport', x: target.tx + 0.5, y: target.ty + 1.0 })
      return { id: target.id, tx: target.tx, ty: target.ty, fuel: target.fuel ?? null, villageId: target.villageId }
    })
    // On LAISSE le snapshot rattraper la téléportation AVANT d'ouvrir : sinon publishOpenFire
    // juge le joueur hors de portée (ancienne position) et referme le modal aussitôt.
    await page.waitForTimeout(800)
    if (feu) await page.evaluate((id) => window.__BRAISES__.scene.registry.set('openFire', { structureId: id }), feu.id)
    await page.waitForTimeout(600)
    // Les cases du feu sont de VRAIS conteneurs : on GLISSE (action `transfer` + `zone`). On dépose
    // une PILE de 3 viandes dans l'ENTRÉE 0 (cuit une à une → l'unité en cours reste verrouillée, la
    // pile descend), et 1 dans l'ENTRÉE 1 (cuisson EN PARALLÈLE) — pour montrer stacks + sorties.
    if (feu) {
      const putMeat = async (toSlot, count) => {
        await page.evaluate(
          ({ id, toSlot, count }) => {
            const s = window.__BRAISES__.scene
            const inv = s.registry.get('inv') ?? []
            const from = inv.findIndex((c) => c && c.item === 'raw_meat')
            if (from >= 0)
              s.sendAction({
                type: 'transfer', kind: 'structure', containerId: id,
                from: { side: 'player', slot: from }, to: { side: 'container', slot: toSlot, zone: 'cookIn' }, count,
              })
          },
          { id: feu.id, toSlot, count },
        )
      }
      await putMeat(0, 3)
      await page.waitForTimeout(300)
      await putMeat(1, 1)
      await page.waitForTimeout(6500) // une passe : 1 unité de chaque entrée part en SORTIE
    }

    const diag = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const inv = s.registry.get('inv') ?? []
      const items = inv.filter(Boolean).map((c) => `${c.item}×${c.count}`)
      const v = s.registry.get('openFireView')
      const cells = (arr) => (arr ?? []).filter(Boolean).map((c) => `${c.item}×${c.count}${c.progress !== undefined ? `@${Math.round(c.progress * 100)}%` : ''}`)
      return {
        items,
        modal: v
          ? { title: v.title, state: v.state, fuel: cells(v.fuel), burnSlot: v.fuelBurnSlot, timeTicks: v.fuelTimeRemaining, cookIn: cells(v.cookIn), cookOut: cells(v.cookOut) }
          : null,
      }
    })
    console.log(`feu ${feu ? `#${feu.id} libre=${feu.villageId === 0}` : 'ABSENT'} · sac: ${JSON.stringify(diag.items)} · modal: ${JSON.stringify(diag.modal)}`)
    await page.screenshot({ path: `${OUT}/feu-modal.png` })
  },

  /**
   * LE CHARGEMENT. Deux promesses à tenir : rien du HUD ne doit paraître avant que
   * la vallée existe, et la barre doit dire la VÉRITÉ (le compte de passes de l'hôte,
   * pas une animation). On RECHARGE la page pour assister à la naissance du monde —
   * le harnais, lui, a déjà attendu `mapData` : à ce moment-là tout est fini.
   *
   * Le HUD vit SOUS l'écran de chargement (profondeur < LOADING_DEPTH) : ce qu'on
   * compte ici, c'est donc ce que l'UI peindrait par-dessous. Pendant l'attente, la
   * réponse doit être ZÉRO.
   */
  async chargement(page) {
    const sonde = () => {
      const scene = window.__BRAISES__.scene
      const ui = scene.scene.get('ui')
      const reg = scene.registry
      const p = reg.get('loadProgress')
      const peints = ui ? ui.children.list.filter((o) => o.visible && o.alpha > 0 && o.depth < 1001) : []
      return {
        pret: Boolean(reg.get('worldReady')),
        passe: p ? `${p.done}/${p.total} ${p.phase}` : null,
        frac: p ? p.done / p.total : 0,
        hud: peints.length,
        // Ce qui est peint, NOMMÉ : un compte tout seul n'aide personne à corriger.
        qui: peints.map((o) => `${o.type}${o.text ? `("${String(o.text).slice(0, 24)}")` : ''}@${o.depth}`),
        // L'écran de chargement lui-même (LOADING_DEPTH = 1001) : présent ou levé ?
        ecran: ui ? ui.children.list.some((o) => o.depth === 1001) : false,
      }
    }

    await page.goto(URL)
    // Le hook est posé dès le `create` de WorldScene — donc AVANT la fin de la génération.
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry), null, { timeout: 30000 })

    const passes = []
    let hudPendant = 0
    let quiPendant = []
    let capture = false
    let derniereAt = Date.now()
    const t0 = Date.now()
    for (;;) {
      const s = await page.evaluate(sonde)
      if (s.passe && passes.at(-1) !== s.passe) {
        passes.push(s.passe)
        derniereAt = Date.now()
      }
      if (s.hud > hudPendant) {
        hudPendant = s.hud // le PIRE vu pendant l'attente
        quiPendant = s.qui
      }
      // Un cliché à mi-chemin : la barre en plein travail.
      if (!capture && !s.pret && s.frac >= 0.4) {
        await page.screenshot({ path: `${OUT}/chargement.png` })
        capture = true
      }
      if (s.pret) break
      if (Date.now() - t0 > 90000) throw new Error('la vallée ne naît pas')
      await page.waitForTimeout(100)
    }
    // Ce que la barre NE COUVRE PAS : dernier `progress` → monde debout (transfert de
    // la carte + montage des couches côté client). Si ce trou grossit, il faudra le dire.
    const assemblage = Date.now() - derniereAt

    console.log(`génération : ${((Date.now() - t0) / 1000).toFixed(1)} s, ${passes.length} passes annoncées`)
    for (const p of passes) console.log(`   · ${p}`)
    console.log(hudPendant === 0
      ? `   ✓ pendant l'attente, RIEN du HUD n'est peint (0 objet sous l'écran de chargement)`
      : `   ✗ ${hudPendant} objet(s) du HUD peints pendant le chargement : ${quiPendant.join(', ')}`)
    console.log(`   assemblage après la dernière passe : ~${assemblage} ms (ce que la barre ne couvre pas)`)

    await page.waitForTimeout(1500) // le premier snapshot peuple le HUD
    const apres = await page.evaluate(sonde)
    await page.screenshot({ path: `${OUT}/chargement-fini.png` })
    console.log(!apres.ecran
      ? `   ✓ l'écran de chargement est levé`
      : `   ✗ l'écran de chargement colle à la vitre`)
    console.log(apres.hud >= 3
      ? `   ✓ le HUD est là (${apres.hud} objets peints : jauges, ceinture, bandeau)`
      : `   ✗ le HUD ne paraît pas (${apres.hud} objets peints)`)

    return { passes: passes.length, hudPendant, assemblage, hudApres: apres.hud }
  },

  /**
   * LA RUPTURE. L'hôte meurt : le message doit RESTER à l'écran (ce n'est pas une
   * erreur de jeu qu'on chasse en trois secondes) et le bouton RECHARGER doit
   * vraiment relancer une partie.
   *
   * On ne fabrique rien : on AVORTE la requête du worker au niveau réseau. Le
   * navigateur émet alors un `error` sur l'objet Worker — exactement l'événement
   * qu'il émettrait si le worker jetait une exception. C'est le vrai chemin.
   */
  async rupture(page) {
    await page.route('**/sim-worker*', (route) => route.abort())
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry), null, { timeout: 30000 })
    await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('fatal')), null, { timeout: 20000 })

    const motif = await page.evaluate(() => window.__BRAISES__.scene.registry.get('fatal').reason)
    console.log(`rupture : « ${motif} »`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/rupture.png` })

    // Elle PERSISTE : une erreur de jeu se serait effacée en 2,5 s.
    await page.waitForTimeout(4000)
    const tientEncore = await page.evaluate(() => {
      const ui = window.__BRAISES__.scene.scene.get('ui')
      return ui.children.list.some((o) => o.visible && o.depth === 1003) // FATAL_DEPTH
    })
    console.log(tientEncore
      ? `   ✓ l'écran de rupture tient (toujours là après 4,5 s)`
      : `   ✗ l'écran de rupture s'est effacé — le joueur reste devant un monde mort`)

    // Le bouton RECHARGER, cliqué comme un joueur le cliquerait (pixels d'écran) —
    // le worker, lui, est de nouveau servi : le rechargement doit VRAIMENT rejouer.
    await page.unroute('**/sim-worker*')
    const bouton = await page.evaluate(() => {
      const canvas = window.__BRAISES__.scene.scale.canvas.getBoundingClientRect()
      const gx = 1280 / 2
      const gy = 720 / 2 + 105 // centre du bouton (voir ui/fatal.ts)
      return { x: canvas.left + gx * (canvas.width / 1280), y: canvas.top + gy * (canvas.height / 720) }
    })
    await page.mouse.click(bouton.x, bouton.y)

    const rejoue = await page
      .waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData')), null, { timeout: 90000 })
      .then(() => true)
      .catch(() => false)
    console.log(rejoue
      ? `   ✓ RECHARGER relance vraiment une partie (la vallée est de retour)`
      : `   ✗ RECHARGER ne relance rien`)
    await page.screenshot({ path: `${OUT}/rupture-recharge.png` })
    return { motif, tientEncore, rejoue }
  },

  /**
   * L'EAU RESTE-T-ELLE DANS SON LIT ? (garde-fou — `--dev`, il se téléporte)
   *
   * Le sol est CISAILLÉ par le relief (screenY = ty·TILE − élévation·H) et l'eau est un
   * shader qui doit défaire ce cisaillement pour savoir de quelle tuile il parle. Une
   * erreur de signe là-dedans ne se voit PAS au fond de la vallée (élévation nulle → pas
   * de cisaillement) et devient monstrueuse sur un versant : l'eau se peint à des tuiles
   * de sa berge, sur la roche. C'est exactement le bug qu'on a eu (le monde du shader
   * était retourné : V est bottom-up en GL). Il ne doit pas revenir sans qu'on le sache.
   *
   * On ne juge pas à l'œil : on compte. Pour chaque pixel peint en eau, la tuile RÉELLE
   * dessous (`warp.unproject` — le calcul même du picking) est-elle de l'eau ? On mesure
   * la JUSTESSE de l'eau peinte, et non un « taux d'accord » global : sur un versant, la
   * terre écrase tout (95 % de l'écran), si bien qu'une eau totalement à côté de ses
   * berges décrochait encore 93 % d'accord. Ce qui trahit le bug, c'est l'eau peinte SUR
   * LA ROCHE : 29 pixels quand le shader est juste, 1 490 quand il est retourné.
   * (La carte est PLATE désormais : plus de cisaillement de relief — mais l'eau peut toujours se
   * peindre à côté de ses berges par une erreur de projection. On garde donc la mesure.)
   */
  async eauBerges(page) {
    const site = await page.evaluate(() => {
      const map = window.__BRAISES__.scene.registry.get('mapData')
      // N'importe quelle tuile d'eau fait l'affaire (plus d'altitude à départager).
      for (let ty = 6; ty < map.height - 6; ty += 3) {
        for (let tx = 6; tx < map.width - 6; tx += 3) {
          const t = map.terrain[ty * map.width + tx]
          if (t === 4 || t === 6) return { x: tx, y: ty }
        }
      }
      return null
    })
    if (!site) { console.log('aucune eau sur cette carte'); return }
    console.log(`eau à (${site.x}, ${site.y})`)

    await page.evaluate(({ x, y }) => {
      window.__BRAISES__.scene.registry.set('debugTeleport', { x, y, at: performance.now() })
    }, { x: site.x, y: site.y })
    await page.waitForTimeout(1700)
    await page.screenshot({ path: `${OUT}/eau-berges.png` })

    const r = await page.evaluate(async () => {
      const s = window.__BRAISES__.scene
      const map = s.registry.get('mapData')
      const cam = s.cameras.main
      const W = map.width
      const H = map.height
      const img = await new Promise((ok) => s.game.renderer.snapshot((i) => ok(i)))
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const cx = c.getContext('2d', { willReadFrequently: true })
      cx.drawImage(img, 0, 0)
      const d = cx.getImageData(0, 0, c.width, c.height).data
      // « Peint en eau » : le bleu domine franchement (l'eau du shader ET le lit baké).
      const bleu = (sx, sy) => {
        const i = (sy * c.width + sx) * 4
        return d[i + 2] > 70 && d[i + 2] > d[i] + 30
      }
      let peints = 0
      let peintSurTerre = 0
      let eauRatee = 0
      for (let sy = 60; sy < c.height - 90; sy += 5) {
        for (let sx = 20; sx < c.width - 20; sx += 5) {
          const w = cam.getWorldPoint(sx, sy)
          const p = s.warp.unproject(w.x, w.y) // LA vérité : la tuile sous ce pixel
          const tx = Math.floor(p.x / 16)
          const ty = Math.floor(p.y / 16)
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
          const t = map.terrain[ty * W + tx]
          const vraie = t === 4 || t === 6
          const peinte = bleu(sx, sy)
          if (peinte) peints++
          if (peinte && !vraie) peintSurTerre++
          if (vraie && !peinte) eauRatee++
        }
      }
      return { peints, peintSurTerre, eauRatee }
    })

    const justesse = r.peints > 0 ? 1 - r.peintSurTerre / r.peints : 0
    const pct = justesse * 100
    console.log(`eau peinte : ${r.peints} pixels, dont ${r.peintSurTerre} SUR DE LA TERRE → justesse ${pct.toFixed(1)} %`)
    console.log(pct >= 90
      ? `   ✓ l'eau tient dans son lit`
      : `   ✗ l'eau a QUITTÉ ses berges (${pct.toFixed(1)} % de justesse — la projection du shader est fausse)`)
    return { justesse }
  },

  /**
   * LE COUDE DE LA RIVIÈRE — on va REGARDER l'extérieur d'un virage.
   *
   * La worldgen trace le lit en bandes perpendiculaires au fil (zonegen-water.ts) ;
   * au coude, chaque bras s'arrête au pivot, si bien que le coin EXTÉRIEUR n'est
   * peint par aucun des deux. On lit le fil dans `mapData.fil`, on localise les
   * coudes, on mesure le bloc extérieur, et on se pose DESSUS pour le voir.
   * Exige `--dev` (TP).
   */
  async coude(page) {
    const DEMI = 3 // EAU.RIVIERE_DEMI_LIT
    const releve = await page.evaluate((DEMI) => {
      const map = window.__BRAISES__.scene.registry.get('mapData')
      const fil = map.fil
      if (!fil) return null
      const W = map.width
      const eau = (x, y) => {
        const t = map.terrain[y * W + x]
        return t === 4 || t === 6
      }
      const coudes = []
      for (let k = 1; k < fil.length - 1; k++) {
        const ax = fil[k - 1] % W
        const ay = (fil[k - 1] - ax) / W
        const bx = fil[k] % W
        const by = (fil[k] - bx) / W
        const cx = fil[k + 1] % W
        const cy = (fil[k + 1] - cx) / W
        const din = [bx - ax, by - ay]
        const dout = [cx - bx, cy - by]
        if (din[0] === dout[0] && din[1] === dout[1]) continue
        // Le bloc extérieur prédit : C + a·din − b·dout, a∈[1,DEMI], b∈[0,DEMI].
        let sec = 0
        let total = 0
        for (let a = 1; a <= DEMI; a++) {
          for (let b = 0; b <= DEMI; b++) {
            const x = bx + a * din[0] - b * dout[0]
            const y = by + a * din[1] - b * dout[1]
            total++
            if (!eau(x, y)) sec++
          }
        }
        coudes.push({ k, x: bx, y: by, din, dout, sec, total })
      }
      // Un coude bien au milieu du cours (le cœur profond y vit) et qui a de VRAIES BERGES :
      // le fil enfile des lacs (les « perles »), et un coude au milieu d'un lac ne cadre que de
      // l'eau. On exige donc de la terre à DEMI+2 pas sur la diagonale extérieure ET sur
      // l'intérieure — c'est ce qui distingue un virage de rivière d'un virage dans un plan d'eau.
      const berges = (c) => {
        const d = DEMI + 2
        const ex = c.x + d * (c.din[0] - c.dout[0])
        const ey = c.y + d * (c.din[1] - c.dout[1])
        const ix = c.x + d * (c.dout[0] - c.din[0])
        const iy = c.y + d * (c.dout[1] - c.din[1])
        return !eau(ex, ey) && !eau(ix, iy)
      }
      const bons = coudes.filter((c) => c.k > 60 && c.k < fil.length - 60 && berges(c))
      const choisi = bons[Math.floor(bons.length / 2)] ?? coudes[Math.floor(coudes.length / 2)] ?? null
      const secs = coudes.reduce((s, c) => s + c.sec, 0)
      const tot = coudes.reduce((s, c) => s + c.total, 0)
      return { n: coudes.length, secs, tot, choisi, filLen: fil.length }
    }, DEMI)

    if (!releve) { console.log('cette carte n’a pas de rivière'); return }
    console.log(`fil : ${releve.filLen} tuiles, ${releve.n} coudes`)
    console.log(`bloc extérieur du coude : ${releve.secs}/${releve.tot} tuiles SÈCHES (${(100 * releve.secs / releve.tot).toFixed(1)} %)`)
    const c = releve.choisi
    if (!c) { console.log('aucun coude'); return }
    console.log(`coude choisi : k=${c.k} pivot (${c.x},${c.y}) din=[${c.din}] dout=[${c.dout}] — ${c.sec}/${c.total} sec`)

    // On se pose AU MILIEU du bloc sec : la caméra cadre le coin fautif.
    const px = c.x + 2 * c.din[0] - 2 * c.dout[0]
    const py = c.y + 2 * c.din[1] - 2 * c.dout[1]
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.evaluate(({ x, y }) => {
      window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
    }, { x: px + 0.5, y: py + 0.5 })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}/coude-exterieur.png` })
    console.log(`→ ${OUT}/coude-exterieur.png (posé en ${px},${py})`)

    // Le même coude vu d'un peu plus loin, à l'aplomb du coin extérieur.
    await page.evaluate(({ x, y }) => {
      window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
    }, { x: px + 6.5, y: py + 6.5 })
    await page.waitForTimeout(1600)
    await page.screenshot({ path: `${OUT}/coude-recul.png` })

    // LE CADRE LARGE — par la FENÊTRE, pas par le zoom : `setZoom` fait re-baker le sol
    // sur une emprise énorme et le message CDP qui suit dépasse la limite de chaîne de Node
    // (ERR_STRING_TOO_LONG, reproduit deux fois). Agrandir la vue montre autant de monde
    // sans toucher à la caméra.
    await page.setViewportSize({ width: 1920, height: 1200 })
    await page.evaluate(({ x, y }) => {
      window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
    }, { x: px + 1.5, y: py + 1.5 })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}/coude-large.png` })

    return { coudes: releve.n, secs: releve.secs, tot: releve.tot, pivot: [c.x, c.y] }
  },

  /**
   * L'EAU. On marche jusqu'à la première rive et on la regarde — c'est la seule
   * façon de juger un shader. Trois cadrages : la berge, un gros plan sur la
   * houle, et le large.
   */
  async eau(page) {
    // Où est l'eau la plus proche ? On lit la carte, on ne la devine pas.
    const cap = await page.evaluate(() => {
      const scene = window.__BRAISES__.scene
      const map = scene.registry.get('mapData')
      const p = scene.registry.get('playerPos')
      let best = null
      let bestD = Infinity
      for (let ty = 0; ty < map.height; ty += 2) {
        for (let tx = 0; tx < map.width; tx += 2) {
          const t = map.terrain[ty * map.width + tx]
          if (t !== 4 && t !== 6) continue
          const d = (tx - p.x) ** 2 + (ty - p.y) ** 2
          if (d < bestD) {
            bestD = d
            best = { tx, ty }
          }
        }
      }
      return { best, joueur: p, d: Math.sqrt(bestD) }
    })
    if (!cap.best) {
      console.log('aucune eau sur cette carte')
      return cap
    }
    console.log(`eau la plus proche : (${cap.best.tx}, ${cap.best.ty}) — à ${cap.d.toFixed(0)} tuiles`)

    // On y marche, en corrigeant le cap toutes les demi-secondes.
    const KEYS = { E: 'KeyD', O: 'KeyA', S: 'KeyS', N: 'KeyW' }
    let held = new Set()
    const hold = async (want) => {
      for (const k of held) if (!want.has(k)) await page.keyboard.up(k)
      for (const k of want) if (!held.has(k)) await page.keyboard.down(k)
      held = want
    }
    for (let i = 0; i < 90; i++) {
      const p = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      const dx = cap.best.tx - p.x
      const dy = cap.best.ty - p.y
      if (Math.hypot(dx, dy) < 5) break
      const want = new Set()
      if (dx > 1) want.add(KEYS.E)
      else if (dx < -1) want.add(KEYS.O)
      if (dy > 1) want.add(KEYS.S)
      else if (dy < -1) want.add(KEYS.N)
      await hold(want)
      await page.waitForTimeout(500)
    }
    await hold(new Set())

    const p = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    console.log(`  joueur : (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) — sur la rive`)

    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/eau-rive.png` })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(4))
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/eau-houle.png` })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.3))
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/eau-large.png` })
    console.log('  captures : eau-rive.png / eau-houle.png / eau-large.png')
    return p
  },


  /**
   * LE MONDE EST-IL VIVANT ? On laisse la faune ambiante peupler l'anneau, on
   * compte ce qui vit vraiment autour du joueur, et on regarde si ça BOUGE :
   * deux relevés de positions à 2 s d'intervalle. Une bête immobile est un bug.
   */
  async faune(page) {
    const census = () =>
      page.evaluate(() => {
        const scene = window.__BRAISES__.scene
        const monsters = scene.view.monsters
        // La position RENDUE du sprite (relief compris), pas la coordonnée logique.
        const v = scene.cameras.main.worldView
        const par = {}
        const positions = {}
        let enVue = 0
        for (const m of monsters) {
          par[m.type] = (par[m.type] ?? 0) + 1
          const rec = scene.view.others.get(m.entityId)
          if (!rec) continue
          const s = rec.sprite
          positions[m.entityId] = `${s.x.toFixed(1)},${s.y.toFixed(1)}`
          if (s.x >= v.x && s.x <= v.x + v.width && s.y >= v.y && s.y <= v.y + v.height) enVue++
        }
        const p = scene.registry.get('playerPos')
        // Diagnostic : le champ caméra et les 3 bêtes les plus proches du joueur.
        const proches = monsters
          .map((m) => {
            const rec = scene.view.others.get(m.entityId)
            if (!rec) return null
            const d = Math.hypot(rec.sprite.x / 16 - p.x, rec.sprite.y / 16 - p.y)
            return { type: m.type, d: d.toFixed(1), sx: rec.sprite.x.toFixed(0), sy: rec.sprite.y.toFixed(0) }
          })
          .filter(Boolean)
          .sort((x, y) => x.d - y.d)
          .slice(0, 3)
        const vue = `x[${v.x.toFixed(0)}..${(v.x + v.width).toFixed(0)}] y[${v.y.toFixed(0)}..${(v.y + v.height).toFixed(0)}]`
        // La vie ambiante (hors sim) : essaims de lucioles et oiseaux en vol.
        const al = scene.ambientLife
        const essaims = al ? al.swarms.length : 0
        const oiseaux = al ? al.birds.length : 0
        // Les hardes : combien de groupes, et de quelle taille.
        const hardes = {}
        for (const m of monsters) if (m.herdId !== undefined) hardes[m.herdId] = (hardes[m.herdId] ?? 0) + 1
        const alphas = monsters.filter((m) => m.alpha).length
        const traque = monsters.filter((m) => m.stalking).length
        return {
          par, positions, enVue, total: monsters.length, vue, proches,
          joueur: `${p.x.toFixed(1)},${p.y.toFixed(1)}`,
          essaims, oiseaux, hardes: Object.values(hardes), alphas, traque,
        }
      })

    // On MARCHE. La faune naît hors-champ (spec faune R1) : un joueur planté ne
    // la croise que par la dérive du broutage. C'est en avançant qu'on entre
    // dans l'anneau — et c'est la condition réelle du jeu.
    // `--vers-la-foret` marche vers l'ouest (le massif) : c'est là que vivent les
    // sangliers et, la nuit, les lucioles. Sinon on part vers l'est (la prairie).
    const touche = process.argv.includes('--vers-la-foret') ? 'KeyA' : 'KeyD'
    const depart = await census()
    await page.keyboard.down(touche)
    await page.waitForTimeout(18000)
    const a = await census()
    console.log(`faune vivante : ${a.total} bêtes — ${JSON.stringify(a.par)}`)
    console.log(`  joueur : ${depart.joueur} → ${a.joueur} (il a marché ?)`)
    console.log(`  à l'écran : ${a.enVue} bêtes · champ caméra ${a.vue}`)
    console.log(`  hardes : ${a.hardes.length ? a.hardes.join(' + ') + ' têtes' : 'aucune'}`)
    console.log(`  ambiance : ${a.essaims} essaim(s) de lucioles · ${a.oiseaux} oiseau(x) en vol`)
    console.log(`  meutes : ${a.alphas} alpha(s) · ${a.traque} loup(s) en traque`)
    console.log(`  les 3 plus proches : ${a.proches.map((p) => `${p.type} à ${p.d}t (${p.sx},${p.sy})`).join(' · ')}`)

    await page.waitForTimeout(2000)
    const b = await census()
    await page.keyboard.up(touche)
    const communes = Object.keys(a.positions).filter((id) => id in b.positions)
    const bougé = communes.filter((id) => a.positions[id] !== b.positions[id])
    console.log(`  mouvement : ${bougé.length}/${communes.length} bêtes ont changé de position en 2 s`)
    if (communes.length > 0 && bougé.length === 0) console.log('  ✗ TOUT EST FIGÉ — la faune ne bouge pas')

    await page.screenshot({ path: `${OUT}/faune.png` })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(3.2))
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/faune-zoom.png` })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.3))

    /* ── LES COINS DE CHASSE (spec faune R17) ────────────────────────────── */
    //
    // La vallée est maintenant VIDE entre les coins : compter les bêtes « à
    // l'écran » depuis un point quelconque ne prouve donc plus rien. Ce qu'il
    // faut mesurer, c'est le CONTRASTE — le désert, puis le coin.
    console.log(`\n── Les COINS DE CHASSE (R17) : le gibier a des adresses ──`)
    const coins = await page.evaluate(() => {
      const scene = window.__BRAISES__.scene
      const p = scene.registry.get('playerPos')
      const g = scene.grounds ?? []
      let best = null
      let bestD = Infinity
      for (const c of g) {
        const d = Math.hypot(c.x - p.x, c.y - p.y)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      return { total: g.length, best, d: bestD, joueur: p }
    })
    if (!coins.best) {
      console.log(`   ✗ aucun coin de chasse dans ce monde — le gibier n'a pas d'adresse`)
    } else {
      console.log(`   ${coins.total} coins sur la carte · le plus proche à ${coins.d.toFixed(0)} tuiles`)
      if (!dev) {
        console.log(`   (s'y rendre exige le TP : relancer avec --dev)`)
      } else {
        await page.keyboard.press('P')
        await page.waitForTimeout(300)
        await page.evaluate(({ x, y }) => {
          window.__BRAISES__.scene.registry.set('debugTeleport', { x, y, at: performance.now() })
        }, coins.best)
        await page.waitForTimeout(6000) // le temps que l'anneau se peuple autour de nous
        const dedans = await census()
        console.log(`   AU COIN DE CHASSE : ${dedans.total} bêtes vivantes — ${JSON.stringify(dedans.par)}`)
        console.log(`      à l'écran : ${dedans.enVue} · hardes : ${dedans.hardes.join(' + ') || 'aucune'}`)
        console.log(dedans.enVue > 0
          ? `   ✓ le coin de chasse est HABITÉ — et la vallée, entre les coins, est vide`
          : `   ✗ le coin de chasse est vide, lui aussi : le gibier n'a plus d'adresse du tout`)
        await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(2))
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${OUT}/faune-coin.png` })
        console.log(`   capture : faune-coin.png`)
      }
    }

    console.log(`\n  captures : faune.png / faune-zoom.png`)
    return b
  },

  /**
   * LA CHASSE (spec chasse, palier I — C19). La sim est prouvée headless
   * (chasse.test.ts, A1-A9) ; ce que le NAVIGATEUR seul peut confirmer, c'est le
   * CÂBLAGE : la touche C qui ralentit et TASSE la silhouette, la jauge de
   * méfiance qui se LIT sur la bête (les teintes de BEAST_TINTS), et l'écart réel
   * entre approcher en marchant et en rampant — mesuré dans le vrai jeu, relief,
   * broutage et hardes compris. C'est aussi LE scénario du calibrage à l'œil
   * (`--headed`) : les seuils de la jauge se règlent ici, pas au raisonnement.
   *
   * Exige `--dev` : on se téléporte près du gibier (le TP passe par le registry).
   */
  async chasse(page) {
    if (!dev) {
      console.log('\n(la chasse exige le mode debug pour se téléporter — relancer avec --dev)')
      return {}
    }

    // Les seuils et les teintes, RECOPIÉS à dessein : le smoke est un témoin
    // extérieur — si la sim (HUNT.SUSPICION_*) ou la vue (BEAST_TINTS) divergent
    // un jour de ces valeurs, c'est précisément lui qui doit le dire.
    const CURIOUS = 0.35
    const TINT_CURIOUS = 0xffe9a0
    const TINT_ALERT = 0xff9d54

    await page.keyboard.press('P') // arme le debug (le TP passe par le registry)
    await page.waitForTimeout(300)

    /** Tout ce que la chasse a besoin de lire : le joueur, sa silhouette, le gibier. */
    const probe = () =>
      page.evaluate(() => {
        const scene = window.__BRAISES__.scene
        const p = scene.registry.get('playerPos')
        const prey = []
        for (const m of scene.view.monsters) {
          if (m.type !== 'deer' && m.type !== 'rabbit') continue
          const rec = scene.view.others.get(m.entityId)
          if (!rec) continue
          prey.push({
            id: m.entityId, type: m.type,
            suspicion: m.suspicion, flee: m.fleeSince, herd: m.herdId ?? null,
            x: rec.buffer.at(-1).x, y: rec.buffer.at(-1).y,
            tint: rec.sprite.tintTopLeft, h: rec.sprite.displayHeight, crouch: rec.crouch,
          })
        }
        return { p, prey, joueurH: window.__BRAISES__.scene.playerSprite.displayHeight }
      })

    const tp = (x, y) =>
      page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.registry.set('debugTeleport', { x, y, at: performance.now() })
      }, { x, y })

    // Le clavier, cap corrigé à chaque relevé (même mécanique que le scénario eau).
    let held = new Set()
    const hold = async (want) => {
      for (const k of held) if (!want.has(k)) await page.keyboard.up(k)
      for (const k of want) if (!held.has(k)) await page.keyboard.down(k)
      held = want
    }

    // La faune naît hors-champ : on marche vers la prairie jusqu'à voir du gibier.
    let s = await probe()
    if (s.prey.length === 0) {
      await hold(new Set(['KeyD']))
      const t0 = Date.now()
      while (s.prey.length === 0 && Date.now() - t0 < 30000) {
        await page.waitForTimeout(1000)
        s = await probe()
      }
      await hold(new Set())
    }
    if (s.prey.length === 0) {
      console.log('✗ aucun gibier en 30 s de marche — rien à chasser, rien à mesurer')
      return {}
    }

    // LA HARDE AU REPOS (faune R9bis) : on se pose à dix tuiles, immobile, et on
    // photographie les POSTURES — têtes au sol qui broutent, la sentinelle
    // dressée qui balaie. C'est la capture qui juge les sprites d'état à l'œil.
    const herded = s.prey.find((m) => m.herd !== null) ?? s.prey[0]
    await tp(herded.x, herded.y + 10)
    await page.waitForTimeout(1500)
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(2.4))
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/chasse-harde.png` })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.3))
    const atRest = await probe()
    const calm = atRest.prey.filter((m) => m.flee < 0).length
    console.log(`la harde au repos : ${atRest.prey.length} bêtes de gibier en jeu, ${calm} paisibles (chasse-harde.png)`)

    /**
     * UNE APPROCHE : on se téléporte à 13 tuiles au sud d'une proie CALME, puis
     * on marche droit sur elle (en rampant ou non) en notant la distance au
     * moment où elle devient CURIEUSE, ALERTÉE, puis LEVÉE. C'est la mesure du
     * banc headless (A1), refaite dans le vrai jeu.
     */
    const approach = async (label, sneak) => {
      // La proie calme la plus proche (une bête déjà nerveuse fausserait tout).
      let st = await probe()
      let target = null
      const t0 = Date.now()
      while (!target && Date.now() - t0 < 20000) {
        const calm = st.prey.filter((m) => m.suspicion < 0.1 && m.flee < 0)
        if (calm.length > 0) {
          calm.sort((a, b) => Math.hypot(a.x - st.p.x, a.y - st.p.y) - Math.hypot(b.x - st.p.x, b.y - st.p.y))
          target = calm[0]
          break
        }
        await page.waitForTimeout(1500)
        st = await probe()
      }
      if (!target) {
        console.log(`  ✗ ${label} : aucune proie calme à portée`)
        return null
      }

      await tp(target.x, target.y + 13)
      await page.waitForTimeout(900) // le TP s'applique, la sim respire, on est planté
      const baseline = (await probe()).joueurH // silhouette DEBOUT, mesurée sur place

      const marks = { curieuse: null, alertee: null, levee: null, tintCurieuse: null, tintAlertee: null }
      let squatted = null // la silhouette pendant la marche — comparée à `baseline`
      const start = Date.now()
      while (Date.now() - start < 45000) {
        st = await probe()
        const m = st.prey.find((q) => q.id === target.id)
        if (!m) {
          console.log(`  (la proie s'est dissipée — approche ${label} abandonnée)`)
          break
        }
        const d = Math.hypot(m.x - st.p.x, m.y - st.p.y)
        if (marks.curieuse === null && m.suspicion >= CURIOUS) {
          marks.curieuse = d
          marks.tintCurieuse = m.tint
          // L'INSTANT DU FACE-À-FACE (rampe seulement) : on se fige — la bête
          // reste plantée à nous fixer, tête dressée — et on photographie. C'est
          // la capture du stop-and-go : le chasseur tassé, la proie qui regarde.
          if (sneak) {
            await hold(new Set())
            await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(2.6))
            await page.waitForTimeout(350)
            await page.screenshot({ path: `${OUT}/chasse-curieuse.png` })
            await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.3))
          }
        }
        if (marks.alertee === null && m.tint === TINT_ALERT) marks.alertee = d
        if (m.flee >= 0) {
          marks.levee = d
          break
        }
        if (d <= 2) break // au contact sans l'avoir levée : l'approche est GAGNÉE
        // Cap sur la proie, allure choisie.
        const want = new Set()
        if (m.x - st.p.x > 0.7) want.add('KeyD')
        else if (m.x - st.p.x < -0.7) want.add('KeyA')
        if (m.y - st.p.y > 0.7) want.add('KeyS')
        else if (m.y - st.p.y < -0.7) want.add('KeyW')
        if (sneak) want.add('KeyC')
        await hold(want)
        if (squatted === null && held.size > (sneak ? 1 : 0)) {
          await page.waitForTimeout(250) // le temps d'une frame d'allure
          squatted = (await probe()).joueurH
        }
        await page.waitForTimeout(220)
      }
      await hold(new Set())
      return { ...marks, baseline, squatted, type: target.type }
    }

    console.log(`\n── L'approche en MARCHANT (la naïve) ──`)
    const walk = await approach('marche', false)
    if (walk) {
      console.log(`   proie : un ${walk.type} · curieuse à ${walk.curieuse?.toFixed(1) ?? '—'} t · levée à ${walk.levee?.toFixed(1) ?? 'JAMAIS'} t`)
      console.log(walk.squatted !== null && Math.abs(walk.squatted - walk.baseline) < 1
        ? `   ✓ en marchant, la silhouette reste DEBOUT (${walk.squatted?.toFixed(0)} px)`
        : `   ✗ la silhouette a bougé sans raison (${walk.baseline?.toFixed(0)} → ${walk.squatted?.toFixed(0)} px)`)
    }
    await page.screenshot({ path: `${OUT}/chasse-marche.png` })

    console.log(`\n── L'approche en RAMPANT (la touche C) ──`)
    const sneak = await approach('rampe', true)
    if (sneak) {
      console.log(`   proie : un ${sneak.type} · curieuse à ${sneak.curieuse?.toFixed(1) ?? '—'} t · alertée à ${sneak.alertee?.toFixed(1) ?? '—'} t · levée à ${sneak.levee?.toFixed(1) ?? 'JAMAIS (contact !)'} t`)
      console.log(sneak.squatted !== null && sneak.squatted < sneak.baseline * 0.85
        ? `   ✓ la silhouette du rampeur se TASSE (${sneak.baseline.toFixed(0)} → ${sneak.squatted.toFixed(0)} px)`
        : `   ✗ la silhouette ne se tasse PAS (${sneak.baseline?.toFixed(0)} → ${sneak.squatted?.toFixed(0)} px)`)
      console.log(sneak.tintCurieuse === TINT_CURIOUS
        ? `   ✓ la bête curieuse porte SA teinte (0x${TINT_CURIOUS.toString(16)}) — la jauge se lit sur elle`
        : `   ✗ teinte inattendue au seuil curieux : 0x${sneak.tintCurieuse?.toString(16)}`)
    }
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(2.6))
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/chasse-rampe.png` })
    await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.3))

    // LE VERDICT : le pas lent doit amener NETTEMENT plus près (spec chasse A1).
    if (walk?.levee != null && sneak != null) {
      const sneakBest = sneak.levee ?? 2 // arrivé au contact : mieux que toute levée
      console.log(`\n── Le verdict des allures ──`)
      console.log(sneakBest < walk.levee - 1
        ? `   ✓ ramper approche NETTEMENT plus près que marcher (${sneakBest.toFixed(1)} contre ${walk.levee.toFixed(1)} t)`
        : `   ✗ ramper ne paie pas (${sneakBest.toFixed(1)} contre ${walk.levee.toFixed(1)} t) — recalibrer HUNT`)
    }
    /* ── CHASSE II & III : le sang, le vent, l'appât ────────────────────── */

    console.log(`\n── Le SANG (C8-C9) : on blesse, et la piste existe ──`)
    // On lit l'état de la sim par la vue du client : le snapshot porte désormais
    // le sang, le vent et les piles. Rien n'est fabriqué — on regarde.
    const sang = await page.evaluate(() => {
      const v = window.__BRAISES__.scene.view
      return {
        gouttes: v.blood.length,
        vent: v.wind,
        piles: v.groundItems.length,
        blessees: v.monsters.filter((m) => m.bleedMortal || m.bleedUntil !== undefined).length,
      }
    })
    console.log(`   vent : (${sang.vent.x}, ${sang.vent.y}) — le décor doit plier dans ce sens`)
    console.log(sang.vent.x !== 0 || sang.vent.y !== 0
      ? `   ✓ le monde a un vent : approcher SOUS LE VENT veut dire quelque chose`
      : `   ✗ calme plat — l'odorat ne trahit personne (est-ce voulu ?)`)

    // On RÉCOLTE de vraies baies, puis on les JETTE (touche G) : la pile doit
    // exister dans le monde. Rien n'est fabriqué — on joue le vrai geste.
    console.log(`\n── L'APPÂT (C18) : récolter, puis jeter ce qu'on tient ──`)

    // Le buisson de baies le plus proche, lu dans les nœuds du client.
    const buisson = await page.evaluate(() => {
      const scene = window.__BRAISES__.scene
      const p = scene.registry.get('playerPos')
      let best = null
      let bestD = Infinity
      for (const n of scene.view.nodes) {
        if (n.type !== 'berry_bush' || n.stock <= 0) continue
        const d = (n.tx + 0.5 - p.x) ** 2 + (n.ty + 0.5 - p.y) ** 2
        if (d < bestD) {
          bestD = d
          best = { tx: n.tx, ty: n.ty, stock: n.stock }
        }
      }
      return best
    })

    if (!buisson) {
      console.log(`   (aucun buisson de baies en vue — l'appât se testera au banc headless, A19)`)
    } else {
      await tp(buisson.tx + 0.5, buisson.ty + 1.4) // juste en dessous : à portée de bras
      await page.waitForTimeout(900)
      // LA CUEILLETTE EST PASSÉE À LA TOUCHE E (décision 2026-07-24) : on prouve les DEUX
      // moitiés. La règle neuve vit dans un closure Phaser (`input-bindings`) que l'unité
      // ne teste pas (cf. l'en-tête d'`aim.ts`) — ce smoke est sa seule preuve automatique.
      //
      // Les baies dans le sac, à la demande. La conversion monde → ÉCRAN (pour le clic)
      // passe par le canvas RÉEL : Phaser rend en 1280×720, le CSS le met à l'échelle, et
      // `page.mouse` parle en pixels de page — sans ce facteur on clique à côté.
      const berries = () => page.evaluate(() => {
        const inv = window.__BRAISES__.scene.registry.get('inv') ?? []
        const i = inv.findIndex((s) => s && s.item === 'berries')
        return { slot: i, count: i >= 0 ? inv[i].count : 0 }
      })
      const cible = await page.evaluate(({ tx, ty }) => {
        const scene = window.__BRAISES__.scene
        const cam = scene.cameras.main
        const wx = (tx + 0.5) * 16
        const wy = (ty + 0.5) * 16
        const gx = (wx - cam.worldView.x) * cam.zoom
        const gy = (wy - cam.worldView.y) * cam.zoom
        const c = scene.scale.canvas.getBoundingClientRect()
        return {
          x: c.left + gx * (c.width / scene.scale.width),
          y: c.top + gy * (c.height / scene.scale.height),
        }
      }, buisson)

      // NÉGATIF — un clic maintenu sur le buisson ne cueille PLUS rien.
      await page.mouse.move(cible.x, cible.y)
      await page.mouse.down()
      await page.waitForTimeout(2500) // de quoi cueillir PLUSIEURS baies… si le clic cueillait encore
      await page.mouse.up()
      const parClic = await berries()
      console.log(parClic.count === 0
        ? `   ✓ le clic ne cueille plus (0 baie) — la cueillette est passée à E`
        : `   ✗ le clic a cueilli ${parClic.count} baies : la coupure du clic ne tient pas`)

      // POSITIF — on POINTE le buisson au curseur et on TAPE E UNE FOIS : le nœud ENTIER
      // vient d'un coup (recolte-maitrise P1, `whole`). On RECALCULE `cible` maintenant que
      // la caméra est POSÉE (le TP l'avait fait paner ; le clic ci-dessus lui a laissé 2,5 s)
      // — un tap unique n'a qu'une chance, là où l'ancien clic MAINTENU réessayait tant qu'on
      // tenait le bouton. Un déplacement RÉEL de souris d'abord, pour un pointermove sûr.
      const cible2 = await page.evaluate(({ tx, ty }) => {
        const scene = window.__BRAISES__.scene
        const cam = scene.cameras.main
        const gx = ((tx + 0.5) * 16 - cam.worldView.x) * cam.zoom
        const gy = ((ty + 0.5) * 16 - cam.worldView.y) * cam.zoom
        const c = scene.scale.canvas.getBoundingClientRect()
        return { x: c.left + gx * (c.width / scene.scale.width), y: c.top + gy * (c.height / scene.scale.height) }
      }, buisson)
      await page.mouse.move(cible2.x - 40, cible2.y - 40)
      await page.mouse.move(cible2.x, cible2.y)
      // DIAGNOSTIC : sur quelle tuile le curseur tombe-t-il vraiment, et y a-t-il un nœud ?
      // (worldX/Y sans relief — bon sur l'herbe plate ; sert à distinguer « E cassé » de
      //  « curseur à côté du buisson ».)
      const viseur = await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const p = s.input.activePointer
        const tx = Math.floor(p.worldX / 16), ty = Math.floor(p.worldY / 16)
        const n = s.view.nodes.find((q) => q.tx === tx && q.ty === ty && q.stock > 0)
        return { tx, ty, node: n ? n.type : null }
      })
      console.log(`   curseur → tuile ${viseur.tx},${viseur.ty} (nœud : ${viseur.node ?? 'aucun'}), buisson en ${buisson.tx},${buisson.ty}`)
      await page.keyboard.press('e')
      await page.waitForTimeout(500)
      const sac = await berries()
      console.log(sac.count > 1
        ? `   ✓ cueilli à E d'un coup : ${sac.count} baies sur un stock de ${buisson.stock} (case ${sac.slot})`
        : `   ✗ E n'a pas vidé le buisson d'un geste : ${sac.count} baie(s) pour un stock de ${buisson.stock}`)

      if (sac.count > 0 && sac.slot >= 0 && sac.slot < 6) {
        const avant = await page.evaluate(() => window.__BRAISES__.scene.view.groundItems.length)
        await page.keyboard.press(`Digit${sac.slot + 1}`) // les baies EN MAIN
        await page.waitForTimeout(300)
        await page.keyboard.press('g') // ON JETTE
        await page.waitForTimeout(700)
        const apres = await page.evaluate(() => window.__BRAISES__.scene.view.groundItems.length)
        console.log(apres > avant
          ? `   ✓ la pile est au sol (${avant} → ${apres}) — l'appât, la viande jetée, la charge larguée`
          : `   ✗ rien n'est tombé (${avant} → ${apres}) : la touche G ne jette pas`)
        await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(3))
        await page.waitForTimeout(400)
        await page.screenshot({ path: `${OUT}/chasse-appat.png` })
        await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.3))
      }
    }

    await page.screenshot({ path: `${OUT}/chasse-sol.png` })
    /* ── LE TERRIER (C16) : le trou EXISTE, et il se voit ─────────────────── */

    console.log(`\n── LE TERRIER (C16) : on doit VOIR le trou ──`)
    // Sans le trou dessiné, le lapin s'évapore — et c'est le décor qui avoue.
    // On cherche un lapin (ils sont rares), on se pose à côté, et on regarde.
    const lapin = await page.evaluate(() => {
      const scene = window.__BRAISES__.scene
      const m = scene.view.monsters.find((x) => x.type === 'rabbit' && x.burrowX !== undefined)
      if (!m) return null
      const rec = scene.view.others.get(m.entityId)
      return { x: rec ? rec.buffer.at(-1).x : m.burrowX, y: rec ? rec.buffer.at(-1).y : m.burrowY, bx: m.burrowX, by: m.burrowY }
    })

    if (!lapin) {
      console.log(`   (aucun lapin en vue — le terrier se prouve au banc headless, A17)`)
    } else {
      await tp(lapin.bx, lapin.by + 2) // JUSTE À CÔTÉ du trou : il doit crever l'écran
      await page.waitForTimeout(1200)
      const trou = await page.evaluate(() => {
        const scene = window.__BRAISES__.scene
        const cam = scene.cameras.main.worldView
        // Les terriers sont dessinés par `renderBurrows` : on compte ceux qui sont
        // à la fois VISIBLES et DANS le champ de la caméra. On lit ce qui est peint.
        const peints = scene.children.list.filter(
          (o) => o.texture && o.texture.key === 'fx-burrow' && o.visible &&
            o.x >= cam.x && o.x <= cam.x + cam.width && o.y >= cam.y && o.y <= cam.y + cam.height,
        )
        return peints.map((o) => ({
          // Position à l'ÉCRAN, en fraction : (0,0) coin haut-gauche, (1,1) bas-droite.
          fx: ((o.x - cam.x) / cam.width).toFixed(2),
          fy: ((o.y - cam.y) / cam.height).toFixed(2),
          w: o.displayWidth.toFixed(0),
          h: o.displayHeight.toFixed(0),
          depth: o.depth.toFixed(0),
          alpha: o.alpha.toFixed(2),
        }))
      })
      console.log(trou.length > 0
        ? `   ✓ le trou est PEINT à l'écran (${trou.length}) — on voit où le lapin va rentrer`
        : `   ✗ aucun terrier peint : le lapin s'évaporerait sans qu'on comprenne`)
      for (const t of trou) {
        console.log(`      · écran (${t.fx}, ${t.fy}) · ${t.w}×${t.h} px monde · depth ${t.depth} · alpha ${t.alpha}`)
      }
      await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(3.2))
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/chasse-terrier.png` })
      await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.3))
    }

    console.log(`   captures : chasse-harde.png / chasse-curieuse.png / chasse-marche.png / chasse-rampe.png / chasse-appat.png / chasse-terrier.png`)
    return { walk, sneak, sang }
  },

  /** Le jeu démarre-t-il, rend-il, et que contient sa vallée ? */
  async default(page) {
    const s = await page.evaluate(PROBE)
    console.log(`tick ${s.tick} · joueur (${s.player.x.toFixed(1)}, ${s.player.y.toFixed(1)}) · ${s.pois.length} lieux sur la carte`)
    await page.screenshot({ path: `${OUT}/monde.png` })
    return s
  },

  /**
   * LE VOILE DE MORT (audit UI/UX P1) — se lève-t-il, et NOMME-t-il la chute ?
   *
   * La mort du joueur n'avait aucun retour client. On INJECTE une mort (le registry est
   * PARTAGÉ WorldScene↔UIScene ; poser `deathMoment` avec un `at` neuf déclenche le
   * voile, exactement comme le fait `entity_died` du joueur en vrai) après avoir laissé
   * la scène se stabiliser, puis on LIT l'état DOM et on REGARDE la capture : le voile
   * doit couvrir l'écran (display flex, opacité pleine) et la cause doit être écrite.
   */
  async mort(page) {
    await page.waitForTimeout(1500) // le harnais a déjà navigué + attendu mapData ; on stabilise
    await page.evaluate(() =>
      window.__BRAISES__.scene.registry.set('deathMoment', { cause: 'cold', byEntityId: 0, killerType: null, at: 424242 }),
    )
    // UIScene lève le voile puis arme un timer Phaser de retrait. En jeu réel il tient
    // DEATH_VEIL_MS ; MAIS l'horloge du harnais headless SAUTE (le `delta` explose quand
    // le loop rattrape un stall de chargement), ce qui fait retomber le voile aussitôt.
    // On NEUTRALISE donc le minuteur ici pour vérifier la PRÉSENTATION (le voile se lève,
    // il nomme la chute) sans dépendre d'un minutage que ce harnais ne sait pas tenir.
    await page.waitForTimeout(120)
    await page.evaluate(() => {
      const ui = window.__BRAISES__.scene.scene.get('ui')
      ui.deathHideTimer?.remove()
      const dv = document.querySelector('.death-veil')
      if (dv) {
        dv.style.display = 'flex'
        dv.classList.add('dv-on')
      }
    })
    await page.waitForTimeout(500) // le fondu d'entrée (550 ms transition CSS) achève
    const dom = await page.evaluate(() => {
      const dv = document.querySelector('.death-veil')
      return {
        count: document.querySelectorAll('.death-veil').length,
        display: dv && getComputedStyle(dv).display,
        opacity: dv && Number(getComputedStyle(dv).opacity).toFixed(2),
        cause: document.querySelector('.dv-cause')?.textContent ?? '',
      }
    })
    console.log(`voile de mort : ${JSON.stringify(dom)}`)
    await page.screenshot({ path: `${OUT}/mort-voile.png` })
    if (dom.display !== 'flex' || Number(dom.opacity) < 0.8 || !dom.cause.includes('froid')) {
      console.error(`!! LE VOILE NE SE LÈVE PAS : ${JSON.stringify(dom)}`)
    }
    return dom
  },

  /**
   * LA STÈLE DE FIN DE SAISON se lève-t-elle, et COURONNE-t-elle le bon verdict ?
   *
   * Au jour 61, `season_ended` pose `seasonEnded` + `seasonVerdicts` (le registry est PARTAGÉ
   * WorldScene↔UIScene). On INJECTE ces deux-là (comme `mort` injecte `deathMoment`) plus une
   * chronique, puis on LIT le DOM et on REGARDE : la stèle couvre l'écran, nomme MON village,
   * liste les voisins, et déplie la chronique. `reducedMotion` désarme la révélation échelonnée
   * (l'horloge headless saute — même piège que le voile de mort), tout est visible d'emblée.
   */
  async saison(page) {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(1500) // stabilisation (harnais a déjà navigué + attendu mapData)
    await page.evaluate(() => {
      const r = window.__BRAISES__.scene.registry
      r.set('chronicle', [
        { day: 1, text: 'Un Feu s’est allumé : Brande-Haute.', weight: 'recit' },
        { day: 22, text: 'Le Grand Froid a commencé.', weight: 'battement' },
        { day: 47, text: 'Quelqu’un est tombé.', weight: 'intime' },
        { day: 58, text: 'L’arche a levé l’ancre — 3 à bord.', weight: 'battement' },
      ])
      // `seasonVerdicts` non-null EST le signal de fin de saison (la stèle se lève dessus).
      r.set('seasonVerdicts', {
        myVillageId: 1,
        verdicts: [
          { villageId: 1, name: 'Brande-Haute', archetype: 'foyer', score: 5, outcome: 'a sauvé 3 vies dont 2 évacuées' },
          { villageId: 2, name: 'Le Ravin', archetype: 'meute', score: 240, outcome: 'est partie les bras pleins (valeur 240)' },
          { villageId: 3, name: 'Le Val', archetype: 'neutre', score: 4, outcome: 'a survécu' },
        ],
      })
    })
    await page.waitForTimeout(400) // UIScene.update lève la stèle (reduced-motion = instantané)
    const dom = await page.evaluate(() => {
      const sv = document.querySelector('.season-veil')
      return {
        count: document.querySelectorAll('.season-veil').length,
        display: sv && getComputedStyle(sv).display,
        title: document.querySelector('.sv-title')?.textContent ?? '',
        youLabel: document.querySelector('.sv-you-label')?.textContent ?? '',
        youName: document.querySelector('.sv-you-name')?.textContent ?? '',
        youColor: (() => {
          const n = document.querySelector('.sv-you-name')
          return n ? getComputedStyle(n).color : ''
        })(),
        youOutcome: document.querySelector('.sv-you-outcome')?.textContent ?? '',
        nbCount: document.querySelectorAll('.sv-nb').length,
      }
    })
    console.log(`stèle de fin de saison : ${JSON.stringify(dom)}`)
    await page.screenshot({ path: `${OUT}/saison-stele.png` })
    // Déplier la chronique et vérifier ses lignes (les trois poids rendus).
    await page.evaluate(() => document.querySelector('.sv-chron-toggle')?.click())
    await page.waitForTimeout(200)
    const chron = await page.evaluate(() => ({
      open: getComputedStyle(document.querySelector('.sv-chronicle')).display,
      lines: document.querySelectorAll('.sv-cl').length,
      battements: document.querySelectorAll('.sv-cl.sv-battement').length,
    }))
    console.log(`chronique dépliée : ${JSON.stringify(chron)}`)
    await page.screenshot({ path: `${OUT}/saison-chronique.png` })
    if (dom.display !== 'flex' || !dom.youName.includes('Brande') || dom.nbCount !== 2) {
      console.error(`!! LA STÈLE NE SE LÈVE PAS BIEN : ${JSON.stringify(dom)}`)
    }
    return { ...dom, chron }
  },

  /**
   * LE MENU PAUSE (ESC) s'ouvre-t-il, rappelle-t-il les contrôles, et se referme-t-il ?
   *
   * On presse ESC pour de VRAI (le chemin complet : keydown → `menuOpen` → l'hôte se fige,
   * l'overlay couvre), on LIT le DOM (le tableau du clic gauche + les touches), on REGARDE
   * la capture, puis on re-presse ESC pour vérifier qu'il REFERME (une sortie qu'on ne peut
   * plus presser est un piège).
   */
  async pause(page) {
    await page.waitForTimeout(1500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const open = await page.evaluate(() => {
      const pm = document.querySelector('.pause-menu')
      return {
        display: pm && getComputedStyle(pm).display,
        menuOpen: window.__BRAISES__.scene.registry.get('menuOpen'),
        title: document.querySelector('.pm-title')?.textContent ?? '',
        clicks: document.querySelectorAll('.pm-row.pm-click').length,
        keys: document.querySelectorAll('.pm-table .pm-row:not(.pm-click)').length,
      }
    })
    console.log(`menu pause : ${JSON.stringify(open)}`)
    await page.screenshot({ path: `${OUT}/pause-menu.png` })

    // LA POLICE DES VOILES. Ils montent sur `document.body`, qui ne déclare AUCUNE
    // font-family : un `font-family:inherit` y récupère donc la police par défaut du
    // navigateur (une serif), pas celle du jeu. Le test unitaire ne pouvait pas le voir
    // (il ne connaît que la propriété camelCase de Phaser). Seul le navigateur tranche :
    // on compare la police CALCULÉE du voile à celle du HUD, qui est la référence.
    const polices = await page.evaluate(() => {
      const f = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).fontFamily : null
      }
      return { voile: f('.pm-title'), hud: f('.hud-board'), corpsPage: getComputedStyle(document.body).fontFamily }
    })
    const memePolice = polices.voile === polices.hud
    console.log(`polices : ${JSON.stringify({ ...polices, memePolice })}`)
    if (!memePolice) {
      console.error(`!! LE VOILE N'EST PAS DANS LA POLICE DU JEU : voile=${polices.voile} / hud=${polices.hud}`)
    }

    // LE GARDE-FOU D'EFFACEMENT : « nouvelle Veillée » ne doit PLUS effacer au premier clic.
    // On l'ouvre, on vérifie que la confirmation prend la place des choix, on capture — puis on
    // ANNULE. (On ne clique JAMAIS `.pm-fresh-go` ici : il effacerait la sauvegarde pour de bon.)
    await page.click('.pm-fresh')
    await page.waitForTimeout(150)
    // On lit le DISPLAY CALCULÉ, pas la propriété `hidden` : `.pm-row2{display:flex}` écrase le
    // [hidden] du navigateur, et une assertion sur `hidden` a déjà laissé passer les DEUX
    // rangées à l'écran. Ce qui compte est ce que l'œil voit.
    const armed = await page.evaluate(() => ({
      confirmShown: getComputedStyle(document.querySelector('.pm-confirm')).display !== 'none',
      choicesHidden: getComputedStyle(document.querySelector('.pm-choices')).display === 'none',
      warn: document.querySelector('.pm-warn')?.textContent?.slice(0, 32) ?? '',
      danger: Boolean(document.querySelector('.pm-fresh-go')),
      // Le bouton destructeur doit être ENTIÈREMENT à l'écran : posé en bas d'une carte qui
      // défile, il tombait sous le pli — on ne fait pas chercher un choix pareil.
      goOnScreen: (() => {
        const r = document.querySelector('.pm-fresh-go').getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      })(),
    }))
    console.log(`confirmation d’effacement : ${JSON.stringify(armed)}`)
    await page.screenshot({ path: `${OUT}/pause-effacer.png` })
    await page.click('.pm-cancel')
    await page.waitForTimeout(150)
    const disarmed = await page.evaluate(() => ({
      confirmShown: getComputedStyle(document.querySelector('.pm-confirm')).display !== 'none',
      choicesHidden: getComputedStyle(document.querySelector('.pm-choices')).display === 'none',
    }))
    console.log(`après annulation : ${JSON.stringify(disarmed)}`)
    if (!armed.confirmShown || !armed.choicesHidden || !armed.danger || !armed.goOnScreen || disarmed.confirmShown || disarmed.choicesHidden) {
      console.error(`!! LE GARDE-FOU D'EFFACEMENT NE MARCHE PAS : ${JSON.stringify({ armed, disarmed })}`)
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const closed = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector('.pause-menu')).display,
      menuOpen: window.__BRAISES__.scene.registry.get('menuOpen'),
    }))
    console.log(`après 2ᵉ ESC : ${JSON.stringify(closed)}`)
    if (open.display !== 'flex' || open.clicks !== 6 || open.keys !== 8 || closed.display !== 'none') {
      console.error(`!! LE MENU PAUSE NE MARCHE PAS : ouvert ${JSON.stringify(open)} / fermé ${JSON.stringify(closed)}`)
    }
    return { open, closed }
  },

  /**
   * LES DEUX BOUCLES GRATIFIANTES ONT-ELLES UN RETOUR ? (audit UI/UX P0.)
   *
   * FABRIQUER et MONTER D'UN CRAN étaient muets. On les rend visibles par un bandeau à part
   * — plus lourd qu'un « +2 bois ». On ne peut pas déclencher un craft en headless (il faut
   * matériaux + établi), alors on SÈME les files `crafts`/`levelUps` du registre EXACTEMENT
   * comme `publishCraft`/`publishLevelUp` le font, et `UIScene.update` les draine par le vrai
   * chemin (`drainCrafts` → `pushCraft`). On lit ensuite le DOM et on REGARDE : les deux
   * bandeaux sont là, distincts l'un de l'autre, distincts d'un toast de récolte.
   *
   * `reducedMotion` désarme la lueur du palier (la seule animation) — le bandeau, lui, doit
   * rester ENTIER et lisible sans elle (sinon le smoke, qui tourne en réduit, clignerait).
   */
  async juice(page) {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(1500) // stabilisation (harnais a déjà navigué + attendu le monde)
    // L'horloge Phaser headless COURT (elle rattrape le temps réel par bonds) et les toasts se
    // fondent dessus (2,6 s d'horloge) : à peine empilés, un bond les efface. Rien de tout ça
    // n'est un bug du jeu (in-game l'horloge avance sans saut). Pour VÉRIFIER le rendu, on sème
    // les files, on laisse UIScene drainer, et dès que les deux bandeaux sont là on FIGE la
    // boucle Phaser dans le MÊME eval (aucune frame ne s'intercale) — ni fondu ni retrait.
    let frozen = false
    for (let i = 0; i < 12 && !frozen; i++) {
      await page.evaluate(() => {
        const r = window.__BRAISES__.scene.registry
        // Un toast de récolte d'abord — le repère par rapport auquel les deux autres doivent PESER.
        r.set('pickups', [{ item: 'wood', count: 2 }])
        r.set('crafts', [{ item: 'axe' }])
        r.set('levelUps', [{ skill: 'woodcutting', level: 3 }])
      })
      await page.waitForTimeout(40) // un tour de boucle UIScene suffit à drainer + empiler
      frozen = await page.evaluate(() => {
        const n = document.querySelectorAll('.hc-toast.hc-craft, .hc-toast.hc-levelup').length
        if (n >= 2) {
          window.__BRAISES__.scene.game.loop.sleep() // fige l'horloge : les bandeaux ne s'effacent plus
          return true
        }
        return false
      })
    }
    await page.screenshot({ path: `${OUT}/juice-toasts.png` })
    const dom = await page.evaluate(() => {
      const craft = document.querySelector('.hc-toast.hc-craft')
      const lvl = document.querySelector('.hc-toast.hc-levelup')
      const cs = craft && getComputedStyle(craft)
      const ls = lvl && getComputedStyle(lvl)
      const rect = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      }
      return {
        vp: { w: window.innerWidth, h: window.innerHeight },
        toasts: document.querySelectorAll('.hc-toast').length,
        craftTag: document.querySelector('.hc-craft-tag')?.textContent ?? '',
        craftItem: document.querySelector('.hc-craft-item')?.textContent ?? '',
        craftVisible: Boolean(cs && cs.display !== 'none' && Number(cs.opacity) > 0),
        craftBg: cs ? cs.backgroundImage.slice(0, 24) : null,
        craftRect: rect(craft),
        lvlSkill: document.querySelector('.hc-lvl-skill')?.textContent ?? '',
        lvlNum: document.querySelector('.hc-lvl-num')?.textContent ?? '',
        lvlVisible: Boolean(ls && ls.display !== 'none' && Number(ls.opacity) > 0),
        lvlRect: rect(lvl),
      }
    })
    console.log(`jus des boucles : ${JSON.stringify(dom)}`)
    const ok =
      dom.craftTag === 'FABRIQUÉ' && dom.craftItem && dom.craftVisible &&
      dom.lvlSkill === 'Bûcheron' && dom.lvlNum === 'NIVEAU 3' && dom.lvlVisible
    if (!ok) console.error(`!! LES BANDEAUX FABRIQUÉ/NIVEAU NE S'AFFICHENT PAS : ${JSON.stringify(dom)}`)
    return dom
  },

  /**
   * LE JOUEUR SAIT-IL QUE SA PARTIE EST À L'ABRI ? (sprint AAA — sauvegardes.)
   *
   * L'hôte autosauvait toutes les 30 s et à la sortie, mais ne le DISAIT jamais : aucune
   * trace à l'écran. Dans un jeu où l'on peut perdre une heure de veillée, ce silence est une
   * angoisse. Test de BOUT EN BOUT, sans rien simuler : ESC met en pause → le client envoie
   * `pause` → l'hôte ÉCRIT vraiment → il répond `saved` → le HUD l'affiche. On referme le
   * menu pour dégager le HUD, puis on FIGE la boucle dès l'indicateur posé (l'horloge headless
   * court et l'effacerait avant la capture — même piège que les bandeaux).
   */
  async sauvegarde(page) {
    await page.waitForTimeout(1500)
    await page.keyboard.press('Escape') // → pause → l'hôte écrit pour de vrai
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape') // on referme : le menu couvrait le HUD
    let frozen = false
    for (let i = 0; i < 15 && !frozen; i++) {
      await page.waitForTimeout(40)
      frozen = await page.evaluate(() => {
        const el = document.querySelector('.hc-save')
        if (el && getComputedStyle(el).display !== 'none' && el.textContent) {
          window.__BRAISES__.scene.game.loop.sleep() // fige : l'indicateur ne s'efface plus
          return true
        }
        return false
      })
    }
    const dom = await page.evaluate(() => {
      const el = document.querySelector('.hc-save')
      const cs = el && getComputedStyle(el)
      return {
        texte: el?.textContent ?? '',
        visible: Boolean(cs && cs.display !== 'none' && Number(cs.opacity) > 0),
        echec: el?.classList.contains('hc-save-ko') ?? null,
        // La preuve que le message a bien traversé l'hôte → le client (et pas un affichage en l'air).
        etat: window.__BRAISES__.scene.registry.get('saveState') ?? null,
      }
    })
    console.log(`sauvegarde : ${JSON.stringify(dom)}`)
    await page.screenshot({ path: `${OUT}/sauvegarde.png` })
    if (!dom.visible || !dom.etat || dom.etat.ok !== true || dom.echec) {
      console.error(`!! L'INDICATEUR DE SAUVEGARDE NE VA PAS : ${JSON.stringify(dom)}`)
    }
    return dom
  },

  /**
   * LA RACINE A-T-ELLE UN HORIZON ? (mandat T0 — « pousser à l'exploration ».)
   *
   * La zone de départ était la SEULE du jeu sans repère perçant la canopée : ses cinq lieux
   * plafonnaient à 50 px pour une canopée à 44, donc rien ne se voyait venir et rien
   * n'indiquait de direction. On vérifie dans le VRAI jeu que le Grand Chêne est là, qu'il
   * est UNIQUE (deux « grands » chênes, et il n'y a plus de repère du tout), et que son art
   * dépasse réellement la cime des arbres.
   */
  async chene(page) {
    await page.waitForTimeout(1500)
    const vu = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const zones = sc.map?.zones ?? []
      const chenes = zones.filter((z) => z.kind === 'chene')
      // LE FILON AFFLEURANT : le teaser de fer était un nœud perdu à la tuile la plus lointaine
      // d'une zone de 700 000 tuiles — introuvable par construction. Devenu un LIEU, il doit
      // exister, être unique, ET porter son minerai (sinon on aurait déplacé le problème).
      const filons = zones.filter((z) => z.kind === 'filon')
      const f = filons[0]
      const veines = (sc.view?.nodes ?? []).filter((n) => n.type === 'iron_vein')
      const veineSurLeFilon = f
        ? veines.some((n) => n.tx >= f.x - 1 && n.tx <= f.x + f.w && n.ty >= f.y - 1 && n.ty <= f.y + f.h)
        : false
      return {
        nombre: chenes.length,
        nom: chenes[0]?.name ?? null,
        filons: filons.length,
        veinesDeFer: veines.length,
        veineSurLeFilon,
        filonDessine: sc.textures?.exists?.('poi-filon') ?? null,
        // Les textures sont générées au boot. `poi-chene-crown` n'existe QUE si l'art déclare
        // un `crown` — c'est donc la preuve mécanique qu'il perce la canopée, et pas une
        // déclaration d'intention : sans crown, pas de texture, pas d'horizon.
        texture: sc.textures?.exists?.('poi-chene') ?? null,
        percheLaCanopee: sc.textures?.exists?.('poi-chene-crown') ?? null,
      }
    })
    console.log(`grand chêne : ${JSON.stringify(vu)}`)
    if (vu.nombre !== 1) {
      console.error(`!! LA RACINE N'A PAS SON REPÈRE UNIQUE (${vu.nombre} chêne(s)) — pas d'horizon`)
    }
    if (!vu.texture || !vu.percheLaCanopee) {
      console.error(`!! LE GRAND CHÊNE NE PERCE PAS LA CANOPÉE : ${JSON.stringify(vu)}`)
    }
    if (vu.filons !== 1 || !vu.filonDessine) {
      console.error(`!! LE FILON AFFLEURANT MANQUE OU NE SE DESSINE PAS : ${JSON.stringify(vu)}`)
    }
    if (!vu.veineSurLeFilon) {
      console.error(`!! LE MINERAI N'EST PAS SUR LE FILON — le teaser reste introuvable : ${JSON.stringify(vu)}`)
    }
    return vu
  },

  /**
   * LA CARTE SE DÉCOUVRE-T-ELLE EN MARCHANT ? (spec worldgen R19 — brouillard de guerre.)
   *
   * Décision d'Alexis du 2026-07-14, restée non implémentée : la forme de la vallée était
   * acquise dès la première seconde. On vérifie les deux moitiés de la promesse : au spawn la
   * carte est FERMÉE (on ne connaît qu'un disque autour de soi), et MARCHER l'ouvre.
   */
  async brouillard(page) {
    await page.waitForTimeout(1500)
    const part = () => page.evaluate(() => {
      const f = window.__BRAISES__.scene.registry.get('fog')
      if (!f) return null
      let n = 0
      for (let i = 0; i < f.vu.length; i++) n += f.vu[i]
      return +(n / f.vu.length).toFixed(5)
    })
    const auSpawn = await part()

    // La carte, fermée : c'est l'image qui dit tout.
    await page.keyboard.press('m')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/brouillard-spawn.png` })
    await page.keyboard.press('m')
    await page.waitForTimeout(200)

    // ON MARCHE — vraiment, au clavier, comme un joueur. Quatre longues foulées vers l'est.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.down('d')
      await page.waitForTimeout(900)
      await page.keyboard.up('d')
      await page.waitForTimeout(120)
    }
    const apresMarche = await part()

    await page.keyboard.press('m')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/brouillard-apres-marche.png` })
    await page.keyboard.press('m')

    console.log(`brouillard : spawn ${auSpawn} → après marche ${apresMarche}`)
    if (auSpawn === null || auSpawn > 0.02) {
      console.error(`!! LA CARTE N'EST PAS FERMÉE AU SPAWN (${auSpawn}) — il n'y a rien à découvrir`)
    }
    if (apresMarche !== null && auSpawn !== null && apresMarche <= auSpawn) {
      console.error(`!! MARCHER N'OUVRE PAS LA CARTE (${auSpawn} → ${apresMarche}) — le brouillard ne suit pas les pas`)
    }
    return { auSpawn, apresMarche }
  },

  /**
   * LE MOUVEMENT RÉDUIT EST-IL RESPECTÉ ? (sprint AAA — accessibilité.)
   *
   * L'UI est montée en DOM par une dizaine de modules qui animent chacun les leurs ; garder
   * chacun séparément, c'est en oublier un. Un garde-fou GLOBAL vit donc dans `index.html`.
   * On le prouve dans les deux sens — c'est ce qui distingue une règle qui MARCHE d'une règle
   * qui a simplement tout éteint : en `reduce` la durée tombe à ~0, en `no-preference` elle
   * revient. On vérifie aussi qu'on a écrasé la DURÉE et non mis `none` : `transitionend`
   * doit encore se déclencher, sinon une UI qui l'attend resterait bloquée.
   */
  async mouvement(page) {
    await page.waitForTimeout(1200)
    await page.keyboard.press('Escape') // le menu pause porte une transition d'opacité (.2s)
    await page.waitForTimeout(250)
    const read = () => page.evaluate(() => {
      const pm = document.querySelector('.pause-menu')
      return pm ? getComputedStyle(pm).transitionDuration : null
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reduit = await read()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const normal = await read()

    // LE VRAI DÉPENDANT : `death-veil` ne pose `display:none` QUE sur `transitionend` (aucun
    // timer de secours). Si écraser la durée tuait l'événement, le voile de mort resterait
    // affiché à jamais. On rejoue donc son cycle EXACT (show → hide) en mouvement réduit.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const veil = await page.evaluate(() => new Promise((resolve) => {
      const dv = document.querySelector('.death-veil')
      if (!dv) return resolve({ absent: true })
      dv.style.display = 'flex'
      void dv.offsetWidth
      dv.classList.add('dv-on') // show()
      setTimeout(() => {
        dv.classList.remove('dv-on') // hide() — la suite ne tient QUE sur transitionend
        setTimeout(() => resolve({ display: dv.style.display, opacity: getComputedStyle(dv).opacity }), 500)
      }, 120)
    }))

    const secs = (v) => (v ? parseFloat(v) : NaN)
    console.log(`mouvement réduit : ${JSON.stringify({ reduit, normal, voileDeMortRefermé: veil })}`)
    if (!(secs(reduit) < 0.01) || !(secs(normal) > 0.05) || veil.display !== 'none') {
      console.error(`!! LE GARDE-FOU DE MOUVEMENT RÉDUIT NE VA PAS : réduit=${reduit} normal=${normal} voile=${JSON.stringify(veil)}`)
    }
    await page.keyboard.press('Escape')
    return { reduit, normal, endFires }
  },

  /**
   * LES ACTEURS SONT-ILS POSÉS AU SOL ? (sprint AAA, vague 1 — rendu #1 : ombres de contact.)
   *
   * Sans ombre, les billboards FLOTTENT. On en pose une flaque sombre sous les pieds de chaque
   * acteur (joueur, PNJ, bête). Question de rendu → il faut la VOIR : on capture l'avatar au
   * spawn (plein jour, ~9h — l'ombre porte sur le sol clair). L'ombre est CONSTANTE (occlusion
   * ambiante, pas ∝ lumière), donc aucune heure à forcer : pas besoin de `--dev`.
   *
   * On vérifie AUSSI l'invariant qui ne se voit pas au screenshot (l'avis reviewer) : l'ombre
   * du joueur existe, est VISIBLE, et sa profondeur est JUSTE SOUS celle de l'avatar.
   */
  /**
   * L'ÉTALONNAGE — « la brume s'AJOUTE, la lumière se MULTIPLIE ».
   *
   * Le voile de l'heure est passé en `MULTIPLY` (cf. `night-veil.ts`). Ce scénario ne demande
   * pas si c'est joli : il MESURE, sur les vrais pixels rendus par swiftshader, les deux choses
   * que le changement promet — et il rend les chiffres, pas un avis.
   *
   *   1. LE PLANCHER DE NOIR. L'ancien voile ajoutait `teinte·α` à TOUT : à minuit, plus rien
   *      ne pouvait être plus sombre que ce plancher. On lit donc le 1er centile de luminance :
   *      il doit s'effondrer vers 0.
   *   2. LE CONTRASTE. On lit l'écart-type de luminance RAPPORTÉ à la moyenne (σ/µ) — la version
   *      « image entière » du contraste de Weber que `lighting.test.ts` prouve conservé. Un
   *      mélange l'écrase, un multiply le laisse intact : à minuit il doit rejoindre celui de midi.
   *
   * Et il vérifie l'essentiel avant tout le reste : que MULTIPLY RENDE, sous swiftshader. Un
   * blend cassé donnerait un écran noir ou blanc — donc µ au plancher ou au plafond.
   *
   * Exige `--dev` (le réglage de l'heure est un pouvoir de debug, inerte en build de prod).
   */
  async etalonnage(page) {
    if (!dev) {
      console.log("\n(l'étalonnage exige le mode debug pour régler l'heure — relancer avec --dev)")
      return {}
    }
    await page.waitForTimeout(1500)

    /** Statistiques de LUMINANCE sur la frame rendue. Rec. 709, sur les pixels du monde
     *  seulement : on saute la bande du HUD en bas, qui ne subit aucun étalonnage. */
    const mesurer = async () =>
      page.evaluate(async () => {
        const s = window.__BRAISES__.scene
        const img = await new Promise((ok) => s.game.renderer.snapshot((i) => ok(i)))
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const cx = c.getContext('2d', { willReadFrequently: true })
        cx.drawImage(img, 0, 0)
        const d = cx.getImageData(0, 0, c.width, c.height).data
        const lum = []
        for (let y = 0; y < c.height - 140; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            const i = (y * c.width + x) * 4
            lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
          }
        }
        lum.sort((a, b) => a - b)
        const moy = lum.reduce((a, b) => a + b, 0) / lum.length
        const ec = Math.sqrt(lum.reduce((a, b) => a + (b - moy) ** 2, 0) / lum.length)
        const pc = (q) => lum[Math.floor(q * (lum.length - 1))]
        return { moy, ec, cv: ec / moy, p01: pc(0.01), p50: pc(0.5), p99: pc(0.99) }
      })

    const out = {}
    for (const [nom, heure] of [
      ['midi', 12],
      ['doree', 20],
      ['minuit', 0],
    ]) {
      await page.evaluate((h) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: h }), heure)
      await page.waitForTimeout(1200) // le fondu d'air met ~0,9 s à se poser
      await page.screenshot({ path: `${OUT}/etalonnage-${nom}.png` })
      out[nom] = await mesurer()
    }

    console.log('\n  heure     µ      σ     σ/µ    p01    p50    p99')
    for (const [nom, m] of Object.entries(out)) {
      const f = (v) => String(Math.round(v * 10) / 10).padStart(6)
      console.log(`  ${nom.padEnd(7)}${f(m.moy)}${f(m.ec)}${String(Math.round(m.cv * 1000) / 1000).padStart(7)}${f(m.p01)}${f(m.p50)}${f(m.p99)}`)
    }
    // Le contraste RELATIF doit survivre à la nuit : c'est toute la promesse du multiply.
    console.log(
      `\n  contraste relatif conservé à minuit : ${Math.round((out.minuit.cv / out.midi.cv) * 100)} % de celui de midi`,
    )
    console.log(`  plancher de noir à minuit (p01) : ${Math.round(out.minuit.p01 * 10) / 10}`)
    return out
  },

  async ombres(page) {
    await page.waitForTimeout(1500) // stabilisation (harnais a déjà navigué + attendu mapData)
    await page.screenshot({ path: `${OUT}/ombres-avatar.png` })
    // Gros plan sur les pieds de l'avatar (position écran calculée depuis la caméra) : c'est
    // là qu'on JUGE la flaque — assez présente pour poser, assez discrète pour ne pas tacher.
    const clip = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const cam = sc.cameras.main
      const ps = sc.playerSprite
      const sx = (ps.x - cam.worldView.x) * cam.zoom
      const sy = (ps.y - cam.worldView.y) * cam.zoom
      return { x: Math.round(sx - 70), y: Math.round(sy - 90), width: 140, height: 130 }
    })
    await page.screenshot({ path: `${OUT}/ombres-pieds.png`, clip })
    // Gros plan sur la BÊTE la plus proche : une flaque plus grosse que le lapin qu'elle
    // porte serait pire que pas d'ombre du tout (le plancher MIN_WIDTH doit rester sobre).
    const beast = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const cam = sc.cameras.main
      const ps = sc.playerSprite
      let best = null
      for (const o of sc.view.others.values()) {
        const s = o.sprite
        const sx = (s.x - cam.worldView.x) * cam.zoom
        const sy = (s.y - cam.worldView.y) * cam.zoom
        if (sx < 80 || sy < 90 || sx > window.innerWidth - 80 || sy > window.innerHeight - 60) continue
        const d = (s.x - ps.x) ** 2 + (s.y - ps.y) ** 2
        if (!best || d < best.d) best = { d, sx, sy, w: Math.round(s.displayWidth), key: o.textureKey, shadowW: Math.round(o.shadow.displayWidth) }
      }
      return best
    })
    if (beast) {
      console.log(`bête la plus proche : ${JSON.stringify({ key: beast.key, spriteW: beast.w, shadowW: beast.shadowW })}`)
      await page.screenshot({
        path: `${OUT}/ombres-bete.png`,
        clip: { x: Math.round(beast.sx - 60), y: Math.round(beast.sy - 70), width: 120, height: 110 },
      })
    } else {
      console.log('bête la plus proche : aucune à l’écran')
    }
    const dom = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const ps = sc.playerSprite
      const sh = ps?.getData ? ps.getData('shadow') : null
      return {
        hasShadow: Boolean(sh),
        visible: sh ? sh.visible : null,
        underActor: sh ? sh.depth < ps.depth : null,
        others: sc.view?.others?.size ?? 0,
      }
    })
    console.log(`ombres : ${JSON.stringify(dom)}`)
    if (!dom.hasShadow || !dom.visible || !dom.underActor) {
      console.error(`!! L'OMBRE DE CONTACT DU JOUEUR NE VA PAS : ${JSON.stringify(dom)}`)
    }

    // LA VIGNETTE : elle couvre tout le canvas. Si elle mangeait le clic, le jeu entier
    // deviendrait injouable (récolter, frapper, bâtir passent tous par un clic monde) — et
    // aucune capture ne le montrerait. On le prouve donc directement : l'élément SOUS le
    // curseur au centre de l'écran doit être le CANVAS, pas le voile.
    const vig = await page.evaluate(() => {
      const el = document.querySelector('.world-vignette')
      const cs = el && getComputedStyle(el)
      const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2))
      return {
        present: Boolean(el),
        pointerEvents: cs ? cs.pointerEvents : null,
        zIndex: cs ? cs.zIndex : null,
        hitTag: hit ? hit.tagName.toLowerCase() : null,
      }
    })
    console.log(`vignette : ${JSON.stringify(vig)}`)

    // LE BROUILLARD (spec R19) : au spawn, on ne doit connaître qu'un disque autour de soi.
    // Si la part découverte est déjà large, c'est que le brouillard ne se pose pas — et une
    // carte offerte d'emblée est exactement ce qu'on cherchait à supprimer.
    const brouillard = await page.evaluate(() => {
      const f = window.__BRAISES__.scene.registry.get('fog')
      if (!f) return { absent: true }
      let vus = 0
      for (let i = 0; i < f.vu.length; i++) vus += f.vu[i]
      return { cellules: f.vu.length, vues: vus, part: +(vus / f.vu.length).toFixed(4), cols: f.cols, rows: f.rows }
    })
    console.log(`brouillard : ${JSON.stringify(brouillard)}`)
    if (brouillard.absent || brouillard.part > 0.02) {
      console.error(`!! LE BROUILLARD NE COUVRE PAS LA CARTE AU SPAWN : ${JSON.stringify(brouillard)}`)
    }
    if (!vig.present || vig.pointerEvents !== 'none' || vig.hitTag !== 'canvas') {
      console.error(`!! LA VIGNETTE INTERCEPTE LE CLIC (ou manque) : ${JSON.stringify(vig)}`)
    }
    return { ...dom, vig }
  },

  /**
   * LE COMBAT SE VOIT-IL ? (spec tension.md — le télégraphe du GDD §7.)
   *
   * On FRAPPE pour de vrai — clic gauche dans le vide, mains nues (la sim tranche :
   * rien à récolter sous le curseur, donc on attaque) — et on regarde l'écran
   * PENDANT le wind-up (400 ms). Ce qu'on vérifie n'est pas « une image existe »,
   * c'est que la LAME EST PEINTE : le calque de combat doit avoir des traits dedans.
   */
  /**
   * LE COMBAT, DANS LE VRAI JEU (spec combat R4bis-R4quater).
   *
   * Ce scénario ne compte plus des « tracés ». Il l'a fait, et ça n'a rien prouvé : un
   * compteur de commandes de dessin dit qu'IL SE PASSE quelque chose, jamais QUOI — on
   * peut peindre une obscénité et le compteur sera content (leçon inscrite dans
   * decisions.md, 2026-07-13). Ici on lit L'ÉTAT : le snapshot que le client a reçu, et
   * la zone qu'il s'apprête à PEINDRE. Puis on REGARDE les captures.
   *
   * DEUX PIÈGES DU HARNAIS, payés cher, à ne pas refaire :
   *
   *   1. NE JAMAIS PAUSER PHASER AVEC LE BOUTON DE SOURIS ENFONCÉ. `scene.pause()`
   *      pendant un `mouse.down()` ne rend jamais la main : la page se fige, et le
   *      scénario avec. On capture donc SANS pauser — et c'est possible parce que la
   *      CHARGE dure tant qu'on tient le clic. Il n'y a aucune course contre la frame
   *      (la pause n'existait que pour attraper le wind-up, qui ne dure que 300 ms).
   *   2. UNE CAPTURE HEADLESS PREND ~1 SECONDE — donc elle ALLONGE le maintien. Un
   *      « clic bref » suivi d'une capture avant le relâchement n'est plus bref du
   *      tout : il sort CHARGÉ. Le coup simple se mesure sans capture au milieu.
   *
   * Et on prouve que le coup PART par L'ENDURANCE DÉPENSÉE, pas en guettant le wind-up :
   * un wind-up dure 300-500 ms, et le poll d'un navigateur headless le rate une fois sur
   * deux (ça m'a fait conclure « la lance ne frappe pas » — elle frappait). L'endurance,
   * elle, ne s'efface pas.
   */
  async combat(page) {
    if (!dev) {
      console.log('\n(le combat exige le mode debug pour s’armer — relancer avec --dev)')
      return {}
    }
    const box = page.viewportSize()
    const CIBLE = { x: box.width / 2 + 130, y: box.height / 2 - 10 }

    /** Mon corps selon la SIM, et la zone que le client s'apprête à PEINDRE. */
    const moi = () =>
      page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const e = s.lastEntities?.find((x) => x.id === s.playerId)
        if (!e) return null
        const held = e.activeSlot >= 0 ? (e.inventory[e.activeSlot]?.item ?? null) : null
        // `charges` = ce que le client PEINT au sol : la zone qui partirait MAINTENANT
        // (c'est la sim qui tranche — `pendingStrike`). C'est la seule chose à vérifier :
        // si elle est juste, le télégraphe ne ment pas.
        const c = s.charges?.find((x) => x.id === s.playerId)
        return {
          held,
          stam: e.stamina,
          charge: e.charge?.ticks ?? null,
          zone: c ? { shape: c.strike.shape, range: c.strike.range, arcCos: c.strike.arcCos, mur: c.ratio >= 1 } : null,
        }
      })

    /** S'armer : action de DEBUG (inerte en prod) — le joueur naît les mains vides. */
    const armer = async (item) => {
      await page.evaluate((it) => {
        const reg = window.__BRAISES__.scene.registry
        const q = reg.get('pendingActions') ?? []
        q.push({ type: 'debug_grant', item: it })
        reg.set('pendingActions', q)
      }, item)
      await page.waitForTimeout(800)
    }

    /**
     * LE COUP SIMPLE, par l'action directe (`attack`) — PAS par un clic bref.
     *
     * On ne peut pas mesurer un « clic bref » à la souris dans un navigateur headless :
     * Phaser ne traite les événements de pointeur qu'à SA frame, et une frame headless
     * peut durer une demi-seconde. Le `mouse.up()` arrive donc parfois DEUX frames après
     * le `down` — la charge a mûri entre-temps, et le « clic bref » sort chargé. On a
     * mesuré, en toute confiance, exactement le contraire de ce qu'on croyait tenir.
     *
     * L'action `attack` est le MÊME chemin de sim (le coup simple de l'arme tenue), sans
     * la loterie du framerate. Le clic bref reste couvert — mais par le test unitaire
     * (combat.test.ts A14), où le tick est maîtrisé au ticket près.
     */
    const coupSimple = async () => {
      const avant = await moi()
      await page.evaluate((c) => {
        const s = window.__BRAISES__.scene
        const q = s.registry.get('pendingActions') ?? []
        q.push({ type: 'attack', dx: c.dx, dy: c.dy })
        s.registry.set('pendingActions', q)
      }, { dx: 1, dy: -0.1 })
      // ON LIT VITE. L'endurance est déduite au DÉBUT du coup, et elle ne régénère PAS
      // pendant le wind-up : à 250 ms, la dépense est nette et entière. Attendre une
      // seconde la laissait remonter (12,5/s, plafonnée à 100) et effaçait un coup de
      // poing à 8 — le scénario concluait « rien n'est parti » d'un coup bel et bien parti.
      await page.waitForTimeout(250)
      const apres = await moi()
      return (avant?.stam ?? 0) - (apres?.stam ?? 0)
    }

    /** LE COUP TENU : on maintient, on CAPTURE la zone mûre, on relâche, on compte. */
    const coupTenu = async (ms, nom) => {
      await page.mouse.move(CIBLE.x, CIBLE.y)
      const avant = await moi()
      await page.mouse.down()
      await page.waitForTimeout(ms)
      const pendant = await moi()
      await page.screenshot({ path: `${OUT}/combat-${nom}.png` })
      await page.mouse.up()
      await page.waitForTimeout(250) // vite : la régén d'endurance efface la dépense
      const apres = await moi()
      return {
        zone: pendant?.zone ?? null,
        charge: pendant?.charge ?? 0,
        cout: (avant?.stam ?? 0) - (apres?.stam ?? 0),
      }
    }

    const out = {}
    for (const [item, nom] of [
      [null, 'poing'],
      ['spear', 'lance'],
      ['iron_axe', 'hache'],
    ]) {
      if (item) await armer(item)
      const main = (await moi())?.held ?? 'rien'
      console.log(`\n── ${nom.toUpperCase()} (en main : ${main}) ──`)

      const cout = await coupSimple()
      await page.waitForTimeout(3500) // le temps de récupérer, et de reprendre son souffle
      const tenu = await coupTenu(1500, nom) // capture À MATURITÉ : c'est LA zone qui compte
      await page.waitForTimeout(3500)

      const z = tenu.zone
      console.log(`   coup simple : ${cout > 0 ? `parti (${cout.toFixed(0)} d’endurance)` : '✗ RIEN N’EST PARTI'}`)
      console.log(`   coup tenu   : charge ${tenu.charge} ticks${z?.mur ? ' (MÛRE)' : ''}, ${tenu.cout.toFixed(0)} d’endurance`)
      console.log(z ? `   sa zone     : ${z.shape} portée ${z.range} arcCos ${z.arcCos}` : '   ✗ AUCUNE zone peinte : le joueur ne VOIT pas ce qu’il arme')
      console.log(
        tenu.cout > cout
          ? `   ✓ le coup lourd coûte plus cher (${tenu.cout.toFixed(0)} > ${cout.toFixed(0)})`
          : `   ✗ le coup lourd ne coûte pas plus que le simple`,
      )
      out[nom] = { main, zone: z, coutSimple: cout, coutLourd: tenu.cout, charge: tenu.charge }
    }

    console.log(`\n── CE QUI SÉPARE LES TROIS ARMES (et rend le choix RÉEL) ──`)
    // L'OVERHEAD : les poings chargés frappent un DISQUE posé devant — pas un arc.
    const overhead = out.poing?.zone?.shape === 'disc'
    console.log(overhead ? `   ✓ POINGS : un DISQUE au sol, devant soi (l’overhead à deux mains)` : `   ✗ les poings chargés ne posent aucun disque`)
    // L'ALLONGE : LE fait qui rend le choix d'arme réel. S'il tombe, une arme n'est
    // plus qu'un chiffre de dégâts, et le combat n'est plus qu'une échelle à monter.
    const allonge = out.lance?.zone && out.poing?.zone && out.lance.zone.range > out.poing.zone.range * 1.8
    console.log(
      allonge
        ? `   ✓ LANCE : l’allonge est RÉELLE (${out.lance.zone.range} contre ${out.poing.zone.range})`
        : `   ✗ la lance ne porte pas plus loin qu’un poing`,
    )
    // LE TOURBILLON : un cône de 360° (arcCos −1). Rien d'autre dans le jeu n'en a un.
    const tourbillon = out.hache?.zone?.arcCos <= -1
    console.log(
      tourbillon ? `   ✓ HACHE : le tourbillon fait le TOUR COMPLET (arcCos ${out.hache.zone.arcCos})` : `   ✗ la hache chargée ne fait pas le tour`,
    )

    return out
  },
  /**
   * L'ÉCRAN D'ARTISANAT/PERSONNAGE (specs craft-file F14-F15, calage Rust). Il est en
   * DOM (un voile par-dessus le canvas), plus en Phaser : on relit donc les BORNES DES
   * ÉLÉMENTS DU DOM (`getBoundingClientRect`), pas des GameObjects. Une capture qu'un
   * humain doit regarder n'est pas un garde-fou — elle ne casse jamais ; ici on VÉRIFIE.
   *
   * L'invariant qui compte (aspect 1 d'Alexis) : la CEINTURE ne change pas entre le HUD
   * en jeu et l'écran ouvert. On la mesure AVANT d'ouvrir (elle est à l'écran, en jeu),
   * puis on mesure la ceinture de l'écran, et on exige qu'elles soient AU PIXEL identiques.
   */
  async craft(page) {
    // La ceinture du HUD, mesurée EN JEU (avant TAB) : la référence de « ne change pas ».
    const beltHud = await page.evaluate(() => {
      const b = document.querySelector('.hc-belt')?.getBoundingClientRect()
      return b ? { left: b.left, top: b.top, width: b.width, height: b.height } : null
    })

    await page.keyboard.press('Tab')
    await page.waitForTimeout(400)

    const vue = await page.evaluate(() => {
      const W = window.innerWidth
      const H = window.innerHeight
      const rect = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height, cx: b.left + b.width / 2 }
      }
      const board = document.querySelector('.hud-board')?.getBoundingClientRect()
      const hch = document.querySelector('.hch')
      return {
        W, H,
        scale: board ? board.width / 1920 : 1, // planche 1920 mise à l'échelle FIT (px écran → planche)
        open: hch ? getComputedStyle(hch).display !== 'none' : false,
        belt: rect('.hch-belt'),
        bag: rect('.hch-bag'),
        perso: rect('.hch-perso'),
        art: rect('.hch-art'),
        sac: rect('.hch-sac'),
        skills: rect('.hch-skills'),
        nSkills: document.querySelectorAll('.hch-sk').length,
        nRecipes: document.querySelectorAll('.hch-rec, .hch-rec-off').length,
        weight: document.querySelector('.hch-weight')?.textContent ?? '',
      }
    })

    const { belt, bag, perso, art, sac, scale } = vue
    const near = (a, b, tol) => Math.abs(a - b) <= tol
    const brd = (px) => px / scale // px écran → px de planche (1920×1080)
    const box = (r) => (r ? `${Math.round(r.width)}×${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}` : 'absent')

    console.log(`écran ${vue.W}×${vue.H} (planche ×${scale.toFixed(3)})`)
    console.log(vue.open ? `   ✓ l'écran est ouvert` : `   ✗ l'écran ne s'est pas ouvert`)

    // 1. LA CEINTURE NE CHANGE PAS : même boîte qu'en jeu (au pixel près).
    const beltSame = Boolean(beltHud && belt
      && near(belt.left, beltHud.left, 1.5) && near(belt.top, beltHud.top, 1.5)
      && near(belt.width, beltHud.width, 1.5) && near(belt.height, beltHud.height, 1.5))
    console.log(beltSame
      ? `   ✓ la ceinture est IDENTIQUE au HUD (${box(belt)})`
      : `   ✗ la ceinture a CHANGÉ : HUD ${box(beltHud)} vs écran ${box(belt)}`)

    // 2. Le SAC est JUSTE au-dessus de la ceinture (≤20px de planche) et aligné sur elle.
    const gap = belt && bag ? brd(belt.top - bag.bottom) : null
    const sacOk = gap !== null && gap >= 0 && gap <= 20 && near(bag.left, belt.left, 2) && near(bag.right, belt.right, 2)
    console.log(sacOk
      ? `   ✓ le sac est collé au-dessus de la ceinture (${gap.toFixed(0)}px, colonnes alignées)`
      : `   ✗ sac mal posé : écart ${gap === null ? '?' : gap.toFixed(0)}px (≤20 ?), colonnes ${belt && bag ? `${Math.round(bag.left)}/${Math.round(belt.left)}` : '?'}`)

    // 3. La ceinture (donc le pavé sac) est CENTRÉE à l'écran.
    const centre = Boolean(belt && near(belt.cx, vue.W / 2, 2))
    console.log(centre ? `   ✓ la ceinture est centrée` : `   ✗ ceinture décentrée (cx ${belt && Math.round(belt.cx)} vs ${vue.W / 2})`)

    // 4. L'ARTISANAT est À CÔTÉ (à droite), sans chevaucher NI le sac NI le personnage.
    const cote = Boolean(art && sac && perso && art.left >= sac.right - 1 && art.left >= perso.right - 1)
    console.log(cote ? `   ✓ l'artisanat est à droite, sans chevaucher le pavé central` : `   ✗ l'artisanat chevauche le pavé central`)

    // 5. Le volet PERSONNAGE a son HAUT aligné sur celui de l'ARTISANAT.
    const topsAlign = Boolean(perso && art && near(perso.top, art.top, 2))
    console.log(topsAlign ? `   ✓ PERSONNAGE et ARTISANAT alignés en haut` : `   ✗ hauts désalignés : PERSONNAGE ${perso && Math.round(perso.top)} vs ARTISANAT ${art && Math.round(art.top)}`)

    // 6. Rien ne déborde de l'écran.
    const deborde = Object.entries({ belt, bag, perso, art, sac, skills: vue.skills })
      .filter(([, r]) => r && (r.left < -2 || r.right > vue.W + 2 || r.top < -2 || r.bottom > vue.H + 2))
      .map(([k]) => k)
    console.log(deborde.length === 0 ? `   ✓ rien ne déborde de l'écran` : `   ✗ hors écran : ${deborde.join(', ')}`)

    // 7. Les 4 MÉTIERS, des recettes, et la CHARGE se lisent.
    console.log(vue.nSkills === 4 ? `   ✓ les 4 métiers sont là` : `   ✗ ${vue.nSkills} métier(s) au lieu de 4`)
    console.log(vue.nRecipes > 0 ? `   ✓ ${vue.nRecipes} recettes affichées` : `   ✗ aucune recette affichée`)
    console.log(vue.weight.includes('/') ? `   ✓ la charge s'affiche : « ${vue.weight} »` : `   ✗ la charge ne s'affiche pas`)

    await page.screenshot({ path: `${OUT}/craft.png` })

    // 8. L'ONGLET MÉTIERS : on bascule (clic sur l'en-tête), on lit les 4 colonnes. La fiche
    //    vient de `skill-guide` (dérivée du sim, testée) ; ici on prouve qu'elle SE PEINT —
    //    quatre colonnes, chacune ses paliers, le SAC effacé, rien hors écran.
    await page.click('.hch-tab[data-tab="metiers"]')
    await page.waitForTimeout(250)
    const met = await page.evaluate(() => {
      const W = window.innerWidth
      const H = window.innerHeight
      const cols = Array.from(document.querySelectorAll('.hch-met-col'))
      const read = (c) => ({
        name: c.querySelector('.hch-met-name')?.textContent ?? '',
        lvl: c.querySelector('.hch-met-lvl')?.textContent ?? '',
        paliers: Array.from(c.querySelectorAll('.hch-mp')).map((p) => {
          const st = p.classList.contains('is-done') ? '✓' : p.classList.contains('is-next') ? '▶' : '·'
          return `${st}${p.querySelector('.hch-mp-lvl')?.textContent ?? ''}`
        }),
        none: c.querySelector('.hch-mp-none')?.textContent ?? null,
      })
      const panel = document.querySelector('.hch-met')
      const over = cols.filter((c) => {
        const r = c.getBoundingClientRect()
        return r.left < -2 || r.right > W + 2 || r.top < -2 || r.bottom > H + 2
      }).length
      return {
        visible: panel ? getComputedStyle(panel).display !== 'none' : false,
        sacHidden: getComputedStyle(document.querySelector('.hch-sac')).display === 'none',
        n: cols.length,
        over,
        cols: cols.map(read),
      }
    })
    console.log(met.visible ? `   ✓ l'onglet MÉTIERS s'affiche` : `   ✗ l'onglet MÉTIERS ne s'affiche pas`)
    console.log(met.n === 4 ? `   ✓ 4 colonnes de métier` : `   ✗ ${met.n} colonne(s) au lieu de 4`)
    console.log(met.sacHidden ? `   ✓ le SAC s'est effacé sous MÉTIERS` : `   ✗ le SAC déborde sur l'onglet MÉTIERS`)
    console.log(met.over === 0 ? `   ✓ aucune colonne ne déborde de l'écran` : `   ✗ ${met.over} colonne(s) hors écran`)
    for (const c of met.cols) console.log(`      ${c.name} — ${c.lvl}${c.none ? ` [${c.none}]` : ''} : ${c.paliers.join(' · ')}`)
    await page.screenshot({ path: `${OUT}/craft-metiers.png` })

    // 9. LE NŒUD CHAMPIGNON (verbe 3 révisé) : flat + albédo `_lit` + NORMAL MAP, rendus ×8, et
    //    l'étendue de nx sur la normale (large = vraies facettes cubiques, pas une plaque plate).
    //    Rareté oblige, on ne le croise pas au spawn — on lit donc les TEXTURES, générées au boot.
    const mush = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      if (!s.textures.exists('nd-champignon') || !s.textures.exists('nd-champignon_lit')) return null
      const SC = 8, cell = 16 * SC
      const cv = document.createElement('canvas'); cv.width = cell * 3; cv.height = cell
      const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false
      cx.fillStyle = '#2e2a22'; cx.fillRect(0, 0, cv.width, cv.height)
      cx.drawImage(s.textures.get('nd-champignon').getSourceImage(), 0, 0, cell, cell) // flat
      cx.drawImage(s.textures.get('nd-champignon_lit').getSourceImage(), cell, 0, cell, cell) // albédo lit
      // La NORMAL MAP vit dans dataSource[0] ; on la peint (3e case) et on mesure l'étendue de nx.
      const tex = s.textures.get('nd-champignon_lit')
      const src = tex && tex.dataSource && tex.dataSource[0]
      const nrm = src ? (src.image || src) : null
      let nxRange = -1
      if (nrm) {
        cx.drawImage(nrm, cell * 2, 0, cell, cell)
        const t = document.createElement('canvas'); t.width = nrm.width; t.height = nrm.height
        const tc = t.getContext('2d', { willReadFrequently: true }); tc.drawImage(nrm, 0, 0)
        const d = tc.getImageData(0, 0, t.width, t.height).data
        let mn = 1, mx = -1
        for (let i = 0; i < t.width * t.height; i++) {
          if (d[i * 4 + 3] < 8) continue
          const nx = (d[i * 4] / 255) * 2 - 1
          if (nx < mn) mn = nx; if (nx > mx) mx = nx
        }
        nxRange = mx <= mn ? 0 : +(mx - mn).toFixed(2)
      }
      return { url: cv.toDataURL('image/png'), nxRange }
    })
    if (mush) {
      writeFileSync(`${OUT}/champignon.png`, Buffer.from(mush.url.split(',')[1], 'base64'))
      console.log(`   ✓ nd-champignon + _lit générés (flat · albédo · normale → champignon.png)`)
      console.log(mush.nxRange > 0.3
        ? `   ✓ la NORMAL MAP a des facettes (étendue nx ${mush.nxRange}) — le champignon prend la lumière`
        : `   ✗ normale plate (étendue nx ${mush.nxRange}) — pas de relief`)
    } else {
      console.log(`   ✗ nd-champignon / _lit manque au boot`)
    }

    return { ...vue, beltHud, beltSame, gap, sacOk, centre, cote, topsAlign, deborde, met, mushroom: Boolean(mush) }
  },

  /**
   * L'ABATTAGE À MAÎTRISE MARCHE-T-IL ? (spec recolte-maitrise, verbe 1)
   *
   * On se pose contre un arbre, on ARME la charge (`harvest_charge_start`) et on vérifie
   * DEUX faits mesurables : (1) `scene.fells` — l'entrée de rendu de la jauge, dérivée du
   * snapshot — se peuple (le client SAIT peindre la jauge sous cet arbre) ; (2) laissée
   * pleine, la charge auto-frappe et du BOIS rentre (la boucle marche de bout en bout).
   *
   * NOTE — le DESSIN de la jauge ne s'atteste pas en direct ici : la boucle de rendu de
   * Chromium headless est trop throttlée pour saisir la frame mi-charge avant que
   * l'auto-frappe ne vide la charge. Le rendu lui-même se vérifie à l'œil (`pnpm dev`) ou
   * par capture figée. Exige `--dev` (le TP n'est armé que là).
   */
  async abattage(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    // Un arbre, et on se plante juste à côté (à portée de bras — le centre à 1 tuile).
    const tree = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const t = s.view.nodes.find((n) => n.type === 'tree' && n.stock > 0)
      if (!t) return null
      s.sendAction({ type: 'debug_teleport', x: t.tx - 0.5, y: t.ty + 0.5 })
      return { id: t.id, tx: t.tx, ty: t.ty }
    })
    if (!tree) { console.log('   ✗ aucun arbre à portée dans cette carte'); return {} }
    await page.waitForTimeout(500) // le TP prend effet (aller-retour de snapshot)

    const wood = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const me = s.lastEntities?.find((e) => e.id === s.playerId)
      return (me?.inventory ?? []).reduce((n, sl) => n + (sl?.item === 'wood' ? sl.count : 0), 0)
    })
    const woodBefore = await wood()

    // ARMER. On sonde `scene.fells` — L'ENTRÉE DE RENDU de la jauge, dérivée du snapshot :
    // si elle se peuple, le client SAIT peindre la jauge (le dessin lui-même est confirmé
    // à part, la boucle de rendu de Chromium headless étant trop throttlée pour le saisir
    // en direct avant que l'auto-frappe ne vide la charge — voir la note du scénario).
    await page.evaluate((id) => window.__BRAISES__.scene.sendAction({ type: 'harvest_charge_start', nodeId: id }), tree.id)
    let fells = []
    for (let i = 0; i < 12 && fells.length === 0; i++) {
      await page.waitForTimeout(40)
      fells = await page.evaluate(() => window.__BRAISES__.scene.fells ?? [])
    }
    console.log(fells.length
      ? `   ✓ la jauge a son entrée de rendu : ${JSON.stringify(fells)}`
      : `   ✗ scene.fells reste vide — la jauge n'a rien à peindre`)
    await page.screenshot({ path: `${OUT}/abattage-jauge.png` })

    // À plein sans relâcher, le coup part TOUT SEUL au baseline (l'ancien G6) : du bois rentre.
    await page.waitForTimeout(1400)
    const woodAfter = await wood()
    console.log(woodAfter > woodBefore
      ? `   ✓ le coup a porté (auto-frappe à plein) : bois ${woodBefore} → ${woodAfter}`
      : `   ✗ aucun bois récolté (${woodBefore} → ${woodAfter})`)
    return { fells: fells.length, woodBefore, woodAfter }
  },

  /**
   * LE MINAGE À MAÎTRISE MARCHE-T-IL ? (spec recolte-maitrise, verbe 2)
   *
   * On se pose contre un rocher et on vérifie DEUX faits : (1) la LUEUR DU BON FLANC se
   * peint (l'objet `flankGlow` a des commandes de dessin — le client sait montrer le point
   * faible, stable, sans course au temps) ; (2) frapper le rocher rapporte de la PIERRE.
   * Le JUGEMENT du flanc (bon = propre) est prouvé au tick près par les tests unitaires.
   * Exige `--dev` (le TP n'est armé que là).
   */
  async minage(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    const rock = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const r = s.view.nodes.find((n) => n.type === 'rock' && n.stock > 0)
      if (!r) return null
      s.sendAction({ type: 'debug_teleport', x: r.tx - 0.5, y: r.ty + 0.5 })
      return { id: r.id, tx: r.tx, ty: r.ty }
    })
    if (!rock) { console.log('   ✗ aucun rocher à portée dans cette carte'); return {} }
    await page.waitForTimeout(500)

    // La lueur du bon flanc — STABLE tant que le rocher est à portée. Au repos elle est PRÊTE
    // (brillante) ; le TEMPO (reforme après un coup) se vérifie au probe figé, non en direct.
    const glow = await page.evaluate(() => window.__BRAISES__.scene.flankGlow?.g?.commandBuffer?.length ?? -1)
    console.log(glow > 0 ? `   ✓ la lueur du bon flanc se peint (cmds=${glow})` : `   ✗ aucune lueur peinte (cmds=${glow})`)
    await page.screenshot({ path: `${OUT}/minage-flanc.png` })

    // Miner à la cadence du rechargement : la pierre rentre (boucle de bout en bout).
    const stone = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const me = s.lastEntities?.find((e) => e.id === s.playerId)
      return (me?.inventory ?? []).reduce((n, sl) => n + (sl?.item === 'stone' ? sl.count : 0), 0)
    })
    const before = await stone()
    for (let i = 0; i < 3; i++) {
      await page.evaluate(({ id, tx, ty }) => window.__BRAISES__.scene.sendAction({ type: 'harvest', nodeId: id, aimX: tx + 1.5, aimY: ty + 0.5 }), rock)
      await page.waitForTimeout(1100) // > GATHER_COOLDOWN
    }
    const after = await stone()
    console.log(after > before ? `   ✓ le rocher rend de la pierre : ${before} → ${after}` : `   ✗ aucune pierre (${before} → ${after})`)
    return { glow, before, after }
  },

  /**
   * LA CUEILLETTE À MAÎTRISE (spec recolte-maitrise, verbe 3, RÉVISÉE 2026-07-25).
   *
   * L'ancien HALO des « bons coins » est RETIRÉ ; la maîtrise change désormais ce qui SORT du
   * buisson (échelle de PRODUIT : semences puis champignons). On vérifie ici trois faits en jeu :
   *   (1) le halo a bien disparu (`scene.forageGlow` n'existe plus) ;
   *   (2) le geste nu marche encore (cueillir d'un coup rentre des baies) ;
   *   (3) le GATE : au niveau 0, AUCUN bonus de maîtrise ne tombe (ni graine ni champignon).
   * Le drop-SELON-le-niveau (le cœur de l'échelle) est prouvé au tick près par le test unitaire
   * `economy.test.ts` — le smoke ne peut pas monter `foraging` au palier en jeu. Exige `--dev`.
   */
  async cueillette(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    // Un buisson à baies (cueillette nue), et on se pose à côté.
    const start = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const b = s.view.nodes.find((n) => n.type === 'berry_bush' && n.stock > 0)
      if (!b) return null
      s.sendAction({ type: 'debug_teleport', x: b.tx - 0.5, y: b.ty + 0.5 })
      return { id: b.id, tx: b.tx, ty: b.ty, stock: b.stock }
    })
    if (!start) { console.log('   ✗ aucun buisson à portée dans cette carte'); return {} }
    await page.waitForTimeout(500)

    // (1) LE HALO A-T-IL DISPARU ? `forageGlow` était un champ de WorldScene ; il ne doit plus exister.
    const halo = await page.evaluate(() => (window.__BRAISES__.scene.forageGlow === undefined ? 'absent' : 'présent'))
    console.log(halo === 'absent' ? `   ✓ le halo des « bons coins » a bien disparu` : `   ✗ forageGlow existe encore`)

    const bag = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const inv = s.lastEntities?.find((e) => e.id === s.playerId)?.inventory ?? []
      const count = (item) => inv.reduce((n, sl) => n + (sl?.item === item ? sl.count : 0), 0)
      return { berries: count('berries'), graine: count('graine'), champignons: count('champignons') }
    })
    const before = await bag()

    // (2)+(3) CUEILLIR D'UN COUP (whole). Au niveau 0, le butin de maîtrise est GATÉ : des baies
    // rentrent, mais aucune graine / aucun champignon (le gate, moitié du contrat, gratuit ici).
    await page.evaluate((id) => window.__BRAISES__.scene.sendAction({ type: 'harvest', nodeId: id, whole: true }), start.id)
    await page.waitForTimeout(500)
    const after = await bag()
    await page.screenshot({ path: `${OUT}/cueillette.png` })

    console.log(after.berries > before.berries
      ? `   ✓ le geste nu marche : baies ${before.berries} → ${after.berries}`
      : `   ✗ la cueillette n'a rien rapporté (${before.berries} → ${after.berries})`)
    const bonus = after.graine - before.graine + (after.champignons - before.champignons)
    console.log(bonus === 0
      ? `   ✓ GATE : au niveau 0, aucun bonus de maîtrise (ni graine ni champignon)`
      : `   ✗ un bonus est tombé au niveau 0 — le gate ne tient pas (Δ=${bonus})`)
    return { halo, before, after }
  },

  /**
   * LE MONDE EST-IL VIVANT ? (spec recolte-vivante D1/D2)
   *
   * On rase un buisson jusqu'au bout et on vérifie qu'il ne CLIGNOTE plus sur place :
   * il MEURT là (une souche/trace), et il ROUVRE ailleurs, dans le bosquet. Deux faits
   * lisibles depuis l'état client : (1) la position du nœud a CHANGÉ (dérive, D1) ;
   * (2) le nœud épuisé est en repousse (échelle < 1) et non un fantôme à 25 % (D2).
   * Captures : le coin AVANT (buisson plein), APRÈS au même coin (la trace laissée),
   * et le nœud à sa NOUVELLE place (la pousse qui repart). Exige `--dev`.
   */
  async recolte_vivante(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    // Un buisson à baies (cueillette nue, aucun outil requis), et on se plante à côté.
    const start = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const b = s.view.nodes.find((n) => n.type === 'berry_bush' && n.stock > 0)
      if (!b) return null
      s.sendAction({ type: 'debug_teleport', x: b.tx - 0.5, y: b.ty + 0.5 })
      return { id: b.id, tx: b.tx, ty: b.ty, stock: b.stock }
    })
    if (!start) { console.log('   ✗ aucun buisson à portée dans cette carte'); return {} }
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/vivante-avant.png` })

    const nodeOf = (id) => page.evaluate((i) => {
      const n = window.__BRAISES__.scene.view.nodes.find((x) => x.id === i)
      return n ? { tx: n.tx, ty: n.ty, stock: n.stock } : null
    }, id)

    // On le rase : une frappe, on laisse passer le cooldown, on recommence — jusqu'à 0.
    for (let i = 0; i < 20; i++) {
      const n = await nodeOf(start.id)
      if (!n || n.stock <= 0) break
      await page.evaluate((id) => window.__BRAISES__.scene.sendAction({ type: 'harvest', nodeId: id }), start.id)
      await page.waitForTimeout(1100) // > GATHER_COOLDOWN (1 s)
    }
    await page.waitForTimeout(400)
    const after = await nodeOf(start.id)
    await page.screenshot({ path: `${OUT}/vivante-trace.png` }) // le coin d'origine : la trace

    if (!after) { console.log('   ✗ le nœud a disparu de l’état client'); return {} }
    const drift = Math.abs(after.tx - start.tx) + Math.abs(after.ty - start.ty)
    console.log(drift > 0
      ? `   ✓ DÉRIVE : le buisson a rouvert ailleurs — (${start.tx},${start.ty}) → (${after.tx},${after.ty}), ${drift} tuiles`
      : `   ✗ le buisson est resté sur place (pas de dérive)`)
    console.log(after.stock <= 0 ? `   ✓ épuisé et EN REPOUSSE (plus de fantôme à 25 %)` : `   · déjà repoussé (stock ${after.stock})`)

    // On va VOIR la pousse à sa nouvelle place.
    await page.evaluate((p) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: p.tx + 0.5, y: p.ty + 1.5 }), after)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/vivante-pousse.png` })
    console.log(`   captures : vivante-avant / vivante-trace / vivante-pousse`)
    return { start, after, drift }
  },

  /**
   * LA PLANCHE D'ÉCHELLE : les 26 lieux, alignés sur le sol, à côté d'un arbre
   * et d'un avatar. Composée à partir des VRAIES textures du jeu (lues dans le
   * gestionnaire de textures de Phaser) — un dessin refait à côté mentirait.
   */
  async poiSheet(page) {
    const dataUrl = await page.evaluate(() => {
      const tm = window.__BRAISES__.scene.textures
      const SCALE = 4 // ×4 : le pixel art se lit
      const GAP = 10 * SCALE
      const PAD = 8 * SCALE
      const LABEL = 34

      const NAMES = {
        gisement: 'le Gisement', carriere: 'la Carrière', saline: 'la Saline', verger: 'le Verger',
        ruines: 'les Ruines', cabane: 'la Cabane', abri: "l'Abri sous roche", mine: 'la Mine',
        oratoire: "l'Oratoire", bivouac: 'le Bivouac', taniere: 'la Tanière', repaire: 'le Repaire',
        epave: "l'Épave", fondriere: 'la Fondrière', crevasses: 'les Crevasses',
        belvedere: 'le BELVÉDÈRE', grotte: 'la GROTTE', cascade: 'la CASCADE', erratique: 'le Bloc erratique',
        arbre: "l'ARBRE remarquable", cairn: 'le CAIRN', sanctuaire: 'le SANCTUAIRE',
        source_chaude: 'la SOURCE CHAUDE', arche: "l'ARCHE", tarn: 'le TARN', petroglyphes: 'les PÉTROGLYPHES',
        chene: 'le GRAND CHÊNE', filon: 'le Filon affleurant',
        tour_guet: 'la TOUR DE GUET', pierre_levee: 'la PIERRE LEVÉE',
        ferme_ruinee: 'la Ferme ruinée', charrette: 'la Charrette',
      }
      // Les chargés sont en MAJUSCULES ci-dessus — on les souligne en couleur. (Les trois
      // set-pieces — bois_noir, cercle_pierres, combe_brumeuse — n'ont PAS de texture : leur
      // corps est leur terrain, ils n'ont rien à faire sur une planche de sprites.)
      const CHARGED = new Set(['belvedere', 'grotte', 'cascade', 'erratique', 'arbre', 'cairn',
        'sanctuaire', 'source_chaude', 'arche', 'tarn', 'petroglyphes',
        'chene', 'tour_guet', 'pierre_levee'])

      const sizeOf = (key) => {
        if (key === '__tree__') return { w: 32, h: 44 }
        const src = tm.get(key).getSourceImage()
        return { w: src.width, h: src.height }
      }
      const draw = (ctx, key, x, groundY) => {
        const s = sizeOf(key)
        if (key === '__tree__') {
          const trunk = tm.get('nd-tree_trunk').getSourceImage()
          const crown = tm.get('nd-tree_crown').getSourceImage()
          ctx.drawImage(trunk, x + 8 * SCALE, groundY - 22 * SCALE, 16 * SCALE, 22 * SCALE)
          ctx.drawImage(crown, x, groundY - 44 * SCALE, 32 * SCALE, 32 * SCALE)
        } else {
          ctx.drawImage(tm.get(key).getSourceImage(), x, groundY - s.h * SCALE, s.w * SCALE, s.h * SCALE)
        }
        return s.w * SCALE
      }

      // Les 26 lieux, groupés par FAMILLE : chaque rangée = une famille, et
      // chaque rangée REDONNE l'échelle (avatar + arbre) — sinon on la perd en
      // descendant la planche.
      const ROWS = [
        { titre: 'ÉCONOMIE', slugs: ['gisement', 'carriere', 'saline', 'verger', 'filon'] },
        { titre: 'ABRIS', slugs: ['ruines', 'cabane', 'abri', 'mine', 'oratoire', 'bivouac', 'ferme_ruinee', 'charrette'] },
        { titre: 'DANGER', slugs: ['taniere', 'repaire', 'epave', 'fondriere', 'crevasses'] },
        { titre: 'LES CHARGÉS — savoir', slugs: ['belvedere', 'cairn', 'petroglyphes', 'arche', 'chene', 'tour_guet', 'pierre_levee'] },
        { titre: 'LES CHARGÉS — répit', slugs: ['source_chaude', 'grotte', 'tarn'] },
        { titre: 'LES CHARGÉS — récit', slugs: ['sanctuaire', 'arbre', 'erratique', 'cascade'] },
      ]
      const REF = ['spr-player', '__tree__']
      const REF_LABEL = { 'spr-player': 'avatar (1 tuile)', __tree__: 'arbre (~2,7 tuiles)' }

      const rowW = (r) =>
        PAD * 2 + [...REF, ...r.slugs.map((s) => `poi-${s}`)].reduce((a, k) => a + sizeOf(k).w * SCALE + GAP, 0) + 40
      const rowH = (r) =>
        Math.max(...[...REF, ...r.slugs.map((s) => `poi-${s}`)].map((k) => sizeOf(k).h)) * SCALE + LABEL + 26

      const totalW = Math.max(...ROWS.map(rowW))
      const totalH = PAD * 2 + ROWS.reduce((a, r) => a + rowH(r), 0)

      const c = document.createElement('canvas')
      c.width = totalW
      c.height = totalH
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#12161b'
      ctx.fillRect(0, 0, totalW, totalH)

      let y = PAD
      for (const r of ROWS) {
        const hh = rowH(r)
        const groundY = y + hh - LABEL - 12

        // le sol de la rangée, gradué en TUILES (16 px × SCALE)
        ctx.strokeStyle = '#3a4650'
        ctx.beginPath()
        ctx.moveTo(0, groundY + 0.5)
        ctx.lineTo(totalW, groundY + 0.5)
        ctx.stroke()
        ctx.fillStyle = '#243039'
        for (let gx = 0; gx < totalW; gx += 16 * SCALE) ctx.fillRect(gx, groundY, 1, 5)

        // le titre de famille
        ctx.fillStyle = r.titre.includes('ONZE') ? '#ffd94a' : '#5f6f7d'
        ctx.font = 'bold 13px monospace'
        ctx.textAlign = 'left'
        ctx.fillText(r.titre, PAD, y + 15)

        let x = PAD
        const put = (key, label, color) => {
          const w = draw(ctx, key, x, groundY)
          ctx.fillStyle = color
          ctx.font = '12px monospace'
          ctx.textAlign = 'center'
          ctx.fillText(label, x + w / 2, groundY + 20)
          x += w + GAP
        }
        for (const k of REF) put(k, REF_LABEL[k], '#7fd0a8')
        x += 40 // une respiration entre la référence et les lieux
        for (const s of r.slugs) put(`poi-${s}`, NAMES[s], CHARGED.has(s) ? '#ffd94a' : '#93a1ad')

        y += hh
      }
      return c.toDataURL('image/png')
    })

    const b64 = dataUrl.split(',')[1]
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${OUT}/planche-echelle.png`, Buffer.from(b64, 'base64'))
    console.log(`✓ planche d'échelle → ${OUT}/planche-echelle.png`)
    return {}
  },



  /** La découverte À VUE : on s'approche d'un lieu SANS le toucher, et on regarde. */
  async poiSight(page) {
    const s0 = await page.evaluate(PROBE)
    await page.keyboard.press('P')
    await page.waitForTimeout(300)

    const cible = s0.pois.find((p) => p.kind === 'sanctuaire') ?? s0.pois.find((p) => p.kind === 'ruines') ?? s0.pois[0]
    console.log(`\ncible : ${cible.name} en (${cible.x}, ${cible.y})`)

    // On se pose à 10 tuiles à l'ouest — dans la vue, hors de l'empreinte.
    const tp = async (x, y) => {
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.registry.set('debugTeleport', { x, y, at: performance.now() })
      }, { x, y })
      await page.waitForTimeout(1500)
      return page.evaluate(PROBE)
    }

    const loin = await tp(cible.x - 25, cible.y)
    console.log(`  à 25 tuiles  → ${loin.knownPois.includes(cible.poiId) ? '✗ déjà connu ?!' : '✓ inconnu — hors de vue'}`)

    const proche = await tp(cible.x - 10, cible.y)
    const vu = proche.knownPois.includes(cible.poiId)
    console.log(`  à 10 tuiles  → ${vu ? '✓ CONNU sans l\'avoir touché — la vue suffit' : '✗ toujours inconnu'}`)

    await page.evaluate(() => { window.__BRAISES__.scene.cameras.main.setZoom(1.6) })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/vue-de-loin.png` })

    await tp(cible.x, cible.y)
    await page.evaluate(() => { window.__BRAISES__.scene.cameras.main.setZoom(2.4) })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/vue-de-pres.png` })
    console.log(`  sur le lieu  → captures : vue-de-loin.png / vue-de-pres.png`)
    return s0
  },

  /** Exporte chaque sprite de lieu en PNG isolé — matière du catalogue. */
  async poiSprites(page) {
    const all = await page.evaluate(() => {
      const tm = window.__BRAISES__.scene.textures
      const out = {}
      for (const key of tm.getTextureKeys()) {
        if (!key.startsWith('poi-') || key.endsWith('-crown')) continue
        const src = tm.get(key).getSourceImage()
        const SCALE = 4
        const c = document.createElement('canvas')
        c.width = src.width * SCALE
        c.height = src.height * SCALE
        const ctx = c.getContext('2d')
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(src, 0, 0, c.width, c.height)
        out[key.slice(4)] = { png: c.toDataURL('image/png'), w: src.width, h: src.height }
      }
      // et l'arbre de référence, composé comme en jeu
      const trunk = tm.get('nd-tree_trunk').getSourceImage()
      const crown = tm.get('nd-tree_crown').getSourceImage()
      const c = document.createElement('canvas')
      c.width = 32 * 4
      c.height = 44 * 4
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(trunk, 8 * 4, 22 * 4, 16 * 4, 22 * 4)
      ctx.drawImage(crown, 0, 0, 32 * 4, 32 * 4)
      out.__arbre_ref__ = { png: c.toDataURL('image/png'), w: 32, h: 44 }
      return out
    })
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(`${OUT}/sprites`, { recursive: true })
    const meta = {}
    for (const [slug, v] of Object.entries(all)) {
      writeFileSync(`${OUT}/sprites/${slug}.png`, Buffer.from(v.png.split(',')[1], 'base64'))
      meta[slug] = { w: v.w, h: v.h }
    }
    writeFileSync(`${OUT}/sprites/meta.json`, JSON.stringify(meta, null, 2))
    console.log(`✓ ${Object.keys(all).length} sprites → ${OUT}/sprites/`)
    return {}
  },

  /** En jeu : on se pose SUR quelques lieux et on regarde. Clairière ? échelle ? */
  async poiInSitu(page) {
    const s = await page.evaluate(PROBE)
    await page.keyboard.press('P')
    await page.waitForTimeout(300)

    // On vise des lieux de familles différentes, en priorité ceux entourés d'arbres.
    const cibles = ['sanctuaire', 'arbre', 'grotte', 'ruines', 'cairn', 'belvedere']
    for (const kind of cibles) {
      const p = s.pois.find((q) => q.kind === kind)
      if (!p) {
        console.log(`   (pas de ${kind} sur cette carte)`)
        continue
      }
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.registry.set('debugTeleport', { x, y, at: performance.now() })
      }, { x: p.x, y: p.y })
      await page.waitForTimeout(1600)
      // On zoome pour juger l'échelle contre les arbres.
      await page.evaluate(() => { window.__BRAISES__.scene.cameras.main.setZoom(2.2) })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/insitu-${kind}.png` })
      console.log(`   ✓ ${p.name} → insitu-${kind}.png`)
    }
    return s
  },

  /** Les lieux (spec docs/specs/lieux.md) : la carte est-elle bien vierge au départ ? */
  async lieux(page) {
    const s = await page.evaluate(PROBE)

    console.log(`\n── A1 : la carte est-elle vierge au tick 0 ? ──`)
    console.log(`   ${s.pois.length} lieux existent, ${s.knownPois.length} sont connus du joueur`)
    console.log(s.knownPois.length === 0 ? '   ✓ aucune pastille — la vallée garde son secret' : `   ✗ ${s.knownPois.length} lieux déjà divulgués !`)

    await page.keyboard.press('m')
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/carte-vierge.png` })
    await page.keyboard.press('m')

    console.log(`\n── Ce que la vallée CONTIENT vraiment (les onze lieux chargés) ──`)
    const CHARGES = {
      belvedere: 'savoir', arche: 'savoir', cairn: 'savoir', petroglyphes: 'savoir',
      chene: 'savoir', tour_guet: 'savoir', pierre_levee: 'savoir', // les repères de la Racine
      source_chaude: 'repit', grotte: 'repit', tarn: 'repit',
      sanctuaire: 'recit', arbre: 'recit', erratique: 'recit', cascade: 'recit',
      cercle_pierres: 'recit', // la destination de la chaîne des menhirs
    }
    for (const [kind, devise] of Object.entries(CHARGES)) {
      const n = s.pois.filter((p) => p.kind === kind).length
      console.log(`   ${kind.padEnd(15)} ${devise.padEnd(7)} ${String(n).padStart(2)}${n === 0 ? '   ← ABSENT de cette carte' : ''}`)
    }

    if (!dev) {
      console.log(`\n(le reste exige le mode debug — relancer avec --dev)`)
      return s
    }

    // ── Le savoir en action : fouler un lieu, puis en fouler un CHARGÉ. ──
    /** Téléporte le joueur et laisse la sim tourner quelques ticks. */
    const tpTo = async (p) => {
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.registry.set('debugTeleport', { x, y, at: performance.now() })
      }, { x: p.x, y: p.y })
      await page.waitForTimeout(1200)
      return page.evaluate(PROBE)
    }

    await page.keyboard.press('P') // arme l'affichage debug (le TP passe par le registry)
    await page.waitForTimeout(300)

    console.log(`\n── La règle de base : fouler suffit à connaître ──`)
    const banal = s.pois.find((p) => p.kind === 'gisement') ?? s.pois[0]
    const a = await tpTo(banal)
    console.log(`   foulé : ${banal.name} (poiId ${banal.poiId}) → connus : [${a.knownPois.join(', ')}]`)
    console.log(a.knownPois.includes(banal.poiId) ? `   ✓ il est entré dans la carte` : `   ✗ il n'est PAS entré dans la carte`)

    console.log(`\n── Une charge de savoir : la révélation à distance ──`)
    // Le Belvédère d'abord : c'est LUI la pièce maîtresse (il révèle une grappe).
    const charge = ['belvedere', 'arche', 'petroglyphes', 'cairn']
      .map((k) => s.pois.find((p) => p.kind === k))
      .find(Boolean)
    if (!charge) {
      console.log('   (aucun lieu de savoir sur cette carte)')
      return s
    }
    const before = a.knownPois.length
    const b = await tpTo(charge)
    const reveles = b.knownPois.filter((id) => !a.knownPois.includes(id) && id !== charge.poiId)
    console.log(`   foulé : ${charge.name} (${charge.kind}) → ${b.knownPois.length - before} lieux de plus, dont ${reveles.length} révélés À DISTANCE`)

    // LE contrôle qui trahirait un poiId désaligné. Attention : il DÉPEND de la charge.
    // Le Cairn et les Pétroglyphes révèlent « le plus proche » — SANS rayon : une
    // grande distance n'y prouve rien (le semis espace les lieux de ≥96 tuiles).
    // Ce qu'on vérifie alors, c'est que le révélé est BIEN le plus proche des inconnus.
    const dist = (p) => Math.sqrt((p.x - charge.x) ** 2 + (p.y - charge.y) ** 2)
    for (const id of reveles) {
      const p = s.pois.find((q) => q.poiId === id)
      console.log(`      ${p.name} (poiId ${id}) — à ${dist(p).toFixed(1)} tuiles`)
    }
    if (reveles.length === 0) {
      console.log(`   ✗ la charge n'a RIEN révélé — rayon trop court, ou lieu isolé ?`)
    } else if (charge.kind === 'cairn') {
      // Le Cairn : le révélé doit être le plus proche parmi ceux qui étaient inconnus.
      const inconnus = s.pois.filter((p) => !a.knownPois.includes(p.poiId) && p.poiId !== charge.poiId)
      const attendu = inconnus.reduce((best, p) => (dist(p) < dist(best) ? p : best), inconnus[0])
      const ok = reveles.length === 1 && reveles[0] === attendu.poiId
      console.log(ok ? `   ✓ c'est bien LE plus proche des inconnus — poiId ALIGNÉ` : `   ✗ attendu « ${attendu.name} » (poiId ${attendu.poiId}) — poiId DÉSALIGNÉ !`)
    } else {
      // Belvédère / Arche : rayon. Tout révélé doit tomber dedans.
      const rayon = 300
      const pire = Math.max(...reveles.map((id) => dist(s.pois.find((q) => q.poiId === id))))
      console.log(pire <= rayon + 1 ? `   ✓ tous dans le rayon de ${rayon} — poiId ALIGNÉS` : `   ✗ un lieu à ${pire.toFixed(1)} tuiles (rayon ${rayon}) : poiId DÉSALIGNÉ !`)
    }

    await page.keyboard.press('m')
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/carte-apres-decouvertes.png` })
    return b
  },

  /**
   * LE SAC (chantier inventaire façon Rust). On ne rejoue pas ici la sim — les
   * tests headless prouvent déjà la récolte, l'usure et la capacité (A5-A11).
   * Ce que le navigateur, LUI SEUL, peut confirmer : le CÂBLAGE client — la
   * ceinture et les vitales rendues, l'inventaire vraiment devenu un tableau de
   * CASES, une touche de ceinture qui change réellement l'objet en main, et TAB
   * qui ouvre l'écran d'inventaire. On lit l'état, on ne le fabrique pas.
   */
  async inventaire(page) {
    await page.waitForTimeout(1500) // le premier snapshot peuple le HUD
    await page.screenshot({ path: `${OUT}/sac-hud.png` })

    // 1. L'inventaire est-il un TABLEAU DE CASES (Slot[] | null), et l'objet en
    //    main existe-t-il ? C'est la bascule du socle, vue depuis le client.
    const socle = await page.evaluate(() => {
      const r = window.__BRAISES__.scene.registry
      const inv = r.get('inv')
      return {
        estTableau: Array.isArray(inv),
        cases: Array.isArray(inv) ? inv.length : null,
        activeSlot: r.get('activeSlot'),
        aVitales: r.get('hp') !== undefined && r.get('stamina') !== undefined && r.get('temperature') !== undefined,
      }
    })
    console.log(`socle : inv est un tableau=${socle.estTableau}, ${socle.cases} cases, activeSlot=${socle.activeSlot}`)
    console.log(socle.estTableau && socle.cases > 0
      ? `   ✓ l'inventaire est bien un tableau de cases (fini le dictionnaire infini)`
      : `   ✗ l'inventaire n'est PAS un tableau de cases !`)
    console.log(socle.aVitales ? `   ✓ les vitales sont publiées (PV/endurance/température)` : `   ✗ vitales manquantes`)

    // 2. La CEINTURE fait foi : appuyer sur « 2 » doit changer l'objet en main
    //    (câblage touche → set_active_slot → autorité → snapshot → registry).
    await page.keyboard.press('Digit2')
    await page.waitForTimeout(400)
    const apres2 = await page.evaluate(() => window.__BRAISES__.scene.registry.get('activeSlot'))
    console.log(`après appui sur « 2 » : activeSlot=${apres2}`)
    console.log(apres2 === 1
      ? `   ✓ la touche 2 tient bien la case 1 — l'objet en main répond`
      : `   ✗ activeSlot attendu 1, obtenu ${apres2} : la ceinture ne répond pas`)

    // 3. TAB ouvre l'écran d'inventaire (la grille + le glisser-déposer).
    await page.keyboard.press('Tab')
    await page.waitForTimeout(400)
    const ouvert = await page.evaluate(() => window.__BRAISES__.scene.registry.get('characterMenuOpen'))
    console.log(ouvert ? `   ✓ TAB ouvre l'écran d'inventaire` : `   ✗ TAB n'ouvre rien`)
    await page.screenshot({ path: `${OUT}/sac-inventaire-ouvert.png` })

    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    return socle
  },

  /**
   * LA CONSTRUCTION (spec construction, tranche 1) — dans le VRAI jeu.
   *
   *  · R20 : le marteau EN MAIN ouvre son menu de pose « MARTEAU », séparé du craft.
   *  · R21 : ranger le marteau referme le menu et désarme (`selected` → null).
   *  · R14/R24 : on FONDE, on BÂTIT un mur et un toit, et ils s'affichent.
   *  · R23 : une pose par action (clic-par-case).
   *
   * Exige `--dev` : `debug_grant`/`debug_teleport`/`light_fire` n'agissent qu'en debug.
   */
  async construction(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    // Le menu « MARTEAU » est-il visible dans la scène UI ? (on lit le graphe Phaser)
    const marteauVisible = () =>
      page.evaluate(() => {
        const ui = window.__BRAISES__.scene.scene.get('ui')
        const t = ui.children.list.find((o) => o.type === 'Text' && o.text === 'MARTEAU')
        return Boolean(t && t.visible)
      })

    // UNE ACTION PAR TICK (le protocole n'en porte qu'une par input) : deux envois dans
    // le même souffle et le second écrase le premier. On ESPACE donc chaque geste.
    const doAction = async (action, wait = 90) => {
      await page.evaluate((a) => window.__BRAISES__.scene.sendAction(a), action)
      await page.waitForTimeout(wait)
    }
    const grant = async (item, n = 1) => {
      for (let i = 0; i < n; i++) await doAction({ type: 'debug_grant', item })
    }
    // Sonde qui POLL une condition (la mise à main passe par un aller-retour de snapshot).
    // Retourne `true` si `fn()` a atteint `want` avant le délai, `false` sinon.
    const until = async (fn, want, ms = 2500) => {
      for (let t = 0; t < ms; t += 100) {
        if ((await fn()) === want) return true
        await page.waitForTimeout(100)
      }
      return false
    }

    // R20 — le marteau en main OUVRE le menu de pose.
    await grant('hammer')
    const r20 = await until(marteauVisible, true)
    console.log(`R20 marteau en main → menu « MARTEAU » ${r20 ? 'VISIBLE ✓' : 'ABSENT ✗'}`)

    // R21 — prendre autre chose (ranger le marteau) referme le menu et désarme.
    await grant('berries')
    const r21 = await until(marteauVisible, false)
    const held = await page.evaluate(() => {
      const reg = window.__BRAISES__.scene.registry
      const inv = reg.get('inv') ?? []
      const slot = reg.get('activeSlot') ?? -1
      return { slot, item: slot >= 0 ? (inv[slot]?.item ?? null) : null, selected: reg.get('selected') ?? null }
    })
    console.log(`R21 marteau rangé → menu ${r21 ? 'éteint ✓' : 'ENCORE là ✗'}, tenu=${held.item} (case ${held.slot}), selected=${held.selected}`)

    // FONDER LOIN DES POI (décision d'Alexis : aucun POI dans la zone max) : on essaie
    // quelques positions autour du spawn jusqu'à ce qu'une fondation passe (R1). Le bois
    // est granté UNE fois (heldSlot ne tient que la CEINTURE : on la garde libre pour les
    // composants — 30 bois tient sur 2 cases, laissant la place aux objets tenus).
    const spawn = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    await grant('wood', 30)
    let feu = null
    let reason = ''
    for (const [ox, oy] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24], [24, 24], [-24, -24], [48, 0], [0, 48]]) {
      await doAction({ type: 'debug_teleport', x: Math.round(spawn.x) + ox + 0.5, y: Math.round(spawn.y) + oy + 0.5 }, 200)
      await doAction({ type: 'light_fire' }, 450)
      feu = await page.evaluate(() => {
        const f = window.__BRAISES__.scene.view.structures.find((x) => x.type === 'fire')
        return f ? { tx: f.tx, ty: f.ty } : null
      })
      reason = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? '')
      if (feu) break
    }
    console.log(`fondation (R1 loin des POI) → Feu ${feu ? `posé en (${feu.tx}, ${feu.ty}) ✓` : `ABSENT ✗ (${reason})`}`)

    if (feu) {
      const T = feu // raccourci
      await doAction({ type: 'set_active_slot', slot: 0 }, 150) // le marteau (case 0, R20)
      await doAction({ type: 'debug_teleport', x: T.tx + 2.5, y: T.ty + 0.5 }, 300) // à côté (le Feu bloque)
      // MURS CONTINUS (décision d'Alexis) : trois murs alignés → une paroi, pas des carrés.
      await doAction({ type: 'build', structure: 'wall', tx: T.tx + 1, ty: T.ty - 2 }, 300)
      await doAction({ type: 'build', structure: 'wall', tx: T.tx + 2, ty: T.ty - 2 }, 300)
      await doAction({ type: 'build', structure: 'wall', tx: T.tx + 3, ty: T.ty - 2 }, 300)
      // SOL + TOIT DE PAILLE sur la MÊME tuile (décision d'Alexis : ils se superposent).
      await doAction({ type: 'build', structure: 'floor', tx: T.tx + 2, ty: T.ty - 1 }, 300)
      await doAction({ type: 'build', structure: 'roof', tx: T.tx + 2, ty: T.ty - 1 }, 400)
      const built = await page.evaluate(
        ({ tx, ty }) => {
          const st = window.__BRAISES__.scene.view.structures
          const layered = st.filter((s) => s.tx === tx && s.ty === ty)
          return {
            walls: st.filter((s) => s.type === 'wall').length,
            coexist: layered.some((s) => s.type === 'floor') && layered.some((s) => s.type === 'roof'),
          }
        },
        { tx: T.tx + 2, ty: T.ty - 1 },
      )
      const berr = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? '')
      console.log(
        `murs continus → ${built.walls} murs ✓ ; sol+toit superposés → ${built.coexist ? '✓' : '✗'}${built.coexist ? '' : ` (${berr})`}`,
      )

      // LA FORGE (tranche 2) : poser enclume + four fait ÉMERGER une Forge N2 (R9-R10),
      // et l'overlay l'affiche (R22).
      await grant('enclume')
      await doAction({ type: 'place_component', tx: feu.tx + 3, ty: feu.ty }, 400)
      await grant('furnace')
      await doAction({ type: 'place_component', tx: feu.tx + 4, ty: feu.ty }, 600)
      const forge = await page.evaluate(() => {
        const f = window.__BRAISES__.scene.view.functions.find((x) => x.functionId === 'forge')
        return f ? f.tier : 0
      })
      const ferr = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? '')
      console.log(`Forge (R9-R10) → ${forge ? `N${forge} émergée ✓` : `ABSENTE ✗ (${ferr})`}`)
      const overlay = await page.evaluate(() =>
        window.__BRAISES__.scene.children.list.some(
          (o) => o.type === 'Text' && typeof o.text === 'string' && o.text.includes('Forge'),
        ),
      )
      console.log(`overlay « Forge » (R22) → ${overlay ? 'affiché ✓' : 'absent ✗'}`)

      // L'ATELIER (tranche 3) : un établi (= workshop) posé près de la forge (zone
      // dégagée éprouvée) émerge en Atelier N1 — deux fonctions se touchent (R9).
      await grant('workshop')
      await doAction({ type: 'place_component', tx: feu.tx + 5, ty: feu.ty }, 600)
      const atelier = await page.evaluate(() => {
        const f = window.__BRAISES__.scene.view.functions.find((x) => x.functionId === 'atelier')
        return f ? f.tier : 0
      })
      const aerr = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? '')
      console.log(`Atelier (tranche 3) → ${atelier ? `N${atelier} émergé ✓` : `ABSENT ✗ (${aerr})`}`)

      // LE GRENIER (tranche 4) : un silo (conteneur) posé près de l'amas émerge en
      // Grenier N1 — et c'est un CONTENEUR (il a un inventaire, on y range).
      await grant('silo')
      await doAction({ type: 'place_component', tx: feu.tx + 6, ty: feu.ty }, 600)
      const grenier = await page.evaluate(() => {
        const st = window.__BRAISES__.scene
        const f = st.view.functions.find((x) => x.functionId === 'grenier')
        const silo = st.view.structures.find((s) => s.type === 'silo')
        return { tier: f ? f.tier : 0, container: silo ? silo.inventory !== undefined : false }
      })
      const gerr = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? '')
      console.log(
        `Grenier (tranche 4) → ${grenier.tier ? `N${grenier.tier} émergé ✓` : `ABSENT ✗ (${gerr})`}, conteneur ${grenier.container ? '✓' : '✗'}`,
      )

      // LA FERME (tranche 5) : une parcelle posée émerge en Ferme N1 — PLEIN AIR (jamais enclosed).
      await grant('parcelle')
      await doAction({ type: 'place_component', tx: feu.tx + 3, ty: feu.ty + 2 }, 600)
      const ferme = await page.evaluate(() => {
        const f = window.__BRAISES__.scene.view.functions.find((x) => x.functionId === 'ferme')
        return f ? { tier: f.tier, enclosed: f.enclosed } : null
      })
      const perr = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? '')
      console.log(
        `Ferme (tranche 5) → ${ferme ? `N${ferme.tier} émergée ✓ (plein air : enclosed=${ferme.enclosed})` : `ABSENTE ✗ (${perr})`}`,
      )
    }
    // Le toit de paille s'efface sous l'avatar (même disque de découvert que la cime
    // des arbres — décision d'Alexis, R24) : la capture le montre de PRÈS.
    await page.screenshot({ path: `${OUT}/construction.png` })
  },

  /**
   * UN VILLAGE, VU DE L'EXTÉRIEUR ET DE L'INTÉRIEUR (demande d'Alexis) : on fonde,
   * on trouve une clairière, on bâtit une FORGE MURÉE + TOITÉE (chaume), on pose
   * autour un Atelier / un Grenier / une Ferme, puis on capture deux vues :
   *  · EXTÉRIEUR : l'avatar recule → le toit de paille se rabat (bâtisse close) ;
   *  · INTÉRIEUR : l'avatar entre → le toit se lève, l'amas se découvre.
   * Exige `--dev`.
   */
  async village(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const doAction = async (action, wait = 120) => {
      await page.evaluate((a) => window.__BRAISES__.scene.sendAction(a), action)
      await page.waitForTimeout(wait)
    }
    const grant = async (item, n = 1) => {
      for (let i = 0; i < n; i++) await doAction({ type: 'debug_grant', item })
    }
    const held = () => page.evaluate(() => {
      const reg = window.__BRAISES__.scene.registry
      const inv = reg.get('inv') ?? []
      const slot = reg.get('activeSlot') ?? -1
      return slot >= 0 ? inv[slot]?.item ?? null : null
    })

    // FONDER dans une clairière loin des POI (R1), via place_campfire + found_village :
    // ce flux joueur ne fait arriver AUCUN PNJ (contrairement à light_fire) — donc rien
    // ne vient se faire piéger quand on ferme les murs, et la Forge sera bien ENCLOSE.
    const spawn = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    await grant('wood', 40)
    let feu = null
    for (const [ox, oy] of [[0, 0], [-24, 0], [24, 0], [0, -24], [0, 24], [-24, 24], [24, -24], [-48, 0], [48, 0]]) {
      const bx = Math.round(spawn.x) + ox, by = Math.round(spawn.y) + oy
      await doAction({ type: 'debug_teleport', x: bx + 0.5, y: by + 0.5 }, 180)
      await grant('campfire')
      const cslot = await page.evaluate(() => (window.__BRAISES__.scene.registry.get('inv') ?? []).findIndex((s) => s?.item === 'campfire'))
      if (cslot < 0 || cslot >= 6) continue
      await doAction({ type: 'set_active_slot', slot: cslot }, 120)
      await doAction({ type: 'place_campfire', tx: bx + 1, ty: by }, 250)
      const fireId = await page.evaluate(({ x, y }) => {
        const f = window.__BRAISES__.scene.view.structures.find((s) => s.type === 'fire' && s.villageId === 0 && s.tx === x && s.ty === y)
        return f ? f.id : null
      }, { x: bx + 1, y: by })
      if (fireId === null) continue
      await doAction({ type: 'found_village', structureId: fireId }, 300)
      const members = await page.evaluate(() => window.__BRAISES__.scene.registry.get('village') ?? 0)
      if (members > 0) { feu = { tx: bx + 1, ty: by }; break }
    }
    if (!feu) {
      console.log('fondation → ABSENTE ✗ (aucune clairière trouvée)')
      await page.screenshot({ path: `${OUT}/village.png` })
      return
    }
    console.log(`fondation → Feu en (${feu.tx}, ${feu.ty}) ✓`)

    // Cherche un bloc 4×3 SANS NŒUD et sur terrain marchable + une TUILE-POSTE au sud
    // dégagée, pour une Forge murée COMPLÈTE (donc enclose). Scan large, priorité à l'ouest.
    const blk = await page.evaluate(({ fx, fy }) => {
      const s = window.__BRAISES__.scene
      const nodes = new Set(s.view.nodes.map((n) => n.tx + ',' + n.ty))
      // walkable : on approxime par « pas un nœud » — les tuiles autour d'un feu fondable
      // sont marchables ; le vrai garde-fou reste la sim (elle revalide chaque pose).
      const clear = (ox, oy, w, h) => {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (nodes.has(ox + x + ',' + (oy + y))) return false
        return true
      }
      const cands = []
      for (let r = 2; r <= 9; r++)
        for (const [dx, dy] of [[-r, -1], [-r, -2], [-r, 0], [r, -1], [0, -r], [0, r], [-r, r], [-r, -r]]) {
          const ox = fx + dx, oy = fy + dy
          // bloc 4×3 + la tuile-poste (ox+1, oy+4) toutes dans le carré et dégagées
          if (Math.max(Math.abs(dx) + 3, Math.abs(dy) + 4) > 10) continue
          if (clear(ox, oy, 4, 3) && !nodes.has(ox + 1 + ',' + (oy + 4)) && !nodes.has(ox + 2 + ',' + (oy + 4))) {
            cands.push({ ox, oy })
          }
        }
      return cands[0] ?? null
    }, { fx: feu.tx, fy: feu.ty })
    if (!blk) {
      console.log('Forge murée → pas de clairière 4×3 trouvée (on capture quand même)')
    } else {
      const { ox, oy } = blk
      // Poste l'avatar au sud du bloc (tuile dégagée), à portée de toutes ses tuiles.
      await doAction({ type: 'debug_teleport', x: ox + 1.5, y: oy + 4.5 }, 250)
      // LE MARTEAU EN MAIN (R20) : sans lui, aucune barrière ne se pose.
      await grant('hammer')
      const hslot = await page.evaluate(() => (window.__BRAISES__.scene.registry.get('inv') ?? []).findIndex((s) => s?.item === 'hammer'))
      if (hslot >= 0 && hslot < 6) await doAction({ type: 'set_active_slot', slot: hslot }, 120)
      // Périmètre de MURS (continus) d'un 4×3 — PORTE au sud (navigabilité R7).
      const walls = []
      for (let x = 0; x < 4; x++) { walls.push([ox + x, oy]); walls.push([ox + x, oy + 2]) }
      walls.push([ox, oy + 1]); walls.push([ox + 3, oy + 1])
      const door = [ox + 1, oy + 2]
      for (const [x, y] of walls) if (!(x === door[0] && y === door[1])) await doAction({ type: 'build', structure: 'wall', tx: x, ty: y }, 190)
      await doAction({ type: 'build', structure: 'door', tx: door[0], ty: door[1] }, 210)
      // SOL + TOIT DE PAILLE superposés sur les 2 tuiles intérieures (enclos entièrement toité).
      for (let x = 1; x <= 2; x++) await doAction({ type: 'build', structure: 'floor', tx: ox + x, ty: oy + 1 }, 170)
      for (let x = 1; x <= 2; x++) await doAction({ type: 'build', structure: 'roof', tx: ox + x, ty: oy + 1 }, 170)
      // LA FORGE À L'INTÉRIEUR : enclume + four (N2), sous le toit.
      await grant('enclume')
      if ((await held()) === 'enclume') await doAction({ type: 'place_component', tx: ox + 1, ty: oy + 1 }, 240)
      await grant('furnace')
      if ((await held()) === 'furnace') await doAction({ type: 'place_component', tx: ox + 2, ty: oy + 1 }, 240)
      // Autour, EN PLEIN AIR : un établi (Atelier), un silo (Grenier), une parcelle (Ferme).
      const around = [['workshop', ox - 3, oy + 1], ['silo', ox + 5, oy + 1], ['parcelle', ox + 1, oy + 6]]
      for (const [item, x, y] of around) {
        const st = await page.evaluate(({ x, y }) => {
          const s = window.__BRAISES__.scene
          return s.view.nodes.some((n) => n.tx === x && n.ty === y) ? 'noeud' : 'ok'
        }, { x, y })
        if (st !== 'ok') continue
        await doAction({ type: 'debug_teleport', x: x + 0.5, y: y + 1.5 }, 200)
        await grant(item)
        if ((await held()) === item) await doAction({ type: 'place_component', tx: x, ty: y }, 240)
      }
      const fns = await page.evaluate(() => window.__BRAISES__.scene.view.functions.map((f) => `${f.functionId} N${f.tier}${f.enclosed ? '✦' : ''}`))
      console.log(`fonctions reconnues → ${fns.join(', ')} (✦ = enceinte + bonus)`)
      const diag = await page.evaluate(({ ox, oy }) => {
        const st = window.__BRAISES__.scene.view.structures
        const at = (x, y) => st.filter((s) => s.tx === x && s.ty === y).map((s) => s.type).join('+')
        return { c1: at(ox + 1, oy + 1), c2: at(ox + 2, oy + 1), walls: st.filter((s) => s.type === 'wall').length, roofs: st.filter((s) => s.type === 'roof').length }
      }, { ox, oy })
      console.log(`diag → tuile forge 1: [${diag.c1}], tuile 2: [${diag.c2}], murs=${diag.walls} toits=${diag.roofs}`)

      const cx = ox + 1, cy = oy + 1 // centre de la Forge
      await page.mouse.move(640, 400) // curseur au centre : neutralise le lookahead caméra
      // EXTÉRIEUR : l'avatar s'écarte (~14 tuiles, chaume redevenu opaque) et on DÉZOOME
      // pour que la bâtisse close tienne à l'écran — le toit de paille rabattu sur la Forge.
      await doAction({ type: 'debug_teleport', x: cx + 0.5, y: cy + 14.5 }, 500)
      await page.evaluate(() => window.__BRAISES__.scene.cameras.main.setZoom(1.35))
      await page.mouse.move(640, 400)
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/village-exterieur.png` })
      // INTÉRIEUR : même cadrage, l'avatar ENTRE dans la Forge → à moins de 6 tuiles le
      // chaume se lève (même cercle de révélation que la cime des arbres) et l'amas se
      // découvre. (On NE re-zoome PAS : un setZoom plus serré fait planter le renderer.)
      await doAction({ type: 'debug_teleport', x: cx + 0.5, y: cy + 0.5 }, 750)
      await page.mouse.move(640, 400)
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/village-interieur.png` })
      console.log(`captures → ${OUT}/village-{exterieur,interieur}.png`)
    }
    await page.screenshot({ path: `${OUT}/village.png` })
  },
}

const run = SCENARIOS[scenario]
if (!run) {
  console.error(`Scénario inconnu : « ${scenario} ». Connus : ${Object.keys(SCENARIOS).join(', ')}`)
  process.exit(1)
}

const stop = await serve()
const browser = await chromium.launch({
  headless: !headed,
  // SwiftShader : la machine de dev est une VM KVM sans GPU (driver DRM cirrus-qemu),
  // donc AUCUN navigateur n'y aura de rendu accéléré — installer un Chrome système ou
  // passer en `channel: 'chrome'` ne change rien, mesuré. Et on veut un rendu déterministe :
  // le Chromium de Playwright est pinné, Chrome stable s'auto-update.
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    // `ashes.test` n'existe que dans le proxy Traefik : on le résout ici même.
    ...(dev ? ['--host-resolver-rules=MAP ashes.test 127.0.0.1'] : []),
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

let failed = false
page.on('pageerror', (e) => {
  console.error(`!! ERREUR DE PAGE : ${e.message}`)
  failed = true
})
page.on('console', (m) => {
  if (m.type() === 'error') console.error(`!! CONSOLE : ${m.text()}`)
})

try {
  // Le serveur met un instant à écouter — on retente plutôt que de dormir au hasard.
  for (let i = 0; ; i += 1) {
    try {
      await page.goto(URL, { waitUntil: 'networkidle', timeout: 10000 })
      break
    } catch (e) {
      if (i >= 15) throw e
      await page.waitForTimeout(1000)
    }
  }
  // Le jeu est prêt quand WorldScene a publié la carte (donc après le `ready` de l'hôte).
  await page.waitForFunction(() => window.__BRAISES__?.scene?.registry?.get('mapData'), null, { timeout: 60000 })
  await page.waitForTimeout(1500) // quelques ticks de sim, le temps que le HUD se remplisse

  await run(page)
} finally {
  await browser.close()
  stop()
}

console.log(`\ncaptures → ${OUT}`)
if (failed) {
  console.error('\n✗ le jeu a jeté une erreur — voir ci-dessus')
  process.exit(1)
}
