/**
 * LA POSE D'UN PAS — dans quel SENS il se pose, et de quel côté de la marche.
 *
 * Les empreintes (semelle humide, neige, cendre) se tamponnaient TOUJOURS DROITES et toujours
 * décalées en X : marcher vers l'est alignait les deux pieds l'un derrière l'autre sur une seule
 * file, et marcher vers le nord laissait des semelles qui regardaient le sud. Une piste doit dire
 * OÙ ON ALLAIT — c'est déjà ce que le sang fait au sol (`sang-sol.ts`), et pour la même raison.
 *
 * Trois décisions, toutes DÉRIVÉES du pas lui-même, jamais tirées au sort par image :
 *
 *   1. L'ORIENTATION SUIT LA MARCHE. Le tampon ne se pose qu'au bout d'une foulée entière
 *      (`PAS_PX`) : le vecteur qui sépare deux foulées EST le cap, à portée de mesure, jamais nul.
 *      L'empreinte est bakée en `ORIENTATIONS` variantes pré-tournées et non tournée à l'affichage
 *      — une rotation Phaser ne tourne PAS le canal X de la normale (mesuré le 24/07 sur le flip,
 *      même classe de piège), et une image de 4 px tournée au filtre NEAREST se délave.
 *
 *   2. L'ÉCART EST PERPENDICULAIRE, jamais en X. Les deux pieds enjambent la ligne de marche —
 *      c'est ce qui fait une PISTE et non une file. Et chaque pied s'OUVRE vers l'extérieur
 *      (`OUVERTURE`) : personne ne marche les orteils parallèles.
 *
 *   3. LE RESTE EST HACHÉ SUR LA POSITION DU PAS (arrondie au pixel) — reproductible, jamais
 *      `Math.random` : deux pieds ne tombent pas au cordeau, et la piste cesse d'être une règle.
 *
 * Module PUR (aucun import Phaser) : c'est lui qu'on teste, le rendu ne fait qu'appliquer.
 */

/** Combien de variantes pré-tournées le boot cuit — 22,5° de pas. */
export const ORIENTATIONS = 16

/** L'écartement des deux pieds, en px, mesuré PERPENDICULAIREMENT à la marche. */
export const ECART_PX = 3.2
/** De combien le pied s'ouvre vers l'extérieur (rad — ~9°). */
export const OUVERTURE = 0.16
/** Le désordre du pas : sur l'angle (rad) et sur la position (px). */
export const JITTER_ANGLE = 0.11
export const JITTER_PX = 0.7

