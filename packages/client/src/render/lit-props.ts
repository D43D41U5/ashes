/**
 * ESSAI ÉCLAIRAGE DYNAMIQUE — couche 1, la masse « pâteuse » (DA 2026-07-20).
 *
 * Même recette que l'arbre, GÉNÉRALISÉE À TOUT LE DÉCOR (buissons, roches, sphaigne, fleurs,
 * touffes d'herbe, roseaux, cailloux, sapins… — demande d'Alexis 2026-07-24 « tout en cubique »,
 * pour tenir le TOUT-OU-RIEN de la DA du 2026-07-20) : pour chaque prop on fabrique une variante
 * `_lit` = albédo SANS l'ombrage directionnel peint (qui se battait avec la lumière calculée) — les
 * couleurs qui sont un MATÉRIAU (corolle mauve, feuillage vert sur un tronc) restent, seul le
 * hillshade cuit part — + une carte de NORMALES dérivée de la SILHOUETTE (masque lissé en butte,
 * puis facetté). Le relief vient alors 100 % de la lumière, cohérent avec le reste ; le rendu swappe
 * sur `_lit` + `setLighting(true)` quand armé. Chaque prop de clutter a AUSSI une variante MIROIR
 * `_lit_m` (canvas pré-retourné, normale dérivée du retourné) : elle rend la variété par flip sans
 * casser la normale — un flip Phaser n'inverse PAS le canal X de la normale.
 *
 * La normale est dérivée de NOTRE canvas (lisible via `getImageData`), jamais d'une texture
 * Phaser générée (dont la relecture WebGL est incertaine). Convention Y : voir `FLIP_G`.
 */
import type Phaser from 'phaser'
// LA RECETTE VIT DANS normal-map.ts (spec da-feeling R1) : ce module n'est plus que l'ART des
// props. Nos appels historiques (`passes`/`k`, cell 2 implicite) sont le cas particulier exact
// de la recette finale — bit-identique, le smoke `cubique` en témoigne.
import { cleLit, enc, FLIP_G, mirrorNormalCanvas, newCanvas, norm3, poserPaire, registerLitPaire } from './normal-map'



/** Un prop pâteux : sa clé, sa taille, le tracé de son albédo, et — pour les petits props BLOCKY —
 *  des cadrans de normale (`passes`/`k`, cf. `normalFromCanvas`) pour un cube franc plutôt qu'un dôme. */
interface LitProp {
  key: string
  /** SE TIENT-IL DEBOUT ? Requis, et c'est `registerLitPaire` qui en tire la `_lit_m` — voir
   *  l'en-tête de section de `normal-map.ts`. `false` couvre DEUX cas, et un seul mot les dit
   *  parce qu'ils ont la même conséquence : au ras du sol (une tache de lichen, une branche
   *  tombée — le miroir n'apporterait rien de visible), ou symétrique au pixel (les humains :
   *  le retourné rendrait la même image). */
  dresse: boolean
  w: number
  h: number
  draw: (ctx: CanvasRenderingContext2D) => void
  passes?: number
  k?: number
  /** L'ombre de contact bakée, peinte APRÈS la dérivation de la normale (le masque alpha la
   *  lirait comme de la matière — décision du 25/07). Le pendant de VARIANT_FAMILIES.shades. */
  shade?: (ctx: CanvasRenderingContext2D) => void
}

export const disc = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void => {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
}
export const tri = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void => {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill()
}

/** LE PATCH DE CHAMPIGNONS, cubique — silhouette PARTAGÉE peint↔lit (comme `FLOWERS`/`PEBBLES`) :
 *  BootScene rejoue CES rects en Phaser Graphics, on les peint ici en Canvas2D pour l'albédo `_lit`.
 *  Rects only → même forme aux deux backends ; deux chapeaux bruns à gradins sur pieds crème.
 *  `passes:1`/`k:3.5` sur la normale → arêtes franches (un cube net, pas un dôme). */
export const CHAMPIGNON_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  // Descendus de 3 px (l'ancienne litière retirée) pour que les pieds touchent le sol (origine bas).
  [5, 12, 2, 3, '#d8cdb4'],  // pied gauche
  [3, 10, 6, 2, '#8a5a34'],  // chapeau gauche (bas)
  [4, 9, 4, 1, '#8a5a34'],   // chapeau gauche (gradin haut)
  [10, 9, 2, 6, '#d8cdb4'],  // pied droit (le plus grand)
  [8, 7, 6, 2, '#9c6636'],   // chapeau droit (bas)
  [9, 6, 4, 1, '#9c6636'],   // chapeau droit (gradin haut)
  [9, 6, 2, 1, '#b98a58'],   // reflet NO
]
function drawChampignon(ctx: CanvasRenderingContext2D): void {
  for (const [x, y, w, h, col] of CHAMPIGNON_RECTS) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h) }
}

/** LE TAS DE FEUILLES (forêts-vivantes §1) — même contrat que `CHAMPIGNON_RECTS` : la
 *  silhouette partagée des deux backends (BootScene en Phaser Graphics, ici en Canvas2D).
 *  Un monticule de feuilles mortes à gradins, tons roux d'automne sur ombre brune —
 *  cubique, jamais un dôme. */
export const LEAF_PILE_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  [2, 12, 12, 3, '#4e3a24'],  // l'assise sombre (l'humus)
  [3, 10, 10, 2, '#7a5a30'],  // la masse basse
  [4, 8, 8, 2, '#96703a'],    // le gradin médian
  [6, 7, 4, 1, '#b08948'],    // la crête éclairée
  [3, 9, 2, 1, '#a86a38'],    // une feuille rousse qui dépasse (O)
  [11, 8, 2, 1, '#8a5028'],   // une feuille brune (E)
  [7, 6, 2, 1, '#c29a56'],    // reflet NO
]
function drawLeafPile(ctx: CanvasRenderingContext2D): void {
  for (const [x, y, w, h, col] of LEAF_PILE_RECTS) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h) }
}

/**
 * LES BUTTES D'AFFLEUREMENT (t0-exploration §2sexies) — même contrat que `CHAMPIGNON_RECTS` :
 * la silhouette PARTAGÉE des deux backends (BootScene rejoue ces rects en Phaser Graphics).
 * Cubique franc (`passes:1`/`k:3.5`), les couleurs sont des MATÉRIAUX : la rouille du fer et
 * la strate de houille restent sous l'éclairage, seul le hillshade cuit n'existe pas.
 */
