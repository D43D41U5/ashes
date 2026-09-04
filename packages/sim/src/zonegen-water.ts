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
import { estamperDisque } from './zonegen-trace'
import { fbm2, hash2 } from './noise'
import { tracerLHydrologie } from './zonegen-hydro'
import { CREUX, ROCHE, celluleDe, familleDeCellule, lireLeChampAt, seuilParQuantile, type Creux } from './racine-relief'
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
   *  64 → jusqu'à 4 096 tuiles, environ 64 de côté : un lac qu'on contourne, pas une mare.
   *  RELEVÉ de 44 à 64 le 2026-08-30 : depuis que le plafond se TIRE par lac (voir
   *  `LAC_MIN_CELLULES`), il n'est plus la taille de tous les lacs mais celle du plus grand —
   *  et un pays qui n'a que des mares n'a pas de lac. */
  LAC_MAX_CELLULES: 64,
  /**
   * TAILLE MINIMALE d'un lac, en cellules — et surtout : LE PLAFOND SE TIRE PAR LAC.
   *
   * MESURÉ le 2026-08-30 sur trois graines : 8 à 11 cuvettes par carte tenaient dans 4 % d'écart
   * autour de 2 100 tuiles, et plusieurs masses d'eau faisaient EXACTEMENT 2 816 tuiles — soit
   * `LAC_MAX_CELLULES × 64`, au tuile près. Le plafond était SATURÉ : la variété que la lame
   * d'eau (`LAC_LAME_MIN/MAX`) devait donner était mangée par la butée. Des jumeaux, encore —
   * le grief de juillet, un cran plus bas.
   *
   * Le plafond est donc TIRÉ par lac, entre ce minimum et le maximum, avec un biais vers le
   * petit (le carré du tirage) : beaucoup de mares, quelques vrais lacs. C'est la distribution
   * d'un pays, pas celle d'un semis.
   */
  LAC_MIN_CELLULES: 13,
  /** L'échelle du grain de rive, en tuiles : la taille des dentelures de la berge. */
  LAC_RIVE_ECHELLE: 26,
  /** L'amplitude de ce grain, en unités d'altitude. Il mord l'iso-contour du niveau : petit
   *  devant la LAME (0,05), sinon il ferait des confettis au lieu d'une rive. */
  LAC_RIVE_GRAIN: 0.012,
  /** La part de l'emprise que le lac remplit vraiment. Ce qui manque, ce sont les COINS : la
   *  différence entre le polygone en escalier d'avant et la forme molle d'aujourd'hui. */
  LAC_REMPLISSAGE: 0.86,
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
  /** L'écart d'un chenal à sa ligne de drainage, en tuiles — même rôle que `RUS.MEANDRE`. */
  CHENAL_MEANDRE: 4,
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
  /** Le rayon d'une flaque, en tuiles. Le minimum tient la raison d'être de l'ancien 2×2 : une
   *  tuile SEULE se rend en losange (le champ d'eau est filtré), il en faut deux de large. */
  FLAQUE_RAYON_MIN: 1.1,
  FLAQUE_RAYON_MAX: 2.6,

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

  /** Demi-largeur NOMINALE du LIT (haut-fond marchable). 3 → 7 tuiles : une rivière, pas un
   *  fossé. C'est la valeur de référence dont les AUTRES systèmes se servent (les coulées de
   *  suie, la portée des coins de pêche, le couloir de courant du client) ; la largeur
   *  RÉELLEMENT peinte, elle, varie le long du fil — voir `RIVIERE_RAYON_*`. */
  RIVIERE_DEMI_LIT: 3,
  /** Demi-largeur du CŒUR profond. 1 → 3 tuiles de mur d'eau (R5), toujours ceint du lit. */
  RIVIERE_DEMI_COEUR: 1,

  // ══ LA RIVIÈRE N'EST PLUS UN CANAL (décision d'Alexis, 2026-08-30) ═══════════════════════
  //
  // MESURÉ le 2026-08-30, deux crops à l'échelle d'un écran (60×40 tuiles) pris en amont et en
  // aval : même largeur, berges parallèles au cordeau sur soixante tuiles, coins à 90°. Trois
  // défauts, une seule cause — le lit se peignait en BANDES perpendiculaires d'une demi-largeur
  // CONSTANTE le long d'une polyligne de Manhattan.
  //
  // Depuis, l'eau est sortie de R32 (« arrête les angles droits pour les lacs et rivières ») :
  // le fil MÉANDRE (bruit sur la normale, puis lissage de Chaikin), et le lit s'ESTAMPE AU
  // DISQUE — l'union de disques le long d'une courbe donne une berge lisse, et le « coude
  // équerré » (le carré posé sur le pivot, et sa garde) n'a plus lieu d'être : un disque n'a
  // pas de coin extérieur à rater.

  /** Rayon du lit à la SOURCE, en tuiles (2,4 → ~5 tuiles de large). */
  RIVIERE_RAYON_SOURCE: 2.4,
  /** Rayon du lit à l'EMBOUCHURE (4,4 → ~9 tuiles). La rivière GROSSIT en descendant : c'est
   *  la hiérarchie du réseau, et c'est ce qui dit au joueur dans quel sens l'eau va. */
  RIVIERE_RAYON_BOUCHE: 4.4,
  /** Le battement de berge, en tuiles (±). Sans lui, deux berges parallèles au cordeau. */
  RIVIERE_RAYON_BRUIT: 0.85,
  /** Le retrait du CŒUR sous le lit, en tuiles. Le profond est né ceint de son propre lit —
   *  l'anneau de R45 tient par construction, comme avant. */
  RIVIERE_COEUR_RETRAIT: 2.2,
  /** L'amplitude du méandre, en tuiles, pour un tronçon de `RIVIERE_MEANDRE_ETALON` de long.
   *  Elle croît avec la longueur du tronçon : un long bief serpente plus large. */
  RIVIERE_MEANDRE: 95,
  RIVIERE_MEANDRE_ETALON: 400,
  /** Marge gardée entre le fil et le bord du rectangle de la Racine : un méandre ne doit pas
   *  aller mourir hors du pays (le lit y serait clippé, et la rivière cesserait de traverser). */
  RIVIERE_MARGE_BORD: 16,
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
  /** LE plus gros fleuve — celui que `map.fil` publie. `null` si le pays n'en porte aucun. */
  riviere: Riviere | null
  /** Les tuiles d'eau COURANTE qui comptent — la saulaie les longe (fil ET affluents). */
  chenaux: number[]
  /** TOUS les fleuves du pays, du plus gros au plus petit. Il y en a ce que le relief donne. */
  fils: number[][]
  /** Les tuiles des LACS de la Racine — l'eau plate, celle que les terrasses nivellent. */
  lacs: number[]
}

