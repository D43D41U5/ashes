# Le froid mord sur la flore

*Source : demande d'Alexis 2026-08-19 (« il faut que le froid ait un réel impact sur la flore
sauvage mais aussi sur l'agriculture »), fork tranché le même jour : **le froid SUSPEND le
sauvage et TUE le cultivé**. Statut : **décidé, à implémenter**. S'appuie sur `temperature.md`,
`gel.md`, `meteo.md`, `brume.md` ; AMENDE `agriculture.md` (R7) et complète `saison.md` (A1).*

## Ce qui existait, et pourquoi ça ne suffisait pas

Deux mécanismes, tous deux keyés sur l'**acte** (le calendrier), aucun sur la température :

- `SEASON.REGROW_ACT_FACTOR: [1, 1.5, 2]` — la repousse de TOUT nœud ralentit par acte.
- `village.ts` — semer une `parcelle` est refusé en acte III.

Un facteur par acte ne peut dire ni **où** ni **quand dans la journée**. Il ne sait pas que le
Névé est stérile, que la forêt tient plus longtemps que le marais, ni qu'un blizzard traverse
la vallée. Le champ thermique, lui, sait déjà tout ça — il n'était simplement pas lu.

> **Incohérence relevée, NON corrigée ici** (elle appelle sa propre décision) :
> `REGROW_ACT_FACTOR` s'applique aussi au fer, au charbon et à la pierre — le Grand Froid
> ralentit la « repousse » d'un filon. Cette spec ne touche pas aux minéraux : ils gardent
> exactement le comportement d'aujourd'hui.

## Le climat d'un lieu (F1)

- **F1 — `climatFlore(state, x, y, tick)` : le froid du monde À DÉCOUVERT.** C'est
  `baselineTemperatureAt` **avec `shelter = 1`** — même expression, même ordre, l'abri en
  moins : une plante est dehors. Donc `BASE − ACT_COLD[acte] + biome − nuit − brume − front`,
  borné à [0, 100]. Un seul écrivain : les deux fonctions partagent le corps, et
  `1 × exposé === exposé` au bit près (le contrat de replay ne bouge pas).
- **F1bis — ni le feu ni la source chaude n'entrent.** Même raisonnement que `gel.md` G1 et
  que le gate des Cendreux : `ambientTemperature` ferait d'un feu de camp une serre gratuite,
  et tuerait le payoff « bâtir des serres AVANT l'hiver » (`agriculture.md` R7). **Le feu
  réchauffe les hommes, pas la terre.** Il est aussi le seul terme qui coûterait un balayage
  des structures par nœud.

Ce que la table donne, en climat de jour (`90 − ACT_COLD + biome`) :

| | acte I (j1-21) | acte II (j22-42) | acte III (j43-60) |
|---|---|---|---|
| forêt (+5) | 95 / 65 nuit | 70 / 40 | 45 / 15 |
| plaine (0) | 90 / 60 | 65 / 35 | 40 / 10 |
| marais (−5) | 85 / 55 | 60 / 30 | 35 / 5 |
| Névé (−40) | 50 / 20 | 25 / 0 | 0 / 0 |
| Glacier (−75) | 15 / 0 | 0 / 0 | 0 / 0 |

Plus un front de neige (−25), un blizzard ou la Brume (−55), en rampe sur la bande.

## Les deux seuils (F2-F5)

- **`FLORE.SEUIL_GEL = 52` — la plante est GELÉE.** Elle ne finit pas sa repousse, elle ne
  rend rien à la cueillette, et on ne sème pas la terre qu'elle occupe. La valeur se lit dans
  le tableau : elle laisse **l'acte I entier libre, nuit comprise** (le plus froid des trois
  biomes de vallée y est à 55), fige **les nuits dès l'acte II** (35), et arrête **la vallée
  entière en acte III** (45 au mieux). Elle stérilise le Névé et le Glacier dès le premier
  jour. Un blizzard ou la Brume (−55) gèlent leur sillage à tout acte.
