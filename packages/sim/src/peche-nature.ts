/**
 * ═══ LA NATURE DE L'EAU — une carte immuable, dérivée au worldgen (spec `peche.md` T1) ═══
 *
 * Le terrain ne connaît que DEUX eaux : `TERRAIN_SHALLOW_WATER` et `TERRAIN_DEEP_WATER`.
 * « Rivière » et « lac » n'existaient jusqu'ici que dans la tête du générateur — la passe des
 * coins de pêche (`zone-content.ts`) les distinguait le temps de poser ses nœuds, puis jetait
 * ce savoir. Or depuis D9 on pêche N'IMPORTE QUELLE tuile d'eau, et D10 fait dépendre la table
 * de prises de la nature de cette eau : il faut donc pouvoir répondre « qu'est-ce que cette
 * eau ? » pour toute tuile, au runtime, en O(1).
 *
 * D'où cette carte : un entier par tuile, calculé UNE fois à l'amorce, jamais muté — le patron
 * exact de `distEau`, `profondeur` et `coulees` (données statiques, gelées à l'amorce, gardées
 * par `carte-immuable.test.ts`). Additive : une carte d'avant se relit sans, et tout lecteur
 * doit alors se rabattre sur le terrain (voir `natureDeLEau` dans `peche-table.ts`).
 *
 * LES RÈGLES, DANS CET ORDRE (l'ordre EST la règle — une tuile de marais au bord du fil est
 * du marais, pas de la rivière) :
 *
 *   1. **MARAIS** — le terrain le dit lui-même (`TERRAIN_MARSH`, `TERRAIN_REED_MARSH`).
 *   2. **RIVIÈRE** — eau à ≤ `PECHE_RAYON_RIVIERE` (Chebyshev) d'un point du fil. C'est la
 *      MÊME définition que celle dont `coinsDePeche` se sert pour exclure la rivière des
 *      berges de lac : deux définitions divergeraient, et la pêche mentirait d'un côté.
 *   3. **LAC** — le reste de l'eau, par composante 4-connexe, à partir de
 *      `EAU_NATURE.LAC_MIN_TUILES` tuiles.
 *   4. **MARE** — toute autre eau permanente : les petites poches, les ruisseaux perdus.
 *
 * LA CRUE N'EST PAS ICI, et c'est délibéré : elle n'est pas une nature de terrain mais un
 * ÉTAT DU JOUR (`estInonde`, `eau.ts`). Elle se lit au tick, dans `peche-table.ts`.
 */
import { TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_SHALLOW_WATER } from './balance'
import { CONTENU } from './zone-content'

/**
 * LE RÉGLAGE DE LA NATURE DE L'EAU — il vit ICI, à côté de son générateur, et pas dans
 * `balance.ts` : la ligne de partage de la maison est *comment on calibre*. Ce seuil-là se
 * règle **en regardant une carte** (« ça, est-ce un lac ou une mare ? »), jamais en jouant.
 *
 * `PECHE_RAYON_RIVIERE` n'est PAS redéclaré ici : il vit dans `CONTENU` (`zone-content.ts`),
 * où la passe des coins de pêche s'en sert déjà pour écarter la rivière des berges de lac.
 * Le recopier ferait diverger deux définitions de « rivière » — et la pêche mentirait d'un côté.
 */
export const EAU_NATURE = {
  /** En deçà, c'est une mare : une poche d'eau, pas une étendue. Mesuré à l'œil sur la carte. */
  LAC_MIN_TUILES: 40,
} as const

/** Pas de l'eau du tout — de la terre, ou une eau qu'aucune règle ne nomme. */
export const NATURE_RIEN = 0
export const NATURE_RIVIERE = 1
export const NATURE_LAC = 2
export const NATURE_MARE = 3
export const NATURE_MARAIS = 4
/** LA CRUE (`estInonde`) — jamais dans la carte : c'est un état du jour, pas un terrain. */
export const NATURE_CRUE = 5

export type NatureEau =
  | typeof NATURE_RIEN
  | typeof NATURE_RIVIERE
  | typeof NATURE_LAC
  | typeof NATURE_MARE
  | typeof NATURE_MARAIS
  | typeof NATURE_CRUE

