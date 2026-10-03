/**
 * ═══ CE QUE COÛTE LA CUISSON DU GEL QUAND LE JOUEUR BÂTIT — balayage sur N structures ═══
 *
 * ⚠ **POURQUOI CET INSTRUMENT EXISTE.** `estGele` → `baselineTemperature` → `isSheltered`, qui
 * fait DEUX balayages LINÉAIRES de `state.structures` par tuile (`roofAt`, puis un `.some` pour
 * la maison). Le coût d'une cuisson est donc en O(tuiles × structures), et le monde joué porte
 * **0 structure à sa naissance** (MESURÉ le 2026-10-02 — les 814 d'avant étaient celles des
 * villages PNJ, parties le 2026-09-29). Autrement dit : les chiffres du banc **sont** ceux du
 * début de partie, et tout le reste dépend de ce que le JOUEUR bâtit. Comme les balises ne sont
 * pas construites (étape 4+ de `braise.md` § 3), le N d'une base de fin de partie est inconnu —
 * on rend donc une COURBE, et le N auquel elle franchit le budget d'une image.
 *
 * ⚠ **CE QU'ON MESURE EST LA RAFALE, PAS LE RÉGIME, et la différence est dans le client.**
 * `gel-layer.ts` : les chunks visibles qui MANQUENT naissent **tous dans la même image** (phase ①,
 * aucun budget), alors que la relecture périodique est plafonnée à `SIGNATURES_PAR_FRAME` = 1
 * chunk par image. Le régime établi est donc négligeable ; ce qui se voit est l'écran recuit d'un
 * coup — téléportation, premier chargement, caméra qui saute.
 *
 * `node_modules/.pnpm/node_modules/.bin/esbuild --bundle tools/profil-gel-structures.mts \
 *    --format=esm --platform=node --outfile=tools/__gs.mjs && node tools/__gs.mjs`
 * (⚠ la sortie doit rester SOUS `tools/` : `carteDeTest` cherche `packages/sim/src` en relatif.)
 */
import { createSim } from '../packages/sim/src/sim'
import { carteDeTest } from './carte-cache'
import { MONDE, MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { estGele } from '../packages/sim/src/gel'
import { foyersDeLaCarte } from '../packages/sim/src/cendre'
import { palierDuSol } from '../packages/sim/src/etages'
import { terrainAt } from '../packages/sim/src/map'
import { TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER } from '../packages/sim/src/balance'
import { TICKS_PER_SEASON_DAY, TICKS_PER_CYCLE, dayTicksPourJour, jourDeSaison } from '../packages/sim/src/time'
import type { Structure } from '../packages/sim/src/village'

/** La géométrie de la couche du client, reprise telle quelle (`gel-layer.ts`). */
const CHUNK = 16, TILE_PX = 16, COURONNE = 1
const ECRAN = { w: 1920, h: 1080 }
const IMAGE_120 = 1000 / 120

const m = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
// ⚠ LE TÉMOIN DU `souffleMax` PAR PALIER (2026-10-02) : `ASHES_SANS_SOUFFLEMAX=1` retire le champ
//   de la carte et l'on retombe sur le majorant GLOBAL de 12,6 °C — le code d'avant ce jour-là,
//   au bit près (c'est le repli de sauvegarde). C'est l'A/B qui ATTRIBUE le gain au champ plutôt
//   qu'à la saison : sans lui, « 5,7 ms au jour 65 » pourrait n'être qu'un jour plus froid.
if (process.env.ASHES_SANS_SOUFFLEMAX === '1') {
  delete (m.map as { souffleMax?: number[] }).souffleMax
  console.log('⚠ TÉMOIN : `souffleMax` RETIRÉ — majorant global de 12,6 °C (le code d\'avant le 02/10).')
}
const sim = createSim(2026, { map: m.map, calendarScale: 1, meteoActive: false })
console.log(`structures du monde joué à la naissance : ${sim.structures.length} (les balises n'existent pas encore)`)

/** LES TUILES D'UN ÉCRAN autour d'un centre — un chunk porte 18 × 18 états (bord compris). */
function ecranAutour(ctx: number, cty: number): { eau: number[]; chunks: number } {
  const cX = Math.ceil(ECRAN.w / (CHUNK * TILE_PX)) + 1 + 2 * COURONNE
  const cY = Math.ceil(ECRAN.h / (CHUNK * TILE_PX)) + 1 + 2 * COURONNE
  const cx0 = Math.max(0, Math.floor(ctx / CHUNK) - Math.floor(cX / 2))
  const cy0 = Math.max(0, Math.floor(cty / CHUNK) - Math.floor(cY / 2))
  const eau: number[] = []
  let chunks = 0
  for (let cy = cy0; cy < cy0 + cY; cy++) for (let cx = cx0; cx < cx0 + cX; cx++) {
    chunks++
    for (let y = cy * CHUNK - 1; y < (cy + 1) * CHUNK + 1; y++) for (let x = cx * CHUNK - 1; x < (cx + 1) * CHUNK + 1; x++) {
      if (x < 0 || y < 0 || x >= m.map.width || y >= m.map.height) continue
      const t = terrainAt(m.map, x, y)
      if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) eau.push(y * m.map.width + x)
    }
  }
  return { eau, chunks }
}

