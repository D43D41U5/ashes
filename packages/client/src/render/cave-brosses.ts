/**
 * ═══ LES BROSSES DE LA CAVE — ce que le voile de cave et le champ de la GI PARTAGENT ═══
 *
 * Le voile de cave (`scenes/world/cave-veil.ts`) peint sa nuit à l'écran : un NOIR opaque, ouvert
 * autour du joueur par le PRÈS et le SOUFFLE, et percé par les lumières. Depuis la bascule
 * (spec `lumiere-globale.md`, LG-R3 et LG-R20), c'est le champ de la GI qui compose sous la roche :
 * il peint le MÊME noir, le même près et le même souffle dans sa propre texture (`gi-mn`, au grain
 * du champ — un texel par cellule de brosse, ce qui est déjà la résolution de ces brosses), et les
 * lumières — le jour d'une gueule, la torche, le bivouac — deviennent des émetteurs du champ, qui
 * apprennent l'ombre de la roche. Les deux lecteurs prennent leurs brosses ICI : une loi, deux lecteurs.
 *
 * ⚠ **LE GRAIN EST CELUI DE L'ART : 4 px monde, NEAREST, jamais lissé.** Chaque brosse est un canvas
 * d'une cellule par texel de 4 px. À l'écran elle s'affiche à `4 × zoom` pixels par cellule ; dans
 * `gi-mn`, à un pixel par cellule.
 */
import Phaser from 'phaser'
import { TEMPERATURE } from '@ashes/sim'
import { TILE_PX } from './framing'
import { HOLE_ERASE_PEAK, HOLE_RADIUS_TILES } from './lighting'
import { TORCHE_HOLE_TILES } from './torche'

/**
 * Le NOIR d'une cave : bleu-nuit, pas noir pur — multiplicateur (0,11 · 0,12 · 0,16) au plus
 * sombre. Un noir absolu ferait un TROU dans l'image (la leçon du socle, encore) ; celui-ci laisse
 * deviner la matière, ce qui est très exactement ce qu'on veut : *une forme, pas un contenu*.
 */
export const NOIR = 0x0b0e18
export const NOIR_ALPHA = 0.62
/** Un texel de lumière : 4 px monde, le grain de tous les halos du jeu. */
export const GRAIN_PX = 4

/** Le jour entre de `CIEL_PENETRATION` tuiles ; la brosse va une tuile plus loin pour que sa chute
 *  linéaire atteigne 0 exactement là où la loi le dit (`1 − d/(P+1)`). */
export const JOUR_TUILES = TEMPERATURE.CIEL_PENETRATION + 1
/** La portée d'une torche SOUS TERRE. Plus courte que dehors (`TORCHE_HOLE_TILES` = 4) : il n'y a
 *  pas de ciel pour l'aider, et c'est ce qui fait de la torche un outil et de la cave un lieu. */
export const TORCHE_CAVE_TUILES = 6
/** LE FEU DE BIVOUAC sous la roche : la clairière d'un Feu dans la nuit (`HOLE_RADIUS_TILES`, 6)
 *  ramenée à l'échelle de la cave — celle que la torche y prend déjà (3 pour 4 dehors). Dérivé,
 *  pas posé : la cave n'a pas de règle à elle, elle serre les mêmes lumières. */
export const FEU_CAVE_TUILES = HOLE_RADIUS_TILES * (TORCHE_CAVE_TUILES / TORCHE_HOLE_TILES)
/** Le souffle autour du corps. */
export const SOI_TUILES = 1.25
export const JOUR_PIC = 1
export const TORCHE_PIC = 1
export const SOI_PIC = 0.45
/**
 * LA FORCE AU CHAMP D'UNE FLAMME DE CAVE (LG-R3, LG-R20). Le champ met `HOLE_ERASE_PEAK` au sommet de
 * toute flamme — le trou qu'un Feu creuse dans le voile de NUIT (0,62). Sous la roche, la torche et le
 * bivouac perçaient le voile de cave à `TORCHE_PIC` (1) : leur force au champ est rapportée, pour que
 * le sommet de la lumière reste celui d'aujourd'hui. Le jour d'une gueule n'en a pas besoin : sa loi
 * (`Emetteur.jour`) ne prend pas le pic du feu.
 */
export const FORCE_AU_CHAMP = 1 / HOLE_ERASE_PEAK
/** LE LOIN. Sous un voile uniforme, le sol d'une salle (albédo [109,115,137]) reste 2,3 fois plus
 *  clair que la roche ([47,49,59]) : à dix tuiles de toute lumière on lisait encore le PLAN entier
 *  de la cave, en bleu sur noir (capture du 2026-09-02). Le voile se pose donc OPAQUE (tout tombe
 *  à la couleur du noir, salle comprise) et c'est le PRÈS qui l'ouvre à `NOIR_ALPHA` autour du
 *  joueur : plein jusqu'à `PRES_TUILES`, éteint à `LOIN_TUILES`. Près de soi on DEVINE (la
 *  curiosité), au loin on ne sait pas (l'inquiétude). Les lichens, en ADD au-dessus du voile,
 *  restent les seuls points du vide. (Un disque sombre DESSINÉ, essayé d'abord, laissait le voile
 *  plus clair hors de son rayon : un cercle sur l'écran.) */
