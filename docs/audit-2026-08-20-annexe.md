# Annexe — index complet des 235 constats

> Un constat par ligne, tel que rendu par l'auditeur puis recadré par son réfuteur.
> Le détail complet (preuve, impact, correctif, contre-vérification) des critiques et des majeurs
> est dans `audit-complet-2026-08-20.md` ; les mineurs ne vivent que dans cette annexe.
> `verdict` : `confirme` = le réfuteur a vu le défaut de ses yeux · `ajuste` = réel mais portée,
> sévérité ou correctif corrigés — lire la colonne.


## /sim

### noyau

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `base-noeuds-hors-fenetre-gardee` | Une sauvegarde ratée puis réussie écrit au disque une carte et un diff irrecollables — la Veillée est perdue en silence | `packages/client/src/worker/sim-worker.ts:271` | S | confirme |
| majeur | `lifecycle-ordre-fige-et-test-circulaire` | Le replay serveur réordonne les arrivées avant les départs, et son test ne peut pas le voir : il appelle des deux côtés la fonction qu'il éprouve | `packages/server/src/replay-log.ts:89` | M | ajuste |
| mineur | `replay-jamais-prouve-sur-le-monde-joue` | Aucun test de replay ne joue le monde de production : ni faune ambiante, ni coins de chasse, ni foyer, ni Cendre, ni météo, ni arc | `packages/sim/src/replay.test.ts:15` | M | ajuste |
| mineur | `decision-d-hote-figee-au-disque` | Une décision d'HÔTE traverse la reprise au hasard : la météo se perd pour toujours, le mode debug survit pour toujours | `packages/sim/src/persistence.ts:85` | S | ajuste |
| mineur | `tick-change-de-valeur-au-milieu-du-step` | `state.tick` change de valeur au milieu de `step()` : la moitié des phases voit N, l'autre N+1, et rien ne marque la frontière | `packages/sim/src/sim.ts:820` | M | ajuste |
| mineur | `protocolversion-que-personne-ne-lit` | Aucun hôte ne lit le `protocolVersion` du client : la garde de version vit chez la partie non fiable | `packages/sim/src/protocol.ts:25` | S | ajuste |
| mineur | `interet-garde-qui-ne-prouve-pas-sa-premisse` | Le raccourci de la zone d'intérêt ne prouve sa prémisse que pour `entities` — et saute le filtrage de cinq autres collections | `packages/sim/src/interest.ts:78` | S | confirme |
| mineur | `facade-expose-les-phases-du-tick` | La façade interdit `emitEvent` au nom du replay mais exporte chaque phase du tick — un danger strictement plus grand, par le même raisonnement | `packages/sim/src/index.ts:182` | S | confirme |

### worldgen

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `gardes-sur-le-plan-endormi` | Toutes les gardes de terrain et de contenu tournent sur le plan `'vallee'`, que personne ne joue ; et aucun balayage de graines n'appelle jamais `generateZonedTerrain` | `packages/sim/src/zonegen.test.ts:14` | M | ajuste |
| mineur | `mr2-t0-different` | R-MR2 promet un T0 identique « tuile pour tuile » entre les deux plans ; 69 à 76 % des tuiles diffèrent, et sa garde A-MR2 ne teste que les dimensions du rectangle | `packages/sim/src/zonegraph.ts:916` | M | ajuste |
| mineur | `calibre-front-forof` | `calibreLeFront` coûte 447 ms — 5,4 % de la génération jouée — pour une dichotomie que sa boucle `for..of` rend 2,7 fois plus lente que nécessaire | `packages/sim/src/cendre.ts:158` | S | ajuste |
| mineur | `monde-calibrage-mort` | Dix constantes de `MONDE`, le champ `Zone.poids`, le repli `rect?` et `estBiconnexeSur` sont les fossiles du diagramme de puissance supprimé — dont un plafond documenté comme mesuré qui ne commande plus rien | `packages/sim/src/zonegraph.ts:123` | S | ajuste |
| mineur | `rus-ne-commande-rien` | `EAUX_ZONES.PAR_ZONE.rus` est un plancher que rien n'atteint : la Tourbière ouvre 49 sources au lieu des 3 déclarées, la Sylve 164 au lieu de 2 | `packages/sim/src/zonegen-eaux-zones.ts:285` | S | ajuste |
| mineur | `assainir-profond-duplique` | Le point fixe R45 existe en deux copies dans deux fichiers, appelées quatre fois, chacune balayant la carte entière au moins deux fois | `packages/sim/src/zonegen.ts:783` | M | ajuste |
| mineur | `marge-seuil-dupliquee` | L'emprise A16 d'un seuil vaut 84 tuiles dans deux constantes distinctes, et ce 84 est une valeur DÉRIVÉE de deux autres constantes, écrite en dur des deux côtés | `packages/sim/src/zonegen-water.ts:118` | S | ajuste |
| mineur | `vignette-et-tiled-morts` | `vignette.ts` et `tiled.ts` sont deux modules morts de `/sim` — et la palette morte de `vignette.ts` a raté les trois terrains les plus récents du T0 | `packages/sim/src/vignette.ts:46` | S | ajuste |
| mineur | `outillage-masque-pleine-carte` | La boîte à outils de masque (érosion, composantes) tourne sur la carte ENTIÈRE une fois par consommateur, avec un tableau de la taille de la carte alloué puis jeté à chaque appel | `packages/sim/src/profondeur.ts:57` | M | ajuste |
| mineur | `tuiles-par-joueur-doc-perimee` | Le seul bouton de dimensionnement du monde documente un résultat de 2,5 M de tuiles ; il en produit 3,75 M, et la spec §4 R16 répète le chiffre périmé | `packages/sim/src/zonegraph.ts:57` | S | confirme |
| mineur | `departage-inatteignable` | Deux départages d'ex æquo écrits pour garantir un ordre total sont inatteignables : la branche `k < sommet` ne peut jamais être vraie | `packages/sim/src/zonegen.ts:1094` | S | confirme |

### vivant

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `cerf-carcasse-non-mangeable` | Le loup ne peut ni manger ni sentir le cerf qu'il vient de tuer : la boucle du prédateur (R15) et l'appel du sang (C12) sont muets sur la proie phare | `packages/sim/src/faune.ts:2811` | S | confirme |
| majeur | `alpha-dissipe-deroute-la-meute` | La DISSIPATION de l'alpha (et non sa mort) met sa meute en déroute définitive : R12 se déclenche sans que personne n'ait tué quoi que ce soit | `packages/sim/src/faune.ts:1059` | M | confirme |
| mineur | `index-du-tick-non-transmis` | L'index d'entités du tick est bâti puis non transmis : la faune refait un balayage linéaire par bête, à chaque tick — 8 % du tick MESURÉ | `packages/sim/src/faune.ts:700` | S | ajuste |
| mineur | `decoupe-faune-ts` | faune.ts (3 375 l., 24 exports, 18 modules importés) porte QUATRE specs : la découpe vaut son prix sur deux coutures précises — et sur aucune autre | `packages/sim/src/faune.ts:1` | L | ajuste |
| mineur | `predicat-gibier-recopie` | Le prédicat « c'est du gibier » est recopié six fois dans combat.ts parce que le cycle d'import interdit d'importer celui de faune.ts | `packages/sim/src/combat.ts:687` | S | confirme |
| mineur | `scent-range-factor-inerte` | `HUNT.SCENT_RANGE_FACTOR` ne règle rien : le nez ne porte PAS plus loin que l'œil, contrairement à ce que la spec, le commentaire et la constante affirment | `packages/sim/src/faune.ts:2016` | S | confirme |
| mineur | `dissipation-rodeurs-gardee-par-faunacap` | La dissipation des rôdeurs de nuit est gardée par l'interrupteur de la faune ambiante — deux interrupteurs indépendants, une garantie écrite qui saute | `packages/sim/src/faune.ts:1299` | S | confirme |
| mineur | `prowler-near-mort` | `prowlerNear` est du code mort — écrit « pour l'UI », jamais appelé, et il porte un balayage O(bêtes × entités) | `packages/sim/src/nighthunt.ts:158` | S | confirme |

