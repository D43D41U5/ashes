# Les lieux — savoir, répit, récit

*Source : GDD §9 (la carte), §9bis (les événements), §8bis (garde-fous anti-corvée). Statut : **implémenté** (2026-07-11, A1-A10 verts en tests headless — A1 en outre à confirmer visuellement en jeu). Jalon : Veillée — chantier 1 du monde.*

## Objectif de design

Les 26 types de POI de la Vallée existent, sont placés, sont nommés — et **onze d'entre eux, la famille `reward`, ne font rien** : `family === 'reward'` n'est lu que par `vignette.ts`, pour choisir la couleur d'une pastille. Le squelette de l'émerveillement est creusé ; il n'a jamais reçu de charge. Cette spec lui en donne une.

Le principe qui la gouverne, et qui lève une contradiction apparente avec le GDD :

> **Le budget de surprise de BRAISES vit dans sa géographie, pas dans son calendrier.**

Le §9bis pose « **annoncés, pas surprises** » — mais il le pose des **événements**, et pour une raison précise : c'est ce qui rend l'éclaireur rentable. La règle ne dit rien des **lieux**. Un lieu se tait ; il garde son secret jusqu'à ce qu'on pose le pied dessus. Les deux canaux coexistent sans se gêner : le calendrier prévient, la géographie surprend.

Corollaire non négociable : **aucun lieu `reward` ne donne de butin.** Le butin transformerait l'émerveillement en tournée de ramassage, et tuerait le lieu à la première visite — précisément ce que le §8bis appelle une corvée. Les lieux payent dans trois devises que le jeu possède déjà et qu'aucune économie ne peut inflater : **la carte, les jauges, la chronique**.

## Règles

### Le préalable : la carte est un acquis, pas un dû (R1-R3)

- **R1 — Les lieux ne sont plus offerts.** La carte plein écran (`M`) affiche aujourd'hui **toutes** les pastilles de POI dès le tick 0 : la vallée est intégralement divulguée avant le premier pas. Désormais elle n'affiche que les lieux **connus** du joueur.
- **R2 — On cache les lieux, jamais le terrain.** Le relief, les biomes, la rivière, les routes restent visibles d'emblée : le personnage est d'ici, il connaît la *forme* de sa vallée. Ce qu'il ignore, c'est ce qu'elle *contient*. Partage volontaire — généreux sur l'orientation, avare sur le secret. (Contre-conception écartée : un brouillard de guerre classique sur le terrain, qui punirait l'orientation au lieu de récompenser la curiosité.)
- **R3 — `knownPois: number[]` sur l'entité joueur** (vide à la création). Un tableau d'`poiId`, pas un `Set` — l'état de sim reste JSON-sérialisable (invariant d'archi). **Les PNJ n'ont pas de carte** : ils n'accumulent rien et ne déclenchent aucune découverte.

### L'identité d'un lieu (R4)

- **R4 — `poiId` = l'index de la zone dans `map.zones`.** `placePois` est pur et déterministe (semis Poisson + Fisher-Yates seedé, cf. décision 2026-07-09), donc cet index est stable pour une seed donnée. Une zone sans `kind` (zone Tiled nommée) n'est pas un lieu et n'entre jamais dans `knownPois`.

### Les trois devises, et leurs trois horloges (R5)

- **R5 —** C'est le cœur du système : les devises ne diffèrent pas seulement par ce qu'elles donnent, mais par **quand elles cessent de donner**.

| Devise | Quand ça paye | Ce que ça change | Farmable ? |
|---|---|---|---|
| **Le savoir** | **Une fois** — et c'est acquis pour la saison | La **carte** | Non : on ne redécouvre pas |
| **Le répit** | **Toujours** — le lieu ne s'épuise jamais | Les **trajets** | Non : ça ne se transporte pas |
| **Le récit** | **La première fois seulement**, tous joueurs confondus | Ce qu'on **racontera** | Non : il n'y a qu'un premier |

### Le savoir — quatre lieux qui rendent la carte (R6-R8)

