/**
 * Rendu du décor cosmétique : sprites POOLÉS, culled à la vue caméra, avec LOD
 * (coupé quand on dézoome trop). Purement visuel — aucune collision (INV-1).
 * La décision « quel prop sur quelle tuile » vit dans render/clutter.ts (pur) ;
 * ici on ne fait que du pooling Phaser et du placement.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { TILE_PX } from '../../render/framing'
import { clutterAt, type SampleTerrain } from '../../render/clutter'

const CLUTTER_MIN_ZOOM = 1.2 // en-deçà, on coupe le décor (props illisibles) : le canopy prend le relais
const CLUTTER_DEPTH_BASE = 2 // sous les cadavres (3)/nœuds (4) → les vrais nœuds ressortent (INV-2)
const CLUTTER_TINT = 0xbfc4bd // léger assombrissement/désaturation (INV-2)
const MARGIN_TILES = 2 // marge de culling pour éviter le pop en bordure d'écran
const MAX_SPRITES = 4000 // borne dure de perf (cap silencieux : on log si dépassé)

export class ClutterLayer {
  private readonly pool: Phaser.GameObjects.Image[] = []
  private readonly sample: SampleTerrain
  private warned = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    private readonly seed: number,
  ) {
    this.sample = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
      return map.terrain[ty * map.width + tx] ?? -1
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    let used = 0
    if (camera.zoom >= CLUTTER_MIN_ZOOM) {
      const v = camera.worldView
      const x0 = Math.max(0, Math.floor(v.x / TILE_PX) - MARGIN_TILES)
      const y0 = Math.max(0, Math.floor(v.y / TILE_PX) - MARGIN_TILES)
      const x1 = Math.min(this.map.width - 1, Math.ceil((v.x + v.width) / TILE_PX) + MARGIN_TILES)
      const y1 = Math.min(this.map.height - 1, Math.ceil((v.y + v.height) / TILE_PX) + MARGIN_TILES)
      for (let ty = y0; ty <= y1 && used < MAX_SPRITES; ty++) {
        for (let tx = x0; tx <= x1 && used < MAX_SPRITES; tx++) {
          const terrain = this.map.terrain[ty * this.map.width + tx] ?? -1
          const props = clutterAt(tx, ty, terrain, this.seed, this.sample)
          for (const p of props) {
            if (used >= MAX_SPRITES) break
            const sprite = this.acquire(used++)
            sprite.setTexture(`cl-${p.kind}`)
            sprite.setPosition((tx + 0.5 + p.ox) * TILE_PX, (ty + 1 + p.oy) * TILE_PX)
            sprite.setDisplaySize(TILE_PX * p.scale, TILE_PX * p.scale)
            sprite.setFlipX(p.mirror)
            // Y-sort interne au décor, borné à [BASE, BASE+1) → toujours sous les nœuds.
            sprite.setDepth(CLUTTER_DEPTH_BASE + ty / this.map.height)
            sprite.setVisible(true)
          }
        }
      }
      if (used >= MAX_SPRITES && !this.warned) {
        console.warn(`[clutter] cap de ${MAX_SPRITES} sprites atteint — décor tronqué à la vue`)
        this.warned = true
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false)
  }

  private acquire(i: number): Phaser.GameObjects.Image {
    let sprite = this.pool[i]
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, 'cl-grass_tuft').setOrigin(0.5, 1).setTint(CLUTTER_TINT)
      this.pool[i] = sprite
    }
    return sprite
  }

  destroy(): void {
    for (const s of this.pool) s.destroy()
    this.pool.length = 0
  }
}
