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

export const cleDeTuile = (tx: number, ty: number): number => tx * NODE_TILE_STRIDE + ty

/** L'index, bâti une fois. Il se PATCHE ensuite en O(1) (naissance, dérive, mort d'un nœud) —
 *  voir `SnapshotView.applyNodeDeltas` : on ne le rebâtit qu'à la liste complète. */
export function indexerParTuile(nodes: readonly ResourceNode[]): Map<number, ResourceNode> {
  const idx = new Map<number, ResourceNode>()
  for (const n of nodes) {
    const cle = cleDeTuile(n.tx, n.ty)
    if (!idx.has(cle)) idx.set(cle, n)
  }
  return idx
}
