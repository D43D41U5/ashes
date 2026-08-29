/** SONDE JETABLE — le MONDE JOUÉ ('racine') : Louvières, coins, et l'ATTACHE des coulées. */
import { carteDeTest } from './carte-cache'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { placeHuntingGrounds } from '../packages/sim/src/faune'
import { HUNT, FAUNA } from '../packages/sim/src/balance'

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) ** 2 + (ay - by) ** 2

for (const seed of [5, 2026]) {
  const carte = carteDeTest(seed, undefined, MONDE_JOUE)
  const map = carte.map
  const louvieres = map.zones.filter((z: { kind?: string }) => z.kind === 'louviere')
  const grounds = placeHuntingGrounds(map, seed)

  // Les FINS de segments de coulées (patron couleeStep : segments séparés par -1).
  const fins: { x: number; y: number }[] = []
  const coulees: number[] = map.coulees ?? []
  let debut = 0
  for (let k = 0; k <= coulees.length; k++) {
    if (k < coulees.length && coulees[k]! >= 0) continue
    if (k > debut) {
      const i = coulees[k - 1]!
      fins.push({ x: (i % map.width) + 0.5, y: Math.floor(i / map.width) + 0.5 })
    }
    debut = k + 1
  }
  const attache = (g: { x: number; y: number }): boolean =>
    fins.some((f) => d2(f.x, f.y, g.x, g.y) <= HUNT.COULEE_ATTACHE * HUNT.COULEE_ATTACHE)

  const attaches = grounds.filter(attache).length
  let louvieresServies = 0
  for (const z of louvieres) {
    const cx = Math.floor(z.x + z.w / 2) + 0.5
    const cy = Math.floor(z.y + z.h / 2) + 0.5
    const couverts = grounds.filter((g) => d2(g.x, g.y, cx, cy) <= FAUNA.GROUND_RADIUS * FAUNA.GROUND_RADIUS)
    if (couverts.some(attache)) louvieresServies++
  }
  console.log(
    `seed ${seed} — louvieres: ${louvieres.length} · coins: ${grounds.length} (${attaches} attachés à une coulée) · louvières dont le coin a sa coulée: ${louvieresServies}/${louvieres.length}`,
  )
}
