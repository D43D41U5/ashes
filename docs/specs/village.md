# Le village — Feu, construction, propriété

*Source : GDD §5 (gouvernance, MVP : rang unique + Chef + propriété individuelle), §9 (fondation semi-libre), §6 (le village comme nécessité). Statut : **implémenté** (2026-07-05, A1-A6 verts en headless + smoke test navigateur). Jalon : V3.*

> **⚠ 2026-09-29 — CE QUI SURVIT ICI EST LA BALISE, PAS LE VILLAGE PNJ.** Les villages PNJ sortent
> du jeu (décision d'Alexis du 28/09, `braise.md` § 4). Ce que cette spec décrit et qui RESTE vivant,
> parce que la balise en dépend entièrement : la PROPRIÉTÉ et l'APPARTENANCE (`getVillageOf`,
> `memberIds`, `chiefId` — la seule porte de « ce Feu est le mien », d'où découlent la pose, le
> palier, le coffre, la porte et la démolition) et les ACCÈS (`invite`/`banish`, qui sont le
> mécanisme de COOP, pas des débris PNJ). Ce qui est CADUC : tout ce qui fait du village un acteur
> autonome — la main-d'œuvre, le tableau de corvées, la croissance. **Et ce n'est plus un projet :
> le 2026-09-29, `Village.tasks`, `nextTaskId`, `VillageTask`, `TaskKind` et `village-board.ts` ont
> quitté le code avec l'IA villageoise, ainsi que `npcsArrived` et `sitesInjoignables` — deux champs
> devenus des écritures que personne ne relisait.** Le `Village` qui reste est exactement une
> BALISE : une identité, un Feu, des membres, un combustible, un palier.
>
> ⚠ **SUITE DU 2026-09-29 (tranches 3 et 4)** — le `Village` a encore maigri, et toujours par
> retrait de ce qui faisait de lui un ACTEUR : `SimState.npcs` a quitté l'état avec ses 14
> lecteurs et son champ de snapshot ; `Village.buildTier` (le palier de BÂTI, distinct du palier
> du Feu) et le type `BuildOrder` sont partis avec le plan directeur du campement ; l'action de
> debug `debug_village_stage` avec eux. **La FONDATION elle-même a quitté `peuplerLesVoisins`** :
> l'élection des sites, la marge du raideur et le RÉSEAU DE SENTES tournent toujours à
> l'identique — les routes du monde joué sont inchangées, elles mènent à des clairières vides.
> `foundNpcVillage` survit **sans aucun appelant de runtime** (tests et instruments seuls) : son
> nom ment donc d'un mot, gardé exprès jusqu'à ce que le chantier de la balise sache ce qu'il pose.

> ⚠️ **Partie construction supersédée** (pivot Rust, 2026-07-18). La fondation, le carré, les composants et les fonctions émergentes sont désormais régis par `docs/specs/construction.md`. Cette spec reste la source pour la **gouvernance, la propriété, les accès, le coffre et les rangs** (R10-R12), réutilisés à l'identique.

## Objectif de design

Faire exister l'entité centrale du jeu : un lieu fondé par un joueur, où l'on construit, où l'on possède, et dont les serrures sont tenues par le serveur. En V3 le village est une *coquille mécanique* (Feu, murs, portes, coffres, permissions) — la vie (PNJ, économie, alignement) viendra l'habiter aux jalons suivants.

## Règles

### Les actions (extension du protocole)

- **R1 — L'input du joueur devient `{ move, action? }`.** Une action par tick au plus, validée entièrement côté sim (portée, coût, permissions — la « validation de vraisemblance » du GDD §11 commence ici). Actions V3 : `light_fire`, `build`, `demolish`, `deposit`, `withdraw`, `invite`, `banish`.
- **R2 — Toute action validée émet un événement de domaine** (`village_founded`, `structure_built`, `member_banished`…) : l'alignement (V8), la chronique (V9) et le tableau du village (V5) seront des consommateurs.

### L'inventaire et les coûts (avant l'économie)

- **R3 — L'inventaire minimal arrive en V3** : `Record<itemId, count>` sur l'avatar, items stubs (`wood`, `stone`). Les coûts de construction sont **réels dès maintenant** (table `STRUCTURE_COSTS` dans `balance.ts`) ; seule l'*acquisition* est stubbée — une fonction `grantItems` réservée aux tests et au mode dev, remplacée par la récolte en V4. On ne construit jamais gratuitement : le système naît honnête.

### Le Feu

