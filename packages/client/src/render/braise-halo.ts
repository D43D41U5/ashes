/**
 * ═══ LE HALO DE LA BRAISE — les COURBES, pures et testées (spec `braise.md` B-R13c, B-A18) ═══
 *
 * Le pendant de `render/torche.ts` : ici les nombres, ailleurs le rendu. Avec UNE différence qui
 * commande tout le fichier, et qu'il faut dire avant les courbes :
 *
 * ⚠ **LA TORCHE EST UN FAIT DE RENDU, LA BRAISE EST UN FAIT DE SIM.** `render/torche.ts` s'ouvre
 * sur *« la sim ne sait RIEN de tout ça »* — et c'est vrai d'elle : sa lumière est libre, le
 * rendu invente sa courbe. La braise, non : son profil vit dans `/sim` (`bulleDeBraise`), parce
 * que de sa clarté dépend **la parade** (B-R13c ⓒ : sous `NUIT.SEUIL_NOIR`, on ne pare pas ce
 * qu'on ne voit pas). Ce module n'a donc PAS le droit d'inventer une seconde courbe : il
 * **dérive** la sienne de celle de l'autorité, et c'est tout l'objet de `rayonDeBraise` exporté
 * par `@ashes/sim`.
 *
 * ⚠ **CE QUE ÇA DONNE EXACTEMENT, ET CE QUE ÇA NE DONNE PAS.** Le **SUPPORT** de N2bis
 * (*« l'écran n'est jamais plus clair que la sim »*, `nuit-noire.md`, LG-R13) est vrai **par
 * construction** : tout rayon d'écran d'ici est `rayonDeBraise(…) × un facteur ≤ 1`, donc l'écran
 * n'éclaire jamais plus loin que l'autorité, à tout niveau d'arbre et à toute charge. **L'AMPLITUDE,
 * ELLE, NE L'EST PAS** — c'est à chaque couche de faire suivre sa profondeur ou son alpha à la
 * charge (voir `forceDuTrouDeBraise`, écrite APRÈS avoir livré un trou de profondeur constante
 * qui mentait à un palier de charge). Et la **lisibilité** ne se déduit d'aucune des deux : elle
 * se mesure à l'image.
 *
 * ═══ POURQUOI PAS LA RACINE DE LA TORCHE (et c'est une conséquence, pas un goût) ═══
 *
 * `torcheHoleRadius` prend `Math.sqrt(agonie)` pour une raison juste : *« un disque perd sa
 * surface au carré de son rayon, donc une portée qui suivrait l'agonie linéairement se
 * refermerait deux fois trop vite à l'œil »*. ⚠ **Cette correction est INTERDITE ici**, et pas
 * par prudence : `√f > f` pour tout `f` dans ]0, 1[, donc un rayon d'écran en racine
 * **DÉPASSERAIT** le rayon de la sim à toute charge partielle — exactement le sens que N2bis
 * interdit. La torche peut s'offrir la racine parce que son rayon n'a pas d'autorité au-dessus
 * de lui ; la braise en a une.
 *
 * ═══ LE RAYON SE QUANTIFIE, L'ALPHA RESPIRE — une loi, quatre lecteurs ═══
 *
 * La mémoire du projet et l'en-tête de `fire-ground-glow` disent la même chose : *« faire
 * respirer le vacillement par l'ALPHA, pas la taille, sinon les carrés grouillent »* — un disque
 * de lumière pixellisé qui se RÉÉCHELONNE recompose ses texels d'une image à l'autre. Or le
 * rayon de la braise, lui, DOIT bouger : il est le second canal de la charge (B-A18 ②), et la
 * flaque est la seule couche qui le cuit (`CLAUDE.md`).
 *
 * D'où `partQuantifiee` : la charge ne commande la TAILLE que par paliers de `1 / QUANTA`, et
 * toujours par `floor` — donc le rééchelonnement n'arrive qu'aux `QUANTA` frontières d'une
 * décharge entière, au lieu de chaque image. La charge continue, elle, passe dans la FORCE
 * (alpha, intensité) : le halo faiblit sans à-coup, et seule son emprise descend par marches.
 *
 * ⚠ **ET ELLE N'APPARTIENT QU'À LA FLAQUE — c'est relevé dans le code, pas supposé.** On a cru
 * devoir quantifier les quatre couches ; `night-veil.ts` dit le contraire en toutes lettres :
 * *« Portée en px de texture (= px écran). Elle PULSE : `radiusTiles` bat avec la flamme »* — la
 * brosse du voile est **déjà** rééchelonnée à chaque image par le zoom, et le rayon d'un Feu y
 * bat en continu sans artefact. Même chose pour le `percer` de la cave, et un point light n'a
 * aucune grille de pixels. Quantifier le voile n'y gagnait donc **rien** et coûtait **huit
 * à-coups visibles sur la couche qui éclaire le plus le sol**. Seule la flaque a un grain à
 * préserver, parce que c'est la seule qui soit une texture PIXELLISÉE à échelle fixe : la
 * quantification vit dans `cellulesDeFlaque`, et nulle part ailleurs.
 *
 * ⚠ Les paliers tombent sur des cellules ENTIÈRES de `LIGHT_PX` et ce n'est pas un hasard :
 * `RAYON_BASE × TILE_PX / LIGHT_PX = 16` cellules, divisible par `QUANTA` — la garde B-A18 ⑩
 * l'affirme, pour qu'un futur `RAYON_BASE` impair ne vienne pas poser un texel à moitié.
 *
 * ═══ ELLE NE VACILLE PAS, ELLE RESPIRE ═══
 *
 * Une torche crépite : `forceDeTorche` prend `flicker` à pleine amplitude. Une braise est une
 * masse incandescente sans flamme — elle pulse lentement. On garde donc la MÊME `flicker` (une
 * seconde onde qui divergerait n'aurait aucun sens dans une scène où les deux se croisent) mais
 * **amortie vers 1** (`BATTEMENT`), le patron exact de la canopée des Feux dans
 * `dynamic-lighting` (*« le battement moins sa moyenne, ×0,55 »*).
 */
