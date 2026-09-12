/**
 * 2c — LE COÛT D'UNE RECUISSON DU CHAMP D'EAU POUR LE SANG (reprise-eau.md §2c : « à mesurer
 * avant de promettre »). Le client recuit aujourd'hui le champ UNE fois par jour de saison
 * (`water-layer.ts` `recuireSuie` : `regimeDe` lit `eauSouillee` sur chaque tuile d'eau, puis
 * `buildWaterField` refait le champ entier, puis un upload de texture). Une souillure vit 5 min
 * et pâlit : la teinte demande une cadence en SECONDES. Combien coûte une recuisson ?
 *
 *   node --import tsx tools/mesure-recuisson-sang.mts
 */
import { attacheAuFil, cranDeSang, eauSouillee, empreinteDuSang, qualiteDeLEau, SANG, MONDE, MONDE_JOUE, createSim, generateZonedTerrain, tableDAttache, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER, type Souillure } from '../packages/sim/src/index'
import { COULEE } from '../packages/sim/src/coulee'
import { buildWaterField, REGIME_SUIE } from '../packages/client/src/render/water-field'

const carte = generateZonedTerrain(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = carte.map
const { width, height } = map
const fil = map.fil ?? []
const sim = createSim(2026, { map, nodes: [], faunaCap: 0, worldEvents: false, meteoActive: false })
let eau = 0
for (let i = 0; i < width * height; i++) if (map.terrain[i] === TERRAIN_SHALLOW_WATER || map.terrain[i] === TERRAIN_DEEP_WATER) eau++
console.log(`monde joué ${width}×${height} = ${width * height} tuiles, ${eau} d'eau, fil ${fil.length} pas`)

const ms = (quoi: string, n: number, f: () => void): number => {
  f()
  const t0 = process.cpuUsage()
  for (let k = 0; k < n; k++) f()
  const u = process.cpuUsage(t0)
  const v = (u.user + u.system) / n / 1000
  console.log(`  ${quoi.padEnd(70)} ${v.toFixed(2)} ms`)
  return v
}

// ① Le régime « naïf » : chaque tuile d'eau interroge la loi (c'est `regimeDe` aujourd'hui).
const regime = new Uint8Array(width * height)
const regimeNaif = (): void => {
  for (let ty = 0; ty < height; ty++) for (let tx = 0; tx < width; tx++) {
    const i = ty * width + tx
    const t = map.terrain[i]
    if (t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER) continue
    regime[i] = eauSouillee(sim, tx, ty) ? REGIME_SUIE : 0
  }
}
console.log('\n① regimeDe (une lecture de la loi par tuile d’eau)')
sim.souillures = []
const msVide = ms('0 souillure (porte O(1) : suie seule)', 5, regimeNaif)
const taches: Souillure[] = []
for (let k = 0; k < SANG.TACHES_MAX; k++) {
  const i = fil[(k * 7) % fil.length]!
  const x = i % width
  taches.push({ i, tick: sim.tick, crans: 4, pas: attacheAuFil(map, x, (i - x) / width), homme: true })
}
sim.souillures = taches.slice(0, 1)
const msUne = ms('1 souillure de rivière (attacheAuFil par tuile d’eau + 1 force)', 3, regimeNaif)
sim.souillures = taches
const msPlein = ms(`${SANG.TACHES_MAX} souillures (plafond)`, 3, regimeNaif)

// ② Le champ entier (ce que `recuireSuie` refait après le régime).
console.log('\n② buildWaterField (le champ entier, régime donné)')
const msChamp = ms('buildWaterField', 5, () => { buildWaterField(map.terrain, width, height, regime) })

// ③ L'alternative : peindre l'EMPREINTE de chaque souillure (la traînée le long du fil, le
//    disque en eau dormante) — O(souillures × DILUTION_PAS × lit), sans interroger chaque tuile.
console.log('\n③ l’empreinte : chaque souillure peint sa traînée, les tuiles d’eau ne sont pas interrogées')
const force = new Float32Array(width * height)
const empreinte = (): void => {
  force.fill(0)
  for (const s of sim.souillures) {
    const ox = s.i % width
    const oy = (s.i - ox) / width
    if (s.pas < 0) {
      for (let dy = -SANG.PORTEE_DORMANTE; dy <= SANG.PORTEE_DORMANTE; dy++) for (let dx = -SANG.PORTEE_DORMANTE; dx <= SANG.PORTEE_DORMANTE; dx++) {
        const tx = ox + dx, ty = oy + dy
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        const f = qualiteDeLEau(sim, tx, ty)
        if (f > force[ty * width + tx]!) force[ty * width + tx] = f
      }
      continue
    }
    for (let n = 0; n <= SANG.DILUTION_PAS; n++) {
      const p = s.pas + n
      if (p >= fil.length) break
      const i = fil[p]!
      const cx = i % width
      const cy = (i - cx) / width
      for (let dy = -COULEE.DEMI_LIT; dy <= COULEE.DEMI_LIT; dy++) for (let dx = -COULEE.DEMI_LIT; dx <= COULEE.DEMI_LIT; dx++) {
        const tx = cx + dx, ty = cy + dy
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        const j = ty * width + tx
        if (map.terrain[j] !== TERRAIN_SHALLOW_WATER && map.terrain[j] !== TERRAIN_DEEP_WATER) continue
        // La loi elle-même sur la tuile candidate : le verdict reste celui de la sim, on ne
        // fait que restreindre OÙ on la pose.
        const f = qualiteDeLEau(sim, tx, ty)
        if (f > force[j]!) force[j] = f
      }
    }
  }
}
const msEmpreinte = ms(`${SANG.TACHES_MAX} souillures, empreinte (loi lue sur ~${SANG.TACHES_MAX * (SANG.DILUTION_PAS + 1) * (2 * COULEE.DEMI_LIT + 1) ** 2} tuiles candidates)`, 3, empreinte)

console.log('\n④ le bilan (une image à 60 Hz = 16,7 ms ; l’upload de texture WebGL n’est PAS mesuré ici — il se mesure dans le navigateur)')
console.log(`   recuisson naïve au plafond : régime ${msPlein.toFixed(0)} ms + champ ${msChamp.toFixed(0)} ms = ${(msPlein + msChamp).toFixed(0)} ms — un gel visible à chaque recuisson.`)
console.log(`   recuisson naïve à 1 souillure : régime ${msUne.toFixed(0)} ms (l’attache au fil de chaque tuile d’eau est le coût, pas le nombre de souillures).`)
console.log(`   régime par empreinte au plafond : ${msEmpreinte.toFixed(1)} ms ; il reste le champ entier (${msChamp.toFixed(0)} ms) sauf à ne repeindre que le canal B des tuiles touchées.`)
console.log(`   porte O(1) (aucun sang) : ${msVide.toFixed(1)} ms — la recuisson d’aujourd’hui.`)

// ⑤ LA VOIE EXACTE ET BON MARCHÉ : la table d'attache (le pas de fil de chaque tuile d'eau —
//    la même règle qu'`attacheAuFil` : borne Chebyshev ATTACHE, plus proche point euclidien,
//    `<` strict donc le premier pas gagne à égalité), cuite UNE fois par le fil et non par la
//    tuile ; puis, à chaque recuisson, chaque souillure de rivière peint son aval pas à pas.
console.log('\n⑤ la table d’attache cuite une fois, puis l’empreinte exacte')
const pasDeLaTuile = new Int32Array(width * height).fill(-1)
const meilleure = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY)
const msTable = ms('cuisson de la table d’attache (par le fil, pas par la tuile)', 3, () => {
  pasDeLaTuile.fill(-1); meilleure.fill(Number.POSITIVE_INFINITY)
  for (let k = 0; k < fil.length; k++) {
    const i = fil[k]!
    const x = i % width
    const y = (i - x) / width
    for (let dy = -SANG.ATTACHE; dy <= SANG.ATTACHE; dy++) for (let dx = -SANG.ATTACHE; dx <= SANG.ATTACHE; dx++) {
      const tx = x + dx, ty = y + dy
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
      const j = ty * width + tx
      const d2 = dx * dx + dy * dy
      if (d2 < meilleure[j]!) { meilleure[j] = d2; pasDeLaTuile[j] = k }
    }
  }
})
// Vérité : la table rend ce que rend attacheAuFil, sur toutes les tuiles d'eau.
let faux = 0
for (let ty = 0; ty < height; ty++) for (let tx = 0; tx < width; tx++) {
  const j = ty * width + tx
  if (map.terrain[j] !== TERRAIN_SHALLOW_WATER && map.terrain[j] !== TERRAIN_DEEP_WATER) continue
  if (pasDeLaTuile[j] !== attacheAuFil(map, tx, ty)) faux++
}
console.log(`  table ≡ attacheAuFil sur les ${eau} tuiles d’eau : ${faux === 0 ? 'OUI' : faux + ' écarts'}`)
const forceExacte = new Float32Array(width * height)
const touchees: number[] = []
const empreinteExacte = (): void => {
  for (const j of touchees) forceExacte[j] = 0
  touchees.length = 0
  const tick = sim.tick
  for (const s of sim.souillures) {
    const age = tick - s.tick
    const reste = age >= SANG.TACHE_TICKS ? 0 : age <= 0 ? 1 : 1 - age / SANG.TACHE_TICKS
    if (reste <= 0) continue
    const base = Math.min(s.crans * SANG.FORCE_PAR_GOUTTE, SANG.FORCE_MAX) * reste
    const ox = s.i % width
    const oy = (s.i - ox) / width
    if (s.pas < 0) {
      for (let dy = -SANG.PORTEE_DORMANTE; dy <= SANG.PORTEE_DORMANTE; dy++) for (let dx = -SANG.PORTEE_DORMANTE; dx <= SANG.PORTEE_DORMANTE; dx++) {
        const tx = ox + dx, ty = oy + dy
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        const j = ty * width + tx
        if (map.terrain[j] !== TERRAIN_SHALLOW_WATER && map.terrain[j] !== TERRAIN_DEEP_WATER) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const f = base * ((SANG.PORTEE_DORMANTE + 1 - d) / (SANG.PORTEE_DORMANTE + 1))
        if (f > forceExacte[j]!) { if (forceExacte[j] === 0) touchees.push(j); forceExacte[j] = f }
      }
      continue
    }
    for (let n = 0; n <= SANG.DILUTION_PAS; n++) {
      const p = s.pas + n
      if (p >= fil.length) break
      const i = fil[p]!
      const cx = i % width
      const cy = (i - cx) / width
      const f = base * ((SANG.DILUTION_PAS + 1 - n) / (SANG.DILUTION_PAS + 1))
      for (let dy = -COULEE.DEMI_LIT; dy <= COULEE.DEMI_LIT; dy++) for (let dx = -COULEE.DEMI_LIT; dx <= COULEE.DEMI_LIT; dx++) {
        const tx = cx + dx, ty = cy + dy
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        const j = ty * width + tx
        if (pasDeLaTuile[j] !== p) continue // la tuile appartient à SON pas, jamais au voisin
        if (map.terrain[j] !== TERRAIN_SHALLOW_WATER && map.terrain[j] !== TERRAIN_DEEP_WATER) continue
        if (f > forceExacte[j]!) { if (forceExacte[j] === 0) touchees.push(j); forceExacte[j] = f }
      }
    }
  }
}
const msExacte = ms(`${SANG.TACHES_MAX} souillures, empreinte exacte`, 20, empreinteExacte)
// Vérité : l'empreinte exacte rend la loi, sur toutes les tuiles d'eau (sans suie).
let ecarts = 0, teintes = 0
for (let ty = 0; ty < height; ty++) for (let tx = 0; tx < width; tx++) {
  const j = ty * width + tx
  if (map.terrain[j] !== TERRAIN_SHALLOW_WATER && map.terrain[j] !== TERRAIN_DEEP_WATER) continue
  const loi = qualiteDeLEau(sim, tx, ty)
  if (loi > 0) teintes++
  if (Math.abs(loi - forceExacte[j]!) > 1e-6) ecarts++
}
console.log(`  empreinte exacte ≡ qualiteDeLEau sur les ${eau} tuiles d’eau : ${ecarts === 0 ? 'OUI' : ecarts + ' écarts'} (${teintes} tuiles teintes, ${touchees.length} touchées)`)
console.log(`  → table ${msTable.toFixed(0)} ms une fois au bake, puis ${msExacte.toFixed(2)} ms par recuisson au plafond, pour ${touchees.length} tuiles à repeindre dans le canal B.`)

