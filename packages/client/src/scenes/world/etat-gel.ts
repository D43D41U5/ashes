/**
 * L'ÉTAT QUE LE GEL DEMANDE — reconstitué côté client à partir de ce que l'hôte publie.
 *
 * Le gel (spec `gel.md`) est **entièrement dérivé** : `estGele`, `neigeAuSol` et
 * `feuillageDenude` sont des fonctions PURES de `/sim`, et la doctrine de l'écrivain unique
 * veut que le rendu les appelle telles quelles — jamais une seconde loi peinte à la main.
 * Sauf qu'elles prennent un `SimState`, et que **le client n'en a pas** : il a un snapshot.
 *
 * Ce module fait le pont, et il ne fait que ça. Il ne CALCULE rien du gel — il assemble les
 * champs que les fonctions lisent, et il dit lesquels manquent.
 *
 * ═══ CE QUE LES TROIS FONCTIONS LISENT VRAIMENT (relevé, pas supposé) ═══
 *
 *   `feuillageDenude` → `tick`, `calendarScale`, `map`                      — TOUT DISPONIBLE
 *   `neigeAuSol`      → `meteoActive`, `tick`, `calendarScale`, `map`,
 *                       puis `baselineTemperature` pour la vitesse de fonte
 *   `estGele`         → `baselineTemperature(At)`, donc :
 *                       `tick`, `calendarScale`, `cycleOffset`, `map`,
 *                       `structures`, `brume`, `meteo`
 *
 * Rien d'autre. Ni entités, ni nœuds, ni PRNG : d'où le `as unknown as SimState` au bout —
 * fabriquer quarante champs vides pour en servir sept aurait été un mensonge plus long.
 * `etat-gel.test.ts` compare la façade à un VRAI `SimState` construit par `createSim`, sur un
 * balayage de tuiles et de ticks : c'est ce test qui tient la promesse, pas ce commentaire.
 *
 * ═══ LES TROIS CHAMPS QUE LE SNAPSHOT NE PORTE PAS ═══
 *
 *   ① `cycleOffset` — **RÉCUPÉRÉ, exactement.** `GameTime` porte `hourOfCycle`, et
 *      `cycleOffsetForStartHour` est précisément la fonction qui traduit une heure en tick de
 *      cycle (c'est celle que `debug_set_hour` utilise pour viser une heure sans toucher au
 *      tick). L'inversion est donc l'aller-retour de la fonction de la sim, pas une formule
 *      réécrite. Il FAUT ce champ : l'hystérésis de G8 relit la température `RETARD_TICKS`
 *      plus tôt, et sans la phase du cycle on ne saurait pas si c'était la nuit.
 *
 *   ② `meteoActive` — **POSÉ À VRAI, et c'est exact dans tout ce qui s'expédie.** Ce n'est pas
 *      un pari : `worker/veillee.ts` l'arme à `true` et `server/scenario.ts` aussi. Il n'est
 *      faux que dans les bancs et les tests headless, qui n'ont pas de rendu. Un client qui le
 *      supposerait faux ne peindrait jamais de neige — l'erreur inverse coûterait la
 *      fonctionnalité entière.
 *
 *   ③ `brume` — **PORTÉE PAR LE SNAPSHOT depuis le 2026-08-28** (champ additif `brume?`,
 *      sans bump de `PROTOCOL_VERSION` — le précédent `createdAt?`). C'était le trou déclaré
 *      de cette façade : sans la nappe, `brumeColdAt` rendait une température trop CHAUDE de
 *      `BRUME.COLD_MALUS` sous une Brume, et le client pouvait MANQUER une glace que la sim
 *      avait posée (faux négatif — manquement à G5, « on ne s'engage jamais sur la glace par
 *      surprise »). La façade la relaie désormais telle quelle ; un hôte d'avant le champ
 *      n'envoie rien et on retombe sur `null` — l'ancien comportement, jamais pire.
 */
import {
  TICKS_PER_CYCLE,
  type Brume,
  type GameTime,
  type MeteoFront,
  type SimState,
  type Structure,
  type WorldMap,
} from '@ashes/sim'

/** Ce que le client possède réellement, et qui suffit aux trois fonctions du gel. */
export interface SourceDuGel {
  readonly map: WorldMap
  readonly temps: GameTime
  readonly calendarScale: number
  /** Le jour où le monde a ouvert (spec `saisons.md` S2) — sans lui, le jour de saison de la
   *  façade serait NaN et TOUT le gel disparaîtrait du rendu, en silence. */
  readonly jourDeDepart: number
  readonly structures: readonly Structure[]
  readonly meteo: MeteoFront | null
  /** LA NAPPE DE BRUME du snapshot (voir l'en-tête, point ③) — `null` hors nappe et face à
   *  un hôte d'avant le champ. */
  readonly brume: Brume | null
  /**
   * ═══ LA CENDRE, ET ELLE EST ENTRÉE PAR LE PAS (2026-08-25) ═══
   *
   * *« La cendre remplace les caractéristiques de la tuile sous-jacente. Si c'est un marais avec
   * de la cendre, pas d'offset pas de slow »* (Alexis). La vitesse d'un pas dépend donc
   * désormais de la cendre (`moveAvatar`), et `moveAvatar` est la fonction que le CLIENT rejoue
   * pour prédire son propre déplacement : ces deux champs doivent traverser, sans quoi la
   * prédiction lirait `undefined` et l'avatar caoutchouterait sur chaque tuile cendrée.
   *
   * ⚠ C'EST EXACTEMENT LE PIÈGE QUE `vent.ts` A DÉJÀ CONSIGNÉ : le type de la façade DIT
   * `SimState`, son objet ne porte qu'une poignée de champs. Une lecture non déclarée type vrai
   * et rend `undefined` au runtime, en silence. La liste ci-dessous EST le contrat.
   */
  readonly cendreAge: readonly number[]
  readonly seed: number
}

