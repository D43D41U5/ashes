/**
 * LES POI EN DA CUBIQUE — pilote sur le BLOC ERRATIQUE (demande d'Alexis 2026-07-25).
 *
 * Aujourd'hui les 26 lieux sont PEINTS à la main (hillshade cuit, ellipses — voir
 * `world/poi-art.ts`), rendus en images statiques HORS du pipeline d'éclairage. La DA
 * « tout-ou-rien » (docs/decisions.md 2026-07-20) veut l'inverse : albédo APLATI + carte
 * de NORMALES dérivée de la silhouette, relief 100 % calculé par la lumière (`setLighting(true)`).
 *
 * Ce module porte cette recette AUX POI, sur le seul erratique pour l'instant : on en tire
 * TROIS variantes de silhouette (`ERRATIQUES`), chacune enregistrée en `poi-erratique-<i>_lit`
 * (albédo + normale en dataSource). Le câblage de `PoiLayer` sur le pipeline (swap `_lit` +
 * `setLighting`) attend qu'Alexis ait CHOISI une variante — ici on ne fait que fabriquer et
 * exposer les textures, pour les montrer (scénario smoke `erratique`).
 *
 * Helpers VOLONTAIREMENT recopiés de `render/lit-props.ts` (et non importés) : ce fichier-là
 * est en cours d'édition dans une autre session (A/B sur l'ordre ombre/normale), on s'en
 * découple. La seule vraie différence : `normalFromCanvas` prend une taille de CELLULE — à
 * 42 px un lieu a besoin de facettes plus GROSSES qu'un caillou de 16 px, sinon la normale
 * grouille au lieu de montrer quelques plans francs.
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

// ── FISSURES ──────────────────────────────────────────────────────────────────────────────────
/** Une fissure = un CHEMIN (polyligne) qui PART d'un point réel (le sol, la jonction de deux
 *  pierres, une fracture) et remonte en s'affinant. `crevasse` en élargit/creuse l'ORIGINE (path[0])
 *  — une petite crevasse là où la pierre travaille le plus. Elle creuse la normale (un sillon) en
 *  plus d'un liseré d'albédo. */
type Pt = readonly [number, number]
export interface Crack { path: readonly Pt[]; crevasse?: boolean }

