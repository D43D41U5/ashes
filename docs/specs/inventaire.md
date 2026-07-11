# Inventaire — le sac, la ceinture, l'objet en main

*Source : GDD §7 (« ce qu'on porte », la mort lâche l'inventaire), §8 (économie de flux, usure). Statut : actif.*

*Chantier 1 de trois. Chantier 2 « l'établi » (file de craft) et chantier 3 « le marteau »
(plan de construction, ghost, tiers de matériaux) ont leurs propres specs — ce document ne
les couvre pas, mais il pose le socle dont ils dépendent.*

## Objectif de design

L'inventaire de Braises est aujourd'hui un **dictionnaire infini** (`{ wood: 12 }`) : on ne
peut jamais être plein, le coffre n'a donc aucune nécessité mécanique, et la sim choisit
toute seule la meilleure hache du sac quand on frappe un arbre. Trois conséquences : le
sac ne pèse rien, le village ne sert pas à stocker, et le joueur ne décide de rien.

On adopte le modèle de **Rust** : un inventaire **borné et positionnel**, une **ceinture**
dont la case active est *ce qu'on tient réellement en main*, et une usure portée par
l'objet et non par son espèce. Ce qui doit en sortir : décider quoi emporter, décider quoi
laisser, et sentir le coût d'avoir oublié sa pioche au village.

Ce chantier ne touche **pas** au placement des structures (le GDD §6ter — « pas de
construction libre » — reste ouvert, voir `docs/decisions.md` 2026-07-11), ni au modèle
de craft (chantier 2).

## Règles

### Le modèle

