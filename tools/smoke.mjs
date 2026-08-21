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
  // 90 s comme toute capture : le rendu logiciel de cette machine met parfois
  // au-delà des 30 s par défaut à composer une frame stable (mesuré, scénario sang).
  const png = await page.screenshot({ timeout: 90000, clip: { x: Math.max(0, x), y: Math.max(0, y), width: 1, height: 1 } })
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

/**
 * UNE RÉGION ENTIÈRE DE L'ÉCRAN, DÉCODÉE — `{ w, h, px(x, y) → [r,v,b] }`, coordonnées
 * RELATIVES au découpage.
 *
 * `pixelAt` ne sait lire qu'un point, et c'est assez pour comparer deux surfaces. Ça ne l'est
 * plus pour un TRAIT : un contour d'un pixel d'art (2,5 px d'écran au zoom du jeu) ne se prouve
 * pas en visant un point — on ne sait pas d'avance OÙ tombe la frange, puisqu'elle épouse la
 * silhouette du sprite et non son cadre. Il faut donc COMPTER sur une surface.
 *
 * Le décodage est complet ici (là où `pixelAt` s'en tire avec le premier pixel) : filtres PNG
 * des cinq types, appliqués ligne à ligne. Chromium écrit du RGBA 8 bits non entrelacé ; on
 * refuse tout le reste plutôt que de rendre des couleurs fausses.
 */
async function regionAt(page, clip) {
  const png = await page.screenshot({ timeout: 90000, clip }) // 90 s : cf. pixelAt
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  if (png[24] !== 8 || (png[25] !== 6 && png[25] !== 2) || png[28] !== 0) return null
  const canaux = png[25] === 6 ? 4 : 3
  let i = 8
  const morceaux = []
  while (i + 8 <= png.length) {
    const len = png.readUInt32BE(i)
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') morceaux.push(png.subarray(i + 8, i + 8 + len))
    if (png.toString('ascii', i + 4, i + 8) === 'IEND') break
    i += 12 + len
  }
  if (morceaux.length === 0) return null
  const brut = inflateSync(Buffer.concat(morceaux))
  const pas = w * canaux
  const out = Buffer.alloc(h * pas)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filtre = brut[p++]
    for (let k = 0; k < pas; k++) {
      const x = brut[p + k]
      const a = k >= canaux ? out[y * pas + k - canaux] : 0
      const b = y > 0 ? out[(y - 1) * pas + k] : 0
      const c = k >= canaux && y > 0 ? out[(y - 1) * pas + k - canaux] : 0
      let v
      if (filtre === 0) v = x
      else if (filtre === 1) v = x + a
      else if (filtre === 2) v = x + b
      else if (filtre === 3) v = x + ((a + b) >> 1)
      else if (filtre === 4) {
        const q = a + b - c
        const da = Math.abs(q - a)
        const db = Math.abs(q - b)
        const dc = Math.abs(q - c)
        v = x + (da <= db && da <= dc ? a : db <= dc ? b : c)
      } else return null
      out[y * pas + k] = v & 255
    }
    p += pas
  }
  return { w, h, px: (x, y) => [out[y * pas + x * canaux], out[y * pas + x * canaux + 1], out[y * pas + x * canaux + 2]] }
}

/** L'écart de LUMINANCE entre deux points de l'écran — le nombre qui tranche « on le voit ». */
async function mesurerContraste(page, a, b) {
  const pa = await pixelAt(page, a.x, a.y)
  const pb = await pixelAt(page, b.x, b.y)
  if (!pa || !pb) return null
  const lum = ([r, v, bl]) => 0.2126 * r + 0.7152 * v + 0.0722 * bl
  return { fantome: pa, fond: pb, dLum: Number((lum(pa) - lum(pb)).toFixed(1)) }
}

/**
 * FONDER UN VILLAGE PRÈS DE SOI, ET RENDRE LE FEU QU'ON A VRAIMENT ALLUMÉ.
 *
 * Quatre scénarios recopiaient cette recette (`finale`, `porte`, `porte-double`, `arete`) ;
 * elle n'a plus qu'une définition, parce que la copie portait une COURSE — mesurée le
 * 2026-08-03, elle faisait rougir `porte-double` deux fois sur trois.
 *
 * ── LE PIÈGE, ET POURQUOI IL NE SE VOYAIT PAS ──
 *
 * La fondation se déclarait réussie sur `registry.get('village') > 0`, lu après une attente
 * FIXE de 420 ms. Or cette clé est le NOMBRE DE MEMBRES du village auquel j'appartiens —
 * pas « MA fondation, à CET offset, a pris ». Quand le snapshot arrivait en retard, la
 * boucle croyait avoir échoué et passait à l'offset suivant, 24 tuiles plus loin, où elle
 * posait un SECOND feu ; `found_village` y était un non-événement (on est déjà membre),
 * mais le compte avait rattrapé son retard entre-temps — donc la boucle sortait, satisfaite,
 * avec les coordonnées du MAUVAIS site. Tout ce qu'on bâtissait ensuite tombait « hors du
 * carré du Feu » sans qu'aucune trace ne le dise, et le scénario mourait sur un « rien à
 * mesurer » qui accusait la porte double alors que le fautif était la fondation.
 *
 * ── DEUX VERROUS, ET IL FAUT LES DEUX ──
 *
 * ① **ON ATTEND LE VILLAGE AU LIEU DE DORMIR** : scrutation jusqu'à 3 s, au lieu d'un pari
 *    sur 420 ms. C'est ce qui évite d'aller allumer un feu inutile à 24 tuiles.
 * ② **L'ADRESSE VIENT DE LA SIM, JAMAIS DE CE QU'ON VISAIT** : `bx,by` se dérive du feu que
 *    la sim me reconnaît (`memberIds.includes(playerId)`), pas de l'offset qu'on essayait.
 *    Seul ce verrou-là rend l'erreur IMPOSSIBLE plutôt que rare — ① ne fait que rétrécir la
 *    fenêtre, et une fenêtre rétrécie est une course qui reviendra sur une machine chargée.
 *
 * Rend `{ village, bx, by }` — le feu occupe `(bx + 1, by)`, l'ancre que les quatre
 * appelants attendent — ou `null` si aucun des sept sites n'a pris.
 *
 * ⚠ LES TROIS CHAMPS VIENNENT DE LA MÊME SOURCE, et c'est délibéré : rendre l'id du feu
 * qu'on vient de POSER à côté de coordonnées lues sur le village REconnu rouvrirait la
 * même faille d'un cran plus bas — si la scrutation expire au premier site alors que la
 * fondation y avait pris, le second site pose un feu qui n'appartient à personne, et on
 * rendrait son id avec l'adresse de l'autre. Un seul témoin, donc : `v`.
 */
const SITES_FONDATION = [[0, 0], [-24, 0], [24, 0], [0, -24], [0, 24], [-48, 0], [48, 0]]

async function fonderPres(page, agir, slotDe, p0, sites = SITES_FONDATION) {
  const monFeu = () => page.evaluate(() => {
    const sc = window.__BRAISES__.scene
    const v = (sc.view.villages ?? []).find((q) => q.memberIds.includes(sc.playerId))
    return v ? { id: v.id, tx: v.fireTx, ty: v.fireTy } : null
  })
  for (const [ox, oy] of sites) {
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
    await agir({ type: 'found_village', structureId: id }, 200)
    for (let essai = 0; essai < 20; essai++) {
      const v = await monFeu()
      if (v) return { village: v.id, bx: v.tx - 1, by: v.ty }
      await page.waitForTimeout(150)
    }
  }
  return null
}

const SCENARIOS = {
  /**
   * LA FRONTIÈRE DE CONSTRUCTION (2026-08-04) — le carré du Feu se voit, marteau en main.
   *
   * L'instrument est un PROFIL, pas un point : un liseré d'un pixel d'art (2,5 px d'écran)
   * ne se prouve pas en visant une coordonnée — on relève une TRANCHE horizontale de part
   * et d'autre du bord, marteau rangé puis sorti, et on lit où la lumière change.
   *
   * ET IL VÉRIFIE LE DÉFAUT QUI A TOUT DÉCLENCHÉ : le fantôme restait VERT hors du carré
   * (`placeable()` ne testait pas le domaine), on cliquait, la sim refusait en
   * `out_of_square`, et rien à l'écran ne l'avait annoncé. On vise donc la DERNIÈRE tuile
   * légale puis la PREMIÈRE interdite, les deux à portée de bras (2,5 et 3,5 tuiles, quand
   * `BUILD_RANGE` vaut 6) : seul le carré peut expliquer que la teinte bascule.
   *
   * Exige `--dev` : la fondation passe par `debug_teleport` / `debug_grant`, inertes dans un
   * build de production. Sans lui, les sept sites échouent et le scénario dit « aucun village
   * fondé » — ce n'est pas le jeu qui casse, c'est le mode debug qui manque.
   */
  async frontiere(page) {
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

    const assise = await fonderPres(page, agir, slotDe, await pos())
    if (assise === null) { console.error('!! aucun village fondé — pas de carré à montrer'); return }
    const feu = { x: assise.bx + 1, y: assise.by }
    const R = 10
    const bordEst = feu.x + R + 1
    console.log(`\nLe Feu est en (${feu.x}, ${feu.y}) — la frontière EST court sur x = ${bordEst}.`)

    await agir({ type: 'debug_teleport', x: feu.x + 7.5, y: feu.y + 0.5 }, 500)
    for (let i = 0; i < 6; i++) await agir({ type: 'debug_grant', item: 'wood' }, 80)
    await agir({ type: 'debug_grant', item: 'hammer' }, 200)
    const hslot = await slotDe('hammer')
    if (hslot < 0 || hslot >= 6) { console.error(`!! marteau hors ceinture (case ${hslot})`); return }

    /** Tuile (continue) → pixel écran. */
    const versEcran = (tx, ty) => page.evaluate(({ x, y }) => {
      const scene = window.__BRAISES__.scene
      const cam = scene.cameras.main
      const gx = (x * 16 - cam.worldView.x) * cam.zoom
      const gy = (y * 16 - cam.worldView.y) * cam.zoom
      const c = scene.scale.canvas.getBoundingClientRect()
      return { x: Math.round(c.left + gx * (c.width / scene.scale.width)), y: Math.round(c.top + gy * (c.height / scene.scale.height)) }
    }, { x: tx, y: ty })

    const lum = ([r, v, b]) => 0.2126 * r + 0.7152 * v + 0.0722 * b
    const bord = await versEcran(bordEst, feu.y + 0.5)
    // LE SECOND TRAIT : le carré RÉSERVÉ (R_max = le dernier palier de FIRE_RADIUS_BY_TIER).
    const RMAX = 16
    const reserve = await versEcran(feu.x + RMAX + 1, feu.y + 0.5)
    const X0 = bord.x - 40
    const LARGE = 80
    const Y = bord.y - 60 // une bande d'herbe nue, à l'écart de l'avatar et du HUD
    /**
     * Le profil de luminance sur une tranche, centré sur `cx`. La tranche fait 3 px de HAUT
     * seulement : le liseré est un pointillé (10 px de trait sur les 16 de la tuile), et une
     * tranche haute moyennerait le tiret avec son vide — c'est-à-dire l'effacerait.
     */
    const profilA = async (cx, large = LARGE, ligne = Y) => {
      const r = await regionAt(page, { x: cx - large / 2, y: ligne, width: large, height: 3 })
      if (!r) return null
      const out = []
      for (let x = 0; x < large; x++) {
        let s = 0
        for (let y = 0; y < 3; y++) s += lum(r.px(x, y))
        out.push(s / 3)
      }
      return out
    }
    const profil = () => profilA(bord.x)

    const dedansDe = (a) => a.slice(0, 36).reduce((s, v) => s + v, 0) / 36
    const dehorsDe = (a) => a.slice(44).reduce((s, v) => s + v, 0) / (LARGE - 44)

    /**
     * LE MÊME RELEVÉ À UNE HEURE DONNÉE — marteau rangé, puis sorti.
     *
     * ON MESURE AUSSI DE NUIT, et pas par acquit de conscience : le dehors s'éteint en
     * `MULTIPLY`, or le voile de nuit multiplie DÉJÀ tout l'écran. Deux multiplications
     * se composent — c'est justement ce qui garantit qu'elles ne s'écrasent pas l'une
     * l'autre, mais le rapport doit rester LE MÊME de jour comme de nuit, et le liseré
     * doit survivre au voile (il est posé au-dessus, exprès : une affordance de pose ne
     * s'éteint pas à la tombée du jour). Un rapport qui dériverait de nuit dirait que le
     * dehors est en train de tomber dans la boue.
     */
    const releve = async (heure, etiquette) => {
      await agir({ type: 'debug_set_hour', hour: heure }, 500)
      await agir({ type: 'set_active_slot', slot: -1 }, 400)
      await page.waitForTimeout(500)
      const range = await profil()
      await page.screenshot({ path: `${OUT}/frontiere-0-range-${etiquette}.png` })
      await agir({ type: 'set_active_slot', slot: hslot }, 500)
      await page.waitForTimeout(700)
      const sorti = await profil()
      await page.screenshot({ path: `${OUT}/frontiere-1-lisere-${etiquette}.png` })
      if (!range || !sorti) { console.error(`!! relevé impossible à ${heure} h`); return null }

      console.log(`\n── ${etiquette.toUpperCase()} (${heure} h) — PROFIL sur ${LARGE} px, la frontière au milieu (x=${bord.x}) ──`)
      console.log('   décalage    rangé   sorti   rapport')
      for (let i = 0; i < LARGE; i += 4) {
        const d = X0 + i - bord.x
        const marque = Math.abs(d) <= 2 ? '  ← LA FRONTIÈRE' : ''
        console.log(`   ${String(d).padStart(4)} px   ${range[i].toFixed(0).padStart(5)}   ${sorti[i].toFixed(0).padStart(5)}   ${(sorti[i] / Math.max(1, range[i])).toFixed(2)}${marque}`)
      }
      const pic = sorti.map((v, i) => v - range[i])
      const iPic = pic.indexOf(Math.max(...pic))
      console.log(`\n   dedans : ${dedansDe(range).toFixed(1)} → ${dedansDe(sorti).toFixed(1)}  (×${(dedansDe(sorti) / dedansDe(range)).toFixed(2)})`)
      console.log(`   dehors : ${dehorsDe(range).toFixed(1)} → ${dehorsDe(sorti).toFixed(1)}  (×${(dehorsDe(sorti) / dehorsDe(range)).toFixed(2)})`)
      console.log(`   le PIC clair est à ${X0 + iPic - bord.x} px de la frontière (+${pic[iPic].toFixed(1)} de luminance) — le liseré.`)
      return { range, sorti, rapport: dehorsDe(sorti) / dehorsDe(range), pic: pic[iPic] }
    }

    const jour = await releve(11, 'jour')

    // ── LE SECOND TRAIT existe-t-il vraiment ? Même méthode, autre abscisse : le carré
    // RÉSERVÉ tombe DEHORS, donc sous l'extinction — il doit rester lisible malgré elle,
    // sinon la promesse « voilà jusqu'où le carré ira » n'est pas tenue à l'écran.
    //
    // ⚠ LA LIGNE DESCEND SOUS LE BROUILLARD. Relevée à la même hauteur que le liseré, elle
    // traversait la LISIÈRE DE BROUILLARD (le second trait est à 16 tuiles du Feu, en terrain
    // non découvert) : le brouillard se lève entre les deux captures, et l'écart mesurait sa
    // levée — +64 de « liseré » qui n'était pas le liseré. On relève plus bas, en herbe nue.
    const LIGNE_RESERVE = bord.y + 80
    await agir({ type: 'set_active_slot', slot: -1 }, 400)
    await page.waitForTimeout(400)
    const resSans = await profilA(reserve.x, 40, LIGNE_RESERVE)
    await agir({ type: 'set_active_slot', slot: hslot }, 400)
    await page.waitForTimeout(600)
    const resAvec = await profilA(reserve.x, 40, LIGNE_RESERVE)
    if (resSans && resAvec) {
      const ecart = resAvec.map((v, i) => v - resSans[i] * (jour ? jour.rapport : 1))
      const iMax = ecart.indexOf(Math.max(...ecart))
      console.log(`\n── LE CARRÉ RÉSERVÉ (R${RMAX}, écran x=${reserve.x}) ──`)
      console.log(`   pic à ${iMax - 20} px du trait attendu, +${ecart[iMax].toFixed(1)} de luminance par-dessus l'extinction`)
      console.log(`   (un pic sous +2 dirait que le second trait ne se voit pas)`)
    }

    const etat = await page.evaluate(() => ({
      marteau: window.__BRAISES__.scene.registry.get('marteau') ?? null,
      selected: window.__BRAISES__.scene.registry.get('selected') ?? null,
      rangees: [...document.querySelectorAll('.cat-l')].map((l) => (l.querySelector('.cat-nom')?.textContent ?? '').trim()),
    }))
    console.log(`\nmarteau=${etat.marteau}  armée=${etat.selected}  menu=[${etat.rangees.join(' | ')}]`)
    const nuit = await releve(0, 'nuit')
    if (jour && nuit) {
      console.log(`\n── JOUR CONTRE NUIT ────────────────────────────────────────────────`)
      console.log(`   le dehors s'éteint de ×${jour.rapport.toFixed(2)} le jour, ×${nuit.rapport.toFixed(2)} la nuit (écart ${Math.abs(jour.rapport - nuit.rapport).toFixed(2)})`)
      console.log(`   le liseré ressort de +${jour.pic.toFixed(1)} le jour, +${nuit.pic.toFixed(1)} la nuit`)
    }
    const range = jour?.range ?? null
    await agir({ type: 'debug_set_hour', hour: 11 }, 400)
    await agir({ type: 'set_active_slot', slot: hslot }, 400)

    // ── LE TAPIS : armer par le VRAI menu (les rangées viennent d'être listées).
    const armer = async (nom) => {
      await page.evaluate(() => { const a = document.querySelector('.cat-l.cat-armee'); if (a) a.click() })
      await page.waitForTimeout(150)
      const ok = await page.evaluate((n) => {
        const l = [...document.querySelectorAll('.cat-l')].find((q) => (q.querySelector('.cat-nom')?.textContent ?? '').trim() === n)
        if (!l) return false
        l.click()
        return true
      }, nom)
      await page.waitForTimeout(450)
      return ok ? page.evaluate(() => window.__BRAISES__.scene.registry.get('selected') ?? null) : `rangée « ${nom} » absente`
    }
    const sol = await armer('Sol')
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/frontiere-2-tapis-sol.png` })
    const mur = await armer('Mur')
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/frontiere-3-tapis-mur.png` })
    console.log(`\ntapis : « Sol » → selected=${sol} ; « Mur » → selected=${mur}`)

    // ── LE FANTÔME CONNAÎT-IL LE CARRÉ ? (le défaut d'origine) ──────────────────
    //
    // On lit `tintTopLeft` — l'INTENTION du fantôme — et la tuile RÉELLEMENT visée, sans
    // quoi on jugerait une couleur sur une tuile qu'on n'a peut-être jamais atteinte.
    const OK_TINT = 0x9adf7a
    const BAD_TINT = 0xd9614f
    const viser = async (tx, ty) => {
      const c = await versEcran(tx + 0.5, ty + 0.5)
      await page.mouse.move(c.x - 24, c.y - 24)
      await page.mouse.move(c.x, c.y, { steps: 4 })
      await page.waitForTimeout(260)
      return page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const s = sc.buildGhost?.sprite
        const a = sc.inputs?.aim?.(sc.input.activePointer) ?? null
        return s ? { tint: s.tintTopLeft, visible: s.visible, vise: a ? { tx: a.tx, ty: a.ty } : null } : null
      })
    }
    const derniere = await viser(feu.x + R, feu.y)       // Chebyshev = 10 : DEDANS, la dernière
    const premiere = await viser(feu.x + R + 1, feu.y)   // Chebyshev = 11 : DEHORS, la première
    const nom = (t) => (t === OK_TINT ? 'VERT' : t === BAD_TINT ? 'ROUGE' : `0x${(t ?? 0).toString(16)}`)
    console.log(`\n── LE FANTÔME AU BORD (mur armé, les deux tuiles à portée de bras) ──`)
    for (const [quoi, r, attendu] of [['dernière tuile DEDANS', derniere, OK_TINT], ['première tuile DEHORS', premiere, BAD_TINT]]) {
      if (!r) { console.error(`!! ${quoi} : pas de fantôme`); continue }
      const juste = r.tint === attendu ? '✓' : '✗ ATTENDU ' + nom(attendu)
      console.log(`   ${quoi} : visée (${r.vise?.tx}, ${r.vise?.ty}) → ${nom(r.tint)}  ${juste}`)
    }
    await page.screenshot({ path: `${OUT}/frontiere-5-fantome-dehors.png` })

    await agir({ type: 'set_active_slot', slot: -1 }, 500)
    await page.waitForTimeout(600)
    const apresRangement = await profil()
    if (range && apresRangement) {
      const d = apresRangement.slice(44).reduce((s, v) => s + v, 0) / (LARGE - 44)
      const r0 = range.slice(44).reduce((s, v) => s + v, 0) / (LARGE - 44)
      console.log(`\nmarteau rangé → le dehors revient à ${d.toFixed(1)} (départ ${r0.toFixed(1)}, écart ${(d - r0).toFixed(1)})`)
    }
    await page.screenshot({ path: `${OUT}/frontiere-4-range.png` })
  },

  /**
   * LE DÉFRICHEMENT (2026-08-06, `packages/sim/src/defriche.ts`) — chez soi, ce qu'on abat
   * ne revient pas, et la place se libère POUR DE BON.
   *
   * /sim prouve la règle au tick près (`defriche.test.ts`). Ce que lui ne peut pas dire, et
   * qui est tout l'intérêt de la règle pour le joueur, c'est ce qui CHANGE À L'ÉCRAN quand
   * l'arbre tombe. Trois signaux, relevés sur la MÊME tuile avant et après :
   *
   *   ① **L'IMAGE** — le tronc disparaît du cadre. On relève un carré de pixels centré sur
   *     la tuile : un tronc sombre sur de l'herbe est un écart de luminance, pas une opinion.
   *     C'est le seul des trois qui prouve que le client applique bien le prédicat de la sim
   *     au lieu de garder un arbre fantôme (le nœud, lui, RESTE dans `view.nodes` à stock 0).
   *   ② **LA POSE** — on POSE un coffre sur cette tuile, avant et après. Refusé, puis accepté.
   *     C'était le piège de la règle : sans `poseLibre`, on abattait l'arbre pour bâtir là, et
   *     la place ne venait jamais. On ne lit pas une teinte de fantôme — une teinte dit ce que
   *     le client CROIT ; une structure au sol dit ce que la sim a FAIT.
   *
   * ON VISE UN ARBRE **DANS** LE CARRÉ, sinon on ne mesure rien : dehors, la règle ne
   * s'applique pas — l'arbre dériverait et repousserait comme avant.
   *
   * Exige `--dev` : fondation et téléportation passent par le mode debug.
   */
  async defriche(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    const agir = async (action, ms = 320) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const slotDe = (item) => page.evaluate((it) => (window.__BRAISES__.scene.registry.get('inv') ?? [])
      .findIndex((s) => s?.item === it), item)
    const pos = () => page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    await agir({ type: 'debug_set_hour', hour: 11 }, 300)

    const assise = await fonderPres(page, agir, slotDe, await pos())
    if (assise === null) { console.error('!! aucun village fondé — rien à défricher'); return }
    const feu = { x: assise.bx + 1, y: assise.by }

    // L'ARBRE : dans le carré RÉSERVÉ (16), et assez loin du Feu pour ne pas confondre son
    // tronc avec les flammes ; assez près pour tenir dans le cadre en même temps que nous.
    const arbre = await page.evaluate(({ fx, fy }) => {
      const s = window.__BRAISES__.scene
      const dans = (n) => Math.max(Math.abs(n.tx - fx), Math.abs(n.ty - fy))
      const c = (s.view.nodes ?? [])
        .filter((n) => n.type === 'tree' && n.stock > 0 && dans(n) >= 3 && dans(n) <= 8)
        .sort((a, b) => dans(a) - dans(b))[0]
      return c ? { id: c.id, tx: c.tx, ty: c.ty, stock: c.stock } : null
    }, { fx: feu.x, fy: feu.y })
    if (!arbre) { console.error(`!! aucun arbre entre 3 et 8 tuiles du Feu (${feu.x}, ${feu.y})`); return }
    console.log(`\nLe Feu est en (${feu.x}, ${feu.y}) ; l'arbre visé est en (${arbre.tx}, ${arbre.ty}), stock ${arbre.stock}.`)

    // On se plante à l'OUEST de l'arbre, à 1,1 tuile de son centre : DANS `INTERACT_RANGE`
    // (1,5 — plus loin, chaque coup se fait refuser en silence et l'arbre reste debout), et
    // assez à l'écart pour que la tuile visée reste dégagée à l'image (un avatar planté
    // dessus la remplirait de sa propre silhouette, et la mesure ① mesurerait l'avatar).
    await agir({ type: 'debug_teleport', x: arbre.tx - 0.6, y: arbre.ty + 0.5 }, 900)
    await agir({ type: 'debug_grant', item: 'axe' }, 160)
    for (let i = 0; i < 6; i++) await agir({ type: 'debug_grant', item: 'wood' }, 70)
    await agir({ type: 'debug_grant', item: 'hammer' }, 200)
    const hslot = await slotDe('hammer')
    const aslot = await slotDe('axe')
    if (hslot < 0 || hslot >= 6 || aslot < 0 || aslot >= 6) { console.error(`!! ceinture pleine (marteau ${hslot}, hache ${aslot})`); return }

    const versEcran = (tx, ty) => page.evaluate(({ x, y }) => {
      const scene = window.__BRAISES__.scene
      const cam = scene.cameras.main
      const gx = (x * 16 - cam.worldView.x) * cam.zoom
      const gy = (y * 16 - cam.worldView.y) * cam.zoom
      const c = scene.scale.canvas.getBoundingClientRect()
      return { x: Math.round(c.left + gx * (c.width / scene.scale.width)), y: Math.round(c.top + gy * (c.height / scene.scale.height)) }
    }, { x: tx, y: ty })

    const lum = ([r, v, b]) => 0.2126 * r + 0.7152 * v + 0.0722 * b
    /** Luminance moyenne d'un carré centré sur la tuile — le tronc y est le point sombre. */
    const CARRE = 30
    const teinteTuile = async () => {
      const c = await versEcran(arbre.tx + 0.5, arbre.ty + 0.5)
      const r = await regionAt(page, { x: c.x - CARRE / 2, y: c.y - CARRE, width: CARRE, height: CARRE })
      if (!r) return null
      let s = 0
      for (let x = 0; x < CARRE; x++) for (let y = 0; y < CARRE; y++) s += lum(r.px(x, y))
      return s / (CARRE * CARRE)
    }

    /**
     * ON POSE VRAIMENT UN COFFRE, ET PAS UN MUR.
     *
     * Le MUR ne prouve rien : il a `arete: 'possible'`, donc `placeable()` sort par le chemin
     * de l'ARÊTE (`edgeBarrierAt`) et ne regarde jamais la tuile — son fantôme est rouge ou
     * vert pour des raisons qui n'ont rien à voir avec l'arbre. Le nœud ne refuse que les
     * pièces PLEINE TUILE à arête interdite (`occupe: 'tuile'`, `arete: 'interdite'`) : coffre,
     * four, établi.
     *
     * Et on ne lit pas la TEINTE du fantôme, on POSE : `place_component` traverse la sim
     * entière et son refus a un texte (`un nœud occupe la tuile`). Une teinte dit ce que le
     * client croit ; une structure au sol dit ce que la sim a fait. C'est la promesse même de
     * la règle — « j'abats l'arbre, et la place vient » — et rien de moins ne la prouve.
     */
    const poserLeCoffre = async () => {
      await agir({ type: 'debug_grant', item: 'chest' }, 200)
      const cslot = await slotDe('chest')
      if (cslot < 0 || cslot >= 6) return { pose: false, why: `coffre hors ceinture (case ${cslot})` }
      await agir({ type: 'set_active_slot', slot: cslot }, 300)
      await agir({ type: 'place_component', tx: arbre.tx, ty: arbre.ty }, 500)
      return page.evaluate(({ x, y }) => {
        const sc = window.__BRAISES__.scene
        const s = (sc.view.structures ?? []).find((q) => q.type === 'chest' && q.tx === x && q.ty === y)
        return { pose: Boolean(s), why: sc.registry.get('toast') ?? sc.dernierRefus ?? null }
      }, { x: arbre.tx, y: arbre.ty })
    }

    // ── AVANT ────────────────────────────────────────────────────────────────────
    // La caméra suit l'avatar en `lerp` : relevée trop tôt après le TP, la tuile n'est pas
    // encore là où `versEcran` la calcule, et l'écart mesuré serait celui du cadrage.
    await agir({ type: 'set_active_slot', slot: -1 }, 400)
    await page.waitForTimeout(900)
    const lumAvant = await teinteTuile()
    await page.screenshot({ path: `${OUT}/defriche-0-avant.png` })
    const poseAvant = await poserLeCoffre()
    await page.screenshot({ path: `${OUT}/defriche-1-pose-refusee.png` })

    // ── ON ABAT ──────────────────────────────────────────────────────────────────
    await agir({ type: 'set_active_slot', slot: aslot }, 400)
    let stock = arbre.stock
    // `GATHER_COOLDOWN_TICKS` vaut UNE SECONDE : frapper plus vite ne fait que collectionner
    // des refus silencieux. On espace les coups d'un peu plus que la cadence.
    for (let coup = 0; coup < 20 && stock > 0; coup++) {
      await agir({ type: 'harvest', nodeId: arbre.id }, 1150)
      stock = await page.evaluate((id) => {
        const n = (window.__BRAISES__.scene.view.nodes ?? []).find((q) => q.id === id)
        return n ? n.stock : -1
      }, arbre.id)
    }
    const etatNoeud = await page.evaluate((id) => {
      const n = (window.__BRAISES__.scene.view.nodes ?? []).find((q) => q.id === id)
      return n ? { present: true, stock: n.stock, tx: n.tx, ty: n.ty } : { present: false }
    }, arbre.id)
    console.log(`\n── LE NŒUD APRÈS L'ABATTAGE ──`)
    console.log(`   ${etatNoeud.present
      ? `présent dans view.nodes, stock ${etatNoeud.stock}, tuile (${etatNoeud.tx}, ${etatNoeud.ty})`
      : 'ABSENT de view.nodes'} — attendu : présent, stock 0, tuile inchangée (la souche ne dérive pas)`)

    // ── APRÈS ────────────────────────────────────────────────────────────────────
    await agir({ type: 'set_active_slot', slot: -1 }, 400)
    await page.waitForTimeout(400)
    const lumApres = await teinteTuile()
    await page.screenshot({ path: `${OUT}/defriche-2-apres.png` })
    const poseApres = await poserLeCoffre()
    await page.screenshot({ path: `${OUT}/defriche-3-pose-acceptee.png` })

    console.log(`\n── ① L'IMAGE (carré de ${CARRE}×${CARRE} px sur la tuile) ──`)
    if (lumAvant === null || lumApres === null) console.error('   !! relevé de pixels impossible')
    else {
      const d = lumApres - lumAvant
      console.log(`   luminance ${lumAvant.toFixed(1)} → ${lumApres.toFixed(1)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)})`)
      console.log(`   ${Math.abs(d) < 2 ? '✗ la tuile n\'a pas changé — le tronc est peut-être encore peint' : '✓ la tuile a changé : le tronc a quitté le cadre'}`)
    }

    console.log(`\n── ② LA POSE sur la tuile de l'arbre (coffre en main) ──`)
    console.log(`   avant (arbre debout) : ${poseAvant.pose ? 'POSÉ' : 'refusé'}  ${poseAvant.pose ? '✗ ATTENDU refusé' : '✓'}`)
    console.log(`   après (défriché)     : ${poseApres.pose ? 'POSÉ' : 'refusé'}  ${poseApres.pose ? '✓' : '✗ ATTENDU posé'}`)
    return { arbre, etatNoeud, lumAvant, lumApres, poseAvant, poseApres }
  },

  /**
   * LE TIR (2026-08-02, spec `tir.md`) — l'arc, la corde qui se tend, le trait qui part.
   *
   * Ce qui ne se prouve qu'au navigateur, et que /sim ne peut pas dire :
   *   ① l'arc a une SILHOUETTE d'arc dans la main (pas un bâton de plus) ;
   *   ② la corde SE TEND quand on maintient le clic droit — c'est le seul télégraphe du
   *     tir, et c'est sur lui qu'un adversaire décide de s'abriter ;
   *   ③ le télégraphe au sol SUIT le curseur arc levé (la re-visée est passée du bouton
   *     GAUCHE au DROIT : c'est LA régression que ce pas attrape) ;
   *   ④ le TRAIT traverse l'écran au décochage — peint, jamais simulé (T3) ;
   *   ⑤ la flèche RETOMBE au sol et le carquois a baissé d'exactement une.
   *
   * Exige `--dev` : on se donne l'arc et les flèches par `debug_grant`.
   */
  async tir(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(800)
    await canopeePleine(page)

    // L'ARC ET LE CARQUOIS. Deux pièges, tous deux payés d'une passe à blanc :
    //   · `debug_grant` donne UNE unité et la MET EN MAIN — les flèches d'abord, l'arc en
    //     dernier, sinon c'est une flèche qu'on tiendrait au poing ;
    //   · l'hôte ne garde qu'UNE action par tick (`pendingAction`, sim-worker) — neuf
    //     `debug_grant` dans le même `evaluate` n'en laissent passer qu'un seul, le dernier.
    //     On les ESPACE d'un tick, et c'est le smoke qui l'a dit (carquois à 0).
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: 'arrow' }))
      await page.waitForTimeout(90)
    }
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: 'bow' }))
    await page.waitForTimeout(600)

    const main = await page.evaluate(() => {
      const reg = window.__BRAISES__.scene.registry
      const inv = reg.get('inv') ?? []
      const slot = reg.get('activeSlot') ?? -1
      return {
        tenu: slot >= 0 ? (inv[slot]?.item ?? null) : null,
        fleches: inv.reduce((n, c) => n + (c && c.item === 'arrow' ? c.count : 0), 0),
      }
    })
    console.log(main.tenu === 'bow'
      ? `   ✓ l'arc est EN MAIN, ${main.fleches} flèches au carquois`
      : `   ✗ ce qu'on tient : ${main.tenu} (attendu bow) — le reste du scénario ne veut rien dire`)

    // Le curseur à HUIT TUILES à l'est : dans la portée de l'arc long (11), hors de toute
    // portée de mêlée. C'est là que l'arc dit quelque chose que les autres armes ne disent pas.
    const versEst = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const cam = s.cameras.main
      const p = s.registry.get('playerPos')
      const gx = ((p.x + 8) * 16 - cam.worldView.x) * cam.zoom
      const gy = (p.y * 16 - cam.worldView.y) * cam.zoom
      const c = s.scale.canvas.getBoundingClientRect()
      return { x: c.left + gx * (c.width / s.scale.width), y: c.top + gy * (c.height / s.scale.height) }
    })

    // ── ② LA CORDE SE TEND ── clic DROIT maintenu, une seconde : de quoi passer `chargeTicks`.
    await page.mouse.move(versEst.x, versEst.y)
    // ── LES ÉCLATS DE BANDE (demande d'Alexis) ──
    //
    // ON ARME LE GUET AVANT D'APPUYER. Tout aller-retour vers Node coûte au moins une frame
    // (≈333 ms ici) et la bande n'en dure que 900 : mesuré, le guet posé APRÈS l'appui
    // trouvait déjà le ratio à 1 une fois sur deux. On s'accroche donc à
    // `requestAnimationFrame` et on endort la boucle à la frame MÊME où la charge apparaît
    // — elle y est jeune, et figée le temps du comptage.
    //
    // ON NE MESURE PAS LA PENTE ICI, et c'est délibéré : chaque pas coûte un rendu entier,
    // donc trois relevés ne tiennent pas dans les 0,9 s d'une bande. La pente est prouvée
    // à part, sur la fonction pure `periodeEclat` (`bande.test.ts`). Ici on constate que
    // les éclats sont bien LÀ, et qu'ils claquent (crête proche de 1).
    const armerGuetEclats = () => page.evaluate(() => new Promise((resolve) => {
      const s = window.__BRAISES__.scene
      const g = s.game
      const t0 = performance.now()
      const guetter = () => {
        const c = (s.charges ?? []).find((x) => x.id === s.playerId)
        if (c) {
          g.loop.sleep()
          const ratio = c.ratio
          let t = g.loop.time
          let fronts = 0
          let avant = 0
          let sommet = 0
          for (let i = 0; i < 40; i++) {
            t += 12
            g.step(t, 12)
            const e = s.attackFx.enBande().eclat
            sommet = Math.max(sommet, e)
            if (e > 0.05 && avant <= 0.05) fronts++
            avant = e
          }
          // On RESTE endormi sur une crête, pour que Node ait quelque chose à photographier.
          for (let i = 0; i < 40 && s.attackFx.enBande().eclat < 0.8; i++) {
            t += 6
            g.step(t, 6)
          }
          resolve({ fronts, sommet: Number(sommet.toFixed(2)), ratio: Number(ratio.toFixed(2)) })
          return
        }
        if (performance.now() - t0 > 12000) {
          resolve({ fronts: 0, sommet: 0, ratio: -1 })
          return
        }
        requestAnimationFrame(guetter)
      }
      requestAnimationFrame(guetter)
    }))
    // TROIS TENTATIVES AU PLUS. La bande dure 900 ms et une frame en coûte ~333 ici : selon
    // le nombre de frames que met l'aller-retour de l'action, la première charge OBSERVÉE
    // peut déjà être pleine (mesuré, une fois sur trois). On relâche alors et on recommence,
    // plutôt que de laisser un contrôle rouge une fois sur trois pour une raison de banc.
    let eclats = { fronts: 0, sommet: 0, ratio: -1 }
    for (let essai = 0; essai < 3; essai++) {
      const guet = armerGuetEclats()
      await page.mouse.down({ button: 'right' })
      eclats = await guet
      if (eclats.ratio >= 0 && eclats.ratio < 0.9) break
      await page.evaluate(() => void window.__BRAISES__.scene.game.loop.wake())
      await page.mouse.up({ button: 'right' })
      await page.waitForTimeout(900) // la récupération, puis on recommence
      // ⚠ ET SI L'ON ABANDONNE, ON REPOSE LE DOIGT. Toute la suite du scénario suppose
      // l'arc LEVÉ ; sortir de cette boucle bouton relâché rendait tout le reste rouge en
      // cascade — « la corde n'est pas tendue », « la visée n'a pas suivi » — pour une
      // raison qui n'avait rien à voir avec ce qu'on mesure.
      if (essai === 2) {
        await page.mouse.down({ button: 'right' })
        await page.waitForTimeout(2200)
      }
    }
    await page.screenshot({ timeout: 90000, path: `${OUT}/tir-0-eclat.png` })
    // LE FLASH SE VOIT-IL VRAIMENT SUR CE CORPS ? L'avatar est déjà crème : blanchir un
    // corps clair peut ne rien donner. On MESURE plutôt que de supposer — la boucle est
    // encore figée sur la crête, on relève le pixel du torse, puis on avance jusqu'au
    // creux de l'éclat et on relève le même pixel. L'écart de luminance tranche.
    const surLeCorps = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const cam = s.cameras.main
      const p = s.registry.get('playerPos')
      const gx = (p.x * 16 - cam.worldView.x) * cam.zoom
      // ON VISE LA TÊTE, PAS LE TORSE. Le torse de l'avatar est déjà crème (255,244,195) :
      // le blanchir n'y change presque rien, et la première sonde a mesuré ΔL 9,7 — un
      // faux négatif sur l'effet, pas une mesure de l'effet. Le remplissage blanc efface
      // les détails SOMBRES du sprite, et c'est là qu'il se lit.
      const gy = (p.y * 16 - cam.worldView.y - 11) * cam.zoom
      const c = s.scale.canvas.getBoundingClientRect()
      return { x: Math.round(c.left + gx * (c.width / s.scale.width)), y: Math.round(c.top + gy * (c.height / s.scale.height)) }
    })
    // TROIS POINTS SUR LE CORPS, et l'on garde le meilleur écart. Un seul pixel est une
    // sonde fragile : selon la frame exacte, il tombe sur un bord du sprite ou sur une
    // zone déjà crème, et l'on mesure alors la sonde plutôt que l'effet (mesuré : 22,7 une
    // fois, 8,9 la suivante, pour le même effet).
    const points = [-11, -6, -2].map((dy) => ({ x: surLeCorps.x, y: surLeCorps.y + dy }))
    const cretes = []
    for (const pt of points) cretes.push(await pixelAt(page, pt.x, pt.y))
    await page.evaluate(() => {
      const g = window.__BRAISES__.scene.game
      let t = g.loop.time
      for (let i = 0; i < 60 && window.__BRAISES__.scene.attackFx.enBande().eclat > 0.05; i++) {
        t += 8
        g.step(t, 8)
      }
    })
    const creux = []
    for (const pt of points) creux.push(await pixelAt(page, pt.x, pt.y))
    const lum = (c) => (c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : 0)
    const ecarts = cretes.map((c, i) => Number((lum(c) - lum(creux[i])).toFixed(1)))
    const dLum = Math.max(...ecarts.map(Math.abs))
    console.log(dLum >= 12
      ? `   ✓ le CORPS clignote pour de bon : ΔL ${dLum} sur le meilleur des trois points (${ecarts.join(' / ')})`
      : `   ✗ le flash ne se lit pas sur le corps : ΔL ${dLum} au mieux (${ecarts.join(' / ')})`)
    await page.evaluate(() => void window.__BRAISES__.scene.game.loop.wake())
    // ⚠ CETTE SONDE NE PEUT MESURER QUE PENDANT LA MONTÉE. À bande PLEINE, le code garantit
    // `eclat = 0` — c'est la règle même du rendu (« à fond, les éclats CESSENT et la garde se
    // pose »), affirmée deux lignes plus bas par un ✓. La sonde s'accroche à la charge dès
    // qu'elle apparaît, mais l'horloge headless de cette machine va si vite que la première
    // observation tombe souvent à `ratio = 1` : elle mesurait alors zéro éclat et criait au
    // défaut, à l'instant précis où l'absence d'éclat est le comportement CORRECT. Un ✗ qui
    // contredisait le ✓ d'à côté. (Audit UX 2026-08-20, I-3.)
    //
    // On le dit franchement plutôt que d'accuser le jeu : hors de la fenêtre de montée, la
    // sonde est INAPPLICABLE, pas rouge.
    console.log(eclats.ratio >= 0.95
      ? `   (éclats de bande : non mesurable ici — la charge était déjà pleine à la première observation, ratio ${eclats.ratio}, or à fond le code garantit zéro éclat)`
      : eclats.fronts > 0
        ? `   ✓ la bande ÉCLATE en montant : ${eclats.fronts} front(s) sur 0,48 s à ratio ${eclats.ratio} (crête ${eclats.sommet})`
        : `   ✗ aucun éclat pendant la bande (ratio ${eclats.ratio})`)
    // ON TIENT LARGEMENT PLUS QUE `chargeTicks` (0,9 s) : le rendu logiciel de cette
    // machine tourne à quelques images par seconde, et la boucle qui RE-VISE est cadencée
    // sur la frame — mesuré, 1,2 s de mur ne donnaient qu'une demi-bande.
    await page.waitForTimeout(3000)
    const bande = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const moi = s.playerId
      const c = (s.charges ?? []).find((x) => x.id === moi)
      return { ratio: c ? Number(c.ratio.toFixed(2)) : null, portee: c ? c.strike.range : null }
    })
    console.log(bande.ratio !== null && bande.ratio >= 1
      ? `   ✓ l'arc est bandé à fond (ratio ${bande.ratio}), zone de ${bande.portee} tuiles`
      : `   ✗ la corde n'est pas tendue (ratio ${bande.ratio}) — le clic droit n'arme pas`)
    // GROS PLAN SUR L'ARCHER : à l'échelle du jeu, la corde tendue fait quelques pixels, on
    // ne peut pas juger une silhouette sur une capture plein cadre.
    // ON POUSSE LE ZOOM DE LA CAMÉRA pour la photo, puis on le rend. À l'échelle de jeu,
    // l'arc fait une vingtaine de pixels : un découpage ne fait qu'agrandir le grain, pas
    // le dessin. On regarde le MÊME rendu, de plus près — rien n'est fabriqué.
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      window.__ZOOM__ = s.cameras.main.zoom
      s.cameras.main.setZoom(window.__ZOOM__ * 4)
      return true
    })
    await page.waitForTimeout(600)
    const centre = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const cam = s.cameras.main
      const p = s.registry.get('playerPos')
      const gx = (p.x * 16 - cam.worldView.x) * cam.zoom
      const gy = (p.y * 16 - cam.worldView.y) * cam.zoom
      const c = s.scale.canvas.getBoundingClientRect()
      return { x: c.left + gx * (c.width / s.scale.width), y: c.top + gy * (c.height / s.scale.height) }
    })
    await page.screenshot({
      path: `${OUT}/tir-1b-arc-de-pres.png`,
      clip: { x: Math.max(0, centre.x - 170), y: Math.max(0, centre.y - 200), width: 380, height: 320 },
      // Un rendu logiciel à ×4 de zoom, c'est seize fois les pixels : 30 s ne suffisent pas.
      timeout: 90000,
    })
    // `void` : `setZoom` rend la CAMÉRA (API chaînable), et Playwright sérialiserait tout
    // le graphe Phaser au retour — mesuré, ça fait exploser le transport (ERR_STRING_TOO_LONG).
    await page.evaluate(() => void window.__BRAISES__.scene.cameras.main.setZoom(window.__ZOOM__))
    await page.waitForTimeout(400)

    // ── À FOND, LES ÉCLATS CESSENT ──
    //
    // ON NE FIGE PAS ICI, et c'est une leçon payée : `sleep()` puis `wake()` dans le MÊME
    // bloc synchrone laisse la boucle sans plus produire d'image, et la capture suivante
    // attend un frame qui ne vient jamais (90 s de timeout, « fonts loaded » puis rien).
    // On n'en a pas besoin : ce qu'on affirme ici est une ABSENCE, et une absence se
    // constate très bien sur les frames naturelles.
    const pleine = await page.evaluate(() => new Promise((resolve) => {
      const s = window.__BRAISES__.scene
      const t0 = performance.now()
      let fronts = 0
      let avant = 0
      let vuePleine = false
      const voir = () => {
        const b = s.attackFx.enBande()
        if (b.pleine) vuePleine = true
        if (b.eclat > 0.05 && avant <= 0.05) fronts++
        avant = b.eclat
        if (performance.now() - t0 > 1600) {
          resolve({ fronts, pleine: vuePleine })
          return
        }
        requestAnimationFrame(voir)
      }
      requestAnimationFrame(voir)
    }))
    console.log(pleine.pleine && pleine.fronts === 0
      ? `   ✓ à fond, les éclats CESSENT et la garde se pose (0 front sur 1,6 s, pleine=true)`
      : `   ✗ l'état « à fond » ne se distingue pas (fronts ${pleine.fronts}, pleine ${pleine.pleine})`)
    await page.screenshot({ timeout: 90000, path: `${OUT}/tir-1-bande.png` })
    // ── ③ LE TÉLÉGRAPHE SUIT LE CURSEUR, arc levé (la re-visée est sur le bouton DROIT) ──
    await page.mouse.move(versEst.x, versEst.y - 120, { steps: 6 })
    await page.waitForTimeout(400)
    const suivi = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const c = (s.charges ?? []).find((x) => x.id === s.playerId)
      return c ? { dx: Number(c.dx.toFixed(3)), dy: Number(c.dy.toFixed(3)) } : null
    })
    console.log(suivi && suivi.dy < -0.15
      ? `   ✓ la visée a suivi le curseur vers le nord (dy ${suivi.dy})`
      : `   ✗ la visée n'a pas suivi (${JSON.stringify(suivi)}) — la re-visée est restée sur le bouton gauche`)
    await page.screenshot({ timeout: 90000, path: `${OUT}/tir-2-suivi.png` })

    // ── ③bis LA LIGNE REJOINT LA VISÉE (le lissage réactif, `visee-lissee.ts`) ──
    //
    // CE QUI SE VÉRIFIE ICI, ET CE QUI NE PEUT PAS : la PENTE du lissage se prouve sur la
    // fonction pure (`visee-lissee.test.ts`) — une frame de ce banc coûte un rendu logiciel
    // entier, elle enjambe donc toute la course. Ce que le navigateur seul peut dire, c'est
    // que le lissage ARRIVE : qu'il ne reste AUCUN décalage permanent entre la ligne
    // DESSINÉE et la direction où le trait partira une fois le curseur reposé. Un lissage qui
    // ne converge pas est un télégraphe qui ment en continu — et c'est un mensonge qu'aucun
    // test pur ne peut attraper, puisqu'il naîtrait du CÂBLAGE (une cible branchée sur le
    // mauvais bout : l'écho du snapshot au lieu du curseur).
    //
    // On ne FIGE rien et on ne FABRIQUE rien : le curseur revient à l'est par un vrai geste,
    // et l'on LIT ce que la scène a dessiné (« le smoke lit l'état, il ne le fabrique pas »).
    //
    // ⚠ ON ATTEND TROIS SECONDES POUR UNE POSE QUI PREND 200 ms DANS LE JEU, et c'est le BANC
    // qui l'exige : le pas de temps du lissage est borné à 50 ms (une frame qui saute ne doit
    // pas téléporter la ligne), donc à trois images par seconde chaque frame ne comble que
    // ~57 % de l'écart quoi qu'il arrive. MESURÉ : 600 ms — deux frames d'ici — laissaient
    // encore 7,9° sur un écart de 40°, et ce n'est pas un décalage permanent, c'est le banc.
    //
    // ⚠ ET LES DEUX NOMBRES VIENNENT DE LA MÊME FRAME (`viseeLissee` porte sa cible). Cible
    // recalculée au relevé, on mesure la CAMÉRA : elle glisse encore entre deux frames d'ici,
    // donc le point de sol sous un curseur immobile bouge — 4,1° de résidu fantôme, mesuré.
    //
    // ⚠ ET L'ON AFFIRME QUE ÇA SE REFERME, PAS QUE C'EST ARRIVÉ. Même curseur posé, la cible
    // BOUGE encore ici : le lerp de suivi de la caméra (0,16 par frame) met des SECONDES à
    // s'asseoir quand une frame dure un tiers de seconde — relevé, la cible dérivait encore
    // de −2,85° à −0,94° pendant que la ligne la suivait de −7,46° à −2,05°. Exiger un zéro
    // reviendrait à exiger que la caméra du banc ait fini de glisser. La monotonie, elle, dit
    // exactement ce qu'on veut savoir : la ligne se referme et ne rouvre jamais.
    await page.mouse.move(versEst.x, versEst.y, { steps: 6 })
    await page.waitForTimeout(3000)
    const lissage = await page.evaluate(() => new Promise((resolve) => {
      const s = window.__BRAISES__.scene
      const serie = []
      let n = 0
      const voir = () => {
        const v = s.viseeLissee.get(s.playerId)
        if (v !== undefined) {
          let e = (v.cible - v.angle) % (Math.PI * 2)
          if (e > Math.PI) e -= Math.PI * 2
          if (e <= -Math.PI) e += Math.PI * 2
          serie.push({
            e: Number(Math.abs((e * 180) / Math.PI).toFixed(2)),
            c: Number(((v.cible * 180) / Math.PI).toFixed(2)),
            a: Number(((v.angle * 180) / Math.PI).toFixed(2)),
          })
        }
        if (++n >= 10) {
          resolve({ serie, ecartDeg: serie.length ? serie[serie.length - 1].e : null })
          return
        }
        requestAnimationFrame(voir)
      }
      requestAnimationFrame(voir)
    }))
    const ferme = lissage.serie.length >= 3 && lissage.serie.every((p, i, t) => i === 0 || p.e < t[i - 1].e)
    console.log(ferme && lissage.ecartDeg < 3
      ? `   ✓ la ligne SE REFERME sur sa visée : ${lissage.serie[0].e}° → ${lissage.ecartDeg}° sur dix frames, sans jamais rouvrir`
      : `   ✗ le lissage ne rejoint pas sa cible : ${lissage.serie.map((p) => p.e).join('° → ')}°`)

    // ── ④ LE TRAIT ── clic GAUCHE (le droit reste enfoncé), puis on FIGE la boucle : un vol
    // peint dure 200 ms et l'horloge headless galope — sans le gel, la photo arrive après.
    // ON ARME LE GUET AVANT DE TIRER — et c'est la leçon de ce scénario : posé APRÈS le
    // clic, il regardait après la bataille (le trait part 250 ms plus tard, la boucle
    // d'aller-retour Node↔page en met autant). Il s'accroche à `requestAnimationFrame`,
    // enregistré APRÈS celui de Phaser : notre rappel s'exécute donc une fois la frame
    // DESSINÉE. Dès qu'un trait est peint, on endort la boucle — le canvas garde alors sa
    // dernière image, celle qui le porte. Sans ce gel, un vol de 200 ms meurt entre deux
    // frames (le rendu logiciel de cette machine tourne à quelques images par seconde).
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      window.__VOL__ = null
      const t0 = performance.now()
      const guetter = () => {
        const n = s.attackFx.enVol()
        if (n > 0) {
          s.game.loop.sleep()
          window.__VOL__ = { vus: n, ms: Math.round(performance.now() - t0) }
          return
        }
        if (performance.now() - t0 > 10000) {
          window.__VOL__ = { vus: 0, ms: -1 }
          return
        }
        requestAnimationFrame(guetter)
      }
      requestAnimationFrame(guetter)
    })
    await page.mouse.down({ button: 'left' })
    await page.mouse.up({ button: 'left' })
    await page.waitForFunction(() => window.__VOL__ !== null, null, { timeout: 20000 })
    const vol = await page.evaluate(() => window.__VOL__)
    console.log(vol.vus > 0
      ? `   ✓ le trait est EN VOL (${vol.vus}), attrapé ${vol.ms} ms après le décochage`
      : `   ✗ aucun trait peint : le tir ne se voit pas partir`)
    // LA BOUCLE EST ENDORMIE, LE TRAIT VIENT DE NAÎTRE — donc il est encore DANS l'arc.
    // On avance la boucle À LA MAIN de deux fois 45 ms pour le prendre en pleine course :
    // `game.step` refait une frame complète (update + rendu), ce que `fx.update` seul ne
    // ferait pas. C'est le seul moyen de PHOTOGRAPHIER un effet plus court qu'une frame.
    await page.evaluate(() => {
      const g = window.__BRAISES__.scene.game
      let t = g.loop.time
      t += 45; g.step(t, 45)
      t += 45; g.step(t, 45)
    })
    await page.screenshot({ timeout: 90000, path: `${OUT}/tir-3-trait.png` })
    await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())

    // ── ⑤ LA FLÈCHE RETOMBE, ET LE CARQUOIS A BAISSÉ D'UNE ──
    await page.mouse.up({ button: 'right' })
    await page.waitForTimeout(900)
    const apres = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const inv = s.registry.get('inv') ?? []
      return {
        fleches: inv.reduce((n, c) => n + (c && c.item === 'arrow' ? c.count : 0), 0),
        piles: (s.view?.groundItems ?? []).filter((p) => p.item === 'arrow').length,
        charge: (s.charges ?? []).some((x) => x.id === s.playerId),
      }
    })
    console.log(apres.fleches === main.fleches - 1
      ? `   ✓ le carquois a baissé d'exactement une (${main.fleches} → ${apres.fleches})`
      : `   ✗ carquois ${main.fleches} → ${apres.fleches} : le décompte du tir ne tient pas`)
    // UNE FLÈCHE SUR DEUX SE PERD (décision d'Alexis) : un tir donné ne laisse plus
    // forcément un tas. On en décoche donc jusqu'à en voir un — et c'est justement le
    // geste qu'on veut montrer, puisque c'est celui qu'on ira ramasser.
    let piles = apres.piles
    for (let essai = 0; essai < 6 && piles === 0; essai++) {
      await page.mouse.down({ button: 'right' })
      await page.waitForTimeout(1400)
      await page.mouse.down({ button: 'left' })
      await page.mouse.up({ button: 'left' })
      await page.waitForTimeout(400)
      await page.mouse.up({ button: 'right' })
      await page.waitForTimeout(900)
      piles = await page.evaluate(
        () => (window.__BRAISES__.scene.view?.groundItems ?? []).filter((p) => p.item === 'arrow').length,
      )
    }
    console.log(piles >= 1
      ? `   ✓ une flèche a fini par retomber, ramassable (${piles} pile)`
      : `   ✗ six tirs et aucune flèche au sol : la récupération ne rend jamais rien`)
    // LA FLÈCHE AU SOL, DE PRÈS : c'est elle qui ferme la boucle de l'économie de munition
    // (T6). Elle fait quelques pixels à l'échelle de jeu — on pousse la caméra pour la voir.
    if (piles >= 1) {
      const surLaPile = await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const cam = s.cameras.main
        const pile = (s.view?.groundItems ?? []).find((p) => p.item === 'arrow')
        if (!pile) return null
        window.__ZOOM__ = cam.zoom
        // ON DÉTACHE LE SUIVI D'ABORD : la caméra suit l'avatar, et elle ANNULE tout
        // `centerOn` à la frame suivante — la première photo n'a montré que du gazon.
        cam.stopFollow()
        cam.setZoom(window.__ZOOM__ * 4)
        cam.centerOn(pile.x * 16, pile.y * 16)
        return { x: s.scale.width / 2, y: s.scale.height / 2 }
      })
      if (surLaPile) {
        await page.waitForTimeout(900)
        await page.screenshot({
          timeout: 90000,
          path: `${OUT}/tir-5-au-sol.png`,
          clip: { x: Math.max(0, surLaPile.x - 170), y: Math.max(0, surLaPile.y - 140), width: 380, height: 300 },
        })
        await page.evaluate(() => {
          const cam = window.__BRAISES__.scene.cameras.main
          cam.setZoom(window.__ZOOM__)
          cam.startFollow(window.__BRAISES__.scene.playerSprite, false, 0.16, 0.16)
        })
        await page.waitForTimeout(500)
      }
    }
    console.log(!apres.charge
      ? `   ✓ l'arc est rabaissé après le relâchement du clic droit`
      : `   ✗ la corde est restée tendue : le rabaissement ne part pas`)

    // ── ⑦ ON REBANDE DIRECT (décision d'Alexis) ── clic droit TOUJOURS enfoncé, on
    // décoche au gauche : l'arc ne doit pas se rabaisser, il doit repartir tout seul dès
    // que la récupération s'achève. Le clic droit veut dire « arc levé », pas « une flèche ».
    await page.mouse.move(versEst.x, versEst.y)
    await page.mouse.down({ button: 'right' })
    await page.waitForTimeout(2500)
    await page.mouse.down({ button: 'left' })
    await page.mouse.up({ button: 'left' })
    // On laisse passer l'armement PUIS la récupération (1,1 s au tir bandé) : c'est APRÈS
    // elle que la corde doit être repartie toute seule, sans qu'un doigt ait bougé.
    await page.waitForTimeout(3500)
    const rebande = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const c = (s.charges ?? []).find((x) => x.id === s.playerId)
      return { charge: c !== undefined, ratio: c ? Number(c.ratio.toFixed(2)) : -1 }
    })
    await page.mouse.up({ button: 'right' })
    await page.waitForTimeout(600)
    console.log(rebande.charge
      ? `   ✓ le doigt n'a pas bougé et l'arc S'EST REBANDÉ tout seul (ratio ${rebande.ratio})`
      : `   ✗ l'arc est resté baissé après le tir : il faut relâcher le droit pour rebander`)

    // ── ⑥ RABAISSER NE COÛTE RIEN ── on relève, on tient, on relâche SANS décocher.
    // ON RELIT LE CARQUOIS D'ABORD : les tirs de rattrapage (une flèche sur deux se perd)
    // ont vidé le compte de référence, et comparer à un chiffre périmé rendrait ce
    // contrôle rouge pour une raison qui n'a rien à voir avec l'annulation.
    const avantRepos = await page.evaluate(() => {
      const inv = window.__BRAISES__.scene.registry.get('inv') ?? []
      return inv.reduce((n, c) => n + (c && c.item === 'arrow' ? c.count : 0), 0)
    })
    await page.mouse.move(versEst.x, versEst.y)
    await page.mouse.down({ button: 'right' })
    await page.waitForTimeout(900)
    await page.mouse.up({ button: 'right' })
    await page.waitForTimeout(600)
    const gratuit = await page.evaluate(() => {
      const inv = window.__BRAISES__.scene.registry.get('inv') ?? []
      return inv.reduce((n, c) => n + (c && c.item === 'arrow' ? c.count : 0), 0)
    })
    console.log(gratuit === avantRepos
      ? `   ✓ lever puis rabaisser l'arc ne coûte AUCUNE flèche (${gratuit})`
      : `   ✗ le rabaissement a coûté ${avantRepos - gratuit} flèche(s) — attack_cancel ne passe pas`)
    await page.screenshot({ timeout: 90000, path: `${OUT}/tir-4-repos.png` })
  },

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
            walls: n('wall'), palissades: n('palissade'), doors: n('door'), floors: n('floor'),
            pierre: du.filter((q) => (q.type === 'wall' || q.type === 'door') && q.material === 'stone').length,
            stations: n('workshop') + n('furnace') + n('silo'),
          }
        }, v.id)
        console.log(`   palier ${stage} : ${JSON.stringify(compte)}`)
        // Les seuils tolèrent les trous HONNÊTES du plan (terrain refusé, arête déjà
        // fermée par une ruine voisine) — le compte exact sur terrain nu vit dans
        // debug.test.ts ; ici on vérifie que le palier SE VOIT, pas qu'il est parfait.
        if (stage === 2 && (compte.walls < 30 || compte.palissades < 40 || compte.floors < 40)) {
          console.error(`!! palier 2 : le hameau manque de pièces (${compte.walls} murs, ${compte.palissades} palissades, ${compte.floors} sols)`)
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
      // Les COURONNES (§2quinquies A27) sont organiques : le centre de leur bbox peut être
      // hors du corps (un massif en croissant). On vise le CENTROÏDE des tuiles du corps.
      const centroide = (k, ids) => {
        const z = (m.zones ?? []).find((q) => q.kind === k)
        if (!z) return null
        let sx = 0
        let sy = 0
        let n = 0
        for (let y = z.y; y < z.y + z.h; y++) {
          for (let x = z.x; x < z.x + z.w; x++) {
            if (ids.includes(m.terrain[y * m.width + x])) { sx += x; sy += y; n += 1 }
          }
        }
        return n ? { x: sx / n + 0.5, y: sy / n + 0.5 } : { x: z.x + z.w / 2, y: z.y + z.h / 2 }
      }
      const gue = (m.zones ?? []).find((q) => q.name === 'le Gué')
      // Le seuil le plus proche du Bois Noir, pour voir des bornes ENTIÈRES (pas un secours).
      const s = (m.seuils ?? []).find((q) => !q.secours) ?? (m.seuils ?? [])[0]
      return {
        seuil: s ? { x: s.x, y: s.y } : null,
        gue: gue ? { x: gue.x + 3.5, y: gue.y + 3.5 } : null,
        bois: centroide('bois_noir', [22]), cercle: centre('cercle_pierres'),
        combe: centroide('combe_brumeuse', [19, 8, 4]), // roselière, marais, haut-fond
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
    // ⚠ LA SONDE DOIT D'ABORD SE METTRE LES PIEDS DANS L'EAU, ET LE PROUVER.
    // Elle ne le faisait pas : elle héritait de la position laissée par A4 et marchait vers
    // l'ouest en espérant. Mesuré sur `feeling-remous.png` du 2026-08-20 : l'avatar était
    // plaqué contre le bord GAUCHE du cadre et l'eau ne commençait qu'à 31 tuiles de là. Le
    // « ✗ marcher dans l'eau ne fait aucun remous » ne mesurait rien du tout — il n'y avait
    // rien à photographier. (Audit UX 2026-08-20, I-4.)
    //
    // On se pose donc sur un HAUT-FOND franc (terrain 4, entouré de haut-fond) et on AFFIRME
    // la prémisse. Sans eau sous les pieds, la sonde se déclare inapplicable au lieu
    // d'accuser le jeu.
    const hautFond = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const terr = (tx, ty) => m.terrain[ty * m.width + tx]
      const entoure = (tx, ty) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (terr(tx + dx, ty + dy) !== 4) return false
        return true
      }
      for (let ty = 1; ty < m.height - 1; ty++) for (let tx = 1; tx < m.width - 1; tx++) {
        if (terr(tx, ty) === 4 && entoure(tx, ty)) return { tx, ty }
      }
      return null
    })
    if (!hautFond) {
      console.log('   (A5 inapplicable : aucun haut-fond franc sur cette carte)')
    } else {
      await tp(hautFond.tx + 0.5, hautFond.ty + 0.5)
      const sousLesPieds = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const p = sc.registry.get('playerPos')
        const m = sc.map
        return m.terrain[Math.floor(p.y) * m.width + Math.floor(p.x)]
      })
      if (sousLesPieds !== 4) console.error(`!! A5 : l'avatar n'est PAS dans l'eau (terrain ${sousLesPieds}) — la sonde mesurerait le vide`)
    }

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
   * LE SPRINT (2026-08-01) — la course SE VOIT, et l'endurance dure ce qu'elle doit durer.
   *
   * Deux choses que seul le navigateur prouve, et elles se tiennent :
   *
   *   1. LA DURÉE. On tient SHIFT+W et on chronomètre la barre : elle doit tomber à 0 en
   *      ~12,5 s (100 / 8 par seconde), pas en 57 — la régén ne doit plus recréditer
   *      pendant la course. C'est la mesure de bout en bout, à travers le vrai Worker,
   *      là où le test unitaire ne juge que `step()`.
   *   2. LA POUSSIÈRE. Compteur `sprintFx.vivants` en chemin (le rendu headless traîne :
   *      on somme le max), puis on FIGE la boucle pour la capturer — une bouffée vit
   *      620 ms et l'horloge headless l'enjambe.
   *
   * Trois captures qui se REGARDENT : la foulée fraîche, la foulée à bout (bouffées plus
   * denses, silhouette tassée), et le MUR (la bronchée + sa bouffée large). Exige `--dev`.
   */
  async sprint(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1000)
    // Plein jour : la poussière est une valeur claire sur le sol, la nuit la mangerait.
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const sonde = () => page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const me = (sc.lastEntities ?? []).find((e) => e.id === sc.playerId)
      return {
        s: sc.myStamina ?? -1,
        t: sc.lastSnapshotTick ?? -1,
        g: sc.sprintFx?.vivants ?? -1,
        // L'ALLURE QUE LA SIM A RETENUE — pas celle qu'on croit tenir au clavier. C'est
        // elle qui commande la garde de régén, donc c'est sur elle que la propriété se
        // formule : deux relevés d'affilée en `sprint`, l'endurance ne peut qu'avoir baissé.
        a: me?.gait ?? '?',
      }
    })

    const debut = await sonde()
    console.log(`endurance au départ : ${debut.s}`)

    // LE MUR NE S'ATTEND PAS, IL SE PIÈGE. La bronchée dure 420 ms et sa bouffée 620 ms ;
    // le headless de cette machine (SwiftShader, pas de GPU) tourne à quelques images par
    // seconde, si bien qu'entre la sonde qui voit la barre à 0 et la capture, la poussière
    // a toujours fini de retomber. On s'accroche donc à la FABRIQUE de la bouffée et on
    // fige la boucle au moment MÊME où le mur la crée — recette de la gerbe de récolte.
    // Le même crochet SERT DEUX FOIS : il piège le mur, et il relève au passage la taille
    // de CHAQUE bouffée avec l'endurance qui l'a produite. Compter les grains vivants à la
    // sonde ne prouverait rien de la pente — c'est un maximum tiré au sort par le moment
    // de l'échantillon, et sur une machine à quelques images par seconde il rate les pics.
    // À la source, le nombre est exact.
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      window.__PROBE__ = { mur: 0, bouffees: [] }
      const vrai = s.sprintFx.bouffee.bind(s.sprintFx)
      s.sprintFx.bouffee = (now, x, y, dx, dy, combien, force, teinte) => {
        const r = vrai(now, x, y, dx, dy, combien, force, teinte)
        window.__PROBE__.bouffees.push({ n: combien, force, s: s.myStamina })
        // La bouffée du MUR se reconnaît à sa force (1,6 ; la foulée vaut 1).
        if (force > 1) { window.__PROBE__.mur++; s.sprintFx.bouffee = vrai; s.game.loop.sleep() }
        return r
      }
    })

    // ── 1. LA COURSE ────────────────────────────────────────────────────────────────
    // CE QUI SE JUGE ICI, et ce qui NE s'y juge pas. Le headless ne pousse pas un input à
    // chaque tick : les ticks non servis ne drainent pas (mais ne régénèrent pas non plus,
    // `gait` restant à `sprint`), et le coureur bute en plus dans le décor — un chrono,
    // mural ou en ticks, mesurerait donc la MACHINE. La durée exacte (100 / 8 = 12,5 s)
    // est prouvée là où chaque tick est servi : `combat.test.ts`, critère A1bis, sur
    // `step()`. Ce que le navigateur prouve, lui, c'est le DÉFAUT tel qu'il se vivait :
    // **l'endurance ne remonte JAMAIS tant qu'on court**. C'était faux avant — elle
    // remontait en marchant sur un obstacle, et net, elle montait plus qu'elle ne
    // descendait. Cette propriété-là est insensible au débit d'inputs.
    let grainsFrais = 0
    let grainsABout = 0
    let remontees = 0
    let pire = 0
    let horsCourse = 0
    let precedent = debut.s
    let allurePrec = debut.a
    let tickPrec = debut.t
    let vide = false
    await page.keyboard.down('ShiftLeft')
    await page.keyboard.down('KeyW')
    for (let k = 0; k < 300; k++) {
      await page.waitForTimeout(200)
      const { s, g, a, t } = await sonde()
      if (s > 60) grainsFrais = Math.max(grainsFrais, g)
      else if (s > 0) grainsABout = Math.max(grainsABout, g)
      if (s > precedent + 0.01) {
        // Une remontée n'accuse la RÈGLE qu'à DEUX conditions. ① la sim a vu courir aux
        // deux bouts (un relevé où l'allure a lâché — le headless rate un input — accuse
        // la MACHINE : là, la régén a le droit de créditer). ② les deux relevés sont
        // PROCHES EN TICKS : le headless avale les snapshots par paquets, si bien que
        // deux lectures « à 200 ms » peuvent enjamber des secondes de jeu entières — donc
        // toute une phase de récupération, verrou d'épuisement compris. Deux bouts en
        // `sprint` ne prouvent alors rien du milieu.
        if (a === 'sprint' && allurePrec === 'sprint' && t - tickPrec <= 6) {
          remontees++
          pire = Math.max(pire, s - precedent)
        } else horsCourse++
      }
      precedent = s
      allurePrec = a
      tickPrec = t
      if (k === 4) await page.screenshot({ path: `${OUT}/sprint-1-foulee-fraiche.png` })
      // La barre à bout, silhouette tassée et foulée traînante : on fige pour la capture.
      if (s > 0 && s < 25 && grainsABout > 0) {
        await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
        await page.screenshot({ path: `${OUT}/sprint-2-foulee-a-bout.png` })
        // ON NE RÉVEILLE PAS SI LE PIÈGE A DÉJÀ CLAQUÉ : le mur a pu tomber pendant cette
        // capture, et réveiller la boucle ferait retomber sa poussière avant la photo
        // suivante — c'est exactement comme ça qu'on a mesuré « au mur 0 » deux fois.
        await page.evaluate(() => { if (window.__PROBE__.mur === 0) window.__BRAISES__.scene.game.loop.wake() })
      }
      // LE PIÈGE A CLAQUÉ = la barre a touché 0 : le verrou d'épuisement ne se pose QUE
      // là. Et la boucle dort désormais, donc `myStamina` ne bougera plus — continuer à
      // la sonder ne relèverait que des valeurs gelées. C'est ici qu'on s'arrête.
      if (s <= 0 || (await page.evaluate(() => window.__PROBE__.mur > 0))) { vide = true; break }
    }

    console.log(`endurance : ${remontees} remontée(s) allure SPRINT tenue (attendu 0) · pire +${pire.toFixed(2)} · ${horsCourse} remontée(s) sur un relevé où l'allure avait lâché (le harnais, pas la règle)`)
    if (!vide) console.error('!! l’endurance n’est PAS tombée à 0 de toute la course')
    if (remontees > 0) console.error(`!! l’endurance REMONTE en courant (${remontees} fois, jusqu'à +${pire.toFixed(2)}) — la régén recrédite pendant le sprint`)

    // ── 2. LE MUR, saisi au vol par le piège posé plus haut ──────────────────────────
    const piege = await page
      .waitForFunction(() => window.__PROBE__.mur > 0, null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    let grainsMur = 0
    if (!piege) console.error('!! la bronchée du mur n’a JAMAIS été déclenchée')
    else {
      // La boucle DORT : les grains sont figés à leur naissance, tous au point d'émission.
      // On les fait voler NOUS-MÊMES par `game.step` (et non `fx.update`, qui ne redessine
      // pas) — une vraie frame, sur une horloge qu'on tient.
      grainsMur = await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const t0 = s.time.now
        for (let i = 1; i <= 5; i++) s.game.step(t0 + i * 40, 40)
        return s.sprintFx.vivants
      })
      await page.screenshot({ path: `${OUT}/sprint-3-le-mur.png` })
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
    }
    await page.keyboard.up('ShiftLeft')
    await page.keyboard.up('KeyW')

    console.log(`poussière EN VOL — foulée fraîche max ${grainsFrais} ${grainsFrais >= 1 ? '✓' : '✗'} · à bout max ${grainsABout} ${grainsABout >= 1 ? '✓' : '✗'} · au mur ${grainsMur} ${grainsMur >= 1 ? '✓' : '✗'}`)
    if (grainsFrais < 1) console.error('!! aucune poussière sous les pieds du coureur frais')
    if (grainsABout < 1) console.error('!! aucune poussière sous les pieds du coureur à bout')

    // ── 3. LA PENTE, relevée À LA SOURCE ────────────────────────────────────────────
    const bouffees = await page.evaluate(() => window.__PROBE__.bouffees)
    const foulees = bouffees.filter((b) => b.force === 1)
    const moy = (t) => (t.length === 0 ? 0 : t.reduce((a, b) => a + b.n, 0) / t.length)
    const hautes = moy(foulees.filter((b) => b.s > 60))
    const basses = moy(foulees.filter((b) => b.s > 0 && b.s <= 25))
    console.log(`pente de la foulée — ${foulees.length} bouffées : ${hautes.toFixed(2)} grains au-dessus de 60 d'endurance → ${basses.toFixed(2)} en dessous de 25`)
    if (foulees.length < 5) console.error(`!! seulement ${foulees.length} foulée(s) sur toute la course`)
    else if (!(basses > hautes)) console.error(`!! la foulée ne s'épaissit PAS avec la fatigue (${hautes.toFixed(2)} → ${basses.toFixed(2)} grains)`)
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
  /**
   * LA PLANTE GELÉE SE VOIT-ELLE ? (spec `flore-froid.md` F3 — teinte PROVISOIRE)
   *
   * Le jeu REFUSE désormais la cueillette d'un buisson gelé. Un refus qu'aucun signe
   * n'annonce est le contraire du contrat maison (« annoncé, pas surprise », `gel.md` G5) :
   * ce scénario est là pour qu'on puisse REGARDER l'état en attendant la vraie DA.
   *
   * ═══ LE PIÈGE QU'IL DÉSAMORCE : L'ACTE III REPEINT TOUT ═══
   *
   * Sauter au jour 50 ne gèle pas que les buissons — la neige tombe au sol, les feuillus se
   * dénudent, la lumière change. Comparer la couleur du buisson AVANT et APRÈS ne prouverait
   * donc rien : n'importe quel bleuissement global donnerait le même verdict.
   *
   * On mesure en DIFFÉRENTIEL, sur DEUX nœuds de la même frame, passés par le même pipeline
   * de rendu : le BUISSON (`gelif`) et un nœud TÉMOIN qui ne gèle jamais (pierre ou arbre).
   * Seule la teinte du givre peut expliquer que l'un vire au bleu et pas l'autre.
   *
   * Et l'heure est FORCÉE à midi des deux côtés (`debug_set_hour`) : `debug_set_season_day`
   * déplace le tick, donc la phase du cycle — sans ça, on comparerait un midi à une nuit.
   *
   * Exige `--dev` : tout passe par le debug, inerte dans un build de production.
   */
  async flore(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(3000)

    const agir = async (action, attente = 600) => {
      await page.evaluate((a) => window.__BRAISES__.scene.sendAction(a), action)
      await page.waitForTimeout(attente)
    }

    // LE COUPLE À MESURER : un buisson, et le nœud non-gélif le plus proche de lui. On lit la
    // vue du client (le smoke lit l'état, il ne le fabrique pas).
    const couple = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const brut = s.view?.nodes
      const tous = brut ? (Array.isArray(brut) ? brut : [...brut.values()]) : []
      const moi = s.view?.me ?? { x: 0, y: 0 }
      const d2 = (n) => (n.tx - moi.x) ** 2 + (n.ty - moi.y) ** 2
      const buissons = tous.filter((n) => n.type === 'berry_bush' && n.stock > 0).sort((a, b) => d2(a) - d2(b))
      const buisson = buissons[0]
      if (!buisson) return null
      const proche = (n) => (n.tx - buisson.tx) ** 2 + (n.ty - buisson.ty) ** 2
      const temoins = tous
        .filter((n) => (n.type === 'rock' || n.type === 'tree' || n.type === 'bloc') && n.stock > 0)
        .sort((a, b) => proche(a) - proche(b))
      return { buisson, temoin: temoins[0] ?? null, total: tous.length }
    })
    if (!couple?.buisson) { console.error('!! aucun buisson à l’écran — rien à mesurer'); return }
    if (!couple.temoin) { console.error('!! aucun nœud témoin près du buisson — la mesure serait confondue'); return }
    const { buisson, temoin } = couple
    console.log(`buisson (${buisson.tx},${buisson.ty}) · témoin ${temoin.type} (${temoin.tx},${temoin.ty})`)

    // On se pose entre les deux : la caméra suit l'avatar, les deux nœuds doivent tenir à l'écran.
    await agir({ type: 'debug_teleport', x: (buisson.tx + temoin.tx) / 2 + 0.5, y: (buisson.ty + temoin.ty) / 2 + 1.5 }, 1200)

    const versEcran = (tx, ty) => page.evaluate(({ x, y }) => {
      const scene = window.__BRAISES__.scene
      const cam = scene.cameras.main
      const gx = (x * 16 - cam.worldView.x) * cam.zoom
      const gy = (y * 16 - cam.worldView.y) * cam.zoom
      const c = scene.scale.canvas.getBoundingClientRect()
      return { x: Math.round(c.left + gx * (c.width / scene.scale.width)), y: Math.round(c.top + gy * (c.height / scene.scale.height)) }
    }, { x: tx, y: ty })

    const COTE = 24
    /** Le FROID d'une tuile : `bleu − rouge` moyen sur le carré du sprite. Le givre bleuit ;
     *  la nuit et la neige bleuissent AUSSI — d'où le témoin, qui les subit à l'identique. */
    const froidDe = async (n) => {
      const c = await versEcran(n.tx + 0.5, n.ty + 0.5)
      const r = await regionAt(page, { x: c.x - COTE / 2, y: c.y - COTE, width: COTE, height: COTE })
      if (!r) return null
      let s = 0
      for (let x = 0; x < COTE; x++) for (let y = 0; y < COTE; y++) { const p = r.px(x, y); s += p[2] - p[0] }
      return Math.round((s / (COTE * COTE)) * 100) / 100
    }

    const releve = async (etiquette) => {
      // Le jour de saison vient du SNAPSHOT (`lastTime`), pas d'un calcul local : c'est la
      // sim qui dit où on en est du calendrier, et c'est elle qui décide du gel.
      const quand = await page.evaluate(() => {
        const t = window.__BRAISES__.scene.lastTime
        return t ? { jour: t.seasonDay, acte: t.act, nuit: t.isNight } : null
      })
      const b = await froidDe(buisson)
      const t = await froidDe(temoin)
      await page.screenshot({ path: `${OUT}/flore-${etiquette}.png` })
      // ET UNE VUE OÙ L'ON VOIT QUELQUE CHOSE : à l'échelle du jeu, un buisson fait une
      // vingtaine de pixels — la capture plein écran prouve la mesure, elle ne montre rien.
      // On zoome sur le couple buisson/témoin, le temps de la photo, puis on rend la caméra.
      await page.evaluate((z) => {
        const cam = window.__BRAISES__.scene.cameras.main
        window.__ZOOM_FLORE__ = cam.zoom
        cam.setZoom(cam.zoom * z)
      }, 3)
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/flore-${etiquette}-zoom.png` })
      await page.evaluate(() => void window.__BRAISES__.scene.cameras.main.setZoom(window.__ZOOM_FLORE__))
      await page.waitForTimeout(300)
      console.log(`  ${etiquette} : buisson ${b} · témoin ${t} · écart ${Math.round((b - t) * 100) / 100}` +
        `${quand ? ` · jour ${quand.jour} acte ${quand.acte}${quand.nuit ? ' NUIT' : ''}` : ''}`)
      return { b, t, ecart: b - t, quand }
    }

    await agir({ type: 'debug_set_hour', hour: 12 }, 900)
    const tiede = await releve('1-tiede')

    // L'ACTE III : la vallée entière passe sous le seuil de gel (45 au mieux, contre 52).
    await agir({ type: 'debug_set_season_day', day: 50 }, 1500)
    await agir({ type: 'debug_set_hour', hour: 12 }, 900) // le saut de tick a bougé la phase du cycle
    const gele = await releve('2-gele')

    const derive = Math.round((gele.ecart - tiede.ecart) * 100) / 100
    console.log(`flore : écart buisson−témoin ${tiede.ecart.toFixed(2)} → ${gele.ecart.toFixed(2)} (dérive ${derive})`)
    if (derive <= 2) {
      console.error(`!! LE GIVRE NE SE VOIT PAS : le buisson ne bleuit pas plus que le témoin (dérive ${derive}). ` +
        'La règle refuse la cueillette sans qu’aucun signe ne l’annonce — G5 rompu.')
    }
    return { tiede, gele, derive }
  },

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
   * LA CLAIRIÈRE DU FEU, LA NUIT (2026-08-03) — trois promesses que seul le navigateur peut tenir,
   * et qu'aucun test unitaire n'atteint : elles vivent dans l'EMPILEMENT des calques.
   *
   *   ① LE CAMP EST ÉCLAIRÉ — le sol près du foyer est franchement plus clair qu'au loin.
   *   ② LA NUIT RESTE LA NUIT — hors du camp, le sol ne bouge pas d'un cheveu quand le village
   *     passe de neutre à pleinement engagé. C'est LA décision d'Alexis (portée CONSTANTE,
   *     l'engagement se lit à la flamme) et c'est la régression qu'on attrape ici : le trou du
   *     voile suivait `fireGlow.radius`, qui double avec l'alignement — mesuré, le sol se
   *     relevait alors jusqu'à 25 tuiles du foyer et dans les coins de l'écran.
   *   ③ LE SOL GARDE SA COULEUR — l'écart entre canaux (donc la saturation) ne s'effondre pas
   *     près du feu. C'est le « sol tout jaune » : un additif trop fort referme R, V et B les
   *     uns sur les autres et rend un kaki plat.
   *
   * On mesure sur le Feu d'un VILLAGE, jamais sur un feu de camp posé : `fireStateAt` rend
   * toujours `lit` pour un Foyer, alors qu'un feu libre s'éteint en cours de scénario — la
   * mesure aurait flanché au hasard de la durée de la passe. Le `warmth` se force CÔTÉ CLIENT
   * (`view.villages`), là même où le rendu le lit : aucune règle de jeu n'est touchée.
   *
   * Exige `--dev` (heure).
   */
  async feuNuit(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    // `worldReady` PRÉCÈDE le premier snapshot : sans cette attente, `view.structures` est vide
    // et le scénario conclurait « aucun Feu » sans avoir rien regardé.
    await page.waitForFunction(
      () => (window.__BRAISES__.scene.view?.structures ?? []).some((s) => s.type === 'fire' && s.villageId > 0),
      null, { timeout: 30000 },
    )

    const feu = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const p = s.predicted
      const fires = (s.view.structures ?? []).filter((f) => f.type === 'fire' && f.villageId > 0)
      fires.sort((a, b) => (a.tx - p.x) ** 2 + (a.ty - p.y) ** 2 - ((b.tx - p.x) ** 2 + (b.ty - p.y) ** 2))
      const f = fires[0]
      s.sendAction({ type: 'debug_teleport', x: f.tx + 0.5, y: f.ty + 4 })
      return { id: f.id, tx: f.tx, ty: f.ty }
    })
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 0 }))
    await page.waitForTimeout(1200)

    /** Points ÉCRAN d'un anneau de 8 directions à `r` tuiles du foyer. */
    const anneau = (r) =>
      page.evaluate(({ tx, ty, r }) => {
        const s = window.__BRAISES__.scene
        const cam = s.cameras.main
        const c = s.scale.canvas.getBoundingClientRect()
        const kx = c.width / s.scale.width
        const ky = c.height / s.scale.height
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]]
        return dirs
          .map(([ux, uy]) => ({
            x: Math.round(c.left + ((tx + 0.5 + ux * r) * 16 - cam.worldView.x) * cam.zoom * kx),
            y: Math.round(c.top + ((ty + 0.5 + uy * r) * 16 - cam.worldView.y) * cam.zoom * ky),
          }))
          // HORS CADRE ou SOUS LE HUD : on les jette ici. Au zoom du jeu (2,25) une tuile fait
          // 36 px : passé ~10 tuiles, un anneau déborde l'écran par le haut et par le bas —
          // `page.screenshot` lèverait, et une sonde qui vise le bandeau ou la ceinture
          // mesurerait de l'interface, pas du sol. Bornes en coordonnées PAGE, comme les points.
          .filter((p) => p.x >= c.left + 2 && p.x <= c.left + c.width - 2
            && p.y >= c.top + 50 && p.y <= c.top + c.height - 120)
      }, { tx: feu.tx, ty: feu.ty, r })

    // r = 1 est ÉCARTÉ : trois de ses huit directions tombent sur les bûches ou la flamme.
    // La référence LOINTAINE est à 12 tuiles : au-delà de la clairière (6) et de sa frange, et
    // l'anneau y garde quatre points. 15 est le plus loin que le cadre autorise au zoom du jeu,
    // mais il n'y reste que la paire horizontale — assez pour comparer deux alignements.
    const RAYONS = [2, 3, 12, 15]
    const anneaux = {}
    for (const r of RAYONS) anneaux[r] = await anneau(r)
    // À 15 tuiles, le cadre ne laisse que la PAIRE HORIZONTALE (au zoom 2,25 la vue ne porte
    // qu'à ~8,6 tuiles vers le haut). Deux points suffisent là où l'on compare les MÊMES
    // points sous deux alignements (critère ②) ; les critères ① et ③, eux, prennent leur
    // référence à 12 tuiles, où l'anneau est encore fourni et où la clairière est finie.
    const maigres = RAYONS.filter((r) => anneaux[r].length < 2)
    if (maigres.length) {
      const cadre = await page.evaluate(() => {
        const s = window.__BRAISES__.scene
        const c = s.scale.canvas.getBoundingClientRect()
        return `zoom ${s.cameras.main.zoom} · canvas ${c.left},${c.top} ${c.width}×${c.height} · scale ${s.scale.width}×${s.scale.height}`
      })
      console.log(`   ✗ anneaux trop entamés par le cadre (${maigres.join(', ')} tuiles) — la mesure ne veut rien dire`)
      console.log(`     ${cadre} · points retenus : ${RAYONS.map((r) => `${r}t→${anneaux[r].length}`).join(' ')}`)
      return
    }

    /** Le pixel MÉDIAN d'un anneau (par luminance) : une touffe ou un PNJ ne décide pas. */
    const lum = ([r, v, b]) => 0.2126 * r + 0.7152 * v + 0.0722 * b
    const releve = async () => {
      const out = {}
      for (const r of RAYONS) {
        const px = []
        for (const p of anneaux[r]) px.push(await pixelAt(page, p.x, p.y))
        const bons = px.filter(Boolean).sort((a, b) => lum(a) - lum(b))
        out[r] = bons.length ? bons[Math.floor(bons.length / 2)] : null
      }
      return out
    }

    // On FIGE la boucle et on avance à `time` constant : le vacillement de la flamme est alors
    // le même sous les deux alignements, et l'écart mesuré ne peut venir que de l'alignement.
    const poser = (warmth) =>
      page.evaluate((w) => {
        const s = window.__BRAISES__.scene
        // Le snapshot réécrit `villages` à chaque tick : on VERROUILLE par un getter, sinon la
        // valeur forcée s'évapore entre le réglage et la capture.
        const fige = s.view.villages.map((v) => ({ ...v, warmth: w }))
        Object.defineProperty(s.view, 'villages', { get: () => fige, set: () => {}, configurable: true })
        const g = s.game
        g.loop.sleep()
        g.step(120000, 16)
        g.step(120016, 16)
      }, warmth)

    await poser(0)
    const neutre = await releve()
    await page.screenshot({ path: `${OUT}/feu-nuit.png` })
    await poser(100)
    const engage = await releve()
    const dire = (t) => RAYONS.map((r) => `${r}t ${t[r] ? t[r].join(',') : '—'}`).join(' · ')
    console.log(`   Feu #${feu.id} en (${feu.tx},${feu.ty}), minuit`)
    console.log(`   village NEUTRE  : ${dire(neutre)}`)
    console.log(`   village ENGAGÉ  : ${dire(engage)}`)

    // ① LE CAMP EST ÉCLAIRÉ.
    // Référence à 12 tuiles : franchement au-delà de la portée du trou (6), et l'anneau y est
    // encore fourni. À 15 tuiles la paire horizontale peut tomber sur un autre terrain — elle
    // sert à comparer deux alignements, pas à étalonner une luminance.
    const pres = lum(neutre[3]), loin = lum(neutre[12])
    console.log(pres > loin + 6
      ? `   ✓ ① la clairière existe : ${pres.toFixed(0)} de luminance à 3 tuiles contre ${loin.toFixed(0)} à 12`
      : `   ✗ ① AUCUNE clairière : ${pres.toFixed(0)} à 3 tuiles contre ${loin.toFixed(0)} à 12`)

    // ② LA NUIT RESTE LA NUIT — la décision « portée constante », au pixel.
    for (const r of [12, 15]) {
      const d = Math.max(...[0, 1, 2].map((i) => Math.abs(neutre[r][i] - engage[r][i])))
      console.log(d <= 3
        ? `   ✓ ② à ${r} tuiles, l'alignement ne change RIEN au sol (écart max ${d})`
        : `   ✗ ② à ${r} tuiles, le sol bouge de ${d} avec l'alignement — la portée s'est recouplée`)
    }

    // ③ LE SOL GARDE SA COULEUR — saturation près du feu vs au loin.
    const sat = (p) => (Math.max(...p) - Math.min(...p)) / Math.max(1, Math.max(...p))
    const sp = sat(neutre[2]), sl = sat(neutre[12])
    console.log(sp >= sl - 0.05
      ? `   ✓ ③ le sol garde sa teinte : saturation ${sp.toFixed(2)} près du feu contre ${sl.toFixed(2)} au loin`
      : `   ✗ ③ le sol est DÉLAVÉ près du feu : saturation ${sp.toFixed(2)} contre ${sl.toFixed(2)} au loin`)
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
        // ⚠ LE HUD N'EST PLUS DANS PHASER. Le compte ci-dessus sert à traquer ce qui FUITE
        // sous l'écran de chargement (un conseil d'onboarding s'y peignait) — mais il ne peut
        // pas répondre à « le HUD est-il là ? » : les vitales et la ceinture sont en DOM
        // (`hud-core.ts`, `.hc-bl` / `.hc-belt`). La sonde exigeait 3 objets Phaser et en
        // comptait 1 : elle rapportait « le HUD ne paraît pas » sur un HUD parfaitement
        // debout, exactement comme R20 cherchait un menu Phaser qui vit en DOM.
        // (Audit UX 2026-08-20, I-2 — même famille.)
        // LES BANDEAUX SONT PASSÉS EN DOM (audit UX P0.2). Le compte Phaser ci-dessus a
        // attrapé le conseil d'ouverture peint sous le voile de chargement — s'il ne voit
        // plus ce canal, la garde se dégrade en silence et le défaut peut revenir sans un
        // mot. On le suit donc là où il vit désormais.
        bandeau: (() => {
          const el = document.querySelector('.bnd')
          if (!el || getComputedStyle(el).display === 'none') return ''
          return [...el.querySelectorAll('.bnd-l')]
            .filter((l) => getComputedStyle(l).display !== 'none' && l.textContent.trim())
            .map((l) => l.textContent.trim().slice(0, 28))
            .join(' | ')
        })(),
        hudDom: ['.hc-bl', '.hc-belt'].filter((sel) => {
          const el = document.querySelector(sel)
          return Boolean(el && getComputedStyle(el).display !== 'none' && Number(getComputedStyle(el).opacity) > 0)
        }),
        // L'écran de chargement lui-même (LOADING_DEPTH = 1001) : présent ou levé ?
        ecran: ui ? ui.children.list.some((o) => o.depth === 1001) : false,
      }
    }

    await page.goto(URL)
    // Le hook est posé dès le `create` de WorldScene — donc AVANT la fin de la génération.
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry), null, { timeout: 30000 })

    const passes = []
    let hudPendant = 0
    let bandeauPendant = ''
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
      if (s.bandeau) bandeauPendant = s.bandeau // un seul suffit à condamner
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
    console.log(hudPendant === 0 && bandeauPendant === ''
      ? `   ✓ pendant l'attente, RIEN du HUD n'est peint (0 objet Phaser, 0 bandeau DOM)`
      : `   ✗ du HUD peint pendant le chargement : ${hudPendant} objet(s) Phaser [${quiPendant.join(', ')}]${bandeauPendant ? ` · bandeau « ${bandeauPendant} »` : ''}`)
    console.log(`   assemblage après la dernière passe : ~${assemblage} ms (ce que la barre ne couvre pas)`)

    await page.waitForTimeout(1500) // le premier snapshot peuple le HUD
    const apres = await page.evaluate(sonde)
    await page.screenshot({ path: `${OUT}/chargement-fini.png` })
    console.log(!apres.ecran
      ? `   ✓ l'écran de chargement est levé`
      : `   ✗ l'écran de chargement colle à la vitre`)
    console.log(apres.hudDom.length >= 2
      ? `   ✓ le HUD est là, en DOM (${apres.hudDom.join(' + ')})`
      : `   ✗ le HUD ne paraît pas (DOM visible : ${apres.hudDom.join(' + ') || 'rien'} ; ${apres.hud} objet(s) Phaser)`)

    return { passes: passes.length, hudPendant, assemblage, hudApres: apres.hudDom.length }
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
    // 6 règles de clic ; les touches sont DÉRIVÉES de `ACTIONS` + la ceinture.
    //
    // ⚠ ON NE FIGE PLUS LE COMPTE EXACT. Il valait 15 quand `ACTIONS` en portait 14 ; la table
    // en peint 17 aujourd'hui, et le verdict criait au loup à chaque passage — sur un menu
    // parfaitement fonctionnel. Un instrument qui hurle pour rien cesse d'être lu, et c'est
    // pire que pas d'instrument : la vraie panne s'y noie. Ce que ce nombre garde est écrit
    // dans le commentaire d'origine — « que le tableau SE PEINT, vide il tomberait à 0 » —
    // et c'est cela qu'on affirme, pas un état du jeu de 2026-07.
    // ⚠ ET LE MÊME REMÈDE VAUT POUR LES CLICS. La garde ci-dessus a été relâchée pour les
    // TOUCHES (« on ne fige plus le compte exact ») mais la ligne figeait encore `clicks !== 6`
    // — la moitié du correctif. La table du clic est passée à 9 lignes le 2026-08-20 (la hache
    // qui abat, semer, fouiller) plus 2 pour le CLIC DROIT, enfin nommé : le verdict criait au
    // loup sur un menu qui venait d'être ENRICHI. On affirme donc la même chose qu'à côté :
    // le tableau SE PEINT — vide, il tomberait à 0.
    if (open.display !== 'flex' || open.clicks < 6 || open.keys < 10 || closed.display !== 'none') {
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
    // ON LAISSE LA VITRINE ENTRER AVANT DE PHOTOGRAPHIER. Les vues du carrousel naissent à
    // `opacity: 0` et montent en `VITRINE_FONDU_S` (1,6 s) ; déclencher tout de suite rendait
    // un accueil au fond NOIR — et cette image a bel et bien induit en erreur, le 2026-08-20 :
    // elle a fait conclure que le voile `.bm-vitrine-bord` écrasait les vues de nuit, alors
    // que ce voile est un dégradé HORIZONTAL qui ne mord que les 90 premiers pixels, contre
    // le rail. Relevé après correction : à t+0 les huit vues sont à 0,000 d'opacité ; à
    // t+3,7 s la première est à 1,000. Une capture qui ment est pire qu'une capture absente.
    await page.waitForFunction(() => [...document.querySelectorAll('.bm-vue')].some((v) => +getComputedStyle(v).opacity > 0.95),
      null, { timeout: 15000, polling: 200 }).catch(() => console.error(`!! la vitrine n'a jamais atteint son opacité pleine`))
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
    const slotDe = (item) => page.evaluate((it) => (window.__BRAISES__.scene.registry.get('inv') ?? [])
      .findIndex((s) => s?.item === it), item)
    const feu = await fonderPres(page, doAction, slotDe, spawn)
    // L'ID DU VILLAGE FONDÉ, tel que la sim me le reconnaît (`fonderPres` le rend avec
    // l'adresse : un seul témoin, cf. sa note). C'est lui qui rend l'assertion finale non
    // tautologique — sans ça, on ne saurait pas distinguer « la stèle couronne MON village »
    // de « la stèle couronne un village PNJ », les deux affichant un nom.
    const monVillageId = feu ? feu.village : null
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
   * (2026-08-21 : la cadence est une RAMPE tirée à l'AUBE — `HORDE_CHANCE` 0,15 → 0,95,
   * exécution au crépuscule via le présage — et rien n'est garanti une nuit donnée. On lève
   * donc la horde par `debug_horde` : la vraie chaîne, sans loterie — c'est le CHAMP DE FLUX
   * qu'on mesure, pas le dé.) God mode, sinon le joueur meurt avant d'avoir mesuré ;
   * cadence ×16, sinon une nuit dure 18 minutes.
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
      s.sendAction({ type: 'debug_set_season_day', day: 45 }) // acte III : le froid arme la marche
      s.perfSamples.length = 0
    })
    await page.waitForTimeout(500)
    // La naissance GARANTIE (2026-08-21) : le tirage de l'aube ne l'est plus, la touche si.
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_horde' }))
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
      // Le pan est : sa ligne est en x0 + 12 — MAIS ses rangées 4 et 5 sont la BRÈCHE du plan
      // (`breches: 11,4,E 11,5,E`, la seconde entrée) : pousser à 5,5 sortait par le trou et
      // la sonde criait « hitbox » sur un passage voulu. On pousse rangée 6, où le mur existe.
      ['est', 9, 6.5, 'KeyD', 12],
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

    // ── FONDER, loin des landmarks (`fonderPres` : l'adresse vient de la sim, pas de l'offset).
    const assise = await fonderPres(page, agir, slotDe, await pos())
    if (assise === null) { console.error('!! aucun village fondé — la porte n’est pas bâtissable'); return }
    const { bx, by } = assise

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

  /**
   * PORTE-DOUBLE (2026-08-01) — R27 : deux vantaux mitoyens font UN cadre.
   *
   * Ce que `pnpm test` ne peut pas voir : que les FAMILLES sont câblées de bout en bout
   * (l'appariement du snapshot choisit `st-door2a/door2b`, pas `st-door`), que pousser UN
   * vantail ouvre l'autre À L'ÉCRAN, que la collision suit sur la tuile du vantail qu'on n'a
   * PAS poussé, et que démolir un vantail rend l'autre à sa famille simple. En horizontal ET
   * en vertical — c'est la demande. Exige `--dev` (TP).
   */
  async 'porte-double'(page) {
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

    // ── FONDER, loin des landmarks (`fonderPres` : l'adresse vient de la sim, pas de l'offset).
    const assise = await fonderPres(page, agir, slotDe, await pos())
    if (assise === null) { console.error('!! aucun village fondé — la porte double n’est pas bâtissable'); return }
    const { bx, by } = assise

    for (let i = 0; i < 14; i++) await agir({ type: 'debug_grant', item: 'wood' }, 90)
    await agir({ type: 'debug_grant', item: 'hammer' }, 180)
    const hslot = await slotDe('hammer')
    if (hslot < 0 || hslot >= 6) { console.error(`!! marteau hors ceinture (case ${hslot})`); return }
    await agir({ type: 'set_active_slot', slot: hslot }, 300)

    const porteEn = (x, y) => page.evaluate(({ px, py }) => {
      const s = window.__BRAISES__.scene.view.structures.find((q) => q.type === 'door' && q.tx === px && q.ty === py)
      return s ? { id: s.id, open: s.open === true } : null
    }, { px: x, py: y })
    const cleDe = (id) => page.evaluate((sid) =>
      window.__BRAISES__.scene.view.structureSprites?.get(sid)?.texture?.key ?? null, id)
    /** Pousse vers le SUD depuis (tx+0.5, ligne−0.5) et rend la position finale (cf. `porte`). */
    const pousserSud = async (tx, ligne) => {
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
    const presserF = async (x, y) => {
      for (let essai = 0; essai < 10; essai++) {
        await agir({ type: 'debug_teleport', x, y }, 340)
        const q = await pos()
        if (Math.abs(q.x - x) < 0.3 && Math.abs(q.y - y) < 0.3) break
      }
      await page.keyboard.press('KeyF')
      await page.waitForTimeout(700)
    }
    const cadrer = async (wx, wy) => {
      await page.evaluate(({ x, y }) => {
        const cam = window.__BRAISES__.scene.cameras.main
        cam.stopFollow()
        cam.setZoom(8)
        cam.centerOn(x * 16, y * 16)
      }, { x: wx, y: wy })
      await page.waitForTimeout(700)
    }

    // ═══ HORIZONTAL : deux vantaux bit SUD, côte à côte en X ═══
    const S = 4
    const ligne = by + 3
    let ax = null
    for (const dx of [0, 1, -1, 2, -2]) {
      const tx = bx + dx
      // DEUX tuiles propres de chaque côté de l'arête : un nœud ferait la mesure à notre place.
      const propre = await page.evaluate(({ x, y }) => (window.__BRAISES__.scene.view.nodes ?? [])
        .every((n) => !((n.tx >= x && n.tx <= x + 1) && (n.ty === y || n.ty === y + 1))), { x: tx, y: ligne - 1 })
      if (!propre) continue
      await agir({ type: 'debug_teleport', x: tx + 0.5, y: ligne - 0.5 }, 300)
      await agir({ type: 'build', structure: 'door', tx, ty: ligne - 1, material: 'wood', edges: S }, 320)
      await agir({ type: 'debug_teleport', x: tx + 1.5, y: ligne - 0.5 }, 300)
      await agir({ type: 'build', structure: 'door', tx: tx + 1, ty: ligne - 1, material: 'wood', edges: S }, 500)
      const ok = await page.evaluate(({ x, y }) => {
        const st = window.__BRAISES__.scene.view.structures
        return st.some((q) => q.type === 'door' && q.tx === x && q.ty === y)
          && st.some((q) => q.type === 'door' && q.tx === x + 1 && q.ty === y)
      }, { x: tx, y: ligne - 1 })
      if (ok) { ax = tx; break }
    }
    if (ax === null) {
      // LE REFUS DE LA SIM, PAS SEULEMENT LE CONSTAT. Sans lui, l'échec accusait la porte
      // double alors que le fautif était la FONDATION (course de 2026-08-03) : le message
      // disait « pas posés », la sim disait « hors du carré du Feu », et les deux ne
      // désignent pas le même coupable.
      const pourquoi = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? null)
      console.error(`!! les deux vantaux ne sont pas posés (refus de la sim : ${pourquoi ?? 'aucun'}) — rien à mesurer`)
      return
    }
    const vantailA = await porteEn(ax, ligne - 1)
    const vantailB = await porteEn(ax + 1, ligne - 1)

    // ① LES FAMILLES : l'appariement du snapshot choisit les MOITIÉS de cadre, ouest puis est.
    const cleA0 = await cleDe(vantailA.id)
    const cleB0 = await cleDe(vantailB.id)
    console.log(`   cadre horizontal en (${ax},${ligne - 1})+(${ax + 1},${ligne - 1}), arête sud — ${cleA0} · ${cleB0}`)
    if (!String(cleA0).startsWith('st-door2a-e4')) console.error(`!! le vantail OUEST n'est pas la moitié a du cadre : ${cleA0}`)
    if (!String(cleB0).startsWith('st-door2b-e4')) console.error(`!! le vantail EST n'est pas la moitié b du cadre : ${cleB0}`)
    const frameDe = (cle) => {
      const m = String(cle).match(/-f(\d+)(?:_lit)?$/)
      return m ? Number(m[1]) : null
    }
    if (frameDe(cleA0) !== 0 || frameDe(cleB0) !== 0) console.error(`!! un vantail neuf n'est pas à la frame 0 (${cleA0} · ${cleB0})`)

    // La photo du cadre CLOS, avant d'y toucher.
    await agir({ type: 'debug_teleport', x: ax + 1, y: ligne + 2.5 }, 320)
    await cadrer(ax + 1, ligne - 0.2)
    await page.screenshot({ path: `${OUT}/porte-double-h-close.png` })

    // ② CLOSE, la tuile du vantail B m'arrête aussi (le cadre est un tout).
    const bloqueB = await pousserSud(ax + 1, ligne)
    // ③ POUSSER LE VANTAIL A OUVRE LES DEUX — état, frames, et le passage PAR B.
    await presserF(ax + 0.5, ligne - 0.5)
    const apresA = await porteEn(ax, ligne - 1)
    const apresB = await porteEn(ax + 1, ligne - 1)
    const cleA1 = await cleDe(vantailA.id)
    const cleB1 = await cleDe(vantailB.id)
    if (apresA.open !== true) console.error('!! la touche n’a pas ouvert le vantail poussé')
    if (apresB.open !== true) console.error('!! LE VANTAIL APPARIÉ NE SUIT PAS : b reste clos')
    if (frameDe(cleA1) !== 4 || frameDe(cleB1) !== 4) console.error(`!! les battants ouverts ne sont pas à la dernière frame (${cleA1} · ${cleB1})`)
    const sortiParB = await pousserSud(ax + 1, ligne)
    // La photo du cadre OUVERT, au même cadrage.
    await agir({ type: 'debug_teleport', x: ax + 1, y: ligne + 2.5 }, 320)
    await cadrer(ax + 1, ligne - 0.2)
    await page.screenshot({ path: `${OUT}/porte-double-h-ouverte.png` })
    // ④ REFERMER PAR B referme A — la symétrie du geste.
    await presserF(ax + 1.5, ligne - 0.5)
    const refermeA = await porteEn(ax, ligne - 1)
    const refermeB = await porteEn(ax + 1, ligne - 1)
    const rebloqueB = await pousserSud(ax + 1, ligne)
    const y = (p2) => (p2 === null ? 'NON MESURÉ' : p2.y.toFixed(2))
    console.log(`   close → y=${y(bloqueB)} par B · F sur A ouvre les deux (${cleA1} · ${cleB1}) → y=${y(sortiParB)} par B · F sur B referme → y=${y(rebloqueB)}`)
    if (bloqueB && bloqueB.y > ligne) console.error(`!! CLOSE, LE VANTAIL B NE M'ARRÊTE PAS : sorti en y=${bloqueB.y.toFixed(2)}`)
    if (sortiParB && sortiParB.y <= ligne) console.error(`!! OUVERTE PAR A, LA TUILE DE B NE LIVRE PAS PASSAGE : arrêté en y=${sortiParB.y.toFixed(2)}`)
    if (refermeA.open !== false || refermeB.open !== false) console.error('!! refermer par B n’a pas refermé les deux vantaux')
    if (rebloqueB && rebloqueB.y > ligne) console.error(`!! REFERMÉE, ELLE NE M'ARRÊTE PLUS : sorti en y=${rebloqueB.y.toFixed(2)}`)

    // ═══ VERTICAL : deux vantaux bit EST, empilés en Y — même règle, autre axe ═══
    const E = 2
    const vx = bx - 2
    const vy = by
    await agir({ type: 'debug_teleport', x: vx + 0.5, y: vy + 0.5 }, 300)
    await agir({ type: 'build', structure: 'door', tx: vx, ty: vy, material: 'wood', edges: E }, 320)
    await agir({ type: 'debug_teleport', x: vx + 0.5, y: vy + 1.5 }, 300)
    await agir({ type: 'build', structure: 'door', tx: vx, ty: vy + 1, material: 'wood', edges: E }, 500)
    const hautV = await porteEn(vx, vy)
    const basV = await porteEn(vx, vy + 1)
    if (hautV === null || basV === null) {
      console.error('!! cadre vertical non posé (terrain ?) — l’axe vertical n’est pas mesuré')
    } else {
      const cleH = await cleDe(hautV.id)
      const cleB2 = await cleDe(basV.id)
      console.log(`   cadre vertical en (${vx},${vy})+(${vx},${vy + 1}), arête est — ${cleH} · ${cleB2}`)
      if (!String(cleH).startsWith('st-door2a-e2')) console.error(`!! le vantail NORD n'est pas la moitié a du cadre : ${cleH}`)
      if (!String(cleB2).startsWith('st-door2b-e2')) console.error(`!! le vantail SUD n'est pas la moitié b du cadre : ${cleB2}`)
      await agir({ type: 'debug_teleport', x: vx - 1.5, y: vy + 1 }, 320)
      await cadrer(vx + 1, vy + 1)
      await page.screenshot({ path: `${OUT}/porte-double-v-close.png` })
      await presserF(vx + 0.5, vy + 0.5)
      const hautOuvert = await porteEn(vx, vy)
      const basOuvert = await porteEn(vx, vy + 1)
      if (hautOuvert.open !== true || basOuvert.open !== true) console.error('!! en vertical, pousser un vantail n’ouvre pas les deux')
      await agir({ type: 'debug_teleport', x: vx - 1.5, y: vy + 1 }, 320)
      await cadrer(vx + 1, vy + 1)
      await page.screenshot({ path: `${OUT}/porte-double-v-ouverte.png` })
    }

    // ═══ DÉMOLIR UN VANTAIL REND L'AUTRE SIMPLE — la dérivation suit, sans rien à nettoyer ═══
    await agir({ type: 'debug_teleport', x: ax + 0.5, y: ligne - 0.5 }, 340)
    await agir({ type: 'demolish', structureId: vantailB.id }, 700)
    const survivant = await cleDe(vantailA.id)
    const disparu = await porteEn(ax + 1, ligne - 1)
    console.log(`   après démolition du vantail b : le survivant lit ${survivant}`)
    if (disparu !== null) console.error('!! le vantail démoli est toujours là — la mesure ne prouve rien')
    else if (!String(survivant).startsWith('st-door-e4')) console.error(`!! LE SURVIVANT NE REDEVIENT PAS UNE PORTE SIMPLE : ${survivant}`)

    // ═══ L'ART DES MOITIÉS, texture par texture — la silhouette DEBOUT, que l'ouvreur ne voit
    // jamais (il est au contact, pan tombé) : close et grande ouverte, deux axes. ═══
    for (const [fam, bit, f] of [
      ['door2a', 4, 0], ['door2b', 4, 0], ['door2a', 4, 4], ['door2b', 4, 4],
      ['door2a', 2, 0], ['door2b', 2, 0], ['door2a', 2, 4], ['door2b', 2, 4],
    ]) {
      const b64 = await page.evaluate(({ cle }) => {
        const src = window.__BRAISES__.scene.textures.get(cle)?.getSourceImage()
        if (!src || !src.toDataURL) return null
        const c2 = document.createElement('canvas')
        c2.width = src.width * 6
        c2.height = src.height * 6
        const g = c2.getContext('2d')
        g.imageSmoothingEnabled = false
        g.fillStyle = '#5c7a3f'
        g.fillRect(0, 0, c2.width, c2.height)
        g.drawImage(src, 0, 0, c2.width, c2.height)
        return c2.toDataURL('image/png').split(',')[1]
      }, { cle: `st-${fam}-e${bit}-f${f}` })
      if (b64 === null) { console.error(`!! texture st-${fam}-e${bit}-f${f} illisible`); continue }
      await writeFile(`${OUT}/porte-double-art-${fam}-e${bit}-f${f}.png`, Buffer.from(b64, 'base64'))
    }
    console.log('   art : 2 moitiés × 2 arêtes × 2 positions exportées')
    return { horizontal: [cleA0, cleB0], demolition: survivant }
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
    const assise = await fonderPres(page, agir, slotDe, p0)
    const { bx, by } = assise ?? { bx: 0, by: 0 }
    if (assise === null) {
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

  /**
   * L'ATELIER DES PLANS (spec `atelier-plans.md` A9) — la page charge, la liste des lieux est
   * celle des `.plan`, la cabane se peint PAR LE MÊME CHEMIN que la souris, et la validation
   * parle (une faute bloque la sauvegarde). Exige un serveur de DEV — l'atelier n'existe pas
   * en build : `--dev` (stack Docker), ou `SMOKE_URL=http://localhost:3000/ … --dev` (hôte).
   */
  async 'atelier'(page) {
    const base = BASE_URL.split('?')[0]
    await page.goto(`${base}${base.endsWith('/') ? '' : '/'}atelier.html`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForFunction(() => window.__ATELIER__?.pret?.(), null, { timeout: 30000 })
    const kinds = await page.evaluate(() => window.__ATELIER__.kinds())
    console.log(`lieux chargés : ${kinds.join(' ')}`)
    if (kinds.length < 9) console.error(`!! ${kinds.length} lieux — les 9 .plan attendus`)

    // LE RENDU EST LE JEU : on attend que le boot Phaser (génération des textures) soit
    // passé et que la scène ait appliqué au moins un snapshot avant de photographier.
    await page.waitForFunction(() => window.__ATELIER__.rendu(), null, { timeout: 60000 })
    await page.evaluate(() => window.__ATELIER__.choisir('cabane'))
    await page.waitForTimeout(1200)
    const avant = await page.evaluate(() => ({ fautes: window.__ATELIER__.etat.fautes.length }))
    console.log(`cabane : ${avant.fautes} faute(s)`)
    if (avant.fautes > 0) console.error('!! la cabane du dépôt ne devrait porter AUCUNE faute')
    await page.screenshot({ path: `${OUT}/atelier-cabane.png` })

    // ── L'AIDE CONTEXTUELLE (demande d'Alexis) : la bande explique l'outil actif, le
    //    survol d'une pièce de palette la remplace par le sens EN JEU, « ? » ouvre la
    //    référence complète. ──
    const aideRepos = await page.evaluate(() => document.getElementById('aide').textContent)
    console.log(`bande d'aide (repos) : ${(aideRepos ?? '').slice(0, 60)}…`)
    if (!(aideRepos ?? '').startsWith('PEINDRE')) console.error('!! la bande d’aide ne décrit pas l’outil actif')
    // Le picker est en CATÉGORIES (demande d'Alexis) : quatre titres, et l'infobulle
    // immédiate au survol d'une pièce.
    const cats = await page.evaluate(() => [...document.querySelectorAll('#palette .cat-titre')].map((c) => c.textContent))
    console.log(`catégories du picker : ${cats.join(' · ')}`)
    if (cats.length < 4) console.error('!! le picker devrait avoir ses quatre catégories')
    await page.hover('#palette .tuile:has-text("chest")') // le coffre K — « part au pillage »
    await page.waitForTimeout(200)
    const aideK = await page.evaluate(() => document.getElementById('aide').textContent)
    if (!(aideK ?? '').includes('pillage')) console.error(`!! le survol de palette n’explique pas la pièce (« ${(aideK ?? '').slice(0, 50)} »)`)
    else console.log(`survol du coffre : ${(aideK ?? '').slice(0, 60)}…`)
    const bulle = await page.evaluate(() => {
      const b = document.getElementById('infobulle')
      return { visible: b.style.display !== 'none', texte: b.textContent ?? '' }
    })
    if (!bulle.visible || !bulle.texte.includes('pillage')) console.error('!! l’infobulle du picker ne se montre pas au survol')
    else console.log(`infobulle : ${bulle.texte.slice(0, 60)}…`)
    await page.screenshot({ path: `${OUT}/atelier-picker.png` })
    await page.mouse.move(10, 400) // on quitte la palette
    await page.keyboard.press('?')
    await page.waitForTimeout(200)
    const panneauVisible = await page.evaluate(() => document.getElementById('aide-panneau').style.display !== 'none')
    if (!panneauVisible) console.error('!! « ? » n’ouvre pas la référence')
    await page.screenshot({ path: `${OUT}/atelier-aide.png` })
    await page.keyboard.press('Escape')

    // ── L'AVATAR DEDANS : les VRAIES règles (nappe, pans) effacent toit et façade. ──
    await page.click('#dedans')
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/atelier-dedans.png` })
    await page.click('#dedans')
    await page.waitForTimeout(600)

    // ── LE FANTÔME : au survol d'une case du plan, la pièce ARMÉE se montre translucide
    //    (la paillasse — distinctive sur le chaume comme sur l'herbe). ──
    await page.evaluate(() => { window.__ATELIER__.etat.car = 'L' })
    const boite = await page.locator('#jeu canvas').boundingBox()
    if (boite) {
      await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2)
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/atelier-fantome.png` })
    }

    // ── ON PEINT une paillasse en (3,1), par le même chemin que la souris, et le TEXTE du
    //    .plan la porte (c'est lui qu'on sauvera — la preuve va jusqu'au format). ──
    await page.evaluate(() => window.__ATELIER__.peindre(3, 1, 'L'))
    await page.waitForTimeout(200)
    const texte = await page.evaluate(() => window.__ATELIER__.texteCourant())
    const rangee1 = (texte.split('grille:')[1] ?? '').trim().split('\n')[1] ?? ''
    console.log(`rangée peinte : ${rangee1} (attendu ·::L·)`)
    if (rangee1 !== '·::L·') console.error('!! la peinture n’a pas atteint le texte du .plan')
    await page.screenshot({ path: `${OUT}/atelier-cabane-peinte.png` })

    // ── UNE FAUTE PARLE et BLOQUE : un caractère inconnu rougit, la sauvegarde se ferme. ──
    await page.evaluate(() => window.__ATELIER__.peindre(3, 1, 'Z'))
    await page.waitForTimeout(200)
    const fautes = await page.evaluate(() => window.__ATELIER__.etat.fautes)
    console.log(`après un « Z » : ${fautes.length} faute(s) — ${fautes[0] ?? ''}`)
    if (fautes.length === 0) console.error('!! le caractère inconnu ne rougit pas')
    const bloquee = await page.evaluate(() => document.getElementById('sauver').disabled)
    if (!bloquee) console.error('!! la sauvegarde devrait être BLOQUÉE sur une faute')
    await page.screenshot({ path: `${OUT}/atelier-cabane-faute.png` })

    // ── L'ANNULATION (P-A) : deux pas en arrière (le L, puis le Z) ramènent le .plan du
    //    disque AU CARACTÈRE PRÈS — c'est la garde de l'historique entier. ──
    await page.evaluate(() => { window.__ATELIER__.annuler(); window.__ATELIER__.annuler() })
    await page.waitForTimeout(400)
    const revenu = await page.evaluate(() => window.__ATELIER__.texteCourant() === window.__ATELIER__.etat.textes.get('cabane'))
    console.log(`annuler ×2 : ${revenu ? 'le .plan du disque est revenu' : 'ÉCART'}`)
    if (!revenu) console.error('!! l’annulation ne ramène pas l’état d’origine')

    // ── P-B : LA SÉLECTION À LA VRAIE SOURIS — tirer, copier, coller ailleurs, annuler
    //    d'UN coup (une entrée d'historique par collage). ──
    const boiteJeu = await page.locator('#jeu canvas').boundingBox()
    const ecran = async (rx, ry) => {
      const p = await page.evaluate(([a, b]) => window.__ATELIER__.ecran(a, b), [rx, ry])
      return { x: boiteJeu.x + p.x, y: boiteJeu.y + p.y }
    }
    await page.click('#toolbar label:has(input[value="selection"])')
    const de = await ecran(1, 1)
    const jusqua = await ecran(3, 2)
    await page.mouse.move(de.x, de.y)
    await page.mouse.down()
    await page.mouse.move(jusqua.x, jusqua.y, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Control+v')
    const cible = await ecran(0, 0)
    await page.mouse.move(cible.x, cible.y)
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const fautesColle = await page.evaluate(() => window.__ATELIER__.etat.fautes.length)
    console.log(`sélection 3×2 collée en (0,0) : ${fautesColle} faute(s) (attendu > 0 — la région touche le bord)`)
    if (fautesColle === 0) console.error('!! le collage n’a rien changé, ou la garde du bord s’est tue')
    await page.evaluate(() => window.__ATELIER__.annuler())
    await page.waitForTimeout(300)
    const defait = await page.evaluate(() => window.__ATELIER__.texteCourant() === window.__ATELIER__.etat.textes.get('cabane'))
    console.log(`annuler ×1 : ${defait ? 'le collage entier est défait' : 'ÉCART'}`)
    if (!defait) console.error('!! un coup d’annuler ne défait pas le collage entier')
    await page.click('#toolbar label:has(input[value="peindre"])')

    // ── P-C : LA PLANCHE arrive seule (auto, 900 ms après la dernière édition) — six
    //    vignettes rendues par le mini-jeu, coût MESURÉ affiché. ──
    await page.waitForFunction(() => document.querySelectorAll('#planche img').length >= 6, null, { timeout: 60000 })
    const cout = await page.evaluate(() => document.getElementById('planche-cout').textContent)
    console.log(`planche : 6 vignettes — ${cout}`)
    await page.screenshot({ path: `${OUT}/atelier-pro.png` })

    // ── P-D : LE DIFF (une édition → « voir le diff » → des lignes + et −) et
    //    L'HISTORIQUE GIT (sur l'hôte ; le conteneur répond 501, toléré). ──
    await page.evaluate(() => window.__ATELIER__.peindre(1, 1, 'o'))
    await page.waitForTimeout(300)
    await page.click('#voir-diff')
    const dPlus = await page.evaluate(() => document.querySelectorAll('#diff .plus').length)
    const dMoins = await page.evaluate(() => document.querySelectorAll('#diff .moins').length)
    console.log(`diff : +${dPlus} / −${dMoins} ligne(s) (attendu 1/1 — une rangée changée)`)
    if (dPlus !== 1 || dMoins !== 1) console.error('!! le diff ne montre pas la rangée changée')
    await page.evaluate(() => window.__ATELIER__.annuler())
    await page.click('#historique-maj')
    await page.waitForTimeout(1500)
    const histo = await page.evaluate(() => document.getElementById('historique').textContent)
    console.log(`historique : ${(histo ?? '').split('\n')[0].slice(0, 80) || '(vide)'}`)

    // ── LES LIEUX NATURELS (demande d'Alexis) : un kind SANS plan s'ouvre en APERÇU — le
    //    vrai sprite du jeu, l'empreinte, et « ébaucher un plan » proposé. C'était la grotte,
    //    PROMUE depuis (étage 3, 2026-08-10 : son plan est son antre) — la sonde suit le
    //    monde : l'erratique est le naturel de référence tant qu'il n'a pas de plan. ──
    await page.evaluate(() => window.__ATELIER__.choisir('erratique'))
    await page.waitForTimeout(900)
    const naturel = await page.evaluate(() => ({
      mode: window.__ATELIER__.etat.naturel,
      info: document.getElementById('validation').textContent ?? '',
    }))
    console.log(`naturel : ${naturel.mode} — ${naturel.info.slice(0, 60)}…`)
    if (naturel.mode !== 'erratique' || !naturel.info.includes('empreinte')) console.error('!! l’aperçu naturel de l’erratique ne se monte pas')
    await page.screenshot({ path: `${OUT}/atelier-naturel.png` })
    await page.evaluate(() => window.__ATELIER__.choisir('cabane'))
    await page.waitForTimeout(600)

    // ── P-E : CRÉER UN BROUILLON (hors-monde) — dialogues acceptés, fichier vérifié puis
    //    nettoyé. Sur un dépôt en lecture seule, la création échoue proprement : toléré. ──
    const reponses = ['essai_bac', '4']
    const surDialogue = (d) => { void d.accept(reponses.shift() ?? '') }
    page.on('dialog', surDialogue)
    await page.click('#nouveau')
    await page.waitForTimeout(600)
    // Le handler ne survit PAS à la création : il avalerait ensuite tout confirm() en
    // l'ACCEPTANT — la garde « éditions non sauvées » deviendrait invisible au smoke.
    page.off('dialog', surDialogue)
    const dialogueInattendu = (d) => {
      console.error(`!! dialogue inattendu : ${d.type()} « ${d.message().slice(0, 80)} »`)
      void d.dismiss()
    }
    page.on('dialog', dialogueInattendu)
    const creation = await page.evaluate(() => ({
      la: window.__ATELIER__.etat.brouillons.has('essai_bac'),
      etat: document.getElementById('etat').textContent,
    }))
    if (creation.la) {
      console.log('brouillon « essai_bac » créé (plans/brouillons/, hors-monde)')
      const { unlinkSync, existsSync } = await import('node:fs')
      const brouillon = resolve(ROOT, 'packages/sim/src/plans/brouillons/essai_bac.plan')
      if (existsSync(brouillon)) {
        unlinkSync(brouillon)
        console.log('   …et nettoyé (le smoke ne laisse pas de trace)')
      }
    } else {
      console.log(`création de brouillon : ${creation.etat} (dépôt en lecture seule ? toléré)`)
    }

    // ── LES BADGES D'ARÊTES (P-A) : la ferme porte brèches, seuils ET passages — les trois
    //    couleurs doivent se voir en permanence, plus seulement au survol. ──
    await page.evaluate(() => window.__ATELIER__.choisir('ferme_ruinee'))
    await page.waitForTimeout(1400)
    await page.screenshot({ path: `${OUT}/atelier-etabli-ferme.png` })

    // ── LE VOCABULAIRE NATUREL (spec lieux-batis N7) : un brouillon mêle un ANTRE (sol roc,
    //    parois dérivées du pourtour, jamais de toit), des ROCHERS, un ÉBOULIS et de VRAIS
    //    nœuds (arbre, baies) — il se valide, se bâtit, se capture. En dernier : il laisse
    //    des éditions non sauvées, aucun probe ne doit passer derrière. ──
    page.off('dialog', dialogueInattendu)
    const reponsesN7 = ['essai_antre', '9']
    const surDialogueN7 = (d) => { void d.accept(reponsesN7.shift() ?? '') }
    page.on('dialog', surDialogueN7)
    await page.click('#nouveau')
    await page.waitForTimeout(600)
    page.off('dialog', surDialogueN7)
    page.on('dialog', dialogueInattendu)
    const laN7 = await page.evaluate(() => window.__ATELIER__.etat.brouillons.has('essai_antre'))
    if (laN7) {
      // Le fichier est SUR LE DISQUE dès la création (endpoint dev) : le nettoyage vit dans
      // un finally — un probe qui casse ne doit pas laisser un .plan orphelin non gitignoré.
      try {
        await page.evaluate(() => {
          const A = window.__ATELIER__
          // L'ANNEAU DE MASSIF D'ABORD (révision du 2026-08-11) : la garde de clôture exige
          // que tout le pourtour d'un antre soit massif (H) ou passage — un antre nu est
          // désormais une FAUTE, et c'est le contrat qu'on vérifie à zéro faute plus bas.
          for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) {
            if (y === 1 || y === 5 || x === 1 || x === 5) A.peindre(x, y, 'H')
          }
          for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) A.peindre(x, y, 'r')
          A.peindre(7, 2, 'R')
          A.peindre(7, 3, 'e')
          A.peindre(6, 6, 'Y')
          A.peindre(2, 7, 'B')
          // Le VOCABULAIRE MINIER (étage 3 revu) : la mine se compose en pièces.
          A.peindre(4, 7, 'n') //  l'entrée de galerie
          A.peindre(6, 8, 'D') //  le chevalement
          A.peindre(8, 5, 'w') //  le wagonnet
        })
        await page.waitForTimeout(1200)
        const n7 = await page.evaluate(() => ({
          fautes: window.__ATELIER__.etat.fautes.length,
          texte: window.__ATELIER__.texteCourant(),
          //  la GRILLE seule — la prose d'en-tête contient tous les « n » qu'on veut
          grille: window.__ATELIER__.texteCourant().split('grille:')[1] ?? '',
        }))
        console.log(`antre 3×3 ceint de massif + rocher + éboulis + arbre + baies + galerie/chevalement/wagonnet : ${n7.fautes} faute(s) (attendu 0)`)
        if (n7.fautes > 0) console.error('!! le vocabulaire naturel ne se valide pas dans un brouillon sain')
        if (!n7.texte.includes('rrr') || !n7.texte.includes('Y') || !n7.texte.includes('B')) console.error('!! le texte du plan ne porte pas le vocabulaire peint')
        for (const corps of ['n', 'D', 'w', 'H']) {
          if (!n7.grille.includes(corps)) console.error(`!! la pièce « ${corps} » manque à la grille du plan`)
        }
        await page.screenshot({ path: `${OUT}/atelier-antre.png` })
      } finally {
        const { unlinkSync: rmN7, existsSync: ilYaN7 } = await import('node:fs')
        const planN7 = resolve(ROOT, 'packages/sim/src/plans/brouillons/essai_antre.plan')
        if (ilYaN7(planN7)) rmN7(planN7)
      }
    } else {
      console.log('brouillon N7 : création refusée (dépôt en lecture seule ? toléré)')
    }
  },

  /**
   * LES TOITS ET LE DEDANS/DEHORS (calage instrumenté, spec construction R24 — 2026-08-10).
   *
   * On ne cale pas un toit à l'œil : on MESURE, sur les vrais sprites du jeu, quatre choses
   * pour chaque lieu à salle couverte (cabane, abri) —
   *   1. TROUS — toute case de salle couverte porte un toit, le mobilier compris (la paillasse
   *      et le coffre perçaient le chaume) ;
   *   2. COUTURE — le bord bas du plan de toit rejoint la crête du mur sud : écart SIGNÉ en px
   *      entre deux bords MESURÉS (jamais une constante recopiée). Négatif = recouvrement
   *      (attendu : le demi-débord de bande), positif = jour entre toit et mur ;
   *   3. OCCLUSION — depuis DEHORS, le mobilier de la cabane est entièrement sous l'union
   *      toits opaques + façade sud (échantillonné au pas de 2 px sur les rects des sprites).
   *      L'abri n'est PAS asservi : son côté ouvert MONTRE l'intérieur, c'est le design ;
   *   4. DEDANS — téléporté sous le toit, tous les toits du lieu fondent (alpha 0,12) ;
   *      ressorti, ils redeviennent pleins.
   * Exige `--dev` (TP + heure). Captures dehors/dedans par lieu, étiquetées SMOKE_TAG.
   */
  async 'toits'(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    const tp = async (x, y) => {
      for (let essai = 0; essai < 6; essai++) {
        await page.evaluate(({ x, y }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y }), { x, y })
        await page.waitForTimeout(380)
        const q = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
        if (q && Math.abs(q.x - x) < 0.7 && Math.abs(q.y - y) < 0.7) return
      }
      console.error(`!! TP raté vers (${x}, ${y}) — le debug est-il armé ? (ce scénario exige --dev)`)
    }
    const cadrer = (x, y, z) => page.evaluate(({ x, y, z }) => {
      const cam = window.__BRAISES__.scene.cameras.main
      cam.stopFollow()
      cam.setZoom(z)
      cam.centerOn(x * 16, y * 16)
    }, { x, y, z })
    /** Toutes les sondes d'un lieu, d'un coup, dans la page — sur les sprites RÉELS. */
    const mesurer = (z) => page.evaluate((z) => {
      const vue = window.__BRAISES__.scene.view
      const dans = (s) => s.tx >= z.x - 1 && s.tx <= z.x + z.w && s.ty >= z.y - 1 && s.ty <= z.y + z.h
      const tous = (vue?.structures ?? []).filter(dans)
      const rect = (s) => {
        const sp = vue?.structureSprites?.get(s.id)
        if (!sp) return null
        const l = sp.x - sp.originX * sp.displayWidth
        const t = sp.y - sp.originY * sp.displayHeight
        return { l, t, r: l + sp.displayWidth, b: t + sp.displayHeight, alpha: sp.alpha, key: sp.texture ? sp.texture.key : '' }
      }
      const toits = tous.filter((s) => s.type === 'roof')
      const sols = tous.filter((s) => s.type === 'floor')
      // 1. LES TROUS — le sim fait foi : une case dallée d'une salle couverte sans toit dessus.
      const aToit = new Set(toits.map((s) => `${s.tx},${s.ty}`))
      const trous = sols.filter((s) => !aToit.has(`${s.tx},${s.ty}`)).map((s) => `${s.tx},${s.ty}`)
      // 2. LA COUTURE SUD — deux bords mesurés : bas du plan de toit, crête de la façade sud
      //    (les murs qui bordent la salle par le sud vivent sur la tuile EXTÉRIEURE, une rangée
      //    sous la dernière rangée dallée ; leur sprite commence à la crête, on lit son top).
      const rangs = [...toits, ...sols].map((s) => s.ty)
      const bas = Math.max(...rangs)
      const rToits = toits.map(rect).filter(Boolean)
      const planToit = rToits.length
        ? {
            t: Math.min(...rToits.map((r) => r.t)), b: Math.max(...rToits.map((r) => r.b)),
            l: Math.min(...rToits.map((r) => r.l)), r: Math.max(...rToits.map((r) => r.r)),
          }
        : null
      const facadeSud = tous
        .filter((s) => s.ty === bas + 1 && (s.type === 'wall' || s.type === 'door' || s.type === 'encadrement'))
        .map((s) => ({ type: s.type, r: rect(s) }))
        .filter((f) => f.r)
      const creteSud = facadeSud.length ? Math.min(...facadeSud.map((f) => f.r.t)) : null
      const couture = planToit && creteSud !== null ? creteSud - planToit.b : null
      // 3. L'OCCLUSION DU MOBILIER — chaque sprite de mobilier, échantillonné au pas de 2 px,
      //    doit tomber dans l'union de ce qui est vraiment OPAQUE (revue du 2026-08-10 : un
      //    cadre de sprite n'est pas de la couverture). Sont donc écartés : les bandes E/O
      //    (cadre surtout transparent), la porte et l'ENCADREMENT (huisserie PERCÉE — compter
      //    leur cadre couvrirait ce qu'on voit à travers), et le toit RUINÉ (`st-roof-ruine`,
      //    troué par construction). La mesure n'en devient que plus stricte, jamais plus lâche.
      const MOBILIER = new Set(['atre', 'table', 'banc', 'paillasse', 'etagere', 'tonneau', 'chest', 'poutre'])
      const couvre = [
        ...rToits.filter((r) => r.alpha === 1 && !r.key.includes('ruine')),
        ...facadeSud.filter((f) => f.type === 'wall').map((f) => f.r),
      ]
      const decouverts = {}
      for (const s of tous) {
        if (!MOBILIER.has(s.type)) continue
        const r = rect(s)
        if (!r) continue
        let nus = 0
        for (let px = r.l + 1; px < r.r; px += 2) {
          for (let py = r.t + 1; py < r.b; py += 2) {
            if (!couvre.some((c) => px >= c.l && px < c.r && py >= c.t && py < c.b)) nus++
          }
        }
        if (nus > 0) decouverts[`${s.type}@${s.tx},${s.ty}`] = nus
      }
      // 4. LE FADE — l'alpha de chaque toit, réduit à l'ensemble de ses valeurs distinctes.
      const alphas = [...new Set(rToits.map((r) => Math.round(r.alpha * 100) / 100))].sort()
      return { nToits: toits.length, trous, planToit, creteSud, couture, decouverts, alphas }
    }, z)

    const lieux = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      const out = []
      for (const k of ['cabane', 'abri']) {
        const z = (m.zones ?? []).find((q) => q.kind === k)
        if (z) out.push({ kind: k, x: z.x, y: z.y, w: z.w, h: z.h })
      }
      return out
    })
    if (lieux.length < 2) console.error(`!! ${lieux.length} lieu(x) couvert(s) trouvé(s) — il faut la cabane ET l'abri`)

    const tag = process.env.SMOKE_TAG ?? 'avant'
    for (const z of lieux) {
      const cx = z.x + z.w / 2
      const cy = z.y + z.h / 2
      // ── DEHORS : l'avatar au sud dans l'herbe, la caméra sur le lieu ──
      await tp(cx, z.y + z.h + 3)
      await cadrer(cx, cy, 4.5)
      await page.waitForTimeout(900)
      const dehors = await mesurer(z)
      console.log(`\n── ${z.kind} (${z.w}×${z.h}) — ${dehors.nToits} toits ──`)
      if (dehors.nToits === 0) {
        // Un lieu BRÛLÉ ne pose légitimement aucun toit (le feu l'a pris) : sur une telle
        // seed, les mesures de couverture n'ont pas d'objet — on le DIT au lieu de rougir.
        console.log('   aucun toit — lieu brûlé sur cette seed : mesures de couverture sans objet')
        continue
      }
      console.log(`   trous de couverture : ${dehors.trous.length ? dehors.trous.join(' ') : 'aucun'}`)
      if (dehors.trous.length) console.error(`!! ${dehors.trous.length} case(s) de salle couverte SANS toit — le mobilier perce le chaume`)
      if (dehors.couture !== null) {
        console.log(`   couture sud : crête ${dehors.creteSud} − bas du toit ${dehors.planToit.b} = ${dehors.couture} px (attendu ∈ [−6, 0])`)
        if (dehors.couture > 0) console.error(`!! JOUR entre le toit et la crête du mur sud (${dehors.couture} px) — le plan de toit est trop haut`)
        else if (dehors.couture < -6) console.error(`!! le toit RECOUVRE la façade sud de ${-dehors.couture} px — un tapis au sol, pas un toit`)
      } else {
        // Une mesure qui n'existe pas se DIT (l'abri tourné, côté ouvert au sud : pas de
        // façade sous le toit) — sinon son absence passerait pour un vert.
        console.log('   couture sud : non mesurable — pas de façade au sud (côté ouvert ou lieu tourné)')
      }
      const nus = Object.entries(dehors.decouverts)
      console.log(`   mobilier à découvert (dehors) : ${nus.length ? nus.map(([k, v]) => `${k} (${v} pts)`).join(' · ') : 'aucun'}`)
      if (z.kind === 'cabane' && nus.length) console.error('!! ON VOIT LE MOBILIER DE LA CABANE DEPUIS DEHORS — le toit ne couvre pas son volume')
      if (dehors.alphas.some((a) => a !== 1)) console.error(`!! toits non opaques depuis dehors : alphas ${JSON.stringify(dehors.alphas)}`)
      await page.screenshot({ path: `${OUT}/toits-${tag}-${z.kind}-dehors.png` })
      await cadrer(cx, cy, 2.6)
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/toits-${tag}-${z.kind}-dehors-moyen.png` })

      // ── DEDANS : sous le toit, le couvert fond d'un coup ──
      await tp(cx, cy)
      await cadrer(cx, cy, 4.5)
      await page.waitForTimeout(900)
      const dedans = await mesurer(z)
      // Décision du 2026-08-10 : dedans, le toit disparaît COMPLÈTEMENT (comme les pans).
      console.log(`   alphas dedans : ${JSON.stringify(dedans.alphas)} (attendu [0])`)
      if (dedans.alphas.length !== 1 || dedans.alphas[0] !== 0) console.error('!! le toit ne s’efface pas (ou pas entier) quand on est dessous')
      await page.screenshot({ path: `${OUT}/toits-${tag}-${z.kind}-dedans.png` })

      // ── RESSORTI : le couvert se referme ──
      await tp(cx, z.y + z.h + 3)
      await page.waitForTimeout(900)
      const retour = await mesurer(z)
      if (retour.alphas.some((a) => a !== 1)) console.error(`!! ressorti, le toit reste fondu : alphas ${JSON.stringify(retour.alphas)}`)
    }
  },

  async 'lieux-batis'(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)

    // Plein jour : on compare des FORMES, pas des ambiances nocturnes.
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    // SMOKE_KIND=grotte : ne cadrer qu'UN lieu — la boucle des dix prend du temps quand on
    // ne juge qu'une promotion.
    const seulKind = process.env.SMOKE_KIND ?? null
    const toutes = await page.evaluate(() => {
      const m = window.__BRAISES__.scene.map
      // Les lieux bâtis (étages 1 et 3, spec lieux-batis.md) : la planche couvre tout BUILT_KINDS.
      const KINDS = ['ferme_ruinee', 'cabane', 'ruines', 'abri', 'mine', 'oratoire', 'bivouac', 'charrette', 'epave', 'grotte']
      const out = []
      for (const k of KINDS) {
        const z = (m.zones ?? []).find((q) => q.kind === k)
        if (z) out.push({ kind: k, x: z.x + z.w / 2, y: z.y + z.h / 2, w: z.w, h: z.h, name: z.name })
      }
      return out
    })
    const cibles = seulKind === null ? toutes : toutes.filter((c) => c.kind === seulKind)
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
        // L'avatar se pose SOUS le lieu, pas dessus : téléporté au centre, il masquait la
        // pièce maîtresse des petits plans (l'autel, la charrette) — la capture mentait.
        // Et la caméra se DÉCOUPLE du corps (stopFollow + centerOn, le patron du harnais) :
        // elle cadre le lieu, pas celui qui le regarde.
        await page.evaluate(({ x, y, cy, z }) => {
          window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x, y })
          const cam = window.__BRAISES__.scene.cameras.main
          cam.setZoom(z)
          cam.stopFollow()
          cam.centerOn(x * 16, cy * 16)
        }, { x: c.x, y: c.y + c.h / 2 + 2, cy: c.y, z: zoom })
        await page.waitForTimeout(1400)
        // SwiftShader au zoom LARGE sur un biome dense (karst) dépasse les 30 s du défaut
        // Playwright — mesuré le 2026-08-10 : le budget se déclare, il ne se subit pas.
        await page.screenshot({ path: `${OUT}/batis-${etiquette}-${c.kind}-${nom}.png`, timeout: 90000 })
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
    // `endFires` n'a JAMAIS existé : le scénario jetait un `ReferenceError` sur cette ligne
    // depuis le commit qui l'a livré (2026-07-23), donc il sortait en 1 à chaque appel — la
    // vérification interne passait, mais personne ne pouvait s'en servir comme garde, et
    // `decisions.md` citait pourtant ce scénario comme PREUVE du garde-fou d'accessibilité.
    // On rend ce que la fonction a réellement mesuré. (Audit UX 2026-08-20, I-1.)
    return { reduit, normal, voile: veil }
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

  /**
   * LES CINQ CIELS ET LA FOUDRE (spec `meteo.md`, tranche de rendu).
   *
   * Sept tranches ont rendu la météo mordante — le froid, la faim du feu, le silence du
   * gibier, le pas alourdi, les yeux voilés, la foudre — et RIEN ne se voyait. Ce scénario
   * ne demande pas si c'est joli : il arme un front de chaque type sur le VRAI jeu, se place
   * dedans, et MESURE ce que la capture montre.
   *
   * ═══ POURQUOI IL FAUT ARMER LES FRONTS À LA MAIN ═══
   *
   * Pas par commodité : par NÉCESSITÉ, et c'est mesuré. En Veillée (`VEILLEE_SEASON_CYCLES`
   * = 6, `TICKS_PER_CYCLE` = 57 600), l'élection ne tombe qu'aux bords de cycle — les jours
   * de saison 1, 11, 21, 31, 41, 51… Balayés sur 40 cycles, ces jours-là n'élisent JAMAIS
   * `pluie` ni `orage` : la table de l'acte III ne porte pas la pluie du tout, et l'orage y
   * pèse 0,05. Deux des cinq ciels sont donc INOBSERVABLES en jouant. D'où `debug_meteo`,
   * qui pose un VRAI record d'élection (toute la chaîne d'effets suit) à une PHASE choisie
   * de sa traversée — sans quoi il faudrait regarder passer 24 minutes de bande.
   *
   * ═══ CE QU'IL RELÈVE ═══
   *
   * Pour chaque type, deux positions et le même relevé qu'`etalonnage` (µ, σ, σ/µ, centiles)
   * sur les pixels rendus, MOINS le monde nu au même endroit à la même heure : ce que le
   * ciel change, en nombres, pas en adjectifs.
   *
   *   • AU CŒUR (intensité 1) — le ciel plein ;
   *   • SUR LA LISIÈRE (le bord AVANT de la bande, celui qui gagne du terrain) — et là on
   *     relève un PROFIL de luminance en travers de l'écran : si la lisière se voit, la
   *     moitié sous le front et la moitié au clair ne rendent pas le même nombre.
   *
   * La foudre se guette DANS LA PAGE (boucle `requestAnimationFrame`, aucun aller-retour) :
   * la fenêtre de télégraphe dure 30 ticks (1,5 s) toutes les 400 (20 s), et l'éclair un
   * souffle — un sondage par `waitForTimeout` les manquerait. Dès que la sonde bascule, on
   * fige la boucle (`game.loop.sleep()`) et on photographie : l'horloge headless galope
   * ~12× trop vite, un FX éphémère se serait éteint avant l'obturateur.
   *
   * Exige `--dev` (TP et `debug_meteo` sont inertes en build de production).
   */
  async meteo(page) {
    if (!dev) {
      console.log('\n(la météo exige le mode debug pour armer un front — relancer avec --dev)')
      return {}
    }
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)

    const agir = async (action, ms = 260) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }

    // MIDI : le ciel se juge sur un monde ÉCLAIRÉ. La nuit assombrit tout, y compris le
    // rideau — on ne saurait plus si c'est la pluie ou l'heure qui a fait le nombre.
    await agir({ type: 'debug_set_hour', hour: 12 }, 900)
    // Invulnérable : l'orage frappe pour de vrai (35 PV dans 1,5 tuile) et on va se planter
    // sous les impacts. Un avatar mort ferait tomber le voile de mort sur la photo.
    await agir({ type: 'debug_god', on: true }, 200)

    /** Le relevé d'`etalonnage`, au mot près : µ, σ, σ/µ et centiles sur la frame rendue. */
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
        // On saute la bande du HUD en bas : elle ne subit aucun ciel, elle diluerait tout.
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

    /**
     * LE MÊME RELEVÉ, MAIS SUR UNE CAPTURE — obligatoire quand la boucle est FIGÉE.
     *
     * `game.renderer.snapshot()` ne rend la main qu'à la passe de rendu SUIVANTE. Boucle
     * endormie (`game.loop.sleep()`), cette passe n'arrive jamais : l'appel ne résout pas,
     * et le scénario reste pendu — MESURÉ, un premier jet est resté bloqué 12 minutes après
     * le télégraphe, jusqu'à ce qu'on le tue. Or c'est PRÉCISÉMENT pour les FX éphémères
     * qu'on fige. On lit donc l'image que Playwright, lui, sait composer sans le moteur.
     */
    const mesurerFige = async () => {
      const r = await regionAt(page, { x: 0, y: 0, width: 1280, height: 660 }) // hors bande HUD
      if (!r) return null
      const lum = []
      for (let y = 0; y < r.h; y += 2) {
        for (let x = 0; x < r.w; x += 2) {
          const [rr, vv, bb] = r.px(x, y)
          lum.push(0.2126 * rr + 0.7152 * vv + 0.0722 * bb)
        }
      }
      lum.sort((a, b) => a - b)
      const moy = lum.reduce((a, b) => a + b, 0) / lum.length
      const ec = Math.sqrt(lum.reduce((a, b) => a + (b - moy) ** 2, 0) / lum.length)
      const pc = (q) => lum[Math.floor(q * (lum.length - 1))]
      return { moy, ec, cv: ec / moy, p01: pc(0.01), p50: pc(0.5), p99: pc(0.99) }
    }

    /** La luminance moyenne de DEUX moitiés d'écran, gauche et droite — l'instrument de la
     *  lisière : si le bord de bande se voit, les deux moitiés ne rendent pas le même nombre. */
    const moities = async () =>
      page.evaluate(async () => {
        const s = window.__BRAISES__.scene
        const img = await new Promise((ok) => s.game.renderer.snapshot((i) => ok(i)))
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const cx = c.getContext('2d', { willReadFrequently: true })
        cx.drawImage(img, 0, 0)
        const d = cx.getImageData(0, 0, c.width, c.height).data
        let sg = 0, ng = 0, sd = 0, nd = 0
        // Une MARGE de 15 % de part et d'autre du centre : la lisière n'est pas un couteau
        // (c'est une rampe), et moyenner jusqu'au trait mélangerait les deux régimes.
        const marge = Math.round(c.width * 0.15)
        for (let y = 0; y < c.height - 140; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            const i = (y * c.width + x) * 4
            const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
            if (x < c.width / 2 - marge) { sg += l; ng++ } else if (x > c.width / 2 + marge) { sd += l; nd++ }
          }
        }
        return { gauche: sg / Math.max(1, ng), droite: sd / Math.max(1, nd) }
      })

    const etat = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      return {
        front: s.view.meteo,
        bande: s.meteoLayer?.bande ?? null,
        intensite: s.meteoLayer?.intensiteAuJoueur ?? 0,
        pos: s.registry.get('playerPos'),
        map: { w: s.map.width, h: s.map.height },
        heure: s.lastTime?.hourOfCycle ?? -1,
      }
    })

    /**
     * ATTENDRE QUE LE CIEL SOIT AU REPOS — sinon la photo de l'orage est celle d'un ÉCLAIR.
     *
     * MESURÉ, et c'est spectaculaire : une prise de l'orage tombée pendant un embrasement a
     * rendu µ = 205,3 (Δ +69,4 contre le sol nu) et σ/µ = 0,057, c'est-à-dire un écran BLANC
     * ET PLAT — alors que l'orage au repos rend µ = 108 (Δ −26,4). Le même ciel, deux
     * mesures opposées, selon qu'on a appuyé sur l'obturateur pendant un éclair. On attend
     * donc ~0,75 s sans frappe (l'embrasement en dure 0,34) avant toute prise.
     */
    const cielAuRepos = () => page.evaluate(async () => {
      const s = window.__BRAISES__.scene
      if (!s.foudreFx) return
      let n = s.foudreFx.sonde.eclairs
      let stable = 0
      for (let i = 0; i < 1500; i++) {
        await new Promise((r) => requestAnimationFrame(r))
        const m = s.foudreFx.sonde.eclairs
        if (m !== n) { n = m; stable = 0 } else stable += 1
        if (stable > 45) return
      }
    })

    /**
     * SE PORTER DANS LA BANDE, ET LE PROUVER — jamais un délai fixe.
     *
     * MESURÉ, et c'est la cause d'une planche entière de mesures FAUSSES : après un
     * `debug_teleport`, la prédiction locale met ~1,5 s à rejoindre la sim (500 ms rendaient
     * l'avatar TOUJOURS à son ancienne place). On mesurait donc consciencieusement un monde
     * sans bande au-dessus de la tête : brouillard Δµ = 0,0 EXACTEMENT, neige −0,1. Un zéro
     * parfait n'est pas un rendu discret, c'est un rendu ABSENT — la garde le dit maintenant.
     */
    const seRendreAuCoeur = async (x, y, cible = 0.9) => {
      await agir({ type: 'debug_teleport', x, y }, 200)
      try {
        await page.waitForFunction(
          (c) => (window.__BRAISES__.scene.meteoLayer?.intensiteAuJoueur ?? 0) >= c,
          cible, { timeout: 15000, polling: 250 },
        )
        return true
      } catch {
        const i = await page.evaluate(() => window.__BRAISES__.scene.meteoLayer?.intensiteAuJoueur ?? 0)
        console.error(`!! l'avatar n'est PAS entré dans la bande (intensité ${i.toFixed(2)} < ${cible}) — la mesure qui suit ne vaut rien`)
        return false
      }
    }

    /**
     * REPOSER L'HEURE À MIDI — l'horloge DÉRIVE, exactement comme la bande.
     *
     * MESURÉ : `debug_set_hour 12` posé UNE FOIS avant la boucle ne tient pas la planche.
     * Les captures de la première série datent d'elles-mêmes : pluie à 12H, brouillard à
     * 14H, neige à 17H — trois heures et demie de course pour trois types, et le blizzard
     * (le dernier) serait tombé au crépuscule. Or à la nuit `uDay` écrase le voile ET
     * `teinteDeNuit` éteint chaque particule : on lirait « le blizzard ne se voit presque
     * pas » là où on n'aurait mesuré qu'un coucher de soleil.
     */
    const heure12 = async (ms = 0) => {
      await page.evaluate(() => { window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 12 }) })
      if (ms) await page.waitForTimeout(ms)
    }

    const TYPES = ['pluie', 'brouillard', 'neige', 'orage', 'blizzard']
    const out = {}

    for (const type of TYPES) {
      // Le front entre par l'OUEST (bord 0) et traverse vers l'est : son bord AVANT est `hi`.
      // Phase 0,5 → la bande est au milieu de sa course, donc au milieu de la carte.
      await agir({ type: 'debug_meteo', meteo: type, edge: 0, phase: 0.5 }, 400)
      // ON ATTEND QUE LA BANDE SOIT DESSINÉE, on ne la suppose pas : le record d'élection
      // doit faire l'aller-retour worker → snapshot → couche, et au PREMIER type ce trajet
      // n'était pas fini au bout de 400 ms (MESURÉ : `pluie` sautait, les quatre autres
      // passaient — un délai fixe est un pari, une attente est une preuve).
      await page.waitForFunction((t) => {
        const s = window.__BRAISES__.scene
        return Boolean(s.meteoLayer?.bande) && s.view.meteo?.type === t
      }, type, { timeout: 20000 }).catch(() => {})
      const e0 = await etat()
      if (!e0.bande) { console.error(`!! ${type} : aucune bande dessinée — le front n'est pas arrivé au client`); continue }

      // LE CŒUR EST ANALYTIQUE, PAS RELEVÉ. À la phase 0,5, `debug_meteo` pose
      // `startTick = tick − 0,5 × TRAVERSEE` : la bande est alors PILE au milieu de la carte,
      // donc son centre vaut `map.w / 2` quel que soit le type (le bord d'entrée est l'ouest).
      // Le relever sur la couche rendrait un centre DÉJÀ PÉRIMÉ — voir `rappeler` juste après.
      const coeur = e0.map.w / 2
      const largeurBande = e0.bande.hi - e0.bande.lo
      const y = Math.min(e0.map.h - 2, Math.max(2, e0.pos.y))

      /**
       * RAPPELER LE FRONT SUR SON CENTRE — le geste qui sauve la planche.
       *
       * MESURÉ le 2026-08-19, et ça a coûté une planche entière de cinq types : LA BANDE
       * TRAVERSE LA CARTE pendant qu'on la photographie, et l'horloge headless galope
       * (9,5 tuiles de dérive en 1,4 s, relevées). Entre l'instant où l'avatar entre dans la
       * bande (`seRendreAuCoeur`, qui PROUVE l'entrée) et l'obturateur, il s'écoule
       * `canopeePleine` + 0,7 s + `cielAuRepos` — de quoi laisser le front passer par-dessus.
       * Résultat : les cinq ciels sortis à intensité 0,00 exactement, µ pluie +3,3 au lieu de
       * −27, zéro particule vivante. Une entrée PROUVÉE ne prouve rien si elle n'est pas
       * prouvée AU MOMENT DE LA PRISE.
       *
       * Ré-armer à la phase 0,5 replante la bande sur le centre exact de la carte — là où
       * l'avatar attend déjà. C'est idempotent et ça coûte un tick.
       */
      const rappeler = async (cible = 0.9, ms = 220) => {
        await page.evaluate((t) => {
          const sc = window.__BRAISES__.scene
          sc.sendAction({ type: 'debug_set_hour', hour: 12 })
          sc.sendAction({ type: 'debug_meteo', meteo: t, edge: 0, phase: 0.5 })
        }, type)
        // ON ATTEND LA PREUVE, PAS UN DÉLAI. Le record d'élection fait l'aller-retour
        // worker → snapshot → couche ; 200 ms n'y suffisent pas (MESURÉ : la garde de
        // l'obturateur criait « intensité 0.00 » après un rappel à délai fixe). On guette
        // donc l'intensité elle-même — le nombre qu'on veut, chez celui qui le peint.
        await page.waitForFunction(
          (k) => (window.__BRAISES__.scene.meteoLayer?.intensiteAuJoueur ?? 0) >= k,
          cible, { timeout: 10000, polling: 100 },
        ).catch(() => {})
        if (ms) await page.waitForTimeout(ms)
      }

      // ── 1. LE MONDE NU, au MÊME endroit et à la MÊME heure : l'étalon. Sans lui, un µ
      //      de 90 ne dit rien — c'est l'ÉCART au sol nu qui dit ce que le ciel a fait. ──
      await agir({ type: 'debug_meteo', meteo: null }, 200)
      // ON NE « SE REND PAS AU CŒUR » D'UNE BANDE QUI N'EXISTE PAS : le témoin nu se prend
      // au MÊME endroit que la prise (sinon on compare deux terrains), mais il n'y a rien à
      // prouver ici — juste à laisser la prédiction locale rejoindre la sim (~1,5 s MESURÉ).
      await agir({ type: 'debug_teleport', x: coeur, y }, 1700)
      await canopeePleine(page) // la cime au-dessus du joueur s'efface : la photo mentirait
      await heure12(500) // le témoin NU se prend à MIDI, comme la prise qu'il étalonne
      // LA PHOTO DU MONDE NU, gardée : un Δµ de +56 ne se juge pas seul, il se REGARDE à
      // côté de son témoin — même endroit, même heure, même cadrage.
      await page.screenshot({ path: `${OUT}/meteo-${type}-0-nu.png` })
      const nu = await mesurer()

      // ── 2. LE CŒUR (intensité 1) — le ciel plein. ──
      await rappeler()
      await seRendreAuCoeur(coeur, y)
      await canopeePleine(page)
      await page.waitForTimeout(500)
      // `cielAuRepos` NE SERT QUE SOUS L'ORAGE (il guette le compteur d'éclairs). Sous les
      // quatre autres ciels il attendait 46 images pour rien — et pendant ces 46 images la
      // bande, elle, avançait. Une attente inutile n'est pas gratuite ici : elle est fatale.
      if (type === 'orage') await cielAuRepos()
      await rappeler()
      const eCoeur = await etat()
      if (eCoeur.intensite < 0.9) {
        console.error(`!! ${type} : intensité ${eCoeur.intensite.toFixed(2)} À L'OBTURATEUR — la photo ne montre pas le ciel`)
      }
      await page.screenshot({ path: `${OUT}/meteo-${type}-coeur.png` })
      // LA SONDE DU GRAIN : combien de particules VIVENT, contre quel budget. Une gerbe de
      // deux images ne se photographie pas — elle se compte.
      const sondeGrain = await page.evaluate(() => ({ ...(window.__BRAISES__.scene.meteoLayer?.sonde ?? {}) }))
      const coeurM = await mesurer()

      // ── 2bis. LE VOILE SEUL — particules éteintes, MÊME endroit, MÊME heure. ──
      //
      // C'EST LE TÉMOIN QUI COMPTE, et il en fallait un troisième. Comparer le ciel plein
      // au sol nu mélange deux choses : ce que le voile fait (il assombrit) et ce que le
      // grain fait (il éclaircit par points durs). L'en-tête de `meteo-layer` garde la
      // trace du piège : la première planche avait Δµ = −0,4 contre le sol nu, c'est-à-dire
      // une pluie RIGOUREUSEMENT INVISIBLE aux nombres, parce que les deux s'annulaient.
      // Contre le voile seul, le grain ne peut plus se cacher : σ/µ MONTE quand des carrés
      // durs se posent sur un aplat, même si µ ne bouge pas.
      await page.evaluate(() => { window.__BRAISES__.scene.meteoLayer.grainActif = false })
      if (type === 'orage') await cielAuRepos()
      await rappeler()
      const eVoile = await etat()
      if (eVoile.intensite < 0.9) console.error(`!! ${type} : voile seul pris à intensité ${eVoile.intensite.toFixed(2)}`)
      await page.screenshot({ path: `${OUT}/meteo-${type}-voile-seul.png` })
      const voileM = await mesurer()
      await page.evaluate(() => { window.__BRAISES__.scene.meteoLayer.grainActif = true })
      await page.waitForTimeout(400)

      // ── 3. LA LISIÈRE — le bord AVANT, celui qui gagne du terrain. On s'y plante : le
      //      front couvre la moitié ouest de l'écran, le clair tient l'est. ──
      //
      // ON MESURE LES DEUX MOITIÉS AVEC **PUIS SANS** LE FRONT, ET ON SOUSTRAIT. Comparer
      // crûment la moitié gauche à la moitié droite ne mesure PAS la lisière : elle mesure
      // aussi le terrain, qui n'est pas le même des deux côtés — MESURÉ, le brouillard (qui
      // ÉCLAIRCIT) rendait un écart de −4,7, c'est-à-dire du signe contraire à ce qu'il fait.
      // La différence des différences élimine le décor : il ne reste que ce que le ciel a
      // ajouté à gauche, et ce qu'il a ajouté à droite.
      // Le bord AVANT est analytique lui aussi : centre + demi-largeur (même raison). On se
      // plante UNE TUILE DEDANS et pas dessus : sur le bord exact, `d = 0` donc l'intensité
      // vaut 0 par définition — il n'y aurait rien à prouver, donc rien à garder.
      const bordAvant = coeur + largeurBande / 2 - 1
      await agir({ type: 'debug_teleport', x: bordAvant, y }, 900)
      await canopeePleine(page)
      if (type === 'orage') await cielAuRepos()
      await rappeler(0.02)
      const eLis = await etat()
      if (eLis.intensite <= 0) console.error(`!! ${type} : lisière prise HORS du front (intensité 0)`)
      await page.screenshot({ path: `${OUT}/meteo-${type}-lisiere.png` })
      const lisAvec = await moities()
      await agir({ type: 'debug_meteo', meteo: null }, 400)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${OUT}/meteo-${type}-lisiere-0-nu.png` })
      const lisSans = await moities()
      const lis = {
        dedans: lisAvec.gauche - lisSans.gauche, // ce que le ciel a fait sous l'empreinte
        dehors: lisAvec.droite - lisSans.droite, // …et au clair, de l'autre côté du bord
      }

      // LA LISIBILITÉ DE LA LISIÈRE EST UN RAPPORT, pas une impression : la rampe
      // (`RAMPE × LARGEUR`, la distance sur laquelle l'intensité passe de 0 à 1) contre la
      // largeur de l'écran en tuiles. Sous 1, le mur monte en moins d'un écran — on le voit
      // venir. Bien au-dessus, l'intensité ne bouge presque pas d'un bord à l'autre du cadre.
      const ecranTuiles = await page.evaluate(() => window.innerWidth / window.__BRAISES__.scene.cameras.main.zoom / 16)
      const rampe = (e0.bande.hi - e0.bande.lo) * 0.15
      out[type] = {
        nu,
        coeur: coeurM,
        voile: voileM,
        grain: sondeGrain,
        intensiteAuCoeur: Math.round(eCoeur.intensite * 1000) / 1000,
        rampeTuiles: Math.round(rampe * 10) / 10,
        ecranTuiles: Math.round(ecranTuiles * 10) / 10,
        // Ce que l'intensité gagne d'un bord de l'écran à l'autre, au plus raide.
        deltaIParEcran: Math.round(Math.min(1, ecranTuiles / rampe) * 1000) / 1000,
        // « saut » = ce que le ciel fait dedans MOINS ce qu'il fait dehors, au bord même :
        // c'est la MARCHE de la lisière, décor éliminé. Zéro = pas de bord visible.
        lisiere: { ...lis, saut: lis.dedans - lis.dehors },
      }
      console.log(
        `  ${type.padEnd(11)} µ ${String(Math.round(coeurM.moy * 10) / 10).padStart(6)} (nu ${String(Math.round(nu.moy * 10) / 10).padStart(6)}` +
        `, Δ ${String(Math.round((coeurM.moy - nu.moy) * 10) / 10).padStart(6)})   σ/µ ${String(Math.round(coeurM.cv * 1000) / 1000).padStart(6)}` +
        ` (nu ${String(Math.round(nu.cv * 1000) / 1000).padStart(6)})   lisière : dedans ${String(Math.round(lis.dedans * 10) / 10).padStart(6)}` +
        ` / dehors ${String(Math.round(lis.dehors * 10) / 10).padStart(6)}`,
      )
      console.log(
        `              pris à ${String(Math.round((eCoeur.heure ?? -1) * 10) / 10).padStart(4)} h (midi voulu) · intensité à l'obturateur ${(eCoeur.intensite ?? 0).toFixed(2)}` +
        `\n              grain : ${String(sondeGrain.vivantes ?? 0).padStart(4)} particules vivantes / cible ${String(sondeGrain.cible ?? 0).padStart(4)}` +
        ` / budget ${sondeGrain.budget ?? '?'}${sondeGrain.plafonne ? ' (PLAFONNÉ)' : ''} · ${String(sondeGrain.rects ?? 0).padStart(5)} rectangles` +
        `, ${String(sondeGrain.eclaboussures ?? 0).padStart(3)} éclaboussures` +
        `\n              contre le VOILE SEUL : Δµ ${String(Math.round((coeurM.moy - voileM.moy) * 10) / 10).padStart(6)}` +
        `   σ/µ ${String(Math.round(coeurM.cv * 1000) / 1000).padStart(6)} contre ${String(Math.round(voileM.cv * 1000) / 1000).padStart(6)}` +
        ` (Δ ${String(Math.round((coeurM.cv - voileM.cv) * 1000) / 1000).padStart(6)})`,
      )
    }

    // ══ LA FOUDRE : le télégraphe au sol, puis l'éclair ══
    //
    // On se plante DANS l'orage et on attend, dans la page. `foudreImpactAt` n'élit qu'un
    // impact par créneau de 400 ticks, et le télégraphe ne dure que 30 ticks avant : sondé
    // depuis Node, on le manquerait neuf fois sur dix.
    await agir({ type: 'debug_meteo', meteo: 'orage', edge: 0, phase: 0.5 }, 400)
    const eo = await etat()
    if (eo.bande) {
      await agir({ type: 'debug_teleport', x: (eo.bande.lo + eo.bande.hi) / 2, y: Math.min(eo.map.h - 2, Math.max(2, eo.pos.y)) }, 500)
      await canopeePleine(page)
      await page.waitForTimeout(600)
    }

    /**
     * IL FAUT ALLER AU-DEVANT DE LA FOUDRE — et c'est un CONSTAT, pas une commodité.
     *
     * `foudreImpactAt` tire la coordonnée transverse sur TOUT l'axe de la carte
     * (`meteo.ts` : `autre = hash2(…) × mapHeight`), soit ~1 600 tuiles, quand l'écran en
     * montre 20 de haut : moins de 2 % des frappes tombent dans le champ du joueur. Un
     * scénario qui attendrait qu'un éclair vienne à lui attendrait des heures.
     *
     * On se téléporte donc SUR le point annoncé dès que le télégraphe s'allume (le geste
     * du joueur qui court voir, en accéléré), et on photographie là. L'avatar est
     * invulnérable — sinon il prendrait ses 35 points et le voile de mort mangerait la photo.
     *
     * Tout se joue DANS la page, image par image : la fenêtre de télégraphe ne dure que
     * 30 ticks (1,5 s) et un aller-retour Node par sondage la manquerait.
     */
    const chasseTelegraphe = () => page.evaluate(async () => {
      const s = window.__BRAISES__.scene
      const frame = () => new Promise((r) => requestAnimationFrame(r))
      // 1. Guetter la PREMIÈRE lueur, et courir dessus sur-le-champ.
      let vise = null
      for (let i = 0; i < 6000; i++) {
        const so = s.foudreFx.sonde
        if (so.ticksLeft > 0) {
          vise = { x: so.x, y: so.y }
          s.sendAction({ type: 'debug_teleport', x: so.x, y: so.y })
          break
        }
        await frame()
      }
      if (!vise) return { vu: false, sonde: { ...s.foudreFx.sonde } }
      // 2. Attendre le HAUT de la rampe d'alpha — l'instant où elle doit être ÉVIDENTE —
      //    puis figer la boucle sur l'image même qui la porte. Si on a raté cette fenêtre
      //    (la téléportation a mangé des ticks), on prend la suivante : les créneaux
      //    tombent toutes les 400 ticks et l'avatar est maintenant sous la bonne colonne.
      for (let i = 0; i < 6000; i++) {
        const so = s.foudreFx.sonde
        if (so.ticksLeft > 0 && so.ticksLeft <= 12) {
          s.game.loop.sleep()
          return { vu: true, sonde: { ...s.foudreFx.sonde } }
        }
        // Un nouveau créneau vise ailleurs : on le suit.
        if (so.ticksLeft > 0 && (Math.abs(so.x - vise.x) > 1 || Math.abs(so.y - vise.y) > 1)) {
          vise = { x: so.x, y: so.y }
          s.sendAction({ type: 'debug_teleport', x: so.x, y: so.y })
        }
        await frame()
      }
      return { vu: false, sonde: { ...s.foudreFx.sonde } }
    })

    const tel = await chasseTelegraphe()
    let telM = null
    if (tel.vu) {
      console.log(`\n  télégraphe : ticksLeft=${tel.sonde.ticksLeft} alpha=${Math.round(tel.sonde.alpha * 100) / 100} visé en (${Math.round(tel.sonde.x)}, ${Math.round(tel.sonde.y)})`)
      await page.screenshot({ path: `${OUT}/meteo-foudre-telegraphe.png` })
      // Gros plan : l'anneau tombe sur `FOUDRE_RAYON` = 1,5 tuile, soit 48 px monde de
      // diamètre — 108 px d'écran au zoom 2,25. Sur une planche de 1280 il se lit mal ;
      // une capture qui ne montre pas ce qu'on juge ment.
      const clip = await page.evaluate(({ x, y }) => {
        const s = window.__BRAISES__.scene
        const cam = s.cameras.main
        const sx = (x * 16 - cam.worldView.x) * cam.zoom
        const sy = (y * 16 - cam.worldView.y) * cam.zoom
        const w = Math.min(window.innerWidth, 420)
        const h = Math.min(window.innerHeight, 420)
        return {
          x: Math.max(0, Math.min(window.innerWidth - w, Math.round(sx - w / 2))),
          y: Math.max(0, Math.min(window.innerHeight - h, Math.round(sy - h / 2))),
          width: w, height: h,
          // ON DIT SI LE POINT VISÉ EST DANS LE CADRE : hors champ, le rognage se rabat
          // sur un bord et la « photo du télégraphe » ne montre que de l'herbe.
          dansLeCadre: sx >= 0 && sy >= 0 && sx <= window.innerWidth && sy <= window.innerHeight,
        }
      }, { x: tel.sonde.x, y: tel.sonde.y })
      if (!clip.dansLeCadre) console.error('!! le point visé est hors écran — le gros plan ne montrera pas la lueur')
      await page.screenshot({ path: `${OUT}/meteo-foudre-telegraphe-pres.png`, clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } })
      telM = await mesurerFige() // boucle FIGÉE : surtout pas `mesurer()`, il ne rendrait jamais la main
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
    } else {
      console.error('!! aucun télégraphe de foudre vu')
    }

    // L'ÉCLAIR : on guette le COMPTEUR de frappes, pas un instant — il n'est vrai qu'à UN
    // tick, et le trait ne tient que 130 ms d'horloge de scène. On est déjà SOUS la colonne
    // (la chasse ci-dessus nous y a mis) : la frappe tombe dans le cadre.
    const ecl = await page.evaluate(async () => {
      const s = window.__BRAISES__.scene
      const n0 = s.foudreFx.sonde.eclairs
      for (let i = 0; i < 6000; i++) {
        if (s.foudreFx.sonde.eclairs > n0) {
          s.game.loop.sleep()
          return { vu: true, sonde: { ...s.foudreFx.sonde } }
        }
        await new Promise((r) => requestAnimationFrame(r))
      }
      return { vu: false, sonde: { ...s.foudreFx.sonde } }
    })
    let eclM = null
    if (ecl.vu) {
      await page.screenshot({ path: `${OUT}/meteo-foudre-eclair.png` })
      eclM = await mesurerFige() // idem : l'éclair n'existe que sur l'image gelée
      console.log(`  éclair     : ${ecl.sonde.eclairs} frappe(s) vue(s) — µ de la frame ${Math.round(eclM.moy * 10) / 10}${telM ? ` contre ${Math.round(telM.moy * 10) / 10} au télégraphe` : ''}`)
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
    } else {
      console.error('!! aucun éclair vu — la frappe a été manquée')
    }

    // ══ LA PRÉDICTION LOCALE SOUS LE FRONT (spec meteo.md R7 / point D) ══
    //
    // L'autorité multiplie la vitesse de l'avatar par `METEO.SPEED[type]` au point du
    // marcheur — ×0,8 sous blizzard. Un client qui l'ignore prédit 25 % trop vite, et la
    // réconciliation le rattrape en le TIRANT en arrière à chaque snapshot : l'élastique.
    //
    // On le mesure DIRECTEMENT, sans croire personne : `playerPos` EST la base de prédiction
    // (`WorldScene` : `setHud(registry, 'playerPos', this.predicted)`), `lastEntities` porte
    // la position AUTORITATIVE. L'écart entre les deux, en marchant, est l'erreur de
    // prédiction. On marche le même trajet à ciel clair puis sous blizzard : si le facteur
    // est bien passé, les deux écarts se ressemblent ; s'il manquait, le second exploserait.
    // LA GARDE PROUVE SA PRÉMISSE : un écart de 0 ne dit rien si l'avatar n'a pas MARCHÉ
    // (MESURÉ : un premier relevé donnait « blizzard : médiane 0 » — l'avatar butait contre
    // un obstacle après la marche précédente, et un immobile est parfaitement prédit). On
    // relève donc la DISTANCE PARCOURUE à côté de l'écart, et le second relevé repart du
    // même point que le premier : deux marches, même trajet, seul le ciel change.
    const marcher = async (etiquette, depart) => {
      await agir({ type: 'debug_teleport', x: depart.x, y: depart.y }, 450)
      const p0 = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      await page.keyboard.down('KeyD')
      const ech = []
      for (let i = 0; i < 26; i++) {
        await page.waitForTimeout(120)
        ech.push(await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          const p = s.registry.get('playerPos')
          const a = s.lastEntities.find((e) => e.id === s.playerId)
          if (!p || !a) return null
          return Math.hypot(p.x - a.x, p.y - a.y)
        }))
      }
      await page.keyboard.up('KeyD')
      await page.waitForTimeout(400)
      const p1 = await page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
      const parcouru = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0
      const v = ech.filter((x) => typeof x === 'number')
      v.sort((a, b) => a - b)
      const moy = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)
      if (parcouru < 3) console.error(`!! marche « ${etiquette} » : ${Math.round(parcouru * 100) / 100} tuile(s) parcourue(s) — l'écart mesuré ne vaut rien`)
      return { etiquette, n: v.length, parcouru, moy, median: v[Math.floor(v.length / 2)] ?? 0, max: v[v.length - 1] ?? 0 }
    }
    // On arme le blizzard D'ABORD pour choisir un départ au CŒUR de sa bande, puis on joue
    // le MÊME trajet deux fois — sans ciel, puis sous le blizzard.
    await agir({ type: 'debug_meteo', meteo: 'blizzard', edge: 0, phase: 0.5 }, 400)
    await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.meteoLayer?.bande), null, { timeout: 20000 }).catch(() => {})
    const eb = await etat()
    const depart = eb.bande
      ? { x: Math.min(eb.map.w - 40, Math.max(4, (eb.bande.lo + eb.bande.hi) / 2 - 12)), y: Math.min(eb.map.h - 2, Math.max(2, eb.pos.y)) }
      : eb.pos
    await agir({ type: 'debug_meteo', meteo: null }, 400)
    const driftClair = await marcher('ciel clair', depart)
    await agir({ type: 'debug_meteo', meteo: 'blizzard', edge: 0, phase: 0.5 }, 400)
    await page.waitForFunction(() => Boolean(window.__BRAISES__.scene.meteoLayer?.bande), null, { timeout: 20000 }).catch(() => {})
    const driftBliz = await marcher('blizzard', depart)
    const iBliz = await page.evaluate(() => window.__BRAISES__.scene.meteoLayer?.intensiteAuJoueur ?? 0)
    const f3 = (v) => Math.round(v * 1000) / 1000
    console.log(
      `\n  prédiction locale (écart prédit ↔ autorité, en tuiles — même trajet, seul le ciel change) :` +
      `\n    ciel clair : médiane ${f3(driftClair.median)}  max ${f3(driftClair.max)}  (${f3(driftClair.parcouru)} tuiles parcourues)` +
      `\n    blizzard   : médiane ${f3(driftBliz.median)}  max ${f3(driftBliz.max)}  (${f3(driftBliz.parcouru)} tuiles parcourues` +
      `, intensité au marcheur ${f3(iBliz)}, SPEED 0,8)`,
    )

    // ── LE COÛT : combien coûte le ciel, en ms par image, sous le pire des cinq. On mesure
    //    ALLUMÉ puis ÉTEINT au même endroit — l'écart est ce que la couche coûte. ──
    const cadence = async () => page.evaluate(async () => {
      const s = window.__BRAISES__.scene
      const t = []
      let dernier = performance.now()
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => requestAnimationFrame(r))
        const n = performance.now()
        t.push(n - dernier)
        dernier = n
      }
      t.sort((a, b) => a - b)
      void s
      return { median: t[Math.floor(t.length / 2)], p90: t[Math.floor(t.length * 0.9)] }
    })
    //
    // TROIS ÉTALONS, PAS DEUX — et c'est la leçon de cette tranche. Le grain a quitté le
    // fragment (il était un hash de permutation ET un vnoise par pixel, sur ~920 000
    // fragments) pour devenir des particules. Ne mesurer que « sans ciel » contre « ciel
    // complet » créditerait les particules du temps que la branche retirée a RENDU. On
    // relève donc : (a) ciel nu, (b) voile seul (grain éteint par l'interrupteur de mesure),
    // (c) voile + particules. Le coût des PARTICULES est c − b ; celui du VOILE est b − a.
    //
    // Et on mesure AU CŒUR de la bande à chaque fois : sur la rampe, la densité est plus
    // basse par construction — un relevé à mi-lisière flatterait le budget.
    const eRef = await etat()
    const xRef = eRef.map.w / 2
    const yRef = Math.min(eRef.map.h - 2, Math.max(2, eRef.pos.y))
    await agir({ type: 'debug_meteo', meteo: null }, 300)
    await agir({ type: 'debug_teleport', x: xRef, y: yRef }, 700)
    const sans = await cadence()
    const couts = { sans }
    for (const type of ['pluie', 'neige', 'orage', 'blizzard']) {
      // Même rappel que pour les photos : `cadence()` compte 90 images, la bande avance
      // pendant ce temps. On la replante sur le centre juste avant chaque relevé.
      const arme = async (cible = 0.9) => {
        await page.evaluate((t) => {
          const sc = window.__BRAISES__.scene
          sc.sendAction({ type: 'debug_set_hour', hour: 12 })
          sc.sendAction({ type: 'debug_meteo', meteo: t, edge: 0, phase: 0.5 })
        }, type)
        await page.waitForFunction(
          (k) => (window.__BRAISES__.scene.meteoLayer?.intensiteAuJoueur ?? 0) >= k,
          cible, { timeout: 10000, polling: 100 },
        ).catch(() => {})
        await page.waitForTimeout(200)
      }
      await arme()
      await page.waitForFunction((t) => {
        const sc = window.__BRAISES__.scene
        return Boolean(sc.meteoLayer?.bande) && sc.view.meteo?.type === t
      }, type, { timeout: 20000 }).catch(() => {})
      if (!(await seRendreAuCoeur(xRef, yRef))) { console.error(`!! coût ${type} : hors bande`); continue }
      await page.evaluate(() => { window.__BRAISES__.scene.meteoLayer.grainActif = false })
      await arme()
      const voile = await cadence()
      await page.evaluate(() => { window.__BRAISES__.scene.meteoLayer.grainActif = true })
      await arme()
      // LA SONDE SE LIT AVANT **ET** APRÈS LES 90 IMAGES. Sans elle, un « surcoût 0,0 ms »
      // pourrait vouloir dire « pas de particules » ; avec une seule lecture, il pourrait
      // vouloir dire « le rideau a fondu à mi-relevé pendant que la bande passait ». Deux
      // comptes qui divergent invalident la médiane — une garde prouve sa prémisse.
      const lireSonde = () => page.evaluate(() => ({ ...(window.__BRAISES__.scene.meteoLayer?.sonde ?? {}) }))
      const sondeAvant = await lireSonde()
      const plein = await cadence()
      const sonde = await lireSonde()
      if (!sonde.vivantes || !sondeAvant.vivantes) console.error(`!! coût ${type} : 0 particule vivante — le surcoût mesuré ne vaut rien`)
      else if (Math.abs(sonde.vivantes - sondeAvant.vivantes) > sondeAvant.vivantes * 0.2) {
        console.error(`!! coût ${type} : le rideau a fondu pendant le relevé (${sondeAvant.vivantes} → ${sonde.vivantes}) — médiane à jeter`)
      }
      couts[type] = { voile, plein, sonde, sondeAvant }
    }
    await agir({ type: 'debug_meteo', meteo: null }, 400)
    const f2 = (v) => String(Math.round(v * 100) / 100).padStart(7)
    console.log(
      `\n  LE COÛT DU CIEL, en ms/image médianes — trois étalons au même endroit (au CŒUR de la bande) :` +
      `\n    ciel nu (aucun front)          ${f2(sans.median)}   (p90 ${f2(sans.p90)})`,
    )
    for (const [type, c] of Object.entries(couts)) {
      if (type === 'sans') continue
      console.log(
        `    ${type.padEnd(9)} voile seul        ${f2(c.voile.median)}   (p90 ${f2(c.voile.p90)})   → le voile coûte ${f2(c.voile.median - sans.median)}` +
        `\n    ${type.padEnd(9)} voile + particules${f2(c.plein.median)}   (p90 ${f2(c.plein.p90)})   → les particules coûtent ${f2(c.plein.median - c.voile.median)}` +
        `   [${c.sondeAvant.vivantes}→${c.sonde.vivantes} vivantes, ${c.sonde.rects} rectangles]`,
      )
    }
    const avec = couts.blizzard?.plein ?? sans

    console.log('\n  type         µ cœur    µ nu      Δµ   σ/µ cœur  σ/µ nu   marche    rampe  ΔI/écran')
    for (const [nom, m] of Object.entries(out)) {
      const f = (v, n = 1) => String(Math.round(v * 10 ** n) / 10 ** n).padStart(8)
      console.log(
        `  ${nom.padEnd(11)}${f(m.coeur.moy)}${f(m.nu.moy)}${f(m.coeur.moy - m.nu.moy)}${f(m.coeur.cv, 3)}${f(m.nu.cv, 3)}` +
        `${f(m.lisiere.saut)}${f(m.rampeTuiles)}${f(m.deltaIParEcran, 3)}`,
      )
    }
    const e0 = Object.values(out)[0]
    if (e0) {
      console.log(
        `\n  (« marche » = la MARCHE de luminance au bord de la bande, décor éliminé (ce que le ciel fait dedans moins` +
        `\n    ce qu'il fait dehors) — 0 voudrait dire aucune lisière visible.` +
        `\n   « rampe » = les tuiles à traverser pour passer de 0 à pleine intensité ; l'écran en montre ${e0.ecranTuiles}.` +
        `\n   « ΔI/écran » = ce que l'intensité gagne d'un bord du cadre à l'autre : 1 = le mur monte en moins d'un écran.)`,
      )
    }
    return {
      types: out,
      telegraphe: tel.sonde, telegrapheM: telM, eclair: ecl.sonde, eclairM: eclM,
      cout: { avec, sans, parType: couts }, prediction: { clair: driftClair, blizzard: driftBliz, intensite: iBliz },
    }
  },

  /**
   * LE COÛT DU CIEL, ET RIEN D'AUTRE — le relevé rapide qui fixe `BUDGET_PARTICULES`.
   *
   * ═══ POURQUOI IL NE COMPTE PAS LES IMAGES ═══
   *
   * Parce que sur ce poste, le compte d'images ne mesure PAS le rendu. MESURÉ le 2026-08-19,
   * pendant que deux autres sessions compilaient : un ciel NU (aucun front, aucune particule)
   * relevé à **937 ms/image**, p90 1 371 — soit une image par seconde. À ce régime, un
   * surcoût de deux millisecondes est indiscernable, et un intervalle de mille millisecondes
   * ne dit rien de la couche. Pire : trente images à ce rythme durent trente secondes,
   * pendant lesquelles la bande traverse la carte et le rideau se vide sous l'instrument (le
   * premier jet a relevé « 900 vers 0 particules vivantes » entre le début et la fin d'une
   * seule mesure).
   *
   * On lit donc le CHRONOMÈTRE DE LA COUCHE — `meteoLayer.sonde.msPhysique` et
   * `.msPeinture`, deux moyennes glissantes sur une seconde, posées de part et d'autre de
   * l'intégration et de la peinture. C'est le temps que la météo prend sur le fil principal :
   * il reste lisible sous charge, et c'est lui qui commande le budget. Il ne couvre pas la
   * rastérisation (elle vit dans swiftshader, hors du fil) — la planche optique
   * `--scenario meteo` reste le juge de ce que ça donne à l'écran.
   *
   * Il rapporte aussi le total CUMULÉ d'éclaboussures : une gerbe de 90 ms ne se photographie
   * pas quand une image en dure 900, elle se COMPTE.
   */
  async meteocout(page) {
    if (!dev) { console.log('(le coût du ciel exige --dev pour armer un front)'); return {} }
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    const agir = async (action, ms = 300) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const etat = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      return {
        intensite: s.meteoLayer?.intensiteAuJoueur ?? 0,
        sonde: { ...(s.meteoLayer?.sonde ?? {}) },
        pos: s.registry.get('playerPos'),
        map: { w: s.map.width, h: s.map.height },
        heure: s.lastTime?.hourOfCycle ?? -1,
      }
    })

    await agir({ type: 'debug_set_hour', hour: 12 }, 800)
    const e0 = await etat()
    const xRef = e0.map.w / 2
    const yRef = Math.min(e0.map.h - 2, Math.max(2, e0.pos.y))
    const f2 = (v) => String(Math.round(v * 1000) / 1000).padStart(7)
    const out = {}

    for (const type of ['pluie', 'neige', 'orage', 'blizzard']) {
      // L'HEURE ET LA BANDE dérivent toutes les deux : on les rappelle ensemble et on ATTEND
      // LA PREUVE (l'intensité au joueur), jamais un délai fixe — le piège payé au scénario
      // `meteo`, où cinq ciels sont sortis à intensité 0,00.
      const arme = async () => {
        await page.evaluate((t) => {
          const sc = window.__BRAISES__.scene
          sc.sendAction({ type: 'debug_set_hour', hour: 12 })
          sc.sendAction({ type: 'debug_meteo', meteo: t, edge: 0, phase: 0.5 })
        }, type)
        await page.waitForFunction(
          () => (window.__BRAISES__.scene.meteoLayer?.intensiteAuJoueur ?? 0) >= 0.9,
          null, { timeout: 20000, polling: 150 },
        ).catch(() => {})
      }
      await agir({ type: 'debug_teleport', x: xRef, y: yRef }, 900)
      await arme()
      // Laisser la fenêtre du chronomètre (1 s) se remplir DEUX fois : la première porte
      // encore l'image de mise en place (naissance de tout le rideau d'un coup).
      await page.waitForTimeout(2500)
      await arme()
      await page.waitForTimeout(2500)
      const e = await etat()
      if (e.intensite < 0.9) { console.error(`!! ${type} : intensité ${e.intensite.toFixed(2)} — relevé sans valeur`); continue }
      const d = e.sonde
      if (!d.vivantes) { console.error(`!! ${type} : 0 particule vivante — relevé sans valeur`); continue }
      out[type] = d
      console.log(
        `  ${type.padEnd(9)} ${String(d.vivantes).padStart(4)} particules / cible ${String(d.cible).padStart(4)} / budget ${d.budget}${d.plafonne ? ' PLAFONNÉ' : '        '}` +
        ` · ${String(d.rects).padStart(5)} rectangles` +
        `\n            SUR LE FIL PRINCIPAL : physique ${f2(d.msPhysique)} + peinture ${f2(d.msPeinture)} = ${f2(d.msPhysique + d.msPeinture)} ms/image` +
        ` (moyenne sur ${d.images} images, à ${Math.round(e.heure * 10) / 10} h, intensité ${e.intensite.toFixed(2)})` +
        `\n            ${d.eclabsTotal} éclaboussures écloses depuis le début (${d.eclaboussures} vivantes à l'instant du relevé)`,
      )
    }
    return out
  },

  /**
   * LA PLANCHE DES CIELS — une image par type, au CŒUR, à midi, l'intensité PROUVÉE.
   *
   * `--scenario meteo` est le juge complet (µ, σ/µ, centiles, lisière, foudre, prédiction,
   * coût) et il coûte cher : chaque `renderer.snapshot()` traverse le rendu logiciel entier.
   * Quand la question est « MONTRE-MOI les cinq ciels » — la seule qu'un DA pose avant de
   * livrer — on ne veut pas payer la planche de mesure pour obtenir des photos.
   *
   * Ce scénario ne mesure donc RIEN : il arme, il prouve qu'il est bien SOUS le ciel qu'il
   * photographie (intensité au joueur ≥ 0,9 relevée À L'OBTURATEUR, heure rappelée à midi),
   * il déclenche. Il rend en plus le compte de particules vivantes de chaque prise : une
   * photo qui montre un rideau doit pouvoir dire combien de gouttes elle contient.
   */
  async meteoplanche(page) {
    if (!dev) { console.log('(la planche des ciels exige --dev)'); return {} }
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)
    const agir = async (action, ms = 300) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const etat = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      return {
        intensite: s.meteoLayer?.intensiteAuJoueur ?? 0,
        sonde: { ...(s.meteoLayer?.sonde ?? {}) },
        pos: s.registry.get('playerPos'),
        map: { w: s.map.width, h: s.map.height },
        heure: s.lastTime?.hourOfCycle ?? -1,
      }
    })
    await agir({ type: 'debug_set_hour', hour: 12 }, 800)
    const e0 = await etat()
    const xRef = e0.map.w / 2
    const yRef = Math.min(e0.map.h - 2, Math.max(2, e0.pos.y))
    await agir({ type: 'debug_teleport', x: xRef, y: yRef }, 1800)

    // LE TÉMOIN : même endroit, même heure, aucun front. Sans lui, une photo de pluie ne se
    // juge pas — c'est l'ÉCART au monde nu qui dit ce que le ciel a fait.
    await agir({ type: 'debug_meteo', meteo: null }, 300)
    await agir({ type: 'debug_set_hour', hour: 12 }, 900)
    await canopeePleine(page)
    await page.screenshot({ path: `${OUT}/ciel-0-temoin-sans-meteo.png`, timeout: 180000 })
    console.log('  témoin sans météo — pris')

    const out = {}
    // `SMOKE_CIELS=orage,blizzard` pour ne retirer que quelques prises — la planche entière
    // coûte plusieurs minutes par ciel quand la machine est chargée, et rejouer les cinq
    // pour en récupérer deux est du temps jeté (patron `--prise` de la vitrine).
    const voulus = process.env.SMOKE_CIELS ? process.env.SMOKE_CIELS.split(',') : null
    for (const type of ['pluie', 'neige', 'orage', 'blizzard', 'brouillard']) {
      if (voulus && !voulus.includes(type)) continue
      const arme = async () => {
        await page.evaluate((t) => {
          const sc = window.__BRAISES__.scene
          sc.sendAction({ type: 'debug_set_hour', hour: 12 })
          sc.sendAction({ type: 'debug_meteo', meteo: t, edge: 0, phase: 0.5 })
        }, type)
        await page.waitForFunction(
          () => (window.__BRAISES__.scene.meteoLayer?.intensiteAuJoueur ?? 0) >= 0.9,
          null, { timeout: 20000, polling: 150 },
        ).catch(() => {})
      }
      await agir({ type: 'debug_teleport', x: xRef, y: yRef }, 700)
      await arme()
      await canopeePleine(page)
      await page.waitForTimeout(700)
      // LE RAPPEL DE DERNIÈRE SECONDE, puis la preuve : la bande avance pendant qu'on la
      // photographie, et l'horloge headless galope. Voir `meteo` pour le prix payé.
      await arme()
      const e = await etat()
      if (e.intensite < 0.9) console.error(`!! ${type} : intensité ${e.intensite.toFixed(2)} À L'OBTURATEUR — la photo ne montre pas le ciel`)
      // 30 s (le défaut) ne suffisent PAS quand une image dure une seconde : MESURÉ, la
      // prise de l'orage a expiré en pleine planche. L'obturateur attend le moteur.
      await page.screenshot({ path: `${OUT}/ciel-${type}.png`, timeout: 180000 })
      out[type] = { intensite: e.intensite, heure: e.heure, sonde: e.sonde }
      console.log(
        `  ${type.padEnd(11)} intensité ${e.intensite.toFixed(2)} à ${Math.round(e.heure * 10) / 10} h · ` +
        `${e.sonde.vivantes} particules (cible ${e.sonde.cible}, budget ${e.sonde.budget}${e.sonde.plafonne ? ' PLAFONNÉ' : ''}), ` +
        `${e.sonde.rects} rectangles, ${e.sonde.eclabsTotal ?? 0} éclaboussures écloses`,
      )
    }
    return out
  },

  /**
   * LA FOUDRE — le télégraphe SOUS L'AVERSE, le trait battu, la secousse et la gerbe.
   *
   * Quatre questions, et chacune a son instrument. `SMOKE_FOUDRE=telegraphe` (ou `frappe`,
   * `confort`, `cout`) ne joue qu'une partie : chaque passage coûte des minutes, et rejouer
   * les quatre pour en régler une est du temps jeté (patron `SMOKE_CIELS` du voisin).
   *
   *   ① LE TÉLÉGRAPHE GAGNE-T-IL CONTRE LE RIDEAU ? C'est la couture entre deux tranches, et
   *      c'est de l'INFORMATION DE JEU (« on lit le sol et on se décale »). On mesure le
   *      CONTRASTE LOCAL de l'anneau contre son dehors, sous averse pleine puis sans, SUR LA
   *      MÊME IMAGE DE TÉLÉGRAPHE GELÉE — sinon on compare deux alphas différents. Et on
   *      BALAIE le poids du liseré sombre pour garder le plus PETIT qui gagne encore.
   *
   *      POURQUOI ON GÈLE LES DEUX HORLOGES. `game.loop.sleep()` endort le RENDU ; la sim,
   *      elle, tourne sur son propre `setInterval` DANS LE WORKER (`sim-worker.ts`). Or une
   *      capture Playwright coûte ~1 s ici, pendant laquelle le tick avance de ~20 — et
   *      l'alpha du télégraphe est une rampe sur 30 ticks. On envoie donc `{type:'pause'}`
   *      au worker (le message que le menu pause utilise déjà). Et on PROUVE que ça a tenu :
   *      front, bande et `ticksLeft` relus après coup — une garde prouve sa prémisse.
   *
   *      LE FRONT S'ÉPUISE PENDANT LA CHASSE, et c'est MESURÉ : `debug_meteo` pose une
   *      fenêtre de `TRAVERSEE_TICKS` dont `phase` a déjà mangé la moitié, tandis que la
   *      fenêtre de télégraphe (30 ticks) est échantillonnée à ~1 image/s — on la manque
   *      souvent, et chaque échec coûte un créneau entier (400 ticks). Un premier jet a
   *      photographié un pré ENSOLEILLÉ en croyant tenir un orage. La chasse RE-ARME donc le
   *      front dès qu'il manque — mais JAMAIS pendant un télégraphe, car réarmer réécrit
   *      `startTick` et ré-élit tous les créneaux : la lueur sauterait ailleurs sous nos yeux.
   *
   *   ② LE TRAIT — photographié battement par battement. Un éclair dure 172 ms quand une
   *      image en dure parfois 900 : impossible à prendre au vol. On endort la boucle AVANT
   *      la frappe et on avance à la main par `game.step` (`fx.update` seul ne redessine
   *      pas — patron maison), ce qui donne le contrôle exact de l'âge. Le temps de départ
   *      est `game.loop.time`, JAMAIS un nombre absolu : un `step(200000)` pousserait la
   *      scène 60 s dans le futur, plafonnerait le premier `dt` et ferait sauter l'horloge
   *      EN ARRIÈRE au réveil — de quoi fausser tout ce qui suit.
   *
   *   ③ LA SECOUSSE — on lit le déplacement RÉEL de la caméra (`shakeEffect._offsetX/Y`, en
   *      pixels d'écran), pas la constante qu'on lui a passée : l'unité de `camera.shake` est
   *      une fraction du cadre multipliée par le zoom, et personne ne lit ça de tête.
   *
   *   ④ LE COÛT — le chronomètre INTERNE (`sonde.msDessin`), moyenné sur les SEULES images où
   *      la foudre dessine. Sur ce poste le compte d'images ne mesure pas le rendu (un ciel
   *      NU relevé à 937 ms/image par le voisin) : son constat vaut ici aussi.
   *
   * Exige `--dev` (TP, heure et front sont inertes en build de production).
   */
  async foudre(page) {
    if (!dev) {
      console.log('\n(la foudre exige le mode debug pour armer un orage — relancer avec --dev)')
      return {}
    }
    const TILE = 16
    const parties = process.env.SMOKE_FOUDRE ? process.env.SMOKE_FOUDRE.split(',') : null
    const veut = (p) => !parties || parties.includes(p)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)

    const agir = async (action, ms = 300) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const sonde = () => page.evaluate(() => ({ ...(window.__BRAISES__.scene.foudreFx?.sonde ?? {}) }))

    // MIDI : le télégraphe se juge sur un monde ÉCLAIRÉ (la nuit assombrit tout, rideau
    // compris — on ne saurait plus si c'est la pluie ou l'heure qui a fait le nombre).
    // INVULNÉRABLE : on va se planter SOUS les impacts, et 35 PV dans 1,5 tuile feraient
    // tomber le voile de mort sur la photo.
    await agir({ type: 'debug_set_hour', hour: 12 }, 900)
    await agir({ type: 'debug_god', on: true }, 200)
    await agir({ type: 'debug_meteo', meteo: 'orage', edge: 0, phase: 0.35 }, 500)

    const etat = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      return {
        meteo: s.view.meteo ? { type: s.view.meteo.type } : null,
        bande: s.meteoLayer?.bande ?? null,
        intensite: s.meteoLayer?.intensiteAuJoueur ?? 0,
        pos: s.registry.get('playerPos'),
        map: { w: s.map.width, h: s.map.height },
      }
    })
    const e0 = await etat()
    if (e0.bande) {
      await agir({ type: 'debug_teleport', x: (e0.bande.lo + e0.bande.hi) / 2, y: Math.min(e0.map.h - 2, Math.max(2, e0.pos.y)) }, 600)
      await canopeePleine(page)
      await page.waitForTimeout(600)
    }

    /** Où est un point monde à l'écran, et la caméra qui le dit. Tout rayon en découle : on
     *  ne code jamais un rayon en pixels à la main, il se DÉRIVE du zoom. */
    const viseur = (x, y) => page.evaluate(({ x, y, T }) => {
      const cam = window.__BRAISES__.scene.cameras.main
      return {
        sx: (x * T - cam.worldView.x) * cam.zoom,
        sy: (y * T - cam.worldView.y) * cam.zoom,
        zoom: cam.zoom, W: window.innerWidth, H: window.innerHeight,
      }
    }, { x, y, T: TILE })

    /**
     * LE CONTRASTE LOCAL DU TÉLÉGRAPHE, par bandes de rayon en TUILES.
     *
     * On ne juge PAS sur la luminance moyenne de l'écran : la pluie assombrit tout et un µ
     * global mélangerait le ciel et le sol. Ce qui décide qu'un joueur VOIT l'annonce, c'est
     * l'écart entre l'ANNEAU (posé sur `FOUDRE_RAYON` = 1,5 tuile) et ce qui l'entoure.
     */
    const bandesDe = async (sx, sy, zoom) => {
      const pxParTuile = TILE * zoom
      const R = Math.ceil(4.6 * pxParTuile)
      const x0 = Math.round(Math.max(0, sx - R))
      const y0 = Math.round(Math.max(0, sy - R))
      const w = Math.round(Math.min(1280 - x0, 2 * R))
      const h = Math.round(Math.min(660 - y0, 2 * R)) // hors bande HUD
      if (w < 40 || h < 40) return null
      const r = await regionAt(page, { x: x0, y: y0, width: w, height: h })
      if (!r) return null
      const anneau = []; const lisere = []; const dehors = []; const tout = []
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const [rr, vv, bb] = r.px(x, y)
          const l = 0.2126 * rr + 0.7152 * vv + 0.0722 * bb
          const d = Math.hypot(x0 + x - sx, y0 + y - sy) / pxParTuile
          tout.push(l)
          // L'ANNEAU tombe sur le rayon de DÉGÂTS (1,5) ; le LISERÉ est le creux juste
          // dehors ; le DEHORS de référence est pris au-delà du halo (2,5 tuiles), sinon on
          // comparerait l'anneau à sa propre lueur.
          if (d >= 1.3 && d <= 1.7) anneau.push(l)
          else if (d > 1.75 && d <= 2.15) lisere.push(l)
          else if (d >= 3.0 && d <= 4.2) dehors.push(l)
        }
      }
      const stat = (a) => {
        if (a.length === 0) return null
        const t = [...a].sort((p, q) => p - q)
        const moy = t.reduce((p, q) => p + q, 0) / t.length
        const ec = Math.sqrt(t.reduce((p, q) => p + (q - moy) ** 2, 0) / t.length)
        const pc = (k) => t[Math.floor(k * (t.length - 1))]
        return { n: t.length, moy, ec, cv: ec / moy, p01: pc(0.01), p50: pc(0.5), p99: pc(0.99) }
      }
      const A = stat(anneau); const L = stat(lisere); const D = stat(dehors)
      if (!A || !L || !D) return null
      return {
        anneau: A, lisere: L, dehors: D, tout: stat(tout),
        deltaAnneau: A.moy - D.moy,
        // LA MARCHE DE BORD — anneau clair contre liseré sombre, deux voisins immédiats.
        // C'est elle que le rideau ne peut pas noyer : il ajoute du pâle des DEUX côtés.
        marche: A.moy - L.moy,
        michelsonBord: (A.moy - L.moy) / (A.moy + L.moy),
      }
    }

    /**
     * CHASSER LE TÉLÉGRAPHE ET GELER DESSUS. Tout se joue DANS la page, image par image : la
     * fenêtre ne dure que 30 ticks et un aller-retour Node par sondage la manquerait. Et il
     * faut ALLER AU-DEVANT de la foudre — `foudreImpactAt` tire la coordonnée transverse sur
     * TOUT l'axe de la carte (~1 600 tuiles) quand l'écran en montre 20 : moins de 2 % des
     * frappes tombent dans le champ. On court sur le point annoncé, comme le ferait un joueur.
     */
    const chasseEtGele = () => page.evaluate(async () => {
      const s = window.__BRAISES__.scene
      const frame = () => new Promise((r) => requestAnimationFrame(r))
      const orage = () => s.view.meteo && s.view.meteo.type === 'orage'
      const rearmer = () => {
        if (orage()) return
        s.sendAction({ type: 'debug_set_hour', hour: 12 })
        s.sendAction({ type: 'debug_meteo', meteo: 'orage', edge: 0, phase: 0.35 })
      }
      // ON NE SE TÉLÉPORTE PAS, ON BRAQUE L'OBJECTIF. La mesure n'a pas besoin que le JOUEUR
      // soit sous l'annonce — elle a besoin que l'annonce soit DANS L'IMAGE. Déplacer
      // l'avatar coûtait ~1,5 s de réconciliation de prédiction, soit toute la fenêtre de
      // télégraphe : trois tentatives de suite ont rendu « HORS CADRE » (MESURÉ). Braquer la
      // caméra est un geste d'OBJECTIF, pas de simulation : rien de l'état n'est fabriqué.
      const gele = (so) => {
        // La SIM d'abord (le worker cesse de tenir `ticksLeft`), le RENDU ensuite.
        s.send({ type: 'pause' })
        s.game.loop.sleep()
        const cam = s.cameras.main
        cam.stopFollow() // sinon `preRender` recentre sur l'avatar au pas suivant
        cam.centerOn(so.x * 16, so.y * 16)
        // UNE IMAGE POUR QUE LE CADRE SUIVE : `centerOn` écrit `scrollX/scrollY` tout de
        // suite, mais `worldView` — ce dont le viseur se sert pour convertir monde → écran —
        // n'est recalculé qu'au `preRender`. Sans ce pas, le viseur lirait l'ANCIEN cadre et
        // déclarerait « hors champ » le point qu'on vient d'amener au centre.
        s.game.step(s.game.loop.time + 16, 16)
        return {
          vu: true, sonde: { ...s.foudreFx.sonde },
          meteo: s.view.meteo ? s.view.meteo.type : null,
          bande: s.meteoLayer?.bande ?? null,
        }
      }
      // ON VISE LE HAUT DE LA RAMPE, MAIS PAS LE DERNIER TICK — et la borne basse est un
      // correctif MESURÉ. Le haut de la rampe (`ticksLeft` petit, alpha proche de 1) est
      // l'instant où l'annonce doit être ÉVIDENTE, donc celui qui compte. Mais un gel pris à
      // `ticksLeft = 1` a rendu « le télégraphe a bougé (1 → 0) » et « un éclair brûlait
      // (flash 0,362) » : le message `pause` est ASYNCHRONE, le worker finit les ticks déjà
      // en file, et à un tick de la frappe c'est la frappe qui passe. On garde donc quatre
      // ticks de marge — alpha ~0,90, et de quoi encaisser la latence du gel.
      //
      // La fenêtre visée ne dure que ~0,4 s pour un échantillonnage à ~1 image/s : on ne
      // l'a pas à tous les créneaux. On insiste, puis on se rabat sur n'importe quelle lueur
      // d'au moins quatre ticks — un relevé à mi-rampe est CONSERVATEUR (le télégraphe y est
      // plus pâle qu'au moment critique), donc il ne flatte rien.
      for (let i = 0; i < 2500; i++) {
        rearmer()
        const so = s.foudreFx.sonde
        if (so.ticksLeft >= 4 && so.ticksLeft <= 12) return gele(so)
        await frame()
      }
      for (let i = 0; i < 1500; i++) {
        rearmer()
        const so = s.foudreFx.sonde
        if (so.ticksLeft >= 4) return gele(so)
        await frame()
      }
      return { vu: false, raison: 'aucune lueur en 4000 images' }
    })

    const degeler = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.meteoLayer.grainActif = true
      s.foudreFx.liserFacteur = 0
      s.foudreFx.telegrapheActif = true
      // On REND la caméra au joueur : sans ça tout ce qui suit se jouerait hors champ.
      if (s.playerSprite) s.cameras.main.startFollow(s.playerSprite, true, 0.16, 0.16) // les réglages du jeu (WorldScene)
      s.game.loop.wake()
      s.send({ type: 'resume' })
    })

    let compare = null
    if (veut('telegraphe')) {
      // ── ① — jusqu'à trois tentatives : le gel peut arriver après que le tick a enjambé la
      //    frappe (le message `pause` est asynchrone), auquel cas il n'y a plus rien à voir.
      for (let essai = 1; essai <= 3 && !compare; essai++) {
        const tel = await chasseEtGele()
        if (!tel.vu) { console.error(`!! ① tentative ${essai} : ${tel.raison}`); continue }
        // LA PRÉMISSE, PROUVÉE AVANT DE MESURER : un front d'orage, une bande, un télégraphe.
        // Sans elle, un premier jet a mesuré un pré ensoleillé en croyant tenir un orage.
        const vu = await viseur(tel.sonde.x, tel.sonde.y)
        const hors = vu.sx < 0 || vu.sy < 0 || vu.sx > vu.W || vu.sy > vu.H
        console.log(
          `\n① LE TÉLÉGRAPHE (tentative ${essai}) — visé en (${Math.round(tel.sonde.x)}, ${Math.round(tel.sonde.y)}), ` +
          `ticksLeft ${tel.sonde.ticksLeft}, alpha ${Math.round(tel.sonde.alpha * 100) / 100}, ` +
          `front ${tel.meteo ?? 'AUCUN'}, bande ${tel.bande ? 'oui' : 'AUCUNE'}${hors ? ', HORS CADRE' : ''}`,
        )
        if (tel.meteo !== 'orage' || !tel.bande || hors) {
          console.error('!! ① prémisse fausse (pas d’orage, pas de bande, ou point hors cadre) — on recommence')
          await degeler(); await page.waitForTimeout(600); continue
        }
        // ── QUATRE ÉTALONS SUR LA MÊME IMAGE GELÉE, ET IL EN FAUT QUATRE.
        //
        // Comparer l'ANNEAU à ce qui l'entoure ne mesure pas le télégraphe : ça mesure le
        // télégraphe PLUS le décor sous lui. MESURÉ, et c'est ce qui a coûté une planche —
        // une annonce tombée en FORÊT DENSE a rendu Δ(anneau/dehors) = +3,6 sans pluie et
        // −3,4 avec : du bruit de houppiers dans les deux cas, et la question posée (« le
        // rideau noie-t-il l'annonce ? ») restait sans réponse parce que le SITE dominait le
        // signal. On éteint donc le télégraphe sur la MÊME image : le décor se soustrait
        // exactement, et il ne reste que ce que la lueur AJOUTE. Croisé avec l'interrupteur
        // du rideau, ça fait quatre prises — le patron des trois étalons du voisin, avec un
        // de plus parce qu'il y a ici deux couches à isoler, pas une.
        const LIVRE = 0 // ce qui est LIVRÉ (voir `foudre-fx` : le liseré mesure 0, il est éteint)
        const pas = async (i, opts) => page.evaluate(({ i, g, lf, tel }) => {
          const s = window.__BRAISES__.scene
          s.meteoLayer.grainActif = g
          s.foudreFx.liserFacteur = lf
          s.foudreFx.telegrapheActif = tel
          // LA BASE EST L'HORLOGE DE LA BOUCLE, jamais un nombre absolu (voir l'en-tête).
          s.game.step(s.game.loop.time + (i + 1) * 16, 16)
          return {
            gouttes: s.meteoLayer?.sonde?.vivantes ?? 0,
            ticksLeft: s.foudreFx.sonde.ticksLeft,
            alpha: s.foudreFx.sonde.alpha,
            flash: s.foudreFx.sonde.flash,
          }
        }, { i, g: opts.grain, lf: opts.lisere, tel: opts.tel })

        const prises = {}
        const etats = {}
        let i = 0
        const prendre = async (nom, opts, photo) => {
          etats[nom] = await pas(i++, opts)
          if (photo) await page.screenshot({ path: `${OUT}/${photo}`, timeout: 180000 })
          prises[nom] = await bandesDe(vu.sx, vu.sy, vu.zoom)
        }
        // Sous averse : avec le télégraphe (liseré livré), avec le télégraphe SANS liseré,
        // et sans télégraphe du tout.
        await prendre('pluieTel', { grain: true, lisere: LIVRE, tel: true }, 'foudre-telegraphe-sous-pluie.png')
        await prendre('pluieSansLisere', { grain: true, lisere: 0, tel: true }, null)
        await prendre('pluieNu', { grain: true, lisere: LIVRE, tel: false }, 'foudre-telegraphe-sous-pluie-temoin.png')
        // Sans rideau : les deux mêmes, pour savoir ce que la pluie COÛTE au signal.
        await prendre('secTel', { grain: false, lisere: LIVRE, tel: true }, 'foudre-telegraphe-sans-pluie.png')
        await prendre('secNu', { grain: false, lisere: LIVRE, tel: false }, null)

        // LA GARDE, sur les prises ELLES-MÊMES (et non sur la lecture d'avant le gel : le
        // message `pause` est asynchrone, deux ticks passent toujours entre les deux).
        const memeTel = etats.pluieTel.ticksLeft === etats.secNu.ticksLeft
          && Math.abs(etats.pluieTel.alpha - etats.secNu.alpha) < 1e-9
        const flashMax = Math.max(...Object.values(etats).map((e) => e.flash))
        if (!memeTel) console.error(`!! le télégraphe a bougé ENTRE LES PRISES (${etats.pluieTel.ticksLeft} → ${etats.secNu.ticksLeft}) — planche à jeter`)
        if (flashMax > 0.001) console.error(`!! un éclair brûlait pendant la mesure (flash ${flashMax.toFixed(3)}) — planche à jeter`)
        if (!etats.pluieTel.gouttes) console.error('!! 0 goutte vivante sous averse — on n’a pas mesuré ce qu’on croit')
        if (etats.secTel.gouttes) console.error(`!! ${etats.secTel.gouttes} gouttes encore vivantes au témoin sec — ce n’en est pas un`)
        await degeler()
        if (Object.values(prises).some((v) => !v)) { console.error('!! ① bandes non mesurables'); continue }

        const f = (v, n = 1) => String(Math.round(v * 10 ** n) / 10 ** n).padStart(8)
        // CE QUE LA LUEUR AJOUTE, décor éliminé : anneau(avec) − anneau(sans), à rideau égal.
        const gainPluie = prises.pluieTel.anneau.moy - prises.pluieNu.anneau.moy
        const gainSec = prises.secTel.anneau.moy - prises.secNu.anneau.moy
        // CE QUE LE LISERÉ CREUSE, décor éliminé : liseré(avec) − liseré(sans liseré).
        const creuxLisere = prises.pluieTel.lisere.moy - prises.pluieSansLisere.lisere.moy
        console.log(
          `   ${etats.pluieTel.gouttes} gouttes sous averse · 0 au témoin sec · alpha ${Math.round(etats.pluieTel.alpha * 100) / 100}` +
          ` · télégraphe identique sur les 5 prises : ${memeTel ? 'OUI' : 'NON'} · flash max ${flashMax.toFixed(3)}\n` +
          `   µ DE LA BANDE D'ANNEAU (rayon 1,3-1,7 tuile, le rayon de dégâts) :\n` +
          `     sous averse   télégraphe ALLUMÉ ${f(prises.pluieTel.anneau.moy)}   ÉTEINT ${f(prises.pluieNu.anneau.moy)}` +
          `   → LA LUEUR AJOUTE ${f(gainPluie)}\n` +
          `     sans rideau   télégraphe ALLUMÉ ${f(prises.secTel.anneau.moy)}   ÉTEINT ${f(prises.secNu.anneau.moy)}` +
          `   → LA LUEUR AJOUTE ${f(gainSec)}\n` +
          `   ⇒ CE QUE LE RIDEAU COÛTE À L'ANNONCE : ${f(gainPluie - gainSec)} de luminance` +
          ` (${Math.round((gainPluie / Math.max(0.01, gainSec)) * 100)} % du signal conservé sous l'averse la plus dense)\n` +
          `   LE LISERÉ SOMBRE, décor éliminé : ${f(creuxLisere)} de luminance sur sa bande (négatif = il CREUSE, c'est voulu)\n` +
          `   la zone entière sous averse : µ ${f(prises.pluieTel.tout.moy)}  σ ${f(prises.pluieTel.tout.ec)}` +
          `  σ/µ ${f(prises.pluieTel.tout.cv, 3)}  p01 ${f(prises.pluieTel.tout.p01)}  p50 ${f(prises.pluieTel.tout.p50)}  p99 ${f(prises.pluieTel.tout.p99)}`,
        )
        if (gainPluie <= 0) console.error('!! LA LUEUR N’AJOUTE RIEN SOUS LA PLUIE — le télégraphe ne se voit pas')
        compare = { gainPluie, gainSec, creuxLisere, prises, etats, memeTel, flashMax }
      }
      if (!compare) console.error('!! ① jamais mesuré après 3 tentatives')
    }

    // ════════════════════════════════════════════════════════════════════════
    // ② LE TRAIT · ③ LA SECOUSSE · ④ LA GERBE
    // ════════════════════════════════════════════════════════════════════════
    let battements = []
    let secousse = null
    let gerbe = null
    if (veut('frappe')) {
      // On endort la boucle AVANT la frappe et on avance À LA MAIN : sinon l'éclair (172 ms)
      // naît et meurt entre deux images (~900 ms ici). La sim, elle, TOURNE — elle vit dans le
      // worker, hors de la boucle : le tick d'impact finit par arriver.
      const frappe = await page.evaluate(async () => {
        const s = window.__BRAISES__.scene
        const frame = () => new Promise((r) => requestAnimationFrame(r))
        const orage = () => s.view.meteo && s.view.meteo.type === 'orage'
        const rearmer = () => {
          if (orage()) return
          s.sendAction({ type: 'debug_set_hour', hour: 12 })
          s.sendAction({ type: 'debug_meteo', meteo: 'orage', edge: 0, phase: 0.35 })
        }

        // ── PHASE 1 — SE METTRE EN PLACE, BOUCLE ÉVEILLÉE. C'est le correctif MESURÉ : un
        //    premier jet endormait la boucle tout de suite, et la frappe est tombée à
        //    **731 tuiles du joueur** — secousse 0, gerbe et trait hors champ. La raison :
        //    `secousseDist` se calcule sur `predicted`, la position PRÉDITE, qui met ~1,5 s
        //    à rejoindre la sim après un TP ; en steppant à la main on n'avançait la scène
        //    que de 16 ms par 30 ms réelles, si bien que la réconciliation était AFFAMÉE et
        //    ne rattrapait jamais. On laisse donc tourner le vrai temps jusqu'à ce que
        //    l'avatar soit VRAIMENT arrivé sous l'annonce — et on ne gèle qu'après.
        let enPlace = false
        for (let i = 0; i < 3000 && !enPlace; i++) {
          rearmer()
          const so = s.foudreFx.sonde
          const p = s.registry.get('playerPos')
          if (so.ticksLeft > 0) {
            const d = Math.hypot(p.x - so.x, p.y - so.y)
            // Assez près pour que la secousse soit quasi pleine (la rampe vaut 96 % à
            // 3,5 tuiles) et que le point tombe dans le cadre.
            if (d < 3.5) enPlace = true
            else s.sendAction({ type: 'debug_teleport', x: so.x, y: so.y })
          }
          await frame()
        }
        if (!enPlace) return { vu: false, raison: 'jamais arrivé sous une annonce' }

        // ── PHASE 2 — GELER ET AVANCER À LA MAIN. L'éclair dure 172 ms quand une image en
        //    dure parfois 900 : c'est la seule façon de le photographier.
        s.game.loop.sleep()
        const n0 = s.foudreFx.sonde.eclairs
        let t = s.game.loop.time
        for (let i = 0; i < 1200; i++) {
          t += 16
          s.game.step(t, 16)
          if (s.foudreFx.sonde.eclairs > n0) {
            return {
              vu: true, t, sonde: { ...s.foudreFx.sonde },
              joueur: { ...s.registry.get('playerPos') },
            }
          }
          rearmer()
          // On rend la main au worker : c'est LUI qui fait avancer le tick, et sans cette
          // respiration `lastTime.tick` ne bougerait jamais.
          await new Promise((r) => setTimeout(r, 12))
        }
        return { vu: false, raison: 'aucune frappe après le gel', sonde: { ...s.foudreFx.sonde } }
      })

      if (!frappe.vu) console.error(`!! aucune frappe vue (${frappe.raison ?? '?'}) — ②③④ sans mesure`)
      else {
        console.log(
          `\n② LA FRAPPE — en (${Math.round(frappe.sonde.eclairX)}, ${Math.round(frappe.sonde.eclairY)}), ` +
          `tuile abritée : ${frappe.sonde.abrite ? 'OUI (gerbe et brûlure supprimées)' : 'non'} · ` +
          `${frappe.sonde.runs} rectangles de trait · ${frappe.sonde.gerbeVivantes} éclats de gerbe`,
        )
        // ── ON ÉCARTE L'AVATAR DU POINT DE FRAPPE. La chasse l'a téléporté DESSUS, et la
        //    gerbe est au sol (profondeur 4,52) donc SOUS lui : elle serait cachée par le
        //    corps même dont on veut voir les pieds éclaboussés. La secousse, elle, est déjà
        //    enregistrée (elle s'est décidée AU MOMENT de la frappe), donc rien n'est perdu.
        await page.evaluate(({ x, y }) => {
          window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: x + 3, y: y + 3 })
        }, { x: frappe.sonde.eclairX, y: frappe.sonde.eclairY })

        // ── LES BATTEMENTS : 20 ms par pas, et on photographie CHAQUE cran distinct. C'est
        //    la seule façon de montrer qu'un éclair BAT plutôt que de s'éteindre — une photo
        //    unique ne le dirait pas.
        const vus = new Set()
        let gerbePrise = false
        for (let k = 0; k < 11; k++) {
          const e = await page.evaluate(({ t, k }) => {
            const s = window.__BRAISES__.scene
            s.game.step(t + k * 20, 20)
            const sh = s.cameras.main.shakeEffect
            return {
              b: s.foudreFx.sonde.battement, visible: s.foudreFx.sonde.traitVisible,
              gerbe: s.foudreFx.sonde.gerbeVivantes, flash: s.foudreFx.sonde.flash,
              runs: s.foudreFx.sonde.runs,
              offX: sh ? sh._offsetX : 0, offY: sh ? sh._offsetY : 0,
            }
          }, { t: frappe.t, k: k + 1 })
          battements.push({ pas: k, age: (k + 1) * 20, ...e })
          if (e.visible && !vus.has(e.b)) {
            vus.add(e.b)
            await page.screenshot({ path: `${OUT}/foudre-trait-battement-${e.b}.png`, timeout: 180000 })
          }
          // ── LA GERBE SE PHOTOGRAPHIE JEUNE, ET DANS CETTE BOUCLE-CI. Elle ne vit que
          //    300 ms : une prise « après les battements » la trouve morte (MESURÉ : 0 éclat
          //    vivant à 240 ms de la frappe, alors que la boucle en comptait encore).
          //
          //    MAIS PAS TROP TÔT NON PLUS, et c'est la seconde leçon : à 80 ms les éclats
          //    n'ont parcouru que 0,3 à 0,8 tuile, or la LUEUR D'IMPACT couvre 1,5 tuile de
          //    rayon en ADD — la gerbe était donc ENTIÈREMENT sous le halo blanc, et la
          //    photo ne montrait qu'un dôme (MESURÉ, planche du 2026-08-19). À 180 ms la
          //    lueur est retombée à ~13 % et la couronne a franchi la tuile : les deux se
          //    laissent voir. On cadre sur le POINT DE FRAPPE, pas sur le télégraphe.
          if (k === 8 && !gerbePrise) {
            gerbePrise = true
            const vg = await viseur(frappe.sonde.eclairX, frappe.sonde.eclairY)
            if (vg.sx < 0 || vg.sy < 0 || vg.sx > vg.W || vg.sy > vg.H) {
              console.error(`!! le point de frappe est HORS CADRE (${Math.round(vg.sx)}, ${Math.round(vg.sy)}) — le gros plan ne montrera rien`)
            }
            await page.screenshot({
              path: `${OUT}/foudre-gerbe.png`,
              clip: {
                x: Math.max(0, Math.min(1280 - 340, Math.round(vg.sx - 170))),
                y: Math.max(0, Math.min(660 - 340, Math.round(vg.sy - 170))),
                width: 340, height: 340,
              },
              timeout: 180000,
            })
          }
        }
        console.log(
          `   battements traversés (un pas = 20 ms) : [${battements.map((b) => (b.visible ? `#${b.b}` : '·')).join(' ')}]` +
          `  → ${vus.size} cran(s) distinct(s) photographié(s)\n` +
          `   éclats de gerbe VIVANTS le long de la salve :  ${battements.map((b) => `${b.age}ms:${b.gerbe}`).join('  ')}`,
        )
        if (vus.size < 2) console.error('!! un seul cran vu : le trait ne BAT pas (ou le pas de 20 ms enjambe la salve)')

        // ③ LA SECOUSSE, EN PIXELS D'ÉCRAN RÉELS — lue sur l'effet, pas déduite.
        const offs = battements.map((b) => Math.max(Math.abs(b.offX), Math.abs(b.offY)))
        secousse = {
          dist: frappe.sonde.secousseDist, intensite: frappe.sonde.secousse,
          reduit: frappe.sonde.mouvementReduit, pxMax: Math.max(0, ...offs),
        }
        console.log(
          `\n③ LA SECOUSSE — frappe à ${Math.round(secousse.dist * 10) / 10} tuiles du joueur → intensité ${secousse.intensite.toFixed(5)}` +
          ` = ${Math.round(secousse.pxMax * 10) / 10} px d'écran au pic (lu sur shakeEffect, pas déduit)`,
        )
        // ── L'ÉTALONNAGE DU MOTEUR, à part et nommé comme tel. Ce qu'on vient de lire prouve
        //    que la RAMPE est branchée sur la vraie position du joueur ; il reste à savoir ce
        //    que « intensité 0,0022 » vaut EN PIXELS, et personne ne lit ça de tête —
        //    `camera.shake` déplace de `±intensité × camera.width × zoom`. On le demande donc
        //    au moteur directement. Ce n'est PAS le chemin de jeu (aucune frappe ici) : c'est
        //    la conversion de l'unité, mesurée sur le moteur qui l'applique.
        const etal = await page.evaluate(async ({ ms }) => {
          const s = window.__BRAISES__.scene
          const cam = s.cameras.main
          const out = []
          for (const inten of [0.0022, 0.0011, 0.00055]) {
            cam.shake(ms, inten, true)
            let pire = 0
            let t = s.game.loop.time
            for (let i = 0; i < 10; i++) {
              t += 16
              s.game.step(t, 16)
              const sh = cam.shakeEffect
              if (sh) pire = Math.max(pire, Math.abs(sh._offsetX), Math.abs(sh._offsetY))
            }
            out.push({ inten, px: pire })
          }
          cam.shakeEffect?.reset?.()
          return { out, largeur: cam.width, zoom: cam.zoom }
        }, { ms: 180 })
        console.log(
          `   étalonnage du moteur (cadre ${etal.largeur} px, zoom ${Math.round(etal.zoom * 100) / 100}) — ce que vaut une intensité :\n` +
          etal.out.map((o) => `     ${o.inten.toFixed(5)} → ${String(Math.round(o.px * 10) / 10).padStart(6)} px d'écran au pic`).join('\n'),
        )
        secousse.etalon = etal.out

        // ④ LA GERBE — photographiée JEUNE. Elle ne vit que 300 ms : la prendre à 400 ms,
        //    c'est la prendre morte (ce que le premier jet a fait).
        await page.screenshot({ path: `${OUT}/foudre-frappe-plein-cadre.png`, timeout: 180000 })
        const auMax = battements.reduce((a, b) => (b.gerbe > a.gerbe ? b : a), battements[0])
        gerbe = { max: auMax.gerbe, ageMax: auMax.age, total: frappe.sonde.gerbeTotal }
        console.log(
          `\n④ LA GERBE — ${gerbe.max} éclats vivants au plus fort (à ${gerbe.ageMax} ms de la frappe),` +
          ` ${frappe.sonde.gerbeTotal} éclos depuis le début du scénario · gros plan pris à 180 ms`,
        )
        if (!gerbe.max && !frappe.sonde.abrite) console.error('!! aucun éclat vivant sur toute la salve — la gerbe ne vit pas')
        await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // ③bis `prefers-reduced-motion` — la convention EXISTANTE, étendue au shake
    // ════════════════════════════════════════════════════════════════════════
    //
    // Il n'y a AUCUN réglage de confort en jeu (l'écran Options ne porte que le son et les
    // touches), mais `prefers-reduced-motion` est déjà honoré en CSS par `menu-dom`,
    // `hud-core` et `season-veil`. On l'étend, donc on le PROUVE — sinon la vérification ne
    // teste pas la chose. `debug_speed` accélère la sim : un créneau de foudre dure 400
    // ticks, soit 20 s à cadence normale et ~1,3 s à ×16.
    let calme = null
    if (veut('confort')) {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(() => window.__BRAISES__.scene.send({ type: 'debug_speed', factor: 8 }))
      calme = await page.evaluate(async () => {
        const s = window.__BRAISES__.scene
        const n0 = s.foudreFx.sonde.eclairs
        let pire = 0
        for (let i = 0; i < 600; i++) {
          await new Promise((r) => requestAnimationFrame(r))
          const sh = s.cameras.main.shakeEffect
          if (sh) pire = Math.max(pire, Math.abs(sh._offsetX), Math.abs(sh._offsetY))
          if (!s.view.meteo || s.view.meteo.type !== 'orage') {
            s.sendAction({ type: 'debug_meteo', meteo: 'orage', edge: 0, phase: 0.35 })
          }
          if (s.foudreFx.sonde.eclairs > n0 + 1) break
        }
        return { frappes: s.foudreFx.sonde.eclairs - n0, sonde: { ...s.foudreFx.sonde }, pire }
      })
      console.log(
        `\n③bis prefers-reduced-motion : ${calme.frappes} frappe(s) · secousse demandée ${calme.sonde.secousse}` +
        ` · déplacement caméra max ${Math.round(calme.pire * 100) / 100} px · drapeau ${calme.sonde.mouvementReduit}`,
      )
      if (calme.frappes > 0 && (calme.sonde.secousse !== 0 || calme.pire > 0.001)) {
        console.error('!! la secousse joue MALGRÉ prefers-reduced-motion')
      }
      if (calme.frappes === 0) console.error('!! aucune frappe pendant le relevé reduced-motion — la garde ne prouve rien')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }

    // ════════════════════════════════════════════════════════════════════════
    // ④bis LE COÛT — le chronomètre interne, sur les seules images qui DESSINENT
    // ════════════════════════════════════════════════════════════════════════
    let cout = null
    if (veut('cout')) {
      // ×8 ET NON ×16 : à ×16 le relevé s'est ENLISÉ (>12 min sans rendre la main). Sous
      // swiftshader, une image coûte déjà ~1 s ; en seize fois, chaque image doit balayer
      // des centaines de ticks de foudre et le fil principal ne rend plus la main entre
      // deux `page.evaluate`. ×8 suffit largement : un créneau dure 400 ticks, soit 2,5 s.
      await page.evaluate(() => window.__BRAISES__.scene.send({ type: 'debug_speed', factor: 8 }))
      const nAvant = (await sonde()).eclairs
      // On laisse tomber PLUSIEURS frappes : une moyenne sur une seule image est une image
      // heureuse, pas une mesure. Et on rallume le front s'il s'épuise pendant le relevé.
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          if (!s.view.meteo || s.view.meteo.type !== 'orage') {
            s.sendAction({ type: 'debug_set_hour', hour: 12 })
            s.sendAction({ type: 'debug_meteo', meteo: 'orage', edge: 0, phase: 0.35 })
          }
        })
        await page.waitForTimeout(2000)
      }
      const fin = await sonde()
      const meteo = await page.evaluate(() => ({ ...(window.__BRAISES__.scene.meteoLayer?.sonde ?? {}) }))
      await page.evaluate(() => window.__BRAISES__.scene.send({ type: 'debug_speed', factor: 1 }))
      const f3 = (v) => String(Math.round(v * 1000) / 1000).padStart(7)
      console.log(
        `\n④bis LE COÛT — ${fin.eclairs - nAvant} frappes pendant le relevé\n` +
        `   LA FOUDRE sur le fil principal : ${f3(fin.msDessin)} ms/image, moyennées sur ${fin.imagesDessin} images QUI DESSINENT\n` +
        `     (le trait, la gerbe ou la lueur ; les images de créneau vide sont exclues — elles\n` +
        `      noieraient 340 ms de frappe dans vingt secondes de rien)\n` +
        `   LE RIDEAU au même instant : ${meteo.vivantes} particules / cible ${meteo.cible} / budget ${meteo.budget}` +
        `${meteo.plafonne ? ' PLAFONNÉ' : ''} · physique ${f3(meteo.msPhysique)} + peinture ${f3(meteo.msPeinture)}` +
        ` = ${f3(meteo.msPhysique + meteo.msPeinture)} ms/image\n` +
        `   ${fin.gerbeTotal} éclats de gerbe éclos depuis le début`,
      )
      if (!fin.imagesDessin) console.error('!! aucune image de dessin chronométrée — le coût relevé ne vaut rien')
      cout = { foudre: fin, meteo }
    }

    await agir({ type: 'debug_meteo', meteo: null }, 400)
    return { telegraphe: compare, battements, secousse, gerbe, calme, cout }
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
        // L'ÉTAT VIDE de la liste : à la minute zéro il est CORRECT d'être vide (une recette
        // ne se révèle qu'au contact de sa matière — `decouverte.ts`, règle D2). Ce qui se
        // vérifie n'est donc pas « il y a des recettes », c'est « le vide est DIT ».
        videTexte: document.querySelector('.hch-liste-vide')?.textContent ?? '',
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
    // ⚠ « AUCUNE RECETTE » N'EST PAS UN DÉFAUT À LA MINUTE ZÉRO — et la sonde l'accusait
    // depuis toujours. `seen` est vide par construction au premier instant : une recette ne se
    // révèle qu'au contact de sa matière. Ce qui manquait n'était pas les recettes, c'était de
    // le DIRE — un tiers d'écran blanc sous un titre, sans une phrase. (Audit UX, L3-03.)
    // On vérifie donc les deux moitiés : le vide est dit, PUIS une matière le peuple.
    if (vue.nRecipes > 0) {
      console.log(`   ✓ ${vue.nRecipes} recettes affichées`)
    } else if (vue.videTexte.trim()) {
      console.log(`   ✓ liste vide, et elle le DIT : « ${vue.videTexte.trim()} »`)
    } else {
      console.error(`   !! aucune recette ET aucun état vide : un tiers d'écran blanc, sans un mot`)
    }
    console.log(vue.weight.includes('/') ? `   ✓ la charge s'affiche : « ${vue.weight} »` : `   ✗ la charge ne s'affiche pas`)

    // ═══ LE BANDEAU SE VOIT PAR-DESSUS L'ÉCRAN OUVERT (audit UX 2026-08-20, P0.2) ═══
    //
    // C'ÉTAIT LE DÉFAUT CARDINAL, et il se prouve ici parce que c'est ici qu'il mordait :
    // l'écran du sac (`.hch`, inset:0 OPAQUE) est justement celui d'où partent les gestes
    // d'objet, avec leurs quinze motifs de refus. L'alerte, peinte sur le canvas, passait
    // dessous : sac ouvert, une action refusée ne produisait NI SON NI IMAGE — et le silence
    // sonore avait été décidé au motif qu'« il y a déjà un toast ».
    //
    // On pose une alerte dans la file pendant que l'écran est ouvert, et on exige de la LIRE.
    await page.evaluate(() => {
      const reg = window.__BRAISES__.scene.registry
      reg.set('alertes', [...(reg.get('alertes') ?? []), 'matériaux insuffisants'])
    })
    await page.waitForTimeout(350)
    // ⚠ ON FIGE LA BOUCLE, SINON LA CAPTURE ARRIVE APRÈS LE BANDEAU. Une capture pleine page
    // coûte plusieurs secondes sur le rendu logiciel de cette machine ; l'alerte, elle, tient
    // 2,5 s puis se fond en 0,6. Mesuré en le ratant : au moment du cliché, l'élément était
    // déjà à `display:none`, opacité 0,14 — le DOM disait vrai, le pixel disait vide, et
    // c'était l'INSTRUMENT qui arrivait en retard. Endormir la boucle gèle `this.time.now`,
    // donc l'horloge du bandeau. Même remède que le scénario `juice` pour ses toasts.
    await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
    const bandeau = await page.evaluate(() => {
      const hch = document.querySelector('.hch')
      const el = document.querySelector('.bnd-alerte')
      if (!el) return { monte: false }
      const st = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      // Le test qui tranche : au CENTRE du bandeau, quel élément est le plus haut ? Le
      // bandeau est transparent au clic (il ne doit voler aucun geste), donc `elementFromPoint`
      // rend ce qu'il y a DESSOUS — on compare donc les contextes d'empilement à la main.
      const zBnd = Number(getComputedStyle(document.querySelector('.bnd')).zIndex)
      const zHud = Number(getComputedStyle(document.querySelector('.hud-overlay')).zIndex)
      return {
        monte: true,
        ecranOuvert: Boolean(hch && getComputedStyle(hch).display !== 'none'),
        texte: (el.textContent ?? '').trim(),
        visible: st.display !== 'none' && Number(st.opacity) > 0.5,
        aire: Math.round(r.width) + '×' + Math.round(r.height),
        ou: Math.round(r.left) + ',' + Math.round(r.top) + '→' + Math.round(r.right) + ',' + Math.round(r.bottom),
        couleur: st.color,
        opacite: st.opacity,
        zBandeau: zBnd,
        zHud,
        // QUI EST AU-DESSUS, À CET ENDROIT PRÉCIS ? On rallume le pointeur le temps de la
        // mesure (le bandeau est volontairement transparent au clic, donc invisible à
        // `elementsFromPoint` sinon), et on lit la pile de haut en bas.
        pile: (() => {
          const bnd = document.querySelector('.bnd')
          const avant = bnd.style.pointerEvents
          bnd.style.pointerEvents = 'auto'
          const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
          const noms = document.elementsFromPoint(cx, cy).slice(0, 5).map((e) => e.className || e.tagName)
          bnd.style.pointerEvents = avant
          return noms.join(' < ')
        })(),
      }
    })
    console.log(bandeau.monte && bandeau.ecranOuvert && bandeau.visible && bandeau.zBandeau > bandeau.zHud
      ? `   ✓ P0.2 — l'alerte se LIT par-dessus l'écran du sac : « ${bandeau.texte} » (${bandeau.aire} @ ${bandeau.ou}, ${bandeau.couleur}, opacité ${bandeau.opacite}, z ${bandeau.zBandeau} > HUD ${bandeau.zHud})\n      pile au centre : ${bandeau.pile}`
      : `   ✗ P0.2 — l'alerte ne se voit pas sur l'écran ouvert : ${JSON.stringify(bandeau)}`)
    await page.screenshot({ path: `${OUT}/craft-bandeau.png` })
    await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())

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
   * LE CONTOUR DE L'INTERACTION (demande d'Alexis, 2026-08-03) — un liseré blanc d'un pixel
   * d'art autour de ce que la touche `F` prendrait sous le curseur.
   *
   * CE QUI NE SE PROUVE QU'AU NAVIGATEUR : le résolveur, lui, est pur et testé
   * (`aim.test.ts` — quelle cible, dans quel ordre). Ce qu'aucun test unitaire ne peut dire,
   * c'est si le trait EXISTE À L'ÉCRAN. Il est fait de huit copies de la silhouette peintes
   * DERRIÈRE le sprite : une erreur de profondeur (devant au lieu de derrière) donne une
   * silhouette blanche pleine et non un contour, et une teinte multiplicative au lieu de
   * `FILL` le rendrait invisible sur les textures sombres. Les deux se voient en pixels, en
   * comptant le BLANC autour de la cible — jamais en lisant du code.
   *
   * ⚠ LE COMPTE SE FAIT SUR UN ANNEAU, PAS SUR UN CARRÉ : le blanc qu'on cherche est DEHORS,
   * contre la silhouette. Compter le rectangle entier compterait aussi l'intérieur du sprite,
   * où il n'y a rien à voir, et noierait le signal.
   *
   * Exige `--dev` (téléportation, dons).
   */
  async contour(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 60000 })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 11 }))
    await page.waitForTimeout(400)

    /** L'état du contour, lu DANS le jeu : la cible résolue, les copies allumées, leur teinte
     *  et leur profondeur par rapport au sprite qu'elles cernent. */
    const etat = () => page.evaluate(() => {
      const v = window.__BRAISES__.scene.view
      const pool = v.contourPool ?? []
      const vus = pool.filter((c) => c.visible)
      return {
        cible: v.interactTarget === null ? null : { ...v.interactTarget },
        copies: vus.length,
        teinte: vus[0]?.tintTopLeft ?? null,
        derriere: vus.length > 0 && v.contourNodeSprite !== null ? vus[0].depth < v.contourNodeSprite.depth : null,
      }
    })

    /**
     * LE CADRE DU SPRITE VISÉ, EN COORDONNÉES DE PAGE — l'ancre de toute mesure optique.
     *
     * ⚠ LE CANVAS N'EST PAS LA PAGE. Phaser le cadre en « FIT » : à 1280×800 pour 20 tuiles
     * de 16 px, le jeu tourne au zoom 2,25 et le canvas est CENTRÉ dans la fenêtre, bandes
     * noires comprises — ~38 px de décalage vertical, MESURÉ. La conversion naïve
     * `(monde - worldView) × zoom` rend une coordonnée de CANVAS ; la donner telle quelle à
     * une capture (ou à la souris) vise 38 px trop haut, et l'on photographie l'herbe à côté
     * de l'objet en croyant photographier l'objet. On passe donc par le rectangle réel du
     * canvas, échelle CSS comprise.
     *
     * On lit le sprite RÉEL (position, échelle, ancre), jamais la tuile : un nœud est décalé
     * dans sa tuile, et son ancre est aux pieds.
     */
    const cadre = (cible = null) => page.evaluate((c) => {
      const s = window.__BRAISES__.scene
      const v = s.view
      // LA CIBLE EXPLICITE SERT LES MESURES TÉMOINS : elle donne le cadre de l'objet MÊME
      // quand le contour est éteint (sinon le témoin n'aurait aucun cadre où compter, et
      // « 0 px blanc » ne vaudrait rien). Sans elle, on retombe sur le sprite souligné.
      const sp = (c === null
        ? null
        : c.kind === 'pile'
          ? v.groundSprites.get(c.id)
          : c.kind === 'fire'
            ? v.structureSprites.get(c.id)
            : v.contourNodeSprite)
        ?? v.contourNodeSprite ?? (v.contourPool ?? []).find((k) => k.visible)
      if (!sp) return null
      const cam = s.cameras.main
      const cv = s.game.canvas
      const r = cv.getBoundingClientRect()
      const ex = r.width / cv.width
      const ey = r.height / cv.height
      // `getBounds` ET PAS (x − w·originX) : une FLÈCHE PLANTÉE est inclinée de ±32° autour
      // d'un pivot bas (0,5 / 0,85), et la boîte naïve tombe alors à 10 px monde de l'objet —
      // MESURÉ : elle photographiait l'herbe à côté et concluait « le trait ne se voit pas ».
      // `getBounds` intègre rotation, échelle et ancre, donc il vaut pour les trois familles.
      const b = sp.getBounds()
      return {
        x: r.left + (b.x - cam.worldView.x) * cam.zoom * ex,
        y: r.top + (b.y - cam.worldView.y) * cam.zoom * ey,
        w: b.width * cam.zoom * ex,
        h: b.height * cam.zoom * ey,
      }
    }, cible)

    /**
     * COMBIEN DE PIXELS BLANCS SUR LE CADRE DU SPRITE (plus 6 px de marge).
     *
     * TOUT le cadre, intérieur compris — et c'est une correction : le premier jet ne comptait
     * qu'un anneau extérieur, en croyant que le contour bordait le CADRE. Il borde la
     * SILHOUETTE, qui est bien plus petite que son cadre (un buisson ne remplit pas ses
     * 16×16), donc les trois quarts du trait tombaient dans la zone exclue. On compte tout :
     * rien d'autre n'est blanc ici, et la mesure témoin (sans survol) le prouve à chaque fois.
     *
     * Blanc = trois canaux hauts ET neutres : l'or de visée (#ffe9a8) et le feu sont recalés.
     *
     * `seuil` / `dNeutre` s'ASSOUPLISSENT AU CONTACT D'UNE SOURCE DE LUMIÈRE, et il le faut :
     * la lueur d'un feu réchauffe tout ce qui l'entoure, contour compris — MESURÉ, un liseré
     * parfaitement net autour d'un feu de camp ne rendait que 4 px « blancs neutres » alors
     * qu'il se voit à l'œil sur la capture. Un filtre neutre ne survit pas à côté d'une flamme.
     * C'est le TÉMOIN (même cadre, survol éteint) qui garde alors la mesure honnête.
     */
    const blancsAutour = async (c, seuil = 235, dNeutre = 12) => {
      const M = 6
      const clip = {
        x: Math.max(0, Math.round(c.x - M)),
        y: Math.max(0, Math.round(c.y - M)),
        width: Math.round(c.w + 2 * M),
        height: Math.round(c.h + 2 * M),
      }
      const r = await regionAt(page, clip)
      if (!r) return null
      let n = 0
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const [rr, vv, bb] = r.px(x, y)
          if (rr >= seuil && vv >= seuil && bb >= seuil && Math.max(rr, vv, bb) - Math.min(rr, vv, bb) <= dNeutre) n++
        }
      }
      return n
    }

    /**
     * FIGER L'IMAGE AVANT DE LA MESURER (règle maison) — et ici pour une raison précise : la
     * CAMÉRA NE S'ARRÊTE JAMAIS. Elle glisse vers l'avatar après une téléportation, et elle
     * décale encore vers le curseur (le « lookahead » façon Foxhole, `framing.ts` R11). Une
     * souris immobile vise donc une tuile MOUVANTE : MESURÉ, la cible passait de la pile à la
     * tuile voisine PENDANT la seconde que prennent les captures, et le contour s'éteignait
     * entre l'état relevé et l'image photographiée. Ce n'est pas un défaut du jeu — en main,
     * la souris suit — c'est le prix d'un banc qui ne bouge pas.
     */
    const figer = () => page.evaluate(() => void window.__BRAISES__.scene.game.loop.sleep())
    const degeler = () => page.evaluate(() => void window.__BRAISES__.scene.game.loop.wake())

    /**
     * POSER LE CURSEUR SUR LE CENTRE D'UNE TUILE — et VÉRIFIER qu'il y est.
     *
     * Le premier jet projetait la tuile une fois et croyait la viser. Il visait à côté, et
     * les sept mesures suivantes lisaient un survol qui n'avait jamais eu lieu : après une
     * téléportation la CAMÉRA GLISSE encore vers l'avatar, donc l'écran bouge sous une
     * souris qui, elle, ne bouge plus. La projection était juste à l'instant du calcul et
     * périmée 200 ms plus tard.
     *
     * On demande donc au jeu ce qu'il vise VRAIMENT (`inputs.aim`, le résolveur de la
     * touche) et l'on corrige le tir de l'écart mesuré, jusqu'à trois fois. C'est la seule
     * façon d'être sûr que ce qu'on mesure ensuite parle de la bonne tuile.
     */
    const viser = async (tx, ty) => {
      // LA CAMÉRA D'ABORD : elle GLISSE vers l'avatar après une téléportation, et viser
      // pendant qu'elle glisse revient à viser l'écran d'il y a 200 ms.
      let avant = null
      for (let i = 0; i < 25; i++) {
        const s = await page.evaluate(() => {
          const c = window.__BRAISES__.scene.cameras.main
          return { x: Math.round(c.scrollX), y: Math.round(c.scrollY) }
        })
        if (avant && s.x === avant.x && s.y === avant.y) break
        avant = s
        await page.waitForTimeout(120)
      }
      let p = null
      for (let essai = 0; essai < 3; essai++) {
        const r = await page.evaluate(({ tx, ty, p }) => {
          const s = window.__BRAISES__.scene
          const cam = s.cameras.main
          // Coordonnées de PAGE (le canvas est centré, bandes noires comprises — voir `cadre`).
          const cv = s.game.canvas
          const rc = cv.getBoundingClientRect()
          const vise = p ?? {
            x: rc.left + ((tx + 0.5) * 16 - cam.worldView.x) * cam.zoom * (rc.width / cv.width),
            y: rc.top + ((ty + 0.5) * 16 - cam.worldView.y) * cam.zoom * (rc.height / cv.height),
          }
          // UN PIXEL DE PAGE, EN TUILES — le facteur qui convertit un écart mesuré dans le
          // monde en correction de souris. La correction se fait dans le repère où l'on AGIT.
          return { vise, parTuile: { x: 16 * cam.zoom * (rc.width / cv.width), y: 16 * cam.zoom * (rc.height / cv.height) } }
        }, { tx, ty, p })
        p = r.vise
        await page.mouse.move(p.x, p.y, { steps: 4 })
        await page.waitForTimeout(240)
        const ou = await page.evaluate(() => {
          const v = window.__BRAISES__.scene.inputs.aim(window.__BRAISES__.scene.input.activePointer)
          return { tx: v.tx, ty: v.ty }
        })
        if (ou.tx === tx && ou.ty === ty) return p
        p = { x: p.x + (tx - ou.tx) * r.parTuile.x, y: p.y + (ty - ou.ty) * r.parTuile.y }
      }
      await page.mouse.move(p.x, p.y, { steps: 2 })
      await page.waitForTimeout(240)
      return p
    }

    // ── ① UN BUISSON DE CUEILLETTE SURVOLÉ S'ENTOURE ────────────────────────────────
    const buisson = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const b = s.view.nodes.find((n) => n.type === 'berry_bush' && n.stock > 0)
      if (!b) return null
      // À L'OUEST, PAS AU SUD : planté sous le buisson, l'avatar le RECOUVRE (il fait 24 px de
      // haut pour 16 au buisson, et il se trie devant) — la capture montrait alors le contour
      // de dos, autour d'un objet invisible. De côté, à 1,1 tuile, on garde la portée de bras
      // (1,5) et le buisson reste entier à l'image.
      s.sendAction({ type: 'debug_teleport', x: b.tx - 0.6, y: b.ty + 0.55 })
      return { id: b.id, tx: b.tx, ty: b.ty }
    })
    if (!buisson) { console.log('   ✗ aucun buisson à baies sur cette carte'); return {} }
    await page.waitForTimeout(600)
    await viser(buisson.tx, buisson.ty)
    const surBuisson = await etat()
    console.log(surBuisson.cible?.kind === 'node' && surBuisson.cible.id === buisson.id && surBuisson.copies === 8
      ? `   ✓ buisson survolé : cible « node ${buisson.id} », ${surBuisson.copies} copies allumées`
      : `   ✗ buisson survolé : ${JSON.stringify(surBuisson)}`)
    console.log(surBuisson.teinte === 0xffffff
      ? `   ✓ le liseré est BLANC (${surBuisson.teinte?.toString(16)})`
      : `   ✗ teinte inattendue : ${surBuisson.teinte?.toString(16)}`)
    console.log(surBuisson.derriere === true
      ? `   ✓ les copies sont DERRIÈRE le sprite — donc un contour, pas une silhouette pleine`
      : `   ✗ profondeur : les copies ne sont pas derrière (${surBuisson.derriere})`)

    // ── ② IL SE VOIT : du blanc apparaît autour de la silhouette, et lui seul ───────
    await figer() // l'image ne bougera plus pendant la seconde que prennent les captures
    const c = await cadre()
    const avecBlanc = c ? await blancsAutour(c) : null
    await page.screenshot({ path: `${OUT}/contour-buisson.png` })
    await degeler()
    await viser(buisson.tx + 4, buisson.ty + 4) // le curseur s'en va : le contour doit s'éteindre
    const eteint = await etat()
    await figer()
    const sansBlanc = c ? await blancsAutour(c) : null
    await degeler()
    console.log(eteint.cible === null && eteint.copies === 0
      ? `   ✓ curseur ailleurs → contour éteint (0 copie)`
      : `   ✗ le contour survit au départ du curseur : ${JSON.stringify(eteint)}`)
    console.log(avecBlanc !== null && sansBlanc !== null && avecBlanc > 40 && avecBlanc > sansBlanc * 5 + 20
      ? `   ✓ OPTIQUE : ${avecBlanc} px blancs autour du buisson survolé, ${sansBlanc} sans survol`
      : `   ✗ OPTIQUE : ${avecBlanc} px blancs survolé vs ${sansBlanc} sans — le trait ne se voit pas`)

    // ── ③ UN ARBRE NE S'ENTOURE PAS : son geste est le CLIC, pas `F` ────────────────
    const arbre = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const p = s.predicted
      const a = s.view.nodes
        .filter((n) => n.type === 'tree' || n.type === 'old_tree')
        .map((n) => ({ n, d: (n.tx + 0.5 - p.x) ** 2 + (n.ty + 0.5 - p.y) ** 2 }))
        .sort((x, y) => x.d - y.d)[0]
      if (!a) return null
      s.sendAction({ type: 'debug_teleport', x: a.n.tx + 0.5, y: a.n.ty + 1.4 })
      return { tx: a.n.tx, ty: a.n.ty }
    })
    if (arbre) {
      await page.waitForTimeout(600)
      await viser(arbre.tx, arbre.ty)
      const surArbre = await etat()
      console.log(surArbre.cible === null && surArbre.copies === 0
        ? `   ✓ arbre survolé : aucun contour (il se coupe au clic, la touche ne le prend pas)`
        : `   ✗ un arbre s'entoure alors que la touche ne fait rien dessus : ${JSON.stringify(surArbre)}`)
    }

    // ── ④ UNE PILE AU SOL S'ENTOURE (spec chasse C18 : `F` la ramasse) ──────────────
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: 'arrow' }))
    await page.waitForTimeout(220)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'drop_held' }))
    await page.waitForTimeout(500)
    const pile = await page.evaluate(() => {
      const p = window.__BRAISES__.scene.view.groundItems?.[0]
      return p ? { id: p.id, tx: Math.floor(p.x), ty: Math.floor(p.y) } : null
    })
    if (pile) {
      // ON S'ÉCARTE D'ABORD : la pile tombe SOUS nos pieds, et l'avatar (24 px de haut, trié
      // devant) la recouvre — contour compris. C'est le tri qui veut ça, pas un défaut ; mais
      // une mesure optique prise de là ne prouverait rien. À 1,1 tuile on la voit et on
      // l'atteint encore (portée de bras : 1,5).
      await page.evaluate((p) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: p.tx - 0.6, y: p.ty + 0.55 }), pile)
      await page.waitForTimeout(500)
      await viser(pile.tx, pile.ty)
      const surPile = await etat()
      await figer()
      const cPile = await cadre({ kind: 'pile', id: pile.id })
      const blancPile = cPile ? await blancsAutour(cPile) : null
      await page.screenshot({ path: `${OUT}/contour-pile.png` })
      await degeler()
      console.log(surPile.cible?.kind === 'pile' && surPile.copies === 8
        ? `   ✓ pile au sol survolée : cible « pile ${surPile.cible.id} », entourée`
        : `   ✗ la pile ne s'entoure pas : ${JSON.stringify(surPile)}`)
      console.log(blancPile !== null && blancPile > 20
        ? `   ✓ OPTIQUE : le trait de la pile se voit (${blancPile} px blancs)`
        : `   ✗ OPTIQUE : la pile est cernée dans l'état mais pas à l'écran (${blancPile} px)`)
    } else {
      console.log('   ✗ rien n’est tombé au sol — la pile n’a pas pu être survolée')
    }

    // ── ⑤ UN FEU S'ENTOURE (spec feu-station S17 : `F` ouvre son modal) ─────────────
    const feu = await page.evaluate(() => {
      const p = window.__BRAISES__.scene.predicted
      // À CÔTÉ DE SOI, PAS SOUS SES PIEDS : un feu occupe sa tuile pleine et emmurerait
      // l'avatar centré dessus (leçon `place_component`).
      return { tx: Math.floor(p.x) + 1, ty: Math.floor(p.y) }
    })
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_grant', item: 'campfire' }))
    await page.waitForTimeout(300)
    await page.evaluate((f) => window.__BRAISES__.scene.sendAction({ type: 'place_campfire', tx: f.tx, ty: f.ty }), feu)
    await page.waitForTimeout(700)
    const feuPose = await page.evaluate((f) => {
      const s = window.__BRAISES__.scene.view.structures.find((st) => st.type === 'fire' && st.tx === f.tx && st.ty === f.ty)
      return s ? s.id : null
    }, feu)
    if (feuPose !== null) {
      await viser(feu.tx, feu.ty)
      const surFeu = await etat()
      // AUTOUR D'UNE FLAMME, on compte le TRÈS CLAIR (≥200) sans exiger la neutralité — la
      // lueur réchauffe le trait —, et c'est le TÉMOIN qui tranche : même cadre, curseur
      // ailleurs. Le cadre se lit sur la STRUCTURE elle-même, pas sur le contour, sans quoi
      // le témoin (contour éteint) n'aurait rien à cadrer.
      const CIBLE_FEU = { kind: 'fire', id: feuPose }
      await figer()
      const cFeu = await cadre(CIBLE_FEU)
      const blancFeu = cFeu ? await blancsAutour(cFeu, 200, 70) : null
      await page.screenshot({ path: `${OUT}/contour-feu.png` })
      await degeler()
      await viser(feu.tx + 3, feu.ty + 3)
      await figer()
      const cFeu2 = await cadre(CIBLE_FEU)
      const sansFeu = cFeu2 ? await blancsAutour(cFeu2, 200, 70) : null
      await degeler()
      console.log(surFeu.cible?.kind === 'fire' && surFeu.cible.id === feuPose && surFeu.copies === 8
        ? `   ✓ feu survolé : cible « fire ${feuPose} », entourée`
        : `   ✗ le feu ne s'entoure pas : ${JSON.stringify(surFeu)}`)
      console.log(blancFeu !== null && sansFeu !== null && blancFeu > 40 && blancFeu > sansFeu * 3 + 20
        ? `   ✓ OPTIQUE : ${blancFeu} px très clairs autour du feu survolé, ${sansFeu} sans survol`
        : `   ✗ OPTIQUE : ${blancFeu} px survolé vs ${sansFeu} sans — le trait du feu ne se voit pas`)

      // ── ⑥ SOUS UN OVERLAY, RIEN : la touche est mangée, le contour doit l'être aussi ──
      //
      // ON RALLUME D'ABORD (le témoin du feu vient d'emmener le curseur ailleurs) : sans ce
      // retour sur la cible, « éteint sous le sac » serait vrai de toute façon, et le test ne
      // vérifierait plus que lui-même.
      await viser(feu.tx, feu.ty)
      const avantSac = await etat()
      await page.keyboard.press('Tab')
      await page.waitForTimeout(320)
      const sousSac = await etat()
      console.log(avantSac.cible !== null && sousSac.cible === null && sousSac.copies === 0
        ? `   ✓ sac ouvert → contour éteint (allumé juste avant : la touche y est mangée)`
        : `   ✗ le sac n'éteint pas le contour : avant ${JSON.stringify(avantSac.cible)} → sous le sac ${JSON.stringify(sousSac)}`)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(320)

      // ── ⑦ HORS DE PORTÉE, LA CIBLE TIENT ET LE TRAIT SE GRISE ─────────────────────
      await page.evaluate((f) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: f.tx + 0.5, y: f.ty + 6 }), feu)
      await page.waitForTimeout(600)
      await viser(feu.tx, feu.ty)
      const loin = await etat()
      console.log(loin.cible !== null && loin.cible.inRange === false && loin.teinte !== 0xffffff
        ? `   ✓ hors de portée : la cible tient, le trait se grise (${loin.teinte?.toString(16)})`
        : `   ✗ hors de portée : ${JSON.stringify(loin)}`)
    }

    // ── ⑧ LA NUIT, LE TRAIT RESTE BLANC (il est peint en FILL, hors éclairage) ──────
    await page.evaluate((b) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: b.tx - 0.6, y: b.ty + 0.55 }), buisson)
    await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_set_hour', hour: 0 }))
    await page.waitForTimeout(900)
    await viser(buisson.tx, buisson.ty)
    const nuit = await etat()
    await figer()
    const cn = await cadre()
    const blancNuit = cn ? await blancsAutour(cn) : null
    await page.screenshot({ path: `${OUT}/contour-nuit.png` })
    await degeler()
    console.log(nuit.teinte === 0xffffff && blancNuit !== null && blancNuit > 40
      ? `   ✓ la nuit, le trait reste blanc et se voit (${blancNuit} px)`
      : `   ✗ la nuit, le trait s'éteint ou se teinte : ${JSON.stringify(nuit)} / ${blancNuit} px`)

    return { surBuisson, avecBlanc, sansBlanc, blancNuit }
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
        // LE HOUPPIER A QUITTÉ LA BANDE CANOPÉE — la vraie promesse, mesurée AVANT/APRÈS.
        //
        // La garde exigeait `hd < 900000 && hd < joueur.d`. Le premier terme est le bon et il
        // PASSAIT (2040, très loin des 900 000) ; c'est le second qui rougissait — et il était
        // faux par construction : le scénario téléporte lui-même le bûcheron AU NORD du pied
        // (`ty + 0.5` contre `ty + 1`), et l'arbre tombe vers l'EST. Un houppier couché plus au
        // sud que le joueur DOIT se dessiner devant lui : c'est le tri par Y qui fonctionne,
        // pas un défaut. La sonde accusait le rendu d'obéir. (Audit UX 2026-08-20, I-6.)
        //
        // On mesure donc ce que la fonctionnalité promet vraiment : DEBOUT il est dans la bande
        // canopée (il coiffe le monde), COUCHÉ il n'y est plus (il se trie comme un objet au
        // sol). Deux affirmations, et la première prouve que la seconde a un sens.
        // LE RELEVÉ COMMENCE DÉJÀ PENDANT LA CHUTE — corrigé après une mesure qui a réfuté
        // l'hypothèse. On avait d'abord écrit « debout, il est dans la bande canopée » comme
        // prémisse : faux, et `chute-arbre.ts` le dit en toutes lettres — le houppier « rejoint
        // la bande de tri Y DÈS LA PREMIÈRE IMAGE de la chute ». Or `t=0` du relevé EST cette
        // première image (l'angle y vaut 0, mais la chute est déjà armée). La propriété se
        // vérifie donc sur l'état couché seul.
        const CANOPEE = 900000
        console.log(r3 && r3.hd > 0 && r3.hd < CANOPEE
          ? `   ✓ arbre : le houppier couché se trie AVEC le monde, hors canopée (${r3.hd.toFixed(0)} < ${CANOPEE})`
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

    // ⚠ PAS UN BUISSON À BAIES. La sonde visait `berry_bush` et rapportait « le buisson est
    // resté sur place (pas de dérive) » depuis toujours — or `economy.ts` EXEMPTE explicitement
    // les baies de la relocalisation : `def.skill !== 'mining' && node.type !== 'berry_bush'
    // && !dansEmprise(...)`. Elle testait la règle sur le SEUL nœud que la spec en dispense.
    // (Audit UX 2026-08-20, I-5.)
    //
    // On prend donc de la FIBRE — cueillette nue elle aussi, `renewable`, et bien soumise à la
    // dérive — ET on prouve la prémisse : hors de toute emprise de village (`dansEmprise` est
    // une distance de Tchebychev au Feu ; 40 tuiles passent largement tout rayon d'emprise).
    // Sans cette garde, un plant né au bord d'un village rendrait « pas de dérive » pour une
    // raison parfaitement légitime, et la sonde mentirait dans l'autre sens.
    const start = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const feux = (s.view.villages ?? []).map((v) => ({ x: v.fireTx, y: v.fireTy }))
      const loinDeToutFeu = (n) => feux.every((f) => Math.max(Math.abs(f.x - n.tx), Math.abs(f.y - n.ty)) > 40)
      const b = s.view.nodes.find((n) => n.type === 'fiber_plant' && n.stock > 0 && loinDeToutFeu(n))
      if (!b) return null
      s.sendAction({ type: 'debug_teleport', x: b.tx - 0.5, y: b.ty + 0.5 })
      return { id: b.id, tx: b.tx, ty: b.ty, stock: b.stock, villages: feux.length }
    })
    if (!start) { console.log('   ✗ aucun plant de fibre hors emprise dans cette carte — la dérive est intestable ici'); return {} }
    console.log(`   plant de fibre ${start.id} en (${start.tx},${start.ty}), hors des ${start.villages} emprise(s) — la dérive DOIT s'appliquer`)
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

  /**
   * L'ÉCONOMIE DU MONDE RÉDUIT SE REGARDE (t0-exploration §2sexies) : on se pose sur chaque
   * butte d'affleurement, sur un poste de carrière et sur un vieux fût, et on photographie.
   * Tout se DÉRIVE au runtime : les buttes sont les amas de pierrier de la carte (le terrain
   * `scree` ne vient que de la passe des affleurements dans le monde réduit), leur identité se
   * lit sur les nœuds qu'elles portent, carrière et fût viennent de `view.nodes`. Exige `--dev` (TP).
   */
  async affleurements(page) {
    const cibles = await page.evaluate(() => {
      const scene = window.__BRAISES__.scene
      const map = scene.registry.get('mapData')
      const { width, height, terrain } = map
      const SCREE = 9 // l'id de `scree` (balance.ts) — le pierrier, la signature des buttes

      // Les BUTTES : centroïdes des amas de pierrier (fusion à < 80 tuiles — deux buttes
      // sont écartées d'au moins 150 par construction, aucun risque de fusion).
      const amas = []
      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          if (terrain[ty * width + tx] !== SCREE) continue
          let a = amas.find((c) => {
            const cx = c.sx / c.n
            const cy = c.sy / c.n
            return (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy) < 80 * 80
          })
          if (!a) { a = { sx: 0, sy: 0, n: 0 }; amas.push(a) }
          a.sx += tx; a.sy += ty; a.n += 1
        }
      }
      const nodes = scene.view?.nodes ?? []
      const buttes = amas.map((a) => {
        const cx = a.sx / a.n
        const cy = a.sy / a.n
        const minerai = nodes.find((n) => (n.type === 'iron_vein' || n.type === 'coal_seam')
          && (n.tx - cx) * (n.tx - cx) + (n.ty - cy) * (n.ty - cy) < 40 * 40)
        return { x: cx, y: cy, tuiles: a.n, nom: minerai?.type === 'coal_seam' ? 'charbon' : minerai ? 'fer' : 'muette' }
      })
      const quarry = nodes.find((n) => n.type === 'quarry')
      const fut = nodes.find((n) => n.type === 'old_tree' && n.stock > 3) // > teaser
      return {
        buttes,
        carriere: quarry ? { x: quarry.tx, y: quarry.ty } : null,
        fut: fut ? { x: fut.tx, y: fut.ty } : null,
      }
    })

    console.log(`   ${cibles.buttes.length} buttes trouvées (${cibles.buttes.map((b) => `${b.nom}:${b.tuiles} tuiles`).join(', ')})`)
    if (cibles.buttes.length === 0) console.error('!! AUCUNE BUTTE — le monde joué porte-t-il bien les affleurements ?')

    // Pas de `press('P')` ici : en `--dev`, P ouvre le PANNEAU debug — il salirait chaque photo.
    const photos = [
      ...cibles.buttes.map((b, i) => ({ nom: `butte-${b.nom}-${i + 1}`, x: b.x, y: b.y })),
      ...(cibles.carriere ? [{ nom: 'carriere', ...cibles.carriere }] : []),
      ...(cibles.fut ? [{ nom: 'vieux-fut', ...cibles.fut }] : []),
    ]
    for (const p of photos) {
      await page.evaluate(({ x, y }) => {
        window.__BRAISES__.scene.registry.set('debugTeleport', { x, y, at: performance.now() })
      }, { x: p.x, y: p.y })
      await page.waitForTimeout(1600)
      await canopeePleine(page) // la cime ne s'efface pas sur une photo (le fût est sous bois)
      await page.evaluate(() => { window.__BRAISES__.scene.cameras.main.setZoom(2.2) })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/affleurement-${p.nom}.png` })
      console.log(`   ✓ (${Math.round(p.x)}, ${Math.round(p.y)}) → affleurement-${p.nom}.png`)
    }
    return cibles
  },

  /** Les lieux (spec docs/specs/lieux.md) : la carte est-elle bien vierge au départ ? */
  async lieux(page) {
    const s = await page.evaluate(PROBE)

    console.log(`\n── A1 : la carte est-elle vierge au tick 0 ? ──`)
    // Un repère À PORTÉE DE VUE du spawn se découvre à la naissance — c'est la mécanique
    // (poi-discovery, SIGHT_TILES = 30), pas une fuite de brouillard. Constaté sur le monde
    // réduit (2026-08-18) : le spawn de la seed 2026 naît à 24 tuiles d'un erratique. La
    // sonde n'exige donc plus « zéro connu » mais « rien de connu HORS DE VUE ».
    const SIGHT = 30
    const enVue = new Set(s.pois
      .filter((p) => (p.x - s.player.x) ** 2 + (p.y - s.player.y) ** 2 <= SIGHT * SIGHT)
      .map((p) => p.poiId))
    const fuites = s.knownPois.filter((id) => !enVue.has(id))
    console.log(`   ${s.pois.length} lieux existent, ${s.knownPois.length} connus du joueur, ${enVue.size} en vue du spawn`)
    console.log(fuites.length === 0
      ? '   ✓ rien de divulgué hors de vue — la vallée garde son secret'
      : `   ✗ ${fuites.length} lieux divulgués HORS DE VUE !`)

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

    // Le menu du marteau est-il OUVERT ? IL EST EN DOM (`build-menu.ts`, racine `.bmn`), et
    // cette sonde cherchait un objet Phaser `Text` nommé « MARTEAU » — il n'en existe aucun
    // dans tout le dépôt. Elle rendait donc `false` à tous les coups : R20 rapportait « menu
    // ABSENT ✗ » depuis toujours, et R21 « éteint ✓ » pour la même mauvaise raison — un ✗ et
    // un ✓ creux sur la même sonde aveugle. (Audit UX 2026-08-20, I-2.)
    const marteauVisible = () =>
      page.evaluate(() => {
        const el = document.querySelector('.bmn')
        return Boolean(el && getComputedStyle(el).display !== 'none')
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
    // ⚠ LE FEU QU'ON CHERCHE EST CELUI QU'ON VIENT D'ALLUMER — pas le premier de la carte.
    // La sonde faisait `structures.find(x => x.type === 'fire')`, qui rend le feu d'un VILLAGE
    // PNJ né à la génération. Elle sortait donc de la boucle au premier tour même quand la
    // fondation avait échoué, et tout le reste du scénario bâtissait autour d'un foyer à des
    // centaines de tuiles : d'où les cinq « hors du carré du Feu ». Cinq faux ✗ pour une
    // seule ligne. On relève donc les feux AVANT, et on ne retient que le NOUVEAU.
    // (Audit UX 2026-08-20, I-2.)
    const feuxAvant = await page.evaluate(() =>
      window.__BRAISES__.scene.view.structures.filter((x) => x.type === 'fire').map((x) => x.id),
    )
    let feu = null
    let reason = ''
    for (const [ox, oy] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24], [24, 24], [-24, -24], [48, 0], [0, 48]]) {
      await doAction({ type: 'debug_teleport', x: Math.round(spawn.x) + ox + 0.5, y: Math.round(spawn.y) + oy + 0.5 }, 200)
      await doAction({ type: 'light_fire' }, 450)
      feu = await page.evaluate((connus) => {
        const f = window.__BRAISES__.scene.view.structures.find((x) => x.type === 'fire' && !connus.includes(x.id))
        return f ? { id: f.id, tx: f.tx, ty: f.ty } : null
      }, feuxAvant)
      reason = await page.evaluate(() => window.__BRAISES__.scene.registry.get('error')?.reason ?? '')
      if (feu) break
    }
    // ET LA SONDE PROUVE SA PRÉMISSE : un Feu à plus de 60 tuiles du spawn n'est pas le nôtre
    // (la boucle ne s'éloigne que de 48 au plus). Sans cette garde, la prochaine régression du
    // même genre repasserait au vert en silence.
    if (feu) {
      const d = Math.max(Math.abs(feu.tx - spawn.x), Math.abs(feu.ty - spawn.y))
      if (d > 60) {
        console.error(`!! LE FEU TROUVÉ N'EST PAS CELUI DU JOUEUR : (${feu.tx},${feu.ty}) à ${Math.round(d)} tuiles du spawn`)
        feu = null
      }
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
    const slotDe = (item) => page.evaluate((it) => (window.__BRAISES__.scene.registry.get('inv') ?? [])
      .findIndex((s) => s?.item === it), item)
    // La clairière se cherche plus large ici qu'ailleurs (deux diagonales de plus) : la Forge
    // doit finir ENCLOSE, donc il faut de la place autour, pas seulement sous le Feu.
    const assise = await fonderPres(page, doAction, slotDe, spawn,
      [[0, 0], [-24, 0], [24, 0], [0, -24], [0, 24], [-24, 24], [24, -24], [-48, 0], [48, 0]])
    const feu = assise && { tx: assise.bx + 1, ty: assise.by }
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
   * les images du menu sont à jour. Ce qu'il fabrique n'entre PAS dans le dépôt tout seul :
   * on regarde, on choisit, et on copie dans `packages/client/src/assets/vitrine/`.
   *
   *   pnpm smoke --scenario vitrine --dev        (--dev obligatoire : TP + heure)
   *
   * Sept règles de prise de vue, toutes apprises en ratant une série :
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
   *    ET LA CARTE CANONIQUE EST PLUS PAUVRE QU'ON NE CROIT (relevé du 2026-08-20) : elle ne
   *    porte QUE DEUX ZONES, `pres_bas` et `cendriere`. Ni alpages, ni glacier, ni karst —
   *    donc aucun Tarn, aucune Cascade, aucun névé. La montagne du catalogue de POI existe
   *    dans le code et pas dans CE monde : une prise qui la vise revient bredouille.
   * ⑥ CE QUI BOUGE SE FIGE — LES DEUX HORLOGES (2026-08-20, avec les prises de scène). Le
   *    scénario `reveil` l'a payé : « le Cendreux avait MARCHÉ de quatre tuiles » entre deux
   *    images, parce qu'endormir la boucle de RENDU laisse tourner la SIM. Un déclenchement
   *    peut durer quatre-vingt-dix secondes sous SwiftShader — à 20 Hz, c'est mille huit
   *    cents ticks. `pause` PUIS `loop.sleep()`, et on ne relâche le coup qu'après l'image.
   * ⑦ UN FRONT MÉTÉO DÉRIVE — ON L'ARME, PUIS ON DÉCLENCHE, SANS RIEN ATTENDRE ENTRE LES
   *    DEUX. Une bande traverse la carte en `TRAVERSEE_TICKS` (24 min de jeu) : MESURÉ,
   *    1,15 tuile/s. Le premier jet armait l'orage sur le joueur (intensité relevée : 1,00),
   *    puis attendait un éclair jusqu'à quatre-vingt-dix secondes — cent tuiles de dérive,
   *    soit une bande de 70 tuiles ENTIÈREMENT sortie du cadre. La photo est revenue avec
   *    une prairie ensoleillée et un rideau de pluie collé au bord gauche.
   *    Et l'éclair lui-même a été ABANDONNÉ, chiffres à l'appui : trois frappes la minute,
   *    tirées n'importe où dans une bande de 70 tuiles sur toute la hauteur de la carte —
   *    une chance sur vingt qu'une frappe tombe dans le cadre. Ce qui fait l'image d'orage
   *    ici, c'est le rideau et le ciel, pas le trait.
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
      // ET LES BANDEAUX, QUI NE SONT PLUS DANS PHASER (audit UX 2026-08-20, P0.2). L'alerte
      // et le conseil étaient deux objets Text de la scène UI — la boucle ci-dessus les
      // attrapait. Passés en DOM pour se peindre AU-DESSUS des panneaux, ils sortent de sa
      // portée : sans cette ligne, « Un voisin, tout près… » reviendrait gâcher une prise,
      // exactement comme la fois qui a fait écrire le commentaire du dessus.
      const bnd = document.querySelector('.bnd')
      if (bnd) bnd.style.display = 'none'
      // ET L'ANNEAU DE SURVOL (demande d'Alexis, 2026-08-20 : « je ne veux pas voir de HUD dans
      // les images »). Ce n'en est pas au sens DOM — c'est un contour peint SUR LE CANVAS
      // autour de ce que vise le curseur (`interactTarget`, huit copies dans `contourPool`).
      // Mais c'est bien une AFFORDANCE, au même titre que le nom d'un lieu ou la cime qui
      // s'efface : quelque chose que le joueur veut et que la photo ne veut pas. Or l'atelier
      // pose la souris au centre du cadre, donc sur l'avatar — chaque prise repartait avec une
      // pastille dorée à ses pieds. Même remède que pour les Text : on éteint ET on confisque
      // `setVisible`, sinon la frame suivante les rallume.
      const v = sc.view
      if (v) {
        v.interactTarget = null
        for (const c of v.contourPool ?? []) {
          c.visible = false
          c.setVisible = () => c
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
     *
     * ═══ LA DEUXIÈME MOITIÉ DE LA PLANCHE : DES ÉVÉNEMENTS, PAS DES PAYSAGES (2026-08-20) ═══
     *
     * Demande d'Alexis : « plus de variétés et d'epicness — combattre une horde, chasser dans
     * la neige, un lever de soleil au bord d'un lac, un village de PNJ au crépuscule ». Les
     * cinq premières prises restent des PAYSAGES (un lieu, une heure) ; les nouvelles sont des
     * SCÈNES — il y faut un état du monde que le premier jour n'a pas, et un sujet qui bouge.
     * Trois leviers de plus, tous des vrais chemins de sim :
     *   · `jour` — `debug_set_season_day`. L'hiver et l'acte III ne se jouent pas en cinq
     *     minutes ; la neige au sol vient du front NEIGEUX du cycle 5 (jours 51-60, relevé par
     *     `frontDuCycle`), et la MÉGA-HORDE de seize goules est GARANTIE au premier crépuscule
     *     de l'acte III (`advanceWorldEvents` : `!state.megaHordeSpawned`). Le jour 47 tombe à
     *     1 440 ticks de ce crépuscule-là, le plus court chemin vers la seule horde du jeu
     *     qu'on n'ait pas à tirer aux dés.
     *   · `arme` + `charger` — `debug_grant` puis le clic maintenu. Ce qui se peint au sol est
     *     le télégraphe du VRAI coup (`pendingStrike`) : la photo montre le combat que le jeu
     *     joue, pas une pose.
     *   · `figer` — un sujet qui MARCHE ne se photographie pas à l'aveugle (leçon du scénario
     *     `reveil` : « le Cendreux avait MARCHÉ de quatre tuiles »). On endort les DEUX
     *     horloges, la boucle de rendu ET la sim, juste avant de déclencher.
     *
     * ET L'ORDRE DE LA PLANCHE EST CONTRAINT : le calendrier est un état COLLANT. On tire donc
     * tout le premier jour d'abord, puis l'acte III, puis l'hiver — jamais en arrière.
     */
    const PRISES = [
      // ═══ LE PREMIER JOUR — les paysages ═══
      { nom: 'feu-village-hameau', heure: 5, village: 1, stage: 2, couvert: false, tuiles: 24, quoi: 'le feu du hameau de bois, avant le jour' },
      { nom: 'sylve-matin', heure: 8, futaie: true, quoi: 'la futaie au soleil levant' },
      { nom: 'chene', heure: 7, ou: ['chene', 'arbre', 'bois_noir'], quoi: 'le gros bois au petit matin' },
      { nom: 'cercle', heure: 19.5, ou: ['cercle_pierres', 'pierre_levee', 'erratique'], quoi: 'les menhirs au couchant' },
      { nom: 'gue-or', heure: 18.5, ou: ['~le Gué'], quoi: "la rivière à l'heure dorée" },
      { nom: 'tour-couchant', heure: 19, ou: ['tour_guet', 'ferme_ruinee', 'charrette'], quoi: 'la ruine au couchant' },
      // LE LAC. Il n'a pas de `kind` — ce n'est pas un lieu, c'est du TERRAIN (comme le Gué et
      // les bosquets de crête) : on le vise au balayage, et on se plante sur la RIVE, sinon la
      // caméra centre un joueur au milieu de l'eau et le lac sort du cadre par les quatre côtés.
      { nom: 'lac-aube', heure: 8.2, berge: true, tuiles: 22, quoi: 'le lever du soleil au bord du lac' },
      // LE BOURG. `feu-hameau` montre le palier 2 (le bois) AVANT LE JOUR, feu nu et village
      // endormi ; celle-ci montre le palier 3 (la pierre) au CRÉPUSCULE, quand les PNJ sont
      // encore dehors. Deux villages sur cette carte : on tamponne le SECOND, pour ne pas
      // rebâtir par-dessus la prise d'ouverture.
      { nom: 'village-bourg', heure: 20.4, village: 2, stage: 3, couvert: false, tuiles: 26, quoi: 'le bourg PNJ au crépuscule' },
      // L'ORAGE — la seule variété de PLEIN JOUR qui existe. Entre 10 et 15 h l'alpha
      // d'`ambientTint` est NUL : aucune heure n'achète d'ambiance là, seul un ciel le peut.
      // On fige sur l'EMBRASEMENT (le hook de `frapper`), pas sur la pluie.
      { nom: 'orage-vallee', heure: 15.5, orage: true, tuiles: 26, quoi: "l'orage sur la vallée" },
      // LA CENDRIÈRE A ÉTÉ RETIRÉE DE LA PLANCHE (2026-08-20), et les deux essais disent
      // pourquoi. À cadrage normal, un Repaire de Cendrés ne donne qu'une plaine brune de
      // souches avec une goule et un joueur hauts de vingt pixels : le pays du titre est,
      // photographié seul, le plus vide de la carte. Et resserrer pour lire le combat
      // (13 tuiles) fait apparaître un ANNEAU BLANC en travers de l'image — un rayon peint en
      // pixels qui ne suit pas le zoom. D'où la borne de `tuiles` ci-dessous : on élargit, on
      // ne resserre jamais. Ce que la prise cherchait — le combat, la nuit, les goules — c'est
      // `horde-village` qui le tient, et il le tient mieux : elles y sont seize.
      // ═══ L'ACTE III — la méga-horde ═══
      // LA HACHE EST TENUE, PAS CHARGÉE. Son coup lourd est un TOURBILLON — un cône de 360°
      // (`arcCos −1`) — et son télégraphe se peint donc en ANNEAU BLANC autour du joueur, en
      // travers de toute l'image. C'est le jeu qui dit vrai (spec combat : « le joueur VOIT ce
      // qu'il arme »), mais sur une photo d'accueil cela se lit comme un défaut d'interface.
      // ET L'HEURE EST 20,2 — PAS MINUIT, ET C'EST TOUT LE CORRECTIF DE LA TROISIÈME PRISE.
      // À 23 h, seize goules grises sur un sol brun, à cinquante tuiles du seul feu du secteur,
      // ne rendent RIEN : la photo est revenue avec un paquet de seize goules dûment cadré et
      // parfaitement invisible. Or `debug_set_hour` ne décale que la PHASE d'affichage — il ne
      // touche pas au tick, donc pas au calendrier de `advanceWorldEvents`. On peut donc
      // éclairer la scène au crépuscule pendant que la sim, elle, est en pleine nuit d'acte III
      // avec sa horde debout. Le monde n'est pas truqué : c'est le même instant, regardé sous
      // la lumière qui le montre.
      { nom: 'horde-village', jour: 47, heure: 20.2, horde: true, arme: 'iron_axe', figer: true, couvert: false, tuiles: 22,
        quoi: 'la horde de la rampe (~12 goules au jour 47) sur le feu le plus proche' },
      // ═══ L'HIVER — jours 51-60, le front neigeux du cycle 5 ═══
      // ARC EN MAIN, PAS BANDÉ. Tenir l'arc, c'est le personnage ; le BANDER peint sa ligne
      // de tir au sol — un télégraphe, donc du HUD, donc hors cadre. Même règle que l'anneau
      // de survol ci-dessus et que le tourbillon de la hache, qui barrait l'image d'un
      // anneau blanc plein cadre.
      { nom: 'chasse-neige', jour: 57, heure: 8.5, chasse: true, arme: 'bow', figer: true, neige: true,
        quoi: 'la chasse dans la neige, arc bandé' },
      { nom: 'lac-gele', jour: 57, heure: 6.4, berge: true, tuiles: 26, quoi: 'le lac pris par la glace, au lever du jour' },
      // PAS DE FUTAIE D'HIVER — ESSAYÉE, RETIRÉE. Au jour 57, la même fenêtre qui rendait une
      // futaie à trois essences (146 relevés boisés) revient en champ de neige quasi VIDE : la
      // défeuillaison d'acte III (`jourDeDefeuillaison`) plus la couverture de neige ne
      // laissent que des taches sombres hautes de trois pixels. Le bois d'hiver de ce jeu
      // n'est pas un bois blanc, c'est une plaine — et `lac-gele` montre l'hiver bien mieux,
      // parce qu'il a une RIVE, des arbres nus au premier plan et du givre qui accroche.
    ]

    /* ── LES LEVIERS DES SCÈNES (2026-08-20) ─────────────────────────────────────────────
     *
     * Ils ne servent qu'aux prises qui montrent un ÉVÉNEMENT : le paysage n'a besoin
     * d'aucun d'eux, et c'est pour ça qu'ils vivent ici et pas dans la queue commune. */

    const agirV = async (action, ms = 350) => {
      await page.evaluate((a) => window.__BRAISES__.scene.sendAction(a), action)
      await page.waitForTimeout(ms)
    }
    /** LES DEUX HORLOGES. Endormir la boucle de rendu ne suffit pas : la sim continue, et le
     *  sujet MARCHE pendant les quatre-vingt-dix secondes que peut durer un déclenchement
     *  sous SwiftShader (leçon mesurée du scénario `reveil` : quatre tuiles de dérive). */
    const figerTout = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.send({ type: 'pause' })
      s.game.loop.sleep()
    })
    const degeler = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.game.loop.wake()
      s.send({ type: 'resume' })
    })
    /**
     * UN GARDE-FOU DUR SUR L'ATTENTE — `page.evaluate` N'A PAS DE TIMEOUT.
     *
     * Le défaut de Playwright est d'attendre INDÉFINIMENT que la boucle JS de la page rende la
     * main. Si la page casse (un rechargement HMR, une erreur 500 sur un import), l'appel ne
     * revient jamais — et un plafond du genre « abandonner au bout de 600 s » ne sert à rien,
     * puisqu'il n'est relu qu'ENTRE deux tours de boucle. MESURÉ : une prise de horde est
     * restée 27 minutes en l'air, compteur figé à 64 s, machine à 0,41 de charge. Elle n'était
     * pas lente, elle était MORTE, et rien ne le disait.
     */
    const borne = async (promesse, ms, quoi) => {
      let minuteur
      const echu = new Promise((_, ko) => { minuteur = setTimeout(() => ko(new Error(`${quoi} : rien en ${ms} ms`)), ms) })
      try {
        return await Promise.race([promesse, echu])
      } finally {
        clearTimeout(minuteur)
      }
    }
    const bestioles = (types) => borne(page.evaluate((ts) => {
      const s = window.__BRAISES__.scene
      const out = []
      for (const m of s.view?.monsters ?? []) {
        if (!ts.includes(m.type)) continue
        const rec = s.view.others.get(m.entityId)
        const der = rec?.buffer?.at(-1)
        if (der) out.push({ type: m.type, x: der.x, y: der.y })
      }
      return out
    }, types), 20000, 'lecture des bêtes')

    /**
     * ARMER LE FRONT SUR LE JOUEUR — et pas « quelque part sur la carte ».
     *
     * `debug_meteo` place la bande par sa PHASE de traversée, pas par une coordonnée : à
     * phase 0,5 elle est au milieu de la CARTE, ce qui, mesuré, la posait à 250 tuiles du
     * sujet — un ciel d'orage que personne ne voit. On la résout donc analytiquement (la
     * géométrie de `neigeAuSol` : la bande couvre `coord` quand `coord/(span+largeur) ≤
     * phase < (coord+largeur)/(span+largeur)`), largeur LUE sur la bande réelle plutôt que
     * recopiée de `METEO.LARGEUR` — une seconde copie d'une géométrie finit toujours par
     * mentir. Puis on VÉRIFIE sur l'intensité au joueur : c'est elle qui dit si le rideau
     * tombe ici, et sans elle on règlerait un ciel à l'aveugle.
     */
    const poserFront = async (type, edge, x, y) => {
      await agirV({ type: 'debug_meteo', meteo: type, edge, phase: 0.5 }, 600)
      // ON ATTEND QUE LA COUCHE AIT VU LE FRONT, on ne lit pas au premier coup d'œil : `bande`
      // est calculée dans l'`update` de la couche, et une frame dure parfois 900 ms ici. Lue
      // trop tôt elle est nulle, et le premier jet en a conclu « aucun front » alors que la
      // foudre tombait déjà — un ciel réglé à l'aveugle, et une prairie sans orage.
      let a = null
      for (let essai = 0; essai < 10 && !a?.bande; essai++) {
        await page.waitForTimeout(500)
        a = await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          return { bande: s.meteoLayer?.bande ?? null, w: s.map.width, h: s.map.height }
        })
      }
      if (!a?.bande) { console.error(`      !! le front ${type} n'a posé aucune bande en 5 s`); return false }
      const largeur = a.bande.hi - a.bande.lo
      const span = a.bande.axis === 'x' ? a.w : a.h
      const brut = a.bande.axis === 'x' ? x : y
      const coord = edge === 0 || edge === 2 ? brut : span - brut
      const phase = Math.max(0.02, Math.min(0.98, (coord + largeur / 2) / (span + largeur)))
      // ET ON ATTEND QUE LE SECOND ARMEMENT AIT PRIS, pour la même raison qu'au premier :
      // MESURÉ, à une seconde d'attente la couche rendait encore la bande de la phase 0,5 —
      // [758..813] au lieu de [1095..1150] — et la prise repartait avec un ciel bleu et un
      // rideau collé au bord du cadre. On lit l'INTENSITÉ AU JOUEUR, qui est la seule chose
      // qu'on vienne chercher : tant qu'elle est nulle, le front n'est pas là.
      await agirV({ type: 'debug_meteo', meteo: type, edge, phase }, 400)
      let b = null
      for (let essai = 0; essai < 16 && !((b?.intensite ?? 0) > 0.05); essai++) {
        await page.waitForTimeout(500)
        b = await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          return { bande: s.meteoLayer?.bande ?? null, intensite: s.meteoLayer?.intensiteAuJoueur ?? 0 }
        })
      }
      console.log(`      front ${type} : bande ${a.bande.axis} [${b.bande?.lo?.toFixed(0)}..${b.bande?.hi?.toFixed(0)}]`
        + ` autour de ${Math.round(brut)} — intensité au joueur ${(b.intensite ?? 0).toFixed(2)}`)
      if ((b.intensite ?? 0) <= 0.05) console.error(`      !! le rideau ne tombe PAS sur le joueur (intensité nulle)`)
      return (b.intensite ?? 0) > 0.05
    }

    let prises = 0
    let jourPose = 1 // le calendrier est COLLANT : on ne le repose que quand il change
    let frontPose = false
    const planche = prisesVoulues ? PRISES.filter((p) => prisesVoulues.has(p.nom)) : PRISES
    if (prisesVoulues) console.log(`\n── filtre : ${planche.length}/${PRISES.length} prises (${[...prisesVoulues].join(', ')}) ──`)
    // INVULNÉRABLE POUR TOUTE LA PLANCHE. Ce n'est pas une commodité : en acte III, un pré de
    // nuit vaut 10 de température sous un seuil d'hypothermie de 20 — le froid TUE, et le
    // scénario `enneige` est déjà revenu une fois avec un écran noir et 0/60 PV. On
    // photographiait un cadavre en croyant photographier un paysage.
    await agirV({ type: 'debug_god', on: true }, 250)
    for (const p of planche) {
      await degeler() // la prise d'avant a pu endormir les deux horloges
      // ⑥ LE CALENDRIER EST UN ÉTAT COLLANT, et il ne va QUE VERS L'AVANT. On attend la
      //   PREUVE (le jour publié), jamais un délai : le saut passe par le worker.
      if ((p.jour ?? 1) !== jourPose) {
        await agirV({ type: 'debug_set_season_day', day: p.jour }, 500)
        await page.waitForFunction((j) => (window.__BRAISES__.scene.lastTime?.seasonDay ?? 0) >= j, p.jour,
          { timeout: 30000, polling: 200 }).catch(() => {})
        const lu = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.seasonDay ?? -1)
        if (lu < p.jour) { console.error(`   ✗ ${p.nom.padEnd(18)} le jour de saison est resté à ${lu} (visé ${p.jour}) — prise SAUTÉE`); continue }
        jourPose = p.jour
        console.log(`\n── jour de saison ${lu} ──`)
      }
      // ET LE CIEL AUSSI : un front laissé par la prise d'avant repeindrait celle-ci.
      if (frontPose && !p.orage && !p.neige) { await agirV({ type: 'debug_meteo', meteo: null }, 400); frontPose = false }

      let cible = null
      if (p.village) {
        // LE FEU DU VILLAGE, pas un feu fondé : chaque village PNJ naît autour du sien
        // (fireTx/fireTy), et il brûle la nuit. L'avatar se pose 4,5 tuiles sous le feu :
        // à cette hauteur les deux logis latéraux du hameau entrent en entier dans le cadre
        // et la porte charretière du sud tient au tiers bas.
        // `village` est un RANG (1 = le premier), pas un booléen : la carte en porte deux, et
        // tamponner deux fois le même écraserait la prise d'ouverture par un bourg de pierre.
        cible = await page.evaluate(({ rang, stage }) => {
          const sc = window.__BRAISES__.scene
          const v = (sc.view?.villages ?? []).filter((q) => q.chiefId === 0)[rang - 1]
          if (!v) return null
          if (stage > 1) sc.sendAction({ type: 'debug_village_stage', villageId: v.id, stage })
          return { x: v.fireTx + 0.5, y: v.fireTy + 4.5, kind: 'village', name: `le village PNJ ${v.id} (palier ${stage})` }
        }, { rang: p.village, stage: p.stage })
        if (!cible) { console.error(`   ✗ ${p.nom.padEnd(18)} pas de ${p.village}ᵉ village PNJ dans le snapshot — prise SAUTÉE`); continue }
        await page.waitForTimeout(1800) // le tampon s'applique au tick suivant, pièce par pièce
      } else if (p.berge) {
        // ═══ LA RIVE D'UN LAC — ON NOTE LE PIED, PAS LA NAPPE ═══
        //
        // La caméra CENTRE le joueur : viser le milieu de l'eau le planterait au milieu de
        // l'eau, où le lac sort du cadre par les quatre côtés. Ce qu'on cherche n'est donc pas
        // « le plus gros lac », c'est LA TUILE OÙ SE PLANTER : de la terre ferme qui a le
        // demi-cadre HAUT plein d'eau (19 × 11 tuiles au-dessus du pied). La nappe remplit
        // alors la moitié haute de l'image et la rive tient le tiers bas.
        //
        // PREMIÈRE VERSION, ET POURQUOI ELLE A ÉCHOUÉ : elle élisait d'abord la meilleure
        // FENÊTRE, puis cherchait un pied dedans. La fenêtre gagnante était la plus mouillée
        // de la carte — donc entièrement eau et falaise, sans une seule tuile où se tenir : le
        // balayage rendait « 0 tuile d'eau devant » et la prise sautait, alors que la carte
        // porte une nappe de 80 % d'eau à deux cents tuiles de là. On note donc les PIEDS,
        // directement, et l'image intégrale rend les 209 tuiles du demi-cadre en quatre
        // lectures (sans elle, 337 000 pieds × 209 = 70 M d'accès).
        cible = await page.evaluate(() => {
          const m = window.__BRAISES__.scene.map
          const { width: W, height: H, terrain: T } = m
          const cols = Math.ceil(W / m.zonePas)
          const idRacine = (m.zoneDefs ?? []).findIndex((d) => d.slug === 'pres_bas')
          const dansRacine = (x, y) => m.zoneGrid[Math.floor(y / m.zonePas) * cols + Math.floor(x / m.zonePas)] === idRacine
          const SOLIDE = new Set([5, 7, 23]) // roche, mur, falaise : on ne s'y pose pas
          // L'IMAGE INTÉGRALE de l'eau profonde : S[y][x] = nombre de tuiles d'eau dans le
          // rectangle (0,0)-(x-1,y-1). La somme d'un rectangle tient alors en quatre lectures.
          const S = new Int32Array((W + 1) * (H + 1))
          for (let y = 0; y < H; y++) {
            let ligne = 0
            for (let x = 0; x < W; x++) {
              if (T[y * W + x] === 6) ligne++
              S[(y + 1) * (W + 1) + (x + 1)] = S[y * (W + 1) + (x + 1)] + ligne
            }
          }
          const somme = (x0, y0, x1, y1) => { // bornes incluses, déjà bornées à la carte
            const a = S[y1 * (W + 1) + x1 + 1], b = S[y0 * (W + 1) + x1 + 1]
            const c = S[y1 * (W + 1) + x0], d = S[y0 * (W + 1) + x0]
            return a - b - c + d
          }
          let pose = null
          for (let y = 12; y < H - 2; y++) {
            for (let x = 10; x < W - 10; x++) {
              const t = T[y * W + x]
              if (t === 6 || t === 4 || SOLIDE.has(t)) continue
              if (!dansRacine(x, y)) continue // la Cendrière a de l'eau, mais aucun lever de soleil
              const devant = somme(x - 9, y - 11, x + 9, y - 1)
              if (!pose || devant > pose.devant) pose = { x: x + 0.5, y: y + 0.5, devant }
            }
          }
          if (!pose || pose.devant < 60) return { echec: `la meilleure rive n'a que ${pose ? pose.devant : 0} tuiles d'eau dans le demi-cadre haut` }
          // ON RECULE DE SIX TUILES, et c'est le correctif de la prise ratée. Planté SUR le
          // bord, l'eau profonde remplit plus de la moitié du cadre — or elle se rend en un
          // aplat bleu-gris sans rive opposée : une nappe vide qui mange l'image. Reculée, la
          // même eau devient un TIERS haut, et ce sont la grève, les fleurs et les arbres qui
          // portent la vue. (On ne recule que si l'on retombe sur de la terre ferme.)
          let recul = 0
          for (let k = 1; k <= 6; k++) {
            const t = T[Math.min(H - 1, Math.floor(pose.y) + k) * W + Math.floor(pose.x)]
            if (t === 6 || t === 4 || SOLIDE.has(t)) break
            recul = k
          }
          return { x: pose.x, y: pose.y + recul, kind: '(terrain)', name: `une rive de lac (${pose.devant}/209 tuiles d'eau devant, reculé de ${recul})` }
        })
        if (!cible || cible.echec) { console.error(`   ✗ ${p.nom.padEnd(18)} pas de rive de lac : ${cible?.echec ?? 'balayage muet'} — prise SAUTÉE`); continue }
      } else if (p.futaie) {
        // ═══ UNE FUTAIE SE VISE PAR SA DENSITÉ, PAS PAR LE CENTRE D'UN LIEU ═══
        //
        // `viser(['bois_noir'])` rendait le CENTRE de la zone — et le Bois Noir fait quarante
        // tuiles de côté : son centre est tombé dans une clairière, et la prise a rapporté un
        // pré bordé d'arbres là où l'accueil promet une futaie fermée. (Même piège que
        // « old_growth est moins dense que forest » : on mesure l'espacement, on ne suppose
        // pas la silhouette.) On note donc ce que le CADRE contiendrait, en couvert d'arbres,
        // et on garde la fenêtre la plus fermée de la Racine.
        cible = await page.evaluate(() => {
          const m = window.__BRAISES__.scene.map
          const { width: W, height: H, terrain: T } = m
          const cols = Math.ceil(W / m.zonePas)
          const idRacine = (m.zoneDefs ?? []).findIndex((d) => d.slug === 'pres_bas')
          const dansRacine = (x, y) => m.zoneGrid[Math.floor(y / m.zonePas) * cols + Math.floor(x / m.zonePas)] === idRacine
          const ARBRE = new Set([3, 13, 14, 22, 24]) // forêt, pin, mélèze, futaie ancienne, saule
          const DX = 18, DY = 11
          let best = null
          for (let cy = DY; cy < H - DY; cy += 6) {
            for (let cx = DX; cx < W - DX; cx += 6) {
              if (!dansRacine(cx, cy)) continue
              let arbre = 0, varietes = new Set()
              for (let y = cy - DY; y < cy + DY; y += 2) for (let x = cx - DX; x < cx + DX; x += 2) {
                const t = T[y * W + x]
                if (!ARBRE.has(t)) continue
                arbre++
                varietes.add(t)
              }
              // LA VARIÉTÉ COMPTE : une futaie d'une seule essence est un mur vert. Deux
              // essences dans le cadre, et la silhouette se lit.
              // PLAFONNÉE : la fenêtre la plus dense de la carte est un tapis vert où plus rien
              // ne se lit — et c'est la plus chère à rendre (le déclenchement a expiré dessus,
              // à 90 s). On veut un couvert FERMÉ, pas maximal.
              const score = Math.min(arbre, 150) + varietes.size * 12
              if (!best || score > best.score) best = { x: cx + 0.5, y: cy + 0.5, score, arbre, essences: varietes.size }
            }
          }
          return best && { ...best, kind: '(terrain)', name: `une futaie fermée (${best.arbre}/198 relevés boisés, ${best.essences} essences)` }
        })
        if (!cible) { console.error(`   ✗ ${p.nom.padEnd(18)} aucune futaie trouvée — prise SAUTÉE`); continue }
      } else if (p.orage) {
        // PAS UN LIEU : UN CIEL. On cherche donc ce que l'orage sert le mieux — de l'ouvert
        // (le rideau et l'embrasement ont besoin de place) avec une lisière au fond pour la
        // profondeur. Et LOIN de la Cendrière, dont le sol brûlé mange toute la lumière.
        cible = await page.evaluate(() => {
          const m = window.__BRAISES__.scene.map
          const { width: W, height: H, terrain: T } = m
          const cols = Math.ceil(W / m.zonePas)
          const idRacine = (m.zoneDefs ?? []).findIndex((d) => d.slug === 'pres_bas')
          const dansRacine = (x, y) => m.zoneGrid[Math.floor(y / m.zonePas) * cols + Math.floor(x / m.zonePas)] === idRacine
          const OUVERT = new Set([1, 2, 11, 12, 17, 20, 25, 26])
          const ARBRE = new Set([3, 13, 14, 22, 24])
          const DX = 18, DY = 11
          let best = null
          for (let cy = DY; cy < H - DY; cy += 8) {
            for (let cx = DX; cx < W - DX; cx += 8) {
              if (!dansRacine(cx, cy)) continue
              let ouvert = 0, arbre = 0, eau = 0
              for (let y = cy - DY; y < cy + DY; y += 2) for (let x = cx - DX; x < cx + DX; x += 2) {
                const t = T[y * W + x]
                if (t === 17 || t === 20) ouvert += 1.4 // la prairie FLEURIE porte mieux que l'herbe rase
                else if (OUVERT.has(t)) ouvert++
                else if (ARBRE.has(t)) arbre++
                else if (t === 4 || t === 6) eau++
              }
              // UNE LISIÈRE AU FOND, SINON RIEN. Sans arbres, la meilleure prairie de la carte
              // est une pelouse — et l'heure dorée ne fait pas d'une plaine rase autre chose
              // qu'une plaine rase dorée (la leçon en tête de planche). Le premier jet a rendu
              // exactement ça : « 277 d'ouvert, 0 d'arbres ».
              if (arbre < 10) continue
              const score = ouvert + Math.min(arbre, 30) * 2 + Math.min(eau, 14) * 1.5
              if (!best || score > best.score) best = { x: cx + 0.5, y: cy + 0.5, score, ouvert: Math.round(ouvert), arbre, eau }
            }
          }
          return best && { ...best, kind: '(terrain)', name: `une prairie ouverte (${best.ouvert} d'ouvert, ${best.arbre} d'arbres)` }
        })
        if (!cible) { console.error(`   ✗ ${p.nom.padEnd(18)} aucune prairie trouvée — prise SAUTÉE`); continue }
      } else if (p.chasse) {
        // LE GIBIER NE SE POSE PAS, IL NAÎT — et pas n'importe où : `placeHuntingGrounds`
        // exige de l'eau à proximité (« l'eau commande la faune »). Le seul gibier GARANTI de
        // la carte est celui des TANIÈRES : `spawnPoiMonsters` y pose une bête au tick 0, et
        // le relevé le confirme (les Repaires portent bien leur goule, dès le premier jour).
        // On visite donc les tanières une à une et on garde la première qui montre une bête
        // ET de la neige — parce qu'une chasse dans la neige sans neige n'est qu'une chasse.
        const dens = await page.evaluate(() => (window.__BRAISES__.scene.map.zones ?? [])
          .filter((z) => z.kind === 'taniere')
          .map((z) => ({ x: Math.round(z.x + z.w / 2), y: Math.round(z.y + z.h / 2), name: z.name })))
        for (const d of dens.slice(0, 6)) {
          await agirV({ type: 'debug_teleport', x: d.x + 0.5, y: d.y + 0.5 }, 1600)
          await canopeePleine(page)
          await page.waitForFunction(() => (window.__BRAISES__.scene.gelLayer?.sonde?.recuissons ?? 0) > 0, null,
            { timeout: 15000, polling: 150 }).catch(() => {})
          await page.waitForTimeout(1400)
          const vu = await bestioles(['boar', 'deer', 'rabbit', 'wolf'])
          const neige = await page.evaluate(() => window.__BRAISES__.scene.gelLayer?.sonde?.couvertureMoyenne ?? 0)
          console.log(`      ${d.name} (${d.x},${d.y}) : ${vu.length} bête(s) ${JSON.stringify(vu.map((b) => b.type))}, neige ${neige.toFixed(2)}`)
          if (vu.length > 0 && neige > 0.25) {
            // ON SE POSE À CINQ TUILES SOUS LA BÊTE : elle tient le tiers haut du cadre,
            // le chasseur le centre, et l'arc pointe vers elle.
            const b = vu[0]
            cible = { x: b.x, y: b.y + 5, kind: 'chasse', name: `${d.name} — ${vu.length} bête(s), neige ${neige.toFixed(2)}`, viser: { x: b.x, y: b.y } }
            break
          }
        }
        if (!cible) { console.error(`   ✗ ${p.nom.padEnd(18)} aucune tanière avec bête ET neige — prise SAUTÉE`); continue }
      } else if (p.horde) {
        // ═══ LA HORDE DE LA RAMPE — ON VA À ELLE, ELLE NE VIENT PLUS À NOUS ═══
        //
        // (2026-08-21 : la méga-horde scriptée n'existe plus — décision ⑲. La horde suit une
        // PENTE de saison, décidée à l'AUBE par présage ; au jour 47 la rampe donne ~12
        // goules. `debug_horde`, envoyé plus bas, la lève sans loterie.)
        //
        // CE QUE CETTE PRISE COÛTAIT, ET POURQUOI (le journal de l'ancienne version). La
        // horde naît entre `HORDE_MIN_DIST` (60 tuiles) et une nuit de marche de sa cible,
        // donc TOUJOURS hors du rayon d'intérêt du client (64 tuiles) : invisible, et
        // introuvable, puisque `horde_spawned` ne portait que sa CIBLE. On faisait donc
        // l'inverse — on l'ATTENDAIT au feu du village, en navette entre les deux villages,
        // à l'aveugle. MESURÉ sur trois runs : 301 s, 349 s, 481 s de temps réel pour UNE
        // prise, avec un plafond à 600 s. Et on ne pouvait pas accélérer : `debug_speed` ×12
        // a tué le navigateur (« No room in socket buffer ») et, mesuré, le monde avançait à
        // ×0,2 — la sim vit dans un Worker qui inonde de snapshots un fil principal rendant
        // déjà quelques images par seconde sous SwiftShader.
        //
        // L'ÉVÉNEMENT PORTE DÉSORMAIS SON BERCEAU (`tx`, `ty` — cf. `events.ts`, garde dans
        // `worldevents.test.ts`). On lit le journal des faits du client (`eventJournal`, la
        // surface de lecture du smoke, alimentée par `CHRONICLE_EVENT_TYPES`) et on se
        // téléporte dessus dès qu'il tombe. L'attente n'est plus celle de la MARCHE, c'est
        // celle du CRÉPUSCULE : ~72 s de sim, connues d'avance.
        const feux = await page.evaluate(() => (window.__BRAISES__.scene.view?.villages ?? [])
          .filter((v) => v.chiefId === 0).map((v) => ({ id: v.id, x: v.fireTx + 0.5, y: v.fireTy + 0.5 })))
        if (feux.length === 0) { console.error(`   ✗ ${p.nom.padEnd(18)} aucun village PNJ — prise SAUTÉE`); continue }
        // On endort la BOUCLE DE RENDU pendant l'attente : `view.apply` est appelée par le
        // gestionnaire de MESSAGE (pas par l'`update`), donc le monde continue d'être suivi
        // alors que plus rien ne se peint — et le fil principal rend la main au Worker.
        await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
        // LE TICK DE DÉPART, ET C'EST UNE GARDE, PAS UNE TRACE. Le journal est un HISTORIQUE :
        // en le balayant à l'envers on retiendrait une horde d'une nuit PRÉCÉDENTE, FIGÉE à
        // l'aube depuis longtemps (`advanceWorldEvents` 2026-08-21 : l'aube ne dissipe plus,
        // elle fige en reliques), et on irait photographier des carcasses. On n'accepte donc
        // qu'un fait postérieur à cet instant. On le lit sur l'horloge de la SIM.
        const tickDepart = await page.evaluate(() => window.__BRAISES__.scene.lastTime?.tick ?? 0)
        // LA HORDE NE SE TIRE PLUS TOUTE SEULE (2026-08-21, décisions ⑭⑱⑲) : la méga-horde
        // scriptée est morte, et la horde ordinaire se DÉCIDE À L'AUBE (présage) sur une rampe
        // de chance — aucune nuit n'est garantie. `debug_horde` la lève MAINTENANT, par la
        // vraie chaîne (planification par densité, cible = feu le plus proche, champ de flux),
        // sans consommer un pas de PRNG : c'est exactement ce que la touche existe pour faire.
        await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_horde' }))
        const debut = Date.now()
        let fait = null
        // LE SPAWN EST SYNCHRONE (debug_horde) : 60 s couvrent large l'aller-retour Worker +
        // journal. Au-delà, ce n'est plus de la lenteur — le fait ne viendra pas, on le DIT.
        while (!fait && Date.now() - debut < 60000) {
          try {
            fait = await borne(page.evaluate((t0) => {
              const j = window.__BRAISES__.scene.eventJournal ?? []
              for (let i = j.length - 1; i >= 0; i--) if (j[i].type === 'horde_spawned' && j[i].tick >= t0) return j[i]
              return null
            }, tickDepart), 15000, 'lecture du journal des faits')
          } catch (e) {
            // LA PAGE NE RÉPOND PLUS : on le DIT, et on n'attend pas la fin des temps. Le plus
            // souvent c'est un rechargement HMR — `--dev` sert le dépôt vivant, et toute
            // écriture dans `packages/client` pendant un run détruit le contexte de la page.
            console.error(`      !! la page ne répond plus (${e.message}) — attente interrompue`)
            break
          }
          if (!fait) await page.waitForTimeout(3000)
        }
        await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake()).catch(() => {})
        if (!fait) {
          console.error(`   ✗ ${p.nom.padEnd(18)} aucune horde levée en ${Math.round((Date.now() - debut) / 1000)} s — prise SAUTÉE`)
          continue
        }
        console.log(`      ${String(Math.round((Date.now() - debut) / 1000)).padStart(3)} s — horde ${fait.hordeId} levée au tick ${fait.tick} :`
          + ` ${fait.size} goules en (${fait.tx}, ${fait.ty}), cap sur ${fait.villageId !== undefined ? `le village ${fait.villageId}` : 'un feu isolé'}`)
        // ON SE POSE AU BERCEAU, ET C'EST LA CONTREPARTIE D'Y ALLER : un Cendreux qui voit le
        // joueur à moins de `aggroRange` (5 tuiles) LÂCHE la descente de gradient (`cendreux.ts` :
        // `if (!target && hordeStep(…))`) et vient sur lui. La horde qui marchait sur le village
        // marche alors sur VOUS — MESURÉ au déclenchement : 7 goules sur 16 ciblaient le joueur.
        // C'est ce que le jeu ferait pour n'importe quel joueur planté là, et c'est très
        // exactement la prise demandée (« combattre une horde »). L'invulnérabilité est déjà
        // armée pour toute la planche (voir `debug_god` en tête de boucle) : sans elle, seize
        // goules mettraient un voile de mort sur la photo.
        await agirV({ type: 'debug_teleport', x: fait.tx + 0.5, y: fait.ty + 0.5 }, 2500)
        // LE RALLIEMENT : on les laisse se refermer quelques secondes. Elles naissent en bloc
        // de 3 × 6 autour du berceau ; à 1,3 tuile/s, six secondes suffisent à les tasser
        // autour de l'avatar — c'est le paquet SERRÉ qui fait l'image, pas seize points épars.
        await page.waitForTimeout(6000)
        const g = await bestioles(['cendreux'])
        if (g.length < 5) {
          console.error(`   ✗ ${p.nom.padEnd(18)} seulement ${g.length} goule(s) au berceau (${fait.tx}, ${fait.ty}) — prise SAUTÉE`)
          continue
        }
        const cx = g.reduce((a, b) => a + b.x, 0) / g.length
        const cy = g.reduce((a, b) => a + b.y, 0) / g.length
        // ON SE PLANTE DEVANT ELLES, DU CÔTÉ DU FEU QU'ELLES VISENT — le premier jet faisait
        // l'inverse (sept tuiles depuis le feu, vers elles) et la photo est revenue avec un
        // joueur seul au milieu d'un pré : les goules, quarante tuiles plus loin, tenaient six
        // pixels au bord du cadre. C'est LEUR barycentre qui fait l'image ; le village n'est
        // qu'une direction — il est trop loin pour tenir dans les 22 tuiles du cadrage.
        // LE FEU VISÉ EST DANS LE FAIT (décision ⑬ : `fireTx`/`fireTy` — ce peut être un
        // simple feu de camp sans village) : on ne devine plus, on lit.
        const feu = { id: fait.villageId ?? 'feu isolé', x: fait.fireTx + 0.5, y: fait.fireTy + 0.5 }
        const dx = feu.x - cx, dy = feu.y - cy
        const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy))
        const garde = Math.min(d, 7)
        cible = {
          x: cx + (dx / d) * garde, y: cy + (dy / d) * garde,
          kind: 'horde', name: `${g.length} goules à ${Math.round(d)} t du feu du village ${feu.id}`, viser: { x: cx, y: cy },
        }
      } else {
        cible = await viser(p.ou)
        if (!cible) {
          console.error(`   ✗ ${p.nom.padEnd(18)} AUCUN de [${p.ou.join(', ')}] sur cette carte — prise SAUTÉE`)
          continue
        }
      }

      await page.evaluate(({ px, py }) => window.__BRAISES__.scene.sendAction({ type: 'debug_teleport', x: px, y: py }), { px: cible.x, py: cible.y })
      await page.waitForTimeout(1400)
      await heure(p.heure)
      await museler() // APRÈS le TP : fouler le lieu vient de le rendre connu, donc nommé
      // LE CADRAGE SE DIT EN TUILES, jamais en zoom (règle R10 : `zoomForFraming`). Le jeu
      // en montre 20 de haut ; un plan large en montre plus, et le zoom s'en DÉRIVE — écrire
      // « 1,5 » à la place aurait fait dépendre la planche de la hauteur de la fenêtre.
      //
      // ON ÉLARGIT, ON NE RESSERRE JAMAIS. À 13 tuiles, la prise `cendriere-nuit` est revenue
      // barrée d'un ANNEAU BLANC en plein cadre : quelque chose se peint sur un rayon en
      // PIXELS et ne suit pas le zoom. Le journal portait déjà l'avertissement (scénario
      // `village` : « un setZoom plus serré fait planter le renderer ») — voici sa version
      // visible. Au-delà de 20, en revanche, rien ne casse : le brouillard de guerre ne se
      // rend pas dans le monde (il ne sert que l'écran de carte), donc élargir ne découvre
      // aucun voile.
      await page.evaluate((tuiles) => {
        const cam = window.__BRAISES__.scene.cameras.main
        cam.setZoom(cam.height / (tuiles * 16))
      }, p.tuiles ?? 20)
      // LA CANOPÉE RESTE PLEINE — sauf pour ce qui vit SOUS elle. `crownAlpha` est une aide de
      // jeu (voir où l'on marche) et un défaut sur une photo de paysage ; mais sur un VILLAGE
      // bâti dans les bois, la garder pleine photographie des cimes et cache le sujet
      // (constaté sur la première `village-bourg` : un bourg entier invisible sous les arbres).
      // `couvert: false` rend alors la main au jeu — et c'est très exactement ce qu'un joueur
      // voit quand il y entre.
      // Posé DANS LES DEUX SENS : l'interrupteur est collant, et une prise à découvert qui
      // se contenterait de « ne pas l'armer » hériterait de la canopée pleine de la veille.
      if (p.couvert !== false) await canopeePleine(page)
      else await page.evaluate(() => window.__BRAISES__.scene.view?.setCanopeePleine?.(false))
      // La souris au centre : le décalage caméra « Foxhole » (framing R11) suit le curseur, et
      // une souris oubliée dans un coin décadre toute la série. Une prise qui VISE (la horde,
      // la chasse) la déplace exprès juste après — c'est elle qui oriente le coup ET le cadre.
      await page.mouse.move(640, 360)
      await page.waitForTimeout(900) // les fondus de lumière et la brume s'installent

      /* ── CE QUI SE PASSE JUSTE AVANT LE DÉCLENCHEMENT ─────────────────────────────────
       * Le ciel, l'arme, le coup armé, et l'endormissement des deux horloges. Tout ce qui
       * suit est spécifique aux SCÈNES — un paysage traverse ce bloc sans rien exécuter. */
      if (p.orage || p.neige) frontPose = await poserFront(p.orage ? 'orage' : 'neige', 1, cible.x, cible.y) || frontPose
      let viseurPx = null
      if (cible.viser) {
        // OÙ EST LA CIBLE À L'ÉCRAN — dérivé de la caméra, jamais un décalage en pixels écrit
        // à la main : le zoom décide, pas nous (patron du scénario `foudre`).
        viseurPx = await page.evaluate(({ x, y }) => {
          const cam = window.__BRAISES__.scene.cameras.main
          const T = 16
          return { x: (x * T - cam.worldView.x) * cam.zoom, y: (y * T - cam.worldView.y) * cam.zoom }
        }, cible.viser)
      }
      if (p.arme) {
        // LA FLÈCHE AVANT L'ARC : `debug_grant` met l'objet EN MAIN, donc l'ordre décide de ce
        // qu'on tient. Un arc sans flèche ne se bande pas.
        if (p.arme === 'bow') for (let i = 0; i < 6; i++) await agirV({ type: 'debug_grant', item: 'arrow' }, 120)
        await agirV({ type: 'debug_grant', item: p.arme }, 700)
      }
      if (viseurPx) {
        const vx = Math.max(40, Math.min(1240, Math.round(viseurPx.x)))
        const vy = Math.max(40, Math.min(680, Math.round(viseurPx.y)))
        await page.mouse.move(vx, vy)
        await page.waitForTimeout(600)
      }
      if (p.charger) {
        // LE COUP MAINTENU, pas un clic : ce qui se peint au sol est le télégraphe du VRAI
        // coup (`pendingStrike`, spec combat) — la zone qui partirait maintenant. À maturité,
        // la hache montre son tour complet et l'arc sa ligne de tir.
        await page.mouse.down()
        await page.waitForTimeout(1600)
      }
      // ═══ LE RECADRAGE DE DERNIÈRE SECONDE — POUR CE QUI MARCHE ═══
      //
      // Entre la lecture des positions (dans la branche de visée) et le déclenchement, il
      // s'écoule le TP, l'heure, le muselage, la canopée, l'arme : une dizaine de secondes.
      // À 1,3 tuile/s, seize goules ont parcouru treize tuiles — et la photo est revenue
      // VIDE, un joueur seul dans un pré. On les relit donc juste avant de figer.
      //
      // Et on vise le PAQUET LE PLUS DENSE, pas le barycentre : seize goules étalées sur la
      // longueur d'un champ ont leur barycentre dans un trou. On prend la goule qui a le plus
      // de voisines à huit tuiles, et c'est le centre de CE groupe qu'on cadre.
      if (p.horde) {
        const g = await bestioles(['cendreux'])
        if (g.length === 0) console.error(`      !! les goules ont quitté le rayon avant le déclenchement`)
        else {
          let chef = g[0], mieux = -1
          for (const a of g) {
            const n = g.filter((b) => (b.x - a.x) ** 2 + (b.y - a.y) ** 2 <= 64).length
            if (n > mieux) { mieux = n; chef = a }
          }
          const paquet = g.filter((b) => (b.x - chef.x) ** 2 + (b.y - chef.y) ** 2 <= 64)
          const mx = paquet.reduce((a, b) => a + b.x, 0) / paquet.length
          const my = paquet.reduce((a, b) => a + b.y, 0) / paquet.length
          console.log(`      recadrage : ${g.length} goules en vue, paquet de ${paquet.length} autour de (${Math.round(mx)}, ${Math.round(my)})`)
          // SIX TUILES SOUS LE PAQUET : elles occupent le haut du cadre, on leur fait face.
          await agirV({ type: 'debug_teleport', x: mx, y: my + 6 }, 900)
          const px = await page.evaluate(({ x, y }) => {
            const cam = window.__BRAISES__.scene.cameras.main
            return { x: (x * 16 - cam.worldView.x) * cam.zoom, y: (y * 16 - cam.worldView.y) * cam.zoom }
          }, { x: mx, y: my })
          await page.mouse.move(Math.max(40, Math.min(1240, Math.round(px.x))), Math.max(40, Math.min(680, Math.round(px.y))))
          await page.waitForTimeout(500)
        }
      }
      if (p.horde) {
        // CE QUE LA PHOTO EMPORTE DE COMBAT, DIT AVANT LE DÉCLENCHEMENT — parce que ça se
        // VOIT et qu'on ne peut pas l'éteindre. Se poser à six tuiles du paquet met le
        // photographe dans l'`aggroRange` (5) des plus proches : elles lâchent la descente de
        // gradient et se retournent sur lui (`cendreux.ts` : `if (!target && hordeStep(…))`).
        // Elles ne s'entre-tuent JAMAIS — `nearestPrey` écarte tout id de monstre (`monsters.ts`)
        // — mais leurs coups PEIGNENT : le télégraphe s'affiche pour TOUTE entité qui arme
        // (`WorldScene`, boucle des `windups` : crème `BLADE` si c'est moi, rouge `THREAT`
        // sinon), et un coup qui PART claque sa zone en BLANC PUR (`slash`, 0xffffff) pour
        // tout le monde. Ne pas charger n'éteint que le MIEN — d'où les cônes blancs revenus
        // sur la première photo du berceau, qui n'étaient ni un bug ni un duel de goules.
        const combat = await page.evaluate(() => {
          const s = window.__BRAISES__.scene
          const goules = (s.view?.monsters ?? []).filter((m) => m.type === 'cendreux')
          return {
            armes: (s.windups ?? []).length,
            surMoi: goules.filter((m) => m.targetId === s.playerId).length,
            total: goules.length,
          }
        })
        console.log(`      combat dans le cadre : ${combat.armes} coup(s) armé(s),`
          + ` ${combat.surMoi}/${combat.total} goules retournées sur le photographe`)
      }
      if (p.figer) await figerTout()
      const vue = await page.evaluate(() => ({ h: window.__BRAISES__.scene.lastTime?.hourOfCycle ?? -1 }))
      // TIMEOUT LARGE (2026-07-29). Le défaut par défaut est de 30 s, et il est TOMBÉ deux fois
      // sur cette machine — sur deux scènes différentes, donc ce n'est pas la scène : c'est
      // SwiftShader (aucun GPU ici) qui met parfois plus de trente secondes à rendre une frame
      // dense pour la relecture. Une série de neuf prises qui meurt à la deuxième coûte huit
      // minutes ; quatre-vingt-dix secondes d'attente ne coûtent rien quand tout va bien.
      //
      // ET ON ATTRAPE LA CHUTE. Le flake SwiftShader est une propriété de cette machine, pas
      // du code : quand il tombe, il ne doit emporter QUE sa prise. Une planche de quinze vues
      // où la deuxième mort tue les treize suivantes, c'est vingt minutes rejouées pour rien —
      // et c'est exactement ce qui est arrivé, deux fois, avant cette garde.
      try {
        await page.screenshot({ path: `${OUT}/vitrine-${p.nom}.jpg`, type: 'jpeg', quality: 82, timeout: 180000 })
      } catch (e) {
        console.error(`   ✗ ${p.nom.padEnd(18)} le déclenchement a expiré (${e.name}) — prise PERDUE, la planche continue`)
        if (p.charger) { await degeler().catch(() => {}); await page.mouse.up().catch(() => {}) }
        continue
      }
      console.log(`   ✓ ${p.nom.padEnd(18)} ${String(cible.kind).padEnd(12)} (${Math.round(cible.x)}, ${Math.round(cible.y)})`
        + ` « ${cible.name} » — visée ${p.heure} h, PRISE À ${vue.h.toFixed(1)} h — ${p.quoi}`)
      prises++
      // ON RELÂCHE LE COUP APRÈS L'IMAGE, jamais avant : lâcher le clic FAIT PARTIR le coup,
      // et le coup parti efface son propre télégraphe.
      if (p.charger) { await degeler(); await page.mouse.up(); await page.waitForTimeout(400) }
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

  /**
   * LE RAMPANT (spec `cendreux.md` R26-R27) — ce que le sol rend n'a pas toujours ses jambes.
   *
   * On plante des réveils (`debug_reveil`, la vraie chaîne) jusqu'à ce que le sol en rende un
   * COUCHÉ : la part est lue dans le champ des morts (~14 % en pré), élue par hash du réveil —
   * on ne fabrique rien, on appuie et on LIT. On reste au jour 1 : le plafond global y vaut
   * 12 corps — douze réveils à ~14 % laissent ~16 % de malchance, et le scénario le DIT quand
   * elle tombe plutôt que d'accuser l'élection. (Sauter au jour 55 par `debug_set_season_day`
   * déplace le tick : MESURÉ, l'avatar en mode dieu y est tombé — on ne mesure pas à travers
   * un outil qu'on ne comprend pas.)
   *
   * Trois verdicts lus sur les sprites, pas sur l'état : la texture couchée (`beastTexture`),
   * la silhouette plus LARGE que HAUTE (R26ter), et le pion de regard posé et visible (R27) —
   * sur le rampant ET sur un marcheur, le même.
   *
   * Exige `--dev`.
   */
  async rampant(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 90000 })
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      s.sendAction({ type: 'debug_god', on: true })
      s.sendAction({ type: 'debug_set_hour', hour: 1 })
    })
    await page.waitForTimeout(800)

    const lire = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const corps = []
      for (const [id, o] of s.view.others) {
        if (o.textureKey !== 'spr-cendreux' && o.textureKey !== 'spr-cendreux-rampant') continue
        const g = o.sprite.getData('gaze')
        corps.push({
          id, texture: o.textureKey, x: o.sprite.x, y: o.sprite.y,
          w: +o.sprite.displayWidth.toFixed(1), h: +o.sprite.displayHeight.toFixed(1),
          gaze: g ? { visible: g.visible, x: +g.x.toFixed(1), y: +g.y.toFixed(1) } : null,
        })
      }
      return corps
    })

    let rampant = null
    let essais = 0
    for (; essais < 12 && !rampant; essais++) {
      await page.evaluate(() => window.__BRAISES__.scene.sendAction({ type: 'debug_reveil' }))
      const debut = Date.now()
      // 4 s de tertre + ~1 s d'extraction, à l'horloge du rendu logiciel.
      while (Date.now() - debut < 9000 && !rampant) {
        await page.waitForTimeout(300)
        const corps = await lire()
        rampant = corps.find((c) => c.texture === 'spr-cendreux-rampant') ?? null
        if (corps.length > essais) break // celui-ci est sorti (marcheur ou non) : au suivant
      }
    }
    const corps = await lire()
    const marcheurs = corps.filter((c) => c.texture === 'spr-cendreux')
    console.log(`   ${essais} réveils → ${marcheurs.length} marcheurs, ${rampant ? 'UN RAMPANT' : 'aucun rampant'}`)
    if (!rampant) {
      console.error(`!! aucun rampant en ${essais} réveils — à ~14 % par site, (0,86)^${essais} ≈ ${(100 * 0.86 ** essais).toFixed(1)} % de malchance : relancer, ou suspecter l’élection`)
      return { essais, rampant: null, marcheurs: marcheurs.length }
    }

    // ON CADRE PAR LA CAMÉRA ET ON FIGE LES DEUX HORLOGES (leçon du scénario `reveil`).
    await page.evaluate((id) => {
      const s = window.__BRAISES__.scene
      const o = s.view.others.get(id)
      const cam = s.cameras.main
      cam.stopFollow()
      cam.setZoom(4)
      cam.centerOn(o.sprite.x, o.sprite.y - 8)
      s.send({ type: 'pause' })
      s.game.loop.sleep()
      s.game.step(s.time.now + 16, 16)
    }, rampant.id)
    await page.screenshot({ path: `${OUT}/rampant.png` })
    const apres = (await lire()).find((c) => c.id === rampant.id) ?? rampant
    const temoin = marcheurs[0] ?? null
    const couche = apres.w > apres.h
    const regard = apres.gaze?.visible === true
    const regardTemoin = temoin ? temoin.gaze?.visible === true : null
    console.log(`   rampant : ${JSON.stringify(apres)} → ${OUT}/rampant.png`)
    if (temoin) console.log(`   témoin (marcheur) : ${JSON.stringify(temoin)}`)
    console.log(`   ${couche ? '✓' : '✗'} la silhouette est couchée (plus large que haute : ${apres.w} × ${apres.h})`)
    console.log(`   ${regard ? '✓' : '✗'} le rampant porte son regard (R27)`)
    if (temoin) console.log(`   ${regardTemoin ? '✓' : '✗'} le marcheur aussi`)
    return { essais, rampant: apres, temoin, couche, regard, regardTemoin }
  },

  /**
   * LE PAYSAGE ENNEIGÉ — la neige au sol, la glace et les arbres nus (spec `gel.md` G5-G7).
   *
   * ═══ LE PIÈGE QUI COÛTE LA SÉANCE, ET IL EST DANS `/sim` ═══
   *
   * `debug_meteo` ne dépose AUCUNE neige au sol. `neigeAuSol` ne regarde pas `state.meteo` :
   * elle rembobine `frontDuCycle`, l'ÉLECTION PURE du cycle. Un front armé à la main est
   * invisible à ce rembobinage — on peut donc rester une heure sous un blizzard de debug sans
   * qu'un seul pixel blanchisse. Il faut ATTERRIR SUR UN VRAI CYCLE NEIGEUX.
   *
   * Lesquels ? L'élection étant pure, elle se lit à l'avance sans jouer. En Veillée
   * (`VEILLEE_SEASON_CYCLES = 6`, `calendarScale` 300), le balayage donne :
   *   cycle 0 → orage (jours 1-6) · 4 → pluie (44-49) · **5 → NEIGE (jours 53-58)** · 6 → neige…
   * D'où le jour visé par défaut : **59**, le lendemain de la sortie du front. La couverture
   * y vaut encore ~0,96 (la fonte prend `FONTE_CYCLES` = 3 cycles par grand froid).
   *
   * ═══ DEUX HEURES, PARCE QUE LES DEUX SEUILS NE MORDENT PAS ENSEMBLE ═══
   *
   * Sur une tuile d'eau (biome 0), en acte III : `T = 90 − 50 = 40` de JOUR, `− 30 = 10` de
   * NUIT. Or `SEUIL_GUE` vaut 45 et `SEUIL_PROFOND` 20. Donc **à midi seul le gué est pris ;
   * il faut la nuit pour que le lac le soit** — et c'est le lac qui vaut une décision de jeu
   * (il rend praticable ce qui bloquait). On photographie donc les deux : le paysage à midi,
   * la glace profonde de nuit. Une seule prise aurait montré la moitié de la règle.
   *
   * ═══ ON CHERCHE UN POINT DE VUE QUI MONTRE ═══
   *
   * Une capture qui ne montre pas ce qu'on juge ne vaut rien. On note donc les emplacements
   * sur ce que le CADRE contiendrait (36 × 22 tuiles) : de l'eau des deux profondeurs, des
   * feuillus (qui se dénudent), des conifères (qui tiennent) et du sol ouvert (où la neige
   * se lit). Le score est rendu avec la photo — une prise pauvre doit se dire pauvre.
   *
   * Réglages : `SMOKE_JOUR` (défaut 59), `SMOKE_HEURE` (défaut 12).
   * Exige `--dev` : jour, heure et TP sont inertes en build de production.
   */
  async enneige(page) {
    if (!dev) { console.log('\n(le paysage gelé exige --dev : le jour de saison, l’heure et le TP)'); return {} }
    const JOUR = Number(process.env.SMOKE_JOUR ?? 59)
    const HEURE = Number(process.env.SMOKE_HEURE ?? 12)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1200)

    const agir = async (action, ms = 300) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const etat = () => page.evaluate(() => {
      const s = window.__BRAISES__.scene
      return {
        jour: s.lastTime?.seasonDay ?? -1,
        acte: s.lastTime?.act ?? -1,
        heure: s.lastTime?.hourOfCycle ?? -1,
        nuit: Boolean(s.lastTime?.isNight),
        tick: s.lastTime?.tick ?? -1,
        pos: s.registry.get('playerPos'),
        map: { w: s.map.width, h: s.map.height },
        gel: { ...(s.gelLayer?.sonde ?? {}) },
      }
    })

    // ⓪ INVULNÉRABLE, ET CE N'EST PAS UNE COMMODITÉ. En acte III de nuit, un pré vaut
    //    `90 − 50 − 30 = 10` de température, sous `HYPOTHERMIA` (20) : **le froid TUE**, et
    //    c'est écrit dans `balance.ts` en toutes lettres. MESURÉ : la prise de nuit est
    //    revenue une fois sur un écran NOIR, voile de mort et 0/60 PV — on photographiait un
    //    cadavre en croyant photographier un lac gelé. Le froid qu'on vient montrer est
    //    précisément celui qui empêche de le montrer.
    await agir({ type: 'debug_god', on: true }, 200)

    // ① LE JOUR DE SAISON — on ATTEND LA PREUVE (le jour publié), jamais un délai fixe : le
    //    saut passe par le worker, et l'horloge headless galope.
    await agir({ type: 'debug_set_season_day', day: JOUR }, 400)
    await page.waitForFunction((j) => (window.__BRAISES__.scene.lastTime?.seasonDay ?? 0) >= j, JOUR,
      { timeout: 30000, polling: 200 }).catch(() => {})
    await agir({ type: 'debug_set_hour', hour: HEURE }, 700)
    const e0 = await etat()
    if (e0.jour < JOUR) { console.error(`!! le jour de saison est resté à ${e0.jour} (visé ${JOUR}) — relevé sans valeur`); return {} }
    console.log(`  jour de saison ${e0.jour} (acte ${e0.acte}) à ${Math.round(e0.heure * 10) / 10} h`)

    // ② LE POINT DE VUE. Noté sur ce que le CADRE contiendrait, pas sur la tuile visée.
    const site = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const { width: W, height: H, terrain } = s.map
      const GUE = 4, LAC = 6
      const CADUCS = new Set([3, 22, 24]) // forest · old_growth · willow
      const CONIF = new Set([13, 14])     // pine · larch
      const OUVERT = new Set([1, 2, 11, 17, 12, 20, 25]) // herbe, route, lande, prés
      // Le cadre : ~36 x 22 tuiles (VISIBLE_TILES_TALL = 20, zoom 2,25, 16:9).
      const DX = 18, DY = 11
      let best = null
      for (let cy = DY; cy < H - DY; cy += 6) {
        for (let cx = DX; cx < W - DX; cx += 6) {
          let gue = 0, lac = 0, caduc = 0, conif = 0, ouvert = 0
          for (let y = cy - DY; y < cy + DY; y += 2) {
            for (let x = cx - DX; x < cx + DX; x += 2) {
              const t = terrain[y * W + x]
              if (t === GUE) gue++
              else if (t === LAC) lac++
              else if (CADUCS.has(t)) caduc++
              else if (CONIF.has(t)) conif++
              else if (OUVERT.has(t)) ouvert++
            }
          }
          // Chaque ingrédient est PLAFONNÉ : on veut un cadre COMPLET, pas un cadre qui gagne
          // en étant entièrement sous l'eau. Le gué et le lac pèsent double — ce sont eux
          // qu'on ne sait pas fabriquer, et sans eux la glace n'a rien à peindre.
          const cap = (v, m) => Math.min(v, m)
          // LES CONIFÈRES PÈSENT LOURD, et c'est délibéré : G6 promet que le pin TIENT quand le
          // feuillu se dénude, et cette promesse ne se photographie que si les DEUX sont dans le
          // même cadre. Un paysage sans conifère ne montre que la moitié de la règle.
          const score = 2 * cap(gue, 12) + 2 * cap(lac, 22) + cap(caduc, 30) + 2 * cap(conif, 24) + cap(ouvert, 40) * 0.5
          if (!best || score > best.score) best = { x: cx, y: cy, score, gue, lac, caduc, conif, ouvert }
        }
      }
      return best
    })
    if (!site) { console.error('!! aucun point de vue trouvé'); return {} }
    console.log(`  point de vue (${site.x}, ${site.y}) — score ${Math.round(site.score)} :`
      + ` gué ${site.gue} · lac ${site.lac} · feuillus ${site.caduc} · conifères ${site.conif} · sol ouvert ${site.ouvert}`)

    const prendre = async (nom, heure, ou) => {
      await agir({ type: 'debug_set_hour', hour: heure }, 500)
      await agir({ type: 'debug_teleport', x: ou.x + 0.5, y: ou.y + 0.5 }, 1200)
      await canopeePleine(page)
      // LA COUCHE RECUIT SUR SEUIL (caméra d'une tuile, ou 400 ticks) : après un TP elle
      // recuit à la première image. On attend quand même la PREUVE que sa sonde a tourné —
      // une photo prise avant la première recuisson montrerait un monde vert.
      await page.waitForFunction(() => (window.__BRAISES__.scene.gelLayer?.sonde?.recuissons ?? 0) > 0,
        null, { timeout: 20000, polling: 150 }).catch(() => {})
      await page.waitForTimeout(900)
      const e = await etat()
      await page.screenshot({ path: `${OUT}/${nom}.png`, timeout: 180000 })
      const g = e.gel
      console.log(
        `  ${nom.padEnd(24)} ${Math.round(e.heure * 10) / 10} h${e.nuit ? ' (nuit)' : '      '}`
        + ` · neige ${String(g.tuilesNeige).padStart(4)} tuiles (couverture max ${(g.couvertureMax ?? 0).toFixed(2)},`
        + ` moyenne ${(g.couvertureMoyenne ?? 0).toFixed(2)})`
        + ` · glace ${String(g.tuilesGlace).padStart(3)} dont ${g.tuilesGlaceProfonde} PROFONDE`
        + ` · gelPossible ${g.gelPossible}`
        + `\n${' '.repeat(26)}${g.tuilesBalayees} tuiles balayées en ${(g.msRecuisson ?? 0).toFixed(2)} ms (recuisson ${g.recuissons})`,
      )
      return { nom, ...e }
    }

    // ③bis LA LISIÈRE FEUILLUS / CONIFÈRES — un cadre à part, noté sur les DEUX seules.
    //     G6 promet que le pin TIENT quand le feuillu se dénude, et cette promesse ne se
    //     photographie que là où les deux se touchent. Le paysage, lui, est noté sur l'eau :
    //     les deux critères ne désignent presque jamais le même endroit, et vouloir un seul
    //     cadre qui gagne sur tout rend un cadre qui ne montre rien.
    //
    //     ON COMPTE DES ARBRES, PAS DU TERRAIN — et ça s'est payé. Noté sur le terrain, le
    //     meilleur site rendait « feuillus 48 · conifères 61 » et la photo montrait un névé
    //     de rocaille SANS UN SEUL ARBRE : un sol `forest` ne porte pas un nœud par tuile, et
    //     `old_growth` est le couvert le plus OUVERT de la carte. On interroge donc
    //     `view.nodes`, la liste réelle des arbres, et on classe chacun par le sol SOUS lui —
    //     le même critère que `feuillageDenude`, donc le même verdict.
    const lisiere = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const { width: W, terrain } = s.map
      const CADUCS = new Set([3, 22, 24])
      const CONIF = new Set([13, 14])
      const DX = 17, DY = 10
      const arbres = (s.view.nodes ?? []).filter((n) => n.type === 'tree' || n.type === 'old_tree')
      let best = null
      for (const a of arbres) {
        let caduc = 0, conif = 0, autres = 0
        for (const b of arbres) {
          if (Math.abs(b.tx - a.tx) > DX || Math.abs(b.ty - a.ty) > DY) continue
          const t = terrain[b.ty * W + b.tx]
          if (CADUCS.has(t)) caduc++
          else if (CONIF.has(t)) conif++
          else autres++
        }
        // ZÉRO ARBRE « AUTRE », ET C'EST LA CONDITION QUI FAIT TOUT LE SENS DE LA PHOTO.
        //
        // Un feuillu planté sur de l'HERBE garde ses feuilles tout l'hiver — `feuillageDenude`
        // teste le TERRAIN (forest/old_growth/willow) alors que le peuplement plante chênes et
        // saules sur `grass` (`MELANGE_PRE`). C'est un défaut de `/sim`, au journal. Mais un
        // cadre qui en contient un montre DEUX arbres verts dont on ne peut pas dire lequel est
        // un conifère qui tient (la promesse) et lequel est un chêne qui rate (le défaut) :
        // l'image démontre alors la règle ET son contre-exemple avec les mêmes pixels, donc ne
        // démontre rien. En exigeant zéro, **toute cime verte du cadre EST un conifère par
        // construction**, et la photo ne dit plus qu'une chose.
        //
        // ON GARDE QUAND MÊME UN REPLI. MESURÉ sur la seed 2026 : **aucun cadre de la carte**
        // ne réunit feuillus et conifères sans porter aussi un arbre « autre ». Exiger zéro
        // rendait donc `null` et ne photographiait rien — or une planche muette n'apprend
        // rien à personne. On élit donc d'abord le PUR ; à défaut, le moins impur, et le
        // compte est CRIÉ pour que la photo se lise avec son défaut sous les yeux. Que le
        // repli soit toujours pris est lui-même le constat : le cas du feuillu de pré est
        // partout.
        const score = Math.min(caduc, conif)
        // LE MÉLANGE D'ABORD, LA PURETÉ ENSUITE — et l'ordre compte : préférer le pur AVANT
        // d'exiger le mélange a élu un cadre à `conifères 0`, c'est-à-dire une futaie de
        // feuillus toute seule, qui ne montre évidemment pas que le conifère tient. Un cadre
        // sans les deux familles n'est pas candidat, point.
        if (score === 0) continue
        const cand = { x: a.tx, y: a.ty, score, caduc, conif, autres, pur: autres === 0 }
        if (!best) { best = cand; continue }
        if (cand.pur !== best.pur) { if (cand.pur) best = cand; continue }
        if (score > best.score) best = cand
      }
      return best
    })
    console.log(`  lisière feuillus/conifères (${lisiere?.x}, ${lisiere?.y}) — équilibre ${lisiere?.score}`
      + ` : feuillus ${lisiere?.caduc} · conifères ${lisiere?.conif}`
      + (lisiere?.pur ? ' · cadre PUR (aucun arbre hors des deux familles)'
        : ` · ⚠ ${lisiere?.autres} arbre(s) « AUTRE » dans le cadre — des feuillus sur un sol non caduc,`
          + ' qui gardent leurs feuilles (défaut de /sim au journal) : toute cime verte n’est donc PAS un conifère'))

    const out = {}
    // LE PAYSAGE — à midi, parce qu'un paysage se regarde éclairé.
    out.jour = await prendre('paysage-enneige', HEURE, site)
    // LA GLACE PROFONDE — de nuit, seule heure où le lac est pris en acte III (voir l'en-tête).
    out.nuit = await prendre('gel-nuit-lac-pris', 1, site)
    // LA PROMESSE DE G6, EN UNE IMAGE : le feuillu nu et le conifère qui tient, côte à côte.
    if (lisiere && lisiere.score > 0) out.lisiere = await prendre('gel-lisiere-conifere', HEURE, lisiere)
    else console.error('!! aucune lisière feuillus/conifères sur cette carte — G6 non photographié')

    // ④ LE PLAN RAPPROCHÉ. À l'échelle du jeu, une cellule de 4 px fait 9 px d'écran : la
    //    TRAME de la neige et la moucheture du givre y sont lisibles, mais serrées. On monte
    //    donc le zoom sur une berge — le seul endroit où les TROIS matières se touchent
    //    (neige au sol, glace, eau libre), donc le seul cadre qui montre qu'elles se
    //    distinguent. La caméra est décrochée du joueur : elle suit un point, pas un avatar.
    const berge = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const { width: W, height: H, terrain } = s.map
      let best = null
      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          if (terrain[y * W + x] !== 4) continue // un gué : c'est lui qui gèle à midi
          let libre = 0, sol = 0
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const t = terrain[(y + dy) * W + x + dx]
              if (t === 6) libre++
              else if (t !== 4) sol++
            }
          }
          const score = Math.min(libre, 8) + Math.min(sol, 8)
          if (!best || score > best.score) best = { x, y, score, libre, sol }
        }
      }
      return best
    })
    if (berge) {
      await agir({ type: 'debug_set_hour', hour: HEURE }, 400)
      await agir({ type: 'debug_teleport', x: berge.x + 0.5, y: berge.y + 0.5 }, 1200)
      await page.evaluate(({ x, y }) => {
        const s = window.__BRAISES__.scene
        const cam = s.cameras.main
        cam.stopFollow()
        cam.setZoom(6)
        cam.centerOn(x * 16 + 8, y * 16 + 8)
      }, berge)
      // LE RECADRAGE N'EXISTE QUE REDESSINÉ, et la couche recuit sur la position de la
      // caméra : sans une image de plus, on photographierait la fenêtre d'AVANT le zoom.
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/gel-glace-plan-rapproche.png`, timeout: 180000 })
      const e = await etat()
      console.log(`  gel-glace-plan-rapproche zoom 6 sur le gué (${berge.x}, ${berge.y})`
        + ` — eau libre ${berge.libre} · sol ${berge.sol} autour`
        + ` · glace ${e.gel.tuilesGlace} · neige ${e.gel.tuilesNeige} (couverture moyenne ${(e.gel.couvertureMoyenne ?? 0).toFixed(2)})`)
      out.berge = { ...berge, gel: e.gel }
    } else console.error('!! aucune berge gué/eau libre trouvée')
    return out
  },

  /**
   * LES TACHES DE SOLEIL SUIVENT LA CANOPÉE RÉELLE (2026-08-16, R6 amendée) — la preuve
   * se lit dans le MASQUE lui-même (`soleil-mask`, un canvas 2D : il se relit, lui),
   * pas dans une luminance d'écran : les taches sont subtiles (alpha ≤ 0,30) et le
   * moutonnement du sol les noierait. Trois propriétés, sur le monde RÉEL :
   *   • au PIED d'un arbre vivant, le masque est ÉTEINT (la couronne tamponne) ;
   *   • dans une TROUÉE de bois (aucun arbre à portée de couronne, profondeur ≥ 1),
   *     il est ALLUMÉ — pénombre comprise, jamais sous 0,5 ;
   *   • HORS des bois (profondeur 0), rien.
   * Plus la capture d'ambiance (A5) : une lisière zoomée, à l'œil.
   */
  async soleil(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(2500) // le premier peuplement + le premier rebâti du masque

    const lu = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const map = s.map
      const tex = s.textures.get('soleil-mask')
      if (!map || !tex || !map.profondeur) return { erreur: 'carte ou masque introuvable' }
      const ctx = tex.getContext()
      const img = ctx.getImageData(0, 0, map.width, map.height).data
      const dens = (tx, ty) => img[(ty * map.width + tx) * 4] / 255
      const prof = (tx, ty) => map.profondeur[ty * map.width + tx] ?? 0

      const arbres = s.view.nodes.filter((n) => (n.type === 'tree' || n.type === 'old_tree') && n.stock > 0)
      if (arbres.length === 0) return { erreur: 'aucun arbre vivant' }
      // Le pied de N troncs EN FORÊT (profondeur ≥ 1 — un arbre de pré n'a pas de sous-bois).
      const pieds = arbres.filter((n) => prof(n.tx, n.ty) >= 1).slice(0, 200).map((n) => dens(n.tx, n.ty))
      // Les TROUÉES : des tuiles de bois à ≥ 4 tuiles de tout arbre vivant (Chebyshev).
      const trouees = []
      for (let ty = 2; ty < map.height - 2 && trouees.length < 60; ty += 3) {
        for (let tx = 2; tx < map.width - 2 && trouees.length < 60; tx += 3) {
          if (prof(tx, ty) < 2) continue
          let libre = true
          for (const a of arbres) {
            if (Math.max(Math.abs(a.tx - tx), Math.abs(a.ty - ty)) < 4) { libre = false; break }
          }
          if (libre) trouees.push(dens(tx, ty))
        }
      }
      // HORS bois : profondeur 0.
      const dehors = []
      for (let ty = 2; ty < map.height - 2 && dehors.length < 60; ty += 5) {
        for (let tx = 2; tx < map.width - 2 && dehors.length < 60; tx += 5) {
          if (prof(tx, ty) === 0) dehors.push(dens(tx, ty))
        }
      }
      // Une lisière à REGARDER : le premier arbre de forêt qui a une trouée à 5 tuiles.
      let cadre = null
      for (const a of arbres) {
        if (prof(a.tx, a.ty) < 1) continue
        if (dens(a.tx + 5, a.ty) > 0.5) { cadre = { tx: a.tx, ty: a.ty }; break }
      }
      const moyenne = (l) => (l.length === 0 ? -1 : l.reduce((s2, v) => s2 + v, 0) / l.length)
      return {
        nPieds: pieds.length, piedMoyen: moyenne(pieds), piedMax: Math.max(...pieds),
        nTrouees: trouees.length, troueeMin: trouees.length ? Math.min(...trouees) : -1,
        nDehors: dehors.length, dehorsMax: dehors.length ? Math.max(...dehors) : -1,
        cadre,
      }
    })
    if (lu.erreur) {
      console.log(`   ✗ ${lu.erreur}`)
      return
    }
    console.log(`MESURÉ — masque lu en jeu : ${lu.nPieds} pieds d'arbre (moyenne ${lu.piedMoyen.toFixed(2)}, max ${lu.piedMax.toFixed(2)}) · ${lu.nTrouees} trouées (min ${lu.troueeMin.toFixed(2)}) · ${lu.nDehors} tuiles hors bois (max ${lu.dehorsMax.toFixed(2)})`)
    console.log(lu.piedMax < 0.15 ? '   ✓ au pied d\'un tronc, la canopée éteint la tache' : '   ✗ des taches percent au pied des troncs')
    console.log(lu.nTrouees > 0 && lu.troueeMin > 0.5 ? '   ✓ une trouée de bois est ALLUMÉE (pénombre comprise)' : `   ✗ des trouées éteintes (min ${lu.troueeMin})`)
    console.log(lu.dehorsMax === 0 ? '   ✓ hors des bois, rien — le sous-bois seulement' : `   ✗ des taches hors des bois (max ${lu.dehorsMax})`)

    // L'AMBIANCE (A5), à l'œil : une lisière zoomée — taches dans les trouées, rien sous
    // les couronnes. La boucle dort pour une frame stable (rendu logiciel).
    if (lu.cadre) {
      await page.evaluate((c) => {
        const s = window.__BRAISES__.scene
        s.cameras.main.stopFollow()
        s.cameras.main.centerOn((c.tx + 2.5) * 16, c.ty * 16)
        s.cameras.main.setZoom(4)
        const g = s.game
        g.loop.sleep()
        g.step(g.loop.time + 16, 16)
        g.step(g.loop.time + 16, 16)
      }, lu.cadre)
      await page.screenshot({ timeout: 90000, path: `${OUT}/soleil-lisiere.png` })
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
      console.log(`→ ${OUT}/soleil-lisiere.png`)
    }
  },

  /**
   * LE SANG REND (2026-08-16) — trois défauts corrigés, trois preuves, et AUCUNE action
   * de sim : tout est peint côté client, le scénario tourne sur le build de production.
   *
   *  ① LA PISTE N'EST PLUS UN TAMPON — on injecte des pistes FABRIQUÉES dans la vue
   *     (verrouillées par getter, le motif de `feuNuit` sur `warmth` : le snapshot
   *     réécrirait le champ au tick suivant) et on lit ce que le POOL affiche :
   *     textures distinctes, rotations distinctes — et l'orientation SUIT la course
   *     injectée (une piste plein est pointe plein est, une piste plein sud plein sud).
   *  ② LA GICLÉE SE POSE — `sangFx.gicler`, boucle figée, avancée à la main
   *     (`game.step`, le motif de `tir`) : des gouttelettes EN L'AIR, puis AU SOL.
   *  ③ LE SANG EST ÉCLAIRÉ — luminance des MÊMES gouttes au jour puis sous le
   *     préréglage nuit (gel de `dynLight.update`, le motif d'`erratique`) : elle doit
   *     CHUTER. Avant le correctif, le voile d'ambiance passait SOUS la bande de tri
   *     et une goutte restait pleine couleur en pleine nuit — le ratio ferait ~1.
   *
   * La cadence des pistes est recopiée en littéral (16 ticks = HUNT.BLOOD_EVERY_TICKS,
   * C9) — un témoin extérieur, comme les seuils recopiés de `chasse` : si la cadence de
   * la sim bouge, l'appariement du rendu doit suivre, et ce scénario le dira.
   */
  async sang(page) {
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(1500)

    // ── ① LES PISTES INJECTÉES : trois allures + des orphelines ──
    await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const v = s.view
      const T = 16 // TILE_PX
      // UNE CLAIRIÈRE D'ABORD. Le spawn est souvent sous canopée (le Bois Noir) : une
      // piste au sol y dort SOUS les houppiers — la capture ne montre rien et la mesure
      // de luminance vise une frondaison (vécu à la première passe : ratio 1,00 pile,
      // la région ne contenait aucun pixel de sang). On cherche donc, autour du joueur,
      // la tuile la plus loin de tout arbre (et à deux tuiles de tout autre nœud), on y
      // pose les pistes, et la caméra s'y ancre.
      const px0 = s.playerSprite.x / T
      const py0 = s.playerSprite.y / T
      const arbres = v.nodes.filter((n) => n.type === 'tree' || n.type === 'old_tree')
      const autres = v.nodes.filter((n) => n.type !== 'tree' && n.type !== 'old_tree')
      let px = px0
      let py = py0
      let mieux = -1
      for (let dy = -14; dy <= 14; dy += 2) {
        for (let dx = -14; dx <= 14; dx += 2) {
          const cx = px0 + dx
          const cy = py0 + dy
          let dArbre = 1e9
          for (const a of arbres) dArbre = Math.min(dArbre, Math.max(Math.abs(a.tx - cx), Math.abs(a.ty - cy)))
          let dAutre = 1e9
          for (const a of autres) dAutre = Math.min(dAutre, Math.max(Math.abs(a.tx - cx), Math.abs(a.ty - cy)))
          const score = Math.min(dArbre, 12) + Math.min(dAutre, 2)
          if (score > mieux) {
            mieux = score
            px = cx
            py = cy
          }
        }
      }
      s.cameras.main.stopFollow()
      s.cameras.main.centerOn(px * T, py * T)
      window.__SANG__ = { px, py }
      const CAD = 16 // HUNT.BLOOD_EVERY_TICKS — témoin recopié (C9)
      const t0 = v.tick - CAD * 12
      const drops = []
      // 0..7 — la piste au TROT, plein EST (1,2 tuile par intervalle)
      for (let i = 0; i < 8; i++) drops.push({ x: px - 5 + 1.2 * i, y: py + 2.5, tick: t0 + CAD * i })
      // 8..12 — la piste LANCÉE, plein SUD (3 tuiles par intervalle)
      for (let i = 0; i < 5; i++) drops.push({ x: px - 7, y: py - 6 + 3 * i, tick: t0 + 3 + CAD * i })
      // 13..17 — la bête qui STAGNE (à peine un pas entre deux gouttes) → flaques
      for (let i = 0; i < 5; i++) drops.push({ x: px + 5 + 0.15 * i, y: py - 3, tick: t0 + 7 + CAD * i })
      // 18..23 — six orphelines HORS cadence : le hachage oriente, et il doit varier
      for (let i = 0; i < 6; i++) drops.push({ x: px - 4 + i * 1.7, y: py + 5.2, tick: t0 + 11 + 5 * i })
      Object.defineProperty(v, 'blood', { get: () => drops, set: () => {}, configurable: true })
    })
    await page.waitForTimeout(700) // quelques frames : le pool se peuple

    const piste = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const v = s.view
      const vis = v.bloodPool.filter((g) => g.visible)
      return {
        vis: vis.length,
        textures: [...new Set(vis.map((g) => g.texture.key))],
        rotations: new Set(vis.map((g) => Math.round(g.rotation * 20))).size,
        echelles: new Set(vis.map((g) => Math.round(g.scaleX * 50))).size,
        lit: vis.every((g) => g.lighting === true),
        est: v.bloodDecor.slice(1, 8), // la piste EST, gouttes appariées (la 0 n'a pas de précédente)
        sud: v.bloodDecor.slice(9, 13),
        flaques: v.bloodDecor.slice(14, 18).map((d) => d.variante),
      }
    })
    console.log(`INJECTÉ — ${piste.vis} gouttes peintes · textures : ${piste.textures.join(', ')} · ${piste.rotations} rotations · ${piste.echelles} échelles`)
    console.log(piste.textures.length >= 3 && piste.rotations >= 6
      ? '   ✓ la piste VARIE : plusieurs formes, plusieurs angles — plus un tampon'
      : `   ✗ la piste se répète encore (${piste.textures.length} texture(s), ${piste.rotations} rotation(s))`)
    const estOk = piste.est.every((d) => Math.abs(d.angle) < 0.01 && (d.variante === 1 || d.variante === 3))
    const sudOk = piste.sud.every((d) => Math.abs(d.angle - Math.PI / 2) < 0.01 && d.variante === 2)
    const flaquesOk = piste.flaques.every((va) => va === 0)
    console.log(estOk ? '   ✓ la piste plein EST pointe plein est (éclaboussures/gouttelettes)' : `   ✗ piste est : ${JSON.stringify(piste.est)}`)
    console.log(sudOk ? '   ✓ la piste LANCÉE plein SUD pointe plein sud (traînées)' : `   ✗ piste sud : ${JSON.stringify(piste.sud)}`)
    console.log(flaquesOk ? '   ✓ la bête qui stagne laisse des FLAQUES' : `   ✗ flaques : ${JSON.stringify(piste.flaques)}`)
    console.log(piste.lit ? '   ✓ chaque goutte est en setLighting (le monde l’éclaire)' : '   ✗ des gouttes échappent à l’éclairage')
    await page.screenshot({ timeout: 90000, path: `${OUT}/sang-1-pistes-jour.png` })

    // ── ② LA GICLÉE : en l'air, puis posée ──
    const vol = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const T = 16
      const c = window.__SANG__
      // Un coup de 18 sur un corps au centre de la clairière, frappé depuis l'ouest :
      // la giclée part vers l'est, en terrain dégagé — elle se VOIT sur la capture.
      s.sangFx.gicler(c.px * T, c.py * T, 18, s.time.now, c.px * T - 32, c.py * T)
      const g = s.game
      g.loop.sleep()
      let t = g.loop.time
      t += 40; g.step(t, 40)
      t += 40; g.step(t, 40)
      return { air: s.sangFx.enAir, sol: s.sangFx.auSol }
    })
    await page.screenshot({ timeout: 90000, path: `${OUT}/sang-2-giclee-vol.png` })
    const pose = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const g = s.game
      let t = g.loop.time
      for (let i = 0; i < 12; i++) { t += 45; g.step(t, 45) }
      return { air: s.sangFx.enAir, sol: s.sangFx.auSol }
    })
    await page.screenshot({ timeout: 90000, path: `${OUT}/sang-3-giclee-posee.png` })
    await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
    console.log(vol.air >= 4
      ? `   ✓ la giclée VOLE (${vol.air} gouttelettes en l'air à 80 ms)`
      : `   ✗ pas de giclée en vol (air=${vol.air}, sol=${vol.sol})`)
    console.log(pose.sol >= 4 && pose.air === 0
      ? `   ✓ puis SE POSE (${pose.sol} taches au sol à 620 ms, plus rien en l'air)`
      : `   ✗ la giclée ne se pose pas (air=${pose.air}, sol=${pose.sol})`)

    // ── ③ LE GOUTTE-À-GOUTTE d'une plaie, si une bête vit au voisinage (best effort :
    // un monde frais n'en garantit pas près du spawn — l'émission est aussi unitaire) ──
    const betes = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const v = s.view
      const liste = v.monsters
      if (!liste || liste.length === 0) return 0
      for (const m of liste) m.bleedUntil = 1e9 // plaie client SEULEMENT — rien n'entre dans la sim
      Object.defineProperty(v, 'monsters', { get: () => liste, set: () => {}, configurable: true })
      return liste.length
    })
    if (betes > 0) {
      let vu = 0
      for (let i = 0; i < 8 && vu === 0; i++) {
        await page.waitForTimeout(350)
        vu = await page.evaluate(() => window.__BRAISES__.scene.sangFx.enAir + window.__BRAISES__.scene.sangFx.auSol)
      }
      console.log(vu > 0
        ? `   ✓ ${betes} bête(s) en plaie → le goutte-à-goutte TOMBE (${vu} goutte(s) vue(s))`
        : `   ✗ ${betes} bête(s) en plaie et AUCUNE goutte émise`)
    } else {
      console.log('   (aucune bête au voisinage du spawn — émission testée en unitaire seulement)')
    }

    // ── ④ LA NUIT : les mêmes gouttes doivent S'ÉTEINDRE avec le monde ──
    const cible = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const cam = s.cameras.main
      const wv = cam.worldView
      const T = 16
      // Le centre de la grappe de flaques (drops 13..17) : le blob le plus large.
      const fx = (window.__SANG__.px + 5.3) * T
      const fy = (window.__SANG__.py - 3) * T
      return { x: Math.round((fx - wv.x) * cam.zoom), y: Math.round((fy - wv.y) * cam.zoom), zoom: cam.zoom }
    })
    // LA MESURE EST SPÉCIFIQUE AU SANG, pas à la région : le préréglage nuit ne pilote
    // que le LightsManager (les sprites lit) — le SOL, lui, tient son jour/nuit du voile
    // d'ambiance, que ce scénario ne touche pas. Moyenner toute la région diluerait donc
    // la chute dans de l'herbe immuable (vécu : ratio 1,00, la région avait raté le blob
    // d'un demi-tuile). On repère les pixels ROUGES DOMINANTS au jour — le sang — et on
    // relit la luminance de CES pixels-là, aux mêmes coordonnées, sous la nuit.
    const clip = { x: Math.max(0, cible.x - 24), y: Math.max(0, cible.y - 24), width: 48, height: 48 }
    const jour = await regionAt(page, clip)
    const rouges = []
    if (jour) {
      for (let y = 0; y < jour.h; y++) for (let x = 0; x < jour.w; x++) {
        const [rr, vv, bb] = jour.px(x, y)
        if (rr > vv + 10 && rr > bb + 10) rouges.push([x, y])
      }
    }
    const lumSur = (r, points) => {
      let somme = 0
      for (const [x, y] of points) {
        const [rr, vv, bb] = r.px(x, y)
        somme += 0.2126 * rr + 0.7152 * vv + 0.0722 * bb
      }
      return somme / Math.max(1, points.length)
    }
    const nuit0 = await page.evaluate(() => {
      const s = window.__BRAISES__.scene
      const dl = s.dynLight
      if (!dl) return false
      dl.update = () => {} // GEL : sinon il réécrit l'ambiante chaque frame depuis l'heure in-world
      const v = s.cameras.main.worldView
      s.lights.setAmbientColor(0x33415f) // AMBIENT_NIGHT
      dl.sun.intensity = 0
      dl.moon.intensity = 0.32 // MOON_INTENSITY
      dl.moon.x = v.x + v.width / 2
      dl.moon.y = v.y - 1600 // au NORD, au-dessus de la vue
      // ET ON REND LA FRAME À LA MAIN (le motif de `feuNuit`) : attendre ne suffit pas —
      // ce rendu logiciel peut ne produire AUCUNE frame en une demi-seconde, et la
      // capture montrerait alors le JOUR d'avant (mesuré : ratio 1,00 pile).
      const g = s.game
      g.loop.sleep()
      g.step(g.loop.time + 16, 16)
      g.step(g.loop.time + 16, 16)
      return true
    })
    const nuit = await regionAt(page, clip)
    // La capture pleine page AVANT de réveiller : la boucle dort, la frame de nuit tient.
    await page.screenshot({ timeout: 90000, path: `${OUT}/sang-4-pistes-nuit.png` })
    await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
    if (jour && nuit && nuit0 && rouges.length >= 15) {
      const lJour = lumSur(jour, rouges)
      const lNuit = lumSur(nuit, rouges)
      const ratio = lJour > 1 ? lNuit / lJour : 1
      console.log(`MESURÉ — luminance du sang (${rouges.length} px rouges de la flaque) : jour ${lJour.toFixed(1)} → nuit ${lNuit.toFixed(1)} (ratio ${ratio.toFixed(2)})`)
      console.log(ratio < 0.65
        ? '   ✓ le sang s\'éteint avec le monde : il est ÉCLAIRÉ, plus un décal fluorescent'
        : '   ✗ le sang reste allumé la nuit — setLighting ne porte pas')
    } else {
      console.log(`   ✗ mesure de nuit impossible (dynLight/capture indisponible, ou flaque hors région : ${rouges.length} px rouges)`)
    }
    console.log(`→ ${OUT}/sang-1-pistes-jour.png · sang-2-giclee-vol.png · sang-3-giclee-posee.png · sang-4-pistes-nuit.png`)
  },

  /**
   * LA STÈLE (2026-08-21, spec annales.md R8) — le lecteur de pierre du pays d'avant SE VOIT.
   *
   * Trois choses à l'œil, aucune mesure fine : ① les stèles EXISTENT sur la carte jouée et
   * leurs textures (jour + crown absente : elle est basse) sont générées ; ② de près, la
   * pierre se lit — équarrie, gravée, moussue — et ne flotte pas ; ③ la nuit, sa version
   * `_lit` tient (les gravures restent lisibles — c'est une pierre qui parle).
   *
   * Exige `--dev` (debug_teleport). La boucle DORT pendant chaque capture (leçon consignée :
   * l'horloge headless fond les frames).
   */
  async stele(page) {
    await page.goto(URL)
    await page.waitForFunction(() => Boolean(window.__BRAISES__?.scene?.registry?.get('worldReady')), null, { timeout: 150000 })
    await page.waitForTimeout(800)

    const etat = await page.evaluate(() => {
      const sc = window.__BRAISES__.scene
      const steles = (sc.map.zones ?? []).filter((z) => z.kind === 'stele')
      return {
        steles: steles.map((z) => ({ x: z.x, y: z.y, name: z.name })),
        tex: sc.textures?.exists?.('poi-stele') ?? false,
      }
    })
    console.log(`état : ${etat.steles.length} stèle(s), texture jour ${etat.tex ? 'générée' : 'ABSENTE'}`)
    if (etat.steles.length === 0) { console.error('!! aucune stèle sur la carte jouée — rien à voir'); return }
    if (!etat.tex) console.error('!! la texture poi-stele n\'est pas générée')

    // CHAQUE stèle, de jour — et pour chacune, le SPRITE réel (pas la zone) : où le rendu
    // l'a posée, sur quelle texture, à quelle profondeur. La zone dit l'intention, le
    // sprite dit le fait.
    // Une action PAR envoi, avec son attente (patron `frontiere` — groupées dans un seul
    // evaluate, la seconde se perdait : mesuré, la caméra restait à 22 tuiles de la cible
    // et l'heure ne bougeait pas), puis on VÉRIFIE la position au lieu de la supposer.
    const agir = async (action, ms) => {
      await page.evaluate((a) => { window.__BRAISES__.scene.sendAction(a) }, action)
      await page.waitForTimeout(ms)
    }
    const pos = () => page.evaluate(() => window.__BRAISES__.scene.registry.get('playerPos'))
    await agir({ type: 'debug_set_hour', hour: 12 }, 300)
    for (let i = 0; i < etat.steles.length; i++) {
      const cible = etat.steles[i]
      for (let essai = 0; essai < 3; essai++) {
        await agir({ type: 'debug_teleport', x: cible.x + 0.5, y: cible.y + 3.5 }, 600)
        const p = await pos()
        if (p && Math.abs(p.x - (cible.x + 0.5)) < 3 && Math.abs(p.y - (cible.y + 3.5)) < 3) break
        if (essai === 2) console.error(`!! TP raté vers la stèle ${i + 1} : joueur en ${p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : '?'}`)
      }
      await page.waitForTimeout(900)
      const sprite = await page.evaluate(() => {
        const sc = window.__BRAISES__.scene
        const trouve = []
        const visite = (obj) => {
          if (obj.texture?.key === 'poi-stele' || obj.texture?.key === 'poi-stele_lit') {
            trouve.push({ key: obj.texture.key, x: Math.round(obj.x), y: Math.round(obj.y), visible: obj.visible, depth: obj.depth, alpha: obj.alpha })
          }
          for (const c of obj.list ?? []) visite(c)
        }
        for (const c of sc.children.list) visite(c)
        const cam = sc.cameras.main
        return { sprites: trouve, cam: { sx: Math.round(cam.scrollX), sy: Math.round(cam.scrollY), zoom: cam.zoom } }
      })
      console.log(`stèle ${i + 1} (${cible.name} en ${cible.x},${cible.y}) — sprites : ${JSON.stringify(sprite.sprites)} · cam ${JSON.stringify(sprite.cam)}`)
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.sleep())
      await page.screenshot({ timeout: 90000, path: `${OUT}/stele-${i + 1}-jour.png` })
      await page.evaluate(() => window.__BRAISES__.scene.game.loop.wake())
    }

    // PAS DE CAPTURE DE NUIT ICI, et la raison est consignée : dans ce scénario, un SECOND
    // `debug_set_hour` du même run reste sans effet (constaté deux fois — 12h passe au
    // premier envoi, 0 comme 23 sont ignorés ensuite ; le handler sim est sain à la lecture).
    // SUSPECTÉ : un caprice du chemin debug du harnais, non élucidé. La version _lit de la
    // stèle passe par le pipeline commun à toutes les pierres (poi-lit) — le risque de nuit
    // est porté par leurs gardes. Si la nuit doit se prouver ICI, élucider d'abord le refus.
    console.log(`→ ${OUT}/stele-N-jour.png`)
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

/**
 * ═══ LES VERDICTS COMPTENT ENFIN — LA CONVENTION `!!` DEVIENT UNE ASSERTION ═══
 *
 * Les 74 scénarios portent ~290 verdicts écrits `console.error('!! …')` — « G5 rompu »,
 * « la passe de matière n'émet RIEN », « aucune lisière feuillus/conifères ». AUCUN ne
 * touchait le code de sortie : seul `pageerror` posait `failed`. Donc
 * `pnpm smoke --scenario gels && echo OK` affichait OK pendant que le scénario imprimait
 * que son critère d'acceptation était rompu.
 *
 * Conséquence : la règle de commit de CLAUDE.md (« plus le smoke du système touché ») ne
 * pouvait être tenue que par un humain qui LIT la sortie — pas par un script, pas par un
 * agent, pas par la CI. Chaque verdict écrit était un test qu'on croyait avoir et qu'on
 * n'avait pas. (Constaté en vrai : le scénario `construction` échoue sur six vérifications
 * depuis un moment, et personne ne l'avait vu.)
 *
 * On ne réécrit pas 290 sites : la convention EXISTE, elle n'était pas câblée. Le préfixe
 * `!!` est déjà la marque du verdict rompu — on le compte à la source.
 *
 * ⚠ CE QUI RESTE VOLONTAIREMENT HORS DU COMPTE. Les deux gestionnaires ci-dessous écrivent
 * par `erreurBrute` : une ERREUR DE PAGE pose déjà `failed` elle-même, et une erreur de
 * CONSOLE est signalée sans faire échouer — distinction délibérée d'origine, qu'on ne
 * renverse pas au détour d'un correctif d'outillage.
 */
let verdictsRompus = 0
const erreurBrute = console.error.bind(console)
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].trimStart().startsWith('!!')) verdictsRompus += 1
  erreurBrute(...args)
}

page.on('pageerror', (e) => {
  erreurBrute(`!! ERREUR DE PAGE : ${e.message}`)
  failed = true
})
page.on('console', (m) => {
  if (m.type() === 'error') erreurBrute(`!! CONSOLE : ${m.text()}`)
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
if (verdictsRompus > 0) {
  erreurBrute(`\n✗ ${verdictsRompus} verdict(s) rompu(s) — les lignes « !! » ci-dessus`)
}
if (failed) {
  erreurBrute('\n✗ le jeu a jeté une erreur — voir ci-dessus')
}
if (failed || verdictsRompus > 0) process.exit(1)
