/**
 * LES PAVÉS DESSINÉS — le sol à la même échelle que les props (spec `sol-dessine.md` R8-R10).
 *
 * *Décision d'Alexis, 2026-08-22 : « 2 et 4 c'est le type de DA que je kiffe » — ce qui pousse est
 * mou, ce qui est taillé est droit. Le sol n'est plus une CARTE en aplats de 16 px sous des props
 * cubiques à grain 4 px : c'est un TERRAIN dessiné, cuit à 16 px par tuile, par chunks.*
 *
 * ═══ CE QUE DESSINE UN PAVÉ ═══
 *
 * Chaque tache de terrain est un pavé posé SUR le terrain du dessous (un ordre de recouvrement :
 * l'herbe recouvre la litière, la fleuraie recouvre l'herbe…). Le pavé du dessus reçoit :
 *   - une FRANGE irrégulière (2 à 5 px, par colonne de 4 px) qui déborde sur le terrain du dessous
 *     — c'est elle qui fait l'organique à l'écran, sur des formes qui sont déjà à la tuile (R1) ;
 *   - un LISERÉ sombre sur ses bords bas et latéraux (l'épaisseur du pavé), une ARÊTE HAUTE
 *     éclairée, une seconde rangée en TRANCHE ;
 *   - une OMBRE PORTÉE sur le terrain du dessous, sous le pavé qui le domine ;
 *   - des BRINS : deux marques par tuile, dans la gamme du terrain.
 * Le grain de famille (`grain-sol.ts`) entre DIRECTEMENT dans la cuisson — plus de passe MULTIPLY
 * séparée : une seule image, une seule échelle.
 *
 * ═══ POURQUOI UN ALGORITHME DE PROPRIÉTAIRE, PAS UN TILESET ═══
 *
 * Un autotile à 47 cas suppose des bords DESSINÉS à la main pour chaque couple de terrains. Ici
 * les bords se DÉRIVENT : chaque pixel appartient au pavé de PLUS HAUTE priorité dont le
 * rectangle élargi (la frange) le contient. Les 47 cas, les coins convexes (chanfrein) et
 * rentrants (union) sortent tout seuls, pour n'importe quel couple de terrains — et l'ordre de
 * recouvrement est UNE table, pas quinze planches.
 *
 * ═══ LA BERGE EST UN PAVÉ DE TERRE SUR L'EAU (décision d'Alexis, 2026-08-22, « très bien la reco ») ═══
 *
 * L'eau CÈDE à toute terre : elle est dans l'ordre de recouvrement, tout en bas (priorité 0). La
 * terre déborde donc sur elle avec sa frange, son liseré et son ombre portée — exactement comme
 * la prairie sur la litière — plus UNE marque neuve : le RESSAC, 1 px clair sur l'eau sous la
 * pénombre, l'eau qui mouille le pied de la berge. Le haut-fond reste une SURFACE : aucun
 * pavé entre haut-fond et profond (refusé sur planche).
 *
 * Mais le shader d'eau dessine PAR-DESSUS le sol. Tout ce qui tombe sur une tuile d'eau sort
 * donc dans une SECONDE image, le SURPLOMB, que la couche pose au-dessus du shader : la frange
 * de terre (opaque), l'ombre et la pénombre (noir à l'alpha du facteur), le ressac (blanc à
 * l'alpha). Le reste de l'eau y est transparent — le shader garde sa surface.
 *
 * ═══ LE MARAIS EST UNE SURFACE (décision d'Alexis, 2026-08-22, « ok pour la reco ») ═══
 *
 * Marais, tourbière et prairie humide étaient tous au rang 4 : à égalité, aucun ne cède à l'autre
 * et l'ombrage ne trace rien — une COUTURE NUE (MESURÉ : 1 048 bords marais / prairie humide sur
 * la seed 2026, 12 % de tous les bords terre-terre de la carte). La règle de R13 s'étend : le
 * marais est de l'eau qui a de la boue, donc une SURFACE, sans épaisseur. Il prend rang 1 — au-
 * dessus de l'eau (0), sous tout ce qui pousse — et le reste se DÉRIVE : la prairie humide est une
 * berge sur le marais (frange, liseré, ombre portée, ressac), et le marais glisse dans l'eau d'une
 * frange seule. Une surface n'a ni liseré, ni arête, ni tranche, ni brin, et NE PORTE PAS D'OMBRE
 * (pas d'épaisseur, pas d'ombre) — elle ne fait que déborder.
 *
 * ═══ LES STRUCTURELS GARDENT LEURS COUCHES (R10) ═══
 *
 * La falaise, le mur, le vide ne sont jamais propriétaires par débordement et ne reçoivent
 * aucune frange : leurs pixels restent TRANSPARENTS, le bake y reste seul maître. Le pavé voisin
 * garde son liseré contre eux.
 *
 * PUR : aucun import Phaser. La cuisson rend deux tampons RGBA (sol, surplomb) que
 * `scenes/world/pave-layer.ts` verse dans des `CanvasTexture`. Testé en Node (`paves.test.ts`).
 */
import { champDuChaos, fbm2, hash2, TERRAIN_BOULDERS, TERRAIN_ROCK } from '@ashes/sim'
import { TILE_PX } from './framing'
import { GRAIN_CELLS, GRAIN_CELL_PX } from './grain-sol'

/** Le côté d'une tuile en pixels de cuisson : la maille des props. */
export const PAVE_PX = TILE_PX

/** Réglages des pavés — ce qui se règle en REGARDANT une capture (da-feeling). */
export const PAVE = {
  /** Tuiles par côté d'un chunk. 16 → une texture de 256 px ; la vue (36×20 tuiles) en tient
   *  3×2 à 4×3. MESURÉ (R12, Node/tsx, 2026-08-22) : 25 ms par chunk de 32 à chaud, donc ~6 ms
   *  par chunk de 16 — la cuisson d'un chunk neuf au fil du déplacement tient dans une frame. */
  CHUNK: 16,
  /** Profondeur de la frange, en px : `MIN + floor(hash × (MAX − MIN + 1))`, par colonne de 4 px. */
  FRANGE_MIN: 2,
  FRANGE_MAX: 5,
  /** Le liseré : bords bas et latéraux du pavé — l'épaisseur qu'on voit. */
  LISERE: 0.55,
  /** L'arête haute, éclairée. */
  ARETE_HAUTE: 1.16,
  /** La seconde rangée au-dessus d'un bord bas : la tranche. */
  TRANCHE: 0.8,
  /** L'ombre portée d'un pavé sur le terrain du dessous : 2 px francs, puis 1 px de pénombre. */
  OMBRE: 0.72,
  PENOMBRE: 0.86,
  /** L'ombre latérale, plus courte (1 px). */
  OMBRE_LATERALE: 0.8,
  /** Les brins : deux marques de 1×2 px par tuile, claires, avec un pixel sombre en pied. */
  BRIN_CLAIR: 1.2,
  BRIN_SOMBRE: 0.8,
  BRINS_PAR_TUILE: 2,
  /** Le ressac : 1 px clair sur l'eau, sous la pénombre d'une berge (4 px sous son bord bas). */
  RESSAC: 1.22,
  /**
   * LE MOUILLÉ DE LA FRANGE — la terre qui déborde sur l'eau est MOUILLÉE.
   *
   * Le voile de sol humide (`water-layer.ts`, spec eau-vivante R10') ne peint que les tuiles de
   * TERRE : la frange de la berge, elle, vit sur une tuile d'EAU, et restait donc sèche et claire.
   * Le mouillé se lisait alors comme un TRAIT décollé du bord (MESURÉ sur berge de rivière,
   * midi : herbe sèche 95, mouillé 88, frange sèche 108, ressac 123, eau 111 — un creux entre
   * deux clairs). Même voile, même teinte, au cran PLEIN : la frange est dans l'eau, c'est la
   * partie la plus mouillée de la berge.
   */
  MOUILLE: 0.26,
  /**
   * LE DÉBORD DU CHUNK, en px d'art (2026-08-23, Alexis : « je vois toujours des traits en
   * forme de carré d'un pixel »).
   *
   * MESURÉ : le trait tombait sur un bord de chunk, à un DEMI-pixel d'écran (chunk 44, bord
   * monde 11264, `worldView.x` 11078,79, zoom 3,3125 → écran 613,5). Le pixel de la couture
   * est alors couvert à 50 % par chaque image : écrit deux fois en alpha partiel, il laisse
   * passer un quart de fond — un trait sombre d'un pixel, Δ 23 de luminance. L'image cuite,
   * elle, est PROPRE (relevée texel par texel : Δ ≤ 1,3, le pas de couleur normal d'une
   * tuile à l'autre) : la couture naît à la composition, pas à la cuisson.
   *
   * ET `roundPixels` NE PEUT PAS LA RATTRAPER : Phaser 4 le désactive dès que le zoom n'est
   * pas entier (`Camera.js` : `renderRoundPixels = roundPixels && Number.isInteger(zoomX)`),
   * or le nôtre se dérive de la hauteur de fenêtre (`zoomForFraming` — 2,25 au banc, 3,3125
   * sur l'écran d'Alexis). Le drapeau de `main.ts` est inerte en jeu.
   *
   * D'où le débord : chaque chunk se cuit UN PIXEL PLUS GRAND de chaque côté et se pose
   * décalé d'autant. Les images se RECOUVRENT, le pixel du bord est toujours couvert par de
   * l'art opaque, et le fond ne passe plus. Le recouvrement ne double rien : tout le calcul
   * est positionnel (`hash2` sur les coordonnées MONDE), donc le voisin recuit ce pixel à
   * l'identique — c'est déjà ce que promettait la marge d'une tuile de `cuireChunk`.
   */
  BAVE: 1,
} as const

