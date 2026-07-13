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

/** Jauge Température (spec 2026-07-08). Ordres de grandeur, à calibrer en playtest. */
export const TEMPERATURE = {
  BASE: 90, // cible d'un bas de vallée, jour, acte I
  ALT_COLD: 70, // refroidissement max au sommet (elevation 1)
  NIGHT_COLD: 20,
  ACT_COLD: [0, 25, 40] as const, // par acte (I, Grand Froid, Cendre), soustrait
  /** Décalage signé par terrain (id de TERRAINS). Absent = 0. */
  BIOME_OFFSET: {
    3: 5, 13: 5, 14: 5, 22: 5, // forêts (couvert)
    8: -5, 18: -5, 19: -5, // marais/tourbière/roselière (mouillé)
    10: -10, // neige
    15: -15, // glacier
  } as Record<number, number>,
  FIRE_WARMTH: 80, // cible au contact d'un feu
  FIRE_RANGE: 6, // tuiles
  SHELTER_FACTOR: 0.5, // sous toit : nuit+biome × 0.5
  /** Fraction de l'écart à l'ambiant comblée par tick (÷ isolation). Calibrage :
   *  ~2 min réelles vers l'engourdissement, ~6 min vers l'hypothermie à ambiant 0. */
  K_DRIFT: 0.0002,
  /** Isolation du corps nu (stub ; la Couture la fera monter plus tard). */
  INSULATION_BODY: 1,
  COMFORT: 60, // au-dessus : aucun effet
  HYPOTHERMIA: 20, // en dessous : dégâts
  HYPOTHERMIA_DAMAGE_MAX: 0.3, // PV/tick à température 0
  SPEED_FLOOR: 0.6, // vitesse au plus froid
  STAMINA_FLOOR: 0.5, // régén d'endurance au plus froid
}

/**
 * Les lieux chargés (spec `docs/specs/lieux.md`). Ordres de grandeur, à
 * calibrer en jeu — pas des vérités.
 */
export const POI = {
  /**
   * Du Belvédère, on voit loin : rayon de révélation, en tuiles.
   *
   * CALIBRÉ EN JEU (2026-07-11) sur la vraie carte (1200×1800, 5 seeds). Les 40
   * tuiles d'origine étaient MORTES : le semis Poisson espace les lieux d'au
   * moins 96 tuiles (`POI_PLACEMENT.SPACING_FRAC × min(w,h)`), donc un Belvédère
   * posé n'importe où ne révélait RIEN, sur 79 lieux et 5 seeds. Aucun test
   * headless ne pouvait le voir : ils posent leurs propres zones à 10 tuiles.
   * À 300 : ~8 lieux révélés en moyenne, jamais zéro — une grappe.
   */
  REVEAL_BELVEDERE_TILES: 300,
  /**
   * De l'Arche, on voit les abris de l'autre versant. Même portée que le
   * Belvédère, mais filtrée aux `shelter` : ~2 abris en moyenne (ils sont plus
   * rares). Même erreur d'origine — 30 tuiles ne révélaient jamais rien.
   */
  REVEAL_ARCHE_TILES: 300,
  /** La Source chaude est un feu qu'on n'a pas allumé (mêmes unités que FIRE_WARMTH/FIRE_RANGE). */
  HOTSPRING_WARMTH: 75,
  HOTSPRING_RANGE_TILES: 4,
  /** Le Tarn est une halte : régén d'endurance multipliée sur son empreinte. */
  TARN_STAMINA_FACTOR: 1.5,
  /**
   * LA PORTÉE DE VUE (2026-07-11), en tuiles. On ne se plante pas sur un
   * Sanctuaire pour savoir qu'il existe : on l'APERÇOIT, et il entre dans la
   * carte. Calé sur ce qui tient à l'écran (viewport 1280×720, tuile 16 px,
   * zoom ~2,25 → ~35 tuiles de large) : 14 tuiles = un lieu bien dans le cadre,
   * pas un coin d'écran. C'est aussi la raison d'être de la passe d'art : un
   * monument qui dépasse la canopée SE VOIT VENIR, donc s'apprend de loin.
   *
   * ATTENTION — voir ne donne PAS la charge. Le Belvédère ne révèle sa grappe
   * que si l'on MONTE dessus (sinon il ne ferait plus grimper), et « le premier
   * à ATTEINDRE le Sanctuaire » ne peut pas être quelqu'un qui l'a vu de loin.
   */
  SIGHT_TILES: 14,
  /**
   * LA CLAIRIÈRE (2026-07-11) : marge dégagée autour de l'empreinte d'un lieu,
   * en tuiles. Rien n'y pousse — ni arbre, ni buisson, ni rocher, ni décor.
   * Un lieu enseveli sous la forêt n'est pas un lieu : on ne le voit pas venir,
   * et on ne sait pas qu'on y est. Rayon total = demi-empreinte + cette marge.
   * Ne s'applique PAS aux gisements/carrières : on ne dégage pas une mine.
   */
  CLEARING_MARGIN_TILES: 3,
  /** Ce que les Pétroglyphes savent montrer : les lieux ANCIENS. */
  ANCIENT_KINDS: ['ruines', 'mine', 'sanctuaire', 'oratoire'] as readonly string[],
}

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

  /** Heure murale de l'aube — le cycle démarre au lever du jour, mais l'horloge
   * affichée est une horloge murale : minuit (0h) au cœur de la nuit, midi en plein
   * jour. Avec DAWN=6 et DAY_FRACTION=0.625 : jour 6h→21h, nuit 21h→6h. */
  CYCLE_DAWN_HOUR: 6,

  /** Derniers jours des actes I et II (GDD §2 : semaines 1-3, 4-6, 7-8+). */
  ACT_BOUNDARIES: [21, 42],

  /** Côté de la hitbox AABB d'un avatar, en tuiles (spec monde R9). */
  AVATAR_HITBOX_TILES: 0.6,

  /** Résolution de la collision sous-tuile : sous-tuiles par côté de tuile.
   * PUISSANCE DE DEUX obligatoire — la collision multiplie et divise par cette
   * valeur, et seule une puissance de deux garantit `fl(8a − 8b) = 8·fl(a − b)`,
   * donc l'exactitude au bit près face à l'ancienne collision en tuiles pleines
   * (invariant 2). 8 permet un tronc centré de 2 sous-tuiles (0,25 tuile) qui
   * laisse 0,75 tuile d'écart entre deux troncs voisins — l'avatar (0,6) passe. */
  SUBTILES_PER_TILE: 8,

  /** Amplitude du décalage pseudo-aléatoire de l'origine d'un arbre, en tuiles
   * (spec décalage d'origine). Chaque arbre est décalé de ±cette valeur en X et
   * en Y pour casser l'alignement des troncs en grille. BORNE DURE :
   * `TREE_JITTER_TILES + blockHalfSub(tree)/SUBTILES_PER_TILE ≤ 0.5`, sinon le
   * carré bloquant d'un arbre décalé déborde dans la tuile voisine et échappe à
   * la collision (testé). Avec blockHalfSub 1 et SUB 8 : plafond 0,375. Calibré
   * en jeu (départ 0,22). */
  TREE_JITTER_TILES: 0.3,

  /** Accélération du calendrier : jours de saison écoulés par jour réel. */
  DEFAULT_CALENDAR_SCALE: 1,

  /** Rayon de construction autour du Feu du village, en tuiles (spec village R6). */
  FIRE_BUILD_RADIUS: 20,

  /** Distance minimale entre deux Feux, en tuiles (spec village R5). */
  FIRE_MIN_DISTANCE: 48,

  /** Portée des interactions (coffres, invitations), en tuiles. */
  INTERACT_RANGE: 1.5,

  /** Portée de bras pour bâtir/démolir, en tuiles (vraisemblance, GDD §11). */
  BUILD_RANGE: 6,

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

  /**
   * L'ARTISAN ÉCONOMISE LE TEMPS DES AUTRES (GDD §8bis, spec craft-file F6) :
   * `durée = max(1, floor(base / (1 + CRAFT_SPEED_BONUS × niveau)))`. C'est ici,
   * et pas dans un bonus de rendement, que la spécialisation prend son sens — le
   * spécialiste fait en 20 min ce que le novice fait en 45.
   */
  CRAFT_SPEED_BONUS: 0.15,
  /** Lignes maximum dans la file : l'écran doit pouvoir la montrer ENTIÈRE (F4). */
  CRAFT_QUEUE_MAX: 6,

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

  /** Sous ce seuil de température, un PNJ lâche sa tâche et rentre au feu (spec IA chaleur).
   *  Sous l'ambiant vallée acte III (50) → la vie normale ne le déclenche pas ; au-dessus de
   *  l'hypothermie (20) avec marge (dérive lente). */
  NPC_COLD_SEEK: 40,
  /** Hystérésis : arrêt de la recherche au retour au confort. */
  NPC_COLD_RESUME: 60,

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
  8: { name: 'marsh', walkable: true, speedFactor: 0.6 },
  9: { name: 'scree', walkable: true, speedFactor: 0.7 },
  10: { name: 'snow', walkable: false, speedFactor: 0 },
  11: { name: 'heath', walkable: true, speedFactor: 0.9 },
  12: { name: 'alpine_meadow', walkable: true, speedFactor: 1 },
  13: { name: 'pine', walkable: true, speedFactor: 0.85 },
  14: { name: 'larch', walkable: true, speedFactor: 0.85 },
  15: { name: 'glacier', walkable: false, speedFactor: 0 },
  16: { name: 'boulders', walkable: true, speedFactor: 0.6 },
  17: { name: 'flower_meadow', walkable: true, speedFactor: 1 },
  18: { name: 'peat_bog', walkable: true, speedFactor: 0.45 },
  19: { name: 'reed_marsh', walkable: true, speedFactor: 0.55 },
  20: { name: 'alpine_flowers', walkable: true, speedFactor: 1 },
  21: { name: 'burnt_forest', walkable: true, speedFactor: 0.9 },
  22: { name: 'old_growth', walkable: true, speedFactor: 0.7 },
}

