/**
 * LA TYPOGRAPHIE DU JEU — une seule source, pour tout ce qui s'écrit à l'écran.
 *
 * Elle existe parce qu'on s'est fait avoir : le jeu entier est en chasse fixe
 * (`monospace`, crème sur contour sombre), et le panneau d'artisanat est arrivé en
 * `Georgia, serif`. Résultat, un écran à deux voix — « INVENTAIRE » en chasse fixe,
 * « ARTISANAT » en romain, à trente pixels l'un de l'autre. Une police se choisit
 * UNE fois, pour un jeu ; elle ne se redécide pas dans chaque fichier qui peint.
 *
 * Un test (`typography.test.ts`) garde la règle : AUCUN autre fichier n'a le droit
 * d'écrire `fontFamily`. Sans lui, la règle serait une intention — et la prochaine
 * bonne idée typographique repartirait pour un tour.
 *
 * L'ÉCHELLE est courte, exprès. Trois tailles de corps et deux d'accent : au-delà,
 * on ne compose plus, on bricole — et l'œil ne sait plus ce qui est important.
 */
import { HEX } from './palette'

/** La chasse fixe du jeu. Le monde est un HUD de survivant, pas un livre. */
export const FONT = 'monospace'

/**
 * Le CONTOUR. Le HUD flotte sur le monde (feuillage vert sombre, neige blanche) :
 * sans lui, le même texte est illisible une fois sur deux. C'est ce qui rend la
 * couleur du texte lisible PARTOUT, pas seulement sur le voile du menu.
 */
export const STROKE = { stroke: '#14141a', strokeThickness: 3 } as const

/**
 * L'encre. Du plus fort au plus discret — et deux accents, jamais plus. Les valeurs
 * viennent de `palette.ts` (source unique de couleurs) : la voix et les teintes ne se
 * redécident pas dans deux fichiers. `warm` = la braise ; `alert` = le rouge.
 */
export const INK = {
  /** Les titres d'écran et de section. */
  title: HEX.title,
  /** Le texte courant : noms d'objets, valeurs. */
  body: HEX.body,
  /** Le second plan : coûts, unités, intitulés de rayon. */
  dim: HEX.dim,
  /** Éteint : ce qu'on ne peut pas faire (matériaux manquants), un champ vide. */
  faint: HEX.faint,
  /** L'accent CHAUD : ce qui attend, ce qui chauffe (une file en pause). */
  warm: HEX.ember,
  /** L'accent D'ALERTE : ce qui bloque (sac plein), ce qu'on va détruire. */
  alert: HEX.alert,
} as const

type Style = { fontFamily: string; fontSize: string; color: string; stroke?: string; strokeThickness?: number }

/** Une taille de l'échelle, en pixels. Rien entre les deux : c'est le point. */
export const SIZE = { title: 15, body: 14, label: 12, small: 11 } as const

/** Le style d'un texte du HUD. `outline: false` pour ce qui vit déjà sur un fond
 *  plein (une ligne de liste) — le contour y ajoute du gras pour rien. */
export function textStyle(
  size: keyof typeof SIZE,
  color: keyof typeof INK = 'body',
  outline = true,
): Style {
  const base = { fontFamily: FONT, fontSize: `${SIZE[size]}px`, color: INK[color] }
  return outline ? { ...base, ...STROKE } : base
}

/** Un titre de section (INVENTAIRE, ARTISANAT, COFFRE…) : la même voix partout. */
export const SECTION_TITLE: Style = textStyle('title', 'title')
