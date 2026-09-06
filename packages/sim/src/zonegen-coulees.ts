/**
 * LES COULÉES — les petits chemins de terre du gibier (spec forets-vivantes §4 R5).
 *
 * Chaque massif boisé de la Racine dont le CŒUR est à portée d'eau porte UNE coulée : le
 * chemin entre sa couche (le pic d'érosion — le patron de la couronne) et l'eau la plus
 * proche. Les bois secs n'en ont AUCUNE — pas d'eau, pas de gibier, pas de chemin : la
 * grammaire humide/giboyeux vs sec/silencieux gagne un lecteur au sol.
 *
 * QUADRUPLE DÉRIVATION, rien de posé : le massif vient des composantes du masque boisé
 * (le masque exact de `deriverProfondeur`), le départ est le pic d'érosion, l'arrivée est
 * l'eau réelle (BFS multi-source — le champ que la faune raconte : « l'eau commande »),
 * et le tracé DESCEND ce champ en préférant, à distance égale, la cellule la plus BASSE
 * du socle : le chemin suit le fond de vallon, jamais la ligne droite au cordeau.
 *
 * LE CHAMP EST ADDITIF, JAMAIS UNE REPEINTURE (R5bis) : une ligne non boisée à travers un
 * massif percerait l'érosion et tuerait le cœur qui a fait naître la coulée (la garde A19
 * de §2quater est le mur). `map.coulees` : les index de tuile des chemins, DANS L'ORDRE
 * (couche → eau), les chemins séparés par -1 — le rendu lit l'usure en pente continue sur
 * cette position, les gardes lisent les bornes. La liste dit le chemin ENTIER, sentes
 * comprises (un chemin peut en longer une) — c'est le DÉCAL qui s'interrompt sur la route,
 * pas le fait ; la stérilité d'une tuile de route est déjà acquise ; la stérilité des nœuds se
 * joue dans `placeZoneNodes` (les tuiles de coulée ensemencent les `occupees` de toutes
 * les passes — une passe future l'hérite sans y penser).
 *
 * Pur et déterministe : AUCUN tirage — BFS à coûts unitaires, descente à départages
 * écrits (distance, puis altitude du socle, puis premier index row-major).
 */
import { TERRAIN_ROAD } from './balance'
import { isWater, MARCHABLE } from './map'
import { composantesDeMasque, eroderMasque, TERRAINS_BOISES_MASSIF } from './profondeur'
import { altitudeAt, CREUX, type Creux } from './racine-relief'
import type { GrapheZones } from './zonegraph'

/** Les quatre voisins, dans l'ordre historique (E, O, S, N) — hissés : le champ les lit un million de fois. */
const VOISINS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export const COULEES = {
  /** Portée d'eau du gibier, en tuiles : un massif dont le PIC est plus loin que ça de
   *  toute eau est un bois SEC — pas de coulée. */
  PORTEE_EAU: 60,
  /** Taille minimale du cœur d'un massif pour mériter une coulée (en tuiles à d ≥
   *  PROF_COEUR) : un bosquet n'a pas de couche, il n'a pas de chemin. */
  COEUR_MIN: 40,
} as const

/**
 * LE CHAMP DE DESCENTE de la Racine — la distance BFS à l'eau sur la terre marchable, et LA
 * descente qui le suit pas à pas. Partagé entre les coulées de génération (`tracerLesCoulees`)
 * et celles posées APRÈS coup par les grottes du plancher (`tracerLesCouleesDepuis`, spec
 * `grottes.md` G-R8/G-R9) : même champ, même descente, mêmes départages — une coulée de grotte
 * est une coulée de coin, tracée plus tard.
 */
