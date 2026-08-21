/**
 * L'API publique de @ashes/sim, par usage. Tout ce qui n'est pas ici est
 * un détail interne. Deux règles :
 * - le flux d'événements n'est écrit QUE par la sim (`emitEvent` et les
 *   mutateurs d'alignement `recordAct`/`recordHostility` ne sont pas
 *   exportés — un hôte qui les appellerait casserait le contrat de replay) ;
 * - les fonctions de la section « hôte/scénario » ne s'appellent que dans
 *   la phase de setup (rejouée par le replay), jamais en cours de partie.
 */

// ─── Noyau : état, tick, événements ───────────────────────────────────────
export { createSim, spawnEntity, despawnAvatar, speedScaleFor, carrySpeedFactor, step, snapshot } from './sim'
export type { SimState, SimOptions, Entity, MoveInput, PlayerAction, RefugeeGroup } from './sim'
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
  AGRICULTURE,
  FAUNA,
  FOOD_VALUES,
  HUNT,
  LOOT_VALUES,
  MONSTER_DEFS,
  MORTS,
  NIGHT_HUNT,
  NODE_DEFS,
  RECIPES,
  SEASON,
  SLOTS,
  FIRE_UPKEEP,
  SPOIL,
  SPOIL_CYCLES,
  STRUCTURE_COSTS,
  STRUCTURE_HP,
  WALL_TIERS,
  WALL_MATERIAL_ORDER,
  COMPONENTS,
  COMPONENT_TYPES,
  FUNCTIONS,
  GEL,
  GRENIER,
  TEMPERATURE,
  TERRAINS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_CLIFF,
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
  TERRAIN_WILLOW,
  TERRAIN_WET_MEADOW,
  TERRAIN_JUNIPER_HEATH,
  TICK_DT_S,
  VILLAGE_NAMES,
  WEAPON_DAMAGE,
  isRangedWeapon,
  WEAPON_PROFILES,
  WORLD_EVENTS,
  TOOL_RANK,
  TOOL_YIELD,
} from './balance'
export type {
  CarryTier,
  ToolTier,
  MonsterDef,
  MonsterType,
  NodeDef,
  NodeType,
  Recipe,
  RecipeId,
  ComponentType,
  FunctionId,
  Strike,
  TerrainDef,
  WallMaterial,
  WeaponKind,
  WeaponProfile,
} from './balance'

