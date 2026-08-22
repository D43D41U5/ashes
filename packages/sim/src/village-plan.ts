/**
 * LE PLAN DIRECTEUR DES VILLAGES PNJ (spec `village-pnj-evolution.md`).
 *
 * Fonction PURE de (Feu, palier de bâti, paillasses posées) → les pièces que le
 * village VEUT. Le tableau du village en dérive ses tâches `build` ; les PNJ les
 * exécutent par le pipeline joueur. Trois principes :
 *
 *   · ADDITIF — on ne démolit jamais l'existant : ce qui manque devient un ordre,
 *     ce qui est là est acquis. Une pièce infaisable (falaise, eau, tuile prise
 *     par autre chose) est SAUTÉE, comme `poi-batis` : on ne bâtit pas dans une
 *     falaise, et un mur troué par le terrain est un fait de monde, pas un bug.
 *   · LE LOGIS SUIT LA PAILLASSE — le campement (palier 1) pose une paillasse par
 *     habitant aux emplacements des futurs logis ; le hameau (palier 2) bâtit le
 *     logis AUTOUR d'elle. Le lit du colon devient sa chambre.
 *   · MÊME GRAMMAIRE QUE `poi-batis` — murs d'arêtes dérivés du contour, posés sur
 *     la tuile EXTÉRIEURE avec le bit qui regarde la région (la découpe de façade
 *     du client lit cette convention).
 *
 * Déterministe : aucun tirage, que de la géométrie sur l'état.
 */
import { COMPONENTS, NODE_DEFS, STRUCTURE_COSTS, VILLAGE_GROWTH, WALL_TIERS, type ComponentType } from './balance'
import { edgeBarrierAt, fullTileAt, terrainConstructible } from './construction'
import { noeudDefriche, poseLibre } from './defriche'
import { EDGE_E, EDGE_N, EDGE_O, EDGE_S } from './geometry'
import { countOf, type Inventory, type ItemBag, type StructureType } from './items'
import { terrainAt } from './map'
import { piece } from './pieces'
import type { SimState } from './sim'
import { floorAt, roofAt, type BuildOrder, type Structure, type Village } from './village'

/** Le palier de bâti effectif (absent sur les parties sauvées d'avant = 1). */
export function buildTierOf(village: Village): number {
  return village.buildTier ?? 1
}

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
 * ⚠ CE PRÉDICAT A TROIS CONSOMMATEURS et ils doivent rester d'accord : l'économie du village
 * (ici), la CIBLE DU RAID (`npc-errands.ts`) et le rapport du banc (`scenario.ts`). Élargir
 * l'un sans les autres ferait viser au raid autre chose que ce que le village compte.
 */
export function estGrenier(s: Structure, villageId: number): boolean {
  if (s.villageId !== villageId || s.access !== 'village') return false
  return s.type === 'chest' || piece(s.type).fonction === 'grenier'
}

/** Les coffres-greniers du village : accès `village`, dans l'ordre des ids (spec pnj R5-R6).
 *  LA définition vit ici ; `village-board` la réexporte pour ses consommateurs historiques. */
export function granaries(state: SimState, villageId: number): Structure[] {
  return state.structures.filter((s) => estGrenier(s, villageId))
}

export interface GranaryStocks {
  berries: number
  stew: number
  wood: number
  fiber: number
  stone: number
  cut_stone: number
}

export function granaryStocks(state: SimState, villageId: number): GranaryStocks {
  const stocks: GranaryStocks = { berries: 0, stew: 0, wood: 0, fiber: 0, stone: 0, cut_stone: 0 }
  for (const chest of granaries(state, villageId)) {
    const inv: Inventory = chest.inventory ?? []
    stocks.berries += countOf(inv, 'berries')
    stocks.stew += countOf(inv, 'stew')
    stocks.wood += countOf(inv, 'wood')
    stocks.fiber += countOf(inv, 'fiber')
    stocks.stone += countOf(inv, 'stone')
    stocks.cut_stone += countOf(inv, 'cut_stone')
  }
  return stocks
}

/** Le score nourriture du tableau (spec pnj R5) : baies + 3×ragoût. */
export function foodScoreOf(stocks: GranaryStocks): number {
  return stocks.berries + stocks.stew * 3
}

