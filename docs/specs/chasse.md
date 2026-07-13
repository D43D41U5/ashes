# La chasse — l'approche, la mise à mort, le sang

*Source : GDD §8bis (« le geste » de la chasse : pistage/**approche**/tir ; le gibier comme ressource de territoire), §7 (le combat positionnel s'apprend contre la faune), §9bis (« annoncés, pas surprises »). S'appuie sur la spec `faune.md` (R4-R6 : brouter/alerte/fuite ; R9 : la harde ; R15 : la satiété ; R16 : la pression de chasse) — elle en **amende** R5-R6 — et étend `combat.md` (R4-R5). Statut : **LES TROIS PALIERS SONT IMPLÉMENTÉS** (2026-07-13). CHASSE I (C1-C7), CHASSE II (C8-C12) et CHASSE III (C13-C18) vivent dans `/sim`, avec leurs bancs headless (A1-A19), leurs affordances client (C19 : postures, teintes, sang au sol, piles, vent visible) et le scénario `pnpm smoke --scenario chasse --dev` qui joue la boucle entière dans le vrai jeu — approcher, lever, récolter, jeter. Reste le **calibrage à l'œil** (`--headed`) : les nombres de `HUNT` sont des ordres de grandeur, et c'est en jouant qu'on les arrête. Jalon : chantier Veillée / GATE 1 — rien ici n'exige le réseau. Les quatre décisions de design sont tranchées (utilisateur, 2026-07-13 — consignées en fin de spec).*

## Objectif de design

La spec faune a rendu le monde **habité** : le gibier broute, s'alerte, détale en à-coups ; le sanglier décide ; la meute manœuvre. Mais la chasse, elle, n'a toujours qu'un verbe : **courir**. Trois trous structurels, et aucun ne se bouche avec des constantes :

1. **L'approche est binaire.** `alertRange`/`flightRange` sont des murs géométriques. Une fois appris, le puzzle est résolu : on connaît LE rayon, on s'arrête à LA distance, et il ne se passe plus rien. Pas de tension, pas de rattrapage, pas de progression du joueur — la distance de fuite d'un cerf n'est pas un gameplay, c'est une FAQ.
2. **L'approche ne paie pas.** Même parfaite, elle n'achète que le premier coup d'une course-poursuite. Le fantasme du chasseur — la mise à mort propre, silencieuse — n'existe pas dans le jeu.
3. **L'échec ne donne rien.** Bête levée = bête perdue. Coup raté = course perdue. Or ce qui fait la chasse dans les jeux qui l'ont réussie, c'est que **l'échec transforme la partie au lieu de l'annuler** : la bête blessée qui s'enfuit ouvre la traque, elle ne ferme pas la chasse.

Ce que cette spec construit, en une histoire de joueur :

> Je repère la mare où boivent les cerfs au crépuscule. J'arrive sous le vent, je lis la sentinelle, j'avance dans l'herbe haute par à-coups — deux fois la bête lève la tête et me fige. À dix mètres, lance chargée : la mise à mort propre, ou la harde qui éclate. Si je blesse : le sang au sol, la traque, la bête couchée dans un fourré. Je charge la viande — et un hurlement me dit que j'ai quatre minutes.

Chaque phrase est une règle ci-dessous. Le principe directeur : **chaque phase de la chasse est un jeu à part entière, avec une décision par seconde, un payoff net, et un échec qui ouvre le jeu suivant.**

## Le choix structurant : LA MÉFIANCE remplace les murs

Le cœur de la spec tient en un champ : chaque bête sauvage porte une jauge de **méfiance** (`Monster.suspicion`, 0-1) qui **poursuit** un stimulus continu — vite en montée, lentement en descente — au lieu de comparer une distance à deux rayons.

Ce que la jauge achète, et que les murs n'achèteront jamais : **le stop-and-go**. La bête lève la tête → le chasseur se fige → la jauge redescend → il regagne trois mètres. C'est le « 1, 2, 3, soleil » du chasseur, la boucle seconde-par-seconde qui fait le fun de tous les jeux d'approche — et elle **se rattrape** : être vu n'est plus perdre, c'est un événement à gérer.

Trois propriétés non négociables :

- **La bête EST la jauge.** Pas de barre flottante, pas de picto au-dessus des têtes : la méfiance se lit dans la **posture** (tête baissée / tête levée qui fixe / corps tendu prêt à partir). C'est la règle du télégraphe appliquée à la chasse : ce qu'on voit ne ment pas (decisions 2026-07-13).
- **Elle dégénère proprement.** Un joueur qui marche droit sur un cerf sans se cacher doit le lever à peu près à l'actuel `flightRange` : les murs deviennent le cas particulier « approche naïve » de la jauge. Rien de ce que la faune fait aujourd'hui ne doit se dégrader.
- **Déterminisme trivial** : la jauge est de l'arithmétique pure (`+ - * /`, comparaisons), les angles sont des produits scalaires, les rotations des matrices à coefficients littéraux (précédent : `BEARINGS`, faune.ts). Aucun tirage sauf là où le PRNG tire déjà.

La fuite elle-même ne change pas : à saturation, la bête entre dans la machine existante (R6 faune — à-coups, peur collante, `SAFE_RANGE`). La méfiance remplace le **déclencheur**, pas la fuite.

## Règles

### CHASSE I — l'approche paie (C1-C7)

- **C1 — La méfiance.** Chaque bête sauvage porte `suspicion` ∈ [0, 1].
  - **Le stimulus** dérive de la **distance perçue** (voir C5) rapportée aux portées de l'espèce : nul au-delà du plafond de perception (`alertRange × PERCEIVE_FACTOR`), il croît en s'approchant et **sature à `flightRange` perçu**. Près, la jauge monte beaucoup plus vite que loin (montée en `s²`) : à distance de fuite perçue, elle sature en ~1 s ; à distance d'alerte, en plusieurs secondes.
  - **La poursuite** : si le stimulus dépasse la jauge, elle monte ; sinon elle **décroît** lentement (plusieurs secondes pour retomber). Chaque franchissement du seuil d'alerte rend la bête **nerveuse** : sa décroissance ralentit (facteur cumulable, plafonné) — on ne refait pas indéfiniment la même approche ratée sur la même bête.
  - **Trois seuils lisibles** : `SUSPICION_CURIOUS` (~0,35) — elle s'arrête et **regarde** (l'actuelle alerte R5) ; `SUSPICION_ALERT` (~0,7) — elle est **fixée**, corps tendu, prête ; **1** — elle est **levée** : machine de fuite R6, inchangée.
  - **Les courts-circuits** : un coup encaissé, la contagion d'alarme de la harde (R9), le cri de mort (C7) → `suspicion = 1` immédiatement. Et une menace à moins de `PANIC_RANGE` en distance **brute** (~1,8 tuile) lève la bête quelle que soit la furtivité — on ne marche pas SUR un cerf, si discret soit-on. (La portée de la lance, 2,3, reste au-delà : la mise à mort propre au contact reste possible, la caresse non.)
