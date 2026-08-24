# La cendre — elle sourd des fosses, et elle coule

*Source : décisions d'Alexis du 2026-08-24, prises une à une (journal ci-dessous). **Remplace le
front de cendre** retiré le même jour (`cortege-cendre.md` et `worldgen.md` §7 sont caducs). Statut :
**IMPLÉMENTÉ le 2026-08-24** — noyau `/sim` (`cendre.ts`), champ posé au worldgen, rendu client
(`cendre-layer.ts`), 26 gardes vertes dans `cendre.test.ts`. Reste l'ART des trois terrains (les
teintes en place sont des teintes de travail). Jalon : avant GATE 1.*

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

      avancée(jour) = min( R0 + A·√(jour − 91) ,  avancée(jour − 1) + 3 )      A = 13,769

  **`A` est dérivé de la contrainte d'Alexis**, pas choisi — *« il faudrait que la cendre commence à
  appliquer une pression réelle à la fin du second hiver »*, traduit en mesurable : **la moitié des
  sites de village pris**, ce qui vaut un coût de **211** (très stable : 211, 211, 205 sur trois
  graines). La fin du 2ᵉ hiver est le **jour 240**, d'où `A·√149 = 178 − 10`. ⚠ `A` a été **redérivé**
  (16,479 → 13,769) quand le champ est passé en 8-connexe et a reçu son grain : la même contrainte,
  sur une échelle de coûts qui a changé. C'est bien la contrainte qui est stable, pas le nombre.

  **LE PLAFOND DE 3 EST GRATUIT, et c'est ce qui le rend acceptable.** Sans lui, le réveil du jour 91
  serait une BOUFFÉE : la tache initiale plus que doublée en un seul jour. Avec lui, le réveil
  s'étale sur trois semaines à 3/jour — et la droite `3·t` **rejoint exactement** la courbe `A·√t`
  en `t = (A/3)² ≈ 21`. Passé ce point le plafond ne mord plus jamais : il ne déplace pas la courbe,
  il ne fait que lisser son entrée, et toute la queue est celle de la racine nue.

  **Ce que la décroissance achète, mesuré :** la vitesse tombe de 3/jour au réveil à **0,68 au jour
  240**, **0,37 à l'an 5**, **0,25 à l'an 10**. La vallée n'est donc **jamais entièrement prise** —
  il reste 18 à 27 % de terre vivante à l'an 5 et 4 à 10 % à l'an 10. *« La condamnation est une
  PENTE, pas une échéance »*, à la lettre. Sous la loi linéaire d'avant, tout était perdu à l'an 5.

  **Simulé sur le vrai monde** (seed 2026, 10 fosses, un champ de coût par foyer, personne ne touche
  aux fosses) :

  | | j.1 | fin an 1 (j.120) | **fin 2ᵉ hiver (j.240)** | fin an 3 (j.360) | an 5 (j.600) | an 7 (j.840) |
  |---|---|---|---|---|---|---|
  | vallée sous la cendre | 0,2 % | 13,7 % | **45,6 %** | 62,2 % | 80,6 % | 88,3 % |
  | sites de village pris | 1/50 | 6/50 | **25/50** | 35/50 | 46/50 | 47/50 |

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
  0,7 tuile par jour dans le pré — une tuile toutes les 45 minutes de jeu, et trois fois moins sur
  la roche. On ne voit pas la cendre bouger : on constate, en revenant deux sessions plus tard,
  qu'elle a mangé le bosquet du bas.

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
  mutée), et jette les chunks porteurs de cendre quand un âge de foyer change — au plus une fois
  par jour de saison, ~10 à 14 ms par chunk recuit (MESURÉ au navigateur).

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

## Critères d'acceptation

- **A1 — Le champ est statique et complet.** `map.cendreCout` couvre toute la carte, vaut `-1` (ou
  l'infini) sur l'eau et hors d'atteinte, et **ne change pas d'un bit** sur mille ticks de monde
  vivant (`carte-immuable` A1, étendue à ce champ).
- **A2 — L'avancée est une fonction pure du tick.** Deux sims au même tick, même seed, rendent le
  même ensemble de tuiles cendrées ; un replay le reproduit au bit près.
- **A3 — Le calendrier tient.** Avancée nulle avant le jour 91. Au jour 240, la part de la vallée
  cendrée vaut 47 % ± 5 et la part des sites de village pris dépasse 50 % — balayé sur ≥ 3 graines.
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
