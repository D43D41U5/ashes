# La nasse — la pêche qui travaille sans nous

*Source : reprise de l'eau **D3** (`docs/reprise-eau.md`, « les roseaux récoltables » → « à quoi sert un roseau »), quatre décisions d'Alexis prises en session le 2026-09-13 : **(1)** un roseau sert à faire une **nasse** (pêche passive) ; **(2)** la nasse est **appâtée** (elle mange de l'appât, la prise est proportionnelle à l'appât dépensé) ; **(3)** elle est **personnelle**, relevée à la main ; **(4)** c'est un **ouvrage posé** — une pièce du registre, donc qu'on peut **perdre**. Specs voisines : `peche.md` (la table de prises, la nature de l'eau, les bridages — la nasse en est une CONSOMMATRICE, elle n'invente rien), `qualite-eau.md` (la souillure, `eauSouillee`), `construction.md` (le registre `PIECES`, la pose sur l'eau), `eau-vivante.md`/`gel.md` (la crue, l'assec, le gel).*

*Statut (2026-09-13) : **LIVRÉ — sim et tests SEULEMENT ; PAS ENCORE ATTEIGNABLE EN JEU** (ni recette, ni item, ni sprite — voir l'avertissement plus bas).* `NASSE` (`balance.ts`), l'entrée `fish_trap` du registre (`pieces.ts`), `eauSeule` (`pieces.ts` + `terrainConstructible`), `advanceNasses` (`nasse.ts`, branchée dans `step()`), l'événement `nasse_caught` (`events.ts`, muet à l'oreille dans `audio/inventaire.ts`) ; `tirerLaTaille` exporté depuis `economy.ts` pour que la nasse tire la taille avec la MÊME loi que la canne. `NASSE.CAPACITE` (le plafond de prise, voir la boucle). **20 tests** (`nasse.test.ts`, N1-N15).
⚠ **PAS ENCORE ATTEIGNABLE PAR UN JOUEUR, et il faut le dire** : `fish_trap` n'est dans aucune recette (absent de `RecipeId`), n'a pas d'`ItemId`, et l'action `build` ne prend qu'un `BarrierType` — une pièce `pose: 'objet'` arrive par la voie du coffre et du séchoir (recette → objet tenu → `place_component`). **Rien, aujourd'hui, ne peut poser une nasse hors code de test**, et c'est aussi pourquoi le damier magenta du rendu manquant est hors d'atteinte. La rendre atteignable — recette, item, sprite — est le **lot suivant**, et le sprite est une décision de DA. Reste ouvert aussi : le CALIBRAGE en jouant (cadence, `CAPACITE`, coût, pouvoir des appâts). Hors périmètre v1, dit et tenu : aucune relève par les PNJ.*

## Objectif de design