import { type Braise, bulleDeBraise, chargePleine, fractionDeCharge, rayonDeBraise } from '@ashes/sim'
import { flicker } from './lighting'
import { TILE_PX } from './framing'
import { TORCHE_HOLE_FORCE } from './torche'

/**
 * EN COMBIEN DE PALIERS la charge commande la TAILLE du halo (voir l'en-tête).
 *
 * Huit : assez pour que l'emprise se voie fondre sur une décharge (un palier perdu tous les
 * 12,5 % de charge), assez peu pour que le rééchelonnement reste un événement rare. Et 16 (les
 * cellules de `LIGHT_PX` d'un rayon plein) est divisible par 8 : chaque palier retire DEUX
 * cellules pleines, jamais une moitié.
 */
export const QUANTA = 8

/**
 * LE TROU DANS LE VOILE DE NUIT, en part du rayon de la sim.
 *
 * ⚠ **STRICTEMENT SOUS 1, et c'est structurel** : c'est la marge que la torche tient par ses
 * nombres (trou 4 tuiles contre une portée de sim de 10, soit 0,4) et que la braise doit tenir
 * par un ratio, son rayon d'écran étant dérivé du même nombre que celui de la sim. Sans elle le
 * bord du trou touche le bord du profil, là où la clarté de la sim vaut déjà 0 : l'écran
 * montrerait une lueur que l'autorité ne donne pas.
 */
export const TROU_RATIO = 0.75
/**
 * ═══ UNE BRAISE PLEINE EST UNE TORCHE, ET LA PORTÉE SEULE LES SÉPARE ═══
 *
 * ⚠ **J'AI ÉCRIT DEUX FOIS FAUX ICI LE MÊME JOUR, ET LES DEUX FOIS DANS UN PLAFOND À MOI.**
 *
 * ① D'abord `TROU_FORCE = 0,34`, sur le raisonnement *« un foyer est la lumière franche, une torche
 * de quoi marcher, une braise de quoi ne pas être aveugle »*. Alexis a relevé le symptôme à l'œil
 * (*« la braise doit aussi éclairer le joueur »*), et le nombre était bien de trop — mais pas pour
 * la raison que j'ai écrite ensuite.
 *
 * ② Corrigé en `bulleDeBraise(braise, 0)` **tel quel**, au motif que la sim rend `CLARTE_PLEINE × f`
 * = **1 à charge pleine**, comme une torche et comme un Feu au contact. ⚠ **C'est vrai des profils
 * de `/sim` et FAUX du rendu, qui a sa propre échelle d'amplitude** : dans `veilFires`, un Feu
 * pousse `force` **1** et une torche `TORCHE_HOLE_FORCE` = **0,5**. Pousser 1 donnait donc à une
 * braise pleine le creusement d'un FEU, et le double d'une torche — j'avais inversé la hiérarchie
 * que je prétendais défendre, dans la couche même qui éclaire les corps.
 *
 * **LA FORME JUSTE N'A AUCUN NOMBRE À MOI** : l'amplitude est le sommet de l'autorité **mis à
 * l'échelle du rendu par la constante de la torche**. À charge pleine la braise creuse EXACTEMENT
 * comme une torche ; en dessous elle creuse moins, ce qu'exige la moitié « amplitude » de N2bis
 * (là où la sim refuse la parade, l'écran ne doit pas dire « tu vois ») ; et la hiérarchie se lit
 * là où elle doit vivre — **la PORTÉE** : 3 tuiles pour la braise (`RAYON_BASE × TROU_RATIO`),
 * 4 pour la torche, 6 pour un Feu. Les deux autres couches disent déjà la même chose et de la même
 * façon : la flaque prend `TORCHE_ALPHA_SCALE` et le point light `TORCHE_INTENSITE`, tous deux
 * multipliés par `forceDeBraise`, qui porte la charge.
 *
 * ⚠ **Ce qui reste SUSPECTÉ, et que seule une image dira** : que ce plafond ait été la cause de ce
 * qu'Alexis a vu. Entre 0,34 et la parité torche (0,5) il n'y a qu'un facteur 1,47, et il existe une
 * autre explication structurelle au même symptôme — `view.feuxGi` est dérivé AVANT les poussées des
 * lumières portées, donc le corps d'un porteur ne reçoit **aucun terme directionnel** de ce qu'il
 * porte, seulement le champ plat. Ce chemin-là vaut pour la torche autant que pour la braise, et il
 * ne se tranche pas dans ce fichier.
 */
