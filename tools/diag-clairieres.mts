/**
 * ═══ COMBIEN GRANDES SONT LES CLAIRIÈRES — la sonde de « la forêt a l'air rasée » ═══
 *
 * Alexis, 2026-08-25 : « certaines clairières de forêts sont trop grandes, on dirait que
 * certaines parties de la forêt est rasée alors que pas du tout ».
 *
 * On MESURE la taille des trouées avant de toucher un bouton — et ce qu'elles portent, qui était
 * l'autre moitié du défaut : composantes connexes (4-voisins) du terrain de clairière, en tuiles
 * et en emprise, puis le compte de nœuds récoltables qui y poussent.
 *
 * Usage : node --import tsx tools/diag-clairieres.mts [seeds...]
 */
import { BANC_JOUEURS } from '../packages/sim/src/scenario'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_WILLOW, TERRAIN_CLAIRIERE } from '../packages/sim/src/balance'
import { placeZoneNodes } from '../packages/sim/src/zone-content'

const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite)
const SEEDS = seeds.length ? seeds : [2026, 7, 31]
const BOISE = new Set([TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_WILLOW])

for (const seed of SEEDS) {
  const c = generateZonedTerrain(seed, BANC_JOUEURS, MONDE_JOUE)
  const nodes = placeZoneNodes(c)
  const { width, height, terrain } = c.map
  const boise = new Uint8Array(width * height)
  const trouee = new Uint8Array(width * height)
  let nBoise = 0
  let nTrouee = 0
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue
      const t = terrain[i]!
      // LE DÉNOMINATEUR EST « bois + clairière » : la clairière a QUITTÉ la forêt, donc
      // « trouées / forêt » d'aujourd'hui ne se compare pas à celui d'hier si on ne la
      // remet pas au dénominateur. C'est la même surface qu'avant, découpée autrement.
      if (!BOISE.has(t) && t !== TERRAIN_CLAIRIERE) continue
      boise[i] = 1; nBoise++
      if (t === TERRAIN_CLAIRIERE) { trouee[i] = 1; nTrouee++ }
    }
  }
  // Composantes connexes des trouées (4-voisins).
  const vu = new Uint8Array(width * height)
  const tailles: { n: number; w: number; h: number; x: number; y: number }[] = []
  const pile: number[] = []
  for (let s = 0; s < width * height; s++) {
    if (!trouee[s] || vu[s]) continue
    pile.length = 0; pile.push(s); vu[s] = 1
    let n = 0, x0 = width, x1 = 0, y0 = height, y1 = 0
    while (pile.length) {
      const i = pile.pop()!
      const tx = i % width, ty = (i / width) | 0
      n++
      if (tx < x0) x0 = tx; if (tx > x1) x1 = tx
      if (ty < y0) y0 = ty; if (ty > y1) y1 = ty
      const vois = [tx > 0 ? i - 1 : -1, tx < width - 1 ? i + 1 : -1, ty > 0 ? i - width : -1, ty < height - 1 ? i + width : -1]
      for (const j of vois) if (j >= 0 && trouee[j] && !vu[j]) { vu[j] = 1; pile.push(j) }
    }
    tailles.push({ n, w: x1 - x0 + 1, h: y1 - y0 + 1, x: x0, y: y0 })
  }
  tailles.sort((a, b) => b.n - a.n)
  const total = tailles.reduce((s, t) => s + t.n, 0)
  const med = tailles.length ? tailles[Math.floor(tailles.length / 2)]!.n : 0
  console.log(`\n══ seed ${seed} — forêt de la Racine : ${nBoise} tuiles, trouées : ${nTrouee} (${(100 * nTrouee / Math.max(1, nBoise)).toFixed(1)} %)`)
  console.log(`   ${tailles.length} clairières · médiane ${med} tuiles · moyenne ${(total / Math.max(1, tailles.length)).toFixed(0)}`)
  console.log(`   les 10 plus grandes :`)
  for (const t of tailles.slice(0, 10)) {
    console.log(`     ${String(t.n).padStart(5)} tuiles · emprise ${t.w}×${t.h} · coin (${t.x},${t.y})`)
  }
  // ── CE QU'ELLES PORTENT — l'autre moitié du défaut : avant le 2026-08-25, ZÉRO. ──
  const dans: Record<string, number> = {}
  for (const n of nodes) {
    if (terrain[n.ty * width + n.tx] !== TERRAIN_CLAIRIERE) continue
    dans[n.type] = (dans[n.type] ?? 0) + 1
  }
  const nDans = Object.values(dans).reduce((a, b) => a + b, 0)
  console.log(`   récolte : ${nDans} nœuds (1 pour ${(nTrouee / Math.max(1, nDans)).toFixed(0)} tuiles) —`,
    Object.entries(dans).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ') || 'RIEN')

  // Part des tuiles de trouée qui vivent dans une clairière ≥ N tuiles de large.
  for (const seuil of [20, 30, 40, 60]) {
    const p = tailles.filter((t) => Math.max(t.w, t.h) >= seuil).reduce((s, t) => s + t.n, 0)
    console.log(`   part des trouées dans une clairière de ≥ ${seuil} tuiles de côté : ${(100 * p / Math.max(1, total)).toFixed(0)} %`)
  }
}
