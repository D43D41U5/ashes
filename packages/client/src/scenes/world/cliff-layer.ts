/**
 * LA COUCHE DES FALAISES — les tuiles de paroi, auto-raccordées, fenêtrées à la vue.
 *
 * Le sol est cuit à 1 px/tuile : aucun détail ne peut y vivre. Les parois sont donc des sprites,
 * posés chaque frame sur la fenêtre visible (~900 tuiles), depuis un pool réutilisé — le même
 * régime que les nœuds et l'ombre du relief. Coût borné à la vue, jamais à la carte.
 *
 * ═══ L'AUTO-RACCORD — qui montre quoi ═══
 *
 * Le choix de la tuile ne regarde que les VOISINES (4-connexité, comme la collision) :
 *
 *   — le sud est OUVERT            → la FACE (`f0`) : on voit le mur, et son ombre tombe dessous ;
 *   — le sud est une FACE          → le HAUT DE MUR (`f1`) : la paroi continue, coiffée de la
 *     LÈVRE claire — une falaise fait DEUX tuiles de haut, sinon c'est un muret ;
 *   — sinon                        → le DESSUS (`top`) : le plateau, avec ses liserés de bord.
 *
 * Le hors-carte compte comme falaise : l'anneau de bordure en est, et le bord du monde ne doit
 * pas montrer une lèvre vers le néant.
 */
import type Phaser from 'phaser'
import { hash2, TERRAIN_CLIFF, type WorldMap } from '@braises/sim'
import { CLIFF_SHADOW_KEY, cliffKey } from '../../render/cliff-art'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'

/** Au-dessus du sol et de la cendre (+0,25), sous l'ombre solaire (+0,5) et tout ce qui a des
 *  pieds (≥ 2). L'ombre portée se glisse juste sous les parois. */
const CLIFF_DEPTH = GROUND_MAP_DEPTH + 0.32
const SHADOW_DEPTH = GROUND_MAP_DEPTH + 0.3

export class CliffLayer {
  private pool: Phaser.GameObjects.Image[] = []
  private shadows: Phaser.GameObjects.Image[] = []

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
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 2) // −2 : un haut de mur peut déborder d'en haut
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 1)

    let used = 0
    let shadowsUsed = 0
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.cliff(tx, ty)) continue

        const sOuvert = !this.cliff(tx, ty + 1)
        const sEstFace = !sOuvert && !this.cliff(tx, ty + 2)
        const e = !this.cliff(tx + 1, ty)
        const w = !this.cliff(tx - 1, ty)
        let key: string
        const variant = hash2(tx, ty) < 0.5 ? 0 : 1
        if (sOuvert) {
          key = cliffKey('f0', (e ? 1 : 0) | (w ? 2 : 0), variant)
        } else if (sEstFace) {
          key = cliffKey('f1', (e ? 1 : 0) | (w ? 2 : 0), variant)
        } else {
          const n = !this.cliff(tx, ty - 1)
          key = cliffKey('top', (n ? 1 : 0) | (e ? 2 : 0) | (w ? 4 : 0), variant)
        }

        let img = this.pool[used]
        if (!img) {
          img = this.scene.add.image(0, 0, key).setOrigin(0).setDepth(CLIFF_DEPTH)
          this.pool[used] = img
        }
        img.setTexture(key)
        img.setPosition(tx * TILE_PX, ty * TILE_PX)
        img.setVisible(true)
        used += 1

        // L'OMBRE PORTÉE, au pied de la face : c'est elle qui donne la hauteur du mur.
        if (sOuvert && ty + 1 < height) {
          let sh = this.shadows[shadowsUsed]
          if (!sh) {
            sh = this.scene.add.image(0, 0, CLIFF_SHADOW_KEY).setOrigin(0).setDepth(SHADOW_DEPTH)
            this.shadows[shadowsUsed] = sh
          }
          sh.setPosition(tx * TILE_PX, (ty + 1) * TILE_PX)
          sh.setVisible(true)
          shadowsUsed += 1
        }
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false)
    for (let i = shadowsUsed; i < this.shadows.length; i++) this.shadows[i]!.setVisible(false)
  }

  destroy(): void {
    for (const s of this.pool) s.destroy()
    for (const s of this.shadows) s.destroy()
  }
}
