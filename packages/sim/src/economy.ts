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
  SPOIL_CYCLES,
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
  CIRCLES,
  TERRAINS,
  TOOL_RANK,
  TOOL_TIERS,
  TOOL_YIELD,
  type NodeType,
  type Recipe,
  type RecipeId,
  type ToolTier,
} from './balance'
import { harvestFactor } from './alignment'
import { die } from './combat'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { heldSlot, wearHeld } from './inventory-actions'
import {
  addItems,
  freeRoomFor,
  nutritionFactor,
  removeItems,
  type Inventory,
  type ItemBag,
  type ItemId,
  type SkillId,
} from './items'
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
  /**
   * Combien de fois ce nœud a été RASÉ récemment. Chaque passage à vide rallonge
   * la repousse suivante (GDD §8bis : « les filons s'épuisent localement et
   * rouvrent ailleurs »). C'est ce qui interdit de camper une clairière : on la
   * use, elle se ferme, on tourne. S'oublie tout seul (DEPLETION_FORGET_TICKS).
   */
  depletions?: number
  /** Tick auquel le compteur d'épuisement perdra une marche. */
  forgetAt?: number
}

/**
 * UNE LIGNE DE LA FILE DE CRAFT (spec craft-file F1). JSON-sérialisable, sans
 * classe ni `Map` : elle voyage dans le snapshot, comme tout `SimState`.
 *
 * Le temps de craft vit ICI, jamais dans un timer du client — deux horloges
 * divergeraient, et le multi deviendrait indébogable (invariant §3).
 *
 * `remainingTicks === 0` sur la tête = l'unité est FAITE et n'attend qu'une case
 * libre (F10) : c'est ce que le client montre comme « file bouchée ». `totalTicks`
 * est le dénominateur de la barre de progression — sans lui, le client devrait
 * recalculer la durée, donc connaître le niveau d'Artisan et la formule.
 */
export interface CraftOrder {
  recipeId: RecipeId
  /** Le lot : cliquer 5 fois donne UNE ligne à 5, pas cinq lignes (F3). */
  count: number
  remainingTicks: number
  totalTicks: number
  /** Station hors de portée : le compteur est gelé, l'ordre est intact (F7, F9). */
  paused: boolean
}

export type EconomyAction =
  | { type: 'harvest'; nodeId: number }
  | { type: 'craft'; recipeId: RecipeId }
  | { type: 'cancel_craft'; index: number }
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

/**
 * À quel PALIER un objet joue, pour une famille d'outil (spec craft-fortune C4).
 *
 * LA règle, en un seul endroit — le rendement (`TOOL_YIELD`) et le rang
 * (`TOOL_RANK`) en dérivent tous les deux, et ils ne disent PAS la même chose :
 * un pic de fortune RAMÈNE autant qu'une pioche d'atelier (×2) mais n'OUVRE pas
 * les filons (rang 1 < 2). Confondre les deux, c'était offrir la mine contre
 * trois pierres.
 */
export function toolTier(item: ItemId | null, family: 'axe' | 'pickaxe' | null): ToolTier {
  if (!family || item === null) return 'none'
  const tiers = TOOL_TIERS[family]
  if (item === tiers.iron) return 'iron'
  if (item === tiers.basic) return 'basic'
  if (item === tiers.crude) return 'crude'
  return 'none' // on tient autre chose : ça ne sert à rien ici
}

/**
 * Ce que l'objet OUVRE, et l'ordre dans lequel un PNJ les préfère (0 = pas un
 * outil d'ici). Distinct du rendement : à ×2 tous les deux, le hachereau et la
 * hache d'atelier départagent ICI — sinon un PNJ empoignerait le caillou ficelé
 * et laisserait la vraie hache au sac (spec C7).
 */
export function toolRank(item: ItemId | null, family: 'axe' | 'pickaxe' | null): number {
  return TOOL_RANK[toolTier(item, family)]
}

/**
 * Le rendement vient de l'objet TENU (spec inventaire R9). La sim NE FOUILLE
 * PLUS LE SAC : oublier sa hache a un coût, et c'est ce coût qui donne son poids
 * à la ceinture. `held` = on tient bien un outil de la famille (donc il s'use).
 */
