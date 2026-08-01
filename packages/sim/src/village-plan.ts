/**
 * LE PLAN DIRECTEUR DES VILLAGES PNJ (spec `village-pnj-evolution.md`).
 *
 * Fonction PURE de (Feu, palier de bâti, paillasses posées) → les pièces que le
 * village VEUT. Le tableau du village en dérive ses tâches `build` ; les PNJ les
 * exécutent par le pipeline joueur. Trois principes :
 *
 *   · ADDITIF — on ne démolit jamais l'existant : ce qui manque devient un ordre,
 *     ce qui est là est acquis. Une pièce infaisable (falaise, eau, tuile prise
 *     par autre chose) est SAUTÉE, comme `poi-batis` : on ne bâtit pas dans une
 *     falaise, et un mur troué par le terrain est un fait de monde, pas un bug.
 *   · LE LOGIS SUIT LA PAILLASSE — le campement (palier 1) pose une paillasse par
 *     habitant aux emplacements des futurs logis ; le hameau (palier 2) bâtit le
 *     logis AUTOUR d'elle. Le lit du colon devient sa chambre.
 *   · MÊME GRAMMAIRE QUE `poi-batis` — murs d'arêtes dérivés du contour, posés sur
 *     la tuile EXTÉRIEURE avec le bit qui regarde la région (la découpe de façade
 *     du client lit cette convention).
 *
 * Déterministe : aucun tirage, que de la géométrie sur l'état.
 */
import { COMPONENTS, STRUCTURE_COSTS, VILLAGE_GROWTH, WALL_TIERS, type ComponentType } from './balance'
import { edgeBarrierAt, fullTileAt, terrainConstructible } from './construction'
import { countOf, type Inventory, type ItemBag, type StructureType } from './items'
import { terrainAt } from './map'
import type { SimState } from './sim'
import { floorAt, type BuildOrder, type Structure, type Village } from './village'

/** Le palier de bâti effectif (absent sur les parties sauvées d'avant = 1). */
export function buildTierOf(village: Village): number {
  return village.buildTier ?? 1
}

/** Les coffres-greniers du village : accès `village`, dans l'ordre des ids (spec pnj R5-R6).
 *  LA définition vit ici ; `village-board` la réexporte pour ses consommateurs historiques. */
export function granaries(state: SimState, villageId: number): Structure[] {
  return state.structures.filter(
    (s) => s.type === 'chest' && s.villageId === villageId && s.access === 'village',
  )
}

export interface GranaryStocks {
  berries: number
  stew: number
  wood: number
  fiber: number
  stone: number
  cut_stone: number
}

export function granaryStocks(state: SimState, villageId: number): GranaryStocks {
  const stocks: GranaryStocks = { berries: 0, stew: 0, wood: 0, fiber: 0, stone: 0, cut_stone: 0 }
  for (const chest of granaries(state, villageId)) {
    const inv: Inventory = chest.inventory ?? []
    stocks.berries += countOf(inv, 'berries')
    stocks.stew += countOf(inv, 'stew')
    stocks.wood += countOf(inv, 'wood')
    stocks.fiber += countOf(inv, 'fiber')
    stocks.stone += countOf(inv, 'stone')
    stocks.cut_stone += countOf(inv, 'cut_stone')
  }
  return stocks
}

/** Le score nourriture du tableau (spec pnj R5) : baies + 3×ragoût. */
export function foodScoreOf(stocks: GranaryStocks): number {
  return stocks.berries + stocks.stew * 3
}

// ─── La géométrie du village (offsets depuis le Feu) ──────────────────────
//
// Tout tient dans le carré du Feu palier 1 (rayon 10) : logis à ±4, enceinte en
// anneau 7. Les bandes de murs des logis montent à 6 — l'anneau de l'enceinte ne
// les touche jamais. Le coffre-grenier vit en (0,−2) depuis toujours (worldgen).

/** Les emplacements de logis (centre du 3×3), dans l'ordre d'installation. */
export const HUT_SPOTS: readonly (readonly [number, number])[] = [
  [-4, 0],
  [4, 0],
  [0, 4],
  [0, -4],
  [-4, -4],
  [4, -4],
  [-4, 4],
  [4, 4],
]

