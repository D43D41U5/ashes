/**
 * L'EAU DE LA RACINE — lacs, plans d'eau, rivière et ruisseaux dans les Prés Bas (T0).
 *
 * Comble un écart de la spec : `worldgen.md` décrit les Prés Bas comme « prés, bosquets,
 * RUISSEAUX, lumière » — mais la palette `pres_bas` était sèche. On pose donc de l'eau, et rien
 * qu'ici : l'eau est le marqueur de la zone basse et vivante (les hauteurs n'ont pas d'eau liquide).
 *
 * ═══ TOUT EST RECTILIGNE (spec R32) ═══ Comme le reste de la carte : pas de berge bruitée, pas de
 * méandre courbe. Un lac est un RECTANGLE aligné au motif ; une rivière/un ruisseau est une
 * polyligne ORTHOGONALE (marches façon Manhattan). L'ancien `valleygen-water.ts` faisait du courbe
 * — abrogé pour la carte jouée.
 *
 * ═══ DES RUISSEAUX LOGIQUES ═══ Un cours d'eau RELIE deux plans d'eau : il sort d'un lac et se
 * jette dans un autre. On ne sème plus de moignons partant de l'herbe pour finir dans l'herbe. Le
 * réseau est le graphe du plus proche voisin entre lacs (dédupliqué) ; sa plus longue liaison est
 * la RIVIÈRE (plus large). Le nombre de cours d'eau suit donc le nombre de lacs — donc la taille
 * de la zone.
 *
 * ═══ L'INVARIANT QUI REND LA CONNEXITÉ GRATUITE ═══
 *
 *   **Jamais d'eau profonde sans un anneau de haut-fond la séparant de la terre marchable.**
 *
 * `deep_water` est un MUR (spec R5, non marchable) ; `shallow_water` est un GUÉ (marchable, à
 * demi-vitesse). Seuls les LACS ont un cœur profond, toujours ceint de leur anneau de haut-fond ;
 * rivière et ruisseaux sont en haut-fond pur. On peut donc TOUJOURS contourner l'eau à pied :
 * aucune poche de terre n'est enclavée, `garantirLaConnexite` (dans `zonegen.ts`) n'a rien à
 * réparer — la connexité tient par construction.
 *
 * Pur et déterministe : `hash2`, et `+ - * / sqrt floor ceil round abs sign min max` uniquement
 * (invariant n°2).
 */
import { TERRAINS, TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_SHALLOW_WATER } from './balance'
import { hash2 } from './noise'
import { CREUX, altitudeAt, celluleDe, type Creux } from './racine-relief'
import type { GrapheZones } from './zonegraph'

/**
 * Le RÉGLAGE de l'eau — densité et formes. La densité des lacs est PAR TUILE MARCHABLE de la
 * Racine : le nombre de pièces d'eau (et donc de cours d'eau qui les relient) évolue avec la taille
 * de la zone (décision d'Alexis). Ordres de grandeur À CALIBRER en playtest — Alexis juge en jouant.
 */
