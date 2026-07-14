/**
 * L'ART DES FALAISES — une PAROI, et elle a désormais une HAUTEUR QU'ON COMPTE.
 *
 * La falaise est LE SQUELETTE de la carte (« on ne trouve pas une porte, on suit un mur »). Elle a
 * d'abord été une tache sombre plate (Alexis : *« les falaises ne ressemblent pas à des falaises, à
 * des blocs noirs »*), puis une paroi dessinée de DEUX tuiles de haut, toujours la même, quel que
 * soit le dénivelé qu'elle gardait. C'était encore un mensonge : **un mur qui sépare le palier 1 du
 * palier 5 ne peut pas avoir la même taille qu'un ressaut d'un cran.**
 *
 * ═══ LA CONTREMARCHE — la face, et elle vaut Δ MARCHES ═══
 *
 * Le rendu en marches (spec R34) donne la réponse, et il la donne *gratuitement*. Le sol est soulevé
 * de `palier × STEP_PX` : entre une tuile et sa voisine du sud, plus basse de Δ paliers, s'ouvre
 * donc un trou de **`Δ × STEP_PX` pixels exactement**. Ce trou n'est pas un défaut à boucher, c'est
 * la FACE — il a la hauteur juste, par construction. On n'a rien à calculer : on la remplit.
 *
 * D'où une texture par Δ (1 à 6), au lieu d'un auto-raccord à trois familles :
 *
 *   — LE DESSUS (`top`) : la surface du plateau. Roche froide, mouchetée, avec un LISERÉ éclairé
 *     sur les bords ouverts au nord et à l'ouest (le soleil du projet est au nord-ouest).
 *   — LA CONTREMARCHE (`riser`) : le MUR, haut de `Δ × STEP_PX`. Elle porte, de haut en bas, la
 *     LÈVRE (la ligne claire du rebord — le signe le plus lisible de tout le système, c'est elle
 *     qu'on suit à l'écran quand on longe un mur), des strates horizontales, des fissures
 *     verticales, et l'ASSISE sombre au pied, là où le mur touche terre.
 *   — L'OMBRE PORTÉE, posée sur le sol au pied de la face : c'est elle qui donne la hauteur. Un mur
 *     sans ombre est un papier peint.
 *
 * **Une falaise de quatre paliers est donc quatre fois plus haute qu'un ressaut d'un.** On la voit,
 * on la mesure de l'œil, et on sait avant d'approcher que ce qui est derrière n'est pas pour
 * aujourd'hui. *La géographie s'annonce sans une ligne d'UI.*
 *
 * LA PALETTE EST CONSTANTE, ET C'EST UNE DÉCISION. On ne module PAS la falaise par la teinte de
 * sa zone (contrairement au sol) : le squelette doit se reconnaître PARTOUT au premier regard —
 * c'était précisément le défaut du Gouffre, où l'aplat sombre se noyait dans le sol sombre. Une
 * ardoise froide, violette-grise, sans parent dans les terrains : ni la roche (chaude), ni
 * l'éboulis (pâle), ni le mur bâti (brun).
 *
 * Tout est en RECTANGLES — du pixel-art de code, et c'est la direction artistique du projet depuis
 * le 2026-07-14 : des angles droits, pour l'art comme pour la carte.
 *
 * Déterminisme : deux variantes par tuile, choisies par `hash2(tx, ty)` — pur, stable, sans état.
 */
import type Phaser from 'phaser'

/** La palette de l'ardoise — constante sur toute la carte (voir l'en-tête). */
const TOP_BASE = 0x4b4852
const TOP_DARK = 0x3e3b46
const TOP_LIGHT = 0x5b5765
const RIM_N = 0x8b8894 // liseré nord : le soleil est au nord-ouest
const RIM_W = 0x716d7c
const RIM_E = 0x232028 // bord est : à l'ombre
const BROW = 0xa19dab // LA LÈVRE — la ligne la plus claire du système : c'est elle qu'on longe
const FACE_BASE = 0x322e3a
const FACE_UP = 0x3a3644 // le haut du mur, un rien plus clair : la lumière vient d'en haut
const STRATA = 0x272430
const CRACK = 0x1e1b25
const FLECK = 0x4e4a5a
const FOOT = 0x17151d // l'assise, au ras du sol

export const CLIFF_TILE_PX = 16

/** Le dénivelé le plus haut qu'une contremarche sache dessiner, en paliers. La table de `/sim`
 *  plafonne à 5 ; on garde un cran de marge pour ne jamais manquer une texture. */
export const RISER_MAX = 6

/** Clé d'une tuile de DESSUS de plateau. `mask` encode les bords ouverts (N/E/O). */
export function cliffKey(family: 'top', mask: number, variant: number): string {
  return `cf-${family}-${mask}-${variant}`
}

/** Clé d'une CONTREMARCHE de `d` paliers. `mask` : bit 1 = est ouvert, bit 2 = ouest ouvert. */
export function riserKey(d: number, mask: number, variant: number): string {
  return `cf-riser-${d}-${mask}-${variant}`
}

export const CLIFF_SHADOW_KEY = 'cf-shadow'

/**
 * Génère les textures de paroi — appelé une fois au boot, comme les nœuds et les lieux.
 * Dessus : 8 masques × 2 variantes. Contremarches : 6 hauteurs × 4 masques × 2 variantes.
 */
