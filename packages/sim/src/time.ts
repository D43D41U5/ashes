/**
 * Le temps — fonctions pures du numéro de tick (spec monde R1-R4).
 *
 * Deux échelles distinctes :
 * - Le CYCLE (jour/nuit diégétique) : durée réelle fixe, jamais accélérée —
 *   c'est le rythme moment-à-moment des sessions.
 * - Le CALENDRIER (jour de saison, actes) : accéléré par `calendarScale`
 *   (1 en multi ; grand en Veillée et en test pour jouer une saison vite).
 */
import { BALANCE, dureteDeLAnnee, TEMPERATURE, phaseOf, tourOf } from './balance'
import { emitEvent } from './events'
import { effetsDuJour } from './modificateur'
import type { SimState } from './sim'

export const TICKS_PER_CYCLE = BALANCE.CYCLE_REAL_MINUTES * 60 * BALANCE.TICK_RATE_HZ
/**
 * LA LONGUEUR DU JOUR, EN TICKS — **une fonction du jour de l'année depuis le 2026-08-23**
 * (spec `saisons.md` S6 ; c'était la constante `DAY_TICKS_PER_CYCLE`).
 *
 * La nuit dure 8,4 min réelles au cœur de l'Ardeur et 15,6 au cœur du Grand Froid, et vaut
 * pile la valeur d'avant aux équinoxes — la moyenne annuelle ne bouge donc pas, rien n'est
 * recalibré par accident. La nuit étant la fenêtre de danger (chasse nocturne, hordes, le
 * froid qui mord), les deux pressions s'additionnent là où c'est voulu.
 *
 * ⚠ **ELLE SE LIT SUR LE JOUR DU DÉBUT DU CYCLE, jamais sur le jour courant.** Le calendrier
 * bascule à l'heure de départ de la partie (9 h en Veillée), donc EN COURS de cycle : une
 * lecture au jour courant ferait bouger le crépuscule au milieu de la journée, et le tick
 * d'égalité qui porte l'annonce de la Brume, la planification des hordes et le crépuscule des
 * villages PNJ pourrait être ENJAMBÉ — l'événement se perdrait en silence. `dayTicksAt` prend
 * donc le tick, remonte à l'aube de son cycle, et rend une valeur constante sur tout le cycle.
 */
export function dayTicksPourJour(jour: number): number {
  return Math.round(TICKS_PER_CYCLE * BALANCE.PART_DE_JOUR(jour))
}
/**
 * L'HEURE MURALE DU LEVER, CE JOUR-LÀ (`BALANCE.LEVER_DU_JOUR`, 2026-08-26) — 06h46 aux
 * équinoxes, 04h45 au solstice d'été, 08h43 à celui d'hiver, le soleil de Paris.
 *
 * ⚠ **MÊME PIÈGE QUE `dayTicksPourJour` : elle se lit sur le jour du DÉBUT DU CYCLE**, jamais
 * sur le jour courant (`leverAt` s'en charge). Le calendrier bascule en cours de cycle, et une
 * lecture au jour courant ferait sauter l'horloge murale d'un quart d'heure en pleine
 * journée — un saut qu'aucun phénomène du monde n'expliquerait.
 */
export function leverPourJour(jour: number): number {
  return BALANCE.LEVER_DU_JOUR(jour)
}
/** Durée de la pente du froid nocturne, en ticks — dérivée de `NIGHT_RAMP_HOURS`, jamais écrite. */
export const NIGHT_RAMP_TICKS = Math.round((TEMPERATURE.NIGHT_RAMP_HOURS / 24) * TICKS_PER_CYCLE)
/** Ticks par jour de saison à l'échelle 1 (un jour réel). */
export const TICKS_PER_SEASON_DAY = 86400 * BALANCE.TICK_RATE_HZ

