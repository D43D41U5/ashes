/**
 * LA PERSISTANCE — sérialiser une Veillée pour la REPRENDRE (décision d'Alexis
 * 2026-07-19 ; spec `docs/specs/persistence-veillee.md`).
 *
 * PURE, JSON seul : l'invariant §2 garantit que `SimState` n'a ni classe, ni `Map`/
 * `Set` — donc `JSON.parse(JSON.stringify(state))` reconstitue un état FONCTIONNEL,
 * qui reprend le pas au bit près (contrat éprouvé par `persistence.test.ts`). C'est
 * l'assise du multi-slot : l'hôte (le Worker Veillée) écrit/lit la chaîne dans
 * IndexedDB, /sim ne connaît ni le disque ni l'horloge.
 *
 * Le format est VERSIONNÉ : la forme de `SimState` évoluera, et une sauvegarde d'hier
 * doit se relire — ou se refuser proprement — demain. On enveloppe l'état dans
 * `{ v, sim }` ; `deserializeSim` rejette une version inconnue plutôt que de rendre un
 * état à moitié compris. Les métadonnées d'AFFICHAGE du slot ne vivent PAS ici : le
 * jour/acte se dérivent de l'état pur (`seasonDayAtTick`/`actForDay`), et le temps de
 * jeu comme la « dernière fois vue » sont de l'horloge murale — donc de l'hôte (§2).
 */
import type { SimState } from './sim'

/**
 * Version du FORMAT de sauvegarde. À INCRÉMENTER à tout changement incompatible de la
 * forme de `SimState`. La migration montante des versions antérieures se grefferait
 * dans `deserializeSim`, quand il y en aura. (1 = le format d'origine.)
 */
export const SAVE_FORMAT_VERSION = 1

/**
 * LES CHAMPS QU'UN ÉTAT REPRENABLE DOIT PORTER — et pourquoi cette liste existe.
 *
 * Le numéro de version ne protégeait RIEN tout seul. Il faut se souvenir de
 * l'incrémenter, et `SimState` gagne des champs au fil des systèmes : une sauvegarde
 * faite avant l'ajout garde le MÊME numéro de version, passe donc la garde
 * `env.v !== SAVE_FORMAT_VERSION`, et repart avec un champ manquant — `step()` jette
 * alors au premier tick, à chaque lancement. Le pire cas exact que l'en-tête de
 * `sim-worker.ts` promet d'éviter (« une sauvegarde illisible ne bloque pas : on
 * repart à neuf ») : elle n'est pas illisible, elle est INCOMPLÈTE, et personne ne
 * regarde.
 *
 * On vérifie donc la FORME, pas seulement le numéro. La liste est figée ici plutôt
 * que dérivée d'un `createSim()` à chaque lecture (qui coûterait un monde entier) —
 * et `persistence.test.ts` la CONFRONTE à `Object.keys(createSim(1))` : ajouter un
 * champ à `SimState` rend le test rouge, et l'auteur doit alors trancher
 * explicitement — incrémenter la version, ou rendre le champ optionnel avec sa valeur
 * de repli. C'est la décision qui manquait ; elle n'est plus contournable en silence.
 */
export const SAVE_REQUIRED_KEYS: readonly string[] = [
  'aggressions', 'blood', 'calendarScale', 'corpses', 'cycleOffset', 'debug', 'denRespawns',
  'dens', 'entities', 'evacuatedIds', 'evacuation', 'events', 'faunaCap', 'faunaQuiet',
  'functions', 'groundItems', 'grounds', 'home', 'hordes', 'lastConvoyDay', 'lastRefugeeDay',
  'map', 'megaHordeSpawned', 'monsters', 'nextCorpseId', 'nextEntityId', 'nextGroundItemId',
  'nextHerdId', 'nextHordeId', 'nextRefugeeGroupId', 'nextStructureId', 'nextVillageId',
  'nodes', 'npcs', 'refugeeGroups', 'rngState', 'seasonEnded', 'seed', 'structures', 'tick',
  'villages', 'visitedPois', 'wind', 'worldEvents',
]

