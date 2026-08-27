/**
 * LE CONTENU DES ZONES — « loin » ne veut plus dire « plus ». Ça veut dire LE SEUL ENDROIT.
 *
 * LE GRIEF QU'ON RÉPARE ICI, et il était arithmétique. Le GDD promettait trois cercles : au
 * camp la récolte est médiocre, la richesse est au loin. Le code le mettait en œuvre par
 * `circleFactor`, qui multipliait le **stock d'un nœud**. Deux chiffres l'annulaient :
 *
 *   • `WILD_RADIUS = 70` tuiles sur une carte de 1200×1800 — le pas de la porte. Pas un
 *     gradient : une marche, franchie dès la première sortie.
 *   • `CARRY.CAPACITY = 30` et `ITEM_WEIGHT.wood = 1` — un sac plein fait trente bois **où
 *     qu'on soit**. Multiplier le stock d'un nœud lointain par 3,6 ne changeait donc RIEN à ce
 *     qu'on rapportait : *on revenait avec trente bois du bout du monde comme du coin du feu.*
 *
 * D'où : `circleFactor` et `WILD_RADIUS` sont **supprimés** (décision d'Alexis). La rareté
 * devient GÉOGRAPHIQUE. La ressource structurante d'une zone n'existe **nulle part ailleurs** —
 * et elle est LOURDE (3 unités le fût, 3 le bloc taillé : un sac n'en ramène que dix). La zone
 * dit OÙ ; le poids dit COMBIEN. Les deux verrous se répondent, et le portage redevient un jeu.
 *
 * ET LE TEASER. Dans la zone de départ, **un** filon de fer, dérisoire, épuisé en une heure.
 * Il ne sert pas à s'équiper — il sert à dire : *« ça existe. Pas ici. »* C'est le moteur
 * d'exploration le moins cher jamais inventé, et c'est une demande explicite du directeur de
 * jeu (« on peut lui montrer que certaines ressources existent dans des endroits pas naturels,
 * de manière très limitée, pour ouvrir une petite fenêtre »).
 *
 * Pur et déterministe : `hash2`/`fbm2`, `+ - * / sqrt` (invariant n°2).
 */
import {
  FAUNA,
  NODE_DEFS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_SCREE,
  TERRAIN_BOULDERS,
  TERRAIN_WET_MEADOW,
  TERRAIN_WILLOW,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
  TERRAINS,
  type NodeType,
  TERRAIN_CLAIRIERE,
} from './balance'
import { CENDRE, coutDe } from './cendre'
import type { ResourceNode } from './economy'
import { distSq } from './geometry'
import { profondeurAt, terrainAt, type WorldMap } from './map'
import { fbm2, hash2 } from './noise'
import { estCoeur, TERRAINS_BOISES_MASSIF, TERRAINS_FEUILLUS } from './profondeur'
import { CREUX } from './racine-relief'
import { type CarteZonee } from './zonegen'
import { EAU, estUnCoude } from './zonegen-water'
import { MONDE } from './zonegraph'

export const CONTENU = {
  /**
   * UN NŒUD TOUS LES ~N TUILES MARCHABLES. **Et il valait 7 — c'était une moquette.**
   *
   * Mesuré (et jamais avant, ce qui est la vraie faute) : **335 752 nœuds**, soit un buisson
   * toutes les **6,1 tuiles marchables**. Le sol de la vallée était pavé de baies. Alexis, en
   * jouant : *« la densité de ressources est délirante dans la zone de départ. »*
   *
   * 36 → ~62 000 nœuds, un tous les ~31 pas. La récolte redevient un DÉPLACEMENT : on cherche un
   * bosquet, on y va, on le vide. C'est le geste que le jeu veut, et il était noyé sous l'abondance.
   *
   * (La modulation par bosquets — `ECHELLE_BOSQUET` — les GROUPE : la densité moyenne ne dit pas
   * ce qu'on voit. On voit des bouquets d'arbres et des prés nus, pas un tapis régulier.)
   *
   * **CE BOUTON NE COMMANDE QU'UN TIERS DE LA CARTE, et « ~31 pas » est faux depuis le monde
   * réduit** (relevé du 2026-08-23, monde joué, 3 seeds) : **61 668 nœuds, un tous les 16,9 pas**
   * — et le semis commun n'en pose que **30 %**. Le reste vient des passes appendues, dont
   * la seule passe des ARBRES fait **48 %**. *(Après les coupes du même jour — R34ter, fibre,
   * champignons, pierre : **51 339 nœuds, un tous les 20,2 pas**. Ces deux chiffres se re-mesurent
   * en un tour de sonde ; qui lit ce bloc doit le refaire plutôt que le croire.)*
   *
   * Rabaisser `PAS_SEMIS` en croyant tenir la densité du monde, c'est ne toucher qu'un nœud sur
   * trois : la vérité par passe est dans le tableau de `docs/decisions.md` (2026-08-23), et
   * chaque passe se règle à SA constante.
   */
  PAS_SEMIS: 36,
  /** Échelle des bosquets : les nœuds se GROUPENT (une forêt, un filon), ils ne se saupoudrent
   *  pas. Un tapis uniforme n'est pas un pays, c'est une moquette. */
  ECHELLE_BOSQUET: 34,

  /**
   * LES ARBRES DE LA RACINE — récoltables, et posés à DEUX densités selon le sol (demande
   * d'Alexis, 2026-07-18). Ce sont de vrais nœuds `tree`, pas du décor : on veut du bois qu'on
   * COUPE, pas des conifères qu'on regarde.
   *
   *   • `FORET_PAS` — sur la forêt de la racine (ses bosquets), DENSE : une vraie futaie de bois.
   *   • `PRE_PAS`   — sur l'herbe du pré, ÉPARS : quelques arbres qui ponctuent la plaine sans la
   *                   boiser (le sol reste un pré ; ils n'y comptent d'ailleurs pas pour fonder un
   *                   village, cf. `emplacementsDeVillage`).
   *
   * `ECHELLE` = la taille des groupes quand les arbres se rassemblent. `PAS` GRAND = rare.
   */
  ARBRES_FORET_PAS: 5,
  ARBRES_PRE_PAS: 90,
  ARBRES_ECHELLE: 22,

  /**
   * ⚠ `CLAIRIERE_ECHELLE` / `CLAIRIERE_SEUIL` ONT ÉTÉ RETIRÉS le 2026-08-25. Les clairières ne
   * sont plus un seuil sur du bruit — un ensemble de sur-niveau de fbm n'a aucune borne, et on
   * a mesuré des trouées de 56×88 tuiles pour un écran de 20. Elles sont maintenant un TERRAIN,
   * borné par construction : tout leur réglage vit dans `clairieres.ts`, à côté de son
   * générateur, comme le veut la ligne de partage de `balance.ts`.
   */

  /** Le teaser : UN filon, et son stock est dérisoire. Épuisé en une heure. */
  /** La densité d'un VERGER : un buisson toutes ~3 tuiles de son emprise. Assez dense pour que
   *  le trouver soit une aubaine (c'est une récompense d'exploration), assez épars pour rester
   *  un bosquet et non un mur de fruits. Calibration. */
  VERGER_DENSITE: 0.34,
  TEASER_STOCK: 3,

  /**
   * L'ÉCONOMIE DU MONDE RÉDUIT (t0-exploration §2sexies) — les comptes de nœuds des trois
   * dérivations : minerais SUR la rocaille des affleurements (R48), carrières AU PIED de
   * l'enceinte (R49), vieux fûts AU CŒUR des massifs (R50). Ordres de grandeur — le calibrage
   * se fait en regardant la carte, et les planchers de R51 sont gardés par A28.
   */
  /**
   * ═══ NŒUDS DE MINERAI PAR AFFLEUREMENT — 4 → 12 (décision d'Alexis, 2026-08-27) ═══
   *
   * « 4 × stock 8 = 32 coups par butte : un filet, pas une mine », disait ce commentaire, et il
   * avait raison. **L'INVENTAIRE DU MONDE JOUÉ A TRANCHÉ** : 48 750 arbres, 6 564 rochers,
   * 4 099 blocs — et **13 filons de fer, 8 de charbon**. Trois ordres de grandeur d'écart, sur
   * la ressource qui commande toute la forge. Et depuis R6sexies la butte est un DÉDALE : on
   * creusait quatre-vingt-dix blocs pour quatre filons.
   *
   * ⚠ **C'EST UN NOMBRE QU'ON RÈGLE EN JOUANT, PAS EN REGARDANT UNE CARTE** — d'où sa place ici
   * et non dans le bloc du générateur. La tentation était de le DÉRIVER de la surface de galerie,
   * comme les blocs dérivent maintenant de la surface de la butte ; ce serait une faute de
   * famille : un bloc EST du terrain, un filon est de l'ÉCONOMIE. Dérivé, le rendement en fer
   * deviendrait un effet de bord de `MINE.DALLE` — retoucher le pas du labyrinthe changerait en
   * silence le nombre de villages capables de forger.
   *
   * L'ÉCHELLE, contre les recettes (`iron_ingot` = 2 minerais + 1 charbon ; `steel_ingot` =
   * 2 lingots + 2 charbons) et les 3 buttes ferreuses / 2 charbonneuses de `AFFL_IDENTITES` :
   * fer **96 → 288** unités, charbon **64 → 192**. Le charbon reste le goulot (c'est son rôle
   * depuis 2026-08-18), mais il cesse de borner la carte à un seul village équipé.
   */
  AFFL_NOEUDS: 12,
  /**
   * ⚠ `AFFL_BLOCS` A ÉTÉ RETIRÉ le 2026-08-27 (R6sexies). La butte posait 10 plots à pas constant
   * dans la liste row-major ; elle porte maintenant le même réseau de galeries que le chaos, et
   * son compte de blocs DÉRIVE de sa surface (53 à 115 mesurés). C'est le sens inverse de
   * `AFFL_NOEUDS` juste au-dessus, et c'est cohérent : le bloc est du terrain, le filon est de
   * l'économie.
   */
  /** Postes de carrière le long de l'enceinte, écartés au max-min. */
  CARRIERES: 3,
  /** Nœuds `quarry` par poste (stock 6 chacun). */
  CARRIERE_NOEUDS: 3,
  /** Rayon de pose autour d'un poste de carrière, en tuiles. */
  CARRIERE_RAYON: 6,
  /** Vieux fûts (`old_tree`, stock standard) aux cœurs des massifs — hors Bois Noir (le
   *  teaser R11 garde son récit : « le gros bois existe. Pas ici. »). */
  VIEUX_FUTS: 2,

  /**
   * LES CHAMPIGNONS (spec recolte-maitrise verbe 3) — un patch tous les X tuiles LIBRES, par
   * terrain. ABONDANT à l'humide et à l'ombre franche (marais, tourbière, roselière, sous-bois de
   * vieille sylve) ; TRÈS RARE sur le sol des forêts ordinaires (demande d'Alexis : quelques-uns
   * dans les bois de la zone T0, une curiosité qu'on croise tôt). Posés en PASSE SÉPARÉE, appendue,
   * positionnelle — la table `CONTENUS` n'est pas touchée, aucun nœud existant ne bouge. Calibration.
   *
   * **LA PRAIRIE HUMIDE N'EST PAS UN MARAIS** (mesuré le 2026-08-23, décision d'Alexis : « il faut
   * diminuer la pierre, la fibre et les champignons, ils sont trop nombreux sur certains biomes »).
   * `wet_meadow` est arrivé APRÈS (§2ter R34) et a été rangé au régime des marais : 6 % de ses
   * tuiles, sur 45 400 tuiles de pré — **2 671 champignons, 46 % de tous ceux de la carte, au même
   * endroit que 65 % de la fibre**. Le régime de l'humide était calibré sur de PETITS marais
   * (`marsh` en fait 4 235) ; appliqué à un biome de pré, il pave. La prairie garde donc son
   * champignon — c'est un mot mouillé, il y pousse — mais à SON régime, dix fois plus maigre que
   * le marais franc et deux fois le sous-bois ordinaire.
   */
  CHAMPIGNON_HUMIDE: 0.06,
  /** La prairie humide : un pré, pas une tourbière. `terrainAdmet` continue de l'admettre. */
  CHAMPIGNON_PRAIRIE: 0.012,
  CHAMPIGNON_FORET: 0.006,

  /**
   * LA FIBRE DES PRAIRIES HUMIDES (spec t0-exploration §2ter R34) — la prairie humide est LA
   * place à fibre de la T0 : la ressource des bandages a un endroit, au lieu d'un saupoudrage
   * uniforme. Passe appendue, positionnelle ('FIBR'), même patron que les champignons : la
   * table `CONTENUS` n'est pas touchée, aucun nœud existant ne bouge. Chance par tuile libre.
   * 0.03 → 0.08 avec R34bis : l'affinité éclaircit la fibre du pré sec, la prairie CONCENTRE
   * en face — le total reste du même ordre, l'endroit devient lisible.
   *
   * **PUIS 0.08 → 0.034 (2026-08-23, décision d'Alexis).** R34bis avait raison sur la FORME et
   * tort sur le VOLUME : « le total reste du même ordre » voulait dire que la prairie devenait
   * un CHAMP de fibre — mesuré, 8,42 plants pour 100 tuiles, soit **un tous les douze pas** sur
   * 45 400 tuiles, 65 % de toute la fibre du monde joué. On ne cherche pas une ressource qu'on
   * piétine. La concentration est CONSERVÉE parce que l'éclaircie du pré sec baisse avec elle
   * (`AFFINITE_FIBRE_SEC`) : c'est le RAPPORT qui dit où est la fibre, pas le nombre — et A18bis
   * garde ce rapport, pas ce nombre.
   */
  FIBRE_PRAIRIE: 0.034,

  /**
   * L'AFFINITÉ DU SEMIS COMMUN DE LA RACINE (spec t0-exploration §2ter R34bis, demande
   * d'Alexis 2026-08-18 : « équilibré mais logique »). Le saupoudrage que R34 dénonçait pour
   * la fibre valait pour TOUT le commun du pré : baies, fibre et pierre tombaient n'importe
   * où, et la carte des ressources était un bruit blanc (mesuré, seed 2026 : aucune structure
   * spatiale hors champignons/feuilles). Le tirage du TYPE ne change pas — la table de la
   * zone reste la loi — mais une ressource tirée là où elle n'a PAS de raison d'être est
   * ÉCLAIRCIE (facteur < 1, tirage positionnel 'AFIN') :
   *   — la FIBRE veut l'humide : plein régime aux mots mouillés et au bord de l'eau ;
   *   — la BAIE veut le bord et la lande : plein régime en lande/bruyère et au contact des bois ;
   *   — la PIERRE veut le relief : plein régime en lande (R34 : « sa pierre ») et au pied du rocheux.
   * Les passes appendues CONCENTRENT en face (FIBRE_PRAIRIE, BAIES_CLAIRIERE renforcées).
   * RACINE SEULE : les tables des zones T1/T2 ne bougent pas d'un nœud (A14/A15 intacts).
   */
  /** Rayon (Chebyshev) du « au contact de » : bois, eau, rocheux. 2 = la portée d'un regard. */
  AFFINITE_RAYON: 2,
  /** La fibre du pré sec, loin de toute eau : ce qui reste du saupoudrage.
   *  0.25 → 0.09 (2026-08-23) : elle DESCEND AVEC `FIBRE_PRAIRIE`. Couper la concentration
   *  seule aurait rendu la fibre du pré sec majoritaire — le saupoudrage serait revenu par la
   *  porte de derrière, et A18bis (« ≥ 55 % de fibre à l'humide ») serait tombée à raison. */
  AFFINITE_FIBRE_SEC: 0.09,
  /** La baie de plein champ, loin des bois et hors lande. */
  AFFINITE_BAIE_OUVERT: 0.25,
  /** La pierre de plaine, hors pierrier et loin de tout relief.
   *  0.15 → 0.08 (2026-08-23) : même mouvement que la fibre, pour la même raison — elle descend
   *  avec `PIERRIER_CHANCE` pour que le rapport d'A18bis (« ≥ 75 % de pierre au relief/lande/
   *  pierrier ») tienne pendant que le NOMBRE baisse. */
  AFFINITE_PIERRE_OUVERT: 0.08,
  /**
   * LES PIERRIERS DU PRÉ — le pré n'a presque pas de relief à toucher : l'éclaircie seule ne
   * dessinerait rien (mesuré : 28 % de pierre « logique », le reste en bruit). La vérité
   * géologique d'un fond de vallée est le CHAMP DE BLOCS erratiques : un champ basse
   * fréquence ('PIER') élit des nappes où la pierre garde plein régime — on cherche un
   * pierrier comme on cherche un bosquet. Même grammaire que ECHELLE_BOSQUET.
   */
  PIERRIER_ECHELLE: 30,
  PIERRIER_SEUIL: 0.66,
  /** La chance par tuile libre D'UN PIERRIER (passe appendue 'PIRR') : le champ de blocs est
   *  plus dense que ne l'était le saupoudrage — on le voit de loin, on y va, on le vide.
   *  0.025 → 0.018 (2026-08-23) : le pierrier reste plus dense que tout ce qui l'entoure, mais
   *  il pesait 3 146 rochers — 28 % de toute la pierre de la carte, dans la zone de départ. */
  PIERRIER_CHANCE: 0.018,
  /**
   * LA PIERRE DES GALERIES DU CHAOS (passe 'CHPR', 2026-08-27) — la chance par tuile de galerie.
   *
   * Le `boulders` est devenu STÉRILE pour le semis commun le jour où ses blocs ont pris une
   * boîte : un rocher tiré au milieu d'une masse aurait été un nœud VISIBLE ET INATTEIGNABLE.
   * Sa pierre revient donc ici, sur les galeries — et à la MÊME abondance qu'avant, calibrée
   * sur le compte mesuré (≈ 4,4 rochers pour 100 tuiles de chaos, trois seeds) : le chaos n'a
   * pas été appauvri, sa récolte a changé d'adresse.
   */
  CHAOS_PART_PIERRE: 0.035,

  /**
   * LA PROFONDEUR PORTE DU JEU (spec t0-exploration §2quater R40). Le VIEUX FÛT : facteur de
   * stock des arbres du cœur (`stockDArbre` — fonction pure de la position, appliquée au
   * semis ET réappliquée à la repousse). Les CHAMPIGNONS DU CŒUR ('COEU') et les BAIES DE
   * LISIÈRE ('LISI') : chance par tuile libre, passes appendues en queue — patron 'FIBR'.
   * CHAMPIGNON_COEUR se lit contre CHAMPIGNON_FORET (0.006) : le cœur est ×2 le régime
   * commun, sans atteindre l'humide franc (0.06).
   *
   * 0.03 → 0.012 (2026-08-23) : à ×5, le cœur TRIPLAIT le champignon de la forêt ordinaire
   * (mesuré : 1,65 pour 100 tuiles de `forest`, quand le régime annoncé — « très rare » — en
   * promet 0,6). La bande du cœur reste le meilleur endroit à champignons des bois ; elle
   * cesse d'être ce qui les définit.
   */
  VIEUX_FUT_FACTEUR: 1.5,
  CHAMPIGNON_COEUR: 0.012,
  /**
   * ═══ LES BAIES DE LA CLAIRIÈRE — l'adresse du garde-manger (Alexis, 2026-08-25) ═══
   *
   * `BAIES_LISIERE` (0,03, la lisière du bois) est devenu ceci : *« on retire les buissons baies
   * dans le biome forest »* et *« je veux qu'il y ait plus de buisson à baies dans ce biome »*.
   * La règle de R40 ne change pas de NATURE — la baie va là où la lumière touche le sol du
   * massif ; elle change d'ENDROIT : la lisière était sous les arbres, la trouée ne l'est pas.
   *
   * 0,03 → **0,085**, presque le triple, et il se lit sur une surface bien plus petite : la
   * lisière fait des milliers de tuiles, les clairières quelques milliers en tout. Une trouée
   * d'un bloc (une trentaine de tuiles) porte donc **deux à trois buissons de cette passe**, plus
   * ce que le semis commun y sème. On entre dans une clairière pour la cueillir : c'est ce qui
   * fait d'elle une destination et non un trou.
   */
  BAIES_CLAIRIERE: 0.085,

  /**
   * LES TAS DE FEUILLES (forêts-vivantes §1 R1 — sel 'FEUI') : la fouille du sous-bois,
   * dans la bande du CORPS des feuillus — la seule bande sans objet propre (la lisière a
   * ses baies, le cœur ses champignons). Chance par tuile libre, passe appendue en queue.
   */
  TAS_FEUILLES: 0.02,

  /**
   * ═══ LE GLANAGE (spec `glanage.md` G3 — sel 'GLAN') ═══
   *
   * Depuis que le bois et la pierre exigent un outil (`NODE_DEFS.tree/rock.minTool = 'crude'`),
   * c'est CETTE constante qui décide si la partie peut commencer. Une chance par NŒUD PARENT :
   * un arbre sur ~N laisse tomber une branche à son pied, un rocher sur ~N détache une pierre.
   *
   * ANCRÉE SUR LE PARENT, jamais semée à plat — c'est ce qui fait qu'on la CHERCHE là où on
   * l'attend : au pied de ce qu'on ne peut pas encore couper. Un semis indépendant aurait
   * saupoudré du bois sur le pré nu, et le geste n'aurait rien appris au joueur.
   *
   * ⚠ **CE NOMBRE EST LE TEMPO DE LA PREMIÈRE HEURE.** Le hachereau coûte 2 bois + 3 pierre,
   * la pioche 3 + 2 : cinq ramassages pour le premier outil, dix pour les deux. Trop bas, le
   * jeu s'ouvre sur une fouille stérile ; trop haut, le verrou ne se sent pas. Se calibre EN
   * JOUANT (`recolte.md` G11), et la sonde `tools/mesure-glanage.mts` en donne le relevé.
   */
  GLANAGE_CHANCE: 0.06,

  /**
   * LES COINS DE PÊCHE (spec `peche.md` P3/P4 — sel 'PECH'). Réglage de GÉNÉRATEUR : il se
   * calibre en regardant une carte (combien de coins sur la rivière, combien par lac), pas en
   * jouant — c'est la ligne de partage de `balance.ts`.
   */
  /** Rivière : deux coudes retenus sont séparés d'au moins ce nombre de PAS DE FIL. Une poignée
   *  de coins sur toute la rivière, pas un par méandre. */
  PECHE_ESPACEMENT_FIL: 40,
  /** Lac : un coin, plus un par tranche de ce nombre de tuiles de BERGE candidates (haut-fond
   *  touchant le profond, hors rivière) — un lac de 45×45 a ~180 tuiles de berge, donc deux… */
  PECHE_BERGE_PAR_COIN: 150,
  /** …plafonné à ce nombre par lac, … */
  PECHE_MAX_PAR_LAC: 3,
  /** …et deux coins d'un même lac sont écartés d'au moins ce Chebyshev. */
  PECHE_ESPACEMENT_LAC: 24,
  /** Une tuile profonde à moins de ce rayon Chebyshev du fil appartient à la RIVIÈRE (pas au lac). */
  PECHE_RAYON_RIVIERE: 2,

  /**
   * UN EMPLACEMENT DE VILLAGE : ce qu'il lui faut sous la main, et sur quel rayon.
   *
   * **CES SEUILS SONT COUPLÉS À `PAS_SEMIS`, et je l'avais oublié.** En divisant la densité de
   * nœuds par cinq (elle était délirante), j'ai rendu ces minimums cinq fois plus durs à
   * atteindre sans y toucher : les Prés Bas ne portaient plus que **11 emplacements pour 17
   * villages**. La garde A17 l'a dit tout de suite — c'est exactement à ça qu'elle sert.
   *
   * On élargit donc le RAYON (un village regarde plus loin autour de lui, ce qui est de toute
   * façon plus juste : quarante tuiles, c'est dix secondes de marche) et on rabaisse les
   * minimums en proportion.
   */
  RAYON_VILLAGE: 40,
  BOIS_MIN: 4,
  PIERRE_MIN: 2,
  /**
   * UN SITE TENABLE (worldgen R17bis, question ③ de la calibration de saison) : les baies de
   * la maille de fondation — un village PNJ n'a QU'UNE source de nourriture, il ne chasse
   * pas — et l'écart au RECTANGLE d'un lieu à monstre résident (tanière, repaire). L'écart au
   * coin de chasse, lui, n'a pas de constante ici : il se DÉRIVE de la faune
   * (`GROUND_RADIUS + SPAWN_RING_MAX` — la portée exacte à laquelle la présence des
   * villageois fait naître des loups), et il doit suivre ces constantes s'il bougent.
   * MESURÉ (banc, 4 graines) : les villages viables portent 5-20 baies en maille ; 4 exclut
   * le désert sans toucher un seul site sain. Tanière à 44 tuiles : village à effectif
   * plein ; 32 est un plancher de bon sens, pas une peur.
   */
  BAIES_MIN: 4,
  ECART_NID: 32,
  /**
   * PLACE NETTE autour du foyer : on ne fonde pas un village dans un couloir.
   *
   * 5 → un carré de 11×11 tout marchable. Il valait 7 (15×15), et les BUTTES l'ont rendu trop
   * dur : leurs parois hachent la plaine, et les Prés Bas ne portaient plus que 15 emplacements
   * pour 17 villages. Onze tuiles suffisent largement au Feu, au coffre et aux six maisons
   * (`foundNpcVillage` les pose à ±3) — quinze était du confort, pas un besoin.
   */
  DEGAGEMENT: 5,
  /** Pas du balayage des emplacements. Fin : un village fait dix tuiles de large, et chercher
   *  tous les douze pas en manquait. */
  PAS_BALAYAGE: 8,
}