### combat

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `bloquant-premier-masque-le-solide` | La collision sous-tuile ne consulte QUE la première structure bloquante : un four ou un coffre adossé à un mur d'arête cesse totalement de bloquer | `packages/sim/src/collision.ts:187` | M | confirme |
| majeur | `deux-autorites-tuile-divergent` | `makeIndexedIsBlockedAt` et `isBlockedAt` répondent le contraire sur un mur d'arête : le pathfinding refuse toute tuile portant un mur mince | `packages/sim/src/collision.ts:278` | S | ajuste |
| majeur | `cache-occupation-perime-sur-derive-de-noeud` | Le cache d'occupation ne voit pas la DÉRIVE d'un nœud : après une récolte en forêt, l'A* croit l'arbre encore sur son ancienne tuile | `packages/sim/src/collision.ts:253` | M | confirme |
| majeur | `fraicheur-blanchie-par-jeter-ramasser` | Jeter puis ramasser RAJEUNIT la nourriture : les piles au sol ne portent pas de fraîcheur, `addItems` la remet à 1 | `packages/sim/src/inventory-actions.ts:333` | S | confirme |
| mineur | `collision-sous-tuile-o-structures` | Le pas de chaque entité rescanne TOUT `state.structures`, plusieurs fois par sous-tuile — mesuré 0,12 µs par structure et par `resolveMove` | `packages/sim/src/collision.ts:339` | L | ajuste |
| mineur | `transfer-kind-non-borne-crash` | Un `transfer` dont le `kind` ment fait PLANTER le tick : le champ n'est pas borné, contrairement à `side` et `zone` | `packages/sim/src/inventory-actions.ts:230` | S | ajuste |
| mineur | `parade-ecrase-les-modulateurs` | La parade ÉCRASE les dégâts au lieu de les réduire : le modulateur d'alignement et le coup propre disparaissent contre un bloqueur | `packages/sim/src/combat.ts:702` | S | confirme |
| mineur | `estgele-o-structures-sur-le-chemin-chaud` | CHANTIER EN COURS (gel) — `estGele` coûte un balayage complet de `state.structures` par tuile d'eau, sur le chemin de collision et sur le BFS pleine carte | `packages/sim/src/gel.ts:190` | M | confirme |
| mineur | `attribution-perdue-sur-mort-par-saignement` | Mourir de saignement n'a pas d'auteur : `die(state, entity, 0)` — le coût d'alignement du meurtre s'évapore | `packages/sim/src/combat.ts:1037` | M | confirme |
| mineur | `interet-fuite-sur-retour-anticipe` | La zone d'intérêt laisse fuir sang, piles au sol et réfugiés lointains dès qu'aucune entité n'est filtrée — et le test le grave dans le marbre | `packages/sim/src/interest.ts:76` | S | confirme |
| mineur | `trou-de-garde-sur-l-accord-des-deux-collisions` | Aucun test ne fige l'accord entre les deux autorités de collision — c'est le trou par lequel les trois défauts de collision sont passés | `packages/sim/src/structure-blocking.test.ts:73` | S | confirme |

### societe

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `grenier-irremplacable` | Un village PNJ dont le coffre est détruit — la cible exacte du raid de Meute — meurt sans recours : le tableau gèle et le plan directeur ne rebâtit jamais de grenier | `packages/sim/src/village-board.ts:51` | M | confirme |
| majeur | `cycle-sans-offset` | Les événements nocturnes du monde ignorent `cycleOffset` : dans la configuration livrée, la horde naît trois heures de jeu APRÈS la tombée de la nuit et rôde trois heures APRÈS l'aube | `packages/sim/src/worldevents.ts:145` | S | ajuste |
| majeur | `abri-inexistant` | L'ABRI n'existe plus : `isSheltered` ne reconnaît qu'un type de pièce que plus personne ne peut poser — le logis 4×4 du village n'achète ni chaleur, ni parade à la foudre, ni refuge d'orage | `packages/sim/src/temperature.ts:32` | M | confirme |
| mineur | `a7-en-pause` | A7 — LE critère de roadmap de `pnj.md` (« un village 100 % PNJ tient 10 jours ») est `describe.skip`, alors que l'en-tête de la spec le déclare vert | `packages/sim/src/npc.test.ts:302` | L | ajuste |
| mineur | `refugies-verbes-non-mesures` | Les verbes réfugiés du JOUEUR échappent à la doctrine du transfert mesuré : recruter peut faire disparaître un groupe sans peupler personne, dépouiller détruit le butin qui ne rentre pas | `packages/sim/src/refugees.ts:140` | S | ajuste |
| mineur | `cout-hostilite-jete` | Le coût moral gradué de `recordHostility` est calculé puis jeté au sabotage : détruire la structure d'un agresseur coûte le plein tarif, la riposte n'existe pas côté bâti | `packages/sim/src/village.ts:709` | S | ajuste |
| mineur | `circlefactor-fantome` | `circleFactor` et les trois cercles survivent dans `generateNodes` alors que la spec et `zone-content.ts` les déclarent SUPPRIMÉS — et un test épingle encore la règle supprimée | `packages/sim/src/economy.ts:1090` | S | confirme |
| mineur | `chronicle-liste-jumelle-sans-garde` | `CHRONICLE_EVENT_TYPES` et le `switch` de la chronique doivent rester identiques, et rien ne l'affirme — la dérive qu'ils sont censés empêcher s'est déjà produite une fois | `packages/sim/src/chronicle.ts:46` | S | confirme |
| mineur | `crop-frozen-hors-chronique` | CHANTIER EN COURS — `crop_frozen` promet la chronique dans son propre commentaire et n'y entre pas | `packages/sim/src/events.ts:165` | S | confirme |