export const TERRAIN_VOID = 0
export const TERRAIN_GRASS = 1
export const TERRAIN_ROAD = 2
export const TERRAIN_ROCK = 5

export const TERRAIN_FOREST = 3
export const TERRAIN_SHALLOW_WATER = 4
export const TERRAIN_DEEP_WATER = 6
export const TERRAIN_WALL = 7
export const TERRAIN_MARSH = 8
export const TERRAIN_SCREE = 9
export const TERRAIN_SNOW = 10
export const TERRAIN_HEATH = 11
export const TERRAIN_ALPINE_MEADOW = 12
export const TERRAIN_PINE = 13
export const TERRAIN_LARCH = 14
export const TERRAIN_GLACIER = 15
export const TERRAIN_BOULDERS = 16
export const TERRAIN_FLOWER_MEADOW = 17
export const TERRAIN_PEAT_BOG = 18
export const TERRAIN_REED_MARSH = 19
export const TERRAIN_ALPINE_FLOWERS = 20
export const TERRAIN_BURNT_FOREST = 21
export const TERRAIN_OLD_GROWTH = 22

/** Coûts de construction (spec village R3 : réels dès V3). */
export const STRUCTURE_COSTS: Record<import('./items').StructureType, import('./items').ItemBag> = {
  fire: { wood: 10 },
  wall: { wood: 2 },
  door: { wood: 3 },
  chest: { wood: 4 },
  workshop: { wood: 6, stone: 4 },
  furnace: { stone: 8 },
  house: { wood: 8 },
}

export type NodeType = 'tree' | 'rock' | 'fiber_plant' | 'berry_bush' | 'iron_vein' | 'coal_seam'

/**
 * Les quatre paliers d'outil, ORDONNÉS (spec craft-fortune C4). Le rang décide
 * de ce qu'on OUVRE (les filons), le rendement de ce qu'on RAMÈNE — ce sont deux
 * questions distinctes, et les confondre était le bug latent : `crude` rend
 * autant que `basic` (×2), mais il ne doit ouvrir NI le fer NI le charbon.
 */
export type ToolTier = 'none' | 'crude' | 'basic' | 'iron'
export const TOOL_RANK: Record<ToolTier, number> = { none: 0, crude: 1, basic: 2, iron: 3 }

