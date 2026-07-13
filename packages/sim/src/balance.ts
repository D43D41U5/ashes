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
  // LA NUIT MORD, DÈS L'ACTE I (était 20). Sans elle, le Feu n'était qu'un
  // établi : on pouvait passer la nuit dehors sans y penser. Rentrer avant la
  // nuit — ou emporter de quoi faire du feu — devient une décision.
  NIGHT_COLD: 30,
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

  /**
   * Ticks avant qu'un nœud épuisé repousse à plein.
   *
   * ÉTAIT 5 MINUTES. Un seul buisson de baies nourrissait alors 34 joueurs en
   * continu : le monde se remplissait plus vite qu'on ne le vidait. À 45 minutes
   * (≈ un cycle), une clairière qu'on rase reste vide pour la journée — on va donc
   * VOIR AILLEURS, et c'est là que tout commence (GDD §8bis : la collecte est le
   * tissu conjonctif ; elle met les joueurs sur les routes, donc dans les
   * rencontres). Modulé par l'acte (SEASON.REGROW_ACT_FACTOR) : le Grand Froid
   * contracte les sources.
   */
  NODE_REGROW_TICKS: ticksFor(45 * 60),

  /**
   * L'ÉPUISEMENT LOCAL (GDD §8bis : « les filons s'épuisent localement et rouvrent
   * ailleurs — les points de friction se DÉPLACENT »). Chaque passage à vide
   * rallonge la repousse suivante : on rase un coin, il met de plus en plus de
   * temps à revenir. On ne peut donc pas camper une clairière : on tourne.
   */
  DEPLETION_REGROW_PENALTY: 0.5,
  /** …borné, sinon un coin très fréquenté ne reviendrait JAMAIS (et un monde mort
   *  n'est pas un monde tendu, c'est un monde fini). */
  DEPLETION_MAX: 4,
  /** Le compteur d'épuisement s'oublie : un cycle sans y toucher efface une marche. */
  DEPLETION_FORGET_TICKS: ticksForCycles(1),

  /** Rythme minimal entre deux récoltes/crafts (1 s) — borne de vraisemblance. */
  GATHER_COOLDOWN_TICKS: ticksFor(1),

  /** Coups outillés avant qu'un outil soit consommé. */
  TOOL_DURABILITY: 100,

  /** Usure minimale par coup, quel que soit le niveau d'artisan. */
  TOOL_WEAR_MIN: 0.25,

  /**
   * Perte de faim par heure de cycle (jauge 0-100).
   *
   * ÉTAIT 1,4 — soit 0,7 point par minute RÉELLE : on pouvait ignorer la faim
   * **2h23**. À 4, la jauge pleine dure ~50 minutes réelles, soit un cycle : on
   * mange une à deux fois par jour, comme dans tout jeu de survie qui tient debout
   * (Don't Starve vide sa jauge en deux jours de jeu, et elle TUE).
   */
  HUNGER_PER_CYCLE_HOUR: 4,

  /**
   * LA FAIM TUE (nouveau — elle ne faisait que ralentir, ce qui n'est pas une
   * punition, c'est une remarque). À 0, les PV fondent : ~17 minutes réelles pour
   * mourir d'une jauge pleine de vie. Assez pour comprendre et réagir ; pas assez
   * pour l'ignorer. Don't Starve draine 1,25 PV/s — nous sommes bien plus doux,
   * parce que nos cycles sont six fois plus longs.
   */
  STARVE_HP_PER_MIN: 6,

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
  /**
   * LE COUVERT (spec chasse C3) : ce qui RESTE de la visibilité d'une menace qui
   * se tient sur cette tuile. 1 = à découvert (prairie rase, neige), 0.5 = on n'y
   * existe presque plus (vieille forêt, roselière). Multiplie la furtivité de
   * TOUTE menace — le chasseur comme le loup qui traque : mêmes règles pour tous.
   */
  cover: number
}

