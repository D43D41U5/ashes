/**
 * ═══ LA MESURE D'UN ARBRE — LA SOURCE UNIQUE ═══
 *
 * Avant ce module, la hauteur d'un arbre n'existait dans aucune variable : elle était la SOMME
 * de trois nombres posés dans deux fichiers — la hauteur du fût et celle du houppier dans
 * `BootScene`, l'ancrage `py − 16` dans `snapshot-view`. `22 + 32 − 16 = 48`. Personne ne
 * l'affirmait, rien ne la gardait, et elle avait déjà dérivé : ce `py − 16` servait aux DEUX
 * arbres alors que leurs fûts n'ont pas la même hauteur, si bien que le houppier mordait 6 px
 * sur le tronc de l'arbre et 8 px sur celui du gros bois — pendant que le commentaire du code
 * affirmait 6 pour les deux (relevé au navigateur, `pnpm smoke --scenario echelle`).
 *
 * Le patron existait déjà deux fois dans le client : `ACTOR_FOOTPRINTS` donne à chaque acteur
 * son emprise EN TUILES (spec client R12), et `EDGE_SPRITE` donne à chaque barrière sa hauteur
 * — « la hauteur du mur ne se recopie pas là-bas, elle se lit ici ». Les arbres l'ont enfin.
 *
 * TOUT EN DÉRIVE : la hauteur totale, l'ancrage du houppier, les rects du dessin peint, la
 * silhouette de la variante `_lit`, la colonne que suit la carte de normales — et jusqu'au
 * demi-côté bloquant de `/sim`, que le test de ce module confronte à `NODE_DEFS`. Changer la
 * taille d'un arbre est désormais l'édition d'UN nombre, et non de six.
 *
 * TAILLES ACTÉES (décision d'Alexis, 2026-07-28, « réglage C ») : l'arbre passe à QUATRE tuiles
 * et le gros bois à SIX. L'arbre valait trois tuiles depuis le 2026-07-10 — c'est cette
 * décision-là qui est révisée, et elle l'est explicitement (voir docs/decisions.md).
 */

/** Taille de tuile de l'art. Le module raisonne en pixels monde ; `TILE_PX` les convertit. */
import { TILE_PX } from './framing'

/** Un rect de dessin : `[x, y, largeur, hauteur]`, dans le repère de sa texture. */
export type Rect = readonly [number, number, number, number]
/** Un rect et son ton. */
export type RectTon = readonly [Rect, string]

export interface MesuresArbre {
  /** Largeur de la TEXTURE du fût (px). Le sprite est centré dessus (origine 0,5 ; 1). */
  futW: number
  /** Hauteur du fût (px), des pieds au sommet. */
  futH: number
  /** Largeur de la COLONNE dessinée du fût (px) — c'est le tronc qu'on voit, et qu'on heurte. */
  colonneW: number
  /** Côté du houppier (px) : il est carré. */
  houppierS: number
  /** De combien le houppier mord sur le sommet du fût (px). */
  recouvrementPx: number
  /**
   * Demi-côté BLOQUANT en sous-tuiles, tel que `/sim` le déclare dans `NODE_DEFS`.
   * Recopié ici pour être CONFRONTÉ, jamais pour être consommé : `/sim` reste la vérité de la
   * collision. Le test du module échoue si les deux divergent.
   */
  demiTroncSub: number
}