/** La teinte du voile humide — la MÊME que celle du shader (`water-layer.ts`), en 0-255. */
const MOUILLE_TEINTE = [0.16 * 255, 0.14 * 255, 0.09 * 255] as const

/**
 * LES TERRAINS VIRTUELS DU MANTEAU (`render/manteau.ts`) — la neige au sol et la glace se
 * cuisent avec CETTE grammaire, dans une seconde couche posée au-dessus du sol. Ils n'existent
 * pas sur la carte : la couche les fabrique tuile par tuile depuis `neigeAuSol` / `estGele`.
 *
 *   • `DESSOUS` — « le sol qu'on ne repeint pas » : une SURFACE transparente, la TERRE nue. La
 *     neige déborde dessus (frange opaque) et y porte son ombre (voile noir) — exactement le
 *     chemin de l'eau sous la berge, SANS ressac (un pré sous une congère ne clapote pas).
 *   • `DESSOUS_EAU` — le même, sur une tuile qui est de l'EAU à la carte et que rien n'a
 *     couverte : l'EAU LIBRE. Transparente elle aussi (le shader est dessous), mais c'est le
 *     SEUL rang 0 du manteau — voir `SURFACES`, c'est elle qui reçoit les franges.
 *   • `GLACE_GUE`, `GLACE_LAC` — la glace : une surface opaque (pas d'épaisseur, donc ni liseré
 *     ni arête ni brin), dessinée dans le SOL de la couche, et qui reçoit la frange et l'ombre
 *     de la neige dans son SURPLOMB. Même rang que `DESSOUS` : entre la terre nue et la glace,
 *     c'est la BERGE du sol (R13) qui trace le bord, pas le manteau.
 *   • `MANTEAU` — la neige : un pavé à épaisseur, au-dessus de tout ; `MANTEAU_PROFOND`, la
 *     neige jusqu'aux genoux, un pavé de plus sur la poudreuse (gel.md G9).
 */
export const DESSOUS = 100
export const GLACE_GUE = 101
export const GLACE_LAC = 102
export const MANTEAU = 103
/** La neige JUSQU'AUX GENOUX (gel.md G9) : un pavé sur la poudreuse — même frontière. */
export const MANTEAU_PROFOND = 104
/** L'EAU LIBRE sous le manteau — voir `SURFACES` : le seul rang 0 de la couche. */
export const DESSOUS_EAU = 108

/**
 * ═══ LES TROIS VISAGES DU NIVEAU D'EAU (spec `saisons.md` S10) ═══
 *
 * Le niveau d'eau est un scalaire SIGNÉ et il change la carte dans les deux sens. Il se peint
 * par la même couche que la glace, pour la même raison : c'est un état de tuile DÉRIVÉ, pas une
 * tuile qui bouge. Comme la glace, ce sont des SURFACES — l'eau n'a pas d'épaisseur, la vase
 * non plus.
 *
 *   • `ASSEC` — la mare partie, le gué en poussière (`estAsseche`). Le fond d'eau mis à nu :
 *     une vase claire, craquelée. Du côté de la TERRE, la berge du sol a déjà tracé son bord
 *     (R13) — mais du côté de l'EAU PROFONDE qui reste, rien ne le traçait : la vase et l'eau
 *     libre étaient à égalité, et c'était la COUTURE NUE du marais, à l'autre bout de l'année
 *     (Alexis, 2026-08-24 : « une frontière propre entre la vase et l'eau profonde, la même
 *     que celle entre les marécages et l'eau peu profonde »). Rang 1, comme le marais : la
 *     vase glisse dans l'eau profonde d'une FRANGE SEULE — ni liseré, ni ombre.
 *   • `GUE_FERME` — l'eau peu profonde devenue infranchissable sous la crue (`estGueBloque`).
 *     **C'est le seul des trois qui BLOQUE**, donc le seul que G5 rend obligatoire : « on ne
 *     s'engage jamais sur la glace par surprise » vaut à l'identique pour un gué qui se ferme.
 *     Une eau trouble et SOMBRE — le contraire du haut-fond clair qu'on traversait hier.
 *   • `CRUE` — la terre passée sous l'eau (`estInonde`). Elle, elle est sur du MARCHABLE : rien
 *     n'a tracé son bord, elle porte donc son propre débord — au-dessus du dessous de terre.
 */
export const ASSEC = 105
export const GUE_FERME = 106
export const CRUE = 107

/**
 * L'ORDRE DE RECOUVREMENT — qui déborde sur qui. Plus haut = dessus. Un terrain absent vaut 0
 * (il ne recouvre rien). Les STRUCTURELS ne sont pas dans la table : `prioriteDe` leur rend −1.
 *
 * La logique : les surfaces tout en bas (`SURFACES` : l'eau, puis le marais), la sente, le minéral
 * (la roche affleure, tout pousse par-dessus), puis la litière (le sous-bois, le plus « sol »),
 * la roselière, l'humide et la lande sèche, l'herbe, l'alpage, et la fleuraie tout en haut (ce
 * qui fleurit est ce qui se voit). Regardé sur la planche du
 * 2026-08-22 ; se recalibre en regardant, pas en raisonnant.
 */
export const PRIORITE_PAVE: Record<number, number> = {
  // Les rangs 0 et 1 sont aux SURFACES (eau, marais) : toute terre commence à 2.
  2: 2, // road — la sente, battue, sous toute terre (et sur le marais : une chaussée)
  5: 3, // rock
  9: 3, // scree
  16: 3, // boulders
  3: 4, // forest — la litière
  22: 4, // old_growth
  13: 4, // pine
  14: 4, // larch
  21: 4, // burnt_forest
  24: 4, // willow
  19: 5, // reed_marsh — les roseaux sortent du marais (A11 : marais < roselière < prairie)
  26: 6, // juniper_heath — la lande sèche
  25: 6, // wet_meadow
  1: 7, // grass
  // LA CLAIRIÈRE (2026-08-25) — au-dessus de la litière ET de l'herbe, exprès : la trouée doit
  // ANNONCER son bord quoi qu'elle touche. C'est tout l'objet d'en avoir fait un biome ; à
  // égalité avec l'herbe, sa lisière du côté du pré s'effacerait — et un bord nu est justement
  // ce qui se lisait comme une coupe. Elle déborde donc d'une frange sur le sous-bois et sur
  // le pré, comme la fleuraie déborde sur l'herbe.
  30: 8, // clairiere
  11: 7, // heath
  10: 7, // snow
  15: 7, // glacier
  12: 8, // alpine_meadow
  // ═══ LES TROIS CENDRES (spec `cendre.md` R11) ═══
  //
  // Elles recouvrent CE QU'ELLES ONT TUÉ : la cendre est posée SUR le pré, sur la litière, sur la
  // roche — donc au-dessus d'eux tous. C'est ce rang qui lui donne sa FRANGE, son liseré et son
  // ombre portée sur le vivant : la lisière cesse d'être une découpe et devient une avancée.
  //
  // Elles restent SOUS le manteau de neige (20-21) : l'hiver recouvre la cendre comme le reste.
  27: 10, // cendre_pre
  28: 10, // cendre_bois
  29: 10, // cendre_min
  17: 9, // flower_meadow
  20: 9, // alpine_flowers
  [MANTEAU]: 20, // la neige au sol (`render/manteau.ts`) : par-dessus tout ce qui pousse
  [MANTEAU_PROFOND]: 21, // la neige profonde, sur la poudreuse
}

/**
 * LES SURFACES — ce qui n'a pas d'épaisseur : l'eau, et le marais qui est de l'eau avec de la
 * boue. Leur rang dit qui déborde sur qui ENTRE surfaces (la boue glisse sur l'eau) ; toute terre
 * de `PRIORITE_PAVE` est au-dessus. Une surface déborde d'une frange seule : ni liseré, ni arête,
 * ni tranche, ni brin, et elle ne porte aucune ombre.
 */
