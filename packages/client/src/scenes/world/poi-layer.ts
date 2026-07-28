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
import { BUILT_KINDS, POI, type WorldMap } from '@ashes/sim' // POI : SIGHT_TILES (labels) + SET_PIECE_KINDS (R10)
import { crownDepth, TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import { poiCrownKey, poiTextureKey, POI_ART } from './poi-art'
import { erratiqueVariantFor, litErratiqueKey, POI_LIT_KINDS, poiLitCrownKey, poiLitKey, poiLitMirrorKey } from '../../render/poi-lit'
import type { Warp } from '../../render/warp'
import { FONT } from '../ui/typography'

/** Un lieu haut (l'Arbre remarquable : 100 px) pend loin au-dessus de ses pieds. */
const MARGIN_TILES = 10
/** Le nom : au-dessus de tout, y compris de la canopée — c'est une étiquette, pas un objet. */
const LABEL_DEPTH = 2_000_000
/** À cette distance (tuiles), le nom est à pleine échelle. Au-delà, il fond. */
const LABEL_NEAR = 5
const LABEL_MIN_SCALE = 0.55
const LABEL_MIN_ALPHA = 0.18

interface Placed {
  /** Absent pour un SET-PIECE (spec t0-exploration R10) : son corps est son TERRAIN — le sol
   *  peint par le worldgen EST le lieu, l'étiquette seule flotte dessus. */
  body?: Phaser.GameObjects.Image
  crown?: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  /** poiId — l'index dans `map.zones`, l'identité d'un lieu. */
  poiId: number
  /** Pieds du sprite (tuiles) : c'est là qu'on mesure la distance au joueur. */
  tx: number
  ty: number
  /** Hauteur du sprite, en px : le nom se pose au-dessus. */
  h: number
  /** Rendu par le pipeline d'éclairage dynamique (albédo `_lit` + normal map) : on réarme
   *  `setLighting` à chaque frame comme les autres couches. Aujourd'hui : le bloc erratique. */
  lit?: boolean
  /** Le kind — de quoi re-swapper peint↔lit quand le toggle debug bascule. */
  kind?: string
  /** L'EMPREINTE (tuiles), pour un SET-PIECE : culling et fondu du nom se mesurent AU RECT —
   *  exactement le clamp de la découverte sim (`advancePois`). Mesuré par la revue : au centre,
   *  le nom du Bois Noir (48×40) s'éteignait alors qu'on était DEDANS (dist 24 > les seuils du
   *  fondu, et les rangées nord/sud sortaient de la fenêtre d'écran du centre). */
  rect?: { x: number; y: number; w: number; h: number }
}

export class PoiLayer {
  private readonly placed: Placed[] = []
  /** Le décor DÉRIVÉ des lieux (les pierres du Cercle) : détruit avec la couche. */
  private readonly decor: Phaser.GameObjects.Image[] = []
  private readonly decorMir: boolean[] = []
  private lastLighting: boolean | null = null
  /** Éclairage dynamique armé ? Posé par WorldScene, comme pour le clutter. Défaut : allumé (mode nominal). */
  lighting = true

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

      // UN SET-PIECE N'A PAS DE CORPS (spec t0-exploration R10) : le Bois Noir EST ses arbres,
      // la Combe EST son marais — un sprite-centre mentirait. L'étiquette seule, posée au
      // CENTRE de l'empreinte (les pieds d'une zone de 40 tuiles seraient à un demi-écran du
      // cœur), et le mécanisme de découverte inchangé.
      // UN LIEU BÂTI N'A PAS DE CORPS PEINT NON PLUS : son corps, ce sont ses MURS, posés
      // comme des structures et dessinés par `syncStructures`. Un sprite en plus les
      // doublerait. Même règle qu'un set-piece, autre matière (`poi-batis.ts`).
      if (POI.SET_PIECE_KINDS.includes(z.kind) || BUILT_KINDS.includes(z.kind)) {
        const cy = (z.y + z.h / 2) * TILE_PX - warp.lift(feetX, z.y + z.h / 2)
        this.placed.push({
          label: makeLabel(scene, z.name, px, cy - 10),
          poiId, tx: feetX, ty: z.y + z.h / 2, h: 0,
          rect: { x: z.x, y: z.y, w: z.w, h: z.h },
        })
        // LE CERCLE A SES PIERRES — sinon c'est une fleuraie avec un nom, le syndrome exact du
        // « Verger vide » que le projet a déjà payé. Une COURONNE de menhirs (la texture de la
        // Pierre levée, déclinée en échelle et en miroir), dérivée du rectangle : déterministe
        // des deux côtés sans une donnée de plus. L'anneau est de l'ART, pas une forme de carte
        // — R32 contraint le sol, pas les silhouettes qu'on y dresse.
        if (z.kind === 'cercle_pierres') {
          const rx = (z.w / 2 - 2.5) * TILE_PX
          const ry = (z.h / 2 - 2.5) * 0.86
          const N = 9
          for (let k = 0; k < N; k++) {
            const a = (k / N) * Math.PI * 2 - Math.PI / 2
            const sx = (z.x + z.w / 2) * TILE_PX + Math.cos(a) * rx
            const sty = z.y + z.h / 2 + Math.sin(a) * ry
            const sy = sty * TILE_PX - warp.lift(sx / TILE_PX, sty)
            // _lit / _lit_m pré-retournée (R5) : un setFlipX casserait le canal X de la normale.
            const mir = k % 2 === 1
            const stone = scene.add
              .image(sx, sy, mir ? poiLitMirrorKey('pierre_levee') : poiLitKey('pierre_levee'))
              .setOrigin(0.5, 1)
              .setScale(0.66 + ((k * 37) % 5) * 0.05)
            stone.setLighting(this.lighting)
            stone.setDepth(ySortDepth(sty, TILE_PX, TIE_NODE))
            this.decor.push(stone)
            this.decorMir.push(mir)
          }
        }
        return
      }

      // LA DA CUBIQUE SUIT LA TEXTURE (da-feeling R8) : l'erratique garde ses 3 variantes
      // réparties par poiId ; tout kind présent dans POI_LIT_KINDS bascule sur son `_lit` —
      // aucune liste à tenir à jour ici, le câblage vient de la table des formes.
      const lit = z.kind === 'erratique' || POI_LIT_KINDS.has(z.kind)
      const key = z.kind === 'erratique'
        ? litErratiqueKey(erratiqueVariantFor(poiId))
        : POI_LIT_KINDS.has(z.kind) ? poiLitKey(z.kind) : poiTextureKey(z.kind)
      const body = scene.add.image(px, py, key).setOrigin(0.5, 1).setVisible(false)
      if (lit) body.setLighting(this.lighting)
      // Même bande que les acteurs et les nœuds : à pieds égaux, un lieu se
      // comporte comme un nœud (on passe devant en descendant vers le sud).
      body.setDepth(ySortDepth(feetY, TILE_PX, TIE_NODE))

      const entry: Placed = { body, label: makeLabel(scene, z.name, px, py - a.h), poiId, tx: feetX, ty: feetY, h: a.h, lit, kind: z.kind }

      if (a.crown !== undefined) {
        // Ancrée par le HAUT, exactement là où commence le sprite complet :
        // les deux se superposent au pixel près sur la part commune.
        const crownTex = POI_LIT_KINDS.has(z.kind) ? poiLitCrownKey(z.kind) : poiCrownKey(z.kind)
        const crown = scene.add.image(px, py - a.h, crownTex).setOrigin(0.5, 0).setVisible(false)
        if (lit) crown.setLighting(this.lighting)
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

    // LE TOGGLE RE-SWAPPE LES TEXTURES (revue du 26/07 : « éteint = comme avant » doit être
    // vrai — un albédo aplati sans lumière est un sprite délavé, pas l'art peint). Une fois
    // par changement, pas par frame.
    if (this.lastLighting !== this.lighting) {
      this.lastLighting = this.lighting
      for (const p of this.placed) {
        if (!p.lit || !p.body || p.kind === undefined) continue
        const kk = p.kind
        const litKey = kk === 'erratique' ? litErratiqueKey(erratiqueVariantFor(p.poiId)) : poiLitKey(kk)
        p.body.setTexture(this.lighting ? litKey : poiTextureKey(kk))
        p.crown?.setTexture(this.lighting ? poiLitCrownKey(kk) : poiCrownKey(kk))
      }
      for (let i = 0; i < this.decor.length; i++) {
        const st = this.decor[i]!
        st.setTexture(this.lighting
          ? (this.decorMir[i] ? poiLitMirrorKey('pierre_levee') : poiLitKey('pierre_levee'))
          : poiTextureKey('pierre_levee'))
        st.setFlipX(!this.lighting && this.decorMir[i] === true) // le flip n'est licite qu'en peint
        st.setLighting(this.lighting)
      }
    }
    for (const p of this.placed) {
      // Un SET-PIECE se juge à son EMPREINTE (le rect chevauche-t-il la vue ?) ; un lieu à
      // sprite, à ses pieds — comme avant.
      const onScreen = p.rect
        ? p.rect.x <= x1 && p.rect.x + p.rect.w >= x0 && p.rect.y <= y1 && p.rect.y + p.rect.h >= y0
        : p.tx >= x0 && p.tx <= x1 && p.ty >= y0 && p.ty <= y1
      p.body?.setVisible(onScreen)
      p.crown?.setVisible(onScreen)
      if (p.lit && onScreen) {
        p.body?.setLighting(this.lighting) // réarmé comme les autres couches (toggle debug)
        p.crown?.setLighting(this.lighting)
      }

      // Le nom : seulement si le lieu est CONNU, et seulement à l'écran.
      if (!onScreen || !knownPois.includes(p.poiId)) {
        p.label.setVisible(false)
        continue
      }
      // La distance au lieu : au RECT pour un set-piece (0 dedans → nom plein), au centre sinon.
      const dx = p.rect ? Math.max(p.rect.x - playerX, 0, playerX - (p.rect.x + p.rect.w)) : p.tx - playerX
      const dy = p.rect ? Math.max(p.rect.y - playerY, 0, playerY - (p.rect.y + p.rect.h)) : p.ty - playerY
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
      p.body?.destroy()
      p.crown?.destroy()
      p.label.destroy()
    }
    this.placed.length = 0
    for (const d of this.decor) d.destroy()
    this.decor.length = 0
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Le nom d'un lieu, posé juste au-dessus de sa cime. */
function makeLabel(scene: Phaser.Scene, name: string, x: number, topY: number): Phaser.GameObjects.Text {
  return scene.add
    .text(x, topY - 6, name, {
      fontFamily: FONT,
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
