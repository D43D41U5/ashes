/**
 * LA CHUTE — la physique des gouttes et des flocons (demande d'Alexis, 2026-08-19).
 *
 * Le grain météo était un MOTIF de shader : un hash par cellule de 4 px, une grille qu'on
 * translatait. Ça tombait droit, tout à la même vitesse, sans masse et sans air. Ce module
 * le remplace par de VRAIES particules intégrées — et il est PUR (zéro Phaser) pour que la
 * loi se prouve headless : `meteo-layer` ne fait plus que la peindre.
 *
 * ═══ LA PHYSIQUE : TRAÎNÉE LINÉAIRE, DONC VITESSE LIMITE ═══
 *
 * Une goutte n'accélère pas indéfiniment — l'air la freine, et elle atteint sa vitesse
 * limite en une fraction de seconde. On intègre exactement ça :
 *
 *     dv/dt = g · (1 − v / vLimite)
 *
 * — la gravité poussant, la traînée retenant, l'équilibre à `vLimite`. Le coefficient de
 * traînée `k = g / vLimite` sert AUSSI l'axe horizontal (`dvx/dt = k · (vent − vx)`) :
 * c'est le même air. Une particule neuve entre donc à sa vitesse d'équilibre ou presque, et
 * une rafale la reprend avec la constante de temps `τ = vLimite / g`.
 *
 * C'est ce couple (g, vLimite) qui SÉPARE les ciels sans qu'on ait à le dire :
 *   • la goutte file à ~9 tuiles/s, quasi verticale — τ = 0,3 s ;
 *   • le flocon flâne à ~1,2 tuile/s — sept fois plus lent, l'œil le suit ;
 *   • le blizzard RASE : son vent latéral (11 tuiles/s) dépasse sa chute (2,1), la
 *     trajectoire est plus horizontale que verticale.
 *
 * ═══ LE FLOCON FLOTTE, ET C'EST SA SIGNATURE ═══
 *
 * Un flocon ne tombe pas : il descend en tanguant, parce que sa portance décroche
 * alternativement d'un côté puis de l'autre. Une oscillation latérale par particule, avec sa
 * PHASE PROPRE (sinon toute la neige tangue en chœur, et ça lit « rideau qui ondule »). Elle
 * s'ajoute à la vitesse, elle ne déplace pas la position en douce : le vent et le flottement
 * se composent, comme dans l'air.
 *
 * On est CÔTÉ CLIENT : `Math.sin` est autorisé ici. L'interdit des transcendantes ne vaut
 * que dans `/sim`, où deux moteurs JS doivent rendre le même bit.
 *
 * ═══ LA TRAÎNÉE EST PROPORTIONNELLE À LA VITESSE ═══
 *
 * Une goutte photographiée est un TRAIT, parce qu'elle a bougé pendant la pose. On dessine
 * donc `trainee` secondes de son mouvement : la longueur vaut `|v| × trainee`, dans le sens
 * exact de `v`. La goutte s'étire, le flocon (trainee = 0) reste un carré — c'est le même
 * nombre qui fait les deux, pas deux cas d'espèce.
 *
 * ═══ L'ÉMISSION SUIT LA BANDE, EN RAMPE CONTINUE ═══
 *
 * Une particule n'existe que là où le front a une intensité. Deux mécanismes, et il en faut
 * DEUX : le COMPTE cible suit l'intensité MOYENNE du cadre (sous la lisière, le rideau
 * s'éclaircit globalement), et chaque naissance est tirée par REJET contre l'intensité
 * locale (donc dense au cœur, épars au bord — le gradient spatial, pas seulement le total).
 * Une pente continue de bout en bout, jamais un interrupteur.
 *
 * ═══ L'INTENSITÉ SE RELIT INLINE, ET UN TEST LE PROUVE ═══
 *
 * `meteoIntensityAt` de `/sim` reste L'AUTORITÉ — mais elle recalcule la bande et alloue son
 * record à chaque appel, or on l'interroge une fois par particule et par image. On garde donc
 * la loi inline sur la bande DÉJÀ calculée (`intensiteDansBande`), et le test balaie tout
 * l'axe pour affirmer que les deux formes ne diffèrent jamais : l'écrivain reste unique, il
 * est seulement relu moins cher.
 */
