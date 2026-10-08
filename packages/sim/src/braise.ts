/**
 * ═══ LA BRAISE — l'arithmétique de la barre (spec `braise.md` § 1, B-R3) ═══
 *
 * Un objet unique porté, trois métiers : la **chaleur** du personnage, l'**allumage** du feu, la
 * **lumière** autour de soi (B-R1). Ce fichier ne porte que le premier, et seulement sa part
 * ARITHMÉTIQUE : la barre, ses crans, son plein. Le froid lui-même vit dans `temperature.ts` —
 * `cransExiges` (la demande, B-R4) et la vidange (B-R8) y sont, à l'endroit où l'air se lit, et
 * c'est ce qui garde ce module FEUILLE (il n'importe que `balance.ts`, donc aucun cycle).
 *
 * ⚠ **À NE PAS CONFONDRE AVEC `braise-mere.ts`**, qui est tout autre chose : la Braise-mère est un
 * foyer de la spec `cendre.md` (une structure, un rituel). Celle-ci est la braise qu'on PORTE.
 *
 * ⚠ **UN SEUL SCALAIRE EN ÉTAT** (B-R3) : `charge`. Les crans ne sont pas stockés, ils se
 * DÉRIVENT — rien en tableau, rien en `Map`, donc l'état voyage en JSON et rejoue au bit près
 * (invariant §2). Et la barre se vide **du haut** : perdre un tick de charge, c'est perdre le cran
 * du dessus, puis le suivant.
 */
import { BRAISE } from './balance'

/**
 * L'ÉTAT PORTÉ (B-R2) — `Entity.braise`, jamais un `ItemId` dans le sac.
 *
 * ⚠ C'est la leçon de `tenue_hiver` : son plancher s'appliquait par simple POSSESSION, donc un
 * objet oublié au fond du sac protégeait autant qu'un objet porté. Une porte de survie ne se lit
 * pas dans un inventaire.
 */
export interface Braise {
  /** Le palier de l'arbre (B-R14). 0 = la braise de départ. Survit à la mort (B-R11). */
  niveau: number
  /** Les TICKS DE FROID qu'elle peut encore couvrir. Entier : voir `BRAISE.DUREE_CRAN`. */
  charge: number
}

/** Les crans qu'un niveau d'arbre donne (B-R3 : deux au départ ; B-R14 : l'arbre les augmente).
 *  Écrit ici une seule fois, pour que l'arbre n'ait qu'à monter `niveau`. */
export function cransMax(niveau: number): number {
  return BRAISE.CRANS_DEPART + niveau
}

/** La charge d'une braise pleine, en ticks de froid. */
export function chargePleine(niveau: number): number {
  return cransMax(niveau) * BRAISE.DUREE_CRAN
}

/** Une braise fraîche et PLEINE, au niveau atteint — ce qu'on porte à la naissance comme au
 *  réveil après la mort (B-R11 : la mort prend la position, pas l'échelle). */
export function braiseNeuve(niveau = 0): Braise {
  return { niveau, charge: chargePleine(niveau) }
}

/**
 * ═══ LES CRANS COUVERTS — `floor`, et c'est une DÉCISION (B-R7b) ═══
 *
 * ```
 * cransCouverts = floor(charge / DUREE_CRAN)      // borné à cransMax(niveau)
 * ```
 *
 * Donc **un cran ne vaut que plein** : au premier tick de vidange, une braise pleine de `N` crans
 * n'en couvre plus que `N − 1`. C'est ce qui ferme le palier de demande `N` sans une porte à coder
 * — « le palier se touche, il ne s'habite pas » — et c'est la variante que Alexis a ratifiée le
 * 2026-09-28 contre le `ceil` de la vraie arme de Monster Hunter, qui aurait rendu un cran de répit
 * et rouvert le palier 2 en été.
 *
 * ⚠ Il reste une dette de LISIBILITÉ, qui est du rendu et non de la règle : la barre doit peindre
 * `cransCouverts`, le cran du haut se vidant visiblement HORS COMPTE.
 */
export function cransCouverts(braise: Braise): number {
  const n = Math.floor(braise.charge / BRAISE.DUREE_CRAN)
  const max = cransMax(braise.niveau)
  return n < 0 ? 0 : n > max ? max : n
}

