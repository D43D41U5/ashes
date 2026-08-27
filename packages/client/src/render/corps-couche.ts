/**
 * ═══ UN CORPS COUCHÉ SUIT SA MARCHE — EN HUIT CAPS, PAS EN DEUX AXES ═══
 *
 * *(Alexis, 2026-08-25 : « il devrait s'aligner vers la direction où il se déplace le plus en X
 * et en Y » ; puis, sur la version à deux textures : « pour moi non ».)*
 *
 * Deux textures (est-ouest, nord-sud) ne peuvent PAS répondre à la question sur une diagonale :
 * un corps qui rampe vers le nord-est n'y a le choix qu'entre deux mensonges, et c'est ce qui se
 * voyait. Un corps couché n'a pas un AXE, il a un CAP.
 *
 * On cuit donc la silhouette en `ORIENTATIONS_COUCHE` variantes pré-tournées, exactement comme
 * les seize caps d'une empreinte (`empreintes.ts`) et pour les mêmes deux raisons, toutes deux
 * mesurées en leur temps : une rotation Phaser ne tourne PAS le canal X d'une normale (le piège
 * du flip, 24/07), et un art de quelques pixels tourné au filtre NEAREST se délave.
 *
 * ⚠ **LA BOÎTE EST L'EMPRISE AU SOL**, et elle change avec le cap : 24 × 10 couché est-ouest,
 * 10 × 24 nord-sud, 25 × 25 en diagonale. Elle est déclarée ICI et NULLE PART AILLEURS — le
 * boot cuit à ces dimensions, `ACTOR_FOOTPRINTS` les déclare en tuiles, et les deux ne peuvent
 * donc plus se désaccorder d'un pixel (c'est la leçon des silhouettes de houppier réécrites
 * deux fois, `lit-trees.ts`).
 *
 * PUR : aucun import Phaser. `BootScene` peint ce que ceci décrit, `snapshot-view` choisit.
 */

/** Huit caps — 45° de pas. Assez pour qu'une diagonale soit une diagonale ; pas plus, parce que
 *  chaque cap est une texture, et qu'un corps de 24 px ne porte pas 22,5° de différence. */
export const ORIENTATIONS_COUCHE = 8

/** Le corps couché, dans son repère propre (px) : sa longueur et son épaisseur. Ce sont les
 *  dimensions historiques du pion couché est-ouest (24 × 10), conservées au pixel près. */
export const COUCHE_LONGUEUR = 24
export const COUCHE_EPAISSEUR = 10

/** Le cap (rad) que porte la variante `orient` : son axe de LONGUEUR pointe dans ce sens. */
export function capDOrientation(orient: number): number {
  return (orient * 2 * Math.PI) / ORIENTATIONS_COUCHE
}

/**
 * LA BOÎTE d'une variante, en px — l'enveloppe exacte du corps tourné, arrondie au pixel.
 *
 * Elle n'est pas constante, et c'est délibéré : une boîte carrée commune (25 × 25) aurait donné
 * au couché est-ouest une emprise au sol de 1,56 tuile de PROFONDEUR pour un corps qui n'en
 * occupe que 0,6 — le tri en Y et l'ombre de contact s'en seraient nourris.
 */
export function boiteCouchee(orient: number): { w: number; h: number } {
  const th = capDOrientation(orient)
  const c = Math.abs(Math.cos(th))
  const s = Math.abs(Math.sin(th))
  return {
    w: Math.max(1, Math.round(COUCHE_LONGUEUR * c + COUCHE_EPAISSEUR * s)),
    h: Math.max(1, Math.round(COUCHE_LONGUEUR * s + COUCHE_EPAISSEUR * c)),
  }
}

/** La clé de texture d'un cap — UN seul endroit la construit (le boot, la posture, la vue). */
export function cleCouchee(base: string, orient: number): string {
  return `${base}-${((orient % ORIENTATIONS_COUCHE) + ORIENTATIONS_COUCHE) % ORIENTATIONS_COUCHE}`
}

/**
 * LE CAP D'UN DÉPLACEMENT → la variante à poser.
 *
 * `dx/dy` sont un DÉPLACEMENT RÉEL (le tampon d'interpolation), jamais le `facing` de la sim :
 * celui-ci est rangé en huit secteurs à partir des SIGNES du pas, donc sur une diagonale ses
 * deux composantes sont égales et il ne sait pas dire « où se déplace-t-il le plus ».
 *
 * Un corps n'a pas de tête ici : le cap et son opposé donnent la même silhouette. On replie donc
 * sur un DEMI-TOUR — sans quoi un corps qui recule pivoterait de 180° pour rien.
 */
export function orientCouchee(dx: number, dy: number): number {
  const pas = (2 * Math.PI) / ORIENTATIONS_COUCHE
  const brut = Math.round(Math.atan2(dy, dx) / pas)
  const demi = ORIENTATIONS_COUCHE / 2
  return ((brut % demi) + demi) % demi
}

/** Ce qu'un pixel de la silhouette porte : rien, le liseré, ou le corps. */
export type PixelCouche = 0 | 1 | 2

/**
 * LA SILHOUETTE DU CAP `orient`, pixel par pixel, dans sa boîte (`boiteCouchee`).
 *
 * Le corps est un rectangle `COUCHE_LONGUEUR × COUCHE_EPAISSEUR` tourné, avec son liseré d'un
 * pixel — le même dessin que `makeSpriteCouche` peignait en deux `fillRect`, mais rastérisé dans
 * le repère du corps pour que les caps obliques existent. Aux caps cardinaux, le résultat est
 * EXACTEMENT l'ancien pion (une garde l'affirme).
 */
export function rasterCorpsCouche(orient: number): PixelCouche[] {
  const { w, h } = boiteCouchee(orient)
  const th = capDOrientation(orient)
  const fx = Math.cos(th)
  const fy = Math.sin(th)
  const out: PixelCouche[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2
      const dy = y + 0.5 - h / 2
      // Coordonnées dans le repère du corps : `u` le long, `v` en travers.
      const u = Math.abs(dx * fx + dy * fy)
      const v = Math.abs(-dx * fy + dy * fx)
      if (u > COUCHE_LONGUEUR / 2 || v > COUCHE_EPAISSEUR / 2) { out.push(0); continue }
      // LE LISERÉ est le premier pixel sous la peau, sur les deux axes — c'est ce que faisaient
      // les deux `fillRect` imbriqués (bord 24 × 10, corps 22 × 8).
      out.push(u > COUCHE_LONGUEUR / 2 - 1 || v > COUCHE_EPAISSEUR / 2 - 1 ? 1 : 2)
    }
  }
  return out
}
