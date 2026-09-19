/**
 * ═══ LA LUMIÈRE DU FEU S'ARRÊTE AUX MURS — LA SIM APPREND L'OMBRE ═══
 *
 * Spec `docs/specs/lumiere-globale.md`, « La sim apprend l'ombre » (Q5, Alexis, 2026-09-14) :
 *   · LG-R11 — il y a UN prédicat d'occultation, dans `/sim`, au grain de 4 px : les murs en
 *     bandes (LG-R10), les fûts, les blocs, le terrain plein. Le masque de la GI s'en DÉRIVE
 *     (« la loi reste dans /sim, ici on la MONTRE »).
 *   · LG-R12 — la pénombre de la sim est celle de la GI : la lumière d'un feu vaut sa bulle
 *     linéaire × la PART VISIBLE de la même source étendue (un disque de 1,5 texel, tiré par un
 *     motif FIXE de 16 points), au même grain, avec le même motif.
 *   · LG-R18 — la sim voit toutes les torches portées par un AVATAR, à la portée de l'écran.
 *
 * Ce module ne juge de rien : il dit quelle part d'une source un point voit. `nuit.ts` en fait
 * la clarté sur soi ; la chaleur (`fireBubble`), elle, ne le lit pas — ce qui chauffe éclaire au
 * même rayon, mais la lumière demande EN PLUS une ligne de vue (LG-R11 : la chaleur ne change pas).
 *
 * ═══ LE REPÈRE ═══
 *
 * Le grain : `LUMIERE.TEXELS_PAR_TUILE` texels par tuile (4 — les 4 px monde du client, LG-R2).
 * Les coordonnées continues du jeu (en tuiles) se multiplient par 4 pour devenir des texels ; les
 * centres de texels sont en +0,5. Le centre d'une tuile (tx + ½, celui d'un feu — LG-R17) est
 * donc un COIN de texel : c'est le cas que la traversée tranche par une règle explicite (LG-R12,
 * voir `segmentBloque`).
 *
 * ═══ DEUX SORTES D'OCCLUDEURS — celles de l'oracle des planches (`compose.mjs`, `grille`) ═══
 *
 *   · les TEXELS PLEINS : le terrain plein (roche, mur de roche, glacier, falaise, cendre
 *     minérale, le vide), un nœud plein (roche, bloc, filon, carrière, éboulis) sur toute sa
 *     tuile, un TRONC (arbre) sur les 2×2 texels du centre de sa tuile — la cime est en l'air,
 *     au-dessus d'un foyer posé au sol —, une pièce de bâti PLEINE (sans arête) ;
 *   · les BANDES : une pièce d'ARÊTE (mur, palissade, porte) n'occupe AUCUN texel. C'est une
 *     bande d'un texel d'épaisseur À CHEVAL sur son arête — la bande de collision (`WALL_HALF`) —
 *     qui déborde d'un demi-texel à chaque bout : deux bandes voisines se recouvrent, un coin est
 *     fermé (LG-R10). Elle bloque ENTRE les deux texels qu'elle sépare : un rayon ne la franchit
 *     que s'il entre dans son INTÉRIEUR (intervalles ouverts) ; partir d'une face ou la longer ne
 *     bloque pas — le texel qui borde un mur a son centre SUR la face.
 *
 * Les occludeurs se lisent À L'ÉTAGE du récepteur (G-R7) : un mur au sol ne fait pas d'ombre dans
 * la cave dessous.
 *
 * ═══ AU SOL, LES PALIERS : LA MARCHE SE JUGE EN HAUTEUR (LG-R14) ═══
 *
 * Quand le récepteur ET la source se tiennent au palier de leur tuile (`seTientAuSol`), chaque
 * tuile répond à SON palier — une terrasse n'est plus du terrain plein vue de la plaine — et une
 * MARCHE (l'arête entre deux paliers) est une falaise jugée en hauteur : un palier vaut
 * `LUMIERE.PALIER_TEXELS` (le lift du jeu, 32 px = 8 texels), la flamme est à `FLAMME_TEXELS` (2,4)
 * au-dessus de son sol, et le rayon est une droite entre le sol du récepteur et la flamme. Il est
 * bloqué s'il franchit l'arête PLUS BAS que le haut de la marche (strictement : un texel du haut
 * n'est jamais bloqué par sa propre marche). D'où l'écran à sens unique : d'en bas rien ne monte
 * (2,4 ne passe pas 8) ; d'en haut la lumière descend sur la plaine au-delà de s = 3,33 × d (d le
 * recul du feu derrière l'arête), et la marche porte l'ombre du feu en deçà. Un CONNECTEUR (rampe,
 * gueule, escalier) n'est pas une arête : la porte est ouverte, la lumière y passe sans condition
 * de hauteur. Dans un CREUX (une cave, un chapeau — le regard n'est pas au palier de sa tuile),
 * tout se lit à l'étage `niveau`, comme avant les terrasses : le sol d'un autre étage y est plein.
 *
 * ═══ PUR, ET SANS UNE FONCTION MATH APPROXIMÉE (invariant §2) ═══
 *
 * Le motif de tirage est une spirale de Vogel — `cos` et `sin` sont interdits ici, donc il est
 * TABULÉ (`MOTIF_SOURCE`, seize couples, à recopier tels quels côté client : LG-R12). La traversée
 * n'emploie que `+ − × ÷`, `floor` et `abs` (Amanatides–Woo, au texel) ; la distance, `sqrt`.
 * Aucun tirage : la clarté ne consomme pas le RNG.
 *
 * COÛT : par (source, récepteur), seize segments d'au plus la portée en texels, chaque cellule
 * visitée coûtant un terrain, un nœud (indexé) et une poignée de pièces pleines pré-relevées dans
 * la fenêtre. Le périmètre est celui de `clarteSurSoi` : les AVATARS seuls (N6), jamais par PNJ
 * ni par monstre.
 */
