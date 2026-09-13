# La nasse — la pêche qui travaille sans nous

*Source : reprise de l'eau **D3** (`docs/reprise-eau.md`, « les roseaux récoltables » → « à quoi sert un roseau »), quatre décisions d'Alexis prises en session le 2026-09-13 : **(1)** un roseau sert à faire une **nasse** (pêche passive) ; **(2)** la nasse est **appâtée** (elle mange de l'appât, la prise est proportionnelle à l'appât dépensé) ; **(3)** elle est **personnelle**, relevée à la main ; **(4)** c'est un **ouvrage posé** — une pièce du registre, donc qu'on peut **perdre**. Specs voisines : `peche.md` (la table de prises, la nature de l'eau, les bridages — la nasse en est une CONSOMMATRICE, elle n'invente rien), `qualite-eau.md` (la souillure, `eauSouillee`), `construction.md` (le registre `PIECES`, la pose sur l'eau), `eau-vivante.md`/`gel.md` (la crue, l'assec, le gel).*

*Statut (2026-09-13) : **SPEC — à implémenter.** Le socle est TOUT là et la nasse ne fait que le câbler : `tableDePrises`/`conditionsAt`/`natureDeLEau` (`peche-table.ts`) rendent, pour n'importe quelle tuile, ce qui mord aujourd'hui — nature de l'eau comprise, souillure comprise, crue comprise ; `eauIndisponible` (`economy.ts`) dit déjà « gelé / asséché / vase » à la tuile ; `worms` est déjà l'appât dédié (du tas de feuilles, consommé au lancer de la canne, `economy.ts`) ; la roselière donne déjà de la `fiber` (les « roseaux, sphaigne », `economy.ts:1910`) ; le registre `PIECES` porte déjà `eau:true` (pose sur l'eau, `floor`) et `acces:'private'`, et `applyStructureDamage` déverse déjà l'inventaire d'une structure détruite (`village.ts:832`). **Rien de neuf n'est à inventer côté matière : ni item `roseau`, ni nœud, ni table.** Reste à écrire : l'entrée `fish_trap` du registre, la boucle de relève cadencée (`nasse.ts`), et le geste de relève.*

## Objectif de design

Le poisson de `peche.md` se **mérite au réflexe** — c'est le geste actif, et c'est bien. La nasse est l'autre bout : **la pêche qui travaille pendant qu'on fait autre chose.** On la pose dans les hauts-fonds, on l'appâte, on s'en va ; elle prend, lentement, ce que l'eau du lieu porte ; on revient la relever. Elle donne un **but à la roselière** (les roseaux qu'on y cueille — de la `fiber` — deviennent le piège : voilà « à quoi sert un roseau »), un **puits à appât** (« où je dépense mes vers »), et une **prise que le lieu dicte** (rivière ≠ lac, sans qu'on ait à le coder deux fois). Et parce que c'est un **ouvrage** et non du matériel de poche, elle a un **enjeu** : un pillard la casse et emporte la prise ; l'eau qui gèle ou se retire la met en défaut. Une pêche passive qu'on ne pourrait pas perdre n'aurait pas de tension.

Les deux interdits du GDD (l.402) tiennent, et la nasse marche **avec** eux, pas contre : elle n'est PAS « une barre de progression passive » que le joueur regarde monter — il ne la voit pas travailler, il la **relève** ; et elle n'est PAS une collecte automatique gratuite — chaque prise a **coûté de l'appât** qu'il a fallu récolter et venir remettre.

## Ce que la nasse RÉUTILISE (et n'a donc pas à écrire)

C'est le cœur de la spec : la nasse est un **assemblage**, pas un système neuf.

- **La table de prises** — `conditionsAt(state, tx, ty, surCoin, niveauConnu)` → `tableDePrises(c)` → `tirerLigne(table, value)` (`peche-table.ts`). La nasse appelle EXACTEMENT la même chaîne que la canne. Elle hérite donc **gratuitement** :
  - de la **nature du lieu** (rivière / lac / mare — `natureDeLEau`) : une nasse en rivière et une nasse en lac ne prennent pas les mêmes espèces, sans une ligne de plus (N5) ;
  - de la **saison** et du **créneau horaire** (`phaseForDay`, `creneauAt`) ;
  - de la **souillure** (`c.souille = eauSouillee(...)`, `especeRetenue` échange la table entière, R26b) : en eau souillée, la nasse ne prend que les espèces `souillee` ; en eau claire, jamais (N9). **C'est le bridage de qualité d'eau (D1), et il est déjà écrit.**
- **Le bridage gel / assec / vase** — `natureDeLEau` rend `null` sur une eau gelée, retirée ou de marais (via `porteDeLEau`/la carte immuable). `conditionsAt` rend alors `null` : **pas de nature, pas de tirage** (N7, N8). La nasse n'a aucune garde de gel ou d'assec à écrire ; elle lit le même `null` que la canne.
- **L'appât** — `worms` existe (item), se récolte au `leaf_pile`, et est **déjà l'appât** que `castLine` consomme (`economy.ts`). La nasse consomme le même. La liste d'appâts (`NASSE.APPATS`, ci-dessous) peut s'ouvrir à d'autres items, mais `worms` en est le socle.
- **La matière** — la roselière donne déjà de la `fiber` (`economy.ts:1909-1912`, densité 0,18 ; le commentaire les nomme « roseaux, sphaigne »). La nasse coûte de la `fiber`. **Aucun item `roseau`, aucun nœud neuf** : les introduire mettrait deux produits sur une tuile et perturberait l'économie de la fibre pour zéro gain de jeu (arbitrage écarté ce jour — le sens de D3 est « pourquoi aller à la roselière », pas « faut-il un item roseau »).
- **La pose sur l'eau** — `eau:true` dans le registre → `POSABLE_SUR_EAU` → `terrainConstructible` l'autorise sur `TERRAIN_SHALLOW_WATER` seul (`construction.ts:84`, décision 2026-07-31). La nasse se pose dans les **hauts-fonds** et pêche **sa propre tuile**.
- **La propriété et la perte** — `acces:'private'` (propriété individuelle, MVP gouvernance) ; `pv` fini + `applyStructureDamage` → `spillOnGround` déverse l'inventaire d'une structure détruite (`village.ts:832`). Une nasse cassée **lâche sa prise et son appât au sol** : la tension d'ouvrage sort de mécaniques déjà là.
- **Le stockage** — `Structure.inventory?` (le patron du coffre) porte l'appât ET la prise. Le patron `fuel?` (le Foyer, la braise-mère) montre déjà un inventaire d'ENTRÉE distinct sur une structure ; la nasse le suit (une zone appât, une zone prise).

## L'entrée du registre (N1)

Une entrée de `PIECES` (`pieces.ts`), et `StructureType` en dérive — « tout en pièces, partout » :

```ts
fish_trap: {
  label: 'Nasse', fam: 'composant', pose: 'objet', occupe: 'sol', arete: 'interdite',
  sousRoche: false,
  bloque: 'non', pv: 40, cout: { fiber: 8 }, acces: 'private', eau: true, usurable: true,
},
```

- `fam:'composant'` — un ouvrage fonctionnel qui travaille dans le temps (comme le séchoir), pas une barrière du marteau.
- `pose:'objet'` — on la **dépose** comme un objet (elle est à soi), pas au marteau du bâti.
- `occupe:'sol'`, `bloque:'non'` — basse, dans l'eau ; on la patauge, elle n'emmure personne (leçon `feu-piege-centre`).
- `eau:true` — posable sur les hauts-fonds (et là seulement).
- `acces:'private'` — personnelle (décision (3)).
- `usurable:true` — une nasse d'osier vieillit.
- `cout`, `pv` : ordres de grandeur, à caler en jouant (`balance.ts`). Pas de palier de corde en v1 : la fibre est son essence, et on veut la nasse **tôt** (dès qu'on a cueilli à la roselière).

## La boucle (N3, N4, N6, N10) — `nasse.ts`

Un balayage cadencé des structures, sur le patron d'`agriculture.ts`/`braise-mere.ts` (`for (const s of state.structures)`), gardé par une cadence pour ne PAS travailler à chaque tick :

1. **Cadence.** Une nasse tente une prise tous les `NASSE.CADENCE_TICKS` (ordre de grandeur : ~¼ de cycle — plus lent que la canne active ; à caler). **Entre deux tentatives, aucune lecture de `natureDeLEau`, aucun tirage** (N6). L'ancre de la cadence est un compteur par nasse (`s.until`, le patron déjà posé par D2, `NpcTaskState.until` — ici sur la structure), pas un modulo global (deux nasses posées à des ticks différents ne battent pas ensemble).
2. **Pleine ?** Si la prise stockée atteint `NASSE.CAPACITE`, **aucune tentative, aucun appât consommé** (N10) : une nasse pleine attend qu'on la relève, elle ne gâche rien.
3. **Appâtée ?** S'il n'y a pas d'appât dans la zone d'appât, **aucune tentative** (N3) : appâtée veut dire *aucune* prise sans appât, pas *moins*.
4. **Pêchable ?** `conditionsAt(state, s.tx, s.ty, /*surCoin*/ false, niveauConnu)` — `null` (gel, assec, vase) → **aucune tentative, l'appât est PRÉSERVÉ** (N7, N8) : on ne pêche pas une eau prise, et on ne brûle pas l'appât à essayer.
5. **Tentative.** Sinon : consommer **1 appât** (N4 — c'est le lien « prise ∝ appât dépensé »), tirer `value` au PRNG d'état (le SEUL tirage, comme la canne — `peche-table.ts` NE TIRE RIEN), lire `tirerLigne(tableDePrises(c), value)`.
   - `poisson` / `trouvaille` → ajouter à la zone de prise (jusqu'à `CAPACITE`), émettre l'événement de prise (N15).
   - `rien` → l'appât a nourri sans rien donner cette fois : **il est tout de même dépensé** (le « rien » est le frein de `peche-table.ts` ; sans lui la nasse serait un robinet). C'est ce qui fait qu'une **eau pauvre rend moins par appât** — la nature module la nasse comme elle module la canne.
6. **Pouvoir de l'appât (v1, modeste).** Le TYPE d'appât module le tirage via le poids du « rien » (le levier de `poidsDuRien`) : `worms` = référence ; un appât plus riche (`raw_meat`) **divise le rien** (plus de touches par appât) au prix d'un item de nourriture. C'est le « où je dépense » de la décision (2). Table déclarative `NASSE.APPATS` (`balance.ts`), une ligne par appât — jamais un `if` en dur.

## Les bridages, un par un (déjà écrits ailleurs — la nasse les LIT)

- **Gel (N7).** Tuile gelée → `natureDeLEau` rend `null` → tentative sautée, appât préservé. Au dégel, la nasse reprend. (Même `null` que le refus de flotteur sur la glace, `peche.md` D7①.)
- **Assec (N8).** L'eau se retire sous la nasse → `null` → **la nasse SE MET EN PAUSE** : appât et prise **préservés**, la nasse **n'est ni détruite ni vidée**. Quand l'eau revient, elle reprend. *(Décision de spec, à trancher d'un mot si Alexis préfère autrement : la pause, pas la destruction — l'assec est un état du JOUR, temporaire ; détruire l'ouvrage pour une sécheresse passagère serait dur et coûterait un couplage. Le joueur peut toujours relever une nasse échouée pour récupérer prise et appât.)*
- **Souillure (N9).** Eau souillée → `c.souille = true` → `especeRetenue` échange la table : la nasse ne prend que les espèces `souillee`. En eau claire, jamais. **C'est le branchement de qualité d'eau (D1) et il est intégral, sans une ligne de plus.**
- **Marais / vase.** Une nasse ne se pose que sur les hauts-fonds (`eau:true` n'autorise que `TERRAIN_SHALLOW_WATER`) ; le marais (`reed_marsh`/`marsh`) n'est pas de l'eau posable ni pêchable. Cas exclu par construction.

## La relève et la perte (N11, N12)

- **Relève manuelle (N11).** Le propriétaire interagit avec la nasse (le geste du coffre) : il **prend** la prise stockée et l'appât restant, et **remet** de l'appât. `acces:'private'` → un non-propriétaire est refusé (`hasAccess`). **Pas de relève par les PNJ en v1** (N14) — la variante corvée-de-village a été écartée au profit du personnel (décision (3)) ; c'est une couche ultérieure, et le dire ici vaut mieux que de la bâtir.
- **Perte (N12).** `pv:40`, destructible. `applyStructureDamage` jusqu'à 0 → `spillOnGround(s.inventory)` : la prise et l'appât **tombent au sol**, récupérables par qui casse la nasse. C'est l'enjeu que le choix « ouvrage » (décision (4)) a acheté.

## Critères d'acceptation (tests headless `/sim`)

- **N1 — Registre.** `fish_trap` est UNE entrée de `PIECES` ; `StructureType` l'inclut ; `terrainConstructible` l'autorise sur `TERRAIN_SHALLOW_WATER` et **la refuse** sur la terre ferme et l'eau profonde ; `acces` est `'private'`.
- **N2 — Matière réutilisée.** La nasse coûte de la `fiber` ; **aucun** item `roseau` ni nœud neuf n'est ajouté (l'empreinte de carte et les seuils roselière ne bougent pas — garde par l'absence de churn sur `carte-immuable`/`t0-exploration`/`zone-content`).
- **N3 — Appâtée, pas « moins ».** Une nasse **sans appât** ne produit **RIEN** sur n'importe quelle durée. Avec appât, elle produit.
- **N4 — Prise ∝ appât.** Chaque tentative consomme **exactement 1** appât. Sur une durée fixe, plus d'appât disponible ⇒ plus de tentatives ⇒ plus de prises (monotone, moyenné sur ≥ 3 graines — leçon `melanger-deux-populations`/`mesurer-la-pire-seconde`). Le nombre de prises ≤ nombre d'appâts dépensés.
- **N5 — Le lieu dicte.** Une nasse sur une tuile `NATURE_RIVIERE` et une sur une tuile `NATURE_LAC`, mêmes graine/saison/heure, tirent de **tables différentes** (espèces de rivière vs de lac). Preuve par balayage du domaine sur `tableDePrises`, pas par échantillon de touches (leçon `garde-exhaustive-plutot-que-cas`).
- **N6 — Cadencée, pas par tick.** Entre deux tentatives, une nasse ne lit pas `natureDeLEau` et ne tire pas. Une tentative tous les `NASSE.CADENCE_TICKS`, ancrée par nasse (`s.until`), pas un modulo global.
- **N7 — Gel.** Tuile gelée sous une nasse appâtée : **aucune** prise, **aucun** appât consommé ; au dégel, elle reprend.
- **N8 — Assec.** L'eau se retire sous une nasse : elle **se met en pause** — appât et prise **préservés**, structure **intacte** ; l'eau revient, elle reprend.
- **N9 — Souillure (branchement D1).** Nasse sur eau souillée : ne prend que les espèces `souillee`. Nasse sur eau claire : n'en prend **jamais**. (Hérité de `especeRetenue`.)
- **N10 — Plafond.** La prise stockée s'arrête à `NASSE.CAPACITE` ; une nasse pleine **ne consomme plus d'appât** et ne tente plus.
- **N11 — Relève.** Le propriétaire relève prise + appât et peut réappâter ; un non-propriétaire est **refusé** (`hasAccess`).
- **N12 — Perte.** Détruire la nasse (`applyStructureDamage` → 0) **déverse** sa prise et son appât au sol (`spillOnGround`).
- **N13 — Déterminisme.** Même graine + mêmes nasses + mêmes ticks ⇒ mêmes prises ET même flux d'événements (contrat `sim.test`/`replay.test`/`events.test`). **Sans nasse, aucun tirage** : les tests existants sans nasse ne voient pas leur flux RNG décalé (leçon `rng-fragile-au-decompte-entites`).
- **N14 — Périmètre.** Aucun PNJ ne relève une nasse en v1 (borne de spec explicite).
- **N15 — Événement de domaine.** Chaque prise de nasse émet un `SimEvent` (comme la prise à la canne), consommé par la chronique / le tableau du village.

## Réglages (`balance.ts`, calibrés en JOUANT)

`NASSE = { CADENCE_TICKS, CAPACITE, APPATS }` :
- `CADENCE_TICKS` — l'intervalle entre tentatives (~¼ de cycle, à caler : assez lent pour que la relève reste un rendez-vous, assez vif pour qu'une absence soit récompensée).
- `CAPACITE` — le plafond de prise stockée (ordre de grandeur : quelques portions ; au-delà, poser une seconde nasse).
- `APPATS` — table déclarative `{ [item]: { rienDiv } }` : `worms` (référence, `rienDiv:1`), `raw_meat` (plus riche, `rienDiv>1` — divise le « rien » comme un coin). Une ligne par appât ; ajouter un appât est une ligne.

`pv` et `cout` de la nasse vivent dans son entrée `PIECES` (le worldgen/registre, pas `balance.ts`) — c'est le patron de toutes les pièces.

## Hors périmètre v1 (dit, pour ne pas le bâtir)

- La relève par un PNJ (corvée de village) — écartée au profit du personnel (décision (3)).
- La destruction de la nasse par l'assec (on met en pause, N8).
- Un appât « qui attire de loin » (rayon d'appâtage) — la nasse pêche sa seule tuile en v1.
- Un item `roseau` distinct et un nœud de roselière dédié — la `fiber` existante suffit (voir « Ce que la nasse réutilise »).
