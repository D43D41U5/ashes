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
import { TERRAINS, TERRAIN_BOULDERS, TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_PEAT_BOG, TERRAIN_REED_MARSH, TERRAIN_SCREE, TERRAIN_SHALLOW_WATER } from './balance'
import { isWater } from './map'
import { fbm2, hash2 } from './noise'
import { CREUX, ROCHE, altitudeAt, celluleDe, familleDeCellule, lireLeChampAt, seuilParQuantile, type Creux } from './racine-relief'
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

/** Ce que le module d'eau PUBLIE — la rivière (si la Racine en a une) et, TOUJOURS, les
 *  chenaux entre lacs : la saulaie longe l'eau qui coule, fil ET chenaux (spec §2ter R33).
 *  Les chenaux vivent HORS de `Riviere` par construction : une Racine sans rivière garde
 *  ses ruisseaux — et sa saulaie. */
export interface EauxDeLaRacine {
  riviere: Riviere | null
  /** Les tuiles d'eau des CHENAUX entre lacs (les ruisseaux du drainage). */
  chenaux: number[]
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
): EauxDeLaRacine {
  const N = width * height
  const racineId = g.racine

  // La SURFACE marchable de la Racine — c'est elle qui dose le nombre de lacs.
  let surface = 0
  for (let i = 0; i < N; i++) {
    if (zone[i] === racineId && TERRAINS[terrain[i]!]?.walkable === true) surface++
  }
  if (surface === 0) return { riviere: null, chenaux: [] }

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
  const chenaux: number[] = []
  relierLesLacs(terrain, zone, racineId, width, height, lacs, eaux, creux, horsSeuils, chenaux)
  // LE LAPIAZ puis LES RÉSURGENCES — la face sèche et la face humide du même karst. Avant la
  // frange de marais, exprès : une source reçoit ses joncs comme n'importe quelle eau, et rien
  // dans le monde ne dit qu'elle est d'une autre nature.
  poserLesLapiaz(terrain, zone, racineId, width, height, bordure, creux, s)
  frangeDeMarais(terrain, zone, racineId, width, height, s, eaux)
  // LES RÉSURGENCES EN DERNIER, DONC SANS FRANGE DE MARAIS — et ce n'est pas un détail d'ordre.
  // ① Une source karstique est de l'eau CLAIRE qui sort de la roche, pas une vasque de boue :
  //    lui coller des joncs serait faux. ② Et la garde A11 l'a exigé : la frange des ~35 mares
  //    inversait le rang à l'eau au bout mouillé (seed 7 : marais 5,28 > roselière 4,83), en
  //    diluant les deux SEULS terrains du T0 qui savent où est l'eau. Les servir en dernier
  //    règle les deux d'un coup, et `eaux` n'a alors plus de lecteur — la source ne s'y ajoute
  //    donc pas.
  poserLesResurgences(terrain, zone, racineId, width, height, bordure, creux, horsSeuils)
  return { riviere, chenaux }
}

/**
 * ═══ LE RÉGLAGE DU LAPIAZ — il se règle EN REGARDANT UNE CARTE, donc il vit ici ═══
 *
 * (Retour d'Alexis, 2026-08-27 : *« les biomes scree et boulders sont trop droits (des gros
 * chunks), il faudrait que ça se rapproche de la forme des autres biomes. »* — MESURÉ avant
 * d'écrire une ligne, seed 2026, monde joué : la caillasse sortait en **13 amas pour 39 760
 * tuiles**, dont un de 16 768, avec **91,8 % de ses segments de bord longs de huit tuiles ou
 * plus** ; les autres biomes du pays sont à 0,7-1,5 % — herbe 1,3 %, forêt 1,5 %, lande 0,7 %.
 * La cause tenait en une ligne : le lapiaz décidait PAR CELLULE de motif et peignait ses 64
 * tuiles d'un bloc, quand la végétation de la Racine décide PAR TUILE — `vegetationAt`, la
 * lecture molle de `sol-dessine.md` R1. Le minéral était le seul biome du pays resté au carré.)
 */
