# La roche-mère — le second axe de la Racine

*Source : décisions d'Alexis du 2026-08-26, prises une à une — « ton idée de roche mère m'intrigue,
on peut creuser cette partie pour voir le potentiel ? », puis **(b)** (la roche entre AVANT l'eau)
et **②** (la rivière est exempte). Contrainte posée en tête de séance et qui commande toute la
spec : **« je ne veux pas qu'on ajoute de nouvelles ressources maintenant »** — aucun `NodeType`
neuf, aucun `ItemId` neuf, aucun id de terrain neuf. Statut : **IMPLÉMENTÉE le 2026-08-26** —
`racine-relief.ts` (bloc `ROCHE`, `composerLaRoche`, `familleDeCellule`), `socle.ts` (les trois
champs, neutres avant composition), `zonegen.ts` (passe 1b-bis + le minerai par province),
`zonegen-water.ts` (le karst dans `inondable`, `poserLesLapiaz`, `poserLesResurgences`). Deux
gardes se réénoncent avec leur mesure (R11, R11bis). Le calibrage fin reste à trancher à l'œil.
Jalon : chantier worldgen / avant GATE 1.
Prolonge `t0-exploration.md` §2bis-§2ter (étage 4 du vocabulaire) et amende `stratigraphie.md`
(couche I).*

---

## Objectif de design

Le grief : *« les différents biomes semblent assez vides en réalité. Très peu de vie et de variété
dans le jeu à ce niveau. »*

Sur la variété, le diagnostic n'est pas un manque de mots — c'est qu'**il n'y en a qu'un seul
rang**. Le critère A16 de `t0-exploration.md` l'écrit noir sur blanc :

    d(marais) < d(roselière) < d(prairie humide) < d(bosquet) < d(herbe) < d(fleuraie) < d(lande)

Sept mots, un ordre total, une seule variable : l'humidité, dérivée du relief. Ce ne sont pas sept
biomes, c'est **un biome à sept niveaux d'humidité**. Ajouter un huitième mot sur le même rang
n'y changerait rien : la carte resterait prédictible d'un bout à l'autre par une seule question
(« suis-je près de l'eau ? »).

Sur la vie, le diagnostic est ailleurs et il est plus dur (MESURÉ, monde joué, 5 seeds) :

- **91,7 % de toute l'eau de la vallée tient dans 7 corps** (14 280 · 6 143 · 3 127 · 2 822 ×3 ·
  2 816 tuiles) plus la rivière. Les 51 autres mares ne pèsent rien.
- Le semis des coins de chasse tire **23 à 26 points de Poisson** ; **5 à 6 passent** (19-25 %).
  Ce qui tue les autres est `FAUNA.GROUND_WATER_NEAR` — il faut de l'eau à 40 tuiles.
- Résultat : **2,55 à 3,49 % de la terre marchable** est un lieu de naissance possible pour une
  bête. Le reste du monde ne peut, par construction, en porter aucune.

> **Le goulot de la faune n'est pas la quantité d'eau, c'est sa DISTRIBUTION contre un treillis
> fixe de 200 tuiles.** Sept lacs ne peuvent pas nourrir vingt-cinq points ; quarante adresses, si.

La roche-mère répond aux deux d'un seul geste : elle **décorrèle l'humidité de la topographie**
(un dos calcaire reste sec au fond d'un vallon, une cuvette d'argile marécage en hauteur), et
elle **redistribue l'eau** des sept grands bassins vers des dizaines de résurgences, dans le pays
sec où il n'y a rien aujourd'hui.

---

## Les provinces

- **R1 — UN SECOND CHAMP, DÉRIVÉ, D'ÉCHELLE RÉGIONALE.** Un `fbm2` à sel dédié (`'ROCH'`),
  échelle **520 tuiles** — *plus grande* que `CREUX.ECHELLE_LARGE` (300) de l'humidité. Le choix
  d'échelle est la règle elle-même : une province doit **traverser** le gradient d'humidité, pas
  le suivre. À 520 tuiles et ~36 tuiles d'écran, une province fait **~14 écrans** de large : on
  met plusieurs sessions à la traverser, ce qui est la définition d'un pays.

- **R2 — TROIS ROCHES, PAR QUANTILE.** `calcaire` (le tiers le plus bas du champ), `granite` (le
  tiers médian), `argile/marne` (le tiers le plus haut). Quantiles et non valeurs, au patron de
  `CREUX` R25 (`seuilParQuantile`) : la part de chaque roche est un **contrat**, pas un espoir.

- **R3 — LA ROCHE NE PEINT AUCUN TERRAIN.** Elle n'est pas un huitième mot ni un calque : elle
  **module** ce qui existe déjà. C'est ce qui la rend compatible avec la contrainte « pas de
  ressource neuve » — tout ce qu'elle produit, le jeu sait déjà le dessiner.

---

## Où elle entre — AVANT l'eau *(décision d'Alexis : (b))*

- **R4 — LA ROCHE COMMANDE L'INFILTRATION, DONC LE FLUX.** Le socle
  (`stratigraphie.md`, couche I) calcule déjà, pour toute la carte, `flux` (accumulation de
  drainage D8), `pente`, et `mouille` — **et le monde joué les jette**, puisque la Racine garde
  son champ historique (`composerLHumidite`). L'infiltration est très exactement un
  **modificateur de `flux`**, appliqué dans la passe d'accumulation :

  | roche | flux | ce qui en découle, GRATUITEMENT |
  |---|---|---|
  | **calcaire** | absorbé au fil des cellules traversées | la cuvette ne se remplit pas → **doline sèche** ; le ruisseau qui y entre se **perd** |
  | **granite** | inchangé | le monde d'aujourd'hui, au bit près |
  | **argile / marne** | conservé, ruissellement fort | les fonds se remplissent bas → **mares et marais** en dehors des grands bassins |
  | contact calcaire → marne | le flux ressort | **la résurgence** (R7) |

  ⚠ **CE N'EST PAS UN SECOND HASARD.** L'infiltration entre dans une chaîne physique existante
  (uplift → érosion → D8 → accumulation), au seul endroit où elle a un sens. La doctrine de
  §2bis tient : *ce qui se lit comme logique, c'est ce qui est DÉRIVÉ.*

- **R5 — LA RIVIÈRE EST EXEMPTE** *(décision d'Alexis : ②)*. Le fil majeur (`map.fil`) et son lit
  creusent leur passage dans n'importe quelle roche — un cours pérenne colmate son lit, et
  `t0-exploration.md` §2 R5 promet qu'on peut **le suivre** du nord au sud jusqu'à la frontière de
  la Cendrière (*« l'eau descend vers le feu »*). Le karst ne mord donc que sur les **lacs** et les
  **ruisseaux**.

  ⚠ **CETTE CLAUSE EST PORTANTE, PAS DÉFENSIVE, et une seule seed le cachait.** Part du fil qui
  court sur le calcaire, mesurée : **0 % (seed 2026) · 30 % (7) · 48 % (1234) · 57 % (42) ·
  88 % (99)**. Sans l'exemption, la rivière de la seed 99 perdrait 88 % de son cours. Le premier
  relevé, fait sur la seule seed 2026, donnait 0 % et laissait croire à un cas d'école.

- **R6 — LE LAPIAZ : LA CUVETTE SÈCHE EST DE LA ROCHE NUE.** Un bassin calcaire qui ne se remplit
  pas n'est pas un trou dans la carte, c'est un **pavement de roche** — `TERRAIN_BOULDERS` au cœur,
  `TERRAIN_SCREE` en frange.

  ⚠ **CES DEUX TERRAINS EXISTENT, SONT DESSINÉS, ET NE SONT JAMAIS POSÉS.** Mesuré dans le monde
  joué : `boulders` = **0,00 %** de la carte, `scree` = **0,12 %**. Le lapiaz leur donne enfin une
  adresse — **un biome minéral MARCHABLE au milieu du pré**, sans un id de terrain neuf et sans
  une ressource neuve. C'est le seul endroit où cette spec crée un paysage qui n'existe pas du
  tout aujourd'hui.

- **R6bis — LE LAPIAZ SE DÉCIDE À LA TUILE, PAS À LA CELLULE.** *(retour d'Alexis, 2026-08-27 :
  « les biomes scree et boulders sont trop droits (des gros chunks), il faudrait que ça se
  rapproche de la forme des autres biomes »)*

  Le contour d'un lapiaz est une **bande de niveau lue à la tuile** (`lireLeChampAt` — la lecture
  molle de `sol-dessine.md` R1, bilinéaire + grain), du champ `min(marge calcaire, marge de
  bassin)`. La frange d'éboulis est elle aussi une bande de niveau (`LAPIAZ.FRANGE`) : elle
  s'épaissit où la doline est plate et se pince où elle plonge — **un bord, pas un contour**.

  ⚠ **CE QUI ÉTAIT EN CAUSE N'ÉTAIT PAS LA QUANTIFICATION, C'ÉTAIT SON NIVEAU.** La règle
  « le champ décide, le carré de 8 exécute » (worldgen R32) vaut pour ce qui est TAILLÉ ;
  `sol-dessine.md` R1 avait déjà descendu à la tuile ce qui POUSSE. Le lapiaz était resté du
  mauvais côté de la ligne — or ce n'est pas un mur, c'est un pierrier.

  **MESURÉ (seed 2026 · 7 · 4242, monde joué)** — part des segments de bord longs de ≥ 8 tuiles,
  la signature du motif :

  | | scree+boulders | témoin : le bois | témoin : la lande |
  |---|---|---|---|
  | avant | **91,8 % · 90,4 % · 83,8 %** | 2,4 % · 2,1 % · 2,0 % | 0,7 % |
  | après | **2,3 % · 3,8 % · 2,5 %** | idem | idem |

  Et la découpe suit : **13 · 9 · 17 amas → 78 · 83 · 102**, périmètre/aire **0,080 · 0,086 ·
  0,088 → 0,141 · 0,199 · 0,182** (le bois est à 0,19-0,23). L'AIRE, elle, ne bouge pas
  (−0,2 % · +0,8 % · +1,9 %) : la composition du pays reste un contrat, seule sa forme change.

- **R6ter — LE CHAOS DE BLOCS PORTE DE VRAIS BLOCS, ET DES GALERIES QUI LES TRAVERSENT.**
  *(demande d'Alexis, 2026-08-27 : « ok pour qu'il y ait des gros blocs de pierre, mais dans ce
  cas, on les fait correspondre à la DA, on leur donne un hitbox pour éviter qu'on passe au
  travers (tu les mets sur une tuile complète), et tu donnes une structure logique pour les
  boulders si on doit en faire un mine labyrinthe (on doit pouvoir spawn des nodes accessibles
  dans la structure) »)*

  `TERRAIN_BOULDERS` s'appelait « chaos de blocs » et n'en portait aucun : ses rochers étaient du
  **décor client** (`BIOME_CLUTTER`), donc on les traversait. Ce sont désormais de vrais nœuds
  `bloc` — le type qui existait déjà pour les buttes d'affleurement : **boîte pleine tuile**
  (`blockHalfSub: 4`), trois tailles (`tailleDeBloc`), art `nd-bloc-<taille>` flush. Le décor ne
  garde que **ce qu'on enjambe** (moellons, lichen).

  **LA STRUCTURE : LES GALERIES D'ABORD, LES BLOCS DANS CE QUI RESTE.** Deux familles de bandes
  continues (une par axe), écartées de `CHAOS.PAS`, larges de `CHAOS.LARGEUR`, ondulées par un
  champ basse fréquence. Leur continuité tient par ARITHMÉTIQUE, pas par une garde : le décalage
  varie de `AMPLITUDE / ECHELLE_ONDULATION` par tuile — largement sous 1 — donc **une bande ne
  peut ni se rompre ni se replier**. Les deux familles se croisent : le vide est d'un seul tenant
  et il débouche. Les masses entre elles sont **érodées** par un second champ, sans quoi le
  treillis rendrait des carrés de six sur six — la géométrie même que R6bis vient de retirer.

  ⚠ **« DES NŒUDS ACCESSIBLES » TIENT PAR CONSTRUCTION, PAS PAR CHANCE.** Le chaos est déclaré
  **stérile pour le semis commun** (le patron des coulées) et pour toutes les passes appendues ;
  seule la passe du chaos y repose sa pierre, **sur les galeries**. Sans ce masque — mesuré —
  8 rochers, 31 branches et 3 pierres au sol se retrouvaient emmurés au milieu des masses.

  **MESURÉ (3 seeds)** : le vide du chaos est joint au reste du monde à **99,90 % · 99,94 % ·
  99,86 %** (4 à 11 tuiles en poche, sans un seul nœud dedans) ; **zéro nœud récoltable
  injoignable** dans le chaos. Les blocs du CŒUR d'une masse (1 043 · 564 · 804 sur 3 941 ·
  2 324 · 3 307) n'ont pas de voisin libre : ils s'ouvrent en minant le pourtour — c'est le
  « on creuse », pas un défaut.

  **LA RIVE S'EFFILOCHE, ET LES GALERIES SERPENTENT** *(retour d'Alexis le même jour : « éroder
  l'extérieur de zone, ça fait trop damier de boulders » / « un peu plus d'aléatoire dans la
  structure, c'est trop aligné »)*. Trois leviers, une seule idée — **ce qui se voit, c'est le
  CADRE de la grille, pas la grille** :

  | levier | avant | après | ce qu'il retire |
  |---|---|---|---|
  | **le réseau** | treillis : `modulo` sur x et sur y | **joints d'un VORONOÏ** (`F2 − F1 < largeur`) | la période ET les deux directions — c'est ce qui faisait le damier |
  | `DALLE` | pas de 9, fixe | **11 en moyenne**, sites jitterés | des dalles toutes de forme et de taille différentes |
  | largeur d'allée | 3, fixe | **2 à 4,5**, champ 'LARG' | toutes les allées se ressemblaient, donc l'œil les comptait |
  | ~~`EROSION_PORTEE`~~ | ~~6 tuiles~~ | **RETIRÉE** | *voir ci-dessous* |

  ⚠ **L'ÉROSION DE RIVE A ÉTÉ RETIRÉE LE 2026-08-27** — *« retire l'érosion de boulders dans
  tous les cas »* (Alexis). Elle répondait à un « trop damier » dont la cause était **ailleurs** :
  la découpe au motif de 8 du lapiaz (R6bis) et le treillis à modulo des galeries. Les deux ayant
  été corrigés, il ne restait de l'érosion qu'un effet : maigrir le chaos sur sa rive, c'est-à-dire
  l'OUVRIR précisément là où il doit se présenter comme un mur. Le chaos est désormais **plein
  jusqu'à son bord** — un seul seuil de masse, le même au cœur et au contact ; c'est le contour du
  lapiaz, dentelé à la tuile, qui lui donne sa forme. Effet mesuré sur le compte de blocs
  (3 graines) : **2 012 / 700 / 1 671 → 3 745 / 2 178 / 3 090**.

  ⚠ **DEUX PASSES ONT ÉTÉ PERDUES À AGRANDIR LE MÉANDRE, ET C'ÉTAIT LA MAUVAISE VARIABLE.** On
  avait porté l'ondulation de ±2,5 à ±7 tuiles et fait respirer la largeur ; le damier est resté.
  La raison n'est pas une question de degré : **un `modulo` sur x et un `modulo` sur y SONT une
  grille**, quelle que soit la déformation qu'on leur ajoute — l'œil retrouve les deux directions
  et le pas. Il fallait changer de générateur, pas de réglage.

  ⚠ **ET LE PREMIER RÉGLAGE D'ÉROSION VIDAIT LE CHAOS** *(gardé au journal parce qu'il dit
  quelque chose du champ, pas de l'érosion)*. À 14 tuiles de portée, la rive rongée depuis les
  quatre côtés se rejoignait au milieu des petits chaos : **3 941 blocs → 709** (graine 2026),
  2 324 → 198 (graine 7). Un chaos de cette taille n'a pas d'intérieur : tout y est rive.

  **MESURÉ après le changement de générateur** (3 graines) : cœur muré à **31 · 27 · 27 %**
  (contre 31 · 29 · 27 % au treillis — le dédale ne bouge pas, seule sa forme change) ; vide du
  chaos joint au reste du monde à **99,87 · 99,98 · 99,95 %** ; zéro nœud récoltable emmuré.

- **R6quinquies — ON N'Y MARCHE PAS PLUS LENTEMENT.** *(décision d'Alexis, 2026-08-27 : « et pas
  de ralentissement dans les biomes concernés »)* `scree` **0,7 → 1**, `boulders` **0,6 → 1**.
  Même mouvement que la forêt et la futaie ancienne : le coût d'un pays ne se paie pas en
  vitesse de marche. Le prix de la caillasse est ailleurs, et il est explicite — **on la
  contourne** (blocs pleine tuile, R6ter) et **on n'y ramasse rien** (R6quater). `cover` ne
  bouge pas.

