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

/** Durée d'un tick en secondes — le seul dt qui existe dans /sim. */
export const TICK_DT_S = 1 / BALANCE.TICK_RATE_HZ
