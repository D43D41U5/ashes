# Les Étages — le monde en couches superposées

> **⚑ STATUT au 2026-09-01 — LA TRANCHE VERTICALE EST COMPLÈTE : bâtie dans `/sim` le 2026-08-31, VISIBLE à l'écran depuis le 2026-09-01.** Décision d'Alexis, en séance : *« je tiens au fait que chaque "étage" soit une carte à part entière (toute ensemble est une superposition) »*, puis *« on est clairement sur du A2 »*. Ce document est écrit pour être repris **dans une autre fenêtre de contexte** : il contient donc tout ce qu'il faut pour commencer sans rien remesurer — la chaîne d'élimination déjà faite, les chiffres relevés le jour même, ce qui est déjà acquis dans le code, et la seule décision qui reste ouverte.
>
> **⚑ 2026-09-01 — LE RENDU EST FAIT : ON VOIT LE PLATEAU, ET ON Y MONTE.** Voir §12 (la sim) et §13 (le rendu). **CE QUI RESTE DEHORS** : la faune qui monterait, et le calibrage de `N`.

*Numérotation locale : **E-R\*** (règles), **E-A\*** (critères d'acceptation). Cette spec ne rouvre ni `worldgen.md` (le graphe de zones, les seuils, R32 rectiligne) ni les invariants d'architecture de `CLAUDE.md` — elle ajoute une dimension à la carte, elle ne change pas ce qu'est une carte.*

---

## 0. Ce qui ne bouge pas

- **`/sim` reste pur et déterministe au bit près.** Un étage est de la donnée de simulation, pas un objet de rendu. Aucune API Node, aucun `Math.random`, aucune fonction Math approximée.
- **`SimState` reste JSON-sérialisable** : pas de `Map`, pas de `Set`, pas de classe. Une grille creuse se sérialise donc en tableaux plats (voir E-R2).
- **Une simulation, pas deux jeux** : le solo (Worker) et le multi (Node) jouent le même `/sim`. Un étage ne peut pas être une affaire de client.
- **R32 tient** : ce qui est taillé reste rectiligne. Un étage n'a pas de courbe.
- **Le tick reste à `BALANCE.TICK_RATE_HZ`.** Aucune règle d'étage ne s'achète en temps de tick sans mesure (`tools/profil-tick.mts`).

## 1. La chaîne d'élimination — DÉJÀ FAITE, ne pas la refaire

*Alexis a arbitré trois fois le 2026-07-27, sur les caves. Ses contraintes, dans l'ordre où il les a posées :*

1. **Pas d'écran ni de temps de chargement.**
2. **On voit ce qui est à l'intérieur et réciproquement ; les interactions à distance traversent** le seuil.
3. **Le souterrain est souterrain : il n'apparaît pas sur la carte générale.**

| Modèle | Verdict |
|---|---|
| Carte-instance séparée (une `WorldMap` par étage, coordonnées propres) | **MORT** sur la contrainte 2 : deux espaces de coordonnées coupent toutes les boucles de distance de `/sim`. |
| Creusé À CÔTÉ sur la vraie grille (la cave est ailleurs sur la même carte) | **MORT** sur la contrainte 3 (objection d'Alexis). |
| **Superposé en coordonnées, stocké dans sa propre grille creuse, rendu par couche** | **SURVIT AUX TROIS.** C'est le modèle retenu. |

⚠ **Ne pas re-proposer les deux premiers.** Le coût de ce fil n'est pas dans le code, il est dans la chaîne d'élimination : la reperdre, c'est faire arbitrer deux fois les mêmes impasses.

## 2. Le modèle

**Un étage est une carte à part entière, superposée à la même grille de coordonnées.** L'étage 0 est le monde d'aujourd'hui : plein, dense, `map.terrain` inchangé. Les autres étages sont **creux** — ils ne couvrent qu'une partie du plan (un plateau de mesa, une galerie, un pont) — et vivent dans leur propre structure.

- **E-R1 — L'étage 0 ne change pas de forme.** `WorldMap.terrain` reste le tableau plein indexé `y * width + x`, et tout ce qui le lit aujourd'hui (`vignette.ts`, le champ de cendre, le bake du sol) continue de ne voir que lui, **sans une exception à écrire**. C'est ce qui satisfait la contrainte 3 par construction.
- **E-R2 — Un étage supérieur est une GRILLE CREUSE, JSON-sérialisable.** Représentation : deux tableaux plats parallèles (`idx: number[]` trié croissant, `terrain: number[]`), plus les bornes de sa boîte englobante. Pas de `Map`, pas d'objet par tuile. La lecture se fait par recherche dichotomique sur `idx` (ou par un index de ligne si la mesure l'exige — à mesurer, pas à supposer).
- **E-R3 — L'étage est un ENTIER signé.** 0 = le sol du monde ; +1, +2 = les plateaux ; −1, −2 = les souterrains. Le signe n'a aucune conséquence mécanique : il n'existe que pour que « au-dessus » et « en dessous » se disent.

## 3. Le centre de coût : la distance entre deux étages

**C'est ici que vit le bug silencieux, et nulle part ailleurs.**

- **E-R4 — `/sim` n'a AUJOURD'HUI ni ligne de vue ni occlusion.** Tout ce qui est « à distance » — le feu, la construction, l'interaction, la poursuite du loup, la découverte — est une **distance euclidienne sur `x,y`**. **MESURÉ le 2026-08-31 : 67 sites dans 24 fichiers** de `packages/sim/src` (c'était 22 boucles dans 12 fichiers quand le sujet a été différé le 2026-07-27 : **le chantier a doublé**).
- **E-R5 — UN SEUL ACCESSEUR, jamais une condition recopiée.** La règle est : *deux points s'atteignent s'ils sont **au même étage**, **ou** si l'un est à moins de `N` tuiles d'un **connecteur** qui les relie.* Elle s'écrit une fois, dans un helper nommé, et les 67 sites l'appellent. Une seconde écriture de la même règle, c'est le loup qui mord à travers la roche parce qu'un escalier est à côté.
- **E-R6 — La garde est EXHAUSTIVE, pas par cas choisis.** On balaie tout l'espace des paires (même étage / étages voisins / étages éloignés / avec et sans connecteur à portée) sur un vrai `SimState`, et l'on affirme **une seule propriété** : « atteignable ⟺ la règle E-R5 ». Le patron existe déjà dans le dépôt (`collision.test.ts`, série B).

## 4. Les connecteurs

- **E-R7 — Un connecteur est une DONNÉE, jamais une devinette.** Rampe, gueule de grotte, escalier : une entrée `{x, y, de: étage, vers: étage, type}` dans la carte. Rien ne se déduit du terrain — c'est la leçon de `murerLesAretes` prise à l'envers : la falaise se constate parce qu'elle est une conséquence, le connecteur se pose parce qu'il est une intention.
- **E-R8 — Le connecteur est le SEUL passage entre deux étages**, exactement comme le seuil est le seul passage entre deux zones. Le test destructif correspondant (E-A4) en dépend.
- **E-R9 — La connexité se GARANTIT, elle ne s'espère pas.** Tout étage doit être atteignable depuis l'étage 0 par au moins un connecteur, et la passe qui le vérifie **ouvre** ce qui est coupé plutôt que de raisonner par cas — le geste exact de `garantirLaConnexite` (`zonegen.ts`), à réutiliser.

## 5. Le rendu

