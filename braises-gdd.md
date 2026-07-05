# BRAISES — Game Design Document

*Titre de travail. Version 0.1 — 5 juillet 2026.*

> Un survival top-down persistant où ton village est ton personnage principal — et où les autres joueurs sont la meilleure et la pire chose qui puisse lui arriver.

---

## 1. Vision

### Pitch en une phrase

Dans un monde qui meurt en soixante jours, des villages de survivants prospèrent, commercent, se pillent et se trahissent — et à la fin de la saison, quand tout s'effondre, on se souvient de ce que ton village a choisi d'être.

### La fantaisie

Tu n'es pas le héros de l'apocalypse. Tu es *quelqu'un* : la forgeronne, le toubib, l'éclaireur d'une communauté accrochée aux ruines. Ton nom compte parce que trente personnes le connaissent.

Au centre de chaque village brûle **le Feu** — foyer commun, à la fois cœur mécanique (rayon de construction, respawn, stockage protégé) et symbole. Tout le jeu tient dans une question : *que fais-tu de ton feu ?* Des socs de charrue, ou des fers de lance ?

### Les trois piliers

1. **Le village est le personnage.** Tout ce que fait un joueur nourrit une entité collective qui a une identité, une couleur, une réputation, une mort.
2. **La morale est une mécanique.** Pacifisme et agression sont des builds avec des coûts réels, pas du roleplay — et ils ont besoin l'un de l'autre.
3. **Tout est condamné.** Soixante jours, puis la cendre. On ne joue pas pour garder, on joue pour ce qu'on racontera.

### Fiche d'identité

| | |
|---|---|
| Genre | Survival multijoueur persistant, gestion communautaire, top-down 2D |
| Vue | Top-down, pixel art |
| Format | Saisons de 60 jours réels, carte unique par saison, wipe final |
| Multi | Serveur persistant, villages de joueurs + villages PNJ |
| Solo | Mode **Veillée** complet (village + PNJ), même simulation que le multi |
| Références | Rust (persistance, enjeux), RimWorld (simulation villageoise), Project Zomboid (feel du combat), Wurm/EVE (politique émergente), Meet Your Maker (défense asynchrone étudiée puis écartée) |
| Modèle éco | Premium achat unique 15-20 €, pas de F2P, pas de pay-to-win |

---

## 2. La saison — 60 jours, trois actes

La carte vit soixante jours réels, puis meurt. La condamnation du monde est une *feature* narrative : la question n'est pas ce que tu gardes, mais ce que tu sauves.

### Acte I — L'Éclosion (semaines 1-3)

Abondance relative, fondation des villages, premières rencontres. Les raids sont bridés (fenêtres restreintes, dégâts plafonnés) : le monde laisse le temps de construire quelque chose qui vaudra la peine d'être perdu.

### Acte II — Le Grand Froid (semaines 4-6)

L'hiver descend. La consommation double (nourriture, combustible, réparations) au moment où les sources se contractent. Les hordes migrent, les Feux rouges s'allument, les raids s'ouvrent en grand. L'acte de la diplomatie et des couteaux dans le dos.

### Acte III — La Cendre (semaines 7-8)

Le monde s'effondre : froid létal, méga-horde convergente, et un objectif final unique apparaît (convoi d'évacuation, bunker, arche). Chaque archétype a sa victoire :

- Les **Foyers** gagnent en *sauvant des vies* (les leurs, leurs PNJ, même des réfugiés ennemis).
- Les **Meutes** gagnent en *partant les bras pleins* (score de pillage).
- Les **Ermitages** gagnent en *tenant* — traverser la Cendre sans avoir dépendu de personne.

### Entre les saisons

