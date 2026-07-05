import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { type ResourceNode } from './economy'
import { countOf, type ItemId } from './items'
import { createEmptyMap } from './map'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, type MoveInput, type PlayerAction, type SimState, type SimOptions } from './sim'
import { structureAt } from './village'

/**
 * A7 — Le bot headless : un agent scripté joue la boucle économique entière
 * en pur /sim, sans rendu ni humain. C'est l'embryon du « banc de test
 * permanent » du GDD §10, et chaque tick passe par le replay log.
 */

interface Bot {
  sim: SimState
  log: ReturnType<typeof createReplayLog>
  id: number
}

function tick(bot: Bot, dx: -1 | 0 | 1, dy: -1 | 0 | 1, action?: PlayerAction): void {
  const input: MoveInput = { entityId: bot.id, dx, dy, ...(action ? { action } : {}) }
  recordAndStep(bot.sim, bot.log, [input])
}

const me = (bot: Bot) => bot.sim.entities.find((e) => e.id === bot.id)!

/**
 * Marche vers le centre d'une tuile. `stopDist` : 1.2 pour un nœud (on
 * s'arrête flush contre l'obstacle), plus serré pour se poster quelque part.
 */
function goTo(bot: Bot, tx: number, ty: number, stopDist = 1.2): void {
  const targetX = tx + 0.5
  const targetY = ty + 0.5
  for (let t = 0; t < 800; t++) {
    const e = me(bot)
    const ex = targetX - e.x
    const ey = targetY - e.y
    if (ex * ex + ey * ey <= stopDist * stopDist) return
    tick(bot, Math.sign(Math.abs(ex) > 0.1 ? ex : 0) as -1 | 0 | 1, Math.sign(Math.abs(ey) > 0.1 ? ey : 0) as -1 | 0 | 1)
  }
  throw new Error(`bot bloqué en route vers (${tx}, ${ty})`)
}

/** Récolte un nœud jusqu'à posséder `want` de l'item (ou épuisement). */
function harvestUntil(bot: Bot, node: ResourceNode, item: ItemId, want: number): void {
  goTo(bot, node.tx, node.ty)
  for (let guard = 0; guard < 200 && countOf(me(bot).inventory, item) < want && node.stock > 0; guard++) {
    tick(bot, 0, 0, { type: 'harvest', nodeId: node.id })
    for (let t = 1; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) tick(bot, 0, 0)
  }
}

describe('le bot headless (A7)', () => {
  it('joue la boucle : récolter → fonder → bâtir l’atelier → crafter la hache → récolter mieux', () => {
    const map = createEmptyMap(32, 32, TERRAIN_GRASS)
    // Nœuds espacés autour de la place (10, 10), chacun accessible en ligne.
    const trees = [
      { id: 1, type: 'tree', tx: 14, ty: 8, stock: 10, regrowAt: 0 },
      { id: 2, type: 'tree', tx: 14, ty: 12, stock: 10, regrowAt: 0 },
      { id: 3, type: 'tree', tx: 16, ty: 10, stock: 10, regrowAt: 0 },
    ] as const satisfies readonly ResourceNode[]
    const rock: ResourceNode = { id: 4, type: 'rock', tx: 6, ty: 10, stock: 12, regrowAt: 0 }
    const fiber: ResourceNode = { id: 5, type: 'fiber_plant', tx: 10, ty: 14, stock: 6, regrowAt: 0 }
    const nodes = [...trees.map((t) => ({ ...t })), rock, fiber]
    const options: SimOptions = { map, nodes }

    const setup = (state: SimState) => {
      spawnEntity(state, 10.5, 10.5)
    }
    const sim = createSim(7, options)
    const log = createReplayLog(7, options)
    setup(sim)
    const bot: Bot = { sim, log, id: 1 }

    // 1. Récolter : 21 bois (Feu 10 + hache 5 + atelier 6), 7 pierre, 2 fibres.
    harvestUntil(bot, sim.nodes[0]!, 'wood', 10)
    harvestUntil(bot, sim.nodes[1]!, 'wood', 20)
    harvestUntil(bot, sim.nodes[2]!, 'wood', 21)
    harvestUntil(bot, sim.nodes[3]!, 'stone', 7)
    harvestUntil(bot, sim.nodes[4]!, 'fiber', 2)
    expect(countOf(me(bot).inventory, 'wood')).toBeGreaterThanOrEqual(21)

    // 2. Fonder le village sur la place, bâtir l'atelier sur la tuile voisine.
    goTo(bot, 10, 10, 0.35)
    tick(bot, 0, 0, { type: 'light_fire' })
    expect(sim.villages).toHaveLength(1)
    // Au sud : hors du trajet est vers le 3e arbre (le bot n'a pas de pathfinding).
    tick(bot, 0, 0, { type: 'build', structure: 'workshop', tx: 10, ty: 11 })
    expect(structureAt(sim.structures, 10, 11)?.type).toBe('workshop')

    // 3. Crafter la hache (l'atelier est à portée).
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) tick(bot, 0, 0)
    tick(bot, 0, 0, { type: 'craft', recipeId: 'axe' })
    expect(countOf(me(bot).inventory, 'axe')).toBe(1)

    // 4. Re-récolter (le 3e arbre a encore du stock) : le rendement a doublé.
    const before = countOf(me(bot).inventory, 'wood')
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) tick(bot, 0, 0)
    harvestUntil(bot, sim.nodes[2]!, 'wood', before + 2)
    expect(countOf(me(bot).inventory, 'wood')).toBe(before + 2) // un seul coup a suffi

    // 5. Toute la partie du bot rejoue au bit près.
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(sim))
  })
})
