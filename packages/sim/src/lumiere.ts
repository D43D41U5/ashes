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
 * la cave dessous. Le sol d'un autre palier est du terrain plein pour qui n'y est pas (une mesa
 * est une paroi vue du bas ; vue du haut, la plaine ne monte pas — LG-R14, à sens unique).
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
import { auMemeEtage, niveauDuCorps, palierDuSol, terrainAEtage } from './etages'
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

/** Une bande de mur, en texels : un rectangle d'intervalles OUVERTS (LG-R10). */
interface Bande {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
}

/** Ce qu'une paire (récepteur, source) relève UNE fois du monde, avant ses seize rayons. */
interface Contexte {
  readonly monde: MondeEclaire
  readonly niveau: number
  /** Les pièces PLEINES de la fenêtre (une tuile de marge autour des deux points). */
  readonly pleins: readonly Structure[]
  /** Les BANDES de la fenêtre, en texels. */
  readonly bandes: readonly Bande[]
}

function contexte(monde: MondeEclaire, niveau: number, ax: number, ay: number, bx: number, by: number): Contexte {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const x0 = Math.floor(Math.min(ax, bx)) - 1
  const x1 = Math.floor(Math.max(ax, bx)) + 1
  const y0 = Math.floor(Math.min(ay, by)) - 1
  const y1 = Math.floor(Math.max(ay, by)) + 1
  const pleins: Structure[] = []
  const bandes: Bande[] = []
  for (const s of monde.structures) {
    if (s.tx < x0 || s.tx > x1 || s.ty < y0 || s.ty > y1) continue
    if (!BATI_OPAQUE.has(s.type) || !auMemeEtage(s, niveau)) continue
    const e = s.edges ?? 0
    if (e === 0) {
      pleins.push(s)
      continue
    }
    // La bande : à cheval sur sa ligne (± ½ texel), débordant d'un demi-texel à chaque bout.
    const X = s.tx * T
    const Y = s.ty * T
    if (e & EDGE_N) bandes.push({ x0: X - 0.5, x1: X + T + 0.5, y0: Y - 0.5, y1: Y + 0.5 })
    if (e & EDGE_S) bandes.push({ x0: X - 0.5, x1: X + T + 0.5, y0: Y + T - 0.5, y1: Y + T + 0.5 })
    if (e & EDGE_O) bandes.push({ x0: X - 0.5, x1: X + 0.5, y0: Y - 0.5, y1: Y + T + 0.5 })
    if (e & EDGE_E) bandes.push({ x0: X + T - 0.5, x1: X + T + 0.5, y0: Y - 0.5, y1: Y + T + 0.5 })
  }
  return { monde, niveau, pleins, bandes }
}

/** Le texel (kx, ky) est-il PLEIN, à l'étage du contexte ? Hors carte : libre (l'oracle ne l'y regarde pas). */
function texelPlein(ctx: Contexte, kx: number, ky: number): boolean {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const { map } = ctx.monde
  const tx = Math.floor(kx / T)
  const ty = Math.floor(ky / T)
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  if (TERRAIN_PLEIN.has(terrainAEtage(map, ctx.niveau, tx, ty))) return true
  const nd = ctx.monde.nodes !== undefined ? nodeAt(map, ctx.monde.nodes, tx, ty, ctx.niveau) : undefined
  if (nd !== undefined) {
    if (NOEUD_PLEIN.has(nd.type)) return true
    if (NOEUD_TRONC.has(nd.type)) {
      // Les texels du centre : T/2 − 1 et T/2 (à T = 4 : 1 et 2) — dérivés de T, pour que
      // `LUMIERE.TEXELS_PAR_TUILE` reste le seul bouton.
      const sx = kx - tx * T
      const sy = ky - ty * T
      const lo = T / 2 - 1
      const hi = T / 2
      if (sx >= lo && sx <= hi && sy >= lo && sy <= hi) return true
    }
  }
  for (const s of ctx.pleins) if (s.tx === tx && s.ty === ty) return true
  return false
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
  const garde = 4 * (Math.abs(dx) + Math.abs(dy)) + 4
  for (let pas = 0; pas < garde; pas++) {
    if (tx < ty) {
      if (tx >= 1) return false
      cx += sx
      tx += tdx
    } else {
      if (ty >= 1) return false
      cy += sy
      ty += tdy
    }
    if (cx === ex && cy === ey) return false
    if (texelPlein(ctx, cx, cy)) return true
  }
  return false
}

/**
 * LA PART VISIBLE d'une source étendue, dans [0, 1] — combien des seize points du disque (rayon
 * `LUMIERE.SOURCE_RAYON_TEXELS`, centré en (sx, sy)) le récepteur (rx, ry) voit, sur seize. Tout
 * en TUILES ; `niveau` est l'étage du récepteur (les occludeurs se lisent là).
 */
export function partVisible(monde: MondeEclaire, niveau: number, rx: number, ry: number, sx: number, sy: number): number {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const R = LUMIERE.SOURCE_RAYON_TEXELS
  const ctx = contexte(monde, niveau, rx, ry, sx, sy)
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
 * qui tiennent une torche VIVE au même étage, d'une bulle linéaire depuis le porteur jusqu'à
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
  let best = 0
  for (const e of entities) {
    if (e.hp <= 0 || torcheVive(e) === null) continue
    if (estFigurant(monde, e.id)) continue
    if (niveauDuCorps(monde.map, e) !== niveau) continue
    const dx = e.x - x
    const dy = e.y - y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d >= P) continue
    const bulle = 1 - d / P
    if (bulle <= best) continue
    const v = bulle * partVisible(monde, niveau, x, y, e.x, e.y)
    if (v > best) best = v
  }
  return best
}
