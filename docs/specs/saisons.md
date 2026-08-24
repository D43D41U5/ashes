# Les saisons — quatre saisons de trente jours, une année qui tourne, un ciel par saison

*Source : décisions d'Alexis du 2026-08-23 (session « revoir la gestion des actes », sept fourches tranchées une à une). **Amende `saison-sans-fin.md`** (R2bis : l'année passe de 84 à 120 jours, `ACT_DAYS` 21 → 30) sans en changer la machinerie — `ACTS_PER_YEAR`, `tourOf`/`phaseOf` et `actLaw(paliers, pas, plafond)` sont exactement les bâtisseurs qu'il faut, livrés le 2026-08-21. **Amende `meteo.md`** (R2 : la mixture par acte devient une identité par saison ; la géométrie du front devient un réglage saisonnier), **`gel.md`** (les seuils se re-justifient sur une courbe et non plus sur une table) et l'en-tête `GEL` de `balance.ts`. Statut : **IMPLÉMENTÉ le 2026-08-23** — S1-S18 sont dans `/sim` et dans le client ; les
critères A1-A22 vivent dans `packages/sim/src/saisons.test.ts` (41 verts) et
`packages/client/src/render/teinte-saison.test.ts` (6 verts). Trois écarts assumés à la lettre
de la spec, chacun expliqué à sa règle : **S10** calcule l'aridité pour la VALLÉE et non par
point (les fronts des Pluies la couvrent entière, et ce qu'elle commande — marchabilité,
`nearWater` — est lu des milliers de fois par tick) ; **S17** est branchée sur le décor vivant
et la loi est testée, mais **le sol lui-même attend sa planche rendue** (une question de DA se
tranche à l'œil) ; **S5** voit son chiffre de 107 nuits corrigé à 87 (il datait d'avant l'été à
+26).*

## Objectif de design

L'acte cesse d'être un palier de pression qui monte et redescend jamais : **il devient une saison, et les saisons tournent**. L'année a quatre saisons de trente jours ; chacune a son ciel, sa température et son épreuve. La pression de long terme ne vient plus de l'avancée dans l'arc — elle vient du **tour** (chaque hiver revient plus dur, `actLaw.pas`) et du **front de Cendre**, qui mord chaque hiver et ne recule jamais.

Deux épreuves opposées encadrent l'année au lieu d'une seule : **la sécheresse de l'Ardeur** et **le froid du Grand Froid**. Entre les deux, deux saisons de transition qui les annoncent — l'Éclosion dégèle, les Pluies noient.

## Règles

### Le calendrier (S1-S3)

- **S1 — Quatre saisons de trente jours.** `BALANCE.ACT_DAYS` 21 → **30** ; `ACTS_PER_YEAR` reste 4, donc `YEAR_DAYS` = **120**. L'acte EST la saison : `phaseForDay` la nomme, `tourForDay` compte l'an. Aucune machinerie neuve — c'est le squelette de `saison-sans-fin.md` T2, avec une cadence changée.
- **S2 — Le monde commence le jour 51, à la fin de l'Ardeur.** Dix jours d'été finissant pour s'installer, trente jours de Pluies qui annoncent tout seuls ce qui vient, **le Grand Froid à h 30 de jeu réel** — le pacing calibré d'aujourd'hui (le Grand Froid tombait à h 31), préservé sous un calendrier quatre fois plus long. Le couplage Veillée ne bouge pas : **1 jour de saison = 1 cycle = 45 min réelles**, une année = 90 h. L'Éclosion arrive à h 52 : le printemps est la récompense d'avoir tenu, jamais le tutoriel.
- **S3 — Les noms.** Phase 1 **l'Éclosion** (printemps), 2 **l'Ardeur** (été), 3 **les Pluies** (automne), 4 **le Grand Froid** (hiver). Deux existaient déjà dans `chronicle.ts` et ne bougent pas. **« la Cendre » quitte la table des noms d'acte** : elle nomme le front, pas une saison.

### La température (S4-S6)

- **S4 — Le socle est une COURBE du jour de l'année, plus un palier par acte.** `TEMPERATURE.ACT_COLD` (une `actLaw` en escalier) est remplacée par une loi cyclique du jour de l'année : quatre cardinaux au cœur de chaque saison, **interpolation linéaire** entre eux (invariant n°2 : ni `sin` ni `cos`), et le cardinal du Grand Froid se raccorde à celui de l'Éclosion par-dessus le tour de l'an. Cardinaux (température de jour, plaine à découvert, ciel clair, en °C) :

  | | mi-Éclosion (j15) | mi-Ardeur (j45) | mi-Pluies (j75) | mi-Grand Froid (j105) |
  |---|---|---|---|---|
  | jour | **+8** | **+26** | **+8** | **−2** |
  | nuit | −2 | +20 | −2 | −16 |

  **La forme est tranchée (2026-08-23, O1 close) : l'Éclosion s'ouvre encore gelée** — +3 °C le jour, −8 la nuit — et dégèle sur ses trente jours. Le dégel EST le contenu du printemps (les gués rendent la main un à un, la neige fond, la flore repart) ; les deux variantes mesurées coûtaient soit la seconde moitié de l'hiver (pointe avancée à j95 : mi-hiver remontait à +0,5 °C), soit six jours de neige et neuf nuits de gel (mi-Éclosion à +14).
  La pente maximale entre deux jours consécutifs est de **0,6 °C** : le monde se réchauffe et se refroidit sans marche d'escalier, et « il fait plus froid en fin d'automne qu'au début » tombe de la courbe, pas d'une table.
  **⚠ BLOQUANT — le plafond d'ambiant coupe l'été à +22 °C.** `clampTemp` borne toute température du monde à `TEMPERATURE.AMBIANT_MAX` = **22** : posé tel quel, le cardinal +26 est **silencieusement rogné** et la décision « été chaud » est inerte. `AMBIANT_MAX` monte de +22 à **+30** (marge au-dessus du cardinal) — vérifié, il n'a **qu'un seul consommateur** (`clampTemp`) plus une ligne de doc, donc le changement est contenu. C'est le zéro sentinelle de la migration °C qui se rejoue, à l'autre bout de l'échelle.
  **⚠ Au-dessus de `BASE` = 18 °C la part retranchée devient NÉGATIVE.** La loi se lit comme une TEMPÉRATURE, jamais comme un froid soustrait — tout consommateur qui traite `ACT_COLD` comme une quantité positive est à reprendre (voir S13 pour le sort de `largeurDe`).

