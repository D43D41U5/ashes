/**
 * Rendu des LIEUX (les 26 POI). Ils étaient jusqu'ici invisibles dans le monde :
 * des zones nommées, une pastille sur la carte, et rien à voir en marchant.
 *
 * Un sprite par zone, ancré sur ses PIEDS (bas-centre de l'empreinte) et trié
 * dans la même bande que les acteurs — on passe derrière un Sanctuaire, puis
 * devant. Les zones sont statiques et peu nombreuses (~80) : on les crée une
 * fois et on ne fait que les rendre visibles à la vue caméra. Pas de pooling.
 *
 * Purement visuel : la collision d'un lieu, s'il en faut une un jour, sera une
 * décision de sim, pas de rendu.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import { poiTextureKey, POI_ART } from './poi-art'
import type { Warp } from '../../render/warp'

const MARGIN_TILES = 6 // un lieu haut (l'Arbre remarquable : 72 px) pend loin au-dessus de ses pieds

export class PoiLayer {
  private readonly sprites: { sprite: Phaser.GameObjects.Image; tx: number; ty: number }[] = []

  constructor(scene: Phaser.Scene, map: WorldMap, private readonly warp: Warp) {
    const known = new Set(POI_ART.map((a) => a.slug))
    for (const z of map.zones) {
      if (z.kind === undefined || !known.has(z.kind)) continue
      // Les pieds : bas-centre de l'empreinte. Le sprite monte de là.
      const feetX = z.x + z.w / 2
      const feetY = z.y + z.h
      const sprite = scene.add
        .image(0, 0, poiTextureKey(z.kind))
        .setOrigin(0.5, 1)
        .setVisible(false)
      sprite.setPosition(feetX * TILE_PX, feetY * TILE_PX - this.warp.lift(feetX, feetY))
      // Même bande que les acteurs et les nœuds : à pieds égaux, un lieu se
      // comporte comme un nœud (on passe devant en descendant vers le sud).
      sprite.setDepth(ySortDepth(feetY, TILE_PX, TIE_NODE))
      this.sprites.push({ sprite, tx: feetX, ty: feetY })
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const v = camera.worldView
    const x0 = v.x / TILE_PX - MARGIN_TILES
    const y0 = v.y / TILE_PX - MARGIN_TILES
    const x1 = (v.x + v.width) / TILE_PX + MARGIN_TILES
    const y1 = (v.y + v.height) / TILE_PX + MARGIN_TILES
    for (const s of this.sprites) {
      s.sprite.setVisible(s.tx >= x0 && s.tx <= x1 && s.ty >= y0 && s.ty <= y1)
    }
  }

  destroy(): void {
    for (const s of this.sprites) s.sprite.destroy()
    this.sprites.length = 0
  }
}
