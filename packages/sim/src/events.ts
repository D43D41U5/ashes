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
  | { type: 'day_started'; tick: number }
  | { type: 'night_started'; tick: number }
  | { type: 'season_day_started'; tick: number; day: number }
  | { type: 'act_started'; tick: number; act: 1 | 2 | 3 }
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
  | { type: 'member_joined'; tick: number; villageId: number; entityId: number }
  | { type: 'member_banished'; tick: number; villageId: number; entityId: number }
  | { type: 'action_rejected'; tick: number; entityId: number; reason: string }
  | { type: 'resource_harvested'; tick: number; entityId: number; nodeId: number; item: ItemId; count: number }
  | { type: 'node_depleted'; tick: number; nodeId: number }
  | { type: 'item_crafted'; tick: number; entityId: number; recipeId: RecipeId; item: ItemId }
  | { type: 'meal_eaten'; tick: number; entityId: number; item: ItemId }
  | { type: 'skill_level_up'; tick: number; entityId: number; skill: SkillId; level: number }
  | { type: 'entity_damaged'; tick: number; entityId: number; byEntityId: number; amount: number }
  | { type: 'wound_inflicted'; tick: number; entityId: number; wound: 'leg' | 'arm' | 'bleeding' }
  | { type: 'entity_died'; tick: number; entityId: number; byEntityId: number; wasMonster: boolean; cause?: 'cold' }
  | { type: 'entity_respawned'; tick: number; entityId: number }
  | { type: 'entity_bandaged'; tick: number; entityId: number; byEntityId: number }
  | { type: 'monster_slain'; tick: number; monsterType: import('./balance').MonsterType; byEntityId: number }
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
