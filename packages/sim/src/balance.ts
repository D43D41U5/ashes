/**
 * Tous les nombres d'équilibrage du jeu vivent ici, et seulement ici.
 *
 * Règle du projet : jamais de nombre d'équilibrage en dur dans la logique.
 * Le GDD (§15) précise que tous les chiffres sont des ordres de grandeur à
 * calibrer en playtest — les centraliser rend le tuning diffable en une
 * ligne et testable par bots headless sans toucher aux systèmes.
 *
 * Durées exprimées en ticks : la source de vérité est le TEMPS RÉEL (secondes,
 * cycles), converti une seule fois via `ticksFor`/`ticksForCycles` ci-dessous.
 * Changer TICK_RATE_HZ (ou CYCLE_REAL_MINUTES) recalcule tout automatiquement —
 * ne jamais coller un nombre de ticks en dur ailleurs dans /sim ou les tests ;
 * dériver de BALANCE.TICK_RATE_HZ (voir docs/decisions.md, 2026-07-05).
 */

/** Fréquence de la simulation, en ticks par seconde (GDD §11 : 10-15 Hz ;
 * dérogation actée à 20 Hz le 2026-07-05, voir docs/decisions.md). */
const TICK_RATE_HZ = 20
/** Durée du cycle jour/nuit diégétique, en minutes réelles (non accéléré). */
const CYCLE_REAL_MINUTES = 48

/** Convertit une durée réelle (secondes) en nombre de ticks, à la fréquence courante. */
const ticksFor = (seconds: number): number => Math.round(seconds * TICK_RATE_HZ)
/** Convertit un nombre de cycles jour/nuit (ex. 1/24 = une heure de cycle) en ticks. */
const ticksForCycles = (cycles: number): number => Math.round(cycles * CYCLE_REAL_MINUTES * 60 * TICK_RATE_HZ)