function toolMultiplier(
  entity: Entity,
  family: 'axe' | 'pickaxe' | null,
): { mult: number; held: boolean; tier: ToolTier } {
  const tier = toolTier(heldSlot(entity)?.item ?? null, family)
  return { mult: TOOL_YIELD[tier], held: tier !== 'none', tier }
}

/**
 * La station de cette recette, à portée ET accessible — ou `undefined`.
 *
 * UN SEUL endroit pour cette question, parce qu'elle est posée DEUX fois et que
 * les deux réponses doivent coïncider : à l'enfilage (peut-on lancer ?) et à
 * chaque tick (doit-on mettre en pause ? spec craft-file F7). Deux copies
 * divergeraient — et la file se figerait sur une station qui avait accepté l'ordre.
 */
function stationFor(state: SimState, actor: Entity, recipe: Recipe): Structure | undefined {
  if (recipe.station === null) return undefined
  const range = BALANCE.INTERACT_RANGE
  return state.structures.find(
    (s: Structure) =>
      s.type === recipe.station &&
      distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) <= range * range &&
      hasAccess(state, actor.id, s),
  )
}

/**
 * La durée d'UNE unité, en ticks : `max(1, floor(base / (1 + bonus × niveau)))`
 * (spec craft-file F6). Déterministe — que des `+ - * /` et un `floor`, aucun
 * tirage, aucune fonction Math approximée (invariant §2).
 */