// ─── Monde : carte, temps, collision, navigation ──────────────────────────
export {
  createEmptyMap, terrainAt, isBlockingTile, zoneAt, poisAt, poiCenter, poiClearings,
  profondeurAt,
} from './map'
export { deriverProfondeur, estCoeur, estLisiere, TERRAINS_BOISES_MASSIF } from './profondeur'
export { CREUX } from './racine-relief'
export type { WorldMap, Zone } from './map'
export { getGameTime, seasonDayAtTick, actForDay, cycleOffsetForStartHour, calendarScaleForSeasonCycles, TICKS_PER_CYCLE, DAY_TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
export type { GameTime, Act } from './time'
export { ambientTemperature, baselineTemperature, baselineTemperatureAt, climatFlore, climatMaximal, advanceTemperature } from './temperature'
// LA BRUME (spec brume.md) : le client rendra la nappe en la RECALCULANT du tick (patron front
// de Cendre) — la géométrie pure et le bloc de calibration s'exportent, l'ordonnanceur non.
export { brumeCentre, dansLaBrume, brumeJourEligible } from './brume'
export type { Brume } from './brume'
export { BRUME } from './balance'
// LA MÉTÉO (spec meteo.md) : le client rendra le front en le RECALCULANT du tick
// (patron Brume) — la géométrie pure, l'intensité, le froid (R4, tranche 2), le mouillé et
// la faim du feu (R5, tranche 4), la vitesse et la perception (R7, tranche 5 — la
// prédiction locale devra passer le MÊME `meteoSpeedFactor` à `speedScaleFor`), la foudre
// (R8, tranche 6 — le client dessine la lueur du télégraphe depuis `foudreTelegrapheAt` et
// l'éclair depuis `foudreImpactAt`, rien ne transite) et le bloc de calibration
// s'exportent, l'ordonnanceur et la résolution non.
export {
  FOUDRE_CRENEAU_TICKS, foudreImpactAt, foudreTelegrapheAt, frontMeteoPos, meteoCold, meteoFeuConso,
  meteoIntensity, meteoIntensityAt, meteoCycleEligible, meteoMouille, meteoQuiet, meteoSpeedFactor,
  meteoSpeedFactorAt, meteoTypeBrut, meteoTypeDuCycle, meteoVisionFactor, frontDuCycle, meteoColdAt,
} from './meteo'
export type { MeteoFront, MeteoType, BandeMeteo, FoudreImpact } from './meteo'

// LE GEL (spec gel.md) — le monde change d'état avec sa température, sans qu'une tuile ne
// bouge. Tout est DÉRIVÉ : le client lira EXACTEMENT ces fonctions pour peindre la glace
// (G5 : « on ne s'engage jamais sur la glace par surprise »), le feuillage nu (G6) et la
// neige au sol (G7) — aucune seconde loi côté rendu, aucun octet de plus dans le snapshot.
// `gelPossible` est la porte d'entrée bon marché : fausse, il n'y a rien à peindre.
export {
  estGele, gelPossible, vitesseSurGlace,
  feuillageDenude, jourDeDefeuillaison, neigeAuSol,
  bandeDuCycle, jourDuCycle, advanceDegel,
  // LE FROID SUR LA FLORE (spec `flore-froid.md`) : le client peint la plante gelée avec le
  // MÊME prédicat que la sim lui applique — écrivain unique, comme la glace et le feuillage.
  floreGelee, floreEntierementGelee, gelMortel,
} from './gel'
export { METEO } from './balance'
// LE FEU-STATION (spec feu-station) : l'état dérivable du snapshot côté client, et la donnée des slots.
export { fireState, fireStateAt, fireActive, fireWarmthFactor, advanceFire, fuelTicksRemaining, fuelBurnProgress } from './fire'
export { fireZoneInventory, fireZoneAccepts, fireSlotLocked } from './fire'
export type { FireState, FireZone } from './fire'
export { FIRE, COOK_SLOT } from './balance'
export { resolveMove, moveAvatar, moveAvatarStepped, overlapsBlocking, isBlockedAt } from './collision'
export type { MoveWorld } from './collision'
export { findPath, computeFlowField } from './pathfinding'
export { importTiledMap } from './tiled'
export type { TiledMapFile, TiledImportResult } from './tiled'

// ─── Actions & systèmes (l'hôte les applique, les requêtes sont pures) ────
export { applyVillageAction, structureAt, solidAt, floorAt, roofAt, structureBlocks, getVillageOf, hasAccess, fireRadius, evaluateBuild, buildPlacementValid } from './village'
export type { Structure, Village, VillageAction, TaskKind, VillageTask, BuildEval, BuildReject } from './village'
export { blocksNavigation, placementKeepsNavigable, isComponent, recognizeFunctions, refreshFunctions, fullTileAt, edgeBarrierAt, crossingBlocker, doorPairs, terrainConstructible, POSABLE_SUR_EAU } from './construction'
export type { PlacedStructure, RecogStructure, RecognizedFunction, EdgeAware, DoorPairing } from './construction'
/** LE VOCABULAIRE DES ARÊTES (spec construction R23) — la même valeur traverse le fantôme du
 *  client, le protocole, la validation du serveur et la collision : une seule définition. */
export { EDGE_N, EDGE_E, EDGE_S, EDGE_O, EDGE_BITS, edgeBits, edgeStep, oppositeEdge, isSingleEdge } from './geometry'
/** La distance de Chebyshev — celle, et pas une autre, qui décrit le CARRÉ du Feu (spec
 *  construction R2). Exportée pour que le client dessine et teste la MÊME frontière que
 *  `evaluateBuild` : une seconde formule au client, c'est un liseré qui ment d'une tuile. */
export { chebyshev } from './geometry'
// `toolTier` est exporté pour le RÉSOLVEUR DE CLIC du client (`aim.ts`) : depuis que la hache
// est une arme (décision d'Alexis 2026-08-20), il doit savoir si l'objet en main est l'outil de
// la famille du nœud visé. Il ne RECOPIE pas la règle — il appelle celle-ci, qui reste « LA règle,
// en un seul endroit » dont `TOOL_YIELD` et `TOOL_RANK` dérivent tous les deux.
export { applyEconomyAction, advanceEconomy, advanceCraft, advanceSpoilage, nodeAt, skillLevel, recipeState, fellGreenWidth, isCleanFell, flankOfAim, mineGoodFlank, mineTolerance, isCleanMine, forageRichness, forageBounty, maxTierByLevel, effectiveTier, toolTier } from './economy'
export type { ResourceNode, EconomyAction, CraftOrder, RecipeState } from './economy'
export { treeJitter } from './economy' // Tick-critique : collision, rendu, prédiction chaque frame
// LE DÉFRICHEMENT (`defriche.ts`) : le client applique le MÊME prédicat que la sim — c'est
// ce qui lui évite de dessiner un arbre que la sim a déjà rendu à l'état de souche.
export { dansEmprise, noeudDefrichable, noeudDefriche, poseLibre, rayonEmprise } from './defriche'
export { cropStage, isCropMature, isPlot } from './agriculture' // le potager (voie A) : maturité PURE, lue par le rendu
export { applyCombatAction, advanceCombat, weaponDamage, weaponKind, weaponProfile, pendingStrike } from './combat'
export type { CombatAction, Corpse } from './combat'
export { advanceNpcs } from './npc'
export type { Npc, NpcTaskState } from './npc'
export { advanceMonsters } from './monsters'
export type { Monster } from './monsters'
export { isPrey, isPredator, isWild, activityAt, predatorBias, sentinelOf, wolfVigor } from './faune'
export { placeHuntingGrounds } from './faune' // hôte/scénario : le semis des coins de chasse
export { advanceCendreux, willRiseAsCendreux } from './cendreux'
/** LE SOL QUI TRAVAILLE (spec `cendreux.md` R21) — le client le PEINT : il lui faut le type
 *  des entrées du snapshot, et la durée du réveil pour en tirer l'avancement de sa rampe. */
export type { Reveil } from './morts'
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
export type { ItemId, ItemBag, Slot, Inventory, SpoilTier, StructureType, BarrierType, AccessLevel, SkillId } from './items'

// ─── LE REGISTRE DES PIÈCES (2026-08-01) ──────────────────────────────────
// La source unique de tout ce qui décrit une pièce. `STRUCTURE_COSTS`, `STRUCTURE_HP`,
// `COMPONENTS`, `FUNCTIONS` et les libellés n'en sont plus que des VUES. Le client y lit
// ses menus (rayon, libellé, coût, geste de pose) au lieu de tenir ses propres listes.
export {
  PIECES,
  STRUCTURE_TYPES,
  BARRIER_TYPES,
  FONCTION_LABEL,
  FONCTION_NOM,
  nomExigence,
  piece,
  parPiece,
  palierDe,
  coutObjet,
  bloqueNavigation,
  capaciteStation,
  sertExigence,
  libelleExigence,
  matieresDe,
  matiereChiffre,
} from './pieces'
export type { PieceDef, Famille, Pose, Occupe, Arete, Bloque, Exigence, StationFonction, Matiere } from './pieces'

// ─── L'inventaire : la case active, ce qu'on tient VRAIMENT en main (R8-R9) ─
export { applyInventoryAction, heldSlot, wearHeld, isInventoryAction } from './inventory-actions'
export type { InventoryAction, SlotRef } from './inventory-actions'

// ─── Consommateurs du flux d'événements ───────────────────────────────────
export { chronicleFromEvents, formatChronicleLine, CHRONICLE_EVENT_TYPES } from './chronicle'
export type { ChronicleEntry, ChronicleWeight } from './chronicle'

// ─── Persistance : sérialiser/reprendre une Veillée (l'hôte écrit dans IndexedDB) ─
export {
  serializeSim,
  deserializeSim,
  // La carte à part : elle ne change jamais, l'autosave ne la réécrit plus (voir `persistence.ts`).
  serializeCarte,
  deserializeCarte,
  serializePartie,
  deserializePartie,
  // LA POLITIQUE DE SAUVEGARDE elle-même, pour que l'hôte cesse de la tenir à la main
  // (et que le test cesse d'en éprouver un sosie).
  creerCoffre,
  type Coffre,
  type EcritureDeSauvegarde,
  SAVE_FORMAT_VERSION,
} from './persistence'
export type { CarteSauvee } from './persistence'
// Le diff des nœuds : les 125 686 nœuds ne se réécrivent plus en entier deux fois par minute.
export { baseDepuisNoeuds, diffNoeuds, appliqueDiffNoeuds, PART_DU_NOEUD } from './node-baseline'
export type { BaseNoeuds, DiffNoeuds, NoeudMuable } from './node-baseline'

// ─── Outils de DEV (inertes hors sim créée avec `debug: true`) ────────────
export type { DebugAction } from './debug'

// ─── Hôte/scénario UNIQUEMENT (setup rejoué par le replay, jamais en jeu) ─
export { generateNodes } from './economy'
export { foundNpcVillage } from './worldgen'
export { spawnMonster } from './monsters'
export { spawnHorde, spawnConvoy } from './worldevents'
export { applyDamage } from './combat'
export { advanceUpkeep, applyStructureDamage, grantItems } from './village'

// ── LA VALLÉE — un graphe de zones, un terrain qui en découle (spec `worldgen.md`) ──
// (L'ANCIENNE pile `valleygen` — squelette déclaratif + chair procédurale, juillet 2026 — a été
//  SUPPRIMÉE le 2026-08-02 : `scenario.ts` avait migré vers `generateZonedTerrain`, plus personne
//  ne l'appelait. C'est l'item 18 de `docs/audit-gameplay-phase1.md` — « deux stacks de génération
//  de carte », dont le banc calibrait sur une carte que le joueur ne voyait jamais — refermé par
//  la suppression plutôt que par la vigilance. Elle reste dans git si le squelette déclaratif
//  redevenait un jour la bonne idée.)
export {
  deriveGrapheZones, echantillonAt, MONDE, MONDE_JOUE, tailleCarte, ZONES,
  type GrapheZones, type MondeGen, type Seuil, type Tier, type Zone as ZoneDef,
} from './zonegraph'
export { generateZonedTerrain, RELIEF, type CarteZonee } from './zonegen'
// LE FRONT DE CENDRE — la saison est une vallée qu'on perd (spec `worldgen.md` §7).
export { avanceeDuFront, calibreLeFront, CENDRE, estCendre, partSousLaCendre } from './cendre'
export { zoneSlugAt, zoneIdAt } from './map'
export {
  clairiereForet, CONTENU, CONTENUS, emplacementsDeVillage, placeZoneNodes, pointsDeSpawn, tailleDeBloc, type DangersDePlacement, type Emplacement,
} from './zone-content'
export { nidsAMonstre, placePois, POI_TYPES, POI_PLACEMENT, spawnPoiMonsters } from './poi'
export { buildPoiStructures, batirLieu, BUILT_KINDS, PLANS, LEGENDE, regionDe, verifierPlan, verifierPlans, type Plan, type Case } from './poi-batis'
export { parserPlan, serialiserPlan } from './plan-format'
export { sortDuLieu, usureSelonSort, type SortDuLieu } from './sort-des-lieux'
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

// ─── Protocole hôte ⇄ client (transport-agnostique — Worker ou serveur) ───
export { PROTOCOL_VERSION, CHAT_RADIUS_TILES, CHAT_MAX_LEN } from './protocol'
// Le DIFF des stocks de nœuds : mécanique de protocole, partagée par les deux hôtes
// (serveur LAN et worker Veillée) pour qu'ils ne puissent plus en diverger.
export { collectNodeDeltas, createNodeShadow, seedNodeShadow, type NodeShadow } from './node-shadow'
// LA ZONE D'INTÉRÊT : chacun ne reçoit que ce qui l'entoure (bande passante ET anti-ESP).
export { filtreParInteret, INTEREST_RADIUS_TILES } from './interest'
export type {
  ClientToHost,
  HostToClient,
  JoinMessage,
  InputMessage,
  ActionMessage,
  ChatMessage,
  ChatBroadcast,
  PauseMessage,
  ResumeMessage,
  DebugSpeedMessage,
  ReadyMessage,
  ProgressMessage,
  SnapshotMessage,
  PerfMessage,
  NodeDelta,
} from './protocol'

// ─── Netcode client : prédiction locale & réconciliation ──────────────────
export {
  createPrediction,
  predictFrame,
  reconcile,
  decayRenderOffset,
  renderPosition,
} from './prediction'
export type { PredictionState, PredictInput, BufferedInput } from './prediction'
