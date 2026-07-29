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

- **G6 — Récolte au clic MAINTENU** : bouton enfoncé, le coup se répète tant que le curseur vise un nœud à portée, **à la cadence du rechargement** (`GATHER_COOLDOWN_TICKS`). Relâcher arrête. *(Pour le BOIS, ce comportement est remplacé par une jauge charge/relâche — voir `recolte-maitrise.md` B1 ; pour la CUEILLETTE — fibre, baies, tourbe, cendre — il est remplacé par la touche **E**, qui vide le nœud d'un coup, voir `recolte-maitrise.md` P1 et `docs/decisions.md` 2026-07-24.)*
- **G7 — Le maintien n'INONDE PAS la sim.** Le client cadence lui-même ses envois : il n'émet pas une `harvest` par frame pour se faire rejeter 19 fois sur 20 par « trop tôt ». Un refus n'est pas gratuit — c'est un `SimEvent` (`action_rejected`) que la chronique et l'alignement consomment. Le flux d'événements n'est pas une poubelle.
- **G8 — La cible se ré-évalue à chaque coup**, pas une fois au clic : le nœud s'épuise, le curseur bouge, la caméra glisse encore. On récolte ce qu'on vise MAINTENANT, sinon on ne récolte rien.

### Le coup se sent

- **G9 — Le retour de frappe naît de l'ÉVÉNEMENT, pas du geste.** Le client n'affiche un impact que sur `resource_harvested` reçu dans le snapshot (le protocole les transporte déjà). On ne prédit pas un succès qu'on n'a pas : le clic optimiste qui affiche « +1 bois » avant le refus de la sim est un mensonge.
- **G10 — Trois signes, pas plus** : le nœud TRESSAILLE (bref décalage, amorti), LA MATIÈRE GICLE (une gerbe d'éclats, `client/scenes/world/recolte-fx.ts`), et le butin s'inscrit dans le HUD en **toasts empilés façon Rust** (« +2 BOIS (14) »), juste au-dessus des vitales. Sobre : ça arrive une fois par seconde pendant toute une partie.
  - *La règle disait DEUX signes jusqu'au 2026-07-29. Il en manquait un, et c'est le plus concret : le coup portait sans rien ARRACHER — on voyait le tronc frémir, on lisait « +2 bois » à l'autre bout de l'écran, et entre les deux il ne se passait rien. Troisième signe demandé par Alexis.*
  - **La gerbe obéit à deux règles, et elles la distinguent d'un confetti** : (1) sa COULEUR est **échantillonnée sur la texture que le nœud affiche** — jamais une table jumelle, qui aurait dérivé au premier coup de pinceau (les couleurs des nœuds vivent déjà dans deux backends de dessin) ; (2) sa DIRECTION prolonge le coup, donc elle part **à l'opposé du récolteur**. *Première version : les éclats partaient VERS lui (un copeau rebondit vers celui qui frappe). Corrigée par Alexis le 29/07 — la gerbe se tassait sur le sprite de l'avatar, masquant à la fois le geste et le nœud.* La matière n'a que quatre comportements (bois, pierre, feuille, poussière) : la famille du nœud décide de la loi de vol, sa texture décide de la couleur.
  - *Le butin a d'abord été affiché AU-DESSUS DU NŒUD, dans le monde. Ça marchait — la donnée le prouvait — mais dans une forêt dense, un petit texte blanc sur du feuillage vert sombre est illisible. Le butin se lit à une place FIXE que l'œil apprend.*
  - **La FUSION est le point dur** : on récolte un coup toutes les ~600 ms ; sans fusion, abattre un arbre empilerait dix lignes « +1 BOIS ». Une récolte du même item réanime sa ligne et lui AJOUTE son compte. Le total entre parenthèses est relu du SAC (borné, il peut écrêter) — jamais d'un compteur maison qui divergerait.

### Le nœud MEURT

- **G17 — Un arbre frappé lâche des FEUILLES, en plus de ses copeaux** (demande d'Alexis, 2026-07-29). La hache mord le fût à hauteur de ceinture ; le choc, lui, remonte l'arbre — et ce qui se détache là-haut n'est pas du bois. **Deux gerbes pour un coup, à deux hauteurs et de deux matières** : c'est ce décalage qui donne son échelle à l'arbre, une seule gerbe au pied en ferait un poteau qu'on gratte.
  - Les feuilles prennent leur couleur sur la texture du **houppier** (pas de l'écorce), suivent la loi `feuille` (gravité au dixième, vol long, papillonnement) et s'éparpillent à 360° — une feuille décrochée ne part pas dans une direction, elle descend en tournoyant.
  - **Elles naissent sur la COURONNE du feuillage, dans son bas.** Émises en son cœur, elles sont vertes sur du vert et il leur faudrait presque toute leur vie pour sortir de la silhouette : invisibles. Émises à son bord, elles s'en détachent dès la première image.
- **G18 — La mort d'un nœud S'ENTEND, et la matière décide de la voix** (demande d'Alexis : « un petit son de craquement quand l'arbre tombe »). L'arbre craque (long, plein), la pierre s'éboule (court, sourd), le végétal froisse (bref, clair). C'est le fait le plus RARE de la boucle (une fois tous les dix coups) : le budget d'attention de l'oreille est disponible, à la différence du coup lui-même.
  - **`node_depleted` porte donc sa `nodeType`.** Sans elle, l'audio aurait dû aller lire l'état du monde pour savoir ce qui vient de mourir — soit l'instrumentation après coup que CLAUDE.md interdit. Le fait de domaine porte sa matière ; ses consommateurs la lisent.
  - **Limite assumée** : un craquement réel est DEUX sons (la fibre qui claque, puis la masse qui touche). Un `SoundSpec` par événement n'en exprime qu'un — on a gardé le corps de la chute. Le doubler demanderait que le routage rende une SÉQUENCE, ce qui n'est pas le contrat d'aujourd'hui.


- **G15 — L'épuisement d'un nœud a son animation, et elle dépend de la MATIÈRE** (demande d'Alexis, 2026-07-29). Un nœud vidé disparaissait d'une frame à l'autre : le geste le plus long du jeu — dix coups, une jauge de charge à tenir — se terminait par une disparition.
  - **L'ARBRE TOMBE** (`client/scenes/world/chute-arbre.ts`). Le fût pivote sur son pied, le houppier suit l'arc du même angle, et la chute ACCÉLÈRE (une interpolation linéaire donne une barrière qui se baisse, pas un arbre qui tombe) avant un bref contrecoup au contact du sol.
    - **Le piège est une PROJECTION** : un arbre qui tombe vers le NORD s'enfonce dans la profondeur, et à l'écran sa pointe ne bouge pas — l'animation serait jouée et le joueur ne verrait rien. La direction est donc RABATTUE quand elle ne fait pas parcourir `POINTE_MIN_PX` à la pointe, en gardant son côté (est/ouest). Le minimum se DÉRIVE de la hauteur du fût : gros bois et arbre ordinaire obtiennent chacun le sien.
    - **Le houppier quitte la bande canopée** dès la première image. Debout, il coiffe le monde (c'est ce qui lui permet de survoler les acteurs) ; couché, laissé là, il peindrait par-dessus le joueur et le fût auquel il est accroché. Il rejoint la bande de tri Y, sous les acteurs : on passe DEVANT une cime abattue.
    - Il tombe **à l'opposé du bûcheron**, comme la gerbe (G10). En multi, la mémoire du coup est locale : l'arbre d'un autre joueur prend un côté stable tiré de sa tuile — jamais faux, jamais scintillant, mais pas la vraie direction.
  - **LA PIERRE ET LE VÉGÉTAL ÉCLATENT** : la même gerbe que G10, mais à **360°** et plus fournie. Une frappe POUSSE la matière d'un côté ; un épuisement la DISPERSE — c'est la seule différence de fond, tout le reste (couleur lue sur le sprite, loi de la matière) leur est commun et doit le rester.
- **G16 — La mort se consigne à l'ANCIENNE tuile, et la file se vide entièrement.** Un nœud de bois/plante DÉRIVE en mourant (`recolte-vivante` D1) : l'animation n'a de sens qu'où il était. On consigne donc à la réception du snapshot, on joue au rendu — et **on dépile TOUT à chaque image**, en jetant sans animation ce qui est mort hors du cadre. Ne dépiler que le visible ferait de la file une fuite (`depleted` interdit de reconsigner un mort).

### Le rendement

- **G11 — Le rendement ne se change pas à l'intuition.** `balance.ts` est un jeu d'ordres de grandeur calibrés en playtest (CLAUDE.md). Une fois G6 en place, le matraquage disparaît de lui-même : la question « 10 coups pour un arbre, est-ce trop ? » ne se pose plus dans les mêmes termes. On MESURE d'abord (temps pour vider un nœud, temps jusqu'à la première hache, en pilotant le vrai jeu), on propose ensuite, chiffres en main.

## Critères d'acceptation

- **A1** — Mode désarmé (`selected === null`, l'état de départ) : un clic sur une tuile vide n'émet **aucune** action. Prouvé par un test pur sur le résolveur de clic (`clickToAction`), pas seulement à l'œil.
- **A2** — `B` parcourt `null → wall → … → furnace → null`. Le fantôme n'existe que quand `selected !== null`.
- **A3** — Un clic sur un nœud à portée émet `harvest { nodeId }` ; le même nœud hors portée n'émet rien (le client ne fait pas exprès une action qu'il sait perdue) ; un clic sur un cadavre émet `loot_corpse`, et le cadavre prime sur le nœud.
- **A4** — Clic maintenu 3 s sur un nœud plein : **3 actions `harvest` émises, pas 60** (cadencées au cooldown). Compté sur le canal d'envoi, pas sur le résultat.
- **A5** — Clic maintenu sur un nœud qui s'épuise : les envois cessent au coup où le stock tombe à 0 (G8 : la cible se ré-évalue).
- **A6** — Aucun `action_rejected` de motif « trop tôt » n'est produit pendant un maintien de 3 s (G7).
- **A7** — Le « +N item », le tressaillement et la gerbe n'apparaissent QUE sur un `resource_harvested` reçu, jamais sur le seul clic (G9) — vérifiable en refusant l'action côté sim.
- **A13** — Les feuilles (G17) se vérifient EN JEU dans `--scenario eclats` : à la NAISSANCE (seul instant où les deux gerbes sont encore à leur point d'émission — après le vol tout se mélange), le groupe du haut porte les tons du houppier et naît ≥ 15 px au-dessus des copeaux. Et le test de direction ne porte QUE sur les copeaux : les feuilles étant radiales, les mêler au calcul ramène le barycentre sur le tronc et accuse à tort la gerbe de partir du mauvais côté.
- **A12** — L'épuisement (G15) se vérifie EN JEU, `pnpm smoke --scenario epuisement --dev`, sur les trois matières — et **au vrai verbe de chaque nœud** : l'arbre à la JAUGE réarmée (la sim supprime la charge à chaque coup parti seul), la pierre à la cadence du rechargement, le buisson d'un geste. `whole` ne mord que sur `foraging` : marteler ne vide ni un arbre ni un rocher. La chute se mesure en **trois instants** (départ, mi-course, posé) — « il a tourné » n'est pas « il a tourné du bon côté, jusqu'au sol, et s'est arrêté ». On exige aussi que le houppier couché soit sorti de la bande canopée et passe SOUS le joueur, et que les gerbes d'épuisement occupent au moins 3 des 4 quadrants (radiales, pas dirigées).
- **A11** — La gerbe (G10) se vérifie EN JEU, `pnpm smoke --scenario eclats --dev`, sur trois matières (pierre, bois, feuille) : ses grains portent des VALEURS des tons échantillonnés sur le sprite du nœud (jamais le ton de repli — un `getPixel` muet est un échec silencieux), son barycentre est de l'autre côté du nœud que le joueur, et elle tient dans le cadre. La gerbe vivant moins qu'une frame de rendu logiciel, le scénario **fige la boucle à la naissance de la gerbe** puis avance par `game.step` sur son horloge — `fx.update` seul déplacerait les grains sans jamais redessiner.
- **A9** — Sans marteau en main : `build` est REFUSÉ (« il faut le marteau de construction en main »), même avec le village, les matériaux et la portée. Le marteau AU FOND DU SAC ne suffit pas.
- **A10** — Le marteau se craft au Feu, seul (aucun blocage circulaire) ; le **bot headless** (`bot.test.ts`, A7) joue la boucle complète AVEC lui : récolter → fonder → forger le marteau → l'équiper → bâtir l'atelier → forger la hache → l'équiper → récolter mieux. Et son replay reste identique au bit près.
- **A8** — Mesures publiées (G11) : temps réel pour vider un arbre / un rocher à mains nues et à la hache, et temps jusqu'à la première hache depuis un sac vide.

## Hors périmètre

- **Le plan de construction complet** (« le marteau », chantier 3 : coût affiché, tiers de matériaux, rotation) — G2/G3 n'en tirent que le minimum vital : un mode armé et son fantôme, pour fermer le piège du clic. Le reste reste au chantier 3.
- **Le son.** ~~Aucun son dans le jeu à ce jour~~ — **périmé** : la récolte SONNE depuis l'échafaudage audio (`client/audio/sound.ts`, table pure `soundForEvent`), branché sur le même événement (G9), comme prévu.
- **Le rendement lui-même** : G11 s'arrête à la mesure et à la proposition. Le changement de nombres est une décision utilisateur.

## Note de dette repérée

`economie.md` R6 est **périmée** : elle décrit une usure « agrégée par type d'outil » (`wear[outil]`), alors que le chantier « le sac » l'a passée **par case** (`Slot.wear` — deux haches ne partagent plus un compteur). *(Mis à jour 2026-07-19 : `economie.md` R6 a depuis été corrigée — l'usure est bien « par case ».)*

G6 est par ailleurs **largement périmée** : pour le BOIS (`tree`/`old_tree`), le clic maintenu ne répète plus un coup à la cadence du cooldown — il CHARGE une jauge, et le relâché est LA frappe (`harvest_charge_start`/`harvest_release`, spec `recolte-maitrise.md` B1). Pour la CUEILLETTE (fibre, baies, tourbe, cendre), le clic ne récolte plus DU TOUT : c'est la touche **E** qui vide le nœud d'un coup (décision utilisateur 2026-07-24, `recolte-maitrise.md` P1). G6 (le clic maintenu qui répète) ne vaut donc plus que pour la PIERRE — et encore, sous la forme du verrou-nœud du minage à maîtrise (`recolte-maitrise.md` verbe 2).
