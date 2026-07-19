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
  GRENIER,
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
  hasItems,
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
import { hasAccess, structureAt, type Structure } from './village'

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
  // `aimX/aimY` (monde) : où vise le curseur, pour LE MINAGE À MAÎTRISE (spec recolte-maitrise,
  // verbe 2) — la sim en déduit le flanc frappé et le compare au bon. Absent (PNJ, plantes,
  // ou client muet) = coup baseline. Ignoré hors nœud de minage.
  | { type: 'harvest'; nodeId: number; aimX?: number; aimY?: number }
  // L'ABATTAGE À MAÎTRISE (spec recolte-maitrise, verbe 1) : le clic maintenu sur un
  // arbre EMPLIT une jauge (`harvest_charge_start`, `hold` vrai sur les frames de
  // maintien pour taire les refus — comme `attack_charge`), le relâchement porte le
  // coup (`harvest_release`). Propre si la jauge est dans le vert. `harvest` reste le
  // coup instantané au baseline (PNJ, minage, cueillette) — l'abattage à maîtrise
  // est PUREMENT ADDITIF, il ne casse rien.
  | { type: 'harvest_charge_start'; nodeId: number; hold?: boolean }
  | { type: 'harvest_release' }
  | { type: 'craft'; recipeId: RecipeId }
  | { type: 'cancel_craft'; index: number }
  | { type: 'eat'; item: ItemId }

// Index tuile→nœud MÉMOÏSÉ par référence de tableau. Le NOMBRE de nœuds ne change
// jamais au runtime, mais un nœud de bois/plante peut se DÉPLACER à l'épuisement
// (spec recolte-vivante, dérive du bosquet) : l'index est construit une fois (O(N))
// puis réutilisé — `nodeAt` devient O(1), condition des cartes denses (~140k nœuds)
// où collision et récolte l'appellent souvent — et PATCHÉ en O(1) à chaque
// relocalisation (`relocateInIndex`), jamais reconstruit. Dérivé EXTERNE (WeakMap,
// jamais dans SimState → invariant d'état sérialisable préservé, GC avec le tableau).
// Même sémantique que l'ancien `find` : ≤1 nœud par tuile, premier gagnant.
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

/** Reflète un déménagement de nœud dans l'index mémoïsé (O(1)) : l'ancienne tuile se
 *  libère, la nouvelle pointe le nœud. Ne fait rien si l'index n'est pas encore bâti
 *  (il naîtra à jour). Suppose la tuile cible libre (garanti par `relocateNode`). */
function relocateInIndex(nodes: ResourceNode[], node: ResourceNode, oldTx: number, oldTy: number): void {
  const idx = nodeIndexCache.get(nodes)
  if (idx === undefined) return
  idx.delete(oldTx * NODE_INDEX_STRIDE + oldTy)
  idx.set(node.tx * NODE_INDEX_STRIDE + node.ty, node)
}

// Tuiles des clairières de lieux, MÉMOÏSÉES par référence de carte (comme l'index
// des nœuds) : les calculer à chaque relocalisation coûterait ~170 M comparaisons
// (voir `generateNodes`). Une seule fois par carte, puis O(1).
const clearedTilesCache = new WeakMap<WorldMap, Set<number>>()
function clearedTilesFor(map: WorldMap): Set<number> {
  let cleared = clearedTilesCache.get(map)
  if (cleared === undefined) {
    cleared = poiClearings(map)
    clearedTilesCache.set(map, cleared)
  }
  return cleared
}

/* Sels de la dérive. Deux mots distincts (init SHA-256) pour dx et dy : décorrélés,
 * sinon la relocalisation ne partirait qu'en diagonale (cf. `treeJitter`). */
const RELOCATE_SALT_X = 0x3c6ef372
const RELOCATE_SALT_Y = 0xa54ff53a

