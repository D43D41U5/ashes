/**
 * SONDE — LE CŒUR DE LA CENDRE EST-IL DÉJÀ LE TERRITOIRE DES MORTS ? (proposition ⑥)
 *
 * ⑥ affirme qu'aucun mécanisme n'est à écrire : les fumerolles soufflent du FROID
 * (`FUMEROLLE.FROID` = 9 °C au trou, rayon 7) et l'éveil du Cendreux est THERMIQUE
 * (`CENDREUX.TORPEUR` : la vue vaut `aggroRange × max(éveil, 0,2)`, éveil = pente de +6 °C à
 * −14 °C). Donc, par les lois EN PLACE, le cœur verrait déjà plus loin que le reste.
 *
 * **C'est une affirmation empirique, et personne ne l'a vérifiée.** Deux façons qu'elle a de
 * casser :
 *   ① les trois terrains cendrés ont un `BIOME_OFFSET` de ZÉRO — la cendre elle-même n'est ni
 *      chaude ni froide, tout repose donc sur la couverture réelle des bouches ;
 *   ② la frange (bande 0) n'a PAS de fumerolle (`auCoeurDeLaCendre` exige profondeur > 3) : si
 *      l'écart mesuré est nul, ⑥ ne dit rien et la question à poser est une autre.
 *
 * On relève donc, par BANDE (R20) et hors cendre, sur le monde JOUÉ :
 *   · la température de base à découvert, · l'éveil, · la VUE en tuiles d'un cendreux,
 *   · la part de tuiles que le souffle d'une bouche atteint.
 *
 * ⚠ LE MONTAGE CHOISIT SON JOUR ET SON HEURE (mémoire `cadran-temperature-cendreux`) : une
 *   nuit d'acte III sature l'éveil à 1 partout et ne montrerait RIEN. On relève donc un midi
 *   d'acte I (le monde le plus chaud, là où l'écart se voit le mieux) et une nuit d'acte II.
 *
 *     node --import tsx tools/diag-cendre-eveil.mts [seed] [pas]
 */
import { generateZonedTerrain, MONDE, MONDE_JOUE, BALANCE } from '../packages/sim/src/index'
import {
  BANDE_CROUTE, BANDE_FRANGE, BANDE_HORS, BANDE_NUE, BANDE_VIEILLE,
  CENDRE, avanceesDepuisAges, bandeDeCendre, foyersDeLaCarte, froidDeCendre,
} from '../packages/sim/src/cendre'
import { createSim } from '../packages/sim/src/sim'
import {
  AMBIANT_HYPOTHERMIE, baselineTemperatureAt, eveilPourTemperature, froidDeFumerolleDeTuile,
} from '../packages/sim/src/temperature'
import { TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, gameTimeAt } from '../packages/sim/src/time'
import { CENDREUX, MONSTER_DEFS, TERRAINS } from '../packages/sim/src/balance'
import { densiteDesMorts } from '../packages/sim/src/morts'
import { terrainAt } from '../packages/sim/src/map'

const seed = Number(process.argv[2] ?? 2026)
const PAS = Number(process.argv[3] ?? 4)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
const AGGRO = MONSTER_DEFS.cendreux.aggroRange

const monde = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const foyers = foyersDeLaCarte(monde.map)
console.log(`seed ${seed} · carte ${monde.map.width}×${monde.map.height} · ${foyers.length} foyers · pas ${PAS}`)
console.log(`éveil : ${CENDREUX.TORPEUR.CHAUD} °C → 0 · ${CENDREUX.TORPEUR.FROID} °C → 1 · vue = ${AGGRO} × max(éveil, ${CENDREUX.TORPEUR.VUE_PLANCHER})`)

const NOMS = ['frange ≤3', 'nue 3-15', 'croûte 15-40', 'vieille >40']

