/**
 * LA RECETTE DE NORMALE — le module UNIQUE du pipeline `_lit` (spec da-feeling R1).
 *
 * Trois copies vivaient dans le code (lit-trees l'ancêtre, lit-props la généralisation, poi-lit
 * le surensemble) — la recopie de poi-lit était EXPLICITEMENT temporaire (découplage le temps
 * qu'un A/B se joue dans lit-props ; il est tranché et commité depuis). On factorise ICI la
 * version FINALE : celle de poi-lit, dont lit-props est le cas particulier exact
 * (`cell=2, plant=false, cracks=[]` — vérifié ligne à ligne, garde `max(2,…)` comprise :
 * bit-identique, le smoke `cubique` en témoigne).
 *
 * CE QUE LE MODULE SAIT, ET QUE PERSONNE NE DOIT RÉAPPRENDRE :
 *   • La normale se dérive de NOTRE canvas (getImageData), JAMAIS d'une texture Phaser générée
 *     (relecture WebGL incertaine).
 *   • FLIP_G : Phaser attend le vert « Y vers le haut » ; notre espace a Y vers le bas.
 *   • Le MIROIR est une texture `_lit_m` PRÉ-RETOURNÉE dont la normale se dérive DU canvas
 *     retourné — un setFlipX Phaser n'inverse pas le canal X de la normale (mesuré le 24/07).
 *   • Les OMBRES bakées (bandes 0,22, flaques 0,26) se peignent APRÈS la dérivation : le masque
 *     alpha les lirait comme de la MATIÈRE et affaisserait l'arête basse (épinglé le 25/07).
 *   • Les cadrans du 24/07 : petit prop blocky = `passes:1, k:3,5` ; grosse masse = `4 / 2,6` ;
 *     lieu de 42 px = `cell:3` (les facettes grossissent avec la masse, sinon la normale
 *     « grouille ») + base PLANTÉE + fissures gravées.
 */
import type Phaser from 'phaser'

export const FLIP_G = true // Phaser attend le vert « Y vers le haut » ; notre espace a Y vers le bas

export function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

export function enc(v: number): number {
  return Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)))
}

export function newCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  // `willReadFrequently` DÈS LA CRÉATION : ces canvas sont RELUS (getImageData) — par nous pour
  // dériver la normale, et par Phaser lui-même (`CanvasTexture` relit tout le canvas à
  // `addCanvas`). Les attributs de contexte ne s'appliquent qu'à la PREMIÈRE création : le
  // `{ willReadFrequently: true }` que Phaser passe ensuite sur le même canvas est IGNORÉ, d'où
  // les 166 avertissements Canvas2D au boot (mesuré le 26/07). Ils sont des SOURCES de texture,
  // jamais composités : les garder côté CPU est de toute façon le bon choix.
  return { c, ctx: c.getContext('2d', { willReadFrequently: true })! }
}

/** Une fissure = un CHEMIN (polyligne) qui PART d'un point réel (le sol, la jonction de deux
 *  pierres) et remonte en s'affinant. `crevasse` en élargit/creuse l'ORIGINE (path[0]). Elle
 *  creuse la NORMALE (un sillon) — le liseré d'albédo, lui, appartient au peintre. */
type Pt = readonly [number, number]
export interface Crack { path: readonly Pt[]; crevasse?: boolean }

/** Parcourt une polyligne à ~2 échantillons/px ; `fn(px, py, t)` avec t∈[0,1] de l'origine à la pointe. */
export function walkPath(path: readonly Pt[], fn: (px: number, py: number, t: number) => void): void {
  const seg: number[] = []
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    const L = Math.hypot(path[i + 1]![0] - path[i]![0], path[i + 1]![1] - path[i]![1])
    seg.push(L); total += L
  }
  if (total === 0) { fn(path[0]![0], path[0]![1], 0); return }
  let acc = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i]!, [x1, y1] = path[i + 1]!, L = seg[i]!
    const steps = Math.max(1, Math.ceil(L * 2))
    for (let s = 0; s <= steps; s++) { const f = s / steps; fn(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, (acc + L * f) / total) }
    acc += L
  }
}