export function makeCliffTextures(scene: Phaser.Scene, stepPx: number): void {
  const g = scene.add.graphics()
  const px = (c: number, x: number, y: number, w = 1, h = 1): void => {
    g.fillStyle(c).fillRect(x, y, w, h)
  }

  // ── LE DESSUS — mask : bit 1 = nord ouvert, bit 2 = est ouvert, bit 4 = ouest ouvert ──
  for (let mask = 0; mask < 8; mask++) {
    for (let v = 0; v < 2; v++) {
      g.fillStyle(TOP_BASE).fillRect(0, 0, 16, 16)
      // La roche mouchetée — deux semis fixes, pour que deux tuiles voisines ne se répètent pas.
      const dark: Array<[number, number]> = v === 0
        ? [[3, 4], [9, 2], [13, 7], [5, 11], [11, 13], [7, 8]]
        : [[2, 6], [8, 4], [12, 10], [4, 13], [14, 3], [6, 2]]
      const light: Array<[number, number]> = v === 0
        ? [[6, 5], [12, 3], [2, 10], [10, 11], [14, 14]]
        : [[4, 3], [10, 7], [13, 12], [3, 8], [7, 14]]
      for (const [x, y] of dark) px(TOP_DARK, x, y, 2, 1)
      for (const [x, y] of light) px(TOP_LIGHT, x, y, 1, 1)
      // Une fissure de surface, en équerre — pas une diagonale : la DA est aux angles droits.
      if (v === 0) { px(TOP_DARK, 5, 6, 3, 1); px(TOP_DARK, 8, 6, 1, 2) }
      else { px(TOP_DARK, 9, 9, 3, 1); px(TOP_DARK, 9, 10, 1, 2) }
      // Les liserés : la lumière vient du nord-ouest.
      if (mask & 1) { px(RIM_N, 0, 0, 16, 1); px(0x6f6b7a, 0, 1, 16, 1) }
      if (mask & 4) px(RIM_W, 0, 0, 1, 16)
      if (mask & 2) px(RIM_E, 15, 0, 1, 16)
      g.generateTexture(cliffKey('top', mask, v), 16, 16)
      g.clear()
    }
  }

  // ── LES CONTREMARCHES — une par dénivelé. Hauteur = d × STEP_PX, exactement le trou que le
  //    rendu en marches ouvre entre une tuile et sa voisine du sud. mask : 1 = est, 2 = ouest.
  for (let d = 1; d <= RISER_MAX; d++) {
    const H = d * stepPx
    for (let mask = 0; mask < 4; mask++) {
      for (let v = 0; v < 2; v++) {
        g.fillStyle(FACE_BASE).fillRect(0, 0, 16, H)
        // Le mur s'ÉCLAIRCIT vers le haut : la lumière tombe du ciel, le pied est dans son ombre.
        px(FACE_UP, 0, 0, 16, Math.min(H, Math.round(H / 3)))

        // Les STRATES : la roche est posée en lits, tous les 5 px — un mur de cinq paliers en
        // montre douze, et c'est ce qui donne l'ÉCHELLE. On COMPTE la hauteur, on ne la devine pas.
        for (let y = 4 + (v === 0 ? 0 : 2); y < H - 2; y += 5) {
          px(STRATA, 0, y, 16, 1)
          px(FLECK, v === 0 ? 2 : 8, y - 1, 3, 1) // la strate accroche un peu de lumière au-dessus
          px(FLECK, v === 0 ? 11 : 4, y - 1, 2, 1)
        }

        // Les FISSURES verticales — deux colonnes, décalées par variante, jamais jointives.
        const cols = v === 0 ? [4, 11] : [7, 13]
        for (const cx of cols) {
          const y0 = 2 + (cx % 3)
          const y1 = Math.max(y0, H - 3 - (cx % 4))
          for (let y = y0; y <= y1; y++) px(CRACK, cx, y)
        }

        // LA LÈVRE : le rebord du plateau, tout en haut. La ligne la plus claire de tout le
        // système — c'est ELLE qu'on suit quand on longe une falaise.
        px(BROW, 0, 0, 16, 2)
        px(STRATA, 0, 2, 16, 1) // et son ombre immédiate : la lèvre SURPLOMBE

        // L'ASSISE : le pied du mur, le plus sombre — il touche terre.
        px(FOOT, 0, Math.max(3, H - 2), 16, 2)

        // Les arêtes du mur, quand il tourne.
        if (mask & 2) px(FLECK, 0, 0, 1, H)
        if (mask & 1) px(CRACK, 15, 0, 1, H)

        g.generateTexture(riserKey(d, mask, v), 16, H)
        g.clear()
      }
    }
  }

  // ── L'OMBRE PORTÉE — un dégradé, du pied du mur vers le sol. C'est elle qui fait la HAUTEUR. ──
  const bands: Array<[number, number]> = [[0, 0.34], [2, 0.26], [4, 0.19], [6, 0.13], [8, 0.08], [10, 0.04]]
  for (const [y, a2] of bands) {
    g.fillStyle(0x000000, a2).fillRect(0, y, 16, 2)
  }
  g.generateTexture(CLIFF_SHADOW_KEY, 16, 16)
  g.destroy()
}
