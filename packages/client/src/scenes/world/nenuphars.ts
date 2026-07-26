/**
 * LES NÉNUPHARS (geste 09, eau-fond) — l'eau immobile porte sa flore.
 *
 * Des coussins ANCRÉS sur le haut-fond calme (pas de courant : les lacs et les
 * mares — la rivière emporte tout), semés par hash positionnel autour de la caméra
 * à la manière des feuilles (`feuilles-derive.ts`) mais SANS dérive : un nénuphar
 * est amarré.
 *
 * DA CUBIQUE (reprise sur retour d'Alexis — le premier jet n'avait ni la silhouette
 * ni la normale) : la recette des dalles de gué, à l'identique — silhouette BLOCKY
 * en rects, albédo deux MATÉRIAUX (coussin, plat qui prend le jour), variante `_lit`
 * + carte de normales `passes:1`/`k:3.5` (un cube net, pas un dôme), sprites en
 * `setLighting(true)`, et JAMAIS de flipX en mode lit — un flip Phaser n'inverse pas
 * le canal X de la normale ; la variété vient des deux gabarits et de l'échelle.
 * Ombre de contact séparée sur le lit (silhouette FILL décalée de 2 px — l'épaisseur
 * d'eau), bob d'1 px par crans francs — jamais un glissé.
 *
 * DÉCOR ASSUMÉ, la frontière est écrite : le jour où les nénuphars se récoltent,
 * ce sont de vrais nœuds posés dans /sim (règle « objets de jeu réels ») — un
 * chantier séparé, à trancher explicitement.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { flowAt, type FlowField } from '../../render/flow-field'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { newCanvas, normalFromCanvas, registerLit } from '../../render/normal-map'
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

/** Les deux gabarits de coussin : [w, h, rects [x, y, w, h, couleur]]. Rects only —
 *  la silhouette blocky de la DA cubique, l'encoche est un coin VRAIMENT manquant. */
const GABARITS: readonly (readonly [number, number, readonly (readonly [number, number, number, number, string])[]])[] = [
  [
    8,
    7,
    [
      [1, 0, 5, 7, '#2f5c2e'], // le coussin
      [0, 1, 8, 5, '#2f5c2e'],
      [1, 1, 4, 2, '#4a7d40'], // le plat qui prend le jour — un MATÉRIAU, pas un ombrage
    ],
  ],
  [
    6,
    6,
    [
      [1, 0, 4, 6, '#325f2c'],
      [0, 1, 6, 4, '#325f2c'],
      [1, 1, 3, 2, '#4d7f3e'],
    ],
  ],
]

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

/** Peint l'albédo d'un gabarit, avec l'ENCOCHE (le coin manquant du nénuphar). */
function peindre(ctx: CanvasRenderingContext2D, k: number): void {
  const [w, , rects] = GABARITS[k]!
  for (const [x, y, rw, rh, col] of rects) {
    ctx.fillStyle = col
    ctx.fillRect(x, y, rw, rh)
  }
  ctx.clearRect(w - 2, 0, 2, 2)
}

interface Nenuphar {
  sprite: Phaser.GameObjects.Image
  ombre: Phaser.GameObjects.Image
  /** Le gabarit (0/1) — pour re-swapper la texture au toggle debug. */
  k: number
  x: number // tuiles
  y: number
  /** Phase du bob — deux coussins ne respirent pas ensemble. */
  phase: number
}

export class Nenuphars {
  private readonly coussins: Nenuphar[] = []
  private graine = 0
  private prochaine = 0
  private lit = true

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    /** Le champ de courant partagé (WaterLayer.flow) — un nénuphar n'y survit pas. */
    private readonly flow: FlowField | null,
    /** Le champ de rive partagé (WaterLayer.rive) — nul : la carte est sèche, module inerte. */
    private readonly rive: RiveField | null,
  ) {
    if (!rive) return
    // ── Les textures : le coussin peint (mode éteint) ET sa variante _lit + normale ──
    if (!scene.textures.exists('fx-nenuphar-0')) {
      for (let k = 0; k < GABARITS.length; k++) {
        const [w, h] = GABARITS[k]!
        // Le peint : le même albédo — le contrat « éteint = comme avant » n'a pas
        // d'avant ici, on donne au mode OFF la version sans normale, simplement.
        const peint = newCanvas(w, h)
        peindre(peint.ctx, k)
        scene.textures.addCanvas(`fx-nenuphar-${k}`, peint.c)
        scene.textures.get(`fx-nenuphar-${k}`).setFilter(Phaser.Textures.FilterMode.NEAREST)
        // Le _lit : normale dérivée de la silhouette AVANT toute ombre, cadrans blocky
        // `passes:1`/`k:3.5` — un cube net, pas un dôme (recette des dalles de gué).
        const alb = newCanvas(w, h)
        peindre(alb.ctx, k)
        const nrm = normalFromCanvas(alb.c, 1, 3.5, 2)
        registerLit(scene, `fx-nenuphar-${k}_lit`, alb.c, nrm)
      }
    }
  }

  /** Le toggle debug (panneau P) : _lit + LightsManager, ou le coussin peint. */
  setLighting(lit: boolean): void {
    this.lit = lit
    for (const c of this.coussins) {
      c.sprite.setTexture(lit ? `fx-nenuphar-${c.k}_lit` : `fx-nenuphar-${c.k}`)
      c.sprite.setLighting(lit)
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
        const k = g % GABARITS.length
        const px = Math.round(tx * TILE_PX)
        const py = Math.round(ty * TILE_PX)
        const sprite = this.scene.add
          .image(px, py, this.lit ? `fx-nenuphar-${k}_lit` : `fx-nenuphar-${k}`)
          .setDepth(NENUPHAR_DEPTH)
        sprite.setLighting(this.lit)
        // L'ombre de contact : la silhouette FILL du coussin PEINT (l'alpha suffit),
        // décalée de l'épaisseur d'eau — elle ne bobbe pas, elle est sur le lit.
        const ombre = this.scene.add
          .image(px, py + OMBRE_DECALE_PX, `fx-nenuphar-${k}`)
          .setTint(0x10151a)
          .setTintMode(Phaser.TintModes.FILL)
          .setAlpha(OMBRE_ALPHA)
          .setDepth(OMBRE_DEPTH)
        this.coussins.push({ sprite, ombre, k, x: tx, y: ty, phase: hache(g, 13, 57) * 6.28 })
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
