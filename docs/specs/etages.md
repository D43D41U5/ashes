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
  même roche, du même `cliff-art`. Idem pour la rampe et pour l'ombre portée. (Le grimpeur, lui,
  change de monde à MI-RAMPE — E-R27 ; jusqu'au 2026-09-05 il restait dans la strate de l'étage
  d'autorité, c'est-à-dire en bas jusqu'à ce que le connecteur commute.)
- **E-R20 — Le découvert ne part que vers le HAUT.** Un plancher ne s'efface que pour un corps d'un
  étage PLUS BAS que lui (`plateauAlpha`, la recette de `crownAlpha` avec sa portée propre : le
  centre dessiné d'une tuile capable de couvrir un corps est à ~1,2 tuile de lui, jamais six). Sur
  le plateau, on ne fond jamais le sol que l'on foule.
- **E-R21 — Ce qui quitte la bande du sol quitte le VOILE.** Le voile d'ambiance ne tinte que le
  fond (`AMBIENT_DEPTH_LIT` = 8) ; les sprites prennent leur nuit des paires `_lit`. Tout étage monté
  dans la bande de tri doit donc reposer sa nuit lui-même, **dérivée du voile**
  (`multiplicateurDuVoile`) et jamais écrite à côté de lui.
- **E-R22 — Tout ce qui se tient à un étage monte avec lui.** Corps, nœuds, décor : le dessin prend
  `decalageDEtage`, le tri prend `strateDEtage`. Deux nombres, jamais un. Pour un CORPS, les deux
  se lisent sur son niveau DESSINÉ (`EtageLayer.niveauDuCorps`, fractionnaire sur une rampe) :
  le dessin le prend tel quel, le tri l'arrondit (`strateDuCorps`, E-R27).
  **La vie ambiante aussi** (2026-09-05) : un essaim de lucioles lit `liftSol`/`strateSol` sous son
  ANCRE à la naissance (`AmbientLife.setReliefSous`), et ses mouches, sa flaque et sa source le
  partagent — une mouche qui dérive au-delà du bord garde la hauteur de son essaim plutôt que de
  sauter de 32 px. MESURÉ avant : au palier 1, flaque à 9 et mouches à ~11 500, sous les pavés à
  99 999, deux rangées sous le sol dessiné. Garde : `smoke --scenario luciolesEtage`.
  **Les flaques du feu et de la torche** (même jour) avaient le lift mais pas la strate — MESURÉ
  (feu 474, palier 2) : profondeur 4 sous des pavés à ~199 999, la chaleur cuite sous le sol.
  Celle du feu prend `strateSol` ; celle de la torche prend la strate du CORPS
  (`PorteurDeTorche.strate`, la lecture de `syncActor`), relue à chaque image — sur une rampe
  elle change de monde avec lui. Garde : `smoke --scenario flaquesEtage`.

  **Les traces et la gerbe** (même jour) n'avaient ni l'un ni l'autre — MESURÉ (jour 112,
  terrasse (80,68) h 1) : 6 empreintes sur 6 à la rangée logique, 32 px au sud des pieds
  dessinés, en strate 0 (2 100 pour un corps à 102 100) — sous les pavés, invisibles.
  `EauEvents.track` prend désormais la MONTÉE et la STRATE du corps (`lift − dEtage`, `dTri` —
  les nombres de son ombre) : l'image monte, le tri change de monde, mais la tuile de la trace,
  la foulée et l'hystérésis d'eau restent dans le monde PLAT (`px`/`py`/`depth`). Garde :
  `smoke --scenario pasEtage` — au jour 112, la neige au sol étant un fait de région et de
  jour (aucune terrasse enneigée au 105).

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

Le prédicat est `solVisibleSous(relief, tx, ty, h)` (`framing.ts`, 2026-09-05, quand les
terrasses ont pris le découvert — T-R9) : une pièce de hauteur `h` se dessine `h × LIFT` rangées
au-dessus de sa tuile ; à la même rangée d'écran, la tuile `(tx, ty − (h − q) × LIFT)` de palier
`q` y dessine SON sol. On descend `q = h − 1 … 0` et la première dont le palier vaut `q` répond :
son sol s'il n'est pas un chapeau, sinon rien ; aucune → l'intérieur de la masse. Pour une mesa de
palier 0, c'est la tuile `(tx, ty − lift)` d'avant. Le socle trie sur la rangée **dessinée**
(`TIE_SOCLE`, entre `TIE_STRUCTURE` et `TIE_ACTOR`) **dans la strate du REGARD**
(`profondeurDuSocle` : `strateDEtage(niveau) + …`) quand le plancher trie sur la **logique** : les
deux pièces d'une même tuile encadrent le corps, l'une dessous, l'autre dessus — même quand il se
tient deux paliers plus bas.

⚠ **Le disque, lui, ne se resserre pas.** Réduit à l'emprise exacte du recouvrement, il donne une
lucarne à la taille d'un homme et l'on ne voit plus rien de ce qu'on approche. Le découvert est un
champ de vision, pas une découpe ; ce qui se règle finement, c'est ce qu'on voit PAR lui.

### E-R24 — Un étage cède d'un bloc : plancher, décor et nœuds

Un seul point de décision (`WorldScene`), une seule distance (`alphaDeDecouvert`), trois
consommateurs. Un contenu qui ne cède pas avec son plancher flotte, opaque, dans le creux que le
fondu vient d'ouvrir — constaté à la capture.

### E-R25 — Le découvert est un DEMI-disque : seul ce qui est dessiné DEVANT le corps cède (2026-09-04)

*Alexis : « je vois au travers lorsque j'approche depuis le sud alors que ça devrait le faire
uniquement pour les tuiles plus bas que le personnage à l'écran ».* Le disque était symétrique
autour des pieds dessinés : au pied de la paroi sud, il fondait la première rangée du chapeau —
dessinée 2,7 tuiles au-dessus des pieds, DERRIÈRE sa paroi, incapable de couvrir quoi que ce soit.
MESURÉ (graine 2026, coin SE de la mesa, `smoke --scenario mesa` bloc `colle`) : 29 planchers sur
48 fondus, jusqu'à 0,12, et le socle noir de E-R23 apparaissait en tache au-dessus de la tête.

- **Une pièce ne cède que si elle est dessinée SOUS la ligne de la tête.** `partDevantLeCorps(dy)`
  (dy = pieds dessinés − centre dessiné de la pièce) pondère l'ouverture du disque : 0 au-delà de
  `PLATEAU_PIVOT + ½`, 1 en deçà de `PLATEAU_PIVOT − ½`, pente continue d'une tuile
  (`PLATEAU_TRANSITION`) entre les deux — pas de pas, pas de saut (mémoire « feel = pente
  continue »).
- **Le pivot est la rangée LOGIQUE des pieds** : `PLATEAU_PIVOT = LIFT_TUILES`. Une pièce de
  chapeau se dessine `LIFT` rangées au-dessus de sa tuile logique ; dy = LIFT ⇔ même rangée que les
  pieds. Les bornes se DÉRIVENT, elles ne se choisissent pas : depuis le SUD, la première rangée
  du chapeau est à dy = LIFT + ½ + (demi-profondeur de hitbox) = 2,69 ≥ 2,5 → pleine ; depuis le
  NORD, la tuile du torse est à dy = LIFT − ½ − 0,19 = 1,31 ≤ 1,5 → cède entièrement, celle des
  jambes à 0,31 aussi. Les marges sont exactement la demi-hitbox (0,19) de chaque côté : changer
  la hitbox ou le LIFT déplace les deux à la fois (mémoire « le corps et le pas se dérivent »).
- **Le disque ne se resserre pas pour autant** (E-R23) : dans la moitié qui cède, la portée reste
  `PLATEAU_R_OUT`.

### E-R26 — Le disque ne s'ouvre que si la butte CACHE le corps (2026-09-05)

*Alexis : « on ne masque la butte que si on est plus au nord et qu'on est occulté par un bout de
la butte ».* Le demi-disque disait QUELLES pièces cèdent, pas SI : sur le flanc d'une butte, les
tuiles de chapeau dans la rangée des pieds et au sud cédaient encore (MESURÉ, coin SE de la mesa
de la graine 2026 : 11 planchers sur 35, de 0,29 à 0,84), et en approchant par le nord le chapeau
fondait dès qu'il entrait dans la portée — trois tuiles avant de cacher quoi que ce soit.

