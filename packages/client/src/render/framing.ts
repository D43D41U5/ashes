/**
 * Cadrage & proportions (façon V Rising) — math PURE, aucun import Phaser.
 *
 * Convertit des grandeurs logiques (tuiles, position écran du pointeur) en
 * grandeurs de rendu (zoom, décalage caméra en px monde, position/taille/depth
 * d'un sprite). Extrait de `WorldScene` pour être unit-testable en isolation.
 * Spec : docs/specs/client.md §« Cadrage & proportions » (R10-R13).
 */

/** Taille CANONIQUE d'une tuile à l'écran, en px (art placeholder 16×16).
 * Les fonctions de ce module la prennent en paramètre (testabilité) ; le
 * reste du client importe cette constante plutôt que de la redéclarer. */
export const TILE_PX = 16

/** Hauteur de l'image, en TUILES : ce que la caméra montre du monde (le zoom en découle,
 * `zoomForFraming`). À 16:9, la largeur suit — ~35,6 tuiles. C'est l'ÉTALON de tout rayon
 * qu'on veut voir se refermer dans le cadre : un rayon en tuiles ne dit rien tant qu'on ne
 * le compare pas à lui. Vivait en privé dans `WorldScene` ; remontée ici le 2026-07-29 pour
 * que le disque de découvert puisse s'y accrocher, et que sa garde puisse le lire. */
export const VISIBLE_TILES_TALL = 20

/* ── Budget des profondeurs de la scène monde ────────────────────────────────
 *
 * UNE seule échelle de tri pour tout ce qui a des « pieds » : acteurs, nœuds,
 * structures, décor, cadavres. L'unité de depth est le PIXEL MONDE — un sprite
 * dont les pieds sont un pixel plus bas passe devant. Sans quoi une catégorie
 * triée sur sa propre échelle (nœuds à 4, décor à [2,3)) ne peut jamais passer
 * devant une autre, et le joueur marche sur les arbres.
 *
 * Seul reste hors bande ce qui n'a pas de pieds : le sol, les props rampants,
 * le foyer d'un Feu. Et les couches qui coiffent le monde entier, placées TRÈS
 * au-dessus : la bande monte avec la hauteur de la carte (3600 tuiles × 16 px
 * ≈ 57 600 sur la vallée canonique), pas avec un plafond de quelques milliers.
 */

/** Sol plat, jamais trié. */
export const GROUND_MAP_DEPTH = -1
/** La flaque de chaleur au sol d'un Feu : POSÉE SUR LE SOL, sous tout ce qui s'y tient — y compris
 *  LES BÛCHES DU FOYER (`GROUND_FIRE_DEPTH = 5`) et le sol bâti, sinon la flaque additive LAVE le
 *  bois et il disparaît. Au-dessus du seul sol nu (et eau/cendre/falaise). C'est une lueur
 *  d'ambiance, pas un objet à pieds ; tout objet l'occulte naturellement. */
export const FIRE_GROUND_DEPTH = 4
export const GROUND_PROP_DEPTH = 2
export const GROUND_FIRE_DEPTH = 5
/** LE SOL BÂTI (décision d'Alexis) : une pièce molle POSÉE AU RAS DU SOL, sous les
 * acteurs et le décor haut — on marche DESSUS, jamais derrière. */
export const FLOOR_DEPTH = 6

/** Base de la bande de tri Y. */
export const Y_SORT_BASE = 1000

/** Départage à pixel de pieds ÉGAL. Dans [0,1) : jamais assez pour renverser un
 * écart de profondeur réel, puisqu'une unité de depth vaut un pixel monde.
 * Une PAROI de falaise est tout en bas : à pieds égaux, tout la recouvre. */
export const TIE_CLIFF = 0
export const TIE_CORPSE = 0.1
export const TIE_CLUTTER = 0.2
export const TIE_NODE = 0.4
export const TIE_STRUCTURE = 0.6
/** LE SEUIL passe APRÈS les murs à pieds égaux. Une bande de mur déborde d'une demi-épaisseur
 *  chez ses voisins (c'est ce qui la recoud) : sans ce départage, la pierre du mur d'à côté
 *  mordait le bois de la porte. Reste SOUS les acteurs — on entre par la porte, pas derrière. */
