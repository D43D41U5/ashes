/**
 * ═══ L'ÉCORCE — le grain d'un tronc, et l'axe sur lequel il doit être taillé ═══
 *
 * *Demande d'Alexis, 2026-07-29 : « ajoute un peu de texture sur les troncs, et évite qu'ils
 * semblent cylindriques — on fait du pixel art / low poly ».*
 *
 * ═══ CE QU'IL Y AVAIT AVANT, ET POURQUOI ÇA NE POUVAIT PAS MARCHER ═══
 *
 * Deux fonctions de `lit-trees`, et le diagnostic est pire que « cylindrique » :
 *   • `futAlbedo` remplissait **un rectangle d'UNE seule couleur**. Il n'y avait pas de texture
 *     à améliorer : il n'y en avait aucune. (Les trois bandes verticales de `futRects` ne sont
 *     pas à l'écran : avec l'éclairage actif, `snapshot-view` tire `nd-<variante>_trunk_lit`.)
 *   • `trunkNormal` écrivait un CYLINDRE analytique — `norm3(t * 0.9, 0, 0.7)`, un dégradé
 *     continu en travers du fût, avec `dy` nul PARTOUT.
 *
 * ═══ LA MESURE QUI COMMANDE TOUT — et qui a tué la correction évidente ═══
 *
 * Le réflexe, pour sortir d'un cylindre, est de le facetter : trois pans à normale constante au
 * lieu d'un dégradé. MESURÉ avant d'être écrit, en passant chaque normale par la formule exacte
 * du shader (`DefineLights.glsl`, Phaser 4.2) et la géométrie réelle du soleil du jeu
 * (`SUN_FAR` 2200, `SUN_NORTH` 1600, `SUN_Z` 620 — un soleil RASANT, 13° à 21°, qui vient du
 * NORD, et dont `sunDirection` annule la composante x À MIDI) :
 *
 *   facette                              8h      midi     17h
 *   plate            (0, 0, 1)          0,247   0,365    0,226
 *   inclinée en X    (±0.7, 0, 0.71)    0,697   **0,261**  0,000
 *   inclinée en HAUT (0, −0.5, 0.87)    0,523   **0,778**  0,486
 *   inclinée en BAS  (0, +0.5, 0.87)    0,000   0,000    0,000
 *
 * **Une facette inclinée en X est MOINS contrastée qu'une surface plane à midi** (0,261 contre
 * 0,365). Un tronc facetté verticalement — le réflexe « low poly » — serait donc INERTE de 10 h
 * à 15 h : il ne ferait rien que le cylindre ne fasse déjà, en pire. L'arête HORIZONTALE, elle,
 * paie à toute heure : le dessus d'une plaque monte à 0,778 quand son dessous tombe à 0,000.
 * Un contraste que rien ne rattrape, et qui est aussi le trait le plus « pixel art » qui soit :
 * une ligne noire franche d'un pixel.
 *
 * **D'où la règle : le grain d'un tronc se taille en Y.** Les sillons verticaux donnent le pan
 * de lumière du matin et du soir ; les ruptures horizontales donnent la matière à midi. Chaque
 * écorce ci-dessous porte les deux — même celles dont la photo est franchement verticale.
 *
 * ═══ CE QUI EST RÉUTILISÉ, ET CE QUI NE L'EST PAS ═══
 *
 * Pas de seconde recette de normale : le champ de hauteur passe par `normalFromCanvas` avec les
 * cadrans « cube franc » du 24/07 (`passes:1`, `k:3,5`, `cell:2`). La quantification en cellules
 * de 2 px EST le facettage — à 6 px de colonne elle donne trois pans, ce qui est exactement le
 * budget disponible. `trunkNormal` disparaît : le tronc cesse d'être la seule surface analytique
 * du pipeline.
 *
 * Les TONS, eux, ne sont pas déclarés ici : ils vivent avec les mesures, dans `arbre-art`, comme
 * tous les autres tons d'arbre depuis le 2026-07-28. Ce module ne connaît que de la GÉOMÉTRIE.
 */
