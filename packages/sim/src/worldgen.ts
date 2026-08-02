/**
 * Le peuplement du monde — villages 100 % PNJ (spec pnj R10, village-pnj-evolution R1).
 *
 * L'outil du mode Veillée, des tests et du monde-gen : il fonde un village
 * complet par les mêmes briques que le jeu (createVillage, addStructure,
 * spawnNpcsAround) — son seul privilège de monde-gen est de faire place nette.
 *
 * Depuis `village-pnj-evolution` : le village naît au PALIER 1, le CAMPEMENT —
 * Feu, grenier approvisionné, une paillasse par habitant (aux emplacements des
 * futurs logis : le lit du colon deviendra sa chambre au palier 2), le mobilier
 * autour du grenier. Plus AUCUNE `house` (le chip d'une tuile qui lisait comme
 * une image posée) : le type survit pour les parties sauvées, plus rien n'en pose.
 */
import { ALIGNMENT, VILLAGE_GROWTH } from './balance'
import { addItems } from './items'
import { RING_OFFSETS, spawnNpcsAround } from './npc'
import type { SimState } from './sim'
import { addStructure, createVillage, type Village } from './village'
import { bedAnchor, HUT_SPOTS } from './village-plan'

/**
 * Crée un village 100 % PNJ complet (spec R10) : Feu, grenier approvisionné,
 * campement et villageois. L'outil du mode Veillée, des tests et du peuplement.
 */
export function foundNpcVillage(
  state: SimState,
  tx: number,
  ty: number,
  count: number,
  disposition: 'foyer' | 'meute' | 'neutre' = 'neutre',
): Village {
  // Le monde-gen a le droit de faire place nette — mais SEULEMENT sous le campement
  // (Feu, grenier, anneau d'accueil, les 8 emplacements de logis, le mobilier) : le
  // chantier du palier 2, lui, n'a pas besoin de terrain vierge — les arêtes et les
  // sols se posent en ignorant les nœuds (spec construction R23), et le plan SAUTE
  // les emplacements pris. Raser tout le disque de l'enceinte affamerait les tests
  // (et les villages) dont les buissons vivent à six tuiles du Feu.
  const reserved = [
    [tx, ty],
    [tx, ty - 2],
    ...RING_OFFSETS.slice(0, count + 2).map(([dx, dy]) => [tx + dx, ty + dy]),
    ...HUT_SPOTS.map((spot) => bedAnchor(tx, ty, spot)),
  ]
  state.nodes = state.nodes.filter((n) => !reserved.some(([rx, ry]) => n.tx === rx && n.ty === ry))

  const village = createVillage(state, { chiefId: 0, tx, ty, npcsArrived: true }) // on peuple nous-mêmes
  addStructure(state, 'fire', tx, ty, village.id, 0)
  // Le grenier d'un village PNJ est ouvert aux siens (accès `village`, pas le
  // défaut `private` du coffre) et naît approvisionné.
  const chest = addStructure(state, 'chest', tx, ty - 2, village.id, 0, 'village')
  addItems(chest.inventory!, VILLAGE_GROWTH.STOCK_INITIAL)
  // LE CAMPEMENT (palier 1) : une paillasse par habitant, sur l'ANCRE des futurs
  // logis. Pas de mobilier : il ferait COUVERTURE dans la mêlée (voir village-plan.ts).
  for (const spot of HUT_SPOTS.slice(0, count)) {
    const [ax, ay] = bedAnchor(tx, ty, spot)
    addStructure(state, 'paillasse', ax, ay, village.id, 0)
  }
  spawnNpcsAround(state, village, count)
  // Un village PNJ naît armé (spec combat R13) et avec son caractère
  // ensemencé (spec alignement R12) — l'archétype ÉMERGE ensuite des actes.
  const seedWarmth = disposition === 'foyer' ? ALIGNMENT.SEED_WARMTH : disposition === 'meute' ? -ALIGNMENT.SEED_WARMTH : 0
  for (const npc of state.npcs) {
    if (npc.villageId !== village.id) continue
    const entity = state.entities.find((e) => e.id === npc.entityId)
    if (entity) {
      addItems(entity.inventory, { spear: 1 })
      entity.warmth = seedWarmth
      entity.engagement = disposition === 'neutre' ? 0 : ALIGNMENT.SEED_ENGAGEMENT
    }
  }
  return village
}
