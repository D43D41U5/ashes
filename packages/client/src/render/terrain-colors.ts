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
  // Le vocabulaire du pré (spec t0-exploration §2ter) — trois teintes qui ne se confondent
  // ni entre elles ni avec leurs voisines : la saulaie plus claire et plus froide que la
  // forêt, la prairie humide bleutée entre l'herbe et le marais, la lande à genévriers en
  // ocre pâle — SANS parenté avec la lande du sud (0x8a7078) : deux landes, deux sens (R36).
  24: 0x4f7d55, // saulaie (willow) — vert argenté de berge
  25: 0x3a7154, // prairie humide (wet_meadow) — l'herbe qui a les pieds dans l'eau
  26: 0x8f8a58, // lande à genévriers (juniper_heath) — le dos sec
  /**
   * ═══ LES TROIS CENDRES (spec `cendre.md` R11) ═══
   *
   * Elles doivent dire DEUX choses à la fois, et c'est ce qui fixe leurs valeurs : « ceci est
   * mort » — donc désaturé, sans un vert — et « ceci ÉTAIT un pré / un bois / de la roche »,
   * sinon la conversion par famille ne sert à rien et autant n'en avoir qu'une.
   *
   * On garde donc le CLAIR-OBSCUR d'origine : le pré cendré reste le plus clair des trois comme
   * l'herbe était plus claire que la forêt, le bois cendré le plus sombre, le minéral le plus
   * froid et le plus pâle. La hiérarchie de valeur survit à la mort de la couleur — c'est ce qui
   * permet de lire d'un coup d'œil ce qu'on a perdu.
   *
   * ⚠ L'ÉCART A ÉTÉ CREUSÉ après une première capture : à 0x6a6154 / 0x453f39 / 0x74736f, les
   * trois se confondaient sous la lumière du jour, et la conversion par famille ne servait à rien
   * — autant n'avoir qu'une cendre. Les valeurs sont maintenant à un cran franc les unes des
   * autres, et le pré garde son avance de clarté sur le bois, comme l'herbe l'avait sur la forêt.
   *
   * ⚠ Teintes de TRAVAIL malgré tout : le sol dessiné (organique + pavés) leur donnera leur vraie
   * matière — c'est le reste du chantier d'art de cette mécanique.
   */
  27: 0x71695a, // cendre de pré — la plus claire, un ocre éteint
  28: 0x3b3630, // cendre de bois — la plus sombre, sous les troncs debout
  29: 0x7b7a76, // cendre minérale — froide et pâle : la roche n'a jamais eu de couleur
  /**
   * LA CLAIRIÈRE (2026-08-25) — l'herbe qui prend enfin le soleil.
   *
   * PLUS CLAIRE ET PLUS CHAUDE que l'herbe du pré (0x3e7d3a), et à des lieues de la litière
   * brune du bois (0x6b5730..0x5c5e38, cf. `solForet`) : cernée de litière, elle dit « ici la
   * lumière entre », ce qui est la seule chose qu'une clairière ait à dire. Moins pâle que le
   * pré fleuri (0x9cb25c), qui reste le mot de la fleuraie.
   *
   * ⚠ Ce n'est PAS le vert de clairière retiré le 2026-08-23. Celui-là TEINTAIT le sol de la
   * forêt par un champ décidé au bloc — des taches de couleur dans une matière qui doit se lire
   * d'un bloc. Ici la tuile A CHANGÉ DE BIOME : sa lisière est une frontière de terrain comme
   * les autres, quantifiée au motif de 8 comme toute la carte (R32).
   */
  30: 0x6b8f3e, // clairière — l'herbe au soleil, dans le bois
}
