/**
 * ═══ LE COUVRE-FEU DE L'AUBE — les lucioles rentrent AVANT le jour (2026-08-27) ═══
 *
 * *« fais en sorte que les lucioles disparaissent 1h avant le lever du soleil »* (Alexis).
 *
 * LE DÉFAUT. Un essaim ne connaissait que l'OBSCURITÉ (`1 − daylight`), et la courbe de jour
 * ne repasse sous le seuil de nuit (`FIREFLY_NIGHT_THRESHOLD` = 0,45) qu'à **7 h 27 du cadran
 * canonique** — or `heureSolaire` pose le LEVER réel à 6 h de ce même cadran. Les lucioles
 * survivaient donc au soleil d'environ une heure et demie, toutes saisons confondues, et à
 * l'heure qu'Alexis vise (T−1 h) elles étaient encore à PLEINE force : l'obscurité y vaut 0,96
 * à l'équinoxe, 1,00 à l'Ardeur, 0,94 au Grand Froid. Le couvre-feu porte donc dans les quatre
 * saisons — ce n'est pas un raffinement de bord.
 *
 * POURQUOI L'HORLOGE MURALE ET NON LE CADRAN SOLAIRE. « Une heure » est une heure RÉELLE du
 * monde ; le cadran canonique de `lighting.ts` dilate la nuit avec la saison (une heure de
 * nuit d'hiver y compte pour 0,57 heure de cadran) — mesurer le couvre-feu là-bas, c'est
 * promettre une durée et en tenir une autre. On lit donc `hourOfCycle` et `lever`, tous deux
 * portés par le snapshot : les mêmes que la sim, au tick. C'est aussi pourquoi cette loi ne
 * vit PAS dans `lighting.ts`, dont tout prend la marque `HeureSolaire` sous la doctrine « une
 * seule horloge » — une seconde fonction d'heure, d'un autre type, dans ce fichier-là, serait
 * exactement la confusion que la doctrine interdit.
 *
 * LA FORME — un seul bord en pente, et il est à l'aube. Rendu dans [0, 1], à multiplier par la
 * rampe d'obscurité (elle commande le NOMBRE d'essaims comme leur lueur, d'un seul tenant) :
 *   · plein pendant la nuit, jusqu'à `LUCIOLES_EXTINCTION_H + LUCIOLES_DECLIN_H` avant le lever ;
 *   · il DÉCLINE ensuite en pente continue et vaut **zéro une heure pleine avant le lever** ;
 *   · il reste zéro toute la matinée et ne se rouvre qu'à `LUCIOLES_REOUVERTURE_H`.
 *
 * ⚠ **LA RÉOUVERTURE EST UNE MARCHE, ET C'EST VOULU.** Sans elle, « une heure avant le lever »
 * se lit `24 − u` et redevient vrai juste APRÈS le lever : les essaims éteints à T−1 h
 * rallumeraient à T+0 (l'obscurité y vaut encore 0,85) — le défaut exact qu'on corrige. La
 * marche tombe à 4 h après le lever, et elle est MULTIPLIÉE PAR UN ZÉRO : la courbe de jour y
 * vaut 1,00 / 0,96 / 1,00 aux trois cardinaux, donc la rampe d'obscurité y est nulle. Le
 * choix de 4 h n'est pas rond, il est ENCADRÉ : l'obscurité ne retombe sous le seuil qu'à
 * u = 1,57 au plus tard (Ardeur) et ne remonte au-dessus qu'à u = 6,93 au plus tôt (Grand
 * Froid) — 4 h laisse 2,4 h de marge d'un côté et 2,9 h de l'autre. Affirmé par balayage sur
 * les quatre cardinaux dans `couvre-feu-lucioles.test.ts`, sur la COMPOSITION (obscurité ×
 * couvre-feu) et non sur cette fonction seule : c'est le produit qui porte la promesse.
 *
 * ⚠ **CE N'EST PAS LE FONDU DE SORTIE.** `FONDU_SORTIE_S` (1,4 s) est la mort d'UN essaim
 * condamné ; ceci est l'heure à laquelle la nuit cesse d'en vouloir. Les deux se composent, et
 * dans le bon sens : `Math.round(MAX_SWARMS × part)` tombe à zéro dès que la part passe sous
 * 1/6, soit ~12 s réelles avant l'échéance — le dernier fondu est donc fini AVANT T−1 h, sans
 * qu'on ait à le compenser.
 */

/** Zéro à cette distance du lever (heures murales). **Le nombre qu'Alexis a demandé.** */
export const LUCIOLES_EXTINCTION_H = 1
/** Et le déclin s'étale sur l'heure qui précède — 75 s réelles (un cycle = 30 min pour 24 h),
 *  soit ~25 s entre deux essaims qui s'éteignent. **Le mettre à 0 rend une coupure sèche à
 *  T−1 h**, sans autre changement : c'est le bouton si l'extinction doit être un événement. */
export const LUCIOLES_DECLIN_H = 1
/** Le couvre-feu ne se lève qu'à cette heure APRÈS le lever — en plein jour, donc sur un zéro
 *  (voir l'en-tête : la marge encadrée est de 2,4 h / 2,9 h). */
export const LUCIOLES_REOUVERTURE_H = 4

/**
 * La part de nuit que l'HEURE accorde aux lucioles, dans [0, 1].
 *
 * @param hourOfCycle heure murale du cycle (`GameTime.hourOfCycle`), dans [0, 24).
 * @param lever       heure murale du lever de ce cycle (`GameTime.lever`) — saisonnière.
 */
export function partDeNuitDesLucioles(hourOfCycle: number, lever: number): number {
  // Heures écoulées depuis le lever : la coordonnée où le cycle commence à 0.
  const u = (((hourOfCycle - lever) % 24) + 24) % 24
  if (u < LUCIOLES_REOUVERTURE_H) return 0
  const avantLever = 24 - u
  if (avantLever <= LUCIOLES_EXTINCTION_H) return 0
  if (LUCIOLES_DECLIN_H <= 0) return 1 // déclin nul = coupure sèche, et pas de division par zéro
  const t = (avantLever - LUCIOLES_EXTINCTION_H) / LUCIOLES_DECLIN_H
  return t > 1 ? 1 : t
}