export const SURFACES: Record<number, number> = {
  // ── LA CARTE (couche du sol) ──
  4: 0, // shallow_water
  6: 0, // deep_water
  8: 1, // marsh
  18: 1, // peat_bog
  // ── LE MANTEAU (couche du gel, terrains virtuels ≥ 100) ── Les deux couches ne se cuisent
  // JAMAIS ensemble : ces rangs ne se comparent qu'entre eux. Et ils disent la même loi que
  // ceux de la carte, d'où la même échelle — 0 est à l'EAU LIBRE, 1 à ce qui la couvre.
  //
  // RANG 0 — l'eau libre : la seule chose sur quoi le manteau déborde.
  [DESSOUS_EAU]: 0,
  // RANG 1 — CE QUI COUVRE L'EAU, et la terre nue avec. Ils sont à ÉGALITÉ, et c'est tout le
  // dessin : entre la vase (ou la glace) et la TERRE, la berge du sol a déjà tracé le bord
  // (R13) — une frange de plus y ferait un double trait, et la vase mangerait la rive. Entre
  // la vase et l'EAU PROFONDE qui reste, rien ne le traçait : elles ne sont plus à égalité, et
  // la vase y glisse d'une frange, exactement comme le marais glisse dans le haut-fond.
  [DESSOUS]: 1,
  [GLACE_GUE]: 1,
  [GLACE_LAC]: 1,
  [ASSEC]: 1,
  [GUE_FERME]: 1,
  // RANG 2 — LA CRUE, qui tombe sur de la TERRE : rien ne l'y borde, elle porte son propre
  // débord. Elle passe donc au-dessus du dessous de terre. Une surface : frange seule, ni
  // liseré ni ombre — une nappe d'eau n'a pas d'épaisseur.
  [CRUE]: 2,
}

/** Les terrains STRUCTURELS : jamais propriétaires par débordement, transparents dans le chunk. */
const STRUCTURELS = new Set<number>([0, 7, 23]) // void, wall, cliff

export function estStructurel(t: number): boolean {
  return STRUCTURELS.has(t)
}

/** L'eau — elle cède à toute terre, et ce qui tombe sur elle va au SURPLOMB. */
export function estEau(t: number): boolean {
  return t === 4 || t === 6 // shallow_water, deep_water
}

/** La glace du manteau — une surface opaque, dans le sol de la couche. */
export function estGlace(t: number): boolean {
  return t === GLACE_GUE || t === GLACE_LAC
}

/** Le DESSOUS du manteau : la tuile qu'il ne repeint pas — la terre nue, ou l'eau libre. */
export function estDessous(t: number): boolean {
  return t === DESSOUS || t === DESSOUS_EAU
}

/** Un VOILE : ce qui, propriétaire d'un pixel, n'y dessine rien d'opaque — l'eau (le shader
 *  est dessous) et le dessous transparent du manteau. Son ombre et son ressac vont au surplomb. */
export function estVoile(t: number): boolean {
  return estEau(t) || estDessous(t)
}

/** Une tuile SURPLOMBÉE : ce qu'un pavé à épaisseur y pose (sa frange) sort dans la seconde
 *  image, au-dessus de ce qui se dessine sur la tuile — le shader d'eau, ou la glace. */
export function estSurplombee(t: number): boolean {
  return estVoile(t) || estGlace(t)
}

/** Une surface : l'eau ou le marais — sans épaisseur (voir `SURFACES`). */
export function estSurface(t: number): boolean {
  return SURFACES[t] !== undefined
}

/** La priorité d'un terrain : −1 pour un structurel, le rang de surface pour l'eau et le marais,
 *  0 pour un terrain sans rang (il ne recouvre rien), sinon la table. */
export function prioriteDe(t: number): number {
  if (STRUCTURELS.has(t)) return -1
  const surface = SURFACES[t]
  if (surface !== undefined) return surface
  return PRIORITE_PAVE[t] ?? 0
}

/** Côtés d'une tuile, pour `frange`. */
export const COTE_N = 0
export const COTE_E = 1
export const COTE_S = 2
export const COTE_O = 3

/** La profondeur de frange d'un côté d'une tuile, par colonne (ou ligne) de 4 px : 2..5,
 *  irrégulière, DÉTERMINISTE par position (deux cuissons du même chunk sont identiques). */
export function frange(tx: number, ty: number, cote: number, along: number): number {
  const n = PAVE.FRANGE_MAX - PAVE.FRANGE_MIN + 1
  return PAVE.FRANGE_MIN + Math.floor(hash2(tx * 4 + cote, ty * 4 + along, 0xf1) * n)
}

/**
 * ═══ LA MOUCHETURE — LE GRAVIER EN CROÛTE D'UNE BUTTE D'AFFLEUREMENT ═══
 *
 * *(Décision d'Alexis, 2026-08-27, sur quatre planches rendues sur la vraie butte : « 4 ».)*
 *
 * Une butte porte DEUX tons : son fond (le gris chauffé, l'anthracite) et sa tache (la rouille,
 * la houille). Le tirage se faisait PAR TUILE — donc, depuis que le sol se cuit à 16 px, en
 * carrés de 16 px. Il se fait ici, à la maille de l'art :
 *   • la CELLULE DE `GRAIN_CELL_PX` (4 px), celle du grain — c'est le pas de la matière du jeu, et le seul qui
 *     lise encore comme du gravier ; à 2 px les deux tons fusionnent optiquement en un rouille
 *     uni et la roche grise disparaît (rendu, écarté sur planche) ;
 *   • un champ d'AMAS basse fréquence (3 tuiles) qui rassemble les cellules en croûtes — sans
 *     lui, une part uniforme donne un poivre et sel régulier, qui n'est pas ce qu'est un
 *     chapeau de fer ;
 *   • la DENSITÉ vient de l'appelant (`densiteDeMoucheture`, commandée par la pente vers le
 *     sommet) : la rouille gagne en montant.
 *
 * ⚠ **RIEN N'EST CALCULÉ HORS D'UNE BUTTE** : `moucheture` est demandée par TUILE et rend `null`
 * partout ailleurs — la lecture d'`fbm2` par pixel ne se paie que sur les ~1 600 tuiles de
 * rocaille de la carte, jamais sur le pré. C'est l'élagage du lapiaz, à sa maille.
 */
export const MOUCHETURE = {
  /** L'échelle du champ d'amas, en TUILES — des croûtes qu'on traverse, pas un semis. */
  AMAS_ECHELLE: 3,
  /** L'amas module la densité de `MIN` à `MIN + GAIN` (de moyenne ≈ 0,95 : la part est tenue). */
  AMAS_MIN: 0.2,
  AMAS_GAIN: 1.5,
}

/**
 * La cellule de 4 px du monde (wx, wy) prend-elle la tache ? Pur, positionnel, déterministe.
 *
 * ⚠ **L'AMAS SE LIT AU CENTRE DE LA CELLULE, PAS AU PIXEL** — et c'est ce qui fait de la cellule
 * une UNITÉ. Lu au pixel, le champ traverse son seuil À L'INTÉRIEUR d'une cellule au bord d'une
 * croûte : la marque s'y effiloche d'un pixel, et la maille de 4 px cesse d'être vraie (une
 * garde l'a attrapé). Au centre, la cellule est atomique — et l'on paie une lecture d'`fbm2`
 * par cellule au lieu de seize.
 */
export function mouchetureIci(wx: number, wy: number, densite: number, seed: number): boolean {
  const cx = (wx / GRAIN_CELL_PX) | 0
  const cy = (wy / GRAIN_CELL_PX) | 0
  const demi = GRAIN_CELL_PX / 2
  const amas = fbm2((cx * GRAIN_CELL_PX + demi) / PAVE_PX, (cy * GRAIN_CELL_PX + demi) / PAVE_PX,
    MOUCHETURE.AMAS_ECHELLE, (seed ^ 0x4d4f5543) | 0)
  return hash2(cx, cy, (seed ^ 0x7a1e) | 0) < densite * (MOUCHETURE.AMAS_MIN + MOUCHETURE.AMAS_GAIN * amas)
}