/**
 * ═══ LES DEUX ARBRES ═══
 *
 * L'ARBRE (4 tuiles). Fût de 6 px — il faisait 4, élargi sur demande d'Alexis (2026-07-28), et
 * la collision suit : 6 px = 3 sous-tuiles, donc `blockHalfSub` 1,5. C'est le maximum que la
 * borne dure autorise sans toucher au décalage d'origine (`TREE_JITTER_TILES + h ≤ 0,5` →
 * 0,3 + 0,1875 = 0,4875). MESURÉ : la part des paires d'arbres voisins où l'avatar se faufile
 * encore d'est en ouest passe de 50,1 % à 31,3 % (nord-sud, où il n'est profond que de 0,375 :
 * 93 % → 83 %). La forêt se resserre — c'est le prix du tronc épais, et il est assumé.
 *
 * LE GROS BOIS (6 tuiles). Son fût DESSINÉ fait 14 px, mais son cœur bloquant reste celui d'un
 * arbre ordinaire d'avant (`demiTroncSub` 1). DEUX raisons, et aucune n'est un oubli :
 *   • la bande bloquante est testée sur des index ENTIERS de sous-tuile ; le gros bois n'a pas
 *     de décalage d'origine, donc son centre est entier, et un demi-entier lui donnerait une
 *     bande DÉCENTRÉE d'un pixel vers l'est (vérifié). L'arbre, lui, est décalé : sa bande fait
 *     toujours 3 sous-tuiles pleines, quel que soit le décalage ;
 *   • à 30 % de gros bois dans la Vieille Sylve, un cœur d'une demi-tuile rendrait deux voisins
 *     infranchissables (couloir 0,5 < avatar 0,75) et la Sylve deviendrait un labyrinthe.
 * On se faufile donc au pied d'un géant : il domine au-dessus, pas aux chevilles.
 */
export const ARBRES = {
  tree: { futW: 16, futH: 30, colonneW: 6, houppierS: 42, recouvrementPx: 8, demiTroncSub: 1.5 },
  old_tree: { futW: 22, futH: 40, colonneW: 14, houppierS: 64, recouvrementPx: 8, demiTroncSub: 1 },
} as const satisfies Record<string, MesuresArbre>

export type TypeArbre = keyof typeof ARBRES

/** La SILHOUETTE ENTIÈRE, en pixels : des pieds au sommet du houppier. */
export function hauteurPx(m: MesuresArbre): number {
  return m.futH - m.recouvrementPx + m.houppierS
}

/** La même, en tuiles — c'est le nombre qu'on annonce (4 et 6). */
export function hauteurTuiles(m: MesuresArbre): number {
  return hauteurPx(m) / TILE_PX
}

/**
 * DE COMBIEN LE HOUPPIER MONTE AU-DESSUS DES PIEDS, en pixels : son bas, où il faut l'ancrer.
 * C'est ce nombre qui remplace le `py − 16` écrit à la main dans `snapshot-view`.
 */
export function ancrageHouppierPx(m: MesuresArbre): number {
  return m.futH - m.recouvrementPx
}

/** Abscisse de la colonne du fût dans sa texture. Entière par construction (futW − colonneW pair). */
export function colonneX(m: MesuresArbre): number {
  return (m.futW - m.colonneW) / 2
}

/**
 * LE DEMI-CÔTÉ BLOQUANT QUE LA COLONNE APPELLE, en sous-tuiles — la règle qui lie le dessin à
 * la collision. Une sous-tuile vaut `TILE_PX / SUBTILES_PER_TILE` pixels ; le demi-côté est la
 * moitié de la colonne exprimée là-dedans. Le gros bois y DÉROGE, et le déclare (cf. `ARBRES`).
 */
export function demiTroncAppele(m: MesuresArbre, subtilesParTuile: number): number {
  return m.colonneW / (TILE_PX / subtilesParTuile) / 2
}

/* ═══ LE DESSIN ═══════════════════════════════════════════════════════════════
 *
 * Les compositions sont données en FRACTIONS de la taille déclarée : changer un nombre de la
 * table redessine tout, à la même image. Elles reproduisent, à l'arrondi près, les rects que
 * `BootScene` posait à la main — la DA ne change pas, seule l'échelle.
 */

/** `[x, y, w, h]` en fractions, porté à un carré de côté `S`. Les bords sont recollés (x1 − x0). */
function porter(f: Rect, S: number): Rect {
  const x0 = Math.round(f[0] * S), y0 = Math.round(f[1] * S)
  const x1 = Math.round((f[0] + f[2]) * S), y1 = Math.round((f[1] + f[3]) * S)
  return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)]
}

/** Tons d'un houppier, du plus sombre au plus clair : masse, corps, lumière NO, éclat, ombre SE. */
export interface TonsHouppier {
  masse: string
  corps: string
  lumiere: string
  eclat: string
  ombre: string
}