/**
 * L'ACTE EST UN ENTIER NON BORNÉ (spec `saison-sans-fin.md` R2 : il ne porte plus les chiffres,
 * il NOMME). Le type `1 | 2 | 3` d'origine figeait dans le temps ce que la spec délie — comme
 * `act_started.act` le figeait dans le bus. Les consommateurs passent par des LOIS totales
 * (`actLaw`, `balance.ts`), jamais par une table indexée : un acte 7 ne rend rien d'indéfini.
 * `actForDay` plafonne ENCORE à 3 — c'est le calendrier des tours (T2) qui le libère.
 */
export type Act = number

export interface GameTime {
  tick: number
  /**
   * Heure murale du cycle, dans [0, 24) — minuit (0h) au cœur de la nuit, midi en
   * plein jour. Le cycle démarre au LEVER (`lever`, saisonnier) ; à l'équinoxe
   * DAY_FRACTION=0.625 : jour 6h→21h, nuit 21h→6h (bascule reflétée par `isNight`).
   */
  hourOfCycle: number
  isNight: boolean
  /**
   * LA PART DE NUIT, dans [0, 1] — le froid nocturne en PENTE (voir `partDeNuit`). Vaut 1
   * partout où `isNight` est vrai ; ce sont les lisières du JOUR qui la portent entre 0 et 1.
   * `isNight` reste le booléen des COMPORTEMENTS (la chasse nocturne, le brûlage, le ralliement
   * au feu ne se font pas « à 40 % ») ; `nuit` est celui du FROID, qui, lui, a une pente.
   */
  nuit: number
  /** La longueur du JOUR de ce cycle, en ticks — saisonnière (S6), constante sur le cycle. */
  dayTicks: number
  /**
   * L'HEURE MURALE DU LEVER de ce cycle — saisonnière depuis le 2026-08-26, constante sur le
   * cycle. Elle est PORTÉE plutôt que recalculée par le client parce que le rendu doit se caler
   * sur EXACTEMENT le même lever que la sim : la recalculer là-bas, c'est rouvrir la porte à
   * deux chaînes qui ne sont pas à la même heure (le défaut du 2026-08-25 sur `sunDirection`).
   * Avec `dayTicks`, elle donne le coucher : `lever + 24 × dayTicks / TICKS_PER_CYCLE`.
   */
  lever: number
  /** Jour de saison, à partir de 1. Peut dépasser SEASON_DAYS (la Cendre finale). */
  seasonDay: number
  /**
   * LA PART DU JOUR DÉJÀ ÉCOULÉE, dans [0, 1) — `seasonDay` avec ses décimales.
   *
   * Elle existe pour ce qui doit COULER au lieu de sauter. `seasonDay` est un entier : tout
   * ce qui s'y accroche avance d'un cran une fois par jour, et un ruban de calendrier qui
   * saute de vingt-trois pixels une fois par cycle (trente minutes) ne DÉFILE pas, il claque.
   * Dérivée du tick comme le jour lui-même, par la même division — les deux ne peuvent donc
   * pas se contredire.
   */
  jourFrac: number
  act: Act
  /** L'année, à partir de 1 — le TOUR des lois (T2). */
  tour: number
  /** La saison dans l'année, 1..ACTS_PER_YEAR — la PHASE des lois (T2). */
  phase: number
}

/**
 * LE JOUR DE SAISON À UN TICK — `jourDeDepart` est le jour où le monde COMMENCE (spec
 * `saisons.md` S2 : le vrai jeu ouvre au **jour 61**, à l'ouverture des Pluies ; les montages de
 * test ouvrent au jour 1, à l'Éclosion).
 *
 * Le troisième paramètre est REQUIS, et c'est délibéré : le rendre optionnel aurait laissé
 * compiler tous les appels d'avant en leur donnant silencieusement le jour 1. C'est le
 * compilateur qui a énuméré les sites à convertir, pas un grep.
 */
export function seasonDayAtTick(tick: number, calendarScale: number, jourDeDepart: number): number {
  return Math.floor((tick * calendarScale) / TICKS_PER_SEASON_DAY) + jourDeDepart
}

