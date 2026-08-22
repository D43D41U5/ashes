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
 * (`meteoTypeDuCycle` — le seul écrivain), l'annonce tombe la veille au crépuscule
 * (`blizzard_annonce`, patron Brume), l'entrée réelle et la purge s'émettent
 * (`blizzard_entre`/`blizzard_passe`) — les quatre autres types n'émettent RIEN,
 * leur annonce est géométrique.
 *
 * ═══ LA NEIGE SE DÉRIVE DU FROID (R11-R13, décision d'Alexis 2026-08-22) ═══
 *
 * Un front ne porte plus qu'une CLASSE — `pluie` ou `orage` (qui précipitent), `brouillard`
 * ou `vent_de_cendre` (qui ne précipitent pas). `neige` et `blizzard` ne s'élisent plus : en
 * chaque point et à chaque tick, **il neige là où la pluie ferait geler un gué**
 * (`neigeA(t0)` : `T₀ − COLD.pluie < SEUIL_NEIGE`, `T₀` = le monde SANS le front), et un
 * orage y est un blizzard (`meteoAspectAt`). Le froid d'un orage DÉPEND DU FROID QU'IL
 * TROUVE (`froidEolien` : 10 → 55 en pente continue sur `T₀`, jamais sur la température sous
 * le front — aucune circularité), et chaque effet de l'orage (pas, vision, feu) s'interpole
 * vers sa ligne `ORAGE_FROID` par le même facteur. Sa LARGEUR suit le froid de la saison
 * (`largeurDe` : 55 en acte I → la carte au plafond d'`ACT_COLD`). Le « blizzard » de R9
 * (annonce, entrée, passage) est un orage dont l'aspect en plaine à découvert au milieu de sa
 * fenêtre est `blizzard` (`frontEstBlizzard`) — fonction pure du cycle, écrivain unique.
 *
 * ═══ ZÉRO TIRAGE SUR LE PRNG D'ÉTAT ═══
 *
 * Occurrence, type, bord, fenêtre : tout se dérive du CYCLE par `hash2` (patron
 * Brume/réfugiés — le jour de saison, lui, désigne l'ACTE) — armer la météo ne décale AUCUN tirage existant, donc les suites replay
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
 * L'élection tombe au DÉBUT de cycle — UN TIRAGE PAR CYCLE — et la fenêtre élue TIENT dans
 * le cycle (`startTick = début + fraction × (TICKS_PER_CYCLE − TRAVERSEE_TICKS)`) : le front
 * d'un cycle est toujours fini — donc purgé — quand l'élection suivante arrive. Un seul record suffit, et deux fronts ne peuvent pas se chevaucher
 * (le test A9 l'affirme quand même).
 *
 * ═══ L'INTERRUPTEUR EST DÉDIÉ (R10) ═══
 *
 * `state.meteoActive`, FAUX par défaut : les bancs et les tests existants ne voient RIEN
 * changer — et le banc d'équilibrage pourra mesurer l'économie sans le bruit météo, puis
 * avec (ses seuils de famine sont absolus). Le vrai jeu l'arme à la création du monde.
 */
import { BALANCE, METEO, TEMPERATURE } from './balance'
import { brumeJourEligible } from './brume'
import { CENDRE, bandeDeCendre } from './cendre'
import { emitEvent } from './events'
import { hash2 } from './noise'
import type { SimState } from './sim'
import { dehorsSansMeteo } from './temperature'
import { actForDay, DAY_TICKS_PER_CYCLE, gameTimeAt, seasonDayAtTick, TICKS_PER_CYCLE } from './time'

const METEO_SALT = 0x9b4de3c1

/** LA CLASSE d'un front — ce qui s'ÉLIT (R11). `neige` et `blizzard` n'en sont plus : ce
 *  sont des ASPECTS, dérivés au point du froid du monde (`meteoAspectAt`). */
export type MeteoType = 'pluie' | 'brouillard' | 'orage' | 'vent_de_cendre'

/** L'ASPECT d'un point sous la bande — ce que le client dessine et ce que `neigeAuSol`
 *  accumule : la classe du front, sauf que `pluie` devient `neige` et `orage` devient
 *  `blizzard` là où il neige (`neigeA`). */
export type MeteoAspect = MeteoType | 'neige' | 'blizzard'

/** Le front en cours — un record plat JSON, purgé à la sortie (patron `state.brume`). */
export interface MeteoFront {
  type: MeteoType
  /** Le CYCLE de l'élection — la graine de tous les `hash2` de ce front (bord, fenêtre,
   *  impacts de foudre). Le cycle et non le jour : à `calendarScale` élevé (LAN), trente
   *  cycles partagent un même jour de saison — leurs fronts auraient eu la même foudre. */
  cycle: number
  /** Le jour de saison où le front a été élu — il porte l'ACTE (donc la fréquence et la
   *  mixture) et date les faits de chronique. Jamais une clé de hash. */
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

/**
 * Ce CYCLE tire-t-il un front ? Pur (`hash2`) — exposé pour les tests et les bancs.
 *
 * Le tirage est keyé sur le CYCLE (cadence réelle) ; c'est le JOUR DE SAISON qui désigne
 * l'acte, donc la fréquence. Voir `METEO.CHANCE_PER_CYCLE` pour le pourquoi.
 */
export function meteoCycleEligible(cycle: number, day: number): boolean {
  return hash2(cycle, 0, METEO_SALT) < METEO.CHANCE_PER_CYCLE(actForDay(day))
}

/**
 * Le type élu par la table de l'acte, AVANT l'exclusion R3 — exposé pour la garde R3 des
 * tests (prouver que la dégradation a mordu exige de voir l'élu brut). Canal 1, décorrélé
 * du canal d'occurrence (0) : le type ne dérive pas du même tirage que le « oui » du jour
 * (patron des canaux Brume).
 */
export function meteoTypeBrut(cycle: number, day: number): MeteoType {
  const table = METEO.TYPES(actForDay(day))
  const roll = hash2(cycle, 1, METEO_SALT)
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
export function meteoTypeDuCycle(cycle: number, day: number): MeteoType | null {
  if (!meteoCycleEligible(cycle, day)) return null
  const type = meteoTypeBrut(cycle, day)
  // R3 — Brume × orage : EXCLUSIFS À L'ÉLECTION. Deux dénis de zone majeurs le même jour
  // rendraient la journée illisible ; les deux éligibilités étant des fonctions pures du
  // jour, l'exclusion l'est aussi — l'orage d'un jour de Brume se dégrade en pluie. (Depuis
  // R11 le blizzard n'est plus élu : c'est l'orage, qui le devient par grand froid, qu'on
  // écarte — et avec lui sa foudre, le jour où la nappe monte.)
  return type === 'orage' && brumeJourEligible(day) ? 'pluie' : type
}

/**
 * LE FRONT D'UN CYCLE, EN ENTIER — type, bord et fenêtre — comme UNE fonction pure du seul
 * numéro de cycle. `null` si ce cycle n'élit rien.
 *
 * ═══ POURQUOI ELLE EXISTE : LE GEL REMBOBINE (spec `gel.md` G7) ═══
 *
 * `neigeAuSol` doit savoir QUAND le dernier front de neige a quitté un point — donc relire
 * des fronts DÉJÀ PURGÉS de l'état (`state.meteo` ne porte que le front courant). L'élection
 * étant intégralement dérivée du cycle, ce passé se RECALCULE ; mais le recalculer dans
 * `gel.ts` aurait recopié `hash2(cycle, 2)` et `hash2(cycle, 3)` ailleurs — et une seconde
 * copie de la géométrie d'élection finit toujours par mentir, exactement comme un second
 * chemin de type l'aurait fait (voir `meteoTypeDuCycle`). Elle est donc extraite ICI, et
 * `advanceMeteo` la consomme : **un seul écrivain**, du type jusqu'à la fenêtre.
 *
 * Le tick de début de cycle est `cycle × TICKS_PER_CYCLE` — c'est exactement le tick où
 * `advanceMeteo` élit (sa garde est `tick % TICKS_PER_CYCLE === 0`), donc le record rendu
 * est au bit près celui que l'ordonnanceur pose.
 *
 * ⚠ ELLE DIT CE QUE LE CYCLE AURAIT ÉLU, pas ce qui a eu lieu : un monde dont `meteoActive`
 * a été armé en cours de route, ou une sauvegarde reprise au milieu d'un cycle, n'ont jamais
 * VU le front des cycles d'avant. Le seul consommateur (une couverture de neige purement
 * visuelle) s'en accommode ; une règle mécanique, elle, ne devrait pas s'y fier.
 */
export function frontDuCycle(cycle: number, calendarScale: number): MeteoFront | null {
  const debut = cycle * TICKS_PER_CYCLE
  const day = seasonDayAtTick(debut, calendarScale)
  const type = meteoTypeDuCycle(cycle, day)
  if (type === null) return null
  // LE VENT DE CENDRE VIENT DE LA CENDRIÈRE, DONC DU SUD (spec `cortege-cendre.md` R6) — son
  // bord est FORCÉ, jamais tiré : un vent de cendre qui descendrait du nord raconterait le
  // contraire de la carte. On consomme quand même le canal 2 avant de l'écraser, pour que le
  // tirage des AUTRES fronts d'un même cycle reste identique au bit près.
  const tire = Math.min(3, Math.floor(hash2(cycle, 2, METEO_SALT) * 4)) as MeteoFront['edge']
  const edge: MeteoFront['edge'] = type === 'vent_de_cendre' ? 3 : tire
  const marge = TICKS_PER_CYCLE - METEO.TRAVERSEE_TICKS
  const startTick = debut + Math.floor(hash2(cycle, 3, METEO_SALT) * marge)
  return { type, cycle, day, edge, startTick, endTick: startTick + METEO.TRAVERSEE_TICKS }
}

/**
 * La bande du front au tick donné — `null` avant le `startTick` et dès le `endTick`.
 * Interpolation LINÉAIRE du bord d'entrée au bord opposé (patron `brumeCentre`) : le bord
 * avant parcourt `span + largeur` sur la fenêtre, si bien qu'à l'entrée la bande est encore
 * toute dehors et qu'à la fin elle est toute sortie. Fonction pure, partagée avec le client.
 */
/**
 * R13 — LA LARGEUR D'UN FRONT, et son SEUL lecteur (`frontMeteoPos`, `meteoIntensityAt`,
 * la géométrie rembobinée de `neigeAuSol` : tous passent ici — garde A14). Pour la pluie,
 * le brouillard et le vent de cendre, c'est la table. Pour l'ORAGE, la largeur SUIT LE FROID
 * DE LA SAISON : `LARGEUR.orage` au froid d'acte nul → `LARGEUR_ORAGE_FROID` (la carte) au
 * plafond d'`ACT_COLD`, en pente continue sur `ACT_COLD(acte du front) / plafond` — acte I
 * 55 tuiles, acte II ≈ 830, acte III 1 600. Les systèmes s'élargissent avec l'hiver, et le
 * « carte entière » de R9 (« trop large pour être esquivé — PRÉPARER ») reste vrai là où il
 * compte. C'est une GÉOMÉTRIE : élue avec le front (`front.day` porte l'acte), jamais
 * variable par point. Entier : `frontMeteoPos` la compose avec des entiers de carte, et
 * une largeur fractionnaire ferait dériver `lo`/`hi` d'un bit entre moteurs.
 */
export function largeurDe(front: Pick<MeteoFront, 'type' | 'day'>): number {
  const doux: number = METEO.LARGEUR[front.type]
  if (front.type !== 'orage') return doux
  const u = TEMPERATURE.ACT_COLD(actForDay(front.day)) / TEMPERATURE.ACT_COLD.plafond
  return Math.round(doux + (METEO.LARGEUR_ORAGE_FROID - doux) * u)
}

export function frontMeteoPos(front: MeteoFront, tick: number, mapWidth: number, mapHeight: number): BandeMeteo | null {
  if (tick < front.startTick || tick >= front.endTick) return null
  const largeur = largeurDe(front)
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
 * unique, la même qui fait de `meteoTypeDuCycle` la seule élection. `meteoIntensity` n'est
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
  const rampe = METEO.RAMPE * largeurDe(front)
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

// ═══ R11-R12 — LE FROID QUE LE FRONT TROUVE, ET CE QU'IL EN FAIT ═══

/** LA LIMITE DE NEIGE sur `T₀` : il neige là où la pluie ferait geler un gué. */
const LIMITE_NEIGE = METEO.SEUIL_NEIGE + METEO.COLD.pluie

/**
 * R11 — NEIGE-T-IL à cette température du monde SANS le front ? `T₀ − COLD.pluie <
 * SEUIL_NEIGE` : la pluie qui tombe retranche son froid, et si le gué prendrait dessous,
 * c'est de la neige. Une loi, deux lecteurs (le pavé de neige au sol, le flocon à l'écran)
 * et le même zéro degré que `estGele` (`SEUIL_NEIGE = GEL.SEUIL_GUE`, garde A12).
 */
export function neigeA(t0: number): boolean {
  return t0 < LIMITE_NEIGE
}

/**
 * R12 — LE REFROIDISSEMENT ÉOLIEN : la part de « blizzard » d'un orage, de 0 (le monde sous
 * lui est au-dessus de la limite de neige : une pluie violente) à 1 (il est `FROID_EOLIEN_
 * RAMPE` plus bas : le blizzard d'avant, au bit près), en PENTE CONTINUE — jamais un seuil.
 * Lu sur `T₀`, la température SANS le front : aucune circularité possible.
 */
export function froidEolien(t0: number): number {
  const u = (LIMITE_NEIGE - t0) / METEO.FROID_EOLIEN_RAMPE
  return u < 0 ? 0 : u > 1 ? 1 : u
}

/** `doux` par temps doux, `froid` par grand froid, la pente R12 entre les deux — pour un
 *  orage ; les autres classes n'ont qu'une ligne. */
function effetOrage(front: MeteoFront, doux: number, froid: number, t0: number): number {
  if (front.type !== 'orage') return doux
  return doux + (froid - doux) * froidEolien(t0)
}

/** LE PLEIN FROID d'une classe — le pire qu'elle puisse retrancher, pour les bornes
 *  (`plancherDeLaVallee`) : la ligne `ORAGE_FROID` pour l'orage, la table sinon. */
export function coldMaximal(type: MeteoType): number {
  return type === 'orage' ? METEO.ORAGE_FROID.COLD : METEO.COLD[type]
}

/**
 * R4 — LE FROID DU FRONT en (x, y) : `froid(classe, T₀) × meteoIntensity` — 0 sans front et
 * hors bande, le plein froid au cœur, en RAMPE continue entre les deux (le gradient de
 * `meteoIntensity` : le froid MONTE quand le front arrive — une pente, jamais un mur).
 * C'est une EXPOSITION, patron exact de `brumeCold` : `temperature.ts` l'amortit sous un
 * abri (`SHELTER_FACTOR`) et la PLANCHE au feu, à la source chaude et à la tenue — toute
 * la chaîne vitale (dérive, hypothermie, vitesse, endurance) suit par construction, zéro
 * code neuf côté vitals. Le brouillard a COLD 0 : il ne refroidit pas, au bit près. Pour
 * l'ORAGE, le froid dépend du froid qu'il trouve (R12, `froidEolien`).
 */
export function meteoCold(state: SimState, x: number, y: number): number {
  return meteoColdAt(state, x, y, state.tick)
}

/**
 * LE MÊME FROID, À UN TICK QUELCONQUE — pour l'hystérésis du dégel (spec `gel.md` G8), qui
 * demande la température du passé PROCHE au même point. La géométrie de la bande étant une
 * fonction pure du tick (`meteoIntensityAt`), la relire en arrière est gratuit et exact TANT
 * QUE c'est le même front : `startTick`/`endTick` du record bornent d'eux-mêmes la fenêtre
 * (avant `startTick`, l'intensité est nulle — le passé d'avant l'entrée du front est donc
 * juste). Un front DÉJÀ PURGÉ, lui, est invisible : on sous-estime alors le froid d'hier,
 * jamais on ne le surestime.
 *
 * `t0` est la température du monde SANS le front au même point et au même tick — l'appelant
 * de `froidDuMonde` l'a déjà en main (c'est lui qui l'écrit) ; les autres lecteurs passent
 * par `meteoColdAt` sans le cinquième argument, qui le relit.
 */
export function meteoColdAt(state: SimState, x: number, y: number, tick: number, t0?: number): number {
  return meteoColdSousFront(state, state.meteo, x, y, tick, t0)
}

/** Le froid d'un front DONNÉ (courant ou rembobiné — `neigeAuSol` relit les cycles passés
 *  par `frontDuCycle`), au point et au tick. */
export function meteoColdSousFront(
  state: SimState,
  front: MeteoFront | null | undefined,
  x: number,
  y: number,
  tick: number,
  t0?: number,
): number {
  if (!front) return 0
  const intensite = meteoIntensityAt(front, tick, state.map.width, state.map.height, x, y)
  if (intensite <= 0) return 0
  const cold = effetOrage(front, METEO.COLD[front.type], METEO.ORAGE_FROID.COLD, t0 ?? dehorsSansMeteo(state, x, y, tick))
  return cold === 0 ? 0 : cold * intensite
}

/**
 * R11 — L'ASPECT DU CIEL en (x, y) au tick : `null` hors de toute bande ; sinon la classe du
 * front, sauf que la pluie est de la NEIGE et l'orage un BLIZZARD là où il neige (`neigeA` sur
 * `T₀`). C'est ce que le client dessine (flocons ou gouttes, au point de la caméra) et ce que
 * `neigeAuSol` accumule (tranche par tranche, sur le front rembobiné) — un seul écrivain.
 * `front` explicite pour le rembobinage ; `meteoAspectAt` le lit sur l'état.
 */
export function aspectSousFront(
  state: SimState,
  front: MeteoFront | null | undefined,
  x: number,
  y: number,
  tick: number,
): MeteoAspect | null {
  if (!front) return null
  if (meteoIntensityAt(front, tick, state.map.width, state.map.height, x, y) <= 0) return null
  return aspectAuPoint(state, front, x, y, tick)
}

/**
 * CE QUE CE FRONT SERAIT ICI s'il couvrait ce point — la même loi, SANS le test d'empreinte.
 * Pour le rendu : le mur qui approche se dessine avant de couvrir le joueur, et il doit déjà
 * être de neige ou de pluie selon le froid qu'il va trouver sous lui (au point de l'œil).
 */
export function aspectAuPoint(state: SimState, front: Pick<MeteoFront, 'type'>, x: number, y: number, tick: number): MeteoAspect {
  if (front.type !== 'pluie' && front.type !== 'orage') return front.type
  if (!neigeA(dehorsSansMeteo(state, x, y, tick))) return front.type
  return front.type === 'pluie' ? 'neige' : 'blizzard'
}

export function meteoAspectAt(state: SimState, x: number, y: number, tick: number = state.tick): MeteoAspect | null {
  return aspectSousFront(state, state.meteo, x, y, tick)
}

/**
 * R9 × R13 — CE FRONT EST-IL « LE BLIZZARD » au sens de l'annonce ? Un orage dont l'aspect EN
 * PLAINE À DÉCOUVERT (biome 0, ni Brume ni cendre — le ciel clair de la table de `GEL`), AU
 * MILIEU DE SA FENÊTRE, est `blizzard`. Fonction pure du front et du calendrier (base, acte,
 * heure) : l'annonce de la veille et l'entrée du lendemain lisent la MÊME — elle dit vrai par
 * construction. Le Névé aura pire que l'annonce, jamais mieux ; et un orage d'acte II en plein
 * jour (plaine 65 > limite 55) n'est PAS annoncé — il sera pluie en plaine, neige sur les hauts.
 */
export function frontEstBlizzard(state: SimState, front: Pick<MeteoFront, 'type' | 'startTick' | 'endTick'>): boolean {
  if (front.type !== 'orage') return false
  const milieu = Math.floor((front.startTick + front.endTick) / 2)
  const time = gameTimeAt(state, milieu)
  const t0 = TEMPERATURE.BASE - TEMPERATURE.ACT_COLD(time.act) - (time.isNight ? TEMPERATURE.NIGHT_COLD : 0)
  return neigeA(t0 < 0 ? 0 : t0)
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
/**
 * R6 — LA POUSSÉE DU VENT DE CENDRE, en tuiles de front, au point donné.
 * *(spec `cortege-cendre.md` R6 — décision d'Alexis 2026-08-21.)*
 *
 * ═══ CE QU'ELLE POUSSE, ET CE QU'ELLE NE POUSSE PAS ═══
 *
 * Elle ne rend PAS du froid : elle rend **des tuiles de front**, que `froidDuMonde` ajoute au
 * front avant de demander au cortège s'il fait froid ici. Le vent avance donc la bande froide
 * devant lui — et **rien d'autre**. Le front réel n'a pas bougé : rien ne brûle de plus, aucun
 * nœud ne devient stérile, aucun sol ne devient plus hanté. Quand le vent est passé, le monde
 * est exactement où il était. *La poussée, pas l'avancée.*
 *
 * C'est ce qui autorise ce type à revenir chaque année sans user la carte, là où une avancée
 * supplémentaire serait un vol définitif de terrain.
 *
 * Nulle pour tout autre type de front, et sur une carte sans Cendrière (`bandeDeCendre` rend 0) :
 * un banc headless ne connaît donc aucun vent de cendre, au bit près.
 *
 * Elle suit `meteoIntensityAt` — donc la même RAMPE bord → cœur que le froid du front lui-même :
 * le vent se sent venir, il ne tombe pas d'un coup (patron `meteo.md` R4).
 */
export function pousseeDeCendre(state: SimState, x: number, y: number, tick: number): number {
  const front = state.meteo
  if (!front || front.type !== 'vent_de_cendre') return 0
  const portee = bandeDeCendre(state.map, CENDRE.POUSSEE_PART)
  if (portee <= 0) return 0
  return portee * meteoIntensityAt(front, tick, state.map.width, state.map.height, x, y)
}

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
  const intensite = meteoIntensity(state, x, y)
  if (intensite <= 0) return 1
  const plein = effetOrage(front, METEO.FEU_CONSO[front.type], METEO.ORAGE_FROID.FEU_CONSO, dehorsSansMeteo(state, x, y, state.tick))
  if (plein === 1) return 1
  return 1 + (plein - 1) * intensite
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
  return meteoSpeedFactorAt(state, state.tick, x, y)
}

/**
 * LE MÊME MALUS DE PAS, SANS ÉTAT — pour LA PRÉDICTION LOCALE DU CLIENT (spec R7, dernière
 * ligne du « hors périmètre » de `meteo.md`).
 *
 * L'autorité multiplie déjà la vitesse de l'avatar par ce facteur, au point du marcheur ;
 * un client qui l'ignore prédit 5 à 20 % trop vite sous un front (jusqu'à ×0,8 sous
 * blizzard) et l'avatar fait de l'élastique à chaque réconciliation. Le remède n'est pas
 * de recopier la formule côté client — c'est de lui donner LA MÊME, appelée sur la façade
 * d'état que le client reconstitue du snapshot (`etat-gel.ts` : le front, la carte, l'heure
 * — depuis R12 le pas sous un orage dépend du froid du monde, donc de l'heure et du biome).
 * Écrivain unique, jusqu'à la prédiction.
 */
export function meteoSpeedFactorAt(state: SimState, tick: number, x: number, y: number): number {
  const front = state.meteo
  if (!front) return 1
  const intensite = meteoIntensityAt(front, tick, state.map.width, state.map.height, x, y)
  if (intensite <= 0) return 1
  const plein = effetOrage(front, METEO.SPEED[front.type], METEO.ORAGE_FROID.SPEED, dehorsSansMeteo(state, x, y, tick))
  if (plein === 1) return 1
  return 1 - (1 - plein) * intensite
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
  const intensite = meteoIntensity(state, x, y)
  if (intensite <= 0) return 1
  const plein = effetOrage(front, METEO.VISION[front.type], METEO.ORAGE_FROID.VISION, dehorsSansMeteo(state, x, y, state.tick))
  if (plein === 1) return 1
  return 1 - (1 - plein) * intensite
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
  const impactTick = creneauStart + Math.floor(hash2(front.cycle, 3 * k, FOUDRE_SALT) * FOUDRE_CRENEAU_TICKS)
  if (tick !== impactTick) return null
  const bande = frontMeteoPos(front, impactTick, mapWidth, mapHeight)
  if (!bande) return null // filet : jamais atteint pour un créneau plein (impactTick < endTick)
  const c = bande.lo + hash2(front.cycle, 3 * k + 1, FOUDRE_SALT) * (bande.hi - bande.lo)
  const autre = hash2(front.cycle, 3 * k + 2, FOUDRE_SALT) * (bande.axis === 'x' ? mapHeight : mapWidth)
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
 * `lastMeteoCycle` (une par jour au plus). Et le BLIZZARD se dit (R9) — les quatre autres
 * types restent muets, leur annonce est géométrique (on voit le mur venir) : l'annonce la
 * veille au crépuscule (`blizzard_annonce`, le même bord de cycle que l'annonce de Brume,
 * gardée par `lastMeteoAnnonceCycle`), l'entrée réelle de la bande (`blizzard_entre`, au
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
    if (frontEstBlizzard(state, front)) emitEvent(state, { type: 'blizzard_passe', tick: state.tick, day: front.day })
    state.meteo = null
  }

  // L'ÉLECTION, au bord de cycle — UN TIRAGE PAR CYCLE, jamais par jour de saison. La
  // fenêtre élue finit avant le cycle suivant (TRAVERSEE_TICKS ≤ TICKS_PER_CYCLE) : le
  // record est donc toujours libre ici, et un seul front vit à la fois par construction.
  if (state.tick % TICKS_PER_CYCLE === 0) {
    const cycle = Math.floor(state.tick / TICKS_PER_CYCLE)
    if (state.lastMeteoCycle !== cycle) {
      state.lastMeteoCycle = cycle
      // L'élection ENTIÈRE vit dans `frontDuCycle` — écrivain unique, du type à la fenêtre
      // (le gel rembobine les cycles passés par la même fonction, spec `gel.md` G7).
      const elu = frontDuCycle(cycle, state.calendarScale)
      if (elu !== null) state.meteo = elu
    }
  }

  // R9 — L'ENTRÉE RÉELLE du blizzard : le tick où la bande devient active (`startTick`),
  // pas l'élection de l'aube — entre les deux il peut s'écouler des heures de ciel clair,
  // et « il entre » dit le moment où le froid commence à mordre. Après l'élection : un
  // front qui entre au tick même de son élection s'émet ce tick-là.
  const actif = state.meteo
  if (actif && !actif.entre && state.tick >= actif.startTick && frontEstBlizzard(state, actif)) {
    actif.entre = true
    emitEvent(state, { type: 'blizzard_entre', tick: state.tick, day: actif.day })
  }

  // R9 — L'ANNONCE, la veille au CRÉPUSCULE (le même bord que l'annonce de Brume) : le
  // blizzard est trop large pour être esquivé, la réponse est PRÉPARER — rentrer le bois,
  // remplir le garde-manger. On lit l'élection de DEMAIN — le jour du prochain bord de
  // cycle, jamais `day + 1` : à toute échelle de calendrier, c'est CE jour-là que l'aube
  // élira — par `meteoTypeDuCycle`, la même fonction que l'aube : le mensonge est
  // impossible par construction. Elle précède l'entrée d'au moins un crépuscule → aube :
  // le `startTick` du front de demain est ≥ son aube, et l'annonce tombe la nuit d'avant.
  if (state.tick % TICKS_PER_CYCLE !== DAY_TICKS_PER_CYCLE) return
  const aubeProchaine = state.tick + (TICKS_PER_CYCLE - DAY_TICKS_PER_CYCLE)
  const cycleProchain = Math.floor(aubeProchaine / TICKS_PER_CYCLE)
  const demain = seasonDayAtTick(aubeProchaine, state.calendarScale)
  if (state.lastMeteoAnnonceCycle === cycleProchain) return
  state.lastMeteoAnnonceCycle = cycleProchain
  // Depuis R11-R13 « blizzard » se lit sur le front ENTIER (classe + fenêtre + calendrier) :
  // `frontDuCycle` est l'écrivain unique de l'élection, `frontEstBlizzard` celui du sens.
  const elu = frontDuCycle(cycleProchain, state.calendarScale)
  if (!elu || !frontEstBlizzard(state, elu)) return
  emitEvent(state, { type: 'blizzard_annonce', tick: state.tick, day: demain })
}
