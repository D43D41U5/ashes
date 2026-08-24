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
 *   ③ `brume` — **ABSENT, ET C'EST UN TROU QU'IL FAUT DIRE.** `SnapshotMessage` ne porte pas
 *      la nappe. `brumeColdAt` vaut `BRUME.COLD_MALUS` sous une Brume : sans elle, la
 *      température que le client relit est **trop CHAUDE de ce malus, et seulement sous la
 *      nappe**. Conséquence exacte, dans ce sens et pas l'autre :
 *
 *        · le client peut MANQUER une glace que la sim a posée sous une Brume (faux négatif) ;
 *        · il n'en INVENTE jamais une qui n'existe pas (faux positif impossible).
 *
 *      C'est un manquement à G5 (« on ne s'engage jamais sur la glace par surprise ») dans ce
 *      cas précis. Le remède est UN CHAMP ADDITIF dans `SnapshotMessage` (`brume`), qui
 *      n'incrémenterait même pas `PROTOCOL_VERSION` (le précédent `createdAt?` est écrit dans
 *      `protocol.ts`) — mais c'est `/sim` qu'il faudrait toucher : décision d'Alexis.
 */
import {
  TICKS_PER_CYCLE,
  cycleOffsetForStartHour,
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
}

/**
 * LE DÉCALAGE DE PHASE DU CYCLE, retrouvé de l'heure publiée.
 *
 * `getGameTime` pose `cycleTick = (tick + cycleOffset) mod TICKS_PER_CYCLE` puis en tire
 * `hourOfCycle` ; `cycleOffsetForStartHour(h)` rend le `cycleTick` de l'heure `h`. On
 * remonte donc la chaîne avec la fonction de la sim, sans réécrire la conversion.
 *
 * Arrondi à l'entier : l'heure publiée est un flottant, et un `cycleOffset` fractionnaire
 * ferait diverger le modulo d'un tick — assez pour basculer un `isNight` sur la couture.
 */
export function cycleOffsetDepuis(tick: number, hourOfCycle: number): number {
  const vise = cycleOffsetForStartHour(hourOfCycle)
  return ((Math.round(vise - tick) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
}

/** Les SEPT champs que la façade porte — nommés, pour que le compilateur tienne la liste. */
interface ChampsDuGel {
  tick: number
  calendarScale: number
  jourDeDepart: number
  cycleOffset: number
  map: WorldMap
  structures: readonly Structure[]
  meteo: MeteoFront | null
  meteoActive: boolean
  brume: null
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
    cycleOffset: cycleOffsetDepuis(src.temps.tick, src.temps.hourOfCycle),
    map: src.map,
    structures: src.structures,
    meteo: src.meteo,
    // Voir l'en-tête, points ② et ③ : l'un est exact partout où le jeu s'expédie, l'autre
    // est un trou nommé.
    meteoActive: true,
    brume: null,
  }
  return champs as unknown as EtatGel
}

/** Remet la façade à jour EN PLACE, sans rien allouer. */
export function majEtatGel(cible: EtatGel, src: SourceDuGel): void {
  const e = cible as unknown as ChampsDuGel
  e.tick = src.temps.tick
  e.calendarScale = src.calendarScale
  e.jourDeDepart = src.jourDeDepart
  e.cycleOffset = cycleOffsetDepuis(src.temps.tick, src.temps.hourOfCycle)
  e.map = src.map
  e.structures = src.structures
  e.meteo = src.meteo
}