/** Tons d'un fût : corps, arête claire (nord-ouest), arête d'ombre (est), cœur (facultatif). */
export interface TonsFut {
  corps: string
  clair: string
  sombre: string
  coeur?: string
}

/**
 * ═══ LES TONS DES DEUX ARBRES ═══
 *
 * Ils vivent ICI, avec les mesures, et non chez ceux qui peignent. `BootScene` posait les
 * siens, `lit-trees` redéclarait les mêmes pour l'albédo aplati : la garde de palette l'a vu
 * (« une teinte que trois fichiers partagent est un jeton qui s'ignore »). Une seule écriture,
 * et la variante éclairée ne peut plus dériver de la variante peinte.
 *
 * L'arête CLAIRE est le ton de référence des variantes `_lit` : l'albédo y est aplati au niveau
 * ÉCLAIRÉ, pour que la lumière calculée SCULPTE vers le bas au lieu de partir dans le noir.
 */
export const TONS_FUT: TonsFut = { corps: '#4a3620', clair: '#5c4429', sombre: '#38281a' }
export const TONS_HOUPPIER: TonsHouppier = {
  masse: '#18401d', corps: '#1e4d22', lumiere: '#2d6b32', eclat: '#347b3a', ombre: '#143518',
}
/** Le gros bois : même lumière, une famille plus sombre — il ferme le ciel. Et son cœur en bout. */
export const TONS_FUT_VIEUX: TonsFut = { corps: '#3f2c19', clair: '#543a22', sombre: '#2a1c0f', coeur: '#a8865c' }
export const TONS_HOUPPIER_VIEUX: TonsHouppier = {
  masse: '#0d2413', corps: '#12321a', lumiere: '#1d4a26', eclat: '#245c30', ombre: '#081c0e',
}

/** La composition d'un houppier, en fractions de son côté. Propre à chaque arbre : c'est sa DA. */
const COMPO_HOUPPIER: Record<TypeArbre, readonly [Rect, Rect, Rect, Rect, Rect]> = {
  // L'arbre : les cinq rects d'origine (32 px) ramenés en fractions.
  tree: [
    [0.125, 0.1875, 0.75, 0.6875],
    [0.1875, 0.125, 0.625, 0.6875],
    [0.25, 0.1875, 0.34375, 0.28125],
    [0.28125, 0.21875, 0.15625, 0.125],
    [0.5625, 0.625, 0.25, 0.1875],
  ],
  // Le gros bois : les siens (40 px). Plus trapu, et sa masse mord plus bas — il ferme le ciel.
  old_tree: [
    [0.1, 0.2, 0.8, 0.7],
    [0.15, 0.125, 0.7, 0.75],
    [0.225, 0.2, 0.35, 0.3],
    [0.275, 0.25, 0.15, 0.125],
    [0.6, 0.65, 0.25, 0.2],
  ],
}

/** Les cinq rects PEINTS d'un houppier, dans l'ordre de dessin (du fond vers la lumière). */
export function houppierRects(t: TypeArbre, tons: TonsHouppier): RectTon[] {
  const S = ARBRES[t].houppierS
  const c = COMPO_HOUPPIER[t]
  return [
    [porter(c[0], S), tons.masse],
    [porter(c[1], S), tons.corps],
    [porter(c[2], S), tons.lumiere],
    [porter(c[3], S), tons.eclat],
    [porter(c[4], S), tons.ombre],
  ]
}

/**
 * LA SILHOUETTE d'un houppier — l'union des DEUX premiers rects peints (masse et corps), et
 * rien d'autre. Elle se DÉDUIT du dessin au lieu d'être redéclarée à côté : `lit-trees` la
 * réécrivait à la main, et deux écritures d'une même forme finissent toujours par différer.
 */
export function houppierOpaque(t: TypeArbre): (x: number, y: number) => boolean {
  const S = ARBRES[t].houppierS
  const c = COMPO_HOUPPIER[t]
  const dans = (r: Rect, x: number, y: number): boolean =>
    x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]
  const a = porter(c[0], S), b = porter(c[1], S)
  return (x, y) => dans(a, x, y) || dans(b, x, y)
}

