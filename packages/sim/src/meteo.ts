/**
 * LA MÉTÉO (spec `meteo.md`, décisions Alexis 2026-08-18) — TRANCHE 1, LA COLONNE
 * VERTÉBRALE : des fronts spatiaux traversent la vallée. Une BANDE cardinale par jour au
 * plus, élue par `hash2`, entre par un bord et sort par l'autre en ~une demi-journée. Le
 * front EXISTE et se LIT (`meteoIntensity`, la surface unique que les tranches d'effets
 * consomment) ; la TRANCHE 2 branche LE FROID (`meteoCold`, spec R4) sur `temperature.ts` ;
 * la TRANCHE 3 fait taire LA FAUNE (`meteoQuiet`, spec R6) dans le gate de naissance de
 * `faune.ts` ; la TRANCHE 4 met LE FEU SOUS LA PLUIE (`meteoMouille`/`meteoFeuConso`,
 * spec R5) : la consommation des feux accélère dans `fire.ts`, la pose d'un feu neuf à
 * découvert se refuse dans `village.ts` — jamais d'extinction. Restent à venir :
 * vitesse/perception (T5+), et les événements d'annonce (T7).
 *
 * ═══ ZÉRO TIRAGE SUR LE PRNG D'ÉTAT ═══
 *
 * Occurrence, type, bord, fenêtre : tout se dérive du JOUR DE SAISON par `hash2` (patron
 * Brume/réfugiés) — armer la météo ne décale AUCUN tirage existant, donc les suites replay
 * et events passent inchangées (spec R10 : une exigence, pas une préférence — leçon RNG
 * connue : le décompte d'entités décale le flux seedé).
 *
 * ═══ LA GÉOMÉTRIE EST CALCULÉE, JAMAIS STOCKÉE ═══
 *
 * L'état ne porte que le record d'élection (type, jour, bord, deux échéances) ; la position
 * de la bande à un tick donné est une fonction pure (`frontMeteoPos`, patron `brumeCentre`),
 * partagée avec le client — le mur de pluie se verra venir sans un octet de plus dans le
 * snapshot. Géométrie CARDINALE uniquement : la bande est PERPENDICULAIRE à sa traversée,
 * aucune rotation, aucune trigo (invariant n°2 — pas de sin/cos).
 *
 * ═══ UN SEUL FRONT ACTIF, PAR CONSTRUCTION ═══
 *
 * L'élection tombe au DÉBUT de cycle (le bord de cycle, comme l'accroche d'`advanceBrume`),
 * et la fenêtre élue TIENT dans le cycle (`startTick = début + fraction × (TICKS_PER_CYCLE −
 * TRAVERSEE_TICKS)`) : le front d'un jour est toujours fini — donc purgé — quand l'élection
 * suivante arrive. Un seul record suffit, et deux fronts ne peuvent pas se chevaucher
 * (le test A9 l'affirme quand même).
 *
 * ═══ L'INTERRUPTEUR EST DÉDIÉ (R10) ═══
 *
 * `state.meteoActive`, FAUX par défaut : les bancs et les tests existants ne voient RIEN
 * changer — et le banc d'équilibrage pourra mesurer l'économie sans le bruit météo, puis
 * avec (ses seuils de famine sont absolus). Le vrai jeu l'arme à la création du monde.
 */
import { METEO } from './balance'
import { brumeJourEligible } from './brume'
import { hash2 } from './noise'
import type { SimState } from './sim'
import { actForDay, seasonDayAtTick, TICKS_PER_CYCLE } from './time'

const METEO_SALT = 0x9b4de3c1

export type MeteoType = 'pluie' | 'brouillard' | 'neige' | 'orage' | 'blizzard'

/** Le front en cours — un record plat JSON, purgé à la sortie (patron `state.brume`). */
export interface MeteoFront {
  type: MeteoType
  /** Le jour de saison de l'élection — la graine de tous les `hash2` de ce front. */
  day: number
  /** Le bord CARDINAL d'entrée : 0 = ouest (traverse vers l'est), 1 = est, 2 = nord
   *  (vers le sud), 3 = sud. La bande est perpendiculaire à la traversée. */
  edge: 0 | 1 | 2 | 3
  /** Au `startTick`, le bord AVANT de la bande touche le bord d'entrée de la carte ;
   *  au `endTick`, le bord ARRIÈRE a quitté le bord opposé. Linéaire entre les deux. */
  startTick: number
  endTick: number
}

/** La bande au tick donné : l'axe de TRAVERSÉE et l'intervalle `[lo, hi]` occupé sur cet
 *  axe — elle couvre tout l'autre axe (géométrie cardinale, spec R1). */
