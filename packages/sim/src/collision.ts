/**
 * Collisions AABB contre la grille de décor (spec monde R9-R12).
 *
 * Résolution par axe (X puis Y) avec clamp flush contre l'obstacle : on
 * glisse le long des murs. Arithmétique + - * / uniquement (déterminisme
 * inter-moteurs). Pas de moteur physique, pas de résolution itérative.
 *
 * Sémantique d'occupation : une AABB [min, max) occupe une tuile si elle la
 * recouvre strictement — être flush contre un mur (max = bord de tuile)
 * n'est pas un recouvrement. EPS absorbe le bruit flottant.
 *
 * Deux familles de requêtes, et la frontière est nette : les requêtes TUILE
 * (`isBlockedAt`, `makeIndexedIsBlockedAt` — pathfinding, IA, spawns) répondent
 * « cette tuile porte-t-elle un obstacle ? » ; les requêtes SOUS-TUILE (le
 * déplacement, `overlapsBlocking`) répondent « ce point est-il dans un
 * obstacle ? ». Un arbre bloque sa tuile pour l'A* et son seul tronc pour l'avatar.
 */
import { BALANCE, NODE_DEFS, TERRAINS, TICK_DT_S } from './balance'
import { nodeAt, treeJitter, type ResourceNode } from './economy'
import { EDGE_E, EDGE_N, EDGE_O, EDGE_S } from './geometry'
import { isBlockingTile, terrainAt, type WorldMap } from './map'
import { structureBlocks, type Structure } from './village'

const EPS = 1e-6
/** Les DEUX demi-mesures de la hitbox : elle est rectangulaire (16 × 8 px, décision d'Alexis).
 *  `HALF_X` borne le déplacement est-ouest et l'étendue verticale du balayage ; `HALF_Y` fait
 *  l'inverse. Les confondre, c'est rendre un corps carré — ce qu'il n'est plus. */
const HALF_X = BALANCE.AVATAR_HITBOX_TILES / 2
const HALF_Y = BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2

/* ── Le cœur travaille en SOUS-TUILES ───────────────────────────────────────
 *
 * Un obstacle n'occupe plus forcément sa tuile entière : un tronc d'arbre est un
 * carré de 2 sous-tuiles centré dans la sienne. La géométrie se déduit de la
 * tuile et d'un entier (`NodeDef.blockHalfSub`) — aucune AABB stockée, rien de
 * neuf dans `SimState`.
 *
 * DÉTERMINISME (invariant 2). `SUB` est une puissance de deux, donc multiplier
 * et diviser par lui est exact en binaire, et l'arrondi commute avec la mise à
 * l'échelle : `fl(8a − 8b) = 8·fl(a − b)`. Le résultat est donc identique AU BIT
 * PRÈS à l'ancienne collision en tuiles pleines pour tout obstacle `h = 4`.
 * `EPS_SUB = EPS × SUB` (et non `EPS`) : c'est ce qui rend les seuils de
 * `Math.floor` équivalents à l'échelle près, et non huit fois plus serrés.
 */
const SUB = BALANCE.SUBTILES_PER_TILE
const HALF_X_SUB = HALF_X * SUB
const HALF_Y_SUB = HALF_Y * SUB
const EPS_SUB = EPS * SUB

/**
 * Le monde vu par un déplaceur donné : le décor, les structures, et QUI
 * se déplace — une porte est passante pour les membres de son village
 * (spec village R8), donc la collision dépend du déplaceur.
 */
