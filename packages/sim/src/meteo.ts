/**
 * LA MÉTÉO (spec `meteo.md`, décisions Alexis 2026-08-18) — TRANCHE 1, LA COLONNE
 * VERTÉBRALE : des fronts spatiaux traversent la vallée. Une BANDE cardinale par jour au
 * plus, élue par `hash2`, entre par un bord et sort par l'autre en ~une demi-journée. Le
 * front EXISTE et se LIT (`meteoIntensity`, la surface unique que les tranches d'effets
 * consomment) ; la TRANCHE 2 branche LE FROID (`meteoCold`, spec R4) sur `temperature.ts` ;
 * la TRANCHE 3 fait taire LA FAUNE (`meteoQuiet`, spec R6) dans le gate de naissance de
 * `faune.ts` ; la TRANCHE 4 met LE FEU SOUS LA PLUIE (`meteoMouille`/`meteoFeuConso`,
 * spec R5) : la consommation des feux accélère dans `fire.ts`, la pose d'un feu neuf à
 * découvert se refuse dans `village.ts` — jamais d'extinction ; la TRANCHE 5 ralentit
 * LE PAS et voile LES YEUX (`meteoSpeedFactor`/`meteoVisionFactor`, spec R7) : la vitesse
 * des avatars dans `sim.ts` (`speedScaleFor`, patron du froid), les portées de détection
 * dans leurs lois (`nearestPrey`, `chooseQuarry`, `nearestThreat`) — au point de la CIBLE ;
 * la TRANCHE 6 arme LA FOUDRE (`foudreImpactAt`/`foudreTelegrapheAt`, spec R8) : l'élection
 * pure vit ICI, la résolution des dégâts dans `foudre.ts` (une phase dédiée — ce module ne
 * doit RIEN importer de combat), le repli des PNJ dans `npc-needs.ts` (`handleOrage`) ;
 * la TRANCHE 7 (spec R9) DIT LE BLIZZARD : l'élection complète devient UNE fonction pure
 * (`meteoTypeDuJour` — le seul écrivain), l'annonce tombe la veille au crépuscule
 * (`blizzard_annonce`, patron Brume), l'entrée réelle et la purge s'émettent
 * (`blizzard_entre`/`blizzard_passe`) — les quatre autres types n'émettent RIEN,
 * leur annonce est géométrique.
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
import { BALANCE, METEO } from './balance'
import { brumeJourEligible } from './brume'
import { emitEvent } from './events'
import { hash2 } from './noise'
import type { SimState } from './sim'
import { actForDay, DAY_TICKS_PER_CYCLE, seasonDayAtTick, TICKS_PER_CYCLE } from './time'

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
  /** Posé (vrai) au tick où la bande devient ACTIVE — la garde d'unicité de
   *  `blizzard_entre` (R9). Un FLAG et pas une égalité de tick exact (patron `phase` de la
   *  Brume) : un hôte qui saute des ticks ne doit pas perdre l'entrée. Jamais posé pour
   *  les quatre types muets — leur record reste au bit près celui d'avant la tranche 7. */
  entre?: boolean
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
 * R2+R3 — L'ÉLECTION COMPLÈTE DU JOUR, en UNE fonction pure : `null` si le jour n'élit
 * pas, sinon le type APRÈS la dégradation R3 — jamais l'élu brut.
 *
 * ═══ UN SEUL ÉCRIVAIN — c'est le contrat, pas une commodité ═══
 *
 * `advanceMeteo` la consomme à l'aube ; l'annonce (R9) la lit au crépuscule de la VEILLE —
 * l'élection de demain est une fonction pure du jour, la lire en avance est gratuit. Un
 * deuxième chemin d'élection aurait fini par mentir (une annonce qui promet un blizzard
 * que l'aube dégrade en neige) : c'est la leçon « surface à écrivain unique » du journal
 * des décisions (2026-08-18, recherche RimWorld) — l'annonce qui dit vrai n'est pas une
 * discipline, c'est une construction.
 */
