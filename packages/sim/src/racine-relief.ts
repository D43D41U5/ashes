/**
 * ═══ LE MICRO-RELIEF MUET — la variable d'ORDRE des Prés Bas ═══
 *
 * *Décision d'Alexis, 2026-07-29, sur la carte rendue : « l'enchaînement des biomes ne suit aucune
 * logique et produit un patchwork de rectangles… idem pour l'eau, on a juste posé l'eau sur le
 * patchwork de biome — sauf les marais, qui sont assez logiquement posés. »*
 *
 * LA MESURE QUI A TRANCHÉ (2026-07-29, trois seeds, BFS multi-source depuis l'eau). Distance
 * moyenne à l'eau, par terrain de la Racine, en tuiles :
 *
 *   | seed | marais | roselière | bosquet | herbe | fleuraie | futaie |
 *   |    1 |      3 |         8 |      70 |    83 |       76 |    102 |
 *   |    7 |      3 |         8 |      85 |    93 |       92 |     81 |
 *   |   42 |      3 |         8 |      96 |    92 |      103 |    112 |
 *
 * Deux terrains savent où est l'eau ; tous les autres sont à la même distance, **et leur ordre
 * s'inverse d'une seed à l'autre** (seed 42 : l'herbe est plus près de l'eau que le bosquet). C'est
 * la signature mathématique de l'INDÉPENDANCE. Et ce n'est pas un hasard que les deux terrains qui
 * savent soient précisément ceux qu'Alexis trouve logiques : le marais et la roselière étaient les
 * SEULS terrains du T0 posés par une règle DÉRIVÉE (`frangeDeMarais` relit l'eau déjà peinte).
 *
 *   **Ce qui se lit comme logique, c'est ce qui est DÉRIVÉ. Ce qui se lit comme arbitraire, c'est
 *   ce qui est POSÉ.**
 *
 * Avant : `solDe` composait le sol des Prés Bas avec DEUX bruits indépendants, seuillés — l'un
 * pour la fleuraie, l'autre pour les bosquets, graines différentes, zéro interaction — et l'eau
 * était posée par-dessus par tirage-rejet (`rectPosable` ne demandait que « dans la Racine,
 * marchable, à ≥ 6 tuiles d'une frontière »). Trois systèmes, trois hasards, aucune cause commune.
 *
 * Après : UNE variable, et tout la lit.
 *
 *   micro-relief  →  l'eau va dans les creux  →  l'humidité rayonne de l'eau  →  la végétation
 *   suit l'humidité
 *
 * Le relief est la CAUSE, l'humidité l'EFFET. C'est la seule chaîne qui explique aussi *pourquoi
 * le lac est là* — un champ d'humidité seul aurait ordonné la végétation en laissant l'eau
 * inexpliquée.
 *
 * ═══ IL EST MUET, ET C'EST LE POINT ═══
 *
 * Le champ n'est JAMAIS rendu, jamais stocké dans la carte, jamais lu au runtime : **la carte
 * reste plate** (pivot RimWorld du 2026-07-17 — pas de palier, pas de marche, pas de falaise
 * intra-zone). Il ne vit que le temps de la génération. Ça ne rouvre pas le renversement du §1 de
 * `worldgen.md` (« on génère d'abord un GRAPHE de zones, le terrain en découle ») : le graphe
 * reste roi, il décide encore de tout ce qui est structure — zones, frontières, seuils, paliers.
 * Le relief ne décide que de la CHAIR d'UNE zone, à l'intérieur de ses murs. C'est très exactement
 * ce que R36 laisse ouvert : *« l'élévation flottante [0,1] ne survit que comme DÉRIVÉE. »*
 *
 * ═══ LES SEUILS SONT DES QUANTILES, PAS DES VALEURS ═══
 *
 * `fbm2` a une moyenne de 0,5 et un écart-type d'environ 0,17, mais sa distribution BOUGE d'une
 * seed à l'autre. Seuiller sur une valeur absolue ferait donc varier la composition de la zone
 * d'une carte à l'autre — et une seed sortirait un jour avec 40 % de bois là où le design en veut
 * 14 % (worldgen R7 : *les Prés Bas se reconnaissent à leur CIEL*). On seuille donc sur des
 * QUANTILES du champ réellement tiré : la part de chaque terrain est un CONTRAT, pas un espoir.
 * Le quantile se lit dans un histogramme d'entiers (jamais un tri) — déterministe sans dépendre
 * de la stabilité du tri du moteur.
 *
 * Pur et déterministe : `fbm2`/`hash2`, et `+ - * / sqrt abs floor ceil round sign min max`
 * uniquement (invariant n°2).
 */
import { fbm2 } from './noise'

