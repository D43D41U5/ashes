/**
 * Le scénario de la zone LAN — le jumeau Node de `worker/veillee.ts`.
 *
 * Seed, carte, rythme et peuplement sont des décisions d'HÔTE : le Worker les
 * prend côté navigateur (Veillée solo), ce module les prend côté serveur (multi).
 * La simulation, elle, est la MÊME — ce sont les mêmes appels `/sim`. La seule
 * différence tenait à un `import.meta.env.DEV` (client-isme) : ici `debug: false`,
 * point. Duplication mineure et assumée : le scénario appartient à l'hôte.
 */
import {
  createSim,
  cycleOffsetForStartHour,
  emplacementsDeVillage,
  FAUNA,
  generateZonedTerrain,
  isBlockingTile,
  placeHuntingGrounds,
  placeZoneNodes,
  spawnPoiMonsters,
  type SimState,
  type WorldMap,
} from '@braises/sim'

/** Le NOM du serveur, affiché dans l'écran principal du client (métadonnées de room).
 *  Surchargéable par l'env `SERVER_NAME` ; un seul serveur pour l'instant. */
export const SERVER_NAME = process.env.SERVER_NAME ?? 'La Vallée'
/** Le nombre de joueurs MAX de la zone (décision : 50 pour ce serveur). */
export const MAX_PLAYERS = 50
export const LAN_SEED = 2026
/** « 1 en multi » (voir `SimState.calendarScale`) : le temps de saison suit le temps réel. */
export const LAN_CALENDAR_SCALE = 1
/** Heure murale de départ : 9 = matinée (bonne lumière). */
export const LAN_START_HOUR = 9

export interface LanWorld {
  sim: SimState
  /** Le feu candidat des Prés Bas : les joueurs naissent tout autour (spawn rapproché). */
  base: { tx: number; ty: number }
}

/**
 * Bâtit le monde de la zone : terrain zoné, nœuds par zone, faune, monstres de
 * POI. AUCUN avatar joueur n'est créé ici — un monde attend ses joueurs, qui
 * naîtront à leur `join` (contrairement au solo, qui spawne son unique avatar au
 * setup). Voir `nextSpawnNear`.
 */
export function createZone(): LanWorld {
  const carte = generateZonedTerrain(LAN_SEED)
  const map = carte.map
  const nodes = placeZoneNodes(carte)
  const emplacements = emplacementsDeVillage(carte, nodes)
  const base = emplacements[0]
  if (!base) throw new Error('scenario: la vallée ne porte aucun emplacement viable — carte dégénérée')

  const sim = createSim(LAN_SEED, {
    map,
    calendarScale: LAN_CALENDAR_SCALE,
    nodes,
    cycleOffset: cycleOffsetForStartHour(LAN_START_HOUR),
    faunaCap: FAUNA.CAP,
    grounds: placeHuntingGrounds(map, LAN_SEED),
    home: { x: base.tx + 0.5, y: base.ty + 0.5 },
    debug: false,
  })
  spawnPoiMonsters(sim, LAN_SEED)
  return { sim, base: { tx: base.tx, ty: base.ty } }
}

/**
 * Un point de spawn marchable dans un anneau DÉTERMINISTE autour du feu candidat.
 * Les 3 joueurs de L1 naissent à quelques tuiles les uns des autres — le critère
 * de sortie est « se voir/suivre/battre », pas « s'éparpiller ». L'ordre de balayage
 * est stable (rayon croissant, puis ligne par ligne) : deux joueurs d'index
 * différents tombent sur des tuiles différentes.
 */
export function nextSpawnNear(map: WorldMap, base: { tx: number; ty: number }, index: number): { x: number; y: number } {
  const ring: { tx: number; ty: number }[] = []
  for (let r = 0; r <= 12 && ring.length <= index + 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Seulement le PÉRIMÈTRE de l'anneau de rayon r (les rayons < r sont déjà pris).
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const tx = base.tx + dx
        const ty = base.ty + dy
        if (!isBlockingTile(map, tx, ty)) ring.push({ tx, ty })
      }
    }
  }
  const cell = ring[index % ring.length] ?? base
  return { x: cell.tx + 0.5, y: cell.ty + 0.5 }
}
