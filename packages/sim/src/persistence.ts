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
  return env.sim
}
