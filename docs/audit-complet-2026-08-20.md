# Audit complet — 2026-08-20

> **Nature.** Audit exhaustif de l'architecture, de la qualité de code et de la complétude des features,
> conduit par 23 auditeurs spécialisés dont chaque constat a été soumis à un **réfuteur adverse** chargé
> de le casser. Tout ce qui suit a survécu à ce second passage. 235 constats retenus, ~9,2 M de jetons,
> 2 868 appels d'outils. **Aucun agent n'a écrit dans l'arbre** : l'audit est en lecture seule.
>
> **Périmètre.** `packages/sim` (7 domaines), `packages/client` + `packages/server` + `tools/` (7 domaines),
> les 43 specs de `docs/specs/` confrontées critère par critère au code, et cinq axes transversaux
> (architecture, duplication/code mort, perf, tests, cohérence documentaire).
>
> **Où vivent les 235 constats.** Ce document rédige en entier les **9 critiques et les 88 majeurs**.
> Les **138 mineurs** ont leur détail complet (preuve, impact, correctif, contre-vérification) dans
> `audit-2026-08-20-mineurs.md`, et l'index des 235 — une ligne par constat, avec sévérité, chemin, effort
> et verdict du réfuteur — est dans `audit-2026-08-20-annexe.md`. Rien de l'audit ne vit hors du dépôt.
>
> **État de l'arbre au moment de l'audit.** Travail NON COMMITÉ en cours (chantier gel / flore-froid /
> agriculture) sur `gel.ts`, `temperature.ts`, `agriculture.ts`, `balance.ts`, `economy.ts`, `village.ts`,
> `npc.ts`, `snapshot-view.ts`, `aim.ts`, `audio/`, `tools/smoke.mjs`, plus `docs/specs/flore-froid.md`
> non commitée. Les constats qui portent dessus sont signalés.
>
> **Une correction que j'ai apportée aux auditeurs.** Plusieurs constats de perf chiffraient leur impact
> sur **772 structures**, le nombre relevé par la mesure A9 du 2026-08-16 — c'est-à-dire AVANT la
> réduction du monde à `racine` (2026-08-18). Recompté sur le monde réellement servi
> (`generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)` + `buildPoiStructures`, sonde jetable) :
>
> | graine | carte | nœuds | structures (LAN) | structures (Veillée, 2 voisins) | feux |
> |---|---|---:|---:|---:|---:|
> | 2026 | 1581×852 | 61 673 | **466** | 476 | 2 |
> | 7 | 1581×852 | 63 712 | **409** | 419 | 2 |
> | 42 | 1581×868 | 64 313 | **451** | 461 | 2 |
>
> Les ordres de grandeur de `PERF-03`, `PERF-08` et `PERF-01` ont été corrigés en conséquence (~40 % de
> moins). Deux enseignements de la même sonde : le monde ne porte que **2 feux**, ce qui confirme que
> `FX-03` est latent en solo (c'est l'ORDRE qui est faux, pas le plafond) ; et le worldgen pose **38
> clôtures et 4 encadrements**, c'est-à-dire précisément les deux pièces que le clic du joueur ne sait pas
> bâtir (P0.2).

## Le verdict en une page

**Ce dépôt est en bien meilleure santé que la plupart des bases de 120 000 lignes, et ses défauts ne sont
pas là où on les attendrait.** `pnpm check` et `pnpm lint` passent ; 1 327 tests passent ; il n'y a
**aucun** `TODO`, `FIXME`, `eslint-disable`, `@ts-ignore` ni `any` hors tests dans tout le dépôt ; les 116
imports client/serveur vers `/sim` passent tous par la racine du paquet ; aucune fonction `Math`
approximée n'est appelée dans `/sim`.

Le défaut dominant n'est pas de la mauvaise écriture. **C'est que les garde-fous ne gardent pas ce qu'ils
promettent, et que la documentation ment — toujours dans le même sens, par pessimisme.**

| | critiques | majeurs | mineurs | total |
|---|---:|---:|---:|---:|
| `/sim` | 3 | 17 | 45 | 65 |
| client · serveur · outillage | 5 | 35 | 32 | 72 |
| complétude (43 specs) | 1 | 12 | 28 | 41 |
| transversal | 0 | 24 | 33 | 57 |
| **total** | **9** | **88** | **138** | **235** |

Les trois fils rouges :

1. **Des gardes qui ne prouvent pas leur prémisse.** Le replay est vérifié sur des prairies vides de
   24 tuiles alors que le jeu tourne sur 1,35 M de tuiles ; les gardes du T0 mesurent un plan de carte que
   personne ne joue (**75,90 %** des tuiles diffèrent du plan servi) ; `pnpm smoke` porte **290** verdicts
   qui ne peuvent pas faire échouer la commande ; `pnpm test` peut rendre vert quand un fichier de test
   entier a cessé d'exister.
2. **Des règles écrites deux fois, qui divergent.** `evaluateBuild` existe dans `/sim` avec le commentaire
   « pour que le fantôme du client et le serveur partagent UNE SEULE vérité » — et **aucun fichier de
   production ne l'appelle**. Quatre régressions visibles au joueur en sont sorties en deux mois.
3. **Des specs qui déclarent morts des systèmes qui tournent.** L'alignement est annoncé « débranché du
   solo » depuis un audit du 2026-07-19 ; il est branché depuis le 2026-07-22. Huit des treize écarts
   majeurs de complétude sont de cette forme.

## Ce qui est solide — et ne doit pas être touché

Ce n'est pas de la politesse : plusieurs recommandations ci-dessous seraient dangereuses si on oubliait ces
acquis.

- **L'ordre des 25 phases du tick** (`sim.ts:681-843`) est juste, et chaque décision d'ordre est justifiée
  à l'endroit où elle compte (le dégel *après* la température pour qu'aucun tick ne se passe emmuré ; la
  Cendre après le temps « puisque c'est le temps qui la pousse »).
- **La discipline du RNG** : cinq consommateurs seulement du flux partagé, tout le reste sur `hash2`,
  chacun documenté avec sa raison — c'est ce qui permet d'ajouter un système sans décaler le flux seedé.
- **Le lint de pureté** ferme les globals, les propriétés `Math` approximées, l'opérateur `**` *et* le
  contournement par `globalThis`. C'est un vrai garde-fou, pas une consigne.
- **L'invariant JSON-sérialisable est tenu partout** : aucun `Map`/`Set`/classe dans `SimState`, les index
  dérivés vivant en `WeakMap` externes (`economy.ts:141`, `collision.ts:253`).
- **Le client a zéro cycle d'imports à l'exécution** : `render/` n'importe jamais `scenes/`, `worker/`
  n'importe ni l'un ni l'autre. 153 fichiers, une hiérarchie propre.
- **Le registre `PIECES` a réellement supprimé les listes à la main côté `/sim`** — le chantier est bon, il
  s'est seulement arrêté à la frontière de l'art.
