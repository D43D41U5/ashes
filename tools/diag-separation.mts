/**
 * DIAG — ce que la séparation des corps fait à la faune.
 *
 * Rejoue le montage de `faune.test.ts` A20/C14 (la SCISSION) à plusieurs valeurs de
 * `COMBAT.SEPARATION_PUSH`, et relève la géométrie promise par le test : chaque moitié
 * de harde doit rester serrée, les deux moitiés doivent diverger.
 *
 *   node --import tsx tools/diag-separation.mts
 */
import { BALANCE, COMBAT, FAUNA, TERRAIN_FOREST, TERRAIN_GRASS } from '../packages/sim/src/balance'
import { createEmptyMap, type WorldMap } from '../packages/sim/src/map'
import { spawnMonster } from '../packages/sim/src/monsters'
import { createSim, spawnEntity, step, type SimState } from '../packages/sim/src/sim'
import { cycleOffsetForStartHour } from '../packages/sim/src/time'

/** LE MONTAGE DU BANC DE FAUNE, à la lettre (`faune.test.ts`) — sinon on mesure autre chose. */
function makeMap(): WorldMap {
  const map = createEmptyMap(160, 160, TERRAIN_GRASS)
  for (let ty = 10; ty < 50; ty++) {
    for (let tx = 10; tx < 50; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  }
  return map
}

const at = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))

function scenario(push: number, seed: number, cap = COMBAT.SEPARATION_MAX_TILES): { moitieA: number; moitieB: number; ecartMoities: number; contacts: number } {
  ;(COMBAT as { SEPARATION_PUSH: number }).SEPARATION_PUSH = push
  ;(COMBAT as { SEPARATION_MAX_TILES: number }).SEPARATION_MAX_TILES = cap
  const sim = createSim(seed, {
    map: makeMap(),
    faunaCap: FAUNA.GROUND_CAP,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(12, 1),
  })
  sim.wind = { x: 0, y: 0 }
  const herdId = sim.nextHerdId
  sim.nextHerdId += 1
  const ids: number[] = []
  for (let i = 0; i < 4; i++) {
    const id = spawnMonster(sim, 'deer', 78.5 + i * 1.5, 60.5)
    sim.monsters.find((m) => m.entityId === id)!.herdId = herdId
    ids.push(id)
  }
  spawnEntity(sim, 78.5 + 2.25, 66.5)

  // Combien de fois deux corps se sont-ils VRAIMENT recouverts ? (le compteur dit si la
  // règle a seulement eu l'occasion de mordre — sans lui, on interprète un vide.)
  let contacts = 0
  const CX = BALANCE.AVATAR_HITBOX_TILES
  const CY = BALANCE.AVATAR_HITBOX_DEPTH_TILES
  for (let t = 0; t < 12 * BALANCE.TICK_RATE_HZ; t++) {
    step(sim, [])
    for (let i = 0; i < sim.entities.length; i++) {
      for (let j = i + 1; j < sim.entities.length; j++) {
        const a = sim.entities[i]!
        const b = sim.entities[j]!
        const u = (b.x - a.x) / CX
        const v = (b.y - a.y) / CY
        if (u * u + v * v < 1) contacts++
      }
    }
  }
  const ranked = [...ids].sort((a, b) => a - b)
  const pairs = [at(sim, ranked[0]!), at(sim, ranked[2]!)]
  const impairs = [at(sim, ranked[1]!), at(sim, ranked[3]!)]
  const centre = (g: { x: number; y: number }[]) => ({ x: (g[0]!.x + g[1]!.x) / 2, y: (g[0]!.y + g[1]!.y) / 2 })
  return {
    moitieA: dist(pairs[0]!, pairs[1]!),
    moitieB: dist(impairs[0]!, impairs[1]!),
    ecartMoities: dist(centre(pairs), centre(impairs)),
    contacts,
  }
}

/**
 * ═══ LA PROPRIÉTÉ, SUR PLUSIEURS GRAINES ═══
 *
 * Une harde est CHAOTIQUE : un test qui pin une trajectoire sur UNE graine ne distingue
 * pas « la règle a cassé la scission » de « la règle a rerouté une graine ». On compare
 * donc des TAUX DE RÉUSSITE de la propriété, sur douze graines, avec et sans la règle.
 */
const seuil = FAUNA.HERD_SPREAD + 3
const GRAINES = [1234, 7, 42, 101, 2026, 555, 9001, 314, 88, 12345, 777, 60606]
console.log(`propriété (A20/C14) : chaque moitié < ${seuil.toFixed(2)} ET les deux moitiés écartées de > ${seuil.toFixed(2)}`)
console.log(`${GRAINES.length} graines, montage du banc de faune\n`)
console.log('push  plafond  tenue   ticks-de-contact (total)   graines rompues')
const CAP_VRAI = COMBAT.SEPARATION_MAX_TILES
for (const [push, cap] of [
  [0, CAP_VRAI], [0.5, CAP_VRAI], [0.75, CAP_VRAI], [1, CAP_VRAI],
  [1, 0.1], [1, 0.05], [1, 0.02], [0.75, 0.05],
] as [number, number][]) {
  let ok = 0
  let contacts = 0
  const rompues: number[] = []
  for (const seed of GRAINES) {
    const r = scenario(push, seed, cap)
    contacts += r.contacts
    if (r.moitieA < seuil && r.moitieB < seuil && r.ecartMoities > seuil) ok++
    else rompues.push(seed)
  }
  console.log(
    `${push.toFixed(2).padStart(5)} ${cap.toFixed(2).padStart(5)}   ${String(ok).padStart(2)}/${GRAINES.length}   ${String(contacts).padStart(18)}   ${rompues.join(' ')}`,
  )
}