### environnement

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `acte-iii-ferme-la-seule-source-de-nourriture-des-villages-pnj` | À partir du jour 43, aucun nœud `gelif` n'est récoltable nulle part — et c'est la seule nourriture qu'un village PNJ sache produire | `packages/sim/src/balance.ts:3489` | M | confirme |
| majeur | `borne-climatmaximal-tendue-a-zero-et-sans-garde` | La borne O(1) du gel de la flore est tendue à zéro et n'est protégée par aucun test — contrairement à sa jumelle `gelPossible` | `packages/sim/src/temperature.ts:166` | S | confirme |
| mineur | `pnj-lache-la-cueillette-des-que-le-buisson-le-plus-proche-gele` | Un seul buisson gelé au premier rang suffit à couper toute la cueillette du village, même quand le buisson d'à côté est tiède | `packages/sim/src/npc.ts:494` | S | ajuste |
| mineur | `test-a1-ne-peut-pas-echouer-sur-la-seule-chose-qu-il-garde` | Le test A1 ne peut pas échouer sur l'abri — c'est-à-dire sur la seule dimension qui distingue `climatFlore` de `baselineTemperatureAt` | `packages/sim/src/flore-froid.test.ts:45` | S | ajuste |
| mineur | `hud-propose-semer-sur-une-terre-que-la-sim-refuse` | Le HUD propose « Semer » sur une parcelle gelée — le refus tombe du ciel, à l'inverse du contrat que F8 vient d'écrire pour les plantes | `packages/client/src/scenes/world/aim.ts:263` | S | ajuste |
| mineur | `strikerejection-la-porte-du-gel-n-est-pas-la-ou-son-commentaire-la-dit` | Le gate du gel prétend être testé en dernier dans `strikeRejection` ; il est en réalité testé avant l'outil et avant le savoir | `packages/sim/src/economy.ts:517` | S | ajuste |
| mineur | `le-gel-suspend-aussi-la-passe-d-oubli-du-monde` | Le `continue` du gel saute aussi la passe « le monde OUBLIE » : les épuisements d'un nœud gelé ne se décomptent plus | `packages/sim/src/economy.ts:1001` | S | confirme |
| mineur | `crop-frozen-emis-sans-consommateur-de-chronique` | `crop_frozen` est justifié par « la chronique de saison a là son fait de Grand Froid » — la chronique ne le connaît pas | `packages/sim/src/events.ts:163` | S | confirme |

### bati

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `clic-ne-batit-ni-cloture-ni-encadrement` | Clôture et Encadrement sont armables au menu du marteau mais le clic ne les pose JAMAIS — il frappe | `packages/client/src/scenes/world/aim.ts:428` | S | confirme |
| majeur | `feu-de-camp-esquive-r7` | `place_campfire` est le seul geste de pose bloquant qui n'appelle pas R7 — un feu de camp mure le Feu du village | `packages/sim/src/village.ts:955` | M | confirme |
| majeur | `batir-lieu-perd-une-arete-en-silence` | Le poseur de plans PERD une arête de contour quand deux barrières de types différents visent la même tuile extérieure | `packages/sim/src/poi-batis.ts:470` | M | confirme |
| majeur | `arete-ecrite-hors-registre` | `cloture` et `encadrement` déclarent `arete: 'interdite'` mais le worldgen les pose sur des arêtes — le registre ment sur leur géométrie | `packages/sim/src/poi-batis.ts:480` | M | confirme |
| majeur | `fantome-recalcule-les-fonctions-a-chaque-frame` | Le fantôme de composant rejoue DEUX fois `recognizeFunctions` par frame, sur le tableau de structures non filtré par intérêt | `packages/client/src/scenes/world/build-ghost.ts:179` | M | ajuste |
| majeur | `enceinte-en-litteraux-de-types` | `isEnclosed` écrit « ce qui clôture » en trois littéraux de types au lieu de lire `bloque`/`occupe` du registre | `packages/sim/src/construction.ts:567` | M | non-verifie |
| mineur | `septieme-liste-ecrite-a-la-main` | Le fantôme et le contexte de pose gardent la liste `wall\|\|door\|\|palissade` que le reste du client a justement remplacée par `piece().arete` | `packages/client/src/scenes/world/build-ghost.ts:103` | S | ajuste |
| mineur | `plafond-enceinte-en-dur` | Le plafond de l'enceinte est un nombre en dur dans le corps de la fonction, et son commentaire nomme une constante qui n'existe pas | `packages/sim/src/construction.ts:559` | S | confirme |
| mineur | `triplet-en-double-avale-en-silence` | Une arête déclarée à la fois en `breches` et en `seuils` : le seuil est avalé sans un mot | `packages/sim/src/poi-batis.ts:461` | S | confirme |
| mineur | `upkeep-liste-parallele-des-barrieres` | L'upkeep n'use que mur/porte/palissade — la clôture, barrière du marteau et `usurable`, échappe à R16 | `packages/sim/src/village.ts:783` | S | confirme |


## client · serveur · outillage

### client-boucle

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `CB-01` | Balayage linéaire des 61 673 nœuds à chaque frame, alors que /sim expose déjà l'index O(1) | `packages/client/src/scenes/world/aim.ts:242` | S | confirme |
| majeur | `CB-02` | La mort gèle le clavier sans vider les touches : on ressuscite en marche | `packages/client/src/scenes/WorldScene.ts:2453` | S | confirme |
| majeur | `CB-04` | Le chat multi diffuse la position de chaque locuteur à TOUS les clients — le filtrage de portée est côté client | `packages/client/src/scenes/WorldScene.ts:1897` | S | confirme |
| majeur | `CB-05` | Le menu pause ne met pas le joueur en pause : déplacement, ceinture et « jeter » restent actifs | `packages/client/src/scenes/WorldScene.ts:1643` | S | confirme |
| majeur | `CB-07` | La visée est résolue deux fois par frame, avec deux allocations d'entités et deux balayages de nœuds | `packages/client/src/scenes/world/input-bindings.ts:502` | M | confirme |
| majeur | `CB-08` | Trois miroirs client de la règle de pose, dont deux calculent la même occupation dans la même frame | `packages/client/src/scenes/WorldScene.ts:463` | M | confirme |
| mineur | `CB-03` | Le shutdown de scène ne rend ni l'atlas du sol ni l'AudioContext, alors que la scène est JETÉE à chaque retour au menu | `packages/client/src/scenes/WorldScene.ts:834` | S | ajuste |
| mineur | `CB-06` | WorldScene.update() : 782 lignes pour treize responsabilités, et une seconde copie du snapshot à côté de SnapshotView | `packages/client/src/scenes/WorldScene.ts:1046` | L | ajuste |
| mineur | `CB-09` | Les échantillons d'interpolation sont datés à l'horloge de FRAME : deux snapshots reçus dans la même frame s'écrasent | `packages/client/src/scenes/world/snapshot-view.ts:1037` | S | confirme |
| mineur | `CB-10` | Le fantôme de construction recopie tout le tableau des structures et relance deux reconnaissances d'amas par frame | `packages/client/src/scenes/world/build-ghost.ts:144` | S | ajuste |
| mineur | `CB-11` | Deux publications HUD mortes, et les clés de registry qu'elles alimentent ne sont lues par personne | `packages/client/src/scenes/world/hud-bridge.ts:123` | S | confirme |
| mineur | `CB-12` | Les deux fichiers-dieu du client n'ont aucun test, y compris leurs parties pures et déjà isolées | `packages/client/src/scenes/world/snapshot-view.ts:1` | M | ajuste |

