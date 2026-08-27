/**
 * LES BUTTES D'AFFLEUREMENT — la lecture client de `WorldMap.affleurements` (t0-exploration
 * §2sexies, décision d'Alexis 2026-08-18 : « que ça ait une gueule qui corresponde à ce
 * qu'elles sont »). Module PUR (aucun Phaser) : le bake y prend la teinte du sol, la couche
 * de décor son contexte par tuile. Le pierrier HORS butte (le Karst de la vallée dormante)
 * n'est jamais touché : tout part de la donnée registrée, rien ne se devine par le terrain.
 *
 * ⚠ **LE RECT N'EST QU'UNE BOÎTE — LA BUTTE, C'EST SON PIERRIER** *(2026-08-27, « vérifie les
 * buttes aussi »)*. `map.affleurements` registre un `{x,y,w,h}` : c'est la BOÎTE ENGLOBANTE de la
 * butte, pas sa forme. Depuis que la sim la fait croître TUILE À TUILE (une ligne de niveau, plus
 * un empilement de cellules de 8), cette boîte ne contient plus la butte qu'à moitié — **MESURÉ
 * (monde joué, trois graines) : 42 à 56 % du rect est du pierrier**. Ce module lisait le rect, et
 * tout ce qu'il en tirait était donc rectangulaire : le décor du pré était effacé sur ~27 × 27
 * tuiles autour de chaque butte (le `coeur` rend un semis vide), et la poussière de houille se
 * semait sur l'herbe. On propage donc sur le PIERRIER depuis le sommet, borné au rect : la butte
 * est connexe par construction (la croissance part du sommet et ne franchit que des voisines),
 * donc cette propagation la retrouve exactement — et laisse dehors ce qui n'en est pas.
 *
 * L'identité se lit en GÉOLOGUE :
 *   — FER = le chapeau de fer (gossan) : la rocaille s'oxyde, mouchetures rouille sur gris
 *     chauffé — c'est le vrai signe de surface d'un gisement ferreux.
 *   — CHARBON = la strate noire : anthracite mat, plus sombre que tout pierrier de la carte.
 * Les mouchetures sont QUANTIFIÉES par tuile (hash positionnel, jamais un dégradé) — la règle
 * des FX pixellisés vaut aussi pour le sol.
 */
import { TERRAIN_SCREE, type WorldMap } from '@ashes/sim'

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

/**
 * ═══ LES DEUX TONS D'UNE BUTTE, ET LA PART DE ROUILLE ═══
 *
 * *(Décision d'Alexis, 2026-08-27, sur quatre planches rendues sur la vraie butte : « 4 » —
 * le gravier en croûte.)*
 *
 * ⚠ **LE TIRAGE ÉTAIT PAR TUILE, ET IL EST DEVENU UNE MOSAÏQUE.** Écrit le 2026-08-18, quand le
 * sol se cuisait à **1 px par tuile** : la « moucheture quantifiée par tuile » était alors
 * littéralement un pixel, et la règle des FX pixellisés était respectée. Depuis les pavés (R8,
 * 2026-08-22) le sol se cuit à **16 px par tuile** — le même `hash2(tx, ty) < part` peint donc
 * **256 fois la surface**, et la butte se lisait en carrés de 16 px. MESURÉ, l'écart des deux
 * tons : fer **Δ 30 de luminance sur 132 (23 %)** plus un saut de teinte franc, charbon
 * **Δ 26 sur 88 (30 %)** — quand le damier par tuile du grain vaut 3 à 4,5 %, et que
 * `grain-sol.ts` dit déjà qu'à CETTE amplitude « le damier par tuile se lit comme une grille
 * de 16 px ». On était six à huit fois au-dessus d'une valeur déjà jugée trop forte.
 *
 * Le fond est donc désormais la teinte de TOUTE la butte, et la tache est semée à la maille de
 * l'art (4 px, `paves.ts`), en croûtes que la pente concentre vers le sommet — un chapeau de fer
 * s'oxyde d'abord en haut.
 */
const SOL_BUTTE: Record<RessourceButte, { fond: number; tache: number }> = {
  // Gris CHAUFFÉ piqué de rouille franche : plus ocre que le pierrier neutre (0x96928a).
  fer: { fond: 0x94806e, tache: 0x8a5a40 },
  // Anthracite piqué de houille : plus sombre que toute roche de la palette.
  charbon: { fond: 0x5c5850, tache: 0x413e38 },
}

/**
 * LA PART DE ROUILLE d'une butte, avant l'amas — c'est-à-dire la part des cellules de 4 px qui
 * prendraient la tache si la pente était à mi-hauteur. Réglage à l'œil, sur planche.
 */
export const MOUCH_PART = 0.38
/** La pente concentre la croûte : `PENTE_MIN` au pourtour, `+ PENTE_GAIN × grad` vers le fond. */
export const MOUCH_PENTE_MIN = 0.35
export const MOUCH_PENTE_GAIN = 1.5

/** Le fond d'une butte : la teinte de TOUTE sa rocaille (la tache se sème par-dessus). */
export function fondDeButte(ressource: RessourceButte): number {
  return SOL_BUTTE[ressource].fond
}
/** La tache : la rouille du chapeau de fer, la houille de la strate. */
export function tacheDeButte(ressource: RessourceButte): number {
  return SOL_BUTTE[ressource].tache
}
/**
 * LA DENSITÉ de tache d'une tuile, ∈ [0,1] — ce que le cuiseur module ensuite par son champ
 * d'amas. La pente (`ButteContexte.grad`) la commande : c'est le premier consommateur de `grad`
 * depuis la purge des gradins de dalles (2026-08-18), et il dit la même chose qu'eux — le
 * sommet est le lieu de la butte.
 */
