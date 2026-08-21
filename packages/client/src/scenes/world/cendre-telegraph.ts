/**
 * LE TÉLÉGRAPHE DE LA CENDRE (GDD §536 — la méga-horde « télégraphiée des jours à l'avance »).
 *
 * Le couplage cycle↔calendrier (V0-9) a rendu l'acte III OBSERVABLE en Veillée ; on peut donc
 * enfin l'ANNONCER. La Cendre (la méga-horde de l'acte III) tombe au premier crépuscule de
 * l'acte III — un fait DÉTERMINISTE du calendrier, pas un tirage. On le prévient en JOURS,
 * comme le veut le GDD, sans toucher au flux RNG : ce résolveur PUR transforme un jour de
 * saison en la ligne d'alerte à dire, ou `null`. Le client l'appelle sur `season_day_started`
 * (qui ne repasse jamais un jour) — chaque jour-clé n'est donc dit qu'une fois.
 *
 * Canal ROUGE (l'alerte, comme la nuit qui tombe ou le hurlement) : la Cendre est LE danger,
 * pas une leçon — sa place n'est pas le canal conseil (neutre), c'est l'alarme.
 */
import { BALANCE, YEAR_DAYS } from '@ashes/sim'

/** Le premier jour de l'acte III DANS L'ANNÉE — le jour où la Cendre déferle (borne GDD §2). */
const CENDRE_DAY = 2 * BALANCE.ACT_DAYS + 1 // 43 — inchangé pour l'an 1

/**
 * La ligne de télégraphe pour un jour de saison donné, ou `null` s'il n'y a rien à dire.
 *
 * ANNUEL depuis que l'année tourne (saison-sans-fin T2/T3) : le front mord chaque hiver, le
 * télégraphe prévient chaque hiver — sur le jour DANS L'ANNÉE, l'an 1 inchangé. Et il ne
 * promet plus ni « la fin » (il n'y en a plus — l'arc oscille) ni « la méga-horde » (morte,
 * pression-croissante ⑲) : un préavis qui ment n'est plus un préavis.
 */
export function cendreTelegraphForDay(day: number): string | null {
  const jourDansLAnnee = ((Math.max(1, Math.floor(day)) - 1) % YEAR_DAYS) + 1
  const tour = Math.floor((Math.max(1, Math.floor(day)) - 1) / YEAR_DAYS) + 1
  // Trois jours avant : la rumeur au loin. Le joueur a le temps d'agir (stocker du bois,
  // monter les murs) — c'est TOUT l'intérêt d'un préavis.
  if (jourDansLAnnee === CENDRE_DAY - 3) {
    return tour === 1
      ? 'La Cendre monte à l’horizon. L’acte III approche.'
      : 'La Cendre monte à l’horizon. L’hiver revient, et elle mordra encore.'
  }
  // La veille : l'urgence. Le Feu nourri est la parade de la nuit — les Cendreux y viennent.
  if (jourDansLAnnee === CENDRE_DAY - 1) return 'La Cendre déferle demain. Nourrissez le Feu.'
  return null
}