/** Le fenêtrage de la courbure — voir `estUnCoude`. */
export const COUDE = {
  /** Sur combien de pas de fil on mesure la direction, de part et d'autre. */
  FENETRE: 14,
  /** |sin θ| minimal entre l'amont et l'aval pour parler de coude. 0,45 → environ 27°. */
  SINUS_MIN: 0.45,
} as const

/**
 * Le fil TOURNE-T-IL en `fil[k]` ? — LA définition du coude, et il n'y en a qu'une.
 *
 * ⚠ ELLE A CHANGÉ DE NATURE le 2026-08-30, avec la rivière organique. L'ancienne comparait les
 * DEUX PAS voisins : sur une polyligne de Manhattan, un coude était un angle droit, et il n'y
 * en avait qu'aux pivots. Sur une courbe rastérisée en pas de Manhattan, le pas change de
 * direction à peu près partout — l'ancienne règle aurait déclaré coude une tuile sur deux, et
 * les coins de pêche de la rivière se seraient posés tout du long.
 *
 * La règle est donc devenue une COURBURE FENÊTRÉE : on compare la direction sur ±`FENETRE` pas,
 * et l'on ne retient que les MAXIMUMS LOCAUX du virage (départage par index — ordre total). Un
 * coude, c'est le sommet d'un méandre : il y en a une poignée par rivière, comme avant, mais
 * cette fois ce sont les vrais.
 *
 * Sans trigonométrie (invariant n°2) : |sin θ| se lit dans le produit vectoriel normalisé.
 */
