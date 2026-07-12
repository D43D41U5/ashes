# Le geste de récolte — viser, frapper, sentir que ça porte

*Source : GDD §8 (économie de flux), spec `economie.md` (R4-R5, le rendement), spec `client.md` (le client est bête). Statut : **en cours** (2026-07-12). Jalon : consolidation avant le chantier « l'établi » (craft).*

## Objectif de design

`economie.md` dit ce qu'une récolte PRODUIT. Il ne dit rien de ce qu'elle *fait au joueur* — et c'est là que ça pèche. Aujourd'hui, récolter, c'est : viser une tuile qu'aucun signe ne désigne, dans une portée qu'aucun signe ne montre, en martelant un clic par unité, sans qu'à l'écran rien ne bouge quand le coup porte. **Et un clic qui rate ne fait pas rien : il tente de bâtir un mur.**

Cette spec ne touche pas à l'économie. Elle rend le geste *lisible*, *tenable* et *sûr* — c'est le préalable au craft : on ne peut pas régler une chaîne de production dont le premier maillon est pénible.

## Le problème d'origine, en clair

`input-bindings.ts` résout le clic gauche ainsi : cadavre → nœud → **sinon `build`**. La construction est donc le **cas par défaut** du clic dans le monde. Conséquence : viser un arbre et tomber une tuile à côté ne produit pas un « rien », mais une tentative de poser une structure. Aujourd'hui l'échec est masqué (« sans village — allumer un Feu d'abord ») ; dès qu'un Feu brûle et que le bois rentre, **un clic de travers en pleine coupe posera réellement un mur**. Le piège est armé, il attend le playtest.

## Règles

### Bâtir devient un MODE, la récolte redevient le geste nu

- **G1 — Le clic nu ne bâtit JAMAIS.** Hors mode construction, le clic gauche ne peut que récolter un nœud, looter un cadavre, ou ne rien faire. Aucune retombée sur `build`.
- **G2 — `B` fait défiler les structures ET l'état désarmé** : `rien → mur → porte → coffre → atelier → four → rien`. « Rien » est un état à part entière, et c'est l'état de départ. `selected` devient donc `Buildable | null` — le type porte le mode, il n'y a pas de booléen à tenir en cohérence à côté.
- **G3 — Le mode armé se VOIT** : un fantôme translucide de la structure suit la tuile visée. Il vire au rouge si la pose est impossible (hors portée, tuile occupée). Clic droit ou `B` jusqu'à « rien » désarme.

### Le marteau fait le bâtisseur

- **G12 — Bâtir exige LE MARTEAU DE CONSTRUCTION EN MAIN.** Nouvel item (`hammer`), craftable. Même règle que le filon qui exige la pioche (`economie.md` R5) : l'outil doit être TENU, pas dormir au fond du sac. Bâtir cesse d'être le geste par défaut du clic pour devenir un **métier qu'on s'équipe** — et c'est la garde de fond derrière G1 : même si le client se trompait, la sim refuserait.
- **G13 — Il se forge AU FEU, pas à l'atelier.** Ce n'est pas un détail de goût : bâtir exige déjà un village, donc un Feu allumé (`light_fire`, gratuit). Le mettre à l'atelier créerait un **blocage circulaire** — il faudrait bâtir l'atelier pour pouvoir bâtir. Au Feu, il n'ajoute AUCUNE porte : qui peut bâtir peut le forger. Coût : bois 4 + pierre 2 + fibre 2.
- **G14 — Ranger le marteau DÉSARME le mode.** Le mode ne survit pas à l'outil qui le porte : sinon le fantôme mentirait, et le clic partirait se faire refuser. Le client ne fait ici que MIROIR de la règle sim (G5).

### On voit ce qu'on vise

- **G4 — La tuile visée est surlignée**, et elle seule. Le surlignage dit *ce qui va se passer* : un nœud récoltable à portée s'éclaire ; le même nœud hors de portée (`INTERACT_RANGE`) se grise. Rien sous le curseur → rien ne s'allume.
- **G5 — Le surlignage est un pur miroir du client.** Il n'invente aucune règle : la portée vient de `BALANCE.INTERACT_RANGE`, le nœud du snapshot. Si la sim refuse quand même, la sim a raison (invariant §3).

### Le clic se tient, il ne se martèle pas

- **G6 — Récolte au clic MAINTENU** : bouton enfoncé, le coup se répète tant que le curseur vise un nœud à portée, **à la cadence du rechargement** (`GATHER_COOLDOWN_TICKS`). Relâcher arrête.
- **G7 — Le maintien n'INONDE PAS la sim.** Le client cadence lui-même ses envois : il n'émet pas une `harvest` par frame pour se faire rejeter 19 fois sur 20 par « trop tôt ». Un refus n'est pas gratuit — c'est un `SimEvent` (`action_rejected`) que la chronique et l'alignement consomment. Le flux d'événements n'est pas une poubelle.
- **G8 — La cible se ré-évalue à chaque coup**, pas une fois au clic : le nœud s'épuise, le curseur bouge, la caméra glisse encore. On récolte ce qu'on vise MAINTENANT, sinon on ne récolte rien.

### Le coup se sent

- **G9 — Le retour de frappe naît de l'ÉVÉNEMENT, pas du geste.** Le client n'affiche un impact que sur `resource_harvested` reçu dans le snapshot (le protocole les transporte déjà). On ne prédit pas un succès qu'on n'a pas : le clic optimiste qui affiche « +1 bois » avant le refus de la sim est un mensonge.
- **G10 — Deux signes, pas plus** : le nœud TRESSAILLE (bref décalage, amorti), et le butin s'inscrit dans le HUD en **toasts empilés façon Rust** (« +2 BOIS (14) »), juste au-dessus des vitales. Sobre : ça arrive une fois par seconde pendant toute une partie.
  - *Le butin a d'abord été affiché AU-DESSUS DU NŒUD, dans le monde. Ça marchait — la donnée le prouvait — mais dans une forêt dense, un petit texte blanc sur du feuillage vert sombre est illisible. Le butin se lit à une place FIXE que l'œil apprend.*
  - **La FUSION est le point dur** : on récolte un coup toutes les ~600 ms ; sans fusion, abattre un arbre empilerait dix lignes « +1 BOIS ». Une récolte du même item réanime sa ligne et lui AJOUTE son compte. Le total entre parenthèses est relu du SAC (borné, il peut écrêter) — jamais d'un compteur maison qui divergerait.

### Le rendement

- **G11 — Le rendement ne se change pas à l'intuition.** `balance.ts` est un jeu d'ordres de grandeur calibrés en playtest (CLAUDE.md). Une fois G6 en place, le matraquage disparaît de lui-même : la question « 10 coups pour un arbre, est-ce trop ? » ne se pose plus dans les mêmes termes. On MESURE d'abord (temps pour vider un nœud, temps jusqu'à la première hache, en pilotant le vrai jeu), on propose ensuite, chiffres en main.

