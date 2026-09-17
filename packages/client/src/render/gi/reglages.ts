/**
 * ═══ LES RÉGLAGES DE LA GI — G2, aux réglages de la planche 1 (spec `lumiere-globale.md` LG-R4) ═══
 *
 * Tout nombre de la GI vit ICI, et nulle part dans un corps de fonction : ce sont des réglages de
 * LOOK, calibrés sur les planches du chantier « l'air et la lumière » (2026-09-14 → 16), pas des
 * nombres d'équilibrage — ils ne changent rien au jeu (la loi du jeu est dans `/sim`, `lumiere.ts`).
 * Chaque valeur dit d'où elle vient.
 */
import { LUMIERE } from '@ashes/sim'
import { HOLE_ERASE_PEAK, profilDuTrou } from '../lighting'
import type { Emetteur } from './champ-ref'

export const GI = {
  /** La marge du champ autour de la vue, en tuiles (LG-R3 : au moins la plus longue portée qui peut y
   *  entrer — un feu : 6 tuiles × le battement 1,18 = 7,1 ; une torche : 4). */
  MARGE_TUILES: 8,
  /** Le nombre de sources qu'une image porte au GPU (un tableau d'uniformes ; les plus proches d'abord). */
  MAX_SOURCES: 16,
  /** Les sortes d'albédo de bande qu'une image porte au GPU (un tableau d'uniformes). */
  MAX_ALBEDOS_BANDE: 8,
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
  /** La fenêtre s'alloue par paliers de ce nombre de texels, et ne rétrécit jamais : `floor` et
   *  `ceil` franchissent leurs seuils séparément, donc une caméra qui glisse ferait osciller la
   *  taille d'une tuile et reconstruirait toute la chaîne une image sur deux (de moi, 17/09). */
  PALIER_TEXELS: 32,
  /** Le genou du rebond : m → m / (1 + m / plafond) — le rebond reste sous 0,2 et garde sa teinte (LG-R4 « genou »). */
  PLAFOND_REBOND: 0.2,
  /**
   * ═══ L'OMBRE DES ASTRES (LG-R8, LG-R9) ═══
   * Ce que le soleil et la lune retirent au plancher du ciel. **Ni la dérive ni la force ne sont
   * ici** : ce sont deux scalaires par image que `dynamic-lighting.ts` calcule déjà (`deriveDOmbre`,
   * `forceDeLOmbre`) et que `WorldScene` pousse aux socles et aux falaises — la GI lit le MÊME
   * nombre à la MÊME heure, elle ne refait pas le calcul (une loi, un lecteur).
   */
  ASTRE: {
    /** LG-R9 : ℓ = 0,4 × H px d'ombre pleine — « 8 px ÷ le bloc moyen de 20 px » (Alexis, planche 4). */
    LONGUEUR_PAR_HAUTEUR: 0.4,
    /** La hauteur d'un mur, en px : `MUR_HT` (`bati-art.ts:143`). Redit ici pour que l'oracle n'ait
     *  aucune dépendance navigateur (`bati-art` tire `normal-map`, donc un canvas) ; la garde
     *  « la hauteur d'un mur est celle du jeu » de `champ-ref.test.ts` tient les deux égaux. */
    HAUTEUR_MUR_PX: 32,
    /** LG-R8 : la pointe se cisaille de 8/7 px par px de LONGUEUR, à dérive ±1 — le cisaillement des
     *  socles (8 px au cran 8 sur leurs 7 rangs). C'est un RAPPORT : le même nombre vaut en texels. */
    CISAILLEMENT: 8 / 7,
    /** LG-R8 : la pénombre est DEHORS — 2 texels, à ⅔ puis ⅓, en fronts de Tchebychev. */
    PENOMBRE: [2 / 3, 1 / 3],
  },
} as const

/**
 * LG-R9 — LA LONGUEUR SUIT LA HAUTEUR : ℓ = 0,4 × H px d'ombre pleine, rendue en TEXELS du grain.
 *
 * `pxParTexel` se PASSE au lieu de s'importer : `TILE_PX` vit dans `../framing`, du côté du rendu,
 * et `champ-ref` promet de n'avoir aucune dépendance navigateur. L'unité devient explicite à chaque
 * appel, ce qui vaut mieux qu'un 4 en dur dans deux fichiers.
 */
export function longueurDOmbre(hauteurPx: number, pxParTexel: number): number {
  return (hauteurPx * GI.ASTRE.LONGUEUR_PAR_HAUTEUR) / pxParTexel
}

/**
 * LA PENTE DE LA LUMIÈRE DIRECTE — celle du trou du voile d'aujourd'hui (LG-R4 : « le profil et la
 * portée restent ceux d'aujourd'hui »), lue dans `render/lighting.ts` où la brosse du voile la lit
 * aussi : le pic `HOLE_ERASE_PEAK` × le smoothstep `profilDuTrou`. L'oracle (`champRef`) et la chaîne
 * GPU (`champ-gpu.ts`) la calculent tous deux ; la garde LG-A2 les compare.
 */
export function profilFeu(d: number, e: Emetteur): number {
  return HOLE_ERASE_PEAK * profilDuTrou(d / e.rayon)
}

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