import {
  LUMIERE,
  TERRAIN_CENDRE_MIN,
  TERRAIN_CLIFF,
  TERRAIN_GLACIER,
  TERRAIN_ROCK,
  TERRAIN_VOID,
  TERRAIN_WALL,
  type NodeType,
} from './balance'
import { nodeAt, type ResourceNode } from './economy'
import { auMemeEtage, connecteurAt, niveauDuCorps, palierDuSol, terrainAEtage } from './etages'
import { EDGE_E, EDGE_N, EDGE_O, EDGE_S } from './geometry'
import type { WorldMap } from './map'
import type { StructureType } from './pieces'
import type { Entity } from './sim'
import { torcheVive } from './torche'
import type { Structure } from './village'

/**
 * LE MOTIF DE TIRAGE d'une source étendue — une spirale de Vogel de seize points dans le disque
 * unité (rayon √((i + ½)/16), angle i × l'angle d'or), FIXE : la pénombre ne grouille pas d'une
 * image à l'autre (LG-R4). Tabulée à sept décimales parce que `cos` et `sin` sont interdits ici ;
 * `lumiere.test.ts` la garde contre la formule (les rayons par `sqrt`, l'angle d'or par le
 * produit scalaire et le produit croisé de deux points voisins).
 *
 * ⚠ LA MÊME TABLE, AU BIT PRÈS, SERT AU CLIENT (LG-R12) : elle s'exporte, elle ne se recopie pas.
 */
export const MOTIF_SOURCE: readonly (readonly [number, number])[] = [
  [0.1767767, 0],
  [-0.2257722, 0.2068258],
  [0.0345581, -0.3937712],
  [0.2845712, 0.3711728],
  [-0.5222232, -0.0923739],
  [0.4946954, -0.3146847],
  [-0.1654659, 0.615525],
  [-0.3155615, -0.6075944],
  [0.6846422, 0.2500302],
  [-0.7122561, 0.294009],
  [0.3433545, -0.7337286],
  [0.2537302, 0.808932],
  [-0.7647459, -0.4431859],
  [0.897134, -0.1972324],
  [-0.5475069, 0.7787722],
  [-0.1264868, -0.9760897],
]

