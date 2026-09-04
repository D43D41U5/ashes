/**
 * DIAGNOSTIC DES FALAISES DE TERRASSE — « où le jeu me bloque-t-il sans me le montrer ? »
 *
 * Deux questions, sur le monde JOUÉ (`MONDE_JOUE`, les graines en cache), avec LA règle du jeu
 * pour le pas (`etagesDuPas` + `etageApresLePas`) et LA règle du rendu pour le dessin (les
 * prédicats de `cliff-layer` : `estEau`, `creerRelief`, `chutesDe`) — rien n'est recopié :
 *
 *   1. LES CONFIGURATIONS. Chaque pas d'une tuile marchable vers une voisine marchable que le
 *      palier REFUSE est classé par (côté où tombe le bas, vu de la tuile haute) × (matière du
 *      haut) × (matière du bas) × (Δ paliers), et l'on dit ce que le rendu y dessine : la PAROI
 *      (face sud), la LÈVRE (bord vu de dessus), la lèvre d'eau du shader… ou RIEN. « Rien »,
 *      c'est la falaise invisible.
 *
 *   2. LA GÊNE. Combien de murs par tuile marchable, contre combien d'obstacles d'avant (roche,
 *      eau profonde) ; à quelle distance est la rampe la plus proche quand on bute sur un mur ;
 *      et le DÉTOUR : sur des paires de tuiles proches, la longueur du chemin en étages contre
 *      celle du chemin à plat.
 *
 *   node --import tsx tools/diag-falaises.mts [graines…]   (défaut : 2026 7 4242 909)
 *   RAMPE_PAS=24 MIETTE_TUILES=256 node --import tsx tools/diag-falaises.mts    — éprouver un
 *       réglage de `TERRASSES` (toute clé) SANS toucher /sim : le générateur tourne en direct (jamais le cache, qui
 *       ne connaît que le réglage écrit), ~4 s par graine de plus.
 */
import { carteDeTest } from './carte-cache'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { TERRASSES } from '../packages/sim/src/terrasses'
import { MONDE, MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { MARCHABLE, isWater, type WorldMap } from '../packages/sim/src/map'
import { connecteurAt, etageApresLePas, etagesDuPas, marchableAEtage, palierDuSol } from '../packages/sim/src/etages'
import { TERRAINS } from '../packages/sim/src/balance'
import { estEau, estSurface } from '../packages/client/src/render/paves'
import { creerRelief } from '../packages/client/src/render/relief'
import { CHUTE_LEVRE_E, CHUTE_LEVRE_N, CHUTE_LEVRE_O, chutesDe } from '../packages/client/src/render/water-field'

const graines = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n))
if (graines.length === 0) graines.push(2026, 7, 4242, 909)
/** `RAMPE_PAS=24 MIETTE_TUILES=256 PALIERS=2 …` : tout réglage de `TERRASSES` se force par l'environnement. */
let force = false
for (const cle of Object.keys(TERRASSES)) {
  const v = process.env[cle]
  if (v === undefined) continue
  ;(TERRASSES as unknown as Record<string, number>)[cle] = Number(v)
  console.log(`⚠ TERRASSES.${cle} forcé à ${v} — génération en direct, hors cache`)
  force = true
}
const rampePas = force ? 1 : undefined

const VOISINS = [[0, -1, 'N'], [0, 1, 'S'], [1, 0, 'E'], [-1, 0, 'O']] as const

/** La matière d'une tuile telle que le rendu la classe : l'eau, une surface (marais, tourbière), la terre. */
function matiere(t: number): 'eau' | 'marais' | 'terre' {
  if (isWater(t)) return 'eau'
  if (estSurface(t)) return 'marais'
  return 'terre'
}

/** La composante marchable principale AU SOL (paliers ignorés) — là où le joueur vit. */
function composantePrincipale(map: WorldMap): Uint8Array {
  const { width, height, terrain } = map
  const N = width * height
  const comp = new Int32Array(N).fill(-1)
  const file: number[] = []
  let meilleur = -1
  let meilleurN = 0
  let n = 0
  for (let dep = 0; dep < N; dep++) {
    if (comp[dep]! >= 0 || MARCHABLE[terrain[dep]!] !== 1) continue
    file.length = 0
    file.push(dep)
    comp[dep] = n
    for (let h = 0; h < file.length; h++) {
      const i = file[h]!
      const x = i % width
      const y = (i - x) / width
      for (const [dx, dy] of VOISINS) {
        const vx = x + dx
        const vy = y + dy
        if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
        const j = vy * width + vx
        if (comp[j]! >= 0 || MARCHABLE[terrain[j]!] !== 1) continue
        comp[j] = n
        file.push(j)
      }
    }
    if (file.length > meilleurN) { meilleurN = file.length; meilleur = n }
    n++
  }
  const dedans = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (comp[i] === meilleur) dedans[i] = 1
  return dedans
}

