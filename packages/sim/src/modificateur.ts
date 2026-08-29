/**
 * LE MODIFICATEUR DE SAISON (spec `saisons.md` S18, décisions d'Alexis 2026-08-23).
 *
 * Chaque saison tire un CARACTÈRE, et **une sur trois n'en a pas**. Une Ardeur peut être une
 * Canicule, un Grand Froid peut être une Meute — et l'année d'après, ce sera autre chose. La
 * couche donne à un calendrier qui tourne ce qui lui manquait : de la variance, sans toucher
 * une seule règle.
 *
 * ═══ PUR, SANS ÉTAT, SANS TIRAGE ═══
 *
 * L'élection est un `hash2` sur (tour, phase) : le patron exact de l'élection météo. Aucun
 * champ n'entre dans le `SimState`, aucun tirage ne décale le PRNG — donc le replay et le
 * flux d'événements sont inchangés, et on peut lire le caractère d'une saison PASSÉE ou
 * FUTURE aussi facilement que celui d'aujourd'hui (ce dont la chronique et l'annonce ont
 * besoin). La leçon est celle du front météo : *ce qui se dérive du calendrier ne se range
 * jamais.*
 *
 * ═══ IL SURCHARGE DES CADRANS, IL N'INVENTE RIEN ═══
 *
 * Chacun des dix-sept se lit comme une poignée de nombres appliqués à des lois qui existent
 * déjà — la courbe du socle, l'aridité, la repousse, la péremption, la dureté de l'année, la
 * fonte des neiges, la mixture météo. C'est la doctrine de `meteo.md` (« la météo module,
 * elle n'invente pas ») étendue d'un cran. Un modificateur qui demanderait un mécanisme neuf
 * n'entre pas dans la table : trois ont été écartés à la vérification (le feu qui court dans
 * l'herbe — rien ne se propage ; la foudre qui embrase les structures — elle ne frappe que
 * les corps ; les convois d'automne — remplacés par le Brame).
 *
 * ═══ IL SE COMPOSE AVEC L'ESCALADE, IL NE LA REMPLACE PAS ═══
 *
 * L'Hiver noir de l'an 5 est plus dur que celui de l'an 1 : le modificateur décale ou
 * multiplie ce que l'année vaut déjà (S12 pour le climat, S15 pour la menace).
 */
import { ACTS_PER_YEAR, BALANCE, phaseOf, tourDuJour, type MeteoTypeId } from './balance'
import { hash2 } from './noise'

const MODIF_SALT = 0x3f7a91c5

/** Les dix-sept caractères — quatre par saison, cinq au Grand Froid (décision d'Alexis,
 *  2026-08-28 : le vent de cendre redevient atteignable PAR UN CARACTÈRE, pas par les
 *  mixtures — zéro décalage du ciel hors des saisons qui le tirent). */
export type ModificateurId =
  // l'Éclosion
  | 'gelees_tardives'
  | 'crue'
  | 'grande_levee'
  | 'reveil'
  // l'Ardeur
  | 'canicule'
  | 'orages_secs'
  | 'ete_pourri'
  | 'nuee'
  // les Pluies
  | 'deluge'
  | 'ete_indien'
  | 'rouille'
  | 'brame'
  // le Grand Froid
  | 'hiver_noir'
  | 'grandes_neiges'
  | 'disette'
  | 'meute'
  | 'vents_de_cendre'

/** Par phase, dans l'ordre des phases (1 = l'Éclosion). Chacune touche un système
 *  DIFFÉRENT — température, eau, vie, menace, et depuis 2026-08-28 le CIEL au Grand Froid
 *  (l'Ardeur avait déjà le sien : l'Été pourri) — pour qu'ils ne se confondent pas, et
 *  chacune a au moins un caractère FAVORABLE : sans ça, la couche n'ajouterait que des pics.
 *  ⚠ Élargir un pool REBAT les élections passées de sa saison (l'index se tire sur la
 *  taille de la table) — acceptable tant qu'aucune vallée n'est en cours, à consigner sinon. */
const PAR_PHASE: readonly (readonly ModificateurId[])[] = [
  ['gelees_tardives', 'crue', 'grande_levee', 'reveil'],
  ['canicule', 'orages_secs', 'ete_pourri', 'nuee'],
  ['deluge', 'ete_indien', 'rouille', 'brame'],
  ['hiver_noir', 'grandes_neiges', 'disette', 'meute', 'vents_de_cendre'],
]

