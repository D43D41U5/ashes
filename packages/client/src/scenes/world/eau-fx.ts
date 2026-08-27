/**
 * LES FX DE L'EAU — textures bakées une fois au boot (spec eau-vivante R5, R7).
 *
 * Trois familles, toutes dans la grammaire FX maison (cellules de 4 px, NEAREST,
 * paliers d'alpha francs — jamais un dégradé) :
 *   • fx-flottaison-0..2 — l'ANNEAU d'ondulation qui ceint un acteur immergé (3 phases
 *     de rayon, ellipse pointillée écrasée comme les remous du shader — YSQUASH) ;
 *   • fx-plouf-0..4 — la GERBE d'entrée dans l'eau : colonne centrale exagérée +
 *     gouttes discrètes de 1-2 cellules retombant en arc, SURJOUÉE (la grammaire de
 *     Medeiros : un splash timide ne se lit pas) ;
 *   • fx-pas-{humide,neige,cendre}-0..15 — LE PAS, cuit dans seize orientations, albédo `_lit` +
 *     normale analytique (voir `cuireEmpreintes` plus bas) ; l'alpha vit sur l'Image.
 */
import Phaser from 'phaser'
import { ORIENTATIONS, PAS_CV, rasterEmpreinte } from '../../render/empreintes'
import { FLIP_G, enc, newCanvas, registerLit } from '../../render/normal-map'

const G = 4

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

function nearest(scene: Phaser.Scene, key: string, cv: HTMLCanvasElement): void {
  scene.textures.addCanvas(key, cv)
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

export function ensureEauFxTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-flottaison-0')) return

  // ── L'ANNEAU DE FLOTTAISON : ellipse pointillée, 3 phases de rayon ──
  for (let k = 0; k < 3; k++) {
    const W = 36
    const H = 16
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const rx = 14 * (0.82 + 0.16 * k)
    const ry = rx * 0.42
    for (let cy = 0; cy < H / G; cy++) {
      for (let cx = 0; cx < W / G; cx++) {
        const dx = cx * G + G / 2 - W / 2
        const dy = cy * G + G / 2 - H / 2
        const rr = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
        if (Math.abs(rr - 1) > 0.34) continue
        if (hache(cx, cy, 7 + k) < 0.2) continue // pointillée : l'anneau respire
        const clair = rr < 1 // le bord intérieur (l'eau soulevée) est le plus clair
        ctx.fillStyle = clair ? 'rgba(226,238,246,0.9)' : 'rgba(198,216,230,0.55)'
        ctx.fillRect(cx * G, cy * G, G, G)
      }
    }
    nearest(scene, `fx-flottaison-${k}`, cv)
  }

  // ── LA GERBE : 5 frames — la colonne monte puis s'effondre, les gouttes s'évasent ──
  const COLONNE = [8, 14, 12, 7, 3] // hauteur px de la colonne par frame
  for (let f = 0; f < 5; f++) {
    const W = 28
    const H = 24
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const base = H - 2 // le pied de la gerbe (posé à la ligne de flottaison)
    // la colonne centrale : 2 cellules de large, blanche au cœur
    const hCol = COLONNE[f]!
    ctx.fillStyle = 'rgba(232,244,252,0.95)'
    ctx.fillRect(W / 2 - G, base - hCol, G * 2, hCol)
    if (hCol > 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.fillRect(W / 2 - G / 2 - 1, base - hCol, G, Math.max(2, hCol - 4))
    }
    // les gouttes : elles partent du sommet et retombent en arc en s'écartant
    const n = 3 + f
    for (let g = 0; g < n; g++) {
      const cote = g % 2 === 0 ? 1 : -1
      const evase = (2 + f * 2.6) * (0.6 + 0.5 * hache(g, f, 21))
      const gx = W / 2 + cote * evase
      const montee = hCol + 3 - (f >= 2 ? (f - 1) * 3 : 0) - hache(g, f, 22) * 4
      const gy = base - Math.max(1, montee)
      ctx.fillStyle = g % 3 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(214,232,244,0.8)'
      const taille = f < 3 ? 2 : 1
      ctx.fillRect(Math.round(gx), Math.round(gy), taille, taille)
    }
    nearest(scene, `fx-plouf-${f}`, cv)
  }

  // ── LES EMPREINTES : trois matières, seize orientations, une normale par variante ──
  for (const m of MATIERES_PAS) cuireEmpreintes(scene, m)
}