- **`validate.ts` est excellemment testé** (fuzz par forme sur l'union des actions) : c'est le modèle à
  étendre au reste du serveur.

---

# P0 — Corrections. Bugs vérifiés, correctif technique, aucune décision de design.

## P0.1 — La collision sous-tuile ne voit qu'une structure par tuile *(critique)*

`bloquantAt` (`collision.ts:187`) rend **la première** structure bloquante, et `blockedSubAt`
(`collision.ts:346-352`) ne teste que celle-là. Si elle porte des `edges` et que la sous-tuile n'est pas sur
l'arête, on tombe à travers le `if` — la seconde structure, pleine, n'est jamais interrogée.

Reproduit en exécutant le vrai code :

```
structures = [wall(5,5,edges:N), wall(5,5)]   // arête d'abord, mur plein ensuite
glisser d'ouest en est depuis x=3,5  ->  x = 11,50   (traverse toute la tuile)
overlapsBlocking(5.5, 5.5)            ->  false      (on se tient DANS le mur)
témoin, ordre inverse                 ->  x = 4,63   (bloqué, correct)
[palissade(edges:N), chest]           ->  x = 11,50  (le coffre ne bloque plus)
```

**Et c'est le cas nominal, pas un cas exotique** : `place_component` ENCOURAGE la configuration
(`village.ts:1038` : « un mur d'arête borde la tuile sans l'occuper — on ADOSSE donc son four à son propre
mur »), et l'ordre naturel de pose met l'arête en premier. Un joueur qui adosse son four à sa palissade
obtient une structure fantôme ; un mur plein bâti sur une tuile portant déjà une palissade ne bloque plus
rien. C'est le retour littéral du bug du 2026-07-27, déplacé d'un cran.

**Correctif** — faire de `bloquantAt` une question sous-tuile : boucler sur *toutes* les bloquantes de la
tuile, trancher par structure (`edges === undefined` → bloqué ; sinon `onDeclaredEdge`), ne rendre `false`
qu'après les avoir toutes vues. `blockedAt` (pleine tuile) garde sa forme. **Garde exhaustive** plutôt que
cas choisis : balayer toutes les paires (arête, pleine) et (arête, arête) et affirmer une seule propriété —
« ce qu'une structure bloque seule, elle le bloque aussi accompagnée ».

*Corollaire vérifié : deux arêtes différentes sur la même tuile souffrent du même défaut (pénétration de
1 sous-tuile).*

## P0.2 — Clôture et Encadrement sont armables mais le clic frappe *(critique)*

`clickToAction` (`aim.ts:376-431`) énumère les pièces à la main et se referme sans branche par défaut.
Exécuté sur le vrai résolveur, marteau en main :

```
wall → {build wall} · palissade → {build palissade} · door → {build door}
floor → {build floor} · roof → {build roof}
cloture      → {"type":"attack","dx":1,"dy":0}
encadrement  → {"type":"attack","dx":1,"dy":0}
```

Deux pièces livrées le 2026-08-01 (D1) sont **mortes en jeu depuis**. Le menu les expose, le fantôme
s'affiche, la tuile est verte (`placeable` et `carre-village` lisent le registre, eux) — et le clic donne un
coup de poing. Aucun `action_rejected` : rien ne l'explique. Le test `construction.test.ts:301` appelle
`applyVillageAction` en direct : il prouve que la sim accepte, jamais que le client émet.

**Correctif** — dériver du registre comme `carre-village.ts:116` le fait déjà
(`piece(placing).arete !== 'interdite'`), et poser une garde exhaustive sur `BARRIER_TYPES` dans
`aim.test.ts`. C'est le trou par lequel c'est passé : une garde par cas choisi ne couvre pas une union qui
s'élargit.

## P0.3 — Un village PNJ dont le coffre est cassé meurt sans recours *(critique)*

`refreshBoard` s'arrête net sans grenier (`village-board.ts:51-54`) : plus une seule tâche postée, y compris
`feed_fire` — que le fichier appelle lui-même « la tâche communautaire zéro, sans elle le village tombe ».
Et `desiredOrders` ne commande **jamais** de coffre (mesuré aux paliers 2 et 3).

Mesuré avec témoin (même graine, même monde, 3 cycles) :

```
TÉMOIN (coffre intact)  → coffres 1 · fuel 201,8 · 4 PNJ vivants
GRENIER CASSÉ           → coffres 0 · fuel 0,0   · 0 PNJ vivant · aucun coffre rebâti
```

Or c'est **exactement la cible du raid de Meute livré** (`npc-errands.ts:183`, étape `smash`), et
`alignment.test.ts` chiffre le taux : « grenier cassé : 5/12 » graines. Un village raidé sur deux meurt
définitivement.

**Correctif** — ① faire de `granaries()` un prédicat de **fonction** (`piece(s.type).fonction === 'grenier'`)
et non de type ; ② donner à `desiredOrders` un ordre de recours quand il n'y a plus de grenier, posté
*avant* le `return` de `refreshBoard`. **Attention** : le prédicat existe en **trois copies** —
`village-plan.ts:37`, `npc-errands.ts:26` (cible du raid), `scenario.ts:281` (rapport du banc) — elles
doivent bouger ensemble, sinon l'économie et la cible du raid divergent.

*Corollaire : le SILO que le bourg se construit à grand-peine est **inerte** pour l'économie PNJ — le
village bâtit une réserve dont il ne se sert pas et meurt de la perte d'un coffre à 4 bois.*

## P0.4 — Un `boot()` qui rejette fige l'écran de chargement pour toujours *(critique)*

`void boot(...)` (`sim-worker.ts:501`) jette la rejection. Le `try/catch` de `boot()` se ferme ligne 405 ;
`createVeillee()` est appelé ligne 408 et jette pour de vrai (`veillee.ts:118`, « carte dégénérée »). Aucun
`unhandledrejection` dans tout `packages/client/src` ; `fatal` n'a que deux déclencheurs, dont aucun
n'écoute une promesse.

Le réfuteur a cherché l'échappatoire : elle n'existe pas. `UIScene.update` sort en avance tant que
`worldReady` est absent, donc le menu pause n'est jamais atteint malgré son z-index supérieur. **Le joueur
n'a littéralement aucun bouton** — le seul recours est de tuer l'onglet. Le commentaire du même fichier
(l. 496-499) décrit précisément ce mécanisme, mais seule la branche synchrone en a été protégée.

**Correctif** — `.catch()` à l'appel + un watchdog côté `UIScene` (pas de `ready` au bout de N secondes ⇒
`fatal`), qui couvre aussi le Worker tué par OOM.

## P0.5 — Une sauvegarde ratée puis réussie perd la Veillée en silence

Deux drapeaux décrivent le même fait, un seul est dans la fenêtre gardée : `carteEcrite` est posé **après**
le succès (`sim-worker.ts:307`), `baseNoeuds` **avant toute écriture** (l. 271) et n'est jamais remis à
`undefined` dans le `catch`. Après un échec en T1 et un succès en T2, on écrit une carte de T2 et un diff
calculé contre la base de T1 : à la reprise, `appliqueDiffNoeuds` jette, le repli jette à son tour, et
`boot()` repart sur un monde neuf. **Sans un mot.**

Le déclenchement est plausible : la première sauvegarde est la plus lourde (elle emporte la carte, ~790 ms,
plusieurs dizaines de Mo) donc la plus exposée à un refus d'IndexedDB.

Le réfuteur a trouvé une **variante silencieuse qui ne jette pas** : un nœud récolté puis entièrement
repoussé entre T1 et T2 revient à sa valeur de naissance, n'entre donc pas dans `bouges`, et la copie
épuisée figée dans la carte de T2 survit pour toujours.

**Correctif** — deux lignes : `if (premiere) baseNoeuds = undefined` dans le `catch`. Plus un cas de test
« la première écriture jette, la seconde passe ».

## P0.6 — On ressuscite en marche

`enterDying()` coupe `keyboard.enabled` sans jamais appeler `resetKeys()`. Dans Phaser 4,
`KeyboardPlugin.update()` sort immédiatement quand le plugin est éteint pendant que
`KeyboardManager.postUpdate()` **vide sa file d'événements** à chaque POST_STEP : les `keyup` du voile sont
jetés, `Key.isDown` reste figé. Les trois chemins qui appelleraient `resetKeys` (BLUR / PAUSE / SLEEP) sont
court-circuités par `enabled = false`.

Second volet : le déplacement n'est pas coupé pendant le voile (`WorldScene.ts:1643` ne connaît que
`typing`, pas `this.dying`) — donc la prédiction continue d'intégrer le cap sous l'écran noir.

