/**
 * ESSAI ÉCLAIRAGE DYNAMIQUE (DA actée, docs/decisions.md 2026-07-20).
 *
 * Variantes ÉCLAIRABLES de l'arbre de la Racine — MÊME forme et MÊME famille de couleur
 * que l'art d'origine (demande d'Alexis), mais ALBÉDO UNIFORME (à plat) : on retire
 * l'ombrage PEINT (le highlight NO, l'ombre SE de `nd-tree_crown`) pour ne pas le cumuler
 * avec la lumière calculée — sinon double ombrage. Tout le relief vient désormais de la
 * carte de NORMALES + des lumières (WorldScene/dynamic-lighting.ts).
 *
 * Silhouette IDENTIQUE au sprite d'origine (mêmes rectangles blocky) → aucune rupture de
 * forme ; on ne swappe l'albédo que quand l'arbre est éclairé (`setLighting(true)`).
 *
 * L'EFFET EST CUBIQUE : les normales sont un dôme FACETTÉ (cellules à normale plate) — au
 * crépuscule le soleil rasant allume une tranche du houppier, la nuit la braise un flanc.
 *
 * Convention de normale : x = est (droite), y = sud (bas), z = vers le ciel — la MÊME base
 * que `sunDirection()` et l'espace-monde de Phaser (y bas). Feu au mauvais flanc VERTICAL :
 * basculer `FLIP_G`.
 */
import type Phaser from 'phaser'

const FLIP_G = true // Phaser attend le canal vert « Y vers le HAUT » ; notre espace a Y vers le bas → on inverse

// Couleurs UNIFORMES, tirées de l'art d'origine (famille inchangée), au niveau « éclairé »
// pour que la lumière SCULPTE vers le bas plutôt que de partir dans le noir.
const TRUNK_BROWN = '#5c4429' // l'arête claire de nd-tree_trunk (le houppier décode son vert inline)

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

const S = 32 // côté de la texture du houppier

/** LA SILHOUETTE du houppier `_lit` — l'UNIQUE source de forme, partagée par l'albédo ET la
 *  normale (sinon elles ne coïncident pas). Union des deux rects blocky de l'ancien houppier. */
function crownOpaque(x: number, y: number): boolean {
  return (x >= 4 && x < 28 && y >= 6 && y < 28) || (x >= 6 && x < 26 && y >= 4 && y < 26)
}

/** Albédo UNIFORME du houppier : la silhouette `crownOpaque`, à plat. */
function buildCrownAlbedo(): HTMLCanvasElement {
  const { c, ctx } = newCanvas(S, S)
  const d = ctx.createImageData(S, S)
  const [r, g, bl] = [0x2d, 0x6b, 0x32] // CROWN_GREEN décodé
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!crownOpaque(x, y)) continue
      const i = (y * S + x) * 4
      d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = bl; d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

/**
 * Carte de normales du houppier, DÉRIVÉE de `crownOpaque` (donc alignée pixel pour pixel avec
 * l'albédo) : on lisse le masque de la silhouette en une BUTTE qui épouse sa forme (haut au
 * centre, retombe aux bords réels), puis on FACETTE par cellules (cubique) — chaque facette
 * prend le gradient local de la butte, si bien que les flancs regardent VERS L'EXTÉRIEUR de la
 * vraie forme, coins compris.
 */
function buildCrownNormal(): HTMLCanvasElement {
  const { c, ctx } = newCanvas(S, S)
  const d = ctx.createImageData(S, S)
  // 1) hauteur = masque de la silhouette, lissé (butte conforme à la forme)
  let h = new Float32Array(S * S)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = crownOpaque(x, y) ? 1 : 0
  for (let pass = 0; pass < 7; pass++) {
    const n = new Float32Array(S * S)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let s = 0, cnt = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue
          s += h[yy * S + xx]!; cnt++
        }
        n[y * S + x] = s / cnt
      }
    }
    h = n
  }
  // 2) FACETTES : hauteur moyenne par cellule → normale = gradient de cellule (facette plate)
  const cells = 8, cs = S / cells
  const H = new Float32Array(cells * cells)
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
    let s = 0
    for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) s += h[(cy * cs + y) * S + (cx * cs + x)]!
    H[cy * cells + cx] = s / (cs * cs)
  }
  const K = 3.2 // force du relief (grand = flancs plus inclinés = réponse directionnelle plus forte)
  const at = (cx: number, cy: number): number =>
    H[Math.min(cells - 1, Math.max(0, cy)) * cells + Math.min(cells - 1, Math.max(0, cx))]!
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const i = (py * S + px) * 4
      const cx = Math.min(cells - 1, Math.floor(px / cs)), cy = Math.min(cells - 1, Math.floor(py / cs))
      const dhx = at(cx + 1, cy) - at(cx - 1, cy)
      const dhy = at(cx, cy + 1) - at(cx, cy - 1)
      const [dx, dy, dz] = norm3(-dhx * K, -dhy * K, 1)
      d.data[i] = enc(dx)
      d.data[i + 1] = enc(FLIP_G ? -dy : dy)
      d.data[i + 2] = enc(dz)
      d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

/** Albédo UNIFORME du tronc : la colonne de `nd-tree_trunk`, à plat. */
function buildTrunkAlbedo(): HTMLCanvasElement {
  const { c, ctx } = newCanvas(16, 22)
  ctx.fillStyle = TRUNK_BROWN
  ctx.fillRect(6, 0, 4, 22)
  return c
}

/** Carte de normales du tronc : cylindre sur la colonne du fût (aligné 16×22). */
function buildTrunkNormal(): HTMLCanvasElement {
  const W = 16, H = 22
  const { c, ctx } = newCanvas(W, H)
  const d = ctx.createImageData(W, H)
  const x0 = 6, x1 = 10
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      let dx = 0, dy = 0, dz = 1
      if (x >= x0 && x < x1) {
        const t = ((x - x0 + 0.5) / (x1 - x0)) * 2 - 1
        ;[dx, dy, dz] = norm3(t * 0.9, 0, 0.7)
      }
      d.data[i] = enc(dx)
      d.data[i + 1] = enc(FLIP_G ? -dy : dy)
      d.data[i + 2] = enc(dz)
      d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

function register(scene: Phaser.Scene, key: string, albedo: HTMLCanvasElement, normal: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const tex = scene.textures.addCanvas(key, albedo)
  tex?.setDataSource(normal) // la normale, consommée par le shader quand `setLighting(true)`
}

/** Enregistre `nd-tree_crown_lit` / `nd-tree_trunk_lit` : albédo uniforme + normal map. */
export function generateLitTrees(scene: Phaser.Scene): void {
  register(scene, 'nd-tree_crown_lit', buildCrownAlbedo(), buildCrownNormal())
  register(scene, 'nd-tree_trunk_lit', buildTrunkAlbedo(), buildTrunkNormal())
}