### client-rendu

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `R1` | clutterAt — une fonction pure et mémoïsable recalculée par tuile ET par frame (1,2 à 3,3 ms/frame MESURÉES) | `packages/client/src/scenes/world/clutter-layer.ts:131` | S | ajuste |
| majeur | `R2` | Les dix lieux BÂTIS ont une table `_lit` complète que ni le jeu ni l'Atelier n'affichent — 331 lignes et 16 textures mortes, tenues en vie par la garde A1 | `packages/client/src/render/poi-lit-defs.ts:16` | S | confirme |
| majeur | `R3` | sunDirection saute d'un coup à 6h00 et 18h00 : trois tables du même fichier ne s'accordent pas sur l'heure où le jour finit | `packages/client/src/render/lighting.ts:60` | S | confirme |
| majeur | `R6` | L'art de la falaise est recopié au pixel dans le chip `massif` de bati-art — deux écritures d'une même tuile | `packages/client/src/render/bati-art.ts:508` | S | confirme |
| mineur | `R4` | La recette de normale est partagée, mais CINQ formats d'auteur coexistent — et l'ombre de contact est réécrite quatre fois avec le même alpha 0,26 | `packages/client/src/render/normal-map.ts:101` | M | ajuste |
| mineur | `R5` | La garde de couverture A1 est aveugle aux barrières d'arête, et affirme que `wall`/`door` n'ont pas de `_lit` alors qu'elles en ont 135 | `packages/client/src/render/lit-coverage.test.ts:45` | S | ajuste |
| mineur | `R7` | POI_ART et POI_LIT_DEFS tiennent les mêmes dimensions en parallèle, sans aucune garde — et elles ont déjà divergé | `packages/client/src/render/poi-lit-defs.ts:8` | S | confirme |
| mineur | `R8` | TERRAIN_COLORS est une table parallèle au registre TERRAINS sans garde d'exhaustivité — alors que sa voisine grain-sol en a une | `packages/client/src/render/terrain-colors.ts:12` | S | confirme |
| mineur | `R9` | Trois textures de contre-épreuve `-curl_lit` sont cuites dans le build de production, et partagent leur canvas d'albédo avec la vraie texture | `packages/client/src/render/poi-lit.ts:278` | S | ajuste |
| mineur | `R10` | generateFireProp réencode la normale à la main alors que normalFromCanvas accepte désormais un champ de relief | `packages/client/src/render/lit-props.ts:436` | M | ajuste |

### client-fx

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `FX-01` | La couche de taches de soleil ne se monte pas à la deuxième Veillée d'une même page | `packages/client/src/scenes/world/soleil-layer.ts:104` | S | ajuste |
| majeur | `FX-02` | La recuisson du gel coûte 10-12 ms de fil principal et part quatre fois par seconde à la marche | `packages/client/src/scenes/world/gel-layer.ts:334` | M | confirme |
| majeur | `FX-03` | L'éclairage dynamique prend les 24 PREMIERS feux du tableau, pas les plus proches — le feu qu'on vient de poser n'éclaire plus | `packages/client/src/scenes/world/dynamic-lighting.ts:113` | S | confirme |
| majeur | `FX-04` | La façade du gel ignore la Brume : le client peut manquer une glace que la sim a posée (G5) | `packages/client/src/scenes/world/etat-gel.ts:119` | M | confirme |
| majeur | `FX-06` | Le décor est intégralement reconstruit à chaque image : 1 400 objets alloués pour une fonction pure du terrain | `packages/client/src/scenes/world/clutter-layer.ts:131` | M | confirme |
| mineur | `FX-05` | La brume de la Combe est la seule couche atmosphérique sans garde de visibilité : un quad plein monde, allumé toute la session | `packages/client/src/scenes/world/combe-mist.ts:63` | S | ajuste |
| mineur | `FX-07` | La loi d'abri est rejouée à la main dans la foudre alors que la façade du gel prouve qu'elle n'a pas à l'être | `packages/client/src/scenes/world/foudre-fx.ts:242` | S | confirme |
| mineur | `FX-08` | La liste de destruction du shutdown est incomplète, et les destroy() des brumes ne rendent pas leurs clés | `packages/client/src/scenes/WorldScene.ts:834` | S | ajuste |
| mineur | `FX-09` | Les feux sont re-résolus trois fois par image, en trois tableaux jetables | `packages/client/src/scenes/WorldScene.ts:1405` | S | confirme |
| mineur | `FX-10` | Le givre des plantes appelle floreGelee par nœud et par image, et chaque appel alloue (travail NON COMMITÉ) | `packages/client/src/scenes/world/snapshot-view.ts:1826` | S | ajuste |

### client-ui

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `UI-01` | Le volume et la sourdine réglés dans les Options du menu principal sont ignorés pour toute la session | `packages/client/src/scenes/WorldScene.ts:573` | S | ajuste |
| majeur | `UI-02` | Aucun plafond de polyphonie : N sons identiques planifiés au même instant s'additionnent en amplitude, pas en énergie | `packages/client/src/audio/sound.ts:295` | M | ajuste |
| majeur | `UI-04` | Quatre couples texte/fond échouent au contraste WCAG AA, dont un à 1,96:1 | `packages/client/src/scenes/ui/hud-character.ts:711` | S | confirme |
| majeur | `UI-05` | Le poids porté s'affiche deux fois à l'écran, en deux couleurs et deux formats différents | `packages/client/src/scenes/ui/hud-character.ts:60` | S | confirme |
| majeur | `UI-06` | Deux modales plein écran `pointer-events:auto` peuvent être ouvertes en même temps — la garde d'exclusivité n'existe que dans un sens | `packages/client/src/scenes/world/input-bindings.ts:293` | S | confirme |
| majeur | `UI-07` | Trois modules DOM posent des écouteurs sur `document` sans jamais les retirer — ils s'accumulent à chaque Veillée | `packages/client/src/scenes/ui/hud-character.ts:365` | S | confirme |
| majeur | `UI-09` | Le son n'a aucun filtre spatial : tout fait de la vallée sonne à plein volume dans l'oreille du joueur | `packages/client/src/scenes/WorldScene.ts:2234` | M | confirme |
| mineur | `UI-03` | La palette n'est pas une source : 366 valeurs littérales contre 15 références `HEX.*`, et le garde-fou ne peut pas le voir | `packages/client/src/scenes/ui/palette.ts:17` | L | ajuste |
| mineur | `UI-08` | Le dédoublonnage du grincement de porte porte sur le TICK, pas sur la porte : il fait taire toutes les portes du monde sauf une | `packages/client/src/scenes/WorldScene.ts:2229` | S | confirme |
| mineur | `UI-10` | La courbe d'XP est réimplémentée deux fois dans le client, au lieu d'être dérivée de /sim | `packages/client/src/scenes/ui/hud-character.ts:261` | S | confirme |
| mineur | `UI-11` | L'ancien panneau d'inventaire Phaser (~475 lignes, 3 fichiers) n'a plus aucun appelant | `packages/client/src/scenes/ui/inventory-panel.ts:157` | M | confirme |
| mineur | `UI-12` | Le menu du marteau se recalcule et réécrit du HTML à chaque frame tant que le marteau est en main | `packages/client/src/scenes/ui/build-menu.ts:147` | S | confirme |

