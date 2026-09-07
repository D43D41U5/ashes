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
 * ⚠ **LA RÈGLE N'EST PLUS ÉCRITE ICI — elle vit dans `strates.ts` (`strateDessineeA`), l'accesseur
 * d'étage du rendu.** Elle l'était, et c'est précisément ce qui a coûté deux bugs : recopiée
 * dans `niveau-du-corps.ts`, elle a oublié la GUEULE des deux côtés le jour où les grottes sont
 * arrivées. Ce module ne fait plus que l'habiller en pixels monde pour se glisser à la place
 * d'`unproject` — et porter le cas SOUS TERRE, qui n'est pas une strate d'écran mais un autre
 * regard : la salle s'y voit d'aplomb, au lift de sa GUEULE, le palier `−niveau − 1` (G-R1,
 * `decalageDEtage`) — le monde d'en haut n'est pas à l'écran.
 *
 * Pure, sans Phaser ; en pixels monde, comme `unproject`, pour se glisser à sa place.
 */
import { LIFT_TUILES, palierDUneSalle, TILE_PX } from './framing'
import type { Relief } from './relief'
import { strateDessineeA } from './strates'

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
      if (palierDUneSalle(relief.niveauDeSalle(tx, ty + p * L)) === p) return { x: wx, y: wy + p * L * TILE_PX }
    }
    return { x: wx, y: wy }
  }
  // Et le dehors est L'ACCESSEUR, pas une seconde écriture : `strateDessineeA` dit quelle carte
  // se dessine à cette rangée. C'est là, et là seulement, que vivent les règles 1, 2 et 3.
  const { ty: cible } = strateDessineeA(relief, tx, ty)
  return { x: wx, y: wy + (cible - ty) * TILE_PX }
}