/** Table des terrains. L'id est la valeur stockée dans WorldMap.terrain. */
export const TERRAINS: Record<number, TerrainDef> = {
  0: { name: 'void', walkable: false, speedFactor: 0, cover: 1 },
  1: { name: 'grass', walkable: true, speedFactor: 1, cover: 1 },
  2: { name: 'road', walkable: true, speedFactor: 1.25, cover: 1 },
  3: { name: 'forest', walkable: true, speedFactor: 0.8, cover: 0.6 },
  4: { name: 'shallow_water', walkable: true, speedFactor: 0.5, cover: 1 },
  5: { name: 'rock', walkable: false, speedFactor: 0, cover: 1 },
  6: { name: 'deep_water', walkable: false, speedFactor: 0, cover: 1 },
  7: { name: 'wall', walkable: false, speedFactor: 0, cover: 1 },
  8: { name: 'marsh', walkable: true, speedFactor: 0.6, cover: 0.85 },
  9: { name: 'scree', walkable: true, speedFactor: 0.7, cover: 1 },
  10: { name: 'snow', walkable: false, speedFactor: 0, cover: 1 },
  11: { name: 'heath', walkable: true, speedFactor: 0.9, cover: 0.75 },
  12: { name: 'alpine_meadow', walkable: true, speedFactor: 1, cover: 0.9 },
  13: { name: 'pine', walkable: true, speedFactor: 0.85, cover: 0.65 },
  14: { name: 'larch', walkable: true, speedFactor: 0.85, cover: 0.7 },
  15: { name: 'glacier', walkable: false, speedFactor: 0, cover: 1 },
  16: { name: 'boulders', walkable: true, speedFactor: 0.6, cover: 0.8 },
  17: { name: 'flower_meadow', walkable: true, speedFactor: 1, cover: 0.8 },
  18: { name: 'peat_bog', walkable: true, speedFactor: 0.45, cover: 0.9 },
  19: { name: 'reed_marsh', walkable: true, speedFactor: 0.55, cover: 0.5 },
  20: { name: 'alpine_flowers', walkable: true, speedFactor: 1, cover: 0.85 },
  21: { name: 'burnt_forest', walkable: true, speedFactor: 0.9, cover: 0.9 },
  22: { name: 'old_growth', walkable: true, speedFactor: 0.7, cover: 0.5 },
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

/**
 * LES TROIS CERCLES (GDD §8bis). Le cercle DOMESTIQUE — le rayon du camp — est
 * « sûr, renouvelable vite, MÉDIOCRE : un village y survit, n'y prospère jamais ».
 * Le cercle sauvage est riche et dangereux.
 *
 * C'était la promesse du GDD, et elle n'était pas codée : les nœuds étaient
 * UNIFORMES partout, donc le meilleur bois était à dix pas du Feu et il n'y avait
 * aucune raison de sortir. C'est ce qui rendait le poids inutile — et c'est
 * pourquoi la géographie vient APRÈS lui : maintenant que s'éloigner coûte, il faut
 * que ça rapporte.
 */
export const CIRCLES = {
  /** Rayon du cercle domestique, en tuiles, autour du point de départ. */
  DOMESTIC_RADIUS: 28,
  /** Au-delà de ce rayon : le cercle sauvage. */
  WILD_RADIUS: 70,
  /** Ce qu'un nœud rend, par cercle. Le domestique nourrit ; il n'enrichit pas. */
  DOMESTIC_STOCK: 0.5,
  CONTESTED_STOCK: 1,
  WILD_STOCK: 1.6,
} as const

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

/**
 * Valeur nutritive des consommables (spec R9).
 *
 * LE CRU NE NOURRIT PAS UN HOMME. Les baies passent de 15 à 6 : un buisson entier
 * (8 baies) vaut désormais 48 points, soit ~24 minutes de survie — contre 171
 * minutes avant. On ne vit plus de cueillette : on cuisine, donc on a besoin d'un
 * FEU, donc on a besoin de bois, donc on rentre. C'est la boucle qui manquait.
 */
export const FOOD_VALUES: Partial<Record<import('./items').ItemId, number>> = {
  berries: 6,
  raw_meat: 8,
  cooked_meat: 40,
  stew: 60,
}

/**
 * LA PÉREMPTION (spec `evier.md`) — l'évier qui manquait.
 *
 * Rien ne se consommait dans Braises hors l'usure des outils : le grenier était un
 * TAS, pas un flux. Le GDD §8 dit pourtant « une économie de flux, pas de stock —
 * un serveur où tout le monde a plafonné en semaine 2 est mort en semaine 3 ».
 *
 * Modèle repris de Don't Starve, parce qu'il est éprouvé et LISIBLE : frais →
 * rassis → avarié → pourri (l'objet disparaît). Chaque cran divise la valeur
 * nutritive. On ne demande AUCUNE microgestion au joueur : pas de date par objet,
 * pas de tri permanent — une pile a une fraîcheur, elle se voit dans sa case, et
 * elle décide toute seule.
 *
 * La durée est en CYCLES (jours). Un objet absent de cette table ne pourrit pas.
 */
export const SPOIL_CYCLES: Partial<Record<import('./items').ItemId, number>> = {
  berries: 2,
  raw_meat: 1.5, // la viande crue est une bombe à retardement : on la cuit, ou on la perd
  cooked_meat: 4,
  stew: 5,
}

/** Les crans de fraîcheur, et ce qu'ils font à la valeur nutritive. */
export const SPOIL = {
  /** Au-dessus : FRAIS (pleine valeur). */
  STALE_AT: 0.5,
  /** Au-dessus : RASSIS. En dessous : AVARIÉ. À 0 : POURRI — la pile disparaît. */
  SPOILED_AT: 0.2,
  /** Ce que rend un aliment selon son cran (Don't Starve : ⅓ puis ⅙). */
  NUTRITION_STALE: 0.5,
  NUTRITION_SPOILED: 0.2,
} as const

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

/**
 * LA FORME D'UN COUP — ce que la sim frappe VRAIMENT.
 *
 * Avant, tout le monde frappait pareil : un arc de 90° à 1,4 tuile, 0,4 s d'armement,
 * et l'arme ne changeait QUE les dégâts. Une lance touchait donc à la même distance
 * qu'un poing, et un télégraphe honnête n'avait qu'une chose à dire de chaque arme :
 * rien. C'est la géométrie qui porte l'identité d'une arme, pas son chiffre.
 *
 * Deux primitives suffisent à tout ce que le combat demande :
 *   · `cone` — un secteur depuis le corps. `arcCos = 1` → une ligne (le pic de la
 *     lance) ; `0` → ±90° ; `-1` → 360° (le tourbillon de hache). Un seul test.
 *   · `disc` — un disque posé DEVANT, à `range` du corps (l'overhead à deux poings
 *     qui s'écrase au sol).
 *
 * La portée est mesurée CENTRE À CENTRE, comme la sim : deux corps qui se touchent
 * ont leurs centres à `AVATAR_HITBOX_TILES` (0,6) l'un de l'autre. Tout s'ancre là —
 * un poing porte à un bras (1,1), une lance à deux mètres de bois (2,3).
 */
export interface Strike {
  shape: 'cone' | 'disc'
  /** Cône : portée depuis le centre du corps. Disque : distance de son CENTRE. */
  range: number
  /** Cône : cosinus du DEMI-angle (1 = une ligne, 0 = ±90°, −1 = tout le tour). */
  arcCos: number
  /** Disque : son rayon. Ignoré par le cône. */
  radius: number
  damage: number
  stamina: number
  windupTicks: number
  /**
   * LA RÉCUPÉRATION, ET ELLE EST À DEUX VALEURS. Le coup qui MORD rend la main ;
   * celui qui fend l'air laisse à découvert. C'est le whiff qui punit — jamais le
   * fait d'avoir chargé. Un coup chargé qui touche est un investissement qui paie ;
   * raté, c'est une seconde de trop, immobile, devant un loup.
   * `0` = « je n'impose rien » (les monstres tiennent leur cadence de MONSTER_DEFS).
   */
  recoveryHit: number
  recoveryWhiff: number
  /** LE PAS : distance parcourue pendant l'armement, en tuiles. On avance en frappant. */
  lunge: number
  /** Le pas DÉVIE, gauche/droite/gauche… (les poings dansent). `false` = tout droit. */
  weave: boolean
}

/** Les deux coups d'une arme, et le temps de maintien qui bascule de l'un à l'autre. */
export interface WeaponProfile {
  light: Strike
  charged: Strike
  /** Ticks de maintien du clic à partir desquels le coup part CHARGÉ. */
  chargeTicks: number
}

export type WeaponKind = 'unarmed' | 'crude_spear' | 'spear' | 'iron_axe'

/** Cosinus tabulés — `Math.cos` est interdit dans /sim (invariant §2, moteurs JS). */
const COS_10 = 0.9848
const COS_22 = 0.9272
const COS_24 = 0.9135
const COS_50 = 0.6428
const COS_60 = 0.5

/**
 * LES TROIS ARMES, ET LEUR VÉRITÉ (décision utilisateur 2026-07-13).
 *
 *   · LES POINGS — rapides, courts, et ils AVANCENT : chaque coup fait un pas, en
 *     zigzag. On ne rate pas de beaucoup, mais on ne fait mal à personne. Chargés :
 *     un overhead à deux mains qui s'abat sur un disque au sol — le geste du
 *     désespoir, quand deux zombies vous collent et qu'on n'a rien en main.
 *   · LA LANCE — l'ALLONGE. Un pic étroit : on tient le loup à distance, on frappe
 *     avant d'être mordu. Mais un raté est un VRAI raté (l'arc est fin), et le pic
 *     chargé emmène le corps en avant : s'il ne trouve pas de chair, on reste planté.
 *   · LA HACHE — le gros coup lent qui BALAIE. Arc large : elle prend deux corps
 *     serrés là où la lance n'en sort qu'un. Chargée, elle fait le tour complet.
 *
 * La lance garde sa raison d'être face à la hache (l'allonge), la hache garde la
 * sienne (la horde). Ce n'est pas une échelle de puissance, c'est un choix.
 *
 * SUR LES DEUX CÔNES DE LA LANCE (±22° simple, ±10° chargé) : le pic chargé DOIT être
 * fin — c'est lui qui punit le raté, et un engagement qu'on ne peut pas rater n'en est
 * pas un. Mais le coup SIMPLE, lui, est l'outil du quotidien : à ±14° (premier jet),
 * il ratait un sanglier qui bronchait à un mètre. Une arme dont le coup de base est
 * une loterie n'est pas « exigeante », elle est cassée.
 */
export const WEAPON_PROFILES: Record<WeaponKind, WeaponProfile> = {
  unarmed: {
    light: {
      shape: 'cone',
      range: 1.1,
      arcCos: COS_50,
      radius: 0,
      damage: 6,
      stamina: 8,
      windupTicks: ticksFor(0.2),
      recoveryHit: ticksFor(0.25),
      recoveryWhiff: ticksFor(0.45),
      lunge: 0.35,
      weave: true,
    },
    charged: {
      shape: 'disc',
      range: 1.2,
      arcCos: 0,
      radius: 0.9,
      damage: 18,
      stamina: 26,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.5),
      recoveryWhiff: ticksFor(1.2),
      lunge: 0.5,
      weave: false,
    },
    chargeTicks: ticksFor(0.55),
  },
  crude_spear: {
    light: {
      shape: 'cone',
      range: 1.9,
      arcCos: COS_24,
      radius: 0,
      damage: 10,
      stamina: 13,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.35),
      recoveryWhiff: ticksFor(0.65),
      lunge: 0.2,
      weave: false,
    },
    charged: {
      shape: 'cone',
      range: 2.5,
      arcCos: COS_10,
      radius: 0,
      damage: 20,
      stamina: 28,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.5),
      recoveryWhiff: ticksFor(1.3),
      lunge: 2.2,
      weave: false,
    },
    chargeTicks: ticksFor(0.65),
  },
  spear: {
    light: {
      shape: 'cone',
      range: 2.3,
      arcCos: COS_22,
      radius: 0,
      damage: 16,
      stamina: 15,
      windupTicks: ticksFor(0.45),
      recoveryHit: ticksFor(0.4),
      recoveryWhiff: ticksFor(0.7),
      lunge: 0.2,
      weave: false,
    },
    charged: {
      shape: 'cone',
      range: 3.1,
      arcCos: COS_10,
      radius: 0,
      damage: 32,
      stamina: 32,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.55),
      recoveryWhiff: ticksFor(1.5),
      // LA CHARGE : le corps parcourt TROIS TUILES ET DEMIE — 8 tuiles/s, le double de
      // la marche. Ce n'est plus un pas, c'est un ENGAGEMENT : on ferme la distance et
      // on embroche. Elle TRAVERSE ce qui est trop proche (décision utilisateur) : le
      // coup se résout à l'arrivée, donc une cible collée finit dans le dos et le pic
      // fend l'air. La charge est une arme de DISTANCE — mal jugée, elle cloue sur place
      // (`recoveryWhiff`, 1,5 s). C'est le prix, et il se voit.
      lunge: 3.2,
      weave: false,
    },
    chargeTicks: ticksFor(0.7),
  },
  iron_axe: {
    light: {
      shape: 'cone',
      range: 1.5,
      arcCos: COS_60,
      radius: 0,
      damage: 14,
      stamina: 18,
      windupTicks: ticksFor(0.55),
      recoveryHit: ticksFor(0.45),
      recoveryWhiff: ticksFor(0.8),
      lunge: 0.25,
      weave: false,
    },
    charged: {
      // LE TOURBILLON : un cône de 360°, donc pas une troisième géométrie. Et une zone
      // LARGE — 2,6 tuiles tout autour du corps. À 1,8 (premier jet) il ne se distinguait
      // pas du disque des poings : deux ellipses de même taille, et le joueur ne lisait
      // plus rien. Ce qui sépare deux coups, c'est ce qu'on VOIT au sol, pas leur nom.
      shape: 'cone',
      range: 2.6,
      arcCos: -1,
      radius: 0,
      damage: 24,
      stamina: 34,
      windupTicks: ticksFor(0.5),
      recoveryHit: ticksFor(0.6),
      recoveryWhiff: ticksFor(1.6),
      lunge: 0,
      weave: false,
    },
    chargeTicks: ticksFor(0.8),
  },
}