### client-infra

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `CI-01` | Un `boot()` qui rejette fige l'écran de chargement pour toujours, en silence | `packages/client/src/worker/sim-worker.ts:501` | S | confirme |
| majeur | `CI-02` | En multi, un onglet caché fait marcher l'avatar indéfiniment : le serveur ignore `pause` | `packages/client/src/scenes/WorldScene.ts:2169` | S | confirme |
| majeur | `CI-03` | L'invariant de `clearSlot` ne tient qu'à l'échelle d'UN onglet — un second efface la vallée d'une partie en cours | `packages/client/src/worker/persistence-store.ts:174` | M | confirme |
| majeur | `CI-04` | Quota plein : la carte de 60 Mo est re-sérialisée et ré-écrite toutes les 30 s, à jamais — et la sonde ne la mesure pas | `packages/client/src/worker/sim-worker.ts:306` | S | ajuste |
| majeur | `CI-05` | L'invulnérabilité de debug se PERSISTE et survit à un build de production | `packages/client/src/worker/sim-worker.ts:377` | S | ajuste |
| mineur | `CI-06` | `HostConnection.onMessage`/`onError` n'ont pas la même sémantique selon le transport | `packages/client/src/host-connection.ts:38` | S | confirme |

### serveur

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `SRV-01` | Les 466 structures immuables sont ré-encodées vers chaque client à chaque tick — 66 % du snapshot | `packages/server/src/zone-room.ts:275` | M | confirme |
| critique | `SRV-02` | Chaque arrivée gèle la zone 137 à 226 ms : le `ready` pèse 8 Mo et s'encode dans la boucle d'événements | `packages/server/src/zone-room.ts:189` | L | ajuste |
| majeur | `SRV-03` | Aucune identité de joueur : une coupure réseau efface l'avatar et son inventaire, et PostgreSQL n'aura rien où se brancher | `packages/server/src/zone-room.ts:151` | L | ajuste |
| majeur | `SRV-04` | La table des refus de forme est indexée par une chaîne CHOISIE PAR LE CLIENT, sans borne de cardinalité | `packages/server/src/zone-room.ts:216` | S | confirme |
| majeur | `SRV-05` | Le chat et le flux d'events percent la zone d'intérêt anti-ESP : la position de tout locuteur part à la vallée entière | `packages/server/src/zone-room.ts:284` | S | confirme |
| majeur | `SRV-06` | Une zone « condamnée » ressuscite sur l'état corrompu, et la trace qu'on promet de garder meurt avec la room | `packages/server/src/zone-room.ts:143` | S | confirme |
| majeur | `SRV-07` | Le replay-log est en écriture seule et refuse structurellement de rejouer passé dix minutes d'uptime | `packages/server/src/replay-log.ts:45` | M | ajuste |
| majeur | `SRV-08` | Le seau de jetons n'a été posé que sur le chat : `input` et `action` traversent la même porte sans compteur | `packages/server/src/zone-room.ts:199` | S | confirme |
| majeur | `SRV-09` | `zone-room.ts` et `zone-singleton.ts` — les 344 lignes qui portent l'autorité — n'ont aucun test | `packages/server/src/zone-room.ts:45` | M | confirme |
| mineur | `SRV-10` | Le `join` protocole n'est pas validé : un client de version incompatible obtient quand même un avatar | `packages/server/src/validate.ts:81` | S | confirme |
| mineur | `SRV-11` | Dérive d'horloge silencieuse : un tick trop long n'est jamais rattrapé, et rien ne le mesure côté serveur | `packages/server/src/zone-room.ts:90` | S | confirme |

### outillage

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `OUT-01` | suites.mjs : la porte du flaky avale les vraies pannes — et la CI sort verte | `tools/suites.mjs:113` | S | confirme |
| majeur | `OUT-02` | `pnpm check` s'arrête au premier paquet : les types de client et server ne sont jamais lus quand /sim rougit | `package.json:10` | S | confirme |
| majeur | `OUT-04` | `pnpm smoke` ne peut pas échouer sur ses propres verdicts : 290 assertions inertes | `tools/smoke.mjs:13688` | M | confirme |
| majeur | `OUT-05` | perf-structures.mjs est mort en dépôt, et le .patch qui le ressusciterait est committé en disant « NE PAS COMMITTER » | `tools/perf-structures.mjs:1` | M | confirme |
| mineur | `OUT-03` | tools/ n'est type-checké par aucun tsconfig : 5 erreurs réelles, dont une dérive d'API de /sim | `tools/diag-loup.mts:383` | M | ajuste |
| mineur | `OUT-06` | Le lint de pureté de /sim laisse passer les spécificateurs Node NUS — dont `perf_hooks` et `process` | `eslint.config.js:78` | S | ajuste |
| mineur | `OUT-07` | Le paquet client n'a pas de vitest.config : 5 s de délai pour des tests qui bâtissent la worldgen de production | `packages/client/src/worker/veillee.test.ts:36` | S | ajuste |
| mineur | `OUT-09` | `pnpm smoke` rebâtit tout le client à chaque lancement, sans échappatoire — et `SMOKE_URL` n'en est pas une | `tools/smoke.mjs:81` | S | confirme |
| mineur | `OUT-10` | Le bloc de doc de `cendre` documente désormais `flore` (travail NON COMMITÉ) | `tools/smoke.mjs:3533` | S | confirme |
| mineur | `OUT-11` | Aucune garde locale avant commit : la CI existe, mais elle est le seul filet — et OUT-01/OUT-02 la percent | `.github/workflows/ci.yml:29` | M | ajuste |
| mineur | `OUT-12` | L'invariant « pas de Map/Set ni de classes dans SimState » n'est tenu par aucun outil | `eslint.config.js:150` | S | ajuste |

**Réfutés dans ce lot (1)** — `pnpm test` se pend en silence si `pnpm` n'est pas sur le PATH


## complétude (43 specs)

