# Le loup — la meute a une adresse

*Source : GDD §8bis (le cercle sauvage), §9bis (« meutes de prédateurs, le danger de fond des trajets » ; « annoncés, pas surprises »), §7 (la faune est le tutorial de combat permanent). Amende `faune.md` R11-R19 et son **choix structurant** (« la faune est ambiante, pas résidente »), `chasse.md` C12, `tension.md` (la nuit qui chasse). Statut : **implémenté** (2026-08-28 — L1-L15, gardes `loup.test.ts` + amendements `faune.test.ts` ; le POI `louviere` est posé par zonegen, l'art client livré en première passe — planche DA à revoir). Jalon : chantier ambiance / Gate 1.*

---

## Objectif de design

Le loup d'aujourd'hui est un **danger sans domicile**. Il naît dans un anneau autour du joueur, il chasse, il mange, il se dissipe. Tout ce qu'il fait est bon — l'encerclement, la traque camouflée, le bond, l'alpha qu'on décapite — mais **rien de tout cela n'a lieu quelque part**. Le joueur ne peut pas dire « la meute du Coude de la rivière » ; il ne peut que dire « il y a eu des loups ».

On veut qu'une meute soit **un voisin**. Elle vit à un endroit qu'on peut trouver, apprendre, contourner ou attaquer. Elle a une journée : elle dort, les petits jouent, un adulte fait le tour. Quand elle a faim, **elle part** — et c'est un fait du monde, pas une réaction à votre présence. Elle va manger là où le gibier vit, elle rentre, et le cycle recommence.

La conséquence recherchée est la même que celle des coins de chasse (`faune.md` R17), un cran plus loin : **la carte s'apprend**. La clairière riche est aussi la clairière gardée. Traverser un col au crépuscule cesse d'être une roulette et devient une décision : *je sais qui habite là, et je sais s'ils sont sortis.*

---

## Ce qui existe déjà, et qu'on ne réécrit pas

À lire avant de coder : **six des comportements demandés sont livrés**, testés, et calibrés à la mesure. Cette spec les REPREND telles quelles ; elle n'ouvre que ce qui manque.

| Comportement | Où | État |
|---|---|---|
| Meute avec alpha (PV ×1,9, dégâts ×1,45), meute qui retient son nom | `faune.ts` `promoteToAlpha`, `Monster.alphaId` | ✅ `faune.md` R12 |
| **Alpha mort → déroute immédiate**, dans le tick, wind-up lâché | `disperseLeaderless` | ✅ A13 |
| Encerclement : postes sur le cercle par rang, relèvement premier avec 8 | `encirclePost`, `packInPlace` | ✅ R11 |
| Traque : allure `STALK_SPEED`, camouflage `STALK_STEALTH`, ruée quand le cercle est bouclé ou la proie levée | `wolfStep` | ✅ R11 |
| Le bond, cap verrouillé au départ, encorne une fois, retombe à découvert | `startLeap`/`leapStep` | ✅ R19 |
| La rompue individuelle sous `PACK_BREAK_HP` (35 %) | `wolfStep` §1 | ✅ R11 |
| Le repas et la satiété (il mange, puis il vous laisse passer) | `feedStep` | ✅ R15 |
| Les heures (courbe nocturne, `WOLF_DAY_FLOOR`, `isResting`) | `activityAt`, `wolfVigor` | ✅ R10bis |
| Le feu qui repousse, le hurlement d'annonce, la poursuite à deux portées | `underFireWard`, `howlOnce`, `chooseQuarry` | ✅ R13 |
| **Le dos coûte cher** : ×1,3 sur toute cible prise dans l'arc arrière | `combat.ts`, `COMBAT.BACK_DAMAGE_FACTOR` | ✅ `combat.md` R6ter |
| Le saignement, sur les bêtes **et sur les avatars** (`wounds.bleeding`), et la préférence du prédateur pour le sang | `combat.ts`, `faune.ts` `bleeds` | ✅ `chasse.md` C12 |
| La résidence de lieu : `homePoi`, `state.dens`, `denRespawns`, cap par lieu, jamais sous les yeux | `poi.ts` `spawnPoiMonsters`/`advanceDens` | ✅ R16 |
| Le regard directionnel des bêtes (`facing` posé par le pas) | `monsters.ts` `moveToward` | ✅ `chasse.md` C4 |

**Ce qui manque**, et que cette spec ouvre : la résidence du loup, les petits, la jauge de faim, le cycle gîte↔chasse, la manœuvre de revers, la rage, la déroute collective.

---

## Les décisions (Alexis, 2026-08-28)

Dix questions posées une à une, dix réponses. Elles sont la charte de ce qui suit.

1. **Cohabitation, ambiant aminci.** Les tanières portent la meute et l'essentiel de la densité ; il reste un fond ambiant **solitaire** (jamais de meute ambiante) pour que les trajets gardent du danger et que LA NUIT QUI CHASSE garde ses jambes. *La tanière décide COMBIEN et OÙ, jamais SI* (`geographie-module-jamais-autorise`).
2. **Placement : en lisière d'un coin de chasse**, en couvert, jamais dedans. 6 à 10 meutes sur la carte jouée.
3. **Le gîte est un LIEU** : visible, trouvable, nommé — son propre slug POI, son art.
4. **La faim est par loup ; le départ est décidé par l'alpha.** Les petits restent.
5. **Les petits ne mordent pas**, ils se terrent. En tuer un lève **la fureur du clan**.
6. **Le bond reste la règle sur ce qui bouge**, plus un bond occasionnel sur le reste.
7. **La poursuite reste bornée**, quoi qu'il arrive. Le sang ne prolonge pas : **le sang fait entrer en rage**.
8. **La rage lève les freins d'ENGAGEMENT, pas ceux de survie.**
9. **La déroute se lit à deux échelles** : l'individuelle (existante) et la collective (neuve).
10. **La chasse hors regard se résout en abstrait.** La meute est tickée partout et reste rencontrable ; loin de tout œil, sa faim se remplit sans qu'aucune bête ne meure.

---

## Règles

### La tanière (L1-L4) — la meute a une adresse

- **L1 — Le gîte est un POI, posé par sa propre règle.** Nouveau `slug` dans `POI_TYPES` (la `taniere` à sanglier garde le sien), `family: 'danger'`, `monster: 'wolf'`. Il **ne joue pas la loterie des zones** (`horsSemis`, précédent du Charnier) : son adresse n'est pas un biome, c'est **une relation** — un coin de chasse.
  - **Il se pose en lisière d'un coin, jamais dedans** : entre `DEN_FROM_GROUND_MIN` et `DEN_FROM_GROUND_MAX` du cœur du coin, sur une tuile **de couvert** (forêt, pinède, mélézin, vieille forêt, roche, blocs) et marchable. Un coin qui n'offre aucune tuile de couvert dans l'anneau **ne reçoit pas de gîte** — la vallée a le droit d'avoir des clairières sans meute, et c'est ce qui donne leur poids à celles qui en ont une.
  - Un coin porte **au plus une** tanière. Sur la carte jouée : 6 à 10 gîtes, 30 à 50 loups résidents (mesuré : 6-10 coins de chasse par graine, voisin médian ~230-280 t).
  - **La distance dit la boucle** : 30 à 60 tuiles de trajet, soit ~10 s au trot. Le cycle se voit dans une session.

- **L2 — La composition : 1 alpha + 2 adultes + 2 petits.** Posée par le lieu, pas par `herdSize` — `MONSTER_DEFS.wolf.herdSize` continue de régir le **chemin ambiant**, qui, lui, tombe à un loup solitaire (L4). Deux chemins, deux compositions, et il faut les écrire séparément.
  - Les cinq partagent un `herdId` et un `alphaId`, comme aujourd'hui. Tous portent `homePoi`.
  - Les résidents **ne sont pas `ambient`** : ils ne se dissipent jamais.

- **L3 — Le gîte respire, il ne se farme pas.** Il repeuple par la machinerie existante (`advanceDens`) : cap du lieu = **5**, délai `DEN_RESPAWN_TICKS`, **jamais sous les yeux** (`DEN_SPAWN_CLEARANCE`).
  - ⚠ **`advanceDens` compte ses résidents sur `homePoi` seul.** Or `disperseLeaderless` pose `routed` et efface `herdId` — **pas `homePoi`**. Quatre survivants en déroute tiendraient donc le gîte à son cap **pour toujours**, et il ne repeuplerait jamais. *Un plafond compte ce qu'il borne* : le compte des résidents **exclut les loups en déroute** (ils ont quitté le clan ; ils redeviennent des bêtes du monde, et se dissipent comme telles au bout de `ROUTED_LINGER_TICKS`).
  - **Le repeuplement rétablit la composition**, il ne pose pas cinq loups au hasard : d'abord l'alpha s'il manque, puis les adultes, puis les petits.

- **L4 — L'ambiant tombe au rôdeur solitaire.** Le peuplement ambiant continue de poser des loups (le gradient de danger, le quota, l'appel du sang restent), mais **il n'ouvre plus de meute** : un loup ambiant naît seul, sans `herdId`, sans alpha. Il rôde, il ne mord pas un homme seul (le courage, R11) — il est la rumeur, pas la sentence.
  - **La nuit qui chasse (`nighthunt.ts`) est inchangée** : ses rôdeurs restent `ambient` + `nightHunter`, exemptés du courage. C'est elle qui garantit « loin d'un Feu, on est chassé », et elle ne dépend d'aucune géographie.
  - ⚠ **`herdCost` DOIT suivre, et ce n'est pas un détail de plomberie.** Le poids de tirage d'une espèce est divisé par ce qu'elle COÛTE en places (`herdCost` = moyenne de `herdSize` ; pour le loup, 3,5 aujourd'hui) — c'est la règle qui a tué la monoculture de cerfs. Un loup ambiant solitaire coûte **une** place : `herdCost` doit donc rendre **1**. L'arithmétique est invariante (poids ÷ coût × coût = même densité), et c'est exactement ce qu'on veut : **la même quantité de loups ambiants, éparpillés en solitaires au lieu d'arriver par paquets de trois ou quatre.** Laisser 3,5 diviserait leur présence par 3,5 en silence ; poser 1 sans rendre le loup solitaire la multiplierait par 3,5 — et le mur de 19 loups reviendrait par cette porte-là. **Tout amincissement voulu au-delà est un nombre EXPLICITE, jamais un effet de bord du diviseur.**
  - ⚠ **La garde « deux places libres pour ouvrir une meute » s'inverse.** `if (predRoom < 2) → pas de prédateur` existe parce qu'« un loup seul n'ose pas, et un demi-quota ne fabriquerait que des rôdeurs inutiles ». Le rôdeur solitaire est désormais la sortie VOULUE : la garde tombe à `predRoom < 1`. Sans ça elle bloquerait précisément ce qu'on cherche, pour une raison qui n'existe plus.
  - ⚠ **Le quota de prédateurs d'un coin (`PREDATOR_SHARE`) ne compte aujourd'hui que les `ambient`.** Une meute résidente venue chasser s'ajouterait donc PAR-DESSUS les 6 places ambiantes — jusqu'à 11 prédateurs dans une clairière, et le mur de 19 loups revient par la porte de derrière. **Les résidents présents dans un coin comptent dans son quota** ; c'est le nombre de loups QUE LE JOUEUR VOIT qui doit être borné, pas le nombre qu'une fonction a fabriqués.