/** Le hachage du pas — même famille que celui des FX (`eau-fx`), reproductible d'une image à l'autre. */
export function hachePas(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

export interface PosePas {
  /** L'index de la variante pré-tournée à poser — dans `[0, ORIENTATIONS)`. */
  orient: number
  /** Le cap CONTINU du pied (rad), avant quantification — l'ouverture s'y mesure sans le cran. */
  angle: number
  /** Où la poser (px monde) : le point de foulée, décalé du côté du pied. */
  px: number
  py: number
}

/** L'angle (rad) que porte une variante bakée : son axe +v pointe dans ce sens. */
export function angleDOrientation(orient: number): number {
  return (orient * 2 * Math.PI) / ORIENTATIONS
}

/**
 * OÙ ET COMMENT SE POSE CE PAS. `px/py` : le point de foulée (les pieds du sprite) ; `dirX/dirY` :
 * le déplacement depuis la foulée précédente (jamais nul — l'appelant ne tamponne qu'au-delà de
 * `PAS_PX`) ; `pied` : 0 = gauche, 1 = droit.
 */
export function posePas(px: number, py: number, dirX: number, dirY: number, pied: 0 | 1): PosePas {
  const l = Math.hypot(dirX, dirY) || 1
  const fx = dirX / l
  const fy = dirY / l
  // La DROITE du marcheur, repère écran (y vers le bas) : le cap tourné d'un quart de tour.
  const rx = -fy
  const ry = fx
  const cote = pied === 1 ? 1 : -1
  const hx = Math.round(px)
  const hy = Math.round(py)
  const hAngle = hachePas(hx, hy, 3)
  const hEcart = hachePas(hx, hy, 11)
  const hLong = hachePas(hx, hy, 29)

  const angle = Math.atan2(fy, fx) + cote * OUVERTURE + (hAngle - 0.5) * 2 * JITTER_ANGLE
  const pas = (2 * Math.PI) / ORIENTATIONS
  const orient = ((Math.round(angle / pas) % ORIENTATIONS) + ORIENTATIONS) % ORIENTATIONS

  const ecart = cote * (ECART_PX / 2 + (hEcart - 0.5) * JITTER_PX)
  const avance = (hLong - 0.5) * JITTER_PX
  return { orient, angle, px: px + rx * ecart + fx * avance, py: py + ry * ecart + fy * avance }
}

/**
 * ═══ LA TRAÎNÉE D'UN CORPS QUI RAMPE — pas des pas ═══
 *
 * *« Le cendreux au sol […] ça trace au sol […] sera toujours une traînée et pas des pas comme
 * ses congénères debout. »* (Alexis, 2026-08-25.)*
 *
 * Un rampant n'a pas de pieds : il n'y a ni alternance gauche/droite, ni écart perpendiculaire,
 * ni ouverture — les trois décisions de `posePas` disent toutes « un marcheur », et un corps
 * traîné n'en est pas un. Il reste UNE chose du pas : le CAP, qui oriente la marque.
 *
 * La marque elle-même est celle du pas (mêmes textures, mêmes 16 caps, même matière) — c'est
 * l'ESPACEMENT qui fait la traînée : l'appelant tamponne trois fois plus souvent que la foulée,
 * les marques se recouvrent, et ce qui reste au sol est un sillon continu au lieu d'une file
 * d'empreintes. Aucun art neuf, et la piste meurt avec son sol comme les autres.
 *
 * Un GRAIN subsiste, haché sur la position (jamais tiré) : un sillon parfaitement droit se lit
 * comme un trait d'outil, pas comme un corps.
 */
export function poseTrainee(px: number, py: number, dirX: number, dirY: number): PosePas {
  const l = Math.hypot(dirX, dirY) || 1
  const fx = dirX / l
  const fy = dirY / l
  const hx = Math.round(px)
  const hy = Math.round(py)
  const angle = Math.atan2(fy, fx) + (hachePas(hx, hy, 7) - 0.5) * 2 * JITTER_ANGLE
  const pas = (2 * Math.PI) / ORIENTATIONS
  const orient = ((Math.round(angle / pas) % ORIENTATIONS) + ORIENTATIONS) % ORIENTATIONS
  // Le corps traîne SUR la ligne : le seul écart est le grain, et il est deux fois plus fin que
  // celui du pas — la traînée doit se lire comme UN sillon, pas comme deux.
  const ecart = (hachePas(hx, hy, 23) - 0.5) * JITTER_PX
  return { orient, angle, px: px - fy * ecart, py: py + fx * ecart }
}

/** L'écart LATÉRAL signé d'une pose par rapport à la ligne de marche (px) — ce que la garde mesure. */
export function ecartLateral(pose: PosePas, px: number, py: number, dirX: number, dirY: number): number {
  const l = Math.hypot(dirX, dirY) || 1
  return ((pose.px - px) * -dirY + (pose.py - py) * dirX) / l
}

/**
 * ═══ LA SEMELLE, RASTÉRISÉE — silhouette, occlusion et NORMALE, pour un cap donné ═══
 *
 * L'empreinte est cuite en `ORIENTATIONS` variantes plutôt que tournée à l'affichage : une
 * rotation Phaser ne tourne PAS le canal X de la normale (le piège du flip, mesuré le 24/07),
 * et 4 px tournés au filtre NEAREST se délavent. On rastérise donc CHAQUE cap dans son repère.
 *
 * La normale est ANALYTIQUE — une cuvette `h = −creux·(1−p²)(1−q²)`, nulle au bord, au plus
 * creux au cœur — et non dérivée de la silhouette : `normalFromCanvas` fabrique une BUTTE à
 * partir d'un masque, or un pas est son NÉGATIF, et quatre passes de lissage n'ont pas la place
 * de vivre dans huit pixels. Même dérogation que le tronc cylindrique de `lit-trees` ; les
 * CONVENTIONS d'encodage restent celles de `normal-map.ts`.
 *
 * L'occlusion, elle, est NON DIRECTIONNELLE (le fond d'un trou voit moins de ciel — c'est vrai à
 * toute heure) : ce n'est pas un hillshade peint, la doctrine `_lit` la tolère.
 *
 * Pur : aucun canvas ici. `eau-fx.ts` ne fait que peindre ce que ceci rend.
 */

/** Le côté du carré où une empreinte se cuit : la diagonale du 4×6 y tient (√52 ≈ 7,3). */
export const PAS_CV = 8
/** La semelle dans son repère propre : demi-largeur (u) et demi-longueur (v), en px. */
export const PAS_DEMI_L = 2
export const PAS_DEMI_V = 3

export interface PixelPas {
  /** Ce pixel est-il DANS la semelle ? Hors d'elle : rien à peindre, et la normale est plate. */
  dedans: boolean
  /** La cuvette en ce point : 0 au bord de la semelle, 1 en son cœur. */
  cuve: number
  /** La normale, repère ÉCRAN (x droite, y BAS, z vers l'œil) — encodage à la charge du peintre. */
  nx: number
  ny: number
  nz: number
}

/**
 * LA SEMELLE DU CAP `orient`, pixel par pixel, en balayage ligne par ligne (`PAS_CV²` entrées).
 * `creux` = 0 rend un décalque PLAT (une tache mouillée ne creuse rien) : toutes les normales
 * valent alors (0, 0, 1), et une lumière rasante ne doit rien y trouver.
 */
export function rasterEmpreinte(orient: number, creux: number): PixelPas[] {
  const th = angleDOrientation(orient)
  const fx = Math.cos(th)
  const fy = Math.sin(th)
  const rx = -fy // la droite du marcheur, repère écran
  const ry = fx
  const out: PixelPas[] = []
  for (let y = 0; y < PAS_CV; y++) {
    for (let x = 0; x < PAS_CV; x++) {
      const dx = x + 0.5 - PAS_CV / 2
      const dy = y + 0.5 - PAS_CV / 2
      const p = (dx * rx + dy * ry) / PAS_DEMI_L
      const q = (dx * fx + dy * fy) / PAS_DEMI_V
      if (Math.abs(p) > 1 || Math.abs(q) > 1) {
        out.push({ dedans: false, cuve: 0, nx: 0, ny: 0, nz: 1 })
        continue
      }
      // Le gradient de la cuvette, pris dans le repère du pied puis ramené à l'écran.
      const dhu = (2 * creux * p * (1 - q * q)) / PAS_DEMI_L
      const dhv = (2 * creux * q * (1 - p * p)) / PAS_DEMI_V
      const gx = dhu * rx + dhv * fx
      const gy = dhu * ry + dhv * fy
      const l = Math.hypot(gx, gy, 1)
      out.push({ dedans: true, cuve: (1 - p * p) * (1 - q * q), nx: -gx / l, ny: -gy / l, nz: 1 / l })
    }
  }
  return out
}
