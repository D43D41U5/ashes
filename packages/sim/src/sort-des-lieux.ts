/**
 * LE SORT DES LIEUX BÂTIS — la première phrase du récit spatial (spec `stratigraphie.md` S-R17).
 *
 * Deux fermes ruinées ne sont plus le même prop : l'une raconte l'incendie, l'autre l'exode.
 * Le sort n'est PAS tiré — il est DÉRIVÉ de deux champs que la carte possède déjà :
 *
 *     brûlé    la Cendre est passée par là. ⚠ **PLUS AUCUN LIEU NE NAÎT BRÛLÉ depuis le
 *              2026-08-24** : ce verdict se dérivait de `map.cendre` sous une part de l'avancée
 *              finale `cendreMax`, et les deux sont partis avec le front. Le sort reste un type à
 *              trois valeurs — la nouvelle mécanique n'aura qu'à redonner une source au premier.
 *     pillé    une sente passe à portée : ceux qui ont fui ont fouillé ce qui bordait la route
 *     intact   loin du feu, loin des routes — personne n'est revenu, tout y est encore
 *
 * Le joueur apprend ainsi la première règle de lecture du monde : LOIN DES ROUTES = INTACT
 * = RICHE. La récompense d'exploration cesse d'être une loterie — elle s'infère.
 *
 * Pur et positionnel : aucune trigo, aucun PRNG — le sort d'un lieu est une fonction de la
 * carte, recalculable par quiconque la possède (le patron de la Cendre : on ne transmet rien,
 * chacun recalcule).
 */
import { TERRAIN_ROAD } from './balance'
import type { WorldMap } from './map'

export type SortDuLieu = 'brule' | 'pille' | 'intact'

/** Réglage du sort — calibré en REGARDANT une carte, comme les autres blocs du worldgen. */
export const SORT_DES_LIEUX = {
  /** ⚠ SANS LECTEUR depuis le 2026-08-24 (voir l'en-tête) : c'était la part de l'avancée finale
   *  du front sous laquelle un lieu naissait BRÛLÉ. Gardée pour la mécanique qui vient. */
  PART_BRULEE: 0.55,
  /** Le rayon (Chebyshev, en tuiles) où une sente fait d'une ruine une ruine PILLÉE. */
  RAYON_ROUTE: 28,
  /** L'usure d'un bâti selon son sort — multiplicateurs de l'usure écrite au plan, bornés à 1. */
  USURE_BRULE: 0.4,
  USURE_INTACT: 1.5,
  /** Le stock des nœuds de fouille selon le sort — l'isolement porte le COMBIEN, jamais le si. */
  STOCK_PILLE: 0.5, //  les pillards sont passés : il reste quelque chose (plancher à 1)
  STOCK_INTACT: 2, //   personne n'est revenu : tout y est encore
} as const

/**
 * LE SORT D'UN LIEU, dérivé de sa position. L'ordre des verdicts est une hiérarchie de
 * causes : le feu d'abord (il ne laisse rien à piller — plus de source aujourd'hui), la route
 * ensuite, l'oubli enfin.
 * Plus rien ne brûle (le front est retiré) ; une carte sans sente ne pille rien.
 */
export function sortDuLieu(map: WorldMap, zx: number, zy: number, w: number, h: number): SortDuLieu {
  const cx = Math.floor(zx + w / 2)
  const cy = Math.floor(zy + h / 2)

  const r = SORT_DES_LIEUX.RAYON_ROUTE
  const x0 = Math.max(0, cx - r)
  const x1 = Math.min(map.width - 1, cx + r)
  const y0 = Math.max(0, cy - r)
  const y1 = Math.min(map.height - 1, cy + r)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (map.terrain[y * map.width + x] === TERRAIN_ROAD) return 'pille'
    }
  }
  return 'intact'
}

/** L'usure effective d'un bâti : celle du plan, modulée par le sort, jamais au-dessus du neuf. */
export function usureSelonSort(usureDuPlan: number, sort: SortDuLieu): number {
  if (sort === 'brule') return usureDuPlan * SORT_DES_LIEUX.USURE_BRULE
  if (sort === 'intact') return Math.min(1, usureDuPlan * SORT_DES_LIEUX.USURE_INTACT)
  return usureDuPlan
}

/**
 * LE TOPONYME DIT LE SORT — le nom du lieu est sa première ligne de chronique. Seuls les kinds
 * déclarés ici changent de nom ; les autres gardent leur nom de table (une grotte n'a pas de
 * sort : elle n'a rien à brûler).
 */
const NOMS_PAR_SORT: Record<string, Partial<Record<SortDuLieu, string>>> = {
  ferme_ruinee: { brule: 'la Ferme brûlée', pille: 'la Ferme pillée', intact: 'la Ferme muette' },
  cabane: { brule: 'la Cabane brûlée', pille: 'la Cabane pillée' },
  // Les sept lieux bâtis de l'étage 1 (spec lieux-batis). On ne déclare que ce qui a un SENS :
  // l'oratoire de pierre ne brûle pas, l'épave d'avalanche non plus (sa cause est la montagne) ;
  // et « abandonnée », « d'avalanche » disent déjà l'intact — seuls les Ruines gagnent un nom
  // d'oubli, comme la Ferme.
  ruines: { brule: 'les Ruines brûlées', pille: 'les Ruines pillées', intact: 'les Ruines muettes' },
  abri: { brule: "l'Abri brûlé", pille: "l'Abri pillé" },
  mine: { brule: 'la Mine brûlée', pille: 'la Mine pillée' },
  oratoire: { pille: "l'Oratoire pillé" },
  bivouac: { brule: 'le Bivouac brûlé', pille: 'le Bivouac pillé' },
  charrette: { brule: 'la Charrette brûlée', pille: 'la Charrette pillée' },
  epave: { pille: "l'Épave pillée" },
}

export function nomSelonSort(slug: string, nomDeTable: string, sort: SortDuLieu): string {
  return NOMS_PAR_SORT[slug]?.[sort] ?? nomDeTable
}
