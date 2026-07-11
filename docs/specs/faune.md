# La faune — le monde est habité

*Source : GDD §8bis (catalogue des ressources : petit gibier, gros gibier ; « le geste » : pistage/approche), §9bis (« annoncés, pas surprises » ; « meutes de prédateurs, le danger de fond des trajets »), §7 (la faune est le tutorial de combat permanent). Complète `combat.md` R12, promis et jamais tenu. Statut : **implémenté** (2026-07-11 — R1-R16, 56 tests headless + smoke navigateur). Jalon : post-V10 (chantier ambiance).*

## Objectif de design

Aujourd'hui la seule bête du monde est un sanglier **qui ne bouge jamais** : `aggroRange: 0`, `wanderChance: 0`, et une IA qui ne s'exécute que si `wounded && attackedBy`. Le joueur traverse 2 millions de tuiles sans qu'une chose vivante ne remue.

On veut que **marcher en forêt soit différent de marcher sur une carte**. Le gibier détale avant qu'on le voie ; le sanglier lève la tête et décide ; le monde bruisse. Et ce bruissement n'est pas du décor : c'est la première leçon de combat (l'approche coûte, la fuite se lit) et le premier robinet de nourriture.

## Le choix structurant : la faune est **ambiante**, pas résidente

Une population résidente à densité de biome (~800 bêtes sur 1200×1800) est **exclue par le transport** : `sim-worker.ts` clone `entities` et `monsters` **en entier à chaque tick**, et `advanceMonsters` fait un `entities.find` par monstre (O(n²)). Une faune résidente ferait payer partout un coût qui ne sert que là où un joueur regarde.

Donc : **la faune vit dans un anneau autour des avatars.** Elle apparaît hors-champ, vit dans le rayon utile, et se dissipe quand plus personne n'est là pour la voir. La population totale est **bornée par un plafond dur**, indépendant de la taille de la carte — ce qui la rend gratuite en LAN comme en solo, et cohérent avec la note streaming (« ce qui vit est borné → tické partout »).

Ce n'est pas de la triche : le joueur ne peut pas prouver l'absence d'un lapin à 200 tuiles. Ce qui doit rester vrai, et qui reste vrai, c'est que **le lieu détermine l'espèce** — la prairie détale, la forêt grogne.

Les sangliers de tanière (`spawnPoiMonsters`) restent **résidents** : ils appartiennent à un lieu, ils ne se dissipent pas.

## Règles

### Le peuplement (R1-R3)

- **R1 — L'anneau.** À intervalle fixe, tant que la population ambiante est sous le plafond, on tente un spawn sur une tuile marchable tirée dans l'anneau `[SPAWN_RING_MIN, SPAWN_RING_MAX]` autour d'un avatar (joueur ou PNJ) — assez loin pour n'apparaître dans le champ de personne, assez près pour être rencontrée.
- **R2 — Le biome choisit l'espèce.** Chaque espèce a une liste de terrains d'habitat. La tuile tirée détermine ce qui peut y naître : **lapin** en prairie, lande et fleurs ; **cerf** en prairie alpine, lande et forêt claire ; **sanglier** en forêt, pinède, mélézin et vieille forêt. Une tuile sans habitant ne spawne rien.
- **R3 — La dissipation.** Une bête ambiante à plus de `DESPAWN_RADIUS` du plus proche avatar disparaît (elle et son entité). Un cadavre, lui, reste : ce qu'on a tué ne s'évapore pas.

### Le comportement (R4-R7) — un seul état-machine, trois espèces