export function forceDuTrouDeBraise(braise: Braise | undefined): number {
  if (braise === undefined) return 0
  // LE SOMMET DE L'AUTORITÉ × L'ÉCHELLE DU RENDU. Pas de `flicker` — la profondeur du creusement
  // est une géométrie du voile, le battement vit dans `forceDeBraise` (les alphas).
  return TORCHE_HOLE_FORCE * bulleDeBraise(braise, 0)
}
/** La flaque au sol : au rayon PLEIN de la sim (quantifié), un peu plus large que le trou pour
 *  qu'on n'en voie pas le bord — le rapport de la torche (flaque 6, trou 4). Son profil est en
 *  smoothstep, donc son alpha vaut 0 au bord : rien ne déborde du support de la sim. */
export const FLAQUE_RATIO = 1
/**
 * LE TROU DANS LE VOILE DE CAVE, en part du rayon de la sim — le même ratio que le trou de
 * surface, parce que c'est la même question posée sous la roche.
 *
 * ⚠ Sous terre, `day` vaut toujours 0 pour ces couches : *« sous terre il fait nuit à toute
 * heure »* (le défaut mesuré le 2026-09-02 sur la torche). Le facteur de nuit de
 * `rayonEcranDeBraise` ne doit donc pas éteindre le halo d'un porteur à midi dans une salle.
 */
export const CAVE_RATIO = 0.75
/** Le rayon du point light, en tuiles : LE RAYON DE LA SIM, sans ratio. Light2D n'allume que ce
 *  qui a une carte de normales (fûts, corps) et sa chute est quadratique — c'est la portée que
 *  la sim donne, et la seule couche où l'écran ne peut pas déborder par sa forme. */
export const LIGHT_RATIO = 1

/** L'amortissement du battement : 0 = une masse morte, 1 = une flamme. Une braise respire. */
export const BATTEMENT = 0.45

/** La charge, ramenée au palier de taille inférieur (`floor`) — voir l'en-tête : toujours ≤ la
 *  charge réelle, donc tout rayon qui en dérive est ≤ celui de la sim. */
export function partQuantifiee(f: number): number {
  if (!(f > 0)) return 0 // `!(f > 0)` et non `f <= 0` : un NaN ne doit pas rendre de lumière
  const q = Math.floor(Math.min(1, f) * QUANTA)
  return q / QUANTA
}

/**
 * LA FORCE du halo, de 0 à 1 — ce que tout le reste multiplie. Trois facteurs, les mêmes que la
 * torche à l'agonie près (la braise n'en a pas : sa décroissance EST sa charge, linéaire, et
 * cette linéarité est une loi de la sim, pas une courbe de rendu) :
 *   • LA NUIT (`1 - day`) — de jour une braise ne se voit pas. Elle ne refroidit pas pour
 *     autant, et sa clarté dans la SIM n'en dépend pas : c'est le `max` avec le ciel qui range
 *     la question là-bas (N1). Ici, ne rien masquer de jour.
 *   • LA CHARGE (`fractionDeCharge`) — continue, parce qu'elle passe par l'alpha.
 *   • LE BATTEMENT — `flicker`, amortie vers 1 (voir l'en-tête).
 */