export const EAU = {
  /**
   * Lacs par tuile marchable de la Racine.
   *
   * DIVISÉ PAR DEUX le 2026-07-29, et c'est un choix de lecture, pas une économie. À 1/40 000 la
   * Racine portait DIX-HUIT plans d'eau : dix-huit mares de la même taille, semées dans le pré —
   * la spec t0-exploration §2 appelait ça *« un archipel timide »*, et le grief tenait toujours.
   * On préfère HUIT vrais lacs (plafond d'inondation doublé dans la foulée) : moins d'eau posée,
   * plus d'eau qui compte, et la rivière a enfin des perles à enfiler qui se voient.
   */
  DENSITE_LACS: 1 / 85_000,

  /** Le quantum de forme, en tuiles (= `RELIEF.MOTIF`) : lacs et coudes de cours d'eau s'y alignent. */
  MOTIF: 8,

  // ══ LE LAC EST UNE CUVETTE INONDÉE, plus un rectangle tiré au sort ═════════════════════════
  //
  // (Décision d'Alexis, 2026-07-29 : le micro-relief muet commande la composition des Prés Bas —
  // voir `racine-relief.ts`.) Avant : `rectPosable` ne demandait que « dans la Racine, marchable,
  // à ≥ 6 tuiles d'une frontière », et le lac sortait carré, n'importe où. **Rien dans le sol ne
  // disait pourquoi il était là.** Désormais on choisit le point le plus BAS encore libre, on
  // pose un niveau d'eau `LAME` au-dessus, et on inonde ce qui est dessous : le lac ÉPOUSE sa
  // cuvette. Sa forme est un polygone rectiligne (une union de motifs de 8) — R32 tient, et le
  // carré parfait disparaît de lui-même.

  /** Taille maximale d'un lac, en CELLULES de motif (× 64 tuiles). Le plafond de l'inondation :
   *  une grande cuvette ne doit pas noyer un quart du pays (A17 — la Racine porte les villages).
   *  44 → jusqu'à 2 816 tuiles, environ 53 de côté : un lac qu'on contourne, pas une mare. */
  LAC_MAX_CELLULES: 44,
  /** Écart minimal entre deux points bas retenus, en CELLULES (× 8 tuiles). 14 → 112 tuiles :
   *  deux lacs distincts, jamais deux lobes de la même cuvette comptés deux fois. */
  LAC_ECART_CELLULES: 14,
  /** Variation de la lame d'eau d'un lac à l'autre, en fraction de `CREUX.LAME`. Sans elle les
   *  lacs sortaient tous de la même taille — douze jumeaux semés dans le pré. Une cuvette se
   *  remplit plus ou moins ; le tirage porte sur le NIVEAU, pas sur la forme, donc la variété
   *  reste celle du terrain. */
  LAC_LAME_MIN: 0.5,
  LAC_LAME_MAX: 2.1,

  /** Portée maximale d'un ruisseau, en tuiles. Au-delà, le lac n'a pas d'exutoire : c'est une
   *  cuvette fermée, et c'est une réponse honnête — mieux qu'un canal de six cents tuiles qui
   *  traverse tout le pays pour joindre une eau qu'on ne voit pas. */
  RUISSEAU_PORTEE: 300,
  /** Épaisseur de l'anneau de haut-fond ceignant le cœur profond, en tuiles. Le cœur est ÉRODÉ
   *  depuis la rive (BFS au niveau de la tuile) et non plus rétréci d'un rectangle : l'invariant
   *  de R45 (« jamais de profond sans anneau marchable ») tient donc sur une forme quelconque.
   *  Un lac trop petit pour porter une tuile à cette distance n'a simplement pas de cœur. */
  BERGE: 3,

  /** Demi-largeur d'un ruisseau (0 → 1 tuile, 1 → 3 tuiles). */
  RUISSEAU_DEMI_LARGEUR: 1,
  /** Longueur d'un tronçon droit avant un coude, en tuiles (marche de l'escalier Manhattan). */
  TRONCON: 24,

  /** LE MARAIS — une frange boueuse autour de TOUTE l'eau, avec parcimonie. */
  /** Rayon de la frange, en tuiles autour d'une tuile d'eau (voisinage carré, rectiligne). */
  MARAIS_RAYON: 3,
  /** Fraction des motifs riverains qui deviennent marais. Bas = parcimonie. Quantifié au motif :
   *  le marais vient donc par petites plaques cohérentes collées à l'eau, pas en confettis. */
  MARAIS_COUVERTURE: 0.3,
  /** TRÈS rarement (demande d'Alexis), le marais s'ouvre sur une flaque d'eau libre au milieu des
   *  roseaux. Gate PAR TUILE (pas par motif) → des flaques éparses ; chacune fait 2×2 (une case
   *  seule rendrait un losange, cf. `frangeDeMarais`). Toujours du haut-fond marchable : aucune
   *  incidence sur la connexité. */
  MARAIS_FLAQUE: 0.015,

  /**
   * Rayon d'exclusion de l'EAU DORMANTE autour d'un seuil de la Racine, en tuiles (Manhattan).
   *
   * *Un seuil ne nourrit rien, pas même à boire* (worldgen R10.3, garde A16). 84 n'est pas un
   * chiffre rond de confort : il doit couvrir le plus long couloir de seuil (`DEBORD_SECOURS`,
   * 36) ET la fenêtre où la sente cherche sa bouche (`SENTES.BOUCHE` + 40 = 66), avec de quoi
   * poser une route de trois tuiles au bout. En deçà, la porte débouche sur une rive et la
   * sente n'a plus où se poser — MESURÉ, garde A6 rouge sur la seed 2026.
   */
  MARGE_SEUIL: 84,

  // ══ LA RIVIÈRE (spec t0-exploration R5-R8) — la colonne vertébrale de la Racine ══
  //
  // Elle TRAVERSE la zone du nord au sud : elle naît au pied d'une frontière de la ceinture
  // (l'eau descend des hauteurs), enfile les lacs qui sont sur sa route, et meurt à la
  // frontière de la Cendrière — l'eau descend vers le feu. STRICTEMENT intra-Racine : R45
  // garde sa lettre (l'eau est le marqueur de la zone basse), on n'a pas ressuscité le
  // fleuve traversant abrogé — c'est la zone qu'elle traverse, pas la carte.

  /** Demi-largeur du LIT (haut-fond marchable). 3 → 7 tuiles : une rivière, pas un fossé. */
  RIVIERE_DEMI_LIT: 3,
  /** Demi-largeur du CŒUR profond. 1 → 3 tuiles de mur d'eau (R5), toujours ceint du lit. */
  RIVIERE_DEMI_COEUR: 1,
  /** Le cœur s'arrête à N pas de chaque bout : la source et la bouche sont des hauts-fonds. */
  RIVIERE_BOUCHE: 8,
  /** Écart minimal (tuiles) entre l'embouchure/la source et tout seuil : une porte n'a pas
   *  les pieds dans l'eau (worldgen R10 : un seuil ne nourrit rien, pas même à boire). */
  RIVIERE_MARGE_SEUIL: 40,
  /** Un lac est « sur la route » s'il s'écarte de moins de N tuiles de la ligne source→bouche. */
  RIVIERE_DETOUR_MAX: 130,
  // Les GUÉS appartiennent aux SENTES (`zonegen-sentes.ts`, SENTES.GUES_MIN / GUE_DEMI) :
  // c'est le croisement qui crée le gué. Ne pas redéclarer de bouton ici — la revue a trouvé
  // deux constantes mortes à cet endroit, et un bouton mort finit toujours par être tourné.
} as const

/** Ce que la rivière laisse derrière elle — de quoi percer les gués et nommer les lieux. */
export interface Riviere {
  /** Les cellules du FIL de la rivière, dans l'ordre amont → aval (index de tuile). */
  fil: number[]
  /** Les tuiles du cœur PROFOND (sous-ensemble du fil élargi). Les sentes y creusent les gués. */
  coeur: Set<number>
}

/**
 * Le fil TOURNE-T-IL en `fil[k]` ? — LA définition du coude, et il n'y en a qu'une.
 *
 * Comparaison COMPOSANTE PAR COMPOSANTE des deux pas, et non « le pas est-il horizontal ? » :
 * la garde de test et les sondes énumèrent les coudes avec cette règle-là. Deux définitions du
 * coude qui divergeraient, et on chercherait un fantôme.
 */
export function estUnCoude(fil: readonly number[], k: number, width: number): boolean {
  const a = fil[k - 1]!
  const b = fil[k]!
  const c = fil[k + 1]!
  const ax = a % width
  const bx = b % width
  const cx = c % width
  if (bx - ax !== cx - bx) return true
  return (b - bx) / width - (a - ax) / width !== (c - cx) / width - (b - bx) / width
}

/**
 * LES CELLULES OÙ L'EAU DORMANTE N'A PAS LE DROIT D'ALLER — les abords des portes de la Racine.
 *
 * 1 = libre, 0 = interdit. Le rayon est `EAU.MARGE_SEUIL`, mesuré en Manhattan depuis le point
 * de seuil : il doit couvrir le couloir le plus long (`DEBORD_SECOURS`, 36 tuiles) ET la fenêtre
 * où la sente cherche sa bouche (`SENTES.BOUCHE` + 40, soit 66) — sans quoi la porte débouche
 * sur une rive et la route n'a plus où se poser.
 */
export function masqueDesSeuils(creux: Creux | null, g: GrapheZones, racineId: number): Uint8Array {
  if (!creux) return new Uint8Array(0)
  const M = CREUX.MOTIF
  const masque = new Uint8Array(creux.cols * creux.rows).fill(1)
  const portes = g.seuils.filter((s) => s.a === racineId || s.b === racineId)
  for (let my = 0; my < creux.rows; my++) {
    for (let mx = 0; mx < creux.cols; mx++) {
      const tx = (creux.mx0 + mx) * M + M / 2
      const ty = (creux.my0 + my) * M + M / 2
      for (const p of portes) {
        if (Math.abs(p.x - tx) + Math.abs(p.y - ty) < EAU.MARGE_SEUIL) {
          masque[my * creux.cols + mx] = 0
          break
        }
      }
    }
  }
  return masque
}

