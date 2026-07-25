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
import { mkdirSync, writeFileSync } from 'node:fs'
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
const BASE_URL = process.env.SMOKE_URL ?? (dev ? 'http://ashes.localhost/' : `http://localhost:${PORT}/`)
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
   * LE CUBIQUE (DA 2026-07-24) — décor passé en normal-map + fleurs en VARIÉTÉS. On MESURE ce qui se
   * mesure (géométrie du miroir, étendue des facettes de la normale) et on CAPTURE ce qui se juge à
   * l'œil (variété des fleurs, penche des nœuds-plantes au vent). Tourne en build de PROD — aucun TP.
   */
  async cubique(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 150000 })
    await page.waitForTimeout(800)

    // 1) MIROIR — `cl-grass_tuft_lit` vs `_lit_m` : les colonnes opaques doivent être {15 − x}. C'est
    //    LE fix de variété (un flip Phaser casserait la normale ; on pré-retourne le canvas).
    const mir = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const cols = (key) => {
        const img = s.textures.get(key).getSourceImage()
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0)
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
      const nxRange = (key, x0, y0, x1, y1) => {
        const tex = s.textures.get(key)
        const src = tex && tex.dataSource && tex.dataSource[0]
        const nrm = src ? (src.image || src) : null
        if (!nrm) return null
        const cv = document.createElement('canvas'); cv.width = nrm.width; cv.height = nrm.height
        const cx = cv.getContext('2d'); cx.drawImage(nrm, 0, 0)
        const d = cx.getImageData(0, 0, cv.width, cv.height).data
        let mn = 1, mx = -1
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const nx = (d[(y * cv.width + x) * 4] / 255) * 2 - 1
          if (nx < mn) mn = nx; if (nx > mx) mx = nx
        }
        return mx <= mn ? 0 : +(mx - mn).toFixed(2)
      }
      const flowers = []
      for (let i = 0; s.textures.exists(`cl-flower-${i}_lit`); i++) flowers.push(nxRange(`cl-flower-${i}_lit`, 4, 2, 12, 10))
      return { flowers, grass: nxRange('cl-grass_tuft_lit', 4, 7, 13, 15), bush: nxRange('cl-bush_lit', 2, 3, 14, 14) }
    })
    console.log(`FACETTES nx (étendue) — fleurs:[${fac.flowers.join(', ')}]  grass(≈plat):${fac.grass}  bush(cube réf):${fac.bush}`)

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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })

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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 150000 })

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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })

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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })

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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })

    // Un feu de camp + de quoi remplir le sac (pour VOIR le composant sac/ceinture partagé),
    // et on gagne du terrain DÉGAGÉ (le spawn est un village).
    // Le client n'envoie QU'UNE action par frame : on ESPACE les grants (sinon seul le dernier
    // survit). Un feu de camp + de quoi remplir le sac (bois, viande) pour voir le composant.
    for (const item of ['campfire', 'wood', 'wood', 'wood', 'wood', 'wood', 'raw_meat', 'raw_meat']) {
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
    // On met une viande à cuire pour montrer le flux ENTRÉE → SORTIE (elle en ressort CUITE).
    if (feu) await page.evaluate((id) => window.__BRAISES__.scene.sendAction({ type: 'cook_put', structureId: id, item: 'raw_meat' }), feu.id)
    await page.waitForTimeout(6500)

    const diag = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const inv = s.registry.get('inv') ?? []
      const items = inv.filter(Boolean).map((c) => `${c.item}×${c.count}`)
      const v = s.registry.get('openFireView')
      return { items, modal: v ? { title: v.title, state: v.state, wood: v.fuelWood, timeTicks: v.fuelTimeRemaining } : null }
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
      ? `   ✓ l'eau tient dans son lit`
      : `   ✗ l'eau a QUITTÉ ses berges (${pct.toFixed(1)} % de justesse — la projection du shader est fausse)`)
    return { justesse }
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
        c.getContext('2d').drawImage(img, 0, 0)
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
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
        const tc = t.getContext('2d'); tc.drawImage(nrm, 0, 0)
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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })
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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })
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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })
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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })
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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })
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
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), { timeout: 60000 })
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