/** La part des saisons qui n'ont AUCUN caractère (décision d'Alexis : une sur trois). Un
 *  modificateur ne se remarque que s'il existe des saisons sans — et la calibration de base
 *  doit pouvoir se jouer telle quelle, sinon on ne saura jamais ce qu'elle vaut. */
export const PART_ORDINAIRE = 1 / 3

/**
 * LE CARACTÈRE D'UNE SAISON — `null` une fois sur trois. Fonction pure de (tour, phase).
 *
 * ⚠ **JAMAIS DEUX TOURS DE SUITE LE MÊME.** Une répétition immédiate se lirait comme un bug
 * (« encore une Canicule ? »), et c'est le genre de coïncidence qu'un hachage produit une
 * fois sur quatre. On relit donc le tirage du tour précédent, et on décale d'un cran s'il
 * retombe dessus — une lecture de plus, toujours pure, toujours O(1).
 */
export function modificateurDeSaison(tour: number, phase: number): ModificateurId | null {
  const t = tour < 1 ? 1 : Math.floor(tour)
  const p = ((Math.floor(phase) - 1) % ACTS_PER_YEAR + ACTS_PER_YEAR) % ACTS_PER_YEAR
  const table = PAR_PHASE[p]!
  const r = hash2(t, p, MODIF_SALT)
  if (r < PART_ORDINAIRE) return null
  const u = (r - PART_ORDINAIRE) / (1 - PART_ORDINAIRE)
  let i = Math.min(table.length - 1, Math.floor(u * table.length))
  if (t > 1) {
    const precedent = resolu(t - 1, p, table)
    if (precedent !== null && table[i] === precedent) i = (i + 1) % table.length
  }
  return table[i]!
}

/**
 * LE TIRAGE RÉSOLU D'UN TOUR — la récursion **s'arrête d'elle-même à la première saison
 * ORDINAIRE**, et c'est ce qui rend l'exclusion à la fois EXACTE et bon marché.
 *
 * Une exclusion « jamais deux tours de suite » demande de connaître le tirage RÉSOLU du tour
 * précédent, donc de remonter. Remonter jusqu'à l'an 1 coûterait O(tour) hachages sur un
 * chemin lu par tuile ; s'arrêter à une profondeur fixe laisserait passer des répétitions
 * (mesuré : onze sur trois cents ans à deux rangs, sept à trois rangs). Mais une saison sur
 * trois n'a AUCUN caractère, et un `null` casse la chaîne : la remontée s'arrête là. Les
 * suites de saisons caractérisées sont donc courtes — une et demie en moyenne —, la garantie
 * est exacte, et le pire cas reste une poignée de hachages, amorti par le cache d'un jour de
 * `effetsDuJour`.
 */
function resolu(tour: number, p: number, table: readonly ModificateurId[]): ModificateurId | null {
  const r = hash2(tour, p, MODIF_SALT)
  if (r < PART_ORDINAIRE) return null
  const u = (r - PART_ORDINAIRE) / (1 - PART_ORDINAIRE)
  let i = Math.min(table.length - 1, Math.floor(u * table.length))
  if (tour > 1) {
    const precedent = resolu(tour - 1, p, table)
    if (precedent !== null && table[i] === precedent) i = (i + 1) % table.length
  }
  return table[i]!
}

/**
 * Le caractère de la saison DE CE JOUR — le raccourci que tous les effets appellent.
 *
 * L'acte se recalcule ICI plutôt que par `actForDay` : ce module ne doit RIEN importer de
 * `time.ts`, qui l'importe (la rampe de menace lit son plancher). C'est la même arithmétique,
 * à la ligne près.
 */
export function modificateurDuJour(jour: number): ModificateurId | null {
  // TOTALE, y compris sur un jour qui n'en est pas un : un `NaN` traverserait sinon `phaseOf`
  // jusqu'à un index de table indéfini, et l'appelant lirait `.champ` sur `undefined`. Un jour
  // non fini est traité comme le premier — la même convention que partout ailleurs ici.
  const j = Number.isFinite(jour) ? (jour < 1 ? 1 : Math.floor(jour)) : 1
  const acte = Math.floor((j - 1) / BALANCE.ACT_DAYS) + 1
  return modificateurDeSaison(tourDuJour(j), phaseOf(acte))
}

/**
 * CE QUE CHAQUE CARACTÈRE SURCHARGE. Tous les champs sont optionnels : un modificateur ne
 * touche qu'à ce qui le définit, le reste de l'année reste l'année.
 */
