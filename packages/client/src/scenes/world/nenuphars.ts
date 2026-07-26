/**
 * LES NÉNUPHARS (geste 09, eau-fond) — l'eau immobile porte sa flore.
 *
 * Des coussins ANCRÉS sur le haut-fond calme (pas de courant : les lacs et les
 * mares — la rivière emporte tout), semés par hash positionnel autour de la caméra
 * à la manière des feuilles (`feuilles-derive.ts`) mais SANS dérive : un nénuphar
 * est amarré. Ombre portée sur le lit (doctrine contact-shadow des feuilles : une
 * silhouette sombre décalée de 2 px — l'épaisseur d'eau), bob d'1 px par crans
 * francs — jamais un glissé.
 *
 * DÉCOR ASSUMÉ, la frontière est écrite : le jour où les nénuphars se récoltent,
 * ce sont de vrais nœuds posés dans /sim (règle « objets de jeu réels ») — un
 * chantier séparé, à trancher explicitement.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { flowAt, type FlowField } from '../../render/flow-field'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { riveAt, type RiveField } from '../../render/water-field'

/** Sur l'eau (−0,75), sous les feuilles (−0,68) : le coussin flotte, amarré. */
const NENUPHAR_DEPTH = GROUND_MAP_DEPTH + 0.3
/** L'ombre sur le lit — même palier que celle des feuilles. */
const OMBRE_DEPTH = GROUND_MAP_DEPTH + 0.26
const OMBRE_ALPHA = 0.3
const OMBRE_DECALE_PX = 2
const MAX_NENUPHARS = 6
const RAYON = 28
/** Espacement minimal entre deux coussins (tuiles) — jamais un tapis. */
const ESPACEMENT = 2.5
/** Le haut-fond (id de `TERRAINS`, sim/balance.ts) — même duplication assumée que les feuilles. */
const SHALLOW = 4

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

interface Nenuphar {
  sprite: Phaser.GameObjects.Image
  ombre: Phaser.GameObjects.Image
  x: number // tuiles
  y: number
  /** Phase du bob — deux coussins ne respirent pas ensemble. */
  phase: number
}

export class Nenuphars {
  private readonly coussins: Nenuphar[] = []
  private graine = 0
  private prochaine = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    /** Le champ de courant partagé (WaterLayer.flow) — un nénuphar n'y survit pas. */
    private readonly flow: FlowField | null,
    /** Le champ de rive partagé (WaterLayer.rive) — nul : la carte est sèche, module inerte. */
    private readonly rive: RiveField | null,
  ) {
    if (!rive) return
    // ── Les textures : deux coussins verts, blocky, encoche franche ──
    if (!scene.textures.exists('fx-nenuphar-0')) {
      const gabarits: [number, number][] = [
        [7, 6],
        [6, 5],
      ]
      for (let k = 0; k < 2; k++) {
        const [w, h] = gabarits[k]!
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d', { willReadFrequently: true })!
        ctx.fillStyle = '#2f5c2e' // le vert du coussin, sombre — il flotte SUR une eau claire
        ctx.fillRect(1, 0, w - 2, h)
        ctx.fillRect(0, 1, w, h - 2)
        ctx.fillStyle = '#4a7d40' // le plat qui prend le jour
        ctx.fillRect(1, 1, w - 4, 2)
        // L'ENCOCHE : le coin manquant du nénuphar — sa silhouette, pas un disque.
        ctx.clearRect(w - 2, 0, 2, 2)
        scene.textures.addCanvas(`fx-nenuphar-${k}`, cv)
        scene.textures.get(`fx-nenuphar-${k}`).setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
    }
  }

  update(nowMs: number, camTx: number, camTy: number): void {
    if (!this.rive) return
    // ── Naissances : le haut-fond calme près de la caméra, espacé, hors berge ──
    if (this.coussins.length < MAX_NENUPHARS && nowMs >= this.prochaine) {
      this.prochaine = nowMs + 1300
      for (let essai = 0; essai < 6; essai++) {
        const g = this.graine++
        const tx = camTx + (hache(g, essai, 41) - 0.5) * RAYON * 1.7
        const ty = camTy + (hache(essai, g, 43) - 0.5) * RAYON * 1.7
        const i = Math.floor(ty) * this.map.width + Math.floor(tx)
        if (this.map.terrain[i] !== SHALLOW) continue
        if (this.flow && flowAt(this.flow, tx, ty)) continue // le courant emporte tout
        if (riveAt(this.rive, tx, ty) < 1.0) continue // hors de la bande d'écume
        if (this.coussins.some((c) => Math.max(Math.abs(c.x - tx), Math.abs(c.y - ty)) < ESPACEMENT)) continue
        const k = g % 2
        const px = Math.round(tx * TILE_PX)
        const py = Math.round(ty * TILE_PX)
        const sprite = this.scene.add
          .image(px, py, `fx-nenuphar-${k}`)
          .setDepth(NENUPHAR_DEPTH)
          .setAlpha(0.95)
          .setFlipX(hache(g, 7, 51) > 0.5)
        const ombre = this.scene.add
          .image(px, py + OMBRE_DECALE_PX, `fx-nenuphar-${k}`)
          .setTint(0x10151a)
          .setTintMode(Phaser.TintModes.FILL) // la SILHOUETTE sombre, pas le coussin assombri
          .setAlpha(OMBRE_ALPHA)
          .setDepth(OMBRE_DEPTH)
          .setFlipX(sprite.flipX)
        this.coussins.push({ sprite, ombre, x: tx, y: ty, phase: hache(g, 13, 57) * 6.28 })
        break
      }
    }
    // ── La vie du coussin : un bob d'1 px par crans, et la sortie de vue ──
    for (let i = this.coussins.length - 1; i >= 0; i--) {
      const c = this.coussins[i]!
      if (Math.max(Math.abs(c.x - camTx), Math.abs(c.y - camTy)) > RAYON * 1.7) {
        c.sprite.destroy()
        c.ombre.destroy()
        this.coussins.splice(i, 1)
        continue
      }
      // Le bob : −1 / 0 / +1 px, FRANC (Math.round) — l'eau le porte, elle ne le berce pas.
      const bob = Math.round(Math.sin(nowMs * 0.0006 + c.phase))
      c.sprite.setY(Math.round(c.y * TILE_PX) + bob)
      // L'ombre ne bobbe PAS : elle est sur le lit, c'est le coussin qui respire au-dessus.
    }
  }

  /** Sonde du smoke : les coussins existent. */
  get vivants(): number {
    return this.coussins.length
  }

  destroy(): void {
    for (const c of this.coussins) {
      c.sprite.destroy()
      c.ombre.destroy()
    }
    this.coussins.length = 0
  }
}
