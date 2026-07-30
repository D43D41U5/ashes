/**
 * LA PALETTE DES BIOMES — la couleur de sol d'un terrain, avant toute modulation.
 *
 * Extraite de `WorldScene` (elle y vivait seule) le 2026-07-29 : elle n'est plus la seule affaire
 * du bake. Le décor y puise aussi — une touffe d'herbe se teinte dans la GAMME du biome où elle
 * pousse (`clutter-teinte.ts`), et pour ça il faut une source unique. Deux tables divergentes
 * feraient pousser une touffe de pré au milieu du calciné.
 *
 * Ce que le bake en fait ensuite (fondu de frontière, modulation de zone, grain par tuile) reste
 * chez lui : ici, seulement la couleur NUE du terrain.
 */
export const TERRAIN_COLORS: Record<number, number> = {
  // (les couleurs sont des placeholders R8, remplacées par de vrais tilesets en V3+)
  0: 0x101014, // void
  1: 0x3e7d3a, // herbe
  2: 0xb2996a, // route
  3: 0x2c5a2e, // forêt
  4: 0x4a7fa8, // eau peu profonde
  5: 0x6d6d70, // roche
  6: 0x274a6d, // eau profonde
  7: 0x4a4038, // mur
  8: 0x556b4a, // marais
  // Biomes alpins (SP3) — portés depuis BIOME_RGB (sim/vignette.ts) en 0xRRGGBB.
  9: 0x96928a, // éboulis (scree)
  10: 0xeef2f8, // neige (snow)
  11: 0x8a7078, // lande (heath)
  12: 0xb2c278, // alpage (alpine_meadow)
  13: 0x507438, // forêt claire de pins (pine)
  14: 0x9c964e, // mélèzes (larch)
  15: 0xcee2ee, // glacier
  16: 0x7c7468, // chaos de blocs (boulders)
  17: 0x9cb25c, // pré fleuri (flower_meadow)
  18: 0x484c3a, // tourbière (peat_bog)
  19: 0x707a50, // roselière (reed_marsh)
  20: 0xbebe94, // alpage fleuri (alpine_flowers)
  21: 0x4a3e38, // forêt brûlée (burnt_forest)
  22: 0x1c3a28, // vieille forêt (old_growth)
  /**
   * LA FALAISE — et elle doit se lire comme un MUR, pas comme un caillou.
   *
   * Elle est le squelette de la carte : c'est en la LONGEANT qu'on trouve les portes (« on ne
   * trouve pas une porte, on suit un mur »). Il lui faut donc l'arête la plus franche de toute la
   * palette : presque noire, très froide, sans le moindre parent visuel dans la roche (0x6d6d70)
   * ni le mur (0x4a4038). À l'écran, on ne doit pas pouvoir hésiter une seconde.
   */
  23: 0x4b4852, // falaise — le 1 px cuit SOUS les sprites de paroi : la teinte du dessus d'ardoise
}