import type { TonsFut } from './arbre-art'

/**
 * Hachage entier déterministe. Les textures sont bâties au boot : elles ne doivent pas varier
 * d'une session à l'autre, donc pas de `Math.random`. Même esprit que le `hash2` de `/sim`,
 * et `Math.imul` pour rester en 32 bits.
 */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Le grain d'une écorce. Que de la géométrie : les couleurs viennent du `TonsFut` de l'arbre. */
export interface Ecorce {
  /** Profondeur des SILLONS verticaux (0 = lisse). Le pan du matin et du soir. */
  sillons: number
  /** Combien de colonnes creusées. Au plus une pour deux pixels de largeur. */
  nSillons: number
  /** Hauteur moyenne d'une PLAQUE (px) : l'espacement des ruptures horizontales. */
  plaque: number
  /** Profondeur de la rupture horizontale — c'est ELLE qui porte le contraste de midi. */
  plaqueProfondeur: number
  /** Densité des lenticelles (tirets d'albédo horizontaux). 0 = aucune. Le bouleau, et lui seul. */
  lenticelles: number
  /** Bombé du prisme : 0 = pan plat, 1 = très arrondi. `cell` le quantifie en facettes. */
  bombe: number
  /** Fraction BASSE du fût qui vire au sombre (0 = aucune). Matière, pas ombrage. */
  piedSombre: number
}

/**
 * ═══ LES CINQ ÉCORCES ═══
 *
 * Chaque ligne suit une PHOTO, jamais un goût — les clichés sont listés dans `docs/decisions.md`
 * à la date du 2026-07-29.
 */
export const ECORCES: Record<string, Ecorce> = {
  /** LE CHÊNE — crêtes verticales larges, clefts très sombres et orangés au fond. */
  chene: { sillons: 0.55, nSillons: 3, plaque: 7, plaqueProfondeur: 0.22, lenticelles: 0, bombe: 0.35, piedSombre: 0 },
  /**
   * LE HÊTRE — LISSE. La photo ne montre qu'un gris uniforme et quelques cicatrices : son grain
   * est l'ABSENCE de grain. C'est la seule écorce de la table qui soit plus plate que l'ancien
   * cylindre (σ 0,035 contre 0,044 à midi), et c'est voulu — c'est ce qui la distingue du chêne
   * à trois pixels de distance, avec sa couleur grise.
   */
  hetre: { sillons: 0.06, nSillons: 2, plaque: 13, plaqueProfondeur: 0.10, lenticelles: 0, bombe: 0.5, piedSombre: 0 },
  /**
   * LE BOULEAU — la seule écorce du jeu qu'on reconnaît SANS voir l'arbre : blanc crème barré de
   * lenticelles noires horizontales, et le pied qui noircit. Sa texture est CHROMATIQUE, pas
   * géométrique (σ à peine au-dessus de l'actuel) : c'est le seul tronc qui resterait
   * reconnaissable sous une lumière parfaitement plate.
   */
  bouleau: { sillons: 0.10, nSillons: 2, plaque: 6, plaqueProfondeur: 0.30, lenticelles: 0.85, bombe: 0.4, piedSombre: 0.3 },
  /** LE SAULE — des côtes verticales presque parallèles, plus serrées et plus régulières que
   *  celles du chêne, sans ses grandes plaques. */
  saule: { sillons: 0.5, nSillons: 3, plaque: 9, plaqueProfondeur: 0.16, lenticelles: 0, bombe: 0.3, piedSombre: 0 },
  /**
   * LE PIN SYLVESTRE — la plus POLYGONALE des cinq, donc la plus proche du low poly : des
   * plaques irrégulières saumon séparées de clefts noirs, dans les DEUX axes. Ruptures tous les
   * 4 px, et un pied sombre — seul le haut du fût est saumon.
   */
  pin: { sillons: 0.28, nSillons: 2, plaque: 4, plaqueProfondeur: 0.45, lenticelles: 0, bombe: 0.3, piedSombre: 0.45 },
  /** LES AUTRES CONIFÈRES (sapin, mélèze) — écailles fines et serrées, sans le saumon du pin. */
  conifere: { sillons: 0.3, nSillons: 2, plaque: 5, plaqueProfondeur: 0.30, lenticelles: 0, bombe: 0.3, piedSombre: 0.25 },
}

