/**
 * DIAG GRÉSIL — où et quand la neige et la pluie se mélangent (spec `meteo.md` R14).
 *
 * R14 a remplacé le SEUIL neige/pluie par une PART continue (`partDeNeige`) large de
 * `METEO.NEIGE_RAMPE` degrés. Deux questions se posent aussitôt, et aucune ne se répond en
 * lisant le code :
 *
 *   1. **La zone de grésil est-elle ATTEIGNABLE ?** Une loi qu'aucune journée de la saison ne
 *      traverse est une loi morte — la leçon de la garde d'atteignabilité (un balayage de table
 *      fabrique ses conditions ; il faut prouver à part que le domaine est atteint).
 *   2. **La lisière VIT-ELLE ?** Le défaut signalé était géométrique : marais et pré diffèrent
 *      de 2 °C, et sous un seuil ça retournait tout le ciel. On veut donc les jours où les deux
 *      biomes rendent des parts DIFFÉRENTES sans qu'aucune soit saturée.
 *
 * Il ne joue rien : il lit la courbe de saison et la table des biomes, comme la sim les lit.
 *
 *     node --import tsx tools/diag-gresil.mts
 */
import { METEO, TEMPERATURE } from '../packages/sim/src/balance'
import { partDeNeige } from '../packages/sim/src/meteo'
import { socleDuJour } from '../packages/sim/src/temperature'
import { YEAR_DAYS } from '../packages/sim/src/time'

const LIMITE = METEO.SEUIL_NEIGE + METEO.COLD.pluie
const DEMI = METEO.NEIGE_RAMPE / 2
console.log(`limite de neige ${LIMITE} °C, rampe ${METEO.NEIGE_RAMPE} °C → grésil sur T₀ ∈ ]${LIMITE - DEMI}, ${LIMITE + DEMI}[`)
console.log('(part = fraction de flocons dans ce qui tombe ; 0 = pluie franche, 1 = neige franche)\n')
console.log('jour  socle  nuit  | pré j/n    | marais j/n | forêt j')

let joursGresil = 0
let joursLisiereVivante = 0
for (let jour = 1; jour <= YEAR_DAYS; jour++) {
  const socle = socleDuJour(jour, 1)
  const nuit = TEMPERATURE.ECART_NUIT(jour)
  // Les trois biomes de la vallée (`BIOME_OFFSET`) : le pré à 0, le mouillé à −2, le couvert à +2.
  const preJ = partDeNeige(socle)
  const preN = partDeNeige(socle - nuit)
  const marJ = partDeNeige(socle - 2)
  const marN = partDeNeige(socle - 2 - nuit)
  const forJ = partDeNeige(socle + 2)
  const gresil = [preJ, preN, marJ, marN, forJ].some((v) => v > 0.02 && v < 0.98)
  if (gresil) joursGresil++
  // LA LISIÈRE VIT : marais et pré ne rendent pas la même chose — c'est le cas signalé.
  if (Math.abs(marJ - preJ) > 0.05 || Math.abs(marN - preN) > 0.05) joursLisiereVivante++
  if (gresil || jour % 10 === 0) {
    const f = (v: number): string => v.toFixed(2)
    console.log(`${String(jour).padStart(4)}  ${socle.toFixed(1).padStart(5)}  ${nuit.toFixed(1).padStart(4)}  | ${f(preJ)} ${f(preN)}  | ${f(marJ)} ${f(marN)}  | ${f(forJ)}${gresil ? '   ← grésil' : ''}`)
  }
}
console.log(`\n${joursGresil}/${YEAR_DAYS} jours portent du grésil à une heure ou l'autre`)
console.log(`${joursLisiereVivante}/${YEAR_DAYS} jours où la lisière marais/pré CHANGE le ciel sans le retourner`)
if (joursGresil === 0) console.error('!! la zone de grésil n’est atteinte AUCUN jour — R14 serait une loi morte')