export const CREUX = {
  /** Le quantum de décision, en tuiles — le MOTIF de `zonegen.ts`. Tout est rectiligne (R32) :
   *  le champ décide, le carré de 8 exécute. */
  MOTIF: 8,

  /** Échelle de la grande ondulation, en tuiles. 300 sur une Racine de ~1400×560 : quatre ou cinq
   *  grandes cuvettes en travers, deux en profondeur. C'est la FORME du fond de vallée. */
  ECHELLE_LARGE: 300,
  /** Échelle du vallonnement de détail — les petits vallons dans les grands. */
  ECHELLE_FINE: 90,
  /** Poids de la fine dans le mélange. Assez pour que deux cuvettes voisines ne soient pas jumelles,
   *  pas assez pour hacher la grande forme (qui est ce qui rend le relief LISIBLE). */
  POIDS_FINE: 0.32,

  // ══ L'EAU — elle va dans les creux ═══════════════════════════════════════════════════════
  /** Part des cellules de la Racine assez basses pour porter un lac. Un lac se creuse dans le
   *  fond d'une cuvette : on ne retient que le dixième le plus bas du pays. */
  PART_BASSIN: 0.1,
  /** Épaisseur de la lame d'eau au-dessus du point bas, en unités d'altitude. C'est elle qui fait
   *  qu'un lac ÉPOUSE sa cuvette : on pose un niveau, on inonde ce qui est dessous. */
  LAME: 0.05,
  /**
   * DE COMBIEN DE `LAME` UN RUISSEAU PEUT-IL ENJAMBER UN SILLON, en sortant de son lac.
   *
   * Le déversoir d'un lac n'est PAS le col réel de sa cuvette : l'inondation est plafonnée
   * (`LAC_MAX_CELLULES`), donc le plan d'eau s'arrête avant d'atteindre le col, et tout ce qui
   * entoure son pourtour MONTE encore. Une première écriture qui exigeait une descente stricte
   * n'a pas peint un seul ruisseau sur toute la carte — l'algorithme était juste, la prémisse
   * était fausse. On accorde donc au filet d'eau de quoi finir de gravir le col avant de couler.
   *
   * 3 → trois lames, soit 0,15 d'altitude : assez pour sortir d'une cuvette plafonnée, trop peu
   * pour escalader un dos. Au-delà, le lac n'a pas d'exutoire, et c'est la bonne réponse.
   */
  FRANCHISSEMENT: 3,

  // ══ L'HUMIDITÉ — elle rayonne de l'eau, et elle stagne dans les creux ═══════════════════
  //
  // L'ÉQUILIBRE ENTRE CES DEUX POIDS EST LE RÉGLAGE DÉLICAT du chantier, et il a été payé à
  // l'œil. Premier essai (eau 0,5 / creux 0,5, portée 8) : les bois se collaient à l'eau à
  // DOUZE tuiles de moyenne quand l'herbe était à cent dix — un liseré sombre autour de chaque
  // lac, pas un bois. Une variable d'ordre trop obéissante ne fabrique pas de la logique, elle
  // fabrique une courbe de niveau. Le creux domine donc : le bois pousse dans les VALLONS,
  // qu'il y ait un lac au fond ou non, et l'eau ne fait que renforcer.
  /** Portée de l'eau, en MOTIFS (× 8 tuiles). 14 → 112 tuiles : une rampe LONGUE, qui décroît
   *  doucement au lieu de dessiner un bord. */
  PORTEE_EAU: 14,
  /** Poids du creux dans l'humidité — l'eau stagne en bas même loin d'un lac. Il DOMINE. */
  POIDS_CREUX: 0.66,
  /** Poids de la proximité de l'eau — un renfort, pas la loi. */
  POIDS_EAU: 0.34,
  /** Amplitude du bruit ajouté à l'humidité. **C'est lui qui empêche la bande.** Sans lui, les
   *  bois formeraient un ruban continu le long de la rivière — un dégradé propre et mort. L'ORDRE
   *  vient du champ, la TEXTURE vient du bruit : c'est le mélange des deux qui fait une lisière
   *  vivante plutôt qu'une courbe de niveau. */
  AMPLITUDE_BRUIT: 0.42,
  /** Échelle de ce bruit, en tuiles. Fin : c'est du grain de lisière, pas une seconde géographie. */
  ECHELLE_BRUIT: 52,

  // ══ LA LECTURE À LA TUILE — ce qui pousse est mou (spec `sol-dessine.md` R1, 2026-08-22) ═══
  //
  // Le champ reste au motif ; c'est sa LECTURE qui descend à la tuile : interpolation bilinéaire
  // entre les centres des quatre cellules voisines, plus un grain fin. Sans le grain, les lignes
  // de niveau d'une interpolation bilinéaire sont des hyperboles entre quatre points — lisses,
  // mais avec des arêtes visibles à chaque centre de cellule. Le grain casse ces arêtes.
  //
  // MESURÉ avant ce chantier (seed 2026, fenêtre 600-760 × 300-420) : 1 408 bords de tache
  // sur 1 408 tombaient sur un multiple de 8 ; un motif fait 40 % de la hauteur d'écran.
  /** Échelle du grain fin, en tuiles. Plus petit que le motif : c'est lui qui dessine le bord. */
  GRAIN_TUILE_ECHELLE: 9,
  /** Amplitude du grain fin (× (fbm − 0,5)). Borné par le haut par R4 (≤ 1 % de tuiles isolées) :
   *  trop fort, la tache devient un semis ; trop faible, l'hyperbole se voit. */
  GRAIN_TUILE_AMPLITUDE: 0.08,

  // ══ LA COMPOSITION — le contrat, en parts du pays ══════════════════════════════════════
  //
  // Les Prés Bas sont un PRÉ : on s'y reconnaît à son CIEL (worldgen R7, palette `pres_bas`).
  // Mesuré avant ce chantier : 66 % d'herbe, 9-10 % de bosquets, 5 % de fleuraie — soit deux
  // tiers de la zone en un seul aplat. On rééquilibre SANS fermer le ciel : le bois monte à 14 %
  // (il était à 9-10 %, mais il était partout ; il est désormais quelque part), et la fleuraie
  // triple — sur les DOS SECS, qui sont la partie la plus ouverte du pays.
  /**
   * L'ÉCHELLE À CINQ ÉTAGES (spec t0-exploration §2ter R32, décision d'Alexis 2026-08-15) :
   * prairie humide (le plus mouillé) → bosquet → herbe → fleuraie → lande à genévriers (le
   * plus sec). Même champ, mêmes quantiles, un seul ordre — les deux mots neufs sont des
   * étages de la même échelle, pas des bruits de plus.
   */
  /** Part de PRAIRIE HUMIDE — le quantile le PLUS humide : les fonds mal drainés, l'auréole
   *  des eaux au-delà du marais franc. Comme `PART_BOIS`, visée un peu haut : les cellules les
   *  plus mouillées sont souvent déjà de l'eau ou du marais, que la passe ne repeint pas. */
  PART_PRAIRIE: 0.1,
  /** Part de bosquet — le quantile HAUT de l'humidité, SOUS la prairie humide. Visé un peu
   *  HAUT à dessein : le quantile porte sur toutes les cellules de la Racine, mais la passe ne
   *  repeint que le thème du pré — or les cellules les plus humides sont justement celles que
   *  l'eau et le marais occupent déjà. 0,18 de quantile rend ~13 % de bosquet réel (MESURÉ). */
  PART_BOIS: 0.18,
  /** Part de fleuraie — le quantile BAS, AU-DESSUS de la lande. Les dos secs et ensoleillés. */
  PART_FLEURAIE: 0.16,
  /** Part de LANDE À GENÉVRIERS — le quantile le PLUS sec : les dos hauts, l'écrin des
   *  conifères de crête. Id neuf (`juniper_heath`) : `heath` reste le mot du gradient sud. */
  PART_LANDE: 0.08,

  // ══ LA SAULAIE — le bois de l'eau qui COULE (spec §2ter R33) ═══════════════════════════
  //
  // Elle ne sort pas de l'échelle d'humidité : elle DÉRIVE du réseau — le fil de la rivière
  // et les chenaux entre lacs, publiés par le module d'eau. Cœur plein contre la berge,
  // frange effilochée au hash positionnel ('RIPI') : une galerie d'arbres qui dessine le
  // réseau à travers le pré, pas un ruban au cordeau.
  /** Rayon PLEIN autour du fil de LA rivière, en tuiles (Chebyshev). Le lit fait 7 tuiles de
   *  large (demi-largeur 3) : 7 couvre l'eau + ~4 tuiles de berge boisée de chaque côté. */
  RIPI_FIL_PLEIN: 7,
  /** Rayon de FRANGE du fil — entre plein et frange, un motif sur deux environ bascule.
   *  11 (et non 9) : à 9, la saulaie sortait à 1,4 % de la Racine pour une cible de 2-6 —
   *  une galerie se voit de loin ou n'est pas (MESURÉ, seed 2026). */
  RIPI_FIL_FRANGE: 11,
  /** Rayons des CHENAUX entre lacs (filets d'eau étroits) : une galerie plus modeste. */
  RIPI_RU_PLEIN: 4,
  RIPI_RU_FRANGE: 8,
  /** Chance qu'un bloc de MOTIF de la frange bascule en saulaie — haché par bloc de
   *  `RELIEF.MOTIF` (voir `zonegen.ts`), pas par tuile : la frange s'effiloche par touffes. */
  RIPI_BASCULE: 0.45,

  // ══ LA PROFONDEUR INTRA-MASSIF — lisière, corps, cœur (spec §2quater R38-R39) ════════════
  //
  // La distance au bord de son massif boisé (érosion 8-connexe, `profondeur.ts`), et les
  // trois bandes qui s'en dérivent. Géométrie : se règle en REGARDANT une carte — combien de
  // rangs fait une lisière, à partir d'où un bois devient un cœur.
  /** Bande de LISIÈRE : 1 ≤ d ≤ ce seuil. */
  PROF_LISIERE: 2,
  /** Bande de CŒUR : d ≥ ce seuil. Le cœur se MÉRITE par la taille : un massif plus petit
   *  que (2·PROF_COEUR−1)² tuiles n'en a pas, par construction. */
  PROF_COEUR: 5,
  /** Plafond du champ stocké — le rendu veut une pente continue un peu au-delà du cœur. */
  PROF_CAP: 8,

  // ══ LES BOSQUETS DE CRÊTE — le bois SEC, et le seul repère du haut pays ═══════════════════
  //
  // *Demande d'Alexis, 2026-07-29 : « il faudrait quelques patchs de forêt déposés de manière
  // équilibrée loin des points d'eau ».*
  //
  // LA MESURE QUI A DIT POURQUOI, et elle corrige l'hypothèse évidente : ce n'est PAS une pénurie
  // de bois (au pire on est à 52 tuiles d'un arbre, une écran et demi — personne n'est bloqué).
  // C'est que la FLEURAIE ne porte pas un seul arbre — `arbresDeLaRacine` sème sur l'herbe et
  // dans la futaie, et s'arrête là (« ce sol garde sa nature ») — et que la fleuraie vient de
  // passer de 32-38 k à 86-103 k tuiles. Le trou existait déjà ; il était un moucheté de 5 %,
  // donc invisible. Il est devenu 13,5 % en plaques cohérentes, donc **un endroit** — et un
  // endroit sans une seule verticale, où rien ne casse l'horizon et rien n'appelle à marcher.
  //
  // LE BOSQUET COIFFE UNE BOSSE — c'est le lac à l'envers, et c'est ce qui le garde DÉRIVÉ. On
  // ne saupoudre pas des patchs avec une graine de plus : ce serait réintroduire exactement le
  // « posé » que ce chantier a retiré. On prend le point HAUT, on pose un chapeau, on garde ce
  // qui dépasse. Le lac inonde par en dessous, le bosquet coiffe par au-dessus, même champ.
  //
  // ET C'EST VRAI DU PAYSAGE, ce qui fait que les deux bois racontent deux choses : dans une
  // vallée habitée, le fond plat se fauche pour le foin, et le bois ne survit que sur les bosses
  // que personne ne pouvait dégager. Ripisylve en bas, bois sec en haut.

  /** Pas de la grille de semis, en CELLULES de motif. 36 → 288 tuiles : sur une Racine de
   *  178×70 cellules, une dizaine de cases, donc une dizaine de bosquets RÉGULIÈREMENT écartés.
   *  C'est le « de manière équilibrée » : la couverture est garantie par la grille, et c'est le
   *  RELIEF qui choisit où dans la case — jamais un tirage. */
  CRETE_PAS: 36,
  /**
   * Épaisseur du chapeau sous le sommet, en unités d'altitude. Le miroir de `LAME`.
   *
   * ⚠ **CE NOMBRE EST UN CHOIX DE RENDU EN ATTENTE, et il est chiffré** (2026-08-30). Le socle
   * érodé (pays endoréique) taille des sommets plus étroits que les bosses molles du fbm : la
   * MÊME épaisseur y coiffe deux fois moins de terrain — MESURÉ sur le monde joué, les conifères
   * (`pine`+`larch`+`old_growth`) tombent de **2,1 % à 0,95 %** de la carte. À `0.1` ils
   * reviennent à 1,9-2,2 %, la part d'avant le chantier. On GARDE 0,045 parce que c'est la carte
   * qu'Alexis a validée sur planches rendues, et qu'on ne change pas un rendu approuvé par un
   * effet de bord ; le rendre à sa part d'avant est une décision de DA à prendre à l'œil.
   * *(Éprouvé et écarté comme correctif du tétras : à 0,1, l'oiseau reste absent d'une graine
   * sur quatre — ce n'est pas la surface de bois qui manque, ce sont les coins de chasse au
   * bois. Voir `envol.test.ts` R21.)*
   */
  CHAPEAU: 0.045,
  /** Taille maximale d'un bosquet, en cellules de motif (× 64 tuiles). 20 → ~1 280 tuiles,
   *  36 de côté : un bois qu'on traverse en un écran, pas une seconde Sylve. */
  CRETE_MAX_CELLULES: 20,
  /**
   * L'AMPLITUDE DU GRAIN DU CONTOUR d'un bosquet, en unités d'altitude — ce qui DENTELLE sa
   * ligne de niveau (`sol-dessine.md` R23, 2026-08-27).
   *
   * Même champ que la butte d'affleurement (`altLarge`), donc le même ordre de grandeur que
   * `AFFL_GRAIN_CONTOUR` — et surtout PAS celui du pré (0,08, sur l'humidité) : le chapeau ne
   * fait que `CHAPEAU` = 0,045 d'épaisseur, un grain de cet ordre-là le mettrait en miettes.
   */
  CRETE_GRAIN_CONTOUR: 0.012,

  // ══ LES AFFLEUREMENTS — la géologie donne le minerai (spec t0-exploration §2sexies, R47) ═══
  //
  // MONDE RÉDUIT SEULEMENT. Même famille que les bosquets de crête — le chapeau sur la bosse —
  // mais l'élection est PAR RANG GLOBAL (les quelques dos les plus hauts du pays, pas une
  // couverture par grille) : un affleurement est un événement géologique, pas un semis.
  /** L'ordre des identités, du meilleur rang au dernier : les buttes élues se nomment dans cet
   *  ordre. Trois ferreuses, deux charbonneuses — R51 fait de ce tableau le PLANCHER garanti.
   *  3+2 (décision d'Alexis 2026-08-18, « on va augmenter le nombre de buttes ») : à 2+1,
   *  32 charbons par passage bornaient la carte à UN village équipé — mesuré contre les
   *  recettes (1 lingot = 2 minerais + 1 charbon, l'acier consomme 1:1). Les deux identités
   *  neuves s'APPENDENT : les trois premières buttes gardent leurs sommets sur toute seed
   *  existante, et le charbon (le goulot) prend le meilleur des nouveaux rangs. */
  AFFL_IDENTITES: ['fer', 'fer', 'charbon', 'charbon', 'fer'] as const,

  /**
   * ═══ LES BUTTES NUES — celles qui ne promettent rien ═══
   *
   * *Décision d'Alexis, 2026-08-31 : « vas-y pour les buttes nues, on veut A26 à 90 % ».* Les
   * cinq buttes à minerai ne suffisent pas à peupler le pays : une fois leur sommet mué en roche,
   * la garde **A26** — *« depuis n'importe où, une paroi est à moins de quatre écrans »* — passait
   * de 53,3 % à 67,1 % des tuiles seulement (MESURÉ, monde joué, graine 2026). Cinq buttes
   * achètent quatorze points ; il en faut donc d'autres, et elles ne peuvent pas porter de
   * minerai — sans quoi le monde réduit deviendrait une mine à ciel ouvert.
   *
   * Une butte nue est le MÊME objet, sans son registre : même élection au plus haut sommet libre,
   * même croissance à la tuile, même chapeau de roche, même jupe de pierrier — mais elle n'entre
   * pas dans `map.affleurements`, donc ni minerai, ni blocs, ni mouchetures de rouille côté
   * client. C'est un accident de terrain, pas une promesse de gisement.
   *
   * ⚠ **ELLES S'APPENDENT, ET C'EST LA RÈGLE DE LA MAISON** : les buttes à minerai s'élisent
   * d'abord, dans leur ordre, et gardent donc leurs sommets sur toute graine. Monter ce nombre ne
   * déplace pas une mine.
   *
   * ⚠ **LEUR SEUL CRAN EST « TOUTE ROCHE »** : le fer veut du granite et la houille de l'argile,
   * mais une butte qui ne donne rien n'a aucune raison de préférer une province. Elle prend le
   * plus haut sommet qui reste, point.
   */
  AFFL_NUES: 60,

  /**
   * L'écartement des buttes NUES, en cellules de motif — plus serré que celui des mines.
   *
   * MESURÉ, et c'est ce qui a fait exister cette constante : à `AFFL_ECART` (30 cellules = 240
   * tuiles), **A26 sature à 81 %** dès dix buttes nues — en ajouter douze, ou vingt-quatre, ne
   * change plus rien : le pays est plein, l'élection ne trouve plus de sommet assez loin des
   * précédents. Le plafond n'est pas un compte, c'est une GÉOMÉTRIE : à l'écartement `e`, le
   * point le plus mal loti d'un maillage est à `e/√2` d'une butte ; pour tenir quatre écrans
   * (142 tuiles) il faut donc `e ≤ 200` tuiles, soit 25 cellules.
   *
   * On ne touche PAS à `AFFL_ECART` : deux mines qui se touchent, c'est une décision de jeu
   * (*« deux affleurements de la même ressource ne se touchent pas »*). Les buttes nues, elles,
   * ne promettent rien — elles peuvent se serrer.
   */
  AFFL_ECART_NUES: 15,
  /** Épaisseur du chapeau sous le sommet. Plus mince que `CHAPEAU` : la roche ne perce qu'au
   *  ras de l'os, une rocaille n'est pas une colline entière. */
  AFFL_CHAPEAU: 0.03,
  /**
   * ═══ LA TAILLE D'UNE BUTTE, EN TUILES (et plus en cellules de motif) ═══
   *
   * 320 = ce que valaient les 5 cellules d'avant : **l'aire ne bouge pas**, seule sa FORME
   * change. La butte croît maintenant tuile à tuile, en prenant toujours la plus haute de sa
   * frontière ; son contour est donc la ligne de niveau qui enferme exactement ces 320 tuiles —
   * organique par construction, comme celui du lapiaz (`roche-mere.md` R6bis). Avant, elle
   * empilait 2 à 5 carrés de 8×8 : **100 % de ses segments de bord faisaient ≥ 8 tuiles**.
   *
   * ⚠ Ce plafond est aussi ce qui BORNE la butte : sans lui, la ligne de niveau courrait le long
   * de toute la crête. C'est le rôle que tenait `AFFL_MAX_CELLULES`.
   */
  AFFL_TUILES: 320,

  /**
   * ═══ LE SOMMET EST DE LA ROCHE : la butte redevient une MESA ═══
   *
   * *Décision d'Alexis, 2026-08-31 : « vas-y pour les buttes ».* Elles existaient déjà — cinq
   * affleurements semés dans le monde joué, le plus proche à **74 tuiles du spawn (2,1 écrans)**
   * — mais **entièrement MARCHABLES** : MESURÉ, 0 tuile bloquante sur les 442 à 936 de leur boîte.
   * C'était de la géologie posée à plat, pas du relief. Rien à voir de loin, rien à contourner,
   * rien à longer.
   *
   * Les `AFFL_SOMMET_TUILES` premières tuiles de la croissance — donc les plus HAUTES, et connexes
   * par construction (la croissance part du sommet) — deviennent de la roche infranchissable. Le
   * reste garde son pierrier : la butte a un chapeau et une jupe, exactement la silhouette d'une
   * mesa, et c'est la jupe qui porte le minerai (les nœuds se posent sur du marchable).
   *
   * 96 sur 320, soit un chapeau d'une dizaine de tuiles de côté : assez large pour que son bord
   * sud porte une paroi (il faut trois rangées de roche, `RELIEF.PAROI_RANGEES` + 1), assez petit
   * pour qu'on en fasse le tour sans s'ennuyer. ⚠ Une butte est CONVEXE : elle ne coupe rien, à la
   * différence d'une terrasse dont la ligne de niveau se referme (MESURÉ : murer les paliers du
   * monde joué laisse 70 poches et une composante principale à 27 %).
   */
  AFFL_SOMMET_TUILES: 96,
  /**
   * LA LARGEUR DE LA RAMPE d'une mesa, en tuiles (spec `etages.md` §9) — le seul réglage des
   * étages qui se calibre EN REGARDANT UNE CARTE, donc il vit ici et non dans `balance.ts`.
   *
   * ⚠ **3 ET NON 1, ET C'EST MESURÉ.** À une tuile, le semis des nœuds — qui tourne APRÈS le
   * worldgen et ne sait donc rien des rampes — posait un rocher ou un arbre SUR la porte :
   * **0 / 1 / 3 / 1** rampes murées sur les graines 2026 / 7 / 4242 / 99, et un nœud bloquant
   * scelle un passage d'une tuile pour un corps de 0,75. E-R9 (« tout étage est atteignable »)
   * tombait alors en silence, sur une mesa sur cinquante. Élargir coûte zéro tuile repeinte et
   * zéro tirage ; retirer des tuiles au semis aurait décalé le flux RNG.
   *
   * Impair : la rampe est centrée sur la tuile élue (la plus au sud, puis la plus à l'ouest).
   */
  RAMPE_LARGEUR: 3,

  /**
   * ═══ LA CAVE — ce qu'une mesa cache sous son chapeau (spec `etages.md`, la branche B1) ═══
   *
   * *« On est dehors, une gueule s'ouvre dans la paroi »* — c'est la phrase de §10, et elle
   * décrivait déjà l'objet. La cave se creuse donc DANS CE QU'ON A : une butte a un chapeau de
   * roche, une paroi tournée au sud, et une jupe où l'on marche. On lui ajoute une **gueule** dans
   * cette paroi et une salle à l'étage **−1** sous son chapeau. Aucune géométrie neuve, aucun lieu
   * posé ailleurs : la mesa cesse d'avoir une seule réponse (*on la monte*) pour en avoir deux
   * (*on la monte, ou on y entre*).
   *
   * ⚠ **AUCUN TIRAGE** (E-R15) : le choix des buttes creusées et la forme de la salle sortent
   * d'un hash POSITIONNEL salé (`'CAVE'`), jamais du PRNG de la partie — un décompte d'entités
   * qui change décale le flux et casse des tests sans rapport, c'est le piège documenté du dépôt.
   */
  /** Une butte sur quatre est creuse. Assez pour qu'on en rencontre, assez peu pour qu'en
   *  trouver une compte — sur les ~50 mesas du monde joué, une douzaine de caves. */
  CAVE_PART: 0.25,
  /**
   * La salle, en tuiles. ⚠ **ELLE DOIT DÉPASSER `TEMPERATURE.CIEL_PENETRATION` DANS TOUTES LES
   * DIRECTIONS**, sinon le jour la traverse de part en part et la loi d'obscurité (E-R13) n'a
   * rien à mordre : une cave qu'on éclaire depuis le seuil n'est pas une cave, c'est un porche.
   * 40 sur les 96 tuiles d'un chapeau : une salle qu'on explore, pas un couloir.
   */
  CAVE_TUILES: 40,
  /** L'amplitude du grain de contour, en unités d'altitude — ce qui DENTELLE la ligne de niveau.
   *  Calibrée en mesurant la dentelle EN TUILES (le grain d'`altLarge` n'est pas celui de la
   *  marge du lapiaz : la même amplitude n'y donne pas la même ondulation). */
  AFFL_GRAIN_CONTOUR: 0.012,
  /**
   * ═══ CE QUI EMPÊCHE LA BUTTE DE S'ÉTIRER EN RUBAN ═══
   *
   * « Prendre toujours la plus haute » suit la CRÊTE : vu en jeu, la butte devenait un filet de
   * cinq tuiles de large sur soixante de long, noyé entre les arbres — 320 tuiles dans une boîte
   * de 28×62, soit **18 % de remplissage**. Or la spec en demande *« un genou de roche qu'on
   * remarque dans le pré »*, et une tache qu'on remarque est une tache COMPACTE.
   *
   * On pénalise donc l'altitude par l'éloignement au sommet, en unités du rayon qu'aurait la
   * butte si elle était ronde (√(`AFFL_TUILES`/π) ≈ 10 tuiles). C'est un poids, pas une borne :
   * la ligne de niveau garde le dernier mot sur la forme locale — ce qui est haut et proche est
   * pris avant ce qui est haut et loin.
   */
  AFFL_COMPACITE: 0.05,
  /** Écart minimal entre deux buttes, en cellules de motif. 30 → 240 tuiles : deux affleurements
   *  dans le même écran seraient un seul gisement qui ment. */
  AFFL_ECART: 30,
  /**
   * Combien de sommets on essaie avant de se contenter du meilleur (2026-08-30). Un sommet cerné
   * par l'eau ne peut pas faire pousser son chapeau : la croissance s'arrête faute de frontière
   * et la butte sort en confetti (MESURÉ : 92 tuiles sur 320, graine 2026, et pas une pierre de
   * taille dedans). On ré-élit, en brûlant le bassin essayé — la TAILLE d'une butte ne cède pas,
   * au même titre que le COMPTE (l'ordre des crans de `poserLesAffleurements`).
   */
  AFFL_ESSAIS: 8,
  /**
   * Le remplissage minimal de sa boîte englobante qu'on exige d'une butte pour l'accepter
   * (2026-08-30). Même cause que `AFFL_ESSAIS`, autre symptôme : contre une rive, la croissance
   * CONTOURNE l'eau — la butte fait bien ses 320 tuiles, mais en croissant, et sa boîte tombe à
   * **17-20 % de remplissage** (MESURÉ, graines 2026 et 42). Monter `AFFL_COMPACITE` ne l'a pas
   * corrigé (0,02 → 0,08 : la médiane monte de 44 à 52 %, les deux buttes cernées restent à 17 %) :
   * ce n'est pas un défaut de poids, c'est un mauvais ENDROIT. On ré-élit, comme pour la taille.
   */
  AFFL_REMPLISSAGE: 0.28,
} as const

