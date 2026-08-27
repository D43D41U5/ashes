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
 * ═══ RIEN NE SE PEINT AU SOL — L'ÉCLABOUSSURE EST RETIRÉE (demande d'Alexis, 2026-08-23) ═══
 *
 * Une goutte a longtemps rendu, en touchant, deux pixels de 4 px à alpha 0,34 (0,38 sous
 * l'orage) : sa GERBE. C'était un CHOIX assumé — « une gerbe d'impact est de l'eau projetée,
 * plus large et plus dense que le trait qui l'a faite » — et c'est précisément ce choix qui
 * l'a rendue TROP PRONONCÉE une fois la goutte descendue à 1 px monde et à alpha 0,11/0,22 :
 * l'impact pesait trois fois la goutte et quatre fois sa surface, si bien que le sol pétillait
 * plus que le ciel ne pleuvait. Le mécanisme est SUPPRIMÉ, pas mis à zéro — pool, âge,
 * compteurs et champs de profil compris. La hauteur de chute (`Particule.chute`) RESTE : elle
 * n'existait pas pour la gerbe mais pour la dispersion (sans elle, tout toucherait sur le bord
 * bas du cadre, en une rangée) ; une goutte qui a touché renaît simplement en silence.
 *
 * ═══ DEUX TROUPEAUX QUAND LE CIEL GRÉSILLE (R14, 2026-08-24) ═══
 *
 * Le champ ne mène plus UN ciel mais DEUX — l'aspect doux du front et son aspect froid —,
 * chacun avec sa cible, sa densité de table et sa physique, et chacun semé par rejet contre
 * SA part du champ de neige. Une particule est une goutte OU un flocon, jamais un entre-deux :
 * `grainPx` est une grille de quantification (1 px pour la goutte, 4 pour le flocon), pas un
 * nombre qu'on interpole. Ce qui se mélange, c'est le troupeau.
 *
 * Le détail — et la mesure qui a écarté la version naïve — est sous les deux cibles, dans
 * `update`. Sans aspect froid (`melangeUniforme`), tout ce dispositif est INERTE : aucun
 * tirage de plus, le flux d'aléa d'avant R14 au bit près, et les gardes de ce fichier avec lui.
 *
 * ═══ L'INTENSITÉ SE RELIT INLINE, ET UN TEST LE PROUVE ═══
 *
 * `meteoIntensityAt` de `/sim` reste L'AUTORITÉ — mais elle recalcule la bande et alloue son
 * record à chaque appel, or on l'interroge une fois par particule et par image. On garde donc
 * la loi inline sur la bande DÉJÀ calculée (`intensiteDansBande`), et le test balaie tout
 * l'axe pour affirmer que les deux formes ne diffèrent jamais : l'écrivain reste unique, il
 * est seulement relu moins cher.
 */
import { METEO, largeurDe, meteoIntensityAt, type MeteoAspect, type MeteoFront } from '@ashes/sim'

/** Le grain de l'art pour tout ce qui tombe : 4 px monde, comme les FX de lumière. */
export const GRAIN_PX = 4

/**
 * ═══ LE FLOCON DE MOITIÉ (« diviser la taille des flocons de neige par 2 pour toutes les
 * tailles déjà existantes », Alexis 2026-08-26) ═══
 *
 * La taille d'un flocon, c'est `taille × grainPx` — et `taille` était `[1, 2]` cellules de
 * `GRAIN_PX`, soit **4 px monde au loin et 8 de près**. On divise donc **le GRAIN**, pas la
 * taille, et c'est le seul des deux qui marche :
 *
 *   • `taille: [0.5, 1]` sortirait de la grille — `traineeEnRuns` compte en CELLULES entières
 *     et `fillRect` recevrait des demi-cellules. Une demi-cellule n'est pas un pixel d'art.
 *   • `grainPx: 2` divise les DEUX tailles par deux d'un seul coup (2 px au loin, 4 de près)
 *     en gardant `taille: [1, 2]` entier — et 2 divise encore 4 comme 16 (`TILE_PX`), donc la
 *     quantification reste alignée sur la grille de l'art : le flocon se pose seulement sur
 *     une grille deux fois plus fine, il n'est pas lissé pour autant.
 *
 * ⚠ **LA TRAÎNÉE, ELLE, NE RÉTRÉCIT PAS** : `trainee` est un nombre de SECONDES de mouvement,
 * converti en cellules à l'usage — MESURÉ, le blizzard passe de 3 cellules de 4 px (12 px
 * monde) à 5 de 2 px (10 px), l'écart n'étant que l'arrondi à la cellule. C'est ce qu'on
 * veut : le flocon MAIGRIT, il ne raccourcit pas sa course. Seule son épaisseur est divisée
 * par deux. Ce que ça COÛTE, mesuré aussi : le blizzard rend **2 rectangles par flocon au
 * lieu d'1** (l'escalier a deux fois plus de marches sur une grille deux fois plus fine) —
 * la neige et le vent de cendre en restent à 1, et le plafond du profil (`PLAFOND` dans
 * `meteo-particules.test.ts`) tient.
 *
 * ⚠ **LE VENT DE CENDRE GARDE `GRAIN_PX`** : ce ne sont pas des flocons, ce sont des
 * escarbilles — la demande dit « les flocons de neige ». C'est aussi ce qui les SÉPARE
 * désormais à silhouette égale : le grain de cendre est deux fois plus gros que le flocon.
 */
