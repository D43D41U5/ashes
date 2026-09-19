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
  /**
   * ═══ LA FORCE D'UN FEU (LG-R6, LG-A7) ═══
   * La portée d'un Feu ne prend ni l'engagement ni la force : elle est celle du trou d'aujourd'hui
   * (`fireHoleRadius`, qui respire au battement étalon). Sa FORCE, elle, prend les deux battements
   * d'aujourd'hui — l'engagement du village, comme le point-light (`intensiteDuFeu`), et le souffle
   * de la flamme, comme le trou du voile (`VeilFire.force`) : « le look de la clairière qui respire
   * est reconduit, le trou en moins ».
   */
  FEU: {
    /** L'engagement dans la force : (0,8 + 0,2 e) / 0,8 = 1 + 0,25 e — la loi d'aujourd'hui,
     *  `intensiteDuFeu` (`dynamic-lighting.ts`), rapportée au feu neutre : un quart de plus à plein
     *  engagement (Alexis, planche 12, LG-Q3 (b) : « K : la force seule »). `champ-ref.test.ts` tient
     *  les deux égales. */
    ENGAGEMENT: 0.25,
    /** Le souffle dans la force : 1 + 0,7 × (battement − 1) — l'amorti du trou du voile d'aujourd'hui
     *  (`WorldScene`, `veilFires.force` : « la clairière respire en profondeur »), que la GI reconduit
     *  (Alexis, LG-Q6 : « la force et la portée »). À pleine amplitude, le grain du sol clignoterait. */
    SOUFFLE: 0.7,
  },
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
    /** LG-R9 : la hauteur du PLUS GRAND lanceur de la spec — l'arbre, 96 px. Elle ne sert pas à
     *  peindre : elle TAILLE la borne littérale de la marche d'ombre du GPU (GLSL ES 1.0 veut une
     *  constante de compilation). Un mur demande 16 pas, un arbre 44 : une borne écrite à la main
     *  sur le mur tronquerait l'ombre des arbres EN SILENCE, courte et verte. */
    HAUTEUR_MAX_LANCEUR_PX: 96,
    /** LG-R8 : la pointe se cisaille de 8/7 px par px de LONGUEUR, à dérive ±1 — le cisaillement des
     *  socles (8 px au cran 8 sur leurs 7 rangs). C'est un RAPPORT : le même nombre vaut en texels. */
    CISAILLEMENT: 8 / 7,
    /** LG-R8 : la pénombre est DEHORS — 2 texels, à ⅔ puis ⅓, en fronts de Tchebychev. */
    PENOMBRE: [2 / 3, 1 / 3],
  },
  /**
   * ═══ LES CORPS (LG-R7, LG-R16) ═══
   *
   * LA HAUTEUR DE CRÊTE D'UNE BARRIÈRE, PAR FAMILLE — ce qui sépare son DESSUS de sa FACE, et de
   * combien ce dessus lit le sol plus bas. **`MUR_HT` n'est pas universel** : `bati-art` dessine
   * TOUTES les familles par le même `dessinerBarriere(mask, ht, tons)`, générique en `ht`, et trois
   * hauteurs y vivent (`EDGE_SPRITE`, `bati-art.ts:1923`). Une barrière lue à 32 px quand elle en
   * fait 8 place sa crête sous son propre pied : tout son art passerait en dessus.
   *
   * Redit ici plutôt qu'importé, pour la raison de `HAUTEUR_MUR_PX` ci-dessus (`bati-art` tire
   * `normal-map`, donc un canvas) ; la garde « les hauteurs de barrière sont celles du jeu » de
   * `sol-du-corps.test.ts` les tient égales à `EDGE_SPRITE` famille par famille — ET refuse qu'il
   * en manque une, sinon une famille neuve tomberait en silence sur la hauteur par défaut.
   */
  CORPS: {
    HAUTEUR_PAR_FAMILLE: {
      wall: 32,
      'wall-bois': 32,
      'wall-ruine': 32,
      encadrement: 32,
      door: 32,
      door2a: 32,
      door2b: 32,
      /** `PALIS_HT` (`bati-art.ts:1817`) — « entre la clôture (8) et le mur (32) ». */
      palissade: 24,
      /** `CLOT_HT` (`bati-art.ts:743`) — « la clôture est BASSE : on voit par-dessus ». */
      cloture: 8,
    } as Readonly<Record<string, number>>,
    /**
     * LA HAUTEUR DE LA FLAMME D'UN FEU AU-DESSUS DE SON SOL, en px — le `z` du point-light d'un Feu
     * (`dynamic-lighting.ts:507`, `TILE_PX * 0.6`), et c'est de LUI que se dérive la porte de la règle
     * des faces (Alexis, 2026-09-18, planche « la clôture au pied du feu ») : un corps dont la crête
     * est SOUS la flamme n'a pas de dessus sous le ciel, il est PLAT — la flamme le domine, il prend le
     * feu comme le sol qu'il borde. Au-dessus de la clôture (8), sous la palissade (24) et le mur (32).
     *
     * Redite ici plutôt qu'importée (`dynamic-lighting` tire toute la scène) ; deux gardes la tiennent :
     * `sol-du-corps.test.ts` l'égale au feu de l'oracle ratifié (`p16-nuit-grilles.json`, z = 9,6), et
     * `snapshot-view` avertit en dev si la lumière élue comme feu n'est pas à cette hauteur-là.
     */
    HAUTEUR_FLAMME_PX: 9.6,
    /**
     * L'ÉLOIGNEMENT DE L'ASTRE, en px monde — `SUN_FAR` de `dynamic-lighting.ts` (2 200 : « grand =
     * quasi directionnel »). L'astre qu'un corps voit n'est PAS une lumière élue : c'est l'astre
     * VIRTUEL du relais soleil → lune, à `cx − deriveOmbre × ASTRE_LOIN_PX` — la même dérive que l'ombre
     * au sol (`deriveDOmbre`, qui fond les deux astres au prorata de leur plein). MESURÉ le 2026-09-18
     * (`__gi-astre.mjs`, balayage du soir par dixièmes d'heure) : élire « le plus intense des deux »
     * faisait sauter la part d'astre d'une face est-ouest de 45 niveaux sur 255 en un pas, à 19,7 h,
     * quand la lune prenait le soleil — l'ombre au sol, elle, relayait en continu.
     *
     * Redite plutôt qu'importée, comme `HAUTEUR_FLAMME_PX` ; la garde est `sol-du-corps.test.ts`, qui
     * la lit dans la source de `dynamic-lighting.ts`.
     */
    ASTRE_LOIN_PX: 2200,
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
 * LG-R9 — LA HAUTEUR D'UNE BANDE, en px, par pièce de la sim : ce qu'elle lance comme ombre d'astre.
 * Les hauteurs sont celles des CORPS (`GI.CORPS.HAUTEUR_PAR_FAMILLE`, gardées égales à `EDGE_SPRITE`
 * famille par famille), lues par le NOM de la pièce — `wall`, `door` et `palissade` sont aussi des
 * familles de sprite, à la hauteur de leur crête. Une pièce inconnue retombe sur le mur ; la garde
 * « toute pièce que la sim met en bande a sa hauteur » de `champ-ref.test.ts` refuse qu'une pièce de
 * `BATI_OPAQUE` y tombe — sinon une pièce neuve lancerait 32 px en silence.
 */
export function hauteurDeBande(type: string): number {
  return GI.CORPS.HAUTEUR_PAR_FAMILLE[type] ?? GI.ASTRE.HAUTEUR_MUR_PX
}

/**
 * LG-R6 — LA FORCE D'UNE SOURCE DE FEU DANS LE CHAMP : l'engagement de son village (|warmth| / 100,
 * borné à 1 — la lecture de `fireGlow`) et le souffle de sa flamme (`beat`, le battement de l'alpha
 * du halo, `fireGlow().beat` — même graine, même instant que la flamme et la flaque), chacun par la
 * loi d'aujourd'hui (`GI.FEU`). La portée n'en sait rien : elle se donne à côté, et `SourceGi` n'a
 * pas de champ d'engagement (LG-A7). `respire` : l'axe « respiration » du rendu — éteint, le trou
 * d'aujourd'hui ne bat pas, la force non plus.
 */
export function forceDuFeuGi(warmth: number, beat: number, respire: boolean): number {
  const engage = Math.min(1, Math.abs(warmth) / 100)
  const souffle = respire ? 1 + (beat - 1) * GI.FEU.SOUFFLE : 1
  return (1 + GI.FEU.ENGAGEMENT * engage) * souffle
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
