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
 *  2bis. une GUEULE de grotte se dessine EXACTEMENT COMME ELLE : `poserLaGueule` pose son image
 *     de 32×48 à `ty − palier × LIFT_TUILES − LIFT_TUILES`, donc l'arche noire — tout ce que
 *     `PROFIL` ouvre (`cave-art.ts`) — occupe les `LIFT_TUILES` rangées d'écran AU-DESSUS du
 *     seuil, sur la paroi ; le seuil lui-même n'est qu'une tache. Sans cette règle, viser le
 *     trou noir tombait sur le monde plat, DANS la masse : *« l'entrée d'une grotte sort d'une
 *     case par rapport au sprite de l'entrée, ce qui donne des murs invisibles quand on est
 *     dehors »* (Alexis, 2026-09-06). MESURÉ sur les six grottes les plus proches du spawn :
 *     les deux rangées de l'arche rendaient la tuile de leur propre rangée d'écran (« repli
 *     plat »), soit **une à deux tuiles au nord du seuil au palier 0, trois à quatre au palier
 *     1** — de la roche pleine à chaque fois ;
 *  3. sinon, la hauteur d'en dessous, jusqu'au sol plat tel quel.
 * Et SOUS TERRE la salle se regarde d'aplomb, au lift de sa GUEULE — le palier `−niveau − 1`
 * (G-R1, `decalageDEtage`) : le monde d'en haut n'est pas à l'écran.
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
    // Une salle se peint au lift de sa GUEULE, le palier `−niveau − 1` (spec `grottes.md` G-R1,
    // `EtageLayer.rendreLaCave`) — pas au palier de la tuile qui la coiffe.
    for (let p = relief.hauteurMax; p >= 1; p--) {
      if (-relief.niveauDeSalle(tx, ty + p * L) - 1 === p) return { x: wx, y: wy + p * L * TILE_PX }
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
      if (c === undefined) continue
      // La rampe monte VERS `h` : le bas de son entaille est le palier `bas`.
      // La gueule, elle, s'ouvre SUR le palier `bas` et descend (`de` = le palier, `vers` = le
      // niveau de la salle, négatif) — c'est `de` qu'on compare, jamais le min.
      const porte = c.type === 'rampe' ? Math.min(c.de, c.vers) === bas : c.type === 'gueule' && c.de === bas
      if (porte) return { x: wx, y: wy + (bas * L + d) * TILE_PX }
    }
  }
  return { x: wx, y: wy }
}
