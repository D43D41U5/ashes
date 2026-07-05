/**
 * A* sur la grille, 4 directions (spec pnj R8) — pour la navigation
 * individuelle des PNJ. Les flow fields des hordes (V7) sont un autre outil.
 *
 * Déterministe : coûts entiers, heuristique Manhattan, départage des égalités
 * par ordre d'insertion. Arithmétique + - * / uniquement.
 */
import { isBlockedAt, type MoveWorld } from './collision'

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
  if (isBlockedAt(world, to.tx, to.ty)) return null
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
      if (!inBounds(nx, ny) || isBlockedAt(world, nx, ny)) continue
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