/** L'écorce par défaut : celle du chêne. Un arbre sans ligne dédiée est un feuillu ordinaire. */
export const ECORCE_DEFAUT = ECORCES.chene!

/**
 * QUELLE ÉCORCE POUR QUELLE VARIANTE. Exhaustive par construction : `ecorceDe` retombe sur le
 * chêne, et la garde vérifie que chaque variante existante est bien nommée ici.
 */
export const ECORCE_PAR_VARIANTE: Record<string, keyof typeof ECORCES> = {
  tree: 'chene', chene_pre: 'chene', old_tree: 'chene',
  hetre: 'hetre', bouleau: 'bouleau', saule: 'saule', baliveau: 'chene',
  pin: 'pin', vieux_pin: 'pin', sapin: 'conifere', meleze: 'conifere',
}

export function ecorceDe(slug: string): Ecorce {
  return ECORCES[ECORCE_PAR_VARIANTE[slug] ?? 'chene'] ?? ECORCE_DEFAUT
}

/** Ce que `champDeHauteur` rend : le relief, et le ton de chaque pixel (l'un suit l'autre). */
export interface GrainFut {
  /** Hauteur de matière, dans la colonne uniquement. Hors colonne : 0. */
  relief: Float32Array
  /** Le ton à peindre, pixel par pixel — `null` hors de la colonne. */
  ton: (string | null)[]
}

/**
 * LE GRAIN D'UN FÛT — le relief ET l'albédo, dérivés ensemble.
 *
 * Ils ne peuvent pas diverger parce qu'ils sont calculés dans la même boucle : le creux du
 * sillon est peint au ton sombre PARCE QUE le relief y descend. Deux passes séparées finiraient
 * par se décaler, exactement comme la silhouette `_lit` avait fini par se décaler du dessin
 * peint avant le 2026-07-28.
 */
