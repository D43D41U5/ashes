# Le Gel — le monde change d'état avec sa température, sans qu'une tuile ne bouge

*Source : demande d'Alexis 2026-08-19 (« nous avons une température locale en tout point ? si oui, je veux que ça impacte le sol et l'environnement, l'eau gèle, la végétation perd ses feuilles sauf les pins, ça fait persister la neige au sol »), décision actée le même jour (gel profond PRATICABLE, tard et lisible). Statut : **décidé, à implémenter**. S'appuie sur `temperature.md` et `meteo.md`.*

## Objectif de design

La température existe déjà **en tout point** (`baselineTemperature(state, x, y)`, fonction pure). Le monde doit maintenant s'en apercevoir : l'eau gèle, les feuillus se dénudent, la neige tient au sol. Au Grand Froid, la vallée ne se contente pas de mordre — **elle change de forme** : les gués se passent à pleine vitesse, puis les rivières et les lacs eux-mêmes deviennent des chemins. Le GDD §8 veut que le domestique s'appauvrisse et pousse tout le monde vers le contesté au moment où les tensions montent ; une vallée dont les barrières tombent sert exactement cette courbe.

## Le principe d'architecture (non négociable)

**TOUT EST DÉRIVÉ, RIEN N'EST STOCKÉ.** La carte est immuable pendant la partie (garde `carte-immuable.test.ts` : « mille ticks de monde vivant ne changent pas un bit de `map` »). Le gel suit le patron du FRONT DE CENDRE, qui dévore la vallée sans réécrire une tuile : un prédicat pur remplace un champ. Conséquences : zéro octet dans la sauvegarde et le snapshot, zéro risque de déterminisme, et le client lit LES MÊMES fonctions que la sim (doctrine de l'écrivain unique).

## Règles

### Le gel (G1-G4)

- **G1 — Le gel se juge sur le froid DU MONDE.** `estGele(state, x, y)` lit `baselineTemperature`, jamais `ambientTemperature`. Sinon un feu de camp dégèlerait le lac autour de lui et un PNJ qui s'approche ferait fondre la glace sous ses pas — c'est le raisonnement exact du gate d'attraction des Cendreux (spec feu-station S5). Le froid des fronts météo et de la Brume y entrent déjà par construction : **un blizzard gèle ce qu'il traverse**, et le dégèle en s'éloignant.
- **G2 — Deux seuils, deux promesses.** `GEL.SEUIL_GUE` (tiède) : l'eau PEU PROFONDE gèle — on ne patauge plus (`speedFactor` 0,5), on glisse (`GEL.VITESSE_GLACE`). `GEL.SEUIL_PROFOND` (nettement plus froid) : l'eau PROFONDE gèle et devient **praticable** — la carte change de forme. En pratique : les gués prennent dès les nuits froides d'acte II, les lacs attendent l'acte III et les blizzards.
- **G3 — Le gel ne change QUE la façon dont on marche dessus.** Il ne reclasse jamais une tuile : `isWater` reste vrai, le worldgen n'en sait rien (il tourne à la création, en acte I), et la règle « l'eau commande la faune » (spec faune R17, coins de chasse `nearWater`) lit toujours le terrain — **un lac gelé reste un point d'eau** pour le gibier et pour le placement. Sans cette règle, geler la vallée stériliserait la faune, ce qui n'est demandé nulle part.
- **G4 — Ce qui traverse, traverse pour tout le monde.** La marchabilité gelée vaut pour les avatars, les PNJ, les monstres et les champs de flux des hordes : une horde franchit la rivière gelée. C'est le prix — et l'intérêt — de la décision : un village protégé par une boucle d'eau perd ses douves au Grand Froid.

### La lisibilité (G5)

- **G5 — On ne s'engage jamais sur la glace par surprise.** La glace praticable se VOIT d'un coup d'œil (rendu dédié, teinte et grain distincts de l'eau libre) : c'est la contrepartie de « tard et lisible ». Le contrat maison « annoncé, pas surprise » vaut ici comme pour la météo — la carte a le droit de changer, jamais de mentir.

