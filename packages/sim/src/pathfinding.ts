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
      // Échange par variable temporaire, PAS par déstructuration : `[a, b] = [b, a]`
      // alloue un tableau littéral à CHAQUE permutation, au cœur du sift. Même
      // permutation, même ordre du tas — donc même chemin (le départage par
      // `(f, order)` est l'invariant à ne pas bouger).
      const tmp = this.items[i]!
      this.items[i] = this.items[parent]!
      this.items[parent] = tmp
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
        const tmp = this.items[i]!
        this.items[i] = this.items[best]!
        this.items[best] = tmp
        i = best
      }
    }
    return top
  }

  private less(a: HeapNode, b: HeapNode): boolean {
    return a.f < b.f || (a.f === b.f && a.order < b.order)
  }
}

/**
 * ═══ LA TABLE DE L'A* — deux `Map` remplacées par une table open-adressée ═══
 *
 * `gScore` et `cameFrom` étaient des `Map<number, number>`. L'A* les interroge une fois par nœud
 * dépilé et deux à trois fois par voisin : sur le banc, **1,64 M d'expansions** en 20 000 ticks,
 * soit une dizaine de millions de hachages. Une table open-adressée sur `Int32Array` fait le même
 * travail par lecture indexée — MESURÉ : le tick entier passe de 9,08 s à 7,77 s (−14 %), le
 * coût de `findPath` chutant d'environ 70 %.
 *
 * TROIS CHOSES LA RENDENT SÛRE :
 *
 *  1. **Le TAMPON EST RÉUTILISÉ, jamais vidé.** Chaque appel incrémente `tableGen` ; une case dont
 *     l'estampille ne vaut pas `tableGen` est LIBRE. Pas de `fill` d'un mégaoctet par appel.
 *  2. **La capacité borne le taux de remplissage à ½.** Un A* pose au plus `1 + 4 × maxExplored`
 *     clés distinctes (au plus `maxExplored` dépilages, quatre voisins chacun) ; on alloue une
 *     puissance de deux ≥ `8 × (maxExplored + 1)`. Le sondage linéaire se termine donc toujours.
 *  3. **`Math.imul` est autorisé par l'invariant n°2**, et une table de hachage n'a de toute façon
 *     aucun ordre observable ici : on n'y fait que des lectures et des écritures par clé. Le
 *     départage de l'A' reste ce qu'il était — `(f, order)` dans le tas, intact.
 *
 * Ce tampon est un SCRATCH, pas de l'état : il ne sort jamais de `findPath`, n'entre dans aucun
 * `SimState`, et deux appels de suite avec les mêmes entrées rendent le même chemin.
 *
 * ⚠ UN SEUL A* À LA FOIS. Le tampon étant partagé, un `findPath` appelé DEPUIS un `findPath`
 * écraserait la table du premier — sans erreur, avec un chemin faux. Rien ne le fait aujourd'hui
 * (`pathToward` enchaîne ses tentatives, et la chaîne de `isBlocked` ne rentre nulle part) ; si un
 * jour une aide en avait besoin, il lui faudrait sa propre table, pas celle-ci.
 */
let tableCap = 0
let tableKeys = new Int32Array(0)
let tableStamp = new Int32Array(0)
let tableG = new Int32Array(0)
let tableParent = new Int32Array(0)
let tableGen = 0

/** Prépare la table pour un appel et rend son masque. */
function preparerTable(maxExplored: number): number {
  let cap = 1024
  while (cap < 8 * (maxExplored + 1)) cap *= 2
  if (cap > tableCap) {
    tableCap = cap
    tableKeys = new Int32Array(cap)
    tableStamp = new Int32Array(cap)
    tableG = new Int32Array(cap)
    tableParent = new Int32Array(cap)
    tableGen = 0
  }
  // L'estampille est un entier 32 bits : au bout de 2³¹ appels on repart de zéro, tampon vidé.
  if (tableGen >= 0x7fffffff) {
    tableStamp.fill(0)
    tableGen = 0
  }
  tableGen += 1
  return tableCap - 1
}

/** La case de la clé `k` : celle qui la porte, ou la première libre où l'écrire. */
function caseDe(k: number, masque: number): number {
  let i = (Math.imul(k, 0x9e3779b1) >>> 0) & masque
  for (;;) {
    if (tableStamp[i] !== tableGen) return i
    if (tableKeys[i] === k) return i
    i = (i + 1) & masque
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
  const masque = preparerTable(maxExplored)
  const heap = new MinHeap()
  let order = 0
  const h = (tx: number, ty: number): number => Math.abs(tx - to.tx) + Math.abs(ty - to.ty)

  const kDepart = key(from.tx, from.ty)
  const c0 = caseDe(kDepart, masque)
  tableStamp[c0] = tableGen
  tableKeys[c0] = kDepart
  tableG[c0] = 0
  tableParent[c0] = -1
  heap.push({ f: h(from.tx, from.ty), order: order++, tx: from.tx, ty: from.ty })
  let explored = 0

  while (heap.size > 0 && explored < maxExplored) {
    const current = heap.pop()!
    explored += 1
    const kCourant = key(current.tx, current.ty)
    if (current.tx === to.tx && current.ty === to.ty) {
      const path: { tx: number; ty: number }[] = []
      let k = kCourant
      while (k !== kDepart) {
        path.push({ tx: k % width, ty: Math.floor(k / width) })
        k = tableParent[caseDe(k, masque)]!
      }
      path.reverse()
      return path
    }
    const g = tableG[caseDe(kCourant, masque)]!
    for (const [dx, dy] of DIRS) {
      const nx = current.tx + dx
      const ny = current.ty + dy
      if (!inBounds(nx, ny) || isBlocked(nx, ny)) continue
      const nk = key(nx, ny)
      const ng = g + 1
      const c = caseDe(nk, masque)
      // Case libre (estampille périmée) ⇔ `gScore.get(nk) === undefined` dans l'ancienne version.
      if (tableStamp[c] === tableGen && tableG[c]! <= ng) continue
      tableStamp[c] = tableGen
      tableKeys[c] = nk
      tableG[c] = ng
      tableParent[c] = kCourant
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
    // `DIRS`, pas un tableau littéral : écrit ici, il s'allouait à CHAQUE tuile dépilée d'un BFS
    // qui balaie toute la carte. Contenu et ordre identiques (c'est la même constante, dix lignes
    // plus haut) — MESURÉ : 105 ms → 84 ms par champ sur la carte du banc (450 k tuiles),
    // pour un champ bit à bit identique.
    for (const [dx, dy] of DIRS) {
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
