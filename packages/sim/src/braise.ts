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