/**
 * ═══ LE TROISIÈME MÉTIER — LE HALO (B-R13, B-R13c, B-A14) ═══
 *
 * La braise éclaire. Elle entre dans `clarteSurSoiAt` **comme une source parmi les autres** —
 * au `max`, jamais en somme (N1) —, avec le profil d'un feu posé : un sommet au contact, une
 * décroissance linéaire, zéro au bord. Ce qui la distingue d'un feu, c'est que son profil est
 * commandé par sa CHARGE : la barre de crans est aussi une barre de VISION, une ressource et
 * deux lectures (B-R13c, décision d'Alexis du 2026-10-04).
 *
 * ⚠ **LA CHARGE PÈSE DEUX FOIS, ET CE N'EST PAS UN CHOIX — c'est la seule forme qui satisfasse
 * les deux critères écrits avant le code.** B-A14 ① veut le RAYON proportionnel à la charge ;
 * B-A18 ② veut que la clarté SUR SOI franchisse `SEUIL_NOIR` quand la charge baisse. Or un
 * profil linéaire `1 − d/R` vaut **1 au contact quel que soit `R`** : un rayon qui rétrécit tout
 * seul ne changerait jamais rien à ce qu'on voit sous ses pieds, et B-A18 ② serait verte sans
 * pouvoir rougir. Il faut donc que la charge porte AUSSI le sommet — exactement le patron de
 * `bulleDuFeu` (`facteur d'état × décroissance`), où le facteur est ici la fraction de charge.
 *
 * Ce qui se lit d'une seule ligne, et c'est joli : avec `f` la fraction de charge,
 *
 * ```
 * f × (1 − d / (R₀ × f))  =  f − d / R₀
 * ```
 *
 * — **un cône de PENTE FIXE dont la charge est le sommet.** La braise ne change pas de forme en
 * se vidant : elle s'enfonce. Et à charge nulle, le cône a disparu (B-A15 : zéro, pas un
 * plancher — ça tombe du produit, aucune ligne ne le pose).
 *
 * ⚠ **CETTE IDENTITÉ EST VRAIE DANS ℝ ET FAUSSE EN IEEE754 : NE PAS « SIMPLIFIER » LE CODE.**
 * MESURÉ (audit de fusion du 2026-10-05, 800 000 échantillons) : les deux formes diffèrent sur
 * **44,1 %** d'entre eux, jusqu'à 1,11 × 10⁻¹⁶. C'est invisible partout sauf au voisinage de
 * `NUIT.SEUIL_NOIR`, où un dernier bit décide d'une PARADE — donc d'un replay. La forme qui
 * compte est celle que `bulleDeBraise` exécute (`f × (1 − d/r)`, le patron de `bulleDuFeu`) ;
 * l'égalité ci-dessus est une lecture, pas une permission de réécrire (invariant §2).
 *
 * ⚠ **CE QUE ÇA COÛTE À LA NUIT NOIRE, ET TRANCHÉ** (`braise.md` § 5.21, issue ⓐ, décision
 * d'Alexis du 2026-10-05). **Le sommet est un SEUIL, pas un réglage, et c'est de
 * l'ARITHMÉTIQUE** : à charge pleine la clarté sur soi vaut *exactement* `CLARTE_PLEINE`, donc
 * tout sommet ≥ `NUIT.SEUIL_NOIR` rend la parade à toute braise pleine et tout sommet en dessous
 * ne la rend jamais — il n'existe aucune valeur intermédiaire.
 *
 * ⚠ **CE QUI EST MESURÉ ET CE QUI NE L'EST PAS — ma première note confondait les deux** (relevé
 * à l'audit de fusion du même jour). **MESURÉ** (`tools/__clarte-braise.mts`, monde joué, graine
 * 2026, 14 jours, 16 800 relevés) : **4 144 d'entre eux — 24,7 % — étaient noirs avant l'étape
 * 7**, c'est-à-dire que la nuit noire pesait un quart du temps de jeu ; et, **sans balise**, le
 * froid mord 36,4 % des ticks et la braise est vide au **jour 70**. **PAS mesuré, et le « 0 noir
 * sur 4 144 » de ma note était une TAUTOLOGIE** : le bras qui le rend épingle la charge au plein,
 * donc `max(base, CLARTE_PLEINE × 1) ≥ 0,3` ne *peut pas* rendre un noir — il relit
 * l'arithmétique ci-dessus, il ne l'éprouve pas. Et ce que B-R8 et B-R9 disent (pas de vidange
 * sans froid ; la balise recharge au plein) sont des LOIS, pas des mesures.
 *
 * **La nuit noire ne disparaît donc pas : elle change de nature** — elle ne mord plus que là où
 * la braise se vide, c'est-à-dire en altitude et loin d'une balise, là où l'Ascension veut de la
 * pression.
 */

