/**
 * LA COUCHE DES PAROIS — les dessus de plateau, et les CONTREMARCHES qui les portent.
 *
 * Le sol est cuit à 1 px/tuile : aucun détail ne peut y vivre. Les parois sont donc des sprites,
 * posés chaque frame sur la fenêtre visible (~900 tuiles), depuis un pool réutilisé — le même
 * régime que les nœuds et le décor. Coût borné à la vue, jamais à la carte.
 *
 * ═══ LA CONTREMARCHE N'EST PAS UNE DÉCORATION : ELLE BOUCHE LE TROU ═══
 *
 * Et c'est le fait le plus important de tout le rendu en marches. Le sol se dessine à
 * `screenY = worldY × TILE − palier × STEP` : entre une tuile et sa voisine du SUD, plus basse de
 * Δ paliers, s'ouvre donc **un trou de `Δ × STEP` pixels**, où l'on verrait le vide. Ce trou n'est
 * pas un défaut : c'est la FACE du dénivelé, et il a déjà la hauteur juste.
 *
 * Il y a donc une contremarche partout où le sol descend vers le sud — **y compris sur une tuile
 * marchable**, ce qui n'a l'air de rien et qui est tout le sujet : c'est la marche d'un ESCALIER de
 * seuil, ou le ressaut d'une rampe de butte. Le joueur la gravit ; il la voit se dresser devant lui
 * avant de la gravir. *On monte d'un niveau pour chaque entier de niveau, et ça se voit.*
 *
 * Le DESSUS (la roche mouchetée, ses liserés) ne se pose, lui, que sur les tuiles de FALAISE : un
 * palier de repos d'escalier reste de l'herbe, il n'a aucune raison de devenir de la pierre.
 *
 * Le hors-carte compte comme falaise : l'anneau de bordure en est, et le bord du monde ne doit pas
 * montrer une lèvre vers le néant.
 */
import type Phaser from 'phaser'
import { hash2, palierAt, TERRAIN_CLIFF, type WorldMap } from '@braises/sim'
import { CLIFF_SHADOW_KEY, cliffKey, RISER_MAX, riserKey } from '../../render/cliff-art'
import { CHUTE_MARGIN_TILES, GROUND_MAP_DEPTH, LIFT_MARGIN_TILES, STEP_PX, TILE_PX } from '../../render/framing'

/** Au-dessus du sol et de la cendre (+0,25), sous l'ombre solaire (+0,5) et tout ce qui a des
 *  pieds (≥ 2). L'ombre portée se glisse juste sous les parois. */
const CLIFF_DEPTH = GROUND_MAP_DEPTH + 0.32
const SHADOW_DEPTH = GROUND_MAP_DEPTH + 0.3

export class CliffLayer {
  private tops: Phaser.GameObjects.Image[] = []
  private risers: Phaser.GameObjects.Image[] = []
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

  /** Le palier d'une tuile. Hors carte : celui de la tuile de bord la plus proche — sans quoi le
   *  pourtour du monde ouvrirait une contremarche de tout son relief contre le vide. */
  private pal(tx: number, ty: number): number {
    const { width, height } = this.map
    const cx = Math.min(width - 1, Math.max(0, tx))
    const cy = Math.min(height - 1, Math.max(0, ty))
    return palierAt(this.map, cx, cy)
  }

  render(camera: Phaser.Cameras.Scene2D.Camera): void {
    const v = camera.worldView
    const { width, height } = this.map
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    // Une terrasse haute plantée SOUS la vue y remonte ; une CREVASSE plantée AU-DESSUS y descend
    // (palier négatif, spec R39). On cule des deux côtés.
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1 - CHUTE_MARGIN_TILES)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + LIFT_MARGIN_TILES)

    let nTop = 0
    let nRiser = 0
    let nShadow = 0

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const p = this.pal(tx, ty)
        const lift = p * STEP_PX
        const variant = hash2(tx, ty) < 0.5 ? 0 : 1
        const estFalaise = this.cliff(tx, ty)

        // ── LE DESSUS : la surface du plateau. Seulement sur la roche. ──
        if (estFalaise) {
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
          img.setPosition(tx * TILE_PX, ty * TILE_PX - lift)
          img.setVisible(true)
          nTop += 1
        }

        // ── LA CONTREMARCHE : le sol descend-il vers le sud ? Alors il y a un trou, et c'est le mur.
        const d = Math.min(RISER_MAX, p - this.pal(tx, ty + 1))
        if (d <= 0) continue

        // Le mur tourne-t-il ? On regarde si le voisin est/ouest tombe AUSSI — s'il ne tombe pas,
        // le mur a une arête vive de ce côté, et elle s'éclaire (ouest) ou s'assombrit (est).
        const chuteE = this.pal(tx + 1, ty) - this.pal(tx + 1, ty + 1) > 0
        const chuteW = this.pal(tx - 1, ty) - this.pal(tx - 1, ty + 1) > 0
        const key = riserKey(d, (chuteE ? 0 : 1) | (chuteW ? 0 : 2), variant)

        let img = this.risers[nRiser]
        if (!img) {
          img = this.scene.add.image(0, 0, key).setOrigin(0).setDepth(CLIFF_DEPTH)
          this.risers[nRiser] = img
        }
        img.setTexture(key)
        // Elle pend sous la tuile : de son bord bas (`(ty+1)·TILE − lift`) jusqu'au bord haut de la
        // voisine — soit exactement `d × STEP` px. Le trou est bouché, au pixel près.
        img.setPosition(tx * TILE_PX, (ty + 1) * TILE_PX - lift)
        img.setVisible(true)
        nRiser += 1

        // L'OMBRE PORTÉE, au pied de la face, posée sur le sol d'en bas : c'est elle qui donne la
        // hauteur. Un mur sans ombre est un papier peint.
        let sh = this.shadows[nShadow]
        if (!sh) {
          sh = this.scene.add.image(0, 0, CLIFF_SHADOW_KEY).setOrigin(0).setDepth(SHADOW_DEPTH)
          this.shadows[nShadow] = sh
        }
        sh.setPosition(tx * TILE_PX, (ty + 1) * TILE_PX - this.pal(tx, ty + 1) * STEP_PX)
        sh.setVisible(true)
        nShadow += 1
      }
    }

    for (let i = nTop; i < this.tops.length; i++) this.tops[i]!.setVisible(false)
    for (let i = nRiser; i < this.risers.length; i++) this.risers[i]!.setVisible(false)
    for (let i = nShadow; i < this.shadows.length; i++) this.shadows[i]!.setVisible(false)
  }

  destroy(): void {
    for (const s of this.tops) s.destroy()
    for (const s of this.risers) s.destroy()
    for (const s of this.shadows) s.destroy()
  }
}
