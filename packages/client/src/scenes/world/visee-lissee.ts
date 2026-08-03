/**
 * LE SUIVI DE LA VISÉE — pur, zéro Phaser, donc prouvé par des tests.
 *
 * ═══ CE QUE LA LIGNE DE TIR FAISAIT, ET POURQUOI ÇA SE VOYAIT ═══
 *
 * Le télégraphe de l'arc (`attack-fx.charge`) est peint depuis la direction que porte le
 * SNAPSHOT — et cette direction ne bouge que quand la sim la rafraîchit : la re-visée est
 * cadencée à 100 ms (`CHARGE_AIM_MS`) et les snapshots arrivent à 20 Hz. À soixante images
 * par seconde, la ligne restait donc IDENTIQUE six frames d'affilée puis sautait d'un bloc.
 * Sur une aiguille de seize tuiles et demie, un pas de 5° déplace le marqueur du point de
 * chute d'une tuile et demie : ça ne lit pas comme une visée, ça lit comme un stroboscope.
 *
 * ═══ CE QU'ON SUIT, ET POURQUOI CE N'EST PAS UNE TRICHE ═══
 *
 * Pour MA visée, la cible du lissage est le CURSEUR, pas l'écho du snapshot — parce que
 * c'est le curseur que le tir résoudra : `attack_release` emporte `dx/dy` (input-bindings)
 * et la sim tire avec CETTE direction-là (`combat.ts`, « len < 0.0001 ? charge.dx :
 * action.dx »). Le contrat que `charge()` s'est donné — *« la zone qui partirait SI ON
 * RELÂCHAIT MAINTENANT »* — désigne donc le curseur ; l'écho du snapshot en est une version
 * vieille de 100 à 150 ms. Lisser vers le curseur ne fait pas mentir le télégraphe : ça le
 * remet en face de ce qu'il promet. (Pour les AUTRES corps, il n'y a pas de curseur : la
 * cible reste le snapshot, et le lissage n'y efface que l'escalier des 10 Hz.)
 *
 * ⚠ ET SEULEMENT PENDANT LA BANDE. Le télégraphe d'ARMEMENT (`telegraph`, le wind-up) n'est
 * jamais lissé : là, la direction est VERROUILLÉE par la sim et le cône dessiné est
 * exactement celui qui frappera (critère A2 de `tir.md`). Lisser une direction déjà arrêtée
 * ferait dessiner à côté du coup — le seul défaut qu'un télégraphe n'a pas le droit d'avoir.
 *
 * ═══ « RÉACTIF » : LE TAUX SUIT L'ÉCART ═══
 *
 * Un lissage à constante fixe force un choix qu'on ne veut pas faire : assez mou pour poser
 * la ligne, et un demi-tour de curseur traîne un quart de seconde ; assez vif pour le
 * demi-tour, et l'escalier repasse à travers. On fait donc dépendre le taux de l'ÉCART
 * ANGULAIRE lui-même — continûment, sans palier ni seuil (même loi que la cadence des
 * éclats, `bande.ts`) : une correction au degré près GLISSE, un revirement CLAQUE.
 *
 * Les deux bornes sont exactes : `SUIVI_POSE` à écart nul, `SUIVI_VIF` au demi-tour.
 */

/**
 * Le taux de suivi quand la ligne est DÉJÀ sur sa cible (s⁻¹) — le temps caractéristique
 * vaut son inverse, 62 ms ici. C'est ce qui donne son POIDS à la visée : l'arc pèse dans
 * les mains, la ligne n'est pas soudée au curseur.
 */
export const SUIVI_POSE = 16
/**
 * …et le taux au DEMI-TOUR (s⁻¹) : 18 ms de temps caractéristique, presque un claquement.
 * Un joueur qui balaie l'écran d'un revers ne doit pas attendre sa ligne.
 */
export const SUIVI_VIF = 55
/**
 * LE PAS DE TEMPS EST BORNÉ (ms) — même précaution que la gerbe de récolte et la terre du
 * réveil, et pour la même raison : l'horloge d'une frame lente saute (le rendu logiciel du
 * banc tourne à quelques images par seconde). Sans borne, `1 − exp(−k·dt)` vaut 1 à la
 * moindre saccade : le lissage disparaîtrait exactement là où on cherche à le vérifier, et
 * la ligne reprendrait son escalier au pire moment — quand le jeu rame.
 */
export const DT_SUIVI_MAX_MS = 50

const DEUX_PI = Math.PI * 2

/**
 * L'ÉCART ORIENTÉ de `courant` vers `cible`, ramené dans (−π, π] — donc TOUJOURS par le
 * chemin court. Sans ce repliement, viser à l'ouest depuis l'est ferait faire à la ligne
 * un tour complet par le sud : le télégraphe balaierait tout l'écran pour rejoindre un
 * point situé juste de l'autre côté du corps.
 *
 * C'est aussi pourquoi on lisse un ANGLE et non le vecteur : interpoler (dx, dy) composante
 * par composante fait passer la ligne par la LONGUEUR NULLE au demi-tour — un télégraphe
 * qui s'évanouit une frame pile quand le joueur retourne sa visée.
 */
export function ecartAngulaire(courant: number, cible: number): number {
  let e = (cible - courant) % DEUX_PI
  if (e > Math.PI) e -= DEUX_PI
  if (e <= -Math.PI) e += DEUX_PI
  return e
}

/**
 * LE TAUX DE SUIVI (s⁻¹) pour un écart donné (radians, signe indifférent) : linéaire entre
 * les deux bornes, strictement croissant, exact aux deux bouts. Au-delà du demi-tour il ne
 * monte plus — un écart de plus de π n'existe pas, `ecartAngulaire` l'a déjà replié.
 */
export function tauxDeSuivi(ecart: number): number {
  const e = Math.min(Math.PI, Math.abs(ecart))
  return SUIVI_POSE + (SUIVI_VIF - SUIVI_POSE) * (e / Math.PI)
}

/**
 * L'ANGLE DE LA LIGNE À LA FRAME SUIVANTE : on comble une FRACTION de l'écart, et cette
 * fraction se dérive du pas de temps (`1 − exp(−k·dt)`) — pas de la frame. Deux machines à
 * 30 et 120 images par seconde voient donc la même visée arriver au même moment ; à
 * fraction fixe, la ligne serait quatre fois plus molle sur la machine lente.
 *
 * Ne DÉPASSE jamais : la fraction est dans [0, 1[, donc la ligne approche sa cible sans
 * jamais la franchir. Un télégraphe qui oscille autour de sa direction mentirait deux fois
 * par oscillation, et il le ferait exactement quand le joueur corrige son tir.
 */
export function suivreAngle(courant: number, cible: number, dtMs: number): number {
  const ecart = ecartAngulaire(courant, cible)
  const dt = Math.max(0, Math.min(DT_SUIVI_MAX_MS, dtMs)) / 1000
  const part = 1 - Math.exp(-tauxDeSuivi(ecart) * dt)
  return courant + ecart * part
}
