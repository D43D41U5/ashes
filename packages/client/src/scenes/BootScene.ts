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
    this.scene.start('world')
  }

  private makeSprite(key: string, fill: number, border: number): void {
    const g = this.add.graphics()
    g.fillStyle(border).fillRect(0, 0, 12, 12)
    g.fillStyle(fill).fillRect(1, 1, 10, 10)
    g.generateTexture(key, 12, 12)
    g.destroy()
  }
}