/**
 * LA DÉRIVE DU BOSQUET (spec recolte-vivante R1/R2). Déplace un nœud de bois/plante
 * épuisé vers une tuile voisine VALIDE, seedée. **Pure fonction de `(nodeId, depletions)`
 * via `hash2`** — positionnelle, elle ne tire RIEN dans `state.rng`, donc elle ne décale
 * pas le flux seedé et ne casse aucun test sans rapport (invariant §2, leçon RNG connue).
 *
 * Valide = même terrain que l'origine (garantit walkable + un type légitime là ; le
 * terrain est régionalement cohérent sur `RELOCATE_RADIUS`), dans la carte, hors clairière
 * de lieu, sans autre nœud, sans structure. On sonde `RELOCATE_PROBES` candidates ; la
 * première valide gagne. Aucune valide (coin saturé, cerné d'eau) → le nœud RESTE sur
 * place — dégradation gracieuse, jamais de perte ni de nœud coincé hors-carte.
 */
function relocateNode(state: SimState, node: ResourceNode): void {
  const map = state.map
  const originTerrain = terrainAt(map, node.tx, node.ty)
  const cleared = clearedTilesFor(map)
  const depl = node.depletions ?? 0
  const R = BALANCE.RELOCATE_RADIUS
  for (let k = 0; k < BALANCE.RELOCATE_PROBES; k++) {
    const hx = hash2(node.id, depl, RELOCATE_SALT_X + k)
    const hy = hash2(node.id, depl, RELOCATE_SALT_Y + k)
    const tx = node.tx + Math.floor((hx * 2 - 1) * R)
    const ty = node.ty + Math.floor((hy * 2 - 1) * R)
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
    if (terrainAt(map, tx, ty) !== originTerrain) continue
    if (cleared.has(ty * map.width + tx)) continue
    if (nodeAt(state.nodes, tx, ty) !== undefined) continue // couvre aussi la tuile d'origine
    if (structureAt(state.structures, tx, ty) !== undefined) continue
    const oldTx = node.tx
    const oldTy = node.ty
    node.tx = tx
    node.ty = ty
    relocateInIndex(state.nodes, node, oldTx, oldTy)
    return
  }
  // Aucune tuile libre trouvée : on garde l'ancien comportement (repousse sur place).
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
 * LE MEILLEUR PALIER QUE CE NIVEAU MAÎTRISE (spec recolte-vivante Y2, gate DOUX).
 * `crude`/`none` toujours ; `basic` (atelier) dès `GATE_BASIC_LEVEL` ; `iron` (fer)
 * dès `GATE_IRON_LEVEL`. Pure et déterministe — que des comparaisons, aucun tirage.
 */
export function maxTierByLevel(level: number): ToolTier {
  if (level >= BALANCE.GATE_IRON_LEVEL) return 'iron'
  if (level >= BALANCE.GATE_BASIC_LEVEL) return 'basic'
  return 'crude'
}

/**
 * LE PALIER EFFECTIF POUR LE RENDEMENT (Y2) : l'outil TENU, plafonné par ce que le
 * niveau maîtrise. Une hache de fer en mains novices rend comme un atelier — jamais
 * rien (gate DOUX, esprit « le raté rend le baseline » de `recolte-maitrise`). Ne
 * touche PAS l'accès (`minTool`, jugé sur le palier réel dans `strikeRejection`, Y3) :
 * sinon on ne pourrait jamais miner le fer pour monter `mining` (blocage circulaire).
 */
export function effectiveTier(held: ToolTier, level: number): ToolTier {
  const cap = maxTierByLevel(level)
  return TOOL_RANK[held] <= TOOL_RANK[cap] ? held : cap
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
 * L'ÉTAT D'UNE RECETTE pour la liste de craft (maquette Turn 3A). Trois cas, PURE
 * et sans mutation — le MÊME verdict que le handler `craft`, exposé pour peindre la
 * liste sans réimplémenter la règle côté client (source unique, comme `stationFor`) :
 *
 *  - `no_station` : recette à station (Feu/établi/four) requise, absente ou hors de
 *    portée. Le rayon entier se grise (les rayons = les stations, décision 2026-07-19).
 *  - `missing`    : station là (ou recette à la main), mais ingrédients insuffisants.
 *  - `feasible`   : lançable ici et maintenant.
 *
 * Note : la file pleine (`CRAFT_QUEUE_MAX`) n'est PAS un état de recette — c'est un
 * refus transitoire au moment de l'enfilage, pas une propriété d'affichage.
 */
export type RecipeState = 'feasible' | 'missing' | 'no_station'

export function recipeState(state: SimState, actor: Entity, recipeId: RecipeId): RecipeState {
  const recipe = RECIPES[recipeId]
  if (!recipe) return 'no_station'
  if (recipe.station !== null && stationFor(state, actor, recipe) === undefined) return 'no_station'
  if (!hasItems(actor.inventory, recipe.inputs)) return 'missing'
  return 'feasible'
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

/**
 * LA LARGEUR DU VERT croît avec `woodcutting` (spec recolte-maitrise B3) : le novice
 * vise serré, le vétéran a une bande si large qu'il abat en autopilote. Plafonnée —
 * la maîtrise efface l'effort, elle ne le supprime pas. Déterministe (min/+/*).
 */
export function fellGreenWidth(level: number): number {
  return Math.min(
    BALANCE.FELL_GREEN_WIDTH_MAX_TICKS,
    BALANCE.FELL_GREEN_WIDTH_BASE_TICKS + BALANCE.FELL_GREEN_WIDTH_PER_LEVEL * level,
  )
}

/** Le coup est-il PROPRE ? La jauge (en ticks) tombe-t-elle dans le vert FIXE, dont
 *  la largeur dépend du niveau. Pure fonction — le client la miroite pour peindre. */
export function isCleanFell(ticks: number, level: number): boolean {
  const start = BALANCE.FELL_GREEN_START_TICKS
  return ticks >= start && ticks < start + fellGreenWidth(level)
}

/**
 * LE MINAGE À MAÎTRISE (spec recolte-maitrise, verbe 2) — « frapper le bon flanc ».
 * Les flancs : 0 = haut, 1 = droite, 2 = bas, 3 = gauche.
 */

/** Le flanc où le curseur vise, relatif au CENTRE du nœud : quadrant à axe dominant.
 *  Coarse — un QUART du nœud, jamais un pixel (M1). */
export function flankOfAim(node: ResourceNode, aimX: number, aimY: number): number {
  const dx = aimX - (node.tx + 0.5)
  const dy = aimY - (node.ty + 0.5)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 1 : 3
  return dy >= 0 ? 2 : 0
}

/** Le BON flanc du prochain coup, seedé. Fonction pure de `(nodeId, stock)` — sans tirage
 *  RNG (pas de flux à décaler) : il SAUTE à chaque coup (le stock baisse) et ne bouge pas
 *  pendant un coup (M4). Le client le calcule à l'identique pour peindre la lueur (C3). */
export function mineGoodFlank(nodeId: number, stock: number): number {
  return Math.floor(hash2(nodeId, stock) * 4) % 4
}

/** La tolérance d'acceptation croît avec `mining` (M3) : distance circulaire MAX admise
 *  entre le flanc visé et le bon. 0 = exact ; 1 = + les deux voisins ; 2 = tous (autopilote). */
export function mineTolerance(level: number): number {
  return Math.min(2, Math.floor(level / BALANCE.MINE_LEVELS_PER_TOLERANCE))
}

/** Le coup de minage est-il PROPRE ? Le flanc visé tombe dans la tolérance autour du bon.
 *  Pure — jugée AVANT le coup (le stock n'a pas encore baissé), miroir exact du client. */
export function isCleanMine(node: ResourceNode, aimX: number, aimY: number, level: number): boolean {
  const good = mineGoodFlank(node.id, node.stock)
  const aimed = flankOfAim(node, aimX, aimY)
  const d = Math.abs(aimed - good)
  return Math.min(d, 4 - d) <= mineTolerance(level)
}

/**
 * LA CUEILLETTE À MAÎTRISE (spec recolte-maitrise, verbe 3) — « la perception du bon coin ».
 * La maîtrise ne vit PAS au moment de la récolte (le geste est nu) mais dans le MONDE.
 */

/** La RICHESSE seedée d'un coin de cueillette : un facteur de stock centré sur ~1 (maigre →
 *  riche), pure fonction du nodeId (`hash2`, aucun flux RNG à décaler). Le client la recalcule
 *  à l'identique pour peindre la lueur (C3). Le seed 7 la distingue des autres usages de hash2. */
export function forageRichness(nodeId: number): number {
  return BALANCE.FORAGE_RICHNESS_MIN + hash2(nodeId, 7) * (BALANCE.FORAGE_RICHNESS_MAX - BALANCE.FORAGE_RICHNESS_MIN)
}

/** Applique la richesse au stock d'un coin de cueillette ; les autres nœuds sont inchangés. */
export function withForageRichness(type: NodeType, nodeId: number, stock: number): number {
  if (NODE_DEFS[type].skill !== 'foraging') return stock
  return Math.max(1, Math.floor(stock * forageRichness(nodeId)))
}

/** Le client peint-il ce coin ? Perception GATÉE par le niveau LOCAL (P3, fuite assumée) :
 *  rien sous le seuil (le novice voit uniforme), et seuls les coins RICHES luisent. Pure —
 *  testable, et miroir exact de ce que le rendu montre. */
export function forageRevealed(level: number, richness: number): boolean {
  return level >= BALANCE.FORAGE_REVEAL_LEVEL && richness >= BALANCE.FORAGE_RICH_THRESHOLD
}

/**
 * Peut-on frapper CE nœud MAINTENANT (hors cooldown, qui se juge à part) ? Rend le
 * motif de refus, ou `null` si le coup peut porter. Partagé par les trois chemins —
 * `harvest`, `harvest_charge_start` (refus précoce), `harvest_release`/auto-frappe
 * (re-vérif silencieuse, G8 : le nœud a pu se vider ou s'éloigner pendant la charge).
 */
function strikeRejection(actor: Entity, node: ResourceNode | undefined, range: number): string | null {
  if (!node || node.stock <= 0) return 'rien à récolter'
  if (distSq(actor.x, actor.y, node.tx + 0.5, node.ty + 0.5) > range * range) return 'trop loin'
  const def = NODE_DEFS[node.type]
  const { tier } = toolMultiplier(actor, def.tool)
  if (TOOL_RANK[tier] < TOOL_RANK[def.minTool]) {
    return tier === 'none' ? 'il faut une pioche en main' : 'il faut un outil forgé en main'
  }
  return null
}

/**
 * LE COUP QUI PORTE (spec recolte-maitrise). Extrait du `case 'harvest'` : rendement,
 * sac borné, épuisement, usure, XP, cooldown et événement — un seul endroit. Un coup
 * PROPRE (`clean`, abattage dans le vert) n'est qu'un coup avec un bonus DOUX (D3) :
 * +~50 % de rendement (plancher +1, sinon un arbre à 1 bois n'en verrait rien) et une
 * usure atténuée. Suppose le nœud DÉJÀ validé (`strikeRejection` a rendu `null`).
 */
function harvestStrike(state: SimState, actor: Entity, actorId: number, node: ResourceNode, clean: boolean): void {
  const def = NODE_DEFS[node.type]
  const { held, tier } = toolMultiplier(actor, def.tool)
  const level = levelOf(actor, def.skill)
  // LE RENDEMENT EN CHAÎNE (spec recolte-vivante Y2/Y4). Le palier EFFECTIF (l'outil tenu
  // plafonné par le niveau — gate DOUX) donne le gros du rendement ; une micro-marche
  // additive de compétence (`+1` tous les `SKILL_YIELD_STEP` niveaux) s'y ajoute AVANT le
  // `floor`, donc elle SURVIT à l'arrondi là où l'ancien `× (1 + 0,04·niveau)` s'écrasait.
  const tierYield = TOOL_YIELD[effectiveTier(tier, level)]
  const base = Math.max(
    1,
    Math.floor((tierYield + Math.floor(level / BALANCE.SKILL_YIELD_STEP)) * harvestFactor(state, actorId)),
  )
  // Le bonus propre est un PLANCHER À +1 : à base 1, +50 % arrondirait à 0 et la
  // maîtrise ne se verrait pas. Il croît ensuite avec le rendement de base.
  const bonus = clean ? Math.max(1, Math.round(base * BALANCE.CLEAN_YIELD_BONUS)) : 0
  const room = freeRoomFor(actor.inventory, def.item)
  if (room <= 0) {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason: 'sac plein' })
    return
  }
  const yielded = Math.min(node.stock, base + bonus, room)
  addItems(actor.inventory, { [def.item]: yielded })
  node.stock -= yielded
  if (node.stock <= 0) {
    const day = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
    node.depletions = Math.min(BALANCE.DEPLETION_MAX, (node.depletions ?? 0) + 1)
    node.forgetAt = state.tick + BALANCE.DEPLETION_FORGET_TICKS
    const usure = 1 + BALANCE.DEPLETION_REGROW_PENALTY * (node.depletions - 1)
    node.regrowAt =
      state.tick + Math.floor(BALANCE.NODE_REGROW_TICKS * SEASON.REGROW_ACT_FACTOR[day - 1]! * usure)
    // LA DÉRIVE (spec recolte-vivante D1/R1) : un nœud de bois/plante meurt sur sa tuile
    // et rouvre AILLEURS, dans le même bosquet. La pierre/le minéral reste sur place.
    // À `stock = 0` : le client peint la souche à l'ancien coin et fait grandir la pousse
    // au nouveau sur la durée `[tick, regrowAt]`. La pierre, elle, se reforme sur place.
    if (def.skill !== 'mining') relocateNode(state, node)
    emitEvent(state, { type: 'node_depleted', tick: state.tick, nodeId: node.id })
  }
  if (held) {
    const wear =
      Math.max(BALANCE.TOOL_WEAR_MIN, 1 - BALANCE.SKILL_WEAR_REDUCTION * levelOf(actor, 'crafting')) *
      (clean ? BALANCE.CLEAN_WEAR_FACTOR : 1)
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
    ...(clean ? { clean: true } : {}),
  })
}

