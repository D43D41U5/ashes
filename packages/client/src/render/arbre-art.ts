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
import { ecorceDe } from './ecorce'
import { teinterFamille, type TeinteSaison } from './teinte-saison'

/** Un rect de dessin : `[x, y, largeur, hauteur]`, dans le repère de sa texture. */
export type Rect = readonly [number, number, number, number]
/** Un rect et son ton. */
export type RectTon = readonly [Rect, string]

export interface MesuresArbre {
  /** Largeur de la TEXTURE du fût (px). Le sprite est centré dessus (origine 0,5 ; 1). */
  futW: number
  /** Hauteur du fût (px), des pieds au sommet. */
  futH: number
  /** Largeur de la COLONNE dessinée du fût (px) — le tronc qu'on voit MONTER. Ce n'est plus ce
   *  qu'on heurte depuis le 2026-08-31 : voir `empattementW`. */
  colonneW: number
  /**
   * L'EMPATTEMENT (px) — la largeur de la collerette de racines au SOL, et donc EXACTEMENT ce
   * que l'arbre bloque (`demiTroncSub`, confronté à `/sim` par le test E3).
   *
   * IL EXISTE PARCE QUE LES DEUX NE PEUVENT PAS ÊTRE LE MÊME NOMBRE. L'obstacle doit faire
   * 12 px — c'est le minimum qui garantit que deux arbres voisins ne laissent jamais passer
   * (écart 0,25 tuile, sous les 0,375 de profondeur du corps). Mais 12 px de colonne sur un
   * arbre de 64 donnent un rapport de 1/5,3 quand un arbre réel tient entre 1/15 et 1/30 :
   * « les troncs sont disproportionnés entre leur épaisseur et leur hauteur » (Alexis, à
   * l'écran, 2026-08-31 — c'était une colonnade, pas un bois).
   *
   * La résolution est botanique autant que graphique : ce qu'on ne peut pas franchir, c'est la
   * BASE. Le fût monte mince (`colonneW`), et l'empattement se lit AU SOL — porté par la flaque
   * de contact, qui est de toute façon le seul repère posé à terre (le houppier fait 42 px et
   * ne peut pas rétrécir ; le fût est un billboard debout). `snapshot-view` dimensionne donc la
   * flaque d'un arbre sur CE nombre, et non plus sur le cadre de son sprite.
   *
   * INVARIANT : `colonneW ≤ empattementW` — un fût ne surplombe pas ses racines (testé).
   */
  empattementW: number
  /**
   * HAUTEUR de l'empattement (px) — sur combien de rangées, au pied du fût, la collerette
   * s'évase de `colonneW` jusqu'à `empattementW`.
   *
   * ELLE EXISTE PARCE QUE LA FLAQUE NE SUFFISAIT PAS. Le premier jet laissait l'ombre de contact
   * porter seule les 12 px : à l'écran, sous une canopée, une ellipse noire à 0,42 d'alpha ne
   * fait pas une FORME qu'on lit — le tronc dessiné (6 px) sous-estimait alors l'obstacle d'un
   * facteur deux, et Alexis l'a relevé deux fois (« les troncs alignés gênent toujours la
   * lisibilité de là où est leur hitbox »). Ce qui bloque doit être DESSINÉ, pas suggéré.
   *
   * Et elle répare la seconde plainte du même coup : des fûts tous identiques, tous au centre de
   * leur tuile, ne donnaient à l'œil aucune prise au SOL — là où l'on regarde quand on se
   * faufile. L'évasement rend au pied une silhouette large et étagée, à l'endroit exact du
   * verdict.
   */
  empattementH: number
  /**
   * HAUTEUR du houppier (px). C'est elle qui entre dans la hauteur totale.
   *
   * Elle s'appelait « côté » quand la boîte était forcément CARRÉE. Elle ne l'est plus :
   * `houppierW` permet une cime plus large que haute (le saule, le parasol du vieux pin). Le nom
   * reste `houppierS` pour ne pas renommer un champ que six fichiers lisent — mais il désigne la
   * hauteur, et `houppierLargeur()` donne l'autre côté.
   */
  houppierS: number
  /**
   * LARGEUR du houppier (px), si elle diffère de la hauteur. Absente = boîte carrée, le cas de
   * la plupart des arbres.
   *
   * POURQUOI ELLE EXISTE : une boîte carrée plafonne la largeur d'une cime à la hauteur qui
   * reste une fois le fût posé, soit ~0,81 × la hauteur de l'arbre. Or un saule blanc est
   * MESURÉ à 1,15 fois sa hauteur (relevé photographique du 2026-07-29), et un vieux pin
   * sylvestre porte un parasol plus large que long. Deux formes que la boîte carrée rendait
   * inatteignables — pas « difficiles » : impossibles.
   */
  houppierW?: number
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
 * ═══ LA COLONNE EST L'OBSTACLE, ET C'EST TOUT LE SUJET (2026-08-31) ═══
 *
 * `colonneW` **12 px** sur TOUS les arbres, `demiTroncSub` **3** — et les deux disent la même
 * chose parce qu'un test les confronte (E3). Ils faisaient 6 px et 1,5 jusqu'ici, et 14 px pour
 * un cœur de 4 sur le gros bois : c'est ce dernier écart qui a été relevé en playtest (« je ne
 * vois pas bien où sont les troncs »).
 *
 * POURQUOI 12 ET PAS 6. Le nombre ne vient pas d'une proportion d'arbre, il vient du CORPS :
 * deux arbres voisins doivent laisser un écart qui ne se DISCUTE pas. À 12 px l'écart vaut
 * 0,25 tuile — sous les 0,375 de profondeur du corps comme sous ses 0,75 de largeur, donc
 * jamais franchissable, sur les deux axes. À 6 px il valait 0,625 pour un corps de 0,75 : trop
 * étroit en principe, ouvert en pratique une fois sur trois par un décalage qu'on ne voyait
 * pas. Un tronc gras n'est pas un choix de dessin ici, c'est la seule largeur qui rend le
 * verdict lisible. Voir `NODE_DEFS.tree` pour la mesure complète.
 *
 * ET LE DÉCALAGE D'ORIGINE A QUITTÉ LE FÛT : il ne bouge plus que le HOUPPIER
 * (`TREE_JITTER_TILES`). Le fût, sa flaque de contact et sa bande bloquante sont au centre de
 * leur tuile — c'est ce qui permet à l'œil de lire l'obstacle sur la grille.
 *
 * LE GROS BOIS (6 tuiles) rejoint la règle : 14 → 12 px de colonne, cœur 1 → 3. Sa dérogation
 * (« on se faufile au pied d'un géant ») disait qu'il bloquait moins qu'il ne paraissait ; à
 * 30 % de la Vieille Sylve, c'était le pire endroit du jeu pour ne pas croire ses yeux. Il
 * reste un géant par tout le reste : fût de 22 px de cadre, 40 px de haut, cime de 64.
 */
export const ARBRES = {
  tree: { futW: 16, futH: 30, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 42, recouvrementPx: 8, demiTroncSub: 3 },
  old_tree: { futW: 22, futH: 40, colonneW: 10, empattementW: 12, empattementH: 5, houppierS: 64, recouvrementPx: 8, demiTroncSub: 3 },
} as const satisfies Record<string, MesuresArbre>

export type TypeArbre = keyof typeof ARBRES

/** LARGEUR de la boîte du houppier : `houppierW` si elle est déclarée, sinon la hauteur (carré). */
export function houppierLargeur(m: MesuresArbre): number {
  return m.houppierW ?? m.houppierS
}

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

/**
 * ═══ LES RANGÉES DE L'EMPATTEMENT — une seule écriture pour les DEUX chemins de rendu ═══
 *
 * Rend, du BAS vers le haut, la demi-extension (en px) de la collerette au-delà de la colonne.
 * `[3, 2, 2, 1, 1]` sur l'arbre : la rangée du sol fait `colonneW + 2×3 = 12` px — exactement le
 * carré bloquant — puis la collerette se resserre en escalier jusqu'au fût.
 *
 * PURE ET PARTAGÉE, et ce n'est pas du rangement : `futRects` (chemin peint) et `lit-trees`
 * (chemin éclairé, celui qu'on voit) doivent dessiner LA MÊME base au pixel près. Deux écritures
 * d'une même forme finissent toujours par différer — c'est la leçon que la silhouette `_lit` a
 * déjà coûtée une fois (2026-07-28), et ici l'écart se paierait en hitbox qui ment.
 */
export function empattementRangs(m: MesuresArbre): number[] {
  const demi = (m.empattementW - m.colonneW) / 2
  if (demi <= 0 || m.empattementH <= 0) return []
  const rangs: number[] = []
  for (let k = 0; k < m.empattementH; k++) {
    // Décroissance linéaire du bas vers le haut, ARRONDIE : la rangée du sol porte la pleine
    // extension (donc la vérité de la collision), la dernière n'en garde qu'un pixel.
    rangs.push(Math.max(1, Math.round(demi * (1 - k / m.empattementH))))
  }
  return rangs
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
  return m.empattementW / (TILE_PX / subtilesParTuile) / 2
}

/* ═══ LE DESSIN ═══════════════════════════════════════════════════════════════
 *
 * Les compositions sont données en FRACTIONS de la taille déclarée : changer un nombre de la
 * table redessine tout, à la même image. Elles reproduisent, à l'arrondi près, les rects que
 * `BootScene` posait à la main — la DA ne change pas, seule l'échelle.
 */

/**
 * `[x, y, w, h]` en fractions, porté à une boîte de `W` × `H`. Les bords sont recollés (x1 − x0).
 *
 * `H` vaut `W` par défaut : c'est le cas carré, et il rend EXACTEMENT ce que rendait l'ancienne
 * signature à un seul côté — la généralisation ne déplace pas un pixel des arbres existants.
 */
function porter(f: Rect, W: number, H: number = W): Rect {
  const x0 = Math.round(f[0] * W), y0 = Math.round(f[1] * H)
  const x1 = Math.round((f[0] + f[2]) * W), y1 = Math.round((f[1] + f[3]) * H)
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
  /**
   * LE TON DE PLAQUE — le haut d'une écaille d'écorce, plus clair que le fond.
   *
   * C'est de la MATIÈRE, pas un ombrage : il reste sur l'albédo aplati de la variante `_lit`, au
   * même titre que le `coeur` du vieux bois. Absent = l'écorce n'a pas de plaque claire (le
   * hêtre est lisse, le chêne n'a que des creux).
   */
  eclat?: string
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
  return futRectsCommuns(ARBRES[t], tons, t === 'old_tree' ? 'old_tree' : 'tree')
}

/**
 * ═══ LES RECTS PEINTS D'UN FÛT — et pourquoi ils ont cessé d'être un cylindre ═══
 *
 * Ils posaient une arête CLAIRE à l'ouest (40 % de la colonne) et une arête d'OMBRE à l'est
 * (22 %) : l'ombrage d'un tube éclairé de trois quarts, peint en dur. C'est exactement le défaut
 * que la carte de normales du `_lit` avait de son côté (`ecorce.ts` le mesure), et le corriger
 * d'un seul côté aurait fait diverger les deux chemins.
 *
 * Le fût peint prend donc le même vocabulaire que l'écorce : des SILLONS verticaux au ton de
 * creux, et une PLAQUE claire. Les deux chemins ne se ressemblent pas au pixel près — l'un est
 * fait de rects, l'autre d'un champ de hauteur — mais ils disent la même chose : un tronc a de
 * l'écorce, pas un dégradé.
 *
 * Le chemin peint reste le repli (éclairage éteint) ; c'est `_lit` qui est à l'écran en partie.
 */
function futRectsCommuns(m: MesuresArbre, tons: TonsFut, slug: string): RectTon[] {
  const e = ecorceDe(slug)
  const x = colonneX(m)
  const out: RectTon[] = [[[x, 0, m.colonneW, m.futH], tons.clair]]

  // LES SILLONS — mêmes abscisses que le relief de `ecorce.ts` : une colonne sur `nSillons + 1`,
  // large d'un pixel. Sur une colonne de 6 px, deux sillons suffisent à dire l'écorce.
  if (e.sillons > 0.2) {
    const pas = Math.max(2, Math.floor(m.colonneW / (e.nSillons + 1)))
    for (let s = 1; s <= e.nSillons; s++) {
      const px = x + Math.min(m.colonneW - 1, s * pas)
      out.push([[px, 0, 1, m.futH], tons.sombre])
    }
  }
  // LA PLAQUE CLAIRE — une bande verticale sur le pan qui prend la lumière, quand la famille en
  // déclare une (le pin saumon, le bouleau). Le hêtre n'en a pas : son écorce est lisse.
  if (tons.eclat !== undefined && e.plaqueProfondeur > 0.2) {
    out.push([[x, 0, Math.max(1, Math.round(m.colonneW * 0.3)), m.futH], tons.eclat])
  }
  // LE PIED SOMBRE — le bas du fût vire au creux (pin sylvestre, bouleau). Matière, pas ombre.
  if (e.piedSombre > 0) {
    const h = Math.max(1, Math.round(m.futH * e.piedSombre))
    out.push([[x, m.futH - h, m.colonneW, h], tons.corps])
  }
  // LE CŒUR EN BOUT : on voit qu'il est VIEUX. Posé à la même hauteur relative qu'à l'origine.
  if (tons.coeur !== undefined) {
    const y = Math.round(m.futH * 0.125)
    out.push([[x + 2, y, m.colonneW - 4, Math.max(2, Math.round(m.futH * 0.08))], tons.coeur])
  }
  // ── L'EMPATTEMENT — en DERNIER, donc par-dessus tout le reste : c'est du bois qui vient
  //    DEVANT le fût, pas une bordure qu'on glisse dessous. Ton `corps` : la collerette est à
  //    l'ombre du fût et prend la terre, elle ne brille jamais comme un pan éclairé.
  const rangs = empattementRangs(m)
  for (let k = 0; k < rangs.length; k++) {
    const e = rangs[k]!
    out.push([[x - e, m.futH - 1 - k, m.colonneW + 2 * e, 1], tons.corps])
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

/**
 * Le fût pâle du bouleau — sa signature, et la variation la plus lisible de toute la table.
 * Son `sombre` est presque noir : c'est la LENTICELLE, le tiret horizontal qui le fait
 * reconnaître de loin (cf. `ecorce.ts`), pas une arête d'ombre.
 */
export const TONS_FUT_PALE: TonsFut = { corps: '#9a9484', clair: '#bdb7a4', sombre: '#2a2620', eclat: '#d6d2c2' }
/** Le fût du saule : plus bas, plus noir. */
export const TONS_FUT_SOMBRE: TonsFut = { corps: '#3a2a1c', clair: '#4a3624', sombre: '#281c12', eclat: '#5a4430' }
/** Le fût des conifères SOMBRES (sapin, mélèze) — plus rouge et plus sec que celui des feuillus. */
export const TONS_FUT_CONIFERE: TonsFut = { corps: '#3d2b1c', clair: '#4e3823', sombre: '#2c1e13' }
/**
 * LE FÛT DU PIN SYLVESTRE — saumon, et c'est l'écorce la plus reconnaissable du jeu après celle
 * du bouleau. Les photos (Pinus_sylvestris_bark) montrent de grandes plaques rose-orangé
 * séparées de clefts noirs ; le bas du fût, lui, reste sombre et crevassé (`ecorce.ts` le rend
 * par `piedSombre`). Il se sépare donc du conifère générique, qui garde le brun sec.
 */
export const TONS_FUT_PIN: TonsFut = { corps: '#7a4f34', clair: '#8a5a3c', sombre: '#3a2418', eclat: '#b0784e' }
/**
 * LE FÛT DU HÊTRE — gris lisse, et c'est une correction de FOND, pas une nuance.
 *
 * Le hêtre portait le brun de l'arbre ordinaire, alors que son écorce lisse et grise est
 * exactement ce qui fait qu'on reconnaît une hêtraie (photos de Soignes et du Cansiglio :
 * une colonnade grise). C'est aussi ce qui le sépare du chêne à trois pixels de distance,
 * là où deux silhouettes de feuillus ne se séparent plus.
 */
export const TONS_FUT_GRIS: TonsFut = { corps: '#6d6a63', clair: '#87847b', sombre: '#4c4a45' }

/**
 * ═══ LE BOIS MORT — LA COULEUR D'UN CHICOT (décision d'Alexis, 2026-08-27) ═══
 *
 * *« ok pour les conifères transforme les en chicot gris »* — la cendre prend la tuile, l'arbre
 * s'y dessèche cinq jours (`CENDRE.AGONIE_JOURS`), puis il tombe. Le feuillu disait déjà cette
 * agonie par sa silhouette (il se dénude, G6) ; **le conifère, non** — G6 lui interdit
 * délibérément de perdre sa cime (« la silhouette du conifère dit qu'il tient »), et la promesse
 * de la cendre était donc muette sur un pin. Elle se dit maintenant par la COULEUR.
 *
 * ⚠ **UNE CIBLE CLAIRE, ET C'EST LE FOND QUI LA COMMANDE.** Un chicot se voit sur de la cendre,
 * pas sur de l'herbe : `cendre_bois` est à `#3b3630` (luma 0,21) et `cendre_pre` à `#71695a`.
 * Un gris SOMBRE — le premier réflexe, « du bois brûlé » — disparaîtrait dans son propre sol.
 * C'est le bois d'argent des chandelles sur brûlis : desséché, décoloré, plus PÂLE que l'écorce
 * qu'il remplace. Le fût du sapin (`#3d2b1c`, luma 0,17) est presque invisible sur sa cendre ;
 * mort, il monte à 0,50 et s'en détache franchement.
 *
 * ⚠ **LA CIBLE A ÉTÉ REMONTÉE UNE FOIS** (`#8c857a` → `#a89f92`), et c'est la garde qui l'a
 * exigé, pas l'œil : à l'ancienne valeur, le chicot du mélèze contrastait 0,214 avec sa cendre
 * là où son FEUILLAGE VIVANT en faisait 0,226 — l'arbre mort se voyait moins bien que l'arbre
 * qu'il remplaçait, ce qui vide la mécanique de son sens. L'étalon est le feuillage, pas un
 * nombre : si les tons d'une essence bougent, on refait la mesure.
 */
export const BOIS_MORT: TeinteSaison = { cible: 0xa89f92, force: 0.72 }

/**
 * LES TONS D'UN FÛT MORT — **dérivés de l'essence, jamais posés en dur.**
 *
 * Une palette grise unique aurait lu « mort » sur le sapin et « rien du tout » sur le bouleau,
 * dont le fût est DÉJÀ pâle (`#9a9484`). On fond donc le `corps` vers le bois d'argent et on
 * translate les autres tons du même delta (`teinterFamille`, loi ② du 2026-08-25) : la famille
 * converge vers le gris, ses écarts internes — l'arête claire, la lenticelle du bouleau, le
 * cœur du gros bois — survivent, et la lumière du jeu a encore de quoi sculpter.
 *
 * La force est haute (0,72) et c'est voulu : à la mort, les essences se ressemblent. Ce qui
 * reste de leur identité est leur SILHOUETTE, ce qui est exactement ce que le jeu veut dire.
 */
export function tonsMorts(fut: TonsFut): TonsFut {
  return teinterFamille(fut, BOIS_MORT)
}

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
/**
 * ═══ CE QUE LE RELEVÉ PHOTOGRAPHIQUE DU 2026-07-29 A CHANGÉ ═══
 *
 * Quinze ports d'arbre (l'arbre entier, du pied à la cime) relevés essence par essence, et
 * confrontés à l'ESPACEMENT réel entre troncs, mesuré sur la carte que le jeu génère
 * (`placeZoneNodes`, seed 2026, 34 479 arbres) :
 *
 *   `forest` (ubac) 1,00 tuile · `pine`/`larch` 2,24 · `old_growth` 3,00 · `grass` (pré) 4,12
 *
 * Le relevé a dit deux choses, et la seconde est celle qui structure la table.
 *
 * ① **TROIS ESSENCES SUR DIX ÉTAIENT DÉJÀ JUSTES** — le sapin (21 % de fût nu, largeur 0,25 ;
 *    la photo d'Abies alba donne 15 % et 0,20), le mélèze (24 % / 0,33 ; un mélézein donne
 *    0,35 — le mélèze LARGE et ajouré est le mélèze isolé, que le jeu ne pose jamais) et le
 *    jeune pin. Elles ne bougent pas : la photo les a sauvées d'une « correction ».
 *
 * ② **LE PORT SUIT LA CONCURRENCE, PAS L'ESPÈCE.** Un hêtre de futaie est une colonne sans une
 *    branche sur les deux tiers de sa hauteur ; un hêtre isolé a des branches qui touchent
 *    l'herbe. Même espèce, deux ports. La table variait par espèce et par zone, jamais par
 *    DENSITÉ — d'où le `chene_pre`, forme de plein champ qui ne se pose que sur l'herbe du pré,
 *    le seul terrain (4,12 tuiles) où une cime large ne ferme pas l'écran. Dans l'ubac, à
 *    1 tuile d'écart, il n'y a pas un pixel de marge : `tree` n'y est pas touché.
 */
/** LE HÊTRE DE FUTAIE — 53 % de fût nu contre 39 %, et l'inversion la plus nette du relevé :
 *  il avait le fût le plus COURT des feuillus quand la futaie lui donne le plus LONG. */
const B_HETRE: MesuresArbre = { futW: 16, futH: 48, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 30, recouvrementPx: 14, demiTroncSub: 3 }
/**
 * LE SAULE — cime BASSE et LARGE, là où la boîte carrée plafonnait à 0,56 de la hauteur.
 * La photo de ripisylve donne 1,15 ; on s'arrête à **60 px**, et le nombre n'est pas un goût :
 * c'est un peu moins que les 66 px (4,12 tuiles) qui séparent deux troncs sur l'herbe. Une cime
 * plus large que l'espacement souderait la ripisylve en nappe — le défaut exact qu'on a corrigé
 * sur les pins le 2026-07-29.
 */
const B_SAULE: MesuresArbre = { futW: 16, futH: 24, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 52, houppierW: 60, recouvrementPx: 12, demiTroncSub: 3 }
/** LE BOULEAU — 63 % de fût nu, c'était un bouleau de futaie serrée. Sur un versant brûlé les
 *  tiges sont jeunes : 44 %, et la cime s'élargit d'autant. */
const B_BOULEAU: MesuresArbre = { futW: 16, futH: 38, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 38, recouvrementPx: 12, demiTroncSub: 3 }
/** LE BALIVEAU — une jeune tige n'a pas encore élagué ses branches basses : le feuillage
 *  descend presque au sol (23 % de fût nu contre 40 %). C'est ce qui la distingue d'un arbre
 *  simplement RÉTRÉCI. */
const B_BALIVEAU: MesuresArbre = { futW: 16, futH: 18, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 38, recouvrementPx: 8, demiTroncSub: 3 }
/** Le conifère : 5 tuiles, et son fût NU ne fait qu'une tuile — un conifère porte bas. */
const B_CONIFERE: MesuresArbre = { futW: 16, futH: 30, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 64, recouvrementPx: 14, demiTroncSub: 3 }
/** LE VIEUX PIN — 57 % de fût nu et une cime PLUS LARGE QUE LONGUE : le parasol. Un pin
 *  sylvestre mûr n'est pas un grand jeune pin, c'est une autre silhouette (photos Skuleskogen
 *  et Beinn a' Bhuird : un fût nu sur plus de la moitié, coiffé d'une ombelle plate). */
const B_VIEUX_PIN: MesuresArbre = { futW: 16, futH: 50, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 44, houppierW: 56, recouvrementPx: 14, demiTroncSub: 3 }
/** LE CHÊNE DU PRÉ — la forme de plein champ : fût court (23 %), cime large (0,75 de la
 *  hauteur). Elle n'existe que sur l'herbe, où les troncs sont à 4,12 tuiles l'un de l'autre. */
const B_CHENE_PRE: MesuresArbre = { futW: 16, futH: 26, colonneW: 6, empattementW: 12, empattementH: 5, houppierS: 50, recouvrementPx: 12, demiTroncSub: 3 }

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
  // LE CHÊNE DU PRÉ — la forme de PLEIN CHAMP, et la seule variante que la densité justifie.
  // Fût court, cime large qui descend bas : c'est le chêne isolé des photos (Baginton, Kolare),
  // et il ne se pose que sur l'herbe, à 4,12 tuiles de son voisin.
  chene_pre: {
    slug: 'chene_pre', noeud: 'tree', mesures: B_CHENE_PRE, silhouette: 2,
    compo: [
      [0.02, 0.30, 0.96, 0.68], [0.12, 0.10, 0.76, 0.72],
      [0.20, 0.18, 0.34, 0.30], [0.24, 0.22, 0.15, 0.13], [0.60, 0.62, 0.26, 0.24],
    ],
    tons: TONS_HOUPPIER, fut: TONS_FUT,
  },
  // LE HÊTRE DE FUTAIE — une COLONNE GRISE surmontée d'une cime modeste. C'est la photo de la
  // forêt de Soignes : on voit LOIN sous la voûte, parce que le fût est nu sur plus de la moitié.
  hetre: {
    slug: 'hetre', noeud: 'tree', mesures: B_HETRE, silhouette: 2,
    compo: [
      [0.02, 0.34, 0.96, 0.64], [0.16, 0.04, 0.68, 0.74],
      [0.28, 0.16, 0.24, 0.30], [0.32, 0.20, 0.11, 0.14], [0.58, 0.58, 0.22, 0.26],
    ],
    tons: TONS_HETRE, fut: TONS_FUT_GRIS,
  },
  // LE SAULE — l'inverse exact : large et BAS, plus large que haut. Il pèse.
  saule: {
    slug: 'saule', noeud: 'tree', mesures: B_SAULE, silhouette: 2,
    compo: [
      [0.00, 0.34, 1.00, 0.64], [0.10, 0.12, 0.80, 0.70],
      [0.20, 0.22, 0.32, 0.28], [0.24, 0.26, 0.14, 0.12], [0.62, 0.62, 0.26, 0.24],
    ],
    tons: TONS_SAULE, fut: TONS_FUT_SOMBRE,
  },
  // LE BOULEAU — cime moyenne sur un fût PÂLE, et deux rameaux qui PENDENT de part et d'autre.
  // C'est ce bord irrégulier qu'on reconnaît d'un bouleau à distance, pas sa forme générale :
  // d'où `silhouette: 4` — les rameaux font partie de la FORME, pas de l'ombrage.
  bouleau: {
    slug: 'bouleau', noeud: 'tree', mesures: B_BOULEAU, silhouette: 4,
    compo: [
      [0.14, 0.22, 0.72, 0.70], [0.24, 0.02, 0.52, 0.72],
      [0.06, 0.48, 0.10, 0.46], [0.84, 0.44, 0.10, 0.50],
      [0.30, 0.14, 0.22, 0.26], [0.33, 0.18, 0.10, 0.12], [0.58, 0.54, 0.20, 0.22],
    ],
    tons: TONS_BOULEAU, fut: TONS_FUT_PALE,
  },
  // LE BALIVEAU (3 tuiles) — étroit et dense, et le feuillage descend PRESQUE AU SOL : une jeune
  // tige n'a pas encore élagué ses branches basses. Pas un arbre rétréci : il remplit le sous-bois.
  baliveau: {
    slug: 'baliveau', noeud: 'tree', mesures: B_BALIVEAU, silhouette: 2,
    compo: [
      [0.28, 0.20, 0.44, 0.78], [0.18, 0.34, 0.64, 0.52],
      [0.32, 0.28, 0.22, 0.28], [0.35, 0.32, 0.10, 0.12], [0.58, 0.60, 0.20, 0.24],
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
    tons: TONS_PIN, fut: TONS_FUT_PIN,
  },
  // LE VIEUX PIN — UN PARASOL, PAS UN GRAND JEUNE PIN. C'est la correction la plus visible du
  // relevé : il partageait la silhouette conique du pin et ne s'en distinguait que par sa teinte
  // — donc pas du tout, une fois l'albédo aplati par la variante `_lit`. Un pin sylvestre mûr a
  // un fût NU sur 55 % de sa hauteur, coiffé d'une ombelle plate et asymétrique, plus large que
  // longue (photos Skuleskogen, Beinn a' Bhuird). Deux conifères qui se distinguent enfin de
  // loin, et c'est la SILHOUETTE qui le fait.
  vieux_pin: {
    slug: 'vieux_pin', noeud: 'tree', mesures: B_VIEUX_PIN, silhouette: 3,
    compo: [
      [0.00, 0.46, 1.00, 0.26], // l'étage bas : large et PLAT, il déborde
      [0.16, 0.24, 0.68, 0.28], // l'étage haut, plus court — la flèche est perdue
      [0.26, 0.66, 0.42, 0.12], // une touffe basse, décalée : un vieux pin est asymétrique
      [0.38, 0.48, 0.10, 0.26], [0.40, 0.52, 0.05, 0.12], [0.58, 0.54, 0.14, 0.16],
    ],
    tons: TONS_VIEUX_PIN, fut: TONS_FUT_PIN,
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
  const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
  const apres = [tons.lumiere, tons.eclat, tons.ombre]
  return v.compo.map((f, i) => {
    const ton = i < v.silhouette
      ? (i % 2 === 0 ? tons.masse : tons.corps)
      : (apres[i - v.silhouette] ?? tons.ombre)
    return [porter(f, W, H), ton] as RectTon
  })
}

/** LA SILHOUETTE d'une variante — l'union de ses `silhouette` premiers rects, et rien d'autre.
 *  Déduite du dessin, comme `houppierOpaque` : deux écritures d'une même forme divergent. */
export function houppierOpaqueDe(v: VarianteArbre): (x: number, y: number) => boolean {
  const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
  const rects = v.compo.slice(0, v.silhouette).map((f) => porter(f, W, H))
  return (x, y) => rects.some((r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3])
}

/**
 * JUSQU'OÙ LA SILHOUETTE DESCEND dans sa boîte, en pixels depuis le haut — et le SEUIL qu'elle
 * doit atteindre pour que le houppier repose sur le fût au lieu de flotter au-dessus.
 * Rendu en paire pour que la garde affirme l'écart, pas seulement le verdict.
 */
export function assiseHouppier(v: VarianteArbre): { bas: number; requis: number } {
  const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
  let bas = 0
  for (const f of v.compo.slice(0, v.silhouette)) {
    const r = porter(f, W, H)
    if (r[1] + r[3] > bas) bas = r[1] + r[3]
  }
  return { bas, requis: H - v.mesures.recouvrementPx }
}

/**
 * COMBIEN DE CIMES PAR TYPE D'ARBRE (demande d'Alexis, 2026-07-30 : « il faut prévoir 5
 * houppiers différents pour chaque type d'arbre »).
 *
 * Le peuplement avait déjà réglé le même problème un cran plus haut : *« un seul sprite pour
 * tous les arbres ordinaires de la carte : douze exemplaires par écran, identiques au pixel
 * près — ça ne fait pas un bois, ça fait une grille »*. Les variantes ont cassé la grille entre
 * ESPÈCES ; il restait celle qui se voit dans une futaie pure, où douze hêtres portent la même
 * cime. Cinq cimes par variante, tirées du même champ de feuillage avec cinq graines.
 */
export const CIMES_PAR_ARBRE = 5

/**
 * LA CLÉ D'UNE CIME — et elle est CENTRALISÉE parce que trois consommateurs la construisaient
 * chacun de son côté : l'arbre debout (`snapshot-view`), l'arbre qui s'abat (`chute-arbre`) et
 * les feuilles qui en tombent (`recolte-fx`). Trois écritures d'une même clé, et un arbre
 * changerait de cime EN TOMBANT.
 *
 * L'art PEINT (hors éclairage) n'a qu'une cime : il est composé de rects, pas du champ de
 * feuillage, et c'est le chemin de repli — le jeu tourne éclairé. **IL N'A PAS NON PLUS DE
 * CIME NUE**, pour la même raison : la cime nue se DÉSHABILLE d'un champ de feuillage
 * (`grainDenude`), et l'art peint n'en a pas. Le rendu retombe alors sur la cime feuillue —
 * `snapshot-view` teste l'existence de la texture avant de la poser, plutôt que d'afficher
 * le carré vert d'une clé absente.
 */
export function cleHouppier(
  slug: string, lit: boolean, cime: number, etat: EtatCime = 'feuillu', parite = 0, miroir = false,
): string {
  const n = SUFFIXE_CIME[etat]
  const p = parite === 1 ? '~1' : ''
  // LE MIROIR NE VIT QUE DU CÔTÉ `_lit` (2026-08-27) : c'est une texture PRÉ-RETOURNÉE, et l'art
  // PEINT n'en a pas — il se retourne au `setFlipX`, qui lui va très bien puisqu'il n'a pas de
  // normale à casser. Demander le retourné d'une cime peinte rend donc la cime peinte, pas une
  // clé absente : la couche de rendu n'a pas à savoir dans quel mode elle est.
  const m = miroir ? '_m' : ''
  return lit ? `nd-${slug}_crown${n}_lit-${cime}${p}${m}` : `nd-${slug}_crown${n}`
}

/**
 * LA CLÉ D'UN FÛT — centralisée pour la MÊME raison que celle d'une cime : l'arbre debout
 * (`snapshot-view`) et l'arbre qui s'abat (`chute-arbre`) la construisaient chacun de son
 * côté, et le chicot aurait retrouvé un tronc vivant EN TOMBANT.
 *
 * `mort` n'est cuit que pour les variantes qui portent un chicot, et seulement en mode éclairé
 * (`lit-trees`) : les deux appelants testent donc l'existence de la texture avant de la poser,
 * exactement comme ils le font pour la cime. Mieux vaut un tronc vivant sous un chicot que le
 * carré vert d'une clé absente.
 */
export function cleFut(slug: string, lit: boolean, mort = false, miroir = false): string {
  const base = `nd-${slug}_trunk${mort ? '_mort' : ''}`
  return lit ? `${base}${miroir ? '_lit_m' : '_lit'}` : base
}

/**
 * ═══ LA PARITÉ DE CRAN — DEUX SAISONS CUITES À LA FOIS, ET POURQUOI IL EN FAUT DEUX ═══
 *
 * *(Demande d'Alexis, 2026-08-25 : « il faudra que la transition entre chaque état soit lerpée,
 * une transition lente ».)*
 *
 * Un fondu se fait ENTRE DEUX IMAGES. Or le recuit saisonnier remplace la texture SOUS LA MÊME
 * CLÉ (`registerLit` fait `remove` puis `addCanvas`) : à l'instant où le cran change, l'ancienne
 * couleur n'existe plus nulle part, et il n'y a rien à fondre — le seul rendu possible est le
 * saut.
 *
 * D'où deux emplacements, choisis par la PARITÉ du cran : le cran courant occupe `cran & 1`, le
 * précédent occupe l'autre, et le fondu va de l'un à l'autre. Ça ne double pas la cuisson (on
 * ne recuit qu'un emplacement par changement de cran, l'autre porte déjà le passé) — ça double
 * seulement la place, et de 35 textures.
 *
 * ⚠ **SEUL LE FEUILLAGE CADUC EN A DEUX.** La cime nue, les coiffes de neige et le feuillage
 * des persistants ne dépendent pas du jour : leur donner une parité serait cuire deux fois la
 * même image. La règle vit ICI, en une ligne, plutôt que chez les trois appelants.
 */
export function pariteDeCime(slug: string, etat: EtatCime, cran: number): number {
  // UNE RAMURE est peinte aux tons du BOIS : elle ne tourne pas, un tronc ne rousse pas — et un
  // chicot encore moins (le mélèze est `prendLaSaison`, donc sans ce test son bois mort virerait
  // à l'or aux Pluies et se ferait recuire par `rafraichirCimes`). Tout le reste d'une variante
  // saisonnière tourne — y compris ses cimes COIFFÉES, dont le feuillage se voit entre les
  // plaques de neige.
  return !estRamure(etat) && prendLaSaison(slug) ? cran & 1 : 0
}


/**
 * ═══ L'ÉTAT D'UNE CIME — UN SEUL PARAMÈTRE, ET C'EST LE POINT ═══
 *
 * Il y avait `nu: boolean`, et la neige des persistants (2026-08-25) en appelait un second.
 * Deux booléens indépendants savent former quatre combinaisons dont **deux n'existent pas** :
 * un feuillu dénudé ne porte pas de coiffe (on n'a rien cuit pour lui), et un conifère n'est
 * jamais nu (`VARIANTES_CADUQUES` ne le nomme pas — promesse G6). `cleHouppier` aurait donc pu
 * fabriquer une clé que rien ne cuit, et le repli `textures.exists` l'aurait avalée en silence.
 *
 * L'exclusion est une propriété du DOMAINE : elle se dit dans le type, pas dans un garde-fou.
 * *(C'est la leçon du 2026-08-06 : une table exhaustive par construction, pas par vigilance.)*
 *
 * ⚠ **`mort` EST LE PREMIER ÉTAT QUI TRAVERSE LA LIGNE CADUC/PERSISTANT** (2026-08-27), et il
 * ne l'ouvre pas pour autant : c'est le persistant qui le porte, parce que lui seul n'avait
 * aucune façon de dire qu'il meurt. Le caduc a déjà `nu`, et la cendre le lui emprunte.
 */
export type EtatCime = 'feuillu' | 'nu' | 'neige1' | 'neige2' | 'mort'

const SUFFIXE_CIME: Record<EtatCime, string> = {
  feuillu: '', nu: '_nu', neige1: '_n1', neige2: '_n2', mort: '_mort',
}

/**
 * ═══ CET ÉTAT EST-IL UNE RAMURE ? — le prédicat, écrit UNE fois ═══
 *
 * `nu` et `mort` sont la MÊME matière (du bois, pas du feuillage) et se comportent pareil aux
 * quatre endroits qui les distinguent : les cadrans de la normale (`passes: 2, k: 3,5` — une
 * branche est fine, la lisser comme une masse de pavés en ferait un coussin), la parité de
 * cime, la file du recuit saisonnier, et le choix de la recette dans `grainDeCime`.
 *
 * Il est ÉCRIT ICI plutôt que répété en quatre `=== 'nu' || === 'mort'` : l'un des quatre
 * finirait par dériver, et la dérive serait SILENCIEUSE — `cleDeCime` retombe sur la cime
 * feuillue quand la texture demandée n'existe pas, donc un chicot oublié sortirait vert.
 *
 * ⚠ **C'EST UN PRÉDICAT DE TYPE, et c'est ce qui garde la table exhaustive.** Écrit en
 * `boolean`, il ne rétrécit rien : `CHARGE_NEIGE[etat]` après le `return` de la ramure ne
 * compilait plus, parce que `mort` restait dans l'union. Le `etat is` rend au compilateur ce
 * que le code sait déjà — passé cette porte, il ne reste que du feuillage.
 */
export function estRamure(etat: EtatCime): etat is 'nu' | 'mort' {
  return etat === 'nu' || etat === 'mort'
}

/**
 * LES DEUX CHARGES DE NEIGE — tranchées sur planche rendue (2026-08-25) : à 1,0 la cime est
 * blanche et le conifère perd le vert qui le fait reconnaître ; à 0,35 la neige se voit déjà.
 * Elles répondent aux deux niveaux du manteau au sol (poudreuse, jusqu'aux genoux) : ce qu'on
 * a sous les pieds et ce qu'on a au-dessus de la tête disent la même chose.
 */
export const CHARGE_NEIGE: Record<'neige1' | 'neige2', number> = { neige1: 0.35, neige2: 0.7 }

/**
 * Les états qu'une variante sait porter — c'est ce que `lit-trees` cuit, et rien d'autre.
 *
 * LE PERSISTANT EN A QUATRE depuis le 2026-08-27 : son chicot. Le caduc n'en a pas besoin —
 * l'agonie de la cendre lui reprend sa cime `nu`, qui existait déjà pour l'hiver.
 */
export function etatsDeCime(slug: string): readonly EtatCime[] {
  return VARIANTES_CADUQUES.includes(slug) ? ['feuillu', 'nu'] : ['feuillu', 'neige1', 'neige2', 'mort']
}

/**
 * LES VARIANTES QUI SE DÉNUDENT (spec `gel.md` G6) — les feuillus, et EUX SEULS.
 *
 * `/sim` décide sur le TERRAIN (`forest`, `old_growth`, `willow` sont caducs ; `pine` et
 * `larch` ne le sont jamais), et le peuplement n'envoie de conifère que sur `pine`/`larch`
 * (`MELANGE_PIN`, `MELANGE_MELEZE` — aucun autre mélange ne les cite). Les deux règles
 * coïncident donc, et la promesse de G6 tient : **la silhouette du conifère dit « il tient »**.
 *
 * La liste est écrite ICI, en clair, plutôt que déduite de « tout sauf les conifères » : le
 * jour où une variante feuillue naît, elle doit ÊTRE AJOUTÉE — et une garde de `lit-trees`
 * échouera si un slug nommé ici n'existe pas dans la table.
 */
export const VARIANTES_CADUQUES: readonly string[] = [
  'tree', 'old_tree', 'chene_pre', 'hetre', 'saule', 'bouleau', 'baliveau',
]

/**
 * ═══ LES VARIANTES DONT LE HOUPPIER TOURNE — ET LE MÉLÈZE EN EST ═══
 *
 * *(Décision d'Alexis, 2026-08-25 : « et l'histoire des mélèzes ».)*
 *
 * « Tourner » et « se dénuder » étaient le MÊME test (`VARIANTES_CADUQUES`) tant que les deux
 * allaient ensemble. Le mélèze les sépare : **c'est un conifère qui DORE**. Il perd même ses
 * aiguilles en vrai — G6 l'aligne délibérément sur les persistants « par lisibilité : la
 * silhouette du conifère doit dire qu'il tient », et cette décision-là n'est PAS rouverte. Ce
 * qui change est la seule chose que la silhouette ne dit pas : la couleur.
 *
 * Il garde donc sa cime douze mois sur douze, il garde ses coiffes de neige — et il vire à l'or
 * aux Pluies comme un feuillu. C'est le seul arbre du jeu à faire les deux, et c'est exactement
 * ce qu'est un mélèze.
 *
 * ⚠ **SA FAMILLE ÉTAIT DÉJÀ OLIVE** (`TONS_MELEZE`, le bois clair) : fondue vers le roux de la
 * saison, elle sort JAUNE-OR là où les verts des feuillus sortent roux. On n'a donc pas eu à
 * lui écrire une cible à part — la loi commune, appliquée à ses tons à lui, donne sa couleur.
 */
export const VARIANTES_SAISONNIERES: readonly string[] = [...VARIANTES_CADUQUES, 'meleze']

export function prendLaSaison(slug: string): boolean {
  return VARIANTES_SAISONNIERES.includes(slug)
}

/**
 * L'ASSISE — la zone par laquelle la cime REPOSE sur le fût, et qu'aucune découpe n'a le droit
 * d'ajourer (spec da-feeling §8 bis ; le feuillage creuse le contour, `feuillage.ts`).
 *
 * Elle se DÉDUIT des deux mesures qui existent déjà — la colonne du fût et le recouvrement — au
 * lieu d'être un troisième nombre à tenir à jour : c'est la leçon du 2026-07-28, où la hauteur
 * d'un arbre vivait en trois exemplaires dans deux fichiers et avait dérivé. Sa largeur est celle
 * de la colonne élargie d'un pixel de part et d'autre (le feuillage mord un peu sur le tronc),
 * et elle couvre la bande basse que `assiseHouppier` exige d'atteindre.
 */
export function assiseDe(v: VarianteArbre): (x: number, y: number) => boolean {
  const W = houppierLargeur(v.mesures)
  const H = v.mesures.houppierS
  const demi = v.mesures.colonneW / 2 + 1
  const x0 = W / 2 - demi
  const x1 = W / 2 + demi
  const haut = H - v.mesures.recouvrementPx - 2 // la bande basse, seuil de `assiseHouppier` inclus
  return (x, y) => y >= haut && x >= x0 && x < x1
}

/**
 * Les rects PEINTS du fût d'une variante. Même géométrie que `futRects` (arêtes à 0,4 et 0,22 de
 * la colonne, cœur en bout quand la famille en déclare un) — mais lue sur la variante, pour que
 * le bouleau ait son fût pâle et le saule le sien sans qu'aucun appelant ne le sache.
 */
export function futRectsDe(v: VarianteArbre): RectTon[] {
  return futRectsCommuns(v.mesures, v.fut, v.slug)
}
