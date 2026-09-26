/**
 * Sonde JETABLE — ISOLER UN PIC DANS UNE FENÊTRE, SANS REJOUER LA PASSE.
 *
 * Le problème : la fenêtre profilée fait 201 ticks, et UN seul de ces ticks coûte 607 ms là où
 * les 200 autres coûtent 20 ms. Le tableau des parts noie donc le pic dans la fenêtre. Or un
 * profil d'échantillonnage ne porte pas les bornes de tick.
 *
 * L'idée : un tick ordinaire traverse ~37 passes en 20 ms, donc aucun sous-arbre n'y occupe la
 * CPU plus de quelques millisecondes d'affilée. Un pic de 607 ms passé dans une seule passe est
 * un RUN CONTIGU que rien d'ordinaire ne peut produire. On cherche donc les plus longues plages
 * contiguës de temps attribuées à une même passe — puis, dans la plus longue, on ventile.
 *
 *   node tools/__prof-bloc.mjs --carte <map> --bundle <js> <fichier.cpuprofile>
 */
import { readFileSync } from 'node:fs'
import { SourceMap } from 'node:module'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v }
const carteF = opt('--carte')
const bundleF = opt('--bundle')
const fichier = argv[0]

const carte = carteF ? new SourceMap(JSON.parse(readFileSync(carteF, 'utf8'))) : null
const lignes = bundleF ? readFileSync(bundleF, 'utf8').split('\n') : null
const colDe = (l0) => { const t = lignes?.[l0]; if (t === undefined) return 0; const m = /\S/.exec(t); return m ? m.index : 0 }
const cache = new Map()
const situer = (l0, c0) => {
  const k = `${l0}:${c0}`
  if (cache.has(k)) return cache.get(k)
  let r = null
  if (carte) { const e = carte.findEntry(l0, c0); if (e && e.originalSource !== undefined) r = `${String(e.originalSource).replace(/^.*\/(packages|tools)\//, '$1/')}:${e.originalLine + 1}` }
  cache.set(k, r)
  return r
}

const SYSTEMES = new Set(['advanceAlignment','advanceBraiseMeres','advanceBrume','advanceBuchers','advanceCendreux','advanceCombat','advanceCraft','advanceCultures','advanceDecouverte','advanceDegel','advanceDens','advanceEau','advanceEconomy','advanceEncyclopedie','advanceEnvols','advanceFire','advanceFoudre','advanceImpasse','advanceLieuxBrules','advanceMeteo','advanceMonsters','advanceMurmures','advanceNasses','advanceNightHunt','advanceNpcs','advancePois','advanceReveils','advanceSeparation','advanceSpoilage','advanceTemperature','advanceTime','advanceTorches','advanceTraction','advanceUpkeep','advanceVent','advanceVillageGrowth','advanceWorldEvents','drainEvents'])

const p = JSON.parse(readFileSync(fichier, 'utf8'))
const parId = new Map(p.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const frameDe = (id) => parId.get(id)?.callFrame
const cachePasse = new Map()
const passeDe = (id) => {
  if (cachePasse.has(id)) return cachePasse.get(id)
  const chaine = []
  let c = id
  let t = '(hors passe)'
  while (c !== undefined) {
    if (cachePasse.has(c)) { t = cachePasse.get(c); break }
    chaine.push(c)
    const nom = frameDe(c)?.functionName ?? ''
    if (SYSTEMES.has(nom)) { t = nom; break }
    c = parent.get(c)
  }
  for (const x of chaine) cachePasse.set(x, t)
  return t
}

const total = p.timeDeltas.reduce((a, b) => a + Math.max(0, b), 0)
console.log(`${fichier}\n${p.samples.length} échantillons · ${(total / 1000).toFixed(0)} ms échantillonnés\n`)

// ── les plus longues plages CONTIGUËS d'une même passe ──
const plages = []
let debut = 0
let tCum = 0
const tAt = [0]
for (let i = 0; i < p.samples.length; i++) { tCum += Math.max(0, p.timeDeltas[i] ?? 0); tAt.push(tCum) }
let courante = passeDe(p.samples[0])
for (let i = 1; i <= p.samples.length; i++) {
  const s = i < p.samples.length ? passeDe(p.samples[i]) : null
  if (s !== courante) {
    plages.push({ passe: courante, ms: (tAt[i] - tAt[debut]) / 1000, de: debut, a: i })
    debut = i
    courante = s
  }
}
plages.sort((a, b) => b.ms - a.ms)
console.log('Les 8 plus longues plages CONTIGUËS attribuées à une seule passe :')
console.log(`${'ms'.padStart(9)}   passe`)
for (const pl of plages.slice(0, 8)) console.log(`${pl.ms.toFixed(1).padStart(9)}   ${pl.passe}  (échantillons ${pl.de}..${pl.a})`)

// ── LA RÉGION DU PIC, plages de même passe FUSIONNÉES par-dessus les trous courts ──
// Un tick à 600 ms n'apparaît pas comme UNE plage contiguë : le ramasse-miettes et les cadres
// sans passe le hachent. On refusionne donc les plages d'une même passe séparées de moins de
// `TROU` ms, et c'est cette région-là qui est le pic.
const TROU = 8
const chrono = [...plages].sort((a, b) => a.de - b.de)
const fusion = []
for (const pl of chrono) {
  const d = fusion[fusion.length - 1]
  if (d && d.passe === pl.passe && (tAt[pl.de] - tAt[d.a]) / 1000 < TROU) { d.a = pl.a; d.ms = (tAt[d.a] - tAt[d.de]) / 1000 }
  else fusion.push({ ...pl })
}
fusion.sort((a, b) => b.ms - a.ms)
console.log(`\nLes 6 plus longues RÉGIONS (plages d'une même passe fusionnées sur des trous < ${TROU} ms) :`)
for (const pl of fusion.slice(0, 6)) console.log(`${pl.ms.toFixed(1).padStart(9)}   ${pl.passe}  (échantillons ${pl.de}..${pl.a})`)

// ── ventilation DANS la plus longue région qui ne soit pas mon propre surcoût ──
const gros = fusion.find((f) => f.passe !== '(hors passe)') ?? fusion[0]
console.log(`\n── DANS la plus longue plage (${gros.ms.toFixed(1)} ms, passe ${gros.passe}) : temps propre par ligne ──`)
const parLigne = new Map()
let tot = 0
for (let i = gros.de; i < gros.a; i++) {
  const id = p.samples[i]
  const dt = Math.max(0, p.timeDeltas[i] ?? 0)
  const n = parId.get(id)
  const fr = n?.callFrame
  const nom = fr?.functionName || '(anon)'
  const pts = n?.positionTicks ?? []
  if (pts.length === 0 || fr === undefined || fr.url === '') {
    const k = `${nom} «sans position»`
    parLigne.set(k, (parLigne.get(k) ?? 0) + dt)
  } else {
    let s = 0
    for (const pt of pts) s += pt.ticks
    for (const pt of pts) {
      const l0 = pt.line - 1
      const k = `${nom} › ${situer(l0, colDe(l0)) ?? `bundle:${pt.line}`}`
      parLigne.set(k, (parLigne.get(k) ?? 0) + (dt * pt.ticks) / s)
    }
  }
  tot += dt
}
console.log(`${'ms'.padStart(9)}${'part'.padStart(8)}   ligne`)
for (const [k, us] of [...parLigne.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`${(us / 1000).toFixed(1).padStart(9)}${`${((100 * us) / tot).toFixed(1)}%`.padStart(8)}   ${k}`)
}