/** LE CHICOT FERREUX (16×32) — l'aiguille rouillée du sommet : assez haute pour accrocher
 *  l'œil en marchant, SOUS la canopée (les repères du §1 gardent le monopole de l'horizon). */
/**
 * ═══ LA FUMEROLLE — un TROU, pas une bosse (décision d'Alexis, 2026-08-24) ═══
 *
 * Tout le décor du jeu se dresse ; celle-ci s'enfonce, et c'est ce qui doit se lire d'un coup
 * d'œil. Trois anneaux concentriques qui vont du clair au NOIR vers le centre : la lèvre de sel
 * (le plus clair — c'est elle qu'on récolte), la vasque, puis la gueule. Un croissant sombre au
 * nord de la lèvre pose l'ombre interne : sans lui, l'œil lit un caillou plat.
 *
 * Les rects, pas un dégradé : c'est la grammaire cubique du reste (`CHICOT_RECTS`, `FUMEROLLE_RECTS`).
 */
export const FUMEROLLE_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  // ⚠ CONTRASTE POUSSÉ APRÈS CAPTURE : la première version tenait dans une bande de gris et se
  //   perdait complètement dans le sol de cendre — on ne la voyait pas à trois tuiles, alors
  //   qu'elle doit se repérer à un ÉCRAN. La lèvre de sel est donc presque blanche, la gueule
  //   franchement noire : c'est l'écart de VALEUR qui la signale, pas sa taille.
  [2, 5, 12, 9, '#cfcabb'],  // la couronne de sel — le point le plus clair de tout le biome
  [3, 4, 10, 2, '#e4dfd0'],  // le bourrelet nord, en pleine lumière
  [3, 6, 10, 7, '#7a7268'],  // la vasque
  [4, 7, 8, 5, '#3a3631'],   // la paroi interne
  [5, 8, 6, 4, '#0e0d0c'],   // la gueule : un vrai NOIR, sinon le trou n'en est pas un
  [3, 5, 10, 1, '#5a544c'],  // l'ombre sous le bourrelet — c'est elle qui CREUSE
  [1, 13, 4, 1, '#d6d1c2'],  // les dépôts de sel qui débordent sur le sol
  [11, 13, 4, 1, '#d6d1c2'],
  [6, 14, 4, 1, '#c2bcae'],
]

/**
 * ═══ LA CHARBONNIÈRE (spec `cendre.md` R25) — un FÛT ROMPU, pas un tas ═══
 *
 * Elle doit dire deux choses d'un coup d'œil, à un écran de distance : **ceci a été un arbre**
 * (donc une silhouette DRESSÉE, un moignon de fût cassé en biseau, pas une masse au sol), et
 * **ceci se ramasse** (donc des morceaux tombés à son pied — c'est le charbon).
 *
 * ⚠ **LE CONTRASTE VA DANS L'AUTRE SENS QUE CELUI DE LA FUMEROLLE, et c'est le piège du biome.**
 * La fumerolle se signale par du PRESQUE BLANC parce que la cendre est grise ; un fût noir sur du
 * gris se lit tout aussi bien, mais seulement si son sommet reste franchement plus SOMBRE que le
 * sol (`#131316` contre un sol de cendre autour de `#6a6660`). On garde donc une seule touche
 * claire — la cassure du bois, à vif, en haut du fût — qui accroche l'œil sans faire de la
 * charbonnière une lampe.
 */
export const CHARBONNIERE_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  [6, 3, 5, 11, '#131316'],  // le fût rompu, presque noir — la masse
  [6, 3, 5, 2, '#3c3833'],   // la cassure, en biseau : le bois à vif, gris cendre
  [7, 3, 2, 1, '#6b6155'],   // l'éclat le plus clair de la cassure — l'accroche
  [10, 5, 1, 8, '#000000'],  // l'arête est, dans l'ombre : c'est elle qui donne le VOLUME
  // ⚠ LES MORCEAUX TOMBÉS SE POSENT AU SOL, PAS À MI-FÛT. Première version, vue sur planche :
  //   collés au flanc du tronc à mi-hauteur, ils lui faisaient deux PIEDS — la silhouette
  //   basculait du côté « créature » au lieu de « ruine ». À la ligne de sol, ils redeviennent
  //   ce qu'ils sont : du charbon tombé, ce qu'on vient ramasser.
  [3, 14, 4, 1, '#1b1a1c'],
  [10, 14, 4, 1, '#232124'],
  [7, 15, 3, 1, '#2c2a2b'],   // la poussière de charbon, au pied
]

/**
 * LE GLANAGE (spec `glanage.md`) — ce qui TRAÎNE au pied d'un arbre, au pied d'un rocher, et qui
 * se ramasse les mains vides. Deux silhouettes, et elles ont un travail précis à faire :
 *
 * **SE DISTINGUER DU DÉCOR.** Le fouillis pose déjà des cailloux (`PEBBLES`) et des chicots : si
 * le butin leur ressemblait, le joueur passerait sa première heure à cliquer sur des pierres
 * peintes. Trois écarts, cumulés — et aucun n'est un liseré magique, qui trahirait la DA :
 *   ① UNE MASSE, pas un semis. Le décor éparpille trois petits blocs ; le butin en pose UN gros,
 *     franc. C'est ce qui se lit de plus loin, avant même la couleur.
 *   ② Il est PLUS HAUT sur sa tuile (il ne rase pas le sol) : un objet posé, pas une texture.
 *   ③ Sa matière est plus CLAIRE et plus chaude que le gris froid du fouillis.
 * Le surlignage de visée (`recolte.md` G4) fait le reste au survol — mais il ne doit pas être le
 * SEUL signal, sinon il faut survoler tout l'écran pour savoir où est le jeu.
 */