/**
 * CE QUE CHAQUE ZONE DONNE. `structurant` n'existe nulle part ailleurs (R9) ; `commun` est le
 * fond de subsistance ; `liaison` est partagé et **déclaré** (le charbon, au Karst *et* au
 * Versant Brûlé — une couture, pas un relâchement : deux zones qu'un même besoin relie donnent
 * au joueur un CHOIX DE ROUTE).
 *
 * UNE ZONE PEUT NE RIEN DONNER, et c'est un outil, pas un oubli : le Névé et les seuils ne
 * nourrissent rien — c'est ce qui rend un village impossible dedans **sans qu'aucune règle ne
 * l'interdise**. On ne dit jamais non au joueur ; on rend l'endroit inhabitable par ce qui n'y
 * pousse pas.
 */
interface ContenuZone {
  /** La ressource qui DÉFINIT la zone. Exclusive. Rare (elle vaut le voyage). */
  structurant?: { type: NodeType; part: number }
  /** Partagée avec d'autres zones, et déclarée. */
  liaison?: { type: NodeType; part: number }[]
  /** Le fond de subsistance : bois, pierre, fibre, baies. Des parts, normalisées. */
  commun: Partial<Record<NodeType, number>>
  /**
   * L'ÉCLAIRCIE PAR TYPE DE LA ZONE (2026-08-23, sel 'ECLA') — facteur < 1 : la part de tirages
   * de ce type qui SURVIT ici. C'est le seul levier qui RETIRE un nœud d'une zone.
   *
   * Pourquoi il fallait un levier de plus : les parts de `commun` sont **renormalisées** (voir
   * `tirerType`), donc baisser la part d'un type ne le retire pas — il se CONVERTIT en un autre.
   * Sur la Cendrière, la moitié de la pierre du monde joué : baisser `rock: 0.6` l'aurait
   * transformée en bois, ce qu'Alexis n'a pas demandé. Et un facteur de densité de ZONE aurait
   * emporté ses arbres avec ses cailloux, ce qu'il n'a pas demandé non plus.
   *
   * Tirage POSITIONNEL, comme l'affinité de la racine — fonction pure de la tuile, pas de PRNG :
   * le flux de génération n'est pas décalé. Distinct de `affiniteDuCommun`, qui lit le TERRAIN et
   * ne vaut que pour la racine (R34bis l'a épinglé là pour ne pas déplacer les nœuds T1/T2).
   */
  eclaircie?: Partial<Record<NodeType, number>>
}

export const CONTENUS: Record<string, ContenuZone> = {
  // ── T0 : LA RACINE. Tout le commun, en abondance. Rien d'autre. ──
  // (Le teaser de fer s'y ajoute à la main : il est unique, il ne se sème pas.)
  pres_bas: { commun: { tree: 0.42, rock: 0.16, fiber_plant: 0.22, berry_bush: 0.2 } },

  // ── T1 : LA CEINTURE. Chacune donne ce que les autres n'ont pas. ──
  sylve: { structurant: { type: 'old_tree', part: 0.3 }, commun: { tree: 0.5, fiber_plant: 0.14, berry_bush: 0.06 } },
  karst: {
    structurant: { type: 'iron_vein', part: 0.3 },
    liaison: [{ type: 'coal_seam', part: 0.18 }],
    commun: { rock: 0.44, fiber_plant: 0.08 },
  },
  tourbiere: { structurant: { type: 'peat_cut', part: 0.34 }, commun: { fiber_plant: 0.4, berry_bush: 0.16, tree: 0.1 } },
  alpages: { structurant: { type: 'quarry', part: 0.28 }, commun: { rock: 0.3, fiber_plant: 0.32, berry_bush: 0.1 } },
  brule: {
    structurant: { type: 'ash_heap', part: 0.34 },
    liaison: [{ type: 'coal_seam', part: 0.16 }],
    // `berry_bush` : les baies des PIONNIERS (stratigraphie S-R20) — `terrainAdmet` les refuse
    // au calciné et les donne à la lande et à l'herbe des stades : la reprise se RÉCOLTE, le
    // gradient de succession est aussi un gradient de garde-manger.
    commun: { tree: 0.28, rock: 0.1, fiber_plant: 0.08, berry_bush: 0.12 },
  },
  ruines: { structurant: { type: 'rubble', part: 0.3 }, commun: { rock: 0.34, fiber_plant: 0.2, tree: 0.16 } },

  // ── T2 : LES MARGES. Le contenu se décidera ; la carte lui MÉNAGE LA PLACE (spec §11).
  //    En attendant, elles portent de quoi survivre en expédition — et rien de plus.
  // La Cendrière portait **52 % de toute la pierre du monde joué** (mesuré le 2026-08-23 :
  // 3 841 rochers dans sa forêt brûlée + 1 950 dans son chaos de blocs). Le chaos, surtout,
  // n'admet QUE la pierre (`terrainAdmet` refuse l'arbre) : sa table s'y renormalise à 100 %
  // de cailloux, un tous les 32 pas. L'éclaircie retire ; elle ne convertit pas — le bois mort
  // de la Cendrière, qu'Alexis n'a pas mis en cause, reste au nœud près.
  cendriere: { commun: { tree: 0.4, rock: 0.6 }, eclaircie: { rock: 0.45 } },
  glacier: { commun: { rock: 1 } },
  aiguilles: { commun: { rock: 1 } },
  gouffre: { commun: { rock: 1 } },
  lac_mort: { commun: { fiber_plant: 0.6, berry_bush: 0.4 } },
}

/**
 * LA FAMILLE MINÉRALE — le sol NU, celui où rien n'a de racine. Écrite par NOM, l'idiome de
 * `terrainAdmet` : une seule vérité (la table `TERRAINS`), pas une liste d'ids à tenir synchrone.
 * `estRocheux` (plus bas, l'affinité) y ajoute la roche et la falaise, qui ne sont pas
 * marchables : ce qui suit ne parle que des sols où l'on MET LE PIED.
 */
function estMineral(terrain: number): boolean {
  const n = TERRAINS[terrain]?.name
  return n === 'scree' || n === 'boulders'
}

/** Le terrain admet-il ce nœud ? Un arbre ne pousse pas dans un éboulis. */
function terrainAdmet(type: NodeType, terrain: number): boolean {
  const def = TERRAINS[terrain]
  if (!def?.walkable) return false
  const n = def.name
  switch (type) {
    case 'tree':
    case 'old_tree':
      return n === 'forest' || n === 'old_growth' || n === 'pine' || n === 'larch' || n === 'burnt_forest' || n === 'willow'
    case 'berry_bush':
      // ⚠ **AUCUNE BAIE SOUS UN COUVERT** (demande d'Alexis, 2026-08-25 : « on retire les
      // buissons baies dans le biome forest »). Une ronce est une plante de LUMIÈRE : elle
      // tient les bords, les coupes et les trouées, jamais l'ombre d'une futaie. La règle est
      // écrite sur TOUTE la masse boisée et pas sur le seul `forest` — le pin et la saulaie
      // sont plus sombres encore, et une exclusion qui laisserait la baie au mélèze serait une
      // incohérence qu'on relirait un jour sans en trouver la raison.
      //
      // Les baies ne disparaissent pas du monde, elles CHANGENT D'ADRESSE : la clairière les
      // prend (`baiesDeLaClairiere`), et l'affinité du commun donnait déjà plein régime au pré
      // qui touche le bois (`AFFINITE_BAIE_OUVERT`). Le garde-manger se déplace du couvert vers
      // la lumière — c'est ce qui fait d'une trouée une destination.
      if (TERRAINS_BOISES_MASSIF.includes(terrain)) return false
      return n !== 'snow' && n !== 'scree' && n !== 'boulders' && n !== 'shallow_water'
    case 'fiber_plant':
      // ⚠ **RIEN NE POUSSE DANS LA CAILLASSE** (demande d'Alexis, 2026-08-27 : *« retire les
      // fibres ou les trucs du genre, c'est de la caillasse ! »*). L'éboulis était déjà exclu ;
      // le chaos de blocs ne l'était pas, et MESURÉ (trois seeds, monde joué) il portait 10 à
      // 22 plants de joncs POSÉS SUR DE LA ROCHE NUE. La règle s'écrit maintenant sur la
      // FAMILLE minérale entière, comme la baie s'écrit sur la masse boisée entière : une
      // exclusion qui vaudrait pour l'éboulis mais pas pour les blocs est une incohérence qu'on
      // relirait un jour sans en trouver la raison.
      return !estMineral(terrain) && n !== 'snow' && n !== 'shallow_water'
    case 'peat_cut':
      return n === 'peat_bog' || n === 'reed_marsh' || n === 'marsh'
    case 'rock':
    case 'bloc':
    case 'quarry':
    case 'iron_vein':
    case 'coal_seam':
    case 'rubble':
      return n !== 'shallow_water' && n !== 'peat_bog' && n !== 'reed_marsh'
    case 'ash_heap':
      return n === 'burnt_forest' || n === 'heath'
    case 'leaf_pile':
      // La litière des FEUILLUS (forêts-vivantes §1) : le sec ne fait pas de tas.
      return n === 'forest' || n === 'old_growth' || n === 'willow'
    case 'branche_au_sol':
      // LE GLANAGE se pose au SEC (spec `glanage.md` G3). Une branche flottant dans le haut-fond
      // ou couchée sur la tourbière n'est pas un objet qu'on ramasse, c'est un objet qui dérive.
      // ET PAS DE BOIS MORT SUR LA ROCHE NUE (2026-08-27, même demande que la fibre) : une
      // branche tombe d'un arbre, or il n'en pousse pas un seul dans un pierrier. La PIERRE au
      // sol, elle, y reste — c'est le seul glanage qui ait sa place ici, et c'est le sien.
      return !estMineral(terrain) && n !== 'shallow_water' && n !== 'peat_bog' && n !== 'reed_marsh' && n !== 'marsh'
    case 'pierre_au_sol':
      return n !== 'shallow_water' && n !== 'peat_bog' && n !== 'reed_marsh' && n !== 'marsh'
    case 'champignon':
      // L'humide et l'ombre : marais, tourbière, roselière, sous-bois de vieille sylve, le sol
      // des forêts ordinaires (là, très rare — voir `champignonsRares`) — et les deux mots
      // mouillés du pré (spec t0-exploration §2ter R34) : saulaie et prairie humide.
      return n === 'marsh' || n === 'peat_bog' || n === 'reed_marsh' || n === 'old_growth' || n === 'forest'
        || n === 'willow' || n === 'wet_meadow'
    default:
      return true
  }
}