/**
 * CE QUE LA LUMIÈRE LIT DU MONDE — un sous-ensemble de `SimState`, et c'est voulu : la façade
 * d'état du client (`etat-gel.ts`) n'a que la carte et les structures. Sans nœuds, les fûts et
 * les blocs ne font pas d'ombre dans la PRÉDICTION ; sans entités, les torches des autres n'y
 * comptent pas. L'autorité, elle, a tout — et c'est elle qui décide.
 */
export interface MondeEclaire {
  readonly map: WorldMap
  readonly structures: readonly Structure[]
  readonly nodes?: ResourceNode[]
  readonly entities?: readonly Entity[]
  readonly npcs?: readonly { readonly entityId: number }[]
  readonly monsters?: readonly { readonly entityId: number }[]
}

/** Le terrain qui arrête la lumière — l'eau, non : la lumière passe sur l'eau (`compose.mjs`). */
const TERRAIN_PLEIN: ReadonlySet<number> = new Set([
  TERRAIN_VOID,
  TERRAIN_ROCK,
  TERRAIN_WALL,
  TERRAIN_GLACIER,
  TERRAIN_CLIFF,
  TERRAIN_CENDRE_MIN,
])
/** Un arbre ne masque le sol que par son TRONC : les 2×2 texels du centre de sa tuile. */
const NOEUD_TRONC: ReadonlySet<NodeType> = new Set<NodeType>(['tree', 'old_tree'])
/** Une roche, un bloc, un filon : la tuile pleine. */
const NOEUD_PLEIN: ReadonlySet<NodeType> = new Set<NodeType>([
  'rock',
  'bloc',
  'iron_vein',
  'coal_seam',
  'quarry',
  'rubble',
])
/** Le bâti qui arrête la lumière — pleine tuile sans arête, en bande avec (`BATI`, `compose.mjs`). */
const BATI_OPAQUE: ReadonlySet<StructureType> = new Set<StructureType>([
  'wall',
  'palissade',
  'braise_mere',
  'door',
  'house',
  'mur_bas',
])

/**
 * Une bande de mur, en texels ABSOLUS (tuile × T) : un rectangle d'intervalles OUVERTS (LG-R10).
 * `type` dit la pièce (le client en tire un albédo ; la sim ne le lit pas).
 */
export interface Bande {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
  readonly type: StructureType
}

/** LA SORTE d'un texel plein — ce qui l'occupe (le client en tire un albédo, LG-R4 « faces »). */
export const OCCLUDEUR = {
  /** Du sol : la lumière passe. */
  LIBRE: 0,
  /** Le terrain plein (roche, mur de roche, glacier, falaise, cendre minérale, le vide — ou le sol d'un autre palier). */
  TERRAIN: 1,
  /** Le tronc d'un arbre : les texels du centre de sa tuile. */
  TRONC: 2,
  /** Un nœud plein (roche, bloc, filon, carrière, éboulis) : toute sa tuile. */
  NOEUD: 3,
  /** Une pièce de bâti PLEINE (sans arête) : toute sa tuile. */
  BATI: 4,
} as const
export type SorteOccludeur = (typeof OCCLUDEUR)[keyof typeof OCCLUDEUR]

/**
 * LE CORPS SE TIENT-IL AU SOL — au palier de sa tuile, ou sur un connecteur qui mène à son étage ?
 * C'est ce qui ouvre la règle des paliers (LG-R14) : au sol, chaque tuile répond à son palier et les
 * marches se jugent en hauteur. Dans un creux (une cave, un chapeau), non : tout se lit à `niveau`.
 */
export function seTientAuSol(map: WorldMap, niveau: number, x: number, y: number): boolean {
  if (niveau < 0) return false
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  if (niveau === palierDuSol(map, tx, ty)) return true
  const c = connecteurAt(map, tx, ty)
  return c !== undefined && (c.de === niveau || c.vers === niveau)
}

/**
 * LA PORTE (LG-R14) : un connecteur — rampe, gueule, escalier — n'est jamais une arête. Entre une porte
 * et n'importe quelle tuile, la lumière passe sans condition de hauteur. Le client et l'oracle lisent
 * le même fait dans le raster (`OcclusionAuGrain.portes`).
 */