const LAPIAZ = {
  /** L'échelle du moucheté, en tuiles — celle des taches d'une palette de zone. */
  ECHELLE: 60,
  /** Au-dessus : de l'éboulis. Sous : de la roche nue. ~35 % d'éboulis — la roche domine. */
  SEUIL_EBOULIS: 0.54,
  /**
   * L'amplitude du grain du CONTOUR (× (fbm − 0,5)), en unités des champs de roche et
   * d'altitude — les deux vivent dans [0,1], donc leurs marges se comparent sans conversion.
   *
   * C'est LUI qui déchiquette le bord : sans lui, la lecture bilinéaire seule rendrait une
   * hyperbole entre quatre centres de cellule — lisse, et toujours pas la forme d'un pierrier.
   * Le même rôle exactement que `CREUX.GRAIN_TUILE_AMPLITUDE` pour ce qui pousse. CALIBRÉ à la
   * mesure (segments de bord ≥ 8 tuiles, cible : le régime des autres biomes).
   */
  GRAIN_CONTOUR: 0.055,
  /**
   * L'ÉPAISSEUR DE LA FRANGE D'ÉBOULIS, en unités de champ — la marge sous laquelle on est
   * encore sur la PENTE de la doline, pas dans son fond.
   *
   * Elle remplace le « bord » d'avant, qui était `la cellule touche une non-cuvette` : un liseré
   * d'exactement un motif de large, donc un contour dessiné. Ici la frange est une BANDE DE
   * NIVEAU du même champ que le reste — elle s'épaissit là où la doline est plate et se pince là
   * où elle plonge. Le bord cesse d'être un trait pour devenir une pente.
   */
  FRANGE: 0.022,
} as const

/**
 * LE PAYS MOUILLÉ — eau, marais, roselière, tourbière.
 *
 * ⚠ NI LE LAPIAZ NI LA RÉSURGENCE N'Y MORDENT, et c'est une garde qui l'a exigé. Le marais et la
 * roselière sont les DEUX SEULS terrains du T0 qui savent où est l'eau (ils en dérivent), et A11
 * affirme leur rang : `d(marais) < d(roselière)`. Les repeindre, même de loin, dilue les deux
 * mesures et inverse le rang (seed 7, mesuré : marais 5,52 contre roselière 4,83). C'est aussi
 * le bon sens du terrain : une doline qui porte une tourbière n'est pas un pavement de roche, et
 * une source ne sort pas au milieu d'une roselière.
 */
function estMouille(t: number): boolean {
  return isWater(t) || t === TERRAIN_MARSH || t === TERRAIN_REED_MARSH || t === TERRAIN_PEAT_BOG
}

/**
 * ═══ LE LAPIAZ — la cuvette calcaire qui ne s'est pas remplie (spec `roche-mere.md` R6) ═══
 *
 * Le karst (R4) retire l'eau des cuvettes calcaires. Ce qui reste n'est pas un TROU dans la
 * carte : c'est un pavement de roche nue — une doline. On le peint donc, et avec deux terrains
 * qui **existent, sont dessinés, et que le monde joué ne posait jamais** : mesuré avant ce
 * chantier, `boulders` = **0,00 %** de la carte et `scree` = **0,12 %**. C'est le seul endroit
 * où la roche-mère crée un paysage qui n'existait pas du tout — **un biome minéral MARCHABLE au
 * milieu du pré**, sans un id de terrain neuf et sans une ressource neuve (contrainte d'Alexis
 * du 2026-08-26).
 *
 * ⚠ **IL RESTE MARCHABLE, ET C'EST CE QUI REND A13 GRATUIT.** `boulders` (0,6) et `scree` sont
 * lents, jamais bloquants : assécher n'enferme personne, et « la Racine marchable reste d'un
 * seul tenant » tient par construction — la garde n'a rien à réparer.
 *
 * La même prémisse que les lacs (`altLarge < seuilBassin`, cellule propre), la roche en plus, et
 * l'eau en moins. Aucun tirage : la géologie décide seule.
 */