export const BALANCE = {
  TICK_RATE_HZ,

  /** Durée d'une saison en jours réels (GDD §2). */
  SEASON_DAYS: 60,

  /** Vitesse de marche d'un avatar, en tuiles par seconde. */
  WALK_SPEED_TILES_PER_S: 4,

  /** Durée du cycle jour/nuit diégétique, en minutes réelles (non accéléré). */
  CYCLE_REAL_MINUTES,

  /** Part du cycle qui est de jour (0.625 → 30 min de jour, 18 min de nuit). */
  CYCLE_DAY_FRACTION: 0.625,

  /** Derniers jours des actes I et II (GDD §2 : semaines 1-3, 4-6, 7-8+). */
  ACT_BOUNDARIES: [21, 42],

  /** Côté de la hitbox AABB d'un avatar, en tuiles (spec monde R9). */
  AVATAR_HITBOX_TILES: 0.6,

  /** Accélération du calendrier : jours de saison écoulés par jour réel. */
  DEFAULT_CALENDAR_SCALE: 1,

  /** Rayon de construction autour du Feu du village, en tuiles (spec village R6). */
  FIRE_BUILD_RADIUS: 20,

  /** Distance minimale entre deux Feux, en tuiles (spec village R5). */
  FIRE_MIN_DISTANCE: 48,

  /** Portée des interactions (coffres, invitations), en tuiles. */
  INTERACT_RANGE: 1.5,

  /** Part des matériaux remboursée à la démolition. */
  DEMOLISH_REFUND: 0.5,

  /** Ticks avant qu'un nœud épuisé repousse à plein (~5 min réelles). */
  NODE_REGROW_TICKS: ticksFor(300),

  /** Rythme minimal entre deux récoltes/crafts (1 s) — borne de vraisemblance. */
  GATHER_COOLDOWN_TICKS: ticksFor(1),

  /** Coups outillés avant qu'un outil soit consommé. */
  TOOL_DURABILITY: 100,

  /** Usure minimale par coup, quel que soit le niveau d'artisan. */
  TOOL_WEAR_MIN: 0.25,

  /** Perte de faim par heure de cycle (jauge 0-100 ; ~3 cycles pour la vider). */
  HUNGER_PER_CYCLE_HOUR: 1.4,

  /** Multiplicateur de faim par acte — le Grand Froid mord (GDD §2). */
  ACT_HUNGER_FACTOR: [1, 2, 3],

  /** Facteur de vitesse le ventre vide (faim à 0). */
  HUNGER_SPEED_MALUS: 0.5,

  /** XP par action. */
  XP_PER_GATHER: 1,
  XP_PER_CRAFT: 5,

  /** Bonus de rendement par niveau de métier (continu, décision actée #3). */
  SKILL_YIELD_BONUS: 0.04,

  /** Réduction d'usure infligée par niveau d'artisan. */
  SKILL_WEAR_REDUCTION: 0.03,

  /** Freinage d'XP par la somme des niveaux des AUTRES métiers (spec R14). */
  SKILL_SPREAD_PENALTY: 0.5,

  /** PNJ qui rejoignent un village fondé par un joueur (spec pnj R9). */
  NPC_PER_VILLAGE: 3,

  /** Sous ce seuil de faim, un PNJ va manger (spec pnj R3). */
  NPC_HUNGER_EAT_THRESHOLD: 30,

  /** Sous ce seuil d'énergie, la nuit, un PNJ va dormir. */
  NPC_ENERGY_SLEEP_THRESHOLD: 40,

  /** Énergie perdue par heure de cycle, éveillé. */
  ENERGY_AWAKE_PER_CYCLE_HOUR: 4,

  /** Récupération par heure de cycle en dormant — la maison vaut double (spec R4). */
  SLEEP_RECOVERY_HOME_PER_HOUR: 12,
  SLEEP_RECOVERY_FIRE_PER_HOUR: 6,

  /** Cadence de recalcul du tableau du village (5 s). */
  BOARD_REFRESH_TICKS: ticksFor(5),

  /** Cibles du grenier (spec R5). Score nourriture = baies + 3×ragoûts. */
  VILLAGE_FOOD_TARGET: 12,
  VILLAGE_WOOD_TARGET: 20,
  VILLAGE_STEW_TARGET: 3,

  /** Quantités visées par sortie de récolte PNJ, par item. */
  NPC_CARRY_TARGETS: { berries: 6, wood: 8, fiber: 3 },
} as const

export interface TerrainDef {
  name: string
  walkable: boolean
  /** Multiplicateur de vitesse de déplacement — de l'équilibrage. */
  speedFactor: number
}

/** Table des terrains. L'id est la valeur stockée dans WorldMap.terrain. */
export const TERRAINS: Record<number, TerrainDef> = {
  0: { name: 'void', walkable: false, speedFactor: 0 },
  1: { name: 'grass', walkable: true, speedFactor: 1 },
  2: { name: 'road', walkable: true, speedFactor: 1.25 },
  3: { name: 'forest', walkable: true, speedFactor: 0.8 },
  4: { name: 'shallow_water', walkable: true, speedFactor: 0.5 },
  5: { name: 'rock', walkable: false, speedFactor: 0 },
  6: { name: 'deep_water', walkable: false, speedFactor: 0 },
  7: { name: 'wall', walkable: false, speedFactor: 0 },
}

export const TERRAIN_VOID = 0
export const TERRAIN_GRASS = 1
export const TERRAIN_ROAD = 2
export const TERRAIN_ROCK = 5

export const TERRAIN_FOREST = 3

/** Coûts de construction (spec village R3 : réels dès V3). */
export const STRUCTURE_COSTS: Record<import('./items').StructureType, import('./items').Inventory> = {
  fire: { wood: 10 },
  wall: { wood: 2 },
  door: { wood: 3 },
  chest: { wood: 4 },
  workshop: { wood: 6, stone: 4 },
  furnace: { stone: 8 },
  house: { wood: 8 },
}

export type NodeType = 'tree' | 'rock' | 'fiber_plant' | 'berry_bush' | 'iron_vein' | 'coal_seam'

