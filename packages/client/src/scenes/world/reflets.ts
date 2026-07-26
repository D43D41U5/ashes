/**
 * LES REFLETS DU MONDE (spec eau-vivante R13) — l'eau redit les silhouettes verticales,
 * tête-bêche, sombres, découpées à la ligne d'eau.
 *
 * SANS MASQUE : Phaser 4 n'a pas de BitmapMask (seul GeometryMask existe — et la mémoire
 * projet l'a mesuré inerte sur les enfants de conteneur). Le repli consigné de la spec est
 * DEVENU la solution : la géométrie du monde est RECTILIGNE (R32), donc la frontière d'eau
 * sous un sujet est localement une ligne HORIZONTALE de tuiles — un `setCrop` vertical
 * découpe le reflet à la course d'eau exacte (run de tuiles d'eau vers le sud, capé).
 *
 * Un POOL par frame (le patron de renderNodes/clutter) : `begin()` au début du tick de
 * rendu, chaque source appelle `miroir(...)`, `end()` éteint le surplus. Le reflet est
 * assombri par TEINTE (multiplicative — vers l'eau), alpha par paliers, balancé d'un
 * pixel par pas de temps (quantifié — jamais un tremblé continu à résolution écran).
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'

/** Au-dessus de l'eau (−0,75) et des feuilles (−0,43), sous tout le monde trié (≥ 0). */
const REFLET_DEPTH = GROUND_MAP_DEPTH + 0.28
/** Course d'eau maximale utile sous un sujet, en tuiles (au-delà le reflet meurt seul). */
const RUN_MAX = 4
/** La teinte du reflet : multiplicative, vers l'eau — un monde noyé, pas un décalque. */
const TEINTE = 0x4a6a8a
const MAX_REFLETS = 48

const SHALLOW = 4
const DEEP = 6

export class RefletsLayer {
  private readonly pool: Phaser.GameObjects.Image[] = []
  private used = 0
  /** Course d'eau vers le sud par tuile de départ — le terrain est statique, on met en cache. */
  private readonly runs = new Map<number, number>()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
  ) {}

  private eau(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return false
    const t = this.map.terrain[ty * this.map.width + tx]
    return t === SHALLOW || t === DEEP
  }

  /** Combien de tuiles d'EAU consécutives à partir de (tx, ty) vers le sud (0 si terre). */
  runSud(tx: number, ty: number): number {
    const key = ty * this.map.width + tx
    const connu = this.runs.get(key)
    if (connu !== undefined) return connu
    let n = 0
    while (n < RUN_MAX && this.eau(tx, ty + n)) n++
    this.runs.set(key, n)
    return n
  }

  begin(): void {
    this.used = 0
  }

  /**
   * Pose le reflet d'un sujet dont les PIEDS sont à (px, py) monde. `coupeBasTexels` :
   * rangs de frame déjà coupés au sujet (l'immersion) — le reflet les ignore aussi.
   * Ne fait rien si aucune eau ne s'étend sous les pieds.
   */
  miroir(
    textureKey: string,
    flipX: boolean,
    px: number,
    py: number,
    displayW: number,
    displayH: number,
    now: number,
    coupeBasTexels = 0,
  ): void {
    if (this.used >= MAX_REFLETS) return
    const tx = Math.floor(px / TILE_PX)
    const ty = Math.floor(py / TILE_PX)
    // Le reflet vit SOUS les pieds : la première tuile à inspecter est celle des pieds
    // (un acteur immergé) ou la suivante (un sujet posé sur la berge).
    const dep = this.eau(tx, ty) ? ty : ty + 1
    const run = this.runSud(tx, dep)
    if (run <= 0) return
    // Hauteur visible : jusqu'au bout de la course d'eau, jamais plus haut que le sujet.
    const eauPx = dep * TILE_PX - py + run * TILE_PX
    const visible = Math.min(displayH, Math.max(0, eauPx - 2))
    if (visible < 4) return

    let img = this.pool[this.used]
    if (!img) {
      img = this.scene.add.image(0, 0, textureKey).setOrigin(0.5, 0)
      this.pool[this.used] = img
    }
    this.used++
    img.setTexture(textureKey)
    const frame = img.frame
    const scaleY = displayH / frame.height
    // La découpe : on retire au FRAME ses rangs du BAS (déjà coupés au sujet — l'immersion)
    // et ses rangs du HAUT (la part du reflet qui déborderait la course d'eau). Avec flipY,
    // les rangs hauts du frame sont le BAS visuel du reflet — le lointain, côté large.
    const coupeLoin = Math.max(0, Math.round((displayH - visible) / scaleY))
    const hFrame = Math.max(1, frame.height - coupeLoin - coupeBasTexels)
    img.setCrop(0, coupeLoin, frame.width, hFrame)
    // Le balancement : UN pixel, par pas de temps quantifié — jamais un tremblé continu.
    // Les rangs coupés au sujet (l'immersion) laissent, une fois retournés, un VIDE en haut
    // du reflet (le crop ne déplace rien) : on REMONTE l'objet d'autant — le torse réfléchi
    // colle à la ligne de flottaison, le vide se perd sous le sujet.
    const balance = Math.floor(now / 420 + px * 0.03) % 2 === 0 ? 0 : 1
    img.setPosition(px + balance, py + 1 - coupeBasTexels * scaleY)
    img.setDisplaySize(displayW, displayH)
    img.setFlipX(flipX)
    img.setFlipY(true)
    img.setTint(TEINTE)
    img.setAlpha(0.3)
    img.setDepth(REFLET_DEPTH)
    img.setVisible(true)
  }

  end(): void {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]?.setVisible(false)
  }

  /** Sonde du smoke : combien de reflets vivent cette frame. */
  get vivants(): number {
    return this.used
  }

  destroy(): void {
    for (const img of this.pool) img.destroy()
    this.pool.length = 0
  }
}
