/**
 * Le scénario de la Veillée — il appartient à l'HÔTE, pas au client.
 *
 * Seed, carte, rythme du calendrier et peuplement sont des décisions d'hôte :
 * en Phase LAN, ce module (ou son équivalent) vivra sur le serveur, et le
 * client ne fera que `join`. Le client reçoit la carte dans `ready`.
 */
import {
  BALANCE,
  calendarScaleForSeasonCycles,
  createSim,
  cycleOffsetForStartHour,
  emplacementsDeVillage,
  FAUNA,
  foundNpcVillage,
  generateZonedTerrain,
  MONDE,
  MONDE_JOUE,
  nidsAMonstre,
  placeHuntingGrounds,
  placeZoneNodes,
  pointsDeSpawn,
  spawnEntity,
  spawnPoiMonsters,
  buildPoiStructures,
  type SimState,
} from '@ashes/sim'

/**
 * LA SEED PAR DÉFAUT vit dans `mondes.ts` (module feuille) : depuis l'écran des mondes, le
 * joueur SÈME sa vallée — la seed est devenue un paramètre de `createVeillee`, plus une
 * constante du scénario. On la ré-exporte pour qui la citait ici.
 */
import { VEILLEE_SEED } from './mondes'
export { VEILLEE_SEED }
/**
 * ⚙ LA DURÉE D'UNE VEILLÉE, en cycles jour/nuit — et depuis le 2026-08-23, **UN JOUR EST
 * UN CYCLE** (décision d'Alexis ; le cycle dure **30 minutes** depuis le 2026-08-24).
 *
 * ═══ CE QUI ÉTAIT CASSÉ ═══
 *
 * Ce bouton valait 6 : les 60 jours de saison étaient compressés sur 6 cycles, donc le
 * compteur du HUD avançait de DIX jours par cycle jour/nuit — « JOUR 3 · 09H », puis
 * « JOUR 4 · 11H », un jour de plus toutes les 2,4 heures affichées. Les deux horloges du
 * jeu (le cycle, réel et fixe ; le calendrier, accéléré par `calendarScale`) sont faites
 * pour être découplées — mais le HUD les affiche CÔTE À CÔTE sur une seule ligne, et là,
 * découplées, elles se contredisent.
 *
 * ═══ CE QU'ON POSE ═══
 *
 * `SEASON_DAYS` cycles pour `SEASON_DAYS` jours : `calendarScale` vaut alors exactement
 * `TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE` = **48** (32 quand le cycle durait 45 min), le
 * jour de saison bascule une fois par cycle, et le compteur du HUD redevient lisible. C'est
 * déjà l'échelle du BANC (`sim/scenario.ts`) : le solo était le seul à ne pas la tenir.
 *
 * Le prix, assumé : une saison de 30 jours dure `ACT_DAYS` × `CYCLE_REAL_MINUTES` = **15 h**
 * de jeu (22,5 h quand le cycle durait 45 min), et depuis l'ouverture au jour 61 le Grand
 * Froid tombe à **h 15** (h 30 avant les deux décisions du 2026-08-24). La persistance (P1-6)
 * découpe en séances : à 30 min par jour, une séance de 2 h vaut quatre jours de jeu, donc les
 * 5 séances de GATE 1 mènent au jour 81 (h 10) — les Pluies bien entamées, dix jours avant
 * l'hiver, qui demande 7,5 séances. C'est le compromis assumé du jour 61 : on gagne cinq heures
 * sur les dix qui séparaient l'ouverture du Grand Froid, et on garde une saison entière pour
 * s'installer (le jour 71, chiffré le même jour, mettait l'hiver à h 10 mais ne laissait
 * qu'UNE heure avant que les nuits gèlent). Si c'est encore trop long, les boutons restants sont
 * `SEASON_DAYS` **et `ACT_DAYS` ENSEMBLE** — PAS ce couplage (le rendre ≠ 1 remettrait le
 * compteur en défaut), et pas `ACT_DAYS` seul : les cardinaux des courbes annuelles sont
 * écrits en jours ABSOLUS de l'année, une année de 80 jours les fait sortir du domaine
 * (mesuré le 2026-08-24 : plus d'hiver du tout, +6,3 °C au minimum, et une falaise de
 * 15,7 °C/jour au tour de l'an). Ensemble, parce que les actes se comptent par `ACT_DAYS` :
 * baisser `SEASON_DAYS` à 12 en laissant `ACT_DAYS` à 30 rendrait la saison ENTIÈRE en
 * acte I — pas d'acte II, pas de méga-horde, pas de défeuillaison. La garde de forme, si
 * l'on y touche : `actForDay(SEASON_DAYS) >= 3`.
 */
export const VEILLEE_SEASON_CYCLES = BALANCE.SEASON_DAYS
/** L'échelle du calendrier, DÉRIVÉE du nombre de cycles voulu (couplage cycle↔calendrier).
 *  Ne pas coder en dur : c'est ce codage en dur (720) qui découplait l'endgame. */