export function champDeHauteur(
  e: Ecorce, W: number, H: number, x0: number, x1: number, tons: TonsFut, seed = 7,
  /**
   * L'EMPATTEMENT — la demi-extension de la collerette, rangée par rangée EN PARTANT DU BAS
   * (`empattementRangs` d'`arbre-art`, la seule écriture de cette forme). Absent : un fût nu,
   * comme avant le 2026-08-31.
   */
  empattement: readonly number[] = [],
): GrainFut {
  const Wc = x1 - x0
  const relief = new Float32Array(W * H)
  const ton: (string | null)[] = new Array<string | null>(W * H).fill(null)
  const eclat = tons.eclat ?? tons.clair

  // Les sillons verticaux : des colonnes creusées, à des abscisses seedées.
  const creux = new Array<boolean>(Wc).fill(false)
  for (let s = 0; s < e.nSillons; s++) creux[Math.floor(hash(s, 0, seed) * Wc)] = true

  for (let y = 0; y < H; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x
      const col = x - x0
      const u = (col + 0.5) / Wc

      // ① LE PRISME — le pan bombe vers le centre ; `cell` le quantifiera en facettes.
      let h = 1 - e.bombe * Math.abs(u * 2 - 1)

      // ② LES SILLONS verticaux, et un léger bruit de colonne : la crête n'est pas d'équerre.
      if (creux[col]) h -= e.sillons
      h -= 0.06 * hash(col, 0, seed + 3)

      // ③ LA RUPTURE HORIZONTALE — celle qui paie à midi. Le bord SUPÉRIEUR d'une plaque monte
      //    (il regarde le nord), son bord inférieur plonge (il regarde le sud → noir).
      //
      //    DÉCALÉE PAR COLONNE, et c'est une correction vue sur la planche, pas une précaution :
      //    à rupture alignée sur toute la largeur, le tronc sortait en ÉCHELLE — des barreaux
      //    réguliers, ce qui n'est l'écorce d'aucun arbre. Une écorce se fend par PLAQUES, et
      //    deux plaques voisines ne se fendent pas à la même hauteur.
      const decalCol = Math.floor(hash(col, 0, seed + 31) * e.plaque)
      const bande = Math.floor((y + decalCol) / e.plaque)
      const dansLaBande = (y + decalCol) - bande * e.plaque
      const marche = Math.floor(hash(bande, col, seed + 11) * 2)
      if (dansLaBande === marche) h -= e.plaqueProfondeur
      else if (dansLaBande === marche + 1) h += e.plaqueProfondeur * 0.5

      // ④ un grain fin, pour que deux troncs voisins ne soient pas jumeaux
      h -= 0.05 * hash(col, y, seed + 17)
      relief[i] = Math.max(0.05, Math.min(1, h))

      // ── L'ALBÉDO : de la MATIÈRE, jamais de l'ombrage — il survit à l'aplatissement `_lit`. ──
      let t = tons.clair
      if (creux[col] && e.sillons > 0.2) t = tons.sombre
      else if (relief[i]! > 0.9 && e.plaqueProfondeur > 0.2) t = eclat

      // LES LENTICELLES du bouleau — des TIRETS, pas des taches. La première écriture hachait par
      // blocs de 2×2 et sortait un camouflage ; la photo montre des traits d'UN pixel de haut et
      // de deux à quatre de large, ESPACÉS. On tire donc une ligne (rare), puis un segment DANS
      // cette ligne : c'est l'horizontalité qui fait reconnaître un bouleau.
      if (e.lenticelles > 0 && hash(y, 0, seed + 23) < e.lenticelles * 0.42) {
        const debut = Math.floor(hash(y, 1, seed + 29) * Wc)
        const longueur = 2 + Math.floor(hash(y, 2, seed + 29) * 3)
        if (col >= debut && col < debut + longueur) t = tons.sombre
      }
      ton[i] = t
    }
  }

  /* ═══ L'EMPATTEMENT — la collerette de racines, et c'est ELLE qui montre la hitbox ═══
   *
   * Elle est peinte APRÈS la colonne et DÉBORDE de part et d'autre : sa rangée du sol fait
   * exactement le carré bloquant (`empattementW`). Sans elle, le fût dessiné (mince, à sa
   * proportion d'arbre) sous-estimait l'obstacle d'un facteur deux, et rien à l'écran ne disait
   * où l'on butait — la flaque de contact seule ne fait pas une forme lisible sous une canopée.
   *
   * SON RELIEF DESCEND VERS L'EXTÉRIEUR (`0.75 → 0.3`) : une racine n'est pas un socle carré,
   * elle plonge. C'est ce qui la fait lire comme du bois qui s'enfonce plutôt que comme un
   * piédestal — et la normale cubique (`passes:1, k:3.5`) en tire une facette franche.
   */
  for (let k = 0; k < empattement.length; k++) {
    const ext = empattement[k]!
    const y = H - 1 - k
    if (y < 0) break
    for (let d = 1; d <= ext; d++) {
      // Le fondu vers le bord : plein contre le fût, presque plat à l'extrémité.
      const h = 0.75 - 0.45 * ((d - 1) / Math.max(1, ext))
      for (const x of [x0 - d, x1 - 1 + d]) {
        if (x < 0 || x >= W) continue
        const i = y * W + x
        relief[i] = h
        // La collerette prend la terre : ton de CORPS, jamais le pan clair du fût.
        ton[i] = tons.corps
      }
    }
  }
  return { relief, ton }
}

/** Le PIED SOMBRE, appliqué après coup : un mélange vers le ton de creux sur le bas du fût.
 *  Vrai du pin sylvestre (seul le haut est saumon) comme du bouleau (le pied se crevasse). */
export function facteurPied(e: Ecorce, y: number, H: number): number {
  if (e.piedSombre <= 0) return 0
  return Math.max(0, (y - H * (1 - e.piedSombre)) / (H * e.piedSombre)) * 0.55
}
