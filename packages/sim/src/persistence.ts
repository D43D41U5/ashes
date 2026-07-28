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
import type { ResourceNode } from './economy'
import { appliqueDiffNoeuds, diffNoeuds, type BaseNoeuds, type DiffNoeuds } from './node-baseline'

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
  /**
   * LA SEED DU MONDE DONT C'EST LA CARTE — le lien qui manquait, et sans lequel la coupe
   * était dangereuse. Rien n'attachait une carte à SA partie : une carte d'un autre monde,
   * ou d'une autre taille, se recollait sans une erreur. Le pire cas n'était pas un plantage
   * mais un silence — une `cendre` plus courte que le terrain rend `undefined < front` FAUX,
   * donc **la tuile ne brûle jamais**, et le front de la saison s'arrête sans un bruit.
   *
   * Ce n'est pas théorique : `sim-worker.ts` écrit la carte et la partie en DEUX transactions.
   * Une interruption entre les deux, ou une lecture refusée par IndexedDB (quota, éviction)
   * qui fait repartir sur un monde neuf, suffit à laisser sur le disque la partie du monde A
   * et la carte du monde B — toutes deux valides. La seed les réconcilie ou refuse.
   */
  seed: number
  carte: SimState['map']
  /**
   * LES NŒUDS À LEUR NAISSANCE — la base contre laquelle l'autosave ne écrit qu'un diff.
   *
   * Une fois la carte sortie, les 125 686 nœuds faisaient **9,12 des 9,20 Mo restants**,
   * réécrits deux fois par minute alors qu'une poignée seulement bouge entre deux
   * sauvegardes. Leur part FIXE (`id`, `type`, `tx`, `ty`) naît avec le monde, exactement
   * comme la carte : elle voyage donc avec elle, dans le même enregistrement, écrit une
   * fois. Voir `node-baseline.ts`.
   */
  nodes: ResourceNode[]
}

/** Le monde à sa naissance, relu : sa carte, ses nœuds d'origine, et la seed qui les lie. */
export interface CarteSauvee {
  carte: SimState['map']
  nodes: ResourceNode[]
  seed: number
}

/**
 * L'état dont la carte est VIDÉE — et non RETIRÉE. La nuance est le contrat de déterminisme
 * du projet : `snapshot()` est un `JSON.stringify` de l'état, donc l'ORDRE DES CLÉS en fait
 * partie. Retirer `map` puis la recoller à la fin déplacerait la clé, et un monde repris ne
 * rendrait plus la même chaîne qu'un monde continu — « au bit près » tomberait sur un
 * détail de rangement. En laissant la clé en place avec `null`, l'ordre est intact des deux
 * côtés (réaffecter une clé existante ne la déplace pas), et le poids tombe à quatre octets.
 */
type PartieState = Omit<SimState, 'map' | 'nodes'> & { map: null; nodes: null }

interface PartieEnvelope {
  v: number
  partie: PartieState
  /** Ce qui a bougé dans les nœuds depuis la naissance du monde (voir `node-baseline.ts`). */
  noeuds: DiffNoeuds
}

/**
 * Sérialise LE MONDE À SA NAISSANCE — la carte et les nœuds d'origine. Écrit une fois,
 * jamais réécrit : c'est tout l'intérêt (86,9 % du poids pour la carte, 99 % du reste
 * pour les nœuds).
 */
export function serializeCarte(map: SimState['map'], seed: number, nodes: readonly ResourceNode[]): string {
  const envelope: CarteEnvelope = { v: SAVE_FORMAT_VERSION, seed, carte: map, nodes: nodes as ResourceNode[] }
  return JSON.stringify(envelope)
}

/**
 * Relit une carte écrite par `serializeCarte`. JETTE si elle est illisible, périmée, ou
 * INCOMPLÈTE — et c'est ce dernier point qui compte. Une carte à moitié écrite passait
 * autrefois toutes les vérifications (« un tableau, une largeur ») et rendait un monde
 * silencieusement faux : un relief tronqué, une `cendre` plus courte que le terrain, un
 * avatar hors carte. On vérifie donc que les tailles se RÉPONDENT, pas seulement qu'elles
 * existent.
 */