Mourir en fuyant — le cas normal — fait donc partir l'avatar en marche continue au réveil. `cancelHold()`
répare exactement ce raisonnement pour la souris, dix lignes plus bas.

## P0.7 — Le menu pause ne met pas en pause

La seule garde sur le déplacement est `typing` ; `menuOpen` ne la rejoint jamais. `onDown` ne consulte que
`typing()`, ce qui laisse passer la ceinture 1-6 et `drop_held`. En solo, `syncPause()` fige l'hôte mais pas
la prédiction → au retour, le premier snapshot rappelle l'avatar au-delà de `SNAP_DISTANCE_TILES` : téléport
franc avec recentrage caméra. En multi, le serveur **ignore** `pause` : on continue de marcher, de changer
d'arme et de jeter son sac au sol pour de vrai.

## P0.8 — La horde naît trois heures après le crépuscule

`advanceWorldEvents` (`worldevents.ts:145`) et `assignErrands` (`npc-errands.ts:47`) calculent
`state.tick % TICKS_PER_CYCLE`, alors que l'heure du monde est `(tick + cycleOffset) % TICKS_PER_CYCLE` —
la loi de `gameTimeAt`, appliquée correctement deux fichiers plus loin. Les deux configurations livrées
posent `cycleOffsetForStartHour(9)` = 7 200 ticks.

Mesuré (seed 21, offset livré) :

```
night_started = 28800 · horde_spawned    = 36000  → +7200 ticks = 3 h de jeu
day_started   = 50400 · horde_dispersed  = 57600  → +7200 ticks
```

Le réfuteur a trouvé l'argument le plus fort : **deux horloges dans le même sous-système**. `assignErrands`
part du modulo brut tandis que `handleSleep` et le ralliement de nuit lisent `getGameTime().isNight`,
offset-correct — les deux moitiés de la même règle ne parlent pas du même moment.

**Correctif** — exposer `cycleTickOf(state)` dans `time.ts` à côté de `gameTimeAt`, et le faire appeler par
les quatre ou cinq sites, pour que la prochaine passe cadencée ne puisse pas réinventer le mauvais modulo.
Puis un test à offset **non nul** qui affirme la coïncidence `horde_spawned` / `night_started`.

*Même racine, hors périmètre audité : `brume.ts:267`, `meteo.ts:461` et `:489` portent la même expression brute.*

## P0.9 — Le loup ne peut ni manger ni sentir le cerf qu'il vient de tuer

Le cerf est la seule espèce dont le butin n'est pas de la `raw_meat` (`loot: { quartier: 2 }`). Les quatre
portes du prédateur ne connaissent que `raw_meat`/`cooked_meat` : `feedStep` (`faune.ts:2811`),
`CARRION_ITEMS` (`:1723`), `BAIT_ITEMS` (`:1722`), `bloodBias` (`:96`).

Prouvé sur le vrai chemin (bête tuée par `die()`, loup affamé à 6 tuiles, 30 s de sim) :

```
deer  loot={quartier:2}  → mange=false repu=false · bloodBias=1 (neutre)
boar  loot={raw_meat:3}  → mange=true  repu=true  · bloodBias=2 (appel)
```

Deux règles nommées tombent en silence sur l'animal autour duquel elles ont été écrites : **R15** (« il
chasse, il TUE, et il MANGE… puis il vous laisse passer ») et **C12** (le hurlement qui répond à la mise à
mort). La spec chiffre « 2,0 cerfs tués par cycle » sous R19 — et pas un n'est mangé.

Aucun test ne couvre le cas : les six tests concernés fabriquent leur carcasse à la main avec
`{ raw_meat: 3 }`. **C'est la fabrication à la main qui a caché le trou.**

**Correctif** — un prédicat `VIANDES` partagé, en feuille (`items.ts`), lu par les quatre sites. Et le test
manquant joué sur une carcasse de cerf **produite par `die()`**.

## P0.10 — La dissipation de l'alpha met sa meute en déroute définitive

`disperseLeaderless` (`faune.ts:1059`) ne distingue pas « le chef est mort » de « le chef n'est plus dans
l'index ». Or l'alpha est une bête **ambiante** comme les autres (vérifié : `born.ambient = true` s'applique
au premier-né, c'est-à-dire exactement à celui qu'on sacre alpha) et `despawnUnwatched` le retire dès qu'il
passe `DESPAWN_RADIUS` (52) de tout avatar.

Prouvé (meute de 3, alpha à 60 tuiles avec ses PV **intacts**, deux suiveurs collés au joueur) :

```
t0  alpha à 60,0 t · suiveurs à 4,0 / 5,0 · routed=false,false
t1  alpha présent=false (personne ne l'a touché)  · routed=false,false
t2  alpha présent=false · routed=TRUE,TRUE · herdId=vide · cible=vide
```

R12 promet « TUER l'alpha disperse la meute — la seule chose qui transforme un combat perdu d'avance en
combat gagnable ». Ici la récompense se donne toute seule, par deux chemins atteignables : l'alpha blessé
qui rompt et franchit 52 tuiles en dix secondes, ou l'alpha simplement distancé. R13 dit « ON NE SÈME PAS
DES LOUPS » — si : il suffit de semer l'alpha.

Et `routed` **n'est jamais levé** (5 occurrences dans tout le dépôt, aucun `delete`) : un loup en déroute ne
rechasse plus jamais et occupe le quota de prédateurs de son coin sans jouer aucun rôle.

## P0.11 — Deux autorités de tuile qui se contredisent, et un cache qui rate la dérive

- `blockedAt` écarte délibérément les murs d'arête à l'échelle de la tuile ; **le cache d'occupation n'a pas
  ce filtre** (`collision.ts:291`) → `makeIndexedIsBlockedAt` refuse toute tuile portant un mur mince, donc
  le pathfinding fait fuir la faune d'une salle praticable — précisément ce que le commentaire de
  `bloquantAt` dit vouloir éviter.
- Le cache d'occupation ne voit pas la **dérive** d'un nœud : après une récolte en forêt, l'A* croit l'arbre
  encore sur son ancienne tuile.

## P0.12 — Le feu qu'on vient d'allumer n'éclaire plus

`dynamic-lighting.ts:113` garde les **24 premiers** feux du tableau, qui arrive dans l'ordre de création et
n'est pas filtré par la zone d'intérêt. Les plus vieux gagnent, où qu'ils soient ; celui que le joueur pose
est toujours le dernier, et les feux écartés se voient **retirer** leur lumière par la boucle de
réconciliation. Le réfuteur a trouvé mieux : Phaser cull déjà les lumières lointaines (`maxLights: 40`) —
le plafond maison n'apporte qu'un **ordre faux**, le supprimer suffirait presque.

*Même défaut chez `FireFx` : trois émetteurs de particules par feu du monde entier, sans culling ni plafond.*

## P0.13 — Autres corrections vérifiées

- **Jeter puis ramasser rajeunit la nourriture** : les piles au sol ne portent pas de fraîcheur, `addItems`
  la remet à 1.
- **`place_campfire` esquive R7** : c'est le seul geste de pose bloquant qui n'appelle pas
  `placementKeepsNavigable`. Sonde : `R7` refuse un mur sur la dernière ouverture d'une enceinte, et
  accepte un feu de camp au même endroit — flood 4-connexe après pose : 9 tuiles, le dehors n'est plus
  atteint. Murer son propre Feu, ou emmurer un PNJ, à 10 bois et sans trace dans le flux d'événements.
  *(L'arbitrage de l'ancre revient à Alexis — voir la section Décisions.)*
- **Le poseur de plans perd une arête** quand deux barrières de types différents visent la même tuile
  extérieure : l'accumulation n'a que trois branches, tout autre couple tombe dans le vide.
