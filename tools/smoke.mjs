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
