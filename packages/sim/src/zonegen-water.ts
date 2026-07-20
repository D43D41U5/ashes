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

/**
 * Le RÉGLAGE de l'eau — densité et formes. La densité des lacs est PAR TUILE MARCHABLE de la
 * Racine : le nombre de pièces d'eau (et donc de cours d'eau qui les relient) évolue avec la taille
 * de la zone (décision d'Alexis). Ordres de grandeur À CALIBRER en playtest — Alexis juge en jouant.
 */
export const EAU = {
  /** Lacs par tuile marchable de la Racine. 1/40 000 ≈ un plan d'eau tous les deux tiers d'écran². */
  DENSITE_LACS: 1 / 40_000,

  /** Le quantum de forme, en tuiles (= `RELIEF.MOTIF`) : lacs et coudes de cours d'eau s'y alignent. */
  MOTIF: 8,

  /** Demi-étendue d'un lac, en MOTIFS (× 8 tuiles). Un tirage entre les deux bornes — les petits
   *  tirages (sans cœur profond assez grand) donnent les « petits plans d'eau ». */
  LAC_MIN_MOTIFS: 1,
  LAC_MAX_MOTIFS: 3,
  /** Épaisseur de l'anneau de haut-fond ceignant le cœur profond, en tuiles. En deçà de cette
   *  marge de berge, pas de cœur profond : le lac reste un simple plan d'eau franchissable. */
  BERGE: 3,

  /** Demi-largeur d'un ruisseau (0 → 1 tuile, 1 → 3 tuiles). */
  RUISSEAU_DEMI_LARGEUR: 1,
  /** Demi-largeur de la rivière (la plus longue liaison du réseau). */
  RIVIERE_DEMI_LARGEUR: 2,
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

  /** Marge (tuiles) exigée entre un LAC et toute frontière : garde l'eau au cœur de la Racine,
   *  donc loin des seuils (qui vivent sur les frontières). */
  MARGE_FRONTIERE: 6,
  /** Tentatives de rejet par lac avant d'abandonner ce tirage. */
  ESSAIS: 60,
} as const

interface Lac {
  cx: number
  cy: number
  hw: number
  hh: number
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
  racineId: number,
  width: number,
  height: number,
  seed: number,
  bordure: number,
): void {
  const N = width * height

  // La SURFACE marchable de la Racine — c'est elle qui dose le nombre de lacs.
  let surface = 0
  for (let i = 0; i < N; i++) {
    if (zone[i] === racineId && TERRAINS[terrain[i]!]?.walkable === true) surface++
  }
  if (surface === 0) return

  const nLacs = Math.round(surface * EAU.DENSITE_LACS)
  const s = seed ^ 0x45415500 /* 'EAU' */

  // On COLLECTE les tuiles d'eau peintes au fil de l'eau : la frange de marais les relit sans avoir
  // à rebalayer la carte entière (une passe de 3,75 M de tuiles épargnée par génération).
  const eaux: number[] = []
  const lacs = placerLacs(terrain, zone, racineId, width, height, bordure, s, nLacs, eaux)
  relierLesLacs(terrain, zone, racineId, width, height, lacs, eaux)
  frangeDeMarais(terrain, zone, racineId, width, height, s, eaux)
}

/**
 * LES LACS — des rectangles quantifiés au motif, cœur profond ceint de haut-fond. Rend la liste
 * des lacs posés (centre + demi-étendues), de quoi tisser le réseau de cours d'eau ensuite.
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
): Lac[] {
  // Un rectangle est-il POSABLE ? Toutes ses tuiles, plus la marge de frontière, doivent être de la
  // Racine, marchables et à l'intérieur de la bordure. Exiger la Racine sur toute l'emprise + marge
  // tient l'eau loin des frontières (donc des seuils), et interdit deux cœurs profonds voisins sans
  // berge (l'eau profonde n'est pas marchable → le test échoue sur elle).
  const rectPosable = (cx: number, cy: number, hw: number, hh: number): boolean => {
    const m = EAU.MARGE_FRONTIERE
    const x0 = cx - hw - m
    const x1 = cx + hw + m
    const y0 = cy - hh - m
    const y1 = cy + hh + m
    if (x0 < bordure || y0 < bordure || x1 >= width - bordure || y1 >= height - bordure) return false
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x
        if (zone[i] !== racineId) return false
        if (TERRAINS[terrain[i]!]?.walkable !== true) return false
      }
    }
    return true
  }

  const lacs: Lac[] = []
  for (let n = 0; n < nLacs; n++) {
    for (let essai = 0; essai < EAU.ESSAIS; essai++) {
      const r0 = hash2(n * 4 + 0, essai, s)
      const r1 = hash2(n * 4 + 1, essai, s)
      const r2 = hash2(n * 4 + 2, essai, s)
      const r3 = hash2(n * 4 + 3, essai, s)
      const span = EAU.LAC_MAX_MOTIFS - EAU.LAC_MIN_MOTIFS + 1
      const hw = (EAU.LAC_MIN_MOTIFS + Math.floor(r0 * span)) * EAU.MOTIF
      const hh = (EAU.LAC_MIN_MOTIFS + Math.floor(r1 * span)) * EAU.MOTIF
      const cx = bordure + Math.floor(r2 * (width - 2 * bordure))
      const cy = bordure + Math.floor(r3 * (height - 2 * bordure))
      if (!rectPosable(cx, cy, hw, hh)) continue

      // Le plan d'eau : haut-fond partout.
      for (let y = cy - hh; y <= cy + hh; y++) {
        for (let x = cx - hw; x <= cx + hw; x++) {
          const i = y * width + x
          terrain[i] = TERRAIN_SHALLOW_WATER
          eaux.push(i)
        }
      }
      // Le cœur profond, rétréci de la berge de chaque côté. Ne naît que s'il reste de la place —
      // sinon le lac est un simple plan d'eau franchissable, sans mur.
      const dw = hw - EAU.BERGE
      const dh = hh - EAU.BERGE
      if (dw >= EAU.MOTIF && dh >= EAU.MOTIF) {
        for (let y = cy - dh; y <= cy + dh; y++) {
          for (let x = cx - dw; x <= cx + dw; x++) {
            terrain[y * width + x] = TERRAIN_DEEP_WATER
          }
        }
      }
      lacs.push({ cx, cy, hw, hh })
      break
    }
  }
  return lacs
}

/**
 * LE RÉSEAU — chaque lac est relié à son plus proche voisin par un chenal de haut-fond. Les
 * liaisons sont dédupliquées (A–B = B–A), et la plus longue devient la RIVIÈRE (plus large). Un
 * lac seul n'a pas de cours d'eau : un ruisseau relie deux eaux, il ne part pas de nulle part.
 */