/**
 * ═══ L'ENGRENAGE — LE BORD ENTRE DEUX TERRAINS DE MÊME RANG (spec `sol-dessine.md` R25) ═══
 *
 * *(Décision d'Alexis, 2026-08-27, sur planche : « go engrenage ».)*
 *
 * `prendre` ne donne un pixel qu'à un pavé qui DOMINE STRICTEMENT. Entre deux terrains de même
 * rang — `scree`/`boulders`, `pine`/`larch`, `grass`/`heath` — personne ne cède : pas de frange,
 * pas un pixel déplacé, et le bord reste l'arête de tuile. MESURÉ avant le chantier (graine 2026,
 * vallée entière) : **40,6 %** des bords terre-terre étaient dans ce cas, 35,2 % hors paires à
 * `rock`. C'est le défaut que R20-R24 ne pouvaient pas voir — elles ont réparé la FORME à la
 * tuile, celui-ci vit SOUS la tuile.
 *
 * La règle : à rang égal, les deux pavés se débordent l'un sur l'autre, **par blocs de 4 px**,
 * chacun son tour — la denture s'imbrique au lieu que l'un passe devant. C'est la lecture honnête
 * de « même hauteur », et c'est ce qui la distingue d'un départage : aucune hiérarchie n'est
 * inventée, donc rien ne peut se lire comme une marche.
 *
 * ⚠ **LA FRANGE EST SEULE, ET ELLE L'EST SANS UNE LIGNE DE PLUS.** R15 avait tranché la question
 * pour le marais (frange seule : ni liseré, ni arête, ni tranche, ni ombre) et REFUSÉ sur planche
 * la variante qui donne de l'épaisseur à l'un des deux — « le même bord, mais le marais se lisait
 * comme une troisième herbe ». Ici la passe d'ombrage lit `ownP[voisin] < pk` pour le liseré et
 * `> pk` pour l'ombre : à rang égal, les deux sont faux. L'épaisseur ne peut pas apparaître.
 *
 * ⚠ **LE TIRAGE EST CELUI DE LA COUTURE, PAS CELUI DE LA TUILE** — sinon les deux voisines
 * tireraient chacune le leur et se disputeraient les mêmes pixels. La clé est la position du
 * BLOC DE COUTURE dans le monde (l'arête partagée, pas la tuile qui la regarde), et le sel est
 * la PAIRE de terrains, `min`/`max` : les deux côtés calculent le même tirage, et là où trois
 * terrains de même rang se rencontrent, chaque couture garde le sien.
 *
 * ⚠ **RIEN NE DOIT DÉPENDRE DE L'ORDRE DE BALAYAGE.** Relâcher `<` en `<=` dans `prendre` aurait
 * suffi à faire déborder tout le monde — mais c'est la tuile la plus TARDIVE de la boucle qui
 * aurait mangé sa voisine, et tous les bords de la carte auraient penché au sud-est. D'où ce
 * tirage positionnel, et un `prendreEgal` qui ne prend que le sol NU du perdant.
 */
export function engrenageGagne(
  gx: number, gy: number, cote: number, along: number, t: number, voisin: number,
): boolean {
  const vertical = cote === COTE_E || cote === COTE_O
  // La couture, en coordonnées du monde : l'arête partagée (et non la tuile qui la regarde),
  // repérée au bloc de 4 px. Les deux voisines tombent donc sur la même clé.
  const sx = vertical ? (cote === COTE_E ? gx + 1 : gx) : gx * 4 + along
  const sy = vertical ? gy * 4 + along : (cote === COTE_S ? gy + 1 : gy)
  const bas = t < voisin ? t : voisin
  const haut = t < voisin ? voisin : t
  const sel = (vertical ? 0x2c00 : 0x7b00) + bas * 61 + haut
  return (hash2(sx, sy, sel) < 0.5) === (t === bas)
}

/**
 * ═══ LE PAVEMENT DU LAPIAZ — le sol du chaos de blocs porte ses FISSURES ═══
 *
 * *(Décision d'Alexis, 2026-08-27, tranchée en jeu : « ok pour cette version ».)*
 *
 * Le chaos de blocs partageait la famille de grain de la ROUTE (« du gravier tassé ») et de la
 * falaise : le pays s'appelle pavement de calcaire et son sol disait caillou générique. Il a
 * désormais sa matière (`grain-sol.ts`, famille `dalle` — lisse, une table polie par l'eau) et
 * son motif : un PAVAGE de lauzes, tracé.
 *
 * ═══ ON TRACE, ON NE REMPLIT PAS — et c'est la correction qui a fait la version livrée ═══
 *
 * La première écriture peignait la dalle et l'allée du grand réseau de galeries (`champDuChaos`)
 * de deux VALEURS différentes, sur des polygones de onze tuiles à 33 % d'écart. Verdict en jeu :
 * *« les motifs sont trop larges, ça ne correspond pas à la DA actuelle »* — et c'était juste,
 * mesurable : toute la grammaire du sol de ce jeu tient en marques de **1 à 4 px** (les brins
 * font 1×2 px, le liseré 1 px, le grain trois crans à la maille de 4) et en écarts de l'ordre de
 * **15 %**. Un aplat de valeur étendu sur onze tuiles ne se lit pas comme du sol dessiné : il se
 * lit comme une ZONE de terrain, c'est-à-dire comme le langage d'à côté.
 *
 * Deux traits, donc, et le fond garde partout sa valeur :
 *
 *   • LA FISSURE DU PAVAGE (≈ 1 px, pas de `LAPIAZ.PAS`) — c'est elle qui donne sa matière au
 *     pavement, et elle est à l'échelle du PROP, pas du paysage.
 *   • LA FISSURE MAÎTRESSE (≈ 2 px) — le CŒUR d'une allée du grand réseau, tracé au lieu d'être
 *     rempli. Elle garde le dédale présent à l'œil sans étaler une valeur dessus.
 *
 * ⚠ **LE PLAN DU LABYRINTHE N'A PAS BESOIN DU SOL POUR SE DIRE.** Les BLOCS le portent déjà, en
 * volume et en collision — c'est ce qui autorise le sol à n'en donner qu'un trait.
 *
 * ⚠ **LE JOINT EST DE LA PIERRE, PAS DE LA TERRE.** La première planche le tirait à pleine
 * chaleur : les allées sortaient ocre et le lapiaz se lisait comme des îlots dans de la boue.
 * Une fissure de calcaire est grise, à peine réchauffée par ce qui s'y dépose.
 *
 * ⚠ **LA GÉOMÉTRIE VIENT DE LA SIM, PAS D'UNE COPIE.** La fissure maîtresse se lit dans
 * `champDuChaos` — le champ même dont `galerieDuChaos` tire le vide qu'on marche. Ce qu'on voit
 * est donc exactement ce qu'on parcourt, et une retouche du dédale ne peut pas laisser le
 * dessin derrière elle. Le pavage fin, lui, ne porte aucune règle : il est de l'ART pur, il a
 * son propre pas et il ne demande rien à la sim.
 */
export const LAPIAZ = {
  /**
   * ⚠ **LA PREMIÈRE ÉCRITURE REMPLISSAIT, ET C'ÉTAIT LE MAUVAIS REGISTRE.** *(Alexis, 2026-08-27,
   * sur le rendu en jeu : « les motifs sont trop larges, ça ne correspond pas à la DA actuelle ».)*
   * Elle peignait la dalle et l'allée de deux VALEURS différentes sur des polygones de **11
   * tuiles**, à **33 %** d'écart. Or toute la grammaire du sol de ce jeu tient en marques de 1 à
   * 4 px (les brins font 1×2 px, le liseré 1 px, le grain trois crans à la maille de 4) et en
   * écarts de l'ordre de 15 %. Un aplat de valeur étendu sur onze tuiles ne se lit pas comme du
   * sol dessiné : il se lit comme une ZONE de terrain — c'est-à-dire comme le langage d'à côté.
   *
   * Le réseau ne se remplit donc plus, il se TRACE. Deux largeurs de fissure, rien d'autre :
   * la caillasse garde partout la même valeur de base, et seules les lignes la creusent.
   */
  /**
   * LE PAVAGE — le pas du réseau FIN, en tuiles. C'est lui qui donne sa matière au pavement, et
   * il est à l'échelle du PROP, pas du paysage : une lauze fait une tuile ou deux, comme un pavé
   * de la grammaire choisie le 2026-08-22. À 11 tuiles on dessinait la géologie ; à 1,8 on
   * dessine ce que le pied foule.
   */
  PAS: 1.8,
  /**
   * La demi-largeur de la fissure fine, en unités de `F2 − F1`. Près d'une arête ce champ croît
   * d'environ DEUX par tuile : 0,13 fait donc à peu près **un pixel d'art**. C'est la largeur
   * d'un liseré, et c'est voulu — on n'a pas d'autre trait plus fin dans ce sol.
   */
  FIN: 0.13,
  /** Le facteur de la fissure fine. −10 %, l'ordre de grandeur d'un cran de grain. */
  F_FIN: 0.9,
  /**
   * LA FISSURE MAÎTRESSE — le CŒUR de l'allée du grand réseau (`champDuChaos`), tracé au lieu
   * d'être rempli. Elle garde le dédale présent à l'œil (la ligne se poursuit d'un bord à
   * l'autre) sans étaler une valeur sur onze tuiles : deux pixels au lieu d'un, et c'est tout
   * ce qui la distingue d'une fissure de surface. Le plan du labyrinthe, lui, reste porté par
   * les BLOCS — ils le disent déjà, en volume.
   */
  MAITRESSE: 0.09,
  /** Le facteur de la fissure maîtresse : plus creuse que les autres, sans être un trou. */
  F_MAITRESSE: 0.84,
  /** La teinte de ce qui se dépose au fond d'une fissure, par canal. À peine — c'est de la
   *  pierre, pas de la terre (leçon de la première planche, où les allées sortaient ocre). */
  TEINTE_R: 0.05,
  TEINTE_V: 0.01,
  TEINTE_B: -0.04,

  // ═══ LE RELIEF — une fissure a deux bords, et ils ne prennent pas la même lumière ═══
  /** La profondeur d'une fissure, en unités du champ de hauteur. La maîtresse est plus creuse ;
   *  c'est tout ce qui les distingue en relief, comme en albédo. */
  CREUX_FIN: 0.55,
  CREUX_MAITRESSE: 1,
  /** La PENTE : de combien la normale bascule pour une unité de profondeur par pixel. Haut =
   *  des lèvres franches (le parti « cube » du 24/07), bas = un dôme mou. */
  PENTE: 3.2,
  /** Le seuil de POSTÉRISATION du relief. Sous lui, la lèvre se tait : c'est ce qui garde trois
   *  valeurs franches au lieu d'un dégradé — la même règle que partout ailleurs dans ce sol. */
  RELIEF_SEUIL: 0.1,
  /** Les deux facteurs de lèvre : celle qui prend le jour, celle qui s'en détourne. */
  F_LEVRE: 1.12,
  F_OMBRE: 0.86,
  /**
   * LE BIAIS NORD ET LA HAUTEUR DU SOLEIL, en unités de son décalage est-ouest.
   *
   * Ce sont les proportions de `DynamicLighting` (`SUN_FAR` 2200, `SUN_NORTH` 1600, `SUN_Z` 620),
   * pas des nombres neufs : le sol doit être éclairé par LE soleil du jeu, celui qui pose déjà
   * les lumières des houppiers et le couloir spéculaire de l'eau. Un second soleil dériverait
   * du premier — le défaut que `water-layer.ts` a documenté et corrigé.
   */
  NORD: 1600 / 2200,
  HAUTEUR: 620 / 2200,
} as const