- **R4 — Allumer un Feu fonde un village.** L'allumeur devient **Chef** ; le Feu appartient au village, pas au joueur. Coût : `STRUCTURE_COSTS.fire` (10 bois).
- **R5 — Fondation semi-libre (GDD §9)** : refusée à moins de `FIRE_MIN_DISTANCE` (2·R_max = 32 tuiles, cf. `construction.md` R1) d'un autre Feu, à l'intérieur d'une zone nommée (les landmarks sont inconstructibles), ou sur tuile bloquante. Un joueur appartient à **un seul village** ; on ne fonde pas si on est déjà membre.
- **R6 — Le rayon de construction** : toute structure doit être dans le **carré ×palier** du Feu de son village (`FIRE_RADIUS_BY_TIER` = 10/13/16, cf. `construction.md` R2/R6). Le respawn au Feu attend la mort (V6) ; la position du Feu est déjà le point d'ancrage du village.

### Les structures

- **R7 — Alignées sur la grille, 1×1 tuile** : `fire`, `wall`, `door`, `chest`, `workshop` (devenu l'**Établi N1** de la fonction Atelier, cf. `construction.md` §4bis). La **maison est reportée** à V5 : sans besoins ni sommeil, elle ne serait que décorative — elle arrive avec les PNJ dont elle est le régulateur (GDD §5 et §10).
- **R8 — Les structures participent à la collision** : un mur bloque comme de la roche. Une **porte est auto-passante pour les membres du village et bloquante pour les autres** — pas d'input d'interaction en V3, la serrure est le membership. (L'ouverture explicite, le forçage et la destruction arrivent avec le combat/raid.)
- **R9 — Construction** : sur tuile marchable, non occupée, dans le rayon (R6), par un membre du village, en payant le coût. `demolish` : par le propriétaire de la structure ou le Chef, rembourse 50 % (`DEMOLISH_REFUND`), impossible sur le Feu (V3 : un Feu ne s'éteint pas — la mort du village est un chantier ultérieur).

### La propriété (la clef de voûte, GDD §5)

- **R10 — Chaque structure a un propriétaire** (le bâtisseur) **et un niveau d'accès** : `private` (propriétaire seul), `village` (membres), `public`. Défauts : coffre → `private`, porte → `village`, mur/atelier → `village`. Le propriétaire peut changer le niveau d'accès de ses structures (`set_access`, inclus dans R1).
- **R11 — Le coffre est la serrure archétype** : `deposit`/`withdraw` exigent l'accès, à ≤ `INTERACT_RANGE` (1,5 tuile). Contenu : mêmes stacks que l'inventaire.
- **R12 — Rangs MVP : Chef et Membre.** Le Chef invite (`invite`, l'invité doit être à portée — en Veillée solo ce sera l'embauche de PNJ en V5) et bannit. Le banni perd instantanément tous les accès `village` (les serrures obéissent au serveur, pas à la bonne foi). Ses structures et leur propriété **restent à lui** (propriété individuelle — il pourra les démonter : c'est la graine de la Scission).

## Critères d'acceptation

- **A1** — Fonder : `light_fire` avec 10 bois crée le village (fondateur Chef, événement `village_founded`) ; refusé sans bois, dans « le Pont », à < 32 tuiles (2·R_max) d'un autre Feu, ou si déjà membre.
- **A2** — Construire : un mur dans le rayon débite le bois, occupe la tuile, bloque le déplacement (testé par `moveAvatar`) ; refusé hors rayon, sur tuile occupée, sans matériaux, ou par un non-membre.
- **A3** — La porte : un membre la traverse, un étranger est bloqué ; après bannissement, l'ex-membre est bloqué au tick suivant.
- **A4** — Le coffre : dépôt/retrait par le propriétaire ; refusé pour un autre membre si `private` ; autorisé après passage en `village` ; jamais pour un étranger ; hors de portée → refusé.
- **A5** — `demolish` par le propriétaire rembourse 50 % ; refusé sur le Feu et pour un non-propriétaire non-Chef.
- **A6** — Le contrat de replay tient avec les actions : même seed + carte + inputs (mouvements **et** actions) = même état et mêmes événements au bit près.

## Hors périmètre (et où ça revient)

- Récolte des matériaux → V4 (remplace `grantItems`).
- Maison, PNJ résidents, tableau du village → V5.
- Durabilité/dégâts des structures, respawn au Feu, forcer une porte → V6-V7.
- Hôte/Résident/Gardien/Doyen, Charte, Scission complète → Phase Vallée (Va2).
- Extinction/mort du village, transfert de chefferie → Va2.
- Client : UI de construction complète — V3 livre un mode construction minimal (choix de structure + placement + retours d'erreur), le confort viendra en V10.

## Ajouts à `balance.ts`

`FIRE_RADIUS_BY_TIER = [10, 13, 16]` (carré ×palier, remplace `FIRE_BUILD_RADIUS`), `FIRE_MIN_DISTANCE = 2·R_max = 32`, `INTERACT_RANGE = 1.5`, `DEMOLISH_REFUND = 0.5`, `STRUCTURE_COSTS = { fire: {wood:10}, wall: {wood:2}, door: {wood:3}, chest: {wood:4}, workshop: {wood:6, stone:4} }`.
