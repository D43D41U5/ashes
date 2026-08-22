# La pêche — lancer, attendre, ferrer

*Source : GDD l.402 (« ferrage à la pêche » — le geste ; les deux interdits : pas de collecte automatique, pas de barre de progression passive), l.455 (Poisson, T2, « La rivière » → nourriture, conserves), l.687 (branche **Chasse/pêche**, P1 « pêche à la ligne »). Huit décisions d'Alexis prises en session le 2026-08-21/22, consignées dans `decisions.md`. Specs voisines : `recolte-maitrise.md` (le contrat D1 : le défi vit dans la sim, le client le dessine), `recolte-vivante.md` (nœuds, dérive), `eau-vivante.md` R14 (les poissons-ombres, décor jusqu'ici), `gel.md` (l'eau qui prend), `flore-froid.md` (les vers gélifs).*

*Statut (2026-08-22) : **en construction** — `/sim` d'abord, headless, testé ; le client ensuite.*

## Objectif de design

Le poisson est la ressource de la rivière : de la nourriture qui se mérite par un **réflexe**, pas par un martèlement. La pêche met le joueur **sur l'eau** — aux coudes de la rivière, au bord du profond des lacs —, donc sur les routes, et l'hiver la referme par le bas : la rivière prend, le lac reste ouvert en dernier. Elle branche trois choses qui existaient sans se parler : les poissons-ombres (décor), les vers des tas de feuilles (un appât sans usage), et le Feu (qui cuit).

## Les huit décisions (Alexis, 2026-08-21/22)

- **D1 — Un poisson est un NŒUD, pas une entité.** Le « coin de pêche » est un `ResourceNode` sur une tuile d'eau : stock, repousse, dérive. Les poissons-ombres restent un rendu client qui **se rassemble autour du coin** et déserte le coin vide. Aucun poisson ne nage dans `/sim`.
- **D2 — Le geste : lancer → attente → touche → fenêtre de ferrage.** Deux inputs (`harvest_charge_start` / `harvest_release`), une attente tirée au PRNG d'état, une touche signalée par événement, une fenêtre de quelques ticks pour ferrer. Pas de jauge.
- **D3 — Où : la rivière aux coudes, les lacs contre leur cœur profond.** Ni ruisseaux, ni mares, ni marais ; le Lac Mort exclu (lore) ; **Racine seule** — les eaux des autres zones attendent leur contenu T2 (`worldgen.md` l.117). Le joueur se tient où il veut à portée du nœud (berge ou gué).
- **D4 — Canne de fortune obligatoire ; appât optionnel qui presse la touche.** `crude_rod` (bois + corde, sans poste, 20 ferrages). Pas de pêche à mains nues. Un `worms` au sac est consommé **au lancer** et raccourcit l'attente ; sans appât la ligne part quand même, la touche traîne. **Une touche = UN poisson**, l'outil n'y change rien — le coin de pêche ignore `TOOL_YIELD`, par construction.
- **D5 — Trois espèces, rareté par l'EAU et par la FENÊTRE.** Goujon (partout, commun, fenêtre large), truite (rivière, fenêtre moyenne), brochet (lac, fenêtre courte — il se débat). L'espèce se tire à la touche parmi celles de l'eau du nœud ; la touche ne dit pas ce qui mord, le ferrage réussi révèle.
- **D6 — Compétence `hunting`** (la branche Chasse/pêche du GDD), XP par prise via `gainXp` (pénalité de dispersion comprise) ; effet : la fenêtre s'élargit de `FISHING.WINDOW_PER_LEVEL` par niveau, plafonnée. Rien d'autre.
- **D7 — Une tuile prise ne se pêche pas.** Le lancer est refusé quand le coin est gelé. Le stock se régénère sous la glace ; au dégel le coin rouvre plein. Pas de pêche sous glace (chantier à part).
- **D8 — Hors périmètre : le courant et les PNJ.** `map.fil` reste inerte en sim ; aucun PNJ ne pêche (c'est une corvée future).

**Promesse NON tenue, assumée** : le GDD fait du poisson une ressource de **conserves** — le sel est différé (décision 2026-07-12) et le poisson pourrit. Dans ce chantier, *la pêche ne prépare pas l'hiver, elle le traverse.* Le jour du sel/fumoir, les poissons rejoindront `COOK_SLOT.byproducts`.

## Le contrat (D1 de `recolte-maitrise.md`, tenu)

- **C1 — Le défi vit dans la sim.** L'attente et l'espèce sortent de `state.rng` au moment de l'action (lancer, touche) — rejouables au bit près par les inputs. Le client ne rapporte jamais un résultat : il envoie *« je lance »* et *« je ferre »*, la sim date les deux.
- **C2 — Arithmétique entière.** L'attente est un compte de ticks ; la fenêtre aussi. Aucune fonction Math approximée.
- **C3 — Le snapshot porte de quoi dessiner** : `Entity.fishing = { nodeId, castTick, biteAt, bait, species?, windowEnd? }`. Le client en tire le fil, le flotteur, la touche, le ferrage. `species` n'apparaît qu'à la touche (pendant la fenêtre, quelques ticks) — la sim ne trahit pas ce qui mord avant que ça morde.
- **C4 — Le raté ne rejette rien.** Relâcher avant la touche rentre la ligne, muet. Laisser passer la fenêtre : le poisson file (`fish_escaped`), la ligne rentre, on relance — l'appât est perdu, c'est son seul coût. Aucun `action_rejected` sur un raté.

## Règles

### Le coin de pêche (D1, D3)

- **P1 — Deux types de nœud**, `fishing_spot_river` et `fishing_spot_lake` (`NODE_DEFS`) : `blockHalfSub: 0` (l'eau ne bloque pas), `skill: 'hunting'`, `tool: 'rod'`, `minTool: 'crude'`, `renewable: true`, stock `FISHING.STOCK`. Un type par eau parce que **l'espèce dépend de l'eau** (D5) et qu'un nœud doit porter sa nature sans relire la carte.
- **P2 — Un coin est une tuile de HAUT-FOND qui touche le PROFOND** (4-voisinage). C'est la règle unique des deux eaux : joignable (portée 1,5 t — le centre d'un cœur de rivière large de 3 ne l'est pas), et lisible (on pêche *vers* le profond). *(Le `worldgen.md` R45 dit « rivière en haut-fond pur » ; le code creuse un cœur profond de demi-largeur `RIVIERE_DEMI_COEUR` — la spec est en retard, pas le code.)*
- **P3 — Rivière : aux coudes.** Un coude = `estUnCoude(fil, k)` (l'unique définition). À chaque coude retenu, la tuile candidate (P2, à `RIVIERE_DEMI_LIT` Chebyshev du fil) de plus petit `hash2` gagne ; un coude est retenu si le précédent retenu est à ≥ `CONTENU.PECHE_ESPACEMENT_FIL` pas de fil. Le réglage vit à côté du générateur (`CONTENU`) : il se calibre en regardant une carte.
- **P4 — Lac : contre le cœur.** Tuile P2 dont le profond touché n'est PAS de la rivière (à plus de 2 t Chebyshev de tout point du fil), en Racine, hors `lac_mort` (exclu par slug de zone — la Racine n'en a pas, la garde est là pour le jour où la règle s'étendra) ; `hash2 < CONTENU.PECHE_CHANCE_LAC` et distance Chebyshev ≥ `CONTENU.PECHE_ESPACEMENT_LAC` de tout coin de lac déjà posé. Il en sort un à trois par lac selon sa taille.
- **P5 — Passe appendue en QUEUE** de `placeZoneNodes` (patron 'FIBR' : sel positionnel, aucun nœud existant ne bouge, aucun flux RNG consommé). Sel `'PECH'`.
- **P6 — Épuisement et dérive : les règles communes.** `stock 0` → `regrowAt` (`NODE_REGROW_TICKS` × facteurs) et `relocateNode` (même terrain = haut-fond, rayon 12 : le coin rouvre ailleurs dans la même eau). Rien de spécial — c'est la rotation du cercle contesté avec le mécanisme qui existe. Le client lit `stock`/`regrowAt` pour peupler ou déserter le coin.

### Le geste (D2, D4, D6, D7)

- **G1 — Lancer** (`harvest_charge_start { nodeId }` sur un coin) : refus si `strikeRejection` (rien à pêcher, trop loin, **il faut une canne en main** — `toolTier(held, 'rod')`) ou si **le coin est pris** (`estGele` sur la tuile PROFONDE voisine du coin, pas sur le gué : le gué prend avant le profond, et l'intention de D7 est « la rivière ferme avant le lac » — une tuile de gué gelée avec du profond ouvert derrière se pêche encore). Refus `'l'eau est prise'`. Puis : si le sac porte un `worms`, il est retiré (`bait: true`). L'attente est tirée : `biteAt = tick + FISHING.WAIT_BAIT_MIN..MAX` ou `WAIT_NOBAIT_MIN..MAX` (ticks, uniformes, `state.rng`). `actor.fishing = { nodeId, castTick, biteAt, bait }`. Un `harvest_charge_start` pendant une ligne tendue est muet (comme la jauge).
- **G2 — Attente** : rien ne progresse. `advanceEconomy` surveille : si l'acteur **bouge** (`entity.moved`) ou meurt, la ligne rentre (muet). Quand `tick === biteAt` : tirage de l'espèce parmi `FISH_SPECIES` de l'eau du nœud (poids entiers, `state.rng`), `windowEnd = tick + fenêtre(espèce, niveau)`, événement **`fish_bite { entityId, nodeId }`** — sans l'espèce.
- **G3 — Fenêtre** : `fenêtre = floor(species.windowTicks × min(FISHING.WINDOW_CAP, 1 + niveau × FISHING.WINDOW_PER_LEVEL))`, niveau = `skillLevel(hunting)`.
- **G4 — Ferrer** (`harvest_release`) : si `fishing` absent, muet. Si `tick < biteAt` : ligne rentrée, muet (le raté d'impatience ne coûte que l'appât déjà parti). Si `biteAt ≤ tick ≤ windowEnd` : **prise** — re-validation `strikeRejection` (G8 : le coin a pu se vider), puis `addItems(species.item, 1)` borné au sac (sac plein → `action_rejected 'sac plein'`, le poisson est perdu, la ligne rentre), `node.stock -= 1` (épuisement → règles P6), `wearHeld` (la canne s'use d'un ferrage), `gainXp(hunting, XP_PER_GATHER)`, `cooldownUntil` (`GATHER_COOLDOWN_TICKS`), événements **`fish_caught { entityId, nodeId, species, item }`** ET `resource_harvested` (le flux commun : chronique, tableau, retour de frappe). `fishing` effacé.
- **G5 — Le poisson file** : en `advanceEconomy`, si `tick > windowEnd` et toujours `fishing` : événement **`fish_escaped { entityId, nodeId }`**, `fishing` effacé, la ligne rentre. Relancer consomme un nouvel appât (C4).
- **G6 — `TOOL_YIELD` ne s'applique pas** (D4) : la prise ne passe pas par `harvestStrike` — elle a son chemin (`landFish`), qui réutilise `wearHeld`, `gainXp`, l'épuisement/dérive via une fonction extraite (`depleteNode`) pour ne rien dupliquer.
- **G7 — La canne** : `crude_rod` dans `ItemId`, `RECIPES` (`wood 1, rope 1`, `requiert: null`, 4 s), `TOOL_DURABILITIES` 20. Famille d'outil `'rod'` dans `TOOL_TIERS` — une famille à une marche (`crude` ; `basic/iron/steel` pointent sur le même objet tant qu'il n'existe qu'une canne : `toolTier` rend `crude`, et le jour d'une canne d'atelier on remplit la marche).
- **G8 — Les espèces** : `FISH_SPECIES` (`balance.ts`) — `{ id, item, water: 'river' | 'lake' | 'both', weight, windowTicks, label }` ; items crus `gudgeon`, `trout`, `pike` et cuits `cooked_gudgeon`, `cooked_trout`, `cooked_pike` ; `FOOD_VALUES`, `SPOIL_CYCLES`, `COOK_SLOT.fire` (cru → cuit), `SPOIL` si la table l'exige. Valeurs : ordres de grandeur (goujon cuit ≈ la moitié de la viande cuite, truite ≈ la viande cuite, brochet ≈ le ragoût), à calibrer en jouant.

### Le rendu (client — après la sim)

- **R1 — Le bouchon, pas la jauge.** Pendant l'attente, aucune barre : un **flotteur** posé sur l'eau à la tuile du coin, animé (clapot), relié à la canne par un **fil à physique** (corde de Verlet côté client, quelques segments, gravité + tension — 100 % rendu, zéro sim).
- **R2 — Le lancer** : à `fishing` apparaissant dans le snapshot, l'avatar tend la canne ; le flotteur part en arc depuis la pointe de la canne vers le coin (trajectoire paramétrée sur l'horloge Phaser, `castTick` donne l'origine), le fil se déroule derrière.
- **R3 — La touche** : sur `fish_bite`, le flotteur **plonge** (une plongée franche, pas une oscillation), anneaux sur l'eau, un son sec. C'est le telegraph — il doit se lire en un dixième de seconde.
- **R4 — Le ferrage** : sur `fish_caught`, la canne se **cambre**, le fil se tend en ligne droite, le poisson sort en arc vers l'avatar (sprite de l'espèce), gerbe à l'opposé de l'acteur ; sur `fish_escaped`, le flotteur remonte mollement, le fil détend, la ligne rentre.
- **R5 — Les ombres suivent les coins** : `poissons-ombres.ts` lit les nœuds `fishing_spot_*` ; les naissances se font dans un rayon autour des coins à `stock > 0`, aucune ailleurs. Le coin vide est une eau vide.
- **R6 — Le HUD** : `hunting` dans `SKILL_LABELS`, la fiche de personnage ; `crude_rod` et les six poissons dans les sprites d'inventaire ; `FAMILLE_DE_NOEUD` (exhaustif) reçoit les deux coins.

## Critères d'acceptation (testables, headless)

| # | Critère |
|---|---|
| **A1** | **Les coins existent et sont JOIGNABLES** : sur les seeds de garde, ≥ 1 `fishing_spot_river` et ≥ 1 `fishing_spot_lake` ; chacun sur du haut-fond touchant du profond (P2) ; aucun hors Racine ; aucun en `lac_mort`. |
| **A2** | **Le semis n'a rien déplacé** : les nœuds d'avant la passe sont identiques (id, type, position) avec et sans la passe — le patron 'FIBR' tient. |
| **A3** | **Sans canne, pas de ligne** : `harvest_charge_start` sur un coin, mains nues ou hache en main → `action_rejected` et `fishing` absent. |
| **A4** | **Le lancer consomme l'appât et tire l'attente** : avec un `worms`, le sac en perd un, `fishing.bait === true`, `biteAt − castTick ∈ [WAIT_BAIT_MIN, WAIT_BAIT_MAX]` ; sans, `bait === false` et l'attente dans la fourchette lente. |
| **A5** | **La touche est un événement, et la fenêtre suit** : à `biteAt`, un `fish_bite` exactement ; `fishing.species` posé ; `windowEnd − biteAt = fenêtre(espèce, 0)`. |
| **A6** | **Ferrer dans la fenêtre = un poisson, un seul** : `harvest_release` à `biteAt + 1` → `+1` item de l'espèce, `stock − 1`, `fish_caught` ET `resource_harvested`, XP `hunting` > 0, canne usée d'un cran. |
| **A7** | **Trop tôt = muet, trop tard = le poisson file** : release avant `biteAt` → rien (pas d'événement, `fishing` effacé, appât perdu) ; ne pas ferrer → à `windowEnd + 1` un `fish_escaped`, sac inchangé. |
| **A8** | **L'eau choisit l'espèce** : en rivière, 200 touches ne donnent jamais de brochet ; en lac, jamais de truite ; le goujon sort des deux. |
| **A9** | **La maîtrise élargit** : `fenêtre(brochet, 4) > fenêtre(brochet, 0)`, et plafonnée à `WINDOW_CAP`. |
| **A10** | **La glace ferme** : coin dont le profond voisin est gelé → lancer refusé `'l'eau est prise'` ; le stock d'un coin vidé avant le gel repousse pendant le gel. |
| **A11** | **Bouger rentre la ligne** : un pas pendant l'attente → `fishing` effacé, aucun événement. |
| **A12** | **Déterminisme** : même seed + mêmes inputs (lancers, ferrages) → mêmes prises, mêmes événements (contrat `sim.test.ts`). |
| **A13** | **Le poisson se cuit et se mange** : `cooked_*` via `COOK_SLOT.fire`, `eat` rend `FOOD_VALUES`. |
| **A14** | **Le coin dérive sur l'eau** : un coin vidé se relocalise sur du haut-fond ou reste ; jamais sur la terre. |

## Hors périmètre

- La pêche sous glace, le courant qui module l'espèce, les PNJ pêcheurs, la canne d'atelier, les conserves (sel) — chacun un chantier nommé.
- La perception de l'expert (l'ombre trahit l'espèce) — permise par la table, pas livrée.

## Nombres (ordres de grandeur, `balance.ts` → `FISHING`)

| Nom | Valeur | Pourquoi |
|---|---|---|
| `STOCK` | 6 | un coin = une sortie de pêche, pas une ferme |
| `WAIT_BAIT_MIN/MAX` | 3 s / 8 s | D4 |
| `WAIT_NOBAIT_MIN/MAX` | 8 s / 15 s | D4 |
| `WINDOW_PER_LEVEL` | 0.15 | D6 |
| `WINDOW_CAP` | 2 | D6 |
| goujon / truite / brochet `windowTicks` | 12 / 8 / 5 | D5 (600 / 400 / 250 ms) |
| poids rivière (goujon, truite) | 7 / 3 | D5 |
| poids lac (goujon, brochet) | 3 / 1 | D5 |
