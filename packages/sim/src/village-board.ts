/**
 * Le tableau du village (spec pnj R5) — la file de tâches générée par seuils.
 *
 * Le village « pense » par son grenier : des cibles de stock (nourriture,
 * bois, fibre) et des structures à réparer produisent des tâches priorisées
 * que les PNJ réclament (et que les joueurs liront bientôt). Des seuils et
 * une file — pas de GOAP.
 *
 * Depuis `village-pnj-evolution` : pour un village PNJ, les cibles S'ÉLÈVENT du
 * coût du chantier en attente et de la barre du palier suivant — MESURÉ (sonde du
 * 2026-07-31) : les greniers plafonnaient sur CES cibles, pas sur la capacité des
 * bras (bois cloué à 24 dès J1, PNJ oisifs ensuite). Et le tableau porte UNE tâche
 * `build` à la fois : la construction est séquentielle, un chantier après l'autre.
 */
import { BALANCE, FIRE_UPKEEP, NPC_AI, STRUCTURE_HP, VILLAGE_GROWTH, WORLD_EVENTS } from './balance'
import type { ItemBag } from './items'
import type { SimState } from './sim'
import type { TaskKind, Village } from './village'
import {
  buildTierOf,
  desiredOrders,
  foodScoreOf,
  granaries,
  granaryStocks,
  orderCost,
  type GranaryStocks,
} from './village-plan'

// La définition du grenier vit dans `village-plan` (une seule vérité) ; on la
// réexporte pour ses consommateurs historiques (npc.ts, npc-needs.ts).
export { granaries } from './village-plan'

/**
 * Le grenier couvre-t-il ce coût — EN GARDANT ses planchers ? (spec R3, MESURÉ)
 * Le bois garde la réserve du Feu (`BUILD_WOOD_RESERVE`) et le village ne bâtit pas
 * le ventre vide (`BUILD_FOOD_FLOOR`) : sans ces deux gardes, le chantier siphonnait
 * le grenier à zéro et les trois villages du banc mouraient à J5, murs neufs.
 */
function affordable(stocks: GranaryStocks, food: number, cost: ItemBag): boolean {
  return (
    food >= VILLAGE_GROWTH.BUILD_FOOD_FLOOR &&
    stocks.wood >= (cost.wood ?? 0) + VILLAGE_GROWTH.BUILD_WOOD_RESERVE &&
    stocks.stone >= (cost.stone ?? 0) &&
    stocks.cut_stone >= (cost.cut_stone ?? 0) &&
    stocks.fiber >= (cost.fiber ?? 0)
  )
}