## Critères d'acceptation

- **A1** — Mode désarmé (`selected === null`, l'état de départ) : un clic sur une tuile vide n'émet **aucune** action. Prouvé par un test pur sur le résolveur de clic (`clickToAction`), pas seulement à l'œil.
- **A2** — `B` parcourt `null → wall → … → furnace → null`. Le fantôme n'existe que quand `selected !== null`.
- **A3** — Un clic sur un nœud à portée émet `harvest { nodeId }` ; le même nœud hors portée n'émet rien (le client ne fait pas exprès une action qu'il sait perdue) ; un clic sur un cadavre émet `loot_corpse`, et le cadavre prime sur le nœud.
- **A4** — Clic maintenu 3 s sur un nœud plein : **3 actions `harvest` émises, pas 60** (cadencées au cooldown). Compté sur le canal d'envoi, pas sur le résultat.
- **A5** — Clic maintenu sur un nœud qui s'épuise : les envois cessent au coup où le stock tombe à 0 (G8 : la cible se ré-évalue).
- **A6** — Aucun `action_rejected` de motif « trop tôt » n'est produit pendant un maintien de 3 s (G7).
- **A7** — Le « +N item » et le tressaillement n'apparaissent QUE sur un `resource_harvested` reçu, jamais sur le seul clic (G9) — vérifiable en refusant l'action côté sim.
- **A9** — Sans marteau en main : `build` est REFUSÉ (« il faut le marteau de construction en main »), même avec le village, les matériaux et la portée. Le marteau AU FOND DU SAC ne suffit pas.
- **A10** — Le marteau se craft au Feu, seul (aucun blocage circulaire) ; le **bot headless** (`bot.test.ts`, A7) joue la boucle complète AVEC lui : récolter → fonder → forger le marteau → l'équiper → bâtir l'atelier → forger la hache → l'équiper → récolter mieux. Et son replay reste identique au bit près.
- **A8** — Mesures publiées (G11) : temps réel pour vider un arbre / un rocher à mains nues et à la hache, et temps jusqu'à la première hache depuis un sac vide.

## Hors périmètre

- **Le plan de construction complet** (« le marteau », chantier 3 : coût affiché, tiers de matériaux, rotation) — G2/G3 n'en tirent que le minimum vital : un mode armé et son fantôme, pour fermer le piège du clic. Le reste reste au chantier 3.
- **Le son.** Aucun son dans le jeu à ce jour ; le retour de frappe est visuel. Quand le son arrivera, il se branchera sur le même événement (G9).
- **Le rendement lui-même** : G11 s'arrête à la mesure et à la proposition. Le changement de nombres est une décision utilisateur.

## Note de dette repérée

`economie.md` R6 est **périmée** : elle décrit une usure « agrégée par type d'outil » (`wear[outil]`), alors que le chantier « le sac » l'a passée **par case** (`Slot.wear` — deux haches ne partagent plus un compteur). À corriger dans `economie.md`.