- **R1 — L'inventaire est un tableau de cases.** `Inventory = Slot[]` où
  `Slot = { item: ItemId; count: number; wear?: number } | null`. **La longueur du tableau
  EST la capacité** : il n'y a pas de champ « capacité » à tenir cohérent, et une entité
  reçoit son sac à la naissance. `null` = case vide. L'invariant reste tenu : pas de
  classe, pas de `Map`, JSON-sérialisable (invariant d'architecture §3).

- **R2 — Un sac (`ItemBag`) n'est pas un inventaire.** `ItemBag = Partial<Record<ItemId, number>>`
  reste le type des **coûts** (`STRUCTURE_COSTS`, `RECIPES.inputs`), des **butins**
  (`MONSTER_DEFS.loot`) et des **transferts en gros**. C'est l'ancien type `Inventory`,
  renommé. Les 44 sites d'appel de la sim parlent en sacs : ils ne changent pas.

- **R3 — L'API historique survit, réimplémentée sur les cases.** `countOf`, `hasItems`,
  `addItems`, `removeItems` gardent leurs signatures — elles prennent un `Inventory` et un
  `ItemBag`. C'est ce qui rend la migration tenable : PNJ, butin, worldgen, tableau du
  village continuent de fonctionner sans une ligne de changement.

- **R4 — `addItems` peut échouer partiellement, et le dit.** Il retourne l'`ItemBag` de ce
  qui **n'a pas tenu** (vide = tout est rentré). Remplissage **déterministe** : d'abord
  compléter les piles existantes du même item dans l'ordre des cases, puis ouvrir les cases
  vides dans l'ordre des cases. Aucun tirage aléatoire — invariant §2 (déterminisme).

- **R5 — Les tailles de pile vivent dans `balance.ts`** (`STACK_SIZES`, défaut
  `STACK_DEFAULT`). Les outils et les armes ont une pile de **1** : chaque exemplaire
  occupe sa case, donc chaque exemplaire porte son usure.

- **R6 — L'usure descend dans la case, `Entity.wear` disparaît.** Aujourd'hui l'usure est
  agrégée **par type d'item** : deux haches partagent un compteur — un bug de conception qui
  dort. Désormais `Slot.wear` (absent = neuf). Un item empilable n'a jamais d'usure ; deux
  piles d'un même item empilable fusionnent, deux outils jamais (pile 1). Quand
  `wear >= BALANCE.TOOL_DURABILITY`, la case est vidée (l'outil casse).

### La ceinture et l'objet en main

- **R7 — Une seule liste, deux régions.** Les `BALANCE.BELT_SLOTS` (6) premières cases sont
  **la ceinture** (la hotbar) ; les suivantes sont le sac. Un seul tableau, donc un seul
  espace de glisser-déposer — comme Rust. Le joueur naît avec `BALANCE.PLAYER_SLOTS` (18)
  cases ; un PNJ avec `BALANCE.NPC_SLOTS` (40).

  *Pourquoi les PNJ ont-ils un grand sac :* leur boucle de corvées (`npc-errands.ts`) n'a pas
  de notion de « sac plein » et apprendre à en gérer une ouvrirait un risque de livelock
  (voir la note « milice livelock »). Une capacité large est une **donnée**, pas une règle à
  part : la sim n'a qu'un seul jeu de règles.

- **R8 — `Entity.activeSlot`** (entier) désigne la case tenue en main. `-1` = mains nues.
  Seule une case de la **ceinture** peut être active (`0 <= activeSlot < BELT_SLOTS`), et
  une case active vide vaut mains nues.

- **R9 — L'objet en main fait foi, et lui seul.** `toolMultiplier` (economy.ts) et la
  sélection d'arme (combat.ts) **cessent de fouiller le sac** : ils lisent la case active.
  - Récolte : le multiplicateur d'outil vient de l'objet tenu (rien / basique / fer → ×1 / ×2 / ×3).
  - `NodeDef.requiresTool` (filon de fer, veine de charbon) exige la pioche **en main** —
    l'avoir dans le sac ne suffit plus (refus `il faut une pioche en main`).
  - Combat : les dégâts viennent de l'arme **tenue** (`WEAPON_DAMAGE`), sinon
    `COMBAT.UNARMED_DAMAGE`. L'usure de l'arme frappe la case active.

### Capacité, récolte, mort

- **R10 — Le nœud garde ce qui ne rentre pas.** Une récolte dont le rendement ne tient pas
  entièrement dans le sac ne dépose que ce qui rentre ; le **stock du nœud est décrémenté
  d'autant, pas davantage**. Rien n'est perdu, rien ne tombe au sol. Si *rien* ne rentre :
  refus `sac plein`, sans cooldown ni XP (le coup n'a pas eu lieu).

- **R11 — Les conteneurs sont des inventaires à cases.** Le coffre naît avec
  `BALANCE.CHEST_SLOTS` (24) cases. Le cadavre hérite des cases de l'entité morte,
  augmentées du butin de monstre (`addItems` sur un sac assez grand pour tout tenir : un
  cadavre ne perd jamais de butin).

- **R12 — La mort lâche tout** (GDD §7, inchangé dans son intention) : les cases de
  l'entité passent au cadavre, son sac redevient vide (toutes cases à `null`), et
  `activeSlot` retombe à `-1`.

### Les gestes du joueur (nouvelles actions)

Toutes valident portée et propriété **dans la sim** (invariant §3 : serveur autoritatif) et
émettent `action_rejected` en cas de refus.

- **R13 — `set_active_slot { slot }`** : change la case tenue. `-1` accepté (rengainer).
- **R14 — `move_slot { from, to }`** : déplace/échange dans *son propre* inventaire. Deux
  piles du même item empilable **fusionnent** (le débord reste dans la case source) ; sinon
  les deux cases s'échangent.
- **R15 — `split_slot { from, to, count }`** : scinde une pile vers une case **vide**.
  `count` doit être entier, `0 < count < source.count`. Un item non empilable (pile 1) ne se
  scinde pas.
- **R16 — `transfer { containerId, kind, from, to, count }`** : transfert case-à-case entre
  le joueur et un conteneur (`kind: 'structure' | 'corpse'`). Portée :
  `BALANCE.INTERACT_RANGE`. Permissions **inchangées** (spec village R10-R12) : déposer
  reste ouvert à tous (la boîte aux dons), **retirer** exige `hasAccess`. Les effets
  d'alignement du dépôt de nourriture chez autrui (`gift_given`, chaleur) sont **préservés
  à l'identique**.

  *`deposit` / `withdraw` (en gros, par item + quantité) RESTENT dans la sim.* Les PNJ s'en
  servent (`npc.ts`, `npc-errands.ts` : leur boucle de corvées raisonne en *quantités*, pas
  en cases) et les recâbler sur du case-à-case rouvrirait le risque de livelock connu pour
  aucun gain. `transfer` **s'ajoute** pour le joueur ; c'est le **client** qui cesse
  d'utiliser `deposit`/`withdraw`, pas la sim qui les perd.

### Le client

- **R17 — La hotbar** (bas, centrée) : 6 cases, icône, compteur de pile, barre d'usure,
  case active surlignée. Touches `1`-`6`, molette = case suivante/précédente.

  *Conséquence à absorber ici :* les touches `1`-`5` sélectionnaient la structure à bâtir.
  Ce rôle passera à un item « plan de construction » tenu en main (chantier 3) ; en
  attendant, et pour que le jeu reste jouable entre les deux chantiers, la sélection de
  structure **passe sur la touche `B`**, qui fait défiler mur → porte → coffre → atelier →
  four. Le clic gauche continue de bâtir la structure sélectionnée. C'est une béquille
  assumée, avec une date de péremption : le chantier 3 la supprime.
- **R18 — Les vitales** (bas gauche) : PV, endurance, faim, température, blessures — en
  icônes et jauges. Le pavé de texte actuel (liste d'inventaire + pense-bête de touches)
  disparaît.
- **R19 — L'écran d'inventaire** (`TAB`) : la grille complète (ceinture + sac),
  glisser-déposer, **clic droit** = envoyer vers l'autre zone (sac ↔ ceinture, ou ↔ conteneur
  ouvert), **shift-glisser** = scinder la pile, survol = infobulle (nom, usure).
- **R20 — Le panneau de loot** : à portée d'un coffre ou d'un cadavre, `TAB` ouvre le
  conteneur **à côté** de son propre inventaire, et le glisser-déposer traverse les deux.
- **R21 — Les icônes sont dessinées en code** (`item-art.ts`, `Graphics` →
  `generateTexture`, 16 px), comme tout l'art du projet. Aucun pipeline d'assets.
- **R22 — Le geste est optimiste, l'autorité reste au snapshot.** Le client applique
  localement le déplacement de case puis se laisse corriger par le prochain snapshot. Aucune
  logique d'inventaire ne descend dans le client — il n'anticipe que l'affichage.

## Critères d'acceptation

*Headless, dans `/sim`, sauf mention contraire.*

### Le modèle de cases

- **A1** — Étant donné un sac de 4 cases vides et `STACK_SIZES.wood = 20`, quand on
  `addItems({ wood: 45 })`, alors les cases valent `[wood 20, wood 20, wood 5, null]` et le
  reliquat retourné est vide.
- **A2** — Étant donné `[wood 15, null, wood 20]` (pile pleine en case 2), quand on
  `addItems({ wood: 10 })`, alors on complète **d'abord** la case 0 (`wood 20`) puis on
  ouvre la case 1 (`wood 5`) — l'ordre des cases est la seule règle.
- **A3** — Étant donné un sac plein (aucune case libre, aucune pile incomplète), quand on
  `addItems({ stone: 3 })`, alors l'inventaire est **inchangé** et le reliquat retourné vaut
  `{ stone: 3 }`.
- **A4** — `removeItems` reste tout-ou-rien : étant donné `[wood 5, wood 5]`, quand on
  `removeItems({ wood: 12 })`, alors il retourne `false` et l'inventaire est inchangé ;
  `removeItems({ wood: 8 })` retourne `true` et laisse `[null, wood 2]` (on vide les cases
  dans l'ordre, on ne laisse jamais une case à `count: 0`).
- **A5** — Deux haches occupent **deux cases** (pile 1) et portent **deux usures
  indépendantes** : user la hache de la case 0 jusqu'à `TOOL_DURABILITY` vide la case 0 et
  laisse la case 1 intacte.

### L'objet en main

- **A6** — Hache **en case active**, on récolte un arbre : rendement ×2 et l'usure monte
  **dans la case active**.
- **A7** — Hache **dans le sac mais pas en main** (`activeSlot` sur une case vide), on
  récolte le même arbre avec la même seed : rendement ×1 (mains nues), aucune usure. *C'est
  le test qui prouve que la sim a cessé de choisir à la place du joueur.*
- **A8** — Filon de fer (`requiresTool`) sans pioche **en main**, alors que la pioche est
  dans le sac : l'action est **refusée** (`action_rejected`), le stock du filon est
  inchangé, aucun XP n'est gagné.
- **A9** — Lance en main : les dégâts valent `WEAPON_DAMAGE.spear`. Lance dans le sac,
  mains vides : les dégâts valent `COMBAT.UNARMED_DAMAGE`.

### Capacité et récolte

- **A10** — Sac dont il ne reste **que 2 places de pile**, on récolte un arbre qui
  rendrait 6 bois : l'inventaire gagne exactement 2 bois et le **stock du nœud ne baisse que
  de 2**.
- **A11** — Sac **totalement plein**, on récolte : refus `sac plein`, stock du nœud
  inchangé, `cooldownUntil` **non armé**, aucun XP gagné (le coup n'a pas eu lieu).
- **A12** — À la mort, toutes les cases de l'entité passent au cadavre, l'entité repart
  avec un sac **entièrement vide** et `activeSlot === -1`. Le butin de monstre s'ajoute au
  cadavre sans jamais être tronqué.

### Les gestes

- **A13** — `move_slot` de deux piles incomplètes du même item : elles **fusionnent**, le
  débord (au-delà de la taille de pile) reste dans la case source.
- **A14** — `move_slot` de deux items **différents** : les cases s'échangent.
- **A15** — `split_slot` de `wood 20` (count 8) vers une case vide : `[wood 12, …, wood 8]`.
  Vers une case **occupée** : refus. Sur un outil (pile 1) : refus.
- **A16** — `set_active_slot` avec un index hors de la ceinture (`>= BELT_SLOTS`) ou
  au-delà du sac : refus, `activeSlot` inchangé.
- **A17** — `transfer` vers un coffre d'autrui (`access: 'private'`) : le **dépôt** est
  accepté (boîte aux dons) et, s'il s'agit de nourriture chez un autre village, émet
  `gift_given` avec le même effet de chaleur qu'avant la refonte ; le **retrait** est
  refusé (`accès refusé`).
- **A18** — `transfer` hors de `INTERACT_RANGE` : refus, les deux inventaires inchangés.
- **A19** — `transfer` vers un conteneur **plein** : ne transfère que ce qui rentre, et le
  reliquat **reste chez la source** (aucun item ne s'évapore — invariant de conservation).

### Non-régression (le socle a changé, pas le jeu)

- **A20** — `replay.test.ts`, `sim.test.ts` et `events.test.ts` passent **inchangés dans
  leurs assertions de flux** : même seed + mêmes inputs → même état et même flux
  d'événements. La réécriture du socle d'inventaire ne déplace aucun tirage du PRNG.
- **A21** — Aucun item ne se crée ni ne se détruit dans un `transfer`, un `move_slot` ou un
  `split_slot` : la somme des `count` par `ItemId` sur (joueur + conteneur) est invariante.

## Hors périmètre / plus tard

- **La file de craft chronométrée et le panneau de craft** → chantier 2 (« l'établi »). Le
  craft reste, pour ce chantier, exactement ce qu'il est aujourd'hui (instantané, station à
  portée), simplement câblé sur le nouveau modèle de cases.
- **Le plan de construction, le ghost, les tiers de matériaux, le marteau** → chantier 3.
  Les touches `1`-`6` deviennent la ceinture dès ce chantier ; la sélection de structure à
  bâtir survit en attendant sous une forme minimale (voir le plan).
- **Les slots d'équipement portés** (armure, tenue) : le GDD n'a pas d'armure, on n'en
  invente pas.
- **Le poids / l'encombrement** : Rust n'en a pas, Braises non plus. La contrainte est le
  nombre de cases.
- **Le drop au sol** (lâcher un item hors d'un conteneur) : pas de sac au sol dans ce
  chantier. Le cadavre reste le seul conteneur volatil.
- **La réorganisation de l'inventaire des PNJ** : ils ont un grand sac et n'en gèrent pas
  la disposition. Le jour où un PNJ doit choisir quoi porter, ce sera une spec PNJ.
