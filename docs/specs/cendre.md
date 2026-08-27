# La cendre — elle sourd des fosses, et elle coule

*Source : décisions d'Alexis du 2026-08-24, prises une à une (journal ci-dessous). **Remplace le
front de cendre** retiré le même jour (`cortege-cendre.md` et `worldgen.md` §7 sont caducs). Statut :
**IMPLÉMENTÉ le 2026-08-24** — noyau `/sim` (`cendre.ts`), champ posé au worldgen, rendu client
(`cendre-layer.ts`), 26 gardes vertes dans `cendre.test.ts`. Reste l'ART des trois terrains (les
teintes en place sont des teintes de travail). Jalon : avant GATE 1.*

*⚠ **AMENDÉE LE 2026-08-27**, en deux temps, voir les sections en fin de document : **R20** coupe
le cœur en quatre bandes comptées en TUILES (l'ossature de l'écosystème), **R21** donne un
caractère à quatre des dix fosses (sa variété) — puis **R22** refroidit la cendre à mesure qu'elle
mûrit et **R23** ré-arme la hantise du champ des morts sur le même axe (le danger). Le catalogue
des sept pistes d'habitants encore non tranchées vit dans
`docs/superpowers/plans/2026-08-27-ecosysteme-de-la-cendre.md`.*

## Objectif de design

L'ancien front était une LIGNE qui traversait la vallée du sud au nord, calibrée pour en manger une
part, et qui **supprimait tout nœud passé derrière elle**. Trois défauts, tous constatés en jouant :
la ligne était droite (mesuré : au jour 285, la dernière rangée non brûlée valait 273 dans les
71 colonnes échantillonnées) ; elle ne rendait jamais rien, donc le bois disparaissait d'un jour à
l'autre sans préavis ; et elle n'offrait au joueur **aucun verbe** — seulement fuir.

La cendre ne descend plus d'ailleurs : **elle sourd du sol, là où la vallée a enterré ses morts.**
Chaque charnier est un foyer. Elle avance très lentement, dans toutes les directions, **en coulant à
travers le terrain** plutôt qu'en s'étendant en cercle. Ce qu'elle prend, elle ne le rend pas — mais
elle l'annonce des semaines à l'avance, elle laisse au joueur de quoi l'exploiter avant qu'il ne
parte, et elle se **négocie** foyer par foyer.

---

## Les foyers

- **R1 — UN FOYER PAR CHARNIER.** Rien à semer de neuf : les charniers existent, ils sont déjà de la
  famille `danger`, déjà le lieu où les morts se lèvent. Ils deviennent l'origine de la cendre, et
  cette double nature est la leçon que le monde enseigne tout seul : *on ne bâtit pas à côté d'une
  fosse.* **Mesuré (10 graines) : 9,3 charniers par carte** (8 à 10), voisin le plus proche à 167 t
  au minimum, 217 t en médiane. Semis de Poisson à `MORTS.CHARNIER_ESPACEMENT` (160).

- **R2 — TOUS LES FOYERS, ENSEMBLE.** Aucune cascade, aucun ordre d'allumage : ils partent tous au
  même instant et avancent à la même allure. La géographie fait toute la variété — un foyer cerné de
  roche rampe, un foyer dans le pré court.

- **R3 — LA TACHE INITIALE, POSÉE AU WORLDGEN, ET DE LA TAILLE D'UNE TACHE MINÉRALE.** Chaque fosse
  porte sa cendre **dès le premier jour**, sur un rayon de coût `R0 = 10`. C'est une décision
  d'Alexis, avec un but précis — *« que le joueur comprenne rapidement ce qu'il se passe »* — et une
  taille qu'il a fixée par comparaison : *« relativement petite, taille biome minéral »*. **Mesuré :
  229 tuiles**, contre **320** pour une tache minérale de la Racine (rayon équivalent 10,1) —
  l'ordre de grandeur demandé, au chiffre près. Elle pèse **0,2 % de la vallée**, et le grain de R6
  la découpe dès le premier jour : ce n'est jamais un disque.

---

## Le cheminement

- **R4 — ELLE COULE, ELLE NE S'ÉTEND PAS.** Le champ n'est pas une distance à vol d'oiseau mais une
  **distance de CHEMINEMENT** : un Dijkstra multi-source depuis les fosses, calculé **une fois au
  worldgen** (même passe, même coût que `distEau` et `profondeur`), rangé dans `map` comme donnée
  STATIQUE. Une tuile est cendrée ssi `coût(tuile) ≤ avancée(tick)`.

  **L'eau ne se traverse pas.** La cendre contourne la rivière et les lacs. Ce que ça change,
  mesuré : pour prendre 60 % de la vallée il faut parcourir **~255** au lieu de ~185 à vol d'oiseau
  — **38 % de temps gagné pour le joueur**, sans toucher à un réglage. Et la forme devient vraie :
  elle remonte les vallons, s'engouffre entre deux lacs, arrive sur l'autre rive des semaines plus
  tard **par le détour**. *(Vérifié : la terre est d'un seul tenant sur les trois graines — l'eau
  RETARDE, elle ne protège jamais définitivement.)*

- **R5 — LE TERRAIN LA FREINE** *(décision d'Alexis)*. Le coût d'entrée dépend de la famille du sol :
  **vivant ×1, minéral ×3** — *le sol nu n'a rien à brûler*. Un massif rocheux devient un frein
  visible, un col un goulot, un village adossé à la roche gagne réellement du temps. Le joueur lit
  la carte pour savoir par où ça va venir.

- **R6 — ORGANIQUE, JAMAIS UN CERCLE** *(demande d'Alexis, redite le 2026-08-24 : « je le veux plus
  organique en terme de progression »)*. Trois choses, dans cet ordre, et **les trois sont
  nécessaires** :

  ① **LE CHAMP EST 8-CONNEXE** — orthogonale 100, diagonale 141, minéral ×3. ⚠ Un Dijkstra
  **4-connexe rend des LOSANGES**, pas des disques : sur un terrain uniforme ses isolignes sont des
  carrés posés sur la pointe, ce qui est *plus* artificiel qu'un cercle. Le défaut est invisible en
  regardant le code et saute aux yeux sur une carte rendue (constat sur la première simulation).

  ② **LA GÉOGRAPHIE** (R4/R5) tord déjà la forme : détour de l'eau, freinage sur la roche.

  ③ **LE GRAIN, ET IL EST RELATIF — PAS ABSOLU.** Une tuile brûle quand
  `coût(i) ≤ avancée × (1 + WARP_PART · bruit(i))`, `bruit ∈ [−1, 1]` tiré d'un `fbm2` basse
  fréquence **décidé au MOTIF de 8 tuiles** (le patron de `clairiereForet`, qui échantillonne au
  centre du bloc). Réglage : `WARP_PART = 0,35`, `WARP_ECHELLE = 44` tuiles.

  ⚠ **UNE AMPLITUDE ABSOLUE NE MARCHE PAS, et ça ne se voit qu'en rendant la carte** : à ±26 unités
  de coût sur une tache initiale de rayon 10, certains foyers n'avaient **aucune cendre visible au
  jour 1** — le bruit avalait la tache. En relatif, la tache naît irrégulière mais **entière**, et la
  déformation CROÎT avec le front : ±3 tuiles au départ, ±130 à l'an 5. C'est la réponse littérale à
  la demande d'Alexis — *« plus organique en terme de PROGRESSION »* : ce n'est pas seulement la
  forme qui est irrégulière, c'est le fait qu'elle se découpe de plus en plus à mesure qu'elle
  s'éloigne de sa fosse. Un front qui diffuse rugosifie en s'étalant ; celui-ci aussi.

  ④ **LE BLOC SE DÉPLACE** *(décision d'Alexis, 2026-08-25, sur planche rendue : « implémente
  ça »)*. La coordonnée est TORDUE avant d'être quantifiée au motif — `CENDRE.BLOC_AMPLITUDE = 6`
  tuiles, `BLOC_ECHELLE = 22`, l'idiome de `fbmWarp2` tourné d'un cran, en amont de la
  quantification. **Les marches d'escalier restent** (c'est la grammaire de tout le terrain du
  jeu, et la raison pour laquelle on ne lit pas le bruit tuile par tuile) ; seuls leurs bords
  cessent de suivre les axes.

  ⚠ **LE DÉFAUT QU'IL CORRIGE EST UNE COÏNCIDENCE DE DEUX GRILLES, et ① en est la moitié.** Les
  bords d'un bloc de 8 tuiles sont horizontaux et verticaux par construction ; les isolignes d'un
  Dijkstra 8-connexe sont des **OCTOGONES**, dont les côtés le sont aussi. Quand une isoligne longe
  un bord de bloc, tout le bord bascule d'un coup et **la lisière sort en MUR**. La seconde octave
  du grain, posée pour ça, ne les avait pas tuées. MESURÉ (`tools/diag-frange.mts`, seed 2026,
  vallée entière, l'eau et le vide exclus des deux côtés — un bord de lac n'est pas un front) :
  au jour 391, **la plus longue arête parfaitement droite passe de 40 à 14 tuiles** et le nombre
  d'arêtes de 8 tuiles ou plus de **502 à 98**. La part cendrée bouge de 0,05 point : aucun
  équilibrage ne se déplace. Prix : deux `fbm2` de plus, **par tuile et non par bloc** — c'est
  l'objet même du déplacement (`grainDeCendre` mesuré ×1,95).

