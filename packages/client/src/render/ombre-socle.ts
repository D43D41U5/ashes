/**
 * ═══ L'OMBRE DU SOCLE — une COULÉE, pas une flaque ══════════════════════════════════════════
 *
 * *(demande d'Alexis, 2026-08-27 : « la forme de l'ombre n'est pas satisfaisante vis-à-vis du
 * bloc de pierre. On peut trouver un truc pour ça aussi ? »)*
 *
 * CE QUI N'ALLAIT PAS, ET CE N'EST PAS UN GOÛT. L'ombre de contact générique
 * (`contact-shadow.ts`) est une ELLIPSE à bord fondu : elle est faite pour des BILLBOARDS —
 * un corps, une bête, une touffe — dont l'emprise au sol est ronde et floue. Le socle est
 * l'exact contraire : pleine tuile, à angles droits, la seule silhouette du jeu qui dise
 * franchement sa hitbox. Une lentille molle sous une brique, c'est la grammaire de DA prise à
 * rebours — *« ce qui pousse est mou, ce qui est taillé est droit »* (décision du 2026-08-22).
 *
 * ═══ TROIS IDÉES ════════════════════════════════════════════════════════════════════════════
 *
 * ① **C'EST UNE EMPREINTE, PAS UNE AURÉOLE.** La coulée fait `LARGEUR` texels de large — la
 *    tuile du bloc, exactement — et part de sous lui pour couler vers le SUD. L'ellipse, elle,
 *    était CENTRÉE sur le pied : sa moitié haute passait derrière le sprite et il n'en sortait
 *    qu'un anneau symétrique, ce qui se lit comme une auréole. Ici le contact est PLEIN et
 *    l'ombre a une direction.
 *
 * ② **ELLE SE CISAILLE, ELLE NE GLISSE PAS.** Le pied de la pierre ne bouge JAMAIS : c'est le
 *    point de contact, et une ombre qui s'en décolle fait flotter le bloc. C'est la POINTE, à
 *    l'autre bout, qui part à l'opposé de l'astre — le sommet du cube se projette plus loin que
 *    sa base. Le décalage croît donc linéairement avec la distance au pied. (La première
 *    version translatait la flaque entière ; sur un art rond ça passait, sur une empreinte non :
 *    on aurait vu la pierre décollée de son ombre.)
 *
 *    ⚠ **ET L'ANCRE EST LA LIGNE DE PIED, PAS LE HAUT DE LA TEXTURE** *(Alexis, 2026-08-27 :
 *    « l'ombre est très mal alignée vu la position du soleil »).* Les `REMONTE` premières
 *    rangées passent DERRIÈRE la pierre : personne ne les voit. Faire partir le cisaillement de
 *    là, c'était offrir tout son ancrage à l'invisible — à la première rangée VISIBLE, celle qui
 *    touche la base du bloc, la coulée était déjà décalée de `REMONTE / LONGUEUR` de sa course
 *    (2,5 px sur 8, mesuré), et un liseré de sol éclairé s'ouvrait sous un coin de la pierre.
 *    `t` se compte donc depuis la ligne de pied, et vaut 0 sur tout ce qui est caché.
 *
 * ②bis **ELLE PORTE LE BISEAU DE LA PIERRE** *(Alexis : « le haut de la pierre est légèrement
 *    biseauté. Ça doit se voir dans l'ombre »).* Le socle n'est pas un rectangle : ses rangées
 *    hautes se resserrent de `CHANFREIN` texels de chaque côté (`socle-mineral`), donc son
 *    dessus fait 12/16. Or une ombre est la projection d'une SILHOUETTE : la pointe de la
 *    coulée — qui EST la projection du dessus — doit être aussi étroite que lui. La coulée est
 *    donc un TRAPÈZE, 16 au contact, 12 à la pointe, et la donnée vient du même `CHANFREIN`
 *    que la silhouette : le rétrécir rétrécit l'ombre, sans qu'on repasse ici.
 *    ⚠ **ÉTALÉ, PAS RECOPIÉ.** Sur la pierre le chanfrein tient en DEUX rangées ; reproduit tel
 *    quel il tomberait pile dans les deux rangées de fondu de la pointe, et ne se verrait donc
 *    JAMAIS — l'inverse de ce qui est demandé. On l'étale sur toute la longueur : la largeur
 *    ARRIVÉE est exacte, c'est la façon d'y arriver qui est lisible plutôt que littérale.
 *
 * ③ **LE SUD EST FIXE, SEUL L'AZIMUT BOUGE.** Le soleil du jeu est un POINT au nord de la
 *    caméra, d'élévation constante (`SUN_NORTH`/`SUN_Z`, 21,2°) : la LONGUEUR de l'ombre ne
 *    peut pas varier, seule sa direction latérale le peut. `LONGUEUR` est donc une constante,
 *    et il n'y a rien à moduler en Y — la même raison qui tient `SOCLE_OMBRE_DESCENTE`.
 *
 * ═══ CUITE PAR CRAN, PAS À CHAQUE IMAGE ═════════════════════════════════════════════════════
 *
 * Le cisaillement est quantifié au TEXEL (`CRANS` = `CISAILLE`, donc un cran = un pixel) : 17
 * textures de 34×14, cuites une fois au boot. Rien à recalculer, aucune destination
 * fractionnaire — la même discipline que les crans du pavement (`CRANS_SOLEIL`), et pour la
 * même raison : une texture NEAREST posée sur un demi-pixel fait sautiller ses arêtes.
 *
 * Le champ d'alpha est PUR et QUANTIFIÉ (`ALPHA_CRANS` paliers) : c'est du pixel art, pas un
 * dégradé — même règle que les halos du Feu. Il se prouve en headless, sans canvas.
 *
 * ⚠ **ET LE BORD N'EST JAMAIS FRANC** (Alexis, 2026-08-27 : « pas de sharp edge, on fait 2 pixel
 * de couche alpha ») : deux texels d'opacité intermédiaire — ⅓ puis ⅔ — cernent la coulée sur
 * ses côtés comme à sa pointe. Voir `DOUX`, qui est un COMPTE de texels et pas une largeur.
 */

