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

/**
 * Distance de CHEBYSHEV (« échiquier ») : `max(|dx|, |dy|)`. C'est la métrique du
 * carré du Feu (spec construction R1-R2) — `Chebyshev(t, Feu) ≤ R` décrit exactement
 * un carré `(2R+1)×(2R+1)`. `abs` et `max` seuls : exact au bit près (invariant n°2).
 */
export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

/**
 * Flou de boîte séparable sur un champ de la carte, EN PLACE — deux passes 1D
 * (horizontale puis verticale). `+ /` uniquement : exact au bit près, pur,
 * déterministe (invariant n°2).
 *
 * IL NE SERT PAS À FAIRE JOLI, IL SERT À BORNER DES PENTES. Le client soulève
 * chaque tuile de `elevation × RELIEF_H` pixels : un champ qui saute d'une tuile
 * à l'autre replie l'image sur elle-même, et le jeu refuse de démarrer
 * (`assertNoFold`). Étaler un champ sur un rayon `r` divise sa pente maximale par
 * environ `r` — c'est le seul outil dont on dispose pour ça, et il a deux clients :
 * l'incision fluviale (`erodeChannels`, dont la tranchée avait des parois
 * verticales) et les vallons de rendu au bord de l'eau (`addReliefBumps`).
 */
export function boxBlur(field: number[], width: number, height: number, r: number): void {
  const tmp = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0
      let n = 0
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        if (xx < 0 || xx >= width) continue
        s += field[y * width + xx]!
        n += 1
      }
      tmp[y * width + x] = s / n
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0
      let n = 0
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        if (yy < 0 || yy >= height) continue
        s += tmp[yy * width + x]!
        n += 1
      }
      field[y * width + x] = s / n
    }
  }
}