/**
 * Les rects PEINTS d'un fût : la colonne, son arête claire à l'ouest, son arête d'ombre à l'est,
 * et pour le vieux bois son cœur en bout. Les proportions d'arêtes (0,4 et 0,22 de la colonne)
 * rendent EXACTEMENT les largeurs d'origine sur les deux arbres — 2 et 1 px sur une colonne de
 * 4, 4 et 2 sur une colonne de 10.
 */
export function futRects(t: TypeArbre, tons: TonsFut): RectTon[] {
  const m = ARBRES[t]
  const x = colonneX(m)
  const clair = Math.round(m.colonneW * 0.4)
  const sombre = Math.round(m.colonneW * 0.22)
  const out: RectTon[] = [
    [[x, 0, m.colonneW, m.futH], tons.corps],
    [[x, 0, clair, m.futH], tons.clair],
    [[x + m.colonneW - sombre, 0, sombre, m.futH], tons.sombre],
  ]
  // LE CŒUR EN BOUT : on voit qu'il est VIEUX. Posé à la même hauteur relative qu'à l'origine.
  if (tons.coeur !== undefined) {
    const y = Math.round(m.futH * 0.125)
    out.push([[x + 2, y, m.colonneW - 4, Math.max(2, Math.round(m.futH * 0.08))], tons.coeur])
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * ═══ LES VARIANTES — plusieurs arbres par famille, pour qu'un bois cesse d'être une grille ═══
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * *Demande d'Alexis, 2026-07-29, après l'artefact de proposition : « implémente toutes les
 * variations en prenant en compte une densité logique de tel ou tel arbre par zone ».*
 *
 * AJOUT STRICTEMENT ADDITIF. Tout ce qui précède est intact — `ARBRES`, `COMPO_HOUPPIER`,
 * `houppierRects`, `houppierOpaque` gardent leur signature et leur comportement au pixel près.
 * La généralisation ci-dessous les REDÉFINIT en termes de variantes, et la table `VARIANTES`
 * reprend `tree` et `old_tree` avec exactement leurs rects et leurs tons d'origine.
 *
 * ═══ CE QUE LE RENDU A IMPOSÉ, et qu'aucun raisonnement n'aurait donné ═══
 *
 * ① **EN JEU, SEULES LA SILHOUETTE ET LE FÛT PORTENT LA VARIATION.** `crownAlbedo` (lit-trees)
 *    ne garde que l'union des rects de silhouette, à UN ton plat : la lumière, l'éclat et
 *    l'ombre peints sont JETÉS par la variante `_lit`, qui est le rendu par défaut. Des
 *    variantes qui ne diffèrent que par leur ombrage peint sont identiques en jeu. D'où des
 *    PROPORTIONS franchement différentes (haute et étroite, large et basse, petite et haut
 *    perchée) et un FÛT PÂLE pour le bouleau — la variation la moins chère et la plus visible.
 *
 * ② **LA SILHOUETTE DOIT DESCENDRE JUSQU'À `(houppierS − recouvrementPx) / houppierS`.**
 *    En deçà, le feuillage s'arrête AU-DESSUS du sommet du fût et le houppier FLOTTE — un
 *    liseré de vide entre les deux. Le premier bouleau le faisait (1,5 px de trou) : ni le
 *    compilateur ni les gardes existantes ne le voient, seule l'image le dit. C'est un
 *    invariant DÉRIVABLE, et `arbre-variantes.test.ts` l'affirme désormais sur TOUTES les
 *    variantes, `tree` et `old_tree` compris.
 *
 * ③ **DEUX ÉTAGES NE FONT PAS UN CONIFÈRE.** La première proposition tenait dans les cinq
 *    rects existants (silhouette = les deux premiers) : elle sortait en CHAMPIGNON, un chapeau
 *    étroit sur un socle large. D'où `silhouette: number` — la forme prend autant de rects
 *    qu'il lui en faut, et l'ombrage peint vient après.
 *
 * ═══ CE QUI N'EST PAS TOUCHÉ, ET POURQUOI ═══
 *
 * Une variante est une PEAU du nœud qu'elle habille, jamais un nœud. `/sim` ne sait pas
 * qu'elles existent : rien dans `NODE_DEFS`, rien dans le protocole, rien dans le flux RNG.
 * C'est ce qui permet à E3 (`ARBRES[t].demiTroncSub === NODE_DEFS[t].blockHalfSub`, balayé sur
 * CHAQUE clé de `ARBRES`) de rester vrai : les variantes vivent dans `VARIANTES`, pas dans
 * `ARBRES`. Elles déclarent toutes la collision de l'arbre qu'elles habillent — et une garde
 * l'affirme, plutôt que de le laisser à la bonne volonté.
 */

/** Une variante dessinable : des mesures, une composition, des tons. */
export interface VarianteArbre {
  slug: string
  /** Le type de NŒUD qu'elle habille — c'est lui qui porte la collision et la récolte. */
  noeud: TypeArbre
  mesures: MesuresArbre
  /** Les rects, en fractions. Les `silhouette` premiers font la FORME ; les suivants sont
   *  l'ombrage peint, que l'albédo `_lit` jette. */
  compo: readonly Rect[]
  /** Combien des premiers rects composent la silhouette. 2 pour un feuillu, 4-5 pour un conifère. */
  silhouette: number
  tons: TonsHouppier
  fut: TonsFut
}

/** Le fût pâle du bouleau — sa signature, et la variation la plus lisible de toute la table. */
export const TONS_FUT_PALE: TonsFut = { corps: '#9a9484', clair: '#bdb7a4', sombre: '#6e6a5c' }
/** Le fût du saule : plus bas, plus noir. */
export const TONS_FUT_SOMBRE: TonsFut = { corps: '#3a2a1c', clair: '#4a3624', sombre: '#281c12' }
/** Le fût des conifères — plus rouge et plus sec que celui des feuillus. */
export const TONS_FUT_CONIFERE: TonsFut = { corps: '#3d2b1c', clair: '#4e3823', sombre: '#2c1e13' }

/** Les familles de houppier. Même famille, sous-teintes : le vert ne doit pas se disperser.
 *  C'est le ton `lumiere` qui devient l'albédo éclairé — c'est donc LUI qu'on voit en jeu. */
export const TONS_HETRE: TonsHouppier = { masse: '#153a24', corps: '#1a462b', lumiere: '#26603c', eclat: '#2d7046', ombre: '#112e1c' }
export const TONS_SAULE: TonsHouppier = { masse: '#1b3e18', corps: '#224a1d', lumiere: '#35692e', eclat: '#3e7a35', ombre: '#152f13' }
export const TONS_BOULEAU: TonsHouppier = { masse: '#294f26', corps: '#32602e', lumiere: '#4a8341', eclat: '#57964c', ombre: '#1f3d1d' }
export const TONS_BALIVEAU: TonsHouppier = { masse: '#1c4423', corps: '#235229', lumiere: '#337038', eclat: '#3c8041', ombre: '#163619' }
/**
 * TROIS FAMILLES DE CONIFÈRE, ET C'EST UNE CORRECTION, PAS UN RAFFINEMENT.
 *
 * La première écriture donnait le MÊME ton aux trois pins. Vu dans le jeu (constat d'Alexis,
 * « les pins ont un rendu pas ouf ») : deux voisins d'un même vert plat n'ont aucune frontière —
 * l'albédo `_lit` est UNIFORME, il n'y a ni liseré ni ombrage pour séparer deux cimes qui se
 * touchent. Un bosquet se soudait en NAPPE. Un ton par variante, et la lisière revient.
 */
export const TONS_PIN: TonsHouppier = { masse: '#12331a', corps: '#1a4423', lumiere: '#2b6634', eclat: '#317239', ombre: '#0c2513' }
/** Le vieux pin : une famille plus sombre — il a fermé son couvert depuis longtemps. */
export const TONS_VIEUX_PIN: TonsHouppier = { masse: '#0d2715', corps: '#13351c', lumiere: '#1e4d27', eclat: '#245c2f', ombre: '#081b0f' }
/** Le sapin jeune : plus clair et plus vif — l'aiguille neuve prend la lumière. */
export const TONS_SAPIN: TonsHouppier = { masse: '#1a3f24', corps: '#23522e', lumiere: '#38753f', eclat: '#428a4a', ombre: '#122d19' }
export const TONS_MELEZE: TonsHouppier = { masse: '#3a4a1e', corps: '#4a5c26', lumiere: '#647a35', eclat: '#758c3e', ombre: '#283514' }

/** Les boîtes. Chacune fait 64 px (4 tuiles), 80 (5) ou 48 (3) : c'est la RÉPARTITION entre le
 *  fût et le houppier qui varie, jamais la hauteur totale — E1 exige un compte entier de tuiles. */
const B_HETRE: MesuresArbre = { futW: 16, futH: 26, colonneW: 6, houppierS: 46, recouvrementPx: 8, demiTroncSub: 1.5 }
const B_SAULE: MesuresArbre = { futW: 16, futH: 36, colonneW: 6, houppierS: 40, recouvrementPx: 12, demiTroncSub: 1.5 }
const B_BOULEAU: MesuresArbre = { futW: 16, futH: 44, colonneW: 6, houppierS: 34, recouvrementPx: 14, demiTroncSub: 1.5 }
const B_BALIVEAU: MesuresArbre = { futW: 16, futH: 22, colonneW: 6, houppierS: 34, recouvrementPx: 8, demiTroncSub: 1.5 }
/** Le conifère : 5 tuiles, et son fût NU ne fait qu'une tuile — un conifère porte bas. */
const B_CONIFERE: MesuresArbre = { futW: 16, futH: 30, colonneW: 6, houppierS: 64, recouvrementPx: 14, demiTroncSub: 1.5 }

/**
 * LA TABLE DES VARIANTES. `tree` et `old_tree` y figurent avec leurs rects et leurs tons
 * d'origine : c'est la MÊME écriture qui sert aux deux chemins, donc ils ne peuvent pas diverger.
 */
export const VARIANTES: Record<string, VarianteArbre> = {
  // ── LES FEUILLUS ────────────────────────────────────────────────────────────────────────
  tree: {
    slug: 'tree', noeud: 'tree', mesures: ARBRES.tree, silhouette: 2,
    compo: COMPO_HOUPPIER.tree, tons: TONS_HOUPPIER, fut: TONS_FUT,
  },
  old_tree: {
    slug: 'old_tree', noeud: 'old_tree', mesures: ARBRES.old_tree, silhouette: 2,
    compo: COMPO_HOUPPIER.old_tree, tons: TONS_HOUPPIER_VIEUX, fut: TONS_FUT_VIEUX,
  },
  // LE HÊTRE — une COLONNE de feuillage : il monte au lieu de s'étaler.
  hetre: {
    slug: 'hetre', noeud: 'tree', mesures: B_HETRE, silhouette: 2,
    compo: [
      [0.26, 0.04, 0.48, 0.80], [0.16, 0.22, 0.68, 0.56],
      [0.30, 0.12, 0.22, 0.34], [0.33, 0.16, 0.10, 0.14], [0.58, 0.56, 0.20, 0.26],
    ],
    tons: TONS_HETRE, fut: TONS_FUT,
  },
  // LE SAULE — l'inverse exact : large et BAS, presque plus large que haut. Il pèse.
  saule: {
    slug: 'saule', noeud: 'tree', mesures: B_SAULE, silhouette: 2,
    compo: [
      [0.04, 0.32, 0.92, 0.56], [0.14, 0.16, 0.72, 0.54],
      [0.22, 0.26, 0.30, 0.26], [0.25, 0.30, 0.14, 0.12], [0.62, 0.60, 0.26, 0.22],
    ],
    tons: TONS_SAULE, fut: TONS_FUT_SOMBRE,
  },
  // LE BOULEAU — petit houppier haut perché sur un long fût PÂLE. C'est le fût qui le signe.
  bouleau: {
    slug: 'bouleau', noeud: 'tree', mesures: B_BOULEAU, silhouette: 2,
    compo: [
      [0.14, 0.10, 0.72, 0.62], [0.22, 0.02, 0.56, 0.62],
      [0.28, 0.14, 0.24, 0.26], [0.31, 0.18, 0.11, 0.12], [0.58, 0.50, 0.22, 0.22],
    ],
    tons: TONS_BOULEAU, fut: TONS_FUT_PALE,
  },
  // LE BALIVEAU (3 tuiles) — étroit et dense. Pas un arbre rétréci : il remplit le sous-bois.
  baliveau: {
    slug: 'baliveau', noeud: 'tree', mesures: B_BALIVEAU, silhouette: 2,
    compo: [
      [0.26, 0.06, 0.48, 0.78], [0.16, 0.26, 0.68, 0.52],
      [0.32, 0.16, 0.22, 0.30], [0.35, 0.20, 0.10, 0.13], [0.58, 0.58, 0.20, 0.24],
    ],
    tons: TONS_BALIVEAU, fut: TONS_FUT,
  },

  // ── LES CONIFÈRES — quatre étages, et ils SE CHEVAUCHENT en y ───────────────────────────
  //
  // Le chevauchement n'est pas cosmétique : à étages disjoints la silhouette s'îlote, la
  // normale se dérive par bandes séparées (des bourrelets horizontaux) et l'on voit le sol au
  // travers de l'arbre. Chaque étage mord donc sur le précédent.
  pin: {
    slug: 'pin', noeud: 'tree', mesures: B_CONIFERE, silhouette: 4,
    compo: [
      [0.27, 0.76, 0.46, 0.22], [0.31, 0.54, 0.38, 0.24], [0.36, 0.32, 0.28, 0.24], [0.42, 0.06, 0.16, 0.28],
      [0.36, 0.36, 0.07, 0.40], [0.37, 0.40, 0.04, 0.14], [0.56, 0.62, 0.11, 0.26],
    ],
    tons: TONS_PIN, fut: TONS_FUT_CONIFERE,
  },
  // LE VIEUX PIN — la cime a perdu sa flèche, les étages bas débordent d'un côté. C'est LUI qui
  // casse la répétition dans un bosquet, bien plus qu'une différence de taille.
  vieux_pin: {
    slug: 'vieux_pin', noeud: 'tree', mesures: B_CONIFERE, silhouette: 4,
    compo: [
      [0.24, 0.76, 0.50, 0.22], [0.29, 0.55, 0.40, 0.23], [0.33, 0.34, 0.30, 0.23], [0.36, 0.16, 0.24, 0.20],
      [0.34, 0.38, 0.07, 0.38], [0.35, 0.42, 0.04, 0.13], [0.56, 0.60, 0.12, 0.26],
    ],
    tons: TONS_VIEUX_PIN, fut: TONS_FUT_CONIFERE,
  },
  // LE SAPIN JEUNE — étroit et dense, presque une flèche : il aère un bosquet.
  sapin: {
    slug: 'sapin', noeud: 'tree', mesures: B_CONIFERE, silhouette: 4,
    compo: [
      [0.34, 0.78, 0.32, 0.20], [0.37, 0.56, 0.26, 0.24], [0.41, 0.32, 0.18, 0.26], [0.45, 0.06, 0.10, 0.28],
      [0.41, 0.36, 0.05, 0.40], [0.42, 0.40, 0.03, 0.14], [0.55, 0.64, 0.08, 0.24],
    ],
    tons: TONS_SAPIN, fut: TONS_FUT_CONIFERE,
  },
  // LE MÉLÈZE — cinq étages plus MINCES et plus écartés, et une famille olive : le bois clair.
  meleze: {
    slug: 'meleze', noeud: 'tree', mesures: B_CONIFERE, silhouette: 5,
    compo: [
      [0.29, 0.80, 0.42, 0.16], [0.33, 0.60, 0.34, 0.22], [0.38, 0.40, 0.24, 0.22],
      [0.42, 0.19, 0.16, 0.23], [0.45, 0.03, 0.10, 0.18],
      [0.39, 0.26, 0.06, 0.46], [0.40, 0.32, 0.03, 0.16], [0.56, 0.66, 0.10, 0.22],
    ],
    tons: TONS_MELEZE, fut: TONS_FUT_CONIFERE,
  },
}

/** Toutes les variantes, dans un ordre stable (celui de la table). */
export const TOUTES_VARIANTES: readonly VarianteArbre[] = Object.values(VARIANTES)

/**
 * LES RECTS PEINTS d'une variante, dans l'ordre de dessin (du fond vers la lumière).
 *
 * L'ORDRE DES TONS EST DÉRIVÉ, PAS ÉCRIT : les rects de silhouette alternent masse/corps (du
 * bas vers la cime — le bas est dans l'ombre du reste), puis viennent lumière, éclat, ombre.
 * À `silhouette: 2` cela rend EXACTEMENT `[masse, corps, lumière, éclat, ombre]`, l'ordre
 * historique : la généralisation est rétro-compatible par construction, pas par précaution.
 */
export function houppierRectsDe(v: VarianteArbre, tons: TonsHouppier = v.tons): RectTon[] {
  const S = v.mesures.houppierS
  const apres = [tons.lumiere, tons.eclat, tons.ombre]
  return v.compo.map((f, i) => {
    const ton = i < v.silhouette
      ? (i % 2 === 0 ? tons.masse : tons.corps)
      : (apres[i - v.silhouette] ?? tons.ombre)
    return [porter(f, S), ton] as RectTon
  })
}

/** LA SILHOUETTE d'une variante — l'union de ses `silhouette` premiers rects, et rien d'autre.
 *  Déduite du dessin, comme `houppierOpaque` : deux écritures d'une même forme divergent. */
export function houppierOpaqueDe(v: VarianteArbre): (x: number, y: number) => boolean {
  const S = v.mesures.houppierS
  const rects = v.compo.slice(0, v.silhouette).map((f) => porter(f, S))
  return (x, y) => rects.some((r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3])
}

/**
 * JUSQU'OÙ LA SILHOUETTE DESCEND dans sa boîte, en pixels depuis le haut — et le SEUIL qu'elle
 * doit atteindre pour que le houppier repose sur le fût au lieu de flotter au-dessus.
 * Rendu en paire pour que la garde affirme l'écart, pas seulement le verdict.
 */
export function assiseHouppier(v: VarianteArbre): { bas: number; requis: number } {
  const S = v.mesures.houppierS
  let bas = 0
  for (const f of v.compo.slice(0, v.silhouette)) {
    const r = porter(f, S)
    if (r[1] + r[3] > bas) bas = r[1] + r[3]
  }
  return { bas, requis: S - v.mesures.recouvrementPx }
}

/**
 * Les rects PEINTS du fût d'une variante. Même géométrie que `futRects` (arêtes à 0,4 et 0,22 de
 * la colonne, cœur en bout quand la famille en déclare un) — mais lue sur la variante, pour que
 * le bouleau ait son fût pâle et le saule le sien sans qu'aucun appelant ne le sache.
 */
export function futRectsDe(v: VarianteArbre): RectTon[] {
  const m = v.mesures
  const tons = v.fut
  const x = colonneX(m)
  const clair = Math.round(m.colonneW * 0.4)
  const sombre = Math.round(m.colonneW * 0.22)
  const out: RectTon[] = [
    [[x, 0, m.colonneW, m.futH], tons.corps],
    [[x, 0, clair, m.futH], tons.clair],
    [[x + m.colonneW - sombre, 0, sombre, m.futH], tons.sombre],
  ]
  if (tons.coeur !== undefined) {
    const y = Math.round(m.futH * 0.125)
    out.push([[x + 2, y, m.colonneW - 4, Math.max(2, Math.round(m.futH * 0.08))], tons.coeur])
  }
  return out
}