import { CHANFREIN } from './socle-mineral'

/** Les trois formes essayées devant Alexis. `coulee` est celle qui est livrée. */
export type FormeOmbre = 'ellipse' | 'dalle' | 'coulee'

export const OMBRE_SOCLE = {
  /** Largeur de l'empreinte, en texels — LA TUILE DU BLOC, ni plus ni moins. */
  LARGEUR: 16,
  /** Longueur de l'ombre PLEINE, en texels (du haut de l'empreinte à sa pointe sud). La
   *  pénombre s'ajoute EN PLUS, au-delà — voir `DOUX`. */
  LONGUEUR: 12,
  /** De combien la coulée REMONTE au-dessus de la ligne de pied — elle se glisse SOUS la
   *  pierre, sinon un liseré de sol nu apparaît entre la base et son ombre. */
  REMONTE: 4,
  /** Décalage MAXIMAL de la pointe sud, en texels, à l'astre rasant. Le pied, lui, ne bouge pas. */
  CISAILLE: 8,
  /**
   * ⚠ **DEUX TEXELS D'ALPHA PARTIEL AU BORD — c'est un COMPTE, pas une largeur de rampe**
   * *(Alexis, 2026-08-27 : « pas de sharp edge, on fait 2 pixel de couche alpha »).*
   *
   * `DOUX` dit combien de texels portent une opacité INTERMÉDIAIRE. La rampe se lit en
   * DISTANCE HORS DE L'OMBRE PLEINE : ⅔ au premier texel dehors, ⅓ au second, éteint au
   * troisième. La première écriture divisait par `DOUX` tout court — un seul texel partiel, et
   * à **0,67**, donc si près du plein que le bord se lisait NET.
   *
   * ⚠ **ET LA PÉNOMBRE EST DEHORS, JAMAIS DEDANS** *(Alexis : « la base de l'ombre n'est pas
   * aussi large que la base du caillou non ? » — et c'était vrai).* La rampe descendait DEPUIS
   * le bord de l'empreinte VERS L'INTÉRIEUR : les deux texels de chaque côté sortaient à ⅓ et
   * ⅔, donc l'ombre PLEINE ne faisait plus que **12 texels sur 16** et se lisait plus étroite
   * que la pierre qui la jette. C'est aussi le mauvais modèle : une pénombre s'étale AUTOUR de
   * l'umbra, elle ne la ronge pas. L'ombre pleine couvre donc exactement `LARGEUR`, et les
   * `DOUX` texels de fondu s'ajoutent AU-DELÀ.
   *
   * Et le compte se marie avec `ALPHA_CRANS` : deux paliers intermédiaires demandent trois
   * crans pour tomber juste. Changer l'un sans l'autre remet des valeurs bâtardes.
   */
  DOUX: 2,
  /** Paliers d'alpha — le grain de l'art, jamais un dégradé continu. */
  ALPHA_CRANS: 3,
  /**
   * ⚠ UN TEXEL DE MARGE DE CHAQUE CÔTÉ, et la garde `rien ne déborde` est là pour ça.
   *
   * Sans elle, `TEX_W` valait `LARGEUR + 2 × CISAILLE` — la bande, au cisaillement MAXIMAL,
   * tombait FLUSH sur le bord de la texture. Elle n'était pas coupée au sens strict, mais son
   * adoucissement latéral n'avait plus la place de descendre à zéro : la colonne du bord
   * sortait à 0,67 d'alpha, c'est-à-dire un TRAIT net là où l'ombre doit s'éteindre. C'est le
   * même piège que la `MARGE_HAUT` du socle lui-même (`socle-mineral.ts`) : une marge n'est pas
   * du vide décoratif, c'est ce qui permet au bord d'exister.
   */
  MARGE: 1,
  /**
   * ⚠ **LE BISEAU NE MORD QUE LE BAS DE L'OMBRE** *(Alexis, 2026-08-27 : « le biseauté ne devait
   * ne concerner que la partie la plus basse de l'ombre »).*
   *
   * Combien de rangées, à la POINTE, portent le rétrécissement. Et c'est la géométrie qui le
   * veut : sous une lumière venue du nord, le DESSUS du bloc — la seule partie qui soit
   * biseautée — se projette le PLUS LOIN, donc tout en bas de la coulée. Le reste de l'ombre
   * est jeté par le corps du bloc, qui est pleine tuile.
   *
   * La première écriture étalait le rétrécissement sur TOUTE la longueur : la largeur d'arrivée
   * était juste, mais l'ombre devenait un entonnoir dès le pied de la pierre — elle disait que
   * le bloc était conique. Quatre rangées, et pas deux (le compte du chanfrein) : les deux
   * dernières sont déjà mangées par le fondu de la pointe, un biseau qui n'y vivrait que là ne
   * se verrait jamais.
   */
  BISEAU_RANGS: 4,
} as const