### monde

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `M1` | lieux.md A1 affirme que le brouillard de terrain n'existe pas — il existe depuis le 2026-07-24 | `docs/specs/lieux.md (critère A1) vs packages/client/src/render/fog.ts + packages/client/src/scenes/UIScene.ts:422-437` | S | confirme |
| majeur | `M3` | Les gardes du T0 et du contenu tournent sur le plan DORMANT ('vallee'), pas sur le plan SERVI ('racine') | `packages/sim/src/t0-exploration.test.ts:49-52 et packages/sim/src/zone-content.test.ts:22` | M | confirme |
| majeur | `M4` | lieux-batis.md : la vérification différée d'isSheltered n'a jamais été rapportée — et la réponse est NON | `packages/sim/src/temperature.ts:32-35` | S | confirme |
| mineur | `M2` | worldgen.md R-MR4 annonce comme « à venir » les patchs de ressources T0, livrés le jour même | `docs/specs/worldgen.md (R-MR4) vs packages/sim/src/zonegen.ts:411-416 + packages/sim/src/affleurements.test.ts` | S | ajuste |
| mineur | `M5` | worldgen.md §10 liste A9/A10 comme critères vivants alors que le pivot a supprimé les paliers | `packages/sim/src/zonegen.ts:403-417 (interface CarteZonee)` | S | confirme |
| mineur | `M6` | monde.md R7 : l'importeur Tiled est testé mais orphelin — plus aucun flux de travail ne l'emprunte | `packages/sim/src/tiled.ts:56` | S | ajuste |
| mineur | `M7` | Du rendu et une couche entière du worldgen sont livrés mais inatteignables sous MONDE_JOUE, et aucune spec ne le dit | `packages/client/src/scenes/world/water-layer.ts:772 et packages/sim/src/zonegen-eaux-zones.ts` | S | confirme |
| mineur | `M8` | worldgen A7 (« le Gouffre relie vraiment ») : ni code, ni test, ni mention de report dans la spec | `packages/sim/src/zonegraph.ts:291` | S | ajuste |

### vivant

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `V-02` | combat.md annonce que la parade et le bandage ne sont pas câblés — les deux le sont | `docs/specs/combat.md:5` | S | confirme |
| majeur | `V-03` | combat.md R11 et A6 décrivent un zombie que le compilateur ne connaît plus | `docs/specs/combat.md:54` | S | confirme |
| majeur | `V-04` | recolte.md arme le mode construction par une touche débranchée depuis un an | `docs/specs/recolte.md:20` | S | confirme |
| mineur | `V-01` | La horde qui naissait dans la falaise : le correctif est là, aucune garde ne le tient | `packages/sim/src/worldevents.test.ts:220` | M | ajuste |
| mineur | `V-05` | cendreux.md R20 se déclare non livré ; les charniers sont dans le monde depuis le 16 août | `docs/specs/cendreux.md:297` | S | confirme |
| mineur | `V-06` | faune.md a un critère de plus dans ses tests que dans sa liste : A27 n'y figure pas | `docs/specs/faune.md:225` | S | confirme |
| mineur | `V-07` | La sentinelle est prouvée comme mécanisme, jamais comme jeu : l'approche sur les relèves n'est mesurée nulle part | `docs/specs/chasse.md:117` | M | confirme |
| mineur | `V-08` | Deux règles de horde du Cendreux vivent dans le code sans une seule assertion | `packages/sim/src/cendreux.ts:202` | S | ajuste |
| mineur | `V-09` | recolte-vivante promet quatre paliers d'outil, le test en garde cinq | `docs/specs/recolte-vivante.md:43` | S | confirme |
| mineur | `V-10` | recolte-maitrise énonce la cueillette à la touche E ; la touche est F | `docs/specs/recolte-maitrise.md:63` | S | confirme |
| mineur | `V-11` | recolte.md A8 réclame des mesures publiées qui n'existent nulle part | `docs/specs/recolte.md:85` | M | confirme |
| mineur | `V-12` | CHASSE II et CHASSE III n'ont pas les scénarios navigateur que C19 leur promet | `docs/specs/chasse.md:91` | M | ajuste |
| mineur | `V-13` | Deux specs se contredisent sur le recul du combat : l'une le raconte actif, l'autre le déclare à zéro | `docs/specs/cendreux.md:89` | S | ajuste |
| mineur | `V-14` | La dérive du bosquet ne se voit prouvée qu'au navigateur, et l'économie qu'elle règle n'a jamais été mesurée | `docs/specs/recolte-vivante.md:75` | M | confirme |
| mineur | `V-15` | Le prix d'une harde est calculé mais sa conséquence — la fin de la monoculture de cerfs — n'est affirmée nulle part | `docs/specs/faune.md:223` | M | confirme |

### survie

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `CUIR-2` | La tenue d'hiver est ÉTERNELLE : aucune usure, aucune réparation — l'hiver est résolu pour toujours | `packages/sim/src/balance.ts:1086` | M | ajuste |
| majeur | `BRUME-2` | Le filon découvert au retrait de la Brume n'apparaît jamais chez le joueur | `packages/client/src/scenes/world/snapshot-view.ts:1665` | S | ajuste |
| mineur | `CUIR-1` | La tenue d'hiver réchauffe DEPUIS LE SAC : « porté ≠ transporté » n'existe pas | `packages/sim/src/temperature.ts:216` | M | ajuste |
| mineur | `BRUME-1` | La nappe létale est INVISIBLE, et le contrat sim qu'elle annonce prêt ne l'est pas | `packages/sim/src/protocol.ts:239` | M | ajuste |
| mineur | `GEL-1` | Sous la Brume, le client ne peint ni la glace ni la plante gelée que la sim applique | `packages/client/src/scenes/world/etat-gel.ts:41` | S | confirme |
| mineur | `CONSTR-1` | construction.md se déclare incomplète sur un point qu'elle a livré : l'upkeep R16-R17 | `packages/sim/src/village.ts:764` | S | confirme |
| mineur | `TEST-1` | Deux garanties « banc multi-seeds, zéro mort PNJ » ne sont affirmées par aucun test | `packages/sim/src/meteo.test.ts:1` | M | ajuste |
| mineur | `FLORE-1` | Le chantier flore-froid — spec, tests et code — n'est pas commité | `docs/specs/flore-froid.md:1` | S | confirme |

### societe

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| critique | `SOC-1` | Deux bannières ⚠ affirment que l'alignement est débranché du solo — il est branché depuis le 2026-07-22 | `docs/specs/alignement.md:5` | S | confirme |
| majeur | `SOC-2` | pnj.md R9 « fonder attire 3 PNJ » est faux du chemin joueur, et son test vert emprunte un raccourci de worldgen | `packages/sim/src/village.ts:988` | S | ajuste |
| majeur | `SOC-3` | `generateNodes` / `circleFactor` est mort dans le monde joué, mais deux critères d'acceptation l'affirment encore | `packages/sim/src/tension.test.ts:178` | M | ajuste |
| majeur | `SOC-4` | village.md R8 décrit une porte qui n'existe plus, et sa bannière REVENDIQUE justement les accès | `docs/specs/village.md` | S | confirme |
| majeur | `SOC-5` | village.md R4/A1 fait fonder le joueur par `light_fire`, devenu un raccourci de test et de worldgen | `packages/sim/src/village.ts:884` | M | confirme |
| mineur | `SOC-6` | evenements.md R3 nomme une constante qui n'existe nulle part, et décrit un champ de flux qui bloquerait le siège | `docs/specs/evenements.md:18` | S | confirme |
| mineur | `SOC-7` | L'événement `crop_frozen` (chantier non commité) promet une entrée de chronique que la chronique ne connaît pas | `packages/sim/src/events.ts:163` | S | ajuste |
| mineur | `SOC-8` | L'invariant « l'alignement consomme le flux d'événements » est faux — il est instrumenté en ligne, et le dépôt le sait depuis 2026-07-19 | `packages/sim/src/alignment.ts:36` | S | ajuste |
| mineur | `SOC-9` | client.md R1 fait envoyer la carte par le client — l'inverse du code et de l'invariant « serveur autoritatif » | `packages/sim/src/protocol.ts:47` | S | confirme |
| mineur | `SOC-10` | La lueur du Feu suit \|chaleur\| et non l'engagement, que le client ne lit jamais | `packages/client/src/render/lighting.ts:216` | S | ajuste |


