/**
 * Boot Phaser — résolution fixe 1280×720 en Scale.FIT.
 *
 * ANTIALIAS ACTIVÉ (et NON `pixelArt`) : l'UI et le TEXTE doivent être LISSES comme la
 * maquette — un `pixelArt` global upscalerait tout le canvas en gros pixels durs. Les
 * textures pixel-art du monde (générées au boot) restent NETTES : `BootScene` leur pose
 * un filtrage NEAREST une à une, tandis que le texte (créé plus tard) garde le LINEAR
 * par défaut. `roundPixels` reste, pour que les sprites ne scintillent pas au sous-pixel.
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
  backgroundColor: '#0f0b08', // le fond chaud de la maquette (palette bg)
  antialias: true,
  roundPixels: true,
  // Éclairage dynamique (essai DA, decisions.md 2026-07-20) : le LightsManager plafonne le
  // nombre de lumières simultanées. Le soleil + une poignée de Feux visibles tiennent large.
  render: { maxLights: 40 },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  fps: { min: 30, target: 60 },
  scene: [BootScene, MenuScene, WorldScene, UIScene],
})
