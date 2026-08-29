/**
 * ═══ LE CALENDRIER FLORAL (décisions d'Alexis 2026-08-28, sur planche rendue) ═══
 *
 * « La tuile possède son espèce, le calendrier décide si elle fleurit, le gel garde son veto. »
 *
 * Trois lois, tranchées une à une :
 *
 * 1. **L'espèce d'une tuile est FIXE à l'année.** Le même coin de crocus revient chaque
 *    printemps — le monde s'apprend (« le coin aux crocus près du gué »), et la mémoire du
 *    décor (`clutter-memo.ts`) reste valide : seule la VISIBILITÉ varie avec le jour, jamais
 *    le choix. C'est pourquoi AUCUNE fonction d'ici ne prend le jour ET la position à la fois :
 *    `nappeDe` (où, quoi) ignore le calendrier, `enFleur` (quand) ne choisit rien.
 *
 * 2. **Huit espèces, chacune une fiche** : ses biomes (les tables ci-dessous) et sa fenêtre de
 *    floraison dans l'année de 120 jours. L'Ardeur est le pic (cinq espèces se chevauchent),
 *    les Pluies gardent une identité (colchique aux prés, bruyère aux hauteurs — l'ouverture
 *    au jour 61 n'est pas nue, elle est AUTRE), l'hiver ne porte rien. La gentiane n'existe
 *    qu'en alpage et la bruyère n'allume la lande qu'aux Pluies : deux biomes sans fleurs
 *    jusqu'ici gagnent une signature saisonnière.
 *
 * 3. **Les nappes** : un champ de bruit basse fréquence PAR ESPÈCE donne la dominante de
 *    l'endroit — un vallon de jonquilles, un versant de coquelicots — au lieu du confetti
 *    uniforme. Mélange 80/20 (la dominante + un saupoudrage des autres : sans lui, une
 *    fleuraie d'Ardeur est un aplat monochrome par écran), et la densité SUIT le champ
 *    (cœur dense, bords presque nus) : fleur et herbe s'ÉCHANGENT selon la force de la nappe
 *    (`pFleur`/`pCoeur`), le total de props du biome ne bouge pas, il se redistribue.
 *
 * L'apparition/disparition à l'écran est le geste de `flore-gel.ts`, réutilisé tel quel par
 * `clutter-layer.ts` : le prédicat devient « en fenêtre ∧ non gelé ». Le crocus a sa fenêtre
 * ouverte dès j2 mais reste sous le veto du gel — il jaillit tuile par tuile DERRIÈRE le front
 * de dégel, sans un mécanisme de plus.
 *
 * Les indices d'espèce sont ceux de `FLOWERS` (lit-props.ts) — la silhouette et la couleur y
 * vivent, le calendrier ici ; `flore-especes.test.ts` garde les deux tables synchrones.
 * Pur, sans Phaser — testé en Node.
 */
import {
  fbm2,
  hash2,
  YEAR_DAYS,
  TERRAIN_GRASS,
  TERRAIN_CLAIRIERE,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_WET_MEADOW,
  TERRAIN_JUNIPER_HEATH,
} from '@ashes/sim'

/** Les huit espèces — l'indice EST celui de la variété `FLOWERS` (lit-props.ts). */
export const CROCUS = 0
export const JONQUILLE = 1
export const MARGUERITE = 2
export const COQUELICOT = 3
export const BLEUET = 4
export const GENTIANE = 5
export const COLCHIQUE = 6
export const BRUYERE = 7

/**
 * LES FENÊTRES DE FLORAISON, en jours de l'année (1..120 — Éclosion 1-30, Ardeur 31-60,
 * Pluies 61-90, Grand Froid 91-120). Bornes INCLUSES. Aucune fenêtre ne couvre le cœur de
 * l'hiver ni n'enjambe le tour de l'an — `enFleur` compte là-dessus.
 */
export const FENETRES: readonly { debut: number; fin: number }[] = [
  { debut: 2, fin: 28 }, // crocus — ouvert sous le gel : c'est le dégel qui le libère
  { debut: 8, fin: 40 }, // jonquille
  { debut: 15, fin: 65 }, // marguerite — la longue, elle fait le pont Éclosion→Ardeur
  { debut: 32, fin: 62 }, // coquelicot
  { debut: 35, fin: 70 }, // bleuet
  { debut: 40, fin: 75 }, // gentiane
  { debut: 62, fin: 92 }, // colchique — la fleur de l'ouverture (j61)
  { debut: 58, fin: 100 }, // bruyère — tient jusqu'aux premières morsures du froid
]

/**
 * LES TABLES FLORALES PAR BIOME — pondérées par répétition, comme les `props` de
 * `BIOME_CLUTTER`. Seuls les terrains listés ici portent des espèces (et donc des nappes) ;
 * un biome à `flower` sans table garderait le tirage uniforme d'avant.
 */