export interface MoveWorld {
  map: WorldMap
  structures?: Structure[]
  /** Les nœuds vivants de type bloquant (arbre, roche, filon) sont des obstacles. */
  nodes?: ResourceNode[]
  moverVillageId?: number | null
  /**
   * CE DÉPLACEUR ACTIONNE-T-IL LES PORTES DE SON VILLAGE ? (spec construction R26)
   *
   * Absent = non, et c'est le cas du JOUEUR : depuis que la porte a un état, il la pousse
   * lui-même (touche d'interaction) — c'est tout l'objet de la fonctionnalité. Les PNJ du
   * village, eux, l'ont : sans quoi une porte close les enfermerait chez eux, et leurs corvées
   * s'arrêteraient sans que rien ne le dise (`npc.ts`, `moveWorldFor`).
   */
  opensDoors?: boolean
}

/**
 * LES ARÊTES D'UN MUR MINCE — les quatre bits, et le sous-domaine que chacun bloque.
 *
 * Un mur qui déclare des `edges` n'occupe plus sa tuile : il occupe une bande de
 * `WALL_EDGE_SUB` sous-tuiles **À CHEVAL SUR L'ARÊTE** — moitié chez lui, moitié chez le voisin
 * (décision d'Alexis, 2026-07-27 : « un mur sur une arête doit prendre autant sur une tuile que
 * sur l'autre »). Une arête est une LIMITE, pas une bordure intérieure : la coller d'un seul
 * côté mettait toute la maçonnerie dans la tuile du dehors, et le mur ne tombait pas là où
 * l'œil le place — sur le trait.
 *
 * CE QUE ÇA COÛTE AU DEDANS : la tuile de la salle qui borde le mur perd `WALL_EDGE_SUB/2`
 * sous-tuiles. Elle reste praticable en son centre (il lui en reste `SUB − WALL_EDGE_SUB/2`),
 * mais elle n'est plus ENTIÈRE — c'est le prix du trait, et il se paie des deux côtés.
 */
/** La demi-épaisseur : ce qu'une arête prend DE CHAQUE CÔTÉ de la limite qu'elle occupe. */
const WALL_HALF = BALANCE.WALL_EDGE_SUB / 2

/** La SOUS-TUILE (sx,sy) tombe-t-elle sur une des arêtes déclarées de la tuile (tx,ty) ? */
function onDeclaredEdge(edges: number, sx: number, sy: number, tx: number, ty: number): boolean {
  const lx = sx - tx * SUB // position dans la tuile, en sous-tuiles [0, SUB)
  const ly = sy - ty * SUB
  if (edges & EDGE_N && ly < WALL_HALF) return true
  if (edges & EDGE_S && ly >= SUB - WALL_HALF) return true
  if (edges & EDGE_O && lx < WALL_HALF) return true
  if (edges & EDGE_E && lx >= SUB - WALL_HALF) return true
  return false
}

/**
 * LA MOITIÉ QUI DÉBORDE CHEZ LE VOISIN — l'autre moitié de la même bande.
 *
 * Sans elle, le mur à cheval ne bloquerait plus que la moitié de son épaisseur : la tuile
 * voisine ne regarde que SA structure, et celle du mur est à côté. On ne consulte le voisin que
 * si la sous-tuile est effectivement au ras de la limite — au plus deux balayages de plus, et
 * seulement pour les sous-tuiles de bord.
 */
function edgeDeborde(world: MoveWorld, tx: number, ty: number, bit: number): boolean {
  const mover = world.moverVillageId ?? null
  const portes = world.opensDoors ?? false
  for (const s of world.structures ?? []) {
    // On BALAIE, on ne prend pas « le premier solide » : la tuile d'en face porte presque
    // toujours un sol de cour EN PLUS de son mur, et c'est ce raccourci qui laissait passer.
    if (s.tx !== tx || s.ty !== ty || s.edges === undefined) continue
    if ((s.edges & bit) !== 0 && structureBlocks(s, mover, portes)) return true
  }
  return false
}

/** Une tuile est-elle bloquante pour ce déplaceur ? (terrain + structures + nœuds) */
export function isBlockedAt(world: MoveWorld, tx: number, ty: number): boolean {
  return blockedAt(world, tx, ty)
}