- **`FLORE.SEUIL_MORTEL = 22` — le gel TUE la culture à ciel ouvert.** Juste au-dessus de
  l'hypothermie humaine (`TEMPERATURE.HYPOTHERMIA = 20`) : **la culture meurt là où l'homme
  meurt**. Conséquences lues dans la table : l'acte I ne tue jamais (le pire y est 50, et
  aucun blizzard n'est tiré avant l'acte II) ; en acte II un **blizzard tue de jour comme de
  nuit** (65 − 55 = 10) et un **front de neige tue la nuit** (10) ; en acte III **toute nuit
  tue** (10). Le potager de plein air devient un pari, puis n'est plus jouable.
- Aucun des deux seuils n'est un multiple de 5 : hors front, la table n'atteint que des
  multiples de 5, donc aucun seuil ne se décide au bit de flottant près (`gel.md` G4). Sous
  un front la rampe est continue et traverse le seuil — c'est un franchissement normal, pas
  un aléa de précision.

## Ce que le froid fait, exactement

- **F2 — LA REPOUSSE N'ABOUTIT PAS SOUS LE GEL.** `regrowAt` reste ce qu'il est : une date,
  posée à l'épuisement, jamais réécrite. À l'échéance, le stock ne se remplit que si la plante
  n'est pas gelée ; sinon on repasse au tick suivant. **On ne fait PAS glisser la date** — elle
  voyage dans le `NodeDelta` à l'épuisement (`recolte-vivante.md`, protocole v2), et une date
  qui glisse chaque tick serait soit une inondation de deltas, soit un client qui ment. Un
  gate est dérivable par le client, une intégrale ne l'est pas (les fronts sont purgés de
  l'état — `baselineTemperatureAt` le dit dans son propre en-tête).
- **F3 — UNE PLANTE GELÉE NE REND RIEN — mais seulement ce qu'elle produit FRAIS.** La récolte
  est refusée (« la plante est gelée ») sur les nœuds `gelif` : **baies, champignons, vers**.
  Ce qui n'est plus là sous la neige, et rien d'autre. **Deux exclusions, et c'est la même
  règle de fond : le froid ne ferme jamais ce qui permet d'y survivre.**
  - **L'arbre gelé donne toujours son bois.** Le Feu EST la survie de l'acte III ; geler le
    bois de chauffage au moment où il compte le plus serait le contraire du jeu qu'on écrit.
  - **La fibre sèche se ramasse encore** *(décision d'Alexis, 2026-08-20)*. Ce sont des tiges
    sèches : elles ne disparaissent pas l'hiver, c'est même la saison où on les ramasse. Et
    `tenue_hiver` coûte 2 fibres — c'est LA parade au froid d'acte III (elle plancher
    l'exposition au-dessus de l'hypothermie). La geler ferait fermer au froid sa propre
    contre-mesure : ce n'est pas une difficulté, c'est une impasse. `arrow` (1 fibre par 5)
    et `stew` (4 baies + 1 fibre) en dépendent aussi.

  `gelif` est un sous-ensemble STRICT de `vivant` : la plante à fibre vit, donc **sa repousse
  gèle** comme les autres (F2) — c'est son seul RENDEMENT qui ne gèle pas.
- **F4 — ON NE SÈME PAS UNE TERRE GELÉE.** Le refus de `plant` passe de l'acte au **climat du
  lieu** : une `parcelle` dont le climat est sous `SEUIL_GEL` refuse le semis. `serre` et
  `terroir` restent **hivernales par leur type** (`agriculture.md` R7/R8), sans passer par le
  champ thermique — `isSheltered` ne connaît que la maison et la grotte, et l'y ajouter
  changerait la survie humaine à l'hypothermie, hors périmètre.
- **F5 — LE GEL TUE LA CULTURE À CIEL OUVERT.** Chaque tick, une `parcelle` semée dont le
  climat est sous `SEUIL_MORTEL` perd sa culture : `plantedAt` s'efface, la graine est perdue,
  l'événement `crop_frozen` est émis. **Serre et terroir sont épargnés.** La MATURITÉ ne
  protège pas : une récolte mûre laissée en terre gèle comme une pousse — c'est ce qui fait de
  « rentrer la récolte avant le front » un geste, et le front s'annonce (`meteo.ts` : la rampe
  fait qu'il se SENT venir). **Le chemin réel est celui-ci** : on sème là où la sim l'autorise
  (acte II, de jour), et c'est le blizzard qui tue — pas une main qui pose `plantedAt`
  (critère A10ter).
- **F3bis — UN PNJ NE RESTE PAS PLANTÉ DEVANT UN BUISSON GELÉ.** Le refus de F3 doit être
  LU par l'IA, pas seulement infligé : sans ça, `applyEconomyAction` refuse, le nœud a encore
  du stock (donc on ne cherche pas ailleurs), la corvée n'est pas relâchée — et le PNJ repart
  pour un tour, indéfiniment. Une nuit d'acte II est une nuit perdue ; **en acte III, où rien
  ne dégèle, c'est pour toujours** : il ne mange plus et ne descend jamais jusqu'au bois qu'il
  pourrait couper. C'est la famine que `npc.ts` avait déjà épinglée pour « aucun nœud de ce
  type », par une autre porte. Le gel n'étant pas un empêchement PROPRE à ce PNJ (le voisin
  gèlerait pareil), la corvée QUITTE LE TABLEAU et `refreshBoard` la reposte au dégel. Testé
  AVANT la marche : traverser la carte vers un buisson gelé est un trajet perdu.