/** Regénère le tableau : tâches voulues par seuils de stock + réparations + chantier. */
export function refreshBoard(state: SimState, village: Village): void {
  if (granaries(state, village.id).length === 0) {
    village.tasks = village.tasks.filter((t) => t.claimedBy !== null)
    return
  }
  const stocks = granaryStocks(state, village.id)
  const foodScore = foodScoreOf(stocks)

  // ── LE CHANTIER (villages PNJ seulement) : les ordres manquants du plan. ──
  const isNpcVillage = village.chiefId === 0
  const orders = isNpcVillage ? desiredOrders(state, village) : []
  // LA CIBLE VISE LA PIÈCE SUIVANTE, JAMAIS LE CHANTIER ENTIER — MESURÉ (sonde 12 j) :
  // cibler le coût total faisait thésauriser 144 bois puis tout dépenser en un jour ;
  // la zone était rasée plus vite qu'elle ne repousse et la famine suivait. Au
  // coût-de-la-pièce, le rythme du chantier DEVIENT le rythme de récolte — c'est le
  // « purement économique » de la décision n°2, sans boom ni krach.
  const next = orders[0] !== undefined ? orderCost(orders[0]) : {}
  // La barre du PALIER SUIVANT tire les cibles vers le haut AVANT que le chantier
  // n'existe (c'est le surplus qui ouvre le palier).
  const bar = isNpcVillage ? VILLAGE_GROWTH.STAGE_BARS[buildTierOf(village) - 1] : undefined

  const foodTarget = Math.max(BALANCE.VILLAGE_FOOD_TARGET, bar?.food ?? 0)
  const woodTarget = Math.max(
    BALANCE.VILLAGE_WOOD_TARGET,
    bar?.wood ?? 0,
    (next.wood ?? 0) + (isNpcVillage ? VILLAGE_GROWTH.BUILD_WOOD_RESERVE : 0),
  )
  const stoneTarget = Math.max(next.stone ?? 0, bar?.stone ?? 0)
  const cutStoneTarget = next.cut_stone ?? 0
  // La carrière exige une pioche d'atelier (`minTool: basic`) : tant que le village
  // n'a pas d'établi pour la façonner, la tâche serait un livelock — on ne la veut pas.
  const hasWorkshop = state.structures.some((s) => s.type === 'workshop' && s.villageId === village.id)

  const wanted: Partial<Record<TaskKind, number>> = {
    gather_berries: foodScore < foodTarget ? 2 : 0,
    gather_wood: stocks.wood < woodTarget ? (woodTarget - stocks.wood > VILLAGE_GROWTH.BIG_DEFICIT_WOOD ? 2 : 1) : 0,
    gather_fiber: stocks.fiber < Math.max(NPC_AI.VILLAGE_FIBER_TARGET, next.fiber ?? 0) ? 1 : 0,
    gather_stone: stocks.stone < stoneTarget ? 1 : 0,
    gather_cut_stone: hasWorkshop && stocks.cut_stone < cutStoneTarget ? 1 : 0,
    cook_stew:
      stocks.stew < BALANCE.VILLAGE_STEW_TARGET && stocks.berries >= NPC_AI.COOK_MIN_BERRIES && stocks.fiber >= NPC_AI.COOK_MIN_FIBER ? 1 : 0,
  }
  const priorities: Record<TaskKind, number> = {
    // Nourrir le Feu prime sur tout : sans combustible, le village finit en ruine (R16).
    feed_fire: 5,
    repair: 4,
    build: 3, //  bâtir avant de cuisiner, après réparer : le chantier attend, pas les murs percés
    cook_stew: 3,
    gather_berries: 2,
    gather_fiber: 2,
    gather_wood: 1,
    gather_stone: 1,
    gather_cut_stone: 1,
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

  // ── LA TÂCHE DE CHANTIER (spec village-pnj-evolution R3) : UNE à la fois, À LA
  // CADENCE (`BUILD_PACE_TICKS`, MESURÉ — sans elle le hameau montait en une matinée
  // et rasait la zone). L'ordre en tête du plan, si le grenier paie son coût EN
  // GARDANT ses planchers. Un ordre non réclamé qui n'est plus la tête (la pièce est
  // apparue, le plan a bougé) est purgé — celui qu'un PNJ exécute finit son geste.
  const first = orders[0]
  const firstKey = first === undefined ? '' : JSON.stringify(first)
  village.tasks = village.tasks.filter(
    (t) => t.kind !== 'build' || t.claimedBy !== null || JSON.stringify(t.build) === firstKey,
  )
  const paceOpen = state.tick % VILLAGE_GROWTH.BUILD_PACE_TICKS < BALANCE.BOARD_REFRESH_TICKS
  if (first !== undefined && paceOpen && affordable(stocks, foodScore, orderCost(first)) && !village.tasks.some((t) => t.kind === 'build')) {
    village.tasks.push({
      id: village.nextTaskId,
      kind: 'build',
      priority: priorities.build,
      claimedBy: null,
      build: first,
    })
    village.nextTaskId += 1
  }

  // NOURRIR LE FEU (spec construction R16, la tâche communautaire zéro) : une tâche
  // unique tant que le combustible passe sous le seuil. Purgée (si non réclamée) dès
  // que le Feu est réapprovisionné — celui qui nourrit finit son geste.
  const needsFuel = village.fuel < FIRE_UPKEEP.TASK_THRESHOLD
  const hasFeedTask = village.tasks.some((t) => t.kind === 'feed_fire')
  if (needsFuel && !hasFeedTask) {
    village.tasks.push({ id: village.nextTaskId, kind: 'feed_fire', priority: priorities.feed_fire, claimedBy: null })
    village.nextTaskId += 1
  } else if (!needsFuel) {
    village.tasks = village.tasks.filter((t) => !(t.kind === 'feed_fire' && t.claimedBy === null))
  }

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
