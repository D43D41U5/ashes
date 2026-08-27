/**
 * LA FLAQUE VERTE DES LUCIOLES — ce que la nuée jette au sol sous elle.
 *
 * MÊME RECETTE QUE LA FLAQUE DU FEU (`fire-ground-glow.ts`, demande d'Alexis le 2026-08-26 :
 * « une lumière au sol comme pour le feu, sauf que ça c'est vert, étendu mais diffus ») : une
 * texture radiale PIXELLISÉE, un texel par cellule de 4 px monde, NEAREST, additive, posée à
 * plat sous tout ce qui a des pieds — mais AU-DESSUS du voile de nuit, là où celle du Feu passe
 * dessous (`framing.FIREFLY_GROUND_DEPTH` porte le pourquoi, et il est décisif : le Feu creuse
 * le voile, un essaim non). Le sol n'est pas sur la pipeline Light2D — le
 * point light de l'essaim n'atteint que ce qui a une carte de normales (fûts, décor volumique).
 * C'est donc CETTE flaque, et elle seule, qui met la terre au vert.
 *
 * TROIS DIFFÉRENCES AVEC CELLE DU FEU, et elles sont toute la commande :
 *   • ÉTENDUE — `POOL_RADIUS_TILES` 7 contre 3. Un foyer cuit la terre sur deux ou trois
 *     tuiles ; une nuée de lucioles ne cuit rien, elle BAIGNE le sous-bois. Le rayon déborde
 *     largement l'essaim lui-même (3,4 tuiles), sinon la flaque aurait un bord et l'on verrait
 *     un disque posé sur l'herbe.
 *   • DIFFUSE — pas de cœur. La flaque du feu concentre au centre (alpha en smoothstep, couleur
 *     qui vire au clair sur les braises) parce qu'il y a un point chaud à montrer. Ici il n'y en
 *     a pas : l'alpha décroît en (1−t)², une pente molle sans plateau, et la couleur bouge à
 *     peine du centre au bord. Ce qu'on veut, c'est qu'on ne sache pas dire où elle s'arrête.
 *   • VERTE ET PAUVRE EN BLEU — la leçon de la flaque ambre vaut ici à l'identique : en ADD,
 *     c'est le bleu qui tire un sol vers le blanc délavé. Un vert à B bas s'empile en vert de
 *     mousse ; le même vert à B fort donnerait un halo néon menthe.
 */
import Phaser from 'phaser'
import { TILE_PX } from '../../render/framing'

/** Le PIXEL DE LUMIÈRE : 4×4 px monde — la MÊME grille que la flaque du feu et que l'art. */
const LIGHT_PX = 4
/** ÉTENDU (cf. l'en-tête) : la nuée baigne le sous-bois bien au-delà de son propre rayon. */
const POOL_RADIUS_TILES = 7
const POOL_RADIUS_CELLS = (POOL_RADIUS_TILES * TILE_PX) / LIGHT_PX
const TEX_SIDE = POOL_RADIUS_CELLS * 2 + 1

/** Le centre : un vert-jaune de luciole, à peine plus clair que le bord (DIFFUS, pas de cœur). */
const CORE_COLOR: readonly [number, number, number] = [0x9e, 0xd8, 0x50]
/** Le bord : le même vert, plus profond et plus pauvre en bleu — il fond dans le noir du bois. */
const EDGE_COLOR: readonly [number, number, number] = [0x4c, 0x8e, 0x24]

/** Côté d'affichage de la flaque, en px monde. */
export const FIREFLY_POOL_SIZE_PX = TEX_SIDE * LIGHT_PX
/** Gain d'alpha au centre. Doublé le jour même (« 2× + de lumière », Alexis) : 0,34 → 0,68. Il
 *  reste sous celui de la flaque du Feu (0,75) et la pente est bien plus molle, donc l'additif
 *  délave moins qu'un foyer malgré une portée plus du double (7 tuiles contre 3). */
export const FIREFLY_POOL_ALPHA = 0.68

export const FIREFLY_POOL_KEY = 'fx-firefly-ground'

/** Un texel par cellule de 4 px, alpha en (1−t)² — molle et sans plateau. NEAREST pour que ce
 *  soit une grille de carrés francs, jamais un dégradé lissé (DA : tout est pixel ici). */
export function ensureFireflyGroundTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(FIREFLY_POOL_KEY)) return
  const tex = scene.textures.createCanvas(FIREFLY_POOL_KEY, TEX_SIDE, TEX_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(TEX_SIDE, TEX_SIDE)
  for (let j = 0; j < TEX_SIDE; j++) {
    for (let i = 0; i < TEX_SIDE; i++) {
      const dx = i - POOL_RADIUS_CELLS
      const dy = j - POOL_RADIUS_CELLS
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / POOL_RADIUS_CELLS) // 0 centre → 1 bord
      const s = 1 - t
      const a = s * s // PAS de smoothstep : le smoothstep fait un plateau au centre, donc un cœur
      const k = (j * TEX_SIDE + i) * 4
      img.data[k] = Math.round(CORE_COLOR[0] + (EDGE_COLOR[0] - CORE_COLOR[0]) * t)
      img.data[k + 1] = Math.round(CORE_COLOR[1] + (EDGE_COLOR[1] - CORE_COLOR[1]) * t)
      img.data[k + 2] = Math.round(CORE_COLOR[2] + (EDGE_COLOR[2] - CORE_COLOR[2]) * t)
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(FIREFLY_POOL_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}