export const TABLE_FLORALE: Readonly<Record<number, readonly number[]>> = {
  [TERRAIN_GRASS]: [CROCUS, CROCUS, JONQUILLE, JONQUILLE, MARGUERITE, MARGUERITE, COQUELICOT, COQUELICOT, BLEUET, COLCHIQUE, COLCHIQUE],
  [TERRAIN_CLAIRIERE]: [CROCUS, CROCUS, JONQUILLE, JONQUILLE, MARGUERITE, MARGUERITE, COQUELICOT, COQUELICOT, BLEUET, COLCHIQUE, COLCHIQUE],
  [TERRAIN_FLOWER_MEADOW]: [CROCUS, CROCUS, CROCUS, JONQUILLE, JONQUILLE, MARGUERITE, MARGUERITE, COQUELICOT, COQUELICOT, COQUELICOT, BLEUET, BLEUET, COLCHIQUE, COLCHIQUE, COLCHIQUE],
  [TERRAIN_ALPINE_MEADOW]: [CROCUS, CROCUS, MARGUERITE, GENTIANE, GENTIANE, BRUYERE],
  [TERRAIN_ALPINE_FLOWERS]: [CROCUS, CROCUS, CROCUS, MARGUERITE, MARGUERITE, GENTIANE, GENTIANE, GENTIANE, BRUYERE, BRUYERE],
  [TERRAIN_WET_MEADOW]: [JONQUILLE, JONQUILLE, MARGUERITE, COLCHIQUE, COLCHIQUE, COLCHIQUE],
  [TERRAIN_JUNIPER_HEATH]: [BRUYERE],
}

/** Réglages des nappes — se règlent en REGARDANT (le pendant de `BIOME_CLUTTER`). */
export const NAPPES = {
  /** Taille des taches d'espèce (tuiles) — un vallon, pas un damier ni une région. */
  ECHELLE: 15,
  /** Part du saupoudrage : une tuile sur cinq tire dans TOUTE la table du biome. */
  SAUPOUDRAGE: 0.2,
  /**
   * L'échange fleur↔herbe, en PENTE CONTINUE sur la force de la nappe (bornes exactes,
   * jamais un palier) : sous `CREUX_BAS` un tirage « fleur » devient herbe, au-dessus de
   * `CREUX_HAUT` il reste fleur, entre les deux la pente. Et au-dessus de `COEUR`, une part
   * des tirages « herbe » (jusqu'à `COEUR_BOOST`) devient fleur — le cœur de la nappe est
   * plus fleuri que la table seule ne le permet.
   *
   * ⚠ Ces seuils se lisent sur le CHAMP DE DENSITÉ (un seul bruit, le même pour tous les
   * biomes — quantiles mesurés : q25 ≈ 0,38, q50 ≈ 0,50, q75 ≈ 0,61), PAS sur les champs
   * d'espèce : la force du champ DOMINANT est un max de n bruits, et sa distribution monte
   * avec la taille de la table (médiane 0,70 au pré à six espèces, 0,50 à la lande à une) —
   * des seuils fixes posés dessus auraient rendu le creux INATTEIGNABLE au pré, mesuré.
   * Calibrés pour que la part globale de fleurs d'un biome reste celle de sa table : les
   * pertes du creux (≈ 0,12 des tirages fleur+herbe) égalent les gains du cœur — garde de
   * conservation dans `flore-especes.test.ts`.
   */
  CREUX_BAS: 0.3,
  CREUX_HAUT: 0.44,
  COEUR: 0.5,
  COEUR_BOOST: 0.8,
} as const

/**
 * L'ÉTALEMENT DES ÉCLOSIONS (« go pour les 2 », Alexis 2026-08-28) — deux lois :
 *
 * **Le cœur d'abord.** Le glissement de fenêtre n'est pas un hash : il est piloté par la
 * FORCE de la nappe. Au cœur (force haute), la fenêtre s'ouvre jusqu'à `ETALEMENT_J` jours
 * plus tôt ET se ferme d'autant plus tard ; au bord, l'inverse — la tache s'allume du cœur
 * vers les bords, et s'éteint par les bords. Un sel de ±`BRUIT_J` par tuile empêche deux
 * tuiles d'égale force d'être synchrones.
 *
 * **Le jour continu.** `enFleur` attend un jour À DÉCIMALES (`seasonDay + jourFrac` — le
 * champ créé pour « ce qui doit COULER au lieu de sauter ») : chaque tuile franchit son
 * seuil fractionnaire à sa minute à elle, et les éclosions s'égrènent sur les trente
 * minutes du cycle au lieu de partir en salve d'une seconde au changement de date.
 * (`retardDe` de flore-gel garde son rôle : étaler les départs DANS l'image.)
 */
export const FLORAISON_ETALEMENT_J = 4
export const FLORAISON_BRUIT_J = 1

