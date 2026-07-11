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
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_BOULDERS,
  TERRAIN_BURNT_FOREST,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_HEATH,
  TERRAIN_LARCH,
  TERRAIN_MARSH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PEAT_BOG,
  TERRAIN_PINE,
  TERRAIN_REED_MARSH,
  TERRAIN_SCREE,
  TERRAINS,
  TOOL_TIERS,
  type NodeType,
  type RecipeId,
} from './balance'
import { harvestFactor } from './alignment'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { addItems, countOf, freeRoomFor, removeItems, type ItemId, type SkillId } from './items'
import { poiClearings, terrainAt, zoneAt, type WorldMap } from './map'
import { fbm2, hash2 } from './noise'
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

// Index tuile→nœud MÉMOÏSÉ par référence de tableau. Les nœuds ne bougent ni
// n'apparaissent/disparaissent au runtime (seul `stock` change) : l'index est
// construit une fois (O(N)) puis réutilisé — `nodeAt` devient O(1), condition
// des cartes denses (~140k nœuds) où collision et récolte l'appellent souvent.
// Dérivé EXTERNE (WeakMap, jamais dans SimState → invariant d'état sérialisable
// préservé, GC avec le tableau). Même sémantique que l'ancien `find` : ≤1 nœud
// par tuile (generateNodes ne pousse qu'une fois par tuile), premier gagnant.
const NODE_INDEX_STRIDE = 1_000_000 // > toute coordonnée de tuile
const nodeIndexCache = new WeakMap<ResourceNode[], Map<number, ResourceNode>>()
function nodeIndexFor(nodes: ResourceNode[]): Map<number, ResourceNode> {
  let idx = nodeIndexCache.get(nodes)
  if (idx === undefined) {
    idx = new Map()
    for (const n of nodes) {
      const key = n.tx * NODE_INDEX_STRIDE + n.ty
      if (!idx.has(key)) idx.set(key, n)
    }
    nodeIndexCache.set(nodes, idx)
  }
  return idx
}

