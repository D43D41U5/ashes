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
import { inflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
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
/**
 * `--prise <nom>[,<nom>…]` — ne tirer QUE ces prises de la vitrine (la planche complète sinon).
 *
 * Ajouté le 2026-07-29, après qu'un timeout de capture (le flake SwiftShader de cette machine)
 * a fait tomber la deuxième série au deuxième cliché : rejouer neuf prises pour en récupérer
 * deux coûte huit minutes ET rejoue le tirage aux dés. Le montage final est sauté quand un
 * filtre est actif — il juge la vitrine, pas une prise isolée.
 */
const prisesVoulues = args.includes('--prise')
  ? new Set((args[args.indexOf('--prise') + 1] ?? '').split(',').filter(Boolean))
  : null
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
    ['--filter', '@ashes/client', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
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

/**
 * LA CANOPÉE RESTE PLEINE POUR LES PHOTOS (demande d'Alexis, 2026-07-29).
 *
 * `crownAlpha` efface la cime au-dessus du joueur — c'est une aide de JEU (voir où l'on marche),
 * et c'est un défaut sur une CAPTURE : on photographie une forêt de troncs sous des houppiers
 * fantômes, et la moitié de l'art ne se voit pas. Même famille que le masquage du HUD, du tampon
 * de build et des noms de lieux : des retraits d'AFFORDANCE, que la photo ne veut pas.
 *
 * À rappeler APRÈS chaque téléportation : le pool de houppiers se réarme à chaque image, mais
 * l'interrupteur, lui, vit sur la vue — un seul appel par scène suffit. On le refait quand même
 * à chaque prise, parce qu'un scénario qui recharge la page perdrait le réglage en silence.
 */
const canopeePleine = (page) => page.evaluate(() => {
  window.__BRAISES__.scene.view?.setCanopeePleine?.(true)
})

/**
 * FRAPPER UN NŒUD JUSQU'À CE QU'IL MEURE, au VRAI rythme de son verbe.
 *
 * Le premier jet martelait `harvest { whole: true }` en boucle serrée : ni l'arbre ni le
 * rocher n'en meurent jamais (la sim ne concède `whole` qu'au métier `foraging`, et le
 * minage garde sa cadence). On envoie donc le geste que le nœud demande, à l'intervalle
 * qu'il impose, et on s'arrête dès que la sonde a vu naître l'animation. Rend `false` si
 * le nœud n'est pas mort dans le nombre de coups imparti — jamais un faux vert.
 */
async function frapperJusquAMort(page, nodeId, action, intervalle, coups, sonde, whole = false) {
  const cle = sonde()
  for (let i = 0; i < coups; i++) {
    await page.evaluate(({ id, action, whole }) => {
      window.__BRAISES__.scene.sendAction({ type: action, nodeId: id, ...(whole ? { whole: true } : {}) })
    }, { id: nodeId, action, whole })
    await page.waitForTimeout(intervalle)
    const vu = await page.evaluate((k) => (window.__PROBE__?.[k] ?? 0) > 0, cle)
    if (vu) return true
  }
  return false
}

/**
 * LA COULEUR D'UN PIXEL À L'ÉCRAN — par une capture de 1×1, décodée ici.
 *
 * POURQUOI PAS `getImageData` : le canvas de Phaser est un contexte WebGL sans
 * `preserveDrawingBuffer`. Le recopier dans un canvas 2D hors du cycle de rendu rend du NOIR
 * (MESURÉ : [0,0,0] partout, y compris sur l'herbe) — une sonde qui ment sans le dire.
 *
 * Playwright, lui, capture après composition. Un PNG de 1×1 se décode sans dépendance : une
 * seule scanline, donc un octet de filtre puis les canaux — et sur le PREMIER pixel les cinq
 * filtres PNG se réduisent tous au brut (aucun voisin à gauche ni au-dessus).
 */
async function pixelAt(page, x, y) {
  const png = await page.screenshot({ clip: { x: Math.max(0, x), y: Math.max(0, y), width: 1, height: 1 } })
  // ON RECOLLE TOUS LES `IDAT` AVANT D'INFLATER : le flux deflate est UN seul flux, mais rien
  // n'oblige l'encodeur à le mettre dans un seul chunk — Chromium le découpe, et inflater le
  // premier morceau seul lève `Z_BUF_ERROR` (« unexpected end of file »).
  let i = 8 //  on saute la signature
  const morceaux = []
  while (i + 8 <= png.length) {
    const len = png.readUInt32BE(i)
    const type = png.toString('ascii', i + 4, i + 8)
    if (type === 'IDAT') morceaux.push(png.subarray(i + 8, i + 8 + len))
    if (type === 'IEND') break
    i += 12 + len
  }
  if (morceaux.length === 0) return null
  const brut = inflateSync(Buffer.concat(morceaux))
  return [brut[1], brut[2], brut[3]]
}

/** L'écart de LUMINANCE entre deux points de l'écran — le nombre qui tranche « on le voit ». */
async function mesurerContraste(page, a, b) {
  const pa = await pixelAt(page, a.x, a.y)
  const pb = await pixelAt(page, b.x, b.y)
  if (!pa || !pb) return null
  const lum = ([r, v, bl]) => 0.2126 * r + 0.7152 * v + 0.0722 * bl
  return { fantome: pa, fond: pb, dLum: Number((lum(pa) - lum(pb)).toFixed(1)) }
}

const SCENARIOS = {
  /**
   * VILLAGE-PNJ (2026-07-31) — le campement du palier 1 SE VOIT (spec village-pnj-evolution R1).
   *
   * Ce qui ne se prouve qu'au navigateur : le spawn n'est plus « 1 feu + 3 chips house + 1
   * coffre », c'est un CAMPEMENT — des paillasses autour d'un Feu et d'un grenier. On lit
   * l'état (villages PNJ du snapshot, zéro `house`), puis on va REGARDER. Les pièces des
   * paliers 2-3 (murs d'arêtes, portes, stations) sont celles du joueur, déjà rendues par
   * le même pipeline — le neuf visible à la fondation, c'est le camp. Exige `--dev` (TP).
   */
  async 'village-pnj'(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1000)

    const etat = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const villages = (sc.view?.villages ?? []).filter((v) => v.chiefId === 0)
      const structures = sc.view?.structures ?? []
      return villages.map((v) => ({
        id: v.id,
        buildTier: v.buildTier ?? 1,
        x: v.fireTx,
        y: v.fireTy,
        paillasses: structures.filter((s) => s.type === 'paillasse' && s.villageId === v.id).length,
        houses: structures.filter((s) => s.type === 'house' && s.villageId === v.id).length,
      }))
    })
    console.log(`villages PNJ : ${JSON.stringify(etat)}`)
    if (etat.length === 0) console.error('!! aucun village PNJ dans le snapshot')
    for (const v of etat) {
      if (v.houses !== 0) console.error(`!! le village ${v.id} a encore ${v.houses} house (chip d'une tuile)`)
      if (v.paillasses < 3) console.error(`!! le village ${v.id} n'a que ${v.paillasses} paillasse(s) — le campement manque`)
    }

    // Plein jour, puis on va regarder le premier village — À CHAQUE PALIER : le
    // campement tel qu'il naît, puis le hameau et le bourg TAMPONNÉS par
    // `debug_village_stage` (le plan directeur posé d'un coup — la cadence du vrai
    // chantier étale ça sur un arc de saison, invisible en smoke).
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)
    const v = etat[0]
    if (v) {
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: x + 0.5, y: y + 2.5 })
      }, v)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/village-pnj-1-campement.png` })
      console.log(`   → palier 1 (campement) du village ${v.id} @(${v.x}, ${v.y})`)

      for (const [stage, nom] of [[2, 'hameau'], [3, 'bourg']]) {
        await page.evaluate(({ id, s }) => {
          window.__BRAISES__.scene.sendAction({ type: 'debug_village_stage', villageId: id, stage: s })
        }, { id: v.id, s: stage })
        await page.waitForTimeout(2000) // le tampon puis le snapshot qui le montre
        const compte = await page.evaluate((id) => {
          const st = window.__BRAISES__.scene.view?.structures ?? []
          const du = st.filter((q) => q.villageId === id)
          const n = (t) => du.filter((q) => q.type === t).length
          return {
            walls: n('wall'), doors: n('door'), floors: n('floor'),
            pierre: du.filter((q) => (q.type === 'wall' || q.type === 'door') && q.material === 'stone').length,
            stations: n('workshop') + n('furnace') + n('silo'),
          }
        }, v.id)
        console.log(`   palier ${stage} : ${JSON.stringify(compte)}`)
        if (stage === 2 && (compte.walls < 40 || compte.floors < 20)) {
          console.error(`!! palier 2 : le hameau manque de pièces (${compte.walls} murs, ${compte.floors} sols)`)
        }
        // ≥ 2 stations et pas 3 : le plan SAUTE honnêtement un emplacement pris (un
        // lieu bâti voisin, un nœud qui a dérivé) — c'est la règle faisable-ou-sauté.
        if (stage === 3 && (compte.stations < 2 || compte.pierre < 40)) {
          console.error(`!! palier 3 : stations ou pierre manquantes (${compte.stations} stations, ${compte.pierre} pierres)`)
        }
        await page.screenshot({ path: `${OUT}/village-pnj-${stage}-${nom}.png` })
        console.log(`   → palier ${stage} (${nom})`)
      }
    }
  },

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
      await canopeePleine(page) // la cime ne s'efface pas sur une photo
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
    // LE BOSQUET DE CRÊTE (t0 R31, 2026-07-29) — le bois SEC des dos, pin et mélèze. Il empile
    // deux couches denses qui n'avaient JAMAIS coexisté : le clutter du pin (0,4) et les nœuds
    // d'arbres de la futaie (un tous les ~5 tuiles), que le pin ne recevait pas tant qu'il vivait
    // hors de la Racine. Si ça doit être un mur végétal, c'est ici qu'on le verra.
    const crete = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      // Le plus gros amas de conifère : on balaie au pas de 4, on garde le centre du meilleur bloc.
      const PIN = 13
      const MELEZE = 14
      // DANS LA RACINE, ET SEULEMENT ELLE. Le pin existe aussi dans les zones du nord (`HAUT_BOIS`
      // de `solDe`) : sans ce filtre, le balayage trouve la futaie d'une T1 et l'on capture un
      // bois qui n'a rien à voir. Attrapé en regardant l'ordonnée de la première capture — 752,
      // soit huit cents tuiles au nord des Prés Bas.
      const idRacine = (m.zoneDefs ?? []).findIndex((d) => d.slug === 'pres_bas')
      const cols = Math.ceil(m.width / m.zonePas)
      const dansRacine = (x, y) =>
        m.zoneGrid[Math.floor(y / m.zonePas) * cols + Math.floor(x / m.zonePas)] === idRacine
      let best = null
      for (let by = 0; by < m.height - 32; by += 32) {
        for (let bx = 0; bx < m.width - 32; bx += 32) {
          if (!dansRacine(bx + 16, by + 16)) continue
          let n = 0
          for (let y = by; y < by + 32; y += 4) {
            for (let x = bx; x < bx + 32; x += 4) {
              const t = m.terrain[y * m.width + x]
              if (t === PIN || t === MELEZE) n++
            }
          }
          if (!best || n > best.n) best = { n, x: bx + 16, y: by + 16 }
        }
      }
      return best && best.n > 20 ? best : null
    })
    if (crete) await viser('bosquet-crete', crete.x, crete.y)
    else console.error('!! aucun bosquet de crête trouvé sur la carte (t0 R31)')
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
    // ALLER À L'OUEST, C'EST `KeyQ` — PAS `KeyA`. Playwright frappe sur un QWERTY US :
    // `KeyQ` envoie le keyCode 81, et 81 est la gauche du jeu depuis le 2026-07-27 (ZQSD ;
    // voir `keymap.ts`, `moveLeft`). `KeyA` envoie 65, qui fait désormais TOURNER un fantôme.
    await page.keyboard.down('KeyQ')
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(160)
      const w = await page.evaluate(() => window.__BRAISES__.scene.lastWaderCount)
      wMarche = Math.max(wMarche, w)
    }
    await page.screenshot({ path: `${OUT}/feeling-remous.png` })
    await page.keyboard.up('KeyQ')
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
      '<!doctype html><meta charset="utf-8"><title>ASHES — planche d\'art</title>',
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
   * LA MATIÈRE DU SOL — les cinq familles sont-elles VRAIMENT posées (spec da-feeling §8) ?
   *
   * Ce que seul le navigateur prouve : que l'atlas est cuit à la bonne largeur, que la passe
   * émet des quads, et surtout que le SAUT TUILE-À-TUILE du bake est retombé — c'est-à-dire
   * que la grille de 16 px ne se lit plus (R20). On mesure DANS LE BAKE et non à l'écran :
   * les couches supérieures (éclairage, décor) sont identiques quoi qu'on fasse et ne
   * feraient que masquer ce qu'on juge.
   *
   * Deux pièges appris à la dure, tous deux consignés dans le code ci-dessous : `getPixel`
   * prend `(x, y, clé)` — la clé en premier rend `null` en silence ; et un `evaluate` qui
   * balaie longtemps BLOQUE la page, laisse enfler le tampon CDP et tue l'outil sur
   * ERR_STRING_TOO_LONG. Tout balayage est donc borné.
   *
   * Exige `--dev` (TP + heure).
   */
  async matiere(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('mapData')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const FAM = {
      1: 'herbe', 2: 'mineral', 3: 'litiere', 5: 'mineral', 8: 'humide', 9: 'mineral',
      10: 'neige', 11: 'herbe', 12: 'herbe', 13: 'litiere', 14: 'litiere', 15: 'neige',
      16: 'mineral', 17: 'herbe', 18: 'humide', 19: 'humide', 20: 'herbe', 21: 'litiere',
      22: 'litiere',
    }

    const etat = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      // L'atlas porte le seed dans sa clé (sinon une 2e Veillée hérite du motif de la 1re).
      const cles = sc.textures.getTextureKeys().filter((k) => k.startsWith('grain-sol-'))
      const t = cles.length ? sc.textures.get(cles[0]).getSourceImage() : null
      return { cles, largeur: t ? t.width : 0, hauteur: t ? t.height : 0 }
    })
    console.log(`atlas : ${JSON.stringify(etat)}`)
    if (etat.cles.length !== 1) console.error(`!! ${etat.cles.length} atlas de matière (1 attendu)`)
    // 5 familles × 64 cellules de côté.
    if (etat.largeur !== 320 || etat.hauteur !== 64) console.error('!! l\'atlas n\'a pas 5 blocs de 64×64')

    // LE SAUT TUILE-À-TUILE dans le bake, famille par famille. Balayage BORNÉ (voir en-tête).
    const sauts = await page.evaluate((FAM) => {
      const sc = window.__BRAISES__.scene
      const m = sc.registry.get('mapData')
      const W = m.width, H = m.height
      const lum = (x, y) => {
        const c = sc.textures.getPixel(x, y, 'map-demo') // (x, y, CLÉ) — l'ordre compte
        return c ? 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue : null
      }
      // AU CŒUR D'UN PAYS, et c'est la condition qui fait que la mesure porte sur la MATIÈRE.
      // Au BORD, le tramage de lisière (le mélange par tuile des teintes de deux pays voisins)
      // saute à 13 en luminance contre 5 au cœur — 2,6× ce que la matière fait. Il est
      // délibéré et hors périmètre (spec da-feeling R22) : le mesurer ici ne jugerait pas le
      // sol mais lui, et ferait rougir la garde pour une raison étrangère.
      const pas = m.zonePas ?? 0
      const cols = Math.ceil(W / pas)
      const rows = Math.ceil(H / pas)
      const zoneA = (x, y) => (m.zoneGrid && pas
        ? (m.zoneGrid[Math.min(cols - 1, Math.max(0, Math.floor(x / pas)))
          + Math.min(rows - 1, Math.max(0, Math.floor(y / pas))) * cols] ?? -1)
        : 0)
      const auCoeur = (x, y) => {
        if (!m.zoneGrid || !pas) return true
        const z0 = zoneA(x, y)
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (zoneA(x + dx * pas, y + dy * pas) !== z0) return false
        }
        return true
      }
      const out = {}
      for (const fam of ['mineral', 'litiere', 'herbe', 'neige', 'humide']) {
        let site = null
        let vus = 0
        for (let y = 60; y < H - 60 && !site; y += 11) {
          for (let x = 60; x < W - 60; x += 11) {
            if (FAM[m.terrain[y * W + x]] !== fam) continue
            if (++vus > 20000) break
            if (!auCoeur(x, y)) continue
            let pur = true
            for (let dy = -6; dy <= 6 && pur; dy += 3) for (let dx = -6; dx <= 6 && pur; dx += 3) {
              if (FAM[m.terrain[(y + dy) * W + (x + dx)]] !== fam) pur = false
            }
            if (pur) { site = { x, y }; break }
          }
        }
        if (!site) { out[fam] = null; continue }
        const v = []
        for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) v.push(lum(site.x + dx, site.y + dy))
        if (v.some((z) => z === null)) { out[fam] = null; continue }
        let s = 0, n = 0
        for (let dy = 0; dy < 13; dy++) for (let dx = 0; dx < 12; dx++) { s += Math.abs(v[dy * 13 + dx] - v[dy * 13 + dx + 1]); n++ }
        out[fam] = { pos: [site.x, site.y], lum: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), saut: +(s / n).toFixed(2) }
      }
      return out
    }, FAM)

    for (const [fam, r] of Object.entries(sauts)) {
      if (!r) { console.log(`  ${fam.padEnd(8)} — pas de coin franc sur cette carte`); continue }
      console.log(`  ${fam.padEnd(8)} lum ${String(r.lum).padStart(5)}  saut ${String(r.saut).padStart(5)}  @(${r.pos[0]}, ${r.pos[1]})`)
    }
    // A11 : la neige est le juge. Elle valait 5,02 avant la matière au cœur d'un pays ; le
    // seuil laisse la marge du site (le tramage de lisière saute, lui, à 13 — voir R22).
    const neige = sauts.neige
    if (neige && neige.saut > 3.5) {
      console.error(`!! la grille de 16 px se lit encore sur la neige (saut ${neige.saut}, ≤ 3,5 attendu)`)
    } else if (neige) {
      console.log(`   ✓ la grille a lâché sur la neige (saut ${neige.saut})`)
    }

    // La passe émet-elle vraiment des quads ? (Une famille `null` partout donnerait 0.)
    const quads = await page.evaluate(() => {
      const g = window.__BRAISES__.scene.ground
      return g && g.grainQuads ? g.grainQuads() : -1
    })
    console.log(quads > 0
      ? `   ✓ la passe de matière émet ${quads} quads sur la vue courante`
      : `!! la passe de matière n'émet RIEN (${quads})`)

    await page.screenshot({ path: `${OUT}/matiere-sol.png` })
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
    // `O` (ouest) = `KeyQ` : Playwright frappe sur un QWERTY US, donc `KeyQ` → keyCode 81,
    // la gauche du ZQSD (keymap.ts). `KeyA` (65) fait tourner un fantôme, il ne marche plus.
    const KEYS = { E: 'KeyD', O: 'KeyQ', S: 'KeyS', N: 'KeyW' }
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
    // Ouest = `KeyQ` (keyCode 81, la gauche du ZQSD) — pas `KeyA`, qui vaut 65 et tourne.
    const touche = process.argv.includes('--vers-la-foret') ? 'KeyQ' : 'KeyD'
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
        else if (m.x - st.p.x < -0.7) want.add('KeyQ') // ouest = 81 (ZQSD), pas KeyA/65
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
  /**
   * LES QUATRE DIRECTIONS BOUGENT-ELLES VRAIMENT ? (2026-07-27)
   *
   * `keymap.test.ts` garde l'unicité des alias — jamais la COUVERTURE. Le jour où `moveLeft` a
   * perdu son alias 81 sur une théorie fausse (« Phaser résout par position physique » : non, il
   * dispatche sur `event.keyCode`, qui suit l'étiquette de la disposition), la gauche du ZQSD est
   * morte EN SILENCE et tous les tests sont restés verts. Il fallait ouvrir le jeu pour le voir.
   *
   * Ce scénario l'ouvre. Il tient chaque touche et LIT L'AXE que la scène en tire — l'état
   * `isDown` des `Phaser.Key` que `WorldScene.axis()` interroge à chaque frame. C'est la couche
   * EXACTE qui a cassé (quel keyCode nourrit quelle direction), et la seule mesurable ici :
   * mesurer par la POSITION ne marche pas dans ce harnais, l'horloge headless stalle puis le
   * worker rattrape ses ticks en rafale — l'avatar avance encore 14 tuiles après le relâchement,
   * bien après la lecture. On garde donc une seule lecture de position, indicative, pour prouver
   * qu'un axe armé fait VRAIMENT avancer (le reste du fil : prédiction, worker, snapshot).
   *
   * Playwright frappe sur un QWERTY US : `KeyQ`→81, `KeyZ`→90, `KeyS`→83, `KeyD`→68 — exactement
   * les codes qu'émet un AZERTY qui joue en ZQSD. `KeyA`→65 est la touche LIBÉRÉE : elle ne doit
   * plus armer aucune direction.
   */
  async deplacement(page) {
    await page.waitForTimeout(1200) // le monde se pose (le spawn glisse encore)
    /** Les quatre axes tels que la scène les voit MAINTENANT — sans passer par la sim. */
    const axes = () => page.evaluate(() => {
      const k = window.__BRAISES__.scene.inputs.keys
      const bas = (dir) => k[dir].some((key) => key.isDown)
      return { left: bas('left'), right: bas('right'), up: bas('up'), down: bas('down') }
    })
    const CAS = [
      { nom: 'gauche (ZQSD)', touche: 'KeyQ', attendu: 'left' },
      { nom: 'droite', touche: 'KeyD', attendu: 'right' },
      { nom: 'haut (ZQSD)', touche: 'KeyZ', attendu: 'up' },
      { nom: 'bas', touche: 'KeyS', attendu: 'down' },
      // La touche LIBÉRÉE le 2026-07-27 : 65 n'est plus la gauche (elle ira tourner un fantôme).
      { nom: 'A libérée', touche: 'KeyA', attendu: null },
    ]
    const lignes = []
    let cassées = 0
    for (const c of CAS) {
      await page.keyboard.down(c.touche)
      await page.waitForTimeout(120) // Phaser traite sa file d'événements à la frame
      const a = await axes()
      await page.keyboard.up(c.touche)
      await page.waitForTimeout(120)
      const relâché = await axes()
      const armés = Object.keys(a).filter((d) => a[d])
      // Bon = l'axe attendu est armé, LUI SEUL, et il retombe au relâchement. « lui seul »
      // compte autant que « armé » : c'est ainsi qu'une touche volée à une action se voit.
      const ok = c.attendu === null
        ? armés.length === 0
        : armés.length === 1 && armés[0] === c.attendu && !Object.values(relâché).some(Boolean)
      if (!ok) cassées++
      lignes.push(
        `${c.nom.padEnd(14)} [${c.touche}] → ${armés.length ? armés.join('+') : 'aucun axe'} ${ok ? '✓' : '✗'}` +
          (c.attendu === null ? ' (elle ne doit plus déplacer)' : ` (attendu : ${c.attendu})`),
      )
    }

    // ET L'AVATAR AVANCE-T-IL POUR DE VRAI ? Une seule mesure, sur la gauche — celle qui était
    // morte. On ATTEND le déplacement au lieu de l'échantillonner à heure fixe : ici le rendu
    // est FAMÉLIQUE (MESURÉ : ~4 frames en 2,7 s sous swiftshader, pendant que la sim avalait
    // 104 ticks), et `playerPos` ne s'écrit que dans `update()` — une fenêtre fixe tombe entre
    // deux frames et lit 0,00 sans que rien ne soit cassé. On tient donc la touche et on
    // sonde jusqu'à voir l'ouest arriver, avec une échéance.
    const px = () => page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      return { x: sc.registry.get('playerPos').x, tick: sc.lastSnapshotTick, frames: sc.game.loop.frame }
    })
    const s0 = await px()
    let s1 = s0
    await page.keyboard.down('KeyQ')
    for (let i = 0; i < 32 && s0.x - s1.x <= 0.5; i++) {
      await page.waitForTimeout(250)
      s1 = await px()
    }
    await page.keyboard.up('KeyQ')
    const versLOuest = s0.x - s1.x
    const marche = versLOuest > 0.5
    if (!marche) cassées++
    lignes.push(
      `la gauche fait MARCHER : x ${s0.x.toFixed(2)} → ${s1.x.toFixed(2)} (${versLOuest.toFixed(2)} tuile(s) vers l'ouest) ${marche ? '✓' : '✗'}` +
        `  — ticks sim ${s0.tick}→${s1.tick}, frames rendues ${s1.frames - s0.frames}`,
    )

    for (const l of lignes) console.log(`  ${l}`)
    if (cassées > 0) console.error(`!! ${cassées} VÉRIFICATION(S) AU ROUGE — une touche de déplacement est débranchée ou volée`)
    else console.log('les quatre directions du ZQSD répondent, et A ne déplace plus ✓')
    return { lignes, cassées }
  },

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

    // CE MENU N'EFFACE PLUS RIEN (2026-07-28). Il portait « nouvelle Veillée » et sa
    // confirmation rouge — le seul chemin, à l'époque, pour repartir à neuf, puisque l'accueil
    // n'avait qu'une porte. Depuis l'écran des vallées, on efface DANS LA LISTE, en face de ce
    // qu'on perd (scénario `accueil`). Ici, on vérifie deux choses : la sortie existe, et il ne
    // reste AUCUN chemin destructeur — un bouton d'effacement oublié dans un menu de pause est
    // exactement le genre de résidu qu'on ne retrouve qu'après avoir perdu une partie.
    const sortie = await page.evaluate(() => ({
      quit: document.querySelector('.pm-quit')?.textContent ?? '',
      // Le bouton de sortie doit être ENTIÈREMENT à l'écran : posé en bas d'une carte qui
      // défile, il tomberait sous le pli — on ne fait pas chercher une sortie.
      quitOnScreen: (() => {
        const el = document.querySelector('.pm-quit')
        if (!el) return false
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      })(),
      resteDestructeur: Boolean(document.querySelector('.pm-fresh, .pm-fresh-go, .pm-confirm, .pm-danger')),
    }))
    console.log(`sortie du menu pause : ${JSON.stringify(sortie)}`)
    if (!sortie.quit || !sortie.quitOnScreen || sortie.resteDestructeur) {
      console.error(`!! LA SORTIE DU MENU PAUSE NE VA PAS : ${JSON.stringify(sortie)}`)
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const closed = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector('.pause-menu')).display,
      menuOpen: window.__BRAISES__.scene.registry.get('menuOpen'),
    }))
    console.log(`après 2ᵉ ESC : ${JSON.stringify(closed)}`)
    // 6 règles de clic ; les touches sont DÉRIVÉES de `ACTIONS` (14) + la ceinture = 15 lignes.
    // Ce nombre garde surtout que le tableau se peint : vide, il tomberait à 0 sans rien dire.
    if (open.display !== 'flex' || open.clicks !== 6 || open.keys !== 15 || closed.display !== 'none') {
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
  /**
   * L'ÉCRAN DES VALLÉES (2026-07-28) — les trois verbes, sur le vrai jeu.
   *
   * Ce que rien d'autre ne prouve : que FONDER (avec SA seed), REPRENDRE et EFFACER font
   * vraiment ce qu'ils annoncent, bout en bout — le menu, le disque, le Worker, et le retour au
   * menu. Les tests unitaires ne tiennent que les libellés (`monde-libelle`) et la déduction de
   * métadonnées (`persistence-store`) : IndexedDB, lui, n'existe qu'ici.
   *
   * ON NE FABRIQUE AUCUN ÉTAT : le harnais est déjà entré en jeu par `?solo` (case 1, seed
   * canonique) ; on en SORT par le menu pause, ce qui sauve — et c'est cette sauvegarde-là que
   * l'écran doit annoncer. Puis on fonde une deuxième vallée avec une seed choisie, on vérifie
   * que le monde la porte, on revient, et on l'efface.
   */
  async accueil(page) {
    await page.waitForTimeout(1500)

    // ── 1. SORTIR DE LA PARTIE : ESC, puis « retour aux vallées ». WorldScene fait ÉCRIRE la
    //    partie et ne recharge qu'une fois le disque acquitté — la case 1 doit donc être pleine
    //    de l'autre côté, sans qu'on ait attendu les 30 s de l'autosave.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.click('.pm-quit')
    await page.waitForFunction(() => document.querySelector('.bm-menu'), null, { timeout: 30000 })
    await page.waitForTimeout(400)

    // ── 1bis. L'ACCUEIL — trois entrées, et « REPRENDRE » qui NOMME la partie qu'on vient de
    //    quitter. C'est la panne d'origine : une porte qui reprenait sans rien dire.
    const accueil = await page.evaluate(() => ({
      entrees: [...document.querySelectorAll('.bm-e-titre')].map((e) => e.textContent),
      reprendre: document.querySelector('.bm-entree[data-reprendre] .bm-e-sous')?.textContent ?? '',
    }))
    console.log(`accueil : ${JSON.stringify(accueil)}`)
    await page.screenshot({ path: `${OUT}/accueil-principal.png` })
    if (accueil.entrees[0] !== 'REPRENDRE' || !/jour \d+ · seed 2026/.test(accueil.reprendre)) {
      console.error(`!! « REPRENDRE » NE DIT PAS QUELLE PARTIE : ${JSON.stringify(accueil)}`)
    }
    if (!accueil.entrees.includes('JOUER') || !accueil.entrees.includes('OPTIONS')) {
      console.error(`!! L'ACCUEIL N'A PAS SES TROIS ENTRÉES : ${JSON.stringify(accueil.entrees)}`)
    }

    // ── 1ter. JOUER → deux tuiles → SEUL mène à la liste des vallées.
    const auxVallees = async () => {
      await page.click('.bm-entree[data-go="jouer"]')
      await page.waitForTimeout(200)
      await page.click('.bm-tuile[data-go="vallees"]')
      await page.waitForTimeout(250)
    }
    await page.click('.bm-entree[data-go="jouer"]')
    await page.waitForTimeout(250)
    const tuiles = await page.evaluate(() => [...document.querySelectorAll('.bm-t-titre')].map((e) => e.textContent))
    console.log(`tuiles de JOUER : ${JSON.stringify(tuiles)}`)
    await page.screenshot({ path: `${OUT}/accueil-jouer.png` })
    if (tuiles.length !== 2) console.error(`!! JOUER N'A PAS DEUX TUILES : ${JSON.stringify(tuiles)}`)
    await page.click('.bm-tuile[data-go="vallees"]')
    await page.waitForTimeout(250)

    const cases = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.mw-row')].map((r) => ({
          nom: r.querySelector('.mw-name')?.textContent ?? '',
          etat: r.querySelector('.mw-state')?.textContent ?? '',
          quand: r.querySelector('.mw-when')?.textContent ?? '',
          plein: r.classList.contains('mw-plein'),
        })),
      )

    const apresSortie = await cases()
    console.log(`écran des vallées : ${JSON.stringify(apresSortie)}`)
    await page.screenshot({ path: `${OUT}/accueil-vallees.png` })
    if (apresSortie.length !== 5) console.error(`!! ${apresSortie.length} cases au lieu de 5`)
    // La vallée qu'on vient de quitter DOIT s'annoncer — avec son jour et sa seed. Une case
    // muette après une partie, c'est la panne d'origine : la porte qui reprenait en silence.
    if (!apresSortie[0]?.plein || !/jour \d+ · seed 2026/.test(apresSortie[0]?.etat ?? '')) {
      console.error(`!! LA VALLÉE QUITTÉE NE S'ANNONCE PAS : ${JSON.stringify(apresSortie[0])}`)
    }
    if (apresSortie.slice(1).some((c) => c.plein)) console.error(`!! une case jamais jouée se dit pleine`)

    // ── 2. FONDER, EN CHOISISSANT LA SEED. La case vide devient son champ ; on y met la nôtre.
    const SEED = 31415
    const NOM = 'La Combe Grise'
    await page.click('.mw-row:nth-child(2)')
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${OUT}/accueil-semer.png` })
    const champs = await page.evaluate(() => {
      const nom = document.querySelector('.mw-nom')
      const seed = document.querySelector('.mw-seed')
      // Le NOM prend le curseur (c'est le premier geste), la SEED est déjà posée : on ne
      // demande pas de remplir un formulaire pour fonder une vallée.
      return {
        nomFocus: document.activeElement === nom,
        nomVide: nom?.value === '',
        // L'invite EST le nom de repli, à la place exacte du titre : la ligne montre
        // elle-même comment elle s'appellera si on ne la nomme pas.
        invite: nom?.placeholder ?? '',
        seed: seed?.value ?? '',
        de: Boolean(document.querySelector('.mw-de')),
      }
    })
    console.log(`champs de fondation : ${JSON.stringify(champs)}`)
    if (!champs.nomFocus || !champs.nomVide || champs.invite !== 'VALLÉE 2' || champs.seed !== '2026' || !champs.de) {
      console.error(`!! LES CHAMPS DE FONDATION NE SONT PAS PRÊTS : ${JSON.stringify(champs)}`)
    }

    await page.fill('.mw-nom', NOM)
    await page.fill('.mw-seed', String(SEED))
    await page.screenshot({ path: `${OUT}/accueil-semer-rempli.png` })
    await page.click('[data-semer]')
    await page.waitForFunction(() => window.__BRAISES__?.scene?.registry?.get('mapData'), null, { timeout: 150000 })
    await page.waitForTimeout(1500)
    // LA SEED A-T-ELLE PRIS ? On la lit sur la scène — c'est celle que l'hôte a renvoyée dans
    // son `ready`, donc celle que /sim a réellement semée, pas celle qu'on a tapée.
    const semee = await page.evaluate(() => window.__BRAISES__.scene.worldSeed)
    console.log(`seed du monde fondé : ${semee} (demandée ${SEED})`)
    if (semee !== SEED) console.error(`!! LA SEED CHOISIE N'A PAS PRIS : ${semee} ≠ ${SEED}`)
    await page.screenshot({ path: `${OUT}/accueil-monde-seme.png` })

    // ── 3. REVENIR : la deuxième vallée doit maintenant s'annoncer avec SA seed, à côté de la
    //    première — deux mondes distincts sur le même disque, ce que la case unique interdisait.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.click('.pm-quit')
    await page.waitForFunction(() => document.querySelector('.bm-menu'), null, { timeout: 30000 })
    await page.waitForTimeout(400)
    await auxVallees()
    const apresFondation = await cases()
    console.log(`après fondation : ${JSON.stringify(apresFondation)}`)
    await page.screenshot({ path: `${OUT}/accueil-deux-vallees.png` })
    if (!apresFondation[1]?.plein || !apresFondation[1]?.etat.includes(`seed ${SEED}`)) {
      console.error(`!! LA VALLÉE FONDÉE NE S'ANNONCE PAS : ${JSON.stringify(apresFondation[1])}`)
    }
    // LE NOM A-T-IL SURVÉCU au disque et au rechargement ? C'est tout l'intérêt de le ranger
    // dans la méta plutôt qu'à côté : il revient avec le monde, pas avec la session.
    if (apresFondation[1]?.nom !== NOM) {
      console.error(`!! LE NOM DE LA VALLÉE NE SURVIT PAS : « ${apresFondation[1]?.nom} » ≠ « ${NOM} »`)
    }
    // …et la case jamais nommée garde son repli de position.
    if (apresFondation[0]?.nom !== 'VALLÉE 1') {
      console.error(`!! LE REPLI « VALLÉE N » A SAUTÉ : ${JSON.stringify(apresFondation[0])}`)
    }
    if (!apresFondation[0]?.plein) console.error(`!! FONDER UNE VALLÉE A EMPORTÉ L'AUTRE`)

    // ── 4. ROUVRIR UNE VALLÉE (le geste de la stèle de fin de saison) — `?solo&fresh` efface
    //    LA CASE VISÉE, et elle seule. Le mode d'échec de ce chemin n'est pas un affichage de
    //    travers : c'est effacer la mauvaise vallée. On le prouve donc sur la VOISINE, en
    //    vérifiant qu'elle est intacte après coup.
    const base = await page.evaluate(() => location.origin + location.pathname)
    await page.goto(`${base}?solo&fresh&slot=1&seed=888`)
    await page.waitForFunction(() => window.__BRAISES__?.scene?.registry?.get('mapData'), null, { timeout: 150000 })
    await page.waitForTimeout(1500)
    const rouverte = await page.evaluate(() => window.__BRAISES__.scene.worldSeed)
    console.log(`vallée rouverte à neuf : seed ${rouverte} (demandée 888)`)
    if (rouverte !== 888) console.error(`!! ?fresh N'A PAS SEMÉ LA SEED DEMANDÉE : ${rouverte}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.click('.pm-quit')
    await page.waitForFunction(() => document.querySelector('.bm-menu'), null, { timeout: 30000 })
    await page.waitForTimeout(400)
    await auxVallees()
    const apresFresh = await cases()
    console.log(`après ?fresh sur la case 2 : ${JSON.stringify(apresFresh)}`)
    if (apresFresh[1]?.nom !== 'VALLÉE 2') {
      console.error(`!! ?fresh A GARDÉ LE NOM D'UN MONDE EFFACÉ : ${JSON.stringify(apresFresh[1])}`)
    }
    if (!apresFresh[1]?.etat.includes('seed 888')) {
      console.error(`!! LA CASE ROUVERTE N'A PAS CHANGÉ DE MONDE : ${JSON.stringify(apresFresh[1])}`)
    }
    // LA CLAUSE QUI COMPTE : la voisine n'a pas bougé. C'est elle qui prouve que `?fresh` vise.
    if (!apresFresh[0]?.plein || !apresFresh[0]?.etat.includes('seed 2026')) {
      console.error(`!! ?fresh A EMPORTÉ LA VALLÉE VOISINE : ${JSON.stringify(apresFresh[0])}`)
    }

    // ── 5. EFFACER — la confirmation prend la place de la ligne, en rouge, et NOMME ce qu'on
    //    perd. On efface la vallée 2 (celle qu'on vient de rouvrir), jamais la 1.
    await page.click('.mw-row:nth-child(2) .mw-x')
    await page.waitForTimeout(200)
    const arme = await page.evaluate(() => ({
      warn: document.querySelector('.mw-warn')?.textContent ?? '',
      bouton: document.querySelector('[data-effacer]')?.textContent ?? '',
      // La confirmation ne doit pas décaler la liste : on cliquerait la ligne du dessous.
      hauteurs: [...document.querySelectorAll('.mw-row')].map((r) => Math.round(r.getBoundingClientRect().height)),
    }))
    console.log(`confirmation d’effacement : ${JSON.stringify(arme)}`)
    await page.screenshot({ path: `${OUT}/accueil-effacer.png` })
    if (!arme.warn.includes('sans retour') || !arme.warn.includes('888')) {
      console.error(`!! LA CONFIRMATION NE NOMME PAS CE QU'ON PERD : ${JSON.stringify(arme)}`)
    }
    if (new Set(arme.hauteurs).size !== 1) console.error(`!! LA LISTE SE DÉCALE : ${arme.hauteurs}`)

    await page.click('[data-effacer]')
    await page.waitForTimeout(600)
    const apresEffacement = await cases()
    console.log(`après effacement : ${JSON.stringify(apresEffacement)}`)
    await page.screenshot({ path: `${OUT}/accueil-apres-effacement.png` })
    if (apresEffacement[1]?.plein) console.error(`!! LA VALLÉE EFFACÉE EST TOUJOURS LÀ`)
    if (!apresEffacement[0]?.plein) console.error(`!! EFFACER UNE VALLÉE A EMPORTÉ L'AUTRE`)

    // ── 6. LES OPTIONS — le son, et surtout LES TOUCHES. On rebinde pour de vrai et on vérifie
    //    que ça tient : c'est le seul système du client dont une erreur rend le jeu injouable
    //    sans rien afficher.
    await page.click('[data-go="accueil"]')
    await page.waitForTimeout(200)
    await page.click('.bm-entree[data-go="options"]')
    await page.waitForTimeout(300)
    const options = await page.evaluate(() => ({
      lignes: document.querySelectorAll('.op-ligne').length,
      volume: document.querySelector('.op-vol')?.value ?? '',
      // `avancer` est livré avec ses trois alias : ils DOIVENT survivre tant qu'on n'y touche pas.
      avancer: document.querySelector('[data-bind="moveUp"]')?.textContent?.trim() ?? '',
      // ÉCHAP ne se rebinde pas : sa case n'est pas un bouton.
      echapFige: Boolean(document.querySelector('.op-touche.op-fige')),
    }))
    console.log(`options : ${JSON.stringify(options)}`)
    await page.screenshot({ path: `${OUT}/accueil-options.png` })
    if (!options.lignes || !options.avancer.includes('·') || !options.echapFige) {
      console.error(`!! L'ÉCRAN DES OPTIONS NE VA PAS : ${JSON.stringify(options)}`)
    }

    // REBINDER : on clique la case, on presse K, et la ligne doit se ramener à cette seule touche.
    await page.click('[data-bind="moveUp"]')
    await page.waitForTimeout(150)
    const enAttente = await page.evaluate(() => document.querySelector('[data-bind="moveUp"]')?.textContent?.trim() ?? '')
    await page.screenshot({ path: `${OUT}/accueil-capture.png` })
    await page.keyboard.press('k')
    await page.waitForTimeout(250)
    const apresRebind = await page.evaluate(() => ({
      avancer: document.querySelector('[data-bind="moveUp"]')?.textContent?.trim() ?? '',
      // Le réglage est au disque : c'est lui que le jeu relira au prochain démarrage.
      disque: localStorage.getItem('braises.touches') ?? '',
    }))
    console.log(`en attente : « ${enAttente} » → après K : ${JSON.stringify(apresRebind)}`)
    if (!enAttente.includes('pressez') || apresRebind.avancer !== 'K' || !apresRebind.disque.includes('moveUp')) {
      console.error(`!! LE REBIND N'A PAS PRIS : ${JSON.stringify({ enAttente, apresRebind })}`)
    }

    // …et RÉINITIALISER rend les alias d'origine : un réglage qu'on ne sait pas défaire est un piège.
    await page.click('[data-rebind-reset="moveUp"]')
    await page.waitForTimeout(200)
    const apresReset = await page.evaluate(() => document.querySelector('[data-bind="moveUp"]')?.textContent?.trim() ?? '')
    console.log(`après réinitialisation : « ${apresReset} »`)
    if (apresReset !== options.avancer) {
      console.error(`!! RÉINITIALISER NE REND PAS LES ALIAS : « ${apresReset} » ≠ « ${options.avancer} »`)
    }
    await page.screenshot({ path: `${OUT}/accueil-options-fin.png` })

    return { apresSortie, semee, apresFondation, rouverte, apresFresh, apresEffacement, options, apresRebind }
  },

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
   * LES GELS DU MONDE — combien de temps la Veillée s'arrête-t-elle, et pourquoi ?
   *
   * Le projet sait ce que coûte un tick sur Node, sous `tsx` (qui ment de ~25 %). Il n'a
   * JAMAIS mesuré le moteur qui joue réellement le solo : le Web Worker du navigateur.
   * C'est pourtant le seul dont le coût se ressente manette en main, et le seul sur lequel
   * on ait le droit d'écrire « MESURÉ » à propos d'un gel.
   *
   * On ne fabrique rien : le Worker relève lui-même (sonde `PerfMessage`, dev seulement) et
   * WorldScene empile les échantillons ; ici on LIT. Deux chiffres comptent, et ils ne
   * disent pas la même chose : le coût d'un TICK (ce que la sim et l'hôte paient dans la
   * boucle) et l'ÉCART entre deux départs de tick (ce qui a occupé le Worker, d'où que ça
   * vienne — l'autosave, appelée par son propre minuteur, ne tombe dans aucun tick).
   *
   * Le scénario dure ~80 s de mur pour croiser au moins deux autosaves (AUTOSAVE_MS = 30 s).
   * Exige `--dev` : la sonde est armée sur `import.meta.env.DEV`.
   */
  async gels(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    // On laisse le monde se poser : les premières secondes paient encore le montage du client.
    await page.waitForTimeout(4000)
    await page.evaluate(() => {
      window.__BRAISES__.scene.perfSamples.length = 0 // on repart d'une fenêtre propre
    })

    const DUREE_MS = 80000
    const debut = Date.now()
    let dernierDit = 0
    while (Date.now() - debut < DUREE_MS) {
      await page.waitForTimeout(2000)
      const n = await page.evaluate(() => window.__BRAISES__.scene.perfSamples.length)
      const ecoule = Math.round((Date.now() - debut) / 1000)
      if (ecoule - dernierDit >= 20) {
        dernierDit = ecoule
        console.log(`  … ${ecoule} s — ${n} échantillons`)
      }
    }

    const r = await page.evaluate(() => {
      const s = window.__BRAISES__.scene.perfSamples
      if (s.length === 0) return { echantillons: 0 }
      const tri = (xs) => [...xs].sort((a, b) => a - b)
      const med = (xs) => (xs.length ? tri(xs)[Math.floor(xs.length / 2)] : -1)
      const r2 = (v) => Math.round(v * 100) / 100
      const moyennes = s.map((x) => x.moyenneMs)
      const ecarts = s.map((x) => x.picEcartMs)
      // LES GELS : tout écart qui dépasse le double du budget (50 ms à 20 Hz) est un moment
      // où le monde s'est arrêté pour de bon. On les NOMME au lieu de les moyenner.
      const gels = s
        .map((x, i) => ({ i, ecartMs: r2(x.picEcartMs), picMs: r2(x.picMs), picStepMs: r2(x.picStepMs), picTick: x.picTick }))
        .filter((g) => g.ecartMs > 100)
        .sort((a, b) => b.ecartMs - a.ecartMs)
      // L'autosave : sa durée ne change QUE quand elle vient de tourner — on repère l'instant
      // où le chiffre bouge, et on regarde l'écart relevé au même moment.
      const saves = []
      let vu = -1
      s.forEach((x, i) => {
        if (x.serialisationMs >= 0 && x.serialisationMs !== vu) {
          vu = x.serialisationMs
          saves.push({ i, serialisationMs: r2(x.serialisationMs), octets: x.sauvegardeOctets, ecartAuMemeMoment: r2(x.picEcartMs) })
        }
      })
      return {
        echantillons: s.length,
        tickMedianMs: r2(med(moyennes)),
        tickPireMs: r2(Math.max(...s.map((x) => x.picMs))),
        ecartMedianMs: r2(med(ecarts)),
        ecartPireMs: r2(Math.max(...ecarts)),
        gels: gels.slice(0, 6),
        nbGels: gels.length,
        autosaves: saves,
      }
    })

    console.log(`gels : ${JSON.stringify(r, null, 2)}`)
    if (!r.echantillons) {
      console.error('!! sonde perf débranchée — aucun échantillon (as-tu bien lancé avec --dev ?)')
    }
    // LA CARTE EST-ELLE REVENUE DANS L'AUTOSAVE ? `carte-immuable.test.ts` garde
    // `serializePartie` ; il ne garde pas que `persist()` l'APPELLE. Repasser à
    // `serializeSim` dans l'hôte laisserait la suite verte et rendrait le gel de 2,5 s —
    // seul le poids réellement écrit par le vrai Worker le dit. (Mesuré : 9,2 Mo.)
    const dernier = r.autosaves?.[r.autosaves.length - 1]
    if (dernier && dernier.octets > 20e6) {
      console.error(`!! LA CARTE EST REVENUE DANS L'AUTOSAVE : ${(dernier.octets / 1e6).toFixed(1)} Mo écrits, ${dernier.serialisationMs} ms de monde arrêté (attendu ~9 Mo)`)
    }
    return r
  },

  /**
   * LE DERNIER ÉCRAN DU JEU EST-IL ATTEIGNABLE ? — la question que GATE 1 pose en dernier.
   *
   * Le scénario `saison` montre la stèle de fin, mais il l'OBTIENT EN LA FABRIQUANT : il écrit
   * `seasonVerdicts` dans le registre à la main. Il prouve donc que l'écran se dessine bien —
   * pas que le jeu y mène. Or l'en-tête de ce fichier pose la règle : « le smoke test LIT
   * l'état, il ne le fabrique pas ».
   *
   * Personne n'a jamais vu la fin de saison sortir de la simulation. C'est pourtant le dernier
   * écran que GATE 1 montrera — et une saison solo vaut ~4 h 48 de jeu (6 cycles), donc
   * personne ne l'atteindra par accident non plus.
   *
   * Ici, on ne touche PAS à l'écran. On fonde un vrai Feu, on pousse le CALENDRIER au jour 61
   * (`debug_set_season_day`, qui se pose un tick avant la bascule pour que la sim la franchisse
   * elle-même), et on regarde ce que le jeu fait de lui-même : `/sim` émet `season_ended` avec
   * ses verdicts, le pont les publie, la stèle se lève. Tout ce qu'on lit ensuite vient de la
   * simulation. Exige `--dev`.
   */
  async finale(page) {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(500)

    const doAction = async (action, wait = 150) => {
      await page.evaluate((a) => window.__BRAISES__.scene.sendAction(a), action)
      await page.waitForTimeout(wait)
    }

    // ── UN VRAI FEU, parce que la stèle COURONNE le village du joueur : sans village, on ne
    // vérifierait que la moitié de l'écran (les voisins) et pas le verdict qui le regarde, lui.
    const spawn = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    let feu = null
    for (const [ox, oy] of [[0, 0], [-24, 0], [24, 0], [0, -24], [0, 24], [-48, 0], [48, 0]]) {
      const bx = Math.round(spawn.x) + ox, by = Math.round(spawn.y) + oy
      await doAction({ type: 'debug_teleport', x: bx + 0.5, y: by + 0.5 }, 200)
      await doAction({ type: 'debug_grant', item: 'campfire' })
      const cslot = await page.evaluate(() => (window.__BRAISES__.scene.registry.get('inv') ?? []).findIndex((s) => s?.item === 'campfire'))
      if (cslot < 0 || cslot >= 6) continue
      await doAction({ type: 'set_active_slot', slot: cslot }, 120)
      await doAction({ type: 'place_campfire', tx: bx + 1, ty: by }, 300)
      const fireId = await page.evaluate(({ x, y }) => {
        const f = window.__BRAISES__.scene.view.structures.find((s) => s.type === 'fire' && s.villageId === 0 && s.tx === x && s.ty === y)
        return f ? f.id : null
      }, { x: bx + 1, y: by })
      if (fireId === null) continue
      await doAction({ type: 'found_village', structureId: fireId }, 400)
      if (await page.evaluate(() => (window.__BRAISES__.scene.registry.get('village') ?? 0) > 0)) { feu = { bx, by, fireId }; break }
    }
    // L'ID DU VILLAGE FONDÉ, lu sur le Feu qu'on vient de poser. C'est lui qui rend
    // l'assertion finale non tautologique : sans ça, on ne saurait pas distinguer « la stèle
    // couronne MON village » de « la stèle couronne un village PNJ » — les deux affichent un nom.
    const monVillageId = feu
      ? await page.evaluate((id) => window.__BRAISES__.scene.view.structures.find((s) => s.id === id)?.villageId ?? null, feu.fireId)
      : null
    console.log(`fondation : ${feu ? `Feu en (${feu.bx + 1}, ${feu.by}) → village ${monVillageId}` : 'ABSENTE — la stèle ne couronnera personne'}`)

    // ── ON POUSSE LE CALENDRIER, PAS L'ÉCRAN. `SEASON_DAYS` vaut 60 ; la fin tombe à `day > 60`.
    const avant = await page.evaluate(() => window.__BRAISES__.scene.registry.get('seasonVerdicts') ?? null)
    if (avant !== null) console.error('!! la saison était DÉJÀ finie avant le saut — le scénario ne prouverait rien')
    await doAction({ type: 'debug_set_season_day', day: 61 }, 300)

    // La stèle se lève sur le SNAPSHOT qui porte l'événement : on l'attend, on ne la pose pas.
    let levee = false
    try {
      await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.registry.get('seasonVerdicts')), null, { timeout: 20000 })
      levee = true
    } catch { /* on rapporte l'absence plus bas — elle EST le résultat */ }
    await page.waitForTimeout(600)

    const r = await page.evaluate(() => {
      const reg = window.__BRAISES__.scene.registry
      const sv = document.querySelector('.season-veil')
      const verdicts = reg.get('seasonVerdicts')
      return {
        // ── ce que la SIMULATION a produit
        verdictsDuSim: verdicts
          ? { monVillage: verdicts.myVillageId, n: verdicts.verdicts.length, qui: verdicts.verdicts.map((v) => `${v.name}/${v.archetype}: ${v.outcome}`) }
          : null,
        chronique: (reg.get('chronicle') ?? []).length,
        // ── ce que l'ÉCRAN en fait
        steleLevee: sv ? getComputedStyle(sv).display : null,
        titre: document.querySelector('.sv-title')?.textContent ?? '',
        monNom: document.querySelector('.sv-you-name')?.textContent ?? '',
        monVerdict: document.querySelector('.sv-you-outcome')?.textContent ?? '',
        voisins: document.querySelectorAll('.sv-nb').length,
        rouvrir: Boolean(document.querySelector('.sv-reopen')),
      }
    })

    console.log(`finale : ${JSON.stringify(r, null, 2)}`)
    await page.screenshot({ path: `${OUT}/finale.png`, fullPage: false })

    if (!levee || !r.verdictsDuSim) {
      console.error("!! LE FINALE N'EST PAS ATTEIGNABLE : le calendrier est au bout et `/sim` n'a pas rendu ses verdicts")
    } else if (r.steleLevee !== 'flex') {
      console.error(`!! /sim a fini la saison mais la stèle ne se lève pas (display=${r.steleLevee})`)
    } else if (feu && !r.monNom) {
      console.error('!! la stèle se lève mais ne couronne aucun village, alors que le joueur en a fondé un')
    } else if (feu && monVillageId !== null && r.verdictsDuSim.monVillage !== monVillageId) {
      // Le cas qui passerait pour une réussite : un nom s'affiche, mais c'est celui d'un
      // voisin PNJ. La stèle est censée couronner le village DU JOUEUR — on le vérifie par
      // l'identifiant, pas par la présence d'un texte.
      console.error(`!! LA STÈLE COURONNE LE MAUVAIS VILLAGE : ${r.verdictsDuSim.monVillage} au lieu du tien (${monVillageId})`)
    }
    return { ...r, fondation: Boolean(feu), monVillageId }
  },

  /**
   * LA NUIT DE HORDE COÛTE-T-ELLE VRAIMENT UNE SECONDE ? — la mesure qui manquait.
   *
   * Le second gel suspecté de la Veillée. On sait, sur Node, que le premier tick d'une horde
   * paie un champ de flux plein-carte (~1 s pour 50 ms de budget) ; on ne l'a JAMAIS vu dans
   * le Worker du navigateur, et le scénario `gels` a montré que Node sous-estime ce moteur
   * d'un facteur 2,3. Tant que ce chiffre-là n'existe pas, toucher au pathfinding serait
   * optimiser contre une baseline fausse.
   *
   * On ne fabrique pas la horde : on met le monde dans les conditions où elle NAÎT (acte III,
   * `HORDE_CHANCE_PER_NIGHT` = 0,9) et on laisse le tirage faire. God mode, sinon le joueur
   * meurt avant d'avoir mesuré quoi que ce soit ; cadence ×16, sinon une nuit dure 18 minutes.
   *
   * LA SONDE SÉPARE DÉJÀ LES DEUX GELS, et c'est tout son intérêt : l'autosave donne un grand
   * `picEcartMs` avec un `picMs` minuscule (elle tombe HORS du tick), la horde donne un grand
   * `picMs` AVEC un grand `picStepMs` (elle est DANS `step`, donc dans /sim). Exige `--dev`.
   */
  async horde(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(4000)

    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.sendAction({ type: 'debug_god', on: true }) // sinon on meurt avant de mesurer
      s.sendAction({ type: 'debug_set_season_day', day: 45 }) // acte III : 0,9 horde par nuit
      s.perfSamples.length = 0
    })
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.__BRAISES__.scene.send({ type: 'debug_speed', factor: 16 }))

    // On attend qu'une horde NAISSE : le compte de monstres saute d'un coup (une horde d'acte
    // III en pose douze). On plafonne l'attente — un tirage peut rater plusieurs nuits.
    const DUREE_MS = 300000
    const debut = Date.now()
    let base = await page.evaluate(() => window.__BRAISES__.scene.view.monsters.length)
    let pic = base
    let vue = false
    console.log(`  monstres au départ : ${base}`)
    while (Date.now() - debut < DUREE_MS && !vue) {
      await page.waitForTimeout(2000)
      const n = await page.evaluate(() => window.__BRAISES__.scene.view.monsters.length)
      if (n > pic) pic = n
      if (n >= base + 6) {
        vue = true
        console.log(`  ⚑ horde à ${Math.round((Date.now() - debut) / 1000)} s — ${base} → ${n} monstres`)
      }
      const t = Math.round((Date.now() - debut) / 1000)
      if (t % 30 < 2) console.log(`  … ${t} s — ${n} monstres (pic ${pic})`)
    }
    // On laisse la horde marcher un peu : le premier tick paie le champ, les suivants disent
    // si le régime RESTE cher (c'est lui qui dure les dix-huit minutes d'une nuit).
    if (vue) await page.waitForTimeout(20000)

    const r = await page.evaluate(() => {
      const s = window.__BRAISES__.scene.perfSamples
      const r2 = (v) => Math.round(v * 100) / 100
      const tri = (xs) => [...xs].sort((a, b) => a - b)
      const med = (xs) => (xs.length ? tri(xs)[Math.floor(xs.length / 2)] : -1)
      // DANS le tick (donc /sim) : c'est la signature de la horde, pas celle de l'autosave.
      const dansLeTick = s
        .map((x, i) => ({ i, picMs: r2(x.picMs), picStepMs: r2(x.picStepMs), picTick: x.picTick, ecartMs: r2(x.picEcartMs) }))
        .filter((g) => g.picStepMs > 100)
        .sort((a, b) => b.picStepMs - a.picStepMs)
      return {
        echantillons: s.length,
        tickMedianMs: r2(med(s.map((x) => x.moyenneMs))),
        tickPireMs: r2(Math.max(...s.map((x) => x.picMs), 0)),
        picStepPireMs: r2(Math.max(...s.map((x) => x.picStepMs), 0)),
        nbTicksChers: dansLeTick.length,
        ticksChers: dansLeTick.slice(0, 8),
        monstres: window.__BRAISES__.scene.view.monsters.length,
      }
    })

    console.log(`horde : ${JSON.stringify({ ...r, hordeVue: vue, picMonstres: pic }, null, 2)}`)
    if (!vue) console.error(`!! aucune horde en ${DUREE_MS / 1000} s — le tirage n'est pas tombé, la mesure du champ de flux reste À FAIRE`)
    return { ...r, hordeVue: vue, picMonstres: pic }
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
  /**
   * LE COMPARATIF DES LIEUX BÂTIS — « pourquoi ne pas construire une ferme, tout simplement ? »
   *
   * Un scénario de REGARD, pas de garde : il ne juge rien, il pose l'appareil au même endroit,
   * au même zoom, à la même heure, avant et après. C'est la seule façon honnête de trancher
   * entre le sprite peint à la main et un bâti fait des pièces du jeu — l'aperçu offline
   * sous-estime le pipeline (mémoire `da-cubique-a-l-echelle-poi`).
   *
   * Trois cadrages par lieu : le plan large (est-ce qu'on le voit venir ?), le plan moyen
   * (qu'est-ce qu'on lit ?), le plan serré (qu'est-ce que ça vaut de près ?). Exige `--dev`.
   */
  /**
   * LA FERME, TELLE QUE LE MOTEUR LA REND — pour la confronter à la §1bis de l'artefact.
   *
   * On n'interroge PAS `/sim` ni une redérivation : on lit les GameObjects que Phaser a sur
   * l'écran. Clé d'atlas réellement posée, taille d'affichage réelle, alpha, teinte. C'est la
   * seule mesure qui puisse contredire la maquette — tout le reste compare une copie à sa copie.
   */
  async 'ferme-sprites'(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const zone = await page.evaluate(() => {
      const z = (window.__BRAISES__.scene.map.zones ?? []).find((q) => q.kind === 'ferme_ruinee')
      return z ? { x: z.x, y: z.y, w: z.w, h: z.h } : null
    })
    if (!zone) { console.error('!! pas de ferme sur cette carte'); return }
    await page.evaluate((z) => window.__BRAISES__.scene.sendAction({
      type: 'debug_teleport', x: z.x + z.w / 2, y: z.y + z.h / 2,
    }), zone)
    await page.waitForTimeout(1600)

    const vu = await page.evaluate((z) => {
      const sc = window.__BRAISES__.scene
      const T = 16
      const out = []
      for (const o of sc.children.list) {
        const k = o.texture?.key
        if (!k || (!k.startsWith('st-') && !k.startsWith('nd-'))) continue
        // L'ancre du moteur est le PIED de la tuile : x = (tx+.5)·T, y = (ty+1)·T.
        const tx = Math.round(o.x / T - 0.5)
        const ty = Math.round(o.y / T - 1)
        if (tx < z.x - 1 || tx > z.x + z.w || ty < z.y - 1 || ty > z.y + z.h) continue
        out.push({
          x: tx - z.x, y: ty - z.y, cle: k,
          w: +o.displayWidth.toFixed(2), h: +o.displayHeight.toFixed(2),
          alpha: +o.alpha.toFixed(3), tint: o.tintTopLeft ?? null,
          origine: [o.originX, o.originY], profondeur: o.depth,
        })
      }
      out.sort((a, b) => a.y - b.y || a.x - b.x || (a.cle < b.cle ? -1 : 1))
      return out
    }, zone)

    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${OUT}/ferme-sprites.json`, JSON.stringify({ zone, sprites: vu }))
    console.log(`FERME_SPRITES ${vu.length} sprites lus dans le moteur → ${OUT}/ferme-sprites.json`)
    await page.screenshot({ path: `${OUT}/ferme-moteur.png` })
  },

  /**
   * DEDANS — LA DÉCOUPE DE FAÇADE (décision d'Alexis, 2026-07-27, à la Project Zomboid).
   *
   * `lieux-batis` cadre le CENTRE de la zone, qui tombe dans la cour : la découpe ne s'y arme
   * jamais, puisqu'elle ne s'arme que sous la nappe de la SALLE. On entre donc pour de vrai —
   * et on lit la clé de texture réellement posée sur le mur du bas, parce qu'une capture ne
   * prouve pas le câblage : un mur coupé et un mur caché par un autre se ressemblent.
   * Exige `--dev` (TP).
   */
  async 'ferme-dedans'(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const z = await page.evaluate(() => {
      const q = (window.__BRAISES__.scene.map.zones ?? []).find((w) => w.kind === 'ferme_ruinee')
      return q ? { x: q.x, y: q.y } : null
    })
    if (!z) { console.error('!! aucune Ferme sur la carte'); return }

    // LE MILIEU DE LA SALLE — le plan la pose en (1..9, 2..7) dans l'emprise.
    // `seuil` : depuis la cour, à une tuile sous la porte — c'est le seul cadrage où l'on juge
    // si l'encadrement est DANS le mur (même crête, même épaisseur) et s'il est PERCÉ.
    for (const [nom, dx, dy, zoom] of [['salle', 5, 5, 3.4], ['salle-serre', 5, 5, 5.5], ['cour', 5, 10, 3.4], ['seuil', 4, 9, 7]]) {
      await page.evaluate(({ x, y, zz }) => {
        window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
        window.__BRAISES__.scene.cameras.main.setZoom(zz)
      }, { x: z.x + dx + 0.5, y: z.y + dy + 0.5, zz: zoom })
      await page.waitForTimeout(1400)
      await page.screenshot({ path: `${OUT}/dedans-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png` })
    }

    // ═══ LE TRI Y, SUR LES QUATRE CÔTÉS (décision d'Alexis : « on ne doit jamais perdre le
    // joueur derrière une barrière ») ═══
    //
    // On mesure la SEULE chose qui compte : existe-t-il une barrière qui recouvre le sprite du
    // joueur À L'ÉCRAN, qui se dessine APRÈS lui (depth supérieure), et qui n'est PAS tranchée ?
    // On le demande depuis les quatre côtés d'un mur, plus les quatre diagonales — c'est la
    // géométrie du sprite qui répond, pas mon œil.
    const AUTOUR = [
      ['nord', 0, -1.2], ['sud', 0, 1.2], ['est', 1.2, 0], ['ouest', -1.2, 0],
      ['nord-est', 1, -1], ['nord-ouest', -1, -1], ['sud-est', 1, 1], ['sud-ouest', -1, 1],
    ]
    const avales = []
    for (const [nom, ddx, ddy] of AUTOUR) {
      // Le mur du bas de la salle : le plan la ferme en (z.y + 13), la porte est en x+10/+11.
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
        window.__BRAISES__.scene.cameras.main.setZoom(4)
      }, { x: z.x + 3.5 + ddx, y: z.y + 13.5 + ddy })
      await page.waitForTimeout(900)
      const verdict = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const p = sc.registry.get('playerPos')
        const T = 16
        const ax = p.x * T, aBas = p.y * T, aHaut = aBas - 12
        const fautes = []
        for (const [, sp] of sc.view.structureSprites ?? []) {
          const k = sp.texture?.key ?? ''
          if (!k.startsWith('st-wall-e') && !k.startsWith('st-wall-ruine-e') && !k.startsWith('st-cloture-e') && !k.startsWith('st-encadrement-')) continue
          if (k.includes('coupe')) continue
          const bBas = sp.y, bHaut = sp.y - sp.height * sp.originY
          const dx = Math.abs(sp.x - ax)
          const rx = (12 + sp.width) / 2 - dx
          const ry = Math.min(aBas, bBas) - Math.max(aHaut, bHaut)
          // La profondeur du joueur : la formule de `framing.ts` (Y_SORT_BASE + pieds×tuile +
          // TIE_ACTOR). On la recalcule ici plutôt que de lire un sprite privé — si elle change,
          // la sonde ment, et c'est pour ça qu'elle est écrite en toutes lettres.
          const dJoueur = 1000 + p.y * T + 0.8
          if (rx > 2 && ry > 2 && sp.depth > dJoueur) fautes.push(`${k} @${sp.x},${sp.y}`)
        }
        return { pos: p, fautes }
      })
      if (verdict.fautes.length) avales.push(`${nom} : ${verdict.fautes.join(', ')}`)
      await page.screenshot({ path: `${OUT}/ysort-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png` })
    }
    console.log(`tri Y : ${avales.length === 0 ? 'aucune barrière n’avale le joueur' : JSON.stringify(avales)}`)
    if (avales.length) console.error(`!! LE JOUEUR DISPARAÎT DERRIÈRE : ${JSON.stringify(avales)}`)

    // ═══ « JE TRAVERSE LÉGÈREMENT LES MURS LATÉRAUX » — hitbox ou sprite ? ═══
    //
    // La question ne se tranche qu'avec un nombre. On POUSSE vraiment (au clavier, comme un
    // joueur), on lit la position prédite par le client — celle qu'Alexis voit — et on la
    // compare à la bande que le moteur bloque. Deux verdicts possibles, et ils n'ont pas le
    // même remède : la HITBOX pénètre (bug de collision), ou seul le SPRITE déborde (12 px de
    // sprite pour 9,6 px de hitbox : le dessin est 25 % plus large que le corps).
    const DEMI = 0.125 //  demi-bande, en tuiles (WALL_EDGE_SUB/2 ÷ SUBTILES_PER_TILE)
    const HITBOX = 0.3 //  demi-hitbox de l'avatar
    // Le demi-DESSIN, en tuiles : la largeur d'emprise de l'humanoïde (`ACTOR_FOOTPRINTS`), pas
    // la résolution de sa texture — c'est l'emprise qui est étirée à l'écran, et c'est elle
    // qui entre dans la pierre.
    const SPRITE = 0.75 / 2 //  demi-LARGEUR du dessin (12 px) — désormais celle du corps
    for (const [nom, dx, dy, touche, bordX] of [
      ['ouest', 3, 5.5, 'KeyQ', 1], //  le pan ouest de la salle : sa ligne est en x0 + 1
      ['est', 9, 5.5, 'KeyD', 12], //   le pan est : sa ligne est en x0 + 12
    ]) {
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
        window.__BRAISES__.scene.cameras.main.setZoom(4)
      }, { x: z.x + dx, y: z.y + dy })
      await page.waitForTimeout(700)
      // ON POUSSE JUSQU'À L'ARRÊT, ON NE COMPTE PAS LE TEMPS. Sous swiftshader le rendu est
      // famélique et `playerPos` ne s'écrit que dans `update()` : une fenêtre fixe mesure un
      // joueur qui n'a pas encore bougé (mesuré : 0,2 tuile en 2,5 s). On attend donc que la
      // position se STABILISE — c'est le seul signal qui dise « il est contre le mur ».
      await page.keyboard.down(touche)
      let p = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      let stable = 0
      for (let i = 0; i < 60 && stable < 4; i++) {
        await page.waitForTimeout(250)
        const q = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        stable = Math.abs(q.x - p.x) < 0.002 ? stable + 1 : 0
        p = q
      }
      await page.keyboard.up(touche)
      await page.waitForTimeout(300)
      p = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      const ligne = z.x + bordX
      // De combien le corps, puis le dessin, mordent-ils au-delà du bord de la bande ?
      const bordBande = nom === 'ouest' ? ligne + DEMI : ligne - DEMI
      const penetreCorps = nom === 'ouest' ? bordBande - (p.x - HITBOX) : (p.x + HITBOX) - bordBande
      const penetreDessin = nom === 'ouest' ? bordBande - (p.x - SPRITE) : (p.x + SPRITE) - bordBande
      console.log(`   mur ${nom} : x=${p.x.toFixed(3)} · corps ${penetreCorps > 0.001 ? `PÉNÈTRE de ${penetreCorps.toFixed(3)} tuile` : 'à fleur (0)'} · dessin déborde de ${Math.max(0, penetreDessin).toFixed(3)} tuile`)
      if (penetreCorps > 0.001) console.error(`!! LA HITBOX TRAVERSE LE MUR ${nom.toUpperCase()} de ${penetreCorps.toFixed(3)} tuile`)
      await page.screenshot({ path: `${OUT}/colle-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png` })
    }

    // ═══ LA RÈGLE DES PANS (décisions d'Alexis, 2026-07-27) ═══
    //
    // Un pan = un côté de bâtiment, et il tombe D'UN BLOC à deux tuiles. On le vérifie en
    // COMPTANT : au centre de la salle, seul le pan du sud est tranché ; collé au nord, le pan
    // du nord tombe EN PLUS, entier. Un compte qui grimpe de deux ou trois dirait « on tranche
    // à la tuile », et c'est exactement ce qu'on a quitté.
    //
    // (Le SEUIL ne compte plus parmi les tranchés depuis le 2026-07-30 : il reste debout avec la
    // porte du joueur — le compte du pan sud a donc baissé du nombre de tuiles de son ouverture.)
    for (const [nom, dx, dy] of [['centre', 5.5, 5.5], ['contre-nord', 5.5, 2.6], ['contre-ouest', 1.6, 5.5]]) {
      // UN TÉLÉPORT PEUT ÊTRE AVALÉ (une action par tick — s'il tombe pendant qu'une autre
      // passe, il est perdu, et la sonde mesure alors la position PRÉCÉDENTE en croyant
      // mesurer la nouvelle). On redemande jusqu'à ce que la position soit celle voulue.
      for (let essai = 0; essai < 8; essai++) {
        await page.evaluate(({ x, y }) => {
          window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
          window.__BRAISES__.scene.cameras.main.setZoom(2.6)
        }, { x: z.x + dx, y: z.y + dy })
        await page.waitForTimeout(400)
        const p = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        if (Math.abs(p.x - (z.x + dx)) < 0.6 && Math.abs(p.y - (z.y + dy)) < 0.6) break
      }
      await page.waitForTimeout(600)
      const n = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        let coupes = 0
        for (const [, sp] of sc.view.structureSprites ?? []) if ((sp.texture?.key ?? '').includes('coupe')) coupes++
        return { coupes, pos: sc.registry.get('playerPos') }
      })
      console.log(`   pan ${nom} : ${n.coupes} tuiles tranchées (joueur en ${n.pos.x.toFixed(2)}, ${n.pos.y.toFixed(2)} ; zone en ${z.x}, ${z.y})`)
      await page.screenshot({ path: `${OUT}/pans-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png` })
    }

    // LE CÂBLAGE : depuis la salle, les murs qui la BORDENT AU SUD portent-ils la texture coupée ?
    await page.evaluate(({ x, y }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y }),
      { x: z.x + 5.5, y: z.y + 5.5 })
    await page.waitForTimeout(900)
    const cles = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const out = { coupes: 0, pleins: 0, seuilCoupe: 0, seuilDebout: 0, exemples: [], seuils: [] }
      for (const [id, sp] of sc.view.structureSprites ?? []) {
        const k = sp.texture?.key ?? ''
        if (k.startsWith('st-wall-coupe')) { out.coupes++; if (out.exemples.length < 3) out.exemples.push(k) }
        else if (k.startsWith('st-wall-')) out.pleins++
        else if (k.startsWith('st-encadrement-coupe')) out.seuilCoupe++
        if (k.startsWith('st-encadrement')) {
          if (!k.startsWith('st-encadrement-coupe')) out.seuilDebout++
          out.seuils.push(`${k} x=${Math.round(sp.x)} w=${sp.width}`)
        }
        void id
      }
      return out
    })
    console.log(`découpe : ${JSON.stringify(cles)}`)
    if (cles.coupes === 0) console.error('!! AUCUN mur coupé alors qu’on est dans la salle')
    // ═══ LE SEUIL RESTE DEBOUT PENDANT QUE SON MUR TOMBE (décision d'Alexis, 2026-07-30) ═══
    //
    // La paire est ce qui prouve quelque chose : un seuil debout ne veut rien dire si aucun mur
    // n'est tranché (il serait debout de toute façon). On exige donc les deux DANS LA MÊME
    // LECTURE — des murs coupés (ci-dessus), et pas un seul seuil coupé.
    if (cles.seuilCoupe > 0) console.error(`!! ${cles.seuilCoupe} seuil(s) TRANCHÉ(S) : l’entrée disparaît avec le mur`)
    if (cles.seuilDebout === 0) console.error('!! aucun seuil DEBOUT dans la salle — la garde ne mesure rien')
    return cles
  },

  /**
   * ARÊTE (2026-07-30) — LE JOUEUR BÂTIT SUR LE TRAIT (spec construction R23).
   *
   * Ce que `pnpm test` ne peut PAS voir, et qui est pourtant tout l'enjeu d'un mode de pose :
   *   ① le FANTÔME tourne quand on presse `A`/`E`, et il tourne dans le BON SENS ;
   *   ② il tombe aux MÊMES PIXELS que le mur qu'il annonce (même texture, même ancrage) ;
   *   ③ le COIN se ferme — deux murs sur une tuile, ce que « tuile occupée » interdisait ;
   *   ④ la PORTE a une silhouette sur les quatre arêtes (son art n'existait pas avant ce jour).
   *
   * Exige `--dev` : on se dote au `debug_grant` et on se téléporte.
   */
  /**
   * PORTE (2026-07-30) — ON L'OUVRE ET ON LA FERME À LA TOUCHE (spec construction R26).
   *
   * Ce que `pnpm test` ne peut pas voir : que la touche est CÂBLÉE, que le sprite CHANGE, et que
   * la collision suit dans les deux sens. La mesure est une PAIRE DE PAIRES, parce qu'aucun cas
   * seul ne prouve rien — un joueur qui ne bouge pas et un joueur qui traverse tout donnent le
   * même « ça ne marche pas » :
   *   ① close, elle arrête son PROPRIÉTAIRE (c'est ce qui donne un sens à l'ouvrir) ;
   *   ② la touche l'ouvre, et on sort ;
   *   ③ la même touche la referme, et on est de nouveau retenu ;
   *   ④ le SPRITE suit l'état — sans quoi presser la touche ne se verrait pas.
   *
   * Bâti minimal (un mur, une porte) : le scénario `arete` couvre déjà la pose. Exige `--dev`.
   */
  async 'porte'(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    const agir = async (action, ms = 320) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const slotDe = (item) => page.evaluate((it) => (window.__BRAISES__.scene.registry.get('inv') ?? [])
      .findIndex((s) => s?.item === it), item)
    const pos = () => page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))

    // ── FONDER, loin des landmarks (recette éprouvée de `finale`).
    const p0 = await pos()
    let feu = null
    let bx = 0
    let by = 0
    for (const [ox, oy] of [[0, 0], [-24, 0], [24, 0], [0, -24], [0, 24], [-48, 0], [48, 0]]) {
      const tx = Math.round(p0.x) + ox
      const ty = Math.round(p0.y) + oy
      await agir({ type: 'debug_teleport', x: tx + 0.5, y: ty + 0.5 }, 220)
      await agir({ type: 'debug_grant', item: 'campfire' }, 160)
      const cslot = await slotDe('campfire')
      if (cslot < 0 || cslot >= 6) continue
      await agir({ type: 'set_active_slot', slot: cslot }, 140)
      await agir({ type: 'place_campfire', tx: tx + 1, ty }, 320)
      const id = await page.evaluate(({ x, y }) => {
        const f = window.__BRAISES__.scene.view.structures.find((q) => q.type === 'fire' && q.villageId === 0 && q.tx === x && q.ty === y)
        return f ? f.id : null
      }, { x: tx + 1, y: ty })
      if (id === null) continue
      await agir({ type: 'found_village', structureId: id }, 420)
      if (await page.evaluate(() => (window.__BRAISES__.scene.registry.get('village') ?? 0) > 0)) {
        feu = id
        bx = tx
        by = ty
        break
      }
    }
    if (feu === null) { console.error('!! aucun village fondé — la porte n’est pas bâtissable'); return }

    for (let i = 0; i < 10; i++) await agir({ type: 'debug_grant', item: 'wood' }, 90)
    await agir({ type: 'debug_grant', item: 'hammer' }, 180)
    const hslot = await slotDe('hammer')
    if (hslot < 0 || hslot >= 6) { console.error(`!! marteau hors ceinture (case ${hslot})`); return }
    await agir({ type: 'set_active_slot', slot: hslot }, 300)

    // ── UNE PORTE ET UN MUR VOISIN, sur la même ligne d'arêtes (bit SUD de leur tuile).
    // Le mur est le TÉMOIN : sans lui, « je ne passe pas » ne distinguerait pas une porte close
    // d'un bug de collision. Une tuile SANS NŒUD de chaque côté, sinon un arbre fait la mesure.
    const S = 4
    let porteTx = null
    const ligne = by + 3 //  l'arête visée : le sud de la rangée (by+2)
    for (const dx of [0, 1, -1, 2, -2, 3]) {
      const tx = bx + dx
      const propre = await page.evaluate(({ x, y }) => (window.__BRAISES__.scene.view.nodes ?? [])
        .every((n) => !((n.tx === x || n.tx === x + 1) && (n.ty === y || n.ty === y + 1))), { x: tx, y: ligne - 1 })
      if (!propre) continue
      await agir({ type: 'debug_teleport', x: tx + 0.5, y: ligne - 0.5 }, 300)
      await agir({ type: 'build', structure: 'door', tx, ty: ligne - 1, material: 'wood', edges: S }, 320)
      await agir({ type: 'build', structure: 'wall', tx: tx + 1, ty: ligne - 1, material: 'wood', edges: S }, 320)
      const ok = await page.evaluate(({ x, y }) => {
        const st = window.__BRAISES__.scene.view.structures
        return st.some((q) => q.type === 'door' && q.tx === x && q.ty === y)
          && st.some((q) => q.type === 'wall' && q.tx === x + 1 && q.ty === y)
      }, { x: tx, y: ligne - 1 })
      if (ok) { porteTx = tx; break }
    }
    if (porteTx === null) { console.error('!! ni porte ni mur posés — rien à mesurer'); return }
    const porteId = await page.evaluate(({ x, y }) => window.__BRAISES__.scene.view.structures
      .find((q) => q.type === 'door' && q.tx === x && q.ty === y).id, { x: porteTx, y: ligne - 1 })

    /**
     * L'INDICE DE FRAME LU DANS UNE CLÉ DE TEXTURE — et il ne finit pas toujours la clé.
     *
     * Une porte éclairée rend `st-door-e4-f0_lit`, sans éclairage `st-door-e4-f0` : l'indice est
     * au milieu dans un cas sur deux. Un motif ancré à la fin de la chaîne ne voit donc que la
     * moitié des cas — et il l'a fait : la pellicule a photographié ZÉRO frame en croyant
     * qu'aucune n'existait, alors qu'elles défilaient toutes. (Le `_lit` optionnel couvrait
     * jusqu'au 2026-07-30 le cas de la porte TRANCHÉE, qui n'existe plus : une porte reste
     * debout, empreinte comprise, et garde donc son éclairage.)
     */
    const frameDe = (cle) => {
      const m = String(cle).match(/-f(\d+)(?:_lit)?$/)
      return m ? Number(m[1]) : null
    }

    /** L'état lu sur le MONDE et sur le SPRITE — les deux doivent s'accorder. */
    const etat = () => page.evaluate((id) => {
      const sc = window.__BRAISES__.scene
      const s2 = sc.view.structures.find((q) => q.id === id)
      const sp = sc.view.structureSprites?.get(id)
      return { open: s2?.open ?? false, cle: sp?.texture?.key ?? null }
    }, porteId)

    /**
     * Pousse vers le SUD depuis la tuile visée, et rend la position finale.
     *
     * On POUSSE jusqu'à l'arrêt, sans compter le temps : sous swiftshader le rendu est famélique
     * et `playerPos` ne s'écrit que dans `update()`. Et la garde PROUVE SA PRÉMISSE — si le
     * placement échoue, elle rend `null` plutôt qu'une position qui ne veut rien dire.
     */
    const pousser = async (tx) => {
      let place = false
      for (let essai = 0; essai < 10; essai++) {
        await agir({ type: 'debug_teleport', x: tx + 0.5, y: ligne - 0.5 }, 340)
        const q = await pos()
        if (Math.abs(q.x - (tx + 0.5)) < 0.3 && Math.abs(q.y - (ligne - 0.5)) < 0.3) { place = true; break }
      }
      if (!place) { console.error(`!! placement impossible en (${tx + 0.5}, ${ligne - 0.5})`); return null }
      await page.keyboard.down('KeyS')
      let q = await pos()
      let stable = 0
      for (let i = 0; i < 40 && stable < 4; i++) {
        await page.waitForTimeout(220)
        const r2 = await pos()
        stable = Math.abs(r2.y - q.y) < 0.002 ? stable + 1 : 0
        q = r2
      }
      await page.keyboard.up('KeyS')
      await page.waitForTimeout(250)
      return pos()
    }
    /** Revient au contact de la porte et presse la touche d'interaction. */
    const presserF = async () => {
      for (let essai = 0; essai < 10; essai++) {
        await agir({ type: 'debug_teleport', x: porteTx + 0.5, y: ligne - 0.5 }, 340)
        const q = await pos()
        if (Math.abs(q.y - (ligne - 0.5)) < 0.3) break
      }
      await page.keyboard.press('KeyF')
      await page.waitForTimeout(700)
    }

    const close = await etat()
    console.log(`   porte #${porteId} en (${porteTx},${ligne - 1}), arête sud en y=${ligne} — départ ${close.open ? 'OUVERTE' : 'close'} (${close.cle})`)
    if (close.open) console.error('!! une porte NEUVE devrait être CLOSE')

    // ① CLOSE, elle m'arrête, MOI — et ② le MUR voisin aussi (le témoin).
    const bloque = await pousser(porteTx)
    const contreMur = await pousser(porteTx + 1)
    // ③ LA TOUCHE l'ouvre, et je sors.
    await presserF()
    const ouvert = await etat()
    const sorti = await pousser(porteTx)
    // ④ LA MÊME TOUCHE la referme, et je suis de nouveau retenu.
    await presserF()
    const refermee = await etat()
    const rebloque = await pousser(porteTx)

    const y = (p2) => (p2 === null ? 'NON MESURÉ' : p2.y.toFixed(2))
    console.log(`   close → y=${y(bloque)} · mur témoin → y=${y(contreMur)} · F ouvre (${ouvert.cle}) → y=${y(sorti)} · F referme (${refermee.cle}) → y=${y(rebloque)}`)
    if (bloque && bloque.y > ligne) console.error(`!! CLOSE, ELLE NE M'ARRÊTE PAS : sorti en y=${bloque.y.toFixed(2)}`)
    if (contreMur && contreMur.y > ligne) console.error(`!! LE MUR TÉMOIN SE TRAVERSE : la mesure ne prouverait rien`)
    if (ouvert.open !== true) console.error('!! la touche d’interaction n’a pas OUVERT la porte')
    if (sorti && sorti.y <= ligne) console.error(`!! OUVERTE, ELLE NE LIVRE PAS PASSAGE : arrêté en y=${sorti.y.toFixed(2)}`)
    if (refermee.open !== false) console.error('!! la touche d’interaction n’a pas REFERMÉ la porte')
    if (rebloque && rebloque.y > ligne) console.error(`!! REFERMÉE, ELLE NE M'ARRÊTE PLUS : sorti en y=${rebloque.y.toFixed(2)}`)
    // ④ LE SPRITE SUIT L'ÉTAT — et il RESTE UNE PORTE. « La texture change » ne suffit pas : la
    // première version de cette garde était verte alors que la porte ouverte prenait la texture
    // d'un MUR (`st-wall-coupe-e4`), c'est-à-dire l'empreinte pleine de ce qu'on vient d'ouvrir.
    if (ouvert.cle === close.cle) console.error(`!! LE SPRITE NE CHANGE PAS À L'OUVERTURE (${close.cle})`)
    if (refermee.cle !== close.cle) console.error(`!! le sprite refermé (${refermee.cle}) ne revient pas à l'état clos (${close.cle})`)
    for (const [nom, e] of [['close', close], ['ouverte', ouvert], ['refermée', refermee]]) {
      if (!String(e.cle).startsWith('st-door')) console.error(`!! ${nom}, ce n'est plus une porte : ${e.cle}`)
    }
    // L'ÉTAT VIT DANS LA FRAME depuis l'animation (`-f0` close … `-f4` ouverte) : on affirme donc
    // les DEUX extrémités, et pas un nom de famille. (L'assertion d'avant cherchait « ouverte »
    // dans la clé — vraie tant que l'état était une famille, périmée dès qu'il est devenu un
    // indice. Une garde qui teste un NOM survit mal à un changement de représentation.)
    const dernier = 4
    if (frameDe(close.cle) !== 0) console.error(`!! close, elle n'est pas à la frame 0 : ${close.cle}`)
    if (frameDe(ouvert.cle) !== dernier) console.error(`!! ouverte, elle n'est pas à la dernière frame : ${ouvert.cle}`)
    if (frameDe(refermee.cle) !== 0) console.error(`!! refermée, elle n'est pas revenue à la frame 0 : ${refermee.cle}`)

    // ═══ LES CINQ FRAMES PASSENT-ELLES VRAIMENT ? ═══
    //
    // Une animation « qui marche » peut n'être qu'un saut de l'état A à l'état B en 300 ms. Ce
    // qu'on veut savoir, c'est si les positions INTERMÉDIAIRES s'affichent — donc on ÉCHANTILLONNE
    // pendant le geste, aussi vite que le harnais le permet, et on regarde combien de frames
    // distinctes sont passées. Sous swiftshader le rendu est famélique : on n'en verra pas cinq à
    // tous les coups, mais en voir **au moins trois** prouve qu'il y a une course et non un saut.
    const suivreLeBattant = async () => {
      for (let essai = 0; essai < 10; essai++) {
        await agir({ type: 'debug_teleport', x: porteTx + 0.5, y: ligne - 0.5 }, 340)
        const q = await pos()
        if (Math.abs(q.y - (ligne - 0.5)) < 0.3) break
      }
      // ═══ ON JOURNALISE À LA SOURCE, ON N'ÉCHANTILLONNE PLUS ═══
      //
      // La sonde d'origine lisait `texture.key` entre deux `step` : un aller-retour Playwright par
      // point, donc une passoire. Elle a laissé passer un vrai défaut — la porte peinte à sa
      // position d'ARRIVÉE le temps d'un snapshot avant de rejouer sa course (Alexis, 2026-07-30,
      // « l'animation saute depuis son état final »). Le flash dure UN intervalle de snapshot,
      // 50 ms : selon l'instant du relevé, on le voyait ou non. MESURÉ deux fois de suite sur le
      // MÊME code fautif : `f0 → f4 → f0 → f1 → f2 → f3 → f4` d'abord, puis une course
      // impeccable. Une garde qui ne mord qu'une fois sur deux ne garde rien.
      //
      // On s'accroche donc au `setTexture` DU SPRITE : plus une seule pose ne peut nous échapper,
      // qu'elle vienne d'un snapshot ou d'une image de rendu, et le relevé se lit d'un coup à la
      // fin. (Les snapshots continuent d'arriver pendant que la boucle dort : ils viennent du
      // Worker, pas de la boucle — c'est précisément par là que le flash entrait.)
      await page.evaluate((id) => {
        const sp = window.__BRAISES__.scene.view.structureSprites.get(id)
        window.__PORTE_LOG__ = []
        if (!sp.__origSetTexture) {
          sp.__origSetTexture = sp.setTexture.bind(sp)
          sp.setTexture = (k, ...reste) => {
            const l = window.__PORTE_LOG__
            if (l[l.length - 1] !== k) l.push(k)
            return sp.__origSetTexture(k, ...reste)
          }
        }
      }, porteId)
      // On FIGE la boucle de jeu pour la stepper nous-même : l'horloge headless avale des
      // centaines de millisecondes d'un coup et engloutirait toute l'animation entre deux
      // lectures (leçon `fx-ephemere-figer-et-stepper`).
      await page.evaluate(() => { window.__BRAISES__.scene.game.loop.sleep() })
      await page.keyboard.press('KeyF')
      for (let i = 0; i < 60; i++) {
        await page.evaluate(() => {
          const sc = window.__BRAISES__.scene
          sc.game.loop.step(sc.game.loop.time + 20)
        })
      }
      await page.evaluate(() => { window.__BRAISES__.scene.game.loop.wake() })
      return page.evaluate(() => window.__PORTE_LOG__ ?? [])
    }
    const avantLeGeste = (await etat()).open //  d'où le battant DOIT partir
    const frames = await suivreLeBattant()
    console.log(`   battant (départ ${avantLeGeste ? 'OUVERTE' : 'close'}) : ${frames.length} position(s) distincte(s) — ${frames.join(' → ')}`)
    if (frames.length < 3) console.error(`!! LE BATTANT SAUTE au lieu de pivoter : ${frames.length} position(s) vue(s)`)
    const indices = frames.map(frameDe).filter((n) => n !== null)
    if (indices.length !== frames.length) console.error(`!! une position n'est pas une frame de porte : ${frames.join(' → ')}`)
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === indices[i - 1]) console.error(`!! deux frames identiques d'affilée : ${indices.join(',')}`)
    }
    if (indices.length >= 2 && indices[0] === indices[indices.length - 1]) {
      console.error(`!! le battant revient à sa position de départ : ${indices.join(',')}`)
    }
    // ═══ LE GESTE VA DANS UN SEUL SENS — la garde qui manquait ═══
    //
    // MESURÉ le 2026-07-30, avec l'ancien ordre de dépliage (état peint avant le fait lu) :
    // `f0 → f4 → f0 → f1 → f2 → f3 → f4`. La porte se montrait GRANDE OUVERTE le temps d'un
    // snapshot, puis rejouait sa course depuis le début — « l'animation saute depuis son état
    // final » (Alexis). Compter les positions distinctes ne le voyait pas (il y en avait plus,
    // pas moins) ; le début et la fin étaient justes ; aucune paire consécutive n'était égale.
    // La seule propriété qui l'attrape est la MONOTONIE : un battant qui s'ouvre ne se referme
    // jamais en chemin, et il ne touche pas sa position d'arrivée avant d'y arriver.
    const attenduDepart = avantLeGeste ? dernier : 0
    if (indices.length > 0 && indices[0] !== attenduDepart) {
      console.error(`!! LE BATTANT NE PART PAS DE SA POSITION : première vue f${indices[0]}, attendu f${attenduDepart} (${indices.join(',')})`)
    }
    const sens = avantLeGeste ? -1 : 1 //  on ouvre (0 → 4) ou on referme (4 → 0)
    for (let i = 1; i < indices.length; i++) {
      if ((indices[i] - indices[i - 1]) * sens < 0) {
        console.error(`!! LE BATTANT REVIENT EN ARRIÈRE entre f${indices[i - 1]} et f${indices[i]} : ${indices.join(',')}`)
      }
    }

    // ═══ DEBOUT PENDANT QUE SON MUR TOMBE (décision d'Alexis, 2026-07-30) ═══
    //
    // « Contrairement aux murs, il faudrait que les portes soient toujours visibles. » Ce qui le
    // prouve est une PAIRE, lue au même instant sur le même pan : la porte garde son art DEBOUT
    // (`st-door-e…`) pendant que le mur témoin d'à côté n'est plus que son empreinte
    // (`st-wall-coupe-…`). Lire la seule porte ne dirait rien — à trois tuiles elle serait debout
    // de toute façon ; c'est le mur tranché qui atteste que le pan est bien tombé.
    for (let essai = 0; essai < 8; essai++) {
      await agir({ type: 'debug_teleport', x: porteTx + 0.5, y: ligne - 0.5 }, 340)
      const q = await pos()
      if (Math.abs(q.y - (ligne - 0.5)) < 0.3) break
    }
    await page.waitForTimeout(400)
    const paire = await page.evaluate(({ id, x, y }) => {
      const sc = window.__BRAISES__.scene
      const mur = sc.view.structures.find((q) => q.type === 'wall' && q.tx === x + 1 && q.ty === y)
      const sp = sc.view.structureSprites
      return { porte: sp?.get(id)?.texture?.key ?? null, mur: mur ? (sp?.get(mur.id)?.texture?.key ?? null) : null }
    }, { id: porteId, x: porteTx, y: ligne - 1 })
    console.log(`   au contact : porte ${paire.porte} · mur voisin ${paire.mur}`)
    if (!String(paire.mur).startsWith('st-wall-coupe')) {
      console.error(`!! le mur témoin n’est PAS tranché (${paire.mur}) — la garde ne prouverait rien`)
    } else if (!String(paire.porte).startsWith('st-door-e')) {
      console.error(`!! LA PORTE NE RESTE PAS DEBOUT au contact : ${paire.porte}`)
    }

    // ═══ CE QUE ÇA COÛTE : LA PORTE PEUT AVALER QUI SE TIENT DERRIÈRE ELLE ═══
    //
    // La règle des pans promet « on voit derrière un mur exactement quand il pourrait cacher
    // quelqu'un » (`render/pans.ts`). Une porte qui ne tombe plus rompt cette promesse sur SA
    // tuile — une seule, contre tout un côté de bâtiment, mais le chiffre doit être RELEVÉ et pas
    // découvert en jouant. On mesure donc le recouvrement du sprite de l'avatar par celui de la
    // porte, dans la position la plus défavorable : collé au nord d'une porte d'arête sud, là où
    // l'on se tient forcément pour l'ouvrir de l'intérieur. C'est une MESURE, pas une garde : le
    // compromis est assumé (décision d'Alexis), on veut juste savoir ce qu'il vaut.
    // ON COMPTE DES PIXELS OPAQUES, PAS DES BOÎTES. Le premier jet croisait deux `getBounds` et
    // rendait 100 % — faux de bout en bout : une porte est un CADRE, son milieu est un trou, et
    // c'est par ce trou qu'on se voit. Une sonde qui ne regarde pas l'alpha mesure le sprite,
    // pas l'occlusion (leçon `la-capture-peut-mentir`).
    const mesurerOcclusion = (id) => page.evaluate((pid) => {
      const sc = window.__BRAISES__.scene
      const sp = sc.view.structureSprites?.get(pid)
      const moi = sc.playerSprite
      if (!sp || !moi) return null
      const a = sp.getBounds()
      const b = moi.getBounds()
      const x0 = Math.max(a.left, b.left)
      const x1 = Math.min(a.right, b.right)
      const y0 = Math.max(a.top, b.top)
      const y1 = Math.min(a.bottom, b.bottom)
      const aire = b.width * b.height
      if (x1 <= x0 || y1 <= y0 || aire <= 0) return { boite: 0, opaque: 0, devant: sp.depth > moi.depth }
      const src = sc.textures.get(sp.texture.key)?.getSourceImage()
      let opaque = null
      if (src && src.getContext) {
        // L'intersection, ramenée en TEXELS de la porte (son sprite est mis à l'échelle du zoom).
        const kx = src.width / a.width
        const ky = src.height / a.height
        const tx = Math.max(0, Math.floor((x0 - a.left) * kx))
        const ty = Math.max(0, Math.floor((y0 - a.top) * ky))
        const tw = Math.min(src.width - tx, Math.max(1, Math.ceil((x1 - x0) * kx)))
        const th = Math.min(src.height - ty, Math.max(1, Math.ceil((y1 - y0) * ky)))
        const d = src.getContext('2d').getImageData(tx, ty, tw, th).data
        let n = 0
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
        // Rapporté à l'aire de l'AVATAR (pas de l'intersection) : c'est « quelle part de moi
        // disparaît », la seule question qui compte.
        opaque = Math.round((100 * n * ((x1 - x0) * (y1 - y0)) / (tw * th)) / aire)
      }
      return { boite: Math.round((100 * (x1 - x0) * (y1 - y0)) / aire), opaque, devant: sp.depth > moi.depth }
    }, id)
    // LES DEUX ÉTATS, parce que ce sont deux occlusions différentes : close, la porte est un
    // panneau plein ; ouverte, son battant s'est rangé de côté et le trou rend l'avatar.
    const occOuverte = await mesurerOcclusion(porteId)
    await presserF()
    const occClose = await mesurerOcclusion(porteId)
    const dire = (o) => `${o?.opaque ?? '?'} % en pixels pleins (boîte ${o?.boite ?? '?'} %)`
    console.log(`   occlusion de l'avatar collé au nord : porte OUVERTE ${dire(occOuverte)} · CLOSE ${dire(occClose)} — elle se dessine ${occClose?.devant ? 'APRÈS lui (elle le cache)' : 'AVANT lui (il passe devant)'}`)

    // ═══ LE CHEVAUCHEMENT — le mur d'à côté mord-il le bois de la porte ? ═══
    //
    // Une bande de mur déborde d'une demi-épaisseur chez ses voisins pour se recoudre. À pieds
    // égaux, l'ordre tombait sur l'ordre de POSE : la pierre passait par-dessus le bois. C'est le
    // défaut corrigé pour le seuil du bâti généré le 2026-07-27, et la porte du joueur en a
    // hérité intact. On mesure les PROFONDEURS, pas l'impression : la porte doit se dessiner
    // APRÈS le mur voisin dès lors que leurs pieds sont au même rang.
    const tri = await page.evaluate(({ id, x, y }) => {
      const sc = window.__BRAISES__.scene
      const mur = sc.view.structures.find((q) => q.type === 'wall' && q.tx === x + 1 && q.ty === y)
      const sp = sc.view.structureSprites
      const dp = sp?.get(id)?.depth ?? null
      const dm = mur ? (sp?.get(mur.id)?.depth ?? null) : null
      return { porte: dp, mur: dm, memeRang: dp !== null && dm !== null && Math.abs(dp - dm) < 1 }
    }, { id: porteId, x: porteTx, y: ligne - 1 })
    console.log(`   tri : porte ${tri.porte} · mur voisin ${tri.mur}`)
    if (tri.porte === null || tri.mur === null) console.error('!! profondeurs illisibles — le chevauchement n’est pas mesuré')
    else if (tri.porte <= tri.mur) console.error(`!! LE MUR SE DESSINE APRÈS LA PORTE (${tri.mur} ≥ ${tri.porte}) : sa pierre mordra le bois`)

    // ═══ LA PELLICULE : les cinq positions, une image chacune, au même cadrage ═══
    //
    // On FIGE la boucle et on la steppe soi-même : sinon l'horloge headless avale l'animation
    // entière entre deux captures et l'on photographie deux fois la même extrémité.
    {
      // ON REPART D'UNE PORTE CLOSE, ET ON RESTE AU CONTACT.
      //
      // Le premier jet éloignait le joueur de trois tuiles pour « mieux cadrer », puis pressait la
      // touche : il ne se passait rien, et la pellicule photographiait douze fois la frame 0. La
      // règle marchait très bien — `toggle_door` exige la portée de BRAS (1,5 tuile) — c'était la
      // sonde qui s'était mise hors de portée de ce qu'elle voulait déclencher. On CADRE avec la
      // caméra (`stopFollow` + `centerOn`), jamais en déplaçant celui qui agit.
      if ((await etat()).open) await presserF()
      for (let essai = 0; essai < 8; essai++) {
        await agir({ type: 'debug_teleport', x: porteTx + 0.5, y: ligne - 0.5 }, 320)
        const q = await pos()
        if (Math.abs(q.y - (ligne - 0.5)) < 0.5) break
      }
      await page.evaluate(({ x, yy }) => {
        const cam = window.__BRAISES__.scene.cameras.main
        cam.stopFollow()
        cam.setZoom(8)
        cam.centerOn(x * 16, yy * 16)
      }, { x: porteTx + 0.5, yy: ligne - 0.2 })
      await page.waitForTimeout(600)
      const boite = await page.evaluate((id) => {
        const sc = window.__BRAISES__.scene
        const sp = sc.view.structureSprites?.get(id)
        const cv = document.querySelector('canvas')
        if (!sp || !cv) return null
        const r = cv.getBoundingClientRect()
        const sx = r.width / cv.width
        const sy = r.height / cv.height
        const cam = sc.cameras.main
        const gx = (sp.x - cam.worldView.x) * cam.zoom
        const gy = (sp.y - cam.worldView.y) * cam.zoom
        const gw = sp.displayWidth * cam.zoom
        const gh = sp.displayHeight * cam.zoom
        return { x: r.left + (gx - gw / 2) * sx, y: r.top + (gy - gh * sp.originY) * sy, w: gw * sx, h: gh * sy }
      }, porteId)
      await page.evaluate(() => { window.__BRAISES__.scene.game.loop.sleep() })
      await page.keyboard.press('KeyF')
      await page.waitForTimeout(120)
      const prises = new Set()
      for (let i = 0; i < 60 && prises.size < 5; i++) {
        const k = await page.evaluate((id) => {
          const sc = window.__BRAISES__.scene
          sc.game.loop.step(sc.game.loop.time + 16)
          return sc.view.structureSprites?.get(id)?.texture?.key ?? null
        }, porteId)
        const f = frameDe(k)
        if (f === null || prises.has(f)) continue
        prises.add(f)
        const marge = 40
        await page.screenshot({
          path: `${OUT}/porte-${process.env.SMOKE_TAG ?? 'a'}-frame${f}.png`,
          ...(boite
            ? { clip: {
                x: Math.max(0, Math.round(boite.x - marge)),
                y: Math.max(0, Math.round(boite.y - marge)),
                width: Math.round(boite.w + 2 * marge),
                height: Math.round(boite.h + 2 * marge),
              } }
            : {}),
        })
      }
      await page.evaluate(() => { window.__BRAISES__.scene.game.loop.wake() })
      console.log(`   pellicule : ${prises.size} frame(s) capturée(s) — ${[...prises].join(', ')}`)
      if (prises.size < 5) console.error(`!! seulement ${prises.size} frame(s) sur 5 photographiées`)
    }

    // ═══ L'ART DES CINQ POSITIONS, TEXTURE PAR TEXTURE ═══
    //
    // POURQUOI IL FAUT AUSSI CELLE-CI, et pourquoi ce n'est pas un aveu de paresse : la version
    // DEBOUT du battant n'est **jamais visible par celui qui ouvre**. Ouvrir exige la portée de
    // bras (1,5 tuile), un pan tombe à deux : la porte qu'on pousse est toujours rendue TRANCHÉE.
    // Sa silhouette debout n'est vue que par un TIERS, à trois tuiles ou plus. On l'exporte donc
    // depuis les textures elles-mêmes, à l'échelle où elles sont dessinées — c'est l'ART, pas le
    // moment de jeu, et les deux jeux de captures se complètent.
    for (const bit of [4, 2]) {
      for (let f = 0; f < 5; f++) {
        const b64 = await page.evaluate(({ cle }) => {
          const src = window.__BRAISES__.scene.textures.get(cle)?.getSourceImage()
          if (!src || !src.toDataURL) return null
          // ×6, au plus proche : un art de 20 px se juge agrandi, jamais interpolé.
          const c2 = document.createElement('canvas')
          c2.width = src.width * 6
          c2.height = src.height * 6
          const g = c2.getContext('2d')
          g.imageSmoothingEnabled = false
          g.fillStyle = '#5c7a3f'
          g.fillRect(0, 0, c2.width, c2.height)
          g.drawImage(src, 0, 0, c2.width, c2.height)
          return c2.toDataURL('image/png').split(',')[1]
        }, { cle: `st-door-e${bit}-f${f}` })
        if (b64 === null) { console.error(`!! texture st-door-e${bit}-f${f} illisible`); continue }
        await writeFile(`${OUT}/porte-art-e${bit}-f${f}.png`, Buffer.from(b64, 'base64'))
      }
    }
    console.log('   art : 2 arêtes × 5 positions exportées')

    // ON VA REGARDER : les deux états, au même cadrage, pour les comparer côte à côte.
    for (const [nom, ouvrir] of [['close', false], ['ouverte', true]]) {
      const e = await etat()
      if (e.open !== ouvrir) await presserF()
      for (let essai = 0; essai < 8; essai++) {
        await agir({ type: 'debug_teleport', x: porteTx + 0.5, y: ligne + 2.5 }, 320)
        const q = await pos()
        if (Math.abs(q.y - (ligne + 2.5)) < 0.5) break
      }
      await page.evaluate(({ x, yy }) => {
        const cam = window.__BRAISES__.scene.cameras.main
        cam.stopFollow()
        cam.setZoom(8)
        cam.centerOn(x * 16, yy * 16)
      }, { x: porteTx + 0.5, yy: ligne - 0.2 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/porte-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png` })
    }
    return { close: close.cle, ouvert: ouvert.cle }
  },

  async 'arete'(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    // ── SE DOTER, PUIS FONDER. Une action par tick : on espace, et on VÉRIFIE l'effet plutôt
    // que d'espérer (une action avalée laisserait la suite mesurer un monde qui n'a pas changé).
    // UNE ACTION PAR TICK — deux `sendAction` dans le même `evaluate` et la seconde est perdue
    // (le premier jet posait le feu sans l'avoir pris en main, et le scénario s'arrêtait là).
    const agir = async (action, ms = 320) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const slotDe = (item) => page.evaluate((it) => (window.__BRAISES__.scene.registry.get('inv') ?? [])
      .findIndex((s) => s?.item === it), item)

    // ── FONDER, LOIN DES LANDMARKS. On se DÉPLACE d'abord (le spawn de la Racine est cerné de
    // POI, et `found_village` refuse un carré qui en contient un) puis on se dote sur place :
    // c'est la recette éprouvée du scénario `finale`, et il n'y a aucune raison d'en avoir deux.
    const p0 = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    let feu = null
    let bx = 0
    let by = 0
    for (const [ox, oy] of [[0, 0], [-24, 0], [24, 0], [0, -24], [0, 24], [-48, 0], [48, 0]]) {
      const tx = Math.round(p0.x) + ox
      const ty = Math.round(p0.y) + oy
      await agir({ type: 'debug_teleport', x: tx + 0.5, y: ty + 0.5 }, 220)
      await agir({ type: 'debug_grant', item: 'campfire' }, 160)
      const cslot = await slotDe('campfire')
      if (cslot < 0 || cslot >= 6) continue
      await agir({ type: 'set_active_slot', slot: cslot }, 140)
      await agir({ type: 'place_campfire', tx: tx + 1, ty }, 320)
      const id = await page.evaluate(({ x, y }) => {
        const f = window.__BRAISES__.scene.view.structures.find((s) => s.type === 'fire' && s.villageId === 0 && s.tx === x && s.ty === y)
        return f ? f.id : null
      }, { x: tx + 1, y: ty })
      if (id === null) continue
      await agir({ type: 'found_village', structureId: id }, 420)
      if (await page.evaluate(() => (window.__BRAISES__.scene.registry.get('village') ?? 0) > 0)) {
        feu = id
        bx = tx
        by = ty
        break
      }
    }
    if (feu === null) {
      const pourquoi = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error') ?? null)
      console.error(`!! aucun village fondé (${JSON.stringify(pourquoi)}) — la pose au marteau serait refusée`)
      return
    }
    console.log(`village fondé, Feu en ${bx + 1},${by}`)
    // DE QUOI BÂTIR — après la fondation : `debug_grant` met l'objet EN MAIN, et une main pleine
    // de bois au moment de poser le feu ferait échouer la fondation elle-même.
    // 11 murs à 2 bois + 1 porte à 3 : 25 au minimum, et un sac large évite qu'un refus de
    // COÛT se lise comme un refus de PLACEMENT.
    // 16 murs à 2 bois, 1 porte à 3, 18 sols à 1 : 53 au minimum. Un sac large évite qu'un refus
    // de COÛT se lise comme un refus de PLACEMENT.
    for (let i = 0; i < 70; i++) await agir({ type: 'debug_grant', item: 'wood' }, 80)
    await agir({ type: 'debug_grant', item: 'hammer' }, 200)
    // LE MARTEAU DOIT ÊTRE DANS LA CEINTURE (cases 0-5) : c'est elle que `set_active_slot`
    // adresse, et le menu du marteau ne s'ouvre que si la MAIN le tient.
    const hslot = await slotDe('hammer')
    if (hslot < 0 || hslot >= 6) { console.error(`!! le marteau n’est pas dans la ceinture (case ${hslot})`); return }
    await agir({ type: 'set_active_slot', slot: hslot }, 320)

    // ── ARMER LE MUR (le menu du marteau écrit `selected`), marteau en main.
    // ON ARME PAR LE VRAI MENU, jamais par le registre. `UIScene` RÉÉCRIT `selected` à chaque
    // frame depuis son menu du marteau (R20-R21) : un `registry.set('selected','wall')` est
    // effacé à la frame suivante, et la sonde mesurait alors le fantôme du FEU DE CAMP encore
    // en sac (`st-fire`) en croyant mesurer celui du mur. On clique la ligne « Mur ».
    const arme = await page.evaluate(() => {
      const lignes = [...document.querySelectorAll('.bmn-row')]
      const mur = lignes.find((l) => (l.textContent ?? '').startsWith('Mur'))
      if (!mur) return `menu absent (${lignes.length} lignes)`
      mur.click()
      return 'ok'
    })
    if (arme !== 'ok') { console.error(`!! impossible d’armer le mur : ${arme}`); return }
    await page.waitForTimeout(400)
    const selected = await page.evaluate(() => window.__BRAISES__.scene.registry.get('selected') ?? null)
    if (selected !== 'wall') { console.error(`!! le mur n’est pas armé (selected=${selected})`); return }
    // ⚠ CORPS EN BLOC, PAS UNE EXPRESSION. `setZoom` rend la Camera (API fluide de Phaser), et
    // `page.evaluate` sérialise ce qu'on lui rend : la Camera référence la Scene, donc tout le
    // graphe du jeu. Le pont CDP reçoit alors un message de plus de 512 Mo et **Node meurt** sur
    // `ERR_STRING_TOO_LONG` — un plantage qui ne dit rien du jeu et tout de la sonde.
    await page.evaluate(() => { window.__BRAISES__.scene.cameras.main.setZoom(7) })

    // ① ET ② — LE FANTÔME TOURNE, ET IL RESSEMBLE AU MUR. On lit la texture ET l'ancrage du
    // sprite fantôme après chaque appui : c'est la seule preuve que la touche est CÂBLÉE (elles
    // étaient déclarées et lues par personne depuis le 2026-07-27) et qu'elle vise la bonne arête.
    const lireGhost = () => page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const g = sc.buildGhost?.sprite
      return {
        // Le MÊME défaut que tous les lecteurs (`?? EDGE_N`) : la clé n'est écrite qu'au
        // premier appui, comme `buildMaterial`. La lire brute donnerait un `null` de départ
        // qui ferait rougir la garde du cycle sans qu'il y ait quoi que ce soit de cassé.
        edge: sc.registry.get('buildEdge') ?? 1,
        cle: g?.texture?.key ?? null,
        originY: g ? Number(g.originY.toFixed(3)) : null,
        depth: g ? Math.round(g.depth) : null,
        visible: Boolean(g?.visible),
        // LA GÉOMÉTRIE RENDUE, pas celle que je crois. Un fantôme dont on ne peut pas rendre
        // compte de la taille est exactement ce qui cache un vrai défaut.
        w: g ? Math.round(g.displayWidth) : null,
        h: g ? Math.round(g.displayHeight) : null,
        zoom: Number(sc.cameras.main.zoom.toFixed(2)),
        // Où il est À L'ÉCRAN, en px canvas : de quoi vérifier qu'il suit bien le curseur.
        ecran: g ? {
          x: Math.round((g.x - sc.cameras.main.worldView.x) * sc.cameras.main.zoom),
          y: Math.round((g.y - sc.cameras.main.worldView.y) * sc.cameras.main.zoom),
        } : null,
        alpha: g ? Number(g.alpha.toFixed(2)) : null,
      }
    })
    /**
     * LA BOÎTE DU FANTÔME EN COORDONNÉES DE PAGE — trois changements d'unité, et sauter un seul
     * donne un cadrage qui coupe le sujet (MESURÉ : le premier jet capturait 57 % du sprite en
     * croyant le centrer, et la silhouette obtenue ne ressemblait à aucun mur).
     *
     *   ① `displayWidth`/`displayHeight` sont en px MONDE (20×52 pour un mur d'arête) ;
     *   ② la caméra les met à l'échelle de son ZOOM → px internes du canvas ;
     *   ③ le canvas est affiché par CSS à une autre taille → px de page.
     */
    const boiteGhost = () => page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const g = sc.buildGhost?.sprite
      const cv = document.querySelector('canvas')
      if (!g || !cv) return null
      const r = cv.getBoundingClientRect()
      const sx = r.width / cv.width
      const sy = r.height / cv.height
      const cam = sc.cameras.main
      const gx = (g.x - cam.worldView.x) * cam.zoom
      const gy = (g.y - cam.worldView.y) * cam.zoom
      const gw = g.displayWidth * cam.zoom
      const gh = g.displayHeight * cam.zoom
      return {
        x: r.left + (gx - gw / 2) * sx,
        y: r.top + (gy - gh * g.originY) * sy,
        w: gw * sx,
        h: gh * sy,
      }
    })
    // La souris DOIT survoler le canvas : le fantôme suit la tuile visée, et sans pointeur la
    // visée retombe sur le joueur — on mesurerait un fantôme collé aux pieds.
    const box = await page.locator('canvas').first().boundingBox()
    const cx = box.x + box.width / 2 + 90
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.waitForTimeout(400)

    const tour = []
    for (const [nom, touche] of [['départ', null], ['E×1', 'KeyE'], ['E×2', 'KeyE'], ['E×3', 'KeyE'], ['E×4', 'KeyE'], ['A×1', 'KeyA']]) {
      if (touche) { await page.keyboard.press(touche); await page.waitForTimeout(350) }
      const g = await lireGhost()
      tour.push(`${nom} → arête ${g.edge} (${g.cle}, originY ${g.originY}, ${g.w}×${g.h}px, zoom ${g.zoom}, écran ${g.ecran?.x},${g.ecran?.y}, alpha ${g.alpha})`)
      // CADRÉ SUR LE FANTÔME : pleine page, il fait quelques dizaines de pixels au milieu d'un
      // paysage — on ne juge pas une silhouette sur une vignette. Le fantôme colle à la tuile
      // sous le curseur, donc une boîte autour du curseur le contient toujours.
      const bg = await boiteGhost()
      const marge = 90
      await page.screenshot({
        path: `${OUT}/arete-ghost-${process.env.SMOKE_TAG ?? 'a'}-${nom.replace(/[×]/g, 'x')}.png`,
        clip: bg
          ? {
              x: Math.max(0, Math.round(bg.x - marge)),
              y: Math.max(0, Math.round(bg.y - marge)),
              width: Math.round(bg.w + 2 * marge),
              height: Math.round(bg.h + 2 * marge),
            }
          : { x: Math.round(cx - 170), y: Math.round(cy - 200), width: 340, height: 340 },
      })
    }
    console.log(`fantôme : ${tour.join(' | ')}`)
    // ② — IL RESSEMBLE AU MUR. La texture doit être celle de l'ARÊTE armée (`st-wall-e<bit>`) et
    // l'ancrage celui d'une barrière (bas de TUILE, ~0,96), pas le bas de l'image. Sans ce test,
    // un fantôme pleine tuile aurait passé la garde du cycle : les bits tournaient très bien.
    for (const t of tour) {
      const bit = t.match(/arête (\d+)/)?.[1]
      if (!t.includes(`st-wall-e${bit}`)) console.error(`!! le fantôme ne porte pas l’art d’arête : ${t}`)
    }
    const edges = tour.map((t) => Number(t.match(/arête (\d+)/)?.[1]))
    // QUATRE APPUIS RAMÈNENT AU DÉPART (le cycle est de 4), et `A` défait `E` : deux sens.
    if (edges[0] !== edges[4]) console.error(`!! quatre appuis de E ne bouclent pas : ${edges.join('→')}`)
    if (edges[5] !== edges[3]) console.error(`!! A ne défait pas E : ${edges.join('→')}`)
    if (new Set(edges.slice(0, 4)).size !== 4) console.error(`!! le tour ne visite pas les 4 arêtes : ${edges.join('→')}`)

    // ③ ET ④ — UNE VRAIE PIÈCE, BÂTIE ARÊTE PAR ARÊTE.
    //
    // Un mur isolé ne prouve rien : ce qu'on veut voir, c'est qu'une PIÈCE se ferme — donc que
    // les quatre COINS portent chacun DEUX murs (le cas que « tuile occupée » interdisait) et
    // qu'une PORTE s'insère dans le pan sud comme un segment parmi les autres.
    //
    // On pose depuis les tuiles du DEDANS, bit tourné vers le dehors : c'est la convention du
    // bâti généré (`poi-batis`), et c'est elle que la découpe de façade sait lire.
    // ELLE EST PROFONDE (3 × 6) ET ELLE A UN SOL, et les deux comptent pour ce qu'on mesure :
    //   • la règle des PANS a deux détentes — la DISTANCE (≤ 2 tuiles, la hauteur d'un mur) et le
    //     DEDANS (le pan qui borde une région AU SUD tombe dès qu'on entre, quelle que soit la
    //     distance). Dans une pièce de 3 de profond on est toujours à ≤ 2 tuiles de tout : la
    //     distance masque le dedans, et on ne mesurerait qu'elle.
    //   • le DEDANS n'existe que s'il y a une RÉGION, c'est-à-dire un SOL bâti. Sans sol, la
    //     question ne se pose même pas.
    const LARGE = 3
    const PROFOND = 6
    const x0 = bx + 2
    const y0 = by + 3
    const N = 1, E = 2, S = 4, O = 8
    const aPoser = []
    for (let dx = 0; dx < LARGE; dx++) {
      aPoser.push(['wall', x0 + dx, y0, N])
      // LA PORTE D'ABORD, au milieu du sud : une pièce qui se scelle puis s'ouvre passerait par
      // un état CLOS, et l'invariant de navigabilité (R7) refuserait le segment qui la ferme.
      aPoser.push([dx === 1 ? 'door' : 'wall', x0 + dx, y0 + PROFOND - 1, S])
    }
    for (let dy = 0; dy < PROFOND; dy++) {
      aPoser.push(['wall', x0, y0 + dy, O])
      aPoser.push(['wall', x0 + LARGE - 1, y0 + dy, E])
    }
    for (let dy = 0; dy < PROFOND; dy++) for (let dx = 0; dx < LARGE; dx++) aPoser.push(['floor', x0 + dx, y0 + dy, null])
    // La porte en tête, pour la raison ci-dessus.
    aPoser.sort((a, b2) => (a[0] === 'door' ? -1 : 0) - (b2[0] === 'door' ? -1 : 0))
    // ON SE PLACE AU MILIEU DE LA PIÈCE. `BUILD_RANGE` vaut 6 tuiles : bâtir les douze segments
    // depuis le Feu laissait le coin le plus lointain à 6,4 — MESURÉ, deux poses refusées
    // « trop loin », et le compte de coins accusait alors le modèle d'arête pour une portée de
    // bras. Depuis le centre, aucune arête n'est à plus de 1,5 tuile.
    await agir({ type: 'debug_teleport', x: x0 + 1.5, y: y0 + 1.5 }, 400)
    for (const [type, tx, ty, bit] of aPoser) {
      // ON SE RAPPROCHE DE CE QU'ON POSE : `BUILD_RANGE` vaut 6 tuiles, et une pièce de 6 de
      // profond ne tient pas dans un bras depuis un seul point.
      await agir({ type: 'debug_teleport', x: tx + 0.5, y: ty + 0.5 }, 110)
      // Le SOL prend la tuile (R25) : pas d'arête pour lui, et son coût est d'un bois.
      if (bit === null) await agir({ type: 'build', structure: type, tx, ty }, 150)
      else await agir({ type: 'build', structure: type, tx, ty, material: 'wood', edges: bit }, 150)
    }
    await page.waitForTimeout(700)

    const bati = await page.evaluate(({ x, y, w, h }) => {
      const sc = window.__BRAISES__.scene
      const murs = sc.view.structures.filter((q) => q.edges !== undefined && q.villageId !== 0)
      const parTuile = {}
      const sprites = []
      for (const q of murs) {
        parTuile[`${q.tx},${q.ty}`] = (parTuile[`${q.tx},${q.ty}`] ?? 0) + 1
        const sp = sc.view.structureSprites?.get(q.id)
        sprites.push({ type: q.type, edges: q.edges, cle: sp?.texture?.key ?? null, originY: sp ? Number(sp.originY.toFixed(3)) : null })
      }
      // LES QUATRE COINS de la pièce : chacun doit porter DEUX murs.
      const coins = [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]
        .map(([cx, cy]) => parTuile[`${cx},${cy}`] ?? 0)
      const sols = sc.view.structures.filter((q) => q.type === 'floor' && q.villageId !== 0).length
      return { total: murs.length, coins, sols, portes: murs.filter((q) => q.type === 'door').length, sprites }
    }, { x: x0, y: y0, w: LARGE, h: PROFOND })

    const attendus = 2 * LARGE + 2 * PROFOND
    console.log(`pièce bâtie : ${bati.total} segments, ${bati.sols} sols, coins = ${JSON.stringify(bati.coins)}, ${bati.portes} porte(s)`)
    if (bati.coins.some((n) => n !== 2)) console.error(`!! UN COIN NE SE FERME PAS : ${JSON.stringify(bati.coins)} (attendu 2 partout)`)
    if (bati.total !== attendus) console.error(`!! ${bati.total} segments posés, attendu ${attendus} — une pose a été refusée`)
    if (bati.sols !== LARGE * PROFOND) console.error(`!! ${bati.sols} sols posés, attendu ${LARGE * PROFOND}`)
    if (bati.portes !== 1) console.error(`!! ${bati.portes} porte(s), attendu 1`)
    if (bati.sprites.some((q) => q.cle === null)) console.error('!! un segment posé n’a AUCUN sprite')
    const porte = bati.sprites.find((q) => q.type === 'door')
    if (porte && !String(porte.cle).startsWith('st-door-')) console.error(`!! la porte ne prend pas l’art d’arête : ${porte.cle}`)

    // ON VA REGARDER. De LOIN les murs se dressent ; de PRÈS le pan qui nous fait face tombe
    // (règle des pans, 2 tuiles) — c'est voulu, et les deux captures le montrent côte à côte.
    //
    // ON CADRE SUR LA PIÈCE, PAS SUR LE JOUEUR. La caméra SUIT l'avatar : viser la pièce en
    // téléportant le joueur à côté la repoussait hors du cadre (MESURÉ : elle sortait par le
    // haut, à demi coupée par le letterbox). On coupe le suivi et on centre.
    const cadrer = async (cx, cy, zoom) => {
      await page.evaluate(({ x, y, zz }) => {
        const cam = window.__BRAISES__.scene.cameras.main
        cam.stopFollow()
        cam.setZoom(zz)
        cam.centerOn(x * 16, y * 16)
      }, { x: cx, y: cy, zz: zoom })
      await page.waitForTimeout(500)
    }
    const centreX = x0 + LARGE / 2
    const centreY = y0 + PROFOND / 2
    for (const [nom, px, py, zoom, poste] of [
      // DEHORS, à plus de 2 tuiles de tous les pans : rien ne tombe, les murs se DRESSENT.
      ['piece-debout', centreX, centreY, 4, [centreX, y0 + PROFOND + 4]],
      // DEDANS, AU FOND DE LA PIÈCE : à 5 tuiles du mur sud, donc HORS de la portée de la règle
      // de DISTANCE (2 tuiles). Ce qui tombe ici ne peut venir que de la règle du DEDANS — c'est
      // le seul cadrage qui la met à l'épreuve, et la raison d'être des 6 tuiles de profondeur.
      ['piece-dedans-fond', centreX, centreY, 3.4, [centreX, y0 + 0.5]],
      // LE SEUIL, de près : la porte est-elle DANS le mur, et se lit-elle comme une porte ?
      ['piece-seuil', centreX, y0 + PROFOND - 0.5, 8, [centreX, y0 + PROFOND - 2]],
    ]) {
      // Le joueur d'abord (c'est LUI qui décide des pans tombés), la caméra ensuite.
      for (let essai = 0; essai < 6; essai++) {
        await agir({ type: 'debug_teleport', x: poste[0], y: poste[1] }, 380)
        const p = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        if (Math.abs(p.x - poste[0]) < 0.7 && Math.abs(p.y - poste[1]) < 0.7) break
      }
      await cadrer(px, py, zoom)
      await page.waitForTimeout(700)
      const coupes = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        let n = 0
        for (const [, sp] of sc.view.structureSprites ?? []) if ((sp.texture?.key ?? '').includes('coupe')) n++
        return n
      })
      console.log(`   ${nom} : ${coupes} segment(s) tranché(s)`)
      await page.screenshot({ path: `${OUT}/arete-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png` })
    }

    // ═══ LE FANTÔME CONTRE LE BÂTI — là où il se LIT ═══
    //
    // Les quatre captures d'avant prouvent le CÂBLAGE (la texture change avec la touche), mais
    // sur de l'herbe nue le fantôme est un lavis vert très pâle : `OK_TINT` clair à 55 % d'alpha
    // sur du vert ne contraste pas. Contre la pierre d'un mur déjà posé, il se lit — et c'est
    // aussi la seule image qui raconte le geste : voilà le segment suivant, voilà où il ira.
    for (let essai = 0; essai < 6; essai++) {
      await agir({ type: 'debug_teleport', x: x0 - 1.5, y: y0 + 1.5 }, 380)
      const p = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      if (Math.abs(p.x - (x0 - 1.5)) < 0.7) break
    }
    await page.evaluate(() => {
      const cam = window.__BRAISES__.scene.cameras.main
      cam.stopFollow()
      cam.setZoom(6)
    })
    await page.waitForTimeout(400)
    // On vise la tuile LIBRE juste à l'ouest de la pièce : son arête EST est le mur déjà posé,
    // ses trois autres sont vierges — un seul cadrage montre donc « pris » et « libre ».
    const cible = await page.evaluate(({ tx, ty }) => {
      const sc = window.__BRAISES__.scene
      const cam = sc.cameras.main
      cam.centerOn(tx * 16, ty * 16)
      const cv = document.querySelector('canvas')
      const r = cv.getBoundingClientRect()
      const sx = r.width / cv.width
      const sy = r.height / cv.height
      const px = ((tx + 0.5) * 16 - cam.worldView.x) * cam.zoom
      const py = ((ty + 0.5) * 16 - cam.worldView.y) * cam.zoom
      return { x: r.left + px * sx, y: r.top + py * sy }
    }, { tx: x0 - 1, ty: y0 + 1 })
    await page.mouse.move(cible.x, cible.y)
    await page.waitForTimeout(500)
    const contre = []
    for (const [nom, touche] of [['N', null], ['E', 'KeyE'], ['S', 'KeyE'], ['O', 'KeyE']]) {
      if (touche) { await page.keyboard.press(touche); await page.waitForTimeout(320) }
      await page.mouse.move(cible.x, cible.y)
      await page.waitForTimeout(420)
      const g = await lireGhost()
      // ═══ LE CONTRASTE DU FANTÔME, EN NOMBRES ═══
      //
      // « On ne le voit pas » n'est pas un verdict, c'est une impression. On lit donc les PIXELS
      // du canvas : la luminance au CŒUR du fantôme contre celle du fond juste à côté. La teinte
      // est un MULTIPLICATEUR — un vert pâle sur une pierre moyenne rend un vert moyen, soit
      // très exactement la couleur de l'herbe. C'est cette hypothèse que le nombre tranche.
      // Où lire, EN PX DE PAGE : le cœur du fantôme, et le fond trois tuiles à l'est.
      const points = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const gh = sc.buildGhost?.sprite
        const cv = document.querySelector('canvas')
        if (!gh || !cv) return null
        const cam = sc.cameras.main
        const r = cv.getBoundingClientRect()
        const sx = r.width / cv.width
        const sy = r.height / cv.height
        const page = (wx, wy) => ({
          x: Math.round(r.left + (wx - cam.worldView.x) * cam.zoom * sx),
          y: Math.round(r.top + (wy - cam.worldView.y) * cam.zoom * sy),
        })
        // ═══ OÙ EST LA MATIÈRE DU SPRITE — et pas « son milieu » ═══
        //
        // Le sprite est ancré au BAS de sa tuile, donc sa matière est AU-DESSUS de l'ancre. Mais
        // surtout : une bande VERTICALE n'est qu'un ruban de 4 px collé au bord du sprite (20 px
        // de large), pendant qu'une bande horizontale occupe toute la largeur. Viser « le milieu »
        // tombait donc dans le TRANSPARENT une fois sur deux, et la sonde rendait la couleur de
        // l'herbe en annonçant celle du fantôme (MESURÉ : ΔL = +1,2, soit « invisible », sur un
        // fantôme parfaitement dessiné). On vise la bande que l'arête DÉCLARE.
        const e = sc.registry.get('buildEdge') ?? 1
        const w = gh.displayWidth
        const h = gh.displayHeight
        const dx = e === 2 ? w * 0.4 : e === 8 ? -w * 0.4 : 0
        // En Y, la face d'une bande horizontale monte depuis la bande : on vise à mi-hauteur de
        // mur au-dessus de l'ancre pour N/S, et n'importe où dans la hauteur pour E/O.
        const hy = gh.y - h * 0.5
        return { coeur: page(gh.x + dx, hy), fond: page(gh.x + 64, hy) }
      })
      const contraste = points ? await mesurerContraste(page, points.coeur, points.fond) : null
      contre.push(`${nom}→${g.edge}/${g.cle} vis=${g.visible} contraste ΔL=${contraste?.dLum} (${JSON.stringify(contraste?.fantome)} vs fond ${JSON.stringify(contraste?.fond)})`)
      await page.screenshot({
        path: `${OUT}/arete-bati-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png`,
        clip: { x: Math.max(0, Math.round(cible.x - 260)), y: Math.max(0, Math.round(cible.y - 300)), width: 520, height: 460 },
      })
    }
    console.log(`   fantôme contre le bâti : ${contre.join(' ')}`)

    // ═══ LE VRAI CHEMIN DU CLIC — la seule promesse qui reste à éprouver ═══
    //
    // Tout ce qui précède envoie l'action `build` directement. Or la promesse du mode est « le
    // clic pose là où le fantôme se voit », et ce fil-là passe par `pointerdown` →
    // `clickToAction` → `buildCtx` → `edges`. Un maillon manquant s'y verrait comme une pose
    // silencieusement pleine tuile, ou sur la mauvaise arête. On CLIQUE donc, une fois, sur une
    // arête qu'on sait libre, et on va relire ce que la sim a écrit.
    await page.keyboard.press('KeyE') //  on s'écarte de l'arête déjà prise
    await page.waitForTimeout(320)
    await page.mouse.move(cible.x, cible.y)
    await page.waitForTimeout(400)
    const viseAvant = await lireGhost()
    const avantIds = await page.evaluate(() => window.__BRAISES__.scene.view.structures.filter((q) => q.edges !== undefined).map((q) => q.id))
    await page.mouse.click(cible.x, cible.y)
    await page.waitForTimeout(700)
    // ON NE DEVINE PAS LA TUILE VISÉE : on demande au fantôme où IL est (c'est lui la promesse),
    // et on compare à ce que la sim a écrit. Deviner la tuile du curseur a déjà fait rougir cette
    // garde pour rien — le fantôme suit la tuile sous le pointeur, pas celle que je calcule.
    const pose = await page.evaluate((ids) => {
      const sc = window.__BRAISES__.scene
      const neuf = sc.view.structures.filter((q) => q.edges !== undefined && !ids.includes(q.id))
      const g = sc.buildGhost?.sprite
      return {
        n: sc.view.structures.filter((q) => q.edges !== undefined).length,
        neufs: neuf.map((q) => ({ type: q.type, tx: q.tx, ty: q.ty, edges: q.edges })),
        // LÀ OÙ LE FANTÔME SE TIENT, EN TUILES. Son ancre est `tileFeetAnchor` — les PIEDS de la
        // tuile, soit `((tx + 0.5) · 16, (ty + 1) · 16)`. Le `y` est donc le bas de la tuile, et
        // `floor(y / 16)` rend la tuile SUIVANTE : un rang de trop, qui a fait rougir cette garde
        // alors que le clic tombait juste.
        ghostTx: g ? Math.floor(g.x / 16) : null,
        ghostTy: g ? Math.round(g.y / 16) - 1 : null,
      }
    }, avantIds)
    console.log(`   clic réel : arête visée ${viseAvant.edge} sur la tuile du fantôme (${pose.ghostTx},${pose.ghostTy}) → ${JSON.stringify(pose.neufs)}`)
    if (pose.neufs.length !== 1) console.error(`!! le clic a posé ${pose.neufs.length} segment(s), attendu 1 — le fil pointeur→action est coupé`)
    else if (pose.neufs[0].edges !== viseAvant.edge) console.error(`!! le clic a posé sur l'arête ${pose.neufs[0].edges}, le fantôme montrait ${viseAvant.edge}`)
    else if (pose.neufs[0].tx !== pose.ghostTx || pose.neufs[0].ty !== pose.ghostTy) console.error(`!! le clic a posé en (${pose.neufs[0].tx},${pose.neufs[0].ty}), le fantôme se tenait en (${pose.ghostTx},${pose.ghostTy})`)


    // ═══ ON FRANCHIT SA PORTE, ET PAS LE MUR D'À CÔTÉ ═══
    //
    // Constat d'Alexis : « visuellement toute la case est prise et on ne peut pas faire passer un
    // sprite de joueur ». Le dessin était en cause (une face pleine), pas le moteur — mais ça se
    // MESURE, et la mesure qui tranche est une PAIRE : la porte doit livrer passage ET le mur
    // voisin doit refuser. Un seul des deux ne dirait rien (un joueur qui traverse tout, ou un
    // joueur qui ne bouge pas, donnent le même « ça ne marche pas »).
    const porteTx = x0 + 1
    const murTx = x0
    const ligneSud = y0 + PROFOND //  l'arête que porte le mur du bas (bit S de sa tuile)
    const franchir = async (tx) => {
      // ON PART À L'INTÉRIEUR, une tuile au nord de l'arête, et on POUSSE vers le sud.
      //
      // ET LA GARDE PROUVE SA PRÉMISSE : sans ça, un téléport avalé laisse le joueur ailleurs et
      // l'on mesure une position de départ en croyant mesurer un franchissement. C'est exactement
      // ce qui est arrivé au premier jet — « la porte ne livre pas passage », sur un joueur qui
      // n'avait jamais été devant.
      // ON PART DE LA TUILE QUI PORTE L'ARÊTE, pas d'une tuile plus loin : depuis R25 une arête se
      // pose sur une tuile qui garde son nœud, et le premier jet démarrait pile sur un ARBRE
      // resté debout dans la pièce (MESURÉ : `796,1888 tree`). Le joueur ne bougeait pas d'un
      // pouce et la sonde accusait la porte. On part au ras de l'arête, et on refuse de mesurer
      // si un nœud traîne là.
      const cible = { x: tx + 0.5, y: ligneSud - 0.5 }
      const gene = await page.evaluate(({ x, y }) => (window.__BRAISES__.scene.view.nodes ?? [])
        .filter((n) => n.tx === x && n.ty === y).map((n) => n.type), { x: tx, y: ligneSud - 1 })
      if (gene.length > 0) {
        console.error(`!! un nœud (${gene.join(',')}) occupe la tuile de départ (${tx},${ligneSud - 1}) — le franchissement n'est pas mesurable ici`)
        return null
      }
      let depart = null
      for (let essai = 0; essai < 10; essai++) {
        await agir({ type: 'debug_teleport', x: cible.x, y: cible.y }, 380)
        const q = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        if (Math.abs(q.x - cible.x) < 0.3 && Math.abs(q.y - cible.y) < 0.3) { depart = q; break }
      }
      if (depart === null) {
        const q = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        console.error(`!! IMPOSSIBLE DE SE PLACER en (${cible.x}, ${cible.y}) — le joueur est en (${q.x.toFixed(2)}, ${q.y.toFixed(2)}) ; la mesure suivante ne voudrait rien dire`)
        return null
      }
      // ON POUSSE JUSQU'À L'ARRÊT, on ne compte pas le temps : sous swiftshader le rendu est
      // famélique et une fenêtre fixe mesure un joueur qui n'a pas encore bougé.
      await page.keyboard.down('KeyS')
      let p2 = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      let stable = 0
      for (let i = 0; i < 50 && stable < 4; i++) {
        await page.waitForTimeout(220)
        const q = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        stable = Math.abs(q.y - p2.y) < 0.002 ? stable + 1 : 0
        p2 = q
      }
      await page.keyboard.up('KeyS')
      await page.waitForTimeout(250)
      return page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    }
    // CE QU'IL Y A VRAIMENT SUR LES DEUX COLONNES — avant de conclure quoi que ce soit d'un
    // joueur qui ne bouge pas. Un « ça ne passe pas » peut venir de la porte, d'un voisin, ou de
    // mon village qui ne correspond pas au sien : trois causes, un seul symptôme.
    const quoi = await page.evaluate(({ xs, y0b, y1b }) => {
      const sc = window.__BRAISES__.scene
      const out = { moi: sc.registry.get('village') ?? null, sur: [] }
      for (const s2 of sc.view.structures) {
        if (!xs.includes(s2.tx) || s2.ty < y0b || s2.ty > y1b) continue
        out.sur.push(`${s2.tx},${s2.ty} ${s2.type}${s2.edges === undefined ? ' PLEIN' : ' e' + s2.edges} v${s2.villageId}`)
      }
      // LES NŒUDS BLOQUENT AUSSI (arbre, roche, filon) — et depuis R25 une arête se pose SUR une
      // tuile qui en porte un. Les omettre de la sonde, c'est accuser la porte d'un arbre.
      out.noeuds = []
      for (const n of sc.view.nodes ?? []) {
        if (!xs.includes(n.tx) || n.ty < y0b || n.ty > y1b + 2) continue
        out.noeuds.push(`${n.tx},${n.ty} ${n.type}`)
      }
      return out
    }, { xs: [murTx, porteTx], y0b: ligneSud - 3, y1b: ligneSud })
    console.log(`   mon village ${quoi.moi} · structures ${murTx}/${porteTx} : ${quoi.sur.join(' | ')}`)
    console.log(`   nœuds sur ces colonnes : ${quoi.noeuds.length === 0 ? 'aucun' : quoi.noeuds.join(' | ')}`)

    // ON OUVRE LA PORTE AVANT DE LA FRANCHIR (spec construction R26, depuis le 2026-07-30).
    //
    // Cette sonde date d'avant l'état de porte : elle poussait dans une porte CLOSE et concluait
    // « elle ne livre pas passage ». Elle avait raison — une porte close arrête tout le monde, y
    // compris son bâtisseur, et c'est tout l'objet de R26. Ce que ce scénario-ci veut prouver
    // reste l'ANCIEN point : que le dessin ne ment pas sur l'ouverture. On l'ouvre donc d'abord.
    // (La bascule elle-même, et la paire close/ouverte, sont couvertes par le scénario `porte`.)
    for (let essai = 0; essai < 8; essai++) {
      await agir({ type: 'debug_teleport', x: porteTx + 0.5, y: ligneSud - 0.5 }, 340)
      const q = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      if (Math.abs(q.y - (ligneSud - 0.5)) < 0.3) break
    }
    await page.keyboard.press('KeyF')
    await page.waitForTimeout(700)
    const ouverte = await page.evaluate(({ x, y }) => window.__BRAISES__.scene.view.structures
      .find((q) => q.type === 'door' && q.tx === x && q.ty === y)?.open === true, { x: porteTx, y: ligneSud - 1 })
    if (!ouverte) console.error('!! la porte ne s’est pas ouverte — le franchissement ne prouverait rien')

    const parLaPorte = await franchir(porteTx)
    const parLeMur = await franchir(murTx)
    if (parLaPorte === null || parLeMur === null) console.error('!! franchissement NON MESURÉ (placement impossible)')
    else {
      console.log(`   franchissement : par la porte (${parLaPorte.x.toFixed(2)}, ${parLaPorte.y.toFixed(2)}) · par le mur (${parLeMur.x.toFixed(2)}, ${parLeMur.y.toFixed(2)}) — arête en y=${ligneSud}`)
      if (parLaPorte.y <= ligneSud) console.error(`!! LA PORTE NE LIVRE PAS PASSAGE : arrêté en y=${parLaPorte.y.toFixed(2)}, l'arête est en ${ligneSud}`)
      if (parLeMur.y > ligneSud) console.error(`!! LE MUR SE TRAVERSE : sorti en y=${parLeMur.y.toFixed(2)}, l'arête est en ${ligneSud}`)
    }

    // ET LE TROU SE VOIT-IL ? On lit l'OPACITÉ de la texture de porte le long du passage, contre
    // celle d'un mur au même endroit. Les textures d'art sont des canvas 2D (`addCanvas`), donc
    // `getImageData` y répond vraiment — contrairement au canvas WebGL du jeu.
    const opacite = await page.evaluate(() => {
      const lire = (cle) => {
        const src = window.__BRAISES__.scene.textures.get(cle)?.getSourceImage()
        if (!src || !src.getContext) return null
        const g = src.getContext('2d')
        // La bande de passage d'une arête SUD : le milieu de la tuile, à mi-hauteur du mur.
        const d = g.getImageData(0, 0, src.width, src.height).data
        let opaques = 0
        let total = 0
        // On balaie la colonne centrale sur la moitié basse du dessin — là où un corps passe.
        for (let y = Math.floor(src.height * 0.45); y < src.height - 4; y++) {
          for (let x = Math.floor(src.width * 0.3); x < Math.ceil(src.width * 0.7); x++) {
            total++
            if (d[(y * src.width + x) * 4 + 3] > 8) opaques++
          }
        }
        return total === 0 ? null : Math.round((100 * opaques) / total)
      }
      // LA PORTE **OUVERTE** (dernière frame) contre le mur : c'est le seul couple qui ait un
      // sens depuis R26. Close, elle bouche autant qu'un mur — c'est même ce qu'on exige d'elle.
      return { porte: lire('st-door-e4-f4'), mur: lire('st-wall-e4') }
    })
    console.log(`   opacité du passage : porte OUVERTE ${opacite.porte}% · mur ${opacite.mur}%`)
    if (opacite.porte === null || opacite.mur === null) console.error('!! textures illisibles — la sonde d’opacité ne mesure rien')
    else if (opacite.porte >= opacite.mur) console.error(`!! LA PORTE EST AUSSI PLEINE QUE LE MUR (${opacite.porte}% contre ${opacite.mur}%)`)

    for (const [nom, px, py, zoom, poste] of [
      ['porte-face', centreX, y0 + PROFOND - 1, 8, [centreX, y0 + PROFOND + 3]],
      ['porte-dedans', centreX, y0 + PROFOND - 1.5, 8, [centreX, y0 + PROFOND - 2.5]],
    ]) {
      for (let essai = 0; essai < 6; essai++) {
        await agir({ type: 'debug_teleport', x: poste[0], y: poste[1] }, 380)
        const q = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        if (Math.abs(q.y - poste[1]) < 0.7) break
      }
      await cadrer(px, py, zoom)
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/arete-${process.env.SMOKE_TAG ?? 'a'}-${nom}.png` })
    }


    return bati
  },

  async 'lieux-batis'(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)

    // Plein jour : on compare des FORMES, pas des ambiances nocturnes.
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const cibles = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const KINDS = ['ferme_ruinee', 'ruines', 'cabane', 'oratoire']
      const out = []
      for (const k of KINDS) {
        const z = (m.zones ?? []).find((q) => q.kind === k)
        if (z) out.push({ kind: k, x: z.x + z.w / 2, y: z.y + z.h / 2, w: z.w, h: z.h, name: z.name })
      }
      return out
    })
    console.log(`lieux trouvés : ${JSON.stringify(cibles)}`)
    if (cibles.length === 0) console.error('!! aucun lieu bâti sur la carte — rien à comparer')

    // Combien de structures le monde porte-t-il ? C'est le chiffre qui dira, après, ce que
    // le bâti coûte au snapshot (le tableau `structures` part ENTIER à chaque tick).
    const structures = await page.evaluate(() => (window.__BRAISES__.scene.view?.structures ?? []).length)
    console.log(`structures dans le monde : ${structures}`)

    // LES VRAIES TEXTURES, EXPORTÉES. Pour qu'une planche de pièces montre ce que le jeu
    // dessine, et pas ce qu'on croit qu'il dessine : on lit l'atlas Phaser lui-même.
    if (process.env.SMOKE_PIECES) {
      const pieces = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const out = {}
        for (const key of sc.textures.getTextureKeys()) {
          // Les nœuds AUSSI : la ferme sème des gravats (nœud `rubble`), et une planche qui
          // ne connaît que les structures les peindrait en rouge — ou pire, les oublierait.
          if (!key.startsWith('st-') && !key.startsWith('nd-')) continue
          const src = sc.textures.get(key).getSourceImage()
          if (!src || !src.width) continue
          const c = document.createElement('canvas')
          c.width = src.width; c.height = src.height
          c.getContext('2d').drawImage(src, 0, 0)
          out[key] = c.toDataURL('image/png')
        }
        return out
      })
      console.log(`PIECES_JSON ${JSON.stringify(pieces).length} octets`)
      const { writeFileSync } = await import('node:fs')
      writeFileSync(`${OUT}/pieces.json`, JSON.stringify(pieces))
    }

    const etiquette = process.env.SMOKE_TAG ?? 'avant'
    for (const c of cibles) {
      for (const [nom, zoom] of [['large', 1.3], ['moyen', 2.6], ['serre', 4.5]]) {
        await page.evaluate(({ x, y, z }) => {
          window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
          window.__BRAISES__.scene.cameras.main.setZoom(z)
        }, { x: c.x, y: c.y, z: zoom })
        await page.waitForTimeout(1400)
        await page.screenshot({ path: `${OUT}/batis-${etiquette}-${c.kind}-${nom}.png` })
      }
      console.log(`   → ${c.kind} (${c.w}×${c.h}) @(${Math.round(c.x)}, ${Math.round(c.y)})`)
    }

    // ═══ LA PREUVE DU RELIEF : LA LUMIÈRE RASANTE ═══
    //
    // Une normal map ne se voit PAS sous un soleil au zénith — c'est très exactement le moment
    // où elle ne sert à rien. On refait donc la Ferme à trois heures du jour : le modelé doit
    // CHANGER d'une heure à l'autre, sinon la normale n'est pas branchée et la texture ment.
    // (Et on relit la clé de texture réellement posée : une capture ne prouve pas le câblage.)
    const ferme = cibles.find((c) => c.kind === 'ferme_ruinee')
    if (ferme) {
      for (const heure of [7, 11, 18]) {
        // UNE ACTION PAR TICK (invariant de la sim) : envoyer le téléport et l'heure dans le
        // même `evaluate` fait que la seconde ÉCRASE la première — la caméra restait sur le
        // lieu précédent et la capture montrait l'Oratoire au lieu de la Ferme.
        await page.evaluate(({ x, y }) => {
          window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
          window.__BRAISES__.scene.cameras.main.setZoom(5.5)
        }, { x: ferme.x, y: ferme.y })
        await page.waitForTimeout(700)
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), heure)
        await page.waitForTimeout(1600)
        await page.screenshot({ path: `${OUT}/batis-${etiquette}-relief-${heure}h.png` })
      }
      const cablage = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const cles = {}
        for (const [, s] of sc.view?.structureSprites ?? new Map()) {
          const k = s.texture?.key ?? '?'
          if (k.startsWith('st-wall') || k.startsWith('st-cloture')) cles[k] = (cles[k] ?? 0) + 1
        }
        return { lighting: sc.view?.lighting ?? null, murs: cles }
      })
      // Les clés ont changé de forme avec le modèle d'ARÊTE : `st-wall-ruine-e<masque>` au lieu
      // de `st-wall-ruine-<masque>`. La garde suit le nommage réel, jamais un souvenir.
      const ruines = Object.keys(cablage.murs).filter((k) => k.includes('ruine')).length
      console.log(`câblage : lighting=${cablage.lighting} · ${ruines} clés de mur RUINÉ posées`)

      // ═══ LE MUR A-T-IL DU RELIEF ? — la mesure, pas l'impression ═══
      //
      // PREMIÈRE MESURE ESSAYÉE, ET FAUSSE : σ(luminance) sur toute la tuile. Elle donnait le
      // mur ORDINAIRE gagnant (28,0 contre 19,1) — et c'était exact : il a trois grandes bandes
      // très contrastées (coiffe claire, face, pied sombre). σ mesure l'AMPLITUDE, pas le
      // DÉTAIL. Or « on voit les pierres » ne veut pas dire « il y a du clair et du sombre »,
      // ça veut dire « ça change d'un pixel au suivant ».
      //
      // La bonne quantité est donc la VARIATION LOCALE : |ΔL| moyen entre pixels voisins. Une
      // bande unie vaut 0 quelle que soit sa clarté ; un appareil de pierre monte. Et pour la
      // normale, l'INCLINAISON MOYENNE en degrés — une dalle est plate (0°), pas « inclinée
      // sur 100 % de sa surface », ce que le premier seuil racontait sans rien dire.
      // Le mur ORDINAIRE sert de témoin : même atlas, même lecture, même code.
      const relief = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const lire = (cle) => {
          const t = sc.textures.get(cle)
          const src = t?.getSourceImage?.()
          if (!src || !src.width) return null
          const c = document.createElement('canvas')
          c.width = src.width; c.height = src.height
          c.getContext('2d').drawImage(src, 0, 0)
          return c.getContext('2d').getImageData(0, 0, src.width, src.height).data
        }
        /** |ΔL| moyen entre pixels VOISINS (4-connexité) — le « détail », pas l'amplitude. */
        const detail = (cle, w, hh) => {
          const d = lire(cle)
          if (!d) return null
          const L = (x, y) => {
            const i = (y * w + x) * 4
            if (d[i + 3] < 8) return null // le vide : on ne compare pas de la matière à du rien
            return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
          }
          let s = 0, n = 0
          for (let y = 0; y < hh; y++) {
            for (let x = 0; x < w; x++) {
              const a = L(x, y)
              if (a === null) continue
              for (const [dx, dy] of [[1, 0], [0, 1]]) {
                const b = x + dx < w && y + dy < hh ? L(x + dx, y + dy) : null
                if (b === null) continue
                s += Math.abs(a - b); n++
              }
            }
          }
          return n ? s / n : null
        }
        /**
         * Inclinaison MOYENNE de la normale, en degrés — SUR LA MATIÈRE SEULEMENT.
         *
         * Le masque compte : la normale couvre toute la tuile, transparent compris, et le
         * pourtour d'une silhouette est incliné à fond PAR CONSTRUCTION (le champ de hauteur
         * y tombe de 1 à 0). Les inclure gonflait la moyenne à 45° — un chiffre qui ne parlait
         * pas du mur mais de son contour. On ne mesure que là où il y a de la pierre.
         */
        const inclinaison = (cle, cleAlbedo) => {
          const t = sc.textures.get(cle)
          const n = t?.dataSource?.[0]?.image ?? t?.dataSource?.[0]
          const alb = lire(cleAlbedo)
          if (!n || !n.width || !alb) return null
          const c = document.createElement('canvas')
          c.width = n.width; c.height = n.height
          c.getContext('2d').drawImage(n, 0, 0)
          const d = c.getContext('2d').getImageData(0, 0, n.width, n.height).data
          let s = 0, total = 0
          for (let i = 0; i < d.length; i += 4) {
            if (alb[i + 3] < 8) continue
            const nz = Math.max(-1, Math.min(1, (d[i + 2] / 255) * 2 - 1))
            s += (Math.acos(nz) * 180) / Math.PI
            total++
          }
          return total ? s / total : null
        }
        const ord = [], rui = []
        for (let m = 0; m < 16; m++) {
          const a = detail(`st-wall-${m}`, 16, 22)
          const b = detail(`st-wall-ruine-${m}`, 16, 22)
          if (a !== null) ord.push(a)
          if (b !== null) rui.push(b)
        }
        const moy = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
        return {
          detailOrdinaire: moy(ord),
          detailRuine: moy(rui),
          // Le mur ORDINAIRE n'a pas de `_lit` du tout (hors pipeline, cf. lit-structures.ts) :
          // `null` ici n'est pas un raté de mesure, c'est le constat de départ.
          inclOrdinaire: inclinaison('st-wall-8_lit', 'st-wall-8'),
          inclRuine: inclinaison('st-wall-ruine-8_lit', 'st-wall-ruine-8'),
          // DEUX TÉMOINS DE FAMILLE, et leur écart est le vrai enseignement :
          //   • le COFFRE (`st-chest_lit`) est un carré plein — sa normale est PLATE à
          //     l'intérieur ; tout son relief vient de son contour. C'est le cas de TOUS les
          //     chips de structure : voilà pourquoi un mur ne pouvait qu'être une dalle.
          //   • le BLOC ERRATIQUE, lui, est gravé de fissures (`cracks`) — c'est la seule
          //     pièce du jeu qui ait du modelé INTERNE, et donc la bonne référence.
          inclCoffre: inclinaison('st-chest_lit', 'st-chest'),
          inclErratique: inclinaison('poi-erratique-0_lit', 'poi-erratique-0_lit'),
        }
      })
      const f = (v) => (v === null || v === undefined ? 'aucune' : v.toFixed(1))
      console.log(
        `RELIEF · détail local (|ΔL| moyen) : mur ordinaire ${f(relief.detailOrdinaire)} → ruiné ${f(relief.detailRuine)}` +
        ` · normale : ordinaire ${f(relief.inclOrdinaire)} → ruiné ${f(relief.inclRuine)}° (témoins : coffre ${f(relief.inclCoffre)}°, bloc erratique ${f(relief.inclErratique)}°)`,
      )
      if (relief.detailRuine !== null && relief.detailOrdinaire !== null && relief.detailRuine < relief.detailOrdinaire * 2) {
        console.error('!! le mur ruiné n’est pas plus DÉTAILLÉ que la dalle — l’appareil ne se voit pas')
      }
      if (cablage.lighting && ruines > 0 && !Object.keys(cablage.murs).some((k) => k.endsWith('_lit'))) {
        console.error('!! les murs ruinés ne prennent PAS leur texture _lit — la normale est morte')
      }
      if (ruines === 0) console.error('!! aucun mur ruiné : la Ferme ne bascule pas sur son appareil de pierre')
    }
    return { cibles: cibles.length, structures }
  },

  /**
   * L'ÉCHELLE VERTICALE — le joueur, l'arbre, le gros bois, à la MÊME mesure.
   *
   * Question d'Alexis (2026-07-28) : « la taille des arbres par rapport au sprite du joueur ».
   * Elle ne se lit pas dans le code, parce que la hauteur d'un arbre n'y est écrite NULLE PART :
   * c'est la somme émergente de trois nombres posés dans deux fichiers (hauteur du tronc dans
   * `BootScene`, hauteur du houppier dans `BootScene`, ancrage `py − 16` dans `snapshot-view`).
   * On la relève donc SUR LE RENDU, en pixels monde, telle que Phaser la dessine.
   *
   * La silhouette d'un arbre = de ses pieds (bas du tronc) au sommet de son houppier. Le
   * recouvrement des deux sprites est mesuré, lui aussi : il est censé valoir 6 px « sous le
   * sommet du tronc » — pour le gros bois, dont le fût fait 24 px et non 22, le MÊME `py − 16`
   * en donne 8. C'est ce qu'on vient prouver.
   *
   * Exige `--dev` (le TP n'est armé que là).
   */
  async echelle(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1500)

    const tp = async (x, y) => {
      await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: x, py: y })
      await page.waitForTimeout(1400)
    }
    // Plein jour : on vient JUGER DES TAILLES, pas de la nuit. Têtu (cf. `feeling`).
    for (let essai = 0; essai < 4; essai++) {
      await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
      await page.waitForTimeout(500)
      const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
      if (Math.abs(lu - 11) < 0.3) break
    }

    /**
     * Ce que le rendu dessine VRAIMENT, en pixels monde. Les pools sont privés en TypeScript et
     * publics à l'exécution : on lit `nodePool`/`crownPool` plutôt que de refaire le calcul —
     * refaire le calcul, ce serait tester ma copie, pas le jeu.
     */
    const MESURE = (prefixe) => {
      const sc = window.__BRAISES__.scene
      const T = 16
      const vivants = (p) => (p ?? []).filter((s) => s && s.visible)
      const troncs = vivants(sc.view?.nodePool).filter((s) => s.texture.key.startsWith(prefixe))
      const houppiers = vivants(sc.view?.crownPool)
      // Le houppier est posé sur le MÊME x que son tronc (`px`, tressaillement compris) :
      // c'est l'appariement exact, sans deviner.
      const t = troncs[0]
      if (!t) return null
      const c = houppiers.find((h) => Math.abs(h.x - t.x) < 0.01)
      const sommet = c ? c.y - c.displayHeight : t.y - t.displayHeight
      return {
        texture: t.texture.key,
        troncPx: Math.round(t.displayHeight * 100) / 100,
        houppierPx: c ? Math.round(c.displayHeight * 100) / 100 : 0,
        largeurPx: Math.round(Math.max(t.displayWidth, c?.displayWidth ?? 0) * 100) / 100,
        // La silhouette entière : des pieds au sommet.
        hautPx: Math.round((t.y - sommet) * 100) / 100,
        hautTuiles: Math.round(((t.y - sommet) / T) * 100) / 100,
        // Combien le houppier mord sur le haut du tronc. Le commentaire du code dit 6.
        recouvrementPx: c ? Math.round((c.y - (t.y - t.displayHeight)) * 100) / 100 : null,
        arbresVus: troncs.length,
      }
    }
    const JOUEUR = () => {
      const sc = window.__BRAISES__.scene
      const s = sc.playerSprite
      return {
        texture: s.texture.key,
        hautPx: Math.round(s.displayHeight * 100) / 100,
        hautTuiles: Math.round((s.displayHeight / 16) * 100) / 100,
        largeurPx: Math.round(s.displayWidth * 100) / 100,
      }
    }

    /** Se planter JUSTE À CÔTÉ d'un nœud du type voulu, pour l'avoir à l'écran avec soi. */
    const aCoteDun = async (type) => {
      const cible = await page.evaluate((ty) => {
        const sc = window.__BRAISES__.scene
        const p = sc.registry.get('playerPos')
        const cands = (sc.view?.nodes ?? []).filter((n) => n.type === ty)
        if (!cands.length) return null
        // Le plus proche : on veut qu'il soit DÉJÀ streamé, pas au bout du monde.
        cands.sort((a, b) => (a.tx - p.x) ** 2 + (a.ty - p.y) ** 2 - ((b.tx - p.x) ** 2 + (b.ty - p.y) ** 2))
        return { tx: cands[0].tx, ty: cands[0].ty }
      }, type)
      if (!cible) return null
      // DEUX tuiles à l'est et une au sud : côte à côte, et le joueur DEVANT le houppier
      // (au nord, il passerait derrière — le tri Y est juste, mais on ne verrait rien).
      await tp(cible.tx + 2.5, cible.ty + 1.5)
      return cible
    }

    const lignes = []
    const releve = {}

    // ── L'ARBRE ORDINAIRE ──
    const ordinaire = await aCoteDun('tree')
    if (!ordinaire) {
      console.error('!! aucun arbre streamé autour du spawn — rien à mesurer')
    } else {
      await page.waitForTimeout(600)
      releve.joueur = await page.evaluate(JOUEUR)
      releve.arbre = await page.evaluate(MESURE, 'nd-tree_trunk')
      await page.screenshot({ path: `${OUT}/echelle-arbre.png` })
    }

    // ── LE GROS BOIS (Vieille Sylve) ──
    // La Vieille Sylve n'est PAS un lieu (`map.zones`, qui porte les POI) : c'est une ZONE du
    // graphe, et le client ne la connaît que par la grille grossière `zoneGrid` au pas `zonePas`.
    // On y lit un bloc de sylve et on vise son centre — c'est ainsi que le jeu la localise.
    const sylve = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const { zoneGrid: g, zonePas: pas, zoneDefs: defs } = m ?? {}
      if (!g || !pas || !defs) return null
      const id = defs.findIndex((d) => d.slug === 'sylve')
      if (id < 0) return null
      const cols = Math.ceil(m.width / pas)
      const p = window.__BRAISES__.scene.registry.get('playerPos')
      let meilleur = null
      for (let k = 0; k < g.length; k++) {
        if (g[k] !== id) continue
        const x = ((k % cols) + 0.5) * pas
        const y = (Math.floor(k / cols) + 0.5) * pas
        const d = (x - p.x) ** 2 + (y - p.y) ** 2
        if (!meilleur || d < meilleur.d) meilleur = { x, y, d }
      }
      return meilleur ? { x: meilleur.x, y: meilleur.y, nom: defs[id].nom } : null
    })
    if (!sylve) {
      console.error('!! pas de Vieille Sylve sur la carte : le gros bois ne se mesure pas')
    } else {
      await tp(sylve.x, sylve.y)
      await page.waitForTimeout(900)
      const vieux = await aCoteDun('old_tree')
      if (!vieux) console.error(`!! aucun old_tree dans « ${sylve.nom} » — le gros bois ne se mesure pas`)
      else {
        await page.waitForTimeout(600)
        releve.grosBois = await page.evaluate(MESURE, 'nd-old_tree_trunk')
        await page.screenshot({ path: `${OUT}/echelle-gros-bois.png` })
      }
    }

    // ── LE RELEVÉ ──
    const j = releve.joueur
    const rang = (nom, m) => {
      if (!m || !j) return
      lignes.push(
        `${nom.padEnd(13)} ${String(m.hautPx).padStart(6)} px  ${String(m.hautTuiles).padStart(5)} tuiles  ` +
          `larg. ${String(m.largeurPx).padStart(5)} px  ×${(m.hautPx / j.hautPx).toFixed(2)} le joueur` +
          (m.recouvrementPx !== null && m.recouvrementPx !== undefined ? `  (houppier sur tronc : ${m.recouvrementPx} px)` : ''),
      )
    }
    if (j) {
      lignes.push(`${'joueur'.padEnd(13)} ${String(j.hautPx).padStart(6)} px  ${String(j.hautTuiles).padStart(5)} tuiles  larg. ${String(j.largeurPx).padStart(5)} px  ×1,00`)
    }
    rang('arbre', releve.arbre)
    rang('gros bois', releve.grosBois)
    for (const l of lignes) console.log(`  ${l}`)

    // L'INVARIANT QU'ON VIENT CHERCHER : le recouvrement houppier/tronc est-il le MÊME pour les
    // deux arbres ? `snapshot-view` pose un `py − 16` unique alors que les deux fûts n'ont pas la
    // même hauteur — si les deux nombres diffèrent, l'ancrage est ÉCRIT, pas DÉRIVÉ.
    const a = releve.arbre?.recouvrementPx
    const b = releve.grosBois?.recouvrementPx
    if (a !== null && a !== undefined && b !== null && b !== undefined && a !== b) {
      console.error(
        `!! L'ANCRAGE DU HOUPPIER N'EST PAS DÉRIVÉ : il mord ${a} px sur le tronc de l'arbre et ${b} px sur celui du gros bois ` +
          `— même « py − 16 » pour deux fûts de hauteurs différentes (22 et 24 px).`,
      )
    }
    console.log(`\ncaptures → ${OUT}/echelle-arbre.png, ${OUT}/echelle-gros-bois.png`)
    return releve
  },

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
   * LES ÉCLATS DE LA RÉCOLTE (spec recolte.md G10, 3e signe — 2026-07-29).
   *
   * La gerbe vit 0,6-0,9 s : elle est éteinte avant toute capture prise « après coup ».
   * On FIGE donc la boucle de rendu dès qu'un éclat existe (`game.loop.sleep()`, règle
   * maison), et on mesure sur l'image arrêtée. Trois faits, et ce sont les trois qui
   * peuvent mentir en silence :
   *
   *   (1) LA COULEUR EST LUE SUR LE SPRITE. C'est le point qui casse sans bruit : si
   *       `textures.getPixel` ne rendait rien sur les textures `nd-*` (générées par
   *       `Graphics.generateTexture`), tout retomberait sur le ton de repli et la gerbe
   *       serait GRISE partout — un échec parfaitement silencieux. On exige donc que les
   *       tons échantillonnés soient NON VIDES et qu'ils se retrouvent dans les éclats.
   *   (2) LA PROJECTION SORT DE LA FACE FRAPPÉE : le barycentre des éclats est du côté du
   *       joueur, pas de l'autre. On se téléporte à l'OUEST du nœud et on l'exige à
   *       l'ouest ; sans ce test, une gerbe centrée passerait pour juste.
   *   (3) ELLE EST VISIBLE : les éclats sont dans la vue caméra, et au-dessus du nœud
   *       dans le tri (sinon ils giclent derrière le rocher et personne ne les voit).
   *
   * Exige `--dev` (téléportation).
   */
  async eclats(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    const out = {}
    // Trois matières, trois lois de vol : la pierre CLAQUE, le bois VOLE, la feuille FLOTTE.
    for (const [famille, type] of [['pierre', 'rock'], ['bois', 'tree'], ['feuille', 'berry_bush']]) {
      const cible = await page.evaluate((t) => {
        const s = window.__BRAISES__.scene
        const n = s.view.nodes.find((n) => n.type === t && n.stock > 0)
        if (!n) return null
        // À l'OUEST du nœud : la gerbe doit donc partir vers l'OUEST (x décroissant).
        s.sendAction({ type: 'debug_teleport', x: n.tx - 0.5, y: n.ty + 0.5 })
        return { id: n.id, tx: n.tx, ty: n.ty }
      }, type)
      if (!cible) { console.log(`   ✗ aucun nœud « ${type} » dans cette carte`); continue }
      await page.waitForTimeout(500)

      // ON FIGE À LA NAISSANCE DE LA GERBE, PAS APRÈS. Un `waitForFunction` sur
      // `vivants > 0` puis un `evaluate` échoue TOUJOURS ici : le rendu logiciel tourne à
      // ~3 im/s, une frame dure donc plus longtemps que la gerbe entière (0,6 s) — mesuré,
      // trois matières sur trois rendaient 0 éclat. On s'accroche donc à `eclater` : la
      // boucle s'endort DANS l'appel qui vient de créer la gerbe.
      await page.evaluate(({ id, tx, ty }) => {
        const s = window.__BRAISES__.scene
        window.__PROBE__ = { eclater: 0 }
        const vrai = s.recolteFx.eclater.bind(s.recolteFx)
        s.recolteFx.eclater = (...a) => {
          const r = vrai(...a)
          window.__PROBE__.eclater++
          s.recolteFx.eclater = vrai // un seul gel : le coup suivant doit pouvoir jouer
          s.game.loop.sleep()
          return r
        }
        s.sendAction({ type: 'harvest', nodeId: id, aimX: tx + 0.5, aimY: ty + 0.5 })
      }, cible)

      const ne = await page
        .waitForFunction(() => window.__PROBE__.eclater > 0, null, { timeout: 8000 })
        .then(() => true)
        .catch(() => false)
      if (!ne) { console.log(`   ✗ ${famille} : AUCUNE gerbe n'est née du coup`); out[famille] = { n: 0 }; continue }

      const m = await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const fx = s.recolteFx
        // La boucle DORT : les éclats sont figés à leur naissance, tous au point de
        // morsure. On les fait donc voler NOUS-MÊMES, à l'horloge — trois pas de 50 ms,
        // le `dt` borné exact du vrai jeu. C'est le vrai code de vol, avec une horloge
        // qu'on maîtrise : sans ça, la mesure dépendrait du framerate de la machine.
        const t0 = s.time.now
        // À LA NAISSANCE, chaque gerbe est encore à SON point d'émission : c'est le seul
        // instant où l'on peut séparer les copeaux (au fût) des feuilles (dans la cime).
        // Après le vol, tout se mélange et la mesure ne veut plus rien dire.
        const naissance = fx.eclats.map((e) => ({ y: Math.round(e.y - e.z), c: e.img.fillColor }))
        const avant = { n: fx.eclats.length, t0, ages: fx.eclats.map((e) => Math.round(t0 - e.ne)), naissance }
        // MI-VOL : 350 ms, soit l'instant où la gerbe est la plus ouverte pour les trois
        // matières. À 150 ms elle est encore un point — on jugerait « invisible » ce qui
        // n'est que « pas encore parti ».
        //
        // ON PASSE PAR `game.step`, PAS PAR `fx.update` : la boucle DORT, donc pousser
        // nous-mêmes les positions déplaçait les objets SANS jamais redessiner — la
        // capture montrait la gerbe encore tassée à sa naissance, et on en concluait
        // « on ne voit rien ». `game.step` fait une VRAIE frame (update + rendu), sur une
        // horloge qu'on tient : la photo montre enfin ce que le joueur verrait.
        for (let i = 1; i <= 7; i++) s.game.step(t0 + i * 50, 50)
        const vue = s.cameras.main.worldView
        const me = { x: s.playerSprite.x, y: s.playerSprite.y }
        const eclats = fx.eclats.map((e) => ({
          x: e.img.x, y: e.img.y, c: e.img.fillColor, d: e.img.depth, w: e.img.width,
        }))
        // LES DEUX POPULATIONS, SÉPARÉES PAR LEUR HAUTEUR DE NAISSANCE — et il FAUT les
        // séparer : les copeaux sont DIRIGÉS (à l'opposé du bûcheron), les feuilles sont
        // RADIALES (elles se détachent tout autour de la cime). Mêlées, leur barycentre
        // retombe sur le tronc et le test de direction accuse à tort la gerbe de partir du
        // mauvais côté — c'est exactement ce qui vient d'arriver. L'ordre de `fx.eclats` est
        // stable entre la naissance et le vol : l'index sert de trait d'union.
        const ysN = naissance.map((e) => e.y)
        const etendue = Math.max(...ysN) - Math.min(...ysN)
        const seuil = (Math.max(...ysN) + Math.min(...ysN)) / 2
        const estFeuille = (i) => etendue >= 8 && naissance[i].y < seuil
        const copeaux = eclats.filter((_, i) => !estFeuille(i))
        const moyenne = (a, k) => a.reduce((s, e) => s + e[k], 0) / a.length
        return {
          n: eclats.length,
          // Les tons ÉCHANTILLONNÉS, par texture — vides = getPixel n'a rien rendu.
          tons: [...fx.tons.entries()].map(([k, v]) => [k, v.map((c) => `#${c.toString(16).padStart(6, '0')}`)]),
          couleurs: [...new Set(eclats.map((e) => `#${e.c.toString(16).padStart(6, '0')}`))],
          nCopeaux: copeaux.length,
          // Le barycentre des SEULS copeaux : c'est d'eux qu'on affirme la direction.
          bary: { x: moyenne(copeaux, 'x'), y: moyenne(copeaux, 'y') },
          me,
          dansLaVue: eclats.filter((e) => e.x >= vue.x && e.x <= vue.right && e.y >= vue.y && e.y <= vue.bottom).length,
          tailles: [...new Set(eclats.map((e) => e.w))].sort(),
          avant,
          // DEUX GERBES, DEUX HAUTEURS : on coupe la population de naissance à mi-chemin
          // entre son plus haut et son plus bas. Les feuilles sont le groupe du HAUT.
          feuilles: (() => {
            const hautes = naissance.filter((_, i) => estFeuille(i))
            const basses = naissance.filter((_, i) => !estFeuille(i))
            if (hautes.length === 0) return { n: 0, couleurs: [], hautDessusDesCopeaux: 0 }
            const moy = (a) => a.reduce((s, e) => s + e.y, 0) / a.length
            return {
              n: hautes.length,
              couleurs: [...new Set(hautes.map((e) => `#${e.c.toString(16).padStart(6, '0')}`))],
              hautDessusDesCopeaux: basses.length ? moy(basses) - moy(hautes) : 0,
            }
          })(),
          // L'ÉTALEMENT de la gerbe à mi-vol, en px monde ET en px écran (zoom compris) :
          // c'est ce qui décide si on voit une GERBE ou un point. Relatif au nœud.
          etale: {
            w: Math.max(...eclats.map((e) => e.x)) - Math.min(...eclats.map((e) => e.x)),
            h: Math.max(...eclats.map((e) => e.y)) - Math.min(...eclats.map((e) => e.y)),
            zoom: s.cameras.main.zoom,
          },
          pos: eclats.map((e) => [Math.round(e.x), Math.round(e.y)]),
        }
      })
      console.log(`   · ${famille} : avant vol → ${JSON.stringify(m.avant)}`)
      console.log(`   · ${famille} : étalement à mi-vol ${m.etale.w.toFixed(1)}×${m.etale.h.toFixed(1)} px monde `
        + `(≈${(m.etale.w * m.etale.zoom).toFixed(0)}×${(m.etale.h * m.etale.zoom).toFixed(0)} px écran, zoom ${m.etale.zoom}) — ${JSON.stringify(m.pos)}`)
      await page.screenshot({ path: `${OUT}/eclats-${famille}.png` })
      // …ET LA MÊME CHOSE DE PRÈS. Un grain fait 2 px d'art : sur une capture plein
      // écran il occupe quatre pixels, et « on ne voit rien » y est indiscernable de
      // « c'est trop petit pour être jugé ». On recadre donc sur le nœud avant de
      // conclure quoi que ce soit à l'œil.
      const cadre = await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const cam = s.cameras.main
        const p = s.playerSprite
        const cx = (p.x - cam.worldView.x) * cam.zoom
        const cy = (p.y - cam.worldView.y) * cam.zoom
        const demi = 110
        return {
          x: Math.max(0, Math.round(cx - demi)),
          y: Math.max(0, Math.round(cy - demi)),
          width: demi * 2,
          height: demi * 2,
        }
      })
      await page.screenshot({ path: `${OUT}/eclats-${famille}-pres.png`, clip: cadre })

      const tonsLus = m.tons.flatMap(([, v]) => v)
      console.log(tonsLus.length > 0
        ? `   ✓ ${famille} : la couleur est LUE sur le sprite — ${m.tons.map(([k, v]) => `${k}→${v.join(' ')}`).join(' | ')}`
        : `   ✗ ${famille} : AUCUN ton échantillonné (getPixel muet) — la gerbe est au ton de repli`)
      // Un éclat n'est pas la COPIE d'un ton du sprite : c'en est une VALEUR (sombre /
      // juste / claire). On vérifie donc la propriété — même teinte, valeur voisine — au
      // lieu de recopier ici le barème de `VALEURS`, qui dériverait au premier réglage.
      const memeMatiere = (hexEclat, hexTon) => {
        const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
        const c = rgb(hexEclat)
        const t = rgb(hexTon)
        const st = t.reduce((a, v) => a + v, 0)
        const sc = c.reduce((a, v) => a + v, 0)
        if (st === 0 || sc === 0) return false
        const k = sc / st
        if (k < 0.65 || k > 1.35) return false // la VALEUR bouge, mais pas de plus d'un tiers
        return t.every((v, i) => Math.abs(c[i] - v * k) <= 10) // la TEINTE, elle, est conservée
      }
      const teintesDuSprite = m.n > 0 && m.couleurs.every((c) => tonsLus.some((t) => memeMatiere(c, t)))
      console.log(teintesDuSprite
        ? `   ✓ ${famille} : les ${m.n} éclats sont des VALEURS des tons du nœud (${m.couleurs.join(' ')})`
        : `   ✗ ${famille} : ${m.n} éclats, teintes ${m.couleurs.join(' ') || '—'} étrangères au sprite ${tonsLus.join(' ')}`)
      // Le joueur s'est planté à l'OUEST du nœud : la gerbe doit donc ressortir à l'EST du
      // nœud — de l'autre côté que lui (correction d'Alexis, 29/07 : envoyée vers le
      // joueur, elle se tassait sur son sprite). On le mesure sur le CENTRE DU NŒUD, pas
      // « quelque part près du joueur » : sans ça, une gerbe centrée passerait pour juste.
      const centreNoeud = (cible.tx + 0.5) * 16
      const alOppose = m.nCopeaux > 0 && m.bary.x > centreNoeud
      console.log(alOppose
        ? `   ✓ ${famille} : la gerbe ressort à l'OPPOSÉ du joueur (bary des ${m.nCopeaux} copeaux x=${m.bary.x.toFixed(1)} > nœud x=${centreNoeud} > joueur x=${m.me.x.toFixed(1)})`
        : `   ✗ ${famille} : la gerbe part du MAUVAIS côté (bary x=${m.bary.x.toFixed(1)}, nœud x=${centreNoeud}, joueur x=${m.me.x.toFixed(1)})`)
      console.log(m.n > 0 && m.dansLaVue === m.n
        ? `   ✓ ${famille} : les ${m.n} éclats sont dans le cadre (grains de ${m.tailles.join('/')} px)`
        : `   ✗ ${famille} : ${m.n - m.dansLaVue}/${m.n} éclats hors cadre`)

      // LE HOUPPIER LÂCHE DES FEUILLES quand on tape un arbre (demande d'Alexis) : DEUX
      // gerbes pour un coup, à deux hauteurs. C'est le DÉCALAGE qui porte l'effet — des
      // feuilles émises au pied du fût seraient indiscernables des copeaux, et l'arbre
      // redeviendrait un poteau qu'on gratte.
      if (famille === 'bois') {
        const f = m.feuilles
        console.log(f.n > 0
          ? `   ✓ bois : le houppier lâche ${f.n} feuilles (${f.couleurs.join(' ')})`
          : `   ✗ bois : AUCUNE feuille ne tombe du houppier`)
        console.log(f.hautDessusDesCopeaux > 15
          ? `   ✓ bois : elles tombent de la CIME — ${f.hautDessusDesCopeaux.toFixed(1)} px au-dessus des copeaux`
          : `   ✗ bois : feuilles et copeaux partent d'à peu près la même hauteur (Δ=${f.hautDessusDesCopeaux.toFixed(1)} px)`)
      }
      out[famille] = m
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
      await page.waitForTimeout(1500) // la gerbe s'éteint avant de passer à la matière suivante
    }

    // ─── LA LOUPE ─────────────────────────────────────────────────────────────────────
    // Les quatre captures ci-dessus sont au zoom du JEU : c'est à elles qu'on juge « est-ce
    // que ça se voit en jouant ». Elles ne permettent PAS de juger la forme de la gerbe —
    // un grain y fait quatre pixels. Cette dernière passe zoome à 6× pour qu'on puisse
    // regarder la gerbe elle-même : sa direction, son éventail, ses trois valeurs. Elle ne
    // remplace pas les autres, elle répond à une autre question.
    const loupe = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const n = s.view.nodes.find((n) => n.type === 'rock' && n.stock > 0)
      if (!n) return null
      s.sendAction({ type: 'debug_teleport', x: n.tx - 0.5, y: n.ty + 0.5 })
      s.cameras.main.setZoom(6)
      return { id: n.id, tx: n.tx, ty: n.ty }
    })
    if (loupe) {
      await page.waitForTimeout(600)
      await page.evaluate(({ id, tx, ty }) => {
        const s = window.__BRAISES__.scene
        window.__PROBE__ = { eclater: 0 }
        const vrai = s.recolteFx.eclater.bind(s.recolteFx)
        s.recolteFx.eclater = (...a) => {
          const r = vrai(...a)
          window.__PROBE__.eclater++
          s.recolteFx.eclater = vrai
          s.game.loop.sleep()
          return r
        }
        s.sendAction({ type: 'harvest', nodeId: id, aimX: tx + 0.5, aimY: ty + 0.5 })
      }, loupe)
      const nee = await page
        .waitForFunction(() => window.__PROBE__.eclater > 0, null, { timeout: 8000 })
        .then(() => true)
        .catch(() => false)
      if (nee) {
        const vue = await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          const fx = s.recolteFx
          const t0 = s.time.now
          for (let i = 1; i <= 7; i++) s.game.step(t0 + i * 50, 50) // de VRAIES frames : ça redessine
          const cam = s.cameras.main
          // LE CADRE SUIT LA GERBE, pas le joueur : centré sur l'avatar, le recadrage
          // laissait les éclats HORS CHAMP — et une gerbe absente de la photo se lit
          // « invisible » alors qu'elle n'est qu'ailleurs. On encadre donc joueur ET gerbe.
          const ecran = (x, y) => ({ x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom })
          const pts = [ecran(s.playerSprite.x, s.playerSprite.y), ...fx.eclats.map((e) => ecran(e.img.x, e.img.y))]
          const xs = pts.map((p) => p.x)
          const ys = pts.map((p) => p.y)
          const marge = 70
          return {
            clip: {
              x: Math.max(0, Math.round(Math.min(...xs) - marge)),
              y: Math.max(0, Math.round(Math.min(...ys) - marge)),
              width: Math.round(Math.max(...xs) - Math.min(...xs) + marge * 2),
              height: Math.round(Math.max(...ys) - Math.min(...ys) + marge * 2),
            },
            n: fx.eclats.length,
            joueur: pts[0],
          }
        })
        await page.screenshot({ path: `${OUT}/eclats-loupe.png`, clip: vue.clip })
        console.log(`   ✓ loupe : ${vue.n} éclats de pierre à 6×, cadre ${vue.clip.width}×${vue.clip.height} → eclats-loupe.png`)
      } else {
        console.log(`   ✗ loupe : aucune gerbe à zoomer`)
      }
    }
    return out
  },

  /**
   * LA MORT D'UN NŒUD (spec recolte.md G15 — 2026-07-29).
   *
   * Trois animations, une par matière : l'ARBRE tombe, la PIERRE s'effondre en gerbe à
   * 360°, le VÉGÉTAL lâche ses feuilles. On vide donc trois nœuds jusqu'au bout et on
   * regarde ce qui se passe à l'instant où le stock atteint zéro.
   *
   * L'ARBRE SE MESURE EN PLUSIEURS POINTS, pas un seul. Une chute dure ~1,6 s, et
   * « il a tourné » n'est pas « il a tourné du bon côté, jusqu'au sol, et s'est arrêté » —
   * ce sont deux affirmations différentes. On échantillonne donc l'angle au DÉBUT, à
   * MI-CHUTE et une fois POSÉ, et on exige la progression ET l'arrivée.
   *
   * Exige `--dev` (téléportation).
   */
  async epuisement(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    const out = {}

    // ─── L'ARBRE TOMBE ────────────────────────────────────────────────────────────────
    const arbre = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const n = s.view.nodes.find((n) => n.type === 'tree' && n.stock > 0)
      if (!n) return null
      s.sendAction({ type: 'debug_teleport', x: n.tx - 0.6, y: n.ty + 0.5 }) // à l'OUEST : il tombe à l'est
      return { id: n.id, tx: n.tx, ty: n.ty, stock: n.stock }
    })
    if (!arbre) {
      console.log('   ✗ aucun arbre dans cette carte')
    } else {
      await page.waitForTimeout(500)
      // ON L'ABAT POUR DE VRAI. `whole` ne mord QUE sur le métier `foraging` (economy.ts) :
      // un arbre l'ignore, et le marteler ne l'aurait jamais vidé. L'abattage passe par la
      // JAUGE — et la sim SUPPRIME la charge à chaque coup parti tout seul, donc il faut la
      // réarmer entre deux. C'est le vrai geste du jeu, joué au vrai rythme.
      await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        window.__PROBE__ = { chutes: 0 }
        const vrai = s.chuteArbre.tomber.bind(s.chuteArbre)
        s.chuteArbre.tomber = (...a) => {
          const r = vrai(...a)
          window.__PROBE__.chutes++
          s.chuteArbre.tomber = vrai
          s.game.loop.sleep() // on fige DÈS que l'arbre part : la chute ne s'achèvera pas sans nous
          return r
        }
      })
      const tombe = await frapperJusquAMort(page, arbre.id, 'harvest_charge_start', 1400, 20, () => 'chutes')
      if (!tombe) {
        console.log(`   ✗ arbre : le fût s'est vidé sans TOMBER`)
      } else {
        // TROIS INSTANTS de la même chute : au départ, à mi-course, et posé. `game.step`
        // fait de vraies frames (cf. `eclats`) — sans lui, rien ne se redessinerait.
        const m = await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          const t0 = s.time.now
          const releve = []
          const cam = s.cameras.main
          const lire = () => {
            const c = s.chuteArbre.chutes[0]
            return c ? { a: c.fut.rotation, hx: c.houppier.x, hy: c.houppier.y, hd: c.houppier.depth, fd: c.fut.depth, cible: c.alpha } : null
          }
          releve.push({ t: 0, ...lire() })
          let t = 0
          for (const cible of [380, 760, 1100]) {
            while (t < cible) { t += 40; s.game.step(t0 + t, 40) }
            releve.push({ t, ...lire() })
          }
          return {
            releve,
            joueur: { x: s.playerSprite.x, y: s.playerSprite.y, d: s.playerSprite.depth },
            vue: { x: cam.worldView.x, y: cam.worldView.y, r: cam.worldView.right, b: cam.worldView.bottom, zoom: cam.zoom },
          }
        })
        const [r0, r1, r2, r3] = m.releve
        console.log(`   · arbre : angles ${m.releve.map((r) => `t=${r.t}→${(r.a ?? 0).toFixed(2)}`).join(' ')} (cible ${(r0.cible ?? 0).toFixed(2)})`)
        console.log(Math.abs(r0.a) < Math.abs(r1.a) && Math.abs(r1.a) < Math.abs(r2.a)
          ? `   ✓ arbre : le fût BASCULE et accélère (0 → ${r1.a.toFixed(2)} → ${r2.a.toFixed(2)} rad)`
          : `   ✗ arbre : le fût ne bascule pas comme prévu (${m.releve.map((r) => (r.a ?? 0).toFixed(2)).join(' → ')})`)
        console.log(r3 && Math.abs(r3.a - r0.cible) < 0.02
          ? `   ✓ arbre : il se POSE à l'angle visé et s'y arrête (${r3.a.toFixed(3)} ≈ ${r0.cible.toFixed(3)})`
          : `   ✗ arbre : il ne s'arrête pas à l'angle visé (${r3 ? r3.a.toFixed(3) : 'disparu'} vs ${r0.cible.toFixed(3)})`)
        // LE JOUEUR EST À L'OUEST : l'arbre doit tomber vers l'EST (rotation positive).
        console.log(r0.cible > 0
          ? `   ✓ arbre : il tombe À L'OPPOSÉ du bûcheron (angle visé +${r0.cible.toFixed(2)} = vers l'est)`
          : `   ✗ arbre : il tombe SUR le bûcheron (angle visé ${r0.cible.toFixed(2)})`)
        // LE HOUPPIER A QUITTÉ LA BANDE CANOPÉE (≥ 900 000) : couché, il passe sous les acteurs.
        console.log(r3 && r3.hd < 900000 && r3.hd < m.joueur.d
          ? `   ✓ arbre : le houppier couché est SOUS le joueur (${r3.hd.toFixed(0)} < ${m.joueur.d.toFixed(0)}), hors canopée`
          : `   ✗ arbre : le houppier couché coiffe encore le monde (depth ${r3 ? r3.hd.toFixed(0) : '—'})`)
        await page.screenshot({ path: `${OUT}/epuisement-arbre.png` })
        const clip = await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          const cam = s.cameras.main
          const c = s.chuteArbre.chutes[0]
          const pts = [[s.playerSprite.x, s.playerSprite.y]]
          if (c) pts.push([c.fut.x, c.fut.y], [c.houppier.x, c.houppier.y])
          const xs = pts.map((p) => (p[0] - cam.worldView.x) * cam.zoom)
          const ys = pts.map((p) => (p[1] - cam.worldView.y) * cam.zoom)
          return {
            x: Math.max(0, Math.round(Math.min(...xs) - 90)), y: Math.max(0, Math.round(Math.min(...ys) - 120)),
            width: Math.round(Math.max(...xs) - Math.min(...xs) + 180), height: Math.round(Math.max(...ys) - Math.min(...ys) + 200),
          }
        })
        await page.screenshot({ path: `${OUT}/epuisement-arbre-pres.png`, clip })
        out.arbre = m
      }
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
      await page.waitForTimeout(1500)
    }

    // ─── LA PIERRE ET LE VÉGÉTAL ÉCLATENT ─────────────────────────────────────────────
    for (const [famille, type] of [['pierre', 'rock'], ['vegetal', 'berry_bush']]) {
      const cible = await page.evaluate((t) => {
        const s = window.__BRAISES__.scene
        const n = s.view.nodes.find((n) => n.type === t && n.stock > 0)
        if (!n) return null
        s.sendAction({ type: 'debug_teleport', x: n.tx - 0.6, y: n.ty + 0.5 })
        return { id: n.id, tx: n.tx, ty: n.ty, stock: n.stock }
      }, type)
      if (!cible) { console.log(`   ✗ aucun nœud « ${type} »`); continue }
      await page.waitForTimeout(500)

      await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        window.__PROBE__ = { eclatements: 0 }
        const vrai = s.recolteFx.eclatement.bind(s.recolteFx)
        s.recolteFx.eclatement = (...a) => {
          const r = vrai(...a)
          window.__PROBE__.eclatements++
          s.recolteFx.eclatement = vrai
          s.game.loop.sleep()
          return r
        }
      })
      // LA PIERRE se mine coup par coup, à la cadence du rechargement (`whole` ne mord pas
      // sur le minage) ; LE BUISSON se cueille d'un geste, sans cadence. Deux verbes, deux
      // rythmes — on joue celui du nœud, pas un martèlement qui n'existe pas dans le jeu.
      const ne = type === 'rock'
        ? await frapperJusquAMort(page, cible.id, 'harvest', 1100, 20, () => 'eclatements')
        : await frapperJusquAMort(page, cible.id, 'harvest', 250, 12, () => 'eclatements', true)
      if (!ne) { console.log(`   ✗ ${famille} : le nœud s'est vidé SANS éclater`); continue }

      const m = await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const fx = s.recolteFx
        const t0 = s.time.now
        for (let i = 1; i <= 7; i++) s.game.step(t0 + i * 50, 50)
        const eclats = fx.eclats.map((e) => ({ x: e.img.x, y: e.img.y, c: e.img.fillColor }))
        const cx = eclats.reduce((a, e) => a + e.x, 0) / eclats.length
        const cy = eclats.reduce((a, e) => a + e.y, 0) / eclats.length
        return {
          n: eclats.length,
          couleurs: [...new Set(eclats.map((e) => `#${e.c.toString(16).padStart(6, '0')}`))],
          tons: [...fx.tons.entries()].map(([k, v]) => [k, v.map((c) => `#${c.toString(16).padStart(6, '0')}`)]),
          // LES QUATRE QUADRANTS autour du centre de la gerbe : un éclatement est RADIAL,
          // il ne doit pas ressembler à un jet dirigé. C'est la seule différence de fond
          // avec la gerbe de frappe, donc c'est elle qu'on mesure.
          quadrants: [
            eclats.filter((e) => e.x >= cx && e.y < cy).length,
            eclats.filter((e) => e.x < cx && e.y < cy).length,
            eclats.filter((e) => e.x < cx && e.y >= cy).length,
            eclats.filter((e) => e.x >= cx && e.y >= cy).length,
          ],
        }
      })
      await page.screenshot({ path: `${OUT}/epuisement-${famille}.png` })
      const tonsLus = m.tons.flatMap(([, v]) => v)
      const occupes = m.quadrants.filter((q) => q > 0).length
      console.log(occupes >= 3
        ? `   ✓ ${famille} : la gerbe est RADIALE — ${occupes}/4 quadrants occupés (${m.quadrants.join('/')}) sur ${m.n} éclats`
        : `   ✗ ${famille} : la gerbe n'est pas radiale (${m.quadrants.join('/')})`)
      console.log(m.n > 0 && tonsLus.length > 0
        ? `   ✓ ${famille} : ${m.n} éclats à la couleur du nœud (${m.couleurs.join(' ')})`
        : `   ✗ ${famille} : ${m.n} éclats, tons ${tonsLus.join(' ') || '—'}`)
      out[famille] = m
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
      await page.waitForTimeout(1500)
    }
    return out
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

  /**
   * LA PLANCHE DES ARBRES — les onze variantes `_lit`, composées comme en jeu, côte à côte.
   *
   * Elle existe parce qu'une silhouette d'arbre ne se juge pas sur un diff : le parasol du vieux
   * pin, le fût gris du hêtre et les lenticelles du bouleau sont des faits d'IMAGE. En jeu, ces
   * variantes sont dispersées sur trois cents mètres de carte et sur trois sols différents —
   * les réunir sur une planche est la seule façon de les comparer d'un coup d'œil.
   *
   * On lit les textures VIVANTES de la scène (`nd-<slug>_trunk_lit` / `_crown_lit`) : c'est le
   * pipeline réel, albédo aplati compris, pas un aperçu offline.
   */
  async arbres(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    const planche = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const tm = sc.textures
      const slugs = tm.getTextureKeys()
        .filter((k) => k.startsWith('nd-') && k.endsWith('_trunk_lit'))
        .map((k) => k.slice(3, -('_trunk_lit'.length)))
        .sort()
      const Z = 3, GAP = 6
      // Chaque arbre occupe la largeur de son houppier ; la planche fait la hauteur du plus haut.
      const tailles = slugs.map((s) => {
        const t = tm.get(`nd-${s}_trunk_lit`).getSourceImage()
        const c = tm.get(`nd-${s}_crown_lit`).getSourceImage()
        return { s, tw: t.width, th: t.height, cw: c.width, ch: c.height }
      })
      const H = Math.max(...tailles.map((t) => t.ch + t.th))
      const W = tailles.reduce((a, t) => a + Math.max(t.cw, t.tw) + GAP, GAP)
      const cv = document.createElement('canvas')
      cv.width = W * Z
      cv.height = (H + 10) * Z
      const ctx = cv.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#2a2e26'
      ctx.fillRect(0, 0, cv.width, cv.height)
      let x = GAP
      const posés = []
      for (const t of tailles) {
        const larg = Math.max(t.cw, t.tw)
        const sol = H + 4
        // LE RECOUVREMENT SE DÉDUIT, il n'a pas à être exposé : la garde E1 impose que la
        // hauteur totale (fût + houppier − recouvrement) soit un compte ENTIER de tuiles, et
        // le recouvrement vaut 8 à 14 px — il est donc l'unique reste de (fût + houppier) mod 16.
        const recouvrement = (t.th + t.ch) % 16
        const ancrage = t.th - recouvrement // hauteur du BAS du houppier au-dessus des pieds
        ctx.drawImage(tm.get(`nd-${t.s}_trunk_lit`).getSourceImage(),
          (x + (larg - t.tw) / 2) * Z, (sol - t.th) * Z, t.tw * Z, t.th * Z)
        ctx.drawImage(tm.get(`nd-${t.s}_crown_lit`).getSourceImage(),
          (x + (larg - t.cw) / 2) * Z, (sol - ancrage - t.ch) * Z, t.cw * Z, t.ch * Z)
        posés.push({
          slug: t.s, crown: `${t.cw}×${t.ch}`, trunk: `${t.tw}×${t.th}`,
          hauteur: ancrage + t.ch, tuiles: (ancrage + t.ch) / 16,
        })
        x += larg + GAP
      }
      return { png: cv.toDataURL('image/png'), posés, nombre: slugs.length }
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${OUT}/planche-arbres.png`, Buffer.from(planche.png.split(',')[1], 'base64'))
    for (const p of planche.posés) console.log(`  ${p.slug.padEnd(11)} houppier ${p.crown.padEnd(7)} fût ${p.trunk.padEnd(6)} → ${p.hauteur} px (${p.tuiles} tuiles)`)
    console.log(`\n✓ ${planche.nombre} variantes → ${OUT}/planche-arbres.png`)
    return { variantes: planche.nombre }
  },

  /**
   * L'ARBRE TOMBE-T-IL DU BON CÔTÉ ? — on l'abat DEPUIS LE NORD, exprès.
   *
   * `angleChute` rendait `π/2 − φ` au lieu de `φ + π/2` : une SYMÉTRIE, qui laisse l'est et
   * l'ouest intacts et retourne le nord et le sud l'un dans l'autre (constat d'Alexis du
   * 2026-07-29, « les arbres qui tombent font parfois 180 degrés de plus que prévu »). Le seul
   * scénario d'abattage existant coupait par l'OUEST — l'axe où la faute est invisible. On se
   * plante donc AU NORD : l'arbre doit s'abattre vers la caméra (rotation ≈ 180°), et c'était
   * exactement le cas que la faute figeait à 0 — un arbre qui disparaît sans tomber.
   *
   * Le fait mesuré n'est pas l'angle mais sa CONSÉQUENCE : la pointe du fût finit-elle plus
   * LOIN du bûcheron que son pied ? Un arbre ne s'abat pas sur celui qui le coupe.
   *
   * On fige la boucle en plein vol (`game.loop.sleep`) — une chute dure 760 ms et l'horloge
   * headless saute : sans ça la capture tombe sur un sol vide. Exige `--dev` (TP).
   */
  async chute(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(300)

    // AU NORD de l'arbre, à portée de bras : c'est le placement qui rend la faute visible.
    const tree = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const t = s.view.nodes.find((n) => n.type === 'tree' && n.stock > 0)
      if (!t) return null
      s.sendAction({ type: 'debug_teleport', x: t.tx + 0.5, y: t.ty - 0.5 })
      return { id: t.id, tx: t.tx, ty: t.ty, stock: t.stock }
    })
    if (!tree) { console.log('   ✗ aucun arbre à portée dans cette carte'); return {} }
    await page.waitForTimeout(600)

    // LE GUETTEUR EST ARMÉ AVANT LE DERNIER COUP : la chute part à l'épuisement du nœud et
    // dure moins que l'intervalle entre deux frappes. Le poser après, c'est la manquer.
    await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      window.__chute = new Promise((res) => {
        let frames = 0
        const tick = () => {
          const c = sc.chuteArbre?.chutes?.[0]
          // À mi-course : l'arbre est franchement engagé, et pas encore couché.
          if (c && Math.abs(c.fut.rotation) >= Math.abs(c.alpha) * 0.45) {
            sc.game.loop.sleep() // FIGÉ EN PLEIN VOL, sinon la capture arrive après la chute
            const h = c.fut.displayHeight
            const r = c.fut.rotation
            const p = sc.predicted
            const T = 16
            // La pointe du fût, telle que le rendu la pose : origine (0.5, 1), pointe en haut.
            const pointe = { x: c.fut.x + Math.sin(r) * h, y: c.fut.y - Math.cos(r) * h }
            const d = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
            const bucheron = { x: p.x * T, y: p.y * T }
            res({
              rotationDeg: +((r * 180) / Math.PI).toFixed(1),
              cibleDeg: +((c.alpha * 180) / Math.PI).toFixed(1),
              piedAuBucheronPx: +d({ x: c.fut.x, y: c.fut.y }, bucheron).toFixed(1),
              pointeAuBucheronPx: +d(pointe, bucheron).toFixed(1),
            })
            return
          }
          if (++frames > 4000) { res(null); return }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    })

    // On le rase : dix coups, un par seconde de recharge.
    for (let i = 0; i < 15; i++) {
      const reste = await page.evaluate((id) => {
        const n = window.__BRAISES__.scene.view.nodes.find((x) => x.id === id)
        return n ? n.stock : 0
      }, tree.id)
      if (reste <= 0) break
      await page.evaluate((id) => window.__BRAISES__.scene.sendAction({ type: 'harvest', nodeId: id }), tree.id)
      await page.waitForTimeout(1100) // > GATHER_COOLDOWN (1 s)
    }

    const vu = await page.evaluate(() => window.__chute)
    await page.screenshot({ path: `${OUT}/chute-arbre.png` })
    if (!vu) { console.log('   ✗ aucune chute saisie (le guetteur n’a rien vu)'); return {} }
    console.log(`   chute : ${JSON.stringify(vu)}`)
    console.log(vu.pointeAuBucheronPx > vu.piedAuBucheronPx
      ? `   ✓ IL TOMBE À L'OPPOSÉ : la pointe finit à ${vu.pointeAuBucheronPx} px du bûcheron, le pied à ${vu.piedAuBucheronPx}`
      : `   ✗ L'ARBRE S'ABAT SUR LE BÛCHERON : pointe ${vu.pointeAuBucheronPx} px < pied ${vu.piedAuBucheronPx}`)
    if (Math.abs(vu.cibleDeg) < 120) {
      console.error(`!! CE N'EST PAS UNE CHUTE VERS LE SUD (cible ${vu.cibleDeg}°) — le placement n'éprouve pas la faute`)
    }
    return vu
  },

  /**
   * LE COUVERT SE REFERME-T-IL ? — le disque de découvert, MESURÉ dans le vrai bois.
   *
   * `crownAlpha` efface les houppiers autour du joueur pour qu'il voie où il marche. La
   * question n'est pas s'il existe (une garde d'unité le prouve déjà) mais JUSQU'OÙ il porte,
   * et cette question-là ne se pose qu'à l'écran : un rayon en tuiles ne veut rien dire tant
   * qu'on ne le compare pas au CADRE. On va donc se planter dans le bois le plus dense de la
   * carte, en plein jour, et compter — sur tous les houppiers réellement dessinés — combien
   * sont opaques, combien sont effacés, et à quelle distance le couvert se referme *par
   * rapport au demi-écran*. Si aucun houppier n'atteint l'opacité, la borne extérieure du
   * disque existe dans la fonction et jamais dans l'image : la forêt est transparente partout.
   *
   * Exige `--dev` (téléportation).
   */
  async couvert(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)

    // LE BOIS LE PLUS DENSE, pas « un endroit boisé » : on cherche la fenêtre de 21 tuiles
    // qui compte le plus de forêt, sinon on juge le couvert depuis une lisière.
    const cible = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const FOREST = 3
      const R = 10
      let best = null
      for (let ty = R; ty < m.height - R; ty += 4) {
        for (let tx = R; tx < m.width - R; tx += 4) {
          let n = 0
          for (let dy = -R; dy <= R; dy += 2) {
            const row = (ty + dy) * m.width
            for (let dx = -R; dx <= R; dx += 2) if (m.terrain[row + tx + dx] === FOREST) n++
          }
          if (!best || n > best.n) best = { x: tx, y: ty, n }
        }
      }
      return best
    })

    // UNE ACTION PAR TICK (le protocole n'en porte qu'une : la seconde écraserait la première).
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)
    await page.evaluate(({ x, y }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y }), cible)
    await page.waitForTimeout(1600)

    const mesure = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const p = sc.predicted
      const vue = sc.cameras.main.worldView
      const TILE = 16
      // LA DISTANCE SE PREND AU PIED DU TRONC, comme `crownAlpha` la prend. L'ancre du
      // houppier est 1,4 à 2 tuiles PLUS HAUT (il est planté sur le fût) : mesurer jusqu'à
      // elle donnerait un premier opaque « à 9,5 tuiles » pour une bordure à 10 — un écart
      // qui n'est pas le disque, mais mon point de mesure. Le fût du même arbre partage
      // exactement l'abscisse de sa cime (les deux sortent du même `px`) : on l'apparie
      // là-dessus, et on garde celui qui est juste EN DESSOUS.
      const troncs = (sc.view?.nodePool ?? []).filter((n) => n.visible)
      const piedDe = (c) => {
        let best = null
        for (const t of troncs) {
          if (Math.abs(t.x - c.x) > 0.01 || t.y <= c.y) continue
          if (!best || t.y < best.y) best = t
        }
        return best ? best.y : c.y // pas de fût apparié (culling) : on retombe sur l'ancre
      }
      const crowns = (sc.view?.crownPool ?? []).filter((c) => c.visible)
      const rangs = crowns
        .map((c) => ({
          alpha: c.alpha,
          d: Math.sqrt((c.x / TILE - p.x) ** 2 + (piedDe(c) / TILE - p.y) ** 2),
        }))
        .sort((a, b) => a.d - b.d)
      const opaques = rangs.filter((r) => r.alpha >= 0.999)
      const effaces = rangs.filter((r) => r.alpha <= 0.25)
      return {
        houppiersÀLÉcran: rangs.length,
        opaques: opaques.length,
        effacés: effaces.length,
        // Le cadre, dans la même unité que les rayons : c'est LUI l'étalon.
        écranTuiles: `${+(vue.width / TILE).toFixed(1)} × ${+(vue.height / TILE).toFixed(1)}`,
        demiHauteurTuiles: +(vue.height / TILE / 2).toFixed(1),
        demiDiagonaleTuiles: +(Math.sqrt(vue.width ** 2 + vue.height ** 2) / TILE / 2).toFixed(1),
        // La distance à laquelle le couvert redevient plein, telle qu'on la VOIT.
        premierOpaqueTuiles: opaques.length ? +opaques[0].d.toFixed(1) : null,
        dernierEffacéTuiles: effaces.length ? +effaces[effaces.length - 1].d.toFixed(1) : null,
        où: { x: Math.round(p.x), y: Math.round(p.y) },
      }
    })
    await page.screenshot({ path: `${OUT}/couvert.png` })

    const part = mesure.houppiersÀLÉcran ? Math.round((100 * mesure.opaques) / mesure.houppiersÀLÉcran) : 0
    console.log(`bois le plus dense visé (${cible.x}, ${cible.y}) → ${JSON.stringify(mesure)}`)
    console.log(`  ${mesure.opaques}/${mesure.houppiersÀLÉcran} houppiers OPAQUES à l'écran (${part} %) — écran ${mesure.écranTuiles} tuiles`)
    // LE SEUIL EST TENU PAR LA MESURE, pas par « > 0 ». Depuis que les deux rayons se
    // dérivent du cadre, `opaques === 0` ne peut plus arriver par un mauvais réglage — la
    // garde d'unité l'interdit. Ce qui peut encore lâcher, c'est le CÂBLAGE (plus personne
    // n'appelle `crownAlpha`, ou `canopeePleine` reste armé), et ça se voit à la part qui
    // s'effondre. 60 % mesuré le 29/07 dans le bois le plus dense : on alarme sous 30.
    if (mesure.houppiersÀLÉcran < 10) {
      console.error(`!! PAS DE BOIS À L'ÉCRAN (${mesure.houppiersÀLÉcran} houppiers) — la mesure ne vaut rien`)
    } else if (part < 30) {
      console.error(`!! LE COUVERT NE SE REFERME PLUS DANS LE CADRE : ${part} % d'opaques (60 % attendus)`)
    }
    return mesure
  },

  /**
   * LA TOUFFE PREND-ELLE LA GAMME DE SON BIOME ? (demande d'Alexis, 2026-07-29)
   *
   * Ce qui ne se prouve qu'au navigateur : que la teinte calculée ATTEINT L'ÉCRAN. Elle est
   * posée sur des sprites POOLÉS et traverse le pipeline `_lit` (éclairage armé par défaut) —
   * deux endroits où elle pouvait se perdre sans que rien n'échoue.
   *
   * On va donc se planter dans chaque biome à touffes de la Racine, et on LIT la teinte
   * réellement portée par les sprites d'herbe à l'écran. Le fait mesuré : deux biomes ne
   * portent pas la même. Exige `--dev` (TP).
   */
  async touffes(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)

    const BIOMES = [
      { id: 1, nom: 'pré' }, { id: 17, nom: 'fleuraie' }, { id: 21, nom: 'calciné' },
      { id: 14, nom: 'mélèzes' }, { id: 13, nom: 'pins' }, { id: 8, nom: 'marais' },
    ]
    // LA TUILE LA PLUS ENTOURÉE de son propre biome, pas « une tuile de ce biome » : au bord,
    // l'écran serait rempli par le voisin et la capture jugerait la mauvaise gamme.
    const cibles = await page.evaluate((biomes) => {
      const m = window.__BRAISES__.scene.map
      const R = 6
      const out = {}
      for (const b of biomes) {
        let best = null
        for (let ty = R; ty < m.height - R; ty += 3) {
          for (let tx = R; tx < m.width - R; tx += 3) {
            if (m.terrain[ty * m.width + tx] !== b.id) continue
            let n = 0
            for (let dy = -R; dy <= R; dy += 2) {
              const row = (ty + dy) * m.width
              for (let dx = -R; dx <= R; dx += 2) if (m.terrain[row + tx + dx] === b.id) n++
            }
            if (!best || n > best.n) best = { x: tx, y: ty, n }
          }
        }
        out[b.nom] = best
      }
      return out
    }, BIOMES)

    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const vus = {}
    for (const b of BIOMES) {
      const c = cibles[b.nom]
      if (!c) { console.log(`   (pas de ${b.nom} sur cette carte)`); continue }
      await page.evaluate(({ x, y }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y }), c)
      await page.waitForTimeout(1200)
      await page.evaluate(() => { window.__BRAISES__.scene.cameras.main.setZoom(3) })
      await page.waitForTimeout(600)
      // La teinte PORTÉE, lue sur les sprites d'herbe visibles — pas celle qu'on a calculée.
      const lu = await page.evaluate(() => {
        const pool = window.__BRAISES__.scene.clutter?.pool ?? []
        const compte = {}
        for (const s of pool) {
          if (!s.visible || !String(s.texture?.key ?? '').startsWith('cl-grass_tuft')) continue
          const t = '0x' + (s.tintTopLeft >>> 0).toString(16).padStart(6, '0')
          compte[t] = (compte[t] ?? 0) + 1
        }
        return compte
      })
      await page.screenshot({ path: `${OUT}/touffes-${b.nom}.png` })
      const dominante = Object.entries(lu).sort((a, b2) => b2[1] - a[1])[0]
      vus[b.nom] = dominante ? dominante[0] : null
      console.log(`  ${b.nom.padEnd(10)} (${c.x}, ${c.y}) → ${dominante ? `${dominante[0]} sur ${dominante[1]} touffes` : 'AUCUNE TOUFFE À L’ÉCRAN'}`)
    }

    const distinctes = new Set(Object.values(vus).filter(Boolean))
    console.log(`\n  ${distinctes.size} teintes DISTINCTES portées à l'écran sur ${Object.keys(vus).length} biomes`)
    if (distinctes.size < 2) console.error(`!! LA GAMME DE BIOME N'ATTEINT PAS L'ÉCRAN — toutes les touffes portent la même teinte`)
    return vus
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
  /**
   * LE GUÉ NE PORTE QUE LE SOL (spec construction R4/A24, décision d'Alexis 2026-07-31).
   *
   * Ce qui ne se prouve qu'au navigateur : que le refus SE VOIT AVANT le clic. La sim est
   * gardée par 5 tests headless ; ce qu'ils ne peuvent pas dire, c'est de quelle couleur est
   * le fantôme sous le curseur — et c'était tout le défaut : il s'affichait VERT dans l'eau,
   * donc le joueur n'avait aucun signal jusqu'au rejet.
   *
   * LA MESURE EST EN TRIPLET, jamais en point isolé — « le fantôme est rouge » ne distingue
   * pas un refus de terrain d'un fantôme cassé ou hors de portée :
   *   ① MUR dans le gué        → doit être ROUGE
   *   ② SOL dans le gué, MÊME TUILE, même instant → doit être VERT (le terrain n'est pas
   *     la seule cause ; c'est la PIÈCE qui décide, et la sonde le prouve en changeant
   *     uniquement elle)
   *   ③ MUR sur la BERGE d'à côté → doit être VERT (témoin : la sonde discrimine)
   *
   * ATTENTION AU SERVEUR QU'ON MESURE. `--dev` pointe sur `http://ashes.test/` — la stack
   * DOCKER, donc le build du dépôt principal. Depuis un worktree, ça mesure le code des
   * AUTRES : ce scénario a rendu « ① VERT ✗ » sur un correctif pourtant en place. Lancer son
   * propre `pnpm dev` et passer `SMOKE_URL=http://localhost:3000/`.
   */
  async gue(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    // UN GUÉ AVEC SA BERGE — on cherche une tuile d'eau peu profonde (id 4) dont un voisin
    // est de la TERRE FERME marchable et sèche : il faut les deux pour poser le témoin.
    const site = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const at = (x, y) => m.terrain[y * m.width + x]
      const SEC = new Set([1, 2, 3, 11, 12, 17, 20]) // herbe, route, forêt, lande, prairies, fleurs
      for (let y = 2; y < m.height - 2; y++) {
        for (let x = 2; x < m.width - 2; x++) {
          if (at(x, y) !== 4) continue
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            if (SEC.has(at(x + dx, y + dy))) return { eau: { tx: x, ty: y }, berge: { tx: x + dx, ty: y + dy } }
          }
        }
      }
      return null
    })
    if (!site) {
      console.error('!! aucun gué bordé de terre ferme sur cette carte — rien à mesurer')
      return
    }
    console.log(`site : gué en (${site.eau.tx}, ${site.eau.ty}), berge en (${site.berge.tx}, ${site.berge.ty})`)

    // On se poste SUR LA BERGE : à portée de bâti (6 tuiles) des deux tuiles visées.
    await page.evaluate(({ tx, ty }) => {
      window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: tx + 0.5, y: ty + 0.5 })
    }, site.berge)
    await page.waitForTimeout(500)

    // LE MARTEAU EN MAIN, ET DANS LA CASE ACTIVE — `UIScene` n'ouvre le menu de pose que si
    // `inv[activeSlot].item === 'hammer'`, et il REÉCRIT `selected` à chaque frame depuis ce
    // menu. Armer par le registry ne tient donc pas un souffle : on arme par le vrai geste.
    await page.evaluate(() => { window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: 'hammer' }) })
    await page.waitForTimeout(300)
    await page.evaluate(() => { window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: 'wood' }) })
    await page.waitForTimeout(300)
    const slotMarteau = await page.evaluate(() => (window.__BRAISES__.scene.registry.get('inv') ?? []).findIndex((s) => s?.item === 'hammer'))
    await page.evaluate((slot) => { window.__BRAISES__.scene.sendAction({ type: 'set_active_slot', slot }) }, slotMarteau)
    await page.waitForTimeout(500)
    const menuOuvert = await page.evaluate(() => {
      const el = document.querySelector('.bmn')
      return Boolean(el) && el.querySelectorAll('.bmn-row').length
    })
    console.log(`marteau en case ${slotMarteau} → menu de pose : ${menuOuvert ? `${menuOuvert} pièces` : 'ABSENT ✗'}`)
    if (!menuOuvert) {
      console.error('!! le menu du marteau ne s’ouvre pas — rien ne peut être armé, la mesure serait vide')
      return
    }

    const versEcran = (t) =>
      page.evaluate(({ tx, ty }) => {
        const scene = window.__BRAISES__.scene
        const cam = scene.cameras.main
        const gx = ((tx + 0.5) * 16 - cam.worldView.x) * cam.zoom
        const gy = ((ty + 0.5) * 16 - cam.worldView.y) * cam.zoom
        const c = scene.scale.canvas.getBoundingClientRect()
        return { x: c.left + gx * (c.width / scene.scale.width), y: c.top + gy * (c.height / scene.scale.height) }
      }, t)

    // ARMER PAR LE MENU : `BUILDABLES = ['wall','door','floor','roof']`, une rangée chacune.
    const RANG = { wall: 0, door: 1, floor: 2, roof: 3 }
    const armer = async (piece) => {
      // Désarmer d'abord (la rangée BASCULE : recliquer l'armée la désarme).
      await page.evaluate(() => {
        const a = document.querySelector('.bmn-row.bmn-armed')
        if (a) a.click()
      })
      await page.waitForTimeout(150)
      await page.evaluate((i) => { document.querySelectorAll('.bmn-row')[i]?.click() }, RANG[piece])
      await page.waitForTimeout(250)
      return page.evaluate(() => window.__BRAISES__.scene.registry.get('selected') ?? null)
    }

    /**
     * Arme, vise, et rend ce que le fantôme MONTRE. Elle prouve sa prémisse : `armed` dit ce
     * que l'UI a réellement armé et `texture` ce que le fantôme peint — sans quoi un fantôme
     * ÉTEINT (sprite au repos, `st-wall`, teinte blanche) se lirait « ni vert ni rouge » et
     * les trois lignes du rapport sortiraient fausses ensemble.
     */
    const sonde = async (piece, tuile) => {
      const armed = await armer(piece)
      const c = await versEcran(tuile)
      await page.mouse.move(c.x - 30, c.y - 30) // un vrai déplacement d'abord : le pointermove doit partir
      await page.mouse.move(c.x, c.y, { steps: 4 })
      await page.waitForTimeout(250)
      const g = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const s = sc.buildGhost?.sprite
        if (!s) return null
        // LA TUILE RÉELLEMENT VISÉE, et le terrain dessous : sans ça, on juge une couleur
        // sur une tuile qu'on n'a peut-être jamais atteinte (la conversion tuile→écran est
        // une hypothèse, pas une mesure).
        const a = sc.inputs?.aim?.(sc.input.activePointer) ?? null
        const m = sc.map
        return {
          tint: s.tintTopLeft, visible: s.visible, texture: s.texture?.key ?? null,
          vise: a ? { tx: a.tx, ty: a.ty } : null,
          terrain: a ? m.terrain[a.ty * m.width + a.tx] : null,
          // OÙ LE FANTÔME EST PEINT, en pixels d'écran — pour aller lire sa couleur RÉELLE.
          // `tintTopLeft` dit l'INTENTION ; seul le pixel composé dit ce que le joueur voit.
          ecran: (() => {
            const cam = sc.cameras.main
            const c = sc.scale.canvas.getBoundingClientRect()
            const kx = c.width / sc.scale.width
            const ky = c.height / sc.scale.height
            return {
              x: c.left + (s.x - cam.worldView.x) * cam.zoom * kx,
              y: c.top + (s.y - cam.worldView.y) * cam.zoom * ky,
              h: s.displayHeight * cam.zoom * ky,
            }
          })(),
        }
      })
      return g === null ? null : { ...g, armed, viseeEcran: { x: Math.round(c.x), y: Math.round(c.y) } }
    }
    const VERT = 0x9adf7a
    const ROUGE = 0xd9614f
    const dis = (r) => (r === null ? 'PAS DE FANTÔME' : r.tint === VERT ? 'VERT' : r.tint === ROUGE ? 'ROUGE' : `teinte ${r.tint?.toString(16)}`)

    // ① le MUR dans le gué — doit rougir.
    const murEau = await sonde('wall', site.eau)
    // ② le SOL, MÊME TUILE — doit verdir : c'est la pièce qui décide, pas le terrain seul.
    const solEau = await sonde('floor', site.eau)
    // ③ le MUR sur la berge — le TÉMOIN : sans lui, un fantôme cassé rougirait partout.
    const murBerge = await sonde('wall', site.berge)

    const ligne = (n, quoi, r, attendu) =>
      `${n} ${quoi.padEnd(18)} → ${dis(r)} ${r?.tint === attendu ? '✓' : '✗'}  [armé ${r?.armed ?? '?'} · fantôme ${r?.visible ? 'visible' : 'ÉTEINT ✗'} · ${r?.texture} · visé (${r?.vise?.tx}, ${r?.vise?.ty}) terrain ${r?.terrain}]`
    console.log(ligne('①', 'mur dans le gué', murEau, ROUGE))
    console.log(ligne('②', 'sol dans le gué', solEau, VERT))
    console.log(ligne('③', 'mur sur la berge', murBerge, VERT) + ' — témoin')
    for (const [nom, r] of [['①', murEau], ['②', solEau], ['③', murBerge]]) {
      if (!r?.visible) console.error(`!! ${nom} : le fantôme est ÉTEINT — la couleur lue ne veut rien dire`)
    }
    if (murEau?.tint !== ROUGE) console.error('!! le fantôme reste VERT dans le gué — le joueur n’a aucun signal')
    if (solEau?.tint !== VERT) console.error('!! le SOL est refusé dans le gué — l’exception ne passe pas jusqu’à l’écran')
    if (murBerge?.tint !== VERT) console.error('!! le témoin de berge est rouge — la sonde ne mesure pas ce qu’elle croit')

    /**
     * ═══ CE QUE LE JOUEUR VOIT, ET NON CE QUE LE CODE A VOULU ═══
     *
     * `tintTopLeft` est une INTENTION. Le pixel composé est le fait — et il faut le mesurer
     * DIFFÉRENTIELLEMENT, fantôme allumé contre fantôme ÉTEINT sur la même tuile : c'est la
     * seule façon de savoir OÙ le sprite tombe (mon premier jet échantillonnait le fond et
     * rendait « R−V = 1 contre 3 », deux mesures du décor). La différence localise le
     * fantôme ; sa teinte se lit sur les pixels qui ont bougé, et sur eux seuls.
     */
    const desarmer = async () => {
      await page.evaluate(() => {
        const a = document.querySelector('.bmn-row.bmn-armed')
        if (a) a.click()
      })
      await page.waitForTimeout(250)
    }
    // LA SONDE OPTIQUE EST UN BONUS, JAMAIS UN BLOCAGE. Elle fait ~56 captures de 1×1, et sur
    // un build chargé (couches de rendu supplémentaires) Playwright finit par dépasser son
    // délai sur l'une d'elles. Le verdict qui COMPTE est le triplet ci-dessus ; un timeout
    // d'instrument ne doit pas emporter le scénario avec lui.
    const echelle = async (ref) => {
      const pts = []
      for (let i = 1; i <= 14; i++) {
        try {
          pts.push(await pixelAt(page, Math.round(ref.x), Math.round(ref.y - (ref.h * i) / 15)))
        } catch {
          pts.push(null) // capture ratée : ce point ne comptera pas
        }
      }
      return pts
    }
    /** La teinte du fantôme sur cette tuile : médiane de R−V sur les pixels QUI ONT CHANGÉ. */
    const teinteVue = async (tuile, nomCapture) => {
      const r = await sonde('wall', tuile)
      if (!r?.ecran) return null
      const allume = await echelle(r.ecran)
      if (nomCapture) await page.screenshot({ path: `${OUT}/${nomCapture}` })
      await desarmer()
      const eteint = await echelle(r.ecran)
      const bouges = []
      for (let i = 0; i < allume.length; i++) {
        const a = allume[i]
        const b = eteint[i]
        if (!a || !b) continue
        const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
        if (d > 20) bouges.push(a)
      }
      if (bouges.length === 0) return { n: 0, rv: null }
      const ecarts = bouges.map(([rr, vv]) => rr - vv).sort((x, y) => x - y)
      // Le pixel le plus TEINTÉ, en plus de la médiane : le fantôme est à 55 % d'alpha, donc
      // tout refus du jeu (roche, falaise, tuile occupée) est dilué de la même façon — la
      // médiane sous-estime ce qu'on voit sur les pixels pleins.
      const extreme = ecarts[ecarts.length - 1]
      return { n: bouges.length, rv: ecarts[Math.floor(ecarts.length / 2)], min: ecarts[0], max: extreme }
    }

    let vuEau = null
    let vuBerge = null
    try {
      vuEau = await teinteVue(site.eau, 'gue-fantome-mur-eau.png')
      vuBerge = await teinteVue(site.berge, 'gue-fantome-mur-berge.png')
    } catch (e) {
      console.log(`(sonde optique indisponible : ${e.name ?? e} — le triplet ci-dessus reste le verdict)`)
    }
    console.log(`OPTIQUE — même mur, pixels QUI ONT CHANGÉ : eau ${vuEau?.n} px, R−V médian ${vuEau?.rv} (${vuEau?.min}…${vuEau?.max}) · berge ${vuBerge?.n} px, R−V médian ${vuBerge?.rv} (${vuBerge?.min}…${vuBerge?.max})`)
    if (!vuEau?.n || !vuBerge?.n) {
      console.error('!! la sonde optique n’a trouvé AUCUN pixel de fantôme — elle mesure le décor, pas le fantôme')
    } else if (!(vuEau.rv > vuBerge.rv)) {
      console.error('!! le mur sur l’eau n’est pas plus ROUGE que le même mur sur la berge — le refus ne se VOIT pas')
    } else {
      console.log(`→ le refus SE VOIT : ${vuEau.rv - vuBerge.rv} points de R−V d'écart entre les deux tuiles`)
    }
    // Et la capture large, armée sur l'eau, pour l'œil.
    await sonde('wall', site.eau)
    await page.screenshot({ path: `${OUT}/gue-fantome-mur.png` })
  },

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

  /**
   * LA VITRINE (2026-07-28) — les images du carrousel de l'accueil.
   *
   * Ce n'est pas un test : c'est un ATELIER DE PRISE DE VUE, et il est ici pour une raison
   * précise. Des captures faites à la main sont mortes le jour où l'art bouge (les arbres ont
   * changé de taille avant-hier) ; un scénario nommé rend la reprise gratuite — on relance et
   * les six images du menu sont à jour. Ce qu'il fabrique n'entre PAS dans le dépôt tout seul :
   * on regarde, on choisit, et on copie dans `packages/client/src/assets/vitrine/`.
   *
   *   pnpm smoke --scenario vitrine --dev        (--dev obligatoire : TP + heure)
   *
   * Cinq règles de prise de vue, toutes apprises en ratant la première série :
   * ① LE HUD ET LE TAMPON DE BUILD SORTENT DU CADRE — ce sont des surcouches DOM, on les
   *    masque par une feuille injectée plutôt que par une option de jeu qui n'existe pas.
   * ② LE NOM DU LIEU AUSSI. Fouler un lieu le rend CONNU, et `poi-layer` lève alors son nom en
   *    grand au milieu de l'image. On ne peut pas le désarmer par le jeu (ce serait « oublier »
   *    un lieu) : on éteint les Text du canvas ET on leur confisque `setVisible`, sinon la
   *    boucle de rendu les rallume à la frame suivante.
   * ③ ON NE PRESSE PAS `P` pour se téléporter : l'overlay debug se peindrait DANS l'image.
   *    Le TP passe par `sendAction`, comme dans le scénario `feeling`.
   * ④ L'HEURE SE RELIT AU DÉCLENCHEMENT, pas à la consigne. La sim continue de tourner
   *    pendant qu'on attend les fondus ; c'est l'heure LUE qui explique la lumière obtenue,
   *    et sans elle on règle une image à l'aveugle.
   * ⑤ LA CARTE N'A PAS TOUS LES LIEUX (cf. `lieux` : « ABSENT de cette carte »). Chaque prise
   *    déclare plusieurs candidats et on prend le premier présent ; ce qui manque est ANNONCÉ,
   *    jamais silencieusement sauté — sinon on croit avoir six images et on en a quatre.
   */
  async vitrine(page) {
    if (!dev) {
      console.error('!! la vitrine exige --dev (téléportation et heure)')
      return
    }
    // La fenêtre EST la résolution native du jeu (1280×720, Scale.FIT) : à cette taille le
    // canvas ne subit ni bande noire ni rééchelonnage, donc l'art pixel reste au pixel près.
    await page.setViewportSize({ width: 1280, height: 720 })
    // `#braises-build` est stylé EN LIGNE (build-stamp.ts) : seul un `!important` de feuille
    // le couche. Sans ça le tampon de build signe chaque image du menu.
    await page.addStyleTag({ content: '.hud-overlay,#braises-build{display:none!important}' })
    await page.waitForTimeout(600)

    /**
     * Éteint TOUT texte peint sur le canvas — et l'EMPÊCHE de se rallumer (règle ② en tête).
     * LES DEUX SCÈNES, et la seconde n'est pas un détail : les noms de lieux vivent dans
     * WorldScene, mais les conseils d'onboarding (« Un voisin, tout près… ») vivent dans
     * UIScene, et il a fallu une prise gâchée pour s'en apercevoir.
     */
    const museler = () => page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      for (const s of [sc, sc.scene.get('ui')]) {
        for (const o of s?.children?.list ?? []) {
          if (o.type !== 'Text') continue
          o.visible = false
          o.setVisible = () => o
        }
      }
    })

    const heure = async (h) => {
      // TÊTU, comme dans `feeling` : une action par input, un `set_hour` peut se faire manger.
      for (let essai = 0; essai < 4; essai++) {
        await page.evaluate((hh) => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: hh }), h)
        await page.waitForTimeout(500)
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1)
        if (Math.abs(lu - h) < 0.4) return true
      }
      console.error(`!! set_hour(${h}) n'a jamais pris`)
      return false
    }

    /**
     * LE RECENSEMENT DE LA CARTE, imprimé avant toute prise — sans lui on règle des heures
     * pour des lieux qui n'existent pas. Il lit `map.zones` DIRECTEMENT et non `PROBE`, qui
     * ne rend que les zones portant un `kind` : le Gué, lui, n'a pas de kind (c'est un lieu
     * de terrain, pas un POI), donc PROBE ne le voit pas — la première série a silencieusement
     * replié « l'eau » sur la Cascade pour cette seule raison.
     */
    const recensement = await page.evaluate(() => {
      const par = {}
      for (const z of window.__BRAISES__.scene.map.zones ?? []) {
        const k = z.kind ?? `~${z.name}`
        par[k] = (par[k] ?? 0) + 1
      }
      return par
    })
    console.log(`\n── cette carte contient ──\n   ${Object.entries(recensement).map(([k, n]) => `${k}×${n}`).join('  ')}`)

    /** Vise le premier candidat présent : `kind` tel quel, ou `~Nom` pour une zone sans kind. */
    const viser = (candidats) => page.evaluate((cands) => {
      const zones = window.__BRAISES__.scene.map.zones ?? []
      for (const c of cands) {
        const z = c.startsWith('~') ? zones.find((q) => q.name === c.slice(1)) : zones.find((q) => q.kind === c)
        if (z) return { x: z.x + z.w / 2, y: z.y + z.h / 2, kind: z.kind ?? '(terrain)', name: z.name }
      }
      return null
    }, candidats)

    /**
     * LA PLANCHE DE PRISES. Chaque ligne : un lieu (avec ses replis), une heure, un fichier.
     *
     * L'HEURE EST LE VRAI LEVIER, et la première série l'a prouvé par l'absurde : le même
     * décor est un relevé cadastral à 12 h et un tableau à 19 h. `ambientTint` (render/
     * lighting.ts) donne l'ambre à 6 h et à 20 h, le bleu de nuit après 21 h ; entre 10 et
     * 15 h son alpha est NUL — une prise de midi est, littéralement, sans ambiance.
     *
     * ET LE LIEU COMPTE AUTANT QUE L'HEURE : un plateau de roche ou une plaine rase ne
     * deviennent pas beaux à l'heure dorée, ils deviennent une plaine rase dorée. Ce qui
     * porte une image, ici, c'est la DENSITÉ — futaie, menhirs, berge, feu — donc la planche
     * vise ce qui encombre le cadre, jamais ce qui l'ouvre.
     */
    const PRISES = [
      { nom: 'sylve-matin', heure: 8, ou: ['bois_noir', 'chene', 'arbre'], quoi: 'la futaie au soleil levant' },
      { nom: 'sylve-soir', heure: 19.5, ou: ['bois_noir', 'chene', 'arbre'], quoi: 'la même futaie, au couchant' },
      { nom: 'gue-or', heure: 18.5, ou: ['~le Gué'], quoi: "la rivière à l'heure dorée" },
      { nom: 'gue-brume', heure: 6, ou: ['~le Gué'], quoi: 'la rivière dans la brume' },
      { nom: 'cercle', heure: 19.5, ou: ['cercle_pierres', 'pierre_levee', 'erratique'], quoi: 'les menhirs au couchant' },
      { nom: 'tour', heure: 19, ou: ['tour_guet', 'ferme_ruinee', 'charrette'], quoi: 'la ruine au couchant' },
      { nom: 'chene', heure: 7, ou: ['chene', 'arbre', 'bois_noir'], quoi: 'le gros bois au petit matin' },
      // LE BOIS SEC (2026-07-29) — les conifères des bosquets de crête. Il n'a pas de `kind` :
      // ce n'est pas un lieu, c'est du TERRAIN. On le vise donc au balayage, comme le Gué a dû
      // l'être. Deux heures, parce qu'un conifère se lit à sa silhouette et qu'on ne sait pas
      // encore laquelle des deux lumières la sert le mieux.
      { nom: 'crete-or', heure: 19, conifere: true, quoi: 'le bois sec des crêtes, au couchant' },
      { nom: 'crete-matin', heure: 8, conifere: true, quoi: 'le même bois, au soleil levant' },
      { nom: 'feu-nuit', heure: 22, feu: true, quoi: 'un feu dans le noir' },
      { nom: 'feu-aube', heure: 5, feu: true, garde: true, quoi: 'le même feu, avant le jour' },
    ]

    let prises = 0
    let feuPose = null // le Feu fondé une fois sert à toutes les prises de feu
    const planche = prisesVoulues ? PRISES.filter((p) => prisesVoulues.has(p.nom)) : PRISES
    if (prisesVoulues) console.log(`\n── filtre : ${planche.length}/${PRISES.length} prises (${[...prisesVoulues].join(', ')}) ──`)
    for (const p of planche) {
      // LE FEU N'EST PAS UN LIEU : on le FONDE. Il exige du bois et un endroit loin des POI
      // (règle R1 de la construction), d'où les décalages successifs autour du point courant.
      let cible = null
      if (p.conifere) {
        // LE PLUS GROS AMAS DE CONIFÈRE **DE LA RACINE**. Le filtre de zone n'est pas un luxe :
        // `solDe` peint aussi du pin dans les zones du nord, et sans lui le balayage part
        // huit cents tuiles trop haut (erreur commise, et vue à l'ordonnée de la capture).
        cible = await page.evaluate(() => {
          const m = window.__BRAISES__.scene.map
          const idRacine = (m.zoneDefs ?? []).findIndex((d) => d.slug === 'pres_bas')
          const cols = Math.ceil(m.width / m.zonePas)
          const dansRacine = (x, y) => m.zoneGrid[Math.floor(y / m.zonePas) * cols + Math.floor(x / m.zonePas)] === idRacine
          let best = null
          for (let by = 0; by < m.height - 32; by += 16) {
            for (let bx = 0; bx < m.width - 32; bx += 16) {
              if (!dansRacine(bx + 16, by + 16)) continue
              let n = 0
              for (let y = by; y < by + 32; y += 4) for (let x = bx; x < bx + 32; x += 4) {
                const t = m.terrain[y * m.width + x]
                if (t === 13 || t === 14) n++
              }
              if (!best || n > best.n) best = { n, x: bx + 16, y: by + 16, kind: '(terrain)', name: 'un bosquet de crête' }
            }
          }
          return best && best.n > 24 ? best : null
        })
        if (!cible) { console.error(`   ✗ ${p.nom.padEnd(11)} aucun bosquet de crête trouvé — prise SAUTÉE`); continue }
      } else if (p.feu && p.garde && feuPose) {
        cible = feuPose
      } else if (p.feu) {
        for (let i = 0; i < 12; i++) await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: 'wood' }))
        const depart = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        for (const [ox, oy] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24], [40, 40]]) {
          await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: Math.round(depart.x) + ox + 0.5, py: Math.round(depart.y) + oy + 0.5 })
          await page.waitForTimeout(250)
          await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'light_fire' }))
          await page.waitForTimeout(500)
          const f = await page.evaluate(() => {
            const x = window.__BRAISES__.scene.view.structures.find((q) => q.type === 'fire')
            return x ? { x: x.tx + 0.5, y: x.ty + 1.5, kind: 'feu', name: 'un Feu' } : null
          })
          if (f) { cible = f; feuPose = f; break }
        }
        if (!cible) { console.error(`   ✗ ${p.nom.padEnd(11)} aucun Feu n'a pris — prise SAUTÉE`); continue }
      } else {
        cible = await viser(p.ou)
        if (!cible) {
          console.error(`   ✗ ${p.nom.padEnd(11)} AUCUN de [${p.ou.join(', ')}] sur cette carte — prise SAUTÉE`)
          continue
        }
      }

      await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: cible.x, py: cible.y })
      await page.waitForTimeout(1400)
      await heure(p.heure)
      await museler() // APRÈS le TP : fouler le lieu vient de le rendre connu, donc nommé
      await canopeePleine(page) // et la canopée reste pleine : c'est une photo, pas une partie
      // La souris au centre : le décalage caméra « Foxhole » (framing R11) suit le curseur, et
      // une souris oubliée dans un coin décadre toute la série.
      await page.mouse.move(640, 360)
      await page.waitForTimeout(900) // les fondus de lumière et la brume s'installent
      const vue = await page.evaluate(() => ({ h: window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1 }))
      // TIMEOUT LARGE (2026-07-29). Le défaut par défaut est de 30 s, et il est TOMBÉ deux fois
      // sur cette machine — sur deux scènes différentes, donc ce n'est pas la scène : c'est
      // SwiftShader (aucun GPU ici) qui met parfois plus de trente secondes à rendre une frame
      // dense pour la relecture. Une série de neuf prises qui meurt à la deuxième coûte huit
      // minutes ; quatre-vingt-dix secondes d'attente ne coûtent rien quand tout va bien.
      await page.screenshot({ path: `${OUT}/vitrine-${p.nom}.jpg`, type: 'jpeg', quality: 82, timeout: 90000 })
      console.log(`   ✓ ${p.nom.padEnd(11)} ${String(cible.kind).padEnd(15)} « ${cible.name} » — visée ${p.heure} h, PRISE À ${vue.h.toFixed(1)} h — ${p.quoi}`)
      prises++
    }
    console.log(`\n${prises}/${planche.length} prises → ${OUT}/vitrine-*.jpg`)

    // LE MONTAGE juge la VITRINE, pas une prise isolée : sous filtre, il n'a rien à dire.
    if (prisesVoulues) return

    // ── LE MONTAGE : les images DÉJÀ retenues, vues DANS le menu ────────────────────────
    // L'atelier ne s'arrête pas à la prise de vue, parce qu'une image se juge à sa place.
    // Une capture séduisante en plein écran peut buter sur le rail, écraser le titre ou
    // avaler la mention de version — et c'est le recadrage du carrousel, pas la prise, qui
    // le décide. On revient donc au menu et on regarde DEUX vues (la seconde après un pas
    // de carrousel), en 1920×1080 : la taille où la vitrine est à l'échelle 1:1.
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(BASE_URL.replace('?solo', ''), { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('.bm-vue'), null, { timeout: 30000 })
    const montage = await page.evaluate(() => {
      const v = document.querySelector('.bm-vitrine').getBoundingClientRect()
      return { vues: document.querySelectorAll('.bm-vue').length, largeur: Math.round(v.width), hauteur: Math.round(v.height) }
    })
    console.log(`\n── le montage ──\n   ${montage.vues} vues dans une fente de ${montage.largeur}×${montage.hauteur}`)
    await page.waitForTimeout(3000) // la première vue a fini son fondu d'entrée
    await page.screenshot({ path: `${OUT}/vitrine-menu-1.png` })
    await page.waitForTimeout(8000) // UN PAS de carrousel : la vue suivante a pris la place
    await page.screenshot({ path: `${OUT}/vitrine-menu-2.png` })
    console.log(`   → ${OUT}/vitrine-menu-{1,2}.png`)
  },

  /**
   * ON REVIENT AUX VALLÉES, ET ON REPART — SANS RECHARGER LA PAGE (2026-07-29)
   *
   * Le seul endroit où ce chemin se prouve. Jusqu'ici, quitter rechargeait : `WorldScene`
   * n'était donc JAMAIS entrée deux fois dans la même page, et rien n'a jamais exercé la
   * deuxième entrée. Le mode de panne n'est pas un plantage franc mais une vallée neuve qui
   * hérite de l'ancienne — Phaser réutilise l'instance de scène (72 champs de `WorldScene`
   * survivent à `create()`), et le registry appartient au JEU, pas à la scène.
   *
   * On joue donc le tour complet : Veillée → menu pause → retour au menu principal → JOUER →
   * FONDER une AUTRE case avec une AUTRE seed. Ce qui est affirmé, un fait par ligne :
   *   1. aucun rechargement (c'est TOUT l'objet du changement) ;
   *   2. le registry est vide en arrivant au menu (`resetHud`) ;
   *   3. on atterrit sur l'ACCUEIL — le SEUIL (décision d'Alexis, 2026-07-29) : quitter une
   *      Veillée ne présume pas qu'on veut en ouvrir une autre, et le bouton dit où il va ;
   *   4. l'ordre des scènes est intact — `add` empile en fin de liste, donc `ui` doit
   *      repasser après `world`, sinon le monde se dessinerait par-dessus le HUD ;
   *   5. la seconde vallée porte SA seed, et sa chronique est vierge ;
   *   6. aucune erreur de page sur tout le tour — c'est la sonde qui attrape les objets
   *      détruits qu'un champ porté ferait toucher.
   *
   * Autonome (aucun `--dev`) : rien à téléporter, rien à forcer.
   */
  async retour(page) {
    const erreurs = []
    page.on('pageerror', (e) => erreurs.push(String(e).split('\n')[0]))
    // LA SONDE À FUITES DE TEXTURES. Elle ne vise pas un bug, elle vise une FAMILLE : toute
    // couche du monde qui crée une clé de texture sans la rendre au shutdown se signale par
    // « Texture key already in use » à la deuxième partie — et rend l'art de la PREMIÈRE vallée
    // dans la seconde, en silence. C'est ainsi qu'on a trouvé `water-field` (le seul qui
    // n'avait pas de garde). Elle vaut pour la couche qu'on ajoutera demain.
    const clesReprises = []
    page.on('console', (m) => {
      const t = m.text()
      if (t.includes('Texture key already in use')) clesReprises.push(t.split(':').pop().trim())
    })

    const pret = () => page.waitForFunction(
      () => window.__BRAISES__?.scene?.registry?.get('worldReady') === true, null, { timeout: 180000 })

    await page.goto(URL) // `?solo` → case 0, seed canonique
    await pret()
    // On AGRIPPE le registry et le jeu MAINTENANT : `window.__BRAISES__.scene` va pointer sur
    // une scène détruite, et c'est justement ce qu'on veut pouvoir interroger après coup.
    await page.evaluate(() => {
      window.__REG = window.__BRAISES__.scene.registry
      window.__GAME = window.__BRAISES__.scene.game
    })
    const seed1 = await page.evaluate(() => window.__REG.get('veillee').seed)
    console.log(`\n── la première Veillée ──\n   case 0, seed ${seed1}`)

    // ── LE GESTE : ÉCHAP, puis « retour aux vallées » ──
    await page.keyboard.press('Escape')
    await page.waitForSelector('.pause-menu', { state: 'visible', timeout: 30000 })
    await page.click('.pm-quit')
    await page.waitForSelector('.bm-overlay', { timeout: 120000 })

    const auMenu = await page.evaluate(() => ({
      navigations: performance.getEntriesByType('navigation').length,
      clesRestantes: ['worldReady', 'mapData', 'chronicle', 'fog', 'veillee', 'menuOpen', 'quitMondes']
        .filter((k) => window.__REG.get(k) !== undefined),
      scenes: window.__GAME.scene.scenes.map((s) => s.sys.settings.key),
      // L'ACCUEIL se reconnaît à ses portes (JOUER / OPTIONS) ; la liste des vallées, à ses
      // lignes (`[data-row]`). On affirme LES DEUX : la bonne présente ET l'autre absente.
      accueil: Boolean(document.querySelector('[data-go="jouer"]')),
      listeVallees: Boolean(document.querySelector('[data-row]')),
    }))
    console.log('\n── de retour au menu ──')
    console.log(`   navigations depuis le début : ${auMenu.navigations}  ${auMenu.navigations === 1 ? '✔ aucun rechargement' : '!! LA PAGE A RECHARGÉ'}`)
    console.log(`   clés de HUD survivantes : ${auMenu.clesRestantes.length === 0 ? '0 ✔' : `!! ${auMenu.clesRestantes.join(', ')}`}`)
    console.log(`   on est sur l'ACCUEIL : ${auMenu.accueil && !auMenu.listeVallees ? '✔' : `!! accueil=${auMenu.accueil} listeVallées=${auMenu.listeVallees}`}`)
    console.log(`   ordre des scènes : ${auMenu.scenes.join(' → ')}`)

    // ── ON REPART, AILLEURS : JOUER → vos vallées → case 1, seed choisie ──
    const SEED2 = 424242
    await page.click('[data-go="jouer"]')
    await page.click('[data-go="vallees"]')
    await page.waitForSelector('[data-row="1"]', { timeout: 15000 })
    await page.click('[data-row="1"]')
    await page.waitForSelector('.mw-seed', { timeout: 15000 })
    await page.fill('.mw-seed', String(SEED2))
    await page.click('[data-semer="1"]')
    await pret()

    const seconde = await page.evaluate(() => ({
      slot: window.__REG.get('veillee').slot,
      seed: window.__REG.get('veillee').seed,
      chronique: (window.__REG.get('chronicle') ?? []).length,
      navigations: performance.getEntriesByType('navigation').length,
      hud: Boolean(document.querySelector('.hc')),
      voileMenu: Boolean(document.querySelector('.bm-overlay')),
    }))
    console.log('\n── la seconde Veillée, dans la même page ──')
    console.log(`   case ${seconde.slot}, seed ${seconde.seed}  ${seconde.seed === SEED2 && seconde.slot === 1 ? '✔ c’est bien celle qu’on a semée' : '!! ce n’est pas la vallée demandée'}`)
    console.log(`   chronique : ${seconde.chronique} entrée(s) ${seconde.chronique === 0 ? '✔ vierge' : '!! elle a hérité d’un récit'}`)
    console.log(`   navigations : ${seconde.navigations} ${seconde.navigations === 1 ? '✔' : '!!'}`)
    console.log(`   HUD monté : ${seconde.hud ? '✔' : '!!'} · voile du menu retiré : ${seconde.voileMenu ? '!! il traîne' : '✔'}`)
    console.log(`   textures héritées de la 1re vallée : ${clesReprises.length === 0 ? '0 ✔' : `!! ${[...new Set(clesReprises)].join(', ')} — la couche qui les crée ne les rend pas au shutdown`}`)

    await page.screenshot({ path: `${OUT}/retour-seconde-veillee.png` })
    console.log(`   → ${OUT}/retour-seconde-veillee.png`)

    // ── TROISIÈME TOUR, PAR REPRENDRE : un AUTRE deuxième démarrage ──
    // FONDER part d'une case vide, donc l'hôte n'envoie aucune chronique. REPRENDRE relit le
    // DISQUE : `msg.chronicle` arrive non vide et arme `chronicleReseedPending` — précisément
    // le champ que l'analyse des 72 donnait comme capable de faire couler le récit d'une vallée
    // dans une autre. La branche ne s'exerce que par ici.
    await page.keyboard.press('Escape')
    await page.waitForSelector('.pause-menu', { state: 'visible', timeout: 30000 })
    await page.click('.pm-quit')
    await page.waitForSelector('[data-reprendre]', { timeout: 120000 })
    await page.click('[data-reprendre]')
    await pret()

    const reprise = await page.evaluate(() => ({
      slot: window.__REG.get('veillee').slot,
      seed: window.__REG.get('veillee').seed,
      chronique: (window.__REG.get('chronicle') ?? []).length,
      navigations: performance.getEntriesByType('navigation').length,
    }))
    console.log('\n── troisième tour, par REPRENDRE (relecture disque) ──')
    console.log(`   case ${reprise.slot}, seed ${reprise.seed}  ${reprise.slot === 1 && reprise.seed === SEED2 ? '✔ c’est bien la vallée qu’on vient de quitter' : '!! ce n’est pas celle qu’on a reprise'}`)
    console.log(`   chronique relue : ${reprise.chronique} entrée(s) (celle de la case 1, pas celle de la case 0)`)
    console.log(`   navigations : ${reprise.navigations} ${reprise.navigations === 1 ? '✔' : '!!'}`)
    console.log(`   erreurs de page, tour complet : ${erreurs.length === 0 ? '0 ✔' : `!! ${erreurs.length}`}`)
    for (const e of erreurs.slice(0, 6)) console.log(`      ${e}`)
    console.log(`   textures héritées, tour complet : ${clesReprises.length === 0 ? '0 ✔' : `!! ${[...new Set(clesReprises)].join(', ')}`}`)

    return { auMenu, seconde, reprise, erreurs }
  },

  /**
   * LE RÉVEIL DU SOL (spec `cendreux.md` R14/R21/R22) — le sol creuse vers le haut, puis le
   * Cendreux s'en extrait.
   *
   * CE QU'IL PROUVE, et qu'aucun test headless ne peut prouver : que ça SE VOIT. Le reste —
   * la reconnaissance d'une émergence, les rampes, l'oubli des sites — est affirmé dans
   * `reveil-fx.test.ts`, où c'est vérifiable ; ici on regarde.
   *
   * IL APPUIE SUR LA TOUCHE, il n'attend plus la nuit — et c'est ce qui rend ce scénario
   * utilisable. La première version réunissait les trois conditions de `advanceNightHunt`
   * (acte III, `isNight`, hors bulle de feu) puis attendait un tirage à la minute, à 55 % :
   * **jusqu'à cinq minutes par tour**, et le plafond de l'acte sature après un ou deux
   * réveils (MESURÉ headless : 2 sur une nuit entière). `debug_reveil` plante un VRAI réveil
   * — mêmes constantes, même `state.reveils`, même chaîne jusqu'au Cendreux — et ne
   * court-circuite que le tirage. On ne fabrique donc toujours aucun état : la sim plante,
   * le harnais LIT.
   *
   * ON FIGE PAR UN CROCHET SUR LA FABRIQUE, jamais par un sondage : le réveil dure 4 s et le
   * rendu logiciel affame un `setInterval` (voir plus bas, c'est mesuré). Puis on avance par
   * `game.step` — la boucle DORT, seules de vraies frames redessinent.
   *
   * Exige `--dev` : `debug_reveil`, `debug_set_hour` et `debug_god` sont inertes en production.
   */
  async reveil(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 90000 })

    // LA NUIT, parce que c'est là que ça se joue et que la lumière fait partie de ce qu'on
    // juge. L'acte, lui, n'a plus d'importance : on ne passe plus par le tirage de la nuit.
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.sendAction({ type: 'debug_god', on: true }) // on vient REGARDER, pas mourir
      s.sendAction({ type: 'debug_set_hour', hour: 1 })
    })
    await page.waitForTimeout(800)

    // LE FEU RESTE LA SEULE PORTE QUI COMPTE : `advanceReveils` étouffe un réveil dès qu'un
    // feu actif est à `HEARTH_WARD_RADIUS` (12 t), touche de debug ou pas. On le mesure, pour
    // ne pas se retrouver à chercher pourquoi rien ne sort alors que la parade a gagné.
    const etat = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const px = s.predicted.x
      const py = s.predicted.y
      let best = null
      for (const st of s.view.structures) {
        if (st.type !== 'fire') continue
        const d = Math.hypot(st.tx - px, st.ty - py)
        if (!best || d < best.d) best = { d: +d.toFixed(1), tx: st.tx, ty: st.ty }
      }
      const t = s.lastTime
      return {
        joueur: { x: Math.round(px), y: Math.round(py) },
        feuLePlusProche: best,
        ...(t ? { acte: t.act, jour: t.seasonDay, heure: +t.hourOfCycle.toFixed(1), nuit: t.isNight } : {}),
      }
    })
    console.log(`cadre : ${JSON.stringify(etat)}`)
    if (!etat.nuit) console.log(`   ⓘ il fait jour (${etat.heure}h) — le réveil marchera, mais on le verra mal`)
    if (etat.feuLePlusProche && etat.feuLePlusProche.d < 12) {
      console.log(`   ✗ un feu à ${etat.feuLePlusProche.d} t : il ÉTOUFFERA le réveil (HEARTH_WARD_RADIUS)`)
    }

    // ── LE CROCHET, PAS LE GUET ───────────────────────────────────────────────────────
    //
    // PREMIÈRE VERSION, ET POURQUOI ELLE A ÉCHOUÉ : un `setInterval(16 ms)` dans la page,
    // qui sondait `solsAuTravail`. MESURÉ sur 352 s, il n'a rendu que TROIS relevés — à 8 s,
    // 52 s et 352 s : le rendu logiciel l'affamait. Un réveil dure quatre secondes ; un guet
    // qui s'éveille trois fois en six minutes ne peut structurellement pas l'attraper, et
    // son silence se lit exactement comme « la sim n'a rien planté ».
    //
    // On s'accroche donc à la FABRIQUE — l'idiome de `chute` et d'`eclats`. `suivre` est
    // appelée par `view.apply`, SYNCHRONEMENT avec le snapshot qui porte le réveil : le
    // crochet ne peut pas manquer la fenêtre, quelle que soit la charge du rendu. Il fige
    // sur-le-champ, et Node n'a plus qu'à ramasser à son rythme.
    //
    // ET ON GARDE LA VITESSE NORMALE : la fenêtre à attraper est le réveil lui-même, et
    // accélérer l'hôte ne ferait que la rétrécir.
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      window.__PROBE__ = { sol: null, sortie: null }
      const vraiSuivre = s.reveilFx.suivre.bind(s.reveilFx)
      s.reveilFx.suivre = (reveils, tick, now) => {
        vraiSuivre(reveils, tick, now)
        if (reveils.length > 0 && !window.__PROBE__.sol) {
          window.__PROBE__.sol = { sols: reveils.length, tick, x: reveils[0].x, y: reveils[0].y, at: reveils[0].at }
          s.reveilFx.suivre = vraiSuivre
          s.game.loop.sleep() // FIGÉ au premier snapshot qui le porte
        }
      }
      // Le second crochet arme la SORTIE, pour la même raison : l'extraction ne dure que
      // 900 ms, et elle arrive pendant qu'on photographie le tertre.
      const vraiEmerger = s.reveilFx.emerger.bind(s.reveilFx)
      s.reveilFx.emerger = (x, y, id, now) => {
        const r = vraiEmerger(x, y, id, now)
        if (r && !window.__PROBE__.sortie) {
          window.__PROBE__.sortie = { id, x, y }
          s.reveilFx.emerger = vraiEmerger
          s.game.loop.sleep()
          // ET ON REMET LE MONDE EN PAUSE. Sans ça, la sim continue de tourner pendant qu'on
          // photographie : CONSTATÉ, le Cendreux avait MARCHÉ de quatre tuiles entre la
          // première et la deuxième image — on le voyait sortir à côté de son propre trou.
          // La boucle de rendu, elle, dort déjà : ce sont deux horloges, il faut les deux.
          s.send({ type: 'pause' })
        }
        return r
      }
    })

    // ── ON APPUIE ─────────────────────────────────────────────────────────────────────
    // La touche F6 du mode debug, par son action. Le réveil est planté au tick suivant, et
    // le crochet fige dessus.
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_reveil' }))

    const debut = Date.now()
    let attrape = null
    while (Date.now() - debut < 20000 && !attrape) {
      await page.waitForTimeout(200)
      attrape = await page.evaluate(() => window.__PROBE__?.sol ?? null)
    }

    if (!attrape) {
      console.log('   ✗ `debug_reveil` n’a rien planté — sim pas en debug (--dev ?), ou aucun sol praticable autour')
      return { attrape: null }
    }
    console.log(`   ✓ le sol travaille : ${JSON.stringify(attrape)}`)

    // ON CADRE PAR LA CAMÉRA, PAS PAR LE JOUEUR — et c'est la deuxième leçon de cet
    // instrument.
    //
    // ① Une première version téléportait l'avatar sur le tertre APRÈS avoir mis la sim en
    //    pause : `debug_teleport` est une action de SIM (`debug.ts` — « la sim est
    //    autoritative »), un hôte en pause ne l'applique jamais, et la capture montrait une
    //    forêt vide à cinq tuiles du sujet.
    // ② Téléporter AVANT la pause marchait, mais coûtait un aller-retour de snapshot :
    //    MESURÉ, **1,9 s de rampe consommée** pendant l'attente, soit deux des quatre crans
    //    déjà passés avant la première photo. Le tertre était bien là, et on en ratait la
    //    moitié.
    //
    // La caméra, elle, est PUREMENT du rendu : `stopFollow` + `centerOn` sont immédiats, ne
    // traversent pas la sim et ne consomment pas un millième de la rampe.
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const p = window.__PROBE__.sol
      const cam = s.cameras.main
      cam.stopFollow()
      cam.setZoom(4) // un tertre fait 24 px : à l'échelle du jeu, de nuit, il n'y a rien à juger
      cam.centerOn(p.x * 16, p.y * 16)
      s.send({ type: 'pause' }) // le monde s'arrête : le Cendreux ne sortira pas pendant la séance
      // ON PREND LA MAIN SUR L'HORLOGE. La boucle dort, mais `s.time.now` continue de suivre
      // le temps RÉEL — et chaque capture d'écran en coûte plusieurs centaines. Sans horloge
      // à nous, la rampe avancerait entre deux photos et on sauterait des crans sans le voir.
      // `game.step(t, dt)` POSE le temps de la boucle : à partir d'ici, il n'avance que
      // lorsqu'on le décide.
      window.__PROBE__.t = s.time.now
      // UNE FRAME POUR QUE LE RECADRAGE EXISTE. `setZoom`/`centerOn` ne changent rien tant
      // que rien n'est redessiné, et la boucle dort. Sans elle, une capture prise avant le
      // premier `step` rendait l'image d'AVANT — cadre large, sujet à cinq tuiles : le cran 0
      // a été photographié comme ça, et il ne montrait rien.
      s.game.step((window.__PROBE__.t += 16), 16)
    })
    const site = await page.evaluate(() => {
      const p = window.__PROBE__.sol
      return { x: p.x, y: p.y, tick: p.tick, at: p.at }
    })
    console.log(`   site : ${JSON.stringify(site)}`)

    // ── LES CRANS DU SOL, PUIS LA SORTIE ──────────────────────────────────────────────
    //
    // ON PART DU CRAN OÙ L'ON EST, PAS DE ZÉRO — et il faut le dire franchement : entre le
    // snapshot qui porte le réveil et l'instant où l'on prend la main sur l'horloge, il passe
    // des allers-retours Playwright et un `pause`. MESURÉ : **~1,2 s des 4 s de rampe**, soit
    // le premier cran déjà consommé. C'est une limite de l'INSTRUMENT, pas du jeu — que les
    // quatre crans existent et se suivent est affirmé par `reveil-fx.test.ts`, qui les balaie
    // tous. Ici on photographie ce qui reste, et on annonce ce qu'on a manqué.
    const depart = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const m = s.reveilFx.monticules(window.__PROBE__.t)[0]
      return m ? m.stade : null
    })
    if (depart > 0) console.log(`   ⓘ crans 0→${depart - 1} consommés par la latence du harnais (~${(depart * 1000) / 4} ms) — voir reveil-fx.test.ts`)
    const crans = []
    for (let cible = depart; cible < 4; cible++) {
      const releve = await page.evaluate((cible) => {
        const s = window.__BRAISES__.scene
        // De VRAIES frames, sur NOTRE horloge, jusqu'au cran visé (ou l'épuisement).
        for (let i = 0; i < 400; i++) {
          const m = s.reveilFx.monticules(window.__PROBE__.t)[0]
          if (m && m.stade >= cible) {
            return { stade: m.stade, echelle: +m.echelle.toFixed(3), alpha: +m.alpha.toFixed(2), grains: s.reveilFx.grainsVivants }
          }
          s.game.step((window.__PROBE__.t += 40), 40)
        }
        return null
      }, cible)
      crans.push(releve)
      if (releve) {
        await page.screenshot({ path: `${OUT}/reveil-cran-${cible}.png` })
        console.log(`   · cran ${cible} : ${JSON.stringify(releve)} → ${OUT}/reveil-cran-${cible}.png`)
      } else {
        console.log(`   ✗ cran ${cible} : jamais atteint`)
      }
    }
    const vus = crans.filter(Boolean)
    const echelles = vus.map((c) => c.echelle)
    console.log(vus.length >= 2 && echelles.every((e, i) => i === 0 || e > echelles[i - 1])
      ? `   ✓ le tertre POUSSE sans pulser, sur ${vus.length} crans : ${echelles.join(' → ')}`
      : `   ✗ l’échelle du tertre ne monte pas : ${echelles.join(' → ')}`)
    console.log(crans.some((c) => c && c.grains > 0)
      ? `   ✓ la terre est projetée (${Math.max(...crans.filter(Boolean).map((c) => c.grains))} grains au plus fort)`
      : `   ✗ aucun grain de terre : le sol se fend en silence`)

    // ── IL SORT ───────────────────────────────────────────────────────────────────────
    // On rend la main au MONDE (la sim était en pause) et à l'horloge du rendu. Le crochet
    // posé sur `emerger` refigera de lui-même : l'extraction ne dure que 900 ms, et c'est la
    // même raison qui interdisait le sondage pour le tertre.
    //
    // ON RETIENT L'ID, PAS LE COMPTE : à l'acte III il y a jusqu'à cinq Cendreux autour de la
    // proie (`UNDEAD_MAX_ALIVE[2]`), et « le dernier `spr-cendreux` de la boucle » n'est pas
    // celui qui sort du sol — le relevé aurait porté sur un corps qui marche depuis
    // longtemps.
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.game.loop.wake()
      s.send({ type: 'resume' })
    })
    let sortie = null
    const debutSortie = Date.now()
    while (Date.now() - debutSortie < 30000 && !sortie) {
      await page.waitForTimeout(500)
      sortie = await page.evaluate(() => window.__PROBE__?.sortie ?? null)
    }
    if (!sortie) {
      console.log('   ✗ personne n’est sorti du sol en 30 s')
      return { attrape, site, crans }
    }
    console.log(`   ✓ il sort : entité ${sortie.id} en ${sortie.x.toFixed(1)},${sortie.y.toFixed(1)}`)

    // TROIS INSTANTS DE L'EXTRACTION — enfoui, à mi-corps, posé. On lit la COUPE réelle du
    // sprite (`isCropped` + la hauteur de la découpe), pas la seule valeur d'enfouissement :
    // une rampe juste qui n'atteindrait pas le sprite ne se verrait pas davantage.
    const releves = []
    // Les `dt` sont CUMULATIFS (chaque relevé repart de l'instant courant) : 40 → 440 → 940 ms
    // après la sortie. Le premier n'est pas à ZÉRO, et c'est délibéré : à dt = 0 aucune frame
    // n'a été rendue depuis l'émergence, donc le sprite porte encore l'état que `syncEntities`
    // lui a donné à sa CRÉATION — on lirait le cadre d'avant, pas l'extraction.
    for (const [nom, dt] of [['enfoui', 40], ['mi-corps', 400], ['sorti', 500]]) {
      const r = await page.evaluate(({ dt, id }) => {
        const s = window.__BRAISES__.scene
        // On se recale sur le temps réel UNE SEULE FOIS — le monde vient de tourner pour
        // faire sortir le Cendreux. Ensuite l'horloge est de nouveau la nôtre, sans quoi les
        // captures d'écran (des centaines de ms chacune) mangeraient l'extraction entre deux
        // relevés : c'est exactement ce qui avait dévoré deux crans du tertre.
        if (!window.__PROBE__.tSortie) window.__PROBE__.t = window.__PROBE__.tSortie = s.time.now
        let t = 0
        while (t < dt) { t += 40; s.game.step((window.__PROBE__.t += 40), 40) }
        const o = s.view.others.get(id)
        if (!o) return { id, absent: true }
        const f = o.sprite.frame
        // ON LIT LA COUPE RÉELLE DU SPRITE, pas la seule valeur d'enfouissement : une rampe
        // juste qui n'atteindrait pas le sprite ne se verrait pas davantage. Les deux
        // nombres bruts sont rendus aussi — un arrondi à zéro texel doit se voir comme tel,
        // pas se déguiser en « il est sorti ».
        return {
          id,
          enfoui: +s.reveilFx.sols.enfouissementDe(id, window.__PROBE__.t).toFixed(3),
          texture: o.textureKey,
          cropH: o.sprite.isCropped ? o.sprite._crop.height : null,
          frameH: f.height,
          coupe: o.sprite.isCropped ? +(1 - o.sprite._crop.height / f.height).toFixed(3) : 0,
          ombre: +(o.shadow?.alpha ?? -1).toFixed(3),
          y: Math.round(o.sprite.y),
        }
      }, { dt, id: sortie.id })
      releves.push({ nom, ...r })
      await page.screenshot({ path: `${OUT}/reveil-sortie-${nom}.png` })
      console.log(`   · ${nom} : ${JSON.stringify(r)} → ${OUT}/reveil-sortie-${nom}.png`)
    }
    const [a, b, c] = releves
    console.log(a?.coupe > 0.8 && b?.coupe > 0.2 && b?.coupe < 0.8 && (c?.coupe ?? 1) < 0.05
      ? `   ✓ le corps SORT du sol : coupe ${a.coupe} → ${b.coupe} → ${c.coupe}`
      : `   ✗ la coupe ne suit pas l’extraction : ${releves.map((r) => `${r.nom}=${r.coupe}`).join(' ')}`)
    console.log(a?.ombre >= 0 && a.ombre < (c?.ombre ?? 0)
      ? `   ✓ l’ombre de contact se fond sous terre puis revient (${a.ombre} → ${c.ombre})`
      : `   ✗ l’ombre ne suit pas l’enfouissement (${a?.ombre} → ${c?.ombre})`)

    return { attrape, site, crans, sortie, releves }
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
