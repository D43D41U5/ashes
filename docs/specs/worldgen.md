# La génération de la vallée — un décor qui pousse à l'exploration

*Source : GDD §9 (carte), §8bis (les trois cercles), §13 (roadmap). Statut : **implémenté** (2026-07-14, critères A1-A12 verts). Jalon : Phase Veillée, chantier « le monde ».*

## Objectif de design

Le brief, mot pour mot : **« le jeu doit prendre place dans un décor qui pousse à l'exploration, où on se dit qu'en allant un peu plus loin, on va découvrir des choses nouvelles »**.

C'est une exigence sur la CARTE, pas sur les systèmes qui s'y posent. Les systèmes d'exploration existent déjà et sont bons : `knownPois` (la carte se gagne en marchant), les charges de savoir des Cairns et des Belvédères, les rumeurs achetables. Ce qui manquait, c'est un terrain qui les porte.

### Ce que l'audit a trouvé (2026-07-13, sur la vraie carte, seeds 2026 / 7 / 42)

| Constat mesuré | Conséquence de jeu |
|---|---|
| **Une seule composante marchable, zéro goulot** — on marche en ligne droite de n'importe où vers n'importe où | Rien n'est « derrière » quoi que ce soit. Or « qu'y a-t-il plus loin ? » suppose un *plus loin*. |
| **Trois seeds = le même lieu re-mélangé** | « Un peu plus loin » promet toujours la même chose. |
| **La rivière mourait au centre** de la carte | Aucun axe à suivre ; la moitié sud sans un cours d'eau. |
| **16 lieux sur 81 inatteignables** — dont les 3 Grottes, la Source chaude et le Belvédère | Les trois devises de `lieux.md` (savoir, répit, récit), mortes à 100 %, deux jours après leur livraison. |
| **Les zones humides n'existaient pas** (`peat_bog`, `reed_marsh` : 0 % de la carte) | Un biome entier, les deux terrains les plus lents du jeu, et la Fondrière : morts. |
| **La densité de lieux ne suit pas la surface** (75 lieux à 1200×1800, 69 à 2400×3600) | La carte cible aurait été quatre fois plus vide. |
| **4 seeds sur 16 faisaient PLANTER le client** au démarrage (`assertNoFold`) | Le jeu ne survivait que parce que la seed est codée en dur. |
| **24 % de la carte est un mur** (roche + neige + glacier) | Le haut de la montagne est un décor peint. → *question ouverte, voir plus bas* |

### Le principe qui guide tout

> **On ne teste pas qu'une carte est belle. On teste qu'elle se JOUE.**

Le journal du projet porte trois occurrences d'une même faute (2026-07-11 : « trois mécaniques mortes, toutes trouvées EN PILOTANT LE JEU, aucune visible en test headless »), et l'audit en a trouvé cinq de plus. La cause est invariable : **les tests posaient leurs propres petites cartes**, où les constantes de gameplay (des rayons en tuiles, absolus) ne rencontrent jamais la structure du monde (des fractions de carte, relatives). **Toute garde de cette spec tourne à la taille de production, sur cinq seeds** (`worldgen.test.ts`). Le coût est réel (~45 s de génération) ; il s'assume, il ne se rogne pas.

---

## Règles

### La connexité — ce qui communique avec quoi

- **R1 — « Marchable » n'est pas « atteignable ».** Une clairière au cœur d'un massif est faite de tuiles parfaitement praticables où nul ne mettra jamais les pieds. `connectivity.ts` est l'outil : composantes du marchable, distance de creusement au monde, et le point de départ.
- **R2 — 4-connexité, et ce n'est pas une commodité.** C'est le modèle du pathfinder (A* à 4 directions, spec pnj R8) ET de la collision (deux bloquants en diagonale ne laissent qu'un coin de largeur nulle, qu'une AABB de 0,6 ne franchit pas). Compter les diagonales donnerait des passages que personne ne peut emprunter.
- **R3 — LE MONDE = la plus grande composante.** Tout le reste est une poche. Le point de départ y naît (`walkableSpawn` — il vivait dans le client et ne vérifiait rien).
- **R4 — Un lieu n'a pas besoin d'un SOL, il a besoin d'un SEUIL.** La connexité entre dans l'ÉLIGIBILITÉ, pas dans le rattrapage. Un type qui ne peut pas s'ouvrir ici est écarté DE CE POINT ; il n'est jamais creusé de force. Budget : `MAX_CARVE_TILES = 3` — une porte, une vire, une margelle ; jamais un tunnel. La Grotte se pose alors au BORD du massif, ce qui est l'endroit exact où se trouve la bouche d'une grotte.
- **R5 — La table des lieux ne ment pas.** Un type dont aucune tuile ne satisfait (biome ∧ altitude ∧ accessible) ne naîtra jamais, sur aucune seed. Trois lignes étaient mortes, chacune pour une raison différente : d'où une garde sur la PROPRIÉTÉ, pas sur les cas.
- **R6 — Le semis décide de l'ABONDANCE ; la réservation décide de l'EXISTENCE.** Un lieu chargé qui ne trouve aucun point de semis éligible s'en voit attribuer un ailleurs sur la carte, en respectant l'espacement. Sans ce filet, l'Arbre remarquable (seul biome : la vieille forêt) disparaissait de certaines seeds — pas faute de vieille forêt, mais faute qu'un des soixante-six points du semis y tombe.

