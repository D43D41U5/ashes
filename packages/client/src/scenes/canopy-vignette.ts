/**
 * Le voile de sous-bois — une vignette radiale écran (comme la pénombre de la
 * jungle dans Don't Starve) : sombre sur les bords, halo clair au centre sur
 * l'avatar, qui se referme quand on s'enfonce sous la canopée. Vit dans UIScene
 * (caméra neutre, non zoomée) : un objet écran dans la caméra zoomée du monde
 * serait projeté hors champ. AUCUNE logique — pur habillage.
 *
 * L'ombre du couvert était autrefois peinte dans le monde (texture `canopy`,
 * visible de partout) ; elle est désormais un effet centré sur le joueur. La
 * texture monde subsiste, très atténuée, comme simple repère (WorldScene).
 */
import Phaser from 'phaser'
import { canopyVignette, daylight } from '../render/lighting'

/** Sous tout le HUD (texte, barres, alarme, carte) : le voile ne masque jamais l'info. */
const VIGNETTE_DEPTH = -100
/** Côté de la texture bakée — plus grand que le viewport pour couvrir même resserré. */
const TEXTURE_SIZE = 1600
/** Échelle du dégradé selon `tightness` : halo large (peu de couvert) → resserré (plein couvert). */
const SCALE_LOOSE = 1.25
const SCALE_TIGHT = 0.85
/** Teinte du sous-bois — même vert quasi noir que la canopée monde (0x040807). */
const VIGNETTE_RGB = '4,8,7'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export class CanopyVignette {
  private readonly image: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists('canopy-vignette')) {
      const tex = scene.textures.createCanvas('canopy-vignette', TEXTURE_SIZE, TEXTURE_SIZE)
      if (tex) {
        const ctx = tex.getContext()
        const c = TEXTURE_SIZE / 2
        const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
        grad.addColorStop(0, `rgba(${VIGNETTE_RGB},0)`) // halo clair au centre (l'avatar)
        grad.addColorStop(0.4, `rgba(${VIGNETTE_RGB},0)`)
        grad.addColorStop(1, `rgba(${VIGNETTE_RGB},1)`) // sous-bois refermé sur les bords
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)
        tex.refresh()
      }
    }
    const cam = scene.cameras.main
    this.image = scene.add.image(cam.width / 2, cam.height / 2, 'canopy-vignette').setDepth(VIGNETTE_DEPTH).setAlpha(0)
  }

  /** Dose le voile depuis le couvert lissé autour du joueur (0..1) et l'heure. */
  update(coverage: number, hour: number): void {
    const v = canopyVignette(coverage, daylight(hour))
    this.image.setAlpha(v.alpha).setScale(lerp(SCALE_LOOSE, SCALE_TIGHT, v.tightness))
  }
}