/**
 * Le champ, à la maille du MOTIF, sur le rectangle de la Racine.
 *
 * Structure LOCALE À LA GÉNÉRATION : elle ne va jamais dans `SimState` ni dans `WorldMap` (d'où
 * les tableaux typés, interdits d'état de sim mais parfaits ici).
 */
export interface Creux {
  /** Origine de la grille, en MOTIFS (coordonnée tuile ÷ MOTIF, plancher). */
  mx0: number
  my0: number
  cols: number
  rows: number
  /** L'altitude de chaque cellule, [0,1]. Basse = creux. Deux octaves — c'est elle que lit la
   *  végétation, qui a besoin du détail. */
  alt: Float64Array
  /**
   * LA GRANDE ONDULATION SEULE — et c'est elle, et elle seule, qui creuse les lacs.
   *
   * Payé à l'œil (2026-07-29, première carte rendue) : inonder le champ à DEUX octaves donnait des
   * lacs FILANDREUX — des tentacules, pas des plans d'eau. La faute est géométrique et vaut d'être
   * écrite : la ligne de niveau d'un champ lisse près d'un minimum est une ellipse, donc compacte ;
   * l'octave fine (échelle 90) y creuse des rigoles étroites qui se connectent, et l'inondation les
   * enfile au lieu de remplir la cuvette. **On inonde donc la forme, pas le grain.**
   */
  altLarge: Float64Array
  /** La cellule est-elle dans la Racine ? (centre du motif). Le reste ne compte dans aucun quantile. */
  dedans: Uint8Array
  /** Distance à l'eau, en MOTIFS. −1 = pas d'eau atteignable. Rempli par `mesurerLaDistanceALEau`. */
  distEau: Int32Array
  /** L'humidité de chaque cellule. Remplie par `composerLHumidite`. */
  hum: Float64Array
  /** Altitude sous laquelle une cellule peut porter un lac (quantile `PART_BASSIN`). */
  seuilBassin: number
  /** Humidité au-dessus de laquelle : PRAIRIE HUMIDE (quantile `1 − PART_PRAIRIE`). */
  seuilPrairie: number
  /** Humidité au-dessus de laquelle : bosquet (quantile `1 − PART_PRAIRIE − PART_BOIS`). */
  seuilBois: number
  /** Humidité en dessous de laquelle : fleuraie (quantile `PART_LANDE + PART_FLEURAIE`). */
  seuilFleuraie: number
  /** Humidité en dessous de laquelle : LANDE À GENÉVRIERS (quantile `PART_LANDE`). */
  seuilLande: number
  /** Le sel du grain fin de la lecture à la tuile (`humAt`). Posé par `composerLHumidite`. */
  selGrain: number