/**
 * LE BLOQUANT D'UNE TUILE — et surtout PAS « la première structure qui n'est ni sol ni toit ».
 *
 * `solidAt` écarte `floor` et `roof`, et c'était suffisant tant qu'une tuile ne portait que ça
 * de mou. Depuis les lieux bâtis, une même tuile porte la TERRE BATTUE de la cour ET le mur qui
 * la borde — et la terre, posée d'abord, était rendue la première. Le mur n'était alors jamais
 * consulté : **on traversait le mur du sud d'une ferme** (constaté par Alexis le 2026-07-27,
 * reproduit headless). Le symptôme aurait grandi avec chaque nouvelle pièce molle (friche,
 * parcelle…), et la garde du cache d'occupation annonçait déjà exactement ce piège.
 *
 * On ne cherche donc plus « le solide », on cherche **ce qui BLOQUE ce marcheur** — la seule
 * question que la collision se pose vraiment.
 */
function bloquantAt(world: MoveWorld, tx: number, ty: number, pleineTuile: boolean): Structure | undefined {
  const mover = world.moverVillageId ?? null
  const portes = world.opensDoors ?? false
  for (const s of world.structures ?? []) {
    if (s.tx !== tx || s.ty !== ty) continue
    if (pleineTuile && s.edges !== undefined) continue
    if (structureBlocks(s, mover, portes)) return s
  }
  return undefined
}

function blockedAt(world: MoveWorld, tx: number, ty: number): boolean {
  if (isBlockingTile(world.map, tx, ty)) return true
  if (world.structures) {
    // UN MUR SUR ARÊTE NE BLOQUE PAS SA TUILE : on s'y tient, on la traverse même — ce qui est
    // bloqué, c'est le FRANCHISSEMENT de l'arête, et cela ne se décide qu'en sous-tuile. À
    // l'échelle de la tuile, la réponse honnête est « libre » ; répondre « bloquée » ferait
    // fuir la faune d'une salle parfaitement praticable.
    if (bloquantAt(world, tx, ty, true) !== undefined) return true
  }
  if (world.nodes) {
    const n = nodeAt(world.nodes, tx, ty)
    if (n !== undefined && n.stock > 0 && NODE_DEFS[n.type].blockHalfSub > 0) return true
  }
  return false
}

/**
 * Version indexée de `isBlockedAt` pour les gros consommateurs (A*, flow
 * fields) : `structureAt` et `nodeAt` sont des `find` O(S)/O(N) PAR TUILE,
 * or un `findPath` ou un `computeFlowField` interroge des milliers de
 * tuiles. On matérialise UNE FOIS l'occupation par tuile (clé ty*width+tx,
 * premier occupant du tableau — même sémantique que `find`), puis chaque
 * requête est O(1) avec strictement les mêmes règles que `blockedAt`.
 * Dérivé local pur, même statut que le flow cache des hordes : construit et
 * jeté dans l'appel, jamais dans SimState. Hors bornes de la carte, on
 * retombe sur `blockedAt` (pas d'aliasing de clé possible).
 */
type Occupant = { structure?: Structure; node?: ResourceNode }