/**
 * LE VECTEUR VERS LE SOLEIL, en espace ÉCRAN (x est+, y sud+, z vers le spectateur), unitaire.
 *
 * `dirX` est la seule entrée : c'est `sunDirection(heure).x` de `render/lighting.ts` — +1 à
 * l'aube (est), 0 vers 13 h, −1 au couchant. Le reste (le biais nord, la hauteur) est une
 * constante de la scène, comme dans `DynamicLighting`.
 *
 * ⚠ **`dirX = 0` N'EST PAS « PAS DE SOLEIL »** : c'est le soleil de MIDI, plein nord, et c'est
 * exactement la convention que le pavé truque déjà partout (`ARETE_HAUTE` en haut, `LISERE` en
 * bas et sur les côtés — une lumière qui vient du haut de l'écran). Un pavement à soleil figé
 * se demande donc en passant zéro, sans autre chemin de code.
 */
export function soleilDuPavement(dirX: number): { x: number; y: number; z: number } {
  const x = dirX
  const y = -LAPIAZ.NORD
  const z = LAPIAZ.HAUTEUR
  const l = Math.sqrt(x * x + y * y + z * z) || 1
  return { x: x / l, y: y / l, z: z / l }
}

/**
 * L'ÉCART AU JOINT DU PAVAGE — `F2 − F1` d'un Worley au pas de `LAPIAZ.PAS`, rendu par une
 * FABRIQUE qui pose les sites UNE FOIS pour tout le chunk.
 *
 * ⚠ **DEUX OPTIMISATIONS, ET ELLES NE SONT PAS DU CONFORT.** Ce trait se lit AU PIXEL (c'est ce
 * qui lui donne sa finesse d'un pixel, là où le grand réseau se contente de la cellule de 4) :
 * un chunk en fait soixante-six mille lectures. MESURÉ en écrivant naïvement — 18 `hash2` et
 * 9 `sqrt` par pixel — la cuisson d'un chunk de chaos passait de 86 à 102 ms, +18 %.
 *
 *   ① LES SITES SONT PRÉ-POSÉS. Le pas est de 1,8 tuile : un chunk et son débord ne couvrent
 *      qu'une dizaine de cases de grille dans chaque sens. On les jitte une fois, et le pixel ne
 *      fait plus que des différences.
 *   ② LA RACINE VIENT EN DERNIER. On classe sur les distances au CARRÉ — l'ordre est le même —
 *      et l'on n'extrait que les deux racines qui comptent, au lieu de neuf.
 *
 * Pur : `+ - * /`, `floor`, `sqrt`, `hash2`.
 */
function fabriquePavage(fx0: number, fy0: number, cote: number, seed: number): (fx: number, fy: number) => number {
  const S = LAPIAZ.PAS
  const sel = (seed ^ 0x4c415a45) | 0 /* 'LAZE' */
  const selY = (sel ^ 0x5a5a5a5a) | 0
  const gx0 = Math.floor(fx0 / S) - 1
  const gy0 = Math.floor(fy0 / S) - 1
  const NG = Math.floor((fx0 + cote) / S) - gx0 + 2
  const NGY = Math.floor((fy0 + cote) / S) - gy0 + 2
  const sx = new Float32Array(NG * NGY)
  const sy = new Float32Array(NG * NGY)
  for (let j = 0; j < NGY; j++) {
    for (let i = 0; i < NG; i++) {
      const cx = gx0 + i
      const cy = gy0 + j
      sx[j * NG + i] = (cx + hash2(cx, cy, sel)) * S
      sy[j * NG + i] = (cy + hash2(cx, cy, selY)) * S
    }
  }
  return (fx: number, fy: number): number => {
    const i0b = Math.floor(fx / S) - gx0
    const j0b = Math.floor(fy / S) - gy0
    // Aucune borne à vérifier : la grille est posée avec UNE case de marge de chaque côté
    // (`gx0 − 1`, `NG + 2`), donc les neuf voisines d'un pixel du chunk existent toujours.
    let d1 = Infinity
    let d2 = Infinity
    for (let dj = -1; dj <= 1; dj++) {
      const base = (j0b + dj) * NG + i0b
      for (let di = -1; di <= 1; di++) {
        const ex = sx[base + di]! - fx
        const ey = sy[base + di]! - fy
        const d = ex * ex + ey * ey
        if (d < d1) { d2 = d1; d1 = d } else if (d < d2) { d2 = d }
      }
    }
    return Math.sqrt(d2) - Math.sqrt(d1)
  }
}

export interface CuissonChunk {
  /** Coordonnées du chunk, en chunks. */
  cx: number
  cy: number
  /** Le terrain d'une tuile (coordonnées carte) — hors carte : un structurel (void). */
  terrainAt: (tx: number, ty: number) => number
  /** La couleur de sol d'une tuile, 0xRRGGBB — le bake, modulation de zone et damier compris. */
  couleurAt: (tx: number, ty: number) => number
  /** La TRAME de grain d'un terrain : `GRAIN_CELLS²` facteurs, une cellule de `GRAIN_CELL_PX`
   *  px monde, tuilée (`grain-sol.ts`) — ou `null` pour un terrain sans matière. */
  trameDe: (t: number) => Float32Array | null
  /** LA MOUCHETURE d'une tuile (`render/buttes.ts`) : le second ton de la rocaille d'une butte
   *  et sa densité, ou `null` — la carte entière sauf ~1 600 tuiles. Voir `MOUCHETURE`. */
  moucheture?: (tx: number, ty: number) => { tache: number; densite: number } | null
  /** La graine du monde — le pavement du lapiaz lit le MÊME champ que la sim (`champDuChaos`),
   *  et un champ seedé sans sa graine ne dessinerait pas le dédale qu'on marche. */
  seed: number
  /** Le vecteur vers le soleil (`soleilDuPavement`) : il décide de quel côté d'une fissure tombe
   *  la lèvre claire. Passer `soleilDuPavement(0)` fige la lumière plein nord, la convention du
   *  liseré ; passer `soleilDuPavement(sunDirection(heure).x)` la fait tourner avec le jour. */
  soleil: { x: number; y: number; z: number }
}

/** Le côté d'un chunk en px d'art, SANS le débord — la maille du monde (16 tuiles × 16 px). */
export const PAVE_COTE = PAVE.CHUNK * PAVE_PX
/** LA MARGE DE LECTURE d'une cuisson, en TUILES : `cuireChunk` lit une tuile tout autour du chunk
 *  (les franges et les ombres débordent jusqu'à 5 px). Elle est exportée parce qu'une autre couche
 *  doit savoir CE QUE le chunk regarde — l'invalidation de la cendre (`cendre-chunk.ts`) balaie
 *  exactement ce périmètre. La réécrire là-bas rouvrirait le défaut sur une tuile de large. */
export const PAVE_MARGE_TUILES = 1
/** Le côté de l'IMAGE cuite, débord compris : ce que mesurent les textures posées. */
export const PAVE_COTE_BAVE = PAVE_COTE + 2 * PAVE.BAVE