export const GRAIN_FLOCON = GRAIN_PX / 2

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
   *   • `GRAIN_PX` (4) — la grille des FX de LUMIÈRE, celle du Feu et de la foudre. Le vent de
   *     cendre y reste. Le flocon et le blizzard sont descendus à `GRAIN_FLOCON` (2) le
   *     2026-08-26 : même silhouette carrée, deux fois plus petite (voir `GRAIN_FLOCON`).
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
  /** La hauteur de chute tirée à la naissance, en tuiles [min, max] — voir `Particule.chute`. */
  readonly hauteur: readonly [number, number]
}

/**
 * LES CINQ CIELS, EN CHIFFRES DE CHUTE. Le brouillard n'a pas de grain : il ne tombe rien,
 * c'est son signalement (et c'était déjà vrai du shader). Nul ici = aucune particule.
 */
// DEPUIS LE 2026-08-22 (spec meteo.md R11) la clé est l'ASPECT, pas le type élu : `neige` et
// `blizzard` ne s'élisent plus, ils se DÉRIVENT au point du froid du monde (`aspectAuPoint`).
// Un même front de pluie est un rideau de gouttes en plaine et de flocons sur le Névé — et
// c'est la couche qui choisit le profil, à l'œil du joueur, une fois par image.
export const PROFILS: Record<MeteoAspect, ProfilChute | null> = {
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
    teinte: [178, 199, 235], alpha: [0.11, 0.22],
    hauteur: [5, 20],
  },
  brouillard: null,
  // LA NEIGE : sept fois plus lente que la pluie, et ELLE FLOTTE — l'oscillation latérale
  // vaut les deux tiers de sa vitesse de chute : le flocon dérive visiblement en descendant.
  // SA SILHOUETTE RESTE CARRÉE, elle est seulement DEUX FOIS PLUS PETITE (Alexis 2026-08-26,
  // voir `GRAIN_FLOCON`) : 2 px monde au loin, 4 de près, au lieu de 4 et 8.
  neige: {
    vLimite: 1.2, g: 6, vent: 0.35, flotte: 0.8, flottePuls: 1.7,
    trainee: 0, grainPx: GRAIN_FLOCON, taille: [1, 2], densite: 0.55,
    teinte: [250, 252, 255], alpha: [0.42, 0.82],
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
    teinte: [170, 192, 232], alpha: [0.13, 0.26],
    hauteur: [5, 18],
  },
  // LE BLIZZARD RASE : son vent (11) dépasse sa chute (2,1) — la trajectoire est PLUS
  // HORIZONTALE QUE VERTICALE, et c'est ça qu'on lit, pas la couleur. Traînée courte
  // (0,06 s ≈ 5 cellules de 2 px, soit ~12 px monde — la MÊME longueur qu'avant, comptée sur
  // une grille deux fois plus fine) : un flocon chassé reste un flocon, il ne devient pas une
  // barre — la leçon MESURÉE du shader, où LX = 7 peignait des rubans de 120 px.
  // Comme la neige, il MAIGRIT de moitié (Alexis 2026-08-26, voir `GRAIN_FLOCON`) : sa course
  // ne change pas, son épaisseur passe de 4/8 px monde à 2/4.
  blizzard: {
    vLimite: 2.1, g: 9, vent: 11, flotte: 0.5, flottePuls: 2.4,
    trainee: 0.06, grainPx: GRAIN_FLOCON, taille: [1, 2], densite: 0.66,
    teinte: [252, 253, 255], alpha: [0.44, 0.86],
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
  //
  // Grain de 4 px (`GRAIN_PX`), comme la neige et le blizzard : les FX de ce jeu sont
  // quantifiés sur la grille de l'art, jamais lissés. Densité tenue à 0,58 — sous la neige,
  // parce que la traînée (0,09 s) coûte des rectangles et que le budget est PARTAGÉ.
  vent_de_cendre: {
    vLimite: 1.4, g: 7, vent: 9, flotte: 1.1, flottePuls: 2.9,
    trainee: 0.09, grainPx: GRAIN_PX, taille: [1, 2], densite: 0.58,
    teinte: [166, 148, 132], alpha: [0.30, 0.62],
    hauteur: [6, 24],
  },
}