export const TIE_SEUIL = 0.7
export const TIE_ACTOR = 0.8

/** Coiffent le monde : canopée, voile de nuit, halos des Feux. */
export const CANOPY_DEPTH = 1_000_000
/** Les oiseaux passent AU-DESSUS des houppiers mais SOUS le voile de nuit : ils
 * s'assombrissent au crépuscule comme le reste du monde. */
export const FLYER_DEPTH = 1_050_000
export const AMBIENT_DEPTH = 1_100_000
/** Profondeur du voile d'ambiance QUAND l'éclairage dynamique est armé : JUSTE au-dessus du
 *  fond (sol/eau/falaises/cendre, tous ≤ 6) et SOUS tous les sprites (≥ 1000). Le voile ne
 *  tinte alors que le fond non éclairé ; les sprites prennent leur jour/nuit du LightsManager
 *  (sinon double-assombrissement). Éclairage éteint → le voile remonte à `AMBIENT_DEPTH`. */
export const AMBIENT_DEPTH_LIT = 8
/** Les lucioles sont au-dessus du voile de nuit — sinon la nuit éteindrait
 * précisément ce qui n'a de sens que la nuit. */
export const SPARK_DEPTH = 1_250_000

/** Au-dessus de tout : aperçu de construction, marqueurs d'objectif, chargement. */
export const OVERLAY_DEPTH = 10_000_000

/**
 * R13 — profondeur de tri d'un sprite dont les pieds sont à `feetY` (en tuiles).
 * `tie` départage les égalités exactes (cf. constantes TIE_*).
 */
export function ySortDepth(feetY: number, tilePx: number, tie: number): number {
  return Y_SORT_BASE + feetY * tilePx + tie
}

/** Ancre PIEDS d'un sprite d'une tuile (origine 0.5/1) : bas-centre de la tuile.
 * Un art plus haut que sa tuile « monte » alors sans décaler son tri. */
export function tileFeetAnchor(tx: number, ty: number, tilePx: number): { px: number; py: number } {
  return { px: (tx + 0.5) * tilePx, py: (ty + 1) * tilePx }
}

/** R10 — zoom dérivé du cadrage voulu (« je veux voir N tuiles de haut »). */
export function zoomForFraming(visibleTilesTall: number, tilePx: number, viewportHeight: number): number {
  return viewportHeight / (visibleTilesTall * tilePx)
}

/**
 * R11 — décalage caméra « Foxhole » : voir plus loin là où l'on vise.
 *
 * Calculé en ÉCRAN-espace (écart du pointeur au centre), JAMAIS depuis la
 * position monde du curseur : sinon la caméra suivrait le curseur dont la
 * position monde dépend de la caméra → boucle de rétroaction. Retourne un
 * décalage en pixels MONDE, borné radialement à `maxTiles`.
 */
export function lookaheadOffset(
  pointerX: number,
  pointerY: number,
  centerX: number,
  centerY: number,
  strength: number,
  maxTiles: number,
  tilePx: number,
): { x: number; y: number } {
  let x = (pointerX - centerX) * strength
  let y = (pointerY - centerY) * strength
  const maxPx = maxTiles * tilePx
  const mag = Math.sqrt(x * x + y * y)
  if (mag > maxPx && mag > 0) {
    x = (x / mag) * maxPx
    y = (y / mag) * maxPx
  }
  return { x, y }
}

/** Emprise VISUELLE d'un acteur (en tuiles) — découplée de la résolution de
 * l'art. L'art peut être plus haut que l'emprise logique de collision. */
export interface ActorFootprint {
  widthTiles: number
  heightTiles: number
}

export interface ActorPlacement {
  /** position pixel du sprite (à utiliser avec une origine PIEDS 0,5/1) */
  px: number
  py: number
  /** taille d'affichage en pixels — dépend UNIQUEMENT de l'emprise et de tilePx */
  displayW: number
  displayH: number
  /** Y-sort : croît vers le bas (pieds plus bas = devant) */
  depth: number
}