export function forceDeBraise(braise: Braise | undefined, day: number, timeMs = 0, seed = 0): number {
  if (braise === undefined) return 0
  const f = fractionDeCharge(braise)
  if (!(f > 0)) return 0
  const nuit = Math.max(0, Math.min(1, 1 - day))
  const battement = 1 + (flicker(timeMs, seed) - 1) * BATTEMENT
  return Math.max(0, Math.min(1, nuit * f * battement))
}

/**
 * Le rayon d'écran de la braise, en tuiles : celui de la SIM, au ratio de la couche.
 *
 * ⚠ IL NE VACILLE PAS (pas de `flicker` ici : la force porte le battement), et il ne dépasse
 * jamais `rayonDeBraise` — c'est la moitié « support » de N2bis, vraie par construction.
 *
 * ⚠ **IL N'EST PAS QUANTIFIÉ** : seule la flaque l'est (`cellulesDeFlaque`), parce que seule
 * elle a un grain de pixels à préserver — voir l'en-tête, et le *« elle PULSE »* de `night-veil`.
 *
 * ⚠ **ET IL N'A PLUS DE FACTEUR DE NUIT, ce qui est le patron EXACT de la torche** : son trou de
 * voile s'éteint avec le jour (`torcheHoleRadius × nuit`), mais sa flaque et son point light ont
 * un rayon FIXE et ne s'effacent que par l'alpha. Ma première version mettait la nuit ici, donc
 * dans les quatre couches, et ça cassait deux choses : ① le compte de cellules de la flaque
 * balayait toutes ses valeurs au crépuscule, soit bien plus que les 8 bascules annoncées, et ②
 * l'affirmation « le compte de cellules est toujours entier » ne valait plus qu'à `nuit = 1`,
 * la seule heure que les gardes éprouvaient. La nuit vit donc dans `braiseHoleRadius` seul, et
 * dans `forceDeBraise`, qui éteint les alphas partout.
 */
export function rayonEcranDeBraise(braise: Braise | undefined, ratio: number): number {
  if (braise === undefined) return 0
  // LE RAYON DE L'AUTORITÉ, tel quel, au ratio de la couche (B-A18 ⑥ : `RAYON_BASE` et le gain
  // par niveau ne se relisent JAMAIS ici — la sim les tient, et c'est tout l'objet de l'export).
  return rayonDeBraise(braise) * ratio
}

/** La charge ramenée au palier de taille — en TICKS, l'unité de la sim (la charge est un budget
 *  entier, `braise.md` B-R7). `floor` deux fois : sur le palier, puis sur le tick. */
function chargeAuPalier(braise: Braise): number {
  const f = partQuantifiee(fractionDeCharge(braise))
  if (f <= 0) return 0
  return Math.floor(chargePleine(braise.niveau) * f)
}

/** Le trou dans le voile de nuit, en tuiles (et la portée de la source dans le champ de la GI,
 *  LG-A7 : la même, comme pour la torche). */
export function braiseHoleRadius(braise: Braise | undefined, day: number): number {
  const nuit = Math.max(0, Math.min(1, 1 - day))
  if (!(nuit > 0)) return 0
  return rayonEcranDeBraise(braise, TROU_RATIO) * nuit
}

/**
 * LE PIXEL DE LUMIÈRE : 4×4 px monde — la MÊME grille que les quatre flaques du jeu et que l'art.
 *
 * ⚠ IL VIT ICI, avec la loi de quantification, et non dans la couche qui dessine : c'est lui qui
 * dit ce qu'est un « palier entier » (voir l'en-tête et la garde ⑩). Un grain écrit dans la
 * boucle de rendu aurait laissé la loi sans son unité.
 */
export const LIGHT_PX = 4

/**
 * LE RAYON DE LA FLAQUE EN CELLULES ENTIÈRES — le rayon d'écran, arrondi vers le BAS.
 *
 * `floor` et non `round` : arrondir au plus proche ferait dépasser le rayon de la sim d'une demi
 * cellule à la moitié des charges, et N2bis ne s'accommode pas d'une demi-cellule de plus (c'est
 * le sens interdit). 0 = pas de flaque du tout.
 */
export function cellulesDeFlaque(braise: Braise | undefined): number {
  if (braise === undefined) return 0
  // ⚠ C'EST ICI, ET SEULEMENT ICI, QUE LA CHARGE SE QUANTIFIE (voir l'en-tête) : on remplace la
  // charge réelle par sa version au palier inférieur et on redonne le tout à `rayonDeBraise`,
  // sans jamais réécrire la formule de l'autorité.
  const tuiles = rayonDeBraise({ niveau: braise.niveau, charge: chargeAuPalier(braise) }) * FLAQUE_RATIO
  return Math.floor((tuiles * TILE_PX) / LIGHT_PX)
}