/**
 * L'ÉCRAN LE PLUS CHARGÉ D'EAU de ce palier — **et pas le barycentre**.
 *
 * ⚠ Un premier jet visait le barycentre de l'eau du palier, ce qui est un contresens : « est-ce
 * que ça se voit » se répond sur le PIRE écran, pas sur un écran moyen, et le barycentre tombe
 * volontiers sur la terre entre deux lacs. MESURÉ le 2026-10-02 : le barycentre du palier 0 porte
 * **627** tuiles d'eau quand l'écran de la naissance en porte **2 998** — un facteur cinq sur la
 * réponse. On balaie donc la carte par pas d'un chunk et l'on garde le maximum.
 */
function centreDeLEau(palier: number): { tx: number; ty: number } {
  // La somme-préfixe de l'eau de CE palier : un balayage, puis chaque fenêtre en quatre lectures.
  const W = m.map.width, H = m.map.height
  const S = new Int32Array((W + 1) * (H + 1))
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const t = terrainAt(m.map, tx, ty)
    const eau = (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) && palierDuSol(m.map, tx, ty) === palier ? 1 : 0
    S[(ty + 1) * (W + 1) + tx + 1] = eau + S[ty * (W + 1) + tx + 1] + S[(ty + 1) * (W + 1) + tx] - S[ty * (W + 1) + tx]
  }
  const somme = (x0: number, y0: number, x1: number, y1: number): number =>
    S[y1 * (W + 1) + x1]! - S[y0 * (W + 1) + x1]! - S[y1 * (W + 1) + x0]! + S[y0 * (W + 1) + x0]!
  const tw = Math.ceil(ECRAN.w / TILE_PX), th = Math.ceil(ECRAN.h / TILE_PX)
  let best = -1, bx = Math.floor(W / 2), by = Math.floor(H / 2)
  for (let y = 0; y + th <= H; y += CHUNK) for (let x = 0; x + tw <= W; x += CHUNK) {
    const n = somme(x, y, x + tw, y + th)
    if (n > best) { best = n; bx = x + Math.floor(tw / 2); by = y + Math.floor(th / 2) }
  }
  return { tx: bx, ty: by }
}

/** Des structures POSÉES AUTOUR DU CENTRE, comme une base l'est — pas dispersées sur la carte :
 *  `isSheltered` balaie la liste ENTIÈRE quelle que soit la distance, donc le placement ne change
 *  pas le coût, mais une base groupée est ce qu'un joueur bâtit et ce que la garde doit refléter. */
function basesDe(n: number, ou: { tx: number; ty: number }): Structure[] {
  const out: Structure[] = []
  const cote = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) {
    out.push({ id: i + 1, type: 'wall', tx: ou.tx - Math.floor(cote / 2) + (i % cote), ty: ou.ty - Math.floor(cote / 2) + Math.floor(i / cote), hp: 100, villageId: 0 } as Structure)
  }
  return out
}

