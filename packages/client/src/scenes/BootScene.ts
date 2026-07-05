/**
 * Génération des textures placeholder (spec client R8, pattern Manif) :
 * tant que la direction artistique n'est pas posée, tout est dessiné par
 * code au boot — aucun asset binaire dans le repo.
 */
import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot')
  }

  create(): void {
    this.makeSprite('spr-player', 0xf0e6c8, 0x8a6f3c)
    this.makeSprite('spr-npc', 0x9aa4b5, 0x4a5364)
    this.makeStructures()
    this.scene.start('world')
  }

  /** Textures 16×16 des structures — placeholders générés (spec client R8). */
  private makeStructures(): void {
    const g = this.add.graphics()
    const tile = (border: number, fill: number) => {
      g.fillStyle(border).fillRect(0, 0, 16, 16)
      g.fillStyle(fill).fillRect(1, 1, 14, 14)
    }

    tile(0x3a2c1e, 0x6b4a2f) // mur : bois sombre
    g.generateTexture('st-wall', 16, 16)
    g.clear()

    tile(0x3a2c1e, 0x8a6234) // porte : bois clair + seuil
    g.fillStyle(0x2a1e12).fillRect(6, 2, 4, 12)
    g.generateTexture('st-door', 16, 16)
    g.clear()

    tile(0x4a3520, 0x7a5a30) // coffre : couvercle doré
    g.fillStyle(0xc9a227).fillRect(3, 6, 10, 4)
    g.generateTexture('st-chest', 16, 16)
    g.clear()

    tile(0x3c3c40, 0x5c5c62) // atelier : enclume
    g.fillStyle(0x2a2a2e).fillRect(4, 7, 8, 5)
    g.generateTexture('st-workshop', 16, 16)
    g.clear()

    // Le Feu : foyer de pierre + flamme (la couleur d'alignement viendra en V8).
    g.fillStyle(0x55504a).fillCircle(8, 8, 7)
    g.fillStyle(0x2b2723).fillCircle(8, 8, 5)
    g.fillStyle(0xe8842c).fillCircle(8, 8, 4)
    g.fillStyle(0xf7c256).fillCircle(8, 7, 2)
    g.generateTexture('st-fire', 16, 16)
    g.destroy()

    this.makeNodes()
  }

  /** Textures des nœuds de ressources. */
  private makeNodes(): void {
    const g = this.add.graphics()

    g.fillStyle(0x4a3620).fillRect(6, 9, 4, 6) // arbre : tronc + houppier
    g.fillStyle(0x1e4d22).fillCircle(8, 6, 6)
    g.fillStyle(0x2d6b32).fillCircle(6, 5, 3)
    g.generateTexture('nd-tree', 16, 16)
    g.clear()

    g.fillStyle(0x5a5a5e).fillCircle(8, 10, 6) // affleurement
    g.fillStyle(0x7c7c82).fillCircle(6, 8, 3)
    g.generateTexture('nd-rock', 16, 16)
    g.clear()

    g.fillStyle(0x6f9c3a) // fibres : touffe
    g.fillRect(4, 8, 2, 7)
    g.fillRect(7, 6, 2, 9)
    g.fillRect(10, 9, 2, 6)
    g.generateTexture('nd-fiber_plant', 16, 16)
    g.clear()

    g.fillStyle(0x2f5e33).fillCircle(8, 9, 6) // buisson à baies
    g.fillStyle(0xc0392b)
    g.fillCircle(5, 8, 1.5)
    g.fillCircle(10, 7, 1.5)
    g.fillCircle(8, 11, 1.5)
    g.generateTexture('nd-berry_bush', 16, 16)
    g.clear()

    g.fillStyle(0x5a5a5e).fillCircle(8, 10, 6) // filon de fer : veinules rouille
    g.fillStyle(0xb0632e)
    g.fillRect(5, 8, 3, 2)
    g.fillRect(9, 11, 3, 2)
    g.generateTexture('nd-iron_vein', 16, 16)
    g.clear()

    g.fillStyle(0x5a5a5e).fillCircle(8, 10, 6) // veine de charbon
    g.fillStyle(0x1c1c20)
    g.fillRect(5, 8, 3, 2)
    g.fillRect(9, 11, 3, 2)
    g.generateTexture('nd-coal_seam', 16, 16)
    g.destroy()
  }

  private makeSprite(key: string, fill: number, border: number): void {
    const g = this.add.graphics()
    g.fillStyle(border).fillRect(0, 0, 12, 12)
    g.fillStyle(fill).fillRect(1, 1, 10, 10)
    g.generateTexture(key, 12, 12)
    g.destroy()
  }
}