export const VEILLEE_CALENDAR_SCALE = calendarScaleForSeasonCycles(VEILLEE_SEASON_CYCLES)
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
 *
 * LA SEED EST UN PARAMÈTRE depuis l'écran des mondes (2026-07-28) : le joueur sème sa
 * vallée. Elle traverse TOUTES les passes — terrain, nœuds, coins de chasse, monstres,
 * lieux bâtis — parce qu'un monde est ce que sa seed en fait, et rien d'autre : deux
 * parties de même seed doivent être la même vallée, tuile pour tuile.
 */
export function createVeillee(
  seed: number = VEILLEE_SEED,
  onPhase: (phase: LoadPhase) => void = () => {},
): {
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
  // LE MONDE JOUÉ (décision 2026-08-18) : racine + Cendrière « pour l'instant » — la constante
  // MONDE_JOUE de /sim est le SEUL interrupteur, partagé avec le banc et le LAN.
  const carte = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
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
  // Les coins de chasse se placent AVANT : la garde R17bis (site tenable — hors du territoire
  // des loups, loin des nids, des baies à portée) lit les mêmes coins que la faune jouera.
  const grounds = placeHuntingGrounds(map, seed)
  const emplacements = emplacementsDeVillage(carte, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(map) })
  const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
  const premier = spawns[0] ?? emplacements[0]
  if (!premier) throw new Error('veillee: la vallée ne porte aucun emplacement viable — carte dégénérée')
  const spawn = { x: premier.tx + 0.5, y: premier.ty + 0.5 }

  const sim = createSim(seed, {
    map,
    calendarScale: VEILLEE_CALENDAR_SCALE,
    // LE MONDE OUVRE À L'OUVERTURE DES PLUIES (spec `saisons.md` S2, jour 61 depuis le
    // 2026-08-24) : une saison ENTIÈRE pour s'installer, qui annonce toute seule ce qui vient,
    // et le Grand Froid à h 15 de jeu réel.
    jourDeDepart: BALANCE.JOUR_DE_DEPART,
    // LA SAISON NE FINIT PAS (saison-sans-fin R4, décision d'Alexis 2026-08-21) : ni verdict ni
    // Arche en solo — l'année tourne, l'hiver revient. La fin de saison n'est plus qu'un jour.
    finDeSaison: null,
    nodes,
    // ⚠ LE JOUR EST REQUIS : le lever suit la saison (2026-08-26), donc « ouvrir à 9 h » se
    // compte depuis le lever du jour d'ouverture — 06h50 au jour 61, pas un 6 h de convention.
    cycleOffset: cycleOffsetForStartHour(VEILLEE_START_HOUR, BALANCE.JOUR_DE_DEPART),
    faunaCap: FAUNA.CAP,
    grounds,
    home: spawn,
    // LA MÉTÉO (spec meteo.md R10) : armée dans le VRAI jeu seulement — décision d'hôte,
    // comme `faunaCap` ; les bancs et les tests restent sans elle (interrupteur dédié).
    meteoActive: true,
    debug: import.meta.env.DEV,
  })
  onPhase('monsters')
  spawnPoiMonsters(sim, seed)
  // LES LIEUX BÂTIS — même moment, même patron : le worldgen a marqué, l'hôte peuple.
  buildPoiStructures(sim, seed)
  // Le joueur commence les mains vides (spec économie) — pas de kit de départ.
  const playerId = spawnEntity(sim, spawn.x, spawn.y)

  // PEUPLER LA VEILLÉE (V1-10, racine R-A) — LE geste qui allume le pilier n°1.
  // Sans un second village, `isOutsider()` renvoie toujours faux et TOUT le moteur
  // d'alignement tourne à vide en solo (le Feu reste blanc, aucun don ni raid ne vise
  // le joueur). On fonde deux VOISINS PNJ — un Foyer (à nourrir, à commercer) et une
  // Meute (le danger) — sur la carte RÉELLEMENT jouée (`emplacementsDeVillage`, ≥96
  // tuiles d'écart), et LOIN du joueur : conforme au GDD (le solo joue mécaniquement un
  // Ermitage, l'isolement reste un choix de tranquillité), la Meute est une pression
  // DISTANTE et évitable, pas un harcèlement. Le joueur n'est cible qu'après avoir fondé
  // SON village (chest `access:'village'`). Le drame Foyer-vs-Meute est OBSERVABLE, opt-in.
  const d2 = (e: { tx: number; ty: number }): number => (e.tx - premier.tx) * (e.tx - premier.tx) + (e.ty - premier.ty) * (e.ty - premier.ty)
  const voisins = emplacements.filter((e) => e.tx !== premier.tx || e.ty !== premier.ty).sort((a, b) => d2(b) - d2(a))
  if (voisins[0]) foundNpcVillage(sim, voisins[0].tx, voisins[0].ty, 3, 'foyer')
  if (voisins[1]) foundNpcVillage(sim, voisins[1].tx, voisins[1].ty, 3, 'meute')

  return { sim, playerId, spawn }
}
