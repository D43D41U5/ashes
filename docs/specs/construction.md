# La construction — le Feu, l'enceinte, les fonctions émergentes

*Source : conçu en session (2026-07-18) avec Alexis, sur la base du GDD §6ter (« modèle à slots »), qu'il **révise entièrement**, de l'Annexe B (catalogue), et de « comme Rust ». **Remplace** l'ancienne proposition à slots et la partie construction de `specs/village.md` (V3). Statut : **validée et actée** (`docs/decisions.md`, 2026-07-18 ; GDD §6ter porte le bandeau de révision) — **socle implémenté** (marteau, Forge, Atelier, Grenier, Ferme, navigabilité R7 ; commits `f3da6cd`→`c6be511`). **Restent différés** : l'upkeep R16-R17, les fonctions Infirmerie/Fumoir/Dortoir et le comportement passif R12 (cf. §10-§11). Catalogue Veillée tranché et inclus (§4bis). Jalon : 10bis.*

> ⚠️ **Divergence assumée d'avec le §6ter.** On quitte les *slots typés à positions fixes* pour un **builder à composition émergente façon Rust**. Le reste du §6ter (paliers du Feu, garnison, protections offline, cible de raid) survit, réexprimé.

---

## 1. Le modèle en une phrase

*On fonde un Feu librement sur sol ouvert, loin des landmarks et des voisins ; il possède un **carré** qui grandit avec son palier ; dedans on pose **instantanément** des composants 1×1 pas chers (le vrai coût, c'est aller chercher les matériaux) qui, **groupés, font émerger** des fonctions dont le niveau monte avec ce qu'on leur ajoute ; les **murer et toiter** donne un bonus propre à chaque fonction ; rien ne se dégrade sauf les murs, entretenus par l'upkeep du Feu.*

### Le cadre : Rust en vue de dessus, trois torsions

Le socle est celui de Rust, transposé top-down : le **Feu = Tool Cupboard** (zone de privilège + autorisation + upkeep), on **arme et on pose** au fantôme, **instantané**, portes à **serrures**, décroissance par **upkeep** qu'on nourrit.

1. **L'espace** (§3) : la zone est un **carré qui grandit ×palier**, fondé librement *entre* les landmarks contestés — pas un site imposé.
2. **L'émergence** (§4) : les deployables ne sont pas que des deployables — **groupés, ils forment des fonctions à paliers** (enclume + four = Forge N2), et **murer + toiter** ajoute un bonus par fonction.
3. **La simplicité** (§5) : pas de temps de chantier (la friction = acquérir les matériaux), composants **permanents**, seuls les **murs** s'usent (via l'upkeep du Feu).

La couche que Rust n'a pas (§6) : un **overlay + fantôme prédictif** qui montre l'émergence (« → Forge N2 ») *avant* la pose.

---

## 2. Ce qui est réutilisé de V3 (à ne pas jeter)

- **`Structure`** `{ id, type, tx, ty, villageId, ownerId, access, hp, inventory? }` — étendue (voir §4).
- **Actions** validées côté sim (`{ move, action? }`, une par tick) : `place_campfire`, `found_village`, `build`, `demolish`, `deposit`, `withdraw`, `set_access`, `repair`, `invite`, `banish`.
- **Propriété & accès** (`private | village | public`, `hasAccess`), **collision & serrures** (mur bloquant, porte auto-passante pour les membres), **PV & réparation**, **fantôme client** + panneau.

Le seul acquis qui change de nature : `build` devient une pose **de barrière ou de composant** (toujours instantanée) ; les « bâtiments » monolithiques disparaissent au profit des composants + reconnaissance.

---

## 3. L'espace — le contrat spatial