- **R4 — Brouter.** Sans menace : la bête erre lentement (`GRAZE_SPEED` × sa vitesse), par à-coups — quelques pas, un arrêt. Elle ne quitte pas son habitat : une direction qui la mènerait hors de ses terrains est refusée.
- **R5 — L'alerte.** Un avatar à moins de `alertRange` : la bête **s'arrête net** et le regarde. C'est le signal lisible — le joueur voit qu'il a été vu, et sait qu'un pas de plus la fera partir. (« Annoncés, pas surprises », GDD §9bis.)
- **R6 — La fuite en à-coups.** Un avatar à moins de `flightRange`, **ou** un coup encaissé : la bête détale à l'opposé, à `FLEE_SPEED` × sa vitesse, par **bursts** — `BURST_RUN_TICKS` de course, `BURST_PAUSE_TICKS` de souffle, tant que la menace est à moins de `SAFE_RANGE`. C'est le sprint burst promis par `combat.md` R12 : c'est ce qui rend la chasse un geste (couper la fuite, l'épuiser) et pas un clic.
- **R7 — La charge du sanglier.** Blessé et acculé, le sanglier **retourne la chasse** : à chaque réflexion, `chargeChance` de charger au lieu de fuir (règle existante, conservée). Le lapin et le cerf ne chargent jamais. Le sanglier est la bête qui punit l'approche paresseuse.

### La harde (R9) — le grégarisme

- **R9 — Le cerf ne naît jamais seul.** Une espèce grégaire (`herdSize`) arrive par **hardes** de 3 à 5, posées ensemble, partageant une identité (`herdId`). Deux conséquences, et la seconde est la seule qui compte :
  - **La cohésion.** Une bête à plus de `HERD_SPREAD` du centre de sa harde cesse de tirer sa direction au sort et **revient vers les siens**. Sans ça, une harde qui broute chacun dans son coin se dissout en une minute.
  - **La contagion d'alarme.** Une bête qui voit un congénère détaler à moins de `HERD_ALARM_RADIUS` **détale aussi — sans avoir rien vu elle-même**. C'est le cœur de la règle : une harde a autant d'yeux que de têtes. On ne s'approche pas d'un groupe comme d'une bête seule, et rater son approche ne coûte pas un cerf : ça coûte les cinq.

  Le lapin et le sanglier restent **solitaires**. Le sanglier de tanière l'est par nature — c'est ce qui le rend inquiétant.

### Le rythme (R10) — l'heure a une identité

- **R10 — Chaque espèce a ses heures.** Une courbe de vigueur par heure (`activityAt`, rampes linéaires — pas de `sin`, la valeur décide de qui naît et vit donc dans le flux déterministe) : **diurne** (le cerf), **nocturne** (le sanglier, le loup), **crépusculaire** (le lapin). Deux effets, et le second est le plus fort :
  - **Le peuplement bascule.** L'heure pondère le tirage d'espèce : à 3 h du matin la forêt donne des loups et des sangliers, à midi des cerfs. Un plancher (`SPAWN_FLOOR`) garde une chance aux endormis — le monde ne se recompose pas d'un coup au coucher du soleil.
  - **Hors de ses heures, la bête se couche.** Elle ne broute plus, ne chasse plus. Elle reste **réveillable** : un dormeur qu'on approche détale quand même. Ce n'est pas un interrupteur, c'est un seuil.

  Conséquence recherchée : **sortir de nuit cesse d'être une question d'éclairage pour devenir une question de qui est réveillé.**

### La meute (R11) — le danger de fond des trajets

- **R11 — Le loup chasse ; il ne marche pas droit sur vous jusqu'à mourir.** Il a une psychologie, et elle s'exploite :
  - **L'écosystème.** Il chasse **le gibier ET l'homme**, et il **préfère le gibier** (`PREY_PREFERENCE`) : un joueur peut traverser une chasse sans être choisi. Symétriquement, **le gibier fuit le loup comme il fuit le chasseur**. La vallée n'a pas deux étages : elle en a un, et le joueur y est une pièce parmi d'autres.
  - **L'appel.** Un loup dont un frère chasse à moins de `PACK_CALL_RADIUS` converge sur la **même** proie — mais seulement s'il peut lui-même l'atteindre.
  - **La traque et l'encerclement.** Il ne fonce pas : il **rampe** (`STALK_SPEED`) vers **son poste**, un point du cercle autour de la proie donné par son rang dans la meute. Tant qu'il rampe, la proie ne le repère que de bien plus près (`STALK_STEALTH`). **Ces deux choses n'en font qu'une** : une meute qui charge pour se placer lève le gibier avant que le cercle ne soit bouclé, et l'encerclement ne se produirait jamais. **La lenteur EST la manœuvre.** Quand tout le monde est en place — ou que la proie a compris — le camouflage tombe et la meute se rue.
  - **Le courage.** Il n'engage un **homme** que s'il compte au moins `PACK_COURAGE` frères vivants près de lui. Sinon il rôde, il suit, il pèse — mais il ne mord pas.
  - **La rompue.** Sous `PACK_BREAK_HP` de ses PV, il **décroche**. Un loup calcule ; il ne se sacrifie pas. C'est ce qui rend la meute battable sans en faire un mur de points de vie.