function craftTicks(actor: Entity, recipe: Recipe): number {
  const base = Math.round(recipe.seconds * BALANCE.TICK_RATE_HZ)
  const level = levelOf(actor, 'crafting')
  return Math.max(1, Math.floor(base / (1 + BALANCE.CRAFT_SPEED_BONUS * level)))
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
      const { mult, held, tier } = toolMultiplier(actor, def.tool)
      // Le filon exige la pioche EN MAIN (spec inventaire R9) : l'avoir dans le
      // sac ne suffit plus. Miner du fer en ayant laissé sa pioche au fond du
      // sac est un refus, pas un coup gratuit. Et depuis la couche 1, ce n'est
      // plus « un outil » mais un PALIER : le pic de fortune rend ×2 comme la
      // pioche d'atelier, mais il n'entame pas un filon (spec craft-fortune C5).
      if (TOOL_RANK[tier] < TOOL_RANK[def.minTool]) {
        return reject(tier === 'none' ? 'il faut une pioche en main' : 'il faut un outil forgé en main')
      }

      const level = levelOf(actor, def.skill)
      // La Meute a une économie anémique (spec alignement R8) — mais jamais
      // nulle : plancher à 1, sinon le coup paie cooldown et XP pour rien.
      const wanted = Math.min(
        node.stock,
        Math.max(1, Math.floor(mult * (1 + BALANCE.SKILL_YIELD_BONUS * level) * harvestFactor(state, actorId))),
      )
      // LE SAC EST BORNÉ (spec inventaire R10) : le nœud GARDE ce qui ne rentre
      // pas — rien ne tombe au sol, rien ne s'évapore. On ÉCRÊTE tant qu'il reste
      // une place, et on ne refuse QU'À zéro : un refus ne pose aucun cooldown,
      // donc refuser un coup à 6 bois pour une seule place libre ferait retenter
      // le PNJ à 20 Hz, pour toujours. À zéro place, le coup n'a pas eu lieu du
      // tout (ni stock, ni usure, ni cooldown, ni XP) — et la garde de `npc.ts`
      // (executeGather) libère la corvée sur ce même « zéro ».
      const room = freeRoomFor(actor.inventory, def.item)
      if (room <= 0) return reject('sac plein')
      const yielded = Math.min(wanted, room)
      addItems(actor.inventory, { [def.item]: yielded })
      node.stock -= yielded
      if (node.stock <= 0) {
        // Les sources se contractent avec la saison (spec saison R1)… ET AVEC
        // L'USAGE : un coin qu'on rase encore et encore met de plus en plus de
        // temps à revenir. C'est la rotation des filons du GDD §8bis — les points
        // de friction se DÉPLACENT, et le joueur avec eux.
        const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
        node.depletions = Math.min(BALANCE.DEPLETION_MAX, (node.depletions ?? 0) + 1)
        node.forgetAt = state.tick + BALANCE.DEPLETION_FORGET_TICKS
        const usure = 1 + BALANCE.DEPLETION_REGROW_PENALTY * (node.depletions - 1)
        node.regrowAt =
          state.tick + Math.floor(BALANCE.NODE_REGROW_TICKS * SEASON.REGROW_ACT_FACTOR[act - 1]! * usure)
        emitEvent(state, { type: 'node_depleted', tick: state.tick, nodeId: node.id })
      }

      // L'usure frappe la case TENUE (spec inventaire R6) : deux haches ne
      // partagent plus un compteur — celle qu'on tient casse seule.
      if (held) {
        const wear = Math.max(
          BALANCE.TOOL_WEAR_MIN,
          1 - BALANCE.SKILL_WEAR_REDUCTION * levelOf(actor, 'crafting'),
        )
        wearHeld(actor, wear)
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

    /**
     * ENFILER, pas produire (spec craft-file F2). Le craft n'est plus instantané :
     * les intrants partent TOUT DE SUITE, l'objet vient à l'échéance. Plus de
     * cooldown non plus — la durée le remplace.
     */
    case 'craft': {
      const recipe = RECIPES[action.recipeId]
      if (!recipe) return reject('recette inconnue')
      // `station: null` = À LA MAIN (spec craft-fortune C1) : nulle part, donc
      // partout — sans structure, sans village, sans Feu. C'est la rampe du
      // survivant nu : elle n'ajoute AUCUNE autre porte (C2).
      if (recipe.station !== null && stationFor(state, actor, recipe) === undefined) {
        return reject(`station requise hors de portée : ${recipe.station}`)
      }
      // Les clics répétés se GROUPENT (F3) : cinq cordes = une ligne « ×5 ». Sinon
      // la file déborde de l'écran au premier lot, et son bouton d'annulation
      // devient inutilisable.
      const line = actor.craftQueue.find((o) => o.recipeId === action.recipeId)
      if (!line && actor.craftQueue.length >= BALANCE.CRAFT_QUEUE_MAX) return reject('file pleine')
      if (!removeItems(actor.inventory, recipe.inputs)) return reject('matériaux insuffisants')

      if (line) line.count += 1
      else {
        const ticks = craftTicks(actor, recipe)
        actor.craftQueue.push({
          recipeId: action.recipeId,
          count: 1,
          remainingTicks: ticks,
          totalTicks: ticks,
          paused: false,
        })
      }
      emitEvent(state, { type: 'craft_queued', tick: state.tick, entityId: actorId, recipeId: action.recipeId })
      return
    }

    /**
     * ANNULER une ligne entière, et rembourser TOUT — unité en cours comprise
     * (spec craft-file F12). Aucune perte de progression : c'est le modèle Rust,
     * et c'est cohérent avec F10 (rien ne se perd, il n'y a pas de sol où jeter).
     */
    case 'cancel_craft': {
      const order = actor.craftQueue[action.index]
      if (!order) return reject('rien à annuler')
      const recipe = RECIPES[order.recipeId]
      const refund: ItemBag = {}
      for (const item of Object.keys(recipe.inputs) as ItemId[]) {
        refund[item] = (recipe.inputs[item] ?? 0) * order.count
      }
      // TOUT OU RIEN (F13) : on essaie le remboursement sur une COPIE du sac. En
      // rembourser la moitié en détruirait la moitié — le joueur fait de la place,
      // puis annule. Une copie de 18 cases est gratuite ; un objet détruit, non.
      const trial = actor.inventory.map((s) => (s === null ? null : { ...s }))
      if (Object.keys(addItems(trial, refund)).length > 0) return reject('sac plein')
      addItems(actor.inventory, refund)
      actor.craftQueue.splice(action.index, 1)
      emitEvent(state, {
        type: 'craft_cancelled',
        tick: state.tick,
        entityId: actorId,
        recipeId: order.recipeId,
        count: order.count,
      })
      return
    }

    case 'eat': {
      const value = FOOD_VALUES[action.item]
      if (value === undefined) return reject('immangeable')
      // On mange la pile la MOINS FRAÎCHE d'abord — c'est ce que ferait n'importe
      // qui, et ça évite au joueur un tri qu'on ne veut pas lui imposer.
      let pire = -1
      for (let i = 0; i < actor.inventory.length; i++) {
        const s = actor.inventory[i]
        if (s === null || s === undefined || s.item !== action.item) continue
        if (pire < 0 || (s.fresh ?? 1) < (actor.inventory[pire]!.fresh ?? 1)) pire = i
      }
      if (pire < 0) return reject('stock insuffisant')
      const slot = actor.inventory[pire]!
      const facteur = nutritionFactor(slot.fresh)
      slot.count -= 1
      if (slot.count <= 0) actor.inventory[pire] = null
      // RASSIS = MOITIÉ MOINS. Une réserve qu'on laisse traîner n'est pas une
      // réserve, c'est un souvenir : c'est ça, l'économie de FLUX du GDD §8.
      actor.hunger = Math.min(100, actor.hunger + value * facteur)
      emitEvent(state, { type: 'meal_eaten', tick: state.tick, entityId: actorId, item: action.item })
      return
    }
  }
}