interface Lac {
  cx: number
  cy: number
  hw: number
  hh: number
  /** Les CELLULES de motif que l'inondation a prises. C'est par là qu'on cherche le déversoir. */
  cellules: number[]
}

/**
 * Pose l'eau de la Racine, EN PLACE, sur le terrain déjà peint par la passe des biomes.
 *
 * À appeler APRÈS la peinture des zones et AVANT le percement des seuils : un seuil qui traverse
 * un plan d'eau le rouvre alors en couloir marchable (la porte gagne), donc l'eau ne bouche jamais
 * un passage. Ne peint que dans la Racine (`zone === racineId`), jamais ailleurs.
 */
export function paintWaterRacine(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
  bordure: number,
  creux: Creux | null,
): Riviere | null {
  const N = width * height
  const racineId = g.racine

  // La SURFACE marchable de la Racine — c'est elle qui dose le nombre de lacs.
  let surface = 0
  for (let i = 0; i < N; i++) {
    if (zone[i] === racineId && TERRAINS[terrain[i]!]?.walkable === true) surface++
  }
  if (surface === 0) return null

  const nLacs = Math.round(surface * EAU.DENSITE_LACS)
  const s = seed ^ 0x45415500 /* 'EAU' */

  // On COLLECTE les tuiles d'eau peintes au fil de l'eau : la frange de marais les relit sans avoir
  // à rebalayer la carte entière (une passe de 3,75 M de tuiles épargnée par génération).
  const eaux: number[] = []
  // ═══ AUCUNE EAU AUX ABORDS D'UNE PORTE (worldgen R10.3, garde A16) ═══
  //
  // *Un seuil ne nourrit rien — pas même à boire.* La règle valait déjà pour la source et
  // l'embouchure de la rivière (`RIVIERE_MARGE_SEUIL`) ; elle ne valait pas pour les lacs, qui
  // n'en avaient pas besoin tant qu'ils étaient de petits rectangles tenus loin des frontières
  // par `rectPosable`. Les cuvettes inondées sont plus grandes et vont là où le terrain descend
  // — et le terrain descend parfois vers une porte. MESURÉ (seed 2026, garde A6 rouge) : un lac
  // noyait la bouche du seuil 4 sur quarante tuiles d'eau profonde, la sente n'avait plus où se
  // poser, et la porte devenait une plage. On exclut donc explicitement.
  const horsSeuils = masqueDesSeuils(creux, g, racineId)
  const lacs = placerLacs(terrain, zone, racineId, width, height, bordure, s, nLacs, eaux, creux, horsSeuils)
  // LA RIVIÈRE D'ABORD, les ruisseaux ensuite : elle réclame les lacs de sa route, et c'est
  // elle qui porte désormais le titre — la « plus longue liaison » de l'ancien réseau redevient
  // un simple ruisseau (le titre se GAGNE en traversant, pas en étant long).
  const riviere = tracerLaRiviere(terrain, zone, g, width, height, s, lacs, eaux, creux)
  relierLesLacs(terrain, zone, racineId, width, height, lacs, eaux, creux, horsSeuils)
  frangeDeMarais(terrain, zone, racineId, width, height, s, eaux)
  return riviere
}

/**
 * ═══ LES LACS — ON POSE UN NIVEAU D'EAU, ET ON INONDE ═══
 *
 * Trois gestes, et c'est toute la réparation du grief « l'eau est posée sur le patchwork » :
 *
 *   1. Le point le plus BAS encore libre du pays devient un lac (le champ d'altitude est trié une
 *      fois, croissant — les cuvettes se servent avant les dos).
 *   2. On pose un niveau d'eau `LAME` au-dessus de ce point, et on INONDE par proche-en-proche
 *      tout ce qui est dessous, à concurrence de `LAC_MAX_CELLULES`. Le lac épouse donc sa
 *      cuvette : sa forme est un polygone rectiligne (union de motifs de 8), jamais un carré.
 *   3. Le cœur profond est ÉRODÉ depuis la rive, au niveau de la TUILE. L'invariant de R45
 *      (« jamais de profond sans anneau de haut-fond marchable ») tient donc sur une forme
 *      quelconque — là où l'ancien « rectangle rétréci de trois » ne tenait que sur un rectangle.
 *
 * Rend la liste des lacs (centre + demi-étendues de la boîte englobante), de quoi tisser le
 * réseau de cours d'eau ensuite.
 */
