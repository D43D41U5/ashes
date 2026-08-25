/**
 * LE CHAMP DE NEIGE — où il grésille, où il neige, où il pleut (R14, 2026-08-24).
 *
 * `partDeNeige(T₀)` de `/sim` dit la part de flocons dans ce qui tombe en UN point. Ce module
 * en fait un CHAMP : une grille grossière ancrée au monde, relue en BILINÉAIRE. Il est PUR —
 * il ne connaît ni Phaser, ni la sim, ni la caméra : on lui passe une fonction de mesure et un
 * cadre en tuiles.
 *
 * ═══ POURQUOI UNE GRILLE, ET NON UNE LECTURE PAR POINT ═══
 *
 * Deux raisons, et la seconde est la vraie.
 *
 * LE COÛT — `dehorsSansMeteo` balaie l'heure, le biome, la Brume et les fumerolles. À une
 * lecture par particule et par naissance (une bonne centaine par image), on la paierait des
 * milliers de fois par seconde pour un champ qui ne change qu'avec l'heure et le terrain.
 *
 * LA MARCHE — et c'est elle qui commande. `T₀` ne varie pas continûment dans l'espace : il
 * SAUTE d'une tuile à l'autre, par `BIOME_OFFSET` (marais −2, pré 0, forêt +2). Lu crûment
 * point par point, le mélange dessinerait la LISIÈRE AU PIXEL — une couture de flocons contre
 * une couture de gouttes, alignée sur la grille des tuiles, sur une carte qui est justement
 * plate. On échangerait un mur temporel (le ciel qui commute quand on marche) contre un mur
 * spatial, et le second se voit encore mieux que le premier. La grille de `PAS_TUILES` relue
 * en bilinéaire étale la marche sur sa maille : la lisière devient une TRANSITION de quelques
 * tuiles, qu'on traverse au lieu de la franchir. C'est le seul lissage du dispositif, et il
 * est ici — la loi, elle, reste nette.
 *
 * ═══ ANCRÉE AU MONDE, JAMAIS À L'ÉCRAN ═══
 *
 * Les nœuds tombent sur des multiples de `PAS_TUILES` en coordonnées MONDE. Une grille ancrée
 * au cadre glisserait avec la caméra, et le mélange scintillerait sous un panoramique alors
 * que rien ne bouge dans le monde. On rebâtit quand le cadre sort de la zone couverte (elle a
 * de la marge, donc pas à chaque pas) ou quand le relevé a vieilli — l'heure fait dériver `T₀`
 * lentement, et une averse dure des minutes.
 *
 * ⚠ **MARCHER NE PÉRIME RIEN, ET C'EST L'ANCRAGE QUI L'OFFRE.** La question se pose — « le
 * champ n'est rebâti qu'une fois par `PEREMPTION_MS`, donc il traîne de six tuiles derrière un
 * joueur qui court » — et la réponse est non : les valeurs sont celles de POINTS DU MONDE, pas
 * de points de l'écran. Tant que `couvre` est vrai, tout ce qu'on interroge (les naissances de
 * particules, l'œil du joueur) tombe dans la zone relevée et rend la valeur JUSTE de ce
 * point-là. La péremption ne borne que la dérive de l'HEURE — quelques centièmes de degré sur
 * une seconde et demie, à 30 min de cycle. Un champ ancré à l'écran, lui, aurait bel et bien
 * eu ce retard : c'est la raison de l'ancrage, et pas seulement le scintillement.
 */

