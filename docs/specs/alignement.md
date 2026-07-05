# L'alignement — deux axes, le Feu coloré, Foyer et Meute

*Source : GDD §3 (alignement émergent), §13 (MVP : deux axes + Foyer/Meute ; Ermitage/Charognard en phase Vallée). Statut : **brouillon — proposition à valider**. Jalon : V8.*

## Objectif de design

L'identité morale d'un village **émerge des actes de ses membres** et se voit de loin dans la couleur de son Feu. Aucun choix déclaratif : des actes discrets, vérifiables, impliquant l'extérieur — pondérés par le coût réel, agrégés avec inertie. En V8, la vallée gagne ses premiers voisins à caractère : une Meute qui raide, un Foyer qui donne.

## Règles

### Les deux axes (R1-R3)

- **R1 — Chaque avatar porte `warmth` (−100..+100) et `engagement` (0..100)**, mus uniquement par des **actes envers l'extérieur** (un autre village). Rien d'interne ne compte (tuer un membre de son propre village = gouvernance, pas alignement — GDD règle d'or).
- **R2 — La table des actes** (`ALIGNMENT_ACTS`, balance) :

  | Acte (envers un extérieur) | Chaleur | Engagement |
  |---|---|---|
  | Donner à manger (`give`, ou déposer au grenier d'autrui) | +1/point de faim utile, **×3 si l'affamé est < 30**, **×2 en acte II, ×3 en III** (nourrir pendant le Grand Froid vaut cher) | + |
  | Bander un blessé extérieur | +15 | + |
  | Attaquer (premier sang) | −20 | + |
  | Riposter contre un agresseur | −2 (la riposte est presque gratuite) | + |
  | Tuer | −40 | + |
  | Détruire une structure d'autrui | −15 | + |

  Les dons plafonnent par la faim *utile* (gaver un repu ne vaut rien) — l'anti-farm par collusion attend le multi (Va2).
- **R3 — L'inertie du paquebot** : décroissance **linéaire** vers 0 de `ALIGNMENT_DECAY_PER_DAY` (4) points par jour de saison (liée au calendrier : testable en accéléré, et « dérive vers le neutre en cas d'inaction » gratuite). Un −60 se rachète en ~15 jours d'inaction, moins en agissant chaud — la rédemption en demi-saison du GDD.

### Le premier sang (R4)

- **R4 — Mémoire d'agression entre villages** : quand A (village X) frappe B (village Y) sans que Y ait frappé X depuis `AGGRESSION_MEMORY_TICKS` (1 cycle), X est **agresseur** : plein tarif (−20). Toute frappe de Y vers X pendant la mémoire est **riposte** (−2). Le faux premier sang provoqué reste vivant (GDD : c'est de la politique).

### L'agrégation : le Feu (R5-R6)

- **R5 — Le Feu du village** = moyenne des axes de ses membres, chacun **plafonné à ±`WARMTH_CAP_PER_HEAD` (50)** avant moyenne — un seul berserker ne fait pas virer le village. Recalculé toutes les 60 ticks. Le bannissement retire le banni de la moyenne au recalcul suivant (la purge anti-blanchiment à 7 jours attend Va2).
- **R6 — Archétypes MVP** : `warmth ≥ +40` et `engagement ≥ 20` → **Foyer** ; `warmth ≤ −40` et `engagement ≥ 20` → **Meute** ; sinon **neutre**. Zones de transition assumées.

### Les effets (R7-R8) — continu pour les stats, paliers pour les capacités