## transversal

### architecture

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `ARCH-01` | Le fantôme de construction réimplémente à la main la règle que /sim exporte pour l'en empêcher — deux fois, et personne n'appelle evaluateBuild | `packages/client/src/scenes/WorldScene.ts:463` | M | ajuste |
| majeur | `ARCH-05` | La composante fortement connexe de /sim est passée de 25/63 à 34/75 modules, et rien ne mesure sa dérive | `packages/sim/src/collision.ts:19` | L | confirme |
| majeur | `ARCH-06` | state.structures est un tableau plat balayé linéairement à chaque sous-tuile du déplacement, alors que l'index O(1) existe dans le même fichier | `packages/sim/src/collision.ts:187` | M | ajuste |
| mineur | `ARCH-02` | La recette de fabrication du monde est écrite trois fois — deux divergences documentées, une troisième silencieuse | `packages/server/src/scenario.ts:63` | M | ajuste |
| mineur | `ARCH-03` | Le snapshot ne porte pas la Brume : le client fabrique un faux SimState par cast, et manque des glaces que la sim a posées | `packages/client/src/scenes/world/etat-gel.ts:121` | M | ajuste |
| mineur | `ARCH-04` | index.ts : 497 noms, 250 importés par aucun hôte, aucune règle d'admission — dont 34 fonctions de boucle qu'un hôte ne doit surtout pas appeler | `packages/sim/src/index.ts:1` | M | ajuste |
| mineur | `ARCH-07` | WorldScene.ts : un update() de 787 lignes, 74 imports, ~105 champs — et le fichier le plus édité du dépôt | `packages/client/src/scenes/WorldScene.ts:1046` | M | ajuste |
| mineur | `ARCH-08` | La projection SimState → SnapshotMessage est écrite deux fois, alors que le dépôt a déjà fait migrer dans /sim la duplication jumelle | `packages/client/src/worker/sim-worker.ts:169` | S | confirme |
| mineur | `ARCH-09` | tools/ (23 fichiers) contourne entièrement la façade et n'est couvert par aucun gate de compilation | `tools/banc-saison.mts:22` | S | confirme |
| mineur | `ARCH-13` | faune.ts : 3 375 lignes et un faunaStep de 456 — le gisement déjà nommé par la passe de refacto, et qui a grossi depuis | `packages/sim/src/faune.ts:1958` | L | ajuste |

**Réfutés dans ce lot (3)** — Le replay log de /sim est mort et réécrit dans le serveur, alors qu'il est présenté comme un pilier du projet · SimState est défini dans sim.ts, le module d'orchestration du tick — 37 modules sur 42 n'en importent QUE des types · snapshot-view.ts : une classe de 1 670 lignes dont une méthode syncActor de 596

### duplication

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `DUP-01` | Le registre PIECES a une source unique dans /sim, trois tables recopiées à la main côté art — et la garde compte au lieu d'énumérer | `packages/client/src/render/bati-art.ts:209` | M | ajuste |
| majeur | `MORT-01` | foundableFire / upgradableFire : deux publishers morts et deux clés de HudState que plus personne n'écrit | `packages/client/src/scenes/world/hud-bridge.ts:123` | S | confirme |
| majeur | `MORT-02` | Les 10 lieux BÂTIS gardent leur art peint ET leur art _lit — 489 lignes générées à chaque boot, jamais affichées, et une garde qui les force à rester | `packages/client/src/render/poi-lit-defs.ts:14` | M | ajuste |
| mineur | `MORT-03` | L'instrument A9 est cassé des deux côtés : le patch ne s'applique plus, la sonde lit un symbole que rien ne pose | `tools/instrumentation-a9-snapshot-view.patch:1` | S | confirme |
| mineur | `MORT-04` | estBiconnexeSur : le prédicat du garde-fou de 2-connexité n'est appelé par personne — et son test le réécrit à la main | `packages/sim/src/zonegraph.ts:1064` | S | ajuste |
| mineur | `DUP-02` | Les identifiants de terrain sont recopiés à la main dans six fichiers alors qu'ils sont nommés et exportés | `packages/sim/src/poi.ts:19` | S | ajuste |
| mineur | `DUP-03` | Le harnais des tests de /sim est réécrit fichier par fichier — deux fichiers partagent 25 lignes mot pour mot | `packages/sim/src/porte-double.test.ts:22` | M | ajuste |
| mineur | `MORT-05` | Dix-sept exports sans aucune référence dans le dépôt (tests et tools compris) | `packages/sim/src/geometry.ts:98` | S | ajuste |
| mineur | `DUP-04` | Le préambule de scénario de smoke.mjs est recopié une quarantaine de fois, avec trois autres blocs jumeaux | `tools/smoke.mjs:340` | M | ajuste |
| mineur | `MORT-06` | set_access, invite, banish : trois actions de /sim que seuls les tests construisent | `packages/sim/src/village.ts:331` | S | confirme |
| mineur | `DOC-01` | Le commentaire de boxBlur nomme deux clients qui n'existent nulle part | `packages/sim/src/geometry.ts:95` | S | confirme |
| mineur | `DUP-05` | Le masque d'arête N/E/S/O est réécrit à quatre endroits alors que /sim l'exporte depuis sa racine | `packages/client/src/render/bati-art.ts:38` | S | confirme |

**Réfutés dans ce lot (2)** — snapshot-view écrit deux fois la liste des barrières verticales, et les deux copies diffèrent d'un membre · combe-mist réécrit son champ de distance alors que morning-mist en exporte un — et ici, factoriser serait une faute