// ─── La géométrie du village (offsets depuis le Feu) ──────────────────────
//
// Tout tient dans le carré du Feu palier 1 (rayon 10) : logis 4×4 en deux colonnes
// et un pignon nord, enceinte de PALISSADE en anneau 9 (disque 8). Les bandes de
// murs des logis montent à ±8 — l'anneau ne les touche jamais — et la ruelle
// centrale (x ∈ [0,1]) reste LIBRE du Feu à la porte charretière, au sud. Le
// coffre-grenier vit en (0,−2) depuis toujours (worldgen).

/** Le côté intérieur d'un logis (4×4 : « un peu trop petites », Alexis 2026-08-01). */
export const HUT_W = 4

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

/**
 * LA PORTE D'UN LOGIS REGARDE LE FEU : côté est pour la colonne ouest, ouest pour la
 * colonne est, sud pour le pignon nord. Rendue en adresse d'arête EXTÉRIEURE
 * `[tx, ty, bit]`, comme les murs du contour.
 */
function hutDoor(spot: readonly [number, number]): [number, number, number] {
  const [x0, y0] = spot
  // Les bits viennent de `geometry.ts`, jamais écrits en chiffres. Ils y ont été rassemblés
  // EXPRÈS (voir son en-tête : « une inversion N/S dans une seule des copies donnerait un mur
  // qui se voit ici et arrête là ») — et cette fonction était la CINQUIÈME copie, celle qui a
  // échappé au rassemblement. La pire : ses commentaires disaient « bit O » et son code disait
  // `8`, donc la faute d'accord entre les deux ne se voyait nulle part.
  if (x0 <= -3) return [x0 + HUT_W, y0 + 2, EDGE_O] // porte à l'EST, bit O : elle regarde le logis
  if (x0 >= 3) return [x0 - 1, y0 + 2, EDGE_E] //      porte à l'OUEST, bit E
  return y0 < 0 ? [x0 + 2, y0 + HUT_W, EDGE_N] : [x0 + 2, y0 - 1, EDGE_S] // pignon : vers le Feu
}

// PAS DE MOBILIER AU CAMPEMENT — et c'est mesuré, pas esthétique : un tonneau et une
// étagère flanquant le grenier faisaient COUVERTURE dans la mêlée (repro seed 15 :
// la horde de 10 qui CASSAIT un village de 2 ne le cassait plus — 84 PV au lieu d'un
// mort). Le mobilier-couverture est un choix de design à prendre exprès, pas un effet
// de bord du décor. Le palier 1 se lit déjà : un Feu, un coffre, des couchages.

/** Les stations du bourg (palier 3) — sans chaîne du fer (spec, hors périmètre). */
const STATION_SPOTS: readonly (readonly [number, number, ComponentType])[] = [
  [2, 1, 'workshop'],
  [-2, 1, 'furnace'],
  [2, -1, 'silo'],
]

// Bits d'arête (village.ts) : N=1, E=2, S=4, O=8. La tuile EXTÉRIEURE porte le
// bit qui REGARDE la région : dehors au nord de la région → le mur regarde au sud.
const DIRS: readonly (readonly [number, number, number])[] = [
  [0, -1, 4], // dehors au NORD → bit S
  [1, 0, 8], //  dehors à l'EST → bit O
  [0, 1, 1], //  dehors au SUD → bit N
  [-1, 0, 2], // dehors à l'OUEST → bit E
]

/**
 * Les arêtes du contour d'une région convexe : pour chaque tuile de la région et
 * chaque voisin orthogonal HORS région, l'adresse extérieure `[tx, ty, bit]`.
 * Parcours ligne à ligne — l'ordre EST l'ordre de construction (déterminisme).
 */
function contourEdges(
  inRegion: (dx: number, dy: number) => boolean,
  minD: number,
  maxD: number,
): [number, number, number][] {
  const edges: [number, number, number][] = []
  for (let dy = minD; dy <= maxD; dy++) {
    for (let dx = minD; dx <= maxD; dx++) {
      if (!inRegion(dx, dy)) continue
      for (const [ox, oy, bit] of DIRS) {
        if (inRegion(dx + ox, dy + oy)) continue
        edges.push([dx + ox, dy + oy, bit])
      }
    }
  }
  return edges
}

