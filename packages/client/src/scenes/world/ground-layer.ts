/**
 * Le sol qui se DÉFORME : un `Mesh2D` dont les sommets sont soulevés par
 * l'élévation (spec relief-continu §4.1). Remplace l'image `map-demo` plate,
 * mais RÉUTILISE sa texture (le bake 1 px/tuile) — UV-mappée sur la grille
 * déformée. En filtrage linéaire, les couleurs du bake s'interpolent sur les
 * versants → ombrage lisse. De vraies tuiles plus tard = un échange de texture.
 *
 * Rendu FENÊTRÉ à la vue (comme les nœuds) : coût borné à l'écran. Les sommets
 * sont aux coins ENTIERS (partagés entre tuiles voisines) → surface continue,
 * sans couture. AUCUNE logique de jeu ici — rendu pur d'état reçu.
 *
 * La géométrie (`gridMesh`) est PURE et vit dans `render/ground-mesh.ts` (donc
 * testable en Node) ; ce fichier importe Phaser et n'est lui-même pas testé
 * directement — même partition pur/Phaser que le reste du rendu.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { gridMesh } from '../../render/ground-mesh'
import type { Warp } from '../../render/warp'

export class GroundLayer {
  private mesh: Phaser.GameObjects.Mesh2D

  constructor(
    scene: Phaser.Scene,
    private map: WorldMap,
    private warp: Warp,
    textureKey: string,
  ) {
    // flipV : nos UV sont top-down (v = gy/mapH, comme l'indexation du bake),
    // or GL attend des coordonnées bottom-up → sans ce flip le sol est RETOURNÉ
    // verticalement (le contenu ne correspond plus à la carte ni à la minimap).
    this.mesh = scene.add.mesh2d(0, 0, textureKey, [], [], true).setDepth(GROUND_MAP_DEPTH)
    // NEAREST : le bake fait 1 px/tuile — en LINÉAIRE il baverait sur toute la
    // tuile (sol flou, biomes décalés d'un demi-texel vs la minimap). Nearest
    // rend chaque tuile en aplat net, aligné à la grille. Le lissage viendra
    // avec un art tuilé haute résolution, pas avec ce bake (spec §7).
    scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST)
  }

  /** Reconstruit la grille de la fenêtre visible, chaque frame. */
  render(camera: Phaser.Cameras.Scene2D.Camera): void {
    const { width, height } = this.map
    const v = camera.worldView
    // Carte plate : le sol ne se soulève plus, une simple marge d'une tuile suffit dans les deux sens.
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 1)
    const m = gridMesh(tx0, ty0, tx1, ty1, (x, y) => this.warp.lift(x, y), TILE_PX, width, height)
    // Réassignation directe : par défaut Mesh2D lit `vertices`/`indices` à
    // chaque rendu (pas d'`useOrderedIndices` sans appel explicite à
    // `buildOrderedIndices` — jamais fait ici, la topologie change par frame).
    // Aucun flag « dirty » à lever (vérifié : phaser.d.ts, classe Mesh2D).
    this.mesh.vertices = m.vertices
    this.mesh.indices = m.indices
  }

  destroy(): void {
    this.mesh.destroy()
  }
}
