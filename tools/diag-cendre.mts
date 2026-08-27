/**
 * DIAG CENDRE — la courbe d'avancée, et ce qu'elle PREND (spec `cendre.md` R9).
 *
 * La loi tient en deux nombres (`CENDRE.A`, `CENDRE.PLAFOND_JOUR`) et en une racine carrée — et
 * c'est précisément pourquoi elle ne se lit pas dans le code : **« deux fois moins loin » n'est
 * pas « deux fois plus lent »**. Diviser `A` par deux multiplie par QUATRE le temps qu'il faut
 * pour atteindre un lieu donné. Cet instrument rend le seul chiffre qui décide : à quelle date la
 * cendre a pris quoi.
 *
 * Il joue le vrai worldgen et le vrai champ de coût, personne ne touchant aux fosses.
 *
 *     node --import tsx tools/diag-cendre.mts [seed]
 *     node --import tsx tools/diag-cendre.mts 2026 --compare 13.769,3
 *         └─ rejoue la MÊME carte sous une AUTRE loi (A,plafond) — le champ de coût ne dépend
 *            pas de `A`, une seule génération suffit donc à comparer deux lois au même endroit.
 */
import {
  generateZonedTerrain, placeZoneNodes, emplacementsDeVillage, placeHuntingGrounds, nidsAMonstre,
  MONDE, MONDE_JOUE, BALANCE,
} from '../packages/sim/src/index'
import { CENDRE, foyersDeLaCarte, estCendre, coutDe } from '../packages/sim/src/cendre'

const args = process.argv.slice(2)
const seed = Number(args.find((a) => !a.startsWith('--')) ?? 2026)
const compare = args[args.indexOf('--compare') + 1]
const AUTRE = args.includes('--compare') && compare ? compare.split(',').map(Number) : null

const monde = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
const nodes = placeZoneNodes(monde)
const empl = emplacementsDeVillage(monde, nodes, {
  coinsDeChasse: placeHuntingGrounds(map, seed), nids: nidsAMonstre(map),
})

/** La loi, PARAMÉTRÉE — même forme que `avanceeDeCendre`, mais `A` et le plafond libres : c'est
 *  ce qui permet de comparer deux calibrages sans sortir un second arbre (mémoire
 *  `mesurer-avant-apres-sans-stash`). */
function avancee(A: number, P: number, t: number): number {
  let c = CENDRE.R0
  for (let k = 1; k <= t; k += 1) c = Math.min(CENDRE.R0 + A * Math.sqrt(k), c + P)
  return c
}

function releve(A: number, P: number, nom: string): void {
  console.log(`\n═══ ${nom} — A=${A} · plafond=${P} · réveil jour ${REVEIL} · ${empl.length} sites ═══`)
  const vit = (t: number): string => (avancee(A, P, t + 1) - avancee(A, P, t)).toFixed(2)
  console.log(`vitesse (tuiles/jour) : réveil ${vit(1)} · j.240 ${vit(149)} · an 5 ${vit(509)} · an 10 ${vit(1109)}`)
  console.log('  jour   avancée   vallée   sites')
  for (const j of [1, 120, 240, 360, 600, 720, 840, 1200]) {
    const av = foyers.map(() => avancee(A, P, Math.max(0, j - REVEIL)))
    let n = 0
    let tot = 0
    for (let ty = 0; ty < map.height; ty += 2) {
      for (let tx = 0; tx < map.width; tx += 2) {
        tot += 1
        if (estCendre(map, tx, ty, av, seed)) n += 1
      }
    }
    const pris = empl.filter((e) => estCendre(map, e.tx, e.ty, av, seed)).length
    console.log(`  ${String(j).padStart(4)}   ${avancee(A, P, Math.max(0, j - REVEIL)).toFixed(1).padStart(7)}   ${(100 * n / tot).toFixed(1).padStart(5)} %   ${String(pris).padStart(2)}/${empl.length}`)
  }
  // LE REPÈRE DE PRESSION : la date où la moitié des sites tombe. C'est LUI qui a servi à dériver
  // `A` à l'origine, et lui qui a bougé quand Alexis a divisé la propagation par deux.
  const couts = empl.map((e) => coutDe(map.cendreCout, e.ty * map.width + e.tx)).filter((c) => c >= 0).sort((a, b) => a - b)
  const cible = couts[Math.floor(couts.length / 2)] ?? Infinity
  let jour = Infinity
  for (let t = 0; t <= 20000; t += 1) {
    if (avancee(A, P, t) * CENDRE.ORTHO >= cible) { jour = REVEIL + t; break }
  }
  console.log(`moitié des sites pris : jour ${jour}`)
}

releve(CENDRE.A, CENDRE.PLAFOND_JOUR, 'LOI COURANTE')
if (AUTRE) releve(AUTRE[0]!, AUTRE[1]!, 'COMPARAISON')