  // ══ LA ROCHE-MÈRE — le SECOND axe (spec `roche-mere.md` R1-R3) ═══════════════════════════
  /** Le champ de roche par cellule, [0,1]. Rempli par `composerLaRoche`. */
  roche: Float64Array
  /** Sous ce seuil : CALCAIRE (quantile `ROCHE.PART_CALCAIRE`). */
  seuilCalcaire: number
  /** Au-dessus : ARGILE (quantile `1 − ROCHE.PART_ARGILE`). Entre les deux : granite. */
  seuilArgile: number
}

/**
 * ═══ LA ROCHE-MÈRE — le second axe des Prés Bas (spec `roche-mere.md`) ═══
 *
 * Le vocabulaire du pré tenait sur UN rang : `d(marais) < … < d(lande)` (critère A16). Sept mots,
 * un ordre total, une seule variable — donc un biome à sept niveaux d'humidité, prédictible d'un
 * bout à l'autre du pays par une seule question. La roche est le second axe : elle ne peint AUCUN
 * terrain, elle **module** ceux qui existent.
 *
 * ⚠ **L'ÉCHELLE EST LA RÈGLE, pas un réglage de confort.** 520 tuiles, soit PLUS que les 300 de
 * l'ondulation d'humidité : une province doit TRAVERSER le gradient, jamais le suivre. À une
 * échelle plus fine on obtiendrait un patchwork corrélé à l'humidité — c'est-à-dire rien.
 *
 * Pur et déterministe : `fbm2` à sel dédié (`'ROCH'`), aucun PRNG partagé (la leçon RNG).
 */
