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
import { VENT } from './balance'
import type { SimState } from './sim'
import type { ResourceNode } from './economy'
import { appliqueDiffNoeuds, baseDepuisNoeuds, diffNoeuds, type BaseNoeuds, type DiffNoeuds } from './node-baseline'

/**
 * Version du FORMAT de sauvegarde. À INCRÉMENTER à tout changement incompatible de la
 * forme de `SimState`. La migration montante des versions antérieures se grefferait
 * dans `deserializeSim`, quand il y en aura. (1 = le format d'origine.)
 */
export const SAVE_FORMAT_VERSION = 1

/**
 * LES CHAMPS ÉPHÉMÈRES QU'UNE SAUVEGARDE D'AVANT PEUT NE PAS PORTER — et leur valeur de repli.
 *
 * `SAVE_REQUIRED_KEYS` pose la bonne question à l'auteur d'un champ neuf : incrémenter la
 * version, ou donner un repli ? Bosser la version rend TOUTES les vallées en cours illisibles.
 * Ça se justifie pour un champ dont l'absence change la partie ; ça ne se justifie pas pour un
 * champ dont la durée de vie se compte en secondes.
 *
 * `reveils` (spec `cendreux.md` R21) est de ce genre : un sol qui travaille dure quatre
 * secondes. Le perdre à la relecture, c'est perdre un réveil que le joueur n'aurait de toute
 * façon pas fini de voir — et un tableau vide est un état parfaitement cohérent, pas une
 * amputation. On le recolle donc au lieu de refuser la vallée.
 *
 * La liste reste DÉLIBÉRÉE : y inscrire un champ est une décision, exactement comme bosser la
 * version. Ce qui n'y est pas continue de faire échouer la relecture, franchement.
 */
const REPLIS_EPHEMERES: Readonly<Record<string, () => unknown>> = {
  reveils: () => [],
  // LE JOUR DE DÉPART (S2, 2026-08-23) : une vallée d'AVANT la refonte des saisons a
  // forcément ouvert au jour 1 — c'était le seul jour d'ouverture possible. Le repli dit
  // donc la vérité de ces sauvegardes-là, et lui seul ; toute vallée née après porte le champ.
  jourDeDepart: () => 1,
  // LE PRÉSAGE (2026-08-21) : une vieille vallée n'a jamais vu d'aube décider sa nuit —
  // null est sa vérité, et le prochain lever de jour en tirera un vrai. (`megaHordeSpawned`,
  // lui, est SORTI de l'état avec la méga-horde scriptée — décision ⑲ ; la clé excédentaire
  // d'une vieille sauvegarde est inerte, la garde ne cherche que les manquants.)
  presage: () => null,
  // LA FORCE DU VENT (`vent.md` V3, 2026-08-24) : elle est DÉRIVÉE — `advanceVent` la
  // recalcule du front à chaque tick, et la sauvegarde n'en porte qu'une photo. Une vallée
  // d'avant l'unification n'a donc rien perdu en ne l'ayant pas : le premier tick lui rend sa
  // valeur exacte. Bosser la version pour un champ qui se reconstitue en 50 ms aurait rendu
  // toutes les vallées en cours illisibles — c'est précisément ce que cette table existe pour
  // éviter. Le repli dit l'ambiance, la valeur d'un monde sans front.
  windForce: () => VENT.AMBIANT,
  // LES LIEUX BRÛLÉS (2026-08-21) : une vieille vallée n'a jamais rien brûlé — [] est sa
  // vérité. Les sauvegardes NEUVES, elles, portent la clé : rien ne s'y oublie.
  lieuxBrules: () => [],
  // Pas éphémère, mais un repli HONNÊTE existe : une sauvegarde d'avant le champ (2026-08-16)
  // n'a jamais vu l'Arche partir — `false` est la vérité de ce monde-là. Une vallée d'avant
  // sauvée APRÈS le jour 58 portait la boucle ouvre→part du bug : recollée à `false`, l'Arche
  // y repart une dernière fois puis se verrouille — l'état guérit de lui-même.
  arkDeparted: () => false,
  // LA FIN DE SAISON (saison-sans-fin T4, 2026-08-21) : une Veillée d'avant le pivot n'a pas
  // de réglage — et la règle du solo est « jamais » (R4). `null` est donc sa vérité : elle ne
  // finit plus, comme toute Veillée neuve. Bosser la version pour ça aurait rendu illisibles
  // toutes les vallées en cours, pour leur dire une chose qu'un repli dit mieux.
  finDeSaison: () => null,
}