### Le fleuve — l'axe et la frontière

- **R7 — Une vallée se draine vers sa BOUCHE.** Le puits de l'arbre de drainage est le bord sud (le côté ouvert du relief), jamais le lac — qui n'est qu'un cul-de-sac.
- **R8 — Le tronc EST le thalweg.** Il suit l'arbre de drainage, donc le relief. Deux artefacts de grille doivent être matés : la pente infime des plats comblés (`FLAT_EPS`), et le lissage par moyenne glissante à fenêtre **symétrique** (une fenêtre tronquée aux bouts déplace les extrémités — c'est ce qui laissait un couloir en bas de carte).
- **R9 — La source est le plus long AFFLUENT.** La tuile la plus lointaine de la bouche dans l'arbre de drainage, et non le point le plus haut — qui peut tomber près de la bouche. Le fleuve est long **par construction**, pas par chance.
- **R10 — Le fleuve SÉPARE.** Cinq tuiles d'eau profonde bloquent : il coupe la vallée en deux rives (mesuré sur 12 seeds : la petite pèse de 30 à 48 % du marchable). Il court d'un mur à l'autre.
- **R11 — Le franchissement est une DÉCISION.** Des GUÉS, à intervalle régulier, où le cœur profond redevient franchissable — et lent (0,5). **Un gué doit relier DEUX RIVES** : on sonde la terre ferme de chaque côté, sinon on ne le pose pas (mesuré : un « Gué » naissait dans une gorge de roche, un autre au milieu d'un lac). Chaque gué est un **toponyme** : la carte le montre dès le premier jour — on cache les LIEUX, jamais le TERRAIN.

### Les pays — la vallée n'est pas un tapis

- **R12 — Un pays a un centre, une frontière et un NOM.** Un bruit continu (les anciens « quartiers macro ») ne fabrique pas de lieux, il fabrique un dégradé : pas de dedans ni de dehors, pas de nom. On ne va pas « à la Tourbière » quand la tourbière est un champ scalaire. `pays.ts` : un semis de sites sur treillis jitteré, un caractère par site, un nom (« la Vieille Sylve aux Corbeaux »).
- **R13 — La maille est ABSOLUE.** 300 tuiles, pas une fraction de la carte. C'est le seul geste qui fasse payer l'échelle : une carte deux fois plus grande a **quatre fois plus de pays**, au lieu des mêmes en plus gros.
- **R14 — L'identité n'est pas une couleur de sol.** Le caractère décale l'humidité (donc la bande de biome) et l'altitude APPARENTE (le seul levier au-dessus de 0,55, où `bandFor` ne lit plus l'humidité — l'altitude RÉELLE n'est jamais touchée : ni le relief, ni l'eau, ni le froid, ni le rendu). Et les bosquets suivent le pays : la Vieille Sylve porte six fois plus de gros bois, le Versant Brûlé sept fois plus de cendres. Ce qui change la végétation change la vitesse sous les pieds, le couvert, la température, **les lieux qui peuvent y naître** (la table des POI est indexée par biome) et le gibier qui y vit.

### Les sentiers — la carte se lit

- **R15 — On ne dessine pas des routes, on trace ce que les gens ont emprunté.** Un Dijkstra part du point de départ et rejoint ce qui structure : les gués, les lieux chargés, les gisements. Le coût est l'inverse de la vitesse, **plus le prix de la pente** — un vrai sentier évite de grimper (sans quoi tous les chemins monotones coûtent pareil en 4-connexité, et le réseau devient un plan de ville).
- **R16 — Le sentier trouve le gué TOUT SEUL.** Le fleuve n'étant franchissable qu'aux gués, tout chemin d'une rive à l'autre y passe nécessairement. On ne code rien pour ça. Et comme le sentier VIENT DE LOIN, il ne marque pas la porte : il y **mène**. (Un chemin peint seulement au franchissement serait un auto-but : on ne trouverait le panneau qu'une fois déjà arrivé.)
- **R17 — On franchit un ruisseau, on ne ponte pas un fleuve.** La route se pose dans une eau basse — et elle le doit (un Sanctuaire mesuré siège au fond d'une gorge où l'on n'accède qu'en remontant le torrent) — mais jamais dans le fleuve. La distinction se lit sur le terrain : le fleuve a un cœur d'eau PROFONDE, un ruisseau n'en a pas.
- **R18 — Le sentier s'arrête au seuil.** On ne pave pas un lieu, on y mène.

### Le relief doit être RENDABLE

- **R19 — `/sim` doit au client un champ d'élévation qui ne replie pas l'image.** Le client soulève chaque tuile de `elevation × RELIEF_H` ; si le sol descend vers le sud plus vite que `TILE_PX / RELIEF_H`, l'image se replie et le client **lève une exception** (écran blanc, pas artefact). Le garde-fou vivait côté client : le mauvais côté de la frontière. Il vit désormais dans `/sim`, qui produit le champ, et il est testé sur la vraie carte.

---

## Critères d'acceptation

Tous dans `worldgen.test.ts`, **à 1200×1800 et sur 5 seeds**.

| # | Critère | |
|---|---|---|
| **A1** | Chaque type de lieu a des tuiles éligibles sur la vraie carte — aucune ligne morte dans la table. | ✅ |
| **A2** | TOUT lieu est atteignable à pied depuis le point de départ. | ✅ |
| **A3** | Le point de départ appartient au monde. | ✅ |
| **A4** | Au moins 99 % du marchable est d'un seul tenant. | ✅ |
| **A5** | Tout lieu à `reserve` existe sur CHAQUE carte. | ✅ |
| **A6** | Toute zone-POI a au moins une tuile marchable dans son empreinte. | ✅ |
| **A7** | L'anneau de bordure reste intégralement bloquant après toutes les passes. | ✅ |
| **A8** | **Gués rebouchés, la vallée se SCINDE** : la seconde rive pèse ≥ 20 % du marchable, et il y a ≥ 4 gués. *(Mesuré sur 12 seeds : 29,6 % à 48,4 %.)* | ✅ |
| **A9** | Le bruit est **exact au bit près** : témoins figés (`noise.test.ts`). Un échec n'est pas un test à mettre à jour — c'est la carte de tous les joueurs et tous les replays qui vient de changer. | ✅ |
| **A10** | **Un sentier mène à CHAQUE gué et à CHAQUE lieu chargé.** | ✅ |
| **A11** | **Le relief ne REPLIE pas le rendu** (le client refuserait de démarrer). | ✅ |
| **A12** | La densité de lieux suit la SURFACE (×1 → 71, ×2 → 138, ×4 → 265). | ✅ |

---

## Décisions en attente (directeur de jeu)

### 1. LES 24 % DE CARTE-MUR — la question la plus lourde de l'audit

`TERRAINS` déclare `rock`, `snow` et `glacier` en `walkable: false`. Ensemble : **24 % de la carte**. Le plafond du marchable est donc l'altitude **0,73** : tout le haut de la montagne est un décor peint.

Que la ROCHE et la GLACE soient des murs se défend. Mais la **NEIGE** ?

Deux indices disent que ce n'était pas l'intention :
- `TEMPERATURE.BIOME_OFFSET` inflige **−10 sur la neige** et **−15 sur le glacier** — des malus pour qui *s'y tient*. Or on ne peut **jamais** s'y tenir : **ces deux lignes sont du code mort**, et toute la conception « le froid, prix de la verticalité » de la spec température (2026-07-08) est inerte au-dessus de 0,73.
- Le **Champ de crevasses** était éligible au seul biome `GLACIER` — un lieu qu'aucun joueur ne pouvait approcher.

**Rendre la neige praticable — lente, mortellement froide — ouvrirait le tiers haut de la vallée** et donnerait enfin un objet à la jauge Température. C'est exactement « en allant un peu plus loin ». Mais ça change la forme du monde jouable, la difficulté de la nuit, et la portée des hordes. **Je ne la prends pas.**

La table est en revanche rendue **compatible avec les deux réponses** : le Champ de crevasses garde `GLACIER` et `SNOW` dans ses biomes tout en gagnant le haut pierrier — le jour où la neige devient praticable, il remonte de lui-même vers la vraie marge du glacier, sans qu'on retouche une ligne.

### 2. LA RÉCOMPENSE DE L'ÉLOIGNEMENT EST ARITHMÉTIQUEMENT MORTE

Le GDD §8bis promet trois cercles : autour du départ la récolte est médiocre, la richesse est au loin. Le code le met en œuvre par `circleFactor` (economy.ts), qui multiplie le **stock d'un nœud**. Deux chiffres l'annulent :

- **`WILD_RADIUS = 70 tuiles`** — le rayon au-delà duquel un nœud devient « riche ». Sur une carte de 1200×1800, soixante-dix tuiles, c'est **le pas de la porte**. Tout ce qui est à plus de 70 tuiles du foyer est également riche : il n'y a pas de gradient, il y a une marche, et elle est franchie dès la première sortie.
- **`CARRY.CAPACITY = 30` et `ITEM_WEIGHT.wood = 1`** — un sac plein fait trente bois, **où qu'on soit**. Multiplier le stock d'un nœud lointain par 3,6 ne change donc **rien** à ce qu'on rapporte : on repart avec trente bois, comme au coin du feu.

**Conséquence directe sur ce chantier** : toute structure qui coûte un DÉTOUR (un fleuve à contourner, un col à trouver) fait payer le joueur sans jamais le rembourser. C'est la raison pour laquelle **les murs percés de cols n'ont pas été construits** (voir ci-dessous).

Les leviers existent et ne sont pas les miens : élargir `WILD_RADIUS` à l'échelle de la vraie carte ; faire porter la richesse sur le **rendement par coup** ou la **valeur** plutôt que sur le stock ; ou lier le portage à la distance (une charge lourde qu'on ne ramène pas de loin sans y penser).

### 3. LES MURS PERCÉS DE COLS — construits ? Non, et voici pourquoi

Le chantier initial prévoyait des crêtes intérieures percées de cols. Un panel de conception (cinq propositions, quinze juges adversariaux, mesures faites contre le vrai code) l'a démoli sur trois points que je n'avais pas vus :

- **La porte est introuvable au sol.** La caméra montre **35×20 tuiles** (`VISIBLE_TILES_TALL = 20`). Une crête de 68 tuiles de large percée d'un col de 23 fait quinze écrans de long : on heurte le mur en un point quelconque et on le longe à l'aveugle sur 75 à 150 tuiles.
- **Le pathfinding tombe.** `findPath` est un A* 4-connexe borné à `maxExplored = 4096` — un rayon utile de ~45 tuiles. Un détour de plusieurs centaines de tuiles le fait échouer.
- **Le joueur paie le mur et ne touche pas la récompense** (cf. point 2).

**Ce qui a été construit à la place** : le FLEUVE (qui sépare vraiment, se voit de loin — l'eau est lisible à 20 tuiles — et se franchit à sept endroits), et les SENTIERS (qui mènent aux gués, donc qui signalent les portes). La topologie est là ; elle est simplement portée par de l'eau plutôt que par de la roche.

Si les cols doivent revenir, il leur faut d'abord : un pathfinding qui tienne le détour, une récompense qui le paie, et un signalement au sol.

---

## Hors périmètre (et où ça revient)

- **Le sol autour d'un lieu** (éboulis d'une mine, gravats d'une ruine) — le client a déjà des sprites pour les 26 types ; il ne manque que le tapis sous leurs pieds. Cosmétique. → chantier ambiance.
- **Le rythme du semis** (des grappes de lieux et des vides) — essayé, retiré : il fait passer au rouge la garde de neutralité spatiale, et à juste titre (un regroupement volontaire est, pour elle, le même signal qu'un bug). Il reviendra quand il aura son propre critère.
- **Le banc `pnpm scenario`** tourne encore sur l'ANCIENNE carte (`generateValley`, 192×192, avec des routes) — une géométrie que le joueur ne voit plus. Tout l'équilibrage distance/faim/portage se calibre donc sur un monde qui n'existe pas. Le porter demande de placer des villages PNJ procéduralement.
- **Les villages PNJ et les Réfugiés** → chantier 3 du monde.
- **La brume irradiée** (le seul mécanisme qui fait CHANGER la carte en cours de saison) → chantier 2.
- **Le rendu chunké (SP2)** — la carte pleine taille (2400×3600) coûte ~41 s de génération.
