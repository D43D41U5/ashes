/**
 * LE CHAMP D'EAU — ce que le shader a besoin de savoir de la carte, cuit une
 * fois, en une texture de 1 px par tuile (même résolution que le bake du sol).
 *
 * Pur : aucun import Phaser, donc testable en Node. Le wrapper qui en fait une
 * texture WebGL vit dans `scenes/world/water-layer.ts`.
 *
 *   R — LE MASQUE, et il est BINAIRE : 1 dans l'eau, 0 sur la terre. Rien entre
 *       les deux, et c'est essentiel. En filtrage linéaire, un masque binaire
 *       croise 0,5 EXACTEMENT sur la frontière entre deux tuiles : le shader tient
 *       donc son trait de rive au bon endroit, au pixel près. La première version
 *       encodait la profondeur dans ce canal (0,45 pour un haut-fond) — l'eau
 *       débordait alors d'une demi-tuile sur l'herbe, et son écume avec elle.
 *   G — ÉLÉVATION. Nécessaire pour DÉFAIRE le cisaillement du relief : le sol est
 *       dessiné à `screenY = worldY·TILE − elev·H`, et le shader, lui, part d'un
 *       pixel écran. Sans ce canal il ne saurait pas de quelle tuile il parle, et
 *       l'eau glisserait sur ses berges.
 *   B — PROFONDEUR : 1 au large, 0 sur le haut-fond. C'est du GAMEPLAY autant que
 *       de la couleur — le haut-fond est le gué, et il doit se voir.
 *   A — 1, toujours. Un canal alpha non plein serait prémultiplié à l'upload et
 *       corromprait les trois autres.
 *
 * La distance au rivage n'est PAS cuite ici : le shader la déduit du masque en
 * le sondant sur quelques tuiles autour de lui. C'est plus juste (elle suit la
 * berge, pas une grille) et ça épargne un canal.
 */

/** Les deux terrains d'eau (ids de `TERRAINS`, sim/balance.ts). */
const SHALLOW = 4
const DEEP = 6

/** Portée du champ de rive, en tuiles (bornée par l'encodage 128 ± d×16 sur un octet). */
export const RIVE_MAX_TILES = 7.9

/**
 * LE CHAMP DE RIVE (spec eau-vivante R1) — la distance SIGNÉE à la rive : positive dans
 * l'eau, négative sur terre, ZÉRO pile sur la frontière des tuiles. Un SDF de berge.
 *
 * Deux chanfreins 3-4 (vers la terre, vers l'eau) donnent la distance au CENTRE de la
 * tuile opposée la plus proche ; on retranche une demi-tuile pour que le zéro tombe sur
 * l'ARÊTE — ainsi un bilinéaire (GPU manuel ou CPU) croise 0 exactement sur le trait de
 * rive que le masque binaire dessine déjà. Encodage texture : `128 + d×16` (1/16 tuile).
 *
 * Une SEULE vérité de « où est l'eau » : l'écume, le lit, le sol humide, l'immersion des
 * acteurs, les événements de franchissement et le volume du clapotis lisent tous ce champ.
 */
export interface RiveField {
  /** Distance signée en TUILES (+eau / −terre), par tuile. */
  sd: Float32Array
  /** RGBA prêt pour la texture : R = 128 + clamp(sd, ±7,9)×16, A = 255. */
  data: Uint8ClampedArray
  width: number
  height: number
}

function chanfrein(estSource: (i: number) => boolean, width: number, height: number): Uint16Array {
  const CAP = Math.ceil((RIVE_MAX_TILES + 1) * 3)
  const d = new Uint16Array(width * height).fill(CAP)
  for (let i = 0; i < width * height; i++) if (estSource(i)) d[i] = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let v = d[i]!
      if (v === 0) continue
      if (x > 0) v = Math.min(v, d[i - 1]! + 3)
      if (y > 0) {
        v = Math.min(v, d[i - width]! + 3)
        if (x > 0) v = Math.min(v, d[i - width - 1]! + 4)
        if (x < width - 1) v = Math.min(v, d[i - width + 1]! + 4)
      }
      d[i] = Math.min(v, CAP)
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      let v = d[i]!
      if (v === 0) continue
      if (x < width - 1) v = Math.min(v, d[i + 1]! + 3)
      if (y < height - 1) {
        v = Math.min(v, d[i + width]! + 3)
        if (x < width - 1) v = Math.min(v, d[i + width + 1]! + 4)
        if (x > 0) v = Math.min(v, d[i + width - 1]! + 4)
      }
      d[i] = Math.min(v, CAP)
    }
  }
  return d
}

export function buildRiveField(terrain: ArrayLike<number>, width: number, height: number): RiveField {
  const eau = (i: number): boolean => terrain[i] === SHALLOW || terrain[i] === DEEP
  const versEau = chanfrein(eau, width, height) // 0 dans l'eau, croît sur terre
  const versTerre = chanfrein((i) => !eau(i), width, height) // 0 sur terre, croît dans l'eau
  const sd = new Float32Array(width * height)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    // La demi-tuile retranchée place le zéro sur l'ARÊTE entre deux centres voisins.
    const d = eau(i) ? versTerre[i]! / 3 - 0.5 : -(versEau[i]! / 3 - 0.5)
    const borne = Math.max(-RIVE_MAX_TILES, Math.min(RIVE_MAX_TILES, d))
    sd[i] = borne
    const o = i * 4
    data[o] = Math.round(128 + borne * 16)
    data[o + 3] = 255
  }
  return { sd, data, width, height }
}

/** Lecture CPU bilinéaire du champ (x, y en tuiles) — la même distance que le shader. */
export function riveAt(field: RiveField, x: number, y: number): number {
  const px = x - 0.5
  const py = y - 0.5
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const fx = px - ix
  const fy = py - iy
  const lit = (tx: number, ty: number): number => {
    const cx = Math.max(0, Math.min(field.width - 1, tx))
    const cy = Math.max(0, Math.min(field.height - 1, ty))
    return field.sd[cy * field.width + cx]!
  }
  const a = lit(ix, iy)
  const b = lit(ix + 1, iy)
  const c = lit(ix, iy + 1)
  const d = lit(ix + 1, iy + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

export interface WaterField {
  /** RGBA, 4 octets par tuile, `width × height`. */
  data: Uint8ClampedArray
  width: number
  height: number
  /** Faux si la carte n'a pas une seule tuile d'eau — inutile de monter la couche. */
  hasWater: boolean
}

export function buildWaterField(
  terrain: ArrayLike<number>,
  elevation: ArrayLike<number> | undefined,
  width: number,
  height: number,
): WaterField {
  const data = new Uint8ClampedArray(width * height * 4)
  let hasWater = false

  for (let i = 0; i < width * height; i++) {
    const t = terrain[i]
    const wet = t === SHALLOW || t === DEEP
    if (wet) hasWater = true

    const o = i * 4
    data[o] = wet ? 255 : 0 // masque BINAIRE — voir l'en-tête
    data[o + 1] = Math.round(Math.min(1, Math.max(0, elevation?.[i] ?? 0)) * 255)
    data[o + 2] = t === DEEP ? 255 : 0
    data[o + 3] = 255
  }

  return { data, width, height, hasWater }
}