function placerLacs(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  bordure: number,
  s: number,
  nLacs: number,
  eaux: number[],
  creux: Creux | null,
  horsSeuils: Uint8Array,
): Lac[] {
  const lacs: Lac[] = []
  if (!creux || nLacs <= 0) return lacs
  const M = CREUX.MOTIF

  // ── UNE CELLULE EST-ELLE INONDABLE ? ────────────────────────────────────────────────────
  // Ses 64 tuiles doivent être de la Racine, marchables, et dans la bordure. La marge de
  // frontière (qui tient l'eau loin des seuils) se paie ensuite en exigeant que les VOISINES
  // le soient aussi — `MARGE_FRONTIERE` valant 6 tuiles, une cellule de garde suffit.
  const propre = new Uint8Array(creux.cols * creux.rows)
  for (let my = 0; my < creux.rows; my++) {
    for (let mx = 0; mx < creux.cols; mx++) {
      const tx0 = (creux.mx0 + mx) * M
      const ty0 = (creux.my0 + my) * M
      if (tx0 < bordure || ty0 < bordure || tx0 + M >= width - bordure || ty0 + M >= height - bordure) continue
      let ok = 1
      for (let dy = 0; dy < M && ok === 1; dy++) {
        for (let dx = 0; dx < M; dx++) {
          const i = (ty0 + dy) * width + tx0 + dx
          if (zone[i] !== racineId || TERRAINS[terrain[i]!]?.walkable !== true) { ok = 0; break }
        }
      }
      propre[my * creux.cols + mx] = ok
    }
  }
  const inondable = (k: number): boolean => {
    if (propre[k] !== 1) return false
    if (horsSeuils[k] === 0) return false // un seuil ne nourrit rien, pas même à boire (A16)
    const kx = k % creux.cols
    const ky = (k - kx) / creux.cols
    if (kx === 0 || ky === 0 || kx + 1 >= creux.cols || ky + 1 >= creux.rows) return false
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (propre[(ky + dy) * creux.cols + kx + dx] !== 1) return false
      }
    }
    return true
  }

  // ── LES POINTS BAS, du plus creux au moins creux ────────────────────────────────────────
  // Comparateur TOTAL (l'altitude, puis l'index) : l'ordre ne doit rien à la stabilité du tri
  // du moteur JS — invariant n°2, une carte identique au bit près sur Node et au navigateur.
  const candidats: number[] = []
  for (let k = 0; k < creux.altLarge.length; k++) {
    if (creux.dedans[k] === 1 && creux.altLarge[k]! < creux.seuilBassin && inondable(k)) candidats.push(k)
  }
  candidats.sort((a, b) => (creux.altLarge[a]! - creux.altLarge[b]!) || (a - b))

  const pris = new Uint8Array(creux.cols * creux.rows)
  for (const graine of candidats) {
    if (lacs.length >= nLacs) break
    if (pris[graine] === 1) continue
    const gx = graine % creux.cols
    const gy = (graine - gx) / creux.cols
    // L'écart entre points bas : deux lobes d'une même cuvette ne font pas deux lacs.
    let tropPres = false
    for (const l of lacs) {
      const lx = Math.floor(l.cx / M) - creux.mx0
      const ly = Math.floor(l.cy / M) - creux.my0
      if (Math.abs(lx - gx) + Math.abs(ly - gy) < EAU.LAC_ECART_CELLULES) { tropPres = true; break }
    }
    if (tropPres) continue

    // ── L'INONDATION — le niveau est posé, on prend tout ce qui est dessous ────────────────
    // La LAME varie : une cuvette se remplit plus ou moins. Le tirage porte sur le NIVEAU,
    // jamais sur la forme — c'est le terrain qui garde la main sur le dessin du lac.
    const r = hash2(graine, lacs.length, s)
    const niveau = creux.altLarge[graine]! + CREUX.LAME * (EAU.LAC_LAME_MIN + r * (EAU.LAC_LAME_MAX - EAU.LAC_LAME_MIN))
    const bassin: number[] = [graine]
    const vu = new Set<number>([graine])
    for (let t = 0; t < bassin.length && bassin.length < EAU.LAC_MAX_CELLULES; t++) {
      const k = bassin[t]!
      const kx = k % creux.cols
      const ky = (k - kx) / creux.cols
      const voisins = [
        kx > 0 ? k - 1 : -1,
        kx + 1 < creux.cols ? k + 1 : -1,
        ky > 0 ? k - creux.cols : -1,
        ky + 1 < creux.rows ? k + creux.cols : -1,
      ]
      for (const v of voisins) {
        if (v < 0 || vu.has(v)) continue
        vu.add(v)
        if (creux.dedans[v] !== 1 || creux.altLarge[v]! > niveau || !inondable(v) || pris[v] === 1) continue
        bassin.push(v)
        if (bassin.length >= EAU.LAC_MAX_CELLULES) break
      }
    }

    // ── LA PEINTURE — haut-fond partout, et la boîte englobante pour le réseau ─────────────
    const tuiles: number[] = []
    const dansLeLac = new Set<number>()
    let x0 = width
    let x1 = 0
    let y0 = height
    let y1 = 0
    for (const k of bassin) {
      pris[k] = 1
      const kx = k % creux.cols
      const ky = (k - kx) / creux.cols
      const tx0 = (creux.mx0 + kx) * M
      const ty0 = (creux.my0 + ky) * M
      if (tx0 < x0) x0 = tx0
      if (ty0 < y0) y0 = ty0
      if (tx0 + M - 1 > x1) x1 = tx0 + M - 1
      if (ty0 + M - 1 > y1) y1 = ty0 + M - 1
      for (let dy = 0; dy < M; dy++) {
        for (let dx = 0; dx < M; dx++) {
          const i = (ty0 + dy) * width + tx0 + dx
          terrain[i] = TERRAIN_SHALLOW_WATER
          tuiles.push(i)
          dansLeLac.add(i)
          eaux.push(i)
        }
      }
    }

    creuserLeCoeur(terrain, tuiles, dansLeLac, width)
    lacs.push({
      cx: Math.floor((x0 + x1) / 2),
      cy: Math.floor((y0 + y1) / 2),
      hw: Math.floor((x1 - x0) / 2),
      hh: Math.floor((y1 - y0) / 2),
      cellules: bassin.slice(),
    })
  }
  return lacs
}

/**
 * LE CŒUR PROFOND, ÉRODÉ DEPUIS LA RIVE — l'invariant de R45 sur une forme quelconque.
 *
 * BFS multi-source depuis les tuiles du lac qui touchent autre chose que le lac (4-connexité,
 * comme le pathfinder — R23). Toute tuile à `BERGE` pas ou plus de la rive devient profonde ;
 * elle est donc ceinte d'au moins trois tuiles de haut-fond marchable, par construction. Un lac
 * trop étroit n'a aucune tuile assez loin : il reste un plan d'eau franchissable, sans mur.
 */
function creuserLeCoeur(terrain: number[], tuiles: readonly number[], dansLeLac: ReadonlySet<number>, width: number): void {
  const dist = new Map<number, number>()
  let file: number[] = []
  for (const i of tuiles) {
    if (dansLeLac.has(i - 1) && dansLeLac.has(i + 1) && dansLeLac.has(i - width) && dansLeLac.has(i + width)) continue
    dist.set(i, 0)
    file.push(i)
  }
  let d = 0
  while (file.length > 0) {
    const suivante: number[] = []
    for (const i of file) {
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (!dansLeLac.has(j) || dist.has(j)) continue
        dist.set(j, d + 1)
        suivante.push(j)
      }
    }
    file = suivante
    d++
  }
  for (const i of tuiles) {
    if ((dist.get(i) ?? 0) >= EAU.BERGE) terrain[i] = TERRAIN_DEEP_WATER
  }
}

