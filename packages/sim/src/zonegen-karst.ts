/**
 * ═══ LES KARSTS — les grottes de terrasse (spec `grottes.md`) ═══
 *
 * Une terrasse est une MASSE de roche haute d'un palier, et on y entre par sa paroi. Le karst est
 * un réseau borné creusé dans cette masse — un vestibule, un cœur, un fond, sur un tronc (G-R3) —
 * qui vit dans la grille creuse du niveau `−(p + 1)` (G-R1) et s'ouvre sur le palier `p` par deux
 * à quatre gueules, des connecteurs. C'est LA Grotte du jeu : une zone `kind: 'grotte'` élue par
 * le relief, que `placePois` ne tire plus (G-R2, G-R10).
 *
 * Ce fichier ne connaît que la géométrie : où une paroi est éligible, comment on creuse, où dort
 * l'eau, où le fil ressort. Le lieu (l'abri, la tanière, la pierre) se lit dans `poi.ts` et
 * `zone-content.ts` sur la donnée rendue ici (`Karst`).
 *
 * ⚠ **AUCUN TIRAGE** (E-R15, G-A2) : l'élection, la forme des salles, l'eau et la pierre sortent
 * de hachages positionnels salés `'KARS'` et du relief `'CAVS'` des caves. Le flux du PRNG de la
 * partie n'est pas touché d'un bit, et deux moteurs rendent le même karst : les parcours sont
 * ordonnés par INDEX de tuile, jamais par ordre d'insertion d'un `Set`.
 *
 * ⚠ Ce bloc se règle EN REGARDANT UNE CARTE (`pnpm smoke --scenario grotte`), pas en jouant :
 * c'est pourquoi il vit ici et non dans `balance.ts` (en-tête de `balance.ts`, « l'exception »).
 */
import { TERRAIN_DEEP_WATER, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER } from './balance'
import { reliefDeCave, terrainDeCave } from './etages'
import { MARCHABLE, isWater } from './map'
import { fbm2, hash2 } from './noise'
import { altitudeAt, familleAt, type Creux } from './racine-relief'
import type { Rect } from './zonegraph'

export const KARST = {
  /** Le plafond de tuiles creusées d'un karst — boyaux, salles et gueules comprises. */
  TUILES: 300,
  /** Gueules par karst : la principale et une à trois secondaires, sur la même paroi. */
  GUEULES_MAX: 4,
  /** Écart minimal (Chebyshev, tuiles) entre deux gueules d'un même karst. */
  GUEULES_ECART: 8,
  /** Largeur minimale d'un boyau : deux — un corps et son ombre, jamais un couloir d'une tuile. */
  BOYAU_LARGEUR: 2,
  /** Les rangées derrière la gueule qui font le vestibule (distance de Chebyshev à la gueule). */
  VESTIBULE_RANGEES: 5,
  /**
   * Le fond — la tanière — à au moins tant de tuiles (Chebyshev) de TOUTE gueule.
   * ⚠ ≥ `DEN_SPAWN_CLEARANCE` (24) : le sanglier du fond ne naît jamais dans le vestibule.
   */
  FOND_DISTANCE: 24,
  /** La roche derrière la paroi doit tenir tant de rangées au palier `p + 1` : la place du réseau. */
  ROCHE_MIN: 28,
  /** Un segment de paroi éligible fait au moins tant de pieds contigus. */
  SEGMENT_MIN: 6,
  /** La part d'une paroi éligible qui porte un karst, par famille de roche (G-R8b). */
  PART: { calcaire: 1, granite: 0.3, argile: 0.1 },
  /** Deux karsts à moins de tant de tuiles (euclidien) : le second cède. */
  ESPACEMENT: 120,
  /** Le plancher (G-R8a) : tout spawn et tout site de village a une gueule à tant de tuiles. */
  PLANCHER_RAYON: 100,
  /** La trace du karst noyé (G-R9) : tant de tuiles d'eau peu profonde au pied de la gueule. */
  TRACE_EAU: 6,
  // ── Le réglage de la forme — mien, à l'œil sur la carte. ──
  /** Le rayon des salles, modulé de ±25 % par le relief `'KARS'` : jamais un disque. */
  RAYON: { vestibule: 3, coeur: 4, coeur2: 3, fond: 3 },
  /** La profondeur (rangées derrière la gueule) du germe de chaque salle. */
  PROFONDEUR: { vestibule: 3, coeur: 14, coeur2: 11, fond: 27 },
  /** Le décalage latéral maximal du cœur et du fond par rapport à la gueule. */
  LATERAL_MAX: 6,
  /** La demi-largeur de la boîte de fouille autour de la gueule principale. */
  BOITE: 40,
  /**
   * Une gueule SECONDAIRE s'ouvre sur la même face — qui est un escalier de cellules : son pied
   * peut être à tant de rangées de celui de la principale, et n'exige que `ROCHE_SECONDAIRE`
   * rangées de roche derrière lui (son boyau latéral rejoint le réseau, il ne le fonde pas).
   */
  RANGEES_SECONDAIRES: 16,
  ROCHE_SECONDAIRE: 8,
  /** La part des karsts qui ont une seconde salle au cœur. */
  COEUR2_PART: 0.6,
  /** La nappe du calcaire : le tiers bas de chaque salle est noyé (G-R4). */
  BASSIN: 3,
  /** Le granite : une flaque sur deux, du cinquième bas du cœur, sans creux (G-R4). */
  FLAQUE: 5,
  FLAQUE_PART: 0.5,
  /** La pierre du cœur (G-R5) : un nœud (rocher ou bloc) par tant de tuiles creusées. */
  PIERRE: 16,
} as const