/** Le coût d'un ordre de construction — ce que le grenier doit porter. */
export function orderCost(order: BuildOrder): ItemBag {
  // DÉFRICHER NE COÛTE RIEN — ça rapporte. Le grenier n'a donc jamais à « couvrir » un
  // défrichement : le tableau ne peut pas le juger inabordable et bloquer le chantier
  // derrière lui, ce qui serait exactement le livelock que la doctrine du coût interdit.
  if (order.action === 'defriche') return {}
  if (order.action === 'pose') {
    if (order.structure === 'wall' || order.structure === 'door') {
      return WALL_TIERS[order.material ?? 'wood'][order.structure].cost
    }
    return STRUCTURE_COSTS[order.structure]
  }
  if (order.action === 'place') return COMPONENTS[order.component].cost
  return WALL_TIERS.stone.upgrade // upgrade : bois → pierre (la seule montée du plan)
}

/**
 * LES ORDRES MANQUANTS, dans l'ordre du chantier — le cœur du plan directeur.
 *
 * Palier ≥ 2 : un logis 3×3 autour de chaque paillasse posée (sol, murs de bois
 * en arêtes, porte au sud), puis l'enceinte (anneau de bois percé d'une porte
 * charretière de 2 arêtes au sud). Palier 3 : les stations, puis la pierre de
 * l'enceinte. Chaque ordre rendu est FAISABLE (terrain, occupation) et ABSENT.
 */