export interface BandeMeteo {
  axis: 'x' | 'y'
  lo: number
  hi: number
}

/** Le jour tire-t-il un front ? Pur (`hash2`) — exposé pour les tests et les bancs. */
export function meteoJourEligible(day: number): boolean {
  return hash2(day, 0, METEO_SALT) < METEO.CHANCE_PER_DAY[actForDay(day) - 1]!
}

/**
 * Le type élu par la table de l'acte, AVANT l'exclusion R3 — exposé pour la garde R3 des
 * tests (prouver que la dégradation a mordu exige de voir l'élu brut). Canal 1, décorrélé
 * du canal d'occurrence (0) : le type ne dérive pas du même tirage que le « oui » du jour
 * (patron des canaux Brume).
 */
export function meteoTypeBrut(day: number): MeteoType {
  const table = METEO.TYPES[actForDay(day) - 1]!
  const roll = hash2(day, 1, METEO_SALT)
  let cumul = 0
  let dernier: MeteoType = 'pluie'
  for (const [type, poids] of Object.entries(table) as [MeteoType, number][]) {
    cumul += poids
    dernier = type
    if (roll < cumul) return type
  }
  return dernier // filet d'arrondi : les poids somment à 1 et roll < 1
}

/**
 * La bande du front au tick donné — `null` avant le `startTick` et dès le `endTick`.
 * Interpolation LINÉAIRE du bord d'entrée au bord opposé (patron `brumeCentre`) : le bord
 * avant parcourt `span + largeur` sur la fenêtre, si bien qu'à l'entrée la bande est encore
 * toute dehors et qu'à la fin elle est toute sortie. Fonction pure, partagée avec le client.
 */
export function frontMeteoPos(front: MeteoFront, tick: number, mapWidth: number, mapHeight: number): BandeMeteo | null {
  if (tick < front.startTick || tick >= front.endTick) return null
  const largeur = METEO.LARGEUR[front.type]
  const axis: 'x' | 'y' = front.edge <= 1 ? 'x' : 'y'
  const span = axis === 'x' ? mapWidth : mapHeight
  const u = (tick - front.startTick) / (front.endTick - front.startTick)
  const avance = u * (span + largeur)
  // Ouest (0) et nord (2) traversent vers +axe : le bord AVANT est le côté haut de la
  // bande. Est (1) et sud (3) traversent vers −axe : le bord avant est le côté bas.
  const lo = front.edge === 0 || front.edge === 2 ? avance - largeur : span - avance
  return { axis, lo, hi: lo + largeur }
}

/**
 * L'intensité du front en (x, y) — LA surface de lecture unique des tranches suivantes
 * (froid, Feu, faune, vitesse, perception : tout se lira ici). 0 hors bande, 1 au cœur,
 * rampe LINÉAIRE sur `RAMPE × LARGEUR` à chaque bord — un gradient bord → centre, jamais
 * un mur. Pure : deux appels, même réponse, zéro mutation.
 */
export function meteoIntensity(state: SimState, x: number, y: number): number {
  const front = state.meteo
  if (!front) return 0
  const bande = frontMeteoPos(front, state.tick, state.map.width, state.map.height)
  if (!bande) return 0
  const c = bande.axis === 'x' ? x : y
  const d = Math.min(c - bande.lo, bande.hi - c)
  if (d <= 0) return 0
  const rampe = METEO.RAMPE * METEO.LARGEUR[front.type]
  return rampe <= 0 ? 1 : Math.min(1, d / rampe)
}

/**
 * R4 — LE FROID DU FRONT en (x, y) : `METEO.COLD[type] × meteoIntensity` — 0 sans front et
 * hors bande, le plein froid au cœur, en RAMPE continue entre les deux (le gradient de
 * `meteoIntensity` : le froid MONTE quand le front arrive — une pente, jamais un mur).
 * C'est une EXPOSITION, patron exact de `brumeCold` : `temperature.ts` l'amortit sous un
 * abri (`SHELTER_FACTOR`) et la PLANCHE au feu, à la source chaude et à la tenue — toute
 * la chaîne vitale (dérive, hypothermie, vitesse, endurance) suit par construction, zéro
 * code neuf côté vitals. Le brouillard a COLD 0 : il ne refroidit pas, au bit près.
 */
export function meteoCold(state: SimState, x: number, y: number): number {
  const front = state.meteo
  if (!front) return 0
  const cold: number = METEO.COLD[front.type]
  return cold === 0 ? 0 : cold * meteoIntensity(state, x, y)
}