/** Le sel des karsts : `'KARS'`. Distinct de `'CAVE'` (les caves de mesa) et de `'CAVS'` (le sol). */
export const SEL_KARST = 0x4b415253
const SEL_FORME = SEL_KARST ^ 0x464f524d // 'FORM' — le relief qui déforme les salles
const SEL_PIERRE = SEL_KARST ^ 0x50494552 // 'PIER' — l'élection des nœuds de pierre
const SEL_BLOC = SEL_KARST ^ 0x424c4f43 // 'BLOC' — rocher ou bloc

export type RoleDeSalle = 'vestibule' | 'coeur' | 'fond'

export interface SalleDeKarst {
  role: RoleDeSalle
  /** Le germe : l'index de la tuile d'où la salle a poussé. */
  germe: number
  /** Les tuiles de la salle, triées croissant. */
  tuiles: number[]
}

/** UN KARST — le fait de génération complet, ce que le lieu et les gardes lisent. */
export interface Karst {
  /** Le palier du sol où s'ouvrent les gueules. */
  palier: number
  /** Le niveau de la grille creuse : `−(palier + 1)`. */
  niveau: number
  /** La famille de roche à la gueule principale : calcaire (−1), granite (0), argile (+1). */
  famille: -1 | 0 | 1
  /** Les gueules, `[ouest, est]` en index de tuiles — la première est la gueule principale. */
  gueules: [number, number][]
  /** L'emprise creusée à l'étage, gueules comprises, triée croissant. */
  tuiles: number[]
  /** Le terrain de chaque tuile de `tuiles`, dans le même ordre (eau comprise). */
  terrain: number[]
  salles: SalleDeKarst[]
  /** Les tuiles de boyau — creusées, hors de toute salle. */
  boyaux: number[]
  /** La tanière : la tuile sèche la plus loin de toute gueule. */
  fond: number
  /** La trace en surface (G-R9), en index de `map.terrain` — vide pour un karst sec. */
  trace: number[]
  /** Un karst NOYÉ (calcaire) porte une nappe ; un karst sec n'a qu'une flaque, ou rien. */
  noye: boolean
  /** Posé par le plancher (G-R8a), après les spawns : jamais de Louvière. */
  plancher: boolean
}

/** Un segment de paroi éligible : des pieds contigus d'une même rangée, au même palier. */
export interface SegmentDeParoi {
  y: number
  x0: number
  x1: number
  palier: number
}

/**
 * Ce que le creusement lit du monde. `reserve` et `terrain` sont MUTÉS par un karst accepté :
 * ses tuiles y sont réservées, sa trace y est peinte.
 */
export interface ChampDeKarst {
  terrain: number[]
  width: number
  height: number
  palier: ArrayLike<number>
  creux: Creux
  /** Le rectangle où l'on cherche des parois : la Racine. */
  rect: Rect
  /** 1 sur toute tuile d'une grille creuse (tous niveaux) ou d'un connecteur — la roche prise. */
  reserve: Uint8Array
  /** 1 sur toute tuile d'un rectangle de lieu (`zone.kind`) : une gueule ne s'ouvre pas dans une cour. */
  lieux: Uint8Array
  /** Les tuiles de connecteur : aucune dans la colonne d'une gueule. */
  portes: ReadonlySet<number>
}

/** Le masque des rectangles de lieux — construit par l'appelant depuis `map.zones`. */
export function masqueDesLieux(
  zones: readonly { x: number; y: number; w: number; h: number; kind?: string }[],
  width: number,
  height: number,
): Uint8Array {
  const m = new Uint8Array(width * height)
  for (const z of zones) {
    if (z.kind === undefined) continue
    const x0 = Math.max(0, Math.floor(z.x))
    const y0 = Math.max(0, Math.floor(z.y))
    const x1 = Math.min(width, Math.ceil(z.x + z.w))
    const y1 = Math.min(height, Math.ceil(z.y + z.h))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * width + x] = 1
  }
  return m
}

/**
 * ═══ (1) LES SEGMENTS DE PAROI ÉLIGIBLES ═══
 *
 * Un PIED : une tuile marchable du palier `p`, ni eau, ni réservée, ni dans un lieu, dont le
 * voisin nord est au palier `p + 1` et dont la colonne tient `ROCHE_MIN` rangées de roche
 * (palier ≥ `p + 1`, rien de réservé) — ni rampe ni gueule de mesa dans la colonne. Les pieds
 * contigus d'une rangée, au même palier, font un segment ; il en faut `SEGMENT_MIN`.
 */
/**
 * UN PIED DE GUEULE : une tuile marchable du sol, ni eau, ni réservée, ni dans un lieu, dont le
 * voisin nord est un palier plus haut et dont la colonne tient `roche` rangées de roche prise
 * par personne — ni connecteur dans la colonne, deux rangées au-delà de chaque côté.
 */