/** Grave les fissures dans le champ de hauteur AVANT lissage : rayon et profondeur DÉCROISSENT
 *  de l'origine (large/creuse) vers la pointe (capillaire). On ne creuse que la matière (hf ≥ 0). */
function carveCracks(hf: Float32Array, w: number, h: number, cracks: readonly Crack[]): void {
  for (const cr of cracks) {
    const wide = cr.crevasse ? 2.2 : 1.5
    const deep = cr.crevasse ? 0.9 : 0.7
    walkPath(cr.path, (px, py, t) => {
      const rad = wide * (1 - t) + 0.55 * t
      const dep = deep * (1 - t) + 0.3 * t
      const r = Math.ceil(rad), cx = Math.round(px), cy = Math.round(py)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx, yy = cy + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const d = Math.hypot(dx, dy)
        if (d > rad) continue
        const idx = yy * w + xx
        hf[idx] = Math.max(0, hf[idx]! - dep * (1 - d / rad))
      }
    })
  }
}

/**
 * LA carte de normales : masque alpha → butte lissée (`passes`) → facettes de `cell` px →
 * gradient de cellule × `k`. `plant` = base plantée (le bord bas ne plonge plus — le galet ne
 * « roule » pas sous sa base) ; `cracks` = sillons gravés avant lissage.
 */
export function normalFromCanvas(
  src: HTMLCanvasElement,
  passes = 4,
  k = 2.6,
  cell = 2,
  plant = false,
  cracks: readonly Crack[] = [],
): HTMLCanvasElement {
  const w = src.width, h = src.height
  // Le drapeau ne mord que si `src` vient de `newCanvas` (il y est déjà) — on le redit ici pour
  // qu'un futur appelant qui apporterait SON canvas ne réintroduise pas l'avertissement.
  const srcData = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  let hf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) hf[i] = srcData[i * 4 + 3]! > 8 ? 1 : 0
  if (plant) {
    for (let x = 0; x < w; x++) {
      let lowest = -1
      for (let y = 0; y < h; y++) if (srcData[(y * w + x) * 4 + 3]! > 8) lowest = y
      for (let y = lowest + 1; y < h; y++) hf[y * w + x] = 1
    }
  }
  if (cracks.length) carveCracks(hf, w, h, cracks)
  for (let pass = 0; pass < passes; pass++) {
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
  const cellsX = Math.max(2, Math.round(w / cell)), cellsY = Math.max(2, Math.round(h / cell))
  const csx = w / cellsX, csy = h / cellsY
  const H = new Float32Array(cellsX * cellsY)
  for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
    let s = 0, cnt = 0
    for (let y = Math.floor(cy * csy); y < Math.floor((cy + 1) * csy); y++)
      for (let x = Math.floor(cx * csx); x < Math.floor((cx + 1) * csx); x++) { s += hf[y * w + x]!; cnt++ }
    H[cy * cellsX + cx] = cnt ? s / cnt : 0
  }
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
      const [nx, ny, nz] = norm3(-dhx * k, -dhy * k, 1)
      d.data[i] = enc(nx)
      d.data[i + 1] = enc(FLIP_G ? -ny : ny)
      d.data[i + 2] = enc(nz)
      d.data[i + 3] = 255
    }
  }
  out.ctx.putImageData(d, 0, 0)
  return out.c
}

/** Copie MIROIR horizontale d'un canvas — la matière première d'une `_lit_m`. */
export function mirrorCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, ctx } = newCanvas(src.width, src.height)
  ctx.translate(src.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(src, 0, 0)
  return c
}

/** Enregistre une texture `_lit` : l'albédo en canvas, la normale en dataSource. */
export function registerLit(scene: Phaser.Scene, key: string, albedo: HTMLCanvasElement, normal: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const tex = scene.textures.addCanvas(key, albedo)
  tex?.setDataSource(normal)
}
