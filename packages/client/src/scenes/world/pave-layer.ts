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
 * lecture du smoke. Budget : ce qui est DANS L'ÉCRAN se cuit TOUJOURS, tout de suite — un trou
 * à l'écran (le bake plat qui affleure en carré) est pire qu'un à-coup de quelques ms, et
 * Alexis l'a vu le 2026-08-22 (« je vois des carrés comme des chunks quand je bouge la
 * caméra ») quand la première écriture bornait AUSSI le visible à un chunk par frame : un
 * saut de caméra laissait l'écran troué trente frames. Seule la COURONNE se cuit au
 * compte-gouttes (`CUISSONS_COURONNE_PAR_FRAME`), en avance sur le déplacement.
 *
 * NEAREST, comme tout l'art : la caméra agrandit 2,25× ; un pixel cuit est un pixel à l'écran.
 * AUCUNE logique de jeu ici — rendu pur d'état reçu.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@ashes/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { GRAIN_CELLS, familleDe, grainFacteur, type Famille } from '../../render/grain-sol'
import { PAVE, PAVE_COTE, PAVE_PX, cuireChunk } from '../../render/paves'

/** Sous le bake ? Non : AU-DESSUS du bake (−1), SOUS l'eau (+0,25) et tout ce qui vit dessus. */
const PAVE_DEPTH = GROUND_MAP_DEPTH + 0.05
/** LE SURPLOMB de la berge (frange de terre, ombre, ressac sur l'eau) : AU-DESSUS du shader
 *  d'eau (+0,25), des ombres de poissons (+0,27), des reflets (+0,28) et de la GLACE (+0,285 :
 *  la berge garde son bord sur le lac gelé) — une berge cache ce qui passe dessous — mais SOUS
 *  la neige (+0,30), la falaise et les feuilles qui dérivent (+0,32). */
export const SURPLOMB_DEPTH = GROUND_MAP_DEPTH + 0.29

/** Combien de chunks de COURONNE (hors écran) se cuisent par frame. Le visible n'est pas borné. */
const CUISSONS_COURONNE_PAR_FRAME = 2
/** La couronne gardée autour de la vue, en chunks : cuite en avance, pour que le visible n'ait
 *  en général rien à cuire quand on marche. */
const COURONNE = 1
/** LA MARGE DU VISIBLE, en px monde : `update()` lit la vue de la frame PRÉCÉDENTE (la caméra
 *  ne suit le joueur qu'au rendu, après `update`). Ce qui est à moins d'une demi-tuile-de-chunk
 *  du bord compte donc comme visible et se cuit tout de suite — sinon une bande d'un pixel de
 *  bake plat peut affleurer une frame au bord qui avance. */
const MARGE_VISIBLE_PX = (PAVE.CHUNK * PAVE_PX) / 2
/** Un chunk non vu depuis tant de frames se rend. Long : revenir sur ses pas ne doit pas recuire
 *  (2 s à 60 fps) ; le plafond `MAX_VIVANTS` borne la mémoire quoi qu'il arrive. */
const OUBLI_FRAMES = 120
/** Plafond de chunks vivants : au-delà, les plus anciens se rendent, même vus récemment.
 *  258² × 4 o = **266 Ko** par image depuis le débord (`PAVE.BAVE`, 2026-08-23) → ~25 Mo, et
 *  jusqu'au double sur une côte, où chaque chunk porte AUSSI son surplomb. */
const MAX_VIVANTS = 96

/**
 * Verse un tampon RGBA carré dans une CanvasTexture NEAREST et pose son image — partagé avec le
 * manteau (`gel-layer.ts`), qui cuit à la même maille.
 *
 * `x, y` sont ceux du PREMIER PIXEL DU TAMPON, débord compris (`PAVE.BAVE`) : l'appelant décale
 * de `−BAVE` le coin du chunk. Le côté se DÉDUIT du tampon (√(n/4)) plutôt que d'être supposé :
 * une couche qui cuirait à une autre taille resterait juste, et le jour où le débord change,
 * rien ici ne ment.
 */
export function poserChunk(
  scene: Phaser.Scene, cle: string, rgba: Uint8ClampedArray, x: number, y: number, depth: number,
): Phaser.GameObjects.Image | null {
  const S = Math.round(Math.sqrt(rgba.length / 4))
  // Une clé déjà prise (une scène rechargée à chaud sans passer par `destroy`) ne doit PAS
  // laisser un trou permanent recuit à chaque frame : on la rend, puis on recrée.
  if (scene.textures.exists(cle)) scene.textures.remove(cle)
  const tex = scene.textures.createCanvas(cle, S, S)
  if (!tex) return null
  const ctx = tex.getContext()
  const img = ctx.createImageData(S, S)
  img.data.set(rgba)
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
  return scene.add.image(x, y, cle).setOrigin(0, 0).setDepth(depth)
}

interface Chunk {
  image: Phaser.GameObjects.Image
  cle: string
  /** Le surplomb de berge, s'il y a de l'eau dans le chunk. */
  surplomb?: { image: Phaser.GameObjects.Image; cle: string }
  /** Dernière frame où le chunk était dans la vue ou sa couronne. */
  vu: number
}