function piedDeGueule(champ: ChampDeKarst, x: number, y: number, roche: number): boolean {
  const { terrain, width, height, palier, reserve, lieux, portes } = champ
  if (x < 0 || x >= width || y - roche < 0 || y >= height) return false
  const i = y * width + x
  const t = terrain[i]!
  if (MARCHABLE[t] !== 1 || isWater(t) || reserve[i] === 1 || lieux[i] === 1) return false
  const p = palier[i]!
  if (palier[i - width]! !== p + 1) return false
  // ET IL FAUT POUVOIR SE TENIR DEVANT. La gueule s'ouvre vers le SUD : la tuile au sud est le
  // seuil qu'on foule pour entrer (G-A4 ⑤ l'exige, `MARCHABLE` sur `map.terrain`). Tant que le
  // palier était constant par cellule de 8, la face d'une terrasse tenait dans un carré de sol et
  // le seuil venait gratuitement ; la lecture molle (T-R11) fait passer le bord À LA TUILE, et
  // une gueule s'est ouverte devant l'eau profonde (karst 250,183, graine 2026). On le demande.
  if (y + 1 >= height || MARCHABLE[terrain[i + width]!] !== 1) return false
  for (let k = 1; k <= roche; k++) {
    const j = i - k * width
    if (palier[j]! < p + 1 || reserve[j] === 1) return false
  }
  for (let k = -2; k <= roche + 2; k++) {
    const yy = y - k
    if (yy < 0 || yy >= height) continue
    if (portes.has(yy * width + x)) return false
  }
  return true
}

export function segmentsDeParoiEligibles(champ: ChampDeKarst): SegmentDeParoi[] {
  const { width, height, palier, rect } = champ
  const pied = (x: number, y: number): boolean => piedDeGueule(champ, x, y, KARST.ROCHE_MIN)
  const out: SegmentDeParoi[] = []
  const ya = Math.max(1, rect.y)
  const yb = Math.min(height, rect.y + rect.h)
  const xa = Math.max(0, rect.x)
  const xb = Math.min(width, rect.x + rect.w)
  for (let y = ya; y < yb; y++) {
    let x0 = -1
    let p0 = 0
    const fermer = (x1: number): void => {
      if (x0 >= 0 && x1 - x0 + 1 >= KARST.SEGMENT_MIN) out.push({ y, x0, x1, palier: p0 })
      x0 = -1
    }
    for (let x = xa; x < xb; x++) {
      if (pied(x, y)) {
        const p = palier[y * width + x]!
        if (x0 >= 0 && p !== p0) fermer(x - 1)
        if (x0 < 0) {
          x0 = x
          p0 = p
        }
      } else fermer(x - 1)
    }
    fermer(xb - 1)
  }
  return out
}

/**
 * UN SEGMENT ENCORE ÉLIGIBLE — pour le plancher (G-R8a), qui creuse APRÈS l'élection : un karst
 * accepté entre-temps a pu prendre la roche derrière, ou pleurer sa trace sur les pieds.
 */
export function segmentEncoreEligible(champ: ChampDeKarst, s: SegmentDeParoi): boolean {
  for (let x = s.x0; x <= s.x1; x++) if (!piedDeGueule(champ, x, s.y, KARST.ROCHE_MIN)) return false
  return true
}

/** La tuile EST de la gueule principale d'un segment : son milieu, l'ouest à `gx − 1`. */
export function gueuleDuSegment(s: SegmentDeParoi): number {
  return s.x0 + Math.ceil((s.x1 - s.x0 + 1) / 2)
}

const PART_DE = (famille: -1 | 0 | 1): number =>
  famille < 0 ? KARST.PART.calcaire : famille === 0 ? KARST.PART.granite : KARST.PART.argile

/**
 * ═══ (2) L'ÉLECTION, PUIS (3)-(5) LE CREUSEMENT — tous les karsts d'une génération ═══
 *
 * Les segments viennent dans l'ordre des index ; chacun est élu par `hash2(gx, y, 'KARS')`
 * contre la part de sa famille, écarté s'il est à moins de `ESPACEMENT` d'un karst ACCEPTÉ,
 * et n'est accepté que si le creusement réussit (un fond à `FOND_DISTANCE`).
 */
export function creuserLesKarsts(champ: ChampDeKarst): Karst[] {
  const out: Karst[] = []
  const E2 = KARST.ESPACEMENT * KARST.ESPACEMENT
  for (const s of segmentsDeParoiEligibles(champ)) {
    const gx = gueuleDuSegment(s)
    const fam = familleAt(champ.creux, gx, s.y - 2)
    if (hash2(gx, s.y, SEL_KARST) >= PART_DE(fam)) continue
    let trop = false
    for (const k of out) {
      const ge = k.gueules[0]![1]
      const kx = ge % champ.width
      const ky = (ge - kx) / champ.width
      const dx = kx - gx
      const dy = ky - s.y
      if (dx * dx + dy * dy < E2) {
        trop = true
        break
      }
    }
    if (trop) continue
    const k = creuserUnKarst(champ, s, gx)
    if (k) out.push(k)
  }
  return out
}

/**
 * ═══ LE CREUSEMENT D'UN KARST ═══
 *
 * Le tronc d'abord — des boyaux de `BOYAU_LARGEUR` tracés en blocs 2×2 par plus court chemin
 * (gueule → vestibule → cœur → fond, et cœur → second cœur) ; s'il ne passe pas, pas de karst.
 * Puis les salles poussent de leur germe (la recette des caves : le plus petit index du front),
 * dans un rayon déformé par le relief. Puis les gueules secondaires, chacune par un boyau
 * latéral qui s'arrête à la PREMIÈRE tuile déjà creusée — un arbre, jamais une boucle. Enfin la
 * taille : ce qui n'est dans aucun bloc 2×2 tombe, ce qui n'est plus joint à la gueule tombe.
 *
 * Rend `null` si le fond ne peut pas se poser à `FOND_DISTANCE` : la roche ne cède pas.
 */