Le poisson de `peche.md` se **mérite au réflexe** — c'est le geste actif, et c'est bien. La nasse est l'autre bout : **la pêche qui travaille pendant qu'on fait autre chose.** On la pose dans les hauts-fonds, on l'appâte, on s'en va ; elle prend, lentement, ce que l'eau du lieu porte ; on revient la relever. Elle donne un **but à la roselière** (les roseaux qu'on y cueille — de la `fiber` — deviennent le piège : voilà « à quoi sert un roseau »), un **puits à appât** (« où je dépense mes vers »), et une **prise que le lieu dicte** (rivière ≠ lac, sans qu'on ait à le coder deux fois). Et parce que c'est un **ouvrage** et non du matériel de poche, elle a un **enjeu** : un pillard la casse et emporte la prise ; l'eau qui gèle ou se retire la met en défaut. Une pêche passive qu'on ne pourrait pas perdre n'aurait pas de tension.

Les deux interdits du GDD (l.402) tiennent, et la nasse marche **avec** eux, pas contre : elle n'est PAS « une barre de progression passive » que le joueur regarde monter — il ne la voit pas travailler, il la **relève** ; et elle n'est PAS une collecte automatique gratuite — chaque prise a **coûté de l'appât** qu'il a fallu récolter et venir remettre.

## Ce que la nasse RÉUTILISE (et n'a donc pas à écrire)

C'est le cœur de la spec : la nasse est un **assemblage**, pas un système neuf.

- **La table de prises** — `conditionsAt(state, tx, ty, surCoin, niveauConnu)` → `tableDePrises(c)` → `tirerLigne(table, value)` (`peche-table.ts`). La nasse appelle EXACTEMENT la même chaîne que la canne, sur sa propre tuile. Elle hérite donc **gratuitement** :
  - de la **nature du lieu** (rivière / lac / mare — `natureDeLEau`) : une nasse en rivière et une nasse en lac ne prennent pas les mêmes espèces, sans une ligne de plus (N5) ;
  - de la **saison** et du **créneau horaire** (`phaseForDay`, `creneauAt`) ;
  - de la **souillure** (`c.souille = eauSouillee(...)`, `especeRetenue` échange la table entière, R26b) : en eau souillée, la nasse ne prend que les espèces `souillee` — en pratique la seule qui existe, la **lamproie de suie** ; en eau claire, jamais (N9). **C'est le bridage de qualité d'eau (D1), et il est déjà écrit.**
- **La taille d'une prise** — `tirerLaTaille` (`economy.ts`, exporté pour l'occasion) : la nasse tire la taille sous la MÊME loi triangulaire que la canne, mais **à niveau 0** — la maîtrise d'un pêcheur ne peut pas biaiser une prise qu'il n'a pas ferrée. `portionsDe` convertit comme partout.
- **L'appât** — `worms` existe (item), se récolte au `leaf_pile`, et est **déjà l'appât** que `castLine` consomme (`economy.ts`). La nasse consomme le même.
- **La matière** — la roselière donne déjà de la `fiber` (`economy.ts:1909-1912`, densité 0,18 ; le commentaire les nomme « roseaux, sphaigne »). La nasse coûte de la `fiber`. **Aucun item `roseau`, aucun nœud neuf** : les introduire mettrait deux produits sur une tuile et perturberait l'économie de la fibre pour zéro gain de jeu (arbitrage écarté ce jour — le sens de D3 est « pourquoi aller à la roselière », pas « faut-il un item roseau »). Conséquence heureuse : **l'empreinte de carte ne bouge pas d'un bit**, et les seuils de la roselière (`carte-immuable`, `t0-exploration`, `zone-content`) ne sont pas touchés.
- **La pose dans l'eau** — `eau: true` → `POSABLE_SUR_EAU` → `terrainConstructible` l'autorise sur `TERRAIN_SHALLOW_WATER` (`construction.ts`, décision 2026-07-31).
- **La propriété et la perte** — `acces: 'private'` (propriété individuelle, MVP gouvernance) ; `pv` fini + `applyStructureDamage` → `spillOnGround` déverse l'inventaire d'une structure détruite. Une nasse cassée **lâche sa prise et son appât au sol** : la tension d'ouvrage sort de mécaniques déjà là.
- **Le stockage et la relève** — `Structure.inventory` (le patron du coffre, créé à la pose dès que la pièce déclare `capacite`) porte l'appât ET la prise, dans un seul panier. La **relève est donc le geste du coffre** (`transfer`), gratuit : on prend le poisson, on remet des vers. `hasAccess` fait le reste (N11).

## L'entrée du registre (N1)

Une entrée de `PIECES` (`pieces.ts`), et `StructureType` en dérive — « tout en pièces, partout » :

```ts
fish_trap: {
  label: 'Nasse', fam: 'mobilier', pose: 'objet', occupe: 'tuile', arete: 'interdite',
  sousRoche: false,
  bloque: 'non', pv: 40, cout: { fiber: 8 }, acces: 'private', eau: true, usurable: true,
  eauSeule: true,
  capacite: 8,
},
```