/**
 * ═══ L'EMPREINTE, MATIÈRE PAR MATIÈRE ET CAP PAR CAP ═══
 *
 * Elle était UNE image droite de 4×6 px à l'ombrage PEINT (bord haut sombre, arête basse claire).
 * Trois choses clochaient, et elles tombent ensemble :
 *
 *   ① ELLE NE TOURNAIT PAS. Un pas doit pointer où l'on va (`render/empreintes.ts`). On ne peut
 *      pas la tourner à l'affichage : une rotation Phaser ne tourne PAS le canal X de la normale
 *      (le même piège que le flip, mesuré le 24/07), et 4 px tournés au NEAREST se délavent. On
 *      cuit donc `ORIENTATIONS` variantes, chacune RASTÉRISÉE dans son repère — pixels francs.
 *
 *   ② ELLE N'AVAIT PAS DE NORMALE, donc pas de relief : un creux dans la neige est un TROU, et
 *      son ombre doit tourner avec le soleil comme celle de tout le décor cubique. La normale
 *      est ici ANALYTIQUE (une cuvette `h = −creux·(1−p²)(1−q²)`) et non dérivée de la silhouette
 *      — `normalFromCanvas` fabrique une BUTTE à partir d'un masque, or il nous faut son négatif,
 *      et quatre passes de lissage n'ont pas la place de vivre dans 8 px. Même dérogation que le
 *      tronc cylindrique de `lit-trees`, et les CONVENTIONS (encodage, `FLIP_G`, enregistrement)
 *      restent celles de `normal-map.ts` : il n'y a toujours qu'un seul endroit qui les sait.
 *
 *   ③ SON OMBRAGE ÉTAIT PEINT et se battait avec la lumière calculée (doctrine `_lit`). L'albédo
 *      ne garde donc que la MATIÈRE, plus une occlusion NON directionnelle (le fond d'un trou voit
 *      moins de ciel — c'est vrai à toute heure), jamais un hillshade.
 */

interface MatierePas {
  /** Le préfixe des textures : `<cle>-<orientation>`. */
  cle: string
  /** L'albédo — la MATIÈRE seule, sans ombrage directionnel. */
  rgb: readonly [number, number, number]
  alpha: number
  /** L'occlusion du fond (0..1) : de combien le cœur du creux s'assombrit, à toute heure. */
  occlusion: number
  /** La profondeur du creux pour la normale — 0 = décalque PLAT (une tache mouillée ne creuse rien). */
  creux: number
}

const MATIERES_PAS: readonly MatierePas[] = [
  // LA SEMELLE HUMIDE : une tache sombre, pas un trou. Normale plate — le sol mouillé reste le sol.
  { cle: 'fx-pas-humide', rgb: [20, 16, 10], alpha: 0.85, occlusion: 0.15, creux: 0 },
  // LA NEIGE : un vrai creux. L'albédo est la neige elle-même (à peine bleutée) ; tout le reste
  // vient de la lumière — c'est ce qui fait que la piste tourne son ombre avec le soleil.
  { cle: 'fx-pas-neige', rgb: [214, 228, 244], alpha: 0.95, occlusion: 0.34, creux: 1.35 },
  // LA CENDRE : le pied enfonce la poudre et découvre le brûlé dessous — sombre, et creusé.
  { cle: 'fx-pas-cendre', rgb: [58, 50, 46], alpha: 0.8, occlusion: 0.3, creux: 1.15 },
]

/** Cuit les `ORIENTATIONS` variantes d'une matière. La FORME et la NORMALE viennent de
 *  `render/empreintes.ts` (pur, testé) ; ici on ne fait que peindre et enregistrer. */
function cuireEmpreintes(scene: Phaser.Scene, m: MatierePas): void {
  for (let k = 0; k < ORIENTATIONS; k++) {
    const pixels = rasterEmpreinte(k, m.creux)
    const alb = newCanvas(PAS_CV, PAS_CV)
    const nrm = newCanvas(PAS_CV, PAS_CV)
    const da = alb.ctx.createImageData(PAS_CV, PAS_CV)
    const dn = nrm.ctx.createImageData(PAS_CV, PAS_CV)
    for (let j = 0; j < pixels.length; j++) {
      const px = pixels[j]!
      const i = j * 4
      if (px.dedans) {
        const ao = 1 - m.occlusion * px.cuve
        da.data[i] = Math.round(m.rgb[0] * ao)
        da.data[i + 1] = Math.round(m.rgb[1] * ao)
        da.data[i + 2] = Math.round(m.rgb[2] * ao)
        da.data[i + 3] = Math.round(255 * m.alpha)
      }
      dn.data[i] = enc(px.nx)
      dn.data[i + 1] = enc(FLIP_G ? -px.ny : px.ny)
      dn.data[i + 2] = enc(px.nz)
      dn.data[i + 3] = 255
    }
    alb.ctx.putImageData(da, 0, 0)
    nrm.ctx.putImageData(dn, 0, 0)
    const cle = `${m.cle}-${k}`
    registerLit(scene, cle, alb.c, nrm.c)
    // NEAREST : la caméra zoome ×3,4 (`zoomForFraming`) — un pas de 4 px y occupe 14 px d'écran,
    // et un filtre linéaire en ferait une bavure au lieu d'une semelle.
    scene.textures.get(cle).setFilter(Phaser.Textures.FilterMode.NEAREST)
  }
}