export function creuserUnKarst(champ: ChampDeKarst, seg: SegmentDeParoi, gx: number): Karst | null {
  const { width, palier, reserve } = champ
  const y = seg.y
  const p = seg.palier
  const niveau = -(p + 1)
  const fam = familleAt(champ.creux, gx, y - 2)
  const h = (n: number): number => hash2(gx, y, (SEL_KARST + n * 0x9e3779b1) | 0)
  const xa = Math.max(0, gx - KARST.BOITE)
  const xb = Math.min(width - 1, gx + KARST.BOITE)
  const ya = Math.max(0, y - KARST.ROCHE_MIN - 8)
  const yb = Math.min(champ.height - 1, y + KARST.RANGEES_SECONDAIRES)
  const permis = (tx: number, ty: number): boolean => {
    if (tx < xa || tx > xb || ty < ya || ty > yb) return false
    const i = ty * width + tx
    return palier[i]! >= p + 1 && reserve[i] !== 1
  }
  // Un NŒUD est le coin haut-gauche d'un bloc 2×2 entièrement permis : le pas d'un boyau.
  const noeud = (tx: number, ty: number): boolean =>
    permis(tx, ty) && permis(tx + 1, ty) && permis(tx, ty + 1) && permis(tx + 1, ty + 1)

  const creuse = new Set<number>()
  const stamp = (chemin: readonly number[]): void => {
    for (const n of chemin) {
      creuse.add(n)
      creuse.add(n + 1)
      creuse.add(n + width)
      creuse.add(n + width + 1)
    }
  }
  const nouvelles = (chemin: readonly number[]): number => {
    let c = 0
    const vu = new Set<number>()
    for (const n of chemin) {
      for (const t of [n, n + 1, n + width, n + width + 1]) {
        if (!creuse.has(t) && !vu.has(t)) {
          vu.add(t)
          c++
        }
      }
    }
    return c
  }

  /**
   * Le plus court chemin entre deux nœuds, en BFS sur les blocs permis — l'ordre des voisins
   * est fixe (nord, vers la cible en x, à l'opposé, sud) : le chemin est le même partout.
   * `arrive` dit où l'on s'arrête (la cible, ou la première tuile creusée pour un latéral),
   * `exclu` retire des nœuds (le vestibule et sa marge, pour les latéraux).
   */
  const chemin = (
    depart: number,
    cible: number,
    arrive: (n: number) => boolean,
    exclu: (n: number) => boolean,
  ): number[] | null => {
    const dxc = depart % width
    const cx = cible % width
    const versX = cx > dxc ? 1 : -1
    const parent = new Map<number, number>()
    parent.set(depart, -1)
    const file: number[] = [depart]
    let tete = 0
    while (tete < file.length) {
      const n = file[tete++]!
      if (n !== depart && arrive(n)) {
        const out: number[] = []
        for (let c = n; c !== -1; c = parent.get(c)!) out.push(c)
        out.reverse()
        return out
      }
      const nx = n % width
      const ny = (n - nx) / width
      for (const [dx, dy] of [[0, -1], [versX, 0], [-versX, 0], [0, 1]] as const) {
        const mx = nx + dx
        const my = ny + dy
        if (!noeud(mx, my)) continue
        const m = my * width + mx
        if (parent.has(m) || exclu(m)) continue
        parent.set(m, n)
        file.push(m)
      }
    }
    return null
  }
  const estCible = (cible: number) => (n: number): boolean => n === cible
  const jamais = (): boolean => false

  // ── Les germes : le vestibule sous la gueule, le cœur et le fond décalés en x par le hachage. ──
  const lat = Math.max(1, Math.min(KARST.LATERAL_MAX, Math.floor((seg.x1 - seg.x0 + 1) / 2) - 2))
  const dxc = Math.round((h(1) * 2 - 1) * lat)
  const dxf = Math.round((h(2) * 2 - 1) * lat)
  const G0 = (y - 2) * width + (gx - 1)
  const V = (y - KARST.PROFONDEUR.vestibule) * width + (gx - 1)
  const C = (y - KARST.PROFONDEUR.coeur) * width + (gx - 1 + dxc)
  const F = (y - KARST.PROFONDEUR.fond) * width + (gx - 1 + dxf)
  if (!noeud(gx - 1, y - 2) || !noeud(V % width, (V - (V % width)) / width)) return null
  const tronc: number[][] = []
  for (const [a, b] of [[G0, V], [V, C], [C, F]] as const) {
    const bx = b % width
    const by = (b - bx) / width
    if (!noeud(bx, by)) return null
    const ch = chemin(a, b, estCible(b), jamais)
    if (!ch) return null
    tronc.push(ch)
    stamp(ch)
  }
  let C2 = -1
  if (h(3) < KARST.COEUR2_PART) {
    const cote = h(4) < 0.5 ? -1 : 1
    const c2x = C % width + cote * (KARST.RAYON.coeur + KARST.RAYON.coeur2 + 2)
    const c2y = y - KARST.PROFONDEUR.coeur2
    if (noeud(c2x, c2y)) {
      const ch = chemin(C, c2y * width + c2x, estCible(c2y * width + c2x), jamais)
      if (ch) {
        C2 = c2y * width + c2x
        tronc.push(ch)
        stamp(ch)
      }
    }
  }

  // ── Les salles : la recette des caves — le plus petit index du front, dans un rayon déformé. ──
  const creuserLaSalle = (germe: number, R: number): number[] => {
    const gxs = germe % width
    const gys = (germe - gxs) / width
    const front: number[] = [germe]
    const vue = new Set<number>([germe])
    const tuiles: number[] = []
    while (front.length > 0 && creuse.size < KARST.TUILES) {
      let bi = 0
      for (let i = 1; i < front.length; i++) if (front[i]! < front[bi]!) bi = i
      const t = front[bi]!
      front[bi] = front[front.length - 1]!
      front.pop()
      tuiles.push(t)
      creuse.add(t)
      const tx = t % width
      const ty = (t - tx) / width
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = tx + dx
        const ny = ty + dy
        const nb = ny * width + nx
        if (vue.has(nb)) continue
        vue.add(nb)
        if (!permis(nx, ny)) continue
        const r = R * (0.75 + 0.5 * fbm2(nx, ny, 6, SEL_FORME))
        const ddx = nx - gxs
        const ddy = ny - gys
        if (ddx * ddx + ddy * ddy <= r * r) front.push(nb)
      }
    }
    return tuiles
  }
  const salles: SalleDeKarst[] = [
    { role: 'vestibule', germe: V, tuiles: creuserLaSalle(V, KARST.RAYON.vestibule) },
    { role: 'fond', germe: F, tuiles: creuserLaSalle(F, KARST.RAYON.fond) },
    { role: 'coeur', germe: C, tuiles: creuserLaSalle(C, KARST.RAYON.coeur) },
  ]
  if (C2 >= 0) salles.push({ role: 'coeur', germe: C2, tuiles: creuserLaSalle(C2, KARST.RAYON.coeur2) })

  // ── Les gueules : la principale, puis les secondaires par un boyau latéral. ──
  const gueules: [number, number][] = [[y * width + gx - 1, y * width + gx]]
  creuse.add(y * width + gx - 1)
  creuse.add(y * width + gx)
  const vestibule = new Set(salles[0]!.tuiles)
  const pres = (t: number, ens: ReadonlySet<number>, marge: number): boolean => {
    const tx = t % width
    const ty = (t - tx) / width
    for (let dy = -marge; dy <= marge; dy++) {
      for (let dx = -marge; dx <= marge; dx++) if (ens.has((ty + dy) * width + tx + dx)) return true
    }
    return false
  }
  const horsVestibule = (n: number): boolean =>
    pres(n, vestibule, 1) || pres(n + 1, vestibule, 1) || pres(n + width, vestibule, 1) || pres(n + width + 1, vestibule, 1)
  const toucheLeCreux = (n: number): boolean => {
    for (const t of [n, n + 1, n + width, n + width + 1]) {
      if (creuse.has(t)) return true
      if (creuse.has(t - 1) || creuse.has(t + 1) || creuse.has(t - width) || creuse.has(t + width)) return true
    }
    return false
  }
  // La face d'une terrasse est un ESCALIER de cellules (le palier est constant par cellule de
  // 8) : un segment d'une rangée fait souvent huit pieds, trop court pour deux gueules. Les
  // gueules secondaires cherchent donc leur pied sur toute la face — à `RANGEES_SECONDAIRES` de
  // la principale, de part et d'autre — au plus près d'abord, jamais à moins de `GUEULES_ECART`.
  const ecartOk = (x: number, yy: number): boolean => {
    for (const [o, e] of gueules) {
      const ox = o % width
      const oy = (o - ox) / width
      if (Math.max(Math.abs(ox - (x - 1)), Math.abs(oy - yy)) < KARST.GUEULES_ECART) return false
      if (Math.max(Math.abs(e % width - x), Math.abs(oy - yy)) < KARST.GUEULES_ECART) return false
    }
    return true
  }
  const cible = 2 + Math.floor(h(5) * (KARST.GUEULES_MAX - 1))
  const candidats: { x: number; y: number; d: number }[] = []
  for (let yy = Math.max(1, y - KARST.RANGEES_SECONDAIRES); yy <= Math.min(champ.height - 1, y + KARST.RANGEES_SECONDAIRES); yy++) {
    for (let x = xa + 2; x <= xb - 1; x++) {
      if (palier[yy * width + x]! !== p) continue
      if (!piedDeGueule(champ, x - 1, yy, KARST.ROCHE_SECONDAIRE) || !piedDeGueule(champ, x, yy, KARST.ROCHE_SECONDAIRE)) continue
      if (palier[yy * width + x - 1]! !== p) continue
      candidats.push({ x, y: yy, d: Math.abs(x - gx) + 2 * Math.abs(yy - y) })
    }
  }
  candidats.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
  const laterales: number[][] = []
  for (const c of candidats) {
    if (gueules.length >= cible) break
    const sx = c.x
    const sy = c.y
    if (!ecartOk(sx, sy)) continue
    // Le fond reste un fond : une gueule qui rapprocherait la tanière de la surface cède.
    if (Math.max(Math.abs(sx - F % width), Math.abs(sy - (F - (F % width)) / width)) < KARST.FOND_DISTANCE + KARST.RAYON.fond) continue
    const o = sy * width + sx - 1
    if (creuse.has(o) || creuse.has(o + 1)) continue
    const depart = (sy - 2) * width + (sx - 1)
    if (!noeud(sx - 1, sy - 2) || horsVestibule(depart)) continue
    const ch = chemin(depart, C, toucheLeCreux, horsVestibule)
    if (!ch) continue
    if (creuse.size + nouvelles(ch) + 2 > KARST.TUILES) continue
    stamp(ch)
    laterales.push(ch)
    creuse.add(o)
    creuse.add(o + 1)
    gueules.push([o, o + 1])
  }

  // ── La taille : tout bloc 2×2 ou rien, puis la jointure à la gueule principale. ──
  const dansUnBloc = (t: number): boolean => {
    for (const oy of [0, -width]) {
      for (const ox of [0, -1]) {
        const c = t + ox + oy
        if (creuse.has(c) && creuse.has(c + 1) && creuse.has(c + width) && creuse.has(c + width + 1)) return true
      }
    }
    return false
  }
  for (;;) {
    const tombe = [...creuse].sort((a, b) => a - b).filter((t) => !dansUnBloc(t))
    if (tombe.length === 0) break
    for (const t of tombe) creuse.delete(t)
  }
  const joint = new Set<number>()
  {
    const file = [gueules[0]![1]]
    if (creuse.has(file[0]!)) joint.add(file[0]!)
    let tete = 0
    while (tete < file.length) {
      const t = file[tete++]!
      for (const nb of [t - 1, t + 1, t - width, t + width]) {
        if (creuse.has(nb) && !joint.has(nb)) {
          joint.add(nb)
          file.push(nb)
        }
      }
    }
  }
  const tuiles = [...joint].sort((a, b) => a - b)
  if (tuiles.length === 0) return null
  const gueulesJointes = gueules.filter(([o, e]) => joint.has(o) && joint.has(e))
  if (gueulesJointes.length === 0 || gueulesJointes[0] !== gueules[0]) return null
  const dedans = (t: number): boolean => joint.has(t)
  for (const s of salles) s.tuiles = s.tuiles.filter(dedans).sort((a, b) => a - b)

  // ── (4) La nappe : le tiers bas de chaque salle, un creux au point bas et sa couronne. ──
  const eau = new Map<number, number>() // tuile → SHALLOW | DEEP
  const gueuleSet = new Set<number>()
  for (const [o, e] of gueulesJointes) {
    gueuleSet.add(o)
    gueuleSet.add(e)
  }
  const relief = (t: number): number => reliefDeCave(t % width, (t - (t % width)) / width)
  // Le PAS des boyaux — les blocs du tronc et des latéraux : la nappe ne le ferme jamais.
  const pas = new Set<number>()
  for (const ch of [...tronc, ...laterales]) {
    for (const n of ch) for (const t of [n, n + 1, n + width, n + width + 1]) pas.add(t)
  }
  const interieur = (t: number): boolean =>
    joint.has(t - 1) && joint.has(t + 1) && joint.has(t - width) && joint.has(t + width) && !gueuleSet.has(t)
  const bassinDe = (s: SalleDeKarst, part: number): { graine: number; bassin: number[] } => {
    // La graine du bassin : le point bas INTÉRIEUR de la salle, hors du pas du boyau — c'est ce
    // qui garantit un creux (ses quatre voisins sont d'eau) sans fermer le passage.
    let graine = -1
    for (const t of s.tuiles) {
      if (!interieur(t) || pas.has(t)) continue
      if (graine < 0 || relief(t) < relief(graine)) graine = t
    }
    if (graine < 0) return { graine, bassin: [] }
    const vise = Math.max(1, Math.floor(s.tuiles.length / part))
    const dans = new Set(s.tuiles)
    const bassin = new Set<number>([graine])
    const front = new Set<number>()
    const pousser = (t: number): void => {
      for (const nb of [t - 1, t + 1, t - width, t + width]) if (dans.has(nb) && !bassin.has(nb)) front.add(nb)
    }
    pousser(graine)
    while (bassin.size < vise && front.size > 0) {
      let meilleur = -1
      for (const t of [...front].sort((a, b) => a - b)) {
        if (meilleur < 0 || relief(t) < relief(meilleur)) meilleur = t
      }
      front.delete(meilleur)
      bassin.add(meilleur)
      pousser(meilleur)
    }
    return { graine, bassin: [...bassin].sort((a, b) => a - b) }
  }
  const noye = fam < 0
  if (noye) {
    for (const s of salles) {
      const { graine, bassin } = bassinDe(s, KARST.BASSIN)
      if (bassin.length === 0) continue
      const b = new Set(bassin)
      // La couronne autour du creux : ses quatre voisins sont d'eau, donc le creux est profond.
      for (const nb of [graine - 1, graine + 1, graine - width, graine + width]) if (joint.has(nb) && !gueuleSet.has(nb)) b.add(nb)
      // Le creux ne prend jamais le PAS du boyau (les blocs du tronc et des latéraux) : la nappe
      // s'étale autour du passage, elle ne le ferme pas — on traverse la salle à gué.
      for (const t of [...b].sort((a, c) => a - c)) {
        const profond = !pas.has(t) && b.has(t - 1) && b.has(t + 1) && b.has(t - width) && b.has(t + width)
        eau.set(t, profond ? TERRAIN_DEEP_WATER : TERRAIN_SHALLOW_WATER)
      }
    }
    // Le fil d'eau : une tuile de large le long de chaque boyau, jusqu'à la gueule.
    const fil = (t: number): void => {
      if (joint.has(t) && !gueuleSet.has(t) && !eau.has(t)) eau.set(t, TERRAIN_SHALLOW_WATER)
    }
    for (const ch of tronc) for (const n of ch) fil(n)
    for (const ch of laterales) for (const n of ch) fil(n)
    for (const [o] of gueulesJointes) fil(o - width)
    // D'UN SEUL TENANT (G-R4) : les bassins sont RELIÉS par du peu profond. Le fil suit le pas des
    // boyaux, la graine d'un bassin en est écartée — un bassin peut donc naître à côté du fil sans
    // le toucher. On raccorde chaque nappe isolée par le plus court chemin de haut-fond jusqu'à
    // l'eau qui sort par la gueule principale ; du peu profond, donc toujours marchable.
    const composante = (depart: number): Set<number> => {
      const c = new Set<number>([depart])
      const f = [depart]
      let tete = 0
      while (tete < f.length) {
        const t = f[tete++]!
        for (const nb of [t - 1, t + 1, t - width, t + width]) if (eau.has(nb) && !c.has(nb)) { c.add(nb); f.push(nb) }
      }
      return c
    }
    for (;;) {
      const principale = composante(gueulesJointes[0]![0]! - width)
      let orphelin = -1
      for (const t of tuiles) if (eau.has(t) && !principale.has(t)) { orphelin = t; break }
      if (orphelin < 0) break
      const ilot = composante(orphelin)
      const parent = new Map<number, number>()
      const f = [...ilot].sort((a, b) => a - b)
      for (const t of f) parent.set(t, -1)
      let tete = 0
      let joint2 = -1
      while (tete < f.length && joint2 < 0) {
        const t = f[tete++]!
        for (const nb of [t - width, t - 1, t + 1, t + width]) {
          if (!joint.has(nb) || gueuleSet.has(nb) || parent.has(nb)) continue
          parent.set(nb, t)
          if (principale.has(nb)) { joint2 = nb; break }
          f.push(nb)
        }
      }
      if (joint2 < 0) return null // une nappe qu'aucun chemin ne rejoint : le réseau est cassé
      for (let t = parent.get(joint2)!; t >= 0 && !ilot.has(t); t = parent.get(t)!) eau.set(t, TERRAIN_SHALLOW_WATER)
    }
    // Le creux ne ferme jamais un passage : ce qui n'est plus joint à pied fait remonter le creux.
    for (;;) {
      const marche = new Set<number>()
      const file = [gueulesJointes[0]![1]]
      marche.add(file[0]!)
      let tete = 0
      while (tete < file.length) {
        const t = file[tete++]!
        for (const nb of [t - 1, t + 1, t - width, t + width]) {
          if (joint.has(nb) && !marche.has(nb) && eau.get(nb) !== TERRAIN_DEEP_WATER) {
            marche.add(nb)
            file.push(nb)
          }
        }
      }
      const isoles = new Set<number>()
      for (const t of tuiles) if (!marche.has(t) && eau.get(t) !== TERRAIN_DEEP_WATER) isoles.add(t)
      if (isoles.size === 0) break
      // Ce qui bloque est le creux ENTRE ce qu'on atteint et ce qu'on n'atteint pas : lui seul
      // remonte — le creux du fond, derrière, reste profond. Un mur de deux creux d'épais se pèle
      // du côté isolé.
      const touche = (t: number, ens: ReadonlySet<number>): boolean =>
        ens.has(t - 1) || ens.has(t + 1) || ens.has(t - width) || ens.has(t + width)
      let leve = 0
      for (const t of tuiles) {
        if (eau.get(t) === TERRAIN_DEEP_WATER && touche(t, marche) && touche(t, isoles)) {
          eau.set(t, TERRAIN_SHALLOW_WATER)
          leve++
        }
      }
      if (leve === 0) {
        for (const t of tuiles) {
          if (eau.get(t) === TERRAIN_DEEP_WATER && touche(t, isoles)) {
            eau.set(t, TERRAIN_SHALLOW_WATER)
            leve++
          }
        }
      }
      if (leve === 0) return null // une salle isolée sans creux devant : le réseau est cassé, on ne creuse pas
    }
  } else if (fam === 0 && h(9) < KARST.FLAQUE_PART) {
    const coeur = salles.find((s) => s.role === 'coeur')
    if (coeur) for (const t of bassinDe(coeur, KARST.FLAQUE).bassin) eau.set(t, TERRAIN_SHALLOW_WATER)
  }

  // ── Le fond : la tuile sèche la plus loin (Chebyshev) de toute gueule ; à FOND_DISTANCE, ou rien. ──
  const distGueule = (t: number): number => {
    const tx = t % width
    const ty = (t - tx) / width
    let d = Infinity
    for (const g of gueuleSet) {
      const gx2 = g % width
      const gy2 = (g - gx2) / width
      const dd = Math.max(Math.abs(gx2 - tx), Math.abs(gy2 - ty))
      if (dd < d) d = dd
    }
    return d
  }
  let fond = -1
  let dFond = -1
  for (const t of tuiles) {
    if (gueuleSet.has(t) || eau.has(t)) continue
    const d = distGueule(t)
    if (d > dFond) {
      dFond = d
      fond = t
    }
  }
  if (fond < 0 || dFond < KARST.FOND_DISTANCE) return null

  // ── Accepté : la roche est prise, le terrain de l'étage se fixe, la trace se peint. ──
  for (const t of tuiles) reserve[t] = 1
  const terrainK: number[] = tuiles.map((t) => {
    const w = eau.get(t)
    if (w !== undefined) return w
    const tx = t % width
    return terrainDeCave(tx, (t - tx) / width)
  })
  const enSalle = new Set<number>()
  for (const s of salles) for (const t of s.tuiles) enSalle.add(t)
  const boyaux = tuiles.filter((t) => !enSalle.has(t) && !gueuleSet.has(t))
  const trace = noye ? tracerLaResurgence(champ, gueulesJointes[0]!, p) : []
  return {
    palier: p,
    niveau,
    famille: fam,
    gueules: gueulesJointes,
    tuiles,
    terrain: terrainK,
    salles: salles.filter((s) => s.tuiles.length > 0),
    boyaux,
    fond,
    trace,
    noye,
    plancher: false,
  }
}

