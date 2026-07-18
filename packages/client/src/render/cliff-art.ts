/**
 * L'ART DES FALAISES — une BANDE DE ROCHE PLATE, façon montagne RimWorld.
 *
 * La falaise est LE SQUELETTE de la carte (« on ne trouve pas une porte, on suit un mur »). Elle a
 * d'abord été une tache sombre plate (Alexis : *« les falaises ne ressemblent pas à des falaises, à
 * des blocs noirs »*), puis une paroi en volume avec des contremarches et une ombre portée.
 *
 * La carte est désormais PLATE (pivot RimWorld) : plus de hauteur, plus de contremarche, plus
 * d'ombre portée. La falaise redevient ce qu'elle est sur une carte top-down plate — **une tuile de
 * roche infranchissable, vue de dessus**, avec un LISERÉ éclairé sur ses bords ouverts (nord/ouest,
 * le soleil du projet est au nord-ouest). C'est le trait qui la rend lisible : on longe la ligne
 * claire du bord comme on longe une arête de montagne dans RimWorld.
 *
 * LA PALETTE EST CONSTANTE, ET C'EST UNE DÉCISION. On ne module PAS la falaise par la teinte de sa
 * zone (contrairement au sol) : le squelette doit se reconnaître PARTOUT au premier regard —
 * c'était précisément le défaut du Gouffre, où l'aplat sombre se noyait dans le sol sombre. Une
 * ardoise froide, violette-grise, sans parent dans les terrains : ni la roche (chaude), ni
 * l'éboulis (pâle), ni le mur bâti (brun).
 *
 * Tout est en RECTANGLES — du pixel-art de code, direction artistique du projet : des angles droits.
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

export const CLIFF_TILE_PX = 16

/** Clé d'une tuile de roche-mur. `mask` encode les bords ouverts (bit 1 = nord, 2 = est, 4 = ouest). */
export function cliffKey(family: 'top', mask: number, variant: number): string {
  return `cf-${family}-${mask}-${variant}`
}

/**
 * Génère les textures de roche-mur — appelé une fois au boot, comme les nœuds et les lieux.
 * 8 masques de bords × 2 variantes.
 */
export function makeCliffTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()
  const px = (c: number, x: number, y: number, w = 1, h = 1): void => {
    g.fillStyle(c).fillRect(x, y, w, h)
  }

  // ── LA ROCHE, VUE DE DESSUS — mask : bit 1 = nord ouvert, bit 2 = est ouvert, bit 4 = ouest ──
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
      // Les liserés : la lumière vient du nord-ouest. C'est le trait qui rend l'arête lisible.
      if (mask & 1) { px(RIM_N, 0, 0, 16, 1); px(0x6f6b7a, 0, 1, 16, 1) }
      if (mask & 4) px(RIM_W, 0, 0, 1, 16)
      if (mask & 2) px(RIM_E, 15, 0, 1, 16)
      g.generateTexture(cliffKey('top', mask, v), 16, 16)
      g.clear()
    }
  }

  g.destroy()
}