/**
 * ═══ LE RÉSEAU — UN RUISSEAU DESCEND LA PENTE. IL NE VISE PAS UNE CIBLE. ═══
 *
 * *(Réécrit deux fois le 2026-07-29, et les deux échecs valent d'être gardés.)*
 *
 * D'ABORD on reliait chaque lac à son plus PROCHE voisin, sans regarder la hauteur : sur la carte
 * rendue, des traits coupaient franchement un vallonnement pour joindre deux cuvettes — de l'eau
 * qui monte. Défaut invisible tant que les lacs étaient jetés au hasard : sans haut ni bas,
 * aucune liaison ne pouvait avoir l'air fausse.
 *
 * ENSUITE on a visé « l'eau la plus proche strictement plus basse », rivière comprise. L'eau
 * cessait de remonter — mais le tracé restait une POLYLIGNE DE MANHATTAN VERS UN POINT, et deux
 * lacs presque à la même latitude se retrouvaient joints par un canal parfaitement droit de deux
 * cent cinquante tuiles. C'est géométriquement irréprochable et ça ne ressemble à rien : un
 * chemin le plus court n'est pas un cours d'eau.
 *
 * LA TROISIÈME EST LA BONNE, et elle est plus simple que les deux autres : **on ne choisit pas
 * une destination, on suit la pente.** Depuis le DÉVERSOIR du lac (le point le plus bas de son
 * pourtour — c'est là que l'eau déborde), on descend de cellule en cellule vers la voisine la
 * plus basse, jusqu'à tomber dans une eau. Le tracé n'est plus une droite entre deux points :
 * c'est la trace du terrain, et il serpente comme le pays le veut — en angles droits (R32), la
 * grille du motif ne sait rien dire d'autre.
 *
 * DEUX PROPRIÉTÉS TOMBENT GRATUITEMENT :
 *
 *   — **Pas de cycle possible.** L'altitude décroît STRICTEMENT à chaque pas ; le réseau est donc
 *     une forêt de drainage, sans qu'on ait à le vérifier.
 *   — **Pas de moignon.** On trace le chemin À BLANC d'abord, et on ne le peint QUE s'il aboutit
 *     dans une eau. Un ruisseau qui s'enlise dans un creux fermé n'est jamais peint — la règle
 *     historique (*« on ne sème pas de moignons qui partent de l'herbe pour finir dans l'herbe »*)
 *     tient donc par construction au lieu d'être promise.
 *
 * Un lac dont le déversoir ne mène nulle part est une CUVETTE FERMÉE. C'est une réponse juste,
 * pas un échec : c'est ce qu'est le point bas d'un pays.
 */
function relierLesLacs(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  lacs: Lac[],
  eaux: number[],
  creux: Creux | null,
  horsSeuils: Uint8Array,
): void {
  if (!creux) return // sans relief, aucune pente : la rivière reste seule (repli honnête)
  const M = CREUX.MOTIF
  const nCell = creux.cols * creux.rows

  // LA CARTE D'EAU, à la maille de la cellule — lacs ET rivière, puisque `eaux` porte les deux.
  const celluleEau = new Uint8Array(nCell)
  for (const i of eaux) {
    const k = celluleDe(creux, i % width, (i - (i % width)) / width)
    if (k >= 0) celluleEau[k] = 1
  }

  const voisines = (k: number): number[] => {
    const kx = k % creux.cols
    const ky = (k - kx) / creux.cols
    const out: number[] = []
    if (kx > 0) out.push(k - 1)
    if (kx + 1 < creux.cols) out.push(k + 1)
    if (ky > 0) out.push(k - creux.cols)
    if (ky + 1 < creux.rows) out.push(k + creux.cols)
    return out
  }

  for (const lac of lacs) {
    // ── LE DÉVERSOIR : la cellule la plus basse du POURTOUR du lac. L'eau déborde par là. ──
    const sien = new Set(lac.cellules)
    let deversoir = -1
    let basse = Infinity
    for (const k of lac.cellules) {
      for (const v of voisines(k)) {
        if (sien.has(v) || creux.dedans[v] !== 1) continue
        const a = creux.altLarge[v]!
        // Comparaison STRICTE puis index : ordre total, donc déterministe (invariant n°2).
        if (a < basse || (a === basse && v < deversoir)) { basse = a; deversoir = v }
      }
    }
    if (deversoir < 0) continue
    // DÉJÀ JOINT : le déversoir touche une eau (un autre lac, ou la rivière qui l'a enfilé au
    // passage). Il n'y a pas de ruisseau à creuser entre deux eaux qui se touchent déjà.
    if (celluleEau[deversoir] === 1) continue

    // ── LE CHEMIN DE SORTIE — par le COL LE PLUS BAS, et on ne peint qu'à l'arrivée. ──
    const chemin = cheminDeSortie(creux, celluleEau, deversoir, lac.cellules, M, horsSeuils)
    if (!chemin) continue // cuvette fermée : rien à peindre, et c'est une réponse juste

    // ── LA PEINTURE — deux cellules consécutives sont 4-adjacentes : on relie leurs centres. ──
    for (let k = 0; k + 1 < chemin.length; k++) {
      peindreSegment(terrain, zone, racineId, width, height, creux, chemin[k]!, chemin[k + 1]!, eaux)
    }
  }
}

/**
 * ═══ LE CHEMIN DE SORTIE — ON CHERCHE LE COL LE PLUS BAS, ON NE DESCEND PAS AU HASARD ═══
 *
 * *(Troisième et dernière écriture du drainage, 2026-07-29. Les deux précédentes sont racontées
 * au-dessus de `relierLesLacs` ; celle-ci est celle qui marche, et la MESURE dit pourquoi.)*
 *
 * La version gloutonne — « à chaque pas, la voisine la plus basse sous un plafond » — a été
 * instrumentée sur la seed 1 : sur six pièces d'eau, **une seule** trouvait de l'eau ; deux
 * s'enlisaient, trois épuisaient leurs trente-sept pas sans rien atteindre. Le défaut est celui
 * de toute marche gloutonne sur un champ lisse : elle SERPENTE le long d'une courbe de niveau.
 * Elle ne cherche rien — elle ne fait que ne pas monter.
 *
 * La bonne question n'est pas « où descendre ? », c'est **« par où l'eau peut-elle sortir en
 * franchissant le point le plus bas possible ? »**. C'est un plus-court-chemin DE GOULOT
 * (bottleneck) : le coût d'un chemin n'est pas sa longueur, c'est **l'altitude MAXIMALE qu'il
 * faut franchir**. Dijkstra le donne exactement, avec `cout(v) = max(cout(u), altitude(v))`.
 *
 * Et le résultat est physiquement juste, pas seulement joli : un lac déborde par son point de
 * selle le plus bas, et le ruisseau qui en sort épouse ensuite le fond du vallon — puisque tout
 * détour par un point plus haut serait, par définition, un chemin de goulot pire.
 *
 * Treize mille cellules, quatre voisines : le coût est négligeable devant les 3,75 M de tuiles
 * de la génération. Déterministe (invariant n°2) : le tas ordonne sur (goulot, index de
 * cellule) — un ordre TOTAL, donc l'ordre d'extraction ne doit rien au moteur.
 *
 * Rend le chemin `déversoir → eau` (cellules 4-adjacentes), ou `null` s'il faudrait escalader
 * plus haut que `CREUX.FRANCHISSEMENT` lames au-dessus du déversoir — auquel cas le lac est une
 * CUVETTE FERMÉE, ce qui est la bonne réponse pour un fond de pays.
 */