### L'alpha (R12) — la meute a une tête, et on peut la couper

- **R12 — Chaque meute a UN mâle alpha** (le premier-né ; une harde de cerfs n'en a pas). Il est **plus lourd** (`ALPHA_HP`), il **frappe plus fort** (`ALPHA_DAMAGE`), et **on le reconnaît** : silhouette propre, nettement plus grande. Il est visible, donc ciblable.
  **Le tuer disperse la meute sur-le-champ** : plus d'appel, plus de courage, plus d'encerclement — chacun s'enfuit, et le coup en cours est lâché. C'est la seule chose qui transforme un combat perdu d'avance en combat *gagnable* : on n'abat pas quatre loups, on en abat **un** — le bon. Encore faut-il l'atteindre, et il est au milieu des siens.

### La rencontre (R13) — ce doit être un moment

- **R13 — Croiser une meute doit être terrifiant, et la mort doit être l'issue probable sans équipement.** Elle l'est par arithmétique, pas par décret : quatre loups infligent ~37 dégâts/s à un homme qui en a 100 ; à mains nues (6 dégâts, 15 d'endurance le coup), toute sa barre d'endurance ne délivre que 36 dégâts — pas même de quoi entamer l'alpha. **La lance (16) est la porte.** Trois soupapes, et aucune n'est gratuite :
  - **Le hurlement.** Quand une meute choisit un homme, elle **le dit** — une fois, par meute et par proie (`wolf_howl`, un `SimEvent`). C'est le seul avertissement, et le GDD §9bis en fait une règle : « annoncés, pas surprises ».
  - **La poursuite.** Acquérir demande de venir près (`aggroRange` 13) — on peut contourner une meute vue à temps. **Garder va bien plus loin** (`PURSUIT_RANGE` 26). Un sprint ne creuse que ~15 tuiles avant l'épuisement : **on ne sème pas des loups.**
  - **Le Feu.** Aucun loup n'approche à moins de `FIRE_WARD` d'un Feu allumé. C'est la seule vraie issue d'une poursuite, et elle donne à la fuite une **destination** plutôt qu'une direction. Que le salut d'une nuit de chasse soit le Foyer n'est pas un hasard : c'est le jeu qui dit son nom.

### Le sanglier (R14) — il ne fuit pas, il décide

- **R14 — Quatre verbes, là où les autres bêtes n'en ont qu'un.** Le sanglier ne détale pas : c'est ce qui en fait une *rencontre* et non une cible.
  - **Fouir.** Groin au sol, il ne voit plus rien : ses portées s'effondrent (`ROOT_ALERTNESS`). C'est **la fenêtre du chasseur** — le seul moment où l'on approche une bête qui, sinon, vous voit venir et ne recule pas. C'est le geste que le GDD §8bis appelle « l'approche ».
  - **Menacer.** Trop près, il se **plante face à vous** et attend (`THREAT_TICKS`). C'est un avertissement, et la dernière seconde où l'on peut encore reculer — **reculer suffit**.
  - **Charger.** Droit, et **plus vite qu'un sprint** (6,1 contre 6). On ne le distance pas : **on s'écarte.** La direction est **verrouillée au départ** — il ne corrige pas sa course, il passe. Il encorne une fois, pas davantage.
  - **Souffler.** Il a dépassé : il reste **immobile** (`WINDED_TICKS`), offert. C'est là, et seulement là, qu'on le frappe.

  Conséquence recherchée : le sanglier est **la première leçon du combat positionnel** que veut le GDD §7 — une bête qu'on esquive au lieu de la fuir.

### La satiété (R15) — un prédateur mange

- **R15 — Le loup ne chasse pas pour le sport : il chasse, il tue, et il MANGE.** Affamé, il se rend à la carcasse la plus proche (`CARCASS_SEEK`), s'y plante et se nourrit (`EAT_TICKS`, immobile et parfaitement vulnérable) ; il en devient **repu** pour `SATED_TICKS`.
  - **Repu, il ne chasse plus.** Plus de cible, plus de traque, plus de hurlement. On peut **passer à côté d'une meute rassasiée** — la voir, la contourner, et qu'il ne se passe rien. C'est ce qui achève de faire de la vallée un écosystème plutôt qu'un distributeur d'agression.
  - **Mais repu n'est pas inoffensif.** Qui le frappe le trouve en face : il rend le coup, et il rompt s'il saigne. Il ne poursuit pas, il ne rôde pas — il se **défend**. Un prédateur repu qui se laisserait tuer sans réagir serait un décor, pas un animal.

  Corollaire offert au joueur : **jeter de la viande à une meute qui vous serre lui donne autre chose à faire.** (Le GDD §9bis prévoyait déjà de détourner une horde « avec de la viande ou du bruit ».)

### La pression de chasse (R16) — ni farm, ni désert

- **R16 — Le gibier déserte ce qu'on vient de chasser.** Le peuplement ambiant remplit l'anneau dès qu'une place se libère : sans règle, tuer une bête en fait naître une autre en une demi-seconde, et un joueur planté dans une clairière récolte de la viande **à l'infini sans faire un pas**. La chasse, qui devait être un geste, devient un robinet.
  - **Le silence.** Une bête de gibier abattue interdit toute naissance ambiante à moins de `QUIET_RADIUS` (46) pendant `QUIET_TICKS`. Le rayon est **plus grand que l'anneau de naissance** (42) : un chasseur qui reste sur place ne voit plus rien venir. **Il faut lever le camp** — ce que fait un vrai chasseur, et ce qui rend la carte utile : le gibier est une ressource de **territoire**, pas de temps.
  - **Ce n'est pas une terre brûlée.** La zone se rouvre d'elle-même (deux minutes), le plafond global n'est pas touché, et **abattre un loup ne fait taire personne** — tuer un prédateur n'a jamais fait fuir le gibier.
  - **Les bêtes de lieu reviennent.** Le sanglier d'une tanière est résident : tué, il ne revenait **jamais**, et le lieu devenait une coquille vide pour la saison. Il repeuple sa tanière après `DEN_RESPAWN_TICKS` — **jamais sous les yeux d'un joueur** (`DEN_SPAWN_CLEARANCE`) : une bête qui se matérialise devant vous, c'est le décor qui avoue. Un seul occupant par lieu, et un long délai : on ne farme pas une tanière, **on y revient**.
  - **Le peuplement des lieux reste une décision d'HÔTE** (`state.dens`), au même titre que `faunaCap`. Sans cette liste, « ce lieu n'a pas de bête » se confondrait avec « sa bête est morte », et des sangliers apparaîtraient dans des mondes qui n'en voulaient pas — y compris les bancs headless, dont ils ont tué les villageois (attrapé par le scénario 6 jours).

### Le gibier (R8)

- **R8 — Trois étages de gibier**, comme le GDD §8bis les nomme. Le **lapin** (petit gibier) : 8 PV, très rapide, fuit tôt et loin, `raw_meat: 1` — la nourriture d'un fuyard, l'école de l'approche. Le **cerf** (gros gibier) : 45 PV, rapide, fuit très tôt, `raw_meat: 5` — le vrai repas, qui se mérite. Le **sanglier** : inchangé (30 PV, `raw_meat: 3`), mais il broute, s'alerte, fuit en bursts et charge. La viande se cuit au Feu par la recette existante.

## Critères d'acceptation

- **A1** — Un pas de sim avec un avatar au milieu d'un habitat peuple l'anneau : après `SPAWN_EVERY_TICKS × plafond` ticks, la population ambiante atteint le plafond et **ne le dépasse jamais**, quel que soit le nombre d'avatars.
- **A2** — Aucune bête ambiante ne naît à moins de `SPAWN_RING_MIN` d'un avatar, ni sur une tuile bloquante, ni hors de son habitat.
- **A3** — Un avatar qui s'éloigne de plus de `DESPAWN_RADIUS` laisse la faune se dissiper (population ambiante → 0 dans son sillage) ; le sanglier de tanière, lui, est **toujours là**.
- **A4** — Sans menace, une bête **se déplace** sur 200 ticks (elle broute) et reste dans son habitat.
- **A5** — Un avatar qui entre dans `alertRange` fige la bête ; un avatar qui entre dans `flightRange` la fait fuir — la distance à l'avatar **croît** strictement sur les ticks suivants.
- **A6** — La fuite est en à-coups : sur une fenêtre de `BURST_RUN_TICKS + BURST_PAUSE_TICKS`, la bête couvre du terrain puis en couvre nettement moins (vitesse non constante).
- **A7** — Un sanglier frappé fuit ; un sanglier frappé avec `chargeChance = 1` charge et rend le coup. Un lapin frappé fuit **toujours** (il ne charge jamais, même à `chargeChance` non nul).
- **A8** — Tuer un lapin donne 1 viande crue, un cerf 5 ; l'événement `monster_slain` porte le bon `monsterType`.
- **A9** — Déterminisme et replay tiennent avec le peuplement ambiant actif (même seed + mêmes inputs → même faune, même flux d'événements).
- **A10** — Tout cerf né a un `herdId`, et aucune harde ne compte moins de 2 têtes ; le lapin et le sanglier n'en ont pas. **La contagion** : un cerf hors de sa propre `flightRange` (mais dans le rayon d'alarme d'un congénère qui fuit) **fuit** — et le **contre-test** le prouve : le même cerf, seul au même endroit, ne bouge pas d'un pouce. La **cohésion** : une bête écartée de sa harde s'en rapproche en broutant.

- **A11 (R10)** — `activityAt` : cerf plein éveil à midi et nul à 2 h, loup et sanglier l'inverse, lapin à deux bosses (aube/soir) et nul en plein midi ; un mort-vivant n'a pas d'heures. La forêt donne **plus de loups et de sangliers la nuit qu'à midi**, et plus de cerfs le jour. Un cerf à 2 h **ne broute pas** — mais si on l'approche, **il détale quand même**.
- **A12 (R11)** — Le loup est un prédateur, pas du gibier. **Le courage** : une meute mord un homme ; un loup **seul** rôde sans jamais mordre. **La rompue** : blessé sous le seuil, il s'éloigne et lâche sa cible. **L'écosystème** : à choisir entre un cerf à 10 tuiles et un joueur à 8, il prend le **cerf** — et le cerf **détale à sa vue**, sans avoir été touché. **L'appel** : toute la meute converge sur la même proie. **L'encerclement** : trois loups partis du même point se répartissent sur **au moins deux côtés** de la proie. **La traque** : il rampe (pas plus vite que `STALK_SPEED`) et le cerf **ne le voit pas venir** — et le **contre-test** le prouve : le même loup, non camouflé, à la même distance, lève le cerf aussitôt.
- **A13 (R12)** — Une meute a **un** alpha et un seul ; une harde de cerfs n'en a pas. L'alpha porte `ALPHA_HP` fois les PV des siens. **Tuer l'alpha** : dans le tick qui suit, tous les loups sont en déroute, sans meute et sans cible ; ils s'éloignent et **ne mordent plus une seule fois**.
- **A14 (R13)** — Un homme désarmé qui se bat **meurt**. **Le hurlement** est émis **une fois**, avec la bonne cible et la bonne taille de meute, et ne se répète pas. **La poursuite** : la meute garde sa proie bien au-delà de son aggro, et ne la lâche qu'au-delà de `PURSUIT_RANGE`. **Le Feu** : un fuyard qui atteint un Feu allumé est **lâché**, et n'est plus repris tant qu'il y reste.
- **A15 (R14)** — **La fouille** : il fouge, immobile, et on l'approche à 2,5 tuiles **sans le lever**. **La menace** : il se plante, tourné vers l'intrus, sans bouger — et **reculer suffit** à annuler la charge. **La charge** : cap **verrouillé** (il ne corrige jamais), plus rapide que son allure, et elle encorne **une seule fois**. **S'écarter** : la charge fend l'air, et il reste **immobile** le temps de souffler.

- **A16 (R15)** — Un loup affamé rejoint la carcasse, mange, en **entame** l'inventaire, et devient repu. **Repu**, il ne prend aucune cible, ne mord pas, ne hurle pas — un joueur à 6 tuiles est ignoré. **Frappé**, il prend son agresseur pour cible et rend le coup.
- **A17 (R16)** — Après une mise à mort, **aucune naissance ambiante nouvelle** autour du chasseur, même après 40 s. **Lever le camp** rétablit le peuplement — ailleurs — et la zone chassée se rouvre au bout de `QUIET_TICKS`. Tuer un **loup** ne pose aucun silence. **La tanière** : sa bête abattue ne revient pas tout de suite, mais elle revient — et **jamais** tant qu'un joueur campe le lieu.

## Hors périmètre (et où ça revient)

- **Peaux et cuir** (GDD §8bis) : c'est un item et une chaîne d'artisanat, pas de la faune. Plus tard, avec le tannage.
- **Migrations de gibier** (GDD §9bis, opportunité mondiale) : c'est un **événement de monde** (`worldevents.ts`), pas un comportement — il déplacera la densité, pas les règles.
- **Pistage, pièges, dépeçage sur place, Traque** (Annexe A) : l'arbre de maîtrise Chasse, hors sujet ici.
- **Prédateurs (meutes)** (GDD §9bis, « le danger de fond des trajets ») : ce sont des monstres agressifs, pas du gibier. Ils réutiliseront l'anneau, mais c'est une décision de danger, pas d'ambiance.

## Ajouts à `balance.ts`

`FAUNA` : plafond ambiant, `SPAWN_EVERY_TICKS`, anneau `[SPAWN_RING_MIN, SPAWN_RING_MAX]`, `DESPAWN_RADIUS`, `SAFE_RANGE`, `GRAZE_SPEED`, `FLEE_SPEED`, `PAUSE_CHANCE`, `BURST_RUN_TICKS`, `BURST_PAUSE_TICKS`, `HERD_ALARM_RADIUS`, `HERD_SPREAD`, `HERD_SPAWN_SPREAD`.
`MONSTER_DEFS` : `rabbit`, `deer` ; le sanglier gagne un `wanderChance` non nul. Nouveaux champs de `MonsterDef` : `habitat` (terrains), `alertRange`, `flightRange`, `herdSize`.
`SimState` : `faunaCap` (décision d'hôte) et `nextHerdId`. `Monster` : `ambient`, `fleeSince`, `herdId`.

**`wanderChance` change de sens pour le gibier** : ce n'est plus « probabilité d'errer » mais **probabilité de CHANGER DE CAP**. Le reste du temps la bête garde sa direction (ou s'arrête, `PAUSE_CHANCE`). Mesuré en jeu : sans cette persistance, tirer une direction neuve chaque seconde donne une marche aléatoire qui piétine sur place — la bête s'agite sans aller nulle part, et le monde ne se repeuple jamais autour d'un joueur immobile.

## Calibrage fait EN JEU (2026-07-11)

Trois nombres n'ont pas été trouvés au raisonnement mais à l'écran (`pnpm smoke --scenario faune`) :

- **`SPAWN_RING_MIN` = 28**, et non 22. La demi-diagonale du champ vaut ~20,6 tuiles — mais la caméra « Foxhole » se décale **jusqu'à 6 tuiles** vers le curseur (`LOOKAHEAD_MAX_TILES`). À 22, un lapin se matérialise à l'écran dès qu'on regarde dans sa direction.
- **`CAP` = 48**, et non 30. Ce qui compte n'est pas le plafond mais la **densité dans le disque utile** : 30 bêtes sur un rayon de 62 (12 000 tuiles) pour un écran de ~710 tuiles donnent ~2 bêtes en vue — et on n'en voyait effectivement qu'une. Disque resserré à 52 + plafond à 48 → ~4 en vue.
- **`DESPAWN_RADIUS` = 52**, resserré exprès : c'est le dénominateur de la densité.

## Dette réglée au passage

`advanceMonsters` résolvait l'entité de chaque monstre par un `state.entities.find` — O(n²). Avec une faune, ça ne passe plus : le pas construit un index une fois. Même chose pour `nearestPrey`, qui reconstruisait un `Set` de tous les monstres **à chaque appel**.