### perf

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `PERF-01` | Le gel a branché un balayage O(structures) + une allocation sous CHAQUE tuile d'eau profonde du chemin indexé de la collision — donc sous le BFS plein-carte du champ de flux, et les hordes sont nocturnes | `packages/sim/src/collision.ts:324` | M | ajuste |
| majeur | `PERF-02` | `neigeAuSol` intègre la fonte par tranches et peut appeler jusqu'à 72 fois `baselineTemperatureAt` PAR TUILE — la couche de gel du client en balaie ~960 par recuisson, sur le thread principal | `packages/sim/src/gel.ts:384` | S | ajuste |
| majeur | `PERF-03` | La collision sous-tuile balaie TOUT `state.structures` à chaque sous-tuile de chaque pas — l'index d'occupation mémoïsé qui règle ce problème vit dix lignes plus haut | `packages/sim/src/collision.ts:190` | M | confirme |
| majeur | `PERF-05` | Le cache des champs de flux s'invalide GLOBALEMENT : un seul arbre abattu n'importe où dans la vallée jette tous les champs, à 1192 ms pièce | `packages/sim/src/monsters.ts:540` | M | ajuste |
| majeur | `PERF-07` | `poisAt` alloue un tableau à chaque appel, et il est sur DEUX chemins par-entité-par-tick (`staminaPoiFactor` dans le combat, `isSheltered` dans la température) | `packages/sim/src/map.ts:283` | S | ajuste |
| majeur | `PERF-08` | Trois passes PAR FRAME sur les 772 structures côté client, hors du périmètre du mémo A9 (qui n'a mémoïsé que le chemin à 20 Hz) | `packages/client/src/scenes/world/dynamic-lighting.ts:112` | S | ajuste |
| mineur | `PERF-04` | Le profileur du tick ne pose pas les lieux bâtis : la dernière mesure connue (0,725 ms/tick) est aveugle aux 772 structures qui rendent PERF-01 et PERF-03 coûteux | `tools/profil-tick.mts:38` | S | ajuste |
| mineur | `PERF-06` | `advanceNpcs` résout l'entité de chaque PNJ par un `find` linéaire sur toutes les entités — le O(n·m) que `advanceMonsters` a corrigé chez lui, jamais appliqué ici | `packages/sim/src/npc.ts:1013` | S | ajuste |
| mineur | `PERF-09` | `nearestPrey` reconstruit un `Set` de tous les identifiants de monstres À CHAQUE APPEL, et il est appelé jusqu'à deux fois par Cendreux et par tick | `packages/sim/src/monsters.ts:359` | S | ajuste |
| mineur | `PERF-10` | `advanceEconomy` balaie les 125 686 nœuds à chaque tick, 20 fois par seconde, pour n'agir que sur une poignée | `packages/sim/src/economy.ts:971` | M | ajuste |
| mineur | `PERF-11` | `advanceEnvols` paie un balayage de tous les monstres par entité — et le filtre d'allure censé le protéger ne filtre rien, parce que les bêtes gardent `gait: 'walk'` à vie | `packages/sim/src/faune.ts:487` | S | ajuste |
| mineur | `PERF-12` | Deux dérivés purs reconstruits à chaque tick alors qu'ils ne changent qu'aux faits de construction : la table du Grenier (avec ses chaînes de clé) et, à sec, la liste des murs d'un village | `packages/sim/src/economy.ts:908` | S | ajuste |

### tests

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `T1` | Le contournement du flaky de suites.mjs avale un fichier de test qui ne se charge plus | `tools/suites.mjs:113` | S | ajuste |
| majeur | `T2` | 54 % du client n'est atteint par aucun test, et le seul filet qui le couvre n'est jamais exécuté automatiquement | `.github/workflows/ci.yml:31` | M | confirme |
| majeur | `T3` | Aucun contrat de déterminisme ni de replay ne tourne sur la carte GÉNÉRÉE — tous jouent sur createEmptyMap | `packages/sim/src/replay.test.ts:11` | M | ajuste |
| majeur | `T4` | sim-worker.ts — l'hôte de la Veillée et son autosave — n'a aucun test, et le test de /sim reproduit sa logique au lieu de la tester | `packages/client/src/worker/sim-worker.ts:271` | M | confirme |
| majeur | `T5` | zone-room.ts — toute l'autorité serveur du jalon L1 — n'est atteint par aucun test | `packages/server/src/zone-room.ts:73` | M | ajuste |
| majeur | `T6` | ≈ 35 générations de carte de production par run, dont cinq paires qui prouvent toutes la même propriété | `packages/sim/src/poi.test.ts:163` | S | ajuste |
| mineur | `T7` | Le test « déterministe : même seed → mêmes zones » compare une variable à elle-même | `packages/sim/src/poi.test.ts:71` | S | confirme |
| mineur | `T9` | Les 3 692 lignes de sondes .mts de tools/ échappent à tsc, et n'ont aucun test | `pnpm-workspace.yaml:2` | S | confirme |
| mineur | `T10` | Une assertion tautologique prétend prouver la règle « le PNJ garde de quoi manger » (spec PNJ R6) | `packages/sim/src/npc.test.ts:252` | S | confirme |
| mineur | `T11` | Le déterminisme « entre moteurs JS » n'est jamais exécuté sur deux moteurs — seul le lint le garde | `packages/sim/src/sim.test.ts:72` | M | confirme |

**Réfutés dans ce lot (1)** — Le critère phare des PNJ est en pause depuis des mois et la sortie de la suite ne le dit jamais

### documentation

| sév. | id | constat | où | eff. | verdict |
|---|---|---|---|---|---|
| majeur | `DOC-01` | Le backlog que CLAUDE.md désigne comme point d'entrée est périmé : 3 items sur 4 sont déjà construits | `docs/gate1-finition.md:21` | S | ajuste |
| majeur | `DOC-02` | Cinq specs annoncent en en-tête un système « à implémenter » ou « débranché » alors qu'il est livré et testé | `docs/specs/alignement.md:5` | S | ajuste |
| majeur | `DOC-03` | sprint-aaa.md déclare le banc d'équilibrage aveugle à la chasse — le code le contredit depuis un mois | `docs/sprint-aaa.md:68` | S | confirme |
| majeur | `DOC-04` | CLAUDE.md se trompe sur ce que mesure `pnpm smoke --dev`, et l'échappatoire n'est documentée nulle part | `CLAUDE.md:39` | S | confirme |
| majeur | `DOC-06` | balance.ts : la prose qui justifie les deux arcs raisonne encore sur les portées d'avant le halving, que son propre en-tête documente | `packages/sim/src/balance.ts:1674` | S | ajuste |
| majeur | `DOC-09` | docs/specs/monde.md donne une hitbox d'avatar fausse : 0,6 tuile contre 0,75 × 0,375 dans le code | `docs/specs/monde.md:33` | S | confirme |
| mineur | `DOC-05` | Les notes docs/superpowers/ n'ont pas la bannière « chiffres révisés » promise ; l'une d'elles est 5× hors du code | `docs/superpowers/specs/2026-07-08-jauge-temperature-design.md:3` | M | confirme |
| mineur | `DOC-07` | docs/roadmap.md liste en travaux futurs trois systèmes livrés, et raisonne encore sur un tick à 12 Hz | `docs/roadmap.md:82` | S | ajuste |
| mineur | `DOC-08` | Le système audio est livré sans spec dans docs/specs/, en contradiction avec la règle « specs avant systèmes » | `CLAUDE.md:87` | M | ajuste |
| mineur | `DOC-10` | L'instrument de calibration devenu principal (tools/banc-saison.mts) n'est nommé nulle part dans CLAUDE.md | `CLAUDE.md:54` | S | ajuste |
| mineur | `DOC-11` | La liste des blocs de réglage worldgen — l'exception actée à « tout nombre vit dans balance.ts » — en oublie trois | `CLAUDE.md:83` | S | ajuste |
| mineur | `DOC-12` | Quatre compteurs cités dans la doc de pilotage sont périmés d'un facteur 2 à 10 | `docs/specs/README.md:11` | S | ajuste |
| mineur | `DOC-13` | traefik/dynamic.dev.yml est orphelin : la stack n'a plus de Traefik, sa route vit hors du dépôt | `traefik/dynamic.dev.yml:1` | S | confirme |


---

**Total : 235 constats retenus.**