export const ROCHE = {
  /** Échelle du champ, en tuiles. ~14 écrans : on met plusieurs sessions à traverser un pays. */
  ECHELLE: 520,
  /** Part de CALCAIRE (drainant) — le quantile bas. */
  PART_CALCAIRE: 0.32,
  /** Part d'ARGILE/marne (retenant) — le quantile haut. Le granite est le reste. */
  PART_ARGILE: 0.32,
  /**
   * LE DÉCALAGE DE DRAINAGE, en unités du champ d'humidité, appliqué AVANT le seuillage.
   *
   * ⚠ **IL DOIT ENTRER DANS `c.hum` AVANT LES QUANTILES**, et c'est ce qui rend le chantier
   * franc : les seuils se redérivent sur le champ décalé, donc la COMPOSITION du pays ne bouge
   * pas d'un dixième (A1) — seules les ADRESSES changent. Décaler après les seuils ferait
   * dériver les parts et rougir A12/A17 pour rien.
   */
  DRAINAGE: 0.085,
  /** L'espacement des résurgences au contact du calcaire, en tuiles (R7). */
  SOURCE_ESPACEMENT: 90,
  /**
   * LA PART BASSE DU PAYS où une source peut sortir (quantile d'altitude).
   *
   * ⚠ **CE N'EST PAS UN CONFORT DE CALIBRAGE, C'EST CE QUI SAUVE A14.** Sans lui les sources
   * tombaient aussi sur les DOS SECS — le pays même que les bosquets de crête tiennent pour
   * sec — et le pin passait de ~176 tuiles de l'eau à **96**, sous le triple exigé. Une
   * résurgence est un point BAS par définition : l'eau ne ressort pas en haut.
   */
  SOURCE_PART_BASSE: 0.42,
  /** Le rayon d'une résurgence, en tuiles (Chebyshev) : une mare, pas un lac. */
  SOURCE_RAYON: 3,
} as const