export interface NodeDef {
  item: import('./items').ItemId
  stock: number
  /** Arbres, affleurements et filons sont des obstacles (spec économie R1). */
  blocks: boolean
  skill: import('./items').SkillId
  /** Famille d'outil qui multiplie le rendement. */
  tool: 'axe' | 'pickaxe' | null
  /** Le T2 exige l'outil (spec R5) : rien à mains nues. */
  requiresTool: boolean
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  tree: { item: 'wood', stock: 10, blocks: true, skill: 'woodcutting', tool: 'axe', requiresTool: false },
  rock: { item: 'stone', stock: 12, blocks: true, skill: 'mining', tool: 'pickaxe', requiresTool: false },
  fiber_plant: { item: 'fiber', stock: 6, blocks: false, skill: 'foraging', tool: null, requiresTool: false },
  berry_bush: { item: 'berries', stock: 8, blocks: false, skill: 'foraging', tool: null, requiresTool: false },
  iron_vein: { item: 'iron_ore', stock: 8, blocks: true, skill: 'mining', tool: 'pickaxe', requiresTool: true },
  coal_seam: { item: 'coal', stock: 8, blocks: true, skill: 'mining', tool: 'pickaxe', requiresTool: true },
}

/** Rendement par famille d'outil : mains nues 1, outil 2, outil de fer 3. */
export const TOOL_TIERS: Record<'axe' | 'pickaxe', { basic: import('./items').ItemId; iron: import('./items').ItemId }> = {
  axe: { basic: 'axe', iron: 'iron_axe' },
  pickaxe: { basic: 'pickaxe', iron: 'iron_pickaxe' },
}

/** Valeur nutritive des consommables (spec R9). */
export const FOOD_VALUES: Partial<Record<import('./items').ItemId, number>> = {
  berries: 15,
  stew: 50,
  raw_meat: 8,
  cooked_meat: 35,
}

export type RecipeId =
  | 'stew'
  | 'axe'
  | 'pickaxe'
  | 'iron_ingot'
  | 'iron_axe'
  | 'iron_pickaxe'
  | 'spear'
  | 'cooked_meat'

export interface Recipe {
  station: 'fire' | 'workshop' | 'furnace'
  inputs: import('./items').Inventory
  output: import('./items').ItemId
}

/** Chaînes ≤ 3 étapes, stations distinctes (GDD §8, spec R10-R11). */
export const RECIPES: Record<RecipeId, Recipe> = {
  stew: { station: 'fire', inputs: { berries: 4, fiber: 1 }, output: 'stew' },
  axe: { station: 'workshop', inputs: { wood: 5, stone: 3, fiber: 2 }, output: 'axe' },
  pickaxe: { station: 'workshop', inputs: { wood: 5, stone: 3, fiber: 2 }, output: 'pickaxe' },
  iron_ingot: { station: 'furnace', inputs: { iron_ore: 2, coal: 1 }, output: 'iron_ingot' },
  iron_axe: { station: 'workshop', inputs: { iron_ingot: 2, wood: 2 }, output: 'iron_axe' },
  iron_pickaxe: { station: 'workshop', inputs: { iron_ingot: 2, wood: 2 }, output: 'iron_pickaxe' },
  spear: { station: 'workshop', inputs: { wood: 4, stone: 2, fiber: 1 }, output: 'spear' },
  cooked_meat: { station: 'fire', inputs: { raw_meat: 1 }, output: 'cooked_meat' },
}

/** Dégâts des armes portées — mains nues : COMBAT.UNARMED_DAMAGE. */
export const WEAPON_DAMAGE: Partial<Record<import('./items').ItemId, number>> = {
  spear: 16,
  iron_axe: 10,
}

export type MonsterType = 'zombie' | 'boar'

export interface MonsterDef {
  hp: number
  damage: number
  /** Vitesse en tuiles/s (les avatars marchent à WALK_SPEED_TILES_PER_S). */
  speed: number
  windupTicks: number
  attackCooldownTicks: number
  aggroRange: number
  loot: import('./items').Inventory
}