- **R6quater — RIEN NE POUSSE DANS LA CAILLASSE.** *(« retire les fibres ou les trucs du genre,
  c'est de la caillasse ! »)* `terrainAdmet` refuse désormais **la fibre ET le bois mort au sol**
  sur toute la famille minérale (`scree` + `boulders`), comme la baie est refusée sur toute la
  masse boisée. L'éboulis excluait déjà la fibre ; le chaos de blocs, non — mesuré, il portait
  **10 à 22 plants de joncs posés sur de la roche nue**, et 4 à 11 branches tombées d'arbres
  qui n'y poussent pas. La **pierre au sol**, elle, y reste : c'est le seul glanage qui ait sa
  place ici, et c'est le sien.

- **R6sexies — LA BUTTE D'AFFLEUREMENT REÇOIT LE MÊME TRAITEMENT QUE LE LAPIAZ.** *(demande
  d'Alexis, 2026-08-27 : « tu vas appliquer le même traitement sur les frontières et la structure
  sur les mines de charbon et de fer »)* Les deux moitiés, et le même générateur des deux côtés.

  **① LA FRONTIÈRE.** La butte empilait 2 à 5 cellules de motif et peignait leurs 64 tuiles d'un
  bloc : mesuré, **100 % de ses segments de bord faisaient ≥ 8 tuiles** (3/3, 5/5, 6/6 sur trois
  graines) — le défaut de R6bis, en pire, puisqu'une butte n'a que cinq carrés pour se donner une
  silhouette. Elle croît maintenant **tuile à tuile, en prenant toujours la plus haute de sa
  frontière** (`altLarge` lu en bilinéaire + grain, `AFFL_GRAIN_CONTOUR`) : son contour est la
  ligne de niveau qui enferme exactement `AFFL_TUILES` tuiles. Trois propriétés, toutes par
  CONSTRUCTION — organique (une ligne de niveau d'un champ mou n'a pas de bord droit), bornée (le
  plafond en tuiles remplace celui en cellules, **l'aire ne bouge pas : 320**), connexe (la
  croissance part du sommet). `AFFL_CHAPEAU` reste en seconde borne, géologique : on ne descend
  pas sous le ras de l'os pour aller chercher ses 320 tuiles au fond de la vallée voisine.

  ⚠ **ET ELLE S'ÉTIRAIT EN RUBAN — VU EN JEU, PAS DANS UN CHIFFRE.** « Toujours la plus haute »
  suit la CRÊTE : la butte sortait en filet de cinq tuiles de large sur soixante de long, noyé
  entre les arbres — **320 tuiles dans une boîte de 28×62, 18 % de remplissage**. Aucune des
  mesures de bord ne le voyait (elles disaient « organique », et c'était vrai) ; il a fallu la
  photographier. `AFFL_COMPACITE` pénalise donc l'altitude par l'éloignement au sommet, en unités
  du rayon d'une butte ronde (√(320/π) ≈ 10 tuiles). **C'est un poids, pas une borne** : la ligne
  de niveau garde le dernier mot sur la forme locale. Balayé de 0 à 0,08 — le remplissage passe de
  35 % à 62 %, et le coude est à **0,02** (57 % de remplissage, allongement de boîte 1,84 → 1,35),
  au-delà duquel on ne gagne plus que de la rondeur.

  **MESURÉ** (3 graines, 15 buttes) : bords droits ≥ 8 **100 % → 7,8 %** (max 19 %) ; compacité
  (périm/√aire) **4,47-5,37 → 5,81** de moyenne ; remplissage de boîte **57 %** (31 % au pire).
  L'étalon est ici la **taille comparable** : sur les amas de 200-500 tuiles du même monde, le
  bois est à 6,46 de médiane (min 5,58), la lande 6,70 (min 5,17), la fleuraie 6,88 (min 5,38).
  La butte est dans leur régime — c'est précisément ce qui était demandé.

  **② LA STRUCTURE.** La butte posait `AFFL_BLOCS` = 10 plots à pas constant, chacun s'agrégeant
  un voisin une fois sur deux : une dizaine de cailloux épars sur 320 tuiles. Elle porte
  maintenant le **même réseau** que le chaos (`galerieDuChaos`), à l'échelle de `MINE` — ce qui
  n'est pas galerie et que le champ de masse retient devient un bloc. Le compte cesse d'être un
  réglage, il DÉRIVE de la surface : **53 à 104 blocs**, pour **17 à 33 % de tuiles murées** —
  la densité du chaos du lapiaz (27-31 %), donc le même dédale.

  ⚠ **LE RÉSEAU CHANGE DE PAS, PAS LA BUTTE DE TAILLE.** 320 tuiles avec la dalle de 11 du chaos,
  c'est deux ou trois sites : du bruit, pas un dédale. Grossir la butte aurait déplacé
  `AFFL_ECART`, les lectures de distance de `poi.ts` et l'écartement gardé par A30. `MINE` est
  donc `CHAOS` à l'échelle **1/2** — et les deux réglages se tiennent par un RAPPORT, pas par deux
  nombres : la part murée dépend de `JOINT / DALLE`, halver la dalle sans halver le joint noierait
  la butte sous le vide.

  **④ ET LA MINE PORTE ENFIN DE QUOI MINER** *(décision d'Alexis, 2026-08-27, sur l'inventaire :
  « ajoute plus de nœuds »)*. `AFFL_NOEUDS` **4 → 12**. Le monde joué comptait **48 750 arbres,
  6 564 rochers, 4 099 blocs — et 13 filons de fer, 8 de charbon** : trois ordres de grandeur
  d'écart sur la ressource qui commande toute la forge, et depuis ① on creusait quatre-vingt-dix
  blocs pour quatre filons. Contre les recettes (`iron_ingot` = 2 minerais + 1 charbon,
  `steel_ingot` = 2 lingots + 2 charbons) et les 3+2 buttes de `AFFL_IDENTITES` : fer
  **96 → 288** unités, charbon **64 → 192**. Le charbon reste le goulot — c'est son rôle — mais
  il cesse de borner la carte à un seul village équipé.

  ⚠ **CE COMPTE NE SE DÉRIVE PAS DE LA SURFACE DE GALERIE, ET C'EST DÉLIBÉRÉ.** Les blocs, si (②)
  — parce qu'un bloc EST du terrain. Un filon est de l'ÉCONOMIE : dérivé, le rendement en fer
  deviendrait un effet de bord de `MINE.DALLE`, et retoucher le pas du labyrinthe changerait en
  silence le nombre de villages capables de forger. Il reste donc un nombre de `balance.ts`, qui
  se règle en JOUANT.

  **③ ET LE MINERAI SE POSE SUR LES GALERIES.** C'est la moitié de la demande initiale (« on doit
  pouvoir spawn des nodes accessibles dans la structure »), et elle devient critique ici : dans un
  champ de caillasse, un bloc emmuré est un caillou ; dans une mine, un FILON emmuré est le
  gisement entier qui ment. Les candidates sont donc restreintes au vide du réseau, avec repli
  sans filtre **seulement si la butte n'offre AUCUNE galerie libre** — R51 tient (« le compte ne
  cède jamais »), et l'on préfère poser moins de filons que d'en poser un derrière un mur.
  ⚠ Le repli s'écrivait `surGalerie.length >= AFFL_NOEUDS` : correct tant que la cible valait 4,
  il aurait basculé sur *toutes* les tuiles dès ④ (cible 12) pour toute butte offrant onze
  galeries — c'est-à-dire produit exactement le défaut que cette clause interdit.
  **MESURÉ : 12/12 minerais sur galerie et joignables depuis le dehors sans casser un bloc, sur
  les 15 buttes.** La sonde discrimine (contre-épreuve : il existe bien des tuiles emmurées hors
  galerie), donc ce n'est pas un vert d'accident. La garde exige **100 %**, là où R6ter tolère 5 %
  pour la pierre du chaos.

  **LE SOL RESTE `scree`** et n'est pas repeint en `boulders` : A29 lit le contenant au terrain
  (« le minerai est SUR la rocaille registrée »), `rocailleLibre` filtre dessus, et le joueur y
  lirait autre chose (le `boulders` porte l'art de bloc, et son `cover` vaut 0,8 contre 1). La
  généralisation du réseau est réversible ; un repeint ne l'est pas.

- **R6septies — LA PIERRE DE LA BUTTE SE RANGE PAR HAUTEUR, DE L'ÉCHINE VERS LE BORD.** *(demande
  d'Alexis, 2026-08-27 : « une colonne vertébrale pour la butte avec les pierres les plus hautes,
  un dégradé de 2 ou 3 tuiles vers les pierres basses, puis le minerai / petite pierre autour.
  Facilite la création de "criques" et structures similaires »)*

  Deux champs, tirés de la seule forme du pierrier — donc rien d'arbitraire à régler : la
  **profondeur** (distance au premier non-pierrier) et la **distance à l'échine**, celle-ci
  définie comme les **maxima locaux** de la profondeur. Puis : `dEchine = 0` → pierre HAUTE ;
  `≤ BUTTE.DEGRADE` (2) → MOYENNE ; au-delà → BASSE ; et le minerai se pose dans la COURONNE
  (`> BUTTE.COURONNE`, 4).

  ⚠ **L'ÉCHINE N'EST PAS « LES TUILES PROFONDES », ET C'EST TOUT LE SUJET.** Un seuil sur la
  profondeur rend un DISQUE, pas une vertèbre : mesuré, `prof ≥ 5` donne **49 tuiles** sur une
  butte de profondeur 6 et **110** sur une de profondeur 9 — une tache, qui double d'une graine à
  l'autre. Les maxima locaux rendent une LIGNE : **28 à 50 tuiles par butte, en 3 à 5 morceaux
  dont un principal de 21 à 38**. C'est la crête de la carte de distance, soit le squelette de la
  forme.

  ⚠ **ET LE SQUELETTE N'EST PAS LE CŒUR** — conséquence à connaître, parce qu'elle a fait rougir
  la première garde : le squelette d'un appendice étroit court au milieu de cet appendice, donc à
  faible profondeur. Sur 10 buttes, la profondeur moyenne des hautes dépasse celle des moyennes
  neuf fois sur dix (**2,75 contre 2,84** à l'exception, sur une butte de huit blocs hauts). Ce
  qui tient partout et largement, c'est hautes et moyennes contre BASSES — et c'est ce que la
  garde affirme.

  **LA TAILLE VOYAGE DÉSORMAIS SUR LE NŒUD** (`ResourceNode.size`), là où le chaos du lapiaz
  continue de la redériver de la tuile (`tailleDeBloc`). Raison : elle dépend de la forme de la
  butte ENTIÈRE. Le client ne peut pas la refaire à la volée (il lui faudrait rejouer un BFS par
  butte au chargement, une surface d'état dérivé neuve dans le chemin de rendu pour un seul motif
  visuel), et le `stock` — dont on la déduirait — DÉCROÎT dès qu'on mine. `node-baseline.ts` la
  classe **fixe** : décidée à la pose, jamais retouchée. Le client lit `n.size ?? tailleDeBloc(…)`.

  **MESURÉ** (10 buttes, 2 graines) : hautes **13 %** · moyennes **47 %** · basses **40 %** des
  blocs (`DEGRADE` balayé de 1 à 3 : 61 / 40 / 23 % de basses — 2 est l'étagement le plus lisible).
  Le minerai reste **12/12 joignable sans casser un bloc** : la couronne cède avant les galeries,
  jamais l'inverse.

  **PUIS L'ÉCHINE A ÉTÉ ACCENTUÉE** *(« et comment faire pour accentuer cette échine ? », go
  d'Alexis le même jour)*. La première livraison était mesurable et **invisible** ; deux causes,
  toutes deux corrigées :

  **① ELLE NE PORTAIT PAS SA PIERRE.** La crête faisait 28 à 50 tuiles, d'un seul tenant sur 13 à
  38 — mais **8 à 42 % seulement portaient un bloc** (les galeries la traversaient, le champ de
  masse en retirait encore), et la plus longue arête de pierres hautes retombait à **1 à 8**. Sur
  une butte, 36 tuiles de crête continue rendaient UN bloc haut : on avait dessiné une vertèbre et
  posé du gravier. L'échine porte donc sa pierre **sans condition** — ni galerie, ni seuil de
  masse. Prix chiffré avant de le prendre : **+16 à +37 blocs**, part murée **18-36 % → 29-41 %**,
  et la butte coupée en deux — soit très exactement la « crique » demandée. Le minerai ne paie
  rien : il est en couronne, donc à l'extérieur de la crête (**12/12 joignable, avant et après**).

  **①bis ET LES VERTÈBRES SE RELIENT.** Les maxima locaux d'une forme quelconque sortent en 3 à
  10 paquets ; une butte de la graine 7 n'avait pas d'arête de plus de **5 tuiles**. Chaque paquet
  est donc raccordé au plus gros par un **chemin de crête** — un maximin (on maximise la
  profondeur MINIMALE du trajet), *jamais* un plus court chemin, qui couperait par le flanc et
  ferait descendre l'échine vers le bord : une croix, pas une arête. **MESURÉ après : la plus
  longue arête passe de 1-8 à 20-50 tuiles**, et l'échine reste une ligne (12 à 28 % du pierrier).

  **② LES TROIS TAILLES AVAIENT LA MÊME COULEUR.** Corps `#716c66` / `#716c66` / `#6d6862`,
  dessus `#8a847c` / `#8a847c` / `#88827a` : elles ne différaient que par la hauteur de leur corps
  (8 · 12 · 19 px sur 16 de large), et deux pixels de hauteur ne se lisent pas en vue du dessus.
  **Ce qui se lit, c'est l'écart DESSUS/CORPS** : une pierre haute présente une grande face
  verticale à l'ombre sous un dessus qui prend le ciel. Les trois dessus restent donc proches du
  sol de pierrier (`#96928a`) et le corps FONCE à mesure qu'il grandit — écart de luminance
  **18 → 30 → 44**. Éclaircir la pierre haute l'aurait au contraire fondue dans son sol.

  ⚠ **CONSÉQUENCE ASSUMÉE : LA LECTURE « MAÇONNERIE » S'EN TROUVE RENFORCÉE.** Une arête continue
  de blocs rectangulaires alignés lit comme un mur en ruine. C'est le prix de l'accentuation
  demandée, et il ne se paiera qu'en retouchant la silhouette du bloc lui-même (réserve signalée
  trois fois le 2026-08-27, toujours l'appel d'Alexis).

- **R7 — LA RÉSURGENCE, ET C'EST ELLE QUI PORTE LE GAIN.** Ce que le calcaire avale ressort au
  **contact** avec la marne : une source, dans le pays SEC, là où il n'y a rien. Elle n'est pas
  une décoration — c'est le point où le bilan hydrique se referme, donc elle est dérivée, donc
  elle est gratuite.

  ⚠ **NE PAS SE TROMPER DE CAUSE.** Le karst qui assèche, **seul**, ne rend rien : coins de chasse
  **5→5 · 6→5 · 6→6 · 5→4 · 6→6** sur les cinq seeds — plat à −1. **Tout le gain vient des
  résurgences.** Le karst n'en est pas la cause, il en est la *raison* : il explique pourquoi il y
  a une source là, et c'est ce qui distingue cette spec d'un semis de mares posé à la main.

---

## Le sous-sol — la roche donne le minerai *(décision d'Alexis, 2026-08-26 : « on branche »)*

- **R12 — CHAQUE PROVINCE A SA RICHESSE, ET LE CALCAIRE N'A PAS DE MINERAI.**

  | roche | ce qu'elle porte | pourquoi |
  |---|---|---|
  | **calcaire** | **rien** — mais le lapiaz, les dolines et les résurgences | un carbonate pur ne porte ni fer ni houille. Sa richesse est la pierre et l'eau. |
  | **granite** | le **fer** | les filons de contact |
  | **argile / marne** | le **charbon** | le bassin houiller est sédimentaire |

  Ce qui change pour le joueur : l'identité d'une butte suit aujourd'hui le **rang de son sommet**
  (`CREUX.AFFL_IDENTITES = ['fer','fer','charbon','charbon','fer']`, du plus haut au dernier) — un
  ordre parfaitement invisible, dont aucune connaissance ne se construit. Dérivée de la province,
  elle devient un **savoir de carte** : *« sur le calcaire, il n'y a pas de fer »*. Même table,
  même compte, une clé différente. Zéro ressource neuve.

- **R13 — LA ROCHE CÈDE AVANT LE COMPTE, JAMAIS L'INVERSE.** L'élection prend les trois sommets
  ferreux les mieux classés **parmi ceux de granite**, les deux charbonneux **parmi ceux
  d'argile** ; si une province n'en fournit pas assez, on **relâche la roche** et l'on force au
  meilleur rang. C'est mot pour mot l'idiome que R51 applique déjà à la sécheresse — *« la
  sécheresse cède avant le compte »* — et il n'y a aucune raison d'en inventer un second.

  ⚠ **SANS CETTE CLAUSE, LA RÈGLE CASSE LE JEU UNE FOIS SUR TROIS.** MESURÉ, dérivation naïve
  (la butte prend le minerai de la roche où elle est tombée), 10 seeds :

  - **3 seeds sur 10 perdent tout leur charbon ou tout leur fer** — seeds 42 et 3 : *aucune*
    butte sur argile ; seed 55 : *aucune* butte sur granite.
  - **22 buttes sur 50 (44 %) tombent sur le calcaire**, donc stériles : la carte serait sans
    minerai presque une fois sur deux.

  Et le charbon est le goulot que R51 protège explicitement (*« à 2+1, 32 charbons par passage
  bornaient la carte à UN village équipé »*). C'est la leçon des gardes d'atteignabilité : **un
  balayage de table fabrique ses conditions ; il faut prouver séparément que chaque valeur du
  domaine est atteignable.**

  ⚠ **CE N'EST PAS UNE PÉNURIE DE TERRAIN, C'EST UN PETIT NOMBRE.** Le terrain éligible à une
  butte (herbe · fleuraie · lande) est **équi-réparti entre les trois provinces** — mesuré
  29-39 % / 33-37 % / 28-36 % sur 4 seeds. Le défaut vient de ce qu'on n'élit que **cinq** buttes
  au rang global : cinq tirages dans trois provinces laissent souvent une province vide. Descendre
  le rang pour trouver la bonne roche coûte donc un sommet un peu plus bas, et rien d'autre.

---

## Ce que ça change, MESURÉ

### La végétation *(mesuré séparément, en (a) : la roche appliquée à l'humidité seule)*

Avec un décalage de drainage de ±0,8 rang **puis re-quantile** :

- **24 à 26 % de la carte change de mot** (3 seeds).
- **La composition ne bouge pas d'un dixième** — herbe 37,0 / bosquet 12,5 / fleuraie 12,1 /
  prairie humide 4,3 / lande 5,3, avant comme après. Les contrats A12 et A17
  (« l'ouvert ≥ 55 % ») tiennent **par construction**, parce que les seuils sont des quantiles et
  qu'ils se redérivent. *Décaler le rang SANS re-quantiler, c'est mesurer la dérive d'une
  implémentation qu'on n'écrirait jamais : la première version de l'instrument le faisait, et
  sortait l'herbe à 21,7 % — A12 rouge, pour rien.*
- **Les mots sortent de leur bande.** Étendue le long de l'axe de l'eau (p10 → p90, en tuiles) :

  | mot | avant | après |
  |---|---|---|
  | bosquet | 12 → 104 (**92**) | 9 → 188 (**179**) |
  | prairie humide | 2 → 27 (**25**) | 3 → 52 (**49**) |

  Le bois **double son domaine** et cesse d'être un liseré riverain.
- **La matrice apparaît.** Distance moyenne du bosquet à l'eau, par province :
  **calcaire 14 · granite 37 · argile 98**. L'ordre **tient franchement dans chaque province** et
  se **compresse** globalement — la logique locale reste lisible, la prédiction globale ne suffit
  plus. C'est la définition d'un second axe.

### La faune

| seed | coins aujourd'hui | karst seul | + résurgences | couverture (naissance possible) |
|---|---|---|---|---|
| 2026 | 5 | 5 | **10** | 2,55 % → **5,86 %** |
| 7 | 6 | 5 | **10** | 3,49 % → **6,07 %** |
| 42 | 6 | 6 | **13** | 3,42 % → **7,46 %** |
| 1234 | 5 | 4 | **9** | 2,71 % → **4,81 %** |
| 99 | 6 | 6 | **13** | 2,91 % → **6,94 %** |

**Le seul endroit du monde où une bête peut naître est doublé**, sans toucher à la décision du
2026-07-13 (« entre les coins, la vallée est vide ») et sans ajouter une espèce.

### Ce qui ne cède pas

- **Emplacements de village : 49-55 → 45-55**, pour un plancher A17 de **16**. Aucune tension.
- **Connexité (A13, « la Racine marchable reste d'un seul tenant »)** : `boulders` et `scree` sont
  **marchables**. Elle tient par construction — assécher n'enferme personne.

---

## Ce que ça coûte

- **R8 — A16 SE RÉÉNONCE, ET C'EST UNE DÉCISION, PAS UN AJUSTEMENT.** Le critère qui prouve
  aujourd'hui qu'il existe une variable d'ordre devient : **« l'ordre tient DANS une province »**
  (mesuré : bosquet à l'eau, calcaire 14 · granite 37 · argile 98). Globalement il se compresse
  au lieu de s'inverser — le rang survit, il cesse d'être *prédictif*. C'est très exactement le
  but, et il faut l'écrire pour ne pas croire un jour à une régression.

- **R9 — LE VRAI PRIX EST LE FLUX RNG.** Le champ lui-même est gratuit (sel dédié `'ROCH'`, aucun
  PRNG partagé — la doctrine du dépôt). Mais repeindre un quart du pré change le **compte de nœuds
  par type**, donc `placeZoneNodes` bouge, donc des tests sans rapport rougiront. C'est le coût de
  ce chantier, et il est connu d'avance (mémoire « RNG fragile au décompte d'entités »).

- **R10 — LE CACHE DE CARTES SE PÉRIME TOUT SEUL.** `tools/carte-cache.ts` s'invalide sur
  l'empreinte de `packages/sim/src` : du CPU de suite, pas un risque.

- **R11 — A14 (les bosquets de crête) SE RÉÉNONCE : LE RAPPORT PASSE DE 3 À 2,5.** *(Cette règle
  disait « à éprouver » ; elle l'a été, et voici ce qu'a rendu la mesure.)* Le compte de bois
  (≥ 5 massifs de 400 tuiles) tient sans retouche. **C'est le RAPPORT qui casse** — le conifère
  de crête doit être à plus du triple de l'eau que le bosquet humide — et il casse **par les deux
  bouts à la fois**, ce qui est la signature du second axe et non un dommage :

  | seed 42 (`vallee`) | avant | après |
  |---|---|---|
  | bosquet humide | 46 t. de l'eau | **40 t.** |
  | rapport du pin | **3,43** | **3,06** |
  | rapport du mélèze | **3,33** | **2,86** |

  ⚠ **LA MARGE ÉTAIT DÉJÀ MINCE AVANT — 11 %**, et c'est la mesure qui a corrigé mon analyse :
  la note historique de §2ter (« pin 176-211 tuiles contre 24-27 ») date d'un autre état du
  worldgen et laissait croire à un rapport d'environ 7. Il valait 3,33.

  Le rapport mesure exactement la **corrélation que la roche-mère est faite pour rompre**. La
  DEMANDE d'Alexis (2026-07-29, *« quelques patchs de forêt loin des points d'eau »*) reste
  tenue et se voit : près de trois fois plus loin de l'eau que le bois humide, c'est un bois sec
  au milieu d'un pays mouillé. C'est le CHIFFRE qui était calibré sur une carte à un seul axe —
  et il ne l'était que de justesse.

- **R11bis — A11 : LE LIEN MARAIS/ROSELIÈRE PREND LA TOLÉRANCE DE SA RÉSOLUTION.** Les deux
  terrains COLLÉS à l'eau valent ~1 cellule de la grille de mesure (4 tuiles), et leur écart se
  comptait **déjà** en centièmes de cellule avant ce chantier (mesuré, `vallee` : seed 42
  **0,96 contre 1,11**, seed 1 **1,15 contre 1,20**). Déplacer les lacs suffit à faire croiser la
  seed 7 (**1,38 contre 1,21** — sept dixièmes de tuile). L'assertion reste, avec une tolérance
  d'une cellule : sous la résolution, l'instrument ne distingue rien. **Les cinq autres liens du
  rang se comptent en dizaines de tuiles et restent stricts.**

  ⚠ Deux garde-fous ont été posés **avant** d'y toucher, et ils ont fait la moitié du chemin :
  ni le lapiaz ni la résurgence ne mordent sur le pays mouillé (marais, roselière, tourbière),
  et les sources se posent **après** la frange de marais — une source karstique est de l'eau
  claire sortant de la roche, pas une vasque de boue.

---

## Critères d'acceptation

- **A1 — LA COMPOSITION EST INTACTE.** Sur toute seed, les parts des sept mots du pré restent dans
  les fourchettes d'A17 (`t0-exploration.md`), au dixième près de la carte d'avant. C'est
  l'invariant qui dit que les seuils se sont bien redérivés.
- **A2 — LE SECOND AXE EXISTE.** L'ordre du rang à l'eau **tient dans chaque province** (le rang
  d'A16, mesuré séparément sur calcaire, granite et argile), et l'**étendue** p10→p90 du bosquet
  **au moins double** par rapport à la carte d'avant. Deux mesures, parce qu'une seule ne
  distingue pas « un second axe » de « du bruit en plus ».
- **A3 — LA RIVIÈRE EST ENTIÈRE.** `map.fil` est d'un seul tenant sur toute seed, quelle que soit
  la part de son cours qui tombe sur le calcaire (mesurée jusqu'à 88 %). Garde exhaustive.
- **A4 — LE LAPIAZ EXISTE ET SE MARCHE.** Sur toute seed, `boulders` + `scree` ≥ 1 % de la carte
  (contre 0,12 % aujourd'hui), et la Racine marchable reste d'**une seule composante** (A13).
- **A5 — LA FAUNE Y GAGNE.** Sur toute seed, le nombre de coins de chasse est **≥ celui d'avant**,
  et la couverture (part de terre marchable à portée d'un coin) **≥ 4,5 %**. ⚠ Le critère porte
  sur le RÉSULTAT, pas sur le nombre de sources : si le placement des résurgences change de
  mécanisme demain, il reste le bon.
- **A6 — LES VILLAGES TIENNENT.** `emplacementsDeVillage` ≥ 16 sur toute seed (mesuré : 45-55).
- **A7 — A14 SURVIT.** ≥ 5 bosquets de conifères d'au moins 400 tuiles par seed, et leur distance
  moyenne à l'eau reste au moins triple de celle du bosquet humide.
- **A8 — RIEN DE NEUF DANS LE CATALOGUE.** Aucun `NodeType`, aucun `ItemId`, aucun id de terrain
  ajouté par ce chantier. Garde par construction : la contrainte d'Alexis du 2026-08-26.
- **A9 — LE COMPTE DE MINERAI NE CÈDE JAMAIS.** Sur toute seed : **3 buttes ferreuses et
  2 charbonneuses**, exactement — le plancher de R51, inchangé. Garde exhaustive, pas un
  échantillon : c'est le critère que la dérivation naïve échoue 3 fois sur 10.
- **A10 — ET LA RÈGLE RESTE APPRENABLE.** **≥ 90 % des buttes portent le minerai de leur
  province**, et le calcaire n'en porte **au plus une par carte**. ⚠ A9 seul serait satisfait par
  un repli permanent : le compte tiendrait pendant que le joueur apprendrait une règle fausse.
  Les deux critères se tiennent — *une garde qui dégrade cache le défaut*.

  ⚠ **CE CRITÈRE NE PEUT PAS ÊTRE UN ABSOLU, et c'est une conséquence de R13, pas un renoncement.**
  « Jamais de butte sur le calcaire » et « le compte ne cède jamais » sont en conflit direct : les
  derniers crans de la cascade existent précisément pour que le compte gagne. MESURÉ après
  implémentation (10 seeds) : **49 buttes sur 50 sont fidèles à leur province** — 9 seeds rendent
  exactement `3 fer@granite + 2 charbon@argile`, et la seule exception est un fer sur calcaire à
  la seed 99, quand l'écart minimal entre buttes ne laissait plus de sommet libre ailleurs.

---

## Réglages — ce qui reste à trancher À L'ŒIL

Ils vivent dans un bloc `ROCHE` à côté de `CREUX` (`racine-relief.ts`), au patron des autres blocs
de worldgen : **ça se règle en REGARDANT une carte**, pas en jouant.

| réglage | valeur mesurée | ce qu'elle décide |
|---|---|---|
| `ECHELLE` | **520 tuiles** | la taille d'une province (~14 écrans). Plus petit = un patchwork ; plus grand = deux pays et rien d'autre. |
| `PART_CALCAIRE` / `PART_ARGILE` | **0,32 / 0,32** (granite = le reste) | combien de pays sec, combien de pays mouillé |
| `DRAINAGE` | **0,085** (unités du champ d'humidité) | la force du décalage. Calibré pour que **23 à 25 % de la carte change de mot** — la cible de l'étude, atteinte au premier essai (mesuré, 3 seeds, contre HEAD sorti à côté par `git archive`). |
| `SOURCE_ESPACEMENT` | **90 tuiles** | **LE cadran de la faune.** ⚠ Le rendement n'est PAS linéaire : le gain dépend de la coïncidence avec le treillis de Poisson à 200 tuiles du semis des coins. |
| `SOURCE_RAYON` | **3** (mare de 7×7) | une source est une mare, pas un lac |
| `SOURCE_PART_BASSE` | **0,42** | la part basse du pays où une source peut sortir. ⚠ **Ce n'est pas un confort : c'est ce qui sauve A14.** Sans lui les sources tombaient aussi sur les dos secs et le pin passait de ~176 tuiles de l'eau à **96** — sous le rapport exigé. Une résurgence est un point BAS par définition. Le serrer à 0,35 ne rachète pas A14 (le bosquet humide s'éloigne avec) et coûte cher en faune : coins 9·8·12·6·8 au lieu de 10·9·14·7·12. |

---

## Bornes de ce qui a été mesuré

⚠ **L'ÉTUDE EST POST-HOC.** Les deux instruments partent de la carte **finie** : l'un relit le rang
d'humidité que chaque mot encode déjà et le décale, l'autre assèche l'eau tombée sur le calcaire et
pose des mares au contact. Le vrai (b) entre **avant `placerLacs`** : le quantile de bassin se
redérive, donc **les lacs eux-mêmes changent d'adresse** — même volume total, autres endroits. Les
chiffres ci-dessus sont un ordre de grandeur du bon signe, pas la carte qui sortira.

⚠ **LES PLANCHES SUR-FRAGMENTENT LES LISIÈRES.** Pour simuler l'axe, l'instrument reconstruit une
humidité continue à partir de cinq rangs discrets ; la vraie implémentation décale le champ *avant*
le seuillage et le lit au **motif de 8** — les taches resteraient aussi propres que sur la carte
d'aujourd'hui. Les planches sont justes sur le **où**, bruitées sur les **bords**.

⚠ **LES FRONTIÈRES DE PROVINCE DOIVENT SE QUANTIFIER.** Sur les planches ce sont des courbes
lisses ; le monde est **rectiligne** (worldgen R32). Une vraie province se quantifie au motif,
comme tout le reste.
