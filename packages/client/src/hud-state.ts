/**
 * Le contrat typé du registry Phaser entre WorldScene (écrivain) et UIScene
 * (lecteur). Le registry de Phaser est stringly-typed (`get` renvoie `any`) :
 * on le canalise ici par une interface exhaustive + deux helpers, pour que
 * toute clé et tout type soient vérifiés à la compilation. Les scènes ne
 * doivent JAMAIS appeler `registry.set/get` directement — uniquement
 * `setHud`/`getHud`.
 */
import type { Entity, GameTime, Inventory, SkillId, Village, VillageTask, WorldMap } from '@braises/sim'
import type Phaser from 'phaser'

/** Ce que le joueur peut sélectionner pour bâtir (touches 1-5). */
export type Buildable = 'wall' | 'door' | 'chest' | 'workshop' | 'furnace'

/** Une propriété par clé du registry — la seule source de vérité des clés. */
export interface HudState {
  /** Heure de jeu du dernier snapshot. */
  time: GameTime
  /** Nom de la zone où se trouve l'avatar (undefined hors zone nommée). */
  zone: string | undefined
  /** Nombre de membres de mon village (0 = pas de village). */
  village: number
  /** Tableau des tâches de mon village. */
  tasks: VillageTask[]
  /** Archétype de mon village (null = pas de village). */
  archetype: Village['archetype'] | null
  /** Chaleur du Feu de mon village. */
  villageWarmth: number
  inv: Inventory
  hunger: number
  skills: Partial<Record<SkillId, number>>
  hp: number
  stamina: number
  wounds: Entity['wounds']
  /** Structure sélectionnée pour le mode construction. */
  selected: Buildable
  /** Journal (J) ouvert à la demande. */
  journalOpen: boolean
  /** Carte plein écran (M) ouverte à la demande. */
  mapOpen: boolean
  /** La carte du monde, publiée une fois au `ready` — sert au rendu de la carte
   * plein écran et au lookup de zone/POI sous le curseur (`zoneAt`). */
  mapData: WorldMap
  /** Position LOGIQUE de l'avatar (tuiles) — le marqueur « tu es ici » de la carte. */
  playerPos: { x: number; y: number }
  /** La chronique de la saison, déjà mise en forme. */
  chronicle: string[]
  /** Dernier message d'erreur à afficher (action rejetée, hôte perdu…). */
  error: { reason: string; at: number }
  /** Dernière alarme de mon village (flash rouge). */
  alarm: { at: number }
  seasonEnded: boolean
}

type Registry = Phaser.Data.DataManager

export function setHud<K extends keyof HudState>(registry: Registry, key: K, value: HudState[K]): void {
  registry.set(key, value)
}

/** `undefined` tant que WorldScene n'a pas encore écrit la clé. */
export function getHud<K extends keyof HudState>(registry: Registry, key: K): HudState[K] | undefined {
  // Seule coercition autorisée sur le registry : le point de passage typé.
  return registry.get(key) as HudState[K] | undefined
}