function relierLesLacs(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  lacs: Lac[],
  eaux: number[],
): void {
  if (lacs.length < 2) return

  // Le graphe du plus proche voisin (distance de Manhattan entre centres), dédupliqué.
  const vues = new Set<number>()
  const liaisons: { a: number; b: number; d: number }[] = []
  for (let i = 0; i < lacs.length; i++) {
    let best = -1
    let bestD = Infinity
    for (let j = 0; j < lacs.length; j++) {
      if (j === i) continue
      const d = Math.abs(lacs[i]!.cx - lacs[j]!.cx) + Math.abs(lacs[i]!.cy - lacs[j]!.cy)
      if (d < bestD) { bestD = d; best = j }
    }
    if (best < 0) continue
    const cle = i < best ? i * lacs.length + best : best * lacs.length + i
    if (vues.has(cle)) continue
    vues.add(cle)
    liaisons.push({ a: i, b: best, d: bestD })
  }

  // La plus longue liaison est la rivière : elle se creuse plus large.
  let riviere = -1
  let riviereD = -1
  for (let k = 0; k < liaisons.length; k++) {
    if (liaisons[k]!.d > riviereD) { riviereD = liaisons[k]!.d; riviere = k }
  }

  for (let k = 0; k < liaisons.length; k++) {
    const l = liaisons[k]!
    const hw = k === riviere ? EAU.RIVIERE_DEMI_LARGEUR : EAU.RUISSEAU_DEMI_LARGEUR
    tracerChenal(terrain, zone, racineId, width, height, lacs[l.a]!, lacs[l.b]!, hw, eaux)
  }
}

/**
 * Creuse un chenal de haut-fond de A vers B en marches de Manhattan : on avance d'un tronçon sur
 * l'axe où il reste le plus de chemin, puis on coude. On ne peint QUE des tuiles de Racine
 * marchables : les tuiles d'eau déjà en place (les deux lacs, un autre chenal) sont laissées
 * telles quelles — le chenal se raccorde donc proprement aux deux plans d'eau qu'il relie.
 */
function tracerChenal(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  a: Lac,
  b: Lac,
  hw: number,
  eaux: number[],
): void {
  let x = a.cx
  let y = a.cy
  const maxPas = width + height // garde-fou : un chemin de Manhattan ne dépasse jamais ça

  const bande = (cx: number, cy: number, horiz: boolean): void => {
    for (let w = -hw; w <= hw; w++) {
      const px = horiz ? cx : cx + w
      const py = horiz ? cy + w : cy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const i = py * width + px
      if (zone[i] !== racineId) continue // on ne déborde jamais hors de la Racine
      const cur = terrain[i]
      if (cur === TERRAIN_SHALLOW_WATER || cur === TERRAIN_DEEP_WATER) continue // eau existante : intacte
      if (TERRAINS[cur!]?.walkable !== true) continue // on ne noie pas un mur
      terrain[i] = TERRAIN_SHALLOW_WATER
      eaux.push(i)
    }
  }

  let pas = 0
  while ((x !== b.cx || y !== b.cy) && pas < maxPas) {
    const dx = b.cx - x
    const dy = b.cy - y
    const horiz = Math.abs(dx) >= Math.abs(dy)
    const step = horiz ? Math.sign(dx) : Math.sign(dy)
    const troncon = Math.min(EAU.TRONCON, horiz ? Math.abs(dx) : Math.abs(dy))
    for (let t = 0; t < troncon; t++) {
      if (horiz) x += step
      else y += step
      bande(x, y, horiz)
      pas++
    }
  }
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