/** Le sel du champ de roche — dédié, jamais partagé. */
const SEL_ROCHE = 0x524f4348 /* 'ROCH' */

/**
 * LA FAMILLE D'UNE CELLULE : −1 calcaire (drainant) · 0 granite (neutre) · +1 argile (retenant).
 * Le SIGNE est le sens physique : le calcaire assèche, l'argile retient.
 */
export function familleDeCellule(c: Creux, k: number): -1 | 0 | 1 {
  const r = c.roche[k]!
  return r < c.seuilCalcaire ? -1 : r > c.seuilArgile ? 1 : 0
}

/** La famille sous une TUILE — la cellule qui la contient. */
export function familleAt(c: Creux, x: number, y: number): -1 | 0 | 1 {
  const k = celluleDe(c, x, y)
  return k < 0 ? 0 : familleDeCellule(c, k)
}

/**
 * COMPOSE LE CHAMP DE ROCHE et fixe ses deux seuils, par quantile.
 *
 * À appeler AVANT `placerLacs` (le calcaire n'inonde pas) et avant `composerLHumidite` (le
 * drainage entre dans l'humidité). Comme tous les seuils du worldgen : des QUANTILES du champ
 * réellement tiré, jamais des valeurs — la part de chaque roche est un contrat.
 */
export function composerLaRoche(c: Creux, seed: number): void {
  const M = CREUX.MOTIF
  const sel = (seed ^ SEL_ROCHE) | 0
  for (let my = 0; my < c.rows; my++) {
    for (let mx = 0; mx < c.cols; mx++) {
      const tx = (c.mx0 + mx) * M + M / 2
      const ty = (c.my0 + my) * M + M / 2
      c.roche[my * c.cols + mx] = fbm2(tx, ty, ROCHE.ECHELLE, sel)
    }
  }
  c.seuilCalcaire = seuilParQuantile(c.roche, c.dedans, ROCHE.PART_CALCAIRE, -0.5, 1.5)
  c.seuilArgile = seuilParQuantile(c.roche, c.dedans, 1 - ROCHE.PART_ARGILE, -0.5, 1.5)
}

// (`ondulation` et `grain` vivent désormais dans `socle.ts` — mêmes sels, mêmes valeurs : le
// socle recompose le champ historique de la Racine à l'identique, puis l'épingle comme niveau
// de base de l'érosion. `releverLeCreux` — la version confinée au rectangle de la Racine — est
// remplacé par `batirLeSocle` depuis la Stratigraphie, 2026-08-09.)

/**
 * LE SEUIL PAR QUANTILE — par HISTOGRAMME, jamais par tri.
 *
 * Rend la valeur T telle qu'environ `part` des cellules actives soient sous T. Mille vingt-quatre
 * seaux d'entiers : déterministe au bit près sans rien devoir à la stabilité du tri du moteur JS
 * (invariant n°2), et une seule passe. Exporté : le socle (couche I) et les compositions par
 * zone (couche II) contractualisent leurs parts avec le même instrument.
 */
export function seuilParQuantile(vals: Float64Array, actifs: Uint8Array, part: number, lo: number, hi: number): number {
  const SEAUX = 1024
  const hist = new Int32Array(SEAUX)
  let n = 0
  const etendue = hi - lo
  for (let k = 0; k < vals.length; k++) {
    if (actifs[k] === 0) continue
    let b = Math.floor(((vals[k]! - lo) / etendue) * SEAUX)
    if (b < 0) b = 0
    if (b >= SEAUX) b = SEAUX - 1
    hist[b]!++
    n++
  }
  if (n === 0) return lo
  const cible = Math.floor(n * part)
  let cum = 0
  for (let b = 0; b < SEAUX; b++) {
    cum += hist[b]!
    if (cum > cible) return lo + ((b + 1) / SEAUX) * etendue
  }
  return hi
}

/** L'index de la cellule qui contient la tuile (x, y) — ou −1 hors grille. */
export function celluleDe(c: Creux, x: number, y: number): number {
  const mx = Math.floor(x / CREUX.MOTIF) - c.mx0
  const my = Math.floor(y / CREUX.MOTIF) - c.my0
  if (mx < 0 || my < 0 || mx >= c.cols || my >= c.rows) return -1
  return my * c.cols + mx
}

/**
 * L'ALTITUDE HYDROLOGIQUE en une tuile — la GRANDE ondulation, lue au motif.
 *
 * Tout ce qui coule la lit : le creusement des lacs, le sens de l'écoulement d'un ruisseau, le
 * choix de la source et de l'embouchure. **L'eau suit la forme du pays, pas son grain** — c'est
 * la même leçon que les lacs filandreux, à l'échelle du réseau. La végétation, elle, lit `alt`
 * (deux octaves) : elle a besoin du détail.
 *
 * 1 (le point le plus haut) hors grille : rien ne s'y creuse, rien n'y coule.
 */
export function altitudeAt(c: Creux, x: number, y: number): number {
  const k = celluleDe(c, x, y)
  return k < 0 ? 1 : c.altLarge[k]!
}

/**
 * LA DISTANCE À L'EAU, en motifs — un BFS multi-source sur la grille du motif.
 *
 * Onze mille cellules au lieu de sept cent mille tuiles : c'est la même maille que tout le reste
 * de la carte, et c'est quatre-vingts fois moins cher. 4-connexité, comme le pathfinder (R23).
 */
export function mesurerLaDistanceALEau(
  c: Creux,
  estEau: (x: number, y: number) => boolean,
): void {
  const M = CREUX.MOTIF
  c.distEau.fill(-1)
  let file: number[] = []
  for (let my = 0; my < c.rows; my++) {
    for (let mx = 0; mx < c.cols; mx++) {
      const k = my * c.cols + mx
      if (estEau((c.mx0 + mx) * M + M / 2, (c.my0 + my) * M + M / 2)) {
        c.distEau[k] = 0
        file.push(k)
      }
    }
  }
  let d = 0
  while (file.length > 0) {
    const suivante: number[] = []
    for (const k of file) {
      const kx = k % c.cols
      const ky = (k - kx) / c.cols
      if (kx > 0) pousser(c, suivante, ky * c.cols + kx - 1, d + 1)
      if (kx + 1 < c.cols) pousser(c, suivante, ky * c.cols + kx + 1, d + 1)
      if (ky > 0) pousser(c, suivante, (ky - 1) * c.cols + kx, d + 1)
      if (ky + 1 < c.rows) pousser(c, suivante, (ky + 1) * c.cols + kx, d + 1)
    }
    file = suivante
    d++
  }
}

function pousser(c: Creux, file: number[], k: number, d: number): void {
  if (c.distEau[k] !== -1) return
  c.distEau[k] = d
  file.push(k)
}

/**
 * COMPOSE L'HUMIDITÉ — et fixe les deux seuils de végétation, par quantile.
 *
 * À appeler APRÈS `mesurerLaDistanceALEau`. L'humidité mêle trois termes :
 *   — le CREUX (l'eau stagne en bas, même loin d'un lac),
 *   — la PROXIMITÉ de l'eau (la nappe rayonne),
 *   — un BRUIT fin, qui casse la bande (voir `AMPLITUDE_BRUIT`).
 */