- **C2 — Le bruit de l'allure.** Le chasseur choisit son allure, et l'allure décide de sa **détectabilité** — sur les deux canaux de C5 : son **bruit** (0,25 / 0,4 / 1 / 1,6 — immobile ≪ pas lent ≪ marche ≪ sprint) et sa **visibilité** (0,25 / 0,55 / 1 / 1,4 — l'œil du gibier accroche le *mouvement* : une silhouette figée redevient un rocher, et c'est la condition mesurée du stop-and-go).
  - Nouvel input de posture **`sneak`** (`MoveInput`, comme `sprint`/`block`) : vitesse × `SNEAK_SPEED_FACTOR` (~0,5), régénération d'endurance de la marche. C'est un ajout au protocole (`protocol.ts`, additif) et un bind client.
  - L'allure effective du tick est posée sur l'entité (`Entity.gait`) et **voyage dans le snapshot** : en multi comme en Veillée, on doit VOIR l'autre ramper — la posture est un télégraphe pour les joueurs autant qu'une entrée pour les bêtes.
  - **Le portage interdit le silence** : au-delà du palier de charge LOURD (spec portage), l'allure ne descend jamais sous le bruit de la marche. On ne rampe pas avec un cerf sur le dos — c'est ce qui rend le retour de chasse bruyant, et le troisième acte possible (C12).