/** Le pas du jeu : depuis (x, y) au niveau n, la tuile (vx, vy) est-elle atteignable, et à quel niveau ? */
function pas(map: WorldMap, n: number, x: number, y: number, vx: number, vy: number): number | undefined {
  if (vx < 0 || vy < 0 || vx >= map.width || vy >= map.height) return undefined
  const etages = etagesDuPas(map, n, x, y) ?? [n]
  if (!etages.some((e) => marchableAEtage(map, e, vx, vy))) return undefined
  return etageApresLePas(map, etages, n, vx, vy)
}

/** BFS en (tuile, niveau) depuis (x0, y0, n0) jusqu'à la tuile cible (à tout niveau), bornée. */
function distanceEnEtages(map: WorldMap, x0: number, y0: number, n0: number, cx: number, cy: number, borne: number): number {
  const { width } = map
  const NIV = 6
  const vu = new Map<number, number>()
  const cle = (i: number, n: number): number => i * NIV + (n + 1)
  let file: number[] = [x0, y0, n0]
  vu.set(cle(y0 * width + x0, n0), 0)
  let d = 0
  while (file.length > 0 && d < borne) {
    const suivante: number[] = []
    for (let h = 0; h < file.length; h += 3) {
      const x = file[h]!
      const y = file[h + 1]!
      const n = file[h + 2]!
      if (x === cx && y === cy) return d
      for (const [dx, dy] of VOISINS) {
        const vx = x + dx
        const vy = y + dy
        const apres = pas(map, n, x, y, vx, vy)
        if (apres === undefined) continue
        const k = cle(vy * width + vx, apres)
        if (vu.has(k)) continue
        vu.set(k, d + 1)
        suivante.push(vx, vy, apres)
      }
    }
    file = suivante
    d++
  }
  return Infinity
}

/** BFS à plat (le monde d'avant : marchable au sol, paliers ignorés), bornée. */
function distanceAPlat(map: WorldMap, x0: number, y0: number, cx: number, cy: number, borne: number): number {
  const { width, height, terrain } = map
  const vu = new Set<number>([y0 * width + x0])
  let file: number[] = [x0, y0]
  let d = 0
  while (file.length > 0 && d < borne) {
    const suivante: number[] = []
    for (let h = 0; h < file.length; h += 2) {
      const x = file[h]!
      const y = file[h + 1]!
      if (x === cx && y === cy) return d
      for (const [dx, dy] of VOISINS) {
        const vx = x + dx
        const vy = y + dy
        if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
        const j = vy * width + vx
        if (vu.has(j) || MARCHABLE[terrain[j]!] !== 1) continue
        vu.add(j)
        suivante.push(vx, vy)
      }
    }
    file = suivante
    d++
  }
  return Infinity
}