export function composerLHumidite(c: Creux, seed: number): void {
  const M = CREUX.MOTIF
  const sel = (seed ^ 0x48554d49) | 0 /* 'HUMI' */
  c.selGrain = (seed ^ 0x47524149) | 0 /* 'GRAI' */
  for (let my = 0; my < c.rows; my++) {
    for (let mx = 0; mx < c.cols; mx++) {
      const k = my * c.cols + mx
      const tx = (c.mx0 + mx) * M + M / 2
      const ty = (c.my0 + my) * M + M / 2
      const d = c.distEau[k]!
      // Rampe LINÉAIRE (pas d'`exp` : invariant n°2). Hors d'atteinte de l'eau : zéro.
      const proche = d < 0 ? 0 : Math.max(0, 1 - d / CREUX.PORTEE_EAU)
      const bas = 1 - c.alt[k]!
      const grain = fbm2(tx, ty, CREUX.ECHELLE_BRUIT, sel) - 0.5
      // LE SECOND AXE (spec `roche-mere.md` R4) : le calcaire draine, l'argile retient. Il entre
      // ICI, AVANT les quantiles — c'est ce qui laisse la composition intacte pendant que les
      // adresses bougent (A1). Le granite vaut 0 : le monde d'aujourd'hui, au bit près.
      const drainage = familleDeCellule(c, k) * ROCHE.DRAINAGE
      c.hum[k] = bas * CREUX.POIDS_CREUX + proche * CREUX.POIDS_EAU + grain * CREUX.AMPLITUDE_BRUIT + drainage
    }
  }
  // Les seuils sont des quantiles du champ RÉELLEMENT tiré : la composition est un contrat.
  // Bornes larges (l'humidité peut sortir de [0,1] par le bruit) — l'histogramme les clampe.
  // Cinq étages, quatre seuils, UN champ (spec §2ter R32) : l'ordre est garanti par
  // construction, un quantile plus haut rend toujours un seuil plus haut.
  c.seuilPrairie = seuilParQuantile(c.hum, c.dedans, 1 - CREUX.PART_PRAIRIE, -0.5, 1.5)
  c.seuilBois = seuilParQuantile(c.hum, c.dedans, 1 - CREUX.PART_PRAIRIE - CREUX.PART_BOIS, -0.5, 1.5)
  c.seuilFleuraie = seuilParQuantile(c.hum, c.dedans, CREUX.PART_LANDE + CREUX.PART_FLEURAIE, -0.5, 1.5)
  c.seuilLande = seuilParQuantile(c.hum, c.dedans, CREUX.PART_LANDE, -0.5, 1.5)
}

/**
 * L'HUMIDITÉ EN UNE TUILE — la lecture MOLLE d'un champ qui reste au motif (spec `sol-dessine.md` R1).
 *
 * Le champ `hum` vit sur la grille de 8 (BFS à l'eau, quantiles) et y reste. Ici on l'interpole
 * BILINÉAIREMENT entre les centres des quatre cellules qui entourent la tuile, puis on ajoute un
 * grain fin : c'est ce qui fait que ce qui POUSSE prend des formes à la tuile, quand ce qui est
 * TAILLÉ (l'eau, la roche, les chapeaux de crête) reste en union de motifs. Les seuils ne bougent
 * pas : l'interpolation conserve la moyenne, le grain est symétrique — la composition reste un
 * contrat (R3).
 *
 * Au bord de la grille, la cellule voisine manquante est la cellule elle-même (clamp) : aucune
 * tuile ne lit hors tableau. Pur : `+ - * /`, `floor`, `min`, `max`, `fbm2`.
 */
export function humAt(c: Creux, x: number, y: number): number {
  return lireLeChampAt(c, c.hum, x, y, c.selGrain, CREUX.GRAIN_TUILE_AMPLITUDE)
}

/**
 * LA LECTURE MOLLE, GÉNÉRIQUE — n'importe quel champ de cellules, lu à la tuile.
 *
 * Extraite de `humAt` le 2026-08-27 pour le LAPIAZ, qui en avait le même besoin et pour la même
 * raison : son contour était décidé PAR CELLULE, donc rectiligne au motif. MESURÉ avant le
 * chantier (seed 2026, monde joué) : **91,8 % des segments de bord de la caillasse faisaient
 * huit tuiles ou plus**, contre 1,5 % pour la forêt et 0,7 % pour la lande à genévriers — le
 * minéral était le seul biome du pays à sortir en gros carrés (13 amas pour 39 760 tuiles, dont
 * un de 16 768 ; périmètre/aire 0,080 contre 0,21 pour le bois).
 *
 * Le grain prend un SEL PROPRE à chaque client : deux bords qui partageraient le grain de
 * l'humidité se ressembleraient — la même dentelle, décalée.
 *
 * Pur : `+ - * /`, `floor`, `min`, `max`, `fbm2`. Au bord de la grille, la cellule voisine
 * manquante est la cellule elle-même (clamp) : aucune tuile ne lit hors tableau.
 */
export function lireLeChampAt(
  c: Creux,
  champ: Float64Array,
  x: number,
  y: number,
  selGrain: number,
  amplitude: number,
): number {
  return lireLeChampGraine(c, champ, x, y, grainDuSol(x, y, selGrain) * amplitude)
}

/**
 * LE GRAIN DU SOL, TIRÉ À PART — la dentelle fine, sans le champ qu'elle mord.
 *
 * Elle sort de `lireLeChampAt` (2026-08-27, chantier des frontières universelles) parce qu'une
 * tuile peut avoir PLUSIEURS verdicts à rendre — le sol des zones en a trois (l'accent, la tache,
 * l'essence du haut bois) — et qu'ils doivent partager LE MÊME grain. Ce n'est pas l'économie
 * d'un `fbm2` qui l'exige (elle est réelle, mais mince) : c'est le dessin. Trois grains
 * indépendants sur la même tuile font trois dentelles étrangères l'une à l'autre ; un seul fait
 * un bord, une frange et une essence qui appartiennent visiblement au même sol.
 *
 * Rend une valeur CENTRÉE sur zéro (`fbm2 − 0,5`), à multiplier par l'amplitude voulue.
 */
export function grainDuSol(x: number, y: number, selGrain: number): number {
  return fbm2(x, y, CREUX.GRAIN_TUILE_ECHELLE, selGrain) - 0.5
}

/**
 * LA LECTURE MOLLE, GRAIN DÉJÀ TIRÉ — le corps de `lireLeChampAt`, à qui l'on donne sa dentelle
 * au lieu de la lui faire tirer. `grain` arrive DÉJÀ multiplié par son amplitude.
 *
 * Bit à bit identique à l'ancienne écriture : la somme se fait dans le même ordre, sur les mêmes
 * flottants (`lireLeChampAt` délègue, elle ne recalcule pas).
 */
export function lireLeChampGraine(
  c: Creux,
  champ: Float64Array,
  x: number,
  y: number,
  grain: number,
): number {
  const M = CREUX.MOTIF
  // Coordonnée CONTINUE en cellules, origine au centre de la cellule (0,0) : la tuile au centre
  // d'une cellule lit exactement sa valeur.
  const fx = (x + 0.5) / M - 0.5 - c.mx0
  const fy = (y + 0.5) / M - 0.5 - c.my0
  let ix = Math.floor(fx)
  let iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const ix1 = Math.max(0, Math.min(c.cols - 1, ix + 1))
  const iy1 = Math.max(0, Math.min(c.rows - 1, iy + 1))
  ix = Math.max(0, Math.min(c.cols - 1, ix))
  iy = Math.max(0, Math.min(c.rows - 1, iy))
  const h00 = champ[iy * c.cols + ix]!
  const h10 = champ[iy * c.cols + ix1]!
  const h01 = champ[iy1 * c.cols + ix]!
  const h11 = champ[iy1 * c.cols + ix1]!
  const haut = h00 + (h10 - h00) * tx
  const bas = h01 + (h11 - h01) * tx
  return haut + (bas - haut) * ty + grain
}