/** Le voisinage Chebyshev ≤ r de la tuile contient-il un terrain qui satisfait `pred` ? */
function voisinageA(map: WorldMap, tx: number, ty: number, r: number, pred: (t: number) => boolean): boolean {
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
      if (pred(map.terrain[y * map.width + x]!)) return true
    }
  }
  return false
}

// Les familles de terrain de l'affinité — par NOM, l'idiome de `terrainAdmet` : une seule
// vérité (la table TERRAINS), pas une liste d'ids de plus à tenir synchrone.
const nomDe = (t: number): string => TERRAINS[t]?.name ?? ''
const estEau = (t: number): boolean => { const n = nomDe(t); return n === 'shallow_water' || n === 'deep_water' }
const estHumide = (t: number): boolean => {
  const n = nomDe(t)
  return n === 'wet_meadow' || n === 'willow' || n === 'marsh' || n === 'reed_marsh' || n === 'peat_bog'
}
const estLande = (t: number): boolean => { const n = nomDe(t); return n === 'juniper_heath' || n === 'heath' }
const estRocheux = (t: number): boolean => {
  const n = nomDe(t)
  return n === 'rock' || n === 'cliff' || n === 'scree' || n === 'boulders'
}

/**
 * L'AFFINITÉ DU SEMIS COMMUN (§2ter R34bis) — là où la ressource tirée a une raison d'être,
 * plein régime (1) ; ailleurs, le facteur d'éclaircie de sa famille. Fonction PURE de la
 * position — le verdict d'une tuile ne dépend que de son voisinage de terrain.
 */
function affiniteDuCommun(c: CarteZonee, type: NodeType, t: number, tx: number, ty: number): number {
  const r = CONTENU.AFFINITE_RAYON
  switch (type) {
    case 'fiber_plant':
      if (estHumide(t)) return 1
      if (voisinageA(c.map, tx, ty, r, (u) => estEau(u) || estHumide(u))) return 1
      return CONTENU.AFFINITE_FIBRE_SEC
    case 'berry_bush':
      if (estLande(t)) return 1
      if (voisinageA(c.map, tx, ty, r, (u) => TERRAINS_BOISES_MASSIF.includes(u))) return 1
      return CONTENU.AFFINITE_BAIE_OUVERT
    case 'rock':
      if (estLande(t)) return 1
      if (voisinageA(c.map, tx, ty, r, estRocheux)) return 1
      // Le champ de blocs erratiques : une nappe élue par le champ 'PIER', pas un semis.
      if (fbm2(tx, ty, CONTENU.PIERRIER_ECHELLE, (c.graphe.seed ^ 0x50494552) | 0) > CONTENU.PIERRIER_SEUIL) return 1
      return CONTENU.AFFINITE_PIERRE_OUVERT
    default:
      return 1
  }
}

/**
 * LE SEMIS. Un balayage, un tirage positionnel (fonction pure de la tuile : déplacer un nœud
 * d'une tuile ne remélange pas la carte), des bosquets.
 *
 * **UN SEUIL NE NOURRIT RIEN** (spec R10.3) : aucune tuile de rampe ne porte de nœud. Ce n'est
 * pas de la saveur — c'est ce qui rend un village impossible dans une porte, sans interdit.
 */
export function placeZoneNodes(c: CarteZonee): ResourceNode[] {
  const { width, height, terrain } = c.map
  const nodes: ResourceNode[] = []
  // LES COULÉES SONT STÉRILES (forêts-vivantes §4 R5bis) : un couloir où l'on circule et
  // où l'on voit venir. Le prédicat vit ICI, en un point : le semis principal le teste, et
  // TOUTES les passes appendues l'héritent par l'ensemencement de leurs `occupees` — une
  // passe future ne peut pas l'oublier.
  const steriles = (c.map.coulees ?? []).filter((i) => i >= 0)
  // LA TUILE DU SOMMET d'une butte reste NUE (§2sexies R48bis) : le client y dresse le chicot.
  // Réservée ICI, à la source — le semis principal passait AVANT les passes de butte et pouvait
  // y poser un rocher de la table ordinaire (attrapé par la garde A29, seed 7).
  const sommets = c.affleurements.map((a) => sommetDeButte(c, a.rect)).filter((i) => i >= 0)
  // LE CHAOS DE BLOCS EST STÉRILE POUR LE SEMIS COMMUN (2026-08-27) — et c'est ce qui rend
  // « des nœuds accessibles dans la structure » vrai PAR CONSTRUCTION plutôt que par chance :
  // `blocsDuChaos` seul y repose la pierre, sur ses galeries. Sans ce masque, le semis ordinaire
  // aurait laissé ses rochers au milieu des masses, où le bloc les aurait emmurés.
  const chaos = tuilesDuChaos(c)
  const sterileSet = new Set([...steriles, ...sommets, ...chaos])
  // ⚠ `occupeesPlus` PORTE LE CHAOS, `occupeesDuChaos` NE LE PORTE PAS — et c'est toute la
  // différence. Le chaos appartient à `blocsDuChaos` seul : sans le masque ici, les passes
  // appendues (le pierrier du pré, le glanage, la carrière) y déposaient encore des nœuds au
  // milieu des masses — MESURÉ avant de le poser : 8 rochers, 31 branches et 3 pierres au sol
  // injoignables, exactement le défaut qu'« on doit pouvoir spawn des nodes accessibles »
  // interdit. Et le glanage cesse du même coup de coucher du bois mort sur la roche nue.
  const occupeesPlus = (): Set<number> => new Set([...nodes.map((n) => n.ty * width + n.tx), ...steriles, ...sommets, ...chaos])
  const occupeesDuChaos = (): Set<number> => new Set([...nodes.map((n) => n.ty * width + n.tx), ...steriles, ...sommets])
  const seed = (c.graphe.seed ^ 0x51ab3f77) | 0
  let id = 1

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i]) continue // le seuil ne nourrit rien
      if (sterileSet.has(i)) continue // la coulée non plus (forêts-vivantes §4)
      const t = terrain[i]!
      if (t === TERRAIN_ROAD) continue // rien ne pousse sur une sente (t0-exploration R18)
      if (!TERRAINS[t]?.walkable) continue

      // ⚠ ICI VIVAIT LE SAUT DE CLAIRIÈRE, et c'était le défaut (retiré le 2026-08-25).
      // Son commentaire disait « sans ça le semis la REBOISERAIT » — mais le code gardait sur
      // `terrainAdmet('tree', …)` et sautait la table commune EN ENTIER : pas d'arbre, mais pas
      // de baie, pas de fibre, pas de champignon non plus. Litière brune, zéro prop, zéro nœud :
      // la grammaire d'une coupe rase, et c'est exactement ce qu'Alexis a vu. Sa prémisse
      // affichée (« le sol y verdit ») avait d'ailleurs été supprimée deux jours plus tôt.
      //
      // La clairière étant un TERRAIN, plus rien n'est à dire ici : `terrainAdmet` refuse l'arbre
      // sur `clairiere` et la table de la zone se renormalise sur ce qui pousse à la lumière.
      // L'affinité fait le reste — une tuile de clairière a du bois dans son voisinage, donc la
      // BAIE y garde son plein régime pendant que la PIERRE y est éclaircie (`AFFINITE_*`).

      // La densité : un nœud tous les PAS_SEMIS, modulée par les bosquets. Les nœuds se
      // GROUPENT — un tapis uniforme n'est pas un pays, c'est une moquette.
      const bosquet = fbm2(tx, ty, CONTENU.ECHELLE_BOSQUET, (seed ^ 0x2f9e) | 0)
      const chance = (1 / CONTENU.PAS_SEMIS) * (0.35 + 1.6 * bosquet)
      if (hash2(tx, ty, seed) >= chance) continue

      const type = tirerType(c, c.zone[i]!, t, tx, ty, seed)
      if (!type) continue
      // L'AFFINITÉ éclaircit l'illogique (§2ter R34bis) — RACINE SEULE : les zones dormantes
      // gardent leur semis au nœud près. Sel neuf ('AFIN') : aucun flux existant décalé.
      if (c.zone[i] === c.graphe.racine) {
        const a = affiniteDuCommun(c, type, t, tx, ty)
        if (a < 1 && hash2(tx, ty, (seed ^ 0x4146494e) | 0) >= a) continue
      }
      // L'ÉCLAIRCIE DE LA ZONE (2026-08-23, sel 'ECLA') : ce que la table déclare de trop chez
      // elle. Elle RETIRE le nœud — elle ne le convertit pas en un autre type (ce que ferait
      // une part rabaissée, la table étant renormalisée).
      const ecl = CONTENUS[c.graphe.zones[c.zone[i]!]!.def.slug]?.eclaircie?.[type]
      if (ecl !== undefined && ecl < 1 && hash2(tx, ty, (seed ^ 0x45434c41) | 0) >= ecl) continue
      // Le stock d'un ARBRE passe par `stockDArbre` (§2quater R40) : au cœur d'un massif,
      // le vieux fût — partout ailleurs, le défaut du type, à l'identique d'avant.
      nodes.push({ id, type, tx, ty, stock: type === 'tree' ? stockDArbre(c.map, tx, ty) : NODE_DEFS[type].stock, regrowAt: 0 })
      id += 1
    }
  }

  // ── LES ARBRES DE LA RACINE — récoltables, denses en forêt, épars sur le pré ──
  // Une seconde passe, à part : sur l'herbe, ces arbres ne sortent pas de la table de la zone
  // (l'herbe n'admet pas le bois, `terrainAdmet`), ils s'y AJOUTENT ; en forêt, ils DENSIFIENT ce
  // que la table donnait déjà. Dans les deux cas ce sont de vrais nœuds à couper — pas du décor.
  const occupees = occupeesPlus()
  const arbres = arbresDeLaRacine(c, occupees, id)
  for (const a of arbres) nodes.push(a)
  id += arbres.length

  // ── LES VERGERS SAUVAGES — le lieu qui portait un NOM et rien d'autre ─────
  const vergers = vergersSauvages(c, occupeesPlus(), id)
  for (const v of vergers) nodes.push(v)
  id += vergers.length

  // ── LES CHAMPIGNONS — abondants à l'humide/l'ombre, TRÈS RARES en forêt (verbe 3) ──
  const mush = champignonsRares(c, occupeesPlus(), id)
  for (const m of mush) nodes.push(m)
  id += mush.length

  // ── LA FIBRE DES PRAIRIES HUMIDES — la place à fibre de la T0 (spec §2ter R34) ──
  const fibres = fibresDesPrairies(c, occupeesPlus(), id)
  for (const f of fibres) nodes.push(f)
  id += fibres.length

  // ── LE TEASER — un seul filon, dans la racine, et il est dérisoire ────────
  const t = poserLeTeaser(c, id)
  if (t) { nodes.push(t); id += 1 }

  // ── LE TEASER DU BOIS NOIR — le patron du Filon, appliqué au gros bois ────
  const vieux = teaserDuBoisNoir(c, occupeesPlus(), id)
  if (vieux) { nodes.push(vieux); id += 1 }

  // ── LES BAIES DE LA CLAIRIÈRE (spec §2quater R40 révisé) — en QUEUE : rien d'avant ne bouge ──
  const baies = baiesDeLaClairiere(c, occupeesPlus(), id)
  for (const b of baies) nodes.push(b)
  id += baies.length
  const coeurs = champignonsDuCoeur(c, occupeesPlus(), id)
  for (const m of coeurs) nodes.push(m)
  id += coeurs.length
  const feuilles = tasDeFeuilles(c, occupeesPlus(), id)
  for (const f of feuilles) nodes.push(f)
  id += feuilles.length

  // ── LES PIERRIERS DU PRÉ (§2ter R34bis) — la pierre en CHAMPS DE BLOCS, pas en semis ──
  const pierriers = pierriersDuPre(c, occupeesPlus(), id)
  for (const p of pierriers) nodes.push(p)
  id += pierriers.length

  // ── L'ÉCONOMIE DU MONDE RÉDUIT (t0-exploration §2sexies) — en QUEUE, et GATED : sur le plan
  //    complet les trois passes rendent [] — zéro nœud, zéro décalage, A14/A15bis intacts. ──
  const minerais = mineraisDesAffleurements(c, occupeesPlus(), id)
  for (const m of minerais) nodes.push(m)
  id += minerais.length
  const blocs = blocsDesAffleurements(c, occupeesPlus(), id)
  for (const b of blocs) nodes.push(b)
  id += blocs.length
  // ── LE CHAOS DE BLOCS — les galeries et ce qui les borde (2026-08-27) ──
  const chaosNodes = blocsDuChaos(c, chaos, occupeesDuChaos(), id)
  for (const b of chaosNodes) nodes.push(b)
  id += chaosNodes.length
  const carrieres = carrieresDeLEnceinte(c, occupeesPlus(), id)
  for (const q of carrieres) nodes.push(q)
  id += carrieres.length
  const futs = vieuxFutsDesCoeurs(c, occupeesPlus(), id)
  for (const f of futs) nodes.push(f)
  id += futs.length

  // ── LE GLANAGE (spec `glanage.md`) — il lit TOUTES les passes de bois et de pierre, donc
  //    il passe après elles ; mais AVANT la pêche, dont la spec exige les ids en queue (P5).
  //    Aucun conflit possible avec elle : un coin de pêche est sur l'eau, le glanage au sec. ──
  const glane = glanageAuSol(c, nodes, occupeesPlus(), id)
  for (const g of glane) nodes.push(g)
  id += glane.length

  // ── LES COINS DE PÊCHE (spec `peche.md` P3-P5) — en QUEUE : aucun nœud d'avant ne bouge ──
  const coins = coinsDePeche(c, occupeesPlus(), id)
  for (const k of coins) nodes.push(k)
  return nodes
}

/**
 * ═══ LE GLANAGE (spec `glanage.md` G3 — sel 'GLAN') ═══
 *
 * Ce qui TRAÎNE au pied de ce qu'on ne peut pas encore couper : une branche tombée sous un
 * arbre, une pierre détachée d'un rocher. Depuis que le bois et la pierre exigent un outil de
 * fortune, **c'est par ici que passe la première hache** — donc cette passe n'est pas de la
 * saveur, c'est l'amorçage de toute la rampe.
 *
 * DEUX PROPRIÉTÉS, et elles décident du reste :
 *
 * - **Elle est ANCRÉE sur un nœud parent**, jamais semée à plat. Le butin se cherche là où
 *   l'œil l'attend, et il APPREND la règle : on trouve du bois au pied des arbres qu'on ne
 *   sait pas encore abattre. Un semis indépendant aurait saupoudré des branches sur le pré nu.
 * - **Elle est la DERNIÈRE de la file**, et son tirage est positionnel (`hash2` sur la tuile
 *   du parent, sel neuf). Elle ne consomme aucun flux, elle ne décale aucun nœud d'avant : les
 *   passes existantes rendent, au nœud près, ce qu'elles rendaient. Ce qui change, c'est le
 *   COMPTE total — ce que les gardes de budget mesurent, et qu'on assume.
 *
 * Le parent choisit sa matière : l'arbre (ordinaire ou vieux fût) donne du bois, le rocher et
 * le bloc donnent de la pierre. Le butin se pose sur une tuile VOISINE libre — jamais sur le
 * parent, qui est occupé et souvent bloquant (un bloc remplit sa tuile) : on se baisse À CÔTÉ.
 */
