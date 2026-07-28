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
import { BALANCE } from '@ashes/sim'

/** Le premier jour de l'acte III — le jour où la Cendre déferle (borne GDD §2). */
const CENDRE_DAY = BALANCE.ACT_BOUNDARIES[1] + 1

/** La ligne de télégraphe pour un jour de saison donné, ou `null` s'il n'y a rien à dire. */
export function cendreTelegraphForDay(day: number): string | null {
  // Trois jours avant : la rumeur au loin. Le joueur a le temps d'agir (stocker du bois,
  // monter les murs) — c'est TOUT l'intérêt d'un préavis.
  if (day === CENDRE_DAY - 3) return 'La Cendre monte à l’horizon. L’acte III — la fin — approche.'
  // La veille : l'urgence. Le Feu nourri est la seule parade à la méga-horde (V1-11/12).
  if (day === CENDRE_DAY - 1) return 'La Cendre déferle demain. Nourrissez le Feu : lui seul tient la méga-horde.'
  return null
}
