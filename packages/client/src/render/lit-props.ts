/**
 * ESSAI ÉCLAIRAGE DYNAMIQUE — couche 1, la masse « pâteuse » (DA 2026-07-20).
 *
 * Même recette que l'arbre, GÉNÉRALISÉE : pour chaque prop bombé (buissons, roches,
 * sphaigne…) on fabrique une variante `_lit` = albédo APLATI (couleur de base UNIE, sans
 * l'ombrage peint qui se battait avec la lumière calculée) + une carte de NORMALES dérivée de
 * la SILHOUETTE (masque lissé en butte, puis facetté). Le relief vient alors 100 % de la
 * lumière, cohérent avec le reste ; le rendu swappe sur `_lit` + `setLighting(true)` quand armé.
 *
 * La normale est dérivée de NOTRE canvas (lisible via `getImageData`), jamais d'une texture
 * Phaser générée (dont la relecture WebGL est incertaine). Convention Y : voir `FLIP_G`.
 */
import type Phaser from 'phaser'

const FLIP_G = true // Phaser attend le vert « Y vers le haut » ; notre espace a Y vers le bas

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}
function enc(v: number): number {
  return Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)))
}
function newCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, ctx: c.getContext('2d')! }
}

/** Carte de normales dérivée du masque alpha d'un canvas (butte lissée → facettes). */
function normalFromCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height
  const srcData = src.getContext('2d')!.getImageData(0, 0, w, h).data
  // 1) hauteur = masque (opaque ? 1 : 0), lissé → butte conforme à la forme
  let hf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) hf[i] = srcData[i * 4 + 3]! > 8 ? 1 : 0
  for (let pass = 0; pass < 4; pass++) {
    const n = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, cnt = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          s += hf[yy * w + xx]!; cnt++
        }
        n[y * w + x] = s / cnt
      }
    }
    hf = n
  }
  // 2) FACETTES : hauteur moyenne par cellule ~2 px → normale = gradient de cellule
  const cellsX = Math.max(2, Math.round(w / 2)), cellsY = Math.max(2, Math.round(h / 2))
  const csx = w / cellsX, csy = h / cellsY
  const H = new Float32Array(cellsX * cellsY)
  for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
    let s = 0, cnt = 0
    for (let y = Math.floor(cy * csy); y < Math.floor((cy + 1) * csy); y++)
      for (let x = Math.floor(cx * csx); x < Math.floor((cx + 1) * csx); x++) { s += hf[y * w + x]!; cnt++ }
    H[cy * cellsX + cx] = cnt ? s / cnt : 0
  }
  const K = 2.6
  const at = (cx: number, cy: number): number =>
    H[Math.min(cellsY - 1, Math.max(0, cy)) * cellsX + Math.min(cellsX - 1, Math.max(0, cx))]!
  const out = newCanvas(w, h)
  const d = out.ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const cx = Math.min(cellsX - 1, Math.floor(x / csx)), cy = Math.min(cellsY - 1, Math.floor(y / csy))
      const dhx = at(cx + 1, cy) - at(cx - 1, cy)
      const dhy = at(cx, cy + 1) - at(cx, cy - 1)
      const [nx, ny, nz] = norm3(-dhx * K, -dhy * K, 1)
      d.data[i] = enc(nx)
      d.data[i + 1] = enc(FLIP_G ? -ny : ny)
      d.data[i + 2] = enc(nz)
      d.data[i + 3] = 255
    }
  }
  out.ctx.putImageData(d, 0, 0)
  return out.c
}

function register(scene: Phaser.Scene, key: string, albedo: HTMLCanvasElement, normal: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const tex = scene.textures.addCanvas(key, albedo)
  tex?.setDataSource(normal)
}

/** Un prop pâteux : sa clé, sa taille, et le tracé de son albédo APLATI (couleur de base unie). */
interface LitProp { key: string; w: number; h: number; draw: (ctx: CanvasRenderingContext2D) => void }

const disc = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void => {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
}

// Silhouettes = celles de BootScene, MAIS remplies d'une seule couleur (l'ombrage peint retiré).
const PROPS: LitProp[] = [
  { key: 'cl-bush', w: 16, h: 16, draw: (c) => { c.fillStyle = '#2f5330'; c.fillRect(2, 5, 12, 9); c.fillRect(3, 4, 10, 9) } },
  { key: 'cl-low_bush', w: 16, h: 16, draw: (c) => { c.fillStyle = '#4b4a2e'; c.fillRect(4, 8, 9, 6) } },
  { key: 'cl-boulder', w: 16, h: 16, draw: (c) => { c.fillStyle = '#5f5f64'; disc(c, 8, 10, 5) } },
  { key: 'cl-sphagnum', w: 16, h: 16, draw: (c) => { c.fillStyle = '#6a6a3a'; disc(c, 8, 11, 4) } },
  { key: 'nd-rock', w: 16, h: 16, draw: (c) => { c.fillStyle = '#6a6a72'; c.fillRect(3, 6, 11, 8) } },
]

/** Les `kind` de clutter qui ont une variante `_lit` (pour le swap côté ClutterLayer). */
export const LIT_CLUTTER_KINDS = new Set(['bush', 'low_bush', 'boulder', 'sphagnum'])
/** Les `type` de nœud qui ont une variante `_lit` (pour le swap côté SnapshotView). */
export const LIT_NODE_TYPES = new Set(['rock'])

/** Enregistre les variantes `_lit` (albédo aplati + normal map) de la masse pâteuse. */
export function generateLitProps(scene: Phaser.Scene): void {
  for (const p of PROPS) {
    const alb = newCanvas(p.w, p.h)
    p.draw(alb.ctx)
    register(scene, `${p.key}_lit`, alb.c, normalFromCanvas(alb.c))
  }
}
