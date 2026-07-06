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
 */
import { BALANCE, NODE_DEFS, TERRAINS, TICK_DT_S } from './balance'
import { nodeAt, type ResourceNode } from './economy'
import { isBlockingTile, terrainAt, type WorldMap } from './map'
import { structureAt, structureBlocks, type Structure } from './village'

const EPS = 1e-6
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2

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
    if (n !== undefined && n.stock > 0 && NODE_DEFS[n.type].blocks) return true
  }
  return false
}

/** Plage de tuiles recouvertes par l'intervalle [min, max). */
function tileSpan(min: number, max: number): [number, number] {
  return [Math.floor(min + EPS), Math.floor(max - EPS)]
}

/** Une colonne (horizontal) ou ligne (vertical) de tuiles contient-elle un obstacle ? */
function lineBlocked(
  world: MoveWorld,
  fixed: number,
  crossMin: number,
  crossMax: number,
  horizontal: boolean,
): boolean {
  const [c0, c1] = tileSpan(crossMin, crossMax)
  for (let c = c0; c <= c1; c++) {
    const blocked = horizontal ? blockedAt(world, fixed, c) : blockedAt(world, c, fixed)
    if (blocked) return true
  }
  return false
}

/**
 * Déplace `pos` de `delta` sur un axe, clampé flush contre le premier
 * obstacle rencontré. `crossMin/crossMax` : étendue de l'AABB sur l'autre axe.
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
  if (delta > 0) {
    const firstNew = Math.floor(pos + HALF - EPS) + 1
    const lastNew = Math.floor(target + HALF - EPS)
    for (let t = firstNew; t <= lastNew; t++) {
      if (lineBlocked(world, t, crossMin, crossMax, horizontal)) return t - HALF
    }
  } else {
    const firstNew = Math.floor(pos - HALF + EPS) - 1
    const lastNew = Math.floor(target - HALF + EPS)
    for (let t = firstNew; t >= lastNew; t--) {
      if (lineBlocked(world, t, crossMin, crossMax, horizontal)) return t + 1 + HALF
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

/** L'AABB d'un avatar centré en (x, y) recouvre-t-elle une tuile bloquante ? (outil de test) */
export function overlapsBlocking(world: MoveWorld, x: number, y: number): boolean {
  const [tx0, tx1] = tileSpan(x - HALF, x + HALF)
  const [ty0, ty1] = tileSpan(y - HALF, y + HALF)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (blockedAt(world, tx, ty)) return true
    }
  }
  return false
}
