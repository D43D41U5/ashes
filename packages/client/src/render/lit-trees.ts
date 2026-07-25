/**
 * LES ARBRES ÉCLAIRABLES (DA actée, docs/decisions.md 2026-07-20 ; vague A du 25/07).
 *
 * Variantes `_lit` de l'arbre ordinaire ET du GROS BOIS — MÊME forme et MÊME famille de
 * couleur que l'art d'origine (demande d'Alexis), mais ALBÉDO UNIFORME (à plat) : on retire
 * l'ombrage PEINT pour ne pas le cumuler avec la lumière calculée. Tout le relief vient de la
 * carte de NORMALES + des lumières (dynamic-lighting).
 *
 * LE HOUPPIER passe par la recette commune (`normal-map.ts`) : masque lissé 7 passes,
 * facettes de 4 px (cell), gain 3,2 — les cadrans historiques de ce module, conservés à
 * l'identique (le smoke `cubique` en témoigne). LE TRONC reste ANALYTIQUE : un cylindre ne se
 * dérive pas d'une silhouette — la colonne du fût reçoit sa normale de section directement.
 *
 * Le vieux chêne (gros bois) : houppier 40×40 un cran PLUS SOMBRE (il ferme le ciel — son
 * identité), fût de 10 px (2,5× l'ordinaire), cœur clair en bout (il est VIEUX, ça se voit).
 * C'était le SEUL sprite du monde volontairement éteint — l'exception tombe (da-feeling R3).
 */
import type Phaser from 'phaser'
import { enc, FLIP_G, newCanvas, norm3, normalFromCanvas, registerLit as register } from './normal-map'

// Couleurs UNIFORMES, tirées de l'art d'origine (famille inchangée), au niveau « éclairé »
// pour que la lumière SCULPTE vers le bas plutôt que de partir dans le noir.
const TRUNK_BROWN = '#5c4429' // l'arête claire de nd-tree_trunk (le houppier décode son vert inline)
const OLD_CROWN_GREEN = '#1d4a26' // un cran plus sombre que le 2d6b32 ordinaire : il ferme le ciel

/** Albédo UNIFORME d'un houppier : sa silhouette, à plat. */
function crownAlbedo(S: number, opaque: (x: number, y: number) => boolean, rgb: readonly [number, number, number]): HTMLCanvasElement {
  const { c, ctx } = newCanvas(S, S)
  const d = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!opaque(x, y)) continue
      const i = (y * S + x) * 4
      d.data[i] = rgb[0]; d.data[i + 1] = rgb[1]; d.data[i + 2] = rgb[2]; d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

/** LA SILHOUETTE du houppier ordinaire (32×32) — l'union des deux rects blocky d'origine. */
const crownOpaque = (x: number, y: number): boolean =>
  (x >= 4 && x < 28 && y >= 6 && y < 28) || (x >= 6 && x < 26 && y >= 4 && y < 26)

/** Celle du GROS BOIS (40×40) — l'union des deux pavés de BootScene, coins mordus. */
const oldCrownOpaque = (x: number, y: number): boolean =>
  (x >= 4 && x < 36 && y >= 8 && y < 36) || (x >= 6 && x < 34 && y >= 5 && y < 35)

/** Carte de normales d'un TRONC : cylindre analytique sur la colonne du fût. */
function trunkNormal(W: number, H: number, x0: number, x1: number): HTMLCanvasElement {
  const { c, ctx } = newCanvas(W, H)
  const d = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      let dx = 0, dy = 0, dz = 1
      if (x >= x0 && x < x1) {
        const t = ((x - x0 + 0.5) / (x1 - x0)) * 2 - 1
        ;[dx, dy, dz] = norm3(t * 0.9, 0, 0.7)
      }
      d.data[i] = enc(dx)
      d.data[i + 1] = enc(FLIP_G ? -dy : dy)
      d.data[i + 2] = enc(dz)
      d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

/** Albédo UNIFORME du tronc ordinaire : la colonne de `nd-tree_trunk`, à plat. */
function trunkAlbedo(): HTMLCanvasElement {
  const { c, ctx } = newCanvas(16, 22)
  ctx.fillStyle = TRUNK_BROWN
  ctx.fillRect(6, 0, 4, 22)
  return c
}

/** Le fût du GROS BOIS : 10 px de large sur 24, le cœur clair en bout (matériau — il est vieux). */
function oldTrunkAlbedo(): HTMLCanvasElement {
  const { c, ctx } = newCanvas(16, 24)
  ctx.fillStyle = '#543a22'
  ctx.fillRect(3, 0, 10, 24)
  ctx.fillStyle = '#a8865c'
  ctx.fillRect(5, 3, 6, 2)
  return c
}

/** Enregistre les `_lit` des deux arbres : albédo uniforme + normale (houppier commun, tronc analytique). */
export function generateLitTrees(scene: Phaser.Scene): void {
  // L'ORDINAIRE — les cadrans historiques : 7 passes, facettes de 4 px (32/8 cellules), K 3,2.
  const crown = crownAlbedo(32, crownOpaque, [0x2d, 0x6b, 0x32])
  register(scene, 'nd-tree_crown_lit', crown, normalFromCanvas(crown, 7, 3.2, 4))
  register(scene, 'nd-tree_trunk_lit', trunkAlbedo(), trunkNormal(16, 22, 6, 10))
  // LE GROS BOIS — même taille de facette (4 px : on garde la TAILLE, pas le compte de cellules).
  const oldCrown = crownAlbedo(40, oldCrownOpaque, [0x1d, 0x4a, 0x26])
  register(scene, 'nd-old_tree_crown_lit', oldCrown, normalFromCanvas(oldCrown, 7, 3.2, 4))
  register(scene, 'nd-old_tree_trunk_lit', oldTrunkAlbedo(), trunkNormal(16, 24, 3, 13))
}

// (Le vert du gros bois est exporté pour d'éventuels consommateurs de cohérence — la pousse
// du vieux bois, si elle naît un jour, devra le reprendre : aucun pop de couleur à l'âge.)
export const OLD_TREE_CROWN_GREEN = OLD_CROWN_GREEN
