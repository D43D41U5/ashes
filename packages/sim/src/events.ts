/**
 * Événements de domaine — les faits discrets et signifiants de la simulation.
 *
 * Quatre systèmes du GDD consomment le même flux : l'alignement (§3 — « on ne
 * mesure que des événements discrets, vérifiables côté serveur »), la
 * chronique de saison (§2), le tableau du village et la réputation locale
 * (§5), et le replay-tribunal (§11). Ils se construisent tous comme des
 * consommateurs de ce flux — jamais en instrumentant la logique après coup.
 *
 * Règles :
 * - Un événement est un fait accompli, pas une intention. Il est émis à
 *   l'endroit où la logique l'exécute, dans le même tick.
 * - Le flux est déterministe : même seed + mêmes inputs = mêmes événements
 *   (contrat testé dans events.test.ts).
 * - Haute fréquence ≠ domaine : un déplacement n'est pas un événement (le
 *   replay log des inputs couvre ça) ; un premier sang, un don, un spawn, oui.
 */
import type { RecipeId } from './balance'
import type { ItemId, SkillId, StructureType } from './items'
import type { SimState } from './sim'

export type SimEvent =
  | { type: 'entity_spawned'; tick: number; entityId: number; x: number; y: number }
  /**
   * UN AVATAR QUITTE LE MONDE (multi) : le joueur s'est déconnecté, son entité est
   * retirée. Distinct de `entity_died` (qui, pour un joueur, RESPAWN sans retirer
   * l'entité) : ici l'entité disparaît pour de bon, comme un PNJ mort. Symétrique
   * d'`entity_spawned` — le join mid-partie qu'il acquitte a le sien.
   */
  | { type: 'entity_despawned'; tick: number; entityId: number }
  | { type: 'day_started'; tick: number }
  | { type: 'night_started'; tick: number }
  | { type: 'season_day_started'; tick: number; day: number }
  | { type: 'act_started'; tick: number; act: 1 | 2 | 3 }
  /**
   * LA CENDRE A AVANCÉ — et la vallée a reculé d'autant.
   *
   * UN par jour de saison, jamais un par nœud brûlé : la chronique veut savoir que le monde a
   * mangé un morceau de la vallée, pas qu'un buisson a grillé. Haute fréquence n'est pas domaine.
   */
  | { type: 'cendre_avance'; tick: number; jour: number; front: number; noeudsBrules: number }
  | { type: 'village_founded'; tick: number; villageId: number; chiefId: number; tx: number; ty: number }
  | {
      type: 'structure_built'
      tick: number
      structureId: number
      structure: StructureType
      villageId: number
      ownerId: number
      tx: number
      ty: number
    }
  | { type: 'structure_removed'; tick: number; structureId: number }
  /** LE FEU MONTE D'UN PALIER (spec construction R6) : le carré grandit, des composants se débloquent. */
  | { type: 'fire_upgraded'; tick: number; villageId: number; tier: number }
  /** UN MUR/PORTE PASSE AU MATÉRIAU SUIVANT (spec construction R8) : bois→pierre→métal. */
  | { type: 'structure_upgraded'; tick: number; structureId: number; material: import('./balance').WallMaterial }
  /**
   * UNE FONCTION ÉMERGENTE A CHANGÉ (spec construction R9-R10). Formée (nouveau
   * `tier`≥1), montée/descendue de palier, close/ouverte, ou PERDUE (`tier` 0). Ancrée
   * au composant primaire (tx,ty). Le tableau du village et l'overlay client en dérivent.
   */
  | {
      type: 'function_changed'
      tick: number
      functionId: import('./balance').FunctionId
      villageId: number
      tx: number
      ty: number
      tier: number
      enclosed: boolean
    }
  | { type: 'member_joined'; tick: number; villageId: number; entityId: number }
  | { type: 'member_banished'; tick: number; villageId: number; entityId: number }
  | { type: 'action_rejected'; tick: number; entityId: number; reason: string }
  // `clean` : le coup a porté DANS LE VERT (abattage à maîtrise, spec recolte-maitrise
  // A4) — l'événement porte l'info, la chronique et le retour de frappe la lisent
  // sans deviner. Absent/`false` = coup baseline (toute récolte instantanée l'est).
  | { type: 'resource_harvested'; tick: number; entityId: number; nodeId: number; item: ItemId; count: number; clean?: boolean }
  | { type: 'node_depleted'; tick: number; nodeId: number }
  // Le craft a un DÉBUT et une FIN distincts depuis la file (spec craft-file) :
  // `craft_queued` est l'intention (les intrants partent), `item_crafted` reste
  // l'objet qui SORT — et il ne s'émet qu'à la livraison réelle, jamais quand la
  // file est bouchée par un sac plein (F10). L'événement suit l'objet, pas le clic.
  | { type: 'craft_queued'; tick: number; entityId: number; recipeId: RecipeId }
  | { type: 'craft_cancelled'; tick: number; entityId: number; recipeId: RecipeId; count: number }
  | { type: 'item_crafted'; tick: number; entityId: number; recipeId: RecipeId; item: ItemId }
  | { type: 'meal_eaten'; tick: number; entityId: number; item: ItemId }
  | { type: 'skill_level_up'; tick: number; entityId: number; skill: SkillId; level: number }
  | { type: 'entity_damaged'; tick: number; entityId: number; byEntityId: number; amount: number }
  | { type: 'wound_inflicted'; tick: number; entityId: number; wound: 'leg' | 'arm' | 'bleeding' }
  | {
      type: 'entity_died'
      tick: number
      entityId: number
      byEntityId: number
      wasMonster: boolean
      cause?: 'cold' | 'hunger'
    }
  | { type: 'entity_respawned'; tick: number; entityId: number }
  | { type: 'entity_bandaged'; tick: number; entityId: number; byEntityId: number }
  /** `clean` (spec chasse C6) : abattue d'un coup PROPRE — non alertée au départ du wind-up. */
  | { type: 'monster_slain'; tick: number; monsterType: import('./balance').MonsterType; byEntityId: number; clean: boolean }
  /** LA PROIE S'EN TIRE (spec chasse C16) : le lapin a regagné son terrier. La chasse est perdue. */
  | { type: 'prey_escaped'; tick: number; monsterType: import('./balance').MonsterType; x: number; y: number }
  /** JETÉ AU SOL (spec chasse C18) : l'appât posé, la viande lâchée à la meute, la charge larguée. */
  | { type: 'item_dropped'; tick: number; entityId: number; item: ItemId; x: number; y: number }
  /**
   * LE HURLEMENT (spec faune R13). Une meute vient de choisir un homme. C'est un
   * FAIT de jeu, pas un effet sonore : le GDD §9bis exige que tout événement se
   * signale (« annoncés, pas surprises »), et c'est le seul avertissement que le
   * joueur recevra avant de voir les loups se placer autour de lui. Émis une
   * seule fois par meute et par proie.
   */
  | { type: 'wolf_howl'; tick: number; targetEntityId: number; packSize: number; x: number; y: number }
  | { type: 'corpse_looted'; tick: number; corpseId: number; byEntityId: number }
  | { type: 'structure_repaired'; tick: number; structureId: number; byEntityId: number }
  | {
      type: 'access_changed'
      tick: number
      structureId: number
      access: import('./items').AccessLevel
      byEntityId: number
    }
  | { type: 'structure_destroyed'; tick: number; structureId: number }
  | { type: 'alarm_raised'; tick: number; villageId: number }
  | { type: 'horde_spawned'; tick: number; hordeId: number; size: number; targetVillageId: number }
  | { type: 'horde_dispersed'; tick: number; hordeId: number }
  | { type: 'convoy_spawned'; tick: number; tx: number; ty: number }
  | { type: 'gift_given'; tick: number; byEntityId: number; toVillageId: number; item: ItemId; count: number }
  | { type: 'village_archetype_changed'; tick: number; villageId: number; archetype: 'foyer' | 'meute' | 'neutre' }
  | { type: 'evacuation_opened'; tick: number; tx: number; ty: number }
  | { type: 'cendreux_risen'; tick: number; entityId: number; x: number; y: number }
  | {
      type: 'season_ended'
      tick: number
      verdicts: {
        villageId: number
        name: string
        archetype: 'foyer' | 'meute' | 'neutre'
        score: number
        outcome: string
      }[]
    }
  | { type: 'poi_discovered'; tick: number; poiId: number; kind: string; byEntityId: number }
  | { type: 'poi_first_visit'; tick: number; poiId: number; kind: string; name: string; byEntityId: number }
// À venir avec les systèmes : pact_signed, cicatrices, …

/** Émet un événement dans le buffer de l'état. Usage interne à /sim. */
export function emitEvent(state: SimState, event: SimEvent): void {
  state.events.push(event)
}

/**
 * Vide et retourne le buffer d'événements. Appelé par l'hôte (Worker, serveur)
 * après chaque tick pour alimenter les consommateurs (alignement, chronique,
 * UI). Le buffer fait partie du SimState : deux runs comparés par snapshot
 * doivent être drainés au même rythme.
 */
export function drainEvents(state: SimState): SimEvent[] {
  const events = state.events
  state.events = []
  return events
}
