# La génération du monde — un RÉSEAU DE ZONES, pas un tapis

> **⚑ AMENDÉE le 2026-07-17 — LA CARTE EST PLATE (pivot RimWorld).** Décision d'Alexis : « annule tout le rendu 3D, on part sur un rendu/feeling à la RimWorld ». **Toute la verticalité de cette spec est retirée** : plus de paliers, plus de terrasses, plus de falaises-en-hauteur, plus de rampes-dénivelé, plus de gouffre/crevasse. Ce qui SURVIT, et qui est l'ossature réelle du monde : le **graphe de 12 zones** (§3), les **seuils comme SEULS passages** (devenus des goulots PLATS), le **contenu par zone** (§6), le **front de cendre** (§7), et la **distinction visuelle des zones par la couleur du sol** (`zone-ambiance.ts`). Ce qui CHANGE, concrètement : (1) une frontière entre deux zones est une **bande de ROCHE PLATE infranchissable** (`murerLesAretes`, seul critère : zones voisines) percée aux seuils — le vide devient de la roche ; (2) la garde de connexité teste la **ZONE** et non plus le palier (`carveDistanceToMain` → `zoneIdAt`), ce qui **préserve A5 à l'identique** (A8-A10 deviennent triviaux, sans hauteur) ; (3) le **froid vient du BIOME** (neige/glacier), plus de l'altitude — Névé et Glacier restent des gates froides. Toute mention ci-dessous de « palier », « terrasse », « contremarche », « rendu en marches », « §2ter/R40-R44 (élévation intrazone) » est **caduque** — lire cette spec en gardant la STRUCTURE (zones, seuils, contenu, cendre) et en ignorant la HAUTEUR. Le spike 3D + élévation est archivé sur `spike/rendu-3d-vallee`. Voir `docs/decisions.md` (2026-07-17).

> *Le titre disait « un ARBRE de zones » — la forme initialement demandée. Il a été corrigé le 2026-07-14 : exiger qu'aucune zone ne soit un goulot d'étranglement (R11bis) rend l'arbre **mathématiquement impossible**, puisqu'un arbre a toujours des points d'articulation. Le monde est un réseau à boucles. On ne laisse pas un titre mentir sur ce qu'il décrit.*

*Source : brainstorm de direction du 2026-07-14 (Alexis), GDD §8bis (les trois cercles), §9 (carte), §13 (roadmap). Statut : **structure implémentée et jouée** (2026-07-14 — graphe, terrasses, seuils, contenu, cendre, ambiance, rendu en marches ; gardes vertes sur la taille de production, A26 retirée avec les buttes — voir R37). **Restent non implémentés** : le brouillard de guerre (R19-R20), les seuils qui s'annoncent (R21), les gardiens par zone (§9 — faune/monstres lisent encore le terrain, pas la zone), le froid létal (§9), et le Névé Blanc. *(R2 — la paroi dessinée avec son ombre portée — est tenue depuis le 2026-07-14 : `cliff-art.ts` / `cliff-layer.ts`. Le §2bis du même jour la requalifie : arête FINE et marches décalées — la bande de 44 tuiles et l'auto-raccord 3-familles sont à remplacer.)* *La carte est structurée ; elle n'est pas encore DÉFENDUE.* Remplace intégralement la spec worldgen du 2026-07-14 (« la vallée qui pousse à l'exploration »), dont les leçons — et seulement les leçons — sont reportées ici.*

---

## 1. Le renversement

L'ancienne vallée dérivait sa **structure de son terrain** : un champ d'altitude (fonction de la distance au bord de carte), puis des biomes peints par bandes, puis des lieux posés dessus. Un champ concentrique n'a ni pièce, ni porte, ni fond. On marchait tout droit de n'importe où vers n'importe où ; deux seeds ne différaient que par leur papier peint ; et le grief le plus grave était arithmétique — *aller loin ne rapportait rien*, puisqu'un sac fait 30 bois où qu'on soit.

On inverse :

> **On génère d'abord un GRAPHE DE ZONES. Le terrain en découle.**

La carte n'est plus une texture qu'on lit, c'est un **plan qu'on gravit**. Chaque zone est une pièce ; chaque seuil est une porte ; chaque palier de ressource est une clé. Le modèle de référence est Valheim, et il est explicite : *la progression n'est pas un niveau de personnage, c'est une géographie.*

### Les quatre principes du directeur de jeu (2026-07-14)

1. **EXPLORATION** — le décor, les lieux et le gameplay poussent à naviguer. On montre au joueur qu'une ressource *existe* (un filon dérisoire, épuisé en une heure) pour lui dire : *elle est ailleurs, et en quantité.*
2. **STRUCTURÉ** — la carte se découvre au rythme des moyens du joueur. Les zones avancées sont gardées par des **gates naturelles organiques**, thématiques. La carte est un mur d'escalade pour qui veut grimper.
3. **LISIBLE** — d'un coup d'œil **à l'écran** (35×20 tuiles), on sait si la zone est facile ou mortelle. Par ce qu'on y voit : la faune, le sol, l'absence de nourriture. **Jamais par une UI qui explique.**
4. **FANTASTIQUE** — cadre alpin (cols, rivières, névés), mais les Cendreux existent : les biomes ont le droit d'être *inexplicables*.

