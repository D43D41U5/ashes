/**
 * Boot Phaser — configuration héritée de Manif (éprouvée en pixel art) :
 * résolution fixe 1280×720 en Scale.FIT, pixelArt + roundPixels.
 */
import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { UIScene } from './scenes/UIScene'
import { WorldScene } from './scenes/WorldScene'

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: document.body,
  backgroundColor: '#0e0e12',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  fps: { min: 30, target: 60 },
  scene: [BootScene, MenuScene, WorldScene, UIScene],
})
