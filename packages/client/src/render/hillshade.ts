/**
 * Ombrage du sol par le RELIEF — math PURE, aucun import Phaser.
 *
 * Le bake du sol module aujourd'hui la couleur du biome par un bruit par tuile.
 * Il gagne ici deux facteurs : la PENTE (hillshade, soleil au nord-ouest) et le
 * PIED D'UNE MARCHE (les décrochements est/ouest/nord, dont la face ne regarde
 * pas la caméra et n'est donc pas dessinée en paroi).
 *
 * CONTRAINTE DURE : le facteur est CONSTANT PAR TUILE. C'est ce qui autorise le
 * bake à 1 px/tuile étiré ×16 en NEAREST (WorldScene.bakeMapTexture).
 *
 * Port du hillshade de sim/vignette.ts, l'outil de revue headless — c'est le
 * même calcul, il n'avait simplement jamais atteint le rendu jeu.
 */

/** Altitude [0,1] à une tuile. DOIT clamper aux bords (jamais NaN, jamais -1). */
export type SampleElevation = (tx: number, ty: number) => number
/** Palier entier à une tuile. Hors carte ou carte sans paliers → -1. */
export type SampleLevel = (tx: number, ty: number) => number

/** Écart d'échantillonnage du gradient, en tuiles. Large = lit la pente MACRO du
 *  versant plutôt que chaque bosse — un lissage du pauvre, gratuit. */
export const HILLSHADE_STEP = 3
export const HILLSHADE_STRENGTH = 8
export const HILLSHADE_MIN = 0.55
export const HILLSHADE_MAX = 1.45
/** Assombrissement de la tuile basse au pied d'une marche est/ouest/nord. */
export const STEP_SHADE = 0.85

/** Facteur lumineux dû à la pente, soleil au nord-ouest. Plat → 1. */
export function hillshadeAt(tx: number, ty: number, sample: SampleElevation): number {
  const dzdx = sample(tx + HILLSHADE_STEP, ty) - sample(tx - HILLSHADE_STEP, ty)
  const dzdy = sample(tx, ty + HILLSHADE_STEP) - sample(tx, ty - HILLSHADE_STEP)
  const s = 1 + HILLSHADE_STRENGTH * (-dzdx - dzdy)
  return s < HILLSHADE_MIN ? HILLSHADE_MIN : s > HILLSHADE_MAX ? HILLSHADE_MAX : s
}

/**
 * Facteur lumineux dû au pied d'une marche. Une tuile dont un voisin nord, est
 * ou ouest est d'un palier PLUS HAUT est à l'ombre de ce décrochement.
 * Les faces SUD ne sont pas concernées : elles sont couvertes par un sprite de
 * paroi (render/cliffs.ts), pas par la texture du sol.
 */
export function stepShadeAt(tx: number, ty: number, sample: SampleLevel): number {
  const here = sample(tx, ty)
  if (here < 0) return 1
  const north = sample(tx, ty - 1)
  const east = sample(tx + 1, ty)
  const west = sample(tx - 1, ty)
  return north > here || east > here || west > here ? STEP_SHADE : 1
}
