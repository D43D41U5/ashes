import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS, TERRAIN_ROCK, TICK_DT_S } from './balance'
import { moveAvatar, overlapsBlocking } from './collision'
import { createEmptyMap, type WorldMap } from './map'
import {
  createPrediction,
  decayRenderOffset,
  predictFrame,
  reconcile,
  renderPosition,
  type PredictInput,
} from './prediction'

const SPEED = BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2
const SNAP = 1.5
const RIGHT: PredictInput = { dx: 1, dy: 0, sprint: false, block: false }
const DIAG: PredictInput = { dx: 1, dy: 1, sprint: false, block: false }

const setTile = (map: WorldMap, tx: number, ty: number, id: number): void => {
  map.terrain[ty * map.width + tx] = id
}
const openWorld = (): { map: WorldMap } => ({ map: createEmptyMap(16, 16, TERRAIN_GRASS) })
// Mur vertical col 8, rangées 0..8 (il se termine) — le cas du rollback de coin.
const wallWorld = (): { map: WorldMap } => {
  const map = createEmptyMap(16, 16, TERRAIN_GRASS)
  for (let ty = 0; ty <= 8; ty++) setTile(map, 8, ty, TERRAIN_ROCK)
  return { map }
}

/** Vérité autoritative : l'hôte applique une suite d'inputs, un moveAvatar par tick. */
const hostPath = (
  world: { map: WorldMap },
  x: number,
  y: number,
  input: PredictInput,
  ticks: number,
): { x: number; y: number } => {
  let p = { x, y }
  for (let t = 0; t < ticks; t++) p = moveAvatar(world, p.x, p.y, input.dx, input.dy, TICK_DT_S)
  return p
}

/** Prédit K ticks du même input (K frames d'un tick chacune). */
const predictTicks = (
  pred: ReturnType<typeof createPrediction>,
  world: { map: WorldMap },
  input: PredictInput,
  ticks: number,
): void => {
  for (let t = 0; t < ticks; t++) predictFrame(pred, world, TICK_DT_S, input, 1)
}

describe('prédiction & réconciliation (netcode)', () => {
  it('A1 — prédiction parfaite ⇒ correction nulle (rejeu = prédiction)', () => {
    const world = openWorld()
    const pred = createPrediction(5, 5)
    predictTicks(pred, world, RIGHT, 6)
    const predictedBase = { ...pred.base }
    // L'hôte a acquitté 4 des 6 inputs ; on rejoue les 2 derniers depuis son état.
    const auth = hostPath(world, 5, 5, RIGHT, 4)
    reconcile(pred, world, auth, 4, SNAP)
    expect(pred.base).toEqual(predictedBase) // recalé exactement là où on était
    expect(pred.renderOffset).toEqual({ x: 0, y: 0 })
    expect(pred.pending.map((b) => b.seq)).toEqual([5, 6]) // seuls les non-acquittés restent
  })

  it('A2 — acquittement : les inputs ≤ lastProcessedInput sont purgés', () => {
    const world = openWorld()
    const pred = createPrediction(5, 5)
    predictTicks(pred, world, RIGHT, 5)
    expect(pred.pending.map((b) => b.seq)).toEqual([1, 2, 3, 4, 5])
    reconcile(pred, world, hostPath(world, 5, 5, RIGHT, 3), 3, SNAP)
    expect(pred.pending.map((b) => b.seq)).toEqual([4, 5])
  })

  it('A3 — parité de rejeu près du bout de mur (pas de divergence de coin)', () => {
    const world = wallWorld()
    const start = { x: 8 - HALF, y: 4.5 }
    const pred = createPrediction(start.x, start.y)
    predictTicks(pred, world, DIAG, 40)
    // L'hôte a acquitté 37 ticks (autorité proche, sous le seuil de snap) ; on
    // rejoue les 3 derniers inputs depuis son état → doit égaler la trajectoire hôte.
    reconcile(pred, world, hostPath(world, start.x, start.y, DIAG, 37), 37, SNAP)
    expect(pred.base).toEqual(hostPath(world, start.x, start.y, DIAG, 40))
  })

  it('A4 — misprédiction : base recalée, écart absorbé par renderOffset qui décroît', () => {
    const world = openWorld()
    const pred = createPrediction(5, 5)
    predictTicks(pred, world, RIGHT, 5)
    const predictedBase = { ...pred.base }
    // L'autorité dit qu'on est 0,4 tuile en arrière (ex. repoussé) ; tout acquitté.
    const auth = { x: predictedBase.x - 0.4, y: predictedBase.y }
    reconcile(pred, world, auth, 5, SNAP)
    expect(pred.base).toEqual(auth) // la sim est exacte : elle saute sur l'autorité
    // ...mais le rendu ne saute pas : offset = ancienne base − nouvelle base.
    expect(pred.renderOffset.x).toBeCloseTo(0.4)
    const before = Math.abs(pred.renderOffset.x)
    decayRenderOffset(pred, 0.8)
    expect(Math.abs(pred.renderOffset.x)).toBeLessThan(before) // fond vers 0
  })

  it('A4bis — le rejeu clampe sur le mur : la base n’est jamais dans un obstacle', () => {
    const world = wallWorld()
    const pred = createPrediction(8 - HALF, 4.5)
    // Inputs non acquittés qui poussent dans le mur ; rejeu depuis une ancre flush.
    predictTicks(pred, world, RIGHT, 10)
    reconcile(pred, world, { x: 8 - HALF, y: 4.5 }, 0, SNAP)
    expect(overlapsBlocking(world, pred.base.x, pred.base.y)).toBe(false)
    expect(pred.base.x).toBeLessThanOrEqual(8 - HALF + 1e-9)
  })

  it('A5 — snap dur au-delà du seuil : base téléportée, buffer vidé, pas de rejeu', () => {
    const world = openWorld()
    const pred = createPrediction(5, 5)
    predictTicks(pred, world, RIGHT, 5)
    const far = { x: 5, y: 12 } // > SNAP_DISTANCE (respawn au Feu)
    reconcile(pred, world, far, 0, SNAP)
    expect(pred.base).toEqual(far)
    expect(pred.pending).toEqual([])
    expect(pred.renderOffset).toEqual({ x: 0, y: 0 }) // un téléport est instantané, pas lissé
  })

  it('A6 — extrapolation de rendu : le sprite devance la base du reliquat sous-tick', () => {
    const world = openWorld()
    const pred = createPrediction(2.5, 4.5)
    predictFrame(pred, world, TICK_DT_S * 1.5, RIGHT, 1) // 1 tick + un demi-tick de reliquat
    expect(pred.base.x).toBe(2.5 + SPEED) // ancre : un tick entier
    expect(pred.pendingS).toBeCloseTo(TICK_DT_S / 2)
    const rp = renderPosition(pred, world, RIGHT, 1)
    expect(rp.x).toBeCloseTo(2.5 + SPEED * 1.5) // rendu : position continue lissée
    expect(rp.y).toBe(4.5)
  })
})