---

## 2. Le socle physique — TERRASSES, FALAISES, RAMPES

*Décision d'Alexis, 2026-07-14. Elle abroge le faux-relief du client.*

Le client soulevait chaque tuile de `elevation × RELIEF_H` pour simuler du relief. C'était illisible (quelques pixels), fragile (une seed sur quatre repliait l'image et faisait planter le jeu — d'où `assertNoFold`), et cher. La question « faut-il passer en 3D ? » a été posée et **tranchée : non** — l'art du projet *est du code* (zéro asset, tout est procédural) ; passer en 3D échangerait un système qui marche contre une dette d'art infinie.

- **R1 — L'altitude est un ENTIER, pas un flottant.** Un **palier** (0, 1, 2, 3…). Le champ continu disparaît de la surface du jeu ; il ne subsiste que comme outil interne de génération.
- **R2 — Entre deux paliers, une FALAISE.** Une tuile bloquante, dessinée comme une paroi, avec son ombre portée. Une falaise ne se replie pas : c'est un mur. **`assertNoFold` et tout le warp de relief sont supprimés.**
- **R3 — On ne monte QUE par une RAMPE.** Aucune tuile marchable n'est adjacente à une tuile marchable d'un autre palier, sauf sur une rampe. Une rampe relie **deux paliers consécutifs**, jamais deux d'un coup.
- **R4 — Les rampes sont RARES, et c'est le geste qui fabrique toute la structure.** Une ligne de falaise devient le squelette de la carte. Et — la découverte centrale de ce chantier — **on ne trouve pas une porte : on suit un mur.** Une falaise a un *bord* ; on la longe, on tombe sur la brèche. C'est ce qui rachète l'objection qui avait tué les cols (« la porte est introuvable au sol ») : les anciens murs étaient des bandes de roche amorphes de 60 tuiles, sans bord lisible.
- **R5 — L'eau profonde est un mur, sans exception.** On ne nage pas. C'est le matériau de falaise *horizontale* : il fait des seuils là où la roche ne peut pas.
- **R6 — Des outils de grimpe pourront ouvrir des falaises en lategame** (décision d'Alexis : *« on ne se ferme pas la porte »*). Le modèle le supporte par construction — une falaise franchissable est une rampe conditionnelle. **Hors périmètre de cette spec** ; aucune règle ci-dessous ne doit rendre la chose impossible.

---

## 2bis. LA FORME EST RECTILIGNE, LA HAUTEUR EST DES MARCHES

*Décision d'Alexis, 2026-07-14 (après la première carte à graphe rendue : « le rendu et la forme de la map ne me conviennent pas »). Deux arbitrages pris dans la foulée : l'arête est FINE, les marches sont DÉCALÉES. Consignée dans `docs/decisions.md`.*

La direction artistique passe aux **angles droits** — pour la **CARTE** (zones, frontières, seuils, taches de terrain). *L'ART des sprites, lui, N'EST PAS retravaillé (décision d'Alexis, 2026-07-14, en cours de chantier) : le rectiligne est la grammaire du MONDE, pas celle des icônes.* Et le relief cesse de se suggérer : il se **compte**, une marche par palier entier. Ce n'est pas qu'un choix de goût : chaque forme organique de la carte était fabriquée par du bruit (domain warp des frontières, blobs fbm du relief, méandres des seuils), et chaque source de bruit était une source de fragilité — c'est le bruit qu'il a fallu borner (`WARP_AMP × 2.5 / SCALE < 1`), réparer (`murerLesSautsOrphelins`), flouter (`boxBlur`). Le rectiligne supprime la maladie au lieu de soigner les symptômes.

- **R32 — TOUTE forme de carte est rectiligne.** Zones, frontières, falaises, seuils, eau, taches de terrain : des rectangles et des polygones à angles droits (axis-aligned). La variété vient de la partition, des proportions et des paliers — jamais des courbes. Le domain warp des frontières et les blobs de bruit sont **abrogés** ; le bruit ne survit que **quantifié au bloc** (une tache de terrain est un pavage de rectangles, pas une éclaboussure).
- **R33 — La falaise est une ARÊTE FINE.** La bande de `TERRAIN_CLIFF` de 44 tuiles disparaît : **le bord du plateau EST la frontière**. Mise en œuvre dans le paradigme tuile : une **ligne de falaise d'une tuile** sur l'arête entre paliers — ce qui réalise « Δpalier ≠ 0 = mur » sans toucher ni à la collision, ni à la connexité, ni au pathfinder (l'arête reste une tuile `walkable: false`). R4 (« on suit un mur ») en sort renforcé : une arête droite se longe encore mieux qu'une bande amorphe. Le seuil cesse d'être une gorge de 44 tuiles : c'est un **escalier court**, chokepoint assumé — sa longueur R10.4 se paie désormais en marches, pas en mètres.
- **R34 — Le rendu est en MARCHES DÉCALÉES.** `screenY = worldY × TILE − palier × STEP_PX`, avec `palier` ENTIER et constant par plateau — un dénivelé de N paliers = N marches empilées. La face du dénivelé se dessine **par occlusion**, dans le langage de la berge (`shore-cliff.ts`, promu de prototype à norme : arête claire, corps sombre, ombre portée au pied). Le repli d'image est **impossible par construction** (le lift est constant par plateau) : `assertNoFold`, le warp bilinéaire et `maxSouthGradient` restent morts, définitivement.
- **R35 — L'eau est un palier plus bas, avec de l'eau au fond.** Même langage de marche que la roche : la berge est une face d'occlusion, la surface d'eau vit en contrebas. Le canal de dé-cisaillement du shader d'eau meurt avec le warp.
- **R36 — Le palier entier est une donnée de PREMIER ORDRE de `WorldMap`** (`palier[]` + `palierMax`), consommée telle quelle par le rendu, la collision et les gardes. L'élévation flottante `[0,1]` ne survit que comme **dérivée** (température, filtres de lieux) et pour l'ancien générateur (`valleygen`).

- **R37 — TOUTE la falaise est aux FRONTIÈRES. Une zone est une terrasse PLATE.** *(Décision d'Alexis, 2026-07-14 : « tu peux retirer les falaises à l'intérieur d'une zone, on gérera l'élévation intrazone plus tard. »)* Les **buttes** — des mesas d'un palier plus haut, semées dans chaque zone — sont retirées. Il n'y a plus un seul mur à l'intérieur d'un pays.

  **Ce que ça coûte, et il faut le dire :** la garde **A26** (« depuis n'importe où, une paroi est à moins de quatre écrans ») n'était tenue QUE par les buttes — une zone fait six cents tuiles de côté, sa première frontière est à huit écrans. C'est précisément le grief qui les avait fait naître (*« il n'y a aucune falaise alors que c'était prévu — wtf ? »*). **La garde est donc RETIRÉE, pas contournée** : on ne garde pas un critère que le design ne vise plus, il ne mesurerait rien. Elle **reviendra avec l'élévation intrazone**, et c'est elle qui dira si celle-ci suffit. Le critère d'abord, le système ensuite.

**Critères recalibrés par ce changement** : la densité de falaise (garde « 4-22 % du total ») tombe avec la ligne fine — mesurée à **~3 %**, bornée à 1,5-12 %, et le marchable passe au-dessus de 80 % (treize points de carte rendus au jeu). A9/A10 (on ne monte que par une rampe, jamais deux paliers d'un coup) et A5 (le test destructif des seuils) sont inchangés et **non négociables** — c'est A5 qui a révélé que le tunnel d'accès des lieux perçait les frontières dès qu'elles n'ont plus fait qu'une tuile (voir `carveDistanceToMain` : *une protection qui repose sur une épaisseur n'est pas une protection, c'est une chance*).

- **R38 — DEUX ZONES VOISINES N'ONT JAMAIS LE MÊME PALIER.** Le palier n'est plus tiré par zone : le graphe est **colorié** (`colorerLesPaliers`). Sans cette règle, deux zones voisines pouvaient sortir au même palier, et leur frontière devenait un mur **sans hauteur** — une ligne de roche d'une tuile sur un sol plat. Sur la carte rendue, ça ne ressemblait pas à une falaise : ça ressemblait à une **clôture**, et son seuil à un trou dans un grillage. Une frontière sans dénivelé ne franchit rien (R8) et ne monte nulle part (R34). Fourchettes : racine = 0, T1 ∈ {1,2,3}, T2 ∈ {4,5,6} — elles ne se chevauchent pas, donc le coloriage n'a de conflits à résoudre qu'à l'intérieur d'un tier.

---

## 3. Le graphe — 12 zones, 14 à 16 seuils, aucun goulot

### La zone

- **R7 — Une zone est un THÈME, pas forcément un biome.** Elle peut mêler des terrains (une vieille forêt a des clairières et un ruisseau) tant qu'elle se **reconnaît en trois secondes** : une palette, une faune, un silence. C'est la lisibilité (principe 3), et c'est ce que l'ancien modèle des « pays » ne pouvait pas donner — un pays n'était qu'un *biais d'humidité* fondu sur 60 tuiles dans son voisin. **`pays.ts` disparaît.**
- **R8 — Une zone a un PALIER (T0/T1/T2), un NOM, une frontière FRANCHE.** On *franchit* une frontière de zone ; on ne s'y fond pas.
- **R9 — Une zone donne ce que les autres ne donnent pas — mais la règle porte sur la ressource STRUCTURANTE, pas sur toutes.** La ressource qui *définit* une zone (le gros bois pour la Sylve, la tourbe pour la Tourbière, les composants pour les Ruines) n'existe **nulle part ailleurs** — à l'exception du teaser (R12). C'est ce qui remplace la récompense de distance, qui était morte : *loin* ne veut pas dire « plus », ça veut dire « **le seul endroit où ça existe** ».

  En revanche, une ressource **de liaison** peut être partagée par deux zones (décision d'Alexis, 2026-07-14) : le **charbon** naît au Karst *et* au Versant Brûlé. Ce n'est pas un relâchement, c'est une couture : deux zones qu'un même besoin relie donnent au joueur un **choix de route** — j'ai besoin de charbon, je peux aller chercher le noir ou aller chercher les Cendreux. Le partage se **déclare** dans la table (`structurante: false`) ; il ne se subit pas.

### Les 12 zones

**T0 — LA RACINE**

| Zone | Thème | Elle donne | Elle est gardée par |
|---|---|---|---|
| **Les Prés Bas** | Fond de vallée : prés, bosquets, ruisseaux, lumière. | Tout le T0 en abondance (bois, pierre, fibre, baies, gibier). + le **teaser**. | **Rien.** On y meurt de faim, pas de crocs. *(Voir §7 : ça ne dure pas.)* |

**T1 — LA CEINTURE** — chacune donne un T1 exclusif et enseigne une leçon différente.

| Zone | Thème | Elle donne | Elle est gardée par |
|---|---|---|---|
| **La Vieille Sylve** | Futaie ancienne, canopée fermée, pénombre à midi. | **Gros bois** — la charpente, les grands bâtiments. | Hardes de sangliers, meutes de loups. *(faune existante)* |
| **Le Karst** | Cirque calcaire criblé de grottes et de gouffres. | **Fer** et **charbon**, en abondance. | Le **noir** (rien ne se voit sans feu) ; des Cendreux qui y dorment. |
| **La Tourbière** | Marais, brume, eau noire, sol qui aspire. | **Tourbe** (combustible), plantes, os. | Le **terrain** — on y court à demi-vitesse : *on ne fuit pas un marais.* Les Cendreux s'y lèvent la nuit. |
| **Les Hauts Alpages** | Pelouse d'altitude, vent, ciel immense, **zéro arbre**. | **Pierre de taille**, herbes de montagne, bouquetins. | Le **froid** — et l'absence de bois : on ne se chauffe pas sur place. |
| **Le Versant Brûlé** | La forêt qui a brûlé. Souches noires, cendre au sol. **C'est là que ça a commencé.** | **Charbon de surface**, cendre, et du **lore**. | Les Cendreux — **de jour**. La seule zone T1 où ils ne dorment pas. |
| **La Combe aux Ruines** | Un village d'avant, effondré. Murs, caves, silence. | **Composants** *(`components` existe)*, savoir, rumeurs. | Les **zombies**. *(monstre existant)* |

**T2 — LES MARGES**

| Zone | Thème | Elle est gardée par |
|---|---|---|
| **La Cendrière** | Ciel orange, cendre qui tombe sans fin, **la nuit ne finit jamais**. Les Cendreux y sont chez eux. Le cœur fantastique. | Tout. |
| **Le Glacier** | Crevasses, glace bleue, silence. Quelque chose est pris **dans** la glace. | Le froid létal ; le sol qui s'ouvre. |
| **Les Aiguilles** | Roche nue, verticale, aigles. Rien ne pousse. | La verticalité : terrasses étroites, et le vide. |
| **Le Gouffre** | Une mine qui **traverse la montagne**. Noir total. | Le noir, et ce qui vit dedans. |
| **Le Lac Mort** | Une eau parfaitement immobile, trop claire, sans un poisson. | *(À définir — case fantastique réservée par Alexis.)* |

Le contenu T2 (matériaux, équipement) **est hors périmètre** : il se décidera quand on y sera. La carte doit simplement lui **ménager la place**.

### Les seuils

- **R10 — Un SEUIL est un LIEU, pas un mur.** C'est la réponse à la *gate molle* (décision d'Alexis : rien n'interdit jamais d'entrer ; on peut tenter et mourir). Un danger purement climatique se contournerait ; il faut que le terrain **entonne**. Quatre propriétés, toutes testables :
  1. **Il est le seul passage** (ou l'un des deux). Le terrain autour est *infranchissable* — falaise, eau profonde — pas « difficile ».
  2. **Il est hostile et thématique** : la Lisière Noire, l'Éboulis, le Passage Noyé, le Col aux Corbeaux, le Rideau de Fumée, la Route Effondrée. Le danger est celui de la zone qu'il garde : **on voit ce qui attend avant d'y être.**
  3. **Il ne nourrit rien** : ni bois, ni eau douce, ni gibier, ni pierre. On ne campe pas dans un seuil. *C'est ce qui empêche un village de tenir une porte — sans qu'aucune règle n'interdise rien.*
  4. **Il a une longueur** : assez pour qu'on ne le franchisse pas par accident ni sans préparation.
- **R11 — AU MOINS deux seuils par zone, séparés d'au moins 250 tuiles.** Sept écrans : **aucun village ne peut tenir les deux.** Le second seuil est **toujours pire** (plus long, plus froid, plus gardé) : ce n'est pas un raccourci, c'est l'alternative de celui qu'on a chassé du premier.

  *« Au moins », et pas « exactement » : « exactement deux » est mathématiquement incompatible avec un arbre — un graphe dont tous les nœuds ont degré 2 est un **anneau**. La vallée serait devenue un rond-point à douze zones.*

- **R11bis — AUCUN GOULOT D'ÉTRANGLEMENT : le graphe est 2-CONNEXE PAR LES SOMMETS.** *(Décision d'Alexis, 2026-07-14, **sur la carte rendue** : « la seed 909 force le passage par une seule zone pour accéder au T2 — il ne faut pas de goulot d'étranglement pour naviguer sur l'ensemble de la map. »)*

  **Et aucune garde ne le voyait.** R11 garantit deux **PORTES** par zone, ce qui empêche de bloquer une *porte* — mais rien n'empêchait une **ZONE ENTIÈRE** d'être le seul chemin vers tout un pan de la carte. Un village qui la tient tient tout ce qui est derrière : le grief de R11, un cran plus haut, passé au travers de toutes les mailles.

  Désormais : **retirer n'importe quelle zone laisse toutes les autres jointes.** Toute zone est atteignable par deux chemins qui ne partagent **aucune zone**. L'invariant est maintenu à chaque fermeture de frontière, jamais réparé après coup.

  **CECI ABROGE « L'ARBRE DE ZONES »** — la forme initialement demandée. Un arbre a *toujours* des points d'articulation, par définition. Le monde est un **RÉSEAU À BOUCLES**. Le prix, payé sciemment : **plus de vrai cul-de-sac** — le Glacier ne peut plus être un fond de vallée dont on ne ressort que par où l'on est entré.

  **LEÇON : une garantie LOCALE ne fait pas une garantie GLOBALE.** Deux portes par zone ne font pas une carte sans goulot. Et il a fallu **REGARDER la carte** pour le voir.
- **Le NÉVÉ BLANC n'est pas une zone : c'est un SEUIL GÉANT.** Blizzard perpétuel, visibilité de quelques tuiles, aucun bois, aucune eau liquide, aucun gibier. On ne le visite pas, on le *traverse*. Il garde le Glacier et la Cendrière.
- **Le GOUFFRE est le chemin alternatif souterrain** voulu par Alexis : une mine qui débouche de l'autre côté d'un massif, reliant deux zones autrement séparées. Gratuit en distance, payé en **noir**.

### La topologie

- **R12 — LE TEASER.** Dans la racine : **un** filon de fer, dans une grotte, dérisoire, épuisé en une heure. Il ne sert pas à s'équiper — il sert à dire : *« ça existe. Pas ici. »* Le moteur d'exploration le moins cher jamais inventé.
- **R13 — La difficulté est BIAISÉE par la distance, pas dictée par elle** (décision d'Alexis : *« go Valheim kind »*). Une zone mortelle **a le droit de toucher** une zone facile : c'est ce qui fait qu'au jour 3, derrière une gorge, on aperçoit un pays noir plein de choses qui nous tueraient. Terrifiant, et c'est le moteur.

  **Et on le rend OBLIGATOIRE, pas seulement permis : une zone T2 touche la RACINE, sur toute seed.** *(Correction de l'auteur : le critère d'origine — « une T2 adjacente à une zone de palier ≤ 1 » — est **vrai dans n'importe quel graphe connexe**, donc il ne testait rien. Le frisson n'est pas « quelque part il y a une T2 près d'une T1 » : c'est **de ton pas de porte, tu vois l'enfer**.)*
- **R14 — Mais la racine touche au moins DEUX zones T1.** Jamais un goulot unique au départ : la première décision du joueur doit être un *choix*.
- **R15 — La maille est ABSOLUE, pas fractionnaire.** Leçon reportée de l'ancienne spec, et elle a coûté cher : une carte deux fois plus grande doit avoir *quatre fois plus* de contenu, pas le même en plus gros. Toute longueur de cette spec est en **tuiles**.

---

## 4. Le dimensionnement — un seul bouton

*Décision d'Alexis : « partons sur 50 joueurs, mais je dois pouvoir piloter ça facilement ».*

- **R16 — `JOUEURS_CIBLE` est LE bouton.** La surface de la racine s'en déduit (elle doit porter ~1 village pour 3 joueurs, espacés d'au moins 130 tuiles), et la taille de la carte se déduit de la racine. On ne règle jamais la carte à la main.
- À 50 joueurs : **1291 × 1937 = 2,5 M de tuiles**, douze cellules de ~430×484, 13 à 16 seuils. Soit **l'ordre de grandeur de la carte actuelle (1200×1800)**. *La carte « cible » de 2400×3600 était surdimensionnée d'un facteur quatre.*
- **R16bis — La racine est aussi grosse que la GÉOMÉTRIE l'autorise, jamais plus.** Elle pèse **21 à 23 %** de la carte (agrandie le 2026-07-14 sur retour d'Alexis *sur la carte rendue* — alors que le calcul disait qu'elle suffisait déjà à 17,8 %. **L'œil tranche contre le tableur.**)

  Mais son poids est **dégressif, pas fixe** — et c'est une garantie de survie, pas une coquetterie. À poids fixe, **7 seeds sur 60 ne généraient PAS DU TOUT** : la racine gonflée écrasait une voisine au point qu'il ne lui restait plus deux frontières, donc plus deux portes. On essaie donc le poids ambitieux, puis on le réduit jusqu'à ce que la carte tienne (à poids nul, c'est un Voronoï ordinaire : il tient toujours, donc la génération termine).

---

## 5. Le peuplement et la découverte

- **R17 — On ne dit JAMAIS non au joueur.** Aucune règle n'interdit de fonder un village où que ce soit. **La distribution des ressources EST la règle de peuplement** : personne ne s'installe dans le Névé parce qu'il n'y a ni bois ni eau liquide pour y bâtir quoi que ce soit. Zéro code de restriction, zéro frustration.
- **R18 — Le spawn est ÉPARPILLÉ dans la racine** (décision d'Alexis : *« pour éviter la guerre au lancement »*). N points de départ, tous marchables, tous distants les uns des autres.
- **R19 — La carte se découvre EN MARCHANT.** Brouillard de guerre. **Ceci abroge la règle précédente du projet** (« on cache les lieux, jamais le terrain »). C'est ce qui rend R4 vital : sans falaises qu'on longe, une carte brouillardée n'est qu'un désert où l'on erre.
- **R20 — Le brouillard appartient au JOUEUR, et se partage dans le VILLAGE** (décision d'Alexis). Le savoir géographique devient un **bien** : il se troque, il se vend, il se trahit. C'est exactement le carburant de l'alignement émergent.
- **R21 — Le seuil s'ANNONCE.** Avant la Gorge : des os, des carcasses rongées, des arbres morts. Avant le Névé : la végétation meurt, le sol blanchit. Du décor, gratuit, et c'est du Dark Souls — **le monde prévient, il ne guide pas.** C'est la mise en œuvre du principe 3 sans une ligne d'UI.

---

## 6. La connexité — les leçons qu'on garde

*Reportées de l'ancienne spec. Elles ont été payées cher ; elles ne se rediscutent pas.*

- **R22 — « Marchable » n'est pas « atteignable ».** `connectivity.ts` reste l'outil : composantes du marchable, et le monde = la plus grande.
- **R23 — 4-connexité.** C'est le modèle du pathfinder (A* 4 directions) ET de la collision (deux bloquants en diagonale ne laissent qu'un coin de largeur nulle). Compter les diagonales fabriquerait des passages que personne ne peut emprunter.
- **R24 — Un lieu n'a pas besoin d'un sol, il a besoin d'un SEUIL.** La connexité entre dans l'**éligibilité** d'un lieu, jamais dans un rattrapage qui creuserait un tunnel.
- **R25 — On ne teste pas qu'une carte est belle, on teste qu'elle se JOUE — à la taille de production, sur beaucoup de seeds.** Le journal du projet porte cinq mécaniques mortes trouvées *en pilotant le jeu*, invisibles en test headless, toutes pour la même raison : *les tests posaient leurs propres petites cartes.* Le coût est réel ; il s'assume. **Et on la REGARDE aussi** : c'est en voyant la carte rendue qu'Alexis a jugé la racine trop petite, contre un calcul qui la disait suffisante.
- **R26 — Une saison = une carte = une seed, pendant des semaines** (décision d'Alexis). **Une seed ratée gâche un serveur entier.** Il ne faut donc pas une garantie « en moyenne » : il faut une garantie **par construction**. Un seul échec sur une seule seed est un échec.
- **R26bis — UNE GARDE SUR DOUZE SEEDS NE MESURE PAS UN TAUX D'ÉCHEC DE 12 %.** Payé cher, le 2026-07-14 : la génération levait une exception sur **7 seeds sur 60**, et les **douze** seeds de garde passaient toutes au vert. Elles avaient eu de la chance, littéralement. **Ce qui protège un serveur, ce n'est pas la PROFONDEUR des vérifications sur quelques cartes — c'est le NOMBRE de cartes.** Le balayage large (≥ 60 seeds) est une garde permanente. Il coûte ~25 s ; il s'assume, il ne se rogne pas.

---

## 7. LE MONDE AVANCE — la Cendrière est le FRONT, et la saison est une vallée qu'on perd

*Décision d'Alexis, 2026-07-14 : « on a une zone T2 à côté de la zone de départ — est-ce qu'on n'en ferait pas notre zone de propagation de la difficulté ? Comme on pousse les joueurs à migrer au fur et à mesure vers des zones plus haut niveau. »*

C'est le chaînon qui manquait, et il fait tenir ensemble trois choses qui flottaient chacune de leur côté.

- **R27 — LA CENDRIÈRE EST LA T2 DU PAS DE LA PORTE** (garde A25), et **elle avance**.

  **Ceci requalifie R13.** La T2 voisine de la racine était un *frisson* (« de chez toi, tu vois l'enfer »). Elle devient un **moteur** : *l'enfer que tu vois est celui qui viendra te chercher.* Ce n'est plus une curiosité, c'est un **compte à rebours planté dans ton jardin**.

  **Et les trois actes du GDD trouvent enfin un LIEU.** Le troisième s'appelle déjà « Cendre » — mais ce n'était qu'un *multiplicateur de faim*, un nombre qui monte. La saison cesse d'être un compteur qui durcit : elle devient **une vallée qu'on perd**.

- **R28 — La migration n'est pas une consigne, c'est une FUITE.** Personne ne dit au joueur de monter : **le sol brûle derrière lui**. Les zones T1 cessent d'être des expéditions et deviennent des **refuges** — donc on s'y installe, donc les villages bougent, donc la carte se rejoue en cours de saison. Et la difficulté se *voit venir* (un front se longe, se mesure), ce qui sert le principe 3 sans une ligne d'UI.

- **R29 — La cendre mange ~60 % des Prés Bas** en fin de saison *(décision d'Alexis)*. Les villages du sud doivent partir ; ceux du nord tiennent. **La vallée rétrécit sans disparaître** — et il reste toujours un endroit où naître.

- **R30 — LE SPAWN SUIT LE FRONT** *(décision d'Alexis)*. On naît toujours dans la part **vivante** des Prés Bas, la plus loin du feu. Sans quoi, celui qui rejoint le serveur au jour 40 naîtrait dans la cendre — il ne jouerait pas au même jeu que les autres. Et ça raconte quelque chose : *les nouveaux arrivent par la bouche de la vallée, en fuyant déjà.*

- **R31 — On ne MUTE pas la carte : on stocke UN SEUL NOMBRE.** L'avancée du front vit dans le `SimState` comme un scalaire, et l'appartenance d'une tuile s'en **dérive**. L'état reste petit, JSON-sérialisable et déterministe ; les replays tiennent ; le client peint la cendre à partir du même nombre. *C'est ce qui rend le mécanisme bon marché — et c'est ce qui a emporté la décision.*

**Le coût, payé sciemment :** l'identité de la T2 voisine de la racine n'est plus tirée au sort. On perd un peu de rejouabilité ; on gagne une **cosmologie stable** — le monde a un centre, et il est en train de brûler.

**Reste à trancher quand on y sera :** abandonner un village bâti (les structures sont immobiles) est magnifique pour le ton du jeu et **brutal** pour qui le subit. Ça devra être **lent et annoncé**, sinon c'est de la frustration pure.

**À CONSTRUIRE — chantier suivant.** La carte est déjà conçue pour l'accueillir : `zone[]` et `palier[]` sont dérivés, jamais figés.

---

## 8. Ce qui MEURT

| Ce qui saute | Pourquoi |
|---|---|
| **`pays.ts`** (426 l.) | Un biais d'humidité fondu sur 60 tuiles ne fabrique pas une zone lisible. Remplacé par le graphe de zones. |
| **`alpine-hydro.ts`** (858 l.) | Arbre de drainage global, fleuve traversant, rives, gués. Le fleuve devient un **décor local** (décision d'Alexis) : la topologie est désormais portée par les falaises. |
| **`alpinegen.ts` — `computeRelief`** | Le champ d'altitude concentrique : c'est *exactement* le renversement (§1). |
| **`assertNoFold`, `warp.ts`, le lift `RELIEF_H`** (client) | Le faux-3D est abrogé (R2). Toute une classe de crashs disparaît avec. |
| **`circleFactor` / `WILD_RADIUS`** (`economy.ts`) | La récompense de distance par multiplication de stock : **arithmétiquement morte** (sac plafonné à 30). Remplacée par R9 (*loin = le seul endroit où ça existe*). |
| **`combegen.ts`** (prototype non commité) | Il tâtonnait le bon renversement avec le mauvais outil (un champ dérivé d'un squelette). Les terrasses le rendent inutile. |

---

## 9. Les autres systèmes — ce qu'il faut y toucher

*Le worldgen ne peut livrer que le TERRAIN et l'ÉTIQUETTE (« cette tuile est dans la zone Z, palier T »). Les gardiens vivent ailleurs. Touches autorisées par Alexis, chacune à consigner dans `docs/decisions.md`.*

| Système | Ce qui change | Pourquoi |
|---|---|---|
| **`economy.ts`** | Suppression de `circleFactor`/`WILD_RADIUS`. Les nœuds sont distribués **par zone**. | R9. |
| **`temperature.ts`** | **Le froid TUE** — dégâts sur la durée sous un seuil (décision d'Alexis). Aujourd'hui il ne fait que ralentir : on traverserait le Névé en boitant, et on s'en ficherait. | Sans ça, Alpages / Névé / Glacier ne sont pas des gates. |
| **`balance.ts` — `TERRAINS`** | **La neige devient praticable** (lente, mortellement froide). Elle est `walkable: false` aujourd'hui : 24 % de la carte est un mur peint, et le malus de froid sur la neige est du **code mort**. | Sans ça, le Névé est impossible. |
| **`faune.ts` / `monsters.ts`** | Les tables de spawn s'indexent sur la **zone**, plus seulement sur le terrain. | R7, R10. |
| **Client** | Marches décalées (`palier × STEP_PX`, faces d'occlusion façon berge) à la place du lift continu ; art rectiligne (items, lieux, décor). Douze palettes de zone. Brouillard de guerre. | R2, R7, R19, R32-R35. |

**Séquençage recommandé (invariant n°7 : `/sim` d'abord, headless, testé) :** la carte se livre et se valide en gris, avec les gardiens **qui existent déjà** (loups, sangliers, zombies, Cendreux, le froid, le terrain lent). Les gardiens exotiques — le noir des grottes, le blizzard qui aveugle, la cendre qui tombe, la glace qui cède — viennent **ensuite, un par un**. Sinon on ne livre rien avant trois mois.

---

## 10. Critères d'acceptation

**Tous à la taille de production, sur ≥ 12 seeds** (R25/R26 : une seed ratée = un serveur ratée). Un seul échec est un échec.

### Le graphe

| # | Critère |
|---|---|
| **A1** | Sur toute seed : **exactement 12 zones**, chacune d'aire ≥ son minimum, chacune nommée, chacune d'un palier. |
| **A2** | **Toute zone est atteignable à pied** depuis tout point de spawn (composante marchable unique, R22). |
| **A3** | La racine touche **≥ 2 zones de palier 1** (R14). |
| **A4** | Toute zone a **≥ 2 seuils**, deux à deux distants d'**≥ 250 tuiles** (R11). |
| **A5** | **Le seuil est une VRAIE porte — test destructif** : on bouche TOUS les seuils d'une zone, la zone devient une **composante isolée**. *(C'est le seul test qui prouve qu'une gate en est une : l'ancienne carte perdait 0,2 % du marchable quand on bouchait ses onze « verrous ».)* |
| **A6** | Une zone T2 est **adjacente à la RACINE**, sur toute seed (R13 — le frisson de Valheim, rendu obligatoire). |
| **A21** | **AUCUN GOULOT** : on retire n'importe quelle zone (comme si un village la tenait), les onze autres restent jointes (R11bis). *Le graphe est 2-connexe par les sommets.* |
| **A7** | **Le Gouffre relie vraiment** : bouché, les deux zones qu'il joint ne sont plus reliées que par leurs seuils de surface. |
| **A8** | Deux seeds donnent **deux graphes différents** (positions et adjacences) — la rejouabilité inter-saisons est un critère dur, pas un espoir. |

### Le terrain

| # | Critère |
|---|---|
| **A9** | **On ne monte que par une rampe** : aucune paire de tuiles marchables 4-adjacentes n'a un écart de palier ≠ 0 hors rampe (R3). |
| **A10** | Aucune rampe ne saute **deux paliers** (R3). |
| **A11** | Toute falaise et toute eau profonde sont **bloquantes** ; l'anneau de bordure reste intégralement bloquant après toutes les passes. |
| **A12** | Le bruit et la génération sont **exacts au bit près** : même seed = même carte. Un échec n'est pas un test à mettre à jour — c'est la carte de tous les joueurs et de tous les replays qui vient de changer. |
| **A13** | La génération coûte **< 15 s** à la taille de production. |

### Le contenu

| # | Critère |
|---|---|
| **A14** | **Toute ressource STRUCTURANTE n'existe QUE dans sa zone** — le gros bois seulement dans la Sylve, la tourbe seulement dans la Tourbière. Une ressource **de liaison** (`structurante: false` — le charbon) est autorisée dans exactement les zones que la table déclare, et dans aucune autre (R9). |
| **A15** | **Le teaser existe et est dérisoire** : exactement 1 filon de fer dans la racine, de stock plafonné (R12). |
| **A16** | **Un seuil ne nourrit rien** : 0 nœud de récolte, 0 eau douce, 0 gibier dans son emprise (R10.3). *C'est ce qui rend un village impossible dans une porte, sans l'interdire.* |
| **A17** | **La racine porte les villages** : ≥ `JOUEURS_CIBLE / 3` emplacements viables (bois + pierre + eau + place), espacés d'≥ 130 tuiles (R16). |
| **A18** | **Le spawn est éparpillé** : N points de départ dans la racine, tous marchables, tous mutuellement distants (R18). |
| **A19** | **La table des zones ne ment pas** : tout type de lieu, de nœud et d'espèce déclaré dans une zone y trouve des tuiles éligibles, sur toute seed (R24 — trois lignes de la table étaient mortes dans l'ancienne carte). |
| **A20** | **La carte grandit avec `JOUEURS_CIBLE`** : doubler le bouton double la surface habitable de la racine et le nombre d'emplacements (R15/R16). |

---

## 11. Hors périmètre

- **Le contenu T2** (matériaux, équipement, bâtiments) — décidé quand on y sera. La carte lui ménage la place.
- **Le Lac Mort** — case fantastique réservée par Alexis.
- **Les outils de grimpe** (R6) — lategame ; le modèle les supporte, rien ne doit les rendre impossibles.
- **L'extension de la Cendrière** (R27) — chantier suivant ; la carte doit pouvoir changer de palier en cours de saison.
- **Les gardiens exotiques** — le noir, le blizzard, la cendre, la glace qui cède. Après la carte.
- **Les villages PNJ et les Réfugiés.**
- **Le banc `pnpm scenario`**, qui tourne encore sur une géométrie que le joueur ne verra plus.
