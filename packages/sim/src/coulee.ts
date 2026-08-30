/**
 * ═══ LES COULÉES DE SUIE (spec `cendre.md` R26, chantier ② des dix — 2026-08-30) ═══
 *
 * L'eau ne brûle pas (R12) : elle se SALIT. Là où la cendre touche la berge, la rivière
 * charrie la suie vers l'aval — et la carte ANNONCE : un bief gris en aval dit qu'un foyer
 * grandit en amont, des tuiles avant qu'on le voie. La loi est une fonction pure de
 * l'avancée du jour (et de `cendreAge` : un foyer gelé par R16 fige aussi sa coulée) —
 * ZÉRO état de simulation, mémoïsation d'une fonction pure (patron `avanceeDeCendre` /
 * `effetsDuJour`).
 *
 * TROIS DISTANCES, TROIS RÔLES (le réglage vit ICI : il se calibre en regardant une carte) :
 * `PORTEE_SOURCE` dit où la cendre TOUCHE le fil, `DILUTION_PAS` dit jusqu'où le fil PORTE,
 * `DEMI_LIT` dit quelles tuiles d'eau le fil souillé TEINT.
 *
 * ⚠ LE CACHE EST KEYÉ SUR LE FIL **ET** LA GRAINE **ET** `cendreAge` : deux sims entrelacées
 * (les tests) ont chacune leur fil — le pire cas d'un entrelacement est un recalcul, jamais
 * une erreur. Le jour n'est PAS dans la clé : l'âge des foyers le porte déjà.
 */
import { TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from './balance'
import { tuileCendree } from './cendre'
import { terrainAt, type WorldMap } from './map'
import { EAU } from './zonegen-water'

/** Ce que la loi LIT — la forme exacte que le client tient déjà pour `tuileCendree` :
 *  `{ map, cendreAge, seed }`. Le jour n'y est pas, et c'est mesuré : la souillure ne dépend
 *  que de l'ÂGE des foyers (`tuileCendree` ne lit pas le calendrier) — le rendu peut donc
 *  poser la même question que la sim, sans un champ de plus. */
export interface EtatDeCendre {
  map: WorldMap
  cendreAge: readonly number[]
  seed: number
}

export const COULEE = {
  /** À combien de tuiles (Chebyshev) du fil une tuile cendrée fait SOURCE. ⚠ DÉRIVÉE DU LIT,
   *  et c'est une leçon payée au banc : le champ de cendre ne traverse pas l'eau (R4), donc
   *  AUCUNE tuile du lit n'est jamais cendrée — une portée plus courte que la demi-largeur du
   *  lit (3) ne pouvait TOUCHER aucune source, sur aucune rivière du jeu. La portée doit
   *  atteindre la berge : demi-lit + 2 — la cendre à deux tuiles de l'eau salit l'eau. */
  PORTEE_SOURCE: EAU.RIVIERE_DEMI_LIT + 2,
  /** Combien de PAS DE FIL la souillure descend avant que la rivière se lave. */
  DILUTION_PAS: 40,
  /** À combien de tuiles (Chebyshev) d'un point de fil souillé une tuile d'eau est souillée :
   *  la demi-largeur du lit, DÉRIVÉE du worldgen — la coulée teint le lit que la rivière a. */
  DEMI_LIT: EAU.RIVIERE_DEMI_LIT,
} as const

/** Le cache de la journée — mémoïsation pure (voir l'en-tête), jamais dans `SimState`.
 *  La GRAINE est dans la clé (revue 2026-08-30) : `tuileCendree` lit le grain de lisière par
 *  `state.seed` — la clé est auto-suffisante, elle ne repose pas sur la copie profonde de
 *  `createSim` pour séparer deux sims. */
let filEnCache: readonly number[] | undefined
let seedEnCache = Number.NaN
let ageEnCache = ''
let souillesEnCache: Set<number> = new Set()

/**
 * LES TUILES D'EAU SOUILLÉES DU JOUR — l'ensemble des index de tuile à ≤ `DEMI_LIT` d'un
 * point de fil souillé. Deux balayages O(|fil|) : les sources d'abord (la cendre à
 * `PORTEE_SOURCE` du fil), puis la descente (la source la plus récente à ≤ `DILUTION_PAS`
 * pas en amont). Recalculé au plus une fois par jour et par carte.
 */
function souillesDuJour(state: EtatDeCendre): Set<number> {
  const fil = state.map.fil
  if (!fil || fil.length === 0) return new Set()
  const age = state.cendreAge ? state.cendreAge.join(',') : ''
  if (fil === filEnCache && state.seed === seedEnCache && age === ageEnCache) return souillesEnCache
  const { width, height } = state.map
  const R = COULEE.PORTEE_SOURCE
  // ① LES SOURCES : le fil que la cendre touche.
  const source: boolean[] = new Array(fil.length)
  for (let k = 0; k < fil.length; k++) {
    const tx = fil[k]! % width
    const ty = Math.floor(fil[k]! / width)
    let touche = false
    for (let dy = -R; dy <= R && !touche; dy++) {
      for (let dx = -R; dx <= R && !touche; dx++) {
        const x = tx + dx
        const y = ty + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        if (tuileCendree(state, x, y)) touche = true
      }
    }
    source[k] = touche
  }
  // ② LA DESCENTE : souillé s'il existe une source à ≤ DILUTION_PAS pas en AMONT (lui compris).
  const souilles = new Set<number>()
  let derniereSource = -Infinity
  for (let k = 0; k < fil.length; k++) {
    if (source[k]) derniereSource = k
    if (k - derniereSource > COULEE.DILUTION_PAS) continue
    // ③ LA TEINTE : le lit autour du point souillé — l'EAU seulement. La suie coule, elle ne
    // grimpe pas sur la berge (le rendu des berges tachées, s'il vient, sera SA décision).
    const tx = fil[k]! % width
    const ty = Math.floor(fil[k]! / width)
    for (let dy = -COULEE.DEMI_LIT; dy <= COULEE.DEMI_LIT; dy++) {
      for (let dx = -COULEE.DEMI_LIT; dx <= COULEE.DEMI_LIT; dx++) {
        const x = tx + dx
        const y = ty + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const t = terrainAt(state.map, x, y)
        if (t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER) continue
        souilles.add(y * width + x)
      }
    }
  }
  filEnCache = fil
  seedEnCache = state.seed
  ageEnCache = age
  souillesEnCache = souilles
  return souilles
}

/**
 * CETTE EAU EST-ELLE SOUILLÉE PAR UNE COULÉE ? (R26a) — la question que la table de pêche
 * (R26b) et, plus tard, le rendu (R26d) posent. La souillure ne TUE pas l'eau : elle ne
 * change ni `eauIndisponible` ni la ligne posée (R26c) — seulement ce qui mord.
 */
export function eauSouillee(state: EtatDeCendre, tx: number, ty: number): boolean {
  return souillesDuJour(state).has(ty * state.map.width + tx)
}

