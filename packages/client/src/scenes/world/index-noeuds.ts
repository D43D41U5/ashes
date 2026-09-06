/**
 * ═══ L'INDEX TUILE→NŒUD DU CLIENT — extrait de `SnapshotView` pour être GARDÉ ═══
 *
 * `SnapshotView` tenait déjà cet index pour DESSINER les nœuds. Depuis qu'il sert aussi la
 * VISÉE (`aimAt`) et la RÈGLE DE POSE (le miroir de `poseLibre` dans `WorldScene`), il ne
 * décide plus seulement de ce qu'on voit : il décide de ce qu'un clic fait. Il vaut donc
 * d'être éprouvé — et un index qui vit dans une classe Phaser ne s'éprouve pas.
 *
 * ⚠ PREMIER GAGNANT, comme l'index de /sim (`economy.ts` : « ≤ 1 nœud par tuile, premier
 *   gagnant »). `new Map(entrées)` gardait le DERNIER — l'invariant dit qu'un seul nœud occupe
 *   une tuile, donc les deux coïncident aujourd'hui ; mais un départage qui diffère entre le
 *   client et la sim se paie en clic qui ne fait rien, et c'est le genre d'écart qu'on ne
 *   retrouve jamais. Autant qu'il n'existe pas.
 */
import type { ResourceNode } from '@ashes/sim'

/** > toute coordonnée de tuile (le monde de production fait 1 581 × 2 372). */
export const NODE_TILE_STRIDE = 1_000_000
/** Le second MONDE d'une tuile : sous la roche (spec `grottes.md` G-R7). > toute clé de surface. */
const SOUS_ROCHE = NODE_TILE_STRIDE * NODE_TILE_STRIDE

/** Un nœud SOUS LA ROCHE : semé dans une salle (niveau négatif, G-R1). Tout le reste — le sol, une
 *  terrasse, un chapeau de mesa — est « la surface », le monde d'avant. */
export const sousLaRoche = (n: { etage?: number | undefined }): boolean => (n.etage ?? 0) < 0

/** ⚠ UNE TUILE PORTE JUSQU'À DEUX NŒUDS depuis les grottes de terrasse (G-R7) : celui de la salle
 *  et, LIFT rangées plus haut, celui de la terrasse qui la coiffe — la sim les distingue par l'étage
 *  (`cleDeNoeud`), l'index du client par le monde. Sans ce bit, le premier gagnait et l'autre
 *  n'existait ni au dessin ni au clic. */
export const cleDeTuile = (tx: number, ty: number, sousRoche = false): number =>
  tx * NODE_TILE_STRIDE + ty + (sousRoche ? SOUS_ROCHE : 0)

/** L'index, bâti une fois. Il se PATCHE ensuite en O(1) (naissance, dérive, mort d'un nœud) —
 *  voir `SnapshotView.applyNodeDeltas` : on ne le rebâtit qu'à la liste complète. */
export function indexerParTuile(nodes: readonly ResourceNode[]): Map<number, ResourceNode> {
  const idx = new Map<number, ResourceNode>()
  for (const n of nodes) {
    const cle = cleDeTuile(n.tx, n.ty, sousLaRoche(n))
    if (!idx.has(cle)) idx.set(cle, n)
  }
  return idx
}

/**
 * LE NŒUD QU'ON VOIT — ET QU'ON VISE — SUR UNE TUILE, selon le monde où le regard se tient.
 *
 * Sous la roche, la salle prend l'écran (`EtageLayer.souterrain`) : sur ses tuiles, seul le nœud
 * de la salle compte, celui de la terrasse au-dessus est sous son plancher ; hors de la salle,
 * par la gueule, on voit la surface. À la surface, la salle n'existe pas — on ne voit ni ne vise
 * ce qu'un plancher de roche recouvre.
 */
export function noeudVu(idx: ReadonlyMap<number, ResourceNode>, tx: number, ty: number, sousRoche: boolean): ResourceNode | undefined {
  return (sousRoche ? idx.get(cleDeTuile(tx, ty, true)) : undefined) ?? idx.get(cleDeTuile(tx, ty))
}
