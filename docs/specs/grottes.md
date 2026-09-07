# Les grottes de terrasse — le karst est la Grotte

*Spec issue du brainstorm du 2026-09-05 (onze questions, une à la fois — les onze décisions sont dans `docs/decisions.md` à cette date). Elle s'appuie sur `etages.md` (le modèle d'étage, la cave de mesa B1, le voile de cave), `terrasses.md` (les paliers du sol, T-R1..T-R9), `roche-mere.md` (les trois roches, R4/R7/R12), `lieux.md` (la découverte, R6), `faune.md` (la tanière), `atelier-plans.md` (le `.plan`). Rien de ce qui suit n'est implémenté : c'est le contrat contre lequel on implémente.*

## 0. Ce qui ne bouge pas

- Le modèle d'étage (`etages.md` §2-§4) : un étage est une CARTE (`EtageCreux`), le connecteur est le SEUL passage (E-R7/E-R8), l'atteignabilité est E-R5, le pas est `etagesDuPas` + `etageApresLePas`. La grotte n'ajoute pas de règle de marche.
- `map.terrain` n'est pas repeint par le creux : une tuile de grotte vit dans SA grille creuse (E-R1). **Une exception nommée, G-R9 : la trace sur le palier** — de l'eau et une coulée de SURFACE, qui sont du terrain ordinaire et se lisent comme tel.
- La lumière est B1, construite : `partDuCiel` borné par `TEMPERATURE.CIEL_PENETRATION` = 4, le voile de cave (`cave-veil.ts`) percé par le jour de la gueule, la torche (3 tuiles) et soi. La grotte en hérite tel quel — **il fait noir au fond à midi** sans une ligne de plus.
- Le déterminisme : **aucun tirage**. Tout ce qui suit est un hachage positionnel salé ou une dérivation de la carte (E-R15, le patron de `creuserLaCave` : `SEL_CAVE`). Le flux du PRNG de la partie ne bouge pas d'un bit (critère G-A2).
- Le catalogue : toute pièce posable est UNE entrée de `PIECES` ; ce qui concerne une pièce s'écrit dans son entrée (décision 2026-08-01).
- Le monde complet (`'vallee'`) : la passe suit le régime des terrasses — elle ne tourne que là où `map.palier` existe. Sans palier, pas de paroi, pas de karst.

## 1. Les onze décisions, en une ligne

| Q | décision | contre |
|---|---|---|
| 1 | les grottes de terrasse sont des **réseaux**, pas des passages | la porte dans la paroi (reco) |
| 2 | un réseau est un **karst borné** (200-400 t, 2-4 gueules sur UNE paroi), à chambres d'auteur | la terrasse entière en réseau ; le `.plan` tamponné |
| 3 | la chambre est **creusée par le squelette**, le plan ne pose que l'ameublement | la région `grotte` d'un `.plan` (reco) |
| 4 | l'ameublement est une **composition de vignettes ancrées** (`ancre: eau/paroi/centre/porte`) | le plan de salle rogné ; le semis au hash |
| 5 | l'eau est la **nappe du calcaire** : karst élu dans le calcaire, bassin par salle, niveau fixé par la roche | l'infiltration du dessus (MESURÉ 0,2-1,2 %) ; le hash pur ; sèches |
| 6 | un lieu à **trois temps** : abri, eau et pierre, tanière — zéro ressource neuve | le gisement ; l'abri seul ; le Repaire des Cendreux |
| 7 | le squelette est un **arbre à tronc** : la profondeur EST la distance à la paroi, une seule boucle | la chaîne ; le graphe à boucles ; le puits |
| 8 | **le karst EST la Grotte** : une zone `kind: 'grotte'`, la Grotte de surface est retirée | deux objets ; pur terrain |
| 9 | sous la roche, **le bivouac**, pas la maison (`PIECES[x].sousRoche`) | la troglodyte ; rien ; bivouac + porte |
| 10 | un **plancher** : une Grotte à ≤ ~100 t de chaque naissance et site de village, quelle que soit la roche | le calcaire seul (MESURÉ : acte II sur 3/5) ; la greffe ; la Grotte d'auteur |
| 11 | la Grotte laisse une **trace sur le palier** : l'eau (résurgence) pour la noyée, la coulée pour la tanière | la gueule seule ; le signe de vie ; le cairn |

## 2. Le modèle

