# t0-exploration — la Racine donne envie de marcher

*Source : mandat d'Alexis du 2026-07-25 (« monte une équipe pour traiter l'ensemble des points détectés — que du prod ») sur l'analyse indépendante de la zone T0 du même jour. Références externes étudiées : Valheim (repères/biomes), Don't Starve (set-pieces, top-down sans horizon), Rust (routes comme colonne vertébrale sociale), V Rising (gradient de corruption visible). Statut : **implémentée le 2026-07-25** — A1-A9 en tests headless (`t0-exploration.test.ts` + gardes existantes), A10 au scénario smoke `t0` (captures regardées). Notes d'implémentation : la lueur nocturne de R16 est COUVERTE par la braise du front existante (`cendre-layer`) — pas de FX doublon ; le plafond des Pierres levées suit la surface (`capFor`) ; les 9 menhirs du Cercle sont un décor client dérivé du rect. Jalon : calibrage Veillée / GATE 1.*

---

## Objectif de design

Le diagnostic, mesuré sur la seed du jeu (2026) : les Prés Bas font 1424×560 tuiles dont **80,5 % d'herbe nue**, 38 lieux de **7 espèces seulement** (empreintes de 2-4 tuiles : des timbres, pas des endroits), une seule silhouette qui perce la canopée (le Grand Chêne), une eau invisible depuis presque partout, et aucune anisotropie — le nord-ouest ressemble au sud-est. L'ossature du monde (zones, seuils, rareté géographique, front de cendre) est bonne ; **la chair du premier quart d'heure ne l'est pas**.

> **Le principe unique de cette spec : à chaque écran (35×20 tuiles), le joueur voit une raison de marcher vers l'écran suivant.**

Cinq gestes, qui attaquent le même défaut par cinq angles : des repères qui percent l'horizon (§1), une rivière colonne vertébrale (§2), des endroits à grande empreinte (§3), un sud qui annonce le feu (§4), et les traces du pays d'avant (§5). Tout est rectiligne (worldgen R32), tout est plat (pivot RimWorld), rien n'interdit jamais rien au joueur (worldgen R17) : **le monde prévient, il ne guide pas** (worldgen R21).

---

## §1 — Les repères d'horizon : le ciel comme boussole

Le mécanisme existe déjà et il est bon : un lieu se voit à `POI.SIGHT_TILES`, entre dans la carte quand on l'aperçoit, donne sa charge quand on l'atteint (`poi-discovery.ts`), et sa `crown` perce la couche des houppiers (`poi-layer.ts`). Le Grand Chêne prouve la boucle — mais il est **seul dans 614 000 tuiles**. On généralise le langage, sans le diluer.

