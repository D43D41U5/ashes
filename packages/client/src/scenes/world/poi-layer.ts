/**
 * Rendu des LIEUX (les 26 POI). Ils étaient invisibles dans le monde : des zones
 * nommées, une pastille sur la carte, et rien à voir en marchant.
 *
 * DEUX BANDES DE PROFONDEUR, et c'est tout l'enjeu :
 *   - le CORPS est trié avec les acteurs (on passe derrière un Sanctuaire, puis
 *     devant) ;
 *   - la COURONNE — la part du lieu qui perce la canopée — se redessine dans la
 *     bande des houppiers. Sans elle, un lieu haut planté en forêt disparaît
 *     sous les arbres voisins : l'Arbre remarquable, 116 px, était littéralement
 *     invisible, recouvert par des houppiers de 32.
 *
 * Les zones sont statiques et peu nombreuses (~80) : on crée les sprites une
 * fois, on ne fait ensuite que les rendre visibles à la vue caméra.
 *
 * Purement visuel : la collision d'un lieu, s'il en faut une un jour, sera une
 * décision de sim, pas de rendu.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { crownDepth, TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import { poiCrownKey, poiTextureKey, POI_ART } from './poi-art'
import type { Warp } from '../../render/warp'

/** Un lieu haut (l'Arbre remarquable : 116 px, plus de 7 tuiles) pend loin au-dessus de ses pieds. */
const MARGIN_TILES = 10

interface Placed {
  body: Phaser.GameObjects.Image
  crown?: Phaser.GameObjects.Image
  tx: number
  ty: number
}

export class PoiLayer {
  private readonly placed: Placed[] = []

  constructor(scene: Phaser.Scene, map: WorldMap, warp: Warp) {
    const art = new Map(POI_ART.map((a) => [a.slug, a]))
    for (const z of map.zones) {
      if (z.kind === undefined) continue
      const a = art.get(z.kind)
      if (!a) continue

      // Les pieds : bas-centre de l'empreinte. Le sprite monte de là.
      const feetX = z.x + z.w / 2
      const feetY = z.y + z.h
      const px = feetX * TILE_PX
      const py = feetY * TILE_PX - warp.lift(feetX, feetY)

      const body = scene.add
        .image(px, py, poiTextureKey(z.kind))
        .setOrigin(0.5, 1)
        .setVisible(false)
      // Même bande que les acteurs et les nœuds : à pieds égaux, un lieu se
      // comporte comme un nœud (on passe devant en descendant vers le sud).
      body.setDepth(ySortDepth(feetY, TILE_PX, TIE_NODE))

      const entry: Placed = { body, tx: feetX, ty: feetY }
      if (a.crown !== undefined) {
        // Ancrée par le HAUT, exactement là où commence le sprite complet :
        // les deux se superposent au pixel près sur la part commune.
        const crown = scene.add
          .image(px, py - a.h, poiCrownKey(z.kind))
          .setOrigin(0.5, 0)
          .setVisible(false)
        crown.setDepth(crownDepth(feetY, TILE_PX))
        entry.crown = crown
      }
      this.placed.push(entry)
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const v = camera.worldView
    const x0 = v.x / TILE_PX - MARGIN_TILES
    const y0 = v.y / TILE_PX - MARGIN_TILES
    const x1 = (v.x + v.width) / TILE_PX + MARGIN_TILES
    const y1 = (v.y + v.height) / TILE_PX + MARGIN_TILES
    for (const p of this.placed) {
      const on = p.tx >= x0 && p.tx <= x1 && p.ty >= y0 && p.ty <= y1
      p.body.setVisible(on)
      p.crown?.setVisible(on)
    }
  }

  destroy(): void {
    for (const p of this.placed) {
      p.body.destroy()
      p.crown?.destroy()
    }
    this.placed.length = 0
  }
}
