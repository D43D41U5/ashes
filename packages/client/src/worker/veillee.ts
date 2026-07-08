/**
 * Le scénario de la Veillée — il appartient à l'HÔTE, pas au client.
 *
 * Seed, carte, rythme du calendrier et peuplement sont des décisions d'hôte :
 * en Phase LAN, ce module (ou son équivalent) vivra sur le serveur, et le
 * client ne fera que `join`. Le client reçoit la carte dans `ready`.
 */
import {
  createSim,
  cycleOffsetForStartHour,
  generateAlpineTerrain,
  generateNodes,
  spawnEntity,
  spawnPoiMonsters,
  terrainAt,
  TERRAINS,
  type SimState,
  type WorldMap,
} from '@braises/sim'

export const VEILLEE_SEED = 2026
/** Démo : un jour de saison toutes les 2 minutes. */
export const VEILLEE_CALENDAR_SCALE = 720
/** Heure murale de départ (test d'ambiance) : 0 = minuit, en pleine nuit. Mettre 6 pour l'aube. */
export const VEILLEE_START_HOUR = 0

/**
 * Cherche la 1re tuile marchable en s'éloignant du centre en anneaux carrés
 * croissants : la carte alpine procédurale n'a pas de site de spawn artisanal,
 * on scanne donc plutôt que de risquer un spawn sur du bloquant (glacier/neige).
 */
function walkableSpawn(map: WorldMap): { x: number; y: number } {
  const cx = Math.floor(map.width / 2)
  const cy = Math.floor(map.height / 2)
  for (let r = 0; r < Math.max(map.width, map.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx
        const ty = cy + dy
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
        if (TERRAINS[terrainAt(map, tx, ty)]?.walkable) return { x: tx + 0.5, y: ty + 0.5 }
      }
    }
  }
  return { x: cx + 0.5, y: cy + 0.5 }
}

export function createVeillee(): { sim: SimState; playerId: number; spawn: { x: number; y: number } } {
  // La carte alpine procédurale est la carte par défaut du client (roadmap :
  // substrat alpin → POIs). Taille 160×240 : le client bake une SEULE texture
  // (limite WebGL ~4096px = 256 tuiles) ; l'alpin pleine taille (2400×3600)
  // attend le rendu chunké (SP2).
  const map = generateAlpineTerrain(160, 240, VEILLEE_SEED)
  const nodes = generateNodes(map, VEILLEE_SEED)
  const sim = createSim(VEILLEE_SEED, {
    map,
    calendarScale: VEILLEE_CALENDAR_SCALE,
    nodes,
    cycleOffset: cycleOffsetForStartHour(VEILLEE_START_HOUR),
  })
  // La menace et le gibier viennent des POIs : sangliers aux tanières, Cendrés
  // aux repaires (spawnPoiMonsters lit map.zones). Villages PNJ toujours différés
  // (décision 2026-07-06) — on finit la carte vivante d'abord.
  spawnPoiMonsters(sim, VEILLEE_SEED)
  // Le joueur commence les mains vides (spec économie) — pas de kit de départ.
  const spawn = walkableSpawn(map)
  const playerId = spawnEntity(sim, spawn.x, spawn.y)
  return { sim, playerId, spawn }
}