- **Le découvert porte son OUVERTURE** (`Decouvert.ouverture`, 0..1), calculée une fois par image
  dans `WorldScene` (E-R24 : un seul point de décision) : `ouvertureDuDecouvert` somme, en
  géométrie d'écran, l'aire du corps dessiné (`CORPS_HAUTEUR_TUILES` = 1,5 sur la largeur de la
  hitbox) que recouvrent les tuiles de chapeau d'une hauteur supérieure à la sienne, chacune
  dessinée `h × LIFT` rangées au-dessus de sa tuile ; divisée par la largeur, c'est une hauteur
  couverte, pleine à `COUVERTURE_PLEINE` (une tuile). `alphaDeDecouvert` la multiplie.
- **Rien ne cache le corps : rien ne cède.** Sud, flanc, approche par le nord jusqu'à deux tuiles
  du bord : ouverture 0, la butte est entière. Passé sous le bord, l'ouverture monte de 0 à 1 sur
  UNE tuile de marche (la première rangée du chapeau passe sur la tête), continûment — le long
  d'un bord dentelé le fondu respire d'une colonne à l'autre, il ne saute pas.
- **« Plus au nord » se déduit, il ne s'écrit pas** : une pièce logiquement au nord des pieds se
  dessine `LIFT` rangées trop haut pour toucher un corps d'1,5 tuile ; seule une pièce de la
  rangée des pieds ou du sud peut être dessinée sur lui — et le tri la met dessus. Pour la tuile
  du bord, le recouvrement et `partDevantLeCorps` sont le même nombre : on ne pondère pas deux
  fois.
- **Ce qui recouvre** : `Relief.hauteur` — le palier, plus un pour le chapeau (depuis le
  2026-09-05 ; la veille, seuls les chapeaux comptaient, et le sol d'une terrasse cachait le corps
  sans que rien ne cède — T-R9). Une pièce de hauteur `h` se dessine `h × LIFT` rangées au-dessus
  de sa tuile, et ne compte que si `h` dépasse le niveau du regard : le sol qu'on foule et ce
  qui est dessous ne cachent rien. Les cimes des arbres d'un plateau gardent leur propre
  `crownAlpha`. Ouvert, le disque garde sa portée (E-R23) : un champ de vision, pas une lucarne.

Gardes : `framing.test.ts` (« un demi-disque » ; « l'ouverture est nulle depuis le SUD et sur le
FLANC », « pleine sous le bord nord, en une tuile de marche, continûment », « pondère le disque »)
et le smoke `mesa` (`colle` : coin SE, ouverture 0 et aucun plancher fondu à portée ; `sud` : au
pied de la paroi, aucun fondu ; `nord-loin` / `nord-sous` : entière à deux tuiles du bord, ouverte
une tuile plus loin ; `collenord` : au contact, le découvert s'ouvre).

### E-R27 — Un corps en pente change de monde à MI-RAMPE, et ne demande jamais de fondu (2026-09-05)

*Alexis : « ça affiche la transparence quand je suis en haut d'une rampe que je suis en train de
monter », « j'ai un flash noir lorsque j'arrive à un étage supérieur ».* Le corps se DESSINE en
continu sur la rampe (`niveauSurLaRampe`, E-R22) mais se TRIAIT et se JUGEAIT sur l'entier de
l'autorité — l'étage de la sim, qui reste celui du bas pendant toute la montée (la loi de « celui
qui porte », asymétrique). Dans la moitié haute, le corps dessiné entrait donc sous le sol du haut
tout en étant classé « en bas » : le découvert le tenait pour caché et ouvrait le disque — la
transparence — puis, l'autorité commutant à l'arrivée, niveau et strate sautaient d'un coup et le
socle noir de E-R23 passait une image sous les pieds — le flash.

- **Une seule lecture** : `strateDuCorps(niveauDessine) = round(niveauDessine)`. C'est ce nombre
  qui trie le sprite (`snapshot-view.syncActor`) ET qui dit au découvert quel est SON niveau
  (`WorldScene.calculerLeDecouvert`) — donc ce qui peut le recouvrir (E-R26). Deux nombres ici,
  et le corps se trierait dans un monde pendant que le découvert en fondrait un autre.
- **Le point de bascule est le point de CONTACT, et il se dérive.** Un corps de
  `CORPS_HAUTEUR_TUILES` (1,5) monte d'une tuile de rampe pendant que sa tête franchit
  `1 + LIFT` rangées d'écran ; le sol du haut touche sa tête à la fraction
  `(1 + LIFT − 1,5) / (1 + LIFT)` = **0,5**. En deçà, rien ne le cache et il trie en bas ; au-delà,
  il trie en haut — au-dessus du sol du haut — et rien de ce sol ne compte plus. L'ouverture est
  donc nulle des DEUX côtés : la montée ne fond rien, la descente non plus (symétrique, alors que
  l'autorité ne l'est pas).
- **Sous terre, l'ouverture est 0** (`niveau < palier`) : une cave n'a rien au-dessus d'elle qui
  cède — c'est le voile du souterrain qui la ferme (§8). **Et « sous terre » se lit sur CE
  niveau-là, pas sur l'entier de l'autorité** : c'était la seconde cause du flash noir, celle
  qui prenait l'écran ENTIER. La position prédite pose le pied sur le palier haut quelques images
  avant que le snapshot ne rende l'étage — `etageJoueur` 0 < palier 1, et le voile de la cave se
  levait (MESURÉ : 9 images sur la terrasse (1425,661), soit ~150 ms à 60 Hz). `niveauDuCorps`
  rend, pour une tuile qui n'est pas marchable à l'étage d'autorité, son plancher le plus haut :
  le corps est dessiné dans le monde du haut, et le voile ne se lève pas. Une vraie cave (tuile
  marchable à `palier − 1`) le lève toujours (smoke `cave`).
- **Ce qui suit encore d'un tick** : le découvert se calcule en tête d'`update` sur la position
  PRÉDITE (qui avance au tick), le sprite se trie sur sa position de RENDU (extrapolée entre deux
  ticks) ; au passage, le niveau du découvert suit la strate de 4 images au plus (MESURÉ). C'est
  muet : l'ouverture est nulle des deux côtés du contact. Et une CORRECTION du serveur qui ramène
  le corps sous la mi-rampe fait redescendre la strate d'un cran le temps qu'il la repasse — le
  corps a reculé, la règle n'a pas bougé (pas d'hystérésis : à ajouter si ça se voit en jeu).

Gardes : `framing.test.ts` (« rampe : un corps qui la gravit change de monde à mi-pente… » —
seuils de `strateDuCorps`, ouverture 0 sur 41 points de la rampe avec témoin > 0,5 au niveau
d'autorité, contact = 0,5 dérivé) et le smoke `rampe-monte` (deux sites de la graine 2026, la
terrasse 0→1→2 en (1425,661) et la mesa (291,106) : ~230 images par montée relevées à chaque
`update`, ouverture 0 partout, aucune trouée ni socle, jamais le voile de la cave, chaque cran de
strate pris sur une rampe à sa mi-tuile).

---

## 16. L'ÉTANCHÉITÉ ET L'OBSCURITÉ (2026-09-02)

### ① E-A3 est affirmée — l'accesseur a ses appelants

*« La règle s'écrit UNE FOIS, ici, et les sites l'APPELLENT »* (E-R5). Elle en avait **deux**. Elle en a **dix-huit**, et la garde n'est pas un décompte : `etages-etancheite.test.ts` pose deux corps **à une tuile l'un de l'autre**, séparés par un plancher et **hors de portée du connecteur**, puis demande à chaque système s'il les voit. Chaque cas porte son TÉMOIN (les deux corps au même étage) — sans lui, un système inerte passerait pour étanche. Les sept rougissent quand on rend `atteignableEntreEtages` à `return true`.

**Deux trous d'ÉTAT trouvés en chemin, et ils ne se voyaient d'aucune garde** :
- **`Corpse` n'avait pas d'étage.** On mourait sur un plateau, la dépouille appartenait au sol — et le rendu la posait deux tuiles trop bas, dans la strate d'en dessous. Le champ est le pendant exact d'`Entity.etage` et de `ResourceNode.etage` (absent ≡ 0), il traverse le protocole sans une ligne à écrire.
- **Ce qui se relève d'un cadavre n'héritait pas de son plancher.** Un Cendreux levé là-haut serait né *dans* la roche du chapeau : toutes ses tuiles bloquées, figé sur place, invisible à la règle d'étage. C'est mot pour mot le défaut que le repli d'`etageApresLePas` avait été écrit pour empêcher, un cran plus loin.

