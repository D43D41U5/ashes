/**
 * LA PALETTE — une seule source de couleurs, calée sur la maquette « Ashes UI »
 * (projet Claude Design, réconciliée le 2026-07-19). Le pendant chromatique de
 * `typography.ts` : là-bas la voix (une chasse, une échelle, un contour), ici les
 * teintes (encre + 2 accents, surfaces, remplissages de médaillon).
 *
 * Deux formes de la MÊME valeur, parce que Phaser en veut deux : `HEX` (chaînes
 * `#rrggbb`) pour les `Text`/CSS, `COL` (entiers `0x`) pour `Graphics`/tint. Elles se
 * dérivent l'une de l'autre — jamais deux valeurs à tenir en phase à la main.
 *
 * Grammaire portante (maquette) : ENCRE + 2 ACCENTS, jamais plus. L'ambre (braise)
 * porte ce qui chauffe/attend/se sélectionne ; le rouge, ce qui bloque/alerte. Le gel
 * est un accent CONDITIONNEL (le froid), pas une troisième couleur libre.
 */

/** Les valeurs canoniques, en `#rrggbb` — la maquette, au pixel de teinte près. */
export const HEX = {
  // ── Encre : du plus fort au plus discret (miroir de typography.INK) ──
  title: '#ffffff',
  body: '#e8e0c8',
  dim: '#9a8f78',
  /**
   * L'encre VIVE — plus claire que `body`, pour ce qui est survolé, tenu, ou qu'on vient de
   * gagner. NOMMÉE le 2026-07-24 : elle existait déjà dans SEPT fichiers, en dur, sans nom.
   * Une teinte que sept écrans partagent n'est pas un détail local, c'est un token qui
   * s'ignore — et une valeur anonyme dérive au premier réglage. On lui donne son nom.
   */
  bodyBright: '#f2ead0',
  /**
   * L'encre la plus discrète — RELEVÉE de #6f6a60 à #8b8474 le 2026-07-24 (décision d'Alexis).
   *
   * L'ancienne valeur échouait au contraste WCAG AA partout où elle portait une PHRASE : 3,52:1
   * sur le voile, 3,19:1 sur un panneau, quand la norme demande 4,5. Ce n'est pas un détail
   * d'accessibilité : l'indicateur de sauvegarde a dû fuir cette teinte en catastrophe parce
   * qu'il était illisible sur un sol clair, et la ligne « la chronique garde le détail de ces
   * soixante jours » était la moins lisible de la stèle alors qu'elle explique le bouton.
   *
   * La nouvelle valeur passe AA sur les trois fonds du jeu (5,09 / 4,61 / 5,27) tout en gardant
   * 1,16 d'écart avec `dim` : la HIÉRARCHIE d'encre survit — faint reste le plus effacé des
   * quatre, il cesse simplement d'être illisible. On n'a pas supprimé un rang, on l'a rendu
   * lisible. (Valeurs calculées, pas choisies à l'œil.)
   */
  faint: '#8b8474',
  // ── Les deux accents ──
  ember: '#c98b3a', // braise : sélection, progression, ce qui chauffe
  emberBright: '#e8c66a', // braise vive : survol, halo, geste armé
  emberDeep: '#e8763a', // braise profonde : le titre « BRAISES »
  alert: '#e05a4a', // alerte : blocage, destruction
  gel: '#6f93a0', // accent conditionnel : le froid
  // ── Surfaces ──
  bg: '#0f0b08', // fond d'écran (menu, chargement)
  bgWarm: '#14100c', // fond chaud (la chronique, un registre qui a brûlé)
  ink: '#14141a', // le contour d'encre, les cadres sombres
  panel: '#1b1b22', // surface d'UI (médaillon, ceinture)
  panelWarm: '#16120d', // vignette de détail (survol, alternative)
  borderDim: '#2a2a34', // cadre neutre
  borderWarm: '#6b5a3a', // cadre chaud (bord haut d'une fenêtre)
} as const

/** Les remplissages de médaillon de vitale (maquette Turn 2A) : fill + liseré. */
export const VITAL_HEX: Record<'hp' | 'stamina' | 'hunger' | 'temperature', { fill: string; rim: string }> = {
  hp: { fill: '#b0473c', rim: '#cf6a5c' },
  stamina: { fill: '#c9a24a', rim: '#e2bd66' },
  hunger: { fill: '#8a9a4a', rim: '#a6b566' },
  temperature: { fill: '#6f93a0', rim: '#8fb0bc' },
}

/** `#rrggbb` → entier `0xrrggbb`. Le client n'est pas /sim : pas de contrainte de pureté. */
const toNum = (hex: string): number => parseInt(hex.slice(1), 16)

/** La MÊME palette, en entiers, pour `Graphics`/tint. Dérivée de `HEX` — source unique. */
export const COL: Record<keyof typeof HEX, number> = Object.fromEntries(
  (Object.keys(HEX) as (keyof typeof HEX)[]).map((k) => [k, toNum(HEX[k])]),
) as Record<keyof typeof HEX, number>

/** Les remplissages de médaillon, en entiers. */
export const VITAL_COL: Record<keyof typeof VITAL_HEX, { fill: number; rim: number }> = Object.fromEntries(
  (Object.keys(VITAL_HEX) as (keyof typeof VITAL_HEX)[]).map((k) => [
    k,
    { fill: toNum(VITAL_HEX[k].fill), rim: toNum(VITAL_HEX[k].rim) },
  ]),
) as Record<keyof typeof VITAL_HEX, { fill: number; rim: number }>