function cheminDeSortie(
  creux: Creux,
  celluleEau: Uint8Array,
  deversoir: number,
  cellulesDuLac: readonly number[],
  motif: number,
  horsSeuils: Uint8Array,
): number[] | null {
  const n = creux.cols * creux.rows
  const plafond = creux.altLarge[deversoir]! + CREUX.LAME * CREUX.FRANCHISSEMENT
  const maxCell = Math.ceil(EAU.RUISSEAU_PORTEE / motif)

  const goulot = new Float64Array(n).fill(Infinity)
  const parent = new Int32Array(n).fill(-1)
  const clos = new Uint8Array(n)
  // Le lac lui-même est hors jeu : on part de son bord, on n'y retourne pas.
  for (const k of cellulesDuLac) clos[k] = 1

  // Un tas binaire minimal, ordonné sur (goulot, index) — ordre TOTAL, donc déterministe.
  const tasCell: number[] = []
  const tasCle: number[] = []
  const avant = (a: number, b: number): boolean =>
    tasCle[a] !== tasCle[b] ? tasCle[a]! < tasCle[b]! : tasCell[a]! < tasCell[b]!
  const echanger = (a: number, b: number): void => {
    const c = tasCell[a]!; tasCell[a] = tasCell[b]!; tasCell[b] = c
    const l = tasCle[a]!; tasCle[a] = tasCle[b]!; tasCle[b] = l
  }
  const empiler = (cell: number, cle: number): void => {
    tasCell.push(cell)
    tasCle.push(cle)
    let i = tasCell.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!avant(i, p)) break
      echanger(i, p)
      i = p
    }
  }
  const depiler = (): number => {
    const tete = tasCell[0]!
    const dernier = tasCell.length - 1
    echanger(0, dernier)
    tasCell.pop()
    tasCle.pop()
    let i = 0
    for (;;) {
      const g = 2 * i + 1
      const d = g + 1
      let m = i
      if (g < tasCell.length && avant(g, m)) m = g
      if (d < tasCell.length && avant(d, m)) m = d
      if (m === i) break
      echanger(i, m)
      i = m
    }
    return tete
  }

  goulot[deversoir] = creux.altLarge[deversoir]!
  empiler(deversoir, goulot[deversoir]!)
  let arrivee = -1
  while (tasCell.length > 0) {
    const k = depiler()
    if (clos[k] === 1) continue
    clos[k] = 1
    if (celluleEau[k] === 1 && k !== deversoir) { arrivee = k; break }
    const kx = k % creux.cols
    const ky = (k - kx) / creux.cols
    const voisines = [
      kx > 0 ? k - 1 : -1,
      kx + 1 < creux.cols ? k + 1 : -1,
      ky > 0 ? k - creux.cols : -1,
      ky + 1 < creux.rows ? k + creux.cols : -1,
    ]
    for (const v of voisines) {
      if (v < 0 || clos[v] === 1 || creux.dedans[v] !== 1) continue
      if (horsSeuils[v] === 0) continue // on ne fait pas couler un ruisseau dans une porte (A16)
      const a = creux.altLarge[v]!
      if (a > plafond) continue // au-delà, ce n'est plus un col : c'est une colline
      const cle = Math.max(goulot[k]!, a)
      if (cle >= goulot[v]!) continue
      goulot[v] = cle
      parent[v] = k
      empiler(v, cle)
    }
  }
  if (arrivee < 0) return null

  // On remonte les parents, puis on retourne : le fil part du lac et va vers l'eau qu'il rejoint.
  const chemin: number[] = []
  for (let k = arrivee; k !== -1; k = parent[k]!) {
    chemin.push(k)
    if (chemin.length > maxCell) return null // trop long pour être un ruisseau de cette zone
    if (k === deversoir) break
  }
  chemin.reverse()
  return chemin
}

/** Peint le filet d'eau entre les centres de deux cellules 4-adjacentes, à la demi-largeur du
 *  ruisseau. Les mêmes refus que partout : hors Racine, eau déjà là, mur — on ne noie rien. */
function peindreSegment(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  creux: Creux,
  a: number,
  b: number,
  eaux: number[],
): void {
  const M = CREUX.MOTIF
  const demi = EAU.RUISSEAU_DEMI_LARGEUR
  const centre = (k: number): { x: number; y: number } => {
    const kx = k % creux.cols
    return { x: (creux.mx0 + kx) * M + M / 2, y: (creux.my0 + (k - kx) / creux.cols) * M + M / 2 }
  }
  const p = centre(a)
  const q = centre(b)
  const dx = Math.sign(q.x - p.x)
  const dy = Math.sign(q.y - p.y)
  const n = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
  for (let t = 0; t <= n; t++) {
    const cx = p.x + dx * t
    const cy = p.y + dy * t
    for (let w = -demi; w <= demi; w++) {
      const x = dx !== 0 ? cx : cx + w
      const y = dx !== 0 ? cy + w : cy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const i = y * width + x
      if (zone[i] !== racineId) continue
      const cur = terrain[i]!
      if (cur === TERRAIN_SHALLOW_WATER || cur === TERRAIN_DEEP_WATER) continue
      if (TERRAINS[cur]?.walkable !== true) continue
      terrain[i] = TERRAIN_SHALLOW_WATER
      eaux.push(i)
    }
  }
}

/**
 * ═══ LA RIVIÈRE — elle naît au mur de la ceinture, elle meurt au mur du feu ═══
 *
 * (Spec t0-exploration R5-R8.) Le tracé : une COLONNE d'entrée au nord (au pied de la
 * frontière T1), une colonne de sortie au sud (la frontière de la Cendrière), les lacs qui
 * sont à moins de `RIVIERE_DETOUR_MAX` de la ligne enfilés comme des perles, et des marches
 * Manhattan entre chaque étape (R32 : rien ne serpente, tout est rectiligne).
 *
 * DEUX PASSES DE PEINTURE, et l'ordre est l'invariant : le LIT d'abord (haut-fond, demi-
 * largeur 3), le CŒUR ensuite (profond, demi-largeur 1) — et le cœur ne repeint QUE des
 * tuiles que le lit vient de poser (jamais un lac, jamais un ruisseau). L'anneau de
 * haut-fond de R45 tient donc par construction : le profond de la rivière est né entouré
 * de son propre lit. Le cœur s'arrête à `RIVIERE_BOUCHE` pas des deux bouts — la source et
 * l'embouchure se traversent à gué.
 *
 * L'embouchure et la source évitent les seuils de `RIVIERE_MARGE_SEUIL` : une porte n'a
 * pas les pieds dans l'eau (worldgen R10 — un seuil ne nourrit rien, pas même à boire).
 */
