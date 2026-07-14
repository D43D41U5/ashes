/**
 * Outils de DÉVELOPPEMENT — pas du jeu.
 *
 * Quatre leviers pour arpenter le monde sans le jouer : se téléporter, forcer
 * l'heure, devenir invulnérable, se donner un objet. Ils vivent dans /sim (et pas
 * dans le client) parce que la sim est autoritative : un client qui déplacerait son
 * avatar tout seul serait recalé au snapshot suivant.
 *
 * Deux gardes rendent la chose sûre :
 * - Elles ne s'appliquent QUE si la sim a été créée avec `debug: true`. L'hôte
 *   de production ne l'activera pas — un client trafiqué qui enverrait ces
 *   actions se les verrait ignorer par l'autorité, silencieusement.
 * - Elles passent par le canal `action` ordinaire (`PlayerAction`), donc elles
 *   sont capturées par le replay log : une partie où l'on a triché se rejoue
 *   quand même à l'identique.
 */
import { addItems, type ItemId } from './items'
import type { Entity, SimState } from './sim'
import { cycleOffsetForStartHour, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

export type DebugAction =
  /** Poser l'avatar sur une tuile, sans se soucier des obstacles ni de la distance. */
  | { type: 'debug_teleport'; x: number; y: number }
  /** Forcer l'heure murale du cycle (0-24) — décale la PHASE, jamais le calendrier. */
  | { type: 'debug_set_hour'; hour: number }
  /**
   * SAUTER AU JOUR DE SAISON — l'outil sans lequel la SAISON est intestable.
   *
   * En Veillée (`calendarScale = 720`), un jour de saison prend deux minutes réelles : atteindre
   * l'acte III (jour 43) demande **une heure et demie de jeu**. Personne ne verra donc jamais le
   * front de cendre avancer — ni un playtesteur, ni un smoke test. Une mécanique qu'on ne peut
   * pas ATTEINDRE est une mécanique morte, et ce projet en a déjà enterré cinq.
   *
   * On saute donc le TICK, ce qui est la seule façon honnête : le tick EST le calendrier. Tout
   * ce qui en dérive (l'acte, la faim, le froid, le front) suit sans qu'on ait à le forcer — et
   * la cendre rattrape son retard au premier tick, puisqu'elle voit le jour basculer.
   *
   * Armée uniquement en DEV (`state.debug`), comme les autres.
   */
  | { type: 'debug_set_season_day'; day: number }
  /** Invulnérabilité + jauges gelées (voir `refreshGodMode`). */
  | { type: 'debug_god'; on: boolean }
  /**
   * Se donner un objet ET LE METTRE EN MAIN. Sans lui, le combat est INVÉRIFIABLE
   * dans le vrai jeu : le joueur démarre les mains vides (spec économie — pas de kit
   * de départ), et il faudrait donc récolter, câbler une corde et forger avant de
   * pouvoir seulement REGARDER un coup de lance à l'écran. Un garde-fou qu'on ne peut
   * pas atteindre ne garde rien.
   */
  | { type: 'debug_grant'; item: ItemId }

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
  } else if (action.type === 'debug_set_season_day') {
    // ON ATTERRIT JUSTE AVANT LE JOUR VISÉ, PAS DESSUS — et ce détail est tout le correctif.
    //
    // Poser le tick PILE sur le premier tick du jour 60 ne franchit aucune bascule : `advanceTime`
    // compare le jour d'avant et le jour d'après, les trouve égaux, et **rien ne se déclenche**.
    // Ni `season_day_started`, ni `act_started`, ni le front de cendre. Le monde se retrouvait au
    // jour 60 avec la vallée intacte — un mensonge, et exactement le genre d'outil de debug qui
    // fait perdre une journée à celui qui lui fait confiance.
    //
    // On se pose donc UN TICK AVANT. La sim franchit la bascule d'elle-même, au tick suivant, par
    // sa machinerie normale : les événements sortent, la cendre avance, l'acte change. **Le debug
    // ne simule pas le temps — il le laisse passer.**
    const jour = Math.max(1, Math.round(action.day))
    const premierTick = Math.round(((jour - 1) * TICKS_PER_SEASON_DAY) / state.calendarScale)
    state.tick = Math.max(0, premierTick - 1)
  } else if (action.type === 'debug_grant') {
    // On le met EN MAIN, pas juste dans le sac : c'est la main qui décide de tout
    // (spec inventaire R9), et un objet au fond du sac ne prouve rien à l'écran.
    if (!addItems(entity.inventory, { [action.item]: 1 })) return
    const slot = entity.inventory.findIndex((s) => s !== null && s.item === action.item)
    if (slot >= 0) entity.activeSlot = slot
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