/**
 * ═══ (5) LA TRACE DU KARST NOYÉ (G-R9) ═══
 *
 * Le fil d'eau ressort au pied de la gueule et descend : `TRACE_EAU` tuiles d'eau peu profonde
 * sur `map.terrain`, de proche en proche vers la cellule la plus basse du socle (`altLarge`), à
 * plat s'il le faut, jamais en remontant — et la flaque s'étale sur place (trois tuiles au moins)
 * si la pente est inverse. Une tuile de trace est du sol marchable du palier `p`, ni sente, ni
 * connecteur, ni lieu, ni réservée, et n'a AUCUN voisin de sol marchable d'un palier plus bas :
 * l'eau naît sur l'escalier (T-A11) et la trace ne la fait pas descendre d'une marche.
 */
function tracerLaResurgence(champ: ChampDeKarst, gueule: [number, number], p: number): number[] {
  const { terrain, width, height, palier, reserve, lieux, portes, creux } = champ
  const trace: number[] = []
  const pris = new Set<number>(gueule)
  const valide = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false
    const i = ty * width + tx
    if (pris.has(i) || reserve[i] === 1 || lieux[i] === 1 || portes.has(i)) return false
    const t = terrain[i]!
    if (MARCHABLE[t] !== 1 || isWater(t) || t === TERRAIN_ROAD) return false
    if (palier[i]! !== p) return false
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = tx + dx
      const ny = ty + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      const u = terrain[j]!
      if (palier[j]! < p && MARCHABLE[u] === 1 && !isWater(u)) return false
    }
    return true
  }
  const alt = (i: number): number => altitudeAt(creux, i % width, (i - (i % width)) / width)
  // Le pas : parmi les voisins valides, le plus bas ; à égalité le sud, puis le plus petit index.
  const suivant = (depuis: readonly number[]): number => {
    let meilleur = -1
    let sud = false
    for (const d of depuis) {
      const dx0 = d % width
      const dy0 = (d - dx0) / width
      for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]] as const) {
        const nx = dx0 + dx
        const ny = dy0 + dy
        if (!valide(nx, ny)) continue
        const j = ny * width + nx
        const jSud = dy === 1
        if (meilleur < 0 || alt(j) < alt(meilleur) || (alt(j) === alt(meilleur) && ((jSud && !sud) || (jSud === sud && j < meilleur)))) {
          meilleur = j
          sud = jSud
        }
      }
    }
    return meilleur
  }
  let courant: readonly number[] = gueule
  let altCourante = Math.min(alt(gueule[0]), alt(gueule[1]))
  while (trace.length < KARST.TRACE_EAU) {
    const j = suivant(courant)
    if (j < 0 || alt(j) > altCourante) break
    trace.push(j)
    pris.add(j)
    courant = [j]
    altCourante = alt(j)
  }
  // La flaque sur place : au moins trois tuiles, prises de proche en proche au pied de la gueule.
  if (trace.length < 3) {
    const file: number[] = [...gueule, ...trace]
    let tete = 0
    while (tete < file.length && trace.length < 3) {
      const t = file[tete++]!
      const tx = t % width
      const ty = (t - tx) / width
      for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]] as const) {
        if (trace.length >= 3) break
        const nx = tx + dx
        const ny = ty + dy
        if (!valide(nx, ny)) continue
        const j = ny * width + nx
        trace.push(j)
        pris.add(j)
        file.push(j)
      }
    }
  }
  for (const t of trace) terrain[t] = TERRAIN_SHALLOW_WATER
  return trace
}

