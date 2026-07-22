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

/**
 * LE FEU — 2-3 BÛCHES CROISÉES, NORMAL-MAPPÉES (demande d'Alexis). Contrairement à la
 * masse pâteuse (un blob lissé depuis la silhouette), on bâtit un vrai CHAMP DE HAUTEUR
 * où CHAQUE bûche est un RONDIN cylindrique : la normale montre alors des rondins
 * distincts, pas une bosse. De ce même relief on tire l'ombrage du sprite NON éclairé —
 * les deux modes montrent le même bois. La flamme vit dans les particules (FireFx), pas
 * ici : la base est du bois mat, propre à éclairer.
 *
 * Tout est sur la grille 2 px (évaluation par cellule de 2×2) — le style pixel du jeu.
 */
const FIRE_SIZE = 16
const FIRE_CELL = 2
// x0,y0 → x1,y1 (px) et rayon du rondin : deux diagonales croisées + un rondin au sol devant.
const FIRE_LOGS: readonly (readonly [number, number, number, number, number])[] = [
  [3, 4, 13, 11, 2.6],
  [13, 4, 3, 11, 2.6],
  [4, 13, 12, 13, 2.3],
]
const FIRE_TONES: readonly [number, number, number][] = [
  [0x6b, 0x4a, 0x2f], // bois
  [0x77, 0x53, 0x30], // bois, une pointe plus chaud
  [0x5f, 0x43, 0x28], // bois, plus sombre (le rondin du sol, dans l'ombre des autres)
]
const FIRE_NORMAL_K = 3.4 // gain sur le gradient de hauteur — le galbe des rondins

function distToSegment(px: number, py: number, seg: readonly [number, number, number, number, number]): number {
  const [x0, y0, x1, y1] = seg
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy || 1
  let t = ((px - x0) * dx + (py - y0) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const cx = x0 + t * dx
  const cy = y0 + t * dy
  const ex = px - cx
  const ey = py - cy
  return Math.sqrt(ex * ex + ey * ey)
}

/** Enregistre `st-fire` (bois ombré, hors éclairage dynamique) et `st-fire_lit` (bois mat
 *  + normal map cylindrique, pour le pipeline de lumières). Appelé au boot. */
export function generateFireProp(scene: Phaser.Scene): void {
  const S = FIRE_SIZE
  const cells = S / FIRE_CELL // 8×8 cellules de 2 px
  // Hauteur et bûche d'appartenance PAR CELLULE (le rondin le plus haut l'emporte).
  const H = new Float32Array(cells * cells)
  const which = new Int8Array(cells * cells).fill(-1)
  let hMax = 0
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const px = cx * FIRE_CELL + FIRE_CELL / 2
      const py = cy * FIRE_CELL + FIRE_CELL / 2
      let best = -1
      let hi = 0
      for (let i = 0; i < FIRE_LOGS.length; i++) {
        const seg = FIRE_LOGS[i]!
        const r = seg[4]
        const d = distToSegment(px, py, seg)
        if (d >= r) continue
        const h = Math.sqrt(r * r - d * d) // section circulaire du rondin
        if (h > hi) { hi = h; best = i }
      }
      H[cy * cells + cx] = hi
      which[cy * cells + cx] = best
      if (hi > hMax) hMax = hi
    }
  }
  const hAt = (cx: number, cy: number): number =>
    H[Math.min(cells - 1, Math.max(0, cy)) * cells + Math.min(cells - 1, Math.max(0, cx))]! / (hMax || 1)

  const albedo = newCanvas(S, S) // bois MAT (variante _lit)
  const shaded = newCanvas(S, S) // bois OMBRÉ (variante non éclairée)
  const normal = newCanvas(S, S)
  const nd = normal.ctx.createImageData(S, S)
  // Lumière FIXE du sprite non éclairé : le hillshade maison (haut-gauche).
  const [lx, ly, lz] = norm3(-0.5, -0.6, 0.85)
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const b = which[cy * cells + cx]!
      if (b < 0) continue // pas de bois ici : transparent (la silhouette vient de l'albédo)
      // Normale de la cellule = gradient du champ de hauteur, galbé par K.
      const dhx = hAt(cx + 1, cy) - hAt(cx - 1, cy)
      const dhy = hAt(cx, cy + 1) - hAt(cx, cy - 1)
      const [nx, ny, nz] = norm3(-dhx * FIRE_NORMAL_K, -dhy * FIRE_NORMAL_K, 1)
      const [r, g, bl] = FIRE_TONES[b]!
      // Albédo mat.
      albedo.ctx.fillStyle = `rgb(${r},${g},${bl})`
      albedo.ctx.fillRect(cx * FIRE_CELL, cy * FIRE_CELL, FIRE_CELL, FIRE_CELL)
      // Ombré : albédo × (ambiante + diffus du relief).
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz)
      const k = 0.55 + 0.55 * diff
      shaded.ctx.fillStyle = `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(bl * k))})`
      shaded.ctx.fillRect(cx * FIRE_CELL, cy * FIRE_CELL, FIRE_CELL, FIRE_CELL)
      // Normal map (encodée) sur le bloc 2×2.
      for (let y = cy * FIRE_CELL; y < (cy + 1) * FIRE_CELL; y++) {
        for (let x = cx * FIRE_CELL; x < (cx + 1) * FIRE_CELL; x++) {
          const idx = (y * S + x) * 4
          nd.data[idx] = enc(nx)
          nd.data[idx + 1] = enc(FLIP_G ? -ny : ny)
          nd.data[idx + 2] = enc(nz)
          nd.data[idx + 3] = 255
        }
      }
    }
  }
  normal.ctx.putImageData(nd, 0, 0)
  // `st-fire` : sprite ombré simple (aucune normal — rendu quand l'éclairage est éteint).
  if (scene.textures.exists('st-fire')) scene.textures.remove('st-fire')
  scene.textures.addCanvas('st-fire', shaded.c)
  // `st-fire_lit` : bois mat + normal map (rendu quand l'éclairage est armé).
  register(scene, 'st-fire_lit', albedo.c, normal.c)
}