export class PaveLayer {
  private chunks = new Map<number, Chunk>()
  private frame = 0
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

    // Le VISIBLE d'abord, sans budget : l'écran ne doit jamais montrer un trou. La couronne
    // ensuite, au compte-gouttes.
    const m = MARGE_VISIBLE_PX
    const visible = (cx: number, cy: number): boolean =>
      cx * cotePx < v.x + v.width + m && (cx + 1) * cotePx > v.x - m
      && cy * cotePx < v.y + v.height + m && (cy + 1) * cotePx > v.y - m
    let budgetCouronne = CUISSONS_COURONNE_PAR_FRAME
    for (const passeVisible of [true, false]) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (visible(cx, cy) !== passeVisible) continue
          const k = cy * 65536 + cx
          const c = this.chunks.get(k)
          if (c) {
            c.vu = this.frame
            continue
          }
          if (!passeVisible) {
            if (budgetCouronne <= 0) continue
            budgetCouronne--
          }
          this.cuire(cx, cy, k)
        }
      }
    }

    // L'oubli : ce qui n'a pas été vu depuis longtemps se rend ; et si on en garde trop (une
    // longue marche), les plus anciens partent d'abord — jamais un chunk vu cette frame.
    for (const [k, c] of this.chunks) {
      if (this.frame - c.vu > OUBLI_FRAMES) this.rendre(k, c)
    }
    if (this.chunks.size > MAX_VIVANTS) {
      const parAge = [...this.chunks.entries()].sort((a, b) => a[1].vu - b[1].vu)
      for (const [k, c] of parAge) {
        if (this.chunks.size <= MAX_VIVANTS || c.vu === this.frame) break
        this.rendre(k, c)
      }
    }
  }

  /** Combien de chunks VISIBLES manquent à l'écran en ce moment — la sonde du smoke : doit
   *  valoir 0 après tout rendu, saut de caméra compris. */
  trousVisibles(camera: Phaser.Cameras.Scene2D.Camera): number {
    const cotePx = PAVE.CHUNK * PAVE_PX
    const v = camera.worldView
    const cxMax = Math.ceil((this.map.width * TILE_PX) / cotePx) - 1
    const cyMax = Math.ceil((this.map.height * TILE_PX) / cotePx) - 1
    let trous = 0
    for (let cy = Math.max(0, Math.floor(v.y / cotePx)); cy <= Math.min(cyMax, Math.floor((v.y + v.height) / cotePx)); cy++) {
      for (let cx = Math.max(0, Math.floor(v.x / cotePx)); cx <= Math.min(cxMax, Math.floor((v.x + v.width) / cotePx)); cx++) {
        if (!this.chunks.has(cy * 65536 + cx)) trous++
      }
    }
    return trous
  }

  private cuire(cx: number, cy: number, k: number): void {
    const t0 = performance.now()
    const S = PAVE_COTE
    // Le tampon commence UN PIXEL AVANT le chunk (`PAVE.BAVE`) : l'image se pose d'autant en
    // arrière, et deux voisines se recouvrent au lieu de se toucher (voir `PAVE.BAVE`).
    const x0 = cx * S - PAVE.BAVE
    const y0 = cy * S - PAVE.BAVE
    const cle = `pave-${this.seed >>> 0}-${cx}-${cy}`
    const cuit = cuireChunk({ cx, cy, terrainAt: this.terrainAt, couleurAt: this.couleurAt, trameDe: this.trameDe })
    const image = this.poser(cle, cuit.sol, x0, y0, PAVE_DEPTH)
    if (!image) return
    const chunk: Chunk = { image, cle, vu: this.frame }
    if (cuit.surplomb) {
      const cleSur = cle + '-surplomb'
      const sur = this.poser(cleSur, cuit.surplomb, x0, y0, SURPLOMB_DEPTH)
      if (sur) chunk.surplomb = { image: sur, cle: cleSur }
    }
    this.chunks.set(k, chunk)
    this.cuits++
    this.derniereCuissonMs = performance.now() - t0
  }

  /** Verse un tampon RGBA dans une CanvasTexture NEAREST et pose son image. */
  private poser(cle: string, rgba: Uint8ClampedArray, x: number, y: number, depth: number): Phaser.GameObjects.Image | null {
    return poserChunk(this.scene, cle, rgba, x, y, depth)
  }

  private rendre(k: number, c: Chunk): void {
    c.image.destroy()
    this.scene.textures.remove(c.cle)
    if (c.surplomb) {
      c.surplomb.image.destroy()
      this.scene.textures.remove(c.surplomb.cle)
    }
    this.chunks.delete(k)
  }

  /** Combien de chunks portent un surplomb de berge — la sonde du smoke. */
  surplombsVivants(): number {
    let n = 0
    for (const c of this.chunks.values()) if (c.surplomb) n++
    return n
  }

  /** Combien de chunks sont cuits et posés — la sonde du smoke (`matiere`). */
  chunksVivants(): number {
    return this.chunks.size
  }

  destroy(): void {
    for (const [k, c] of this.chunks) this.rendre(k, c)
  }
}