export interface Nappe {
  /** L'espèce de la tuile (indice `FLOWERS`) — dominante de l'endroit, ou saupoudrage. */
  espece: number
  /** La force du CHAMP DE DENSITÉ ici, ∈ [0, 1] — c'est elle que suit l'échange
   *  fleur↔herbe, et elle ne dépend PAS de la table (voir l'avertissement de `NAPPES`). */
  force: number
}

/** Les espèces uniques d'une table et leur part, dans l'ordre des indices — mémoïsé par
 *  table (les tables sont des constantes de module : la référence est une clé sûre). */
const PARTS = new Map<readonly number[], readonly { espece: number; part: number }[]>()
function partsDe(table: readonly number[]): readonly { espece: number; part: number }[] {
  let parts = PARTS.get(table)
  if (parts === undefined) {
    const comptes = new Map<number, number>()
    for (const e of table) comptes.set(e, (comptes.get(e) ?? 0) + 1)
    parts = [...comptes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([espece, n]) => ({ espece, part: n / table.length }))
    PARTS.set(table, parts)
  }
  return parts
}

/**
 * L'espèce et la force de nappe d'une tuile — PURE et sans calendrier (loi 1 de l'en-tête).
 * `undefined` : ce biome n'a pas de table florale.
 */
export function nappeDe(terrain: number, tx: number, ty: number, seed: number): Nappe | undefined {
  const table = TABLE_FLORALE[terrain]
  if (table === undefined) return undefined
  // La dominante : le champ le plus fort parmi les espèces du biome. La part de la table
  // BIAISE le duel sans l'écraser (0,5 + part) : une espèce à 30 % gagne plus souvent
  // qu'une à 9 %, mais chacune garde ses vallons à elle.
  let dominante = table[0]!
  let meilleur = -1
  for (const { espece, part } of partsDe(table)) {
    const f = fbm2(tx, ty, NAPPES.ECHELLE, (seed ^ (0x9e3f + espece * 0x101)) | 0)
    const score = f * (0.5 + part)
    if (score > meilleur) {
      meilleur = score
      dominante = espece
    }
  }
  // Le champ de DENSITÉ — un bruit à part, le même pour tous les biomes (voir `NAPPES`) :
  // c'est lui qui creuse les vides entre les nappes et densifie leurs cœurs.
  const force = fbm2(tx, ty, NAPPES.ECHELLE, (seed ^ 0x51d3a7) | 0)
  const u = hash2(tx, ty, (seed ^ 0x5f10ca) | 0)
  const espece = u < NAPPES.SAUPOUDRAGE
    ? table[Math.floor(hash2(tx, ty, (seed ^ 0x5f10cb) | 0) * table.length) % table.length]!
    : dominante
  return { espece, force }
}

/** La probabilité qu'un tirage « fleur » RESTE une fleur, selon la force de la nappe. */
export function pFleur(force: number): number {
  return Math.max(0, Math.min(1, (force - NAPPES.CREUX_BAS) / (NAPPES.CREUX_HAUT - NAPPES.CREUX_BAS)))
}

/** La probabilité qu'un tirage « herbe » DEVIENNE une fleur — le surcroît du cœur de nappe. */
export function pCoeur(force: number): number {
  return NAPPES.COEUR_BOOST * Math.max(0, Math.min(1, (force - NAPPES.COEUR) / (1 - NAPPES.COEUR)))
}

/**
 * Cette espèce est-elle en fleur CE jour, SUR cette tuile ? Le jour est le `seasonDay` non
 * borné de la sim, DÉCIMALES COMPRISES (`+ jourFrac` — voir l'en-tête d'étalement) ; `force`
 * est la force de nappe de la tuile (`Nappe.force`), 0,5 sans nappe : le glissement retombe
 * alors sur le seul sel par tuile. Le GEL n'est pas son affaire : le veto se compose dans
 * `clutter-layer.ts` (`gelé ∨ hors-fenêtre`), parce que seul le rendu sait ce qu'il a relevé.
 */
export function enFleur(espece: number, jour: number, tx: number, ty: number, force = 0.5): boolean {
  const f = FENETRES[espece]
  if (f === undefined) return true
  // d < 0 au cœur : il fleurit tôt et fane tard (la fenêtre s'élargit) ; d > 0 au bord.
  const d = (0.5 - force) * 2 * FLORAISON_ETALEMENT_J
  const bruitDebut = (hash2(tx, ty, (0xf7c0 + espece) | 0) * 2 - 1) * FLORAISON_BRUIT_J
  const bruitFin = (hash2(tx, ty, (0xf8c0 + espece) | 0) * 2 - 1) * FLORAISON_BRUIT_J
  // Le repli sur l'année, SANS arrondir — la fraction du jour est ce qui égrène les éclosions.
  const j = (((jour - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS + 1
  return j >= f.debut + d + bruitDebut && j <= f.fin - d + bruitFin
}