- **R7 — LA COURBE EST CONCAVE, ET C'EST VOULU.** Coût à parcourir pour prendre 25 / 50 / 60 / 75 /
  90 / 100 % de la vallée : **150 / 245 / 290 / 375 / 510 / ~950** (moyenne sur trois graines, avec
  minéral ×3). La cendre mord tôt et traîne longtemps : le premier quart tombe vite, chaque tranche
  suivante coûte plus cher.

---

## Le rythme

- **R8 — ELLE DORT JUSQU'AU PREMIER GRAND FROID (jour 91).** Trente jours après l'ouverture du monde
  (jour 61). Ce n'est pas une date arbitraire : le jeu fait DÉJÀ lever les morts avec le froid
  (`CENDREUX.TORPEUR` — éveil nul à +6 °C, plein à −14 °C). La cendre qui sort des fosses quand
  l'hiver mord est **la même loi**, pas une seconde.

- **R9 — ELLE DIFFUSE, ELLE NE MARCHE PAS** *(décision d'Alexis : « loi racine avec plafond de 3 par
  jour »)*. L'avancée n'est pas linéaire, c'est une **racine carrée** — la loi d'un front qui diffuse,
  et `Math.sqrt` est dans les opérations autorisées à `/sim` (l'invariant n°2 interdit `pow`, `exp`
  et `log`, pas `sqrt`) :

      avancée(jour) = min( R0 + A·√(jour − 91) ,  avancée(jour − 1) + P )      A = 6,8845 · P = 1,5

  **`A` ÉTAIT dérivé de la contrainte d'Alexis**, pas choisi — *« il faudrait que la cendre commence
  à appliquer une pression réelle à la fin du second hiver »*, traduit en mesurable : **la moitié des
  sites de village pris**, ce qui vaut un coût de **211** (très stable : 211, 211, 205 sur trois
  graines). La fin du 2ᵉ hiver est le **jour 240**, d'où `A·√149 = 178 − 10` → `A = 13,769`. ⚠ `A` a
  été **redérivé** une fois (16,479 → 13,769) quand le champ est passé en 8-connexe et a reçu son
  grain : la même contrainte, sur une échelle de coûts qui a changé.

  ⚠⚠ **LA CONTRAINTE A ÉTÉ LEVÉE LE 2026-08-25** *(Alexis : « divise la propagation de la cendre par
  2 »)*. `A` passe à **6,8845** et le plafond à **1,5** — divisés ENSEMBLE, pour que l'avancée
  au-dessus de `R0` vaille exactement la moitié **à toutes les dates** (le plafond laissé à 3 aurait
  rendu les cinq premiers jours identiques à avant : le `min` ne fait que rabaisser).

  > **La loi est une RACINE : « deux fois moins loin » n'est pas « deux fois plus lent ».** Atteindre
  > un coût donné demande **quatre fois** plus de jours. Le repère de pression (moitié des sites)
  > glisse du **jour 255 au jour 747** — la fin du 6ᵉ hiver au lieu du 2ᵉ. *(Si l'intention avait été
  > « deux fois plus de temps », le nombre serait `A/√2 ≈ 9,736` — moitié des sites au jour 419.)*

  **LE PLAFOND EST GRATUIT, et c'est ce qui le rend acceptable.** Sans lui, le réveil du jour 91
  serait une BOUFFÉE : la tache initiale plus que doublée en un seul jour. Avec lui, le réveil
  s'étale sur trois semaines à `P`/jour — et la droite `P·t` **rejoint exactement** la courbe `A·√t`
  en `t = (A/P)² ≈ 21`. Passé ce point le plafond ne mord plus jamais : il ne déplace pas la courbe,
  il ne fait que lisser son entrée, et toute la queue est celle de la racine nue. **Le rapport `A/P`
  est ce qui compte** — c'est pourquoi les deux se divisent ensemble : les ~21 jours de lissage sont
  les mêmes avant et après.

  **Ce que la décroissance achète, mesuré :** la vitesse tombe de 1,5/jour au réveil à **0,28 au jour
  240**, **0,15 à l'an 5**, **0,10 à l'an 10**. La vallée n'est donc **jamais entièrement prise** —
  et le refuge est désormais large : **38 % de terre vivante encore à l'an 10** (contre 4 à 10 %
  avant). *« La condamnation est une PENTE, pas une échéance »*, à la lettre — la pente est deux fois
  plus douce.

  **Simulé sur le vrai monde** (seed 2026, 10 fosses, un champ de coût par foyer, personne ne touche
  aux fosses). Les deux lois sont relevées **dans la même exécution, sur la même carte** — le champ
  de coût ne dépend pas de `A`, donc la comparaison ne doit rien à une seconde génération
  (`node --import tsx tools/diag-cendre.mts 2026 --compare 13.769,3`) :

  | | j.1 | fin an 1 (j.120) | fin 2ᵉ hiver (j.240) | fin an 3 (j.360) | an 5 (j.600) | **fin 6ᵉ hiver (j.720)** | an 7 (j.840) | an 10 (j.1200) |
  |---|---|---|---|---|---|---|---|---|
  | vallée sous la cendre | 0,2 % | 4,2 % | 16,5 % | 26,1 % | 40,6 % | **46,0 %** | 50,4 % | 61,6 % |
  | sites de village pris | 0/50 | 4/50 | 8/50 | 14/50 | 24/50 | **27/50** | 28/50 | 35/50 |
  | *avant le ÷2 : vallée* | *0,2 %* | *13,2 %* | *44,6 %* | *60,7 %* | *78,6 %* | *82,9 %* | *86,2 %* | *91,6 %* |
  | *avant le ÷2 : sites* | *0/50* | *7/50* | *25/50* | *35/50* | *46/50* | *47/50* | *47/50* | *50/50* |

  La dernière colonne dit tout : à l'an 10, la vallée passait de **91,6 % prise et 50 sites sur 50**
  à **61,6 % et 35 sur 50**. Ce n'est plus la même fin de partie.

  ⚠ **LA LOI RACINE A RÉGLÉ TROIS CHOSES D'UN COUP**, dont deux qui n'étaient même pas la question
  posée. ① **La queue** : il reste ~19 % de vallée vivante à l'an 5 et ~11 % à l'an 7 — un refuge,
  et la vallée n'est jamais entièrement prise. ② **L'an 1 n'est plus muet** : 13,7 % au lieu de
  3,7 % sous la loi linéaire — la cendre bouge visiblement dès la première année, et la tache
  initiale (R3) n'a plus à porter seule la pédagogie. ③ **Le verbe du joueur pèse enfin** (R16) :
  sous la loi linéaire, tenir trois foyers ne changeait presque rien au-delà de l'an 3 puisque les
  voisins reprenaient tout ; sous la racine, **l'écart se CREUSE avec le temps** — à l'an 7, 88,3 %
  de vallée prise si l'on subit contre **74,5 % en tenant trois foyers**, et **dix sites de village
  encore libres au lieu de trois**.

  À l'échelle d'une session c'est **imperceptible passé le réveil** : au jour 240 la frange gagne
  **0,28 tuile par jour** dans le pré (0,7 avant le ÷2 du 2026-08-25) — une tuile tous les trois
  jours et demi de jeu, et trois fois moins sur la roche. On ne voit pas la cendre bouger : on
  constate, en revenant plusieurs sessions plus tard, qu'elle a mangé le bosquet du bas.

- **R10 — LES SPAWNS SONT ÉCARTÉS DES FOSSES, PAS LES SITES DE VILLAGE.** Un site, on le choisit ;
  son point de naissance, non. Le charnier rejoint donc `DangersDePlacement` **pour `pointsDeSpawn`
  seulement**, écart minimal **150 de coût** (≈ jour 195). Tenable largement : seuls 12 à 15 des
  ~50 sites sont sous ce seuil. **Le défaut que ça ferme, mesuré** : sans lui, le premier site de
  village tombe à un coût de 11-20 (soit ~10 jours de jeu) et le premier spawn à 11 sur la seed 7 —
  un joueur pouvait naître à neuf jours de la cendre.

---

## Ce que la cendre fait à une case