- `fam: 'mobilier'`, `pose: 'objet'` — on la **dépose** comme un objet (le patron du coffre et du séchoir), pas au marteau du bâti : elle ne fait émerger aucune fonction et n'appartient à aucun amas.
- **`bloque: 'non'`** — l'invariant des pièces d'eau (« ce qui tient sur l'eau porte sa propre assise, donc ne bloque rien », `pieces.test`) **et** le bon geste : on PATAUGE jusqu'à sa nasse pour y plonger la main. Un panier d'osier n'est pas un mur, et une pleine tuile bloquante dans les hauts-fonds saurait emmurer qui se tient dessus.
- **`eauSeule: true`** — *ajouté par ce chantier*, le pendant de `surCendre` : `eau: true` ne fait qu'ADMETTRE l'eau **en plus** de la terre, or une nasse sur l'herbe ne prendrait JAMAIS rien. Sans cette porte, on laissait le joueur dépenser huit fibres sur un ouvrage mort. Un refus lisible vaut mieux qu'un objet inerte.
- `acces: 'private'` — personnelle (décision (3)) ; `capacite: 8` — conteneur, donc relevable comme un coffre.
- `usurable: true` — déclare que ses PV **se lisent comme de la vétusté** : « à 30 % de PV », sur un panier d'osier, veut dire quelque chose (au contraire d'une meule de foin). ⚠ **Portée exacte, vérifiée** : le drapeau n'a qu'UN lecteur dans tout le dépôt, `USURABLE` dans `poi-batis.ts`, qui pré-use les pièces des lieux BÂTIS ; aucun `.plan` ne pose de nasse, donc pour une nasse posée par un joueur il ne change **rien aujourd'hui**. Et il ne promet **aucune décrépitude au fil du temps** : rien dans `advanceNasses` n'use la nasse, une nasse jamais frappée reste neuve. L'osier qui pourrit dans l'eau serait un mécanisme à part, **différé**. `cout`/`pv` : ordres de grandeur, à caler en jouant. Pas de palier de corde en v1 : la fibre est son essence, et on veut la nasse **tôt** (dès qu'on a cueilli à la roselière).

## La boucle (`nasse.ts`)

Un balayage cadencé des structures, sur le patron d'`advanceCultures` (`for (const s of state.structures)`), branché dans `step()`. **L'ordre des gardes EST le coût** : le type, puis la cadence (un modulo), puis le panier, et seulement alors l'eau et le PRNG.

1. **Cadence (N6).** Une nasse tente une prise tous les `NASSE.CADENCE_TICKS`, la phase **décalée par son `id`** (`(tick + id) % CADENCE === 0`) : deux nasses ne battent pas ensemble, et **ça ne coûte aucun champ d'état** — l'`id` est stable au rejeu comme à la sauvegarde. Entre deux battements : ni lecture de l'eau, ni tirage.
   ⚠ **LA CADENCE NE DOIT PAS DIVISER LE CYCLE**, et c'est un enseignement de l'implémentation, pas un détail : à ¼ de cycle pile, les battements d'une nasse retombaient sur les **mêmes quatre heures du jour pour l'éternité**. Comme la table a un axe CRÉNEAU, une nasse n'aurait alors **jamais vu certains créneaux** — donc jamais pris les espèces de nuit, quel que soit le temps qu'on l'y laisse. D'où **7/30 de cycle** : les relèves *précessent* dans la journée (30 tentatives = 7 cycles).
2. **Pleine ?** Deux bornes, et **aucun appât consommé** si l'une mord (N10). ① La **prise stockée** (tout ce qui n'est pas de l'appât) atteint `NASSE.CAPACITE`. ② Il ne reste plus une case libre — rien ne rentrerait.
   ⚠ **LA BORNE ① EST INDISPENSABLE, et l'avoir crue facultative était une dérive.** Les poissons crus **s'empilent par 5** (`STACK_SIZES`, `parClasseDePrise(5, 5, 5)`) : se fier aux seules cases ne borne pas 8 prises mais **8 PILES** — soit **une trentaine de portions**, appât déduit, pour un ouvrage à 8 fibres qu'on ne surveille pas. La pêche passive sortait la canne du jeu. Une nasse pleine attend qu'on la relève et **ne gâche pas les vers**.
3. **Pêchable ?** `eauIndisponible(state, s.tx, s.ty, niveau) !== null` → on passe, **l'appât préservé** (N7, N8).
   ⚠ **`conditionsAt` NE SUFFIT PAS, et c'est le piège de ce module.** `natureDeLEau` ne consulte que `porteDeLEau` (« l'eau est-elle LÀ ») : **une eau GELÉE garde sa nature, donc sa table**. Le refus du gel vit dans `eauIndisponible` (« l'eau est prise », `peche.md` D7①) — exactement le prédicat que le flotteur interroge. Une nasse jugée sur la seule table aurait **pêché à travers la glace**, au vert. Ce prédicat couvre les trois pertes d'un coup : **gel**, **assec**, **vase**.
4. **Appâtée ?** Pas d'appât dans le panier → aucune tentative (N3). *Appâtée* veut dire **aucune** prise sans appât, pas « moins ».
5. **Tentative.** Consommer **1 appât** (N4 — le lien « prise ∝ appât dépensé »), tirer une fois au PRNG d'état (le seul tirage ; `peche-table.ts` NE TIRE RIEN), lire `tirerLigne`.
   - `poisson` → taille (`tirerLaTaille`, niveau 0) → portions → ranger ce qui rentre, émettre (N15).
   - `trouvaille` → ranger l'item, émettre.
   - `rien` → **l'appât est dépensé quand même** : c'est le frein de la table (sans lui, une nasse serait un robinet), et c'est ce qui fait qu'une **eau pauvre rend moins par appât**. La nature module la nasse comme elle module la canne.
6. **Pouvoir de l'appât.** Le TYPE d'appât **divise le poids du « rien »** — le levier même dont se sert un coin de pêche (`COIN_RIEN_DIV`). Il ne DÉBLOQUE aucune espèce : *la géographie module, elle n'autorise jamais*, et un appât non plus. Table déclarative `NASSE.APPATS`, une ligne par appât ; **l'ordre est celui de la consommation** (le moins cher d'abord, pour qu'on ne perde pas sa viande sans l'avoir voulu).

Le niveau d'eau est hoisté **à la demande** : une nasse qui ne tente pas ne paie pas le rembobinage de huit cycles d'élection météo que `niveauDEau` coûte (E5, comme les pêcheurs).

## Les bridages, un par un

- **Gel (N7).** `eauIndisponible` rend « l'eau est prise » → tentative sautée, **appât préservé**. Au dégel, la nasse reprend.
- **Assec (N8).** L'eau se retire sous la nasse → **PAUSE** : appât et prise **préservés**, la nasse **n'est ni détruite ni vidée**, ses PV intacts. Quand l'eau revient, elle reprend. *(Décision de spec, à contredire d'un mot : la pause, pas la destruction — l'assec est un état du JOUR, temporaire ; détruire l'ouvrage pour une sécheresse passagère serait dur et coûterait un couplage. Le joueur peut toujours relever une nasse échouée.)*
- **Souillure (N9).** Table échangée : la nasse ne prend que les espèces `souillee`. **Intégral et gratuit** — hérité de `conditionsAt`/`especeRetenue`.
- **Marais / vase.** `eauSeule` n'admet que `TERRAIN_SHALLOW_WATER` : le marais n'est ni posable ni pêchable. Cas exclu par construction.

## Critères d'acceptation (`nasse.test.ts`, 19 tests)

- **N1 — Registre.** `fish_trap` est UNE entrée de `PIECES`, `acces: 'private'`, conteneur, cassable ; `terrainConstructible` l'autorise sur le gué et **la refuse** sur la terre ferme, la vase et le profond.
- **N2 — Matière réutilisée.** Le coût est de la `fiber`, et **rien d'autre** : aucun item `roseau`, aucun nœud neuf, aucune empreinte de carte déplacée.
- **N3 — Appâtée, pas « moins ».** Une nasse **sans appât** ne produit **RIEN** sur n'importe quelle durée.
- **N4 — Prise ∝ appât.** Chaque tentative consomme **exactement 1** appât ; jamais plus de prises que d'appâts dépensés ; et **plus d'appât ⇒ plus de prises** (monotone, sommé sur trois graines). Le même cas affirme que **le mécanisme n'est PAS inerte** — la prémisse de tous les cas « zéro » du fichier.
- **N5 — Le lieu dicte.** Les tables rivière et lac ne retiennent pas les mêmes espèces (balayage du domaine) ; et **tout poisson pris par une nasse de rivière est déclaré en rivière**, de lac en lac.
- **N6 — Cadencée.** Hors battement : aucun tirage, aucun événement. Au battement : ça tire. Et **la cadence ne divise pas le cycle** (sans quoi la nasse rejouerait les mêmes heures à jamais).
- **Câblage.** Un vrai `step()` fait pêcher la nasse — une phase appelée seule ne prouve pas qu'elle est branchée.
- **N7 — Gel.** `estGele` ET `eauIndisponible` affirmés d'abord ; puis aucune prise et **aucun ver brûlé**.
- **N8 — Assec.** Pause : appât, prise et ouvrage préservés — et **ça reprend** quand l'eau revient.
- **N9 — Souillure.** En eau souillée (prémisse par `eauSouillee`), **seule la lamproie** mord ; en eau claire, **jamais**.
- **N10 — Plafond.** Deux cas. *La porte* : panier sans case libre → aucune tentative, **aucun appât gâché**. *Le plafond lui-même* : laissée saturer avec de l'appât à ne plus finir, la prise stockée **ne dépasse pas `NASSE.CAPACITE`** et la nasse **cesse de consommer** — un plafond qui laisse filer l'appât n'en est pas un. (Le second cas manquait : le premier CONSTRUIT la plénitude, donc il prouve la porte et non la borne.)
- **N11 — Relève personnelle.** Le poseur accède, un autre est refusé (`hasAccess`).
- **N12 — Perte.** Cassée, la nasse **verse sa prise et son appât au sol** (`spillOnGround`), en un tas sur sa tuile.
- **N13 — Déterminisme.** Même graine ⇒ mêmes prises (espèce, taille, portions). Et **sans nasse posée, le module ne touche pas au PRNG** : un monde qui n'en a pas ne voit aucun flux seedé décalé.
- **N14 — Périmètre.** Aucun PNJ ne relève une nasse en v1.
- **N15 — Événement.** Chaque prise émet `nasse_caught` — **ancré sur l'OUVRAGE** (`structureId` + `ownerId`), parce que personne ne tenait la ligne — plus le `resource_harvested` commun que lit la chronique. **Ni bestiaire, ni record, ni XP** : une prise qu'on n'a pas ferrée n'est pas un exploit de pêcheur. Muet à l'oreille (`audio/inventaire.ts`) : la récolte parle déjà, et il n'y a personne au bord pour entendre.

## Réglages (`balance.ts`, calibrés en JOUANT)

`NASSE = { CADENCE_TICKS, CAPACITE, APPATS }` :
- `CADENCE_TICKS` — l'intervalle entre tentatives : **7/30 de cycle**, délibérément **pas un diviseur** du cycle (voir la boucle, point 1).
- `CAPACITE` — la **prise stockée** qu'une nasse peut porter, en unités, appât NON compris. C'est le vrai plafond de la pêche passive, et **le seul levier qui l'empêche de sortir la canne du jeu** : c'est lui qu'on bouge si une nasse abandonnée rend trop. La `capacite` du panier (`PIECES`) ne borne que les CASES — elle ne suffit pas, les poissons s'empilant.
- `APPATS` — table déclarative `{ [item]: { rienDiv } }` : `worms` (référence, `rienDiv: 1`), `raw_meat` (plus riche, `rienDiv: 2` — il détourne de la nourriture pour mordre plus). L'ordre est celui de la consommation. Ajouter un appât est **une ligne**.

`pv` et `cout` vivent dans l'entrée `PIECES` — le patron de toutes les pièces.

## Hors périmètre v1 (dit, pour ne pas le bâtir)

- **Le rendu client** : sprite de la nasse dans les hauts-fonds, et la relève à l'écran. La sim d'abord, headless et testée.
- La relève par un PNJ (corvée de village) — écartée au profit du personnel (décision (3)).
- La destruction de la nasse par l'assec (on met en pause, N8).
- Un appât « qui attire de loin » (rayon d'appâtage) — la nasse pêche sa seule tuile.
- Un item `roseau` distinct et un nœud de roselière dédié — la `fiber` existante suffit.
- Le bonus de **coin de pêche** : la nasse passe toujours `surCoin: false`. Le cadeau du coin est la récompense de l'angler qui l'a trouvé, pas d'un panier qu'on laisse.
