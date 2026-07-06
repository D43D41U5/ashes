/**
 * Prédiction locale & réconciliation par rejeu — le netcode de l'avatar local
 * (spec `docs/specs/reconciliation.md`). PUR : partagé Worker/serveur/tests,
 * aucune dépendance de rendu. Le client Phaser ne fait que câbler l'I/O.
 *
 * Architecture standard (Quake → Source → Overwatch ; Gambetta) : le client
 * prédit à pas fixe, numérote ses inputs, et se recale sur l'autorité en
 * REJOUANT les inputs non encore acquittés depuis l'état serveur. Braises étant
 * déterministe au bit près, le rejeu retombe pile sur l'autorité — une
 * correction n'est visible que sur une vraie misprédiction. La sim reste exacte
 * (`base` saute sur l'autorité) ; seul le RENDU est lissé (`renderOffset` qui
 * décroît) — on ne masque jamais une divergence en trichant sur l'état.
 */
import { TICK_DT_S } from './balance'
import { moveAvatar, type MoveWorld } from './collision'

const EPS = 1e-6

/** L'intention transmise à l'hôte et rejouée localement. */
export interface PredictInput {
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint: boolean
  block: boolean
}

/** Un input envoyé, conservé pour le rejeu tant qu'il n'est pas acquitté. */
export interface BufferedInput {
  seq: number
  input: PredictInput
  /** Modulateur de vitesse au moment de l'envoi (faim, blessure, blocage…) — rejoué tel quel. */
  speedScale: number
}

/** État de prédiction du client. Objet plat, sérialisable (invariant §3). */
export interface PredictionState {
  /** Ancre calée sur l'autorité : la position de sim exacte, à réconcilier. */
  base: { x: number; y: number }
  /** Écart visuel résiduel après une correction — décroît vers 0 (lissage de rendu). */
  renderOffset: { x: number; y: number }
  /** Inputs envoyés non encore acquittés (à rejouer). */
  pending: BufferedInput[]
  /** Reliquat de temps de frame < un tick, reporté (extrapolation de rendu). */
  pendingS: number
  /** Prochain numéro d'input à attribuer. */
  nextSeq: number
}

export function createPrediction(x: number, y: number): PredictionState {
  return { base: { x, y }, renderOffset: { x: 0, y: 0 }, pending: [], pendingS: 0, nextSeq: 1 }
}

/**
 * Avance la prédiction du temps de frame, consommé en sous-pas ENTIERS de tick
 * (chacun rejoue exactement un tick serveur → parité au bit près). Chaque tick :
 * numérote l'input, l'ajoute au buffer, avance l'ancre. Retourne les inputs à
 * transmettre à l'hôte (un par tick consommé) ; le reliquat < 1 tick est reporté.
 */
export function predictFrame(
  pred: PredictionState,
  world: MoveWorld,
  frameDtS: number,
  input: PredictInput,
  speedScale: number,
): BufferedInput[] {
  let remaining = pred.pendingS + frameDtS
  const sent: BufferedInput[] = []
  while (remaining >= TICK_DT_S - EPS) {
    const buffered: BufferedInput = { seq: pred.nextSeq++, input, speedScale }
    pred.pending.push(buffered)
    sent.push(buffered)
    const next = moveAvatar(world, pred.base.x, pred.base.y, input.dx, input.dy, TICK_DT_S, speedScale)
    pred.base = { x: next.x, y: next.y }
    remaining -= TICK_DT_S
  }
  pred.pendingS = remaining
  return sent
}

/**
 * Recale la prédiction sur l'autorité (spec R3-R6). Purge les inputs acquittés,
 * puis soit téléporte (écart > seuil : respawn, buffer vidé, pas de rejeu), soit
 * pose l'ancre sur l'autorité et REJOUE les inputs restants. L'écart entre
 * l'ancienne et la nouvelle ancre est versé dans `renderOffset` pour que le
 * sprite ne saute pas — la sim, elle, est exacte.
 */
export function reconcile(
  pred: PredictionState,
  world: MoveWorld,
  authoritative: { x: number; y: number },
  lastProcessedInput: number,
  snapDistanceTiles: number,
): void {
  pred.pending = pred.pending.filter((b) => b.seq > lastProcessedInput)

  const ex = authoritative.x - pred.base.x
  const ey = authoritative.y - pred.base.y
  if (ex * ex + ey * ey > snapDistanceTiles * snapDistanceTiles) {
    // Vrai téléport (respawn au Feu) : instantané, pas de lissage ni de rejeu.
    pred.base = { x: authoritative.x, y: authoritative.y }
    pred.pending = []
    pred.renderOffset = { x: 0, y: 0 }
    return
  }

  const oldBase = pred.base
  let replayed = { x: authoritative.x, y: authoritative.y }
  for (const b of pred.pending) {
    replayed = moveAvatar(world, replayed.x, replayed.y, b.input.dx, b.input.dy, TICK_DT_S, b.speedScale)
  }
  // La correction reste dans le rendu : nouvelle base + offset = ancienne base.
  pred.renderOffset = {
    x: pred.renderOffset.x + (oldBase.x - replayed.x),
    y: pred.renderOffset.y + (oldBase.y - replayed.y),
  }
  pred.base = replayed
}

/** Fait décroître l'écart visuel résiduel (appelé une fois par frame). */
export function decayRenderOffset(pred: PredictionState, factor: number): void {
  pred.renderOffset = { x: pred.renderOffset.x * factor, y: pred.renderOffset.y * factor }
}

/**
 * Position d'AFFICHAGE (spec R7) : l'ancre extrapolée du reliquat sous-tick (un
 * pas partiel résolu par collision, donc fluide et jamais dans un mur) plus
 * l'écart visuel résiduel. On devance de < 1 tick au lieu de retarder → pas de
 * latence ajoutée. N'altère pas l'état de sim.
 */
export function renderPosition(
  pred: PredictionState,
  world: MoveWorld,
  input: PredictInput,
  speedScale: number,
): { x: number; y: number } {
  const lead = moveAvatar(world, pred.base.x, pred.base.y, input.dx, input.dy, pred.pendingS, speedScale)
  return { x: lead.x + pred.renderOffset.x, y: lead.y + pred.renderOffset.y }
}
