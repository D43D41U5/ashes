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

/** Relief continu — hauteur ÉCRAN (px) d'une unité d'élévation [0,1] pleine.
 * Purement visuel (jamais dans /sim). Calibré en jeu, comme TREE_JITTER_TILES :
 * grand = relief spectaculaire mais borné par la garde anti-repli
 * (H·pente_sud_max < TILE_PX). Le champ d'élévation de la vallée est TRÈS doux
 * (gradient sud max ≈ 0,012/tuile, mesuré) : à H grand, le DÉPLACEMENT devient
 * illisible OU désaligne les murs hauts de leur collision plate (bloqué là où
 * l'écran montre autre chose) et fait sortir les billboards du culling. Donc le
 * relief passe surtout à la GÉOMÉTRIE (le sol se déforme), l'ombrage n'étant
 * qu'un accent. COMPROMIS à doser en jeu : H grand = déformation bien visible
 * MAIS les murs hauts s'écartent de leur collision plate (on bute un peu avant
 * le mur dessiné) et les billboards demandent plus de marge de culling (gérée
 * dans renderNodes). */
export const RELIEF_H = 400

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
export const GROUND_PROP_DEPTH = 2
export const GROUND_FIRE_DEPTH = 5

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
export const TIE_ACTOR = 0.8

/** Coiffent le monde : canopée, voile de nuit, halos des Feux. */
export const CANOPY_DEPTH = 1_000_000
export const AMBIENT_DEPTH = 1_100_000
export const GLOW_DEPTH = 1_200_000

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

/** Un nœud (arbre, bloc, buisson) est un prop VERTICAL : il trie comme une
 * structure. À pieds égaux il passe devant le décor, jamais devant un acteur. */
export function nodeDepth(ty: number, tilePx: number): number {
  return ySortDepth(ty + 1, tilePx, TIE_NODE)
}

/* ── Les houppiers : une bande à eux seuls ───────────────────────────────────
 *
 * Au-dessus de tous les acteurs (la bande de tri Y plafonne à
 * `Y_SORT_BASE + 57 600` sur la vallée canonique de 3600 tuiles) et sous la
 * canopée. Correct SANS cas particulier : un houppier ne déborde que vers le
 * HAUT de l'écran, donc n'occulte que des acteurs situés au nord de son tronc —
 * qui sont bel et bien derrière lui. Les houppiers ne se trient qu'entre eux.
 */
export const CROWN_BASE = 900_000

/** Rayon du cœur clair du disque de découvert, en tuiles : en deçà, le houppier
 * est effacé. Large, car sous une canopée on voit loin à l'horizontale — la cime
 * est au-dessus, elle tamise la lumière du ciel, elle ne bloque pas la vue. */
export const CROWN_R_IN = 6.0
/** Au-delà, la forêt redevient un couvert opaque. Disque ×4 de l'origine (1,5 / 4). */
export const CROWN_R_OUT = 16.0
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