import { METEO, meteoIntensityAt, type MeteoFront, type MeteoType } from '@ashes/sim'

/** Le grain de l'art pour tout ce qui tombe : 4 px monde, comme les FX de lumière. */
export const GRAIN_PX = 4

/**
 * LE PLAFOND DE PARTICULES VIVANTES — le seul garde-fou qui compte.
 *
 * Cette machine n'a PAS de GPU (swiftshader, rendu logiciel) : c'est la raison pour laquelle
 * la première recette évitait les sprites. Le budget est donc une CONSTANTE NOMMÉE qu'on
 * baisse en mesurant, jamais un « ça devrait aller ». Il vit ici et non dans `balance.ts` :
 * on le règle en REGARDANT (et en chronométrant), pas en jouant — la ligne de partage de
 * l'en-tête de `balance.ts`.
 *
 * IL A DÉJÀ ÉTÉ BAISSÉ UNE FOIS, ET POUR DEUX RAISONS (MESURÉ, `smoke --scenario meteocout`,
 * 2026-08-19) : à 900, la pluie coûtait **2,2 ms/image** sur le fil principal — le plafond
 * que la demande fixait — et surtout TROIS types sur quatre TAPAIENT LE PLAFOND à pleine
 * intensité. Or un rideau plafonné ne suit plus l'intensité : la rampe s'aplatit par le
 * haut, et c'est le budget qui peint, plus le front. Les densités ont donc été calées pour
 * que le compte visé à pleine intensité tombe SOUS le budget (~490 à 520 particules) : le
 * plafond redevient ce qu'il doit être — un filet, jamais le peintre.
 */
export const BUDGET_PARTICULES = 650

/** Les éclaboussures vivantes au même instant — un pool à part, minuscule. */
export const BUDGET_ECLABOUSSURES = 96
/** Ce que dure une éclaboussure, en ms d'horloge de scène : deux ou trois images, pas plus. */
export const ECLABOUSSURE_MS = 90

/** Le profil de chute d'un ciel. Tout ce qui distingue une goutte d'un flocon est ici. */
export interface ProfilChute {
  /** Vitesse limite de CHUTE, en tuiles/s — l'équilibre gravité ↔ traînée. */
  readonly vLimite: number
  /** Gravité, en tuiles/s². Avec `vLimite`, elle fixe la constante de temps τ = vLimite/g. */
  readonly g: number
  /** Le vent, en tuiles/s (positif = vers l'est). Le blizzard RASE : |vent| > vLimite. */
  readonly vent: number
  /** L'amplitude du flottement latéral, en tuiles/s. 0 = ça tombe droit (la pluie). */
  readonly flotte: number
  /** La pulsation du flottement, en rad/s. */
  readonly flottePuls: number
  /** Combien de SECONDES de mouvement la traînée montre. 0 = un carré (le flocon). */
  readonly trainee: number
  /**
   * LA GRILLE DE QUANTIFICATION DE CE CIEL, en px MONDE — et c'est ce qui sépare une goutte
   * d'un flocon plus sûrement que sa couleur.
   *
   * Le grain de l'art n'est pas UN nombre, c'est DEUX (demande d'Alexis, 2026-08-19) :
   *   • `GRAIN_PX` (4) — la grille des FX de LUMIÈRE, celle du Feu et de la foudre. Le flocon
   *     et le blizzard y restent : leur silhouette carrée est validée, on n'y touche pas.
   *   • **1 px monde** — la grille de l'ART LUI-MÊME, la plus fine qui existe (les tuiles sont
   *     peintes à 16 px). La goutte y descend : c'est ce qui fait la FINESSE. Ce reste du
   *     pixel art — bords francs, positions entières, NEAREST — simplement aligné sur une
   *     grille plus fine, PAS un dégradé lissé ni un trait vectoriel.
   *
   * CE QUE ÇA COÛTE, et il fallait le mesurer avant de le choisir : la traînée inclinée se
   * peint en ESCALIER, et un escalier sur une grille 4× plus fine a 4× plus de marches pour
   * la même pente. Le nombre de rectangles par goutte vaut `1 + longueur × |vent/vLimite|`,
   * en cellules — d'où la garde de `meteo-particules.test.ts`, qui le plafonne par profil.
   */
  readonly grainPx: number
  /** Le côté du grain en cellules de `grainPx`, par cran de profondeur [lointain, proche]. */
  readonly taille: readonly [number, number]
  /** La densité au cœur du front, en particules par tuile carrée VISIBLE. */
  readonly densite: number
  /** La teinte du grain, en canaux 0-255 (avant l'assombrissement de la nuit). */
  readonly teinte: readonly [number, number, number]
  /** L'opacité par cran [lointain, proche] — deux CRANS, jamais une rampe (patron brume). */
  readonly alpha: readonly [number, number]
  /** La goutte éclabousse en touchant le sol ; le flocon se pose sans bruit. */
  readonly eclabousse: boolean
  /**
   * L'OPACITÉ DE L'ÉCLABOUSSURE — la sienne, pas celle de la goutte. Une gerbe d'impact est
   * plus LARGE et plus DENSE que le trait qui l'a faite (c'est de l'eau projetée, pas de
   * l'eau qui tombe) : elle garde le grain de 4 px et son propre poids. Sans ça, l'affiner
   * avec la goutte l'aurait effacée — deux pixels de 1 px à alpha 0,12 ne se voient pas.
   */
  readonly alphaEclab: number
  /** La hauteur de chute tirée à la naissance, en tuiles [min, max] — voir `Particule.chute`. */
  readonly hauteur: readonly [number, number]
}

