/**
 * VISER UN CORPS, PAS LE SOL DERRIÈRE LUI — pur, zéro Phaser, donc prouvé par des tests.
 *
 * ═══ LE DÉFAUT, ET IL ÉTAIT GROS ═══
 *
 * Le curseur se convertit en point de SOL : `pointerToWorld` rend un pixel-monde, et la
 * carte est plate (pivot RimWorld, `warp.unproject` ≡ identité) — donc `x/16, y/16` est
 * la tuile SOUS le curseur. Mais l'art, lui, est un BILLBOARD ancré aux PIEDS
 * (`actorPlacement` : origine 0,5/1, pieds à `y + AVATAR_HITBOX_DEPTH_TILES/2`, et le
 * sprite monte de toute sa hauteur au-dessus).
 *
 * Viser le torse d'un zombie (emprise d'art 1,5 tuile de haut) désignait donc un point
 * de sol **0,56 tuile AU NORD** de sa position logique. La sim recevait une direction
 * vers ce point-là, et frappait à côté — pendant que le joueur, lui, avait le curseur
 * pile sur la poitrine.
 *
 * MESURÉ (`tools/mesure-touche.mts`, géométrie contrôlée sur 864 coups rejoués dans la
 * vraie sim) : **23 à 28 % des cibles atteignables étaient ratées**, et **35 à 42 %
 * quand l'ennemi était à l'est ou à l'ouest** — là où le décalage tombe perpendiculaire
 * à la visée. Sur la lance (demi-arc de 22°), le dévoiement dépassait l'arc entier.
 *
 * ═══ LA RÈGLE ═══
 *
 * Si le curseur est SUR une silhouette rendue, on vise le CORPS : la direction part vers
 * sa position LOGIQUE (celle que la sim connaît), pas vers le sol sous le pixel. Sinon,
 * rien ne change : on vise le sol, comme avant.
 *
 * Ce n'est pas une assistance de visée — on ne corrige aucune erreur du joueur, on
 * répare une TRAHISON de l'écran. La portée, l'arc, l'esquive et le wind-up restent
 * exactement ce qu'ils étaient ; la sim revalide tout (invariant §3). Le seul geste
 * qu'on rend fidèle, c'est « je pointe ce corps-là ».
 */

/** Un corps tel que l'ŒIL le voit ET tel que la SIM le connaît — les deux à la fois,
 *  parce que c'est justement leur écart qui faisait rater le coup. */
export interface CorpsVisable {
  id: number
  /** Position LOGIQUE (tuiles) : ce vers quoi la visée doit pointer. */
  x: number
  y: number
  /** La SILHOUETTE RENDUE, en tuiles — le rectangle que le curseur survole vraiment. */
  gauche: number
  droite: number
  haut: number
  bas: number
}

/**
 * LA SILHOUETTE D'UN SPRITE, en tuiles. On prend les bornes RÉELLEMENT rendues (position
 * et taille d'affichage du sprite, origine PIEDS 0,5/1) et non l'emprise théorique : un
 * corps tapi (`crouch`), immergé ou à demi sorti de terre est plus court à l'écran, et
 * c'est le rectangle À L'ÉCRAN que le curseur survole.
 *
 * La position LOGIQUE arrive à part, du snapshot : le sprite est rendu avec un tick de
 * retard (tampon de gigue, `interp.ts`), et c'est vers la position que la SIM connaît
 * qu'il faut viser — sinon on corrigerait une trahison par une autre.
 */
export function silhouetteDepuisSprite(
  id: number,
  /** Position LOGIQUE (tuiles), du snapshot. */
  x: number,
  y: number,
  /** Le sprite rendu, en pixels-monde (origine pieds : `spriteY` est le bas). */
  spriteX: number,
  spriteY: number,
  displayW: number,
  displayH: number,
  tilePx: number,
): CorpsVisable {
  return {
    id,
    x,
    y,
    gauche: (spriteX - displayW / 2) / tilePx,
    droite: (spriteX + displayW / 2) / tilePx,
    haut: (spriteY - displayH) / tilePx,
    bas: spriteY / tilePx,
  }
}

/** Le curseur est-il sur cette silhouette (élargie de `marge`, en tuiles) ? */
export function surSilhouette(c: CorpsVisable, wx: number, wy: number, marge = 0): boolean {
  return wx >= c.gauche - marge && wx <= c.droite + marge && wy >= c.haut - marge && wy <= c.bas + marge
}

/**
 * LE CORPS SOUS LE CURSEUR, ou `null`. Quand plusieurs silhouettes se chevauchent — une
 * meute serrée, un PNJ devant un zombie — on prend celle dont le CENTRE est le plus près
 * du curseur : c'est celle que l'œil désigne. À égalité parfaite, le plus petit `id`
 * tranche, pour que la visée ne vacille jamais d'un corps à l'autre entre deux frames.
 */
export function corpsSousCurseur(
  corps: readonly CorpsVisable[],
  wx: number,
  wy: number,
  marge = 0,
): CorpsVisable | null {
  let meilleur: CorpsVisable | null = null
  let meilleureD = Infinity
  for (const c of corps) {
    if (!surSilhouette(c, wx, wy, marge)) continue
    const cx = (c.gauche + c.droite) / 2
    const cy = (c.haut + c.bas) / 2
    const d = (cx - wx) ** 2 + (cy - wy) ** 2
    if (d < meilleureD || (d === meilleureD && meilleur !== null && c.id < meilleur.id)) {
      meilleureD = d
      meilleur = c
    }
  }
  return meilleur
}

/**
 * LA DIRECTION D'UN COUP, depuis l'avatar : vers le corps visé s'il y en a un sous le
 * curseur, vers le point de sol sinon. Non normalisée — la sim renormalise (R5).
 */
export function directionDeVisee(
  depuis: { x: number; y: number },
  wx: number,
  wy: number,
  corps: CorpsVisable | null,
): { dx: number; dy: number } {
  const cible = corps ?? { x: wx, y: wy }
  return { dx: cible.x - depuis.x, dy: cible.y - depuis.y }
}