export interface ChunkCuit {
  /** Le sol, SOUS le shader d'eau : opaque sur la terre, transparent sur l'eau et les structurels. */
  sol: Uint8ClampedArray
  /** Le surplomb, AU-DESSUS du shader d'eau : ce qui tombe sur une tuile d'eau — frange de terre,
   *  ombre, ressac. `null` si le chunk n'a pas d'eau (aucune texture à poser). */
  surplomb: Uint8ClampedArray | null
  /** Ce chunk porte-t-il du RELIEF (du pavement de lapiaz) ? C'est la seule chose que la course
   *  du soleil périme : un chunk plat rend la même image à toute heure, et le repérer ici évite
   *  de recuire toute la carte douze fois par jour. */
  relief: boolean
}

/**
 * LE TAMPON DE PROFONDEUR, réutilisé d'une cuisson à l'autre — 258² flottants, soit 266 Ko qu'on
 * n'a aucune raison de rendre au ramasse-miettes quarante fois par seconde. Il est INTÉGRALEMENT
 * réécrit à chaque cuisson (chaque pixel reçoit sa valeur ou zéro), donc rien d'une cuisson ne
 * peut fuir dans la suivante — c'est ce qui autorise un état module dans une fonction pure.
 */
let scratch: Float32Array | null = null
function profondeurScratch(cote: number): Float32Array {
  if (!scratch || scratch.length < cote * cote) scratch = new Float32Array(cote * cote)
  return scratch
}

/**
 * CUIT UN CHUNK : rend les tampons RGBA de `PAVE_COTE_BAVE²` pixels (le chunk PLUS son débord
 * d'un pixel tout autour, voir `PAVE.BAVE`), ligne par ligne, haut en bas. Le pixel (0, 0) du
 * tampon est donc le pixel monde `(cx × CHUNK × 16) − 1` : qui pose l'image la décale d'autant.
 *
 * Deux passes. ① Les PROPRIÉTAIRES : chaque pixel appartient d'abord à sa tuile ; puis chaque
 * tuile étend sa frange sur ses voisines de priorité inférieure (côtés, puis chanfreins de
 * coin) — un pixel ne change de main que pour un pavé STRICTEMENT plus haut. ② L'OMBRAGE :
 * liseré, arête, tranche, ombre portée, brins, lus sur la carte des propriétaires.
 *
 * La grille locale porte UNE tuile de marge tout autour du chunk (les franges et les ombres
 * lisent jusqu'à 5 px hors du chunk) : aucun accès hors tableau, aucune couture entre chunks —
 * la marge est recuite à l'identique par le chunk voisin, par construction (tout est
 * positionnel).
 */