interface SaveEnvelope {
  v: number
  sim: SimState
}

/** Sérialise un état de Veillée en une chaîne reprenable (enveloppe versionnée). */
export function serializeSim(state: SimState): string {
  const envelope: SaveEnvelope = { v: SAVE_FORMAT_VERSION, sim: state }
  return JSON.stringify(envelope)
}

/**
 * Reconstitue un `SimState` reprenable depuis une chaîne `serializeSim`. JETTE sur une
 * chaîne illisible ou d'une version de format inconnue — on ne reprend JAMAIS un état à
 * moitié compris. La rétro-compat des versions ANTÉRIEURES se grefferait ici.
 */
export function deserializeSim(text: string): SimState {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Veillée illisible : JSON invalide')
  }
  if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || !('sim' in parsed)) {
    throw new Error('Veillée illisible : enveloppe de sauvegarde absente')
  }
  const env = parsed as SaveEnvelope
  if (env.v !== SAVE_FORMAT_VERSION) {
    throw new Error(`Veillée d'une version incompatible (v${env.v} ≠ v${SAVE_FORMAT_VERSION})`)
  }
  // LA FORME, pas seulement le numéro (voir `SAVE_REQUIRED_KEYS`). Une sauvegarde d'avant
  // l'ajout d'un champ porte le même numéro de version et passerait la garde ci-dessus ;
  // elle repartirait amputée, et `step` jetterait au premier tick — à chaque lancement.
  // On la refuse ICI, franchement, pour que l'hôte fasse ce qu'il promet : repartir à neuf.
  if (typeof env.sim !== 'object' || env.sim === null) {
    throw new Error('Veillée illisible : état absent')
  }
  const manquants = SAVE_REQUIRED_KEYS.filter((k) => !Object.hasOwn(env.sim, k))
  if (manquants.length > 0) {
    throw new Error(`Veillée d'un format antérieur : ${manquants.length} champ(s) manquant(s) — ${manquants.join(', ')}`)
  }
  return env.sim
}

/* ─── LA CARTE À PART — ce qui ne bouge pas ne se réécrit pas ────────────────────── */

/**
 * POURQUOI LA CARTE SORT DE LA SAUVEGARDE PÉRIODIQUE.
 *
 * MESURÉ le 2026-07-28, dans le Worker du navigateur (le moteur qui joue vraiment la
 * Veillée, pas Node) : une sauvegarde pèse **69,7 Mo** et sa sérialisation JSON **arrête le
 * monde 2,4 à 2,5 s**. L'autosave tombe toutes les 30 s : sur 80 s de jeu observées, elle
 * fut la cause des TROIS seuls gels — 8 % du temps de jeu passé le monde à l'arrêt, pendant
 * que les PNJ, les bêtes et l'horloge se figent puis sautent.
 *
 * Or **86,9 % de ce poids ne change JAMAIS** : `map.cendre` (50,7 Mo — le champ de distance
 * à la Cendrière, « calculé une fois, jamais modifié ») et `map.terrain` (9,7 Mo). La carte
 * naît avec le monde et lui survit sans une ride ; la réécrire deux fois par minute est un
 * pur gaspillage, payé en gels.
 *
 * On la sort donc du chemin chaud : écrite UNE FOIS à la naissance du monde, relue au
 * démarrage, recollée à l'état. L'autosave ne porte plus que ce qui bouge (~9,15 Mo).
 *
 * CE SUR QUOI ÇA REPOSE : `step()` n'écrit jamais dans `state.map`. Ce n'est pas une
 * intention, c'est une garde — `carte-immuable.test.ts` fait vivre le monde de production
 * (mille ticks, front de cendre au maximum, récolte, construction, fondation) et exige que
 * l'empreinte de la carte en ressorte identique. Si cette garde tombe un jour au rouge, ce
 * n'est pas elle qu'il faut assouplir : c'est cette coupe-ci qu'il faut retirer.
 */
interface CarteEnvelope {
  v: number
  carte: SimState['map']
}