const GLANAGE_PARENTS: Partial<Record<NodeType, NodeType>> = {
  tree: 'branche_au_sol',
  old_tree: 'branche_au_sol',
  rock: 'pierre_au_sol',
  bloc: 'pierre_au_sol',
}

/** Les huit voisins, dans un ordre FIXE — le tirage choisit par où on commence, pas qui gagne. */
const VOISINS_8: readonly (readonly [number, number])[] = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
]

function glanageAuSol(c: CarteZonee, parents: readonly ResourceNode[], occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x474c414e) | 0 // 'GLAN'
  const tour = (c.graphe.seed ^ 0x474c4132) | 0 // 'GLA2' — par où l'on commence à chercher la place
  for (const p of parents) {
    const type = GLANAGE_PARENTS[p.type]
    if (type === undefined) continue
    if (hash2(p.tx, p.ty, salt) >= CONTENU.GLANAGE_CHANCE) continue
    // La place : le premier voisin libre à partir d'un départ tiré. Sans ce décalage, tout le
    // glanage du monde se collerait au NORD de son parent — une régularité qui se voit.
    const depart = Math.min(VOISINS_8.length - 1, Math.floor(hash2(p.tx, p.ty, tour) * VOISINS_8.length))
    for (let k = 0; k < VOISINS_8.length; k++) {
      const [dx, dy] = VOISINS_8[(depart + k) % VOISINS_8.length]!
      const tx = p.tx + dx
      const ty = p.ty + dy
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue
      const t = terrain[i]!
      if (t === TERRAIN_ROAD) continue // une sente est un sol qu'on balaie (t0-exploration R18)
      if (!terrainAdmet(type, t)) continue
      out.push({ id, type, tx, ty, stock: NODE_DEFS[type].stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
      break
    }
  }
  return out
}

/**
 * ═══ LES COINS DE PÊCHE (spec `peche.md` P2-P5 — sel 'PECH') ═══
 *
 * Un coin est une tuile de HAUT-FOND qui TOUCHE le PROFOND (4-voisinage) : joignable depuis la
 * berge ou le gué (portée 1,5 t), et lisible — on pêche VERS le profond. Deux eaux, deux types :
 *
 * - **La rivière, aux coudes** : `estUnCoude` (l'unique définition) désigne les pivots du fil ; à
 *   chaque coude retenu, la tuile candidate de plus petit `hash2` gagne ; un coude n'est retenu
 *   que si le précédent retenu est à ≥ `PECHE_ESPACEMENT_FIL` pas de fil.
 * - **Les lacs, contre leur cœur** : chaque LAC est une composante 4-connexe de profond (BFS) ; ses
 *   candidates sont les tuiles P2 de sa berge dont le profond touché n'est PAS de la rivière (à
 *   plus de `PECHE_RAYON_RIVIERE` Chebyshev de tout point du fil — un lac que la rivière traverse
 *   a ses coudes ET ses coins de lac, loin du fil). Il reçoit `1 + floor(berge / PECHE_BERGE_PAR_COIN)`
 *   coins, plafonnés à `PECHE_MAX_PAR_LAC`, choisis par `hash2` croissant et écartés de
 *   `PECHE_ESPACEMENT_LAC`. En Racine, hors `lac_mort`. Déterministe, sans PRNG.
 *
 * Patron 'FIBR' : passe appendue en queue, tirage positionnel, aucun nœud existant ne bouge.
 * Racine seule (D3) : les eaux des autres zones attendent leur contenu T2.
 */
function coinsDePeche(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x50454348) | 0 // 'PECH'
  const fil = c.map.fil ?? []
  const estEnRacine = (i: number): boolean => c.zone[i] === c.graphe.racine
  const slugDe = (i: number): string => c.graphe.zones[c.zone[i]!]?.def.slug ?? ''
  const profondVoisin = (tx: number, ty: number): number => {
    const v = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const
    for (const [dx, dy] of v) {
      const x = tx + dx
      const y = ty + dy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const j = y * width + x
      if (terrain[j] === TERRAIN_DEEP_WATER) return j
    }
    return -1
  }
  /** Candidat P2 : haut-fond libre, hors seuil, touchant le profond. Rend l'index du profond ou −1. */
  const candidat = (tx: number, ty: number): number => {
    const i = ty * width + tx
    if (c.rampe[i] || occupees.has(i)) return -1
    if (terrain[i] !== TERRAIN_SHALLOW_WATER) return -1
    return profondVoisin(tx, ty)
  }

  // ── LA RIVIÈRE, AUX COUDES ──
  const R = EAU.RIVIERE_DEMI_LIT
  let dernierCoude = -Infinity
  for (let k = 1; k + 1 < fil.length; k++) {
    if (!estUnCoude(fil, k, width)) continue
    if (k - dernierCoude < CONTENU.PECHE_ESPACEMENT_FIL) continue
    const cx = fil[k]! % width
    const cy = (fil[k]! - cx) / width
    let meilleur = -1
    let meilleurH = 2
    for (let ty = cy - R; ty <= cy + R; ty++) {
      for (let tx = cx - R; tx <= cx + R; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        if (candidat(tx, ty) < 0) continue
        const h = hash2(tx, ty, salt)
        if (h < meilleurH) {
          meilleurH = h
          meilleur = ty * width + tx
        }
      }
    }
    if (meilleur < 0) continue
    const tx = meilleur % width
    const ty = (meilleur - tx) / width
    out.push({ id, type: 'fishing_spot_river', tx, ty, stock: NODE_DEFS.fishing_spot_river.stock, regrowAt: 0 })
    occupees.add(meilleur)
    id += 1
    dernierCoude = k
  }

  // ── LES LACS, CONTRE LEUR CŒUR ──
  // Le voisinage du fil : une tuile profonde à moins de PECHE_RAYON_RIVIERE Chebyshev du fil est
  // de la rivière, pas d'un lac. Un Set, construit une fois : O(fil × rayon²).
  const pres = new Set<number>()
  const RR = CONTENU.PECHE_RAYON_RIVIERE
  for (const i of fil) {
    const fx = i % width
    const fy = (i - fx) / width
    for (let y = fy - RR; y <= fy + RR; y++) {
      for (let x = fx - RR; x <= fx + RR; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        pres.add(y * width + x)
      }
    }
  }
  // Les LACS : composantes 4-connexes de profond, en Racine, hors Lac Mort — balayage row-major,
  // donc l'ordre des lacs (et des ids) est stable pour une carte donnée.
  const compDe = new Int32Array(width * height).fill(-1)
  let nbLacs = 0
  const berges: number[][] = [] // par lac : les index des tuiles candidates de sa berge
  for (let i = 0; i < width * height; i++) {
    if (compDe[i] !== -1 || terrain[i] !== TERRAIN_DEEP_WATER) continue
    if (!estEnRacine(i) || slugDe(i) === 'lac_mort') continue
    const lac = nbLacs
    nbLacs += 1
    const berge: number[] = []
    const vuBerge = new Set<number>()
    const pile = [i]
    compDe[i] = lac
    while (pile.length > 0) {
      const j = pile.pop()!
      const jx = j % width
      const jy = (j - jx) / width
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = jx + dx
        const y = jy + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const k = y * width + x
        if (terrain[k] === TERRAIN_DEEP_WATER) {
          if (compDe[k] === -1) {
            compDe[k] = lac
            pile.push(k)
          }
          continue
        }
        // Une tuile de berge candidate (P2) dont LE profond touché ici n'est pas de la rivière.
        if (vuBerge.has(k) || pres.has(j)) continue
        if (candidat(x, y) < 0) continue
        vuBerge.add(k)
        berge.push(k)
      }
    }
    berges.push(berge)
  }
  const E = CONTENU.PECHE_ESPACEMENT_LAC
  for (const berge of berges) {
    if (berge.length === 0) continue
    const quota = Math.min(CONTENU.PECHE_MAX_PAR_LAC, 1 + Math.floor(berge.length / CONTENU.PECHE_BERGE_PAR_COIN))
    const tries = berge
      .map((k) => ({ k, h: hash2(k % width, (k - (k % width)) / width, salt) }))
      .sort((a, b) => a.h - b.h || a.k - b.k)
    const choisis: { tx: number; ty: number }[] = []
    for (const { k } of tries) {
      if (choisis.length >= quota) break
      const tx = k % width
      const ty = (k - tx) / width
      if (choisis.some((l) => Math.max(Math.abs(l.tx - tx), Math.abs(l.ty - ty)) < E)) continue
      if (occupees.has(k)) continue // un coin de rivière a pu prendre cette tuile
      out.push({ id, type: 'fishing_spot_lake', tx, ty, stock: NODE_DEFS.fishing_spot_lake.stock, regrowAt: 0 })
      occupees.add(k)
      choisis.push({ tx, ty })
      id += 1
    }
  }
  return out
}

/**
 * ═══ LES MINERAIS DES AFFLEUREMENTS — le contenant donne le contenu (§2sexies R48) ═══
 *
 * Par le REGISTRE (`c.affleurements`), jamais en devinant le terrain : les `boulders` ordinaires
 * du pré ne sont pas des gisements. Un affleurement = UNE identité (ferreux OU charbonneux).
 * Répartition par pas constant dans la liste row-major des tuiles de rocaille — l'écartement
 * sans tirage ; le départ est salé positionnel ('AFFL'), le patron canonique du worldgen.
 */
/**
 * LE SOMMET D'UNE BUTTE — la tuile de rocaille la plus proche du centre du rect (balayage
 * row-major, comparaison stricte : ordre total, déterministe). Elle reste NUE de tout nœud :
 * le client y dresse le chicot du fer (render/buttes.ts calcule LA MÊME tuile — deux codes,
 * une règle : « la tuile de pierrier la plus proche du centre »).
 */
function sommetDeButte(c: CarteZonee, r: { x: number; y: number; w: number; h: number }): number {
  const { width, height, terrain } = c.map
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  let sommet = -1
  let bestD = Infinity
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
      if (terrain[ty * width + tx] !== TERRAIN_SCREE) continue
      const d = (tx + 0.5 - cx) * (tx + 0.5 - cx) + (ty + 0.5 - cy) * (ty + 0.5 - cy)
      if (d < bestD) { bestD = d; sommet = ty * width + tx }
    }
  }
  return sommet
}

/**
 * ═══ L'ÉCHINE D'UNE BUTTE, ET LA DISTANCE QUI EN DESCEND (Alexis, 2026-08-27) ═══
 *
 * *« une colonne vertébrale pour la butte avec les pierres les plus hautes, un dégradé de 2 ou 3
 * tuiles vers les pierres basses, puis le minerai / petite pierre autour. »*
 *
 * Deux champs, tirés de la seule forme du pierrier — donc rien d'arbitraire à régler :
 *   `prof`    la distance au premier non-pierrier (BFS 4-connexe depuis le bord de la butte) ;
 *   `dEchine` la distance à l'ÉCHINE, elle-même définie comme les **maxima locaux** de `prof`.
 *
 * ⚠ **L'ÉCHINE N'EST PAS « LES TUILES PROFONDES », ET LA DIFFÉRENCE EST TOUT LE SUJET.** Un seuil
 * sur `prof` (« ≥ 5 ») rend un DISQUE, pas une vertèbre : mesuré, 49 tuiles sur une butte de
 * profondeur 6 et **110** sur une de profondeur 9 — une tache, et qui double d'une graine à
 * l'autre. Les maxima locaux, eux, rendent une LIGNE : **28 à 50 tuiles par butte, en 3 à 5
 * morceaux dont un principal de 21 à 38** (mesuré, seed 2026). C'est la crête de la carte de
 * distance, soit exactement le squelette de la forme.
 *
 * Des `Map` locales, jamais un champ de `SimState` : donnée de GÉNÉRATION, elle meurt avec la
 * passe (même statut que `Affleurement`).
 */
const BUTTE = {
  /** L'épaisseur de la marche intermédiaire, en tuiles — « un dégradé de 2 ou 3 tuiles vers les
   *  pierres basses » (Alexis). Sur l'échine : la pierre HAUTE ; jusqu'ici : la moyenne ;
   *  au-delà : la basse. */
  DEGRADE: 2,
  /** Au-delà de cette distance à l'échine, on est « autour » : c'est là que se posent le minerai
   *  et les petites pierres. Un cran plus loin que le dégradé, pour que la couronne commence là
   *  où la pierre haute s'est déjà tue. */
  COURONNE: 4,
} as const

interface ReliefDeButte {
  /** Distance à l'échine, en tuiles. 0 = sur l'échine. */
  dEchine: Map<number, number>
}

/** Les paquets 8-connexes d'un ensemble de tuiles — l'échine en sort en 3 à 10 morceaux. */
function composantesDeLEchine(tuiles: readonly number[], width: number): number[][] {
  const dedans = new Set(tuiles)
  const vu = new Set<number>()
  const out: number[][] = []
  for (const i of tuiles) {
    if (vu.has(i)) continue
    const pile = [i]
    vu.add(i)
    const amas: number[] = []
    while (pile.length) {
      const k: number = pile.pop()!
      amas.push(k)
      const kx = k % width
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const v = k + dy * width + dx
          if (Math.abs((v % width) - kx) > 1) continue
          if (dedans.has(v) && !vu.has(v)) { vu.add(v); pile.push(v) }
        }
      }
    }
    out.push(amas)
  }
  return out
}

function reliefDeLaButte(c: CarteZonee, r: { x: number; y: number; w: number; h: number }): ReliefDeButte {
  const { width, height, terrain } = c.map
  const estRocaille = (i: number): boolean => i >= 0 && i < width * height && terrain[i] === TERRAIN_SCREE

  // ① LA PROFONDEUR — BFS multi-source depuis le bord du pierrier.
  const prof = new Map<number, number>()
  const file: number[] = []
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      const i = ty * width + tx
      if (tx < 0 || ty < 0 || tx >= width || ty >= height || !estRocaille(i)) continue
      // Le bord du monde compte comme bord de butte (une butte n'y touche jamais en pratique,
      // mais la garde évite qu'un `i - 1` déborde d'une ligne à l'autre).
      const bord = tx === 0 || ty === 0 || tx + 1 >= width || ty + 1 >= height
        || !estRocaille(i - 1) || !estRocaille(i + 1) || !estRocaille(i - width) || !estRocaille(i + width)
      if (bord) { prof.set(i, 1); file.push(i) }
    }
  }
  for (let t = 0; t < file.length; t++) {
    const k = file[t]!
    const p = prof.get(k)! + 1
    const kx = k % width
    for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < width ? k + 1 : -1, k - width, k + width]) {
      if (v < 0 || !estRocaille(v) || prof.has(v)) continue
      prof.set(v, p)
      file.push(v)
    }
  }

  // ② L'ÉCHINE — les maxima locaux de `prof` (4-connexe). Une tuile au moins aussi profonde que
  //    ses quatre voisines : la crête de la carte de distance.
  const echine: number[] = []
  for (const [i, p] of prof) {
    const ix = i % width
    let cime = true
    for (const v of [ix > 0 ? i - 1 : -1, ix + 1 < width ? i + 1 : -1, i - width, i + width]) {
      if (v >= 0 && (prof.get(v) ?? 0) > p) { cime = false; break }
    }
    if (cime) echine.push(i)
  }

  // ②bis ON RELIE LES VERTÈBRES — et c'est ce qui fait la différence entre une colonne et des
  //      morceaux. Les maxima locaux d'une forme quelconque sortent en 3 à 10 paquets (mesuré :
  //      une butte de la graine 7 n'avait pas une arête de plus de **5 tuiles**, quand la garde
  //      en demande 10). On raccorde donc chaque paquet au plus gros par un **chemin de crête**.
  //
  //      ⚠ **PAS LE PLUS COURT CHEMIN — celui qui reste le plus HAUT.** Un plus court chemin
  //      couperait au travers du flanc, et l'échine descendrait vers le bord pour rejoindre sa
  //      voisine : on obtiendrait une croix, pas une arête. C'est un maximin (on maximise la
  //      profondeur MINIMALE du trajet), le même patron que le chemin de goulot d'un cours d'eau,
  //      et il passe par les cols les plus élevés — ce que fait une ligne de crête.
  const morceaux = composantesDeLEchine(echine, width)
  if (morceaux.length > 1) {
    let tronc = morceaux[0]!
    for (const m of morceaux) if (m.length > tronc.length) tronc = m
    const dansEchine = new Set(echine)
    // Un maximin multi-source depuis le tronc : `meilleur[i]` = la plus haute « profondeur du
    // point le plus bas » d'un chemin de i au tronc ; `parent[i]` reconstruit ce chemin.
    const meilleur = new Map<number, number>()
    const parent = new Map<number, number>()
    const reste = new Set<number>(prof.keys())
    for (const i of tronc) meilleur.set(i, prof.get(i)!)
    for (;;) {
      // La tuile ouverte au meilleur score — balayage linéaire : une butte fait 320 tuiles, un
      // tas coûterait plus à lire qu'à exécuter.
      let k = -1
      let best = -Infinity
      for (const i of reste) {
        const v = meilleur.get(i)
        if (v !== undefined && v > best) { best = v; k = i }
      }
      if (k < 0) break
      reste.delete(k)
      const kx = k % width
      for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < width ? k + 1 : -1, k - width, k + width]) {
        if (v < 0 || !reste.has(v)) continue
        const score = Math.min(best, prof.get(v)!)
        if (score > (meilleur.get(v) ?? -Infinity)) { meilleur.set(v, score); parent.set(v, k) }
      }
    }
    for (const m of morceaux) {
      if (m === tronc) continue
      // Depuis la tuile la plus profonde du morceau, on remonte jusqu'à retomber sur l'échine.
      let depart = m[0]!
      for (const i of m) if (prof.get(i)! > prof.get(depart)!) depart = i
      let pas = parent.get(depart)
      let garde = 0
      while (pas !== undefined && !dansEchine.has(pas) && garde++ < 4096) {
        dansEchine.add(pas)
        echine.push(pas)
        pas = parent.get(pas)
      }
    }
  }

  // ③ LA DISTANCE À L'ÉCHINE — BFS multi-source depuis elle, dans le pierrier seul.
  const dEchine = new Map<number, number>()
  const file2: number[] = []
  for (const i of echine) { dEchine.set(i, 0); file2.push(i) }
  for (let t = 0; t < file2.length; t++) {
    const k = file2[t]!
    const d = dEchine.get(k)! + 1
    const kx = k % width
    for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < width ? k + 1 : -1, k - width, k + width]) {
      if (v < 0 || !prof.has(v) || dEchine.has(v)) continue
      dEchine.set(v, d)
      file2.push(v)
    }
  }
  return { dEchine }
}

