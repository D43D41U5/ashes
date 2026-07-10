/**
 * Ombrage du sol par le RELIEF — math PURE, aucun import Phaser.
 *
 * Le bake du sol module la couleur du biome par un bruit par tuile, puis par
 * la PENTE (hillshade, soleil au nord-ouest). Le relief est désormais montré
 * entièrement par la déformation continue (warp) — plus de paliers discrets,
 * donc plus de pied de marche à assombrir.
 *
 * CONTRAINTE DURE : le facteur est CONSTANT PAR TUILE. C'est ce qui autorise le
 * bake à 1 px/tuile étiré ×16 en NEAREST (WorldScene.bakeMapTexture).
 *
 * Port du hillshade de sim/vignette.ts, l'outil de revue headless — c'est le
 * même calcul, il n'avait simplement jamais atteint le rendu jeu.
 */

/** Altitude [0,1] à une tuile. DOIT clamper aux bords (jamais NaN, jamais -1). */
export type SampleElevation = (tx: number, ty: number) => number

/** Écart d'échantillonnage du gradient, en tuiles. Large = lit la pente MACRO du
 *  versant plutôt que chaque bosse — un lissage du pauvre, gratuit. */
export const HILLSHADE_STEP = 3
/** Le relief se lit ICI, pas au déplacement (champ d'élévation trop doux pour un
 *  warp visible sans casser la collision) : ombrage fort pour que les versants
 *  se lisent par la lumière. Calibré en jeu. */
export const HILLSHADE_STRENGTH = 16
export const HILLSHADE_MIN = 0.5
export const HILLSHADE_MAX = 1.5

/** Facteur lumineux dû à la pente, soleil au nord-ouest. Plat → 1. */
export function hillshadeAt(tx: number, ty: number, sample: SampleElevation): number {
  const dzdx = sample(tx + HILLSHADE_STEP, ty) - sample(tx - HILLSHADE_STEP, ty)
  const dzdy = sample(tx, ty + HILLSHADE_STEP) - sample(tx, ty - HILLSHADE_STEP)
  const s = 1 + HILLSHADE_STRENGTH * (-dzdx - dzdy)
  return s < HILLSHADE_MIN ? HILLSHADE_MIN : s > HILLSHADE_MAX ? HILLSHADE_MAX : s
}
