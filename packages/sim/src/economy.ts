/**
 * L'économie — nœuds, récolte, faim, artisanat, spécialisation (spec économie).
 *
 * Économie de flux (GDD §8) : tout se consomme, les outils s'usent, les nœuds
 * s'épuisent et repoussent. La spécialisation émerge de la pratique (GDD §6) :
 * aucun choix de classe, des maths qui font plafonner le touche-à-tout.
 */
import {
  BALANCE,
  FOOD_VALUES,
  NODE_DEFS,
  RECIPES,
  SEASON,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  TERRAINS,
  TOOL_TIERS,
  type NodeType,
  type RecipeId,
} from './balance'
import { harvestFactor } from './alignment'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { addItems, countOf, removeItems, type ItemId, type SkillId } from './items'
import { terrainAt, zoneAt, type WorldMap } from './map'
import { hash2 } from './noise'
import type { Entity, SimState } from './sim'
import { actForDay, seasonDayAtTick, TICKS_PER_CYCLE } from './time'
import { hasAccess, type Structure } from './village'

export interface ResourceNode {
  id: number
  type: NodeType
  tx: number
  ty: number
  stock: number
  /** Tick auquel un nœud épuisé repousse à plein (0 = jamais épuisé). */
  regrowAt: number
}

export type EconomyAction =
  | { type: 'harvest'; nodeId: number }
  | { type: 'craft'; recipeId: RecipeId }
  | { type: 'eat'; item: ItemId }

export function nodeAt(nodes: ResourceNode[], tx: number, ty: number): ResourceNode | undefined {
  return nodes.find((n) => n.tx === tx && n.ty === ty)
}

/** Niveau d'un métier : les premières marches sont rapides, la maîtrise est longue. */
export function skillLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100))
}

function levelOf(entity: Entity, skill: SkillId): number {
  return skillLevel(entity.skills[skill] ?? 0)
}

/** Gain d'XP freiné par les autres métiers (spec R14) — le spécialiste émerge. */
function gainXp(state: SimState, entity: Entity, skill: SkillId, base: number): void {
  let otherLevels = 0
  for (const s of Object.keys(entity.skills) as SkillId[]) {
    if (s !== skill) otherLevels += skillLevel(entity.skills[s] ?? 0)
  }
  const before = levelOf(entity, skill)
  entity.skills[skill] = (entity.skills[skill] ?? 0) + base / (1 + BALANCE.SKILL_SPREAD_PENALTY * otherLevels)
  const after = levelOf(entity, skill)
  if (after > before) {
    emitEvent(state, { type: 'skill_level_up', tick: state.tick, entityId: entity.id, skill, level: after })
  }
}

/** Meilleur outil de la famille dans l'inventaire : fer ×3, basique ×2, mains nues ×1. */
function toolMultiplier(entity: Entity, family: 'axe' | 'pickaxe' | null): { mult: number; toolItem: ItemId | null } {
  if (!family) return { mult: 1, toolItem: null }
  const tier = TOOL_TIERS[family]
  if (countOf(entity.inventory, tier.iron) > 0) return { mult: 3, toolItem: tier.iron }
  if (countOf(entity.inventory, tier.basic) > 0) return { mult: 2, toolItem: tier.basic }
  return { mult: 1, toolItem: null }
}

