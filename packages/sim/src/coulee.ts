/**
 * ═══ LA QUALITÉ DE L'EAU — UN SEUL VERDICT, PLUSIEURS CAUSES (spec `qualite-eau.md`) ═══
 *
 * Décidé par Alexis le 2026-09-12 : ce module est LE porteur de la qualité de l'eau, et les
 * causes s'y ajoutent. `qualiteDeLEau` rend une FORCE dans [0,1] ; `eauSouillee` n'est que le
 * seuil de cette force, et garde son contrat au bit près. **Les causes prennent le MAXIMUM,
 * jamais la somme** — deux causes faibles ne doivent pas fabriquer une cause forte.
 *
 * DEUX CAUSES AUJOURD'HUI, DEUX PATRONS DE STOCKAGE DIFFÉRENTS, ET C'EST VOULU :
 *   • LA SUIE — prédicat pur mémoïsé, ZÉRO octet d'état (tout ci-dessous).
 *   • LE SANG — état local borné (`state.souillures`), patron de `state.blood` : expiration
 *     + plafond FIFO. C'est la seule chose de l'eau qui se souvienne d'un événement.
 *
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
import { SANG, TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_SHALLOW_WATER } from './balance'
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

/**
 * UNE SOUILLURE DE SANG — l'état local borné de l'eau. Objet nu, JSON-sérialisable : ni
 * classe, ni `Map`, ni `Set` (le contrat de `SimState`).
 *
 * `pas` porte toute la géométrie : ≥ 0, la goutte est tombée DANS le fleuve et la souillure
 * descend le fil depuis ce pas-là ; < 0, elle est en eau dormante et c'est un disque.
 */
export interface Souillure {
  /** Index de tuile de l'ORIGINE (`ty * width + tx`). */
  i: number
  /** Tick de la dernière goutte reçue — l'expiration se compte depuis lui. */
  tick: number
  /** Crans de force accumulés (entiers : rien à accumuler en flottant). */
  crans: number
  /** Pas de fil d'attache, ou −1 pour une eau qui ne va nulle part. */
  pas: number
}

/** Ce que la qualité de l'eau lit EN PLUS de la cendre. Les deux champs du sang sont
 *  optionnels : le client interroge la suie avec `{ map, cendreAge, seed }` seul, et doit
 *  continuer de le pouvoir sans porter l'état de sang qu'il n'a pas. */
export interface EtatQualiteEau extends EtatDeCendre {
  tick?: number
  souillures?: readonly Souillure[]
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
  /** La force que porte une tuile souillée par la SUIE. Pleine, et pas graduée : le verdict
   *  de la suie est binaire depuis R26 et doit le rester au bit près (spec Q2 / critère A1).
   *  Graduer la suie serait un geste de plus, mesuré contre son relevé d'avant. */
  FORCE_SUIE: 1,
} as const

/** Le cache de la journée — mémoïsation pure (voir l'en-tête), jamais dans `SimState`.
 *  La GRAINE est dans la clé (revue 2026-08-30) : `tuileCendree` lit le grain de lisière par
 *  `state.seed` — la clé est auto-suffisante, elle ne repose pas sur la copie profonde de
 *  `createSim` pour séparer deux sims. */
let filEnCache: readonly number[] | undefined
let seedEnCache = Number.NaN
let ageEnCache = ''
let souillesEnCache: Set<number> = new Set()
/** Le « pas de rivière ici » — partagé, parce que la porte O(1) ne doit pas allouer. */
const AUCUNE: ReadonlySet<number> = new Set()

/**
 * LES TUILES D'EAU SOUILLÉES DU JOUR — l'ensemble des index de tuile à ≤ `DEMI_LIT` d'un
 * point de fil souillé. Deux balayages O(|fil|) : les sources d'abord (la cendre à
 * `PORTEE_SOURCE` du fil), puis la descente (la source la plus récente à ≤ `DILUTION_PAS`
 * pas en amont). Recalculé au plus une fois par jour et par carte.
 */
