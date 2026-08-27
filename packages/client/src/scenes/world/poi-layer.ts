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
 * LE NOM NE FLOTTE PLUS (décision d'Alexis, 2026-08-25). Chaque lieu connu
 * portait ici une étiquette permanente, qui montait en encre et en échelle à
 * mesure qu'on approchait — jusqu'à cinq ou six noms suspendus au-dessus du
 * paysage en même temps, une couche de HUD par-dessus le monde. Le modèle est
 * désormais celui de The Long Dark : un lieu s'ANNONCE UNE FOIS, quand on y
 * arrive (bandeau de découverte, `ui/bandeaux`), puis se tait — son nom se
 * relit sur la carte, dans sa fiche, et dans la barre haute quand on y est.
 * Le monde reste le monde ; c'est l'écran qui parle, et une seule fois.
 *
 * Purement visuel : la découverte, elle, est une décision de sim.
 */
import Phaser from 'phaser'
import { BUILT_KINDS, POI, type WorldMap } from '@ashes/sim' // POI : SET_PIECE_KINDS (R10)
import { crownDepth, TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import { poiCrownKey, poiTextureKey, POI_ART } from './poi-art'
import { erratiqueVariantFor, litErratiqueKey, POI_LIT_KINDS, poiLitCrownKey, poiLitKey, poiLitMirrorKey } from '../../render/poi-lit'
import type { Warp } from '../../render/warp'

/** Un lieu haut (l'Arbre remarquable : 100 px) pend loin au-dessus de ses pieds. */
const MARGIN_TILES = 10

interface Placed {
  body: Phaser.GameObjects.Image
  crown?: Phaser.GameObjects.Image
  /** poiId — l'index dans `map.zones`, l'identité d'un lieu. */
  poiId: number
  /** Pieds du sprite (tuiles) : c'est là qu'on juge s'il est à l'écran. */
  tx: number
  ty: number
  /** Rendu par le pipeline d'éclairage dynamique (albédo `_lit` + normal map) : on réarme
   *  `setLighting` à chaque frame comme les autres couches. Aujourd'hui : le bloc erratique. */
  lit?: boolean
  /** Le kind — de quoi re-swapper peint↔lit quand le toggle debug bascule. */
  kind?: string
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
      // la Combe EST son marais — un sprite-centre mentirait. UN LIEU BÂTI non plus : son
      // corps, ce sont ses MURS, posés comme des structures et dessinés par `syncStructures`
      // (`poi-batis.ts`). Ces deux familles n'avaient ici qu'une ÉTIQUETTE ; depuis qu'elle a
      // disparu, elles n'ont plus rien à poser — sauf le décor dérivé, juste dessous.
      if (POI.SET_PIECE_KINDS.includes(z.kind) || BUILT_KINDS.includes(z.kind)) {
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

      const entry: Placed = { body, poiId, tx: feetX, ty: feetY, lit, kind: z.kind }

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

  /** Le culling, et rien d'autre : depuis que le nom ne flotte plus, cette couche n'a plus
   *  besoin de savoir où est le joueur ni ce qu'il connaît. */
  update(camera: Phaser.Cameras.Scene2D.Camera): void {
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
        if (!p.lit || p.kind === undefined) continue
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
      const onScreen = p.tx >= x0 && p.tx <= x1 && p.ty >= y0 && p.ty <= y1
      p.body.setVisible(onScreen)
      p.crown?.setVisible(onScreen)
      if (p.lit && onScreen) {
        p.body.setLighting(this.lighting) // réarmé comme les autres couches (toggle debug)
        p.crown?.setLighting(this.lighting)
      }
    }
  }

  destroy(): void {
    for (const p of this.placed) {
      p.body.destroy()
      p.crown?.destroy()
    }
    this.placed.length = 0
    for (const d of this.decor) d.destroy()
    this.decor.length = 0
  }
}
