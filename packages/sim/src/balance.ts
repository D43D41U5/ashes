/**
 * Tous les nombres d'équilibrage du jeu vivent ici, et seulement ici.
 *
 * Règle du projet : jamais de nombre d'équilibrage en dur dans la logique.
 * Le GDD (§15) précise que tous les chiffres sont des ordres de grandeur à
 * calibrer en playtest — les centraliser rend le tuning diffable en une
 * ligne et testable par bots headless sans toucher aux systèmes.
 */
export const BALANCE = {
  /** Fréquence de la simulation, en ticks par seconde (GDD §11 : 10-15 Hz). */
  TICK_RATE_HZ: 12,

  /** Durée d'une saison en jours réels (GDD §2). */
  SEASON_DAYS: 60,

  /** Vitesse de marche d'un avatar, en tuiles par seconde. */
  WALK_SPEED_TILES_PER_S: 4,

  /** Durée du cycle jour/nuit diégétique, en minutes réelles (non accéléré). */
  CYCLE_REAL_MINUTES: 48,

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
  NODE_REGROW_TICKS: 3600,

  /** Rythme minimal entre deux récoltes/crafts (1 s) — borne de vraisemblance. */
  GATHER_COOLDOWN_TICKS: 12,

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
  BOARD_REFRESH_TICKS: 60,

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
}

export type RecipeId = 'stew' | 'axe' | 'pickaxe' | 'iron_ingot' | 'iron_axe' | 'iron_pickaxe'

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
}

/** Durée d'un tick en secondes — le seul dt qui existe dans /sim. */
export const TICK_DT_S = 1 / BALANCE.TICK_RATE_HZ