- **R1 — La Racine porte AU MOINS QUATRE repères qui percent la canopée.** Le Grand Chêne (existant), **la Tour de guet effondrée** (unique — le pays d'avant regardait déjà le sud), **les Pierres levées** (2-3 menhirs solitaires), et la couronne du **Cercle de pierres** (§3). Chacun a une `crown` haute : on le voit venir à plusieurs écrans.
- **R2 — Les charges suivent les devises de `lieux.md`, sans en inventer.** La Tour de guet est un *savoir* à rayon (le Belvédère de la plaine : on grimpe aux décombres, on voit) — rayon entre celui du Chêne et celui du Belvédère. La Pierre levée est un *savoir* au plus proche **parmi les pierres** (`pierre_levee`, `cercle_pierres`) : *les pierres se répondent* — une chaîne de menhirs qui mène au Cercle. Le Cercle est un *récit* (une ligne de chronique, comme le Sanctuaire).
- **R3 — Jamais deux repères dans le même écran.** L'espacement du semis (96 tuiles) y pourvoit ; les lieux réservés le respectent aussi (`placeReserveAnywhere` le vérifie déjà). Un horizon qui appelle partout n'appelle nulle part.
- **R4 — Les seuils de la Racine S'ANNONCENT (mise en œuvre de worldgen R21).** Chaque bouche de seuil porte **deux BORNES de pierre dressées** — du décor client, dérivé de `map.seuils` (nouveau champ, voir §6), planté aux deux flancs de la porte, assez haut pour percer la canopée. On ne cherche plus la porte en longeant le grillage : **on la voit de loin, on marche vers elle.** Les bornes d'un seuil de secours sont brisées (l'autre passage se mérite). Aucune règle de jeu : du décor, gratuit, à la Dark Souls.

## §2 — La rivière : une colonne vertébrale, pas un archipel

L'eau de la Racine (worldgen R45) est aujourd'hui un archipel timide tenu **loin des frontières** : 13 lacs rectangulaires reliés de chenaux d'1-3 tuiles, et la « rivière » n'est que la plus longue liaison du graphe. Depuis le spawn, la première eau est à 146 tuiles et rien ne la signale. On promeut UNE rivière en trait structurant.

- **R5 — LA rivière TRAVERSE la Racine du nord au sud.** Elle naît au pied d'une frontière de la ceinture (l'eau descend des hauteurs), enfile 1 à 3 lacs, et meurt à la frontière de la Cendrière : **l'eau descend vers le feu**, et le joueur qui la suit apprend la géographie de la saison. Tracé Manhattan quantifié au motif (R32), comme tout le reste.
- **R6 — Le lit est un haut-fond large, le CŒUR est profond.** Demi-largeur 3 (7 tuiles) de `shallow_water`, cœur `deep_water` de demi-largeur 1 (3 tuiles). L'invariant de worldgen R45 (« jamais d'eau profonde sans anneau de haut-fond ») tient par construction. La rivière fait donc une **vraie frontière interne** — rive gauche, rive droite — sans jamais enclaver personne.
- **R7 — Les GUÉS sont les portes de la rivière.** Là où une sente (§5) croise la rivière, le cœur profond s'interrompt : haut-fond pleine largeur, on traverse en ralentissant. **Au moins deux gués garantis** — s'il en manque, on en force aux tiers du cours. Chaque gué porte un toponyme (« le Gué », sans `kind` : un nom qu'on foule, pas une pastille).
- **R8 — La rivière ne casse aucune promesse existante.** Elle se pose AVANT les seuils (un seuil qui la croise rouvre son couloir — la porte gagne, ordre des passes inchangé) ; les gardes A2/A5 de worldgen restent vertes ; la faune y gagne ses coins de chasse par la règle existante (`nearWater`) — la rivière devient un chapelet de rencontres sans une ligne de code faune.

## §3 — Les set-pieces : des ENDROITS, pas des timbres

Un « Verger sauvage » de 3×3 tuiles ne peut pas produire d'émotion : on n'entre jamais *dedans*. Don't Starve le fait depuis dix ans : quelques morceaux de bravoure par carte, grands, nommés, qui ne ressemblent qu'à eux-mêmes.

- **R9 — La Racine porte TROIS set-pieces à grande empreinte, un de chaque, nommés :**
  - **le Bois Noir** (~48×40) : une mini-sylve — sol `old_growth`, futaie dense, sombre, clairières comprises. Il murmure ce que la Vieille Sylve promet.
  - **le Cercle de pierres** (~24×24) : une couronne de pierres levées sur la fleuraie. Il est la destination de la chaîne des menhirs (R2), et sa couronne se voit de loin (R1).
  - **la Combe brumeuse** (~40×32) : un creux de marais et de roselière autour d'une mare, noyé d'une brume au sol (client). Champignons et fibre y abondent — par les règles EXISTANTES d'admission de terrain, pas par une table neuve.
- **R10 — Un set-piece est un LIEU, pas un sprite.** Il a un `kind`, un nom, il se découvre et entre dans la carte (mécanisme `lieux.md` intact) — mais son corps est son TERRAIN : `PoiLayer` n'y pose pas d'image-centre (étiquette seule), et il est **exclu de `poiClearings`** (on ne « dégage » pas un endroit dont le contenu est la raison d'être — même exclusion que gisement/carrière). Techniquement, les trois kinds entrent dans `POI_TYPES` **hors semis** (`biomes: []`, jamais éligibles au tirage — ils se posent en passe dédiée du worldgen) : la garde A19 (« chaque type naît vraiment ») les couvre alors gratuitement, et `poiFamily` sait répondre pour le garde-fou des charges. Le semis de Poisson, lui, **écarte tout point à moins d'un espacement d'un lieu déjà enregistré** — la garde d'espacement minimal reste vraie avec des lieux posés hors semis.
- **R11 — Le Bois Noir porte un TEASER, patron du Filon.** UN `old_tree` unique, stock dérisoire (`TEASER_STOCK`) : *« le gros bois existe. Pas ici. »* Même grammaire que le fer — le joueur qui a compris le Filon comprend le Bois Noir sans un mot.
- **R12 — Placement au cœur.** Comme les lacs : marge aux frontières (l'eau et les seuils vivent aux bords), jamais sur l'eau ni un seuil, écartés entre eux d'au moins 200 tuiles. Tirage par rejet, salé, positionnel.

## §4 — Le sud brûle à vue : l'enfer au pas de la porte

La décision fondatrice dit : la T2 collée à la Racine existe « *pour qu'on VOIE l'enfer depuis son pas de porte* ». Aujourd'hui le sud du pré est le même vert que le nord jusqu'à la dernière tuile, puis une ligne grise d'une tuile. C'est la seule frontière qui AVANCE (le front de cendre la franchira au jour 1) — elle a droit à un traitement que les autres n'ont pas.

- **R13 — Une bande de GRADIENT le long de la frontière Cendrière, ~40 tuiles.** Herbe → lande (`heath`) → lisière calcinée (`burnt_forest`), décidée par MOTIF (8 tuiles) avec un dithering positionnel : des marches irrégulières de blocs, jamais une ligne droite. Les terrains existent déjà — aucun id nouveau.
- **R14 — Le gradient ne change AUCUNE règle.** Les nœuds suivent les admissions existantes (le calciné admet l'arbre : du bois noirci se coupe ; la lande admet baies et fibre). Les emplacements de village suivent les règles existantes. La garde A17 reste verte — c'est un critère, pas un espoir.
- **R15 — L'exception est ASSUMÉE et bornée.** Une frontière qui déteint sur sa voisine contredit « une zone = un thème » (worldgen R7) — on le fait quand même, UNIQUEMENT ici, parce que cette frontière-là est la menace de la saison : c'est worldgen R21 appliqué à la plus grande porte du jeu. Aucune autre frontière ne déteint.
- **R16 — Client : la lisière porte ses signes.** Arbres morts sur le calciné (le clutter du `burnt_forest` existe), cendres dans l'air de la bande (FX quantifié, mémoire projet : jamais de halo lissé), et la nuit, une lueur rouge basse sur l'horizon sud depuis la bande. *(La lueur est un SOUHAIT, pas un critère : si elle se paie en promotion d'éclairage dynamique, elle attend — décision consignée le cas échéant.)*

## §5 — Les traces du pays d'avant : sentes et ruines

Le pré est vierge comme un terrain de sport, alors que le lore dit l'inverse : une vallée qu'on PERD. Quelqu'un vivait là. Rust le montre : une route, même muette, est une promesse (« ça mène quelque part ») et un lieu social. Le terrain `road` existe déjà dans la table (id 2, ×1,25) — inutilisé sur la carte zonée.

- **R17 — Des SENTES relient les seuils de la Racine.** Terrain `road` existant, 3 tuiles de large, polylignes Manhattan : chaque seuil de la Racine est relié au réseau (topologie en étoile passant près du cœur de la zone). Elles contournent l'eau profonde des lacs, traversent la rivière **aux gués** (R7 — c'est le croisement qui CRÉE le gué), s'arrêtent à la bouche des seuils. Elles accélèrent (×1,25, la valeur de la table) : la route est un choix — plus rapide, plus exposée (Rust le dit : la route fabrique les rencontres, et c'est la feature).
- **R18 — Rien ne pousse sur une sente, et rien ne s'y adosse.** Comme un seuil (rampe) : aucune tuile `road` ne porte de nœud. Et **aucun lieu ne naît à cheval sur une sente** (l'empreinte d'un candidat du semis ne doit contenir aucune tuile `road`) — un verger coupé en deux par la route perdrait ses baies, et un lieu se poste AU BORD du chemin, pas dessus.
- **R19 — Les ruines basses du pays d'avant.** Deux lieux `shelter` nouveaux, réservés à la Racine : **la Ferme ruinée** (cap 2 — des murs bas effondrés, un pignon debout à `crown` modeste) et **la Charrette abandonnée** (cap 3 — une épave au bord d'une sente si possible, sinon dans le pré). Abri au sens des shelters existants, **aucun butin** (lieux.md A9). Avec la Tour de guet (R1), le pré raconte : on vivait ici, on guettait le sud, on est partis.

## §6 — Les données : ce que le client doit savoir

- **R20 — `WorldMap.seuils` : les seuils deviennent une donnée de premier ordre.** `{ x, y, ax, ay, secours, vers }[]` (position, axe de traversée, drapeau secours, nom de la zone de destination) — additif, JSON-sérialisable, rempli par `generateZonedTerrain`. Consommateurs : les bornes (R4), l'onglet carte (les portes peuvent se dessiner), et demain les toponymes de seuil qui cesseront d'être devinés par leur nom.
- **R21 — Les gués et set-pieces s'enregistrent dans `map.zones`.** Les set-pieces avec `kind` (des lieux) ; les gués en toponymes sans `kind` (des noms). Le `poiId` reste l'index : tout s'ajoute EN FIN de tableau, jamais au milieu.

---

## Critères d'acceptation

Sur la seed du jeu (2026) **et** les seeds de garde maison (7, 42 — celles de `zonegen.test.ts`) :

- **A1** — La Racine porte exactement : 1 Grand Chêne, 1 Tour de guet, 2-3 Pierres levées, 1 Cercle de pierres, 1 Bois Noir, 1 Combe brumeuse, ≥ 1 Ferme ruinée, ≥ 1 Charrette. Tous les lieux à `crown` de la Racine sont deux à deux écartés d'au moins 90 tuiles.
- **A2** — LA RIVIÈRE TRAVERSE : il existe un chemin 4-connexe de tuiles d'eau (`shallow`/`deep`) contiguës dont une extrémité est à ≤ 12 tuiles de la frontière NORD de la Racine et l'autre à ≤ 12 tuiles de la frontière SUD (Cendrière). Son cœur profond est partout ceint de haut-fond (échantillon exhaustif : toute tuile `deep` de la rivière a ses 8 voisins en eau ou haut-fond, jamais en terre sèche adjacente).
- **A3** — AU MOINS DEUX GUÉS : ≥ 2 interruptions du cœur profond de ≥ 4 tuiles de long, chacune franchissable à pied (chemin marchable est↔ouest à travers la rivière au droit du gué).
- **A4** — LES GARDES DE WORLDGEN RESTENT VERTES : A2 (toute zone atteignable), A5 (seuils bouchés → île), A17 (≥ 17 emplacements de village aux Prés Bas). Ce sont les tests existants, relancés tels quels.
- **A5** — LE GRADIENT EST LOCAL : dans la bande [0, 40] tuiles de la frontière Cendrière (côté Racine), la part de `heath`+`burnt_forest` est ≥ 50 % ; au-delà de 70 tuiles, ≤ 5 %. Le dithering est réel : dans la bande [10, 30], aucune ligne de 32 tuiles d'un seul tenant du même terrain perpendiculaire au gradient.
- **A6** — LES SENTES RELIENT : depuis la bouche de chaque seuil de la Racine, en ne foulant QUE des tuiles `road` ou d'eau peu profonde, on atteint la bouche d'au moins un autre seuil (parcours BFS headless).
- **A7** — RIEN NE POUSSE LÀ OÙ ÇA ROULE : aucun nœud sur une tuile `road` ni `rampe`. Le Bois Noir contient ≥ 60 nœuds `tree` et **exactement 1** `old_tree` au stock `TEASER_STOCK`. La Combe contient ≥ 10 `champignon`.
- **A8** — LES CHARGES PAYENT : fouler la Tour de guet révèle tous les lieux du rayon (et aucun au-delà) ; fouler une Pierre levée révèle la pierre/cercle inconnue la plus proche et rien d'autre ; la première arrivée au Cercle écrit une ligne de chronique ; aucun des nouveaux lieux n'ajoute d'item à l'inventaire (lieux.md A9 étendu).
- **A9** — DÉTERMINISME : deux générations de la même seed rendent des cartes identiques au bit près (terrain, zones, seuils, nœuds) ; les contrats replay/events existants restent verts. Les nouveaux semis sont positionnels et salés (aucun tirage sur le PRNG partagé).
- **A10** — LES BORNES SE VOIENT (client, smoke) : à chaque bouche de seuil de la Racine, deux sprites de borne présents, percant la couche des houppiers ; bornes brisées sur un seuil de secours.

## Constantes (ordres de grandeur — calibrage en jouant)

Dans les modules worldgen (patron `EAU`/`CONTENU`), pas en dur :

| Constante | Valeur initiale | Note |
|---|---|---|
| `RIVIERE.DEMI_LARGEUR` | 3 | 7 tuiles de lit |
| `RIVIERE.DEMI_CŒUR` | 1 | 3 tuiles de profond |
| `SENTES.GUES_MIN` | 2 | forcés sur le cours (fractions étalées) si les croisements n'ont pas payé — le bouton vit avec les sentes, c'est le croisement qui crée le gué |
| `GRADIENT_SUD.LARGEUR` | 40 | tuiles depuis la frontière Cendrière |
| `SENTES.DEMI_LARGEUR` | 1 | 3 tuiles de large (le motif arrondit) |
| `SET_PIECES.ECART_MIN` | 200 | entre deux set-pieces |
| `POI.REVEAL_TOUR_TILES` | 240 | entre le Chêne (180) et le Belvédère (300) — mesurés dans `balance.ts` |

## Hors périmètre (et où ça revient)

- Le brouillard de guerre du TERRAIN (worldgen R19-R20) — chantier à part entière.
- Des rivières hors de la Racine (l'eau reste le marqueur de la zone basse — R45).
- Un effet des sentes sur les trajets des PNJ ou de la faune.
- La généralisation du gradient à d'autres frontières (R15 : exception unique, assumée).
- La DA cubique des nouveaux lieux : ils naissent PEINTS (le pilote cubique `poi-lit.ts` attend l'arbitrage d'Alexis sur l'erratique) — la bascule se fera avec tous les autres.