- **R1 — Fondation *open*.** Le Feu (feu de camp posé puis promu, flux V3 `place_campfire` → `found_village`) se pose sur toute tuile **marchable**, **sans nœud de ressource** dessous, **hors eau/feature**. Refusé si un **POI-spécifique** (chokepoint, gisement, eau, tanière, ruine — **pas** les zones-régions/toponymes) tombe dans le carré **à taille max**, ou si un autre village est à **moins de 2·R_max** (distance de Chebyshev). Conséquence voulue : les landmarks restent des **communs contestés**, les villages s'installent *entre* eux.
- **R2 — La zone est un carré.** Le rayon `R` définit `{ tuiles : Chebyshev(tuile, Feu) ≤ R }`, soit `(2R+1)×(2R+1)`. `R` **grandit avec le palier du Feu** (R6), mais le carré est **réservé à sa taille max dès la fondation** (validation R1 contre `R_max`) : sprawl visible en montant, **zéro chevauchement** garanti pour toujours, et les landmarks ne se font **jamais avaler**.
- **R3 — Rareté organique, placement libre.** Aucune position imposée, aucun compteur de slots. Ce qui limite : le **palier du Feu** (débloque *quels types de composants*), les **matériaux**, le **temps**, la **pression de saison**. Pas d'unicité (R11).
- **R4 — Terrain neutre, SAUF l'eau.** Toute tuile **constructible** du carré se vaut ; aucun bonus/malus de terrain à la pose (réserve : bonus doux post-playtest). Mais « marchable » ne suffit pas : **l'eau libre est inconstructible, et seul le `floor` y fait exception** (décision d'Alexis, 2026-07-31). Le gué (`shallow_water`) se traverse à mi-jambes, donc il est marchable — et pendant tout ce temps il portait le feu de camp, le Foyer, la forge et la parcelle de ferme. Une porte unique juge désormais **par pièce** (`terrainConstructible(terrain, type)` dans `construction.ts`), partagée par les quatre gestes de pose *et* par le fantôme du client. Les pièces admises sur l'eau sont une **liste** (`POSABLE_SUR_EAU`) et non une exception codée en dur : le pont et le ponton (§11, différés) s'y ajouteront. L'eau **profonde** refuse tout, `floor` compris — elle n'est pas marchable ; c'est la ligne à rouvrir le jour où un pont doit l'enjamber. Le marais, la tourbière et la roselière restent constructibles : ce sont des sols détrempés, pas de l'eau libre (le rendu les peint au grain de sol, quand le gué passe au shader d'eau).
- **R5 — Bâtir efface d'abord le nœud.** On ne pose que sur tuile ouverte ; pour bâtir où pousse un nœud, on le **récolte** (récolter = défricher). Une structure occupe **une tuile** (`structureAt`) — ***sauf* mur et porte, qui vivent sur une ARÊTE** (R25) : eux ne prennent pas la tuile, donc un nœud ne s'oppose pas à leur pose.
- **R6 — Paliers du Feu.** Le village a un `tier` (1→3). Monter de palier (coût matériaux croissant au Feu, éventuel seuil de population) **agrandit le carré** (`R`), débloque de **nouveaux types de composants** (le four d'acier exige P3), et renforce respawn/protections offline. Les capacités d'archétype d'alignement s'ancrent dans un composant/une fonction — donc ont une **adresse raidable**.
- **R7 — Invariant de navigabilité (règle technique).** Au placement d'un mur/composant, on **rejette** tout ce qui déconnecterait le Feu, un composant, ou couperait l'A*/flow-field (flood-fill de vérification). On ne peut pas murer son propre Feu ni piéger un PNJ. C'est la contrepartie qui rend le placement libre sûr (remplace le « layout connu » du §6ter). Vérifié depuis le socle marteau (`construction.ts` `wouldDisconnect` : flood-fill AVANT/APRÈS à ordre fixe).

---

## 4. Les objets — le modèle de l'enceinte

- **R8 — Deux familles, par nature.**
  - **Barrières** (passives, statiques) : `wall`, `door`, `floor`, `roof`, `trap`, `chest`. Posées **librement, en nombre**, coût + PV, **sans palier, sans reconnaissance**. Murs/portes/pièges **bloquent** ou closent ; sols/toits sont des pièces **molles** (sans collision, R14).
  - **Composants** (actifs) : enclume, four, lit, établi, cuve, lit de soin, fumoir… — l'**atome** du système. 1×1, posés instantanément (R10). *(Migration V3 : `furnace` reste un composant ; `workshop`/`house` disparaissent au profit de fonctions émergentes.)*
- **R9 — La fonction émerge d'un amas local.** Un groupe de composants **proches** (≤ `AMAS_RADIUS`) dont le contenu satisfait une **recette** *fait* une fonction, à un **lieu** précis : `{enclume, four}` groupés = **une Forge**. Reconnaissance en **set minimum** (les extras sont permis). Chaque fonction groupe **ses** composants ; deux fonctions peuvent coexister/se toucher. Détection **déterministe** (flood-fill/parcours à ordre fixe).
- **R10 — Le palier = la richesse de l'amas.** Pas de système de niveaux séparé : le niveau d'une fonction est **le sous-ensemble de composants présent**. Forge : enclume seule = **N1** (fer de récup) → + four = **N2** (le fer) → + four d'acier/soufflet = **N3** (l'acier). Enrichir un amas *fait monter* la fonction ; enlever un composant (démolition) la fait **retomber** d'un palier. (Aligne l'Annexe B, qui décrivait déjà les paliers comme du meilleur équipement.)
- **R11 — Pas d'unicité.** On pose autant de composants/amas qu'on peut se **payer**. La capacité existe dès **≥ 1 amas valide** ; un amas de plus = **débit parallèle** (deux enclumes = deux forgerons) ou **redondance défensive**. Le palier plafonne à N3 (recette) — pas de scaling infini.
- **R12 — Le comportement : à l'usage ET passif.** Une fonction agit **à l'usage** (station où l'on crafte, conteneur où l'on stocke) **et/ou passivement** (spawner : le poste de garde fait apparaître des PNJ ; aura). Effets passifs **scopés à ce que la sim sait brancher** : spawner + conteneur d'abord ; les auras (vision) attendent un système de fog (dette).
- **R13 — L'enceinte = bonus thématique, optionnel.** **Murer + toiter** un amas (murs formant une clôture **et** intérieur entièrement `roof`) accorde un **bonus propre à la fonction** : forge → qualité, infirmerie → soin plus sûr, dortoir → moral « chez soi », grenier → conservation. **Optionnel et non-critique** : la fonction marche sans (la détection d'enceinte ne peut jamais *casser* une fonction, seulement lui retirer un bonus). Le **sol** (`floor`) est un **renfort optionnel** (bonus accru), pas requis. Le **toit** est ce qui *ferme* l'espace et **retient la chaleur** (bonus thermique, réponse « abris » au Grand Froid, GDD §7).
- **R14 — Sols et toits sur carte plate.** Mono-niveau (la carte est plate — pas de verticalité). Sols et toits **ne bloquent pas** (pièces molles) → l'invariant de navigabilité (R7) reste simple, seuls les murs comptent. La détection d'enceinte = espace clos par les murs **et** entièrement toité (flood-fill intérieur + toutes cases couvertes), déterministe.
- **Dérivé gratuit** : le **Feu** reste l'ancre *sui generis* (R1). Le **dortoir** = un amas de lits. Le **quartier personnel** = une alcôve murée (ton lit + ton coffre `private` + porte verrouillée) — **émergent**, aucune règle dédiée. Conséquence Scission : purement mobilière.