/** Un montage : un jour de SAISON et une heure — c'est lui qui décide du froid du monde.
 *  ⚠ L'HEURE SE CHERCHE, ELLE NE SE POSE PAS : `cycleOffsetForStartHour` cale le LEVER du jour de
 *  départ, et poser `state.tick` au jour voulu re-décale la phase. On balaie donc un cycle et on
 *  retient le tick dont l'heure murale est la plus proche — et on l'IMPRIME, pour qu'aucun relevé
 *  ne soit lu sans savoir de quelle heure il parle (mémoire `cadran-temperature-cendreux`). */
function releve(jourSaison: number, heure: number, jourDeCendre: number): void {
  const state = createSim(seed, { map: monde.map, calendarScale: 1 })
  const base = (jourSaison - 1) * TICKS_PER_SEASON_DAY
  let best = base
  let ecart = 99
  for (let t = base; t < base + TICKS_PER_CYCLE; t += 20) {
    const h = gameTimeAt(state, t).hourOfCycle
    const d = Math.min(Math.abs(h - heure), 24 - Math.abs(h - heure))
    if (d < ecart) { ecart = d; best = t }
  }
  state.tick = best
  const gt = gameTimeAt(state, state.tick)
  state.cendreAge = foyers.map(() => Math.max(0, jourDeCendre - REVEIL))
  const avancees = avanceesDepuisAges(state.cendreAge, foyers.length)

  const n = [0, 0, 0, 0, 0]
  const sT = [0, 0, 0, 0, 0]
  const sE = [0, 0, 0, 0, 0]
  const sV = [0, 0, 0, 0, 0]
  const souffle = [0, 0, 0, 0, 0] // tuiles qu'une bouche atteint
  const sD = [0, 0, 0, 0, 0] // le CHAMP DES MORTS — le second cadran de ⑥
  // ⚠ CE QUI DÉCIDE DE LA CALIBRATION : un corps NU prend froid sous `AMBIANT_HYPOTHERMIE`
  // (−10 °C, dérivé). On compte donc les tuiles qui passent la ligne — avec R22 et sans lui.
  const mortel = [0, 0, 0, 0, 0]
  const mortelSans = [0, 0, 0, 0, 0]
  const sH = [0, 0, 0, 0, 0] // …et ce qu'il VAUDRAIT, hantise ré-armée sur la profondeur
  const sat = [0, 0, 0, 0, 0] // combien de tuiles satureraient à 1
  // Le SOUS-ENSEMBLE soufflé, à part : c'est là que ⑥ vit ou meurt.
  let nS = 0
  let sTS = 0
  let sES = 0
  let sVS = 0
  for (let ty = 0; ty < state.map.height; ty += PAS) {
    for (let tx = 0; tx < state.map.width; tx += PAS) {
      const def = TERRAINS[terrainAt(state.map, tx, ty)]
      if (!def?.walkable) continue // l'eau, la roche et le vide n'ont pas de cendreux
      const b = bandeDeCendre(state.map, tx, ty, avancees, seed)
      const i = b === BANDE_HORS ? 4 : b
      const T = baselineTemperatureAt(state, tx + 0.5, ty + 0.5, state.tick)
      const e = eveilPourTemperature(T)
      const v = AGGRO * Math.max(e, CENDREUX.TORPEUR.VUE_PLANCHER)
      n[i]!++
      sT[i]! += T
      sE[i]! += e
      sV[i]! += v
      const d = densiteDesMorts(state, tx, ty)
      sD[i]! += d
      if (d >= 0.999) sat[i]!++
      const fr = froidDeCendre(state, tx, ty) // le froid de R22, en degrés retirés
      sH[i]! += fr
      if (T < AMBIANT_HYPOTHERMIE) mortel[i]!++
      if (T + fr < AMBIANT_HYPOTHERMIE) mortelSans[i]!++ // le même monde sans R22 (à découvert)
      if (froidDeFumerolleDeTuile(state, tx + 0.5, ty + 0.5) > 0) {
        souffle[i]!++
        if (i !== 4) { nS++; sTS += T; sES += e; sVS += v }
      }
    }
  }
  const acte = Math.floor((jourSaison - 1) / BALANCE.ACT_DAYS) + 1
  console.log(`\n── jour de saison ${jourSaison} (acte ${acte}) · ${gt.hourOfCycle.toFixed(1)} h ${gt.isNight ? '(NUIT)' : '(jour)'} · nuit=${gt.nuit.toFixed(2)} · cendre du jour ${jourDeCendre} ──`)
  console.log('  bande        |  tuiles |    T °C |  éveil |  vue (t) | soufflées |  morts | saturé | froid R22')
  for (const i of [BANDE_FRANGE, BANDE_NUE, BANDE_CROUTE, BANDE_VIEILLE, 4]) {
    const c = n[i]!
    const nom = (i === 4 ? 'HORS cendre' : NOMS[i]!).padEnd(12)
    if (c === 0) { console.log(`  ${nom} |       0 |       — |      — |        — |         —`); continue }
    console.log(`  ${nom} | ${String(c).padStart(7)} | ${(sT[i]! / c).toFixed(2).padStart(7)} | ${(sE[i]! / c).toFixed(3).padStart(6)} | ${(sV[i]! / c).toFixed(2).padStart(8)} | ${((100 * souffle[i]!) / c).toFixed(1).padStart(8)} % | ${(sD[i]! / c).toFixed(4).padStart(6)} | ${((100 * sat[i]!) / c).toFixed(4).padStart(5)} % | ${(sH[i]! / c).toFixed(2).padStart(9)}`)
  }
  const vHors = sV[4]! / Math.max(1, n[4]!)
  if (nS > 0) {
    console.log(`  ${'SOUS UN SOUFFLE'.padEnd(12)} | ${String(nS).padStart(7)} | ${(sTS / nS).toFixed(2).padStart(7)} | ${(sES / nS).toFixed(3).padStart(6)} | ${(sVS / nS).toFixed(2).padStart(8)} |    100.0 % |      — |      — |         —`)
    console.log(`     → sous un souffle vs hors cendre : vue ×${(sVS / nS / vHors).toFixed(3)}`)
  }
  for (const i of [BANDE_NUE, BANDE_CROUTE, BANDE_VIEILLE]) {
    if (n[i]! > 0) console.log(`     → ${NOMS[i]!} vs hors cendre : vue ×${(sV[i]! / n[i]! / vHors).toFixed(3)}`)
  }
  // LE VERDICT DE SURVIE : un corps NU, à découvert, sous la ligne d'hypothermie (−10 °C).
  // ⚠ La tenue d'hiver plancher l'ambiant à `TENUE_FLOOR` (−5,2) et un feu à +14 : ces deux-là
  //   sont des `max`, donc R22 ne peut RIEN contre un joueur vêtu ou au feu. C'est structurel.
  const parts = [BANDE_FRANGE, BANDE_NUE, BANDE_CROUTE, BANDE_VIEILLE, 4]
    .filter((i) => n[i]! > 0)
    .map((i) => `${i === 4 ? 'hors' : NOMS[i]!.split(' ')[0]} ${((100 * mortel[i]!) / n[i]!).toFixed(1)} % (sans R22 : ${((100 * mortelSans[i]!) / n[i]!).toFixed(1)} %)`)
  console.log(`     → NU sous ${AMBIANT_HYPOTHERMIE} °C : ${parts.join(' · ')}`)
}

console.log(`froid de la vieille cendre (R22) : ${CENDRE.FROID_COEUR} °C · rampe ${CENDRE.FRANGE_TUILES} → ${CENDRE.CROUTE_TUILES} t`)

for (const jourDeCendre of [240, 1200]) {
  for (const [j, h] of [[10, 12], [10, 2], [1, 2], [55, 2]] as const) releve(j, h, jourDeCendre)
}
