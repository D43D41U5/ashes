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
 * ═══ LES QUATRE ARÊTES D'UNE TUILE — LE VOCABULAIRE, EN UN SEUL ENDROIT ═══
 *
 * Un mur mince ne vit pas SUR une tuile mais sur une de ses ARÊTES (décision d'Alexis,
 * 2026-07-27) ; ce qu'il coupe n'est pas une case mais un FRANCHISSEMENT.
 *
 * Ces quatre bits étaient recopiés en privé dans QUATRE fichiers (`collision.ts`,
 * `construction.ts`, `poi-batis.ts`, et `render/pans.ts` côté client). Tant que rien
 * n'écrivait d'arête hors du bâti généré, quatre copies muettes se valaient ; du jour où
 * le JOUEUR en pose, la même valeur traverse le protocole réseau, la validation du
 * serveur, le fantôme et la collision — et une inversion N/S dans une seule des copies
 * donnerait un mur qui se voit ici et arrête là. Ils vivent donc dans le module le plus
 * bas (aucun import, aucun cycle possible), et tout le monde les LIT.
 *
 * ⚠ CE SONT DES VALEURS PERSISTÉES : elles partent au snapshot, au journal de rejeu et
 * en base. On n'en change JAMAIS la numérotation — on en ajoute, à la rigueur.
 */
export const EDGE_N = 1
export const EDGE_E = 2
export const EDGE_S = 4
export const EDGE_O = 8

/** Les quatre bits dans l'ORDRE HORAIRE (N → E → S → O) — celui que la rotation du
 *  fantôme parcourt, et celui des tables de test. L'ordre fait partie du contrat. */
export const EDGE_BITS: readonly number[] = [EDGE_N, EDGE_E, EDGE_S, EDGE_O]

/** Le pas de voisinage que cette arête sépare (le bit doit être un SEUL des quatre). */
export function edgeStep(bit: number): { dx: number; dy: number } {
  if (bit === EDGE_N) return { dx: 0, dy: -1 }
  if (bit === EDGE_S) return { dx: 0, dy: 1 }
  if (bit === EDGE_O) return { dx: -1, dy: 0 }
  return { dx: 1, dy: 0 }
}

/**
 * Le bit de l'arête de (tx,ty) qui regarde (dx,dy), et SON OPPOSÉ chez le voisin.
 *
 * C'est la paire qui dit toute la subtilité du modèle : **une arête appartient à deux
 * tuiles**. Le mur entre (5,5) et (5,6) s'écrit « (5,5) + SUD » ou « (5,6) + NORD » —
 * même maçonnerie, deux adresses. Tout ce qui interroge une arête doit donc regarder
 * les DEUX côtés, sinon il rate un mur sur deux.
 */
export function edgeBits(dx: number, dy: number): { ici: number; la: number } {
  if (dy < 0) return { ici: EDGE_N, la: EDGE_S }
  if (dy > 0) return { ici: EDGE_S, la: EDGE_N }
  if (dx < 0) return { ici: EDGE_O, la: EDGE_E }
  return { ici: EDGE_E, la: EDGE_O }
}

/** L'autre adresse de la MÊME arête : le bit vu depuis la tuile d'en face. */
export function oppositeEdge(bit: number): number {
  if (bit === EDGE_N) return EDGE_S
  if (bit === EDGE_S) return EDGE_N
  if (bit === EDGE_O) return EDGE_E
  return EDGE_O
}

/** Ce bit désigne-t-il UNE arête, et une seule ? (la seule forme qu'une pose accepte) */
export function isSingleEdge(bit: number): boolean {
  return bit === EDGE_N || bit === EDGE_E || bit === EDGE_S || bit === EDGE_O
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
