/**
 * LES BUTTES D'AFFLEUREMENT — la lecture client de `WorldMap.affleurements` (t0-exploration
 * §2sexies, décision d'Alexis 2026-08-18 : « que ça ait une gueule qui corresponde à ce
 * qu'elles sont »). Module PUR (aucun Phaser) : le bake y prend la teinte du sol, la couche
 * de décor son contexte par tuile. Le pierrier HORS butte (le Karst de la vallée dormante)
 * n'est jamais touché : tout part de la donnée registrée, rien ne se devine par le terrain.
 *
 * L'identité se lit en GÉOLOGUE :
 *   — FER = le chapeau de fer (gossan) : la rocaille s'oxyde, mouchetures rouille sur gris
 *     chauffé — c'est le vrai signe de surface d'un gisement ferreux.
 *   — CHARBON = la strate noire : anthracite mat, plus sombre que tout pierrier de la carte.
 * Les mouchetures sont QUANTIFIÉES par tuile (hash positionnel, jamais un dégradé) — la règle
 * des FX pixellisés vaut aussi pour le sol.
 */
import { hash2, TERRAIN_SCREE, type WorldMap } from '@ashes/sim'

export type RessourceButte = 'fer' | 'charbon'

export interface ButteContexte {
  ressource: RessourceButte
  /** `coeur` = dans le rect (la rocaille), `sommet` = LA tuile du chicot (fer), `frange` = la
   *  couronne d'éboulis autour du rect (2 tuiles). */
  role: 'coeur' | 'sommet' | 'frange'
  /**
   * LA PENTE VERS LE SOMMET, ∈ [0,1] : 1 au centre du rect, 0 à son bord (0 en frange).
   * Continue sur toute la butte — les gradins de dalles la lisent (plus hautes vers le
   * sommet), jamais par paliers écrits (la règle « feel = pente continue »).
   */
  grad: number
}

/** La couronne d'éboulis autour du rect, en tuiles — la géologie déborde dans le pré. */
export const FRANGE_TUILES = 2

/** Le sol de butte, par tuile — mouchetures quantifiées (part fixe), jamais un dégradé. */
const SOL_BUTTE: Record<RessourceButte, { fond: number; tache: number; part: number }> = {
  // Gris CHAUFFÉ piqué de rouille franche : plus ocre que le pierrier neutre (0x96928a).
  fer: { fond: 0x94806e, tache: 0x8a5a40, part: 0.38 },
  // Anthracite piqué de houille : plus sombre que toute roche de la palette.
  charbon: { fond: 0x5c5850, tache: 0x413e38, part: 0.38 },
}

export function solDeButte(ressource: RessourceButte, tx: number, ty: number): number {
  const s = SOL_BUTTE[ressource]
  return hash2(tx, ty, (ressource === 'fer' ? 0x0f37 : 0xc4a7) | 0) < s.part ? s.tache : s.fond
}

/** La butte qui contient la tuile — ou null. Linéaire sur ≤ quelques rects : appelé sur les
 *  seules tuiles de pierrier au bake, jamais en boucle chaude de frame. */
export function butteAt(
  affleurements: NonNullable<WorldMap['affleurements']>,
  tx: number,
  ty: number,
): { ressource: RessourceButte } | null {
  for (const a of affleurements) {
    if (tx >= a.x && tx < a.x + a.w && ty >= a.y && ty < a.y + a.h) return a
  }
  return null
}

/**
 * LE CONTEXTE PAR TUILE, construit UNE fois à l'amorce : cœur (+ pente), sommet (la tuile de
 * pierrier la plus proche du centre du rect — le chicot du fer s'y dresse), frange (couronne
 * de `FRANGE_TUILES` autour du rect, la rocaille qui déborde). Petit : quelques centaines
 * d'entrées par carte. Une carte sans affleurements rend une Map vide — coût nul.
 */
export function contexteDesButtes(map: WorldMap): Map<number, ButteContexte> {
  const ctx = new Map<number, ButteContexte>()
  const affs = map.affleurements ?? []
  const { width, height, terrain } = map
  for (const a of affs) {
    // ── LA FRANGE d'abord : le cœur d'une butte voisine (jamais le cas par construction,
    //    l'écart R51 y pourvoit) ou son propre cœur la recouvriraient ensuite.
    for (let ty = a.y - FRANGE_TUILES; ty < a.y + a.h + FRANGE_TUILES; ty++) {
      for (let tx = a.x - FRANGE_TUILES; tx < a.x + a.w + FRANGE_TUILES; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        if (tx >= a.x && tx < a.x + a.w && ty >= a.y && ty < a.y + a.h) continue
        ctx.set(ty * width + tx, { ressource: a.ressource, role: 'frange', grad: 0 })
      }
    }
    // ── LE CŒUR, avec sa pente : 1 au centre, 0 au bord (Chebyshev normalisé au demi-rect).
    const cx = a.x + a.w / 2
    const cy = a.y + a.h / 2
    for (let ty = a.y; ty < a.y + a.h; ty++) {
      for (let tx = a.x; tx < a.x + a.w; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        const g = 1 - Math.max(Math.abs(tx + 0.5 - cx) / (a.w / 2), Math.abs(ty + 0.5 - cy) / (a.h / 2))
        ctx.set(ty * width + tx, { ressource: a.ressource, role: 'coeur', grad: Math.max(0, g) })
      }
    }
    // ── LE SOMMET (fer seulement — le charbon reste bas, c'est sa silhouette) : la tuile de
    //    PIERRIER la plus proche du centre. Balayage row-major, comparaison stricte : ordre
    //    total, déterministe. Un rect en L a son centre hors rocaille — d'où la recherche.
    if (a.ressource !== 'fer') continue
    let sommet = -1
    let bestD = Infinity
    for (let ty = a.y; ty < a.y + a.h; ty++) {
      for (let tx = a.x; tx < a.x + a.w; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        if (terrain[ty * width + tx] !== TERRAIN_SCREE) continue
        const d = (tx + 0.5 - cx) * (tx + 0.5 - cx) + (ty + 0.5 - cy) * (ty + 0.5 - cy)
        if (d < bestD) { bestD = d; sommet = ty * width + tx }
      }
    }
    if (sommet >= 0) ctx.set(sommet, { ressource: 'fer', role: 'sommet', grad: 1 })
  }
  return ctx
}