export function estUnCoude(fil: readonly number[], k: number, width: number): boolean {
  const virage = (j: number): number => {
    const F = COUDE.FENETRE
    if (j - F < 0 || j + F >= fil.length) return -1
    const a = fil[j - F]!
    const b = fil[j]!
    const c = fil[j + F]!
    const ax = a % width
    const bx = b % width
    const cx = c % width
    const ux = bx - ax
    const uy = (b - bx) / width - (a - ax) / width
    const vx = cx - bx
    const vy = (c - cx) / width - (b - bx) / width
    const lu = Math.sqrt(ux * ux + uy * uy)
    const lv = Math.sqrt(vx * vx + vy * vy)
    if (lu === 0 || lv === 0) return -1
    return Math.abs(ux * vy - uy * vx) / (lu * lv)
  }
  const ici = virage(k)
  if (ici < COUDE.SINUS_MIN) return false
  // Maximum local STRICT dans la fenêtre, l'index départageant les ex æquo : un méandre ne
  // rend qu'un coude, et toujours le même quel que soit l'ordre d'interrogation.
  for (let j = k - COUDE.FENETRE; j <= k + COUDE.FENETRE; j++) {
    if (j === k) continue
    const v = virage(j)
    if (v > ici || (v === ici && j < k)) return false
  }
  return true
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
  const racineId = g.racine
  const s = seed ^ 0x45415500 /* 'EAU' */

  // ═══ AUCUNE EAU AUX ABORDS D'UNE PORTE (worldgen R10.3, garde A16) ═══
  //
  // *Un seuil ne nourrit rien — pas même à boire.* MESURÉ (seed 2026, garde A6 rouge, 2026-07-29) :
  // un lac noyait la bouche du seuil 4 sur quarante tuiles d'eau profonde, la sente n'avait plus
  // où se poser, et la porte devenait une plage.
  const horsSeuils = masqueDesSeuils(creux, g, racineId)

  // ═══ L'HYDROLOGIE — DÉRIVÉE, PLUS POSÉE (décision d'Alexis, 2026-08-30) ═══
  //
  // Il n'y a plus ici ni compte de lacs, ni « la » rivière, ni chenaux entre perles : une seule
  // passe lit le drainage du relief et en tire tout — les cuvettes qui retiennent l'eau, les
  // lignes qui la portent, la largeur qui suit le débit, le profond là où c'est profond. Voir
  // `zonegen-hydro.ts`, qui porte la démonstration ; ici on ne fait que l'appeler et lui donner
  // ses voisins (le lapiaz, la frange de marais, les résurgences).
  const hydro = tracerLHydrologie(terrain, zone, racineId, width, height, creux, horsSeuils, s)
  const eaux = hydro.eaux
  // Le FIL au singulier reste le plus gros fleuve : c'est lui que `map.fil` publie, et tout ce
  // qui le lit (le courant du client, la nature de l'eau) n'a pas à savoir qu'il y en a d'autres.
  const riviere = hydro.fils.length > 0 ? { fil: hydro.fils[0]!, coeur: hydro.coeur } : null

  // LE LAPIAZ puis LES RÉSURGENCES — la face sèche et la face humide du même karst. Avant la
  // frange de marais, exprès : une source reçoit ses joncs comme n'importe quelle eau, et rien
  // dans le monde ne dit qu'elle est d'une autre nature.
  poserLesLapiaz(terrain, zone, racineId, width, height, bordure, creux, s)
  frangeDeMarais(terrain, zone, racineId, width, height, s, eaux)
  // LES RÉSURGENCES EN DERNIER, DONC SANS FRANGE DE MARAIS — et ce n'est pas un détail d'ordre.
  // ① Une source karstique est de l'eau CLAIRE qui sort de la roche, pas une vasque de boue :
  //    lui coller des joncs serait faux. ② Et la garde A11 l'a exigé : la frange des mares
  //    inversait le rang à l'eau au bout mouillé, en diluant les deux SEULS terrains du T0 qui
  //    savent où est l'eau. Les servir en dernier règle les deux d'un coup.
  poserLesResurgences(terrain, zone, racineId, width, height, bordure, creux, horsSeuils)
  return { riviere, chenaux: hydro.chenaux, fils: hydro.fils, lacs: hydro.lacs }
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
 * LE CŒUR PROFOND, ÉRODÉ DEPUIS LA RIVE — l'invariant de R45 sur une forme quelconque.
 *
 * BFS multi-source depuis les tuiles du lac qui touchent autre chose que le lac (4-connexité,
 * comme le pathfinder — R23). Toute tuile à `BERGE` pas ou plus de la rive devient profonde ;
 * elle est donc ceinte d'au moins trois tuiles de haut-fond marchable, par construction. Un lac
 * trop étroit n'a aucune tuile assez loin : il reste un plan d'eau franchissable, sans mur.
 */
export function creuserLeCoeur(terrain: number[], tuiles: readonly number[], dansLeLac: ReadonlySet<number>, width: number): void {
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



/** Peint le filet d'eau entre les centres de deux cellules 4-adjacentes, à la demi-largeur du
 *  ruisseau. Les mêmes refus que partout : hors Racine, eau déjà là, mur — on ne noie rien.
 *
 *  `demi` par défaut vaut `EAU.RUISSEAU_DEMI_LARGEUR` : les chenaux entre lacs gardent leur
 *  largeur au bit près. Les rus (`zonegen-rus.ts`) le passent, eux — un réseau de drainage se
 *  lit à sa hiérarchie, et c'est la seule raison pour laquelle ce paramètre existe. */
export function peindreSegment(
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
  demi: number = EAU.RUISSEAU_DEMI_LARGEUR,
): void {
  const M = CREUX.MOTIF
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
 * ═══ LES ISTHMES D'UNE TUILE — deux eaux que rien ne sépare vraiment ═══
 *
 * *(Règle d'Alexis, 2026-08-30 : « si 2 cases d'eau ne sont séparées que par une unique case de
 * terre ferme, tu mets une case d'eau entre les 2, à la bonne profondeur ».)*
 *
 * Une tuile de terre coincée entre deux eaux ne raconte rien : ce n'est ni une berge, ni un
 * passage — c'est un accident de rastérisation. Elle se voyait partout depuis que l'eau est
 * courbe : deux disques estampés qui se frôlent, un ru qui rejoint son lac à une tuile près, une
 * anse dont les deux lèvres se touchent presque. MESURÉ avant la règle (monde joué, 3 graines) :
 * 29 à 35 paires de masses d'eau distinctes séparées par une ou deux tuiles sèches.
 *
 * ═══ « À LA BONNE PROFONDEUR » ═══
 *
 * La tuile comblée prend le HAUT-FOND dès que l'un de ses deux voisins est du haut-fond ; elle
 * ne devient profonde que si les deux le sont. C'est le sens de R45, pas une prudence : le
 * profond est un MUR, et transformer un isthme marchable en mur fermerait un chemin que
 * personne n'a décidé de fermer. `assainirLeProfond` repasse derrière, comme toujours.
 *
 * ═══ UNE SEULE PASSE, SUR UN INSTANTANÉ ═══
 *
 * On lit le terrain d'AVANT et l'on écrit à côté : combler un isthme peut en fabriquer un autre
 * (deux tuiles sèches en diagonale), et une règle qui se relit elle-même s'emballerait le long
 * d'une berge. Une passe, le motif d'origine — déterministe, borné, sans ordre de balayage qui
 * compte.
 */
export function comblerLesIsthmes(
  terrain: number[],
  zone: Int32Array,
  width: number,
  height: number,
  horsSeuils: Uint8Array,
  creux: Creux | null,
): number {
  // On relève d'abord, on écrit ensuite : combler un isthme peut en fabriquer un autre, et une
  // règle qui se relit s'emballerait le long d'une berge. On garde donc la LISTE au lieu de
  // copier la carte — `terrain.slice()` sur 3,75 M de tuiles pesait dans le budget A13.
  const aCombler: { i: number; profond: boolean }[] = []
  const eau = (i: number): boolean => isWater(terrain[i]!)
  let combles = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (eau(i)) continue
      if ((zone[i] ?? -1) < 0) continue //             hors pays : on ne comble pas le vide
      if (TERRAINS[terrain[i]!]?.walkable !== true) continue // un mur n'est pas un isthme
      // A16 : un seuil ne nourrit rien, pas même à boire.
      if (creux) {
        const k = celluleDe(creux, x, y)
        if (k >= 0 && horsSeuils[k] === 0) continue
      }
      // L'isthme : deux eaux qui se font face, à l'horizontale ou à la verticale.
      const h = eau(i - 1) && eau(i + 1)
      const v = eau(i - width) && eau(i + width)
      if (!h && !v) continue
      const voisins = h ? [i - 1, i + 1] : [i - width, i + width]
      aCombler.push({ i, profond: voisins.every((j) => terrain[j] === TERRAIN_DEEP_WATER) })
    }
  }
  for (const { i, profond } of aCombler) {
    terrain[i] = profond ? TERRAIN_DEEP_WATER : TERRAIN_SHALLOW_WATER
    combles += 1
  }
  return combles
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
          //
          // ⚠ ELLE N'EST PLUS UN CARRÉ DE 2×2 (2026-08-30, décision d'Alexis sur l'eau) : c'est
          // un DISQUE de rayon tiré (`FLAQUE_RAYON_MIN`..`MAX`), donc une tache ronde de taille
          // variable. La raison du 2×2 tenait — une case SEULE se rend en losange, le champ
          // d'eau du shader étant filtré — et elle tient toujours : le rayon minimal garantit au
          // moins deux tuiles de large dans les deux axes. Ne noie que de la terre marchable.
          if (hash2(x, y, selFlaque) < EAU.MARAIS_FLAQUE) {
            const rf = EAU.FLAQUE_RAYON_MIN
              + hash2(x, y, (selFlaque ^ 0x52414459) | 0 /* 'RADY' */) * (EAU.FLAQUE_RAYON_MAX - EAU.FLAQUE_RAYON_MIN)
            estamperDisque(x, y, rf, (px, py) => {
              if (px < 0 || py < 0 || px >= width || py >= height) return
              const k = py * width + px
              if (zone[k] !== racineId) return
              if (terrain[k] === TERRAIN_DEEP_WATER) return
              if (TERRAINS[terrain[k]!]?.walkable !== true) return
              terrain[k] = TERRAIN_SHALLOW_WATER
            })
          } else {
            terrain[j] = TERRAIN_MARSH
          }
        }
      }
    }
  }
}
