# La nuit noire — ce que le noir prend au corps

*Source : décision d'Alexis du 2026-08-26 (« la sortie dehors la nuit doit être dure. trouve une solution pour qu'on ait une vraie pression qui fait qu'on ne sorte pas en nouvelle lune sans torche sans mourir vite »), à la suite immédiate de la lune traversant le ciel (2026-08-26) et de la torche (`torche.md`, 2026-08-26). Amende `tension.md` (la nuit qui chasse gagne un second étage), `torche.md` (la torche cesse d'être un pur fait de rendu). Statut : **implémentée le 2026-08-26**. Jalon : calibrage Veillée / GATE 1.*

---

## Le besoin

La nuit d'ASHES avait tout sauf des dents. En trois jours elle a gagné la lune (23 phases, un voile qui monte à 0,97 à la nouvelle lune), puis la torche (« la seule lumière qui marche »). Mais **le cadran ne commandait rien** : la lune était un fait de RENDU, `/sim` ne savait pas qu'elle existait, et la valeur de jeu de la torche se réduisait à « voir le sol devant soi ». On pouvait traverser la vallée à la nouvelle lune, à l'aveugle, exactement comme sous la pleine — le jeu n'en pensait rien.

> **Le principe unique de cette spec : le noir ne rend pas les monstres plus forts, il rend le CORPS plus faible ; et la lumière, d'où qu'elle vienne, le lui rend.**

## Ce que ce n'est PAS — et pourquoi c'est vital

`bible-diegetique.md` I3 : *le Feu ne devient jamais un ward*. Les trois interdits de `torche.md` disent la même chose côté objet : elle ne chauffe pas, elle ne repousse rien, elle ne s'allume qu'au Feu.

Cette spec **ne les rouvre pas**. Aucun monstre ne se comporte différemment selon qu'on porte une flamme : ni portée d'acquisition, ni agressivité, ni cadence de chasse. Les mondes jumeaux de `torche.test.ts` (T-A/T-B) continuent de le prouver au bit près.

Ce qui change est **du côté du joueur** : sous un seuil de clarté, son corps perd deux capacités de base. Le jour, la pleine lune, le coin du feu et la torche en main sont tous au MÊME niveau — c'est le noir qui est l'écart, jamais la lumière qui serait un bonus.

---

## Les règles

### La clarté