export function estUnePorte(map: WorldMap, tx: number, ty: number): boolean {
  return connecteurAt(map, tx, ty) !== undefined
}

/** La hauteur du sol d'un palier, en texels (LG-R14). */
function hauteurDuPalier(niveau: number): number {
  return niveau * LUMIERE.PALIER_TEXELS
}

/** Ce qu'une paire (récepteur, source) relève UNE fois du monde, avant ses seize rayons. */
interface Contexte {
  readonly monde: MondeEclaire
  readonly niveau: number
  /**
   * AU SOL (LG-R14) : le récepteur et la source se tiennent au palier de leur tuile. Chaque tuile
   * répond alors à SON palier, et les marches se jugent en hauteur. Faux dans un creux (une cave,
   * un chapeau) : tout se lit à `niveau`, comme avant les terrasses.
   */
  readonly auSol: boolean
  /** La hauteur du récepteur et celle de la flamme, en texels au-dessus du palier 0 (au sol seulement). */
  readonly z0: number
  readonly z1: number
  /**
   * Les tuiles des pièces PLEINES de la fenêtre (une tuile de marge autour des deux points), par
   * clé `ty × largeur + tx`. Un ensemble, pas une liste : le raster d'une fenêtre demande la sorte de
   * chaque texel, et une liste balayée à chaque texel coûtait 80 ms sur la vue du jeu (C6, LG-A14 —
   * MESURÉ dans Node, 418 pleins × 106 496 texels) ; l'ensemble ramène la question à une lecture.
   */
  readonly pleins: ReadonlySet<number>
  /** Les BANDES de la fenêtre, en texels. */
  readonly bandes: readonly Bande[]
}

/** La clé d'une tuile dans `Contexte.pleins` — des entiers, `+ ×` seulement (invariant §2). */
function cleDeTuile(map: WorldMap, tx: number, ty: number): number {
  return ty * map.width + tx
}

/** Le contexte d'une FENÊTRE de tuiles [x0, x1] × [y0, y1] (bornes incluses), à un étage. */
function contexteFenetre(
  monde: MondeEclaire,
  niveau: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  auSol: boolean,
  z0 = 0,
  z1 = 0,
): Contexte {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const pleins = new Set<number>()
  const bandes: Bande[] = []
  for (const s of monde.structures) {
    if (s.tx < x0 || s.tx > x1 || s.ty < y0 || s.ty > y1) continue
    if (!BATI_OPAQUE.has(s.type) || !auMemeEtage(s, niveau)) continue
    const e = s.edges ?? 0
    if (e === 0) {
      pleins.add(cleDeTuile(monde.map, s.tx, s.ty))
      continue
    }
    // La bande : à cheval sur sa ligne (± ½ texel), débordant d'un demi-texel à chaque bout.
    const X = s.tx * T
    const Y = s.ty * T
    const type = s.type
    if (e & EDGE_N) bandes.push({ x0: X - 0.5, x1: X + T + 0.5, y0: Y - 0.5, y1: Y + 0.5, type })
    if (e & EDGE_S) bandes.push({ x0: X - 0.5, x1: X + T + 0.5, y0: Y + T - 0.5, y1: Y + T + 0.5, type })
    if (e & EDGE_O) bandes.push({ x0: X - 0.5, x1: X + 0.5, y0: Y - 0.5, y1: Y + T + 0.5, type })
    if (e & EDGE_E) bandes.push({ x0: X + T - 0.5, x1: X + T + 0.5, y0: Y - 0.5, y1: Y + T + 0.5, type })
  }
  return { monde, niveau, auSol, z0, z1, pleins, bandes }
}

/** Le contexte d'une paire de points (en tuiles) : leur rectangle, une tuile de marge autour. */
function contexte(monde: MondeEclaire, niveau: number, ax: number, ay: number, bx: number, by: number, auSol: boolean, z0: number, z1: number): Contexte {
  return contexteFenetre(
    monde,
    niveau,
    Math.floor(Math.min(ax, bx)) - 1,
    Math.floor(Math.min(ay, by)) - 1,
    Math.floor(Math.max(ax, bx)) + 1,
    Math.floor(Math.max(ay, by)) + 1,
    auSol,
    z0,
    z1,
  )
}

