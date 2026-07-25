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
import type { GrapheZones } from './zonegraph'

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
  RIVIERE_DETOUR_MAX: 220,
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
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
  bordure: number,
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
  const lacs = placerLacs(terrain, zone, racineId, width, height, bordure, s, nLacs, eaux)
  // LA RIVIÈRE D'ABORD, les ruisseaux ensuite : elle réclame les lacs de sa route, et c'est
  // elle qui porte désormais le titre — la « plus longue liaison » de l'ancien réseau redevient
  // un simple ruisseau (le titre se GAGNE en traversant, pas en étant long).
  const riviere = tracerLaRiviere(terrain, zone, g, width, height, s, lacs, eaux)
  relierLesLacs(terrain, zone, racineId, width, height, lacs, eaux)
  frangeDeMarais(terrain, zone, racineId, width, height, s, eaux)
  return riviere
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

  // Tous les chenaux sont des RUISSEAUX : le titre de rivière appartient désormais à celle
  // qui TRAVERSE (spec t0-exploration R5), plus à la liaison la plus longue d'un archipel.
  for (let k = 0; k < liaisons.length; k++) {
    const l = liaisons[k]!
    tracerChenal(terrain, zone, racineId, width, height, lacs[l.a]!, lacs[l.b]!, EAU.RUISSEAU_DEMI_LARGEUR, eaux)
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

  // On tire la colonne d'entrée et celle de sortie — vingt essais chacune, dans le tiers
  // central élargi (une rivière qui longe le bord ne structure rien).
  let x0 = -1
  let y0 = -1
  let x1 = -1
  let y1 = -1
  for (let essai = 0; essai < 20 && x0 < 0; essai++) {
    const x = Math.round(r.x + (0.18 + 0.64 * hash2(essai, 0, sel)) * r.w)
    const y = descendre(x)
    if (y >= 0 && loinDesSeuils(x, y)) { x0 = x; y0 = y }
  }
  for (let essai = 0; essai < 20 && x1 < 0; essai++) {
    const x = Math.round(r.x + (0.18 + 0.64 * hash2(essai, 1, sel)) * r.w)
    const y = remonter(x)
    if (y >= 0 && loinDesSeuils(x, y)) { x1 = x; y1 = y }
  }
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
    while ((px !== e.cx || py !== e.cy) && garde < width + height) {
      const dx = e.cx - px
      const dy = e.cy - py
      // La rivière DESCEND : à distances égales, l'axe vertical gagne (elle coule vers le feu).
      const horiz = Math.abs(dx) > Math.abs(dy)
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
  const peindreBande = (cx: number, cy: number, horiz: boolean, demi: number): void => {
    for (let w = -demi; w <= demi; w++) {
      const bx = horiz ? cx : cx + w
      const by = horiz ? cy + w : cy
      if (bx < 0 || by < 0 || bx >= width || by >= height) continue
      const i = by * width + bx
      if (zone[i] !== racineId) continue // la rivière ne sort JAMAIS de la Racine
      const cur = terrain[i]!
      if (cur === TERRAIN_SHALLOW_WATER || cur === TERRAIN_DEEP_WATER) continue // eau existante : intacte
      if (TERRAINS[cur]?.walkable !== true) continue // on ne noie pas un mur
      terrain[i] = TERRAIN_SHALLOW_WATER
      litNeuf.add(i)
      eaux.push(i)
    }
  }
  for (let k = 1; k < fil.length; k++) {
    const i = fil[k]!
    const prev = fil[k - 1]!
    const cx = i % width
    const cy = (i - cx) / width
    const horiz = Math.abs(i - prev) === 1 // le pas était horizontal → la bande est verticale
    peindreBande(cx, cy, horiz, EAU.RIVIERE_DEMI_LIT)
    // Au COUDE, la bande pivote et laisse un coin sec dans le lit : on peint les deux axes.
    if (k >= 2) {
      const prev2 = fil[k - 2]!
      const horizAvant = Math.abs(prev - prev2) === 1
      if (horizAvant !== horiz) peindreBande(cx, cy, horizAvant, EAU.RIVIERE_DEMI_LIT)
    }
  }

  // PASSE 2 — LE CŒUR : profond, demi-largeur RIVIERE_DEMI_COEUR, en retrait des deux bouts.
  const coeur = new Set<number>()
  for (let k = EAU.RIVIERE_BOUCHE; k < fil.length - EAU.RIVIERE_BOUCHE; k++) {
    const i = fil[k]!
    const prev = fil[k - 1]!
    const cx = i % width
    const cy = (i - cx) / width
    const horiz = Math.abs(i - prev) === 1
    for (let w = -EAU.RIVIERE_DEMI_COEUR; w <= EAU.RIVIERE_DEMI_COEUR; w++) {
      const bx = horiz ? cx : cx + w
      const by = horiz ? cy + w : cy
      if (bx < 0 || by < 0 || bx >= width || by >= height) continue
      const i2 = by * width + bx
      if (!litNeuf.has(i2)) continue // le cœur ne creuse QUE le lit de la rivière
      terrain[i2] = TERRAIN_DEEP_WATER
      coeur.add(i2)
    }
  }

  return { fil, coeur }
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