export const PRES_KEY = 'fx-cave-pres'
export const PRES_TUILES = 6
export const LOIN_TUILES = 11
/** Les clés des brosses de lumière — les mêmes pour le voile et pour le champ. */
export const JOUR_KEY = 'fx-cave-jour'
export const TORCHE_KEY = 'fx-cave-torche'
export const FEU_KEY = 'fx-cave-feu'
export const SOI_KEY = 'fx-cave-soi'

export type Metrique = 'rond' | 'carre'

/** Une brosse au grain : `side` cellules de côté (impair, le centre au milieu), l'alpha de chacune —
 *  quantifié sur 255 comme le canvas, pour que le voile et le champ lisent LE MÊME nombre. */
export interface CellulesDeBrosse {
  readonly side: number
  readonly alpha: Float32Array
}
const CELLULES = new Map<string, CellulesDeBrosse>()

/** Les cellules d'une brosse de lumière : un disque (ou un carré arrondi) à chute LINÉAIRE. */
export function cellulesDeBrosse(rayonTuiles: number, metrique: Metrique): CellulesDeBrosse {
  const cle = `${metrique}:${rayonTuiles}`
  const memo = CELLULES.get(cle)
  if (memo) return memo
  const cells = Math.round((rayonTuiles * TILE_PX) / GRAIN_PX)
  const side = cells * 2 + 1
  const alpha = new Float32Array(side * side)
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const dx = i - cells
      const dy = j - cells
      const euclide = Math.sqrt(dx * dx + dy * dy)
      // Le carré arrondi : la moyenne de Chebyshev (ce que la loi balaie) et d'Euclide (ce
      // que l'œil accepte comme une lumière). Un carré franc se lirait comme une dalle.
      const d = metrique === 'carre' ? 0.5 * Math.max(Math.abs(dx), Math.abs(dy)) + 0.5 * euclide : euclide
      alpha[j * side + i] = Math.round(Math.max(0, 1 - d / cells) * 255) / 255
    }
  }
  const c = { side, alpha }
  CELLULES.set(cle, c)
  return c
}

/** Les cellules du près : plein jusqu'à `PRES_TUILES`, éteint à `LOIN_TUILES`, chute quadratique. */
export function cellulesDuPres(): CellulesDeBrosse {
  const memo = CELLULES.get('pres')
  if (memo) return memo
  const cells = Math.round((LOIN_TUILES * TILE_PX) / GRAIN_PX)
  const pres = (PRES_TUILES * TILE_PX) / GRAIN_PX
  const side = cells * 2 + 1
  const alpha = new Float32Array(side * side)
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const dx = i - cells
      const dy = j - cells
      const d = Math.sqrt(dx * dx + dy * dy)
      const t = Math.max(0, Math.min(1, (d - pres) / (cells - pres)))
      alpha[j * side + i] = Math.round((1 - t * t) * 255) / 255
    }
  }
  const c = { side, alpha }
  CELLULES.set('pres', c)
  return c
}

/** Un canvas blanc dont l'alpha est celui des cellules, NEAREST — la brosse telle que le voile l'efface. */
function canvasDeBrosse(scene: Phaser.Scene, key: string, c: CellulesDeBrosse): void {
  if (scene.textures.exists(key)) return
  const tex = scene.textures.createCanvas(key, c.side, c.side)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(c.side, c.side)
  for (let k = 0; k < c.side * c.side; k++) {
    img.data[k * 4] = 255
    img.data[k * 4 + 1] = 255
    img.data[k * 4 + 2] = 255
    img.data[k * 4 + 3] = Math.round(c.alpha[k]! * 255)
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** La luminance relative d'une teinte plate (Rec. 601), dans [0, 1]. */
export function luminance(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255
  const g = ((rgb >> 8) & 0xff) / 255
  const b = (rgb & 0xff) / 255
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Fabrique une brosse d'effacement : un disque (ou un carré arrondi) à chute LINÉAIRE, blanc,
 *  une cellule par texel, NEAREST. La taille monde vient de `setDisplaySize` à chaque usage. */
export function brosse(scene: Phaser.Scene, key: string, rayonTuiles: number, metrique: Metrique): { key: string; side: number } {
  const c = cellulesDeBrosse(rayonTuiles, metrique)
  canvasDeBrosse(scene, key, c)
  return { key, side: c.side }
}

/** Le près : une brosse blanche pleine jusqu'à `PRES_TUILES`, éteinte à `LOIN_TUILES` — chute
 *  quadratique, au grain des halos. Elle EFFACE le voile opaque jusqu'à `NOIR_ALPHA`. */
export function ensurePres(scene: Phaser.Scene): number {
  const c = cellulesDuPres()
  canvasDeBrosse(scene, PRES_KEY, c)
  return c.side
}

/** LA GOMME : un texel blanc opaque, étiré à la bande qu'on ouvre. Elle n'est jamais DESSINÉE —
 *  elle ne sert qu'à `erase`, où seule sa couverture compte. */
export const GOMME_KEY = 'fx-cave-gomme'
export function ensureGomme(scene: Phaser.Scene): void {
  if (scene.textures.exists(GOMME_KEY)) return
  const tex = scene.textures.createCanvas(GOMME_KEY, 1, 1)
  if (!tex) return
  const ctx = tex.getContext()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1, 1)
  tex.refresh()
}