/**
 * ═══ LE CACHE D'OCCUPATION — mesuré, puis corrigé ═══
 *
 * L'index était reconstruit à CHAQUE appel : or `findPath` en fait un par recherche de chemin,
 * et chaque PNJ, monstre ou bête en demande. Profilé (`tools/profil-tick.mts`) sur une vallée
 * de 0,6 M de tuiles et 16 137 nœuds : `findPath` 28,9 % du tick, la collision 18,5 %, et le
 * ramasse-miettes 12,8 % — l'allocation d'une Map de milliers d'entrées, plusieurs fois par
 * tick, se payait deux fois (à la construction ET au nettoyage). Verdict global : **25,5 ms
 * par tick, soit 51 % du budget 20 Hz, sur une carte SIX FOIS plus petite que la production.**
 *
 * On mémoïse donc l'occupation, et c'est SÛR pour une raison précise : la table ne stocke que
 * des RÉFÉRENCES. Le stock d'un nœud, les PV ou le propriétaire d'une structure sont relus à
 * chaque requête sur l'objet vivant — les muter en place reste donc parfaitement visible. Seuls
 * un AJOUT ou un RETRAIT changent la table, et l'un comme l'autre change l'identité du tableau
 * (`filter`) ou sa longueur (`push`) : c'est exactement ce qu'on valide.
 *
 * Le `moverVillageId`, lui, ne participe PAS à l'occupation (il n'intervient qu'au moment de
 * juger si une structure bloque CE marcheur) : la table est donc partagée entre marcheurs, et
 * seule la petite fermeture de requête est refaite. Déterminisme intact : même entrées, même
 * table, même réponses — un mémo ne change aucun résultat.
 */
const OCCUPANCY_CACHE = new WeakMap<
  object,
  { structures: unknown; structuresLen: number; nodes: unknown; nodesLen: number; occupancy: Map<number, Occupant> }
>()

function occupancyOf(world: MoveWorld): Map<number, Occupant> {
  const { width, height } = world.map
  const structures = world.structures
  const nodes = world.nodes
  const cached = OCCUPANCY_CACHE.get(world.map as object)
  if (
    cached !== undefined &&
    cached.structures === structures &&
    cached.structuresLen === (structures?.length ?? -1) &&
    cached.nodes === nodes &&
    cached.nodesLen === (nodes?.length ?? -1)
  ) {
    return cached.occupancy
  }

  const occupancy = new Map<number, Occupant>()
  const entryAt = (tx: number, ty: number): Occupant => {
    const key = ty * width + tx
    let entry = occupancy.get(key)
    if (!entry) {
      entry = {}
      occupancy.set(key, entry)
    }
    return entry
  }
  if (world.structures) {
    for (const s of world.structures) {
      if (s.tx < 0 || s.ty < 0 || s.tx >= width || s.ty >= height) continue
      // On n'indexe QUE CE QUI PEUT BLOQUER, jamais une pièce molle : sinon une pièce posée
      // AVANT un mur sur la même tuile masque le mur, et le pathfinding traverse la paroi.
      // La garde disait « ni sol ni toit » — trop étroit : la TERRE BATTUE d'une cour, la
      // friche, une parcelle partagent aussi leur tuile avec un mur, et masquaient le mur
      // (bug constaté et corrigé le 2026-07-27, cf. `bloquantAt`). On teste donc ce qui
      // bloque un ÉTRANGER (`null`) : c'est la seule propriété indépendante du marcheur, et
      // le cache est partagé entre marcheurs. Le porteur du village est retesté à la requête.
      // Le cache d'occupation sert le PATHFINDING, qui interroge ensuite par déplaceur : on
      // indexe donc large — ce qui bloque QUELQU'UN — et `makeIndexedIsBlockedAt` tranche après.
      // Une porte close y entre à ce titre, et c'est bien : elle bloque le joueur et les monstres.
      if (!structureBlocks(s, null, false)) continue
      const entry = entryAt(s.tx, s.ty)
      if (entry.structure === undefined) entry.structure = s
    }
  }
  if (world.nodes) {
    for (const n of world.nodes) {
      if (n.tx < 0 || n.ty < 0 || n.tx >= width || n.ty >= height) continue
      const entry = entryAt(n.tx, n.ty)
      if (entry.node === undefined) entry.node = n
    }
  }
  OCCUPANCY_CACHE.set(world.map as object, {
    structures,
    structuresLen: structures?.length ?? -1,
    nodes,
    nodesLen: nodes?.length ?? -1,
    occupancy,
  })
  return occupancy
}

