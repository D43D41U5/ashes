/**
 * LA FOUDRE — SA GÉOMÉTRIE (demande d'Alexis, 2026-08-19 : « un lightning effect réaliste,
 * un peu de caméra shake à l'impact, des particules au sol »).
 *
 * Module PUR — zéro Phaser, RNG local, aucune horloge murale — sur le patron exact de
 * `meteo-particules.ts` : la loi se prouve headless, `foudre-fx.ts` ne fait que la peindre.
 * Quatre choses vivent ici, et c'est tout ce qui a une FORME dans un éclair :
 *
 *   ① LE TRAIT — la polyligne ciel → point d'impact, ses ramifications, ses runs de 4 px.
 *   ② LE BATTEMENT — la table des crans d'opacité, parce qu'un éclair BAT.
 *   ③ LA SECOUSSE — la rampe d'intensité en fonction de la distance.
 *   ④ LA GERBE — les éclats projetés radialement au point de frappe.
 *
 * ═══ ① LE TRAIT SE SUBDIVISE, IL NE SE TIRE PAS POINT PAR POINT ═══
 *
 * Un traceur naïf place N points régulièrement espacés et secoue chacun d'un bruit
 * indépendant : ça donne une scie de fréquence unique, aussi dentelée en haut qu'en bas et
 * aussi grossière partout. Un éclair n'est pas ça. On fait donc du **déplacement de milieu**
 * (midpoint displacement) : on part de la corde ciel → impact, et à chaque niveau on insère
 * le milieu de chaque segment, écarté PERPENDICULAIREMENT à ce segment d'une amplitude qui
 * se DIVISE PAR DEUX à chaque niveau. Cinq niveaux, 33 points : de grands coudes près du
 * nuage et du détail fin partout, avec la même loi — la signature auto-similaire du vrai.
 *
 * Et l'amplitude est en plus multipliée par `(1 − u)`, `u` étant la position le long de la
 * corde : **la déviation décroît vers le sol et vaut EXACTEMENT 0 au point d'impact.** C'est
 * la lecture physique (le traceur erre dans le nuage et converge sur ce qu'il va frapper) et
 * c'est aussi une garantie de jeu : le trait arrive PILE sur la tuile que la sim frappe, pas
 * à côté — sinon le télégraphe mentirait à retardement.
 *
 * ═══ LES RAMIFICATIONS NE TOUCHENT PAS LE SOL, ET C'EST UNE RÈGLE DE JEU ═══
 *
 * Une branche qui atteindrait le sol dessinerait un SECOND impact là où la sim n'en compte
 * qu'un — un joueur lirait « ça a frappé ici aussi » et se déciderait là-dessus. Elles sont
 * donc bornées à `BRANCHE_GARDE_TUILES` au-dessus de la ligne d'impact, par construction ET
 * par clamp, et le test l'affirme sur mille graines.
 *
 * ═══ LE TRAIT EST EN ESCALIER, JAMAIS TRACÉ ═══
 *
 * `lineStyle` + `strokePath` sur une diagonale rend des bords LISSÉS — hors DA, et le rideau
 * de pluie paie déjà ce prix (« un trait incliné ne se peint PAS par un rectangle tourné »).
 * `segmentEnRuns` marche donc en escalier sur la grille de 4 px, une cellule par pas le long
 * de l'axe dominant, et fusionne les pas qui partagent la même mineure : des carrés durs, et
 * un rectangle par palier au lieu d'un par cellule.
 *
 * ═══ ② UN ÉCLAIR BAT, IL NE S'ÉTEINT PAS ═══
 *
 * Un coup de foudre est une salve : l'arc principal, puis deux ou trois arcs de retour dans
 * le même canal ionisé, séparés de quelques dizaines de millisecondes. À l'œil, ça
 * STROBOSCOPE. On le rend par une TABLE de crans d'opacité (`BATTEMENTS`) indexée par les ms
 * écoulées — jamais un fondu continu : c'est la DA (l'opacité va par crans, patron de la
 * brume) et c'est aussi le vrai.
 *
 * ATTENTION — l'index se prend sur l'horloge en MILLISECONDES, jamais sur un compteur
 * d'images : sous swiftshader une image dure parfois une seconde, un battement compté en
 * images serait inobservable et improuvable.
 *
 * ═══ ③ LA SECOUSSE DÉCROÎT AVEC LA DISTANCE, AUX BORNES EXACTES ═══
 *
 * Une rampe géométrique continue sur TOUTE la plage, pas des paliers : pleine à
 * `SECOUSSE_PLEIN_TUILES` et en deçà, exactement 0 à `SECOUSSE_PORTEE_TUILES` et au-delà,
 * linéaire entre les deux. L'étalon est le CADRE, pas l'art : l'écran montre 20 tuiles de
 * haut et ~35,6 de large — une frappe à 30 tuiles est donc hors champ ou à sa lisière, et
 * elle ne doit rien secouer.
 *
 * ═══ ④ LA GERBE PART À L'OPPOSÉ ═══
 *
 * Rappel maison MESURÉ (les particules d'impact du combat) : une gerbe dirigée VERS le
 * centre se tasse sur elle-même et ne se lit pas. Les éclats partent donc RADIALEMENT vers
 * le dehors — l'angle en éventail régulier plus une gigue, pour qu'aucune image ne montre un
 * grumeau. Ils décélèrent par traînée linéaire (`dv/dt = −k·v`, la loi du module de pluie) et
 * s'éteignent par CRANS d'âge.
 */