/**
 * LA TAILLE D'UN BLOC DE BUTTE — dérivée de sa place dans la butte, plus du hash de sa tuile.
 * `BUTTE.DEGRADE` dit l'épaisseur de la marche intermédiaire (« un dégradé de 2 ou 3 tuiles »).
 */
function tailleSurLaButte(dEchine: number | undefined): 0 | 1 | 2 {
  if (dEchine === undefined) return 0
  if (dEchine === 0) return 2
  return dEchine <= BUTTE.DEGRADE ? 1 : 0
}

/** Les tuiles de rocaille LIBRES d'une butte (hors rampe, hors occupées, hors sommet). */
function rocailleLibre(c: CarteZonee, r: { x: number; y: number; w: number; h: number }, type: NodeType, occupees: Set<number>): number[] {
  const { width, height, terrain } = c.map
  const sommet = sommetDeButte(c, r)
  const libres: number[] = []
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
      const i = ty * width + tx
      if (i === sommet || c.rampe[i] || occupees.has(i)) continue
      if (terrain[i] !== TERRAIN_SCREE) continue // le contenant est la rocaille PEINTE, exactement
      if (!terrainAdmet(type, terrain[i]!)) continue
      libres.push(i)
    }
  }
  return libres
}

/** Répartition par pas constant dans la liste row-major — l'écartement sans tirage. */
function semerSurLaButte(
  libres: number[], n: number, depart: number, type: NodeType,
  width: number, occupees: Set<number>, id: number, out: ResourceNode[],
): void {
  for (let k = 0; k < n; k++) {
    const i = libres[Math.min(libres.length - 1, depart + Math.floor((k * libres.length) / n))]!
    if (occupees.has(i)) continue
    occupees.add(i)
    const tx = i % width
    out.push({ id: id + out.length, type, tx, ty: (i - tx) / width, stock: NODE_DEFS[type].stock, regrowAt: 0 })
  }
}

function mineraisDesAffleurements(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  const { width } = c.map
  const out: ResourceNode[] = []
  for (const aff of c.affleurements) {
    const type: NodeType = aff.ressource === 'fer' ? 'iron_vein' : 'coal_seam'
    // ⚠ **LE MINERAI SE POSE SUR LES GALERIES, ET C'EST LA MOITIÉ DE LA DEMANDE** — « on doit
    // pouvoir spawn des nodes accessibles dans la structure » (Alexis). Depuis que la butte est
    // un dédale, une tuile prise au hasard a une chance sur trois d'être au milieu d'une masse :
    // le filon serait VISIBLE et jamais atteignable sans creuser. On restreint donc les
    // candidates au vide du réseau — la même règle que la pierre du chaos, qui ne se pose que
    // sur ses joints. Repli SANS filtre si la butte n'offre aucune galerie libre : le plancher
    // R51 (« le compte ne cède jamais ») prime sur le confort d'accès.
    const toutes = rocailleLibre(c, aff.rect, type, occupees)
    const { dEchine } = reliefDeLaButte(c, aff.rect)
    const surGalerie = toutes.filter((i) => {
      const tx = i % width
      return galerieDuChaos(tx, (i - tx) / width, c.graphe.seed, MINE)
    })
    // ── ET LE MINERAI SE POSE « AUTOUR » (Alexis) : dans la COURONNE, au-delà du dégradé de
    //    pierre haute. L'anneau S'ÉLARGIT s'il ne tient pas le compte — c'est lui qui cède, pas
    //    les galeries : un filon un peu trop près de l'échine se voit à peine, un filon emmuré
    //    ment sur toute la mine (R6sexies ③, 100 % sans tolérance).
    const couronne = surGalerie.filter((i) => (dEchine.get(i) ?? 99) > BUTTE.COURONNE)
    // ⚠ **LE REPLI SE COMPARE À ZÉRO, PAS À LA CIBLE.** Écrit `surGalerie.length >= AFFL_NOEUDS`,
    // il tenait tant que la cible valait 4 ; à 12, toute butte offrant onze galeries libres
    // basculerait sur `toutes` — donc poserait des filons au milieu des masses, ce que
    // R6sexies ③ interdit à 100 %. On préfère TOUJOURS les galeries, quitte à en poser moins que
    // demandé : un filon de moins se voit à peine, un filon emmuré ment sur toute la mine. Le
    // plancher R51 reste tenu par A28, qui compte à l'échelle du pays et non de la butte.
    const libres = couronne.length >= CONTENU.AFFL_NOEUDS ? couronne
      : surGalerie.length > 0 ? surGalerie : toutes
    const n = Math.min(CONTENU.AFFL_NOEUDS, libres.length)
    if (n === 0) continue
    const depart = Math.floor(hash2(aff.rect.x, aff.rect.y, (c.graphe.seed ^ 0x4146464c) | 0) * (libres.length / n))
    semerSurLaButte(libres, n, depart, type, width, occupees, id + out.length, out)
  }
  return out
}

/**
 * ═══ LE CHAOS DE BLOCS — la caillasse qui BLOQUE, et la galerie qui la traverse ═══
 *
 * *(Demande d'Alexis, 2026-08-27 : « ok pour qu'il y ait des gros blocs de pierre, mais dans ce
 * cas, on les fait correspondre à la DA, on leur donne un hitbox pour éviter qu'on passe au
 * travers (tu les mets sur une tuile complète), et tu donnes une structure logique pour les
 * boulders si on doit en faire un mine labyrinthe (on doit pouvoir spawn des nodes accessibles
 * dans la structure). »)*
 *
 * Le `boulders` s'appelait « chaos de blocs » et n'en portait aucun : ses rochers étaient du
 * DÉCOR CLIENT (`BIOME_CLUTTER[TERRAIN_BOULDERS].props: ['boulder']`), donc on les traversait.
 * On ne dessine donc plus des blocs, **on en pose** — le type `bloc` existait déjà pour les
 * buttes, avec sa boîte pleine tuile (`blockHalfSub: 4`), ses trois tailles (`tailleDeBloc`) et
 * son art (`nd-bloc-<taille>`, flush, sans offset). Une seule règle, deux adresses.
 *
 * ═══ LA STRUCTURE : DES GALERIES D'ABORD, LES BLOCS DANS CE QUI RESTE ═══
 *
 * On ne sème pas des blocs en espérant qu'il reste un passage — **on trace le passage, puis on
 * remplit.** Un treillis de galeries ondulées, pas un damier : deux familles de bandes
 * continues (une par axe), décalées par un champ basse fréquence. Leur continuité tient par
 * ARITHMÉTIQUE et non par une garde : le décalage varie de `AMPLITUDE / ECHELLE_ONDULATION`
 * par tuile — cinq neuvièmes d'un dixième — donc une bande ne peut pas se replier sur
 * elle-même ni se rompre. Chaque bande court d'un bout à l'autre du chaos, les deux familles
 * se croisent : **tout le vide est d'un seul tenant, et il débouche.** Aucun flood fill, aucun
 * rattrapage a posteriori.
 *
 * ⚠ **ET LES NŒUDS SONT SUR LES GALERIES, PAS DANS LES MASSES.** C'est la seconde moitié de la
 * demande, et elle ne se tient pas par la chance : le chaos est déclaré STÉRILE pour le semis
 * commun (le patron des coulées), puis cette passe seule y repose sa pierre — sur les tuiles de
 * galerie, exactement. Un rocher enfermé dans six tuiles de bloc serait un nœud qu'on VOIT sans
 * pouvoir l'atteindre : le pire des deux mondes.
 *
 * Les masses, elles, sont ÉRODÉES par un second champ ('MASS') : sans lui, un treillis régulier
 * rendrait des carrés de six sur six — la géométrie même qu'Alexis vient de faire retirer du
 * terrain. Ce qui borde une galerie doit être aussi déchiqueté que ce qui borde un biome.
 */
const CHAOS = {
  /**
   * ═══ LA DALLE — le diamètre moyen d'un bloc de lapiaz, en tuiles ═══
   *
   * ⚠ **LE TREILLIS EST MORT, ET C'EST UN CHANGEMENT DE GÉNÉRATEUR, PAS DE RÉGLAGE.**
   * *(Alexis, 2026-08-27, troisième passe : « j'ai toujours l'impression de voir un damier dans
   * les boulders, toutes les chemins sont trop alignés. »)* Les deux passes précédentes avaient
   * élargi le méandre (±2,5 → ±7) et fait respirer la largeur des allées — en pure perte, et
   * pour une raison qui n'était pas une question de degré : **un `modulo` sur x et un `modulo`
   * sur y SONT une grille**, quelle que soit l'amplitude qu'on leur ajoute. Deux familles de
   * bandes perpendiculaires à période fixe se lisent comme un damier même déformées, parce que
   * l'œil retrouve les deux directions et le pas.
   *
   * Le réseau se dérive donc d'un **VORONOÏ** : un semis de sites sur une grille jitterée, et la
   * galerie est le JOINT entre deux dalles voisines (`F2 − F1 < largeur`, le patron de Worley).
   * Il n'y a plus de direction privilégiée, plus de période, et les dalles ont des formes et des
   * tailles toutes différentes. C'est aussi, littéralement, la géométrie d'un lapiaz : des
   * dalles de calcaire séparées par des fissures d'élargissement.
   *
   * ═══ ET LA CONNEXITÉ TIENT TOUJOURS PAR CONSTRUCTION ═══
   *
   * Le graphe des arêtes d'un diagramme de Voronoï est **connexe dans le plan** : chaque dalle
   * est entièrement ceinte de joint, et deux joints voisins se rejoignent à un sommet. La bande
   * `F2 − F1 < largeur` est un voisinage de ce graphe, donc connexe elle aussi, et elle atteint
   * la rive du chaos puisqu'elle entoure la dalle de rive. Aucun flood fill, aucun rattrapage.
   * MESURÉ après coup, trois graines : le vide du chaos est joint au reste du monde à
   * **99,91 · 100,00 · 99,94 %**.
   *
   * 11 tuiles : la dalle qui redonne la densité validée par Alexis — **31 · 27 · 27 % du cœur
   * muré**, contre 31 · 29 · 27 % du treillis d'avant. « Laisse comme c'est » porte sur le
   * dédale, pas sur la façon de le dessiner.
   */
  DALLE: 11,
  /**
   * LA LARGEUR DU JOINT, en tuiles — de `JOINT_MIN` (un passage) à `JOINT_MAX` (une placette),
   * tirée d'un champ basse fréquence ('LARG'). Une largeur constante était l'autre moitié du
   * « trop aligné » : toutes les allées se ressemblaient, donc l'œil les comptait.
   *
   * ⚠ Ce sont des demi-largeurs de la BANDE `F2 − F1`, pas des largeurs en tuiles : près d'une
   * arête, `F2 − F1` croît d'environ deux quand on s'écarte d'une tuile. Un joint à 2 fait donc
   * une allée d'à peu près deux tuiles — le pincement reste franchissable.
   */
  JOINT_MIN: 2,
  JOINT_MAX: 4.5,
  /** L'échelle du champ de largeur, en tuiles. Longue : une allée garde sa largeur sur
   *  plusieurs écrans, elle ne clignote pas d'une tuile à l'autre. */
  ECHELLE_LARGEUR: 70,
  /** L'échelle de l'érosion des masses, en tuiles. Fine : c'est du grain de bord, pas une
   *  seconde géographie. */
  ECHELLE_MASSE: 7,
  /** Au-dessus : du bloc. Sous : de la rocaille qu'on enjambe. */
  SEUIL_MASSE: 0.42,
  /**
   * ⚠ `EROSION_PORTEE` A ÉTÉ RETIRÉE le 2026-08-27 — *« retire l'érosion de boulders dans tous
   * les cas »* (Alexis). Elle faisait décroître la masse vers l'extérieur (seuil montant à 1 sur
   * la première tuile de rive), pour répondre à un « trop damier » qui venait en réalité d'AILLEURS
   * : la découpe au motif de 8 du lapiaz, et le treillis à modulo des galeries. Les deux sont
   * corrigés — la frontière se lit à la tuile, les galeries sont les joints d'un Voronoï — et
   * l'érosion n'avait plus qu'un effet : maigrir le chaos sur sa rive, donc l'ouvrir là où il
   * devrait justement se présenter comme un mur. Le chaos est PLEIN jusqu'à son bord ; c'est le
   * contour du lapiaz qui fait sa forme, pas une décroissance de densité.
   */
} as const

/**
 * LES DEUX PLUS PROCHES SITES — `F1` et `F2` de Worley, sur une grille jitterée de `DALLE`.
 *
 * Un site par case de la grille, posé par `hash2` : la grille garantit la COUVERTURE (pas de
 * dalle géante), le jitter tue sa régularité. Neuf cases suffisent — un site ne peut pas être
 * plus proche depuis plus loin que sa case et ses voisines.
 *
 * Pur : `+ - * /`, `floor`, `sqrt`, `hash2`.
 */
function deuxPlusProches(tx: number, ty: number, sel: number, dalle: number): { f1: number; f2: number } {
  const S = dalle
  const gx = Math.floor(tx / S)
  const gy = Math.floor(ty / S)
  const selY = (sel ^ 0x5a5a5a5a) | 0
  let f1 = Infinity
  let f2 = Infinity
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx
      const cy = gy + dy
      const ex = (cx + hash2(cx, cy, sel)) * S - tx
      const ey = (cy + hash2(cx, cy, selY)) * S - ty
      const d = Math.sqrt(ex * ex + ey * ey)
      if (d < f1) { f2 = f1; f1 = d } else if (d < f2) { f2 = d }
    }
  }
  return { f1, f2 }
}

/**
 * LA TUILE EST-ELLE SUR UNE GALERIE ? Fonction PURE de la tuile — le patron de `tailleDeBloc` :
 * la sim en fait le vide, et n'importe quel instrument peut la relire sans rien transporter.
 *
 * Une galerie est le JOINT entre deux dalles : l'endroit où l'on est à peu près à égale distance
 * des deux sites les plus proches. Pas de modulo, donc pas de période ; pas d'axe, donc pas de
 * direction privilégiée.
 */
export function galerieDuChaos(tx: number, ty: number, seed: number, taille: TailleDuReseau = CHAOS): boolean {
  const { f1, f2 } = deuxPlusProches(tx, ty, (seed ^ 0x4a4f494e) | 0 /* 'JOIN' */, taille.DALLE)
  const larg = taille.JOINT_MIN
    + fbm2(tx, ty, CHAOS.ECHELLE_LARGEUR, (seed ^ 0x4c415247) | 0 /* 'LARG' */)
      * (taille.JOINT_MAX - taille.JOINT_MIN)
  return f2 - f1 < larg
}

/**
 * ═══ LE CHAMP DU CHAOS — la MÊME géométrie, rendue CONTINUE pour que l'ART puisse la dessiner ═══
 *
 * *(Décision d'Alexis, 2026-08-27, tranchée sur planche : « go 3 » — le sol du lapiaz dessine
 * ses dalles.)*
 *
 * `galerieDuChaos` répond oui/non À LA TUILE : c'est ce dont la sim a besoin, et rien de plus.
 * Le SOL, lui, se cuit à 16 px par tuile (`render/paves.ts`) — peindre l'allée depuis un booléen
 * par tuile rendrait des bords carrés, très exactement la géométrie que R6bis vient de retirer
 * du terrain. Cette fonction rend donc l'ÉCART NORMALISÉ au joint, lisible à la FRACTION de
 * tuile :
 *
 *   **0** au cœur de l'allée · **1** à son bord exact · **> 1** sur la dalle.
 *
 * ⚠ **ELLE NE REDÉFINIT PAS LE PRÉDICAT, ET C'EST DÉLIBÉRÉ.** Réécrire `galerieDuChaos` en
 * `champDuChaos(...) < 1` serait la même règle en algèbre exacte — mais pas au bit près : une
 * division peut arrondir une tuile de frontière d'un côté à l'autre, et une galerie qui bascule
 * DÉPLACE un nœud, donc décale le flux du PRNG seedé (roche-mère R9, mémoire « RNG fragile au
 * décompte d'entités »). Les deux vivent donc côte à côte, et une garde EXHAUSTIVE affirme leur
 * accord sur les VRAIES tuiles du monde joué (`chaos.test.ts`) — le patron de `tailleDeBloc` :
 * une seule vérité, deux lecteurs.
 *
 * Pure : `+ - * /`, `sqrt`, `hash2`, `fbm2`.
 */