// PAS DE MOBILIER AU CAMPEMENT — et c'est mesuré, pas esthétique : un tonneau et une
// étagère flanquant le grenier faisaient COUVERTURE dans la mêlée (repro seed 15 :
// la horde de 10 qui CASSAIT un village de 2 ne le cassait plus — 84 PV au lieu d'un
// mort). Le mobilier-couverture est un choix de design à prendre exprès, pas un effet
// de bord du décor. Le palier 1 se lit déjà : un Feu, un coffre, des couchages.

/** Les stations du bourg (palier 3) — sans chaîne du fer (spec, hors périmètre). */
const STATION_SPOTS: readonly (readonly [number, number, ComponentType])[] = [
  [2, 1, 'workshop'],
  [-2, 1, 'furnace'],
  [2, -1, 'silo'],
]

// Bits d'arête (village.ts) : N=1, E=2, S=4, O=8. La tuile EXTÉRIEURE porte le
// bit qui REGARDE la région : dehors au nord de la région → le mur regarde au sud.
const DIRS: readonly (readonly [number, number, number])[] = [
  [0, -1, 4], // dehors au NORD → bit S
  [1, 0, 8], //  dehors à l'EST → bit O
  [0, 1, 1], //  dehors au SUD → bit N
  [-1, 0, 2], // dehors à l'OUEST → bit E
]

/**
 * Les arêtes du contour d'une région convexe : pour chaque tuile de la région et
 * chaque voisin orthogonal HORS région, l'adresse extérieure `[tx, ty, bit]`.
 * Parcours ligne à ligne — l'ordre EST l'ordre de construction (déterminisme).
 */
function contourEdges(
  inRegion: (dx: number, dy: number) => boolean,
  minD: number,
  maxD: number,
): [number, number, number][] {
  const edges: [number, number, number][] = []
  for (let dy = minD; dy <= maxD; dy++) {
    for (let dx = minD; dx <= maxD; dx++) {
      if (!inRegion(dx, dy)) continue
      for (const [ox, oy, bit] of DIRS) {
        if (inRegion(dx + ox, dy + oy)) continue
        edges.push([dx + ox, dy + oy, bit])
      }
    }
  }
  return edges
}

/** Le coût d'un ordre de construction — ce que le grenier doit porter. */
export function orderCost(order: BuildOrder): ItemBag {
  if (order.action === 'pose') {
    if (order.structure === 'wall' || order.structure === 'door') {
      return WALL_TIERS[order.material ?? 'wood'][order.structure].cost
    }
    return STRUCTURE_COSTS[order.structure]
  }
  if (order.action === 'place') return COMPONENTS[order.component].cost
  return WALL_TIERS.stone.upgrade // upgrade : bois → pierre (la seule montée du plan)
}

/**
 * LES ORDRES MANQUANTS, dans l'ordre du chantier — le cœur du plan directeur.
 *
 * Palier ≥ 2 : un logis 3×3 autour de chaque paillasse posée (sol, murs de bois
 * en arêtes, porte au sud), puis l'enceinte (anneau de bois percé d'une porte
 * charretière de 2 arêtes au sud). Palier 3 : les stations, puis la pierre de
 * l'enceinte. Chaque ordre rendu est FAISABLE (terrain, occupation) et ABSENT.
 */