export function nodeAt(nodes: ResourceNode[], tx: number, ty: number): ResourceNode | undefined {
  return nodeIndexFor(nodes).get(tx * NODE_INDEX_STRIDE + ty)
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
      // La place AVANT les matériaux : consommer d'abord, c'est fabriquer un objet
      // qui n'a nulle part où aller — il serait détruit, et `item_crafted` mentirait
      // à la chronique. Même règle que la récolte (spec R10) : le coup n'a pas eu lieu.
      if (freeRoomFor(actor.inventory, recipe.output) < 1) return reject('sac plein')
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
/**
 * `density` (0..1) sous-échantillonne les tuiles candidates de façon POSITIONNELLE
 * (déterministe) — pour borner le nombre de nœuds sur les très grandes cartes
 * (le SimState/snapshot transporte les nœuds à chaque tick). Défaut 1 = inchangé.
 */
// --- Clustering spatial des nœuds (INV-6, spec densité-feeling 2026-07-09) ---
// Quand la carte est sous-échantillonnée (density < 1, grandes cartes), on ne
// garde plus les tuiles candidates UNIFORMÉMENT : un champ de bruit basse
// fréquence les regroupe en bosquets/gisements, à budget CONSTANT — le facteur
// `groveBoost` est de moyenne ≈ 1 sur le domaine, donc le nombre total attendu
// de nœuds ne change pas (INV-4). Pur, exact au bit près (fbm2 : + - * / floor).
const GROVE_MEAN_SQ = 0.19 // ≈ E[fbm2³] — calibré pour préserver le total
interface GroveParams { scale: number; stretch: number } // scale = taille des amas (tuiles)
const GROVE_DEFAULT: GroveParams = { scale: 20, stretch: 1 }
// Signature de répartition par biome : grands massifs en forêt, poches serrées
// en lande, veines allongées (stretch) dans la pierre d'éboulis/blocs.
const GROVE_PARAMS: Partial<Record<number, GroveParams>> = {
  [TERRAIN_FOREST]: { scale: 28, stretch: 1 },
  [TERRAIN_OLD_GROWTH]: { scale: 28, stretch: 1 },
  [TERRAIN_PINE]: { scale: 24, stretch: 1 },
  [TERRAIN_LARCH]: { scale: 22, stretch: 1 },
  [TERRAIN_HEATH]: { scale: 14, stretch: 1 },
  [TERRAIN_SCREE]: { scale: 18, stretch: 2.5 },
  [TERRAIN_BOULDERS]: { scale: 16, stretch: 2.2 },
}
function groveBoost(tx: number, ty: number, terrain: number, seed: number): number {
  const p = GROVE_PARAMS[terrain] ?? GROVE_DEFAULT
  // stretch > 1 → amas allongés en X (veines de pierre). fbm2 ∈ [0,1), moyenne ≈ 0.5.
  const g = fbm2(tx / p.stretch, ty, p.scale, (seed ^ 0x6c8e9a3b) | 0)
  return (g * g * g) / GROVE_MEAN_SQ // (g³ normalisé) : moyenne ≈ 1, contraste amas/trouées
}

/* Sels du décalage d'origine des arbres. Deux mots de 32 bits DISTINCTS (init
 * SHA-512, aucune structure commune) : X et Y doivent être décorrélés, sinon
 * dx = dy et les arbres ne se décalent qu'en diagonale. Ce ne sont pas des
 * nombres d'équilibrage — le motif de décalage est fixe, pas un réglage. */
const JITTER_SALT_X = 0x1f83d9ab
const JITTER_SALT_Y = 0x5be0cd19

/**
 * Décalage pseudo-aléatoire de l'origine d'un arbre, DÉTERMINISTE par tuile et
 * borné à ±`BALANCE.TREE_JITTER_TILES` (tuiles), en X et en Y. Pure, sans état,
 * sans seed de monde : `hash2(tx, ty, sel)` à sels constants suffit — identique
 * sur le serveur, dans la prédiction du client et au rendu (invariant 2).
 * `hash2 ∈ [0,1)` → `(h·2−1)·J ∈ [−J, J)`. N'utilise que `+ − * /` et `hash2`.
 * Appelée dans la boucle chaude de la collision : la garder triviale.
 */
export function treeJitter(tx: number, ty: number): { dx: number; dy: number } {
  const j = BALANCE.TREE_JITTER_TILES
  const dx = (hash2(tx, ty, JITTER_SALT_X) * 2 - 1) * j
  const dy = (hash2(tx, ty, JITTER_SALT_Y) * 2 - 1) * j
  return { dx, dy }
}

export function generateNodes(map: WorldMap, seed: number, density = 1): ResourceNode[] {
  const nodes: ResourceNode[] = []
  // Les clairières des lieux : rien n'y pousse (voir `poiClearings`). Calculées
  // UNE fois — un test par tuile contre ~80 zones coûterait 170 M comparaisons
  // sur la carte de production.
  const cleared = poiClearings(map)
  let id = 1
  const push = (type: NodeType, tx: number, ty: number): void => {
    nodes.push({ id, type, tx, ty, stock: NODE_DEFS[type].stock, regrowAt: 0 })
    id += 1
  }
  const nodeSeed = (seed ^ 0x51ab3f77) | 0
  const keepSeed = (seed ^ 0x2f9e37a1) | 0
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const terrain = terrainAt(map, tx, ty)
      if (!TERRAINS[terrain]?.walkable) continue
      // Sous-échantillonnage CLUSTERISÉ (grande carte) : le champ groveBoost
      // concentre les nœuds gardés en bosquets, à budget constant (INV-4/INV-6).
      if (density < 1) {
        const keep = Math.min(1, density * groveBoost(tx, ty, terrain, keepSeed))
        if (hash2(tx, ty, keepSeed) >= keep) continue
      }
      // Tirage POSITIONNEL : fonction pure de (tx, ty) → déplacer une tuile
      // ailleurs ne redistribue plus les nœuds (fin de la fragilité row-band).
      const r = hash2(tx, ty, nodeSeed)
      const zone = zoneAt(map, tx + 0.5, ty + 0.5)
      if (zone?.kind === 'gisement') {
        if (r < 0.07) push('iron_vein', tx, ty)
        else if (r < 0.13) push('coal_seam', tx, ty)
      } else if (zone?.kind === 'carriere') {
        if (r < 0.15) push('rock', tx, ty)
      } else if (cleared.has(ty * map.width + tx)) {
        // LA CLAIRIÈRE : le lieu respire. Ni arbre, ni buisson, ni rocher — on
        // le voit venir de loin, et on sait qu'on y est arrivé.
        continue
      } else if (terrain === TERRAIN_FOREST) {
        // Forêt dense (ubac) : la meilleure source de BOIS.
        if (r < 0.22) push('tree', tx, ty)
      } else if (terrain === TERRAIN_PINE) {
        // Forêt claire (adret, pins) : moins de bois, mais des BAIES dessous.
        if (r < 0.13) push('tree', tx, ty)
        else if (r < 0.2) push('berry_bush', tx, ty)
      } else if (terrain === TERRAIN_LARCH) {
        // Mélèzes de la limite des arbres : bois clairsemé + FIBRES (herbes d'altitude).
        if (r < 0.1) push('tree', tx, ty)
        else if (r < 0.17) push('fiber_plant', tx, ty)
      } else if (terrain === TERRAIN_GRASS) {
        if (r < 0.015) push('tree', tx, ty)
        else if (r < 0.028) push('rock', tx, ty)
        else if (r < 0.042) push('berry_bush', tx, ty)
        else if (r < 0.056) push('fiber_plant', tx, ty)
      } else if (terrain === TERRAIN_MARSH) {
        // Le Marais : récolte riche parce qu'on y est lent et vulnérable.
        if (r < 0.05) push('berry_bush', tx, ty)
        else if (r < 0.13) push('fiber_plant', tx, ty)
      } else if (terrain === TERRAIN_HEATH) {
        // La lande : riche en BAIES (bruyère, myrtilles) + quelques fibres — la
        // récompense d'aller fouiller les quartiers secs.
        if (r < 0.06) push('berry_bush', tx, ty)
        else if (r < 0.12) push('fiber_plant', tx, ty)
      } else if (terrain === TERRAIN_ALPINE_MEADOW) {
        // L'alpage d'altitude : herbes/FIBRES en abondance, baies rares.
        if (r < 0.02) push('berry_bush', tx, ty)
        else if (r < 0.12) push('fiber_plant', tx, ty)
      } else if (terrain === TERRAIN_SCREE || terrain === TERRAIN_BOULDERS) {
        // Éboulis / chaos de blocs : de la PIERRE à ramasser (plus dense dans les blocs).
        if (r < (terrain === TERRAIN_BOULDERS ? 0.2 : 0.1)) push('rock', tx, ty)
      } else if (terrain === TERRAIN_OLD_GROWTH) {
        // Vieille forêt : BOIS abondant (gros arbres).
        if (r < 0.3) push('tree', tx, ty)
      } else if (terrain === TERRAIN_BURNT_FOREST) {
        // Forêt brûlée : bois mort épars + repousse de BAIES.
        if (r < 0.06) push('tree', tx, ty)
        else if (r < 0.14) push('berry_bush', tx, ty)
      } else if (terrain === TERRAIN_FLOWER_MEADOW || terrain === TERRAIN_ALPINE_FLOWERS) {
        // Prés/pelouses fleuris : FIBRES (herbes) en abondance, quelques baies.
        if (r < 0.03) push('berry_bush', tx, ty)
        else if (r < 0.15) push('fiber_plant', tx, ty)
      } else if (terrain === TERRAIN_PEAT_BOG || terrain === TERRAIN_REED_MARSH) {
        // Tourbière / roselière : FIBRES riches (roseaux, sphaigne).
        if (r < 0.04) push('berry_bush', tx, ty)
        else if (r < 0.18) push('fiber_plant', tx, ty)
      }
    }
  }
  return nodes
}