export function meteoTypeDuJour(day: number): MeteoType | null {
  if (!meteoJourEligible(day)) return null
  const type = meteoTypeBrut(day)
  // R3 — Brume × blizzard : EXCLUSIFS À L'ÉLECTION. Deux dénis de zone majeurs le même
  // jour rendraient la journée illisible ; les deux éligibilités étant des fonctions pures
  // du jour, l'exclusion l'est aussi — le blizzard d'un jour de Brume se dégrade en neige.
  return type === 'blizzard' && brumeJourEligible(day) ? 'neige' : type
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
 * L'INTENSITÉ, SANS ÉTAT — la même loi, prise sur un front, un tick et une carte.
 *
 * Extraite de `meteoIntensity` pour que LE CLIENT lise la MÊME rampe que la sim (chantier
 * de rendu, tranche 9) : le mur de pluie se dessine de son gradient, et une seconde formule
 * écrite côté client aurait divergé au premier calibrage — c'est la doctrine de l'écrivain
 * unique, la même qui fait de `meteoTypeDuJour` la seule élection. `meteoIntensity` n'est
 * plus qu'elle, lue sur l'état : mêmes expressions, même ordre, au bit près.
 */
export function meteoIntensityAt(
  front: MeteoFront,
  tick: number,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
): number {
  const bande = frontMeteoPos(front, tick, mapWidth, mapHeight)
  if (!bande) return 0
  const c = bande.axis === 'x' ? x : y
  const d = Math.min(c - bande.lo, bande.hi - c)
  if (d <= 0) return 0
  const rampe = METEO.RAMPE * METEO.LARGEUR[front.type]
  return rampe <= 0 ? 1 : Math.min(1, d / rampe)
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
  return meteoIntensityAt(front, state.tick, state.map.width, state.map.height, x, y)
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
 * R7 — LE MULTIPLICATEUR DE VITESSE en (x, y) : `1 − (1 − SPEED[type]) × meteoIntensity` —
 * 1 sans front, hors bande et pour un type sans malus (brouillard), le plein `SPEED[type]`
 * au cœur, en RAMPE continue entre les deux (le gradient de `meteoIntensity` : la pluie qui
 * arrive ALOURDIT le pas en pente, jamais un mur). PENDANT le front, pas après : aucune
 * accumulation au sol. La position est celle du MARCHEUR — `sim.ts` le compose dans
 * `speedScaleFor`, la même chaîne que `coldSpeedFactor` (les avatars ; patron du froid).
 */
export function meteoSpeedFactor(state: SimState, x: number, y: number): number {
  return meteoSpeedFactorAt(state.meteo ?? null, state.tick, state.map.width, state.map.height, x, y)
}

/**
 * LE MÊME MALUS DE PAS, SANS ÉTAT — pour LA PRÉDICTION LOCALE DU CLIENT (spec R7, dernière
 * ligne du « hors périmètre » de `meteo.md`).
 *
 * L'autorité multiplie déjà la vitesse de l'avatar par ce facteur, au point du marcheur ;
 * un client qui l'ignore prédit 5 à 20 % trop vite sous un front (jusqu'à ×0,8 sous
 * blizzard) et l'avatar fait de l'élastique à chaque réconciliation. Le remède n'est pas
 * de recopier la formule côté client — c'est de lui donner LA MÊME, appelée sur le record
 * d'élection reçu dans le snapshot. Écrivain unique, jusqu'à la prédiction.
 */
export function meteoSpeedFactorAt(
  front: MeteoFront | null | undefined,
  tick: number,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
): number {
  if (!front) return 1
  const plein: number = METEO.SPEED[front.type]
  if (plein === 1) return 1
  return 1 - (1 - plein) * meteoIntensityAt(front, tick, mapWidth, mapHeight, x, y)
}

/**
 * R7 — LE MULTIPLICATEUR DE PERCEPTION DES IA en (x, y) : `1 − (1 − VISION[type]) ×
 * meteoIntensity` — 1 sans front et hors bande, le plein `VISION[type]` au cœur (le
 * brouillard en est le porteur : 0,5, fort et sans froid), en rampe continue entre les deux.
 *
 * ═══ LA POSITION EST CELLE DE LA CIBLE — c'est la sémantique, pas un détail ═══
 *
 * On se cache DANS la pluie, on n'aveugle pas le loup au soleil (spec R7) : chaque loi de
 * détection multiplie sa PORTÉE par ce facteur évalué au point de la cible REGARDÉE —
 * l'observateur sous l'averse voit normalement ce qui est au clair, et ça coupe dans les
 * deux sens (le raider approche couvert, l'embuscade aussi). Consommé DANS les lois
 * (`nearestPrey`, `chooseQuarry`, `nearestThreat`), jamais aux sites d'appel.
 */
export function meteoVisionFactor(state: SimState, x: number, y: number): number {
  const front = state.meteo
  if (!front) return 1
  const plein: number = METEO.VISION[front.type]
  if (plein === 1) return 1
  return 1 - (1 - plein) * meteoIntensity(state, x, y)
}

// ═══ R8 — LA FOUDRE DE L'ORAGE : élue par créneau, télégraphiée, jamais stockée ═══
//
// La fenêtre d'un front `orage` se découpe en CRÉNEAUX de `60 s / FOUDRE_PAR_MIN` ; chaque
// créneau PLEIN porte exactement UN impact, élu par `hash2(jour du front, canal du créneau)`
// sur un sel dédié : le tick d'impact DANS le créneau, la coordonnée DANS la bande AU TICK
// D'IMPACT (la bande BOUGE — on la recalcule à ce tick, jamais à celui de l'appelant), et
// l'autre axe sur toute la carte. Chaque créneau est INDÉPENDANT par construction : la
// suppression d'un impact (tuile abritée, `foudre.ts`) ne décale RIEN pour les suivants.
// Un impact peut tomber HORS carte quand la bande entre ou sort — il n'y frappe personne.
// Le client dessine la lueur et l'éclair depuis CES fonctions (patron « le client recalcule
// du tick ») : rien ne transite, zéro octet d'état, zéro tirage sur le PRNG.

const FOUDRE_SALT = 0x51f0a7d3

/** Le créneau de foudre : `60 s / FOUDRE_PAR_MIN` en ticks — un impact par créneau PLEIN. */
export const FOUDRE_CRENEAU_TICKS = Math.max(1, Math.round((60 * BALANCE.TICK_RATE_HZ) / METEO.FOUDRE_PAR_MIN))

/** Un point d'impact de foudre, en coordonnées monde (tuiles fractionnaires). */
export interface FoudreImpact {
  x: number
  y: number
}

/**
 * L'impact qui RÉSOUT à ce tick exact — `null` tout autre tick, tout autre type de front.
 * Fonction PURE du front et du tick, partagée sim/client : `foudre.ts` y lit la frappe,
 * le client y dessine l'éclair. Le dernier créneau, s'il est PARTIEL, ne porte pas
 * d'impact (son tick élu pourrait déborder la fenêtre — la cadence reste exacte :
 * `floor(fenêtre / créneau)` impacts, soit `FOUDRE_PAR_MIN × minutes de traversée`).
 */
export function foudreImpactAt(front: MeteoFront, tick: number, mapWidth: number, mapHeight: number): FoudreImpact | null {
  if (front.type !== 'orage') return null
  if (tick < front.startTick || tick >= front.endTick) return null
  const k = Math.floor((tick - front.startTick) / FOUDRE_CRENEAU_TICKS)
  const creneauStart = front.startTick + k * FOUDRE_CRENEAU_TICKS
  if (creneauStart + FOUDRE_CRENEAU_TICKS > front.endTick) return null // créneau partiel : pas d'impact
  const impactTick = creneauStart + Math.floor(hash2(front.day, 3 * k, FOUDRE_SALT) * FOUDRE_CRENEAU_TICKS)
  if (tick !== impactTick) return null
  const bande = frontMeteoPos(front, impactTick, mapWidth, mapHeight)
  if (!bande) return null // filet : jamais atteint pour un créneau plein (impactTick < endTick)
  const c = bande.lo + hash2(front.day, 3 * k + 1, FOUDRE_SALT) * (bande.hi - bande.lo)
  const autre = hash2(front.day, 3 * k + 2, FOUDRE_SALT) * (bande.axis === 'x' ? mapHeight : mapWidth)
  return bande.axis === 'x' ? { x: c, y: autre } : { x: autre, y: c }
}

/**
 * L'impact À VENIR dans les `FOUDRE_TELEGRAPHE_TICKS` prochains ticks — le plus proche
 * d'abord, avec son compte à rebours (`ticksLeft` ∈ [1, FOUDRE_TELEGRAPHE_TICKS]). C'est
 * LA source du télégraphe client (lueur au sol, grésillement — le patron wind-up, en plus
 * long) : « sous l'orage on lit le sol et on se décale » (spec R8). Au tick de frappe
 * même, elle rend `null` — c'est `foudreImpactAt` qui prend le relais pour l'éclair.
 */
export function foudreTelegrapheAt(
  front: MeteoFront,
  tick: number,
  mapWidth: number,
  mapHeight: number,
): (FoudreImpact & { ticksLeft: number }) | null {
  if (front.type !== 'orage') return null
  for (let d = 1; d <= METEO.FOUDRE_TELEGRAPHE_TICKS; d++) {
    const impact = foudreImpactAt(front, tick + d, mapWidth, mapHeight)
    if (impact) return { x: impact.x, y: impact.y, ticksLeft: d }
  }
  return null
}

/**
 * L'ordonnanceur de la météo — appelé chaque tick par `step()`, derrière l'interrupteur
 * DÉDIÉ `meteoActive` (spec R10). L'élection tombe au début de cycle, gardée par
 * `lastMeteoDay` (une par jour au plus). Et le BLIZZARD se dit (R9) — les quatre autres
 * types restent muets, leur annonce est géométrique (on voit le mur venir) : l'annonce la
 * veille au crépuscule (`blizzard_annonce`, le même bord de cycle que l'annonce de Brume,
 * gardée par `lastMeteoAnnonceDay`), l'entrée réelle de la bande (`blizzard_entre`, au
 * `startTick` — jamais à l'élection de l'aube) et la purge (`blizzard_passe`). Aucun
 * tirage : trois lectures de fonctions pures du jour, zéro octet sur le flux seedé.
 */
export function advanceMeteo(state: SimState): void {
  if (!state.meteoActive) return

  const front = state.meteo
  if (front && state.tick >= front.endTick) {
    // R9 — LA SORTIE se dit pour le seul blizzard : « il est passé » est l'autre moitié
    // du contrat d'annonce (on a préparé, on peut ressortir). Un fait de HUD/rendu — la
    // chronique ne le raconte pas (patron Brume : la levée et le retrait non plus).
    if (front.type === 'blizzard') emitEvent(state, { type: 'blizzard_passe', tick: state.tick, day: front.day })
    state.meteo = null
  }

  // L'ÉLECTION, au bord de cycle. La fenêtre élue finit avant le cycle suivant
  // (TRAVERSEE_TICKS ≤ TICKS_PER_CYCLE) : le record est donc toujours libre ici.
  if (state.tick % TICKS_PER_CYCLE === 0) {
    const day = seasonDayAtTick(state.tick, state.calendarScale)
    if (state.lastMeteoDay !== day) {
      state.lastMeteoDay = day
      const type = meteoTypeDuJour(day)
      if (type !== null) {
        const edge = Math.min(3, Math.floor(hash2(day, 2, METEO_SALT) * 4)) as MeteoFront['edge']
        const marge = TICKS_PER_CYCLE - METEO.TRAVERSEE_TICKS
        const startTick = state.tick + Math.floor(hash2(day, 3, METEO_SALT) * marge)
        state.meteo = { type, day, edge, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
      }
    }
  }

  // R9 — L'ENTRÉE RÉELLE du blizzard : le tick où la bande devient active (`startTick`),
  // pas l'élection de l'aube — entre les deux il peut s'écouler des heures de ciel clair,
  // et « il entre » dit le moment où le froid commence à mordre. Après l'élection : un
  // front qui entre au tick même de son élection s'émet ce tick-là.
  const actif = state.meteo
  if (actif && actif.type === 'blizzard' && !actif.entre && state.tick >= actif.startTick) {
    actif.entre = true
    emitEvent(state, { type: 'blizzard_entre', tick: state.tick, day: actif.day })
  }

  // R9 — L'ANNONCE, la veille au CRÉPUSCULE (le même bord que l'annonce de Brume) : le
  // blizzard est trop large pour être esquivé, la réponse est PRÉPARER — rentrer le bois,
  // remplir le garde-manger. On lit l'élection de DEMAIN — le jour du prochain bord de
  // cycle, jamais `day + 1` : à toute échelle de calendrier, c'est CE jour-là que l'aube
  // élira — par `meteoTypeDuJour`, la même fonction que l'aube : le mensonge est
  // impossible par construction. Elle précède l'entrée d'au moins un crépuscule → aube :
  // le `startTick` du front de demain est ≥ son aube, et l'annonce tombe la nuit d'avant.
  if (state.tick % TICKS_PER_CYCLE !== DAY_TICKS_PER_CYCLE) return
  const demain = seasonDayAtTick(state.tick + (TICKS_PER_CYCLE - DAY_TICKS_PER_CYCLE), state.calendarScale)
  if (state.lastMeteoAnnonceDay === demain) return
  state.lastMeteoAnnonceDay = demain
  if (meteoTypeDuJour(demain) !== 'blizzard') return
  emitEvent(state, { type: 'blizzard_annonce', tick: state.tick, day: demain })
}