export function desiredOrders(state: SimState, village: Village): BuildOrder[] {
  const tier = buildTierOf(village)
  if (village.chiefId !== 0 || tier < 2) return []
  const orders: BuildOrder[] = []
  const map = state.map
  const fx = village.fireTx
  const fy = village.fireTy

  const onMap = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < map.width && ty < map.height
  const poseFeasible = (tx: number, ty: number, type: StructureType): boolean =>
    onMap(tx, ty) && terrainConstructible(terrainAt(map, tx, ty), type)

  const wantEdge = (tx: number, ty: number, bit: number, structure: 'wall' | 'door' | 'palissade', enceinte?: true): void => {
    if (!poseFeasible(tx, ty, structure)) return
    if (edgeBarrierAt(state.structures, tx, ty, bit)) return // déjà fermée (par nous ou un autre)
    // Le matériau ne vaut que pour mur/porte (R8) — la palissade n'a pas de palier.
    if (structure === 'palissade') orders.push({ action: 'pose', structure, tx, ty, edges: bit, ...(enceinte && { enceinte }) })
    else orders.push({ action: 'pose', structure, tx, ty, edges: bit, material: 'wood', ...(enceinte && { enceinte }) })
  }
  const wantFloor = (tx: number, ty: number): void => {
    if (!poseFeasible(tx, ty, 'floor')) return
    if (floorAt(state.structures, tx, ty)) return
    orders.push({ action: 'pose', structure: 'floor', tx, ty })
  }
  /**
   * LE TOIT (décision d'Alexis, 2026-08-20 : « les PNJ mettent un toit et un sol à leurs
   * maisons »). Il MANQUAIT, purement et simplement : le plan commandait le sol, les murs
   * d'arête et la porte, et jamais la couverture — les villages PNJ bâtissaient des logis à
   * ciel ouvert, ce qui s'est vu sur une photo d'accueil avant de se voir en jeu.
   *
   * Aucun type à ajouter : `roof` est déjà une pièce posée au marteau, donc déjà un
   * `BarrierType` par dérivation du registre (`pieces.ts`). C'est exactement ce que le
   * catalogue promet — « ajouter une pièce = compléter le registre, pas toucher quinze
   * fichiers » —, et ici on ne fait même pas ça : on demande une pièce qui existait.
   */
  const wantRoof = (tx: number, ty: number): void => {
    if (!poseFeasible(tx, ty, 'roof')) return
    if (roofAt(state.structures, tx, ty)) return
    orders.push({ action: 'pose', structure: 'roof', tx, ty })
  }

  // ── L'ENCEINTE D'ABORD (spec R15, décision d'Alexis 2026-08-17 « fais tout ») : la
  //    PALISSADE dérivée du disque, percée de la porte charretière (décision 2026-08-01 :
  //    l'enceinte n'est pas un mur de bâtiment). Elle passait APRÈS les logis — et la
  //    sonde de siège a montré qu'aucun village n'avait JAMAIS fermé son anneau de son
  //    vivant : les cendreux passaient entre les maisons. On s'abrite avant de se loger ;
  //    en attendant les chambres, on dort sur sa paillasse à la belle étoile — derrière
  //    la palissade. ──
  const r = VILLAGE_GROWTH.ENCEINTE_RADIUS
  const disk = (dx: number, dy: number): boolean => Math.max(Math.abs(dx), Math.abs(dy)) <= r
  const gate = (ex: number, ey: number): boolean => ey === r + 1 && (ex === 0 || ex === 1)
  const enceinte = contourEdges(disk, -r, r)
  for (const [ex, ey, bit] of enceinte) {
    if (gate(ex, ey)) continue // les vantaux se posent en dernier : l'anneau d'abord
    wantEdge(fx + ex, fy + ey, bit, 'palissade', true)
  }
  for (const [ex, ey, bit] of enceinte) {
    // Les vantaux PORTENT le drapeau eux aussi : à la cadence lente, la porte traînait
    // 14 minutes réelles derrière son anneau fermé — une brèche fixe de 2 tuiles (revue).
    if (gate(ex, ey)) wantEdge(fx + ex, fy + ey, bit, 'door', true)
  }

  // ══ ON DÉFRICHE TOUTE LA COUR (décision d'Alexis, 2026-08-20) ══
  //
  // « Les PNJ coupent tout arbre, buisson, fleur, etc. à l'intérieur de l'enceinte. » Pas
  // seulement l'emprise des logis : TOUT ce que la palissade enferme. C'est cohérent avec la
  // doctrine du défrichement (« rien ne repousse dans l'emprise d'un village », 2026-08-06),
  // et ça dégage la ligne de vue de la milice — un anneau fermé dont on ne voit pas le pied
  // ne défend rien.
  //
  // APRÈS L'ANNEAU, AVANT LES LOGIS. On s'abrite d'abord (R15) ; puis on nettoie le sol sur
  // lequel on va vivre ; puis on bâtit. Et comme les logis tiennent tous dans le carré de
  // l'enceinte, cette passe couvre AUSSI leur intérieur : un logis ne peut plus se refermer
  // sur un arbre vivant, sans qu'il ait fallu une règle par bâtiment.
  //
  // ═══ ON ITÈRE LES NŒUDS, PAS LES TUILES — et ce n'est pas un détail de style ═══
  //
  // `poseLibre` balaie TOUT `state.nodes` à chaque appel, et une carte de production en porte
  // ~140 000. Poser la question tuile par tuile sur le carré de l'enceinte (17 × 17 = 289)
  // ferait 40 MILLIONS d'accès par rafraîchissement de tableau, toutes les 100 ticks et pour
  // chaque village. On retourne donc la boucle : UNE passe sur les nœuds, un test de bornes
  // par nœud. C'est 289 fois moins cher — et même moins cher que la version « par logis »
  // qui l'a précédée (48 tuiles), qui payait déjà ce prix-là sans qu'on le remarque.
  //
  // TRIÉ par (ty, tx) : le chantier avance du nord au sud plutôt qu'au gré de l'ordre du
  // tableau des nœuds, et l'ordre des ordres reste stable d'un run à l'autre.
  const aDefricher: { tx: number; ty: number }[] = []
  for (const n of state.nodes) {
    if (Math.max(Math.abs(n.tx - fx), Math.abs(n.ty - fy)) > r) continue
    if (!onMap(n.tx, n.ty)) continue
    if (noeudDefriche(state.villages, n)) continue // déjà une souche : rien à couper
    // ON NE DÉFRICHE PAS L'EAU (spec peche.md) : un coin de pêche dans la cour ne se coupe pas,
    // et le PNJ ne sait pas pêcher — l'ordre serait refusé à chaque tick et, comme une seule
    // corvée `build` existe à la fois, TOUT le chantier s'arrêterait (5 929 refus mesurés en
    // 6 000 ticks, relecture déterminisme 2026-08-22).
    if (NODE_DEFS[n.type].tool === 'rod') continue
    aDefricher.push({ tx: n.tx, ty: n.ty })
  }
  aDefricher.sort((a, b) => a.ty - b.ty || a.tx - b.tx)
  for (const { tx, ty } of aDefricher) orders.push({ action: 'defriche', tx, ty })

  // ── Les logis : autour de chaque paillasse posée (le lit devient une chambre). ──
  const hutRegion = (dx: number, dy: number): boolean => dx >= 0 && dx < HUT_W && dy >= 0 && dy < HUT_W
  const hutEdges = contourEdges(hutRegion, -1, HUT_W)
  for (const spot of HUT_SPOTS) {
    const [ax, ay] = bedAnchor(fx, fy, spot)
    const bed = state.structures.find((s) => s.type === 'paillasse' && s.tx === ax && s.ty === ay)
    if (!bed) continue
    const x0 = fx + spot[0]
    const y0 = fy + spot[1]
    for (let dy = 0; dy < HUT_W; dy++) for (let dx = 0; dx < HUT_W; dx++) wantFloor(x0 + dx, y0 + dy)
    const [px, py, pbit] = hutDoor(spot)
    for (const [ex, ey, bit] of hutEdges) {
      // La porte du logis regarde le Feu. Une vraie porte — le PNJ ouvre la sienne,
      // la horde doit la casser, et le rituel de l'aube l'ouvre au monde.
      const isDoor = spot[0] + ex === px && spot[1] + ey === py && bit === pbit
      wantEdge(x0 + ex, y0 + ey, bit, isDoor ? 'door' : 'wall')
    }
    // LE TOIT EN DERNIER, comme sur un vrai chantier : on ne couvre pas des murs qui ne sont
    // pas debout. L'ordre de la liste EST l'ordre du chantier (le tableau sert le premier
    // ordre encore ouvert), donc cette place n'est pas cosmétique — elle empêche un village
    // à moitié bâti de se retrouver avec une toiture posée sur trois murs.
    for (let dy = 0; dy < HUT_W; dy++) for (let dx = 0; dx < HUT_W; dx++) wantRoof(x0 + dx, y0 + dy)
  }

  if (tier < 3) return orders

  // ── Le bourg : les stations (assemblées au Feu, posées), puis LA PIERRE DES LOGIS
  //    (« tout en pierre » visait les bâtiments — la palissade reste du bois, c'est
  //    son essence ; un logis de pierre dans sa palissade lit très bien). ──
  for (const [sx, sy, component] of STATION_SPOTS) {
    const tx = fx + sx
    const ty = fy + sy
    if (!poseFeasible(tx, ty, component)) continue
    const occupant = fullTileAt(state.structures, tx, ty)
    if (occupant) continue // à nous (posée) ou pris par autre chose : dans les deux cas, acquis
    if (!poseLibre(state.villages, state.nodes, tx, ty)) continue // un buisson a poussé là
    orders.push({ action: 'place', component, tx, ty })
  }
  // Chaque mur et porte de LOGIS encore en bois monte en pierre. La porte charretière
  // de la palissade, elle, reste du bois — on ne maçonne pas un vantail de rondins.
  for (const s of state.structures) {
    if (s.villageId !== village.id || s.edges === undefined) continue
    if (s.type !== 'wall' && s.type !== 'door') continue
    if (Math.max(Math.abs(s.tx - fx), Math.abs(s.ty - fy)) > r) continue // la porte de l'anneau
    if ((s.material ?? 'wood') === 'wood') orders.push({ action: 'upgrade', structureId: s.id })
  }
  return orders
}

/** Le premier LIT libre (l'ancre d'un logis sans paillasse) — pour le colon qui arrive. */
export function freeBedSpot(state: SimState, village: Village): { tx: number; ty: number } | null {
  for (const spot of HUT_SPOTS) {
    const [tx, ty] = bedAnchor(village.fireTx, village.fireTy, spot)
    if (tx < 0 || ty < 0 || tx >= state.map.width || ty >= state.map.height) continue
    if (!terrainConstructible(terrainAt(state.map, tx, ty), 'paillasse')) continue
    if (fullTileAt(state.structures, tx, ty)) continue
    if (!poseLibre(state.villages, state.nodes, tx, ty)) continue
    return { tx, ty }
  }
  return null
}
