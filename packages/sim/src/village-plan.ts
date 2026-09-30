/**
 * LA GÉOMÉTRIE DU CAMPEMENT — ce qui reste du plan directeur des villages PNJ.
 *
 * ⚠ **CE FICHIER PESAIT 356 LIGNES ET IL EN PÈSE 94** : le plan directeur (une fonction PURE de
 * (Feu, palier de bâti, paillasses posées) → les pièces que le village VOULAIT, dont le tableau
 * dérivait ses tâches `build`) est parti le 2026-09-29. Le détail de ce qui tombe, et pourquoi,
 * est en bas de fichier — on garde la leçon là où elle a été payée.
 *
 * Ce qui reste est de la géométrie et un prédicat, sans un tirage : les emplacements de logis du
 * campement, l'ancre de son lit, et « est-ce un grenier ? ». Déterministe par construction.
 */
import { piece } from './pieces'
import type { Structure } from './village'

/**
 * EST-CE UN GRENIER ? — UNE QUESTION DE FONCTION, PAS DE TYPE.
 *
 * Ce prédicat testait `s.type === 'chest'`, et le registre disait déjà autre chose : `silo`,
 * `cave` et `reserve` déclarent `fonction: 'grenier'` et `capacite: 36`. Le bourg montait donc
 * sa réserve à grand-peine — 8 bois et 4 fibres pour le silo, de la pierre taillée pour la
 * cave — et n'en tirait RIEN : `granaryStocks` ne la comptait pas, les cibles du tableau ne la
 * voyaient pas, aucun villageois n'y déposait ni n'y retirait. Une réserve dont le village ne
 * se sert pas, et qui ne le sauvait pas de la perte d'un coffre à 4 bois.
 *
 * Le `chest` reste vrai d'office : c'est le grenier de fondation (`worldgen.ts`), et son entrée
 * de registre porte `acces: 'private'` — c'est le champ `access` de l'INSTANCE qui en fait un
 * bien commun, pas son type.
 *
 * ⚠ IL EN A EU TROIS, IL N'EN A PLUS QU'UN : le rapport du banc (`scenario.ts`). L'économie du
 * village et la CIBLE DU RAID (`npc-errands.ts`) — qui devaient rester d'accord avec lui, sans
 * quoi le raid aurait visé autre chose que ce que le village comptait — sont parties les
 * 2026-09-26/29 avec les villages PNJ. **La leçon SURVIT et c'est pour elle qu'on garde le
 * prédicat** : tout coffre commun d'une balise se posera la même question, et la réponse est
 * une FONCTION, pas un type.
 */
export function estGrenier(s: Structure, villageId: number): boolean {
  if (s.villageId !== villageId || s.access !== 'village') return false
  return s.type === 'chest' || piece(s.type).fonction === 'grenier'
}

// ─── La géométrie du village (offsets depuis le Feu) ──────────────────────
//
// Tout tient dans le carré du Feu palier 1 (rayon 10) : logis 4×4 en deux colonnes
// et un pignon nord, enceinte de PALISSADE en anneau 9 (disque 8). Les bandes de
// murs des logis montent à ±8 — l'anneau ne les touche jamais — et la ruelle
// centrale (x ∈ [0,1]) reste LIBRE du Feu à la porte charretière, au sud. Le
// coffre-grenier vit en (0,−2) depuis toujours (worldgen).

/** Les emplacements de logis (COIN nord-ouest de l'intérieur), dans l'ordre
 *  d'installation — les flancs de la ruelle d'abord, les angles ensuite. */
export const HUT_SPOTS: readonly (readonly [number, number])[] = [
  [-7, -2],
  [3, -2],
  [-2, -7],
  [3, 3],
  [-7, 3],
  [3, -7],
  [-7, -7],
]

/** L'ANCRE d'un logis — la tuile du lit : la paillasse s'y pose, le logis se bâtit autour. */
export function bedAnchor(fx: number, fy: number, spot: readonly [number, number]): [number, number] {
  return [fx + spot[0] + 1, fy + spot[1] + 1]
}

/*
 * ⚠ ═══ LE PLAN DIRECTEUR DU CAMPEMENT A VÉCU ICI, ET IL EST PARTI LE 2026-09-29 ═══
 *   (tranche 4 du retrait des villages PNJ, pivot de la braise du 2026-09-28.)
 *
 * Partent : `desiredOrders` (les ordres manquants dans l'ordre du chantier — un logis 3×3 autour
 * de chaque paillasse, l'enceinte de bois percée d'une porte charretière au sud, les stations,
 * puis la pierre), `orderCost`, `contourEdges`, `hutDoor`, `STATION_SPOTS`, `DIRS`, `HUT_W`,
 * `buildTierOf`, `granaries`, `granaryStocks` / `GranaryStocks` et `foodScoreOf`.
 *
 * ⚠ TOUT CELA ÉTAIT PNJ PAR CONSTRUCTION, et deux gardes le disaient : `desiredOrders` s'ouvrait
 * sur `if (village.chiefId !== 0 || tier < 2) return []`, et son SEUL exécutant restant était
 * `debug_village_stage`, qui refusait déjà les villages à chef humain. Plus un village au monde
 * ne pouvait franchir les deux.
 *
 * CE QUI SURVIT, ET POURQUOI — les trois symboles que d'AUTRES systèmes appellent :
 *  · `estGrenier` : le rapport du banc l'appelle encore (`scenario.ts:338`) — mais DANS une
 *    boucle sur `sim.villages`, que V-A9 affirme désormais VIDE : l'appel ne s'exécute plus. On
 *    le garde donc pour sa LEÇON, pas pour un consommateur, et c'est la formulation honnête.
 *  · `HUT_SPOTS` et `bedAnchor` : leur SEUL lecteur est `foundNpcVillage` (`worldgen.ts`), qui
 *    n'a plus **aucun appelant de runtime** — ni la Veillée, ni le banc, ni le serveur. C'est
 *    désormais un MONTAGE DE TEST, appelé par une trentaine de fichiers de `/sim` qui ont besoin
 *    d'un Feu et d'un décor autour, plus `profil-tick` et `empreinte-sim`. Les retirer ne
 *    changerait donc RIEN au monde joué : ça remuerait ces montages et la référence
 *    d'`empreinte-sim`, pour zéro gain. On les garde comme montage, et on le dit ainsi.
 *    ⚠ (J'ai d'abord écrit qu'ils posaient « le campement de naissance » et que les retirer
 *     déplacerait des nœuds sur toute la carte : **c'était faux** — le monde joué n'a plus de
 *     campement du tout, la fondation ayant quitté `peuplerLesVoisins` le même jour.)
 */
