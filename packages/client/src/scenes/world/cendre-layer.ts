/**
 * LA CENDRE, PEINTE — parce qu'un front qui avance en silence n'avance pas.
 *
 * Le sol est cuit UNE fois en texture (il ne change pas). La cendre, elle, gagne du terrain jour
 * après jour : il lui faut sa propre couche. Mais elle n'a pas besoin d'être redessinée à chaque
 * image — **le front ne bouge qu'une fois par jour de saison**. On la recuit donc quand il a
 * franchi un pas visible, et pas avant.
 *
 * CE QU'ELLE DOIT DIRE, ET EN UN COUP D'ŒIL : *« ceci a brûlé, et ça se rapproche. »* D'où deux
 * choses, et pas une de plus :
 *
 *   — LE BRÛLÉ est gris-noir, désaturé, mort. Un `MULTIPLY` : la cendre ne repeint pas le sol,
 *     elle l'éteint. On reconnaît encore le pré qu'il était, et c'est ce qui fait mal.
 *   — LA LISIÈRE est une braise. Une bande étroite, à la limite du front, qui rougeoie. C'est
 *     elle qu'on voit venir, et c'est elle qu'on longe en se demandant combien de temps il reste.
 *
 * Le client ne SAIT rien : il lit `map.cendre` (statique) et le front, qu'il recalcule du tick.
 * Zéro tuile transmise, zéro état synchronisé — c'est tout l'intérêt du modèle.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'

/** Juste au-dessus du sol, sous l'ombre du relief et sous tout ce qui a des pieds. */
const CENDRE_DEPTH = GROUND_MAP_DEPTH + 0.25

/** Largeur de la lisière incandescente, en tuiles. Assez large pour se voir à un écran de
 *  distance (la caméra en montre 35), assez étroite pour rester une LIGNE, pas une zone. */
const LISIERE_TILES = 6

/** On ne recuit pas pour trois pixels : le front doit avoir bougé d'au moins ça. */
const PAS_DE_RECUISSON = 4

export class CendreLayer {
  private img: Phaser.GameObjects.Image | null = null
  private dernierFront = -Infinity
  private readonly key: string

  constructor(
    private scene: Phaser.Scene,
    private map: WorldMap,
    keySuffix = '',
  ) {
    this.key = `cendre-${keySuffix}`
  }

  /** Appelé à chaque frame — mais ne fait rien tant que le front n'a pas bougé. */
  update(front: number): void {
    if (!this.map.cendre) return
    if (front <= 0) return // l'acte I : rien ne brûle hors de la Cendrière… qui brûle déjà, elle
    if (Math.abs(front - this.dernierFront) < PAS_DE_RECUISSON) return
    this.dernierFront = front
    this.bake(front)
  }

  private bake(front: number): void {
    const { width, height, cendre } = this.map
    if (!cendre) return

    const g = this.scene.add.graphics()
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const d = cendre[ty * width + tx]!
        if (d >= front) continue // vivant : on ne le touche pas

        // Plus on est loin DERRIÈRE le front, plus c'est mort. À la lisière, ça couve encore.
        const derriere = front - d
        if (derriere < LISIERE_TILES) {
          // LA BRAISE — c'est elle qu'on voit venir. Un ADD, pour qu'elle brille au lieu d'assombrir.
          const t = 1 - derriere / LISIERE_TILES
          g.fillStyle(0xd9541f, 0.25 + 0.5 * t)
        } else {
          // LE BRÛLÉ — un gris de cendre. L'alpha monte lentement : le sol s'éteint, il ne
          // disparaît pas. On reconnaît le pré qu'il était, et c'est ce qui fait mal.
          const t = Math.min(1, (derriere - LISIERE_TILES) / 60)
          g.fillStyle(0x1a1a1e, 0.55 + 0.35 * t)
        }
        g.fillRect(tx, ty, 1, 1) // 1 px/tuile, étiré à la taille monde (comme le sol)
      }
    }

    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key)
    g.generateTexture(this.key, width, height)
    g.destroy()

    this.img?.destroy()
    this.img = this.scene.add
      .image(0, 0, this.key)
      .setOrigin(0, 0)
      .setDisplaySize(width * TILE_PX, height * TILE_PX)
      .setDepth(CENDRE_DEPTH)
    // Nearest : la cendre a une ARÊTE. Un dégradé bilinéaire en ferait une brume, et une brume
    // ne se longe pas — or c'est précisément ce que le joueur doit faire pour la fuir.
    this.scene.textures.get(this.key).setFilter(Phaser.Textures.FilterMode.NEAREST)
  }

  destroy(): void {
    this.img?.destroy()
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key)
  }
}