function souillesDuJour(state: EtatDeCendre): ReadonlySet<number> {
  const fil = state.map.fil
  if (!fil || fil.length === 0) return AUCUNE
  // PAS DE CHAMP DE CENDRE, PAS DE SUIE — et la sortie se prend AVANT le balayage (Q12). Sans
  // cette ligne, un monde sans foyer payait `|fil| × PORTEE_SOURCE²` appels de `tuileCendree`
  // (669 × 81 sur le monde joué) pour que chacun réponde « pas de champ » : le résultat est le
  // même au bit près, le coût ne l'était pas. La mémoïsation ne sauvait que les lectures
  // SUIVANTES — or c'est la PREMIÈRE de chaque journée qui tombe dans un tick de jeu.
  if (!state.map.cendreCout) return AUCUNE
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

/* ══════════════════════ LE SANG DANS L'EAU (spec `qualite-eau.md`) ══════════════════════ */

/** « Pas encore cherché » — distinct de −1, qui veut dire « cherché, aucun fil à portée ». */
const PAS_INCONNU = -2

/** Une tuile d'eau — au sens de ce qui peut PORTER une souillure. Le marais et la
 *  roselière en sont, crue ou pas (Q7, décisions d'Alexis du 2026-09-12) : on y saigne, et leur
 *  eau dormante garde ce qu'on y verse. La berge, jamais (Q7bis). */
function tuileDEau(map: WorldMap, tx: number, ty: number): boolean {
  const t = terrainAt(map, tx, ty)
  return t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER || t === TERRAIN_MARSH || t === TERRAIN_REED_MARSH
}

/**
 * À QUEL PAS DU FIL CETTE TUILE S'ATTACHE-T-ELLE ? (spec Q6bis) — `-1` si aucune à portée.
 *
 * `map.fil` n'est que la MÉDIANE du fleuve : sur un lit de trois tuiles de demi-largeur, une
 * goutte ne tombe presque jamais SUR le fil. La loi de la maison est le PLUS-PROCHE-POINT,
 * jamais le premier pas trouvé — le champ de courant du client l'a payée (« min-distance,
 * jamais dernier écrit, sinon les méandres serrés cousent ») et `couleeStep` la rejoue côté
 * sim. Sans elle, un méandre serré attache la goutte au bief d'en face et le sang traverse
 * le coude. La borne (`SANG.ATTACHE`) dit où le fleuve s'arrête : au-delà, l'eau est dormante.
 */
export function attacheAuFil(map: WorldMap, tx: number, ty: number): number {
  const fil = map.fil
  if (!fil || fil.length === 0) return -1
  const width = map.width
  let pas = -1
  let meilleure = Number.POSITIVE_INFINITY
  for (let k = 0; k < fil.length; k++) {
    const i = fil[k]!
    const x = i % width
    const dx = x - tx
    const dy = (i - x) / width - ty
    // LA BORNE EST CHEBYSHEV, LE CLASSEMENT EST EUCLIDIEN, et les deux ont leur raison.
    // Chebyshev parce que TOUT le module mesure ainsi (`PORTEE_SOURCE`, `DEMI_LIT`,
    // `PORTEE_DORMANTE`) : avec une borne euclidienne de 4, un COIN de lit à (3,3) de son
    // propre pas est à 4,24 — il sortait du fleuve et se lisait comme une eau dormante, en
    // plein milieu d'une rivière. Euclidien pour le classement parce que Chebyshev égalise
    // des pas entiers par paquets, et qu'un départage « au premier » ramènerait exactement le
    // défaut que le plus-proche-point existe pour éviter (les méandres qui cousent).
    if (Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) > SANG.ATTACHE) continue
    const d2 = dx * dx + dy * dy
    if (d2 < meilleure) {
      meilleure = d2
      pas = k
      if (d2 === 0) break // pile sur le fil : rien ne sera plus proche
    }
  }
  return pas
}

/** La part qui reste d'une souillure après `tick - s.tick` ticks : elle pâlit, linéairement,
 *  jusqu'à rien à `TACHE_TICKS`. Une rivière se lave — elle ne s'éteint pas d'un coup. */
function restantDe(s: Souillure, tick: number): number {
  const age = tick - s.tick
  if (age >= SANG.TACHE_TICKS) return 0
  if (age <= 0) return 1
  return 1 - age / SANG.TACHE_TICKS
}

/** La force de sang d'UNE souillure sur la tuile `(tx, ty)`, ou 0. Les deux géométries de la
 *  spec : la traînée qui descend le fil (Q6), et le disque de l'eau dormante (Q7).
 *
 *  `monPas` est le pas de fil de LA TUILE INTERROGÉE (pas celui de la souillure) — cherché une
 *  seule fois par lecture, et c'est lui qui donne son sens à l'aval. Le comparer au pas de la
 *  souillure est la SEULE façon de dire « en aval » : mesurer la distance à la souillure
 *  souillerait l'amont autant que l'aval, le lit étant large de sept tuiles (MESURÉ : la
 *  première écriture salissait `k − 1` à pleine force, et A2 l'a attrapée). */