export function champDuChaos(fx: number, fy: number, seed: number, taille: TailleDuReseau = CHAOS): number {
  const { f1, f2 } = deuxPlusProches(fx, fy, (seed ^ 0x4a4f494e) | 0 /* 'JOIN' */, taille.DALLE)
  const larg = taille.JOINT_MIN
    + fbm2(fx, fy, CHAOS.ECHELLE_LARGEUR, (seed ^ 0x4c415247) | 0 /* 'LARG' */)
      * (taille.JOINT_MAX - taille.JOINT_MIN)
  return (f2 - f1) / larg
}

/**
 * ═══ LE RÉSEAU SE MET À L'ÉCHELLE DE SON CONTENANT (Alexis, 2026-08-27 : « le même traitement
 * […] sur les mines de charbon et de fer ») ═══
 *
 * Le dédale du lapiaz se déploie sur des milliers de tuiles ; une butte d'affleurement en fait
 * **320**. La dalle de 11 y poserait deux ou trois sites — pas un dédale, du bruit. On ne
 * grossit pas la butte pour autant (ce serait déplacer `AFFL_ECART`, les lectures de distance
 * de `poi.ts` et l'écartement gardé par A30) : c'est le RÉSEAU qui change de pas.
 *
 * ⚠ **LES DEUX RÉGLAGES SE TIENNENT PAR UN RAPPORT, PAS PAR DEUX NOMBRES.** La part murée
 * dépend de `JOINT / DALLE` : halver la dalle sans halver le joint noierait la butte sous le
 * vide (la bande `F2 − F1 < 2` autour de dalles de 5 couvre presque tout). `MINE` est donc
 * `CHAOS` à l'échelle 1/2, au rapport près — et c'est ce qui lui rend la densité validée.
 */
export interface TailleDuReseau { readonly DALLE: number; readonly JOINT_MIN: number; readonly JOINT_MAX: number }

export const MINE: TailleDuReseau = {
  DALLE: 5.5,
  JOINT_MIN: 1,
  JOINT_MAX: 2.25,
}

/**
 * LES TUILES DU CHAOS — le `boulders` marchable de la Racine, hors seuil et hors sente.
 * Calculé UNE fois en tête de `placeZoneNodes` : le semis commun s'en sert comme masque
 * stérile, cette passe comme domaine. Un seul prédicat, deux lecteurs.
 */
function tuilesDuChaos(c: CarteZonee): number[] {
  // ⚠ **LE MONDE RÉDUIT SEUL, ET LA RACINE SEULE** — deux gardes, deux raisons distinctes.
  //
  // ① Le plan `'vallee'` DORT (A31 : « zéro nœud neuf »), et son `boulders` ne vient pas d'un
  //    lapiaz : c'est la palette de quatre zones de marge (Karst, Aiguilles, Gouffre,
  //    Cendrière), dont le contenu est explicitement différé. Mesuré sans cette garde :
  //    **83 234 blocs** sur le plan complet — un budget de nœuds doublé pour un pays que
  //    personne ne joue.
  // ② Dans le monde réduit, tout le `boulders` EST le cœur d'un lapiaz, donc de la Racine
  //    (`poserLesLapiaz` ne peint que chez elle). La garde de zone dit la même chose que la
  //    géologie — elle ne restreint rien, elle l'ÉCRIT.
  if ((c.graphe.monde ?? 'vallee') !== 'racine') return []
  const { width, height, terrain } = c.map
  const out: number[] = []
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (terrain[i] !== TERRAIN_BOULDERS) continue
      if (c.rampe[i]) continue
      if (c.zone[i] !== c.graphe.racine) continue
      out.push(i)
    }
  }
  return out
}

/**
 * LES BLOCS DU CHAOS, et la pierre de ses galeries. Deux nœuds, une passe : ce qui bouche et ce
 * qui se ramasse se décident au même endroit, donc ils ne peuvent pas se contredire.
 */
function blocsDuChaos(c: CarteZonee, chaos: readonly number[], occupees: Set<number>, id: number): ResourceNode[] {
  const { width } = c.map
  const out: ResourceNode[] = []
  const seed = c.graphe.seed
  const selMasse = (seed ^ 0x4d415353) | 0 /* 'MASS' */
  const selPierre = (seed ^ 0x43485052) | 0 /* 'CHPR' */
  for (const i of chaos) {
    if (occupees.has(i)) continue
    const tx = i % width
    const ty = (i - tx) / width
    if (galerieDuChaos(tx, ty, seed)) {
      // LA GALERIE PORTE LA RÉCOLTE. Même densité que le semis commun de la zone y posait avant
      // qu'elle ne devienne stérile — on n'a pas appauvri le chaos, on a DÉPLACÉ sa pierre là
      // où l'on peut aller la chercher.
      if (hash2(tx, ty, selPierre) >= CONTENU.CHAOS_PART_PIERRE) continue
      occupees.add(i)
      out.push({ id: id + out.length, type: 'rock', tx, ty, stock: NODE_DEFS.rock.stock, regrowAt: 0 })
      continue
    }
    // LA MASSE, sans décroissance de rive (l'érosion est tombée le 2026-08-27) : un seul seuil,
    // le même au bord et au cœur. Le chaos se présente donc comme un mur, et c'est le contour du
    // lapiaz — dentelé à la tuile — qui lui donne sa forme.
    if (fbm2(tx, ty, CHAOS.ECHELLE_MASSE, selMasse) <= CHAOS.SEUIL_MASSE) continue
    occupees.add(i)
    out.push({ id: id + out.length, type: 'bloc', tx, ty, stock: BLOC_STOCKS[tailleDeBloc(tx, ty)], regrowAt: 0 })
  }
  return out
}

/**
 * LA TAILLE D'UN BLOC — pure fonction de la tuile, PARTAGÉE sim/client (le patron
 * `treeJitter` : « même fonction pure que la collision, sprite et règle coïncident »).
 * Le sim en fait le STOCK (un gros bloc se taille plus longtemps), le client en fait
 * l'ART (`nd-bloc-<taille>`) — deux lectures, une vérité, aucune donnée transportée.
 */
export function tailleDeBloc(tx: number, ty: number): 0 | 1 | 2 {
  return Math.min(2, Math.floor(hash2(tx, ty, 0x7a11e) * 3)) as 0 | 1 | 2
}
/** Le stock par taille de bloc — la taille EST la résistance. */
export const BLOC_STOCKS: readonly [number, number, number] = [8, 12, 18]

/**
 * ═══ LES BLOCS DES BUTTES — « un bloc = une tuile pleine de non traversable » (Alexis) ═══
 *
 * Le chaos de pierres qui peuple une butte n'est pas du décor : ce sont de VRAIS nœuds `bloc`
 * (mémoire du projet : « ajoute X » = objets de jeu réels). Chacun REMPLIT sa tuile — boîte
 * pleine (`blockHalfSub: 4`), art pleine tuile SANS offset côté client — et bloque tant qu'il
 * a du stock : se frayer un passage se CREUSE, à mains nues. Trois TAILLES (`tailleDeBloc`),
 * et la taille fait le stock. Semés APRÈS les minerais, jamais sur le sommet, agrégés en
 * masses de 1-3 tuiles. Le décor client ne garde que les moellons qu'on enjambe (INV-2).
 */
function blocsDesAffleurements(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  const { width, terrain } = c.map
  const out: ResourceNode[] = []
  for (const aff of c.affleurements) {
    // ══ LA BUTTE EST UN DÉDALE, PLUS UN SEMIS (Alexis, 2026-08-27) ══════════════════════════
    //
    // Elle posait `AFFL_BLOCS` plots par pas constant dans la liste row-major, chacun s'agrégeant
    // un voisin une fois sur deux : une dizaine de cailloux épars sur 320 tuiles. C'est
    // exactement ce que le chaos du lapiaz faisait avant qu'il devienne une structure, et la
    // demande est la même — *« le même traitement sur les frontières et la structure sur les
    // mines de charbon et de fer »*. Le réseau est donc le MÊME générateur (`galerieDuChaos`),
    // à l'échelle de `MINE` : ce qui n'est pas galerie et que le champ de masse retient devient
    // un bloc. Le compte cesse d'être un réglage — il DÉRIVE de la surface de la butte.
    // ── ET LA PIERRE SE RANGE PAR HAUTEUR (Alexis, 2026-08-27) : la HAUTE sur l'échine, la
    //    moyenne sur `BUTTE.DEGRADE` tuiles de descente, la basse au-delà. La taille cesse
    //    d'être un hash de la tuile pour devenir une PLACE dans la butte — elle est donc portée
    //    par le nœud (`size`), le client ne pouvant pas redériver la forme de la butte.
    const sel = (c.graphe.seed ^ 0x424c4f43) | 0 /* 'BLOC' */
    const sommet = sommetDeButte(c, aff.rect)
    const { dEchine } = reliefDeLaButte(c, aff.rect)
    for (let ty = aff.rect.y; ty < aff.rect.y + aff.rect.h; ty++) {
      for (let tx = aff.rect.x; tx < aff.rect.x + aff.rect.w; tx++) {
        const i = ty * width + tx
        if (i === sommet || occupees.has(i) || c.rampe[i]) continue
        if (terrain[i] !== TERRAIN_SCREE) continue
        const size = tailleSurLaButte(dEchine.get(i))
        // ⚠ **L'ÉCHINE PORTE SA PIERRE, QUOI QU'EN DISENT LE RÉSEAU ET LE CHAMP DE MASSE.**
        //
        // Sans cette exception, la colonne vertébrale existait dans la géométrie et disparaissait
        // à la pose : mesuré, la crête fait 28 à 50 tuiles d'un seul tenant sur 13 à 38, mais
        // **8 à 42 % seulement portaient un bloc** — les galeries la traversaient, le champ de
        // masse en retirait encore — et la plus longue chaîne de pierres hautes retombait à
        // **1 à 8**. Sur une butte, 36 tuiles de crête continue rendaient UN bloc haut. On avait
        // dessiné une vertèbre et posé du gravier.
        //
        // Le prix, chiffré avant de le prendre : **+16 à +37 blocs**, part murée **18-36 % →
        // 29-41 %**, et la butte se trouve coupée en deux — ce qui est très exactement la
        // « crique » demandée, deux anses de part et d'autre d'une arête. Le minerai, lui, ne
        // paie rien : il est en COURONNE, donc à l'extérieur de la crête, joignable des deux
        // côtés — **12/12 vérifié avant et après**.
        if (size !== 2) {
          if (galerieDuChaos(tx, ty, c.graphe.seed, MINE)) continue
          if (fbm2(tx, ty, CHAOS.ECHELLE_MASSE, sel) <= CHAOS.SEUIL_MASSE) continue
        }
        occupees.add(i)
        out.push({ id: id + out.length, type: 'bloc', tx, ty, stock: BLOC_STOCKS[size], regrowAt: 0, size })
      }
    }
  }
  return out
}

/**
 * ═══ LES CARRIÈRES DE L'ENCEINTE — on taille la montagne, pas le pré (§2sexies R49) ═══
 *
 * Candidates : les tuiles marchables de la racine au CONTACT ORTHOGONAL de la roche, hors
 * seuils et routes. Les postes s'écartent au MAX-MIN (le patron des points de spawn), départ
 * salé ('CARR') ; autour de chaque poste, quelques nœuds `quarry` sur les candidates voisines.
 *
 * ⚠ LA CLAUSE « LÀ OÙ LE FRONT N'ARRIVE JAMAIS » EST TOMBÉE (2026-08-24) avec le front. Elle
 * excluait d'office le mur de la frontière Cendrière, dont les abords brûlaient ; il n'y a plus
 * ni Cendrière ni front, et la garde `cendreMax === undefined` rendait `[]` — **zéro carrière
 * sur toute la carte**, en silence. Le pied de l'enceinte suffit à les porter.
 */
function carrieresDeLEnceinte(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  if ((c.graphe.monde ?? 'vallee') !== 'racine') return []
  const { width, height, terrain } = c.map
  const candidates: number[] = []
  for (let ty = 1; ty < height - 1; ty++) {
    for (let tx = 1; tx < width - 1; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue
      if (c.rampe[i] || occupees.has(i)) continue
      const t = terrain[i]!
      if (t === TERRAIN_ROAD || !TERRAINS[t]?.walkable) continue
      if (terrain[i - 1] !== TERRAIN_ROCK && terrain[i + 1] !== TERRAIN_ROCK
        && terrain[i - width] !== TERRAIN_ROCK && terrain[i + width] !== TERRAIN_ROCK) continue
      if (!terrainAdmet('quarry', t)) continue
      candidates.push(i)
    }
  }
  if (candidates.length === 0) return []

  const sel = (c.graphe.seed ^ 0x43415252) | 0 /* 'CARR' */
  const postes: number[] = [candidates[Math.min(candidates.length - 1, Math.floor(hash2(candidates.length, 0, sel) * candidates.length))]!]
  while (postes.length < CONTENU.CARRIERES) {
    let best = -1
    let bestD = -1
    for (const i of candidates) {
      const tx = i % width
      const ty = (i - tx) / width
      let d = Infinity
      for (const p of postes) {
        const px = p % width
        const py = (p - px) / width
        const dd = (tx - px) * (tx - px) + (ty - py) * (ty - py)
        if (dd < d) d = dd
      }
      if (d > bestD) { bestD = d; best = i }
    }
    if (best < 0 || bestD <= 0) break
    postes.push(best)
  }

  const out: ResourceNode[] = []
  const R2 = CONTENU.CARRIERE_RAYON * CONTENU.CARRIERE_RAYON
  for (const p of postes) {
    const px = p % width
    const py = (p - px) / width
    const proches = candidates.filter((i) => {
      const tx = i % width
      const ty = (i - tx) / width
      return (tx - px) * (tx - px) + (ty - py) * (ty - py) <= R2
    })
    const n = Math.min(CONTENU.CARRIERE_NOEUDS, proches.length)
    for (let k = 0; k < n; k++) {
      const i = proches[Math.min(proches.length - 1, Math.floor((k * proches.length) / n))]!
      if (occupees.has(i)) continue
      occupees.add(i)
      const tx = i % width
      out.push({ id: id + out.length, type: 'quarry', tx, ty: (i - tx) / width, stock: NODE_DEFS.quarry.stock, regrowAt: 0 })
    }
  }
  return out
}

/**
 * ═══ LES VIEUX FÛTS DES CŒURS — le gros bois vit au fond des bois (§2sexies R50) ═══
 *
 * `old_tree` (stock standard, pas un teaser) dans les cellules CŒUR des massifs de la racine
 * (§2quater), HORS Bois Noir — son teaser garde son récit. Repli R51 : si aucune cellule cœur
 * n'existe à cette échelle, le tuile boisée la plus PROFONDE fait l'affaire. Postes au max-min,
 * même patron que les carrières.
 */
function vieuxFutsDesCoeurs(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  if ((c.graphe.monde ?? 'vallee') !== 'racine') return []
  const { width, height, terrain } = c.map
  const boisNoir = c.map.zones.find((z) => z.kind === 'bois_noir')
  const dansBoisNoir = (tx: number, ty: number): boolean =>
    boisNoir !== undefined && tx >= boisNoir.x && tx < boisNoir.x + boisNoir.w && ty >= boisNoir.y && ty < boisNoir.y + boisNoir.h
  const coeurs: number[] = []
  let repli = -1
  let repliProf = 0
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue
      if (c.rampe[i] || occupees.has(i)) continue
      if (!terrainAdmet('old_tree', terrain[i]!)) continue
      if (dansBoisNoir(tx, ty)) continue
      const d = profondeurAt(c.map, tx, ty)
      if (estCoeur(d)) coeurs.push(i)
      if (d > repliProf) { repliProf = d; repli = i }
    }
  }
  const bassin = coeurs.length > 0 ? coeurs : repli >= 0 ? [repli] : []
  if (bassin.length === 0) return []

  const sel = (c.graphe.seed ^ 0x46555453) | 0 /* 'FUTS' */
  const postes: number[] = [bassin[Math.min(bassin.length - 1, Math.floor(hash2(bassin.length, 1, sel) * bassin.length))]!]
  while (postes.length < CONTENU.VIEUX_FUTS) {
    let best = -1
    let bestD = -1
    for (const i of bassin) {
      const tx = i % width
      const ty = (i - tx) / width
      let d = Infinity
      for (const p of postes) {
        const px = p % width
        const py = (p - px) / width
        const dd = (tx - px) * (tx - px) + (ty - py) * (ty - py)
        if (dd < d) d = dd
      }
      if (d > bestD) { bestD = d; best = i }
    }
    if (best < 0 || bestD <= 0) break
    postes.push(best)
  }

  const out: ResourceNode[] = []
  for (const i of postes) {
    if (occupees.has(i)) continue
    occupees.add(i)
    const tx = i % width
    out.push({ id: id + out.length, type: 'old_tree', tx, ty: (i - tx) / width, stock: NODE_DEFS.old_tree.stock, regrowAt: 0 })
  }
  return out
}