/**
 * LES CINQ CIELS, EN CHIFFRES DE CHUTE. Le brouillard n'a pas de grain : il ne tombe rien,
 * c'est son signalement (et c'était déjà vrai du shader). Nul ici = aucune particule.
 */
export const PROFILS: Record<MeteoType, ProfilChute | null> = {
  // ═══ LA PLUIE : FINE, NOMBREUSE, DISCRÈTE (demande d'Alexis, 2026-08-19) ═══
  //
  // Elle a d'abord été peinte en cellules de 4 px à alpha 0,5 : MESURÉ sur les pixels rendus
  // (planche `meteoplanche`, mediane des plages horizontales), la goutte faisait **9 px
  // d'écran de LARGE** pour 26 de long — soit un rapport 3:1 — et 7,1 % du cadre passait
  // AU-DESSUS de la luminance de l'herbe nue de midi. Ça ne lisait pas « pluie », ça lisait
  // « bâtonnet de craie ». Trois nombres ont changé, et un seul principe : c'est le NOMBRE
  // qui fait le rideau, jamais le poids d'une goutte.
  //
  //   • LARGEUR — 1 px MONDE (`grainPx: 1`), la grille de l'art elle-même : 2,3 px d'écran.
  //   • LONGUEUR — 0,16 s de mouvement, soit 1,45 tuile, 23 px monde, ~53 px d'écran : le
  //     rapport passe de 3:1 à **23:1**. Une pluie vue de haut est un trait long et ténu.
  //     (Le vieux garde-fou « 0,14 s lisait barre » était vrai À 4 px DE LARGE ; à 1 px, la
  //     longueur ne fait plus une barre, elle fait une aiguille.)
  //   • OPACITÉ — 0,11 / 0,22 au lieu de 0,26 / 0,50 : une goutte isolée est à la limite du
  //     visible, et c'est voulu.
  //   • NOMBRE — densité 0,62 → 0,69, soit ~610 gouttes contre 550, DANS le budget partagé.
  //     0,74 a été essayé et REJETÉ sur mesure : il visait 656 pour un plafond de 650, donc
  //     la pluie sortait PLAFONNÉE — et un rideau plafonné ne suit plus l'intensité du front,
  //     c'est le budget qui peint (le piège nommé sous `BUDGET_PARTICULES`).
  pluie: {
    vLimite: 9, g: 30, vent: 0.8, flotte: 0, flottePuls: 0,
    trainee: 0.16, grainPx: 1, taille: [1, 1], densite: 0.69,
    teinte: [178, 199, 235], alpha: [0.11, 0.22], eclabousse: true, alphaEclab: 0.34,
    hauteur: [5, 20],
  },
  brouillard: null,
  // LA NEIGE : sept fois plus lente que la pluie, et ELLE FLOTTE — l'oscillation latérale
  // vaut les deux tiers de sa vitesse de chute : le flocon dérive visiblement en descendant.
  // (INCHANGÉE — sa silhouette carrée est validée : elle garde le grain de 4 px des FX.)
  neige: {
    vLimite: 1.2, g: 6, vent: 0.35, flotte: 0.8, flottePuls: 1.7,
    trainee: 0, grainPx: GRAIN_PX, taille: [1, 2], densite: 0.55,
    teinte: [250, 252, 255], alpha: [0.42, 0.82], eclabousse: false, alphaEclab: 0,
    hauteur: [8, 26],
  },
  // L'ORAGE : la pluie en plus rapide et PENCHÉE — le vent monte à trois tuiles/s, la
  // trajectoire s'incline de ~17°, et ça se voit d'un coup d'œil contre la pluie droite.
  //
  // IL S'AFFINE AVEC LA PLUIE — c'est la MÊME eau, et laisser le ciel le plus violent peint
  // en bâtonnets plus gros que l'averse ordinaire aurait été une incohérence de DA. Mais IL
  // PAIE SA PENTE, et c'est un nombre : la traînée s'escalade sur 1 px, or sa pente vaut
  // 0,305 contre 0,089 pour la pluie — trois fois plus de marches par unité de longueur.
  // D'où une traînée plus courte (0,11 s ≈ 19 px monde) et une densité tenue à 0,60 : ce sont
  // les deux boutons qui gardent le compte de rectangles sous contrôle. Le chiffre exact est
  // au journal de `meteo-layer` (MESURÉ, `smoke --scenario meteocout`).
  orage: {
    vLimite: 10.5, g: 34, vent: 3.2, flotte: 0, flottePuls: 0,
    trainee: 0.11, grainPx: 1, taille: [1, 1], densite: 0.60,
    teinte: [170, 192, 232], alpha: [0.13, 0.26], eclabousse: true, alphaEclab: 0.38,
    hauteur: [5, 18],
  },
  // LE BLIZZARD RASE : son vent (11) dépasse sa chute (2,1) — la trajectoire est PLUS
  // HORIZONTALE QUE VERTICALE, et c'est ça qu'on lit, pas la couleur. Traînée courte
  // (0,06 s ≈ 3 cellules) : un flocon chassé reste un flocon, il ne devient pas une barre —
  // la leçon MESURÉE du shader, où LX = 7 peignait des rubans de 120 px.
  // (INCHANGÉ — même raison que la neige : le flocon chassé reste un carré de 4 px.)
  blizzard: {
    vLimite: 2.1, g: 9, vent: 11, flotte: 0.5, flottePuls: 2.4,
    trainee: 0.06, grainPx: GRAIN_PX, taille: [1, 2], densite: 0.66,
    teinte: [252, 253, 255], alpha: [0.44, 0.86], eclabousse: false, alphaEclab: 0,
    hauteur: [10, 30],
  },
  // ═══ LE VENT DE CENDRE : ÇA NE TOMBE PAS, ÇA PASSE ═══
  //
  // C'est le seul des six qui ne soit pas une précipitation : rien ne tombe du ciel, c'est le
  // sol du sud qui s'envole. Trois nombres portent tout le signalement, et aucun n'est une
  // couleur :
  //
  //   • LE VENT (9) ÉCRASE LA CHUTE (1,4) — trajectoire quasi HORIZONTALE, plus encore que
  //     le blizzard (11 contre 2,1). On lit une matière CHASSÉE, pas une matière qui descend.
  //   • LA FLOTTE (1,1) EST LA PLUS HAUTE DE LA TABLE — une escarbille ne file pas droit,
  //     elle tourbillonne. C'est ce qui la sépare du flocon de blizzard, à silhouette égale.
  //   • PAS D'ÉCLABOUSSURE — c'est sec. Une particule de cendre qui ferait une gerbe en
  //     touchant le sol raconterait de l'eau, et `MOUILLE.vent_de_cendre` est faux : les
  //     deux tables doivent dire la même chose (le feu consomme PLUS sous ce vent, 1,8).
  //
  // Grain de 4 px (`GRAIN_PX`), comme la neige et le blizzard : les FX de ce jeu sont
  // quantifiés sur la grille de l'art, jamais lissés. Densité tenue à 0,58 — sous la neige,
  // parce que la traînée (0,09 s) coûte des rectangles et que le budget est PARTAGÉ.
  vent_de_cendre: {
    vLimite: 1.4, g: 7, vent: 9, flotte: 1.1, flottePuls: 2.9,
    trainee: 0.09, grainPx: GRAIN_PX, taille: [1, 2], densite: 0.58,
    teinte: [166, 148, 132], alpha: [0.30, 0.62], eclabousse: false, alphaEclab: 0,
    hauteur: [6, 24],
  },
}