export interface NodeDef {
  item: import('./items').ItemId
  stock: number
  /** Demi-côté du carré bloquant, en SOUS-TUILES depuis le centre de la tuile
   * (spec économie R1, spec arbres hauts). La tuile `t` couvre les sous-tuiles
   * `[8t, 8t+8)`, son centre est `8t+4`, et le carré bloquant est
   * `[8t+4−h, 8t+4+h)`. `h = 4` → tuile entière ; `h = 0` → ne bloque pas ;
   * `h = 1` → tronc de 0,25 tuile. */
  blockHalfSub: number
  skill: import('./items').SkillId
  /** Famille d'outil qui multiplie le rendement. */
  tool: 'axe' | 'pickaxe' | null
  /**
   * Le palier MINIMAL pour entamer le nœud (spec craft-fortune C5).
   *
   * C'était un booléen « il faut un outil », testé par « rendement > 1 ». Le pic
   * de fortune rendant ×2, il aurait ouvert le fer et le charbon — trois pierres
   * et une corde court-circuitant l'atelier, la forge, et toute la géopolitique
   * de la mine (GDD §8 : la puissance T2 passe OBLIGATOIREMENT par un bâtiment).
   * Les filons exigent donc un outil FORGÉ, pas un caillou ficelé.
   *
   * La PIERRE, elle, reste à `none` pour toujours (C3) : tout outil de fortune
   * est fait de pierre — la gater derrière un outil serait le blocage circulaire
   * que `recolte.md` G13 a déjà refusé pour le marteau.
   */
  minTool: ToolTier
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  tree: { item: 'wood', stock: 10, blockHalfSub: 1, skill: 'woodcutting', tool: 'axe', minTool: 'none' },
  rock: { item: 'stone', stock: 12, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'none' },
  fiber_plant: { item: 'fiber', stock: 6, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none' },
  berry_bush: { item: 'berries', stock: 8, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none' },
  iron_vein: { item: 'iron_ore', stock: 8, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'basic' },
  coal_seam: { item: 'coal', stock: 8, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'basic' },
}

/** Les trois paliers outillés de chaque famille. Le barème, lui, est `TOOL_YIELD`. */
export const TOOL_TIERS: Record<
  'axe' | 'pickaxe',
  { crude: import('./items').ItemId; basic: import('./items').ItemId; iron: import('./items').ItemId }
> = {
  axe: { crude: 'crude_axe', basic: 'axe', iron: 'iron_axe' },
  pickaxe: { crude: 'crude_pickaxe', basic: 'pickaxe', iron: 'iron_pickaxe' },
}

/**
 * Rendement par palier : mains nues ×1, fortune ×2, atelier ×2, fer ×3.
 *
 * `crude` et `basic` à égalité, sciemment (spec craft-fortune C4-C6) : la fortune
 * ne se paie pas en rendement mais en VIE (20 coups contre 100, `TOOL_DURABILITIES`)
 * et en portes fermées (elle n'ouvre pas les filons). L'outil d'atelier n'est donc
 * pas « le même en mieux » — il est durable, et il ouvre la mine.
 */
export const TOOL_YIELD: Record<ToolTier, number> = { none: 1, crude: 2, basic: 2, iron: 3 }

/**
 * Durabilité par objet — défaut : `BALANCE.TOOL_DURABILITY` (100 coups). Seuls
 * les objets de fortune dérogent : 20 coups. C'est le prix de la couche 1 (C6).
 */
export const TOOL_DURABILITIES: Partial<Record<import('./items').ItemId, number>> = {
  crude_axe: 20,
  crude_pickaxe: 20,
  crude_spear: 20,
}

/** Valeur nutritive des consommables (spec R9). */
export const FOOD_VALUES: Partial<Record<import('./items').ItemId, number>> = {
  berries: 15,
  stew: 50,
  raw_meat: 8,
  cooked_meat: 35,
}

export type RecipeId =
  | 'rope'
  | 'crude_axe'
  | 'crude_pickaxe'
  | 'crude_spear'
  | 'stew'
  | 'axe'
  | 'pickaxe'
  | 'iron_ingot'
  | 'iron_axe'
  | 'iron_pickaxe'
  | 'spear'
  | 'hammer'
  | 'cooked_meat'

export interface Recipe {
  /** `null` = À LA MAIN : nulle part, donc partout (spec craft-fortune C1). */
  station: 'fire' | 'workshop' | 'furnace' | null
  inputs: import('./items').ItemBag
  output: import('./items').ItemId
  /**
   * Le TEMPS DE TRAVAIL d'une unité, en secondes (spec craft-file F5). Le craft
   * n'est plus instantané : il entre dans une file, et le tick la fait descendre.
   * En secondes et non en ticks — comme tout le reste de ce fichier, la conversion
   * passe par `ticksFor` : changer TICK_RATE_HZ ne doit rien recalibrer à la main.
   */
  seconds: number
}

/** Chaînes ≤ 3 étapes, stations distinctes (GDD §8, spec R10-R11). */
export const RECIPES: Record<RecipeId, Recipe> = {
  // ── La couche 1 : à mains nues, sans poste, dès la minute 0 (spec craft-fortune).
  // Tout y passe par la CORDE : le goulot est volontaire (C8) — la fibre cesse
  // d'être ce qu'on ramasse sans y penser, et le cueilleur a un client tout de suite.
  rope: { station: null, inputs: { fiber: 3 }, output: 'rope', seconds: 3 },
  crude_axe: { station: null, inputs: { wood: 2, stone: 3, rope: 1 }, output: 'crude_axe', seconds: 5 },
  crude_pickaxe: { station: null, inputs: { wood: 3, stone: 2, rope: 1 }, output: 'crude_pickaxe', seconds: 5 },
  crude_spear: { station: null, inputs: { wood: 3, stone: 1, rope: 1 }, output: 'crude_spear', seconds: 5 },

  stew: { station: 'fire', inputs: { berries: 4, fiber: 1 }, output: 'stew', seconds: 8 },
  axe: { station: 'workshop', inputs: { wood: 5, stone: 3, fiber: 2 }, output: 'axe', seconds: 8 },
  pickaxe: { station: 'workshop', inputs: { wood: 5, stone: 3, fiber: 2 }, output: 'pickaxe', seconds: 8 },
  iron_ingot: { station: 'furnace', inputs: { iron_ore: 2, coal: 1 }, output: 'iron_ingot', seconds: 10 },
  iron_axe: { station: 'workshop', inputs: { iron_ingot: 2, wood: 2 }, output: 'iron_axe', seconds: 12 },
  iron_pickaxe: { station: 'workshop', inputs: { iron_ingot: 2, wood: 2 }, output: 'iron_pickaxe', seconds: 12 },
  spear: { station: 'workshop', inputs: { wood: 4, stone: 2, fiber: 1 }, output: 'spear', seconds: 8 },
  // LE MARTEAU SE FORGE AU FEU, PAS À L'ATELIER — et ce n'est pas un détail : bâtir
  // exige déjà un village, donc un Feu allumé. Le mettre à l'atelier créerait un
  // blocage circulaire (il faudrait bâtir l'atelier pour pouvoir bâtir). Au Feu, il
  // n'ajoute AUCUNE porte : qui peut bâtir peut le forger.
  hammer: { station: 'fire', inputs: { wood: 4, stone: 2, fiber: 2 }, output: 'hammer', seconds: 8 },
  cooked_meat: { station: 'fire', inputs: { raw_meat: 1 }, output: 'cooked_meat', seconds: 5 },
}

/** Dégâts des armes portées — mains nues : COMBAT.UNARMED_DAMAGE. */
export const WEAPON_DAMAGE: Partial<Record<import('./items').ItemId, number>> = {
  spear: 16,
  iron_axe: 10,
  // L'épieu taillé se glisse entre les mains nues (6) et la lance (16), à 10 : une
  // réponse au loup et au sanglier dès la première nuit, sans rendre la lance
  // inutile — elle frappe 60 % plus fort et tient cinq fois plus (spec C9).
  crude_spear: 10,
}

export type MonsterType = 'zombie' | 'boar' | 'cendreux' | 'rabbit' | 'deer' | 'wolf'

/**
 * Le RYTHME d'une bête (spec faune R10). C'est ce qui donne une identité à
 * l'heure : le jour appartient aux cerfs, la nuit aux sangliers et aux loups,
 * et les lisières du jour aux lapins. Sortir de nuit n'est alors plus une
 * question d'éclairage — c'est une question de qui est réveillé.
 */
export type Activity = 'diurnal' | 'nocturnal' | 'crepuscular'

export interface MonsterDef {
  hp: number
  damage: number
  /** Vitesse en tuiles/s (les avatars marchent à WALK_SPEED_TILES_PER_S). */
  speed: number
  windupTicks: number
  attackCooldownTicks: number
  aggroRange: number
  /** Cadence de réflexion de l'IA (elle agit à chaque tick, elle DÉCIDE ici). */
  thinkEveryTicks: number
  /**
   * Zombie sans proie : probabilité de changer d'errance à chaque réflexion.
   * Pour le GIBIER : probabilité de CHANGER DE CAP. Le reste du temps, la bête
   * garde sa direction (ou s'arrête, cf. FAUNA.PAUSE_CHANCE) — c'est ce qui la
   * fait déambuler plutôt que trembler sur place.
   */
  wanderChance: number
  /** Sanglier blessé : probabilité de charger (sinon il fuit) à chaque réflexion. */
  chargeChance: number
  loot: import('./items').ItemBag
  /**
   * Le gibier (spec faune R2) : les terrains où l'espèce vit. Non vide = c'est
   * une BÊTE — elle broute, s'alerte, fuit, et le peuplement ambiant peut la
   * faire naître ici. Vide = c'est un monstre (zombie, cendreux).
   */
  habitat?: number[]
  /** Un avatar à cette distance : la bête s'arrête et regarde (spec faune R5). */
  alertRange?: number
  /** Un avatar à cette distance : la bête détale (spec faune R6). */
  flightRange?: number
  /**
   * Le GRÉGARISME (spec faune R9) : bornes de la taille d'une harde/meute à la
   * naissance. Absent = solitaire. Un cerf seul n'existe pas ; un sanglier de
   * tanière, si — et c'est ce qui le rend inquiétant.
   */
  herdSize?: [number, number]
  /** Le rythme (spec faune R10) : quand cette bête est éveillée. */
  activity?: Activity
  /** Le PRÉDATEUR (spec faune R11) : il chasse, il ne broute pas. */
  predator?: boolean
}

export const MONSTER_DEFS: Record<MonsterType, MonsterDef> = {
  zombie: {
    hp: 40, damage: 12, speed: 2.4,
    windupTicks: ticksFor(0.6), attackCooldownTicks: ticksFor(2), aggroRange: 6,
    thinkEveryTicks: ticksFor(0.5), wanderChance: 0.3, chargeChance: 0,
    loot: {},
  },
  boar: {
    hp: 30, damage: 8, speed: 3.6,
    windupTicks: ticksFor(0.4), attackCooldownTicks: ticksFor(2), aggroRange: 0,
    thinkEveryTicks: ticksFor(1), wanderChance: 0.25, chargeChance: 0.25,
    loot: { raw_meat: 3 },
    // Le sanglier tient sa forêt. Il laisse approcher — et c'est le piège.
    habitat: [TERRAIN_FOREST, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_OLD_GROWTH],
    alertRange: 7, flightRange: 0,
    activity: 'nocturnal', // il fouge de nuit — le vrai sanglier aussi
  },
  cendreux: {
    hp: 20, damage: 34, speed: 1.3,
    windupTicks: ticksFor(0.7), attackCooldownTicks: ticksFor(2.5), aggroRange: 5,
    thinkEveryTicks: ticksFor(0.5), wanderChance: 0, chargeChance: 0,
    loot: {}, // il porte celui du cadavre (voir levée)
  },
  // Le petit gibier (GDD §8bis) : il détale avant qu'on l'ait vu. L'école de l'approche.
  rabbit: {
    hp: 8, damage: 0, speed: 5,
    windupTicks: ticksFor(0.3), attackCooldownTicks: ticksFor(2), aggroRange: 0,
    thinkEveryTicks: ticksFor(0.6), wanderChance: 0.4, chargeChance: 0,
    loot: { raw_meat: 1 },
    habitat: [TERRAIN_GRASS, TERRAIN_HEATH, TERRAIN_FLOWER_MEADOW, TERRAIN_ALPINE_MEADOW, TERRAIN_ALPINE_FLOWERS],
    alertRange: 11, flightRange: 7,
    activity: 'crepuscular', // à l'aube et au crépuscule : les heures du lapin
  },
  // Le gros gibier : le vrai repas. Il voit de loin, part tôt, et court plus vite que vous.
  deer: {
    hp: 45, damage: 0, speed: 4.6,
    windupTicks: ticksFor(0.4), attackCooldownTicks: ticksFor(2), aggroRange: 0,
    thinkEveryTicks: ticksFor(1.2), wanderChance: 0.2, chargeChance: 0,
    loot: { raw_meat: 5 },
    habitat: [TERRAIN_ALPINE_MEADOW, TERRAIN_HEATH, TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_LARCH],
    alertRange: 14, flightRange: 9,
    herdSize: [3, 5], // la harde : ils broutent ensemble et détalent ensemble
    activity: 'diurnal', // le grand gibier du plein jour
  },
  /**
   * LE LOUP (spec faune R11) — « le danger de fond des trajets » (GDD §9bis).
   *
   * Ce n'est pas un zombie : il ne marche pas droit sur vous jusqu'à mourir. Il
   * chasse EN MEUTE, il préfère le gibier à l'homme, il rompt quand il saigne,
   * et un loup seul n'ose pas. Voilà pourquoi il est dangereux et pourquoi on
   * peut le battre : il a une psychologie, et elle s'exploite.
   *
   * Vitesse 4,8 : plus rapide qu'un joueur qui marche (4), plus lent qu'un
   * joueur qui sprinte (6). On ne distance pas une meute, on lui échappe.
   */
  wolf: {
    hp: 35, damage: 14, speed: 4.8,
    windupTicks: ticksFor(0.45), attackCooldownTicks: ticksFor(1.5), aggroRange: 13,
    thinkEveryTicks: ticksFor(0.5), wanderChance: 0.2, chargeChance: 0,
    loot: { raw_meat: 2 },
    habitat: [TERRAIN_FOREST, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_OLD_GROWTH, TERRAIN_HEATH],
    alertRange: 0, flightRange: 0, // il ne fuit pas parce qu'on approche : il fuit parce qu'il saigne
    herdSize: [3, 4], // la meute
    activity: 'nocturnal',
    predator: true,
  },
}

/**
 * La faune ambiante (spec faune) — elle vit dans un ANNEAU autour des avatars,
 * pas dans la carte. Population bornée par `CAP`, indépendante de la taille du
 * monde : le coût par tick ne dépend donc pas de la carte, mais du nombre de
 * gens qui la regardent.
 *
 * `SPAWN_RING_MIN` (28) est calé au-delà de TOUT ce que la caméra peut montrer :
 * la demi-diagonale du champ (~20.6 tuiles à VISIBLE_TILES_TALL=20) PLUS le
 * décalage « Foxhole » vers le curseur (LOOKAHEAD_MAX_TILES = 6). Sans ce second
 * terme, une bête née à 22 tuiles apparaît à l'écran dès que le joueur regarde
 * dans sa direction — un lapin qui se matérialise sous les yeux. Si le cadrage
 * ou le lookahead du client changent, ce nombre monte avec eux.
 */
export const FAUNA = {
  /**
   * Plafond de bêtes ambiantes vivantes (hors bêtes de lieu, résidentes).
   *
   * CALIBRÉ EN JEU (2026-07-11) : ce qui compte n'est pas le plafond mais la
   * DENSITÉ dans le disque utile. À 30 bêtes sur un rayon de 62 (12 000 tuiles)
   * pour un écran de ~710 tuiles, on attend ~2 bêtes en vue — et on n'en voyait
   * effectivement qu'une. En resserrant le disque (52) et en montant le plafond,
   * on vise ~4 : assez pour que la forêt bruisse, trop peu pour un zoo.
   */
  CAP: 48,
  SPAWN_EVERY_TICKS: ticksFor(0.4),
  SPAWN_TRIES: 8, // tirages de tuile par tentative de peuplement
  SPAWN_RING_MIN: 28,
  SPAWN_RING_MAX: 42,
  DESPAWN_RADIUS: 52,
  SAFE_RANGE: 20, // menace au-delà : la bête se calme et se remet à brouter
  GRAZE_SPEED: 0.35, // × la vitesse de l'espèce : brouter, c'est flâner
  /**
   * Chance de s'arrêter brouter à chaque réflexion. Le reste du temps la bête
   * GARDE son cap (voir `wanderChance` = chance de CHANGER de cap) : sans cette
   * persistance, tirer une direction neuve chaque seconde donne une marche
   * aléatoire qui piétine sur place — la bête s'agite sans jamais aller nulle
   * part, et le monde ne se repeuple pas autour d'un joueur immobile.
   */
  PAUSE_CHANCE: 0.28,
  FLEE_SPEED: 1, // × la vitesse de l'espèce : détaler, c'est tout donner
  BURST_RUN_TICKS: ticksFor(1.6), // le sprint burst promis par combat.md R12…
  BURST_PAUSE_TICKS: ticksFor(0.7), // …et le souffle qui le rend chassable

  /* ── La harde (spec faune R9) ───────────────────────────────────────────── */
  /**
   * Une bête qui voit un congénère de sa harde détaler à moins de ça détale
   * aussi, SANS avoir rien vu elle-même. C'est le cœur du grégarisme : la harde
   * est un organe de perception collectif, et c'est ce qui rend l'approche
   * difficile — il suffit qu'UNE bête vous repère pour que tout parte.
   */
  HERD_ALARM_RADIUS: 12,
  /** Au-delà de cet écart au centre de sa harde, la bête revient vers les siens. */
  HERD_SPREAD: 5,
  /** Rayon de dispersion d'une harde à la naissance (tuiles). */
  HERD_SPAWN_SPREAD: 3,

  /* ── Le rythme jour/nuit (spec faune R10) ───────────────────────────────── */
  /**
   * En-deçà de cette vigueur (0-1, voir `activityAt`), la bête DORT : elle ne
   * broute plus, elle ne chasse plus. Elle reste réveillable — un dormeur qu'on
   * approche fuit quand même. Ce n'est pas un interrupteur, c'est un seuil.
   */
  REST_BELOW: 0.25,
  /**
   * Plancher de peuplement d'une espèce hors de ses heures : elle ne disparaît
   * jamais tout à fait. Sans ce plancher, le monde se recomposerait d'un coup à
   * 21h — or un cerf assoupi existe encore la nuit, il est juste plus rare.
   */
  SPAWN_FLOOR: 0.15,

  /* ── La meute (spec faune R11) ──────────────────────────────────────────── */
  /**
   * L'APPEL. Un loup qui n'a rien vu, mais dont un frère de meute chasse à moins
   * de ça, converge sur la MÊME cible. La meute chasse comme un seul animal —
   * c'est ce qui la rend mortelle.
   */
  PACK_CALL_RADIUS: 22,
  /**
   * LE COURAGE. Un loup n'engage un HOMME que s'il compte au moins autant de
   * frères vivants autour de lui. En dessous, il rôde, il suit, il attend — mais
   * il ne mord pas. Tuer des loups ne fait donc pas que réduire leur nombre :
   * ça brise la meute, et une meute brisée cesse d'être un danger.
   * (Le petit gibier, lui, se chasse seul : le courage ne vaut que face à l'homme.)
   */
  PACK_COURAGE: 2,
  /** Rayon dans lequel un loup compte ses frères pour se donner du courage. */
  PACK_COHESION_RADIUS: 14,
  /**
   * LA ROMPUE. Sous cette fraction de ses PV, le loup DÉCROCHE. Un loup ne meurt
   * pas au contact comme un zombie : il calcule. C'est ce qui rend la meute
   * battable sans en faire un mur de points de vie.
   */
  PACK_BREAK_HP: 0.35,
  /**
   * Le prédateur PRÉFÈRE le gibier à l'homme : la distance à une proie animale
   * est divisée par ça avant comparaison. Un cerf à 12 tuiles « pèse » donc plus
   * qu'un joueur à 8 — et un joueur qui traverse une zone de chasse peut voir la
   * meute l'ignorer pour un cerf. Le monde ne tourne pas autour de lui.
   */
  PREY_PREFERENCE: 1.8,
  /**
   * L'ENCERCLEMENT. Rayon du cercle sur lequel les loups prennent leur poste
   * autour de la proie — chacun sur un relèvement différent, donné par son rang
   * dans la meute. Une meute qui fonce en ligne droite est une file indienne :
   * on la fuit tout droit, et elle ne vaut pas mieux qu'un loup seul.
   */
  ENCIRCLE_RADIUS: 3.5,
  /**
   * En-deçà de cette distance, on ne manœuvre plus : c'est la curée. Assez large
   * pour que les traînards aient pris leur place avant que le premier ne morde.
   */
  COMMIT_RANGE: 2.6,
  /**
   * LA TRAQUE. Allure du loup qui gagne son poste (× sa vitesse). Il RAMPE — et
   * c'est la condition même de l'encerclement : une meute qui charge à pleine
   * vitesse pour se placer lève le gibier avant que le cercle ne soit bouclé, et
   * l'encerclement ne se produit jamais. La lenteur n'est pas un handicap qu'on
   * leur inflige : c'est ce qui rend la manœuvre possible.
   */
  STALK_SPEED: 0.42,
  /**
   * LE CAMOUFLAGE. Ce qu'il reste des portées de détection d'une proie face à un
   * loup qui traque (× alertRange et flightRange). À 0,42, un cerf qui voit un
   * chasseur à 9 tuiles ne lève la tête sur un loup rampant qu'à 4 — le temps
   * qu'il faut à la meute pour se placer. Dès que le loup se rue, le camouflage
   * tombe : c'est la course, plus la traque.
   */
  STALK_STEALTH: 0.42,
  /** À cette distance de son poste, un loup est « en place ». */
  POST_TOLERANCE: 1.3,

  /* ── L'ALPHA (spec faune R12) ───────────────────────────────────────────── */
  /**
   * LE MÂLE ALPHA. Chaque meute en a un, et un seul : le premier-né. Il est plus
   * lourd, il frappe plus fort, ON LE RECONNAÎT à sa taille — et c'est là tout
   * l'enjeu : il est visible, donc ciblable.
   *
   * Tuer l'alpha DISPERSE la meute sur-le-champ. C'est la seule chose qui
   * transforme un combat perdu d'avance en combat gagnable : au lieu d'abattre
   * quatre loups, on en abat UN — le bon. Une meute cesse alors d'être un mur de
   * points de vie pour devenir une question : lequel, et comment l'atteindre.
   */
  ALPHA_HP: 1.9,
  ALPHA_DAMAGE: 1.45,

  /* ── La rencontre (spec faune R13) — ce doit être un moment ─────────────── */
  /**
   * LA POURSUITE. Une meute qui vous a choisi ne vous oublie pas à treize tuiles :
   * elle vous suit jusqu'à CELLE-CI. Le loup court à 4,8, le joueur sprinte à 6 —
   * il gagne 1,2 tuile par seconde, et son endurance lui offre ~12 s de sprint,
   * soit ~15 tuiles d'avance. Ce n'est PAS assez pour semer la meute.
   *
   * C'est délibéré, et c'est tout le propos : on ne distance pas des loups. On
   * leur échappe — par le Feu, ou en les faisant rompre. Sans quoi on meurt.
   */
  PURSUIT_RANGE: 26,
  /* ── Le sanglier (spec faune R14) — il ne fuit pas, il décide ───────────── */
  /**
   * LA FOUILLE. Le sanglier fouge : groin au sol, il ne voit plus rien. C'est la
   * FENÊTRE DU CHASSEUR — la seule façon d'approcher une bête qui, autrement, ne
   * fuit pas et vous voit venir. Un sanglier qui fouille est un sanglier qu'on
   * peut atteindre ; c'est le geste que le GDD §8bis appelle « l'approche ».
   */
  ROOT_CHANCE: 0.4, // probabilité de se mettre à fouir, à chaque réflexion
  ROOT_TICKS: ticksFor(4),
  ROOT_ALERTNESS: 0.4, // × ses portées de détection pendant qu'il fouge
  /**
   * LA MENACE. Sous cette distance, le sanglier ne fuit pas et ne charge pas
   * encore : il se plante face à vous. Un temps. C'est un AVERTISSEMENT, et c'est
   * la dernière seconde où l'on peut encore reculer (GDD §9bis).
   */
  THREAT_RANGE: 4.5,
  THREAT_TICKS: ticksFor(1.1), // le temps qu'il vous laisse pour comprendre
  /**
   * LA CHARGE. Droite, engagée, plus rapide qu'un sprint (6,1 contre 6) : on ne
   * la distance PAS. On s'en écarte. Le sanglier ne tourne pas — il passe, il
   * dépasse, et il se retrouve essoufflé, dos à vous. C'est là qu'on frappe.
   *
   * Une bête qu'on esquive plutôt qu'on ne fuit : le GDD veut un combat
   * positionnel, et le sanglier en est la première leçon.
   */
  CHARGE_SPEED: 1.7, // × sa vitesse (3,6 → 6,1)
  CHARGE_TICKS: ticksFor(1.3), // il court tout droit pendant ce temps, sans dévier
  WINDED_TICKS: ticksFor(1.7), // puis il souffle, immobile — la fenêtre pour frapper
  /**
   * LE FEU. Aucun loup n'approche à moins de ça d'un Feu allumé : il rompt, il
   * s'écarte, il attend dans le noir. C'est la seule vraie issue d'une poursuite,
   * et elle donne à la fuite une DESTINATION plutôt qu'une direction.
   *
   * Que le salut d'une nuit de chasse soit le Foyer n'est pas un hasard : c'est
   * le jeu qui dit son nom.
   */
  FIRE_WARD: 8,

  /* ── La satiété (spec faune R15) — un prédateur mange ────────────────────── */
  /**
   * LE REPAS. Un loup ne chasse pas pour le sport : il chasse, il tue, et IL
   * MANGE. Tant qu'il n'a pas mangé, il traque ; une fois repu, il vous laisse
   * passer. C'est ce qui achève de faire de la vallée un écosystème plutôt qu'un
   * distributeur d'agression : on peut voir une meute prendre un cerf, se
   * rassasier — et vous ignorer.
   *
   * C'est aussi une TACTIQUE offerte au joueur : jeter de la viande à une meute
   * qui vous serre, c'est lui donner autre chose à faire. (Le GDD §9bis prévoyait
   * déjà de détourner une horde « avec de la viande ou du bruit ».)
   */
  CARCASS_SEEK: 16, // rayon où un prédateur affamé cherche une carcasse
  EAT_RANGE: 1.6, // il doit être dessus pour manger
  EAT_TICKS: ticksFor(9), // le temps qu'il passe à la carcasse, immobile
  SATED_TICKS: ticksFor(210), // ~3 min 30 de tranquillité — puis la faim revient

  /* ── La pression de chasse (spec faune R16) ─────────────────────────────── */
  /**
   * LE PIÈGE DU FARM. Le peuplement ambiant remplit l'anneau dès qu'une place se
   * libère : tuer une bête en fait naître une autre en une demi-seconde. Planté
   * dans une clairière, un joueur récolterait de la viande à l'infini sans faire
   * un pas — et la chasse, qui devait être un geste, deviendrait un robinet.
   *
   * LA RÈGLE : **le gibier déserte ce qu'on vient de chasser.** Une bête abattue
   * fait taire les bois autour d'elle : aucune naissance ambiante à moins de
   * `QUIET_RADIUS` pendant `QUIET_TICKS`. Le rayon est plus grand que l'anneau de
   * naissance (42) — donc un chasseur qui reste sur place ne voit plus rien venir.
   *
   * Il faut LEVER LE CAMP. C'est ce que fait un vrai chasseur, et c'est ce qui
   * rend la carte utile : le gibier est une ressource de TERRITOIRE, pas de temps.
   *
   * Et l'inverse est gardé : la zone se rouvre au bout de deux minutes, le plafond
   * global n'est pas touché, et abattre un LOUP ne fait taire personne (tuer un
   * prédateur n'a jamais fait fuir le gibier — au contraire).
   */
  QUIET_RADIUS: 46,
  QUIET_TICKS: ticksFor(120),
  /**
   * LE RETOUR DES BÊTES DE LIEU. Le sanglier d'une tanière est résident : tué, il
   * ne revenait JAMAIS, et le lieu devenait une coquille vide. Il repeuple sa
   * tanière après ce délai — mais jamais sous les yeux d'un joueur (voir
   * `DEN_SPAWN_CLEARANCE`) : un sanglier qui se matérialise devant vous, c'est le
   * décor qui avoue.
   */
  DEN_RESPAWN_TICKS: ticksFor(240),
  DEN_SPAWN_CLEARANCE: 24, // aucun avatar à moins de ça, sinon on attend
  /**
   * REPU N'EST PAS INOFFENSIF. Un loup rassasié ne chasse plus, mais il se DÉFEND :
   * qui le frappe le trouve en face. Il ne poursuit pas, il ne rôde pas, il ne
   * hurle pas — il rend le coup, et il rompt s'il saigne. Un prédateur repu qui se
   * laisserait tuer sans réagir serait un décor, pas un animal.
   */
}

/** La levée des Cendreux (spec 2026-07-08). Ordres de grandeur, calibrage playtest. */
export const CENDREUX = {
  WITNESS_RADIUS: 8, // « seul » : aucun allié vivant dans ce rayon à la mort
  HEARTH_WARD_RADIUS: 12, // « loin d'un feu » : aucune structure feu (mort ET réveil)
  RISE_DELAY: ticksFor(300), // délai mort→levée (~5 min ; le cadavre marqué ne décante pas d'ici là)
  WARMTH_SEEK_RANGE: 20, // rayon de recherche de chaleur la nuit
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
  /** Distance à laquelle une IA (monstre, PNJ) déclenche son coup au corps à corps. */
  MELEE_ENGAGE_RANGE: 1.2,
  /** Portée du coup porté à une structure (murs, portes — cibles larges). */
  STRUCTURE_STRIKE_RANGE: 2.2,
  /** Rythme minimal entre deux attaques d'un avatar (PNJ compris). */
  ATTACK_COOLDOWN_TICKS: ticksFor(1),
  /** Temps d'immobilisation des mains après un bandage. */
  BANDAGE_COOLDOWN_TICKS: ticksFor(1),
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
  RESPAWN_TEMPERATURE: 100,
  /** Épuisement post-mort : régén d'endurance ÷2 (~5 min démo ; GDD vise ~30 min). */
  EXHAUSTION_TICKS: ticksFor(300),
  EXHAUSTED_REGEN_FACTOR: 0.5,
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

export const CONVOY_LOOT: import('./items').ItemBag = {
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
  // La fortune ne vaut presque rien : piller un camp qui n'a que des cailloux
  // ficelés ne doit pas nourrir le verdict de la Meute.
  crude_axe: 1,
  crude_pickaxe: 1,
  crude_spear: 1,
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
  /**
   * Décroissance linéaire vers 0, en points par jour de saison (le paquebot).
   * Calibrage 2026-07-06 : 4 → 2. À 4/jour, une chaleur ensemencée à 60
   * passait sous le seuil d'archétype (40) en 5 jours — aucun rythme d'actes
   * réaliste ne pouvait entretenir un caractère (banc de scénario, 6 jours).
   */
  DECAY_PER_DAY: 2,
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

/** L'IA des PNJ (spec pnj, alignement R13-R14) — les seuils de décision. */
export const NPC_AI = {
  /** Réserve personnelle de baies conservée au dépôt d'une récolte (spec pnj R6). */
  FOOD_KEEP: 2,
  /** Bois retiré au grenier pour une sortie de réparation. */
  REPAIR_WOOD_WITHDRAW: 4,
  /** Baies retirées au grenier pour un repas (à défaut de ragoût). */
  EAT_BERRIES_WITHDRAW: 3,
  /** Cible de fibres au grenier (tableau du village). */
  VILLAGE_FIBER_TARGET: 2,
  /** Cuisiner exige la recette + une marge de baies, et la fibre de la recette. */
  COOK_MIN_BERRIES: 5,
  COOK_MIN_FIBER: 1,
  /** Raid (spec alignement R13) : un raider décroche sous ce seuil de PV… */
  RAID_DISENGAGE_HP: 40,
  /** …la Meute ne raide pas exsangue, et envoie ce nombre de raiders par nuit. */
  RAID_MIN_ALIVE: 3,
  RAIDERS_PER_RAID: 2,
  /** Rayon de fouille des cadavres autour d'un raider, en tuiles. */
  CORPSE_SEARCH_RANGE: 2,

  /* ── LA DÉFENSE NE DOIT PAS TUER SON DÉFENSEUR (correctif 2026-07-12) ────────
   * `handleDefense` prime sur TOUT (sommeil, froid, faim) et ne renonçait jamais.
   * Or il marche GLOUTONNEMENT vers la menace — sans pathfinding, « le village est
   * un terrain ouvert », disait le commentaire. La vallée, elle, ne l'est pas : le
   * PNJ bute sur un rocher, n'atteint jamais le zombie… et rend `true` à chaque
   * tick, pour toujours. Il ne mange plus (deux baies dans sa poche, dix au
   * grenier), ne dort plus, et meurt de faim en montant la garde.
   *
   * C'est le livelock exact que les trois AUTRES besoins gardent explicitement
   * (« la faim ne tue pas ; le figeage, si »). Le seul handler prioritaire était
   * le seul sans garde. */

  /** Sous ce seuil de faim, MANGER passe avant la défense. Un défenseur mort de
   *  faim ne défend rien — et manger prend UN tick : le village n'est pas désarmé. */
  DEFENSE_YIELD_HUNGER: 15,
  /** Ticks sans le moindre PROGRÈS vers la menace (jamais plus près qu'avant) au
   *  bout desquels on LÂCHE la garde : on ne fige pas une vie devant un rocher. */
  DEFENSE_GIVE_UP_TICKS: ticksFor(3),
  /** …et on l'IGNORE ce temps-là avant de retenter. Sans ce répit, le PNJ
   *  repartirait à la charge au tick suivant : trois secondes de course, une de
   *  renoncement, pour toujours — il n'aurait toujours jamais le temps de manger. */
  DEFENSE_IGNORE_TICKS: ticksFor(30),
} as const

/**
 * LE PORTAGE (spec `portage.md`) — « collecter est facile, rapporter est le jeu »
 * (GDD §8bis). Le poids de chaque objet, et le prix de la charge.
 *
 * Mesuré avant d'écrire la règle : le sac tenait 18 cases × 20 = **360 unités**,
 * soit 180 murs, portés EN SPRINTANT. La distance ne coûtait rien, le sac n'était
 * pas un choix, la route n'était pas un risque, et mourir chargé ne coûtait rien.
 *
 * `Record<ItemId, number>` : exhaustif par construction — un objet ajouté à la sim
 * sans poids ne compile plus. Un objet sans poids serait un objet gratuit à porter,
 * et le trou passerait inaperçu jusqu'au playtest.
 *
 * La cueillette est LÉGÈRE (fibre, baies : 0,2) ; la PIERRE et le MINERAI font mal
 * (2 et 3). Ce sont les « hottes de minerai » du GDD — c'est la mine qui doit faire
 * transpirer, pas la promenade en forêt.
 */
export const ITEM_WEIGHT: Record<import('./items').ItemId, number> = {
  wood: 1,
  stone: 2,
  fiber: 0.2,
  berries: 0.2,
  stew: 0.5,
  raw_meat: 1,
  cooked_meat: 0.8,
  rope: 0.4,
  iron_ore: 3,
  coal: 2,
  iron_ingot: 4,
  components: 1.5,
  crude_axe: 2,
  crude_pickaxe: 2.5,
  crude_spear: 1.5,
  axe: 2,
  pickaxe: 3,
  iron_axe: 3.5,
  iron_pickaxe: 4,
  spear: 2,
  hammer: 3,
}

/**
 * Le prix de la charge (spec portage.md P4-P7). ON N'EST JAMAIS BLOQUÉ : on peut
 * toujours ramasser, et se surcharger (décision utilisateur) — « je laisse la
 * moitié du minerai, ou je rentre à 20 % de vitesse avec des loups dehors ? ».
 * C'est un CHOIX ; un blocage dur ne ferait que refuser un clic.
 */
export const CARRY = {
  /** Capacité de base. La besace de peau (couche 1 ter) la fera monter. */
  CAPACITY: 30,
  /** En dessous de cette fraction : on ne sent rien. La cueillette reste libre. */
  COMFORT: 0.5,
  /** Au-dessus : le sprint est REFUSÉ (pas ralenti — refusé). C'est ce qu'on sent en premier. */
  SPRINT_MAX: 0.75,
  /** Pente du malus, par unité de ratio au-delà du confort. */
  MALUS_PER_RATIO: 0.8,
  /** On rampe, mais on avance : sans plancher, une surcharge extrême fige le joueur
   *  — et un joueur figé n'a plus de choix du tout, ce qui est l'inverse du but. */
  SPEED_FLOOR: 0.2,
  /** SURCHARGÉ (> 100 %), l'endurance ne revient presque plus : on ne se bat pas,
   *  on ne fuit pas, on rentre. Le porteur est une PROIE — c'est le PvP léger des
   *  routes que veut le GDD §8bis. */
  OVERLOAD_STAMINA_REGEN: 0.25,
} as const

/** Durée d'un tick en secondes — le seul dt qui existe dans /sim. */
export const TICK_DT_S = 1 / BALANCE.TICK_RATE_HZ

/**
 * Terrassement du relief (spec 2026-07-09-relief-terrasses).
 * Calibré à l'œil sur captures en jeu, jamais sur une théorie.
 */
export const TERRACE = {
  /** Nombre de paliers sur l'amplitude d'altitude [0,1]. */
  LEVELS: 8,
  /** Rayon (en tuiles) de la moyenne locale. Décide de tout : quantifier le
   *  champ brut, qui porte crêtes et bruit de détail, donnerait des
   *  micro-terrasses déchiquetées sur chaque bosse. */
  SMOOTH_RADIUS: 6,
  /** Nombre de passes de lissage (deux passes ≈ une gaussienne). */
  SMOOTH_PASSES: 2,
} as const

/**
 * L'INVENTAIRE À CASES (spec inventaire R5, R7). Piles COURTES, exprès : les
 * coûts de Braises sont à un chiffre (un mur = 2 bois), donc des piles de 1000
 * façon Rust rendraient la capacité purement décorative — et le coffre inutile.
 * Les outils et les armes ont une pile de 1 : chaque exemplaire occupe sa case,
 * donc chaque exemplaire porte son usure.
 */
export const STACK_DEFAULT = 20
export const STACK_SIZES: Partial<Record<import('./items').ItemId, number>> = {
  wood: 20,
  stone: 20,
  fiber: 20,
  iron_ore: 20,
  coal: 20,
  components: 10,
  berries: 10,
  rope: 10,
  stew: 5,
  iron_ingot: 5,
  raw_meat: 5,
  cooked_meat: 5,
  // Outils et armes : un par case (l'usure est portée par la case).
  crude_axe: 1,
  crude_pickaxe: 1,
  crude_spear: 1,
  axe: 1,
  pickaxe: 1,
  iron_axe: 1,
  iron_pickaxe: 1,
  spear: 1,
  hammer: 1,
}

/** Tailles de sac (spec inventaire R7). La longueur du tableau EST la capacité. */
export const SLOTS = {
  /** Les N premières cases du sac du joueur SONT la ceinture (la hotbar). */
  BELT: 6,
  PLAYER: 18,
  /** Les PNJ ont un GRAND sac : ils portent une journée de corvées sans buter sur
   *  leur borne. Ils la voient quand même (npc.ts TASK_INTAKE, handleHunger) —
   *  sinon un sac plein les figerait. Une DONNÉE, pas une règle à part : la sim
   *  n'a qu'un seul jeu de règles. */
  NPC: 40,
  CHEST: 24,
  /** Assez grand pour que le cadavre ne tronque JAMAIS le butin (spec R11). */
  CORPSE: 48,
} as const
