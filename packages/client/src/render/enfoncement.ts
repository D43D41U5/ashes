/**
 * ═══ DANS QUOI LE CORPS ENTRE — la composition des milieux (spec `peche.md` R13) ═══
 *
 * Quatre milieux peuvent cacher le bas d'un acteur, et ils se croisent tous : **l'EAU** (on
 * entre aux genoux), **la NEIGE** (elle monte sur le pied), **la VASE** du marais (le sol
 * cède), **la TERRE** dont un Cendreux s'extrait. Ce module dit, pour un point donné, de
 * combien le sprite est DÉCOUPÉ et de combien il DESCEND.
 *
 * ⚠ IL EXISTE PARCE QUE LES TRANSITIONS ÉTAIENT SALES. La vase était binaire (une lecture de
 * terrain par tuile) : franchir une arête faisait descendre le corps de 3,5 px d'un coup. Et
 * elle était éteinte par des PORTES (« pas si dans l'eau », « pas si sous la neige ») — or une
 * porte est elle-même une marche : entrer dans l'eau depuis la vase faisait sauter sa découpe
 * de 3,5 à 0 pendant que celle de l'eau partait de 0.
 *
 * LES DEUX LOIS, et tout le reste en découle :
 *
 *   ① **UN MAX, JAMAIS UNE SOMME.** Chaque milieu répond à la même question — « à partir d'où
 *      le corps est-il caché ? » — et le plus profond gagne. Les additionner ferait disparaître
 *      sous le sol un Cendreux qui sort les pieds dans une mare.
 *   ② **CE QUI MONTE NE FAIT PAS DESCENDRE.** La neige est une couche POSÉE sur le sol
 *      (décision d'Alexis, 2026-08-22 : « elle ne devrait pas faire descendre le personnage »)
 *      — elle découpe sans descente. L'eau, la vase et la terre, elles, CÈDENT : le corps
 *      descend d'autant, et la ligne de sol reste aux pieds.
 *
 * Pur (aucun import Phaser) : la continuité se prouve en Node, sur tout le domaine, au lieu de
 * se juger à l'œil sur une capture.
 */

/** La poudreuse monte à la cheville… */
export const NEIGE_CHEVILLES_PX = 2
/** …et la profonde au genou (`gel.md` G9). */
export const NEIGE_GENOUX_PX = 6
/**
 * LA VASE ENFONCE À MI-CHEMIN DE L'EAU (correction d'Alexis, 2026-08-24) : 3,5 px contre les
 * 7 px de l'eau peu profonde pleine. Ni la neige (qui ne fait pas descendre) ni le lac.
 */
export const VASE_PX = 3.5
/** La profondeur de l'eau peu profonde, en px MONDE — l'eau a UNE profondeur, et c'est la
 *  taille de chaque bête qui raconte le reste (le lapin y disparaît, le cerf y trempe). */
export const EAU_PX = 7
/** La rampe des deux SDF (rive, vase), en tuiles : 0 pile au trait, plein à cette avancée. */
export const RAMPE_TUILES = 0.6
/** Aucun milieu ne cache plus de cette fraction du corps : on doit toujours voir QUI patauge. */
export const COUPE_MAX_FRACTION = 0.45

export interface Milieux {
  /** Distance signée à la rive, en tuiles (+ dans l'eau). Déjà retournée si la glace porte. */
  dRive: number
  /** Distance signée au bord du marais, en tuiles (+ dans la vase). */
  dVase: number
  /** Hauteur de neige (0 = nue, 1 = poudreuse, 2 = profonde) — `gel.md` G9. */
  hauteurNeige: number
  /** Fraction du corps encore SOUS TERRE (0..1) — un Cendreux qui se lève (`cendreux.md` R21). */
  enfoui: number
  /** La hauteur affichée du sprite, en px monde : les plafonds sont relatifs au corps. */
  displayH: number
}

export interface Enfoncement {
  /** De combien le sprite est découpé par le bas, en px monde. */
  coupe: number
  /** De combien le corps descend, en px monde (ce qui CÈDE seulement). */
  descente: number
  /** L'immersion dans l'EAU, 0..1 — le reste du rendu s'y accroche (reflet, gerbe, anneaux). */
  immersion: number
}

/** La rampe commune des deux SDF : 0 hors du milieu, 1 à `RAMPE_TUILES` dedans. Continue,
 *  bornée, sans branche cachée — c'est elle qui fait qu'aucune arête de tuile ne se sent. */
export function rampe(distanceSignee: number): number {
  if (distanceSignee <= 0) return 0
  return Math.min(1, distanceSignee / RAMPE_TUILES)
}

/** La découpe de neige : chevilles jusqu'à 1, genoux au-delà (`gel.md` G9). Continue. */
export function coupeDeNeige(hauteur: number, displayH: number): number {
  if (hauteur <= 0.01) return 0
  const px =
    hauteur <= 1
      ? NEIGE_CHEVILLES_PX * hauteur
      : NEIGE_CHEVILLES_PX + (NEIGE_GENOUX_PX - NEIGE_CHEVILLES_PX) * Math.min(1, hauteur - 1)
  return Math.min(px, displayH * COUPE_MAX_FRACTION)
}

/**
 * CE QUE LES QUATRE MILIEUX FONT AU CORPS — l'écrivain unique de la question.
 *
 * Aucun cas particulier, aucune porte : quatre profondeurs continues, un `max` pour ce qui
 * cache, un `max` pour ce qui cède. Toute transition — terre→eau, terre→vase, vase→eau, neige
 * sur vase, glace sur eau, terre qui s'ouvre — est donc continue par construction, y compris
 * les croisées qu'on n'a pas pensé à jouer.
 */
export function enfoncement(m: Milieux): Enfoncement {
  const immersion = rampe(m.dRive)
  const plafond = m.displayH * COUPE_MAX_FRACTION
  const coupeEau = immersion > 0 ? Math.min(EAU_PX * immersion, plafond) : 0
  const coupeVase = Math.min(VASE_PX * rampe(m.dVase), plafond)
  const coupeNeige = coupeDeNeige(m.hauteurNeige, m.displayH)
  const coupeTerre = m.displayH * Math.max(0, Math.min(1, m.enfoui))
  return {
    immersion,
    coupe: Math.max(coupeEau, coupeNeige, coupeVase, coupeTerre),
    // LA NEIGE N'Y EST PAS (loi ②) : elle monte, elle ne creuse pas.
    descente: Math.max(coupeEau, coupeVase, coupeTerre),
  }
}
