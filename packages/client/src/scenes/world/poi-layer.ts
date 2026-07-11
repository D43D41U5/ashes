/**
 * Rendu des LIEUX (les 26 POI) — leur corps, leur couronne, et leur nom.
 *
 * DEUX BANDES DE PROFONDEUR, et c'est tout l'enjeu du corps :
 *   - le CORPS est trié avec les acteurs (on passe derrière un Sanctuaire, puis
 *     devant) ;
 *   - la COURONNE — la part du lieu qui perce la canopée — se redessine dans la
 *     bande des houppiers. Sans elle, un lieu haut planté en forêt disparaît
 *     sous les arbres voisins : l'Arbre remarquable était invisible, recouvert
 *     par des houppiers de 32 px.
 *
 * LE NOM se lève au-dessus du lieu quand on approche : à peine lisible à la
 * limite de la vue, franc quand on y est. Il ne s'affiche que pour les lieux
 * CONNUS (`knownPois`) — le nommer avant qu'on l'ait vu trahirait le secret que
 * toute la carte plein écran s'emploie à garder.
 *
 * Purement visuel : la découverte, elle, est une décision de sim.
 */
import Phaser from 'phaser'
import { POI, type WorldMap } from '@braises/sim'
import { crownDepth, TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import { poiCrownKey, poiTextureKey, POI_ART } from './poi-art'
import type { Warp } from '../../render/warp'

/** Un lieu haut (l'Arbre remarquable : 100 px) pend loin au-dessus de ses pieds. */
const MARGIN_TILES = 10
/** Le nom : au-dessus de tout, y compris de la canopée — c'est une étiquette, pas un objet. */
const LABEL_DEPTH = 2_000_000
/** À cette distance (tuiles), le nom est à pleine échelle. Au-delà, il fond. */
const LABEL_NEAR = 5
const LABEL_MIN_SCALE = 0.55
const LABEL_MIN_ALPHA = 0.18

interface Placed {
  body: Phaser.GameObjects.Image
  crown?: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  /** poiId — l'index dans `map.zones`, l'identité d'un lieu. */
  poiId: number
  /** Pieds du sprite (tuiles) : c'est là qu'on mesure la distance au joueur. */
  tx: number
  ty: number
  /** Hauteur du sprite, en px : le nom se pose au-dessus. */
  h: number
}

export class PoiLayer {
  private readonly placed: Placed[] = []

  constructor(scene: Phaser.Scene, map: WorldMap, warp: Warp) {
    const art = new Map(POI_ART.map((a) => [a.slug, a]))
    map.zones.forEach((z, poiId) => {
      if (z.kind === undefined) return
      const a = art.get(z.kind)
      if (!a) return

      // Les pieds : bas-centre de l'empreinte. Le sprite monte de là.
      const feetX = z.x + z.w / 2
      const feetY = z.y + z.h
      const px = feetX * TILE_PX
      const py = feetY * TILE_PX - warp.lift(feetX, feetY)

      const body = scene.add.image(px, py, poiTextureKey(z.kind)).setOrigin(0.5, 1).setVisible(false)
      // Même bande que les acteurs et les nœuds : à pieds égaux, un lieu se
      // comporte comme un nœud (on passe devant en descendant vers le sud).
      body.setDepth(ySortDepth(feetY, TILE_PX, TIE_NODE))

      const entry: Placed = { body, label: makeLabel(scene, z.name, px, py - a.h), poiId, tx: feetX, ty: feetY, h: a.h }

      if (a.crown !== undefined) {
        // Ancrée par le HAUT, exactement là où commence le sprite complet :
        // les deux se superposent au pixel près sur la part commune.
        const crown = scene.add.image(px, py - a.h, poiCrownKey(z.kind)).setOrigin(0.5, 0).setVisible(false)
        crown.setDepth(crownDepth(feetY, TILE_PX))
        entry.crown = crown
      }
      this.placed.push(entry)
    })
  }

  /** `knownPois` vient du snapshot — le client ne décide pas ce qu'on connaît. */
  update(camera: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number, knownPois: readonly number[]): void {
    const v = camera.worldView
    const x0 = v.x / TILE_PX - MARGIN_TILES
    const y0 = v.y / TILE_PX - MARGIN_TILES
    const x1 = (v.x + v.width) / TILE_PX + MARGIN_TILES
    const y1 = (v.y + v.height) / TILE_PX + MARGIN_TILES

    for (const p of this.placed) {
      const onScreen = p.tx >= x0 && p.tx <= x1 && p.ty >= y0 && p.ty <= y1
      p.body.setVisible(onScreen)
      p.crown?.setVisible(onScreen)

      // Le nom : seulement si le lieu est CONNU, et seulement à l'écran.
      if (!onScreen || !knownPois.includes(p.poiId)) {
        p.label.setVisible(false)
        continue
      }
      const dx = p.tx - playerX
      const dy = p.ty - playerY
      const dist = Math.sqrt(dx * dx + dy * dy)
      // 1 au contact, 0 à la limite de la vue : le nom se lève à mesure qu'on approche.
      const near = 1 - clamp01((dist - LABEL_NEAR) / (POI.SIGHT_TILES - LABEL_NEAR))
      p.label
        .setVisible(true)
        .setAlpha(LABEL_MIN_ALPHA + (1 - LABEL_MIN_ALPHA) * near)
        .setScale(LABEL_MIN_SCALE + (1 - LABEL_MIN_SCALE) * near)
    }
  }

  destroy(): void {
    for (const p of this.placed) {
      p.body.destroy()
      p.crown?.destroy()
      p.label.destroy()
    }
    this.placed.length = 0
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Le nom d'un lieu, posé juste au-dessus de sa cime. */
function makeLabel(scene: Phaser.Scene, name: string, x: number, topY: number): Phaser.GameObjects.Text {
  return scene.add
    .text(x, topY - 6, name, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#f0ead8',
      stroke: '#14100c', // un liseré sombre : lisible sur la neige comme sous les arbres
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setDepth(LABEL_DEPTH)
    .setVisible(false)
    .setResolution(2) // le texte reste net quand la caméra zoome
}