- **R7 — Continu** : la régénération de PV des membres est modulée par la chaleur du Feu (de ×0.75 à ×2 sur l'axe −100..+100) — le village bienveillant soigne.
- **R8 — Paliers** : **Foyer** → structures bâties +25 % PV, mais **malus offensif** : dégâts ×0.6 contre un extérieur non-agresseur (le Foyer a une milice féroce, pas une armée d'invasion — l'interdiction formelle d'initier un raid attend Va3). **Meute** → dégâts ×1.2 contre les extérieurs, mais **économie anémique** : rendements de récolte ×0.75 (le prédateur dépend de ses proies).

### La lisibilité (R9)

- **R9 — La couleur du Feu** : le client teinte le Feu du bleu (chaud) au blanc (neutre) au rouge (froid), lueur croissant avec l'engagement. Le HUD montre l'archétype et la tendance — **jamais la formule ni le log** (prévisible dans le sens, flou dans la magnitude : on affiche des mots, pas les nombres exacts).

### Le don devient possible (R10-R11)

- **R10 — L'action `give { targetEntityId, item, count }`** : remettre des items en main propre, à portée. L'acte chaud fondamental.
- **R11 — Les coffres acceptent les dépôts de tous** ; seul le **retrait** exige l'accès. Déposer au grenier d'un autre village = un don (acte chaud si nourriture et besoin). La boîte aux dons est née — et le vol reste impossible sans casser le coffre.

### Les villages à caractère (R12-R14)

- **R12 — `foundNpcVillage` gagne une disposition** (`foyer` | `meute` | `neutre`) qui ensemence la chaleur des PNJ (±60). Leur comportement suit leur archétype — y compris pour le village du joueur si son Feu vire.
- **R13 — La Meute raide** : à la nuit, 2 PNJ d'un village Meute partent vers le village voisin le plus proche : ils attaquent qui les intercepte, **cassent le grenier** (un coffre détruit répand son contenu en cadavre lootable), ramassent, rentrent, déposent. À l'aube ils décrochent. Le premier raid du jeu — PNJ, mais avec les vraies règles.
- **R14 — Le Foyer donne** : au matin, si son grenier est confortable, 1 PNJ d'un village Foyer porte 5 baies au grenier du voisin le plus proche (dépôt ouvert, R11) et rentre. Le commerce attend le troc ; la générosité, non.

## Critères d'acceptation

- **A1** — Les actes bougent les axes selon la table : nourrir un affamé extérieur en acte II > le même don en acte I > donner à un repu (≈0) ; attaquer descend et engage.
- **A2** — Premier sang : A frappe B → A −20 ; B riposte → B −2 seulement ; passé la mémoire, une frappe de B redevient une agression.
- **A3** — L'inertie : sans actes, la chaleur revient linéairement vers 0 au rythme paramétré (testé en calendrier accéléré) ; bornes ±100 respectées.
- **A4** — L'agrégation : un berserker à −100 dans un village de 4 ne tire le Feu qu'à −12.5 (plafond par tête) ; son bannissement rend le Feu neutre au recalcul.
- **A5** — Les paliers : un village poussé en Foyer régénère ×2 et frappe ×0.6 les non-agresseurs ; en Meute, récolte ×0.75 et frappe ×1.2 l'extérieur.
- **A6** — Le dépôt est ouvert (don au grenier d'autrui accepté, acte chaud) ; le retrait reste verrouillé.
- **A7 — LE test (roadmap)** : (a) un joueur qui nourrit les PNJ affamés d'un village voisin sur plusieurs jours voit sa chaleur puis le Feu de son village monter — le paquebot vire lentement ; (b) un village PNJ `meute` monte un raid nocturne : grenier voisin cassé, butin rapporté, alarme levée chez la victime, chaleur des raiders en baisse.
- **A8** — Déterminisme et replay exacts avec alignement, dons et raids actifs.

## Hors périmètre (et où ça revient)

- Ermitage, Charognard, Effacement/Serrage → Phase Vallée (Va4).
- Cicatrices, profil public, historique d'appartenance → Va2 (avec les vrais joueurs).
- Purge de bannissement à 7 jours, anti-farm par paires de villages → Va2 (multi).
- Racket, ultimatums, capacités de palier avancées (tribunal, marché franc) → Vallée.
- Chronique consommant ces événements → V9.

## Ajouts à `balance.ts`

`ALIGNMENT` : table des actes (don ×faim utile ×acte, soin +15, premier sang −20, riposte −2, meurtre −40, destruction −15), `DECAY_PER_DAY = 4`, `AGGRESSION_MEMORY_TICKS` (1 cycle), `WARMTH_CAP_PER_HEAD = 50`, seuils d'archétype (±40 chaleur, 20 engagement), effets (régén ×0.75..×2, Foyer : structures +25 % PV / dégâts ×0.6, Meute : récolte ×0.75 / dégâts ×1.2), `GIFT_BERRIES = 5`, cadence de recalcul du Feu (60 ticks).