- **R6 — Le déclenchement est un contact, idempotent.** À chaque tick, pour chaque entité **joueur**, on collecte les zones-POI contenant sa position (toutes, pas seulement la première : deux empreintes peuvent se recouvrir). Deux effets, dans cet ordre :
  1. **Règle de base, valable pour les 26 types** : *un lieu foulé entre dans `knownPois`*. On marche sur un Gisement, il est désormais sur sa carte. C'est le socle — la marche est la source primaire du savoir, et les quatre charges de R7 ne sont qu'une **accélération** de ce socle.
  2. **Charge de savoir** (R7), si le lieu en porte une : elle révèle *d'autres* lieux, à distance.

  Rien à mémoriser d'un tick à l'autre : appliquer deux fois est un non-événement, la garde `knownPois` suffit.
- **R7 — Les quatre charges** :
  - **le Belvédère** (`belvedere`, déjà `minElev 0.75`) — révèle **tous les lieux dans `POI.REVEAL_BELVEDERE_TILES`**. Diégétique : on monte, on regarde, on voit. C'est le lieu qui fait grimper.
  - **le Cairn** (`cairn`, `cap 14` — le plus commun) — révèle **le lieu inconnu le plus proche**, toutes familles. Un jalon de sentier : les cairns se suivent et tirent de proche en proche vers l'inconnu.
  - **les Pétroglyphes** (`petroglyphes`) — révèlent **le lieu ancien inconnu le plus proche** (`POI.ANCIENT_KINDS` : `ruines`, `mine`, `sanctuaire`, `oratoire`). L'indice orienté : quelqu'un a gravé ça pour dire *« c'est par là »*.
  - **l'Arche de roche** (`arche`) — révèle **tous les abris inconnus** (`family === 'shelter'`) dans `POI.REVEAL_ARCHE_TILES`. La porte de pierre montre où l'on peut dormir de l'autre côté.