// ⑥ CE QUE LE CLIENT APPELLE VRAIMENT (lot 2c livré) : les fonctions de `coulee.ts`, pas le
//    prototype ci-dessus — la garde A11 les tient identiques à la loi, ici on les chronomètre.
console.log('\n⑥ les fonctions livrées (coulee.ts : tableDAttache / empreinteDuSang / cranDeSang)')
let table: Int32Array = new Int32Array(0)
const msTableLivree = ms('tableDAttache(map)', 3, () => { table = tableDAttache(map) })
const forceLivree = new Float64Array(width * height)
const toucheesLivrees: number[] = []
const msEmpreinteLivree = ms(`empreinteDuSang, ${SANG.TACHES_MAX} souillures`, 20, () => { empreinteDuSang(sim, table, forceLivree, toucheesLivrees) })
sim.souillures = taches.slice(0, 1)
const msEmpreinteUne = ms('empreinteDuSang, 1 souillure', 50, () => { empreinteDuSang(sim, table, forceLivree, toucheesLivrees) })
sim.souillures = taches
empreinteDuSang(sim, table, forceLivree, toucheesLivrees)
const parCran = [0, 0, 0, 0, 0]
for (const j of toucheesLivrees) parCran[cranDeSang(forceLivree[j]!)]! += 1
console.log(`  → table ${msTableLivree.toFixed(1)} ms · empreinte ${msEmpreinteLivree.toFixed(2)} ms au plafond, ${msEmpreinteUne.toFixed(2)} ms pour une · ${toucheesLivrees.length} tuiles touchées, par cran 1..4 : ${parCran.slice(1).join(' / ')}`)