/** La bande dessinée ce frame, en tuiles — telle que `frontMeteoPos` la rend. */
export interface Bande {
  readonly axis: 'x' | 'y'
  readonly lo: number
  readonly hi: number
}

/** Le cadre visible, en TUILES monde, déjà élargi de sa marge. */
export interface Vue {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/**
 * L'INTENSITÉ DU FRONT en (x, y), lue sur une bande DÉJÀ calculée — la loi de
 * `meteoIntensityAt` au mot près, sans recalculer la bande ni allouer son record.
 * Le test `meteo-particules.test.ts` balaie l'axe entier pour l'affirmer.
 */
export function intensiteDansBande(bande: Bande, rampe: number, x: number, y: number): number {
  const c = bande.axis === 'x' ? x : y
  const d = Math.min(c - bande.lo, bande.hi - c)
  if (d <= 0) return 0
  return rampe <= 0 ? 1 : Math.min(1, d / rampe)
}

/** La rampe du type, en tuiles — `RAMPE × LARGEUR`, la même que la sim et le shader. */
export function rampeDe(type: MeteoType): number {
  return METEO.RAMPE * METEO.LARGEUR[type]
}

/** Une particule. Positions et vitesses en TUILES et tuiles/s — jamais en pixels : le pixel
 *  n'apparaît qu'à la quantification, au moment de peindre. */
export interface Particule {
  x: number
  y: number
  vx: number
  vy: number
  /** La phase propre du flottement — c'est elle qui empêche la neige de tanguer en chœur. */
  phase: number
  /** 0 = lointain (pâle, fin) · 1 = proche (franc, gros). Deux crans, jamais une rampe. */
  cran: 0 | 1
  /** Ce qu'il reste à tomber avant de toucher, en tuiles. À zéro : éclaboussure et renaissance.
   *  C'est une FICTION DE PROFONDEUR assumée — la vue est du dessus, il n'y a pas d'altitude :
   *  sans elle, toutes les gouttes toucheraient sur le bord bas du cadre, en une rangée. */
  chute: number
  vive: boolean
}

/** Une éclaboussure : deux pixels, deux ou trois images. */
export interface Eclaboussure {
  x: number
  y: number
  /** Âge en ms d'horloge de scène. */
  age: number
  vive: boolean
}

/** Un segment de traînée à peindre, en CELLULES de 4 px monde (bords francs, jamais lissés). */
export interface Run {
  /** Coin haut-gauche, en cellules. */
  cx: number
  cy: number
  /** Étendue, en cellules. */
  w: number
  h: number
}

/** Le PRNG local au client — mulberry32. JAMAIS `rng.ts` de la sim : le rendu ne touche à
 *  aucun déterminisme, et un tirage de plus décalerait tout le flux seedé. */
export function creerRng(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * LA TRAÎNÉE, DÉCOUPÉE EN RUNS ALIGNÉS SUR LA GRILLE DE 4 px.
 *
 * Un trait incliné ne se peint PAS par un rectangle tourné : ça donnerait des bords lissés,
 * hors DA. On marche donc en ESCALIER le long de l'axe dominant de la vitesse — une cellule
 * par pas, la coordonnée mineure arrondie — et on fusionne les pas qui partagent la même
 * mineure en un seul rectangle. Résultat : des carrés durs, et 1 à 3 rectangles par goutte
 * au lieu de `L`, ce qui divise d'autant le travail du rasteriseur logiciel.
 *
 * `hors` reçoit les runs (tableau réutilisé, remis à zéro par l'appelant) ; rend le nombre
 * de runs écrits.
 */
export function traineeEnRuns(
  cxTete: number,
  cyTete: number,
  vx: number,
  vy: number,
  longueur: number,
  epaisseur: number,
  hors: Run[],
  depart: number,
): number {
  const L = Math.max(1, Math.round(longueur))
  if (L === 1 || (vx === 0 && vy === 0)) {
    poser(hors, depart, cxTete, cyTete, epaisseur, epaisseur)
    return 1
  }
  const yDominant = Math.abs(vy) >= Math.abs(vx)
  const majTete = yDominant ? cyTete : cxTete
  const minTete = yDominant ? cxTete : cyTete
  const vMaj = yDominant ? vy : vx
  const vMin = yDominant ? vx : vy
  const sgn = vMaj >= 0 ? 1 : -1
  const pente = vMin / Math.abs(vMaj) // |pente| <= 1 par construction
  let n = 0
  let j0 = 0
  let min0 = minTete
  for (let j = 1; j <= L; j++) {
    const minJ = j === L ? Number.NaN : Math.round(minTete - pente * j)
    if (j === L || minJ !== min0) {
      // Le run couvre les pas j0..j-1 : la majeure descend de `majTete − sgn·j0` à
      // `majTete − sgn·(j−1)`, bornes comprises.
      const a = majTete - sgn * j0
      const b = majTete - sgn * (j - 1)
      const lo = Math.min(a, b)
      const len = Math.abs(b - a) + 1
      if (yDominant) poser(hors, depart + n, min0, lo, epaisseur, len)
      else poser(hors, depart + n, lo, min0, len, epaisseur)
      n++
      j0 = j
      min0 = minJ
    }
  }
  return n
}

function poser(hors: Run[], i: number, cx: number, cy: number, w: number, h: number): void {
  const r = hors[i]
  if (r) { r.cx = cx; r.cy = cy; r.w = w; r.h = h } else hors[i] = { cx, cy, w, h }
}

/**
 * LE CHAMP — le troupeau de particules vivantes, son intégration et son recyclage.
 *
 * Pur : il ne connaît ni Phaser ni la caméra, seulement un cadre en tuiles et une bande.
 * `meteo-layer` l'avance puis le peint.
 */
export class ChampParticules {
  readonly particules: Particule[] = []
  readonly eclaboussures: Eclaboussure[] = []
  /** Combien de particules sont vivantes — LU PAR LE SMOKE. */
  vivantes = 0
  /** Le compte visé ce frame (budget × intensité moyenne du cadre) — LU PAR LE SMOKE. */
  cible = 0
  /** Éclaboussures vivantes — LU PAR LE SMOKE (une gerbe de 2 images ne se photographie pas). */
  eclabsVivantes = 0
  /**
   * ÉCLABOUSSURES ÉCLOSES DEPUIS TOUJOURS — le compteur qui, lui, prouve qu'elles existent.
   *
   * MESURÉ : sous swiftshader la boucle tourne à quelques images par seconde, si bien qu'une
   * gerbe de 90 ms naît et meurt DANS LE MÊME INTERVALLE — `eclabsVivantes` relève 0 alors
   * que des centaines sont tombées. Un compteur cumulatif ne ment pas là où l'instantané ne
   * voit rien : c'est le patron « une gerbe ne se photographie pas, elle se compte ».
   */
  eclabsTotal = 0
  private readonly rng: () => number
  private t = 0

  constructor(graine = 0x5eed_bea7) {
    this.rng = creerRng(graine)
    for (let i = 0; i < BUDGET_PARTICULES; i++) {
      this.particules.push({ x: 0, y: 0, vx: 0, vy: 0, phase: 0, cran: 0, chute: 0, vive: false })
    }
    for (let i = 0; i < BUDGET_ECLABOUSSURES; i++) {
      this.eclaboussures.push({ x: 0, y: 0, age: 0, vive: false })
    }
  }

  /** Tout meurt — le front est sorti, ou le type n'a pas de grain (brouillard). */
  vider(): void {
    for (const p of this.particules) p.vive = false
    for (const e of this.eclaboussures) e.vive = false
    this.vivantes = 0
    this.eclabsVivantes = 0
    this.cible = 0
  }

  /**
   * UNE IMAGE. `dt` en secondes (borné par l'appelant), `dtMs` pour l'âge des éclaboussures.
   * `vue` est le cadre visible en tuiles, `bande` et `rampe` disent où il pleut.
   */
  update(
    dt: number, dtMs: number, profil: ProfilChute, vue: Vue, bande: Bande, rampe: number,
    /** Ce que d'AUTRES particules occupent déjà du budget partagé (la gerbe de la foudre) :
     *  le plafond du rideau descend d'autant. Les 650 sont un budget de MACHINE — il se
     *  partage, il ne s'empile pas par système. */
    reservees = 0,
  ): void {
    this.t += dt
    const k = profil.g / profil.vLimite // le coefficient de traînée — le même air pour les deux axes

    // ── LE COMPTE CIBLE SUIT L'INTENSITÉ MOYENNE DU CADRE (rampe continue, pas d'interrupteur).
    //    Échantillonnée sur une grille grossière : 48 lectures d'une formule à trois opérations,
    //    contre 900 si on la relisait par particule pour le même chiffre. ──
    let somme = 0
    const NX = 8
    const NY = 6
    for (let j = 0; j < NY; j++) {
      const y = vue.y0 + ((j + 0.5) / NY) * (vue.y1 - vue.y0)
      for (let i = 0; i < NX; i++) {
        const x = vue.x0 + ((i + 0.5) / NX) * (vue.x1 - vue.x0)
        somme += intensiteDansBande(bande, rampe, x, y)
      }
    }
    const moyenne = somme / (NX * NY)
    const aire = Math.max(1, (vue.x1 - vue.x0) * (vue.y1 - vue.y0))
    const plafond = Math.max(0, BUDGET_PARTICULES - reservees)
    this.cible = Math.min(plafond, Math.round(profil.densite * aire * moyenne))

    // ── L'INTÉGRATION ──
    let vivantes = 0
    for (const p of this.particules) {
      if (!p.vive) continue
      // dv/dt = g·(1 − v/vLimite) : la gravité pousse, la traînée retient, l'équilibre est
      // à vLimite. Le même k emporte l'axe horizontal vers le vent — c'est le même air.
      p.vy += (profil.g - k * p.vy) * dt
      p.vx += k * (profil.vent - p.vx) * dt
      // LE FLOTTEMENT : une vitesse latérale de plus, avec la PHASE PROPRE de la particule.
      const osc = profil.flotte === 0 ? 0 : profil.flotte * Math.sin(profil.flottePuls * this.t + p.phase)
      p.x += (p.vx + osc) * dt
      p.y += p.vy * dt
      p.chute -= p.vy * dt
      // Touché : la goutte éclabousse, puis renaît. Le flocon se pose sans bruit.
      if (p.chute <= 0) {
        if (profil.eclabousse) this.eclabousser(p.x, p.y)
        this.naitre(p, profil, vue, bande, rampe, false)
        vivantes++
        continue
      }
      // Sorti du cadre, ou sorti de la bande : on recycle sur le bord d'AMONT.
      if (p.x < vue.x0 || p.x > vue.x1 || p.y < vue.y0 || p.y > vue.y1
        || intensiteDansBande(bande, rampe, p.x, p.y) <= 0) {
        this.naitre(p, profil, vue, bande, rampe, true)
      }
      vivantes++
    }

    // ── LA POPULATION REJOINT SA CIBLE : on naît ou on meurt, quelques-unes par image, pour
    //    que la lisière s'éclaircisse en fondu et non par à-coups. ──
    if (vivantes < this.cible) {
      // Quand le rideau n'est pas encore établi (moitié du compte manquante : le front vient
      // d'entrer, ou on vient de se téléporter dedans), on sème DANS TOUT LE CADRE d'un coup —
      // sinon une averse commence par une ligne au plafond qui descend pendant deux secondes.
      // Une fois établi, elle ne renaît que par un bord et par petites bouffées : la lisière
      // s'éclaircit en fondu, jamais par à-coups.
      const etabli = vivantes * 2 >= this.cible
      const quota = etabli ? Math.max(4, Math.ceil(this.cible * 0.12)) : this.cible - vivantes
      let nes = 0
      let essais = 0
      for (const p of this.particules) {
        if (nes >= quota || essais > quota * 4 + 16) break
        if (p.vive) continue
        essais++
        this.naitre(p, profil, vue, bande, rampe, etabli)
        if (!p.vive) continue
        nes++
        vivantes++
      }
    } else if (vivantes > this.cible) {
      let aTuer = vivantes - this.cible
      for (const p of this.particules) {
        if (aTuer <= 0) break
        if (!p.vive) continue
        p.vive = false
        vivantes--
        aTuer--
      }
    }
    this.vivantes = vivantes

    // ── LES ÉCLABOUSSURES : sur l'horloge de la SCÈNE, jamais un timer mural. ──
    let ne = 0
    for (const e of this.eclaboussures) {
      if (!e.vive) continue
      e.age += dtMs
      if (e.age >= ECLABOUSSURE_MS) e.vive = false
      else ne++
    }
    this.eclabsVivantes = ne
  }

  private eclabousser(x: number, y: number): void {
    for (const e of this.eclaboussures) {
      if (e.vive) continue
      e.x = x
      e.y = y
      e.age = 0
      e.vive = true
      this.eclabsTotal++
      return
    }
  }

  /**
   * NAÎTRE — par REJET contre l'intensité locale : la densité SPATIALE suit la rampe du
   * front (dense au cœur, éparse au bord), et pas seulement le total. Six essais, puis on
   * renonce pour cette image : mieux vaut une particule de moins qu'une boucle qui rame
   * quand le cadre n'a presque pas de bande.
   */
  private naitre(p: Particule, profil: ProfilChute, vue: Vue, bande: Bande, rampe: number, parLeBord: boolean): void {
    const w = vue.x1 - vue.x0
    const h = vue.y1 - vue.y0
    // Par quel bord ? PAR LE FLUX : la proportion qui entre par le haut vaut le débit
    // vertical (vLimite × largeur) contre le débit latéral (|vent| × hauteur). Le blizzard
    // entre donc surtout par l'ouest, la pluie par le haut — sans qu'on ait à le dire.
    const fluxHaut = profil.vLimite * w
    const fluxCote = Math.abs(profil.vent) * h
    for (let essai = 0; essai < 6; essai++) {
      let x: number
      let y: number
      if (!parLeBord) {
        x = vue.x0 + this.rng() * w
        y = vue.y0 + this.rng() * h
      } else if (this.rng() * (fluxHaut + fluxCote) < fluxHaut) {
        x = vue.x0 + this.rng() * w
        y = vue.y0
      } else {
        x = profil.vent >= 0 ? vue.x0 : vue.x1
        y = vue.y0 + this.rng() * h
      }
      const I = intensiteDansBande(bande, rampe, x, y)
      if (I <= 0 || this.rng() > I) continue
      p.x = x
      p.y = y
      // Elle entre à sa vitesse d'équilibre (à un cheveu près) : une particule qui
      // démarrerait à zéro traverserait le haut du cadre en accélérant, et l'œil verrait
      // le plafond « pleuvoir plus lentement » que le sol.
      p.vy = profil.vLimite * (0.82 + 0.18 * this.rng())
      p.vx = profil.vent * (0.85 + 0.3 * this.rng())
      p.phase = this.rng() * Math.PI * 2
      p.cran = this.rng() < 0.42 ? 1 : 0
      p.chute = profil.hauteur[0] + this.rng() * (profil.hauteur[1] - profil.hauteur[0])
      p.vive = true
      return
    }
    p.vive = false
  }
}

/**
 * L'AUTORITÉ, pour la sonde du joueur et pour le test : la fonction de `/sim`, telle quelle.
 * Réexportée ici pour que le module qui relit la loi inline nomme aussi celui qui l'écrit.
 */
export { meteoIntensityAt }
export type { MeteoFront }
