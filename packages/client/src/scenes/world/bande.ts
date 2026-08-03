/**
 * LA CADENCE DE LA BANDE — pure, zéro Phaser, donc prouvée par des tests.
 *
 * ═══ POURQUOI CETTE LOI EXISTE (demande d'Alexis, 2026-08-02) ═══
 *
 * À maturité, une hache devient un TOURBILLON et un poing devient un DISQUE : le
 * basculement de FORME est le « c'est prêt », et il se lit sans jauge. L'arc, lui, garde
 * un cône — il se resserre et s'allonge, ce qui ne saute pas aux yeux. Sans signal propre,
 * on ne sait jamais quand la corde est pleine : on décoche au hasard, ou l'on attend trop.
 *
 * Le signal est donc TEMPOREL, et il l'est SUR TOUTE LA COURSE, sans palier : la période
 * des éclats blancs descend continûment à mesure que la bande mûrit. On n'apprend pas un
 * seuil, on entend une cadence accélérer — et l'on sait où l'on en est sans quitter la
 * bête des yeux. Quand la corde est pleine, les éclats CESSENT et laissent une garde
 * posée : le signal change de NATURE, pas d'intensité (voir `attack-fx.charge`).
 *
 * ═══ POURQUOI CE FICHIER, ET PAS `attack-fx.ts` ═══
 *
 * Deux raisons, et la seconde est la vraie :
 *   1. `attack-fx.ts` importe Phaser au chargement — rien n'y est testable en Node ;
 *   2. mesurer une cadence AU NAVIGATEUR demande de figer la boucle et de l'avancer image
 *      par image, or chaque image y coûte un rendu logiciel entier. MESURÉ : la bande
 *      passait de 0,44 à pleine ENTRE deux relevés, donc le banc ne voyait jamais la
 *      montée — il aurait dit « ça flashe, puis ça ne flashe plus ».
 * La PENTE se prouve donc ici ; le smoke, lui, constate ce qu'il sait bien voir : que les
 * éclats existent pendant la bande, et qu'ils cessent quand elle est pleine.
 */

/** Un éclat toutes les 420 ms quand la corde part — lent, presque nonchalant. */
export const ECLAT_LENT = 420
/** …et toutes les 110 ms juste avant la pleine bande : quatre fois plus vite. */
export const ECLAT_VIF = 110
/** La part de sa période qu'occupe l'éclat lui-même : bref et sec, jamais un clignotant. */
export const ECLAT_PART = 0.42

/**
 * La période des éclats, en ms, pour une bande de maturité `ratio` (0 = corde molle,
 * 1 = pleine). Bornée aux deux bouts : une corde n'est jamais « plus que pleine ».
 */
export function periodeEclat(ratio: number): number {
  const r = Math.max(0, Math.min(1, ratio))
  return ECLAT_LENT + (ECLAT_VIF - ECLAT_LENT) * r
}

/**
 * L'INTENSITÉ de l'éclat à l'instant `now`, de 0 à 1 : attaque sèche puis extinction.
 * C'est un profil de percussion — l'œil doit lire un CLAQUEMENT, pas une respiration
 * (celle-là est réservée à la bande pleine, et c'est ce qui les distingue).
 */
export function eclatAt(now: number, ratio: number): number {
  const periode = periodeEclat(ratio)
  const phase = (now % periode) / periode
  return phase < ECLAT_PART ? 1 - phase / ECLAT_PART : 0
}
