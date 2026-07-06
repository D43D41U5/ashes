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
  generateValley,
  spawnEntity,
  spawnMonster,
  VEILLEE_SITES,
  VEILLEE_SKELETON,
  type SimState,
} from '@braises/sim'

export const VEILLEE_SEED = 2026
/** Démo : un jour de saison toutes les 2 minutes. */
export const VEILLEE_CALENDAR_SCALE = 720
export const VEILLEE_SPAWN = VEILLEE_SITES.spawn

export function createVeillee(): { sim: SimState; playerId: number } {
  // Le squelette artisanal ; la « chair » (biomes puis ressources) vient de la seed.
  const map = generateValley(VEILLEE_SKELETON, VEILLEE_SEED)
  const nodes = generateNodes(map, VEILLEE_SEED)
  const sim = createSim(VEILLEE_SEED, { map, calendarScale: VEILLEE_CALENDAR_SCALE, nodes })
  // Les voisins à caractère (spec alignement R12) : le Foyer dans la Plaine,
  // la Meute à l'est du Pont — sur la route de la Mine, évidemment.
  foundNpcVillage(sim, VEILLEE_SITES.foyer.x, VEILLEE_SITES.foyer.y, 4, 'foyer')
  foundNpcVillage(sim, VEILLEE_SITES.meute.x, VEILLEE_SITES.meute.y, 3, 'meute')
  // La menace et le gibier : sangliers aux tanières, zombies au Hameau, au
  // Marais et sur le Plateau.
  for (const p of VEILLEE_SITES.boars) spawnMonster(sim, 'boar', p.x, p.y)
  for (const p of VEILLEE_SITES.zombies) spawnMonster(sim, 'zombie', p.x, p.y)
  // Le joueur commence les mains vides (spec économie) — pas de kit de départ.
  const playerId = spawnEntity(sim, VEILLEE_SPAWN.x, VEILLEE_SPAWN.y)
  return { sim, playerId }
}