**`atteintLeSol(map, acteur, tx, ty)`** nomme le cas qui revient vingt fois — le bâti, les piles, les stations, les feux vivent tous à l'étage 0 (`collision.ts` le déclare). Ce n'est pas une seconde écriture de E-R5 : c'est l'accesseur avec ses deux derniers arguments déjà remplis. Le jour où l'on bâtira à un étage, `Structure` gagnera son champ et cette fonction un argument — en un seul endroit.

**Le corps POUSSÉ (2026-09-06)** — Alexis : *« lorsque je fais une attaque lourde dans le mur d'une grotte, je monte d'un étage »*. Trois déplacements qui ne sont pas un pas — l'ÉLAN d'un coup (`advanceLunge`), le RECUL d'un coup lourd reçu (`knockback`) et la SÉPARATION des corps (`separation.ts`) — résolvaient leur `resolveMove` **sans `etages`** : la collision jugeait alors le SOL. Sous une terrasse, le sol est la surface de la terrasse, marchable partout — la charge traversait la paroi du karst, et le pas suivant, sans plancher à −2 sous le corps, retombait « au palier du sol » : à la surface. Sous une mesa, l'inverse — le sol est de la roche, l'élan était cloué. Les trois passent désormais par **`pousserLeCorps`** (`poussee.ts`) : lire l'étage, résoudre AVEC lui, reposer l'étage à l'arrivée — les trois gestes du pas de `sim.ts` et de `monsters.ts`, écrits une fois. Et la séparation **ne pousse plus à travers un plancher** (E-A3, l'accesseur en filtre de paire, relevé une fois par corps et évalué sur les seules paires qui se recouvrent). Gardes : `etages-etancheite.test.ts`, la grotte de laboratoire — charge, recul et séparation contre la paroi ouest (marchable au sol, mur à −1), et le pied de la mesa qui ne bouscule pas le plateau. Le témoin de LA FRAPPE se tient maintenant SUR le plateau : posé « à l'étage 1 » sur le pré, il était en l'air, et l'élan de son coup le repose au sol comme il doit.

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

---

*2026-09-05 — **Les grottes de TERRASSE** (karsts bornés, à identité `−H`, trois temps, nappe du calcaire, vignettes ancrées, bivouac, plancher, trace sur le palier) ont leur spec : **`grottes.md`**. Elle reprend la cave de mesa B1 dans le même régime de souterrain (G-R1) et retire la Grotte POI de surface (G-R10).*

## 18. L'ACCESSEUR D'ÉTAGE DU RENDU (2026-09-07)

*Alexis : « tu confirmes l'empilement de map ou pas ? » — puis « et bien traite la gestion d'une carte par niveau ».*

Le modèle décidé le 2026-08-31 (§2, *« chaque étage est une carte à part entière, l'ensemble est une superposition »*) n'est pas en cause : la donnée est bien une carte par niveau, superposée en coordonnées, stockée dans sa propre grille creuse. Ce qui manquait, c'est la **gestion** — côté RENDU.

**`/sim` avait son accesseur, le rendu n'en avait pas.** E-R5 dit *« la règle s'écrit UNE FOIS et les sites l'APPELLENT »* : `atteignableEntreEtages` a dix-huit appelants depuis le 2026-09-02. Mais les lois qui traduisent **écran ↔ tuile** — celles qui répondent « quelle carte se dessine ici ? » — énuméraient chacune à la main ce qui se dresse. Deux d'entre elles ont oublié la GUEULE le jour où les grottes sont arrivées, et **le même défaut est sorti deux fois en deux jours** :

| loi | ce qu'elle a oublié | ce que ça donnait |
|---|---|---|
| `deplierLeLift` | l'arche d'une gueule | viser l'entrée lisait la roche 1 à 4 tuiles derrière — « les murs invisibles » |
| `niveauDuCorps` | la salle sous le seuil | le corps dessiné sur le TOIT de la terrasse, 32 px trop haut — « le saut d'un étage » |

- **E-R28 — UNE SEULE LOI DIT QUELLE CARTE SE DESSINE À UNE RANGÉE D'ÉCRAN.** `strateDessineeA(relief, tx, ligne) → { ty, etage }` (`render/strates.ts`). Ses trois règles — le chapeau, le connecteur, le sol — ne sont écrites que là ; `deplierLeLift` ne fait plus que l'habiller en pixels monde.
- **E-R29 — LA LOI NE REGARDE JAMAIS LE TYPE D'UN CONNECTEUR.** Elle lit le palier de sa TUILE (`palierDAcces = relief.palier(c.x, c.y)`) : un connecteur est posé là où on l'atteint. C'est ce qui rend un type neuf gratuit — et le type `Connecteur` en déclare déjà un, **`'escalier'`, que rien ne construit encore**. Une garde le pose et exige que ses rangées levées se dévoilent comme celles d'une rampe, sans une ligne de plus.
- **E-R30 — G-R1 NE S'ÉCRIT QU'UNE FOIS.** « Une salle de niveau `n` s'ouvre sur le palier `−n − 1` » était écrite **cinq fois** dans le client (`decalageDEtage`, `EtageLayer.rendreLaCave`, `deplierLeLift`, `niveauDuCorps`, `WorldScene.yDessineDuCorps`). C'est `palierDUneSalle(niveau)` (`framing.ts`, le module le plus bas), et les cinq l'appellent.

**MESURÉ — la prémisse d'E-R29, sur le monde JOUÉ et non sur un montage** : les **1 227 connecteurs** de la carte (963 rampes, 264 gueules) ont tous `relief.palier(c.x, c.y)` égal à leur palier d'accès — `min(de, vers)` pour une rampe, `de` pour une gueule. Si le worldgen posait un jour une rampe sur sa tuile haute, `strates.test.ts` rougirait avant tout le reste.

**Les gardes et leurs témoins** (`strates.test.ts`, 16 cas) : `palierDAcces := c.de` fait rougir la rampe descendante ; `:= min(de, vers)` fait rougir la gueule ; `strateDessineeA := { ty: ligne, etage: 0 }` fait rougir les trois règles — chapeau, rampe et gueule — et pas une seule.

### Ce qui reste

- Les couches (`EtageLayer`) posent encore leurs passes par type (la passe des gueules, la lèvre du sud d'une rampe) : c'est du DESSIN, pas de la traduction écran ↔ tuile, et l'accesseur ne le couvre pas.
- `niveauDuCorps` répond à une autre question (« quelle strate porte un corps arrivé de l'étage `n` ? ») : elle partage désormais `palierDUneSalle` avec le reste, pas la loi entière.

## 19. LES SITES DE PORTÉE (2026-09-07) — E-A3 disait vrai de deux, pas de soixante-sept

*Alexis : « go ».*

E-A3 affirmait que *« les 67 sites sont couverts »*. **Ils étaient 25** (11 `atteignableEntreEtages`, 14 `atteintLeSol`). MESURÉ le 2026-09-07 par balayage des motifs de distance (`Math.hypot`, le carré, Chebyshev) : **64 sites dans 31 fichiers** de `packages/sim/src`, hors tests — le même ordre de grandeur que les 67 de 2026-08-31, avec un instrument un peu différent.

**LA LIGNE DE PARTAGE, et elle n'est pas « tout ce qui calcule une distance »** : la règle d'étage ne concerne QUE les sites où **un corps perçoit ou subit quelque chose d'autre**. Un anneau de tuiles qu'on balaie pour choisir un site de spawn, un waypoint de son PROPRE chemin, un test d'appartenance à une zone (« suis-je dans le carré du feu ? ») n'ont pas de second corps : leur donner une garde d'étage rendrait le mécanisme muet sans rien protéger — c'est le piège de *« la géographie module, elle n'autorise jamais »*.

**LES CINQ SITES REPRIS** :

| site | ce qui traversait le plancher |
|---|---|
| `poi-discovery.ts` — VOIR | on découvrait à vue le fond d'un karst depuis la terrasse qui le coiffe (le pendant ATTEINDRE, lui, passait déjà l'étage à `poisAt`) |
| `worldevents.ts` — l'alarme | un Cendreux terré SOUS le village la déclenchait, et consommait son délai de garde |
| `worldevents.ts` — l'Arche | on embarquait depuis une salle passant sous le quai : le verdict de fin de saison se jouait sur un plancher |
| `murmure.ts` — le Cendreux | un Cendreux sous la roche faisait taire un site de surface |
| `murmure.ts` — le visiteur | on recevait d'une salle un murmure qui se lit de la CENDRE, donc de la surface |

**LES SITES LAISSÉS DEHORS, nommés pour qu'on ne les re-litige pas** : `cendreux.ts:488` et `npc.ts:214` (waypoint de son propre chemin) · `worldevents.ts:144` et `morts.ts:347` (anneau de tuiles pour choisir un spawn — la marchabilité tranche déjà) · `npc.ts:1244` et `defriche.ts:72` (Chebyshev au feu = « suis-je dans le village ? », un test de zone) · `poi.ts:1249`, `poisson.ts:32`, `zonegen*`, `layons.ts`, `village-plan.ts`, `connectivity.ts`, `zonegraph.ts`, `zone-content.ts`, `geometry.ts` (worldgen : aucun corps vivant) · `annales.ts` (densité de deux ANNALES entre elles) · `fumerolle.ts:254` (un CHAMP échantillonné en un point — c'est E-R13, pas E-R5) · `traction.ts:98` (un corps et SA propre charge, que la distance de rupture règle déjà).

⚠ **`interest.ts` n'est PAS un helper de portée** — malgré son nom, c'est l'*interest management* réseau (le rognage du snapshot au rayon de caméra). Le filtrer par étage serait un défaut : le client doit RECEVOIR l'étage voisin pour le composer (E-R10).

**Gardes** : trois cas behavioraux de plus dans `etages-etancheite.test.ts` (voir un lieu, l'alarme, l'Arche), chacun avec son témoin au même étage. Neutraliser `atteignableEntreEtages` en `return true` fait rougir **12 cas sur 19** — les 9 d'avant et les 3 neufs.

### Ce qui reste

- ~~**Les deux sites de `murmure.ts` sont branchés, pas gardés behavioralement**~~ — gardés le 2026-09-07, §20. **La prémisse était fausse** : on croyait devoir monter une bande de cendre sur la mesa de laboratoire, alors que le banc de `murmure.test.ts` joue DÉJÀ la vraie carte mûre (`carteDeTest`, 200 jours d'âge). Il ne manquait qu'un corps sous la roche.
- ~~**La garde STRUCTURELLE d'E-A3**~~ — livrée le 2026-09-07, §20.


## 20. LA GARDE STRUCTURELLE D'E-A3 (2026-09-07) — et les sept questions qu'elle a levées

*Alexis : « continue ».*

E-A3 promet deux choses. La garde behaviorale de §19 tient la première (*« les sites sont couverts »*) ; elle ne peut pas tenir la seconde (*« la garde échoue si un site NOUVEAU apparaît sans passer par l'accesseur »*) — un site qu'on écrirait demain n'a personne pour le mettre en scène. C'est une règle ESLint qui la tient : **`tools/eslint-regle-etage.mjs`**, armée sur `packages/sim/src/**` seul.

**CE QU'ELLE VOIT** : une distance **comparée à un seuil** — `dx * dx + dy * dy`, `Math.max(Math.abs(…), Math.abs(…))`, `Math.hypot`, et **`distSq(a, b, c, d)`**, directement (`if (d2 > r2)`) ou par la variable qui la reçoit. **Ce qu'elle ne voit pas** : une distance rendue par un helper autre que `distSq`. C'est un tripwire, pas une preuve.

**CE QU'ELLE EXIGE** — l'une de trois issues, sans quoi le lint rougit :

1. la fonction englobante appelle l'accesseur (`atteignableEntreEtages`, `atteintLeSol`, `auMemeEtage`) ;
2. elle est nommée dans **`HORS_REGLE`**, AVEC SA RAISON — pas de second corps (anneau de tuiles, waypoint de son propre chemin, champ lu en un point, appartenance de zone, worldgen), ou étanchéité déjà assurée autrement ;
3. elle est nommée dans **`A_TRANCHER`** — c'est une vraie perception, et la réponse change le jeu.

**ET UNE EXEMPTION QUI NE COUVRE PLUS RIEN ROUGIT AUSSI** (`morte`). C'est ce qui empêche les deux tables de pourrir en gardes mortes : la clé est un NOM de fonction, pas un numéro de ligne, et un renommage la fait tomber. *(Éprouvé : une clé `fonctionQuiNExistePas` glissée dans `impasse.ts` rougit bien.)*

**LA LEÇON DE SON SECOND PASSAGE — `distSq`.** Bornée à l'idiome écrit à la main, la règle était aveugle à **139 des ~163** sites du dépôt. Dans ce trou, deux vraies perceptions trouvées par accident en cinq minutes : `nearestGibier` (le Cendreux élit un gibier vivant à travers la roche) et le phare-feu de `nearestWarmth`. `distSq` **est** `dx * dx + dy * dy` — l'exclure, c'était exclure l'idiome. Couverte, elle relève **152 sites**, tous triés.

**DEUX SITES REPRIS** (correction technique, la garde d'étage y va dans le sens sûr) :

| site | ce qui traversait le plancher |
|---|---|
| `faune.ts` — `alarmeDEnvol` | l'envol d'oiseaux à la surface mettait en alerte une bête terrée dessous |
| `faune.ts` — `underFireWard` | un feu allumé au-dessus rendait toute une salle interdite à la faune, sans que rien ne le dise |

### LES SEPT QUESTIONS — pour Alexis, une à la fois

> ✅ **TOUTES TRANCHÉES LE 2026-09-07 — voir le §21.** La table ci-dessous reste telle qu'elle a été posée : c'est l'énoncé, pas la réponse.

Ces sites SONT des perceptions. Les corriger change le jeu : ce ne sont pas des correctifs techniques. Ils sont déclarés dans `A_TRANCHER`, le lint est vert, et **les trous sont nommés au lieu d'être cachés**.

| # | la question | les sites |
|---|---|---|
| **Q1** | **Le ward d'un feu traverse-t-il un plancher ?** ⚠ **UN QUART DE CETTE QUESTION A ÉTÉ TRANCHÉ SANS ALEXIS** — voir l'encadré sous la table | `cendreux.ts` `willRiseAsCendreux` · `advanceCendreux` · `morts.ts` `advanceReveils` · `siteDansLaCouronne` |
| **Q2** | **La perception de chaleur du Cendreux** — `nearestPrey` est scellé, le gibier et le phare-feu ne le sont pas | `cendreux.ts` `nearestGibier` · `nearestWarmth` |
| **Q3** | **La meute et la harde se parlent-elles à travers un plancher ?** (alarme de harde, appel de meute, courage, rage sur le tueur d'un des siens) | `faune.ts` `faunaStep` · `noteBlocked` · `packNearby` · `packInPlace` · `packQuarry` · `clanAggressor` · `combat.ts` `applyDamage` · `die` |
| **Q3bis** | le bond qui touche, les petits, la sortie, l'élection générique | `faune.ts` `leapStep` · `pupStep` · `sortieTravel` · `nearestOf` |
| **Q4** | **L'odorat** — le sang et la charogne | `faune.ts` `bloodBias` · `feedStep` |
| **Q5** | **L'interaction à portée** — pêcher, dépecer, bâtir, glaner, défendre, apprendre un coin | `economy.ts` `stationFor` · `castRejection` · `butcherRejection` · `village.ts` `evaluateBuild` · `npc.ts` `near` · `nearestAliveNode` · `handleDefense` · `npc-errands.ts` `handleErrand` · `faune.ts` `advanceCoinsConnus` |
| **Q6** | **Le contact des buveurs** — le Cendreux qui boit au feu | `fire.ts` `advanceFire` · `village.ts` `advanceUpkeep` |
| **Q7** | **Le tremblement du sol** — celui-là traverse peut-être, justement : la roche le PORTE, ou elle l'arrête ? | `sens.ts` `secouerLeSol` |

⚠ **CE QUE J'AI TRANCHÉ SEUL DANS Q1, ET QU'IL FAUT RELIRE.** `underFireWard` a été repris ce jour comme une correction technique — or c'est le PREMIER MEMBRE de la famille Q1, dont les trois autres sont différés. Depuis, dans le jeu livré : **le cercle d'un feu allumé s'arrête à un plancher pour la FAUNE, et le traverse encore** pour `willRiseAsCendreux`, `advanceCendreux`, `advanceReveils` et `siteDansLaCouronne`. Cette asymétrie n'existait pas avant. Elle ne demande pas d'être annulée — le sens sûr est bien celui-là, et il est maintenant gardé — mais elle demande qu'Alexis tranche les trois autres dans le MÊME sens, ou dise pourquoi le feu écarte un mort à travers la roche et pas un loup.

⚠ **Aucune de ces sept n'est urgente aujourd'hui** : les 6 étages du monde joué couvrent **0,87 %** du plan, tous des intérieurs de grotte atteints par une gueule. Le cas à deux corps sur deux étages y est rare. Elles deviennent urgentes le jour où le souterrain s'étend.

### Ce qui reste

- ~~Les sept questions.~~ — **tranchées le 2026-09-07**, §21.
- ~~`alarmeDEnvol` est branché et couvert par le lint, **pas gardé behavioralement**~~ — **gardé le 2026-09-07, §22. L'excuse était fausse elle aussi**, la troisième du même jour : on croyait qu'il fallait « un tétras posé, alerté, et son vol résolu », alors que l'autre appelant d'`alarmeDEnvol` est la nuée d'une **LISIÈRE**, qui n'a pas d'oiseau — pas une entité, pas un monstre, rien qu'un fait. Trois excuses posées le même jour, trois fausses.

### LE FEU DU DESSUS, GARDÉ — et l'excuse qui l'avait différé

La même leçon que pour le murmure, le même jour : *« les mettre en scène demande un camp allumé sur la mesa »* était **faux**. Un camp allumé n'est qu'une structure, et `fireStateAt` rend `'lit'` à tout feu libre sans slot combustible — « un feu forgé à la main dans un test ». Il n'a fallu ni bois, ni allumage, ni PNJ.

La garde (`etages-etancheite.test.ts`) pose le feu sur le plateau, puis le couple loup + proie soit AU feu, soit dans la cave qui passe dessous — même tuile, même distance, seul l'étage change. **QUATRE jambes : deux cas, chacun avec SON témoin sans feu.** Un témoin unique ne suffirait pas — il prouverait que le loup élit sur le PLATEAU, jamais qu'il élit dans la CAVE, et le jour où une régression casserait la chasse sous la roche, la jambe « cave + feu » tomberait en accusant le feu, le mauvais coupable. Les deux prémisses sont calculées sur les positions POSÉES (la proie dans le cercle du feu, le loup à portée d'acquisition **à toute heure**, `aggroRange × WOLF_DAY_FLOOR`), jamais sur des constantes recopiées : bouger la mesa doit faire tomber la prémisse, pas la masquer. *(Rougissement éprouvé : `atteignableEntreEtages` neutralisée, la jambe « dans la cave, avec feu » tombe, les autres tiennent.)*

### LES DEUX SITES DE `murmure.ts`, GARDÉS

Le §19 les laissait ouverts en croyant qu'un site de murmure était cher à monter — **la prémisse était fausse**. Le banc de `murmure.test.ts` joue déjà la VRAIE carte avec 200 jours d'âge de cendre : les sites existent pour de bon, il ne manquait qu'un corps sous la roche.

La garde ne pose donc pas de mesa : elle prend un site réel et met le corps à `etage = −1`. **Et elle AFFIRME sa prémisse** au lieu de la supposer — le site retenu est le premier qui n'a aucun connecteur à `ETAGE_PORTEE_CONNECTEUR + 1`, sans quoi la salle d'en dessous rejoindrait la surface par une gueule et la garde mesurerait l'inverse de ce qu'elle croit. Chaque cas garde son témoin au même étage (les cas d'A33, rejoués).

| cas | ce qu'il refuse |
|---|---|
| LE VISITEUR | recevoir d'une salle un murmure qui se lit de la CENDRE, donc de la surface |
| LE CENDREUX | qu'un Cendreux terré sous la roche fasse taire un site de surface — « ce qui vient » doit pouvoir vous atteindre |

**Rougissement éprouvé** : `atteignableEntreEtages` neutralisé en `return true` → les deux cas neufs échouent, les 8 autres passent.

---

## 21. LES HUIT DÉCISIONS D'ALEXIS (2026-09-07) — les sept questions, tranchées

*Alexis : « pose moi les questions une à une », puis « oui vas-y ».*

Les sept questions du §20 lui ont été posées une par une, chacune avec son impact concret et
ma recommandation. **Voici ce qu'il a décidé — et ce n'est pas partout ce que je recommandais.**

| # | la question | LA DÉCISION | sites |
|---|---|---|---|
| **Q1** | le ward d'un feu | **« Non — il s'arrête au plancher »** | 4 + le témoin allié |
| **Q2** | la perception du Cendreux | **« Non — sceller les deux »** | 2 |
| **Q3** | la meute et la harde | **« Tout sceller — un plancher coupe le groupe »** *(je recommandais de DÉCOUPER : le cri passe, la géométrie non — Alexis a tranché plus net)* | 8 |
| **Q3bis** | le bond, les petits, la sortie | **« Non — sceller les quatre »** | 4 |
| **Q4** | l'odorat | **« Sceller `feedStep`, laisser `bloodBias` »** | 1 scellé, 1 ouvert |
| **Q5** | l'interaction à portée | **« Non — sceller les 9 en bloc »** | 9 |
| **Q6** | le contact des buveurs | **« Non — sceller les deux »** | 2 |
| **Q7** | la secousse | **« Oui — la roche PORTE la secousse »** | 1, ouvert par décision |

**28 sites scellés, 2 laissés ouverts EXPRÈS** — et les deux ouverts ne disparaissent pas de la
garde : ils passent d'`A_TRANCHER` à `HORS_REGLE`, avec la décision écrite dans leur raison. Une
clé supprimée aurait rendu le lint vert pour la mauvaise cause, et le lecteur suivant n'aurait pas
su que c'était décidé.

> ⚠ **CE QUE LA TABLE DIT ≠ CE QUE L'ARBRE PORTE.** La table ci-dessus est la DÉCISION, prise en
> une fois ; la livraison s'est faite en trois lots, **tous livrés le 2026-09-07** : ① la faune
> (Q1–Q4, 20 sites), ② les buveurs (Q6, 2 sites), ③ l'interaction (Q5, 9 clés / **13 sites** —
> le lint en comptait plus que la table). **`A_TRANCHER` EST VIDE**, et c'est l'état sain : un
> site nouveau qui y atterrit est une question de plus à poser, pas une dette.

### CE QUE Q3 RETIRE — dit avant de le livrer

« Tout sceller » **inclut le cri**. C'est la seule des huit décisions qui *retire* un moment de
jeu : **un loup tué dans une grotte ne fait plus hurler le clan resté dehors** (`combat.die` →
`wolf_howl`). Alexis l'a tranché en connaissance de cause ; c'est consigné tel quel, sans y
revenir. La garde behaviorale le dit dans son propre libellé (*« et c'est un moment de jeu en
moins »*) pour que personne ne le « répare » un jour par accident.

Deux nuances de forme, prises en technique et pas en design :

- **`packInPlace`** — un loup séparé de la proie par un plancher ne compte plus dans
  l'encerclement (il est SAUTÉ, comme celui qui chasse autre chose). Le faire échouer aurait
  suspendu l'assaut pour toujours : il ne peut pas venir se poster.
- **`combat.die`** — la RAGE se transmet toujours à toute la meute (elle n'a pas de portée) ;
  c'est la CIBLE, et donc le hurlement, qui se prennent à vue de roche.

### LE DISPATCHER RESTE SOUS GARDE — `crisFrais`

`faunaStep` portait **huit** distances, dont une seule est une perception (l'alarme de harde) ;
les sept autres sont de la trajectoire ou un centroïde. La règle exempte une fonction **entière**
dès qu'elle appelle l'accesseur : sceller l'alarme dans le corps du dispatcher aurait donc
désarmé les sept autres **sans qu'une ligne le dise**, et un site neuf écrit demain dans
`faunaStep` serait passé sans bruit. L'alarme est donc sortie dans **`crisFrais`**, qui porte sa
loi ; `faunaStep` garde son entrée `HORS_REGLE` avec la liste de ce qui lui reste.

### LES GARDES DU LOT ① (la faune — Q1..Q4)

`etages-etancheite.test.ts`, cinq cas, chacun avec **son témoin au même étage** :

| garde | ce qu'elle refuse |
|---|---|
| **Q1** | qu'un feu de la terrasse annule une levée dans la salle du dessous (4 jambes : chaque étage a son témoin sans feu) |
| **Q2** | qu'un feu allumé du dessus serve de PHARE au Cendreux terré |
| **Q3** | que le cri de mort lève la sœur restée de l'autre côté du plancher |
| **Q3** | que tuer un louveteau sous terre fasse hurler le clan resté dehors |
| **Q4** | que la charogne de la salle attire le charognard du plateau |

Les prémisses sont **calculées sur les positions posées** (le mort dans le ward, la sœur dans le
rayon d'alarme, la charogne sous la gueule et FRAÎCHE) — jamais des constantes recopiées : bouger
la mesa doit faire tomber la prémisse, pas la masquer.

**Rougissement éprouvé** : `atteignableEntreEtages` neutralisée en `return true` → **18 des 25**
tombent, dont les cinq neufs, et chaque fois sur la jambe « à travers », jamais sur le témoin.

### LES GARDES DU LOT ② (les buveurs — Q6)

Boire est un **CONTACT** (`CENDREUX.BOIRE.CONTACT` = 1,5 tuile) : la question n'est pas « le
voit-il ? » mais « le touche-t-il ? ». Deux gardes, un site chacune.

| garde | ce qu'elle interdit |
|---|---|
| **Q6a** `fire.advanceFire` | qu'un Cendreux de la salle boive le bois du feu libre posé sur la terrasse (témoin : le même buveur SUR la terrasse boit) |
| **Q6b** `village.advanceUpkeep` | qu'une horde passant SOUS le Foyer en draine le stock (témoin : la bouche de la plaine draine ; deux jambes scellées, la salle et le chapeau) |

⚠ **Le Foyer n'a pas d'étage** — `Village` n'en porte pas : il se tient au SOL de sa tuile. Dans la
mésa de labo ce sol est le palier **0**, la plaine sous le chapeau ; le témoin de Q6b est donc le
buveur de la PLAINE, pas celui du plateau. La garde le dit et le prouve
(`palierDuSol(map, tx, ty) === 0` en prémisse) — c'est ce qui l'a fait rougir à la première écriture.

Le buveur transporte désormais **son corps** (`Buveur.corps`, `fire.ts`) et non seulement sa
position : `cendreuxVivantsPositions` tenait déjà l'index d'entités pour lire `hp`, relever
l'étage y est gratuit — et `exactOptionalPropertyTypes` interdisait de recopier un `etage?`
optionnel dans un littéral.

**Rougissement éprouvé** : accesseur neutralisé → **20 des 27** tombent, dont les deux neuves,
toujours sur la jambe « à travers ».

### LES GARDES DU LOT ③ (l'interaction — Q5)

**Neuf clés dans la table, TREIZE sites dans le code.** Le compte n'est pas celui qu'on croyait :
`advanceCoinsConnus` en portait 2 (apprendre un coin, corriger la pastille), `handleErrand` 2
(l'étranger frappé en chemin, le cadavre fouillé), `handleDefense` 3. On ne les a pas comptés à
la main — **on a vidé `A_TRANCHER` et laissé le lint énumérer**, exactement comme `tsc` avait
trouvé 43 variantes de `PlayerAction` là où le grep en voyait 37.

#### `near` — le pivot, et pourquoi sa signature change

`npc.near` n'est pas un site : c'est **LE prédicat d'interaction des PNJ**, appelé **25 fois** dans
`npc.ts`, `npc-needs.ts` et `npc-errands.ts` (coffres, établis, Foyer, maison, nœud, cible de
réparation, grenier étranger…). Sa signature devient :

```ts
near(map, entity, tx, ty, etage, r = RANGE)
```

**`etage` est positionnel et OBLIGATOIRE, avant `r`** — pas optionnel. Un site qui l'oublierait
retomberait en silence sur le palier du sol : vert au lint, vert aux tests, faux au niveau. En le
rendant obligatoire, c'est `tsc` qui a énuméré les 25 sites et forcé une décision à chacun. Ce
qu'on vise porte son étage (`Structure.etage`, `ResourceNode.etage`) ; `undefined` = le SOL de la
tuile, et c'est la BONNE réponse pour un Foyer de village, qui n'a pas d'étage.

#### Les quatre gardes

| garde | ce qu'elle interdit |
|---|---|
| **Q5a** `npc.near` | qu'un coffre du pied se manipule depuis le plateau (le témoin prouve que la distance, elle, passe) |
| **Q5b** `economy.castRejection` + `butcherRejection` | qu'on lance la ligne dans l'eau d'un autre étage, qu'on dépèce la carcasse du dessous (la doc de `Corpse.etage` le promettait déjà : *« un corps tombé sur un plateau y reste »*) |
| **Q5c** `faune.advanceCoinsConnus` | qu'un coin de chasse s'apprenne à travers un plancher |
| **Q5d** `village.evaluateBuild` | qu'on bâtisse quatre tuiles plus bas depuis le plateau |

**Rougissement éprouvé** : accesseur neutralisé → **24 des 31** tombent, dont les quatre neuves,
toujours sur la jambe « du plateau ».

#### Les neuf autres sites, et où leur loi est écrite

- `economy.stationFor` — l'établi du plateau ne s'utilise pas du pied (avant `hasAccess`).
- `npc.nearestAliveNode` — le glanage n'élit pas un nœud séparé. Le test vient **après** la portée
  (il ne se paie que sur les candidats) et **avant** l'élection : conditionné à `d < bestD`, une
  égalité de distance aurait fait gagner un nœud inatteignable au départage.
- `npc.handleDefense` — la milice n'élit pas une menace qui rôde SOUS le Foyer (test
  **inconditionnel**, même raison), et n'engage pas à travers la roche. Le TROISIÈME `distSq` de
  cette fonction (`after`) mesure le PROGRÈS du milicien vers SA menace : même acteur, même cible,
  aucune seconde perception — il reste une distance nue, et l'élection l'a déjà filtrée.
- `npc-errands.handleErrand` — le raider ne frappe pas l'étranger qui passe sous lui, et ne
  fouille pas un cadavre d'un autre étage.
- `village.evaluateBuild` — le test est posé **après `solDeLaPose`**, qui a déjà dit à quel étage
  la pose se ferait : on demande si le bâtisseur atteint CET étage-là. Sous la roche c'est le
  sien, la question devient vraie d'elle-même — et c'est juste, on bâtit sa propre salle.

⚠ **`BuildEval.reason`, pas `reject`.** La garde du bâti est passée au vert avec un champ qui
n'existe pas (`undefined !== 'too_far'` des deux côtés) : `vitest` ne typecheck pas. C'est
`pnpm check` qui l'aurait dit — le témoin de rougissement l'a dit avant lui.

#### ⚠ CE QUE Q5 DÉPLACE — mesuré site par site, un jour joué

`npc.near` était désigné comme LE site risqué (25 appels, toute la vie des PNJ). **Il ne l'était
pas.** Compteur posé dans chaque garde, banc d'un jour (36 000 ticks), graines 2026 et 4242 :

| site | coupés / vus (2026) | coupés / vus (4242) | part |
|---|---|---|---|
| `near` | 0 / 41 966 | 0 / 98 102 | **0,000 %** |
| `handleDefense` | 0 / 434 | 0 / 0 | **0,000 %** |
| `nearestAliveNode` | 64 670 / 118 138 | 15 280 / 28 961 | **54,7 % · 52,8 %** |

`near` ne coupe rien : **un village se fonde sur du plat**, ses coffres, son Foyer et ses postes
sont au même palier que ses PNJ. La livelock redoutée (un PNJ qui marche vers un coffre qu'il
n'atteindra jamais) n'existe pas dans le monde joué. Idem pour la milice.

**`nearestAliveNode`, lui, coupe un nœud sur deux** — et c'est lui, pas `near`, qui déplace le
banc (bois 36 → 20 sur un village, un avatar de plus mort, sur la graine 2026).

> ✅ **TRANCHÉE LE 2026-09-08 — « rouvrir pour les terrasses », voir le §23.** L'énoncé qui suit
> reste tel qu'il a été posé.
>
> ❓ **QUESTION OUVERTE POUR ALEXIS — `nearestAliveNode` élit une DESTINATION, pas une
> interaction.** L'élection est suivie d'un `setPathTo`, et `findPath` est **à trois dimensions**
> (`pathfinding.ts` : la recherche traverse les étages par les connecteurs) : le PNJ SAIT monter
> une rampe. Or E-R5 répond *« ces deux points peuvent-ils se toucher MAINTENANT »*, pas *« puis-je
> y aller »* — appliquée à une élection de voyage, elle retire aux villages la moitié de leurs
> nœuds, ceux des terrasses, que le pathfinder aurait su rejoindre. Livré tel que tranché
> (« sceller les 9 en bloc ») ; **une ligne le rouvre** si l'on veut que les PNJ montent — la
> bonne loi serait alors « le chemin tranche l'accès », celle qui vaut déjà pour `nearestGround`
> dans `HORS_REGLE`.

**PERF — l'ordre du test compte.** Le premier jet posait la garde AVANT la distance dans
`handleDefense` : **8,3 millions** d'appels à `atteintLeSol` par jour joué (une par menace, par
tick, sur la carte entière). `d >= bestD` est le complément EXACT de l'élection (`d < bestD`) :
le sortir devant ne change pas un bit et ramène le compte à **434**. La règle générale : la
distance est bon marché, l'accesseur ne l'est pas — et l'accesseur doit rester **hors** du `if`
d'élection, sinon une égalité de distance élirait un candidat inatteignable.

### ⚠ CE QUE ÇA DÉPLACE DANS LE MONDE JOUÉ — mesuré, pas supposé

L'empreinte de `/sim` (`tools/empreinte-sim.mts`, 12 runs, 3 graines × 4 régimes) **bouge** :
**114 champs sur 594**. Le §20 disait *« le cas à deux corps sur deux étages est rare — 0,87 % du
plan »*, et **c'était trompeur** : les 11 084 tuiles d'étage ne sont que l'axe CREUX. E-R5 se lit
sur `niveauDuCorps`, c'est-à-dire sur l'étage **ou, à défaut, sur le PALIER** — l'axe dense, celui
des terrasses, qui couvre toute la carte.

Balayage de 400 000 paires de tuiles marchables sur la carte jouée (graine 2026, `MONDE_JOUE`) :

| rayon | paires | niveaux différents | **coupées par E-R5** |
|---|---|---|---|
| 1,6 (contact, `EAT_RANGE`) | 362 458 | 2,09 % | **1,97 %** |
| 8 (`FIRE_WARD`) | 354 215 | 8,22 % | **7,62 %** |
| 12 (`aggroRange` du loup) | 350 053 | 10,97 % | **10,37 %** |
| 26 (`PURSUIT_RANGE`) | 340 756 | 17,73 % | **17,15 %** |

L'écart entre les deux dernières colonnes est l'œuvre des **1 131 connecteurs** : ils ne rattrapent
qu'un demi-point. **Une perception sur dix à portée de loup est coupée par un dénivelé** — et c'est
la terrasse qui coupe, pas la grotte.

**Ce n'est pas un régime neuf** : `nearestPrey` — l'élection de proie du prédateur, LE site sur
lequel toute la chasse repose — applique cette loi depuis qu'E-R5 existe. Le lot ① l'étend au
reste de la famille, il ne l'invente pas. Mais la divergence d'empreinte est réelle et attendue :
une seule élection qui change décale le flux seedé, et tout ce qui suit avec (`rng-fragile`).

---

## 22. LE DERNIER SITE DU LOT ① (2026-09-07) — la nuée de la lisière

`alarmeDEnvol` était le seul site branché du lot ① à n'avoir pas sa garde behaviorale. Le §20
l'avait différé sur une excuse — *« il y faudrait un ENVOL : un tétras posé, alerté, et son vol
résolu »* — et cette excuse était **fausse comme les deux autres du même jour**. `alarmeDEnvol` a
DEUX appelants : le bond du tétras (`envolerLe`), cher à monter, et **`advanceEnvols`, la nuée
d'une lisière**, qui n'a pas d'oiseau du tout — pas une entité, pas un monstre, rien qu'un fait
émis quand un pas bruyant tombe sur une tuile de bord de bois. Elle n'exige de la forêt qu'une
chose, `estLisiere(profondeurAt(…))`, et la profondeur est **un champ qu'on pose** (`map.profondeur`,
0 sans le champ, un tableau ordinaire). Il n'a fallu ni massif, ni tétras, ni vol.

**Trois excuses posées le même jour, trois fausses** — le murmure (« il faudrait monter une bande
de cendre »), le feu du dessus (« il faudrait un camp allumé sur la mesa »), et celle-ci. Ce qui
les rend fausses est chaque fois la même chose : on décrit le montage par le CHEMIN DE JEU qui y
mène (allumer un feu, faire vieillir la cendre, alerter un oiseau) au lieu de l'ÉTAT que la
fonction lit vraiment.

**LA GARDE** (`etages-etancheite.test.ts`) — le marcheur est au pré, contre la paroi ouest du
chapeau ; la bête est sous le chapeau, à UNE tuile, dans la salle (−1) ou au sol (0) : même
position, même distance, seul l'étage change.

⚠ **La passe est appelée SEULE, jamais `step`.** Sous un tick entier, la bête posée à une tuile du
marcheur le verrait aussi de ses propres yeux : le témoin passerait au vert pour la mauvaise cause
et ne prouverait plus que la méfiance vient de l'envol. Et la prémisse affirme que **la nuée se
lève dans LES DEUX jambes** (`bird_flush` émis), plus que le pas est bruyant et la bête dans le
rayon d'alarme — ce qui diffère est ce qui l'ENTEND, pas ce qui la lève.

**Rougissement éprouvé** : `atteignableEntreEtages` neutralisée en `return true` → **25 des 32**
tombent, dont la neuve, et sur la bonne jambe (`0,35` de méfiance gagnée sous la roche, le témoin
du pré intact).

---

## 23. E-R5 ROUVERT POUR LES TERRASSES (2026-09-08) — le glanage élit ce que le CHEMIN rejoint

*Alexis, après la question posée avec ses chiffres : « rouvrir pour les terrasses ».*

Le §21 laissait une question ouverte sous Q5 : `npc.nearestAliveNode` n'élit pas un CONTACT, il
élit une **DESTINATION**, suivie d'un `setPathTo` — or E-R5 répond *« ces deux points peuvent-ils
se toucher MAINTENANT »*, jamais *« puis-je y aller »*. Appliquée là, elle retirait aux villages
des nœuds que le pathfinder du jeu, lui, savait rejoindre.

### CE QUI A ÉTÉ MESURÉ AVANT DE POSER LA QUESTION

`tools/__noeuds-coupes.mts` (jetable) : monde joué, 8 joueurs, tick 600, **tous** les nœuds dans
40 tuiles de chaque PNJ, et pour chaque nœud coupé par E-R5 la question « `pathToward` —
exactement ce qu'appelle `setPathTo` — y mène-t-il ? »

| graine | coupés par E-R5 | qu'un chemin rejoint |
|---|---|---|
| 2026 | 9,1 % | 97,2 % |
| 4242 | 9,9 % | 96,9 % |
| 31337 | 33,4 % | 91,9 % |
| 999 | 29,7 % | 64,7 % |
| 1234 | 5,5 % | 63,2 % |
| 7 | 21,1 % | 35,1 % |

**Entre un tiers et la quasi-totalité** de ce que le sceau retirait était joignable. La dispersion
est le TERRAIN, pas du bruit : sur une carte pauvre en rampes, sceller coûte peu ; ailleurs, on
retirait aux villages la moitié de leur voisinage.

⚠ **CE 9,1 % N'EST PAS LE 54,7 % DU §21 — les deux dénominateurs sont différents, et les deux sont
vrais.** Le §21 comptait au COMPTEUR DE LA GARDE, sur un jour joué : une part des *élections
vues*, donc pondérée par la fréquence d'appel et bornée par la portée de glanage. Celui-ci compte
les *nœuds du voisinage*, à un instant, sans pondération. Le premier dit ce que le sceau coupe à
l'usage ; le second, sur quoi il coupe.

⚠ **LA SONDE A DÛ ÊTRE RÉPARÉE AVANT DE SERVIR.** Son premier jet appelait `findPath` en direct et
répondait « injoignable » sur **100 % des arbres et des rochers** — un arbre n'est pas marchable,
on ne va pas DANS un arbre. C'est `pathToward` qui se poste au voisin libre, et c'est lui que le
jeu appelle. Un chiffre uniforme à 0 % sur toute une famille est la signature d'un instrument
cassé, pas d'un monde hostile.

### LA LIGNE DE PARTAGE : LA TERRASSE AU CHEMIN, LE CREUX À E-R5

**94 % des coupés sont de la TERRASSE** (le palier), 6 % seulement dans un creux. Et c'est
exactement la frontière de ce que la navigation sait faire : **`setPathTo` ne passe AUCUN argument
d'étage à `pathToward`** — la recherche tourne sur `palierDuSol`. Pour une terrasse, c'est juste.
Pour une salle, non : mesuré sur la graine 2026, elle rend un vrai chemin de **~30 jalons** qui
mène au **TOIT** de la salle.

Ce que ça donnerait sans garde, mesuré dans le banc de la garde elle-même : le PNJ élit la branche
de la salle, marche, et **se plante à 0,05 tuile du toit**. Il y resterait — `near` refuse le geste
(Q5), et le garde-fou qui relâche la corvée (`dropTask`) ne se déclenche que si AUCUN chemin
n'existe. La livelock que l'on redoutait pour `near` est réelle, mais elle est ICI, et seulement
pour les creux.

D'où l'accesseur **`dansUnCreux`** (`etages.ts`) : porter un étage explicite, c'est ne pas être au
palier de sa tuile (`poserLEtageDuCorps` ne l'écrit qu'à cette condition). Une seule loi, un seul
endroit, les sites l'appellent — comme E-R5 elle-même.

```ts
if ((dansUnCreux(n) || dansUnCreux(entity)) && !atteintLeSol(state.map, entity, n.tx, n.ty, n.etage)) continue
```

### LES TROIS GARDES (`etages-etancheite.test.ts`)

Une terrasse de laboratoire (palier 1 au nord, palier 0 au sud, **une** rampe), le village nu
d'`A10..A12` de `glanage.test.ts` posé en bas, et UNE branche en haut.

| garde | ce qu'elle affirme |
|---|---|
| LA PRÉMISSE | le village est au palier 0, la branche au palier 1, et E-R5 **dit non** à cette paire |
| LA TERRASSE | la branche du haut **se glane** — le PNJ prend la rampe pour de bon |
| LE CREUX | la branche de la salle ne s'élit pas — **et on ne s'en approche même pas** |

⚠ **LA JAMBE DU CREUX A DÛ CHANGER DE MESURE : sa première version ne pouvait pas échouer.** Elle
affirmait « la branche n'est pas glanée » — or `near` scelle l'interaction de toute façon, donc un
PNJ qui l'élirait, marcherait douze tuiles et se planterait sur le toit rendrait le MÊME stock
intact. Éprouvé : sceau retiré, la jambe passait au vert. C'est l'**APPROCHE** qui la fait
échouer — scellé, le village ne descend jamais sous **10,5 tuiles** ; sceau retiré, un PNJ vient à
**0,05**. Le seuil est posé entre les deux.

**Rougissement éprouvé, deux sens** : rendre le sceau à TOUS les nœuds (la loi d'avant) → la jambe
TERRASSE tombe, et elle seule ; le retirer entièrement → la jambe CREUX tombe, et elle seule.

### ✅ CE QUI RESTAIT — LA NAVIGATION PORTE L'ÉTAGE DEPUIS LE 2026-09-11

L'énoncé d'origine : *« La navigation ne porte pas l'étage (`setPathTo` → `pathToward` sans
`etageFrom`/`etageTo`). Tant que c'est vrai, aucune élection de destination ne peut viser un creux.
Le jour où on la corrige, la moitié creuse de la garde devient rouvrable — et c'est elle qui le
dira. »*

**`setPathTo` prend désormais `etage` en SIXIÈME argument, positionnel et obligatoire** — la
grammaire de `near` (Q5), et pour la même raison : un site qui l'oublierait retomberait en silence
sur le palier du sol, et `tsc` doit le refuser. Les **27 sites** le passent, et chacun passe
*exactement* ce que passe le `near` qui garde son geste, à un pas de là : `chest.etage`,
`station.etage`, `node.etage`, `fire.etage`, `target.etage`, `own.etage` — et `undefined` pour le
Foyer d'un village (il n'a pas d'étage) comme pour une corvée du tableau (elle vise la cour, au
sol, et la voisine libre élue juste avant l'a été par un `isBlockedAt` qui juge au palier).

**Le monde d'aujourd'hui est rendu jalon pour jalon.** `etage ?? palierDuSol(tx, ty)` EST le défaut
qu'avait `pathToward`, et `niveauDuCorps` sur un corps sans étage est le palier de sa tuile,
c'est-à-dire l'autre. Et le champ n'est renseigné que **sous la roche** : `village.ts` le dit —
*« au sol (niveau ≥ 0), la structure naît sans `etage` »*. Une terrasse, un chapeau de mesa, un
Foyer : tous `undefined`. Ce qui change, c'est donc *uniquement* ce qui était faux.

**Ce que ça répare, concrètement** : vers une cible d'un creux, l'A* ne repart plus au palier du
sol pour rendre un chemin de ~30 jalons **vers le toit**. Il vise l'étage réel — il rend `null`
quand rien n'y mène, et ce `null` fait relâcher la corvée chez les 27 appelants (`dropTask`,
`return false`, `done()`). Un refus franc au lieu d'un villageois figé à 0,05 tuile de sa cible.

**La garde (`etages-etancheite.test.ts`, bloc « E-R5 §23 »)** — une plaine nue, un village à
l'ouest, une salle à l'étage −1 à l'est, et la gueule posée ou non :

| jambe | ce qu'elle affirme |
|---|---|
| LA PRÉMISSE | la salle est bien sous la plaine, le villageois au sol, E-R5 dit non à la paire |
| LE TÉMOIN | la **même tuile**, visée à la surface, se rejoint sans détour — la garde ne peut pas passer au vert parce que « rien n'est joignable par ici » |
| LA SALLE SCELLÉE | sans gueule, `setPathTo` **refuse** et ne laisse pas un bout de chemin en poche |
| LE DÉFAUT D'AVANT | l'appel exact d'avant (`pathToward` à ses défauts) rendait un vrai chemin dont le **dernier jalon est à la surface** — le toit |
| LA SALLE OUVERTE | une gueule suffit : le chemin arrive sur la tuile visée **par le bas** (`etage === -1`) |

**Rougissement éprouvé** : rendre `setPathTo` de nouveau muet (`undefined, undefined` à
`pathToward`) → SALLE SCELLÉE et SALLE OUVERTE tombent, **et elles seules** ; prémisse, témoin et
défaut-d'avant restent verts.

`Npc.path` déclare maintenant `etage?: number`. **Additif au TYPE seulement** : `findPath` posait
déjà ce champ (*« un pas au sol reste `{tx, ty}` »*), le runtime ne bouge pas d'un bit.

### CE QUI RESTE

- **`followPath` est aveugle à l'étage** — il ne remplit pas `etages` dans son `MoveWorld` et
  n'appelle pas `poserLEtageDuCorps`, contrairement à l'avatar (`sim.ts`) et à la bête
  (`monsters.ts`, décision du 2026-09-01). **Le PNJ est donc le seul corps du jeu qui ne monte
  pas** : son chemin peut désormais descendre dans une salle, son corps ne l'y suivrait pas. C'est
  sans conséquence aujourd'hui — rien n'élit de cible dans un creux (E-R5 scelle l'élection, et le
  bâti n'y naît que si un joueur descend bâtir). **C'est une décision d'Alexis** : faire marcher
  les villageois entre les étages se VOIT (on les verrait prendre les rampes, entrer dans les
  grottes), et ce n'est pas une correction technique.
- **L'élection reste fermée aux creux** (E-R5, `dansUnCreux`) — rouverte pour les terrasses le
  2026-09-08, pas pour les salles.

### CE QUE ÇA DÉPLACE AU BANC — **RIEN QU'ON PUISSE LIRE À UN JOUR**, et c'est une leçon

Six graines, `runScenario` d'UN jour (36 000 ticks, 8 joueurs, le vrai worldgen), avant/après,
bois total des trois greniers :

| graine | avant | après | Δ | morts avant → après |
|---|---|---|---|---|
| 2026 | 9 | 23 | **+14** | 4 → 2 |
| 4242 | 22 | 49 | **+27** | 0 → 0 |
| 999 | 18 | 9 | **−9** | 0 → 0 |
| 7 | 77 | 37 | **−40** | 0 → 0 |
| 1234 | 71 | 71 | **0** | 0 → 0 |
| 31337 | 15 | 15 | **0** | 1 → 2 |

Somme des écarts : **−8 sur 212**. Les balancements par graine (±40) écrasent la moyenne : à un
jour, le banc **ne sait pas résoudre cet effet** — ce qu'il montre est du flux seedé
(`rng-fragile`), pas une direction. Deux graines ne bougent même pas d'une bûche : sur ces
cartes-là, les villages n'avaient pas de terrasse à portée.

⚠ **ET ÇA VAUT AUSSI POUR LE CHIFFRE QUI A OUVERT LA QUESTION.** Le §21 disait *« bois 36 → 20 sur
un village »* pour justifier que le sceau coûtait cher — **une graine, un village**. Le même
instrument, joué six fois, produit des écarts de ce calibre **dans les deux sens** à partir du
même changement. Ce nombre-là ne prouvait donc rien ; ce qui fonde la décision, c'est la mesure
d'ÉLECTION (quels nœuds sont coupés, et lesquels un chemin rejoint), pas le banc.

*Le banc reste vert : 0 affamé sur les six graines, avant comme après.*
