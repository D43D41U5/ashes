# Le Gel — le monde change d'état avec sa température, sans qu'une tuile ne bouge

> **⚠ AMENDÉ le 2026-08-23 par `saisons.md` (S4/S5/S10/S14) — lire cette spec-là avant les nombres d'ici.** Le socle de température est une COURBE du jour de l'année (plus une table de trois actes) et l'écart jour/nuit une autre : les seuils G2 n'ont pas bougé mais leur PREUVE se réénonce en moments de l'année. La défeuillaison (G6) a désormais DEUX fenêtres — les feuilles repoussent. Et l'eau a un niveau SIGNÉ : ce que le gel durcit, la sécheresse le retire à l'autre bout de l'année.

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

- **G6 — Les feuillus se dénudent, les conifères tiennent — AU RYTHME DE LA SAISON.** La feuillaison suit le JOUR DE SAISON (et donc l'acte), **jamais la température instantanée** : un arbre ne refait pas ses feuilles parce qu'un front tiède est passé, et keyer sur l'instant ferait clignoter toute la forêt à chaque nuit et à chaque lisière de front. Les terrains à feuilles caduques (`forest`, `willow`, `old_growth`) se rendent progressivement dénudés à partir de `GEL.JOUR_DEFEUILLAISON` ; `pine` et `larch` gardent leur couvert. *(Le mélèze perd ses aiguilles en vrai — on l'aligne ici sur les conifères, par lisibilité : la silhouette du conifère doit dire « il tient ».)* **PUREMENT VISUEL au v1** : le `cover` du terrain, qui commande la furtivité et l'abri de la faune, NE bouge pas.

### La neige au sol (G7)

