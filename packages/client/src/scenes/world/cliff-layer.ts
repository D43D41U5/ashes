/**
 * LA COUCHE DES PAROIS — les bandes de ROCHE PLATE aux frontières de zone.
 *
 * Le sol est cuit à 1 px/tuile : aucun détail ne peut y vivre. Les parois sont donc des sprites,
 * posés chaque frame sur la fenêtre visible (~900 tuiles), depuis un pool réutilisé — le même
 * régime que les nœuds et le décor. Coût borné à la vue, jamais à la carte.
 *
 * La carte est PLATE (pivot RimWorld) : il n'y a plus de hauteur, donc plus de contremarche ni
 * d'ombre portée. Une falaise est une tuile de roche infranchissable, vue de dessus, posée à sa
 * position plate. On lui donne un LISERÉ sur ses bords ouverts (adjacents à du sol marchable) — le
 * trait clair qu'on longe comme une arête de montagne dans RimWorld.
 *
 * Le hors-carte compte comme falaise : l'anneau de bordure en est, et le bord du monde se peint donc
 * en roche comme le reste.
 */
import type Phaser from 'phaser'
import { hash2, TERRAIN_CLIFF, type WorldMap } from '@braises/sim'
import { cliffKey } from '../../render/cliff-art'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'

/** Au-dessus du sol et de la cendre (+0,25), sous tout ce qui a des pieds (≥ 2). */
const CLIFF_DEPTH = GROUND_MAP_DEPTH + 0.32

export class CliffLayer {
  private tops: Phaser.GameObjects.Image[] = []

  constructor(
    private scene: Phaser.Scene,
    private map: WorldMap,
  ) {}

  /** Une tuile est-elle de la falaise ? Le hors-carte en est (l'anneau de bordure). */
  private cliff(tx: number, ty: number): boolean {
    const { width, height, terrain } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true
    return terrain[ty * width + tx] === TERRAIN_CLIFF
  }

  render(camera: Phaser.Cameras.Scene2D.Camera): void {
    const v = camera.worldView
    const { width, height } = this.map
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 1)

    let nTop = 0

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.cliff(tx, ty)) continue
        const variant = hash2(tx, ty) < 0.5 ? 0 : 1
        // Le liseré s'allume sur les bords ouverts au sol marchable (nord/est/ouest).
        const n = !this.cliff(tx, ty - 1)
        const e = !this.cliff(tx + 1, ty)
        const w = !this.cliff(tx - 1, ty)
        const key = cliffKey('top', (n ? 1 : 0) | (e ? 2 : 0) | (w ? 4 : 0), variant)
        let img = this.tops[nTop]
        if (!img) {
          img = this.scene.add.image(0, 0, key).setOrigin(0).setDepth(CLIFF_DEPTH)
          this.tops[nTop] = img
        }
        img.setTexture(key)
        img.setPosition(tx * TILE_PX, ty * TILE_PX)
        img.setVisible(true)
        nTop += 1
      }
    }

    for (let i = nTop; i < this.tops.length; i++) this.tops[i]!.setVisible(false)
  }

  destroy(): void {
    for (const s of this.tops) s.destroy()
  }
}
