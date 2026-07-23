/**
 * L'AGRICULTURE — le potager (voie A, spec `agriculture.md`).
 *
 * La pousse est une FONCTION PURE du tick sur l'état PAR PARCELLE (`Structure.plantedAt`) :
 * AUCUNE entité spawnée, AUCUN tirage au PRNG seedé. C'est le garde-fou déterministe — le
 * flux RNG n'est jamais touché (mémoire projet : « RNG fragile au décompte d'entités »). Le
 * rendu client lit le MÊME `cropStage` : une seule source de la maturité.
 */
import { AGRICULTURE } from './balance'
import type { StructureType } from './items'

/** Le minimum dont dépend la maturité : le tick de mise en terre (parcelle vide = absent). La
 *  `Structure` du /sim ET l'`AimStructure` du client le satisfont — une seule source du calcul. */
interface Plot {
  plantedAt?: number
}

/** Les structures où l'on CULTIVE (agriculture) : parcelle (plein air) → serre (hiver) → terroir
 *  (le meilleur palier). Une seule source du « c'est un potager » — /sim, aim client, rendu. */
const PLOT_TYPES: readonly StructureType[] = ['parcelle', 'serre', 'terroir']
export function isPlot(type: StructureType): boolean {
  return PLOT_TYPES.includes(type)
}

/**
 * Le stade de pousse d'une parcelle, dans [0, 1] : 0 ≈ à peine semée, 1 = mûre. Une parcelle
 * VIDE (jamais semée) rend -1 (« rien à montrer »). Purement arithmétique, déterministe.
 */
export function cropStage(plot: Plot, tick: number): number {
  if (plot.plantedAt === undefined) return -1
  return Math.min(1, (tick - plot.plantedAt) / AGRICULTURE.GROW_TICKS)
}

/** Une parcelle est-elle MÛRE (récoltable) ? Pur — le seul juge de « on peut récolter ». */
export function isCropMature(plot: Plot, tick: number): boolean {
  return plot.plantedAt !== undefined && tick - plot.plantedAt >= AGRICULTURE.GROW_TICKS
}
