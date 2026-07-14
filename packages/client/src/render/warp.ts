/**
 * LES MARCHES — la verticalité, et elle se COMPTE.
 *
 * Math PURE, aucun import Phaser. Source de vérité du RENDU (`lift`) **et** du PICKING
 * (`unproject`) : les deux ne peuvent pas diverger, et c'est tout l'intérêt de n'avoir qu'un objet.
 * Quatorze couches du client soustraient `lift` de leur Y — sol, décor, lieux, acteurs, nœuds,
 * cadavres, curseur… — donc changer CE fichier suffit à changer le monde.
 *
 *   **`screenY = worldY × TILE − palier × STEP_PX`**, X jamais cisaillé (spec R34).
 *
 * ═══ CE QUI MEURT ICI, ET POURQUOI ═══
 *
 * Le relief était CONTINU : `elevation ∈ [0,1]`, échantillonnée en BILINÉAIRE, multipliée par un
 * `RELIEF_H` de 150 px. Trois vices, et ils étaient liés :
 *
 *   • **Illisible.** Le champ de la vallée est très doux (gradient sud max ≈ 0,012/tuile) : le sol
 *     se soulevait de trois pixels sur un écran. On ne voyait rien. Alexis : *« Phaser ne nous
 *     permet pas d'avoir un terrain avec assez de profondeur pour parler de vrai relief. »*
 *   • **Fragile.** Un champ qui descend vers le sud plus vite que `TILE_PX / RELIEF_H` replie
 *     l'image sur elle-même — la tuile du fond passe devant celle du devant. Il fallait donc un
 *     garde-fou (`assertNoFold`) qui refusait de démarrer le jeu, et **une seed sur quatre le
 *     déclenchait**.
 *   • **Interpolé.** Le bilinéaire LISSE, par construction. On ne peut pas faire une marche avec
 *     un outil dont le métier est de n'en faire aucune.
 *
 * Le palier est un ENTIER (spec R1), et le lift est CONSTANT PAR TUILE. Trois conséquences, toutes
 * gratuites :
 *
 *   1. **La marche est franche** — c'est une fonction en escalier, il n'y a rien à lisser.
 *   2. **Le repli est IMPOSSIBLE**, tant que `STEP_PX < TILE_PX` : deux tuiles marchables voisines
 *      ne diffèrent que d'un palier au plus (garde A9/A10 de `/sim`), et une rampe qui descend d'une
 *      marche vers le sud avance encore de `TILE_PX − STEP_PX` px à l'écran. `assertNoFold` n'a
 *      plus rien à garder : **il disparaît avec la faute qu'il surveillait.**
 *   3. **Le picking devient exact.** Plus de bissection sur une fonction continue : on énumère les
 *      quelques rangées candidates et on rend celle qui est DEVANT.
 */
import type { WorldMap } from '@braises/sim'
import { palierAt } from '@braises/sim'

export interface Warp {
  /** Décalage écran (px) à SOUSTRAIRE du py plat d'un point monde (tuiles). Constant par tuile. */
  lift(txf: number, tyf: number): number
  /** Écran-monde PLAT (px, tel que `positionToCamera` le rend) → monde VRAI (px). LE picking. */
  unproject(flatPxX: number, flatPxY: number): { x: number; y: number }
  /** Hauteur écran (px) d'UNE marche. */
  readonly step: number
  /** Le palier le plus haut de la carte — la borne du picking et des marges de culling. */
  readonly palierMax: number
}

/**
 * LE PICKING, ET LA RÈGLE D'OCCLUSION.
 *
 * Un lift en escalier n'est pas injectif : une terrasse haute et une tuile plus au sud, plus basse,
 * peuvent tomber sur le MÊME pixel d'écran. La question « quelle tuile est sous le curseur ? » a
 * donc plusieurs réponses, et il faut choisir la bonne — celle que le joueur VOIT.
 *
 * C'est celle qui est **DEVANT**, c'est-à-dire la plus au SUD : le sol se dessine du nord vers le
 * sud, donc une tuile méridionale recouvre ce qui la précède. On énumère les rangées candidates
 * (au plus `palierMax × STEP / TILE + 1`, soit une poignée) et on rend **la plus grande `ty`** dont
 * la bande écran contient le point. Le curseur désigne alors exactement ce qu'on lui montre.
 */
export function createWarp(map: WorldMap, step: number, tilePx: number): Warp {
  const palierMax = map.palierMax ?? 0

  const lift = (txf: number, tyf: number): number =>
    palierAt(map, Math.floor(txf), Math.floor(tyf)) * step

  const unproject = (flatPxX: number, flatPxY: number): { x: number; y: number } => {
    const tx = Math.floor(flatPxX / tilePx) // X n'est jamais cisaillé → exact.
    // `flatPxY = ty·TILE − palier·STEP`, et `palier·STEP ∈ [0, palierMax·STEP]`
    //   ⇒ `ty ∈ [flatPxY/TILE, flatPxY/TILE + palierMax·STEP/TILE]`.
    const ty0 = Math.floor(flatPxY / tilePx)
    const ty1 = ty0 + Math.ceil((palierMax * step) / tilePx) + 1
    for (let ty = ty1; ty >= ty0; ty--) { // du SUD vers le nord : la première trouvée est DEVANT
      const haut = ty * tilePx - palierAt(map, tx, ty) * step
      if (flatPxY >= haut && flatPxY < haut + tilePx) return { x: flatPxX, y: ty * tilePx }
    }
    // Aucune tuile ne couvre ce pixel (on regarde le vide au pied d'une falaise) : on rend le sol
    // plat. Mieux vaut une réponse plausible qu'un trou dans le picking.
    return { x: flatPxX, y: flatPxY }
  }

  return { lift, unproject, step, palierMax }
}
