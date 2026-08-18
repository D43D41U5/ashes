/**
 * OMBRES DE CONTACT DU DÉCOR — la calibration PURE : quels props posent une flaque, et les métriques
 * de silhouette (gap du bas, largeur de l'art) qui la placent et la dimensionnent. Aucune dépendance
 * Phaser : c'est de la donnée, sœur de `clutter.ts` et `lit-props.ts`, que `ClutterLayer` consomme —
 * et qu'un test épingle en headless (un prop ombré sans gap retomberait en silence sur un fallback).
 *
 * La mécanique de rendu (texture, ellipse, alpha) vit dans `scenes/world/contact-shadow.ts`.
 */
import type { PropKind } from './clutter'

/** Props VOLUMIQUES qui POSENT au sol → ils portent l'ombre de contact des acteurs et des nœuds
 *  (« ce qui se dresse se pose »). Le noyau historique (buisson, buisson bas, gros bloc) s'est
 *  ÉLARGI le 2026-07-25 aux props DEBOUT retravaillés en cubique la veille et qui, faute d'ombre,
 *  FLOTTAIENT : petits pin/mélèze, gros tronc, tronc calciné, congère, ET la fleur (elle a depuis
 *  le 2026-07-24 une VRAIE tête cubique, plus un brin — choix d'Alexis de l'ancrer comme un objet).
 *  Restent DÉLIBÉRÉMENT sans ombre : les brins wispy et innombrables (touffe d'herbe, roseau —
 *  illisibles et coûteux) et les FLAT_PROPS (ils SONT le sol). NB : `conifer`/`stump` ont bien une
 *  texture mais ne sont posés dans AUCUN biome (la Racine est faite de vrais nœuds) → hors liste,
 *  et le test épingle que tout membre d'ici est réellement placé. */
export const SHADOW_PROPS = new Set<PropKind>([
  'bush', 'low_bush', 'boulder', 'big_trunk', 'pine', 'larch', 'burnt_trunk', 'snowdrift', 'flower',
  // Les buttes d'affleurement (§2sexies) : la dalle est un banc qui POSE, le chicot se dresse.
  // La poussière, elle, EST le sol (FLAT_PROPS) — jamais de flaque.
  'dalle_fer', 'dalle_charbon', 'chicot',
])

/** GAP DU BAS DE L'ART, en TEXELS (mesuré sur la silhouette) — de combien elle s'arrête au-dessus
 *  du bord bas de la tuile. L'ombre (grand diamètre) se pose sur ce PIXEL LE PLUS BAS.
 *  ⚠ Le buisson dodu (`bush`) est le SEUL prop dont la silhouette `_lit` DIFFÈRE de son art peint :
 *  peint c'est un dôme rond qui remplit la tuile (bas rangée 15 → gap 0) ; `_lit` c'est un albédo
 *  RECTANGULAIRE aplati (bas rangée 13 → gap 2). Comme l'éclairage est le rendu par défaut, c'est
 *  le `_lit` qu'on voit — d'où l'ombre 2 px TROP BAS quand on prenait le gap du peint (vu par Alexis).
 *  On lit donc le gap de la variante EFFECTIVEMENT rendue (`useLit`, cf. `SHADOW_PROP_GAP_LIT`). Les
 *  DEBOUT ajoutés le 2026-07-25 ont leur silhouette `_lit` == peinte (lit-props rejoue la MÊME donnée
 *  que BootScene) → aucun n'a besoin d'une surcharge `_lit`. */
export const SHADOW_PROP_GAP: Record<string, number> = {
  bush: 0, boulder: 1, low_bush: 2,
  big_trunk: 1, pine: 3, larch: 4, burnt_trunk: 2, snowdrift: 0, flower: 2,
  // Mesurés sur les RECTS partagés (lit-props) : assises en rangée 13 (dalles, /16) et 29 (chicot, /32).
  dalle_fer: 2, dalle_charbon: 2, chicot: 2,
}

/** Surcharges de gap quand la variante `_lit` est rendue (silhouette ≠ art peint). Seul le
 *  buisson dodu diffère ; les autres tombent sur `SHADOW_PROP_GAP`. */
export const SHADOW_PROP_GAP_LIT: Record<string, number> = { bush: 2 }

/** LARGEUR DE L'ART, en TEXELS (span le plus large de la silhouette, sur les 16 de la tuile) — pour
 *  les props DEBOUT qui NE remplissent PAS leur texture. L'ombre se dimensionne sur cette emprise
 *  RÉELLE (× l'échelle du sprite), pas sur `displayWidth` (la tuile pleine) : sans ça un tronc
 *  calciné de 2 texels ou une fleur de 6 porterait une flaque ~3× trop large (le bug « lapin » des
 *  ombres — cf. `contact-shadow.ts`, `MIN_WIDTH`, qui redonne un plancher de 8 px aux plus minces :
 *  une petite flaque d'ancrage, pas un pâté). Les props qui REMPLISSENT leur tuile (buisson, buisson
 *  bas, gros bloc) sont ABSENTS ici : ils gardent la largeur `displayWidth` déjà calibrée. */
export const SHADOW_PROP_WIDTH: Record<string, number> = {
  big_trunk: 10, // le houppier (disc r5) — l'ombre d'un petit arbre épouse sa cime, comme les nœuds-arbres
  pine: 8, larch: 6, // la base du triangle, posée au sol
  burnt_trunk: 2, // un bâton (le plancher de 8 px prendra le relais)
  snowdrift: 8, flower: 6, // le dôme / la corolle (min 8 px domine aussi : ancrage discret)
  chicot: 8, // l'assise de l'aiguille (rects partagés) — sans lui, la flaque prendrait la tuile entière
}