/** Un PRNG de sonde (pas le jeu) : xorshift32, pour tirer les échantillons. */
function tireur(graine: number): () => number {
  let s = graine >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

function quantile(v: number[], q: number): number {
  if (v.length === 0) return NaN
  const t = [...v].sort((a, b) => a - b)
  return t[Math.min(t.length - 1, Math.floor(q * t.length))]!
}

for (const graine of graines) {
  const t0 = performance.now()
  const map = (rampePas !== undefined ? generateZonedTerrain(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE) : carteDeTest(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE)).map
  const { width, height, terrain } = map
  const relief = creerRelief(map)
  const chutes = chutesDe(terrain, width, height, map.palier ?? new Uint8Array(width * height))
  const principale = composantePrincipale(map)
  console.log(`\n═══ graine ${graine} — ${width}×${height}, carte en ${Math.round(performance.now() - t0)} ms ═══`)
  if (map.palier === undefined) { console.log('  pas de palier : rien à diagnostiquer'); continue }

  // ── 1. LES CONFIGURATIONS ──────────────────────────────────────────────────────────────────
  const configs = new Map<string, { n: number; ex: string[] }>()
  let murs = 0 // paires non orientées bloquées par le palier
  let obstacles = 0 // pas refusés par un non-marchable (le monde d'avant)
  let marchables = 0
  let pasOuverts = 0
  const exemplesRien: string[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (principale[i] !== 1) continue
      marchables++
      const p = palierDuSol(map, x, y)
      for (const [dx, dy, cote] of VOISINS) {
        const vx = x + dx
        const vy = y + dy
        if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
        const j = vy * width + vx
        const tv = terrain[j]!
        if (MARCHABLE[tv] !== 1) { obstacles++; continue }
        const apres = pas(map, p, x, y, vx, vy)
        if (apres !== undefined) { pasOuverts++; continue }
        const q = palierDuSol(map, vx, vy)
        // Compter chaque mur une fois : depuis le BAS (ou, à palier égal — un chapeau —, depuis l'ouest/nord).
        const haut = q > p
        if (q === p ? (dx > 0 || dy > 0) : haut) murs++
        // La configuration, vue de la tuile HAUTE : de quel côté tombe le bas.
        const hx = haut ? vx : x
        const hy = haut ? vy : y
        const bx = haut ? x : vx
        const by = haut ? y : vy
        const coteBas = haut ? ({ N: 'S', S: 'N', E: 'O', O: 'E' } as const)[cote] : cote
        const th = terrain[hy * width + hx]!
        const tb = terrain[by * width + bx]!
        const mh = matiere(th)
        const mb = matiere(tb)
        const hH = relief.hauteur(hx, hy)
        const hB = relief.hauteur(bx, by)
        const delta = hH - hB
        const chapeau = relief.chapeau(hx, hy)
        // CE QUE LE RENDU DESSINE (les règles de `cliff-layer.ts`, dans l'ordre du code) :
        let dessin: string
        if (delta <= 0) dessin = 'ÉTAGE (sans relief)' // même hauteur : un connecteur qui refuse, ou une salle
        else if (coteBas === 'S') dessin = mh === 'eau' && mb === 'eau' && delta === 1 ? 'chute' : 'paroi'
        else if (chapeau) dessin = 'lèvre (EtageLayer)'
        // La lèvre borde tout ce qui n'est pas de l'EAU — le marais compris (règle `surface` de
        // `cliff-layer`, jugée à `estEau` depuis le 2026-09-04 ; jugée à `estSurface`, elle
        // laissait 80 % des falaises invisibles du monde joué sur les bords de marais).
        else if (!estEau(th)) dessin = coteBas === 'E' ? 'lèvre + ombre de flanc' : 'lèvre'
        else if (mh === 'eau' && mb === 'eau') {
          const bit = coteBas === 'N' ? CHUTE_LEVRE_N : coteBas === 'E' ? CHUTE_LEVRE_E : CHUTE_LEVRE_O
          dessin = (chutes[hy * width + hx]! & bit) !== 0 ? 'lèvre d’eau (shader)' : 'RIEN (couture E/O < 3)'
        } else dessin = 'RIEN'
        const k = `${coteBas.padEnd(1)} · haut=${mh.padEnd(6)} bas=${mb.padEnd(6)} Δ${delta} → ${dessin}`
        let c = configs.get(k)
        if (!c) { c = { n: 0, ex: [] }; configs.set(k, c) }
        c.n++
        if (c.ex.length < 3 && (q === p ? (dx > 0 || dy > 0) : haut)) c.ex.push(`(${hx},${hy})↓(${bx},${by}) ${TERRAINS[th]!.name}/${TERRAINS[tb]!.name}`)
        if (dessin.startsWith('RIEN') && exemplesRien.length < 12) exemplesRien.push(`${coteBas} (${hx},${hy}) ${TERRAINS[th]!.name}→${TERRAINS[tb]!.name}`)
      }
    }
  }
  console.log(`  ${marchables} tuiles marchables (composante principale) · ${pasOuverts} pas ouverts · ${obstacles} pas sur un obstacle · ${murs} murs de palier (paires)`)
  console.log(`  murs pour 100 tuiles : ${(murs / marchables * 100).toFixed(1)} · obstacles pour 100 tuiles : ${(obstacles / marchables * 100).toFixed(1)}`)
  console.log('  configurations (pas refusés par le palier, comptés des deux côtés) :')
  const lignes = [...configs.entries()].sort((a, b) => b[1].n - a[1].n)
  let rien = 0
  let total = 0
  for (const [k, c] of lignes) {
    total += c.n
    if (k.includes('RIEN')) rien += c.n
    console.log(`    ${String(c.n).padStart(6)}  ${k}    ex. ${c.ex.join(' ; ')}`)
  }
  console.log(`  → RIEN dessiné : ${rien} / ${total} pas refusés (${(rien / total * 100).toFixed(1)} %)`)
  if (exemplesRien.length > 0) console.log(`  exemples de falaises invisibles : ${exemplesRien.join(' · ')}`)

  // ── 2. LA GÊNE ─────────────────────────────────────────────────────────────────────────────
  const tire = tireur(graine * 7919 + 17)
  const idx: number[] = []
  for (let i = 0; i < principale.length; i++) if (principale[i] === 1) idx.push(i)

  // 2a. Devant un mur : la distance au sommet d'en face (le vrai détour pour franchir ce mur),
  //     par CÔTÉ du mur (vu de la tuile haute : où tombe le bas) et par matière de la cible —
  //     un haut-fond perdu sous une rive n'est pas un mur qu'on contourne, c'est de l'eau qu'on regarde.
  const parCote = new Map<string, { d: number[]; perdus: number }>()
  let essais = 0
  let total2 = 0
  while (total2 < 600 && essais < 400_000) {
    essais++
    const i = idx[Math.floor(tire() * idx.length)]!
    const x = i % width
    const y = (i - x) / width
    const p = palierDuSol(map, x, y)
    const [dx, dy, cote] = VOISINS[Math.floor(tire() * 4)]!
    const vx = x + dx
    const vy = y + dy
    if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
    if (MARCHABLE[terrain[vy * width + vx]!] !== 1 || principale[vy * width + vx] !== 1) continue
    if (pas(map, p, x, y, vx, vy) !== undefined) continue
    total2++
    const q = palierDuSol(map, vx, vy)
    const haut = q > p
    const coteBas = haut ? ({ N: 'S', S: 'N', E: 'O', O: 'E' } as const)[cote] : cote
    const cible = isWater(terrain[vy * width + vx]!) || isWater(terrain[i]!) ? 'eau' : 'terre'
    const k = `${haut ? 'monter' : 'descendre'} · bas au ${coteBas} · ${cible}`
    let c = parCote.get(k)
    if (!c) { c = { d: [], perdus: 0 }; parCote.set(k, c) }
    const d = distanceEnEtages(map, x, y, p, vx, vy, 400)
    if (d === Infinity) c.perdus++
    else c.d.push(d)
  }
  console.log(`  devant un mur (${total2} échantillons) : détour pour passer de l'autre côté (BFS en étages, borne 400)`)
  for (const [k, c] of [...parCote.entries()].sort((a, b) => (b[1].d.length + b[1].perdus) - (a[1].d.length + a[1].perdus))) {
    const n = c.d.length + c.perdus
    console.log(`    ${String(n).padStart(4)}  ${k.padEnd(34)} médiane ${String(quantile(c.d, 0.5)).padStart(4)} · p90 ${String(quantile(c.d, 0.9)).padStart(4)} · > 36 tuiles (un écran) : ${(c.d.filter((d) => d > 36).length / Math.max(1, n) * 100).toFixed(0).padStart(3)} % · sans chemin : ${c.perdus}`)
  }

  // 2b. Le détour sur des trajets courts : chemin en étages / chemin à plat.
  const ratios: number[] = []
  let perdus = 0
  let n = 0
  let essais2 = 0
  while (n < 300 && essais2 < 200_000) {
    essais2++
    const i = idx[Math.floor(tire() * idx.length)]!
    const x = i % width
    const y = (i - x) / width
    const cx = x + Math.floor(tire() * 61) - 30
    const cy = y + Math.floor(tire() * 61) - 30
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue
    if (principale[cy * width + cx] !== 1) continue
    if (Math.abs(cx - x) + Math.abs(cy - y) < 10) continue
    const plat = distanceAPlat(map, x, y, cx, cy, 150)
    if (plat === Infinity) continue
    n++
    const etg = distanceEnEtages(map, x, y, palierDuSol(map, x, y), cx, cy, 600)
    if (etg === Infinity) { perdus++; continue }
    ratios.push(etg / plat)
  }
  console.log(`  trajets courts (${n}, 10-60 tuiles à plat) : détour médian ×${quantile(ratios, 0.5).toFixed(2)}, p90 ×${quantile(ratios, 0.9).toFixed(2)}, max ×${Math.max(...ratios).toFixed(1)} · > ×2 : ${(ratios.filter((r) => r > 2).length / ratios.length * 100).toFixed(0)} % · > ×3 : ${(ratios.filter((r) => r > 3).length / ratios.length * 100).toFixed(0)} % · inatteignables (< 600 pas) : ${perdus}`)

  // 2c. Les rampes : combien, et à quelle distance le long des murs.
  let rampes = 0
  for (const c of map.connecteurs ?? []) if (c.type === 'rampe' && connecteurAt(map, c.x, c.y) !== undefined) rampes++
  console.log(`  ${rampes} colonnes de rampe · ${(murs / Math.max(1, rampes)).toFixed(1)} tuiles de mur par colonne`)
}