export interface EffetsModificateur {
  /** Décale la LECTURE de la courbe du socle, en jours (négatif = on lit un jour plus tôt,
   *  donc plus proche de l'hiver au printemps et plus proche de l'été à l'automne). */
  socleJours?: number
  /** Décale la courbe du socle, en degrés (positif = plus chaud). */
  socleDegres?: number
  /** Multiplie la vitesse à laquelle l'aridité monte. */
  aridite?: number
  /** Aucun front ne mouille de toute la saison — l'aridité ne retombe jamais. */
  jamaisMouille?: boolean
  /** Multiplie la cadence de la foudre. */
  foudre?: number
  /** La CRUE : la fonte gonfle les eaux (gués infranchissables, l'eau s'étale). */
  crue?: boolean
  /** Multiplie le FACTEUR DE LENTEUR de la repousse (< 1 = ça repousse plus vite). */
  repousse?: number
  /** Multiplie la durée de conservation (< 1 = tout tourne plus vite). */
  peremption?: number
  /** Relève le PLANCHER de la dureté de l'année, dans [0, 1] — la menace ne redescend plus
   *  sous ce niveau de toute la saison. */
  plancherMenace?: number
  /** Multiplie le plafond de faune vivante. */
  faunePlafond?: number
  /** Multiplie la durée de fonte des neiges (> 1 = la neige tient). */
  fonte?: number
  /**
   * ═══ LES DEUX CADRANS DE LA CENDRE (spec `cendre.md` R17) ═══
   *
   * `cendre` multiplie ce que vaut UN JOUR pour un foyer : à 1,6 il vieillit d'un jour et demi, à
   * 0,4 il traîne. `cendreGel` multiplie la durée du gel quand on brûle une fosse
   * (`MORTS.BRULE_DUREE_JOURS`). Deux cadrans, pas un de plus — la doctrine de ce fichier est
   * qu'un modificateur SURCHARGE, il n'invente pas.
   */
  cendre?: number
  cendreGel?: number
  /** Force la fourchette de longueur d'épisode météo (S9). */
  episode?: readonly [number, number]
  /** Emprunte la mixture météo d'une AUTRE phase (l'Été pourri prend celle des Pluies). */
  cielDeLaPhase?: number
  /** REMPLACE la mixture météo de la saison par la sienne (les Vents de cendre). Prime sur
   *  `cielDeLaPhase` ; les poids somment à 1, comme les tables de `METEO.PAR_SAISON`. */
  ciel?: Partial<Record<MeteoTypeId, number>>
  /** Le cerf s'annonce et CHARGE : multiplie sa portée de perception et sa chance de charge. */
  brame?: number
}

const AUCUN: EffetsModificateur = {}