/**
 * LE VERDICT DE VÉGÉTATION en une tuile — l'échelle à CINQ étages (spec §2ter R32) :
 * 2 prairie humide (le plus mouillé), 1 bosquet, 0 herbe, −1 fleuraie, −2 lande (le plus sec).
 *
 * Cinq terrains, UN ordre. C'est toute la réparation de §2bis, étendue : un seul champ range
 * tous les mots du pré les uns par rapport aux autres.
 */
export function vegetationAt(c: Creux, x: number, y: number): -2 | -1 | 0 | 1 | 2 {
  if (celluleDe(c, x, y) < 0) return 0
  const h = humAt(c, x, y)
  if (h >= c.seuilPrairie) return 2
  if (h >= c.seuilBois) return 1
  if (h < c.seuilLande) return -2
  if (h < c.seuilFleuraie) return -1
  return 0
}

/**
 * ═══ LES BOSQUETS DE CRÊTE — LE LAC À L'ENVERS ═══
 *
 * Une grille grossière garantit la COUVERTURE (« de manière équilibrée ») ; à l'intérieur de
 * chaque case, c'est le relief qui choisit le point — le SOMMET sec. On pose ensuite un chapeau
 * `CHAPEAU` sous ce sommet et l'on garde tout ce qui dépasse : le bosquet épouse la bosse comme
 * le lac épouse la cuvette, en union de motifs (rectiligne, R32).
 *
 * « LOIN DES POINTS D'EAU » EST TENU PAR CONSTRUCTION, et pas par une distance écrite : le
 * sommet doit être dans la bande SÈCHE de l'humidité (`hum < seuilFleuraie`), or l'humidité
 * dérive de la distance à l'eau. On n'a donc pas deux règles qui pourraient diverger — la
 * sécheresse EST l'éloignement.
 *
 * `peignable` reçoit l'ORIGINE d'un motif et dit si ce carré de 8 accepte d'être boisé : le
 * relief ne sait rien du terrain, des seuils ni de la lisière sud, et n'a pas à le savoir.
 *
 * IL JUGE LE MOTIF ENTIER, PAS SON CENTRE, et ce détail a une conséquence visible. En ne testant
 * que le centre, une cellule à moitié noyée (une rive, un ruisseau, une sente) entrait dans le
 * chapeau ; à la peinture, ses tuiles refusées COUPAIENT le bosquet, qui sortait alors en un bois
 * plus deux ou trois miettes de vingt tuiles semées à côté. Une miette de conifère au milieu d'un
 * pré ne se lit pas comme un boqueteau : elle se lit comme une erreur.
 *
 * Rend une liste de bosquets : les cellules de motif du chapeau, ET LE PLANCHER qui les a élues.
 *
 * ⚠ Le plancher SORT D'ICI parce que c'est LUI la frontière du bosquet — le peintre en fait une
 * ligne de niveau lue à la tuile (`sol-dessine.md` R23). Sans lui, il ne resterait au peintre
 * qu'une union de carrés à remplir, et c'est très exactement ce qui se voyait.
 */
export interface Bosquet {
  /** Les cellules de motif retenues — la portée du bosquet, et sa borne. */
  cellules: number[]
  /** `sommet − CHAPEAU` : l'altitude sous laquelle on n'est plus dans le bois. */
  plancher: number
}

export function coifferLesCretes(
  c: Creux,
  horsSeuils: Uint8Array,
  peignable: (x: number, y: number) => boolean,
): Bosquet[] {
  const M = CREUX.MOTIF
  const n = c.cols * c.rows

  // ═══ DEUX MASQUES, ET LES CONFONDRE ÉTAIT UNE FAUTE ═══
  //
  // Première écriture : une seule condition, « sec ET peignable », pour le sommet COMME pour le
  // chapeau. Les bosquets sortaient minuscules et hachés, et la raison est arithmétique — la
  // bande sèche est le quantile 16 % de l'humidité, un ensemble MOUCHETÉ (le bruit de lisière
  // l'émiette à dessein). Exiger que chaque cellule du chapeau y tombe, c'était demander à une
  // colline d'être entièrement faite de confettis.
  //
  // La sécheresse qualifie le LIEU — donc le sommet, une fois. La forme, elle, vient du RELIEF :
  // le chapeau prend tout ce qui dépasse et qu'on a le droit de peindre. Un bois pousse sur une
  // bosse ; il ne pousse pas seulement sur les points les plus secs de cette bosse.
  const libre = new Uint8Array(n) // peignable : la forme du chapeau
  const sec = new Uint8Array(n) // + assez sec pour mériter un bois : le choix du sommet
  for (let k = 0; k < n; k++) {
    if (c.dedans[k] !== 1) continue
    if (horsSeuils.length > 0 && horsSeuils[k] === 0) continue
    const kx = k % c.cols
    const ky = (k - kx) / c.cols
    if (!peignable((c.mx0 + kx) * M, (c.my0 + ky) * M)) continue
    libre[k] = 1
    // SEC : dans la bande basse de l'humidité — donc loin de l'eau, par dérivation et non par
    // une distance écrite. Les deux règles ne peuvent pas diverger, il n'y en a qu'une.
    if (c.hum[k]! < c.seuilFleuraie) sec[k] = 1
  }

  const pris = new Uint8Array(n)
  const bosquets: Bosquet[] = []
  const P = CREUX.CRETE_PAS
  for (let gy = 0; gy * P < c.rows; gy++) {
    for (let gx = 0; gx * P < c.cols; gx++) {
      // ── LE SOMMET de la case : le plus HAUT parmi les cellules libres. Comparaison stricte
      //    puis index — ordre total, donc déterministe (invariant n°2).
      let sommet = -1
      let haut = -Infinity
      for (let dy = 0; dy < P; dy++) {
        const ky = gy * P + dy
        if (ky >= c.rows) break
        for (let dx = 0; dx < P; dx++) {
          const kx = gx * P + dx
          if (kx >= c.cols) break
          const k = ky * c.cols + kx
          if (sec[k] !== 1 || pris[k] === 1) continue
          const a = c.altLarge[k]!
          if (a > haut || (a === haut && k < sommet)) { haut = a; sommet = k }
        }
      }
      if (sommet < 0) continue

      // ── LE CHAPEAU : on garde ce qui dépasse, par proche-en-proche, plafonné en taille.
      const plancher = haut - CREUX.CHAPEAU
      const bosquet: number[] = [sommet]
      const vu = new Set<number>([sommet])
      for (let t = 0; t < bosquet.length && bosquet.length < CREUX.CRETE_MAX_CELLULES; t++) {
        const k = bosquet[t]!
        const kx = k % c.cols
        const ky = (k - kx) / c.cols
        const voisines = [
          kx > 0 ? k - 1 : -1,
          kx + 1 < c.cols ? k + 1 : -1,
          ky > 0 ? k - c.cols : -1,
          ky + 1 < c.rows ? k + c.cols : -1,
        ]
        for (const v of voisines) {
          if (v < 0 || vu.has(v)) continue
          vu.add(v)
          if (libre[v] !== 1 || pris[v] === 1 || c.altLarge[v]! < plancher) continue
          bosquet.push(v)
          if (bosquet.length >= CREUX.CRETE_MAX_CELLULES) break
        }
      }
      // Un chapeau minuscule n'est pas un bois, c'est un buisson : on préfère PAS DE BOSQUET à
      // un moignon — la case reste ouverte, et c'est une réponse. 8 cellules = 512 tuiles, environ
      // 23 de côté : les deux tiers d'un écran, donc un bois qu'on VOIT venir.
      if (bosquet.length < 8) continue
      for (const k of bosquet) pris[k] = 1
      bosquets.push({ cellules: bosquet, plancher })
    }
  }
  return bosquets
}
