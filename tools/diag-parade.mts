/** MARTELER LA PARADE PAIE-T-IL ? Trois conduites, N coups encaissés, souffle dépensé. */
import { BALANCE, COMBAT, TERRAIN_GRASS } from '../packages/sim/src/balance'
import { createEmptyMap } from '../packages/sim/src/map'
import { createSim, spawnEntity, step, type MoveInput } from '../packages/sim/src/sim'

function essai(nom: string, garde: (t: number) => boolean, coups = 8) {
  const sim = createSim(5, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
  const a = spawnEntity(sim, 10, 10)
  const b = spawnEntity(sim, 11, 10)
  const A = () => sim.entities.find((e) => e.id === a)!
  const B = () => sim.entities.find((e) => e.id === b)!
  B().facing = { x: -1, y: 0 }
  B().hp = 100000
  B().hunger = 0 // régén d'endurance au plancher : on mesure la DÉPENSE, pas la reprise
  A().hp = 100000
  let t = 0
  let paye = 0
  for (let c = 0; c < coups; c++) {
    A().stamina = 100
    const inputs = (): MoveInput[] => [
      { entityId: a, dx: 0, dy: 0, action: c === 0 || true ? undefined : undefined },
      { entityId: b, dx: 0, dy: 0, block: garde(t) },
    ]
    // le coup part
    const av = B().stamina
    step(sim, [
      { entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } },
      { entityId: b, dx: 0, dy: 0, block: garde(t) },
    ])
    t++
    while (A().windup !== undefined) { step(sim, inputs()); t++ }
    paye += Math.max(0, av - B().stamina)
    for (let k = 0; k < BALANCE.TICK_RATE_HZ; k++) { step(sim, inputs()); t++ }
  }
  console.log(`${nom.padEnd(28)} PV perdus ${(100000 - B().hp).toFixed(1).padStart(7)}   souffle payé ${paye.toFixed(1).padStart(6)}`)
}

console.log(`fenêtre de parade : ${COMBAT.PARRY_WINDOW_TICKS} ticks\n`)
essai('garde TENUE en permanence', () => true)
essai('MARTELÉE (1 tick sur 2)', (t) => t % 2 === 0)
essai('MARTELÉE (1 tick sur 3)', (t) => t % 3 === 0)
essai('aucune garde', () => false)