/** L'étage auquel la tuile (tx, ty) se lit : au sol, SON palier (LG-R14) ; dans un creux, celui du regard. */
function etageDeLaTuile(ctx: Contexte, tx: number, ty: number): number {
  return ctx.auSol ? palierDuSol(ctx.monde.map, tx, ty) : ctx.niveau
}

/** LA SORTE du texel (kx, ky), à l'étage du contexte. Hors carte : libre (l'oracle ne l'y regarde pas). */
function sorteDuTexel(ctx: Contexte, kx: number, ky: number): SorteOccludeur {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const { map } = ctx.monde
  const tx = Math.floor(kx / T)
  const ty = Math.floor(ky / T)
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return OCCLUDEUR.LIBRE
  const etage = etageDeLaTuile(ctx, tx, ty)
  if (TERRAIN_PLEIN.has(terrainAEtage(map, etage, tx, ty))) return OCCLUDEUR.TERRAIN
  const nd = ctx.monde.nodes !== undefined ? nodeAt(map, ctx.monde.nodes, tx, ty, etage) : undefined
  if (nd !== undefined) {
    if (NOEUD_PLEIN.has(nd.type)) return OCCLUDEUR.NOEUD
    if (NOEUD_TRONC.has(nd.type)) {
      // Les texels du centre : T/2 − 1 et T/2 (à T = 4 : 1 et 2) — dérivés de T, pour que
      // `LUMIERE.TEXELS_PAR_TUILE` reste le seul bouton.
      const sx = kx - tx * T
      const sy = ky - ty * T
      const lo = T / 2 - 1
      const hi = T / 2
      if (sx >= lo && sx <= hi && sy >= lo && sy <= hi) return OCCLUDEUR.TRONC
    }
  }
  if (ctx.pleins.has(cleDeTuile(map, tx, ty))) return OCCLUDEUR.BATI
  return OCCLUDEUR.LIBRE
}

/**
 * LA SORTE D'UN TEXEL, seul — la règle de `sorteDuTexel` ouverte aux oracles et aux gardes (O4 relit
 * chaque texel d'un raster contre elle). Bâtit le contexte de sa seule tuile : pour une fenêtre,
 * `occlusionAuGrain`. `auSol` : le regard se tient au palier de sa tuile (LG-R14) — vrai par défaut
 * à la surface, faux sous la roche ; un creux à niveau ≥ 0 (la cave d'une mesa) le dit lui-même.
 */
export function sorteAuTexel(monde: MondeEclaire, niveau: number, kx: number, ky: number, auSol = niveau >= 0): SorteOccludeur {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const tx = Math.floor(kx / T)
  const ty = Math.floor(ky / T)
  return sorteDuTexel(contexteFenetre(monde, niveau, tx, ty, tx, ty, auSol), kx, ky)
}

/** Le texel (kx, ky) est-il PLEIN, à l'étage du contexte ? */
function texelPlein(ctx: Contexte, kx: number, ky: number): boolean {
  return sorteDuTexel(ctx, kx, ky) !== OCCLUDEUR.LIBRE
}

/**
 * L'OCCLUSION AU GRAIN d'une fenêtre de tuiles — le masque dont l'écran se DÉRIVE (LG-R11 : « la loi
 * reste dans /sim, ici on la MONTRE »). Le client ne réécrit pas les occludeurs : il lit ce raster.
 */