/**
 * R12 + R13 — place un acteur logique (x,y = centre, en tuiles) avec ancrage
 * PIEDS et taille d'affichage découplée de la résolution de l'art. Les pieds
 * sont au bas de l'emprise logique (`y + hitbox/2`), de sorte qu'un sprite plus
 * haut que l'emprise « monte » au-dessus de sa tuile sans décaler collision ni
 * cible de clic (qui restent gérées en espace-tuile ailleurs).
 */
export function actorPlacement(
  x: number,
  y: number,
  footprint: ActorFootprint,
  tilePx: number,
  hitboxTiles: number,
): ActorPlacement {
  const feetY = y + hitboxTiles / 2
  return {
    px: x * tilePx,
    py: feetY * tilePx,
    displayW: footprint.widthTiles * tilePx,
    displayH: footprint.heightTiles * tilePx,
    depth: ySortDepth(feetY, tilePx, TIE_ACTOR),
  }
}

/** R13 — une structure 1-tuile a ses pieds sur son bord bas `ty + 1` : un acteur
 * au nord passe derrière, au sud devant. */
export function structureDepth(ty: number, tilePx: number): number {
  return ySortDepth(ty + 1, tilePx, TIE_STRUCTURE)
}

/**
 * ═══ LA PROFONDEUR D'UNE BARRIÈRE SUR ARÊTE — ses pieds sont SA BANDE, pas sa tuile ═══
 *
 * Une structure pleine tuile trie sur `ty + 1`, le bas de sa tuile, et c'est juste : elle
 * l'occupe entièrement. Une barrière d'arête, non — elle n'en occupe qu'un LISERÉ. Le mur qui
 * borde une salle par le sud porte son arête au NORD de sa tuile : ses pieds sont donc tout en
 * haut de cette tuile, et non un pixel au-dessus de la tuile suivante.
 *
 * Sans ça, quiconque se colle à un mur PAR LE BAS (ou à une clôture) partage la tuile de la
 * barrière tout en étant AU SUD d'elle — et passait derrière : le personnage disparaissait
 * dans un mur qu'il longeait par l'extérieur (constaté par Alexis, 2026-07-27).
 *
 * `demiTuiles` = la demi-épaisseur de la bande, en tuiles (elle est À CHEVAL sur l'arête, donc
 * son bord sud descend d'autant chez le voisin). Une bande VERTICALE (est/ouest), elle, court
 * sur toute la hauteur de sa tuile : ses pieds restent `ty + 1`.
 */
export function barriereDepth(ty: number, edges: number, tilePx: number, demiTuiles: number, tie = TIE_STRUCTURE): number {
  const SUD = 4, EST = 2, OUEST = 8
  const feetY = (edges & (SUD | EST | OUEST)) !== 0 ? ty + 1 : ty + demiTuiles
  return ySortDepth(feetY, tilePx, tie)
}

/** Le seuil de porte : comme une structure, mais APRÈS elle (cf. `TIE_SEUIL`). */
export function seuilDepth(ty: number, tilePx: number): number {
  return ySortDepth(ty + 1, tilePx, TIE_SEUIL)
}

/** Un nœud (arbre, bloc, buisson) est un prop VERTICAL : il trie comme une
 * structure. À pieds égaux il passe devant le décor, jamais devant un acteur. */
export function nodeDepth(ty: number, tilePx: number): number {
  return ySortDepth(ty + 1, tilePx, TIE_NODE)
}

