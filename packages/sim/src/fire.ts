/**
 * LE FEU COMME STATION (spec `docs/specs/feu-station.md`) — l'état du feu LIBRE
 * (allumé / braises / éteint) et la combustion au tick. Pur et déterministe : aucun tirage,
 * le temps est le numéro de tick.
 *
 * COMBUSTIBLE EN SLOT : le feu libre tient des BÛCHES (`fuelWood`) et en brûle UNE à la fois
 * (`burnAt` = tick d'allumage de l'unité en cours, consommée sur `FIRE.BURN_TICKS`). Quand la
 * dernière s'éteint, le feu passe en braises puis meurt. L'upkeep du FOYER (village.fuel) reste
 * dans `village.ts` — migration différée (S16) ; un Foyer tient toujours.
 */
import { COOK_SLOT, FIRE } from './balance'
import { emitEvent } from './events'
import { addItems, countOf, makeInventory, removeItems } from './items'
import type { SimState } from './sim'
import type { Structure } from './village'

export type FireState = 'lit' | 'ember' | 'out'

/**
 * L'état d'un feu, à partir du seul TICK (et non d'un `SimState` complet) — pour que le CLIENT
 * puisse le dériver du snapshot (il a le tick + la structure), source unique avec la sim.
 */
export function fireStateAt(tick: number, s: Structure): FireState {
  if (s.type !== 'fire') return 'out'
  if (s.villageId !== 0) return 'lit' // Foyer : inchangé tant que l'upkeep n'est pas migré (S16)
  // Feu libre SANS slot combustible = hors modèle (feu forgé à la main dans un test, ou d'avant
  // cette feature) : il vaut ALLUMÉ. En prod, tout feu libre naît avec `fuelWood` (addStructure).
  if (s.fuel === undefined) return 'lit'
  if (countOf(s.fuel, 'wood') > 0) return 'lit' // il reste des bûches à brûler
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

/** Ticks restants avant extinction — le TEMPS que le combustible fait tenir le feu (affiché au modal). */
export function fuelTicksRemaining(tick: number, s: Structure): number {
  const wood = s.fuel ? countOf(s.fuel, 'wood') : 0
  if (wood <= 0 || s.burnAt === undefined) return 0
  return Math.max(0, wood * FIRE.BURN_TICKS - (tick - s.burnAt))
}

/** Progression de la CONSOMMATION de la bûche EN COURS (0..1) — l'indicateur du slot combustible. */
export function fuelBurnProgress(tick: number, s: Structure): number {
  if (s.burnAt === undefined) return 0
  return Math.max(0, Math.min(1, (tick - s.burnAt) / FIRE.BURN_TICKS))
}

/**
 * La combustion au tick (spec S2) : chaque feu LIBRE brûle sa bûche en cours ; à échéance, il en
 * consomme une du slot et allume la suivante. À court de bois, les flammes meurent — braises
 * (`emberUntil`) puis extinction (`fire_extinguished`). Le Foyer n'est PAS concerné (S16).
 */
export function advanceFire(state: SimState): void {
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    if (s.villageId === 0 && s.fuel && countOf(s.fuel, 'wood') > 0) {
      if (s.burnAt === undefined) s.burnAt = state.tick // sécurité : rallumer si du bois attend
      if (state.tick >= s.burnAt + FIRE.BURN_TICKS) {
        removeItems(s.fuel, { wood: 1 }) // la bûche en cours est entièrement consommée
        if (countOf(s.fuel, 'wood') > 0) {
          s.burnAt = state.tick // la suivante s'allume
        } else {
          delete s.burnAt
          s.emberUntil = state.tick + FIRE.EMBER_TICKS
          emitEvent(state, { type: 'fire_extinguished', tick: state.tick, structureId: s.id })
        }
      }
    }
    // Cuisson passive (S7-S9) — sur TOUT feu (libre ou Foyer), le travail de la STATION.
    advanceCook(state, s)
  }
}

/**
 * Une étape de cuisson (spec S7-S9) : chaque ENTRÉE descend son compteur tant que le feu est ALLUMÉ
 * (exige la flamme, ni braises ni éteint). À échéance, le résultat (+ sous-produits) part vers les
 * SORTIES (empilé, via `addItems`) et l'entrée se vide ; si les sorties sont pleines, l'entrée reste
 * PRÊTE et réessaie (rien ne se perd). Passif, sans le joueur — le travail de la station.
 */
function advanceCook(state: SimState, s: Structure): void {
  if (!s.cookIn || fireState(state, s) !== 'lit') return
  for (let i = 0; i < s.cookIn.length; i++) {
    const slot = s.cookIn[i]
    if (!slot) continue
    if (slot.remainingTicks > 0) slot.remainingTicks -= 1
    if (slot.remainingTicks > 0) continue
    const rule = COOK_SLOT[s.type]?.[slot.item]
    if (!rule) {
      s.cookIn[i] = null
      continue
    }
    if (!s.cookOut) s.cookOut = makeInventory(FIRE.COOK_OUTPUTS)
    const leftover = addItems(s.cookOut, { [rule.output]: 1 })
    if ((leftover[rule.output] ?? 0) > 0) continue // sorties pleines → l'entrée reste PRÊTE, on attend
    for (const bp of rule.byproducts ?? []) addItems(s.cookOut, { [bp.item]: bp.count }) // best-effort
    emitEvent(state, { type: 'meat_cooked', tick: state.tick, structureId: s.id, item: rule.output })
    s.cookIn[i] = null
  }
}