- **S5 — L'écart jour/nuit suit la saison lui aussi.** `TEMPERATURE.NIGHT_COLD` cesse d'être la constante 12 : **6 °C au cœur de l'Ardeur, 14 au cœur du Grand Froid**, même interpolation. *Pourquoi c'est un mécanisme et pas un raffinement — **et le chiffre a été refait à l'implémentation.** Les « 107 nuits sur 120 » avaient été mesurées sur la courbe d'AVANT que l'été monte à +26 (Q2 a changé la donne entre-temps). Sur le socle final, un écart fixe de 12 °C donne **87 nuits neigeuses contre 77** avec la courbe : l'écart de compte s'est réduit. Ce que la courbe achète, mesuré, se dit donc en degrés : **six de plus sur les nuits d'Ardeur** (+20 au lieu de +14), **deux de moins sur celles du cœur de l'hiver** (−16 au lieu de −14). L'été respire, l'hiver mord — et l'Ardeur ne voit toujours pas un flocon.*

- **S6 — La nuit s'allonge en hiver.** `BALANCE.CYCLE_DAY_FRACTION` cesse d'être la constante 0,625 : **0,72 au cœur de l'Ardeur, 0,48 au cœur du Grand Froid**, 0,625 pile aux équinoxes (la valeur d'aujourd'hui, donc la moyenne annuelle ne bouge pas). La nuit réelle passe de **12,6 min l'été à 23,4 min l'hiver**. La nuit étant la fenêtre de danger (chasse nocturne, hordes, le froid qui mord), les deux pressions s'additionnent là où c'est voulu.
  **⚠ `DAY_TICKS_PER_CYCLE` cesse d'être une constante** et devient une fonction du cycle. Une dizaine de sites testent le crépuscule par **égalité exacte** (`cycleTick === DAY_TICKS_PER_CYCLE` : annonce de la Brume, planification des hordes, crépuscule des villages PNJ, annonce du blizzard) — rater l'égalité, c'est perdre l'événement en silence.

### Le ciel de chaque saison (S7-S9)