/** Le grain de l'art, en px monde — le même que la pluie et les FX de lumière. */
export const GRAIN_PX = 4

/** Un point du trait, en TUILES monde. Le pixel n'apparaît qu'à la quantification. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** Un rectangle à peindre, en CELLULES de 4 px monde. Même contrat que `Run` de la pluie. */
export interface Run {
  cx: number
  cy: number
  w: number
  h: number
}

/** Le PRNG local au client — mulberry32, la copie de `meteo-particules`. JAMAIS `rng.ts` de
 *  la sim : le rendu ne touche à aucun déterminisme, et un tirage de plus décalerait le flux
 *  seedé de toute une partie. */
export function creerRng(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ① LE TRAIT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * NIVEAUX DE SUBDIVISION — 2^4 + 1 = 17 points.
 *
 * IL ÉTAIT À 5, ET ÇA PEIGNAIT UN FAISCEAU (constaté à l'écran, expliqué au calcul). Le
 * déplacement le plus fin vaut `DEVIATION_TUILES × 0,5^(SUBDIVISIONS−1)` : à 5 niveaux c'est
 * 0,16 tuile, soit **2,6 px monde — SOUS le grain de 4 px**. Les trois derniers niveaux
 * étaient donc quantifiés à zéro : on payait leur calcul et leurs rectangles pour un trait
 * qui, à l'écran, n'avait plus qu'un coude. À 4 niveaux le plus fin vaut 0,325 tuile = 5,2 px,
 * au-dessus du grain : il SURVIT à la quantification. `LE PLUS FIN DÉPASSE LE GRAIN` est
 * désormais une garde du test — c'est le genre de régression qui ne se voit pas en relisant.
 */
export const SUBDIVISIONS = 4

/** De combien le canal s'écarte de la verticale à sa naissance, en TUILES. Tiré du seed :
 *  deux frappes ne penchent pas pareil, sinon toute la carte est foudroyée du même angle. */
const PENCHE_TUILES = 5.0

/** L'amplitude de la déviation latérale AU SOMMET, en tuiles — elle décroît linéairement
 *  vers le sol et vaut exactement 0 à l'impact (voir l'en-tête). Elle est LIÉE à
 *  `SUBDIVISIONS` par la garde de grain : la baisser (ou monter les niveaux) finit par
 *  glisser le détail fin sous les 4 px, où il disparaît en silence. */
export const DEVIATION_TUILES = 2.6

/** Combien de ramifications : une ou deux, jamais zéro (un trait nu lit « barre »), jamais
 *  trois (ça devient un arbre, et l'œil cherche lequel a frappé). */
const BRANCHES = [1, 2] as const

/** Où la branche part sur le tronc, en fraction de la chute — jamais dans le dernier tiers :
 *  une fourche juste au-dessus du sol se lirait comme deux impacts. */
const BRANCHE_DEPART = [0.14, 0.6] as const

/** La longueur de la branche, en fraction de la chute totale. */
const BRANCHE_LONGUEUR = [0.15, 0.32] as const

/** L'écart angulaire de la branche au tronc, en radians (le signe est tiré). ~24° à ~54°. */
const BRANCHE_ANGLE = [0.42, 0.95] as const

/**
 * LA GARDE DE SOL, en tuiles : aucune ramification ne descend plus bas que
 * `impact.y − BRANCHE_GARDE_TUILES`. Une branche qui touche dessinerait un SECOND impact là
 * où la sim n'en résout qu'un — de la désinformation de jeu, pas de l'ambiance.
 */
export const BRANCHE_GARDE_TUILES = 2.5

/** La course minimale qu'on laisse à une ramification, en tuiles — voir `iPlafond`. */
const BRANCHE_MIN_TUILES = 0.6

/** Le trait complet : un tronc qui va du ciel à l'impact, des branches qui n'y vont pas. */
export interface Trace {
  readonly tronc: Point[]
  readonly branches: Point[][]
}

/**
 * SUBDIVISER une polyligne par déplacement de milieu. `taper(u)` module l'amplitude selon la
 * position `u ∈ [0, 1]` le long de la corde — c'est lui qui fait décroître la déviation vers
 * le sol. L'amplitude se divise par deux à chaque niveau (auto-similarité).
 */
function subdiviser(
  points: Point[],
  niveaux: number,
  amplitude: number,
  taper: (u: number) => number,
  rng: () => number,
): Point[] {
  let cour = points
  let ampl = amplitude
  for (let n = 0; n < niveaux; n++) {
    const suiv: Point[] = [cour[0]!]
    for (let i = 0; i < cour.length - 1; i++) {
      const a = cour[i]!
      const b = cour[i + 1]!
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      // La perpendiculaire au segment LOCAL : c'est elle qui donne les coudes, pas un
      // décalage horizontal aveugle (qui aplatirait toute branche oblique).
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const px = -dy / len
      const py = dx / len
      // La position du milieu le long de la corde entière : la subdivision étant uniforme
      // en index, `index / (n − 1)` EST le paramètre — pas une approximation.
      const u = (i + 0.5) / (cour.length - 1)
      const e = (rng() * 2 - 1) * ampl * taper(u)
      suiv.push({ x: mx + px * e, y: my + py * e })
      suiv.push(b)
    }
    cour = suiv
    ampl *= 0.5
  }
  return cour
}

/**
 * TRACER UN ÉCLAIR de `hautY` (le plafond du cadre, en tuiles) jusqu'au point d'impact.
 *
 * `graine` est le TICK de la frappe : le même trait tout le temps qu'il dure, et le même
 * d'une image à l'autre — un éclair ne se tortille pas, il est là puis il n'est plus.
 */
export function tracerEclair(graine: number, bas: Point, hautY: number): Trace {
  const rng = creerRng((graine * 2654435761) >>> 0)
  const chute = Math.max(1, bas.y - hautY)
  // Le penché de naissance, tiré : le canal ne descend pas à la verticale du point qu'il
  // frappe (il n'y a aucune raison qu'il le fasse, et ça lit « colonne »).
  const penche = (rng() * 2 - 1) * PENCHE_TUILES
  const haut: Point = { x: bas.x + penche, y: hautY }

  // La déviation décroît vers le sol et s'annule à l'impact : `1 − u`, aux bornes exactes.
  const tronc = subdiviser([haut, bas], SUBDIVISIONS, DEVIATION_TUILES, (u) => 1 - u, rng)
  // Le dernier point EST l'impact, au flottant près — la subdivision n'y touche jamais.

  const branches: Point[][] = []
  const nb = BRANCHES[rng() < 0.55 ? 0 : 1]!
  const yMax = bas.y - BRANCHE_GARDE_TUILES
  // ── LE DERNIER DÉPART POSSIBLE. Une branche qui PART déjà sous la garde ne peut plus
  //    descendre : sa longueur serait rabotée à zéro et elle se peindrait en un point.
  //    MESURÉ par le test sur une chute de 6 tuiles — inoffensif en jeu (la chute réelle
  //    fait ~22 tuiles) mais un invariant qui ne tient que sur les cas courants n'en est
  //    pas un. On borne donc le départ à ce qui laisse `BRANCHE_MIN_TUILES` de course.
  let iPlafond = 1
  for (let i = 1; i <= tronc.length - 2; i++) {
    if (tronc[i]!.y <= yMax - BRANCHE_MIN_TUILES) iPlafond = i
  }
  for (let k = 0; k < nb; k++) {
    const uDepart = BRANCHE_DEPART[0] + rng() * (BRANCHE_DEPART[1] - BRANCHE_DEPART[0])
    const iDepart = Math.max(1, Math.min(iPlafond, Math.round(uDepart * (tronc.length - 1))))
    const a = tronc[iDepart]!
    const b = tronc[Math.min(tronc.length - 1, iDepart + 2)]!
    // La direction du tronc à cet endroit, tournée de ±BRANCHE_ANGLE : la branche PART du
    // canal, elle ne pointe pas dans une direction absolue.
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const signe = rng() < 0.5 ? -1 : 1
    const ang = signe * (BRANCHE_ANGLE[0] + rng() * (BRANCHE_ANGLE[1] - BRANCHE_ANGLE[0]))
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const ux = (dx / len) * cos - (dy / len) * sin
    const uy = (dx / len) * sin + (dy / len) * cos
    let L = chute * (BRANCHE_LONGUEUR[0] + rng() * (BRANCHE_LONGUEUR[1] - BRANCHE_LONGUEUR[0]))
    // ── LA GARDE DE SOL, appliquée D'ABORD sur la longueur (la branche est RACCOURCIE, pas
    //    écrasée) : un clamp seul coucherait la pointe à plat sur une ligne horizontale.
    if (uy > 0.001 && a.y + uy * L > yMax) L = Math.max(0, (yMax - a.y) / uy)
    const fin: Point = { x: a.x + ux * L, y: a.y + uy * L }
    // Trois niveaux : la branche est courte, cinq y mettraient du détail sous la cellule.
    // Amplitude proportionnelle à sa longueur, taper constant (elle ne converge sur rien).
    const pts = subdiviser([a, fin], 3, L * 0.22, () => 1, rng)
    // ── PUIS le clamp, en ceinture : le déplacement de milieu est perpendiculaire, donc il
    //    porte un peu de vertical. Il ne mord presque jamais — mais « presque » n'est pas
    //    une garantie, et l'invariant est une règle de jeu (voir `BRANCHE_GARDE_TUILES`).
    branches.push(pts.map((p) => (p.y > yMax ? { x: p.x, y: yMax } : p)))
  }
  return { tronc, branches }
}

/**
 * UN SEGMENT EN ESCALIER sur la grille de 4 px — la version « de A à B » de `traineeEnRuns`
 * (qui, elle, part d'une tête et d'une longueur). Une cellule par pas le long de l'axe
 * dominant, la mineure arrondie, et les pas de même mineure fusionnés en un rectangle.
 *
 * `hors` reçoit les runs (tableau réutilisé) à partir de `depart` ; rend le nombre écrit.
 */
export function segmentEnRuns(
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
  epaisseur: number,
  hors: Run[],
  depart: number,
): number {
  const dx = cx1 - cx0
  const dy = cy1 - cy0
  const majX = Math.abs(dx) >= Math.abs(dy)
  const maj0 = majX ? cx0 : cy0
  const maj1 = majX ? cx1 : cy1
  const min0 = majX ? cy0 : cx0
  const min1 = majX ? cy1 : cx1
  const N = Math.abs(maj1 - maj0)
  if (N === 0) {
    const d = Math.floor((epaisseur - 1) / 2)
    poser(hors, depart, cx0 - d, cy0 - d, epaisseur, epaisseur)
    return 1
  }
  const sgn = maj1 >= maj0 ? 1 : -1
  const pente = (min1 - min0) / N // |pente| <= 1 par construction
  // L'ÉPAISSEUR EST CENTRÉE SUR LA LIGNE. `traineeEnRuns` (la pluie) la laisse pendre d'un
  // côté, et à une ou deux cellules ça ne se voit pas ; le halo du trait en fait quatre, et
  // décentré il ferait un liseré d'un seul bord — le trait aurait l'air d'avoir une ombre.
  const demi = Math.floor((epaisseur - 1) / 2)
  let n = 0
  let j0 = 0
  let mCour = Math.round(min0)
  for (let j = 1; j <= N + 1; j++) {
    const m = j > N ? Number.NaN : Math.round(min0 + pente * j)
    if (j > N || m !== mCour) {
      const a = maj0 + sgn * j0
      const b = maj0 + sgn * (j - 1)
      const lo = Math.min(a, b)
      const len = Math.abs(b - a) + 1
      if (majX) poser(hors, depart + n, lo, mCour - demi, len, epaisseur)
      else poser(hors, depart + n, mCour - demi, lo, epaisseur, len)
      n++
      j0 = j
      mCour = m
    }
  }
  return n
}

function poser(hors: Run[], i: number, cx: number, cy: number, w: number, h: number): void {
  const r = hors[i]
  if (r) {
    r.cx = cx
    r.cy = cy
    r.w = w
    r.h = h
  } else hors[i] = { cx, cy, w, h }
}

/**
 * TOUTE LA TRACE EN RUNS, quantifiée sur la grille de 4 px. `parTuile` = TILE_PX / GRAIN_PX.
 * `epaisseurs` = [tronc, branche] en cellules. Rend le nombre de runs écrits dans `hors`.
 *
 * Le tronc et les branches sortent dans le MÊME tableau : la peinture les passe en un lot,
 * et l'appelant qui veut les distinguer relit `tracerEclair`.
 */
export function traceEnRuns(
  trace: Trace,
  parTuile: number,
  epaisseurs: readonly [number, number],
  hors: Run[],
): number {
  let n = 0
  const ligne = (pts: readonly Point[], ep: number): void => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      n += segmentEnRuns(
        Math.floor(a.x * parTuile), Math.floor(a.y * parTuile),
        Math.floor(b.x * parTuile), Math.floor(b.y * parTuile),
        ep, hors, n,
      )
    }
  }
  ligne(trace.tronc, epaisseurs[0]!)
  for (const br of trace.branches) ligne(br, epaisseurs[1]!)
  return n
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ② LE BATTEMENT
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Un cran de la salve : jusqu'à `finMs` après la frappe, le trait vaut `cran` d'opacité. */
export interface Battement {
  readonly finMs: number
  readonly cran: number
}

/**
 * LA SALVE — l'arc principal, deux creux, deux arcs de retour. Trois crans PLEINS, chacun de
 * l'ordre de deux à trois images à 60 Hz, séparés par des creux presque noirs : c'est le
 * stroboscope du vrai. Des CRANS, jamais un fondu (DA : l'opacité se postérise).
 */
export const BATTEMENTS: readonly Battement[] = [
  { finMs: 42, cran: 1 },
  { finMs: 68, cran: 0.2 },
  { finMs: 106, cran: 0.74 },
  { finMs: 130, cran: 0.12 },
  { finMs: 172, cran: 0.46 },
]

/** Ce que dure le TRAIT : la fin de la salve. Le ciel, lui, garde sa lueur plus longtemps. */
export const TRAIT_MS = BATTEMENTS[BATTEMENTS.length - 1]!.finMs

/**
 * OÙ EN EST LA SALVE à `ms` après la frappe. `index` = −1 quand c'est fini (`cran` 0).
 * L'index est LU PAR LE SMOKE : une capture doit pouvoir dire QUEL battement elle montre.
 */
export function battementA(ms: number): { index: number; cran: number } {
  if (ms < 0) return { index: -1, cran: 0 }
  for (let i = 0; i < BATTEMENTS.length; i++) {
    if (ms < BATTEMENTS[i]!.finMs) return { index: i, cran: BATTEMENTS[i]!.cran }
  }
  return { index: -1, cran: 0 }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ③ LA SECOUSSE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * L'INTENSITÉ MAXIMALE de la secousse, en fraction du cadre — l'unité de `camera.shake`.
 * Phaser déplace la caméra de `±intensité × camera.width × zoom` px d'écran : à 1280 de
 * large et zoom 2,25, **0,0022 vaut ±6,3 px**. C'est « un peu » : franc sous les pieds,
 * jamais un tremblement de terre. Le nombre se règle en REGARDANT, il vit donc ici et non
 * dans `balance.ts` (la ligne de partage de l'en-tête de `balance.ts`).
 */
export const SECOUSSE_MAX = 0.0022

/** En deçà de cette distance, la secousse est PLEINE : le coup est tombé sur vous. */
export const SECOUSSE_PLEIN_TUILES = 2

/**
 * Au-delà, RIEN — exactement 0. L'étalon est le CADRE, pas l'art : l'écran montre 20 tuiles
 * de haut et ~35,6 de large, donc une frappe à 30 tuiles est hors champ ou à sa lisière.
 * « Un coup à trente tuiles ne secoue pas l'écran ; à deux tuiles, si. »
 */
export const SECOUSSE_PORTEE_TUILES = 30

/** Ce que dure la secousse, en ms. Bref : c'est une percussion, pas un séisme. */
export const SECOUSSE_MS = 180

/**
 * LA RAMPE — géométrie continue sur TOUTE la plage, aux bornes exactes, jamais des paliers.
 * Pleine à `SECOUSSE_PLEIN_TUILES` et en deçà, exactement 0 à `SECOUSSE_PORTEE_TUILES` et
 * au-delà, linéaire entre les deux.
 */
export function secousseA(distTuiles: number): number {
  if (!(distTuiles >= 0)) return 0 // NaN compris
  if (distTuiles <= SECOUSSE_PLEIN_TUILES) return SECOUSSE_MAX
  if (distTuiles >= SECOUSSE_PORTEE_TUILES) return 0
  const u = (distTuiles - SECOUSSE_PLEIN_TUILES) / (SECOUSSE_PORTEE_TUILES - SECOUSSE_PLEIN_TUILES)
  return SECOUSSE_MAX * (1 - u)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ④ LA GERBE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * LES ÉCLATS D'UNE FRAPPE. Ce compte s'IMPUTE SUR `BUDGET_PARTICULES` (650) : `foudre-fx`
 * annonce ses vivants et `meteo-layer` retranche d'autant la cible du rideau. Une gerbe ne
 * s'empile donc pas à côté du budget de pluie, elle s'y range — au prix nommé d'un rideau
 * ~7 % plus clairsemé pendant les trois dixièmes de seconde de la frappe.
 */
export const BUDGET_GERBE = 48

/** Ce que vit un éclat, en ms. « Quelques dixièmes de seconde » — brève, pas une traînée. */
export const GERBE_MS = 300

/** La vitesse de projection, en tuiles/s [min, max]. À 9 tuiles/s pendant 0,3 s amorties,
 *  l'éclat le plus rapide couvre ~1,4 tuile : la gerbe reste dans le rayon de dégâts élargi,
 *  elle ne peint pas un cratère de dix tuiles. */
const GERBE_VITESSE = [3.2, 9.5] as const

/** La traînée qui les freine, en s⁻¹ (`dv/dt = −k·v`) — la loi du module de pluie. */
const GERBE_TRAINEE = 5.5

/** Les trois crans d'opacité par âge, du plus jeune au plus vieux — des CRANS, pas un fondu. */
export const GERBE_CRANS = [1, 0.62, 0.3] as const

/** Un éclat de la gerbe. Positions et vitesses en TUILES et tuiles/s. */
export interface Eclat {
  x: number
  y: number
  vx: number
  vy: number
  /** Âge en ms d'horloge de scène. */
  age: number
  vive: boolean
}

/** Le cran d'âge d'un éclat : 0 (jeune) · 1 · 2 (mourant). Trois, jamais une interpolation. */
export function cranDage(age: number): number {
  const u = age / GERBE_MS
  if (u < 1 / 3) return 0
  if (u < 2 / 3) return 1
  return 2
}

/**
 * LA GERBE — un pool d'éclats, sa projection radiale et son amortissement.
 *
 * Pur : ni Phaser, ni caméra, ni horloge murale. `foudre-fx` la frappe puis la peint.
 */
export class GerbeFoudre {
  readonly eclats: Eclat[] = []
  /** Vivants à l'instant — LU PAR `meteo-layer` (il retranche d'autant la cible du rideau). */
  vivants = 0
  /**
   * ÉCLOS DEPUIS TOUJOURS. Le compteur cumulatif, et pas seulement l'instantané : sous
   * swiftshader une image dure parfois une seconde, si bien qu'une gerbe de 300 ms peut
   * naître et mourir DANS le même intervalle — l'instantané relèverait 0 alors qu'elle a
   * bien eu lieu. Le patron des éclaboussures de pluie, pour la même raison.
   */
  total = 0
  private readonly rng: () => number

  constructor(graine = 0xf0d7_e51a) {
    this.rng = creerRng(graine)
    for (let i = 0; i < BUDGET_GERBE; i++) {
      this.eclats.push({ x: 0, y: 0, vx: 0, vy: 0, age: 0, vive: false })
    }
  }

  /**
   * FRAPPER en (x, y) tuiles : tout le pool part D'UN COUP, RADIALEMENT VERS LE DEHORS.
   *
   * L'angle suit un ÉVENTAIL RÉGULIER (i/N × 2π) plus une gigue bornée à un demi-pas : un
   * tirage libre laisserait des trous et des grumeaux sur 48 éclats, et une gerbe grumeleuse
   * lit « débris » au lieu de « souffle ». La vitesse, elle, est tirée pleinement — c'est
   * elle qui donne la couronne irrégulière.
   */
  frapper(x: number, y: number): void {
    const N = this.eclats.length
    const pas = (Math.PI * 2) / N
    for (let i = 0; i < N; i++) {
      const e = this.eclats[i]!
      const a = i * pas + (this.rng() - 0.5) * pas
      const v = GERBE_VITESSE[0] + this.rng() * (GERBE_VITESSE[1] - GERBE_VITESSE[0])
      e.x = x
      e.y = y
      e.vx = Math.cos(a) * v
      e.vy = Math.sin(a) * v
      e.age = 0
      e.vive = true
      this.total++
    }
    this.vivants = N
  }

  /** Une image. `dtMs` en ms d'horloge de SCÈNE — jamais un timer mural. */
  update(dtMs: number): void {
    const dt = dtMs / 1000
    let n = 0
    for (const e of this.eclats) {
      if (!e.vive) continue
      e.age += dtMs
      if (e.age >= GERBE_MS) {
        e.vive = false
        continue
      }
      // Traînée linéaire : l'éclat part vite et s'écrase — la même loi que la goutte, sans
      // la gravité (il rampe au sol, il ne tombe de nulle part).
      e.x += e.vx * dt
      e.y += e.vy * dt
      const f = Math.max(0, 1 - GERBE_TRAINEE * dt)
      e.vx *= f
      e.vy *= f
      n++
    }
    this.vivants = n
  }

  /** Tout meurt — le front est sorti, la scène change. */
  vider(): void {
    for (const e of this.eclats) e.vive = false
    this.vivants = 0
  }
}