export function makeIndexedIsBlockedAt(world: MoveWorld): (tx: number, ty: number) => boolean {
  const { width, height } = world.map
  const occupancy = occupancyOf(world)
  const moverVillageId = world.moverVillageId ?? null
  const portes = world.opensDoors ?? false
  return (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return blockedAt(world, tx, ty)
    if (isBlockingTile(world.map, tx, ty)) return true
    const entry = occupancy.get(ty * width + tx)
    if (entry === undefined) return false
    if (entry.structure !== undefined && structureBlocks(entry.structure, moverVillageId, portes)) return true
    if (entry.node !== undefined && entry.node.stock > 0 && NODE_DEFS[entry.node.type].blockHalfSub > 0) return true
    return false
  }
}

/**
 * Une SOUS-TUILE est-elle bloquante ? Le terrain bloque sa tuile entière ; une structure
 * aussi, SAUF si elle déclare des `edges` — elle ne prend alors que des bandes de bord ; un
 * nœud ne bloque que le carré `[c−h, c+h)` autour du centre `c` de sa tuile, où
 * `h = blockHalfSub`. Pour `h = 4` on retrouve exactement la tuile.
 */
function blockedSubAt(world: MoveWorld, sx: number, sy: number): boolean {
  const tx = Math.floor(sx / SUB)
  const ty = Math.floor(sy / SUB)
  if (isBlockingTile(world.map, tx, ty)) return true
  if (world.structures) {
    const s = bloquantAt(world, tx, ty, false)
    if (s !== undefined) {
      // Sans `edges`, la structure prend sa tuile entière (comportement historique) ; avec,
      // elle ne prend que les bandes déclarées — et le reste de la tuile reste praticable.
      if (s.edges === undefined) return true
      if (onDeclaredEdge(s.edges, sx, sy, tx, ty)) return true
    }
    // L'AUTRE MOITIÉ : une arête déclarée par la tuile d'en face déborde ici d'autant.
    const lx = sx - tx * SUB
    const ly = sy - ty * SUB
    if (ly < WALL_HALF && edgeDeborde(world, tx, ty - 1, EDGE_S)) return true
    if (ly >= SUB - WALL_HALF && edgeDeborde(world, tx, ty + 1, EDGE_N)) return true
    if (lx < WALL_HALF && edgeDeborde(world, tx - 1, ty, EDGE_E)) return true
    if (lx >= SUB - WALL_HALF && edgeDeborde(world, tx + 1, ty, EDGE_O)) return true
  }
  if (world.nodes) {
    const n = nodeAt(world.nodes, tx, ty)
    if (n !== undefined && n.stock > 0) {
      const h = NODE_DEFS[n.type].blockHalfSub
      if (h > 0) {
        // Un arbre est décalé dans sa tuile (spec décalage d'origine) ; les
        // autres nœuds restent centrés. La borne J + h/SUB ≤ 0,5 garantit que le
        // carré décalé reste dans la tuile, donc regarder le seul nœud d'ici suffit.
        let cx = tx * SUB + SUB / 2
        let cy = ty * SUB + SUB / 2
        if (n.type === 'tree') {
          const { dx, dy } = treeJitter(tx, ty)
          cx += dx * SUB
          cy += dy * SUB
        }
        if (sx >= cx - h && sx < cx + h && sy >= cy - h && sy < cy + h) return true
      }
    }
  }
  return false
}