- **S7 — Une identité météo par saison, portée par la GÉOMÉTRIE du front.** La mixture par acte de `meteo.md` R2 devient une table par phase, et la largeur comme la fenêtre du front deviennent des réglages saisonniers — pas seulement la fréquence. Ordres de grandeur, à calibrer :

  | saison | fronts | classes dominantes | largeur | fenêtre | sur un point |
  |---|---|---|---|---|---|
  | l'Éclosion | ~1 cycle sur 2 | pluie, brouillard du matin | ~120 | ½ cycle | 2 min — averses et giboulées |
  | l'Ardeur | ~1 sur 3 | **orage sec**, pluie rare | ~60 | ½ cycle | 1 min — la foudre sans l'eau |
  | les Pluies | **2 sur 3** | pluie, brouillard épais | **~4500** | **1 cycle** | **33-38 min** — la journée entière |
  | le Grand Froid | ~3 sur 4 | pluie (→ neige), orage (→ blizzard) | 800 / 1600 | ¾ cycle | 10-25 min |

  **La largeur cesse d'être commandée par le froid.** `meteo.md` R13 (`largeurDe` : la largeur de l'orage interpole sur `ACT_COLD(acte) / ACT_COLD.plafond`) est **retirée, pas bordée** — S7 la remplace par une table par saison, et il ne reste plus de division par un plafond à protéger. Le « carte entière » du blizzard reste un calibrage de la table du Grand Froid, comme R13 le voulait déjà.
  **CE QUI FAIT TAIRE LE GIBIER, C'EST LA VIOLENCE, PAS L'HUMIDITÉ** (décision d'Alexis, 2026-08-23) : seuls **l'orage et le blizzard** terrent la faune ; la pluie et la neige ne la taisent plus.
  **⚠ `QUIET` doit donc se lire sur l'ASPECT, pas sur la CLASSE** — la neige d'hiver EST la classe `pluie` (elle se dérive au point, `meteo.md` R11), si bien qu'un booléen keyé par classe commande les deux saisons d'un coup : basculer `QUIET.pluie` pour libérer l'automne libérerait aussi la neige, sans que rien ne le dise. La table se réénonce sur les quatre aspects (`pluie`, `neige`, `orage`, `blizzard`) — la dérivation existe déjà, il n'y a rien à inventer.
  **⚠ Et le même piège vaut pour les quatre autres tables d'effet.** `MOUILLE`, `FEU_CONSO`, `SPEED`, `VISION` sont keyées par CLASSE : l'orage sec de l'Ardeur (ci-dessous) n'y est pas exprimable, puisque `orage` est une seule clé qui doit être sèche en été et mouillée aux Pluies. Ces tables se lisent donc par **(aspect, phase)** — une fonction pure de plus, `front.day` portant déjà la phase ; aucun état, aucun tirage. Sans cette ligne, un implémenteur bascule un booléen et change trois saisons en silence.
  Mesuré : un front des Pluies couvre la carte ENTIÈRE (bande de 4500 sur une carte de 1581) ~35 min sur 45, et à deux jours sur trois c'est **52 % de la saison sans une seule naissance ambiante, partout, juste avant l'hiver**. Le silence du gibier avait été calibré pour une averse de 90 s balayant 60 tuiles ; appliqué à un ciel qui couvre la vallée douze heures, il ne dit plus la même chose. Le gibier de l'automne se raréfie par l'autre bout, celui qui a du sens : on voit moins loin (vision 0,85) et on marche moins vite.
  L'**orage sec** de l'Ardeur n'est pas un type neuf : c'est un orage dont `MOUILLE` est faux et `FEU_CONSO` vaut 1 — il tonne, il frappe, il n'éteint rien et il ne mouille pas. La neige et le blizzard restent **dérivés** (`meteo.md` R11-R13) : rien à élire, la courbe S4 s'en charge.

- **S8 — La pluie qui dure est une bande large et lente.** « Il pleut toute la journée » ne demande **aucun mécanisme neuf** : une bande beaucoup plus large que la carte, dont la fenêtre occupe le cycle entier, couvre un point 33 à 38 min sur 45, avec une entrée et une sortie en pente (le ciel se couvre, puis se dégage). C'est exactement ce que `largeurDe` fait déjà pour le blizzard d'acte III. L'unicité du front (`meteo.ts` : « UN SEUL FRONT ACTIF, PAR CONSTRUCTION ») tient, le rembobinage de `neigeAuSol` tient, le contrat de replay tient.
  *Écartés, et pourquoi : une couche « ciel du jour » séparée aurait donné deux surfaces de lecture là où `meteoIntensity` est LA surface unique dont dépendent R4-R8 ; un train de fronts concurrents aurait fait de `state.meteo` une liste, cassé la fenêtre-dans-son-cycle et le rembobinage.*

- **S9 — Les séries de jours se font par ÉPISODES.** Un `hash2` sur l'**index d'épisode** (et non sur le cycle) élit une perturbation qui court sur **2 à 5 cycles consécutifs** ; à l'intérieur, chaque cycle porte son front. Début et fin nets, durée bornée, annonçable la veille comme le blizzard. Pur, O(1), **zéro état ajouté au `SimState`** et zéro tirage sur le PRNG. La saison règle la fréquence des épisodes et leur longueur (**les Pluies : 2 à 4 jours, deux jours de pluie sur trois — vingt sur les trente de la saison, 11 h 40 sous l'eau ; l'Ardeur : 1 jour, rarement 2**).
  *Écartés : la chance saisonnière seule donne des séries géométriques sans début ni fin annoncés ; une chaîne de Markov rend l'état récursif — il faudrait le stocker (contrat de sauvegarde et de replay) ou le recalculer depuis le cycle 0 à chaque appel, or `neigeAuSol` rembobine.*

### La sécheresse (S10)

- **S10 — LE NIVEAU D'EAU EST UN SCALAIRE SIGNÉ, dont la sécheresse et la crue sont les deux bouts** (unification décidée le 2026-08-23, quand Alexis a demandé que la Crue de S18 monte pour de vrai). **Négatif** : l'eau peu profonde se comporte comme de la terre — les mares partent, les gués deviennent poussière (la sécheresse de l'Ardeur). **Zéro** : la carte telle qu'elle est générée. **Positif** : l'eau peu profonde se comporte comme de l'eau PROFONDE — les gués sont infranchissables — et toute tuile de terre à **`d ≤ niveau`** d'une eau devient de l'eau peu profonde : l'eau monte, s'étale depuis les rives, et redescend quand la crue passe. Un seul mécanisme, deux signes, et le patron reste celui de `gel.ts` (un état de tuile dérivé, jamais une tuile qui bouge).
  **Le `d` est un champ de distance à l'eau calculé UNE FOIS au worldgen** : `eroderMasque` (`profondeur.ts`) est exactement ce BFS multi-source, déjà écrit, **déterministe par construction**, déjà utilisé pour les massifs. Coût : un `Uint8Array` de la taille de la carte (~1,4 Mo, plafonné à huit tuiles) rangé à côté de `cendreMax`, plus un terrain virtuel de rendu dans `paves.ts` — le même emplacement que `GLACE_*` occupe pour la glace.
  **Conséquence heureuse : la crue NOURRIT le gibier.** `nearWater` compte une tuile inondée comme de l'eau, donc les coins de chasse s'étendent avec la montée — l'Éclosion inondée est pénible à traverser et généreuse à chasser. C'est ce qui en fait un caractère de saison plutôt qu'une gêne.
  **Le côté sec, lui, copie `neigeAuSol`, pas `estGele`.** L'ARIDITÉ S'ACCUMULE : un indice par point qui **monte avec la chaleur et retombe à chaque front mouillé**, recalculé en rembobinant les derniers cycles — la machinerie déjà écrite et testée pour la neige au sol, prise à l'autre bout de l'échelle. Une mare ne s'assèche donc pas parce qu'il est midi, elle s'assèche **après plusieurs jours sans pluie**, et le premier orage mouillé la rend. L'eau devient une lecture du temps qu'il a FAIT, jamais du thermomètre de l'instant — c'est ce qui branche vraiment la carte sur la météo. *(Écarté : le seuil de température nu, miroir littéral d'`estGele` — la mare aurait séché à midi et serait revenue la nuit, et la pluie n'y aurait rien changé ; écarté aussi le pur calendrier, où il peut pleuvoir trois jours sans qu'une mare se remplisse.)* **⚠ ET IL SE RÉSOUT UNE FOIS PAR CYCLE, PAS PAR TUILE ET PAR TICK.** `neigeAuSol` peut se permettre son rembobinage parce qu'elle est « PUREMENT VISUELLE au v1 » plus une lecture dans `moveAvatar` ; l'aridité, elle, commande la **marchabilité** et `nearWater` — donc la collision, le pathfinding, les champs de flux et le gate de naissance de la faune l'interrogeraient des milliers de fois par tick. L'indice se résout **une fois par cycle** (par zone ou par chunk), se range dans la couche d'état dérivé, et son coût se **mesure avant** d'être livré (`tools/empreinte-sim.mts`, patron des chantiers de `/sim`). Le patron de `gel.ts` — « le monde change d'état avec sa température, sans qu'une tuile ne bouge », seuil + hystérésis + dérivation pure — s'applique ensuite à l'indice pour l'autre extrême : au cœur de l'Ardeur, **les mares s'assèchent, les gués deviennent poussière, les lacs baissent**. Et la cueillette cesse de repousser (`SEASON.REGROW_ACT_FACTOR`, déjà une loi par saison). Aucun sous-système neuf ; les conséquences arrivent par les systèmes en place — le gibier exige `nearWater`, donc il se replie sur ce qui reste d'eau, et les points d'eau deviennent des coins de chasse disputés ; la pêche se resserre.
  **⚠ Garde-fou non négociable : l'eau PROFONDE ne s'assèche jamais.** Mesuré ailleurs (« l'eau commande la faune ») : une zone sèche porte zéro gibier. Si toutes les mares partent, la faune quitte la carte et l'été « facile » devient une famine silencieuse. Un plancher, comme le gel a le sien.
  *Écartés : la propagation du feu dans l'herbe sèche (système entièrement neuf, et le monde qui brûle est déjà le métier de la Cendre) ; la soif (une vitale de plus, qui punirait les quatre saisons pour n'en caractériser qu'une).*

### Ce qui suit sans décision neuve (S11-S12)

- **S11 — La morsure de la Cendre se recale sur le Grand Froid.** `saison-sans-fin.md` R8 dit déjà « il mord l'hiver, tient l'été » : la fenêtre passe de j21-60 (de l'année de 84) à **j91-120**, et l'an 1 garde sa course calibrée — une PART de `cendreMax`, jamais une distance écrite.
- **S12 — L'HIVER S'ÉLARGIT, IL NE S'ENFONCE PAS** (décision du 2026-08-23, qui répond à O3 de `saison-sans-fin.md` pour le climat). Chaque année, les cardinaux des **Pluies et de l'Éclosion glissent d'un ou deux degrés vers l'hiver** ; le cœur du Grand Froid, lui, ne bouge pas. Ce qui monte est le NOMBRE DE JOURS sous les seuils : plus de nuits à chauffer, plus de jours où l'eau est prise, une fenêtre de récolte qui se referme. L'un mange le temps, le front de Cendre mange l'espace.
  **La borne du glissement est la pente, et elle se dérive de A2.** Le tronçon le plus raide de la courbe va de mi-Ardeur (+26) à mi-Pluies (+8) : 0,6 °C/jour aujourd'hui. Chaque degré que les Pluies perdent le raidit ; **à −4 °C il atteindrait exactement 1,0 °C/jour, la limite de A2** — au-delà, la courbe se lit comme une marche et non plus comme une saison. Le glissement s'arrête donc **au cœur de l'hiver lui-même** : les Pluies plafonnent à **−2** (pente 0,93 °C/jour). *La première borne posée était −3, et la garde A14 l'a attrapée à l'implémentation : à l'an 7, le point le plus froid de l'année quittait l'hiver pour la fin de l'automne — l'année s'ENFONÇAIT au lieu de s'élargir, l'exact contraire de ce que S12 promet. Le plancher est donc le cœur de l'hiver, pas un degré sous la limite de pente.* Et l'Éclosion **jamais sous le cœur du Grand Froid** (sinon la forme de l'année s'inverse et tout le document s'écroule). À deux degrés par an, l'escalade climatique sature vers l'an 6 — après quoi ce sont les lois vivantes et le front de Cendre qui portent seuls la montée, ce qui est exactement le rôle du `plafond` d'`actLaw`.
  *Pourquoi pas « plus froid » — mesuré, trois planchers l'interdisent :* `AMBIANT_MIN` borne le monde à **−18 °C**, le corps nu touche son fond (25 °C) exactement là, et surtout `ambient = max(ambient, TENUE_FLOOR)` **plancher le ressenti à −5,2 °C dès qu'on porte une tenue d'hiver**. La nuit de mi-hiver est déjà à −16 : descendre le cardinal année après année ne changerait **rien** pour un joueur habillé, et rien pour personne sous −18. La branche « la tenue cesse de suffire » (faire descendre `TENUE_FLOOR` par tour) reste possible plus tard, mais elle exige que la parade suivante existe — sinon l'an 3 est un mur.

### Les lois de pression (S13)

- **S13 — LES DIX LOIS SE REPHASENT, ET C'EST LE PIÈGE PRINCIPAL DE LA REFONTE.** `actTable` indexe ses paliers par `phaseOf(acte)` — renommer les phases sans réécrire les paliers **décale toute la pression d'un cran**. Relevé : neuf lois portent aujourd'hui **trois** paliers (le quatrième hérite du troisième), écrits pour l'ancien ordre Éclosion → Grand Froid → Cendre. Posées telles quelles sous S3 :
  - `BRUME.CHANCE_PER_DAY: actLaw([0, 0.35, 0.5])` → **35 % par jour d'une nappe à −22 °C en plein été.** La Brume est un mécanisme de froid : elle doit lire **0 en l'Ardeur**.
  - `ACT_HUNGER_FACTOR: actLaw([1, 2, 3])` → la faim culmine aux Pluies et le Grand Froid ne fait que la tenir.
  - même décalage pour `NIGHT_HUNT.CHANCE_PER_MIN`, `FIRE_UPKEEP.ACT_FACTOR`, `ALIGNMENT.ACT_FACTOR`, `SEASON.REGROW_ACT_FACTOR`, `CENDREUX.CONVERGE_TILES`, `METEO.CHANCE_PER_CYCLE`, et `TEMPERATURE.ACT_COLD` (que S4 remplace de toute façon).

  **Chaque `actLaw`/`actTable` reçoit donc QUATRE paliers explicites, réordonnés sur l'Éclosion / l'Ardeur / les Pluies / le Grand Froid** — aucune loi ne laisse plus le quatrième hériter du troisième. Sans S13, les décisions S1-S12 sont posées sur une pression qui a glissé d'une saison, et rien ne le dirait.

  **La forme est tranchée (2026-08-23) : LA PRESSION SUIT LE FROID.** Minimum à l'Ardeur, maximum au Grand Froid, les transitions entre les deux — l'ancien palier I devient l'Ardeur, l'ancien palier III le Grand Froid, ce qui préserve les valeurs calibrées :

  | loi | l'Éclosion | l'Ardeur | les Pluies | le Grand Froid |
  |---|---|---|---|---|
  | `ACT_HUNGER_FACTOR` | 1 | 1 | 2 | 3 |
  | `SEASON.REGROW_ACT_FACTOR` *(lenteur)* | **1** | **2** | 1,5 | 3 |
  | `FIRE_UPKEEP.ACT_FACTOR` | 1 | 1 | 1,5 | 2 |
  | `ALIGNMENT.ACT_FACTOR` | 1 | 1 | 2 | 3 |
  | `NIGHT_HUNT.CHANCE_PER_MIN` | 0,12 | 0,12 | 0,3 | 0,55 |
  | `BRUME.CHANCE_PER_DAY` | 0 | 0 | 0,35 | 0,5 |
  | `CENDREUX.CONVERGE_TILES` | 20 | 20 | 80 | 10 000 |

  **Une seule ligne s'écarte de la règle, et S10 l'impose** : la repousse est aussi lente à l'Ardeur qu'aux Pluies — la sécheresse arrête ce que le froid arrêtera. L'Éclosion devient le seul vrai répit de l'année.
  *Pourquoi la faim ne monte PAS à l'Ardeur : la sécheresse mord déjà par ses propres mécanismes (l'eau qui recule, la repousse arrêtée, le gibier qui se replie). Lui ajouter un multiplicateur de faim compterait la même pression deux fois — et l'été deviendrait aussi dur que l'hiver sans en offrir aucune des parades (le feu, la tenue, le lac qui porte).*

### Ce que l'année qui tourne oblige à rendre réversible (S14-S16)

*Deux mécanismes ont été écrits pour un arc à SENS UNIQUE et cassent net sous un calendrier qui boucle. Relevé dans le code, pas supposé.*

- **S14 — LES FEUILLES REPOUSSENT.** `feuillageDenude` vaut aujourd'hui `seasonDay >= jourDeDefeuillaison(tuile)` : monotone par construction, et le commentaire l'assume (« une feuille qui tombe ne remonte pas »). Sous une année qui boucle, **la forêt est nue à partir du jour 28 et le reste à jamais** — an 2, an 5, an 10. La clé devient le **jour DE L'ANNÉE** : défeuillaison sur une fenêtre de la fin des Pluies (décalée par tuile, `hash2`, comme aujourd'hui), refeuillaison sur une fenêtre de l'Éclosion. **La clé reste le jour, jamais la température** — c'est le défaut que `feuillageDenude` documente avoir refusé (keyée sur le froid, la forêt repoussait ses feuilles à chaque aube et les reperdait à chaque crépuscule) ; le jour de l'année est monotone à l'intérieur d'une année, donc la propriété tient, saison par saison.
- **S15 — LES SEPT RAMPES DE MENACE RESPIRENT, AVEC UN PLANCHER QUI MONTE** (décision d'Alexis, 2026-08-23). `seasonRamp(debut, fin, jour)` est **clampée à `SEASON_DAYS` = 60** et sert sept quantités : taille de horde, chance de horde, population de Cendreux, leur cri, les morts-vivants de la chasse nocturne, le cap de fréquentation des lieux. Sous un calendrier de 120 jours, elles atteignent toutes leur maximum **au milieu de l'Ardeur de l'an 1** et n'en redescendent plus jamais — hordes pleines chaque nuit, dès le premier été, pour toujours. Elles se réénoncent donc sur le **jour de l'année** (basse à l'Éclosion, haute au Grand Froid) **plus un socle par tour** : l'été de l'an 3 est plus dur que celui de l'an 1 mais reste un été. C'est l'arc oscillant d'`actLaw` étendu aux rampes — la même forme, deux familles de lois.
- **S16 — UNE PLANTE PAR SAISON, ET UNE FENÊTRE DE SEMIS** (décision d'Alexis, 2026-08-23 : « il faudra des plantes spécifiques pour chaque saison », puis « une fenêtre de semis par plante »). Le potager ne souffre PAS de la sécheresse : c'est **la parade constructible** de l'Ardeur, quand la cueillette sauvage s'arrête, que les mares partent et que le gibier se replie (doctrine R5 de `saison-sans-fin.md` : on rattrape en bâtissant). Ce qui change, c'est **ce qu'on peut semer** : chaque graine ne germe que dans sa fenêtre ; semée hors fenêtre elle **reste en terre sans germer** — jamais perdue, elle attend son heure. Lisible sans être punitif, et ça force à garder des graines d'une saison sur l'autre. **La serre affranchit de la fenêtre** — c'est enfin ce qui la justifie.
  Le catalogue (contenu à écrire — aujourd'hui il n'existe **qu'une** culture, `graine` → `legume`) : un vert d'Éclosion rapide et périssable ; un fruit d'Ardeur qui tient la sécheresse ; **un tubercule des Pluies qui se conserve tout l'hiver**, le seul à échapper à la péremption ; sous serre, une culture lente et maigre. La table `SPOIL_CYCLES` fait alors seule toute la tension : ce qu'on sème à l'automne est ce qu'on mangera au cœur du Grand Froid. Le garde-fou du GDD §8bis tient — le potager reste « sûr, renouvelable, MÉDIOCRE » : il nourrit une saison, il ne remplace jamais la chasse.

### Ce que ça donne à l'écran (S17)

- **S17 — UNE TEINTE SAISONNIÈRE CONTINUE, PAS DES TUILES NEUVES** (décision d'Alexis, 2026-08-23). Aujourd'hui trois choses seulement changent à l'écran avec le froid — le manteau de neige, la glace, les feuillus dénudés — donc l'Éclosion et l'Ardeur se ressembleraient trait pour trait. La palette des terrains **vivants** (herbe, feuillage, sous-bois, lande) glisse sur **la même courbe que la température** : vert tendre à l'Éclosion, vert profond puis jauni à l'Ardeur, roux aux Pluies, gris-brun au Grand Froid. Aucune tuile nouvelle, aucun asset quadruplé juste après la refonte du sol (2+4, organique + pavés autotile) ; les états déjà mécaniques portent le reste, et **l'automne roussit progressivement au lieu de basculer un matin**. La teinte se tranche **sur une planche rendue des quatre saisons sur la même vue**, jamais sur une description.
  **⚠ ET C'EST UN FONDU, PAS UNE MULTIPLICATION — la planche l'a tranché en une image.** La
  première loi multipliait la couleur de l'art par canal ; rendue, elle donnait un automne
  OLIVE et un hiver qui ressemblait au printemps. Un multiplicateur ne peut pas inventer une
  couleur que l'art n'a pas : appliqué à un sol vert (#3e7d3a) et à une forêt verte (#2c5a2e),
  il ne rend jamais qu'un vert plus sombre. La loi fond donc la couleur vers une CIBLE avec une
  FORCE (0,30 à l'Éclosion, 0,34 à l'Ardeur, 0,55 aux Pluies et au Grand Froid) : l'automne
  roussit pour de vrai, et comme la force n'atteint jamais 1, **la forêt reste plus sombre que
  son pré à toutes les saisons** — c'est ce qui distingue une saison d'un filtre posé sur
  l'écran. *(`tools/planche-saisons.mts` rend les quatre panneaux sur la même vue : c'est
  l'instrument de cette décision, et il reste là pour la prochaine.)*
  **⚠ La teinte est une PASSE, pas une cuisson.** `render/manteau.ts` peint par chunks à signature, recuits seulement quand la signature change — 9 à 20 ms par recuisson, mesuré. Une teinte qui glisse chaque jour changerait l'apparence de **tous** les chunks **tous les jours** : appliquée dans la cuisson, elle transforme un lerp de palette en chantier de rendu. Elle s'applique donc **en aval du bake**, comme une teinte de rendu sur les couches déjà cuites, et la signature de chunk ne la connaît pas.
  **⚠ Partage explicite avec S14, sinon les deux se battent sur un feuillu** : la **teinte** commande la COULEUR (elle roussit tout le feuillage en pente, globalement), `feuillageDenude` commande la **silhouette et le couvert** (l'arbre nu, par tuile, à sa date jittée). Un feuillu de mi-Pluies est donc roux ET encore feuillu ; il devient nu quand sa date tombe, pas quand la teinte change.

### Le modificateur de saison (S18)

- **S18 — CHAQUE SAISON TIRE UN CARACTÈRE, ET UNE SUR TROIS N'EN A PAS** (décision d'Alexis, 2026-08-23). Au bord de saison, `modificateurDeSaison(tour, phase)` élit un modificateur qui tient toute la saison : un `hash2` sur un canal dédié, **fonction pure du tour et de la phase** — zéro état dans le `SimState`, zéro tirage sur le PRNG (patron exact de l'élection météo), donc relisible en avant comme en arrière et gratuit pour le replay. **Le tirage inclut « rien », avec un tiers du poids** : un modificateur ne se remarque que s'il existe des saisons sans, et la calibration de base (S1-S17) doit pouvoir se jouer telle quelle, sinon on ne saura jamais ce qu'elle vaut. Il ne se répète pas deux tours de suite (exclusion du tirage précédent — dérivable, donc pure).
  **Il SURCHARGE des cadrans existants, il n'invente rien** (doctrine `meteo.md` : la météo module, elle ne crée pas de mécanique parallèle), et il **se compose** avec S12 et S15 : il décale ou multiplie la valeur de l'année, il ne la remplace pas — l'Hiver noir de l'an 5 est plus dur que celui de l'an 1. **La chronique le nomme au premier jour** de la saison (patron du nom de saison, une ligne) ; le HUD ne le dit pas (Q16 : le monde le dit, l'interface non).

  **l'Éclosion**

  | nom | cadran surchargé | ce que ça fait |
  |---|---|---|
  | **Les Gelées tardives** | décalage de la courbe S4 | le froid de l'hiver tient quinze jours de plus : les semis de plein air meurent, le dégel des gués recule |
  | **La Crue** | le niveau d'eau S10, pris en POSITIF | la fonte gonfle les eaux : **les gués deviennent infranchissables** et l'eau s'étale depuis les rives — des passages se ferment, et les coins de chasse s'étendent avec elle |
  | **La Grande Levée** *(bon)* | `REGROW_ACT_FACTOR`, quotas de naissance | repousse doublée, mises bas précoces — l'année où l'on refait ses stocks |
  | **Le Réveil** | plancher des rampes S15 | ce qui a dormi sous la neige se lève : les Cendreux sortent dès le printemps |

  **l'Ardeur**

  | nom | cadran surchargé | ce que ça fait |
  |---|---|---|
  | **La Canicule** | courbe S4 +4 °C, vitesse d'aridité | les mares partent dès le premier tiers de la saison |
  | **Les Orages secs** | `FOUDRE_PAR_MIN` ×3, `MOUILLE` faux partout | le ciel cogne et **la sécheresse ne casse jamais** — aucun front mouillé de la saison |
  | **L'Été pourri** *(mitigé)* | la mixture des Pluies appliquée à l'été | il pleut, il ne fait pas chaud : pas de sécheresse, mais la fenêtre de semis se ferme tôt |
  | **La Nuée** | `SPOIL_CYCLES` ÷2 | plus rien ne se garde frais : on fume, on sale, on cuit — ou on jette |

  **les Pluies**

  | nom | cadran surchargé | ce que ça fait |
  |---|---|---|
  | **Le Déluge** | densité S7 à 4/5, épisodes de 4 à 6 | le feu dévore son bois, on voit à dix pas : la saison se passe à l'abri |
  | **L'Été indien** *(bon)* | décalage de la courbe S4 | quinze jours de douceur en plus : la fenêtre de semis s'allonge, la première gelée recule |
  | **La Rouille** | `SPOIL_CYCLES`, rendement de cueillette | les réserves tournent et la cueillette rend moins : on entre dans l'hiver avec ce qu'on a fumé |
  | **Le Brame** | `chargeChance` du cerf, perception | les cerfs s'appellent — repérables de loin, et les mâles **chargent** au lieu de fuir : la chasse paie gros et blesse vite |

  **le Grand Froid**

  | nom | cadran surchargé | ce que ça fait |
  |---|---|---|
  | **L'Hiver noir** | courbe S4 −4 °C | les lacs prennent tôt et longtemps : **la carte change de forme**, les hordes traversent là où l'eau protégeait |
  | **Les Grandes Neiges** | `FONTE_CYCLES` ×3 | le manteau atteint les genoux partout : on marche au ralenti, la chasse devient du pistage |
  | **La Disette** | plafond de faune | le gibier a manqué : c'est l'hiver qui punit l'automne |
  | **La Meute** | rampes de horde S15, plancher | hordes plus grosses et plus fréquentes : l'hiver où l'on tient un mur au lieu de chasser |

  **Les seize tiennent sur des cadrans existants** depuis que S10 est devenu un niveau signé : `La Crue` n'est plus une exception, c'est l'autre bout de la sécheresse. *(Trois idées ont été écartées à la vérification : « les orages secs mettent le feu » — le feu ne se propage pas, `fire.ts` ne connaît que la consommation d'un foyer ; et « la foudre embrase les structures » — `foudre.ts` ne frappe que les corps, et l'abri annule l'impact ; et « la Route », les convois d'automne, remplacée par le Brame à la demande d'Alexis.)*

## Critères d'acceptation

- **A1 — Le calendrier.** `actForDay` reste monotone non bornée ; 30 jours par acte ; `phaseForDay` cycle 1→4→1. Jour 51 → l'Ardeur ; jour 91 → le Grand Froid ; jour 121 → l'Éclosion de l'an 2.
- **A2 — La courbe est continue, et cyclique À TOUR FIXÉ.** Balayée jour par jour : `|T(j+1) − T(j)| ≤ 1 °C` partout, **y compris au passage j120 → j121**. La cyclicité s'énonce **à tour figé** — `T(j + 120) === T(j)` **pour le même tour**, et pas d'une année sur l'autre : S12 fait glisser les cardinaux voisins chaque tour, donc deux années consécutives ne sont volontairement PAS identiques. Une garde écrite sans ce « à tour fixé » échouerait dès l'an 2 en contredisant S12 et A14.
- **A3 — L'Ardeur ne voit pas un flocon, le Grand Froid ne voit que ça.** Aucune nuit entre j31 et j60 ne passe sous le seuil de neige ; toutes les nuits entre j100 et j110 y sont. *(La garde de S5 se dit en DEGRÉS et non en compte — voir S5, dont le chiffre de 107 a été corrigé à l'implémentation : la courbe donne six degrés de plus aux nuits d'Ardeur et deux de moins à celles du cœur de l'hiver.)*
- **A4 — L'eau prend tard et lisiblement.** Les gués gèlent la nuit sur une fenêtre CONTINUE autour du Grand Froid (~j73 → j17) ; les lacs seulement en son cœur (~j93 → j117) ; ni l'un ni l'autre pendant l'Ardeur. Les seuils de `GEL` se re-justifient **contre la courbe** — l'en-tête de `balance.ts` affirme aujourd'hui qu'aucun seuil ne tombe sur une valeur atteinte par la table ; une courbe continue atteint TOUTES les valeurs de son domaine, la garde doit donc se réénoncer en « à quel MOMENT de l'année », jamais en « à quelle valeur ».
- **A5 — Les épisodes existent et sont bornés.** Sur les trente jours des Pluies : au moins une série de ≥ 3 cycles consécutifs à front. Et **tout épisode tient dans la fourchette de sa saison** — c'est la borne qui compte, et non une longueur de SÉRIE : deux épisodes de blocs voisins peuvent se toucher, si bien qu'une série observée peut dépasser la fourchette sans qu'aucun épisode ne la dépasse. *(La première rédaction disait « aucune série > 2 à l'Ardeur » ; c'est inatteignable par construction avec `BLOC_EPISODE` = 6 et une fourchette [1, 3], et `episodeDuBloc` le déclare dans sa propre docstring — une longue tempête qui émerge de deux blocs est une propriété voulue, pas un défaut.)* Mesuré sur `frontDuCycle`, jamais sur les constantes.
- **A6 — Une journée de pluie est une journée.** Un point de la carte est sous une intensité non nulle **≥ 30 min réelles** sur un cycle des Pluies — mesuré par balayage de `meteoIntensityAt` tick par tick, jamais par lecture de largeur.
- **A7bis — Le niveau d'eau va dans les deux sens.** À niveau positif, un gué est infranchissable et une tuile de terre à `d ≤ niveau` porte de l'eau peu profonde ; à niveau négatif, la même tuile de terre est intacte et le gué est sec. Le champ de distance est **identique d'un moteur à l'autre** (BFS à coûts unitaires, ordre row-major — la garde de `eroderMasque`), et le niveau revient à zéro quand la saison passe.
- **A7 — La sécheresse rend la main.** Une mare s'assèche au cœur de l'Ardeur puis redevient de l'eau ; aucune tuile d'eau PROFONDE ne devient marchable par sécheresse, à aucun jour de l'année ; l'hystérésis empêche le clignotement à la lisière du seuil (patron `gel.md` G8).
- **A8 — Le crépuscule mobile ne perd pas son événement.** `night_started` tombe **exactement une fois par cycle**, à toute saison — balayage sur une année entière, pas sur des jours choisis.
- **A9 — Déterminisme.** Une année rejoue au bit près à toute vitesse de calendrier ; les épisodes n'ajoutent **aucun tirage** sur le PRNG d'état (`replay.test.ts` et `events.test.ts` inchangés).
- **A10 — La faune survit à l'été.** Au cœur de l'Ardeur, le gibier vivant reste au-dessus d'un plancher mesuré par rapport à l'Éclosion — la garde du « zone sèche = 0 gibier ». Mesurée au banc (`pnpm scenario`), pas par lecture de constantes.
- **A11 — Aucune loi ne reste à trois paliers.** Balayage par le compilateur et par test : toute `actLaw`/`actTable` déclare quatre paliers ; la Brume rend 0 sur les trente jours de l'Ardeur ; chaque loi atteint son maximum dans la saison où sa pression est voulue (la faim et le combustible au Grand Froid, la repousse à l'Éclosion), vérifié loi par loi et non par échantillon.
- **A12 — Le plafond d'ambiant laisse passer l'été.** `dehorsSansMeteo` rend bien +26 °C au cœur de l'Ardeur en plaine à découvert — la garde qui attrape un `AMBIANT_MAX` resté à 22, qui rognerait la décision en silence.
- **A13 — L'aridité suit la pluie, pas l'heure.** Un point sec depuis plusieurs cycles est à sec ; le cycle qui suit un front mouillé ne l'est plus ; et la même journée d'Ardeur ne fait pas osciller l'état entre midi et minuit (c'est la garde qui sépare S10 du seuil de température nu).
- **A14 — L'hiver s'élargit sans s'enfoncer.** Sur vingt ans : le minimum annuel de la courbe ne descend **jamais** sous celui de l'an 1, et le nombre de jours sous le seuil de neige croît strictement d'une année à l'autre **jusqu'au plafond de S12** (≈ l'an 6), puis n'en bouge plus.
- **A15 — Seule la violence fait taire, et la garde se lit par ASPECT.** Sous un front des Pluies comme sous une chute de neige d'hiver couvrant toute la carte, les naissances ambiantes continuent ; elles ne s'arrêtent que sous un orage ou un blizzard. Balayé sur les quatre aspects, pas sur les deux classes.
- **A16 — Le glissement de S12 ne casse pas la courbe.** Sur vingt ans : la pente maximale entre deux jours consécutifs reste ≤ 1 °C (A2 tient à tout tour), le cardinal de l'Éclosion reste au-dessus du cœur du Grand Froid, et l'escalade climatique atteint son plafond puis n'en bouge plus.
- **A17 — La forêt reverdit.** Une tuile de feuillu est dénudée au cœur du Grand Froid et **feuillue au cœur de l'Ardeur, chaque année, sur vingt ans** ; et l'état ne change pas deux fois dans un même cycle (la garde anti-clignotement que `feuillageDenude` documente).
- **A18 — La menace respire.** À phase fixée, chaque rampe croît d'un tour à l'autre (le plancher monte) ; à tour fixé, elle est plus basse à l'Éclosion qu'au Grand Froid. Balayage sur vingt ans, pas sur des années choisies — et aucune rampe n'est plus saturée par le clamp à 60.
- **A19 — La fenêtre de semis.** Une graine semée hors de sa fenêtre ne germe pas et **n'est pas consommée** ; la même graine germe le jour où la fenêtre s'ouvre ; sous serre elle germe en toute saison. Le tubercule des Pluies traverse le Grand Froid sans pourrir.
- **A21 — Le modificateur est pur, et une saison sur trois n'en a pas.** Deux lectures de `(tour, phase)` rendent le même modificateur ; **aucun tirage sur le PRNG** (`replay.test.ts` et `events.test.ts` inchangés) ; balayé sur deux cents saisons, la part sans modificateur est ~1/3 et le même ne tombe jamais deux tours de suite.
- **A22 — Chaque modificateur mord sur une quantité mesurable.** Pour les seize : la quantité qu'il surcharge est relevée au banc avec et sans lui, et l'écart est non nul. C'est la garde qui attrape un modificateur posé sur un cadran qui n'existe pas — celle qui a déjà écarté « les orages secs mettent le feu » et « la foudre embrase les structures ».
- **A20 — Les quatre saisons se distinguent à l'œil.** Sur la même vue et la même heure, les couleurs moyennes des quatre saisons sont séparées d'un écart mesurable (planche rendue par le harnais smoke, pas jugée sur une capture d'aperçu) ; et la teinte d'un jour à l'autre ne saute jamais — elle suit la courbe.

## Ce qui reste ouvert

- ~~**O1 — Le froid du premier jour de l'Éclosion.**~~ **TRANCHÉE le 2026-08-23 : la courbe reste telle quelle, le dégel est le contenu du printemps** (S4).
- **O2 — Les valeurs FINES des tables météo** (largeurs exactes, fréquences des saisons autres que les Pluies) : la densité de l'automne et les longueurs d'épisode sont tranchées (S7, S9) ; le reste est du calibrage au banc et à l'œil.
- ~~**O3 — Le seuil d'aridité.**~~ **TRANCHÉE : l'aridité s'accumule et retombe à la pluie** (S10). Reste le nombre : combien de jours secs pour vider une mare.
- ~~**O4 — Les pentes par tour.**~~ **TRANCHÉE pour le climat : l'hiver s'élargit** (S12). Les pentes des autres lois (faim, hordes, cendreux) restent du calibrage au banc.
- **O5 — Le multi.** Tout ce document raisonne en Veillée (1 jour = 1 cycle). À `calendarScale` = 1, une année de 120 jours dure 120 jours réels : c'est le réglage de R3/R6 de `saison-sans-fin.md`, pas une décision de ce document.

## Ce que ça casse

- ~~**Les sauvegardes et les replays en vol.**~~ **NON APPLICABLE** (Alexis, 2026-08-23 : « on n'aura pas de saison en cours ») : aucune vallée ne tourne au moment du pivot, donc **aucune migration à écrire** — on ne bosse pas `SAVE_FORMAT_VERSION` et on ne décale aucun tick. Le point ne redeviendrait vrai que si le pivot glissait après GATE 1 ; d'ici là, `ACT_DAYS` peut réinterpréter tous les `actForDay` et `METEO` rompre son contrat de replay (« on les change ENTRE les saisons, pas dedans ») sans que personne ne le paie.
- **`BALANCE.SEASON_DAYS = 60`** perd son dernier sens de « vérité du monde » (le solo tourne déjà avec `finDeSaison: null`) ; il ne reste que le réglage de wipe multi.
- **`TEMPERATURE.ACT_COLD`** disparaît en tant que loi par acte, et avec elle les commentaires de `balance.ts` qui dérivent les seuils de `GEL` de sa table de trois valeurs.
- **`meteo.md` R2** (mixture par acte) et la géométrie fixe par type : les deux deviennent saisonnières. **`meteo.md` R13** (la largeur de l'orage commandée par le froid de la saison) est retirée : S7 la remplace par une table.
- **`TEMPERATURE.AMBIANT_MAX`** monte de +22 à **+30**, sans quoi l'été n'existe pas.
- **`METEO.QUIET.pluie`** passe à faux : seul l'orage fait taire la faune (S7).
- **Les neuf `actLaw`/`actTable` à trois paliers** sont toutes à réécrire à quatre (S13).
- **`feuillageDenude`** cesse d'être monotone (S14) et **`seasonRamp`** cesse d'être clampée à `SEASON_DAYS` (S15) : deux fonctions écrites pour un arc à sens unique.
- **`AGRICULTURE`** passe d'une culture unique à un catalogue de quatre, chacune avec sa fenêtre de semis (S16) — un chantier de contenu, pas une constante.
- **Le HUD** affiche une saison nommée et un an, plus un numéro d'acte.
