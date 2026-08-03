/**
 * LE VILLAGE TIENT-IL ENCORE, OU CASSE-T-IL ? — A7 sur plusieurs graines.
 *
 *   node --import tsx tools/diag-horde.mts
 *
 * `worldevents.test.ts` A7 porte les deux moitiés de la promesse de `tension.md` :
 *   (a) une milice de 4 tient une horde de 4 ;
 *   (b) **deux PNJ CASSENT devant une horde de 10.**
 *
 * Le corps-cible (spec combat R4quinquies, 2026-08-02) fait rougir (b) : deux PNJ
 * survivent désormais. Une garde à une graine ne dit pas si c'est le hasard ou la règle —
 * on rejoue donc les deux moitiés sur douze graines, et c'est le TAUX qui tranche.
 */
import {
  TERRAIN_GRASS,
  COMBAT,
  createEmptyMap,
  createSim,
  foundNpcVillage,
  spawnHorde,
  step,
} from '../packages/sim/src/index'

const GRAINES = Array.from({ length: 12 }, (_, i) => 10 + i)

/** Rend le nombre de PNJ survivants après que la horde a été résolue. */
function jouer(graine: number, pnj: number, horde: number): { survivants: number; monstres: number } {
  const sim = createSim(graine, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
  foundNpcVillage(sim, 20, 20, pnj)
  spawnHorde(sim, horde)
  for (let t = 0; t < 8000 && sim.npcs.length > 0 && sim.monsters.length > 0; t++) step(sim, [])
  return { survivants: sim.npcs.length, monstres: sim.monsters.length }
}

console.log(`LE VILLAGE TIENT OU CASSE — corps-cible = ${COMBAT.HIT_BODY_RADIUS}, recul = ${COMBAT.KNOCKBACK_TILES}\n`)

const a = GRAINES.map((g) => jouer(g, 4, 4))
console.log('  (a) MILICE DE 4 contre HORDE DE 4 — le village doit TENIR (≥ 3 survivants)')
console.log(`      survivants : ${a.map((r) => r.survivants).join(' · ')}`)
console.log(`      tient : ${a.filter((r) => r.survivants >= 3 && r.monstres === 0).length}/${GRAINES.length}`)

const b = GRAINES.map((g) => jouer(g, 2, 10))
console.log('\n  (b) DEUX PNJ contre HORDE DE 10 — le village doit CASSER (< 2 survivants)')
console.log(`      survivants : ${b.map((r) => r.survivants).join(' · ')}`)
console.log(`      casse : ${b.filter((r) => r.survivants < 2).length}/${GRAINES.length}`)
console.log(`      graines où (b) CASSE : ${GRAINES.filter((_, i) => b[i]!.survivants < 2).join(', ') || 'aucune'}`)
