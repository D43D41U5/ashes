/**
 * A* sur la grille, 4 directions (spec pnj R8) — pour la navigation
 * individuelle des PNJ. Les flow fields des hordes (V7) sont un autre outil.
 *
 * Déterministe : coûts entiers, heuristique Manhattan, départage des égalités
 * par ordre d'insertion. Arithmétique + - * / uniquement.
 */
import { makeIndexedIsBlockedAt, type MoveWorld } from './collision'
import { connecteurAt, franchitUneJoue, niveauDeLaTuile, palierDuSol, type Connecteur } from './etages'
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
  /** L'ÉTAGE du nœud ouvert (spec `etages.md`). Absent ≡ 0 — le sol, donc tout l'existant. */
  etage?: number
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
  from: { tx: number; ty: number; etage?: number },
  to: { tx: number; ty: number; etage?: number },
  maxExplored = 4096,
): { tx: number; ty: number; etage?: number }[] | null {
  // « Au sol » = le palier de la tuile (spec `terrasses.md` T-R3) — 0 sans terrasses.
  const eFrom = niveauDeLaTuile(world.map, from)
  const eTo = niveauDeLaTuile(world.map, to)
  if (from.tx === to.tx && from.ty === to.ty && eFrom === eTo) return []
  const width = world.map.width
  const height = world.map.height
  const inBounds = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < width && ty < height
  if (!inBounds(to.tx, to.ty)) return null

  /**
   * ═══ LA RECHERCHE EST À TROIS DIMENSIONS (spec `etages.md`) ═══
   *
   * Le loup doit pouvoir MONTER, donc l'espace de recherche est `(tx, ty, étage)` et non `(tx, ty)`.
   * Le prédicat de blocage devient une famille — un par étage —, bâti PARESSEUSEMENT : sur un
   * monde sans étage, ou pour une recherche qui reste au sol, on ne monte que celui de l'étage 0,
   * c'est-à-dire exactement l'index d'avant, au bit près.
   */
  const bloque: (((tx: number, ty: number) => boolean) | undefined)[] = []
  const isBlocked = (e: number, tx: number, ty: number): boolean => {
    const i = e + 8
    // L'index d'occupation, bâti une fois : l'A* interroge des milliers de tuiles.
    const f = bloque[i] ?? (bloque[i] = makeIndexedIsBlockedAt(world, e))
    return f(tx, ty)
  }
  if (isBlocked(eTo, to.tx, to.ty)) return null

  /** LES CONNECTEURS SOUS LA MAIN : un point de bascule d'étage, indexé par tuile. */
  const portes = new Map<number, Connecteur>()
  for (const c of world.map.connecteurs ?? []) portes.set(c.y * width + c.x, c)

  const PLAN = width * height
  const key = (tx: number, ty: number, e: number): number => (e + 8) * PLAN + ty * width + tx
  const masque = preparerTable(maxExplored)
  const heap = new MinHeap()
  let order = 0
  // L'heuristique ignore l'étage : elle doit rester ADMISSIBLE (ne jamais surestimer), et un
  // changement d'étage coûte 1 comme un pas. Manhattan sur x,y minore donc toujours le vrai coût.
  const h = (tx: number, ty: number): number => Math.abs(tx - to.tx) + Math.abs(ty - to.ty)

  const kDepart = key(from.tx, from.ty, eFrom)
  const c0 = caseDe(kDepart, masque)
  tableStamp[c0] = tableGen
  tableKeys[c0] = kDepart
  tableG[c0] = 0
  tableParent[c0] = -1
  heap.push({ f: h(from.tx, from.ty), order: order++, tx: from.tx, ty: from.ty, etage: eFrom })
  let explored = 0

  while (heap.size > 0 && explored < maxExplored) {
    const current = heap.pop()!
    explored += 1
    const eCur = current.etage ?? 0 // posé explicitement à l'empilement, jamais absent
    const kCourant = key(current.tx, current.ty, eCur)
    if (current.tx === to.tx && current.ty === to.ty && eCur === eTo) {
      const path: { tx: number; ty: number; etage?: number }[] = []
      let k = kCourant
      while (k !== kDepart) {
        const e = Math.floor(k / PLAN) - 8
        const reste = k - (e + 8) * PLAN
        const pas: { tx: number; ty: number; etage?: number } = { tx: reste % width, ty: Math.floor(reste / width) }
        // ADDITIF : un pas au sol reste `{tx, ty}`, exactement comme avant — les appelants qui
        // ne connaissent pas les étages continuent de lire ce qu'ils lisaient.
        if (e !== 0) pas.etage = e
        path.push(pas)
        k = tableParent[caseDe(k, masque)]!
      }
      path.reverse()
      return path
    }
    const g = tableG[caseDe(kCourant, masque)]!
    /** Ouvre un voisin — même géométrie pour un pas de côté et pour un pas d'étage. */
    const ouvrir = (nx: number, ny: number, ne: number): void => {
      const nk = key(nx, ny, ne)
      const ng = g + 1
      const c = caseDe(nk, masque)
      // Case libre (estampille périmée) ⇔ `gScore.get(nk) === undefined` dans l'ancienne version.
      if (tableStamp[c] === tableGen && tableG[c]! <= ng) return
      tableStamp[c] = tableGen
      tableKeys[c] = nk
      tableG[c] = ng
      tableParent[c] = kCourant
      heap.push({ f: ng + h(nx, ny), order: order++, tx: nx, ty: ny, etage: ne })
    }
    for (const [dx, dy] of DIRS) {
      const nx = current.tx + dx
      const ny = current.ty + dy
      if (!inBounds(nx, ny) || isBlocked(eCur, nx, ny)) continue
      // LA JOUE (`franchitUneJoue`) : une rampe s'aborde par le nord ou le sud, jamais par le
      // flanc — la collision refuse ce pas-là, donc le chemin ne doit pas le promettre.
      if (franchitUneJoue(world.map, current.tx, current.ty, dx)) continue
      ouvrir(nx, ny, eCur)
    }
    // ── LE PAS D'ÉTAGE : sur un connecteur, et NULLE PART AILLEURS (E-R8). Il coûte un pas,
    //    comme un pas de côté — une rampe se monte, elle ne se paie pas d'un détour imaginaire.
    const porte = portes.get(current.ty * width + current.tx)
    if (porte !== undefined) {
      const autre = porte.de === eCur ? porte.vers : porte.vers === eCur ? porte.de : undefined
      if (autre !== undefined && !isBlocked(autre, current.tx, current.ty)) ouvrir(current.tx, current.ty, autre)
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
  /** L'ÉTAGE du chercheur et celui de sa cible (spec `etages.md`). Absents ≡ « au sol, là où
   *  il est » — le palier de la tuile (T-R3), 0 sans terrasses : tout l'existant, et le chemin
   *  rendu est alors celui d'avant, jalon pour jalon. */
  etageFrom = palierDuSol(world.map, Math.floor(fromX), Math.floor(fromY)),
  etageTo = palierDuSol(world.map, tx, ty),
): { tx: number; ty: number; etage?: number }[] | null {
  const from = { tx: Math.floor(fromX), ty: Math.floor(fromY), etage: etageFrom }
  // Le voisin de repli se cherche À L'ÉTAGE DE LA CIBLE : se poster à côté d'un bloc du plateau,
  // c'est se tenir sur le plateau — le chercher au sol mettrait le loup douze mètres plus bas.
  const bloque = makeIndexedIsBlockedAt(world, etageTo)
  const targets = bloque(tx, ty)
    ? ([
        [tx + 1, ty],
        [tx - 1, ty],
        [tx, ty + 1],
        [tx, ty - 1],
      ] as const)
        .filter(([nx, ny]) => !bloque(nx, ny))
        .sort((a, b) => distSq(a[0] + 0.5, a[1] + 0.5, fromX, fromY) - distSq(b[0] + 0.5, b[1] + 0.5, fromX, fromY))
    : [[tx, ty] as const]
  for (const [gx, gy] of targets) {
    const path = findPath(world, from, { tx: gx, ty: gy, etage: etageTo }, maxExplored)
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
 * ═══ ET « VOIR », C'EST VOIR LE TRAJET QUE LE CORPS FERA — pas la corde ═══
 *
 * Le marcheur ne suit pas la corde : `moveToward` et `followPath` prennent le SIGNE de chaque
 * axe, donc il part en DIAGONALE (45°) jusqu'à ce qu'un axe soit aligné, puis finit tout droit.
 * Une corde de pente 1/4 qui frôle le sud d'une rampe est libre ; le trajet réel, lui, monte à
 * 45° dans la rangée de la rampe et repart de côté — dans sa joue. MESURÉ sur la terrasse de
 * laboratoire (`terrasses.test.ts` T-A6bis) : corps collé en x = 11,375, le bord ouest, chemin en
 * poche. On sonde donc les DEUX tronçons du vrai trajet, la diagonale puis l'axe — POUR LA JOUE
 * SEULEMENT : les obstacles restent jugés sur la corde (voir `trajetDegage`), sinon tous les
 * chemins de toutes les cartes changent, rampe ou pas.
 *
 * LA JOUE (`franchitUneJoue`) : une rampe s'aborde par le nord ou le sud, jamais par le flanc —
 * la collision ferme ce pas-là (`brideDeLaJoue`), donc aucun tronçon ne doit le promettre. Et
 * comme le corps n'entame un tronçon qu'à `WAYPOINT_RADIUS` près du centre du jalon, le trajet
 * réel peut décaler d'une rangée : on juge la joue sur la rangée traversée ET ses deux voisines.
 * Conservateur à un tuile près d'une rampe, et là seulement — ailleurs, aucune joue, rien ne change.
 *
 * Le coût est payé UNE FOIS PAR CALCUL DE CHEMIN (pas par tick) et il est petit devant l'A* qui
 * vient de tourner : le même index d'occupation, et au plus `LISSAGE_PORTEE` tuiles balayées par
 * jalon. Pur : + - * / et comparaisons (invariant #2 — pas de `hypot`, pas de trigonométrie).
 */
const LISSAGE_PORTEE = 16

const JAMAIS = (): boolean => false

/**
 * Le tronçon (x0,y0)→(x1,y1) est-il franchissable ? Deux questions, deux géométries :
 *  - les OBSTACLES se jugent sur la corde, comme avant les terrasses — au bit près, c'est le
 *    lissage que tout le jeu a calibré (raids, corvées, hordes) ; le juger sur le vrai trajet
 *    changeait tous les chemins de toutes les cartes, et deux gardes sans rampe ont rougi
 *    (alignment A7(b), session « cueillette ») ;
 *  - la JOUE se juge sur le vrai trajet d'un marcheur au signe par axe : la diagonale, puis
 *    l'axe qui reste — c'est là, et pas sur la corde, qu'il entre dans le flanc d'une rampe.
 * Sans connecteur sur la carte, la joue est inerte et seule la corde compte : rien ne change.
 */
function trajetDegage(
  bloque: (tx: number, ty: number) => boolean,
  joue: (tx: number, ty: number, dx: number) => boolean,
  x0: number, y0: number, x1: number, y1: number,
): boolean {
  if (!vueDegagee(bloque, JAMAIS, x0, y0, x1, y1)) return false
  const dx = x1 - x0
  const dy = y1 - y0
  const m = Math.min(Math.abs(dx), Math.abs(dy))
  const xm = x0 + (dx > 0 ? m : -m)
  const ym = y0 + (dy > 0 ? m : -m)
  return vueDegagee(JAMAIS, joue, x0, y0, xm, ym) && vueDegagee(JAMAIS, joue, xm, ym, x1, y1)
}

function vueDegagee(
  bloque: (tx: number, ty: number) => boolean,
  /** LA JOUE : ce pas de côté franchit-il le bord d'une rampe, sur cette rangée ou ses deux
   *  voisines ? (`franchitUneJoue`) — voir l'en-tête. */
  joue: (tx: number, ty: number, dx: number) => boolean,
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
      if (joue(tx, ty, sx)) return false
      tx += sx
      tMaxX += dtX
    } else if (tMaxY < tMaxX) {
      ty += sy
      tMaxY += dtY
    } else {
      // PILE UN COIN : le corps ne passe qu'entre deux tuiles libres — et sans joue.
      if (bloque(tx + sx, ty) || bloque(tx, ty + sy)) return false
      if (joue(tx, ty, sx)) return false
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
  // AU NIVEAU DU MARCHEUR : une tuile d'un autre palier est « bloquée » pour lui, donc la
  // ligne droite s'arrête au pied d'une rampe et le chemin s'y suit jalon par jalon — l'A*
  // seul sait monter (spec `terrasses.md` T-R2).
  const niveau = world.etages?.[0] ?? palierDuSol(world.map, Math.floor(fromX), Math.floor(fromY))
  const bloque = makeIndexedIsBlockedAt(world, niveau)
  // La rangée traversée et ses deux voisines : le corps entame chaque tronçon à `WAYPOINT_RADIUS`
  // du centre, pas au centre — voir l'en-tête.
  const joue = (tx: number, ty: number, dx: number): boolean =>
    franchitUneJoue(world.map, tx, ty, dx) || franchitUneJoue(world.map, tx, ty - 1, dx) || franchitUneJoue(world.map, tx, ty + 1, dx)
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
      if (!trajetDegage(bloque, joue, x, y, cx, cy)) break
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
  //
  // ═══ LES TERRASSES (spec `terrasses.md` T-R2) : le champ reste À DEUX DIMENSIONS ═══
  // Chaque tuile a UN sol, à son palier — c'est là qu'on lit si elle bloque. Et le gradient ne
  // franchit un changement de palier que par une RAMPE (un connecteur qui relie les deux, sur
  // l'une des deux tuiles) : sans elle, le mur de terrasse coupe le champ comme la falaise. Un
  // monde sans paliers ne paie rien de plus — `paliers` absent, le pas d'avant.
  const paliers = map.palier
  const isBlockedAu: (((tx: number, ty: number) => boolean) | undefined)[] = []
  const isBlocked = (tx: number, ty: number): boolean => {
    const p = paliers === undefined ? 0 : paliers[ty * width + tx]!
    const f = isBlockedAu[p] ?? (isBlockedAu[p] = makeIndexedIsBlockedAt(world, p))
    return f(tx, ty)
  }
  const relie = (tx: number, ty: number, a: number, b: number): boolean => {
    const c = connecteurAt(map, tx, ty)
    return c !== undefined && ((c.de === a && c.vers === b) || (c.de === b && c.vers === a))
  }
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
      if (paliers !== undefined) {
        const pa = paliers[key]!
        const pb = paliers[nk]!
        if (pa !== pb && !relie(kx, ky, pa, pb) && !relie(nx, ny, pa, pb)) continue
      }
      // LA JOUE, comme dans l'A* : le gradient ne mène pas la horde dans le flanc d'une rampe.
      if (franchitUneJoue(map, kx, ky, dx)) continue
      if (d + 1 > maxDist) continue // hors de portée : la vallée s'arrête là
      field[nk] = d + 1
      queue.push(nk)
    }
  }
  return field
}
