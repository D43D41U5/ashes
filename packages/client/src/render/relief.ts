/**
 * LE RELIEF LU PAR LE RENDU — la HAUTEUR de chaque tuile, cuite une fois (spec `terrasses.md`
 * §4, T-R7/T-R8).
 *
 * Deux choses lèvent une tuile à l'écran, et elles s'additionnent :
 *
 *   • son PALIER (`palierDuSol`, T-R1) — le sol lui-même est en terrasses ;
 *   • un CHAPEAU de mesa posé dessus (`etages.md`) — un étage de plus au-dessus du palier.
 *
 * `hauteur = palier + (chapeau ? 1 : 0)` est LE nombre que toutes les couches lisent : où se
 * dessine la tuile (`liftDuPalier(hauteur)`), dans quelle strate (`strateDEtage(hauteur)`), et
 * combien de rangées de PAROI la séparent de sa voisine sud (`(h − hs) × PAROI_RANGEES`). Une
 * paroi de terrasse et une paroi de mesa sont la même paroi — c'est ce qui permet de ne l'écrire
 * qu'une fois.
 *
 * ⚠ **CUIT UNE FOIS, EN `Uint8Array`.** Le relief ne change jamais en partie (les étages et les
 * paliers naissent au worldgen) ; les couches le lisent des milliers de fois par image (chaque
 * tuile de la vue, ses quatre voisines). Une lecture de tableau, pas une dichotomie dans l'index
 * d'un étage. Quatre bits par tuile : le palier (0-3), le chapeau, la salle.
 *
 * Math pure, aucun import Phaser — `deplierLeLift` (le clic) et les gardes le lisent en Node.
 */
import { connecteurAt, palierDuSol, terrainAEtage, type WorldMap } from '@ashes/sim'

const BITS_PALIER = 0b0011
const BIT_CHAPEAU = 0b0100
const BIT_SALLE = 0b1000

export interface Relief {
  readonly map: WorldMap
  /** Le palier du sol de la tuile — 0 hors carte et sur une carte sans terrasse. */
  palier(tx: number, ty: number): number
  /** Le palier PLUS le chapeau de mesa s'il y en a un : la hauteur à laquelle la tuile se
   *  dessine. Hors carte : 0. */
  hauteur(tx: number, ty: number): number
  /** Un chapeau de mesa se dresse sur cette tuile (l'étage `palier + 1` la porte, et ce n'est
   *  pas une rampe — la rampe reste au SOL, elle est peinte sur lui). */
  chapeau(tx: number, ty: number): boolean
  /** Une salle est creusée sous cette tuile (l'étage `palier − 1` la porte). */
  salle(tx: number, ty: number): boolean
  /** La plus grande hauteur de la carte : la borne des boucles de dépliage. */
  readonly hauteurMax: number
  /** La carte a-t-elle le moindre relief (palier ou étage) ? Sinon tout vaut 0 et les couches
   *  peuvent garder leur chemin plat. */
  readonly actif: boolean
  /** Au moins une salle creusée quelque part : le voile de cave et ses FX ne s'allouent que là. */
  readonly aDesSalles: boolean
}

export function creerRelief(map: WorldMap): Relief {
  const { width, height } = map
  const niveaux = new Set<number>()
  for (const e of map.etages ?? []) niveaux.add(e.niveau)
  const aDesPaliers = map.palier !== undefined
  const actif = aDesPaliers || niveaux.size > 0
  // Sans relief, on ne cuit rien : une carte plate ne paie ni le tableau ni la passe.
  const bits = actif ? new Uint8Array(width * height) : null
  let hauteurMax = 0
  let aDesSalles = false
  if (bits) {
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const p = palierDuSol(map, tx, ty)
        let b = p & BITS_PALIER
        // Le chapeau : l'étage du dessus PORTE la tuile (un terrain non vide), hors rampe.
        if (niveaux.has(p + 1) && terrainAEtage(map, p + 1, tx, ty) !== 0 && connecteurAt(map, tx, ty) === undefined) {
          b |= BIT_CHAPEAU
        }
        if (niveaux.has(p - 1) && terrainAEtage(map, p - 1, tx, ty) !== 0) {
          b |= BIT_SALLE
          aDesSalles = true
        }
        bits[ty * width + tx] = b
        const h = p + ((b & BIT_CHAPEAU) !== 0 ? 1 : 0)
        if (h > hauteurMax) hauteurMax = h
      }
    }
  }
  const lire = (tx: number, ty: number): number => {
    if (bits === null || tx < 0 || ty < 0 || tx >= width || ty >= height) return 0
    return bits[ty * width + tx]!
  }
  return {
    map,
    palier: (tx, ty) => lire(tx, ty) & BITS_PALIER,
    hauteur: (tx, ty) => {
      const b = lire(tx, ty)
      return (b & BITS_PALIER) + ((b & BIT_CHAPEAU) !== 0 ? 1 : 0)
    },
    chapeau: (tx, ty) => (lire(tx, ty) & BIT_CHAPEAU) !== 0,
    salle: (tx, ty) => (lire(tx, ty) & BIT_SALLE) !== 0,
    hauteurMax,
    actif,
    aDesSalles,
  }
}
