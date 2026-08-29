import { HUNT, MONDE_JOUE } from '../packages/sim/src/index'
import { placeHuntingGrounds } from '../packages/sim/src/faune'
import { carteDeTest } from './carte-cache'

// Par coin : la distance à la FIN (l'eau) de la coulée la plus proche — la règle
// d'attache de couleeStep. Et le paysage : combien de coulées, où finissent-elles.
const seed = Number(process.argv[2] ?? 7)
const carte = carteDeTest(seed, undefined, MONDE_JOUE)
const map = carte.map
const grounds = placeHuntingGrounds(map, seed)
const coulees = map.coulees ?? []
const width = map.width

const fins: { x: number; y: number }[] = []
let debut = 0
let chemins = 0
let longTot = 0
for (let k = 0; k <= coulees.length; k++) {
  if (k < coulees.length && coulees[k]! >= 0) continue
  if (k > debut) {
    chemins++
    longTot += k - debut
    const fin = coulees[k - 1]!
    fins.push({ x: (fin % width) + 0.5, y: Math.floor(fin / width) + 0.5 })
  }
  debut = k + 1
}
console.log(`seed ${seed} : ${chemins} coulées (longueur moy ${(longTot / Math.max(1, chemins)).toFixed(1)}), ${grounds.length} coins, COULEE_ATTACHE=${HUNT.COULEE_ATTACHE}`)
const dists: number[] = []
for (const g of grounds) {
  let best = Infinity
  for (const f of fins) {
    const d = Math.sqrt((g.x - f.x) * (g.x - f.x) + (g.y - f.y) * (g.y - f.y))
    if (d < best) best = d
  }
  dists.push(best)
  console.log(`  coin (${g.x.toFixed(0)}, ${g.y.toFixed(0)}) → fin de coulée la plus proche : ${best.toFixed(1)} tuiles`)
}
dists.sort((a, b) => a - b)
console.log(`  distances triées : ${dists.map((d) => d.toFixed(0)).join(' · ')}`)