/**
 * LE DÉCALAGE DE PHASE DU CYCLE, retrouvé de l'heure publiée.
 *
 * `getGameTime` pose `cycleTick = (tick + cycleOffset) mod TICKS_PER_CYCLE` puis en tire
 * `hourOfCycle = cycleTick / T × 24 + lever`. On remonte donc la chaîne par le MÊME lever.
 *
 * ⚠ **LE LEVER VIENT DU SNAPSHOT, IL NE SE RECALCULE PAS** (2026-08-26) : il suit la saison
 * depuis que le soleil est celui de la France, et `GameTime` le PORTE justement pour ça. Le
 * redériver ici de `BALANCE.LEVER_DU_JOUR` demanderait de connaître le jour du DÉBUT du cycle
 * — que le client n'a pas — et deux lectures qui divergent d'un cheveu suffisent à décaler le
 * `cycleTick` d'un tick, donc à basculer un `isNight` sur la couture.
 *
 * Arrondi à l'entier : l'heure publiée est un flottant, et un `cycleOffset` fractionnaire
 * ferait diverger le modulo d'un tick — assez pour basculer un `isNight` sur la couture.
 */
export function cycleOffsetDepuis(tick: number, hourOfCycle: number, lever: number): number {
  const depuisLever = (((hourOfCycle - lever) % 24) + 24) % 24
  const vise = Math.round((depuisLever / 24) * TICKS_PER_CYCLE)
  return ((Math.round(vise - tick) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
}

/** Les champs que la façade porte — nommés, pour que le compilateur tienne la liste. */
interface ChampsDuGel {
  tick: number
  calendarScale: number
  jourDeDepart: number
  cycleOffset: number
  map: WorldMap
  structures: readonly Structure[]
  meteo: MeteoFront | null
  meteoActive: boolean
  brume: Brume | null
  /** L'âge de chaque foyer de cendre, et la graine du monde — voir `SourceDuGel.cendreAge`. */
  cendreAge: readonly number[]
  seed: number
}

/**
 * LA FAÇADE — allouée UNE fois par appelant et remise à jour EN PLACE (`majEtatGel`). La
 * couche l'interroge une fois par tuile visible et par recuisson : une allocation par image
 * serait du déchet pur, et le patron est celui de `plancherDeLaVallee`, qui refait le calcul
 * de `getGameTime` plutôt que d'allouer son résultat.
 */
export type EtatGel = SimState

export function creerEtatGel(src: SourceDuGel): EtatGel {
  const champs: ChampsDuGel = {
    tick: src.temps.tick,
    calendarScale: src.calendarScale,
    // ⚠ SANS LUI, `jourDeSaison` REND NaN — et `Math.floor(NaN)` ne jette pas : la glace, la
    // neige et la défeuillaison disparaîtraient du rendu sans un mot. Le cast en fin de
    // fonction désarme le compilateur, c'est donc ici que ça se garde (spec `saisons.md` S2).
    jourDeDepart: src.jourDeDepart,
    cycleOffset: cycleOffsetDepuis(src.temps.tick, src.temps.hourOfCycle, src.temps.lever),
    map: src.map,
    structures: src.structures,
    meteo: src.meteo,
    // Voir l'en-tête, points ② et ③ : le premier est exact partout où le jeu s'expédie, le
    // second arrive du snapshot depuis le 2026-08-28.
    meteoActive: true,
    brume: src.brume,
    cendreAge: src.cendreAge,
    seed: src.seed,
  }
  return champs as unknown as EtatGel
}

/** Remet la façade à jour EN PLACE, sans rien allouer. */
export function majEtatGel(cible: EtatGel, src: SourceDuGel): void {
  const e = cible as unknown as ChampsDuGel
  e.tick = src.temps.tick
  e.calendarScale = src.calendarScale
  e.jourDeDepart = src.jourDeDepart
  e.cycleOffset = cycleOffsetDepuis(src.temps.tick, src.temps.hourOfCycle, src.temps.lever)
  e.map = src.map
  e.structures = src.structures
  e.meteo = src.meteo
  e.brume = src.brume
  e.cendreAge = src.cendreAge
  e.seed = src.seed
}
