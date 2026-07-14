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
  emplacementsDeVillage,
  FAUNA,
  generateZonedTerrain,
  MONDE,
  placeHuntingGrounds,
  placeZoneNodes,
  pointsDeSpawn,
  spawnEntity,
  spawnPoiMonsters,
  type SimState,
} from '@braises/sim'

export const VEILLEE_SEED = 2026
/** Démo : un jour de saison toutes les 2 minutes. */
export const VEILLEE_CALENDAR_SCALE = 720
/** Heure murale de départ : 9 = matinée (bonne lumière pour découvrir l'alpin ; 0 = minuit). */
export const VEILLEE_START_HOUR = 9

// `walkableSpawn` a émigré dans `/sim` (connectivity.ts) : où le monde commence
// est une propriété de la CARTE, pas une décision de rendu. La version qui vivait
// ici prenait « la tuile marchable la plus proche du centre » sans vérifier
// qu'elle communiquait avec quoi que ce soit — un centre tombant dans un massif
// à poche aurait fait naître le joueur muré dans un placard.

/**
 * Les passes de la naissance du monde, dans l'ordre — celles du terrain, puis
 * celles de l'hôte (peuplement). L'écran de chargement les compte : `done/total`
 * EST la barre, et rien d'autre. On n'invente pas une progression.
 */
export const LOAD_PHASES = ['zones', 'terrain', 'seuils', 'lieux', 'nodes', 'monsters'] as const
export type LoadPhase = (typeof LOAD_PHASES)[number]

/**
 * `onPhase` est annoncé AVANT la passe qu'il nomme : quand il dit « hydrology »,
 * les rivières se creusent à cet instant. Le compte de passes achevées est donc
 * son index — la barre ne devance jamais le travail.
 */
export function createVeillee(onPhase: (phase: LoadPhase) => void = () => {}): {
  sim: SimState
  playerId: number
  spawn: { x: number; y: number }
} {
  // La carte alpine procédurale est la carte par défaut du client (roadmap :
  // substrat alpin → POIs). 1200×1800 : le terrain est baké à 1 px/tuile puis
  // étiré (WorldScene) → plus de limite de texture. Le vrai plafond restant est
  // le temps de génération (~7 s) et le transfert ; l'alpin PLEINE taille
  // (2400×3600, ~27 s de gen) attend une optimisation de la génération.
  // LA NOUVELLE VALLÉE (spec `worldgen.md`) : un GRAPHE DE ZONES d'abord, le terrain ensuite.
  // La taille se déduit du nombre de joueurs cible — on ne la règle plus à la main.
  onPhase('zones')
  const carte = generateZonedTerrain(VEILLEE_SEED)
  const map = carte.map
  onPhase('terrain')
  onPhase('seuils')
  onPhase('lieux')

  // LES NŒUDS SONT DISTRIBUÉS PAR ZONE — le gros bois SEULEMENT dans la Vieille Sylve, le fer au
  // Karst, et un unique filon dérisoire dans les Prés Bas pour dire « ça existe, pas ici ».
  // `circleFactor` est mort avec `generateNodes` : « loin » ne veut plus dire « plus », ça veut
  // dire « le seul endroit où ça existe ».
  onPhase('nodes')
  const nodes = placeZoneNodes(carte)

  // LE SPAWN EST ÉPARPILLÉ dans les Prés Bas (spec R18) — en solo on en prend un, mais c'est le
  // MÊME semis qu'en multi : cinquante joueurs y naîtraient sans se marcher dessus.
  const emplacements = emplacementsDeVillage(carte, nodes)
  const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
  const premier = spawns[0] ?? emplacements[0]
  if (!premier) throw new Error('veillee: la vallée ne porte aucun emplacement viable — carte dégénérée')
  const spawn = { x: premier.tx + 0.5, y: premier.ty + 0.5 }

  const sim = createSim(VEILLEE_SEED, {
    map,
    calendarScale: VEILLEE_CALENDAR_SCALE,
    nodes,
    cycleOffset: cycleOffsetForStartHour(VEILLEE_START_HOUR),
    faunaCap: FAUNA.CAP,
    grounds: placeHuntingGrounds(map, VEILLEE_SEED),
    home: spawn,
    debug: import.meta.env.DEV,
  })
  onPhase('monsters')
  spawnPoiMonsters(sim, VEILLEE_SEED)
  // Le joueur commence les mains vides (spec économie) — pas de kit de départ.
  const playerId = spawnEntity(sim, spawn.x, spawn.y)
  return { sim, playerId, spawn }
}
