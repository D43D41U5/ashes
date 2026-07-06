/**
 * Le scénario de la Veillée — il appartient à l'HÔTE, pas au client.
 *
 * Seed, carte, rythme du calendrier et peuplement sont des décisions d'hôte :
 * en Phase LAN, ce module (ou son équivalent) vivra sur le serveur, et le
 * client ne fera que `join`. Le client reçoit la carte dans `ready`.
 */
import {
  createSim,
  foundNpcVillage,
  generateNodes,
  spawnEntity,
  spawnMonster,
  type SimState,
} from '@braises/sim'
import { createDemoMap, PLAYER_SPAWN } from '../demo-map'

export const VEILLEE_SEED = 2026
/** Démo : un jour de saison toutes les 2 minutes. */
export const VEILLEE_CALENDAR_SCALE = 720
export const VEILLEE_SPAWN = PLAYER_SPAWN

export function createVeillee(): { sim: SimState; playerId: number } {
  const map = createDemoMap()
  // La « chair » : les nœuds de ressources sont générés depuis la seed.
  const nodes = generateNodes(map, VEILLEE_SEED)
  const sim = createSim(VEILLEE_SEED, { map, calendarScale: VEILLEE_CALENDAR_SCALE, nodes })
  // Les voisins à caractère (spec alignement R12) : un Foyer au nord qui
  // donne, une Meute à l'est qui raide la nuit.
  foundNpcVillage(sim, 24, 14, 4, 'foyer')
  foundNpcVillage(sim, 52, 40, 3, 'meute')
  // La menace et le gibier : zombies au sud de la route, sangliers épars.
  spawnMonster(sim, 'zombie', 20, 46)
  spawnMonster(sim, 'zombie', 30, 50)
  spawnMonster(sim, 'zombie', 44, 44)
  spawnMonster(sim, 'boar', 16, 22)
  spawnMonster(sim, 'boar', 34, 24)
  // Le joueur commence les mains vides (spec économie) — pas de kit de départ.
  const playerId = spawnEntity(sim, VEILLEE_SPAWN.x, VEILLEE_SPAWN.y)
  return { sim, playerId }
}
