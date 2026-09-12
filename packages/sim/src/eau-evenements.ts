/**
 * LES ÉVÉNEMENTS D'EAU — D1 de la reprise de l'eau (décision d'Alexis, 2026-09-12 : « la vallée,
 * au jour, sans le gel »).
 *
 * ═══ CE QU'EST UN FAIT D'EAU ═══
 *
 * Une BASCULE DE VALLÉE, observée une fois par JOUR DE SAISON. MESURÉ par l'éclaireur (graine
 * 2026, monde joué, 240 jours) : l'assec et le gué fermé n'ont AUCUN terme positionnel — le niveau
 * d'eau est global, la bande morte aussi —, donc « la mare qui part » ne PEUT pas être un fait par
 * mare : c'est la vallée entière qui s'assèche, et une seule ligne de chronique le dit. Trois
 * régimes, chacun un verdict global et constant dans le jour (`eau.ts` : `eauASec`, `guesFermes`,
 * `crueGlobale > 0`), donc six faits : l'entrée et la sortie de chacun. Rares — c'est le point :
 * 4 bascules d'assec en 240 jours (la première au 158ᵉ), la crue à l'an 11 (2 + 2 bascules,
 * monotones), rien sur la saison jouée (j61 → j120).
 *
 * ═══ CE QUI N'EN EST PAS ═══
 *
 * LE GEL. Il prend la nuit et rend le jour : 246 bascules en 240 jours au relevé horaire, 4 à
 * l'aube. Un fait par nuit serait du bruit, un fait à l'aube un mensonge (98 % des prises
 * manquées). Il reste ce que `advanceDegel` (`gel.ts`) dit déjà de lui : un fait de RENDU, pas de
 * chronique — « haute fréquence n'est pas domaine ». Et `water_fouled` (par tuile, 27 par
 * 4 000 ticks sous un corps qui marche) attend son agrégation : ce n'est pas ici.
 *
 * ═══ LE CROCHET ═══
 *
 * `season_day_started`, pas le bord de cycle : le niveau est constant par jour de SAISON
 * (`ariditeGlobale` lit le jour planché, `crueGlobale` un `floor`), et un cycle ne vaut un jour
 * qu'à `calendarScale = 48` (la Veillée) — au-dessus (les bancs à 720), un cycle couvre quinze
 * jours et le bord de cycle manquerait des bascules. On relit donc au premier tick de chaque
 * jour franchi (`advanceTime` a incrémenté le tick et le jour AVANT nous), en comparant les trois
 * verdicts à ceux MÉMORISÉS dans l'état (`regimeDEau`, additif : une sauvegarde d'avant reprend
 * sans, s'initialise au jour courant et n'émet rien — un monde qui NAÎT à sec n'a pas « séché »).
 * Un tick qui franchit plusieurs jours (échelle extrême) ne relit que le jour d'arrivée : les
 * bascules aller-retour DANS l'enjambée sont perdues, et c'est dit ici, pas caché.
 */
import { crueGlobale, eauASec, guesFermes, niveauDEau } from './eau'
import { emitEvent } from './events'
import type { SimState } from './sim'
import { jourDeSaison } from './time'

/** LE RÉGIME D'EAU MÉMORISÉ — les trois verdicts de vallée au dernier jour observé. */
export interface RegimeDEau {
  /** Le jour de saison auquel ces verdicts ont été relevés. */
  jour: number
  aSec: boolean
  guesFermes: boolean
  crue: boolean
}

/** Les trois verdicts de vallée, ICI et MAINTENANT (`state.tick`) — le niveau lu une fois. */
export function regimeDEauDuJour(state: SimState): RegimeDEau {
  const niveau = niveauDEau(state)
  return {
    jour: jourDeSaison(state),
    aSec: eauASec(state, niveau),
    guesFermes: guesFermes(state, niveau),
    crue: crueGlobale(state) > 0,
  }
}

/**
 * LA PASSE — une fois par tick, après `advanceTime`. O(1) hors bascule de jour (une comparaison
 * d'entiers) ; au jour franchi, une lecture du niveau et trois comparaisons.
 */
export function advanceEau(state: SimState): void {
  const avant = state.regimeDEau
  if (avant === undefined) {
    // La naissance du monde, ou une sauvegarde d'avant D1 : on prend l'état tel qu'il est, sans
    // le raconter — la chronique dit ce qui CHANGE, pas ce qui est.
    state.regimeDEau = regimeDEauDuJour(state)
    return
  }
  const jour = jourDeSaison(state)
  if (jour === avant.jour) return
  const apres = regimeDEauDuJour(state)
  const tick = state.tick
  if (apres.aSec !== avant.aSec) emitEvent(state, { type: apres.aSec ? 'eau_a_sec' : 'eau_revenue', tick, day: jour })
  if (apres.crue !== avant.crue) emitEvent(state, { type: apres.crue ? 'crue_montee' : 'crue_retiree', tick, day: jour })
  if (apres.guesFermes !== avant.guesFermes) emitEvent(state, { type: apres.guesFermes ? 'gues_fermes' : 'gues_rouverts', tick, day: jour })
  state.regimeDEau = apres
}
