/**
 * A* sur la grille, 4 directions (spec pnj R8) — pour la navigation
 * individuelle des PNJ. Les flow fields des hordes (V7) sont un autre outil.
 *
 * Déterministe : coûts entiers, heuristique Manhattan, départage des égalités
 * par ordre d'insertion. Arithmétique + - * / uniquement.
 */
import { isBlockedAt, makeIndexedIsBlockedAt, type MoveWorld } from './collision'
import type { ResourceNode } from './economy'
import { distSq } from './geometry'
import type { WorldMap } from './map'

interface HeapNode {
  f: number
  order: number
  tx: number
  ty: number
}

/** Tas binaire min sur (f, order) — départage stable. */
class MinHeap {
  private items: HeapNode[] = []

  get size(): number {
    return this.items.length
  }

  push(node: HeapNode): void {
    this.items.push(node)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(this.items[i]!, this.items[parent]!)) break
      ;[this.items[i], this.items[parent]] = [this.items[parent]!, this.items[i]!]
      i = parent
    }
  }

  pop(): HeapNode | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0 && last) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let best = i
        if (l < this.items.length && this.less(this.items[l]!, this.items[best]!)) best = l
        if (r < this.items.length && this.less(this.items[r]!, this.items[best]!)) best = r
        if (best === i) break
        ;[this.items[i], this.items[best]] = [this.items[best]!, this.items[i]!]
        i = best
      }
    }
    return top
  }

  private less(a: HeapNode, b: HeapNode): boolean {
    return a.f < b.f || (a.f === b.f && a.order < b.order)
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/**
 * Chemin de tuiles de `from` vers `to` (exclut le départ, inclut l'arrivée),
 * ou null si inatteignable dans le budget. La tuile d'arrivée doit être libre.
 */
export function findPath(
  world: MoveWorld,
  from: { tx: number; ty: number },
  to: { tx: number; ty: number },
  maxExplored = 4096,
): { tx: number; ty: number }[] | null {
  if (from.tx === to.tx && from.ty === to.ty) return []
  // Index d'occupation bâti une fois : l'A* interroge des milliers de tuiles.
  const isBlocked = makeIndexedIsBlockedAt(world)
  if (isBlocked(to.tx, to.ty)) return null
  const width = world.map.width
  const height = world.map.height
  const inBounds = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < width && ty < height
  if (!inBounds(to.tx, to.ty)) return null

  const key = (tx: number, ty: number): number => ty * width + tx
  const gScore = new Map<number, number>()
  const cameFrom = new Map<number, number>()
  const heap = new MinHeap()
  let order = 0
  const h = (tx: number, ty: number): number => Math.abs(tx - to.tx) + Math.abs(ty - to.ty)

  gScore.set(key(from.tx, from.ty), 0)
  heap.push({ f: h(from.tx, from.ty), order: order++, tx: from.tx, ty: from.ty })
  let explored = 0

  while (heap.size > 0 && explored < maxExplored) {
    const current = heap.pop()!
    explored += 1
    if (current.tx === to.tx && current.ty === to.ty) {
      const path: { tx: number; ty: number }[] = []
      let k = key(current.tx, current.ty)
      const startKey = key(from.tx, from.ty)
      while (k !== startKey) {
        path.push({ tx: k % width, ty: Math.floor(k / width) })
        k = cameFrom.get(k)!
      }
      path.reverse()
      return path
    }
    const g = gScore.get(key(current.tx, current.ty))!
    for (const [dx, dy] of DIRS) {
      const nx = current.tx + dx
      const ny = current.ty + dy
      if (!inBounds(nx, ny) || isBlocked(nx, ny)) continue
      const nk = key(nx, ny)
      const ng = g + 1
      const known = gScore.get(nk)
      if (known !== undefined && known <= ng) continue
      gScore.set(nk, ng)
      cameFrom.set(nk, key(current.tx, current.ty))
      heap.push({ f: ng + h(nx, ny), order: order++, tx: nx, ty: ny })
    }
  }
  return null
}

/**
 * Chemin vers `(tx,ty)` OU, si cette tuile est bloquée (un Feu a un hitbox, un
 * mur…), vers son voisin orthogonal LIBRE le plus proche de `(fromX,fromY)`. On
 * se poste À CÔTÉ de l'obstacle — se chauffer au feu, pas dessus (décision du
 * hitbox du Feu). Départage déterministe par distance au carré (arithmétique
 * exacte). Retourne null si ni la cible ni un voisin n'est atteignable. C'est la
 * primitive partagée du repli PNJ (`setPathTo`) et de la dérive du Cendreux.
 */
export function pathToward(
  world: MoveWorld,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
): { tx: number; ty: number }[] | null {
  const from = { tx: Math.floor(fromX), ty: Math.floor(fromY) }
  const targets = isBlockedAt(world, tx, ty)
    ? ([
        [tx + 1, ty],
        [tx - 1, ty],
        [tx, ty + 1],
        [tx, ty - 1],
      ] as const)
        .filter(([nx, ny]) => !isBlockedAt(world, nx, ny))
        .sort((a, b) => distSq(a[0] + 0.5, a[1] + 0.5, fromX, fromY) - distSq(b[0] + 0.5, b[1] + 0.5, fromX, fromY))
    : [[tx, ty] as const]
  for (const [gx, gy] of targets) {
    const path = findPath(world, from, { tx: gx, ty: gy })
    if (path) return path
  }
  return null
}

/**
 * Champ de flux (spec R3) : distances BFS depuis le Feu, sur terrain + nœuds
 * (les STRUCTURES sont ignorées : le gradient traverse les murs, et le
 * zombie qui bute dessus les frappe — c'est le siège naturel).
 * Recalculé à la demande, dérivé pur de l'état : rien à sérialiser.
 */
export function computeFlowField(map: WorldMap, nodes: ResourceNode[], targetTx: number, targetTy: number): Int32Array {
  const { width, height } = map
  const field = new Int32Array(width * height).fill(-1)
  const world: MoveWorld = { map, nodes } // sans structures
  // Index d'occupation bâti une fois : le BFS balaie toute la carte.
  const isBlocked = makeIndexedIsBlockedAt(world)
  const queue: number[] = []
  const startKey = targetTy * width + targetTx
  field[startKey] = 0
  queue.push(startKey)
  let head = 0
  while (head < queue.length) {
    const key = queue[head]!
    head += 1
    const kx = key % width
    const ky = Math.floor(key / width)
    const d = field[key]!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = kx + dx
      const ny = ky + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const nk = ny * width + nx
      if (field[nk] !== -1) continue
      if (isBlocked(nx, ny)) continue
      field[nk] = d + 1
      queue.push(nk)
    }
  }
  return field
}