/**
 * LA FILE DE CRAFT, un tick (spec craft-file F5-F11). Seule la TÊTE travaille :
 * un artisan fait une chose à la fois.
 *
 * Trois états qu'il faut savoir distinguer, et qui expliquent la forme du code :
 *   - EN PAUSE : la station a été quittée (F7). Le compteur GÈLE — l'ordre n'est
 *     ni perdu ni annulé, il reprend au retour. La couche 1 (`station: null`) ne
 *     peut jamais s'y trouver : on la fait n'importe où (F8).
 *   - EN COURS : le compteur descend.
 *   - FAITE MAIS BLOQUÉE (`remainingTicks === 0`) : l'objet est prêt, le sac est
 *     plein, LA FILE ATTEND (F10). On retente à chaque tick. Rien ne se détruit —
 *     il n'y a pas de sol où jeter dans Braises, et perdre le travail punirait une
 *     inattention. Une file bouchée SE VOIT : c'est le signal.
 */
export function advanceCraft(state: SimState): void {
  for (const entity of state.entities) {
    const order = entity.craftQueue[0]
    if (order === undefined) continue
    const recipe = RECIPES[order.recipeId]

    order.paused = recipe.station !== null && stationFor(state, entity, recipe) === undefined
    if (order.paused) continue

    if (order.remainingTicks > 0) {
      // La durée se fige au DÉMARRAGE de l'unité, pas à l'enfilage du lot (F6) :
      // tant qu'elle n'a pas été entamée, on la recalcule au niveau COURANT — un
      // Artisan qui monte pendant sa file en profite dès l'unité suivante.
      if (order.remainingTicks === order.totalTicks) {
        const ticks = craftTicks(entity, recipe)
        order.totalTicks = ticks
        order.remainingTicks = ticks
      }
      order.remainingTicks -= 1
      if (order.remainingTicks > 0) continue
    }

    // Échéance : on livre — ou on attend une case (F10). Tant qu'on attend, RIEN
    // n'est crédité : ni XP, ni `item_crafted`. L'événement suivrait l'objet, or
    // l'objet n'est pas encore là — la chronique ne doit pas mentir.
    if (freeRoomFor(entity.inventory, recipe.output) <= 0) continue
    addItems(entity.inventory, { [recipe.output]: 1 })
    gainXp(state, entity, 'crafting', BALANCE.XP_PER_CRAFT)
    emitEvent(state, {
      type: 'item_crafted',
      tick: state.tick,
      entityId: entity.id,
      recipeId: order.recipeId,
      item: recipe.output,
    })

    order.count -= 1
    if (order.count <= 0) entity.craftQueue.shift()
    else {
      const ticks = craftTicks(entity, recipe)
      order.totalTicks = ticks
      order.remainingTicks = ticks
    }
  }
}

/**
 * LA PÉREMPTION, un tick (spec `evier.md`). Tout ce qui pourrit pourrit — dans les
 * sacs, dans les coffres, sur les cadavres. Pas d'exception, sinon le coffre
 * deviendrait un congélateur gratuit et l'évier se viderait de son sens.
 *
 * Une pile à 0 DISPARAÎT. C'est brutal, et c'est le but : on ne stocke pas de la
 * nourriture, on la fait TOURNER. Le joueur n'a rien à gérer — il voit la couleur
 * de sa case changer, et il décide.
 */