/** Parcourt une polyligne à ~2 échantillons/px ; `fn(px, py, t)` avec t∈[0,1] de l'origine à la pointe. */
function walkPath(path: readonly Pt[], fn: (px: number, py: number, t: number) => void): void {
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

/** Grave les fissures dans le champ de hauteur AVANT lissage : chaque chemin abaisse `hf` d'un
 *  sillon dont le rayon et la profondeur DÉCROISSENT de l'origine (large/creux, la crevasse) vers la
 *  pointe (capillaire). Le relief du sillon sort ensuite de la normale — un flanc s'éclaire, l'autre
 *  s'ombre. On ne creuse que la matière (hf reste ≥ 0). */
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
 * Carte de normales dérivée du masque alpha (butte lissée → facettes). `cell` = taille du
 * facet en px : GROS pour une masse de lieu (plans larges, pas de grouillement), petit pour un
 * prop. `passes` (lissage) et `k` (gain) restent les deux cadrans du « cubique » (cf. lit-props).
 *
 * `plant` = BASE PLANTÉE. Sans lui, la silhouette est traitée comme une bosse : TOUS les bords
 * s'inclinent vers l'extérieur, dont le bord du BAS qui plonge vers le sud → normale tournée vers
 * le bas → NON éclairée (la lumière vient d'en haut) → un liseré sombre qui fait ROULER la base
 * sous le bloc (galet qui flotte) et double l'ombre de contact. `plant` prolonge la matière sous
 * le plus bas pixel opaque de chaque colonne : le bord du bas ne plonge plus, la base reste
 * franche et éclairée, et c'est l'ombre de contact (albédo) SEULE qui l'ancre au sol. */
function normalFromCanvas(src: HTMLCanvasElement, passes = 1, k = 3.5, cell = 3, plant = false, cracks: readonly Crack[] = []): HTMLCanvasElement {
  const w = src.width, h = src.height
  const srcData = src.getContext('2d')!.getImageData(0, 0, w, h).data
  let hf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) hf[i] = srcData[i * 4 + 3]! > 8 ? 1 : 0
  // BASE PLANTÉE : sous le plus bas pixel opaque de chaque colonne, on remplit la hauteur à 1 (la
  // pierre s'enfonce dans le sol). Le bord du bas n'a plus de pente → il regarde droit, pas vers le
  // bas. N'ajoute AUCUN pixel visible (l'albédo y est transparent) : ne change QUE le gradient du bord.
  if (plant) {
    for (let x = 0; x < w; x++) {
      let lowest = -1
      for (let y = 0; y < h; y++) if (srcData[(y * w + x) * 4 + 3]! > 8) lowest = y
      for (let y = lowest + 1; y < h; y++) hf[y * w + x] = 1
    }
  }
  // FISSURES : on les grave dans la hauteur (sillons) AVANT lissage → relief de crevasse dans la normale.
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

function register(scene: Phaser.Scene, key: string, albedo: HTMLCanvasElement, normal: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const tex = scene.textures.addCanvas(key, albedo)
  tex?.setDataSource(normal)
}

// ── Matière (albédo PLAT — le relief vient de la lumière, pas d'un hillshade peint) ──
const STONE_A = '#8b847a' // la grande masse
const STONE_B = '#7b756b' // un second bloc, légère variation de matière
const QUARTZ = '#c7c1b2' // une veine claire / une face fraîchement fracturée
const MOSS = '#43592f' // un peu de mousse, au nord
// Météorisation — de la MATIÈRE, pas de l'ombrage : fissures, mousse variée, grain minéral, lichen.
const CRACK = '#4f4840' // une fissure franche (pierre fendue, pas noire)
const CRACK2 = '#5f584e' // une fissure plus discrète / capillaire
const MOSS_BR = '#5c7838' // mousse plus vive (là où la lumière porte)
const MOSS_DK = '#38502a' // mousse d'ombre, dans les creux
const LICHEN = '#a8a493' // une pastille de lichen pâle
const GRAIN_D = '#7d766c' // grain minéral, un ton sous la masse
const GRAIN_L = '#978f84' // grain minéral, un ton au-dessus

/** Un bloc : son rect et son ton. La SILHOUETTE (l'union des rects, avec ses fentes d'1 px)
 *  porte tout le relief ; le ton n'est qu'un matériau, pas un ombrage. */
type Block = { rect: readonly [number, number, number, number]; tone: string }
/** Une marque de matière (veine, mousse, fissure, grain, lichen) — peinte DANS la masse. */
type Accent = { rect: readonly [number, number, number, number]; color: string }
/** `accents` = les traits FORTS (veine, mousse maîtresse) ; `details` = la météorisation fine
 *  (fissures, grain, lichen). Les deux sont peints en `source-atop` (clippés à la silhouette) donc
 *  ne DÉBORDENT jamais la forme et n'altèrent pas la normale — voir `drawErratic`. */
interface ErraticVariant { key: string; name: string; blocks: readonly Block[]; accents?: readonly Accent[]; details?: readonly Accent[]; cracks?: readonly Crack[] }

export const ERRATIQUE_SIZE = 42

/**
 * TROIS blocs erratiques — un caillou de glacier posé là, dont le sujet est la MASSE, le POIDS
 * (pas une arête). Le cubique donne des arêtes franches par construction : chaque variante cherche
 * donc à garder le POIDS malgré la facette. Silhouettes VOULUES DISTINCTES entre elles ET du Cairn
 * (petite pile nette) et de la Grotte (masse à gueule noire) — lisibles en ombre chinoise.
 */
export const ERRATIQUES: readonly ErraticVariant[] = [
  // 0 — LE MONOLITHE FENDU : UNE SEULE masse trapue, soudée au sol par une base large, qui monte en
  //     deux pics INÉGAUX séparés par une faille (le gel a fendu la couronne, pas coupé le bloc). Pas
  //     deux pierres parallèles — un poids unique, fissuré, asymétrique.
  {
    key: 'erratique-0',
    name: 'monolithe fendu',
    blocks: [
      { rect: [8, 30, 27, 10], tone: STONE_A }, // la base large : elle SOUDE les deux pics au sol
      { rect: [8, 11, 13, 29], tone: STONE_A }, // le pic gauche, haut
      { rect: [10, 8, 10, 4], tone: STONE_A }, //  son sommet, en retrait (chanfrein)
      { rect: [23, 17, 12, 23], tone: STONE_B }, // le pic droit, plus bas — il penche vers l'ouest
      { rect: [24, 14, 10, 4], tone: STONE_B }, //  son sommet
    ],
    accents: [
      { rect: [12, 16, 2, 18], color: QUARTZ }, // la faille claire descend sur la face gauche
      { rect: [10, 8, 6, 3], color: MOSS }, //     la mousse, au sommet nord
    ],
    details: [
      // grain minéral (bandes discrètes)
      { rect: [9, 21, 6, 1], color: GRAIN_D }, { rect: [24, 26, 8, 1], color: GRAIN_L },
      // mousse variée — pied nord et sommet du pic droit
      { rect: [8, 30, 6, 2], color: MOSS_DK }, { rect: [23, 17, 5, 2], color: MOSS_BR }, { rect: [17, 12, 3, 2], color: MOSS },
      // lichen + une pointe de quartz
      { rect: [26, 25, 1, 1], color: LICHEN }, { rect: [12, 33, 1, 1], color: LICHEN }, { rect: [31, 20, 1, 1], color: QUARTZ },
    ],
    cracks: [
      { path: [[13, 39], [14, 34], [15, 28], [15, 22]], crevasse: true }, // du SOL, remonte le pic gauche en s'affinant
      { path: [[21, 31], [19, 35], [17, 38]], crevasse: true }, //           du PIED DE LA FAILLE (jonction) vers le sol
      { path: [[29, 39], [29, 33], [28, 27], [29, 22]], crevasse: true }, // du SOL, remonte le pic droit
    ],
  },
  // 1 — LE BLOC COIFFÉ (« balancé ») : une base trapue, un SOCLE étroit, et un cube LARGE posé dessus
  //     qui déborde de part et d'autre — le rocher en équilibre improbable des glaciers. Le col serré
  //     entre base et cube est la signature : ni un cairn (pile régulière) ni une grotte (gueule noire).
  {
    key: 'erratique-1',
    name: 'bloc coiffé',
    blocks: [
      { rect: [4, 33, 33, 7], tone: STONE_A }, //  le pied, écrasé, débordant
      { rect: [7, 26, 26, 8], tone: STONE_A }, //  le corps de la base
      { rect: [21, 22, 9, 4], tone: STONE_A }, //  le SOCLE étroit — le point d'équilibre
      { rect: [16, 10, 18, 12], tone: STONE_B }, // le cube coiffant, LARGE, débordant son socle
      { rect: [18, 7, 13, 3], tone: STONE_B }, //  son sommet
    ],
    accents: [
      { rect: [20, 13, 2, 8], color: QUARTZ }, // veine sur le cube
      { rect: [7, 26, 7, 3], color: MOSS }, //    mousse au flanc nord de la base
    ],
    details: [
      // grain
      { rect: [8, 31, 7, 1], color: GRAIN_D }, { rect: [19, 15, 10, 1], color: GRAIN_L },
      // mousse — creux sous la coiffe (ombre), flanc de base, sommet
      { rect: [17, 19, 6, 2], color: MOSS_DK }, { rect: [7, 29, 6, 2], color: MOSS_BR }, { rect: [26, 10, 4, 2], color: MOSS },
      // lichen + quartz
      { rect: [28, 16, 1, 1], color: LICHEN }, { rect: [10, 37, 1, 1], color: LICHEN }, { rect: [23, 24, 1, 1], color: QUARTZ },
    ],
    cracks: [
      { path: [[23, 22], [22, 28], [21, 33], [20, 38]], crevasse: true }, // de la JONCTION cube/socle, descend la base
      { path: [[12, 39], [12, 33], [13, 28]], crevasse: true }, //          du SOL, remonte la base
      { path: [[25, 22], [25, 17], [24, 12]] }, //                          repart de la jonction, monte dans le cube
    ],
  },
  // 2 — LE BLOC ET SON ÉCLAT : une masse SQUAT et large, à gradins (coin NE cassé net = face fraîche),
  //     avec un ÉCLAT détaché tombé à l'est. Le plus BAS et le plus large — trapu, cassé. Une masse
  //     dominante + un petit éclat ≠ une pile (cairn) ni une gueule (grotte).
  {
    key: 'erratique-2',
    name: 'bloc et son éclat',
    blocks: [
      { rect: [5, 20, 26, 20], tone: STONE_A }, // la masse principale, squat
      { rect: [7, 16, 20, 4], tone: STONE_A }, //  un gradin
      { rect: [9, 13, 12, 3], tone: STONE_A }, //  le sommet, plus étroit — le coin NE est cassé
      { rect: [33, 30, 7, 10], tone: STONE_B }, // l'éclat détaché, à l'est (fente d'1 px)
    ],
    accents: [
      { rect: [26, 20, 4, 18], color: QUARTZ }, // la FACE FRAÎCHE d'où l'éclat s'est détaché
      { rect: [9, 13, 8, 3], color: MOSS }, //     mousse au sommet nord
    ],
    details: [
      // grain
      { rect: [6, 28, 10, 1], color: GRAIN_D }, { rect: [17, 24, 8, 1], color: GRAIN_L },
      // mousse — creux du pied, sommet nord, base de l'éclat
      { rect: [6, 36, 7, 2], color: MOSS_DK }, { rect: [9, 16, 7, 2], color: MOSS_BR }, { rect: [33, 36, 4, 2], color: MOSS },
      // lichen + quartz
      { rect: [11, 29, 1, 1], color: LICHEN }, { rect: [23, 22, 1, 1], color: LICHEN }, { rect: [27, 25, 1, 1], color: QUARTZ },
    ],
    cracks: [
      { path: [[30, 31], [26, 29], [22, 27], [18, 25]], crevasse: true }, // part de la FACE FRAÎCHE (là où l'éclat s'est arraché)
      { path: [[20, 37], [19, 32], [18, 26]], crevasse: true }, //           du SOL, rejoint la première (une patte)
      { path: [[13, 39], [13, 33], [14, 28], [14, 23]], crevasse: true }, // du SOL, remonte la grande face
      { path: [[36, 39], [36, 34], [35, 31]], crevasse: true }, //          l'éclat se fend depuis le sol
    ],
  },
] as const

/** Combien de variantes du bloc erratique. */
export const ERRATIQUE_COUNT = ERRATIQUES.length
/** La clé de texture `_lit` d'une variante (SEULE fabrique — PoiLayer pose, ce module génère). */
export function litErratiqueKey(i: number): string { return `poi-${ERRATIQUES[i]!.key}_lit` }
/** Choix DÉTERMINISTE d'une variante pour un POI, à partir de son identité STABLE (son poiId) : même
 *  lieu → toujours la même pierre, les trois réparties ~également (hash entier mélangé). Purement
 *  CLIENT (rendu) — aucune incidence sur la sim ni le déterminisme du replay. */
export function erratiqueVariantFor(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 2654435761)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) % ERRATIQUE_COUNT
}

