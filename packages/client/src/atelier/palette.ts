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

export const THEMES = ['Construction', 'Minéraux', 'Végétaux', 'Terres & eaux', 'Stations & mobilier'] as const
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
  D: 'Construction', //    tour de guet — le donjon effondré (corps de lieu)
  H: 'Construction', //    sanctuaire — le trilithe dressé par une main (corps de lieu)
  h: 'Construction', //    repaire — la hutte de peaux (corps de lieu)
  X: 'Construction', //    charnier — la fosse creusée (corps de lieu)
  // ── Minéraux : la pierre nue — sol, blocs, fouille, et les corps de lieux de roche. ──
  r: 'Minéraux', //        roc (sol d'antre — les PAROIS se dérivent de son pourtour)
  R: 'Minéraux', //        rocher
  e: 'Minéraux', //        éboulis
  g: 'Minéraux', //        gravats (cour)
  G: 'Minéraux', //        gravats hors cour
  n: 'Minéraux', //        grotte (corps de lieu)
  Z: 'Minéraux', //        bloc erratique (corps de lieu)
  k: 'Minéraux', //        cairn (corps de lieu)
  I: 'Minéraux', //        pierre levée (corps de lieu)
  N: 'Minéraux', //        arche (corps de lieu)
  z: 'Minéraux', //        crevasses (corps de lieu)
  y: 'Minéraux', //        pétroglyphes (corps de lieu)
  d: 'Minéraux', //        belvédère (corps de lieu)
  J: 'Minéraux', //        gisement (corps de lieu)
  Q: 'Minéraux', //        carrière (corps de lieu)
  V: 'Minéraux', //        filon (corps de lieu)
  // ── Végétaux : le vivant — des NŒUDS réels, et les grands arbres-corps. ──
  x: 'Végétaux', //        friche
  Y: 'Végétaux', //        arbre (nœud tree)
  B: 'Végétaux', //        buisson à baies (nœud berry_bush)
  c: 'Végétaux', //        chêne ancien (corps de lieu)
  W: 'Végétaux', //        vieil arbre (corps de lieu)
  f: 'Végétaux', //        verger (corps de lieu)
  // ── Terres & eaux : ce qui s'étale au sol — la boue, le sel, l'eau qui dort ou qui tombe. ──
  S: 'Terres & eaux', //   saline (corps de lieu)
  u: 'Terres & eaux', //   tanière (corps de lieu)
  v: 'Terres & eaux', //   fondrière (corps de lieu)
  j: 'Terres & eaux', //   cascade (corps de lieu)
  w: 'Terres & eaux', //   source chaude (corps de lieu)
  O: 'Terres & eaux', //   tarn (corps de lieu)
  // ── Stations & mobilier : ce qui meuble et sert. ──
  A: 'Stations & mobilier', F: 'Stations & mobilier', //  les âtres (salle / camp)
  T: 'Stations & mobilier', b: 'Stations & mobilier',
  L: 'Stations & mobilier', l: 'Stations & mobilier', //  les paillasses
  E: 'Stations & mobilier', o: 'Stations & mobilier', t: 'Stations & mobilier',
  K: 'Stations & mobilier', M: 'Stations & mobilier', a: 'Stations & mobilier',
}
