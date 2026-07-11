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