- **`sunDirection` saute d'un coup à 18h00** : `if (h >= 18) return {x:0, y:0}` alors que `DAYLIGHT_KEYS`
  donne encore 0,7 et `AMBIENT_KEYS` l'heure dorée. Le réfuteur a montré que ce n'est pas « un pop d'une
  frame » mais **trois heures de crépuscule éclairées d'aplomb par le nord**, et que le terme de chaleur
  rasante de l'eau s'éteint pile à l'instant où la table déclare l'heure dorée. Contredit la règle maison
  « feel = pente continue » que le même fichier invoque pour `brumeDuMatin`.
- **La couche de taches de soleil ne se monte pas à la deuxième Veillée** : `createCanvas('soleil-mask')`
  sans garde `exists` rend `null`, le constructeur sort avant de créer le shader, et `soleilLayer` est
  absent de la liste de destruction. Coût annexe mesuré : **5,39 Mo** de canvas RGBA orphelin par partie.
- **Trois modules DOM fuient 6 écouteurs `document` par cycle jouer→menu→jouer**, chacun retenant son arbre
  DOM détaché.

---

# P0bis — Autorité, sécurité, robustesse réseau

Ces constats ne bloquent pas le solo mais **bloquent GATE 2**.

- **Le chat diffuse la position de chaque locuteur à tous les clients**, sans borne de distance, alors que
  le snapshot est rogné à 64 tuiles dix lignes plus haut *pour l'anti-ESP*. `protocol.ts:96` décrit
  pourtant déjà le bon comportement : « l'hôte le relaie aux joueurs proches, jamais à la vallée entière ».
  **Le code implémente la minorité de sa propre doc.** Dans un jeu d'alignement émergent, parler devient
  une balise de traque.
- **Le loquet de debug se persiste** : `debug` est dans `SAVE_REQUIRED_KEYS`, `sim = state` ne le
  ré-affirme jamais. Le réfuteur a aggravé : les actions `debug_*` voyagent sur le canal d'action ordinaire
  et le tree-shaking ne retire que le raccourci clavier — donc une sauvegarde faite en dev rouvre avec
  **toute** la surface de debug jouable dans un build de prod. La ligne de `CLAUDE.md` est fausse.
- **La table des refus est indexée par une chaîne choisie par le client**, sans borne de cardinalité, purgée
  toutes les 5 s puis concaténée synchroniquement dans le tick. Le commentaire promet l'inverse (« un client
  hostile ne peut pas s'en servir pour noyer les journaux »).
- **Le seau de jetons n'a été posé que sur le chat** : `input` et `action` traversent le même gestionnaire
  sans compteur — celui-là même qui a été mesuré à **47 400 trames/s** acceptées d'un seul client.
- **Une zone « condamnée » ressuscite sur l'état corrompu** : `releaseZone` ne relâche que le verrou, le
  `let cached` garde le `SimState` à moitié steppé, et le prochain `joinOrCreate` repart dessus. Le journal
  qui aurait dit ce qui s'est passé meurt avec la room. *(Aggravation : `disconnect()` déclenche `onLeave`
  pour chaque client, donc `despawnAvatar` mute encore l'état suspect avant qu'il ne soit rendu.)*
- **Un onglet caché fait marcher l'avatar indéfiniment** : le client émet `pause`, le serveur l'ignore, et
  `tick-driver` rejoue le dernier input à 20 Hz sans péremption. Le protocole le dit lui-même :
  « sans pause, l'avatar répéterait le dernier input ».
- **`clearSlot` n'est protégé qu'à l'échelle d'un onglet** : aucun `navigator.locks`, aucun
  `BroadcastChannel`. Deux onglets sur la même case autosauvent toutes les 30 s, dernier écrivain gagnant,
  chacun avec sa propre comptabilité `carteEcrite` — la vallée est perdue sans un clic sur EFFACER.

---

# P1 — Performance sans perte de fonctionnalité

Tout ce qui suit est **mesuré**, et chaque entrée nomme la mesure de contrôle à refaire après correctif.
Rappel de la règle maison : on n'optimise que ce que la mesure justifie, et on relève **la pire seconde**,
pas la moyenne.

## Les deux qui bloquent le LAN

| | mesuré | budget |
|---|---|---|
| **`SRV-01`** — les 466 structures immobiles ré-encodées vers chaque client à chaque tick | `structures` = **33 990 o sur 51 462** (66 % du snapshot) ; sérialisation 50 destinataires **38-75 ms/tick** contre 13-26 ms avec `structures: []` | tick = 50 ms |
| **`SRV-02`** — chaque arrivée gèle la vallée | `ready` = **8 Mo**, encodé **137 à 226 ms** synchroniquement, et Colyseus ne rattrape aucun tir manqué | 3-5 ticks perdus par join |