function poserLesLapiaz(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  bordure: number,
  creux: Creux | null,
  sel: number,
): void {
  if (!creux) return
  const n = creux.cols * creux.rows

  // ── ① LE CHAMP CONTINU, par cellule : « de combien suis-je DANS la doline calcaire ? »
  //
  // Deux marges, la plus faible fait la loi (`min`) : on est dans un lapiaz quand on est à la
  // fois dans le calcaire ET sous le seuil du bassin. Négatif dehors, et d'autant plus négatif
  // qu'on s'en éloigne — c'est cette PENTE que la lecture molle interpole, et c'est elle qui
  // remplace le tout-ou-rien d'un masque de cellules.
  const marge = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    marge[k] = Math.min(creux.seuilCalcaire - creux.roche[k]!, creux.seuilBassin - creux.altLarge[k]!)
  }
  const selContour = (sel ^ 0x4c50424f) | 0 /* 'LPBO' */
  const selMouchet = (sel ^ 0x4c415049) | 0 /* 'LAPI' */

  // ── ② LA PEINTURE, PAR TUILE — mais LE TRI SE FAIT PAR CELLULE, et c'est ce qui la rend
  //    gratuite. Descendre à la tuile faisait passer la doline de 12 000 verdicts à 780 000 :
  //    A13 (« une carte de production naît en moins de 15 s ») est une garde MURALE, elle ne
  //    pardonne pas un facteur soixante.
  //
  //    LE MAJORANT EST EXACT, pas heuristique — donc l'élagage ne peut pas changer la carte.
  //    `lireLeChampAt` rend une interpolation bilinéaire des quatre cellules qui entourent la
  //    tuile, plus `(fbm2 − 0,5) × amplitude`. Une convexe est bornée par son max, et `fbm2` par
  //    1 : toute tuile de la cellule (mx,my) lit dans le voisinage 3×3 de cette cellule, donc sa
  //    valeur est **≤ max(marge sur le 3×3) + amplitude/2**. Si ce majorant est ≤ 0, aucune
  //    tuile du carré ne peut être un lapiaz — on saute les 64 sans les regarder.
  const plafond = LAPIAZ.GRAIN_CONTOUR / 2
  const MOT: number = CREUX.MOTIF
  for (let my = 0; my < creux.rows; my++) {
    for (let mx = 0; mx < creux.cols; mx++) {
      let hautVoisin = -Infinity
      for (let dy = -1; dy <= 1; dy++) {
        const ky = my + dy
        if (ky < 0 || ky >= creux.rows) continue
        for (let dx = -1; dx <= 1; dx++) {
          const kx = mx + dx
          if (kx < 0 || kx >= creux.cols) continue
          const v = marge[ky * creux.cols + kx]!
          if (v > hautVoisin) hautVoisin = v
        }
      }
      if (hautVoisin + plafond <= 0) continue

      // (Les annotations `: number` ne sont pas décoratives : sans elles, `tsc` bute sur
      //  TS7022 dans cette fonction — l'inférence circule entre les bornes de boucle et l'index.)
      const tx0: number = (creux.mx0 + mx) * MOT
      const ty0: number = (creux.my0 + my) * MOT
      for (let dy = 0; dy < MOT; dy++) {
        const y: number = ty0 + dy
        if (y < bordure || y >= height - bordure) continue
        for (let dx = 0; dx < MOT; dx++) {
          const x = tx0 + dx
          if (x < bordure || x >= width - bordure) continue
          const i = y * width + x
          // La Racine, sèche et marchable : une doline ne mord ni sur l'eau déjà peinte (un
          // ruisseau peut TRAVERSER le calcaire, R5) ni sur une autre zone, ni sur la roche du
          // mur. Les vétos DURS se testent À LA TUILE — et c'est plus juste que l'ancien « les
          // 64 tuiles du motif sont propres », qui refusait un motif entier pour une seule tuile
          // de ruisseau et taillait donc des angles droits dans la doline.
          if (zone[i] !== racineId) continue
          const t = terrain[i]!
          if (TERRAINS[t]?.walkable !== true || estMouille(t)) continue
          const v = lireLeChampAt(creux, marge, x, y, selContour, LAPIAZ.GRAIN_CONTOUR)
          if (v <= 0) continue
          // LE CŒUR EST EN BLOCS, LA PENTE EN ÉBOULIS — la grammaire du lac (cœur profond ceint
          // de haut-fond), retournée. Et le cœur est MOUCHETÉ, pas un aplat : sans ce
          // rebattement, la doline sortait en une masse grise uniforme cernée d'un liseré — une
          // forme DESSINÉE au milieu d'un monde dont chaque biome est un mélange.
          const eboulis = v < LAPIAZ.FRANGE || fbm2(x, y, LAPIAZ.ECHELLE, selMouchet) > LAPIAZ.SEUIL_EBOULIS
          terrain[i] = eboulis ? TERRAIN_SCREE : TERRAIN_BOULDERS
        }
      }
    }
  }
}