/** Les cinq natures nommées, dans l'ordre des constantes — pour les tables et les balayages. */
export const NATURES: readonly NatureEau[] = [NATURE_RIVIERE, NATURE_LAC, NATURE_MARE, NATURE_MARAIS, NATURE_CRUE]

/** Le nom d'une nature, pour les diagnostics et les tables déclaratives. */
export const NOM_DE_NATURE: Record<NatureEau, string> = {
  [NATURE_RIEN]: 'rien',
  [NATURE_RIVIERE]: 'riviere',
  [NATURE_LAC]: 'lac',
  [NATURE_MARE]: 'mare',
  [NATURE_MARAIS]: 'marais',
  [NATURE_CRUE]: 'crue',
}

/** Cette tuile porte-t-elle de l'eau PERMANENTE (hors crue) ? Le terrain seul, sans l'état du jour. */
export function estTerrainDEau(t: number | undefined): boolean {
  return t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER
}

/** Cette tuile est-elle du marais ? Les deux terrains de marais, nommés une seule fois. */
export function estTerrainDeMarais(t: number | undefined): boolean {
  return t === TERRAIN_MARSH || t === TERRAIN_REED_MARSH
}

/**
 * LA DÉRIVATION (T1) — `terrain` + le fil de la rivière → un entier par tuile.
 *
 * Coût : un balayage pour le marais et la rivière, un BFS de composantes sur le reste de
 * l'eau. Du même ordre que `deriverDistanceEau`, qui tourne déjà juste à côté à l'amorce.
 *
 * Déterministe et sans PRNG : le balayage est row-major, les composantes se numérotent dans
 * cet ordre — deux générations de la même graine rendent la même carte (garde A21).
 */
export function deriverNatureDeLEau(terrain: number[], fil: number[] | undefined, width: number, height: number): number[] {
  const n = width * height
  const out = new Array<number>(n).fill(NATURE_RIEN)

  // ── 1. LE MARAIS — le terrain le dit ──
  for (let i = 0; i < n; i++) {
    if (estTerrainDeMarais(terrain[i])) out[i] = NATURE_MARAIS
  }

  // ── 2. LA RIVIÈRE — l'eau au voisinage du fil (même rayon que `coinsDePeche`) ──
  const RR = CONTENU.PECHE_RAYON_RIVIERE
  for (const k of fil ?? []) {
    const fx = k % width
    const fy = (k - fx) / width
    for (let y = fy - RR; y <= fy + RR; y++) {
      if (y < 0 || y >= height) continue
      for (let x = fx - RR; x <= fx + RR; x++) {
        if (x < 0 || x >= width) continue
        const i = y * width + x
        if (out[i] === NATURE_RIEN && estTerrainDEau(terrain[i])) out[i] = NATURE_RIVIERE
      }
    }
  }

  // ── 3-4. LE RESTE DE L'EAU — par composante 4-connexe : grande = LAC, petite = MARE ──
  // Une seule pile réutilisée, et les index de la composante gardés pour la repeindre : deux
  // passes sur chaque composante, jamais de récursion (une composante de lac fait des milliers
  // de tuiles, et la pile d'appels de JS n'est pas un outil de BFS).
  const vu = new Uint8Array(n)
  const pile: number[] = []
  const comp: number[] = []
  for (let depart = 0; depart < n; depart++) {
    if (vu[depart] === 1) continue
    if (out[depart] !== NATURE_RIEN || !estTerrainDEau(terrain[depart])) continue
    vu[depart] = 1
    pile.length = 0
    comp.length = 0
    pile.push(depart)
    while (pile.length > 0) {
      const j = pile.pop()!
      comp.push(j)
      const jx = j % width
      const jy = (j - jx) / width
      if (jx > 0) pousser(j - 1)
      if (jx + 1 < width) pousser(j + 1)
      if (jy > 0) pousser(j - width)
      if (jy + 1 < height) pousser(j + width)
    }
    const nature = comp.length >= EAU_NATURE.LAC_MIN_TUILES ? NATURE_LAC : NATURE_MARE
    for (const j of comp) out[j] = nature
  }
  return out

  function pousser(j: number): void {
    if (vu[j] === 1) return
    if (out[j] !== NATURE_RIEN || !estTerrainDEau(terrain[j])) return
    vu[j] = 1
    pile.push(j)
  }
}
