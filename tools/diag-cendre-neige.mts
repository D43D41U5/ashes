/**
 * SONDE — CE QUE R22 CHANGE AU RENDU : la neige tient-elle sur la vieille cendre ?
 *
 * Le froid de la cendre déplace la ligne pluie/neige (`partDeNeige` lit `dehorsSansMeteo`), et le
 * manteau de `manteau.ts` est un PAVÉ OPAQUE : ce que la neige couvre, on ne le voit plus. La
 * question n'est donc pas thermique mais de DIRECTION ARTISTIQUE — l'art des trois terrains
 * cendrés disparaît-il sous du blanc la moitié de la saison ?
 *
 * MESURÉ (seed 2026, jour de saison 10, part de la bande VIEILLE sous la neige), par palier de
 * `CENDRE.FROID_COEUR` : **4 °C → 88,1 % · 3 → 79,7 % · 2 → 18,5 % · 1 → 5,5 %** (hors cendre :
 * 1,5 %). La falaise est entre 2 et 3 — c'est la ligne pluie/neige qu'on franchit.
 *
 *     node --import tsx tools/diag-cendre-neige.mts
 */
import { generateZonedTerrain, MONDE, MONDE_JOUE } from '../packages/sim/src/index'
import { createSim } from '../packages/sim/src/sim'
import { BANDE_HORS, CENDRE, avanceesDepuisAges, bandeDeCendre, foyersDeLaCarte } from '../packages/sim/src/cendre'
import { neigeAuSol, estGele } from '../packages/sim/src/gel'
import { TICKS_PER_SEASON_DAY, gameTimeAt } from '../packages/sim/src/time'
import { BALANCE, TERRAINS } from '../packages/sim/src/balance'
import { terrainAt } from '../packages/sim/src/map'

const seed = 2026
const monde = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const foyers = foyersDeLaCarte(monde.map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
const NOMS = ['frange', 'nue', 'croûte', 'vieille', 'hors']

for (const jourSaison of [3, 10, 55]) {
  const sim = createSim(seed, { map: monde.map, calendarScale: 1 })
  sim.meteoActive = true
  sim.tick = (jourSaison - 1) * TICKS_PER_SEASON_DAY
  sim.cendreAge = foyers.map(() => Math.max(0, 240 - REVEIL))
  const av = avanceesDepuisAges(sim.cendreAge, foyers.length)
  const n = [0, 0, 0, 0, 0]
  const neige = [0, 0, 0, 0, 0]
  const gel = [0, 0, 0, 0, 0]
  for (let ty = 0; ty < sim.map.height; ty += 8) {
    for (let tx = 0; tx < sim.map.width; tx += 8) {
      if (TERRAINS[terrainAt(sim.map, tx, ty)]?.walkable !== true) continue
      const b = bandeDeCendre(sim.map, tx, ty, av, seed)
      const i = b === BANDE_HORS ? 4 : b
      n[i]!++
      if (neigeAuSol(sim, tx, ty) > 0) neige[i]!++
      if (estGele(sim, tx, ty)) gel[i]!++
    }
  }
  const gt = gameTimeAt(sim, sim.tick)
  console.log(`\njour de saison ${jourSaison} · ${gt.hourOfCycle.toFixed(1)} h`)
  for (let i = 0; i < 5; i++) {
    if (!n[i]) continue
    console.log(`  ${NOMS[i]!.padEnd(8)} ${String(n[i]).padStart(5)} tuiles · neige ${((100 * neige[i]!) / n[i]!).toFixed(1).padStart(5)} % · gelé ${((100 * gel[i]!) / n[i]!).toFixed(1).padStart(5)} %`)
  }
}