/** Un cran = un texel de cisaillement. La dérive (part signée dans [−1, 1]) s'y arrondit. */
export const CRANS = OMBRE_SOCLE.CISAILLE

/** Largeur de la texture : l'ombre PLEINE, la pénombre qui l'entoure, la course du
 *  cisaillement, et la marge où le bord s'éteint. */
export const TEX_W = OMBRE_SOCLE.LARGEUR + 2 * (OMBRE_SOCLE.CISAILLE + OMBRE_SOCLE.DOUX + OMBRE_SOCLE.MARGE)
/** Hauteur : l'ombre pleine, plus la pénombre de la POINTE (le haut, lui, est sous la pierre). */
export const TEX_H = OMBRE_SOCLE.LONGUEUR + OMBRE_SOCLE.DOUX + OMBRE_SOCLE.MARGE

/** Le cran de cisaillement d'une dérive — arrondi SYMÉTRIQUE (JS arrondit les demis vers +∞,
 *  or la dérive est antisymétrique autour du zénith : matin et soir tomberaient à un cran l'un
 *  de l'autre, et l'ombre irait « plus loin d'un côté »). */
export function cranDeDerive(derive: number): number {
  const d = Math.max(-1, Math.min(1, derive)) * CRANS
  return Math.sign(d) * Math.round(Math.abs(d))
}