export function cuireChunk(p: CuissonChunk): ChunkCuit {
  const N = PAVE.CHUNK
  const P = PAVE_PX
  const L = N + 2 * PAVE_MARGE_TUILES // tuiles locales, marge comprise
  const LP = L * P // pixels locaux
  const tx0 = p.cx * N - PAVE_MARGE_TUILES // tuile carte de la colonne locale 0
  const ty0 = p.cy * N - PAVE_MARGE_TUILES

  // ── Les tuiles locales : terrain, priorité, couleur, trame, brins ──
  const terr = new Int16Array(L * L)
  const prio = new Int8Array(L * L)
  const coul = new Uint32Array(L * L)
  const trames: (Float32Array | null)[] = new Array(L * L)
  const mouch: ({ tache: number; densite: number } | null)[] | null = p.moucheture ? new Array(L * L) : null
  const brins = new Int8Array(L * L * PAVE.BRINS_PAR_TUILE * 2)
  for (let ly = 0; ly < L; ly++) {
    for (let lx = 0; lx < L; lx++) {
      const k = ly * L + lx
      const t = p.terrainAt(tx0 + lx, ty0 + ly)
      terr[k] = t
      prio[k] = prioriteDe(t)
      coul[k] = p.couleurAt(tx0 + lx, ty0 + ly)
      trames[k] = p.trameDe(t)
      if (mouch) mouch[k] = p.moucheture!(tx0 + lx, ty0 + ly)
      for (let j = 0; j < PAVE.BRINS_PAR_TUILE; j++) {
        brins[(k * PAVE.BRINS_PAR_TUILE + j) * 2] = 1 + Math.floor(hash2(tx0 + lx, ty0 + ly, 3 + j) * (P - 3))
        brins[(k * PAVE.BRINS_PAR_TUILE + j) * 2 + 1] = 1 + Math.floor(hash2(tx0 + lx, ty0 + ly, 5 + j) * (P - 4))
      }
    }
  }

  // ── ① Les propriétaires, à la tuile locale ──
  const owner = new Int32Array(LP * LP)
  for (let py = 0; py < LP; py++) {
    const ly = (py / P) | 0
    for (let px = 0; px < LP; px++) owner[py * LP + px] = ly * L + ((px / P) | 0)
  }
  /** Donne le pixel (px, py) au pavé `k` s'il domine strictement le propriétaire courant. */
  const prendre = (px: number, py: number, k: number, pk: number): void => {
    if (px < 0 || py < 0 || px >= LP || py >= LP) return
    const i = py * LP + px
    if (prio[owner[i]!]! < pk) owner[i] = k
  }
  /**
   * L'ENGRENAGE (R25) : la dent du pavé `k` mord sur le sol NU de son voisin de même rang `kv`.
   * Elle ne prend QUE ce que `kv` tient encore lui-même — un pavé de rang supérieur qui a déjà
   * débordé là garde son pixel, et une dent voisine qui a déjà mordu le même creux (ça n'arrive
   * qu'aux coins, sur quelques pixels) n'est pas repoussée. Rien n'est jamais volé à personne.
   */
  const prendreEgal = (px: number, py: number, k: number, kv: number): void => {
    if (px < 0 || py < 0 || px >= LP || py >= LP) return
    const i = py * LP + px
    if (owner[i] === kv) owner[i] = k
  }
  for (let ly = 0; ly < L; ly++) {
    for (let lx = 0; lx < L; lx++) {
      const k = ly * L + lx
      const pk = prio[k]!
      if (pk <= 0) continue // structurel ou sans rang : ne déborde jamais
      const tk = terr[k]!
      const gx = tx0 + lx
      const gy = ty0 + ly
      const x0 = lx * P
      const y0 = ly * P
      const x1 = x0 + P
      const y1 = y0 + P
      // Un voisin de côté cède-t-il ? (dans la grille locale, non structurel, priorité plus basse)
      const cede = (nx: number, ny: number): boolean => {
        if (nx < 0 || ny < 0 || nx >= L || ny >= L) return false
        const q = prio[ny * L + nx]!
        return q >= 0 && q < pk
      }
      const nordCede = cede(lx, ly - 1)
      const sudCede = cede(lx, ly + 1)
      const ouestCede = cede(lx - 1, ly)
      const estCede = cede(lx + 1, ly)
      /**
       * L'ENGRENAGE (R25) : le voisin est-il de MÊME RANG, et éligible à la denture ?
       *
       * ⚠ **LES SURFACES EN SONT EXCLUES, ET C'EST R15 QUI LE DIT** : la vase, la glace, l'assec
       * et le gué fermé sont à égalité EXPRÈS — « une frange de plus y ferait un double trait, et
       * la vase mangerait la rive », la berge du sol ayant déjà tracé ce bord.
       * ⚠ **`rock` EN EST EXCLU, ET C'EST R22** : la roche du vide EST une hauteur (comme la
       * falaise, déjà structurelle), elle reste rectiligne. Elle partage pourtant le rang 3 avec
       * l'éboulis et le chaos de blocs — 5,4 % des bords de la vallée, qu'on attendrirait en
       * croyant bien faire.
       */
      const engrene = (nx: number, ny: number): boolean => {
        if (nx < 0 || ny < 0 || nx >= L || ny >= L) return false
        const j = ny * L + nx
        const tv = terr[j]!
        return prio[j]! === pk && tv !== tk && !estSurface(tv) && tv !== TERRAIN_ROCK
      }
      const engrenable = !estSurface(tk) && tk !== TERRAIN_ROCK
      const nordEng = engrenable && !nordCede && engrene(lx, ly - 1)
      const sudEng = engrenable && !sudCede && engrene(lx, ly + 1)
      const ouestEng = engrenable && !ouestCede && engrene(lx - 1, ly)
      const estEng = engrenable && !estCede && engrene(lx + 1, ly)
      const kN = (ly - 1) * L + lx
      const kS = (ly + 1) * L + lx
      const kO = ly * L + lx - 1
      const kE = ly * L + lx + 1
      for (let c = 0; c < P / 4; c++) {
        // Par côté : soit le voisin CÈDE (domination stricte, la frange ordinaire), soit il est
        // de même rang et la dent de ce bloc-ci nous revient (l'engrenage). Jamais les deux.
        if (nordCede || (nordEng && engrenageGagne(gx, gy, COTE_N, c, tk, terr[kN]!))) {
          const d = frange(gx, gy, COTE_N, c)
          for (let dy = 1; dy <= d; dy++) for (let u = 0; u < 4; u++) {
            if (nordCede) prendre(x0 + 4 * c + u, y0 - dy, k, pk)
            else prendreEgal(x0 + 4 * c + u, y0 - dy, k, kN)
          }
        }
        if (sudCede || (sudEng && engrenageGagne(gx, gy, COTE_S, c, tk, terr[kS]!))) {
          const d = frange(gx, gy, COTE_S, c)
          for (let dy = 0; dy < d; dy++) for (let u = 0; u < 4; u++) {
            if (sudCede) prendre(x0 + 4 * c + u, y1 + dy, k, pk)
            else prendreEgal(x0 + 4 * c + u, y1 + dy, k, kS)
          }
        }
        if (ouestCede || (ouestEng && engrenageGagne(gx, gy, COTE_O, c, tk, terr[kO]!))) {
          const d = frange(gx, gy, COTE_O, c)
          for (let dx = 1; dx <= d; dx++) for (let u = 0; u < 4; u++) {
            if (ouestCede) prendre(x0 - dx, y0 + 4 * c + u, k, pk)
            else prendreEgal(x0 - dx, y0 + 4 * c + u, k, kO)
          }
        }
        if (estCede || (estEng && engrenageGagne(gx, gy, COTE_E, c, tk, terr[kE]!))) {
          const d = frange(gx, gy, COTE_E, c)
          for (let dx = 0; dx < d; dx++) for (let u = 0; u < 4; u++) {
            if (estCede) prendre(x1 + dx, y0 + 4 * c + u, k, pk)
            else prendreEgal(x1 + dx, y0 + 4 * c + u, k, kE)
          }
        }
      }
      // Les CHANFREINS de coin : dans la diagonale qui cède, un triangle `ox + oy ≤ f − 1`, avec
      // f la plus petite des deux franges qui se rencontrent. Un coin convexe s'arrondit, un
      // coin rentrant se remplit par l'union des deux côtés.
      //
      // ⚠ **PAS DE CHANFREIN À RANG ÉGAL** (R25) : le chanfrein arrondit le coin de CELUI QUI
      // DOMINE, et il n'y a pas de dominant ici. Sur une denture qui s'imbrique, les deux
      // arrondiraient le même coin chacun de son côté — un rond-point, pas une dent. Le bord est
      // déjà cassé tous les 4 px : le coin n'a rien à rattraper.
      const derniere = P / 4 - 1
      const coin = (sx: number, sy: number): void => {
        if (!cede(lx + sx, ly + sy)) return
        const fH = frange(gx, gy, sy < 0 ? COTE_N : COTE_S, sx < 0 ? 0 : derniere)
        const fV = frange(gx, gy, sx < 0 ? COTE_O : COTE_E, sy < 0 ? 0 : derniere)
        const f = Math.min(fH, fV)
        for (let oy = 1; oy <= f - 2; oy++) {
          for (let ox = 1; ox + oy <= f - 1; ox++) {
            const px = sx < 0 ? x0 - ox : x1 - 1 + ox
            const py = sy < 0 ? y0 - oy : y1 - 1 + oy
            prendre(px, py, k, pk)
          }
        }
      }
      coin(-1, -1)
      coin(1, -1)
      coin(-1, 1)
      coin(1, 1)
    }
  }

  // ── ② L'ombrage, sur les pixels du chunk (la marge n'est pas rendue) ──
  //
  // Le terrain et la priorité du PROPRIÉTAIRE de chaque pixel, aplatis une fois : la passe
  // d'ombrage lit huit voisins par pixel, et c'est elle qui fait le coût d'un chunk (MESURÉ :
  // 600 ms par chunk avec des fermetures et des recherches par pixel ; des tableaux typés
  // ramènent ça à quelques ms).
  const ownT = new Int16Array(LP * LP)
  const ownP = new Int8Array(LP * LP)
  for (let i = 0; i < LP * LP; i++) {
    const k = owner[i]!
    ownT[i] = terr[k]!
    ownP[i] = prio[k]!
  }
  // Le tampon rendu porte le DÉBORD (`PAVE.BAVE`) tout autour : il commence un pixel AVANT le
  // chunk et finit un pixel après, pour que deux images voisines se recouvrent au lieu de se
  // toucher. La marge locale fait une TUILE — lire un pixel de plus reste largement dedans.
  const SB = PAVE_COTE_BAVE
  // ═══ LE PAVEMENT DU LAPIAZ — la PROFONDEUR d'abord, l'image ensuite ═══
  //
  // On cuit un champ de PROFONDEUR au pixel (0 = la table, 1 = le fond d'une fissure), puis le
  // reste s'en dérive : l'albédo par un seuil, et le RELIEF par le gradient de ce même champ.
  // Deux lectures, une vérité — la lèvre claire ne peut pas se retrouver ailleurs que la
  // fissure qu'elle borde.
  //
  // ⚠ **LE CHAMP DU GRAND RÉSEAU RESTE LU À LA CELLULE DE 4 px, ET IL SERT D'ÉLAGAGE.** La
  // fissure maîtresse ne vit qu'au cœur d'une allée ; partout ailleurs on s'épargne
  // `champDuChaos`, qui porte un `fbm2`. Neuf pixels sur dix sont écartés par cette lecture.
  // Le pavage fin, lui, se lit AU PIXEL — c'est ce qui lui donne son trait d'un pixel.
  //
  // Rien n'est alloué ni calculé si le chunk ne porte pas de chaos de blocs.
  const CELL = GRAIN_CELL_PX
  const wpx0 = tx0 * P + (P - PAVE.BAVE)
  const wpy0 = ty0 * P + (P - PAVE.BAVE)
  const bcx = Math.floor(wpx0 / CELL)
  const bcy = Math.floor(wpy0 / CELL)
  const NC = Math.floor((wpx0 + SB - 1) / CELL) - bcx + 1
  const NCY = Math.floor((wpy0 + SB - 1) / CELL) - bcy + 1
  let relief = false
  for (let q = 0; q < L * L; q++) if (terr[q] === TERRAIN_BOULDERS) { relief = true; break }
  let creux: Float32Array | null = null
  if (relief) {
    const champ = new Float32Array(NC * NCY)
    for (let cy = 0; cy < NCY; cy++) {
      const fy = ((bcy + cy) * CELL + CELL / 2) / P
      for (let cx = 0; cx < NC; cx++) champ[cy * NC + cx] = champDuChaos(((bcx + cx) * CELL + CELL / 2) / P, fy, p.seed)
    }
    const pavage = fabriquePavage(wpx0 / P, wpy0 / P, SB / P, p.seed)
    creux = profondeurScratch(SB + 2)
    // ⚠ **UN ANNEAU DE PLUS QUE L'IMAGE**, et ce n'est pas du confort : le gradient d'un pixel
    // du bord lit ses deux voisins. Sans cet anneau, le pixel du débord n'aurait pas de gradient
    // là où son chunk voisin lui en donne un — la couture invisible de R17 redeviendrait visible,
    // et le test de positionnalité l'attrape.
    for (let y = -1; y <= SB; y++) {
      const py2 = y + P - PAVE.BAVE
      const ly2 = Math.max(0, Math.min(L - 1, (py2 / P) | 0))
      const fy = (ty0 * P + py2) / P
      const cyc = Math.max(0, Math.min(NCY - 1, (((ty0 * P + py2) / CELL) | 0) - bcy)) * NC
      for (let x = -1; x <= SB; x++) {
        const px2 = x + P - PAVE.BAVE
        // La profondeur ne se calcule QUE sur les tuiles de chaos : ailleurs elle vaut zéro, et
        // le gradient au bord dit alors exactement ce qu'il doit dire — la roche s'arrête là.
        const k2 = (y + 1) * (SB + 2) + (x + 1)
        if (terr[ly2 * L + Math.max(0, Math.min(L - 1, (px2 / P) | 0))] !== TERRAIN_BOULDERS) { creux[k2] = 0; continue }
        const fx = (tx0 * P + px2) / P
        const grossier = champ[cyc + Math.max(0, Math.min(NC - 1, (((tx0 * P + px2) / CELL) | 0) - bcx))]!
        let d = 0
        if (grossier < 0.35) {
          const u = champDuChaos(fx, fy, p.seed)
          if (u < LAPIAZ.MAITRESSE) d = (1 - u / LAPIAZ.MAITRESSE) * LAPIAZ.CREUX_MAITRESSE
        }
        if (d === 0) {
          const e = pavage(fx, fy)
          if (e < LAPIAZ.FIN) d = (1 - e / LAPIAZ.FIN) * LAPIAZ.CREUX_FIN
        }
        creux[k2] = d
      }
    }
  }
  const out = new Uint8ClampedArray(SB * SB * 4)
  // Le surplomb n'est alloué que si le chunk (marge comprise) touche une tuile surplombée.
  let eauVue = false
  for (let k = 0; k < L * L && !eauVue; k++) eauVue = estSurplombee(terr[k]!)
  const sur = eauVue ? new Uint8ClampedArray(SB * SB * 4) : null
  const B = PAVE.BRINS_PAR_TUILE
  for (let y = 0; y < SB; y++) {
    const py = y + P - PAVE.BAVE
    // La ligne de cellules de grain (GRAIN_CELLS est une puissance de deux : le masque tuile).
    const cyG = (((ty0 * P + py) / GRAIN_CELL_PX) | 0) & (GRAIN_CELLS - 1)
    const ly = (py / P) | 0
    for (let x = 0; x < SB; x++) {
      const px = x + P - PAVE.BAVE
      const i = py * LP + px
      const pk = ownP[i]!
      if (pk < 0) continue // structurel : transparent, le bake reste maître
      const k = owner[i]!
      const t = ownT[i]!
      const o = (y * SB + x) * 4
      // Le pixel est-il SUR une tuile surplombée (eau, dessous, glace) ? (sa propre tuile, pas
      // son propriétaire)
      const tSol = terr[ly * L + ((px / P) | 0)]!
      const surEau = estSurplombee(tSol)
      // Le propriétaire est-il une SURFACE (eau, marais) ? Pas d'épaisseur : ni liseré, ni arête,
      // ni tranche, ni brin — et l'ombre et le ressac ne viennent que d'un pavé à épaisseur.
      const tSurf = estSurface(t)
      // Le pavé du DESSOUS se lit au terrain (deux tuiles de même terrain ne font pas de bord),
      // celui du DESSUS aussi.
      const iU = i - LP, iD = i + LP, iL = i - 1, iR = i + 1
      const basU = ownT[iU] !== t && ownP[iU]! < pk
      const basD = ownT[iD] !== t && ownP[iD]! < pk
      const basL = ownT[iL] !== t && ownP[iL]! < pk
      const basR = ownT[iR] !== t && ownP[iR]! < pk
      let f: number
      // LES FACTEURS PAR CANAL — neutres partout sauf dans le joint du lapiaz, qui se réchauffe
      // à peine (une fissure de calcaire est grise). Une luminance seule ne saurait pas le dire.
      let kr = 1
      let kv = 1
      let kb = 1
      // Un pavé à épaisseur au-dessus de ce pixel (à `n` lignes) : celui qui porte une ombre.
      const domine = (j: number): boolean => ownT[j] !== t && ownP[j]! > pk && !estSurface(ownT[j]!)
      // Une surface n'a ni liseré ni arête ni tranche ; elle reçoit l'ombre de la berge, puis le
      // ressac — d'un pavé à épaisseur seulement : la boue qui glisse sur l'eau n'ombre rien.
      if (!tSurf && (basD || basL || basR)) f = PAVE.LISERE
      else if (!tSurf && basU) f = PAVE.ARETE_HAUTE
      else if (!tSurf && ownT[iD + LP] !== t && ownP[iD + LP]! < pk) f = PAVE.TRANCHE
      else if (domine(iU) || domine(iU - LP)) f = PAVE.OMBRE
      else if (domine(iU - 2 * LP)) f = PAVE.PENOMBRE
      // Le ressac : sur l'eau et la boue — jamais sur le dessous ni sur la glace (ça ne clapote pas).
      else if (tSurf && !estDessous(t) && !estGlace(t) && domine(iU - 3 * LP)) f = PAVE.RESSAC
      else if (domine(iL) || domine(iR)) f = PAVE.OMBRE_LATERALE
      else if (estVoile(t)) continue // l'eau nue, le dessous nu : rien à peindre ici
      else if (tSurf) f = 1 // le marais nu, la glace nue : plat, sans brin
      else if (creux && t === TERRAIN_BOULDERS) {
        // ① L'ALBÉDO : trois valeurs franches, décidées par la seule profondeur.
        const kc = (y + 1) * (SB + 2) + (x + 1)
        const d = creux[kc]!
        const maitresse = d > LAPIAZ.CREUX_FIN
        const fine = d > 0 && !maitresse
        f = maitresse ? LAPIAZ.F_MAITRESSE : fine ? LAPIAZ.F_FIN : 1
        const chaud = maitresse ? 1 : fine ? 0.6 : 0
        // ② LE RELIEF : le gradient du MÊME champ, éclairé par LE soleil du jeu.
        //    Une fissure a deux bords ; celui qui fait face à la lumière prend une lèvre claire,
        //    celui qui s'en détourne une ombre. Postérisé en TROIS crans (lèvre · rien · ombre)
        //    au seuil `RELIEF_SEUIL` : un dégradé serait un aérographe, et le sol de ce jeu n'en
        //    a nulle part. C'est le côté qui bascule quand le soleil traverse le ciel — la
        //    même bascule que l'ombre portée d'un houppier, à un pixel près.
        const gx = (creux[kc + 1]! - creux[kc - 1]!) * LAPIAZ.PENTE
        const gy = (creux[kc + SB + 2]! - creux[kc - SB - 2]!) * LAPIAZ.PENTE
        const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1)
        // n = (gx, gy, 1)/‖…‖ — la hauteur vaut −creux, d'où le signe direct du gradient.
        const ecart = (gx * p.soleil.x + gy * p.soleil.y + p.soleil.z) * inv - p.soleil.z
        if (ecart > LAPIAZ.RELIEF_SEUIL) f *= LAPIAZ.F_LEVRE
        else if (ecart < -LAPIAZ.RELIEF_SEUIL) f *= LAPIAZ.F_OMBRE
        kr = 1 + LAPIAZ.TEINTE_R * chaud
        kv = 1 + LAPIAZ.TEINTE_V * chaud
        kb = 1 + LAPIAZ.TEINTE_B * chaud
        // Pas de BRIN sur la dalle : la variation du lapiaz est sa fissure, pas un moucheté.
      }
      else {
        f = 1
        // Les brins, dans le repère de la tuile PROPRIÉTAIRE (un brin peut vivre dans la frange).
        const lxk = k % L
        const lyk = (k - lxk) / L
        const ox = px - lxk * P
        const oy = py - lyk * P
        for (let j = 0; j < B; j++) {
          const bx = brins[(k * B + j) * 2]!
          const by = brins[(k * B + j) * 2 + 1]!
          if (ox === bx && (oy === by || oy === by + 1)) f = PAVE.BRIN_CLAIR
          else if (ox === bx + 1 && oy === by + 2) f = PAVE.BRIN_SOMBRE
        }
      }
      if (estVoile(t)) {
        // L'EAU OMBRÉE OU MOUILLÉE (et le dessous ombré par la neige) va au surplomb, en voile :
        // noir à l'alpha (1 − f) pour assombrir, blanc à l'alpha (f − 1) pour éclaircir — ce qui
        // est dessous (le shader, le sol) garde sa matière.
        if (!sur) continue
        const voile = f < 1 ? 0 : 255
        sur[o] = voile
        sur[o + 1] = voile
        sur[o + 2] = voile
        sur[o + 3] = Math.round(255 * Math.min(1, Math.abs(1 - f)))
        continue
      }
      // LA MOUCHETURE : la cellule de 4 px prend le second ton de la butte. Elle se lit sur le
      // pixel du MONDE, donc une dent de frange qui déborde emporte la sienne avec elle.
      const mk = mouch ? mouch[k] : null
      const c = mk && mouchetureIci(tx0 * P + px, ty0 * P + py, mk.densite, p.seed) ? mk.tache : coul[k]!
      // Le grain est POSITIONNEL (cellule de 4 px monde), pas relatif au propriétaire : deux
      // tuiles voisines de même famille partagent leur trame sans couture.
      const trame = trames[k]
      const g = trame ? f * trame[cyG * GRAIN_CELLS + ((((tx0 * P + px) / GRAIN_CELL_PX) | 0) & (GRAIN_CELLS - 1))]! : f
      // La terre SUR une tuile d'eau (la frange de la berge), la neige sur la glace ou le dessous :
      // au-dessus de ce que la tuile dessine. La GLACE, elle, est opaque : elle reste dans le sol
      // de sa couche (elle est la matière de sa tuile, pas un débordement).
      const cible = surEau && sur && !estGlace(t) ? sur : out
      // Sur l'EAU (pas sur le dessous ni la glace), la frange prend le voile humide : la berge
      // mouillée ne s'arrête plus au trait de rive, elle y entre. Voir PAVE.MOUILLE.
      const m = estEau(tSol) ? PAVE.MOUILLE : 0
      const sec = 1 - m
      cible[o] = ((c >> 16) & 0xff) * g * kr * sec + MOUILLE_TEINTE[0] * m
      cible[o + 1] = ((c >> 8) & 0xff) * g * kv * sec + MOUILLE_TEINTE[1] * m
      cible[o + 2] = (c & 0xff) * g * kb * sec + MOUILLE_TEINTE[2] * m
      cible[o + 3] = 255
    }
  }
  return { sol: out, surplomb: sur, relief }
}
