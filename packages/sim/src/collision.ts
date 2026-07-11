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
import { isBlockingTile, terrainAt, type WorldMap } from './map'
import { structureAt, structureBlocks, type Structure } from './village'

const EPS = 1e-6
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2

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
const HALF_SUB = HALF * SUB
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
}

/** Une tuile est-elle bloquante pour ce déplaceur ? (terrain + structures + nœuds) */
export function isBlockedAt(world: MoveWorld, tx: number, ty: number): boolean {
  return blockedAt(world, tx, ty)
}

function blockedAt(world: MoveWorld, tx: number, ty: number): boolean {
  if (isBlockingTile(world.map, tx, ty)) return true
  if (world.structures) {
    const s = structureAt(world.structures, tx, ty)
    if (s !== undefined && structureBlocks(s, world.moverVillageId ?? null)) return true
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
export function makeIndexedIsBlockedAt(world: MoveWorld): (tx: number, ty: number) => boolean {
  const { width, height } = world.map
  const occupancy = new Map<number, { structure?: Structure; node?: ResourceNode }>()
  const entryAt = (tx: number, ty: number): { structure?: Structure; node?: ResourceNode } => {
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
  const moverVillageId = world.moverVillageId ?? null
  return (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return blockedAt(world, tx, ty)
    if (isBlockingTile(world.map, tx, ty)) return true
    const entry = occupancy.get(ty * width + tx)
    if (entry === undefined) return false
    if (entry.structure !== undefined && structureBlocks(entry.structure, moverVillageId)) return true
    if (entry.node !== undefined && entry.node.stock > 0 && NODE_DEFS[entry.node.type].blockHalfSub > 0) return true
    return false
  }
}

/**
 * Une SOUS-TUILE est-elle bloquante ? Terrain et structures bloquent leur tuile
 * entière ; un nœud ne bloque que le carré `[c−h, c+h)` autour du centre `c` de
 * sa tuile, où `h = blockHalfSub`. Pour `h = 4` on retrouve exactement la tuile.
 */
function blockedSubAt(world: MoveWorld, sx: number, sy: number): boolean {
  const tx = Math.floor(sx / SUB)
  const ty = Math.floor(sy / SUB)
  if (isBlockingTile(world.map, tx, ty)) return true
  if (world.structures) {
    const s = structureAt(world.structures, tx, ty)
    if (s !== undefined && structureBlocks(s, world.moverVillageId ?? null)) return true
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
  const nx = moveAxis(world, x, dx, y - HALF, y + HALF, true)
  const ny = moveAxis(world, y, dy, nx - HALF, nx + HALF, false)
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
  const [sx0, sx1] = subSpan((x - HALF) * SUB, (x + HALF) * SUB)
  const [sy0, sy1] = subSpan((y - HALF) * SUB, (y + HALF) * SUB)
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      if (blockedSubAt(world, sx, sy)) return true
    }
  }
  return false
}