/**
 * ═══ LE CIEL EST UN MÉLANGE, PAS UN ASPECT (R14, décision d'Alexis 2026-08-24) ═══
 *
 * Ce qui tombe ici n'est pas UN des six ciels : c'est une PROPORTION de deux d'entre eux —
 * l'aspect DOUX du front (`pluie`, `orage`) et son aspect FROID (`neige`, `blizzard`) —, et
 * cette proportion VARIE D'UN POINT À L'AUTRE (`partDeNeige` sur le froid du monde).
 *
 * ═══ ON MÉLANGE DES POPULATIONS, PAS DES NOMBRES ═══
 *
 * Interpoler les champs de deux `ProfilChute` ne veut RIEN dire : `grainPx` vaut 1 pour la
 * goutte et 4 pour le flocon, et c'est une GRILLE DE QUANTIFICATION — la moitié du chemin
 * entre les deux est un grain de 2,5 px qui n'existe dans aucune DA. Ce qui se mélange, c'est
 * le TROUPEAU : chaque particule est une goutte OU un flocon, tirée à sa NAISSANCE contre la
 * part de froid AU POINT OÙ ELLE NAÎT.
 *
 * Trois propriétés tombent de là, et aucune n'a demandé de machinerie :
 *   • LA TRANSITION SE VOIT DANS L'ESPACE — au-dessus du marais il tombe des flocons, au-dessus
 *     du pré des gouttes, dans la MÊME image. C'était le défaut signalé : six pas suffisaient
 *     à retourner tout le ciel, parce que l'aspect se lisait en UN point et se peignait plein
 *     cadre.
 *   • ELLE SE VOIT DANS LE TEMPS, GRATUITEMENT — une particule garde sa nature jusqu'à son
 *     recyclage (une à deux secondes) : marcher fait GLISSER le mélange, il ne commute pas.
 *     Et c'est physiquement juste : un flocon ne devient pas une goutte en trois tuiles.
 *   • CHAQUE POPULATION GARDE SA PHYSIQUE — le flocon flâne à 1,2 tuile/s pendant que la
 *     goutte file à 9, côte à côte. C'est ÇA, du grésil.
 */
export interface Melange {
  /** L'aspect FROID du front (`neige` ou `blizzard`) — `null` pour un ciel qui ne peut pas
   *  neiger (le vent de cendre), auquel cas rien n'est tiré et le flux d'aléa ne bouge pas. */
  readonly froid: ProfilChute | null
  /** Son aspect DOUX (`pluie`, `orage`, `vent_de_cendre`) — `null` = aucun grain (brouillard). */
  readonly doux: ProfilChute | null
  /** La part de FROID en (x, y), dans [0, 1]. L'appelant l'a déjà LISSÉE dans l'espace : `T₀`
   *  saute par marches d'une tuile (le biome), et une marche crue redessinerait la grille. */
  part(x: number, y: number): number
}

/** UN CIEL D'UN SEUL TENANT — pour les ciels qui ne peuvent pas neiger et pour les montages.
 *  `part` vaut 0 partout : aucun tirage de plus, le flux d'aléa est celui d'avant R14. */
