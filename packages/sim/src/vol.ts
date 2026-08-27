/**
 * L'ENVOL — la lecture de l'état « en l'air » (spec faune R21).
 *
 * Deux fonctions, et un module entier pour elles. LA RAISON EST UN CYCLE : la
 * règle « en vol, seul le trait atteint » se lit dans `combat.ts` (l'élection des
 * cibles), l'envol s'écrit dans `faune.ts` — or `faune` importe déjà `combat`
 * (`applyDamage`, `die`, `startAttack`). Faire importer `faune` par `combat`
 * aurait bouclé au RUNTIME, et ce dépôt s'est déjà fait mordre par une zone morte
 * temporelle que `tsc` ne signalait pas (voir la note de `SLOTS` dans
 * `balance.ts`). Une FEUILLE — elle n'importe que `balance` et un type — ne peut
 * pas boucler.
 *
 * Et l'autre raison est la bonne : cet état se lit à TROIS endroits (le combat,
 * le rendu, les sondes headless). Un état lu à trois endroits mérite un nom, ou
 * les trois divergent au premier réglage.
 *
 * Déterminisme : `+ - * /` et des comparaisons. Rien d'autre (invariant §2).
 */
import { FAUNA } from './balance'
import type { Monster } from './monsters'

/**
 * EST-ELLE EN L'AIR ? La seule lecture qui fasse foi.
 *
 * Le drapeau porte SA PROPRE FIN (`volUntil` est un tick, pas un booléen) : rien
 * à purger si le pas de la bête ne tourne pas ce tick-là — un monstre gelé, un
 * hôte qui saute une passe, un snapshot rejoué plus tard donnent tous la même
 * réponse. Un booléen aurait exigé que quelqu'un pense à l'éteindre.
 */
export function enVol(monster: Monster, tick: number): boolean {
  return monster.volUntil !== undefined && tick < monster.volUntil
}

/**
 * LA HAUTEUR du bond à cet instant, en tuiles (0 au sol, au décollage et à la
 * pose). Une parabole simple — `4h·f·(1−f)` — qui culmine à `VOL_HAUTEUR` à
 * mi-course. Que des multiplications : aucune trigonométrie, donc rejouable au
 * bit près d'un moteur à l'autre.
 *
 * ELLE VIT DANS /sim BIEN QU'ELLE NE SERVE QU'À DESSINER, et c'est la même règle
 * que `beast-posture` côté client : ce que l'écran montre doit être lisible SANS
 * écran. Une sonde headless doit pouvoir dire à quelle hauteur était l'oiseau au
 * tick du tir — sinon on juge une fenêtre de tir à l'œil, sur une capture.
 *
 * ⚠ Elle ne déplace PAS la bête : `entity.x/y` restent sa position AU SOL. C'est
 * le tri Y du rendu qui en dépend (un oiseau haut ne doit pas passer derrière ce
 * qu'il survole) et la portée du tir (on ne tire pas plus loin parce que la cible
 * est haute).
 */
export function hauteurDeVol(monster: Monster, tick: number): number {
  const until = monster.volUntil
  const depuis = monster.volDepuis
  if (until === undefined || depuis === undefined) return 0
  return hauteurDeBond((tick - depuis) / Math.max(1, until - depuis))
}

/**
 * LA PARABOLE NUE : la hauteur pour une fraction de bond dans [0, 1].
 *
 * Elle est séparée parce que LE CLIENT NE COMPTE PAS EN TICKS. Le rendu
 * interpole les positions sur l'horloge d'affichage (`interp.ts`, tampon de
 * gigue) : une hauteur recalculée à chaque snapshot monterait par MARCHES de
 * 20 Hz pendant que la position, elle, glisse — l'oiseau sauterait en montant.
 * Le client tient donc sa propre fraction, en millisecondes, et demande ici la
 * même courbe. Une seule loi, deux horloges.
 */
export function hauteurDeBond(fraction: number): number {
  if (fraction <= 0 || fraction >= 1) return 0
  return 4 * FAUNA.VOL_HAUTEUR * fraction * (1 - fraction)
}