/**
 * ═══ LA LIGNE DÉGAGÉE — CE QUI BLOQUE LE PAS BLOQUE LE TRAIT (spec `tir.md` T5) ═══
 *
 * Le trait d'un arc exige un chemin libre entre le tireur et sa cible. La question est
 * exactement celle que la collision se pose déjà, et c'est pourquoi elle passe par
 * `blockedSubAt` plutôt que par une nouvelle notion d'obstacle : un mur MINCE n'existe
 * qu'à la résolution SOUS-TUILE (une bande de `WALL_EDGE_SUB/2` de part et d'autre de
 * l'arête). Interroger `isBlockedAt` tuile par tuile aurait laissé passer les flèches à
 * travers toute enceinte de murs d'arête — le piège même que `crossingBlocker` a dû
 * réparer pour les bêtes, et que « le premier solide » a déjà tendu une fois ici.
 *
 * BALAYAGE EXACT, PAS ÉCHANTILLONNAGE : un DDA de grille (Amanatides & Woo) visite
 * TOUTES les sous-tuiles que le segment traverse, donc rien ne se faufile entre deux
 * points de mesure. Le nombre de pas vaut exactement la distance de Manhattan en
 * sous-tuiles — 176 au pire pour la portée de l'arc long. Tout est en `+ − × ÷`,
 * `abs` et `floor` : aucune trigonométrie (invariant §2).
 *
 * DEUX SOUS-TUILES SONT EXEMPTÉES, aux deux bouts :
 *   · celle du TIREUR — un archer collé à son mur tire quand même ;
 *   · celle de la CIBLE — si un corps s'y tient, ce n'est pas l'obstacle qui la couvre.
 *     Sans cette exemption, une bête chevauchant le carré bloquant d'un arbre rendrait
 *     le tir muet, et l'on chercherait le défaut dans la visée.
 *
 * Le monde est interrogé SANS village ni clé (`moverVillageId: null`, `opensDoors: false`) :
 * une flèche n'appartient à personne et n'ouvre aucune porte. Une porte CLOSE l'arrête,
 * la même porte OUVERTE la laisse passer.
 */
export interface Trait {
  /** Le chemin était-il libre de bout en bout ? */
  degage: boolean
  /** Où le trait s'arrête : la cible si dégagé, sinon juste devant l'obstacle. */
  x: number
  y: number
}

/**
 * Le trait, ET OÙ IL S'ARRÊTE — la méthode est dans l'en-tête ci-dessus.
 *
 * Rendre le point d'arrêt, et pas seulement un booléen, est ce qui permet à la flèche
 * de RETOMBER quelque part de ramassable (spec T6) : au pied du mur qu'elle a frappé,
 * pas dans le mur. Le point est reculé d'une demi-sous-tuile en deçà de la frontière
 * franchie — la sous-tuile d'avant a été vérifiée libre, donc ce point l'est aussi.
 */
export function traitLibre(world: MoveWorld, x0: number, y0: number, x1: number, y1: number): Trait {
  const INF = Number.POSITIVE_INFINITY
  const ax = x0 * SUB
  const ay = y0 * SUB
  const bx = x1 * SUB
  const by = y1 * SUB
  let sx = Math.floor(ax)
  let sy = Math.floor(ay)
  const sxEnd = Math.floor(bx)
  const syEnd = Math.floor(by)
  const dx = bx - ax
  const dy = by - ay
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const dtX = stepX === 0 ? INF : Math.abs(1 / dx)
  const dtY = stepY === 0 ? INF : Math.abs(1 / dy)
  let tX = stepX === 0 ? INF : (stepX > 0 ? sx + 1 - ax : sx - ax) / dx
  let tY = stepY === 0 ? INF : (stepY > 0 ? sy + 1 - ay : sy - ay) / dy
  const pas = Math.abs(sxEnd - sx) + Math.abs(syEnd - sy)
  // La longueur du segment en sous-tuiles : ce qui convertit un recul en tuiles.
  const long = Math.sqrt(dx * dx + dy * dy)
  for (let i = 0; i < pas; i++) {
    // `t` PARAMÈTRE le segment (0 au tireur, 1 à la cible) : c'est la frontière qu'on
    // s'apprête à franchir, donc le point d'arrêt si ce qui est derrière bloque.
    const t = tX < tY ? tX : tY
    if (tX < tY) {
      sx += stepX
      tX += dtX
    } else {
      sy += stepY
      tY += dtY
    }
    if (sx === sxEnd && sy === syEnd) break // la sous-tuile de la cible : exemptée
    if (blockedSubAt(world, sx, sy)) {
      const recul = long > 0 ? Math.max(0, t - 0.5 / long) : 0
      return { degage: false, x: x0 + (x1 - x0) * recul, y: y0 + (y1 - y0) * recul }
    }
  }
  return { degage: true, x: x1, y: y1 }
}