- **E-R10 — L'étage voisin se compose en UNE image, il ne se pose pas objet par objet.** **MESURÉ le 2026-08-31 : 102 appels à `setDepth` dans 44 fichiers** de `packages/client/src/scenes`, et la scène monde n'a **aucun container** (c'était 65 dans 32 fichiers en juillet). Insérer une couche dans ce budget de profondeurs objet par objet est le chemin sûr vers la régression invisible. On compose donc l'étage voisin dans une **RenderTexture** dessinée comme un seul objet, à une profondeur unique — le patron du voile de nuit, qui vit déjà avec ce budget sans le toucher.
- **E-R11 — Le sol d'un étage réutilise la couche des pavés telle quelle.** `pave-layer` cuit déjà des chunks de 16 tuiles à la demande (MESURÉ, `sol-dessine` R12 : 5,5-10,9 ms par chunk, 30-40 chunks vivants, ~10 Mo de textures). Un étage supplémentaire est un second jeu de chunks : **budget à mesurer avant de le supposer tenable.**
- **E-R12 — La falaise sait déjà se dresser.** `render/cliff-art.ts` (livré le 2026-08-31) rend le dessus, la paroi de face et l'ombre portée, et `roleDeFalaise` **lit le rôle du terrain sans rien stocker**. Le bord d'un étage supérieur est exactement une paroi : rien à écrire de neuf pour qu'un plateau ait un flanc.

## 6. L'obscurité — le seul système vraiment neuf

- **E-R13 — « Il fait noir dedans à midi » n'existe pas aujourd'hui.** L'obscurité est **globale et horaire** : le voile de nuit est une RenderTexture plein écran que les feux creusent. Un intérieur qui doit être sombre en plein jour est un besoin neuf, et c'est le seul de cette spec.
- **E-R14 — `isSheltered(state, tx, ty)` existe déjà** et reconnaît les toits et l'empreinte de Grotte : c'est le prédicat de départ, pas un à écrire.

## 7. Le déterminisme

- **E-R15 — Un étage n'introduit aucun tirage dans un flux existant.** Toute génération d'étage prend un **chemin salé** neuf (`'ETAG'`, `'CONN'`…), comme les couches de la Stratigraphie. Un décompte d'entités qui change décale le flux et casse des tests sans rapport — c'est un piège documenté du dépôt.
- **E-R16 — Le replay traverse les étages.** `sim.test.ts`, `replay.test.ts` et `events.test.ts` doivent rester verts sans être amendés : même graine + mêmes inputs = même état ET même flux d'événements, étages compris.

## 8. Critères d'acceptation

- **E-A1 — Sérialisation** : un `SimState` avec deux étages passe `JSON.parse(JSON.stringify(s))` sans perte, et son `snapshot()` est identique avant/après.
- **E-A2 — Déterminisme** : même graine → mêmes étages, mêmes connecteurs, au bit près, sur 60 graines.
- **E-A3 — La règle de distance, exhaustive** : balayage de toutes les paires (étage, présence de connecteur, portée) sur un vrai monde ; une seule propriété affirmée (E-R5). **Zéro interaction ne traverse un plancher sans connecteur** — feu, construction, interaction, poursuite, découverte : les 67 sites sont couverts, et la garde échoue si un site nouveau apparaît sans passer par l'accesseur.
- **E-A4 — Test destructif** : on bouche tous les connecteurs d'un étage ; l'étage devient une île — aucune entité n'y entre ni n'en sort, aucune interaction ne le touche.
- **E-A5 — Connexité** : sur 60 graines, tout étage est atteignable depuis l'étage 0, et la plus grande composante marchable de l'étage 0 ne perd rien de plus que les tuiles que les étages lui prennent (le patron de mesure de `epaissirLesFalaises`, 2026-08-31 : la perte doit valoir EXACTEMENT les tuiles murées).
- **E-A6 — La carte générale ignore les étages** (contrainte 3) : `vignette.ts` et le champ de cendre rendent exactement la même image avec ou sans étages supérieurs.
- **E-A7 — Le rendu tient le budget** : chunks vivants, mémoire GPU et pire milliseconde de cuisson relevés au harnais smoke **avant** de fixer la profondeur d'affichage (le patron de `sol-dessine` R12).
- **E-A8 — Le tick ne se dégrade pas** : coût par tick mesuré avant/après (`tools/profil-tick.mts`), en temps CPU alterné dans un seul processus.

## 9. Le premier jalon — LA TRANCHE VERTICALE

**Ne pas commencer par les caves.** On éprouve les trois inconnues sur un cas visible, tenu, et déjà à moitié construit :

> **Un plateau de mesa qu'on parcourt.** Les buttes du monde joué ont, depuis le 2026-08-31, un chapeau de roche de 96 tuiles (`CREUX.AFFL_SOMMET_TUILES`) — infranchissable, avec sa paroi et son ombre. La tranche consiste à en faire un **étage +1 marchable**, atteint par **une rampe**, avec son sol, son décor et son horizon.

Ce qu'elle éprouve, dans l'ordre :
1. **La grille creuse** (E-R2) : le plateau est petit, la structure se remplit et se sérialise pour de vrai.
2. **L'accesseur d'étage** (E-R5) : un loup au pied de la mesa ne doit pas mordre celui qui est dessus — c'est la garde E-A3 sur un cas qu'on peut jouer.
3. **La composition par couche** (E-R10) : un seul étage voisin, une seule RenderTexture, un seul budget à mesurer.

Et elle laisse **hors périmètre**, délibérément : l'obscurité (E-R13, rien de couvert sur une mesa), les caves, les ponts, et les étages multiples.

## 10. Les décisions EN SUSPENS

- **✅ LA RÈGLE DE RÉVÉLATION AU SEUIL — TRANCHÉE le 2026-09-02 : c'est B1.** *Ce qu'on voit d'un étage voisin, c'est ce que la LUMIÈRE atteint.* Décision d'Alexis, consignée dans `docs/decisions.md`. Les deux autres branches sont MORTES et ne se rouvrent pas.
  - ⚠ **Ce que le choix engage** : **E-R13 cesse d'être optionnel.** L'obscurité du jeu est aujourd'hui globale et horaire ; B1 en fait le système dont dépend la VISIBILITÉ. Rien de souterrain — cave, galerie, gueule — ne se bâtit avant lui. `isSheltered` est le prédicat de départ (E-R14).
  - **B1 (le choix) — ce que la LUMIÈRE atteint.** Le jour perce de quelques tuiles, une torche va plus loin, la nuit la gueule est noire ; la profondeur se gagne. Une seule règle pour dedans, dehors et la nuit, et elle réutilise le voile de nuit. *Coût : l'éclairage devient un système dont dépend la visibilité, pas seulement l'ambiance.*
  - **B2 — tout l'étage d'en face, dès qu'un connecteur est en vue.** Le plus simple à écrire, le plus cher à dessiner. *Coût : ça tue la cave comme lieu.*
  - **B3 — rien avant d'entrer.** Le moins cher, et le seul qui n'oblige à rien côté distances. *Coût : il contredit la contrainte n°2 — si on le prend, c'est cette contrainte qu'on abandonne, et il faut l'écrire ici.*
- **La valeur de `N`** dans E-R5 (la portée d'un connecteur) : à calibrer en jouant, pas à poser.
- **L'élévation intrazone** (des terrasses qui pavent le plan à l'étage 0) reste une question SÉPARÉE. **MESURÉ le 2026-08-31** sur le monde joué : quantifier le champ en 3 paliers et murer les bords coûte **8,1 % du marchable** et fabrique **55 poches** ≥ 500 tuiles à recoudre. Ce n'est pas un défaut de réglage — une ligne de niveau est une courbe fermée, la murer découpe le plan, toujours. Si on la reprend, c'est avec des rampes, et la passe qui les perce existe déjà.

## 11. L'état du terrain au 2026-08-31 (ce sur quoi cette spec s'appuie)

*Les sondes qui ont produit tous les chiffres de ce document vivent sous `tools/__*` (hors dépôt, hors lint) et se relancent telles quelles : `__ou-est-la-falaise` (de quoi est faite la lisière), `__a26` (distance à une paroi), `__ou-est-le-mur` (depuis le spawn réel), `__intrazone` (le coût d'une terrasse et sa fragmentation), `__calibre-nues` (le balayage compte × écartement), `__topo` (la carte topographique en PNG), `__planche-monde` (le worldgen réel rendu par l'art réel), `__a13` (le budget de génération).*


Livré le jour même, et déjà dans l'arbre :

- **`render/cliff-art.ts`** — le dessus d'ardoise ET la paroi de face, en dessin PUR (listes de rectangles, testables sans navigateur), plus l'ombre portée. 9 gardes. Deux refus à l'œil ont fait le dessin : un motif qui se referme sur la tuile fait un mur de briques (les colonnes vivent sur 64 px, la phase venant de `tx`), et deux rangées à tons plats font une assise de grosses briques (la chute de valeur est continue sur huit crans).
- **`roleDeFalaise`** — le rôle d'une tuile se COMPTE (la roche sous soi), il ne se stocke pas. Une masse d'une tuile est arête et pied ; trois tuiles donnent un dessus et deux rangées de paroi. **C'est cette fonction qui donnera son flanc à un étage supérieur, sans une ligne de plus.**
- **`epaissirLesFalaises`** (`zonegen.ts`) — tout segment de roche tourné au SUD est complété à `RELIEF.PAROI_RANGEES + 1` = 3 tuiles. Idempotente (elle vise une épaisseur, elle n'ajoute pas des rangées). MESURÉ : −0,44 % de marchable, zéro poche isolée, couloirs de seuil intacts.
- **La convention « le nord est le haut »** — la projection n'admet qu'une paroi tournée vers le bas de l'écran. MESURÉ : le tier supérieur est au nord dans **71,4 %** des seuils, l'altitude érodée ne tranche pas (49,9 %).
- **La roche de lisière prend la grammaire de la falaise** (`cliff-layer.ts`) — MESURÉ : dans le monde joué, la lisière du pays est à **77 % d'eau et 23 % de roche, 0 % de falaise**. Seules les colonnes d'au moins 3 tuiles s'habillent : un accent isolé reste un caillou.
- **Les buttes NUES sont des MESAS** — **60** buttes sans minerai (`CREUX.AFFL_NUES`, écartement `AFFL_ECART_NUES` = 15 cellules) dont les 96 premières tuiles de croissance deviennent de la roche. ⚠ **Les affleurements à minerai restent PLATS** : les coiffer a fait rougir trois contrats justes (la butte est une composante connexe de pierrier propagée depuis son sommet ; la pierre de taille se range par hauteur depuis l'échine ; le remplissage de la boîte a un plancher). *On marche sur une mine, on contourne une mesa.* MESURÉ : la garde **A26** passe de **53,3 % à 97,6 / 94,9 / 96,7 %** sur trois graines, la première paroi depuis le spawn tombe de **338 à 76 / 77 / 33 tuiles**, et la connexité ne bouge pas (99,38 %).

---

## 12. Ce qui est BÂTI (2026-08-31) — et ce qui ne l'est pas

*Le jalon §9 côté simulation. Le rendu (§5) n'est pas commencé : le plateau existe, on y monte, le loup en tient compte — **et rien ne se voit encore à l'écran**.*

### Les fichiers

| Où | Quoi |
|---|---|
| `packages/sim/src/etages.ts` | **NEUF.** `EtageCreux`, `Connecteur`, et les six accesseurs. La règle E-R5 y vit **une seule fois**. |
| `packages/sim/src/map.ts` | Deux champs ADDITIFS : `etages?`, `connecteurs?`. Omis quand le pays n'en porte pas. |
| `packages/sim/src/zonegen.ts` | La passe des buttes nues rend aussi ses `plateaux` ; l'étage +1 et ses rampes s'assemblent après. |
| `packages/sim/src/collision.ts` | `MoveWorld.etages?`, consulté au **point unique** `terrainBloque` (le corps historique devient `terrainBloqueAuSol`). |
| `packages/sim/src/sim.ts` | `Entity.etage?` (absent ≡ 0) et le pas qui traverse : `etagesDuPas` avant, `etageApresLePas` après. |
| `packages/sim/src/faune.ts` | **Le premier appelant réel** : `chooseQuarry` refuse une proie qu'un plancher sépare. |
| `packages/sim/src/balance.ts` | `ETAGE_PORTEE_CONNECTEUR` = 3 — **le `N` de E-R5, PROVISOIRE et non calibré**. |
| `packages/sim/src/etages.test.ts` | **NEUF.** 20 gardes : E-A1 à E-A6, plus le pas, plus le périmètre. |

### Les trois décisions de forme que le code a dû prendre

1. **La tuile de la rampe appartient aux DEUX étages.** C'est ce qui fait d'une rampe une rampe — le sol du dessus qui descend rejoindre celui du dessous — et surtout ce qui permet de basculer d'étage **sans repeindre une seule tuile de l'étage 0**. Le chapeau reste `TERRAIN_ROCK` au sol ; *on marche sur une mine, on contourne une mesa* tient encore, mot pour mot. E-A6 et la garde A26 sortent de là intactes, gratuitement.
2. **Un seul étage +1 pour tout le pays**, troué, et non un étage par mesa. Un étage est une CARTE, pas un lieu : cinquante buttes qui sont toutes « un cran plus haut », c'est un étage +1 percé de cinquante taches.
3. **La rampe s'élit au SUD**, départage à l'ouest. Ce n'est pas un hasard rendu déterministe : c'est « le nord est le haut » (la projection n'admet qu'une paroi tournée vers le bas de l'écran) — une rampe au nord serait une rampe qu'on ne verrait jamais monter. **Aucun tirage** : le flux RNG n'est pas touché d'un bit, E-R15 est tenu sans même avoir besoin d'un chemin salé.

### Ce qui a été MESURÉ

- **Le monde joué porte ses plateaux** : **50 / 53 / 52 / 44 / 51** mesas (graines 2026 / 7 / 4242 / 99 / 1234), 96 tuiles de chapeau + une rampe de **2,94 tuiles en moyenne** chacune, soit ~5 000 tuiles à l'étage +1. **Connecteurs valides : 100 %** — chacun est marchable au sol ET à +1.
- **Aucune mesa n'est perdue en chemin.** MESURÉ en comptant les composantes connexes de roche de 96 tuiles (les chapeaux réellement poussés) et en les confrontant aux étages émis : **chapeaux poussés = plateaux émis, exactement, sur trois graines** — zéro butte écartée faute de rampe. L'écart au réglage (`AFFL_NUES` = 60) est en AMONT, dans la passe des buttes qui s'arrête quand le pays n'a plus de cellule libre : c'est le comportement d'avant les étages.
- **⚠ LA RAMPE A DÛ ÊTRE ÉLARGIE, et c'est une correction MESURÉE.** À une tuile, le semis des nœuds (`placeZoneNodes`, qui tourne APRÈS le worldgen et ne peut rien savoir des rampes) posait un rocher, un arbre ou une carrière **sur la porte** : **0 / 1 / 3 / 1** rampes murées (graines 2026 / 7 / 4242 / 99), et un nœud bloquant scelle un passage d'une tuile pour un corps de 0,75 — E-R9 tombait en silence, sur une mesa sur cinquante. `CREUX.RAMPE_LARGEUR` = 3 referme le trou : **zéro mesa scellée sur cinq graines**, compté par COMPOSANTE de l'étage (une rampe de trois tuiles a trois portes ; il suffit qu'une reste ouverte). La garde correspondante vit dans `etages.test.ts`. *On a élargi plutôt que de retirer des tuiles au semis : retirer aurait changé le décompte des nœuds, donc le flux RNG, donc des tests sans rapport.*
- **La carte générale ne bouge pas** : `renderVignette` rend une image identique **au pixel près** avec et sans les étages (E-A6, gardé).
- **E-A3, exhaustive** : plus de 100 000 paires ordonnées × 3 étages × 2 mondes (avec et sans rampe), une seule propriété affirmée. **Sabotage vérifié dans les deux sens** — `return true` fait rougir 6 gardes, `return false` (la clause du connecteur retirée) en fait rougir 2 — et la prémisse (au sol, le même loup à la même distance choisit bien sa proie) reste verte. Une garde qui ne peut pas échouer ne mesure rien.

### Le défaut que la revue a trouvé, et qui n'était visible d'aucune garde

**Mourir sur un plateau est le chemin ORDINAIRE vers la mesa** — les loups n'y montent pas, c'est le refuge évident. Or trois chemins REPOSENT un corps hors du pas : le respawn au Feu (`combat.ts`), la téléportation de debug (`debug.ts`), la berge de la glace rompue (`gel.ts`). Aucun ne touchait l'étage. Le ressuscité arrivait donc au village **encore marqué étage +1**, dans un monde où rien n'est marchable à cet étage-là : toutes ses tuiles bloquées, **figé sur place, sans un mot** — et invisible aux loups, puisqu'un plancher les en séparait.

Deux corrections, l'une par prudence et l'autre par principe : les trois sites effacent l'étage (*on ne fabrique pas l'état faux pour le corriger après*), et `etageApresLePas` retombe désormais sur **0** au lieu de garder l'étage courant — **le sol existe toujours, on ne peut pas n'être nulle part**. Ce repli ne se déclenche sur aucun pas réel : la collision aurait refusé d'y aller.

⚠ Les 22 premières gardes montaient toutes sur le plateau **en marchant** : aucune ne pouvait voir ce défaut. La 23ᵉ repose le corps à la main, et elle rougit sans le correctif (vérifié).

### Ce que le CLIENT sait déjà, et ce qu'il ne sait pas

L'`etage` d'un corps **traverse le réseau sans une ligne de protocole à écrire** : `SnapshotMessage.entities` porte l'`Entity` de /sim, et le champ est optionnel. `WorldScene` s'en sert pour une seule chose, mais elle est indispensable — **la PRÉDICTION LOCALE** (invariant n°3 : le client prédit sa propre position en rejouant `moveAvatar`). Sans elle, le client jugerait le chapeau infranchissable là où l'autorité le franchit, et chaque pas vers le plateau serait un rollback visible. `predictionWorld()` calcule donc les mêmes `etages` que `sim.ts`, à partir de l'étage que l'autorité lui dit (`reconcile`) — exactement le raisonnement du gel, deux lignes plus haut dans la même fonction.

Le RESTE du client ne sait rien : **rien ne dessine encore le plateau**. On y monte, on s'y déplace, le loup en tient compte — et l'on voit toujours le sol d'en bas.

### Le périmètre laissé DEHORS, sciemment

- **Tout le §5 — le rendu.** `map.etages` ne sort pas encore au snapshot, le client ne compose aucune couche, la RenderTexture de E-R10 n'existe pas, et **E-A7 (le budget de chunks) n'a donc rien à mesurer**. C'est le chantier suivant, et le plus gros.
- **La faune reste au sol.** `moveToward` ne passe pas par `etagesDuPas` : une bête n'a jamais d'`etage`. C'est cohérent avec le jalon (*« un loup au pied de la mesa ne doit pas mordre celui qui est dessus »*) mais cela veut dire qu'un plateau est, pour l'instant, un refuge parfait. Une garde le DIT plutôt que de le taire.
- ~~**Un seul appelant sur les 67 sites.**~~ **SOLDÉ le 2026-09-02** — voir §16. De 2 sites à 18, et **E-A3 est désormais affirmée**, par sept gardes COMPORTEMENTALES (deux corps à une tuile l'un de l'autre, séparés par un plancher, hors de portée du connecteur) : la proie d'un monstre, la frappe, le dépeçage, la démolition, dix gestes de bras de `village.ts`, l'enseignement d'une station, le ramassage d'une pile, le bandeau du rôdeur. Restent volontairement DEHORS, avec leur raison : une **secousse au sol** (`sens.ts`) traverse la roche pour de vrai, et la **foudre** vient du ciel.
- **`N` n'est pas calibré**, et E-A8 n'a pas été profilé au `profil-tick` : le coût ajouté est un `===` par paire et une recherche linéaire sur ~50 connecteurs par joueur et par tick. Un ordre de grandeur, pas une mesure.
- **§10 reste §10** : la règle de révélation au seuil n'est ni prise ni contournée — une mesa n'a pas d'intérieur, il n'y a rien à révéler.

---

## 13. Le RENDU (2026-09-01) — on voit le plateau, et l'on y monte

*§5 est livré. La preuve est une capture, pas une affirmation : `SMOKE_URL=… pnpm smoke --dev --scenario mesa` téléporte à la mesa la plus proche du spawn (291,106 sur la graine 2026, relevée par `tools/__rampe-proche.mts`), photographie le pied, la rampe, le dessus et la nuit, **et fait monter le joueur pour de vrai** — `✓ la montée : étage 0 → 1`.*

### Ce qu'il a fallu, et ce qu'il n'a PAS fallu

**Rien du tout pour le flanc** — E-R12 disait vrai : le chapeau de mesa EST de la roche à l'étage 0, `roleDeFalaise` en tire déjà sa paroi, son liseré et son ombre portée. **CONSTATÉ à la première capture, avant d'écrire une ligne d'art** : la butte avait déjà son mur. Elle avait aussi son défaut, et il était entier — *elle se lisait comme un TROU*. Une masse d'ardoise sombre au milieu d'un pré clair ne monte pas, elle creuse ; et rien n'y montrait d'ouverture.

**Deux dessins**, donc, et ils disent la même chose de deux façons :

| | |
|---|---|
| `render/plateau-art.ts` | PUR (`RectArt[]`, 10 gardes) : le sol du plateau (8 masques × 2 semis) et la rampe (3 rangées × 4 joues). |
| `scenes/world/etage-layer.ts` | Le pendant de `cliff-layer` : pool de sprites bornés à la vue, deux profondeurs (`+0,33` le sol, `+0,34` l'entaille). |

### Les deux refus à l'œil qui ont fait le dessin

1. **LA VALEUR DIT LA HAUTEUR — pas la forme.** Le premier jet posait sur le chapeau un gravier de la famille de l'éboulis (`0x8e8a81`). À l'écran, **la mesa ne se soulevait pas d'un pouce** : une butte nue est CEINTE de cette même jupe de pierrier (`TERRAIN_COLORS[9]` = `0x96928a`), et un dessus plus sombre que sa jupe n'est pas une hauteur, c'est la même nappe. La règle qui manquait : *le dessus d'une butte est la chose la plus CLAIRE du cadre, parce que c'est la seule surface qui regarde le ciel sans rien au-dessus d'elle.* Le plateau garde donc la teinte FROIDE de l'ardoise (c'est la même roche que sa paroi, et le joueur doit le lire) et passe **au-dessus** de la jupe en valeur. Trois valeurs, deux teintes : paroi sombre-froide · jupe moyenne-**chaude** · dessus clair-froid.
2. **UNE MARCHE A UN NEZ.** La rampe n'était d'abord qu'une bande qui s'assombrit vers le bas, coupée d'une ligne sombre tous les sept pixels : elle rendait un **grillage**. À plat, une rayure n'a pas de sens de montée. Une marche se lit par une PAIRE — la contremarche dans l'ombre, et juste au-dessus le nez qui prend le jour ; c'est ce couple, et lui seul, qui dit d'où vient la lumière donc où est le haut. Et les JOUES sont passées de 2 à 3 px : à deux, elles se noyaient dans la paroi voisine et la rampe rendait une dalle posée devant le mur au lieu d'une entaille dedans.

**Les deux sont gardés, et les deux gardes ont été SABOTÉES pour le prouver** : reposer l'ancienne palette fait rougir « le dessus doit dominer la jupe » (138 contre 156 de luminance) ; retirer le nez fait rougir « le nez au-dessus de la contremarche ».

### Trois écarts à la spec, assumés

- **E-R10 (la RenderTexture) : non.** Pool de sprites, comme `cliff-layer`. L'argument de E-R10 est le bon — *102 `setDepth` dans 44 fichiers, insérer une couche objet par objet est le chemin sûr vers la régression invisible* — mais le risque qu'il nomme est celui de N objets à N PROFONDEURS. Un pool dont tous les sprites partagent une constante n'ajoute qu'une profondeur, exactement comme une RT ; et `cliff-layer.ts` est né le jour même de cette mesure, avec deux constantes, sans rien toucher. Employer un autre mécanisme pour le SOL d'une roche que pour son FLANC aurait en prime fait diverger deux dessins du même objet.
- **E-R11 (les chunks de pavé) : sans objet.** Le sol du plateau est un sprite de 16 px, pas un chunk cuit. Le « second jeu de chunks » dont la spec demandait de mesurer le budget n'existe pas.
- **E-A7 (le budget) : RELEVÉ, et il est petit.** Sur la mesa de la graine 2026, plein cadre : **67 sprites de sol, 7 de rampe, et 47 chunks de pavés — le compte d'avant, inchangé.** Zéro octet de texture par plateau : les 28 images de 16×16 sont générées une fois au boot (`makePlateauTextures`, à côté de `makeCliffTextures`).

### Ce qui marchait déjà, vérifié plutôt que supposé

- **La NUIT couvre le plateau** : le voile vit à `AMBIENT_DEPTH_LIT` (8), très au-dessus du sol du plateau (−0,67). Capture `mesa-nuit.png` — le plateau s'assombrit comme le reste et reste plus clair que sa paroi, ce qui est juste (une roche pâle sous la lune).
- **La PRÉDICTION CLIENT suit** (livrée avec la sim le 2026-08-31) : sans elle, chaque pas sur la rampe aurait été un rollback, puisque le client aurait jugé le chapeau infranchissable là où l'autorité le franchit.

### Le troisième et le quatrième refus à l'œil — *« pourquoi la butte semble métallique ? »*

**③ LE GRAIN SE MESURE EN RELATIF, PAS EN ABSOLU.** MESURÉ sur le dessin au moment de la question : le plateau rendait **2,9 % de contraste relatif** (écart-type 4,8 sur une luminance de 167) quand l'ardoise qu'il remplace en fait **5,4 %** (3,9 sur 73) et la paroi **24 %**. La faute n'était pas le grain — il n'avait pas bougé — c'était la VALEUR : en montant de 73 à 167 sans monter le grain, j'avais divisé par deux la texture PERÇUE. Ajoutez la saturation la plus basse du cadre (**8,4 %** : j'avais éclairci en tirant vers le BLANC, ce qui désature) et l'absence totale de variation au-delà de la tuile — 96 tuiles d'aplat identique — et l'on obtient la signature exacte d'une tôle : lisse, claire, neutre, bordée d'un liseré net.

Trois gestes, tous dans `plateau-art.ts` : grain à contraste relatif constant (±13 % au lieu de ±6, trois fois plus dense), re-saturation vers le violet de la roche (**13,5 %**, dans la fourchette de l'ardoise) au lieu du blanc, et une structure de **période 4 tuiles** — la recette des colonnes de paroi. Après : **6,5 % de contraste relatif**, entre l'ardoise (5,4 %) et la paroi (24 %).

**④ LA VARIATION D'UNE SURFACE SE FAIT EN TACHES DE VALEUR, PAS EN LIGNES.** Premier essai de structure : un RÉSEAU de fissures longues, à angles droits, chacune bordée d'une lèvre claire. Le métal avait disparu — remplacé par un **labyrinthe**. Trois fautes cumulées : des segments de 30 à 60 px se lisent comme des TRAITS TRACÉS et non comme de la roche fendue ; une lèvre claire des deux côtés d'un trait sombre n'ouvre pas, elle EMBOSSE ; et dix segments par période font une grille, qui se répète. Remplacé par un damier mou de plaques à ±4 % (`tacheDe`) plus **cinq** fentes courtes sans lèvre. Les lignes sont des objets : elles attirent l'œil, il faut alors qu'elles veuillent dire quelque chose.

Les deux sont gardés (`plateau-art.test.ts` : contraste relatif ≥ celui de l'ardoise, saturation ≥ celle de l'ardoise, et chaque phase de la période a son propre cœur), et la garde a été **sabotée** avec le premier jet : elle rougit à 1,3 % contre 5,4 % attendus.

### Pourquoi il n'y a RIEN sur la butte

Question d'Alexis, et la réponse est architecturale — c'est **E-R1 qui fonctionne exactement comme spécifié, et son coût** :

> *tout ce qui lit `map.terrain` continue de ne voir que l'étage 0, **sans une exception à écrire***

Vérifié par grep : hors de son propre module, `map.etages` n'a que **DEUX** consommateurs dans tout le dépôt — `collision.ts` (la marchabilité) et `etage-layer.ts` (le dessin). Tout le reste lit `map.terrain[…]`, y voit le `TERRAIN_ROCK` du chapeau, et se tait :

| Système | Ce qu'il lit | Ce qu'il en conclut |
|---|---|---|
| les NŒUDS (`zone-content.ts`) | `terrainAt` | la roche n'est pas marchable → **0 nœud sur 4 950 tuiles d'étage**, mesuré sur 3 graines |
| le DÉCOR (`clutter-layer.ts`) | `map.terrain[idx]` | ⚠ **`TERRAIN_ROCK` n'est même pas dans la table du décor** — donc rien, jamais |
| la FAUNE, les LIEUX, la FLORE | `map.terrain` | idem |

⚠ **Et voici ce qui rend la chose réparable en une ligne** : l'étage +1 porte du `TERRAIN_SCREE`, **qui EST dans la table du décor** (`density: 0.4`, props `pebbles` + `lichen`). Le plateau a donc déjà, dans ses données, tout ce qu'il faut pour porter des cailloux et du lichen — c'est le LECTEUR qui regarde au mauvais étage. Faire lire `terrainAEtage(map, 1, …)` à `clutter-layer` sur les tuiles de plateau habillerait les cinquante mesas sans une ligne d'art. C'est le premier item de la suite, pas de cet incrément.

### Deux mesures de plus, prises après coup

- **L'entaille fire-t-elle vraiment ?** §13 dit « la rampe est une entaille dans le mur » ; la mesa photographiée montrait plutôt un escalier dans un rentrant. MESURÉ sur tout le pays (`tools/__rampe-mur.mts`, 3 graines) : **58 % des tuiles de rampe coupent 2 rangées de paroi**, 42 % n'ont aucun mur au-dessus d'elles (le bord sud d'un chapeau est dentelé, et les colonnes de flanc tombent souvent dans une échancrure). Le mécanisme fire donc sur la majorité, et là où il ne fire pas la rampe reste un tablier à marches qui se lit — mais **la phrase juste est « elle entaille le mur quand il y en a un »**, pas « toujours ».
- **La NEIGE : argumentée par les profondeurs, pas photographiée.** Le manteau vit à `GEL_DEPTH` (`GROUND_MAP_DEPTH + 0,30`) et **le dessus d'ardoise passait DÉJÀ dessus** (`+0,32`) avant que cette couche existe : la roche nue chasse la neige, c'est un choix d'art qui PRÉEXISTE au plateau, et le sol du plateau (`+0,33`) hérite exactement du même rapport — aucune régression introduite. ⚠ Le scénario n'a pas réussi à faire DÉPOSER de neige au sol dans son temps imparti (`debug_meteo` arme un front, encore faut-il qu'il passe et dépose) : la capture `mesa-froid.png` montre le plateau au jour 110, sous la reteinte de saison, **pas sous la neige**. À revoir le jour où l'on saura viser un jour enneigé depuis le harnais.

### Ce qui reste

- **La neige au sol n'a jamais été VUE sur un plateau** (voir ci-dessus) — argumentée, pas photographiée.
- **Les rangées SUD du chapeau sont dessinées en PAROI** (on les voit de face) alors qu'on y marche à +1. C'est la contrainte de la projection, pas un défaut : la rampe vient chercher le joueur EN MONTANT à travers ces rangées-là, et le sol ne se pose que sur les tuiles `dessus`. Un corps qui s'arrête pile sur ces deux rangées se dessine devant le mur.
- **La faune reste au sol** : un plateau est toujours un refuge parfait.

---

## 14. UNE CARTE EN TERRASSE (2026-09-01) — le terrain, les nœuds, la faune

> *« on doit appliquer le terrain, les nodes, POI etc. comme le reste de la map. on construit une map en terrasse hein ?! »* — Alexis, 2026-09-01.

**Il avait raison, et la spec le disait déjà** (E-R2 : *« un étage est une carte à part entière »*). Ce qui avait été livré était une SURFACE PEINTE : un `TERRAIN_SCREE` uniforme, que rien ne lisait sauf le dessin. Un aplat n'a rien à donner à personne — ni au décor, ni à la table de récolte, ni à la teinte de saison, qui lisent tous le terrain. C'est ce qui rendait la butte NUE.

### ① Le terrain (`terrainDeDessus`, `etages.ts`)

Un dessus de butte est un lieu **haut, sec et minéral** : de l'éboulis en fond, des blocs là où la roche perce, du genévrier dans les creux. Trois terrains que la vallée connaît déjà — donc trois entrées que le décor, la récolte et la saison savent déjà lire. Bruit POSITIONNEL sur chemin salé (`'ETAG'`) : **aucun tirage**, le flux de la partie n'est pas touché.

MESURÉ : **55 % éboulis · 24 % blocs · 21 % genévrier**, et **zéro plateau monochrome** sur 50-53 mesas. ⚠ Les seuils sont posés sur les **quantiles mesurés** du champ (q20 = 0,351, q75 = 0,619), pas sur des « parts » : écrits en parts, ils rendaient 82 % d'éboulis — `fbm2` se masse autour de 0,5 et ne remplit pas [0, 1]. Et `ECHELLE_TACHE` = **8 et non 5** : le sol d'étage n'a pas la fonte au pixel que `cuireChunk` donne au sol, donc des taches de 5 tuiles rendaient un damier de carrés aux bords francs.

### ② Le décor (`clutter-layer.ts`)

Une ligne : `sample` lit `terrainAEtage` là où il y a un étage. Le plateau porte enfin cailloux, lichen et buissons — **depuis la table qui existait déjà**, sans une ligne d'art neuve.

⚠ **AVEC SA CONTREPARTIE, et elle a été VUE avant d'être écrite** (Alexis : *« je vois du clutter de champs sur les falaises »*) : les `PAROI_RANGEES` dernières rangées d'un chapeau sont son BORD — la sim y laisse marcher, mais le rendu les montre **de face**, et le décor y semait genévrier et cailloux *sur le mur*, en apesanteur. Le décor de l'étage ne se pose donc que sur les tuiles `dessus`. C'est la MÊME règle qu'au semis des nœuds — *rien ne pousse sur la lèvre sud d'un plateau* — un seul fait de monde, deux conséquences qui tombent ensemble.

### ③ Les nœuds (`ResourceNode.etage`, `zone-content.ts`)

`ResourceNode` gagne son `etage` (absent ≡ 0, le pendant exact d'`Entity.etage`), et une passe APPENDUE sème sur l'étage depuis la MÊME table que le sol. MESURÉ : **~2 nœuds par mesa** (116 rock, 7 baies, 2 fibre sur la graine 2026) — un détour qui vaut deux pierres, pas une ferme. Le placement des villages ne bouge pas.

⚠ **LA CLÉ DE L'INDEX PORTE L'ÉTAGE** (`cleDeNoeud`), et c'était la marche à ne pas rater : `nodeIndexFor` gardait LE PREMIER nœud d'une tuile, or deux nœuds en partagent une désormais — le second devenait invisible, et tous les symptômes aval (un arbre qu'on ne peut pas couper, un bloc qui barre le mauvais plancher) auraient remonté ici en ayant l'air d'autre chose. Gardé par une garde dédiée.

Et la collision suit : `occupancyOf` n'indexe QUE le sol, les étages ont leur propre prédicat bâti à la demande (`makeIsBlockedAtEtage` — cinq mille tuiles, un `Set`, pas un index plein). La récolte devient le **deuxième appelant réel** de E-R5 : on ne mine plus le bloc du dessus depuis le pied de la butte.

### ④ La faune monte — **décision d'Alexis**, et c'est la plus lourde

Le plateau était un refuge parfait : récompense sans risque. Il ne l'est plus.

- **`moveToward`** (`monsters.ts`) prend `etagesDuPas`/`etageApresLePas`, exactement comme l'avatar : une bête sur une rampe atterrit des deux côtés et adopte l'étage où elle pose la patte.
- **L'A\* CHERCHE EN TROIS DIMENSIONS** (`findPath`) : l'espace est `(tx, ty, étage)`, et un pas d'étage se paie comme un pas de côté — **sur un connecteur et nulle part ailleurs** (E-R8). Les prédicats de blocage sont une famille bâtie PARESSEUSEMENT : une recherche qui reste au sol ne monte que l'index d'avant, au bit près.
- **La retenue traverse les planchers, l'ACQUISITION non.** Un loup ne vous CHOISIT pas à travers douze mètres de roche (E-R5 tient) ; celui qui vous tient déjà ne vous perd pas parce que vous avez monté une rampe — c'est la doctrine que `chooseQuarry` applique déjà à la furtivité et à la pluie. **Le plateau est un DÉTOUR, pas un sanctuaire** : le temps que la meute met à faire le tour est ce que la hauteur vous achète.

Gardé par une paire : *le loup qui vous tient prend la rampe* — et sa prémisse, *sans rampe il reste en bas*.

### Ce qui reste dehors

- **Les POI.** « etc. » était dans la demande, et un lieu bâti composé de `PIECES` à l'étage +1 touche la construction, la collision et le format de plan. C'est un chantier à part, pas un pli de celui-ci.
- **Le bâti**, pour la même raison : `bloquantAt` déclare explicitement que le bâti vit au sol, et le jour où l'on construira là-haut c'est `Structure` qui gagnera son `etage`.
- **Un décor propre à la PAROI** (petits pics de pierre, racines) — proposé par Alexis le 2026-09-01. La paroi nue se lit bien aujourd'hui ; c'est un ajout, pas un correctif.

---

## 15. LA FALAISE EST DE LA PIERRE (2026-09-01)

> *« essaye de faire en sorte que la falaise ait une couleur logique (pierre par défaut, terre rocailleuse si besoin) »*, puis *« et la texture aussi »* — Alexis.

### La couleur : dérivée, plus inventée

`cliff-art` posait treize littéraux d'une **ardoise froide et violette**, choisie explicitement pour n'avoir *« aucun parent dans les terrains »*. C'était le problème : une falaise EST de la roche, le jeu sait déjà de quelle couleur est sa roche (`TERRAIN_COLORS[TERRAIN_ROCK]` = `#6d6d70`), et **deux réponses à la même question finissent toujours par diverger**.

Toute la palette se dérive donc de la pierre par une seule fonction (`ton(rapport)`) : chaque ton garde son **rapport de valeur** — c'est lui qui fait le dessin, l'arête qui prend le jour, la chute de la paroi, le pied dans l'ombre — et prend la **teinte** de la pierre. Repeindre la roche du jeu repeint sa falaise, par construction. `TERRAIN_COLORS[23]` (le 1 px cuit sous les sprites) suit ; `SOL_BASE` du plateau aussi (même pierre, en plein jour : ×1,5).

⚠ **Et un rapport était FAUX depuis toujours** : la paroi partait à **1,43 × la base** quand le dessus vaut 1 — *le mur était plus clair que le plat qu'il porte*, ce qui est faux de toute surface au monde (un plan vertical ne voit qu'une moitié de ciel). Sous le violet sombre, personne ne le lisait ; sous la pierre, la mesa **perdait sa silhouette** — le haut du mur venait toucher la valeur du plateau. La paroi part maintenant SOUS le dessus (0,86) et tombe jusqu'au pied.

MESURÉ : dessus **108** · paroi **54** · plateau **163**. Trois marches nettes, une seule matière.

### La texture : une roche se fend, elle ne s'appareille pas

*« Et la texture aussi »* — et c'était visible dès la première capture en pierre : la paroi rendait un **appareillage de blocs de béton**. Deux causes, toutes deux invisibles sous l'ardoise sombre et criantes sous la pierre claire :

1. **La chute de valeur se faisait par CRANS de quatre pixels** — huit paliers plats empilés. C'est le défaut que le dessus avait déjà refusé une fois (*« deux rangées à tons plats font une assise de grosses briques »*), un cran plus bas : ce n'était plus la limite de tuile qui faisait le joint, c'était le palier. La chute est désormais **continue, une valeur par ligne de pixels** sur toute la hauteur de la paroi, à chute totale égale.
2. **Le joint vertical courait d'un bout à l'autre.** Croisé aux paliers, ça faisait une grille. **Une roche ne se fend pas au cordeau** : le joint s'interrompt par tronçons, tirés d'un hash positionnel.

⚠ **Une garde a dû être reformulée, et c'est la conséquence directe** : *« le pied s'assombrit en bas »* s'affirmait PIXEL PAR PIXEL, ce qui n'était vrai que parce que la fracture était continue. Un pixel du pied peut désormais être plus clair que celui de l'arête à la même abscisse — c'est le joint qui manque là, pas la chute qui s'inverse. Elle s'affirme sur la MOYENNE de la rangée : la seule mesure que la rupture ne perturbe pas.

De même, la garde anti-métal du plateau : sa moitié « saturation » comparait le plateau au dessus de falaise — **un étalon qui a bougé**, la pierre étant quasi neutre par nature (2,7 %). C'est le GRAIN qui porte désormais tout le refus du métal ; la clause de teinte affirme ce qui reste vrai et vérifiable — *la dérivation ne neutralise pas la pierre*, le rapport de canaux du plateau est celui de sa roche.

### « Terre rocailleuse si besoin »

Pas encore utile : la pierre neutre se détache du pré jaune, du vert et de l'éboulis pâle sans qu'on ait à la réchauffer. Le levier existe cependant en une ligne — `PIERRE` est une constante lue de `TERRAIN_COLORS`, et toute la falaise suit.

## 14. LE TRI (2026-09-01) — chaque étage est un monde qui se peint sur l'autre

*Constat d'Alexis : « je vois bizarrement l'arrière de la mesa… on le voit comme s'il était SUR la
mesa par transparence. L'idée c'est de traiter chaque étage indépendant et faire en sorte qu'on voie
tout ce qui est présent à l'étage courant quoi qu'il arrive. »*

- **E-R17 — Un étage est une STRATE de profondeur.** `strateDEtage(niveau)` (pas de 100 000) : on
  peint étage par étage, du bas vers le haut, et le tri en Y ne départage qu'à l'intérieur d'un
  étage. Ce n'est pas un choix de commodité : sur une échelle unique, le plancher de la tuile `ty`
  doit passer DEVANT un corps du bas dont les pieds sont en `ty`, et DERRIÈRE un corps du haut posé
  dessus, dont les pieds sont en `ty + 0,19` — un seul scalaire par rangée ne peut pas les deux.
- **E-R18 — Un plancher trie sur sa rangée LOGIQUE, pas sur la rangée où il est dessiné.** Le lift
  ne fait que le faire déborder vers le haut de l'écran ; sa masse pose ses pieds là où la carte la
  met. C'est la convention du houppier, et c'est ce qui trie juste un bord dentelé.
- **E-R19 — La PAROI ne monte pas dans la strate.** Elle est tournée vers le sud : tout ce qui la
  chevauche se tient devant elle. Elle prend `CLIFF_DEPTH`, celle de la falaise ordinaire — c'est la
  même roche, du même `cliff-art`. Idem pour la rampe (le grimpeur est encore à l'étage 0 tant que
  le connecteur n'a pas commuté) et pour l'ombre portée.
- **E-R20 — Le découvert ne part que vers le HAUT.** Un plancher ne s'efface que pour un corps d'un
  étage PLUS BAS que lui (`plateauAlpha`, la recette de `crownAlpha` avec sa portée propre : le
  centre dessiné d'une tuile capable de couvrir un corps est à ~1,2 tuile de lui, jamais six). Sur
  le plateau, on ne fond jamais le sol que l'on foule.
- **E-R21 — Ce qui quitte la bande du sol quitte le VOILE.** Le voile d'ambiance ne tinte que le
  fond (`AMBIENT_DEPTH_LIT` = 8) ; les sprites prennent leur nuit des paires `_lit`. Tout étage monté
  dans la bande de tri doit donc reposer sa nuit lui-même, **dérivée du voile**
  (`multiplicateurDuVoile`) et jamais écrite à côté de lui.
- **E-R22 — Tout ce qui se tient à un étage monte avec lui.** Corps, nœuds, décor : le dessin prend
  `decalageDEtage`, le tri prend `strateDEtage`. Deux nombres, jamais un.

### Le LIFT vaut `PAROI_RANGEES` (2), et pas un de plus

Abaissé de 3 à 2 le 2026-09-01. **Pas** pour rendre une tête au personnage collé à la façade nord :
son sprite fait 1,5 tuile et tient tout entier dans la bande masquée, à 3 comme à 2 — seul le fondu
le découvre. Le motif est de cohérence : une falaise ordinaire ne peint que `PAROI_RANGEES` rangées,
et les mesas en peignaient trois. Le mur reste sans trou, et c'est ce qui borne le nombre par le bas.

### E-R23 — Par la transparence on voit le vrai sol, mais JAMAIS l'intérieur de la masse

*Alexis, 2026-09-01 : « le socle de l'étage doit être noir » ; puis « que les tuiles à mon étage
qui correspondent à la base de l'étage ».* Un plancher fondu découvre deux natures d'étage 0, et
elles ne se traitent pas pareil :

- sous les `lift` rangées les plus au NORD : **le vrai sol**, que la masse cachait. Il est là, on
  le voit — c'est l'objet même du découvert.
- sous tout le reste : **la base de l'étage**, la roche qui le porte. Une pièce **opaque, quasi
  noire** (`SOCLE_TEINTE`, teinte multiplicative dérivée de la pierre, jamais un aplat : un noir pur
  ferait un trou découpé) vient la boucher.

Le prédicat est celui qui DÉFINIT l'étage, appliqué à la tuile `(tx, ty − lift)` — celle qui est
sous la pièce dessinée. Le socle trie sur la rangée **dessinée** (`TIE_SOCLE`, entre
`TIE_STRUCTURE` et `TIE_ACTOR`) quand le plancher trie sur la **logique** : les deux pièces d'une
même tuile encadrent le corps, l'une dessous, l'autre dessus.

⚠ **Le disque, lui, ne se resserre pas.** Réduit à l'emprise exacte du recouvrement, il donne une
lucarne à la taille d'un homme et l'on ne voit plus rien de ce qu'on approche. Le découvert est un
champ de vision, pas une découpe ; ce qui se règle finement, c'est ce qu'on voit PAR lui.

### E-R24 — Un étage cède d'un bloc : plancher, décor et nœuds

Un seul point de décision (`WorldScene`), une seule distance (`alphaDeDecouvert`), trois
consommateurs. Un contenu qui ne cède pas avec son plancher flotte, opaque, dans le creux que le
fondu vient d'ouvrir — constaté à la capture.

---

## 16. L'ÉTANCHÉITÉ ET L'OBSCURITÉ (2026-09-02)

### ① E-A3 est affirmée — l'accesseur a ses appelants

*« La règle s'écrit UNE FOIS, ici, et les sites l'APPELLENT »* (E-R5). Elle en avait **deux**. Elle en a **dix-huit**, et la garde n'est pas un décompte : `etages-etancheite.test.ts` pose deux corps **à une tuile l'un de l'autre**, séparés par un plancher et **hors de portée du connecteur**, puis demande à chaque système s'il les voit. Chaque cas porte son TÉMOIN (les deux corps au même étage) — sans lui, un système inerte passerait pour étanche. Les sept rougissent quand on rend `atteignableEntreEtages` à `return true`.

**Deux trous d'ÉTAT trouvés en chemin, et ils ne se voyaient d'aucune garde** :
- **`Corpse` n'avait pas d'étage.** On mourait sur un plateau, la dépouille appartenait au sol — et le rendu la posait deux tuiles trop bas, dans la strate d'en dessous. Le champ est le pendant exact d'`Entity.etage` et de `ResourceNode.etage` (absent ≡ 0), il traverse le protocole sans une ligne à écrire.
- **Ce qui se relève d'un cadavre n'héritait pas de son plancher.** Un Cendreux levé là-haut serait né *dans* la roche du chapeau : toutes ses tuiles bloquées, figé sur place, invisible à la règle d'étage. C'est mot pour mot le défaut que le repli d'`etageApresLePas` avait été écrit pour empêcher, un cran plus loin.

**`atteintLeSol(map, acteur, tx, ty)`** nomme le cas qui revient vingt fois — le bâti, les piles, les stations, les feux vivent tous à l'étage 0 (`collision.ts` le déclare). Ce n'est pas une seconde écriture de E-R5 : c'est l'accesseur avec ses deux derniers arguments déjà remplis. Le jour où l'on bâtira à un étage, `Structure` gagnera son champ et cette fonction un argument — en un seul endroit.

### ② E-R13 — la part du ciel : BÂTIE, GARDÉE, et DORMANTE

La branche **B1** (§10) engage l'obscurité locale : *« il fait noir dedans à midi »*. `partDuCiel(state, tx, ty)` la rend, dans [0, 1] : **1 à l'air libre** — donc le monde d'avant, au bit près — et décroissante avec la distance (Chebyshev) à la première tuile ouverte, bornée par `TEMPERATURE.CIEL_PENETRATION` = 4. Une DISTANCE et non un booléen : un couvert binaire serait la branche B3, écartée. Elle ne connaît ni le soleil ni l'heure, et c'est ce qui la rend composable — `clarteSurSoiAt` multiplie `clarteDuCiel` par elle, et la nuit une gueule est noire sans qu'on l'écrive.

⚠ **ELLE N'AVAIT AUCUN SUJET, ET C'EST EN LE MESURANT QU'ON A TROUVÉ POURQUOI.** MESURÉ sur trois graines : **0 tuile couverte** sur toute la carte. `isSheltered` (E-R14, écrit pour le FROID) ne reconnaît que deux choses : une structure `house` — que **le joueur** bâtit, il n'en naît aucune au worldgen — et l'empreinte d'un POI **`grotte`**, qui exige les zones `karst`/`gouffre`, **absentes du monde joué** (`MONDE_JOUE = 'racine'`). Et une maison réelle ne suffit pas : MESURÉ, le centre passe sous `NUIT.SEUIL_NOIR` à partir de **7 × 7 tuiles de `house`**, très au-delà de ce qu'on bâtit (1×1 → 0,80 ; 3×3 → 0,60 ; 5×5 → 0,40). **Le défaut était dans `isSheltered`, pas dans la loi** : la pièce **`roof`** — « Toit », `occupe: 'toit'`, posable au marteau pour une bûche, c'est-à-dire la seule pièce dont c'est le métier — n'y était pas. E-R14 affirmait pourtant qu'il *« reconnaît déjà les toits »*. Corrigé le 2026-09-02 par `roofAt`, qui existait : **le froid, la météo (R5) et la lumière** en dépendent du même coup, et couvrir une pièce assez grande la rend enfin sombre à midi. ⚠ **ET L'ÉCHAPPÉE R5 S'EST RÉVEILLÉE** : `meteo.test.ts` la déclarait *« dormante »* parce que les deux abris connus refusaient la pose par une AUTRE porte (la `house` occupe sa tuile, la Grotte est un landmark) — on ne pouvait donc jamais l'OBSERVER. Un `roof` est `bloque: 'non'` et `occupe: 'toit'` : il ne ferme ni l'une ni l'autre. **Un feu neuf prend désormais sous un toit, sous la pluie**, et une garde neuve le tient (sabotée-vérifiée). ⚠ Re-mesuré après le correctif : le monde joué reste à **0 tuile couverte** — aucun plan de POI ne pose de toit —, donc la loi ne bouge que pour ce qu'un JOUEUR bâtit. Reste que la CAVE demeure le vrai sujet de la loi — c'est elle que B1 débloque.

**E-A8, mesuré** (CPU alterné, un seul processus, médiane de trois passes, monde joué à 468 structures) : `partDuCiel` coûte **5,94 µs/appel** — 60 % de `clarteSurSoiAt` (9,94 µs) — **après** que le toit a ajouté son balayage à `isSheltered` (elle valait 3,16 µs avant). Par avatar et par tick, sur un budget de 50 ms : **0,012 %**. Le client la rappelle une fois par image, même ordre. ⚠ Le chiffre est celui d'un monde à 468 structures ; sur une carte BÂTIE (`gel.ts` en compte 772 et nomme `isSheltered` le prédicat le plus cher de son chemin), il monte proportionnellement — c'est le point à re-mesurer si `clarteSurSoiAt` sortait un jour du périmètre « avatars seulement ».

### ③ Ce qui reste

- **Le RENDU de l'obscurité** : `partDuCiel` est exportée et n'a pas encore de lecteur côté client. Le voile est plein écran et horaire ; le rendre local est le prochain morceau, et c'est lui qui fera VOIR E-R13.
- **E-A2 / E-A5 sur 60 graines**, et **E-A7** (le budget rendu au smoke).
- **Les caves, les ponts, les étages multiples, les POI et le bâti à +1** — hors du jalon, et la spec le dit depuis §14.

---

## 17. LA CAVE (2026-09-02) — le premier étage NÉGATIF

*« On est dehors, une gueule s'ouvre dans la paroi »* — §10 décrivait l'objet avant qu'il existe. Il ne se pose nulle part ailleurs : **il se creuse dans la mesa**. Une butte a déjà un chapeau de roche, une paroi tournée au sud (« le nord est le haut ») et une jupe où l'on marche. On lui ajoute **une gueule dans cette paroi** et **une salle à l'étage −1 sous son chapeau**. La mesa cesse d'avoir une seule réponse (*on la monte*) pour en avoir deux (*on la monte, ou on y entre*).

**Rien de neuf n'a été nécessaire dans le modèle** : la grille creuse (E-R2) était déjà un entier signé, `etagesDuPas`/`etageApresLePas` ne connaissent que « le plancher qui porte », la collision compose sur `etages`, et `atteignableEntreEtages` ne demande jamais le signe. C'est la preuve que le modèle du 2026-07-27 tenait : **le souterrain n'a coûté que sa géologie.**

- **`creuserLaCave`** (`zonegen.ts`) — la gueule est faite de tuiles de JUPE, comme la rampe et pour la même raison : un connecteur doit être marchable à l'étage 0. **Et elle fait DEUX tuiles de large** (Alexis, 2026-09-02 : *« la gueule de 2 ça me va »*) : une PAIRE `[ouest, est]` sur la même rangée, chacune marchable des deux côtés — une bouche d'une tuile se lisait de près seulement, et un seul rocher la murait. Elle s'élit **au sud puis à l'EST** (le hachage d'élection reste sur la tuile EST : les mêmes buttes s'ouvrent qu'avant), miroir du départage de la rampe (sud puis ouest) : les deux portes d'une butte s'écartent d'elles-mêmes, et **jamais sur une colonne de rampe** — `connecteurAt` rend le PREMIER connecteur d'une tuile, deux portes sur une tuile et l'une devient muette en silence. La salle croît sous le chapeau depuis les deux tuiles de roche qui suivent la gueule, par un parcours en largeur ordonné par index (deux moteurs JS rendent la même salle, au bit près).
- **`terrainDeCave`** (`etages.ts`) — le pendant de `terrainDeDessus`, et il dit l'inverse : un dessus reçoit le ciel et porte du genévrier ; **un dessous n'en reçoit aucun, rien n'y pousse**. Éboulis et blocs, sel `'CAVS'` distinct de `'ETAG'` — sans quoi une cave serait le calque exact du plateau qui la coiffe.
- **Réglages** (`CREUX`, avec leur générateur) : `CAVE_PART` = 0,25 et `CAVE_TUILES` = 40. Ce second doit **dépasser `TEMPERATURE.CIEL_PENETRATION` dans toutes les directions**, sinon le jour traverse la salle de part en part : une cave qu'on éclaire depuis le seuil n'est pas une cave, c'est un porche. Une salle trop petite n'est pas émise.
- **`partDuCiel` prend l'étage** — une seule loi, trois lectures : au-dessus du sol le ciel arrive entier (un plateau est à l'air libre) ; au sol, la distance à la première tuile découverte ; **sous la roche, la distance à la GUEULE**. C'est B1 au pied de la lettre.

**MESURÉ**, cinq graines : **8 à 19 caves** par monde (15 à 43 % des mesas), **42 tuiles** par salle (40 + les deux de sa gueule), gueule marchable des deux côtés sur **100 %** d'entre elles, **zéro tuile de l'étage 0 repeinte**, et **le flux du PRNG n'a pas bougé d'un bit** — le compte de nœuds, lui, baisse de ≤ 10 sur 60 000 par graine depuis que **les connecteurs sont stériles pour le semis** (`placeZoneNodes`, 2026-09-02) : le semis tourne APRÈS le worldgen, par hachage positionnel, et posait un rocher SUR la gueule de la graine 2026 (le joueur butait au seuil, la sim headless passait) et un arbre ET une branche sur celle de la graine 99 — une cave entièrement murée. Une porte est un passage, pas un jardin, au sol comme à l'étage.

**E-A5 a rougi, pour la bonne raison** : elle affirmait sa connexité sur l'étage +1 en supposant que TOUT connecteur l'ouvrait — vrai tant que les rampes étaient les seules portes du jeu. Elle balaie désormais **chaque étage avec SES portes**, ce qui est la propriété qu'on voulait dire depuis le début et qui ne redemandera rien au troisième palier.

### Le RENDU (2026-09-02) — on la voit, et E-R13 avec

- **Une strate ne dit pas une altitude, elle dit un ORDRE DE PEINTURE.** L'étage −1 se peint à **2 000 000**, au-dessus de tout ce que le monde d'en haut sait dessiner (houppiers 900 000, voile 1 100 000) et sous l'UI. C'est le *cull des étages au-dessus du regard*, et c'est aussi ce qui garde à la cave **son obscurité propre** — locale et sans heure : la laisser sous le voile plein écran l'assombrirait deux fois.
- **Un souterrain ne se décale pas** : `decalageDEtage` rend 0 pour les niveaux négatifs.
- **Le curseur déplie le lift** (`deplierLeLift`, `render/deplier-etage.ts`, 2026-09-02) : la conversion écran → monde du clic rend la tuile qu'on VOIT — celle du plateau, `LIFT_TUILES` rangées plus bas dans le monde qu'à l'écran — sinon la pierre d'une mesa se récoltait deux tuiles sous son image. L'étage +1 gagne le point d'écran (il se peint par-dessus), la rangée du milieu d'une rampe est la rampe, sous terre rien ne se déplie. Le lift libère les rangées qu'occupe la PAROI d'un plateau ; une cave n'en a pas, on la regarde d'aplomb.
- **Un seul interrupteur** (`EtageLayer.souterrain`) : **depuis dehors, une cave n'existe pas à l'écran** — le rendu dit ce que E-R1 dit de la carte. Dedans : une roche opaque plein écran, la salle par-dessus, chaque tuile teintée de sa propre clarté.
- **La gueule se dessine** — le négatif de la rampe (elle pose du noir où l'autre pose des marches), sur les mêmes rangées de paroi. Sans elle une cave est introuvable. ⚠ Elle exige une passe à part : la boucle de la couche ne visite que les tuiles de l'étage +1, et une gueule n'en est pas.
- **La torche éclaire la SALLE**, rayon 3 tuiles (la moitié d'un feu) — sinon on traverse une cave noire torche allumée et l'objet ne sert visiblement à rien. Et **le pourtour de la salle ne s'éteint jamais tout à fait** (0,3) : on donne la silhouette, jamais le contenu.

Captures : `scratchpad/cave/` — dehors (la butte, ses marches et son trou), le fond (noir, la forme seule), la torche (le halo).

### Le VOILE (2026-09-02, seconde passe) — la lumière est un champ

- **Une RenderTexture plein écran en MULTIPLY au-dessus de tout l'étage −1** (`cave-veil.ts`), percée par trois lumières et pas une de plus : **le jour** par la gueule (la géométrie de `partDuCiel` — carré arrondi, chute `1 − d/(P+1)` — à la force de l'heure ; la loi reste dans /sim, ici on la montre), **la torche** (3 tuiles, bat par l'alpha jamais par la taille), **soi** (1,25 tuile : le corps reste lisible, rien autour). Une teinte par tuile ne prenait ni la roche, ni les parois, ni un corps, ni un signe : « cinq bandes de gris ».
- **Le loin est opaque.** Le voile se pose plein (`NOIR_ALPHA` → 1 quand un joueur est là) et le **près** l'ouvre à `NOIR_ALPHA` = 0,93 autour du corps — plein jusqu'à 6 tuiles, éteint à 11. Sans cela le sol (albédo 2,3 × la roche) dessinait le plan entier de la salle sous n'importe quel voile uniforme. **Les lichens sont en ADD au-dessus du voile** : les seuls points du vide.
- **La torche est chaude parce qu'elle ôte du bleu** : MULTIPLY ambré (`CHALEUR_ALPHA`) puis ADD (`BRAISE_ALPHA`), même disque. Sous terre elle brûle à sa force de nuit ; l'ambiante Light2D de cave est `0x808898`. **Le jour au sol** est une nappe ADD chaude (`JOUR_SOL_ALPHA` 0,34) qui s'éteint vers le nord ; **le dehors** se voit par la gueule comme un rectangle de jour teinté de l'heure — depuis le fond, c'est vers quoi on revient.
- **La gueule, dehors, est UNE image de trois rangées sur deux colonnes** (`dessinDeLaGueuleEntiere`, `GUEULE_LARGEUR` × 48 = 32×48), posée depuis la tuile OUEST de la paire, flancs à `tx − 1` et `tx + 2` : la fente s'évase vers le bas (24 px d'ouverture au seuil), lèvre claire à l'ouest, joue sombre à l'est, linteau d'ombre, sol de salle visible au bas de la fente, coulée d'humidité, seuil piétiné. Dedans, la nappe de jour (32×48), la marche du dehors (32×16) et le point de gueule se posent **une fois par paire**, au centre de la paire. Empilée en trois images, elle laissait passer une ligne de falaise à chaque couture au zoom 2,25 — **cause MESURÉE, et générale** : texture de puissance de deux → `gl.REPEAT`, et le MSAA extrapole l'UV des fragments de bord jusqu'à la rangée opposée de la texture ; remède `epinglerLaTuile` (`setVertexRoundMode('full')`) sur toute tuile de grille pleine — falaises, parois, pavés, vue instantanée.
- **MESURÉ** (`pnpm smoke --scenario cave`, `scratchpad/smoke/cave-*.png`) : corps sans torche [39,41,43] sur sol [21,25,33] ; halo de torche [96,75,63], paroi sous torche [60,41,26] ; roche à plus de 11 tuiles [1,2,5] ; nappe de jour au seuil [58,60,74].

### Ce qui reste

1. **Elle est VIDE.** `placeZoneNodes` ne sème pas à −1 : ni butin, ni bête, ni raison d'y aller. Le *test de destination* de la Stratigraphie (§5 : *« un individu mémorable, une raison d'y aller, une chose à en rapporter »*) n'est pas passé — et une zone qui n'a que du tileset est du remplissage.