function champDeDescente(
  terrain: readonly number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  creux: Creux | null,
): {
  dEau: Int32Array
  descendre: (depart: number) => number[] | null
  INF: number
  /** Remplit le champ dans une boîte (bornes INCLUSES, rognées à la carte) ; rend les tuiles touchées. */
  remplir: (x0: number, y0: number, x1: number, y1: number) => Int32Array
} | null {
  const racineId = g.racine
  const r = g.zones[racineId]!.rect
  if (!r) return null
  const N = width * height

  // ── LE CHAMP D'EAU : BFS multi-source sur la terre marchable de la Racine (4-connexe :
  //    la descente a besoin d'un voisin à d-1 exactement). Une passe, tous les massifs — ou,
  //    pour une coulée posée après coup, une BOÎTE autour de son départ (`tracerLesCouleesDepuis`)
  //    : le champ y est EXACT partout où la descente lit (voir là-bas la preuve), et on ne
  //    paie pas 1,2 M de tuiles pour un chemin de soixante. ──
  const INF = 0x7fffffff
  const dEau = new Int32Array(N).fill(INF)
  const file = new Int32Array(N)
  const remplir = (bx0: number, by0: number, bx1: number, by1: number): Int32Array => {
    const xa = Math.max(0, bx0)
    const ya = Math.max(0, by0)
    const xb = Math.min(width - 1, bx1)
    const yb = Math.min(height - 1, by1)
    let tete = 0
    let queue = 0
    for (let y = Math.max(ya, r.y); y < Math.min(yb + 1, r.y + r.h); y++) {
      for (let x = Math.max(xa, r.x); x < Math.min(xb + 1, r.x + r.w); x++) {
        const i = y * width + x
        if (zone[i] !== racineId || MARCHABLE[terrain[i]!] !== 1 || isWater(terrain[i]!)) continue
        let bord = false
        for (const [dx, dy] of VOISINS4) {
          const t = terrain[(y + dy) * width + (x + dx)]
          if (t !== undefined && isWater(t)) {
            bord = true
            break
          }
        }
        if (bord) {
          dEau[i] = 1
          file[queue++] = i
        }
      }
    }
    while (tete < queue) {
      const i = file[tete++]!
      const d = dEau[i]!
      const x = i % width
      const y = (i - x) / width
      for (const [dx, dy] of VOISINS4) {
        const nx = x + dx
        const ny = y + dy
        if (nx < xa || ny < ya || nx > xb || ny > yb) continue
        const j = ny * width + nx
        if (dEau[j] !== INF || zone[j] !== racineId) continue
        if (MARCHABLE[terrain[j]!] !== 1 || isWater(terrain[j]!)) continue
        dEau[j] = d + 1
        file[queue++] = j
      }
    }
    return file.subarray(0, queue)
  }


  const alt = (i: number): number => {
    if (!creux) return 0
    const x = i % width
    return altitudeAt(creux, x, (i - x) / width)
  }

  // ── LA DESCENTE : d'un départ vers l'eau, un pas de d-1 à chaque fois ; à égalité, la
  //    cellule la plus basse du socle (le vallon), puis le premier index row-major. ──
  const descendre = (depart: number): number[] | null => {
    const chemin: number[] = []
    let i = depart
    let garde = 0
    while (dEau[i]! > 1 && garde < COULEES.PORTEE_EAU + 8) {
      garde += 1
      const x = i % width
      const y = (i - x) / width
      let suivant = -1
      for (const [dx, dy] of VOISINS4) {
        const j = (y + dy) * width + (x + dx)
        if (dEau[j] !== dEau[i]! - 1) continue
        // À égalité de distance : hors-sente d'abord (le gibier longe la route, il ne la
        // suit pas), puis le vallon (l'altitude), puis le premier index row-major.
        if (suivant === -1) {
          suivant = j
          continue
        }
        const jSente = terrain[j] === TERRAIN_ROAD
        const sSente = terrain[suivant] === TERRAIN_ROAD
        if (jSente !== sSente) {
          if (!jSente) suivant = j
          continue
        }
        if (alt(j) < alt(suivant) || (alt(j) === alt(suivant) && j < suivant)) suivant = j
      }
      if (suivant === -1) return null // un cul-de-sac du champ : pas de coulée forcée
      i = suivant
      chemin.push(i) // la liste dit le chemin ENTIER — sente comprise : c'est un fait de tracé
    }
    if (chemin.length === 0 || dEau[i]! > 1) return null
    return chemin
  }

  return { dEau, descendre, INF, remplir }
}

/**
 * LES COULÉES DES DÉPARTS (grottes G-R9, karst SEC) : depuis chaque tuile de départ, la descente
 * des coins — rend la liste au format `map.coulees` (chemins séparés par -1), vide si aucune.
 * Un départ hors du champ (roche, eau, hors Racine) ou dont l'eau est hors de portée se tait.
 */
