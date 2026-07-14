/**
 * L'ART DES FALAISES — une PAROI, enfin, pas un bloc noir.
 *
 * La falaise est LE SQUELETTE de la carte (« on ne trouve pas une porte, on suit un mur »), et
 * elle était peinte comme une tache sombre plate — Alexis : *« les falaises ne ressemblent pas à
 * des falaises, à des blocs noirs »*. La spec R2 promettait pourtant « une paroi dessinée, avec
 * son ombre portée » depuis le premier jour.
 *
 * LE VERROU TECHNIQUE, ET SA SORTIE. Le sol est cuit à **1 pixel par tuile** (2,5 M de tuiles :
 * on ne peut pas cuire du détail). La paroi vit donc dans sa PROPRE couche (`CliffLayer`),
 * fenêtrée à la vue comme l'ombre du relief — et ses tuiles sont générées ICI, en code, comme
 * tout l'art du projet.
 *
 * ═══ LE LANGAGE VISUEL — trois familles de tuiles, auto-raccordées ═══
 *
 * C'est la grammaire des falaises de Zelda ALTTP, et elle tient en trois signes :
 *
 *   — LE DESSUS (`top`) : la surface du plateau. Roche froide, mouchetée, avec un LISERÉ éclairé
 *     sur les bords ouverts au nord et à l'ouest (le soleil du projet est au nord-ouest).
 *   — LA FACE (`f0`) : le MUR. Quand le sud d'une tuile de falaise est ouvert, on voit sa paroi :
 *     strates horizontales, fissures verticales, assise sombre au pied.
 *   — LE HAUT DE MUR (`f1`) : la rangée au-dessus d'une face. La paroi CONTINUE (deux tuiles de
 *     haut : une falaise est haute, sinon c'est un muret), et elle se termine par la LÈVRE — la
 *     ligne claire du rebord du plateau, le signe le plus lisible de tout le système. C'est elle
 *     qu'on suit à l'écran quand on longe un mur.
 *
 * Plus L'OMBRE PORTÉE : un dégradé posé sur le sol au pied de la face — c'est lui qui donne la
 * hauteur. Un mur sans ombre est un papier peint.
 *
 * LA PALETTE EST CONSTANTE, ET C'EST UNE DÉCISION. On ne module PAS la falaise par la teinte de
 * sa zone (contrairement au sol) : le squelette doit se reconnaître PARTOUT au premier regard —
 * c'était précisément le défaut du Gouffre, où l'aplat sombre se noyait dans le sol sombre. Une
 * ardoise froide, violette-grise, sans parent dans les terrains : ni la roche (chaude), ni
 * l'éboulis (pâle), ni le mur bâti (brun).
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

/** Clé d'une tuile de falaise. `family` ∈ top|f0|f1 ; `mask` encode les bords ouverts. */
export function cliffKey(family: 'top' | 'f0' | 'f1', mask: number, variant: number): string {
  return `cf-${family}-${mask}-${variant}`
}

export const CLIFF_SHADOW_KEY = 'cf-shadow'

/**
 * Génère les 49 textures (16 dessus + 2×8 faces + ombre) — appelé une fois au boot, comme les
 * nœuds et les lieux. Tout est en rectangles : du pixel-art de code, dans le style du projet.
 */
export function makeCliffTextures(scene: Phaser.Scene): void {
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
      // Une fissure de surface, en diagonale brisée.
      if (v === 0) { px(TOP_DARK, 5, 6, 3, 1); px(TOP_DARK, 8, 7, 3, 1) }
      else { px(TOP_DARK, 9, 9, 3, 1); px(TOP_DARK, 7, 10, 2, 1) }
      // Les liserés : la lumière vient du nord-ouest.
      if (mask & 1) { px(RIM_N, 0, 0, 16, 1); px(0x6f6b7a, 0, 1, 16, 1) }
      if (mask & 4) px(RIM_W, 0, 0, 1, 16)
      if (mask & 2) px(RIM_E, 15, 0, 1, 16)
      g.generateTexture(cliffKey('top', mask, v), 16, 16)
      g.clear()
    }
  }

  // ── LES MURS — mask : bit 1 = est ouvert, bit 2 = ouest ouvert ──
  for (const family of ['f0', 'f1'] as const) {
    const base = family === 'f0' ? FACE_BASE : FACE_UP
    for (let mask = 0; mask < 4; mask++) {
      for (let v = 0; v < 2; v++) {
        g.fillStyle(base).fillRect(0, 0, 16, 16)
        // Les STRATES : la roche est posée en lits, et ça se lit à dix tuiles.
        const strates = family === 'f0' ? [4, 9, 13] : [5, 10]
        for (const y of strates) {
          px(STRATA, 0, y, 16, 1)
          // La strate accroche un peu de lumière juste au-dessus.
          px(FLECK, v === 0 ? 2 : 8, y - 1, 3, 1)
          px(FLECK, v === 0 ? 10 : 13, y - 1, 2, 1)
        }
        // Les FISSURES verticales — décalées entre f0 et f1 pour que le mur de deux tuiles de
        // haut ne montre pas deux fois le même motif empilé.
        const cracks = family === 'f0'
          ? (v === 0 ? [[4, 0, 10], [11, 5, 11]] : [[7, 2, 9], [13, 0, 6]])
          : (v === 0 ? [[6, 4, 12], [12, 6, 14]] : [[3, 5, 13], [9, 7, 15]])
        for (const [x, y0, y1] of cracks) for (let y = y0!; y <= y1!; y++) px(CRACK, x!, y)
        if (family === 'f0') {
          // L'ASSISE : le pied du mur, le plus sombre — il touche terre.
          px(FOOT, 0, 14, 16, 2)
        } else {
          // LA LÈVRE : le rebord du plateau. La ligne la plus claire de tout le système —
          // c'est ELLE qu'on suit quand on longe une falaise.
          px(BROW, 0, 0, 16, 2)
          px(STRATA, 0, 2, 16, 1) // et son ombre immédiate : la lèvre SURPLOMBE
        }
        // Les arêtes du mur, quand il tourne.
        if (mask & 2) px(FLECK, 0, 0, 1, 16)
        if (mask & 1) px(CRACK, 15, 0, 1, 16)
        g.generateTexture(cliffKey(family, mask, v), 16, 16)
        g.clear()
      }
    }
  }

  // ── L'OMBRE PORTÉE — un dégradé, du pied du mur vers le sol. C'est elle qui fait la HAUTEUR. ──
  const bands: Array<[number, number]> = [[0, 0.34], [2, 0.26], [4, 0.19], [6, 0.13], [8, 0.08], [10, 0.04]]
  for (const [y, a] of bands) {
    g.fillStyle(0x000000, a).fillRect(0, y, 16, 2)
  }
  g.generateTexture(CLIFF_SHADOW_KEY, 16, 16)
  g.destroy()
}