export function applyEconomyAction(state: SimState, actorId: number, action: EconomyAction): void {
  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return
  const reject = (reason: string): void => {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason })
  }
  const range = BALANCE.INTERACT_RANGE

  switch (action.type) {
    /**
     * LE COUP INSTANTANÉ. Chemin des PNJ, des plantes ET du MINAGE À MAÎTRISE : pour un
     * nœud de minage, si le curseur vise (`aimX/aimY`), on juge le FLANC (spec verbe 2) —
     * bon flanc = coup propre. Sinon baseline. L'abattage, lui, passe par charge/relâche.
     * Le sac borné, l'usure, l'épuisement, le bonus propre : tout vit dans `harvestStrike`.
     */
    case 'harvest': {
      // PAS de refus « trop tôt » (décision d'Alexis, comme l'abattage) : le cooldown
      // reste une cadence SILENCIEUSE — un coup trop tôt ne PORTE pas, mais ne CRACHE pas
      // un rejet à l'écran. C'est le geste (le maintien cadencé du client, le tressaillement
      // du nœud à chaque coup) qui donne le rythme, pas un timer invisible qui punit.
      if (state.tick < actor.cooldownUntil) return
      const node = state.nodes.find((n) => n.id === action.nodeId)
      const bad = strikeRejection(actor, node, range)
      if (bad) return reject(bad)
      const def = NODE_DEFS[node!.type]
      const clean =
        def.skill === 'mining' && action.aimX !== undefined && action.aimY !== undefined
          ? isCleanMine(node!, action.aimX, action.aimY, levelOf(actor, 'mining'))
          : false
      harvestStrike(state, actor, actorId, node!, clean)
      return
    }

    /**
     * LA JAUGE S'ARME (spec recolte-maitrise B1). PAS de garde « trop tôt » (décision
     * d'Alexis) : c'est LE MINI-JEU qui donne la cadence, pas un cooldown — le temps
     * d'emplir la jauge EST le rythme. La charge démarre donc à froid, sans se faire
     * refuser. `hold` tait quand même les autres refus du maintien (hors portée…).
     */
    case 'harvest_charge_start': {
      const plainte = action.hold === true ? (): void => {} : reject
      if (actor.harvestCharge) return // déjà en charge : le maintien ne relance pas
      const node = state.nodes.find((n) => n.id === action.nodeId)
      const bad = strikeRejection(actor, node, range)
      if (bad) return plainte(bad)
      actor.harvestCharge = { nodeId: action.nodeId, ticks: 0 }
      return
    }

    /**
     * LE COUP PART (spec recolte-maitrise B2). Le VERT est le point où la hache
     * CONNECTE : relâcher AVANT lui n'émet RIEN — le geste est annulé, rien n'est
     * perdu, on rejoue (et c'est la garde anti-mitraillage sans cooldown : sinon un
     * clic-relâche à zéro cracherait des coups baseline à 20 Hz). Dans le vert = coup
     * PROPRE ; après le vert = baseline. On RE-VALIDE le nœud (G8 : vidé/éloigné
     * pendant la charge → muet). Relâcher sans rien d'armé est muet aussi.
     */
    case 'harvest_release': {
      const charge = actor.harvestCharge
      if (!charge) return
      delete actor.harvestCharge
      if (charge.ticks < BALANCE.FELL_GREEN_START_TICKS) return // relâché avant la connexion
      const node = state.nodes.find((n) => n.id === charge.nodeId)
      if (strikeRejection(actor, node, range)) return
      const level = levelOf(actor, NODE_DEFS[node!.type].skill)
      harvestStrike(state, actor, actorId, node!, isCleanFell(charge.ticks, level))
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
  // `preservation` MULTIPLIE le temps de péremption (1 = normal ; le Grenier > 1).
  const pourrir = (inv: Inventory, preservation: number): void => {
    for (let i = 0; i < inv.length; i++) {
      const slot = inv[i]
      if (slot === null || slot === undefined || slot.fresh === undefined) continue
      const cycles = SPOIL_CYCLES[slot.item]
      if (cycles === undefined) continue
      slot.fresh -= 1 / (cycles * preservation * TICKS_PER_CYCLE)
      if (slot.fresh <= 0) inv[i] = null // POURRI : la pile s'en va
    }
  }
  // LE GRENIER (spec construction §4bis) : un aliment rangé dans un conteneur d'un
  // amas de conservation POURRIT MOINS VITE — facteur par palier, ×bonus si clos+toité.
  const grenier = new Map<string, number>()
  for (const f of state.functions) {
    if (f.functionId !== 'grenier') continue
    const byTier = GRENIER.PRESERVATION_BY_TIER
    const base = byTier[Math.min(f.tier, byTier.length) - 1]!
    const factor = f.enclosed ? base * GRENIER.ENCLOSED_BONUS : base
    for (const t of f.componentTiles) {
      const k = `${t.tx},${t.ty}`
      grenier.set(k, Math.max(grenier.get(k) ?? 1, factor))
    }
  }
  for (const entity of state.entities) pourrir(entity.inventory, 1)
  for (const s of state.structures) {
    if (s.inventory) pourrir(s.inventory, grenier.get(`${s.tx},${s.ty}`) ?? 1)
  }
  for (const corpse of state.corpses) pourrir(corpse.inventory, 1)
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
  // LA JAUGE D'ABATTAGE MONTE (spec recolte-maitrise B1), comme la charge de combat.
  // À PLEIN sans relâcher, le coup PART tout seul au baseline : tenir sans jamais
  // viser ne bloque pas, ça hache — le repli « maintien » du geste (l'ancien G6 y
  // survit, en moins bon que le vert). On re-valide avant de frapper (G8).
  for (const entity of state.entities) {
    const charge = entity.harvestCharge
    if (charge === undefined) continue
    if (charge.ticks < BALANCE.FELL_CHARGE_MAX_TICKS) {
      charge.ticks += 1
      continue
    }
    delete entity.harvestCharge
    const node = state.nodes.find((n) => n.id === charge.nodeId)
    if (!strikeRejection(entity, node, BALANCE.INTERACT_RANGE)) {
      harvestStrike(state, entity, entity.id, node!, false)
    }
  }
  for (const node of state.nodes) {
    if (node.stock <= 0 && state.tick >= node.regrowAt) {
      // Un bon coin de cueillette repousse RICHE (la richesse est une propriété du lieu,
      // pas un stock ponctuel) — sans effet sur les autres nœuds (spec verbe 3).
      node.stock = withForageRichness(node.type, node.id, NODE_DEFS[node.type].stock)
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
    // Le CERCLE décide de ce que le nœud porte : médiocre au camp, riche au loin. Et pour la
    // cueillette, la RICHESSE seedée du coin s'y ajoute (verbe 3) — centrée sur 1, la moyenne
    // par cercle ne bouge pas, mais les bons coins se détachent pour l'œil de l'herboriste.
    const positional = Math.max(1, Math.floor(NODE_DEFS[type].stock * circleFactor(tx, ty, home)))
    const stock = withForageRichness(type, id, positional)
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
