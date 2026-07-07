/**
 * L'API publique de @braises/sim, par usage. Tout ce qui n'est pas ici est
 * un détail interne. Deux règles :
 * - le flux d'événements n'est écrit QUE par la sim (`emitEvent` et les
 *   mutateurs d'alignement `recordAct`/`recordHostility` ne sont pas
 *   exportés — un hôte qui les appellerait casserait le contrat de replay) ;
 * - les fonctions de la section « hôte/scénario » ne s'appellent que dans
 *   la phase de setup (rejouée par le replay), jamais en cours de partie.
 */

// ─── Noyau : état, tick, événements ───────────────────────────────────────
export { createSim, spawnEntity, speedScaleFor, step, snapshot } from './sim'
export type { SimState, SimOptions, Entity, MoveInput, PlayerAction } from './sim'
export { drainEvents } from './events'
export type { SimEvent } from './events'
export { createReplayLog, recordAndStep, runReplay } from './replay'
export type { ReplayLog } from './replay'
export { rngNext, rngFloat, rngRoll } from './rng'
export { hash2, gradientNoise2, fbm2, fbmWarp2 } from './noise'

// ─── Équilibrage & définitions (balance.ts — la seule source des nombres) ─
export {
  ALIGNMENT,
  BALANCE,
  COMBAT,
  CONVOY_LOOT,
  FOOD_VALUES,
  LOOT_VALUES,
  MONSTER_DEFS,
  NODE_DEFS,
  RECIPES,
  SEASON,
  STRUCTURE_COSTS,
  STRUCTURE_HP,
  TERRAINS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_VOID,
  TICK_DT_S,
  VILLAGE_NAMES,
  WEAPON_DAMAGE,
  WORLD_EVENTS,
} from './balance'
export type { MonsterDef, MonsterType, NodeDef, NodeType, Recipe, RecipeId, TerrainDef } from './balance'

// ─── Monde : carte, temps, collision, navigation ──────────────────────────
export { createEmptyMap, terrainAt, isBlockingTile, zoneAt } from './map'
export type { WorldMap, Zone } from './map'
export { getGameTime, seasonDayAtTick, actForDay, cycleOffsetForStartHour, TICKS_PER_CYCLE, DAY_TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
export type { GameTime, Act } from './time'
export { resolveMove, moveAvatar, moveAvatarStepped, overlapsBlocking, isBlockedAt } from './collision'
export type { MoveWorld } from './collision'
export { findPath, computeFlowField } from './pathfinding'
export { importTiledMap } from './tiled'
export type { TiledMapFile, TiledImportResult } from './tiled'

// ─── Actions & systèmes (l'hôte les applique, les requêtes sont pures) ────
export { applyVillageAction, structureAt, structureBlocks, getVillageOf, hasAccess } from './village'
export type { Structure, Village, VillageAction, TaskKind, VillageTask } from './village'
export { applyEconomyAction, advanceEconomy, nodeAt, skillLevel } from './economy'
export type { ResourceNode, EconomyAction } from './economy'
export { applyCombatAction, advanceCombat, weaponDamage } from './combat'
export type { CombatAction, Corpse } from './combat'
export { advanceNpcs } from './npc'
export type { Npc, NpcTaskState } from './npc'
export { advanceMonsters } from './monsters'
export type { Monster } from './monsters'
export { advanceWorldEvents } from './worldevents'
export type { Horde } from './worldevents'
export { advanceAlignment, archetypeOf, isOutsider, regenFactor, damageModifier, harvestFactor } from './alignment'
export type { Archetype, Aggression } from './alignment'
export { countOf, hasItems, addItems, removeItems } from './items'
export type { ItemId, Inventory, StructureType, AccessLevel, SkillId } from './items'

// ─── Consommateurs du flux d'événements ───────────────────────────────────
export { chronicleFromEvents } from './chronicle'

// ─── Hôte/scénario UNIQUEMENT (setup rejoué par le replay, jamais en jeu) ─
export { generateNodes } from './economy'
export { foundNpcVillage } from './worldgen'
export { spawnMonster } from './monsters'
export { spawnHorde, spawnConvoy } from './worldevents'
export { applyDamage } from './combat'
export { applyStructureDamage, grantItems } from './village'
export { generateValley } from './valleygen'
export type { ValleySkeleton, ValleyRegion, ValleyPoint } from './valleygen'
export { VEILLEE_SKELETON, VEILLEE_SITES } from './valley-veillee'

// ─── Netcode client : prédiction locale & réconciliation ──────────────────
export {
  createPrediction,
  predictFrame,
  reconcile,
  decayRenderOffset,
  renderPosition,
} from './prediction'
export type { PredictionState, PredictInput, BufferedInput } from './prediction'