export const BRANCHE_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  // Le fût couché — la masse, d'un seul tenant, posée en travers.
  [3, 10, 10, 3, '#6b5334'],
  // La face du dessus, prise par la lumière : c'est elle qui donne le volume d'un rondin.
  [3, 10, 10, 1, '#8a6a44'],
  // Deux ramilles, l'une devant l'autre — sans elles, c'est une planche.
  [11, 8, 3, 2, '#5c4429'],
  [2, 13, 3, 2, '#5c4429'],
]
/**
 * ⚠ **LA PIERRE AU SOL EST DE LA MÊME PIERRE QUE LE NŒUD** (Alexis, 2026-08-27 : « fais
 * correspondre la couleur/texture des pierres tombées au sol avec celle des nœuds »).
 *
 * Elle était d'un gris BLEU (`#8b8b93`) quand le socle minéral est d'un gris CHAUD (`#726c64`,
 * `socle-mineral.ts`) : le morceau détaché ne venait visiblement pas du bloc d'à côté. Les trois
 * tons sont donc pris dans la famille du socle — le corps, son dessus éclairé, et l'éclat.
 *
 * Ce qui NE change pas, et c'est la raison d'être de ces rects : les trois écarts qui séparent le
 * BUTIN du fouillis (une masse franche au lieu d'un semis, plus haut sur la tuile, plus clair et
 * plus chaud que le gris FROID des cailloux décoratifs, `PEBBLE_TONES` = `#71717a`/`#5a5a62`).
 * En se rapprochant du socle, elle s'éloigne du décor : les deux demandes tirent dans le même sens.
 */
export const CAILLOU_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  // LE bloc — un seul, franc, et plus gros qu'aucun caillou du fouillis (qui plafonne à 5).
  [4, 8, 7, 6, '#7d766d'],
  // Sa face supérieure, un ton au-dessus : le cube se lit à midi comme au couchant.
  [4, 8, 7, 2, '#8f887d'],
  // L'éclat qui l'accompagne — il dit « ça vient de se détacher ».
  [11, 11, 3, 3, '#6d675f'],
]

export const CHICOT_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  [5, 27, 8, 3, '#6e6862'],   // l'assise élargie (bas rangée 29 → gap 2)
  [6, 22, 6, 5, '#7b746c'],   // le pied
  [7, 12, 4, 10, '#88817a'],  // le fût
  [7, 6, 3, 6, '#948c84'],    // l'épaule haute
  [8, 3, 2, 3, '#9e968e'],    // la pointe
  [8, 7, 2, 5, '#9a5a36'],    // la traînée d'oxyde sous l'épaule
  [9, 14, 1, 8, '#8a4e2e'],   // la longue coulure de rouille
  [7, 12, 2, 1, '#aa6a40'],   // la tache vive au collet
]
/* (LES BLOCS D'AFFLEUREMENT — `BLOC_RECTS` et son long calibrage du 2026-08-27 sur l'échine —
   ont été RETIRÉS le même jour : le socle minéral (`socle-mineral.ts`) rend les trois hauteurs
   depuis un champ de faces, sans une seule valeur peinte. Le calibrage qu'ils portaient (« on
   garde les trois dessus près du sol de pierrier et on FONCE le corps à mesure qu'il grandit »)
   est devenu inutile : mesuré, l'échelle des hauteurs sort désormais de la géométrie seule.) */

/** LA POUSSIÈRE DE HOUILLE — une tache de sol quantifiée (grain de l'art, jamais lissée),
 *  au ras des veines de la butte charbonneuse. Prop RAMPANT : elle EST le sol. */
export const POUSSIERE_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  [4, 11, 4, 2, '#26241f'],
  [8, 12, 3, 2, '#1c1b18'],
  [6, 9, 3, 2, '#2e2b26'],
  [10, 10, 2, 1, '#26241f'],
]
function drawRects(rects: readonly (readonly [number, number, number, number, string])[]) {
  return (ctx: CanvasRenderingContext2D): void => {
    for (const [x, y, w, h, col] of rects) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h) }
  }
}



