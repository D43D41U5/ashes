/**
 * Sonde JETABLE — LIRE LES SÉRIES PAR TICK DE `__profil-villageois.mts` ET LES SOUSTRAIRE.
 *
 * Le témoin (0 village) porte tout ce que le villageois ne peut pas avoir causé. On donne donc,
 * par RÉGIME : la moyenne, la pire seconde (20 ticks glissants), le pire tick — et l'écart.
 *
 *   node tools/__serie-lire.mjs <serie-A.json> [serie-témoin.json]
 */
import { readFileSync } from 'node:fs'

const lire = (f) => JSON.parse(readFileSync(f, 'utf8'))
const A = lire(process.argv[2])
const B = process.argv[3] ? lire(process.argv[3]) : null
const ROD = 500

const regimes = (s) => {
  const n = s.nuitDes
  return [
    // LE RÉGIME DU CHIFFRE DE RÉFÉRENCE : « 1,36 ms/villageois » vient de `profil-tick 50 500`,
    // donc des 500 PREMIERS ticks — amorçage du village et rodage du JIT compris. On le rejoue
    // tel quel pour pouvoir dire ce qui, dans l'écart, est le `tsx` et ce qui est la fenêtre.
    ['RÉFÉRENCE (ticks 0..500)', 0, 500],
    ['JOUR  (aube→crépuscule)', ROD, n],
    ['AUBE  (1er dixième du jour)', ROD, ROD + Math.floor((n - ROD) / 10)],
    ['MIDI  (milieu du jour)', Math.floor(n * 0.45), Math.floor(n * 0.55)],
    ['CRÉPUSCULE (±600 ticks)', n - 600, n + 600],
    ['NUIT  (crépuscule→fin)', n, s.ticks],
    ['CŒUR DE NUIT (milieu)', n + Math.floor((s.ticks - n) * 0.45), n + Math.floor((s.ticks - n) * 0.55)],
    ['TOUT (hors rodage)', ROD, s.ticks],
  ]
}

const moy = (serie, a, b) => {
  let s = 0
  for (let i = a; i < b; i++) s += serie[i]
  return s / (b - a)
}
const pireSeconde = (serie, a, b) => {
  let pire = -1
  let ou = a
  for (let i = a; i + 20 <= b; i++) {
    let s = 0
    for (let k = 0; k < 20; k++) s += serie[i + k]
    if (s > pire) { pire = s; ou = i }
  }
  return { ms: pire / 20, ou }
}
const pireTick = (serie, a, b) => {
  let p = a
  for (let i = a; i < b; i++) if (serie[i] > serie[p]) p = i
  return { ms: serie[p], ou: p }
}

const pnjDe = (s, a, b) => {
  const dans = s.journal.filter((j) => j.tick > a && j.tick <= b)
  if (dans.length === 0) return 0
  return dans.reduce((acc, j) => acc + j.pnj, 0) / dans.length
}

console.log(`A = ${A.villages} villages (${A.ticks} ticks, nuit dès ${A.nuitDes})`)
if (B) console.log(`B = ${B.villages} villages — TÉMOIN INERTE (${B.ticks} ticks, nuit dès ${B.nuitDes})`)
console.log()
const t = (x, n = 2) => x.toFixed(n).padStart(8)
console.log(
  `${'régime'.padEnd(28)}${'A moy'.padStart(8)}${'B moy'.padStart(8)}${'Δ'.padStart(8)}${'PNJ'.padStart(6)}${'Δ/PNJ'.padStart(8)}` +
    `   │${'A pire s'.padStart(9)}${'B pire s'.padStart(9)}${'Δ pire s'.padStart(9)}${'/PNJ'.padStart(7)}   (tick)`,
)
for (const [nom, a, b] of regimes(A)) {
  if (b <= a || b > A.ticks) continue
  const ma = moy(A.serie, a, b)
  const mb = B ? moy(B.serie, a, b) : 0
  const pa = pireSeconde(A.serie, a, b)
  const pb = B ? pireSeconde(B.serie, a, b) : { ms: 0, ou: 0 }
  const pnj = pnjDe(A, a, b) || 15
  console.log(
    `${nom.padEnd(28)}${t(ma)}${t(mb)}${t(ma - mb)}${pnj.toFixed(1).padStart(6)}${t((ma - mb) / pnj, 3)}` +
      `   │${t(pa.ms)}${t(pb.ms)}${t(pa.ms - pb.ms)}${t((pa.ms - pb.ms) / pnj, 3)}   ${pa.ou}`,
  )
}
console.log()
for (const s of [A, B].filter(Boolean)) {
  const pt = pireTick(s.serie, ROD, s.ticks)
  const ps = pireSeconde(s.serie, ROD, s.ticks)
  console.log(
    `${s.villages} villages : pire TICK ${pt.ms.toFixed(1)} ms au ${pt.ou} (${pt.ou < s.nuitDes ? 'jour' : 'NUIT'})` +
      ` · pire SECONDE ${ps.ms.toFixed(2)} ms/tick aux ticks ${ps.ou}..${ps.ou + 19} (${ps.ou < s.nuitDes ? 'jour' : 'NUIT'})` +
      ` · budget 50 ms : moyenne ${((moy(s.serie, ROD, s.ticks) / 50) * 100).toFixed(1)} %, pire seconde ${((ps.ms / 50) * 100).toFixed(1)} %`,
  )
}

// La tranche la plus chère de chaque run, pour savoir QUEL `.cpuprofile` ouvrir.
for (const s of [A, B].filter(Boolean)) {
  const top = [...s.journal].sort((x, y) => y.ms - x.ms).slice(0, 5)
  console.log(`\n${s.villages} villages — les 5 tranches les plus chères (le .cpuprofile à ouvrir) :`)
  for (const j of top) console.log(`  t${String(j.tick).padStart(6, '0')} : ${j.ms.toFixed(2)} ms/tick · ${j.h} h ${j.nuit ? 'NUIT' : 'jour'} · pnj ${j.pnj} dorment ${j.dorment} sansChemin ${j.sansChemin} · monstres ${j.monstres} corps ${j.corps}`)
}
