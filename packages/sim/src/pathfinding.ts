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
import type { SimState } from './sim'
import { estIncassable } from './pieces'
import type { Structure } from './village'

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
  /**
   * Le BUDGET d'exploration — et pour la faune, c'est un bouton de DESIGN, pas une
   * soupape de perf (spec faune R20). Un chercheur qui explore 4 096 tuiles résout
   * un labyrinthe ; un loup ne doit pas. MESURÉ, tuiles explorées nécessaires :
   * ouverture en face 200 · décalée de 15 tuiles 700 · palissade 20×20 dont la porte
   * est à l'opposé 1 200 · détour de 40 tuiles, grande enceinte, labyrinthe : 4 096.
   * Le budget CHOISIT donc ce que la bête est capable de comprendre.
   */
  maxExplored?: number,
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
    const path = findPath(world, from, { tx: gx, ty: gy }, maxExplored)
    if (path) return path
  }
  return null
}

/**
 * ═══ LE LISSAGE D'UN CHEMIN — la diagonale se gagne APRÈS l'A*, jamais dedans ═══
 *
 * *« Les cendreux se déplacent quasi exclusivement en X et Y toujours. »* (Alexis, 2026-08-25.)*
 *
 * MESURÉ avant d'écrire une ligne (`tools/diag-cendreux-cap.mts`, graine 2026, nuit du jour 50) :
 * sur la branche du CHEMIN, **9,9 % des pas seulement sont obliques**. Et la cause n'est pas la
 * quantification du pas — `moveToward` sait faire huit directions depuis toujours : c'est la
 * FORME des chemins. L'A* est 4-connexe et son départage d'égalités produit des **L**, pas des
 * escaliers — relevé sur la carte du banc, du spawn vers (+10, +10) :
 *
 *     ESEEEEEEEEESSSSSSSSS      20 pas, 3 virages
 *     ESEEEEEEEEEEEEEEEEEEESSSSSSSSSSSSSSSSSSS   (vers +20, +20)
 *
 * Une goule qui suit ce chemin marche dix tuiles plein est, puis dix plein sud. Corriger le CAP
 * d'un waypoint à l'autre (ce que fait `descendreLeChamp` pour la horde) ne peut rien y changer :
 * il n'y a que trois virages sur vingt pas.
 *
 * ⚠ ON NE TOUCHE NI À L'A* NI À SON RÉSULTAT COMME CHEMIN — on n'en retire que les jalons dont
 *   personne n'a besoin. Le corridor est le même, les tuiles retenues sont un SOUS-ENSEMBLE de
 *   celles que l'A* a élues, et le dernier jalon est toujours gardé : ce qui était joignable le
 *   reste, mot pour mot. Le lissage n'invente aucune tuile.
 *
 * LA RÈGLE (« string pulling », le classique) : depuis le point de départ, on garde le jalon le
 * plus LOIN qu'on voie en ligne droite, on repart de lui, et ainsi de suite. Ce qui restait entre
 * les deux n'était qu'un artefact de la grille.
 *
 * ═══ CE QUE « VOIR » VEUT DIRE ICI ═══
 *
 * Une traversée de tuiles exacte (Amanatides–Woo) — chaque tuile que le segment touche doit être
 * libre — PLUS la règle du coin : là où le segment passe pile par un coin, les deux tuiles
 * orthogonales doivent l'être aussi, sinon un corps de `AVATAR_HITBOX_TILES` s'y coincerait.
 * Conservateur par construction : au pire on garde un jalon de trop, jamais un de moins.
 *
 * Le coût est payé UNE FOIS PAR CALCUL DE CHEMIN (pas par tick) et il est petit devant l'A* qui
 * vient de tourner : le même index d'occupation, et au plus `LISSAGE_PORTEE` tuiles balayées par
 * jalon. Pur : + - * / et comparaisons (invariant #2 — pas de `hypot`, pas de trigonométrie).
 */