// Silhouettes = celles de `BootScene.makeClutter` (À GARDER EN PHASE : deux backends de dessin,
// Phaser Graphics là-bas, Canvas2D ici). L'ombrage directionnel peint est retiré ; les couleurs
// qui sont un MATÉRIAU (corolle, feuillage) restent. La normale se lit sur l'alpha seul.
const PROPS: LitProp[] = [
  // La masse pâteuse (déjà cubique avant le 2026-07-24) : silhouette APLATIE d'une seule couleur.
  { key: 'cl-bush', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#2f5330'; c.fillRect(2, 5, 12, 9); c.fillRect(3, 4, 10, 9) } },
  { key: 'cl-low_bush', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#4b4a2e'; c.fillRect(4, 8, 9, 6) } },
  { key: 'cl-boulder', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#5f5f64'; disc(c, 8, 10, 5) } },
  { key: 'cl-sphagnum', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#6a6a3a'; disc(c, 8, 11, 4) } },
  // Le petit décor de sol + les brins, désormais cubiques (mousse, touffes… « tout en cubique »).
  //  Les FLEURS, elles, ont plusieurs VARIÉTÉS (forme + couleur) — voir `FLOWERS` plus bas.
  // Le bleu de la touffe (0x42) est de la MARGE pour la teinte de biome — cf. `clutter-teinte.ts`.
  { key: 'cl-grass_tuft', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#5a6e42'; c.fillRect(5, 9, 2, 5); c.fillRect(8, 8, 2, 6); c.fillRect(11, 10, 2, 4) } },
  { key: 'cl-reed', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#6d7a40'; c.fillRect(6, 4, 1, 11); c.fillRect(9, 3, 1, 12); c.fillRect(11, 6, 1, 9) } },
  { key: 'cl-lichen', dresse: false, w: 16, h: 16, draw: (c) => { c.fillStyle = '#777c50'; disc(c, 6, 10, 2); disc(c, 9, 11, 2) } },
  { key: 'cl-snowdrift', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#d8dde6'; disc(c, 8, 12, 4) } },
  // Les conifères / troncs décoratifs (feuillage + fût = 2 matériaux, gardés).
  { key: 'cl-conifer', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#24401f'; tri(c, 8, 1, 2, 13, 14, 13) } },
  { key: 'cl-pine', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#2f5030'; tri(c, 8, 3, 4, 13, 12, 13) } },
  { key: 'cl-larch', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#6f7a3a'; tri(c, 8, 3, 5, 12, 11, 12) } },
  { key: 'cl-burnt_trunk', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#2b2b2f'; c.fillRect(7, 4, 2, 10) } },
  { key: 'cl-big_trunk', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#3a2c1a'; c.fillRect(6, 4, 4, 11); c.fillStyle = '#24401f'; disc(c, 8, 4, 5) } },
  { key: 'cl-stump', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#4a3826'; c.fillRect(6, 9, 4, 5) } },
  // Les BUTTES d'affleurement (§2sexies) — cubique franc, silhouettes partagées (RECTS ci-dessus).
  // (Les dalles décoratives ont été PURGÉES le 2026-08-18 — « trop de cailloux-clutter » : la
  // butte est peuplée par ses nœuds `bloc`, le décor ne garde que chicot et poussière.)
  { key: 'cl-chicot', dresse: true, w: 16, h: 32, draw: drawRects(CHICOT_RECTS), passes: 1, k: 3.5 },
  { key: 'cl-poussiere', dresse: false, w: 16, h: 16, draw: drawRects(POUSSIERE_RECTS) },
  // LA FUMEROLLE — c'est un NŒUD (on y récolte du sel), donc `nd-` et non `cl-` : elle est
  // dessinée par `SnapshotView` comme n'importe quel nœud, et pas par le décor. ⚠ Les deux à la
  // fois auraient fait un DOUBLON sur la même tuile — et sans le `nd-`, le nœud demandait une
  // texture inexistante : le carré vert de Phaser, en plein milieu de la cendre (vu au navigateur).
  // `passes: 1` / `k: 3.5` comme les autres silhouettes cubiques franches : elle prend la lumière
  // comme un objet TAILLÉ, pas comme une tache peinte.
  { key: 'nd-fumerolle', dresse: true, w: 16, h: 16, draw: drawRects(FUMEROLLE_RECTS), passes: 1, k: 3.5 },
  // LA CHARBONNIÈRE (R25) — un nœud, donc `nd-`, exactement pour la même raison que la
  // fumerolle : sans elle, `SnapshotView` demanderait `nd-charbonniere` et Phaser rendrait son
  // carré vert au milieu de la cendre.
  { key: 'nd-charbonniere', dresse: true, w: 16, h: 16, draw: drawRects(CHARBONNIERE_RECTS), passes: 1, k: 3.5 },
  // (LA ROCHE et LES BLOCS D'AFFLEUREMENT sont partis dans `socle-mineral.ts` — comme les
  //  filons, la carrière et les gravats : les six nœuds qui bloquent leur tuile entière ont
  //  désormais UN socle commun, pleine largeur, à trois hauteurs.)
  // ═══ LES HUMAINS (da-feeling R9) — des billboards mono-frame SYMÉTRIQUES, jamais miroités :
  //     la bascule est celle d'un chip. Bord + cœur = deux MATÉRIAUX (un liseré n'est pas un
  //     ombrage), normale blocky. La FAUNE, elle, reste consignée : asymétrique, miroitée par
  //     le regard, et déclinée en postures — la recette « normale par posture » n'est pas actée.
  { key: 'spr-player', dresse: false, w: 12, h: 24, passes: 1, k: 3.5, draw: (c) => { c.fillStyle = '#8a6f3c'; c.fillRect(0, 0, 12, 24); c.fillStyle = '#f0e6c8'; c.fillRect(1, 1, 10, 22) } },
  { key: 'spr-npc', dresse: false, w: 12, h: 24, passes: 1, k: 3.5, draw: (c) => { c.fillStyle = '#4a5364'; c.fillRect(0, 0, 12, 24); c.fillStyle = '#9aa4b5'; c.fillRect(1, 1, 10, 22) } },
  // ═══ LA VAGUE A DE LA BASCULE (spec da-feeling R3) — les nœuds restants, silhouettes
  //     BootScene reproduites à l'identique (deux backends, une forme), hillshade retiré. ═══
  // Le BUISSON À BAIES : 4 états de stock (berryDots borne à 3). Socle vert aplati '#3b682b'
  // (mi-corps/mi-dessus, comme cl-bush) ; les baies sont un MATÉRIAU (reflet spéculaire retiré).
  ...([0, 1, 2, 3] as const).map((n) => ({
    key: `nd-berry_bush-${n}`,
    dresse: true,
    w: 16,
    h: 16,
    draw: (c: CanvasRenderingContext2D) => {
      c.fillStyle = '#3b682b'
      c.fillRect(2, 5, 12, 9)
      c.fillRect(3, 4, 10, 9) // la crête (5,3,5,2) DÉBORDE d'une rangée : elle est DANS la silhouette
      c.fillRect(5, 3, 5, 2)
      c.fillStyle = '#c0392b'
      const baies: readonly (readonly [number, number])[] = [[7, 8], [5, 10], [10, 9]]
      for (let b = 0; b < n; b++) c.fillRect(baies[b]![0], baies[b]![1], 2, 2)
    },
  })),
  // La FIBRE : trois brins verticaux, pointes zénithales retirées, vert relevé d'un tiers.
  { key: 'nd-fiber_plant', dresse: true, w: 16, h: 16, draw: (c) => { c.fillStyle = '#77a53f'; c.fillRect(4, 8, 2, 7); c.fillRect(7, 6, 2, 9); c.fillRect(10, 9, 2, 6) } },
  // La POUSSE : fût + cube de feuillage — LES MATÉRIAUX DE L'ARBRE ADULTE LIT (aucun pop à l'âge).
  { key: 'nd-sapling', dresse: true, w: 16, h: 16, passes: 1, k: 3.5, draw: (c) => { c.fillStyle = '#5c4429'; c.fillRect(7, 9, 2, 6); c.fillStyle = '#2d6b32'; c.fillRect(4, 3, 8, 8) } },
  // La SOUCHE (récolte vivante) : billot + coupe claire (bois frais = matériau) ; l'ombre au sol
  // passe en `shade` (après la normale — la rangée 0x241a10 du painter peint était du contact).
  {
    key: 'nd-stump', dresse: true, w: 16, h: 16, passes: 1, k: 3.5,
    draw: (c) => { c.fillStyle = '#3a2c1a'; c.fillRect(5, 11, 6, 3); c.fillStyle = '#6b5334'; c.fillRect(5, 9, 6, 2); c.fillStyle = '#8a6a44'; c.fillRect(7, 9, 2, 1) },
    shade: (c) => { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(4, 14, 8, 1) },
  },
  // La CICATRICE : une plaque de terre remuée, à plat — la butte basse fait le « à peine un relief ».
  { key: 'nd-scar', dresse: false, w: 16, h: 16, passes: 1, k: 3.5, draw: (c) => { c.fillStyle = '#3a2f22'; c.fillRect(4, 11, 8, 3) } },
  // Le nœud CHAMPIGNON — cubique (arêtes franches, `passes:1`/`k:3.5`), silhouette partagée avec BootScene.
  { key: 'nd-champignon', dresse: true, w: 16, h: 16, passes: 1, k: 3.5, draw: drawChampignon },
  { key: 'nd-leaf_pile', dresse: false, w: 16, h: 16, passes: 1, k: 3.5, draw: drawLeafPile },
  // LE GLANAGE (spec `glanage.md`) — cubique franc comme tout ce qui est TAILLÉ ou POSÉ, et
  // silhouettes partagées avec BootScene (flat et `_lit` ne peuvent pas diverger). L'ombre de
  // contact les POSE au sol : un objet qu'on ramasse ne flotte pas.
  {
    key: 'nd-branche_au_sol', dresse: false, w: 16, h: 16, passes: 1, k: 3.5, draw: drawRects(BRANCHE_RECTS),
    shade: (c) => { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(3, 13, 10, 1) },
  },
  {
    key: 'nd-pierre_au_sol', dresse: false, w: 16, h: 16, passes: 1, k: 3.5, draw: drawRects(CAILLOU_RECTS),
    shade: (c) => { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(3, 14, 9, 1) },
  },
  // (Les COINS DE PÊCHE n'ont pas de `_lit` : un remous sur l'eau n'a rien à éclairer — leur art
  // flat vit dans `BootScene.makeNodes`, comme tout nœud hors `LIT_NODE_TYPES`.)
]

/** LES VARIÉTÉS DE FLEUR (demande d'Alexis 2026-07-24 : « un peu de variation, forme ET couleur —
 *  toujours CUBIQUE »). Une seule fleur clonée = un pré en copier-coller ; on en tire plusieurs par
 *  tuile (hash, cf. `PropInstance.variant`). Chaque variété : une TÊTE BLOCKY (liste de rects, la
 *  silhouette partagée peint↔lit) et sa couleur-matériau `bloom`. La tige est commune. `passes:1`+
 *  `k:3.5` gardent les arêtes franches (cube net, pas bosse) — la même recette que la 1re tête. */
export interface FlowerVariant { bloom: string; stem: readonly [number, number, number, number]; rects: readonly (readonly [number, number, number, number])[] }
export const FLOWER_STEM_COLOR = '#50662f'
export const FLOWERS: readonly FlowerVariant[] = [
  // 0 — cube dodu chanfreiné, mauve (la tête d'origine)
  { bloom: '#9a7bb0', stem: [7, 8, 2, 6], rects: [[5, 4, 6, 5], [6, 3, 4, 1]] },
  // 1 — tête haute et étroite, jaune (une hampe dressée)
  { bloom: '#d8c25e', stem: [7, 9, 2, 5], rects: [[6, 3, 4, 6], [7, 2, 2, 1]] },
  // 2 — gemme en losange à gradins, blanc-crème
  { bloom: '#e6e2ee', stem: [7, 9, 2, 5], rects: [[7, 3, 2, 1], [6, 4, 4, 1], [5, 5, 6, 2], [6, 7, 4, 1], [7, 8, 2, 1]] },
  // 3 — corolle large et basse, rose-rouge
  { bloom: '#c85f7a', stem: [7, 8, 2, 6], rects: [[4, 5, 8, 3], [5, 4, 6, 1]] },
  // ═══ LE CALENDRIER FLORAL (Alexis, 2026-08-28, sur planche rendue) : quatre espèces de plus,
  // et chaque INDICE devient une ESPÈCE — crocus, jonquille, marguerite, coquelicot (0-3),
  // puis les nouvelles. Qui pousse où et quand vit dans `flore-especes.ts` (tables par biome,
  // fenêtres de floraison, nappes) ; ici seulement la silhouette et la couleur-matériau.
  // Même recette cubique que les quatre premières (`passes:1`/`k:3.5`, tige commune). ═══
  // 4 — tête frangée (deux éclats latéraux), bleu bleuet : le bleu qui manquait à la palette
  { bloom: '#5b7fc4', stem: [7, 9, 2, 5], rects: [[6, 4, 4, 4], [5, 5, 1, 2], [10, 5, 1, 2], [7, 3, 2, 1]] },
  // 5 — trompette dressée, bleu profond (gentiane — la signature d'altitude)
  { bloom: '#3a56a8', stem: [7, 10, 2, 4], rects: [[6, 2, 4, 3], [7, 5, 2, 4]] },
  // 6 — calice évasé vers le haut, rose pâle (colchique — la fleur de l'ouverture, j61)
  { bloom: '#c9a0c4', stem: [7, 10, 2, 4], rects: [[5, 3, 6, 3], [6, 6, 4, 2], [7, 8, 2, 1]] },
  // 7 — touffe basse en grappes, pourpre FONCÉ (bruyère ; foncée sur planche : sur la lande
  // rousse d'automne, à valeur égale seule la teinte la séparait du sol — il faut l'écart de valeur)
  { bloom: '#7d3459', stem: [7, 12, 2, 2], rects: [[4, 8, 3, 3], [8, 7, 3, 3], [6, 10, 4, 2], [11, 9, 2, 2]] },
]
/** Dessine une variété de fleur (tige + tête) sur un contexte Canvas2D — l'albédo `_lit`. La version
 *  peinte de BootScene rejoue la MÊME donnée `FLOWERS` (autre backend), d'où silhouette identique. */
function drawFlower(ctx: CanvasRenderingContext2D, f: FlowerVariant): void {
  ctx.fillStyle = FLOWER_STEM_COLOR
  ctx.fillRect(f.stem[0], f.stem[1], f.stem[2], f.stem[3])
  ctx.fillStyle = f.bloom
  for (const [x, y, w, h] of f.rects) ctx.fillRect(x, y, w, h)
}

/** LES CAILLOUX, VRAIMENT CARRÉS (demande d'Alexis 2026-07-24 : « vraiment carrés, configurations
 *  différentes, normale correspondante, moins fréquents, et un peu en forêt »). Fini les disques
 *  ronds : chaque variété est un petit tas de BLOCS carrés (liste de rects), gris de deux tons pour la
 *  matière. `passes:1`+`k:3.5` → arêtes franches (de vrais cubes au sol, pas des galets flous). */
export interface PebbleVariant { rects: readonly (readonly [number, number, number, number])[] }
export const PEBBLE_TONES = ['#71717a', '#5a5a62'] as const
export const PEBBLES: readonly PebbleVariant[] = [
  // 0 — deux blocs, l'un dominant
  { rects: [[5, 9, 4, 4], [10, 11, 3, 3]] },
  // 1 — trois blocs en escalier
  { rects: [[5, 11, 3, 3], [8, 9, 4, 4], [12, 12, 2, 2]] },
  // 2 — un gros galet carré + un éclat
  { rects: [[6, 9, 5, 5], [12, 12, 2, 2]] },
  // 3 — un semis de trois petits carrés
  { rects: [[4, 12, 2, 2], [7, 10, 3, 3], [11, 12, 3, 3]] },
]
/** L'OMBRE AU PIED DE CHAQUE BLOC (demande d'Alexis 2026-07-25). Un caillou est un TAS : chacun de
 *  ses blocs doit poser sur le sol, pas y flotter. Une bande sombre d'1 px sous chaque bloc, DÉBORDANT
 *  d'1 px de part et d'autre — le débord est ce qui fait lire « flaque au sol » plutôt que « rangée
 *  du bas du cube en plus foncé » (le bloc grandirait d'un pixel et redeviendrait le blob qu'on a
 *  chassé le 24/07). Pas de débord sous les blocs de 2 px : il les avalerait. AUCUN décalage latéral —
 *  l'ombre est CENTRÉE sous son bloc, comme les ombres de contact des acteurs (décision du 2026-07-23 :
 *  une ombre orientée par le soleil engagerait la promotion de l'éclairage dynamique). Le miroir la
 *  retourne donc sans jamais la mettre du mauvais côté.
 *
 *  `alpha` = 0,22, CALIBRÉ À L'ŒIL (Alexis, 25/07). Il était parti à 0,38, la valeur des ombres de
 *  contact des acteurs (23/07) — reprise sans la rejuger à SON échelle, et c'était l'erreur : leur
 *  flaque fait 10+ px et se dilue, celle-ci en fait 1 de haut et frappe bien plus fort à surface
 *  égale. La FORME, elle, ne se transpose pas non plus : une ellipse (essayée puis écartée le même
 *  jour, cf. `docs/decisions.md`) DÉGÉNÈRE à 16 px — ses deux rangées visibles tombent à la même
 *  largeur après arrondi. À cette échelle, ce qui pose un bloc est une bande qui DÉBORDE. */
export const PEBBLE_SHADOW = { color: '#000000', alpha: 0.22, h: 1, overhang: 1, minW: 3 } as const

/** Les rects d'ombre d'une variété — DÉRIVÉS de ses blocs, donc jamais désynchronisés d'eux. Seule
 *  fabrique : `drawPebbles` (albédo canvas) et BootScene (texture peinte) la rejouent tous deux. */
export function pebbleShadowRects(p: PebbleVariant): readonly (readonly [number, number, number, number])[] {
  return p.rects.map(([x, y, w, h]) => {
    const o = w >= PEBBLE_SHADOW.minW ? PEBBLE_SHADOW.overhang : 0
    return [x - o, y + h, w + 2 * o, PEBBLE_SHADOW.h] as const
  })
}

/** Dessine une variété de cailloux (blocs carrés, deux tons) — l'albédo `_lit`. BootScene rejoue la
 *  MÊME donnée `PEBBLES`+`PEBBLE_TONES` en Phaser Graphics → silhouette identique. */
function drawPebbles(ctx: CanvasRenderingContext2D, p: PebbleVariant): void {
  p.rects.forEach(([x, y, w, h], i) => { ctx.fillStyle = PEBBLE_TONES[i % PEBBLE_TONES.length]!; ctx.fillRect(x, y, w, h) })
}

/** LA PASSE D'OMBRE — peinte APRÈS que la normale a été dérivée (cf. `generateLitProps`), et c'est
 *  tout l'enjeu : `normalFromCanvas` bâtit sa hauteur sur le MASQUE ALPHA (`alpha > 8`), donc une
 *  bande d'ombre semi-opaque compterait comme de la MATIÈRE — le champ de hauteur descendrait d'une
 *  rangée et adoucirait exactement l'arête basse qu'on veut franche. L'ombre doit rester un
 *  assombrissement d'ALBÉDO, invisible à la normale. Passe unique après tous les blocs : là où elle
 *  recouvre un bloc voisin plus bas, elle l'assombrit — c'est le contact, pas un défaut. */
function shadePebbles(ctx: CanvasRenderingContext2D, p: PebbleVariant): void {
  ctx.fillStyle = PEBBLE_SHADOW.color
  ctx.globalAlpha = PEBBLE_SHADOW.alpha
  for (const [x, y, w, h] of pebbleShadowRects(p)) ctx.fillRect(x, y, w, h)
  ctx.globalAlpha = 1
}

/** LES FAMILLES À VARIÉTÉS — un même `kind` de clutter porté par N textures `cl-<kind>-<i>`, tirées
 *  par tuile (hash `PropInstance.variant`). `passes`/`k` : les cadrans de normale (cube franc).
 *  `shades` (optionnel) : la passe d'ombre au sol, peinte APRÈS la dérivation de la normale — voir
 *  `shadePebbles` pour pourquoi elle ne peut pas être dans `draws`. */
const VARIANT_FAMILIES: {
  kind: string; passes: number; k: number; dresse: boolean
  draws: ((ctx: CanvasRenderingContext2D) => void)[]
  shades?: ((ctx: CanvasRenderingContext2D) => void)[]
}[] = [
  { kind: 'flower', passes: 1, k: 3.5, dresse: true, draws: FLOWERS.map((f) => (c: CanvasRenderingContext2D) => drawFlower(c, f)) },
  {
    kind: 'pebbles', passes: 1, k: 3.5, dresse: true,
    draws: PEBBLES.map((p) => (c: CanvasRenderingContext2D) => drawPebbles(c, p)),
    shades: PEBBLES.map((p) => (c: CanvasRenderingContext2D) => shadePebbles(c, p)),
  },
]
/** Combien de variétés par `kind` (pour ClutterLayer : quelle texture tirer). */
export const VARIANT_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(VARIANT_FAMILIES.map((f) => [f.kind, f.draws.length]))
/** Le stem de texture d'une variété — `<kind>-<i>`. SEULE fabrique de ce nom (ClutterLayer pose, ce
 *  module génère : ils ne peuvent pas diverger). */
export function variantBase(kind: string, i: number): string {
  return `${kind}-${i}`
}

/** La clé de texture `_lit` d'un prop de clutter, variante MIROIR comprise. LA SEULE fonction qui
 *  la calcule — clutter-layer l'appelle, ce module la génère : elles ne peuvent pas diverger (un
 *  kind câblé sans texture générée donnerait le carré vert `__MISSING`).
 *
 *  ⚠ ELLE FILTRE LE MIROIR PAR `dresse`, et c'est ce qui rend le drapeau sûr : une couche qui
 *  demande le retourné d'un prop COUCHÉ (le lichen, la poussière) reçoit la clé droite au lieu
 *  d'un carré vert. Le décor n'a plus à savoir ce qui se retourne — la table le sait. */
export function litClutterTextureKey(kind: string, mirror: boolean): string {
  return cleLit(`cl-${kind}`, mirror && CLUTTER_DRESSE.has(kind))
}

/** Les `kind` de clutter qui ont une variante `_lit` (swap côté ClutterLayer) — DÉRIVÉ de `PROPS`
 *  (tout `cl-*`) + les FAMILLES à variétés (`flower`, `pebbles` : hors `PROPS`, plusieurs textures
 *  chacune). Un kind ne peut jamais figurer ici sans que sa/ses texture(s) soi(en)t générée(s). */
export const LIT_CLUTTER_KINDS: ReadonlySet<string> = new Set([
  ...PROPS.filter((p) => p.key.startsWith('cl-')).map((p) => p.key.slice(3)),
  ...VARIANT_FAMILIES.map((f) => f.kind),
])
/** Les `type` de NŒUD qui ont une variante `_lit` (swap côté SnapshotView). LISTE EXPLICITE, PAS
 *  une dérivation du préfixe `nd-` : ce namespace contient aussi des sprites qui NE sont PAS des
 *  types de nœud (`nd-tree_trunk`, `nd-tree_crown`, `nd-berry_bush-2`, `nd-rubble`, `nd-fiber_plant`…).
 *  Dériver de `nd-*` polluerait ce whitelist et ferait demander à SnapshotView un `nd-<type>_lit`
 *  inexistant. On ne met ici QUE des `n.type` réels (test : chacun a bien sa texture générée). */
/** Les nœuds dont la variante `_lit` est une masse pâteuse de ce module. Les SOCLES minéraux
 *  (`socle-mineral.ts`) n'y sont pas : ils ont leurs propres clés, à trois hauteurs. */
export const LIT_NODE_TYPES: ReadonlySet<string> = new Set([
  'champignon', 'fiber_plant', 'leaf_pile', 'fumerolle', 'charbonniere',
  'branche_au_sol', 'pierre_au_sol',
])
/** Les `kind` de clutter qui SE TIENNENT DEBOUT — donc ceux dont le retourné existe. Dérivé de
 *  `dresse`, jamais recopié : la table qui décide de la génération est la table qui décide de la
 *  pose. (Les familles à variétés répondent sur leur `kind`, pas sur chaque variété : elles sont
 *  dressées ou couchées en bloc.) */
const CLUTTER_DRESSE: ReadonlySet<string> = new Set([
  ...PROPS.filter((p) => p.key.startsWith('cl-') && p.dresse).map((p) => p.key.slice(3)),
  ...VARIANT_FAMILIES.filter((f) => f.dresse).map((f) => f.kind),
  ...VARIANT_FAMILIES.filter((f) => f.dresse).flatMap((f) => f.draws.map((_, i) => variantBase(f.kind, i))),
])

/** LE MIROIR D'UN NŒUD EXISTE-T-IL ? La même table, du côté `nd-` — `SnapshotView` la lit pour
 *  choisir entre `nd-<type>_lit` et son retourné. Un nœud COUCHÉ (branche, caillou, litière)
 *  n'en a pas, et la demander rendrait la clé droite. */
export const litNodeTextureKey = (base: string, miroir: boolean): string =>
  cleLit(base, miroir && NODE_DRESSE.has(base))
const NODE_DRESSE: ReadonlySet<string> = new Set(PROPS.filter((p) => p.dresse).map((p) => p.key))

/** Toutes les clés de texture RÉELLEMENT générées par `generateLitProps` — surface testable du
 *  câblage. Elle DÉCOULE de `dresse` : tout ce qui se tient debout a ses deux clés, tout ce qui
 *  est couché n'en a qu'une. Plus aucune règle de préfixe (`cl-` avait les deux, `nd-` une
 *  seule) — c'était la géométrie qu'on voulait dire, pas le namespace. */
export const LIT_PROP_KEYS: ReadonlySet<string> = new Set([
  ...PROPS.flatMap((p) => (p.dresse ? [cleLit(p.key), cleLit(p.key, true)] : [cleLit(p.key)])),
  ...VARIANT_FAMILIES.flatMap((fam) => fam.draws.flatMap((_, i) => {
    const base = `cl-${variantBase(fam.kind, i)}`
    return fam.dresse ? [cleLit(base), cleLit(base, true)] : [cleLit(base)]
  })),
])



/**
 * Enregistre les variantes `_lit` de tout le décor — et leur `_lit_m` pour tout ce qui se tient
 * DEBOUT (`dresse`).
 *
 * L'ORDRE (dériver les deux normales sur la masse nue, ombrer, puis miroiter l'OMBRÉ) ne vit
 * plus ici : il est dans `registerLitPaire`, en un exemplaire. Ce module ne dit plus que l'ART.
 */
export function generateLitProps(scene: Phaser.Scene): void {
  for (const p of PROPS) {
    const alb = newCanvas(p.w, p.h)
    p.draw(alb.ctx)
    registerLitPaire(scene, p.key, {
      albedo: alb.c, dresse: p.dresse, ombrer: p.shade, passes: p.passes, k: p.k,
    })
  }
  // Les FAMILLES à variétés (fleurs, cailloux…) — chacune son `cl-<kind>-<i>`.
  for (const fam of VARIANT_FAMILIES) {
    for (let i = 0; i < fam.draws.length; i++) {
      const alb = newCanvas(16, 16)
      fam.draws[i]!(alb.ctx)
      registerLitPaire(scene, `cl-${variantBase(fam.kind, i)}`, {
        albedo: alb.c, dresse: fam.dresse, ombrer: fam.shades?.[i], passes: fam.passes, k: fam.k,
      })
    }
  }
}

/**
 * LE FEU — 2-3 BÛCHES CROISÉES, NORMAL-MAPPÉES (demande d'Alexis). Contrairement à la
 * masse pâteuse (un blob lissé depuis la silhouette), on bâtit un vrai CHAMP DE HAUTEUR
 * où CHAQUE bûche est un RONDIN cylindrique : la normale montre alors des rondins
 * distincts, pas une bosse. De ce même relief on tire l'ombrage du sprite NON éclairé —
 * les deux modes montrent le même bois. La flamme vit dans les particules (FireFx), pas
 * ici : la base est du bois mat, propre à éclairer.
 *
 * Tout est sur la grille 2 px (évaluation par cellule de 2×2) — le style pixel du jeu.
 */
const FIRE_SIZE = 16
const FIRE_CELL = 2
// x0,y0 → x1,y1 (px) et rayon du rondin : deux diagonales croisées + un rondin au sol devant.
const FIRE_LOGS: readonly (readonly [number, number, number, number, number])[] = [
  [3, 4, 13, 11, 2.6],
  [13, 4, 3, 11, 2.6],
  [4, 13, 12, 13, 2.3],
]
const FIRE_TONES: readonly [number, number, number][] = [
  [0x6b, 0x4a, 0x2f], // bois
  [0x77, 0x53, 0x30], // bois, une pointe plus chaud
  [0x5f, 0x43, 0x28], // bois, plus sombre (le rondin du sol, dans l'ombre des autres)
]
const FIRE_NORMAL_K = 3.4 // gain sur le gradient de hauteur — le galbe des rondins

function distToSegment(px: number, py: number, seg: readonly [number, number, number, number, number]): number {
  const [x0, y0, x1, y1] = seg
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy || 1
  let t = ((px - x0) * dx + (py - y0) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const cx = x0 + t * dx
  const cy = y0 + t * dy
  const ex = px - cx
  const ey = py - cy
  return Math.sqrt(ex * ex + ey * ey)
}

/** Enregistre `st-fire` (bois ombré, hors éclairage dynamique) et `st-fire_lit` (bois mat
 *  + normal map cylindrique, pour le pipeline de lumières). Appelé au boot. */
export function generateFireProp(scene: Phaser.Scene): void {
  const S = FIRE_SIZE
  const cells = S / FIRE_CELL // 8×8 cellules de 2 px
  // Hauteur et bûche d'appartenance PAR CELLULE (le rondin le plus haut l'emporte).
  const H = new Float32Array(cells * cells)
  const which = new Int8Array(cells * cells).fill(-1)
  let hMax = 0
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const px = cx * FIRE_CELL + FIRE_CELL / 2
      const py = cy * FIRE_CELL + FIRE_CELL / 2
      let best = -1
      let hi = 0
      for (let i = 0; i < FIRE_LOGS.length; i++) {
        const seg = FIRE_LOGS[i]!
        const r = seg[4]
        const d = distToSegment(px, py, seg)
        if (d >= r) continue
        const h = Math.sqrt(r * r - d * d) // section circulaire du rondin
        if (h > hi) { hi = h; best = i }
      }
      H[cy * cells + cx] = hi
      which[cy * cells + cx] = best
      if (hi > hMax) hMax = hi
    }
  }
  const hAt = (cx: number, cy: number): number =>
    H[Math.min(cells - 1, Math.max(0, cy)) * cells + Math.min(cells - 1, Math.max(0, cx))]! / (hMax || 1)

  const albedo = newCanvas(S, S) // bois MAT (variante _lit)
  const shaded = newCanvas(S, S) // bois OMBRÉ (variante non éclairée)
  const normal = newCanvas(S, S)
  const nd = normal.ctx.createImageData(S, S)
  // Lumière FIXE du sprite non éclairé : le hillshade maison (haut-gauche).
  const [lx, ly, lz] = norm3(-0.5, -0.6, 0.85)
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const b = which[cy * cells + cx]!
      if (b < 0) continue // pas de bois ici : transparent (la silhouette vient de l'albédo)
      // Normale de la cellule = gradient du champ de hauteur, galbé par K.
      const dhx = hAt(cx + 1, cy) - hAt(cx - 1, cy)
      const dhy = hAt(cx, cy + 1) - hAt(cx, cy - 1)
      const [nx, ny, nz] = norm3(-dhx * FIRE_NORMAL_K, -dhy * FIRE_NORMAL_K, 1)
      const [r, g, bl] = FIRE_TONES[b]!
      // Albédo mat.
      albedo.ctx.fillStyle = `rgb(${r},${g},${bl})`
      albedo.ctx.fillRect(cx * FIRE_CELL, cy * FIRE_CELL, FIRE_CELL, FIRE_CELL)
      // Ombré : albédo × (ambiante + diffus du relief).
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz)
      const k = 0.55 + 0.55 * diff
      shaded.ctx.fillStyle = `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(bl * k))})`
      shaded.ctx.fillRect(cx * FIRE_CELL, cy * FIRE_CELL, FIRE_CELL, FIRE_CELL)
      // Normal map (encodée) sur le bloc 2×2.
      for (let y = cy * FIRE_CELL; y < (cy + 1) * FIRE_CELL; y++) {
        for (let x = cx * FIRE_CELL; x < (cx + 1) * FIRE_CELL; x++) {
          const idx = (y * S + x) * 4
          nd.data[idx] = enc(nx)
          nd.data[idx + 1] = enc(FLIP_G ? -ny : ny)
          nd.data[idx + 2] = enc(nz)
          nd.data[idx + 3] = 255
        }
      }
    }
  }
  normal.ctx.putImageData(nd, 0, 0)
  // `st-fire` : sprite ombré simple (aucune normal — rendu quand l'éclairage est éteint).
  if (scene.textures.exists('st-fire')) scene.textures.remove('st-fire')
  scene.textures.addCanvas('st-fire', shaded.c)
  // `st-fire_lit` : bois mat + normal map (rendu quand l'éclairage est armé) — et son RETOURNÉ,
  // comme tout ce qui est dressé (2026-08-27). Deux bûches croisées ne sont pas symétriques :
  // le retourné donne un second foyer sans redessiner un pixel à la main.
  // ⚠ Sa normale est ÉCRITE ICI, en PIXELS déjà encodés (pas un champ flottant comme le socle) :
  // son miroir passe donc par `mirrorNormalCanvas`, qui retourne l'image ET inverse le canal X.
  poserPaire(scene, (m) => cleLit('st-fire', m), albedo.c, normal.c, mirrorNormalCanvas(normal.c))
}