export function deserializeCarte(text: string): CarteSauvee {
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
  if (typeof c !== 'object' || c === null || !Array.isArray(c.terrain) || typeof c.width !== 'number' || typeof c.height !== 'number') {
    throw new Error('Carte illisible : relief absent')
  }
  const attendu = c.width * c.height
  if (c.terrain.length !== attendu) {
    throw new Error(`Carte tronquée : ${c.terrain.length} tuiles pour ${c.width}×${c.height} = ${attendu}`)
  }
  // `cendre` est optionnelle (une carte sans Cendrière n'en a pas) — mais si elle est là, elle
  // couvre TOUTE la carte. Une `cendre` courte ne jette pas : elle éteint le front en silence.
  if (c.cendre !== undefined && (!Array.isArray(c.cendre) || c.cendre.length !== attendu)) {
    throw new Error(`Champ de cendre tronqué : ${Array.isArray(c.cendre) ? c.cendre.length : 'absent'} pour ${attendu} tuiles`)
  }
  if (typeof env.seed !== 'number') {
    throw new Error("Carte illisible : elle ne dit pas de quel monde elle est (seed absente)")
  }
  if (!Array.isArray(env.nodes)) {
    throw new Error('Carte illisible : les nœuds de naissance sont absents')
  }
  return { carte: env.carte, nodes: env.nodes, seed: env.seed }
}

/**
 * Sérialise LA PARTIE — tout sauf la carte et les nœuds, plus le DIFF des nœuds. C'est ce
 * que l'autosave réécrit, et c'est tout ce qui gèle encore le monde.
 *
 * L'étalement `{ ...state, map: null, nodes: null }` est SUPERFICIEL : il recopie une
 * quarantaine de références, pas les 7,5 M de nombres de la carte ni les 125 686 nœuds.
 * C'est le `JSON.stringify` qui coûtait, et c'est lui qu'on allège.
 *
 * `base` est l'état mobile des nœuds tel qu'il a été ÉCRIT au disque (`baseDepuisNoeuds`
 * sur les nœuds de l'enregistrement de naissance) — pas l'état d'il y a trente secondes.
 * Un diff cumulatif se recolle en une passe et ne dépend d'aucune sauvegarde intermédiaire ;
 * un diff incrémental aurait exigé de les rejouer toutes, et d'en perdre une aurait suffi.
 */
export function serializePartie(state: SimState, base: BaseNoeuds): string {
  const partie: PartieState = { ...state, map: null, nodes: null }
  const envelope: PartieEnvelope = {
    v: SAVE_FORMAT_VERSION,
    partie,
    noeuds: diffNoeuds(state.nodes, base),
  }
  return JSON.stringify(envelope)
}

/**
 * Recolle une partie et sa carte en un `SimState` reprenable. Mêmes refus francs que
 * `deserializeSim` : version inconnue ou forme incomplète ⇒ on ne reprend pas.
 */
export function deserializePartie(text: string, carte: CarteSauvee): SimState {
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
  // LA CARTE EST-ELLE CELLE DE CETTE PARTIE ? Deux écritures séparées, donc deux moments où
  // le disque peut porter la partie d'un monde et la carte d'un autre — toutes deux valides.
  // Sans cette ligne, on recollerait les deux et on rendrait un monde faux SANS ERREUR.
  if (carte.seed !== env.partie.seed) {
    throw new Error(`Carte d'un autre monde : seed ${carte.seed} ≠ ${env.partie.seed}`)
  }
  const map = carte.carte
  if (typeof env.noeuds !== 'object' || env.noeuds === null || !Array.isArray(env.noeuds.bouges)) {
    throw new Error('Veillée illisible : le diff des nœuds est absent')
  }
  // LA GARDE DE FORME PASSE EN PREMIER, et elle porte sur `env.partie` — où `map` et `nodes`
  // sont présentes (à `null`), donc la liste des champs requis s'y confronte telle quelle.
  // L'ordre compte : une enveloppe amputée doit se faire refuser POUR CE QU'ELLE EST, et non
  // se voir reprocher un recollage de nœuds qui n'avait aucune chance d'aboutir.
  const manquants = SAVE_REQUIRED_KEYS.filter((k) => !Object.hasOwn(env.partie, k))
  if (manquants.length > 0) {
    throw new Error(`Veillée d'un format antérieur : ${manquants.length} champ(s) manquant(s) — ${manquants.join(', ')}`)
  }
  // `map` et `nodes` sont déjà des clés de `env.partie` (à `null`) : les réaffecter les
  // remplit SANS les déplacer — l'ordre des clés, donc `snapshot()`, reste celui d'un monde
  // jamais sauvé. `appliqueDiffNoeuds` JETTE si le recollage ne rend pas la liste attendue.
  const nodes = appliqueDiffNoeuds(carte.nodes, env.noeuds)
  return { ...env.partie, map, nodes } as SimState
}