const LISSAGE_PORTEE = 16

/** La ligne (x0,y0)→(x1,y1) ne traverse-t-elle que des tuiles libres ? (avec la règle du coin) */
function vueDegagee(
  bloque: (tx: number, ty: number) => boolean,
  x0: number, y0: number, x1: number, y1: number,
): boolean {
  let tx = Math.floor(x0)
  let ty = Math.floor(y0)
  const finX = Math.floor(x1)
  const finY = Math.floor(y1)
  const dx = x1 - x0
  const dy = y1 - y0
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0
  // Distance paramétrique jusqu'à la prochaine ligne de grille, et pas entre deux lignes.
  // `Infinity` sur un axe immobile : la comparaison le sort naturellement du jeu.
  const dtX = sx === 0 ? Infinity : (sx > 0 ? 1 : -1) / dx
  const dtY = sy === 0 ? Infinity : (sy > 0 ? 1 : -1) / dy
  let tMaxX = sx === 0 ? Infinity : (sx > 0 ? tx + 1 - x0 : x0 - tx) * (sx > 0 ? 1 / dx : -1 / dx)
  let tMaxY = sy === 0 ? Infinity : (sy > 0 ? ty + 1 - y0 : y0 - ty) * (sy > 0 ? 1 / dy : -1 / dy)
  // 2×PORTÉE pas au plus : une traversée franchit au pire une ligne de grille par axe et par tuile.
  for (let garde = 0; garde < 2 * LISSAGE_PORTEE + 4; garde++) {
    if (tx === finX && ty === finY) return true
    if (tMaxX < tMaxY) {
      tx += sx
      tMaxX += dtX
    } else if (tMaxY < tMaxX) {
      ty += sy
      tMaxY += dtY
    } else {
      // PILE UN COIN : le corps ne passe qu'entre deux tuiles libres.
      if (bloque(tx + sx, ty) || bloque(tx, ty + sy)) return false
      tx += sx
      ty += sy
      tMaxX += dtX
      tMaxY += dtY
    }
    if (bloque(tx, ty)) return false
  }
  return false // au-delà de la garde : on ne PRÉTEND pas voir, on garde le jalon
}

/**
 * Le même chemin, débarrassé des jalons qu'on peut joindre en ligne droite (voir ci-dessus).
 * `fromX/fromY` : la position RÉELLE du marcheur, pas le centre de sa tuile — c'est de là qu'il
 * part. Rend un tableau neuf ; l'entrée n'est pas touchée.
 */
export function lisserLeChemin(
  world: MoveWorld,
  fromX: number,
  fromY: number,
  chemin: readonly { tx: number; ty: number }[],
): { tx: number; ty: number }[] {
  if (chemin.length < 2) return chemin.map((w) => ({ tx: w.tx, ty: w.ty }))
  const bloque = makeIndexedIsBlockedAt(world)
  const out: { tx: number; ty: number }[] = []
  let x = fromX
  let y = fromY
  let i = 0
  while (i < chemin.length) {
    // Le plus LOIN qu'on voie, en s'arrêtant au premier jalon invisible : au-delà, le corridor
    // n'est plus garanti droit, et sauter par-dessus un jalon qu'on ne voit pas serait inventer
    // un chemin que l'A* n'a pas trouvé.
    let j = i
    for (let k = i + 1; k < chemin.length; k++) {
      const cx = chemin[k]!.tx + 0.5
      const cy = chemin[k]!.ty + 0.5
      if (distSq(cx, cy, x, y) > LISSAGE_PORTEE * LISSAGE_PORTEE) break
      if (!vueDegagee(bloque, x, y, cx, cy)) break
      j = k
    }
    const garde = chemin[j]!
    out.push({ tx: garde.tx, ty: garde.ty })
    x = garde.tx + 0.5
    y = garde.ty + 0.5
    i = j + 1
  }
  return out
}