---

## 4bis. Le catalogue de la Veillée (tranché en session, 2026-07-18)

*Une **fonction** émerge d'un amas ; son palier = la richesse de l'amas (R10). Le **palier du Feu plafonne le palier atteignable** (P1→N1, P2→N2, P3→N3) ; matériaux/temps/saison décident *lesquelles* on bâtit. Bonus d'enceinte = R13 (murs **+ toit**).*

### Fonctions

| Fonction | Type | N1 (P1) | N2 (P2) | N3 (P3) | Bonus d'enceinte |
|---|---|---|---|---|---|
| **Forge** | station | Enclume — fer de récup | + Four — le fer | + Four d'acier — l'acier | **Durabilité** (les pièces forgées s'usent moins) |
| **Atelier** | station | Établi — mobilier/charrettes | + Tour méca — contre-siège | + Atelier lourd — siège/Cendre | **Vitesse** de craft |
| **Grenier** | conteneur | Silo — anti-pourriture | + Cave — passe l'hiver | + Réserve stratégique | **Conservation renforcée** |
| **Infirmerie** | station | Lit de soin | + Chirurgie + herbes | + Hôpital — vies sauvées | **Guérison accélérée** |
| **Ferme** | station | Parcelle — de saison | + Serre — cultures d'hiver | + Terroir — Ermitage | *aucun (plein air)* |
| **Fumoir/tannerie** | station | Fumoir + cuve — viande/cuir | + Couture — tenues d'hiver | + Signature — bannières/camo | **Chaleur des tenues** |
| **Dortoir** | repos | Lit(s) | + Cuisine commune | + Réfectoire — banquets | **Récupération accrue** (l'ex-« maison ×2 ») |

**Liens de matière** (aucune dépendance *de bâtiment* codée) : Forge N2 ← fer (mine) ; Forge N3 ← charbon (mine *ou* four à charbon de l'Atelier) ; Fumoir ← gibier (chasse) ; le **quartier personnel** = l'alcôve murée émergente qui porte le bonus du Dortoir.

### Barrières (coût + PV, pas de fonction)

- **Mur / Porte** : **paliers de matériau** (bois → pierre maçonnée → métal), améliorés **sur place au marteau** (payer la différence, instantané) — chaque palier = + PV + meilleure résistance à la dégradation. La porte suit (→ « **porte fortifiée** », plus de temps contre le bélier) ; serrure par membership (V3).
- **Sol** — pièce molle, **renfort optionnel** du bonus d'enceinte. **Toit** — pièce molle, **requis** pour le bonus (fade à l'entrée, R24). **Piège** — danger **réutilisable/réarmé**, palier par dépendance (Atelier → piège mécanique). **Coffre** — conteneur privé (V3).

### Coupé / différé

- **Coupé** (pas dans la Veillée) : **Poste de garde** et **Tour de guet** — aucune fonction de fortification ; la défense = barrières + **milice émergente** (V6).
- **Différé** (multi / plus tard) : **Marché**, **Bastion**. Le **Terroir** vit comme N3 de la Ferme.

---

## 5. La construction et l'entretien — le contrat temporel

- **R15 — Pose instantanée.** Payer les matériaux → barrière/composant posé au tick suivant (V3). **Pas de chantier**, donc **pas de PNJ bâtisseurs** (dette) : la construction est joueur seul ; les PNJ récoltent/cuisinent/**réparent**/défendent. La **friction est d'acquérir les matériaux** (le fer/l'acier des paliers hauts vivent dans le sauvage/la mine — la construction pousse dehors).
> ✅ **LIVRÉ** (2026-07-22, décision V1-11) : `advanceUpkeep` (`village.ts`) brûle `village.fuel` au tick et dégrade les murs à sec ; on nourrit via `feed_fire`. Le combustible du feu **LIBRE** vit désormais sur la structure et le feu peut **s'éteindre** (braises → éteint) — spec `feu-station.md` (S1-S2, S12), 2026-07-25. La migration de l'upkeep du Foyer vers ce modèle unifié reste différée (S16).

- **R16 — Upkeep centralisé au Feu (comme la Tool Cupboard).** On **approvisionne le Feu** en matériaux ; il les **consomme lentement** pour tenir sa zone. Stock plein → les **murs/barrières** de la zone ne se dégradent pas. À sec → dégradation, puis le village tombe en **ruine** (cycle de vie). Le stock qui dure **~3-4 jours** *est* la règle « survit à l'abandon » (§6ter). « **Nourrir le Feu** » = la tâche communautaire zéro (tâche PNJ). Plus vite consommé au Grand Froid.
- **R17 — Composants permanents.** Seuls les **murs/barrières** se dégradent (R16) ; les composants, une fois posés, sont **acquis**. Le métabolisme « tout se consomme » (GDD §8) vit dans les **consommables** (outils, armes, nourriture s'usent déjà), pas dans l'architecture.
- **R18 — Démolir.** Par propriétaire ou Chef (V3), remboursement partiel. Enlever un composant fait **retomber** le palier de sa fonction (R10). Interdit sur le Feu.

---

## 6. L'interface — le geste de construction

*Le client est bête (invariant §3) : il arme des actions, la sim revalide tout. Cette section définit ce que l'UI génère.*

- **R19 — « L'interaction passe par ce qu'on tient. »** On tient un objet (ceinture 1-6 + molette), le clic gauche fait ce qu'il fait. Construire s'arme en tenant **le marteau** (barrières) ou **un composant** (posé comme le feu de camp).
- **R20 — Menu du marteau, séparé du craft.** Le **marteau ouvre son propre menu de pose** : les **pièces structurelles** (`wall`, `door`, `floor`, `roof`, `trap`). Le **panneau d'artisanat** redevient *pur* (fabriquer outils/armes/survie/matériaux). Les **composants** (enclume, four…) sont des **objets qu'on tient et pose** (flux feu de camp), pas dans le menu du marteau.
- **R21 — Fantôme lié à ce qu'on tient.** Le marteau tenu → fantôme de la pièce structurelle sélectionnée. **Ranger le marteau → les fantômes structurels disparaissent.** Un composant tenu → *son* fantôme à lui. Vert si rien (visible du client) ne l'interdit, **rouge** sinon ; la sim revalide (R7, R1…). Grisé-invitation pour un composant verrouillé par palier.
- **R22 — Overlay + fantôme prédictif (la lisibilité de l'émergence).** Quand des composants forment une fonction : **label flottant** (« Forge · N2 ») + liseré sur l'amas reconnu ; si l'amas est **clos+toité**, second liseré (l'enceinte) + picto de bonus. Au geste, le fantôme **prédit** — tenir un four près d'une enclume affiche « → Forge N2 » **avant** la pose. *(Panneau récap des fonctions du village : confort différé.)*
- **R23 — Geste clic-par-case (Rust-pur).** Une pose par clic, murs compris (pas de glissé). Uniforme et simple. Dérivés portés : **rotation** (`A`/`E` — voir R25 ; l'esquisse disait « touche R », mais `R` n'a jamais été câblée et le clavier a été refondu depuis, cf. `keymap.ts`), **snap** grille, **toasts** d'erreur.
- **R24 — Rendu des toits.** Un toit occulte l'intérieur en vue de dessus → **fade/cutaway** quand l'avatar entre sous la couverture. Tâche client. *(Livré autrement, et mieux : la règle des **pans** — un côté de bâtiment tombe d'un bloc à ≤ 2 tuiles, découpe au sol plutôt que transparence. Voir `render/pans.ts` et la décision du 2026-07-27.)*
- **R25 — Mur et porte se posent sur une ARÊTE, pas sur une tuile** *(décision d'Alexis, 2026-07-30 ; le modèle de mur mince date du 2026-07-27, seul le bâti généré en usait)*.
  - **L'arête est l'unité.** Une tuile a quatre arêtes (bits `N=1, E=2, S=4, O=8`, `geometry.ts`). Un mur en occupe **une seule**, et la bande qu'il bloque est **à cheval** sur la limite (`WALL_EDGE_SUB`, moitié de chaque côté). Ce qui est bloqué n'est donc plus une case mais un **franchissement** : une tuile bordée au nord se traverse d'est en ouest, et une salle garde son dallage entier.
  - **Une structure par arête.** Le coin d'une pièce porte **deux murs distincts** — deux identités, deux fois les PV, deux matériaux possibles, deux démolitions. Un pillard qui casse le coin ouvre **un** côté. *(L'alternative — une structure dont `edges` accumule les bits, ce que fait la Ferme générée — a été écartée : on paierait deux murs pour 200 PV partagés, et le coin deviendrait le point faible du village sans que rien ne le dise.)*
  - **L'occupation est une quatrième couche.** Sol, toit, tuile pleine, **arêtes**. Chaque couche répond pour elle seule : on adosse un four à son mur, on longe une haie de buissons, on ferme un angle. La question de l'arête est **symétrique** — le mur entre (5,5) et (5,6) s'écrit « (5,5)+S » ou « (5,6)+N », donc poser depuis l'autre côté est refusé (`edge_taken`), sinon on paie deux fois pour une seule maçonnerie.
  - **Sol et toit gardent la tuile.** Ce sont des pièces molles (R14) : elles n'ont pas d'arête à porter (`no_edge`). Une pièce, c'est donc des sols et un toit sur des tuiles, entourés de murs sur des traits.
  - **La navigabilité (R7) juge des franchissements.** C'est elle qui refuse encore le dernier segment qui scellerait le Feu, et c'est elle qui reconnaît une enceinte de murs minces (R13).
  - **Le geste.** Le fantôme montre l'arête armée ; `A` et `E` la font tourner dans les **deux sens** (un seul sens demanderait jusqu'à trois appuis pour revenir en arrière). L'arête **persiste** d'une pose à l'autre : on bâtit un mur droit en cliquant plusieurs fois. Cliquer une arête qui porte déjà un mur l'**améliore** au palier de matériau choisi (R8) — jamais « la première structure de la tuile », sinon fermer un angle améliorerait son voisin.
  - **Migration silencieuse.** Une structure **sans** `edges` garde le comportement historique (elle prend sa tuile). Les parties sauvegardées, les villages déjà bâtis et les tests seedés ne bougent pas d'un pixel.
  - **La porte MONTRE son passage** *(constat d'Alexis, 2026-07-30)*. Une `door` ne bloque que l'étranger : le dessin doit donc laisser voir **un trou**, et ce trou est **dérivé** — `T − 2·POST ≥ AVATAR_HITBOX_TILES · T`, la même contrainte que le seuil du bâti généré. Une porte peinte pleine est un mensonge sur la seule chose qu'elle ait à dire. Sur une arête **verticale**, aucun linteau ne peut enjamber l'ouverture (la hauteur et la longueur du ruban tombent sur le même axe à l'écran) : vue d'en haut, une porte dans un mur nord-sud **est** un vide tenu par deux dormants.

- **R26 — La porte s'OUVRE et se FERME, à la touche d'interaction** *(décision d'Alexis, 2026-07-30)*.
  - **Deux états, et un seul geste.** `Structure.open` : absent/`false` = CLOSE, `true` = OUVERTE. La touche d'interaction (`F` par défaut) bascule, à portée de **bras** (`INTERACT_RANGE`), sans outil et sans coût. Action `toggle_door`, événement `door_toggled` (il porte QUI l'a poussée).
  - **CLOSE, elle arrête TOUT LE MONDE** — y compris son propriétaire. C'est ce qui donne un sens à l'ouvrir : une porte qui céderait toujours aux siens n'aurait aucune raison de s'ouvrir, et la touche serait un ornement. **OUVERTE, elle ne retient plus personne** — ami comme pillard : c'est le prix de l'avoir laissée ouverte, et ce qui fait de « fermer le soir » un vrai geste.
  - **L'appartenance décide qui POUSSE, plus qui passe.** `hasAccess` (propriétaire / village / publique) : un pillard n'ouvre pas la porte d'un autre, il la **casse**. L'invitation et le bannissement gardent donc tout leur mordant.
  - **Elle ne bouge JAMAIS seule** (contre une refermeture automatique) : l'état survit au snapshot, au rejeu et à la sauvegarde.
  - **Les PNJ du village l'actionnent** (`MoveWorld.opensDoors`) — sans quoi fermer sa porte enfermerait ses propres villageois et leurs corvées s'arrêteraient en silence. Ils ne TOUCHENT PAS à l'état : la décision du joueur est la seule qui compte, et on ne simule pas le battant qu'ils poussent. Ils ne franchissent que les portes de **leur** village.
  - **R7 et R13 inchangés.** `blocksNavigation('door')` reste faux (une porte est *potentiellement* passable — on la pousse), et l'enceinte ne dépend **pas** de l'état : ouvrir la porte de sa forge ne lui fait pas perdre un palier.
  - **Le battant PIVOTE, et il se VOIT ouvert** *(demande d'Alexis : « une vision isométrique et pas de face »)*. L'axe qui sort du mur se projette **en biais**, jamais sur la verticale de l'écran : dans une vue isométrique aucune direction du sol ne se présente de face ni par la tranche, et c'est ce qui empêche la porte grande ouverte de disparaître en un trait de deux pixels. Corollaire heureux : le gond étant au jambage, le battant ouvert se range **hors de l'ouverture**, contre la maçonnerie — le passage reste libre sans qu'on ait à assouplir la garde. Le format du sprite d'une porte est élargi d'une marge sur les quatre côtés (symétrique, pour que l'ancre reste au centre) : un panneau qui pivote sort de sa bande.
  - **Cinq positions** *(demande d'Alexis)* — un échantillonnage d'une géométrie **continue** (`piecesDePorte(bit, ouverture)`), pas cinq dessins. Le dessin ne ment dans **aucune** position : à la première le passage est entièrement couvert (close, elle bouche), à la dernière entièrement libre, et il se dégage **strictement** à chaque pas — c'est cette dernière propriété qui prouve qu'il y a un mouvement et non cinq copies.
  - **UNE PORTE NE SE TRANCHE PAS — elle reste TOUJOURS VISIBLE** *(décision d'Alexis, 2026-07-30 : « contrairement aux murs, il faudrait que les portes soient toujours visibles » ; « idem pour un encadrement de porte sans porte »)*. La règle des pans réduit un côté de bâtiment à son empreinte au sol dès deux tuiles ; la porte du joueur et le seuil du bâti généré (`encadrement`) en sont **exclus** et gardent leur sprite debout, au milieu de la ligne d'empreintes. Ce que ça répare : on pousse une porte à portée de **bras** (1,5 tuile) et un pan tombe à **deux** — la porte qu'on regarde s'ouvrir était donc toujours rendue tranchée, et son battant ne pivotait qu'à plat. ⚠ **Ce que ça coûte, MESURÉ et non arbitré** (`smoke --scenario porte`, 2026-07-30) : l'avatar collé au nord d'une porte d'arête sud — la position qu'il FAUT occuper pour l'ouvrir de l'intérieur — est masqué à **100 % quand elle est close**, à **21 % quand elle est ouverte** (pixels pleins ; la porte se trie après lui). La promesse des pans (« on voit derrière un mur exactement quand il pourrait cacher quelqu'un », `render/pans.ts`) cède donc sur cette tuile-là. **L'exception est ACCEPTÉE** *(décision d'Alexis, 2026-07-30, le chiffre sous les yeux)* : une tuile contre tout un côté de bâtiment, et ce qu'on cesse de voir derrière sa propre porte, c'est soi-même. L'atténuation écartée — porte estompée tant qu'elle couvre l'avatar local — aurait réintroduit un comportement PAR TUILE qui suit le joueur, précisément ce que la règle des pans a écarté pour les murs. La mesure reste au scénario `porte` pour surveiller la dérive. Le linteau flottant qui avait motivé l'empreinte de seuil ne revient pas : ce qui reste debout n'est pas le linteau seul mais le **portique entier**, jambages compris.
  - **La règle s'écrit par une ABSENCE** : `snapshot-view` ne tranche que ce que `COUPE_DE` (dans `bati-art`) nomme, donc une famille absente de la table reste debout. Pas de second drapeau qui pourrait la contredire en silence — et un test affirme l'absence, pour qu'on ne la « répare » pas.
  - **L'animation est purement visuelle** : /sim retourne `open` au tick, donc pendant ~300 ms on peut franchir une porte dont le battant finit de s'écarter. L'inverse mettrait le rendu aux commandes de la simulation (invariant n°3).
  - **On anime sur le FAIT, on se CALE sur l'ÉTAT** : `door_toggled` lance le geste ; un simple écart entre l'état affiché et `open` (reconnexion, rechargement, fait perdu) **saute** sans le jouer — sinon un village entier s'ouvrirait en fanfare devant un joueur qui vient de charger. **Et le fait se lit AVANT que l'état ne se peigne** *(constat d'Alexis, 2026-07-30 : « l'animation saute depuis son état final »)* : les deux arrivent dans le même snapshot, donc ils doivent se rencontrer avant le premier coup de pinceau. Déplier les faits après avoir appliqué l'état montrait la porte à sa position d'**arrivée** pendant 50 ms, avant qu'elle ne rejoue sa course depuis le début. La propriété qui l'attrape est la **monotonie** du geste, pas le nombre de positions vues (il y en avait plus, pas moins).
  - **Le son dure exactement le geste** (une seule constante, `PORTE_ANIM_MS`, lue par le rendu ET par le routage audio) et suit la grammaire du fichier : une hauteur qui MONTE ouvre, une hauteur qui DESCEND ferme. `triangle` et non `noise` — le sens prime sur la matière, et le bruit blanc n'a pas de hauteur pour le porter.
  - **La porte se trie APRÈS le mur** (`TIE_SEUIL`) : une bande de mur déborde d'une demi-épaisseur chez ses voisins pour se recoudre, et à pieds égaux l'ordre tombait sur l'ordre de pose — la pierre mordait le bois. Même correctif que pour le seuil du bâti généré.
  - ⚠ **Migration non silencieuse, assumée** : `undefined` vaut CLOSE, donc les portes des parties sauvegardées se retrouvent fermées à la reprise. On les rouvre d'une touche ; l'inverse laisserait une base grande ouverte sans que le joueur l'ait décidé, et ça ne se répare pas après un raid.
---

## 7. Déterminisme & garde-fous

- Reconnaissance d'amas (R9), détection d'enceinte (R14), invariant de navigabilité (R7) : **flood-fills purs, à ordre de parcours fixe** — déterministes, compatibles avec l'invariant de rejeu (au bit près entre moteurs).
- La construction **ajoute des entités** (structures, composants). Les **isoler du flux RNG existant** pour ne pas décaler les tests seedés sans rapport (cf. mémoire `rng-fragile-au-décompte-entités`).

---

## 8. Critères d'acceptation

*Sim-first, testables en headless ; les points client sont vérifiés au smoke test.*

- **A1 — Fondation** : `place_campfire` + `found_village` refuse sur nœud/eau, si un POI-spécifique tombe dans le carré `R_max`, ou à < 2·R_max d'un autre village ; accepte sinon. Émet `village_founded`.
- **A2 — Zone ×palier** : le carré vaut `R(tier)` ; monter le Feu d'un palier agrandit le carré et débloque des types de composants ; un composant hors carré est refusé.
- **A3 — Émergence & palier** : poser `{enclume}` fait une Forge N1 ; ajouter un `four` **à ≤ AMAS_RADIUS** la fait passer N2 (`structure_built`/`function_changed`) ; démolir le four la refait N1.
- **A4 — Pas d'unicité** : deux amas forge distincts sont acceptés (deux forges).
- **A5 — Enceinte** : un amas clos par des murs **et** entièrement toité accorde le bonus de sa fonction ; retirer un `roof` (trou dans la couverture) retire le bonus **sans** casser la fonction.
- **A6 — Navigabilité (R7)** : un mur/composant dont la pose déconnecterait le Feu est refusé. En **murs minces** aussi : ceindre son Feu de ses quatre arêtes voit la **dernière** refusée.
- **A11 — La porte s'ouvre et se ferme (R26)** : une porte NEUVE est close et arrête **son propre bâtisseur** ; la bascule l'ouvre et il passe ; OUVERTE, l'étranger passe aussi ; refermée, elle l'arrête et il ne peut pas la pousser (`cette porte n'est pas à vous`) ; l'INVITÉ l'ouvre, le BANNI ne peut plus. Hors portée de bras : refus. `open` DISPARAÎT à la refermeture (`undefined` est déjà « close »). L'ENCEINTE tient dans les deux états. Les PNJ du village franchissent une porte close, pas celle d'un rival, et n'en changent pas l'état. Rejeu au bit près.
- **A10 — Pose sur arête (R25)** : le coin d'une pièce accepte **deux** murs (deux structures) ; la même arête visée depuis la tuile d'en face est refusée (`edge_taken`) ; un composant/coffre/feu de camp se pose sur une tuile qui porte déjà une arête ; un nœud n'interdit plus l'arête mais interdit toujours la pose pleine tuile ; sol/toit refusent une arête (`no_edge`) et deux bits d'un coup sont refusés. Une bête qui chasse **frappe** le mur d'arête qui barre son franchissement, qu'il soit déclaré chez elle ou chez son voisin. Rejeu au bit près, arêtes comprises (`wall-edges-joueur.test.ts`).
- **Client (smoke `arete`)** : `A`/`E` font tourner le fantôme sur les quatre arêtes **dans les deux sens** ; le fantôme porte l'art d'arête (`st-wall-e<bit>`) et l'ancrage d'une barrière ; le CLIC pose sur la tuile et l'arête que le fantôme montrait ; une pièce de 3×6 avec son sol se bâtit segment par segment, **ses quatre coins portent 2 murs**, sa porte prend `st-door-e<bit>` ; de son fond, **tout le pourtour est tranché, façade sud comprise** (règle du DEDANS) — **portes et seuils exceptés, qui restent debout** ; et la PAIRE qui tranche la porte — **on la franchit, on ne franchit pas le mur d'à côté**, avec un passage dont l'opacité mesurée est très inférieure à celle d'un mur.
- **Client (smoke `porte`)** : au contact, la porte lit `st-door-e<bit>-f<n>` **DEBOUT pendant que le mur témoin du même pan lit `st-wall-coupe-e<bit>`** (la paire prouve que le pan est bien tombé) ; le battant part de sa position d'avant l'appui et sa course est **monotone** ; le recouvrement de l'avatar par la porte est relevé à chaque passage. **Client (smoke `ferme-dedans`)** : dans la salle, des murs tranchés **et aucun seuil tranché**.
- **A24 — L'eau ne porte que le sol (R4)** : sur le gué (`shallow_water`), **chaque** type de structure est refusé sauf `floor` — la garde balaie l'union `StructureType` ENTIÈRE par une table `Record<StructureType, boolean>`, donc ajouter une pièce sans décider si elle tient sur l'eau ne compile pas. Le feu de camp, le mur/porte/toit au marteau, les composants et le coffre sont refusés (`terrain inconstructible` / `unbuildable`) ; le `floor` passe, et sa pose réelle suit son verdict. Terre ferme **et marais** portent tout ; eau profonde ne porte rien, `floor` compris.
- **A7 — Upkeep** : Feu approvisionné → les murs ne se dégradent pas ; Feu à sec → dégradation ; le stock calibré tient ~3-4 jours ; les composants ne se dégradent jamais.
- **A8 — Instantané** : `build` débite les matériaux et pose la structure au tick suivant (aucun état de chantier).
- **A9 — Replay au bit près** : seed + carte + inputs (mouvements **et** poses/démolitions, upkeep inclus) ⇒ même état et mêmes événements. Détections déterministes (§7).
- **Client (smoke)** : marteau → menu de pose distinct du craft ; ranger le marteau efface les fantômes structurels ; fantôme prédictif « → Forge N2 » ; toit qui fond à l'entrée ; clic-par-case.

---

## 9. Ajouts à `balance.ts` (ordres de grandeur, à calibrer)

- **Le carré** : `FIRE_RADIUS_BY_TIER: [R1, R2, R3]` (remplace `FIRE_BUILD_RADIUS` fixe), `FIRE_MIN_DISTANCE = 2 * R_max` (Chebyshev). `AMAS_RADIUS` (proximité d'un amas).
- **Barrières** : coûts + `STRUCTURE_HP` pour `wall`/`door`/`floor`/`roof`/`trap` (murs montables en matériau : bois → pierre de taille, à la Rust / murs maçonnés du GDD).
- **Composants** : `COMPONENTS: Record<ComponentType, { cost: ItemBag, unlockTier }>` — les composants du catalogue (§4bis) ; coûts à calibrer.
- **Fonctions** : `FUNCTIONS: Record<FunctionId, { recipeByTier, enclosureBonus }>` — recettes `contenu → palier` et bonus d'enceinte, **tranchés au §4bis** ; magnitudes à calibrer.
- **Upkeep** : `FIRE_UPKEEP_RATE` (×acte), capacité de stock, `DECAY_PER_CYCLE` quand à sec (calé « survit 3-4 jours »), `REPAIR_COST_FRACTION`.
- **Paliers du Feu** : `FIRE_TIERS: [{ radius, componentsUnlocked, upgradeCost }, …]`.

---

## 10. Plan d'implémentation — priorité (décidée par Alexis, 2026-07-18)

**D'abord le marteau, puis Forge → Atelier → Grenier → Ferme. Le reste après.**

1. **Le marteau & la pose** (le socle) : `Structure` étendue (barrières + composants), carré ×palier + fondation (R1-R2), invariant de navigabilité (R7), pose **instantanée** (R15), barrières `wall`/`door`/`floor`/`roof` avec **paliers de matériau**. Client : le **menu du marteau** séparé du craft (R20), fantôme lié au tenu (R21), clic-par-case (R23), fade des toits (R24). Tests A1-A2, A6, A8 + smoke marteau.
2. **La Forge** : composants enclume / four / four d'acier, **reconnaissance d'amas** (R9) + palier par contenu (R10), pas d'unicité (R11), bonus d'enceinte **durabilité** (R13) + détection clos+toité (R14), fantôme prédictif « → Forge N2 » (R22). Tests A3-A5.
3. **L'Atelier** : établi / méca / lourd, bonus **vitesse** (réutilise la reconnaissance de 2).
4. **Le Grenier** : silo / cave **conteneur** anti-pourriture (branché sur `SPOIL_CYCLES`), bonus **conservation renforcée**.
5. **La Ferme** : parcelle / serre / terroir ; pas de bonus d'enceinte.

**Plus tard** (hors de ce premier jet) : les fonctions **Infirmerie, Fumoir, Dortoir** ; l'**upkeep & entretien** (R16-R17, tests A7 + volet upkeep de A9) ; le **comportement passif** (R12) ; le raffinement de l'enceinte ; tout le §11.

Chaque tranche verte (`check`/`test`/`lint` + smoke) avant la suivante.

---

## 11. Hors périmètre / dette (et où ça revient)

- **Catalogue : tranché** (§4bis). L'**implémentation** est priorisée (§10) : le socle **marteau**, puis **Forge → Atelier → Grenier → Ferme** ; les fonctions restantes (**Infirmerie, Fumoir, Dortoir**), l'**upkeep** (R16-R17) et le **comportement passif** (R12) viennent après.
- **PNJ bâtisseurs** + **renseignement « en construction »** : l'instantané (R15) les supprime ; ils exigeraient un chantier léger (dette).
- **Auras passives** (vision) : attendent un système de fog (R12).
- **Ouvrages de terrain hors-zone** (guet, pont, piège, cache), **empreintes multi-tuiles**, **bonus de terrain doux** : différés.
- **Cycle de vie complet** (mort → ruine pillable → refondable) : amorcé par l'upkeep (R16), complété en Phase Vallée (Va2).
- **Raid/siège** des enceintes (fenêtres de vulnérabilité, garnison offline, anti-labyrinthe) : `specs/raid.md`, Va3. Cette spec pose les **cibles** (composants/fonctions à adresse physique), pas les règles d'assaut.