export function desiredOrders(state: SimState, village: Village): BuildOrder[] {
  const tier = buildTierOf(village)
  if (village.chiefId !== 0 || tier < 2) return []
  const orders: BuildOrder[] = []
  const map = state.map
  const fx = village.fireTx
  const fy = village.fireTy

  const onMap = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < map.width && ty < map.height
  const poseFeasible = (tx: number, ty: number, type: StructureType): boolean =>
    onMap(tx, ty) && terrainConstructible(terrainAt(map, tx, ty), type)

  const wantEdge = (tx: number, ty: number, bit: number, structure: 'wall' | 'door'): void => {
    if (!poseFeasible(tx, ty, structure)) return
    if (edgeBarrierAt(state.structures, tx, ty, bit)) return // déjà fermée (par nous ou un autre)
    orders.push({ action: 'pose', structure, tx, ty, edges: bit, material: 'wood' })
  }
  const wantFloor = (tx: number, ty: number): void => {
    if (!poseFeasible(tx, ty, 'floor')) return
    if (floorAt(state.structures, tx, ty)) return
    orders.push({ action: 'pose', structure: 'floor', tx, ty })
  }

  // ── Les logis : autour de chaque paillasse posée (le lit devient une chambre). ──
  for (const [hx, hy] of HUT_SPOTS) {
    const cx = fx + hx
    const cy = fy + hy
    const bed = state.structures.find((s) => s.type === 'paillasse' && s.tx === cx && s.ty === cy)
    if (!bed) continue
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) wantFloor(cx + dx, cy + dy)
    const hut = (dx: number, dy: number): boolean => Math.abs(dx) <= 1 && Math.abs(dy) <= 1
    for (const [ex, ey, bit] of contourEdges(hut, -1, 1)) {
      // La porte du logis : l'arête sud du milieu. Une vraie porte — le PNJ ouvre la
      // sienne, la horde doit la casser, et le rituel de l'aube l'ouvre au monde.
      const isDoor = ex === 0 && ey === 2
      wantEdge(cx + ex, cy + ey, bit, isDoor ? 'door' : 'wall')
    }
  }

  // ── L'enceinte : l'anneau dérivé du disque, percé de la porte charretière. ──
  const r = VILLAGE_GROWTH.ENCEINTE_RADIUS
  const disk = (dx: number, dy: number): boolean => Math.max(Math.abs(dx), Math.abs(dy)) <= r
  const gate = (ex: number, ey: number): boolean => ey === r + 1 && (ex === 0 || ex === 1)
  const enceinte = contourEdges(disk, -r, r)
  for (const [ex, ey, bit] of enceinte) {
    if (gate(ex, ey)) continue // les vantaux se posent en dernier : l'anneau d'abord
    wantEdge(fx + ex, fy + ey, bit, 'wall')
  }
  for (const [ex, ey, bit] of enceinte) {
    if (gate(ex, ey)) wantEdge(fx + ex, fy + ey, bit, 'door')
  }

  if (tier < 3) return orders

  // ── Le bourg : les stations (assemblées au Feu, posées), puis la pierre. ──
  for (const [sx, sy, component] of STATION_SPOTS) {
    const tx = fx + sx
    const ty = fy + sy
    if (!poseFeasible(tx, ty, component)) continue
    const occupant = fullTileAt(state.structures, tx, ty)
    if (occupant) continue // à nous (posée) ou pris par autre chose : dans les deux cas, acquis
    if (state.nodes.some((n) => n.tx === tx && n.ty === ty)) continue // un buisson a dérivé là
    orders.push({ action: 'place', component, tx, ty })
  }
  // La pierre de l'enceinte : chaque mur/porte de l'anneau encore en bois.
  for (const [ex, ey] of enceinte) {
    const s = state.structures.find(
      (st) =>
        st.tx === fx + ex && st.ty === fy + ey && (st.type === 'wall' || st.type === 'door') &&
        st.villageId === village.id && st.edges !== undefined,
    )
    if (s && (s.material ?? 'wood') === 'wood') orders.push({ action: 'upgrade', structureId: s.id })
  }
  return orders
}

/** Le premier emplacement de logis SANS paillasse ni occupant — pour le colon qui arrive. */
export function freeBedSpot(state: SimState, village: Village): { tx: number; ty: number } | null {
  for (const [hx, hy] of HUT_SPOTS) {
    const tx = village.fireTx + hx
    const ty = village.fireTy + hy
    if (tx < 0 || ty < 0 || tx >= state.map.width || ty >= state.map.height) continue
    if (!terrainConstructible(terrainAt(state.map, tx, ty), 'paillasse')) continue
    if (fullTileAt(state.structures, tx, ty)) continue
    if (state.nodes.some((n) => n.tx === tx && n.ty === ty)) continue
    return { tx, ty }
  }
  return null
}