/**
 * ═══ LES RÉSURGENCES — ce que le calcaire avale ressort au CONTACT (spec `roche-mere.md` R7) ═══
 *
 * Ce n'est pas un semis de mares : c'est **le point où le bilan se referme**. Le karst (R4) prend
 * l'eau des cuvettes calcaires ; elle reparaît là où la roche imperméable l'arrête — donc **dans
 * le pays sec**, précisément là où la vallée n'a rien.
 *
 * ⚠ **C'EST ELLE QUI PORTE TOUT LE GAIN DE FAUNE, PAS LE KARST.** Mesuré avant d'écrire une
 * ligne : assécher le calcaire, SEUL, rend des coins de chasse **plats à −1** (5→5 · 6→5 · 6→6 ·
 * 5→4 · 6→6 sur cinq seeds). Le goulot n'est pas la quantité d'eau — **91,7 % de toute l'eau de
 * la vallée tient dans 7 corps** — mais sa DISTRIBUTION contre le treillis de Poisson à 200
 * tuiles du semis des coins : 23 à 26 points sont tirés, 5 à 6 passent, et ce qui tue les autres
 * est `FAUNA.GROUND_WATER_NEAR`. Sept lacs ne peuvent pas nourrir vingt-cinq points ; quarante
 * adresses, si. Le karst n'est pas la CAUSE du gain — il en est la RAISON, et c'est ce qui
 * sépare cette passe d'un saupoudrage de mares.
 *
 * ⚠ **UNE SOURCE EST DE L'EAU DORMANTE : la garde A16 vaut pour elle.** *Un seuil ne nourrit
 * rien, pas même à boire* — elle passe donc par le MÊME `horsSeuils` que les lacs, sans quoi on
 * rouvrirait par la petite porte le défaut que `MARGE_SEUIL` a fermé (une porte qui débouche sur
 * une rive, et la sente sans où se poser).
 *
 * ÉLECTION DÉTERMINISTE, sans tirage : balayage row-major des cellules, on garde la première
 * assez loin de toutes les précédentes. Pas de PRNG, pas de `hash2` — la géologie décide seule.
 */