/** Le chemin est-il libre ? — `traitLibre` sans son point d'arrêt (UNE seule marche). */
export function ligneDegagee(world: MoveWorld, x0: number, y0: number, x1: number, y1: number): boolean {
  return traitLibre(world, x0, y0, x1, y1).degage
}

/** Plage de SOUS-TUILES recouvertes par l'intervalle [min, max) donné en sous-tuiles. */
function subSpan(min: number, max: number): [number, number] {
  return [Math.floor(min + EPS_SUB), Math.floor(max - EPS_SUB)]
}

/** Une colonne (horizontal) ou ligne (vertical) de SOUS-TUILES contient-elle un obstacle ? */
function lineBlockedSub(
  world: MoveWorld,
  fixedSub: number,
  crossMinSub: number,
  crossMaxSub: number,
  horizontal: boolean,
): boolean {
  const [c0, c1] = subSpan(crossMinSub, crossMaxSub)
  for (let c = c0; c <= c1; c++) {
    const blocked = horizontal ? blockedSubAt(world, fixedSub, c) : blockedSubAt(world, c, fixedSub)
    if (blocked) return true
  }
  return false
}

/**
 * Déplace `pos` de `delta` sur un axe, clampé flush contre le premier obstacle
 * rencontré. Tout se calcule en SOUS-TUILES ; on ne divise qu'une fois, en
 * sortie — c'est ce qui préserve l'exactitude au bit près (cf. en-tête).
 * `crossMin/crossMax` : étendue de l'AABB sur l'autre axe, en tuiles.
 */
function moveAxis(
  world: MoveWorld,
  pos: number,
  delta: number,
  crossMin: number,
  crossMax: number,
  horizontal: boolean,
): number {
  if (delta === 0) return pos
  // La demi-mesure de l'axe SUR LEQUEL ON AVANCE — c'est elle qui décide où le corps bute.
  const HALF_SUB = horizontal ? HALF_X_SUB : HALF_Y_SUB
  const target = pos + delta
  const posSub = pos * SUB
  const targetSub = target * SUB
  const crossMinSub = crossMin * SUB
  const crossMaxSub = crossMax * SUB
  if (delta > 0) {
    const firstNew = Math.floor(posSub + HALF_SUB - EPS_SUB) + 1
    const lastNew = Math.floor(targetSub + HALF_SUB - EPS_SUB)
    for (let s = firstNew; s <= lastNew; s++) {
      if (lineBlockedSub(world, s, crossMinSub, crossMaxSub, horizontal)) return (s - HALF_SUB) / SUB
    }
  } else {
    const firstNew = Math.floor(posSub - HALF_SUB + EPS_SUB) - 1
    const lastNew = Math.floor(targetSub - HALF_SUB + EPS_SUB)
    for (let s = firstNew; s >= lastNew; s--) {
      if (lineBlockedSub(world, s, crossMinSub, crossMaxSub, horizontal)) return (s + 1 + HALF_SUB) / SUB
    }
  }
  return target
}

/** Déplace une position par (dx, dy) en résolvant les collisions. Retourne la position finale. */
export function resolveMove(
  world: MoveWorld,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const nx = moveAxis(world, x, dx, y - HALF_Y, y + HALF_Y, true)
  const ny = moveAxis(world, y, dy, nx - HALF_X, nx + HALF_X, false)
  return { x: nx, y: ny }
}