export interface OcclusionAuGrain {
  /** L'origine du raster, en texels absolus (la tuile x0 × T, y0 × T). */
  readonly ox: number
  readonly oy: number
  /** La taille du raster, en texels. */
  readonly gw: number
  readonly gh: number
  /** Par texel (ligne par ligne depuis l'origine), sa sorte — `OCCLUDEUR.LIBRE` (0) pour du sol. */
  readonly sortes: Uint8Array
  /**
   * Par texel, le PALIER de sa tuile (`palierDuSol`, LG-R14) — la hauteur de son sol, en paliers ; et
   * 1 sur une PORTE (`estUnePorte` : un connecteur, jamais une arête). Deux texels voisins de paliers
   * différents, dont aucun n'est une porte, ont une marche entre eux, haute du plus haut des deux.
   * Tout à 0 dans un creux (`auSol` faux) : aucune marche ne s'y juge.
   */
  readonly paliers: Uint8Array
  readonly portes: Uint8Array
  /** Les bandes de la fenêtre, en texels ABSOLUS (à soustraire `ox`, `oy` pour le raster). */
  readonly bandes: readonly Bande[]
}

/**
 * Rasterise les occludeurs de la fenêtre de tuiles [x0, x1] × [y0, y1] (bornes incluses) à l'étage
 * `niveau`, texel par texel, avec les bandes des murs d'arête. Pure, sans tirage ; ne sert pas au
 * tick (la sim lit `partVisible`, point par point) — c'est la vue du client et des oracles.
 * `auSol` : le regard se tient au palier de sa tuile (LG-R14) — chaque tuile répond alors à SON
 * palier, `paliers` et `portes` le disent ; vrai par défaut à la surface, faux sous la roche, et le
 * client le dit lui-même pour un creux à niveau ≥ 0 (la cave d'une mesa).
 */
export function occlusionAuGrain(monde: MondeEclaire, niveau: number, x0: number, y0: number, x1: number, y1: number, auSol = niveau >= 0): OcclusionAuGrain {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const ctx = contexteFenetre(monde, niveau, x0, y0, x1, y1, auSol)
  const gw = (x1 - x0 + 1) * T
  const gh = (y1 - y0 + 1) * T
  const ox = x0 * T
  const oy = y0 * T
  const sortes = new Uint8Array(gw * gh)
  const paliers = new Uint8Array(gw * gh)
  const portes = new Uint8Array(gw * gh)
  // PAR TUILE, pas par texel (C6, LG-A14) : la sorte ne dépend de la position DANS la tuile que
  // pour le tronc, et seulement aux texels du centre. Deux lectures de la règle par tuile suffisent
  // donc : le coin (jamais un centre, `lo` ≥ 1 pour T ≥ 4) donne le fond de la tuile, et le centre
  // dit si un tronc s'y dresse — le terrain plein et le nœud plein passant avant le tronc dans la
  // règle, un fond TERRAIN ou NOEUD vaut aussi au centre. MESURÉ dans Node, la fenêtre du banc
  // (416 × 256 texels, 418 pleins) : 103 ms texel par texel avec la liste balayée → voir C6.
  const lo = T / 2 - 1
  const hi = T / 2
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const X = tx * T
      const Y = ty * T
      const fond = sorteDuTexel(ctx, X, Y)
      const tronc = fond === OCCLUDEUR.TERRAIN || fond === OCCLUDEUR.NOEUD ? false : sorteDuTexel(ctx, X + lo, Y + lo) === OCCLUDEUR.TRONC
      const palier = auSol ? palierDuSol(monde.map, tx, ty) : 0
      const porte = auSol && estUnePorte(monde.map, tx, ty) ? 1 : 0
      const base = (Y - oy) * gw + (X - ox)
      for (let sy = 0; sy < T; sy++) {
        const rang = base + sy * gw
        for (let sx = 0; sx < T; sx++) {
          sortes[rang + sx] = fond
          paliers[rang + sx] = palier
          portes[rang + sx] = porte
        }
        if (tronc && sy >= lo && sy <= hi) for (let sx = lo; sx <= hi; sx++) sortes[rang + sx] = OCCLUDEUR.TRONC
      }
    }
  return { ox, oy, gw, gh, sortes, paliers, portes, bandes: ctx.bandes }
}

/**
 * Le segment (x0, y0) → (x1, y1) entre-t-il dans l'INTÉRIEUR de la bande ? Intervalles OUVERTS :
 * partir d'une face ou la longer n'est pas la traverser (LG-R10).
 */
