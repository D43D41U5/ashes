/**
 * SONDE — CE QUE LA CENDRE REND VRAIMENT (spec `cendre.md` R25).
 *
 * Une charbonnière est un gisement FINI : ce qui compte n'est pas un débit, c'est un TOTAL — ce
 * que la vallée porte en tout, et à quel rythme il s'ouvre. On relève donc, par jour de partie :
 * combien de fûts, combien de charbons, combien de lingots de fer (R24 : deux charbons l'un), et
 * comment ça se répartit entre les dix fosses.
 *
 *     node --import tsx tools/diag-charbonniere.mts [seed]
 */
import { generateZonedTerrain, MONDE, MONDE_JOUE, BALANCE } from '../packages/sim/src/index'
import { CENDRE, avanceesDepuisAges, foyerDeLaTuile, foyersDeLaCarte } from '../packages/sim/src/cendre'
import { CHARBONNIERE, toutesLesCharbonnieres } from '../packages/sim/src/charbonniere'

const seed = Number(process.argv[2] ?? 2026)
const monde = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
console.log(`seed ${seed} · ${foyers.length} foyers · maille ${CHARBONNIERE.MAILLE} · part ${CHARBONNIERE.PART} · stock ${CHARBONNIERE.STOCK}`)
console.log('  jour |  fûts | charbons | lingots | par foyer (min → max)')
for (const j of [61, 92, 120, 180, 240, 360, 600, 1200]) {
  const av = avanceesDepuisAges(foyers.map(() => Math.max(0, j - REVEIL)), foyers.length)
  const futs = toutesLesCharbonnieres(map, av, seed)
  const parFoyer = new Array<number>(foyers.length).fill(0)
  for (const f of futs) {
    const k = foyerDeLaTuile(map, f.tx, f.ty)
    if (k >= 0) parFoyer[k] = (parFoyer[k] ?? 0) + 1
  }
  const charbons = futs.length * CHARBONNIERE.STOCK
  const bornes = futs.length === 0 ? '—' : `${Math.min(...parFoyer)} → ${Math.max(...parFoyer)}`
  console.log(`  ${String(j).padStart(4)} | ${String(futs.length).padStart(5)} | ${String(charbons).padStart(8)} | ${String(Math.floor(charbons / 2)).padStart(7)} | ${bornes}`)
}
