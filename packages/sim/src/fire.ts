/**
 * LE FEU COMME STATION (spec `docs/specs/feu-station.md`) — l'état du feu LIBRE
 * (allumé / braises / éteint), dérivé de son combustible, et la combustion au tick.
 * Pur et déterministe : aucun tirage, le temps est le numéro de tick.
 *
 * L'upkeep du FOYER (village.fuel, `advanceUpkeep`) reste dans `village.ts` — la
 * migration vers ce modèle unifié sur la structure est DIFFÉRÉE (spec S16). Ici, seul
 * le feu libre (villageId 0) porte `structure.fuel` ; un Foyer tient toujours (braises
 * dormantes) tant que l'upkeep n'est pas migré.
 */
import { COOK_SLOT, FIRE } from './balance'
import { emitEvent } from './events'
import type { SimState } from './sim'
import type { Structure } from './village'

export type FireState = 'lit' | 'ember' | 'out'

/**
 * L'état d'un feu (spec S1-S3). Le Foyer (villageId ≠ 0) tient TOUJOURS ; le feu LIBRE
 * suit son combustible, puis la fenêtre de braises (`emberUntil`), puis s'éteint.
 */
/**
 * L'état d'un feu, à partir du seul TICK (et non d'un `SimState` complet) — pour que le
 * CLIENT puisse le dériver du snapshot (il a le tick + la structure), source unique avec la sim.
 */
export function fireStateAt(tick: number, s: Structure): FireState {
  if (s.type !== 'fire') return 'out'
  if (s.villageId !== 0) return 'lit' // Foyer : inchangé tant que l'upkeep n'est pas migré (S16)
  // Feu libre SANS champ combustible = hors modèle (feu forgé à la main dans un test,
  // ou d'avant cette feature) : il vaut ALLUMÉ, comportement historique. En prod, tout
  // feu libre naît avec `fuel` (addStructure), donc ce cas ne s'y produit jamais.
  if (s.fuel === undefined) return 'lit'
  if (s.fuel > 0) return 'lit'
  if (s.emberUntil !== undefined && tick < s.emberUntil) return 'ember'
  return 'out'
}

export function fireState(state: SimState, s: Structure): FireState {
  return fireStateAt(state.tick, s)
}

/** Le feu chauffe-t-il / garde-t-il encore ? (allumé OU braises — la garde tient jusqu'aux braises, S4). */
export function fireActive(state: SimState, s: Structure): boolean {
  const st = fireState(state, s)
  return st === 'lit' || st === 'ember'
}

/** Facteur de chaleur selon l'état (S3) : plein allumé, atténué en braises, nul éteint. */
export function fireWarmthFactor(state: SimState, s: Structure): number {
  const st = fireState(state, s)
  if (st === 'lit') return 1
  if (st === 'ember') return FIRE.EMBER_WARMTH_FACTOR
  return 0
}

/**
 * La combustion au tick (spec S2, S12) : chaque feu LIBRE brûle son combustible ; à 0,
 * les flammes meurent — il entre en BRAISES (`emberUntil`) et émet `fire_extinguished`.
 * Le Foyer n'est PAS concerné (village.fuel / `advanceUpkeep`, migration différée S16).
 */
export function advanceFire(state: SimState): void {
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    // Combustion du feu LIBRE (le Foyer tourne sur village.fuel / advanceUpkeep, S16).
    if (s.villageId === 0) {
      const before = s.fuel ?? 0
      if (before > 0) {
        s.fuel = Math.max(0, before - FIRE.DRAIN_PER_TICK)
        if (s.fuel <= 0) {
          s.emberUntil = state.tick + FIRE.EMBER_TICKS
          emitEvent(state, { type: 'fire_extinguished', tick: state.tick, structureId: s.id })
        }
      }
    }
    // Cuisson passive du slot (S7-S9) — sur TOUT feu (libre ou Foyer), le travail de la STATION.
    advanceCookSlot(state, s)
  }
}

/**
 * Une étape de cuisson (spec S7-S9) : le slot descend son compteur UNIQUEMENT tant que le feu
 * est allumé (S8 : exige la flamme, ni braises ni éteint). À 0, l'aliment DEVIENT son résultat
 * cuit et y reste — pas de brûlé (S9). Continue sans le joueur : c'est le travail de la station.
 */
function advanceCookSlot(state: SimState, s: Structure): void {
  const cook = s.cook
  if (!cook || cook.remainingTicks <= 0) return
  if (fireState(state, s) !== 'lit') return
  cook.remainingTicks -= 1
  if (cook.remainingTicks <= 0) {
    const rule = COOK_SLOT[s.type]?.[cook.item]
    if (rule) {
      cook.item = rule.output
      emitEvent(state, { type: 'meat_cooked', tick: state.tick, structureId: s.id, item: rule.output })
    }
  }
}