/**
 * UN vieil arbre dans le Bois Noir, au stock dérisoire (spec t0-exploration R11).
 *
 * Même grammaire que le Filon affleurant : « le gros bois existe. Pas ici. » Le joueur qui a
 * compris le fer comprend le bois sans un mot. C'est la SECONDE exception déclarée à
 * l'exclusivité des structurantes (worldgen R9/A14) — un teaser informe, il n'équipe pas :
 * `TEASER_STOCK` coups et il est mort, quand la Vieille Sylve en porte des centaines.
 *
 * Déterminisme : choix positionnel salé ('VIEU') parmi les tuiles admissibles de l'empreinte,
 * balayées en row-major — aucun tirage sur le PRNG partagé, aucun décalage de flux.
 */
function teaserDuBoisNoir(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode | null {
  const { width, terrain } = c.map
  const bois = c.map.zones.find((z) => z.kind === 'bois_noir')
  if (!bois) return null
  const libres: number[] = []
  for (let ty = Math.floor(bois.y); ty < bois.y + bois.h; ty++) {
    for (let tx = Math.floor(bois.x); tx < bois.x + bois.w; tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= c.map.height) continue
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue
      if (!terrainAdmet('old_tree', terrain[i]!)) continue
      libres.push(i)
    }
  }
  if (libres.length === 0) return null
  const k = Math.min(libres.length - 1, Math.floor(hash2(bois.x, bois.y, (c.graphe.seed ^ 0x56494555) | 0) * libres.length))
  const i = libres[k]!
  return { id, type: 'old_tree', tx: i % width, ty: (i - (i % width)) / width, stock: CONTENU.TEASER_STOCK, regrowAt: 0 }
}

/**
 * LE VERGER SAUVAGE PORTE ENFIN DES FRUITS.
 *
 * C'était un lieu VIDE : `family: 'eco'`, aucune charge de découverte, aucun contenu — un nom
 * posé sur de l'herbe ordinaire. Deux des cinq lieux de la zone de départ étaient dans ce cas,
 * et c'est exactement ce qui rend une carte T0 décevante : on marche vers quelque chose qui
 * s'annonce, et il n'y a rien. Trouver un verger DOIT payer.
 *
 * Ce qu'il pose : de VRAIS buissons à baies récoltables (mémoire de projet : « ajoute X au
 * biome Y » veut dire de vrais nœuds, pas du décor ni une teinte), densément, dans son
 * empreinte. C'est une récompense de NOURRITURE — la ressource qui compte le plus tôt.
 *
 * DÉTERMINISME : décision par tuile via `hash2` salé d'une constante ASCII neuve ('VERG'), le
 * patron canonique du worldgen. Aucun tirage sur le PRNG partagé, aucune entité — donc aucun
 * décalage de flux. Et rien qui touche la marchabilité : on n'ajoute que des nœuds.
 */
/**
 * LES CHAMPIGNONS (spec recolte-maitrise verbe 3). Un patch pousse là où c'est adapté : ABONDANT
 * à l'humide/l'ombre franche (marais, tourbière, roselière, sous-bois de vieille sylve), TRÈS RARE
 * sur le sol des forêts ordinaires (`forest` — quelques-uns dans les bois de la zone T0, demande
 * d'Alexis). Nulle part ailleurs. VISIBLE de tous (un trajet) ; le SAVOIR pour le récolter est gaté
 * à part (`NodeDef.minForageLevel`, jugé dans `economy.strikeRejection`).
 *
 * PASSE SÉPARÉE, appendue (comme `vergersSauvages`/`arbresDeLaRacine`) : elle ne touche pas la table
 * `CONTENUS`, donc aucun nœud existant ne bouge et le flux de génération n'est pas décalé (leçon RNG).
 * Tirage POSITIONNEL (`hash2` salé de 'MUSH'), aucun PRNG partagé, sur tuile LIBRE (hors seuil, hors
 * tuile déjà occupée). Pur et déterministe.
 */
/**
 * LE STOCK DE NAISSANCE D'UN ARBRE (spec §2quater R40) — le VIEUX FÛT du cœur : stock majoré
 * `×VIEUX_FUT_FACTEUR`. FONCTION PURE de la position, appliquée au semis ET réappliquée à la
 * repousse (`economy.ts` : la repousse remet le stock au défaut du type — une donnée
 * d'instance mourrait au premier épuisement, le patron `withForageRichness`). Jamais en
 * futaie ancienne : le Bois Noir garde sa doctrine du teaser (« le gros bois existe. Pas
 * ici. ») — le cœur majore l'ORDINAIRE, il n'importe jamais une structurante. Et le bonus
 * MEURT AVEC L'ARBRE (R38) : la tuile déboisée depuis l'amorce rend le défaut, l'étiquette
 * de profondeur restant inerte.
 */
export function stockDArbre(map: WorldMap, tx: number, ty: number): number {
  const base = NODE_DEFS.tree.stock
  const t = terrainAt(map, tx, ty)
  if (t === TERRAIN_OLD_GROWTH || !TERRAINS_BOISES_MASSIF.includes(t)) return base
  return estCoeur(profondeurAt(map, tx, ty)) ? Math.round(base * CONTENU.VIEUX_FUT_FACTEUR) : base
}

/**
 * LES BAIES DE LA CLAIRIÈRE (spec §2quater R40, révisé le 2026-08-25 — sel 'LISI' conservé).
 *
 * **C'ÉTAIT « LES BAIES DE LISIÈRE ».** R40 disait : le massif porte du jeu, sa bande de bord
 * (1 ≤ d ≤ PROF_LISIERE) donne les baies, son cœur donne les champignons. La règle garde sa
 * NATURE — *la baie pousse là où la lumière touche le sol du massif* — et change d'ADRESSE :
 * Alexis a retiré la baie du biome forêt, et la lisière est du bois. La trouée ne l'est pas.
 *
 * Ce n'est pas un appauvrissement de R40, c'est sa moitié claire qui trouve enfin un lieu à
 * elle : une bande de lisière est un bord qu'on longe, une clairière est un endroit où l'on
 * entre. Le pré qui touche le bois, lui, gardait déjà son plein régime par
 * `AFFINITE_BAIE_OUVERT` — l'idée « la baie veut le bord » n'a rien perdu.
 *
 * Passe appendue en queue, tirage positionnel — patron 'FIBR' : la table `CONTENUS` n'est pas
 * touchée, aucun nœud existant ne bouge, le flux de génération n'est pas décalé.
 */
