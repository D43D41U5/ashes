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

export const COULEES = {
  /** Portée d'eau du gibier, en tuiles : un massif dont le PIC est plus loin que ça de
   *  toute eau est un bois SEC — pas de coulée. */
  PORTEE_EAU: 60,
  /** Taille minimale du cœur d'un massif pour mériter une coulée (en tuiles à d ≥
   *  PROF_COEUR) : un bosquet n'a pas de couche, il n'a pas de chemin. */
  COEUR_MIN: 40,
} as const

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
): number[] {
  const racineId = g.racine
  const r = g.zones[racineId]!.rect
  if (!r) return []
  const N = width * height

  // ── LE CHAMP D'EAU : BFS multi-source sur la terre marchable de la Racine (4-connexe :
  //    la descente a besoin d'un voisin à d-1 exactement). Une passe, tous les massifs. ──
  const INF = 0x7fffffff
  const dEau = new Int32Array(N).fill(INF)
  const file = new Int32Array(N)
  let tete = 0
  let queue = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * width + x
      if (zone[i] !== racineId || MARCHABLE[terrain[i]!] !== 1 || isWater(terrain[i]!)) continue
      let bord = false
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
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
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (dEau[j] !== INF || zone[j] !== racineId) continue
      if (MARCHABLE[terrain[j]!] !== 1 || isWater(terrain[j]!)) continue
      dEau[j] = d + 1
      file[queue++] = j
    }
  }

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

  const alt = (i: number): number => {
    if (!creux) return 0
    const x = i % width
    return altitudeAt(creux, x, (i - x) / width)
  }

  const out: number[] = []
  for (let c = 0; c < comp.tailles.length; c++) {
    if (coeurs[c]! < COULEES.COEUR_MIN) continue //   un bosquet n'a pas de couche
    const pic = pics[c]!
    if (pic < 0 || dEau[pic]! === INF || dEau[pic]! > COULEES.PORTEE_EAU) continue // le bois SEC se tait
    // ── LA DESCENTE : du pic vers l'eau, un pas de d-1 à chaque fois ; à égalité, la
    //    cellule la plus basse du socle (le vallon), puis le premier index row-major. ──
    const chemin: number[] = []
    let i = pic
    let garde = 0
    while (dEau[i]! > 1 && garde < COULEES.PORTEE_EAU + 8) {
      garde += 1
      const x = i % width
      const y = (i - x) / width
      let suivant = -1
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
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
      if (suivant === -1) break // un cul-de-sac du champ : pas de coulée forcée
      i = suivant
      chemin.push(i) // la liste dit le chemin ENTIER — sente comprise : c'est un fait de tracé
    }
    if (chemin.length === 0 || dEau[i]! > 1) continue
    if (out.length > 0) out.push(-1)
    for (const t of chemin) out.push(t)
  }
  return out
}
