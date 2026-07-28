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
