/**
 * Où vont les pièces de paroi — math PURE, aucun import Phaser.
 * Le pooling/placement Phaser vit dans scenes/world/cliff-layer.ts.
 *
 * Le mur se dessine depuis la tuile BASSE, qui regarde ses trois voisins amont.
 * Une bordure de palier est un escalier rasterisé : selon l'orientation locale,
 * la tuile basse a son voisin plus haut au nord (on voit la FACE, qui regarde la
 * caméra), à l'est ou à l'ouest (on voit la paroi par la TRANCHE). Ne dessiner
 * que les faces nord laissait le mur en pointillés dès que le contour partait en
 * diagonale — 37 % des tuiles de bordure seulement (mesuré en jeu, 2026-07-09).
 *
 * Une face se rend EXACTEMENT comme un arbre : un sprite ancré par les pieds,
 * trié dans la bande Y unique. L'occlusion « je passe derrière la falaise » sort
 * gratuitement de ySortDepth.
 *
 * TRANCHE 1 : purement visuel. Rien ne bloque. Un acteur qui entre dans la bande
 * de la paroi y est CACHÉ — c'est laid et assumé, cette bande devient solide en
 * tranche 2 (spec §5.3).
 */
import { TIE_CLIFF, TILE_PX, ySortDepth } from './framing'
import type { SampleLevel } from './hillshade'

/** Hauteur à l'écran d'une face d'UN palier, en px. Réglage visuel. */
export const STEP_PX = 12
/** Largeur du liseré de tranche, en px. Réglage visuel. */
export const SIDE_PX = 5
/** Décrochement maximal doté d'un art cuit. Au-delà, la paroi est plafonnée. */
export const MAX_DROP = 6

/** Quelle pièce du mur : la face qui regarde la caméra, ou la tranche vue de profil. */
export type CliffKind = 'face' | 'side_e' | 'side_w'

/** Une pièce de mur portée par la tuile BASSE `(tx, ty)`. */
export interface CliffPiece {
  tx: number
  ty: number
  kind: CliffKind
  /** Nombre de paliers de dénivelé avec le voisin amont. Toujours ≥ 1. */
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
  /** clé de texture Phaser */
  texture: string
}

const cap = (drop: number): number => (drop < MAX_DROP ? drop : MAX_DROP)

/**
 * Les pièces de mur que porte la tuile BASSE `(tx, ty)` — zéro, une, ou plusieurs
 * (un coin intérieur en porte deux). Hors carte, ou carte sans paliers : aucune.
 */
export function cliffPiecesAt(tx: number, ty: number, sample: SampleLevel): CliffPiece[] {
  const here = sample(tx, ty)
  if (here < 0) return []
  const pieces: CliffPiece[] = []
  const north = sample(tx, ty - 1)
  const east = sample(tx + 1, ty)
  const west = sample(tx - 1, ty)
  if (north > here) pieces.push({ tx, ty, kind: 'face', drop: north - here })
  if (east > here) pieces.push({ tx, ty, kind: 'side_e', drop: east - here })
  if (west > here) pieces.push({ tx, ty, kind: 'side_w', drop: west - here })
  return pieces
}

/** Hauteur à l'écran d'une face de `drop` paliers, plafonnée à MAX_DROP. */
export function faceHeightPx(drop: number): number {
  return cap(drop) * STEP_PX
}

/**
 * La FACE occupe le haut de la tuile basse : bord haut sur la frontière de palier,
 * pieds `faceHeightPx` plus bas. D'où : l'acteur au pied passe devant, l'acteur
 * resté sur le plateau passe derrière.
 *
 * Les TRANCHES courent sur toute la hauteur de la tuile, contre son bord amont —
 * sans quoi le mur se rompt à chaque marche de l'escalier.
 */
export function cliffPlacement(piece: CliffPiece, tilePx: number = TILE_PX): CliffPlacement {
  const d = cap(piece.drop)
  if (piece.kind === 'face') {
    const h = faceHeightPx(piece.drop)
    const py = piece.ty * tilePx + h
    return {
      px: (piece.tx + 0.5) * tilePx,
      py,
      displayW: tilePx,
      displayH: h,
      depth: ySortDepth(py / tilePx, tilePx, TIE_CLIFF),
      texture: `cliff-face-${d}`,
    }
  }
  const east = piece.kind === 'side_e'
  const py = (piece.ty + 1) * tilePx
  return {
    px: east ? (piece.tx + 1) * tilePx - SIDE_PX / 2 : piece.tx * tilePx + SIDE_PX / 2,
    py,
    displayW: SIDE_PX,
    displayH: tilePx,
    depth: ySortDepth(py / tilePx, tilePx, TIE_CLIFF),
    texture: `cliff-side-${d}`,
  }
}