function coupeBande(m: Bande, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0
  let t1 = 1
  const dx = x1 - x0
  const dy = y1 - y0
  if (dx === 0) {
    if (!(x0 > m.x0 && x0 < m.x1)) return false
  } else {
    const a = (m.x0 - x0) / dx
    const b = (m.x1 - x0) / dx
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  if (dy === 0) {
    if (!(y0 > m.y0 && y0 < m.y1)) return false
  } else {
    const a = (m.y0 - y0) / dy
    const b = (m.y1 - y0) / dy
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  return t1 - t0 > 1e-9
}

/**
 * Le segment (x0, y0) → (x1, y1), en texels, est-il BLOQUÉ ? — une bande coupée, ou un texel plein
 * visité. Amanatides–Woo : on visite chaque cellule que le segment touche, dans l'ordre. La cellule
 * de DÉPART (le récepteur, posé au bord d'un mur ou dans un fût) et celle d'ARRIVÉE (l'échantillon
 * de la source) ne comptent pas.
 *
 * ═══ LA RÈGLE DU COIN (LG-R12) ═══
 * Deux choses tranchent ce qu'une traversée naïve laissait errer :
 *   · une cellule n'est visitée que si le segment y ENTRE avant sa fin (t < 1) — un échantillon
 *     posé pile sur une limite de texels n'a plus de « case d'arrivée jamais atteinte » ;
 *   · à ÉGALITÉ (le rayon passe pile par un coin de texel), on avance en y d'abord — l'oracle des
 *     planches (`gi-ref.mjs`, `traverse`) fait de même, et c'est ce qui rend la sim et l'écran
 *     identiques là aussi.
 *
 * ═══ LA MARCHE (LG-R14), au sol seulement ═══
 * À chaque changement de TUILE, le palier est relu ; s'il change et qu'aucune des deux tuiles n'est
 * une porte, le rayon franchit une arête au paramètre `t` de l'entrée, à la hauteur
 * z0 + t × (z1 − z0) : il est bloqué si elle est STRICTEMENT sous le haut de la marche (le plus haut
 * des deux paliers). La cellule de départ et celle d'arrivée s'épargnent la sorte, jamais la marche —
 * c'est au pied du récepteur qu'une falaise fait écran.
 */
function segmentBloque(ctx: Contexte, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const m of ctx.bandes) if (coupeBande(m, x0, y0, x1, y1)) return true
  let cx = Math.floor(x0)
  let cy = Math.floor(y0)
  const ex = Math.floor(x1)
  const ey = Math.floor(y1)
  if (cx === ex && cy === ey) return false
  const dx = x1 - x0
  const dy = y1 - y0
  const sx = dx > 0 ? 1 : -1
  const sy = dy > 0 ? 1 : -1
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity
  let tx = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity
  let ty = dy !== 0 ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity
  const T = LUMIERE.TEXELS_PAR_TUILE
  const H = LUMIERE.PALIER_TEXELS
  const { map } = ctx.monde
  let tuileX = Math.floor(cx / T)
  let tuileY = Math.floor(cy / T)
  let palier = ctx.auSol ? palierDuSol(map, tuileX, tuileY) : 0
  let porte = ctx.auSol && estUnePorte(map, tuileX, tuileY)
  const garde = 4 * (Math.abs(dx) + Math.abs(dy)) + 4
  for (let pas = 0; pas < garde; pas++) {
    let t: number
    if (tx < ty) {
      if (tx >= 1) return false
      t = tx
      cx += sx
      tx += tdx
    } else {
      if (ty >= 1) return false
      t = ty
      cy += sy
      ty += tdy
    }
    if (ctx.auSol) {
      const nx = Math.floor(cx / T)
      const ny = Math.floor(cy / T)
      if (nx !== tuileX || ny !== tuileY) {
        tuileX = nx
        tuileY = ny
        const suivant = palierDuSol(map, nx, ny)
        const porteSuivante = estUnePorte(map, nx, ny)
        if (suivant !== palier && !porte && !porteSuivante && ctx.z0 + t * (ctx.z1 - ctx.z0) < Math.max(palier, suivant) * H) return true
        palier = suivant
        porte = porteSuivante
      }
    }
    if (cx === ex && cy === ey) return false
    if (texelPlein(ctx, cx, cy)) return true
  }
  return false
}

/**
 * LA PART VISIBLE d'une source étendue, dans [0, 1] — combien des seize points du disque (rayon
 * `LUMIERE.SOURCE_RAYON_TEXELS`, centré en (sx, sy)) le récepteur (rx, ry) voit, sur seize. Tout
 * en TUILES ; `niveau` est l'étage du récepteur (les occludeurs se lisent là), `niveauSource` celui
 * de la source — le sien par défaut. Quand les deux se tiennent au sol (LG-R14), le récepteur est à
 * la hauteur de son palier, la flamme à `FLAMME_TEXELS` au-dessus du sien, et les marches se jugent
 * en hauteur ; sinon, tout se lit à `niveau`.
 */
export function partVisible(monde: MondeEclaire, niveau: number, rx: number, ry: number, sx: number, sy: number, niveauSource = niveau): number {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const R = LUMIERE.SOURCE_RAYON_TEXELS
  const auSol = seTientAuSol(monde.map, niveau, rx, ry) && seTientAuSol(monde.map, niveauSource, sx, sy)
  const ctx = contexte(monde, niveau, rx, ry, sx, sy, auSol, hauteurDuPalier(niveau), hauteurDuPalier(niveauSource) + LUMIERE.FLAMME_TEXELS)
  const x0 = rx * T
  const y0 = ry * T
  const cx = sx * T
  const cy = sy * T
  let vus = 0
  for (const p of MOTIF_SOURCE) if (!segmentBloque(ctx, x0, y0, cx + p[0] * R, cy + p[1] * R)) vus++
  return vus / MOTIF_SOURCE.length
}

/** Un PNJ ou un monstre — pas un avatar (N6 : le périmètre est l'avatar, et sa torche). */
function estFigurant(monde: MondeEclaire, entityId: number): boolean {
  const npcs = monde.npcs
  if (npcs !== undefined) for (const n of npcs) if (n.entityId === entityId) return true
  const monsters = monde.monsters
  if (monsters !== undefined) for (const m of monsters) if (m.entityId === entityId) return true
  return false
}

/**
 * LA LUMIÈRE DES TORCHES PORTÉES en un point, dans [0, 1] (LG-R18) : le MAX, sur les avatars vivants
 * qui tiennent une torche VIVE au même étage — ou au sol comme lui, à un autre palier (LG-R14 : la
 * marche se juge en hauteur) —, d'une bulle linéaire depuis le porteur jusqu'à
 * `LUMIERE.TORCHE_PORTEE_TUILES` × la part visible de la source étendue centrée sur lui. Le porteur
 * lui-même est à plein : `clarteSurSoiAt` le rend avant d'arriver ici.
 *
 * Une torche reste ce qu'elle est (`torche.md`, I3) : elle éclaire, elle ne chauffe pas, elle ne
 * repousse rien. Sans `entities` (la façade du client), rien : l'autorité décide.
 */
export function lumiereDesTorches(monde: MondeEclaire, x: number, y: number, etage?: number): number {
  const entities = monde.entities
  if (entities === undefined) return 0
  const P = LUMIERE.TORCHE_PORTEE_TUILES
  const niveau = etage ?? palierDuSol(monde.map, Math.floor(x), Math.floor(y))
  const auSol = seTientAuSol(monde.map, niveau, x, y)
  let best = 0
  for (const e of entities) {
    if (e.hp <= 0 || torcheVive(e) === null) continue
    if (estFigurant(monde, e.id)) continue
    const niveauPorteur = niveauDuCorps(monde.map, e)
    if (niveauPorteur !== niveau && !(auSol && seTientAuSol(monde.map, niveauPorteur, e.x, e.y))) continue
    const dx = e.x - x
    const dy = e.y - y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d >= P) continue
    const bulle = 1 - d / P
    if (bulle <= best) continue
    const v = bulle * partVisible(monde, niveau, x, y, e.x, e.y, niveauPorteur)
    if (v > best) best = v
  }
  return best
}