/**
 * R6 — LA FAUNE SE TERRE : le silence météo en (x, y). Vrai si un front actif d'un type
 * `QUIET` couvre le point (`meteoIntensity > 0` — dès la rampe : le gibier se tait quand la
 * pluie arrive, pas seulement à son cœur). PRÉDICAT PUR, jamais d'état : un front MOBILE
 * devrait semer des points `faunaQuiet` à chaque tick (une inondation d'état) — on interroge
 * son empreinte à la place. Les points `faunaQuiet` (Brume, pression de chasse) et ce
 * prédicat coexistent donc PAR CONSTRUCTION : aucune purge croisée possible (critère A5).
 * Le brouillard ne fait pas taire le gibier (`QUIET.brouillard` = faux) : front tactique,
 * pas front mouillé.
 */
export function meteoQuiet(state: SimState, x: number, y: number): boolean {
  const front = state.meteo
  if (!front) return false
  if (!METEO.QUIET[front.type]) return false
  return meteoIntensity(state, x, y) > 0
}

/**
 * R5 — LE FRONT MOUILLE-T-IL (x, y) ? Vrai sous l'empreinte active (`meteoIntensity > 0` —
 * dès la rampe) d'un front de type `MOUILLE` : l'eau qui tombe. Table SÉPARÉE de `QUIET`
 * (mêmes valeurs aujourd'hui, deux axes sémantiques — voir `balance.ts`). C'est la porte
 * du REFUS de pose d'un feu NEUF à découvert (`village.ts`, `place_campfire`) ; le
 * RALLUMAGE d'un feu existant ne passe JAMAIS par ici — l'ancre de respawn est sacrée.
 */
export function meteoMouille(state: SimState, x: number, y: number): boolean {
  const front = state.meteo
  if (!front) return false
  if (!METEO.MOUILLE[front.type]) return false
  return meteoIntensity(state, x, y) > 0
}

/**
 * R5 — LE MULTIPLICATEUR DE CONSOMMATION du feu en (x, y) : `1 + (FEU_CONSO[type] − 1) ×
 * meteoIntensity` pour un type mouillé, exactement 1 sinon. La pluie qui arrive accélère
 * la faim du feu en RAMPE (le gradient de `meteoIntensity` : une pente continue, jamais
 * un mur) et ne l'éteint JAMAIS — la pression, pas la spirale de mort ; `fire.ts` le
 * consomme au point du FEU, pas de l'observateur. Hors front, type sec ou hors bande :
 * 1 au bit près — le feu d'à côté ne sait rien.
 */
export function meteoFeuConso(state: SimState, x: number, y: number): number {
  const front = state.meteo
  if (!front) return 1
  if (!METEO.MOUILLE[front.type]) return 1
  const plein: number = METEO.FEU_CONSO[front.type]
  if (plein === 1) return 1
  return 1 + (plein - 1) * meteoIntensity(state, x, y)
}

/**
 * L'ordonnanceur de la météo — appelé chaque tick par `step()`, derrière l'interrupteur
 * DÉDIÉ `meteoActive` (spec R10). L'élection tombe au début de cycle, gardée par
 * `lastMeteoDay` (une par jour au plus) ; la purge est silencieuse — aucun événement dans
 * cette tranche (l'annonce est la tranche T7).
 */
export function advanceMeteo(state: SimState): void {
  if (!state.meteoActive) return

  const front = state.meteo
  if (front && state.tick >= front.endTick) state.meteo = null

  // L'ÉLECTION, au bord de cycle. La fenêtre élue finit avant le cycle suivant
  // (TRAVERSEE_TICKS ≤ TICKS_PER_CYCLE) : le record est donc toujours libre ici.
  if (state.tick % TICKS_PER_CYCLE !== 0) return
  const day = seasonDayAtTick(state.tick, state.calendarScale)
  if (state.lastMeteoDay === day) return
  state.lastMeteoDay = day
  if (!meteoJourEligible(day)) return

  let type = meteoTypeBrut(day)
  // R3 — Brume × blizzard : EXCLUSIFS À L'ÉLECTION. Deux dénis de zone majeurs le même
  // jour rendraient la journée illisible ; les deux éligibilités étant des fonctions pures
  // du jour, l'exclusion l'est aussi — le blizzard d'un jour de Brume se dégrade en neige.
  if (type === 'blizzard' && brumeJourEligible(day)) type = 'neige'

  const edge = Math.min(3, Math.floor(hash2(day, 2, METEO_SALT) * 4)) as MeteoFront['edge']
  const marge = TICKS_PER_CYCLE - METEO.TRAVERSEE_TICKS
  const startTick = state.tick + Math.floor(hash2(day, 3, METEO_SALT) * marge)
  state.meteo = { type, day, edge, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
}