### La journée (L5-L7) — ils vivent chez eux

- **L5 — Au gîte, tant qu'ils n'ont pas faim.** Un loup résident non affamé ne chasse personne, ne rôde pas, ne poursuit rien. Il tient dans un rayon `DEN_HOME_RADIUS` autour du gîte et il y fait sa vie :
  - **il se repose** — hors de ses heures (`isResting`, courbe nocturne), il se couche, resserré avec les siens (`REST_SPREAD`, comme la harde R9) ;
  - **les petits jouent** — dans un rayon `PUP_PLAY_RADIUS`, plus court et plus vif que le broutage : ils se poursuivent entre eux (cible = un autre petit, dérivée du tick et de leur rang, sans tirage) ;
  - **un adulte fait le tour** — à tout instant, **un** adulte au plus est en ronde (le tour se dérive du rang et du tick, comme la sentinelle de harde `sentinelOf` : zéro état stocké, calculable par le client). Il s'écarte jusqu'à `DEN_PATROL_RADIUS` et revient.
  - **Ils se défendent.** Qui les frappe les trouve en face — la branche « repu mais agressé » existe déjà et vaut ici mot pour mot. Approcher un gîte n'est pas gratuit ; c'est simplement *silencieux* tant qu'on ne touche à rien.

- **L6 — La faim est une jauge, et elle est à chacun.** `Monster.faim` ∈ [0, 1] : 0 = repu, 1 = affamé. Elle monte en continu (`FAIM_PAR_TICK`), plus vite pendant les heures actives que pendant le repos. Elle remplace `satedUntil` sur le loup — le champ reste pour les autres prédateurs à venir.
  - **Une proie mangée en rend `FAIM_PAR_PROIE`** (≈ 0,55) : il en faut donc **une ou deux** pour se refaire, et la seconde n'est prise que si la première n'a pas suffi. C'est la demande, chiffrée.
  - **Les petits n'ont pas de jauge** : ils sont nourris par le clan. Un retour de chasse les rassasie par construction (pas d'état, pas de règle — ils n'ont jamais faim).