- **N1 — LA CLARTÉ SUR SOI est le MAX de trois sources**, jamais leur somme (deux torches n'éclairent pas deux fois) : **le ciel** (le jour à plein, la nuit ce que la lune en laisse), **le feu** (sa bulle de chaleur, `TEMPERATURE.FIRE_RANGE` = 6 tuiles — ce qui chauffe éclaire, un seul rayon à calibrer, et c'est déjà le trou que le client perce dans le voile), **la torche vive en main** (à bout de bras : 1 sur son porteur).
- **N2 — LA LUNE ENTRE DANS `/sim`** (`nuit.ts`) : période, ancrage et phase (`LUNAISON_JOURS` = 23, `LUNE_PLEINE_JOUR` = 61 = le jour d'ouverture du monde) y vivent désormais, et `render/lighting.ts` les RÉEXPORTE au lieu de les redéclarer. `Math.cos` étant interdit dans `/sim` (invariant §2), la part éclairée du disque y est **tabulée** sur une demi-lunaison et interpolée — écart maximal **0,0042** contre le cosinus exact, et les deux bouts sont EXACTS (0 à la neuve, 1 à la pleine).
- **N2bis — DEUX COURBES, ET UN ORDRE QUI LES TIENT.** Le client GARDE son cosinus exact pour peindre : on ne glisse pas une approximation sous un voile calibré à l'œil la veille. Ce qui rend la cohabitation sûre n'est pas leur égalité mais un ordre, mesuré heure par heure : la règle IGNORE l'altitude de l'astre, donc `clarté_sim ≥ lueur_écran` à toute heure — **le noir ne mord jamais sur un écran clair.** C'est cet invariant-là qu'un changement de l'une ou l'autre courbe doit préserver.
- **N3 — LE NOIR TOMBE, IL NE CLAQUE PAS.** La clarté du ciel se lit sur une rampe, jamais sur `isNight` : « annoncés, pas surprises » (GDD §9bis). La rampe est celle de `partDeNuit` — celle du FROID —, **recentrée d'une demi-largeur** : le froid traîne après l'aube, la lumière non. *Mesuré contre l'écran (voile du client, jour 72) : sans ce recentrage, à 6 h la règle lisait 0,009 quand l'écran était à 0,556 — une heure entière où le jeu aurait refusé de courir à un joueur qui voit le jour se lever. **Le résidu, lui, est au CRÉPUSCULE et il est assumé** : à 20 h la règle lit 0,375 quand l'écran est à 0,528, donc elle mord vers 20 h 10 sur un écran encore à ~0,47 — une avance de trente à quarante minutes sur le noir peint. C'est le sens du jeu (à la tombée du jour, on rentre), et c'est le premier chiffre à regarder si la nuit paraît commencer trop tôt.*

### Le prix

- **N4 — SOUS `NUIT.SEUIL_NOIR`, LE SPRINT EST REFUSÉ.** Refusé, pas ralenti : le patron du palier LOURD (`portage.md` P6), et c'est ce qui rend la règle lisible sans une ligne d'interface — on appuie, le corps ne suit pas.
- **N5 — SOUS LE MÊME SEUIL, LA PARADE EST REFUSÉE.** On ne pare pas ce qu'on ne voit pas. Une seule règle, deux lectures : `speedScaleFor` et le drapeau `entity.blocking` jugent sur le MÊME nombre, lu une fois par corps et par tick.
- **N6 — LE PÉRIMÈTRE EST L'AVATAR**, jamais les PNJ ni les monstres — le même périmètre que la chasse nocturne (`nighthunt.preys`) et pour la même raison (le GDD veut d'abord un solo qui tienne). C'est aussi ce qui borne le coût : `fireBubble` balaie les structures, et il ne le fait que pour une poignée de corps par tick.

### Pourquoi CES deux capacités — la mesure qui les désigne

Les deux prédateurs de la nuit se sèment de deux façons différentes :

| | vitesse | dégâts | ce qui sauve, aujourd'hui |
|---|---|---|---|
| l'avatar | 4 t/s (marche) · **6 en sprint** | — | — |
| le **loup** | **4,8 t/s** | 14 | **le sprint** — il est la seule chose qui le sème |
| le **cendreux** | 1,3 t/s | **34** | **la parade** (`BLOCK_REDUCTION` 0,7 : 34 → 10) |

Retirer le sprint seul aurait laissé le Cendreux inoffensif (on le sème à la marche) ; retirer la parade seule aurait laissé le loup impuissant (il ne rattrape pas un sprinteur). **Il faut les deux, et c'est la mesure qui le dit** — pas un goût. Une pénalité de dégâts, elle, aurait durci les deux de la même façon sans rien dire au joueur de ce qu'il fait de travers.

### Le rythme

- **N7 — LE CADRAN EST MENSUEL, ET IL SE LIT DANS LE CIEL.** À `SEUIL_NOIR` = 0,3, la vallée est aveugle **huit nuits sur vingt-trois** : une semaine par lunaison où sortir exige une flamme, quinze où la lune suffit. Le monde ouvrant **sur la pleine lune** (jour 61), la première nuit aveugle tombe au **jour 69** — le joueur a une semaine pour s'installer avant que le noir n'arrive.

---

## Critères d'acceptation

*(`packages/sim/src/nuit.test.ts` — 21 tests. Les gardes du prix se jouent sur `step()` et non sur `speedScaleFor` appelée à la main : la règle vit dans l'espace entre la posture, la clarté et l'allure.)*