- **R11bis — LA CENDRE PASSE PAR LE SOL DESSINÉ, pas par un calque** *(art, 2026-08-24)*. Elle
  entre dans `PRIORITE_PAVE` au rang 10 — **au-dessus de tout ce qui pousse** (elle recouvre ce
  qu'elle a tué), **sous le manteau de neige** (l'hiver recouvre la cendre comme le reste). Le
  `PaveLayer` lit un TERRAIN EFFECTIF (`terrainCendre` appliqué à la volée : la carte n'est jamais
  mutée), et périme les chunks dont l'aspect change quand un âge de foyer change — au plus une fois
  par jour de saison, ~10 à 14 ms par chunk recuit (MESURÉ au navigateur).

  ⚠ **« DONT L'ASPECT CHANGE » N'EST PAS « QUI PORTENT DE LA CENDRE », et la première écriture s'y
  est trompée** *(corrigé le 2026-08-25, sur capture d'Alexis)*. Une appartenance POSITIVE relevée
  à la cuisson ne peut pas voir arriver le front : un chunk cuit AVANT que la cendre l'atteigne
  n'était dans aucun ensemble, donc jamais jeté, donc **jamais recuit** — la cendre s'arrêtait net
  sur une arête de chunk, 16 tuiles de long, et y restait tant que le joueur gardait la zone à
  l'écran (l'oubli, 120 images, ne réparait que si on lui tournait le dos deux secondes). MESURÉ
  (seed 2026, la fenêtre d'un écran autour de (632, 239), cuite à l'âge 60 et regardée jusqu'à
  l'âge 200) : **21 chunks sur 35 restaient faux, 3 403 tuiles peintes vivantes après avoir
  brûlé**. La question se pose donc au SEUIL (`render/cendre-chunk.ts`) : chaque chunk retient, par
  fosse qui le revendique, **l'avancée à laquelle sa première tuile prend feu** — marge de cuisson
  comprise (`PAVE_MARGE_TUILES`, ce que `cuireChunk` LIT), sans quoi le même défaut se rouvrirait
  sur une tuile de large à chaque couture. Il se recuit dès que ce foyer a vieilli ET que son
  avancée a atteint ce seuil. **On compare des ÂGES, pas des avancées** : un caractère `deluge`
  vieillit un foyer de 0,4 jour et repeint la frange (la cendre refroidit sur 30 jours) sans
  déplacer l'avancée d'un pouce. Coût relevé : **0,033 ms par chunk**, contre 5,5 à 10,9 ms de
  cuisson — 0,4 %.

  ⚠ **ET LES RECUISSONS S'ÉTALENT** : le correctif fait passer le pire jour de saison de 7 chunks
  (faux) à **28 chunks** (justes) dans une fenêtre d'écran
  (à 5,5-10,9 ms la cuisson, de l'ordre de 150 à 300 ms si tout tombait sur une image — estimé,
  pas relevé au navigateur). Un chunk périmé garde donc son image d'hier jusqu'à son tour
  (`RECUISSONS_CENDRE_PAR_FRAME` = 2, le visible d'abord) : les 28 passent en 14 images. C'est la
  différence avec un chunk MANQUANT, qui se cuit toujours sans budget — celui-là est un trou à
  l'écran, celui-ci a un jour de retard sur la frange, ce que personne ne peut voir.

  ⚠ **UNE COUCHE À PART NE PEUT PAS MARCHER, et ça ne se voit qu'en capture.** La première version
  peignait un pixel par tuile étiré à la taille du monde : bonne couleur, bon grain, bon dégradé
  d'âge — et **aucun bord**. La limite avec le vivant était une découpe nette au milieu d'un monde
  dont toutes les autres frontières débordent : la cendre avait l'air POSÉE SUR le monde. En
  passant par le pavé, elle reçoit sa frange irrégulière de 2 à 5 px, son liseré, son arête et son
  ombre portée comme n'importe quel terrain — **la lisière cesse d'être une découpe et devient une
  avancée**.

- **R11ter — SA MATIÈRE EST UNE POUDRE.** Sixième famille de `grain-sol` : l'échelle la plus FINE
  de la table (1,8 — la cendre est un grain, pas des feuilles ; ce qui a brûlé n'a plus de motif)
  et des crans serrés (le sol est uniformément mort). ⚠ Son damier a dû être **divisé par deux**
  (0,085 → 0,045) après capture : tant qu'elle était peinte à une tuile par pixel, son grain ne se
  fondait dans rien et sortait en DALLES franches. *Une même valeur ne veut pas dire la même chose
  selon la résolution où on la peint.*

- **R11quater — LE DÉCOR CHANGE, IL NE DISPARAÎT PAS.** Les trois cendres ont leur entrée dans
  `BIOME_CLUTTER` : chicots, fûts calcinés, poussière — tous des props qui existaient déjà.
  Densités dégressives (bois 0,26 · pré 0,12 · minéral rien : il n'est pas traversable). ⚠ Taire
  tout décor était juste et FAUX à l'écran : le sol devenait parfaitement lisse au milieu d'un
  monde dense, ce qui se lit comme un bug d'affichage, pas comme une terre morte.

- **R11quinquies — LA CENDRE FRAÎCHE EST CHAUDE.** La couleur d'une tuile est sa teinte de famille
  tirée vers le brun du feu quand elle vient d'être prise, refroidissant sur trente jours vers le
  gris de la poussière. **Gratuit** — `ancienneteDeCendre` se recalcule, elle ne se range pas. Le
  joueur lit **où le front vient de passer** rien qu'au sol, à un écran de distance.

- **R11a — DEUX BANDES : LA FRANGE EST DE LA CENDRE, LE CŒUR RECYCLE LA CENDRIÈRE** *(décision
  d'Alexis, 2026-08-24 : « recycle les terrains de la cendrière… depuis l'extérieur vers le centre
  de la zone de corruption, sur 2-3 cases tu mets de la cendre, sinon tu utilises les mêmes
  terrains que la cendrière en trouvant une correspondance avec le terrain de t0 précédent »)*.
  **La corruption EST la Cendrière qui s'étend : elle doit en avoir la peau**, pas trois terrains
  inventés.

  | ce que c'était | frange (≤ 3 tuiles) | cœur |
  |---|---|---|
  | forêt, bois noir, pin, mélèze, saulaie | cendre de bois | **forêt brûlée** |
  | pré, fleuraie, genévriers, prairie humide, lande | cendre de pré | **cendre de pré** |
  | éboulis, chaos de blocs | cendre minérale | **chaos de blocs** |
  | roche, falaise (et `wall`, `glacier`) | cendre minérale | **roche / falaise** |
  | eau | — | — |

  **LE PRÉ RESTE DE LA CENDRE AU CŒUR** *(décision d'Alexis : « de la cendre tout simplement »)* —
  la Cendrière n'avait **aucun sol ouvert** (ses quatre terrains : forêt brûlée 52,9 %, roche
  23,0 %, chaos de blocs 17,1 %, falaise 7,1 %), et lui donner du chaos de blocs l'aurait rendu
  lent (0,6) et mensonger : la cendre n'empile pas des rochers.

  La largeur se compte **en COÛT**, donc trois tuiles de pré mais une seule de roche — juste, et
  gratuit : on sait déjà de combien le front a dépassé chaque tuile (`profondeurDeCendre`).

  ⚠ **UN PIÈGE, ATTRAPÉ DEUX FOIS PAR LA MÊME GARDE.** `estMineral` dérive de `walkable`, or le
  **chaos de blocs SE TRAVERSE** (0,6) : il n'est donc pas « minéral » à ce sens-là. La première
  table les confondait et faisait ressortir `wall` en chaos de blocs — **traversable**. Les deux
  notions sont maintenant séparées explicitement (`CAILLOUTEUX` vs `estMineral`), et la garde
  balaie le domaine entier sur LES DEUX bandes.

- **R11 — TROIS TERRAINS DE CENDRE** *(décision d'Alexis)* : **cendre de pré**, **cendre de bois**,
  **cendre minérale**. Chaque sol prend l'équivalent cendré de sa famille — on garde la lecture qui
  compte : *étais-je dans un bois ou dans un pré ?*, donc ce qu'on a perdu, et si les troncs morts
  encore debout valent le détour. L'humide (0,5 % de la vallée) se rabat sur la cendre de pré : un id
  et son art pour cinq tuiles sur mille ne se justifient pas.

  ⚠ **LA CENDRE MINÉRALE HÉRITE DE `walkable: false`.** `TERRAIN_ROCK` et `TERRAIN_CLIFF` sont
  l'anneau qui FERME la vallée ; une cendre minérale traversable ouvrirait littéralement les bords
  du monde.

- **R12 — L'EAU NE BRÛLE PAS.** La cendre prend donc **97 % de la carte** au maximum (herbeux 58,7 %,
  boisé 15,9 %, humide 0,5 %, minéral 22,3 % — l'eau, 2,7 %, est épargnée).

- **R13 — LE VIVANT MEURT LENTEMENT, LE MINÉRAL RESTE** *(décision d'Alexis)*. La cendre ne vide pas
  la case au passage — c'est très exactement le défaut de l'ancien front (`avancerLaCendre` faisait
  un `filter` sur `state.nodes` : au jour 285, **69 % des nœuds de la Racine effacés**, et rien ne les
  rendait jamais). Ici, l'arbre pris se **dessèche** sur quelques jours (le houppier se dénude — le
  rendu sait déjà le faire, `feuillageDenude`), reste **récoltable**, puis tombe en laissant une
  souche. Le minéral (roche, filon, carrière) n'est pas touché.

- **R14 — DONC LA CENDRE TIRE AUTANT QU'ELLE POUSSE.** C'est la conséquence de R13 et c'est le cœur
  du feel : la frange qui approche est une **échéance à exploiter**. Le joueur va couper dans le
  massif condamné *avant*, en sachant qu'il travaille dans une zone qui sera invivable. Les
  ~24 000 arbres que la cendre prendra à 60 % de couverture (sur 40 546) ne sont plus une perte
  sèche : ce sont des semaines de bois à aller chercher au bon moment, et une raison de rester au
  sud au lieu de simplement fuir au nord.

- **R15 — RIEN NE REPOUSSE SUR LA CENDRE, ET LA DÉRIVE N'Y VA PAS.** ⚠ Sans cette seconde clause la
  stérilité est un mensonge : un nœud de bois épuisé ne meurt pas, il **DÉRIVE** dans son bosquet
  (`relocateNode`, `recolte-vivante` D1). Non gardée, la dérive **repeuplerait la cendre** toute
  seule, un abattage à la fois. Même forme que le garde-fou qui existe déjà pour les emprises de
  village.

---

## Le verbe du joueur

- **R16 — BRÛLER UN CHARNIER FIGE SON FOYER 15 JOURS** *(décision d'Alexis ; « on proposera des
  techniques alternatives plus tard »)*. **Le verbe existe déjà** : `advanceLieuxBrules` (`morts.ts`,
  décision ⑧) — un feu libre allumé **de jour** à moins de `MORTS.BRULE_RAYON` (6) du centre d'une
  fosse la marque brûlée pour `MORTS.BRULE_DUREE_JOURS` (15) jours de saison. Il ne reste qu'à y
  brancher la cendre : **tant qu'une fosse est marquée brûlée, son foyer n'avance pas.**

  Rien n'est jamais rendu — ce qui est cendré reste cendré, la condamnation reste une PENTE. Mais
  elle devient **négociable**, ce que l'ancien front n'offrait pas. Avec 9 à 10 fosses on ne peut pas
  toutes les tenir : un aller-retour tous les 15 jours par foyer, donc en tenir trois est un métier à
  plein temps. Le joueur choisit **quel côté de sa vallée il défend** et regarde les autres avancer.

---

## Le caractère de la saison

*(décision d'Alexis, 2026-08-24 : « pose les quatre dans la spec »)*

`modificateur.ts` tire un caractère par saison, une sur trois n'en a pas, et sa doctrine est
formelle : **« il surcharge des cadrans, il n'invente rien »**. Aucun des seize ne parlait de cendre
— le seul lien qui existait était la stérilité de l'ancien cortège, partie avec lui. La cendre expose
donc **deux cadrans**, et quatre caractères existants les tournent. Aucun mécanisme neuf.

- **R17 — DEUX CADRANS, PAS UN DE PLUS.** Ils rejoignent `EffetsModificateur` :

  | cadran | effet |
  |---|---|
  | `cendre?: number` | multiplie l'avancée du jour (`VITESSE × n`) |
  | `cendreGel?: number` | multiplie la durée du gel d'un foyer brûlé (`BRULE_DUREE_JOURS × n`) |

- **R18 — LES QUATRE CARACTÈRES.** Un par saison, chacun justifié par ce que son nom dit déjà :

  | caractère | saison | effet | pourquoi |
  |---|---|---|---|
  | `reveil` | l'Éclosion | `cendre: 1.6` | *« ce qui a dormi sous la neige se lève »* — la phrase parle déjà des morts. Une année où le printemps ne soulage pas : la cendre sort des fosses avec eux. Il porte déjà `plancherMenace: 0.45` ; les deux disent la même chose. |
  | `orages_secs` | l'Ardeur | `cendreGel: 2` | Le feu prend partout : brûler une fosse la tient **trente jours**. La saison où l'on part en expédition assainir le sud. |
  | `deluge` | les Pluies | `cendre: 0.4`, `cendreGel: 0.5` | **Elle se contredit, et c'est le point.** La pluie noie la cendre — elle n'avance presque plus — mais elle empêche aussi d'allumer un feu, donc tenir un foyer devient deux fois moins efficace. **Un répit qu'on subit au lieu d'en profiter.** |
  | `hiver_noir` | le Grand Froid | `cendre: 1.4` | Cohérent avec R8 et avec `CENDREUX.TORPEUR` : le froid lève les morts, le grand froid les lève plus fort. Il porte déjà `socleDegres: -4`. |

- **R19 — L'AVANCÉE DEVIENT UNE SOMME, ET C'EST LE SEUL COÛT.** Aujourd'hui `avancée(jour)` est une
  formule fermée ; avec un multiplicateur par saison elle devient
  `R0 + Σ_{d=91..jour} VITESSE × cendre(d)`. Toujours **pure et déterministe** (le caractère est un
  `hash2` sur (tour, phase), sans état ni tirage), mais il faut la calculer par **cumul** — une somme
  préfixe mémoïsée, au patron du cache d'un jour que `modificateur.ts` porte déjà. ⚠ Ce cumul est de
  la **mémoïsation d'une fonction pure**, pas de l'état de simulation : il ne rentre pas dans le
  `SimState` et le replay n'y perd rien.

---

## Architecture — zéro octet dans le `SimState` (sauf un)

Le modèle de l'ancien front survit, et c'est ce qu'il avait de meilleur : **on ne mute pas la carte.**

    map.cendreCout[i]   coût de cheminement de la tuile à la fosse la plus proche — STATIQUE
    avancée(tick)       une fonction PURE du jour de saison (R8/R9)
    une tuile est cendrée  ⟺  cendreCout[i] ≤ avancée(tick)

Les replays retrouvent l'état exact sans qu'on ait rien sérialisé ; le client repeint en recalculant,
sans qu'on lui transmette une tuile ; `carte-immuable` reste verte ; la sauvegarde ne grossit pas.

**L'UNIQUE ÉTAT, et il n'est pas celui qu'on croyait** : `SimState.cendreAge` — **dix nombres**,
l'âge effectif de chaque foyer. Il existe parce qu'un GEL (R16) est un ACTE et non une fonction du
temps, et il porte du même coup le caractère de la saison (R18). C'est tout.

✅ **R13 N'A FINALEMENT COÛTÉ AUCUN ÉTAT** — la spec s'en inquiétait (« un état par nœud en train de
mourir »), et c'était inutile : on sait à quelle AVANCÉE une tuile tombe (`coût / (1 + grain)`), et
`avanceeDeCendre` est monotone, donc on l'inverse par dichotomie sur le cumul déjà mémoïsé. L'âge
d'une cendre se **RECALCULE** ; le monde n'a pas à se souvenir de ce qu'il a brûlé.

---

---

# La succession et le caractère — remplir le désert

*Deux décisions d'Alexis du 2026-08-27, prises l'une après l'autre à partir d'un catalogue de dix
pistes. **Statut : IMPLÉMENTÉ le 2026-08-27** (`cendre.ts`, `fumerolle.ts`, `morts.ts`, gardes dans
`cendre-succession.test.ts`). Le catalogue entier, avec les huit pistes non tranchées, vit dans
`docs/superpowers/plans/2026-08-27-ecosysteme-de-la-cendre.md`.*

## Le constat

La cendre a un sol, du clutter, des fumerolles et des charniers — et rien d'autre. **Zéro faune**
(aucun `habitat:` de `MONSTER_DEFS` ne cite un terrain cendré), **zéro flore** (R15 interdit toute
repousse, et la dérive de nœuds avec). Le désert n'est pas un oubli, c'est la lettre de la spec.
Demande d'Alexis : *« j'aimerais que la cendre remplace l'écosystème présent avant par SON
écosystème — une nouvelle zone qui se déploie au fur et à mesure de la partie »*.

R20 et R21 posent l'OSSATURE de cet écosystème et sa VARIÉTÉ. Elles n'ajoutent aucun habitant :
les colonisatrices, le charbon, le nécrophage, la fosse ouverte et les trouvailles restent au
catalogue, non tranchés — mais chacun a désormais une bande et un foyer où se poser.

---

## R20 — LA SUCCESSION : quatre bandes, et elles se comptent en TUILES

Le cœur (`profondeur > 3`) était un désert uniforme. On le coupe en trois, du bord vers la fosse :

| bande | largeur | ce qu'elle porte AUJOURD'HUI | ce qu'elle porterait |
|---|---|---|---|
| `BANDE_FRANGE` | ≤ 3 t | le terrain recyclé de R11a, les arbres en agonie (R13), l'échéance de R14, **la hantise à son plancher (R23)** | le nécrophage |
| `BANDE_NUE` | 3 → 15 t | la poudre, **le froid qui commence (R22)**, la hantise qui monte | **rien de plus — et c'est voulu** |
| `BANDE_CROUTE` | 15 → 40 t | les fumerolles, le froid et la hantise en pente | les colonisatrices, le charbon |
| `BANDE_VIEILLE` | > 40 t | les fumerolles, le sel, **le froid et la hantise à leur plafond (R22/R23)** | les trouvailles, la fosse ouverte |

**La bande nue reste vide EXPRÈS** : c'est le contraste qui fait lire les autres. Sans désert, la
richesse ne se voit pas.

### ⚠ EN TUILES ET PAS EN JOURS — c'est LA décision, et elle a été mesurée

`ancienneteDeCendre` semblait l'axe évident (« la cendre a des âges »). Mais **la loi est une
RACINE** : la frange ralentit de 1,5 tuile/jour au réveil à 0,10 à l'an 10, donc un seuil posé en
jours désigne une bande de plus en plus MINCE. MESURÉ (`tools/diag-cendre-succession.mts`,
seed 2026, largeur au front sur sol vivant) :

| jour | vitesse | bande « 5 j » | bande « 30 j » | bande « 90 j » |
|---|---|---|---|---|
| 92 (réveil) | 1,500 t/j | 1,5 | 1,5 | 1,5 |
| 240 | 0,282 | 1,4 | 8,9 | 31,2 |
| 600 | 0,153 | 0,8 | 4,6 | 14,4 |
| 1200 | 0,103 | 0,5 | **3,1** | 9,5 |

…et **sur la roche il faut diviser par `COUT_MINERAL` = 3** : une bande « 30 jours » vaut UNE
TUILE sur un massif à l'an 3, une bande « 5 jours » passe sous la tuile partout dès le jour 600.
Une succession en jours **s'éteint donc toute seule à mesure que la partie dure** — exactement
l'inverse de ce qui était demandé.

En PROFONDEUR, la largeur est stable par construction, et c'est la ZONE qui se déploie :

| jour | frange | nue | croûte | vieille | âge médian du « vieille » |
|---|---|---|---|---|---|
| **61** (ouverture) | 51,2 % | 48,8 % | 0 % | 0 % | — |
| 120 | 12,2 % | 40,8 % | 44,2 % | 2,8 % | 29 j |
| 240 | 6,1 % | 22,7 % | 36,9 % | 34,3 % | 130 j |
| 600 | 2,5 % | 9,6 % | 20,8 % | 67,1 % | 373 j |
| 1200 | 1,1 % | 4,7 % | 10,3 % | **84,0 %** | 776 j |

**Deux bandes au jour 1, les quatre dès le jour ~115, et le stade mûr passe de 3 % à 84 %.**
L'étirement de la racine tombe au bon endroit : une tuile de la bande vieille a 29 jours au j.120
et 776 au j.1200 — « mûr » veut vraiment dire mûr.

### Ce que l'âge garde, et ce qu'on lui retire

`ancienneteDeCendre` garde son **seul** métier : la CHALEUR (R11quinquies — la teinte brune qui
refroidit sur trente jours) et l'agonie des arbres (R13). C'est une température, elle se compte en
temps réel. On ne lui en demande pas plus.

*(Âge et profondeur sont d'ailleurs le même ORDRE à ~90 % près : 4,07 % de paires discordantes au
j.240 à foyers synchrones. Ce qui les sépare est le verbe du joueur — un foyer GELÉ (R16) continue
de vieillir sa cendre pendant que son front est immobile, et la discordance monte alors à 11,54 %.
Choisir la profondeur ferme cette ambiguïté.)*

### ⚠ La porte des fumerolles n'a pas bougé

`auCoeurDeLaCendre` reste à `profondeur > FRANGE_TUILES` : les fumerolles vivent toujours dans les
bandes 1, 2 et 3. Les remonter en bande 2+ défairait le resserrement ×4 demandé le 2026-08-25
(*« il n'y a pas assez de fumerolles dans les cendres »*). **Les bandes COUPENT le cœur, elles ne
le DÉPLACENT pas.**

---

## R21 — LE CARACTÈRE D'UN FOYER : les dix fosses ne rendent pas la même cendre

Les foyers étaient interchangeables. La variété reposait entièrement sur la géographie (R2), et
elle ne suffisait pas : traverser la cendre du sud ou celle du nord donnait la même chose.

**C'est le patron exact de `modificateur.ts`, doctrine comprise : *« il surcharge des cadrans, il
n'invente rien »*.** Cinq multiplicateurs sur des réglages existants, quatre caractères qui les
tournent, aucun mécanisme neuf.

### Le tirage

`hash2(index, 0, seed)` — un HACHAGE, donc **aucun tirage consommé** sur le flux du PRNG seedé (il
ne peut pas décaler un test sans rapport). Les quatre caractères vont aux quatre fosses de plus
faible hash : la vallée porte **une** Salée, **une** Gueule, **une** Muette, **une** Docile.
`PART_CARACTERE = 0,4` → quatre fosses sur dix portent un caractère, **six sont nues** (précédent
littéral de `modificateur.ts` : *« une saison sur trois n'en a pas »*). Si les dix sont spéciales,
aucune ne l'est.

MESURÉ (quatre graines) : **aucun foyer n'avale les autres** — le plus gros revendique 11 à 17 %
de la cendre, le plus petit 4 à 7 %. Un caractère touche donc toujours une part réelle de la carte.

### Les cinq cadrans

| cadran | ce qu'il multiplie |
|---|---|
| `fumerolles` | `FUMEROLLE.PART` — la part des mailles qui portent une bouche (borné à 1) |
| `sel` | `FUMEROLLE.SEL_STOCK` — ce qu'une bouche rend avant de s'épuiser |
| `morts` | le champ des morts là où SA cendre a pris (`densiteDesMorts`) |
| `froid` | `FUMEROLLE.FROID` — le souffle de ses bouches |
| `gel` | `MORTS.BRULE_DUREE_JOURS` — combien de temps un feu tient CETTE fosse (R16) |

### Les quatre caractères

| caractère | cadrans | pourquoi |
|---|---|---|
| **la Salée** | `fumerolles: 1,25` · `sel: 3` | Toutes ses mailles fument, ses bouches rendent trois fois plus de sel. Le foyer qu'on **VISITE** : la seule raison d'aller dans la cendre devient une adresse. |
| **la Gueule** | `morts: 1,6` · `fumerolles: 0,3` | Le sol y est plein de morts et ne fume presque pas : rien à y prendre, tout à y perdre. Celui qu'on **ÉVITE**, puis qu'on finit par devoir purger (R16). |
| **la Muette** | `morts: 0,5` · `froid: 1,4` | Deux fois moins de morts, un souffle plus froid. Traversable et glaçante — le contrepoint qui empêche « cendre = morts-vivants » d'être toute la lecture. |
| **la Docile** | `gel: 2` | Un feu la tient trente jours au lieu de quinze. C'est le foyer qu'on peut réellement **TENIR**, donc celui qui rend le verbe de R16 gagnant quelque part. |

⚠ **`fumerolles` NE PEUT PAS TRIPLER, et il ne faut pas faire semblant.** `FUMEROLLE.PART` vaut
déjà 0,80 : ×3 sature à 1 et ne rend que +25 % de bouches. La Salée porte donc sa promesse là où
elle a de la place — le SEL (stock 4 → 12) — et sa saturation à 1 lui donne ce qu'aucune autre
n'a : **aucune maille vide**, on y croise toujours une bouche.

### ⚠ PAS DE CADRAN `vitesse`, et c'est délibéré

Ce serait le plus évident, et il contredit **R2**, décision actée : *« ils partent tous au même
instant et avancent à la même allure ; la géographie fait toute la variété »*. Le rouvrir serait
une décision utilisateur à consigner dans `docs/decisions.md`, pas une ligne de table. Une garde
exhaustive (A22) balaie les cadrans autorisés et rougirait sur toute clé ajoutée.

### ⚠ LE CARACTÈRE EST UNE PROPRIÉTÉ DU TERRITOIRE, PAS DU FRONT

Deux lectures du foyer, et confondre les deux a produit un vrai défaut, attrapé avant livraison :

- `foyerDeLaTuile(map, tx, ty)` — **STATIQUE**, `cendreFoyer` posé au worldgen. C'est celle que
  lisent les fumerolles (part, sel, froid).
- `foyerDuSol(state, tx, ty)` — exige que le front soit PASSÉ. C'est celle que lit le champ des
  morts, qui ne doit peser que là où la cendre EST.

**Le défaut** : gater la part des fumerolles sur « la cendre est-elle arrivée » **faisait clignoter
les bouches**. Une tuile de grain positif peut être cendrée — donc porter une bouche ouverte, via
`auCoeurDeLaCendre` — alors que le seuil NU n'est pas encore franchi. Quelques jours plus tard il
l'était, le cadran d'une Gueule tombait à 0,24, `bouchePotentielle` rendait `null` : **la bouche se
refermait sous elle-même, tandis que son nœud restait posé** — rendu et froid partant chacun de
leur côté. Sur le territoire statique, aucun clignotement n'est possible (garde A24).

⚠ **Et `foyerDuSol` lit le coût NU, sans le grain.** `estCendre` déforme son seuil par quatre
`fbm2` (`grainDeCendre`, mesuré ×1,95) parce qu'une LISIÈRE doit être irrégulière. Une DENSITÉ n'a
pas de lisière : la déformer coûterait quatre bruits sur un chemin lu par tuile de la couronne de
réveil, pour un effet que personne ne peut voir. Une garde (A24) affirme que tout désaccord entre
les deux lectures tient **dans la bande de grain**, jamais ailleurs.

---

## Critères d'acceptation de R20/R21 (`cendre-succession.test.ts`)

- **A17 — Les bandes sont un ORDRE.** Seuils strictement croissants ; et sur un balayage de toute
  la carte, la tuile la plus profonde d'une bande est toujours moins profonde que la moins
  profonde de la suivante — **une seule affirmation qui ferme les quatre bandes d'un coup**.
- **A18 — Hors de la cendre, la bande vaut `HORS`** — et jamais une bande. Équivalence exacte avec
  `estCendre`, balayée.
- **A19 — La porte des fumerolles n'a pas bougé** : `auCoeurDeLaCendre` ⟺ `bande ≥ BANDE_NUE`,
  balayé sur la carte de production (et la garde exige d'avoir vu du cœur, sinon elle ne prouve
  rien).
- **A20 — La zone se DÉPLOIE.** Au jour d'ouverture, la tache initiale ne porte QUE frange et
  cendre nue ; les quatre bandes existent au jour 120 ; la part de la bande vieille **croît à
  chaque relevé** (120 → 240 → 600 → 1200) et dépasse 70 % à l'an 10.
- **A21 — Quatre fosses, quatre caractères, tous distincts**, et l'attribution BOUGE avec la
  graine (relevé sur six graines : la Salée ne tombe pas toujours sur la même fosse).
- **A22 — Aucun cadran hors de la liste autorisée**, et `vitesse` n'y est pas (R2). Balayage
  exhaustif des clés de `CARACTERES_DE_FOYER`.
- **A23 — Un cadran non tourné, une fosse nue ou hors bornes valent 1** — balayage complet des
  cinq cadrans × quatre caractères, et chaque caractère rend bien SON réglage.
- **A24 — Une bouche ouverte ne se referme JAMAIS.** L'ensemble des fumerolles éveillées ne fait
  que croître entre les jours 120, 240, 360, 600 et 1200. C'est la garde du défaut ci-dessus, et
  elle exige d'avoir vu des bouches. S'y ajoute : tout désaccord entre `foyerDuSol` et `estCendre`
  tient dans la bande de grain (`±WARP_PART`), et la garde exige d'avoir vu des désaccords.
- **A25 — La carte de PRODUCTION porte vraiment ses quatre caractères** (mémoire : une table ne
  prouve pas l'atteignabilité), chacun sur une fosse distincte.
- **A26 — Le cadran MORD.** On brûle deux fosses pour de vrai — une Docile, une nue — et on
  compare les durées de gel : le rapport vaut exactement `CARACTERES_DE_FOYER.docile.gel`. ⚠ La
  garde affirme le RAPPORT et non les deux durées : le caractère de la SAISON (R18, `cendreGel`)
  multiplie les deux de la même façon, et épingler l'absolu ferait rougir la garde le jour où le
  tirage tombe sur `orages_secs`, pour une raison qui n'a rien à voir avec ce qu'elle mesure.

**MESURÉ sur le monde joué** (`tools/diag-foyer-caractere.mts`, seed 2026, jour 600) — la preuve
que les cadrans ne sont pas une table sans lecteur :

| fosse | caractère | champ des morts | bouches | sel total |
|---|---|---|---|---|
| 2 | **gueule** | **0,3953** | **5** | 20 |
| 3 | **muette** | **0,1292** | 16 | 64 |
| 8 | **salee** | 0,2500 | **30** (le maximum) | **360** |
| 4 | **docile** | 0,2500 | 13 | 52 | *(son cadran est le gel — il se relève par A26)* |
| les six nues | — | 0,2500 | 16 à 25 | 64 à 100 |

La Gueule rend **trois fois moins de bouches** et un champ des morts **1,58×** celui d'une fosse
nue ; la Muette **0,52×** ; la Salée porte **3,6 à 5,6 fois** le sel de n'importe quelle autre.

**ET LE SEMIS N'A PAS BOUGÉ AILLEURS — prouvé, pas affirmé.** Le test de part de
`bouchePotentielle` a dû passer de `hash2 ≥ PART` à `hash2 ≥ min(1, PART × f)`, la place étant
désormais tirée AVANT (il faut connaître la fosse pour connaître `f`). À `f = 1` c'est le même
tirage — mais un commentaire ne le démontre pas. Relevé au jour 600 sur la carte de production :
**cadrans neutralisés, `toutesLesFumerolles` rend 189 bouches — exactement le compte de la
réimplémentation indépendante du semis d'origine** (`tools/diag-fumerolle.mts`, qui recopie
l'ancien `bouchePotentielle` pour pouvoir balayer `MAILLE`/`PART`). Cadrans actifs : **182**.
L'écart tient **entièrement** dans les deux fosses caractérisées — la Gueule tombe de 15 à 5, la
Salée monte de 27 à 30 et son sel de 108 à 360.

⚠ **`tools/diag-fumerolle.mts` NE VOYAIT PAS LE CARACTÈRE**, et c'est un piège d'instrument : sa
ligne « SEMIS COURANT » est une COPIE du semis, pas un appel — elle mesurait donc le semis nu en
prétendant mesurer le jeu. Elle porte désormais son avertissement et une seconde table, « LE VRAI
CHEMIN », qui appelle `toutesLesFumerolles` : l'écart (−6 à −7 bouches sur la vallée entière, du
jour 240 à l'an 10) EST l'effet des cadrans. Petit en total, grand par fosse — c'est exactement ce
qu'on veut d'un caractère : il est LOCAL.

---

## R22 / R23 — LE FROID DE LA VIEILLE CENDRE, ET LA HANTISE RÉ-ARMÉE

*Décision d'Alexis du 2026-08-27, sur la piste ⑥ du catalogue (« le cœur est déjà le territoire des
morts »), tranchée « hantise + cendre froide » contre une recommandation plus prudente. Le risque
a été énoncé avant la décision et il est chiffré plus bas.*

### La piste ⑥ disait « aucun mécanisme à écrire ». C'était faux, et c'est mesuré

⑥ tenait sur un raisonnement séduisant : les fumerolles soufflent du froid, l'éveil du Cendreux
est thermique (`CENDREUX.TORPEUR` : vue = `aggroRange × max(éveil, 0,2)`, éveil = pente de +6 °C à
−14 °C) — **donc le cœur serait déjà, par les lois en place, l'endroit où les morts voient le plus
loin.** Relevé sur le monde joué (`tools/diag-cendre-eveil.mts`, seed 2026, nuit du jour de
saison 10) :

| | frange | nue | croûte | vieille | HORS cendre |
|---|---|---|---|---|---|
| vue d'un Cendreux, avant | 2,55 | 2,54 | 2,54 | 2,55 | **2,52** |
| champ des morts, avant | 0,2481 | 0,2490 | 0,2504 | 0,2526 | **0,2501** |

**±1 % sur les deux.** Trois raisons, toutes structurelles :

1. les trois terrains cendrés ont un `BIOME_OFFSET` de **zéro** — la cendre n'était ni chaude ni
   froide ;
2. la hantise avait été **démontée le 2026-08-24** avec le front qui la datait, laissant
   `MORTS.PART_CENDRE`, `HANTISE_MAX` et `HANTISE_PART` sans lecteur (« *à reprendre avec la
   nouvelle mécanique* ») ;
3. le souffle des fumerolles, lui, mord bien (vue **×1,58** sous une bouche) — mais il ne couvre
   que **5 % du cœur** (`MAILLE` 48, `RAYON` 7, `PART` 0,80 → π·49·0,8/48²) et **0 % de la
   frange**.

### R22 — la cendre se refroidit en vieillissant

`CENDRE.FROID_COEUR` (**2 °C**) retirés à la température de base, en **rampe continue** :
**0 sur la frange**, montée linéaire, plateau à l'entrée de la bande vieille (`CROUTE_TUILES`).
C'est une EXPOSITION de plus, au même rang que la Brume, le front météo et le souffle d'une
bouche : l'abri l'amortit, le feu et la tenue la **planchent** (l'ambiant est un `max`).

- ⚠ **La frange reste à ZÉRO, et c'est la moitié de la décision.** R14 veut qu'on TRAVAILLE la
  frange, et R11quinquies dit que ce qui vient de brûler est encore **chaud**. Un froid posé au
  front aurait contredit les deux.
- ⚠ **2, et c'est LA NEIGE qui l'a décidé.** La valeur d'essai était 4. Trois bornes : les
  bouches doivent rester les PICS du cœur (garde A27 : `2 × FROID_COEUR ≤ FUMEROLLE.FROID`) ; le
  prix est GLOBAL (80 % de la carte finit en cendre) ; et surtout **le froid déplace la ligne
  pluie/neige, or le manteau est un pavé OPAQUE**. Mesuré (`tools/diag-cendre-neige.mts`, part de
  la bande vieille sous la neige au jour de saison 10) : **4 °C → 88,1 % · 3 → 79,7 % · 2 →
  18,5 % · 1 → 5,5 %**, contre 1,5 % hors cendre. À 4, l'art des trois terrains cendrés
  disparaissait sous du blanc la moitié de la saison — une décision de DA que personne n'avait
  prise. **À 2 la cendre reste le seul endroit où il neige plus qu'ailleurs** : une signature, pas
  un linceul.
- ⚠ **Il se lit sur la profondeur NUE**, sans le grain — même argument que `foyerDuSol` (R21) :
  une température n'a pas de lisière, et `baselineTemperature` est lue par entité et par tick
  dans toute la sim. Mesuré : `froidDeCendre` coûte **0,69 µs**, contre 1,87 µs pour le souffle
  et 3,32 µs pour le froid du monde entier. Dans la boucle de neige du gel (24 tranches par
  tuile), il se **hisse** avec le souffle, sous une sentinelle d'OBJET — son zéro est une valeur,
  pas une absence, donc `??=` n'y suffirait pas.

### R23 — la hantise revient, sur le même axe

Le champ des morts reçoit de nouveau son terme de cendre : `PART_CENDRE` (0,35) sur la frange,
rampe jusqu'à `HANTISE_MAX` (0,60) au plateau. **Même loi, même plafond, nouvel axe** — l'ancien
était « la part de la course du front », c'est-à-dire une profondeur, exactement ce que R20 compte
en tuiles. `HANTISE_PART` est **retirée** : son dénominateur (la course totale d'un front, 74
tuiles) n'existe plus.

**MESURÉ après branchement** (mêmes conditions, seed 2026, jour de cendre 240) :

| | frange | nue | croûte | vieille | HORS cendre |
|---|---|---|---|---|---|
| champ des morts | **0,4310** | **0,5712** | **0,7309** | **0,8194** | 0,2565 |
| vue d'un Cendreux (nuit fraîche) | 2,58 | 2,63 | 2,84 | **3,04** (×1,21) | 2,52 |
| … sous une bouche | — | — | — | **3,69** (×1,46) | — |
| froid retiré (°C) | 0,11 | 0,38 | 1,22 | **1,96** | 0 |

**9,8 % de la vieille cendre sature à 1** — ce que `HANTISE_MAX` promettait mot pour mot,
combiné au tier 2 de la Cendrière : *« le pire sol de la vallée, et il doit se sentir comme tel »*.
Le bout de la chaîne se voit : `rodeursPortes` = `ceil(plafond × densité)`, donc **dormir dans la
vieille cendre coûte plus de rôdeurs que dormir au village** (garde A29), la part de rampants suit
(`partRampante`), et l'origine d'une marche de horde est pondérée par **densité³**.

### ⚠ CE QUE ÇA COÛTE, ET IL FAUT LE DIRE

**Le monde entier finit dans la cendre.** Mesuré au jour 1200 : **19 375 tuiles marchables sur
25 197 (80 %) sont de la vieille cendre.** `FROID_COEUR` est donc, à terme, un décalage de la
vallée entière — un hiver qui ne se retire plus. C'est la deuxième raison d'avoir posé le cadran à
2 plutôt qu'à 4, et **ça reste LE bouton à tourner** si l'hiver perpétuel se révèle trop lourd.

Ce que ça donne pour un corps, sur la nuit la plus froide de la saison (jour de saison 1, 2 h),
en part de tuiles sous la ligne d'hypothermie (`AMBIANT_HYPOTHERMIE` = −10 °C) :

| | frange | nue | croûte | vieille | HORS cendre |
|---|---|---|---|---|---|
| un corps NU, avec R22 | 6,0 % | 6,9 % | 34,6 % | **81,3 %** | 6,8 % |
| le même monde sans R22 | 6,0 % | 6,1 % | 5,7 % | 5,2 % | 6,8 % |
| *(pour mémoire, à `FROID_COEUR` = 4)* | *8,5 %* | *21,7 %* | *70,3 %* | *99,2 %* | *6,9 %* |

…et sur une nuit ordinaire d'acte I (jour de saison 10) : **frange 0,3 %, vieille 1,9 %**. En été
(jour 55) : **zéro partout**. La bascule de 4 à 2 coûte donc **18 points sur la nuit la plus
froide** (99,2 → 81,3) et rend **70 points de neige** (88,1 → 18,5) : c'est ce rapport qui a
tranché.

**La règle qui en sort est nette : la vieille cendre, la nuit d'hiver, exige une tenue ou un feu.**
Et cette porte-là ne peut pas se refermer : `TENUE_FLOOR` (−5,2 °C) et `FIRE_WARMTH` (+14 °C) sont
des **planchers** appliqués par un `max` — R22 ne peut rien contre un joueur vêtu ou au feu.
Une garde (A28) l'affirme sur les constantes elles-mêmes.

### Critères d'acceptation de R22/R23 (`cendre-succession.test.ts`)

- **A27 — La rampe, balayée sur tout son domaine** (de −1 à 60 tuiles, au dixième) : 0 sur la
  frange, 1 au plateau, jamais décroissante, et **elle a un intérieur** (sans quoi une rampe
  plate passerait la garde). Plus : `2 × FROID_COEUR ≤ FUMEROLLE.FROID`.
- **A28 — Sur le monde JOUÉ** : aucune tuile de frange ne porte de froid, aucune tuile hors cendre
  non plus, le plafond tient partout — balayé, pas échantillonné, avec ses deux prémisses
  affirmées (la carte porte bien de la frange ET du cœur froid). Le désaccord nu/grain doit
  **exister** (sinon la garde ne garde rien). La température moyenne **décroît strictement** de
  bande en bande, lue sur `baselineTemperatureAt` — le branchement, pas la table. Un FAUX
  `SimState` (sans champ, sans âges — les façades du client) rend 0 et ne jette pas.
- **A29 — La hantise** : le champ monte bande après bande, borné dans ]0, 1], sature quelque part
  dans la vieille ; sur une carte NUE il vaut **exactement** son socle (`densiteDeBase`) — il
  module, il n'autorise jamais ; et `rodeursPortes` rend plus de rôdeurs dans la vieille cendre
  qu'en sol ordinaire.

---

## Critères d'acceptation

- **A1 — Le champ est statique et complet.** `map.cendreCout` couvre toute la carte, vaut `-1` (ou
  l'infini) sur l'eau et hors d'atteinte, et **ne change pas d'un bit** sur mille ticks de monde
  vivant (`carte-immuable` A1, étendue à ce champ).
- **A2 — L'avancée est une fonction pure du tick.** Deux sims au même tick, même seed, rendent le
  même ensemble de tuiles cendrées ; un replay le reproduit au bit près.
- **A3 — Le calendrier tient.** Avancée nulle avant le jour 91. **Au jour 720** (le repère a glissé
  du 2ᵉ au 6ᵉ hiver avec le ÷2 du 2026-08-25), la part de la vallée cendrée vaut 46 % ± 6 et la part
  des sites de village pris dépasse 45 %. Et le 2ᵉ hiver est devenu DOUX : moins de 25 % au jour 240
  — affirmé aussi, sinon la garde ne dirait plus rien de ce qui a changé.
- **A4 — Monotone, jamais décroissante**, balayée jour par jour sur vingt ans.
- **A5 — Aucun spawn à moins de 150 de coût d'une fosse**, sur ≥ 3 graines, et `pointsDeSpawn` en
  rend toujours autant qu'avant (le filtre ne doit pas affamer le semis).
- **A6 — Le minéral freine pour de vrai** : à distance euclidienne égale, une tuile derrière un
  massif rocheux a un coût strictement supérieur à une tuile de pré. Mesuré sur le vrai monde, pas
  sur une carte de test.
- **A7 — L'eau détourne** : il existe des tuiles dont le coût dépasse d'au moins 50 % leur distance
  euclidienne à la fosse la plus proche (la preuve que le champ n'est pas un cercle déguisé).
- **A8 — La cendre minérale bloque.** Balayage exhaustif : aucune tuile de cendre minérale n'est
  `walkable`, et l'anneau de bordure reste infranchissable après conversion.
- **A9 — Le vivant meurt, le minéral reste.** Un arbre pris par la cendre est encore récoltable
  pendant sa fenêtre de dessèchement, puis disparaît ; un `iron_vein` cendré est intact.
- **A10 — La dérive ne repeuple pas la cendre.** Cent épuisements successifs à la frange : aucun nœud
  ne se relocalise sur une tuile cendrée.
- **A11 — Brûler fige.** Une fosse marquée brûlée : son foyer n'avance pas d'une tuile pendant
  `BRULE_DUREE_JOURS`, et reprend exactement où il en était — jamais un rattrapage.
- **A12 — La tache initiale se voit et ne coûte rien.** Au jour 1, chaque fosse porte de la cendre, et
  le total tient sous 0,5 % de la vallée.
- **A13 — Le caractère module, il ne commande pas.** Une année entière de `deluge` avance MOINS
  qu'une année ordinaire, une année de `reveil` avance PLUS — et **aucune n'inverse la monotonie**
  (A4 tient sous tous les caractères, balayée sur vingt ans). Un caractère absent laisse l'avancée
  identique au bit près à la formule fermée.
- **A16 — La lisière ne fait pas de mur.** `cendre.test.ts` : sur la carte de production, à trois
  âges de foyer, **aucune arête de front parfaitement rectiligne ne dépasse 24 tuiles** et le
  nombre d'arêtes de 8 tuiles ou plus reste sous 200. La garde énonce d'abord sa prémisse — le
  même balayage sur le grain SANS déplacement (`BLOC_AMPLITUDE = 0`) doit rougir, sinon elle ne
  mesure rien. ⚠ Elle ne compte que les couples de tuiles **joignables des deux côtés** : le bord
  d'un lac est droit sur trente tuiles et n'a rien à voir avec le grain — sans ce filtre,
  l'instrument accusait le relief (les plus longues arêtes tombaient hors de la grille du grain).
- **A15 — Le front entre dans un chunk vierge.** `cendre-chunk.test.ts` : sur une carte de pré à
  une seule fosse, on cherche un couple (chunk, âge) tel que le chunk soit **vierge à l'âge N et
  entamé à N+1** ; l'ancienne règle (« porte de la cendre », relevée au pas de 4 tuiles) le laisse
  passer — la garde l'affirme —, la règle du seuil le jette. Et elle ne jette PAS un chunk que le
  front n'a pas atteint, ni un chunk dont le foyer est gelé : sans ces deux-là, « tout recuire »
  passerait la garde.
- **A14 — Le cumul ne coûte rien et ne ment pas.** `avancée(jour)` rendue par somme préfixe est égale
  au bit près à la somme naïve sur toute la fenêtre testée, et deux sims au même tick la calculent
  identiquement — quelle que soit l'ordre dans lequel les jours ont été demandés (le cache est une
  mémoïsation, pas un accumulateur).

---

## Les fumerolles — les trous du cœur (décision d'Alexis, 2026-08-24)

*« J'aimerais qu'on ajoute des fumerolles dans les biomes de cendrières. Des trous qui émettent de
la fumée froide. »* — puis, sur les quatre pistes proposées : *« ouais fais tout mon reuf »*.

Une fumerolle est un **lieu**, pas une texture. C'est ce que tout le réglage sert à tenir : on la
repère de loin, on décide d'y aller, et elle donne quelque chose. Une bouche tous les dix mètres
serait un motif de sol ; celles-ci sont espacées de plus de trente tuiles, soit **au moins un écran
entier** entre deux (l'écran en montre trente-six).

### F1 — Elles naissent DU CŒUR, jamais de la frange
Une bouche ne peut s'ouvrir que sur une tuile `auCoeurDeLaCendre` : passé la bande de frange, là où
la cendre a repris les terrains de l'ancienne Cendrière. Elles n'existent donc pas avant le réveil
de la cendre, et leur nombre croît avec elle sans jamais décroître.

### F2 — Le semis est DÉRIVÉ, il ne se stocke pas
Une maille de `FUMEROLLE.MAILLE` tuiles ; dans chaque maille, un tirage `hash2` décide s'il y a une
bouche (`PART`) et où. ⚠ **Le tirage est borné à la moitié centrale de la maille** : couru sur la
maille entière, deux bouches de mailles voisines pouvaient se coller de part et d'autre d'un bord
commun — MESURÉ à 21 tuiles d'écart, soit deux dans le même écran, soit exactement la texture qu'on
refusait. Comme la cendre elle-même, tout ceci se relit d'une fonction pure : **zéro état**.

### F3 — L'id vient de la POSITION
`idDeFumerolle` se dérive de la maille (base `2_000_000`), jamais d'un `max + 1`. Deux hôtes qui
ouvrent la même bouche lui donnent le même id sans s'être parlé, et rouvrir n'en crée pas un double.

### F4 — Elle souffle du FROID, en pente
`froidDeFumerolle` rend `FUMEROLLE.FROID` au trou et décroît continûment jusqu'à zéro à `RAYON`
tuiles. ⚠ **Deux bouches proches ne CUMULENT pas** : on prend le maximum, jamais la somme — sinon un
doublet fabriquerait un point mortel que rien n'annonce. C'est une surcharge du cadran de
température, exactement comme les autres modificateurs : elle n'invente pas de mécanisme.

### F5 — Elle est un nœud de SEL, renouvelable
`ouvrirLesFumerolles` pose un nœud `fumerolle` sur chaque bouche éveillée (jamais sur une tuile déjà
occupée). Elle donne du **sel**, se recharge — on y revient, on ne la vide pas — et elle n'est
**pas `vivant`** : la cendre qui l'entoure ne la fait pas tomber (R13). Elle n'est pas défrichable
non plus : un trou dans le sol ne se débroussaille pas.

### F6 — La Brume SORT d'une bouche
La Brume disait déjà son ancre à voix haute (*« une nappe de froid létal sort de la Cendrière »*) ;
les fumerolles sont littéralement les trous par où elle sort. Son corridor part donc d'une bouche et
**roule vers le vivant**. ⚠ **La bouche dit OÙ, jamais SI** : avant l'acte IV il n'y en a aucune, et
l'ancre de repli est le **charnier** — d'où sortira plus tard la cendre, et de la cendre les bouches.

### F7 — La fumée TOMBE
Rendu client (`fumerolle-fx.ts`), aucun état de simulation. Une fumée chaude monte et s'évase ;
celle-ci sort à peine, **retombe et rampe** au ras du sol. C'est la seule chose qui la distingue à
l'œil d'une fumée ordinaire, et elle dit la même chose que le froid qu'elle porte : *ça ne s'échappe
pas vers le ciel, ça s'accumule ici.* Quads alignés sur la grille de l'art, jamais lissés,
vacillement par l'alpha et non par la taille.

### Critères d'acceptation
- **F-A1** — Aucune bouche avant le réveil ; leur nombre croît avec la cendre et ne décroît jamais.
- **F-A2** — Chacune est `auCoeurDeLaCendre`, aucune sur la frange.
- **F-A3** — L'écart minimal entre deux bouches dépasse **30 tuiles** sur le vrai monde à l'an 7.
- **F-A4** — Deux lectures du même seed rendent exactement la même liste ; `fumerolleIci` et la liste
  disent la même chose ; `fumerollesAutour` est la restriction locale de la globale.
- **F-A5** — Les ids sont uniques et stables, dérivés de la position.
- **F-A6** — Le froid est maximal au trou, nul à `RAYON`, monotone entre les deux, et un doublet ne
  dépasse jamais `FROID`.
- **F-A7** — Ouvrir deux fois n'ajoute aucun nœud ; jamais sur une tuile occupée ; `vivant` absent.

---

## Ouvert, à trancher plus tard

- Les **techniques alternatives** pour tenir un foyer (décision d'Alexis : plus tard).
- Ce que la cendre fait au **froid**, à la **faune** et aux **Cendreux** — l'ancien cortège portait
  une bande froide et une hantise ; rien n'est décidé ici.
- L'**art** des trois terrains de cendre (couleur, grain, sol dessiné, clutter de troncs calcinés) —
  c'est les deux tiers du travail de ce chantier, largement devant la propagation.
- Si un foyer peut **naître** en cours de partie (un charnier neuf après une bataille).
- Ce que le **sel** des fumerolles sert à faire (la conservation ? le troc ?) — le nœud existe, sa
  place dans l'économie n'est pas tranchée.
- Si une fumerolle doit rester **visitable** : elle est au cœur de la cendre, donc de plus en plus
  loin du vivant à mesure que la corruption avance.