- **F6 — RIEN NE MEURT CÔTÉ SAUVAGE.** Aucun nœud ne sort de la carte, aucun stock ne se vide
  du fait du froid. Le sauvage ATTEND ; seul le cultivé paie. Une saison de 60 jours ne doit
  pas laisser un monde nu à qui l'a traversée.
- **F7 — LE FROID NE MORD QUE SUR CE QUI VIT.** `NodeDef.vivant` marque les six dont la
  REPOUSSE gèle : `tree`, `old_tree`, `fiber_plant`, `berry_bush`, `champignon`, `leaf_pile`.
  `NodeDef.gelif` marque les trois dont le RENDEMENT gèle aussi : `berry_bush`, `champignon`,
  `leaf_pile`. La pierre, le fer, le charbon, la tourbe et les gravats ignorent tout du gel.

## Le rendu : un MARQUEUR provisoire, en attendant la DA

- **F8 — LA PLANTE GELÉE SE VOIT, tout de suite.** Un refus de cueillette qu'aucun signe
  n'annonce est le contraire du contrat maison (`gel.md` G5, « annoncé, pas surprise »). En
  attendant que la direction artistique tranche — décision d'Alexis —, un **marqueur d'état**
  et non un look : la plante gelée est peinte en **aplat bleu pâle**
  (`setTint(…).setTintMode(FILL)`, `snapshot-view.ts`), silhouette comprise.
  - **Une teinte ordinaire ne pouvait PAS marcher, et c'est mesuré.** Le tint de Phaser
    MULTIPLIE : il ne sait que retirer de la couleur. Sur un buisson où le vert domine, aucun
    bleu multiplié ne fera passer le bleu devant le vert — relevé le 2026-08-20, `bleu − rouge`
    remontait de −20 à −2 avec un cyan franc : chiffre bien réel, et à l'œil le buisson lisait
    « un peu plus vert ». Or le givre est CLAIR et FROID, exactement ce qu'un multiply ne fait
    pas. L'aplat remplace, donc il y arrive.
  - Perdre les baies dessinées est **cohérent avec la règle** : un buisson gelé ne rend rien.
  - Le mode de teinte se repose à CHAQUE branche : les sprites sont poolés et `clearTint()` ne
    touche pas au mode — sans ça, un slot ayant peint une plante gelée repeindrait la suivante.
- **F8bis — ON PEUT L'ATTEINDRE.** `pnpm smoke --scenario flore --dev` (avec
  `SMOKE_URL=http://localhost:3001/` contre son propre `pnpm dev`) saute au jour 50 par
  `debug_set_season_day`, force midi des deux côtés, et rend quatre captures (tiède/gelé,
  plein écran et zoomées). **Il mesure en DIFFÉRENTIEL** : l'acte III repeint tout (neige au
  sol, feuillus dénudés, lumière), donc comparer la couleur du buisson avant/après ne
  prouverait rien. On lit le buisson (`gelif`) ET un nœud témoin qui ne gèle jamais, dans la
  même frame et le même pipeline : seule la teinte du givre peut expliquer que l'un vire et
  pas l'autre. Relevé au 2026-08-20 : écart buisson−témoin **26,3 → 38,6**, témoin plat
  (−46,35 → −46,31).