/**
 * LES SOLIDES ÉTERNELS (décision d'Alexis, 2026-08-11) : les structures `incassable`
 * du monde — le massif d'un antre. Le gradient de la horde et la joignabilité des
 * spawns les traitent comme de la ROCHE, jamais comme du bâti : ils ne tomberont
 * jamais, un chemin qui compte sur leur chute n'existera jamais. Posés à l'amorce et
 * immuables — c'est ce qui autorise ces lectures.
 */
export function solidesEternels(structures: Structure[]): Structure[] {
  return structures.filter((s) => estIncassable(s.type))
}

/**
 * Champ de flux (spec R3) : distances BFS depuis le Feu, sur terrain + nœuds
 * (les STRUCTURES du bâti sont ignorées : le gradient traverse les murs, et le
 * zombie qui bute dessus les frappe — c'est le siège naturel). Les SOLIDES
 * ÉTERNELS (`solidesEternels`), eux, bloquent le gradient comme la falaise :
 * la roche ne tombe jamais, la horde la contourne (2026-08-11).
 * Recalculé à la demande, dérivé pur de l'état : rien à sérialiser.
 */
export function computeFlowField(
  map: WorldMap,
  nodes: ResourceNode[],
  solides: Structure[],
  targetTx: number,
  targetTy: number,
  /**
   * L'ÉTAT, POUR LE SEUL GEL (spec `gel.md` G4) — optionnel, et c'est délibéré : les gardes
   * de géométrie qui interrogent une carte hors du temps n'ont rien à lui passer. Mais le
   * jeu, lui, DOIT le passer : « ce qui traverse, traverse pour tout le monde » n'a de sens
   * que si le gradient de la horde voit la même rivière gelée que l'avatar qui la franchit.
   */
  etat?: SimState,
): Int32Array {
  return computeFlowFieldMulti(map, nodes, solides, [{ tx: targetTx, ty: targetTy }], etat)
}

/**
 * LE MÊME BFS, PLUSIEURS GRAINES (spec 2026-08-21, décision ① — « le levé marche ») : toutes
 * les sources partent à 0, et le champ rendu est la distance de marche au feu LE PLUS PROCHE —
 * au sens de la marche, pas de l'oiseau. C'est ce qui rend « il vise le feu le plus proche »
 * (décision ⑬) gratuit : UN tableau pour toute la vallée, quel que soit le nombre de feux,
 * là où un champ par feu aurait coûté 15 Mo pièce.
 *
 * `maxDist` borne l'exploration : au-delà, la vallée rend -1 — c'est la portée de convergence
 * d'un acte (`CENDREUX.CONVERGE_TILES`), et c'est aussi ce qui évite de payer la carte entière
 * quand l'acte ne regarde que sa ceinture.
 */
export function computeFlowFieldMulti(
  map: WorldMap,
  nodes: ResourceNode[],
  solides: Structure[],
  sources: { tx: number; ty: number }[],
  etat?: SimState,
  maxDist = Infinity,
): Int32Array {
  const { width, height } = map
  const field = new Int32Array(width * height).fill(-1)
  // `exactOptionalPropertyTypes` : un `etat: undefined` explicite n'est PAS un champ absent.
  const world: MoveWorld = { map, nodes, structures: solides, moverVillageId: null } // la roche seule, jamais le bâti
  if (etat !== undefined) world.etat = etat
  // Index d'occupation bâti une fois : le BFS balaie toute la carte.
  const isBlocked = makeIndexedIsBlockedAt(world)
  const queue: number[] = []
  for (const s of sources) {
    const startKey = s.ty * width + s.tx
    if (field[startKey] === 0) continue // deux feux sur la même tuile : une seule graine
    field[startKey] = 0
    queue.push(startKey)
  }
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
      if (d + 1 > maxDist) continue // hors de portée : la vallée s'arrête là
      field[nk] = d + 1
      queue.push(nk)
    }
  }
  return field
}
