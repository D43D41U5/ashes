/**
 * ═══ DÉPLIER LE LIFT — le point MONDE que le curseur désigne, à travers le relief dessiné ═══
 *
 * Une tuile de hauteur `h` (palier + chapeau, `render/relief.ts`) se DESSINE `h × LIFT_TUILES`
 * rangées plus haut que sa rangée logique (T-R7), et tout ce qui s'y tient monte avec elle :
 * sol, nœuds, corps, ombres. Le curseur, lui, tombait sur le monde PLAT — la tuile `ty` de
 * l'écran. Sur une mesa, viser la pierre qu'on VOIT résolvait donc la tuile deux rangées au
 * NORD de la sienne : *« les points de récolte sont décalés de deux tuiles vers le bas »*
 * (Alexis, 2026-09-02). `decalageDEtage` promettait que « le clic la lit » — c'est ici que la
 * promesse se tient, et depuis les terrasses elle se tient pour TOUS les paliers.
 *
 * LA RÈGLE, dans l'ordre où l'écran est peint (les strates, `strateDEtage`), du plus haut au
 * plus bas — la première tuile qui se dessine à cette rangée d'écran est celle qu'on voit :
 *  1. la tuile `ty + h × LIFT_TUILES` a la hauteur `h` : c'est elle, on rend son point déplié ;
 *  2. une RAMPE qui monte vers `h` se dessine sur `LIFT_TUILES + 1` rangées, du tablier au sol
 *     (sa propre rangée, prise par la règle 1 à la hauteur du bas) jusqu'au haut de l'entaille :
 *     ses rangées levées ne tombent sous aucune tuile de hauteur `h` — elles sont la rampe ;
 *  3. sinon, la hauteur d'en dessous, jusqu'au sol plat tel quel.
 * Et SOUS TERRE la salle se regarde d'aplomb, au lift de son palier (`decalageDEtage` ne
 * décale pas un souterrain) : le monde d'en haut n'est pas à l'écran.
 *
 * ⚠ L'ambiguïté est assumée dans le même sens que le rendu : au nord d'un mur, la surface
 * levée recouvre `LIFT_TUILES` rangées de vrai sol par étage de dénivelé — on ne les voit pas,
 * on ne les vise donc pas.
 *
 * Pure, sans Phaser ; en pixels monde, comme `unproject`, pour se glisser à sa place.
 */
import { connecteurAt } from '@ashes/sim'
import { LIFT_TUILES, TILE_PX } from './framing'
import type { Relief } from './relief'

export function deplierLeLift(
  relief: Relief,
  wx: number,
  wy: number,
  /** `true` quand le regard est sous terre : la salle seule est peinte, au lift de son palier. */
  souterrain = false,
): { x: number; y: number } {
  if (!relief.actif) return { x: wx, y: wy }
  const tx = Math.floor(wx / TILE_PX)
  const ty = Math.floor(wy / TILE_PX)
  const L = LIFT_TUILES
  if (souterrain) {
    for (let p = relief.hauteurMax; p >= 1; p--) {
      if (relief.salle(tx, ty + p * L) && relief.palier(tx, ty + p * L) === p) return { x: wx, y: wy + p * L * TILE_PX }
    }
    return { x: wx, y: wy }
  }
  for (let h = relief.hauteurMax; h >= 1; h--) {
    if (relief.hauteur(tx, ty + h * L) === h) return { x: wx, y: wy + h * L * TILE_PX }
    // Les rangées LEVÉES du dessin d'une rampe qui monte vers `h` (son tablier, au sol, est la
    // tuile elle-même — règle 1, à la hauteur du bas).
    const bas = h - 1
    for (let d = L; d >= 1; d--) {
      const c = connecteurAt(relief.map, tx, ty + bas * L + d)
      if (c !== undefined && c.type === 'rampe' && Math.min(c.de, c.vers) === bas) {
        return { x: wx, y: wy + (bas * L + d) * TILE_PX }
      }
    }
  }
  return { x: wx, y: wy }
}
