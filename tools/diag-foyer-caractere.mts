/**
 * DIAG — LE CARACTÈRE D'UN FOYER MORD-IL VRAIMENT ? (spec `cendre.md` R21)
 *
 * Une table de multiplicateurs peut être juste et n'avoir aucun effet sur le monde joué (mémoire :
 * « une loi livrée sans appelant »). Cet instrument relève les trois cadrans qui se voient, sur la
 * carte de production, foyer par foyer :
 *
 *   • `morts`      — la densité moyenne du champ des morts SUR la cendre de chaque fosse
 *   • `fumerolles` — combien de bouches chaque fosse a ouvertes
 *   • `sel`        — le stock que ces bouches portent
 *
 * Ce qui ferait rougir la livraison : deux fosses de caractères opposés rendant le même nombre.
 *
 *     node --import tsx tools/diag-foyer-caractere.mts [seed] [jour]
 */
import { generateZonedTerrain, MONDE, MONDE_JOUE, BALANCE } from '../packages/sim/src/index'
import {
  CENDRE, avanceesDepuisAges, caracteresDeLaCarte, estCendre, foyerDeLaTuile, foyersDeLaCarte,
} from '../packages/sim/src/cendre'
import { FUMEROLLE, ouvrirLesFumerolles, toutesLesFumerolles } from '../packages/sim/src/fumerolle'
import { densiteDesMorts } from '../packages/sim/src/morts'
import type { SimState } from '../packages/sim/src/sim'
import type { ResourceNode } from '../packages/sim/src/economy'

const seed = Number(process.argv[2] ?? 2026)
const jour = Number(process.argv[3] ?? 600)
const monde = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const caracteres = caracteresDeLaCarte(map, seed)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
const ages = foyers.map(() => Math.max(0, jour - REVEIL))
const av = avanceesDepuisAges(ages, foyers.length)

// Le minimum que `densiteDesMorts` lit — carte, tick, graine, âges, et la liste des lieux brûlés.
const state = { map, tick: 0, seed, cendreAge: ages, lieuxBrules: [] } as unknown as SimState

const somme = new Array(foyers.length).fill(0)
const compte = new Array(foyers.length).fill(0)
for (let ty = 0; ty < map.height; ty += 3) {
  for (let tx = 0; tx < map.width; tx += 3) {
    if (!estCendre(map, tx, ty, av, seed)) continue
    const k = foyerDeLaTuile(map, tx, ty)
    if (k < 0) continue
    somme[k] += densiteDesMorts(state, tx, ty)
    compte[k] += 1
  }
}

const bouches = new Array(foyers.length).fill(0)
const toutes = toutesLesFumerolles(map, av, seed)
for (const b of toutes) {
  const k = foyerDeLaTuile(map, b.tx, b.ty)
  if (k >= 0) bouches[k] += 1
}
const nodes: ResourceNode[] = []
ouvrirLesFumerolles(nodes, map, av, seed, FUMEROLLE.SEL_STOCK)
const stock = new Array(foyers.length).fill(0)
for (const n of nodes) {
  const k = foyerDeLaTuile(map, n.tx, n.ty)
  if (k >= 0) stock[k] += n.stock
}

console.log(`TOTAL BOUCHES (le VRAI chemin, toutesLesFumerolles) : ${toutes.length}`)
console.log(`seed ${seed} · jour ${jour} · ${foyers.length} fosses · PART ${FUMEROLLE.PART} · SEL_STOCK ${FUMEROLLE.SEL_STOCK}\n`)
console.log(' fosse | caractère |  tuiles cendrées | champ des morts | bouches | sel total')
for (let k = 0; k < foyers.length; k++) {
  const d = compte[k] === 0 ? 0 : somme[k] / compte[k]
  console.log(
    `   ${String(k).padStart(2)}  | ${(caracteres[k] ?? '—').padEnd(9)} | ${String(compte[k]).padStart(16)}` +
    ` | ${d.toFixed(4).padStart(15)} | ${String(bouches[k]).padStart(7)} | ${String(stock[k]).padStart(9)}`,
  )
}
