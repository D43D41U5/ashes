# Le glanage — plus rien à mains nues, et ce qui rouvre la boucle

*Source : décision d'Alexis du 2026-08-25 (« je ne souhaite plus que l'on puisse récolter quoi que ce soit à main nue […] à côté d'un nœud de pierre, on a faible chance de trouver une pierre au sol lootable. Pareil pour le bois »), précisée le même jour : « seuls la pierre et le bois sont concernés » et, pour les PNJ, « fais qu'ils ont aussi le verrou ». Amende `craft-fortune.md` (C3, **retiré**), `recolte-maitrise.md` (le baseline du bois), `economie.md` (R5). Statut : **implémentée le 2026-08-25** — 16 critères en tests headless (`glanage.test.ts`), vus en jeu (`pnpm smoke --dev --scenario glanage`), instruments `tools/mesure-glanage.mts` (le tempo) et `tools/planche-glanage.mts` (le butin contre le décor). Jalon : calibrage Veillée / GATE 1.*

---

## Objectif de design

Le geste d'ouverture d'ASHES était : on arrive nu, on tape un arbre, on a du bois. L'outil ne changeait qu'un **rendement** (×1 à mains nues, ×2 avec le hachereau) — jamais un **accès**. Conséquence : l'outil n'était pas une porte, c'était un bonus, et la première heure n'avait aucun objectif propre. On pouvait jouer une partie entière sans jamais tailler quoi que ce soit.

> **Le principe unique de cette spec : le bois et la pierre exigent un outil ; l'outil se taille de ce qu'on RAMASSE.**

Ce n'est pas un durcissement. C'est un **déplacement du geste d'ouverture** : la première chose qu'un joueur fait n'est plus de frapper, c'est de **chercher par terre**. Et ce qu'il cherche, il le trouve au pied de ce qu'il ne peut pas encore entamer — donc le monde lui enseigne sa propre règle, sans un mot d'interface.

### Le blocage circulaire, et pourquoi il n'existe pas

`craft-fortune.md` C3 disait, en toutes lettres : *« la pierre reste à `none` pour toujours : tout outil de fortune est fait de pierre — la gater derrière un outil serait le blocage circulaire que `recolte.md` G13 a déjà refusé pour le marteau. »*

**C3 est retiré**, et sa prémisse avec lui. Elle supposait que la pierre ne s'obtient QUE d'un rocher. Le glanage la casse :

```
sol (branche + pierre)  →  hachereau  →  l'arbre cède  →  tout le reste
    mains nues             bois 2 + pierre 3 + corde 1
```

La corde vient de la fibre, et **la cueillette reste au geste nu** — c'est ce qui garde la couche 1 ouverte au survivant nu.

---

## Les règles

### Le verrou

- **G1 — Le bois et la pierre exigent au moins l'outil de FORTUNE.** `tree`, `rock` et `bloc` passent de `minTool: 'none'` à `'crude'` ; `old_tree`, `quarry`, `iron_vein`, `coal_seam` et `rubble` gardent leur `'basic'` (trois pierres ficelées ne valent pas une forge — `craft-fortune` C5, intact).
- **G2 — LA CUEILLETTE N'EST PAS TOUCHÉE.** Fibre, baies, champignons, tourbe, cendre, sel des fumerolles, vers : rien ne change. C'est le périmètre qu'Alexis a tranché, et il tient une raison de fond : toute corde coûte 3 fibres, donc gater la fibre fermerait l'arbre d'outils sur lui-même. L'opposition devient lisible — **ce qui se cueille se prend à la main, ce qui s'arrache exige un outil**.
- **G3 — Le glanage est un NŒUD, pas une entité neuve.** `branche_au_sol` (donne `wood`) et `pierre_au_sol` (donne `stone`) : `stock: 1`, `tool: null`, `minTool: 'none'`, `blockHalfSub: 0`. Un ramassage, et il n'y a plus rien. Le registre porte déjà tout ce qu'il faut — récolte, snapshot, rendu, encyclopédie, persistance et corvées PNJ en découlent sans plomberie. Une entité « objet au sol » aurait coûté un tableau de `SimState`, le protocole, une couche client et une migration de sauvegarde pour le même résultat à l'écran.
  - **NON renouvelables**, et c'est une décision : `renewable` exempte de « rien ne repousse dans l'emprise d'un village » (`defriche.ts`) — une pierre au sol renouvelable donnerait un filet de pierre infini dans sa propre cour, contre *« ce qui s'extrait ne revient pas »*. Hors village, elles repoussent comme tout le reste : personne ne peut s'enfermer dehors.
  - **Pas `vivant`** non plus : une branche morte est déjà tombée. Le gel n'a plus rien à lui prendre, et la cendre ne la fait pas tomber une seconde fois.
- **G4 — Le refus NOMME l'outil qui manque.** Il disait « il faut une pioche en main » pour tout nœud abordé les mains vides — inoffensif tant que seuls des nœuds de minage étaient gatés, une impasse dès que l'ARBRE l'est. La famille du nœud (`NodeDef.tool`) décide du mot : hache, pioche, canne, couteau. Côté client, un nœud hors d'atteinte se **grise** (`recolte.md` G4/G5) : un clic sans effet à la minute 1 se lit comme un bug.

