/**
 * Le peuplement du monde — villages 100 % PNJ (spec pnj R10).
 *
 * L'outil du mode Veillée, des tests et du monde-gen : il fonde un village
 * complet (Feu, grenier approvisionné, maisons, villageois armés) par les
 * mêmes briques que le jeu (createVillage, addStructure, spawnNpcsAround) —
 * son seul privilège de monde-gen est de faire place nette dans les nœuds.
 */
import { addItems } from './items'
import { RING_OFFSETS, spawnNpcsAround } from './npc'
import type { SimState } from './sim'
import { addStructure, createVillage, type Village } from './village'

/**
 * Crée un village 100 % PNJ complet (spec R10) : Feu, grenier approvisionné,
 * maisons et villageois. L'outil du mode Veillée, des tests et du peuplement.
 */
export function foundNpcVillage(
  state: SimState,
  tx: number,
  ty: number,
  count: number,
  disposition: 'foyer' | 'meute' | 'neutre' = 'neutre',
): Village {
  // Le monde-gen a le droit de faire place nette.
  const reserved = [[0, 0], [0, -2], ...RING_OFFSETS.slice(0, count + 2)].map(([dx, dy]) => [tx + dx, ty + dy])
  const houseSpots = ([[-3, 0], [3, 0], [-3, 2], [3, 2], [0, 3], [0, -3]] as const).slice(0, count)
  reserved.push(...houseSpots.map(([dx, dy]) => [tx + dx, ty + dy]))
  state.nodes = state.nodes.filter((n) => !reserved.some(([rx, ry]) => n.tx === rx && n.ty === ry))

  const village = createVillage(state, { chiefId: 0, tx, ty, npcsArrived: true }) // on peuple nous-mêmes
  addStructure(state, 'fire', tx, ty, village.id, 0)
  // Le grenier d'un village PNJ est ouvert aux siens (accès `village`, pas le
  // défaut `private` du coffre) et naît approvisionné.
  const chest = addStructure(state, 'chest', tx, ty - 2, village.id, 0, 'village')
  addItems(chest.inventory!, { berries: 10, wood: 10, fiber: 2 })
  for (const [dx, dy] of houseSpots) addStructure(state, 'house', tx + dx, ty + dy, village.id, 0)
  spawnNpcsAround(state, village, count)
  // Un village PNJ naît armé (spec combat R13) et avec son caractère
  // ensemencé (spec alignement R12) — l'archétype ÉMERGE ensuite des actes.
  const seedWarmth = disposition === 'foyer' ? 60 : disposition === 'meute' ? -60 : 0
  for (const npc of state.npcs) {
    if (npc.villageId !== village.id) continue
    const entity = state.entities.find((e) => e.id === npc.entityId)
    if (entity) {
      addItems(entity.inventory, { spear: 1 })
      entity.warmth = seedWarmth
      // 60 : assez d'inertie pour que le caractère survive à la décroissance
      // (DECAY_PER_DAY) le temps que les actes (dons, raids) prennent le relais.
      entity.engagement = disposition === 'neutre' ? 0 : 60
    }
  }
  return village
}
