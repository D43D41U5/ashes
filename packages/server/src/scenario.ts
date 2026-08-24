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
  BALANCE,
  buildPoiStructures,
  createSim,
  cycleOffsetForStartHour,
  emplacementsDeVillage,
  FAUNA,
  generateZonedTerrain,
  isBlockingTile,
  MONDE,
  MONDE_JOUE,
  nidsAMonstre,
  placeHuntingGrounds,
  pointsDeSpawn,
  placeZoneNodes,
  spawnPoiMonsters,
  type SimState,
  type WorldMap,
} from '@ashes/sim'

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
/** Combien de sites de naissance le semis vise (spec R18) : un village pour trois joueurs. */
const SPAWN_SITES = Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE)

export interface LanWorld {
  sim: SimState
  /** Le feu candidat des Prés Bas : les joueurs naissent tout autour (spawn rapproché). */
  base: { tx: number; ty: number }
  /** Le SEMIS de sites de naissance (spec R18), retenu pour que R30 puisse le rejouer
   *  à chaque arrivée avec le front du jour — voir `baseDeNaissance`. */
  spawns: { tx: number; ty: number; zone: number }[]
  /** Tous les emplacements viables, et la carte zonée : la matière de `pointsDeSpawn`. */
  carte: ReturnType<typeof generateZonedTerrain>
  emplacements: ReturnType<typeof emplacementsDeVillage>
}

/**
 * Bâtit le monde de la zone : terrain zoné, nœuds par zone, faune, monstres de
 * POI. AUCUN avatar joueur n'est créé ici — un monde attend ses joueurs, qui
 * naîtront à leur `join` (contrairement au solo, qui spawne son unique avatar au
 * setup). Voir `nextSpawnNear`.
 */
export function createZone(): LanWorld {
  // Parité avec la Veillée et le banc : le LAN sert LE MONDE JOUÉ (MONDE_JOUE, 2026-08-18).
  const carte = generateZonedTerrain(LAN_SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
  const map = carte.map
  const nodes = placeZoneNodes(carte)
  // Les coins de chasse se placent AVANT les emplacements : la garde R17bis (un site
  // tenable) lit les mêmes coins que la faune jouera — parité avec veillee.ts et le banc.
  const grounds = placeHuntingGrounds(map, LAN_SEED)
  const emplacements = emplacementsDeVillage(carte, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(map) })
  // LE SITE VIENT DU SEMIS DE SPAWN, PAS DU PREMIER EMPLACEMENT VENU.
  //
  // C'est `pointsDeSpawn` qui vise les PRÉS BAS — la zone nourricière où le jeu fait naître
  // les joueurs (spec R18). Prendre `emplacements[0]` faisait naître la zone LAN sur le
  // premier site viable de la carte, qui peut tomber dans une zone sans un buisson.
  //
  // Les deux autres hôtes le font déjà, et l'un le dit pour tout le monde : le banc de
  // calibrage (`sim/scenario.ts`) commente « le premier site vient de `pointsDeSpawn`, COMME
  // EN PRODUCTION » — or la production du multi, c'est ce fichier, et il ne le faisait pas.
  // Le solo (`worker/veillee.ts`) est plus explicite encore : « c'est le MÊME semis qu'en
  // multi : cinquante joueurs y naîtraient sans se marcher dessus ». Le semis était donc
  // dimensionné POUR ce serveur, et ce serveur était le seul à ne pas s'en servir.
  const spawns = pointsDeSpawn(carte, emplacements, SPAWN_SITES)
  const base = spawns[0] ?? emplacements[0]
  if (!base) throw new Error('scenario: la vallée ne porte aucun emplacement viable — carte dégénérée')

  const sim = createSim(LAN_SEED, {
    map,
    calendarScale: LAN_CALENDAR_SCALE,
    jourDeDepart: BALANCE.JOUR_DE_DEPART, // le monde ouvre à la fin de l'Ardeur (S2)
    nodes,
    cycleOffset: cycleOffsetForStartHour(LAN_START_HOUR),
    faunaCap: FAUNA.CAP,
    grounds,
    home: { x: base.tx + 0.5, y: base.ty + 0.5 },
    // LA MÉTÉO (spec meteo.md R10) : armée dans le VRAI jeu seulement — décision d'hôte,
    // comme `faunaCap` ; parité avec `worker/veillee.ts`, les bancs restent sans elle.
    meteoActive: true,
    debug: false,
  })
  spawnPoiMonsters(sim, LAN_SEED)
  // LES LIEUX BÂTIS — même moment, même seed, même ordre que `worker/veillee.ts` (parité
  // d'amorce, spec lieux-batis A5). Sans cet appel, la zone LAN servait une Ferme ruinée
  // SANS MURS : les joueurs multi ne jouaient pas le monde que le solo joue.
  buildPoiStructures(sim, LAN_SEED)
  return { sim, base: { tx: base.tx, ty: base.ty }, spawns, carte, emplacements }
}

/**
 * OÙ NAÎT CELUI QUI ARRIVE AUJOURD'HUI.
 *
 * ⚠ ELLE NE SUIT PLUS LE FRONT (2026-08-24). Elle appliquait R30 — *« si les Prés Bas sont sous
 * la cendre au jour 30, celui qui rejoint au jour 31 naîtrait DANS LE FEU »* — en redemandant le
 * semis avec le front du jour dès que la base d'origine avait brûlé. Le front est retiré : plus
 * rien ne brûle, la base d'origine tient toujours, et la fonction rend ce qu'elle rendait déjà
 * tant que rien ne brûlait. Elle SURVIT (au lieu d'être inlinée chez l'appelant) parce que la
 * question « la base tient-elle encore ? » se reposera avec la nouvelle mécanique.
 *
 * L'autre intention est intacte : `nextSpawnNear` veut les arrivants SERRÉS — « le critère de
 * sortie de L1 est se voir/suivre/battre, pas s'éparpiller ».
 */
export function baseDeNaissance(world: LanWorld): { tx: number; ty: number } {
  return world.base
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