export function densiteDeMoucheture(grad: number): number {
  return MOUCH_PART * (MOUCH_PENTE_MIN + MOUCH_PENTE_GAIN * grad)
}



/**
 * LE CONTEXTE PAR TUILE, construit UNE fois à l'amorce : cœur (+ pente), sommet (la tuile de
 * pierrier la plus proche du centre du rect — le chicot du fer s'y dresse), frange (couronne de
 * `FRANGE_TUILES` autour du CŒUR, la rocaille qui déborde). Petit : quelques centaines d'entrées
 * par carte, cinq buttes de 320 tuiles sur le monde joué. Une carte sans affleurements rend une
 * Map vide — coût nul.
 *
 * ⚠ **TOUT PART DU PIERRIER, PAS DU RECT** (voir l'en-tête) : le cœur est la composante connexe
 * de pierrier qui contient le sommet, bornée au rect ; la frange et la pente s'en dérivent. Une
 * tuile d'herbe prise dans la boîte garde donc son décor de pré, et une flaque de pierrier du
 * Karst tombée dans la boîte sans toucher la butte n'en fait pas partie.
 */
export function contexteDesButtes(map: WorldMap): Map<number, ButteContexte> {
  const ctx = new Map<number, ButteContexte>()
  const affs = map.affleurements ?? []
  const { width, height, terrain } = map
  for (const a of affs) {
    // ── LE SOMMET : la tuile de PIERRIER la plus proche du centre du rect. Balayage row-major,
    //    comparaison stricte : ordre total, déterministe. Un rect en L a son centre hors
    //    rocaille — d'où la recherche. C'est aussi le DÉPART de la propagation.
    const cx = a.x + a.w / 2
    const cy = a.y + a.h / 2
    const x0 = Math.max(0, a.x)
    const y0 = Math.max(0, a.y)
    const x1 = Math.min(width, a.x + a.w)
    const y1 = Math.min(height, a.y + a.h)
    let sommet = -1
    let bestD = Infinity
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        if (terrain[ty * width + tx] !== TERRAIN_SCREE) continue
        const d = (tx + 0.5 - cx) * (tx + 0.5 - cx) + (ty + 0.5 - cy) * (ty + 0.5 - cy)
        if (d < bestD) { bestD = d; sommet = ty * width + tx }
      }
    }
    if (sommet < 0) continue // pas un pixel de rocaille dans la boîte : rien à décrire

    // ── LE CŒUR : la composante connexe de pierrier qui contient le sommet, bornée au rect.
    const coeur: number[] = [sommet]
    const dans = new Set<number>([sommet])
    for (let q = 0; q < coeur.length; q++) {
      const i = coeur[q]!
      const ix = i % width
      const iy = (i - ix) / width
      for (const v of [ix > x0 ? i - 1 : -1, ix + 1 < x1 ? i + 1 : -1, iy > y0 ? i - width : -1, iy + 1 < y1 ? i + width : -1]) {
        if (v < 0 || dans.has(v) || terrain[v] !== TERRAIN_SCREE) continue
        dans.add(v)
        coeur.push(v)
      }
    }

    // ── LA FRANGE d'abord (le cœur la recouvrira là où les deux se disputent une tuile) :
    //    la couronne de `FRANGE_TUILES` autour du cœur, en propagation, tous terrains.
    let bord = coeur
    const vus = new Set<number>(dans)
    for (let pas = 0; pas < FRANGE_TUILES; pas++) {
      const suivant: number[] = []
      for (const i of bord) {
        const ix = i % width
        const iy = (i - ix) / width
        for (const v of [ix > 0 ? i - 1 : -1, ix + 1 < width ? i + 1 : -1, iy > 0 ? i - width : -1, iy + 1 < height ? i + width : -1]) {
          if (v < 0 || vus.has(v)) continue
          vus.add(v)
          suivant.push(v)
          ctx.set(v, { ressource: a.ressource, role: 'frange', grad: 0 })
        }
      }
      bord = suivant
    }

    // ── LA PENTE, CONTINUE : la profondeur depuis le BORD du cœur, normalisée par la plus
    //    profonde. 0 sur le pourtour, 1 au fond de la butte — la même promesse qu'avant (« feel
    //    = pente continue »), mais lue sur la forme réelle et non sur un rectangle.
    const prof = new Map<number, number>()
    let front: number[] = []
    for (const i of coeur) {
      const ix = i % width
      const iy = (i - ix) / width
      const ouvert = (ix === 0 || !dans.has(i - 1)) || (ix + 1 >= width || !dans.has(i + 1))
        || (iy === 0 || !dans.has(i - width)) || (iy + 1 >= height || !dans.has(i + width))
      if (ouvert) { prof.set(i, 0); front.push(i) }
    }
    let d = 0
    while (front.length > 0) {
      const suivant: number[] = []
      d++
      for (const i of front) {
        const ix = i % width
        const iy = (i - ix) / width
        for (const v of [ix > 0 ? i - 1 : -1, ix + 1 < width ? i + 1 : -1, iy > 0 ? i - width : -1, iy + 1 < height ? i + width : -1]) {
          if (v < 0 || !dans.has(v) || prof.has(v)) continue
          prof.set(v, d)
          suivant.push(v)
        }
      }
      front = suivant
    }
    const fond = Math.max(1, d - 1)
    for (const i of coeur) ctx.set(i, { ressource: a.ressource, role: 'coeur', grad: (prof.get(i) ?? 0) / fond })

    // ── LE CHICOT (fer seulement — le charbon reste bas, c'est sa silhouette).
    if (a.ressource === 'fer') ctx.set(sommet, { ressource: 'fer', role: 'sommet', grad: 1 })
  }
  return ctx
}
