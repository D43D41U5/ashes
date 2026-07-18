import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { type ResourceNode } from './economy'
import { countOf, type ItemId } from './items'
import { createEmptyMap } from './map'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, type MoveInput, type PlayerAction, type SimState, type SimOptions } from './sim'
import { addStructure, getVillageOf, structureAt } from './village'

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

/**
 * LAISSE MIJOTER : le craft prend du temps (spec craft-file). Le bot reste OÙ IL
 * EST — s'éloigner de la station mettrait sa file en pause (F7). Borné : une file
 * qui ne se vide pas doit faire échouer le test, pas le figer.
 */
function waitCraft(bot: Bot): void {
  for (let t = 0; t < 2000 && me(bot).craftQueue.length > 0; t++) tick(bot, 0, 0)
  expect(me(bot).craftQueue).toHaveLength(0)
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

    /** Prend l'objet EN MAIN. La sim ne choisit plus pour le joueur : ce qui compte,
     *  c'est ce qu'on TIENT (le marteau pour bâtir, la hache pour couper). */
    const equip = (item: 'hammer' | 'axe') => {
      const slot = me(bot).inventory.findIndex((s) => s?.item === item)
      expect(slot).toBeGreaterThanOrEqual(0)
      tick(bot, 0, 0, { type: 'set_active_slot', slot })
    }

    // 1. Récolter. Le MARTEAU (bois 4 + pierre 2 + fibre 2) s'ajoute à la note :
    //    25 bois (Feu 10 + marteau 4 + atelier 6 + hache 5), 9 pierre, 4 fibres.
    harvestUntil(bot, sim.nodes[0]!, 'wood', 10)
    harvestUntil(bot, sim.nodes[1]!, 'wood', 20)
    harvestUntil(bot, sim.nodes[2]!, 'wood', 25)
    harvestUntil(bot, sim.nodes[3]!, 'stone', 9)
    harvestUntil(bot, sim.nodes[4]!, 'fiber', 4)
    expect(countOf(me(bot).inventory, 'wood')).toBeGreaterThanOrEqual(25)

    // 2. Fonder le village. Le Feu, lui, ne demande pas de marteau — sinon rien
    //    ne pourrait jamais commencer.
    goTo(bot, 10, 10, 0.35)
    tick(bot, 0, 0, { type: 'light_fire' })
    expect(sim.villages).toHaveLength(1)

    // 3. FORGER LE MARTEAU AU FEU, ET LE PRENDRE EN MAIN — sans lui, on ne bâtit
    //    rien (spec recolte.md G12). C'est la nouvelle première marche du jeu.
    tick(bot, 0, 0, { type: 'craft', recipeId: 'hammer' })
    waitCraft(bot) // il forge AU FEU, et il y reste le temps que ça se fasse
    expect(countOf(me(bot).inventory, 'hammer')).toBe(1)
    equip('hammer')

    // 4. Bâtir l'atelier. Au sud : hors du trajet est vers le 3e arbre (le bot n'a
    //    pas de pathfinding).
    addStructure(bot.sim, 'workshop', 10, 11, getVillageOf(bot.sim, bot.id)!.id, bot.id)
    expect(structureAt(sim.structures, 10, 11)?.type).toBe('workshop')

    // 5. Crafter la hache (l'atelier est à portée), et la prendre en main : le
    //    marteau ne coupe pas de bois.
    tick(bot, 0, 0, { type: 'craft', recipeId: 'axe' })
    waitCraft(bot) // à l'atelier, sans le quitter
    expect(countOf(me(bot).inventory, 'axe')).toBe(1)
    equip('axe')

    // 6. Re-récolter (le 3e arbre a encore du stock) : le rendement a doublé.
    const before = countOf(me(bot).inventory, 'wood')
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) tick(bot, 0, 0)
    harvestUntil(bot, sim.nodes[2]!, 'wood', before + 2)
    expect(countOf(me(bot).inventory, 'wood')).toBe(before + 2) // un seul coup a suffi

    // 7. Toute la partie du bot rejoue au bit près.
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(sim))
  })

  /**
   * A6 (spec craft-fortune) — LA RAMPE, avant le village. Le bot est nu : pas de
   * Feu, pas d'atelier, pas de marteau. Il tresse, il taille, et il coupe deux
   * fois plus vite — sans qu'aucune structure n'existe dans la sim. C'est tout
   * l'objet de la couche 1 : donner quelque chose à faire de ses mains à la
   * minute 0, sans court-circuiter l'établi.
   */
  it('la couche 1 : le bot NU tresse une corde, taille un hachereau, et coupe ×2 — sans une seule structure', () => {
    const map = createEmptyMap(32, 32, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [
      { id: 1, type: 'tree', tx: 14, ty: 10, stock: 10, regrowAt: 0 },
      { id: 2, type: 'rock', tx: 6, ty: 10, stock: 12, regrowAt: 0 },
      { id: 3, type: 'fiber_plant', tx: 10, ty: 14, stock: 6, regrowAt: 0 },
    ]
    const options: SimOptions = { map, nodes }
    const setup = (state: SimState) => {
      spawnEntity(state, 10.5, 10.5)
    }
    const sim = createSim(11, options)
    const log = createReplayLog(11, options)
    setup(sim)
    const bot: Bot = { sim, log, id: 1 }

    const wait = () => {
      for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) tick(bot, 0, 0)
    }

    // 1. À MAINS NUES, ×1 par coup : 3 fibres (la corde), 2 bois + 3 pierres (le
    //    hachereau). La pierre ne demande rien — sans quoi rien ne démarrerait.
    harvestUntil(bot, sim.nodes[2]!, 'fiber', 3)
    harvestUntil(bot, sim.nodes[0]!, 'wood', 2)
    harvestUntil(bot, sim.nodes[1]!, 'stone', 3)

    // 2. Tresser, puis tailler — LÀ OÙ IL SE TIENT. Aucune station, aucun village.
    tick(bot, 0, 0, { type: 'craft', recipeId: 'rope' })
    waitCraft(bot)
    expect(countOf(me(bot).inventory, 'rope')).toBe(1)
    tick(bot, 0, 0, { type: 'craft', recipeId: 'crude_axe' })
    waitCraft(bot)
    expect(countOf(me(bot).inventory, 'crude_axe')).toBe(1)
    expect(sim.structures).toHaveLength(0) // la preuve : rien n'a été bâti
    expect(sim.villages).toHaveLength(0)

    // 3. L'empoigner — la sim ne choisit pas pour le joueur (spec inventaire R9).
    const slot = me(bot).inventory.findIndex((s) => s?.item === 'crude_axe')
    expect(slot).toBeGreaterThanOrEqual(0)
    tick(bot, 0, 0, { type: 'set_active_slot', slot })

    // 4. Le même arbre, le même geste : deux fois plus de bois par coup.
    const before = countOf(me(bot).inventory, 'wood')
    wait()
    harvestUntil(bot, sim.nodes[0]!, 'wood', before + 2)
    expect(countOf(me(bot).inventory, 'wood')).toBe(before + 2) // un seul coup a suffi

    // 5. Et tout rejoue au bit près.
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(sim))
  })
})
