/**
 * LE PICKER PAR THÈMES (spec `lieux-batis.md` N6 — décision d'Alexis, 2026-08-10 : « la
 * salle / la cour / hors région n'a pas de sens pour 80 % des POI »).
 *
 * La taxonomie est ÉDITORIALE — matière et usage, pas mécanique de moteur : Construction,
 * Minéraux, Végétaux, Stations & mobilier — chacun avec ses sols, parois et props. La table
 * char→thème est EXPLICITE (l'éditorial ne se dérive pas) et GARDÉE par `palette-atelier.test.ts` :
 * tout caractère de légende doit avoir un thème ET une aide — la table ne peut pas prendre
 * de retard en silence. Elle vit hors de `main.ts` (qui crée un Phaser.Game au chargement,
 * invitable en vitest).
 */

export const THEMES = ['Construction', 'Minéraux', 'Végétaux', 'Stations & mobilier'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_DE: Record<string, Theme> = {
  // ── Construction : l'œuvre humaine — ses sols, ses vestiges de charpente. ──
  '·': 'Construction', //  l'effaceur — la case vide
  '.': 'Construction', //  dallage de salle
  ':': 'Construction', //  dallage couvert
  ',': 'Construction', //  terre battue de cour
  m: 'Construction', //    mur bas écroulé
  P: 'Construction', //    poutre en salle
  p: 'Construction', //    poutre tombée
  C: 'Construction', //    charrette — le corps d'un lieu, l'œuvre charpentée
  U: 'Construction', //    autel — la pierre taillée, dressée par une main
  // ── Minéraux : la pierre nue — sol, blocs, fouille. ──
  r: 'Minéraux', //        roc (sol d'antre — les PAROIS se dérivent de son pourtour)
  R: 'Minéraux', //        rocher
  e: 'Minéraux', //        éboulis
  g: 'Minéraux', //        gravats (cour)
  G: 'Minéraux', //        gravats hors cour
  // ── Végétaux : le vivant — des NŒUDS réels, jamais du décor. ──
  x: 'Végétaux', //        friche
  Y: 'Végétaux', //        arbre (nœud tree)
  B: 'Végétaux', //        buisson à baies (nœud berry_bush)
  // ── Stations & mobilier : ce qui meuble et sert. ──
  A: 'Stations & mobilier', F: 'Stations & mobilier', //  les âtres (salle / camp)
  T: 'Stations & mobilier', b: 'Stations & mobilier',
  L: 'Stations & mobilier', l: 'Stations & mobilier', //  les paillasses
  E: 'Stations & mobilier', o: 'Stations & mobilier', t: 'Stations & mobilier',
  K: 'Stations & mobilier', M: 'Stations & mobilier', a: 'Stations & mobilier',
}
