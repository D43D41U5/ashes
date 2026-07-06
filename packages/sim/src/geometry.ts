/**
 * Géométrie partagée de la sim — arithmétique + - * / uniquement
 * (déterminisme inter-moteurs, GDD §11). Les comparaisons de distance se
 * font au carré : jamais de racine quand un seuil au carré suffit.
 */

/** Distance au carré entre (ax, ay) et (bx, by). */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}
