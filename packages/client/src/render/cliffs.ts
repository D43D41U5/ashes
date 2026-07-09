/**
 * Où va une paroi de falaise — math PURE, aucun import Phaser.
 * Le pooling/placement Phaser vit dans scenes/world/cliff-layer.ts.
 *
 * On ne dessine que les décrochements vers le SUD : seule orientation dont la
 * face regarde la caméra (convention Zelda ALTTP). Est, ouest et nord reçoivent
 * une simple ombre cuite dans le sol (render/hillshade.ts : stepShadeAt).
 *
 * Une paroi se rend EXACTEMENT comme un arbre : un sprite plus haut qu'une
 * tuile, ancré par les pieds, trié dans la bande Y unique. L'occlusion « je
 * passe derrière la falaise » sort gratuitement de ySortDepth.
 *
 * TRANCHE 1 : purement visuel. Rien ne bloque. Un acteur qui entre dans la bande
 * de la paroi y est CACHÉ — c'est laid et assumé, cette bande devient solide en
 * tranche 2 (spec §5.3).
 */
import { TIE_CLIFF, TILE_PX, ySortDepth } from './framing'
import type { SampleLevel } from './hillshade'

/** Hauteur à l'écran d'une paroi d'UN palier, en px. Réglage visuel. */
export const STEP_PX = 12
/** Décrochement maximal doté d'un art cuit. Au-delà, la paroi est plafonnée. */
export const MAX_DROP = 6

/** Une face portée par la tuile HAUTE `(tx, ty)`, dont le voisin sud est plus bas. */
export interface CliffFace {
  tx: number
  ty: number
  /** Nombre de paliers de chute vers le sud. Toujours ≥ 1. */
  drop: number
}

export interface CliffPlacement {
  /** position pixel du sprite (origine pieds 0.5/1) */
  px: number
  py: number
  displayW: number
  displayH: number
  /** Y-sort : croît vers le bas */
  depth: number
  /** décrochement PLAFONNÉ — sert de clé de texture (`cliff-${drop}`) */
  drop: number
}

/** Cette tuile porte-t-elle une face sud ? `null` sinon (bord de carte compris). */
export function cliffAt(tx: number, ty: number, sample: SampleLevel): CliffFace | null {
  const here = sample(tx, ty)
  const south = sample(tx, ty + 1)
  if (here < 0 || south < 0 || here <= south) return null
  return { tx, ty, drop: here - south }
}

/** Hauteur à l'écran d'une paroi de `drop` paliers, plafonnée à MAX_DROP. */
export function faceHeightPx(drop: number): number {
  return (drop < MAX_DROP ? drop : MAX_DROP) * STEP_PX
}

/**
 * La paroi PEND depuis l'arête : bord haut à la frontière `ty+1`, pieds en
 * dessous, sur le sol bas. D'où : l'acteur au pied (plus au sud) passe devant,
 * l'acteur sur le plateau passe derrière.
 */
export function cliffPlacement(face: CliffFace, tilePx: number = TILE_PX): CliffPlacement {
  const h = faceHeightPx(face.drop)
  const py = (face.ty + 1) * tilePx + h
  return {
    px: (face.tx + 0.5) * tilePx,
    py,
    displayW: tilePx,
    displayH: h,
    depth: ySortDepth(py / tilePx, tilePx, TIE_CLIFF),
    drop: face.drop < MAX_DROP ? face.drop : MAX_DROP,
  }
}