/** L'ombre de contact au pied de CHAQUE bloc (recette 2026-07-25) : une bande sombre d'1-2 px
 *  sous chaque bloc, débordant, pour qu'il POSE au lieu de flotter. Peinte APRÈS la normale
 *  (assombrit l'albédo seul) — sinon `normalFromCanvas` la lit comme de la matière et affaisse
 *  l'arête basse. Un bloc posé sur un autre projette donc son ombre sur la face de dessous. */
const SHADOW = { color: '#000000', alpha: 0.26, h: 2, overhang: 1, minW: 5 } as const

function contactBands(v: ErraticVariant): readonly (readonly [number, number, number, number])[] {
  return v.blocks.map(({ rect: [x, y, w, h] }) => {
    const o = w >= SHADOW.minW ? SHADOW.overhang : 0
    return [x - o, y + h, w + 2 * o, SHADOW.h] as const
  })
}

function drawErratic(ctx: CanvasRenderingContext2D, v: ErraticVariant): void {
  for (const { rect: [x, y, w, h], tone } of v.blocks) { ctx.fillStyle = tone; ctx.fillRect(x, y, w, h) }
  // Les marques de matière (accents + météorisation) en SOURCE-ATOP : elles ne peignent QUE là où la
  // masse est déjà opaque → jamais un débord de silhouette (donc normale intacte), et on peut les
  // placer sans compter les pixels. On restaure source-over derrière soi.
  ctx.globalCompositeOperation = 'source-atop'
  for (const { rect: [x, y, w, h], color } of v.accents ?? []) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) }
  for (const { rect: [x, y, w, h], color } of v.details ?? []) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) }
  // Le liseré au FOND du sillon : discret (le relief de la normale fait le gros du travail), un peu
  // plus marqué et large à l'origine (la crevasse). Aligné pixel sur le chemin gravé dans la normale.
  for (const cr of v.cracks ?? []) {
    walkPath(cr.path, (px, py, t) => {
      const x = Math.round(px), y = Math.round(py)
      ctx.fillStyle = cr.crevasse && t < 0.3 ? CRACK : CRACK2
      ctx.fillRect(x, y, 1, 1)
      if (cr.crevasse && t < 0.22) ctx.fillRect(x, y + 1, 1, 1) // crevasse : un pixel de plus à l'origine
    })
  }
  ctx.globalCompositeOperation = 'source-over'
}

