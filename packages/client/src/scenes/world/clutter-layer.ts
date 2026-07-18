/**
 * Rendu du décor cosmétique : sprites POOLÉS, culled à la vue caméra, avec LOD
 * (coupé quand on dézoome trop). Purement visuel — aucune collision (INV-1).
 * La décision « quel prop sur quelle tuile » vit dans render/clutter.ts (pur) ;
 * ici on ne fait que du pooling Phaser et du placement.
 */
import Phaser from 'phaser'
import { poiClearings, type WorldMap } from '@braises/sim'
import { clutterDepth, GROUND_PROP_DEPTH, TILE_PX } from '../../render/framing'
import { clutterAt, type PropKind, type SampleTerrain } from '../../render/clutter'
import { windSway, WIND_TAKE } from '../../render/wind'
import type { Warp } from '../../render/warp'

const CLUTTER_MIN_ZOOM = 1.2 // en-deçà, on coupe le décor (props illisibles) : le canopy prend le relais
/** Props RAMPANTS : des textures de sol, sans hauteur. Ils restent sous la bande
 * de tri — un caillou ne doit pas recouvrir les pieds de qui passe au nord. */
const FLAT_PROPS = new Set<PropKind>(['pebbles', 'lichen', 'sphagnum'])
const CLUTTER_TINT = 0xbfc4bd // léger assombrissement/désaturation (INV-2)
const MARGIN_TILES = 2 // marge de culling pour éviter le pop en bordure d'écran
const MAX_SPRITES = 4000 // borne dure de perf (cap silencieux : on log si dépassé)

export class ClutterLayer {
  private readonly pool: Phaser.GameObjects.Image[] = []
  private readonly sample: SampleTerrain
  /** Les clairières des lieux — MÊME fonction que celle qui bannit les nœuds côté
   *  sim (`poiClearings`). Une source unique : deux calculs divergents feraient
   *  pousser des touffes dans une clairière vide d'arbres. */
  private readonly cleared: Set<number>
  private warned = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    private readonly seed: number,
    private readonly warp: Warp,
  ) {
    this.sample = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
      return map.terrain[ty * map.width + tx] ?? -1
    }
    this.cleared = poiClearings(map)
  }

  /** LE VENT DE LA SIM (spec chasse C17) : les herbes se couchent dans SON sens —
   *  c'est ce qui rend la règle de l'odorat lisible sans une seule ligne d'UI. */
  wind: { x: number; y: number } = { x: 1, y: 0 }

  update(camera: Phaser.Cameras.Scene2D.Camera, now: number): void {
    let used = 0
    if (camera.zoom >= CLUTTER_MIN_ZOOM) {
      const v = camera.worldView
      const x0 = Math.max(0, Math.floor(v.x / TILE_PX) - MARGIN_TILES)
      const y0 = Math.max(0, Math.floor(v.y / TILE_PX) - MARGIN_TILES)
      const x1 = Math.min(this.map.width - 1, Math.ceil((v.x + v.width) / TILE_PX) + MARGIN_TILES)
      // Carte plate : plus de lift, donc une simple marge de pop symétrique suffit.
      const y1 = Math.min(
        this.map.height - 1,
        Math.ceil((v.y + v.height) / TILE_PX) + MARGIN_TILES,
      )
      for (let ty = y0; ty <= y1 && used < MAX_SPRITES; ty++) {
        for (let tx = x0; tx <= x1 && used < MAX_SPRITES; tx++) {
          if (this.cleared.has(ty * this.map.width + tx)) continue // la clairière d'un lieu : rien n'y pousse
          const terrain = this.map.terrain[ty * this.map.width + tx] ?? -1
          const props = clutterAt(tx, ty, terrain, this.seed, this.sample)
          for (const p of props) {
            if (used >= MAX_SPRITES) break
            const sprite = this.acquire(used++)
            const feetY = ty + 1 + p.oy
            const feetX = tx + 0.5 + p.ox
            sprite.setTexture(`cl-${p.kind}`)
            // Les pieds se posent sur le sol DÉFORMÉ, comme le maillage du sol et
            // les acteurs. Sans ce lift, un prop est dessiné à sa position PLATE :
            // sur un versant à 0,8 d'élévation il glisse de 120 px vers le bas —
            // les touffes de la berge finissent par flotter sur l'eau.
            sprite.setPosition(feetX * TILE_PX, feetY * TILE_PX - this.warp.lift(feetX, feetY))
            sprite.setDisplaySize(TILE_PX * p.scale, TILE_PX * p.scale)
            sprite.setFlipX(p.mirror)
            // Le vent. L'origine est aux PIEDS (0.5, 1) : une rotation fait donc
            // plier le brin depuis sa base, comme une tige — et non tourner comme
            // une aiguille d'horloge. Le rocher a un `take` de 0 : il ne bouge pas.
            sprite.setRotation(windSway(feetX, feetY, now, WIND_TAKE[p.kind] ?? 0, this.wind))
            // Un conifère trie avec les acteurs — on passe derrière, puis devant.
            // Le tri se fait sur les pieds RÉELS : deux props d'une même rangée
            // s'ordonnent par leur décalage sub-tuile, pas par l'ordre du pool.
            // (INV-2 : ce qui distingue le décor des nœuds est la teinte, pas la
            // couche ; à pieds égaux le nœud passe devant.)
            sprite.setDepth(FLAT_PROPS.has(p.kind) ? GROUND_PROP_DEPTH : clutterDepth(feetY, TILE_PX))
            sprite.setVisible(true)
          }
        }
      }
      if (used >= MAX_SPRITES && !this.warned) {
        console.warn(`[clutter] cap de ${MAX_SPRITES} sprites atteint — décor tronqué à la vue`)
        this.warned = true
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false)
  }

  private acquire(i: number): Phaser.GameObjects.Image {
    let sprite = this.pool[i]
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, 'cl-grass_tuft').setOrigin(0.5, 1).setTint(CLUTTER_TINT)
      this.pool[i] = sprite
    }
    return sprite
  }

  destroy(): void {
    for (const s of this.pool) s.destroy()
    this.pool.length = 0
  }
}