- **C3 — Le couvert.** Chaque terrain gagne un facteur `cover` ∈ ]0, 1] (`TERRAINS`, balance.ts) : la visibilité de **toute menace** est multipliée par le couvert de la tuile **où elle se tient**. Forêt dense, roselière, hautes herbes cachent ; prairie rase et neige exposent. Immobile dans un fourré, on n'existe presque plus. Le facteur s'applique au canal de furtivité existant — un loup qui traque en vieille forêt en profite donc aussi : l'écosystème et le chasseur jouent aux mêmes règles.
- **C4 — Le regard.** La **vue** d'une bête est **directionnelle** : pleine devant, réduite de flanc, faible dans le dos (produit scalaire `facing` · direction-vers-menace, trois secteurs, ordres de grandeur 1 / 0,75 / 0,45). Le pas oriente `facing` — les bêtes regardent où elles marchent, ajouté à `moveToward` pour que « dans le dos » veuille dire quelque chose — : approcher devient un problème de **position**, pas seulement de distance — la première leçon du combat positionnel (GDD §7), avant même le premier coup.
- **C5 — DEUX canaux, entrés UNE fois : la vue et l'ouïe.** La bête perçoit par deux sens et retient le **plus fort** : la **vue** (visibilité de l'allure × couvert × regard) — celle qu'on bat en se cachant, en se figeant, en passant derrière — et l'**ouïe** (le bruit de l'allure, **omnidirectionnel** : ni le fourré ni le dos tourné n'y peuvent rien) — celle qui interdit d'arriver au contact en *marchant*, même de dos. *(La première rédaction disait « un seul produit » ; le banc l'a réfutée deux fois : un marcheur dans le dos devenait inaudible, et une bête en fuite devenait aveugle à ce qu'elle fuyait — l'angle multipliait aussi le bruit.)* Le tout emprunte le canal `Threat` existant (le loup en traque y passe déjà par `STALK_STEALTH`, désormais × couvert — et son « bruit » est une fraction de sa furtivité : un loup est quasi silencieux). **L'acquisition du prédateur consomme la même détectabilité** (`chooseQuarry`, sans secteur aveugle) : le loup vous chasse à la furtivité comme vous le chassez — c'est ce qui rend la décision n°1 réelle — mais la **poursuite** reste à la distance vraie : une meute qui vous a choisi ne vous perd pas parce que vous vous êtes accroupi. L'odorat (C17) sera le seul sens à ignorer ces canaux — c'est précisément ce qui en fera un problème différent.
- **C6 — LA MISE À MORT PROPRE.** Un coup dont le wind-up **démarre** alors que la cible est une bête sauvage sous `SUSPICION_ALERT` inflige `damage × CLEAN_KILL_FACTOR` (~×3). Jugé au départ du coup, pas à l'arrivée : le coup déjà lancé ne devient pas sale parce que la bête a frémi pendant le wind-up.
  - **L'approche parfaite a enfin un payoff décisif** : la lance (16) couche un cerf (45 PV) d'un seul coup propre ; l'épieu (10) prend le sanglier, pas le cerf ; les poings, le lapin seulement. La lance reste « la porte » (faune R13), et la hiérarchie des armes devient une hiérarchie de gibier.
  - C'est **la règle du loup rendue au joueur** : sa traque à lui aussi s'achève par une ruée sur une proie qui n'a rien vu. Une simulation, pas deux jeux.
  - `monster_slain` gagne un champ `clean: boolean` — la chronique saura dire « d'un seul coup, sans un bruit », et la future chaîne du cuir (peaux intactes) aura son point d'ancrage.
- **C7 — LE CRI DE MORT.** Une bête sauvage qui **meurt ou encaisse un coup** porte instantanément la méfiance de tous ses congénères de harde/meute à 1 dans `HERD_ALARM_RADIUS` — même endormis, même dos tourné. Sans cette règle, la mise à mort propre permettrait d'égrener une harde entière en silence (la contagion R9 ne se déclenche qu'à la **vue d'un fuyard** — une bête tuée net ne fuit jamais, donc n'alarme jamais : le trou existe déjà, C6 le rendrait béant). Conséquence voulue : **une seule mise à mort propre par approche de groupe** — la deuxième bête se gagne à la course, ou à la prochaine approche.

### CHASSE II — l'échec fécond : le sang (C8-C12)