export const MONSTER_DEFS: Record<MonsterType, MonsterDef> = {
  zombie: { hp: 40, damage: 12, speed: 2.4, windupTicks: ticksFor(0.6), attackCooldownTicks: ticksFor(2), aggroRange: 6, loot: {} },
  boar: { hp: 30, damage: 8, speed: 3.6, windupTicks: ticksFor(0.4), attackCooldownTicks: ticksFor(2), aggroRange: 0, loot: { raw_meat: 3 } },
}

/** Le combat (GDD §7, spec combat) — lent, positionnel, gagné avant l'échange. */
export const COMBAT = {
  ATTACK_STAMINA: 15,
  SPRINT_STAMINA_PER_S: 8,
  BLOCK_STAMINA_BASE: 10,
  STAMINA_REGEN_IDLE_PER_S: 10,
  STAMINA_REGEN_MOVING_PER_S: 5,
  /** Modulateurs de régén : bien nourri (faim > 70) / affamé (faim 0). */
  FED_REGEN_BONUS: 1.25,
  STARVED_REGEN_MALUS: 0.5,
  WINDUP_TICKS: ticksFor(0.4),
  ATTACK_RANGE: 1.4,
  ATTACK_ARC_COS: 0.7071, // cos(45°) — arc total de 90°
  BLOCK_ARC_COS: 0.5, // cos(60°) — arc frontal de 120°
  BLOCK_REDUCTION: 0.7,
  BLOCK_MOVE_FACTOR: 0.3,
  SPRINT_FACTOR: 1.5,
  UNARMED_DAMAGE: 6,
  WOUND_THRESHOLDS: [66, 33],
  LEG_WOUND_SPEED: 0.6,
  ARM_WOUND_DAMAGE: 0.6,
  BLEED_HP_PER_S: 1.5,
  BANDAGE_FIBER_COST: 3,
  HP_REGEN_PER_MIN: 2, // si faim > 50 et pas de saignement
  RESPAWN_HP: 50,
  RESPAWN_HUNGER: 50,
  RESPAWN_STAMINA: 20,
  /** Épuisement post-mort : régén d'endurance ÷2 (~5 min démo ; GDD vise ~30 min). */
  EXHAUSTION_TICKS: ticksFor(300),
  CORPSE_TICKS: ticksFor(600),
  DEFEND_RADIUS: 10,
} as const

/**
 * PV des structures (spec événements R1). Le Feu est indestructible en V7 :
 * valeur sentinelle finie (JSON-sérialisable), et non-bloquant donc jamais
 * ciblé par le flux.
 */
export const STRUCTURE_HP: Record<import('./items').StructureType, number> = {
  fire: 999999,
  wall: 200,
  door: 150,
  chest: 100,
  workshop: 100,
  furnace: 100,
  house: 100,
}

/** Hordes & événements du monde (spec événements). */
export const WORLD_EVENTS = {
  REPAIR_WOOD_COST: 1,
  REPAIR_HP: 50,
  /** Sous cette fraction de PV, le tableau poste une tâche de réparation. */
  REPAIR_TASK_THRESHOLD: 0.6,
  /** Une alarme par vague : cooldown d'une heure de cycle. */
  ALARM_COOLDOWN_TICKS: ticksForCycles(1 / 24),
  /** Probabilité de horde par nuit, par acte (la pression du GDD §2). */
  HORDE_CHANCE_PER_NIGHT: [0.35, 0.6, 0.9],
  /** Taille de horde par acte. */
  HORDE_SIZE: [4, 8, 12],
  /** Une carcasse de convoi tous les N jours de saison. */
  CONVOY_PERIOD_DAYS: 2,
  CONVOY_GUARDS: 2,
  /** Le butin dure 2 cycles avant de se dissiper. */
  CONVOY_DECAY_TICKS: ticksForCycles(2),
} as const