export function cleOmbreSocle(cran: number): string {
  return `fx-ombre-socle-${cran < 0 ? 'o' : 'e'}${Math.abs(cran)}`
}

/**
 * LE CHAMP D'ALPHA, PUR — l'opacité du texel (i, j) pour un cran donné, dans [0, 1].
 *
 * `j = 0` est le haut de la coulée (sous la pierre, immobile), `j = LONGUEUR − 1` sa pointe sud
 * (décalée de `cran`). L'origine de l'empreinte non cisaillée est à `x = CISAILLE + MARGE`, ce
 * qui laisse la même course des deux côtés — plus un texel pour que le bord s'éteigne.
 *
 * ⚠ La `dalle` est la variante SANS cisaillement — l'empreinte entière translatée. Elle n'est
 * là que pour la planche : sur un art pleine tuile elle DÉCOLLE la pierre de son ombre.
 */
export function alphaDOmbre(forme: Exclude<FormeOmbre, 'ellipse'>, cran: number, i: number, j: number): number {
  const { LARGEUR, LONGUEUR, CISAILLE, DOUX, MARGE, REMONTE, BISEAU_RANGS, ALPHA_CRANS } = OMBRE_SOCLE
  if (j < 0 || j >= TEX_H || i < 0 || i >= TEX_W) return 0
  // LA COURSE VISIBLE : 0 sur la LIGNE DE PIED (rangée `REMONTE`, la première qui sorte de sous
  // la pierre) et sur tout ce qui est au-dessus, 1 à la pointe. Voir l'idée ② de l'en-tête.
  const denom = Math.max(1, LONGUEUR - 1 - REMONTE)
  const t = Math.max(0, Math.min(1, (j - REMONTE) / denom))
  const dx = forme === 'coulee' ? cran * t : cran
  // LE BISEAU NE MORD QUE LE BAS (Alexis : « le biseauté ne devait concerner que la partie la
  // plus basse de l'ombre ») — voir `BISEAU_RANGS`. Ailleurs, la coulée est pleine tuile.
  const b = Math.max(0, Math.min(1, (j - (LONGUEUR - 1 - BISEAU_RANGS)) / Math.max(1, BISEAU_RANGS)))
  // ⚠ **LE RETRAIT EST UN ENTIER DE TEXELS**, arrondi avant d'être appliqué. Un retrait
  // fractionnaire décale la bande d'un DEMI-texel : la quantification devient asymétrique, la
  // coulée se met à boiter d'un demi-pixel d'une rangée à l'autre, et le pas se confond avec le
  // cisaillement. (Attrapé par la garde de monotonie : « cran 1, rangée 10 : recule de 0,500 ».)
  // C'est aussi la grammaire de la pierre elle-même : son chanfrein retire des texels ENTIERS.
  const retrait = forme === 'coulee' ? Math.round(CHANFREIN * b) : 0
  const larg = LARGEUR - 2 * retrait
  // Position dans l'ombre PLEINE : `u = 0` est son premier texel, `u = larg − 1` son dernier.
  // Elle reste CENTRÉE (le trapèze se resserre des deux côtés), et la pénombre commence APRÈS.
  const u = i - (CISAILLE + DOUX + MARGE + dx + retrait)
  // COMBIEN DE TEXELS DEHORS — 0 ou moins dans l'ombre pleine, 1 puis 2 dans la pénombre. Côtés
  // et pointe se mesurent pareil et on garde le plus grand des deux : les coins s'arrondissent
  // alors comme le reste, sans cas particulier. Le HAUT n'a pas de pénombre — il est sous la
  // pierre, c'est le CONTACT, et c'est ce qui pose le bloc.
  const dehors = Math.max(-u, u - (larg - 1), j - (LONGUEUR - 1))
  // ⅔ au premier texel dehors, ⅓ au second, éteint au troisième — et TOUT ce qui est dans
  // l'ombre pleine reste à 1, ses bords compris : c'est ce qui rend la base aussi large que la
  // pierre (voir `DOUX`).
  const a = Math.max(0, Math.min(1, 1 - dehors / (DOUX + 1)))
  return Math.round(a * ALPHA_CRANS) / ALPHA_CRANS
}
