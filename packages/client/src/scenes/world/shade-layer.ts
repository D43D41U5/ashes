/**
 * L'OMBRE DU RELIEF, dynamique selon le soleil de l'heure courante. Une couche
 * de quads d'assombrissement (blend MULTIPLY) posée SUR le sol, fenêtrée à la
 * vue (~800 tuiles/frame, comme les nœuds) — donc pas de re-bake de la texture
 * (qui coûte ~1,6 s). Le hillshade cuit a été retiré du bake au profit de ceci.
 *
 * Les quads épousent la déformation du sol (mêmes coins soulevés par `lift`) et
 * ne font qu'ASSOMBRIR (facteur ≤ 1) le versant qui tourne le dos au soleil —
 * c'est une ombre, pas un rehaut. AUCUNE logique de jeu ici.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { reliefShadow, type SampleElevation } from '../../render/hillshade'
import { sunDirection } from '../../render/lighting'
import type { Warp } from '../../render/warp'

/** Juste au-dessus du sol (−1), sous tout ce qui a des pieds (≥ 2). */
const SHADE_DEPTH = GROUND_MAP_DEPTH + 0.5

export class ShadeLayer {
  private g: Phaser.GameObjects.Graphics
  private sample: SampleElevation

  constructor(
    scene: Phaser.Scene,
    private map: WorldMap,
    private warp: Warp,
  ) {
    this.g = scene.add.graphics().setDepth(SHADE_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY)
    const { width, height } = map
    this.sample = (tx, ty) => {
      const cx = tx < 0 ? 0 : tx >= width ? width - 1 : tx
      const cy = ty < 0 ? 0 : ty >= height ? height - 1 : ty
      return map.elevation?.[cy * width + cx] ?? 0
    }
  }

  /** Redessine l'ombre de la fenêtre visible pour le soleil de `hour`. */
  render(camera: Phaser.Cameras.Scene2D.Camera, hour: number): void {
    this.g.clear()
    const sun = sunDirection(hour)
    if (sun.x === 0 && sun.y === 0) return // nuit / zénith : pas d'ombre portée
    const { width, height } = this.map
    const v = camera.worldView
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 1)
    const L = (x: number, y: number): number => this.warp.lift(x, y)
    const g = this.g
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const s = reliefShadow(tx, ty, this.sample, sun.x, sun.y)
        if (s >= 0.999) continue // pas d'ombre ici → ne rien peindre
        const c = Math.round(255 * s)
        // Coins soulevés, identiques à ceux du sol (gridMesh) → l'ombre colle.
        // Deux triangles (nombres bruts, aucune allocation par frame).
        const ax = tx * TILE_PX
        const bx = (tx + 1) * TILE_PX
        const ay = ty * TILE_PX
        const by = (ty + 1) * TILE_PX
        const y0 = ay - L(tx, ty)
        const y1 = ay - L(tx + 1, ty)
        const y2 = by - L(tx + 1, ty + 1)
        const y3 = by - L(tx, ty + 1)
        g.fillStyle(Phaser.Display.Color.GetColor(c, c, c), 1)
        g.fillTriangle(ax, y0, bx, y1, bx, y2)
        g.fillTriangle(ax, y0, bx, y2, ax, y3)
      }
    }
  }

  destroy(): void {
    this.g.destroy()
  }
}