/**
 * L'état dont la carte est VIDÉE — et non RETIRÉE. La nuance est le contrat de déterminisme
 * du projet : `snapshot()` est un `JSON.stringify` de l'état, donc l'ORDRE DES CLÉS en fait
 * partie. Retirer `map` puis la recoller à la fin déplacerait la clé, et un monde repris ne
 * rendrait plus la même chaîne qu'un monde continu — « au bit près » tomberait sur un
 * détail de rangement. En laissant la clé en place avec `null`, l'ordre est intact des deux
 * côtés (réaffecter une clé existante ne la déplace pas), et le poids tombe à quatre octets.
 */
type PartieState = Omit<SimState, 'map'> & { map: null }

interface PartieEnvelope {
  v: number
  partie: PartieState
}

/** Sérialise LA CARTE seule (immuable) — écrite une fois, à la naissance du monde. */
export function serializeCarte(map: SimState['map']): string {
  const envelope: CarteEnvelope = { v: SAVE_FORMAT_VERSION, carte: map }
  return JSON.stringify(envelope)
}

/** Relit une carte écrite par `serializeCarte`. JETTE si elle est illisible ou périmée. */
export function deserializeCarte(text: string): SimState['map'] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Carte illisible : JSON invalide')
  }
  if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || !('carte' in parsed)) {
    throw new Error('Carte illisible : enveloppe absente')
  }
  const env = parsed as CarteEnvelope
  if (env.v !== SAVE_FORMAT_VERSION) {
    throw new Error(`Carte d'une version incompatible (v${env.v} ≠ v${SAVE_FORMAT_VERSION})`)
  }
  const c = env.carte as Partial<SimState['map']> | null
  if (typeof c !== 'object' || c === null || !Array.isArray(c.terrain) || typeof c.width !== 'number') {
    throw new Error('Carte illisible : relief absent')
  }
  return env.carte
}

/**
 * Sérialise LA PARTIE (tout sauf la carte) — c'est ce que l'autosave réécrit.
 *
 * L'étalement `{ ...state, map: null }` est SUPERFICIEL : il recopie une quarantaine de
 * références, pas les 7,5 M de nombres de la carte. C'est le `JSON.stringify` qui coûtait,
 * et c'est lui qu'on allège.
 */
export function serializePartie(state: SimState): string {
  const partie: PartieState = { ...state, map: null }
  const envelope: PartieEnvelope = { v: SAVE_FORMAT_VERSION, partie }
  return JSON.stringify(envelope)
}

/**
 * Recolle une partie et sa carte en un `SimState` reprenable. Mêmes refus francs que
 * `deserializeSim` : version inconnue ou forme incomplète ⇒ on ne reprend pas.
 */
export function deserializePartie(text: string, map: SimState['map']): SimState {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Veillée illisible : JSON invalide')
  }
  if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || !('partie' in parsed)) {
    throw new Error('Veillée illisible : enveloppe de sauvegarde absente')
  }
  const env = parsed as PartieEnvelope
  if (env.v !== SAVE_FORMAT_VERSION) {
    throw new Error(`Veillée d'une version incompatible (v${env.v} ≠ v${SAVE_FORMAT_VERSION})`)
  }
  if (typeof env.partie !== 'object' || env.partie === null) {
    throw new Error('Veillée illisible : état absent')
  }
  // `map` est déjà une clé de `env.partie` (à `null`) : la réaffecter la remplit SANS la
  // déplacer — l'ordre des clés, donc `snapshot()`, reste celui d'un monde jamais sauvé.
  const etat = { ...env.partie, map } as SimState
  // La MÊME garde de forme que la sauvegarde d'un seul tenant : `map` vient d'être recollée,
  // tout le reste doit être là. Un champ neuf de `SimState` oublié ici se verrait donc
  // exactement comme avant — la coupe ne crée pas un trou dans le filet.
  const manquants = SAVE_REQUIRED_KEYS.filter((k) => !Object.hasOwn(etat, k))
  if (manquants.length > 0) {
    throw new Error(`Veillée d'un format antérieur : ${manquants.length} champ(s) manquant(s) — ${manquants.join(', ')}`)
  }
  return etat
}