- **L1** — Les deux bouts de la courbe sont EXACTS : 1 à la pleine lune, 0 à la neuve.
- **L2** — La table SUIT le cosinus qu'elle remplace : écart ≤ 0,005 sur toute la lunaison (0,0042 mesuré).
- **L3** — Le monde OUVRE sur la pleine lune (`BALANCE.JOUR_DE_DEPART`) — la promesse de `saisons.md` S2, gardée ici parce que c'est elle qui rend la première semaine clémente.
- **L4 / L5** — La lunaison boucle sur 23 jours, rien ne sort de [0, 1], et la courbe croît sans un cran de la neuve à la pleine.
- **C1 → C4** — Le ciel : 1 en plein jour quelle que soit la lune ; au cœur de la nuit, exactement ce que la lune laisse ; la nouvelle lune est le fond du noir ; et **aucun mur** sur le cycle entier (balayage tous les 40 ticks, pas maximal < 0,05 — un `if isNight` s'y verrait d'un coup).
- **C5** — La clarté ne consomme AUCUN tirage : le flux seedé ne bouge pas d'un pas.
- **S1 → S3** — Les trois sources : la torche vive éclaire à plein et la torche éteinte n'éclaire rien ; le feu éclaire et DÉCROÎT jusqu'au bord de sa bulle ; un feu éteint n'éclaire pas.
- **P1 → P4** — Le prix : sous la pleine lune on court (la torche est inutile) ; sous la neuve le sprint est refusé et le pas reste entier ; la torche vive rend les jambes, la torche éteinte non ; le coin du feu aussi.
- **P5** — La parade tombe avec les jambes, et revient avec la flamme.
- **P6** — EN PLEIN JOUR, la règle n'existe pas, même à la nouvelle lune.
- **P7 — LA PRÉMISSE, gardée à part** : le loup est plus rapide qu'un marcheur ET plus lent qu'un coureur ; le cendreux est plus lent qu'un marcheur mais frappe plus fort que le loup. Le jour où l'un de ces nombres bouge, c'est ici qu'on l'apprend — et pas dans une partie où la nuit serait devenue inoffensive.
- **P8** — Le seuil DÉCOUPE la lunaison : quelques nuits aveugles, la majorité claires. Une valeur qui rendrait toutes les nuits noires (ou aucune) serait un cadran mort.

## Ce que le joueur en voit

- **Le refus se dit une fois, et il se redit la nuit suivante** (`WorldScene.direLeNoir`) : « Trop noir pour courir ou parer — il faut une flamme. » Le drapeau se relève dès que la clarté repasse le seuil. Ce n'est pas un tutoriel (2026-08-25) : c'est le canal de REFUS, celui qui explique un geste qui vient d'échouer.
- **Le menu pause porte la règle en permanence** (section « LA NUIT »), avec la parade — et il nomme enfin le geste d'allumage de la torche, que rien ne documentait depuis sa livraison.
- **La prédiction locale connaît la règle** (`clarteSurSoiAt`, 4ᵉ argument de `speedScaleFor`) : sans elle, le client prédirait une course que l'autorité refuse, et l'avatar serait rappelé en arrière à chaque snapshot — la nuit, poursuivi, c'est-à-dire au pire moment.

## Hors périmètre

- **Aucun changement de monstre.** Ni portée, ni agressivité, ni cadence : la chasse nocturne (`nighthunt.ts`) tire exactement comme avant. Faire suivre la lune à `NIGHT_HUNT.CHANCE_PER_MIN` est un SECOND levier, volontairement non livré — il déplacerait des issues de tirage sur le flux seedé (donc les bancs et les replays), alors que le cadran commande déjà par le corps. À rouvrir si le playtest trouve la pression trop douce.
- **Pas de pénalité de visée ni de dégâts.** Voir « pourquoi ces deux capacités ».
- **Les PNJ ne sont pas concernés** (N6). Ils vivent au feu ; le jour où ils voyageront la nuit, la question se rouvrira avec eux.
