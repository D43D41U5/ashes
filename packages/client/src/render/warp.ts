/**
 * LE WARP — le PLI de l'écran (spec `terrasses.md` T-R7).
 *
 * La carte a des paliers : une tuile de palier `p` se dessine `p × LIFT_TUILES` rangées plus
 * haut que sa rangée logique, pour libérer sous elle la place de sa PAROI. `lift` est ce
 * décalage, en pixels, pour la tuile qui porte le point `(txf, tyf)` — et une quinzaine de
 * couches l'appellent : le sol, les pavés, les feux, le sang, les nœuds, les corps. C'est LA
 * raison d'être de cet objet : un seul endroit sait de combien le sol monte, et tout ce qui se
 * pose sur le sol le lit là.
 *
 * ⚠ **LA TUILE, C'EST CELLE DU CENTRE.** `lift(x, y)` planche ses arguments : qui appelle avec
 * `ty + 1` (le pied d'un sprite ancré en bas) interroge la tuile du SUD — et au bord d'une
 * terrasse, celle-là est deux étages plus bas. Passer le centre de sa propre tuile
 * (`tx + 0,5, ty + 0,5`), ou le centre d'un corps — c'est le centre que la sim planche pour
 * décider de l'étage (`etageApresLePas`), donc c'est lui qui dit sur quel palier on est.
 *
 * Le décalage PROPRE à un étage (le chapeau d'une mesa au-dessus de son palier) n'est pas ici :
 * c'est `decalageDEtage(niveau, palier)`, et les deux s'additionnent.
 *
 * `unproject` (écran plat → monde) reste l'identité : le dépliage complet vit dans
 * `deplierLeLift` (il a besoin des parois et des rampes, pas seulement du palier), et
 * `WorldScene` l'enchaîne après. Math pure, aucun import Phaser : le smoke test s'appuie sur
 * `unproject` comme source de vérité de la conversion écran→monde.
 */
import { decalageDEtage, liftDuPalier, strateDEtage } from './framing'
import type { Relief } from './relief'

export interface Warp {
  /** Décalage écran (px) à soustraire du py plat : le lift du PALIER de la tuile qui porte le
   *  point — 0 sur une carte sans terrasse. */
  lift(txf: number, tyf: number): number
  /** Le palier de la tuile qui porte le point — pour la STRATE de ce qu'on y pose
   *  (`strateDEtage(palier)`), sans quoi un feu au palier 2 se peint SOUS le sol du palier 2. */
  palier(txf: number, tyf: number): number
  /**
   * CE QUI SE TIENT À UN ÉTAGE DE SA TUILE — un nœud, ce qu'on dessine autour de lui (sa jauge
   * d'abattage, ses flancs de minage) : le lift de son palier ET la part propre à l'étage
   * (`decalageDEtage` — le chapeau d'une mesa au-dessus du palier qui le porte), en UN nombre à
   * soustraire du py plat, comme `lift`. `etage` absent ≡ le palier (T-R3), donc `lift`.
   *
   * Né le 2026-09-04 : quatre consommateurs d'un nœud (sprite, ombre de contact, houppier, jauge)
   * écrivaient chacun leur somme — et trois d'entre eux avaient oublié l'étage.
   */
  liftAEtage(txf: number, tyf: number, etage: number | undefined): number
  /** La STRATE de la même chose (`strateDEtage`, E-R22 : « deux nombres, jamais un ») — une pile,
   *  une goutte, une souche lâchées à un étage se trient dans le monde de cet étage. */
  strateAEtage(txf: number, tyf: number, etage: number | undefined): number
  /**
   * CE QUI EST POSÉ AU SOL, SANS ÉTAGE À SOI — le sang, un terrier, une pile d'objets, un cadavre
   * sans `etage` : il est à la HAUTEUR de sa tuile, palier ET chapeau de mesa compris. `liftSol`
   * est son décalage écran, `strateSol` sa strate ; les deux se lisent d'un seul nombre
   * (`relief.hauteur`) pour qu'un cadavre sur un plateau ne se dessine jamais sur le chapeau en
   * se triant sous lui.
   */
  liftSol(txf: number, tyf: number): number
  strateSol(txf: number, tyf: number): number
  /** Le plus grand lift de la carte (px) — LA MARGE SUD de toute couche fenêtrée : une tuile
   *  dessinée `liftMaxPx` plus haut que sa rangée logique est visible alors que sa rangée est
   *  sous le bas de l'écran. 0 sur une carte plate. */
  readonly liftMaxPx: number
  /** Écran plat → monde. Identité : le dépliage est l'affaire de `deplierLeLift`. */
  unproject(flatPxX: number, flatPxY: number): { x: number; y: number }
}

export function createWarp(relief?: Relief): Warp {
  const identite = (flatPxX: number, flatPxY: number): { x: number; y: number } => ({ x: flatPxX, y: flatPxY })
  if (relief === undefined || !relief.actif) {
    return {
      lift: () => 0, palier: () => 0, liftAEtage: (_x, _y, etage) => -decalageDEtage(etage ?? 0, 0),
      strateAEtage: (_x, _y, etage) => strateDEtage(etage ?? 0, 0),
      liftSol: () => 0, strateSol: () => 0, liftMaxPx: 0, unproject: identite,
    }
  }
  const palier = (txf: number, tyf: number): number => relief.palier(Math.floor(txf), Math.floor(tyf))
  const hauteur = (txf: number, tyf: number): number => relief.hauteur(Math.floor(txf), Math.floor(tyf))
  return {
    lift: (txf, tyf) => liftDuPalier(palier(txf, tyf)),
    palier,
    liftAEtage: (txf, tyf, etage) => {
      const p = palier(txf, tyf)
      return liftDuPalier(p) - decalageDEtage(etage ?? p, p)
    },
    strateAEtage: (txf, tyf, etage) => {
      const p = palier(txf, tyf)
      return strateDEtage(etage ?? p, p)
    },
    liftSol: (txf, tyf) => liftDuPalier(hauteur(txf, tyf)),
    strateSol: (txf, tyf) => strateDEtage(hauteur(txf, tyf)),
    liftMaxPx: liftDuPalier(relief.hauteurMax),
    unproject: identite,
  }
}
