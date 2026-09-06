/**
 * ═══ UN CORPS POUSSÉ RESTE À SON ÉTAGE (spec `etages.md` E-A3, bug du 2026-09-06) ═══
 *
 * Alexis : *« lorsque je fais une attaque lourde dans le mur d'une grotte, je monte d'un
 * étage »*. Trois poussées du jeu — la CHARGE d'un coup (`advanceLunge`), le RECUL d'un coup
 * reçu (`knockback`) et la SÉPARATION des corps (`separation.ts`) — passaient par `resolveMove`
 * sans dire à quel étage le corps se tenait. Sans `etages`, la collision juge le SOL : sous une
 * terrasse, le sol est la surface de la terrasse, marchable partout — la charge traversait donc
 * la paroi de la grotte, et le pas suivant, ne trouvant plus de plancher à −2 sous le corps,
 * retombait « au palier du sol » (`etageApresLePas`) : à la surface. Sous une mesa, l'inverse :
 * le sol est de la roche, et la charge était CLOUÉE — pas d'élan du tout dans la cave.
 *
 * Le pas du joueur (`sim.ts`) et celui des bêtes (`monsters.ts`) faisaient déjà les trois
 * gestes : lire l'étage, résoudre AVEC lui, reposer l'étage à l'arrivée. Ils sont écrits ICI une
 * fois, pour tout ce qui déplace un corps SANS être un pas — et un site nouveau qui pousserait un
 * corps par `resolveMove` nu se lit désormais comme une faute.
 */
import { resolveMove } from './collision'
import { etageApresLePas, etagesDuPas, niveauDuCorps, poserLEtageDuCorps } from './etages'
import type { Entity, SimState } from './sim'
import { getVillageOf } from './village'

/**
 * Pousse `corps` de (`dx`, `dy`) tuiles, à SON étage : un mur de sa grotte l'arrête comme un pas,
 * et l'étage est relu à l'arrivée exactement comme après un pas (une rampe se descend en reculant).
 */
export function pousserLeCorps(state: SimState, corps: Entity, dx: number, dy: number): void {
  const etageAvant = niveauDuCorps(state.map, corps)
  const etages = etagesDuPas(state.map, etageAvant, Math.floor(corps.x), Math.floor(corps.y))
  const world = {
    map: state.map,
    structures: state.structures,
    nodes: state.nodes,
    moverVillageId: getVillageOf(state, corps.id)?.id ?? null,
    ...(etages !== undefined ? { etages } : {}),
    etat: state,
  }
  const moved = resolveMove(world, corps.x, corps.y, dx, dy)
  corps.x = moved.x
  corps.y = moved.y
  poserLEtageDuCorps(state.map, corps, etageApresLePas(state.map, etages, etageAvant, Math.floor(moved.x), Math.floor(moved.y)))
}