- **⚠ CE QUE LE CLIENT NE SAIT PAS ENCORE VOIR** : le snapshot ne porte pas la Brume
  (`etat-gel.ts` ③). Une plante gelée par une nappe sera donc REFUSÉE par la sim sans être
  peinte en gelé. Même trou que pour la glace, même remède (un champ additif dans
  `SnapshotMessage`), et il touche `/sim` : décision d'Alexis.

## Ce que ça renverse

- **`agriculture.md` R7 disait explicitement** : *« pas de suivi "la culture meurt",
  déterministe et simple »*. F5 le renverse — décision d'Alexis du 2026-08-19, consignée dans
  `docs/decisions.md`. Le semis reste par ailleurs ce qu'il était : c'est le gel MORTEL qui
  tue, pas le simple gel.
- **`saison.md` A1** garde son facteur d'acte : F2 s'y ajoute au lieu de le remplacer. En acte
  II le surcoût réel est **au plus une nuit d'attente** (la date échoit, la nuit la retient
  jusqu'à l'aube), pas un second multiplicateur.

## Critères d'acceptation

- **A1** — `climatFlore` est PURE et rend `baselineTemperatureAt` **au bit près** sur toute
  tuile non abritée, à tout tick (garde exhaustive sur le domaine, pas des points choisis).
- **A2** — **Le sauvage suspend, jamais ne meurt** : un buisson vidé dont la date échoit en
  acte III garde `stock 0` cent ticks durant, et **aucun nœud ne disparaît** de `state.nodes`
  du fait du froid.
- **A3** — **Et il reprend au dégel** : le même buisson, la date échue et gelée, se remplit au
  tick exact où le climat repasse au-dessus de `SEUIL_GEL` (transition acte III → tiède).
- **A4** — **L'acte I est libre, nuit comprise** : sur herbe, forêt et marais, à toute heure
  de l'acte I sans front, `climatFlore ≥ SEUIL_GEL` — la cueillette et la repousse d'acte I
  ne changent pas d'un pouce (non-régression du jeu existant).
- **A5** — **Le frais gèle, le sec non** : sous `SEUIL_GEL`, dans le même monde au même tick,
  `harvest` est refusé sur un `berry_bush` et réussit sur un `tree` ET sur un `fiber_plant`.
  Et `gelif` est un sous-ensemble strict de `vivant` — la fibre vit sans être gélive.
- **A6** — **Le minéral ignore le froid** : un `iron_vein` vidé repousse à sa date en acte III
  de nuit, exactement comme aujourd'hui.
- **A7** — **La géographie mord** : au même tick d'acte I, un nœud vivant sur `snow` est gelé
  et le même nœud sur `grass` ne l'est pas.
- **A8** — **Le blizzard fige son sillage** : sous une bande de blizzard en acte II, un nœud
  gelé le redevient libre une fois la bande passée, sans une ligne d'état.
- **A9** — **Semer** : sous `SEUIL_GEL`, semer une `parcelle` est refusé et semer une `serre`
  ou un `terroir` réussit ; au-dessus, les trois réussissent.
- **A10** — **Le gel tue le potager** : une `parcelle` semée sous `SEUIL_MORTEL` perd
  `plantedAt` en un tick et émet `crop_frozen` ; la `serre` et le `terroir` semés au même
  endroit et au même tick gardent le leur.
- **A10ter** — **La mécanique est JOIGNABLE par le jeu** : semé par l'action `plant` en acte II
  de jour (autorisé), le potager de plein air meurt sous un blizzard qui traverse — sans qu'un
  test n'écrive `plantedAt` à la main. C'est la différence entre « la règle marche » et « le
  joueur peut la rencontrer ».
- **A10quater** — **Le PNJ descend jusqu'au bois** : buissons gelés (posés sur la neige, en
  acte I, pour isoler le lieu de la saison), un village à un PNJ finit par rentrer du BOIS —
  et le buisson reste intact. Garde vérifiée par neutralisation : sans F3bis, le compte de
  bois reste à zéro.
- **A11** — **Déterminisme** : flux RNG bit-identique avec et sans la règle (aucun tirage
  neuf), et `replay.test.ts` / `events.test.ts` passent sans retouche de contrat.
