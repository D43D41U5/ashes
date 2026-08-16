/**
 * LA PROFONDEUR INTRA-MASSIF (spec t0-exploration §2quater R38-R39).
 *
 * Par tuile : la distance (Chebyshev — érosion 8-connexe) au bord de son massif BOISÉ de la
 * Racine, plafonnée à `CREUX.PROF_CAP`. Zéro partout ailleurs. Les BANDES (lisière, corps,
 * cœur) se DÉRIVENT du champ, elles ne sont jamais stockées à part.
 *
 * DEUX PROPRIÉTÉS QUI SONT DES CONTRATS :
 * - **Aucun bruit** : deux érosions du même terrain rendent le même champ, au nombre près.
 * - **Gelée à l'amorce** : le champ se calcule UNE fois à la génération et persiste avec la
 *   carte (le patron du champ de cendre — donnée STATIQUE, `carte-immuable` la garde). Le feu
 *   qui ronge un bord ne recalcule rien ; mais un BONUS ne s'applique jamais sur une tuile qui
 *   n'est plus boisée — l'étiquette survit, inerte ; le bonus meurt avec l'arbre (R38).
 *
 * Les clairières ne percent PAS la profondeur : leur terrain reste boisé — ce sont des
 * chambres DANS la masse, pas des trouées de lisière.
 */
import {
  TERRAIN_FOREST,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_WILLOW,
} from './balance'
import { CREUX } from './racine-relief'

/** Les terrains qui font MASSE — le masque de l'érosion. Une seule liste, trois lecteurs
 *  (dérivation, stock d'arbre, couvert effectif) : jamais trois listes. */
export const TERRAINS_BOISES_MASSIF: readonly number[] = [
  TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_WILLOW,
]

/** 1 ≤ d ≤ PROF_LISIERE — le bord pénétrable du bois. */
export function estLisiere(d: number): boolean {
  return d >= 1 && d <= CREUX.PROF_LISIERE
}

/** d ≥ PROF_COEUR — le cœur, que seuls les grands massifs possèdent. */
export function estCoeur(d: number): boolean {
  return d >= CREUX.PROF_COEUR
}

/**
 * L'ÉROSION D'UN MASQUE, générale (§2quater R38, généralisée par §2quinquies R44). BFS
 * multi-source 8-connexe : toute tuile du masque dont un voisin (hors-carte compris) est
 * HORS masque est à d = 1, puis on propage vers l'intérieur. Les valeurs sont plafonnées à
 * `cap` mais TOUTE tuile du masque est visitée (une tuile plus profonde que le plafond porte
 * le plafond, jamais 0 — un 0 au cœur dirait « pas dedans »). File plate en anneau, ordre
 * d'insertion row-major : un BFS à coûts unitaires rend la même distance quel que soit
 * l'ordre intra-couche — le champ est déterministe par construction.
 */
export function eroderMasque(masque: Uint8Array, width: number, height: number, cap: number): number[] {
  const N = width * height
  const prof = new Array<number>(N).fill(0)
  const file = new Int32Array(N)
  let tete = 0
  let queue = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!masque[i]) continue
      let bord = false
      for (let dy = -1; dy <= 1 && !bord; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !masque[ny * width + nx]) {
            bord = true
            break
          }
        }
      }
      if (bord) {
        prof[i] = 1
        file[queue++] = i
      }
    }
  }

  while (tete < queue) {
    const i = file[tete++]!
    const d = prof[i]!
    const x = i % width
    const y = (i - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (!masque[j] || prof[j] !== 0) continue
        prof[j] = Math.min(d + 1, cap)
        file[queue++] = j
      }
    }
  }

  return prof
}

/**
 * LES COMPOSANTES 8-CONNEXES d'un masque (§2quinquies R43) — l'étiquetage dont l'ÉLECTION a
 * besoin. Étiquettes attribuées dans l'ordre de découverte row-major : à tailles égales, la
 * composante d'étiquette plus PETITE a sa première tuile plus tôt dans le balayage — le
 * départage stable que la garde de déterminisme des zones exige (le patron du Lac Mort).
 * `label` vaut -1 hors masque.
 */
export interface ComposantesDeMasque {
  label: Int32Array
  tailles: number[]
}

export function composantesDeMasque(masque: Uint8Array, width: number, height: number): ComposantesDeMasque {
  const N = width * height
  const label = new Int32Array(N).fill(-1)
  const tailles: number[] = []
  const pile = new Int32Array(N)
  for (let dep = 0; dep < N; dep++) {
    if (!masque[dep] || label[dep] !== -1) continue
    const id = tailles.length
    let taille = 0
    let haut = 0
    pile[haut++] = dep
    label[dep] = id
    while (haut > 0) {
      const i = pile[--haut]!
      taille += 1
      const x = i % width
      const y = (i - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (!masque[j] || label[j] !== -1) continue
          label[j] = id
          pile[haut++] = j
        }
      }
    }
    tailles.push(taille)
  }
  return { label, tailles }
}

/** L'érosion du masque BOISÉ de la Racine — le champ `map.profondeur` (§2quater R38). */
export function deriverProfondeur(
  terrain: readonly number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
): number[] {
  const N = width * height
  const boise = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (zone[i] === racineId && TERRAINS_BOISES_MASSIF.includes(terrain[i]!)) boise[i] = 1
  }
  return eroderMasque(boise, width, height, CREUX.PROF_CAP)
}