function shadeErratic(ctx: CanvasRenderingContext2D, v: ErraticVariant): void {
  ctx.fillStyle = SHADOW.color
  ctx.globalAlpha = SHADOW.alpha
  for (const [x, y, w, h] of contactBands(v)) ctx.fillRect(x, y, w, h)
  ctx.globalAlpha = 1
}

/** Enregistre les `poi-erratique-<i>_lit` (albédo aplati + normale, BASE PLANTÉE). Appelé au boot.
 *  La normale se dérive de la masse SEULE (avant l'ombre de contact), puis l'ombre assombrit
 *  l'albédo. On enregistre aussi `-curl_lit` (bord du bas qui plonge, AVANT) — pour la contre-épreuve
 *  du scénario smoke `erratique` uniquement ; à retirer quand la base plantée sera validée. */
export function generateLitErratiques(scene: Phaser.Scene): void {
  const S = ERRATIQUE_SIZE
  for (const v of ERRATIQUES) {
    const alb = newCanvas(S, S)
    drawErratic(alb.ctx, v)
    const nrm = normalFromCanvas(alb.c, 1, 3.5, 3, true, v.cracks) // base PLANTÉE + sillons de fissure
    const nrmCurl = normalFromCanvas(alb.c, 1, 3.5, 3, false, v.cracks) // AVANT : bord du bas qui plonge (comparaison)
    shadeErratic(alb.ctx, v) // puis l'ombre de contact, sur l'albédo uniquement
    register(scene, `poi-${v.key}_lit`, alb.c, nrm)
    register(scene, `poi-${v.key}-curl_lit`, alb.c, nrmCurl)
  }
}