### Le semis

- **G5 — Le glanage est ANCRÉ sur un nœud parent, jamais semé à plat.** Une chance par arbre (→ branche) et par rocher (→ pierre) ; le butin se pose sur une tuile VOISINE libre, jamais sur le parent (qui est occupé, et souvent bloquant). On se baisse À CÔTÉ.
  - L'ancrage est le cœur du geste : le butin se cherche **là où l'œil l'attend**, au pied de ce qu'on ne sait pas encore entamer. Un semis indépendant aurait saupoudré des branches sur le pré nu et n'aurait rien appris au joueur.
  - Il se pose **au sec** (`terrainAdmet`) et jamais sur une sente ni une rampe de seuil (`t0-exploration` R18, `worldgen` R10.3).
- **G6 — La passe est en QUEUE, et son tirage est positionnel.** Elle lit toutes les passes de bois et de pierre, donc elle vient après elles — mais avant la pêche, dont la spec exige les ids en queue (`peche.md` P5). Aucun conflit possible : un coin de pêche est sur l'eau, le glanage au sec. Elle ne consomme aucun flux RNG (`hash2` sur la tuile du parent, sel `'GLAN'`) : **aucune passe d'avant ne bouge d'un nœud**. Ce qui change est le COMPTE total, que les gardes de budget mesurent.

### Le village

- **G7 — Les PNJ ont le MÊME verrou que le joueur** (branche ① du choix posé à Alexis le 2026-08-25). Ils récoltaient à mains nues à ×1, et rien ne leur donnait d'outil : gater sans rien d'autre aurait éteint en silence les corvées de bois et de pierre **et le défrichement**, dont le budget est déjà le plus tendu du chantier.
- **G8 — Le village FOURNIT l'outil : en poche → au grenier → sinon on le façonne.** `ensureOutil` généralise le patron qu'`ensurePickaxe` tenait déjà pour la carrière, et il tresse LA CORDE en chemin quand elle manque — sans quoi un village qui a la fibre et pas la corde échouait en boucle sur le hachereau. Le **défrichement** y passe aussi : défricher, c'est abattre.
- **G8bis — DEUX BORNES DE COÛT, et il faut les deux** (mesurées, pas supposées). Un nœud de glanage porte UNE unité : une recherche de chemin par bûche, là où un arbre en coûte une pour dix — et le plus proche RECULE à chaque prise. ① la **PORTÉE** (`NPC_GLANAGE_PORTEE`, 40 tuiles) : on ne traverse pas le pays pour une brindille ; ② la **CIBLE** (`BOIS_D_AMORCAGE` / `PIERRE_D_AMORCAGE`, 5 chacune) : on glane le prix de l'OUTIL, jamais le stock du chantier. *Livré sans elles, le banc dérivait de 1,33 à 64,5 ms/tick sur une journée (`findPath` à 35 % du CPU) et le seuil de famine passait de 10 à 11 ; avec, le tick reste plat (0,59-0,93) et le banc repasse au vert.*
- **G9 — Deux corvées de glanage, postées EN REMPLACEMENT et jamais en plus.** `glaner_bois` et `glaner_pierre` n'existent que quand le village ne peut fournir aucun outil de la famille (`outilTenable` : porté par un membre, au grenier, ou taillable du stock — corde comprise). Un village outillé n'envoie personne ramasser des brindilles : il abat. Elles priment sur le bois et la pierre (elles les débloquent) et cèdent à la cueillette (un village qui glane doit quand même manger).
  - Leur quota est un nombre de **NŒUDS**, pas de coups (`NPC_GLANAGE_CARRY` = 3) : chaque objet au sol en porte un seul.
  - `PIERRE_D_AMORCAGE` (5 = 3 pour le hachereau + 2 pour la pioche) existe parce que la cible de pierre ordinaire vaut ZÉRO tant qu'aucun chantier n'en demande : sans ce plancher, un village sans pioche n'aurait aucune raison de ramasser un caillou, et resterait sans hache pour l'éternité.

### Ce que ça change au barème, en creux

- **G10 — `TOOL_YIELD.none` (×1) devient inatteignable sur le bois et la pierre.** La baseline du bois est désormais le rendement de FORTUNE (×2). La marche « mains nues » de la rampe d'outils n'existe plus ; celle qui compte, maintenant, est *rien → deux*.

---

## Critères d'acceptation

