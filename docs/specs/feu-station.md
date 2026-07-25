# Le Feu — station interactive : combustible, cuisson, modal

*Source : la demande de session 2026-07-25 (« interagir avec le feu comme dans Rust »), GDD §7 (le Grand Froid, le Foyer comme salut), §8 (chaînes courtes), specs `construction.md` (le Feu, l'upkeep, R19 « l'interaction passe par ce qu'on tient »), `craft-file.md` (la file de craft, F7), `economie.md` (« le Feu cuit »), `tension.md` (T13, le froid a une parade). Statut : **spec écrite, rien codé** (2026-07-25). Décisions utilisateur du 2026-07-25, actées une à une — ne pas les rouvrir.*

## Objectif de design

Le feu de camp est aujourd'hui un objet **posé qui marche tout seul** : il brûle pour toujours (aucun état allumé/éteint), il chauffe et il sert de station de craft par simple proximité. Il devient une **station qu'on gère**, sur le modèle explicite de Rust : on la **vise et on l'ouvre** (E), on l'**alimente** (un slot combustible — plus de bois, le feu s'éteint), on **cuit** dessus (un slot où la viande crue se transforme en viande grillée, seule, dans le temps), et on la **promeut** en Foyer depuis le même panneau.

Trois bascules commandent tout le reste :

1. **Le feu peut MOURIR.** Cinq systèmes du jeu (chaleur, garde anti-Cendreux, chasse, PNJ, et la règle d'invulnérabilité) ne regardent aujourd'hui que « c'est un feu ». Ils regarderont désormais « c'est un feu **allumé** ». Un feu qu'on laisse sans bois la nuit d'acte III, c'est une nuit qu'on ne passe pas.
2. **Le Feu appelle les morts.** Renversement du rempart : le feu **empêche** toujours un cadavre proche de se relever (sanctuaire), mais il **attire** les Cendreux déjà levés — quand l'environnement autour d'eux est froid. Le Foyer reste le salut contre le froid et les loups ; il devient un phare pour les morts. Tenir un feu la nuit froide, c'est appeler la horde.
3. **La cuisson appartient à la station, pas au joueur.** La viande dans le slot cuit **sans toi** — tu charges, tu pars, tu reviens. Le feu cesse d'être un outil qu'on utilise pour devenir une machine qu'on charge.

Conséquence structurante, comme pour la file de craft : **tout l'état vit dans `SimState`** (combustible, état allumé/braises/éteint, progression de cuisson) — jamais dans un timer du client (invariant §3).

## Règles

### L'extinction et les braises

- **S1 — Le feu a un ÉTAT : allumé / braises / éteint.** Aujourd'hui aucun booléen de ce genre n'existe — le feu brûle toujours. L'état vit sur la structure (`SimState`), dérivé du combustible. **Rendu : les trois états demandent un traitement visuel neuf.** Les sprites actuels `st-fire` / `st-fire_lit` ne sont PAS « éteint / allumé » : le suffixe `_lit` désigne le **moteur d'éclairage dynamique** (on/off, `snapshot-view.ts:689`), pas le combustible — les deux montrent un feu qui brûle. Éteint (bûches froides, `FireFx` coupé, halo éteint) et braises (lueur réduite) sont à créer.
- **S2 — Le combustible se draine tant que le feu brûle.** À 0, le feu ne meurt pas net : il passe en **braises** (un sas court, `EMBER_TICKS`), puis s'éteint. Le sas est un avertissement, pas une mort sèche — et c'est le jeu qui dit son nom.
- **S3 — Les bénéfices du feu suivent son état — trois crans nets.** Tous ces systèmes passent d'un test `type === 'fire'` à un test sur l'état du feu.
  - **Allumé** (combustible > 0) : chaleur pleine (`fireBubble`, `temperature.ts`), garde anti-levée (`cendreux.ts`, S4), attraction des Cendreux si froid (S5), coins de chasse (`faune.ts`), blottissement des PNJ (`npc-needs.ts`), et l'invulnérabilité pour le Foyer (retirée pour le feu libre, S14).
  - **Braises** (combustible à 0, dans la fenêtre `EMBER_TICKS`) : **chaleur atténuée** (l'avertissement sensoriel — le froid qui remonte) et la **garde anti-levée TIENT ENCORE** (la dernière protection à lâcher). En revanche **pas d'attraction** (une braise n'est pas un phare), plus de coins de chasse ni de blottissement.
  - **Éteint** (après `EMBER_TICKS`) : AUCUN effet.
  
  *(Le cran « braises » de la garde anti-levée est mon choix par défaut — dernière protection à tomber. À confirmer : on peut aussi faire tomber la garde dès les braises, plus punitif.)*

### Les Cendreux : rempart ET phare

- **S4 — Le rempart sur la LEVÉE reste.** Un cadavre proche d'un feu **allumé ou en braises** (S3) ne se relève pas en Cendreux (`willRiseAsCendreux`, `advanceCendreux` gardent leur logique de rempart, conditionnée désormais à l'état du feu, plus à `type === 'fire'` seul). Le Foyer garde tes morts au repos — le sanctuaire est préservé.
- **S5 — Les Cendreux déjà levés sont ATTIRÉS par la chaleur — seulement quand l'environnement autour d'eux est froid.** Le seuil se lit sur la **température de base de l'environnement** (biome + heure + météo) à la position du Cendreux, **hors contribution du feu lui-même** — surtout PAS le `ambientTemperature` fini, qui inclut déjà `fireBubble` (`lieux.md:69` : `ambientTemperature` prend le `max` des chaleurs). Sinon, en s'approchant, le Cendreux se réchaufferait, repasserait au-dessus du seuil, l'attraction s'éteindrait, et il **oscillerait à la lisière de la bulle** — un jitter à odeur de non-déterminisme. Une fois l'attraction **armée** par le froid de base, le Cendreux chemine (pathfinding déterministe) vers le feu allumé le plus proche **jusqu'au bout**, qu'il se réchauffe en route ou non. Jour / zone tempérée : aucun appel ; nuit / Grand Froid / biome froid : ils convergent. Ils cherchent la chaleur perdue.
- **S6 — Conséquence émergente actée : le siège.** Un feu allumé la nuit froide canalise vers lui les Cendreux nés au loin (seuls, dans le noir, hors de portée d'un feu). Les morts naissent dans le froid et **convergent sur les foyers**. C'est voulu — le fantasme du Foyer assiégé, qui justifie les murs, le toit, la défense.

### La cuisson au slot

- **S7 — Le feu porte un SLOT DE CUISSON.** On y dépose de la viande crue ; après `COOK_TICKS`, elle devient viande grillée (`cooked_meat`) et on la reprend. Le slot vit sur la structure (`SimState`), pas sur le joueur.
- **S8 — La cuisson est PASSIVE et appartient à la STATION.** Elle continue quand le joueur s'éloigne — contrairement à la file de craft (`Entity.craftQueue`, `craft-file.md` F7), qui est sur le personnage et se met en pause. Le feu travaille seul. On charge, on part chasser, on revient : c'est cuit. En multi, ce qui vit dans la station est **volable** (règle d'accès à définir avec le reste des stations).
- **S9 — Pas de brûlé.** Une fois cuite, la viande reste au chaud indéfiniment dans le slot. Le contexte persistant/multi rend « reviens à la seconde près sinon tu perds tout » punitif plutôt que tendu. Le coût de la cuisson n'est pas le babysitting : c'est **entretenir le feu** (la cuisson exige le feu allumé, S12) et **le risque de vol** en multi.
- **S10 — Le slot ne prend QUE la viande grillée pour ce passage.** `stew`, `graine`, `leather`, les outils et tous les composants restent au panneau de craft (une recette multi-intrants n'est pas la cuisson d'un objet). Le cuir ira au futur **Fumoir/tannerie** (`construction.md:75`), qui aura son propre slot. Règle que le joueur lit : *le slot cuit un aliment ; le panneau suit une recette.*
- **S11 — L'appartenance « slot vs panneau » est une DONNÉE, par type de station.** Un drapeau sur la recette dans `balance.ts` (p. ex. `cookSlot: true`), lisible par le modal, keyé par station. Le feu déclare `cooked_meat` en slot ; le Fumoir déclarera le sien ; la forge le sien. **On écrit la machinerie une fois** — c'est ce qui paie quand on enchaînera sur les autres stations.

### Le combustible sur la structure

- **S12 — Le combustible du FEU LIBRE vit sur la STRUCTURE** (`structure.fuel`), plus sur le village. Le slot combustible le remplit ; il se draine (S2) ; vide → extinction. La cuisson (S7) et les cinq bénéfices (S3) exigent `fuel > 0` (feu allumé ou en braises).
- **S13 — Combustible = bois** pour ce passage. La tourbe et le charbon (qui brûleront plus longtemps) viennent plus tard.
- **S14 — La destructibilité est DÉCOUPLÉE du combustible (feu libre uniquement).** Un feu libre (`villageId === 0`) allumé reste attaquable : on retire POUR LUI le lien « invulnérable tant que `fuel > 0` » (`village.ts:502`) — sinon nourrir un feu sauvage le rendrait imprenable. Le **Foyer** (`villageId !== 0`) garde sa règle d'invulnérabilité via `village.fuel` **inchangée** (couplée à la migration différée, S16).
- **S15 — Le raccourci quick-feed est conservé.** « Bois en main + clic sur le feu » (`feed_fire`, `aim.ts:275`) alimente le slot combustible sans ouvrir le modal — jeter une bûche au passage, ergonomique.
- **S16 — DIFFÉRÉ : l'upkeep du village.** `advanceUpkeep` / `village.fuel` ne sont PAS migrés ce passage ; le Foyer garde `village.fuel` tel quel. À la migration ultérieure vers la réserve unifiée sur la structure, ne pas oublier le **transfert de combustible au moment `found_village`** (feu libre → Foyer).

### L'interaction : la touche E

- **S17 — E devient la touche unique « interagir avec ce que je vise ».** Viser un buisson + E = cueillir (inchangé, `input-bindings.ts`, décision 2026-07-24). Viser un **feu** à `INTERACT_RANGE` + E = **ouvrir son modal**. C'est l'**extension** d'un contrat existant (E est déjà l'interaction par visée), pas une réouverture du débranchement des verbes du 2026-07-12 : ouvrir un panneau n'est pas un verbe, et les vrais verbes (mettre une bûche, lancer la cuisson) se font *dans* le modal, au drag&drop.

### Le modal

- **S18 — Le modal est bâti sur le squelette du coffre** (`inventory-panel.ts` : slots + drag&drop + sac affiché). Il contient : le **slot combustible**, le **slot cuisson**, l'**état lisible** (jauge de combustible, allumé/braises/éteint, progression de cuisson), et le **sac du joueur à côté** pour le drag&drop (bûche → combustible, viande → cuisson).
- **S19 — UN bouton contextuel** dans le modal : « Fonder un Foyer ici » (feu libre fondable) ou « Améliorer le Foyer » (Foyer améliorable), ou rien. Ces boutons **rappellent les actions existantes** (`found_village`, `upgrade_fire`) — on déplace la logique dans le panneau, on ne la réimplémente pas.
- **S20 — Les deux fenêtres flottantes sont RETIRÉES.** `found-village-prompt.ts` et `fire-upgrade-prompt.ts` disparaissent : leurs actions passent dans le bouton du modal (S19). Le feu a une seule surface d'interaction — pas un panneau *plus* deux bulles qui doublonnent. (Un indice discret « E — Foyer disponible » sur le feu reste possible si la découvrabilité l'exige.)
- **S21 — Le panneau de craft NE BOUGE PAS ce passage.** Fabriquer le marteau / les composants « au feu » reste dans l'écran perso (TAB, filtré par proximité, `craft-file.md` F14). Le feu a donc deux surfaces pour l'instant : le **modal** (le feu comme objet : brûler, cuire, devenir/améliorer Foyer) et le **TAB** (le craft du joueur, filtré par ce qui est à portée). Fondre tout le craft de station dans les modals = le chantier « autres stations », hors périmètre.

### Déterminisme, protocole, événements

- **S22 — Tout l'état nouveau vit dans `SimState`, JSON-sérialisable** (pas de `Map`/`Set`, pas de classe) : `structure.fuel`, l'état allumé/braises/éteint (dérivé du combustible et du tick), le contenu et la progression du slot de cuisson. Le temps = numéro de tick.
- **S23 — L'attraction des Cendreux (S5) passe par le pathfinding déterministe existant.** Attention au flux RNG seedé : introduire un nouveau comportement d'IA ne doit pas décaler les tirages des systèmes voisins (mémoire `rng-fragile-au-decompte-entites`) — isoler le changement.
- **S24 — Les nouvelles actions (déposer/reprendre dans un slot de station) entrent au protocole** (`protocol.ts`), avec bump de `PROTOCOL_VERSION`. Le slot de cuisson étant un inventaire de station, réutiliser autant que possible la grammaire des transferts du coffre (`dragToAction`).
- **S25 — Les faits de jeu discrets sont émis en `SimEvent`** au moment où la logique les exécute (invariant : on n'instrumente jamais après coup). Nouveaux : `fire_extinguished`, `fire_relit` (le feu passe éteint / se rallume) ; `meat_cooked` (une pièce sort du slot cuite). Existant réutilisé : `fire_fed`. La chronique, l'alignement et le tableau du village en sont consommateurs.

## Critères d'acceptation

- **A1 — Le cycle de combustible.** Un feu libre nourri de bois est **allumé** ; laissé sans bois, `fuel` descend à 0, le feu passe en **braises** (`EMBER_TICKS`), puis **éteint**. Test tick-driven (`seed + inputs → état`).
- **A2 — L'état commande les bénéfices.** Feu **éteint** : `fireBubble` ne chauffe plus, la garde anti-levée ne s'applique plus, les coins de chasse et le blottissement PNJ tombent. Les cinq consommateurs testent bien l'état allumé, pas seulement `type === 'fire'`.
- **A3 — Le rempart sur la levée.** Un cadavre proche d'un feu **allumé** ne se lève pas ; proche d'un feu **en braises** non plus (S3/S4) ; le même cadavre, seul, loin d'un feu — ou près d'un feu **éteint** —, dans le froid, se lève.
- **A4 — Le phare conditionnel.** Un Cendreux levé, en environnement **froid**, chemine vers le feu allumé le plus proche ; en environnement **tempéré**, il ne le fait pas. Un feu **éteint** n'attire personne.
- **A5 — La cuisson passive, station-owned.** Viande crue déposée dans le slot → viande grillée après `COOK_TICKS`. Le joueur peut s'éloigner (`> INTERACT_RANGE`) : la cuisson **progresse quand même** (contrairement à la file de craft, qui se mettrait en pause).
- **A6 — Pas de brûlé.** Viande cuite laissée dans le slot longtemps après l'échéance : elle ne se dégrade pas.
- **A7 — La cuisson exige le feu allumé.** Feu **éteint** : la cuisson ne progresse pas ; elle reprend quand le feu est rallumé.
- **A8 — E, l'interaction par visée.** Viser un feu à portée + E ouvre le modal ; viser un buisson + E cueille (inchangé) ; viser rien d'interactif + E ne fait rien.
- **A9 — Le modal et le drag&drop.** Le modal affiche slot combustible + slot cuisson + état + sac ; glisser une bûche l'ajoute au combustible, glisser de la viande crue la met à cuire, reprendre la viande grillée la remet au sac.
- **A10 — Le bouton contextuel.** « Fonder » apparaît sur un feu libre fondable ; « Améliorer » sur un Foyer améliorable ; l'action déclenchée est bien `found_village` / `upgrade_fire`. Les deux bulles flottantes n'existent plus.
- **A11 — Destructibilité découplée (feu libre).** Un feu libre (`villageId === 0`) **allumé** encaisse des dégâts et peut tomber en ruine (aucune invulnérabilité liée au combustible). Le cas du **Foyer** (invulnérabilité via `village.fuel`) est hors périmètre ici (S16) — inchangé, non retesté.
- **A12 — Déterminisme.** Même seed + mêmes inputs (poser un feu, le nourrir, cuire, s'éloigner, revenir) → même état ET même flux d'événements (`replay.test.ts`, `events.test.ts`). Aucune de ces mécaniques ne dépend d'une horloge ni d'un tirage non seedé.

## Nombres (à calibrer)

Capacité du slot combustible et **taux de drain** (combien de temps une bûche fait tenir le feu) ; `EMBER_TICKS` (durée du sas de braises) ; atténuation chaleur/garde en braises (S3) ; `COOK_TICKS` de la viande grillée (cohérent avec `cooked_meat: 5 s` de la file actuelle) ; **seuil de froid** de `ambientTemperature` qui arme l'attraction des Cendreux (S5) ; **portée d'attraction** (à quelle distance un Cendreux « sent » un feu). Toutes dans `balance.ts`.

## Hors périmètre

- **La migration de l'upkeep du village** (`advanceUpkeep` / `village.fuel` → réserve unifiée sur la structure) : différée (S16).
- **Les autres stations** (workshop, furnace, four_acier, atelier_lourd) et la refonte de leur interaction en modals : c'est le chantier suivant. La machinerie de slot est conçue réutilisable (S11), mais on ne la branche que sur le feu ici.
- **Le cuir / le Fumoir** (S10) : le tannage attend sa station dédiée.
- **Tourbe et charbon** comme combustibles (S13).
- **L'unification du coffre sur E** (S17/S20) : le coffre reste sur TAB+proximité ce passage ; on unifiera « viser + E » sur toutes les stations avec le chantier « autres stations ».
