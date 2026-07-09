/**
 * Rendu des parois de falaise : sprites POOLÉS, cullés à la vue caméra.
 * Purement visuel — aucune collision (tranche 1 : rien ne bloque).
 * La décision « quelle tuile porte une face, de quelle hauteur » vit dans
 * render/cliffs.ts (pur) ; ici on ne fait que du pooling Phaser et du placement.
 *
 * Calqué sur clutter-layer.ts, à deux différences près : pas de coupe au dézoom
 * (une falaise est structurelle, elle doit rester lisible de loin), et une marge
 * de culling NORD élargie — une paroi PEND sous son arête, donc une face née
 * juste au-dessus du champ de vision doit quand même être dessinée.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { cliffAt, cliffPlacement, MAX_DROP, STEP_PX } from '../../render/cliffs'
import type { SampleLevel } from '../../render/hillshade'
import { TILE_PX } from '../../render/framing'

/** Marge de culling : assez au nord pour attraper une paroi qui pend dans la vue. */
const MARGIN_TILES = 2 + Math.ceil((MAX_DROP * STEP_PX) / TILE_PX)
const MAX_SPRITES = 3000 // borne dure de perf (cap : on log si dépassé)

export class CliffLayer {
  private readonly pool: Phaser.GameObjects.Image[] = []
  private readonly sample: SampleLevel
  private warned = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
  ) {
    this.sample = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
      return map.level?.[ty * map.width + tx] ?? -1
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    let used = 0
    const v = camera.worldView
    const x0 = Math.max(0, Math.floor(v.x / TILE_PX) - MARGIN_TILES)
    const y0 = Math.max(0, Math.floor(v.y / TILE_PX) - MARGIN_TILES)
    const x1 = Math.min(this.map.width - 1, Math.ceil((v.x + v.width) / TILE_PX) + MARGIN_TILES)
    const y1 = Math.min(this.map.height - 1, Math.ceil((v.y + v.height) / TILE_PX) + MARGIN_TILES)
    for (let ty = y0; ty <= y1 && used < MAX_SPRITES; ty++) {
      for (let tx = x0; tx <= x1 && used < MAX_SPRITES; tx++) {
        const face = cliffAt(tx, ty, this.sample)
        if (!face) continue
        const p = cliffPlacement(face, TILE_PX)
        const sprite = this.acquire(used++)
        sprite.setTexture(`cliff-${p.drop}`)
        sprite.setPosition(p.px, p.py)
        sprite.setDisplaySize(p.displayW, p.displayH)
        sprite.setDepth(p.depth)
        sprite.setVisible(true)
      }
    }
    if (used >= MAX_SPRITES && !this.warned) {
      console.warn(`[cliffs] cap de ${MAX_SPRITES} sprites atteint — parois tronquées à la vue`)
      this.warned = true
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false)
  }

  private acquire(i: number): Phaser.GameObjects.Image {
    let sprite = this.pool[i]
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, 'cliff-1').setOrigin(0.5, 1)
      this.pool[i] = sprite
    }
    return sprite
  }

  destroy(): void {
    for (const s of this.pool) s.destroy()
    this.pool.length = 0
  }
}