/** LA FRACTION DE CHARGE, dans [0, 1] — `charge / chargePleine(niveau)`, bornée. C'est le seul
 *  terme par lequel la charge entre dans la lumière, et il entre deux fois (voir ci-dessus). */
export function fractionDeCharge(braise: Braise): number {
  const plein = chargePleine(braise.niveau)
  if (plein <= 0) return 0
  const f = braise.charge / plein
  return f < 0 ? 0 : f > 1 ? 1 : f
}

/** CE QUE L'ARBRE MULTIPLIE (B-R14) — `1` au niveau 0, donc inerte tant que l'étape 8 n'existe
 *  pas. Écrit quand même pour que la forme de B-A14 ① soit codée et non devinée plus tard. */
export function multDuRayon(niveau: number): number {
  return 1 + niveau * BRAISE.RAYON_GAIN_PAR_NIVEAU
}

/**
 * LE RAYON DU HALO, en tuiles (B-A14 ①) — `RAYON_BASE × mult(niveau) × fraction de charge`.
 *
 * ⚠ **UN PRODUIT, PAS UN PLAFOND** : la clause B-A14 ① demande la moitié du rayon à demi-charge
 * *à tous les niveaux*. Un `min(base, …)` passerait la clause à charge pleine et la raterait
 * partout ailleurs — d'où une garde qui BALAIE la charge au lieu de l'échantillonner au plein.
 */
export function rayonDeBraise(braise: Braise): number {
  return BRAISE.RAYON_BASE * multDuRayon(braise.niveau) * fractionDeCharge(braise)
}

/**
 * LA BULLE DE LA BRAISE à la distance `d` de son porteur — le profil de B-R13c.
 *
 * `CLARTE_PLEINE × f` au contact, linéaire → 0 à `rayonDeBraise`, et **exactement 0** au-delà
 * comme à charge nulle (B-A15).
 *
 * ⚠ **ELLE N'EST DANS [0, 1] QUE POUR `d ≥ 0`, et j'avais écrit « dans [0, 1] » tout court**
 * (relevé par `determinisme-sim`, D5, MESURÉ) : `!(d < r)` ne borne que le HAUT, donc une
 * distance NÉGATIVE dépasse le sommet — `bulleDeBraise({0, 3×plein}, −1)` rend **1,25**, et
 * `d = −Inf` rend **+Infinity** (51 sorties hors [0, 1] sur 1 040, toutes à `d < 0`).
 * **Inatteignable aujourd'hui** : les deux appelants de `/sim` passent `Math.sqrt(…)` ou le
 * littéral 0, et les trois appels du client passent 0. Mais la fonction est **exportée au
 * client**, donc l'énoncé devait être juste plutôt que rassurant.
 *
 * ⚠ **ET ELLE NE REND JAMAIS NaN — c'est une propriété dont DEUX choses dépendent**, donc elle
 * s'écrit ici : l'équivalence au bit du `max` de `clarteSurSoiAt` (`lumiere.test.ts` ⑩ ⓑ) et
 * l'élagage proposé du balayage. MESURÉ : 0 NaN sur 1 040 appels d'un balayage incluant NaN,
 * ±Inf et des charges négatives — c'est encore `!(d < r)` qui le fait (il attrape `d` NaN **et**
 * `r` NaN). ⚠ `fractionDeCharge` et `rayonDeBraise`, elles, **rendent NaN** sur une charge NaN,
 * et elles sont exportées au RENDU, où un rayon NaN est le piège connu du shader. Inatteignable
 * aussi (la charge ne s'écrit que par `Math.max`/`Math.min`/`braiseNeuve`), mais à savoir. C'est le pendant de `bulleDuFeu` pour un foyer qu'on porte :
 * mêmes bornes, même absence de ligne de vue à l'intérieur du cône (celle-ci se paie en dehors,
 * par `partVisible`, chez l'appelant — comme pour le feu et la torche).
 */
export function bulleDeBraise(braise: Braise, d: number): number {
  const f = fractionDeCharge(braise)
  if (f <= 0) return 0
  const r = BRAISE.RAYON_BASE * multDuRayon(braise.niveau) * f
  if (!(d < r)) return 0 // `!(d < r)` et non `d >= r` : un `d` NaN ne doit pas rendre de lumière
  return BRAISE.CLARTE_PLEINE * f * (1 - d / r)
}