function baiesDeLaClairiere(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x4c495349) | 0 // 'LISI' — le sel de la lisière, conservé
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue // le seuil ne nourrit rien ; tuile prise
      if (terrain[i] !== TERRAIN_CLAIRIERE) continue
      if (hash2(tx, ty, salt) >= CONTENU.BAIES_CLAIRIERE) continue
      out.push({ id, type: 'berry_bush', tx, ty, stock: NODE_DEFS.berry_bush.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LES CHAMPIGNONS DU CŒUR (spec §2quater R40 — sel 'COEU'). Le cœur DONNE : un régime ×5 le
 * sol des forêts communes (`CHAMPIGNON_COEUR` vs `CHAMPIGNON_FORET`), là où seuls les grands
 * massifs mènent. `terrainAdmet` reste la loi : pin et mélèze n'en portent pas (verbe 3 —
 * l'humide et l'ombre), un cœur de bosquet de crête reste sec.
 */
function champignonsDuCoeur(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x434f4555) | 0 // 'COEU'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue
      if (!estCoeur(profondeurAt(c.map, tx, ty))) continue
      if (!terrainAdmet('champignon', terrain[i]!)) continue
      if (hash2(tx, ty, salt) >= CONTENU.CHAMPIGNON_COEUR) continue
      out.push({ id, type: 'champignon', tx, ty, stock: NODE_DEFS.champignon.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LES TAS DE FEUILLES (forêts-vivantes §1 R1 — sel 'FEUI'). La bande du CORPS
 * (`PROF_LISIERE < d < PROF_COEUR`) des feuillus gagne sa fouille : des vers sous les
 * feuilles — le premier appât qui n'est pas de la nourriture. Patron 'FIBR' : passe
 * appendue en queue, tirage positionnel, aucun nœud existant ne bouge.
 */
function tasDeFeuilles(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x46455549) | 0 // 'FEUI'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue
      if (!TERRAINS_FEUILLUS.includes(terrain[i]!)) continue
      const d = profondeurAt(c.map, tx, ty)
      if (d <= CREUX.PROF_LISIERE || d >= CREUX.PROF_COEUR) continue // la bande du CORPS
      if (hash2(tx, ty, salt) >= CONTENU.TAS_FEUILLES) continue
      out.push({ id, type: 'leaf_pile', tx, ty, stock: NODE_DEFS.leaf_pile.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LES PIERRIERS DU PRÉ (§2ter R34bis — sel 'PIRR'). Le champ 'PIER' qui garde la pierre du
 * semis commun à plein régime CONCENTRE aussi : dans une nappe élue, la pierre est plus dense
 * que ne l'était le saupoudrage — un champ de blocs erratiques se voit de loin, se nomme, se
 * vide. Racine seule, patron 'FIBR' : passe appendue, tirage positionnel, aucun nœud existant
 * ne bouge.
 */
function pierriersDuPre(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const champ = (c.graphe.seed ^ 0x50494552) | 0 // 'PIER' — LE MÊME champ que l'affinité
  const salt = (c.graphe.seed ^ 0x50495252) | 0 // 'PIRR'
  // Une BUTTE n'est pas un pierrier : elle est peuplée par SES blocs (§2sexies R48bis), la
  // nappe ne doit pas y déverser de la pierre ordinaire ni décaler leur semis.
  const dansUneButte = (tx: number, ty: number): boolean =>
    c.affleurements.some((a) => tx >= a.rect.x && tx < a.rect.x + a.rect.w && ty >= a.rect.y && ty < a.rect.y + a.rect.h)
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue
      if (c.rampe[i] || occupees.has(i)) continue
      const t = terrain[i]!
      if (t === TERRAIN_ROAD || !TERRAINS[t]?.walkable) continue
      if (!terrainAdmet('rock', t)) continue
      if (dansUneButte(tx, ty)) continue
      if (fbm2(tx, ty, CONTENU.PIERRIER_ECHELLE, champ) <= CONTENU.PIERRIER_SEUIL) continue
      if (hash2(tx, ty, salt) >= CONTENU.PIERRIER_CHANCE) continue
      out.push({ id, type: 'rock', tx, ty, stock: NODE_DEFS.rock.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

function champignonsRares(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x4d555348) | 0 // 'MUSH'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue // le seuil ne nourrit rien ; tuile déjà prise
      const def = TERRAINS[terrain[i]!]
      if (!def?.walkable) continue
      const n = def.name
      const prob =
        n === 'marsh' || n === 'peat_bog' || n === 'reed_marsh' || n === 'old_growth'
          || n === 'willow' // la saulaie : un bosquet, pas un biome — sa densité reste localisée
          ? CONTENU.CHAMPIGNON_HUMIDE
          : n === 'wet_meadow' // le mot mouillé du PRÉ (§2ter R34) : son propre régime, 2026-08-23
            ? CONTENU.CHAMPIGNON_PRAIRIE
            : n === 'forest'
              ? CONTENU.CHAMPIGNON_FORET
              : -1 // tout autre terrain : jamais de champignon
      if (prob < 0 || hash2(tx, ty, salt) >= prob) continue
      out.push({ id, type: 'champignon', tx, ty, stock: NODE_DEFS.champignon.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LA FIBRE DES PRAIRIES HUMIDES (spec t0-exploration §2ter R34, décision d'Alexis 2026-08-15).
 *
 * La prairie humide est LA place à fibre de la T0 — joncs et laîches : la ressource des
 * bandages a un ENDROIT lisible, au lieu d'un saupoudrage uniforme sur tout le pré. Même
 * patron que `champignonsRares` : passe séparée, appendue, tirage POSITIONNEL (`hash2` salé
 * 'FIBR'), aucune tuile de seuil ni de tuile déjà prise, aucun PRNG partagé — le flux de
 * génération n'est pas décalé (leçon RNG).
 */
function fibresDesPrairies(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x46494252) | 0 // 'FIBR'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue // le seuil ne nourrit rien ; tuile déjà prise
      if (terrain[i] !== TERRAIN_WET_MEADOW) continue
      if (hash2(tx, ty, salt) >= CONTENU.FIBRE_PRAIRIE) continue
      out.push({ id, type: 'fiber_plant', tx, ty, stock: NODE_DEFS.fiber_plant.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

function vergersSauvages(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, terrain, zones } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  for (const z of zones) {
    if (z.kind !== 'verger') continue
    for (let ty = Math.floor(z.y); ty < z.y + z.h; ty++) {
      for (let tx = Math.floor(z.x); tx < z.x + z.w; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= c.map.height) continue
        const i = ty * width + tx
        if (c.rampe[i] || occupees.has(i)) continue
        const t = terrain[i]!
        // On respecte l'admission du terrain : un verger ne fait pas pousser de buisson sur
        // la roche. S'il tombe sur un sol qui n'en veut pas, il reste maigre — et c'est juste.
        if (!terrainAdmet('berry_bush', t)) continue
        if (hash2(tx, ty, (c.graphe.seed ^ 0x56455247) | 0) >= CONTENU.VERGER_DENSITE) continue
        out.push({ id, type: 'berry_bush', tx, ty, stock: NODE_DEFS.berry_bush.stock, regrowAt: 0 })
        occupees.add(i)
        id += 1
      }
    }
  }
  return out
}

/**
 * LES ARBRES DE LA RACINE — récoltables, à deux densités selon le sol.
 *
 * La racine porte ses propres arbres, posés en NŒUDS récoltables (pas en décor : on ne coupe pas
 * un décor). Deux régimes selon le terrain de la tuile :
 *
 *   • sur la FORÊT (les bosquets de la racine) : DENSE — une vraie futaie de bois qu'on abat,
 *     mais TROUÉE de clairières rectangulaires (décidées par bloc). Ils s'ajoutent au peu que la
 *     table commune y posait déjà.
 *   • sur l'HERBE (le pré) : ÉPARS avec un plancher — quelques arbres qui ponctuent la plaine
 *     sans la boiser. Le sol reste un pré (`solDe` ne change pas) ; ce sont des nœuds posés sur
 *     un terrain qui, d'ordinaire, n'en porte pas.
 *
 * Le semis est CLUSTERISÉ (un bruit basse fréquence groupe les arbres). On ne pose que sur une
 * tuile LIBRE de la racine (hors seuil, hors tuile déjà occupée par un autre nœud), et rien sur
 * un sol qui n'est ni herbe ni forêt (la fleuraie, la roche… gardent leur nature).
 *
 * Pur et déterministe : `hash2`/`fbm2`, `+ - * /` (invariant n°2).
 */
function arbresDeLaRacine(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const seed = (c.graphe.seed ^ 0x51ab3f77) | 0
  const out: ResourceNode[] = []
  let id = idStart
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue // rien que dans les Prés Bas
      if (c.rampe[i]) continue // un seuil ne nourrit rien
      if (occupees.has(i)) continue // une tuile ne porte qu'un seul nœud

      const t = terrain[i]!
      // La FORÊT est un couvert PLEIN ; l'HERBE est éparse avec un plancher (0,5..1,7× : toujours
      // quelques arbres, parfois un petit groupe).
      let pas: number
      let socle: number
      let ampli: number
      if (t === TERRAIN_GRASS) {
        pas = CONTENU.ARBRES_PRE_PAS; socle = 0.5; ampli = 1.2
      } else if (t === TERRAIN_FOREST || t === TERRAIN_OLD_GROWTH || t === TERRAIN_PINE || t === TERRAIN_LARCH || t === TERRAIN_WILLOW) {
        // LES CLAIRIÈRES ne sont plus testées ici (2026-08-25) : elles ne sont plus un champ
        // qu'on consulte, elles sont un TERRAIN (`clairieres.ts`), et `clairiere` n'est dans
        // aucune des deux listes ci-dessus — une tuile de clairière tombe donc au `continue`
        // final, comme la fleuraie. Une seule source, le terrain : le semis, le rendu du sol,
        // le clutter et la pénombre ne peuvent plus diverger, ils lisent tous la même case.
        //
        // La FUTAIE, c'est la forêt, le Bois Noir (old_growth, spec t0-exploration R9) et — depuis
        // le 2026-07-29 — les BOSQUETS DE CRÊTE (pin, mélèze : le bois SEC des dos, demande
        // d'Alexis). Ce sont les quatre sols de la Racine qu'on habite sous un couvert. PAS la
        // lisière calcinée : « admet l'arbre » ne veut pas dire « en est couvert » — le calciné du
        // sud garde ses arbres épars de la table commune, il ne devient pas une pépinière plus
        // riche que le pré qu'il remplace.
        //
        // SANS CETTE LIGNE le bosquet de crête serait un APLAT DE COULEUR : `terrainAdmet` laisse
        // bien le pin porter des arbres, mais à la densité commune du semis (un nœud toutes les
        // 36 tuiles) — on aurait peint un bois qui n'en est pas un.
        pas = CONTENU.ARBRES_FORET_PAS; socle = 0.85; ampli = 0.4
      } else {
        continue // ni herbe ni futaie : ce sol garde sa nature (fleuraie, lande, accent…)
      }

      const bosquet = fbm2(tx, ty, CONTENU.ARBRES_ECHELLE, (seed ^ 0x4be1) | 0)
      const chance = (1 / pas) * (socle + ampli * bosquet)
      if (hash2(tx, ty, (seed ^ 0x3d7a) | 0) >= chance) continue

      // Le cœur d'un massif pose des VIEUX FÛTS (§2quater R40) — `stockDArbre`, la même loi
      // que le semis commun et la repousse.
      out.push({ id, type: 'tree', tx, ty, stock: stockDArbre(c.map, tx, ty), regrowAt: 0 })
      id += 1
    }
  }
  return out
}

/** Le type de nœud d'une tuile : la table de sa zone, filtrée par ce que le terrain admet. */
function tirerType(
  c: CarteZonee,
  zoneId: number,
  terrain: number,
  tx: number,
  ty: number,
  seed: number,
): NodeType | null {
  const def = CONTENUS[c.graphe.zones[zoneId]!.def.slug]
  if (!def) return null

  const table: [NodeType, number][] = []
  if (def.structurant) table.push([def.structurant.type, def.structurant.part])
  for (const l of def.liaison ?? []) table.push([l.type, l.part])
  for (const [k, v] of Object.entries(def.commun)) table.push([k as NodeType, v!])

  // On ne garde que ce que le terrain admet, puis on renormalise : une zone d'éboulis ne
  // fabrique pas d'arbres, mais elle ne doit pas non plus se retrouver VIDE parce que sa table
  // parlait d'arbres.
  const ok = table.filter(([type]) => terrainAdmet(type, terrain))
  const total = ok.reduce((s, [, p]) => s + p, 0)
  if (total <= 0) return null

  let r = hash2(tx, ty, (seed ^ 0x7c31) | 0) * total
  for (const [type, part] of ok) {
    r -= part
    if (r <= 0) return type
  }
  return ok[ok.length - 1]![0]
}

/**
 * LE TEASER — *« ça existe. Pas ici. »*
 *
 * Un filon, un seul, dans la racine, au stock dérisoire. Il n'équipe personne : il **informe**.
 * On le pose **loin du centre** de la racine (dans son dernier quart) : il faut l'avoir cherché
 * pour le trouver, et l'avoir trouvé pour se demander où sont les autres.
 */
function poserLeTeaser(c: CarteZonee, id: number): ResourceNode | null {
  const { width, height, terrain } = c.map

  // LE FILON EST UN LIEU, DÉSORMAIS — et le minerai se pose DANS ce lieu.
  // Tant qu'il n'était qu'un nœud perdu à la tuile la plus lointaine, son message ne pouvait
  // pas être délivré : rien ne le signalait, rien ne le retenait, il n'était sur aucune carte.
  // En l'ancrant sur « le Filon affleurant », on garde exactement ce qu'il était (unique, loin,
  // dérisoire) et on rend enfin possible ce que son intention demandait : le CHERCHER.
  for (const z of c.map.zones) {
    if (z.kind !== 'filon') continue
    for (let ty = Math.floor(z.y); ty < z.y + z.h; ty++) {
      for (let tx = Math.floor(z.x); tx < z.x + z.w; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        const i = ty * width + tx
        if (c.rampe[i] || !terrainAdmet('iron_vein', terrain[i]!)) continue
        return { id, type: 'iron_vein', tx, ty, stock: CONTENU.TEASER_STOCK, regrowAt: 0 }
      }
    }
  }

  // REPLI — aucune carte ne porte forcément un lieu (cartes de test, anciennes vallées) :
  // on retombe alors sur le comportement d'origine, la tuile la plus loin du cœur.
  const r = c.graphe.zones[c.graphe.racine]!
  let best: { tx: number; ty: number } | null = null
  let bestD = -1
  for (let ty = 0; ty < height; ty += 3) {
    for (let tx = 0; tx < width; tx += 3) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine || c.rampe[i]) continue
      if (!terrainAdmet('iron_vein', terrain[i]!)) continue
      const d = distSq(tx, ty, r.x, r.y)
      // Le plus LOIN du cœur de la racine — mais toujours chez elle. Départage déterministe.
      if (d > bestD) { bestD = d; best = { tx, ty } }
    }
  }
  if (!best) return null
  return { id, type: 'iron_vein', tx: best.tx, ty: best.ty, stock: CONTENU.TEASER_STOCK, regrowAt: 0 }
}

// ────────────────────────────────────────────────────────────────────────────
// LE PEUPLEMENT — on ne dit JAMAIS non au joueur (spec R17)
// ────────────────────────────────────────────────────────────────────────────

export interface Emplacement {
  tx: number
  ty: number
  zone: number
}

/**
 * LES DANGERS DU PLACEMENT (worldgen R17bis) — ce que la liste des emplacements ÉVITE.
 *
 * Le paramètre est OBLIGATOIRE, et c'est voulu : un appelant qui l'oublierait rendrait la
 * garde muette en silence. Un monde qui n'a vraiment ni coins ni nids (carte de test) le dit
 * en passant deux tableaux vides.
 */
export interface DangersDePlacement {
  /** Les coins de chasse (`placeHuntingGrounds`) : leur territoire fait naître la faune —
   *  loups compris — autour de quiconque y vit. */
  coinsDeChasse: { x: number; y: number }[]
  /** Les RECTANGLES des lieux à monstre résident (`nidsAMonstre` — tanière, repaire). */
  nids: { x: number; y: number; w: number; h: number }[]
}

/**
 * LES EMPLACEMENTS DE VILLAGE — et **aucune règle n'en interdit un seul**.
 *
 * C'est la trouvaille du brainstorm, et elle est d'Alexis : *« on peut poser son village dès
 * qu'il y a de la place — par contre les ressources sont là où elles doivent être : dans le
 * blizzard, pas de bois ni d'eau liquide. »* **La distribution des ressources EST la règle de
 * peuplement.** Personne ne s'installe dans le Névé, non pas parce qu'on l'interdit, mais parce
 * qu'on n'y bâtit rien. Zéro code de restriction, zéro frustration de « emplacement interdit ».
 *
 * Cette fonction ne DÉCIDE donc rien : elle CONSTATE. Elle liste les endroits où un village
 * pourrait vivre — du bois, de la pierre, de la place — et le fait qu'ils soient tous dans les
 * zones nourricières est une **conséquence**, pas une consigne.
 *
 * R17bis étend le CONSTAT (2026-08-18, question ③ de la calibration) : « pourrait vivre »
 * veut aussi dire y SURVIVRE. Des baies à portée (la seule nourriture d'un village PNJ), pas
 * de nid à monstre au seuil, et hors du territoire d'un coin de chasse — mesuré au banc :
 * 4 fondateurs saignés à mort au JOUR 1 par la meute née de l'anneau (graine 1234). Le joueur,
 * lui, fonde toujours où il veut : `found_village` ne lit pas cette liste (R17 intact).
 */
export function emplacementsDeVillage(c: CarteZonee, nodes: ResourceNode[], dangers: DangersDePlacement): Emplacement[] {
  const { width, height, terrain } = c.map
  const out: Emplacement[] = []
  const ecart2 = MONDE.ESPACEMENT_VILLAGES * MONDE.ESPACEMENT_VILLAGES

  // Index des nœuds par maille — ET PAR ZONE.
  //
  // LA ZONE EST LA CORRECTION, et elle a un sens de jeu. Une maille de quarante tuiles DÉBORDE
  // chez la voisine : le Gouffre se mettait à compter les arbres d'à côté et devenait habitable
  // (mesuré, seed 7). Or entre les deux il y a une FALAISE — le bois d'en face ne se ramasse pas
  // sans faire le tour par un seuil. **On ne compte que ce qu'on peut aller chercher.**
  const maille = CONTENU.RAYON_VILLAGE
  const mw = Math.ceil(width / maille)
  const bois = new Map<number, number>()
  const pierre = new Map<number, number>()
  const baies = new Map<number, number>()
  const cle = (tx: number, ty: number, z: number): number =>
    (Math.floor(ty / maille) * mw + Math.floor(tx / maille)) * 32 + z
  for (const n of nodes) {
    const ti = n.ty * width + n.tx
    const k = cle(n.tx, n.ty, c.zone[ti]!)
    // Seul le bois SUR TERRAIN BOISÉ fonde un village. Les arbres épars du pré (des nœuds posés sur
    // l'herbe, cf. `arbresDuPre`) PONCTUENT la plaine — ils n'en font pas un chantier. Sans ce
    // filtre, quelques arbres rendraient TOUTE la plaine constructible, et le refuge ne reculerait
    // plus devant la cendre (R30). Pour tout arbre poussant sur son terrain naturel, c'est un no-op.
    if ((n.type === 'tree' || n.type === 'old_tree') && terrainAdmet('tree', terrain[ti]!)) {
      bois.set(k, (bois.get(k) ?? 0) + 1)
    }
    if (n.type === 'rock' || n.type === 'quarry') pierre.set(k, (pierre.get(k) ?? 0) + 1)
    if (n.type === 'berry_bush') baies.set(k, (baies.get(k) ?? 0) + 1)
  }

  // LE TERRITOIRE D'UN COIN DE CHASSE (R17bis) — l'écart se DÉRIVE, jamais écrit : c'est la
  // portée exacte à laquelle la faune du coin peut naître de la présence d'un villageois
  // (le disque du coin + l'anneau autour de l'hôte). Si la faune change, la garde suit.
  const ecartChasse = FAUNA.GROUND_RADIUS + FAUNA.SPAWN_RING_MAX
  const ecartChasse2 = ecartChasse * ecartChasse
  // Distance au RECTANGLE d'un nid (0 dedans) : l'empreinte d'un lieu, pas son centre.
  const presDUnNid = (tx: number, ty: number): boolean => {
    for (const n of dangers.nids) {
      const dx = Math.max(n.x - tx, 0, tx - (n.x + n.w))
      const dy = Math.max(n.y - ty, 0, ty - (n.y + n.h))
      if (dx * dx + dy * dy < CONTENU.ECART_NID * CONTENU.ECART_NID) return true
    }
    return false
  }

  const pas = CONTENU.PAS_BALAYAGE
  for (let ty = maille; ty < height - maille; ty += pas) {
    for (let tx = maille; tx < width - maille; tx += pas) {
      const i = ty * width + tx
      if (!TERRAINS[terrain[i]!]?.walkable || c.rampe[i]) continue

      // De la PLACE : un carré dégagé, tout marchable. On ne fonde pas dans un couloir.
      if (!degage(c, tx, ty)) continue

      // DU BOIS et DE LA PIERRE à portée, DANS SA PROPRE ZONE. C'est tout — et c'est ce qui, tout
      // seul, rend le Névé, le Glacier, les Aiguilles et le Gouffre inhabitables. Aucune règle ne
      // les interdit : on n'y bâtit simplement rien.
      const k = cle(tx, ty, c.zone[i]!)
      if ((bois.get(k) ?? 0) < CONTENU.BOIS_MIN) continue
      if ((pierre.get(k) ?? 0) < CONTENU.PIERRE_MIN) continue
      // DES BAIES (R17bis) : la seule nourriture d'un village PNJ. Le désert s'exclut ici.
      if ((baies.get(k) ?? 0) < CONTENU.BAIES_MIN) continue

      // UN SITE TENABLE (R17bis) : hors du territoire d'un coin de chasse, loin d'un nid.
      if (dangers.coinsDeChasse.some((g) => distSq(g.x, g.y, tx, ty) < ecartChasse2)) continue
      if (presDUnNid(tx, ty)) continue

      // LA BUTTE N'EST LE JARDIN DE PERSONNE (§2sexies R52) : un village ne se pose pas sur un
      // affleurement — la distance fait le prix du minerai. Même famille de CONSTAT que R17bis ;
      // le joueur, lui, fonde toujours où il veut (R17). `[]` sur le plan complet : no-op.
      if (c.affleurements.some((a) => {
        const dx = Math.max(a.rect.x - tx, 0, tx - (a.rect.x + a.rect.w))
        const dy = Math.max(a.rect.y - ty, 0, ty - (a.rect.y + a.rect.h))
        return dx * dx + dy * dy < CONTENU.DEGAGEMENT * CONTENU.DEGAGEMENT
      })) continue

      // Assez loin du village précédent : on se frotte, on ne se marche pas dessus.
      if (out.some((e) => distSq(e.tx, e.ty, tx, ty) < ecart2)) continue
      out.push({ tx, ty, zone: c.zone[i]! })
    }
  }
  return out
}

/** Un carré tout marchable autour du point : la place nette d'un foyer. */
function degage(c: CarteZonee, tx: number, ty: number): boolean {
  const { width, terrain } = c.map
  const r = CONTENU.DEGAGEMENT
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (!TERRAINS[terrain[y * width + x]!]?.walkable) return false
    }
  }
  return true
}

/**
 * LE SPAWN — ÉPARPILLÉ dans la racine (décision d'Alexis : *« pour éviter la guerre au
 * lancement »*).
 *
 * On ne fait naître personne au même endroit : cinquante joueurs qui apparaissent sur la même
 * tuile, ce sont cinquante joueurs qui se disputent le même arbre à la minute deux. On les
 * disperse sur les emplacements viables de la racine, les plus écartés qu'on trouve — un semis
 * glouton max-min, déterministe.
 */
export function pointsDeSpawn(
  c: CarteZonee,
  emplacements: Emplacement[],
  combien: number,
): Emplacement[] {
  /**
   * ═══ ON NE NAÎT PAS SUR LE PAS D'UNE FOSSE (spec `cendre.md` R10) ═══
   *
   * L'ancienne règle (R30) écartait ce qui avait DÉJÀ brûlé, en suivant le front. Le front est
   * retiré ; celle-ci écarte ce qui brûlera BIENTÔT, et elle ne s'applique qu'aux points de
   * NAISSANCE — pas aux sites de village.
   *
   * **La distinction est le cœur de la règle.** Un site de village, on le CHOISIT : que le
   * charnier soit à la fois un lieu de danger et l'origine de la cendre est alors la meilleure
   * sorte de leçon, celle que le monde enseigne tout seul — *on ne bâtit pas à côté d'une fosse.*
   * Un point de naissance, non : `pointsDeSpawn` le pose. **Mesuré avant la règle : le premier
   * spawn tombait sous la cendre à un coût de 11 sur la seed 7** — un joueur pouvait naître à neuf
   * jours du feu. Ce n'est pas une leçon, c'est une mauvaise main distribuée.
   *
   * Le filtre est LARGE (12 à 15 sites sur ~50 le franchissent) : il reste 35+ candidats pour 17
   * spawns, et le semis max-min n'est jamais affamé — vérifié par A5.
   */
  const cout = c.map.cendreCout
  const assezLoin = (e: Emplacement): boolean => {
    if (!cout) return true // pas de fosse sur cette carte : rien à écarter
    const d = coutDe(cout, e.ty * c.map.width + e.tx)
    return d < 0 || d >= CENDRE.ECART_SPAWN * CENDRE.ORTHO
  }
  const dansLaRacine = emplacements.filter((e) => e.zone === c.graphe.racine)
  const loin = dansLaRacine.filter(assezLoin)
  // ⚠ REPLI EXPLICITE : si l'écart ne laisse rien (carte dégénérée, monde minuscule), on rend les
  // sites de la racine plutôt que RIEN — mieux vaut naître près d'une fosse que ne pas naître.
  const dans = loin.length > 0 ? loin : dansLaRacine
  if (dans.length === 0) return []

  const r = c.graphe.zones[c.graphe.racine]!
  // On part du plus proche du cœur de la racine — un point d'ancrage déterministe…
  let depart = dans[0]!
  let bestD = Infinity
  for (const e of dans) {
    const d = distSq(e.tx, e.ty, r.x, r.y)
    if (d < bestD) { bestD = d; depart = e }
  }
  const out = [depart]
  // …puis chaque suivant est celui qui est le PLUS LOIN de tous les déjà pris.
  while (out.length < combien && out.length < dans.length) {
    let best: Emplacement | null = null
    let bestScore = -1
    for (const e of dans) {
      if (out.includes(e)) continue
      let score = Infinity
      for (const o of out) score = Math.min(score, distSq(e.tx, e.ty, o.tx, o.ty))
      if (score > bestScore) { bestScore = score; best = e }
    }
    if (!best) break
    out.push(best)
  }
  return out
}
