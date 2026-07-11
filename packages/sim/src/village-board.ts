/**
 * Le tableau du village (spec pnj R5) — la file de tâches générée par seuils.
 *
 * Le village « pense » par son grenier : des cibles de stock (nourriture,
 * bois, fibre) et des structures à réparer produisent des tâches priorisées
 * que les PNJ réclament (et que les joueurs liront bientôt). Des seuils et
 * une file — pas de GOAP.
 */
import { BALANCE, NPC_AI, STRUCTURE_HP, WORLD_EVENTS } from './balance'
import { countOf } from './items'
import type { SimState } from './sim'
import type { Structure, TaskKind, Village } from './village'

/** Les coffres-greniers du village : accès `village`, dans l'ordre des ids (spec R5-R6). */
export function granaries(state: SimState, villageId: number): Structure[] {
  return state.structures.filter(
    (s) => s.type === 'chest' && s.villageId === villageId && s.access === 'village',
  )
}

function granaryStocks(state: SimState, villageId: number): Record<'berries' | 'stew' | 'wood' | 'fiber', number> {
  const stocks = { berries: 0, stew: 0, wood: 0, fiber: 0 }
  for (const chest of granaries(state, villageId)) {
    stocks.berries += countOf(chest.inventory ?? [], 'berries')
    stocks.stew += countOf(chest.inventory ?? [], 'stew')
    stocks.wood += countOf(chest.inventory ?? [], 'wood')
    stocks.fiber += countOf(chest.inventory ?? [], 'fiber')
  }
  return stocks
}

/** Regénère le tableau : tâches voulues par seuils de stock + réparations. */
export function refreshBoard(state: SimState, village: Village): void {
  if (granaries(state, village.id).length === 0) {
    village.tasks = village.tasks.filter((t) => t.claimedBy !== null)
    return
  }
  const stocks = granaryStocks(state, village.id)
  const foodScore = stocks.berries + stocks.stew * 3

  const wanted: Partial<Record<TaskKind, number>> = {
    gather_berries: foodScore < BALANCE.VILLAGE_FOOD_TARGET ? 2 : 0,
    gather_wood: stocks.wood < BALANCE.VILLAGE_WOOD_TARGET ? 1 : 0,
    gather_fiber: stocks.fiber < NPC_AI.VILLAGE_FIBER_TARGET ? 1 : 0,
    cook_stew:
      stocks.stew < BALANCE.VILLAGE_STEW_TARGET && stocks.berries >= NPC_AI.COOK_MIN_BERRIES && stocks.fiber >= NPC_AI.COOK_MIN_FIBER ? 1 : 0,
  }
  const priorities: Record<TaskKind, number> = {
    repair: 4,
    cook_stew: 3,
    gather_berries: 2,
    gather_fiber: 2,
    gather_wood: 1,
  }

  // Réparer (spec événements R2) : une tâche par structure sous le seuil.
  for (const s of state.structures) {
    if (s.villageId !== village.id || s.type === 'fire') continue
    if (s.hp >= STRUCTURE_HP[s.type] * WORLD_EVENTS.REPAIR_TASK_THRESHOLD) continue
    if (!village.tasks.some((t) => t.kind === 'repair' && t.structureId === s.id)) {
      village.tasks.push({
        id: village.nextTaskId,
        kind: 'repair',
        priority: priorities.repair,
        claimedBy: null,
        structureId: s.id,
      })
      village.nextTaskId += 1
    }
  }
  // Purger les réparations dont la structure a disparu ou est remise à neuf.
  village.tasks = village.tasks.filter((t) => {
    if (t.kind !== 'repair') return true
    const s = state.structures.find((st) => st.id === t.structureId)
    return s !== undefined && s.hp < STRUCTURE_HP[s.type]
  })

  for (const kind of Object.keys(wanted) as TaskKind[]) {
    const want = wanted[kind] ?? 0
    const existing = village.tasks.filter((t) => t.kind === kind)
    for (let i = existing.length; i < want; i++) {
      village.tasks.push({ id: village.nextTaskId, kind, priority: priorities[kind], claimedBy: null })
      village.nextTaskId += 1
    }
    // On retire l'excédent NON réclamé (celui qui travaille finit son geste).
    let excess = existing.length - want
    if (excess > 0) {
      village.tasks = village.tasks.filter((t) => {
        if (t.kind === kind && t.claimedBy === null && excess > 0) {
          excess -= 1
          return false
        }
        return true
      })
    }
  }
}