/**
 * ═══ LA PIERRE DU CŒUR (G-R5) — les tuiles élues pour un nœud de pierre ═══
 *
 * Un nœud par `PIERRE` tuiles creusées, dans les salles du cœur, hors eau : les tuiles au plus
 * petit hachage `'PIER'` gagnent. Chaque élue dit si elle porte un rocher ou un bloc (`'BLOC'`,
 * un tiers de blocs). Le semis (`zone-content.ts`) en fait des `ResourceNode` à l'étage du karst.
 */
export function pierreDuKarst(k: Karst, width: number): { tuile: number; bloc: boolean }[] {
  const n = Math.floor(k.tuiles.length / KARST.PIERRE)
  if (n === 0) return []
  const terrainDe = new Map<number, number>()
  for (let i = 0; i < k.tuiles.length; i++) terrainDe.set(k.tuiles[i]!, k.terrain[i]!)
  const candidats: { tuile: number; h: number }[] = []
  for (const s of k.salles) {
    if (s.role !== 'coeur') continue
    for (const t of s.tuiles) {
      if (isWater(terrainDe.get(t)!)) continue
      const tx = t % width
      candidats.push({ tuile: t, h: hash2(tx, (t - tx) / width, SEL_PIERRE) })
    }
  }
  candidats.sort((a, b) => a.h - b.h || a.tuile - b.tuile)
  return candidats.slice(0, n).map(({ tuile }) => {
    const tx = tuile % width
    return { tuile, bloc: hash2(tx, (tuile - tx) / width, SEL_BLOC) < 1 / 3 }
  }).sort((a, b) => a.tuile - b.tuile)
}
