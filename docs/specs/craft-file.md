# La file de craft — l'artisanat entre dans le temps

*Source : GDD §8 (chaînes courtes, économie de flux), §8bis (garde-fous anti-corvée), specs `economie.md` (R10-R11), `craft-fortune.md` (la couche 1), `inventaire.md` (le sac borné). Statut : **en cours** (2026-07-12). Décisions utilisateur du 2026-07-12 — ne pas les rouvrir.*

## Objectif de design

Le craft est aujourd'hui **instantané** : un appui, un cooldown d'une seconde, l'objet est là. C'est un reliquat de prototype. Il devient ce qu'il doit être — un **travail qui prend du temps**, lancé depuis l'écran d'inventaire, visible dans une file qu'on peut annuler. Le modèle est explicitement celui de Rust.

Conséquence structurante, et c'est elle qui commande tout : **le temps de craft vit dans `SimState`**, jamais dans un timer du client. Deux horloges divergeraient, et le multi deviendrait indébogable (invariant §3 : serveur autoritatif, client bête).

## Règles

### La file

- **F1 — Une file PAR PERSONNAGE, dans l'état de sim.** `Entity.craftQueue: CraftOrder[]`, JSON-sérialisable (pas de `Map`, pas de classe — invariant §3). Un ordre : `{ recipeId, count, remainingTicks }`.
- **F2 — `craft { recipeId }` n'ÉQUIPE PLUS RIEN : il ENFILE.** Les intrants d'**une** unité sont débités **immédiatement** (au clic). Le cooldown de craft disparaît : la durée le remplace.
- **F3 — Les clics répétés se GROUPENT.** Cliquer 5 fois sur la corde donne **une** ligne `corde ×5`, pas cinq lignes. Chaque clic débite ses intrants. La file reste courte et lisible à l'écran.
- **F4 — La file est bornée** (`CRAFT_QUEUE_MAX` lignes) : l'écran doit pouvoir la montrer entière. Le vrai limiteur reste les matériaux — ils sont débités d'avance.

### Le temps

- **F5 — Chaque recette a une durée** (`Recipe.seconds`), et le tick la fait descendre. Le temps est le numéro de tick, jamais une horloge (invariant §2).
- **F6 — L'Artisan ÉCONOMISE LE TEMPS DES AUTRES** (GDD §8bis) : `durée = max(1, floor(base / (1 + CRAFT_SPEED_BONUS × niveau)))`. C'est la place naturelle de la règle « le spécialiste fait en 20 min ce que le novice fait en 45 ». La durée se fige au DÉMARRAGE de chaque unité (pas à l'enfilage du lot) : monter de niveau accélère les unités suivantes.

### La station

- **F7 — La station doit rester À PORTÉE ; s'en éloigner MET EN PAUSE** (décision utilisateur). L'ordre n'est ni perdu ni annulé : le compteur cesse de descendre, et repart au retour. L'artisan est à son établi — et un établi qu'on doit occuper est un établi qu'on peut venir lui prendre (GDD §8 : la station est une cible de raid).
- **F8 — La couche 1 ne se met JAMAIS en pause.** `station: null` (spec `craft-fortune.md` C1) = à la main, nulle part donc partout : rien à quitter, donc rien à interrompre.
- **F9 — La pause est un ÉTAT DE LA SIM, pas une déduction du client** (`CraftOrder.paused`). Le client ne recalcule pas la portée ni les droits d'accès pour deviner pourquoi le compteur est figé : la sim le dit.

### La fin, et le sac

- **F10 — Le sac est plein à l'échéance : LA FILE ATTEND** (décision utilisateur). L'unité reste terminée en tête (`remainingTicks === 0`) et retente à chaque tick jusqu'à ce qu'une case se libère. **Rien ne se perd, rien ne tombe au sol** — il n'y a pas d'objets au sol dans Braises, et détruire le travail punirait une inattention. Une file bouchée SE VOIT : c'est le signal, pas une punition.
- **F11 — L'unité terminée crédite l'XP d'artisan et émet `item_crafted`** (l'événement existant : la chronique et le tableau du village en vivent déjà). Puis `count -= 1` ; à zéro, la ligne disparaît ; sinon l'unité suivante démarre (durée recalculée, F6).

