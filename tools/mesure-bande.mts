/**
 * À QUELLE DISTANCE UNE BÊTE VOUS LÈVE-T-ELLE, CORDE MOLLE CONTRE ARC BANDÉ ?
 *
 * L'instrument de `HUNT.DRAW_VISIBILITY` / `DRAW_NOISE` (spec `tir.md` T7). Ces deux
 * nombres sont du calibrage à l'œil : ce banc dit ce qu'ils VALENT réellement, en
 * tuiles, sur le seul geste qui compte — l'approche.
 *
 * Il vit ICI et non dans /sim parce qu'il imprime et mesure : le lint de /sim interdit
 * l'un et le déterminisme se moque de l'autre.
 *
 *   node --import tsx tools/mesure-bande.mts
 */
import { HUNT, TERRAIN_GRASS } from '../packages/sim/src/balance'
import { createEmptyMap } from '../packages/sim/src/map'
import { spawnMonster } from '../packages/sim/src/monsters'
import { createSim, spawnEntity, step, type MoveInput } from '../packages/sim/src/sim'
import { grantItems } from '../packages/sim/src/village'

/**
 * On marche droit sur un cerf et on relève la distance au franchissement du seuil.
 *
 * LE VENT EST POSÉ SOUS L'ARCHER, et ce n'est pas une commodité : `SCENT_STRENGTH` vaut
 * 1, donc un chasseur AU VENT est perçu au maximum quoi qu'il fasse — le nez masquerait
 * la règle entière. Bander ne se voit que quand le vent ne vous a pas déjà trahi.
 */
function distanceDeLevée(bander: boolean, seuil: number, graine: number): number {
  const sim = createSim(graine, { map: createEmptyMap(120, 120, TERRAIN_GRASS) })
  sim.wind = { x: -1, y: 0 }
  const a = spawnEntity(sim, 10, 10)
  grantItems(sim, a, { bow: 1, arrow: 40 })
  const e = sim.entities.find((x) => x.id === a)!
  e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === 'bow')
  const c = spawnMonster(sim, 'deer', 40, 10)
  sim.monsters.find((m) => m.entityId === c)!.suspicion = 0
  for (let t = 0; t < 800; t++) {
    const marche: MoveInput = { entityId: a, dx: 1, dy: 0 }
    step(sim, [bander ? { ...marche, action: { type: 'attack_charge', dx: 1, dy: 0, hold: true } } : marche])
    const m = sim.monsters.find((x) => x.entityId === c)
    const cible = sim.entities.find((x) => x.id === c)
    if (!m || !cible) break
    if (m.suspicion >= seuil) return Math.abs(cible.x - e.x)
  }
  return -1
}

/** Une harde est chaotique : on moyenne sur plusieurs graines avant de comparer. */
const moyenne = (bander: boolean, seuil: number): number => {
  const g = [1, 5, 9, 13, 17, 21]
  const v = g.map((s) => distanceDeLevée(bander, seuil, s)).filter((x) => x > 0)
  return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)
}

console.log(`DRAW_VISIBILITY=${HUNT.DRAW_VISIBILITY}  DRAW_NOISE=${HUNT.DRAW_NOISE}`)
console.log('seuil'.padEnd(20), 'corde molle', ' arc bandé', '  écart')
for (const [nom, seuil] of [
  ['elle regarde', HUNT.SUSPICION_CURIOUS],
  ['elle est fixée', HUNT.SUSPICION_ALERT],
  ['elle est levée', 1],
] as const) {
  const molle = moyenne(false, seuil)
  const bandée = moyenne(true, seuil)
  console.log(nom.padEnd(20), molle.toFixed(2).padStart(11), bandée.toFixed(2).padStart(10), `  ×${(bandée / molle).toFixed(2)}`)
}