export function advanceSpoilage(state: SimState): void {
  const pourrir = (inv: Inventory): void => {
    for (let i = 0; i < inv.length; i++) {
      const slot = inv[i]
      if (slot === null || slot === undefined || slot.fresh === undefined) continue
      const cycles = SPOIL_CYCLES[slot.item]
      if (cycles === undefined) continue
      slot.fresh -= 1 / (cycles * TICKS_PER_CYCLE)
      if (slot.fresh <= 0) inv[i] = null // POURRI : la pile s'en va
    }
  }
  for (const entity of state.entities) pourrir(entity.inventory)
  for (const structure of state.structures) if (structure.inventory) pourrir(structure.inventory)
  for (const corpse of state.corpses) pourrir(corpse.inventory)
}

/** Passe économique du tick : faim (modulée par l'acte) et repousse des nœuds. */
export function advanceEconomy(state: SimState): void {
  const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
  const perTick =
    (BALANCE.HUNGER_PER_CYCLE_HOUR / (TICKS_PER_CYCLE / 24)) * BALANCE.ACT_HUNGER_FACTOR[act - 1]!
  const starvePerTick = BALANCE.STARVE_HP_PER_MIN / (60 * BALANCE.TICK_RATE_HZ)
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  for (const entity of [...state.entities]) {
    if (monsterIds.has(entity.id)) continue // les monstres n'ont pas faim
    entity.hunger = Math.max(0, entity.hunger - perTick)

    // LA FAIM TUE. Elle ne faisait que ralentir : ce n'est pas une punition, c'est
    // une remarque. Un joueur qui ignore sa jauge doit MOURIR — sinon la nourriture
    // n'est pas une ressource, c'est un décor. Même chemin que le froid (die avec
    // sa cause) : la chronique doit pouvoir dire de QUOI on est mort.
    if (entity.hunger <= 0 && entity.hp > 0) {
      const before = entity.hp
      entity.hp = Math.max(0, entity.hp - starvePerTick)
      if (before > 0 && entity.hp <= 0) die(state, entity, 0, 'hunger')
    }
  }
  for (const node of state.nodes) {
    if (node.stock <= 0 && state.tick >= node.regrowAt) {
      node.stock = NODE_DEFS[node.type].stock
      node.regrowAt = 0
    }
    // Le monde OUBLIE : un coin qu'on laisse tranquille se refait une santé. Sans
    // ça, une carte finirait par se fermer partout — et un monde mort n'est pas un
    // monde tendu, c'est un monde fini.
    if (node.depletions !== undefined && node.forgetAt !== undefined && state.tick >= node.forgetAt) {
      node.depletions -= 1
      if (node.depletions <= 0) {
        delete node.depletions
        delete node.forgetAt
      } else {
        node.forgetAt = state.tick + BALANCE.DEPLETION_FORGET_TICKS
      }
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

/**
 * LA RICHESSE D'UN NŒUD, selon le cercle où il tombe (GDD §8bis, `CIRCLES`).
 * Pure et déterministe : `+ − × ÷` et `sqrt`. `home` absent = monde uniforme (les
 * bancs de test ne veulent pas d'une géographie qu'ils n'ont pas demandée).
 */
function circleFactor(tx: number, ty: number, home: { x: number; y: number } | undefined): number {
  if (!home) return 1
  const d = Math.sqrt((tx - home.x) * (tx - home.x) + (ty - home.y) * (ty - home.y))
  if (d <= CIRCLES.DOMESTIC_RADIUS) return CIRCLES.DOMESTIC_STOCK
  if (d >= CIRCLES.WILD_RADIUS) return CIRCLES.WILD_STOCK
  return CIRCLES.CONTESTED_STOCK
}

export function generateNodes(
  map: WorldMap,
  seed: number,
  density = 1,
  home?: { x: number; y: number },
): ResourceNode[] {
  const nodes: ResourceNode[] = []
  // Les clairières des lieux : rien n'y pousse (voir `poiClearings`). Calculées
  // UNE fois — un test par tuile contre ~80 zones coûterait 170 M comparaisons
  // sur la carte de production.
  const cleared = poiClearings(map)
  let id = 1
  const push = (type: NodeType, tx: number, ty: number): void => {
    // Le CERCLE décide de ce que le nœud porte : médiocre au camp, riche au loin.
    const stock = Math.max(1, Math.floor(NODE_DEFS[type].stock * circleFactor(tx, ty, home)))
    nodes.push({ id, type, tx, ty, stock, regrowAt: 0 })
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