function tracerLaRiviere(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  s: number,
  lacs: Lac[],
  eaux: number[],
  creux: Creux | null,
): Riviere | null {
  const racineId = g.racine
  const r = g.zones[racineId]!.rect
  if (!r) return null
  const sel = s ^ 0x52495645 /* 'RIVE' */

  // Les seuils de la Racine — la source et la bouche s'en écartent.
  const seuils = g.seuils.filter((x) => x.a === racineId || x.b === racineId)
  const loinDesSeuils = (x: number, y: number): boolean =>
    seuils.every((q) => Math.abs(q.x - x) + Math.abs(q.y - y) >= EAU.RIVIERE_MARGE_SEUIL)

  // Une colonne candidate doit TOUCHER la Racine : on descend depuis le haut du rectangle
  // (les ceintures mordent dedans — la première tuile Racine marchable est le pied du mur),
  // ou l'on remonte depuis le bas (la Cendrière). Rendu : la tuile de départ, ou -1.
  const descendre = (x: number): number => {
    for (let y = r.y; y < r.y + r.h; y++) {
      const i = y * width + x
      if (zone[i] === racineId && TERRAINS[terrain[i]!]?.walkable === true) return y
    }
    return -1
  }
  const remonter = (x: number): number => {
    for (let y = r.y + r.h - 1; y >= r.y; y--) {
      const i = y * width + x
      if (zone[i] === racineId && TERRAINS[terrain[i]!]?.walkable === true) return y
    }
    return -1
  }

  // ═══ ON N'ENTRE PLUS N'IMPORTE OÙ : ON ENTRE PAR LE POINT LE PLUS BAS ═══
  //
  // (2026-07-29, avec le micro-relief muet.) Les deux colonnes étaient tirées au sort — vingt
  // essais, le PREMIER valide gagnait. Une rivière qui naît sur un dos et meurt sur un autre ne
  // raconte rien : c'est l'eau posée sur le décor. On évalue donc les vingt candidates et l'on
  // garde la PLUS BASSE — la source s'ouvre dans le col du mur de la ceinture, l'embouchure se
  // vide par le point bas du sud. La rivière descend, et ça se voit.
  //
  // Le tirage reste le même (mêmes `hash2`, mêmes bornes) : c'est le CHOIX parmi les candidates
  // qui change. Sans relief (`creux` nul), on retombe exactement sur l'ancien comportement.
  const choisirColonne = (canal: number, bord: (x: number) => number): { x: number; y: number } => {
    let bx = -1
    let by = -1
    let basse = Infinity
    for (let essai = 0; essai < 20; essai++) {
      const x = Math.round(r.x + (0.18 + 0.64 * hash2(essai, canal, sel)) * r.w)
      const y = bord(x)
      if (y < 0 || !loinDesSeuils(x, y)) continue
      const a = creux ? altitudeAt(creux, x, y) : 0
      if (a < basse) { basse = a; bx = x; by = y }
      if (!creux) break // sans relief : le premier valide gagne, comme avant
    }
    return { x: bx, y: by }
  }
  const source = choisirColonne(0, descendre)
  const bouche = choisirColonne(1, remonter)
  const x0 = source.x
  const y0 = source.y
  const x1 = bouche.x
  const y1 = bouche.y
  if (x0 < 0 || x1 < 0 || y1 <= y0) return null // une Racine dégénérée n'a pas de rivière

  // LES PERLES : les lacs proches de la ligne source→bouche, enfilés du nord au sud.
  const perles = lacs
    .filter((l) => l.cy > y0 + 8 && l.cy < y1 - 8)
    .filter((l) => {
      const t = (l.cy - y0) / Math.max(1, y1 - y0)
      return Math.abs(l.cx - (x0 + (x1 - x0) * t)) <= EAU.RIVIERE_DETOUR_MAX
    })
    .sort((a, b) => a.cy - b.cy)
    .slice(0, 3)

  // LE FIL : les étapes, reliées en marches de Manhattan. On note chaque pas dans l'ordre.
  const etapes = [{ cx: x0, cy: y0 }, ...perles.map((l) => ({ cx: l.cx, cy: l.cy })), { cx: x1, cy: y1 }]
  const fil: number[] = []
  let px = x0
  let py = y0
  fil.push(py * width + px)
  for (const e of etapes.slice(1)) {
    let garde = 0
    // ═══ ON AVANCE SUR L'AXE LE MOINS AVANCÉ, PAS SUR LE PLUS LONG ═══
    //
    // (2026-07-29, sur la carte rendue.) « L'axe où il reste le plus de chemin » épuise
    // entièrement le grand côté avant de toucher au petit : entre deux perles écartées en X et
    // proches en Y, la rivière sortait en BARRE HORIZONTALE de deux cents tuiles, puis un
    // crochet. Un canal, pas un cours d'eau — et c'était le défaut le plus voyant de la zone.
    //
    // On compare donc les deux axes en FRACTION DU TOTAL de l'étape : après un tronçon
    // horizontal, c'est le vertical qui est le moins avancé, et il passe. L'escalier s'entrelace
    // le long de la vraie diagonale sans qu'on écrive d'alternance. Rectiligne (R32) : ce sont
    // toujours deux droites et un angle droit, simplement plus courtes et plus nombreuses.
    const totalX = Math.max(1, Math.abs(e.cx - px))
    const totalY = Math.max(1, Math.abs(e.cy - py))
    while ((px !== e.cx || py !== e.cy) && garde < width + height) {
      const dx = e.cx - px
      const dy = e.cy - py
      // À avancement égal, l'axe VERTICAL gagne : la rivière descend vers le feu.
      const horiz = Math.abs(dx) / totalX > Math.abs(dy) / totalY
      const step = horiz ? Math.sign(dx) : Math.sign(dy)
      const troncon = Math.min(EAU.TRONCON, horiz ? Math.abs(dx) : Math.abs(dy))
      for (let t = 0; t < troncon; t++) {
        if (horiz) px += step
        else py += step
        fil.push(py * width + px)
        garde++
      }
    }
  }

  // PASSE 1 — LE LIT : haut-fond, demi-largeur RIVIERE_DEMI_LIT, perpendiculaire au fil.
  // On ne note dans `litNeuf` QUE ce que la rivière vient de poser : le cœur n'aura le droit
  // de creuser QUE là-dedans (jamais un lac, jamais un chenal — leur anneau ne nous doit rien).
  const litNeuf = new Set<number>()
  /** Une tuile de lit — les mêmes refus partout : hors carte, hors Racine, eau déjà là, mur. */
  const poser = (bx: number, by: number): void => {
    if (bx < 0 || by < 0 || bx >= width || by >= height) return
    const i = by * width + bx
    if (zone[i] !== racineId) return // la rivière ne sort JAMAIS de la Racine
    const cur = terrain[i]!
    if (cur === TERRAIN_SHALLOW_WATER || cur === TERRAIN_DEEP_WATER) return // eau existante : intacte
    if (TERRAINS[cur]?.walkable !== true) return // on ne noie pas un mur
    terrain[i] = TERRAIN_SHALLOW_WATER
    litNeuf.add(i)
    eaux.push(i)
  }
  const peindreBande = (cx: number, cy: number, horiz: boolean, demi: number): void => {
    for (let w = -demi; w <= demi; w++) poser(horiz ? cx : cx + w, horiz ? cy + w : cy)
  }
  /** LE COUDE ÉQUERRÉ — le carré plein de côté `2·demi+1` centré sur le PIVOT. */
  const peindreCarre = (cx: number, cy: number, demi: number): void => {
    for (let dy = -demi; dy <= demi; dy++) {
      for (let dx = -demi; dx <= demi; dx++) poser(cx + dx, cy + dy)
    }
  }
  for (let k = 1; k < fil.length; k++) {
    const i = fil[k]!
    const cx = i % width
    const cy = (i - cx) / width
    // le pas était horizontal → la bande est verticale
    peindreBande(cx, cy, Math.abs(i - fil[k - 1]!) === 1, EAU.RIVIERE_DEMI_LIT)
  }
  // LES COUDES, en passe à part — et le PIVOT est l'index de boucle. C'est tout le correctif :
  // l'ancienne version équerrait `fil[k]`, un pas APRÈS le virage, si bien qu'elle repeignait
  // une bande déjà couverte pendant que le coin EXTÉRIEUR restait sec (MESURÉ le 2026-07-26 :
  // portée de l'eau sur la diagonale extérieure, médiane 0,00 tuile contre 4,24 à l'intérieur).
  // Poser le carré plein sur le pivot revient EXACTEMENT à prolonger chaque bras de `demi`
  // tuiles au-delà : la berge extérieure tourne son angle droit au lieu de couper le virage.
  for (let k = 1; k + 1 < fil.length; k++) {
    if (!estUnCoude(fil, k, width)) continue
    const cx = fil[k]! % width
    peindreCarre(cx, (fil[k]! - cx) / width, EAU.RIVIERE_DEMI_LIT)
  }

  // PASSE 2 — LE CŒUR : profond, demi-largeur RIVIERE_DEMI_COEUR, en retrait des deux bouts.
  const coeur = new Set<number>()
  const creuser = (bx: number, by: number): void => {
    if (bx < 0 || by < 0 || bx >= width || by >= height) return
    const i2 = by * width + bx
    if (!litNeuf.has(i2)) return // le cœur ne creuse QUE le lit de la rivière
    terrain[i2] = TERRAIN_DEEP_WATER
    coeur.add(i2)
  }
  for (let k = EAU.RIVIERE_BOUCHE; k < fil.length - EAU.RIVIERE_BOUCHE; k++) {
    const i = fil[k]!
    const cx = i % width
    const cy = (i - cx) / width
    const horiz = Math.abs(i - fil[k - 1]!) === 1
    for (let w = -EAU.RIVIERE_DEMI_COEUR; w <= EAU.RIVIERE_DEMI_COEUR; w++) {
      creuser(horiz ? cx : cx + w, horiz ? cy + w : cy)
    }
    // Le cœur s'équerre comme le lit : le fil sombre tourne l'angle, il ne le coupe pas. Sans
    // risque pour l'anneau de R45 — ce carré de 3 vit au centre du carré de 7 que le lit vient
    // de poser, et `creuser` ne touche de toute façon que `litNeuf`.
    if (k + 1 < fil.length && estUnCoude(fil, k, width)) {
      for (let dy = -EAU.RIVIERE_DEMI_COEUR; dy <= EAU.RIVIERE_DEMI_COEUR; dy++) {
        for (let dx = -EAU.RIVIERE_DEMI_COEUR; dx <= EAU.RIVIERE_DEMI_COEUR; dx++) {
          creuser(cx + dx, cy + dy)
        }
      }
    }
  }

  return { fil, coeur }
}