function tickAu(jour: number, nuit = false): number {
  const t0 = (jour - 1) * TICKS_PER_SEASON_DAY + TICKS_PER_CYCLE
  const cs = t0 - (((t0 + sim.cycleOffset) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
  const d = dayTicksPourJour(jour)
  const t = cs + (nuit ? d + Math.floor((TICKS_PER_CYCLE - d) / 2) : Math.floor(d / 2))
  if (jourDeSaison(sim, t) !== jour) throw new Error(`jour ${jour} introuvable`)
  return t
}

const N = [0, 10, 25, 50, 100, 200, 400, 800]
// LES INSTANTS QUI SE JOUENT VRAIMENT (le monde ouvre au jour 61, la cendre s'éveille au 91) :
// le cœur des Pluies de l'an 1 (borne SERRÉE) et le même jour de l'an 2 (borne ÉLARGIE).
//
// ⚠ LE TROISIÈME EST CELUI QUE LE `souffleMax` PAR PALIER A GAGNÉ (2026-10-02). Le champ situe le
//   majorant du souffle (12,6 → 8,09 °C au palier 0) et rend à la porte 126 points de l'année sur
//   480 au lieu de 74 : le jour 65 à midi en fait partie, le jour 75 non. Les deux sont donc ici,
//   et c'est délibéré — l'un montre le gain, l'autre montre qu'il est PARTIEL.
const AGES = foyersDeLaCarte(m.map).map(() => 120)
const INSTANTS = [
  { nom: 'Pluies an 1 (borne serrée)', jour: 75, ages: [] as number[] },
  { nom: 'Pluies an 2 (borne élargie)', jour: 75, ages: AGES },
  { nom: 'début des Pluies an 2, jour 65 — RENDU par le souffleMax par palier', jour: 65, ages: AGES },
  // ⚠ LE CŒUR DE NUIT : le PIRE instant, et c'est pour ça qu'il est là. Aucune des deux bornes ne
  //   coupe alors en bas (l'écart de nuit descend l'air de lui-même sous le seuil), donc c'est le
  //   cas où la cuisson paie tout — et où la croissance en N se voit sans rien pour l'amortir.
  { nom: 'NUIT de mi-Pluies an 2 — aucune borne ne coupe', jour: 75, nuit: true, ages: AGES },
]

for (const palier of [0, 3]) {
  const ou = centreDeLEau(palier)
  const { eau, chunks } = ecranAutour(ou.tx, ou.ty)
  console.log(`\n╔══ LE PIRE ÉCRAN DU PALIER ${palier} (centre ${ou.tx},${ou.ty}) — ${chunks} chunks, ${eau.length} tuiles d'eau ══`)
  for (const inst of INSTANTS) {
    sim.tick = tickAu(inst.jour, (inst as { nuit?: boolean }).nuit ?? false)
    sim.cendreAge = [...inst.ages]
    console.log(`║ ── ${inst.nom} ──`)
    // ⚠ **LES N S'ENTRELACENT, ILS NE SE SUIVENT PAS.** Mesurés l'un après l'autre, le premier N
    //   porte le JIT et les suivants profitent de sa chauffe : le 2026-10-02, un premier jet a
    //   rendu 3,97 ms à 0 structure et 0,32 ms à 800 — le coût DÉCROISSANT avec le travail, ce qui
    //   est impossible. C'est le même piège de callee froid qui avait fait croire à une régression
    //   ×3,4 le matin. On tourne donc en ROUND-ROBIN, après une chauffe longue, et on lit la médiane.
    const bancs = N.map((n) => ({ n, structures: basesDe(n, ou), ms: [] as number[], prises: 0 }))
    const cuire = (): number => { let k = 0; for (const i of eau) if (estGele(sim, i % m.map.width, Math.floor(i / m.map.width))) k++; return k }
    for (const b of bancs) { sim.structures = b.structures; for (let w = 0; w < 40; w++) b.prises = cuire() }
    for (let r = 0; r < 15; r++) for (const b of bancs) {
      sim.structures = b.structures
      const c = process.cpuUsage(); cuire(); const d = process.cpuUsage(c)
      b.ms.push((d.user + d.system) / 1000)
    }
    for (const b of bancs) {
      b.ms.sort((x, y) => x - y)
      const med = b.ms[7]!
      console.log(`║   ${String(b.n).padStart(3)} structures : ${med.toFixed(2)} ms  (${(med / IMAGE_120).toFixed(1)} image à 120 fps) · ${b.prises}/${eau.length} prises`)
    }
  }
  console.log('╚══')
}
console.log(`\nUne image à 120 fps vaut ${IMAGE_120.toFixed(2)} ms. ⚠ Rafale (écran recuit d'un coup), PAS régime : la relecture périodique du client est plafonnée à 1 chunk par image.`)
