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
import type { WorldMap } from '@ashes/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { FAMILLES, GRAIN_CELLS, GRAIN_TILES, familleDe, grainFacteur, indexFamille } from '../../render/grain-sol'
import { gridMesh } from '../../render/ground-mesh'
import type { Warp } from '../../render/warp'

export class GroundLayer {
  private mesh: Phaser.GameObjects.Mesh2D
  /** La passe de matière : MULTIPLY au-dessus du bake, sous l'eau (spec da-feeling R19). */
  private grain?: Phaser.GameObjects.Mesh2D
  private grainCle?: string

  constructor(
    private scene: Phaser.Scene,
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

    // LA PASSE DE MATIÈRE suit la même fenêtre, mais ses UV visent le BLOC DE LA FAMILLE
    // du terrain de chaque tuile — c'est là que se joue « une matière par biome ». À
    // l'intérieur d'une famille la continuité tient (l'UV suit toujours `tx % GRAIN_TILES`) ;
    // une tuile sans famille (eau, falaise, mur) n'émet AUCUN quad : sa couche propre la
    // recouvre, du grain dessous serait du coût sans image.
    if (this.grain) {
      const vs: number[] = []
      const is: number[] = []
      const largeur = GRAIN_TILES * FAMILLES.length
      let n = 0
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const f = familleDe(this.map.terrain[ty * width + tx] ?? 0)
          if (!f) continue
          const h = this.warp.lift(tx, ty)
          const x0 = tx * TILE_PX
          const x1 = x0 + TILE_PX
          const y0 = ty * TILE_PX - h
          const y1 = y0 + TILE_PX
          const u0 = (indexFamille(f) * GRAIN_TILES + (tx % GRAIN_TILES)) / largeur
          const v0 = (ty % GRAIN_TILES) / GRAIN_TILES
          const u1 = u0 + 1 / largeur
          const v1 = v0 + 1 / GRAIN_TILES
          vs.push(x0, y0, u0, v0, x1, y0, u1, v0, x1, y1, u1, v1, x0, y1, u0, v1)
          is.push(n, n + 1, n + 2, 0, n, n + 2, n + 3, 0)
          n += 4
        }
      }
      this.grain.vertices = vs
      this.grain.indices = is
    }
  }

  /** Cuit l'ATLAS DES MATIÈRES — un bloc de 64×64 cellules par famille, côte à côte, à
   *  1 px par cellule de 4 px monde. NEAREST, comme le bake : en linéaire, deux blocs
   *  voisins baveraient l'un sur l'autre et une congère prendrait du grain d'éboulis. */
  poserMatiere(seed: number): void {
    const sc = this.scene
    const largeur = GRAIN_CELLS * FAMILLES.length
    // LE SEED EST DANS LA CLÉ, et il doit y être : une nouvelle Veillée relance la scène SANS
    // recharger la page (le scénario `sauvegarde` l'affirme : une seule navigation). Une clé
    // fixe ferait hériter l'atlas de la vallée précédente, sous la compensation du seed NEUF —
    // deux vérités qui divergent en silence, exactement ce que `moyenneFamille` doit empêcher.
    const cle = `grain-sol-${seed >>> 0}`
    if (!sc.textures.exists(cle)) {
      const g = sc.add.graphics()
      FAMILLES.forEach((f, bloc) => {
        for (let cy = 0; cy < GRAIN_CELLS; cy++) {
          for (let cx = 0; cx < GRAIN_CELLS; cx++) {
            const v = Math.round(255 * grainFacteur(cx, cy, f, seed))
            g.fillStyle((v << 16) | (v << 8) | v)
            g.fillRect(bloc * GRAIN_CELLS + cx, cy, 1, 1)
          }
        }
      })
      g.generateTexture(cle, largeur, GRAIN_CELLS)
      g.destroy()
      sc.textures.get(cle).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    this.grainCle = cle
    this.grain = sc.add.mesh2d(0, 0, cle, [], [], false)
      .setDepth(GROUND_MAP_DEPTH + 0.1) // au-dessus du bake, sous l'eau (+0.25)
    this.grain.setBlendMode(Phaser.BlendModes.MULTIPLY)
  }

  /** Combien de quads la passe de matière a émis sur la vue courante — la sonde du
   *  scénario smoke `matiere` : une table de familles devenue vide rendrait 0 en silence. */
  grainQuads(): number {
    return this.grain ? this.grain.vertices.length / 16 : 0
  }

  destroy(): void {
    this.mesh.destroy()
    this.grain?.destroy()
    // ON REND L'ATLAS, pas seulement le maillage. La sonde à fuites du scénario `retour` ne
    // l'aurait pas vu — sa clé porte le seed, donc une vallée neuve n'entre jamais en collision
    // et rien ne se signale. C'est exactement le genre de fuite qu'un test ne rattrape pas :
    // elle est silencieuse par construction. Une couche rend ce qu'elle a créé.
    if (this.grainCle) this.scene.textures.remove(this.grainCle)
  }
}