/**
 * LE MARAIS — une frange de boue autour de TOUTE l'eau, avec parcimonie. Pour chaque tuile d'eau,
 * on regarde son voisinage carré (rayon `MARAIS_RAYON`, rectiligne) ; une tuile de terre marchable
 * de la Racine y devient marais SI son motif passe un gate de bruit rare. Quantifié au motif : le
 * marais vient donc par petites plaques cohérentes collées à l'eau — pas en confettis.
 *
 * `TERRAIN_MARSH` (et pas `reed_marsh`) à dessein : le marais ne doit pas compter comme de l'eau
 * pour la faune (`WATER_TERRAINS`), sinon il étendrait encore les coins de chasse. Les roseaux, eux,
 * poussent déjà tout seuls au bord de l'eau côté client (décor `clutter.ts`).
 */
function frangeDeMarais(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  s: number,
  eaux: readonly number[],
): void {
  const R = EAU.MARAIS_RAYON
  const M = EAU.MOTIF
  const sel = s ^ 0x4d415253 /* 'MARS' */
  const selFlaque = s ^ 0x464c4151 /* 'FLAQ' */

  for (const i of eaux) {
    const wx = i % width
    const wy = (i - wx) / width
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = wx + dx
        const y = wy + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const j = y * width + x
        if (zone[j] !== racineId) continue
        const cur = terrain[j]
        if (cur === TERRAIN_SHALLOW_WATER || cur === TERRAIN_DEEP_WATER || cur === TERRAIN_MARSH) continue
        if (TERRAINS[cur!]?.walkable !== true) continue
        // Gate quantifié au motif : toute la plaque de 8 partage le verdict.
        if (hash2(Math.floor(x / M), Math.floor(y / M), sel) < EAU.MARAIS_COUVERTURE) {
          // Très rarement, une flaque d'eau libre au milieu des roseaux (gate PAR TUILE → éparse).
          // Elle fait 2×2 et NON une case seule : le champ d'eau du shader est filtré linéairement,
          // et l'iso-contour d'un texel isolé est un LOSANGE (carré pivoté à 45°) — un petit carré,
          // lui, se rend proprement. Ne noie que de la terre marchable de la Racine.
          if (hash2(x, y, selFlaque) < EAU.MARAIS_FLAQUE) {
            for (let fy = 0; fy <= 1; fy++) {
              for (let fx = 0; fx <= 1; fx++) {
                const px = x + fx
                const py = y + fy
                if (px < 0 || py < 0 || px >= width || py >= height) continue
                const k = py * width + px
                if (zone[k] !== racineId) continue
                if (terrain[k] === TERRAIN_DEEP_WATER) continue
                if (TERRAINS[terrain[k]!]?.walkable !== true) continue
                terrain[k] = TERRAIN_SHALLOW_WATER
              }
            }
          } else {
            terrain[j] = TERRAIN_MARSH
          }
        }
      }
    }
  }
}