/** Le cadre à couvrir, en TUILES monde. */
export interface CadreTuiles {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/**
 * LA MAILLE, en tuiles. C'est elle qui fixe sur combien de tuiles une marche de biome s'étale :
 * quatre tuiles, soit un peu plus d'une seconde de marche — assez pour que la transition se
 * LISE comme une transition, assez peu pour qu'un marais de dix tuiles reste un marais.
 */
export const PAS_TUILES = 4

/** La marge autour du cadre, en MAILLES : elle évite de rebâtir à chaque pas de côté. */
const MARGE_MAILLES = 3

/** Au-delà, le relevé est périmé : l'heure a bougé, donc `T₀` aussi. */
const PEREMPTION_MS = 1500

export class ChampNeige {
  private valeurs = new Float32Array(0)
  /** Le coin haut-gauche de la grille, en MAILLES monde. */
  private gx0 = 0
  private gy0 = 0
  private nx = 0
  private ny = 0
  private mesureAt = -1e9
  /** Combien de nœuds ont été relevés au dernier rebâti — remontée dans la sonde de la couche
   *  (`sonde.noeuds`), avec le temps que ça prend : c'est un coût qui vit HORS du chronomètre
   *  des particules, donc invisible si on ne le nomme pas. */
  releves = 0

  constructor(private readonly pas: number = PAS_TUILES) {}

  /** Tout oublier — le front est sorti, ou le ciel ne peut plus neiger. */
  vider(): void {
    this.nx = 0
    this.ny = 0
    this.mesureAt = -1e9
    this.releves = 0
  }

  /**
   * Relever si besoin. `mesure(x, y)` rend la part de froid en un point (tuiles monde) —
   * typiquement `partDeNeige(dehorsSansMeteo(...))`. Ne fait RIEN si la grille couvre déjà le
   * cadre et que le relevé est frais : c'est le cas courant, image après image.
   */
  maj(mesure: (x: number, y: number) => number, cadre: CadreTuiles, nowMs: number): void {
    if (this.couvre(cadre) && nowMs - this.mesureAt < PEREMPTION_MS) return
    const gx0 = Math.floor(cadre.x0 / this.pas) - MARGE_MAILLES
    const gy0 = Math.floor(cadre.y0 / this.pas) - MARGE_MAILLES
    const gx1 = Math.ceil(cadre.x1 / this.pas) + MARGE_MAILLES
    const gy1 = Math.ceil(cadre.y1 / this.pas) + MARGE_MAILLES
    const nx = gx1 - gx0 + 1
    const ny = gy1 - gy0 + 1
    if (this.valeurs.length < nx * ny) this.valeurs = new Float32Array(nx * ny)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        this.valeurs[j * nx + i] = mesure((gx0 + i) * this.pas, (gy0 + j) * this.pas)
      }
    }
    this.gx0 = gx0
    this.gy0 = gy0
    this.nx = nx
    this.ny = ny
    this.mesureAt = nowMs
    this.releves = nx * ny
  }

  /** La part de froid en (x, y), en tuiles monde — bilinéaire, bornée aux nœuds du bord.
   *  0 tant que rien n'a été relevé : sans mesure, il ne neige pas. */
  part(x: number, y: number): number {
    if (this.nx === 0) return 0
    const u = x / this.pas - this.gx0
    const v = y / this.pas - this.gy0
    const i0 = Math.min(this.nx - 1, Math.max(0, Math.floor(u)))
    const j0 = Math.min(this.ny - 1, Math.max(0, Math.floor(v)))
    const i1 = Math.min(this.nx - 1, i0 + 1)
    const j1 = Math.min(this.ny - 1, j0 + 1)
    const fx = Math.min(1, Math.max(0, u - i0))
    const fy = Math.min(1, Math.max(0, v - j0))
    const a = this.valeurs[j0 * this.nx + i0]!
    const b = this.valeurs[j0 * this.nx + i1]!
    const c = this.valeurs[j1 * this.nx + i0]!
    const d = this.valeurs[j1 * this.nx + i1]!
    const haut = a + (b - a) * fx
    const bas = c + (d - c) * fx
    return haut + (bas - haut) * fy
  }

  /** La grille couvre-t-elle ce cadre, marge comprise ? */
  private couvre(cadre: CadreTuiles): boolean {
    if (this.nx === 0) return false
    return cadre.x0 >= this.gx0 * this.pas
      && cadre.y0 >= this.gy0 * this.pas
      && cadre.x1 <= (this.gx0 + this.nx - 1) * this.pas
      && cadre.y1 <= (this.gy0 + this.ny - 1) * this.pas
  }
}
