/**
 * LE WARP — PLAT. La carte n'a plus de hauteur (pivot RimWorld) : il n'y a plus rien à soulever ni
 * à dé-cisailler.
 *
 * Ce module portait toute la verticalité du rendu : `lift` soulevait chaque tuile de
 * `palier × STEP_PX`, et `unproject` inversait ce cisaillement pour le picking. Les deux sont
 * désormais l'IDENTITÉ. On garde l'objet `Warp` (lift ≡ 0, unproject ≡ identité) plutôt que de le
 * supprimer : une quinzaine de couches l'appellent encore, et un no-op les laisse toutes plates
 * sans les toucher. À retirer complètement dans une passe de simplification ultérieure.
 *
 * Math pure, aucun import Phaser : le smoke test s'appuie sur `unproject` comme source de vérité
 * unique de la conversion écran→monde, et en plat elle est triviale (écran = monde).
 */
export interface Warp {
  /** Décalage écran (px) à soustraire du py plat — toujours 0 : la carte est plate. */
  lift(txf: number, tyf: number): number
  /** Écran plat → monde. Identité : sans hauteur, l'écran EST le monde. */
  unproject(flatPxX: number, flatPxY: number): { x: number; y: number }
}

export function createWarp(): Warp {
  return {
    lift: () => 0,
    unproject: (flatPxX: number, flatPxY: number) => ({ x: flatPxX, y: flatPxY }),
  }
}