/**
 * Déplacement d'avatar complet : vitesse de BALANCE modulée par le terrain
 * sous le centre, normalisation diagonale, collisions. Partagé entre le tick
 * serveur (`step`, dt fixe) et la prédiction locale du client (dt de frame) —
 * la parité prédiction/autorité est garantie par construction.
 */
export function moveAvatar(
  world: MoveWorld,
  x: number,
  y: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
  dtS: number,
  /** Modulateur externe (faim à 0 → HUNGER_SPEED_MALUS). Partagé avec la prédiction client. */
  speedScale = 1,
): { x: number; y: number } {
  if (dx === 0 && dy === 0) return { x, y }
  const terrain = TERRAINS[terrainAt(world.map, Math.floor(x), Math.floor(y))]
  const factor = terrain?.walkable ? terrain.speedFactor : 1
  const speed = BALANCE.WALK_SPEED_TILES_PER_S * dtS * factor * speedScale
  const norm = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1
  return resolveMove(world, x, y, dx * speed * norm, dy * speed * norm)
}

/**
 * Prédiction locale à pas fixe (parité avec l'autorité). Le serveur intègre un
 * `moveAvatar` par tick à `TICK_DT_S` ; le client, lui, tourne au dt de la frame
 * (variable, gros lors d'un pic). Comme la résolution par axe n'est pas
 * invariante à la taille du pas, un gros pas diverge du serveur contre un mur et
 * le snapshot suivant produit un rollback visible.
 *
 * On accumule le temps de frame et on ne consomme que des sous-pas ENTIERS de
 * `TICK_DT_S` — chacun rejoue exactement un tick serveur (mêmes arguments), donc
 * le résultat est identique au bit près à la suite de ticks correspondante. Le
 * reliquat < `TICK_DT_S` est reporté dans `pendingS` pour la frame suivante.
 * `EPS` sur le seuil absorbe le bruit d'accumulation flottante (un client calé
 * pile sur le tick ne doit pas rater un sous-pas au hasard).
 *
 * `x, y` = l'ANCRE calée sur le tick (à réconcilier avec l'autorité, parité au
 * bit près). `renderX, renderY` = où AFFICHER le sprite : l'ancre extrapolée du
 * reliquat de frame (un pas partiel résolu par collision — donc lissé chaque
 * frame et jamais dans un mur). On DEVANCE de < 1 tick au lieu de retarder :
 * fluide sans latence ajoutée, contrairement à une interpolation prev→courant.
 */
export function moveAvatarStepped(
  world: MoveWorld,
  x: number,
  y: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
  frameDtS: number,
  pendingS: number,
  speedScale = 1,
): { x: number; y: number; pendingS: number; renderX: number; renderY: number } {
  let remaining = pendingS + frameDtS
  let pos = { x, y }
  while (remaining >= TICK_DT_S - EPS) {
    pos = moveAvatar(world, pos.x, pos.y, dx, dy, TICK_DT_S, speedScale)
    remaining -= TICK_DT_S
  }
  const render = moveAvatar(world, pos.x, pos.y, dx, dy, remaining, speedScale)
  return { x: pos.x, y: pos.y, pendingS: remaining, renderX: render.x, renderY: render.y }
}

/**
 * L'AABB d'un avatar centré en (x, y) recouvre-t-elle un obstacle ?
 *
 * SOUS-TUILE-EXACT, et il le FAUT : `collision.test.ts` et `prediction.test.ts`
 * affirment qu'un avatar n'est jamais dans un obstacle. Avec une sémantique
 * tuile, un avatar légalement debout entre deux troncs les ferait échouer à tort.
 */
export function overlapsBlocking(world: MoveWorld, x: number, y: number): boolean {
  const [sx0, sx1] = subSpan((x - HALF_X) * SUB, (x + HALF_X) * SUB)
  const [sy0, sy1] = subSpan((y - HALF_Y) * SUB, (y + HALF_Y) * SUB)
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      if (blockedSubAt(world, sx, sy)) return true
    }
  }
  return false
}