- **G-R1 — Un souterrain a une identité d'étage à lui : `−H`.** `H` est la hauteur de la masse creusée (la terrasse `p+1` dont on entre par la paroi : le karst est à `−(p+1)`) ; la gueule est un connecteur `{de: p, vers: −(p+1), type: 'gueule'}`. **Prérequis, corrige un défaut latent** : E-R5 sort sur `ae === be`, et une cave à la hauteur `p` partage aujourd'hui son entier avec tout le sol de la terrasse `p` — MESURÉ (graine 2026) : 6 caves de mesa sur 7 au niveau ≥ 0 ont du sol de leur palier à 1-8 tuiles, le loup les atteint à travers la roche. La cave de mesa (`base − 1`) migre vers le même régime (`−(base)`) dans le même geste : un seul modèle de souterrain. `decalageDEtage(niveau, palier)` mesure l'enfoncement sous le palier de la gueule : un souterrain se DESSINE à `liftDuPalier(p) − decalageDEtage(−(p+1), p)` (`Warp.liftAEtage`), et `strateDEtage` range TOUT niveau négatif dans une seule strate — la cave de mesa et le karst partagent la couche souterraine (T-R7 ne bouge pas).
- **G-R2 — Le karst est un LIEU : une zone `kind: 'grotte'` de `map.zones`**, élue par le relief, pas tirée par `placePois`. `x, y` = la tuile OUEST de la gueule principale (c'est là qu'on la découvre, R6bis : la vue à trente tuiles depuis le palier) ; empreinte = ses tuiles creusées, portées par l'étage `−H`. `POI_TYPES.grotte` garde `monster: 'boar'`, et gagne le marqueur `eluParLeRelief: true` — `weight`/`cap`/`reserve` ne s'appliquent pas. `walkableTilesFor`, `isOnPoiKind` et `populateDen` apprennent l'étage : l'empreinte d'un lieu peut être une grille creuse.
- **G-R3 — Le squelette est un arbre à tronc.** Derrière la paroi, trois bandes de profondeur (distance Chebyshev à la gueule la plus proche) : le **vestibule** touche la paroi (rangées 1 à `KARST.VESTIBULE_RANGEES` = 5 — dans `CIEL_PENETRATION`, donc éclairé de jour), le **cœur** au milieu (1-2 salles), le **fond** au plus loin de TOUTE gueule (≥ `KARST.FOND_DISTANCE`). La gueule principale ouvre sur le vestibule ; chaque gueule secondaire (2 à 4 en tout, même paroi, ≥ `KARST.GUEULES_ECART` tuiles entre elles) ouvre sur un boyau latéral qui rejoint le cœur — **une seule boucle par karst**. Les salles croissent en largeur depuis un germe (recette de `creuserLaCave`, ordonnée par index, rayon modulé par le fbm salé `'CAVS'`) ; les boyaux sont des escaliers de `KARST.BOYAU_LARGEUR` ≥ 2 tuiles (MESURÉ : une tuile est impraticable — hitbox à cheval, et le semis mure), sinués par le même champ. Une seule grille creuse par karst.
- **G-R4 — L'eau est la nappe du calcaire.** Chaque salle a un relief de sol (`'CAVS'`) ; son bassin le plus bas se remplit à un niveau fixé par la **famille de roche à la gueule** (`familleAt(creux, gx, gy − 2)`) : calcaire → **noyée** (le tiers bas de la salle : `TERRAIN_DEEP_WATER` au cœur, couronne `TERRAIN_SHALLOW_WATER` d'une à deux tuiles), granite → une flaque peu profonde ou rien, argile → rien. Les boyaux d'un karst calcaire portent un **fil d'eau** peu profond d'une tuile sur leur bord bas, qui relie les bassins. L'eau d'une salle est du terrain de la grille creuse (`terrain[]` de l'`EtageCreux`), pas de `map.terrain` — E-R1 tient : la faune de surface ne la voit pas (`nearWater` lit `map.terrain`), la pêche non plus tant qu'elle ne sait pas lire un étage.
  - *Germe privilégié, À MESURER avant de promettre* : le **gouffre** (la cellule calcaire la plus basse où un lac s'arrête, R4) — le karst sous la paroi voisine est « là où va l'eau du lac ».
- **G-R5 — Trois temps, dans la grammaire existante.** (1) Le vestibule est **l'abri** : `isSheltered` est vrai sur toute tuile creusée — par `isOnPoiKind('grotte')`, qui existe (`temperature.ts:97`) ; conséquence VOULUE : température stable, donc l'abri contre le froid, la nuit et la traque thermique des Cendreux d'acte III. **Précisé le 2026-09-06 (Alexis : *« il doit toujours faire 13 °C dans une grotte »*)** : sous la roche, l'air ne s'AMORTIT pas comme sous un toit, il est FIXE — `TEMPERATURE.GROTTE_AMBIANT` = 13 °C, la moyenne annuelle du pays, quels que soient l'heure, l'acte, le front, le biome du dessus, la Brume ou la cendre (`baselineTemperatureAt` le rend avant toute lecture de l'horloge, dès que `sousLaRoche`). Conséquences : pas de thermogenèse ni d'hypothermie sous la roche ; les Cendreux y sont amorphes toute l'année (13 > `TORPEUR.CHAUD`) ; un bivouac n'y change rien à l'air (12,3 °C à la demi-tuile < 13 : une station, pas une chaleur) ; en Ardeur, la grotte est la fraîcheur. Le thermomètre du HUD se lit à l'étage du joueur. (2) Le cœur donne **l'eau et la pierre** : l'eau ne gèle jamais sous la roche (G-R11), des nœuds `rocher`/`blocs` (le chaos de R6ter) sur le sol de la grille creuse. (3) Le fond est **une tanière** : `populateDen` pose la bête sur la tuile praticable du fond la plus loin de toute gueule ; sanglier au régime d'aujourd'hui (résident, `DEN_RESPAWN_TICKS`, `DEN_SPAWN_CLEARANCE`) ; **une Louvière seulement** si un coin de chasse est à portée de la gueule — la garde dure de `faune.md` ne s'assouplit pas ; **jamais** pour la Grotte du plancher (G-R8).
- **G-R6 — L'ameublement est une composition de vignettes ancrées.** Une vignette est un `.plan` de 3×3 à 5×5, hors région (aucun mur dérivé), avec la clé neuve `ancre: eau | paroi | centre | porte`. Par salle, 2 à 4 vignettes, élues au hachage positionnel parmi celles dont l'ancre est disponible (une salle sans eau n'offre pas `ancre: eau`), posées là où elles tiennent **à 100 % sur du creusé** ; une vignette sans place ne se pose pas — l'intention ne se rogne jamais. Traversabilité gardée : ≥ 1 tuile de circulation entre vignettes et vers chaque porte de la salle. L'antre de `grotte.plan` devient les premières vignettes `ancre: paroi`.
- **G-R7 — Le bivouac, pas la maison.** `PIECES[x].sousRoche: boolean` — vrai pour ce qui n'enferme pas (`fire`, `chest`, `sechoir`, `table`, `banc`, `paillasse`, `etagere`, `tonneau`…), faux pour ce qui clôt ou couvre (`wall`, `palissade`, `door`, `floor`, `roof`, `house`, `encadrement`, `poutre`, `mur_bas`) et pour les ateliers lourds (`furnace`, `four_acier`, `atelier_lourd`, `tour_meca`). La pose lit l'étage du bâtisseur : `Structure.etage?: number` (absent = au sol, T-R3), la collision du bâti se juge sur la grille de cet étage, et une structure à `etage < 0` **n'existe pas** pour la surface (rendu, collision, `roofAt`).
- **G-R8 — Le plancher, puis la roche.** (a) Pour chaque point de naissance et chaque site de village (`pointsDeSpawn`, `emplacementsDeVillage`), s'il n'y a pas de Grotte à ≤ `KARST.PLANCHER_RAYON` (100 t), on en creuse une sur la **paroi éligible la plus proche, quelle que soit sa roche** (passe TARDIVE, après ces deux fonctions, comme `placeZoneNodes`). (b) Au-delà, la densité suit la roche : `KARST.PART = { calcaire: 1, granite: 0.3, argile: 0.1 }` appliquée au hachage d'élection le long des segments de paroi éligibles, sous `KARST.ESPACEMENT` (120 t) entre deux gueules principales. MESURÉ (5 graines, ≥ 6 de large, ≥ 20 rangées) : 419-475 segments éligibles par carte ; la paroi calcaire la plus proche du spawn à 81-232 t, 0 calcaire à ≤ 150 t sur 3 graines sur 5 — sans plancher, la Grotte est une découverte d'acte II.
- **G-R9 — La trace sur le palier, tout dérivé.** La gueule principale d'un karst **noyé** pleure : `KARST.TRACE_EAU` (3-8) tuiles de `TERRAIN_SHALLOW_WATER` de `map.terrain`, depuis le pied de la gueule vers le bas de pente du palier (la voisine marchable la plus basse en `altLarge`, puis de proche en proche), qui s'arrêtent là où le compte est atteint ou la pente remonte — c'est **la résurgence de R7**, enfin une donnée. Sur un palier en pente inverse, une flaque sur place. La gueule principale d'un karst **sec** (une tanière) reçoit une **coulée** courte (`zonegen-coulees.ts`, même pureté) qui la relie à la sente ou à la coulée la plus proche. Dans les deux cas, le seuil est piétiné et frangé d'éboulis (dessin, pas terrain). Ces tuiles de surface sont **stériles pour le semis** comme les connecteurs, et la passe tourne APRÈS l'hydrologie et les terrasses (N3 : l'eau naît sur l'escalier — la trace ne crée pas de marche d'eau : T-A11 doit tenir avec elle).
- **G-R10 — La Grotte de surface est retirée.** `poi.ts` : l'entrée `grotte` cesse d'être tirée par `placePois` (`zones: []`, `eluParLeRelief`) ; `grotte.plan` sort du registre des lieux bâtis et ses régions deviennent des vignettes ; la garde C4 de `lieux-batis.md` se réécrit pour le karst (G-A5). MESURÉ : elle était morte sur le monde joué (`MONDE_JOUE = 'racine'`, sans `karst` ni `gouffre`).
- **G-R11 — Ce que le souterrain ne subit pas.** Le **gel** (`gel.ts`) ne touche que l'eau de `map.terrain` — l'eau d'une grille creuse ne gèle jamais (la nappe est à température stable) ; la trace de G-R9, elle, gèle : c'est le contraste voulu. La **teinte du jour** et le voile de nuit ne s'appliquent pas à `etage < 0` (E-R13/T-R8bis : ce qui quitte la bande du sol quitte le voile). La **neige** ne se dépose pas sous la roche.

## 3. La passe de génération (`zonegen-karst.ts`, appelée par `zonegen.ts`)

Ordre : après `terrasses` (N3 : escalier, hydrologie, `epouserLEscalier`, assises, rampes) et après l'assemblage des mesas et de leurs caves — le karst doit connaître toutes les portes existantes pour ne jamais partager une tuile avec elles (`connecteurAt` rend le PREMIER connecteur).

1. **Les segments de paroi éligibles** : une tuile de PIED est marchable au palier `p`, sa voisine nord est au palier `p+1`, et la colonne reste ≥ `p+1` sur `KARST.ROCHE_MIN` rangées ; les pieds contigus d'une rangée forment un segment ; on garde les segments de largeur ≥ `KARST.SEGMENT_MIN` (6), sans colonne de rampe ni de gueule de mesa, et dont la roche derrière ne contient aucune tuile de cave de mesa.
2. **L'élection** : hachage positionnel (`hash2(x, y, SEL_KARST)`, `SEL_KARST = 'KARS'`) sur la tuile EST de la gueule principale, comparé à `KARST.PART[famille]` ; les élus se filtrent par `ESPACEMENT` dans l'ordre des index (ordre total, deux moteurs rendent le même monde).
3. **Le creux** : germes du vestibule, du cœur et du fond aux profondeurs de G-R3, salles par croissance en largeur bornée par `'CAVS'`, boyaux entre germes, gueules secondaires et leur boyau latéral, jusqu'à `KARST.TUILES` (200-400) ; **la roche cède avant le compte** (R13) : un karst qui ne peut pas placer son fond à `FOND_DISTANCE` n'est pas creusé.
4. **L'eau** (G-R4), puis **les nœuds de pierre** sur le sol creusé (hachage, comme `terrainDeDessus`).
5. **La zone** (G-R2), **les connecteurs** (`de: p, vers: −(p+1)`, type `'gueule'`, une paire `[ouest, est]` par gueule, marchable des deux côtés), **la trace** (G-R9).
6. **Le plancher** (G-R8a) : passe tardive, après `pointsDeSpawn`/`emplacementsDeVillage`, mêmes étapes 3-5 sur la paroi éligible la plus proche.
7. **Les vignettes** (G-R6) : à l'amorce, avec les lieux bâtis (`poi-batis.ts`), sur le `terrain[]` de la grille creuse — `Structure.etage = −H`.

Réglages de CARTE, à côté du générateur (`export const KARST = {` en tête de `zonegen-karst.ts`) : `TUILES 300` (borne haute), `GUEULES_MAX 4`, `GUEULES_ECART 8`, `BOYAU_LARGEUR 2`, `VESTIBULE_RANGEES 5`, `FOND_DISTANCE 24`, `ROCHE_MIN 28`, `SEGMENT_MIN 6`, `PART {calcaire 1, granite 0.3, argile 0.1}`, `ESPACEMENT 120`, `PLANCHER_RAYON 100`, `TRACE_EAU 6`. Ce sont des ordres de grandeur : ils se règlent **en regardant une carte** (`tools/apercu-carte`), et la spec ne les tient pas pour vrais avant la mesure.

⚠ **`FOND_DISTANCE` et `DEN_SPAWN_CLEARANCE` (24)** : le repeuplement attend qu'aucun avatar ne soit à moins de 24 tuiles — un fond à 12 (le chiffre du brainstorm) laisserait un campeur du vestibule bloquer la tanière. Deux issues, à trancher à l'implémentation par la mesure : le fond à ≥ 24 (donc `ROCHE_MIN` 28 — les parois existent, 355-420 segments par carte), ou la clairance apprend que sous la roche c'est la ligne de vue qui compte.

## 4. Le rendu

- **Dedans** : la couche souterraine d'`etages.md` (roche opaque sur LA MASSE — §4ter —, salle par-dessus, voile de cave, jour par la gueule, torche, soi) — la strate `−H` se peint comme la `−1` d'aujourd'hui. L'eau d'une salle est une **tuile statique** de la couche souterraine (`cv-eau-…`, `cave-art.ts`), pas un second `water-field` : sans teinte de jour ni reflet de ciel, noire dans le noir, révélée par la torche (MESURÉ au smoke `grotte` ③ : 8 → 55 de luminance). Le shader d'eau reste à la surface — un champ de plus par niveau négatif aurait coûté une passe plein écran pour quelques dizaines de tuiles.
- **Les structures** à `etage < 0` se peignent dans la couche souterraine et nulle part ailleurs — **convention client** : `sousLaRoche(s)` (`index-noeuds.ts`) partout où le rendu lit un `etage`, le sprite prend le lift et la strate de sa salle (`Warp.liftAEtage` / `strateAEtage`) et se cache dès que le regard remonte (`SnapshotView.montrerLaRoche`) — le regard se pose **en tête d'image**, avec le découvert (`WorldScene.poserLeRegardSousLaRoche`), parce que la salle et son mobilier le lisent à deux moments du rendu et doivent basculer sur la MÊME image ; l'index des nœuds est à deux mondes (`cleDeTuile(tx, ty, sousRoche)`), une tuile peut porter un nœud de salle ET un nœud de terrasse, et `noeudVu` suit le regard. Le feu de la salle perce le voile de cave à `FEU_CAVE_TUILES` (= `HOLE_RADIUS_TILES × TORCHE_CAVE_TUILES / TORCHE_HOLE_TILES`, 4,5 tuiles — dérivé, pas posé), avec braise et chaleur ; ses flammes, sa flaque et son point de lumière (`feux`, `WorldScene`) n'existent que sous la roche. Depuis le palier, un feu de vestibule se voit par la gueule (§4bis, `feuxSousRoche`) ; les feux de la surface, eux, restent listés depuis la salle.
- **La gueule dans une paroi de terrasse** : l'image de la mesa (`dessinDeLaGueuleEntiere`, 32×48, trois rangées sur deux colonnes) sur les rangées de paroi de `cliff-layer.ts` — passe à part, comme pour la mesa (la boucle de la couche ne visite pas les connecteurs). Toute tuile de grille pleine reste épinglée (`epinglerLaTuile`).
- **La trace** est de la surface : l'eau par `water-layer`, la coulée par le dessin des coulées, le seuil piétiné et l'éboulis par `cliff-art`. Rien de neuf à inventer, tout à brancher.

## 4bis. Sous la roche, le dehors s'efface (2026-09-06)

Le rendu était juste sans qu'on l'écrive : la roche (`ROCHE_DEPTH`) coiffe toutes les couches du dehors, la pluie, la brume et les rubans du vent se peignent sous elle. Mais **l'oreille et la barre n'ont pas de strate** : au fond d'une salle noire on entendait la pluie du plateau au plein, les oiseaux de l'aube, le clapotis du lac au-dessus de sa tête, et l'icône du ciel disait « il neige ». Une seule règle, la même loi que le jour qui entre par la gueule :

- **`dehorsIci`** (`WorldScene`) = `partDuCiel` à la tuile du joueur quand il est sous la roche, 1 à l'air libre — 1 sur la gueule, `1 − d / (CIEL_PENETRATION + 1)` en s'enfonçant, 0 au-delà de quatre tuiles. **Dérivé, jamais posé** : il n'y a pas de second réglage.
- **Ce que la roche retire, au prorata** : les nappes du ciel (pluie, neige, vent, brume — `SonsDuCiel`) et le grésil, l'icône « ciel couvre » (`cielCouvre`), l'aiguille du vent (sa force), le chant des oiseaux (son gain). **Le tonnerre passe** — il traverse la roche, c'est ce qui le rend inquiétant dedans.
- **Le clapotis** se lit sur la NAPPE DE LA SALLE (`terrainAEtage` à l'étage du joueur, `dRiveDeLaSalle`), pas sur la rive de surface : un lac de terrasse à l'aplomb ne s'entend pas d'en bas, l'eau de la salle oui.
- **Ce que la cave ajoute** : la goutte SONNE là où elle tombe (`SonsDeLaGrotte`, `CaveFx.onGoutte`) — un ploc qui monte, son écho un dixième de seconde après, spatialisés à `PORTEE.GESTE` sur la tuile d'impact. Aucune nappe : le silence entre deux gouttes est le son de la grotte. Esthétique **à valider à l'oreille** (banc `#son`).
- **La barre nomme la Grotte** : `lieuAt(map, x, y, etage)` — sous la roche, la règle de `poisAt` (G-R2, l'emprise creusée à son étage, la plus petite tranche) ; au sol, au bit près le jeu d'avant. Avant : « le Bosquet » à qui marchait dans la Grotte VI.
- **Le feu de vestibule vu du palier** (G-A13) : `EtageLayer.feuxSousRoche` (posé par `WorldScene` à chaque image, dehors comme dedans) ; la gueule reçoit une image de braise (`dessinDeLaBraiseDeGueule`, même palette que la braise du voile, par bandes de 4 lignes, ADD) dont l'alpha est le plus fort des feux DE CET ÉTAGE pondéré par la distance à la paire sur `FEU_CAVE_TUILES`. Un feu au fond ne se voit pas de dehors, un feu au vestibule oui — et par le trou seulement (la paroi et le sol du palier ne bougent pas : mesuré au smoke `grotte` ⑥).

## 4ter. La roche se borne à la masse (2026-09-06)

*« La roche doit se borner à la masse réellement au-dessus, pas au cadre »* (Alexis, sur la
couture du dedans et du dehors).

La roche couvrait LE CADRE — un `TileSprite` à la taille de `camera.worldView`. MESURÉ au seuil
de la Grotte XXVI, sur les 814 tuiles d'un écran de 37×22 : 95 de salle (12 %), 499 de vraie
masse au-dessus (61 %) — et **220 de ciel nu peintes en noir (27 %)** ; encore 12 % à six tuiles
de profondeur. C'est cette part-là qui faisait la couture : on entrait dans une grotte et le monde
s'éteignait jusqu'aux bords de l'écran, alors qu'à quatre tuiles de là il n'y avait rien du tout
au-dessus de soi.

`EtageLayer.ouvrirLeMasque` tient désormais, par image, une cellule par tuile de l'écran : la
MASSE (une colonne de hauteur `h ≥ p + 1` couvre les rangées dessinées `tyw − h × LIFT` à
`tyw − p × LIFT` — un semis, pas un test) OU la SALLE (son sol, sa paroi au nord, le seuil de la
gueule au sud). Hors carte, on couvre. Le masque se taille en bandes horizontales et sert DEUX
fois : la roche s'y pose (une bande tuilée par run, toutes à `ROCHE_DEPTH`, chevauchées d'un
pixel), et le **voile de cave s'ouvre sur son complément** — là où rien ne surplombe, il n'y a
pas de cave à assombrir. Le voile seul aurait rendu noir ce que la roche venait de découvrir.
Conséquence : **la passe de surface tourne aussi sous la roche** (sans découvert : le regard y est
plus bas que tout, le disque fondrait la terrasse qu'on habite), sans quoi un plateau découvert
laisserait son mobilier flotter — `clutter` et les structures de surface, eux, n'ont jamais cessé
de se rendre sous la roche.

**MESURÉ après** (sonde de couverture sur la géométrie rendue, Grotte XXVI) : ciel nu peint en
roche **27 % → 1 %** au seuil, 12 % → 1 % au fond ; **fuite 0** — aucune des 95 à 158 tuiles de
salle à l'écran n'est laissée sans roche. Et A/B **dans la même image** (bascule du masque entre
deux rendus, même monde, même position) : au fond, luminance moyenne 22 contre 22 ; au vestibule,
50 contre 52. Le voile ne fuit pas.

**À trancher (look, pas géométrie)** : la lisière est FRANCHE — la masse s'arrête sur une rangée,
et le dehors qu'on découvre est en plein jour pendant que la salle est dans le noir. Le fondu
gradué de cette lisière, calé sur `dehorsIci` (§4bis), est le pas suivant ; il n'est pas fait.

## 4quater. Le seuil ne fait pas sauter le corps (2026-09-07)

*« Mon personnage fait un saut d'un étage lorsque je rentre dans une grotte (ça dure quelques
frames) »* (Alexis).

Le client dessine à la position **prédite** et avec l'étage de l'**autorité** — `etageJoueur` n'est
posé qu'à la réconciliation. Pendant les quelques images où la prédiction a franchi le seuil et où
le snapshot dit encore « dehors », la tuile atteinte n'est marchable ni au palier `p` ni nulle part
que l'autorité connaisse : le repli de `niveauDuCorps`, né des rampes (« celui qui porte est
toujours au-dessus »), rendait `relief.hauteur` — le TOIT de la terrasse `p + 1`.

La salle porte le corps dès qu'elle est **sous lui** : `niveauDeSalle` non nul, ouverte sur le
palier de l'autorité (`−salle − 1 === etageAutorite`, G-R1) **et** surface plus haute que lui —
cette dernière clause évite que la tuile de la gueule elle-même, qui est du palier ET porte la
salle, ne fasse basculer le regard une tuile trop tôt.

**MESURÉ** (monde joué, les six grottes les plus proches du spawn — XXVI, VI, III, XXX, XXXI,
XXXVI ; paliers 0 et 1) : aux trois rangées derrière chaque seuil, le repli rendait `p + 1` là où
la salle est à `−(p + 1)` — lift 4 au lieu de 2, **32 px vers le haut, exactement un étage**.
Dehors (les rangées `dy ≥ 0`, la tuile de la gueule comprise), pas un bit ne change.

La loi vit dans `niveau-du-corps.ts`, pur : `etage-layer.ts` alloue le voile de cave dès qu'un
monde a des salles, et n'était donc plus constructible sans Phaser (le montage de
`rampe-pente.test.ts`). Gardes dans `niveau-du-corps.test.ts`, avec leurs deux témoins de
rougissement — garde retirée, garde inconditionnelle.

## 4quinquies. Le curseur vise l'arche, pas la roche derrière (2026-09-07)

*« L'entrée d'une grotte sort d'une case par rapport au sprite de l'entrée, ce qui donne des murs
invisibles quand on est dehors »* (Alexis).

**La géométrie du passage, elle, est juste** — et c'est mesuré : sur les graines 2026, 99 et 4242,
**359 paires de gueule, 0 mal appariée, 0 collée à une paire voisine, 0 tuile de passage murée**
(terrain, nœud bloquant ou structure) ; l'image `GUEULE_KEY` se pose exactement sur les deux
colonnes des connecteurs. Ce qui sortait d'une case, c'est **la VISÉE**.

`poserLaGueule` pose l'image de 32×48 à `ty − palier × LIFT_TUILES − LIFT_TUILES`, et `PROFIL`
(`cave-art.ts`) n'ouvre rien sur sa troisième rangée : **tout le noir de l'arche vit sur les
`LIFT_TUILES` rangées d'écran AU-DESSUS du seuil**, sur la paroi — le seuil, lui, n'est qu'une
tache. Or `deplierLeLift` (`render/deplier-etage.ts`) ne connaissait que les chapeaux et les
rampes : viser le trou noir retombait sur le monde plat, dans la masse.

**MESURÉ** (monde joué, les six grottes les plus proches du spawn) : les deux rangées de l'arche
rendaient la tuile de leur propre rangée d'écran — **une à deux tuiles au nord du seuil au palier
0, trois à quatre au palier 1**, de la roche pleine à chaque fois. On visait l'entrée, le jeu
lisait le mur : c'est le « mur invisible ». Après correctif, **36/36** visées (arche haute, arche
basse et seuil × les deux colonnes × six grottes) tombent sur la tuile du seuil, et les colonnes
voisines (le flanc `cv-flanc`, qui n'est qu'un encadrement) gardent leur ancien sens.