- **C8 — La plaie.** Un coup qui ne tue pas une bête sauvage la fait **saigner**, et la gravité décide de tout :
  - **Plaie mortelle** (le coup l'a fait passer sous `MORTAL_BELOW` de ses PV max, ~0,5) : elle perd `BLEED_HP_PER_S` (~0,5 PV/s) **jusqu'à la mort**. Elle est à vous — si vous la retrouvez.
  - **Plaie légère** (au-dessus du seuil) : elle saigne pendant `LIGHT_BLEED_TICKS` (~25 s) puis **la plaie se referme** : la piste s'éteint, la bête survit, nerveuse au maximum (C1). *(Décision ouverte n°3 : la variante « toute plaie est mortelle » est plus généreuse mais transforme la chasse en « toucher une fois et attendre » — voir fin de spec.)*
  - Le choix du chasseur devient réel : **frapper fort** (chargé, de près, propre) **ou perdre la bête** — l'éraflure de loin ne « réserve » pas un cerf.
- **C9 — Le sang au sol.** Toute entité qui saigne — bête blessée, mais aussi avatar porteur d'une blessure `bleeding` (combat R7) : le sang est le sang — sème une goutte tous les `BLOOD_EVERY_TICKS` (~0,8 s) dans `state.blood` (`{x, y, tick}`).
  - **De l'état, pas des événements** : haute fréquence ≠ domaine (règle projet). Le client les dessine et les efface ; personne d'autre ne les consomme.
  - Borné des deux côtés : expiration `BLOOD_TTL` (~3 min) et plafond FIFO `BLOOD_CAP` — l'état reste petit, le snapshot aussi.
  - La piste est **lisible par tous** : suivre du sang frais ne demande aucune maîtrise. Les empreintes, l'âge des traces, le sens de la course — ça, c'est l'arbre Chasse (annexe A), plus tard, par-dessus.
- **C10 — La bête diminuée.** La vitesse d'une bête blessée suit ses PV : `× (WOUNDED_SLOW_FLOOR + (1 − WOUNDED_SLOW_FLOOR) × hp/hpMax)` (plancher ~0,55). L'écart se referme à mesure qu'elle saigne : **presser** une bête mortellement atteinte devient une stratégie — au prix de l'endurance.
- **C11 — Le couché.** Une bête à plaie mortelle qui ne perçoit plus de menace pendant `BED_AFTER` (~10 s) gagne la tuile couverte la plus proche (`cover` le plus bas dans `BED_SEEK`) et **se couche** : immobile, perception effondrée (`BED_ALERTNESS`, comme le sanglier qui fouge). On la retrouve **par le sang**, pas en battant la carte. Relancée, elle offre une dernière fuite, diminuée. **Attendre** devient l'autre stratégie — mais le sang appelle d'autres nez (C12).
- **C12 — LE SANG APPELLE LES LOUPS.** La tuyauterie de la satiété (R15) existe ; on lui donne un odorat :
  - **La carcasse fraîche porte loin** : tant qu'un cadavre a moins de `CARCASS_FRESH_TICKS` (~4 min — `Corpse` gagne `diedAt`) et porte de la viande, les prédateurs affamés le sentent à `CARCASS_SEEK_FRESH` (~40) au lieu de `CARCASS_SEEK` (16).
  - **Le sang pèse au peuplement** : le tirage d'espèce (R2/R10) multiplie le poids des prédateurs par `BLOOD_PREDATOR_BIAS` près d'une carcasse fraîche ou d'une entité qui saigne — il se **cumule** au gradient de danger (`predatorBias`) : chasser aux marges est somptueux et brûlant, exactement comme le veut le GDD §8bis.
  - **Le prédateur préfère le sang** : au choix de proie, une cible qui saigne pèse `WOUNDED_PREFERENCE` de plus (même mécanique que `PREY_PREFERENCE`). La meute cueille les diminués — cohérence d'écosystème, et conséquence de jeu : **votre cerf blessé peut vous être volé**. La piste que vous suivez, d'autres la suivent.
  - Mis bout à bout avec C2 (le portage est bruyant) : **tuer arme un minuteur**. Looter vite, charger, partir — ou sacrifier une part de viande pour occuper la meute (R15 le permet déjà). C'est le troisième acte de la chasse, et il ne coûte presque que des constantes.

### CHASSE III — la harde, le vent, la ruse (C13-C18)

- **C13 — La sentinelle.** *(**Livrée en avance** avec le chantier troupeau — spec faune R9bis, 2026-07-13, mêmes règles.)* Dans une harde de 3 têtes ou plus, **une bête à la fois** est de garde : tête haute, elle ne broute pas, sa perception vaut `SENTINEL_ACUITY` (~1,4) et son `facing` **balaie** les relèvements (`BEARINGS`) par paliers. Le tour de garde **se calcule, il ne se stocke pas** : rang dans la harde (ordre des `entityId`, précédent : l'encerclement R11) + tick ÷ `SENTINEL_SHIFT` — zéro état, déterminisme gratuit. Les brouteuses, elles, relâchent (`HERD_RELAX` ~0,8, tête au sol). Approcher une harde = **lire le rythme des relèves** et avancer quand la garde tourne le dos.
- **C14 — La scission.** Une harde levée **éclate en deux** : partition par parité de rang, chaque moitié infléchit sa fuite de ±45° (matrice de rotation à coefficients littéraux, 0,7071). Le chasseur qui charge « la harde » court entre deux moitiés et n'a rien : **on choisit sa bête avant de lever le groupe**, ou on ne choisit pas.
- **C15 — Le crochet.** En fuite dans un terrain découvert (`cover` élevé), la bête **jinke** : à chaque nouveau burst (R6), son vecteur de fuite tourne de ±40° (deux matrices littérales, signe au PRNG), pondéré par un facteur d'espèce `jink` (`MONSTER_DEFS` : lapin 1, cerf 0,5, sanglier 0 — lui ne zigzague pas, il se retourne). Courir droit derrière ne marche plus ; **anticiper le crochet et couper** marche. En couvert, pas de crochet : la bête file — le terrain décide du geste.
- **C16 — Le terrier.** Le lapin naît avec son terrier : **sa tuile de naissance** (`Monster.burrowX/Y` — née hors champ par construction, R1). Levé, il ne fuit plus « à l'opposé » : il fuit **vers le terrier** dès que celui-ci ne se gagne pas en traversant la menace ; atteint, il y disparaît — même sous les yeux (le client dessine le trou : ce n'est pas le décor qui avoue, c'est le lapin qui rentre). La chasse au lapin devient une géométrie : **couper la ligne du terrier**, ou le perdre. L'école de l'approche gagne son examen.
- **C17 — Le vent.** Le monde gagne un vent : `state.wind`, un des 8 `BEARINGS`, retiré au PRNG tous les `WIND_SHIFT_TICKS` (~5 min — il tourne, lentement). **L'odeur descend le vent** : une menace au vent d'une bête (alignement direction-vers-la-bête / vent au-dessus de `SCENT_COS`, portée `SCENT_RANGE` ~1,2 × `alertRange`) fait monter la méfiance **quels que soient l'allure, le couvert et le dos tourné** — le nez se moque de vos précautions, et c'est le seul sens qui s'en moque (C5). La parade n'est pas un facteur de plus : c'est **un côté** — approcher sous le vent. Chaque approche devient un problème d'orientation que le monde repose sans cesse. **Bloquant client** : le vent doit se VOIR (herbes couchées, particules) avant que la règle ne s'arme — une règle invisible est une injustice, pas une profondeur.
- **C18 — L'appât.** Le gibier est attiré par la nourriture au sol (`BAIT_ITEMS` : baies…) à `BAIT_SEEK`, s'y plante et mange — la fenêtre du chasseur, posée par le chasseur. Le support est **la pile d'items au sol** (décision n°4) : l'action **« jeter ce qu'on tient »** (la case active de la ceinture, un bind, zéro UI) crée une pile dans `state.groundItems` — ramassable à l'unité, périssable (`GROUND_TTL`, ~10 min : le monde ne se jonche pas). Les proies mangent aux piles d'appât ; les **prédateurs** mangent aux piles de viande comme aux carcasses (`feedStep` étendu) — **jeter de la viande à une meute qui vous serre** (R15, GDD §9bis) devient enfin un geste exécutable, et un porteur peut alléger sa fuite, une case à la fois.

### La lisibilité — la moitié du système (C19)

- **C19 — Chaque état a une affordance, ou la règle n'embarque pas.** La sim d'abord, headless, testée — mais **aucune règle de ce chantier ne se joue à l'aveugle** :
  - la méfiance : trois **postures** (tête au sol / tête levée qui fixe / corps tendu), dérivées par le client des seuils exportés dans `BALANCE` — la jauge voyage déjà dans le snapshot, il n'y a rien à ajouter au protocole ;
  - l'allure : la posture `gait` des avatars se voit (accroupi, marche, sprint) — la sienne et celle des autres ;
  - le sang : des gouttes au sol qui pâlissent avec l'âge ; la bête couchée : tapie, visiblement à bout ;
  - la sentinelle : tête haute au milieu des têtes baissées — le rythme des relèves doit se lire à dix tuiles ;
  - le vent : lisible en permanence, diégétique (herbes, particules) — pas une flèche d'UI ;
  - la mise à mort propre : un feedback d'impact distinct (le client a déjà l'impact et les chiffres — commit « le combat SE VOIT »).
  - **Rien de flottant, rien de minimap** : la scène est la seule interface. Chaque palier livre son scénario smoke (`pnpm smoke --scenario chasse`, puis `chasse2`, `chasse3`) — le smoke **lit** `window.__BRAISES__.scene`, il ne fabrique rien.

## Critères d'acceptation

### CHASSE I

- **A1 (allures)** — À `facing` et terrain égaux : en marchant, un avatar lève un cerf ~à l'actuel `flightRange` ; en `sneak`, il l'approche nettement plus près ; en sprint, il le lève de plus loin. L'input `sneak` ralentit à `SNEAK_SPEED_FACTOR` et `Entity.gait` reflète l'allure du tick dans le snapshot.
- **A2 (stop-and-go)** — Une approche par à-coups (avancer en sneak, se figer dès `SUSPICION_CURIOUS`, repartir sous le seuil) atteint une distance **strictement inférieure** à la même approche continue — le contre-test : sans jamais s'arrêter, la bête est levée avant.
- **A3 (le regard)** — Même allure, même distance : l'approche dans le dos (`facing` opposé) laisse la méfiance sous le seuil là où l'approche frontale sature. De flanc : entre les deux.
- **A4 (le couvert)** — Le même chasseur, à la même distance et la même allure, fait monter la méfiance plus vite depuis une tuile `cover` 1 que depuis un fourré ; immobile en fourré, elle **décroît**.
- **A5 (les seuils et la panique)** — Franchir `SUSPICION_CURIOUS` fige la bête face à la menace ; `SUSPICION_ALERT` la tend ; 1 la lève (machine R6 inchangée : à-coups, peur collante, `SAFE_RANGE`). Une menace à `PANIC_RANGE` brut lève la bête même à furtivité maximale. La nervosité : après une alerte retombée, la même approche re-sature **plus vite**.
- **A6 (la mise à mort propre)** — Une lance sur un cerf sous `SUSPICION_ALERT` au départ du wind-up : un coup, un mort, `monster_slain.clean = true`. Le coup sur une bête **alertée** fait ses dégâts nominaux — mesuré sur le **sanglier qui MENACE**, la seule bête qui reste sous le fer une fois alertée (un cerf alerté *fuit*, et le coup ne porte plus du tout : c'est l'autre moitié de la même règle) ; et un sanglier qui menace **tient** son alerte tant qu'il vous fixe — sa jauge ne s'effrite pas pendant votre wind-up. L'épieu propre tue le sanglier qui fouge (30) mais pas le cerf (45). La **panique** survenue *pendant* le wind-up ne salit pas un coup déjà lancé (jugé au départ).
- **A7 (le cri de mort)** — Tuer proprement une bête d'une harde porte la méfiance de toutes les autres à 1 dans `HERD_ALARM_RADIUS`, **le tick même**, sans qu'aucune n'ait rien vu — et le contre-test : une bête solitaire tuée n'alarme personne d'autre.
- **A8 (dégénérescence)** — Tous les tests faune existants (56) passent inchangés ou avec des deltas expliqués un à un : la jauge, réglée aux portées actuelles, reproduit les comportements R5/R6 pour une approche naïve.
- **A9 (déterminisme)** — Même seed + mêmes inputs (dont `sneak`) = même état et même flux d'événements, sim et replay, méfiance active.

### CHASSE II

- **A10 (la plaie)** — Un coup qui fait passer un cerf sous `MORTAL_BELOW` : il saigne jusqu'à mourir, seul, en ~`hp / BLEED_HP_PER_S` s. Une éraflure au-dessus du seuil : le saignement **s'arrête** après `LIGHT_BLEED_TICKS` et la bête survit.
- **A11 (le sang au sol)** — Une bête qui saigne sème des gouttes à cadence fixe ; `state.blood` expire à `BLOOD_TTL`, ne dépasse jamais `BLOOD_CAP`, et un avatar `bleeding` sème aussi. Les gouttes ne génèrent **aucun** `SimEvent`.
- **A12 (diminuée, couchée)** — Sous 50 % de PV, la bête fuit mesurablement moins vite ; à bout et non pressée `BED_AFTER`, elle gagne un couvert et s'y tapit (perception × `BED_ALERTNESS`) ; on peut l'y approcher et l'achever ; relancée, elle refuit — plus lentement.
- **A13 (le sang appelle)** — Un loup affamé ignore une carcasse à 30 tuiles quand elle est vieille, et **y va** quand elle est fraîche. Le poids de spawn prédateur monte près d'une carcasse fraîche (et se cumule au gradient `predatorBias`). À distances comparables, une meute choisit la cible qui saigne — y compris quand c'est **votre** cerf blessé, y compris quand c'est **vous**.
- **A14 (déterminisme II)** — Replay et flux d'événements tiennent avec sang, couché et biais actifs.

### CHASSE III

- **A15 (la sentinelle)** — *(le banc vit dans `faune.test.ts`, critère A21 : la règle a été livrée avec le troupeau, R9bis — même code, même test, pas deux.)* — À tout tick, une harde ≥ 3 a **exactement une** sentinelle ; le rôle tourne à `SENTINEL_SHIFT` ; son facing balaie. L'approche synchronisée sur les relèves (avancer quand la garde regarde ailleurs) atteint plus près que la même approche à contretemps — mesuré headless.
- **A16 (scission et crochet)** — Une harde levée se sépare en deux groupes dont les directions divergent d'au moins 60°. En terrain découvert, la position d'un lapin en fuite sur 100 ticks **n'est pas colinéaire** à sa direction initiale (le crochet) ; en couvert, elle l'est. Le sanglier ne jinke jamais.
- **A17 (le terrier)** — Un lapin levé fuit **vers** sa tuile de naissance (sauf menace sur la ligne) et disparaît en l'atteignant ; un chasseur placé **sur** la ligne du terrier le force à un détour mesurable.
- **A18 (le vent)** — Sous le vent d'un cerf (menace au vent), en sneak, en fourré, dans le dos : la méfiance **monte quand même** à `SCENT_RANGE`. Le même chasseur, symétrique sous le vent opposé : elle ne bouge pas. Le vent change à `WIND_SHIFT_TICKS`, au PRNG de l'état, dans le flux déterministe.
- **A19 (l'appât)** — Le geste « jeter » sort l'item tenu vers une pile au sol ; la pile expire à `GROUND_TTL` ; une baie posée attire un lapin à `BAIT_SEEK`, il la mange sur place — fenêtre pendant laquelle sa perception s'effondre ; une pile de viande crue nourrit un loup affamé comme une carcasse.

## Hors périmètre (et où ça revient)

- **Empreintes, âge des traces, sens de la course, Traque de joueurs** → l'arbre de maîtrise Chasse (annexe A). Le sang frais (C9) est le plancher **offert à tous** ; la maîtrise lira par-dessus, elle ne remplacera rien.
- **Pièges, affûts construits, appeaux** → maîtrise Chasse + artisanat. L'appât (C18) en est l'embryon volontairement minimal.
- **Armes de tir** (arc, javelot — le « tir » du §8bis) → post-Veillée (combat.md, hors périmètre). **La méfiance est construite exprès comme leur infrastructure** : le jour où l'arc arrive, l'approche, le couvert et le vent servent déjà — il n'y aura que la balistique à écrire.
- **Peaux, cuir, qualité de dépouille** (mise à mort propre → peau intacte) → chaîne tannage T2. Le champ `clean` de `monster_slain` l'attend.
- **La météo** (pluie qui masque le bruit, neige qui porte les traces) → quand la météo existera ; les facteurs de C5 sont prêts à la recevoir.
- **Migrations de gibier** → `worldevents.ts` (événement de monde : elles déplaceront la densité, pas ces règles).
- **PNJ chasseurs** (errands de chasse) → plus tard ; en attendant, les PNJ marchent (`gait` de marche, bruit 1) et sont des menaces valides comme aujourd'hui.

## Ajouts à `balance.ts` et à l'état

**`HUNT`** (nouveau bloc — tous les nombres sont des ordres de grandeur, calibrés à l'écran comme `SPAWN_RING_MIN` l'a été) :

- *Méfiance* : `PERCEIVE_FACTOR` 1,25 · `SUSPICION_CURIOUS` 0,35 · `SUSPICION_ALERT` 0,7 · `RISE_S` ~1,2 (saturation à stimulus plein) · `DECAY_S` ~8 · `NERVOUS_FACTOR` ~1,6 (plafonné ×3) · `PANIC_RANGE` 1,8 (bêtes à `flightRange > 0` seulement — le sanglier ne panique pas, il MENACE).
- *Ouïe* : `NOISE_STILL` 0,25 · `NOISE_SNEAK` 0,4 · `NOISE_WALK` 1 · `NOISE_SPRINT` 1,6 · `HEARING_FACTOR` 0,8 (l'ouïe porte un peu moins loin que la vue) · `PREDATOR_NOISE` 0,5 (le loup est quasi silencieux).
- *Vue* : `VIS_STILL` 0,25 (l'immobile disparaît presque — LA condition du stop-and-go, mesurée au banc A2) · `VIS_SNEAK` 0,55 · `VIS_WALK` 1 · `VIS_SPRINT` 1,4 · `SNEAK_SPEED_FACTOR` 0,5.
- *Regard* : `ANGLE_FRONT` 1 · `ANGLE_SIDE` 0,75 · `ANGLE_BACK` 0,45 (+ les deux cosinus de secteur, littéraux).
- *Mise à mort* : `CLEAN_KILL_FACTOR` 3.
- *Sang* : `MORTAL_BELOW` 0,5 · `BLEED_HP_PER_S` 0,5 · `LIGHT_BLEED_TICKS` ~25 s · `BLOOD_EVERY_TICKS` ~0,8 s · `BLOOD_TTL` ~3 min · `BLOOD_CAP` 256 · `WOUNDED_SLOW_FLOOR` 0,55 · `BED_AFTER` ~10 s · `BED_SEEK` 8 · `BED_ALERTNESS` 0,4 · `CARCASS_FRESH_TICKS` ~4 min · `CARCASS_SEEK_FRESH` 40 · `BLOOD_PREDATOR_BIAS` 2 · `WOUNDED_PREFERENCE` 1,5.
- *Harde et ruse* : `SENTINEL_SHIFT` ~20 s · `SENTINEL_ACUITY` 1,4 · `HERD_RELAX` 0,8 · matrices `JINK`/`SPLIT` (littérales) · `WIND_SHIFT_TICKS` ~5 min · `SCENT_RANGE_FACTOR` 1,2 · `SCENT_COS` 0,8 · `BAIT_SEEK` 12.

**`TERRAINS`** : champ `cover` (0..1) par terrain. **`MONSTER_DEFS`** : champ `jink?: number`.

**`Monster`** : `suspicion: number` · `nervous?: number` · `alertSince?: number` (le tick du dernier franchissement d'alerte — c'est LUI que la mise à mort propre interroge ; pour un prédateur : posé à la prise de cible/rompue, effacé au retour à la patrouille **et au repas** — la tête dans la carcasse, il baisse la garde, R15) · `slainClean?: true` (drapeau transitoire lu par `die()`) · puis, palier II : `bleedMortal?: boolean` · `bleedUntil?: number` · `bedded?: boolean` · `burrowX?/burrowY?: number` (lapin). La sentinelle **se dérive** (tick + rang), elle ne se stocke pas.

**`Entity`** : `gait: 'still' | 'sneak' | 'walk' | 'sprint'` (posé par le mouvement, lu par la perception et le client). **`MoveInput`** : `sneak?: boolean`. **`Corpse`** : `diedAt: number`. **`SimState`** : `blood: { x, y, tick }[]` (borné TTL + FIFO) · `wind: { x, y }` (**le vecteur nul = calme plat, décision d'hôte comme `faunaCap`** ; il tourne par `hash2`, donc **zéro tirage PRNG**) · `groundItems: { id, x, y, item, count, expiresAt }[]` + `nextGroundItemId` (décision n°4 — avec `GROUND_TTL` ~10 min et les actions `drop_held` / `pick_up`).

**Le flux d'événements** gagne trois choses, et trois seulement : le champ `clean` de `monster_slain` (C6), `prey_escaped` (le lapin qui rentre au terrier, C16) et `item_dropped` (C18). **Le sang n'y entre PAS** : haute fréquence ≠ domaine — c'est de l'état, que le client dessine et efface.

**Une leçon inscrite dans le code** (`combat.ts`) : le **saignement de combat** (R7, 1,5 PV/s) ne s'applique plus au **gibier** — sa plaie est celle de la chasse (C8, 0,5 PV/s). Les deux cumulés vidaient un cerf en dix secondes : il ne se **couchait** jamais (C11), et la traque n'existait pas. Deux systèmes qui saignent le même animal, c'est un système de trop.

**Performance** : la méfiance se calcule là où `nearestThreat` itère déjà (O(bêtes × menaces), inchangé) ; le sang est borné par `BLOOD_CAP` ; le vent est un vecteur. Rien ne croît avec la carte.

## L'ordre de livraison — et pourquoi cet ordre

1. **CHASSE I (C1-C7 + C19)** — la boucle minimale **complète** : approcher devient un jeu, et il paie. C'est le palier qui change le verbe. *Gate de sortie : cinq chasses au smoke `--headed`, et la question du GATE 1 — est-ce que j'ai envie de recommencer ?*
2. **CHASSE II (C8-C12)** — l'échec devient la traque, la réussite arme le minuteur. Ne s'ouvre que si le palier I est **fun à l'œil** : le sang sur une approche ennuyeuse ne sauverait rien.
3. **CHASSE III (C13-C18)** — la variance et la profondeur, règle par règle, dans n'importe quel ordre (chacune est autoportante) ; C18 introduit la pile d'items au sol (décision n°4).

Le calibrage de chaque palier se fait **à l'écran** (`pnpm smoke --scenario chasse`, mode `--dev` pour les téléports), comme la faune avant lui — les vitesses de montée/descente de la jauge feront ou déferont le stop-and-go, et ça ne se trouve pas au raisonnement.

## Décisions

Tranchées par l'utilisateur (2026-07-13) :

1. **La mise à mort propre vaut sur les prédateurs** (C6, palier I) — symétrie avec la traque du loup ; le cri de mort (C7) est le garde-fou : un loup propre, puis la meute debout.
2. **Le sang du joueur appelle les loups** (C12, palier II) — un blessé qui traverse la nuit est une proie ; le bandage (combat R8) devient un geste de survie en territoire à loups.
3. **La plaie légère se referme** (C8, palier II) — la bête survit, la piste s'éteint ; sinon « toucher une fois et attendre » devient la stratégie dominante et la traque perd son horloge.
4. **« Poser au sol » = la pile d'items dédiée** (C18, palier III) — `state.groundItems`, piles ramassables à l'unité, périssables (`GROUND_TTL`). Le geste : **jeter ce qu'on tient** (la case active de la ceinture, un bind, zéro UI) ; le « tout larguer » attendra qu'on en sente le besoin en jeu. Écartés : le cadavre généralisé (sémantique tordue, loot « tout d'un coup » inadapté à une pile) et le marqueur d'appât pur (rien n'existerait dans le monde).
