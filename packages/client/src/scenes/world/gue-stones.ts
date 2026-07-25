/**
 * LES PIERRES DE GUÉ — le passage se lit par la FORME, pas par la teinte seule.
 *
 * Mesuré par la revue DA : l'interruption du cœur profond au droit d'un gué ne tient qu'au
 * canal bleu (contraste de luminance deep/shallow 1,29:1) — un joueur à vision déficiente ne
 * voit pas le passage venir, et recolorer l'eau serait un étalonnage GLOBAL (le shader sert
 * toute la carte). Le correctif est local et additif : des pierres affleurent au gué, comme
 * dans tous les jeux du genre — quatre-cinq dalles claires posées sur le haut-fond, et le
 * passage se lit même en niveaux de gris.
 *
 * Données : les toponymes « le Gué » (7×7, sans kind) posés par le worldgen. Placement salé
 * positionnel — même dessin à chaque session.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import type { Warp } from '../../render/warp'

const KEY = 'gue-pierre'
const STONE = { lit: 0xc2bcb0, mid: 0x9a938a, deep: 0x5a554e }
const SHADOW = 0x000000

/** La dalle : un galet plat, clair, à fleur d'eau. Peinte une fois au boot. */
export function makeGueStoneTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics()
  g.fillStyle(SHADOW, 0.22).fillEllipse(7, 9, 12, 4)
  g.fillStyle(STONE.mid).fillEllipse(7, 7, 12, 7)
  g.fillStyle(STONE.lit).fillEllipse(6, 6, 8, 4)
  g.fillStyle(STONE.deep).fillEllipse(9, 9, 6, 2)
  g.generateTexture(KEY, 14, 12)
  g.destroy()
}

export class GueStones {
  private readonly sprites: Phaser.GameObjects.Image[] = []

  constructor(scene: Phaser.Scene, map: WorldMap, warp: Warp) {
    for (const z of map.zones) {
      if (z.kind !== undefined || z.name !== 'le Gué') continue
      // Cinq dalles semées dans l'emprise du gué, par hash positionnel — un pas irrégulier,
      // pas une file indienne (le courant a déplacé les pierres).
      for (let k = 0; k < 5; k++) {
        const h1 = (Math.imul(z.x + k, 0x9e3779b1) ^ Math.imul(z.y, 0x85ebca6b)) >>> 0
        const h2 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d) >>> 0
        const tx = z.x + 1 + ((h1 >>> 4) % (z.w - 2)) + 0.5
        const ty = z.y + 1 + ((h2 >>> 4) % (z.h - 2)) + 0.5
        const px = tx * TILE_PX
        const py = ty * TILE_PX - warp.lift(tx, ty)
        const s = scene.add
          .image(px, py, KEY)
          .setOrigin(0.5, 1)
          .setFlipX(k % 2 === 1)
          .setScale(0.85 + ((h2 >>> 20) % 4) * 0.1)
        s.setDepth(ySortDepth(ty, TILE_PX, TIE_NODE))
        this.sprites.push(s)
      }
    }
  }

  destroy(): void {
    for (const s of this.sprites) s.destroy()
    this.sprites.length = 0
  }
}