export function applyEconomyAction(state: SimState, actorId: number, action: EconomyAction): void {
  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return
  const reject = (reason: string): void => {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason })
  }
  const range = BALANCE.INTERACT_RANGE

  switch (action.type) {
    case 'harvest': {
      if (state.tick < actor.cooldownUntil) return reject('trop tôt')
      const node = state.nodes.find((n) => n.id === action.nodeId)
      if (!node || node.stock <= 0) return reject('rien à récolter')
      if (distSq(actor.x, actor.y, node.tx + 0.5, node.ty + 0.5) > range * range) return reject('trop loin')
      const def = NODE_DEFS[node.type]
      const { mult, toolItem } = toolMultiplier(actor, def.tool)
      if (def.requiresTool && !toolItem) return reject('il faut une pioche')

      const level = levelOf(actor, def.skill)
      // La Meute a une économie anémique (spec alignement R8) — mais jamais
      // nulle : plancher à 1, sinon le coup paie cooldown et XP pour rien.
      const yielded = Math.min(
        node.stock,
        Math.max(1, Math.floor(mult * (1 + BALANCE.SKILL_YIELD_BONUS * level) * harvestFactor(state, actorId))),
      )
      addItems(actor.inventory, { [def.item]: yielded })
      node.stock -= yielded
      if (node.stock <= 0) {
        // Les sources se contractent avec la saison (spec saison R1).
        const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
        node.regrowAt = state.tick + Math.floor(BALANCE.NODE_REGROW_TICKS * SEASON.REGROW_ACT_FACTOR[act - 1]!)
        emitEvent(state, { type: 'node_depleted', tick: state.tick, nodeId: node.id })
      }

      if (toolItem) {
        const wear = Math.max(
          BALANCE.TOOL_WEAR_MIN,
          1 - BALANCE.SKILL_WEAR_REDUCTION * levelOf(actor, 'crafting'),
        )
        actor.wear[toolItem] = (actor.wear[toolItem] ?? 0) + wear
        if ((actor.wear[toolItem] ?? 0) >= BALANCE.TOOL_DURABILITY) {
          removeItems(actor.inventory, { [toolItem]: 1 })
          delete actor.wear[toolItem]
        }
      }

      gainXp(state, actor, def.skill, BALANCE.XP_PER_GATHER)
      actor.cooldownUntil = state.tick + BALANCE.GATHER_COOLDOWN_TICKS
      emitEvent(state, {
        type: 'resource_harvested',
        tick: state.tick,
        entityId: actorId,
        nodeId: node.id,
        item: def.item,
        count: yielded,
      })
      return
    }

    case 'craft': {
      if (state.tick < actor.cooldownUntil) return reject('trop tôt')
      const recipe = RECIPES[action.recipeId]
      if (!recipe) return reject('recette inconnue')
      const station = state.structures.find(
        (s: Structure) =>
          s.type === recipe.station &&
          distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) <= range * range &&
          hasAccess(state, actorId, s),
      )
      if (!station) return reject(`station requise hors de portée : ${recipe.station}`)
      if (!removeItems(actor.inventory, recipe.inputs)) return reject('matériaux insuffisants')
      addItems(actor.inventory, { [recipe.output]: 1 })
      gainXp(state, actor, 'crafting', BALANCE.XP_PER_CRAFT)
      actor.cooldownUntil = state.tick + BALANCE.GATHER_COOLDOWN_TICKS
      emitEvent(state, {
        type: 'item_crafted',
        tick: state.tick,
        entityId: actorId,
        recipeId: action.recipeId,
        item: recipe.output,
      })
      return
    }

    case 'eat': {
      const value = FOOD_VALUES[action.item]
      if (value === undefined) return reject('immangeable')
      if (!removeItems(actor.inventory, { [action.item]: 1 })) return reject('stock insuffisant')
      actor.hunger = Math.min(100, actor.hunger + value)
      emitEvent(state, { type: 'meal_eaten', tick: state.tick, entityId: actorId, item: action.item })
      return
    }
  }
}

/** Passe économique du tick : faim (modulée par l'acte) et repousse des nœuds. */
export function advanceEconomy(state: SimState): void {
  const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
  const perTick =
    (BALANCE.HUNGER_PER_CYCLE_HOUR / (TICKS_PER_CYCLE / 24)) * BALANCE.ACT_HUNGER_FACTOR[act - 1]!
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  for (const entity of state.entities) {
    if (monsterIds.has(entity.id)) continue // les monstres n'ont pas faim
    entity.hunger = Math.max(0, entity.hunger - perTick)
  }
  for (const node of state.nodes) {
    if (node.stock <= 0 && state.tick >= node.regrowAt) {
      node.stock = NODE_DEFS[node.type].stock
      node.regrowAt = 0
    }
  }
}

/**
 * La « chair » procédurale (GDD §9, spec R2-R3) : remplit la carte de nœuds,
 * déterministe par seed. Le T2 (fer, charbon) n'apparaît que dans les zones
 * `kind: 'gisement'` — la carte est l'économie.
 */
export function generateNodes(map: WorldMap, seed: number): ResourceNode[] {
  const nodes: ResourceNode[] = []
  let id = 1
  const push = (type: NodeType, tx: number, ty: number): void => {
    nodes.push({ id, type, tx, ty, stock: NODE_DEFS[type].stock, regrowAt: 0 })
    id += 1
  }
  const nodeSeed = (seed ^ 0x51ab3f77) | 0
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const terrain = terrainAt(map, tx, ty)
      if (!TERRAINS[terrain]?.walkable) continue
      // Tirage POSITIONNEL : fonction pure de (tx, ty) → déplacer une tuile
      // ailleurs ne redistribue plus les nœuds (fin de la fragilité row-band).
      const r = hash2(tx, ty, nodeSeed)
      const zone = zoneAt(map, tx + 0.5, ty + 0.5)
      if (zone?.kind === 'gisement') {
        if (r < 0.07) push('iron_vein', tx, ty)
        else if (r < 0.13) push('coal_seam', tx, ty)
      } else if (zone?.kind === 'carriere') {
        if (r < 0.15) push('rock', tx, ty)
      } else if (terrain === TERRAIN_FOREST) {
        if (r < 0.22) push('tree', tx, ty)
      } else if (terrain === TERRAIN_GRASS) {
        if (r < 0.015) push('tree', tx, ty)
        else if (r < 0.028) push('rock', tx, ty)
        else if (r < 0.042) push('berry_bush', tx, ty)
        else if (r < 0.056) push('fiber_plant', tx, ty)
      } else if (terrain === TERRAIN_MARSH) {
        // Le Marais : récolte riche parce qu'on y est lent et vulnérable.
        if (r < 0.05) push('berry_bush', tx, ty)
        else if (r < 0.13) push('fiber_plant', tx, ty)
      }
    }
  }
  return nodes
}