La règle s'écrit comme celle de la rampe, à un champ près : une rampe monte **vers** `h` (son bas
est `min(de, vers)`), une gueule s'ouvre **sur** son palier et descend (`vers` est le niveau
négatif de la salle) — donc `de === bas`. Gardes dans `deplier-etage.test.ts`, avec leurs deux
témoins de rougissement : branche retirée, et branche écrite avec le `min` de la rampe.

## 5. Critères d'acceptation

- **G-A1 — Déterminisme** : deux générations directes (`generateZonedTerrain`, jamais le cache) rendent les mêmes grilles creuses, connecteurs, zones et traces, au bit près ; le chemin `'vallee'` (sans `palier`) ne porte aucun karst.
- **G-A2 — Le flux du PRNG ne bouge pas** : compte et positions des nœuds, des bêtes ambiantes et des lieux tirés identiques avant/après, sur 3 graines — à la stérilité près des tuiles de trace et de gueule (mesurer l'écart et le nommer, comme les « ≤ 10 sur 60 000 » de la cave).
- **G-A3 — `−H` ferme la roche** : sur 4 graines, aucune tuile de karst n'est atteignable (E-R5) depuis une tuile de surface sans passer par une gueule ; la garde s'écrit sur les caves de mesa aussi — elle DOIT rougir sur le code d'aujourd'hui (une garde prouve sa prémisse).
- **G-A4 — L'arbre** : toute salle joignable depuis toute gueule par des tuiles creusées ; chaque boyau ≥ `BOYAU_LARGEUR` en tout point (aucune tuile creusée dont les deux voisines transverses sont de la roche) ; le fond à ≥ `FOND_DISTANCE` de toute gueule ; ≤ 1 cycle dans le graphe des salles ; tuiles ≤ `TUILES` ; aucune tuile sous une colonne de rampe ni dans une cave de mesa ; chaque gueule marchable des deux côtés (T-A2bis étendu).
- **G-A5 — Un lieu** : chaque karst est une zone `kind: 'grotte'` dont `x, y` est une tuile de gueule ; `isSheltered` vrai sur toute tuile creusée, faux une tuile dehors ; **13 °C au fond de chaque karst à midi comme au cœur de la nuit des jours 1, 20, 40 et 59** (le dessus de la terrasse, témoin, bouge), avec un feu adjacent le même 13, et l'éveil des Cendreux nul sous la roche la nuit du Grand Froid (> 0 dehors) ; `populateDen` pose une bête au fond (≥ `FOND_DISTANCE` de toute gueule) sur 100 % des karsts ; aucune Louvière dans une Grotte du plancher ; le compte de Grottes par carte est RAPPORTÉ (pas de plafond, un plancher : ≥ 1 par naissance et site, G-A7).
- **G-A6 — La nappe** : tout karst dont la gueule est en calcaire a ≥ 1 tuile profonde et une couronne peu profonde ; aucun karst granite/argile n'a de profonde ; les bassins d'un karst calcaire sont reliés par du peu profond ; **le gel d'hiver** (`gel.ts` au jour le plus froid) ne touche aucune tuile d'eau d'une grille creuse et touche la trace de G-R9.
- **G-A7 — Le plancher** : sur 5 graines, chaque point de naissance et chaque site de village a une Grotte (gueule) à ≤ `PLANCHER_RAYON` ; la Grotte la plus proche du spawn est rapportée avec sa roche.
- **G-A8 — Les vignettes** : toute vignette posée tient à 100 % sur du creusé ; ≥ 1 tuile de circulation entre vignettes et vers chaque porte ; une salle sans eau ne porte aucune `ancre: eau` ; le compte de vignettes non posées est rapporté (pas caché).
- **G-A9 — Le bivouac** : `place_component` d'un `fire` sur une tuile creusée est accepté et la structure porte `etage = −H` ; celui d'un `wall`, `door`, `roof`, `house` est refusé ; la structure n'apparaît ni dans la collision ni dans `roofAt` de la surface ; la garde est **exhaustive sur `PIECES`** (chaque entrée a un `sousRoche`, `tsc` le prouve).
- **G-A10 — La trace** : chaque karst calcaire a ≥ 3 tuiles de `TERRAIN_SHALLOW_WATER` au pied de sa gueule principale sur `map.terrain` ; chaque karst sec a une coulée qui touche sa gueule ; T-A11 (aucune eau ne domine une terre qu'elle touche) tient AVEC la trace.
- **G-A11 — La Grotte de surface** : `placePois` ne tire plus `grotte` ; `grotte.plan` n'est plus un lieu bâti ; C4 de `lieux-batis.md` se réécrit ici.
- **G-A12 — Le tick** : `profil-tick` avant/après sur le même monde, par corps — `isSheltered`, `populateDen`/`advanceDens` et le pas ne coûtent pas plus qu'avec les caves de mesa.
- **G-A13 — Le rendu** : `smoke --scenario grotte` — quatre cadrages : le palier devant la gueule (la fente ET la trace), le vestibule de jour, le fond (noir, la forme seule), la torche sur l'eau ; un feu posé au vestibule se voit par la gueule depuis le palier et pas ailleurs. Captures à l'appui, mesurées (contraste de la fente contre la paroi ; la trace lisible à 30 tuiles).

## 6. Ouvert, nommé

- Le **gouffre** comme germe (G-R4) : fréquence à mesurer avant d'en faire une règle.
- La **saison** de la nappe (niveau qui monte au printemps, fond coupé) : hors chantier.
- Le **puits** (`'escalier'` vers `−H−1`) : hors chantier, la verticalité d'un autre jour.
- La **pêche** sous la roche : `eau.ts` ne lit pas un étage ; question de design séparée.
- La Vallée complète : elle perd la Grotte de surface et n'a pas de `palier` — elle n'a donc **aucune grotte** tant que les terrasses ne tournent pas sur le monde complet. À dire au jour de la Vallée.
- L'anomalie SUSPECTÉE de la graine 99 (rampe 1→2 de mesa sur des tuiles de jupe au palier 0, `tools/__rampe-anomalie.mts`) : sans rapport avec ce chantier, à vérifier contre le travail terrasses en cours.

## 7. Livré le 2026-09-06 — et les écarts, nommés

**Livré** (tests `grottes.test.ts`, 71 verts ; smoke `grotte`, 8 verdicts) : G-R1 (`−(p+1)`, la cave de mesa migrée, G-A3 rouge d'abord puis verte), G-R2/G-R3/G-R4/G-R5 (`zonegen-karst.ts`, `KARST` en tête), G-R7 (`PIECES[x].sousRoche`, `Structure.etage`, `solDeLaPose`, `place_campfire` sous la roche), G-R8a/b (`grottes-plancher.ts`, passe tardive hôte : `veillee.ts`, `scenario.ts`, serveur), G-R9 (la trace), G-R10 (`placePois` ne tire plus `grotte` ; `grotte.plan` en `plans/brouillons/`), le rendu §4 (strate souterraine unique, eau statique, structures à deux mondes, bivouac). `debug_teleport` accepte un `etage` (G-A13 se photographie).

**Chiffres** : 43-55 Grottes par carte APRÈS le plancher, contre 25-32 par la roche seule — le plancher creuse près de chaque naissance et de chaque site, et il **ignore `ESPACEMENT`** (une Grotte de plancher peut voisiner une Grotte de roche à moins de 120 tuiles). La Grotte VI de la graine du smoke : gueule (411,240), palier 1 → étage −2, 202 tuiles, fond à 33, trace 5 ; fente 12 vs paroi 97 ; fond 15 vs vestibule 42 ; torche sur l'eau 8 → 55 ; bivouac 19 → 105 dedans, sol de l'aplomb inchangé dehors.

**Écarts et conséquences à trancher** (aucune décision prise seul) :
- Les points `horsRayon` du plancher sont rapportés, pas couverts : là où aucune paroi éligible n'est à portée, la naissance reste sans Grotte.
- `nidsAMonstre` et `emplacementsDeVillage` se calculent AVANT le plancher : un site de village peut se retrouver à quelques tuiles d'une gueule de plancher.
- La borne du test cendre A3 (pression en sites) est descendue à 0,40 : le plancher déplace des sites.
- La Louvière dans un karst (G-R5) n'est pas faite ; `isSheltered` est généralisé à l'étage (une bête sous la roche est abritée, le loup de surface non).
- Un bug de doublon d'identifiant de structure (deux `addStructure` dans le même tick) a été corrigé au passage.
- `place_campfire` lit `zoneAt` de la SURFACE pour une tuile creusée (un bivouac sous un lieu de surface est refusé « à cause » du lieu du dessus).
- Sous la roche, `light_fire` et `found_village` sont refusés ; la garde de navigabilité du bâti est sautée (rien ne clôt, rien à vérifier).
- Pièces non listées par G-R7 : `workshop`, `enclume`, `atre`, `autel`, `charrette`, `terre` et les vestiges du monde → `sousRoche: true` ; `silo`, `cave`, `reserve`, l'agriculture → `false`.
- Le rendu : `derivesDe`/`calculerNappe`/`pansTombes`/`dedansAvec` ignorent l'étage (une palissade de salle s'autotuilerait avec un mur de terrasse sur la même tuile — sans objet tant que rien ne clôt sous la roche) ; le point de lumière dynamique d'un feu de surface à l'aplomb d'une salle peut éclairer son sol.
- Le feu de vestibule vu par la gueule depuis le palier : **fait le 2026-09-06** (§4bis) — avec la barre qui nomme la Grotte et le dehors qui s'efface à l'oreille. MESURÉ au smoke `grotte` ⑥ (la Grotte XXVI, gueule (287,184), feu à (288,183), 23 h) : fente 4 → 66 de luminance, chaleur (r − b) −7 → 58 ; paroi 17 → 17, sol sec du palier 52 → 52 ; la seconde gueule de la même salle, à dix tuiles du feu, reste noire. Onze verdicts sur douze.
- **Le ✗ restant, à lire avant d'y croire** : « le fond n'est pas noir (45, vestibule 72) » sur la Grotte XXVI — le point de mesure est SOUS le corps du joueur, dans le trou du voile qui l'entoure, sur un sol de salle plus clair que celui de la Grotte VI (15) ; `partDuCiel` y vaut 0 (sondé). Le seuil de 24 a été calibré sur une seule grotte ; ce qu'il faut trancher, c'est la clarté du halo du corps dans le noir, pas la nappe.
- La terrasse devant la gueule de la Grotte VI n'a que ~2 rangées de palier : l'approche est courte.
- **G-A6 / G-R11, éprouvés** : le pas de `moveAvatar` lit le terrain de l'ÉTAGE (`terrainAEtage`) et n'interroge glace, neige, cendre et assèchement QUE sur la surface — au cœur du Grand Froid, la trace du karst garde son 0,5 quand son témoin de surface (même terrain, même seed) passe à `GEL.VITESSE_GLACE`. Le témoin se prend au cœur des Pluies, pas d'Ardeur (assèchement → pas 1) ni d'Éclosion (crue sur le gué → pas 0).
- **G-A12, MESURÉ puis corrigé** (`profil-tick 8 2000`, graine 2026, A/B alterné ×3 contre d33ee86) : +60 % par tick (2,2 → 3,5 ms), +42 % par corps — deux sangliers de karst sur cinq en `homing` 300 ticks sur 300, `goHome` balayant `FAUNA.HOMING_SEEK` tuiles de SURFACE à chaque tick sans jamais trouver d'habitat. Corrigé : sous la roche, `goHome` rend faux d'entrée (la bête est chez elle, G-R5) — après : 2,22 ms/tick à 45 corps contre 2,11-2,27 à 40 (dans le bruit). Garde : 300 ticks, aucun sanglier de karst en `homing`. SUSPECTÉ, non touché : deux sangliers de SURFACE en `homing` 300/300 (coût de `goHome` antérieur aux grottes).
- **G-R6, livré** (2026-09-06, `meublerLesGrottes` dans `poi-batis.ts`, appelé au bout de `buildPoiStructures` ; C4 de `lieux-batis.md` les décrit) : cinq vignettes dans `plans/vignettes/` — `chaos` et `halte` (`ancre: paroi`), `rive` (`eau`), `foyer` (`centre`), `seuil` (`porte`) — compilées dans `VIGNETTES` par le même compilateur que les plans, disjointes de `PLANS`, et éprouvées par `verifierVignette` (3 à 5 de côté, hors région, une ancre). **Ce qui est décidé par le code, à confirmer** : (i) l'empreinte d'une vignette est ses cases PLEINES — une case vide est de la composition, pas une réserve ; (ii) « tient à 100 % sur du creusé » se lit *creusé SEC* (jamais sur la nappe) ; (iii) la circulation gardée est le compte des PAIRES de portes reliées par le libre — une pose qui en perd une est défaite ; (iv) la pose est **positionnelle et ne lit jamais un corps** (`hash2(gx, gy, seed)` sur le germe de la salle ; le sanglier de tanière n'est pas un mur — mais SA tuile, `fondDuLieu`, reste libre) : deux amorces solo/LAN posent les mêmes pièces aux mêmes tuiles (G-A8). **MESURÉ** sur le monde des hôtes (plancher compris, 5 graines) : 228 Grottes, 792 salles, 955 posées — **1,21 vignette par salle** — et 1 421 élues sans place (60 %) ; la cause est l'eau (les salles noyées) et les petites salles où 3×3 ne tient pas entre les portes ; les leviers seraient `KARST.RAYON`, moins de noyées, des vignettes plus petites. Le vocabulaire minier de la légende (`D`, `n`, `I`, `w`) n'est pris par aucune vignette. **Corrigé au passage** : `poserLeKarst` ajoutait à l'étage avant d'écrire le terrain ; à la génération le terrain se relisait plus tard, mais le plancher construit l'étage sur-le-champ — 3 937 tuiles d'étage sans terrain sur 15 621 (graine 2026), toute Grotte du plancher immarchable et meublée sur du vide (garde G-A7).
- Le harnais : `debug_god` exige `on: true` — neuf scénarios de `smoke.mjs` l'appellent sans (latent, non touché).
