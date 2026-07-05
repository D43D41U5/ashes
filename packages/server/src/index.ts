/**
 * @braises/server — Node + Colyseus : boucle autoritative, rooms, persistance.
 *
 * Placeholder. N'arrive qu'en Phase LAN (voir CLAUDE.md) : la Phase Veillée
 * se joue entièrement dans le navigateur, /sim dans un Web Worker.
 * La simulation ne changera pas en passant ici — c'est tout l'intérêt.
 */
import { BALANCE } from '@braises/sim'

export const SERVER_READY = false as const
export const TICK_RATE_HZ = BALANCE.TICK_RATE_HZ