Les deux ont été **reproduits indépendamment** par le réfuteur avec le vrai `Packr` de Colyseus.
`interest.ts:27` affirme que le bâti « pèse ~0 % du snapshot » : c'est **60 %**, et c'est cette phrase qui
a fait passer le champ sous le radar. Correctif : le bâti statique part une fois dans `ready` puis des
deltas — le modèle `NodeShadow`/`collectNodeDeltas` existe et a été déplacé dans `/sim` exprès pour être
partagé. C'est un changement de **protocole** : l'effort « M » annoncé est optimiste. Et les trois grilles
pleine carte (`terrain`, `cendre`, `profondeur`, 4,04 M d'entiers) devraient être des tableaux typés.

## Le client, par ordre de rendement

1. **`CB-01` — `aimAt` balaie les 61 673 nœuds à chaque frame.** `nodes.find(...)` = **764 µs** par appel
   (réfuteur : 861 µs), **deux fois par frame**, plus `poseLibre` (**1016 µs**) marteau en main.
   ~15 % du budget de 16,7 ms. `nodeAt()` — l'index O(1) en `WeakMap`, patché à la relocalisation — est
   exporté par `/sim` et **déjà utilisé par le client** (`carre-village.ts:359`). **Correctif : une ligne.**
2. **`CB-07` — la visée est résolue deux fois par frame.** `aim()` puis `interactTarget()` re-résolvent tout
   depuis zéro : deux `Vector2`, deux `Set` de monstres, deux `filter`+`map` d'entités, deux balayages de
   nœuds. Le commentaire d'`interactTargetAt` revendique pourtant « deux lecteurs, une seule résolution ».
3. **`R1`/`FX-06` — `clutterAt` recalculé par tuile et par frame** alors que c'est une fonction **pure** de
   la carte, que `carte-immuable.test.ts` affirme figée. Mesuré sur la carte réellement jouée, fenêtre la
   plus fournie : **0,756 ms/frame** et **~1 778 tableaux+objets alloués par frame**. *(Le réfuteur a
   corrigé le chiffrage initial : l'auditeur dimensionnait sa fenêtre à un zoom impossible — le zoom du
   monde n'est pas réglable, il vaut 2,25 à 720p.)* Correctif : `Map<number, PropInstance[]>` par tuile.
   Plus le patron « on n'appelle que si ça change » sur `setTexture`, déjà écrit deux lignes au-dessus pour
   `setTint`.
4. **`FX-02`/`PERF-02` — la recuisson du gel.** Mesuré : **9,6 à 14,3 ms** par recuisson au jour 55, et la
   recuisson part **4 fois par seconde de marche**. La mesure **disqualifie le coupable annoncé par
   l'en-tête du fichier** (`isSheltered` : structures=0 → 9,6 ms ; structures=60 → 12,1 ms) : le coût est
   dans l'intégration de fonte de `neigeAuSol`, jusqu'à **48 appels** à `baselineTemperatureAt` par tuile,
   chacun allouant. Ligne de base connue : `decisions.md:757` relève « 10,3 à 22,5 ms » au jour 59.
   **Levier ①, exact et sans effet sur les bits : `isSheltered` est constant sur toute l'intégration —
   le calculer une fois par tuile.** Mesure de contrôle : `SMOKE_JOUR=59 SMOKE_HEURE=23 pnpm smoke --dev
   --scenario enneige`, qui imprime déjà `msRecuisson`.
   *En acte I, ce sont 1,6 ms × 4 par seconde dépensées à peindre exactement rien : `gelPossible`
   court-circuite la glace, jamais la neige.*
5. **`PERF-08` — quatre passes par frame sur tout le tableau des structures** (`dynamic-lighting`, `fire-fx`,
   `fire-ground-glow`, plus un `filter().map()` en `WorldScene.ts:1405` que le réfuteur a trouvé en plus),
   toutes pour retrouver le même petit sous-ensemble : les feux. Le mémo A9 du 16 août n'a couvert que le
   chemin à 20 Hz ; celui-ci tourne trois fois plus vite. Correctif : dériver la sous-liste des feux sur le
   même mémo `DerivesBati`.

## Le tick

6. **`PERF-03` — la collision balaie tout `state.structures` à chaque sous-tuile.** ~18-20 appels à
   `blockedSubAt` par mover et par tick × ~1,5 balayage complet × ~466 structures ≈ **0,6×10⁶ à 4×10⁶
   comparaisons par tick**, 20 fois par seconde. Le réfuteur a contre-vérifié le modèle plutôt que de le
   gober, et il tient. **Mais il a cassé le remède proposé** : `occupancyOf` ne garde qu'une structure par
   tuile — exactement la sémantique « premier occupant » que `bloquantAt` a été écrit pour rejeter (voir
   P0.1). Il faut un index **par couche et par bit d'arête**, pas une réutilisation. À faire dans le même
   passage que P0.1 : c'est le même défaut, vu par deux bouts.
7. **`PERF-07` — `poisAt` alloue un tableau à chaque appel** et se trouve sur deux chemins
   par-entité-par-tick (`staminaPoiFactor` dans le combat, `isSheltered` dans la température). `isSheltered`
   fait de surcroît un balayage complet des structures, et `fireBubble` un **second**, par humain et par
   tick. Correctif : une forme sans allocation pour `isOnPoiKind`, le patron `plancherDeLaVallee` pour
   `gameTimeAt`, un parcours partagé pour `isSheltered`/`fireBubble`.
   *(Le « 12,8 % du tick au GC » cité par l'auditeur est emprunté à une autre mesure — le réfuteur l'a
   retiré. Le mécanisme, lui, tient.)*
8. **`PERF-01` — le gel non commité s'est branché sous le BFS plein-carte du champ de flux.** Chaque tuile
   d'eau profonde interrogée tombe dans `estGele → baselineTemperatureAt → isSheltered` (tout le tableau) +
   `poisAt` (allocation). Le réfuteur a divisé l'estimation par un ordre de grandeur (le BFS n'interroge
   chaque tuile qu'une fois ; l'intérieur d'un lac non gelé n'est jamais atteint) et rétrogradé de critique
   à majeur — mais le fait tient : **`isSheltered` n'est mémoïsé nulle part**, sur un chemin dont le journal
   mesure 1 192 ms par champ.
9. **`PERF-05` — le cache des champs de flux s'invalide globalement.** Le réfuteur a **beaucoup** resserré
   le déclencheur (la cueillette n'invalide rien : `fiber_plant`, `berry_bush`, `champignon`, `leaf_pile`
   ont tous `blockHalfSub: 0` ; et la signature n'est relue que si une horde vit, donc la fenêtre est une
   nuit). Reste réel : la falaise à 1 192 ms est là et n'est pas gardée.
10. **Le fantôme de composant rejoue deux fois `recognizeFunctions` par frame**, sur le tableau de structures
    non filtré par intérêt.

---

# P2 — Architecture et maintenabilité

## La dette la plus chère : la règle de pose écrite deux fois

`/sim` exporte `evaluateBuild` (`village.ts:434`) avec ce commentaire : *« Extrait PUR du handler `build`,
pour que le FANTÔME de placement du client et le serveur partagent UNE SEULE vérité — au lieu de
réimplémenter (et faire diverger) les gardes. »*

**Aucun fichier de production ne l'appelle.** Son seul appelant hors `/sim` est un test.

Le client recompose l'ordre des règles dans `WorldScene.placeable` (`:463-501`), et `BuildGhost`
recalcule l'occupation dans la même frame. L'en-tête de `placeable` énumère lui-même **quatre divergences
déjà payées en régressions visibles** : « le carré manquait », « le landmark valait pour tout », « le
fantôme de toit rougissait », « la palissade oubliée ».

Le réfuteur a été rigoureux dans les deux sens :
- **aucun prédicat atomique n'est recopié** — `chebyshev`, `fireRadius`, `terrainConstructible`,
  `edgeBarrierAt`, `roofAt`, `floorAt`, `fullTileAt`, `poseLibre` sont tous importés de `/sim`. Ce qui est
  dupliqué est **l'ordre de composition**, pas les règles ;
- le remède « rendre la géométrie appelable » se heurte à `placementKeepsNavigable`, un A* qu'on ne peut pas
  faire tourner par image et par tuile survolée : le miroir client est un **sous-ensemble délibéré** ;
- et il a trouvé une preuve supplémentaire de la dérive : `build-ghost.ts:103` écrit
  `placing === 'wall' || placing === 'door' || placing === 'palissade'` — une **liste à la main** là où les
  deux autres sites la dérivent du registre. Pas de bug vivant aujourd'hui ; c'est la quatrième pièce
  d'arête qui le fera naître.

**Cible** — une fonction pure `poseAutorisee(...)` dans un module à part, paramétrée sur ce que le client
possède réellement, appelée par les trois sites ; `evaluateBuild` en devient l'adaptateur qui ajoute coût,
marteau et navigabilité.

## Les gardes qui comptent au lieu d'énumérer

- `lit-coverage.test.ts:49` affirme `expect(tous.size).toBeGreaterThanOrEqual(20)` — **un compte**. Une
  entrée ajoutée au registre `PIECES` compile, passe le lint, passe la garde et part en **damier magenta**
  au rendu. `bati-art.test.ts:31` recopie à son tour la liste des 20 types à la main : deux gardes comptent
  au lieu de dériver. Aucun fichier du client n'importe `STRUCTURE_TYPES`.
  **Correctif : trois lignes** — importer `STRUCTURE_TYPES` et affirmer l'appartenance à
  `LIT_STRUCTURE_TYPES ∪ BATI_LIT_TYPES ∪ EXEMPTIONS` (la liste d'exemptions est déjà écrite en dur).
  *Ne pas fusionner les trois tables d'art : le réfuteur a montré que ce sont du **code de dessin**
  (`dessiner(g)`), pas des données recopiées — les fusionner serait l'abstraction prématurée.*
- `cloture` et `encadrement` déclarent `arete: 'interdite'` mais le worldgen les pose sur des arêtes : **le
  registre ment sur leur géométrie**.
- `isEnclosed` écrit « ce qui clôture » en trois littéraux de types au lieu de lire `bloque`/`occupe`.
- Le prédicat `granaries` existe en trois copies indépendantes (voir P0.3).
- « Ce qui est de la viande » existe en quatre copies (voir P0.9).

## Code mort tenu en vie par une garde

- **Les dix lieux BÂTIS gardent leur art `_lit`** : 331 lignes sur 1 066 dans `poi-lit-defs.ts`, **16
  textures** cuites à chaque boot (**28,3 %** du budget de dérivation de normale des lieux, recalculé
  programmatiquement), que ni le jeu ni l'Atelier n'affichent — `poi-layer.ts:90` les sort avec un `return`
  sec. **Et c'est `lit-coverage.test.ts:19` qui les force à rester.** Le retrait est le geste prévu
  (`decisions.md:722`, `lieux-batis.md:171`), il n'a pas été fait. *Le réfuteur a fermé le dernier chemin
  qui aurait pu les rendre vivants (l'Atelier), et a réfuté l'argument « les tables ont divergé » : c'est un
  demi-nettoyage assumé, seule la moitié `_lit` a été oubliée. **Garder les stubs `POI_ART`** : ils portent
  l'étiquette du lieu.*
- `publishFoundableFire` / `publishUpgradableFire` : **zéro appelant**, et leurs deux clés fantômes
  survivent jusqu'en production (vérifié dans le bundle : Rollup a élagué les publishers, la table
  `CLES_HUD` porte encore les clés).
- **L'art de la falaise est recopié au pixel** dans le chip `massif` de `bati-art` : trois couleurs, onze
  positions de moucheture et la fissure en équerre, identiques, sans aucun lien. Plus une troisième copie
  de l'ardoise dans `TERRAIN_COLORS[23]`.
- `perf-structures.mjs` est **mort en dépôt** — son instrumentation a été retirée — et le `.patch` qui le
  ressusciterait est **committé** en disant « NE PAS COMMITTER ». Or la spec A9 programme explicitement de
  rejouer cette mesure au-delà de ~1 500 structures.
- `generateNodes` / `circleFactor` : morts dans le chemin joué, mais **deux critères d'acceptation les
  affirment encore** (`tension.md` A7, `economie.md` A6). *Attention : `CIRCLES.WILD_RADIUS`, lui, n'est pas
  mort — il pilote le gradient de danger dans le monde joué. Le réfuteur a rattrapé une recommandation qui
  aurait tué T11bis.*
- L'importeur Tiled est testé mais **orphelin** : aucun appelant hors tests.

## Structure

- **La composante fortement connexe de `/sim` est passée de 25/63 à 34/75 modules** sans qu'aucune garde ne
  la mesure. Les deux agents ont reconstruit le graphe indépendamment et trouvent **exactement** la même
  liste. La prémisse qui la rend inoffensive (« aucune consommation d'import à l'évaluation ») a été
  **revérifiée vraie** — mais `balance.ts:771` est déjà un appel à l'évaluation, et le jour où une arête de
  valeur relie `items` à `pieces`, cette constante explose en TDZ.
  **Ne pas entreprendre la refonte écartée le 2026-08-02.** Deux gestes bornés : ① une garde exécutable qui
  affirme la prémisse et borne la CFC ; ② déplacer les trois arêtes remontantes nommables — `die` est du
  cycle de vie d'une entité, pas du combat ; `nodeAt`/`treeJitter` sont des requêtes de nœuds, pas de
  l'économie. Les sortir libère `collision`, `pathfinding`, `temperature` et `foudre` d'un coup.
- **La surface publique de `/sim` est passée de ~270 à 497 noms, dont 250 ne sont importés par aucun hôte**
  — dont 34 fonctions de boucle (`advanceCombat`, `advanceEconomy`…) que `step()` appelle déjà et qu'un
  hôte ne doit surtout pas appeler. Le défaut n'est pas la taille : c'est qu'**aucune règle d'admission** ne
  distingue les trois intentions qui cohabitent (API d'hôte, prédicats purs pour le rendu, setup de
  scénario), si bien que personne ne peut dire si retirer un nom est sûr.
- **`tools/` contourne la frontière en entier** : 23 fichiers, 237 noms importés en profondeur dans 21
  modules internes, sans package ni tsconfig — **donc hors de `pnpm check`**.
- **La recette de fabrication du monde est écrite trois fois** (banc, Veillée, LAN). Deux divergences en
  sont déjà sorties, écrites noir sur blanc dans `server/scenario.ts` ; une troisième — le monde LAN
  n'appelle jamais `foundNpcVillage` — n'est documentée nulle part.

---

# P3 — Les garde-fous qui ne gardent pas

C'est la section la plus importante du rapport, parce que **toutes les promesses des autres sections sont
mesurées contre ces instruments.**

## `pnpm test` peut rendre vert quand des tests ont disparu

Reproduit de bout en bout avec le vitest du dépôt : un fichier avec `import './inexistant'` donne
`Test Files 1 failed | 3 passed` mais **`Tests 5 passed`**, et exit 1. Or `compte()` (`suites.mjs:81`) ne
lit **que** la ligne `Tests` → `echecs = 0` ; la branche jaune `r.code !== 0 && r.flaky` ne pose pas
`rouge` ; `process.exit(0)`. Et `.github/workflows/ci.yml:31` gate là-dessus.

La conjonction requise est que le flaky `onTaskUpdate` apparaisse dans la même sortie — ce que l'en-tête du
fichier documente comme **régulier dans `/sim`**, c'est-à-dire précisément la suite où un fichier peut
cesser de charger. *(Je l'ai moi-même déclenché deux fois pendant cet audit.)*

Second trou, **inconditionnel** : le total de tests est imprimé et **jamais comparé à un plancher**.

**Correctif** — ① lire aussi `Test Files` et exiger `0 failed` avant de peindre en jaune ; ② un plancher par
suite, commité à côté de `suites.mjs`. Un test qui disparaît doit coûter aussi cher qu'un test qui échoue.

## `pnpm smoke` ne peut pas échouer sur ses propres verdicts

**290** `console.error('!! …')` dans `smoke.mjs` — dont « LE GIVRE NE SE VOIT PAS […] G5 rompu », « la passe
de matière n'émet RIEN », « aucune lisière feuillus/conifères — G6 non photographié ». **Aucun** ne touche
le code de sortie : `failed` n'est posé que par `page.on('pageerror')`.

`pnpm smoke --scenario gels && echo OK` affiche OK pendant que le scénario imprime que son critère
d'acceptation est rompu. La règle de commit de `CLAUDE.md` ne peut donc être tenue que par un humain qui
lit la sortie — pas par un script, un agent ou la CI. **Chaque verdict écrit est un test qu'on croit avoir
et qu'on n'a pas.** Migration mécanique : le préfixe `!!` est déjà la convention.

## `pnpm check` s'arrête au premier paquet

`pnpm -r run check` abandonne au premier échec (défaut documenté), et l'ordre est topologique — **mesuré**,
pas déduit : sim, puis client, puis server. Une erreur de type dans `/sim` rend invisibles toutes celles du
client et du serveur. C'est mot pour mot le diagnostic que porte l'en-tête de `suites.mjs`, corrigé pour les
tests et laissé entier pour les types. **Correctif : `pnpm -r --no-bail run check`.**

## Aucun contrat de replay ne tourne sur le monde qu'on joue

Les 13 sites `runReplay` construisent tous un `createEmptyMap` de 20 à 160 tuiles ; le jeu tourne sur
~1,35 M de tuiles zonées. Conséquences vérifiées dans le code : `faunaCap: 0` ⇒ le tirage ambiant de la
faune (l'un des cinq consommateurs du PRNG partagé) n'est jamais rejoué ; `map.cendre` absente ⇒ le seul
système qui change la composition de `state.nodes` en cours de partie n'entre dans aucun replay ;
`meteoActive` absent ⇒ météo et foudre sortent immédiatement.

Le réfuteur a resserré honnêtement (le worldgen *lui-même* est bien testé déterministe ; le banc joue bien
la carte de production avec la faune) — et **trouvé pire** : `carte-immuable.test.ts` est le seul test à
faire vivre la carte de production sous `step()`, et son `mondeReel()` ne passe **ni `faunaCap` ni
`grounds`**, alors que son commentaire affirme « pendant que la faune, les monstres, les villages PNJ et le
feu font leur travail ». Il n'y a aucune faune dedans.

**Correctif** — **un** test : une graine, `generateZonedTerrain` une fois, `meteoActive`/`faunaCap`/
`grounds`/`home` armés comme `veillee.ts` le fait, quelques centaines de ticks via `recordAndStep`, et
comparer les snapshots. Le patron existe déjà cinq fois : il suffit de changer la carte qu'on lui donne.

## Les gardes du T0 mesurent la mauvaise carte

`t0-exploration.test.ts:50` et `zone-content.test.ts:22` génèrent sans plan → `'vallee'`, alors que les
trois hôtes servent `'racine'`. Le réfuteur a comparé tuile à tuile en coordonnées relatives :
**75,90 % des 797 440 tuiles de la Racine diffèrent.** Honnêteté de sa part : il a rejoué A2 et A5 sur le
plan servi, elles passent — c'est un **trou de couverture latent**, pas un défaut vivant. Mais A-MR2 ne
garde que les *dimensions* des rects, jamais le contenu, ce qui rend la promesse R-MR2 (« survit tuile pour
tuile ») elle-même douteuse.

## Deux modules d'autorité sans aucun test

- **`sim-worker.ts`** (529 lignes) : aucun `.test.ts` ne l'importe. Et `persistence.test.ts:168` recrée sa
  politique d'autosave à la main, en l'écrivant noir sur blanc : *« Reproduire ça ici est le seul moyen de
  tester ce que `sim-worker.ts` fait vraiment. »* **Le test admet qu'il teste une copie** — et c'est
  exactement là que vit P0.5.
- **`zone-room.ts`** (288 lignes) + `zone-singleton.ts` : toute l'autorité serveur de L1. Les cinq défauts
  serveur de ce rapport y sont, et aucun n'aurait survécu à un test qui pose deux faux clients et regarde
  ce que la room leur envoie. *Le réfuteur a nuancé : la consommation d'input et le seau de chat sont bien
  testés via `tick-driver` ; ce qui manque est le câblage.*

*Corollaire trouvé dans le fichier le mieux gardé du paquet : `valeurLegale` (`validate.test.ts`) fait un
`switch` sans le cas `parmi`, donc `build.edges` n'est jamais exercé avec une valeur valide. Le trou ne
mord pas aujourd'hui — c'est de la chance, pas une garde.*

## Autres

- **54 % du client** (24 366 lignes sur 44 473) n'est atteint par aucun test — mesuré par fermeture
  transitive, deux fois, à 0,8 point près. Le choix est délibéré et documenté (les tests client portent sur
  les fonctions pures), mais le filet qui couvre le reste — `pnpm smoke` — **n'est jamais exécuté par la
  CI**, et ne peut de toute façon pas échouer (voir plus haut).
- **La borne `climatMaximal` est tendue à zéro et n'a aucune garde**, contrairement à sa jumelle
  `gelPossible` qui porte un ⚠ *et* un test. Or l'asymétrie compte : une `gelPossible` fausse coûte de la
  perf, une `floreEntierementGelee` fausse **gèle la flore de toute la vallée**. Le jour où quelqu'un ajoute
  un terme réchauffant à `froidDuMonde`, la cueillette, la repousse et le semis se ferment partout sans
  qu'un test rougisse.
- **~35 générations de carte de production par run**, dont deux paires réellement redondantes (le réfuteur
  en a réfuté trois sur cinq : elles testent autre chose). `poi.test.ts` génère deux cartes complètes à 50
  et 100 joueurs pour prouver une **monotonie** qui se lirait aussi bien entre 12 et 24. Dix fichiers
  génèrent au scope module, donc `vitest -t` sur un seul test paie tout.
- **La suite vit près de sa limite** : `alignment.test.ts` + `carte-immuable.test.ts` = **125 s** sur machine
  au repos, et le test le plus long a un timeout de 180 s. Sous charge, ils expirent (constaté pendant cet
  audit). La CI a un budget de 15 minutes pour lint + check + test + build.
- **Le replay serveur réordonne les arrivées avant les départs, et son test ne peut pas le voir** : il
  appelle des deux côtés la fonction qu'il est censé éprouver.
- **Le replay-log serveur est en écriture seule et s'auto-disqualifie après 10 minutes** : passé
  `REPLAY_TICKS = 12_000` (avec `autoDispose = false` et la room créée au boot), `dropped > 0` pour
  toujours, et `replayServer` refuse. On paie ~2 Mo au repos et 55,5 µs/tick pour un journal que personne ne
  peut lire. *(Le réfuteur a rappelé que l'arbitrage est déjà en file dans `decisions.md:566` — ce n'est pas
  un oubli.)*

---

# P4 — La documentation qui ment

Sur un dépôt aussi documenté, c'est le défaut le plus coûteux : **on lui fait confiance**. Et elle ment
toujours dans le même sens — par pessimisme, ce qui fait rouvrir des chantiers clos.

| document | ce qu'il affirme | ce que dit le code |
|---|---|---|
| `alignement.md:5` + `pnj.md:34` | « ⚠ Débranché du mode joué — `veillee.ts` ne fonde aucun village PNJ » | `veillee.ts:153-154` fonde un Foyer et une Meute depuis le **2026-07-22**, testé (`veillee.test.ts:15`), acté (`decisions.md:457`). La bannière porte la date d'un audit fait **trois jours avant** la décision qui l'a périmée. |
| `combat.md:5`, R6, R8 | parade et bandage « pas encore câblés » | `WorldScene.ts:1649` (« LA PARADE EST REVENUE »), `aim.ts:456`, 8 gardes dans `aim.test.ts`. Le pointeur cité (`WorldScene.ts:788`) ne désigne plus rien. |
| `combat.md` R11 / A6 | le **zombie** : PV 40, dégâts 12, 2,4 t/s | Type retiré du bestiaire. Le Cendreux qui l'a absorbé joue **20 / 34 / 1,3** — un profil inversé. Qui calibre le PvE depuis cette spec part de faux. |
| `lieux.md:88` (critère A1) | « le brouillard de guerre du TERRAIN n'existe pas » | `fog.ts` (module entier), 14 tests, `UIScene.ts:435`, le % découvert affiché. *La réserve reste vraie pour la **vue monde** — ne pas la supprimer.* |
| `village.md` R8 / A3 | porte « auto-passante pour les membres, la serrure est le membership » | Remplacé le 2026-07-30 par la bascule explicite (`construction.md` R26), testé des deux côtés. Et la bannière de `village.md` revendique nommément « les accès ». |
| `village.md` R4 / A1 | « allumer un Feu fonde un village » | Le joueur ne passe plus par `light_fire` : `place_campfire` → `found_village`. Le code le déclare en tête du `case`. |
| `recolte.md` G2 / A2 | « `B` fait défiler les structures » | Touche débranchée le 2026-07-12, décision utilisateur citée dans le code. Le critère A2 est **infalsifiable**. |
| `brume.md`, `cuir.md`, `persistence-veillee.md` | « à implémenter », « rien n'est encore construit » | 287 lignes, une chaîne d'items complète, un autosave et un écran de reprise. |
| `gate1-finition.md` (cité par `CLAUDE.md` comme point d'entrée) | P0 « hints pilotés par un minuteur », P1 « reste à confirmer le bandage d'un PNJ », P3-24 « seuil en dur » | Les trois sont faits. *(Le réfuteur a corrigé : le document **a** été rouvert le 2026-07-28 sans qu'on barre ces items — ce qui aggrave.)* |
| `CLAUDE.md` | « TP/heure/invulnérabilité inertes dans un build de production » | Faux (voir P0bis) |
| `CLAUDE.md` | ce que mesure `pnpm smoke --dev` | Faux, et l'échappatoire n'est documentée nulle part |
| `monde.md` | hitbox d'avatar 0,6 tuile | 0,75 × 0,375 dans le code |
| `evenements.md` R3 | nomme une constante qui n'existe nulle part | — |
| `client.md` R1 | fait envoyer la carte **par le client** | L'inverse du code *et* de l'invariant « serveur autoritatif » |

Et un cas symétrique, plus insidieux : **`/sim` décrit au présent un comportement client qui n'existe pas.**
`brume.ts:227` et `events.ts:190` affirment « le client matérialise le filon depuis `filon_decouvert` » — il
ne le fait pas (voir Décisions).

Enfin, un invariant de `CLAUDE.md` est faux : **« l'alignement consomme le flux d'événements »** — il est
instrumenté en ligne dans la logique, et le dépôt le sait depuis le 2026-07-19.

---

# Décisions qui reviennent à Alexis

Je ne les tranche pas. Chacune est une conséquence de **jeu**, pas un correctif technique.

1. **L'acte III ferme la seule source de nourriture des villages PNJ.** À partir du jour 43,
   `climatMaximal` = 45 < `SEUIL_GEL` (52) : `floreEntierementGelee` est vrai à chaque tick, et
   `strikeRejection` refuse tout `berry_bush`, `champignon`, `leaf_pile`, **partout, pour tout le monde**.
   Or `TASK_DEFS` ne connaît que `gather_berries` côté nourriture.
   Mesuré par neutralisation (jour 50, grenier vide, deux buissons pleins à six tuiles) :
   *tel quel* → 3 PNJ morts avant la fin du cycle 1, buissons **intacts 40/40**, corvée repostée
   indéfiniment ; *`gelif` retiré* → buissons vidés, 3 PNJ vivants.
   **Le verrou thermique est délibéré et documenté** — le réfuteur l'a établi. Le trou est ailleurs : le
   principe F3 (« le froid ne ferme jamais ce qui permet d'y survivre ») a été confronté à la chaîne du
   **joueur** et jamais à `TASK_DEFS`. Trois issues : ① descendre `SEUIL_GEL` sous 45 (« cueille de jour »
   devient la règle de l'hiver) ; ② sortir `berry_bush` de `gelif` ; ③ donner aux PNJ une voie hivernale
   (récolte de `terroir`, ou une corvée de chasse). À trancher au banc (`tools/banc-saison.mts`).
   **Indépendamment de l'issue : `refreshBoard` ne devrait pas reposter une corvée dont aucun nœud n'est
   joignable** — `floreEntierementGelee` le dit en O(1).
2. **L'abri n'existe plus.** `isSheltered` ne reconnaît que `house` — inposable depuis le pivot campement —
   et le POI `grotte`. **Et le monde servi (`racine`) ne contient aucune grotte** : 0 grotte, 0 abri,
   0 mine, 0 ruine, mesuré sur les deux plans. Donc l'immunité à la foudre promise par `foudre.ts:11`
   (« l'abri immunise, période ») est **inatteignable**, `handleOrage` ne peut jamais atteindre sa branche
   utile, et le village PNJ passe la saison à bâtir sept logis 4×4 dont aucun habitant ne tire un degré.
   Le joueur qui mure et toite n'est pas plus au chaud qu'à découvert ; la foudre le frappe dans son salon.
   **Trois documents affirment le contraire** — `construction.md` R13, `lieux.md:72`, et `decisions.md`
   (2026-07-08) qui **acte** « toit ×0,5 sur nuit+biome ». Rien ne consigne l'abandon.
   La machinerie existe : `isEnclosed` sait déjà détecter un amas clos et toité, arêtes minces comprises.
   Question : **un `roof` sur un intérieur clos doit-il abriter ?** Et si oui, `desiredOrders` doit-il
   commander un toit sur les logis (sans quoi les villages PNJ resteront à ciel ouvert quoi qu'on fasse) ?
3. **La tenue d'hiver est éternelle** — aucune durabilité, aucune réparation. Un craft ferme l'acte III pour
   toujours et le cuir perd son évier. C'est le point (7) explicitement remis à plus tard
   (`decisions.md:446`), et il est **bloqué** par une décision en attente : le slot porté (`decisions.md:437`).
4. **Le filon de la Brume n'apparaît jamais chez le joueur.** `applyNodeDeltas` jette tout delta de nœud
   inconnu, et la liste des nœuds ne part qu'une fois. Le joueur **entend** et **lit** le filon sans pouvoir
   le voir ni le viser jusqu'au rechargement : la moitié positive de « fuir ou suivre » n'existe pas.
   La spec énumère elle-même les deux points de protocole à traiter.
5. **La façade du gel ignore la Brume (G5).** Mesuré : jour 41, **1752 couples tuile×instant gelés par la
   sim, 0 vus par le client** ; et sous une nappe le client n'éteint pas une tuile mais **toute la couche de
   glace**. Le joueur marche sur ce qu'il voit comme de l'eau libre. Restriction honnête du réfuteur :
   aucune Brume ne peut se lever en Veillée solo — le trou ne mord qu'en multi. Correctif additif : porter
   la nappe dans `SnapshotMessage`. C'est `/sim` qu'il faut toucher.
6. **`place_campfire` et R7** : soumettre la pose au R7 du village de l'acteur, n'appliquer que l'ancre 3
   pour les feux libres, ou écrire la dérogation. Aujourd'hui l'absence se lit comme un oubli.
7. **Identité de joueur côté serveur** : `onLeave` ne distingue pas le départ consenti de la rupture de
   socket, et `despawnAvatar` **annihile** l'inventaire sans cadavre pillable — couper la connexion d'un
   joueur, c'est le dépouiller sans trace. *(Le réfuteur a resserré : la perte est intra-session, le serveur
   L1 n'a aucune persistance, et l'auth est du périmètre L2 planifié. Reste le vecteur de grief, et la
   question « cadavre ou fenêtre de reconnexion ? ».)*
8. **Le replay-log** : le rendre utile (vidage disque + reconstruction) ou l'éteindre par défaut. L'état
   actuel est le pire des trois.

---

# Plan d'itérations proposé

**Lot 1 — les six qui cassent le jeu, sans décision de design.** P0.1 (collision sous-tuile, avec sa garde
exhaustive), P0.2 (clôture/encadrement), P0.3 (grenier irremplaçable), P0.4 (boot figé), P0.5 (sauvegarde
perdue), P0.6+P0.7 (mort et pause). Chacun avec son test de reproduction *avant* correctif.

**Lot 2 — le reste des corrections.** P0.8 à P0.13, plus les fuites de ressources.

**Lot 3 — les garde-fous.** `suites.mjs`, `smoke.mjs`, `--no-bail`, le test de replay sur carte générée, la
garde de `climatMaximal`, la garde de couverture d'art dérivée de `STRUCTURE_TYPES`. **Ce lot rend tous les
suivants vérifiables** — il pourrait passer en premier.

**Lot 4 — perf.** Dans l'ordre de rendement mesuré : `CB-01` (une ligne), `CB-07`, `R1/FX-06`, `FX-02`,
`PERF-08`, puis `PERF-03`+`PERF-07` (dans le même passage que P0.1). Chaque correctif encadré par sa mesure
de contrôle, relevée sur la **pire seconde**.

**Lot 5 — LAN.** `SRV-01`, `SRV-02`, l'anti-ESP du chat, le seau de jetons, la zone condamnée, `zone-room.test.ts`.

**Lot 6 — architecture.** `poseAutorisee`, les prédicats partagés (`granaries`, `VIANDES`, `cycleTickOf`),
le code mort, la règle d'admission d'`index.ts`.

**Lot 7 — documentation.** La resynchronisation des specs, puis la documentation complète du code et des
features.