- **R8 — Déterminisme des révélations.** Distances comparées **au carré** (jamais `Math.hypot`/`sqrt` — invariant #2) ; « le plus proche » départage les égalités exactes par **`poiId` croissant**. Toute entrée dans `knownPois` émet `poi_discovered` — qu'elle vienne d'une visite ou d'une révélation à distance.

### Le répit — trois lieux qui refont les trajets (R9-R11)

Le répit n'émet aucun événement : c'est un **effet continu de terrain**, comme le `speedFactor`. On y revient autant qu'on veut, c'est le but.

- **R9 — la Source chaude** (`source_chaude`) : une **bulle de chaleur permanente, dans la nature**. `temperature.ts` a déjà `fireBubble()` (linéaire, `FIRE_WARMTH` au contact → 0 à `FIRE_RANGE`) ; on la généralise en **`naturalWarmth(state, x, y)`**, de même loi, paramétrée par `POI.HOTSPRING_WARMTH` / `POI.HOTSPRING_RANGE_TILES`, et `ambientTemperature` prend le `max` des deux. **C'est un feu qu'on n'a pas allumé** : sur une carte où le Grand Froid mord, un feu gratuit à mi-pente réécrit tous les itinéraires.
- **R10 — la Grotte** (`grotte`) : abri. `isSheltered()` ne connaît aujourd'hui que les toits de structures ; il reconnaît désormais aussi l'empreinte d'une Grotte. Un endroit où passer la nuit loin de chez soi.
- **R11 — le Tarn** (`tarn`) : halte. Sur son empreinte, la régénération d'endurance est multipliée par `POI.TARN_STAMINA_FACTOR`.

### Le récit — quatre lieux qui entrent dans la chronique (R12-R13)

- **R12 — `visitedPois: number[]` dans le `SimState`** (global, pas par joueur). La **première** entrée d'un **joueur** sur l'empreinte d'un lieu — n'importe lequel, toutes familles — émet `poi_first_visit { poiId, kind, byEntityId }` et inscrit le `poiId`. Il n'y a qu'un premier : en multi, c'est une course.
- **R13 — La chronique ne formate que les quatre.** `chronicleFromEvents` (fonction pure, déjà en place depuis V0 pour exactement cela) écrit une ligne datée pour le **Sanctuaire** (`cap 2`, quasi unique), l'**Arbre remarquable**, le **Bloc erratique** et la **Cascade**. Les autres `poi_first_visit` traversent le bus sans produire de ligne — le flux reste complet, c'est le formateur qui choisit. On n'instrumente jamais la logique après coup.

### Le protocole (R14)

- **R14 — Le client ne reçoit que la carte de SON joueur.** `ReadyMessage` porte `knownPois` initial (vide en Veillée, non-vide sur reprise de partie) ; ensuite l'événement `poi_discovered` **est** le delta — aucun besoin de diffuser le tableau à chaque snapshot. Cohérent avec la décision d'*interest management* du 2026-07-09 : ce qui est par-joueur vit sur le fil, filtré.

## Critères d'acceptation

- **A1** — Au tick 0, `knownPois` est vide et la carte plein écran n'affiche **aucune** pastille de lieu. Le terrain, lui, est entier (biomes, relief, routes).
- **A2** — **La règle de base** : un joueur qui traverse un Gisement (famille `eco`, aucune charge) l'ajoute à `knownPois` et émet un `poi_discovered` — la marche seule suffit à connaître. Le retraverser n'émet rien.
- **A3** — Un joueur qui atteint un Belvédère découvre tous les lieux dans le rayon (et **aucun** au-delà), émet un `poi_discovered` par lieu, **une seule fois** : y revenir au tick suivant n'émet rien.
- **A4** — Un Cairn atteint révèle exactement **un** lieu, le plus proche encore inconnu ; sur deux lieux exactement équidistants, c'est celui de plus petit `poiId`. Un Cairn dont tous les voisins sont déjà connus ne révèle rien (il entre quand même dans `knownPois`, par A2).
- **A5** — Les Pétroglyphes ne révèlent qu'un lieu de `ANCIENT_KINDS` ; l'Arche ne révèle que des `shelter`.
- **A6** — Un joueur immobile sur une Source chaude, **la nuit, en Acte II, à découvert**, voit sa température monter — sans avoir rien allumé. Hors du rayon, elle rebaisse.
- **A7** — `isSheltered()` est vrai sur l'empreinte d'une Grotte, faux une tuile en dehors. L'endurance régénère plus vite sur un Tarn qu'à côté.
- **A8** — Première arrivée d'un joueur au Sanctuaire → un `poi_first_visit` → **une** ligne datée dans la chronique. Deuxième arrivée (même joueur ou autre) → rien. Un **PNJ** qui traverse le Sanctuaire → rien du tout, jamais : ni `knownPois`, ni `poi_discovered`, ni `poi_first_visit`.
- **A9** — **Aucun lieu de famille `reward` n'ajoute d'item à un inventaire.** Test explicite : après avoir visité les onze, l'inventaire du joueur est inchangé.
- **A10** — Déterminisme et replay : même seed + mêmes inputs → mêmes `knownPois`, mêmes `visitedPois`, même flux d'événements, au bit près.

## Ajouts à `balance.ts`

Un bloc `POI` : `REVEAL_BELVEDERE_TILES`, `REVEAL_ARCHE_TILES`, `HOTSPRING_WARMTH`, `HOTSPRING_RANGE_TILES`, `TARN_STAMINA_FACTOR`, `ANCIENT_KINDS`, et la **table des charges** (slug → devise + paramètres). Ce sont des ordres de grandeur, à calibrer en jeu — pas des vérités.

## Hors périmètre (et où ça revient)

- **Les rumeurs, et le marchand qui les vend.** `knownPois` est *exactement* la structure de données dont le §9bis a besoin quand il dit du marchand nomade : « vend aussi des rumeurs — le courtier en information de la vallée ». Une rumeur = **une entrée de `knownPois` qui s'achète**. Cette spec pose la fondation ; le commerce d'information est le **chantier 2** (les promesses : filon affleurant, migration, cache, brume irradiée, marchand).
- **Les villages PNJ et les Réfugiés** → **chantier 3** (les autres). C'est là que le pilier 2 (« la morale est une mécanique ») retrouve un objet en solo.
- **La maîtrise Exploration P3** (« identifie de loin », GDD §9bis) — elle lira `knownPois` ; elle n'existe pas encore.
- **Les familles `eco` / `shelter` / `danger`** gardent leur rôle actuel (gisements, monstres) : cette spec ne les recharge pas. Seule exception : `isSheltered` apprend la Grotte (R10).
- **L'ambiance visuelle des lieux** (sprites dédiés, lumière, atmosphère) — c'est le **chantier ambiance**, et c'est là, et seulement là, que la question du moteur de rendu se rejouera.
