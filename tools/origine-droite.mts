/**
 * LA RECTITUDE DES SENTES, ET QUI L'A TRACÉE.
 *
 *   node --import tsx tools/origine-droite.mts [graine]
 *
 * Rend, pour le monde JOUÉ, la part des tuiles de route prises dans un segment axial
 * **strictement mince** de N tuiles ou plus, ventilée par ORIGINE de pose — la sortie de
 * diagnostic `origines` de `tracerLeReseau` : `trait`, `coude`, `bord`, `rampe`, `parvis`,
 * `referme`. C'est l'instrument qui a désigné `trait` (et donc écarté la fermeture, qu'on
 * soupçonnait) quand une sente s'est révélée au cordeau sur dix-sept tuiles à l'écran.
 *
 * ⚠ **UNE DROITE CONTRAINTE N'EST PAS UN DÉFAUT** : le long d'une berge ou au fond d'un couloir
 * de roche, le chemin n'a pas le choix. La sonde sépare les deux — obstacle à ≤ 4 tuiles
 * perpendiculairement, ou terrain libre. Seules les droites LIBRES accusent le tracé.
 *
 * ⚠ Elle vit ICI et non dans `/sim` : `Date`/`performance` y sont interdits, et elle imprime.
 */
import { carteDeTest } from './carte-cache'
import { BALANCE, TERRAIN_ROAD } from '../packages/sim/src/balance'
import { placeHuntingGrounds } from '../packages/sim/src/faune'
import { isWater, MARCHABLE } from '../packages/sim/src/map'
import { nidsAMonstre } from '../packages/sim/src/poi'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from '../packages/sim/src/zone-content'
import { MONDE, MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { ORIGINE_CODE, tracerLeReseau } from '../packages/sim/src/zonegen-reseau'

const seed = Number(process.argv[2] ?? 2026)
const carte = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = carte.map
const nodes = placeZoneNodes(carte)
const emp = emplacementsDeVillage(carte, nodes, { coinsDeChasse: placeHuntingGrounds(map, seed), nids: nidsAMonstre(map) })
const spawns = pointsDeSpawn(carte, emp, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE), seed)
const premier = spawns[0] ?? emp[0]!
const d2 = (a: { tx: number; ty: number }, b: { tx: number; ty: number }): number =>
  (a.tx - b.tx) * (a.tx - b.tx) + (a.ty - b.ty) * (a.ty - b.ty)
const candidats = emp.filter((e) => e.tx !== premier.tx || e.ty !== premier.ty).slice()
  .sort((a, b) => d2(a, premier) - d2(b, premier))
const margeDe = (s: readonly { tx: number; ty: number }[], i: number): number => {
  let pr = Infinity, se = Infinity
  for (let j = 0; j < s.length; j++) { if (j === i) continue
    const d = Math.sqrt(d2(s[i]!, s[j]!)); if (d < pr) { se = pr; pr = d } else if (d < se) se = d }
  return pr === Infinity || se === Infinity || pr === 0 ? 100 : ((se - pr) / pr) * 100
}
const villages = candidats.slice(0, BALANCE.VILLAGES_VEILLEE)
let prochain = BALANCE.VILLAGES_VEILLEE
while (villages.length > 2 && prochain < candidats.length && margeDe(villages, 1) <= BALANCE.MARGE_DE_CIBLE_MIN) {
  villages[1] = candidats[prochain]!; prochain++
}
const W = map.width, H = map.height, T = map.terrain
const org = new Uint8Array(W * H)
tracerLeReseau(map, carte.socle ?? null, villages, seed, org)
let h = 0x811c9dc5
for (let i = 0; i < W * H; i++) { h ^= T[i]!; h = Math.imul(h, 0x01000193) }
const NOM: Record<number, string> = { 0: '(non marqué)' }
for (const [k, v] of Object.entries(ORIGINE_CODE)) NOM[v] = k

let tot = 0
for (let i = 0; i < W * H; i++) if (T[i] === TERRAIN_ROAD) tot++
console.log(`graine ${seed} · empreinte ${(h >>> 0).toString(16)} · ${tot} tuiles de route`)
const parOrigine = new Map<number, number>()
for (let i = 0; i < W * H; i++) if (T[i] === TERRAIN_ROAD) parOrigine.set(org[i]!, (parOrigine.get(org[i]!) ?? 0) + 1)
console.log('  toutes tuiles :', [...parOrigine.entries()].sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `${NOM[k]} ${n} (${Math.round(n / tot * 100)} %)`).join(' · '))

const marque = new Uint8Array(W * H)
for (const N of [12, 16, 24, 32]) {
  marque.fill(0)
  for (let y = 0; y < H; y++) { let x = 0
    while (x < W) { if (T[y * W + x] !== TERRAIN_ROAD) { x++; continue }
      let e = x; while (e < W && T[y * W + e] === TERRAIN_ROAD) e++
      if (e - x >= N) for (let k = x; k < e; k++) {
        if ((y === 0 || T[(y - 1) * W + k] !== TERRAIN_ROAD) && (y === H - 1 || T[(y + 1) * W + k] !== TERRAIN_ROAD)) marque[y * W + k] = 1 }
      x = e } }
  for (let x = 0; x < W; x++) { let y = 0
    while (y < H) { if (T[y * W + x] !== TERRAIN_ROAD) { y++; continue }
      let e = y; while (e < H && T[e * W + x] === TERRAIN_ROAD) e++
      if (e - y >= N) for (let k = y; k < e; k++) {
        if ((x === 0 || T[k * W + x - 1] !== TERRAIN_ROAD) && (x === W - 1 || T[k * W + x + 1] !== TERRAIN_ROAD)) marque[k * W + x] = 1 }
      y = e } }
  const par = new Map<number, number>()
  let n = 0
  for (let i = 0; i < W * H; i++) if (marque[i] === 1) { n++; par.set(org[i]!, (par.get(org[i]!) ?? 0) + 1) }
  // ⚠ **UNE DROITE CONTRAINTE N'EST PAS UNE DROITE DE GÉOMÈTRE.** Le long d'une berge ou au fond
  // d'un couloir de roche, le chemin n'a PAS le choix : il est droit parce que le monde l'est.
  // On sépare donc les deux — obstacle (eau ou roche) à ≤ 4 tuiles perpendiculairement, ou pas.
  let contraint = 0
  for (let i = 0; i < W * H; i++) { if (marque[i] !== 1) continue
    const x = i % W
    // la perpendiculaire : si le voisin horizontal est route, le segment est horizontal → on
    // sonde en Y ; sinon en X.
    const horiz = (x > 0 && T[i - 1] === TERRAIN_ROAD) || (x + 1 < W && T[i + 1] === TERRAIN_ROAD)
    let bloque = false
    for (let d = 1; d <= 4 && !bloque; d++) {
      const a = horiz ? [i - d * W, i + d * W] : [i - d, i + d]
      for (const j of a) { if (j < 0 || j >= W * H) continue
        const t = T[j]!
        if (isWater(t) || MARCHABLE[t] === 0) { bloque = true; break } }
    }
    if (bloque) contraint++
  }
  console.log(`      dont CONTRAINTES (eau ou roche à ≤ 4 t) : ${contraint} (${Math.round(contraint / n * 100)} %) · libres ${n - contraint}`)
  console.log(`  ≥ ${N} t : ${n} (${Math.round(n / tot * 100)} % de la route) ·`,
    [...par.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${NOM[k]} ${c} (${Math.round(c / n * 100)} %)`).join(' · '))
}