*(`packages/sim/src/glanage.test.ts` — 14 tests. Le verrou est éprouvé à TROIS étages, et il faut les trois : la RÈGLE, le GESTE, et le MONDE. Les deux premiers passeraient très bien sur un monde où le glanage n'existe nulle part.)*

- **A1** — Sur TOUT le domaine de `NODE_DEFS` : tout ce qui rend `wood` ou `stone` exige au moins `crude`, sauf les deux nœuds de glanage, qui n'exigent rien. Balayage exhaustif, pas trois cas choisis.
- **A2 / A3** — L'arbre refuse la main nue (« il faut une hache en main ») et cède au hachereau ; le rocher refuse (« il faut une pioche en main ») et cède à la pioche de fortune ; **le filon, lui, la refuse toujours** — le verrou du bois n'a pas dilué celui du fer.
- **A4** — Fibre, baies, champignons : aucun refus, aucun changement.
- **A5** — Le glanage se prend les mains vides, en un geste, et il n'en reste rien (`stock` 0).
- **A6** — Les deux nœuds ne bloquent pas, ne sont pas `renewable`, ne sont pas `vivant`.
- **A7** — Une pierre ne donne pas de `graine` : le butin d'herboriste (`forageBounty`) est désormais réservé au VÉGÉTAL.
- **A8 — LA GARDE D'ATTEIGNABILITÉ, et c'est celle qui compte.** Depuis les tuiles où l'on NAÎT (`pointsDeSpawn`), de quoi tailler le premier outil (2 bois + 3 pierres) se trouve dans un rayon marchable. Rayon **écrit** (120 tuiles ≈ 30 s de marche), jamais dérivé de `GLANAGE_CHANCE`. *Posée d'abord à 80, elle a rougi sur le pire spawn de la graine 7 — 1 pierre pour les 3 exigées : elle est au-dessus du pire cas MESURÉ, pas du cas moyen.*
- **A9 / A9bis** — Le semis : tout nœud de glanage a un parent de SA matière dans son 8-voisinage, il est au sec, hors sente et hors rampe — sur trois graines du monde joué, et il en existe ; et il est déterministe, au nœud près.
- **A10** — Un village sans outil ni glanage POSTE `glaner_bois` et **jamais** `gather_wood` : sinon, un refus toutes les trente secondes, en silence.
- **A11 — LA GARDE DE COÛT.** Un glanage au-delà de `NPC_GLANAGE_PORTEE` n'envoie personne : la corvée quitte le tableau. *Livrée sans elle, la version du matin dérivait de 1,33 à **64,5 ms/tick** sur une journée de banc — `findPath` à 35 % du CPU. Un nœud de glanage porte UNE unité, donc une recherche de chemin par bûche, et le plus proche recule à chaque prise.*
- **A11bis — Le RETOUR au grenier n'est pas une corvée outillée.** Une hache qui casse pendant que le PNJ rentre ne doit pas tuer sa corvée : sa charge arriverait avec 28× de retard, par un repli d'oisiveté. *Le délai est ce qu'on affirme (13 ticks contre 368, mesuré des deux côtés) — « le bois est arrivé » serait vert avec ET sans le correctif.*
- **A12 — La boucle entière, côté village** : un village nu, du glanage par terre → il ramasse, il tresse, il taille un hachereau, et l'arbre finit par tomber. Si n'importe quel maillon manquait (la corvée, la corde d'`ensureOutil`, le verrou du défrichement), l'arbre resterait debout et le grenier vide.
- **A13** — Le bot headless (`bot.test.ts`) rejoue la rampe entière au bit près : refus de l'arbre nu → glanage → corde → hachereau → l'arbre cède à ×2, sans qu'aucune structure n'existe.
- **A14** — Le banc de session solo (`session.test.ts`) s'ouvre par le glanage et reste jouable : ramasser, tailler, couper, faire du feu, cuisiner, manger.
- **A15 — LE REFUS SE VOIT, et ça se vérifie DANS LE JEU** (`pnpm smoke --dev --scenario glanage`) : mains vides, un vrai clic sur un vrai arbre → le bandeau du HUD dit « il faut une hache en main » et le sac reste vide. Sans ce relevé, l'objet le plus évident de l'écran serait un no-op silencieux à la minute 1. Le même scénario relève la distance du premier butin au spawn et en rend une capture.

---

## Le calibrage — ce qui reste à régler EN JOUANT

`CONTENU.GLANAGE_CHANCE` (0,06) est **le tempo de la première heure**, et il ne se règle pas à l'intuition (`recolte.md` G11). L'instrument est `node --import tsx tools/mesure-glanage.mts` ; le relevé du 2026-08-25 (graines 2026 / 7 / 42, monde joué) :

| graine | nœuds | glanage | part des parents | hachereau (médian / pire) |
|---|---|---|---|---|
| 2026 | 73 958 | 3 366 | 6,0 % de 56 450 | 46 / 77 tuiles |
| 7 | 76 044 | 3 477 | 6,0 % de 58 413 | 52 / 84 tuiles |
| 42 | 77 965 | 3 706 | 6,2 % de 59 886 | 45 / 83 tuiles |

Soit **un objet au sol tous les ~17 parents** — « occasionnel » à l'œil, ce que demandait la formulation d'Alexis (« faible chance ») — et **~20 s de marche en ligne droite** pour réunir le prix du premier outil depuis un vrai point de spawn. Trop bas, le jeu s'ouvre sur une fouille stérile ; trop haut, le verrou ne se sent pas. À reprendre en playtest.
