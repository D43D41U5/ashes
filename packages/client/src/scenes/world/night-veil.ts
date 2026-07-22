/**
 * LE VOILE DE NUIT — le calque bleu qui assombrit le monde, MAIS QUE LE FEU CREUSE.
 *
 * Avant, la nuit était un simple rectangle plein-monde (couleur de l'heure + air de la zone)
 * posé tout en haut : uniforme, rien ne le perçait, le Feu ne pouvait donc pas éclairer le sol
 * (demande d'Alexis). Ici, le voile est une RenderTexture TAILLE ÉCRAN redessinée par frame :
 * on la remplit du bleu de nuit (heure puis air de zone, empilés comme les deux rectangles
 * d'avant), puis CHAQUE FEU y EFFACE un trou doux. Près du Feu, la nuit se lève — le sol et les
 * troncs/persos alentour s'éclaircissent, comme une vraie clairière au feu.
 *
 * Le trou est PIXELLISÉ (grain de 4 px, NEAREST — la DA, cf. `fire-ground-glow`) : son bord est
 * une série de carrés durs, jamais un dégradé lissé. L'effacement est PARTIEL (pic < 1) : la nuit
 * s'amincit sans disparaître, elle ne devient pas un trou plein jour.
 *
 * La RT est en `scrollFactor(0)` (elle colle à l'écran) ; les Feux, eux, sont en coordonnées
 * MONDE — on les projette à l'écran via le `worldView` et le zoom de la caméra.
 *
 * AUCUNE logique de jeu : pur habillage.
 */
import Phaser from 'phaser'
import { TILE_PX } from '../../render/framing'

/** Pic d'effacement (0..1) : à 0,82, un voile à alpha 0,72 tombe au centre à 0,72×0,18 ≈ 0,13. */
const HOLE_ERASE_PEAK = 0.82
/** La clairière déborde la flaque ambre : rayon du trou = rayon de `fireGlow` × ce facteur. */
const HOLE_SPREAD = 2.3
/** Résolution de la brosse UNITÉ. Choisie pour qu'au rayon typique (~7 tuiles) un texel retombe
 *  sur ~4 px monde — le grain de la DA. La portée PULSE (via `fireGlow.radius`), donc le grain
 *  respire un peu autour de 4 px : c'est le prix du « la lumière pulse jusqu'au sol ». */
const BRUSH_RADIUS_CELLS = 28
const BRUSH_SIDE = BRUSH_RADIUS_CELLS * 2 + 1

/** Brosse d'effacement UNITÉ : disque radial QUANTIFIÉ (smoothstep), blanc, NEAREST → trou pixel.
 *  Normalisée (rayon = demi-côté) ; sa taille MONDE est fixée par `setDisplaySize` à chaque Feu. */
const HOLE_KEY = 'fx-night-hole'
function ensureHoleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(HOLE_KEY)) return
  const tex = scene.textures.createCanvas(HOLE_KEY, BRUSH_SIDE, BRUSH_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(BRUSH_SIDE, BRUSH_SIDE)
  for (let j = 0; j < BRUSH_SIDE; j++) {
    for (let i = 0; i < BRUSH_SIDE; i++) {
      const dx = i - BRUSH_RADIUS_CELLS
      const dy = j - BRUSH_RADIUS_CELLS
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / BRUSH_RADIUS_CELLS)
      const s = 1 - t
      const a = s * s * (3 - 2 * s) // smoothstep : plein au centre, 0 doux au bord
      const k = (j * BRUSH_SIDE + i) * 4
      img.data[k] = 255
      img.data[k + 1] = 255
      img.data[k + 2] = 255
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(HOLE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

export interface VeilFire {
  worldX: number
  worldY: number
  /** Rayon de lueur EN TUILES (de `fireGlow` — il PULSE avec la flamme). Pilote la portée du trou. */
  radiusTiles: number
}

export class NightVeil {
  private rt: Phaser.GameObjects.RenderTexture
  /** La DynamicTexture SOUS le GameObject : en Phaser 4, TOUT le dessin (clear/fill/erase) se fait
   *  ICI, pas sur le GameObject `rt` (dont les proxis `fill` sont inertes). */
  private dt: Phaser.Textures.DynamicTexture
  /** Brosse réutilisée comme tampon d'effacement (hors liste d'affichage). */
  private brush: Phaser.GameObjects.Image
  private w = 0
  private h = 0

  constructor(private scene: Phaser.Scene) {
    ensureHoleTexture(scene)
    this.w = scene.scale.width
    this.h = scene.scale.height
    this.rt = scene.add.renderTexture(0, 0, this.w, this.h).setOrigin(0, 0).setScrollFactor(0)
    this.dt = this.rt.texture as Phaser.Textures.DynamicTexture
    // Hors liste d'affichage : la brosse n'est jamais rendue seule, elle ne sert que de tampon
    // au `erase` de la DynamicTexture.
    this.brush = new Phaser.GameObjects.Image(scene, 0, 0, HOLE_KEY).setOrigin(0.5, 0.5)
  }

  /**
   * Redessine le voile. `hour`/`zone` sont les deux couches empilées (couleur+alpha) ; `depth`
   * suit le mode d'éclairage ; `holes` = false coupe l'effacement (mode debug éclairé, où la
   * vraie pipeline fait la lumière — on ne troue pas deux fois).
   */
  update(
    hour: { color: number; alpha: number },
    zone: { color: number; alpha: number },
    fires: VeilFire[],
    camera: Phaser.Cameras.Scene2D.Camera,
    depth: number,
    holes: boolean,
  ): void {
    const sw = this.scene.scale.width
    const sh = this.scene.scale.height
    if (sw !== this.w || sh !== this.h) {
      this.w = sw
      this.h = sh
      this.dt.setSize(sw, sh)
    }
    this.rt.setDepth(depth)
    // En Phaser 4, les opérations de DynamicTexture (clear/fill/erase) ne prennent effet qu'au
    // `render()` final qui les flushe — sans lui, le voile reste fantôme (le bug qu'on traquait).
    this.dt.clear()
    // Les deux calques bleus, empilés comme les anciens rectangles (air de zone SOUS l'heure).
    if (zone.alpha > 0.001) this.dt.fill(zone.color, zone.alpha)
    if (hour.alpha > 0.001) this.dt.fill(hour.color, hour.alpha)

    if (holes && hour.alpha > 0.001) {
      const v = camera.worldView
      const zoom = camera.zoom
      for (const f of fires) {
        const sx = (f.worldX - v.x) * zoom
        const sy = (f.worldY - v.y) * zoom
        // Portée = rayon de lueur × débord, en px écran. Elle PULSE : `radiusTiles` bat avec la flamme.
        const dia = f.radiusTiles * HOLE_SPREAD * 2 * TILE_PX * zoom
        const margin = dia / 2
        if (sx < -margin || sy < -margin || sx > sw + margin || sy > sh + margin) continue
        this.brush.setDisplaySize(dia, dia).setAlpha(HOLE_ERASE_PEAK)
        this.dt.erase(this.brush, sx, sy)
      }
    }
    this.dt.render()
  }

  destroy(): void {
    this.rt.destroy()
    this.brush.destroy()
  }
}
