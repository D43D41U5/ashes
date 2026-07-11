/**
 * Outils de DÉVELOPPEMENT — pas du jeu.
 *
 * Trois leviers pour arpenter le monde sans le jouer : se téléporter, forcer
 * l'heure, devenir invulnérable. Ils vivent dans /sim (et pas dans le client)
 * parce que la sim est autoritative : un client qui déplacerait son avatar
 * tout seul serait recalé au snapshot suivant.
 *
 * Deux gardes rendent la chose sûre :
 * - Elles ne s'appliquent QUE si la sim a été créée avec `debug: true`. L'hôte
 *   de production ne l'activera pas — un client trafiqué qui enverrait ces
 *   actions se les verrait ignorer par l'autorité, silencieusement.
 * - Elles passent par le canal `action` ordinaire (`PlayerAction`), donc elles
 *   sont capturées par le replay log : une partie où l'on a triché se rejoue
 *   quand même à l'identique.
 */
import type { Entity, SimState } from './sim'
import { cycleOffsetForStartHour, TICKS_PER_CYCLE } from './time'

export type DebugAction =
  /** Poser l'avatar sur une tuile, sans se soucier des obstacles ni de la distance. */
  | { type: 'debug_teleport'; x: number; y: number }
  /** Forcer l'heure murale du cycle (0-24) — décale la PHASE, jamais le calendrier. */
  | { type: 'debug_set_hour'; hour: number }
  /** Invulnérabilité + jauges gelées (voir `refreshGodMode`). */
  | { type: 'debug_god'; on: boolean }

export function isDebugAction(action: { type: string }): action is DebugAction {
  return action.type.startsWith('debug_')
}

export function applyDebugAction(state: SimState, entityId: number, action: DebugAction): void {
  if (!state.debug) return
  const entity = state.entities.find((e) => e.id === entityId)
  if (!entity) return

  if (action.type === 'debug_teleport') {
    // Bornes de la carte seulement : le TP de debug traverse les murs, l'eau et
    // la roche — c'est précisément à ça qu'il sert. On garde juste l'avatar
    // DANS la carte (hors-bornes = terrain indéfini, donc collision cassée).
    entity.x = clamp(action.x, 0.5, state.map.width - 0.5)
    entity.y = clamp(action.y, 0.5, state.map.height - 0.5)
    // Un wind-up en cours frapperait depuis l'ancienne position : on l'annule.
    delete entity.windup
  } else if (action.type === 'debug_set_hour') {
    // hourOfCycle dérive de (tick + cycleOffset) : pour viser une heure sans
    // toucher au tick (qui porte le calendrier, les cooldowns, les wind-ups),
    // on ne bouge que la phase.
    const target = cycleOffsetForStartHour(clamp(action.hour, 0, 24))
    state.cycleOffset = (((target - state.tick) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
  } else {
    if (action.on) entity.god = true
    else delete entity.god
  }
}

/**
 * Fin de tick : on remet à plat les jauges des invulnérables. Couplé au garde
 * de `applyDamage` (combat.ts), ça couvre TOUTES les façons de mourir — coups,
 * saignement, faim, froid — sans avoir à disséminer un `if (god)` dans chaque
 * système.
 */
export function refreshGodMode(state: SimState): void {
  if (!state.debug) return
  for (const entity of state.entities) {
    if (!entity.god) continue
    entity.hp = 100
    entity.stamina = 100
    entity.hunger = 100
    entity.temperature = 100
    entity.wounds = {}
    entity.exhaustedUntil = 0
  }
}

/** Vrai si cette entité ne peut pas être blessée (garde de `applyDamage`). */
export function isInvulnerable(state: SimState, entity: Entity): boolean {
  return state.debug && entity.god === true
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
