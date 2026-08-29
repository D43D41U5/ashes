import { carteDeTest } from './carte-cache'
import { placeHuntingGrounds } from '../packages/sim/src/faune'
import { FAUNA } from '../packages/sim/src/balance'

for (const seed of [5, 2026]) {
  const c = carteDeTest(seed)
  const grounds = placeHuntingGrounds(c.map, seed)
  const R = FAUNA.GROUND_RADIUS
  const louvieres = c.map.zones.filter((z) => z.kind === 'louviere')
  let sansCoin = 0
  for (const z of louvieres) {
    const cx = Math.floor(z.x + z.w / 2) + 0.5
    const cy = Math.floor(z.y + z.h / 2) + 0.5
    const couverte = grounds.some((g) => (g.x - cx) * (g.x - cx) + (g.y - cy) * (g.y - cy) <= R * R)
    if (!couverte) sansCoin++
  }
  const compte = (k: string) => c.map.zones.filter((z) => z.kind === k).length
  console.log(
    `seed ${seed} — lieux: ${c.map.zones.length} · louvieres: ${louvieres.length} (${sansCoin} sans coin) · steles: ${compte('stele')} · repaires: ${compte('repaire')} · coins: ${grounds.length}`,
  )
}