/**
 * ═══ UNE BARRIÈRE AVALE-T-ELLE CET ACTEUR ? (décision d'Alexis, 2026-07-27) ═══
 *
 * NB — CETTE FONCTION EST LA VÉRIFICATION, PLUS LA POLITIQUE. Ce qui DÉCIDE d'effacer un mur,
 * c'est la règle des PANS (`render/pans.ts`, décision d'Alexis : un côté de bâtiment tombe d'un
 * bloc, à deux tuiles). Celle-ci répond à la question qu'on lui pose ensuite — « reste-t-il une
 * barrière pleine qui recouvre le joueur ? » — et c'est à ce titre qu'elle est testée, en
 * unitaire comme au navigateur : la politique change, l'invariant non.
 *
 * Le tri Y est JUSTE et il produit quand même un défaut : un mur trie sur le bas de sa tuile,
 * mais il se DRESSE au-dessus d'elle (`MUR_HT`, deux tuiles). Tout ce qui se tient dans ces
 * deux rangées au nord passe donc DERRIÈRE lui — physiquement correct (on est derrière le mur,
 * vu du sud), visuellement inacceptable : le joueur disparaît.
 *
 * Ce n'est pas une faute de tri, c'est le prix de la hauteur, et on ne le paie pas en trichant
 * sur les profondeurs — inverser l'ordre ferait marcher l'avatar SUR la maçonnerie. On le paie
 * en DÉCOUPANT le mur fautif (à la Project Zomboid), et cette fonction dit lequel : celui dont
 * le sprite recouvre l'acteur ET qui se dessine après lui.
 *
 * Tout est en pixels MONDE, et rien n'est deviné : la hauteur du sprite et sa largeur viennent
 * de `bati-art`, la boîte de l'acteur de son propre art. Un test balaie les huit directions.
 */
export function barriereAvale(
  barriere: { tx: number; ty: number; hauteurPx: number; largeurPx: number },
  acteur: { x: number; y: number; largeurPx: number; hauteurPx: number },
  tilePx: number,
): boolean {
  // Qui passe devant ? Le tri Y, et lui seul — on ne découpe JAMAIS ce qui est déjà derrière.
  const dBarriere = structureDepth(barriere.ty, tilePx)
  const dActeur = ySortDepth(acteur.y, tilePx, TIE_ACTOR)
  if (dBarriere <= dActeur) return false
  // Les deux empreintes à l'écran. Une barrière est ancrée au bas de sa TUILE et monte ;
  // un acteur est ancré à ses pieds et monte aussi.
  const bx = (barriere.tx + 0.5) * tilePx
  const bBas = (barriere.ty + 1) * tilePx
  const bHaut = bBas - tilePx - barriere.hauteurPx
  const ax = acteur.x * tilePx
  const aBas = acteur.y * tilePx
  const aHaut = aBas - acteur.hauteurPx
  // IL FAUT UN VRAI RECOUVREMENT, pas un frôlement. Sans ce seuil, une clôture dont la coiffe
  // mord deux pixels sur les pieds de l'avatar se tranche — et se retranche à chaque pas, ce
  // qui donne un clignotement le long de tout un enclos. Deux pixels sur seize : en deçà, on
  // voit encore l'acteur, et le remède serait pire que le mal.
  const SEUIL = 2
  const recouvreY = Math.min(aBas, bBas) - Math.max(aHaut, bHaut)
  const recouvreX = (acteur.largeurPx + barriere.largeurPx) / 2 - Math.abs(ax - bx)
  return recouvreY > SEUIL && recouvreX > SEUIL
}

/* ── Les houppiers : une bande à eux seuls ───────────────────────────────────
 *
 * Au-dessus de tous les acteurs (la bande de tri Y plafonne à
 * `Y_SORT_BASE + 57 600` sur la vallée canonique de 3600 tuiles) et sous la
 * canopée. Correct SANS cas particulier : un houppier ne déborde que vers le
 * HAUT de l'écran, donc n'occulte que des acteurs situés au nord de son tronc —
 * qui sont bel et bien derrière lui. Les houppiers ne se trient qu'entre eux.
 */
/** LES TOITS (spec construction R14, R24) : une pièce molle qui COUVRE. Au-dessus
 * de tous les acteurs (la bande de tri Y plafonne vers `Y_SORT_BASE + 57 600`) et
 * sous les houppiers — comme eux, un toit occulte l'intérieur puis FOND quand
 * l'avatar entre dessous. */
export const ROOF_DEPTH = 800_000

export const CROWN_BASE = 900_000

/**
 * Hauteur du PLUS HAUT arbre du jeu, en tuiles (`hauteurTuiles(ARBRES.old_tree)` — le gros
 * bois). RECOPIÉE ici pour être CONFRONTÉE, jamais consommée depuis `arbre-art` : ce module
 * est en amont (l'art y lit `TILE_PX`), et l'importer ferait un cycle. Le test échoue si les
 * deux divergent — même patron que `demiTroncSub`, qui recopie /sim pour le confronter.
 */
