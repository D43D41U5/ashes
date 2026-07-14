# La faune — le monde est habité

*Source : GDD §8bis (catalogue des ressources : petit gibier, gros gibier ; « le geste » : pistage/approche), §9bis (« annoncés, pas surprises » ; « meutes de prédateurs, le danger de fond des trajets »), §7 (la faune est le tutorial de combat permanent). Complète `combat.md` R12, promis et jamais tenu. Statut : **implémenté** (2026-07-11 — R1-R16, 56 tests headless + smoke navigateur ; **2026-07-13 — R6 refondu, R6bis, R9bis, R10bis** : fuite engagée, espace vital, troupeau vivant, sentinelle, l'heure du loup — bancs A18-A23, postures client). Jalon : post-V10 (chantier ambiance).*

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
- **R6 — La fuite ENGAGÉE** *(refondue 2026-07-13 — playtest : « je rattrape un cerf à la course », et c'était vrai : à-coups inconditionnels + peur qui retombe à 14 tuiles = vitesse moyenne 3,2 t/s contre un sprint à 6)*. Une bête levée part **loin**, et on ne la rattrape pas à pied :
  - **Le surrégime.** En fuite, le gibier court à `FLEE_SPRINT` × sa vitesse (~×1,5 : cerf ~6,9 t/s, lapin ~7,5) — **plus vite qu'un sprint de joueur (6), toujours**. La chasse à course droite est morte ; restent l'approche (spec chasse) et le tir à venir. *(Conséquence actée par l'utilisateur : le loup (4,8) ne rattrape plus un cerf sain en ligne droite — c'est CHASSE II, le sang, qui lui rendra ses proies : la ruée blesse, le sang ralentit.)*
  - **Le souffle est un luxe de la marge.** Les bursts (`BURST_RUN_TICKS` course / `BURST_PAUSE_TICKS` souffle) ne marquent la pause que si la menace **perçue** est à plus de `BREATHE_GAP` — serrée de près, elle court plein pot, sans pause. (Et un chasseur qui se fige pendant qu'elle souffle redevient presque imperceptible : le stop-and-go vaut aussi en poursuite.)
  - **Le point de peur.** À la levée, la bête mémorise **d'où** est venue la peur (`fleeFrom` — la menace vue, ou le lieu du cri de mort, ou celui transmis par la contagion) et fuit **jusqu'à en être à `FLEE_GOAL`** (~30 tuiles), menace visible ou pas (borne dure : `FLEE_MAX_TICKS`, pour la bête acculée). Plus de « je m'arrête à 14 tuiles et je rebroute ».
  - **La retombée n'est pas le calme.** Fin d'engagement : jauge posée au seuil d'alerte, nervosité au plafond — elle trotte, rejoint les siens, surveille. Le retour au broutage se gagne par la décrue, ralentie par la nervosité.
- **R6bis — L'espace vital et l'impatience** *(playtest : AFK, on finit encerclé de cerfs statufiés)*. Une bête n'accepte **jamais** une menace identifiée trop près, et ne reste jamais statue :
  - **L'espace vital.** Menace repérée (jauge ≥ `SUSPICION_ALERT`) à moins de `PERSONAL_SPACE` (~3,5 tuiles) → **levée immédiate**, immobile ou pas. (Sous le seuil de la jauge : c'est la panique de contact, `PANIC_RANGE`, qui garde la porte. Et le chasseur du stop-and-go, qui approche *sous* l'alerte, ne rencontre jamais cette règle — elle punit l'approche ratée, pas l'approche.)
  - **L'impatience.** Alertée depuis plus de `IMPATIENCE_TICKS` (~6 s) sans résolution, elle ne se fige plus : elle **s'éloigne au trot** (`WARY_SPEED`) jusqu'à retomber sous le seuil — le cerf tape du sabot, fixe, puis s'écarte.
- **R7 — La charge du sanglier.** Blessé et acculé, le sanglier **retourne la chasse** : à chaque réflexion, `chargeChance` de charger au lieu de fuir (règle existante, conservée). Le lapin et le cerf ne chargent jamais. Le sanglier est la bête qui punit l'approche paresseuse.

### La harde (R9) — le grégarisme

- **R9 — Le cerf ne naît jamais seul.** Une espèce grégaire (`herdSize`) arrive par **hardes** de 3 à 5, posées ensemble, partageant une identité (`herdId`). Deux conséquences, et la seconde est la seule qui compte :
  - **La cohésion, et elle est COLLANTE.** Une bête à plus de `HERD_SPREAD` du centre de sa harde cesse de tirer sa direction au sort et **revient vers les siens** — jusqu'à `HERD_COMFORT`, pas jusqu'au seuil. Sans ça, une harde qui broute chacun dans son coin se dissout en une minute ; et **sans l'hystérésis, elle TREMBLE** *(playtest 2026-07-13 : « des cerfs qui tremblent en pâturant »)* — la bête franchissait le seuil, se faisait rappeler d'un pas, repassait dessous, et **ressortait aussitôt** parce que son cap d'errance pointait toujours dehors. Deux à trois allers-retours par seconde. Le rappel lâche donc le cap et ne relâche la bête qu'une fois **vraiment** revenue — exactement comme la peur, qui se déclenche à `flightRange` et ne retombe qu'à `SAFE_RANGE`.
  - **La contagion d'alarme.** Une bête qui voit un congénère détaler à moins de `HERD_ALARM_RADIUS` **détale aussi — sans avoir rien vu elle-même**. C'est le cœur de la règle : une harde a autant d'yeux que de têtes. On ne s'approche pas d'un groupe comme d'une bête seule, et rater son approche ne coûte pas un cerf : ça coûte les cinq.

  Le lapin et le sanglier restent **solitaires**. Le sanglier de tanière l'est par nature — c'est ce qui le rend inquiétant.

- **R9bis — LE TROUPEAU QUI VIT** *(2026-07-13, demande utilisateur : « un comportement vraiment complet et léché »)*. La harde n'est pas cinq bêtes posées côte à côte — c'est un organisme, et il a un cycle : *broute en dérivant → lève → fuit groupé → se rassemble → rebroute ailleurs*.
  - **La dérive de pâture.** La harde a un cap de broutage partagé qui tourne lentement (`DRIFT_SLICE_TICKS`, dérivé de `herdId` + tranche de temps par `hash2` — pur, zéro état, zéro tirage) : au lieu de trembler sur place, le troupeau **traverse le paysage** en broutant. Chaque bête mélange ce cap à son errance (`DRIFT_BIAS`).
  - **La fuite en troupeau.** Le point de peur (`fleeFrom`, R6) se **propage** par la contagion et le cri de mort : toute la harde fuit le même lieu, dans le même cône — et la cohésion continue de tirer vers le centre pendant la course. Ils partent *ensemble*, ils ne s'effilochent pas.
  - **Le regroupement.** Fin d'engagement (R6) : encore méfiants, ils convergent au trot, se resserrent, puis la dérive reprend.
  - **La séparation, et elle SOMME les répulsions.** Deux bêtes à moins de `HERD_SEPARATION` (~1,2 tuile) s'écartent — fini les cerfs superposés (boids-lite : séparation + cohésion + cap partagé). Elle repousse **tous** les voisins trop proches à la fois, jamais la seule plus proche : repousser la plus proche donne un **billard** (en s'écartant de B, la bête se rapproche de C, puis revient sur B), et cinq bêtes entassées frémissaient à 2,5× le rythme de l'errance normale *(mesuré, playtest 2026-07-13)*. Elle est **collante** elle aussi : levée à `HERD_SEPARATION`, relâchée à `HERD_SEPARATION_COMFORT`.
  - **Le repos groupé.** Hors de ses heures (R10), la harde se couche **resserrée** (`REST_SPREAD`) : une bête qui dort loin des siens revient d'abord, puis se couche. Un tableau, pas des pions.
  - **La sentinelle** *(avancée depuis la spec chasse C13, même règle)*. Dans une harde de gibier de 3 têtes ou plus, **une bête à la fois** est de garde : tête haute, elle ne broute pas, sa perception vaut `SENTINEL_ACUITY`, son regard balaie les relèvements ; les brouteuses relâchent (`HERD_RELAX`). Le tour de garde se **dérive** (rang dans la harde + tick ÷ `SENTINEL_SHIFT`) — zéro état. Approcher une harde, c'est lire le rythme des relèves.

### Le rythme (R10) — l'heure a une identité

- **R10 — Chaque espèce a ses heures.** Une courbe de vigueur par heure (`activityAt`, rampes linéaires — pas de `sin`, la valeur décide de qui naît et vit donc dans le flux déterministe) : **diurne** (le cerf), **nocturne** (le sanglier, le loup), **crépusculaire** (le lapin). Deux effets, et le second est le plus fort :
  - **Le peuplement bascule.** L'heure pondère le tirage d'espèce : à 3 h du matin la forêt donne des loups et des sangliers, à midi des cerfs. Un plancher (`SPAWN_FLOOR`) garde une chance aux endormis — le monde ne se recompose pas d'un coup au coucher du soleil.
  - **Hors de ses heures, la bête se couche.** Elle ne broute plus, ne chasse plus. Elle reste **réveillable** : un dormeur qu'on approche détale quand même. Ce n'est pas un interrupteur, c'est un seuil.

  Conséquence recherchée : **sortir de nuit cesse d'être une question d'éclairage pour devenir une question de qui est réveillé.**

- **R10bis — L'HEURE DU LOUP** *(2026-07-13)*. R10 couchait le **gibier** hors de ses heures, mais le prédateur, lui, chassait à **pleine portée à midi comme à 3 h** : la nuit ne tenait pas sa promesse, et traverser la forêt de jour n'était pas plus sûr que de nuit. Désormais la **vigueur** du loup (`activityAt`, nocturne) pondère ses portées d'**acquisition** (`aggroRange`), de **poursuite** (`PURSUIT_RANGE`) et d'**appel** — `WOLF_DAY_FLOOR + (1 − FLOOR) × vigueur`.
  - **À midi, il est assoupi** : il ne voit venir qu'à ~6 tuiles, et lâche prise plus tôt. On passe **au large** d'une meute de plein jour — elle est visible, c'est un **choix**, pas une loterie.
  - **La nuit lui rend ses treize tuiles** — et la « nuit qui chasse » (spec tension) cesse d'être une simple couleur.
  - **Le plancher n'est pas zéro** : une meute de jour reste mortelle à qui lui marche dessus. On **incline le monde**, on ne pose pas un interrupteur.

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

### LES COINS DE CHASSE (R17) — le gibier a des ADRESSES

*(Décision utilisateur, 2026-07-13, après playtest : « il y a trop de bêtes » — et c'étaient 43 cerfs sur 48.)*

- **R17 — Le gibier ne vit pas partout : il vit QUELQUE PART.** La faune ambiante était un **brouillard uniforme** — elle naissait dans un anneau autour du joueur, où qu'il aille. Marcher dix minutes dans n'importe quelle direction donnait exactement la même chose : la carte ne s'apprenait pas, et « le gibier est une ressource de **territoire**, pas de temps » (R16) n'était qu'une phrase.
  - **Des lieux FIXES, semés une fois pour la saison.** Un semis de Poisson (le même que les lieux — déterministe, sans PRNG d'état) donne l'**espacement** (`GROUND_SPACING`, jamais deux coins à moins de ~180 tuiles). **Rien ne naît hors d'un coin** (`GROUND_RADIUS`) : entre eux, la vallée est **vide**, et c'est ce vide qui donne leur valeur aux coins.
  - **DEUX NATURES DE COIN, et le terrain les distingue tout seul** *(retour utilisateur : « pas loin de l'eau et dans les biomes types prairies »… puis « les lieux de chasse du sanglier sont plutôt dans les bois »)*.
    - **LA CLAIRIÈRE** — un biome **ouvert** (prairie, alpage, pré fleuri, lande) : on y broute, on y voit venir. C'est le pays du **cerf** et du **lapin**.
    - **LA SOUILLE** — un **bois** (forêt, pinède, mélézin, vieille forêt) : on y fouge, on s'y vautre. C'est le pays du **sanglier**.
    - **Les deux à portée d'eau** (`GROUND_WATER_NEAR`) : on boit tous les jours, et le sanglier se vautre.
    - **Le pays décide** : autour de la graine tirée, on compte ce qui domine — de l'herbe ou des arbres — et le coin devient ce que la terre est. S'il n'y a ni l'un ni l'autre à portée d'eau, **ce point ne devient pas un coin** : la vallée a le droit d'avoir des déserts, et le gibier ne vit pas sur un éboulis.
    - **LA RÈGLE QUI FERME TOUT** : *le gibier doit pouvoir vivre sur la tuile **DU COIN**, pas seulement sur celle où il tombe.* Sans elle, le disque d'un coin (46 tuiles) débordait sur les bois voisins et une clairière se remplissait de **vingt-trois sangliers** — une prairie à cerfs pleine de bêtes de sous-bois. Le **prédateur**, lui, est admis partout : il n'a pas de pré à lui, **il suit les hardes** (et son quota, R18, le borne où qu'il aille).
    - *(Mesuré sur la vallée : **19 coins — 12 clairières, 7 souilles**. Zéro sanglier dans une clairière. Répartition nord/centre/sud : 8 / 6 / 5, pour une terre éligible à 37 / 37 / 25 % — **les coins suivent le pays**. Est/ouest : 10 / 9. **87 %** de la vallée marchable est à moins de 250 tuiles d'un coin. Le premier est à 74 tuiles du point de départ.)*
  - **La bête est D'ICI.** Elle retient son coin à la naissance ; sa **dérive de pâture** (R9bis) ne vise plus une direction en l'air mais un **but à l'intérieur de son territoire**, qui change par tranches de temps (`MIGRATE_SLICE_TICKS`). Le troupeau **traverse sa clairière**, il ne quitte pas le canton — et si la fuite engagée (R6) l'a jeté dehors, **il y revient au trot**. C'est ce qui fait qu'on **retrouve les cerfs au même endroit demain**.
  - **Le prix d'une harde** *(défaut de conception, corrigé au passage)*. Le plafond (`CAP`) était censé être un budget de **population** ; il n'était qu'un budget de **tirages** : un tirage « cerf » coûtait quatre places (il naît par 3 à 5), un tirage « lapin » une seule. À pondération horaire égale, la harde raflait le monde en quatre fois moins de tirages — d'où les 43 cerfs. Le tirage d'espèce divise désormais par ce que l'espèce **coûte**.
  - **LE BUDGET APPARTIENT AU COIN, PLUS AU MONDE — et c'est ce qui rend le moteur MULTIJOUEUR.** Un plafond global ne survit pas au multi : trente bêtes pour *tout* le monde, c'est trois bêtes par joueur à dix joueurs — un monde mort. Pire, le peuplement tirait **un seul avatar au sort** par tick : à dix joueurs, chacun attendait quatre secondes entre deux naissances, et remplir une clairière prenait des minutes. Désormais chaque coin porte **sa** population (`GROUND_CAP`), **tous les avatars sont servis** à chaque tick, et le plafond du monde (`CAP`) n'est plus qu'un **garde-fou de serveur** : il protège le tick, il ne règle pas le jeu.
    - Deux joueurs dans **deux clairières différentes** ont chacun la leur **pleine**.
    - Deux joueurs dans **la même clairière** la **partagent** — ce qui est exactement juste : c'est le même pré, il porte les mêmes bêtes.
    - Le coût par tick ne dépend ni de la carte, ni du nombre de coins : **seulement du nombre de coins qu'on regarde**. *(Mesuré : 16 joueurs dans 16 coins → 480 bêtes, chacun avec sa clairière pleine, **10,9 ms de tick** sur un budget de 50.)*
  - **Conséquence recherchée** : on apprend la clairière aux cerfs. On y retourne. On l'épuise (R16 — la pression de chasse), et il faut alors **aller plus loin** — vers un coin qu'on ne connaît pas encore.

### LE QUOTA DE PRÉDATEURS (R18) — la nuit est dangereuse, pas murée

*(2026-07-13, après mesure : un coin de chasse portait **19 loups** la nuit, et 9 coins sur 19 en portaient dix ou plus.)*

- **R18 — Les prédateurs ne peuvent occuper qu'une PART d'un coin de chasse** (`PREDATOR_SHARE`). Le loup ne débordait pas du plafond : il le **raflait**. Hors de leurs heures, le cerf et le lapin tombent au plancher (`SPAWN_FLOOR`) pendant qu'il est à son maximum ; il gagnait six tirages sur dix, et il naît par trois ou quatre.
  - **Ce n'était plus « la nuit est dangereuse », c'était un MUR.** Et c'était d'autant plus fâcheux que **la nuit qui chasse** (spec tension) avait été bornée avec soin — `MAX_ALIVE`, « on peut perdre, pas être submergé » — que le peuplement ambiant contournait par la porte de derrière.
  - **On ne rend pas le loup plus rare** (ça viderait la nuit de son sens) : **on borne sa part**. Le reste du coin va au gibier — qui, la nuit, **dort** (R10). Une clairière nocturne devient alors ce qu'elle doit être : **des cerfs couchés, et quelques loups qui rôdent entre eux.** C'est un écosystème, pas un mur.
  - Il faut **deux places libres** pour ouvrir une meute : un loup seul n'ose pas (R11, le courage), et un demi-quota ne fabriquerait que des rôdeurs inutiles.
  - *(Mesuré : 19 loups → **6 au plus**, moyenne 3,9, **zéro** coin à dix loups ou plus — et 26 bêtes de gibier endormies dans la clairière.)*

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

- **A18 (R6)** — **On ne rattrape pas un cerf.** Un avatar qui SPRINTE droit sur un cerf levé voit la distance **croître** sur 10 s — jamais de contact. **La fuite engagée** : la menace disparue (téléportée au loin) sitôt la levée, le cerf **continue** de fuir jusqu'à ~`FLEE_GOAL` de son point de peur ; à l'arrivée, jauge au seuil d'alerte et nervosité au plafond. **Le souffle conditionnel** : serré à moins de `BREATHE_GAP` perçu, il court sans pause ; avec de la marge, il souffle (les à-coups d'A6).
- **A19 (R6bis)** — **L'espace vital** : une bête alertée par une silhouette immobile à moins de `PERSONAL_SPACE` **détale** ; le contre-test : jamais repérée (jauge sous le seuil), elle broute à la même distance sans broncher. **L'impatience** : alertée au-delà d'`IMPATIENCE_TICKS` face à une menace plantée hors espace vital, elle **s'éloigne** (la distance croît) sans entrer en fuite (`fleeSince` reste −1).
- **A20 (R9bis)** — **La dérive** : sans menace, le **centre** d'une harde se déplace nettement en 60 s, et chaque bête reste à moins de `HERD_SPREAD` du centre. **La séparation** : deux cerfs posés l'un sur l'autre s'écartent à ≥ `HERD_SEPARATION`. **La fuite groupée** : le cri de mort transmet le point de peur — toute la harde a le **même** `fleeFrom`, et 3 s après la levée la dispersion du groupe reste bornée. **Le repos groupé** : à l'heure du repos, une harde éparpillée converge sous `REST_SPREAD` du centre puis s'immobilise.
- **A22 (R10bis)** — `wolfVigor` est **maximale la nuit**, minimale à midi, et jamais nulle. **À midi** un loup ne prend pas une cible qu'il aurait prise **la nuit** à la même distance (10 tuiles) ; et il la lâche plus tôt en poursuite. Un homme **collé** à une meute de jour est mordu quand même (le plancher tient).
- **A23 (bug du gel)** — Une bête **hors de son habitat** (jetée là par la fuite engagée) **rentre chez elle** : sa distance à son biome décroît, elle y revient, et elle se remet à brouter. Le **contre-test** de la régression : sur 10 s de calme hors habitat, elle parcourt **plus de zéro tuile** — un lapin poussé en forêt ne se fige plus jamais.
- **A24 (R17)** — Le semis pose les coins **dans des biomes ouverts, à portée d'eau**, et **jamais deux à moins de `GROUND_SPACING`**. **Rien ne naît hors d'un coin** : un avatar planté au point le plus reculé de la vallée ne voit **aucune** bête ambiante, même après deux minutes. Une bête née dans un coin **retient** ce coin ; jetée dehors par la fuite, elle y **revient**. Et la **composition** cesse d'être une monoculture : le tirage divisé par le coût de harde ramène les cerfs d'une écrasante majorité à une part comparable aux autres espèces.
- **A25 (R17, le multi)** — **Quatre joueurs dans quatre coins** : **chacun** a sa clairière pleine (pas un quart d'un plafond partagé), et le garde-fou du monde tient. **Deux joueurs dans le même coin** : ils le **partagent** — sa population ne double pas.
- **A26 (R18)** — **La nuit, dans un coin de chasse, les prédateurs ne dépassent JAMAIS leur part** — et la clairière reste **peuplée** (le budget rendu par le loup va au gibier, qui dort). Mais **la nuit reste à eux** : ils sont là, et **en meute** (le quota laisse passer un groupe ; un loup seul n'oserait rien). De jour, le quota ne change rien — le loup y était déjà rare (R10bis).
- **A21 (R9bis, sentinelle)** — À tout tick, une harde de gibier ≥ 3 a **exactement une** sentinelle ; le rôle **tourne** à `SENTINEL_SHIFT` ; la sentinelle ne broute pas (immobile hors menace) et son regard **balaie** ; sa perception est accrue (`SENTINEL_ACUITY`) et celle des brouteuses relâchée (`HERD_RELAX`) — vérifié sur les portées effectives. Une meute de loups n'a **pas** de sentinelle.

## Hors périmètre (et où ça revient)

- **La boucle de chasse** (méfiance, allure, mise à mort propre, sang, vent) : spec `chasse.md` (2026-07-13). Elle **amende R5-R6** — les seuils binaires `alertRange`/`flightRange` deviennent une jauge de méfiance graduelle — sans toucher au reste de cette spec.
- **Peaux et cuir** (GDD §8bis) : c'est un item et une chaîne d'artisanat, pas de la faune. Plus tard, avec le tannage.
- **Migrations de gibier** (GDD §9bis, opportunité mondiale) : c'est un **événement de monde** (`worldevents.ts`), pas un comportement — il déplacera la densité, pas les règles.
- **Pistage, pièges, dépeçage sur place, Traque** (Annexe A) : l'arbre de maîtrise Chasse, hors sujet ici.
- **Prédateurs (meutes)** (GDD §9bis, « le danger de fond des trajets ») : ce sont des monstres agressifs, pas du gibier. Ils réutiliseront l'anneau, mais c'est une décision de danger, pas d'ambiance.

## Ajouts à `balance.ts`

`FAUNA` : plafond ambiant, `SPAWN_EVERY_TICKS`, anneau `[SPAWN_RING_MIN, SPAWN_RING_MAX]`, `DESPAWN_RADIUS`, `SAFE_RANGE`, `GRAZE_SPEED`, `FLEE_SPEED`, `PAUSE_CHANCE`, `BURST_RUN_TICKS`, `BURST_PAUSE_TICKS`, `HERD_ALARM_RADIUS`, `HERD_SPREAD`, `HERD_SPAWN_SPREAD`. Depuis R6/R6bis/R9bis (2026-07-13) : `FLEE_SPRINT` ~1,5 · `BREATHE_GAP` ~12 · `FLEE_GOAL` ~30 · `FLEE_MAX_TICKS` ~15 s · `PERSONAL_SPACE` ~3,5 · `IMPATIENCE_TICKS` ~6 s · `WARY_SPEED` ~0,7 · `HERD_SEPARATION` ~1,2 · `DRIFT_SLICE_TICKS` ~20 s · `DRIFT_BIAS` ~0,6 · `REST_SPREAD` ~2,5 · `SENTINEL_SHIFT` ~20 s · `SENTINEL_ACUITY` ~1,4 · `HERD_RELAX` ~0,85. `Monster` : `fleeFromX?/fleeFromY?` (le point de peur).
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
