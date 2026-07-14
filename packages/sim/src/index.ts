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
export { createSim, spawnEntity, speedScaleFor, carrySpeedFactor, step, snapshot } from './sim'
export type { SimState, SimOptions, Entity, MoveInput, PlayerAction } from './sim'
export { drainEvents } from './events'
export type { SimEvent } from './events'
export { createReplayLog, recordAndStep, runReplay } from './replay'
export type { ReplayLog } from './replay'
export { rngNext, rngFloat, rngRoll } from './rng'
export { hash2, gradientNoise2, fbm2, fbmWarp2, ridgedFbm2 } from './noise'
export { poissonPoints } from './poisson'

// ─── Équilibrage & définitions (balance.ts — la seule source des nombres) ─
export { POI,
  ALIGNMENT,
  BALANCE,
  COMBAT,
  CARRY,
  CONVOY_LOOT,
  ITEM_WEIGHT,
  FAUNA,
  FOOD_VALUES,
  HUNT,
  LOOT_VALUES,
  MONSTER_DEFS,
  NIGHT_HUNT,
  NODE_DEFS,
  RECIPES,
  SEASON,
  SLOTS,
  SPOIL,
  SPOIL_CYCLES,
  STRUCTURE_COSTS,
  STRUCTURE_HP,
  TEMPERATURE,
  TERRAINS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_VOID,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_LARCH,
  TERRAIN_BURNT_FOREST,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_HEATH,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_MARSH,
  TERRAIN_REED_MARSH,
  TERRAIN_PEAT_BOG,
  TERRAIN_SCREE,
  TERRAIN_BOULDERS,
  TERRAIN_SNOW,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
  TERRACE,
  TICK_DT_S,
  VILLAGE_NAMES,
  WEAPON_DAMAGE,
  WEAPON_PROFILES,
  WORLD_EVENTS,
} from './balance'
export type {
  CarryTier,
  MonsterDef,
  MonsterType,
  NodeDef,
  NodeType,
  Recipe,
  RecipeId,
  Strike,
  TerrainDef,
  WeaponKind,
  WeaponProfile,
} from './balance'

// ─── Monde : carte, temps, collision, navigation ──────────────────────────
export {
  createEmptyMap, terrainAt, elevationAt, isBlockingTile, zoneAt, poisAt, poiCenter, poiClearings,
  // Le contrat que /sim doit au rendu : un champ d'élévation qui ne replie pas
  // l'image. Le client le CONSTATE (assertNoFold) ; la sim le GARANTIT.
  maxSouthGradient,
} from './map'
export type { WorldMap, Zone } from './map'
export { getGameTime, seasonDayAtTick, actForDay, cycleOffsetForStartHour, TICKS_PER_CYCLE, DAY_TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
export type { GameTime, Act } from './time'
export { ambientTemperature, advanceTemperature } from './temperature'
export { resolveMove, moveAvatar, moveAvatarStepped, overlapsBlocking, isBlockedAt } from './collision'
export type { MoveWorld } from './collision'
export { findPath, computeFlowField } from './pathfinding'
export { importTiledMap } from './tiled'
export type { TiledMapFile, TiledImportResult } from './tiled'

// ─── Actions & systèmes (l'hôte les applique, les requêtes sont pures) ────
export { applyVillageAction, structureAt, structureBlocks, getVillageOf, hasAccess } from './village'
export type { Structure, Village, VillageAction, TaskKind, VillageTask } from './village'
export { applyEconomyAction, advanceEconomy, advanceCraft, advanceSpoilage, nodeAt, skillLevel } from './economy'
export type { ResourceNode, EconomyAction, CraftOrder } from './economy'
export { treeJitter } from './economy' // Tick-critique : collision, rendu, prédiction chaque frame
export { applyCombatAction, advanceCombat, weaponDamage, weaponKind, weaponProfile, pendingStrike } from './combat'
export type { CombatAction, Corpse } from './combat'
export { advanceNpcs } from './npc'
export type { Npc, NpcTaskState } from './npc'
export { advanceMonsters } from './monsters'
export type { Monster } from './monsters'
export { isPrey, isPredator, isWild, activityAt, predatorBias, sentinelOf, wolfVigor } from './faune'
export { placeHuntingGrounds } from './faune' // hôte/scénario : le semis des coins de chasse
export { advanceCendreux, willRiseAsCendreux } from './cendreux'
export { POI_CHARGES, poiFamily, advancePois } from './poi-discovery'
export type { PoiCharge } from './poi-discovery'
export { advanceWorldEvents } from './worldevents'
export { advanceNightHunt } from './nighthunt'
export type { Horde } from './worldevents'
export { advanceAlignment, archetypeOf, isOutsider, regenFactor, damageModifier, harvestFactor } from './alignment'
export type { Archetype, Aggression } from './alignment'
export {
  countOf,
  hasItems,
  addItems,
  addSlot,
  pourInto,
  removeItems,
  makeInventory,
  inventoryOf,
  toBag,
  itemsIn,
  isEmpty,
  isStackable,
  isPerishable,
  spoilTier,
  nutritionFactor,
  stackSize,
  durabilityOf,
  carryWeight,
  carryRatio,
  carryTier,
  freeRoomFor,
} from './items'
export type { ItemId, ItemBag, Slot, Inventory, SpoilTier, StructureType, AccessLevel, SkillId } from './items'

// ─── L'inventaire : la case active, ce qu'on tient VRAIMENT en main (R8-R9) ─
export { applyInventoryAction, heldSlot, wearHeld, isInventoryAction } from './inventory-actions'
export type { InventoryAction, SlotRef } from './inventory-actions'

// ─── Consommateurs du flux d'événements ───────────────────────────────────
export { chronicleFromEvents } from './chronicle'

// ─── Outils de DEV (inertes hors sim créée avec `debug: true`) ────────────
export type { DebugAction } from './debug'

// ─── Hôte/scénario UNIQUEMENT (setup rejoué par le replay, jamais en jeu) ─
export { generateNodes } from './economy'
export { foundNpcVillage } from './worldgen'
export { spawnMonster } from './monsters'
export { spawnHorde, spawnConvoy } from './worldevents'
export { applyDamage } from './combat'
export { applyStructureDamage, grantItems } from './village'
export { generateValley } from './valleygen'
export { generateAlpineTerrain, WORLDGEN_PHASES, type WorldgenPhase } from './alpinegen'
export { placePois, POI_TYPES, POI_PLACEMENT, spawnPoiMonsters } from './poi'
// Où le monde commence, et ce qui communique avec quoi — le client LIT le spawn,
// il ne le recalcule pas (il le faisait, et sans vérifier la connexité).
export {
  carveDistanceToMain,
  inMainComponent,
  walkableComponents,
  walkableSpawn,
  type CarveField,
  type WalkableComponents,
} from './connectivity'
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