function forceDUneSouillure(map: WorldMap, s: Souillure, tx: number, ty: number, reste: number, monPas: number): number {
  const width = map.width
  const ox = s.i % width
  const oy = (s.i - ox) / width
  const base = Math.min(s.crans * SANG.FORCE_PAR_GOUTTE, SANG.FORCE_MAX) * reste

  if (s.pas < 0) {
    // ── L'EAU DORMANTE : un disque qui se dilue, sans direction (Chebyshev, comme la suie). ──
    const d = Math.max(Math.abs(tx - ox), Math.abs(ty - oy))
    if (d > SANG.PORTEE_DORMANTE) return 0
    return base * ((SANG.PORTEE_DORMANTE + 1 - d) / (SANG.PORTEE_DORMANTE + 1))
  }

  // ── LE FLEUVE : la traînée descend, et elle ne remonte JAMAIS. ──
  const fil = map.fil
  if (!fil || monPas < 0) return 0
  const n = monPas - s.pas
  if (n < 0 || n > SANG.DILUTION_PAS) return 0 // l'amont, et l'aval lavé
  // La tuile doit être dans le LIT de SON pas : `map.fil` est la médiane du fleuve, pas son
  // bord — c'est `DEMI_LIT` qui dit jusqu'où la teinte porte en travers (la clause de la suie).
  const i = fil[monPas]!
  const x = i % width
  if (Math.max(Math.abs(tx - x), Math.abs(ty - (i - x) / width)) > COULEE.DEMI_LIT) return 0
  return base * ((SANG.DILUTION_PAS + 1 - n) / (SANG.DILUTION_PAS + 1))
}

/**
 * LA QUALITÉ DE L'EAU — une force dans [0,1], et un seul verdict pour plusieurs causes.
 *
 * **Les causes prennent le MAXIMUM, jamais la somme** (spec, principe d'architecture) : une
 * rivière un peu grise en aval d'un foyer et un peu saignée par une blessure ne doit pas
 * devenir une eau morte par addition.
 *
 * La porte O(1) d'abord : sans cendre ET sans sang, on sort sans rien payer (Q12) — ce test
 * est posé là parce que la pêche, la buvée et le peuplement l'interrogent sur des mondes qui,
 * la plupart du temps, n'ont ni l'une ni l'autre.
 */
export function qualiteDeLEau(state: EtatQualiteEau, tx: number, ty: number): number {
  const map = state.map
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  const taches = state.souillures
  const suie = souillesDuJour(state).has(ty * map.width + tx) ? COULEE.FORCE_SUIE : 0
  if (suie >= 1) return 1 // déjà au plafond : rien ne peut monter plus haut
  if (!taches || taches.length === 0 || state.tick === undefined) return suie
  if (!tuileDEau(map, tx, ty)) return suie // la berge ne se tache pas (Q7bis)
  // Le pas de fil de CETTE tuile, cherché au plus une fois par lecture — et seulement si une
  // souillure est attachée au fleuve. Une mare ensanglantée ne paie pas le balayage du fil.
  let monPas = PAS_INCONNU
  let force = suie
  for (const s of taches) {
    const reste = restantDe(s, state.tick)
    if (reste <= 0) continue
    if (s.pas >= 0 && monPas === PAS_INCONNU) monPas = attacheAuFil(map, tx, ty)
    const f = forceDUneSouillure(map, s, tx, ty, reste, monPas)
    if (f > force) force = f
  }
  return force
}

/**
 * CETTE EAU EST-ELLE SOUILLÉE ? (R26a) — la question que la table de pêche (R26b), la buvée
 * des bêtes et le rendu (R26d) posent. La souillure ne TUE pas l'eau : elle ne change ni
 * `eauIndisponible` ni la ligne posée (R26c) — seulement ce qui mord.
 *
 * Ce n'est plus qu'un SEUIL sur la force (spec Q1). La suie porte `FORCE_SUIE` = 1, donc le
 * verdict de la coulée est inchangé au bit près (A1) ; le sang, lui, doit s'accumuler — une
 * écorchure ne condamne pas un bief.
 */
export function eauSouillee(state: EtatQualiteEau, tx: number, ty: number): boolean {
  return qualiteDeLEau(state, tx, ty) >= SANG.SEUIL_SOUILLE
}