const PLUS_HAUT_ARBRE_TUILES = 6

/**
 * LE DISQUE DE DÉCOUVERT — deux rayons qui ne s'écrivent plus, ils se DÉRIVENT.
 *
 * Le cœur clair (`R_IN`, houppier effacé) est exactement la portée d'une cime capable de te
 * CACHER : un houppier ne déborde que vers le haut de l'écran, sur la hauteur de son arbre.
 * Au-delà de la hauteur du plus haut arbre, plus aucune cime ne peut te couvrir — l'aide de
 * jeu a fini son travail, et tout ce qu'elle efface en plus, elle le prend à la forêt.
 *
 * La bordure (`R_OUT`, couvert plein) est le DEMI-ÉCRAN : le bois se referme franchement au
 * bord haut et au bord bas de l'image. C'est la seule échelle qui veuille dire quelque chose
 * — un rayon en tuiles ne se juge que contre le cadre.
 *
 * CE QUI A DÉRAILLÉ, et c'est la classe de bug qu'on ferme (constat d'Alexis du 2026-07-29,
 * « la vision sous les arbres va trop loin ») : le 28/07, les deux rayons ont été montés du
 * facteur de croissance des HOUPPIERS (6 → 7,9 et 16 → 21). Or ils ne bornent pas une cime,
 * ils bornent une portée dans le CADRE — et le cadre, lui, n'a pas grandi. `R_OUT` a dépassé
 * la demi-diagonale de l'écran (20,4 tuiles) : la borne extérieure existait dans la fonction
 * et JAMAIS dans l'image. MESURÉ dans le bois le plus dense de la carte (`smoke --scenario
 * couvert`) : **5 houppiers opaques sur 131**, tous au-delà de 21 tuiles, c'est-à-dire dans
 * les coins seuls. La forêt était transparente d'un bord à l'autre de l'écran.
 */
export const CROWN_R_IN = PLUS_HAUT_ARBRE_TUILES
/** Au-delà, la forêt redevient un couvert opaque — au bord de l'image, donc. */
export const CROWN_R_OUT = VISIBLE_TILES_TALL / 2
/** Opacité résiduelle sous la cime : on devine le feuillage, on voit le sol. */
export const CROWN_ALPHA_MIN = 0.22

/** Profondeur d'un houppier, dans sa bande propre, triée par la rangée de son
 * tronc. Même unité que la bande Y (le pixel monde) — mais jamais mêlée à elle. */
export function crownDepth(feetY: number, tilePx: number): number {
  return CROWN_BASE + feetY * tilePx
}

/**
 * Le disque de découvert : les houppiers s'effacent autour du joueur, les troncs
 * restent opaques. `distTiles` se mesure des pieds du joueur au PIED DU TRONC —
 * l'arbre à ton contact s'efface, celui dont la cime te survole de loin reste
 * opaque.
 *
 * Un alpha par sprite, fonction CONTINUE de la position du joueur : pas de
 * masque, pas de `RenderTexture`, pas d'`erase`, et donc aucun scintillement
 * quand on marche.
 */
export function crownAlpha(distTiles: number): number {
  if (distTiles <= CROWN_R_IN) return CROWN_ALPHA_MIN
  if (distTiles >= CROWN_R_OUT) return 1
  const t = (distTiles - CROWN_R_IN) / (CROWN_R_OUT - CROWN_R_IN)
  return CROWN_ALPHA_MIN + (1 - CROWN_ALPHA_MIN) * t
}

/** Un cadavre est à plat : ses « pieds » sont sa propre position. */
export function corpseDepth(y: number, tilePx: number): number {
  return ySortDepth(y, tilePx, TIE_CORPSE)
}

/** Le décor trie sur ses pieds RÉELS (décalage sub-tuile compris), sans quoi
 * deux props d'une même rangée s'ordonnent au hasard du pool. */
export function clutterDepth(feetY: number, tilePx: number): number {
  return ySortDepth(feetY, tilePx, TIE_CLUTTER)
}
