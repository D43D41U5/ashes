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
 * http://ashes.localhost (docker compose : service `client` derrière Traefik).
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
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'scratchpad/smoke')
const PORT = 4173

const args = process.argv.slice(2)
const headed = args.includes('--headed')
const dev = args.includes('--dev')
const scenario = args[args.indexOf('--scenario') + 1] ?? 'default'
const URL = process.env.SMOKE_URL ?? (dev ? 'http://ashes.localhost/' : `http://localhost:${PORT}/`)

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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry), { timeout: 30000 })

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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry), { timeout: 30000 })
    await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('fatal')), { timeout: 20000 })

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
      .waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData')), { timeout: 90000 })
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
   * On mesure sur le torrent le plus HAUT de la carte, là où le cisaillement est maximal.
   */
  async eauBerges(page) {
    const site = await page.evaluate(() => {
      const map = window.__BRAISES__.scene.registry.get('mapData')
      let best = null
      let bestE = -1
      for (let ty = 6; ty < map.height - 6; ty += 3) {
        for (let tx = 6; tx < map.width - 6; tx += 3) {
          const i = ty * map.width + tx
          const t = map.terrain[i]
          if (t !== 4 && t !== 6) continue
          const e = map.elevation[i]
          if (e > bestE) {
            bestE = e
            best = { x: tx, y: ty }
          }
        }
      }
      return { ...best, elev: bestE }
    })
    console.log(`torrent le plus haut : (${site.x}, ${site.y}), élévation ${site.elev.toFixed(2)}`)

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
      c.getContext('2d').drawImage(img, 0, 0)
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
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
      ? `   ✓ l'eau tient dans son lit, même sur le versant`
      : `   ✗ l'eau a QUITTÉ ses berges (${pct.toFixed(1)} % de justesse — le cisaillement du shader est faux)`)
    return { justesse, elev: site.elev }
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
    console.log(`  captures : faune.png / faune-zoom.png`)
    return b
  },

  /** Le jeu démarre-t-il, rend-il, et que contient sa vallée ? */
  async default(page) {
    const s = await page.evaluate(PROBE)
    console.log(`tick ${s.tick} · joueur (${s.player.x.toFixed(1)}, ${s.player.y.toFixed(1)}) · ${s.pois.length} lieux sur la carte`)
    await page.screenshot({ path: `${OUT}/monde.png` })
    return s
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
      }
      // Les onze chargés sont en MAJUSCULES ci-dessus — on les souligne en couleur.
      const CHARGED = new Set(['belvedere', 'grotte', 'cascade', 'erratique', 'arbre', 'cairn',
        'sanctuaire', 'source_chaude', 'arche', 'tarn', 'petroglyphes'])

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
        { titre: 'ÉCONOMIE', slugs: ['gisement', 'carriere', 'saline', 'verger'] },
        { titre: 'ABRIS', slugs: ['ruines', 'cabane', 'abri', 'mine', 'oratoire', 'bivouac'] },
        { titre: 'DANGER', slugs: ['taniere', 'repaire', 'epave', 'fondriere', 'crevasses'] },
        { titre: 'LES ONZE LIEUX CHARGÉS — savoir', slugs: ['belvedere', 'cairn', 'petroglyphes', 'arche'] },
        { titre: 'LES ONZE — répit', slugs: ['source_chaude', 'grotte', 'tarn'] },
        { titre: 'LES ONZE — récit', slugs: ['sanctuaire', 'arbre', 'erratique', 'cascade'] },
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
    await page.keyboard.press('F1')
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
    await page.keyboard.press('F1')
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
      source_chaude: 'repit', grotte: 'repit', tarn: 'repit',
      sanctuaire: 'recit', arbre: 'recit', erratique: 'recit', cascade: 'recit',
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

    await page.keyboard.press('F1') // arme l'affichage debug (le TP passe par le registry)
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
    const ouvert = await page.evaluate(() => window.__BRAISES__.scene.registry.get('inventoryOpen'))
    console.log(ouvert ? `   ✓ TAB ouvre l'écran d'inventaire` : `   ✗ TAB n'ouvre rien`)
    await page.screenshot({ path: `${OUT}/sac-inventaire-ouvert.png` })

    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    return socle
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
  // SwiftShader : pas de GPU sous WSL2, et on veut un rendu déterministe.
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
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
  await page.waitForFunction(() => window.__BRAISES__?.scene?.registry?.get('mapData'), { timeout: 60000 })
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