export function tracerLesCouleesDepuis(
  terrain: readonly number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  creux: Creux | null,
  departs: readonly number[],
): number[] {
  const champ = champDeDescente(terrain, zone, g, width, height, creux)
  if (!champ) return []
  const { dEau, descendre, INF, remplir } = champ
  // LA BOÎTE, ET POURQUOI ELLE REND LE MÊME CHEMIN QUE LE CHAMP ENTIER : la descente ne part que
  // si `dEau ≤ PORTEE_EAU`, fait au plus `PORTEE_EAU + 8` pas, et ne lit que ses voisins. Une
  // tuile visitée est donc à ≤ P + 8 du départ (Chebyshev), son eau à ≤ P de plus ; un voisin à
  // d − 1 a la sienne plus près encore. Dans une boîte de demi-côté 2P + 9, toute valeur lue est
  // EXACTE ; hors de portée, une BFS rognée ne peut que SURESTIMER, jamais fabriquer un « d − 1 ».
  // MESURÉ : 662 ms pour le champ entier, une boîte vaut moins d'une tuile de 257².
  const demi = 2 * COULEES.PORTEE_EAU + 9
  const out: number[] = []
  for (const i0 of departs) {
    if (i0 < 0 || i0 >= dEau.length) continue
    const x0 = i0 % width
    const y0 = (i0 - x0) / width
    const touchees = remplir(x0 - demi, y0 - demi, x0 + demi, y0 + demi)
    if (dEau[i0]! !== INF && dEau[i0]! <= COULEES.PORTEE_EAU) {
      const chemin = descendre(i0)
      if (chemin) {
        if (out.length > 0) out.push(-1)
        for (const t of chemin) out.push(t)
      }
    }
    for (const t of touchees) dEau[t] = INF
  }
  return out
}

/**
 * Trace les coulées de la Racine. Rend la liste d'index (chemins séparés par -1), vide si
 * aucune — le champ ne s'écrit alors pas (patron `fil`).
 */
export function tracerLesCoulees(
  terrain: readonly number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  profondeur: readonly number[],
  creux: Creux | null,
  /** LES COINS DE CHASSE (faune R24/R26) : chacun sème SA descente gagnage → eau. */
  coins: readonly { x: number; y: number }[] = [],
): number[] {
  const champ = champDeDescente(terrain, zone, g, width, height, creux)
  if (!champ) return []
  const { dEau, descendre, INF } = champ
  champ.remplir(0, 0, width - 1, height - 1)
  const racineId = g.racine
  const N = width * height

  // ── L'ÉLECTION : chaque massif boisé à cœur (le masque exact de la profondeur), son pic. ──
  const boise = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (zone[i] === racineId && TERRAINS_BOISES_MASSIF.includes(terrain[i]!)) boise[i] = 1
  }
  const comp = composantesDeMasque(boise, width, height)
  const prof = profondeur.length === N ? profondeur : eroderMasque(boise, width, height, CREUX.PROF_CAP)
  const coeurs = new Array<number>(comp.tailles.length).fill(0)
  const pics = new Array<number>(comp.tailles.length).fill(-1)
  for (let i = 0; i < N; i++) {
    const c = comp.label[i]!
    if (c === -1) continue
    if (prof[i]! >= CREUX.PROF_COEUR) coeurs[c]! += 1
    if (pics[c]! === -1 || prof[i]! > prof[pics[c]!]!) pics[c] = i
  }

  const out: number[] = []
  const pose = (chemin: number[]): void => {
    if (out.length > 0) out.push(-1)
    for (const t of chemin) out.push(t)
  }
  for (let c = 0; c < comp.tailles.length; c++) {
    if (coeurs[c]! < COULEES.COEUR_MIN) continue //   un bosquet n'a pas de couche
    const pic = pics[c]!
    if (pic < 0 || dEau[pic]! === INF || dEau[pic]! > COULEES.PORTEE_EAU) continue // le bois SEC se tait
    const chemin = descendre(pic)
    if (chemin) pose(chemin)
  }

  // ── LES COULÉES DES COINS (faune R24/R26, décision d'Alexis 2026-08-28). Les coulées
  //    de massif partent des CŒURS de forêt — et les coins de chasse vivent ailleurs :
  //    MESURÉ sur deux graines du monde joué, fins d'eau à 28-448 tuiles du coin le plus
  //    proche, l'attache de `couleeStep` ne prenait JAMAIS. Le boire du crépuscule
  //    (chasse R5quater) et les empreintes (R24) étaient lettre morte. Chaque coin sème
  //    donc SA descente gagnage → eau — même champ, même descente, mêmes départages :
  //    le chemin que les hardes marcheront vraiment. Un coin dont l'eau BFS est hors de
  //    portée (falaise entre deux) se tait, comme un bois sec. ──
  for (const coin of coins) {
    const tx = Math.floor(coin.x)
    const ty = Math.floor(coin.y)
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
    const i0 = ty * width + tx
    if (dEau[i0]! === INF || dEau[i0]! > COULEES.PORTEE_EAU) continue
    const chemin = descendre(i0)
    if (chemin) pose(chemin)
  }
  return out
}