/** LA TABLE — dix-sept entrées, et chacune ne dit que ce qu'elle change. */
const EFFETS: Readonly<Record<ModificateurId, EffetsModificateur>> = {
  // ── l'Éclosion ──────────────────────────────────────────────────────────────────────
  /** L'hiver ne lâche pas : la courbe garde son froid quinze jours de plus. */
  gelees_tardives: { socleJours: -15 },
  /** La fonte gonfle les eaux : les gués deviennent infranchissables et l'eau s'étale. */
  crue: { crue: true },
  /** Repousse doublée, l'année où l'on refait ses stocks. */
  grande_levee: { repousse: 0.5 },
  /** Ce qui a dormi sous la neige se lève : la menace ne redescend pas au printemps — ET la
   *  cendre sort des fosses avec eux. La phrase parlait déjà des morts (spec `cendre.md` R18). */
  reveil: { plancherMenace: 0.45, cendre: 1.6 },
  // ── l'Ardeur ────────────────────────────────────────────────────────────────────────
  /** Quatre degrés de plus, et la terre sèche deux fois plus vite. */
  canicule: { socleDegres: 4, aridite: 2 },
  /** Le ciel cogne et la sécheresse ne casse jamais : aucun front mouillé de la saison. Le feu
   *  prend partout — brûler une fosse la tient TRENTE jours : la saison des expéditions
   *  d'assainissement (spec `cendre.md` R18). */
  orages_secs: { jamaisMouille: true, foudre: 3, cendreGel: 2 },
  /** Il pleut, il ne fait pas chaud : la mixture des Pluies, en plein été. */
  ete_pourri: { cielDeLaPhase: 3, socleDegres: -4 },
  /** Plus rien ne se garde frais : on fume, on sale, on cuit — ou on jette. */
  nuee: { peremption: 0.5 },
  // ── les Pluies ──────────────────────────────────────────────────────────────────────
  /**
   * Quatre à six jours d'affilée : la saison se passe à l'abri. **ET ELLE SE CONTREDIT, c'est le
   * point** (spec `cendre.md` R18) : la pluie noie la cendre — elle n'avance presque plus — mais
   * elle empêche aussi d'allumer un feu, donc tenir un foyer devient deux fois moins efficace.
   * Un répit qu'on SUBIT au lieu d'en profiter.
   */
  deluge: { episode: [4, 6], cendre: 0.4, cendreGel: 0.5 },
  /** Quinze jours de douceur en plus — la fenêtre de semis s'allonge, la gelée recule. */
  ete_indien: { socleJours: -15 },
  /** Les réserves tournent et la cueillette rend moins. */
  rouille: { peremption: 0.7, repousse: 1.5 },
  /** Les cerfs s'appellent : repérables de loin, et les mâles CHARGENT au lieu de fuir. */
  brame: { brame: 2 },
  // ── le Grand Froid ──────────────────────────────────────────────────────────────────
  /** Quatre degrés de moins : les lacs prennent tôt, la carte change de forme. Et le froid lève
   *  les morts (`CENDREUX.TORPEUR`) : le grand froid les lève plus fort (spec `cendre.md` R18). */
  hiver_noir: { socleDegres: -4, cendre: 1.4 },
  /** La neige ne fond plus : on marche au ralenti, la chasse devient du pistage. */
  grandes_neiges: { fonte: 3 },
  /** Le gibier a manqué : c'est l'hiver qui punit l'automne. */
  disette: { faunePlafond: 0.5 },
  /** Hordes plus grosses et plus fréquentes : l'hiver où l'on tient un mur. */
  meute: { plancherMenace: 0.85 },
  /** LA CENDRIÈRE SOUFFLE (décision d'Alexis, 2026-08-28). L'hiver où le ciel vient du sud :
   *  le front `vent_de_cendre` — inatteignable depuis S7, tout son câblage dormant (froid
   *  3,2, conso de feu 1,8, vision 0,55, bord FORCÉ au sud) — redevient le ciel dominant de
   *  la saison. Un dépôt gris sur la neige, on ne voit pas à dix pas, et le gibier se tait :
   *  la violence, pas l'humidité. Poids : ordres de grandeur, à calibrer en jouant. */
  vents_de_cendre: { ciel: { vent_de_cendre: 0.5, pluie: 0.3, orage: 0.2 } },
}

/**
 * LES EFFETS EN VIGUEUR CE JOUR-LÀ — objet vide si la saison est ordinaire. Toujours le MÊME
 * objet pour un caractère donné : aucune allocation sur un chemin chaud.
 *
 * ⚠ LE CACHE D'UN JOUR n'est pas de l'état de simulation : c'est la mémoïsation d'une
 * FONCTION PURE, keyée sur son unique argument. Le déterminisme n'y perd rien (deux appels de
 * même argument rendaient déjà le même objet) et le replay non plus. Il existe parce que
 * `socleDuJour` et `seasonRamp` appellent ceci **par tuile** : sans lui, la remontée des tours
 * se paierait des milliers de fois par tick pour un résultat qui ne change qu'une fois par jour.
 */
let jourEnCache = Number.NaN
let effetsEnCache: EffetsModificateur = AUCUN

export function effetsDuJour(jour: number): EffetsModificateur {
  const j = Math.floor(jour)
  if (j === jourEnCache) return effetsEnCache
  const id = modificateurDuJour(j)
  jourEnCache = j
  effetsEnCache = id === null ? AUCUN : EFFETS[id]
  return effetsEnCache
}

/** Les effets d'un caractère nommé — pour les tests, les bancs et la chronique. */
export function effetsDe(id: ModificateurId): EffetsModificateur {
  return EFFETS[id]
}

/** LE NOM QUE LA CHRONIQUE DIT au premier jour de la saison (S18). Le HUD, lui, ne dit que
 *  la date : le monde annonce son caractère par ce qu'il fait, pas par un bandeau. */
export const NOMS_MODIFICATEUR: Readonly<Record<ModificateurId, string>> = {
  gelees_tardives: 'les Gelées tardives',
  crue: 'la Crue',
  grande_levee: 'la Grande Levée',
  reveil: 'le Réveil',
  canicule: 'la Canicule',
  orages_secs: 'les Orages secs',
  ete_pourri: 'l’Été pourri',
  nuee: 'la Nuée',
  deluge: 'le Déluge',
  ete_indien: 'l’Été indien',
  rouille: 'la Rouille',
  brame: 'le Brame',
  hiver_noir: 'l’Hiver noir',
  grandes_neiges: 'les Grandes Neiges',
  disette: 'la Disette',
  meute: 'la Meute',
  vents_de_cendre: 'les Vents de cendre',
}