/** Recolle les champs éphémères absents d'une sauvegarde antérieure. Rend les clés manquantes. */
function comblerEphemeres(brut: Record<string, unknown>): string[] {
  const restants: string[] = []
  for (const k of Object.keys(REPLIS_EPHEMERES)) {
    if (Object.hasOwn(brut, k)) continue
    const repli = REPLIS_EPHEMERES[k]
    if (repli) brut[k] = repli()
    else restants.push(k)
  }
  return restants
}

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
  // `cendreAge` / `cendreJour` (spec `cendre.md`) : les dix âges de foyer et le dernier jour
  // traité. **Ils DOIVENT être sauvés** — ce sont les seuls octets de la mécanique, et une reprise
  // qui les perdrait rendrait au joueur une vallée revenue à sa tache initiale.
  'aggressions', 'arkDeparted', 'blood', 'calendarScale', 'cendreAge', 'cendreJour', 'corpses', 'cycleOffset', 'debug', 'denRespawns',
  'dens', 'entities', 'evacuatedIds', 'evacuation', 'events', 'faunaCap', 'faunaQuiet', 'finDeSaison',
  'functions', 'groundItems', 'grounds', 'home', 'hordes', 'lastConvoyDay', 'lastRefugeeDay',
  'jourDeDepart', 'map', 'monsters', 'nextCorpseId', 'nextEntityId', 'nextGroundItemId',
  'nextHerdId', 'nextHordeId', 'nextRefugeeGroupId', 'nextStructureId', 'nextVillageId',
  'lieuxBrules', 'nodes', 'npcs', 'presage', 'refugeeGroups', 'reveils', 'rngState', 'seasonEnded', 'seed', 'structures', 'tick',
  'villages', 'visitedPois', 'wind', 'windForce', 'worldEvents',
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
  comblerEphemeres(env.sim as unknown as Record<string, unknown>)
  const manquants = SAVE_REQUIRED_KEYS.filter((k) => !Object.hasOwn(env.sim, k))
  if (manquants.length > 0) {
    throw new Error(`Veillée d'un format antérieur : ${manquants.length} champ(s) manquant(s) — ${manquants.join(', ')}`)
  }
  migrerParoiEnMassif(env.sim)
  return env.sim
}

/**
 * MIGRATION `paroi` → `massif` (révision du 2026-08-11) — on n'orpheline JAMAIS une
 * sauvegarde (la philosophie des clés `braises`). Les Veillées du 2026-08-10 portent des
 * structures `paroi` — la barrière d'arête d'antre, morte avec la révision : son type
 * n'existe plus au registre, et le premier `structureBlocks` d'un pathfinding jetterait
 * (MESURÉ : TypeError au premier tick). Elle devient du `massif` PLEIN (les arêtes
 * tombent — la roche est une masse, pas un trait) : la géométrie diffère du généré neuf,
 * mais le lieu reste clos, infranchissable et incassable — la promesse tenue.
 */
