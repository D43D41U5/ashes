/**
 * LE VOILE DE NUIT — le calque qui assombrit le monde, MAIS QUE LE FEU CREUSE.
 *
 * La nuit est une RenderTexture TAILLE ÉCRAN redessinée par frame, que CHAQUE FEU EFFACE d'un
 * trou doux. Près du Feu, la nuit se lève — le sol et les troncs/persos alentour s'éclaircissent,
 * comme une vraie clairière au feu.
 *
 * ═══ L'ÉTALONNAGE : la BRUME s'ajoute, la LUMIÈRE se multiplie ═══
 *
 * Les deux couches (l'heure, l'air de la zone) étaient empilées avec la MÊME opération — un
 * `fill` en blend NORMAL, c'est-à-dire un mélange : `sortie = source·(1-α) + teinte·α`.
 *
 * Ce mélange porte un terme ADDITIF (`teinte·α`) qui est un PLANCHER : à minuit (α = 0,72), plus
 * rien dans le jeu ne pouvait être plus sombre que `(8, 11, 35)`. La nuit ne l'assombrissait pas,
 * elle le DÉLAVAIT — elle relevait les noirs et écrasait tout l'écart dans le haut de la plage.
 * Et cet écrasement est mesurable : le contraste de Weber d'un acteur sur son sol était divisé
 * par `(1-α)` puis encore réduit par le plancher. C'est le défaut que la note du Névé décrivait
 * sans le nommer (« le voile écrase le contraste de tout, y compris de l'avatar »).
 *
 * La correction n'est pas un réglage, c'est la bonne opération pour chaque couche :
 *
 *   • **L'HEURE est de la LUMIÈRE** — une quantité de photons qui tombe sur des surfaces. La
 *     lumière ne s'ajoute pas à une surface : elle la MULTIPLIE. D'où `MULTIPLY`. Un noir reste
 *     noir (0 × quoi que ce soit = 0), et le rapport entre deux teintes est CONSERVÉ EXACTEMENT
 *     — donc le contraste de Weber de l'avatar traverse la nuit intact (prouvé dans
 *     `lighting.test.ts`). Bénéfice second, et pas mince : à l'heure dorée, le soleil ne teinte
 *     plus que ce qu'il ÉCLAIRE. Les ombres restent neutres au lieu de virer orange avec le
 *     reste — c'est toute la différence entre un étalonnage et un filtre posé sur l'objectif.
 *
 *   • **L'AIR d'une zone est de la MATIÈRE** — de la brume, de la poussière, de la cendre en
 *     suspension entre l'œil et le monde. Elle, elle se MÊLE pour de bon, et elle a le droit de
 *     relever les noirs : c'est ce qu'une brume fait. Elle reste donc en blend NORMAL, et passe
 *     AU-DESSUS de la lumière (on regarde le monde éclairé À TRAVERS elle). C'est aussi ce qui
 *     lui garde son pouvoir de DÉSATURER — le Karst pâle, les Alpages lavés, le Névé blanc
 *     tiennent leur identité de ce délavage-là, qu'un multiply ne saurait pas produire.
 *
 * Conséquence assumée : le Feu ne creuse plus que la LUMIÈRE. Il repousse la nuit, il ne dissipe
 * pas le brouillard du Gouffre — un feu de camp n'a jamais chassé la brume.
 *
 * Le trou est PIXELLISÉ (grain de 4 px, NEAREST — la DA, cf. `fire-ground-glow`) : son bord est
 * une série de carrés durs, jamais un dégradé lissé. L'effacement est PARTIEL (pic < 1) : la nuit
 * s'amincit sans disparaître, elle ne devient pas un trou plein jour. Il se transpose tel quel au
 * multiply : effacer un texel le ramène à α = 0, donc à un multiplicateur de 1 — l'identité.
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

/** L'air passe JUSTE au-dessus de la lumière : on regarde le monde éclairé À TRAVERS la brume.
 *  Un demi-rang — jamais assez pour franchir la couche suivante, toujours assez pour trancher. */
const AIR_OVER_LIGHT = 0.5

export class NightVeil {
  /** LA LUMIÈRE. RenderTexture en `MULTIPLY`, creusée par les Feux. */
  private rt: Phaser.GameObjects.RenderTexture
  /** La DynamicTexture SOUS le GameObject : en Phaser 4, TOUT le dessin (clear/fill/erase) se fait
   *  ICI, pas sur le GameObject `rt` (dont les proxis `fill` sont inertes). */
  private dt: Phaser.Textures.DynamicTexture
  /** L'AIR. Une teinte plate en blend NORMAL : rien à creuser, rien à redessiner — un rectangle
   *  dont on ne change que la couleur et l'opacité. Moins cher qu'une seconde RenderTexture. */
  private air: Phaser.GameObjects.Rectangle
  /** Brosse réutilisée comme tampon d'effacement (hors liste d'affichage). */
  private brush: Phaser.GameObjects.Image
  private w = 0
  private h = 0

  constructor(private scene: Phaser.Scene) {
    ensureHoleTexture(scene)
    this.w = scene.scale.width
    this.h = scene.scale.height
    this.rt = scene.add
      .renderTexture(0, 0, this.w, this.h)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
    this.dt = this.rt.texture as Phaser.Textures.DynamicTexture
    this.air = scene.add.rectangle(0, 0, this.w, this.h, 0x000000, 0).setOrigin(0, 0).setScrollFactor(0)
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
      this.air.setSize(sw, sh)
    }
    this.rt.setDepth(depth)

    // L'AIR — la brume, en blend NORMAL, PAR-DESSUS la lumière.
    this.air.setDepth(depth + AIR_OVER_LIGHT).setFillStyle(zone.color, zone.alpha)

    // LA LUMIÈRE — en MULTIPLY. Un plein jour (α = 0) laisse la RT VIDE, donc transparente, donc
    // un multiplicateur de 1 : l'identité exacte. On ne la rend même pas.
    this.rt.setVisible(hour.alpha > 0.001)
    if (hour.alpha <= 0.001) return
    // En Phaser 4, les opérations de DynamicTexture (clear/fill/erase) ne prennent effet qu'au
    // `render()` final qui les flushe — sans lui, le voile reste fantôme (le bug qu'on traquait).
    this.dt.clear()
    this.dt.fill(hour.color, hour.alpha)

    if (holes) {
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
    this.air.destroy()
    this.brush.destroy()
  }
}
