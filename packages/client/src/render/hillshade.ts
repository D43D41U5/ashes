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
/** Le relief se lit à l'OMBRAGE, pas au déplacement (champ d'élévation trop doux
 *  pour un warp visible sans casser la collision). Pas d'échantillonnage LARGE :
 *  on lit la pente MACRO du versant (montée vers les murs) plutôt que le bruit
 *  local — sinon l'ombrage n'est que du grain. Calibré en jeu. */
export const HILLSHADE_STEP = 8
export const HILLSHADE_STRENGTH = 5
export const HILLSHADE_MIN = 0.75
export const HILLSHADE_MAX = 1.25

/* ── Ombre PORTÉE dynamique (couche shade-layer, pas le bake) ────────────────
 * Contrairement au hillshade cuit ci-dessus, celle-ci suit le soleil de l'heure
 * courante et n'ASSOMBRIT que (multipliée sur le sol) — c'est « l'ombre du
 * relief », pas un rehaut. */
export const RELIEF_SHADOW_STEP = 3
export const RELIEF_SHADOW_STRENGTH = 10
export const RELIEF_SHADOW_MIN = 0.4

/** Facteur d'ASSOMBRISSEMENT [MIN,1] d'une tuile dont la pente tourne le dos au
 *  soleil `(sunX,sunY)` (direction VERS le soleil). 1 = pas d'ombre (face au
 *  soleil, ou plat, ou nuit sun=0). */
export function reliefShadow(
  tx: number,
  ty: number,
  sample: SampleElevation,
  sunX: number,
  sunY: number,
): number {
  const dzdx = sample(tx + RELIEF_SHADOW_STEP, ty) - sample(tx - RELIEF_SHADOW_STEP, ty)
  const dzdy = sample(tx, ty + RELIEF_SHADOW_STEP) - sample(tx, ty - RELIEF_SHADOW_STEP)
  // Face éclairée : en allant vers le soleil on DESCEND (dz·sun < 0) → s ≥ 1
  // (pas d'ombre) ; face à l'ombre : on monte vers le soleil (dz·sun > 0) → s < 1.
  const s = 1 - RELIEF_SHADOW_STRENGTH * (dzdx * sunX + dzdy * sunY)
  return s < RELIEF_SHADOW_MIN ? RELIEF_SHADOW_MIN : s > 1 ? 1 : s
}

/** Facteur lumineux dû à la pente, soleil au nord-ouest. Plat → 1. */
export function hillshadeAt(tx: number, ty: number, sample: SampleElevation): number {
  const dzdx = sample(tx + HILLSHADE_STEP, ty) - sample(tx - HILLSHADE_STEP, ty)
  const dzdy = sample(tx, ty + HILLSHADE_STEP) - sample(tx, ty - HILLSHADE_STEP)
  const s = 1 + HILLSHADE_STRENGTH * (-dzdx - dzdy)
  return s < HILLSHADE_MIN ? HILLSHADE_MIN : s > HILLSHADE_MAX ? HILLSHADE_MAX : s
}
