/**
 * @braises/client — Phaser 4 + Vite : rendu, input, interpolation, UI.
 *
 * Placeholder. Arrive à l'étape 4 de la Phase Veillée (voir CLAUDE.md) :
 * un client Phaser qui AFFICHE la simulation tournant dans un Web Worker.
 * Le client est « bête » : il envoie des inputs et interpole des snapshots ;
 * la seule prédiction locale autorisée est le déplacement de son avatar.
 */
import { BALANCE } from '@braises/sim'

export const CLIENT_READY = false as const
export const EXPECTED_TICK_RATE_HZ = BALANCE.TICK_RATE_HZ
