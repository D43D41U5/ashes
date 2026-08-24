/**
 * LA CROISSANCE DES VILLAGES PNJ (spec `village-pnj-evolution.md` R6-R7-R9) — la
 * passe de l'AUBE et du CRÉPUSCULE, appelée chaque tick par `step`.
 *
 * Tout s'ancre sur les bords du cycle (le cycle DÉMARRE à l'aube : `cycleTick 0`),
 * jamais sur une date de saison — décision n°2, purement économique. Et rien ici ne
 * tire sur `state.rng` (patron `advanceRefugees`) : les positions sont des
 * emplacements de plan, les décisions des comparaisons de stocks.
 *
 * Trois gestes, villages PNJ seulement (`chiefId === 0`) :
 *   · la PORTE RITUELLE (R7) — les portes s'ouvrent à l'aube, se ferment au
 *     crépuscule (`byEntityId: 0` : c'est le village qui agit). Dérogation SCOPÉE
 *     à « une porte ne bouge jamais seule » (R26) : chez les joueurs, rien ne bouge.
 *   · la MONTÉE DE PALIER (R6) — le grenier porte la barre → `buildTier` monte.
 *   · le COLON (R9) — la prospérité attire : nourriture ≥ barre et un lit de libre
 *     sous le plafond du palier → un habitant de plus, qui arrive avec son barda
 *     (sa paillasse se pose au premier emplacement de logis libre).
 */
import { VILLAGE_GROWTH } from './balance'
import { emitEvent } from './events'
import { spawnNpcsAround } from './npc'
import type { SimState } from './sim'
import { estCrepuscule, TICKS_PER_CYCLE } from './time'
import { addStructure } from './village'
import { buildTierOf, foodScoreOf, freeBedSpot, granaryStocks } from './village-plan'

export function advanceVillageGrowth(state: SimState): void {
  // L'AUBE DE LA CRÉATION NE COMPTE PAS : à `cycleOffset` nul, le tick 0 EST une
  // aube — et un monde qui naît enverrait un colon à l'instant zéro dans tout
  // village garni (mesuré : c'est arrivé aux tests). La prospérité attire à l'aube
  // qui SUIT une journée vécue, jamais au premier instant du monde.
  if (state.tick === 0) return
  const cycleTick = (state.tick + state.cycleOffset) % TICKS_PER_CYCLE
  const dawn = cycleTick === 0
  const dusk = estCrepuscule(state, state.tick)
  if (!dawn && !dusk) return

  for (const village of state.villages) {
    if (village.chiefId !== 0) continue

    // ── La porte rituelle (R7) : TOUTES les portes du village, logis compris. ──
    for (const s of state.structures) {
      if (s.type !== 'door' || s.villageId !== village.id) continue
      const wasOpen = s.open === true
      if (dawn && !wasOpen) {
        s.open = true
        emitEvent(state, { type: 'door_toggled', tick: state.tick, structureId: s.id, open: true, byEntityId: 0 })
      } else if (dusk && wasOpen) {
        delete s.open // `undefined` EST « close » (village.ts) : le snapshot reste léger
        emitEvent(state, { type: 'door_toggled', tick: state.tick, structureId: s.id, open: false, byEntityId: 0 })
      }
    }
    if (!dawn) continue

    // ── La montée de palier (R6) : le grenier porte la barre → le bâti suit. ──
    const stocks = granaryStocks(state, village.id)
    const food = foodScoreOf(stocks)
    const tier = buildTierOf(village)
    const bar = VILLAGE_GROWTH.STAGE_BARS[tier - 1]
    if (bar !== undefined && food >= bar.food && stocks.wood >= (bar.wood ?? 0) && stocks.stone >= (bar.stone ?? 0)) {
      village.buildTier = tier + 1
      emitEvent(state, { type: 'village_stage_up', tick: state.tick, villageId: village.id, stage: tier + 1 })
    }

    // ── La prospérité attire (R9) : un colon à l'aube, plafonné par le palier. ──
    const cap = VILLAGE_GROWTH.POP_CAP[buildTierOf(village) - 1] ?? VILLAGE_GROWTH.POP_CAP[0]!
    const alive = state.entities.filter((e) => village.memberIds.includes(e.id) && e.hp > 0).length
    if (food < VILLAGE_GROWTH.ATTRACT_FOOD || alive >= cap) continue
    const bed = freeBedSpot(state, village)
    if (bed === null) continue // plus un emplacement de logis : le village est plein
    const before = state.npcs.length
    spawnNpcsAround(state, village, 1)
    const settler = state.npcs[state.npcs.length - 1]
    if (state.npcs.length === before || !settler) continue // l'anneau du Feu était bloqué
    // Le colon arrive AVEC son barda : sa paillasse est à lui, pas au grenier.
    addStructure(state, 'paillasse', bed.tx, bed.ty, village.id, 0)
    emitEvent(state, { type: 'settler_arrived', tick: state.tick, villageId: village.id, entityId: settler.entityId })
  }
}