/** La part du jour écoulée à ce tick, dans [0, 1) — la MÊME division que `seasonDayAtTick`,
 *  privée de son plancher. Pure, sans branche : ce qui coule et ce qui compte sortent du même
 *  calcul, donc le franchissement d'un jour tombe exactement où la fraction repasse à zéro. */
export function fractionDuJourAtTick(tick: number, calendarScale: number): number {
  const jours = (tick * calendarScale) / TICKS_PER_SEASON_DAY
  return jours - Math.floor(jours)
}

/** LE JOUR DE SAISON DE L'ÉTAT — la lecture courante, celle que presque tout le monde veut. */
export function jourDeSaison(state: SimState, tick?: number): number {
  return seasonDayAtTick(tick ?? state.tick, state.calendarScale, state.jourDeDepart)
}

/** Le tick de l'AUBE du cycle où tombe `tick` (le cycle est décalé par `cycleOffset`). */
export function debutDeCycle(state: SimState, tick: number): number {
  return tick - (((tick + state.cycleOffset) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
}

/** La longueur du jour du cycle où tombe `tick` — constante sur tout le cycle (voir
 *  `dayTicksPourJour`). C'est le tick de crépuscule, en coordonnée de cycle. */
export function dayTicksAt(state: SimState, tick: number): number {
  return dayTicksPourJour(jourDeSaison(state, debutDeCycle(state, tick)))
}

/** L'heure murale du lever du cycle où tombe `tick` — constante sur tout le cycle, exactement
 *  comme `dayTicksAt`, et pour la même raison. */
export function leverAt(state: SimState, tick: number): number {
  return leverPourJour(jourDeSaison(state, debutDeCycle(state, tick)))
}

/** LE CRÉPUSCULE TOMBE-T-IL À CE TICK ? L'écrivain unique de l'égalité — quatre systèmes
 *  planifient dessus (annonce de la Brume, hordes, villages PNJ, annonce météo) et la rater,
 *  c'est perdre l'événement sans une erreur. */
export function estCrepuscule(state: SimState, tick: number): boolean {
  return ((tick + state.cycleOffset) % TICKS_PER_CYCLE) === dayTicksAt(state, tick)
}

/**
 * L'ACTE D'UN JOUR — NON BORNÉ (saison-sans-fin A1, T2). Un acte tous les `ACT_DAYS` jours, à
 * vie : l'an 1 a ses actes 1-4 (jours 1-84), l'an 2 ses actes 5-8, et ainsi de suite. Monotone
 * non décroissant par construction ; un jour < 1 est l'acte 1.
 */
export function actForDay(day: number): Act {
  const d = day < 1 ? 1 : Math.floor(day)
  return Math.floor((d - 1) / BALANCE.ACT_DAYS) + 1
}

/**
 * LE CŒUR DE LA SAISON SUIVANTE, en jour de saison — où le saut de calendrier du debug se pose.
 *
 * ═══ POURQUOI LE CŒUR, ET PAS LE PREMIER JOUR ═══
 *
 * Ce qui caractérise une saison ne se voit PAS à son bord : les courbes annuelles (`SOCLE`,
 * `ECART_NUIT`, `PART_DE_JOUR`) sont définies par leurs CARDINAUX, un par saison, posés en son
 * milieu, et interpolées entre eux — le premier jour d'une saison est donc à mi-chemin de la
 * précédente. Sauter au jour 121 pour « voir l'Éclosion » montre un hiver qui finit ; sauter au
 * 135 montre le printemps.
 *
 * Le décalage vaut `(ACT_DAYS − 1) / 2`, ce qui pose le saut EXACTEMENT sur les cardinaux
 * (j15 · j45 · j75 · j105) sans les recopier : les cardinaux SONT les cœurs. Une garde le
 * vérifie contre `TEMPERATURE.SOCLE`, sinon les deux dériveraient en silence.
 *
 * VERS L'AVANT SEULEMENT, et c'est délibéré : `debug_set_season_day` déplace le TICK, qui est
 * la seule horloge (`monde.md` R1). Reculer laisserait tous les minuteurs de l'état (repousse,
 * péremption, chantiers) dans un futur qu'on ne rattraperait qu'en rejouant — un outil de debug
 * qui ment est pire que pas d'outil.
 */
export function coeurDeLaSaisonSuivante(jour: number): number {
  const debut = actForDay(jour) * BALANCE.ACT_DAYS + 1
  return debut + Math.floor((BALANCE.ACT_DAYS - 1) / 2)
}

/** L'année du jour, à partir de 1 (le TOUR `k` des lois). */
export function tourForDay(day: number): number {
  return tourOf(actForDay(day))
}

/** La saison dans l'année, 1..ACTS_PER_YEAR (la PHASE des lois). */
export function phaseForDay(day: number): number {
  return phaseOf(actForDay(day))
}

/** La longueur d'une année en jours de jeu — dérivée dans `balance.ts` (les courbes annuelles
 *  s'en servent à la construction), republiée ici où le calendrier se lit. */
export { YEAR_DAYS, jourDeLAnnee } from './balance'

/**
 * LA RAMPE DE SAISON — **cyclique depuis le 2026-08-23** (spec `saisons.md` S15).
 *
 * Elle montait jour après jour et se CLAMPAIT au jour `SEASON_DAYS` : un arc à sens unique.
 * Sous une année qui boucle, les sept quantités qu'elle pilote — taille et chance de horde,
 * population de Cendreux, leur cri, les morts-vivants de la chasse nocturne, le cap de
 * fréquentation des lieux — atteignaient toutes leur maximum **au milieu de l'Ardeur de
 * l'an 1** et n'en redescendaient plus jamais : hordes pleines chaque nuit, dès le premier
 * été, pour toujours.
 *
 * Elle lit maintenant `dureteDeLAnnee` : 0 au cœur de l'Ardeur, 1 au cœur du Grand Froid, la
 * pente du froid entre les deux, et un PLANCHER qui monte d'un tour à l'autre. La signature
 * ne bouge pas — le jour de saison porte à lui seul le jour de l'année ET le tour — donc les
 * sept sites changent sans un diff chez eux.
 */
export function seasonRamp(debut: number, fin: number, day: number): number {
  // LE CARACTÈRE DE LA SAISON peut relever le PLANCHER (S18) : le Réveil sort les Cendreux dès
  // le printemps, la Meute tient l'hiver au plafond. Il ne peut jamais l'abaisser.
  const plancher = effetsDuJour(day).plancherMenace ?? 0
  const durete = dureteDeLAnnee(day)
  return debut + (fin - debut) * (durete > plancher ? durete : plancher)
}


/**
 * LE COUPLAGE VEILLÉE (V0-9) — dérive le `calendarScale` pour qu'une saison de `SEASON_DAYS`
 * jours s'étende sur EXACTEMENT `cycles` cycles jour/nuit.
 *
 * Le problème que ça règle (réserve de la spec saison) : en Veillée, le calendrier est
 * accéléré indépendamment du cycle. À une échelle trop forte, les 60 jours défilent en 2,5
 * cycles → le premier crépuscule de l'acte III (où déferle la méga-horde) tombe APRÈS la fin
 * de saison, et toute la pression de l'endgame est INOBSERVABLE en solo. En liant l'échelle
 * au nombre de cycles, la saison dure `cycles` cycles pile : chaque nuit est un pas
 * observable du calendrier, et l'acte III tient dans la saison.
 *
 * `cycles` est la CALIBRATION — durée de session, densité d'escalade (à régler en playtest,
 * cf. `VEILLEE_SEASON_CYCLES` côté client). Le couplage, lui, est MÉCANIQUE : il tient quel
 * que soit `CYCLE_REAL_MINUTES`, on ne re-calera jamais l'échelle à la main. Pur, déterministe
 * (× et /) — n'affecte que le mapping tick→jour, jamais le flux RNG.
 */
export function calendarScaleForSeasonCycles(cycles: number): number {
  return (BALANCE.SEASON_DAYS * TICKS_PER_SEASON_DAY) / (cycles * TICKS_PER_CYCLE)
}

/**
 * Décalage de phase (ticks) pour qu'une partie DÉMARRE à `startHour` (horloge
 * murale, 0-24). N'affecte que le cycle jour/nuit, jamais le calendrier de
 * saison. Ex. `cycleOffsetForStartHour(0)` → commencer à minuit (en pleine nuit).
 */
export function cycleOffsetForStartHour(startHour: number, jourDeDepart: number): number {
  // ⚠ LE JOUR EST REQUIS DEPUIS QUE LE LEVER BOUGE (2026-08-26) : « commencer à 9 h » ne veut
  // plus rien dire sans savoir de quel matin on parle — 9 h, c'est trois heures après le lever
  // en juin et vingt minutes après en décembre. Le rendre optionnel aurait laissé compiler
  // tous les appels d'avant en leur donnant silencieusement le lever du jour 1 ; c'est le
  // compilateur qui énumère les sites, comme pour `seasonDayAtTick`.
  const fromDawn = (((startHour - leverPourJour(jourDeDepart)) % 24) + 24) % 24
  return Math.round((fromDawn / 24) * TICKS_PER_CYCLE)
}

/**
 * LA PART DE NUIT À CE POINT DU CYCLE — le multiplicateur de l'écart de nuit (`ECART_NUIT`,
 * saisonnier depuis S5 ; c'était la constante `NIGHT_COLD`) (décision d'Alexis
 * 2026-08-23 ; le pourquoi et le prix sont en tête de `NIGHT_RAMP_HOURS`, `balance.ts`).
 *
 * 0 en plein jour, 1 sur TOUTE la nuit, et une PENTE LINÉAIRE de `NIGHT_RAMP_TICKS` sur les
 * deux lisières du JOUR : le froid monte dans la dernière heure et demie de jour (le soir se
 * sent venir) et se retire dans la première (l'aube est le fond du froid, il lâche au soleil).
 *
 * ═══ LES DEUX PENTES SONT DU CÔTÉ DU JOUR, ET C'EST STRUCTUREL ═══
 *
 * `cycleTick >= DAY_TICKS_PER_CYCLE ⟹ 1`, sans exception : **la nuit est bit-exacte avec
 * l'avant-rampe.** C'est ce qui compte, et deux mesures du 2026-08-23 le disent :
 *   · AU TICK DU CRÉPUSCULE, `planifierHorde` lit l'éveil pour dimensionner la marche du soir
 *     (`porteeDeNuit`). Une rampe centrée sur 21h y aurait mis 0,5 : toutes les hordes du jeu
 *     auraient rétréci, en silence.
 *   · SUR LA NUIT ENTIÈRE, `nighthunt` tire l'espèce contre l'éveil. Faire retomber le froid
 *     avant l'aube renvoie des loups dans les nuits d'acte III — or « le vivant a quitté la
 *     vallée » est une PROMESSE de la spec (R11), testée à zéro. Une pente côté nuit la rompt,
 *     quelle que soit sa largeur.
 *
 * Le prix, assumé : le tick de l'aube (`cycleTick` 0) porte désormais le plein froid de la
 * nuit — c'est physiquement juste (l'aube est le fond du froid), mais c'est le tick 0 de
 * `createSim`, donc de presque tout montage de test. Sept d'entre eux disaient « de jour, il
 * fait doux » en se posant pile sur l'aube : ils ont été déplacés à midi, ce que la règle
 * maison prescrivait déjà (« jamais poser un état pile sur l'aube »). AUCUNE partie réelle
 * n'y touche : la Veillée comme le LAN démarrent à 9 h.
 *
 * Continue partout — le pas maximal vaut `ECART_NUIT(jour) / NIGHT_RAMP_TICKS` (0,0033 °C
 * mesuré à l'écart d'alors,
 * contre 12 avant), gardé par un balayage dans `time.test.ts`. Le `max` des deux lisières
 * plutôt qu'un `if` : une rampe plus longue que la demi-journée dégrade proprement au lieu de
 * trouer la fonction. Pur : / et comparaisons (invariant #2).
 */
export function partDeNuit(cycleTick: number, dayTicks: number): number {
  if (cycleTick >= dayTicks) return 1
  const aube = 1 - cycleTick / NIGHT_RAMP_TICKS
  const crepuscule = 1 - (dayTicks - cycleTick) / NIGHT_RAMP_TICKS
  const v = aube > crepuscule ? aube : crepuscule
  return v < 0 ? 0 : v > 1 ? 1 : v
}


/**
 * L'HEURE DU MONDE À UN TICK QUELCONQUE — la même loi que `getGameTime`, prise sur un tick
 * fourni plutôt que sur celui de l'état.
 *
 * Elle existe pour L'HYSTÉRÉSIS DU DÉGEL (spec `gel.md` G8) : le gel doit savoir s'il faisait
 * franchement froid ICI il y a un instant, ce qui demande de relire l'heure du passé proche.
 * Le tick est la seule horloge (spec `monde.md` R1) — donc ce passé se RECALCULE, il ne se
 * range pas. `getGameTime` n'est plus qu'elle, prise sur `state.tick` : mêmes expressions,
 * même ordre, au bit près.
 */
export function gameTimeAt(state: SimState, tick: number): GameTime {
  const cycleTick = (tick + state.cycleOffset) % TICKS_PER_CYCLE
  const seasonDay = jourDeSaison(state, tick)
  const dayTicks = dayTicksAt(state, tick)
  // Le cycle démarre au LEVER — dont l'heure murale suit la saison (2026-08-26) : on décale la
  // phase du cycle vers l'horloge murale par le lever de CE cycle, pas par une constante.
  const lever = leverAt(state, tick)
  const wallHour = (cycleTick / TICKS_PER_CYCLE) * 24 + lever
  return {
    tick,
    hourOfCycle: ((wallHour % 24) + 24) % 24,
    isNight: cycleTick >= dayTicks,
    nuit: partDeNuit(cycleTick, dayTicks),
    dayTicks,
    lever,
    seasonDay,
    jourFrac: fractionDuJourAtTick(tick, state.calendarScale),
    act: actForDay(seasonDay),
    tour: tourForDay(seasonDay),
    phase: phaseForDay(seasonDay),
  }
}

export function getGameTime(state: SimState): GameTime {
  return gameTimeAt(state, state.tick)
}

/**
 * Incrémente le tick et émet les événements de temps franchis.
 * Appelé une fois par step(), en fin de tick.
 */
export function advanceTime(state: SimState): void {
  const dayBefore = jourDeSaison(state)
  state.tick += 1

  const cycleTick = (state.tick + state.cycleOffset) % TICKS_PER_CYCLE
  if (cycleTick === 0) emitEvent(state, { type: 'day_started', tick: state.tick })
  if (estCrepuscule(state, state.tick)) emitEvent(state, { type: 'night_started', tick: state.tick })

  const dayAfter = jourDeSaison(state)
  // À très grande échelle, un tick peut franchir plusieurs jours : on émet chacun.
  for (let day = dayBefore + 1; day <= dayAfter; day++) {
    emitEvent(state, { type: 'season_day_started', tick: state.tick, day })
    if (actForDay(day) !== actForDay(day - 1)) {
      emitEvent(state, { type: 'act_started', tick: state.tick, act: actForDay(day) })
    }
  }
}