/**
 * Dégâts des armes portées — mains nues : COMBAT.UNARMED_DAMAGE. DÉRIVÉ des profils :
 * une seule source de vérité, sinon les deux tables divergent au premier réglage.
 * Sert aussi de REGISTRE : ce qui figure ici est une arme (un outil ne l'est pas).
 */
export const WEAPON_DAMAGE: Partial<Record<import('./items').ItemId, number>> = {
  spear: WEAPON_PROFILES.spear.light.damage,
  iron_axe: WEAPON_PROFILES.iron_axe.light.damage,
  // L'épieu taillé se glisse entre les mains nues (6) et la lance (16), à 10 : une
  // réponse au loup et au sanglier dès la première nuit, sans rendre la lance
  // inutile — elle frappe 60 % plus fort et tient cinq fois plus (spec C9).
  crude_spear: WEAPON_PROFILES.crude_spear.light.damage,
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
  /**
   * LE CROCHET (spec chasse C15), dans [0, 1] : combien cette bête zigzague en
   * fuite, à découvert. Le lapin crochète à fond (1), le cerf à moitié (0,5), le
   * sanglier jamais (absent) — lui ne zigzague pas, il se retourne.
   */
  jink?: number
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
    jink: 1, // il crochète À FOND : on ne l'attrape pas en courant droit (chasse C15)
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
    jink: 0.5, // il crochète, mais moins sec que le lapin (chasse C15)
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
   * LE GRADIENT DE DANGER (spec tension.md, GDD §8bis). Près du foyer, les
   * prédateurs sont RARES ; aux marges, le monde leur appartient. Sans lui, le
   * cercle sauvage était riche sans être dangereux : s'éloigner rapportait sans
   * faire peur, et le PORTAGE — qui rend la distance coûteuse — n'achetait aucune
   * tension. Les deux règles se tiennent la main.
   */
  PREDATOR_BIAS_DOMESTIC: 0.2,
  PREDATOR_BIAS_WILD: 2.5,
  /**
   * Plafond de bêtes ambiantes vivantes (hors bêtes de lieu, résidentes).
   *
   * CALIBRÉ EN JEU (2026-07-11) : ce qui compte n'est pas le plafond mais la
   * DENSITÉ dans le disque utile. À 30 bêtes sur un rayon de 62 (12 000 tuiles)
   * pour un écran de ~710 tuiles, on attend ~2 bêtes en vue — et on n'en voyait
   * effectivement qu'une. En resserrant le disque (52) et en montant le plafond,
   * on vise ~4 : assez pour que la forêt bruisse, trop peu pour un zoo.
   */
  CAP: 30,
  /* ── LES COINS DE CHASSE (spec faune R17) ───────────────────────────────── */
  /**
   * LE GIBIER A DES ADRESSES (décision utilisateur, 2026-07-13).
   *
   * La faune était un BROUILLARD UNIFORME : elle naissait autour du joueur, où
   * qu'il aille. Marcher dix minutes dans n'importe quelle direction donnait
   * exactement la même chose — donc la carte ne s'apprenait pas, et « le gibier
   * est une ressource de TERRITOIRE, pas de temps » (R16) n'était qu'une phrase.
   *
   * Le monde porte maintenant des COINS DE CHASSE : des lieux FIXES, semés une
   * fois pour la saison, où le gibier vit. Entre eux, la vallée est VIDE — et
   * c'est ce vide qui donne leur valeur aux coins.
   *
   * Ils sont posés à des endroits LOGIQUES (retour utilisateur) : un biome OUVERT
   * (on y broute) À PORTÉE D'EAU (on y boit). Un semis de Poisson donne
   * l'espacement, ces deux conditions donnent l'adresse — le gibier ne vit pas
   * sur un éboulis.
   */
  GROUND_SPACING: 200, // deux coins ne se touchent jamais (semis de Poisson)
  GROUND_RADIUS: 46, // le territoire : hors de ce disque, rien ne naît
  GROUND_SNAP: 30, // depuis le point tiré, on cherche la bonne tuile dans ce rayon
  GROUND_WATER_NEAR: 40, // « à portée d'eau » : le gibier boit tous les jours
  GROUND_WATER_CELL: 8, // maille de la grille d'eau (précalcul du worldgen)
  /**
   * LA MIGRATION DANS SON COIN. Une bête d'un coin de chasse ne dérive pas
   * n'importe où : elle se donne un BUT à l'intérieur de son territoire, et elle
   * y va. Le troupeau traverse sa clairière ; il ne quitte pas le canton.
   */
  MIGRATE_SLICE_TICKS: ticksFor(45),
  MIGRATE_REACH: 0.7, // …dans les 70 % intérieurs du disque : elle ne rase pas la frontière
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
  FLEE_SPEED: 1, // × la vitesse de l'espèce : l'allure de rompue des prédateurs
  BURST_RUN_TICKS: ticksFor(1.6), // le sprint burst promis par combat.md R12…
  BURST_PAUSE_TICKS: ticksFor(0.7), // …et le souffle qui le rend LISIBLE (plus « chassable » : voir R6)

  /* ── La fuite ENGAGÉE (R6, refondue 2026-07-13) ─────────────────────────── */
  /**
   * LE SURRÉGIME. En fuite, le gibier court à ça × sa vitesse : cerf ~6,9 t/s,
   * lapin ~7,5 — plus vite qu'un sprint de joueur (6), TOUJOURS. Le playtest
   * était sans appel : à-coups inconditionnels + peur courte = un cerf rattrapé
   * à la course, ce qu'aucun cerf du monde n'accorde. La chasse à course droite
   * est morte ; restent l'approche (spec chasse) et le tir à venir. Conséquence
   * actée : le loup (4,8) ne rattrape plus un cerf SAIN — c'est CHASSE II (le
   * sang) qui lui rendra ses proies : la ruée blesse, le sang ralentit.
   */
  FLEE_SPRINT: 1.5,
  /**
   * LE SOUFFLE EST UN LUXE DE LA MARGE. La bête ne marque la pause de burst que
   * si la menace PERÇUE est plus loin que ça — serrée de près, elle court plein
   * pot. (Et un chasseur qui se fige pendant qu'elle souffle redevient presque
   * imperceptible : le stop-and-go vaut aussi en poursuite.)
   */
  BREATHE_GAP: 12,
  /**
   * LE POINT DE PEUR. Une bête levée mémorise D'OÙ est venue la peur et fuit
   * jusqu'à en être à cette distance — menace visible ou pas. C'est ce qui fait
   * « partir loin avant de reprendre une vie normale », au lieu de s'arrêter à
   * quatorze tuiles et de rebrouter sous le nez du chasseur.
   */
  FLEE_GOAL: 30,
  /** La borne dure de l'engagement — pour la bête ACCULÉE contre une falaise. */
  FLEE_MAX_TICKS: ticksFor(15),

  /* ── L'espace vital et l'impatience (R6bis) ─────────────────────────────── */
  /**
   * L'ESPACE VITAL. Une menace repérée (jauge ≥ alerte) à moins de ça : LEVÉE,
   * immobile ou pas. Sans lui, un joueur AFK finissait ENCERCLÉ de cerfs
   * statufiés — la jauge d'un immobile converge sous 1, et le gel n'avait pas
   * d'issue. Un cerf ne broute pas à trois mètres d'une silhouette identifiée.
   * (Le sanglier est exempté : son trop-près à lui, c'est la MENACE, R14.)
   *
   * 3,5 et pas plus : il ne mord que sur la jauge ≥ ALERTE — le chasseur du
   * stop-and-go, qui approche SOUS le seuil, ne le rencontre jamais (le coup
   * propre exige déjà d'être sous l'alerte). L'espace vital punit l'approche
   * RATÉE, pas l'approche.
   */
  PERSONAL_SPACE: 3.5,
  /**
   * L'IMPATIENCE. Alertée depuis plus de ça sans résolution, la bête ne reste
   * pas statue : elle s'éloigne au trot jusqu'à retomber sous le seuil — le
   * cerf tape du sabot, fixe, puis s'écarte.
   */
  IMPATIENCE_TICKS: ticksFor(6),
  /** Le trot du méfiant : s'écarter, se regrouper, rentrer chez soi — plus vite que brouter. */
  WARY_SPEED: 0.7,
  /**
   * LE RETOUR AU PAYS. Rayon de sondage d'une bête qui se réveille HORS de son
   * habitat (la fuite engagée l'y a jetée) : elle cherche sa tuile de biome la
   * plus proche et y rentre. Sans ça elle se figeait à jamais — `stepStaysHome`
   * refuse tous les caps de qui est déjà dehors (bug attrapé au banc).
   */
  HOMING_SEEK: 24,
  /**
   * ET ELLE RENTRE JUSQU'AU CŒUR DE SA TUILE. Rendre la main dès que la bête a
   * franchi la lisière, c'est la lâcher PILE SUR LE BORD — où le moindre pas de
   * cohésion ou de séparation (qui ne connaissent pas les biomes) la rejette
   * dehors, et où `goHome` la rappelle aussitôt : elle danserait sur la frontière.
   */
  HOMING_ARRIVE: 0.35,

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
  /**
   * …ET ELLE NE LÂCHE QU'ICI. Le rappel est COLLANT (hystérésis), comme la peur :
   * elle se déclenche à `flightRange` et ne retombe qu'à `SAFE_RANGE`.
   *
   * Sans ce second seuil, la bête franchissait HERD_SPREAD, se faisait rappeler
   * d'un pas, repassait sous le seuil — et RESSORTAIT aussitôt (son cap d'errance
   * pointait toujours dehors). Deux à trois allers-retours par seconde : les
   * cerfs TREMBLAIENT en pâturant, et c'est ce que le playtest a vu.
   */
  HERD_COMFORT: 2.5,
  /** Rayon de dispersion d'une harde à la naissance (tuiles). */
  HERD_SPAWN_SPREAD: 3,

  /* ── Le troupeau qui vit (R9bis, 2026-07-13) ────────────────────────────── */
  /** LA SÉPARATION (boids-lite) : deux bêtes plus proches que ça s'écartent d'un pas. */
  HERD_SEPARATION: 1.2,
  /**
   * …et elle ne lâche qu'ICI (hystérésis, comme la cohésion et la peur). Un seuil
   * unique relâchait la bête à un cheveu du contact : son cap d'errance la
   * ramenait sur sa voisine au tick suivant, elles se repoussaient encore, et ça
   * frémissait. TOUT SEUIL QUI COMMANDE UN MOUVEMENT VEUT SON HYSTÉRÉSIS.
   */
  HERD_SEPARATION_COMFORT: 1.9,
  /**
   * LA DÉRIVE DE PÂTURE. La harde a un cap de broutage partagé qui tourne à
   * cette cadence (dérivé de `herdId` + tranche de temps par `hash2` — pur,
   * zéro état, zéro tirage) : le troupeau TRAVERSE le paysage en broutant au
   * lieu de trembler sur place.
   */
  DRIFT_SLICE_TICKS: ticksFor(20),
  /** La part des re-décisions de cap qui suivent la dérive plutôt que le hasard. */
  DRIFT_BIAS: 0.6,
  /** LE REPOS GROUPÉ : hors de ses heures, la harde se couche resserrée sous ça. */
  REST_SPREAD: 2.5,
  /**
   * LA SENTINELLE (spec chasse C13, livrée ici — R9bis). Dans une harde de
   * gibier ≥ 3, UNE bête à la fois est de garde : tête haute, immobile, regard
   * qui balaie, perception accrue — pendant que les brouteuses relâchent.
   * Le tour se DÉRIVE (rang + tick ÷ SHIFT) : zéro état, déterminisme gratuit.
   */
  SENTINEL_SHIFT: ticksFor(20),
  SENTINEL_SWEEP_TICKS: ticksFor(2.5), // son regard passe d'un relèvement au suivant
  SENTINEL_ACUITY: 1.4,
  HERD_RELAX: 0.85,

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
  /**
   * L'HEURE DU LOUP (spec faune R10bis, 2026-07-13). Sa VIGUEUR (`activityAt`,
   * nocturne) pondère ce qu'il ose : ses portées d'acquisition ET de poursuite
   * sont multipliées par `WOLF_DAY_FLOOR + (1 − FLOOR) × vigueur`.
   *
   * R10 couchait le gibier hors de ses heures, mais le loup, lui, chassait à
   * PLEINE portée à midi comme à 3 h : la nuit ne tenait pas sa promesse, et
   * traverser la forêt de jour n'était pas plus sûr. Désormais un loup diurne
   * est somnolent — on passe au large d'une meute assoupie (elle est VISIBLE,
   * c'est un choix, pas une loterie) — et la nuit lui rend ses treize tuiles.
   *
   * Le plancher n'est pas zéro : une meute de plein jour reste dangereuse à qui
   * lui marche dessus. On ne fabrique pas un interrupteur, on incline le monde.
   */
  WOLF_DAY_FLOOR: 0.45,
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

/**
 * LA CHASSE (spec chasse, CHASSE I) — l'approche, la mise à mort, le sang.
 *
 * Le cœur en une phrase : LA MÉFIANCE remplace les murs. Une bête ne compare
 * plus une distance à deux rayons — elle porte une jauge (0-1) qui POURSUIT un
 * stimulus continu, vite en montée, lentement en descente. C'est ce qui achète
 * le stop-and-go du chasseur : elle lève la tête, on se fige, elle se rassure,
 * on regagne trois mètres. Être vu n'est plus perdre — c'est un événement à gérer.
 *
 * Tous les nombres sont des ordres de grandeur (GDD §15) : les vitesses de
 * montée/descente de la jauge feront ou déferont le stop-and-go, et ça se
 * calibre À L'ÉCRAN (`pnpm smoke --scenario chasse`), pas au raisonnement.
 */
export const HUNT = {
  /* ── La méfiance (chasse C1) ─────────────────────────────────────────────── */
  /** Plafond de perception : au-delà d'`alertRange × ça` (perçu), rien ne monte. */
  PERCEIVE_FACTOR: 1.25,
  /** CURIEUSE : elle s'arrête et REGARDE. Le joueur sait qu'il a été vu (R5). */
  SUSPICION_CURIOUS: 0.35,
  /** ALERTÉE : fixée, tendue, prête à partir — et un coup n'est plus PROPRE (C6). */
  SUSPICION_ALERT: 0.7,
  /** À stimulus plein, la jauge sature en ce temps (secondes). Près = bien plus vite. */
  RISE_S: 1.2,
  /** Sans stimulus, la jauge retombe en ce temps (secondes) — c'est la fenêtre du figé. */
  DECAY_S: 8,
  /**
   * LA NERVOSITÉ. Chaque franchissement du seuil d'alerte ralentit la décrue
   * (facteur cumulé, plafonné) : on ne refait pas indéfiniment la même approche
   * ratée sur la même bête.
   */
  NERVOUS_FACTOR: 1.6,
  NERVOUS_MAX: 3,
  /**
   * LA PANIQUE : une menace à cette distance BRUTE lève la bête, quelle que soit
   * la furtivité — on ne marche pas SUR un cerf. Sous la portée de la lance (2,3) :
   * la mise à mort propre au contact reste possible, la caresse non. Ne vaut que
   * pour les bêtes qui fuient (`flightRange > 0`) : le sanglier, lui, MENACE.
   */
  PANIC_RANGE: 1.8,

  /* ── Les deux sens (chasse C2-C5) : la VUE et l'OUÏE ─────────────────────── */
  /**
   * La bête perçoit par DEUX canaux, et retient le plus fort :
   *   — la VUE : visibilité de l'allure × couvert du terrain × REGARD (l'angle).
   *     C'est elle qu'on bat en se cachant, en se figeant, en passant derrière.
   *   — l'OUÏE : le bruit de l'allure, OMNIDIRECTIONNEL — ni le fourré ni le dos
   *     tourné n'y peuvent rien. C'est elle qui interdit d'arriver au CONTACT en
   *     marchant, même de dos : le pas s'entend.
   * Un seul produit aurait menti deux fois (attrapé par les tests A5/A6) : un
   * marcheur dans le dos devenait inaudible, et une bête en fuite devenait
   * aveugle à ce qu'elle fuit — l'angle multipliait aussi le bruit.
   */
  /** La VISIBILITÉ par allure : un corps immobile se voit mal, un sprint saute aux yeux. */
  /**
   * L'immobile disparaît presque (0,25) : c'est LA condition du stop-and-go.
   * À 0,4, une bête curieuse qui vous FIXAIT maintenait la jauge à flot même
   * figé — se geler ne servait à rien, mesuré au banc A2. L'œil du gibier
   * accroche le MOUVEMENT ; une silhouette plantée redevient un rocher.
   */
  VIS_STILL: 0.25,
  VIS_SNEAK: 0.55, // plié en deux : mesuré au banc, il gagne ~2 tuiles sur le marcheur
  VIS_WALK: 1,
  VIS_SPRINT: 1.4,
  /**
   * Le BRUIT par allure : immobile ≪ pas lent ≪ marche ≪ sprint. Le pas lent est
   * VRAIMENT feutré (0,4) — mesuré au banc : à 0,55, la distance de levée d'un
   * approcheur lent ne gagnait que 0,8 tuile sur un marcheur, et le verbe
   * « approcher » ne valait pas son coût en vitesse.
   */
  NOISE_STILL: 0.25,
  NOISE_SNEAK: 0.4,
  NOISE_WALK: 1,
  NOISE_SPRINT: 1.6,
  /** L'ouïe porte un peu moins loin que la vue (× les portées de l'espèce). */
  HEARING_FACTOR: 0.8,
  /** Le pas lent (input `sneak`) : discret, et lent — c'est le prix. */
  SNEAK_SPEED_FACTOR: 0.5,

  /* ── Le regard (chasse C4) — le canal de la VUE seulement ───────────────── */
  /**
   * La vue d'une bête est DIRECTIONNELLE : pleine devant, réduite de flanc,
   * faible dans le dos. Trois secteurs par produit scalaire (littéraux — pas de
   * trigo, invariant §2) : approcher devient un problème de POSITION.
   */
  ANGLE_FRONT_COS: 0.5, // dot ≥ : devant (±60°)
  ANGLE_BACK_COS: -0.3, // dot ≤ : dans le dos
  ANGLE_FRONT: 1,
  ANGLE_SIDE: 0.75,
  ANGLE_BACK: 0.45,
  /** Le loup est quasi silencieux : son « bruit » est une fraction de sa furtivité visuelle. */
  PREDATOR_NOISE: 0.5,

  /* ── La mise à mort propre (chasse C6) ───────────────────────────────────── */
  /**
   * Un coup dont le wind-up DÉMARRE sur une bête sauvage non alertée frappe ça
   * fois plus fort. La lance (16) couche un cerf (45) d'un seul coup propre ;
   * l'épieu (10) prend le sanglier ; les poings, le lapin. L'approche parfaite a
   * enfin un payoff décisif — c'est la règle du loup rendue au joueur.
   */
  CLEAN_KILL_FACTOR: 3,

  /* ── CHASSE II — LE SANG (C8-C12) ───────────────────────────────────────── */
  /**
   * LA PLAIE. L'échec devient FÉCOND : une bête touchée mais pas tuée saigne, et
   * la GRAVITÉ décide de tout. Sous cette fraction de ses PV max, la plaie est
   * MORTELLE : elle saigne jusqu'à mourir — elle est à vous, si vous la
   * retrouvez. Au-dessus, la plaie est LÉGÈRE : elle se referme, la piste
   * s'éteint, la bête survit (décision utilisateur n°3 — sans quoi « toucher une
   * fois et attendre » deviendrait la stratégie dominante et la traque perdrait
   * son horloge).
   *
   * Le choix du chasseur devient réel : FRAPPER FORT — chargé, de près, propre —
   * OU PERDRE LA BÊTE. L'éraflure de loin ne « réserve » pas un cerf.
   */
  MORTAL_BELOW: 0.5,
  BLEED_HP_PER_S: 0.5,
  LIGHT_BLEED_TICKS: ticksFor(25),
  /**
   * LE SANG AU SOL. Une goutte à cette cadence, pour tout ce qui saigne — bête
   * blessée ET avatar (combat R7 : le sang est le sang). De l'ÉTAT, pas des
   * événements (haute fréquence ≠ domaine). Borné : TTL + plafond FIFO.
   *
   * La piste est LISIBLE PAR TOUS : suivre du sang frais ne demande aucune
   * maîtrise. Les empreintes, l'âge des traces, le sens de la course — ça, c'est
   * l'arbre Chasse, plus tard, par-dessus.
   */
  BLOOD_EVERY_TICKS: ticksFor(0.8),
  BLOOD_TTL: ticksFor(180),
  BLOOD_CAP: 256,
  /**
   * LA BÊTE DIMINUÉE. Sa vitesse suit ses PV : `FLOOR + (1 − FLOOR) × hp/hpMax`.
   * L'écart se referme à mesure qu'elle saigne — PRESSER une bête mortellement
   * atteinte devient une stratégie, au prix de l'endurance. (L'autre stratégie,
   * c'est d'ATTENDRE qu'elle se couche… mais le sang appelle d'autres nez.)
   */
  WOUNDED_SLOW_FLOOR: 0.55,
  /**
   * LE COUCHÉ. Une bête à plaie mortelle qui ne perçoit plus rien pendant ce
   * temps gagne le meilleur couvert à portée et s'y TAPIT : immobile, perception
   * effondrée. On la retrouve PAR LE SANG, pas en battant la carte.
   */
  BED_AFTER: ticksFor(10),
  BED_SEEK: 8,
  BED_ALERTNESS: 0.4,
  /**
   * LE SANG APPELLE LES LOUPS (C12). Une carcasse FRAÎCHE porte loin : le
   * prédateur affamé la sent à `CARCASS_SEEK_FRESH` au lieu de `CARCASS_SEEK`.
   * Mis bout à bout avec le portage (qui interdit le silence, C2) : TUER ARME UN
   * MINUTEUR. On tue, on charge la viande — et on entend le hurlement.
   */
  CARCASS_FRESH_TICKS: ticksFor(240),
  CARCASS_SEEK_FRESH: 40,
  /** Le poids de spawn des prédateurs près d'une carcasse fraîche ou d'un blessé. */
  BLOOD_PREDATOR_BIAS: 2,
  BLOOD_SCENT_RADIUS: 30,
  /**
   * LE PRÉDATEUR PRÉFÈRE LE SANG. Une cible qui saigne « pèse » ça de plus au
   * choix de proie (même mécanique que PREY_PREFERENCE). La meute cueille les
   * diminués — y compris VOTRE cerf blessé, et y compris VOUS (décision
   * utilisateur n°2 : le sang du joueur appelle les loups ; le bandage devient
   * un geste de survie en territoire à loups).
   */
  WOUNDED_PREFERENCE: 1.5,

  /* ── CHASSE III — la ruse (C14-C18) ─────────────────────────────────────── */
  /**
   * LA SCISSION (C14). Une harde levée éclate en DEUX : les rangs pairs
   * infléchissent leur fuite d'un côté, les impairs de l'autre (rotation ±45°,
   * matrice à coefficients littéraux). Le chasseur qui charge « la harde » court
   * entre deux moitiés et n'a rien : ON CHOISIT SA BÊTE AVANT DE LEVER LE GROUPE.
   */
  SPLIT_COS: 0.7071,
  SPLIT_SIN: 0.7071,
  /**
   * LE CROCHET (C15). En terrain DÉCOUVERT, la bête jinke : à chaque nouveau
   * burst, son vecteur de fuite tourne de ±40° (au PRNG). Courir droit derrière
   * ne marche plus ; anticiper le crochet et COUPER, si. En couvert, elle file :
   * le terrain décide du geste.
   */
  JINK_COS: 0.766,
  JINK_SIN: 0.6428,
  JINK_OPEN_COVER: 0.85, // au-dessus de ce couvert, le terrain est « découvert »
  /**
   * LE TERRIER (C16). Le lapin naît avec le sien (sa tuile de naissance, hors
   * champ par construction). Levé, il fuit VERS lui — sauf à devoir traverser la
   * menace — et il y DISPARAÎT. La chasse au lapin devient une géométrie :
   * couper la ligne du terrier, ou le perdre.
   */
  BURROW_RANGE: 1.2, // il y entre à cette distance
  /**
   * LE VENT (C17). Il tourne lentement, au PRNG de l'état. L'ODEUR DESCEND LE
   * VENT : une menace au vent d'une bête (alignement > SCENT_COS, dans
   * SCENT_RANGE_FACTOR × sa portée) fait monter sa méfiance QUELS QUE SOIENT
   * l'allure, le couvert et le dos tourné. Le nez se moque des précautions — et
   * c'est le seul sens qui s'en moque. La parade n'est pas un facteur de plus :
   * c'est UN CÔTÉ. Approcher sous le vent.
   */
  WIND_SHIFT_TICKS: ticksFor(300),
  SCENT_RANGE_FACTOR: 1.2,
  SCENT_COS: 0.8,
  /** Ce que « sentir » vaut comme perception (× la portée) : le nez porte fort. */
  SCENT_STRENGTH: 1,
  /**
   * L'APPÂT (C18). Le gibier est attiré par la nourriture au sol, s'y plante et
   * mange — la fenêtre du chasseur, POSÉE PAR LE CHASSEUR. Et un prédateur mange
   * une pile de viande comme une carcasse : jeter de la viande à une meute qui
   * vous serre (faune R15, GDD §9bis) devient enfin un geste exécutable.
   */
  BAIT_SEEK: 12,
  BAIT_RANGE: 1.2,
  BAIT_TICKS: ticksFor(6),
  BAIT_ALERTNESS: 0.4, // tête dans l'appât : ses portées s'effondrent
  /** Une pile au sol périt : le monde ne se jonche pas (~10 min). */
  GROUND_TTL: ticksFor(600),
} as const

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
  /** Armement par DÉFAUT — celui des BÊTES (les avatars suivent WEAPON_PROFILES). */
  WINDUP_TICKS: ticksFor(0.4),
  /** Portée par DÉFAUT — celle des BÊTES. Un avatar frappe à la portée de son arme. */
  ATTACK_RANGE: 1.4,
  /**
   * LE PAS QUI DANSE (spec combat R4bis). Les coups de poing successifs portent le
   * corps en avant, mais en zigzag : gauche, droite, gauche… Le pas dévie de 25° de
   * la visée — on frappe TOUJOURS là où l'on vise, seul le PIED change de côté.
   * Tabulés : `Math.cos`/`Math.sin` sont interdits dans /sim (invariant §2).
   */
  WEAVE_COS: 0.9063,
  WEAVE_SIN: 0.4226,
  /** On ne charge pas un coup en courant : maintenir le clic ralentit (spec R4ter). */
  CHARGE_MOVE_FACTOR: 0.55,
  /** Distance à laquelle une BÊTE déclenche sa morsure (sa portée est ATTACK_RANGE).
   *  Un AVATAR, lui, engage à la portée de son arme × ENGAGE_MARGIN (`engageRange`). */
  MELEE_ENGAGE_RANGE: 1.2,
  /** On entre DANS sa zone, on ne s'arrête pas pile sur son bord : la cible bouge. */
  ENGAGE_MARGIN: 0.85,
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

/**
 * LA NUIT QUI CHASSE (spec `tension.md`). « La nuit, loin d'un feu, on est chassé. »
 *
 * Une règle, une parade (un Feu, ou rentrer), une annonce (le hurlement), une
 * borne (jamais plus de MAX_ALIVE). C'est ce quatuor qui fait la différence entre
 * une tension et une brimade : le joueur doit pouvoir PERDRE, jamais être submergé,
 * et toujours savoir ce qu'il aurait dû faire.
 */
export const NIGHT_HUNT = {
  /**
   * Probabilité par minute réelle, par acte. Le Grand Froid affame les loups.
   *
   * CALIBRÉ SUR LE COMBAT RÉEL, pas au doigt mouillé. Un loup : 35 PV, 14 dégâts,
   * et il court PLUS VITE que nous — on ne le distance pas, on le combat ou on
   * rejoint un feu. À mains nues (6 dégâts, un coup/seconde) on en tue UN, de
   * justesse, à ~30 PV près. DEUX, jamais.
   *
   * L'acte I est donc doux (~2 rôdeurs sur une nuit de 18 minutes) : la première
   * nuit doit être un DANGER, pas une exécution. Le Grand Froid, lui, serre la vis —
   * mais à ce moment-là le joueur a un épieu, un feu, et il sait pourquoi.
   */
  CHANCE_PER_MIN: [0.12, 0.3, 0.55],
  /** Rôdeurs simultanés sur une même proie. On peut perdre ; on ne doit pas être noyé. */
  MAX_ALIVE: 2,
  /** Ils naissent à cette distance : hors de vue, mais on les voit VENIR. */
  SPAWN_DIST: 15,
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

  /*
   * QUATRE PALIERS (décision utilisateur, 2026-07-13) : léger, moyen, lourd,
   * surchargé. Les trois premiers sont BORNÉS et leur effet est UNIFORME — pas de
   * pente continue.
   *
   * C'est un choix de LISIBILITÉ, et il vaut mieux que la pente que j'avais posée :
   * une pente, on la subit sans jamais savoir où l'on est ; un palier, on le
   * FRANCHIT — on sent le cran, on peut décider de rester en dessous, et on sait ce
   * qu'une baie de plus va coûter (rien, jusqu'au prochain cran).
   *
   * La SURCHARGE, elle, est proportionnelle : c'est le seul endroit où l'on veut
   * que la peine grandisse à chaque objet ramassé — c'est là qu'est le drame.
   */

  /** Bornes HAUTES des paliers, en fraction de la capacité. */
  LIGHT_MAX: 0.33,
  MEDIUM_MAX: 0.66,
  HEAVY_MAX: 1,

  /** L'effet sur la vitesse, UNIFORME dans le palier. */
  SPEED_LIGHT: 1,
  SPEED_MEDIUM: 0.85,
  SPEED_HEAVY: 0.7,

  /** SURCHARGÉ : la peine devient PROPORTIONNELLE — par unité de capacité au-delà
   *  du plein. À 200 % de la capacité, on touche déjà le plancher. */
  OVERLOAD_MALUS_PER_RATIO: 0.5,
  /** On rampe, mais on avance : sans plancher, une surcharge extrême fige le joueur
   *  — et un joueur figé n'a plus de choix du tout, ce qui est l'inverse du but. */
  SPEED_FLOOR: 0.2,

  /** Le sprint tombe au palier LOURD : il est REFUSÉ (pas ralenti). C'est le cran
   *  qu'on sent en premier, avant même de regarder une jauge. */
  SPRINT_MAX_TIER: 'medium',

  /** SURCHARGÉ, l'endurance ne revient presque plus : on ne se bat pas, on ne fuit
   *  pas, on rentre. Le porteur est une PROIE — c'est le PvP léger des routes que
   *  veut le GDD §8bis. */
  OVERLOAD_STAMINA_REGEN: 0.25,
} as const

/** Les quatre paliers de charge (spec portage.md P5). */
export type CarryTier = 'light' | 'medium' | 'heavy' | 'overloaded'

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