function migrerParoiEnMassif(sim: SimState): void {
  for (const s of sim.structures) {
    if ((s.type as string) === 'paroi') {
      s.type = 'massif'
      delete s.edges
    }
  }
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
  // `profondeur` (§2quater) est optionnelle (carte d'avant l'étage 2) — mais si elle est là,
  // elle couvre toute la carte. Même loi que `cendre` : tronquée, on jette — une profondeur
  // fausse donnerait des vieux fûts et un couvert au mauvais endroit, en silence.
  if (c.profondeur !== undefined && (!Array.isArray(c.profondeur) || c.profondeur.length !== attendu)) {
    throw new Error(`Champ de profondeur tronqué : ${Array.isArray(c.profondeur) ? c.profondeur.length : 'absent'} pour ${attendu} tuiles`)
  }
  // `distEau` (`saisons.md` S10) est optionnelle (carte d'avant les saisons) — mais si elle est
  // là, elle couvre toute la carte. Même loi que les deux précédentes, et le silence y serait
  // pire : `distanceALEau` rend **0** hors du tableau, ce qui ne jette pas — ça rend la crue
  // FAUSSE, partout, sans un mot. Tronquée, on jette.
  if (c.distEau !== undefined && (!Array.isArray(c.distEau) || c.distEau.length !== attendu)) {
    throw new Error(`Champ de distance à l'eau tronqué : ${Array.isArray(c.distEau) ? c.distEau.length : 'absent'} pour ${attendu} tuiles`)
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
  comblerEphemeres(env.partie as unknown as Record<string, unknown>)
  const manquants = SAVE_REQUIRED_KEYS.filter((k) => !Object.hasOwn(env.partie, k))
  if (manquants.length > 0) {
    throw new Error(`Veillée d'un format antérieur : ${manquants.length} champ(s) manquant(s) — ${manquants.join(', ')}`)
  }
  // `map` et `nodes` sont déjà des clés de `env.partie` (à `null`) : les réaffecter les
  // remplit SANS les déplacer — l'ordre des clés, donc `snapshot()`, reste celui d'un monde
  // jamais sauvé. `appliqueDiffNoeuds` JETTE si le recollage ne rend pas la liste attendue.
  const nodes = appliqueDiffNoeuds(carte.nodes, env.noeuds)
  const sim = { ...env.partie, map, nodes } as SimState
  migrerParoiEnMassif(sim) //  les parties du 2026-08-10 portent des `paroi` (cf. la migration)
  return sim
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * LE COFFRE — LA POLITIQUE DE SAUVEGARDE, SORTIE DE L'HÔTE POUR ÊTRE TESTABLE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * La carte pèse 86,9 % de la sauvegarde et ne change jamais : on l'écrit UNE fois, à la
 * NAISSANCE, et tout ce qui suit n'est qu'un diff de la partie contre l'état de ce
 * jour-là. Cette politique vivait entière dans `worker/sim-worker.ts`, où rien ne la
 * testait — et `persistence.test.ts` la RECOPIAIT pour pouvoir l'éprouver, en écrivant
 * lui-même que « reproduire ça ici est le seul moyen de tester ce que sim-worker fait
 * vraiment ». Un test qui éprouve un sosie ne garde pas l'original : c'est exactement par
 * là qu'est passée la faille ci-dessous.
 *
 * ⚠ LA FAILLE QUE CETTE FORME REND IMPOSSIBLE. L'hôte tenait DEUX drapeaux pour UN SEUL
 * fait — « ce que le disque porte » : `carteEcrite`, posé APRÈS le succès de l'écriture,
 * et la base des nœuds, posée AVANT toute écriture et jamais reprise en cas d'échec. Un
 * premier autosave refusé (quota, éviction, stockage interdit — et c'est la sauvegarde la
 * plus lourde, donc la plus exposée) suivi d'un second réussi écrivait au disque la carte
 * de T2 et un diff calculé contre la base de T1. À la reprise, `appliqueDiffNoeuds`
 * reposait les nœuds nés entre les deux, l'empreinte des identifiants divergeait, la
 * fonction jetait, le repli jetait à son tour — et l'hôte rouvrait une vallée NEUVE sans
 * un mot. La Veillée perdue, en silence.
 *
 * Ici la base n'est ENGAGÉE qu'au succès. Tant que l'écriture n'a pas abouti, elle est
 * « en vol » : un échec la jette, et la prochaine sauvegarde recommence une naissance.
 * Les deux drapeaux n'en font plus qu'un, donc ils ne peuvent plus diverger.
 */

/** Ce que l'hôte doit écrire à cette sauvegarde — et donc dans quelle transaction. */
export type EcritureDeSauvegarde =
  /** NAISSANCE : la carte ET la partie, ensemble ou pas du tout. */
  | { quoi: 'naissance'; carte: string; partie: string }
  /** RÉGIME : la partie seule, diffée contre la naissance déjà au disque. */
  | { quoi: 'partie'; partie: string }

export interface Coffre {
  /** Sérialise ce qu'il faut écrire maintenant. N'engage rien : appeler `reussi`/`echoue` après. */
  prochaine: (state: SimState) => EcritureDeSauvegarde
  /** L'écriture a abouti : la base devient celle que le disque porte. */
  reussi: () => void
  /** L'écriture a échoué : rien n'est parti, donc rien n'est engagé. */
  echoue: () => void
}

/**
 * @param baseAuDisque la base de la naissance déjà écrite, quand on REPREND une partie. Sans
 * elle, le coffre considère que le disque ne porte rien et redemande une naissance — ce qui
 * est exactement ce qu'il faut pour un monde neuf ou une sauvegarde d'ancien format.
 */
export function creerCoffre(baseAuDisque?: BaseNoeuds): Coffre {
  // Ce que le DISQUE porte (undefined tant qu'aucune naissance n'a abouti).
  let engagee: BaseNoeuds | undefined = baseAuDisque
  // Ce que l'écriture en cours PRÉTEND poser — engagé au succès, jeté à l'échec.
  let enVol: BaseNoeuds | undefined
  return {
    prochaine(state: SimState): EcritureDeSauvegarde {
      if (engagee === undefined) {
        // La base se prend sur l'état d'AVANT la sérialisation : c'est celui-là qui part au
        // disque dans le même geste, et le diff des sauvegardes suivantes s'y adosse.
        const base = baseDepuisNoeuds(state.nodes)
        enVol = base
        return {
          quoi: 'naissance',
          carte: serializeCarte(state.map, state.seed, state.nodes),
          partie: serializePartie(state, base),
        }
      }
      return { quoi: 'partie', partie: serializePartie(state, engagee) }
    },
    reussi(): void {
      if (enVol !== undefined) engagee = enVol
      enVol = undefined
    },
    echoue(): void {
      enVol = undefined
    },
  }
}
