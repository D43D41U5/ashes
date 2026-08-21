/**
 * MESURE DU CORTÈGE DE CENDRE (spec `cortege-cendre.md`, critère A9).
 *
 * Le cortège pose trois bandes en TUILES devant un front dont la course est calibrée PAR CARTE
 * (`cendreMax`, dichotomie sur `CENDRE.PART_CIBLE`). Une largeur de bande n'a donc aucun sens
 * dans l'absolu : elle ne veut dire quelque chose que RAPPORTÉE à la course du front et à la
 * taille de la zone habitée. Sur la carte jouet d'un test unitaire (70 tuiles, `cendreMax` 8),
 * une bande de 28 couvre 40 % du monde ; sur la carte de production, personne ne sait — d'où
 * cette sonde, et non une estimation.
 *
 * Ce qu'elle rend, sur le VRAI worldgen : la course du front, puis à trois instants de l'arc la
 * part des Prés Bas (là où le joueur habite) qui est brûlée / froide / stérile.
 *
 * A9 est tenu si les bandes couvrent une part NON NULLE et NON TOTALE : une bande à 0 % est un
 * réglage mort, une bande à 100 % est un réglage qui a mangé la carte.
 *
 *   node --import tsx tools/mesure-cortege.mts
 */
import { CENDRE, avanceeDuFront, bandeDeCendre, froidDeCendre, facteurSterilite, estCendre } from '../packages/sim/src/cendre'
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { MORTS } from '../packages/sim/src/balance'
import { hantiseDeCendre } from '../packages/sim/src/morts'

const SEED = Number(process.env.SEED ?? 2026)
const { sim } = construireMondeDuBanc(SEED)
const map = sim.map

console.log(`carte ${map.width}×${map.height} — seed ${SEED}`)
console.log(`cendreMax (course totale du front, en tuiles) : ${map.cendreMax}`)
console.log(
  `bandes (parts de la course) : froide ${(CENDRE.FROID_PART * 100).toFixed(0)} % = ` +
    `${bandeDeCendre(map, CENDRE.FROID_PART).toFixed(1)} t · ` +
    `stérile ${(CENDRE.STERILE_PART * 100).toFixed(0)} % = ${bandeDeCendre(map, CENDRE.STERILE_PART).toFixed(1)} t · ` +
    `hantise ${(MORTS.HANTISE_PART * 100).toFixed(0)} % = ${bandeDeCendre(map, MORTS.HANTISE_PART).toFixed(1)} t`,
)
console.log()

// On ne compte que là où le joueur VIT : les tuiles dont le champ de cendre est positif au
// départ (hors Cendrière). Compter la Cendrière gonflerait « brûlé » d'un tiers, gratuitement.
const champ = map.cendre!
const habitable: number[] = []
for (let i = 0; i < champ.length; i++) if (champ[i]! >= 0) habitable.push(i)

console.log(`tuiles hors Cendrière : ${habitable.length.toLocaleString('fr')}`)
console.log()
console.log('jour   front    brûlé    froid   stérile   hantise moy. (brûlé)')

for (const jour of [1, 15, 30, 45, 60, 90]) {
  const front = avanceeDuFront(jour, map.cendreMax ?? 0)
  let brules = 0
  let froids = 0
  let steriles = 0
  let hantiseSomme = 0
  for (const i of habitable) {
    const tx = i % map.width
    const ty = (i - tx) / map.width
    if (estCendre(map, tx, ty, front)) {
      brules++
      hantiseSomme += hantiseDeCendre(map, tx, ty, front)
    }
    if (froidDeCendre(map, tx, ty, front) > 0) froids++
    if (facteurSterilite(map, tx, ty, front) > 1) steriles++
  }
  const pc = (n: number): string => `${((n / habitable.length) * 100).toFixed(1)} %`.padStart(8)
  const moy = brules === 0 ? '—' : (hantiseSomme / brules).toFixed(3)
  console.log(
    `${String(jour).padStart(4)}  ${front.toFixed(1).padStart(6)}  ${pc(brules)} ${pc(froids)} ${pc(steriles)}   ${moy} (plafond ${MORTS.HANTISE_MAX})`,
  )
}