### La végétation (G6)

- **G6 — Les feuillus se dénudent, les conifères tiennent.** Sous `GEL.SEUIL_FEUILLES`, les terrains à feuilles caduques (`forest`, `willow`, `old_growth`) se rendent dénudés ; `pine` et `larch` gardent leur couvert. *(Le mélèze perd ses aiguilles en vrai — on l'aligne ici sur les conifères, par lisibilité : la silhouette du conifère doit dire « il tient ».)* **PUREMENT VISUEL au v1** : le `cover` du terrain, qui commande la furtivité et l'abri de la faune, NE bouge pas. Le rendre mécanique changerait la furtivité de toute la carte en acte III — c'est une décision d'équilibrage à part.

### La neige au sol (G7)

- **G7 — La neige tient après le front, puis fond.** Elle demande une MÉMOIRE, alors que la température est instantanée. Solution sans état : l'élection des fronts étant une fonction pure du cycle, `neigeAuSol(state, x, y)` rembobine les `GEL.MEMOIRE_CYCLES` derniers cycles et rend une couverture qui décroît avec le temps écoulé depuis le dernier front neigeux ayant couvert ce point — et qui fond d'autant plus vite que la température est haute. **PUREMENT VISUEL au v1** (pas de malus de vitesse : le froid ralentit déjà par `coldSpeedFactor`, et l'accumulation mécanique reste hors périmètre, cf. `meteo.md`).

## Critères d'acceptation

- **A1** — `estGele` est PURE : deux appels, même réponse, zéro mutation ; et `snapshot()` est bit-identique avant/après un balayage complet.
- **A2** — La carte reste immuable : `carte-immuable.test.ts` passe SANS retouche, gel actif, sur une saison entière.
- **A3** — Zéro tirage sur le PRNG d'état, zéro champ neuf dans `SimState` : le flux RNG est bit-identique avec et sans gel, et l'empreinte d'état ne bouge pas d'un octet.
- **A4** — Les deux seuils mordent DANS L'ORDRE : il existe des températures où le gué est gelé et le lac non ; jamais l'inverse (garde exhaustive sur le domaine de température, pas des points choisis).
- **A5** — Traversée : sous `SEUIL_PROFOND`, un avatar franchit une tuile d'eau profonde qui le bloquait au-dessus du seuil — et le chemin d'une horde la franchit aussi (la même loi, pas deux).
- **A6** — G3 tenu : `isWater` inchangé par le gel ; un coin de chasse près d'un lac gelé reste valide (le gibier ne disparaît pas quand la vallée gèle).
- **A7** — Un Feu ne dégèle rien : la glace sous et autour d'un feu actif est dans le même état qu'à dix tuiles (le gel lit la baseline, pas l'ambiant).
- **A8** — Un blizzard gèle ce qu'il traverse et le dégèle en s'éloignant (le froid météo entre bien dans la baseline).
- **A9** — G6 : sous le seuil, `forest`/`willow`/`old_growth` se rendent dénudés, `pine`/`larch` non ; et le `cover` du terrain n'a pas bougé (le v1 est visuel).
- **A10** — G7 : après le passage d'un front de neige, la couverture au sol décroît avec le temps et disparaît ; elle est PURE (aucun état), et nulle sans météo armée.

## Hors périmètre (et où ça revient)

- La glace qui CÈDE sous le poids (immersion, noyade) — écartée à la décision : exige une mécanique d'immersion qui n'existe pas.
- Le `cover` et la furtivité modulés par la feuillaison ; le malus de vitesse de la neige accumulée ; le gel qui bloque la pêche ou la boisson — chacun une décision d'équilibrage à part.
- La fonte qui laisse de la boue, les stalactites, la buée — plus tard.

## Ajouts à `balance.ts`

Bloc `GEL` (ordres de grandeur, à calibrer en jouant) : `SEUIL_GUE`, `SEUIL_PROFOND` (nettement plus bas), `SEUIL_FEUILLES`, `VITESSE_GLACE` (~1,1 — on glisse un peu plus vite que sur l'herbe), `MEMOIRE_CYCLES` (~3).
