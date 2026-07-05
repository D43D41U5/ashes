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
import { BALANCE, TERRAINS } from './balance'
import { isBlockingTile, terrainAt, type WorldMap } from './map'

const EPS = 1e-6
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2

/** Plage de tuiles recouvertes par l'intervalle [min, max). */
function tileSpan(min: number, max: number): [number, number] {
  return [Math.floor(min + EPS), Math.floor(max - EPS)]
}

/** Une colonne (horizontal) ou ligne (vertical) de tuiles contient-elle un obstacle ? */
function lineBlocked(
  map: WorldMap,
  fixed: number,
  crossMin: number,
  crossMax: number,
  horizontal: boolean,
): boolean {
  const [c0, c1] = tileSpan(crossMin, crossMax)
  for (let c = c0; c <= c1; c++) {
    const blocked = horizontal ? isBlockingTile(map, fixed, c) : isBlockingTile(map, c, fixed)
    if (blocked) return true
  }
  return false
}

/**
 * Déplace `pos` de `delta` sur un axe, clampé flush contre le premier
 * obstacle rencontré. `crossMin/crossMax` : étendue de l'AABB sur l'autre axe.
 */
function moveAxis(
  map: WorldMap,
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
      if (lineBlocked(map, t, crossMin, crossMax, horizontal)) return t - HALF
    }
  } else {
    const firstNew = Math.floor(pos - HALF + EPS) - 1
    const lastNew = Math.floor(target - HALF + EPS)
    for (let t = firstNew; t >= lastNew; t--) {
      if (lineBlocked(map, t, crossMin, crossMax, horizontal)) return t + 1 + HALF
    }
  }
  return target
}

/** Déplace une position par (dx, dy) en résolvant les collisions. Retourne la position finale. */
export function resolveMove(
  map: WorldMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const nx = moveAxis(map, x, dx, y - HALF, y + HALF, true)
  const ny = moveAxis(map, y, dy, nx - HALF, nx + HALF, false)
  return { x: nx, y: ny }
}

/**
 * Déplacement d'avatar complet : vitesse de BALANCE modulée par le terrain
 * sous le centre, normalisation diagonale, collisions. Partagé entre le tick
 * serveur (`step`, dt fixe) et la prédiction locale du client (dt de frame) —
 * la parité prédiction/autorité est garantie par construction.
 */
export function moveAvatar(
  map: WorldMap,
  x: number,
  y: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
  dtS: number,
): { x: number; y: number } {
  if (dx === 0 && dy === 0) return { x, y }
  const terrain = TERRAINS[terrainAt(map, Math.floor(x), Math.floor(y))]
  const factor = terrain?.walkable ? terrain.speedFactor : 1
  const speed = BALANCE.WALK_SPEED_TILES_PER_S * dtS * factor
  const norm = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1
  return resolveMove(map, x, y, dx * speed * norm, dy * speed * norm)
}

/** L'AABB d'un avatar centré en (x, y) recouvre-t-elle une tuile bloquante ? (outil de test) */
export function overlapsBlocking(map: WorldMap, x: number, y: number): boolean {
  const [tx0, tx1] = tileSpan(x - HALF, x + HALF)
  const [ty0, ty1] = tileSpan(y - HALF, y + HALF)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isBlockingTile(map, tx, ty)) return true
    }
  }
  return false
}
