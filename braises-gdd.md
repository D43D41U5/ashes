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

Un Gardien ou un groupe de Résidents peut fonder un nouveau Feu, chacun **partant avec ce qui lui appartient** (outils, coffre, matériaux de sa maison démontables à taux réduit ; les communs restent). Quitter est toujours possible, jamais gratuit. La menace crédible de scission est le vrai contre-pouvoir du chef — et le serveur y gagne des guerres fratricides entre village-mère et village-fils.

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

1. **Besoins personnels** : équipement, compétences, sa maison (la propriété privée dans le collectif = moteur d'attachement).
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

## 9. La carte

**DÉCISION ACTÉE : squelette artisanal, chair procédurale.** Pas de procédural intégral — le jeu repose sur la géographie politique (le col, le pont, la rivière), et le procédural pur produit des cartes sans *lieux*. La macro-structure de chaque saison est posée à la main dans Tiled (biomes, reliefs, 5-6 landmarks majeurs, goulots d'étranglement) ; la génération remplit (ressources T1/T2, végétation, ruines mineures, tanières, variations). Chaque saison : une carte nouvelle mais composée, avec des lieux nommables — « la bataille du Pont » exige un Pont.

- **Taille** : petite au départ. Une vallée pour 100-200 joueurs + villages PNJ, traversable en 10-15 min de marche. La densité de rencontres est le bien le plus précieux ; on agrandit quand les CCU le réclament.
- **Fondation de village** : semi-libre — un Feu s'allume où on veut, hors zones interdites (proximité des landmarks, spawns, autres Feux). La liberté de Rust sans les abus de blocage de contenu.

---

## 10. Le pont solo → multi : le mode Veillée

**Chaque village est peuplé de PNJ par défaut** — villageois simulés (RimWorld-light) qui récoltent, patrouillent, dorment, paniquent. Un joueur seul fonde un village, le développe, subit des raids de Meutes PNJ, joue une saison entière hors ligne : c'est le **mode Veillée**, jeu solo complet.

Triple fonction :

1. **Produit** : le jeu est achetable et complet en solo dès le premier jour ; le serveur saisonnier est la promesse au-dessus. Démo gratuite = produit d'appel et machine à wishlists.
2. **Banc de test permanent** : chaque système (économie, sièges, hordes, alignement) est testable sans un seul autre humain. La simulation PNJ sert de bots de charge pour le serveur.
3. **Design** : rejoindre un village en multi = prendre la place d'un PNJ (sa maison, ses outils, son poste). Les humains font tout mieux que les PNJ : négocier, mentir, improviser, tenir une brèche. Un village 100 % PNJ *survit* ; un village avec cinq humains *prospère*. L'incitation au multi est diégétique : les PNJ ne trahissent personne d'intéressant. **Le solo t'apprend le jeu ; le multi te donne des histoires.**

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
| 11 | Saison 60 jours / 3 actes / wipe / Mémoires + chronique |
| 12 | Mode Veillée solo = même simulation que le multi (paquet `/sim` partagé) |
| 13 | Stack : Phaser 4 + Vite + TS / Node + Colyseus / PostgreSQL / VPS Hetzner + Cloudflare Pages |
| 14 | Modèle : premium 15-20 €, pas de F2P, pas de P2W |

## 15. À trancher plus tard

- **Audio & musique** : direction en suspens (piste identifiée : pipeline Strudel génératif exporté en stems + SFX packs CC ; alternative : bande-son commandée). Contrainte déjà actée : hiérarchie sonore de gameplay — les sons « politiques » (alarme, cor, cloche) portent loin et s'identifient instantanément ; audio positionnel 2D requis.
- **Nom définitif** (BRAISES = titre de travail) et validation de la métaphore du Feu.
- **Paramètres chiffrés** : tous les nombres du document (durées, fenêtres, plafonds, tick rate, prix) sont des ordres de grandeur à calibrer en playtest.
- **Détails d'artisanat** : arbre complet des recettes, stations, spécialisations (structure posée, contenu à produire).
- **Gameplay de repérage** : outils exacts (lunettes, déguisements, points d'observation) à prototyper.
- **Événements PvE** : catalogue complet (types, fréquences, scaling par acte).
- **Objectif final de la Cendre** : design précis de l'événement de fin de saison par archétype.
- **Steam & marketing** : timing early access, page, capsule — après Saison 0.