export function melangeUniforme(profil: ProfilChute | null): Melange {
  return { froid: null, doux: profil, part: () => 0 }
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

/** La rampe du front, en tuiles — `RAMPE × largeurDe(front)`, la même que la sim et le
 *  shader (R13 : la largeur d'un orage suit le froid de la saison — on lit la fonction de
 *  la sim, jamais la table). */
export function rampeDe(front: Pick<MeteoFront, 'type' | 'day'>): number {
  return METEO.RAMPE * largeurDe(front)
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
  /** SA NATURE, tirée à la naissance contre la part de froid au point où elle est née (R14) :
   *  vrai = flocon (l'aspect froid du front), faux = goutte. Elle la GARDE jusqu'à son
   *  recyclage — c'est ce qui fait le fondu quand le mélange change sous les pieds. */
  froid: boolean
  /** Ce qu'il reste à tomber avant de toucher, en tuiles. À zéro : renaissance, en silence.
   *  C'est une FICTION DE PROFONDEUR assumée — la vue est du dessus, il n'y a pas d'altitude :
   *  sans elle, toutes les gouttes toucheraient sur le bord bas du cadre, en une rangée. */
  chute: number
  vive: boolean
}

/**
 * PAR OÙ UNE PARTICULE ENTRE. Ce n'est pas un détail de plomberie : c'est ce qui rend le
 * rideau uniforme là où la loi d'intensité l'est.
 *   • `volume` — n'importe où dans l'aire d'émission. Une goutte qui a TOUCHÉ (sa hauteur de
 *     chute épuisée) renaît ainsi, et c'est aussi ainsi qu'on sème un rideau pas encore établi.
 *   • `flux` — sur un bord tiré au débit (haut contre côté). Pour une naissance NETTE, quand
 *     rien ne dit d'où elle viendrait.
 *   • `haut` · `bas` · `ouest` · `est` — sur CE bord-là. Une particule qui sort du cadre
 *     rentre par le bord OPPOSÉ à celui par lequel elle est sortie.
 */
export type Entree = 'volume' | 'flux' | 'haut' | 'bas' | 'ouest' | 'est'

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
/**
 * ═══ LE SOUFFLE D'UN CIEL, PROJETÉ SUR LE CAP DU VENT ═══
 *
 * `Profil.vent` n'est PAS une direction : c'est la FORCE latérale de ce ciel (0,8 pour la pluie,
 * 11 pour le blizzard qui rase). Elle pointait l'est, toujours — le rideau penchait donc à
 * droite quel que soit le front, et l'aiguille du HUD le contredisait une fois sur deux.
 *
 * On la projette désormais sur le cap. La vue est de DESSUS, donc l'écran n'a pas d'axe
 * vertical à donner à la chute : c'est l'axe `y` qui porte À LA FOIS le nord-sud du monde et la
 * chute. La projection en tient compte (décision d'Alexis, 2026-08-25) :
 *
 *   • la composante EST-OUEST penche le rideau — c'est ce qu'on voit ;
 *   • la composante NORD-SUD change la VITESSE DE CHUTE. Un vent du nord (qui pousse vers le
 *     bas de l'écran) raidit et accélère la chute ; un vent du sud la ralentit, et le
 *     flottement reprend le dessus.
 *
 * Ce qu'on gagne, et c'est le point : le blizzard garde sa violence sous TOUS les caps — il
 * rase sous un vent d'ouest, il martèle sous un vent du nord. Aucun plancher de râclage, donc
 * aucun mensonge sur la direction : ce que le rideau montre, l'aiguille le dit.
 *
 * ⚠ LE PLANCHER DE CHUTE N'EST PAS UN CONFORT. Sans lui, un blizzard plein sud (vent 11 contre
 * une chute de 2,1) rendrait une vitesse NÉGATIVE : de la neige qui remonte. Le plancher garde
 * la chute vers le bas, toujours.
 */
export interface Souffle {
  /** Ce qui pousse par le travers, en tuiles/s (positif = vers l'est). */
  readonly lateral: number
  /** Ce qui tombe, en tuiles/s — toujours > 0. */
  readonly chute: number
}

/** Quelle part du vent nord-sud entre dans la chute. Pleine, un blizzard plein nord tomberait
 *  cinq fois plus vite que sa vitesse limite : la neige deviendrait des barres. */
export const PART_CHUTE = 0.6
/** Le plancher de chute, en part de `vLimite` — voir l'en-tête : sans lui, la neige remonte. */
export const PLANCHER_CHUTE = 0.4

export function souffleDuCiel(profil: ProfilChute, cap: { x: number; y: number }): Souffle {
  const n = Math.sqrt(cap.x * cap.x + cap.y * cap.y)
  // CALME PLAT (le vecteur nul) : rien ne penche, et la chute est celle de l'air immobile.
  // C'est un monde qui n'a pas de vent — le même contrat que `windSway` et les serpentins.
  if (n < 0.001) return { lateral: 0, chute: profil.vLimite }
  const chute = profil.vLimite + (profil.vent * cap.y * PART_CHUTE) / n
  return {
    lateral: (profil.vent * cap.x) / n,
    chute: Math.max(profil.vLimite * PLANCHER_CHUTE, chute),
  }
}

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
  /** Combien de particules sont vivantes — LU PAR LE SMOKE. */
  vivantes = 0
  /** Le compte visé ce frame (budget × intensité moyenne du cadre) — LU PAR LE SMOKE. */
  cible = 0
  /** La part de FROID moyenne du cadre, relevée ce frame — elle partage la cible entre les
   *  deux troupeaux. LUE PAR LE SMOKE aussi : c'est le nombre qui dit « il grésille ». */
  partFroid = 0
  private readonly rng: () => number
  private t = 0

  constructor(graine = 0x5eed_bea7) {
    this.rng = creerRng(graine)
    for (let i = 0; i < BUDGET_PARTICULES; i++) {
      this.particules.push({ x: 0, y: 0, vx: 0, vy: 0, phase: 0, cran: 0, froid: false, chute: 0, vive: false })
    }
  }

  /** Tout meurt — le front est sorti, ou le type n'a pas de grain (brouillard). */
  vider(): void {
    for (const p of this.particules) p.vive = false
    this.vivantes = 0
    this.cible = 0
  }

  /** Le cap du vent de la dernière image — posé par `update`, lu par `naitre`. */
  private cap: { x: number; y: number } = { x: 1, y: 0 }

  /**
   * UNE IMAGE. `dt` en secondes (borné par l'appelant) ; `vue` est le cadre visible en
   * tuiles, `bande` et `rampe` disent où il pleut.
   */
  update(
    dt: number, melange: Melange, vue: Vue, bande: Bande, rampe: number,
    /** Ce que d'AUTRES particules occupent déjà du budget partagé (la gerbe de la foudre) :
     *  le plafond du rideau descend d'autant. Les 650 sont un budget de MACHINE — il se
     *  partage, il ne s'empile pas par système. */
    reservees = 0,
    /** LE CAP DU VENT (pas besoin qu'il soit unitaire) — voir `souffleDuCiel`. Par défaut
     *  l'est : c'est le rideau d'avant la projection, au bit près, et c'est ce qui laisse
     *  tous les montages d'avant inchangés. */
    cap: { x: number; y: number } = { x: 1, y: 0 },
  ): void {
    this.t += dt
    this.cap = cap
    const { doux, froid } = melange
    if (!doux && !froid) { this.vider(); return }

    // ── LE COMPTE CIBLE SUIT L'INTENSITÉ MOYENNE DU CADRE (rampe continue, pas d'interrupteur).
    //    Échantillonnée sur une grille grossière : 48 lectures d'une formule à trois opérations,
    //    contre 900 si on la relisait par particule pour le même chiffre. ──
    let somme = 0
    let sommeFroid = 0
    const NX = 8
    const NY = 6
    for (let j = 0; j < NY; j++) {
      const y = vue.y0 + ((j + 0.5) / NY) * (vue.y1 - vue.y0)
      for (let i = 0; i < NX; i++) {
        const x = vue.x0 + ((i + 0.5) / NX) * (vue.x1 - vue.x0)
        somme += intensiteDansBande(bande, rampe, x, y)
        // LA MÊME GRILLE SERT LES DEUX RELEVÉS — la part de froid du cadre ne mérite pas un
        // second balayage, et c'est elle qui pondère le flux d'entrée et la densité visée.
        if (froid) sommeFroid += melange.part(x, y)
      }
    }
    const moyenne = somme / (NX * NY)
    // LA PART DE FROID DU CADRE — 0 sans aspect froid, donc tout ce qui suit est inerte.
    this.partFroid = froid ? (doux ? sommeFroid / (NX * NY) : 1) : 0
    const aire = Math.max(1, (vue.x1 - vue.x0) * (vue.y1 - vue.y0))
    const plafond = Math.max(0, BUDGET_PARTICULES - reservees)

    // ═══ DEUX TROUPEAUX, DEUX CIBLES — et c'est ce qui rend le mélange JUSTE ═══
    //
    // La tentation était de tirer la nature à pile ou face contre la part et de garder UN
    // compte. MESURÉ, ça ne marche pas : un troupeau à effectif constant reflète le débit des
    // naissances MULTIPLIÉ par la durée de vie (`N = débit × durée`), et un flocon vit dix fois
    // plus longtemps qu'une goutte — il flâne à 1,2 tuile/s là où elle file à 9. À moitié de
    // part, on obtenait **76 % de flocons à l'écran**, et le dégradé qu'on construit s'écrasait.
    // Pire : sous une lisière, les flocons du côté froid mangeaient le budget commun et le
    // côté doux tombait à un quatorzième de sa densité — **relevé : 0,05 goutte par tuile pour
    // 0,69 due**.
    //
    // On pilote donc chaque espèce SUR SA PROPRE CIBLE, et les durées de vie s'annulent d'elles-
    // mêmes : chacune a sa densité de table, pondérée par sa part du cadre. Aucune loi de
    // conversion à écrire, aucun facteur à calibrer.
    let cibleDoux = doux ? doux.densite * aire * moyenne * (1 - this.partFroid) : 0
    let cibleFroid = froid ? froid.densite * aire * moyenne * this.partFroid : 0
    // LE BUDGET RESTE COMMUN — c'est un budget de MACHINE. Trop plein, les deux se serrent
    // dans la même proportion : le mélange ne change pas parce que la machine est chargée.
    const voulu = cibleDoux + cibleFroid
    if (voulu > plafond) {
      const k = voulu <= 0 ? 0 : plafond / voulu
      cibleDoux *= k
      cibleFroid *= k
    }
    const cibleDe = [Math.round(cibleDoux), Math.round(cibleFroid)] as const
    this.cible = cibleDe[0] + cibleDe[1]

    // ── L'INTÉGRATION ──
    // Le souffle projeté, UNE FOIS par image et par espèce : la goutte et le flocon n'ont ni
    // la même masse ni la même prise au vent, mais ils sont dans le même air.
    const souffleDoux = doux ? souffleDuCiel(doux, this.cap) : null
    const souffleFroid = froid ? souffleDuCiel(froid, this.cap) : null
    const vivantesDe: [number, number] = [0, 0]
    for (const p of this.particules) {
      if (!p.vive) continue
      // SON PROFIL, pas celui du ciel : une goutte et un flocon tombent côte à côte, chacun
      // avec sa masse et son air. C'est toute la différence entre du grésil et un fondu.
      const profil = (p.froid ? froid : doux) ?? doux ?? froid!
      const souffle = (p.froid ? souffleFroid : souffleDoux) ?? souffleDoux ?? souffleFroid!
      const k = profil.g / profil.vLimite // le coefficient de traînée — le même air pour les deux axes
      // dv/dt = k·(cible − v) : l'air retient, l'équilibre est à la cible. Sur y c'est la
      // CHUTE (`vLimite` corrigée du vent nord-sud), sur x le souffle latéral — même k, même
      // air. À cap plein est, `k · vLimite` vaut exactement `g` : le rideau d'avant, au bit près.
      p.vy += k * (souffle.chute - p.vy) * dt
      p.vx += k * (souffle.lateral - p.vx) * dt
      // LE FLOTTEMENT : une vitesse latérale de plus, avec la PHASE PROPRE de la particule.
      const osc = profil.flotte === 0 ? 0 : profil.flotte * Math.sin(profil.flottePuls * this.t + p.phase)
      p.x += (p.vx + osc) * dt
      p.y += p.vy * dt
      p.chute -= p.vy * dt
      // Touché : sa hauteur de chute est épuisée, elle renaît ailleurs dans l'aire. RIEN NE
      // SE PEINT AU SOL — l'éclaboussure a été retirée le 2026-08-23 (voir l'en-tête).
      if (p.chute <= 0) {
        // ELLE RENAÎT DANS SON ESPÈCE — un flocon ne devient pas une goutte parce qu'il a
        // touché. Si le point où il renaît ne porte plus de neige, le rejet le refuse et il
        // meurt : c'est le pilotage par cible qui remet alors une goutte à sa place.
        this.naitre(p, melange, p.froid, vue, bande, rampe, 'volume')
        if (p.vive) vivantesDe[p.froid ? 1 : 0] += 1
        continue
      }
      // Sortie du cadre : elle rentre PAR LE BORD OPPOSÉ, celui d'où elle vient — pas par un
      // bord tiré au flux. Ce qui sort par le bas rentre par le haut, ce qui sort à l'est
      // rentre à l'ouest : l'entrée d'un côté ÉGALE la sortie de l'autre, par construction.
      // (Le tirage au flux, lui, donnait au bord ouest une part de TOUTES les sorties, y
      // compris celles du bas — d'où un excès à gauche que rien ne compensait.)
      // Sortie de la BANDE sans sortir du cadre : on ne sait pas d'où elle vient, c'est le
      // flux qui tranche.
      if (p.x < vue.x0 || p.x > vue.x1 || p.y < vue.y0 || p.y > vue.y1
        || intensiteDansBande(bande, rampe, p.x, p.y) <= 0) {
        const par: Entree = p.y > vue.y1 ? 'haut'
          : p.y < vue.y0 ? 'bas'
            : p.x > vue.x1 ? 'ouest'
              : p.x < vue.x0 ? 'est'
                : 'flux'
        this.naitre(p, melange, p.froid, vue, bande, rampe, par)
        if (!p.vive) continue
      }
      vivantesDe[p.froid ? 1 : 0] += 1
    }

    // ── LA POPULATION REJOINT SA CIBLE : on naît ou on meurt, quelques-unes par image, pour
    //    que la lisière s'éclaircisse en fondu et non par à-coups. ──
    for (const espece of [0, 1] as const) {
      const cible = cibleDe[espece]
      const froidVoulu = espece === 1
      if (vivantesDe[espece] < cible) {
        // Quand le rideau n'est pas encore établi (moitié du compte manquante : le front vient
        // d'entrer, ou on vient de se téléporter dedans), on sème DANS TOUT LE CADRE d'un coup —
        // sinon une averse commence par une ligne au plafond qui descend pendant deux secondes.
        // Une fois établi, elle ne renaît que par un bord et par petites bouffées : la lisière
        // s'éclaircit en fondu, jamais par à-coups.
        const etabli = vivantesDe[espece] * 2 >= cible
        const par: Entree = etabli ? 'flux' : 'volume'
        const quota = etabli ? Math.max(4, Math.ceil(cible * 0.12)) : cible - vivantesDe[espece]
        let nes = 0
        let essais = 0
        for (const p of this.particules) {
          if (nes >= quota || essais > quota * 4 + 16) break
          if (p.vive) continue
          essais++
          this.naitre(p, melange, froidVoulu, vue, bande, rampe, par)
          if (!p.vive) continue
          nes++
          vivantesDe[espece] += 1
        }
      } else if (vivantesDe[espece] > cible) {
        let aTuer = vivantesDe[espece] - cible
        for (const p of this.particules) {
          if (aTuer <= 0) break
          if (!p.vive || p.froid !== froidVoulu) continue
          p.vive = false
          vivantesDe[espece] -= 1
          aTuer--
        }
      }
    }
    this.vivantes = vivantesDe[0] + vivantesDe[1]

  }

  /**
   * NAÎTRE — par REJET contre l'intensité locale : la densité SPATIALE suit la rampe du
   * front (dense au cœur, éparse au bord), et pas seulement le total. Six essais, puis on
   * renonce pour cette image : mieux vaut une particule de moins qu'une boucle qui rame
   * quand le cadre n'a presque pas de bande.
   *
   * ═══ UN BORD D'AMONT HORS BANDE N'EST PAS UN BORD D'AMONT ═══
   *
   * DÉFAUT MESURÉ (rapport d'Alexis, 2026-08-23 ; garde `le rideau ne penche pas d'un côté`) :
   * sous un front d'axe `y` dont la lisière tombe DANS le cadre, le haut du cadre est HORS
   * bande — donc toute naissance tirée sur le bord haut sortait à I = 0 et mourait, tandis
   * que celles du bord OUEST (`vent > 0` ⇒ `x = vue.x0`) passaient. Le rideau se recomposait
   * par la gauche, et il y RESTAIT : à 9 tuiles/s de chute pour 0,8 de vent, une goutte ne
   * traverse pas le cadre avant de toucher. **Relevé : gauche 254 / droite 13 sous la pluie,
   * 217 / 20 sous l'orage** — pour une loi d'intensité qui ne dépend même pas de x.
   *
   * LE REMÈDE EST GÉOMÉTRIQUE, PAS UN QUOTA D'ESSAIS : si le point tiré sur le bord est hors
   * bande, ce bord ne laisse rien entrer, et la source qui reste est VOLUMIQUE (la bande
   * avance sur le sol : le rideau s'y remplit par le dedans, il n'y coule pas par un bord).
   * On retire donc ce même essai dans le cadre. C'est INERTE quand le cadre est tout entier
   * dans la bande — le repli ne tire pas, le flux d'aléa ne bouge pas, les gardes d'avant
   * ne bronchent pas — et le REJET qui suit garde la rampe : rien ne fuit au-delà de `lo`.
   */
  private naitre(
    p: Particule,
    melange: Melange,
    /** L'ESPÈCE VOULUE — le pilotage par cible la choisit, `naitre` ne la tire pas. */
    froidVoulu: boolean,
    vue: Vue,
    bande: Bande,
    rampe: number,
    par: Entree,
  ): void {
    const profil = froidVoulu ? melange.froid : melange.doux
    if (!profil) { p.vive = false; return }
    const souffle = souffleDuCiel(profil, this.cap)
    // LA PART DE CETTE ESPÈCE ICI — elle multiplie l'intensité dans le rejet, si bien que la
    // densité SPATIALE de chaque troupeau suit le champ de neige comme elle suit déjà la rampe
    // du front. C'est là, et nulle part ailleurs, que la géographie du mélange entre.
    // Sans second aspect, le facteur vaut 1 tout rond : le tirage d'avant R14, au bit près.
    const melange2 = melange.froid !== null && melange.doux !== null
    // ── L'AIRE D'ÉMISSION : LE CADRE INTERSECTÉ AVEC LA BANDE, jamais le cadre nu. ──
    // Identité quand le cadre est immergé (le cas courant) ; sous une lisière, elle DÉCOUPE.
    // Ses bords sont ceux qui comptent, et sa hauteur est celle qui pèse dans le flux : à
    // 15 tuiles de bande visible sur 25 de cadre, le débit latéral vaut 15, pas 25 — sans
    // quoi le bord ouest reçoit deux fois trop, et ça se voit (le décile de gauche double).
    const ax0 = bande.axis === 'x' ? Math.max(vue.x0, bande.lo) : vue.x0
    const ax1 = bande.axis === 'x' ? Math.min(vue.x1, bande.hi) : vue.x1
    const ay0 = bande.axis === 'y' ? Math.max(vue.y0, bande.lo) : vue.y0
    const ay1 = bande.axis === 'y' ? Math.min(vue.y1, bande.hi) : vue.y1
    const w = ax1 - ax0
    const h = ay1 - ay0
    if (w <= 0 || h <= 0) { p.vive = false; return }
    // Par quel bord ? PAR LE FLUX : la proportion qui entre par le haut vaut le débit
    // vertical (vLimite × largeur) contre le débit latéral (|vent| × hauteur). Le blizzard
    // entre donc surtout par l'ouest, la pluie par le haut — sans qu'on ait à le dire.
    // LE FLUX EST CELUI DE SON ESPÈCE : le flocon chassé entre par le côté, la goutte par le
    // haut, et chacune garde son débit. Rien à mélanger ici — les deux troupeaux sont pilotés
    // séparément, c'est tout l'intérêt.
    const fluxHaut = souffle.chute * w
    const fluxCote = Math.abs(souffle.lateral) * h
    for (let essai = 0; essai < 6; essai++) {
      let x: number
      let y: number
      // Le tirage au flux ne tranche QUE le cas `flux` : ailleurs le bord est nommé.
      const bord: Entree = par !== 'flux' ? par
        : this.rng() * (fluxHaut + fluxCote) < fluxHaut ? 'haut'
          : souffle.lateral >= 0 ? 'ouest' : 'est'
      if (bord === 'volume') {
        x = ax0 + this.rng() * w
        y = ay0 + this.rng() * h
      } else if (bord === 'haut' || bord === 'bas') {
        x = ax0 + this.rng() * w
        y = bord === 'haut' ? ay0 : ay1
      } else {
        x = bord === 'ouest' ? ax0 : ax1
        y = ay0 + this.rng() * h
      }
      // Ce bord-là ne laisse rien entrer : on se replie sur la source VOLUMIQUE, dans l'aire.
      if (bord !== 'volume' && intensiteDansBande(bande, rampe, x, y) <= 0) {
        x = ax0 + this.rng() * w
        y = ay0 + this.rng() * h
      }
      const I = intensiteDansBande(bande, rampe, x, y)
      const facteur = melange2 ? (froidVoulu ? melange.part(x, y) : 1 - melange.part(x, y)) : 1
      if (I <= 0 || this.rng() > I * facteur) continue
      p.x = x
      p.y = y
      p.froid = froidVoulu
      // Elle entre à sa vitesse d'équilibre (à un cheveu près) : une particule qui
      // démarrerait à zéro traverserait le haut du cadre en accélérant, et l'œil verrait
      // le plafond « pleuvoir plus lentement » que le sol.
      p.vy = souffle.chute * (0.82 + 0.18 * this.rng())
      p.vx = souffle.lateral * (0.85 + 0.3 * this.rng())
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