export const CONVOY_LOOT: import('./items').Inventory = {
  components: 2,
  iron_ingot: 3,
  coal: 4,
}

/** La saison (GDD §2, spec saison) : la pression, la Cendre, la fin. */
export const SEASON = {
  /** Les sources se contractent : repousse des nœuds ralentie par acte. */
  REGROW_ACT_FACTOR: [1, 1.5, 2],
  /** La méga-horde du premier crépuscule de la Cendre. */
  MEGA_HORDE_SIZE: 16,
  /** Le jour où l'évacuation s'ouvre, et son rayon de « sauvetage ». */
  EVAC_DAY: 55,
  EVAC_RADIUS: 6,
} as const

/** Valeur de butin pour le verdict de la Meute (spec saison R4). */
export const LOOT_VALUES: Partial<Record<import('./items').ItemId, number>> = {
  components: 10,
  iron_ingot: 5,
  iron_axe: 3,
  iron_pickaxe: 3,
  spear: 3,
  axe: 2,
  pickaxe: 2,
}

/** Noms de villages, attribués par id (une chronique exige des noms). */
export const VILLAGE_NAMES = [
  'le Feu du Gué',
  'le Clan du Levant',
  'les Braises Hautes',
  'le Foyer des Saules',
  'la Bande du Ravin',
  'le Feu Dormant',
  'les Cendres Douces',
  'le Camp du Vieux Pont',
] as const

/** L'alignement émergent (GDD §3, spec alignement). */
export const ALIGNMENT = {
  /** Chaleur par point de faim utile donné (spec R2). */
  GIVE_WARMTH_PER_HUNGER: 0.2,
  /** Multiplicateur si le receveur est affamé (< 30). */
  NEED_FACTOR: 3,
  /** Multiplicateur par acte de la saison (le Grand Froid vaut cher). */
  ACT_FACTOR: [1, 2, 3],
  /** Dépôt de nourriture au grenier d'autrui : chaleur par point de valeur. */
  FOREIGN_DEPOSIT_WARMTH_PER_FOOD: 0.3,
  HEAL_OUTSIDER_WARMTH: 15,
  FIRST_BLOOD_WARMTH: -20,
  ONGOING_HIT_WARMTH: -2,
  RIPOSTE_WARMTH: -2,
  KILL_WARMTH: -40,
  /** Tuer un agresseur en défense « ne coûte presque rien » (GDD §3). */
  RIPOSTE_KILL_WARMTH: -4,
  DESTROY_STRUCTURE_WARMTH: -15,
  ENGAGEMENT_PER_ACT: 8,
  /** Décroissance linéaire vers 0, en points par jour de saison (le paquebot). */
  DECAY_PER_DAY: 4,
  /** Mémoire d'agression entre villages : 1 cycle. */
  AGGRESSION_MEMORY_TICKS: ticksForCycles(1),
  /** Plafond par tête à l'agrégation du Feu (GDD : un seul berserker…). */
  WARMTH_CAP_PER_HEAD: 50,
  /** Seuils d'archétype. */
  ARCHETYPE_WARMTH: 40,
  ARCHETYPE_ENGAGEMENT: 20,
  /** Effets continus : régén PV de ×0.75 (froid) à ×2 (chaud). */
  REGEN_MIN: 0.75,
  REGEN_MAX: 2,
  /** Paliers. */
  FOYER_STRUCTURE_HP_BONUS: 1.25,
  FOYER_OFFENSE_MALUS: 0.6,
  MEUTE_DAMAGE_BONUS: 1.2,
  MEUTE_HARVEST_MALUS: 0.75,
  /** Cadence de recalcul du Feu (5 s). */
  REFRESH_TICKS: ticksFor(5),
  /** Le don du Foyer PNJ (spec R14). */
  GIFT_BERRIES: 5,
} as const

/** Durée d'un tick en secondes — le seul dt qui existe dans /sim. */
export const TICK_DT_S = 1 / BALANCE.TICK_RATE_HZ