function poserLesResurgences(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  bordure: number,
  creux: Creux | null,
  horsSeuils: Uint8Array,
): void {
  if (!creux) return
  const M = CREUX.MOTIF
  const gardees: { x: number; y: number }[] = []

  // ⚠ **UNE SOURCE SORT AU PIED D'UNE PENTE, JAMAIS SUR UNE CRÊTE — et deux gardes l'ont exigé.**
  // La première écriture n'imposait que le contact de roche. Les sources tombaient donc aussi sur
  // les DOS SECS, qui sont précisément le pays que deux invariants tiennent pour sec :
  //   · A14 — le pin de crête doit être à plus du TRIPLE de l'eau que le bosquet humide. Mesuré
  //     après coup : **96 tuiles contre 118 exigées** (ratio tombé à 2,4). Le bois sec cessait
  //     d'être sec, et la demande d'Alexis du 2026-07-29 (« loin des points d'eau ») avec lui.
  //   · A11 — le rang à l'eau s'inversait au bout mouillé (seed 7 : marais 5,21 > roselière 4,83),
  //     la frange de marais des sources brouillant les deux terrains qui SAVENT où est l'eau.
  // Exiger que la cellule soit sous l'altitude MÉDIANE du pays règle les deux d'un coup, et ce
  // n'est pas un rustine : une résurgence est un point BAS par définition — l'eau ne ressort pas
  // en haut. ⚠ On ne peut pas lire `creux.hum` ici : l'humidité se compose à la passe 1.55, APRÈS
  // l'eau. L'altitude, elle, est là depuis le socle.
  const seuilBas = seuilParQuantile(creux.alt, creux.dedans, ROCHE.SOURCE_PART_BASSE, -0.5, 1.5)

  for (let my = 1; my + 1 < creux.rows; my++) {
    for (let mx = 1; mx + 1 < creux.cols; mx++) {
      const k = my * creux.cols + mx
      if (creux.dedans[k] !== 1 || horsSeuils[k] === 0) continue
      if (creux.alt[k]! >= seuilBas) continue
      // LE CONTACT, et il est pris du bon côté : la source sort de la roche IMPERMÉABLE, au pied
      // du calcaire — jamais au milieu du plateau karstique, qui est justement ce qui ne retient
      // rien. La cellule n'est donc PAS calcaire, et l'une de ses quatre voisines l'est.
      if (familleDeCellule(creux, k) === -1) continue
      const voisinCalcaire =
        familleDeCellule(creux, k - 1) === -1 || familleDeCellule(creux, k + 1) === -1
        || familleDeCellule(creux, k - creux.cols) === -1 || familleDeCellule(creux, k + creux.cols) === -1
      if (!voisinCalcaire) continue

      const cx = (creux.mx0 + mx) * M + M / 2
      const cy = (creux.my0 + my) * M + M / 2
      if (cx < bordure || cy < bordure || cx >= width - bordure || cy >= height - bordure) continue

      let tropPres = false
      for (const g of gardees) {
        if (Math.max(Math.abs(g.x - cx), Math.abs(g.y - cy)) < ROCHE.SOURCE_ESPACEMENT) { tropPres = true; break }
      }
      if (tropPres) continue

      // La mare : du HAUT-FOND seulement (marchable — la connexité tient par construction, et
      // l'invariant de R45 n'a rien à garder puisqu'il n'y a pas de cœur profond).
      const r = ROCHE.SOURCE_RAYON
      let posees = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = cx + dx
          const ty = cy + dy
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
          const i = ty * width + tx
          if (zone[i] !== racineId) continue
          if (TERRAINS[terrain[i]!]?.walkable !== true || estMouille(terrain[i]!)) continue
          terrain[i] = TERRAIN_SHALLOW_WATER
          posees++
        }
      }
      // Une source qui n'a pas pu poser une seule tuile n'est pas une source : elle ne prend pas
      // sa place dans l'écart, sinon elle stériliserait 90 tuiles autour d'elle pour rien.
      if (posees > 0) gardees.push({ x: cx, y: cy })
    }
  }
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
    // ═══ LE CALCAIRE N'INONDE PAS (spec `roche-mere.md` R4) ═══
    //
    // Une cuvette karstique ne retient rien : l'eau s'infiltre. Le lac ne DISPARAÎT pas pour
    // autant — `candidats` est trié du plus creux au moins creux et l'on en prend `nLacs` :
    // écarter le calcaire fait simplement DESCENDRE LA LISTE. Même compte, autres adresses.
    // C'est là toute la différence avec « il y a moins d'eau » : il y en a autant, ailleurs.
    //
    // ⚠ LA RIVIÈRE, ELLE, EST EXEMPTE (R5) — mais elle ne passe pas par ici : son fil se trace
    // dans sa propre passe, qui ne lit pas `inondable`. Un cours pérenne colmate son lit dans
    // n'importe quelle roche, et §2 R5 promet qu'on peut LE SUIVRE du nord au sud.
    if (familleDeCellule(creux, k) === -1) return false
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
  chenaux: number[],
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
      peindreSegment(terrain, zone, racineId, width, height, creux, chemin[k]!, chemin[k + 1]!, eaux, chenaux)
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
  chenaux: number[],
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
      if (isWater(cur)) continue
      if (TERRAINS[cur]?.walkable !== true) continue
      terrain[i] = TERRAIN_SHALLOW_WATER
      eaux.push(i)
      chenaux.push(i)
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
    if (isWater(cur)) return // eau existante : intacte
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
        if (isWater(cur!) || cur === TERRAIN_MARSH) continue
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
