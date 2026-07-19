/**
 * Vraisemblance des inputs — l'anti-triche LÉGER de L1 (roadmap : « validation de
 * vraisemblance des inputs »). Le serveur reçoit des messages bruts du réseau : on
 * en vérifie la FORME et la monotonie, rien de plus. La LÉGALITÉ d'une action
 * (droits, coûts, portée) est déjà tranchée par /sim, qui émet `action_rejected` —
 * on ne recopie pas ses règles ici. Et le mouvement est autoritatif dans `step` :
 * un client ne peut pas mentir sur sa position, donc inonder d'inputs n'achète rien
 * (on ne garde que le dernier par tick), on borne juste la mémoire.
 *
 * PUR — aucune dépendance Colyseus, testé dans `validate.test.ts`.
 */
import { CHAT_MAX_LEN, type PlayerAction } from '@braises/sim'

/** L'input assaini que le serveur applique (miroir de `MoveInput` moins l'action). */
export interface SanitizedInput {
  seq: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint: boolean
  sneak: boolean
  block: boolean
}

function isAxis(v: unknown): v is -1 | 0 | 1 {
  return v === -1 || v === 0 || v === 1
}

/**
 * Le message protocole `join` — le client l'envoie APRÈS avoir posé ses handlers,
 * et c'est LUI qui déclenche le spawn + `ready` (comme le worker solo). Répondre à
 * la connexion Colyseus elle-même exposerait à une course : `ready` pourrait devancer
 * l'enregistrement du `onMessage` client et se perdre.
 */
export function isJoinMessage(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'join'
}

/**
 * Un message de chat : `text` est une chaîne, coupée aux `CHAT_MAX_LEN` et rognée.
 * Retourne le texte assaini, ou `null` (message vide ou malformé — on ne relaie rien).
 */
export function sanitizeChat(msg: unknown): string | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'chat' || typeof m.text !== 'string') return null
  const text = m.text.trim().slice(0, CHAT_MAX_LEN)
  return text.length > 0 ? text : null
}

/**
 * Un message d'input brut est-il vraisemblable ? Retourne l'input assaini, ou
 * `null` (le message est jeté). Rejette : mauvaise forme, axes hors {-1,0,1},
 * `seq` non fini, et `seq ≤ lastSeq` (rejeu, doublon réseau, ou séquence qui
 * ne croît pas). Les booléens sont coercés — un client space ne casse rien.
 */
export function sanitizeInput(msg: unknown, lastSeq: number): SanitizedInput | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'input') return null
  if (!isAxis(m.dx) || !isAxis(m.dy)) return null
  if (typeof m.seq !== 'number' || !Number.isFinite(m.seq)) return null
  if (m.seq <= lastSeq) return null
  return { seq: m.seq, dx: m.dx, dy: m.dy, sprint: !!m.sprint, sneak: !!m.sneak, block: !!m.block }
}

/**
 * Enveloppe d'une action : présente, et son `type` est une chaîne. On ne va pas
 * plus loin — /sim valide le fond et refuse proprement (`action_rejected`). Retourne
 * l'action, ou `null` si l'enveloppe est malformée.
 */
export function sanitizeAction(msg: unknown): PlayerAction | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'action') return null
  const action = m.action
  if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') return null
  return action as PlayerAction
}
