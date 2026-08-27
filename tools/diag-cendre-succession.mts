/**
 * SONDE — l'ÂGE de la cendre est-il un axe utilisable ? (proposition ① : la succession)
 *
 * Deux questions, et une seule décide :
 *   ① LARGEUR D'ANNEAU — un seuil posé en JOURS donne-t-il encore une bande VISIBLE en fin de
 *      partie ? La loi est une racine : la frange ralentit (1,5 t/j au réveil, 0,10 à l'an 10),
 *      donc « les 30 derniers jours » désignent une bande de plus en plus MINCE. Ce qui ferait
 *      rougir la proposition : une bande sous ~2 tuiles, invisible à l'écran.
 *   ② PART PAR FOYER — les dix fosses se partagent-elles la cendre, ou une seule avale tout ?
 *      (proposition ② : un caractère par foyer). Sous ~3 % la variété d'un foyer est décorative.
 *
 * On relève aussi la corrélation âge ↔ profondeur : si l'âge n'est qu'une reparamétrisation de
 * `profondeurDeCendre`, il faut le DIRE — ce n'est pas un axe neuf, c'est une autre échelle.
 *
 *     node --import tsx tools/diag-cendre-succession.mts [seed]
 */
import { generateZonedTerrain, MONDE, MONDE_JOUE, BALANCE } from '../packages/sim/src/index'
import {
  CENDRE, foyersDeLaCarte, estCendre, ancienneteDeCendre, avanceeDeCendre, avanceesDepuisAges,
  profondeurDeCendre, foyerDe,
} from '../packages/sim/src/cendre'

const seed = Number(process.argv[2] ?? 2026)
const monde = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
const PAS = 2

console.log(`seed ${seed} · ${foyers.length} foyers · réveil jour ${REVEIL}`)

/** ① LARGEUR D'ANNEAU — pour un seuil en jours, l'épaisseur en TUILES de la bande au front. */
console.log('\n═══ ① Un seuil en JOURS, combien de TUILES de large ? ═══')
console.log('   (largeur = avancée(t) − avancée(t − seuil), en tuiles de cheminement vivant)')
console.log('  jour |  vitesse |   5 j |  15 j |  30 j |  60 j |  90 j | 180 j | 360 j')
for (const j of [92, 120, 180, 240, 360, 600, 900, 1200]) {
  const t = Math.max(0, j - REVEIL)
  const v = avanceeDeCendre(t + 1) - avanceeDeCendre(t)
  const larg = [5, 15, 30, 60, 90, 180, 360].map((s) =>
    (avanceeDeCendre(t) - avanceeDeCendre(Math.max(0, t - s))).toFixed(1).padStart(6))
  console.log(`  ${String(j).padStart(4)} | ${v.toFixed(3).padStart(8)} |${larg.join(' |')}`)
}
console.log('  ⚠ sur la ROCHE, diviser par COUT_MINERAL =', CENDRE.COUT_MINERAL)

/** ② PART PAR FOYER + corrélation âge/profondeur. */
console.log('\n═══ ② Les dix fosses se partagent-elles la cendre ? ═══')
for (const j of [240, 600, 1200]) {
  const t = Math.max(0, j - REVEIL)
  // ⚠ DEUX RÉGIMES. À foyers SYNCHRONES, âge et profondeur sont monotones dans la même quantité
  // par construction : la corrélation serait garantie et ne prouverait rien. Le monde JOUÉ les
  // désynchronise volontairement (R16 gèle un foyer 15 jours, R18 le module par saison) — c'est
  // la raison d'être de `SimState.cendreAge`. On relève donc les deux.
  const ages = foyers.map(() => t)
  const decales = foyers.map((_, i) => Math.max(0, t - i * 20))
  const av = avanceesDepuisAges(ages, foyers.length)
  const parFoyer = new Array(foyers.length).fill(0)
  let cendre = 0
  const ech: { a: number; p: number }[] = []
  const echD: { a: number; p: number }[] = []
  const avD = avanceesDepuisAges(decales, foyers.length)
  for (let ty = 0; ty < map.height; ty += PAS) for (let tx = 0; tx < map.width; tx += PAS) {
    if (!estCendre(map, tx, ty, av, seed)) continue
    cendre += 1
    const f = foyerDe(map.cendreCout, ty * map.width + tx)
    if (f >= 0 && f < parFoyer.length) parFoyer[f] += 1
    if (ech.length < 4000 && (tx + ty) % 40 === 0) {
      ech.push({ a: ancienneteDeCendre(map, tx, ty, ages, seed), p: profondeurDeCendre(map, tx, ty, av, seed) })
    }
    if (echD.length < 4000 && (tx + ty) % 40 === 0 && estCendre(map, tx, ty, avD, seed)) {
      echD.push({ a: ancienneteDeCendre(map, tx, ty, decales, seed), p: profondeurDeCendre(map, tx, ty, avD, seed) })
    }
  }
  const parts = parFoyer.map((n) => (100 * n / Math.max(1, cendre))).sort((a, b) => b - a)
  console.log(`  jour ${j} — ${cendre} tuiles échantillonnées · parts : ` +
    parts.map((p) => p.toFixed(1) + '%').join(' · '))
  const concord = (e: { a: number; p: number }[]): string => {
    let n = 0, d = 0
    for (let i = 0; i + 7 < e.length; i += 7) {
      const A = e[i]!, B = e[i + 7]!
      if (A.a === B.a || A.p === B.p) continue
      n += 1
      if ((A.a > B.a) !== (A.p > B.p)) d += 1
    }
    return `${n} paires, ${d} discordantes (${(100 * d / Math.max(1, n)).toFixed(2)} %)`
  }
  console.log(`           âge vs profondeur — foyers SYNCHRONES : ${concord(ech)}`)
  console.log(`                             — foyers DÉCALÉS (0..${(foyers.length - 1) * 20} j) : ${concord(echD)}`)
}

