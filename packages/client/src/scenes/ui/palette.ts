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
   * L'ENCRE TIÈDE — du texte de corps qui a pris la couleur de la braise sans en être un accent.
   * NOMMÉE le 2026-07-28 : le voile de mort (la ligne du corps), le menu PAUSE (la colonne
   * gauche du tableau des clics) et l'écran des vallées (l'état d'un monde) la portaient en dur.
   * Son rôle est toujours le même : une SECONDE VOIX, plus chaude que `dim`, pour ce qui
   * commente le geste principal sans le concurrencer.
   */
  bodyWarm: '#c0a074',
  /**
   * LE GRIS DE SUIE — la valeur du SOL CENDRÉ, celle contre laquelle tout ce qui vit dans la
   * cendre se calibre (mémoire « la couleur se calibre contre son fond »). NOMMÉE le
   * 2026-08-30 : la colonne de fumerolle la peint, la teinte des bêtes cendreuses et le
   * lavage du bief souillé s'en écartent d'un cran — trois fichiers la portaient en dur.
   */
  grisDeSuie: '#5c5854',
  /**
   * LE LISERÉ SOMBRE — la bordure des éléments en RETRAIT : le champ de recherche du
   * catalogue, la croix de fermeture et le reset des options du menu, et la tuile neutre
   * de l'Atelier (le repli « sans albédo »). NOMMÉE le 2026-08-10 : trois écrans la
   * portaient en dur, la garde des teintes partagées a compté.
   */
  bordSombre: '#3a3a44',
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
  emberDeep: '#e8763a', // braise profonde : le titre « ASHES »
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
  /**
   * Le cadre chaud SURVOLÉ — `borderWarm` éclairci. NOMMÉE le 2026-07-28 : elle vivait en dur
   * dans la stèle de fin de saison et le menu PAUSE, et le banc d'écoute en a fait un troisième
   * porteur — le seuil où la garde de palette exige un nom. Trois écrans qui partagent une
   * teinte anonyme la font dériver au premier réglage (c'est déjà arrivé : trois rouges pour
   * un seul accent). Toujours le même rôle : le bord d'un bouton FANTÔME sous le curseur.
   */
  borderWarmHover: '#8a7a52',
  // NOMMÉES le 2026-07-25 : partagées par le sac de l'écran perso, le composant sac/ceinture
  // partagé et le modal du feu (≥3 fichiers) — une teinte que plusieurs écrans emploient est un
  // token qui s'ignore (mémoire palette). On leur donne leur nom pour qu'elles ne dérivent pas.
  armed: '#241d14', // surface d'une case ARMÉE / active (ceinture tenue, bouton du feu)
  wearTrack: '#3a2f22', // le rail sombre derrière une jauge d'usure d'outil
  /**
   * LE RAIL D'UN CONTRÔLE au repos — le sillon du curseur de volume, le bord d'un champ de
   * saisie. NOMMÉE le 2026-07-28 : le menu PAUSE, le banc d'écoute et l'écran des vallées la
   * portaient en dur. Cousine de `wearTrack` (le rail d'une JAUGE, qu'on lit) : celui-ci est
   * le rail d'un ORGANE, qu'on manipule — même famille, deux rôles, deux noms.
   */
  controlRail: '#3a3225',
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
