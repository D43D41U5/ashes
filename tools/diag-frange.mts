/**
 * DIAG FRANGE — les ARÊTES DROITES de la lisière de cendre (spec `cendre.md` R6).
 *
 * « La cendre s'étend mal » ne se juge pas à l'œil sur une capture : il faut un nombre. Celui-ci
 * est **la plus longue portion de lisière parfaitement rectiligne**, en tuiles, et le compte de
 * celles qui atteignent huit. Un mur de quarante tuiles se lit comme un artefact de rendu ; une
 * arête de dix ne se voit pas.
 *
 * ⚠ **ON NE COMPTE QUE LES VRAIES FRONTIÈRES DE FRONT.** Une tuile hors d'atteinte (eau, vide) est
 * exclue des deux côtés : le bord d'un lac est droit sur trente tuiles et n'a rien à voir avec le
 * grain. Sans ce filtre, l'instrument accuse le relief — les plus longues « arêtes » mesurées
 * tombaient à `x % 8 ≠ 0`, donc hors de la grille du grain, ce qui l'a trahi.
 *
 * Il joue le vrai worldgen et le vrai champ de coût, et sait rejouer la MÊME carte sous un AUTRE
 * réglage de déplacement — le champ ne dépend pas du grain, une seule génération suffit.
 *
 *     node --import tsx tools/diag-frange.mts [seed]
 *     node --import tsx tools/diag-frange.mts 2026 --compare 0,22
 *         └─ confronte le réglage courant à un autre (amplitude,échelle) ; `0` = le grain d'avant
 */
import {
  generateZonedTerrain, MONDE, MONDE_JOUE,
} from '../packages/sim/src/index'
import { CENDRE, avanceesDepuisAges, coutDe, foyerDe, foyersDeLaCarte } from '../packages/sim/src/cendre'
import { fbm2 } from '../packages/sim/src/noise'

const args = process.argv.slice(2)
const seed = Number(args.find((a) => !a.startsWith('--')) ?? 2026)
const compare = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null
const AUTRE = compare ? compare.split(',').map(Number) : null

const map = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
const foyers = foyersDeLaCarte(map)
const W = map.width
const H = map.height
const M = CENDRE.MOTIF
/** Le seuil au-delà duquel une arête droite se LIT comme une ligne, en tuiles. */
const MUR = 8

/** `grainDeCendre`, mais avec son déplacement libre — pour comparer deux réglages sur une carte. */
function grain(tx: number, ty: number, amp: number, ech: number): number {
  let sx = tx
  let sy = ty
  if (amp > 0) {
    const selW = (seed ^ 0x57415250) | 0
    sx = tx + amp * 2 * (fbm2(tx, ty, ech, selW) - 0.5)
    sy = ty + amp * 2 * (fbm2(tx, ty, ech, (selW ^ 0x2f3b) | 0) - 0.5)
  }
  const bx = Math.floor(sx / M) * M + M / 2
  const by = Math.floor(sy / M) * M + M / 2
  const sel = (seed ^ 0x43454e44) | 0
  const large = fbm2(bx, by, CENDRE.WARP_ECHELLE, sel) - 0.5
  const fine = fbm2(bx, by, CENDRE.WARP_ECHELLE / 4, (sel ^ 0x9e37) | 0) - 0.5
  return (large * 0.75 + fine * 0.25) * 2 * CENDRE.WARP_PART
}

interface Releve { max: number; murs: number; part: number }

function releve(age: number, amp: number, ech: number): Releve {
  const av = avanceesDepuisAges(foyers.map(() => age), foyers.length)
  const cendre = new Uint8Array(W * H)
  const joignable = new Uint8Array(W * H)
  let prises = 0
  let total = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const c = coutDe(map.cendreCout, i)
      if (c < 0) continue
      joignable[i] = 1
      total++
      const a = av[foyerDe(map.cendreCout, i)] ?? 0
      if (c <= a * CENDRE.ORTHO * (1 + grain(x, y, amp, ech))) { cendre[i] = 1; prises++ }
    }
  }
  let max = 0
  let murs = 0
  // Une arête est un couple de tuiles JOIGNABLES qui ne sont pas du même côté du front.
  const balayer = (vertical: boolean): void => {
    for (let u = 1; u < (vertical ? W : H); u++) {
      let run = 0
      for (let v = 0; v < (vertical ? H : W); v++) {
        const i1 = vertical ? v * W + u - 1 : (u - 1) * W + v
        const i2 = vertical ? v * W + u : u * W + v
        if (joignable[i1] === 1 && joignable[i2] === 1 && cendre[i1] !== cendre[i2]) {
          run++
          if (run > max) max = run
        } else {
          if (run >= MUR) murs++
          run = 0
        }
      }
      if (run >= MUR) murs++
    }
  }
  balayer(true)
  balayer(false)
  return { max, murs, part: total > 0 ? prises / total : 0 }
}

const REVEIL = 91
const AGES = [30, 60, 90, 150, 210, 300]
const ligne = (nom: string, r: Releve): string =>
  `${nom.padEnd(22)} ${String(r.max).padStart(8)} ${String(r.murs).padStart(9)}   ${(100 * r.part).toFixed(2).padStart(6)} %`

console.log(`\n═══ seed ${seed} · ${W}×${H} · ${foyers.length} fosses · réveil jour ${REVEIL} ═══`)
console.log(`réglage courant : déplacement ${CENDRE.BLOC_AMPLITUDE} tuiles, échelle ${CENDRE.BLOC_ECHELLE}`)
console.log(`\njour   réglage                arête max  murs ≥ ${MUR}   part cendrée`)
for (const age of AGES) {
  console.log(ligne(`${String(REVEIL + age).padEnd(6)} courant`, releve(age, CENDRE.BLOC_AMPLITUDE, CENDRE.BLOC_ECHELLE)))
  if (AUTRE) console.log(ligne(`       ${AUTRE[0]} / ${AUTRE[1]}`, releve(age, AUTRE[0]!, AUTRE[1]!)))
}
console.log()