Rien de puissant ne survit. Seules passent les **Mémoires** : cosmétiques, blueprints, titres, et la **chronique de la saison** — le récit généré des grands événements (« Saison 3 : celle où le Foyer de la Rivière a nourri trois Meutes tout l'hiver pour les retourner l'une contre l'autre »). Les chroniques exigent des lieux nommables (voir §9, génération de carte).

---

## 3. L'alignement émergent

### Principe

Pas de choix déclaratif de faction. L'alignement d'un village **émerge des actes de ses membres**, agrégés dans la couleur de son Feu — visible de loin, par tous. Ta réputation te précède, littéralement, en lumière sur l'horizon.

### Deux axes, quatre archétypes

- **Chaleur** (hostile ↔ bienveillant) : *comment* tu traites l'extérieur. Nourrir, soigner, honorer un contrat, escorter, relâcher un prisonnier → monte. Attaquer sans provocation, piller, exécuter, trahir un pacte → descend.
- **Intensité** (isolé ↔ engagé) : *combien* tu interagis avec l'extérieur, en bien ou en mal.

| | Engagé | Isolé |
|---|---|---|
| **Chaud** | **Foyer** — hub commercial, protecteur. Bonus éco/croissance/soin massifs, structures très résistantes ; malus offensif hors territoire, ne peut initier de raid. | *(zone de transition)* |
| **Froid** | **Meute** — prédateur. Capacités de raid/siège/racket ; économie anémique, structurellement dépendante de ses proies. | **Charognard** — évite tout le monde, détrousse les faibles et les cadavres. |
| **Neutre** | *(zone de transition)* | **Ermitage** — forteresse autarcique (voir §4). |

Le prédateur a besoin de proies vivantes ; le pacifiste a besoin que quelqu'un veuille ses richesses. Aucun archétype ne gagne en exterminant l'autre.

### Ce qui compte : des actes, pas des états

Règle d'or : on ne mesure que des **événements discrets, vérifiables côté serveur, impliquant l'extérieur**. Jamais d'intention, jamais d'interne (tuer un membre de son propre village = problème de gouvernance, pas d'alignement).

- **Le premier sang** : celui qui initie l'hostilité (première attaque, entrée armée non invitée, sabotage) est marqué agresseur pour tout l'engagement. La riposte, même brutale, ne coûte presque rien. Le pacifisme du jeu n'est pas la non-violence, c'est la **non-prédation** — les Foyers peuvent avoir une milice féroce.
- **Pondération par le coût réel** : donner 5 baies ne vaut rien ; nourrir un village affamé pendant le Grand Froid vaut énormément. L'alignement mesure des sacrifices et des prises de risque, pas du volume spammable.
- Provoquer l'ennemi pour fabriquer un « faux premier sang » est laissé vivant : c'est de la politique (Rome et ses casus belli). Les témoins humains et la chronique en jugeront.

### Agrégation : l'individu teinte, le collectif décide

Chaque joueur porte son alignement personnel. Le Feu du village = **moyenne pondérée par la contribution récente** des membres, avec plafond par tête (un seul berserker ne fait pas virer trente personnes au rouge).

- **Le bannissement purge** : les actes d'un membre exclu cessent de peser sur le Feu, *sauf* ses actes des 7 derniers jours (anti-blanchiment). Le banni garde son alignement personnel.
- **L'infiltré est une arme** : un joueur rouge dans un Foyer le tire vers le neutre tant qu'il agit mal. Le vetting des recrues (statut d'Hôte, §5) est la contre-mesure. Feature assumée : du drama émergent pur.

### Inertie, mémoire, rédemption

L'alignement est un **paquebot, pas un kayak** :

- Fenêtre glissante ~10-14 jours à pleine puissance, puis décroissance. La rédemption est possible en une demi-saison d'efforts réels.
- Les **Cicatrices** : les actes extrêmes (raser un village, exécutions de masse, parjure) créent des marqueurs permanents pour la saison, visibles sur le profil. Aucun effet mécanique direct — elles informent les *joueurs*, qui sont le vrai système de réputation.
- **Dérive vers le neutre en cas d'inaction** : les bonus se méritent en continu.

### Lisibilité : trois couches

1. **De loin** : couleur du Feu à l'horizon (bleu ↔ blanc ↔ rouge) + intensité lumineuse (axe engagement). Un éclaireur en hauteur lit la carte politique d'un regard.
2. **De près** : tells diégétiques — bannières, palissades (pieux et têtes ou guirlandes et étals), posture des PNJ.
3. **En détail** : profil consultable — position sur les axes, tendance, Cicatrices. *Jamais* le log des actes ni la formule. Cible : **prévisible dans le sens, flou dans la magnitude** (trop transparent = farmable ; trop opaque = frustrant).

### Bonus mécaniques — DÉCISION ACTÉE

**Continu pour les stats passives** (rendements, résistances), **paliers pour les capacités débloquées** (le racket, le tribunal de paix, le marché franc, le Serrage, l'Effacement…). Les identités fortes viennent des capacités ; les effets de seuil exploitables restent limités aux déblocages, pas aux stats.

### Exploits anticipés et contre-mesures

| Exploit | Contre-mesure |
|---|---|
| Farm de chaleur par collusion (donations en boucle) | Rendements décroissants par paire de villages ; seuls les transferts à perte nette comptent |
| Blanchiment par bannissement | Délai de purge de 7 jours |
| Faux premier sang | Laissé vivant — gameplay diplomatique |

---

## 4. L'Ermitage — l'isolement comme build complet

**DÉCISION ACTÉE : on ne force personne au jeu social.** L'Ermitage est un archétype pleinement jouable, pas une absence de build. Une vallée où certains ont juste fermé la porte est un monde, pas un jeu de société déguisé.

Sa fantaisie : **l'autarcie parfaite** — la forteresse dans la montagne, le monastère fortifié, le bunker agricole. Là où le Foyer prospère par le flux, l'Ermitage prospère par le rendement.

- **Maîtrise du clos** (continu) : rendements agricoles, durabilité des outils, stockage — montent avec l'isolement.
- **Serrage** (palier) : fortifications intérieures démultipliées, portes scellables, caches souterraines invisibles au pillage.
- **Terroir** (palier) : cultures/recettes exclusives, installations longues à bâtir. La seule chose au monde que les autres ne peuvent obtenir que par raid ou troc exceptionnel — l'Ermitage devient **désirable sans être dépendant**, objet du jeu social au lieu d'en être le sujet.
- **Effacement** (palier haut) : le village disparaît des cartes et repérages à distance, Feu masqué à l'horizon. « Il paraît qu'il y a un village dans le col, personne ne l'a jamais vu. »

Garde-fous : l'Ermitage subit le monde (Grand Froid, hordes, Cendre — ses pressions sont PvE et environnementales) ; les raids restent possibles mais au rapport coût/butin dissuasif (opération de fin de saison, pas un mardi soir) ; et ses rendements internes **plafonnent en dessous** de ce qu'un bon réseau commercial rapporte — l'isolement est un choix de tranquillité et de sécurité, jamais de puissance maximale (sinon le serveur devient un champ de bunkers muets).

Élégance structurelle : le joueur solo en mode Veillée joue *mécaniquement* un Ermitage. Le mode solo et l'archétype isolé sont la même chose vue sous deux angles.

---

## 5. Gouvernance interne

### Principe : des serrures, pas des lois

Le serveur fait respecter la propriété et les permissions — ce qu'un humain ne peut pas faire respecter à 3 h du matin. Les humains font la politique. **Chaque règle sociale codée est une histoire volée aux joueurs.**

Refus explicites de design : pas de lois personnalisées codées, pas de tribunaux mécaniques, pas d'impôts automatiques, pas de prisons systémiques. Quand un village invente son impôt maison et le fait respecter par la pression sociale, le jeu a réussi.

### Permissions

- Chaque objet bâti a un **propriétaire** et une liste d'accès. Ce que je construis est à moi par défaut ; je peux le partager (personne, rang, village).
- Les **biens communs** (Feu, grenier, murs, portes) sont gérés par rangs.
- **Trois rangs + un** : *Hôte* (accès à l'enceinte, aucun bien commun, ne pèse pas sur le Feu — la période d'essai), *Résident* (construit dans l'enceinte, communs de base), *Gardien* (portes, défenses, invitations), *Fondateur/Doyen* (promeut, bannit, modifie la charte).

### La Charte : trois modèles de pouvoir

Choisie à l'allumage du Feu — la seule décision déclarative du jeu, portant uniquement sur le pouvoir *interne* :

1. **Le Chef** : rang suprême individuel, succession automatique au Gardien le plus réputé après X jours d'absence (un village ne meurt pas avec le chef parti en vacances). Pour les Meutes et petits groupes.
2. **Le Conseil** : 3-5 Gardiens ; actes majeurs (bannir, changer la charte, déclarer un raid, signer un pacte) à la majorité.
3. **La Commune** : tout Résident vote, majorité simple, quorum. Lent, chaotique, magnifique.

Changer de charte : vote qualifié + délai de plusieurs jours, visible de tous. Le coup d'État légal est un événement de serveur ; l'illégal passe par la Scission.

### Réputation locale : mesurée, jamais automatique

Le tableau du village trace les contributions et produit un **score visible de tous les membres** — mais **rien ne se déclenche automatiquement**. Pas de promotion auto, pas d'exclusion auto. C'est un instrument de délibération : les chiffres sont sur la table, la décision reste humaine. (Le contributeur faible est peut-être le diplomate qui a évité deux guerres.)

Seule pression systémique admise, en *option* de charte : conditionner rations/respawn/communs de confort à un seuil de contribution — un choix du village, pas une règle du jeu.

### Recrutement et saboteur

- Entrée par invitation d'un Gardien uniquement.
- **Profil personnel public** : alignement individuel, Cicatrices, historique d'appartenance permanent sur la saison. Le mercenaire qui a quitté trois villages en deux semaines porte son CV sur lui.
- Le saboteur doit *gagner* sa position (jours de contribution réelle avant d'atteindre coffres et portes) : le coût d'infiltration est le design anti-sabotage. Ouvrir la porte pendant un raid = premier sang contre son propre camp → Cicatrice personnelle *Parjure*. Trahir est jouable ; on ne trahit qu'une fois par identité.

### La Scission : la soupape

Un Gardien ou un groupe de Résidents peut fonder un nouveau Feu (sur un site libre), chacun **partant avec ce qui lui appartient** — coffre personnel, outils, équipement ; les communs restent (clause mobilière, cohérente avec la caserne commune, voir §6ter). Quitter est toujours possible, jamais gratuit : ce qui part vraiment dans une scission, ce sont les *bras et les maîtrises*. La menace crédible de scission est le vrai contre-pouvoir du chef — et le serveur y gagne des guerres fratricides entre village-mère et village-fils.

*La propriété individuelle dans le collectif n'est pas un confort : c'est la clef de voûte politique du jeu.*

### Les PNJ

Résidents perpétuels sans droit de vote — main-d'œuvre et milice, pas citoyens. Le joueur solo est mécaniquement le Chef d'un village de PNJ. Quand des humains rejoignent, ils prennent les maisons des PNJ, qui deviennent moins nombreux : **plus d'humains = moins de bras gratuits** — régulateur naturel.

### MVP gouvernance

Pour le premier playtest : rang unique + Chef fixe + propriété individuelle. Conseil/Commune/options de charte n'arrivent que quand de vrais groupes jouent.

---

## 6. La boucle du joueur

### Moment-à-moment : l'interdépendance forcée

Grammaire survival classique (déplacer, récolter, fabriquer, construire, combattre) avec un principe directeur : **le village doit être une nécessité, pas une commodité** (l'anti-Rust).

- **Personne ne maîtrise tout** : progresser dans une branche (artisanat, médecine, agriculture, combat, exploration) ralentit fortement les autres. Pas de classes — la spécialisation **émerge des actions** (à la RimWorld/Wurm). Au bout d'une semaine, tu es « la trappeuse du village de l'Est » : une identité sociale que personne ne t'a assignée.
- **Les gros crafts sont collectifs** : ressources multi-métiers, parfois plusieurs paires de mains simultanées (portage lourd, échafaudage).
- **La survie individuelle est facile, la prospérité est collective** : ne pas mourir seul en forêt est trivial ; manger bien, dormir au chaud, être soigné — seul le village le fournit. Le loup solitaire n'est pas puni, il végète.

### La session (45 minutes) : trois sources d'objectifs

1. **Besoins personnels** : équipement, compétences, son quartier dans la caserne commune (la propriété privée dans le collectif = moteur d'attachement, voir §6ter).
2. **Le tableau du village** : tâches communautaires alimentées par le système (grenier à 20 %, palissade endommagée) et par les joueurs (« 40 lingots pour finir la tour »). Contribuer nourrit la réputation locale.
3. **Le monde extérieur** : événements PvE temporaires (carcasse de convoi, horde migrante, marchand nomade, ruines découvertes). Le robinet à sessions — et le théâtre des rencontres inter-villages.

Session type : je checke le tableau, il manque du bois et un convoi a spawn au nord. Je coupe en route, je croise deux joueurs d'un village voisin sur le convoi, on partage (ou pas), je rentre, je dépose, je répare ma hache chez le forgeron, je me déconnecte. Boucle complète, autonome, qui a nourri le collectif.

### La semaine : l'arc

Paliers de spécialisation (le forgeron débloque l'acier = événement pour tout le village), rôles formels gagnés par la réputation, grands projets votés, et l'acte de la saison qui avance.

### Où la philosophie s'incarne dans les mains du joueur

~70 % de la boucle est commune (récolter, crafter, construire, explorer) — ce qui rend le jeu équilibrable et le changement d'alignement concevable. Les ~30 % divergents portent l'identité :

- **Foyer** : combat défensif et non létal (boucliers, filets, barricades, alarmes), gameplay de *milice* (poste assigné quand l'alarme sonne), expéditions, caravanes à escorter (tension sans agression), diplomatie.
- **Meute** : repérage (infiltration/observation), préparation de raid (béliers, échelles, charges — gros artisanat : même les raiders passent du temps à l'atelier), racket (l'ultimatum est une action de jeu, avec caravane de tribut interceptable).

### Le piège de la corvée

Deux garde-fous : les tâches de contribution doivent avoir des boucles riches en elles-mêmes (le bois est dans une forêt dangereuse, la forge a un mini-jeu de timing) ; et la simulation tourne *lentement* — un village survit à 3-4 jours d'inactivité de ses membres. Sinon : anxiété d'abandon, mort des casuals.

---

## 6bis. Les stats du personnage

### Principe directeur

**La puissance vit dans l'équipement, le village et le nombre ; le personnage porte des capacités et une identité, pas des multiplicateurs.** Progression horizontale, pas verticale — le vétéran de la semaine 1 ne doit jamais être un dieu inaccessible pour le nouveau de la semaine 4.

### Couche 1 — Les jauges (l'état du corps)

- **Santé par localisation** : tête, torse, bras, jambes (sain → blessé → grave), avec effets fonctionnels (jambes = vitesse, bras = attaque/travail, torse = endurance max, tête = vision). Le soin est un traitement (bandage, attelle, repos), pas une potion — c'est ce qui fait exister le métier de médecin.
- **Saignement** : l'horloge du combat. Non traité, il tue ; traité, il laisse une blessure à guérir sur la durée.
- **Endurance** : la reine (voir §7). Son maximum et sa récupération viennent surtout de la logistique : nutrition, sommeil, chaleur.
- **Faim** (simple, actée) + **moral** en surcouche : repas variés, dormir dans son quartier aménagé, village prospère → bonus de récupération d'endurance et de vitesse d'apprentissage. Le moral est le pont mécanique entre prospérité collective et performance individuelle.
- **Température** : triviale en acte I, tyrannique au Grand Froid. Réponses : vêtements, feux, abris.
- **Charge portée** : état visible (léger / chargé / surchargé), cohérent avec les règles d'extraction de raid.

Motif d'ensemble : presque toutes les jauges se remplissent *par le collectif*. Le solitaire survit avec des jauges médiocres ; le villageois bien nourri, chauffé et soigné combat objectivement mieux. L'interdépendance forcée, version chiffrée.

### Couche 2 — Pas d'attributs. Des Maîtrises.

**Zéro attribut RPG** (pas de Force/Dextérité/Intelligence) : les attributs créent du min-max à la création et de la puissance verticale. Tous les personnages naissent identiques ; la différenciation émerge de la pratique.

Les **Maîtrises** progressent à l'usage, sur 5 familles / 15 branches (arbre complet en Annexe A). Trois règles :

1. **Des déblocages, pas des multiplicateurs.** Chaque palier = capacité ou recette nommée + gain plat mineur (vitesse de travail, marge d'échec). Jamais de « +40 % dégâts ». Écart cible en duel à équipement égal : sensible, jamais insurmontable — le 2v1 doit toujours faire peur au vétéran.
2. **Le budget de spécialisation** : plafond global ≈ 2 branches au palier 4 + 2-3 branches au palier 2. Au-delà, érosion lente des branches non pratiquées. Tu es ce que tu pratiques — l'identité sociale (« la trappeuse de l'Est ») émerge sans écran de classe. Les paliers 1 sont hors budget : tout le monde peut savoir un peu de tout ; c'est la spécialisation haute qui coûte.
3. **Rattrapage intégré** : courbe logarithmique (paliers 1-2 rapides, sommets longs), moral + **enseignement** (apprendre à côté d'un spécialiste accélère — une action sociale de plus). Un village qui accueille bien ses recrues les rend utiles en deux soirées.

### Couche 3 — L'équipement porte la puissance

Le vrai « niveau » du personnage est ce qu'il porte — et c'est lootable. La puissance est **circulante, jamais acquise** : le vétéran qui meurt redevient dangereux après être repassé par l'atelier de quelqu'un. La mort coûte l'*avoir*, jamais l'*être* (les maîtrises ne se perdent pas à la mort) — la ligne exacte entre « chère » et « cruelle ».

### Ce qui n'existe pas

Pas de niveaux de personnage, pas d'XP globale, pas d'arbres de talents à respec, pas de stats d'alignement visibles en combat (l'alignement est social, pas martial), pas de régénération passive de santé (sinon le médecin et le lit ne servent à rien).

La fiche tient sur un écran : six jauges, quinze maîtrises dont trois qui te définissent, et ce que tu portes. Le reste — réputation, Cicatrices, village — c'est le monde qui s'en souvient à ta place.

---

## 6ter. La construction du village — DÉCISION ACTÉE : modèle à slots

**Pas de construction libre.** Chaque village s'installe sur un **site prédéfini** de la carte, avec un plan fixe et des **slots typés** dans lesquels on choisit quel bâtiment construire (modèle State of Decay). Le trade assumé : on échange l'expression créative individuelle contre la lisibilité stratégique et un scope divisé par deux — et dans un jeu dont le personnage principal est le *village*, l'expression migre naturellement du « comment je construis » vers « qu'est-ce qu'on construit, et où on s'installe ».

### Ce que le modèle achète

- **Scope** : le free-building était le plus gros morceau de `/sim` après l'IA des PNJ (grille de placement, validation, dégradation par segment, pathfinding dans du bâti arbitraire). Avec des slots : un plan de site (data), des slots typés, des bâtiments-prefabs avec états. L'IA des PNJ navigue et défend un layout *connu*. Probablement la décision qui rend le projet livrable en solo.
- **Équilibrage** : fini la guerre sans fin contre le honeycombing et les labyrinthes anti-raid dégénérés. Chaque site est testé en siège, garanti prenable et défendable. Le raid devient un puzzle connu des deux côtés — une méta se développe par site, comme sur une carte de jeu compétitif.
- **Géographie politique** : les sites sont des lieux nommés, en nombre fini, donc **contestables** (deux groupes qui veulent le même site en acte I = drama gratuit) — et les villages deviennent des landmarks de chronique (« la bataille du Moulin »).

### Les sites

- **Nombre** : ~1,5× le nombre de villages attendus (ordre de grandeur : 30 sites pour ~20 villages visés). Assez rare pour que les beaux sites se contestent, assez de marge pour scissions et refondations.
- **Gamme de tailles** : petits sites 4-6 slots (Ermitages, Charognards) → grands sites 12-15 slots (les grands Foyers).
- **Géométrie propre** : le site de la falaise n'a qu'une approche, le carrefour en a quatre. **Choisir son site EST le choix défensif macro.**
- **Fondation** : brasero de fondation (T1, lourd, portable à deux), **2 joueurs minimum** (ou 1 joueur + premiers PNJ recrutés — le chemin Veillée). Anti-spam de micro-bases.
- **Recyclage** : un site abandonné (Feu mort) se dégrade en **ruine pillable** (~10 jours), puis redevient fondable après nettoyage. La carte a une mémoire ; les arrivants de la semaine 4 héritent de sites chargés d'histoire.

### Les slots

- **Slots typés** : slots de production (forge, infirmerie, grenier, marché…), slots de fortification (tour vs herse vs piège vs poste de garde — le micro-choix défensif), la **caserne commune** (toujours présente, voir plus bas), et le Feu au centre.
- **Moins de slots que de bâtiments désirables** : chaque village a un *build* qui exprime sa philosophie. Le Foyer met un marché là où la Meute met une rampe de sortie. **Qui décide du prochain bâtiment dans le slot libre est LE débat de gouvernance récurrent** (le forgeron et le médecin font campagne) — meilleur générateur de politique que l'attribution de parcelles.
- **Upgrade in-place** : chaque bâtiment a 2-3 niveaux (forge T1 → T2 → forge d'acier), calés sur les tiers de matériaux. Le pipeline plans fantômes → matériaux → temps de travail (joueurs ou PNJ bâtisseurs, file de chantiers priorisable) s'applique, borné aux slots.
- **Démolir/remplacer** : possible, coûteux (récupération partielle). Pivoter son build se paie — et se *voit* : le village qui passe de Foyer à Meute démonte son marché pour monter sa rampe de raid. Storytelling gratuit.
- **Paliers du Feu** : palier du village = slots débloqués + fortifications élargies + rayon/PNJ/protections offline. Les capacités d'archétype s'ancrent dans des bâtiments (le marché franc, le Serrage) — **les capacités palières de l'alignement ont une adresse physique, donc une cible de raid**.

### La caserne commune et le quartier personnel

Tout le monde loge dans la **caserne commune** — diégétiquement juste (on se serre autour du Feu). Chaque membre y a **son quartier** : alcôve personnalisable (lit, coffre personnel inviolable par permissions, trophées, déco). Le moral « chez soi » s'accroche au quartier aménagé, le coffre reste le bien privé, l'attachement spatial survit en format réduit.

**Conséquence sur la Scission** : la clause devient purement mobilière — on part avec coffre, outils, équipement (plus de matériaux de maison à démonter). Le contre-pouvoir tient : ce qui part vraiment dans une scission, ce sont les *bras et les maîtrises*.

### Les ouvrages de terrain (hors slots)

Exception délibérée au modèle : quelques structures posables librement **hors enceinte**, en nombre plafonné par village — postes de guet, caches de ravitaillement (Intendance P4), ponts, pièges de zone. Petites en scope, elles préservent le jeu de Go territorial entre villages. Contestables sans déclencher les règles de siège complètes.

### Entretien et dégradation

Tout se dégrade lentement (plus vite au Grand Froid), se répare avec une fraction des matériaux, calibré doux (un village survit à 3-4 jours d'abandon — règle actée). Le Feu consomme du combustible : le nourrir est la tâche communautaire zéro — un Feu mort = perte du respawn et des protections jusqu'au rallumage.

### Vigilance

La version Phase Veillée minimale à borner explicitement : sites + slots + T1/T2 + dégradation simple, sans ouvrages de terrain ni démolition/pivot. Et le couple *nombre de sites × taille de carte* doit dialoguer avec « vallée traversable en 10-15 min » dès les premiers tests.

---

## 7. Combat & raid

### Principe directeur : un combat de coût, pas de skill pur

La mort coûte de l'équipement, du temps, peut-être une guerre — le combat doit donc être **lent, positionnel, gagné avant l'échange** (nombre, terrain, équipement, surprise). Le skill individuel fait pencher un duel équilibré, jamais un 1v3. Feel visé : Rust en top-down, Project Zomboid en plus actif — pas Hades.

### Grammaire

- **Endurance reine** : attaquer, bloquer, sprinter brûlent la même barre. Un combattant essoufflé est mort. Rythme les échanges, rend la poursuite tactique, et lie la logistique au combat (bien nourri = meilleure endurance — l'économie du village *est* une stat de combat).
- **Télégraphes lisibles** (wind-ups 300-500 ms) + **engagement directionnel** (dégâts et blocage) : le positionnement de groupe est le vrai skill collectif. Et c'est le design le plus tolérant à la latence — critère appliqué en continu.
- **Lisibilité avant spectacle** : peu de particules, silhouettes contrastées, zones d'effet nettes. À quinze joueurs devant une brèche, l'écran doit rester lisible.
- **Blessures plutôt que PV secs** : jambes = ralenti, bras = attaques dégradées, saignement à bander. Crée la retraite (on décroche avant de mourir), le médecin de terrain, le ramassage des blessés.

### La mort : chère, pas cruelle

À la mort : on lâche **ce qu'on porte** (inventaire + équipement, lootables sur le cadavre), on garde **compétences** et tenue de base, respawn au Feu du village avec fatigue lourde (~30 min). Conséquences désirables : l'équipement est consommable à l'échelle du serveur (débouché permanent des artisans), récupérer un cadavre allié est une mission, et le respawn au village fait du **Feu un objet stratégique** de siège.

**Le non-létal** : assommer ouvre la capture — rançons, échanges, libérations magnanimes (acte chaud). Exécuter un captif = acte très froid, Cicatrice. Le choix létal/non-létal est un choix *politique* au cœur du combat : c'est là que l'alignement s'incarne physiquement.

### Le raid : une opération en quatre temps

1. **Repérage** (jours avant) : patrouilles, Gardiens connectés, cartographie des murs, infiltration d'Hôte. L'information est la première ressource du raid.
2. **Préparation** (le coût d'entrée) : béliers, échelles, charges, charrettes — gros artisanat, matériaux rares. Le régulateur anti-spam : chaque raid est une *décision*. Le matériel de siège est lent à transporter et lootable — la colonne interceptée en route est une bataille de plaine émergente.
3. **Assaut** (15-30 min) : la défense architecturale + la milice PNJ tiennent les premières minutes ; l'**alarme** (audible + notifiée aux membres connectés) fait converger les défenseurs. Le Feu défendu confère le respawn : l'attaquant doit atteindre les coffres *vite* (raid éclair) ou couper le respawn en occupant le Feu (conquête, bien plus dur).
4. **Extraction** : le loot pèse — bras chargés = lent, sans arme ; charrette = rapide sur route, bruyante, attaquable. Le butin n'est acquis qu'une fois déposé au Feu de la Meute. La contre-poursuite est un gameplay entier.

### L'offline

Cumul de trois mécanismes : **fenêtres de vulnérabilité déclarées** (créneaux « raidables » avec minimum obligatoire ; hors créneau, structures quasi indestructibles — modèle Conan Exiles), **garnison PNJ** qui tient les murs, **loot réduit hors présence** (coffres à rendement plafonné). Le *vol furtif* léger reste possible hors fenêtre : l'infiltration ne dort jamais, seule la destruction dort.

### Le PvE : l'école de guerre

Hordes et faune servent trois fonctions : tutorial de combat permanent (on apprend la ligne de front contre des zombies), pression commune (même les Ermitages entretiennent une milice), et théâtre des grands moments coopératifs — la méga-horde du Grand Froid ne négocie avec personne, et une Meute et un Foyer tenant le même pont dos à dos fabriquent les chroniques de saison.

---

## 8. Économie & artisanat

### Principe : une économie de flux, pas de stock

Tout se consomme — outils qui s'usent, armes lootables, nourriture périssable, murs qui se dégradent. La consommation donne un débouché permanent aux artisans, une raison de commercer, une cible aux raids. *Un serveur où tout le monde a plafonné en semaine 2 est mort en semaine 3.*

### Trois tiers, calés sur les trois actes

| Tier | Ressources | Localisation | Rôle |
|---|---|---|---|
| T1 | Bois, pierre, fibres, gibier | Partout, sûr | Survivre |
| T2 | Métal, charbon, cuir, plantes médicinales | Zones contestées (ruines, rivière, mine) | Forcer les villages à sortir et se croiser |
| T3 | Acier, composants, chimie | Événements (convois, bunkers du Grand Froid) + démantèlement | Sièges et fin de saison |

**La rareté géographique fait la politique : la carte est l'économie.**

### Chaînes courtes, interdépendance humaine

2-3 étapes max (minerai → lingot → outil), mais chaque étape demande une *station* différente tenue par des spécialisations différentes. La profondeur vient de la coordination humaine, pas de la complexité des recettes. On n'est pas Factorio : la logistique intéressante est sociale.

### Pas de monnaie codée

Troc pur ; si un serveur élit une monnaie (le lingot, la conserve), elle émerge. Pas de market global : le commerce a un **corps physique et vulnérable** — les caravanes escortées sont le gameplay commercial.

### Nourriture — DÉCISION ACTÉE

**Faim simple + bonus de moral pour les repas variés.** La richesse sans la microgestion punitive.

### Robinets et éviers par acte

Le Grand Froid double la consommation au moment où les sources se contractent. La courbe de pression économique de la saison est un levier de design de premier ordre.

---

## 8bis. La collecte des ressources

### Principe directeur

**La collecte est le tissu conjonctif entre tous les systèmes** : c'est elle qui met les joueurs sur les routes, donc dans les rencontres, donc dans la politique. Elle est designée comme des *trajets*, jamais comme du farm solo optimisé.

### Le geste : actif, jamais AFK

Chaque type de collecte a un mini-gameplay court — un *geste*, pas un mini-jeu envahissant : timing de frappe à l'abattage, veines à lire au minage (frapper le point faible), reconnaissance des plantes en cueillette (l'herboriste voit ce que le novice piétine — la maîtrise comme perception), pistage/approche/tir à la chasse, ferrage à la pêche. Deux interdits : **pas de collecte automatique par le joueur** (l'AFK ne récolte rien — c'est le travail des PNJ), **pas de barre de progression passive** (chaque unité passe par un input).

### Trois cercles de risque

1. **Cercle domestique** (rayon du village et abords) : sûr, renouvelable vite, *médiocre*. Un village y survit, n'y prospère jamais. Le cercle des PNJ et des sessions courtes.
2. **Cercle contesté** (5-10 min de marche) : les gisements T2 — mine, grande forêt, rivière, ruines mineures. Riches, **localisés et partagés** entre villages ; personne n'en est propriétaire (sauf ouvrage de terrain — le poste de guet sur la mine est une déclaration). La mine est le café du commerce de la vallée ; son contrôle informel est le premier étage de la géopolitique. Renouvellement **lent et par rotation** : les filons s'épuisent localement et rouvrent ailleurs — les points de friction se *déplacent* au fil de la saison.
3. **Cercle sauvage** (marges, zones dangereuses) : le T3 événementiel, ruines majeures, faune dangereuse, zones irradiées (équipement requis). Haut risque, expéditions organisées, sessions longues.

Au Grand Froid, le domestique s'appauvrit (neige, gel), poussant tout le monde vers le contesté au moment où les tensions montent — c'est ici que s'implémente la courbe de pression économique du §8.

### Le transport : la moitié du gameplay

**Collecter est facile, rapporter est le jeu.** Brassées de bois, hottes de minerai, charrettes, gros gibier à traîner ou découper sur place. Conséquences : Portage/Colonne devient un métier central, les routes comptent (charrette rapide sur route, lente en friche → trafic concentré → embuscades localisées → escortes sensées), et le vol de récolte en transit est du PvP *léger* quotidien — premier sang d'engagement, pas de siège : la petite criminalité qui texture le monde entre deux guerres.

### Les PNJ collecteurs : le plancher, jamais le plafond

Les PNJ récoltent le **cercle domestique uniquement** (bois de chauffe, eau, potager) — ils maintiennent le village, ne l'enrichissent pas. Exception designée : l'**expédition PNJ escortée** — convoi de porteurs vers le contesté, exigeant une escorte joueur, visible et attaquable. Le levier qui transforme la logistique en événement social ; la version Veillée (escorte contre menaces IA) prototype exactement la version multi.

### Garde-fous anti-corvée

Rendements par geste croissants avec la maîtrise (le spécialiste fait en 20 min ce que le novice fait en 45 — la spécialisation *économise le temps des autres*) ; besoins du village lents (règle des 3-4 jours) ; **jamais de quotas quotidiens systémiques** — le seul « daily » est celui que ta communauté t'impose, si elle le décide (option de charte). Le jeu ne donne pas de devoirs ; la communauté, peut-être.

### Vigilance playtest

L'équilibre du cercle contesté est le réglage le plus sensible du jeu : trop riche → plus besoin de commercer (mort du Marché) ; trop pauvre → la collecte devient le goulot universel (mort du fun). Levier fin : la rotation des filons — ajuster la rareté dans le temps sans toucher aux rendements.

### Catalogue des ressources

*Liste volontairement resserrée (~20 ressources brutes) — chaque ajout devra justifier une boucle qu'aucune ressource existante ne couvre.*

**Ressources brutes — Tier 1 (cercle domestique)**

| Ressource | Source | Usages principaux |
|---|---|---|
| Bois | Arbres communs | Construction N1, outils, **bois de chauffe** (le Feu, la température) |
| Pierre | Affleurements de surface | Construction N1, outils |
| Fibres végétales | Cueillette | Tissu simple, cordages, bandages |
| Argile | Berges | Poteries (stockage), torchis |
| Baies & légumes | Cueillette, potager | Nourriture de base |
| Petit gibier | Chasse (lapins, oiseaux) | Viande, peaux légères |
| Eau | Puits, rivière | Boisson, cuisine, soin |
| Plantes communes | Cueillette | Remèdes simples (Herboristerie N1) |
| Ferraille | Débris épars, carcasses | Métal de récupération (Forge N1) |

**Ressources brutes — Tier 2 (cercle contesté)**

| Ressource | Source | Usages principaux |
|---|---|---|
| Minerai de fer | La mine | Lingots de fer → outillage/armes T2 |
| Charbon | La mine (veines dédiées) | Forge (fer, puis acier), chauffage dense |
| Bois d'œuvre | La grande forêt | Construction N2, charrettes, machines de siège |
| Pierre de taille | La carrière | Murs maçonnés, bâtiments N2 |
| Gros gibier | Chasse (cerfs, sangliers) | Viande riche, **cuir** |
| Poisson | La rivière | Nourriture, conserves |
| Sel | Source salante (localisée) | **Conserves** (le Grand Froid), tannage |
| Plantes médicinales | Zones humides, clairières | Antidotes, anti-infection, stimulants |

**Ressources brutes — Tier 3 (cercle sauvage & événements)**

| Ressource | Source | Usages principaux |
|---|---|---|
| Composants mécaniques | Démantèlement (ruines majeures, carcasses de convois) | Serrures, herses, pièges lourds, Ouvrages de la Cendre |
| Produits chimiques | Bunkers, convois | Charges incendiaires, explosifs de sape, médecine N3 |
| Plantes rares | Zones irradiées, événements | Pharmacopée, stimulants supérieurs |
| Semences maîtresses | Événements, Agriculture P4 | Variétés améliorées (héritage volable) |

**Matériaux transformés (chaînes de 2-3 étapes, stations requises)**

| Produit | Chaîne | Station |
|---|---|---|
| Planches | Bois d'œuvre → planches | Atelier |
| Lingot de fer | Minerai + charbon → lingot | Forge N2 |
| **Acier** | Lingot + charbon → acier | Forge N3 |
| Tissu | Fibres → tissu | Fumoir/tannerie |
| Cuir traité | Peaux + sel → cuir | Fumoir/tannerie |
| Conserves | Nourriture + sel/poterie → conserves | Cuisine (grenier) |
| Remèdes | Plantes → remèdes/antidotes/stimulants | Infirmerie |
| Charbon de bois | Bois → charbon de bois (rendement faible) | Four de l'atelier — le fallback des villages sans accès à la mine, coûteux : la dépendance au charbon minier reste un levier politique |

Notes de design : le **sel** est volontairement une source localisée unique par région — la ressource humble qui fait les guerres, parce que tout le monde en veut avant l'hiver et qu'elle ne se remplace pas. Le **charbon de bois** est la soupape qui évite qu'un blocus de la mine soit une élimination (cohérent avec l'anti-snowball) tout en gardant le blocus douloureux. L'**acier ne se ramasse pas** : il se forge (fer + charbon + Forge N3) — la puissance T3 martiale passe obligatoirement par l'économie et un bâtiment, donc par une cible de raid.

*Tous les rendements, temps et localisations : ordres de grandeur à calibrer en playtest.*

---

## 9. La carte

**DÉCISION ACTÉE : squelette artisanal, chair procédurale.** Pas de procédural intégral — le jeu repose sur la géographie politique (le col, le pont, la rivière), et le procédural pur produit des cartes sans *lieux*. La macro-structure de chaque saison est posée à la main dans Tiled (biomes, reliefs, 5-6 landmarks majeurs, goulots d'étranglement) ; la génération remplit (ressources T1/T2, végétation, ruines mineures, tanières, variations). Chaque saison : une carte nouvelle mais composée, avec des lieux nommables — « la bataille du Pont » exige un Pont.

- **Taille** : petite au départ. Une vallée pour 100-200 joueurs + villages PNJ, traversable en 10-15 min de marche. La densité de rencontres est le bien le plus précieux ; on agrandit quand les CCU le réclament.
- **Fondation de village** : sur **sites prédéfinis** uniquement (voir §6ter) — ~1,5× le nombre de villages attendus, gamme de tailles 4-6 à 12-15 slots, géométries défensives variées. Les sites sont posés à la main avec les landmarks dans le squelette artisanal de chaque saison — ce sont des landmarks.

---

## 9bis. Les événements du monde (PvE)

### Fonctions

Le PvE sert quatre rôles actés : **tutorial de combat permanent**, **pression commune** (même les Ermitages entretiennent une milice), **théâtre coopératif inter-villages**, et **robinet à sessions** (le joueur qui n'a envie ni de farmer ni de construire part en événement). S'y ajoute : **la source du T3** — les composants et la chimie n'existent que par événements et démantèlement.

### Trois principes

1. **Annoncés, pas surprises.** Presque tout événement se signale (fumée, vols d'oiseaux, grondement, rumeurs) et les spécialistes lisent mieux (Chasse P3 prédit hordes et migrations, Exploration P3 identifie de loin). L'événement récompense ceux qui savent avant les autres — l'éclaireur est une profession rentable.
2. **Le monde ne s'adapte pas.** Pas de scaling au groupe : le danger est une propriété du monde, la réponse est une propriété de ton organisation. Conséquence logique de la progression horizontale.
3. **Rien n'est instancié.** Tout événement est un lieu partagé : premier arrivé, ou dernier debout. Deux villages sur la même carcasse = le générateur de rencontres du jeu.

### Rythme

En permanence : 2-4 événements mineurs actifs sur la carte. Environ 1 événement majeur par semaine, télégraphié plusieurs jours à l'avance. Densité et composition évoluent par acte.

### Opportunités

| Événement | Cercle | Boucle |
|---|---|---|
| **Carcasse de convoi** | Contesté/sauvage | Loot T2/T3 par démantèlement (Mécanique). Convergence de plusieurs groupes garantie. |
| **Marchand nomade** | Traverse la carte | Caravane PNJ : biens rares (semences, plans, composants) contre production locale. Escortable (acte chaud), détroussable (acte très froid). Vend aussi des **rumeurs** — le courtier en information de la vallée. |
| **Migration de gibier** | Contesté | Abondance temporaire mobile pour les chasseurs. Prévisible par Chasse P3. |
| **Filon affleurant** | Sauvage | Nœud minier riche et temporaire — la ruée locale. |
| **Réfugiés** | Routes | Groupe de PNJ survivants : les recruter (population !), les nourrir (Chaleur), les refouler, les dépouiller. Les villages se les disputent — l'événement d'alignement par excellence, et la seule source de PNJ supplémentaires hors paliers du Feu. |
| **Cache découverte** | Sauvage | Bunker mineur à ouverture limitée dans le temps ; serrures (Mécanique P3). |

### Menaces

| Événement | Portée | Boucle |
|---|---|---|
| **Horde errante** | Trajectoire traversante | Frappe ce qui est sur son chemin. Prévisible (Chasse P3), **détournable** (viande, bruit, feux) — attirer une horde vers un rival est possible, coûteux, risqué, et difficile à prouver : la guerre déniable parfaite, sans premier sang ni refroidissement tant que personne ne t'a vu. Volontaire — l'arme des faibles et des Foyers hypocrites ; les chroniques adorent. |
| **Bêtes** | Locale | Meutes de prédateurs sur les routes et zones de chasse — le danger de fond des trajets. |
| **Brume irradiée** | Zone mobile | Déni de zone (équipement requis) ; en se retirant, elle **découvre** des ruines fraîches — la menace qui paie ceux qui la suivent. |
| **Blizzard** | Carte entière (actes II-III) | Voyager devient dangereux, la température s'effondre. L'économie rentre à l'intérieur ; raider *pendant* le blizzard est le pari des audacieux. |
| **Infestation** | Sur un gisement contesté | Un nid bloque une ressource jusqu'au nettoyage — le donjon coopératif léger, qui force parfois des voisins méfiants à collaborer. |

### Majeurs, par acte

- **Acte I** : le *Convoi inaugural* — grand marchand escorté traversant la vallée, premier contact commercial et premier point de friction entre villages naissants.
- **Acte II** : la **Méga-horde** (télégraphiée des jours à l'avance, trajectoire lisible — l'événement « tenir le pont dos à dos ») ; l'**Ouverture du bunker** (site T3 majeur ouvert quelques jours : toute la vallée converge — le champ de bataille de mi-saison).
- **Acte III** : la **Cendre** — l'objectif final de saison (convoi d'évacuation / arche), design détaillé à trancher, victoires par archétype déjà actées (§2).

### Vigilance

Le réglage sensible : la part du T3 événementiel vs démantèlement. Trop d'événements T3 → les groupes forts monopolisent la puissance de fin de saison ; trop peu → la Cendre se joue sans moyens. Levier : multiplier les événements T3 *petits* plutôt que grossir les gros.

*Nature exacte des hordes et de la faune (lore du monde) : à trancher — voir §15.*

---

## 10. Le pont solo → multi : le mode Veillée

**Chaque village est peuplé de PNJ par défaut** — villageois simulés (RimWorld-light) qui récoltent, patrouillent, dorment, paniquent. Un joueur seul fonde un village, le développe, subit des raids de Meutes PNJ, joue une saison entière hors ligne : c'est le **mode Veillée**, jeu solo complet.

Triple fonction :

1. **Produit** : le jeu est achetable et complet en solo dès le premier jour ; le serveur saisonnier est la promesse au-dessus. Démo gratuite = produit d'appel et machine à wishlists.
2. **Banc de test permanent** : chaque système (économie, sièges, hordes, alignement) est testable sans un seul autre humain. La simulation PNJ sert de bots de charge pour le serveur.
3. **Design** : rejoindre un village en multi = prendre la place d'un PNJ (son quartier dans la caserne, ses outils, son poste). Les humains font tout mieux que les PNJ : négocier, mentir, improviser, tenir une brèche. Un village 100 % PNJ *survit* ; un village avec cinq humains *prospère*. L'incitation au multi est diégétique : les PNJ ne trahissent personne d'intéressant. **Le solo t'apprend le jeu ; le multi te donne des histoires.**

---

## 11. Stack technique & architecture

### Principe n°1 : la simulation comme paquet partagé

Un seul langage partout (TypeScript). Monorepo pnpm workspaces :

```
/packages
  /sim       ← toute la logique de jeu, ZÉRO dépendance à Phaser ou au réseau
  /client    ← Phaser 4 : rendu, input, interpolation, UI
  /server    ← Node : boucle autoritative, rooms, persistance
```

`/sim` : entités, combat, endurance, blessures, collisions (grille + AABB maison — **pas de moteur physique**, ni Arcade ni Matter), pathfinding (grille + flow fields pour les hordes), IA des PNJ, alignement, économie. TypeScript pur, testé en unitaire.

Le mode Veillée = `/sim` dans un Web Worker navigateur. Le multi = `/sim` sur Node. **On ne développe pas un jeu solo puis un jeu multi : on développe une simulation, puis on la déplace.** Discipline absolue : si `/sim` reste pur du jour 1, chaque phase est une extension, jamais une réécriture.

### Les couches

| Couche | Choix | Notes |
|---|---|---|
| Client | Phaser 4 + Vite + TS | Capital Manif conservé (lighting normal-mapped, Tiled, Aseprite, déploiement web = canal de playtest zéro friction). Client « bête » : inputs → serveur, snapshots → interpolation, prédiction locale sur le déplacement de son avatar uniquement. |
| Serveur | Node.js + Colyseus | Rooms = zones de la vallée (architecture MMO-lite en chunks, migration transparente). Tick **10-15 Hz** (assez pour des wind-ups 300-500 ms), interpolation client ~100 ms. PNJ hors zone active en **simulation dégradée** (tick lent, décisions agrégées — pattern RimWorld côté serveur). Alternative SpacetimeDB étudiée et écartée (jeune, Rust/C#, perte de maîtrise). |
| Persistance | PostgreSQL seul | État chaud en mémoire dans les rooms + **write-behind** (flush 30-60 s + événements critiques : mort, transaction, changement de rang). ORM Drizzle ou Prisma. Sauvegardes quotidiennes + WAL. Pas de Redis, pas de queue, pas de microservices. |
| Infra | 1 VPS Hetzner (8 vCPU/16 Go, ~40 €/mois) | Docker Compose (jeu + Postgres), Caddy (TLS/WebSocket), client statique sur Cloudflare Pages. Staging identique en petit. Une carte = une saison = un serveur (c'est aussi un argument de design : la vallée est un lieu). Résister à Kubernetes. |
| Outillage | Tiled, Aseprite, Vitest | Effort de test concentré sur `/sim`. **Tests headless** : des centaines de bots scriptés sur `/sim` pour la charge et les bugs économiques. **Replay log dès le jour 1** : le serveur journalise tous les inputs — debug or massif (3 soirées au jour 1, 3 semaines en greffe tardive). Auth par magic link email. Discord pour la communauté. |

### Anti-cheat & modération

- Le serveur autoritatif fait 90 % de l'anti-cheat (pas de dégâts falsifiables, pas de téléportation, pas de dupe). Reste : **validation de vraisemblance** dans `/sim` dès le début (cadences, vitesses, portées).
- Multicompte/partage de compte : un compte = un personnage vivant par saison, friction légère à la création (email vérifié + délai avant de rejoindre un village) — et le design social (Hôte, historique public) rend l'espion jetable coûteux.
- ESP/wallhack : limité par l'interest management (le serveur n'envoie que ce que le client a le droit de voir). Jamais éliminé à 100 % — aucun jeu n'y arrive.
- **Le replay log est aussi le tribunal** : toute accusation se vérifie en rejouant la scène.
- Modération humaine : chat proximité + chat village uniquement (pas de global — moins de toxicité, plus de mystère), mute/report jour 1, charte de serveur courte, 2-3 modérateurs bénévoles du Discord avec outils simples (téléport, freeze, ban). Outillage admin dans la roadmap. Règle d'or de la charte : *le vol, la trahison et la guerre sont du jeu ; le harcèlement hors-jeu, le blocage de spawn et les slurs n'en sont pas.*

---

## 12. Modèle économique — DÉCISION ACTÉE

**Premium achat unique, 15-20 €, tout inclus.** Le prix d'entrée est le premier anti-cheat (bannir coûte au banni) et le premier filtre communautaire. Pas de F2P (attire les comptes jetables), pas d'abonnement (tueur d'adoption), **jamais de pay-to-win** (le cœur du jeu est l'équité politique émergente).

Plus tard si le jeu vit : cosmétiques (skins de Feu, bannières, tenues) coexistant avec les Mémoires gagnées — les plus beaux marqueurs restent *gagnés* (le cosmétique acheté dit « j'ai soutenu le jeu », la Cicatrice dit « j'y étais »).

Chemin de sortie : démo/playtests gratuits sur Cloudflare pendant la phase Veillée → early access Steam quand la Saison 0 a prouvé la boucle (les 30 % de Steam achètent une découvrabilité inaccessible autrement) → le web reste le canal de test.

---

## 13. Roadmap

1. **Phase Veillée** (des mois) : `/sim` + `/client`, zéro réseau. Tout le jeu (village, PNJ, combat, alignement, saisons accélérées) en local dans le Worker. Itération à la vitesse de Manif, builds de playtest solo sur Cloudflare.
2. **Phase LAN** : ajout de `/server` + Colyseus, une seule zone, 3 joueurs. La simulation ne change pas — test de l'architecture partagée. Prédiction/interpolation écrites une fois, proprement.
3. **Phase Vallée** : multi-zones, persistance Postgres, migrations de room, carte complète, staging public.
4. **Saison 0** : 30 jours (au lieu de 60), ~50 joueurs recrutés, wipe assumé. On regarde l'écosystème politique vivre ou brûler.

MVP gouvernance en phases 1-2 : rang unique + Chef + propriété individuelle. MVP alignement : les deux axes + Foyer/Meute seulement, Ermitage/Charognard en phase 3.

---

## 14. Décisions actées (récapitulatif)

| # | Décision |
|---|---|
| 1 | Top-down 2D pixel art, avatar par joueur, villages de joueurs |
| 2 | Alignement 100 % émergent, deux axes (Chaleur × Intensité), quatre archétypes |
| 3 | Bonus : continu pour les stats passives, paliers pour les capacités |
| 4 | L'isolement (Ermitage) est un build complet — personne n'est forcé au jeu social |
| 5 | Gouvernance : serrures pas lois ; Charte à 3 modèles ; réputation mesurée jamais automatique ; Scission comme soupape |
| 6 | Combat lent positionnel (endurance, télégraphes, blessures) ; mort = perte du porté, jamais des compétences |
| 7 | Raid en 4 phases ; offline traité par fenêtres + garnison PNJ + loot réduit |
| 8 | Économie de flux, 3 tiers géographiques, troc pur, pas de market global |
| 9 | Nourriture : faim simple + moral pour la variété |
| 10 | Carte : squelette artisanal + remplissage procédural, petite au départ |
| 10bis | Construction : sites prédéfinis + slots typés (modèle State of Decay), caserne commune avec quartiers personnels, ouvrages de terrain hors slots en exception plafonnée |
| 11 | Saison 60 jours / 3 actes / wipe / Mémoires + chronique |
| 12 | Mode Veillée solo = même simulation que le multi (paquet `/sim` partagé) |
| 13 | Stack : Phaser 4 + Vite + TS / Node + Colyseus / PostgreSQL / VPS Hetzner + Cloudflare Pages |
| 14 | Modèle : premium 15-20 €, pas de F2P, pas de P2W |

## 15. À trancher plus tard

- **Audio & musique** : direction en suspens (piste identifiée : pipeline Strudel génératif exporté en stems + SFX packs CC ; alternative : bande-son commandée). Contrainte déjà actée : hiérarchie sonore de gameplay — les sons « politiques » (alarme, cor, cloche) portent loin et s'identifient instantanément ; audio positionnel 2D requis.
- **Nom définitif** (BRAISES = titre de travail) et validation de la métaphore du Feu.
- **Paramètres chiffrés** : tous les nombres du document (durées, fenêtres, plafonds, tick rate, prix) sont des ordres de grandeur à calibrer en playtest.
- **Détails d'artisanat** : recettes finales objet par objet (l'arbre des maîtrises est en Annexe A, les bâtiments en Annexe B, les ressources et chaînes en §8bis ; reste le chiffrage recette par recette).
- **Gameplay de repérage** : outils exacts (lunettes, déguisements, points d'observation) à prototyper.
- **Lore du monde** : nature exacte de l'apocalypse, des hordes et de la faune (le catalogue d'événements du §9bis est agnostique — infectés, mutants, autre : à trancher avec la direction artistique).
- **Plans des sites** : géométries site par site, répartition production/fortification, calibrage nombre de sites × taille de carte (le catalogue des bâtiments est en Annexe B).
- **Objectif final de la Cendre** : design précis de l'événement de fin de saison par archétype (cadre posé en §9bis).
- **Steam & marketing** : timing early access, page, capsule — après Saison 0.

---

## Annexe A — L'arbre des Maîtrises

### Règles transversales

- **4 paliers par branche.** Palier 1 : rapide (une soirée d'usage — rattrapage intégré, hors budget). Palier 2 : quelques jours. Palier 3 : 2-3 semaines. Palier 4 : réservé à ceux qui *sont* ça (un par village, en pratique).
- Chaque palier = un **déblocage nommé** (capacité ou recette) + un gain plat mineur (vitesse, marge d'échec). Jamais de multiplicateur de puissance.
- Les paliers 3-4 sont synchronisés avec les tiers de matériaux et les actes de la saison : personne ne forge de l'acier en semaine 1, c'est voulu.
- **Budget** : ≈ 2 branches au palier 4 + 2-3 branches au palier 2 ; érosion lente au-delà. Paliers 1 hors budget.
- Progression **à l'usage** uniquement, accélérée par le moral et l'**enseignement** (apprendre à côté d'un spécialiste).

### Famille Combat

*Motif : chaque palier 4 est collectif — le sommet du combat individuel rend le groupe meilleur, jamais le vétéran injouable en 1v1.*

| Branche | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| **Mêlée** | *Garde* (blocage directionnel de base) | *Riposte* (contre après blocage réussi — le déblocage du duelliste) | *Frappe assommante* (le non-létal : capture → rançons → politique ; volontairement accessible) | *Ligne* (aura courte : alliés adjacents en formation dépensent moins d'endurance au blocage — le sergent de brèche) |
| **Tir** | *Arcs simples* | *Tir appuyé* (précision immobile/à couvert — positionnel, pas du kite) | *Munitions spéciales* (feu, filet — utilitaire, pas DPS) | *Sentinelle* (repérage accru en poste de garde, désignation de cible visible des alliés) |
| **Défense** | *Boucliers légers* | *Mur* (blocage statique très renforcé mais enraciné — l'ancre de formation) | *Sous le pavois* (protège un allié adjacent qui porte/soigne/crochette) | *Indélogeable* (immunité aux repoussements en position tenue — l'homme-porte des sièges) |

### Famille Artisanat

| Branche | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| **Forge** | Outils/armes T1 en métal de récupération | Le fer (outillage T2 — change la vie du village) | **L'acier** (T3, événement de village, exige la forge améliorée — bâtiment collectif) | *Signature* (pièces maîtresses uniques marquées du nom du forgeron, légèrement au-dessus des specs T3 — l'objet qui circule et se raconte) |
| **Menuiserie** | Structures T1, mobilier | Palissades renforcées, charrettes | **Machines de siège** (béliers, échelles, mantelet) + contre-siège (herses, chicanes) | *Grands ouvrages* (pont, tour de guet, moulin — les projets qui changent la carte) |
| **Couture/cuir** | Vêtements simples (température) | Armures légères, sacs (charge portée) | Tenues d'hiver lourdes (la branche qui sauve du Grand Froid) + camouflages (synergie Furtivité) | *Bannières* (marqueurs d'identité de village, portables en formation, micro-bonus de moral — le porte-étendard) |
| **Mécanique** | Démantèlement (composants T3 des ruines/carcasses — seule source hors événements) | Pièges mécaniques | Serrures complexes **et** leur crochetage (la course serrurier/voleur est interne à la branche) | *Ouvrages de la Cendre* (composants de l'objectif final — la branche devient centrale quand le monde meurt) |

*Mécanique est quasi vide avant l'acte II — branche tardive par design.*

### Famille Subsistance

| Branche | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| **Agriculture** | Potager | Champs, greniers (stockage longue durée) | Serres/cultures d'hiver + prérequis du **Terroir** (Ermitages) | *Semences maîtresses* (variétés améliorées, transmissibles — un héritage qui se vole en raid) |
| **Chasse/pêche** | Petit gibier, pêche à la ligne | Pièges, dépeçage efficace (rendement cuir — synergie Couture) | Gros gibier + lecture des migrations (voir venir les hordes — rôle défensif caché) | *Traque* (suivre les traces de joueurs — l'anti-furtivité et l'outil du contre-raid) |
| **Cuisine** | Cuire (sécurité alimentaire) | Conserves (l'hiver, encore) | Repas de village (banquet : moral collectif avant siège ou grand projet) | *Table ouverte* (les repas servis à des étrangers pèsent davantage en Chaleur — le cuisinier-diplomate) |

### Famille Soin

| Branche | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| **Médecine** | Bandages (stopper le saignement — accessible à tous, hors budget) | Attelles, blessures graves | Chirurgie de terrain (stabiliser en combat — le médecin de raid) | *Triage* (soigner plusieurs blessés en zone — l'hôpital de campagne ; soigner les prisonniers ennemis = gros acte de Chaleur) |
| **Herboristerie** | Plantes communes, remèdes simples | Antidotes, anti-infection (les blessures négligées s'infectent — l'évier de la branche) | Stimulants (endurance temporaire, fatigue en contrepartie — le dopage de siège, avec son coût) | *Pharmacopée* (jardin médicinal de plantes rares — l'indépendance d'approvisionnement, très Ermitage) |

### Famille Terrain

| Branche | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| **Exploration** | Lecture de carte, marche hors route | *Cartographie* (annoter/partager des cartes — l'information devient un objet échangeable, volable) | Repérage lointain (bannières et couleur de Feu à grande distance — l'éclaireur lit la politique) | *Passes* (franchissements exclusifs avec groupe réduit : gués, éboulis — infiltration d'élite et évasion) |
| **Furtivité** | Marche silencieuse | Dissimulation statique (invisible aux PNJ, immobile à couvert) | *Déguisement* (porter les couleurs d'un autre village — tient jusqu'au premier acte hostile ou à l'inspection rapprochée) | *Ombre* (signature réduite au repérage et à la Traque — le contre exact du chasseur P4 : la course furtivité/détection est un duel de spécialistes) |
| **Portage/logistique** | Charge accrue | Conduite de charrette efficace | *Colonne* (bonus de vitesse aux convois dirigés — le maître-caravanier, pilier du commerce ET des raids) | *Intendance* (camp avancé : coffre de campagne, ravitaillement temporaire — la projection de puissance des grosses opérations de fin de saison) |

*La branche méprisée qui gagne les guerres.*

### Propriétés d'ensemble

- **Synergies croisées volontaires** (chasse→couture, mécanique serrurier/voleur, traque↔ombre, cuisine→diplomatie) : les *paires* de spécialistes valent plus que la somme — la composition d'un village est un puzzle social.
- **Chaque branche a son crochet politique** : même la cuisine et le portage touchent à l'alignement ou à la guerre. Aucune spécialisation n'exile son joueur du drama central.
- **L'économie de l'information** est un mini-jeu distribué sur quatre branches (Tir, Chasse, Exploration, Furtivité) — l'information étant la première ressource du raid, son économie est designée aussi soigneusement que celle du fer.

### Point de vigilance playtest

Médecine 1 hors budget et quasi obligatoire est assumé (un groupe sans bandages n'est pas un choix intéressant, c'est une erreur de débutant). Mais si tout le monde prend systématiquement les trois mêmes paliers 1, c'est qu'ils devraient être des mécaniques de base, pas des maîtrises. À surveiller.

*Tous les seuils, durées et effets de cette annexe sont des ordres de grandeur à calibrer en playtest.*

---

## Annexe B — Catalogue des bâtiments

### Règles du catalogue

- **Trois types de slots** par site : **production** (cœur économique), **fortification** (périmètre, positions fixées par la géométrie du site), et **fixes** (Feu + caserne, présents partout, hors choix).
- **Critère de tri** : chaque bâtiment doit être désirable pour tous mais prioritaire pour personne de la même façon. Un no-brainer universel devient un niveau des fixes, pas un choix de slot.
- **Trois niveaux par bâtiment** (N1 = T1, N2 = T2/Grand Froid, N3 = T3/Cendre). Upgrade in-place vs ouvrir un slot : la tension extension/approfondissement.
- **Chaque bâtiment sert une maîtrise** (sa station) ; plusieurs sont prérequis de capacités palières d'alignement. Construire une forge sans forgeron est un slot gâché — le recrutement est de la planification urbaine.

### Slots de production

| Bâtiment | Station | N1 | N2 | N3 | Note |
|---|---|---|---|---|---|
| **Forge** | Forge | Outils/armes fer de récup | Le fer (outillage T2 du village) | Forge d'acier (prérequis acier) | Le bâtiment le plus contesté du jeu |
| **Atelier** | Menuiserie, Mécanique | Charrettes, mobilier | Pièces de contre-siège (alimente les fortifs) | Machines de siège lourdes, Ouvrages de la Cendre | Signature Meute en N3, indispensable à tous en N2 |
| **Grenier** | Cuisine (conserves) | Stockage anti-pourriture | Grande réserve + cave (passe le Grand Froid) | Réserve stratégique (compte pour l'évacuation Foyer) | No-brainer apparent : un petit village en flux tendu s'en passe en acte I |
| **Infirmerie** | Médecine, Herboristerie | Lits de soin | Chirurgie + jardin médicinal (Pharmacopée) | Hôpital (prérequis Triage P4, compte les vies sauvées) | Le bâtiment moralement chargé : on y soigne aussi les prisonniers |
| **Marché** | — (social) | Étals (commerce en zone dédiée sans entrer dans l'enceinte — le sas diplomatique) | Halle + contrats enregistrés (pactes traçables — matière à Chaleur et à parjures) | **Marché franc** (capacité Foyer : zone de trêve, premier sang impossible) | Inutile aux Ermitages, vital aux Foyers — l'anti-grenier |
| **Ferme** | Agriculture | Champs | Serre (cultures d'hiver) | Terroir (exclusivité Ermitage) | Concurrent du grenier : produire plus vs conserver mieux |
| **Fumoir/tannerie** | Chasse, Couture | Traitement gibier/peaux | Tenues d'hiver en série | Bannières et camouflages | Le bâtiment des villages tournés vers l'extérieur |

### Slots de fortification

*Positions fixées par la géométrie du site — c'est la personnalité défensive d'un site : où sont ses slots de fortif, et combien.*

| Bâtiment | N1 | N2 | N3 | Rôle |
|---|---|---|---|---|
| **Tour de guet** | Poste surélevé, bonus Sentinelle | Hourds (tir protégé) | Grande tour (voit par-dessus le brouillard local) | L'anti-surprise |
| **Porte fortifiée** | Porte bardée | Sas double | Herse mécanique (exige atelier N2) | Chaque niveau ajoute du temps au bélier — le temps est ce que la défense achète |
| **Poste de garde** | 2 gardes PNJ + ralliement d'alarme | 4 gardes + rondes | Caserne de milice (gardes équipés au niveau de la forge) | La défense offline par excellence |
| **Piégerie** | Fosses/mâchoires | Pièges mécaniques (atelier requis) | Champ dense anti-horde | L'anti-masse — fort contre les hordes, faible contre l'infiltration |
| **Bastion** *(gros sites)* | — | Position de repli intérieure | Réduit fortifié | Le choix des villages qui se savent ciblés |

*Chaînes de dépendance volontaires entre slots (herse ← atelier, milice équipée ← forge) : le build est un graphe, pas une liste.*

### Les fixes

- **Le Feu** : paliers du village (rayon, slots débloqués, PNJ, protections offline, respawn).
- **La caserne** : N1 dortoir + quartiers personnels ; N2 quartiers améliorés (moral « chez soi » accru) + cuisine commune ; N3 grand réfectoire (les banquets de Cuisine P3 s'y tiennent). Repas et sommeil — les no-brainers universels — vivent dans les fixes, conformément au critère de tri.

### Builds types (vérification du puzzle)

Sur un site moyen (8 production + 4 fortification) :

- **Foyer** : marché tôt → N3, infirmerie, grenier, ferme ; portes/sas et postes de garde. Site idéal : le carrefour (beaucoup d'approches = beaucoup de commerce).
- **Meute** : atelier prioritaire, forge, fumoir ; infirmerie tardive, jamais de marché ; fortifs légères (la Meute défend peu, elle est ailleurs). Site idéal : petit, une approche, près des routes.
- **Ermitage** : ferme → Terroir, grenier, piégerie et bastion maxés ; pas de marché ; atelier N2 (contre-siège). Site idéal : la falaise, le col.
- **Charognard** : build minimal — fumoir, atelier N1, tout en mobilité. Site : le plus petit et caché possible.

Quatre silhouettes distinctes au premier regard d'un éclaireur. Les chantiers étant visibles (fantômes puis échafaudages), **le build du village est semi-public** — voir un atelier N3 en construction chez le voisin est un renseignement de guerre. Cohérent avec la lisibilité à trois couches de l'alignement.

### Ouvert

- Répartition exacte production/fortification par site : level design fin, site par site.
- **Chenil/écurie** (animaux de trait, chiens de garde anti-furtivité offline) : en réserve — ouvre la question des animaux, hors scope actuel.

*Tous les effets et seuils : ordres de grandeur à calibrer en playtest.*