### L'annulation

- **F12 — `cancel_craft { index }` annule la LIGNE entière** et rembourse **tout** le lot, unité en cours comprise (aucune perte de progression — le modèle Rust). Le bouton vit sur la ligne de la file.
- **F13 — Une annulation qui ne tient pas dans le sac est REFUSÉE** (`action_rejected: 'sac plein'`), et l'ordre reste en file. Rembourser à moitié détruirait la moitié — or rien ne se perd (F10). Le joueur fait de la place, puis annule.

### Le client

- **F14 — Le panneau de craft vit À DROITE de l'écran d'inventaire** (TAB). Une recette par vignette ; grisée si les intrants manquent ou si la station requise n'est pas à portée. Un clic = un ordre.
- **F15 — La file est visible MÊME INVENTAIRE FERMÉ** : une ligne par ordre (icône, `×N`, barre de progression, bouton d'annulation), et l'état *en pause* / *en attente de place* s'y lit.
- **F16 — Le client n'invente rien** : il affiche `craftQueue` du snapshot. Aucun décompte local, aucune prédiction de craft — la barre avance au rythme des snapshots (invariant §3).

### Les PNJ

- **F17 — Les PNJ passent par la MÊME file.** Ils cuisinent déjà via `applyEconomyAction` : leur craft cesse d'être instantané, ils attendent leur ragoût comme tout le monde. Leur boucle de tâche doit donc supporter l'attente (ne pas re-enfiler à 20 Hz).

## Critères d'acceptation

- **A1** — `craft { recipeId: 'rope' }` **débite les 3 fibres tout de suite**, pose une ligne dans `craftQueue`, et ne rend **rien** : la corde n'apparaît qu'après `seconds × TICK_RATE_HZ` ticks.
- **A2** — Cinq `craft` sur la corde → **une seule ligne**, `count: 5`, et 15 fibres débitées.
- **A3** — **La pause** : un lingot enfilé au four, on s'éloigne → `paused: true`, le compteur ne descend plus, aucun objet ne sort. On revient → il repart d'où il en était. Une corde (`station: null`) posée au même endroit, elle, continue de descendre.
- **A4** — **Le sac plein** : sac plein à l'échéance → l'ordre reste en tête à `remainingTicks: 0`, rien n'est détruit, rien n'est crédité (ni XP, ni `item_crafted`). On vide une case → l'objet tombe au tick suivant.
- **A5** — **L'annulation rembourse TOUT** (unité en cours comprise) et vide la ligne. Sac trop plein pour le remboursement → refus, la ligne reste intacte.
- **A6** — **L'Artisan accélère** : à niveau 0 la corde prend sa durée de base ; à un niveau élevé, strictement moins (et jamais moins d'un tick).
- **A7** — **Déterminisme** : même seed + mêmes inputs → même file, même flux d'événements (`replay.test.ts`, `events.test.ts`). Les durées ne dépendent que du tick et du niveau — aucun tirage.
- **A8** — **Le PNJ cuisine et attend** : il enfile son ragoût, ne réenfile pas à chaque tick, et le mange une fois sorti. Le village 100 % PNJ survit toujours 10 jours (`npc.test.ts`).

## Nombres (à calibrer)

`Recipe.seconds` : corde 3 ; objets de fortune 5 ; viande cuite 5 ; ragoût 8 ; hache/pioche/lance/marteau 8 ; lingot 10 ; outils de fer 12.
`CRAFT_SPEED_BONUS = 0.15` par niveau d'Artisan. `CRAFT_QUEUE_MAX = 6` lignes.

## Hors périmètre

- Le mini-jeu de forge (GDD §6) : habillage plus tard.
- La file de craft **partagée du village** (une station qui travaille pour plusieurs) : pas au MVP.
- Les objets au sol : n'existent pas, et cette spec ne les crée pas (F10).