- **G7 — La neige tient après le front, puis fond.** Elle demande une MÉMOIRE, alors que la température est instantanée. Solution sans état : l'élection des fronts étant une fonction pure du cycle, `neigeAuSol(state, x, y)` rembobine les `GEL.MEMOIRE_CYCLES` derniers cycles et rend une couverture qui décroît avec le temps écoulé depuis le dernier front neigeux ayant couvert ce point — et qui fond d'autant plus vite que la température est haute. ~~PUREMENT VISUEL au v1~~ — **amendé par G9 (2026-08-22)** : la neige a deux hauteurs et commande le pas.
- **G7bis — LA CENDRE BOIT LA NEIGE** (décision d'Alexis 2026-08-29). Une tuile cendrée ne porte JAMAIS de neige : ce qui y tombe est bu en permanence. Le prédicat est `tuileCendree` — le MÊME que celui qui peint le sol cendré, donc la neige s'arrête exactement à la lisière dessinée, grain compris — et par l'écrivain unique (`neigeAuSol` y rend 0) tout en découle : le manteau ne s'y peint pas, le pas y redevient celui du sol cendré (`solFoule`), les cimes ne s'y coiffent pas (G6 bis). La neige TOMBE toujours à l'écran au-dessus de la cendre (l'aspect du ciel est une autre loi, R11 de `meteo.md`) : elle est bue au sol, pas déviée du ciel.

### Le dégel (G8)

- **G8 — LE DÉGEL A DE L'HYSTÉRÉSIS, ET IL NE PIÈGE PERSONNE.** L'eau PREND sous son seuil, mais elle ne DÉGÈLE qu'au-dessus de `seuil + GEL.HYSTERESIS`. Sans cette marge, une température qui oscille autour du seuil — l'aube, le crépuscule, la lisière d'un front qui passe — ferait clignoter la glace d'un tick à l'autre. L'hystérésis se lit sur l'état PRÉCÉDENT de la tuile ; comme rien n'est stocké, on la dérive de la température d'un instant de référence proche (le tick courant contre le tick précédent de la même tuile, ou la borne du créneau) — **jamais d'un champ**. *Conséquence de jeu voulue : la carte se REFERME derrière ceux qui l'ont traversée. Une bande qui a franchi le lac dans la nuit peut se retrouver du mauvais côté au matin — le pendant exact de l'ouverture, et ce qui donne son prix à la date du gel.*
- **G8bis — Personne ne reste emmuré.** Un acteur (avatar, PNJ, monstre) qui se trouve sur une tuile au moment où elle dégèle est REPLIÉ sur la tuile marchable la plus proche — patron du repli des traînards de la Brume. Jamais bloqué à l'intérieur d'une tuile non marchable : c'est le bug maison du feu qui emmure un acteur centré dessus. On ne fait PAS céder la glace (immersion/noyade écartées à la décision du 2026-08-19).
- **G9 — LA NEIGE A DEUX HAUTEURS, ET ELLE COMMANDE LE PAS** (décision d'Alexis 2026-08-22 — amende la clause « purement visuel » de G7). La couverture continue de `neigeAuSol` devient, tuile par tuile, un **niveau** (`niveauDeNeige`) : 0 nue, 1 **poudreuse**, 2 **jusqu'aux genoux**. Le seuil d'une tuile est POSITIONNEL (`seuilDeNeige` : un bruit à l'échelle de `GEL.NEIGE_PLAQUES_TUILES`, plus une gigue par tuile — des hachages, jamais le PRNG d'état) : les plaques se ferment depuis leurs cœurs quand la neige monte, s'ouvrent par les bords quand elle fond ; la profonde est le **cœur** d'une plaque (la couverture y dépasse le seuil de `GEL.NEIGE_PROFONDE`). L'eau, libre ou gelée, n'en porte jamais (la glace doit se VOIR, G5). **Le pas** : `vitesseSurNeige` — poudreuse `GEL.VITESSE_POUDREUSE` (0,95), genoux `GEL.VITESSE_GENOUX` (0,75) — **remplace** le `speedFactor` du terrain, ne le multiplie pas : une route sous la neige n'est plus une route, un marais sous la poudreuse n'enlise plus. La glace prime (G2), puis la neige, puis le terrain. Une seule loi pour le pas (sim, PNJ, prédiction client) et pour ce qui se peint (`render/manteau.ts`) : ce qu'on voit sous ses pieds est ce qui ralentit. **La neige est une couche DE PLUS sur le sol** (Alexis) : elle monte sur ce qui s'y tient — le corps ne descend jamais, il se coupe de la hauteur du manteau et son ombre se pose dessus (`sol-dessine.md` R16).

## Critères d'acceptation

- **A1** — `estGele` est PURE : deux appels, même réponse, zéro mutation ; et `snapshot()` est bit-identique avant/après un balayage complet.
- **A2** — La carte reste immuable : `carte-immuable.test.ts` passe SANS retouche, gel actif, sur une saison entière.
- **A3** — Zéro tirage sur le PRNG d'état, zéro champ neuf dans `SimState` : le flux RNG est bit-identique avec et sans gel, et l'empreinte d'état ne bouge pas d'un octet.
- **A4** — Les deux seuils mordent DANS L'ORDRE : il existe des températures où le gué est gelé et le lac non ; jamais l'inverse (garde exhaustive sur le domaine de température, pas des points choisis).
- **A5** — Traversée : sous `SEUIL_PROFOND`, un avatar franchit une tuile d'eau profonde qui le bloquait au-dessus du seuil — et le chemin d'une horde la franchit aussi (la même loi, pas deux).
- **A6** — G3 tenu : `isWater` inchangé par le gel ; un coin de chasse près d'un lac gelé reste valide (le gibier ne disparaît pas quand la vallée gèle).
- **A7** — Un Feu ne dégèle rien : la glace sous et autour d'un feu actif est dans le même état qu'à dix tuiles (le gel lit la baseline, pas l'ambiant).
- **A8** — Un blizzard gèle ce qu'il traverse et le dégèle en s'éloignant (le froid météo entre bien dans la baseline).
- **G6 bis — LA COIFFE DE NEIGE DES PERSISTANTS** (demande d'Alexis, 2026-08-25 ; détail dans `saisons.md` S19). Le feuillu résout l'hiver par la silhouette (il se dénude) ; le conifère gardait la même cime douze mois sur douze et ne prenait pas non plus la teinte de la saison — il était la seule chose du paysage que le Grand Froid ne touchait pas. Sa cime porte désormais une coiffe de neige en **deux charges**, pilotée par la couverture `neigeAuSol` échantillonnée au PEUPLEMENT (jamais `niveauPourCouverture`, qui est fait pour moucheter le sol). Elle se pose SUR la cime sans la déformer : la silhouette est identique au pixel près, donc rien de ce qui en dépend (assise, tri en Y, feuilles qui tombent) ne bouge. **Un caduc ne se coiffe jamais et un persistant n'est jamais nu** — l'exclusion est portée par le type `EtatCime`, pas par un garde-fou.

- **A9** — G6 : sous le seuil, `forest`/`willow`/`old_growth` se rendent dénudés, `pine`/`larch` non ; et le `cover` du terrain n'a pas bougé (le v1 est visuel).
- **A11** — G8 hystérésis : sur un balayage exhaustif de températures qui MONTENT puis DESCENDENT autour du seuil, la glace ne change jamais d'état plus d'une fois par franchissement — zéro clignotement (garde sur le domaine, pas sur des points choisis).
- **A12** — G8bis : un avatar debout sur une tuile d'eau profonde qui dégèle se retrouve sur une tuile MARCHABLE, jamais dans l'eau ; idem pour un PNJ et un monstre. Et il en va de même quand un front tiède efface le gel qu'un blizzard avait posé.
- **A13** — G6 ne clignote pas : sur une saison entière jouée nuit et jour, l'état de feuillaison d'une tuile de `forest` est MONOTONE (il ne repasse jamais de dénudé à feuillu), et `pine`/`larch` ne changent jamais.
- **A10** — G7 : après le passage d'un front de neige, la couverture au sol décroît avec le temps et disparaît ; elle est PURE (aucun état), et nulle sans météo armée.
- **A14** — G9 (`gel-neige.test.ts`) : le seuil est borné et positionnel, le niveau MONOTONE en couverture ; à couverture pleine le manteau est fermé et 30-60 % en est profond, **par plaques** (< 5 % de tuiles profondes isolées) ; la profonde a un seuil plus bas que toute poudreuse (c'est le cœur) ; après un vrai front neigeux, l'eau ne porte jamais de neige ; `moveAvatar` avance de ×0,95 / ×0,75 sur une route ET sur l'herbe enneigées (« quel que soit le terrain ») et la route garde ×1,25 sans neige.

## Hors périmètre (et où ça revient)

- La glace qui CÈDE sous le poids (immersion, noyade) — écartée à la décision : exige une mécanique d'immersion qui n'existe pas.
- Le `cover` et la furtivité modulés par la feuillaison ; le gel qui bloque la pêche ou la boisson — chacun une décision d'équilibrage à part. *(Le malus de vitesse de la neige est ENTRÉ au périmètre le 2026-08-22 : G9.)*
- La fonte qui laisse de la boue, les stalactites, la buée — plus tard.

## Ajouts à `balance.ts`

Bloc `GEL` (ordres de grandeur, à calibrer en jouant) : `SEUIL_GUE`, `SEUIL_PROFOND` (nettement plus bas), `VITESSE_GLACE` (~1,1 — on glisse un peu plus vite que sur l'herbe), `MEMOIRE_CYCLES` (~3), `HYSTERESIS` (la marge de dégel), `JOUR_DEFEUILLAISON` (le jour de saison où les feuillus commencent à se dénuder). *(`SEUIL_FEUILLES`, cité ici à l'origine, n'existe plus : la borne chaude de la fonte est `TEMPERATURE.AMBIANT_DOUX` depuis le passage en °C — 2026-08-22.)*