- **L7 — L'alpha lève la meute.** Quand la faim de l'alpha franchit `FAIM_DEPART` (≈ 0,7), **les adultes partent avec lui** ; les petits restent au gîte. Le départ est un **fait de clan**, pas une somme d'envies : c'est ce qui fait que « ils rentrent » se voit comme un moment.
  - **Si l'alpha est mort**, il n'y a plus de clan (`disperseLeaderless`) : chaque survivant garde SA jauge et redevient un animal seul. La règle ne laisse pas d'orphelin sans faim.

### La chasse (L8-L10) — ils sortent, ils mangent, ils rentrent

- **L8 — Ils vont au coin de chasse le plus proche.** `nearestGround` existe. Le plus proche est normalement le leur (30-60 tuiles) ; il ne l'est plus si ce coin a été **vidé** (la pression de chasse, R16) — la meute pousse alors vers le suivant. Le joueur qui épuise une clairière **envoie sa meute plus loin**, et c'est un effet de monde qu'on n'a pas eu à écrire.

- **L9 — Sous les yeux, la chasse est vraie ; hors regard, elle est abstraite.** *(décision ⑩)*
  - **Un avatar à moins de `CHASSE_REELLE` du loup** — le seuil se pose **à l'intérieur** de la zone qui porte du gibier (sous `SPAWN_RING_MAX`), jamais au-delà de `DESPAWN_RADIUS` : tout se joue pour de bon — acquisition, traque, encerclement, bond, mise à mort, `feedStep` sur la carcasse. Le joueur peut voir la meute chasser, lui voler sa proie, ou se faire prendre pour la proie.
  - **Personne à portée** : la meute est **toujours tickée** — elle quitte le gîte, elle est réellement sur la route, on peut la CROISER en chemin (c'est le danger de fond des trajets). Mais arrivée au coin, elle « chasse » pendant `CHASSE_ABSTRAITE_TICKS` et sa faim se remplit **sans qu'aucune bête ne meure**. Rien ne se simule là où personne ne regarde, exactement comme le gibier ambiant qui n'existe pas à 200 tuiles.
  - ⚠ **C'est cette règle qui rend la boucle jouable du tout** : le gibier est ambiant (`faune.md` R1/R3) — il ne naît qu'autour d'un avatar et se dissipe à 52 tuiles. Sans L9, une meute qui a faim pendant que le joueur est ailleurs marche jusqu'à un coin **vide** et le cycle ne se ferme jamais. *Un banc qui pose un joueur et un cerf testerait vert et le jeu serait mort* — la prémisse que le banc fabrique.

- **L10 — Repue, elle rentre.** Faim sous `FAIM_RETOUR` (≈ 0,15) : demi-tour, retour au gîte, et L5 reprend. En chemin elle ne chasse plus — mais elle se défend toujours.

### Le combat (L11-L13) — le répertoire

- **L11 — Le répertoire se choisit sur l'ALLURE de la cible.** « Lente » se dérive de l'allure du loup lui-même, jamais d'un littéral : `CIBLE_LENTE = allure effective de la cible < allure du loup × SEUIL_LENTEUR`. Un cerf qui broute est lent ; le même cerf levé (6,9 t/s contre 4,8) ne l'est plus. Un homme qui marche est lent ; un homme qui sprinte ne l'est pas.

  | Cible | Ce que fait la meute |
  |---|---|
  | **Lente** | **Encerclement** (postes, traque camouflée, ruée) et **prise à revers** (L12). Plus un bond **de temps en temps** — rare, cadencé (`BOND_LENT_COOLDOWN`), pour casser le rythme. |
  | **Rapide** | **Le bond**, la règle mesurée de R19 : une morsure plantée ne touche JAMAIS ce qui avance (46 coups armés, 0 dégât). On ne touche pas à ça. |

- **L12 — La prise à revers est une MANŒUVRE, pas un bonus.** Le bonus existe déjà (`BACK_DAMAGE_FACTOR` ×1,3, arc arrière de 120°) et s'applique à tout le monde. Ce qui manque, c'est l'**intention** : contre une cible lente, le poste d'encerclement d'un loup n'est plus tiré de son seul rang — **le relèvement le plus proche du dos de la cible est attribué en priorité**, au loup le mieux placé pour l'atteindre. Le cercle se ferme toujours ; il se ferme **avec quelqu'un derrière**.
  - Le dos se lit sur `facing`, que **les bêtes posent** (`monsters.ts:520`, chasse C4) — donc contre le joueur ET contre le gibier. **Pas contre un PNJ** : `npc.ts` n'écrit jamais `facing`, un villageois garde éternellement le cap de sa naissance (plein est), et lire son dos rendrait un verdict tiré au sort par la géographie. Contre un PNJ, le poste reste celui du rang.

- **L13 — La rage.** Un état de clan, **deux déclencheurs**, une seule règle.
  - **Elle s'allume** quand (a) la cible **saigne** — bête `bleedMortal`/`bleedUntil`, ou avatar `wounds.bleeding` — ou (b) **un petit du clan est tué** (la fureur, décision ⑤ : tous les adultes, même partis chasser, rentrent sur le meurtrier).
  - **Elle lève les freins d'ENGAGEMENT** : le courage ne retient plus (un loup enragé mord seul), plus de rôdage ni de traque camouflée (il fonce), le bond part plus souvent, et la poursuite s'allonge de `PURSUIT_RANGE` à `PURSUIT_RANGE_RAGE` — **bornée**. Une meute ne poursuit jamais à l'infini.
  - **Elle ne lève AUCUN frein de survie** : la rompue individuelle tient, la déroute collective tient, la mort de l'alpha disperse toujours. Un loup enragé engage plus ; il ne meurt pas plus bêtement. **Les trois soupapes de R13 restent ouvertes.**
  - **Elle s'éteint** au bout de `RAGE_TICKS` sans nouveau déclencheur, ou dès la déroute.
  - **Elle se voit** : le hurlement de la fureur est émis une fois (`howlOnce` a déjà la grammaire), et le client en tire une posture. Une rage muette serait une punition sans annonce — GDD §9bis.

### La déroute (L14) — deux échelles

- **L14 — Un loup rompt pour lui ; une meute casse ensemble.**
  - **Individuelle** (existante, inchangée) : sous `PACK_BREAK_HP` de ses PV, il décroche et ne revient pas. *Un loup ne se sacrifie pas.*
  - **Collective** (neuve) : quand le clan a perdu **la moitié de ses adultes**, **tous** rompent dans le tick — blessés ou pas, enragés ou pas. C'est le pendant graduel de la mort de l'alpha : on n'abat pas cinq loups, on en abat deux et le reste comprend.
  - Les deux se superposent, et le joueur apprend à les distinguer : *un loup qui lâche parce qu'il souffre*, et *la meute qui casse parce qu'elle a compris*.

### Les petits (L15)

- **L15 — Ils ne mordent pas.** `damage` nul, PV faibles, allure vive. Menacés, ils courent à la gueule du gîte et s'y terrent. Ils **ne comptent pas** dans le courage (`PACK_COURAGE`), ils ne prennent **pas** de poste d'encerclement, ils ne partent **jamais** en chasse.
  - **Ils sont tuables**, et le geste a une suite : la **fureur du clan** (L13). Sans ça, un gîte vidé de ses adultes serait de la viande gratuite — le robinet exact que R16 a été écrit pour fermer.
  - Loot maigre (`raw_meat: 1`), et **pas d'os** : ce n'est pas une source de matériau.
  - ⚠ **L'alignement ne les couvre pas.** Ses axes ne connaissent que les actes envers des **gens** (don, soin, premier sang, meurtre). Tuer un louveteau n'a **aucune conséquence morale** disponible aujourd'hui. C'est un manque assumé, consigné ici pour qu'on ne le croie pas traité.

---

## Ce que ça change dans les specs existantes

- **`faune.md` — « Le choix structurant : la faune est ambiante, pas résidente »** : à amender. Le loup rejoint le sanglier de tanière et le Cendreux de repaire du côté résident. L'argument d'origine (coût de transport, `entities.find` en O(n²)) tient toujours pour le **gibier** ; il ne tient pas contre 30-50 loups sur un plafond de 600. **À mesurer, pas à affirmer** (`tools/profil-tick.mts`).
- **`faune.md` A14** — « la meute ne lâche sa proie qu'au-delà de `PURSUIT_RANGE` » devient faux en rage (`PURSUIT_RANGE_RAGE`). Critère à réécrire.
- **`faune.md` R18** — le quota de prédateurs doit compter les résidents présents (L4).
- **`faune.md` R11** — le courage gagne une troisième exemption : la rage (après le rôdeur de nuit).
- **`chasse.md` C12** — « le prédateur préfère le sang » se double d'un effet : le sang **enrage**.
- **`tension.md`** — inchangée, et c'est délibéré (L4).
- **`faune.md` A14 reste STALE jusqu'à l'implémentation** : le critère affirme aujourd'hui que la meute ne lâche qu'au-delà de `PURSUIT_RANGE`, ce qui restera vrai tant que la rage n'existe pas. On le réécrit **avec** le code, pas avant — un critère amendé pour un système absent serait rouge sans rien apprendre.

---

## Critères d'acceptation

*Headless, `/sim`, sur le monde joué (`MONDE_JOUE`) sauf mention contraire.*

- **L1 — L'adresse.** Sur 5 graines : chaque gîte est à une distance comprise entre `DEN_FROM_GROUND_MIN` et `DEN_FROM_GROUND_MAX` du cœur d'un coin de chasse, sur une tuile de couvert marchable ; **aucun coin n'en porte deux** ; le nombre de gîtes est compris entre 4 et 12. Une carte sans coin de chasse ne pose **aucun** gîte.
- **L2 — La composition.** Un gîte fraîchement peuplé porte exactement 1 alpha, 2 adultes, 2 petits ; les cinq partagent `herdId` et `alphaId` ; l'alpha porte `ALPHA_HP` fois les PV d'un adulte ; **aucun n'est `ambient`**.
- **L3 — Il respire, et il ne se farme pas.** Meute abattue → aucun retour avant `DEN_RESPAWN_TICKS` ; **aucun retour tant qu'un avatar est à moins de `DEN_SPAWN_CLEARANCE`** ; le retour rétablit la composition (alpha d'abord). **Et le contre-test** : quatre survivants **en déroute** ne bloquent PAS le repeuplement — le gîte revient à son cap.
- **L4 — L'ambiant ne fait plus meute.** Sur 3 000 ticks de peuplement, **aucun** loup ambiant ne naît avec un `herdId` ; le rôdeur solitaire, lui, naît toujours (le compte ne tombe pas à zéro). Et **la nuit qui chasse envoie toujours ses rôdeurs** (garde `tension.test` existante, verte).
- **L5 — La vie du gîte.** Meute non affamée, 600 ticks : aucun loup ne franchit `DEN_HOME_RADIUS` sauf **au plus un** à la fois (la ronde) ; hors de ses heures la meute est couchée et resserrée ; les petits restent dans `PUP_PLAY_RADIUS` et **changent de compagnon de jeu** au cours de la fenêtre. **Contre-test** : frappez-en un, et la meute vous prend en face dans le tick.
- **L6 — La jauge.** `faim` monte de façon monotone au repos ; **une** proie mangée la fait tomber sans l'annuler, **deux** la rendent sous `FAIM_RETOUR`. Un petit n'a jamais faim.
- **L7 — Le départ.** Faim de l'alpha au-dessus de `FAIM_DEPART` : les deux adultes ET l'alpha quittent le gîte dans la même fenêtre ; les deux petits n'en bougent pas. **Contre-test** : la faim d'un adulte seul poussée au maximum, l'alpha repu — **personne ne part**.
- **L8 — Le cap.** La meute vise le coin de chasse le plus proche. Coin d'origine vidé (silence de R16 armé) → elle vise le **suivant**, mesuré sur les distances.
- **L9 — Les deux régimes.** (a) Avatar à portée : la meute tue réellement une proie, la carcasse existe, `feedStep` s'y plante, la faim tombe. (b) **Aucun avatar dans la vallée** : la meute quitte le gîte, arrive au coin, sa faim tombe quand même, et **`state.corpses` n'a pas grossi d'une bête**. (c) **Sur la route, elle est rencontrable** : un avatar placé entre le gîte et le coin la voit passer et peut être pris pour cible.
- **L10 — Le retour.** Faim sous `FAIM_RETOUR` → tous les partants regagnent `DEN_HOME_RADIUS` en un temps borné, et **ne chassent personne en chemin** (contre-test : un cerf posé sur le trajet survit).
- **L11 — Le répertoire.** Cible lente (homme figé) : le cercle se ferme sur **au moins 3 côtés** avant la première morsure, et un bond survient **au plus** une fois par `BOND_LENT_COOLDOWN`. Cible rapide (homme qui s'éloigne) : le bond reste le geste dominant et **la létalité mesurée de R19 ne baisse pas** (`tools/diag-recul.mts`, 6 graines, l'homme meurt ≥ 5/6 — c'est le garde-fou de la décision ⑥).
- **L12 — Le revers.** Cible lente, meute de 3 : au moins un loup tient un poste **dans l'arc arrière** de la cible (`BACK_ARC_COS`) avant la ruée, et au moins un coup encaissé porte le facteur ×1,3. **Contre-test PNJ** : la même mesure contre un villageois (dont `facing` est mort) ne fabrique **aucun** poste privilégié — les postes restent ceux du rang.
- **L13 — La rage.** (a) Un loup **seul** face à un homme intact rôde sans mordre ; le **même** loup face au **même** homme qui **saigne** mord. (b) Tuer un petit : tous les adultes du clan, même partis, prennent le meurtrier pour cible dans les `RAGE_ONSET` ticks, et un hurlement est émis **une fois**. (c) **Les soupapes tiennent** : enragé et blessé sous `PACK_BREAK_HP`, il rompt quand même ; alpha tué en pleine rage, la meute se disperse quand même dans le tick. (d) La poursuite en rage s'arrête à `PURSUIT_RANGE_RAGE` — **elle s'arrête**. (e) La rage retombe après `RAGE_TICKS` sans nouveau sang.
- **L14 — La déroute collective.** Meute de 3 adultes : tuer le 2ᵉ met **les survivants** en déroute dans le tick, quel que soit leur état de PV. Tuer le 1ᵉʳ ne suffit pas. **Contre-test** : la rompue individuelle marche toujours seule (un loup à 20 % décroche même dans une meute intacte).
- **L15 — Les petits.** Un petit n'arme **jamais** d'attaque, sur toute la durée d'un banc où on le harcèle ; menacé, il rejoint la gueule du gîte ; il ne compte pas dans `packNearby`.
- **Perf** — `tools/profil-tick.mts` : le coût du tick avec 10 gîtes peuplés (50 résidents) et aucun joueur à proximité reste sous **+0,15 ms/tick** contre la même carte sans gîtes. *C'est la mesure qui autorise la résidence, et c'est l'argument même que le « choix structurant » de `faune.md` opposait.*
- **Déterminisme** — `replay.test` et `events.test` verts ; empreinte relevée avant/après (`tools/empreinte-sim.mts`, `ASHES_SANS_CACHE=1`). ⚠ Changer le nombre d'entités qui naissent **décale le flux RNG seedé** : la bascule de l'ambiant vers le solitaire (L4) va casser des tests sans rapport, et c'est attendu.

---

## Les nombres

Tout va dans `FAUNA` (`balance.ts`) — ce sont des réglages qu'on calibre **en jouant**, sauf la géométrie de pose du gîte (L1), qui se calibre **en regardant une carte** et vit donc avec `POI_PLACEMENT`.

| Nom | Valeur de départ | Ce qu'il règle |
|---|---|---|
| `DEN_FROM_GROUND_MIN` / `MAX` | 30 / 60 t | la lisière : assez loin pour n'être pas dans le pré, assez près pour que la boucle se voie |
| `DEN_CAP` | 5 | 1 alpha + 2 adultes + 2 petits |
| `DEN_HOME_RADIUS` | 10 t | l'emprise du gîte |
| `DEN_PATROL_RADIUS` | 22 t | la ronde de l'adulte de garde |
| `PUP_PLAY_RADIUS` | 5 t | le jeu des petits |
| `ROUTED_LINGER_TICKS` | ticksFor(120) | un déserteur finit par quitter le monde |
| `FAIM_PAR_TICK` | ≈ 1 / ticksFor(600) | ~10 min pour passer de repu à affamé |
| `FAIM_PAR_PROIE` | 0,55 | une proie ne suffit pas tout à fait ; deux, oui |
| `FAIM_DEPART` | 0,70 | le seuil de l'alpha |
| `FAIM_RETOUR` | 0,15 | le demi-tour |
| `CHASSE_REELLE` | **40 t** | au-delà, la chasse est abstraite — et le nombre est **sous** l'anneau de naissance du gibier (`SPAWN_RING_MAX` = 42), pas au-delà de sa dissipation (52). Le mode « vrai » n'a de sens que là où des proies EXISTENT : un loup à 55 tuiles d'un avatar chasserait pour de bon dans une bande où rien ne peut naître |
| `CHASSE_ABSTRAITE_TICKS` | ticksFor(70) | le temps d'une chasse qu'on ne voit pas |
| `SEUIL_LENTEUR` | 0,9 | « lente » = sous 90 % de l'allure du loup |
| `BOND_LENT_COOLDOWN` | ticksFor(6) | le bond de rupture de rythme |
| `PURSUIT_RANGE_RAGE` | 40 t | la poursuite enragée — **bornée** |
| `RAGE_TICKS` | ticksFor(45) | ce que dure une rage sans nouveau sang |
| `RAGE_ONSET` | ticksFor(2) | le délai de propagation au clan |
| `PACK_ROUT_LOSS` | 0,5 | la moitié des adultes perdue casse le clan |

---

## Amendements du 2026-08-28 (Alexis, en jouant) — le bond devient LISIBLE

- **La cadence du bond (`LEAP_COOLDOWN`, 3,5 s).** « Il peut le spam sans que le joueur comprenne pourquoi » : le bond ne payait que la cadence d'une morsure (1,5 s) alors que sa récupération en dure 1,6 — relevé, il repartait aussitôt. Désormais `bondAt` (écrit par `startLeap`, le seul point de départ d'un bond) impose 3,5 s entre deux bonds du MÊME loup ; le premier bond reste immédiat (c'est lui qui ouvre la chasse — R19) ; entre deux, il vient mordre au contact, wind-up visible. La rage la raccourcit de moitié. **Mesuré** : la létalité de meute ne bouge pas d'un dixième (diag-recul 5/6, 3,4-4,3 s — bit-identique), et A14 (l'homme qui fuit meurt) reste vert.
- **La détente (`LEAP_CROUCH_TICKS`, 0,45 s).** « Une charge immobile courte avant que le loup saute afin qu'on puisse voir l'attaque arriver » : le bond s'ANNONCE — le loup se tasse, immobile, silhouette tapie + teinte de menace (le vocabulaire du sanglier planté, GDD §9bis « annoncés, pas surprises »), le regard suivant la proie. **Le cap se verrouille AU DÉCOLLAGE**, pas au tassement : l'esquive reste le pas de côté pendant le vol (0,8 s, inchangé) — la détente l'annonce, elle ne l'élargit pas. Une proie tombée pendant la détente fait avorter le bond (payé quand même : pas de coup gratuit). La déroute lâche la détente comme elle lâche le wind-up.
- **La digestion restaurée (R15).** La première écriture de la jauge avait perdu la TRÊVE du repas : un rôdeur de nuit à 0,45 de faim restait en chasse et fauchait une colonne de raiders entière (mesuré au diag-raid : butin rentré 0/24, raiders vivants 0/4). Deux horloges, deux rôles : `satedUntil` fait la trêve (« il mange, puis il vous laisse passer » — vrai à CHAQUE proie), `faim` fait le cycle (départ, retour).

## Écarts d'implémentation (2026-08-28) — ce que le code a appris à la spec

- **« Cible lente » se lit sur `moved`, pas sur un ratio d'allure** : la sim ne stocke aucune vélocité par entité, et le bond-sur-ce-qui-avance (R19) reste la règle au-dessus. Le bond de rupture et la prise à revers s'arment sur la cible **arrêtée** (`!moved`) ; `SEUIL_LENTEUR` n'existe pas. **Mesuré** : la prise à revers calculée sur une proie qui marche faisait TOURNER les postes (le « mieux placé » changeait de tête à chaque pas) — 7 retournements de regard/s pour un plafond de 4 (garde A12bis).
- **`RODEUR_PART` (0,3) est né au premier run** : retirer `herdSize` a fait tomber `herdCost` de 3,5 à 1 et TRIPLÉ la fréquence de tirage du loup ambiant — la souille se vidait de ses sangliers (garde A27). L'amincissement voulu par la décision ① est ce nombre, explicite.
- **Le nom du POI est `louviere`** (« la Louvière ») — vieux français pour tanière de loups ; la `taniere` à sanglier garde le sien.
- **La fureur ne prend le meurtrier pour cible que s'il est sous `PURSUIT_RANGE_RAGE`** de chaque adulte — sinon l'adulte rentre au gîte et l'y trouvera s'il y est encore. La poursuite reste bornée jusque dans la fureur (décision ⑦).
- **La défense de clan est bornée à `PURSUIT_RANGE` de soi** : un gîte défend son seuil, il ne poursuit pas son agresseur à travers la vallée.
- **L'ex-satiété** : `satedUntil` reste pour les prédateurs à venir ; le loup vit sur `faim` seul.
- **Le rôdeur de nuit** (`nightHunter`) chasse toujours, faim ou pas — il a été ENVOYÉ ; sa jauge existe mais ne le gate pas.

## Ce qui reste ouvert

0. **Vérifié avant d'écrire** : les POI `horsSemis` (Charnier, Stèle) passent bien par `poserLieu`, qui pousse dans `map.zones` avec leur `kind` — donc la pose de L1 et la machinerie de repeuplement de L3 (qui itère `map.zones` et indexe `state.dens`) se rejoignent. Rien à inventer de ce côté.
1. **Le nom des gîtes.** Un lieu trouvable devrait se nommer (fiche-lieu, encyclopédie). Toponymie à trancher — c'est la même question en suspens que celle des affleurements.
2. **L'art du gîte** : gueule sous roche ou souche déchaussée ? os, terre foulée ? C'est une planche à rendre avant de bâtir, pas une décision de code.
3. **La conséquence morale du louveteau** — aujourd'hui aucune (l'alignement ne connaît que les gens). Faut-il ouvrir un axe « ce qu'on fait au vivant » ? Question de design à part entière.
4. **Le dépeçage d'un louveteau** — `depecage.md` n'a pas de table pour lui. Loot maigre posé ici par défaut ; à confirmer.
5. **La croissance.** Aucun système d'âge : un petit reste petit. Un gîte qui « fait grandir » ses louveteaux serait un vrai écosystème, et c'est un chantier à lui seul.
