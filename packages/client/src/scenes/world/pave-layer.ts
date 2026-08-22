/**
 * LA COUCHE DES PAVÉS — le sol cuit à 16 px/tuile, par CHUNKS autour de la caméra
 * (spec `sol-dessine.md` R8, R11, R12).
 *
 * Le bake plein-carte reste à 1 px/tuile (`map-demo`) : il sert de LIT à l'eau et de source à
 * la minicarte. Par-dessus, cette couche pose des images de `PAVE.CHUNK × 16` px cuites à la
 * demande (`render/paves.ts`, pur) : la vue en tient une poignée, on en garde une couronne
 * autour, on rend les autres. Le bake plein-carte à cette résolution ferait 2,5 M × 256 px —
 * impossible en une texture, et inutile : on ne regarde qu'un écran à la fois.
 *
 * LA CUISSON SE MESURE (R12) : `derniereCuissonMs` et `chunksVivants()` sont la surface de
 * lecture du smoke. Budget : au plus `CUISSONS_PAR_FRAME` chunks neufs par frame une fois le
 * monde posé — la première vue se cuit d'un coup (l'écran doit être plein au réveil), les
 * suivantes au fil du déplacement, une par frame, pour que la pire seconde ne bouge pas.
 *
 * NEAREST, comme tout l'art : la caméra agrandit 2,25× ; un pixel cuit est un pixel à l'écran.
 * AUCUNE logique de jeu ici — rendu pur d'état reçu.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@ashes/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { GRAIN_CELLS, familleDe, grainFacteur, type Famille } from '../../render/grain-sol'
import { PAVE, PAVE_PX, cuireChunk } from '../../render/paves'

/** Sous le bake ? Non : AU-DESSUS du bake (−1), SOUS l'eau (+0,25) et tout ce qui vit dessus. */
const PAVE_DEPTH = GROUND_MAP_DEPTH + 0.05

/** Combien de chunks neufs par frame, une fois la première vue posée. */
const CUISSONS_PAR_FRAME = 1
/** La couronne gardée autour de la vue, en chunks : ce qu'on ne recuit pas en revenant sur ses pas. */
const COURONNE = 1

interface Chunk {
  image: Phaser.GameObjects.Image
  cle: string
  /** Dernière frame où le chunk était dans la vue ou sa couronne. */
  vu: number
}

export class PaveLayer {
  private chunks = new Map<number, Chunk>()
  private frame = 0
  private premiereVue = true
  /** La dernière cuisson, en ms — la sonde R12. */
  derniereCuissonMs = 0
  /** Le total cuit depuis la naissance de la couche (chunks). */
  cuits = 0
  /** Les trames de grain par famille, 64×64 cellules, cuites une fois (le même calcul que
   *  l'atlas d'hier, `grain-sol.ts`) — lues par le pixel, jamais recalculées par chunk. */
  private trames = new Map<Famille, Float32Array>()

  constructor(
    private scene: Phaser.Scene,
    private map: WorldMap,
    /** La couleur de sol de chaque tuile, 0xRRGGBB, telle que le bake l'a cuite. */
    private couleurs: Uint32Array,
    private seed: number,
  ) {}

  /** La trame de grain d'un terrain — celle de sa famille, cuite une fois par seed. */
  private trameDe = (t: number): Float32Array | null => {
    const f = familleDe(t)
    if (!f) return null
    let trame = this.trames.get(f)
    if (!trame) {
      trame = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
      for (let cy = 0; cy < GRAIN_CELLS; cy++) {
        for (let cx = 0; cx < GRAIN_CELLS; cx++) trame[cy * GRAIN_CELLS + cx] = grainFacteur(cx, cy, f, this.seed)
      }
      this.trames.set(f, trame)
    }
    return trame
  }

  private terrainAt = (tx: number, ty: number): number => {
    const { width, height, terrain } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return 0
    return terrain[ty * width + tx] ?? 0
  }

  private couleurAt = (tx: number, ty: number): number => {
    const { width, height } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return 0
    return this.couleurs[ty * width + tx] ?? 0
  }

  /** Les chunks de la vue (et sa couronne) : cuit ce qui manque, rend ce qui est loin. */
  render(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.frame++
    const cotePx = PAVE.CHUNK * PAVE_PX
    const v = camera.worldView
    const cx0 = Math.max(0, Math.floor(v.x / cotePx) - COURONNE)
    const cy0 = Math.max(0, Math.floor(v.y / cotePx) - COURONNE)
    const cxMax = Math.ceil((this.map.width * TILE_PX) / cotePx) - 1
    const cyMax = Math.ceil((this.map.height * TILE_PX) / cotePx) - 1
    const cx1 = Math.min(cxMax, Math.floor((v.x + v.width) / cotePx) + COURONNE)
    const cy1 = Math.min(cyMax, Math.floor((v.y + v.height) / cotePx) + COURONNE)

    // D'abord ce qui est DANS la vue, puis la couronne : si le budget ne permet qu'un chunk,
    // c'est celui qu'on regarde.
    let budget = this.premiereVue ? Number.POSITIVE_INFINITY : CUISSONS_PAR_FRAME
    const visible = (cx: number, cy: number): boolean =>
      cx * cotePx < v.x + v.width && (cx + 1) * cotePx > v.x && cy * cotePx < v.y + v.height && (cy + 1) * cotePx > v.y
    for (const passe of [true, false]) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (visible(cx, cy) !== passe) continue
          const k = cy * 65536 + cx
          const c = this.chunks.get(k)
          if (c) {
            c.vu = this.frame
            continue
          }
          if (budget <= 0) continue
          budget--
          this.cuire(cx, cy, k)
        }
      }
    }
    this.premiereVue = false

    // Ce qui n'a pas été vu depuis une poignée de frames se rend : la couronne est la seule
    // mémoire — revenir sur ses pas recuit, et c'est mesuré comme acceptable (une cuisson par
    // frame, jamais plus).
    for (const [k, c] of this.chunks) {
      if (this.frame - c.vu > 30) this.rendre(k, c)
    }
  }

  private cuire(cx: number, cy: number, k: number): void {
    const t0 = performance.now()
    const S = PAVE.CHUNK * PAVE_PX
    const cle = `pave-${this.seed >>> 0}-${cx}-${cy}`
    const rgba = cuireChunk({ cx, cy, terrainAt: this.terrainAt, couleurAt: this.couleurAt, trameDe: this.trameDe })
    const tex = this.scene.textures.createCanvas(cle, S, S)
    if (!tex) return
    const ctx = tex.getContext()
    const img = ctx.createImageData(S, S)
    img.data.set(rgba)
    ctx.putImageData(img, 0, 0)
    tex.refresh()
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    const image = this.scene.add.image(cx * S, cy * S, cle).setOrigin(0, 0).setDepth(PAVE_DEPTH)
    this.chunks.set(k, { image, cle, vu: this.frame })
    this.cuits++
    this.derniereCuissonMs = performance.now() - t0
  }

  private rendre(k: number, c: Chunk): void {
    c.image.destroy()
    this.scene.textures.remove(c.cle)
    this.chunks.delete(k)
  }

  /** Combien de chunks sont cuits et posés — la sonde du smoke (`matiere`). */
  chunksVivants(): number {
    return this.chunks.size
  }

  destroy(): void {
    for (const [k, c] of this.chunks) this.rendre(k, c)
  }
}