/** ③ DES BANDES EN PROFONDEUR — largeur stable par construction. Qu'est-ce qu'elles pèsent ? */
console.log('\n═══ ③ Si les bandes se comptent en PROFONDEUR (tuiles), que pèse chacune ? ═══')
const SEUILS = [3, 15, 40]
console.log('  jour | avancée |  frange ≤3 | 3-15 | 15-40 |  > 40  |  âge médian du >40')
for (const j of [61, 92, 120, 180, 240, 360, 600, 1200]) {
  const t = Math.max(0, j - REVEIL)
  const ages = foyers.map(() => t)
  const av = avanceesDepuisAges(ages, foyers.length)
  const c = [0, 0, 0, 0]
  const agesProfonds: number[] = []
  for (let ty = 0; ty < map.height; ty += PAS) for (let tx = 0; tx < map.width; tx += PAS) {
    if (!estCendre(map, tx, ty, av, seed)) continue
    const p = profondeurDeCendre(map, tx, ty, av, seed)
    const k = p <= SEUILS[0]! ? 0 : p <= SEUILS[1]! ? 1 : p <= SEUILS[2]! ? 2 : 3
    c[k]! += 1
    if (k === 3 && agesProfonds.length < 20000) agesProfonds.push(ancienneteDeCendre(map, tx, ty, ages, seed))
  }
  const tot = c[0]! + c[1]! + c[2]! + c[3]!
  const pct = (n: number) => tot === 0 ? '   —  ' : (100 * n / tot).toFixed(1).padStart(5) + '%'
  agesProfonds.sort((a, b) => a - b)
  const med = agesProfonds.length ? agesProfonds[agesProfonds.length >> 1]! : -1
  console.log(`  ${String(j).padStart(4)} | ${avanceeDeCendre(t).toFixed(1).padStart(7)} | ${pct(c[0]!)}     |${pct(c[1]!)}|${pct(c[2]!)}| ${pct(c[3]!)} | ${med < 0 ? '—' : med + ' j'}`)
}

/** ④ DISTRIBUTION PAR ÂGE — ce que « la cendre a des âges » donne si les bandes sont en JOURS. */
console.log('\n═══ ④ Si les bandes se comptent en JOURS, que pèse chacune ? ═══')
const BANDES = [5, 30, 90, 180, 360, 720, Infinity]
console.log(' jour |  % vallée |' + BANDES.map((b, i) => ` ${i === 0 ? '0-5j' : b === Infinity ? '>2 ans' : (BANDES[i-1]+'-'+b+'j')}`.padStart(11)).join('|'))
for (const j of [61, 92, 120, 180, 240, 360, 600, 900, 1200]) {
  const t = Math.max(0, j - REVEIL)
  const ages = foyers.map(() => t)
  const av = avanceesDepuisAges(ages, foyers.length)
  const compte = new Array(BANDES.length).fill(0)
  let cendre = 0, tot = 0
  for (let ty = 0; ty < map.height; ty += 2) for (let tx = 0; tx < map.width; tx += 2) {
    tot += 1
    if (!estCendre(map, tx, ty, av, seed)) continue
    cendre += 1
    const a = ancienneteDeCendre(map, tx, ty, ages, seed)
    for (let i = 0; i < BANDES.length; i += 1) if (a < BANDES[i]!) { compte[i] += 1; break }
  }
  const pct = (n: number) => cendre === 0 ? '  —  ' : (100 * n / cendre).toFixed(1) + ' %'
  console.log(` ${String(j).padStart(4)} | ${(100*cendre/tot).toFixed(1).padStart(7)} % |` +
    compte.map((n) => pct(n).padStart(11)).join('|'))
}
