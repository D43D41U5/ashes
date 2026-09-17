/**
 * ═══ LES RÉGLAGES DE LA GI — G2, aux réglages de la planche 1 (spec `lumiere-globale.md` LG-R4) ═══
 *
 * Tout nombre de la GI vit ICI, et nulle part dans un corps de fonction : ce sont des réglages de
 * LOOK, calibrés sur les planches du chantier « l'air et la lumière » (2026-09-14 → 16), pas des
 * nombres d'équilibrage — ils ne changent rien au jeu (la loi du jeu est dans `/sim`, `lumiere.ts`).
 * Chaque valeur dit d'où elle vient.
 */
import { LUMIERE } from '@ashes/sim'

export const GI = {
  /** Le grain : `LUMIERE.TEXELS_PAR_TUILE` texels par tuile (4 px monde, LG-R2). Un seul bouton, dans la sim. */
  GRAIN: LUMIERE.TEXELS_PAR_TUILE,
  /** Le rayon du disque émissif, en texels — la pénombre (LG-R4 « direct » ; le même que la sim, LG-R12). */
  TAILLE_SOURCE: LUMIERE.SOURCE_RAYON_TEXELS,
  /** La teinte du feu, en lumière linéaire par canal (planche 1, « de moi »). */
  TEINTE_FEU: [1.15, 0.92, 0.62] as const,
  /** Le gain du rebond (LG-R4 « rebond », de moi). */
  REBOND: 0.9,
  /** La portée du rebond, en texels (LG-R4, de moi). */
  PORTEE_REBOND: 12,
  /** Le genou du rebond : m → m / (1 + m / plafond) — le rebond reste sous 0,2 et garde sa teinte (LG-R4 « genou »). */
  PLAFOND_REBOND: 0.2,
} as const

/** Un albédo, en lumière linéaire par canal. */
export type Albedo = readonly [number, number, number]

/** L'albédo des occludeurs — ce que leurs FACES renvoient (LG-R4 « faces » ; valeurs de planche, de moi). */
export const ALBEDO = {
  /** Le terrain plein, par identifiant de terrain (VOID 0, ROCK 5, WALL 7, GLACIER 15, CLIFF 23, CENDRE_MIN 29). */
  TERRAIN: {
    0: [0.2, 0.2, 0.2],
    5: [0.46, 0.44, 0.41],
    7: [0.5, 0.42, 0.32],
    15: [0.72, 0.8, 0.88],
    23: [0.42, 0.37, 0.3],
    29: [0.3, 0.29, 0.28],
  } as Readonly<Record<number, Albedo>>,
  /** Un terrain plein que la table ignore (le sol d'un autre palier vu comme une paroi, par exemple). */
  TERRAIN_DEFAUT: [0.42, 0.37, 0.3] as Albedo,
  /** Le bois d'un fût. */
  TRONC: [0.42, 0.3, 0.19] as Albedo,
  /** La pierre d'un nœud plein (roche, bloc, filon). */
  NOEUD: [0.46, 0.44, 0.41] as Albedo,
  /** Le bâti, par pièce ; le bois d'un mur par défaut. */
  BATI: {
    wall: [0.5, 0.42, 0.32],
    house: [0.5, 0.42, 0.32],
    mur_bas: [0.5, 0.42, 0.32],
    palissade: [0.45, 0.33, 0.2],
    door: [0.45, 0.33, 0.2],
    braise_mere: [0.3, 0.25, 0.2],
  } as Readonly<Record<string, Albedo>>,
  BATI_DEFAUT: [0.5, 0.42, 0.32] as Albedo,
} as const
