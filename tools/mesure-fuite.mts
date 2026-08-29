/**
 * LA COURSE EN DENTS DE SCIE, MESURÉE CONTRE LE LOUP (arbitrage R1ter).
 * SHIFT tenu sans jamais relâcher, terrain dégagé, bien nourri — le cas le plus favorable.
 * On rend la vitesse MOYENNE sur la durée, et on la compare à la vitesse du loup.
 */
import { BALANCE, COMBAT, MONSTER_DEFS, TERRAIN_GRASS } from '../packages/sim/src/balance'
import { createEmptyMap } from '../packages/sim/src/map'
import { createSim, spawnEntity, step } from '../packages/sim/src/sim'

const SECONDES = 60
const sim = createSim(5, { map: createEmptyMap(400, 40, TERRAIN_GRASS) })
const id = spawnEntity(sim, 5, 20)
const e = () => sim.entities.find((x) => x.id === id)!
e().hunger = 100
const x0 = e().x
let ticksSprint = 0
const N = SECONDES * BALANCE.TICK_RATE_HZ
for (let t = 0; t < N; t++) {
  step(sim, [{ entityId: id, dx: 1, dy: 0, sprint: true }])
  if (e().gait === 'sprint') ticksSprint++
}
const dist = e().x - x0
const moyenne = dist / SECONDES
console.log(`WINDED_SPEED = ${COMBAT.WINDED_SPEED}`)
console.log(`  distance ${dist.toFixed(1)} tuiles en ${SECONDES} s`)
console.log(`  vitesse MOYENNE  : ${moyenne.toFixed(2)} t/s`)
console.log(`  le loup court à  : ${MONSTER_DEFS.wolf.speed} t/s`)
console.log(`  rapport cyclique : ${((100 * ticksSprint) / N).toFixed(0)} % de ticks en sprint`)
console.log(moyenne < MONSTER_DEFS.wolf.speed ? '  ✓ ON NE DISTANCE PLUS LE LOUP' : '  ✗ le loup est encore semé')
