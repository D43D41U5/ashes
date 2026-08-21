# Audit UX/UI — 2026-08-20 · ANNEXE : les 282 constats

> Annexe de `docs/audit-ux-2026-08-20.md`. Tous les constats retenus, par dimension, gravité décroissante.
> Les 22 constats **réfutés, doublons ou déjà corrigés** sont en fin de document — ils comptent aussi :
> savoir ce qui a été écarté, et pourquoi, évite de le redécouvrir.
>
> Légende — **statut** : `NOUVEAU` (rien dans le corpus) · `CONNU_OUVERT` (le dépôt le nomme déjà,
> référence donnée) · `(requalifié)` (un réfuteur a corrigé la gravité, la nature ou le titre) ·
> `(non réfuté)` (constat mineur de capture, non passé au sceptique — à traiter comme SUSPECTÉ+).


---

## D1 — Transmission — les verbes du /sim qui n'atteignent pas la main  *(10 constats)*

### D1-4 · L'arc arrive en main et le seul conseil d'arme du jeu enseigne le geste de la hache : « MAINTENEZ le clic » — or le clic gauche est inerte avec un arc

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Survivant de la fusion D1-4 ≡ D3-5 (même défaut, deux dimensions).

**Preuve** — `packages/client/src/scenes/ui/onboarding.ts:58` `weapon: 'MAINTENEZ le clic : un coup lourd s'arme. ESPACE : parez de face.'`, déclenché en `:73` sur `hasWeapon` = `WorldScene.ts:2235` `this.myWeapon !== 'unarmed'` = `weaponKind` (`combat.ts:89-94`), qui rend `bow`/`crude_bow` (`balance.ts:1628`, `:1670`). Avec un arc, le clic gauche rend `null` (`aim.ts:518`) ; le vrai geste est le bouton 2 (`input-bindings.ts:719-725`). `grep -rniE "clic droit|bouton droit" packages/client/src` → 31 hits, TOUS commentaires ou Atelier (hors jeu) : zéro chaîne vue par le joueur.

**Ce que le joueur vit** — Il forge son arc, un bandeau lui dit de maintenir le clic. Il maintient sur un loup : rien ne part, rien ne s'arme, aucun son. Le geste réel n'est écrit sur aucun écran du jeu.

**Direction de correction** — Faire dépendre le conseil de l'arme tenue (`isRangedWeapon` existe, pure) et écrire la grammaire de l'arc. Réserve honnête : le conseil est un one-shot dans l'ordre d'urgence — il ne ment que si l'arc est la première arme jamais tenue ; mais aucune autre surface ne rattrape (voir D3-R3).

*`packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D1-1 · L'accès d'un conteneur posé par le joueur est figé à la pose — différé DOCUMENTÉ ; ce qui manque est le crédit de chaleur d'un dépôt étranger

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/gate1-finition.md:103 (« `set_access` | Non | **Différé/gouvernance** — l'accès est fixé par défaut à la pose ») · docs/audit-2026-08-20-annexe.md, duplication, `MORT-06` (« set_access, invite, banish : trois actions de /sim que seuls les tests construisent », `village.ts:331`) · packages/client/src/scenes/world/keymap.ts:126-127

**Preuve** — `grep -rn "type: ['\"]set_access['\"]" packages/client/src --include=*.ts | grep -v '\.test\.ts' | wc -l` → 0. Verbe vivant côté sim (`packages/sim/src/village.ts:1378` `case 'set_access':`), validé serveur (`packages/server/src/validate.ts:241`), défaut figé au registre (`packages/sim/src/pieces.ts:309` coffre `acces:'private'`, `:404` étagère). Le dépôt reste OUVERT à tous (`packages/sim/src/inventory-actions.ts:243` ne garde que le retrait) : seule la chaleur manque (`village.ts:667` `s.access !== 'village'`), et uniquement pour un dépôt ÉTRANGER (`village.ts:671`) — cas LAN, inexistant en Veillée.

**Ce que le joueur vit** — Il pose son coffre, cherche comment l'ouvrir aux siens : ni cadenas, ni ligne « accès », ni clic droit. Il ne saura jamais qu'un niveau d'accès existe. En LAN, déposer chez un voisin ne crédite aucune chaleur.

**Direction de correction** — Ne pas revendiquer : CITER gate1-finition.md:103. La seule question neuve pour Alexis est de rouvrir ou non le différé, sachant que le coffre est devenu posable depuis que la ligne a été écrite.

*`packages/sim/src/village.ts` · `packages/sim/src/pieces.ts` · `docs/gate1-finition.md`*

### D1-3 · L'onglet Métiers enseigne « presse E » pour cueillir alors que la touche est F — la troisième surface, celle que la décision de découvrabilité n'a pas couverte

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Adjacents, non couvrants : docs/audit-2026-08-20-annexe.md `V-10` (« recolte-maitrise énonce la cueillette à la touche E ; la touche est F ») ne vise QUE la spec ; docs/decisions.md:512 déclare la découvrabilité traitée par « le menu pause + l'onboarding » — deux surfaces sur trois. `skill-guide.ts` (créé le 2026-07-25) n'est nommé nulle part.

**Preuve** — `packages/client/src/scenes/ui/skill-guide.ts:149` `gesture: 'Vise le buisson et presse E : …'`, rendu à l'écran par `packages/client/src/scenes/ui/hud-character.ts:201` `<div class="hch-met-gest">${guide.gesture}</div>`. La touche : `packages/client/src/scenes/world/keymap.ts:75` `forage: ['F']` ; `E` est `rotateRight` (`keymap.ts:95`) et n'émet aucune action (`input-bindings.ts:291-299`). 23 jours de vie fausse (le texte, écrit le 2026-07-25, précède la migration du 2026-07-28).

**Ce que le joueur vit** — Il lit sa fiche Cueilleur, presse E sur un buisson : rien, pas même un refus. Il croit la cueillette cassée. Deux autres surfaces disent F, dont une dérivée en direct — il ne les a pas ouvertes.

**Direction de correction** — Dériver le libellé de `libelleTouches(keymapEffectif().forage)`, comme `pause-menu.ts:33`. Et barrer l'affirmation de decisions.md:512 qui parle encore de E.

*`packages/client/src/scenes/ui/skill-guide.ts` · `packages/client/src/scenes/world/keymap.ts`*

### D1-5 · La table du clic du menu pause enseigne six gestes sur les dix-sept branches du résolveur — et sa ligne « se panser » est périmée depuis qu'on panse autrui

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Survivant de la fusion D1-5 ≡ D4-6. docs/decisions.md:480 et gate1-finition.md:59 déclarent la règle du clic « enfin écrite » — c'est ce point-là que le code a débordé.

**Preuve** — `packages/client/src/scenes/ui/pause-menu.ts:41-48`, `CLICKS` = 6 lignes. `clickToAction` (`aim.ts:388-540`) porte 17 branches de retour pour 14 types d'action : non enseignés — semer (`:507`), récolter une parcelle (`:532`), fouiller un cadavre (`:528`), poser un feu/composant (`:401`,`:408`), bâtir/améliorer/démolir (`:397`-`:458`), panser AUTRUI (`:484`), l'arc (`:518`). Et `pause-menu.ts:45` dit encore « se panser » alors que `aim.ts:481-484` panse un tiers depuis le 2026-07-28. Contrainte à respecter, écrite : `pause-menu.ts:39-40` (colonne droite ≤ 34 signes).

**Ce que le joueur vit** — Il ouvre ESC pour comprendre, on lui rappelle six choses qu'il savait. Rien sur les graines, le cadavre, le voisin qui saigne. (Nuance : la table LES TOUCHES du même écran donne « Cueillir, interagir — F », et TAB ouvre le cadavre le plus proche — il n'est pas sans recours.)

**Direction de correction** — DEUX NATURES À SCINDER. ① technique, sans arbitrage : « se panser » est un libellé faux, à corriger. ② design, à Alexis : COMBIEN le jeu enseigne est une conséquence de jeu, et la table est bornée en largeur par sa propre règle typographique.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/world/aim.ts`*

### D1-6 · Les conseils d'onboarding écrivent les touches en dur : le joueur qui rebinde reçoit des instructions fausses

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Survivant de la fusion D1-6 ≡ D3-R4.

**Preuve** — `onboarding.ts:46` `'F : cueillir baies & fibre. TAB : votre sac…'` et `:58` `'… ESPACE : parez de face.'` — littéraux. Le rebinding est effectif en jeu : `input-bindings.ts:140` `const TOUCHES = keymapEffectif()` puis `:690` `onDownAlways(TOUCHES.forage, …)` ; `forage` et `block` sont rebindables (`keymap-perso.ts:28-46`), l'écran des réglages écrit dedans (`menu-dom.ts:500`). Le menu pause, lui, DÉRIVE (`pause-menu.ts:33`) : deux écrans, deux langues.

**Ce que le joueur vit** — Il remappe la cueillette, et le premier bandeau du jeu lui dit « F ». Il presse F : rien.

**Direction de correction** — Interpoler `libelleTouches(keymapEffectif()[action])` dans les textes d'onboarding — `nextOnboardingHint` est pure et testée, elle peut recevoir les libellés.

*`packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/world/keymap-perso.ts`*

### R-M1 · Viser une cible HORS DE PORTÉE et presser F ouvre la porte d'à côté — le geste refusé retombe sur un autre verbe

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Adjacent : docs/decisions.md:704 acte que la porte se prend par PROXIMITÉ et non au curseur — c'est cette règle qui, combinée au repli, produit la collision.

**Preuve** — `input-bindings.ts:688-695` : la cible n'est consommée que si `cible.inRange` ; sinon le flux tombe sur `:701-702` `porteLaPlusProche()` → `toggle_door`, et `porteLaPlusProche` (`:458-474`) ignore le curseur. Or le résolveur rend délibérément une cible hors portée (`aim.ts:611-613` : « la cible existe, la touche ne peut juste pas l'atteindre »). Aucune action ne part, donc aucun `action_rejected`, donc aucun bandeau.

**Ce que le joueur vit** — Il vise un buisson trop loin, presse F, et la porte de sa cabane s'ouvre. En pleine nuit, avec une horde au mur, c'est une porte qui s'ouvre pendant qu'on essaie de ramasser.

**Direction de correction** — Une cible désignée-mais-hors-portée doit CONSOMMER la touche (le repli n'a de sens que si le curseur ne désigne rien), et le refus mériterait le canal qui existe déjà.

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/world/aim.ts`*

### D1-2 · Une voix routée pour un verbe différé (`member_banished`) — et le correctif proposé rendrait un test rouge

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/gate1-finition.md:102 (« `banish` / `invite` | Non | **Différé** — gouvernance MVP ») · annexe `MORT-06`

**Preuve** — `packages/client/src/audio/inventaire.ts:74` `member_banished: { voix: 'voix', … }`, routé en `audio/sound.ts:124` ; seul émetteur `packages/sim/src/village.ts:1417`, sous `case 'banish'`, que le client n'envoie jamais (0 occurrence).

**Ce que le joueur vit** — Rien : aucun membre ne peut être renvoyé. La bande-son porte une voix qui n'a jamais sonné.

**Direction de correction** — CORRECTIF DU RECENSEUR INAPPLICABLE — `inventaire.ts:15-17` impose que `voix`/`muet` décrive l'ÉTAT RÉEL du routage, et `audio/sound.test.ts:112` affirme `member_banished` comme son FROID attendu : le passer à `muet` rougirait ce test. Il n'y a rien à corriger dans l'inventaire ; il reste le différé de gouvernance, déjà écrit.

*`packages/client/src/audio/inventaire.ts` · `packages/sim/src/village.ts`*

### D1-7 · `attack` reste une porte ouverte du protocole que plus aucun client n'emprunte (`deposit`/`withdraw`, eux, sont couverts et documentés)

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Moitié DÉJÀ TRAITÉE : docs/gate1-finition.md:104 « `deposit`/`withdraw` | **Oui, via `transfer`** | Couvert ». La moitié `attack` n'est nommée nulle part.

**Preuve** — `attack` est construit (`aim.ts:523`, `:538`) et jamais transmis : `input-bindings.ts:749-756` le convertit en `attack_charge`. `deposit`/`withdraw` : 0 émission, remplacés par `transfer`, y compris l'effet d'alignement (`inventory-actions.ts:289` `creditForeignDeposit`). Les trois restent acceptées : `packages/server/src/validate.ts:239`, `:240`, `:254`.

**Ce que le joueur vit** — Rien aujourd'hui. En LAN, un client bricolé peut frapper sans passer par la charge (`combat.ts:261`), court-circuitant l'arbitrage bref/lourd que la sim tient seule.

**Direction de correction** — Décider si `attack` est un héritage à retirer du protocole (avec bump de `PROTOCOL_VERSION`, précédent v5) ou une surface gardée — et l'écrire à côté, comme `light_fire` le fait déjà.

*`packages/server/src/validate.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D1-8 · Quatre des huit leviers `debug_*` ne sont offerts par aucune surface DEV — et le panneau n'en offre que trois

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Sans rapport avec `CI-05` / P0bis (« le loquet de debug se persiste »), qui porte sur la persistance de `god`, pas sur la couverture des leviers.

**Preuve** — Panneau : `debug_god` (`debug-panel.ts:90`), `debug_set_hour` (`:105`), `debug_reveil` (`:111`) ; `debug_teleport` vient de l'overlay (`debug-overlay.ts:90`). Émis par personne : `debug_grant`, `debug_meteo`, `debug_set_season_day`, `debug_village_stage` — ils ne vivent que dans `tools/smoke.mjs:303/8608/3653/1250`. Toute la famille est inerte hors DEV (`worker/veillee.ts:133`).

**Ce que le joueur vit** — Rien : la coupure joueur est par construction. Le coût est pour Alexis en playtest — voir un blizzard ou sauter au jour 50 exige d'écrire un scénario de smoke.

**Direction de correction** — Si GATE 1 en a besoin, quatre boutons de plus sur le patron existant. Sinon ne rien faire : ce n'est pas une couture de joueur.

*`packages/client/src/scenes/world/debug-panel.ts` · `tools/smoke.mjs`*

### R-M3 · Balayage exhaustif de la classe « la copie ment sur le geste » : 3 écarts sur 11 chaînes, et la table des touches est exhaustive par construction

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus — et c'est ce constat qui BORNE D1-3, D1-4 et D1-6 : ils ne justifient pas un chantier « dériver tous les textes ».

**Preuve** — Espace fini balayé (`grep -rniE "presse|maintenez|cliquez|touche |appuyez" packages/client/src/scenes` + lecture des trois tables). Justes : `skill-guide.ts:114`, `:131`, `:165` ; `onboarding.ts:46/47/52/55` ; `pause-menu.ts:42/44/46/47`. Faux : `skill-guide.ts:149` (D1-3), `onboarding.ts:58` avec un arc (D1-4), `pause-menu.ts:43` avec un arc (D3-R3) ; périmé : `pause-menu.ts:45` (D1-5). Et `ActionJeu = keyof typeof KEYMAP` (`keymap-perso.ts:21`) : les 16 clés de `KEYMAP` ont chacune leur entrée dans `ACTIONS` — aucune touche livrée n'est absente de l'écran des réglages.

**Ce que le joueur vit** — Rien : résultat de couverture, pas défaut.

**Direction de correction** — Aucun. La classe est refermée ; si on veut la garder fermée, c'est un test sur des tables pures.

*`packages/client/src/scenes/ui/skill-guide.ts` · `packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

---

## D2 — Retour — les faits de jeu qui ne se voient pas  *(14 constats)*

### D2-1 · Le filon que la Brume découvre n'apparaît jamais à l'écran

`MAJEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-complet-2026-08-20.md § « Décisions qui reviennent à Alexis » point 4 (« Le filon de la Brume n'apparaît jamais chez le joueur ») · annexe `BRUME-2` (`snapshot-view.ts:1665`, majeur) · docs/specs/brume.md:49, qui écrit déjà les deux correctifs · P4 (« /sim décrit au présent un comportement client qui n'existe pas »).

**Preuve** — `packages/sim/src/brume.ts:203-204` pousse un nœud d'id `FILON_ID_BASE + day` (`:46` = 1 000 000). Le client n'indexe qu'une fois (`WorldScene.ts:984` `setNodes(msg.nodes)`) et `snapshot-view.ts:1735-1738` jette tout delta d'id inconnu. `events.ts:190` affirme pourtant « Le client matérialise le filon depuis `filon_decouvert` ».

**Ce que le joueur vit** — Il entend le filon, le lit au journal, traverse la vallée, paie le froid et les Cendreux — et sur place il n'y a rien à viser.

**Direction de correction** — CORRECTIF DU RECENSEUR À AMENDER : sa branche (a) est inapplicable — `packages/sim/src/node-shadow.ts:120-124` n'attache `tx`/`ty` qu'au delta de stock ZÉRO, donc le delta d'un filon neuf ne porte aucune position. Seul le branchement de `filon_decouvert`/`filon_retire` sur `SnapshotView` marche, et c'est ce que la spec exige déjà.

*`packages/client/src/scenes/world/snapshot-view.ts` · `packages/sim/src/brume.ts` · `docs/specs/brume.md`*

### D2-2 · La nappe de Brume gèle le joueur sans qu'aucun pixel ne dise d'où vient le froid ni où la zone s'arrête

`MAJEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — annexe `BRUME-1` (« La nappe létale est INVISIBLE », `protocol.ts:239`) · `ARCH-03` · `FX-04` · `GEL-1` · audit-complet § Décisions point 5 · docs/specs/brume.md:49 (« La nappe doit se voir DE LOIN ») · docs/decisions.md:759 ①.

**Preuve** — `grep brume packages/sim/src/protocol.ts` → 0 : `SnapshotMessage` (`:196-240`) ne porte pas la nappe. Le client l'écrit lui-même : `packages/client/src/scenes/world/etat-gel.ts:41` « ③ `brume` — **ABSENT, ET C'EST UN TROU QU'IL FAUT DIRE** », et pose `brume: null` (`:97`, `:119`). Le malus, lui, s'applique (`temperature.ts:123`). Aucun consommateur visuel de `brume_levee`/`brume_retiree` (seul `audio/sound.ts:172`).

**Ce que le joueur vit** — Sa température chute deux fois plus vite à un endroit qu'il ne peut pas voir, puis « VOUS GELEZ ». Le paysage est le même qu'à dix tuiles. Il ne sait pas dans quelle direction sortir.

**Direction de correction** — Champ additif `brume` au `SnapshotMessage` (etat-gel.ts:50 note qu'il n'incrémenterait pas `PROTOCOL_VERSION`) puis peindre — `mist-layer.ts` sait déjà faire un champ + un front. Toucher `/sim` : décision d'Alexis, comme l'écrit `etat-gel.ts:52`.

*`packages/sim/src/protocol.ts` · `packages/client/src/scenes/world/etat-gel.ts`*

### D2-3 · Huit émetteurs se partagent UN SEUL créneau d'alerte : le second message efface le premier avant qu'il ne s'affiche

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Contexte : docs/decisions.md:461 acte la SÉPARATION des registres (canal conseil vs alerte) — elle a été faite, mais les deux canaux sont restés des VALEURS. À croiser avec R2-M1 (même défaut, autre canal) et D3-1 (même canal, masqué).

**Preuve** — `packages/client/src/scenes/world/hud-bridge.ts:408-410` : `publishError` pose une VALEUR — à comparer à `publishPickup` (`:336-344`), dont le commentaire dit « Une FILE, pas une valeur : … aucune ne doit être écrasée ». Huit appelants : `WorldScene.ts:2138` (4 alertes vitales), `:2296`, `:2390`, `:2400`, `:2407`, `:2438`, `:2477`, `:2483` — les sept derniers dans la MÊME boucle `for (const event of msg.events)`. Rendu : `UIScene.ts:638-647`, un `errorText`, 2 500 ms. Le répit par clé de `WorldScene.ts:2134-2139` ne protège que la répétition d'une même alerte, pas la collision entre émetteurs.

**Ce que le joueur vit** — Au crépuscule, `night_started` et `wolf_howl` tombent dans le même snapshot : il ne lit qu'une des deux phrases, sans savoir que l'autre a existé. Un avertissement de mort disparaît sans être vu.

**Direction de correction** — File, sur le patron déjà écrit et commenté de `publishPickup`/`drainPickups`, avec une priorité danger > refus. Le dépôt a déjà tranché ce problème une fois.

*`packages/client/src/scenes/world/hud-bridge.ts` · `packages/client/src/scenes/UIScene.ts`*

### D2-4 · Le blizzard s'annonce dans un journal qu'il faut penser à ouvrir, sans voix ni bandeau — alors que son patron, la Brume, a une voix

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus (les items « blizzard » des mineurs portent sur la météo perdue à la reprise, pas sur le canal de l'annonce).

**Preuve** — `packages/sim/src/chronicle.ts:143-144` est le canal unique ; `chronicle.ts:139-141` invoque explicitement le « patron Brume » — or `brume_annonce` A une voix (`inventaire.ts:94`) et `blizzard_annonce` est `muet` (`inventaire.ts:102`) sans aucun consommateur dans `WorldScene`. Le journal est à la demande et sans badge d'arrivée (`UIScene.ts:826-834`). Le précédent existe à trente lignes de là : `cendre-telegraph.ts:25` → `WorldScene.ts:2438` `publishError`.

**Ce que le joueur vit** — La veille, rien à l'écran, rien à l'oreille. Le lendemain le blizzard traverse la vallée, ses cultures meurent, son bois est dehors. Le seul préavis était une ligne dans un panneau qu'il n'avait aucune raison d'ouvrir.

**Direction de correction** — Router `blizzard_annonce` sur le canal du télégraphe de la Cendre (mécanisme, ton et précédence déjà posés à `WorldScene.ts:2432-2438`). Conséquence de jeu (« ce qu'on voit venir », GDD §9bis) : Alexis tranche.

*`packages/sim/src/chronicle.ts` · `packages/client/src/scenes/WorldScene.ts`*

### D2-5 · Le Feu du village ne montre JAMAIS qu'il a faim — et la raison écrite du silence sonore est fausse

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus (l'item `SOC-10` porte sur la lueur qui suit |chaleur|, pas sur le combustible). Contexte : gate1-finition.md:118 laisse la CALIBRATION de `FIRE_UPKEEP` à Alexis, jamais sa lisibilité.

**Preuve** — `packages/sim/src/fire.ts:34-36` : `if (s.villageId !== 0) return 'lit'` — un Feu de village à 100 % et un Feu à sec se peignent à l'identique (`fire-fx.ts:90`, `fire-ground-glow.ts:120` lisent `fireStateAt`). `village.ts:775-780` émet `fire_starved` et fait céder murs et portes ; aucun consommateur client (seul `audio/sound.ts:97`). Balayage exhaustif des lectures client de `village.fuel` : `hud-bridge.ts:309/319` (panneau, ouvert seulement) et `WorldScene.ts:1997` (conseil one-shot). Et `inventaire.ts:191` justifie le silence de `fire_fed` par « la flamme qui monte le dit déjà à l'écran » — faux même sur un feu libre, `fireStateAt` étant ternaire.

**Ce que le joueur vit** — Il part deux jours, revient : le Feu brûle pareil. Puis sa palissade a des trous et ses portes des brèches, sans qu'il puisse relier la cause à l'effet. L'évier permanent du jeu est invisible.

**Direction de correction** — Faire dépendre l'état peint du `village.fuel` (déjà dans le snapshot : un correctif client-seul existe) et brancher `fire_starved`. Rendre visible la faillite de l'upkeep change le télégraphiage de l'endgame : Alexis tranche.

*`packages/sim/src/fire.ts` · `packages/client/src/scenes/world/fire-fx.ts` · `packages/client/src/audio/inventaire.ts`*

### D2-6 · La recette qui se découvre n'ouvre aucun « petit événement » — le modèle a pourtant été choisi POUR ça

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. La promesse est dans le code : `packages/sim/src/decouverte.ts:4-8` (décision d'Alexis, D2, 2026-08-01).

**Preuve** — `decouverte.ts:5-8` : « chaque ressource neuve ouvre un petit événement au lieu d'ajouter une ligne grise à un mur de deux cents » ; `:58-60` « la chronique et un bandeau peuvent s'en nourrir ». Or `grep -rn recipe_revealed packages/client/src` hors tests → ZÉRO, pas même dans `audio/sound.ts` ; absent de `CHRONICLE_EVENT_TYPES` (`chronicle.ts:46-66`) ; aucun badge dans `craft-panel.ts` ni `hud-core.ts`. Seul effet : une ligne de plus dans un panneau à ouvrir (`craft-panel.ts:120-127`).

**Ce que le joueur vit** — Il ramasse son premier lingot ; trois recettes s'ouvrent en silence. Il paie le coût du modèle (il ne voit pas ce qui existe) sans en toucher le bénéfice.

**Direction de correction** — Un bandeau en UNE salve (« 3 nouvelles recettes »), sur le canal des toasts en file — jamais sur le créneau d'alerte unique (voir D2-3).

*`packages/sim/src/decouverte.ts` · `packages/client/src/scenes/ui/craft-panel.ts`*

### D2-7 · La mise à mort claque sur le TUEUR, pas sur la bête — et le fait ne porte pas de quoi faire autrement

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — `packages/client/src/scenes/WorldScene.ts:2381-2385` : le commentaire dit « deux étincelles là où la bête est tombée », le code fait `const tueur = this.view.others.get(event.byEntityId)?.sprite ?? this.playerSprite`. La charge utile de `monster_slain` (`packages/sim/src/events.ts:137`) est `{ type, tick, monsterType, byEntityId, clean }` — aucun `x`, aucun `y`, aucun id de victime.

**Ce que le joueur vit** — À l'arc, la confirmation « elle est morte » s'allume sur son propre torse au lieu du loup à douze tuiles. En mêlée le défaut ne se voit pas — ce qui explique sa survie.

**Direction de correction** — Faire porter au fait le lieu de la mort (`x`,`y`, comme `prey_escaped` et `cendreux_risen`). Amendement au récit du recenseur : « sans lui le loup disparaît » est trop fort — un corps est bien posé (`combat.ts:923`, `:934`, peint par `syncCorpses`).

*`packages/client/src/scenes/WorldScene.ts` · `packages/sim/src/events.ts`*

### D2-11 · Dix lieux sur quinze ne laissent aucune trace NOMMÉE quand on les foule — et deux commentaires disent « quatre » là où il y en a cinq

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — `packages/sim/src/poi-discovery.ts:32-64` : cinq `kind` en `devise:'recit'` (sanctuaire :55, arbre :56, erratique :61, cascade :62, cercle_pierres :64) ; `chronicle.ts:177` filtre dessus. Le son, lui, sonne pour les QUINZE (`audio/sound.ts:275`). Commentaires périmés : `chronicle.ts:174` et `poi-discovery.ts:199` disent « quatre ». CORRECTION du recenseur : les dix autres ne sont pas muets — `poi_discovered` lève le brouillard (`WorldScene.ts:2317-2328`) ou pose une pastille (`UIScene.ts:619-620`) ; ce qui manque est la trace NOMMÉE, le `name` que le fait porte n'étant jamais montré.

**Ce que le joueur vit** — Il atteint un belvédère, une grotte, une source chaude : un son de « première fois » retentit, du terrain s'ouvre, et le lieu n'est nommé nulle part. Il ne retrouve aucune trace de ce qu'il a atteint.

**Direction de correction** — À trancher : fouler un lieu doit-il le NOMMER (bandeau, ou ligne `intime`), ou seuls les cinq lieux de récit entrent-ils à la mémoire ? 5 sur 15 côté écrit, 15 sur 15 côté son. Les deux « quatre » se corrigent sans arbitrage.

*`packages/sim/src/chronicle.ts` · `packages/sim/src/poi-discovery.ts`*

### D2-12 · Le gel tue le potager et le seul retour est un carré qui redevient brun — la moitié CHRONIQUE est connue, la moitié ÉCRAN ne l'est pas

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Moitié chronique DÉJÀ TRIPLEMENT CONNUE : annexe `crop-frozen-hors-chronique` (societe), `crop-frozen-emis-sans-consommateur-de-chronique` (environnement), `SOC-7`. La moitié ÉCRAN (la parcelle indiscernable d'une parcelle jamais semée) n'est nommée nulle part.

**Preuve** — `packages/sim/src/agriculture.ts:74-76` : `delete s.plantedAt` puis `emitEvent(… 'crop_frozen' …)`. Rendu : `snapshot-view.ts:1445-1451` `const stage = cropStage(s, this.tick) ; if (stage < 0) sprite.clearTint()` — teinte perdue. Le marqueur de gel bleu pâle livré le 2026-08-20 (`decisions.md:763`) ne couvre PAS le potager : `snapshot-view.ts:1902` ne le pose que sur les NŒUDS `gelif`. Le fait ne porte ni `x` ni `y`, seulement `structureId`.

**Ce que le joueur vit** — Ses parcelles sont brunes au matin, exactement comme s'il ne les avait jamais semées. Il resème, la nuit reprend tout, et la leçon du système ne s'enseigne jamais.

**Direction de correction** — À trancher : givre visible sur la parcelle et/ou entrée de chronique de Grand Froid — que `events.ts:163-165` promet déjà. Le contraste avec `blizzard_annonce`, qui prévient la veille, penche pour l'annonce.

*`packages/sim/src/agriculture.ts` · `packages/client/src/scenes/world/snapshot-view.ts`*

### D2-13 · Une horde de moins de huit goules se forme sans qu'aucun canal ne le dise

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Précédent d'arbitrage en HAUT de l'échelle : `chronicle.ts:110-118` (décision d'Alexis, 2026-08-02, sur le mot « méga-horde »).

**Preuve** — `packages/sim/src/balance.ts:3187` `HORDE_SIZE: [4, 8, 12]` (par acte) et `:3551` `MEGA_HORDE_SIZE: 16` ; `chronicle.ts:119-120` `else if (e.size >= WORLD_EVENTS.HORDE_SIZE[1]!)` — une horde d'acte I (taille 4) est sous le plancher, zéro ligne par construction. Aucun consommateur visuel de `horde_spawned` (seul `audio/sound.ts:155`) ; `alarm_raised` est gardé sur `event.villageId === this.myVillageId` (`WorldScene.ts:2391`).

**Ce que le joueur vit** — Une horde marche sur un village voisin. Il entend une menace sans savoir d'où ni sur qui, ouvre le journal : rien. Il l'apprendra en tombant sur un village de moins.

**Direction de correction** — À trancher : plancher du récit. Une petite horde mérite-t-elle une trace, ou le silence des petites menaces est-il le prix pour que « une grande horde » veuille dire quelque chose ?

*`packages/sim/src/chronicle.ts` · `packages/client/src/scenes/WorldScene.ts`*

### D2-14 · Chaque bête abattue consomme une ligne du carnet de chronique, et les faits de saison sortent par le haut

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus (l'item `chronicle-liste-jumelle-sans-garde` porte sur l'accord Set/switch, pas sur le plafond).

**Preuve** — MÉCANISME MESURÉ, VOLUME NON. `entity_died` est dans `CHRONICLE_EVENT_TYPES` sans condition (`chronicle.ts:61`) et est émis pour les monstres (`combat.ts:888-892` `wasMonster: monster !== undefined`) ; le tri n'a lieu qu'au FORMATAGE (`chronicle.ts:160-162`), donc APRÈS l'éviction : `worker/sim-worker.ts:160-161` avec `CHRONICLE_CAP = 400` (`:88`), `WorldScene.ts:2465-2469` avec `EVENT_LOG_CAP = 500` (`:259`). Combien de bêtes un joueur abat en 60 jours n'est pas mesuré — le banc n'a pas de joueur, donc ne chasse pas (31 faits en 8 cycles, 0 monstre).

**Ce que le joueur vit** — Si (et seulement si) il abat plus de 400 bêtes, sa chronique de fin perd ses premiers jours, chassés par des lapins qui ne s'y affichent même pas — alors que la stèle promet « le détail de ces soixante jours ».

**Direction de correction** — Instruire d'abord (compter les bêtes abattues sur une saison jouée). Si le plafond mord : filtrer `wasMonster` à l'ENTRÉE des deux accumulateurs plutôt qu'à la sortie du formateur.

*`packages/sim/src/chronicle.ts` · `packages/client/src/worker/sim-worker.ts`*

### R2-M1 · Le canal CONSEIL a exactement le même défaut que le canal ALERTE — et sa fenêtre est trois fois plus longue

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. À croiser avec D2-3 (même patron, autre site) — ce ne sont PAS des doublons : `publishError` et `publishHint` sont deux fonctions, deux afficheurs, deux fenêtres.

**Preuve** — `packages/client/src/scenes/world/hud-bridge.ts:415-417` : `publishHint` pose une VALEUR, et son commentaire (`:412-414`) revendique « le patron `publishError` mais un autre ton ». `UIScene.ts:651-664` : `HOLD = 6000` + `FADE = 3000`, neuf secondes pendant lesquelles un second conseil efface le premier. Trois émetteurs : `WorldScene.ts:701` (bascule du son, touche N), `:2245` (onboarding), `:2555-2559` (le mot du réveil après la mort).

**Ce que le joueur vit** — Il meurt, se réveille au Feu, le jeu lui explique l'épuisement croissant — et dans la même seconde l'onboarding enseigne un verbe, ou il coupe le son par réflexe. La phrase disparaît. C'est le canal d'APPRENTISSAGE : ce qui s'y perd ne sera jamais redit (`shownHints.add`).

**Direction de correction** — Le même que pour les toasts : une file drainée par UIScene. Aucun arbitrage.

*`packages/client/src/scenes/world/hud-bridge.ts` · `packages/client/src/scenes/UIScene.ts`*

### D2-10 · Le journal rend la chronique à plat et la stèle à trois poids — le rendu plat est une dette NOMMÉE dans le code

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. La dette est écrite à l'endroit même : `packages/sim/src/chronicle.ts:33` « Rendu plat « Jour N — texte » (journal simple, EN ATTENDANT LE RENDU À 3 POIDS) ».

**Preuve** — `chronicle.ts:8-14` acte les trois poids (décision d'Alexis, 2026-07-19). La stèle les honore (`season-veil.ts:217-229`, DOM, classe `sv-${e.weight}`). Le journal les écrase : `UIScene.ts:831-833` `chronicle.slice(-26).map(formatChronicleLine).join('\n')` dans un `Phaser.GameObjects.Text`.

**Ce que le joueur vit** — Soixante jours d'un pavé gris où « Quelqu'un est tombé. » pèse autant que « La méga-horde a déferlé » — puis, à la fin, une stèle magnifique montre la même donnée en trois registres. Celui qu'il a vu 200 fois est le pauvre.

**Direction de correction** — Faire lire au journal le même `ChronicleEntry[]` avec ses `weight`, en DOM, sur le patron de `season-veil.ts`.

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/season-veil.ts`*

### R2-M2 · L'INVENTAIRE DU SILENCE annonce trois nombres faux dans son propre en-tête : 66 faits, 34 voix, 27 silences — il en porte 77, 44 et 33

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Survivant de la fusion D2-15 ≡ R2-M2.

**Preuve** — Compté par programme sur le corps du `Record` : 77 entrées, 44 `voix`, 33 `muet` — cohérent avec les 77 membres de l'union crachés par le compilateur. L'en-tête dit `inventaire.ts:2` « les 66 faits de domaine » et `:19-20` « 34 faits ont une voix, 27 un silence DÉCIDÉ ». Ironie citable : `:12-13` se félicite que « Le compilateur tient la liste — le grep a déjà menti sur ce dépôt ». Le `Record<SimEvent['type'], Fait>` est exhaustif ; c'est la PROSE qui a dérivé.

**Ce que le joueur vit** — Rien — c'est le prochain lecteur qu'on trompe. Ce fichier est la référence du banc d'écoute et du test de routage ; ce recensement lui-même a repris « 66 » dans sa méthode.

**Direction de correction** — Dériver les trois nombres, ou les retirer.

*`packages/client/src/audio/inventaire.ts`*

---

## D3 — Refus muets  *(11 constats)*

### D3-1 · Le refus est bien crié — mais sur le canvas, sous l'écran DOM opaque qui vient de le provoquer

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus : ni gate1-finition.md (§ Bugs client corrigés, § Audit de transmission, P0-P4), ni decisions.md, ni les trois audits ne mentionnent un toast couvert. `UI-06` (deux modales simultanées) est un autre défaut.

**Preuve** — Le canal `error` n'a QU'UN lecteur : `grep -rn "'error'" packages/client/src` → écriture `hud-bridge.ts:409`, lecture `UIScene.ts:639` — un objet Phaser sur le canvas (`UIScene.ts:282`, `height - 110`). Par-dessus : `hud-character.ts:562` `.hch{position:absolute;inset:0;background:#14100c;…}` monté sur la planche `hud-dom.ts:65` `.hud-overlay{position:fixed;inset:0;z-index:40}` ; même cadrage 16:9 (canvas `main.ts:22-34` FIT/CENTER_BOTH, planche `hud-dom.ts:44` `k = min(innerW/1920, innerH/1080)`). C'est DE CET écran que partent `transfer`/`split_slot`/`move_slot` (`hud-character.ts:357`, `:386`), que `applyInventoryAction` refuse par 15 motifs. Le modal du feu fait pareil à 72 % (`fire-panel.ts:287`). ET LE SECOURS A ÉTÉ FERMÉ SUR LA FOI DE CE TOAST : `audio/inventaire.ts:147` `action_rejected: { voix: 'muet', … 'la sim refuse une action (déjà un toast)' }`.

**Ce que le joueur vit** — Il glisse une pile sur une case prise : le jeton revient, rien d'autre. Il recommence plus lentement, croit avoir mal visé. « Case occupée » a bien été écrit — derrière le panneau plein écran qu'il regarde.

**Direction de correction** — Un second lecteur du canal `error` en DOM, dans la planche, au-dessus des écrans — le patron existe (`hud-core.ts:398-400` garde les vitales par-dessus l'écran personnage). Un seul afficheur DOM referme le problème pour tous les écrans. RÉSERVE : la superposition est établie par construction (CSS + cadrage), pas au pixel — smoke interdit ce tour.

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/fire-panel.ts` · `packages/client/src/scenes/world/hud-bridge.ts`*

### D3-2 · « Fonder un Foyer ici » s'affiche jusqu'à 32 tuiles d'un Feu qui l'interdit — et le client ignore jusqu'à l'existence de cette distance

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Adjacent, même fonction : `SOC-2` (« pnj.md R9 « fonder attire 3 PNJ » est faux du chemin joueur », `village.ts:988`) — autre défaut.

**Preuve** — Reproduit par instrument indépendant (`node --import tsx`, import du VRAI `foundableFireAt`) : « FIRE_MIN_DISTANCE = 32 · feu libre posé à 6 tuiles du voisin, villageId 0 · foundableFireAt = 2 → bouton AFFICHÉ · found_village → refus : ["trop proche d'un autre Feu"] · villages = 1 ». Le prédicat client ne teste que trois choses (`hud-bridge.ts:106-121`) ; `grep -rn "FIRE_MIN_DISTANCE|poiSpecific" packages/client/src` → 0 hit de code. Refus sim : `village.ts:984` et `:987`. Le bouton n'est jamais grisé (`fire-panel.ts:271` ne grise que `kind === 'upgrade'`). Et `place_campfire` (`village.ts:922-968`) ne teste aucune distance : le chemin est légal.

**Ce que le joueur vit** — Il fabrique un feu de camp, le pose où il veut vivre, ouvre le modal : « Fonder un Foyer ici ». Il clique — éclair rouge, « trop proche d'un autre Feu » (et ce refus tombe sous le voile du modal, cf. D3-1). Rien ne lui a montré où passe la limite : 32 tuiles Chebyshev, un carré de 65 de côté, hors écran.

**Direction de correction** — (a) `foundableFireAt` doit consulter les mêmes gardes que la sim et rendre un motif ; (b) peindre le rayon interdit quand on tient un feu de camp — `carre-village.ts` sait déjà peindre une frontière.

*`packages/client/src/scenes/world/hud-bridge.ts` · `packages/client/src/scenes/ui/fire-panel.ts` · `packages/sim/src/village.ts`*

### D3-3 · Le bouton « Améliorer le Foyer » se grise quand on ne peut pas payer, mais il part quand même au clic

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — `fire-panel.ts:271` `btn.classList.toggle('fpn-btn-off', … && !view.action.affordable)` ; la classe est purement cosmétique (`fire-panel.ts:312` `.fpn-btn-off{border-top-color:#4a453a;color:#8b8474;}` — pas de `pointer-events:none`, pas de `disabled`), et le handler ne consulte jamais `affordable` (`:218-222`). Refus sim : `village.ts:1073`. CORRECTION du recenseur : « le coût s'affiche ailleurs dans le panneau » est FAUX — `grep -n nextCost packages/client/src/scenes/ui/fire-panel.ts` → 0 (voir D3-R2).

**Ce que le joueur vit** — Le bouton est gris, il clique quand même — un bouton gris qui répond au survol, on le teste. Rien ne bouge. Il ne sait pas s'il a raté la cible, si c'est cassé, ou s'il lui manque quelque chose.

**Direction de correction** — Un bouton grisé ne s'envoie pas : couper l'écoute quand `affordable` est faux, et faire porter au bouton ce qui manque — comme la ligne de recette (`hud-character.ts:459-476`, état MANQUE + jetons rouges).

*`packages/client/src/scenes/ui/fire-panel.ts`*

### D3-4 · Un refus sur les réfugiés referme la fenêtre du dilemme — le garde anti-double-envoi ne connaît pas le cas du REFUS

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/gate1-finition.md:58 (« **Raffinement du garde réfugiés.** Mon correctif anti-double-envoi impose un geste par groupe […] Ton appel. ») et gate1-finition.md:77 + docs/decisions.md:477 (2) (« Effet de bord assumé et FLAGGÉ à Alexis »). Le cas du refus, lui, n'y est pas nommé.

**Preuve** — `refugee-prompt.ts:64-77` ferme en optimiste et arme `gate.acted(g)` ; `prompt-gate.ts:31-35` supprime tant que la même identité revient. Deux verbes échouent sans changer l'état du groupe (`village.ts:1368`, `:1371`), et les groupes ne bougent pas (`refugees.ts:33-45`). CORRECTION du recenseur : « seule sortie, s'éloigner » est faux — `WorldScene.ts:1208` publie `[]` quand `overlay` (TAB ou carte, `:1142`), donc `suppresses(null)` lève le garde ; et `INTERACT_RANGE = 1.5` fait de l'autre sortie un demi-pas.

**Ce que le joueur vit** — Il clique RECRUTER sans avoir de Feu. La fenêtre disparaît, un texte rouge passe, et le dilemme ne lui est plus proposé tant qu'il ne bouge pas ou n'ouvre pas un écran — ce que rien n'enseigne.

**Direction de correction** — Le garde protège d'un DOUBLE ENVOI ; il doit donc se lever aussi sur `action_rejected`, pas seulement sur un changement d'état. Question distincte de celle posée en gate1:58 (par groupe → par (groupe, verbe)).

*`packages/client/src/scenes/ui/refugee-prompt.ts` · `packages/client/src/scenes/ui/prompt-gate.ts`*

### D3-6 · Le fantôme reste VERT sur deux des treize refus de pose : `blocks_nav` et `unaffordable`

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-complet-2026-08-20.md § P2 « La dette la plus chère : la règle de pose écrite deux fois » (« Aucun fichier de production n'appelle `evaluateBuild` ») · annexe `ARCH-01` · `CB-08` (« Trois miroirs client de la règle de pose ») · Lot 6 du plan d'itérations (`poseAutorisee`).

**Preuve** — `village.ts:510` `if (!okNav) return fail('blocks_nav')` et `:512` `if (!hasItems(actor.inventory, cost)) return fail('unaffordable')` — les deux DERNIERS de la cascade ; `WorldScene.placeable` (`:488-527`) n'en teste aucun ; `build-ghost.ts:140` teinte sur ce verdict et ne connaît ni coût ni sac. `grep -rn evaluateBuild packages/client/src` → aucun import. NUANCE : `unaffordable` est couvert par une AUTRE surface — le menu du marteau reste ouvert pendant la pose (`UIScene.ts:773-774`) et affiche `etat:'manque'` + jetons rouges (`build-menu.ts:118-133`). `blocks_nav`, lui, n'est couvert par rien avant le clic.

**Ce que le joueur vit** — Fantôme vert au curseur, « MANQUE » à gauche, toast rouge au centre : trois surfaces qui ne disent pas la même chose. Au dernier segment d'une enceinte, le fantôme est vert et la sim répond « cela couperait le passage ».

**Direction de correction** — Ce miroir ne devrait pas exister ; c'est le chantier `poseAutorisee` déjà cadré par l'audit. À citer, pas à revendiquer.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/build-ghost.ts` · `packages/sim/src/village.ts`*

### D3-7 · Poser un coffre sur la tuile où quelqu'un se tient répond « cela couperait le passage » — le passage n'est pas en cause

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus (la cascade `BuildReject` n'y est discutée que sous l'angle des miroirs client, jamais de ses libellés).

**Preuve** — Reproduit par instrument indépendant, même scène à un paramètre près, par le vrai chemin `place_component` : « SANS PNJ : {reasons:[], pose:true} · AVEC PNJ : {reasons:["cela couperait le passage"], pose:false} ». Cause : `construction.ts:415-421`, ANCRE 3 « on ne piège personne (sauf le bâtisseur) » ; libellé `village.ts:525`. L'asymétrie prouve le motif manquant : `place_campfire` refuse proprement « tuile occupée » (`village.ts:958-960`), `place_component` non.

**Ce que le joueur vit** — Un villageois traîne sur sa case ; le jeu lui dit qu'il couperait un passage. Il cherche le couloir qu'il aurait fermé, ne le trouve pas, conclut que la règle est capricieuse. La vraie réponse tient en trois mots.

**Direction de correction** — L'ancre 3 mérite son propre motif ; la cascade porte déjà treize raisons, il en manque une.

*`packages/sim/src/construction.ts` · `packages/sim/src/village.ts`*

### D3-8 · Deux refus de pose invisibles au fantôme : la pluie sur un feu neuf, et le palier du Feu sur 7 composants sur 12

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Classe connue par un AUTRE cas : annexe `hud-propose-semer-sur-une-terre-que-la-sim-refuse` (`aim.ts:263`, « le refus tombe du ciel »). Ces deux gardes-ci n'y sont pas.

**Preuve** — `village.ts:949` `if (meteoMouille(state, tx, ty) && !isSheltered(…)) return reject('un feu neuf ne prend pas sous la pluie')` ; `village.ts:1032` `if (unlockTier > village.tier) return reject('composant verrouillé (palier du Feu)')`. `grep -rn "meteoMouille|unlockTier|COMPONENTS\[" packages/client/src --include=*.ts | grep -v test` → 0 hit. CORRECTION MESURÉE de l'exemple du recenseur : `enclume unlockTier = 1` — jamais refusée. Les sept concernés sont tour_meca 2, cave 2, serre 2, four_acier 3, atelier_lourd 3, reserve 3, terroir 3, tous fabricables dès le palier 1 (`requiert {feu:1}`) — la serre ne coûte que `{wood:8, fiber:6}`.

**Ce que le joueur vit** — Sous l'averse, fantôme vert, clic : rien ne se pose. Ou bien il fabrique une serre, la porte au bon coin, fantôme vert, et la pose est refusée parce que son Feu n'est pas monté — information qu'il n'avait nulle part au moment de la fabriquer.

**Direction de correction** — Les deux gardes sont des prédicats purs : le fantôme peut les interroger. Pour le palier, l'endroit juste est plus tôt — la recette devrait porter son palier requis, comme elle porte sa station (`hud-character.ts:459`, état EXIGE).

*`packages/sim/src/village.ts` · `packages/client/src/scenes/WorldScene.ts`*

### D3-R1 · Le TAPIS du carré peint ROUGE 16 tuiles où la sim ACCEPTE la pose — et un test client vert consacre l'erreur

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — annexe `CB-08` (« Trois miroirs client de la règle de pose ») · `ARCH-01` · audit-complet § P2. NEUF, non couvert : la divergence MESURÉE du troisième miroir, et le test vert qui la fige.

**Preuve** — Balayage exhaustif (prédicat pur `tuilePosable`, `carre-village.ts:336-346`, confronté à `evaluateBuild` sur toutes les tuiles du carré × les 7 pièces du marteau) : « TAPIS VERT / SIM REFUSE : 0 · TAPIS ROUGE / SIM ACCEPTE : 16 » — floor ×6, roof ×6, encadrement ×4. C'est MOT POUR MOT le défaut corrigé sur les deux autres surfaces le 2026-08-10 (`WorldScene.ts:512-518`, `build-ghost.ts:106-121`) ; le tapis a été oublié. Et `carre-village.test.ts:165-168` affirme l'inverse (`expect(tuilePosable(m, pleine, 30, 30, true)).toBe(false)` pour floor/roof) : le test est vert et consacre le faux refus ; son balayage de garde (`:84`) n'interroge `evaluateBuild` que sur `'wall'`.

**Ce que le joueur vit** — Il arme « Sol » : le tapis rougit sous ses pieds, sous son coffre, sous chaque villageois — pendant que le fantôme, à trois pixels, est vert sur les mêmes tuiles. Il n'accordera plus jamais de crédit au tapis.

**Direction de correction** — À verser au chantier `poseAutorisee` déjà cadré (Lot 6). Et réécrire le test T3 contre `evaluateBuild` : sinon la troisième surface divergera à la prochaine pièce.

*`packages/client/src/scenes/world/carre-village.ts` · `packages/client/src/scenes/world/carre-village.test.ts`*

### D3-R2 · Le coût de la montée du Feu est calculé, et n'est affiché nulle part dans le jeu

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — annexe `MORT-01` (« foundableFire / upgradableFire : deux publishers morts et deux clés de HudState que plus personne n'écrit ») · `CB-11` · audit-complet § « Code mort tenu en vie » (« zéro appelant, et leurs deux clés fantômes survivent jusqu'en production »).

**Preuve** — `hud-bridge.ts:165-179` calcule `nextCost = BALANCE.FIRE_UPGRADE_COST[v.tier]`. Le prix du palier suivant n'est affiché ni au modal, ni à l'artisanat, ni ailleurs.

**Ce que le joueur vit** — Le bouton est gris et il ne sait ni quoi ni combien. Il clique (D3-3) et le refus tombe derrière le voile (D3-1). La progression centrale du village n'a pas de prix affiché.

**Direction de correction** — Rendre `nextCost` en jetons rouge/vert dans `.fpn`, comme `coutJetons` le fait déjà (`hud-character.ts:468-475`) — ou retirer le canal mort, comme l'audit le demande.

**Vérification** — Vérifié aujourd'hui, et cela CORRIGE le recenseur : `grep -rn "publishUpgradableFire|publishFoundableFire" packages/client/src` ne rend que leurs définitions (`hud-bridge.ts:181`, `:123`) — le canal n'est pas « publié et lu par personne », il n'est JAMAIS publié. Le modal, seule surface qui propose l'action, dérive via `upgradableFireAt` (`hud-bridge.ts:294`) et n'affiche que `Améliorer le Foyer (palier N)` (`:298`) ; `grep -n nextCost packages/client/src/scenes/ui/fire-panel.ts` → 0.

*`packages/client/src/scenes/world/hud-bridge.ts` · `packages/client/src/scenes/ui/fire-panel.ts`*

### D3-R3 · Le menu pause — seule référence permanente de la grammaire du clic — ne connaît pas l'arme de trait et affirme le contraire du code

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Survivant de la fusion R-M2 ≡ D3-R3. Contexte : docs/decisions.md:480 et gate1-finition.md:59 déclarent cette table livrée — l'arc est arrivé après elle.

**Preuve** — `pause-menu.ts:1-12` déclare sa raison d'être (« la règle centrale est puissante mais invisible […] Ce menu la garde à portée d'ESC »). Sa table est ÉCRITE À LA MAIN (`:40-47`) contrairement au tableau des touches juste au-dessus, dérivé de `keymapEffectif()` (`:31-34`) « parce que c'est le pire endroit pour mentir ». Ligne `:43` : `['une arme en main', 'frapper — maintenu : coup lourd']` — or `bow`/`crude_bow` sont des `WeaponKind` (`balance.ts:1406`) et le clic gauche ne fait rien tant que l'arc n'est pas levé au bouton 2 (`aim.ts:518`, `input-bindings.ts:834-841`).

**Ce que le joueur vit** — Son clic ne fait rien, il fait le geste juste (ESC, relire les contrôles), et la seule page du jeu faite pour dissiper ce doute le confirme dans son erreur.

**Direction de correction** — Une ligne pour l'arme de trait (« CLIC DROIT : lever · gauche : décocher »). Corriger une affirmation FAUSSE ne demande pas d'arbitrage — AJOUTER des lignes, si (D1-5).

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/world/aim.ts`*

### D3-R5 · Une seule action par tick : deux gestes dans la même fenêtre de 50 ms et le premier disparaît sans refus ni trace

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — FAIT DE CODE CITÉ, FRÉQUENCE EN JEU NON MESURÉE. `WorldScene.ts:1135` envoie toutes les actions de la frame ; l'hôte n'en garde qu'une (`sim-worker.ts:126` `let pendingAction`, `:524` écrasement pur, `:148-150` consommée puis effacée), le serveur aussi (`tick-driver.ts:21`, `:89-90`). À 20 Hz, la première est perdue sans `action_rejected`. Le dépôt a déjà rencontré cette pathologie une fois, sur l'arc (`input-bindings.ts:575-586`), et l'a refermée POUR CE SEUL CHEMIN.

**Ce que le joueur vit** — Hypothèse, pas vécu observé : deux clics rapides pour enfiler deux crafts ou envoyer deux piles, un seul part, rien ne le dit. La forme la plus difficile de refus muet — aucun canal ne peut la rattraper.

**Direction de correction** — Ne rien coder sur cette base : instruire d'abord (un scénario smoke qui envoie deux actions dans le même tick et compte ce qui arrive).

*`packages/client/src/worker/sim-worker.ts` · `packages/server/src/tick-driver.ts`*

---

## D4 — Grammaire du geste  *(12 constats)*

### D4-1 · La hache de fer et la hache d'acier ne coupent plus de bois : au clic, elles frappent dans le vide — deux décisions actées d'Alexis se contredisent

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus des audits. LA CONTRADICTION EST DANS LE JOURNAL : docs/decisions.md:250 (« Une ARME en main frappe TOUJOURS […] L'outil, lui, récolte : **la hache n'est pas une arme** ») contre docs/decisions.md:468 (2026-07-23, `steel_axe` = l'arme la plus forte, dégâts 18/30). Le code suit 468 et falsifie 250.

**Preuve** — Reproduit sur le vrai résolveur : `iron_axe + nodeId` → `{"type":"attack"}`, `steel_axe` idem ; `axe`/`crude_axe` → `harvest` ; les 4 pioches → `harvest`. Cascade : `aim.ts:523` (`isWeapon` = `WEAPON_DAMAGE[item] !== undefined`, `balance.ts:1723-1725`) précède `aim.ts:529` (`nodeId`). Chemin mort de bout en bout : `input-bindings.ts:749-756` convertit en `attack_charge` ; `tickHold` (`:851`) reste dans `charging` ; `F` ne rattrape rien (`aim.ts:622` n'accepte que `foraging`). Et le vieux bois exige `minTool:'basic'` (`balance.ts:1053`, `TOOL_RANK` `:945`) : `axe` est la seule hache jouable dessus.

**Ce que le joueur vit** — Il forge sa hache de fer (deux lingots, l'atelier, « ×4 au sac »), clique un arbre : coup d'épaule dans le vide, pas de jauge, pas de message. Son meilleur outil lui ferme la porte que le précédent ouvrait.

**Direction de correction** — Ne se tranche pas par un agent : soit les haches sortent de `WEAPON_DAMAGE` (contre 468), soit la cascade place « je vise un nœud de ma famille d'outil » avant `isWeapon` (contre 250, et contre la règle qu'enseigne le menu pause).

*`packages/client/src/scenes/world/aim.ts` · `packages/sim/src/balance.ts` · `docs/decisions.md`*

### D4-2 · L'arc inverse les deux boutons, personne ne le dit — et le clic gauche, muet en tapant, se met à RÉCOLTER si on le maintient

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Distinct de D1-4 (le conseil) et de D3-R3 (le menu pause) : ici c'est un chemin de code qui contredit la spec.

**Preuve** — `holdHarvest(T({nodeId:7}), null, …, H('bow'))` → `{"type":"harvest","nodeId":7}` : `holdHarvest` (`aim.ts:560-577`) n'a AUCUNE garde d'arme de jet, alors que `aim.ts:518` en a une. Chemin atteignable, relu pas à pas : `input-bindings.ts:739` pose `holding = true` AVANT de connaître l'action ; avec `action === null` on traverse `:744`, `:749`, `:761`, `:771`, `:782`, `:786` sans jamais le remettre à faux, et `tickHold` (`:902-921`) atteint `holdHarvest`. Contredit `tir.md` T2, cité en tête d'`aim.ts:510-512` (« UN ARC NE FRAPPE PAS, ET NE RÉCOLTE PAS NON PLUS »). `aim.test.ts` : 75 tests verts, aucun ne touche `holdHarvest` avec un arc.

**Ce que le joueur vit** — Son arc ne fait rien nulle part — puis, en gardant le doigt appuyé par dépit sur un tronc, il se met à couper du bois avec un arc.

**Direction de correction** — La garde `isRangedWeapon` en tête de `holdHarvest`, ou remettre `holding = false` quand l'action est nulle. Plus la garde de test qui manquait.

*`packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D4-4 · Le clic maintenu sur un voisin MANGE ce qu'on vient de lui donner

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — Reproduit : `clickToAction(T({entityId:9}), null, H('berries',{heldCount:5}))` → `give ×5` ; `holdHarvest(…)` → `{"type":"eat","item":"berries","slot":0}`. Cause : `aim.ts:574` `if (hand && isFood(hand.held)) return eatHeld(hand)` sans aucun test de `target.entityId` ; et `input-bindings.ts:788` ne rafraîchit `lastHarvestAt` que sur `harvest`/`eat` — un `give` laisse le compteur à `-Infinity` (`:533`), donc `tickHold` (`:907-914`) part dès la frame suivante, pas « une seconde plus tard ».

**Ce que le joueur vit** — Il appuie sur le voisin et garde le doigt le temps de vérifier qu'il a reçu. Son personnage dévore le reste de la pile devant lui. Rien à l'écran ne distingue les deux gestes.

**Direction de correction** — Deux vis au même endroit : `holdHarvest` ne doit pas manger quand une entité est visée, et `give` doit rafraîchir `lastHarvestAt`.

*`packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D4-3 · Un clic sur un voisin donne toute la PILE TENUE (≤ 20, et 5 pour la viande cuite) sans annonce préalable — et sans un son quand c'est un membre de son Foyer

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — `aim.ts:466` `count: hand.heldCount ?? 1` ; `input-bindings.ts:402` `const heldCount = slot >= 0 ? (inv[slot]?.count ?? 1) : 1` — le compte ENTIER de la case ; exécuté tel quel (`village.ts:1337`). CORRECTION DE L'ÉCHELLE : `heldCount` est borné par `STACK_SIZES` (`balance.ts:4107-4108`) — 20 par défaut, `berries` 10, `cooked_meat`/`stew`/`raw_meat` 5 : « 40 viandes cuites » est impossible. Et un `gift_given` est bien émis (`village.ts:1345-1354`, sonné par `audio/sound.ts:114`) — mais gaté sur `isOutsider` (`village.ts:1344`) : donner à un membre de SON village n'émet rien et ne sonne pas.

**Ce que le joueur vit** — Il veut donner une viande à un villageois du Foyer : les cinq partent, sans annonce avant, sans son après, et il n'a aucun geste pour les reprendre.

**Direction de correction** — Décider ce que « donner » veut dire par défaut : une unité (le maintien répète, comme manger) ou la pile avec une annonce au survol. C'est le verbe chaud fondamental (spec alignement R2) : Alexis tranche.

*`packages/client/src/scenes/world/aim.ts` · `packages/sim/src/village.ts`*

### D4-5 · Tenir un coffre ou un four arme un MODE de pose qui absorbe le clic — règle ÉCRITE, mais elle coûte la défense du pauvre

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — L'arbitrage est écrit à l'endroit même du code : `packages/client/src/scenes/world/aim.ts:398-400` (« POSER prime sur tout… Le mode dit ce que le clic fait — c'est ce qui le rend prévisible »), même famille que le mode DÉMOLIR acté par Alexis le 2026-08-01 (docs/decisions.md:683, `aim.ts:393-396`).

**Preuve** — Balayage de la classe « objet posable » (campfire + chest + 12 composants) : 64 512 lignes, deux effets seulement — `place_component` (59 904) et `place_campfire` (4 608) ; zéro `attack`, zéro `loot_corpse`. Origine : `input-bindings.ts:222-224` arme `placing`, `aim.ts:401-409` sort avant tout, y compris avant `aim.ts:535-538` (« la défense du pauvre, et elle doit exister »). Contraste : le marteau sans pièce armée rend `{"type":"attack"}`.

**Ce que le joueur vit** — Un loup lui tombe dessus alors qu'il porte un coffre : ses clics essaient de poser le coffre sur le loup. La sortie est à un cran (`1`-`6`, ou la molette), mais il faut y penser pendant qu'on le mord.

**Direction de correction** — Ne pas rouvrir la règle. La seule question pour Alexis : un corps HOSTILE sous le curseur doit-il faire céder le mode de pose ?

*`packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D4-7 · Le clic gauche ne ramasse jamais une pile au sol (il frappe le sol) — un commentaire jure le contraire, et le backlog jure que le verbe n'existe pas

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Le corpus est PÉRIMÉ EN SENS INVERSE : docs/gate1-finition.md:105 classe `pick_up` « **Non** / **Ambigu** — les piles au sol […] ne se ramassent pas ». Faux depuis que la touche d'interaction le porte. Survivant de la fusion D1-9 ≡ D4-7.

**Preuve** — `clickToAction(T({pileId:4}), null, H(null))` → `{"type":"attack"}` ; `clickToAction` (`aim.ts:388-540`) ne lit jamais `target.pileId`, seul `interactTargetAt` le fait (`aim.ts:624`). UN SEUL commentaire ment, contrairement à ce que dit le recenseur : `input-bindings.ts:269` (« Un clic gauche sur une pile la RAMASSE ») est au présent et faux ; `aim.ts:191-198` est au PASSÉ et décrit la motivation historique du champ.

**Ce que le joueur vit** — Sa flèche est au sol, soulignée de blanc sous son curseur. Il clique : coup de poing dans l'herbe. Le liseré promet un geste et ne dit pas lequel.

**Direction de correction** — Corriger `input-bindings.ts:269`, rafraîchir `gate1-finition.md:105`, et décider si un clic sur une pile soulignée doit la ramasser plutôt que frapper le sol.

**Vérification** — Le geste EXISTE et est branché : `packages/client/src/scenes/world/input-bindings.ts:692` `deps.sendAction({ type: 'pick_up', pileId: cible.id })`, avec son affordance (`snapshot-view.ts:1562` `renderContourInteraction`, famille `pile` `:1568`). C'est le CLIC qui ne l'atteint pas, pas le joueur.

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/world/aim.ts` · `docs/gate1-finition.md`*

### D4-8 · ENTRÉE ouvre une ligne de chat qui éteint toutes les commandes — touche non déclarée, non annoncée, non remappable, et active en solo

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus : `CB-04` et `SRV-05` portent sur la POSITION diffusée par le chat, jamais sur sa touche.

**Preuve** — `WorldScene.ts:713` `this.input.keyboard?.on('keydown', (event) => this.onChatKey(event))` puis `:1912` `if (event.key === 'Enter' && !getHud(…,'uiTyping')) { … setHud(…, 'chatTyping', true) }`. Le pas se coupe : `WorldScene.ts:1681` `const typing = … || Boolean(getHud(this.registry,'chatTyping'))` → `:1693-1695` `dx`/`dy` forcés à 0 ; et `onDown` se tait (`input-bindings.ts:152`, `:169-177`). `'Enter'` n'est ni dans `KEYMAP` (`keymap.ts:17-109`, 16 entrées) ni dans `BELT_BINDINGS`, donc ni dans `ACTIONS`, ni au menu pause, ni dans OPTIONS. En solo : `UIScene.ts:711` affiche le chat sans aucune garde de mode.

**Ce que le joueur vit** — Un ENTRÉE réflexe, et son personnage cesse de marcher pendant que ZQSD tapent des lettres. Il croit que le jeu a planté.

**Direction de correction** — Faire entrer « Parler » dans `KEYMAP` + `ACTIONS` (annoncée et remappable d'office), ou la couper hors multijoueur. Dans les deux cas la ligne de saisie doit s'annoncer quand elle prend le clavier.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/keymap.ts`*

### D4-9 · ÉCHAP dans la ligne de chat ouvre le menu pause PUIS ferme le chat : deux gestes pour annuler un accident

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — Le blocage annoncé par le recenseur (« ordre de dispatch inconnu ») se lève par la lecture du moteur : `node_modules/.pnpm/phaser@4.2.0/…/src/input/keyboard/KeyboardPlugin.js:786-808`, boucle `update()` — « Key specific callback first » : `key.onDown(event)` est appelé AVANT `emit(ANY_KEY_DOWN)`. Donc `onDownAlways(TOUCHES.toggleMenu)` (`input-bindings.ts:350-352`) part en premier, puis `closeChatInput` (`WorldScene.ts:1924-1928`), qui ne fait ni `preventDefault` ni `stopImmediatePropagation` (la seule consommation possible, `KeyboardPlugin.js:756-760`). Rien ne consomme l'événement.

**Ce que le joueur vit** — Il ouvre le chat par erreur, fait ÉCHAP pour en sortir, et se retrouve dans le menu pause — qui, en solo, fige l'hôte. Un second ÉCHAP pour revenir.

**Direction de correction** — Faire de la fermeture du chat un CONSOMMATEUR de la touche (drapeau lu par le handler de menu), sans rendre ÉCHAP redevable de `typing()` : la raison d'`onDownAlways` (« une touche de SORTIE qu'on ne peut plus presser est un piège ») reste valable.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D4-10 · MAJ+glisser scinde une pile DANS LE SAC (jamais vers un coffre) : un modificateur en dur, hors du rebinding, que rien n'annonce

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — `inventory-panel.ts:315` `const shiftKey = scene.input.keyboard?.addKey('SHIFT', false)` — chaîne littérale, hors de `keymapEffectif()` ; lue `:394` ; seule source de `split_slot` (`:84`). Or `SHIFT` est `KEYMAP.sprint` (`keymap.ts:44`) et `poseBinding` (`keymap-perso.ts:101-114`) permet de la déplacer (`INREBINDABLE` `:71` ne protège que `toggleMenu`). CORRECTION DU SCÉNARIO : `inventory-panel.ts:55` exige `to.side === 'player'` — MAJ+glisser vers un COFFRE ne scinde rien, la pile entière part (le commentaire `:73` le dit).

**Ce que le joueur vit** — Il ne peut pas découvrir que MAJ coupe une pile en deux à l'intérieur du sac : ce n'est écrit nulle part. Et s'il a déplacé « Courir », MAJ garde ce pouvoir secret pendant que la nouvelle touche ne scinde rien.

**Direction de correction** — Faire venir la touche de scission de `KEYMAP` (donc annoncée et remappable), et l'écrire quelque part que le joueur lira.

*`packages/client/src/scenes/ui/inventory-panel.ts` · `packages/client/src/scenes/world/keymap.ts`*

### D4-11 · Le menu pause montre les touches mais ne laisse pas les changer : il faut quitter la partie pour en corriger une

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Au passage, gate1-finition.md:59 est PÉRIMÉ (« Le mute reste sur N — un vrai curseur de volume viendra ») : le curseur existe (`pause-menu.ts:141-145`, canal `audioVolume` appliqué par `WorldScene.ts:1121-1127`). C'est précisément cette moitié livrée qui rend l'autre criante.

**Preuve** — Le menu pause peint le tableau (`pause-menu.ts:139-140`, `peindreTouches` `:167-172`) et un curseur de son (`:141-145`), puis deux boutons : REPRENDRE (`:147`) et retour au menu (`:148`). `grep -c options packages/client/src/scenes/ui/pause-menu.ts` → 0. L'écran qui rebinde n'existe que sous l'accueil (`menu-dom.ts:382`, atteint par `:410`, boutons `data-bind` `:506`). Non annoncés non plus : la MOLETTE (`input-bindings.ts:318-327`) et le CLIC DROIT-caméra (`WorldScene.ts:1869`).

**Ce que le joueur vit** — On lui montre justement le tableau des touches, et il ne peut que le lire. Pour en changer une, il doit quitter sa partie. Le son, lui, se règle sans sortir.

**Direction de correction** — Rendre les lignes cliquables comme dans OPTIONS (les deux écrans lisent déjà `ACTIONS` × `keymapEffectif`), ou un bouton OPTIONS à côté de REPRENDRE.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/menu-dom.ts`*

### D4-12 · Le clic maintenu répète la récolte d'un nœud mais jamais celle d'un cadavre ni d'un potager

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus, et aucune décision ne couvre ce silence (grep sur decisions.md et gate1-finition.md) : l'asymétrie n'est pas écrite.

**Preuve** — Reproduit : cadavre TAP → `{"type":"loot_corpse","corpseId":3}` / HOLD → `null` ; parcelle mûre TAP → `{"type":"harvest_crop","structureId":8}` / HOLD → `null` ; nœud HOLD → `harvest`. Cause : `aim.ts:575` `if (!target.inRange || target.nodeId === null) return null` — `holdHarvest` ne connaît que `nodeId`, jamais `corpseId` ni `harvestableId`, que le tap sert pourtant (`aim.ts:528`, `:532`).

**Ce que le joueur vit** — Le même bouton, sur deux choses qui se ramassent, ne se comporte pas pareil, et rien ne dit pourquoi.

**Direction de correction** — Décider si le maintien vaut « je continue » sur tout ce qui se ramasse. L'asymétrie vient de ce que `holdHarvest` n'a jamais été rouvert quand `loot_corpse` et `harvest_crop` sont arrivés dans le tap.

*`packages/client/src/scenes/world/aim.ts`*

### D4-13 · Tenir de la tourbe ou du gros bois et cliquer le Feu donne un COUP DE POING, pas un refus : la sim est bois-seul, le clic ne le dit pas

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. ⚠ CONSTAT REÇU TRONQUÉ : le flux d'entrée s'interrompt en plein milieu de son champ « ce que le joueur vit ». Preuve et titre sont complets ; la fin du récit est perdue et n'a pas été reconstruite.

**Preuve** — `aim.ts:499` `if (hand && hand.held === 'wood' && target.onFire && target.inRange) return { type: 'feed_fire' }` et `aim.ts:503` (même littéral `'wood'` pour `repair`). Les frères existent au registre (`ITEM_WEIGHT`, total sur `ItemId`) : `hardwood`, `peat` (« un combustible qui brûle longtemps »), `cut_stone`, `stone`. Sondes : « hardwood + mur abîmé → attack », « stone + mur abîmé → attack », « cut_stone + mur abîmé → attack ». Balayage : 576 `feed_fire` + 288 `repair` pour le bois ; toutes les autres matières tombent dans « objet inerte » (27 456 lignes `attack_charge`). Asymétrie interne : sur une tuile portant à la fois le Feu et une structure abîmée, `feed_fire` gagne toujours (`:499` avant `:503`) et le mur ne peut pas être réparé de là.

**Ce que le joueur vit** — [Fragment reçu, tronqué] « Mon Feu faiblit, le b… » — le joueur tient un combustible qui n'est pas du bois, clique le Feu, et reçoit un coup de poing au lieu d'un refus.

**Direction de correction** — À trancher : quelles matières nourrissent le Feu et réparent (la tourbe est décrite comme un combustible), et si la matière refusée doit produire un REFUS plutôt qu'une frappe. Question de jeu : Alexis.

*`packages/client/src/scenes/world/aim.ts` · `packages/sim/src/items.ts`*

---

## D5 — Apprentissage & découvrabilité  *(14 constats)*

### D5-1 · Les conseils d'accueil se détruisent les uns les autres — horloge de PAGE + canal à une seule case

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:477 (« Onboarding piloté par l'ÉTAT », 2026-07-23) et gate1-finition.md:20-21 (P0, périmé) décrivent le passage minuteur→état ; NI l'un NI l'autre ne nomme l'horloge de page ni la case unique.

**Preuve** — Revérifié à la ligne : `WorldScene.ts:2232` `msAlive: this.time.now` (horloge rAF absolue, jamais relative au monde) ; `WorldScene.ts:2244-2245` `shownHints.add(hint.id)` puis `publishHint(...)` à CHAQUE frame de `checkVitals` ; `hud-bridge.ts:415` écrit une case unique. Rejeu du réfuteur : reprise = 5 conseils en 5 frames, seul le dernier reste.

**Ce que le joueur vit** — À la reprise d'une vallée fondée, quatre leçons clignotent en ~80 ms sous le voile ; seule la cinquième tient l'écran. Les quatre autres sont marquées « montrées » et ne reviendront jamais.

**Direction de correction** — Rendre `msAlive` relatif au `worldReady` et faire du canal `hint` une file : un conseil n'entre dans `shownHints` qu'une fois réellement tenu.

**Vérification** — Le corpus est pessimiste dans l'autre sens : gate1-finition.md:21 réclame encore l'onboarding par état, or il est livré (onboarding.ts, 11 tests verts). Le rider du réfuteur (« la rafale part derrière le voile ») reste SUSPECTÉ : aucun pixel relevé.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/world/hud-bridge.ts` · `packages/client/src/scenes/UIScene.ts`*

### D5-2 · La fiche du Cueilleur enseigne « presse E » — c'est F, et E fait tourner une arête de pose

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:512 (2026-07-24, « CUEILLETTE À LA TOUCHE E ») est la décision d'origine ; `keymap.ts:85` note la migration E→F. Le corpus ne relève nulle part la fiche restée en arrière.

**Preuve** — Lu aujourd'hui : `skill-guide.ts:149` `gesture: 'Vise le buisson et presse E : il tombe ENTIER dans le sac, sans cadence.'`, rendu par `hud-character.ts:201`. `keymap.ts:75` `forage: ['F']`, `keymap.ts:95` `rotateRight: ['E']`. `grep -c gesture skill-guide.test.ts` = 0.

**Ce que le joueur vit** — Il lit une fiche officielle du jeu, presse E devant un buisson, rien ne se passe et rien ne refuse.

**Direction de correction** — Dériver le libellé de `keymapEffectif()` comme `pause-menu.ts:19-33`, et une garde qui interdit tout nom de touche littéral dans `skillGuides()`.

**Vérification** — Aucun doc du corpus ne prétend cette fiche à jour — c'est un angle mort, pas un item barré.

*`packages/client/src/scenes/ui/skill-guide.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/world/keymap.ts`*

### D5-3 · Le seul cours de combat du jeu ment quand l'arme en main est un ARC — et il ne repasse jamais

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Voisin de D5-5 (l'absence de canal pour le clic droit) — deux constats distincts : ici une phrase FAUSSE, là un SILENCE. `docs/specs/tir.md:44-48` (T2) spécifie la grammaire de l'arc sans poser un seul critère d'apprentissage.

**Preuve** — `WorldScene.ts:2235` `hasWeapon: this.myWeapon !== 'unarmed'` inclut les arcs (`WEAPON_PROFILES` : crude_bow, bow) ; le texte servi est `onboarding.ts:58` « MAINTENEZ le clic : un coup lourd s'arme » ; or `aim.ts:518` `if (hand && isRangedWeapon(...)) return null` — le clic gauche est inerte arc en main.

**Ce que le joueur vit** — Arc de fortune en main, il maintient le clic gauche comme on vient de le lui apprendre. Rien ne part, rien ne refuse. Le conseil ne reviendra pas.

**Direction de correction** — Conditionner le conseil `weapon` à `!isRangedWeapon` (correctif sans arbitrage). Le 7ᵉ conseil « arc » qu'appelle D5-5 est, lui, du même rang design que D5-10.

**Vérification** — La moitié « ESPACE : parez de face » reste vraie (la parade ne dépend pas de l'arme, `combat.ts:702`) : le constat ne porte que sur la moitié « coup lourd ».

*`packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/WorldScene.ts`*

### D5-5 · Toute la grammaire du CLIC DROIT — l'arc et la caméra de visée — n'est nommée nulle part dans le jeu

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/specs/tir.md:44-48` (T2) spécifie les trois gestes sans critère d'apprentissage ; decisions.md:696 (2026-08-02) est la décision d'ergonomie.

**Preuve** — Quatre gestes sur le bouton droit (`input-bindings.ts:708-727`, `:731-734`, `:795`, `WorldScene.ts:1864`). Le seul tableau de gestes est borné à l'autre bouton : `pause-menu.ts:137` « LE CLIC GAUCHE — L'OBJET EN MAIN DÉCIDE ». Aucune chaîne AFFICHÉE du client ne nomme le bouton droit (grep : uniquement des commentaires + `atelier/aide.ts`, hors build).

**Ce que le joueur vit** — L'arc reste un objet mort dans le sac : sa grammaire ne se découvre qu'en appuyant au hasard sur un bouton dont rien ne suggère qu'il serve.

**Direction de correction** — Une section « LE CLIC DROIT » dans la table du menu pause (deux lignes), plus le conseil d'arc de D5-3.

**Vérification** — PIÈGE ① CONFIRMÉ, sur la preuve du constat lui-même : `keymap.ts:110-125` (« le clic droit … tombe avec eux », 2026-07-12) et gate1-finition.md:100 (« clic droit débranché ») sont tous deux PÉRIMÉS depuis decisions.md:696 — le bouton porte l'arc. Le fait joueur (aucun canal) tient ; le motif cité par le recenseur, non.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/world/keymap.ts` · `docs/specs/tir.md`*

### D5-10 · Le troisième verbe chaud — panser un ÉTRANGER — est livré, testé, et enseigné par rien

`MAJEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — gate1-finition.md:23-24 (« P1 — Soin d'allié … Reste à confirmer/finir que le client permet de panser un PNJ allié ») — l'item est encore ouvert au backlog.

**Preuve** — `aim.ts:483-484` rend `{ type: 'bandage', targetEntityId }` pour tout blessé visé, fibres en main. Canaux : `pause-menu.ts:45` ne porte que « des fibres, et une plaie · se panser » (soi) ; aucun des six textes de `onboarding.ts:45-59`.

**Ce que le joueur vit** — Le dilemme du voisin, construit à trois issues, s'en joue à deux : donner ou frapper.

**Direction de correction** — ARBITRAGE D'ALEXIS : un 7ᵉ conseil (contre le « trois, pas trente ») ou une ligne de plus dans la table. Le choix fixe la visibilité relative de la voie chaude.

**Vérification** — CONTRADICTION DOC↔CODE : audit-complet-2026-08-20.md:677 déclare les trois items P0/P1/P3-24 « faits », et le code le confirme pour celui-ci (`aim.ts:483`, câblé et testé) — mais gate1-finition.md n'a jamais été barré. La moitié CÂBLAGE est faite ; seul le CANAL manque.

*`packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `docs/gate1-finition.md`*

### D5-11 · À la minute 1, aucune phrase du jeu n'énonce son but — et le HUD compte les jours sans dénominateur

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — audit-gameplay-phase1.md:248 (2026-07-19) nommait « zéro onboarding … doit deviner » — partiellement périmé (six conseils existent depuis le 2026-07-23), mais le BUT n'y était pas distingué des verbes et n'a jamais été traité.

**Preuve** — Écrans du seuil comptés : `menu-dom.ts:407-411`, `:437-448` (seule la tuile MULTI dit « soixante jours »), `:552-560` ; `loading.ts:38-62` (2 gestes sur 23 évoquent la durée). En jeu : `UIScene.ts:731` `JOUR ${time.seasonDay} — ACTE …`, sans dénominateur. La seule phrase qui nomme les soixante jours en solo est `season-veil.ts:153`, à la fin.

**Ce que le joueur vit** — Il ne sait ni qu'il y a soixante jours, ni ce qui arrive au soixantième, ni que le Feu est l'axe du jeu.

**Direction de correction** — ARBITRAGE D'ALEXIS (question de TON) — leviers chiffrés : ① `JOUR n / 60` au HUD, une ligne ; ② faire dire à la tuile SEUL ce que dit la tuile MULTI ; ③ une phrase d'intention au moment de FONDER.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/loading.ts` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/season-veil.ts`*

### D5-R1 · AMÉLIORER UN MUR : le fantôme dit ROUGE et le clic paie quand même — et le palier obtenu n'est pas celui de l'onglet choisi

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/specs/construction.md:120` tranche : « Cliquer une arête qui porte déjà un mur l'améliore au palier de matériau choisi (R8) ». Le fantôme et la sim violent chacun une moitié de cette phrase. Le voisin du corpus, mineurs.md:757-764 (`septieme-liste-ecrite-a-la-main`), ne parle que de la liste `wall||door||palissade` recopiée.

**Preuve** — Les deux moitiés relues aujourd'hui. ① `build-ghost.ts:112-113` `const occupied = surArete ? edgeBarrierAt(...) !== undefined : …` puis `:140` `.setTint(inRange && !occupied ? OK_TINT : BAD_TINT)` — rouge sur une arête déjà murée ; or `input-bindings.ts:246-247` passe cette même barrière en `onTile` et `aim.ts:413-419` en fait `upgrade_structure`. ② `village.ts:1139-1141` `const current = s.material ?? 'wood'` ; `next = WALL_MATERIAL_ORDER[indexOf(current)+1]` — le matériau ARMÉ n'accompagne pas l'action (`aim.ts:418`).

**Ce que le joueur vit** — Onglet MÉTAL, mur de bois visé : le fantôme est rouge, le clic vide pourtant l'inventaire, et le mur devient de PIERRE.

**Direction de correction** — Faire dire la même chose aux deux résolveurs (`occupied` doit connaître le cas améliorable), et aligner la sim sur sa propre spec (ou corriger le libellé du panneau).

**Vérification** — PIÈGE ① : le commentaire `aim.ts:411-412` (« l'AMÉLIORE au palier de matériau choisi ») est FAUX — c'est la spec recopiée, pas le code. NATURE CORRIGÉE en technique : aligner la sim sur sa spec écrite n'est pas un arbitrage.

*`packages/client/src/scenes/world/build-ghost.ts` · `packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/input-bindings.ts` · `packages/sim/src/village.ts` · `docs/specs/construction.md`*

### D5-4 · Les conseils codent F, TAB et ESPACE en dur alors que ces touches se rebindent

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:599 (2026-07-28, « LE MENU PRINCIPAL, ET LES TOUCHES QUI SE RÈGLENT ») pose le rebind ; le corpus ne relève pas que l'onboarding n'a pas suivi.

**Preuve** — `onboarding.ts:46` et `:58` portent « F », « TAB », « ESPACE » en littéraux ; `keymap-perso.ts:71` `INREBINDABLE = ['toggleMenu']` — les trois actions se rebindent. Le patron inverse existe deux fois : `pause-menu.ts:19-33` et `WorldScene.ts:695-701` (`libelleTouche` via `keymapEffectif()`).

**Ce que le joueur vit** — Après un rebind, le conseil lui donne une touche qui ne fait plus rien, pendant qu'OPTIONS et le menu pause disent vrai.

**Direction de correction** — Passer les textes de conseil par `keymapEffectif()` + `libelleTouches()`, et une garde de test partagée avec D5-2.

**Vérification** — Le conseil dit VRAI sur le jeu livré : le défaut n'existe que dans un état que le joueur a choisi — gravité mineure confirmée.

*`packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/world/keymap-perso.ts` · `packages/client/src/scenes/world/touches.ts`*

### D5-6 · La PORTE n'a pas d'affordance de proximité, et les quatre cibles de F partagent un libellé unique

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — decisions.md:704 ② (2026-08-03) : « LA PORTE N'EN EST PAS … Elle garde le geste, elle n'a pas le trait. À rouvrir si le joueur cherche “quelle porte va s'ouvrir”. » Silence DÉCIDÉ, condition de réouverture écrite.

**Preuve** — `input-bindings.ts:686-703` dispatche F sur quatre cibles (feu / nœud / pile / porte la plus proche) ; `keymap-perso.ts:36` les nomme toutes « Cueillir, interagir » ; `aim.ts:606-609` exclut la porte du contour. Le conseil `basics` (`onboarding.ts:46`) n'enseigne que la cueillette.

**Ce que le joueur vit** — Devant sa porte, rien ne s'allume et aucun libellé ne dit que F l'ouvre.

**Direction de correction** — Élargir le libellé de `forage`. Donner un trait à la porte est une réouverture explicite, à trancher par Alexis.

**Vérification** — Doc périmé au passage : gate1-finition.md:105 déclare `pick_up` « Non — Ambigu, les piles au sol ne se ramassent pas », or `input-bindings.ts:692` l'émet. La moitié « le Feu n'a pas d'affordance » est FAUSSE : `aim.ts:621` en fait la première branche du contour.

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/keymap-perso.ts` · `docs/decisions.md`*

### D5-7 · Le contour blanc promet un geste sans jamais nommer la touche qui le déclenche

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:704 ③-⑤ (2026-08-03) détaille la grammaire du contour sur cinq points (huit copies, `TintModes.FILL`, blanc pur, gris hors de portée) — commande d'Alexis. L'absence d'étiquette n'y est jamais nommée.

**Preuve** — `WorldScene.ts:1148` `setInteractTarget(...)`, peint par `snapshot-view.ts:470-477`. Aucune chaîne affichée du client ne cite la touche hors `onboarding.ts:46`, conseil one-shot qui ne parle que de cueillette.

**Ce que le joueur vit** — Un liseré blanc dit « quelque chose est possible ici » ; il clique, et le clic ne cueille plus depuis le 2026-07-24.

**Direction de correction** — Accoler l'étiquette de la touche effective au contour (dérivée, jamais écrite). Ajouter un élément à cette grammaire visuelle est un arbitrage de DA.

*`packages/client/src/scenes/world/snapshot-view.ts` · `packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/aim.ts`*

### D5-8 · « Avoir un Feu » = « être dans un village » : les leçons du feu n'atteignent pas le porteur de feu de camp

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:478 (2026-07-23) branche `feed-fire` sur « le combustible sous 30 % » — le seuil est calculé sur `myVillage.fuel` seul (`WorldScene.ts:1994-1997`).

**Preuve** — `WorldScene.ts:2233` `hasFire: this.myVillageId !== null` ; `village.ts:919-923` : `place_campfire` pose « une structure `fire` LIBRE (villageId 0) … Pas de village, pas de PNJ ». `fire-purpose` (`onboarding.ts:75`) et `feed-fire` (`:77`) pendent donc au village.

**Ce que le joueur vit** — Le joueur qui pose un feu de camp n'entend jamais « le feu cuit, réchauffe, tient les loups », ni « nourrissez-le », alors que son feu libre a son propre combustible et s'éteint.

**Direction de correction** — Séparer `hasFire` (une structure `fire` à moi/à portée) de `hasVillage` dans l'état d'onboarding.

**Vérification** — Le vécu annoncé par le recenseur (« il lit “il vous faut un FEU” devant ses flammes ») est impossible : `make-fire` part frame 0 par le défaut de D5-1. Reste le manque de leçon, réel.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/ui/onboarding.ts` · `packages/sim/src/village.ts`*

### D5-9 · Trois issues du clic gauche n'ont aucun canal textuel : semer, récolter une parcelle, fouiller au clic

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — L'issue `upgrade_structure`, quatrième item du constat d'origine, est SORTIE d'ici : elle est portée par D5-R1, qui en dit plus (le fantôme la refuse et le palier obtenu n'est pas celui choisi).

**Preuve** — La table du clic compte 6 lignes pour 7 des 11 issues du clic nu (`pause-menu.ts:41-48`, relues aujourd'hui). Sans ligne : `plant` (`aim.ts:507`), `harvest_crop` (`:532`), `loot_corpse` au clic (`:528`).

**Ce que le joueur vit** — Il tient une graine devant une parcelle, clique, ça pousse — sans savoir pourquoi ; il fouille une dépouille par hasard.

**Direction de correction** — Compléter la table de référence du menu pause (trois lignes). C'est un ajout à une table consultable, pas un tutoriel.

**Vérification** — GRAVITÉ RÉDUITE : les trois verbes restants ont un canal partiel non cité — la parcelle VERDIT à maturité (decisions.md:482, « c'est prêt lisible d'un coup d'œil ») et la dépouille a sa flèche (`UIScene.ts:671-674`). Canal présent mais incomplet → mineur.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/world/aim.ts`*

### D5-13 · Les tests de l'apprentissage sont verts et structurellement aveugles aux deux défauts majeurs

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — audit-complet-2026-08-20.md:574-583 pose le défaut sœur côté outillage (les verdicts de `smoke` n'échouent jamais) ; le trou de couverture de l'onboarding n'y est pas.

**Preuve** — Rejoué par moi ce jour : `pnpm --filter @ashes/client exec vitest run src/scenes/ui/onboarding.test.ts src/scenes/ui/skill-guide.test.ts` → « Tests 22 passed (22) ». `grep -c gesture skill-guide.test.ts` = 0. Aucun cas ne part d'un `shown` VIDE en rejouant la boucle du caller (`onboarding.test.ts:39,43,70,78`), et `msAlive` n'est qu'un paramètre.

**Ce que le joueur vit** — Rien directement — c'est la raison pour laquelle D5-1 et D5-2 ont survécu à des passes de qualité successives.

**Direction de correction** — Deux gardes : ① rejouer la boucle depuis `shown` vide et affirmer un espacement minimal entre publications ; ② interdire tout nom de touche littéral dans `HINT_TEXT`, `skillGuides().gesture` et `pause-menu.CLICKS`.

*`packages/client/src/scenes/ui/onboarding.test.ts` · `packages/client/src/scenes/ui/skill-guide.test.ts`*

### D5-12 · La molette change l'objet en main sans canal — alors que la même molette, sur la carte, est écrite à l'écran

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:171 (2026-07-12) liste la molette parmi ce qui RESTE au clavier/souris ; jamais reportée dans un canal joueur.

**Preuve** — `input-bindings.ts:318-327` fait défiler la ceinture hors overlay ; `pause-menu.ts:34` ne cite que « 1 – 6 » ; `ACTIONS` (`keymap-perso.ts:28-45`) ne porte aucune entrée souris. Contraste : `UIScene.ts:383` « molette : zoom · glisser : déplacer · M : fermer ». Idem `inventory-panel.ts:55` (SHIFT scinde) et `:118` (clic droit = envoi rapide).

**Ce que le joueur vit** — Il scrolle par réflexe et change d'objet en main ; le retour est immédiat (case surlignée, `hud-core.ts:312`) mais le geste n'est écrit nulle part.

**Direction de correction** — Une section « LA SOURIS » dans la table du menu pause.

**Vérification** — Les trois gestes doublent des verbes découvrables autrement (case cliquable `hud-core.ts:163`, 1-6, glisser-déposer) → cosmétique.

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/inventory-panel.ts`*

---

## D6 — Coutures entre écrans  *(19 constats)*

### D6-7 · L'écran de rupture se peint dans le canvas, donc SOUS tous les voiles DOM

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — audit-complet-2026-08-20.md:180-189 traite `fatal` (ses deux déclencheurs, la couverture `unhandledrejection`) mais jamais sa profondeur.

**Preuve** — `UIScene.ts:304` `createFatalPanel(this, FATAL_DEPTH, …)` — une profondeur de CANVAS ; `fatal.ts:50` peint un `scene.add.rectangle`. À la rupture, `UIScene.ts:684-692` ne baisse que `this.loading` et `this.hudRoot` (z 40). Restent au-dessus : `death-veil.ts:82` (z 60), `pause-menu.ts:93` (z 70), `season-veil.ts:74` (z 80). Déclencheur atteignable : `host-connection.ts:100-102`.

**Ce que le joueur vit** — Menu pause ouvert en vallée partagée, le serveur tombe : il voit toujours REPRENDRE, reprend, et retrouve un monde figé sans un mot.

**Direction de correction** — Rendre l'écran fatal en DOM au rang le plus haut, ou masquer tous les voiles DOM à la pose de `fatal`.

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/fatal.ts` · `packages/client/src/host-connection.ts`*

### D6-10 · Le menu pause affirme « LA VEILLÉE, EN PAUSE » alors qu'en vallée partagée rien ne s'arrête

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `mains-libres.ts:12-15` acte déjà que « en multi le serveur IGNORE `pause` … donc on marchait pour de vrai » — le PAS a été corrigé, le LIBELLÉ jamais.

**Preuve** — `pause-menu.ts:134` `<div class="pm-eyebrow">LA VEILLÉE, EN PAUSE</div>` (ligne vérifiée par grep `pm-eyebrow`) et `:9` « fige le monde solo ». Côté serveur, `zone-room.ts:226-227` : « `pause`/`resume`/`debug_speed` et tout message inconnu : ignorés. Le monde des autres ne s'arrête pas ».

**Ce que le joueur vit** — En vallée partagée, il lit les touches, immobile ; la nuit tombe, un loup arrive, il perd des PV derrière un écran qui affirme le contraire.

**Direction de correction** — Soit l'écran dit la vérité en multi, soit le multi obtient un vrai retrait. Le libellé, lui, se corrige seul.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/server/src/zone-room.ts` · `packages/client/src/scenes/world/mains-libres.ts`*

### D6-11 · Le journal (J) ne mange pas le clic : on frappe et on récolte le monde à travers la chronique

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:480 (2026-07-23) : « `overlayOpen()` inclut `menuOpen` (le menu mange le clic monde) » — le journal, pourtant nommé le même jour comme un écran de même rang, n'y a jamais été ajouté.

**Preuve** — Relu ce jour : `input-bindings.ts:382-387` — `overlayOpen()` n'énumère que `mapOpen`, `characterMenuOpen`, `menuOpen`, `openFire`. Le panneau est un conteneur Phaser inerte (`UIScene.ts:266-276`, aucun `setInteractive` dans le fichier), et le garde du pointeur (`:706-707`) comme `tickHold` lisent tous `overlayOpen()`.

**Ce que le joueur vit** — Il clique dans la chronique pour la faire défiler : un coup de hache part dans le monde derrière.

**Direction de correction** — Ajouter `journalOpen` à `overlayOpen()` — une ligne, dans la fonction qui EST la source unique.

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/UIScene.ts`*

### D6-1 · La stèle de fin de saison ne coupe pas les mains — et le menu pause s'ouvre sous elle

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — gate1-finition.md:57 et decisions.md (2026-07-23, « LA STÈLE DE FIN DE SAISON ») livrent la stèle comme cérémonie TERMINALE — la prise des mains n'y figure pas. Frère de R6-A (chemin `fatal`) : deux sites distincts, NON fusionnés.

**Preuve** — Grep refait : `input.enabled|keyboard.enabled` dans `WorldScene.ts` → 752, 753, 1024, 1025, 2511, 2512, 2539, 2550 — aucune sur le chemin `season_ended`, dont le handler complet (`WorldScene.ts:2485-2490`) ne fait que `publishSeasonEnded` + destruction du marqueur. `season-veil.ts:74` z-index 80 contre `pause-menu.ts:93` z-index 70.

**Ce que le joueur vit** — L'avatar marche sous la cérémonie ; ÉCHAP ouvre un menu pause invisible qui fige vraiment l'hôte, et un second ÉTAPE relance le monde.

**Direction de correction** — Faire à la levée de la stèle ce que fait `enterDying()` : couper input et clavier, et refuser tout voile de rang inférieur pendant qu'elle est posée.

**Vérification** — La stèle reste au-dessus (z 80) : le bouton ROUVRIR LA VALLÉE n'est jamais inaccessible, aucun état perdu → mineur.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/ui/season-veil.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

### D6-2 · « Retour au menu principal » ne répond pas — et en vallée partagée l'attente muette est de 3 000 ms garanties

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:633 ② (2026-07-29) mesure et corrige la lenteur du geste, cite explicitement « les 3 s de son garde-fou » et le contrat `saved` — mais ne traite que la DURÉE, jamais l'absence de retour visuel.

**Preuve** — `pause-menu.ts:162` : le clic n'écrit aucun état d'écran. `WorldScene.ts:1110-1113` pose `quitEnCours` et envoie `pause` ; `:1117-1120` part sur `QUIT_ATTENTE_MS` (`WorldScene.ts:321` = 3000). Le seul retour existant (`publishSaved`) est peint dans le HUD (z 40), sous le menu pause (z 70, fond .985).

**Ce que le joueur vit** — En vallée partagée, trois secondes devant un bouton qu'il croit mort. En solo, le départ est quasi immédiat.

**Direction de correction** — Au clic : désactiver le bouton et remplacer son libellé par l'état réel, comme `menu-dom.ts:292` pour l'effacement d'une case.

**Vérification** — GRAVITÉ RÉDUITE, la moitié solo est DÉJÀ CORRIGÉE et le code le confirme : `sim-worker.ts:251-252` répond `saved` immédiatement si `sim.tick === tickEcrit`, ce qui est le cas courant (le menu pause a déjà envoyé `pause`). Reste le plancher multi (le serveur n'émet jamais `saved`, `zone-room.ts:226`) : 3 s, sans perte d'état → mineur.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/WorldScene.ts` · `packages/client/src/worker/sim-worker.ts`*

### D6-3 · Entre le menu et le monde, le CONTENU disparaît avant que le suivant existe

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:425 (2026-07-19) pose l'écran de chargement DOM ; aucune entrée du corpus ne traite le raccord entre les deux écrans.

**Preuve** — `MenuScene.ts:150-153` retire le voile AVANT `scene.start('world')` ; l'écran de chargement ne naît qu'au `create` d'UIScene (`UIScene.ts:311`, lancée par `WorldScene.ts:754`). Au retour, `MenuScene.ts:95-100` n'monte l'écran qu'après la promesse `listSlots()`.

**Ce que le joueur vit** — Aux deux seuils les plus fréquents, un trou de contenu sur fond continu, de durée inconnue.

**Direction de correction** — Ne retirer le voile du menu qu'une fois l'écran de chargement monté, et monter la planche du menu tout de suite, cases en attente.

**Vérification** — ÉTIQUETTE ABAISSÉE À SUSPECTÉ : la quantité qui porte la gravité — la DURÉE du trou — n'est pas mesurée, et la phrase « aplat sombre nu » est fausse (trois fonds identiques : `main.ts:25`, `menu-dom.ts:617`, `loading.ts:178` = #0f0b08).

*`packages/client/src/scenes/MenuScene.ts` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/loading.ts`*

### D6-4 · ÉCHAP empile le menu pause au lieu de refermer le panneau ouvert

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `input-bindings.ts:160-168` (« ⚠ LE MENU PAUSE SEUL, PAS `overlayOpen()` … même question laissée à Alexis pour la carte et l'écran personnage ») et `mains-libres.ts:21-25`. Question déjà routée, jamais journalisée dans decisions.md.

**Preuve** — `input-bindings.ts:350-352` bascule `menuOpen` sans consulter `characterMenuOpen`, `mapOpen`, `journalOpen` ni `openFire` ; le menu principal, lui, referme vers l'accueil (`menu-dom.ts:173-177`).

**Ce que le joueur vit** — Sac ou carte ouverts, ÉCHAP pose un second écran par-dessus ; deux appuis pour revenir au point de départ.

**Direction de correction** — Une règle unique à trancher : ÉCHAP referme ce qui est ouvert, ou ouvrir le menu pause referme les panneaux. L'état « deux écrans empilés » ne doit pas exister.

**Vérification** — Vérifié : les trois seuls `onDownAlways` sont `:307` (TAB), `:350` (ÉCHAP), `:670` (E) — seul E se re-garde.

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/world/mains-libres.ts`*

### D6-5 · Les deux touches de SORTIE (ÉCHAP, TAB) sont câblées hors la garde de saisie : ÉCHAP annule le chat ET ouvre le menu, TAB ouvre l'écran personnage

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Fusionne R6-B (le volet TAB). Le volet « qui doit gagner ÉCHAP quand un panneau est ouvert » reste D6-4.

**Preuve** — `WorldScene.ts:713` écoute `keydown` pour le chat, `:1898-1901` y traite ÉCHAP ; `input-bindings.ts:350-352` et `:307` sont câblés en `onDownAlways`, donc hors de `typing()` (`:152`, qui inclut `chatTyping`). L'ordre est fixé par Phaser 4.2.0 (`KeyboardPlugin.js` : `key.onDown(event)` avant `emit('keydown')`). Le chat n'est pas un `<input>` DOM (`WorldScene.ts:1907` lit au caractère), donc TAB y va droit au handler.

**Ce que le joueur vit** — ÉCHAP annule son message et lui colle le menu pause au visage ; TAB ouvre son sac (et un conteneur voisin) pendant que la ligne de chat continue d'avaler ses lettres.

**Direction de correction** — Re-garder TAB et ÉCHAP par `typing()` à l'intérieur de leur handler, comme le fait déjà `forage` (`input-bindings.ts:670-671`).

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D6-6 · TAB dans le champ de recherche ne referme pas le sac au premier appui

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — L'intention violée est écrite en face : `input-bindings.ts:178-181` (« une touche de SORTIE qu'on peut se retrouver à ne plus pouvoir presser est un piège »). Le corpus ne relève pas la violation.

**Preuve** — `hud-character.ts:282-285` : `search.addEventListener('keydown', (e) => { e.stopPropagation() … })` — seul site hors `menu-dom.ts`. Phaser écoute en bulle sur `window` (`KeyboardManager.js:164`, `:230`), donc `onDownAlways(TOUCHES.toggleInventory)` (`input-bindings.ts:307`) ne s'exécute pas.

**Ce que le joueur vit** — Premier TAB : le focus saute. Deuxième TAB : le sac se ferme. La touche « répond une fois sur deux ».

**Direction de correction** — Ne pas couper le clavier à la racine dans le champ : laisser passer les touches de sortie, comme `menu-dom.ts:270-274` gère lui-même Entrée/Échap.

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D6-8 · Rejoindre une vallée partagée affiche le sous-titre du solo, anneau à 0 %

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:425 (2026-07-19) pose l'écran de chargement et son texte ; le mode multi (L1, 2026-07-18) n'y a jamais été répercuté.

**Preuve** — `loading.ts:203` : « la Veillée » en dur. `loading.ts:132` calcule sa fraction sur `progress.total > 0`, et `grep -rn "'progress'" packages/server/src` → zéro : le serveur ne parle qu'au `ready` (`zone-room.ts:178-189`).

**Ce que le joueur vit** — L'écran s'intitule « la Veillée » alors qu'il vient de choisir À PLUSIEURS ; l'anneau reste à 0 % jusqu'au saut final, indistinguable d'une panne si le serveur est éteint.

**Direction de correction** — Dériver le sous-titre du mode, et dire l'attente réseau autrement qu'avec un anneau à 0 %.

**Vérification** — L'écran n'est pas immobile (anneau `blRingSpin`, geste changé toutes les 3 s) — ce qui manque est le NOM du mode et la distinction charge/panne → mineur.

*`packages/client/src/scenes/ui/loading.ts` · `packages/client/src/scenes/WorldScene.ts` · `packages/server/src/zone-room.ts`*

### D6-9 · L'écran de rupture promet un rechargement qui ne tient pas — sauf par deep-link

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:633 ③ (2026-07-29) : le retour au menu ne recharge plus la page — l'écran fatal est resté sur l'ancien contrat.

**Preuve** — `fatal.ts:53` « LA VEILLÉE S'EST ROMPUE » et `:66-67` « Recharger régénère la même vallée (la seed ne change pas). » ; `UIScene.ts:304` fait `window.location.reload()` sur une URL nettoyée (`WorldScene.ts:2207`), et une entrée par le menu passe le choix par les `data` de scène (`MenuScene.ts:107-112`). Un seul bouton (`fatal.ts:83-86`).

**Ce que le joueur vit** — Il recharge et atterrit à l'accueil ; en multi on lui annonce une « Veillée » rompue alors qu'il jouait sur un serveur.

**Direction de correction** — Dire ce que le bouton fait, adapter le titre au mode, et offrir la sortie douce vers l'accueil.

**Vérification** — La phrase est VRAIE sur le chemin deep-link (`MenuScene.ts:70-87` relit `?solo&slot=&seed=`) : elle ne ment qu'à l'entrée par le menu. L'autosave tourne, rien n'est perdu → mineur.

*`packages/client/src/scenes/ui/fatal.ts` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/MenuScene.ts`*

### D6-13 · Le clavier reprend la main avant que le voile de chargement soit parti

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:425 (2026-07-19, écran de chargement DOM) ne traite pas la reprise de l'input.

**Preuve** — `WorldScene.ts:1024-1025` rend l'input dans la dernière étape de montage ; le voile ne part qu'après le premier snapshot (`UIScene.ts:698-706` → `:634`), et `loading.ts:66` `FADE_MS = 420`. Aucun `pointer-events` déclaré dans `loading.ts` : la souris est mangée, le clavier non.

**Ce que le joueur vit** — Pendant au moins 420 ms, une touche pressée fait marcher l'avatar ou ouvre le sac derrière un voile encore opaque ; la souris, elle, ne répond pas.

**Direction de correction** — Un seul instant rend les mains : reculer `input.enabled` à la fin du fondu, ou poser `pointer-events:none` sur le voile.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/loading.ts`*

### D6-14 · Le smoke qui vérifie que l'écran de chargement s'est levé regarde une profondeur que plus aucun objet ne porte

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — audit-complet-2026-08-20.md:574-583 pose le défaut voisin (« chaque verdict écrit est un test qu'on croit avoir et qu'on n'a pas ») — mais sur les verdicts ROUGES ignorés, pas sur un verdict VERT par construction.

**Preuve** — Vérifié sur l'arbre de travail d'aujourd'hui : `tools/smoke.mjs:3974` `ecran: ui ? ui.children.list.some((o) => o.depth === 1001) : false`, alors qu'aucun objet de `UIScene` ne reçoit 1001 (le voile est du DOM, `UIScene.ts:311` → `loading.ts:87-90`). `grep -c bl-overlay tools/smoke.mjs` = 0 : aucun scénario ne rattrape la couverture.

**Ce que le joueur vit** — Rien aujourd'hui — mais le jour où le voile resterait collé, le scénario `chargement` dirait toujours que tout va bien.

**Direction de correction** — Interroger le DOM (`.bl-overlay` + opacité calculée), comme le scénario `pause` le fait déjà pour `.pause-menu`. Idem pour le HUD, en DOM depuis longtemps.

*`tools/smoke.mjs` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/loading.ts`*

### D6-15 · Un écran qui s'ouvre pendant un geste maintenu : TROIS conventions (l'abattage LÂCHE le coup, le minage se tait, la charge et l'arc annulent)

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:477 (3) pose `cancelHold()` pour la MORT (« abandonne charge/abattage/minage/récolte SANS émettre ») — la règle existe donc déjà pour un cas, elle n'a pas été portée à l'ouverture d'un écran.

**Preuve** — Les quatre branches de `tickHold` relues par moi : `input-bindings.ts:813-815` (arc → `baisserArc()` → `attack_cancel`, `:599-603`), `:838-842` (mêlée → `attack_cancel`), `:867-871` (abattage → `releaseFell()` → `harvest_release`), `:884-888` (minage → `mining = false ; return`, rien d'émis). Et `economy.ts:709-717` confirme que `harvest_release` FRAPPE dès `charge.ticks >= FELL_GREEN_START_TICKS`.

**Ce que le joueur vit** — Ouvrir un menu pendant un abattage fait partir le coup (propre ou faible) ; le même geste en combat n'envoie rien.

**Direction de correction** — Choisir une convention unique pour « un écran s'ouvre pendant un geste maintenu », puis l'écrire une fois pour les quatre gestes. Un coup propre gagné ou perdu est une conséquence de jeu.

**Vérification** — Le troisième régime (minage muet) était une addition du réfuteur : je l'ai vérifié moi-même à `input-bindings.ts:884-888`. Le titre tient.

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/sim/src/economy.ts`*

### D6-18 · La carte et l'écran personnage ne figent pas le pas — la question est ouverte dans le code, jamais journalisée

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `mains-libres.ts:21-25` — et rien dans `docs/decisions.md` : `grep -i "consultant sa carte|mains libres"` sur tout `docs/` ne rend aucune entrée de journal. La question est routée dans le code seul.

**Preuve** — Vérifié ce jour (le réfuteur ne l'avait pas fait) : `mains-libres.ts:21-25` pose la question mot pour mot (« peut-on marcher en consultant sa carte ? … elle revient à Alexis »), et `WorldScene.ts:1693` `const fige = !mainsLibres({ saisit: typing, meurt: this.dying, enPause: this.menuPaused })` ne connaît toujours que trois états. Asymétrie confirmée : `input-bindings.ts:168` (un seul écran) contre `:383-387` (quatre).

**Ce que le joueur vit** — Sac ou carte ouverts, le monde avance et l'avatar marche derrière un panneau plein écran ; menu pause ouvert, tout est figé.

**Direction de correction** — Question de jeu, déjà nommée et laissée à Alexis. Sa réponse s'écrit en un champ de plus dans `EtatDesMains`.

**Vérification** — L'état du code correspond bien à ce que le commentaire décrit (contrôle fait sur `WorldScene.ts:1693`, pas sur le commentaire) — le commentaire n'est pas périmé.

*`packages/client/src/scenes/world/mains-libres.ts` · `packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### R6-A · L'écran de rupture ne prend pas les mains : sous le voile de panne, l'avatar marche encore et les clics partent

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Frère de D6-1 (stèle) — NON fusionné : deux sites distincts (`:2485-2490` contre `:841`/`:891`), et D6-1 porte en propre le menu pause z 70 sous la stèle z 80. Les trois cérémonies terminales (mort, fin de saison, rupture) réclament une règle unique.

**Preuve** — Vérifié moi-même : le chemin `fatal` n'écrit qu'un drapeau (`WorldScene.ts:841`, `:891`), et le grep `input.enabled|keyboard.enabled` (752, 753, 1024, 1025, 2511, 2512, 2539, 2550) n'a aucune ligne sur ce chemin. Le voile est un `scene.add.rectangle` non interactif (`fatal.ts:50`), et `overlayOpen()` ne connaît pas `fatal`. Comparaison : `enterDying()` coupe input, clavier et `cancelHold()` pour un voile de 3,2 s.

**Ce que le joueur vit** — L'avatar avance en prédiction pure sous le voile, sans jamais être rappelé par un snapshot ; une charge d'attaque reste armée.

**Direction de correction** — Faire au chemin `fatal` ce que fait `enterDying()` : couper input/clavier et appeler `cancelHold()` dès la pose du drapeau.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/fatal.ts`*

### D6-12 · Le menu pause s'ouvre en fondu et se ferme d'un claquement

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — gate1-finition.md:61 pointe la dette de forme partagée des overlays DOM (tokens, `createVeilShell`) sans nommer cette asymétrie.

**Preuve** — `pause-menu.ts:195-203` : la branche `else` fait `classList.remove('pm-on')` puis `style.display = 'none'` dans la même frame — la transition de `:94` (`opacity .2s ease`) ne peut pas jouer. `death-veil.ts:118-123` fait l'inverse (`display:none` sur `transitionend`).

**Ce que le joueur vit** — L'entrée est soignée, la sortie brutale.

**Direction de correction** — Reprendre le patron de `death-veil.ts`.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/death-veil.ts`*

### D6-16 · Deux mentions de version cohabitent au coin bas-droit de l'accueil, et le tampon de build passe par-dessus tous les voiles

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — decisions.md:619 traite le tampon comme un meuble permanent (l'atelier de captures le MASQUE au lieu de le supprimer) ; `build-stamp.ts:1-7` le déclare « demande d'Alexis ».

**Preuve** — `menu-dom.ts:610` « v0.1.0 · ALPHA » calé `bottom:24px;right:28px` (`:641`) ; `main.ts:18` appelle `mountBuildStamp()` hors de toute garde `import.meta.env.DEV`, et `build-stamp.ts:26-28` pose `right:6px;bottom:4px;z-index:2147483000` — au-dessus du 80 de la stèle et du 60 du voile de mort.

**Ce que le joueur vit** — Deux mentions de version dans le même coin de l'accueil, et un hash git écrit par-dessus les deux cérémonies du jeu.

**Direction de correction** — Une seule mention à l'accueil, et le tampon retiré sous les voiles cérémoniels (ou réservé au dev). Le tampon est une demande d'Alexis : son retrait lui revient.

**Vérification** — Le CHEVAUCHEMENT n'est pas prouvé (24/28 px contre 4/6 px, offsets distincts, aucun pixel relevé) : le constat se limite à la COHABITATION, certaine en code.

*`packages/client/src/scenes/ui/build-stamp.ts` · `packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/main.ts`*

### D6-17 · Les bandes noires autour du jeu ne sont pas de la même encre que le jeu

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — gate1-finition.md:61 (dette des teintes codées en dur dans les overlays, `palette.ts` comme source unique) est le chantier auquel cette ligne appartient.

**Preuve** — Lu aujourd'hui : `packages/client/index.html:11` `background: #0e0e12;` sur `html, body`, contre `main.ts:25` `backgroundColor: '#0f0b08'` — repris à l'identique par `menu-dom.ts:617` et `loading.ts:178`.

**Ce que le joueur vit** — Hors 16:9, les bandes de letterbox tirent au bleu-gris froid quand toute l'image tire au brun chaud ; sous un voile DOM la différence disparaît.

**Direction de correction** — Aligner le fond de page sur #0f0b08.

*`packages/client/index.html` · `packages/client/src/main.ts`*

---

## D7 — Lisibilité (WCAG)  *(18 constats)*

### D7-7 · La croix qui annule une fabrication mesure 12,4 × 18,5 px de maquette — et c'est le seul moyen d'annuler

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — croiser D7-8 et D7-R3 (même famille de cibles sous-dimensionnées)

**Preuve** — Vérifié littéral : `craft-queue.ts:38` `.cq-x{font-size:14px;color:#8b8474;cursor:pointer;padding:0 2px;}` — aucune `width`, `height` ni `line-height`, la boîte est celle du glyphe. Et `craft-queue.ts:93` est l'unique émetteur client de `{ type: 'cancel_craft' }`. Aucun document du corpus ne parle de taille de cible cliquable (grep « 24×24 », « cible cliquable », « zone cliquable » : zéro).

**Ce que le joueur vit** — Dix cordes lancées par erreur : il vise une croix de ~9 px à 1280×720, la manque, réessaie, sans second chemin d'annulation.

**Direction de correction** — Boîte carrée explicite d'au moins 24 px de maquette (≥ 36 px pour tenir à 1280×720). RETIRER le sous-constat « le survol ne se voit pas » : `.cq-x:hover{color:#e05a4a}` (:39) est un changement de teinte franc, et rien ne mesure sa perceptibilité.

*`packages/client/src/scenes/ui/craft-queue.ts`*

### D7-9 · Deux régimes d'échelle jamais réconciliés : à 1280×720 un intitulé d'équipement rend à 6,0 px à côté d'un menu pause à taille pleine

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — grep « planche », « HUD_DESIGN », « 1366 », « résolution » sur docs/ : rien sur ce couple

**Preuve** — Vérifié : `hud-dom.ts:44` `const k = Math.min(window.innerWidth / HUD_DESIGN_W, …)` puis `scale(${k})` sur une planche 1920×1080 ; les quatre voiles (death-veil, pause-menu, season-veil, build-stamp) montent sur `document.body` en `position:fixed`. Chiffre porteur vérifié : `hud-character.ts:593` `.hch-eq-lbl{font-size:9px;…}` → 6,0 px rendus à 1280×720. Les deux régimes sont chacun DOCUMENTÉS (hud-dom.ts:8-11 ; death-veil.ts:18-22) mais jamais confrontés.

**Ce que le joueur vit** — Sur un portable 1366×768, le menu pause est confortable et le HUD deux tailles plus petit — mêmes mots, deux mondes typographiques. Les intitulés d'emplacement d'équipement passent sous le seuil du lisible.

**Direction de correction** — Ne se tranche pas par un agent : tout sur la planche, tout en unités écran, ou un `k` plancher. Les trois changent l'aspect du jeu à toutes les résolutions.

*`packages/client/src/scenes/ui/hud-dom.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/death-veil.ts`*

### D7-10 · L'état du Feu inverse lisibilité et urgence : ALLUMÉ 8,64:1, BRAISES 4,15, ÉTEINT 3,38 — deux états sur trois sous AA

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — D7-10 + REF-2 fusionnés (REF-2 apporte la chaîne de preuve :80/:294/:316) · UI-04 (annexe:168) ne cite que hud-character.ts:711, pas le Feu

**Preuve** — Vérifié littéral aujourd'hui : `fire-panel.ts:26` `STATE_COLOR = { lit:'#e8a33a', ember:'#b5602a', out:'#6f685a' }`, posé à `:80` sur `.fpn-state` (`:294`, 12 px espacé), injecté à `:316`, sur la carte OPAQUE `.fpn-card{…background:#16120d}` (`:290`). La pente est monotone à l'envers, et le mot EST le seul porteur de l'état (libellés `:25`).

**Ce que le joueur vit** — Le panneau parle fort quand il n'a rien à dire et chuchote quand il alarme : ÉTEINT, l'état qui appelle un geste, est le mot le plus effacé de la carte.

**Direction de correction** — Arbitrage d'Alexis : « éteint » doit-il se lire comme un manque (discret) ou comme une alerte (contrasté) ? Le registre « éteint = désaturé » engage la grammaire.

*`packages/client/src/scenes/ui/fire-panel.ts` · `packages/client/src/scenes/ui/hud-character.ts`*

### D7-12 · La LIGNE d'un palier de métier verrouillé est à 3,38:1 — la charge utile de l'onglet Métiers (la puce à 1,96 n'est qu'un remplissage)

`MAJEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-2026-08-20-annexe.md:168 (UI-04) · croiser D8-5 (même teinte #6f685a) et D7-10 (même teinte au Feu)

**Preuve** — `docs/audit-2026-08-20-annexe.md:168` (UI-04, majeur) : « Quatre couples texte/fond échouent au contraste WCAG AA, dont un à 1,96:1 », site cité `hud-character.ts:711` — exactement la puce ici mesurée. UI-04 n'a AUCUNE entrée détaillée (ni dans audit-complet, ni dans mineurs) : la ligne d'annexe est tout ce qui existe.

**Ce que le joueur vit** — L'onglet Métiers s'ouvre pour voir ce qui arrive ; les paliers à venir sont un texte gris sur brun. Correction du recenseur : pour un palier verrouillé la marque est « · » (`hud-character.ts:272`) — un remplissage. L'état est porté par l'EXTINCTION de la ligne.

**Direction de correction** — Citer UI-04 et lui apporter le déplacement de cible : c'est la ligne `.hch-mp.is-locked` (`:710`, #6f685a, 3,38) qu'il faut remonter au-dessus de 4,5 sur #16120d (`:692`), pas d'abord la puce.

**Vérification** — Vérifié littéral aujourd'hui : `.hch-mp.is-locked{color:#6f685a;}` à :710 et `.hch-mp.is-locked .hch-mp-mk{color:#4a453a;}` à :711 — donc UI-04, écrit ce matin, vise toujours la bonne ligne.

*`packages/client/src/scenes/ui/hud-character.ts`*

### D7-1 · L'encre `faint` tombe à 2,18:1 sur le voile du Feu posé sur la neige — et la garde ne mesure que des fonds OPAQUES

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — packages/client/src/scenes/ui/hud-core.ts:375-376 · docs/sprint-aaa.md:131 · docs/decisions.md:507 ②

**Preuve** — Le corpus nomme le fait et le PARQUE : `hud-core.ts:375-376` — « Le sort de faint, qui échoue au contraste WCAG partout ailleurs, est une question de palette réservée à Alexis » ; `docs/sprint-aaa.md:131` le range dans « File d'attente — décisions d'Alexis ». Incrément non couvert : la garde `palette.test.ts:88` boucle sur `[HEX.bgWarm, HEX.panel, HEX.bg]` — trois hex OPAQUES — alors que le porteur est un voile (`fire-panel.ts:287` `.fpn{…background:rgba(20,16,12,.72)}`, vérifié littéral aujourd'hui).

**Ce que le joueur vit** — Sur un névé, la ligne « E — FERMER » du panneau du Feu (`fire-panel.ts:314`) est du gris sur du gris. Ce n'est pas la seule sortie : `input-bindings.ts:670-673` rebascule le modal sur la même touche E — le rappel est redondant.

**Direction de correction** — Ne rien revendiquer : citer la file d'attente d'Alexis. La seule moitié technique disponible est d'alimenter la garde avec les alphas réels des voiles au lieu de trois hex opaques.

**Vérification** — Vérifié aujourd'hui : `.fpn` à fire-panel.ts:287 porte bien `rgba(20,16,12,.72)`, `.fpn-close` à :288, le texte à :314 ; palette.test.ts:88 boucle bien sur les trois hex opaques. ATTENTION : `sprint-aaa.md:131` est PÉRIMÉ — il parle encore de « faint #6f6a60 », valeur relevée à #8b8474 le 2026-07-24.

*`packages/client/src/scenes/ui/palette.test.ts` · `packages/client/src/scenes/ui/fire-panel.ts` · `packages/client/src/scenes/ui/hud-core.ts`*

### D7-2 · Aucun écran de production n'importe `HEX.faint` : la palette documente une valeur que dix fichiers recopient à la main

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-2026-08-20-annexe.md:173 · docs/audit-2026-08-20-mineurs.md:957-964 (UI-03) · docs/decisions.md:507 ③

**Preuve** — `docs/audit-2026-08-20-mineurs.md:961` (UI-03) mesure la même chose en plus large : « 366 occurrences de leur VALEUR littérale contre 15 références `HEX.<nom>` », dont « faint 31 / 1 », et pointe le même trou de garde (`palette.test.ts:39` `if (connues.has(teinte)) continue`). Son correctif (a) — « compter les littéraux ÉGAUX à un jeton, l'inverse du cas actuel » — est mot pour mot celui proposé ici.

**Ce que le joueur vit** — Rien à l'écran. Le risque est la dérive FUTURE : régler `HEX.faint` ne change aucun pixel.

**Direction de correction** — Rien à revendiquer : c'est UI-03, déjà instruit et déjà chiffré. La règle du mérite (`palette.test.ts:1-16`, `decisions.md:507` ③) refuse explicitement le refactor de masse — cette moitié revient à Alexis.

**Vérification** — Vérifié aujourd'hui : `grep -rn "HEX\.faint|INK\.faint" packages/client/src` ne rend que typography.ts:42 (ré-export), banc-son.ts (banc de dev) et palette.test.ts. Onze fichiers de `scenes/` portent le littéral #8b8474 (dont palette.ts) — donc dix écrans. Le récit du recenseur (« la correction du 24/07 n'a jamais atteint les écrans ») reste FAUX : `decisions.md:507` ② dit « Propagée aux 25 occurrences en dur », et `#6f6a60` n'existe plus nulle part en valeur vivante.

*`packages/client/src/scenes/ui/palette.ts` · `packages/client/src/scenes/ui/palette.test.ts`*

### D7-3 · La fabrique typographique gardée par `typography.test.ts` n'a plus d'appelant vivant : son unique consommateur est une fonction jamais montée

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-2026-08-20-annexe.md:176 · docs/audit-2026-08-20-mineurs.md:984-991 (UI-11) · croiser D8-10

**Preuve** — `docs/audit-2026-08-20-mineurs.md:984-991` (UI-11) établit exactement le même fait, avec la même vérification : « `createInventoryPanel` n'apparaît que dans son propre fichier (déclaration ligne 224 + une mention en commentaire ligne 210) », seules les fonctions pures restent importées (inventory-grid.ts:15, hud-character.ts:52). Incrément non couvert par UI-11 : ce mort est le SEUL consommateur de `SIZE` et `INK`, les deux tables que `typography.test.ts` protège en propre.

**Ce que le joueur vit** — Rien. C'est un défaut d'intégrité de garde : le test rassure sur un chemin mort.

**Direction de correction** — Citer UI-11 pour le code mort ; l'ajout propre est de porter la garde de l'échelle sur le chemin vivant (les templates CSS DOM) — ce que dit déjà D8-10.

**Vérification** — UI-11 est daté d'aujourd'hui et sa vérif est reproduite dans le fichier même. Rien n'a bougé depuis (aucun commit sur inventory-panel.ts entre-temps).

*`packages/client/src/scenes/ui/typography.ts` · `packages/client/src/scenes/ui/typography.test.ts` · `packages/client/src/scenes/ui/inventory-panel.ts`*

### D7-5 · La montée de niveau — la plus grosse récompense du HUD — est la seule ligne qui a perdu son liseré d'encre

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — cherché par « levelup », « lvl-skill », « text-shadow », « INK_OUTLINE », « NIVEAU » dans les 5 docs du corpus

**Preuve** — Vérifié littéral aujourd'hui : `hud-core.ts:391` `.hc-levelup .hc-lvl-skill{…color:#f4ecd2;text-shadow:0 0 10px rgba(232,198,106,.45),0 1px 0 #14141a;}` — la déclaration REMPLACE l'`INK_OUTLINE_STRONG` hérité de `.hc-toast` (:381). Rien dans le corpus (audit-complet, annexe, mineurs, decisions, gate1) ne mentionne le bandeau NIVEAU sous cet angle ; la seule entrée voisine, `sprint-aaa.md:140` (V1.1), en raconte la LIVRAISON.

**Ce que le joueur vit** — En clairière enneigée, le nom du métier (15 px gras) se délave dans la neige ; le « NIVEAU 3 » ambre voisin garde son liseré. Il perd QUEL métier, pas QUE quelque chose s'est passé — le fait a aussi une voix (`audio/sound.ts` `skill_level_up`).

**Direction de correction** — Concaténer `INK_OUTLINE_STRONG` avant la lueur dans la même déclaration. Point second : `.hud-board` (hud-dom.ts:66) ne pose aucun `text-shadow` par défaut.

*`packages/client/src/scenes/ui/hud-core.ts` · `packages/client/src/scenes/ui/hud-dom.ts`*

### D7-6 · Les deux lignes d'ALERTE du HUD (blessure, surcharge) perdent leur liseré parce que l'opacité .85 fond le sous-arbre entier

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — cherché par « hud-alpha », « opacity », « liseré », « blessure » dans le corpus

**Preuve** — Vérifié littéral : `hud-core.ts:362` `.hc{--hud-alpha:.85;}` et `:400` `.hc-bl{…opacity:var(--hud-alpha);z-index:10;}` ; `.hc-wounds` (:412) et `.hc-weight` (:411) sont dans ce sous-arbre. L'opacité de groupe fond le `text-shadow` avec le texte : #e05a4a contre son liseré fondu = 3,92 (5,01 à opacité 1). Aucun constat du corpus ne touche `--hud-alpha`.

**Ce que le joueur vit** — La mention rouge « JAMBE », 12 px à 85 % sur de l'herbe claire, est présente sans s'imposer ; il continue de courir et se demande plus tard pourquoi il est lent.

**Direction de correction** — Baisser l'opacité des SURFACES (disques, cases) et laisser texte + liseré à 1.

*`packages/client/src/scenes/ui/hud-core.ts`*

### D7-8 · Quatre cibles cliquables sont sous 24 px à la résolution de la maquette, treize le deviennent en 1280×720

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune dans le corpus · recouvre partiellement D7-7 (la croix) et D7-R3 (la boîte de 4 px)

**Preuve** — Les deux mesures robustes sont DÉCLARÉES et vérifiées aujourd'hui : `menu-dom.ts:826` et `pause-menu.ts:118` `::-webkit-slider-thumb{…width:14px;height:14px…}` ; `menu-dom.ts:829` `.op-reset-tout` n'a aucune hauteur. Les autres chiffres dérivent d'une avance de 0,6 em et d'un interlignage de 1,32 em non mesurés — réserve à conserver.

**Ce que le joueur vit** — Le curseur de volume est une pastille de 14 px (≈10 px sur un portable). Nuance : ce sont des `<input type=range>` NATIFS — un clic sur la piste pose la valeur, les flèches la règlent. Le geste est fastidieux, le verbe n'est pas perdu.

**Direction de correction** — Boîte explicite pour les deux glissières et la croix d'annulation ; plancher exprimé en px de maquette tenant compte du pire `k`.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/craft-queue.ts`*

### D7-11 · Les deux lignes de consolation du voile de mort tombent à 3,52 / 3,57 sur un monde clair à midi

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — le voile de mort n'apparaît dans le corpus que comme LIVRÉ (decisions.md, audit UI/UX P1, death-veil.ts:2)

**Preuve** — Vérifié littéral : `death-veil.ts:99` `.dv-learn{font-size:13px;color:#8a8172;…}` et `:100` `.dv-skills{…color:#6f8a70;…}` (et non :98/:99 comme le réfuteur l'écrivait). La lueur `.dv-glow` (`:89-90`, ellipse ancrée en pied, transparente à 68 %) ne passe PAS derrière la carte centrée : le « jamais 4,5, même sur du void à minuit » est réfuté (4,81 / 4,88 sur le fond le plus sombre). Reste : 3,52 et 3,57 sur monde clair, sans liseré.

**Ce que le joueur vit** — Il vient de mourir. Les deux lignes qui disent « ce n'est pas grave, tu n'as rien perdu » sont les moins lisibles de l'écran, et le voile dure 3,2 s.

**Direction de correction** — Hiérarchiser trois lignes de consolation par la taille et l'espacement, pas en descendant sous le seuil. `death-veil.ts:1-22` arbitre explicitement le registre : remonter ces encres change ce que la mort dit → Alexis.

*`packages/client/src/scenes/ui/death-veil.ts`*

### D7-13 · Quarante encres de texte pour quatre rangs déclarés — dont cinq paires qui font le même travail avec deux valeurs différentes

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — chevauche D8-4 sur 3 paires (#e6ddc8, #f4ecd2, #8a8172) — non fusionné : D8-4 vise les jetons INTERNES à la palette, celui-ci les encres d'écran

**Preuve** — Le mécanisme est réel et vérifié : `palette.test.ts:26` `SEUIL_PARTAGE = 3` — une teinte présente dans un ou deux fichiers échappe par construction à la garde. UI-03 (mineurs:961) nomme la même cécité par les FICHIERS mais compte les recopies de jetons NOMMÉS, pas les quasi-doublons anonymes : angle distinct.

**Ce que le joueur vit** — Rien de nommable : quatre rangs d'encre annoncés, dix-huit gris à l'écran. Le gris « en retrait » du menu n'est pas celui de l'écran personnage.

**Direction de correction** — Une garde de PROXIMITÉ (aucune encre à moins de N de distance RVB d'un jeton sans être ce jeton). Combien de rangs l'encre doit compter reste un choix de direction.

*`packages/client/src/scenes/ui/palette.ts` · `packages/client/src/scenes/ui/palette.test.ts`*

### D7-R1 · Les numéros de ligne du tableau des 244 paires sont systématiquement faux : 32 citations sur 56 désignent la mauvaise ligne

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — méta-constat sur l'instrument du lot ; à lire avec docs/audit-ux-2026-08-20.md § P-1 (« LES INSTRUMENTS MENTENT »)

**Preuve** — Contrôle indépendant aujourd'hui sur ~25 citations : toutes les lignes CORRIGÉES par le réfuteur sont exactes (fire-panel.ts:26/:80/:290/:294/:316, craft-queue.ts:38/:39/:93, hud-core.ts:362/:381/:391/:400, hud-character.ts:593/:659/:665/:707/:710/:711, menu-dom.ts:641/:826/:829, pause-menu.ts:117/:118, palette.test.ts:26/:88, typography.test.ts:85) ; toutes les lignes brutes du recenseur issues de l'extracteur CSS sont décalées de +1 à +6. J'ai trouvé DEUX corrections du réfuteur elles-mêmes fausses : `.dv-learn` est à death-veil.ts:99 (pas :98) et `.dv-skills` à :100 (pas :99).

**Ce que le joueur vit** — Rien — défaut d'instrument. Mais dans un dépôt où la citation est la seule preuve admise, une table dont la majorité des adresses tombent à côté invite au verdict « la ligne a bougé → RÉFUTÉ » sur des constats dont le fond est exact.

**Direction de correction** — L'extracteur doit reporter le numéro ABSOLU du fichier source, pas un rang dans le bloc `<style>`. Et une passe d'auto-vérification (chaque citation contient littéralement la sous-chaîne annoncée) avant restitution.

*`packages/client/src/scenes/ui/death-veil.ts` · `packages/client/src/scenes/ui/catalogue.ts` · `packages/client/src/scenes/ui/build-menu.ts` · `packages/client/src/scenes/ui/menu-dom.ts`*

### D7-R2 · Les quatre textes Phaser du tableau sont comptés SANS leur contour, alors que tous déclarent `strokeThickness: 3`

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — correction interne au lot, à appliquer AVANT de publier le tableau des 244 paires

**Preuve** — Vérifié littéral aujourd'hui : `chat-panel.ts:30` `{ fontFamily: FONT, fontSize:'14px', color:'#e8e0c8', stroke:'#14141a', strokeThickness: 3 }` (réutilisé à `:61`), `slot-view.ts:73-78` (13 px GRAS, pas 14 comme annoncé par le tableau), `fatal.ts:41-46` (16 px, sur un fond opaque). L'atténuation ne balayait que `INK_OUTLINE`, la constante DOM.

**Ce que le joueur vit** — Rien de neuf — ces lignes sont MIEUX loties que le tableau ne le dit. Le coût est sur la lecture du recensement, qui gonfle son compte d'échecs de trois paires détourées.

**Direction de correction** — L'atténuation doit balayer les deux mécanismes : `INK_OUTLINE`/`_STRONG` côté DOM et le couple `stroke`+`strokeThickness` côté Phaser. Pas de ratio pour le cas détouré : Phaser centre le trait et le canvas est ensuite `Scale.FIT` — ça se mesure.

*`packages/client/src/scenes/ui/chat-panel.ts` · `packages/client/src/scenes/ui/slot-view.ts` · `packages/client/src/scenes/ui/fatal.ts`*

### D7-R3 · Les deux glissières de volume déclarent `height:4px` sur l'`<input>` lui-même et tuent l'anneau de focus sans rien mettre à la place

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — grep « focus-visible », « au clavier », « accessibilité » sur docs/ : rien (le rôle `ui-access` existe, .claude/agents/ui-access.md, mais ne couvre pas le focus)

**Preuve** — Vérifié aujourd'hui : `menu-dom.ts:825` `.op-vol{…height:4px;background:#3a3225;border-radius:2px;outline:none;}` et `pause-menu.ts:117` idem en `width:280px`. Et `grep -n "op-vol\|pm-vol"` sur les deux fichiers ne rend AUCUNE règle `:focus` ni `:focus-visible` — alors que menu-dom.ts:711/:728/:760 en posent une franche pour ses autres contrôles.

**Ce que le joueur vit** — Au clavier, il tabule jusqu'à la glissière : l'élément a le focus et ne le dit pas. À sa décharge, les deux portent `aria-label="Volume"` (menu-dom.ts:514, pause-menu.ts:143).

**Direction de correction** — Une boîte explicite pour l'organe (piste peinte en fond, hauteur ≥ 24 px de maquette) et une règle `:focus-visible` sur les deux glissières. Réserve : la surface de capture réelle de la pastille n'est pas mesurée — Chromium laisse le `::-webkit-slider-thumb` déborder.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

### D7-R4 · Le jeu tourne à DEUX polices — `monospace` pour tout le texte Phaser, JetBrains Mono pour tout le DOM — et la garde écrite exprès ne compare jamais les deux

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — docs/decisions.md:494 et docs/sprint-aaa.md « V2.1 » — le corpus a déclaré « un jeu à DEUX polices » CORRIGÉ, mais sur le seul axe DOM

**Preuve** — Vérifié : `typography.ts:20` `export const FONT = 'monospace'` (mot-clé générique) contre `game-font.ts:19` `export const GAME_FONT = "'JetBrains Mono',ui-monospace,monospace"`, dont le `@font-face` (:28-30) déclare la famille nommée. `FONT` peint le chat, les noms de lieux, les chiffres de dégât, le compte du fantôme de pose ; `GAME_FONT` la planche du HUD (hud-dom.ts:68) et les six voiles DOM.

**Ce que le joueur vit** — Le chat s'écrit dans la police à chasse fixe du système à côté d'un HUD en JetBrains Mono. Non rendu : la différence visuelle dépend de la police mono par défaut de l'hôte.

**Direction de correction** — `FONT` devrait valoir la même pile que `GAME_FONT`, et la garde gagner une assertion : les deux constantes désignent la même famille en tête de pile.

**Vérification** — Vérifié aujourd'hui que la correction de juillet TIENT : les six voiles DOM importent bien `ensureGameFont`+`GAME_FONT` (death-veil:25, pause-menu:14, season-veil:31, menu-dom:39, loading:17, build-stamp:16, hud-dom:18). Les deux gardes neuves de V2.1 (« tout écran monté sur body pose la police du jeu », « la police DOM n'est nommée que dans game-font.ts ») ne peuvent structurellement pas voir l'axe Phaser. Le défaut n'est donc pas une régression : c'est la moitié jamais traitée.

*`packages/client/src/scenes/ui/typography.ts` · `packages/client/src/scenes/ui/game-font.ts` · `packages/client/src/scenes/ui/typography.test.ts`*

### D7-15 · Le liseré d'encre devient sous-pixel exactement quand le texte est le plus petit

`COSMÉTIQUE` · `technique` · `SUSPECTÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — dépend de D7-9 (le régime d'échelle)

**Preuve** — Prémisse vérifiée : `hud-dom.ts:80` `INK_OUTLINE` pose 1 px et `:81-82` `INK_OUTLINE_STRONG` 1,5 px, en px de MAQUETTE, multipliés par `k` (`:44`). Mécanisme NON mesuré : c'est un `transform:scale()`, le navigateur rastérise APRÈS — le liseré devient plus MINCE, pas nécessairement plus pâle, et reste ≥ 1 px physique à `devicePixelRatio ≥ 2`.

**Ce que le joueur vit** — Hypothèse : sur petit écran et fond clair, la ligne de lieu et l'heure se délavent plus que la maquette ne le laisse croire.

**Direction de correction** — À mesurer par `pnpm smoke --scenario` en clairière enneigée, fenêtre forcée à 1280×720, en relevant les pixels du glyphe et de son bord. Ne pas coder avant.

*`packages/client/src/scenes/ui/hud-dom.ts` · `packages/client/src/scenes/ui/hud-core.ts`*

### D7-16 · La mention de version, posée sur la vitrine du menu, retombe à 1,35:1 quand la photo qui passe dessous est claire

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — le commentaire menu-dom.ts:636-640 raconte une correction PRÉCÉDENTE (#3a3a44) ; c'est de l'histoire, pas une couverture

**Preuve** — Vérifié littéral aujourd'hui, en lisant le CODE et pas le commentaire : `menu-dom.ts:641-642` `.bm-version{position:absolute;bottom:24px;right:28px;font-size:11px;letter-spacing:1px; color:rgba(230,217,196,.42);text-shadow:0 1px 3px rgba(0,0,0,.85);}` — l'alpha .42 est bien vivant, donc la teinte dépend du fond. Elle est posée sur `.bm-vitrine` (`:656`), dont l'assombrissement de pied (`:663`) s'éteint en remontant.

**Ce que le joueur vit** — Au menu, le numéro de build est illisible sur trois captures sur cinq, puis redevient lisible quand la vue change.

**Direction de correction** — Une plaque semi-opaque derrière le mot, ou le déplacer sur le rail. Une ombre floue de 3 px ne détoure pas du 11 px — c'est le liseré net du HUD qu'il faut.

*`packages/client/src/scenes/ui/menu-dom.ts`*

---

## D8 — Dérive des teintes et des tokens  *(13 constats)*

### D8-5 · Trois encres anonymes portent une phrase sous AA — et la pire (#6b6558) est plus sombre que le gris retiré quatre jours plus tôt pour cette raison exacte

`MAJEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-2026-08-20-annexe.md:168 (UI-04) · docs/audit-2026-08-20-mineurs.md:961 (UI-03) · docs/decisions.md:507 ② (la leçon)

**Preuve** — UI-04 (annexe:168) nomme la famille (« Quatre couples texte/fond échouent au contraste WCAG AA »), et UI-03 (mineurs:961) nomme #6b6558 comme invisible à la garde — mais AUCUN des deux ne mesure ses cinq sites. Ratios : #6b6558 3,27/2,96/3,38 (menu-dom.ts:769, 775, 788, 844, 864, tous vérifiés littéraux) · #6f685a 3,43/3,10/3,55 (hud-character.ts:710) · #8a8172 4,93/4,45/5,10 (death-veil.ts:99).

**Ce que le joueur vit** — Les intitulés de section de l'écran des touches sont les plus effacés de la page ; l'invite du champ de nom de vallée se lit à peine ; un palier de maîtrise verrouillé n'est pas discret, il est illisible.

**Direction de correction** — Ramener les trois sur `HEX.faint #8b8474`, dont le ratio est déjà calculé et gardé. Pour la puce `#4a453a` et la flèche `#6b5a3a` (fire-panel.ts:307), viser 3:1 (WCAG 1.4.11) par calcul, pas à l'œil.

**Vérification** — LE CODE CONTREDIT LE JOURNAL, vérifié moi-même par `git blame`. `decisions.md:507` ② (2026-07-24) écrit : « Valeurs CALCULÉES, pas choisies à l'œil […] la régression qu'on vient de corriger ne peut plus revenir ». Les cinq lignes #6b6558 de menu-dom.ts (:769, :775, :788, :844, :864) sont datées du 2026-07-28 (commits 2be097b3, bca2ce67, a080337c, 9a961fbe) — QUATRE JOURS après, à 3,27/2,96, strictement pire que le 3,52/3,19 qui avait motivé le retrait de #6f6a60. La garde ne pouvait pas le voir : elle ne teste que `HEX.faint`.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/death-veil.ts` · `packages/client/src/scenes/ui/fire-panel.ts`*

### REF-1 · Le même palier de charge est peint de trois façons dans trois écrans, sous un commentaire qui renvoie à un fichier qui n'existe pas

`MAJEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-2026-08-20-annexe.md:169 (UI-05) · docs/audit-2026-08-20-mineurs.md:989 (UI-11) · croiser D8-6

**Preuve** — Le corpus le porte DEUX fois : `annexe:169` (UI-05, majeur) « Le poids porté s'affiche deux fois à l'écran, en deux couleurs et deux formats différents », site `hud-character.ts:60` ; et `mineurs:989` (UI-11) qui nomme la troisième — « ces lignes portent une TROISIÈME table `TIER_COLOR`/`TIER_LABEL` divergente (voir UI-05) ». Les trois tables : hud-character.ts:60-65, inventory-panel.ts:176-181, hud-core.ts:48-53.

**Ce que le joueur vit** — LÉGER est vert sur l'écran perso, gris-bleu au HUD et sur la barre du sac ; MOYEN prend trois valeurs. Le mot le rattrape à chaque fois, la couleur ne lui apprend rien de transférable.

**Direction de correction** — Citer UI-05 + UI-11. L'apport neuf est le renvoi mort à corriger dans le même geste ; et si le vert de `light` doit survivre, il tombe dans la question de design D8-6.

**Vérification** — Vérifié aujourd'hui : `TIER_COLOR` est bien à hud-character.ts:60-65 avec `light: '#8a9a4a'` ; et `ls packages/client/src/scenes/ui/vitals.ts` → « No such file or directory », alors que `inventory-panel.ts:173` promet « les mêmes que le médaillon de poids (vitals.ts) ». Le référent nommé n'existe plus : c'est un commentaire périmé, pas une preuve — et personne dans le corpus ne l'avait relevé.

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/inventory-panel.ts` · `packages/client/src/scenes/ui/hud-core.ts`*

### D8-1 · La palette est recopiée à la main dans 21 écrans (513 couleurs, 444 recopies exactes)

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/gate1-finition.md:61 · docs/sprint-aaa.md:130 · docs/audit-2026-08-20-mineurs.md:957-964 (UI-03) · croiser D7-2 et D8-2 (trois mécanismes distincts du même trou)

**Preuve** — Trois entrées du corpus disent ce constat, dont une nomme déjà le correctif proposé : `gate1-finition.md:61` — « TOUS les overlays DOM […] codent les teintes de palette.ts EN DUR dans leurs `<style>` inline […] Le bon niveau (consensus des 3 agents) : injecter des CSS custom properties depuis palette.HEX une fois » ; `sprint-aaa.md:130` le range en « File d'attente — décisions d'Alexis (≈250 hex en dur) » ; UI-03 (mineurs:957-964) le rechiffre à 366 littéraux.

**Ce que le joueur vit** — Rien tant que personne ne règle une teinte — le recenseur l'écrit lui-même.

**Direction de correction** — Aucune revendication possible : le silence est DÉCIDÉ, pas subi (« Je ne l'ai PAS fait : ça touche death-veil/menu-dom, ta grammaire »). Les nombres neufs (513 / 444 / 27 des 30 jetons recopiés) sont le seul apport.

**Vérification** — Le chantier est toujours ouvert : aucun helper de custom properties n'existe (`grep ":root{--"` sur scenes/ui : rien), et les 21 écrans portent encore leurs littéraux.

*`packages/client/src/scenes/ui/palette.ts` · `packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/hud-character.ts`*

### D8-2 · Le garde-fou de la palette ne voit qu'une forme d'écriture sur deux : 100 occurrences lui échappent, et deux teintes anonymes ont déjà passé son seuil

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/audit-2026-08-20-annexe.md:173 · docs/audit-2026-08-20-mineurs.md:961+964 (UI-03, filé mineur)

**Preuve** — Le titre appartient déjà à UI-03 (« et le garde-fou ne peut pas le voir », annexe:173), dont la vérif détaille DEUX trous : `palette.test.ts:39` `if (connues.has(teinte)) continue` (aucune teinte nommée n'est comptée) et le seuil par FICHIERS — « `#6b6558` répété cinq fois dans le seul menu-dom.ts lui est également invisible ». INCRÉMENT non couvert par UI-03 : la cécité de FORME (la regex `/#([0-9a-fA-F]{6})\b/g` de `palette.test.ts:38` ne lit ni `rgba()`, ni `#rgb`, ni `#rrggbbaa` — 100 des 513 occurrences) et le faux positif sur les commentaires.

**Ce que le joueur vit** — Rien directement : c'est l'instrument qui ment. La dérive se paiera plus tard, sur deux écrans côte à côte.

**Direction de correction** — Normaliser toutes les formes en `#rrggbb` avant de compter, et masquer les commentaires. Sur le glob RÉEL (`palette.test.ts:20` `import.meta.glob('../../**/*.ts')` = tout `src/`), un garde élargi désignerait trois teintes : #000000, #28221a, #e6d9c4 — qui élargit doit décider si `render/` et `world/` restent dans la portée.

**Vérification** — Vérifié aujourd'hui : `palette.test.ts:20` glob sur `../../**/*.ts`, `:26` `SEUIL_PARTAGE = 3`, `:38` la regex hex-6, `:39` le `continue`. Rien n'a été élargi depuis UI-03.

*`packages/client/src/scenes/ui/palette.test.ts` · `packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/season-veil.ts`*

### D8-3 · Trois rouges de rang alerte — mais #d9614f PORTE un nom (`BAD_TINT`) et une doctrine

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — docs/gate1-finition.md:61 · docs/sprint-aaa.md:130

**Preuve** — `docs/gate1-finition.md:61` l'écrit littéralement : « La dérive est déjà là (3 rouges pour un accent unique) » ; `docs/sprint-aaa.md:130` le range dans la file d'attente d'Alexis (« 2 ambres + 3 rouges divergents »). Le comptage (#e05a4a 20 occ. · #d9614f build-menu.ts:204 · #d5624a refugee-prompt.ts:38) est l'apport neuf — personne n'avait compté.

**Ce que le joueur vit** — Trois rouges légèrement différents pour « ceci bloque / ceci détruit ». Isolément chacun se lit ; l'accent d'alerte perd sa netteté.

**Direction de correction** — NE PAS unifier par décret : `#d9614f` est `BAD_TINT`, exporté et documenté (`scenes/world/build-ghost.ts:39`, doctrine :28-37), et explicitement OPPOSÉ à `DEMOLISH_TINT` (`snapshot-view.ts:125-129`, « MESURÉ au navigateur »). Unifier change ce que trois couches disent au joueur → Alexis.

*`packages/client/src/scenes/ui/build-menu.ts` · `packages/client/src/scenes/ui/refugee-prompt.ts` · `packages/client/src/scenes/world/build-ghost.ts`*

### D8-4 · Quatre valeurs anonymes sont des fautes de frappe de jeton — mais `wearTrack`/`controlRail` est une distinction ÉCRITE et assumée

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune dans le corpus · chevauche D7-13 sur 3 des paires

**Preuve** — Six paires à |Δ| ≤ 3 par canal, dont quatre anonymes voisines d'un jeton : `#e6ddc8` (death-veil.ts:96), `#f4ecd2` (hud-character.ts:686, :708 ; hud-core.ts:391), `#8a8172` (death-veil.ts:99), `#17151a` (hud-character.ts:650) — les cinq citations vérifiées littérales aujourd'hui. Rien dans le corpus ne compte les quasi-doublons ; UI-03 ne compte que les recopies EXACTES.

**Ce que le joueur vit** — Rien : l'écart est sous le seuil de perception. C'est le problème — quatre valeurs vivent comme des jetons fantômes.

**Direction de correction** — Remplacer les quatre anonymes par leur voisin nommé. NE PAS toucher à `bgWarm`/`panelWarm` ni `wearTrack`/`controlRail` : `palette.ts:86-92` tranche déjà par écrit (« Cousine de wearTrack […] même famille, deux rôles, deux noms »).

*`packages/client/src/scenes/ui/death-veil.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/hud-core.ts` · `packages/client/src/scenes/ui/palette.ts`*

### D8-6 · Un vert non nommé sert de troisième accent sur 3 sites — et le catalogue dit la même chose en ambre

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — D8-6 + D7-14 fusionnés · le mécanisme d'échappement est nommé par UI-03 (mineurs:964) : `#8a9a4a` = `VITAL_HEX.hunger.fill` (palette.ts:99), or `connues` n'est bâti que sur `Object.values(HEX)`

**Preuve** — Charte : `palette.ts:11-13` « ENCRE + 2 ACCENTS, jamais plus ». Sites vérifiés littéraux : `hud-character.ts:659` `.hch-rec-state{…color:#8a9a4a}` (recette disponible), `:707` `.hch-mp.is-done .hch-mp-mk{color:#8a9a4a}` (palier franchi), `chat-panel.ts:88` `#cfe6a0` (mes messages), `death-veil.ts:100` `#6f8a70` (compétences gagnées). Face à eux, `catalogue.ts:207` peint FAISABLE en ambre `#c98b3a` et `:205` MANQUANT en rouge (apport de D7-14).

**Ce que le joueur vit** — Deux écrans, la même question (« puis-je le faire ? »), deux langues : vert/rouge sur l'écran personnage, ambre/rouge au catalogue. Le contraste est bon (5,55 à 6,35) : le problème est le SENS.

**Direction de correction** — Une seule question à Alexis : le vert entre-t-il dans la charte comme troisième accent (et le catalogue l'adopte), ou « ce qui va bien » appartient-il à l'ambre (et les sites y passent) ? RETIRER deux faux sites : `hud-character.ts:60-65` (`TIER_COLOR`, un DÉGRADÉ de charge) et `fire-panel.ts:262,265` (un code de COLONNE entrée/sortie).

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/catalogue.ts` · `packages/client/src/scenes/ui/chat-panel.ts` · `packages/client/src/scenes/ui/death-veil.ts`*

### D8-7 · La charte dit que le gel est « le froid » ; le code s'en sert pour « verrouillé », et un des deux écrans ne le dit nulle part

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — le rôle « gel = accent conditionnel » est répété dans .claude/agents/ui-access.md sans mention de l'usage réel

**Preuve** — Vérifié littéral : `palette.ts:64` `gel: '#6f93a0', // accent conditionnel : le froid` ; `hud-character.ts:665` `.hch-rec-off.hch-rec-verrouille .hch-rec-state{color:#6f93a0;}` avec sa justification aux :661-664 ; `catalogue.ts:208` `.cat-l.cat-verrouille .cat-etat{color:#6f93a0;}` sans un mot. Deux faits neufs vérifiés aujourd'hui : `grep -rn "HEX\.gel" packages/client/src` ne rend RIEN (zéro consommateur), et le rôle « froid » est tenu par un autre jeton de même valeur, `VITAL_HEX.temperature.fill` (palette.ts:100).

**Ce que le joueur vit** — Rien de cassé : le rouge « il te manque du bois » et le gel « il te manque un atelier » se distinguent bien. Le risque est qu'un lecteur croie la teinte réservée au froid et invente une autre couleur pour « verrouillé ».

**Direction de correction** — Amender la docstring de `gel` pour décrire le rôle réellement tenu (le CONDITIONNEL), et reporter une ligne de justification au-dessus de `catalogue.ts:208`.

*`packages/client/src/scenes/ui/palette.ts` · `packages/client/src/scenes/ui/catalogue.ts` · `packages/client/src/scenes/ui/hud-character.ts`*

### D8-8 · Treize opacités d'ambre, et quatre pour le survol d'un cliquable

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — croiser D8-2 (`rgba(40,34,26,.4)` dans 3 fichiers échappe à la garde par la FORME)

**Preuve** — `#c98b3a` apparaît à 13 opacités distinctes, `#14100c` à 8. Les six survols sont dans un seul fichier : `menu-dom.ts:711` (.1), `:728` (.1), `:739` (.08), `:760` (.1), `:793` (.14), `:857` (.12) — et ce ne sont pas deux familles d'éléments : `.bm-entree`, `.bm-tuile`, `.op-touche`, `.mw-de` sont tous des `<button>`. Rien dans le corpus ne compte les alphas.

**Ce que le joueur vit** — Amplitude NON instrumentée : composite sur le fond du menu (#0f0b08), .08 → rgb(30,21,12) et .14 → rgb(41,29,15), soit 11 niveaux de rouge entre les extrêmes et 4 entre .1 et .12. Que l'œil l'enregistre est une hypothèse, pas une mesure.

**Direction de correction** — Une seule opacité pour « survol d'une surface cliquable », une seule pour « armée/sélectionnée », nommées une fois (un `WASH` frère de `HEX`). Ce qui va bien et doit rester : le bouton PLEIN est uniforme à `rgba(232,198,106,.24)` sur quatre écrans, le FANTÔME à `rgba(40,34,26,.4)` sur trois.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/season-veil.ts`*

### D8-9 · La grammaire de mouvement : le fondu porte sept durées, quand le survol en tient une seule sur 28 règles

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune · dépend de REF-3 (deux des sept fondus ne durent aucune des durées écrites)

**Preuve** — 12 durées CSS distinctes / 46 occurrences, 5 courbes / 49, zéro `cubic-bezier`. Croisé par propriété : `opacity` → 7 durées (100/180/200/300/400/600/700), `transform` → 600 ms seul, teinte → 120 ms sur 28 déclarations (le rang sain). Rien dans le corpus ne mesure les durées ; la seule entrée voisine est `decisions.md` V1.6 / `index.html:32-38`, qui pose le reset `prefers-reduced-motion`.

**Ce que le joueur vit** — Un panneau s'efface en 100 ms, un autre en 400, un voile en 700 : l'interface ne répond pas deux fois pareil.

**Direction de correction** — Trois durées nommées (geste bref ~120 ms déjà tenu, panneau ~200, voile ~600). RÉSERVE : « 7 durées » est un PLANCHER — le scan ne lit que les littéraux et rate `death-veil.ts:68` `DEATH_FADE_MS = 550` et `loading.ts:66` `FADE_MS = 420`, interpolés dans le CSS. Le vrai compte est ≥ 9. À faire APRÈS REF-3.

*`packages/client/src/scenes/ui/hud-core.ts` · `packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/season-veil.ts` · `packages/client/src/scenes/ui/death-veil.ts`*

### D8-10 · L'échelle typographique est gardée sur sa propre table, pas sur son usage : quatre tailles déclarées, vingt dans le CSS

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — D8-10 + D7-4 fusionnés · dépend de D7-3 (`SIZE`/`INK` n'ont plus de consommateur vivant, cf. UI-11)

**Preuve** — `typography.ts:52` `SIZE = { title:15, body:14, label:12, small:11 }` ; la garde est `typography.test.ts:85` `expect(Object.keys(SIZE)).toHaveLength(4)` — vérifié à cette ligne aujourd'hui : elle compte les clés de l'objet et ne lit jamais le CSS, alors que les trois autres tests du même fichier passent par `import.meta.glob`. Mesure : 20 `font-size` distinctes / 131 occurrences (dont deux demi-pixels : refugee-prompt.ts:33, pause-menu.ts:111) ; letter-spacing 9 ; gap 14 ; padding 40 déclarations pour 46 occurrences. Rien dans le corpus ne mesure la typographie d'usage.

**Ce que le joueur vit** — Deux titres de section voisins font 15 et 17 px ; le rythme vertical ne retombe jamais sur la même grille. L'interface a l'air faite à la main plutôt que composée.

**Direction de correction** — Ajouter au fichier de garde un cas qui relève les `font-size` des `<style>` par le même `import.meta.glob`, le voir ROUGE, puis élargir `SIZE` à ce qu'elle doit vraiment couvrir. Combien de rangs et lesquels : arbitrage de direction. Ce qui va bien, à ne pas casser : border-radius 2 valeurs, épaisseurs de trait 3, graisse 2.

*`packages/client/src/scenes/ui/typography.ts` · `packages/client/src/scenes/ui/typography.test.ts` · `packages/client/src/scenes/ui/refugee-prompt.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

### REF-3 · Deux horloges sur un même fondu : le CSS et le JavaScript pilotent l'opacité du même élément avec des durées différentes

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — l'indicateur de sauvegarde est dans le corpus comme LIVRÉ (decisions.md:493, sprint-aaa V1.7) ; ce couplage n'y est pas

**Preuve** — Vérifié littéral aujourd'hui, les six lignes : `hud-core.ts:377` `.hc-save{…transition:opacity .4s ease;}` contre `:181` `const SAVE_FADE_MS = 700` appliqué à `:258` ; `:381` `.hc-toast{…transition:opacity .3s ease;}` contre `:177` `const FADE_MS = 500` appliqué à `:341`. Une opacité réécrite chaque frame sur un élément qui porte une `transition` fait poursuivre la cible par le moteur CSS. Non rendu à l'écran.

**Ce que le joueur vit** — Non mesuré optiquement. Côté code : deux des sept fondus ne durent aucune des durées écrites, et personne ne peut prédire leur temps de réponse en lisant le CSS.

**Direction de correction** — Une horloge par fondu : soit transition CSS + bascule de classe, soit pilotage JS sans `transition:opacity`. À faire AVANT l'échelle de durées de D8-9, sinon l'échelle nommera des valeurs inertes. Noter : `index.html:32-39` écrase `transition-duration` en `!important` sous `prefers-reduced-motion` — il neutralise la moitié CSS et laisse la moitié JS tourner.

*`packages/client/src/scenes/ui/hud-core.ts` · `packages/client/index.html`*

### REF-4 · L'encre par défaut des deux premiers écrans du jeu est un blanc FROID anonyme, recopié d'un fichier à l'autre

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — aucune — croiser D8-2 (une teinte à 2 fichiers échappe au seuil de mérite)

**Preuve** — Vérifié aujourd'hui : `grep -rn "e4ebef"` sur `packages/client/src` ne rend que deux lignes, `menu-dom.ts:626` et `loading.ts:180`, toutes deux `background:#0f0b08;color:#e4ebef;` — deux fichiers, donc sous `SEUIL_PARTAGE = 3` : la garde est muette par construction. La teinte n'existe nulle part dans `palette.ts`, dont l'encre est la crème chaude `body #e8e0c8` (:58).

**Ce que le joueur vit** — Rien de démontré : tous les éléments porteurs de texte de ces deux écrans posent leur propre `color`. Ce qui est établi, c'est la racine de cascade — soit deux déclarations mortes, soit tout futur élément qui oubliera sa couleur naîtra bleu sur les écrans d'accueil.

**Direction de correction** — Ne se tranche pas par un agent : c'est le TON du premier écran. Soit les deux `color:` sont mortes et s'alignent sur `HEX.body`, soit l'accueil parle volontairement froid avant que le feu ne prenne — et la teinte gagne son nom.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/loading.ts` · `packages/client/src/scenes/ui/palette.ts`*

---

## D9 — Panneaux  *(25 constats)*

### D9-1 · Les trois boutons des réfugiés (RECRUTER / NOURRIR / DÉPOUILLER) n'ont aucun pointeur : la fenêtre paraît, aucun clic ne l'atteint

`BLOQUANT` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. MAIS DOC PÉRIMÉ À SIGNALER : `docs/gate1-finition.md:77` affirme un double-envoi observé sur `fire-upgrade-prompt`, `found-village-prompt` et `refugee-prompt` — les deux premiers FICHIERS N'EXISTENT PLUS (`ls packages/client/src/scenes/ui/` ; `UIScene.ts:236-238` dit que le modal du Feu les remplace), et le troisième a des boutons qui ne peuvent pas recevoir un clic. Le doc dit lui-même l.75 « vérifiés à la lecture du code » : le double-envoi a été déduit, jamais observé.

**Preuve** — Chaîne revérifiée par moi : `UIScene.ts:236` monte bien `createRefugeePrompt(this.hudRoot.board, …)` sur la planche `.hud-board{…pointer-events:none}` (`hud-dom.ts:66-67`) ; `refugee-prompt.ts:24-54` ne pose `pointer-events` qu'une fois, `none` sur le halo (l.28) ; les écouteurs sont attachés aux `<button class="rfp-btn">` eux-mêmes (l.64-76), pas à un ancêtre. `grep -rn "pointerEvents" packages/client/src` (orthographe JS, que le réfuteur n'avait pas balayée) → 0 résultat.

**Ce que le joueur vit** — La fenêtre des réfugiés se lève avec ses trois verbes ; aucun clic ne passe, même le survol ne réagit. Le seul dilemme d'alignement à trois voies de la Veillée se solde toujours par « refouler », par défaut.

**Direction de correction** — `hud-click` sur les trois boutons (ou `pointer-events:auto` sur `.rfp-panel`), et rendre la règle non-oubliable : c'est le seul des 6 panneaux montés sur `board` sans racine `auto`.

**Vérification** — Le garde anti-double-envoi, lui, est bien encore en place (`refugee-prompt.ts:63` `createPromptGate()`) — c'est un autre défaut que celui-ci.

*`packages/client/src/scenes/ui/refugee-prompt.ts` · `packages/client/src/scenes/ui/hud-dom.ts` · `packages/client/src/scenes/UIScene.ts`*

### D9-2 · Le modal du Feu affiche « E — FERMER » alors que la touche est F

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent des trois audits du 2026-08-20 et de gate1-finition. Le journal explique pourquoi l'étiquette est un fossile : `docs/decisions.md:635` (2026-07-30) donne `E` à la rotation d'arête, et `:704` (2026-08-03) parle de l'interaction « touche F par défaut ». Le commentaire `UIScene.ts:94` (« ouvert à E ») est périmé de la même date — c'est un commentaire, pas une preuve.

**Preuve** — Chaînes relues aujourd'hui, non pas citées : `grep -n "FERMER"` → `fire-panel.ts:314` `<div class="fpn-close">E — FERMER</div>` et `hud-character.ts:719` `<div class="hch-close">TAB — FERMER</div>`, tous deux écrits en dur. La touche réelle est `keymap.ts:75` `forage: ['F']`, et c'est le handler `onDownAlways(TOUCHES.forage, …)` (`input-bindings.ts:670-675`) qui referme.

**Ce que le joueur vit** — Il ouvre le Feu avec F, lit « E — FERMER », presse E : rien ne se ferme. Le `.fpn-close` est un `<div>` sans écouteur, il n'y a donc pas de porte de secours au clic. Après un rebind, les deux étiquettes mentent.

**Direction de correction** — Dériver les deux étiquettes de `keymapEffectif()` comme le tableau du menu pause le fait déjà (`pause-menu.ts:19-26`).

**Vérification** — Vérifié que le libellé n'a PAS été corrigé aujourd'hui malgré la passe récente sur `hud-character` : les deux chaînes sont intactes au 2026-08-20.

*`packages/client/src/scenes/ui/fire-panel.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/world/keymap.ts`*

### D9-3 · Les refus de glisser-déposer (case invalide, hors ceinture) sont peints sous le panneau opaque qui les a provoqués

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Aucun des 235 constats du 2026-08-20 ne touche la profondeur des canaux texte (`grep` sur annexe + mineurs : rien sur `errorText`/`hintText`). Voisin de D9-13, qui porte la moitié « aucune cible ne s'allume ».

**Preuve** — `UIScene.ts:279-285` crée `errorText` sans `setDepth` (profondeur 0, sur le canvas), idem `hintText` l.290-293 ; le canvas est sous `.hud-overlay{z-index:40}` (`hud-dom.ts:65`) et `.hch{position:absolute;inset:0;background:#14100c}` est opaque plein cadre (`hud-character.ts:562`). Périmètre resserré par le réfuteur : ce qui est vraiment muet, ce sont les refus de `sim/inventory-actions.ts:166` (transfer / move_slot / split_slot) — `economy.ts:557` est le refus de RÉCOLTE, dont la bulle est visible.

**Ce que le joueur vit** — La sim refuse son transfert en français et avec la bonne raison ; il ne verra jamais un mot, l'objet ne bouge simplement pas. Il conclut que « le glisser-déposer marche mal ».

**Direction de correction** — Faire vivre le canal d'erreur et le canal de conseil dans la même pile que les panneaux (DOM, `hud-dom`).

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/hud-dom.ts`*

### D9-5 · Le journal (J) est peint sous tout panneau DOM, et il est absent d'`overlayOpen()` : cliquer dedans frappe le monde derrière

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus. Nuance du réfuteur retenue : la touche J EST écrite dans le tableau dérivé du menu pause (`keymap-perso.ts:42` + `pause-menu.ts:31-36`) — ce qui manque, c'est une affordance SUR le panneau.

**Preuve** — Relu moi-même : `UIScene.ts:274-276` `this.journalPanel = this.add.container(…)` sans `setDepth` (donc 0, sous `.hch` opaque et sous la carte à `MAP_OVERLAY_DEPTH=1000`), et `input-bindings.ts:383-387` `overlayOpen` ne liste que `mapOpen || characterMenuOpen || menuOpen || openFire` — `journalOpen` n'y est pas, alors que `pointerdown` (l.706-707) ne retourne que sur `overlayOpen()`.

**Ce que le joueur vit** — Sac ouvert, J n'affiche rien (le journal s'ouvre dessous) ; un second J le referme sans qu'il l'ait vu. Journal ouvert en plein monde, cliquer une ligne de la chronique fait donner un coup de hache sur ce qui est derrière.

**Direction de correction** — (a) mettre le journal dans la pile DOM ou l'exclure sous un panneau opaque ; (b) faire entrer `journalOpen` dans `overlayOpen()`.

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D9-7 · En jeu, ÉCHAP ouvre la pause au lieu de fermer le panneau du dessus, et aucun panneau n'a de croix ni de clic-dehors

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus (`decisions.md:480` acte le menu pause à ESC mais n'aborde jamais la fermeture des panneaux). Chiffres corrigés par le réfuteur : 5 gestes de sortie, 0 croix cliquable, 0 clic-dehors, 1 seul jamais écrit sur son panneau (le journal), 1 écrit FAUX (le Feu, D9-2) — le menu du marteau annonce le sien (`build-menu.ts:81`).

**Preuve** — En jeu, un seul handler ESC : `input-bindings.ts:350-352`, qui ne touche que `menuOpen`. `grep -rn "Escape" packages/client/src/scenes/` ne rend hors partie que `menu-dom.ts:157/174/273`, plus `hud-character.ts:284` (blur du champ) et `WorldScene.ts:1898` (brouillon de chat). Les deux « fermer » sont des `<div>` sans écouteur (`fire-panel.ts:314`, `hud-character.ts:719`).

**Ce que le joueur vit** — Sac ouvert, Échap n'y touche pas et ouvre un second panneau plein cadre par-dessus. Le menu principal, lui, remonte toujours d'un cran à Échap (`menu-dom.ts:174`).

**Direction de correction** — Décision d'Alexis : ÉCHAP referme-t-il le panneau du dessus avant d'ouvrir la pause (grammaire Rust/WoW), ou reste-t-il réservé à la pause ?

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/fire-panel.ts` · `packages/client/src/scenes/ui/menu-dom.ts`*

### D9-8 · Le coffre n'a aucun verbe visé : le cliquer arme un coup pour rien, et le seul geste qui l'ouvre — TAB à côté — n'est écrit nulle part

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus, cherché par cinq angles : les trois audits du 2026-08-20 (aucun `coffre` côté client), `gate1-finition.md` (son tableau de transmission l.104 déclare `deposit`/`withdraw` « couvert, via transfer » — c'est l'OUVERTURE qui manque, pas le transfert), et `axes-amelioration-phase2.md` / `audit-gameplay-phase1.md` / `direction-design.md` (grep `coffre` : 0).

**Preuve** — Relu : `aim.ts:615-626` `interactTargetAt` ne connaît que `fireId`, `nodeId` de cueillette et `pileId` — aucun coffre, donc ni F ni contour blanc. Un coffre traverse `clickToAction` et tombe sur `aim.ts:538` `return { type:'attack', … }`. Le coup ne casse pas le coffre (`combat.ts:586` exige `windup.structureId`, jamais posé par le joueur) mais coûte l'endurance. Le seul chemin est `nearestContainer` au TAB (`input-bindings.ts:109-130`), cadavre prioritaire.

**Ce que le joueur vit** — Il pose son coffre, clique dessus, frappe dans le vide ; F ne fait rien, pas même un contour. Le coffre s'ouvre en se tenant à côté et en pressant TAB — le geste « ouvrir mon sac » — et rien ne le dit.

**Direction de correction** — Faire entrer le coffre dans `interactTargetAt` change l'ordre de priorité motivé en `aim.ts:600-612` : conséquence de jeu, à trancher. Seule la ligne à ajouter au tableau du menu pause est purement technique.

*`packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

### D9-9 · Arc en main : le conseil d'onboarding enseigne le clic maintenu, et le clic gauche est justement inerte avec un arc

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus. À noter que le P0 de `gate1-finition.md:21` (« hints pilotés par un minuteur ») est DÉJÀ FAIT — `audit-complet-2026-08-20.md:677` le dit : les conseils sont bien déclenchés par l'état. Le défaut n'est plus le déclencheur, c'est le prédicat lu.

**Preuve** — `WorldScene.ts:2235` `hasWeapon: this.myWeapon !== 'unarmed'` et `combat.ts:89-94` rendent l'arc « armé » (profils `crude_bow`/`bow`, `balance.ts:1628/1670`) → conseil `onboarding.ts:58` « MAINTENEZ le clic ». Or `aim.ts:518` `if (hand && isRangedWeapon(…)) return null` : le clic gauche ne résout rien. La vraie grammaire est le bouton DROIT (`input-bindings.ts:719-727`), écrite sur aucun écran (grep « clic droit » dans `scenes/ui/*.ts` → uniquement des commentaires).

**Ce que le joueur vit** — Premier arc fabriqué, un conseil doré lui enseigne le geste exact qui ne fait rien avec un arc : ni bandage, ni flèche, ni refus, ni son.

**Direction de correction** — Faire dépendre le conseil de `isRangedWeapon` (conseil et résolveur doivent lire le même prédicat) et ajouter une ligne « un arc en main » au tableau du clic du menu pause.

*`packages/client/src/scenes/ui/onboarding.ts` · `packages/client/src/scenes/world/aim.ts` · `packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

### D9-4 · Les toasts (récolte, FABRIQUÉ, NIVEAU) passent sous l'écran personnage — quatre zones du HUD tranchées, la cinquième non

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus. À ne pas ranger sous la racine « canvas sous DOM » de D9-3 : ici c'est du DOM contre du DOM, ordre d'arbre dans le contexte d'empilement du `transform` de `.hud-board` (`hud-dom.ts:67`).

**Preuve** — `hud-core.ts:380` `.hc-toasts{position:absolute;top:24px;right:26px;…}` sans `z-index`, monté avant `.hch` (`UIScene.ts:212` puis `:221`) donc peint dessous. Les quatre autres zones ont une décision écrite : `.hc-bl` relevée à z-10 (`hud-core.ts:398-400`), `.cq` à z-10 (`craft-queue.ts:28`), ceinture et coin haut-gauche MASQUÉS (`hud-core.ts:264` et `:268`).

**Ce que le joueur vit** — Le bandeau « FABRIQUÉ · HACHE » ou « NIVEAU 2 » tombe derrière le panneau qu'il regarde. Le retour n'est pas nul pour autant : l'objet arrive dans la grille visible et l'ordre quitte la file (z-10).

**Direction de correction** — Arbitrage d'Alexis : relever `.hc-toasts` comme `.hc-bl`/`.cq`, ou décider que les toasts se taisent panneau ouvert. Il n'y a pas de bonne réponse par déduction — deux zones ont été relevées, deux masquées.

*`packages/client/src/scenes/ui/hud-core.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/craft-queue.ts`*

### D9-6 · TAB ouvre l'écran personnage SOUS le modal du Feu : on retombe dedans en le fermant, et 1-6 y agissent

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:170` — `UI-06` « Deux modales plein écran `pointer-events:auto` peuvent être ouvertes en même temps — la garde d'exclusivité n'existe que dans un sens » (`input-bindings.ts:293`). L'audit doit CITER UI-06, pas revendiquer. DIVERGENCE DE GRAVITÉ ASSUMÉE : l'annexe grade UI-06 `majeur` ; je maintiens `mineur` parce que le modal du Feu capte tous les pointeurs et que la confusion de grilles décrite ne peut pas se produire. Le résidu « 1-6 restent actifs » appartient à la famille de `audit-complet-2026-08-20.md:223` (P0.7).

**Preuve** — `input-bindings.ts:307` `onDownAlways(TOUCHES.toggleInventory, …)`, sans aucune garde (l.181-186), alors que le sens inverse est gardé (F retourne sur `mapOpen||characterMenuOpen||menuOpen`, l.676-684). Le symptôme « deux grilles superposées » est impossible : `.fpn{inset:0;pointer-events:auto}` (`fire-panel.ts:287`) capte toute la planche.

**Ce que le joueur vit** — Surprise d'état : il referme le Feu et se retrouve dans un sac qu'il n'a pas su ouvrir. Les touches 1-6 continuent d'agir pendant ce temps.

**Direction de correction** — Décision de grammaire : poser une règle d'exclusivité entre panneaux plein cadre, ou assumer que TAB reste une touche de sortie universelle (raison écrite en `input-bindings.ts:178-180`).

*`packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/fire-panel.ts`*

### D9-11 · Une recherche d'artisanat sans résultat rend une colonne entièrement vide et muette, alors que le catalogue du marteau a la phrase

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus (les constats client-ui de l'annexe portent sur le contraste, le poids, les écouteurs, la palette et le code mort, jamais sur l'état vide).

**Preuve** — Relu : `hud-character.ts:425-450` `drawList()` fait `listEl.innerHTML = ''` (l.428) puis boucle sur `craftRows` sans aucune branche de vide ; et `craft-panel.ts:132-135` saute les catégories vides, donc `[]` = colonne réellement blanche. Le message existe dans le composant partagé `catalogue.ts:113-121`, appelé uniquement par `build-menu.ts:78`.

**Ce que le joueur vit** — Il tape « armure » dans la recherche de son sac : la colonne devient blanche, pas un mot. Le même geste dans le menu du marteau répond « Aucun résultat. ».

**Direction de correction** — Faire passer la liste d'artisanat par `createCatalogue`, comme le menu du marteau — c'était l'intention déclarée du composant (`catalogue.ts:1-16`).

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/catalogue.ts` · `packages/client/src/scenes/ui/craft-panel.ts`*

### D9-12 · Le sac cache le SHIFT-scinder et l'envoi rapide au clic droit, et montre six cases d'équipement qui avalent le glisser sans un mot

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — CONNU_OUVERT sur la MOITIÉ paperdoll seulement : `docs/decisions.md:437` — « Les 6 slots sont DÉCORATIFS : aucun système d'équipement n'existe en /sim — décision de jeu en attente (quels emplacements, ce qu'ils font ; spec à écrire avant de les brancher) », et `audit-complet-2026-08-20.md:721` (point 3) bloque la durabilité de la tenue sur ce même « slot porté ». NOUVEAU en revanche : (a) le lâcher avalé en silence faute de `data-slot`, (b) SHIFT-scinder et le clic droit non écrits.

**Preuve** — Les six cases sont rendues `<div class="hch-eq" data-eq="…">` (`hud-character.ts:737/739`) — SANS `data-slot`, or le résolveur de lâcher est `hud-character.ts:373` `closest('[data-slot]')` avec `if (!target) return` : le lâcher est avalé sans même le retour « rien ne bouge ». Les deux gestes réels ne sont écrits nulle part : la seule aide du panneau est `hud-character.ts:727` « MOLETTE POUR DÉFILER ».

**Ce que le joueur vit** — Il glisse sa tenue d'hiver sur TORSE (78 px, même cadre qu'une case de sac) : l'objet revient, sans un mot. Et deux gestes qui existent — SHIFT-glisser pour scinder, clic droit pour envoyer au coffre — ne sont écrits sur aucun écran.

**Direction de correction** — Le paperdoll relève de la décision en attente ; ce qui est libre tout de suite, c'est d'écrire SHIFT et le clic droit dans le panneau, à côté de « MOLETTE POUR DÉFILER ».

**Vérification** — Vérifié aujourd'hui que le paperdoll est toujours décoratif : `hud-character.ts:85-97`, `EQUIP_LEFT`/`EQUIP_RIGHT` sans aucun branchement.

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/inventory-panel.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

### D9-13 · Le glisser-déposer n'a qu'un fantôme : aucune cible valide ne s'allume, et un lâcher hors cible ne dit rien

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus. Périmètre resserré à la seule affordance de cible : la moitié « le refus de la sim est peint sous le panneau » appartient à D9-3 et ne doit pas être facturée deux fois. Non réfuté (le réfuteur n'a pas reçu ce constat) — citations revérifiées par moi.

**Preuve** — Trois implémentations de glisser, aucun retour de cible : `hud-character.ts:341-388`, `inventory-grid.ts:81-148`, `fire-panel.ts:136-197` — toutes finissent par un `return` muet quand `closest('[data-slot]')` ne rend rien. Le seul retour visuel du dépôt est `fire-panel.ts:301` `.fpn-cell[data-drop]:hover{border-color:#6b5a3a;}` : un survol, actif même pour une case qui refusera.

**Ce que le joueur vit** — Il glisse de la viande vers la case COMBUSTIBLE : elle s'éclaire (elle s'éclaire pour tout), il lâche, l'objet revient. Il ne sait pas s'il a raté la case, si l'objet n'y va pas, ou si le jeu a bugué.

**Direction de correction** — Marquer pendant le glissé les cibles qui ACCEPTENT (la règle existe côté sim : `COOK_SLOT`, `stackSize`) et refuser visiblement les autres.

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/inventory-grid.ts` · `packages/client/src/scenes/ui/fire-panel.ts`*

### D9-14 · Aucun panneau du jeu n'est utilisable au clavier — alors que le menu principal l'est entièrement

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus, mais même famille que deux acquis : `UI-04` (annexe:167, quatre couples de contraste hors WCAG AA) et `docs/decisions.md:492` (mouvement réduit, garde-fou global d'accessibilité) — l'audit a traité le contraste et l'animation, jamais le focus.

**Preuve** — Balayage refait : `grep -rn "tabindex|role=\"button\"|focus-visible" packages/client/src/scenes/ui/*.ts` hors `menu-dom` → 0 résultat. En jeu il ne reste que `outline:none` + `:focus{border-color}` sur deux champs de recherche (`hud-character.ts:636/638`, `catalogue.ts:190/191`) et `aria-label="Volume"` (`pause-menu.ts:143`). TAB est capturé par le jeu (`input-bindings.ts:306`, `kb.addCapture`). Le menu principal, lui, a `role="button" tabindex="0"` (`menu-dom.ts:554/561`) et `:focus-visible` (l.711/728/760).

**Ce que le joueur vit** — Il navigue le menu principal entièrement au clavier, entre en jeu, et la même touche TAB ouvre son sac : plus rien n'est focalisable, rien ne montre où est le focus, et rien ne le dit.

**Direction de correction** — Poser la portée : soit l'UI en jeu accepte le clavier (touche de focus autre que TAB + `:focus-visible` partout), soit on assume le mouse-only en jeu et on l'écrit.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/ui/hud-character.ts`*

### D9-15 · Entrée ouvre une ligne de chat qui vole tout le clavier — et Entrée ne figure dans aucun tableau de touches

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus. Même famille que `audit-complet-2026-08-20.md:223` (P0.7, « la seule garde sur le déplacement est `typing` ; `menuOpen` ne la rejoint jamais ») mais hors de son périmètre : Entrée n'est pas un handler `onDown`, c'est un écouteur propre de `WorldScene`. `CB-04` (annexe:120) vise le chat multi, pas cette porte.

**Preuve** — Relu : `WorldScene.ts:1912-1915` `if (event.key === 'Enter' && !getHud(this.registry,'uiTyping')) { … setHud(…, 'chatTyping', true) }` — aucune garde sur `menuOpen`, `characterMenuOpen` ni `mapOpen`. `chatTyping` rend `typing()` vrai et fait taire tous les `onDown` (`input-bindings.ts:152/173`). La ligne est Phaser (`chat-panel.ts:60-65`, `DEPTH+1` avec `DEPTH=21`… donc sous tout le DOM), et `Enter` n'est ni dans `KEYMAP` ni dans `ACTIONS`.

**Ce que le joueur vit** — Menu pause ouvert, il presse Entrée pour valider REPRENDRE : la ligne de chat s'ouvre, invisible derrière le menu opaque, et plus aucune touche ne répond jusqu'à un second Entrée ou un Échap.

**Direction de correction** — Garder l'ouverture du chat comme les autres écrans (pas de chat sous un panneau plein cadre) et faire entrer Entrée dans la table des touches.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/ui/chat-panel.ts` · `packages/client/src/scenes/world/keymap.ts`*

### D9-16 · Deux panneaux plein cadre, deux réponses opposées à « puis-je voir ce qui me tue ? »

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus ; le constat voisin `P0.7` (`audit-complet:223`) traite du menu pause qui ne met pas en pause, pas de l'opacité des panneaux. Non réfuté — citations revérifiées par moi.

**Preuve** — `hud-character.ts:562` `.hch{…background:#14100c;…}` — opaque plein cadre ; `fire-panel.ts:287` `.fpn{…background:rgba(20,16,12,.72);…}` — le monde transparaît. Aucun des deux ne gèle le monde (seul `menuOpen` déclenche `syncPause`), et le HUD sait qu'on peut mourir là-dedans : les médaillons de vitale sont relevés à z-10 « PAR-DESSUS l'écran personnage » (`hud-core.ts:398-400`).

**Ce que le joueur vit** — Il ouvre son sac pour se soigner : mur brun opaque, il voit ses PV descendre sans voir ce qui les descend ni de quel côté fuir. Le modal du Feu, lui, laisse voir le monde.

**Direction de correction** — Décision d'Alexis : le sac doit-il aveugler (grammaire Rust, vulnérabilité assumée) ou transparaître comme le Feu ? Le chiffre est un alpha, la conséquence est de la létalité.

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/fire-panel.ts` · `packages/client/src/scenes/WorldScene.ts`*

### D9-17 · Marteau en main, une bande de 340 px à gauche avale les clics de pose et la molette — et le résolveur d'overlay l'ignore

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus : `UI-12` (annexe:176) vise le même fichier mais sur la perf (réécriture HTML par frame), pas sur la surface cliquable. Non réfuté — citations revérifiées par moi.

**Preuve** — Relu : `build-menu.ts:188-189` `.bmn{position:absolute;left:0;top:72px;bottom:150px;width:340px;background:rgba(20,16,12,.86);…pointer-events:auto;}` — 17,7 % de la largeur et 79 % de la hauteur du plan 1920×1080, affiché dès le marteau en main (`UIScene.ts:771-773`). `overlayOpen()` (`input-bindings.ts:383-387`) ne le connaît pas, et la molette n'est bloquée que sous `mapOpen`/`characterMenuOpen` (`input-bindings.ts:319`).

**Ce que le joueur vit** — Il vise une tuile à gauche : le fantôme est bien peint dans le monde, mais le clic est avalé par le panneau. La molette ne change plus de case au-dessus de cette bande. Et rien ne referme le panneau sinon ranger le marteau.

**Direction de correction** — Le rendre rétractable, ou au minimum le faire entrer dans `overlayOpen()` pour que le jeu et le rendu sachent que cette bande n'est pas le monde.

*`packages/client/src/scenes/ui/build-menu.ts` · `packages/client/src/scenes/world/input-bindings.ts` · `packages/client/src/scenes/UIScene.ts`*

### D9-18 · Un panneau d'inventaire Phaser complet dort dans le dépôt, et aucun test ne monte un panneau du client

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — Les DEUX moitiés sont déjà au corpus, à citer telles quelles : `docs/audit-2026-08-20-annexe.md:175` — `UI-11` « L'ancien panneau d'inventaire Phaser (~475 lignes, 3 fichiers) n'a plus aucun appelant » (détail complet `audit-2026-08-20-mineurs.md:984-990`, verdict `confirme`) ; et `annexe:352` — `T2` « 54 % du client n'est atteint par aucun test », plus `CB-12` (annexe:131).

**Preuve** — `createInventoryPanel`/`createSlotView`/`hotbarBottom` n'ont d'appelant que leur propre fichier ; seules les fonctions pures (`dragIntentFrom`, `dragToAction`, `firstFitSlot`, `quickMoveToAction`) sont importées (`hud-character.ts:52`, `inventory-grid.ts:15`) et testées (`inventory-panel.test.ts`, 4 `describe`). Aucun environnement DOM n'est installé dans le workspace.

**Ce que le joueur vit** — Rien directement — c'est la raison pour laquelle D9-1 survit depuis sa création : aucun test ne monte un panneau et ne clique dedans.

**Direction de correction** — Retirer le panneau Phaser mort en gardant les fonctions pures, et poser au moins un test de montage par panneau.

**Vérification** — Vérifié aujourd'hui que UI-11 n'a PAS été appliqué : `inventory-panel.ts`, `slot-view.ts` et `hotbar.ts` existent toujours (`ls packages/client/src/scenes/ui/`).

*`packages/client/src/scenes/ui/inventory-panel.ts` · `packages/client/src/scenes/ui/slot-view.ts` · `packages/client/src/scenes/ui/hotbar.ts` · `packages/client/src/scenes/ui/inventory-panel.test.ts`*

### D9-19 · L'écran de RUPTURE se lève derrière le menu pause : l'hôte est mort et l'écran ne change pas

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus : `CI-01` (annexe:181) traite du `boot()` qui rejette et fige le chargement — l'amont ; ici c'est l'aval, l'écran de rupture qui existe mais reste caché. Non réfuté — citations revérifiées par moi.

**Preuve** — Relu : `UIScene.ts:684-692` cache le chargement et `this.hudRoot.setVisible(false)` — mais `hudRoot` ne couvre que `.hud-overlay`, et l'exécution ne retourne pas : elle atteint `UIScene.ts:846` `this.pauseMenu.setVisible(Boolean(getHud(…,'menuOpen')))`. Le menu pause est monté sur `document.body` avec `.pause-menu{position:fixed;inset:0;z-index:70;…}` (`pause-menu.ts:93/151`), au-dessus du canvas où vit l'écran de rupture.

**Ce que le joueur vit** — Il met en pause, le worker tombe pendant ce temps, il revient : le menu pause est identique, comme si tout allait bien. C'est en cliquant REPRENDRE que l'écran de RUPTURE apparaît enfin.

**Direction de correction** — Faire primer la rupture sur TOUT ce qui est monté sur `document.body` (la passer en DOM au-dessus de z-80, ou cacher explicitement pause-menu / death-veil / season-veil).

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/fatal.ts`*

### D9-R1 · Le fantôme de glisser est peint HORS de la planche mise à l'échelle : il n'a la taille de son icône que sur un écran de 1920×1080

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus. Le point de vérification est le rapport fantôme/icône à fenêtre non-1920×1080 — mesurable au smoke, hors de mon mandat en lecture seule.

**Preuve** — VÉRIFIÉ MOI-MÊME (constat trouvé par le réfuteur, jamais contre-examiné) : `hud-character.ts:347-351` crée le fantôme, lui pose `className='hch-ghost'` et l'ajoute à `document.body` — il ne lit AUCUN `getBoundingClientRect()` de la case source, donc la taille reste celle du style : `hud-character.ts:668` `.hch-ghost{position:fixed;width:44px;height:44px;…}` (idem `inventory-grid.ts:210`, et `fire-panel.ts:141` réutilise `igr-ghost`). Les icônes, elles, sont dans la planche scalée par `hud-dom.ts:44-45` (`.hch-ic` / `.igr-ic`, 44 px × k). À 1280×720, k = 0,667 : le fantôme est 1,5 fois l'icône.

**Ce que le joueur vit** — L'icône qui colle au curseur est visiblement plus grosse que celle de la case d'où elle sort et que celle où il va la poser ; sur une petite fenêtre elle déborde la cellule visée, au moment précis où il faut viser.

**Direction de correction** — Monter le fantôme sur `board` (repère de la planche) ou lui appliquer la même échelle `k`.

**Vérification** — Le seul contre-argument possible (le fantôme prend sa taille de la case source) est écarté : aucun appel à `getBoundingClientRect` dans les trois blocs de `mousedown`.

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/inventory-grid.ts` · `packages/client/src/scenes/ui/fire-panel.ts` · `packages/client/src/scenes/ui/hud-dom.ts`*

### D9-R2 · Le journal coupe la chronique aux 26 dernières lignes, sans défilement ni marque de coupe — alors que la stèle de fin de saison la rend entière

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus (les constats chronique de l'annexe — `chronicle-liste-jumelle-sans-garde`, `crop-frozen-hors-chronique` — sont dans /sim et portent sur ce qui ENTRE dans la chronique, pas sur ce qui s'en affiche).

**Preuve** — VÉRIFIÉ MOI-MÊME : `UIScene.ts:831` `chronicle.slice(-26).map(formatChronicleLine).join('\n')`, dans un conteneur Phaser statique (`UIScene.ts:267-276`) ; `grep -n "wheel" packages/client/src/scenes/UIScene.ts` → une seule occurrence, l.327, qui délègue à `mapWheel` (gardée par la carte). La même chronique complète part à la stèle (`UIScene.ts:842`) dans `.sv-chronicle{…max-height:38vh;overflow-y:auto;…}` (`season-veil.ts:100`).

**Ce que le joueur vit** — Au jour 30 il presse J pour relire la première nuit : 26 lignes récentes, aucun moyen de remonter, aucun « … ». Il conclut que le jeu n'a rien gardé — la mémoire ne lui sera rendue qu'au jour 61.

**Direction de correction** — Soit le journal reçoit le contenant de la stèle (DOM défilable), soit il DIT sa coupe.

**Vérification** — Confirmé qu'aucun handler de molette n'atteint `journalPanel` : le seul `input.on('wheel')` d'UIScene est celui de la carte.

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/season-veil.ts` · `packages/client/src/scenes/world/hud-bridge.ts`*

### D9-10 · Le « × » du compte suit la RANGÉE et non l'objet — un choix écrit dans le code, au prix d'une divergence sac/ceinture dans le même écran

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus, mais l'arbitrage est écrit dans le code — `hud-character.ts:401` : « La ceinture affiche « ×N » comme au HUD (elle ne doit pas changer d'un écran à l'autre) ». Famille de `UI-05` (annexe:169, le poids affiché deux fois en deux formats), sans être le même fait.

**Preuve** — Recompté aujourd'hui : `hud-character.ts:402` et `inventory-grid.ts:162` `slot.count > 1 ? (c.belt ? '×' : '') + slot.count : ''` ; `hud-core.ts:323` et `fire-panel.ts:231` écrivent toujours `×${count}`. Les cases de conteneur sont bâties `makeCell('container', i, false)` (`hud-character.ts:536`) → sans `×`.

**Ce que le joueur vit** — « 12 » dans le sac, « ×12 » une rangée plus bas dans la ceinture, sans que rien n'ait changé. Dans le Feu, « ×3 » en haut et « 3 » en bas.

**Direction de correction** — Une seule règle d'écriture du compte, dans un helper partagé. Le choix est cosmétique ; l'important est qu'il soit unique.

*`packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/inventory-grid.ts` · `packages/client/src/scenes/ui/hud-core.ts` · `packages/client/src/scenes/ui/fire-panel.ts`*

### D9-20 · Le catalogue sait dire quand sa recherche a le clavier, et personne ne le lui demande

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus (grep `catalogue` sur les trois audits, `gate1-finition.md`, `axes-amelioration-phase2.md`, `audit-gameplay-phase1.md` et `direction-design.md` : rien). Famille de la section `audit-complet-2026-08-20.md:504` « Code mort tenu en vie par une garde », sans y figurer.

**Preuve** — `grep -rn "saisitDuTexte" packages/client/src` → 2 lignes, toutes deux dans `catalogue.ts` (déclaration l.52, implémentation l.143 `document.activeElement === search`). Aucun appelant : `build-menu.ts` ne la réexpose pas, et le garde du jeu lit `uiTyping`, posé uniquement par `hud-character.ts:279-280`. Piège armé mais non déclenché : le champ n'apparaît qu'à partir de 12 entrées (`catalogue.ts:82`) et `BARRIER_TYPES` en compte 7.

**Ce que le joueur vit** — Rien aujourd'hui. Le jour où le catalogue du bâti dépasse douze entrées, taper « mur » dans la recherche ouvrira la carte plein écran sur le « m ».

**Direction de correction** — Brancher `saisitDuTexte()` sur `uiTyping` depuis le menu du marteau, comme `hud-character` le fait avec `setTyping`.

*`packages/client/src/scenes/ui/catalogue.ts` · `packages/client/src/scenes/ui/build-menu.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D9-21 · Trois tables pour nommer les mêmes stations, dont deux ne sont pas gardées par le compilateur

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Table DIFFÉRENTE de celles déjà recensées dans le même fichier — donc NOUVEAU, mais à ranger dans la famille : `annexe:107` `septieme-liste-ecrite-a-la-main` (le fantôme garde la liste `wall||door||palissade`, `build-ghost.ts`), `DUP-05` (annexe:319, le masque d'arête réécrit à quatre endroits) et `DUP-01`. C'est la huitième liste du même fichier.

**Preuve** — Relu : `build-ghost.ts:62` `const FUNCTION_LABEL: Record<string, string> = { forge:'Forge', atelier:'Atelier', grenier:'Grenier', ferme:'Ferme' }`, commenté « Étendu par tranche » — clé `string`, donc `tsc` ne dira jamais qu'il manque une fonction. La source gardée est `sim/pieces.ts:159` `FONCTION_NOM: Record<StationFonction, string>` (et `:168` `FONCTION_LABEL`).

**Ce que le joueur vit** — Rien aujourd'hui — les quatre mots concordent. Le jour où une cinquième `StationFonction` entre dans /sim, l'étiquette du fantôme affichera son identifiant brut alors que la note du sac dira son nom.

**Direction de correction** — Faire lire `FONCTION_NOM` de /sim à `build-ghost.ts` au lieu d'en tenir une copie.

*`packages/client/src/scenes/world/build-ghost.ts` · `packages/sim/src/pieces.ts` · `packages/client/src/scenes/ui/hud-character.ts`*

### D9-22 · La carte oublie son zoom à chaque ouverture, la recherche d'artisanat garde son filtre pour toujours

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Absent du corpus. Non réfuté — citations revérifiées par moi.

**Preuve** — Oublie : `UIScene.ts:859` `if (!this.mapWasOpen) this.resetMapView()` (« vue neuve à chaque ouverture ») et `input-bindings.ts:312` remet `characterTab` à `perso` à chaque TAB. Retient : à la fermeture, `hud-character.ts:483-490` remet le fantôme et `container = null` et NE TOUCHE PAS `search.value` — vérifié aujourd'hui ligne à ligne ; `drawList()` (l.426) relit `search.value`.

**Ce que le joueur vit** — Il rouvre son sac dix minutes plus tard : la liste d'artisanat ne contient qu'une ligne, encore filtrée sur « hache ». À l'inverse, sa carte a perdu le zoom qu'il venait de poser.

**Direction de correction** — Décision d'Alexis : les panneaux gardent-ils leur état entre deux ouvertures ? C'est l'asymétrie qu'il faut trancher, pas l'un des deux comportements.

*`packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/ui/hud-character.ts` · `packages/client/src/scenes/ui/catalogue.ts`*

### D9-R0 · Avertissement de périmètre : le recensement transmis au réfuteur était tronqué (D9-13 à D9-22 sans examen)

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Sans objet (procédure).

**Preuve** — Constat de procédure, pas de dépôt : neuf identifiants (D9-13 à D9-22) portaient `verdict: "NON VÉRIFIÉ"` et `motif_reffuteur` vide dans le lot reçu.

**Ce que le joueur vit** — Rien — aucun effet de jeu. Il est ici pour qu'une absence de verdict ne se lise pas comme un accord tacite.

**Direction de correction** — Mandat purgé par cette passe : j'ai relu dans le code d'aujourd'hui les citations portantes de D9-13, D9-14, D9-15, D9-16, D9-17, D9-19, D9-20, D9-21 et D9-22 (voir leurs champs `preuve`). Les deux que le réfuteur signalait comme prioritaires — D9-17 et D9-19 — sont confirmés.

**Vérification** — D9-18 échappe seul à ce besoin : il était déjà couvert par UI-11 et T2 du corpus.

*`packages/client/src/scenes/ui/build-menu.ts` · `packages/client/src/scenes/UIScene.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

---

## D10 — Confort, réglages, accessibilité  *(21 constats)*

### D10-11 · Le fantôme de construction perd 72 % de son écart en deutéranopie : l'écart ne survit qu'en CLARTÉ

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus : aucun constat de daltonisme dans les 235. La famille « lisibilité » est ouverte par `docs/gate1-finition.md:26-27` (P2 — passe de lisibilité & juice UI/UX).

**Preuve** — `build-ghost.ts:38-39` `OK_TINT = 0x9adf7a` / `BAD_TINT = 0xd9614f`. Simulation Viénot–Brettel–Mollon + ΔE2000 : 60,7 normal → 17,0 deutéranopie (−72 %), 30,4 protanopie ; teintes simulées `#cece7d` vs `#929248`, rapport de luminance 2,29:1. Seule différence entre les deux états : `build-ghost.ts:140` `.setTint(inRange && !occupied ? OK_TINT : BAD_TINT)` — même texture, même `GHOST_ALPHA` (`:40`), même forme. Mêmes teintes sur le tapis (`carre-village.ts:59`).

**Ce que le joueur vit** — Là où la pose est perdue d'avance, il ne lit plus « rouge » mais « un peu plus sombre », sur une silhouette à 55 % d'alpha, sur un sol dont la luminosité change à chaque heure. Il clique, rien ne se pose, et le refus est muet (`aim.ts:525`, « Hors portée, on n'émet rien »).

**Direction de correction** — Une seconde voie qui ne soit pas la teinte, la même pour le fantôme et le tapis : hachure, croix, cadre franc ou chute d'alpha marquée. La correction n'est pas de changer les couleurs mais d'ajouter une forme.

*`packages/client/src/scenes/world/build-ghost.ts` · `packages/client/src/scenes/world/carre-village.ts`*

### D10-1 · Le menu pause ne dit pas que le son est coupé, et son curseur ne peut pas lever la sourdine

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:166` — UI-01 (majeur, `ajuste`) : « Le volume et la sourdine réglés dans les Options du menu principal sont ignorés pour toute la session », `WorldScene.ts:573`. UI-01 couvre le chemin OPTIONS→session (le moteur est construit à l'amorce du jeu, `engine.ts:34-37`) ; D10-1 ajoute le chemin MENU PAUSE. Même plomberie, même correctif — à citer, pas à revendiquer. Voir aussi `docs/gate1-finition.md:59`, périmé dans l'autre sens (« un vrai curseur de volume viendra ») alors qu'il est livré.

**Preuve** — `engine.ts:42` `this.master.gain.value = this.muted ? 0 : MASTER_GAIN * this.volume` ; `setVolume` (`engine.ts:78-83`) appelle `applyGain()` sans jamais remettre `muted` à faux. `grep -c mute packages/client/src/scenes/ui/pause-menu.ts` → 0. Le curseur existe bien (`pause-menu.ts:140` `<input type="range" class="pm-vol">` → `WorldScene.ts:1121-1126`).

**Ce que le joueur vit** — Son coupé (persisté, `braises.audio.muted`), il ouvre ÉCHAP, voit « LE SON — 70 % », bouge le curseur : rien. Le recours existe pourtant sur le même écran, ligne « Couper le son · N » (`pause-menu.ts:33` via `ACTIONS`).

**Direction de correction** — Refléter l'état de sourdine dans le menu pause (même source `lireReglagesSon` que l'écran OPTIONS) ; poser le curseur au-dessus de zéro peut lever la sourdine.

*`packages/client/src/audio/engine.ts` · `packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/WorldScene.ts`*

### D10-2 · On ne peut remapper aucune touche sans quitter sa partie — mais c'est un arbitrage tranché et chronométré

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/decisions.md:599` ④ — « Demande d'Alexis : … avec le rebinding dans les options » ; `docs/decisions.md:633` ③ — « Décision d'Alexis : le geste va au SEUIL », aller-retour MESURÉ et raccourci exprès à 1212 ms, une seule navigation.

**Preuve** — `ecranOptions` n'a qu'un appelant : `menu-dom.ts:382`. Le menu pause n'offre que `pause-menu.ts:144-145` (REPRENDRE) et `:145` (retour au menu principal) ; son tableau de touches est en lecture seule (`lignesDeTouches`, `pause-menu.ts:31-36`).

**Ce que le joueur vit** — Le menu pause LUI MONTRE la touche mal placée et ne lui laisse rien en faire : il doit sortir au menu principal, ouvrir OPTIONS, rebinder, revenir.

**Direction de correction** — Rien à faire sans l'accord d'Alexis : la place du rebinding a été décidée deux fois. Si le geste doit revenir en jeu, c'est une entrée « OPTIONS » dans le menu pause montant le même écran.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/menu-dom.ts`*

### D10-4 · 90 rebindages sur 990 posent une touche déjà prise par la ceinture, et l'anti-conflit ne peut pas le voir

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. CORRECTION DE LA PREUVE : la phrase « le test d'unicité doit inclure `BELT_BINDINGS` » est fausse — il l'inclut déjà (`keymap.test.ts:21` `...BELT_BINDINGS.map(([key]) => key)`, vérifié). Le trou réel est que ce test ne garde que la table LIVRÉE, jamais `poseBinding` à l'exécution.

**Preuve** — `poseBinding` ne balaie que `Object.keys(effectif)` (`keymap-perso.ts:104-105`) ; `BELT_BINDINGS` vit hors de `KEYMAP` (`keymap.ts:157-164`) et se câble à part (`input-bindings.ts:256-261`). 15 actions rebindables × 6 touches de ceinture = 90.

**Ce que le joueur vit** — Il pose « Cueillir » sur 1. L'écran accepte, rien ne rougit. En jeu, chaque cueillette arme aussi la case 1 de la ceinture : il lâche sa hache à chaque buisson.

**Direction de correction** — Faire entrer la ceinture dans l'espace que `poseBinding` connaît — lignes de `KEYMAP`/`ACTIONS`, ou jeu de touches RÉSERVÉES que la pose décline visiblement.

*`packages/client/src/scenes/world/keymap-perso.ts` · `packages/client/src/scenes/world/keymap.ts` · `packages/client/src/scenes/world/keymap.test.ts`*

### D10-5 · Le clic droit de visée et la molette de ceinture ne sont annoncés dans aucun écran

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus sur l'annonce. La moitié « la ceinture ne se règle pas » est en revanche un périmètre ÉCRIT : `docs/decisions.md:599` ④ (« LE REBINDING — UNE TOUCHE PAR ACTION », décision d'Alexis, sur `KEYMAP`) et `pause-menu.ts:28-29` (« Y RESTE EN DUR ce que `KEYMAP` ne porte pas : la ceinture »). Recoupe D10-4.

**Preuve** — `touches.ts:52` ne lit que `KeyboardEvent.key` : aucun bouton de souris n'est capturable. La molette de ceinture (`input-bindings.ts:318`) et le clic droit (`input-bindings.ts:623` `pointer.rightButtonDown()`, `WorldScene.ts:1869`) n'apparaissent ni dans `CLICKS` (`pause-menu.ts:41-48`, clic gauche seul) ni dans l'onboarding. La molette de CARTE, elle, est annoncée (`UIScene.ts:383`).

**Ce que le joueur vit** — Deux gestes qu'il fera mille fois par session — changer d'objet en main, viser — ne sont écrits nulle part et ne se règlent nulle part.

**Direction de correction** — Deux lignes de plus dans le tableau du menu pause (« molette : changer d'objet en main », « clic droit maintenu : viser »). Le remappage souris est un chantier à part, et un arbitrage.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/world/touches.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### D10-6 · La capture d'une touche refuse en silence — contre la règle que son propre module a écrite

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Même famille que R10-2 et R10-3 : les trois défauts de l'écran de capture vivent dans `menu-dom.ts:155-170`.

**Preuve** — `touches.ts:44-46` : « `null` n'est pas un échec à taire : la capture doit REFUSER VISIBLEMENT ce qu'elle ne sait pas lier ». Le seul appelant l'enfreint : `menu-dom.ts:163` `if (!nom) return // … on reste en attente, rien ne bouge`. Hors `SPECIALES`, `F1-F12`, chiffres et `[a-zA-Z]`, tout tombe sur `return null` (`touches.ts:50-58`) : « é », « ç », « € », « Dead », « ContextMenu », « CapsLock », « + », « - ».

**Ce que le joueur vit** — La case dit « pressez une touche… », il presse é ou +, la case reste allumée à l'identique, indéfiniment. Il ne sait pas si son clavier est lu.

**Direction de correction** — Sur un `null`, changer le mot de la case en place (« cette touche-là, non »). Une ligne chez l'appelant.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/world/touches.ts`*

### D10-7 · Cinq textes de l'écran des réglages portent `#6b6558`, qui échoue AA sur les trois fonds

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-mineurs.md:961` — UI-03 nomme le cas AU MOT : « il compte des FICHIERS (seuil 3), donc `#6b6558` répété cinq fois dans le seul `menu-dom.ts` lui est également invisible ». La famille « contraste AA » est ouverte par `docs/audit-2026-08-20-annexe.md:168` — UI-04 (majeur), mais sur d'AUTRES couples, dans `hud-character.ts` (vérifié : `:711` `.hch-mp.is-locked{color:#6f685a}` → 3,43, et `#4a453a` → 1,99, le « 1,96:1 » cité). Le calcul du ratio de `#6b6558` est l'apport neuf ; le défaut, non.

**Preuve** — Recalculé (luminance relative WCAG) : `#6b6558` → 3,27 / 2,96 / 3,38 sur `#14100c` / `#1b1b22` / `#0f0b08`, pour 4,5 exigés ; `#8b8474` (`HEX.faint`) → 5,09 / 4,61 / 5,27. Cinq déclarations, toutes porteuses de sens : `menu-dom.ts:769, 775, 788, 844, 864`. `palette.ts:44-56` documente le retrait de `#6f6a60` à 3,52 (décision d'Alexis) — `#6b6558` est plus sombre.

**Ce que le joueur vit** — Les cinq en-têtes de groupe (« SE DÉPLACER / AGIR / … ») sont le texte le moins lisible de l'écran qu'ils sont censés structurer ; idem l'invite du champ de nom de vallée, qui EST le nom de repli.

**Direction de correction** — Remplacer les cinq par `HEX.faint`. Élargir la garde AA de `palette.test.ts:89` à toute teinte employée en `color:`, pas au seul `HEX.faint`.

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/palette.ts` · `packages/client/src/scenes/ui/palette.test.ts`*

### D10-8 · Les deux secousses de caméra du combat ignorent `prefers-reduced-motion` — la moitié CSS du constat, elle, est déjà corrigée par une règle GLOBALE

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus sur les deux secousses. La moitié CSS, en revanche, est DÉJÀ CORRIGÉE : `docs/sprint-aaa.md:141` — « V1.6 — MOUVEMENT RÉDUIT, garde-fou GLOBAL … une règle unique dans `index.html` couvre tout l'existant ET le futur », smoke `mouvement` (`tools/smoke.mjs:8267`).

**Preuve** — `grep -rn matchMedia packages/client/src --include=*.ts` → 2 lignes, toutes deux `foudre-fx.ts:376-377`. `grep -rn '\.shake('` → trois sites : `WorldScene.ts:2373` (coup encaissé) et `:2379` (coup porté) SANS garde, `foudre-fx.ts:585` gardé par `const force = reduit ? 0 : secousseA(dist)` (`:583`). Une secousse Phaser n'est pas du CSS : aucune règle de feuille de style ne peut l'atteindre.

**Ce que le joueur vit** — L'orage se calme pour lui — promesse tenue. Puis un loup le mord et l'écran tressaute à chaque coup, sans recours.

**Direction de correction** — Sortir la lecture de la préférence de `foudre-fx` vers un `mouvementReduit()` partagé et la consulter aux trois `cameras.main.shake`. NE PAS toucher aux feuilles d'UI (voir vérification).

**Vérification** — `packages/client/index.html:32-41` porte un `@media (prefers-reduced-motion: reduce)` sur `*`, `*::before`, `*::after` qui écrase `animation-duration`, `animation-iteration-count` et `transition-duration`. Il couvre donc les modules cités comme fautifs, `loading.ts` et sa rotation infinie comprise (2 `@keyframes` vérifiés). Le recenseur ET son réfuteur ont tous deux manqué cette règle : leurs comptes (« 7 sur 10 », puis « 1 seul ») sont l'un et l'autre sans objet.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/foudre-fx.ts` · `packages/client/index.html`*

### D10-9 · Le flash de foudre n'a ni réglage ni atténuation sous `prefers-reduced-motion`

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Voisin de D10-8 : même fichier, même préférence, même module `mouvementReduit()` à extraire.

**Preuve** — `foudre-fx.ts:194` `const FLASH_PART = 0.22` ; `:620` `const flash = k * k * FLASH_PART` — ne consulte pas `this.reduitMouvement`, contrairement à la secousse (`:583`) et au battement du trait (`:633-636`). Aucun réglage : `grep -rniE "flashIntensity|reduireSecousse" packages/client/src` → 0.

**Ce que le joueur vit** — Le ciel monte de 22 % à chaque coup et rien ne permet de le baisser. Nuance à garder : `foudre-fx.ts:614-617` dit « LE CIEL NE BAT PAS : une décroissance LISSE » — ce n'est pas un stroboscope.

**Direction de correction** — Décision d'Alexis : faut-il un réglage d'intensité des flashs, et/ou faire tomber `FLASH_PART` sous `prefers-reduced-motion` ? L'éclat est ce qui rend l'orage MENAÇANT. Un seul nombre à trancher.

*`packages/client/src/scenes/world/foudre-fx.ts`*

### D10-10 · Aucune luminosité, aucun gamma, aucun plein écran, dans un jeu dont la nuit est le mécanisme central

`MINEUR` · `design` · `SUSPECTÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. CORRECTION DE LA FICHE : le chemin `packages/client/src/render/lighting.ts` ne porte rien de tel ; ne pas confondre non plus avec `packages/sim/src/vignette.ts`, module MORT signalé par l'annexe (`vignette-et-tiled-morts`).

**Preuve** — `grep -rniE "requestfullscreen|startFullscreen" packages/client/src` → 0. Les seules clés de réglage persistées sont `braises.audio.muted`, `braises.audio.volume`, `braises.touches`. Le seul texte du dépôt qui parle de luminosité est un commentaire, `packages/client/src/scenes/ui/vignette.ts:14`.

**Ce que le joueur vit** — Sur un écran mal calibré ou en plein jour, la nuit du jeu peut être un carré noir, sans recours. NON OBSERVÉ : c'est l'absence qui est mesurée, pas le préjudice.

**Direction de correction** — Décision d'Alexis : un curseur de luminosité change ce que le joueur VOIT VENIR la nuit, donc la difficulté réelle. Trois poses possibles (gamma canvas, plancher sur `nightVeil`, rien). Le plein écran, lui, est de la mécanique de fenêtre.

*`packages/client/src/scenes/ui/vignette.ts` · `packages/client/src/main.ts` · `packages/client/src/scenes/ui/menu-dom.ts`*

### D10-12 · Les quatre paliers de charge se réduisent à un seul en deutéranopie, et le nombre affiché ne dit pas où sont les paliers

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:169` — UI-05 (majeur, `confirme`) : « Le poids porté s'affiche deux fois à l'écran, en deux couleurs et deux formats différents », et `mineurs.md:964` montre que les tables `TIER_COLOR` du client ont déjà divergé. Voisin, pas identique : UI-05 vise la duplication, D10-12 la discriminabilité.

**Preuve** — `hud-core.ts:48-52` `CARRY_COLOR = { light: '#7e8a94', medium: HEX.ember, heavy: HEX.emberDeep, overloaded: HEX.alert }` (vérifié). ΔE2000 en deutéranopie : `ember`/`emberDeep` 1,1-1,3 (13,9 en vision normale), `emberDeep`/`alert` 6,6, `ember`/`alert` 5,6. Seul autre canal : `hud-core.ts:292` `▲ ${carry} / ${CARRY.CAPACITY}` — la charge et la capacité, jamais les seuils.

**Ce que le joueur vit** — Un seul olive du début à la fin, et « ▲ 22 / 30 » ne lui apprend pas qu'il est déjà « lourd ». Il découvre son état de charge en essayant de courir.

**Direction de correction** — Accoler le nom du palier au nombre (« ▲ 22 / 30 · lourd ») — ce qui règle aussi l'invisibilité des seuils pour tout le monde.

*`packages/client/src/scenes/ui/hud-core.ts`*

### D10-13 · Les PV sont la seule vitale sans seuil d'alerte

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. `docs/gate1-finition.md:27` liste « lisibilité des 4 jauges vitales » parmi les candidats P2, sans le nommer.

**Preuve** — `hud-core.ts:57` `{ id: 'hp', label: 'PV', max: 100 }` — pas de champ `warn`, contre `:59` (`hunger`, warn 0) et `:60` (`temperature`, warn `TEMPERATURE.HYPOTHERMIA`). Conséquence à `:280` : `const warn = v.warn !== undefined && cur <= v.warn` est toujours faux pour `hp`, le remplissage garde `VITAL_HEX.hp`.

**Ce que le joueur vit** — À 8 PV, le médaillon est presque vide, du même rouge terne qu'à 100. Le signal existe (la hauteur du liquide, pilotée à l'identique `:279-281`, plus la secousse `WorldScene.ts:2373` et le sang) ; ce qui manque est le RECOLORIAGE au seuil.

**Direction de correction** — Décision d'Alexis : à partir de quel seuil de PV alerter, et par quel canal ? Une alarme de PV bas change ce qu'on voit venir, donc la létalité ressentie et le moment où l'on décide de fuir. Une seule valeur à poser dans la même table — teinte seule ne suffira pas (cf. D10-11).

*`packages/client/src/scenes/ui/hud-core.ts`*

### D10-15 · La seule sauvegarde à la demande est un effet de bord d'ÉCHAP, et sa confirmation se peint SOUS le menu pause

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/sprint-aaa.md:148` — V1.7 INDICATEUR DE SAUVEGARDE : l'indicateur A ÉTÉ construit exprès (« la sauvegarde était déjà solide … mais MUETTE »), il est simplement occulté ici. Et `docs/decisions.md:633` ② nomme le garde `tickEcrit` : un monde qui n'a pas tiqué renvoie `saved` avec l'ANCIENNE date — le bandeau, même visible, ne dirait pas « à l'instant ».

**Preuve** — `WorldScene.ts:2219-2221` (`syncPause` envoie `pause`) → `sim-worker.ts:528-533` (`void persist()`) → `hud-core.ts:250-259` peint « partie sauvegardée ». Ce texte vit dans `.hud-overlay{z-index:40}` (`hud-dom.ts:65`) et le menu pause est `.pause-menu{z-index:70; background:rgba(20,16,12,.985)}` (`pause-menu.ts:93-95`) : il le recouvre. Aucun geste explicite (`grep -rniE "saveNow|sauvegarder maintenant"` → 0) ; aucune date en jeu (`depuisQuand` n'existe qu'au menu, `menu-dom.ts:564`).

**Ce que le joueur vit** — Il presse ÉCHAP — ce qui SAUVE VRAIMENT — et l'écran qu'il regarde ne lui dit ni « sauvegardé » ni « il y a 12 s ». Il repart en doutant. Aucune donnée n'est en jeu : autosave 30 s + écriture sur pause + écriture à la sortie.

**Direction de correction** — Donner au menu pause la ligne « dernière sauvegarde : il y a 12 s » (`depuisQuand` existe et est testée), et remonter la ligne de sauvegarde au-dessus du voile ou la republier à la réouverture.

*`packages/client/src/scenes/ui/pause-menu.ts` · `packages/client/src/scenes/ui/hud-core.ts` · `packages/client/src/worker/sim-worker.ts`*

### D10-17 · L'interface est une planche 1920×1080 mise à l'échelle FIT, sans réglage — sur un portable le texte du HUD passe sous 8 px

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — `hud-dom.ts:20-21` `HUD_DESIGN_W = 1920` / `HUD_DESIGN_H = 1080` ; `hud-dom.ts:44` `const k = Math.min(window.innerWidth / HUD_DESIGN_W, window.innerHeight / HUD_DESIGN_H)` ; `menu-dom.ts:69-70` et `:347` idem. `grep -rniE "uiScale|fontScale|echelleUi"` → 0. Recensement des tailles : 1 texte à 10 px, 10 à 11 px, 13 à 12 px. À 1366×768, k ≈ 0,71 → un 11 px rend ~7,8 px (6,4 px si l'on décompte 140 px d'interface navigateur, hypothèse non mesurée). Le zoom du navigateur est annulé par le FIT.

**Ce que le joueur vit** — Le compte d'objets d'une case de ceinture, l'infobulle d'une vitale et les en-têtes de l'écran des touches se rendent autour de huit pixels, et Ctrl + n'y peut rien.

**Direction de correction** — Décision d'Alexis : un multiplicateur d'échelle d'UI romprait le couplage documenté à `hud-dom.ts:8-12` (« le HUD DOM et le monde restent alignés et proportionnés ensemble à toute taille d'écran »). Le plancher se calcule (taille physique minimale) plutôt qu'il ne se choisit.

*`packages/client/src/scenes/ui/hud-dom.ts` · `packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/hud-core.ts`*

### D10-19 · Le jeu ne se met pas en pause quand la FENÊTRE perd le focus — seulement quand l'onglet est caché

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:184` — CI-02 (majeur) : « En multi, un onglet caché fait marcher l'avatar indéfiniment : le serveur ignore `pause` ». Le cas ONGLET est donc déjà connu ; le cas FENÊTRE ne l'est pas.

**Preuve** — `WorldScene.ts:849-850` n'écoute que `visibilitychange`, et `syncPause()` (`:2220`) ne teste que `document.hidden || this.menuPaused`. Le seul `addEventListener('blur')` du client est le champ de recherche du sac (`hud-character.ts:280`). `main.ts:20-36` ne pose ni `autoFocus` ni équivalent. Phaser ne fige pas non plus : `Game.onBlur` n'appelle que `loop.blur()`, qui pose `inFocus = false`.

**Ce que le joueur vit** — Hypothèse non observée : il alt-tabule, la fenêtre reste visible, le monde continue sans pilote. À vérifier au smoke.

**Direction de correction** — Vérifier d'abord au smoke que la boucle tourne encore. Si oui, ajouter `blur`/`focus` à `syncPause` — la Veillée est solo, figer est sans risque. Ne PAS l'appliquer en multi.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/main.ts`*

### R10-1 · La sourdine est la seule touche du jeu à échapper aux deux gardes du clavier — le correctif du menu pause, livré aujourd'hui, l'a oubliée

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:122` — CB-05 (majeur) et `docs/audit-complet-2026-08-20.md:223` — P0.7 : « Le menu pause ne met pas le joueur en pause … la ceinture 1-6 et `drop_held` ». CE DÉFAUT A ÉTÉ CORRIGÉ AUJOURD'HUI (commit `7d3fdfc`, 2026-08-20, `const enPause` ajouté à `input-bindings.ts:167`) — et la sourdine, câblée hors de ce chemin, est restée dehors. À citer comme un RÉSIDU de CB-05, pas comme une découverte indépendante. Ne pas répéter que la sourdine vivrait « en dur » : `docs/decisions.md:599` ⑥ acte son rapatriement dans `KEYMAP`, fait.

**Preuve** — `WorldScene.ts:695-703` câble la sourdine par un `addKey(code, false).on('down', …)` isolé, SANS `typing()` ni `enPause()`, alors que tout le reste du clavier passe par `onDown` (`input-bindings.ts:167-175`), qui pose les deux. Le chat n'est pas un champ DOM (`WorldScene.ts:1884-1915`) et n'appelle jamais `preventDefault` : le même événement nourrit le brouillon ET la touche N. La recherche d'artisanat, elle, est protégée (`hud-character.ts:282-283` `stopPropagation`).

**Ce que le joueur vit** — En LAN, il tape « non » dans le chat : le son s'éteint au milieu du mot, et reste éteint au prochain lancement (`braises.audio.muted` persisté). En solo, il presse N depuis le menu pause : le bandeau qui l'annonce (`WorldScene.ts:701`) se peint à `z-index:40`, sous le voile à `z-index:70` (cf. D10-1, D10-15).

**Direction de correction** — Faire passer la sourdine par le `onDown` d'`input-bindings`, qui porte déjà les deux gardes. La TABLE, elle, est déjà en ordre : la touche vient de `keymapEffectif().toggleMute`.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/scenes/world/input-bindings.ts`*

### R10-2 · L'écran des touches accepte F1 à F12 sans un mot — dont F5, que le dépôt sait être un piège

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Le geste correctif est le même que D10-6 : ces deux constats se réparent d'une seule ligne chez l'appelant.

**Preuve** — `touches.ts:55` `if (/^F([1-9]|1[0-2])$/.test(k)) return k` — les douze sont acceptées. Les touches sont créées sans capture : `input-bindings.ts:124` et `:171` appellent `kb.addKey(K[n]!, false)`, second paramètre `enableCapture` — sans `addCapture`, Phaser ne fait aucun `preventDefault`. Et `keymap.ts:150-152` écrit le piège : « F5 est pris par le navigateur (il recharge la page …), donc F6 ». Rien de cette connaissance n'atteint l'écran (`menu-dom.ts:163`).

**Ce que le joueur vit** — Il pose « Cueillir » sur F5, l'écran l'accepte. En jeu, la première cueillette recharge la page : il retombe dans sa vallée à la dernière écriture (≤ 30 s) sans pouvoir relier la cause à l'effet. Idem F11 (plein écran) et F12.

**Direction de correction** — Une liste de touches réservées au navigateur (au minimum F5, F11, F12) que la capture décline VISIBLEMENT — le module porte déjà la règle (`touches.ts:44-46`), il lui manque le cas. Même geste que D10-6.

*`packages/client/src/scenes/world/touches.ts` · `packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/world/keymap.ts`*

### D10-3 · Le commentaire de `bindInputs` renvoie à un `recableTouches` qui n'existe pas

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/decisions.md:633` ④ — « On n'énumère pas les 85 champs : on jette l'instance (`MenuScene.rafraichirScenesDeJeu` — `scene.remove` + `scene.add`) ».

**Preuve** — `grep -rn recableTouches packages/ tools/ docs/` → UNE ligne, le commentaire lui-même : `input-bindings.ts:138`. Le recâblage a bien lieu, autrement : `MenuScene.rafraichirScenesDeJeu` fait `scene.remove` + `scene.add`, donc `WorldScene.create()` rejoue et `bindInputs` relit `keymapEffectif()` (`input-bindings.ts:141`).

**Ce que le joueur vit** — Rien. C'est le prochain développeur qui se fait piéger : il branche la capture en croyant qu'un recâblage existe.

**Direction de correction** — Corriger le commentaire : le jeu de touches est lu une fois à la création de la scène, et la scène est JETÉE au retour au menu — un rebind posé aux OPTIONS prend au REPRENDRE suivant.

*`packages/client/src/scenes/world/input-bindings.ts`*

### D10-14 · Le seuil d'alerte de la FAIM n'arrive qu'à zéro, où il ne reste qu'un liseré de 2 px à peindre

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. CORRECTION DE LA PREUVE : « code mort » et « la géométrie interdit l'alarme » sont faux — un élément de hauteur 0 peint quand même sa bordure (`hud-core.ts:406` + `:283`).

**Preuve** — `hud-core.ts:59` `warn: 0` ; `:279-283` : `frac = cur / v.max` et `warn = cur <= 0` — les deux ne coïncident qu'à `frac = 0`. `.hc-fill` porte `border-top:2px solid` (`hud-core.ts:406`) et `:283` pose `borderTopColor = HEX.alert` : l'alerte peint donc 2 px, en continu, tant qu'on est à zéro.

**Ce que le joueur vit** — Le signal réel de la famine est le disque VIDE, pas la couleur d'alerte. Le seuil arrive après la bataille.

**Direction de correction** — Relever le seuil à une valeur où il peut peindre (la faim inquiète bien avant zéro) — c'est un nombre de jeu, donc Alexis — ou le retirer et assumer que le disque vide EST le signal.

*`packages/client/src/scenes/ui/hud-core.ts`*

### D10-16 · `pagehide` est absent — mais la fermeture d'onglet passe déjà par `visibilitychange`, qui sauve

`COSMÉTIQUE` · `technique` · `SUSPECTÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/gate1-finition.md:85` (Passe 2, item 3) : « sur une vraie fermeture, IndexedDB reste best-effort — limite navigateur, pas un bug ». Le dépôt a déjà tranché ce résidu comme non-défaut ; le worker le redit à la fin de `persist()`.

**Preuve** — `grep -rnE "beforeunload|pagehide|'unload'" packages/client/src --include=*.ts` → 0 (revérifié). Mais le chemin est câblé : `WorldScene.ts:849-850` (`visibilitychange`) → `syncPause()` → `sim-worker.ts:528-533` → `persist()`. Il ne reste que l'incertitude sur l'aboutissement de l'écriture IndexedDB.

**Ce que le joueur vit** — Rien de démontré. Ni le recenseur ni son réfuteur n'ont observé un navigateur.

**Direction de correction** — Aucun geste avant mesure. Si un `pagehide` est ajouté, qu'il pose le même `{type:'pause'}`.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/worker/sim-worker.ts`*

### R10-3 · En capture de touche, rien ne dit comment renoncer

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Troisième défaut du même écran de capture, avec D10-6 et R10-2.

**Preuve** — `menu-dom.ts:500` — `const touches = enCapture ? 'pressez une touche…' : libelleTouches(...)`. Les deux sorties existent sans être annoncées : ÉCHAP annule (`menu-dom.ts:157-161`) et un clic ailleurs désarme. Le CSS de l'état d'attente porte pourtant le raisonnement inverse en commentaire (`menu-dom.ts:855-856`).

**Ce que le joueur vit** — Il arme une case par mégarde, ne sait pas qu'ÉCHAP annule (ÉCHAP ferme l'écran partout ailleurs), presse une touche au hasard pour sortir — et dépouille une autre action au passage (`poseBinding` vole, `keymap-perso.ts:104-118`).

**Direction de correction** — « pressez une touche… (ÉCHAP pour annuler) ». La chaîne est à un seul endroit.

*`packages/client/src/scenes/ui/menu-dom.ts`*

---

## D11 — Le son comme canal d'interface  *(16 constats)*

### D11-1 · Aucune voix de fait de domaine n'est spatialisée — mais douze d'entre elles portent la coordonnée, et le rendu la lit

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:172` — UI-09 (majeur, `confirme`) : « Le son n'a aucun filtre spatial : tout fait de la vallée sonne à plein volume dans l'oreille du joueur », `WorldScene.ts:2234`. L'audit doit CITER UI-09.

**Preuve** — `grep -rn "panner|PannerNode|StereoPanner" packages/client/src` → 0. `WorldScene.ts:2285` `this.audioFx.play(soundForEvent(event, this.eventConcernsMe(event)))` — deux arguments, aucun de position ; `engine.ts:66` va droit au gain maître. Dérivation par le compilateur : 12 des 44 voix portent x,y ou tx,ty. La coordonnée est lue dans la MÊME boucle par le rendu (`WorldScene.ts:2299`, `:2414`, `:2419`).

**Ce que le joueur vit** — Un hurlement part, plein centre, sans côté ni distance. Il pivote pour chercher à l'écran ce que l'oreille aurait donné. Atténué par le fait que le hurlement qui VOUS vise publie un bandeau (`WorldScene.ts:2393-2401`).

**Direction de correction** — Décider si ASHES a une audio positionnelle : panoramique + atténuation dérivés de la distance caméra→(x,y) pour les douze voix qui portent déjà la coordonnée. Un survival top-down peut légitimement rester mono — à Alexis.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/audio/engine.ts` · `packages/sim/src/events.ts`*

### D11-2 · Le canal VISUEL filtre sur « ça me concerne », le canal SONORE non — densité mesurée ~1 voix par minute

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:172` — UI-09. Même défaut, angle « pertinence » plutôt que « spatialisation ». Voir aussi R-M4, qui en est l'instance mesurée.

**Preuve** — 32 des 44 voix sont sans coordonnée (dérivé par le compilateur), dont `entity_died`, `village_fell`, `alarm_raised`, `node_depleted`. Le client sait dire « ça me concerne » et s'en sert partout SAUF pour le son : `WorldScene.ts:2330`, `:2337`, `:2391`, `:2393`, `:2426`, `:2447` sont gardés, tandis que `:2285` joue TOUT et n'utilise `eventConcernsMe` que pour choisir un TIMBRE. Le flux n'est pas rogné (`interest.ts:25-27`, gardé par `interest.test.ts:69`).

**Ce que le joueur vit** — Un village PNJ qu'il n'a jamais vu tombe à cinq cents tuiles, et le son le plus lourd du jeu part à côté de son oreille. Le banc mesure 1,1 voix/minute hors amorce sur un cycle d'acte I — pas un déluge.

**Direction de correction** — Deux arbitrages : (1) quels faits doivent s'entendre depuis l'autre bout de la vallée — le silence à distance est aussi une décision ; (2) pour ceux qui doivent porter une distance, l'événement doit d'abord porter sa position, ce qui est un diff `/sim`.

*`packages/sim/src/events.ts` · `packages/sim/src/interest.ts` · `packages/client/src/scenes/WorldScene.ts`*

### D11-3 · Rien ne borne le nombre de voix simultanées — huit gels de parcelle somment de façon cohérente

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:167` — UI-02 (majeur, `ajuste`) : « Aucun plafond de polyphonie : N sons identiques planifiés au même instant s'additionnent en amplitude, pas en énergie », `sound.ts:295`. Repris dans `mineurs.md:971-972` (UI-08) : « la même écriture ne protège de rien pour `cendreux_risen` ou `crop_frozen` … voir UI-02 ». Et `docs/decisions.md:596` ⑥ l'inscrit comme point de surveillance de playtest depuis le 2026-07-28.

**Preuve** — `agriculture.ts:70-77` émet un `crop_frozen` par parcelle sans plafond ; `engine.ts:62-67` n'a ni compteur ni file et démarre chaque graphe au même `ctx.currentTime` ; `grep -rn "DynamicsCompressor" packages/client/src` → 0. Le bruit est engendré par un LCG à graine FIXE (`sound.ts:308` `let s = 0x2545f491`) : deux buffers sont bit-à-bit identiques. 8 × 0,055 = 0,44 avant maître, soit 2,93× le plafond par voix de 0,15 que `sound.test.ts:129-136` tient — ~+18 dB sur une voix seule, pas un écrêtage (0,264 après `MASTER_GAIN`).

**Ce que le joueur vit** — Au lieu d'un petit craquement triste, un même timbre huit fois plus fort qu'il n'a été calibré.

**Direction de correction** — Un plafond de voix simultanées. Le regroupement (« N occurrences du même spec ne rendent qu'une voix ») est un arbitrage de jeu — le joueur doit-il entendre que HUIT parcelles ont gelé ?

*`packages/client/src/audio/engine.ts` · `packages/client/src/audio/sound.ts` · `packages/sim/src/agriculture.ts`*

### D11-4 · Un Feu qui vire sonne pareil vers Foyer et vers Meute, alors que l'événement porte la réponse

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. CORRECTION D'ATTRIBUTION : « la promesse est écrite, seul le câblage manque » est faux. `sound.ts:49-51` et `docs/decisions.md:596` ④ font porter « l'axe d'alignement s'entend » aux VERBES (gift_given/refugees_fed montent, refugees_robbed/member_banished tombent) — implémentés et gardés par `sound.test.ts:103-118`. Et le son actuel est argumenté à sa ligne (`sound.ts:130`, « ni gain ni perte — une bascule »).

**Preuve** — `events.ts:208` porte `archetype: 'foyer' | 'meute' | 'neutre'`. `sound.ts:130-132` rend une spec unique sans lire ce champ : `{ wave: 'sine', freq: 330, freqEnd: 294, dur: 0.7, gain: 0.07 }` pour les trois variantes (balayage sur le vrai `soundForEvent`).

**Ce que le joueur vit** — Une note qui fléchit à peine. Il ne sait pas si un village vient de basculer Foyer (un allié possible) ou Meute (des gens qui viendront le piller).

**Direction de correction** — Décision d'Alexis : le joueur doit-il entendre DANS QUEL SENS un Feu voisin a basculé ? C'est ce qu'il voit venir d'un voisin qui devient hostile. Le routage sait déjà lire un champ (`event.open` pour la porte, `event.nodeType` pour le nœud).

*`packages/client/src/audio/sound.ts` · `packages/sim/src/events.ts`*

### D11-5 · Recensement des pentes exact — mais les quatre « contre-pied » respectent la règle déclarée

`MINEUR` · `design` · `SUSPECTÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. `docs/decisions.md:596` ④ écrit la grammaire ; le recensement des pentes est mesuré, le « contre-pied » ne l'est pas.

**Preuve** — Balayage exhaustif du vrai `soundForEvent` : ~34 MONTE / 32-33 DESCEND / 2 PLAT / 28-30 sans hauteur (l'écart entre les deux balayages tient au nombre de variantes énumérées). Les quatre pentes citées sont exactes. Mais la règle déclarée (`sound.ts:42-44`) est ouvre/ferme, et un mort qui SE LÈVE ouvre, une vie qu'on abat ferme : aucune ne la viole. Trois des quatre sont argumentées (`sound.ts:75-76`, `:149-152`).

**Ce que le joueur vit** — Hypothèse de perception non testée : qu'un joueur lise VALENCE là où le code écrit OUVRE/FERME. Aucun playtest, aucun instrument.

**Direction de correction** — Si Alexis veut trancher : soit la pente reste ouvre/ferme et un SECOND axe porte la valence (le timbre le fait déjà pour le prédateur en `sawtooth`), soit elle devient bon/mauvais et quatre voix se retournent. Les deux se tiennent.

*`packages/client/src/audio/sound.ts`*

### D11-7 · Le recensement écrit du son est périmé partout — douze endroits annoncent des comptes que le test contredit

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — C'est une RÉCIDIVE, pas une première dérive : `docs/decisions.md:625` ③ raconte le même incident et sa réparation (« 34 voix / 27 silences a viré au rouge dans les deux fichiers … 35/26 désormais »). Famille déjà nommée : `docs/audit-2026-08-20-annexe.md:376` — DOC-12, « Quatre compteurs cités dans la doc de pilotage sont périmés d'un facteur 2 à 10 », dont le correctif est « retirer les compteurs plutôt que les corriger ». Le lot audio n'y figure pas.

**Preuve** — Lancé : `pnpm --filter @ashes/client exec vitest run src/audio/` → 19 tests passed, avec `sound.test.ts:95` `expect(total).toBe(77)`, `:100` `expect(voix).toBe(44)`, `inventaire.test.ts:74-75` 44/33. Les proses disent autre chose, vérifiées au mot : `inventaire.ts:2` « les 66 faits », `:19` « les 51 silences », `:20` « 34 faits ont une voix, 27 un silence DÉCIDÉ », `:41` « LES 66 FAITS », `:199` « 7 voix neuves », `:206` « 6 voix neuves », `:214` « 4 voix seulement », `:233` « Douze faits tranchés d'un bloc », `sound.test.ts:18` « 63 faits … 12 sonnent », `sound.ts:39` « vingt-quatre voix », `inventaire.test.ts:7` « 62 faits », `:10` « l'inventaire des 73 faits », `:41-42` « 38 … 26 », `docs/gate1-finition.md:13` « 34 faits ont une voix, 27 un silence DÉCIDÉ ».

**Ce que le joueur vit** — Rien directement. Mais `inventaire.ts` est la source runtime de `banc-son.html` : l'écran où Alexis règle les timbres annonce 34 voix devant 44, et ment sur presque chacune de ses familles.

**Direction de correction** — Dériver les comptes au lieu de les écrire (`Object.keys(INVENTAIRE).length`, `SONORES.length`, `faitsDeFamille(id).length`), ou les retirer — c'est le correctif que l'audit a déjà retenu pour DOC-12.

*`packages/client/src/audio/inventaire.ts` · `packages/client/src/audio/sound.ts` · `packages/client/src/audio/inventaire.test.ts` · `docs/gate1-finition.md`*

### D11-8 · Les trois faits du blizzard sont muets — report NOMMÉ vers le chantier audio météo

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Le report est nommé par le CODE lui-même (`inventaire.ts:99-101`). CORRECTION : le « jumeau » invoqué est mal choisi — la Brume, elle, n'a AUCUN rendu (voir R-M3 et BRUME-1), ce qui est précisément pourquoi ses deux voix existent (`sound.ts:166-167`).

**Preuve** — `inventaire.ts:99-104` le dit mot pour mot (« trois faits nés MUETS — complétion de type, pas un arbitrage de timbre … la voix se décidera là, au banc »), suivi de trois `voix: 'muet'` (vérifié). Aucune nappe de vent dans `packages/client/src/audio/`.

**Ce que le joueur vit** — Trois moments du blizzard passent sans un son. Mais il n'est PAS aveugle : le blizzard a un rendu complet (`meteo-particules.ts:205`, `meteo-layer.ts:166`), une ligne de chronique (`chronicle.ts:143-144`) et un bandeau de gel (`WorldScene.ts:2255`). Ce qui manque au préavis, c'est un canal LIVE — la chronique ne se lit qu'au journal.

**Direction de correction** — À trancher séparément : les trois one-shots (l'annonce est le préavis qui manque le plus) et la nappe de vent, qui n'est pas un `SoundSpec` et demande un canal continu.

*`packages/client/src/audio/inventaire.ts` · `packages/client/src/audio/sound.ts`*

### D11-9 · Le contexte audio ne naît qu'au premier geste SUR LE CANVAS : avant, tout se joue muet, sans trace

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:126` — CB-03 (mineur) : « Le shutdown de scène ne rend ni l'atlas du sol ni l'AudioContext, alors que la scène est JETÉE à chaque retour au menu ». Même cycle de vie, autre bout : CB-03 traite la fermeture, D11-9 l'ouverture.

**Preuve** — `WorldScene.ts:691-692` sont les deux seuls `resume()` du jeu, et ce sont les entrées PHASER (le canvas). `engine.ts:47-57` ne construit l'`AudioContext` que là ; `engine.ts:63` abandonne en silence (`… || !this.ctx || … || this.ctx.state !== 'running'`). Le menu est un overlay DOM qui n'importe que `ecrireMute, ecrireVolume, lireReglagesSon` (`menu-dom.ts:52`). `isReady()` existe et dit précisément « on ne fait pas douter quelqu'un de ses oreilles » (`engine.ts:97-100`), mais son unique lecteur est le banc (`banc-son.ts:449`).

**Ce que le joueur vit** — Le monde s'ouvre ; tant qu'il n'a pas touché le canvas, le jeu est parfaitement silencieux et rien ne dit pourquoi.

**Direction de correction** — ATTENTION AU COUPLAGE : réveiller le contexte au premier clic DOM lèverait le masque qui rend aujourd'hui inaudible la salve d'amorce de R-M1 (486 voix dans un seul message). Les deux ne se réparent pas séparément. Faire lire `isReady()` par le HUD est, lui, sans risque.

*`packages/client/src/scenes/WorldScene.ts` · `packages/client/src/audio/engine.ts` · `packages/client/src/scenes/ui/menu-dom.ts`*

### D11-10 · Le curseur de volume ne fait entendre aucun témoin — parce qu'il n'existe aucun son d'interface dans ASHES

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. Referme D11-9 par le même geste (un témoin prouve que l'audio est ouvert) — mais voir l'avertissement de couplage de D11-9/R-M1.

**Preuve** — `menu-dom.ts:305-320` : l'`input` ne fait qu'`ecrireVolume(pct / 100)`, le clic sur `[data-mute]` qu'`ecrireMute(...)` + `peindre()` ; le module n'instancie aucun moteur. Le curseur du menu pause agit en direct (`pause-menu.ts:186` → registre → `WorldScene.ts:1121-1126`) mais n'émet rien non plus. `grep -rn "audioFx|SoundEngine|buildSound|soundForEvent" packages/client/src --include=*.ts` hors `audio/` et hors banc → 12 lignes, TOUTES dans `WorldScene.ts`.

**Ce que le joueur vit** — Il pose le volume à 30 % sans rien entendre et découvre le résultat quinze secondes plus tard, sur un hurlement.

**Direction de correction** — Décision d'Alexis, et de registre : poser une note témoin sur le curseur ferait le PREMIER son d'interface du jeu. ASHES a-t-il une voix d'interface ?

*`packages/client/src/scenes/ui/menu-dom.ts` · `packages/client/src/scenes/ui/pause-menu.ts`*

### D11-11 · Un seul robinet pour tout : baisser le volume parce que le clapotis agace efface aussi l'avertissement du loup

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus (UI-02 vise la polyphonie, UI-09 la spatialisation ; aucun ne nomme le bus unique). ABSORBE D10-18, qui disait la même chose sous l'angle « pas de volume par famille ».

**Preuve** — `engine.ts:10` `MASTER_GAIN = 0.6`, `engine.ts:41-42`, `engine.ts:54` l'unique `createGain` du moteur ; `grep -rn "createGain" packages/client/src` → 2 en tout (celui-ci + l'enveloppe par son, `sound.ts:296`). Tout y passe : faits (`WorldScene.ts:2285`), aube (`aube.ts:43`, gain 0,028), eau (`eau-audio.ts:56` g 0,045 et `:64` g `0.028 * proche`), gerbes (`WorldScene.ts:959`). Aucun fichier audio dans le dépôt : tout est synthétisé.

**Ce que le joueur vit** — Son seul moyen de calmer le décor est de se priver du signal. Nuance mesurée : l'ambiance est déjà bien plus basse que les faits (clapotis ≤ 0,0168 crête, pépiement 0,028, contre 0,09 pour le hurlement), et l'eau atténue déjà par la distance.

**Direction de correction** — Deux `GainNode` sous le maître — AMBIANCE et FAITS — chacun avec son gain persisté. `play()` reçoit déjà une `SoundSpec` par site d'appel, il suffit de router. Le SECOND CURSEUR qu'implique ce découpage est, lui, une décision d'écran.

*`packages/client/src/audio/engine.ts` · `packages/client/src/audio/aube.ts` · `packages/client/src/audio/eau-audio.ts`*

### D11-12 · La grammaire du son n'est gardée que sur six événements : trente-huit voix peuvent inverser leur pente sans qu'un test rougisse

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Famille déjà nommée par l'audit : `docs/audit-complet-2026-08-20.md:488` — « Les gardes qui comptent au lieu d'énumérer » (`lit-coverage.test.ts:49`, `bati-art.test.ts:31`). Le cas audio n'y figure pas.

**Preuve** — `sound.test.ts:103-118` est le SEUL test de grammaire et énumère une liste EN DUR : quatre chauds (`:108`) et deux froids (`:112`), six sur quarante-quatre. Les autres cas gardent le compte (`:69-101`), la cohérence table↔routage (`:53-67`), une hiérarchie à deux sons (`:120-127`) et le plafond de gain PAR VOIX (`:129-136`) — rien sur la somme (cf. D11-3). `engine.test.ts` ne couvre que la persistance des réglages et l'isolement du banc.

**Ce que le joueur vit** — Rien aujourd'hui, mais c'est ce qui rend D11-4 possible et invisible : la seule voix qui ne lit pas son champ est passée sans qu'un test la voie.

**Direction de correction** — Une garde EXHAUSTIVE, pas six cas choisis : balayer les 44 voix, classer chacune (monte / descend / sans hauteur) et affirmer une seule propriété — la partition décidée, et l'obligation pour toute voix neuve de s'y déclarer.

*`packages/client/src/audio/sound.test.ts` · `packages/client/src/audio/sound.ts`*

### R-M1 · Le tout premier snapshot d'une Veillée neuve porte 486 voix dans un seul message — latent aujourd'hui, armé dès qu'on corrige D11-9

`MINEUR` · `technique` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:167` — UI-02 (majeur) nomme déjà le mécanisme (« aucun plafond de polyphonie … s'additionnent en amplitude »). L'apport neuf est l'AMPLEUR à l'amorce et le couplage à D11-9 ; le défaut, non. Recoupe D11-3.

**Preuve** — `sim-worker.ts:156` `const events = drainEvents(sim)` puis `:190` `events,` : le PREMIER `tick()` vide tout ce que le worldgen a accumulé (`village.ts:1496` émet un `structure_built` par pièce posée, avant tout `step`). Mesuré : 521 événements, 483 sonores, somme des gains crête 29,02 → ×0,6 = 17,41 fois la pleine échelle à `MONDE.JOUEURS_CIBLE = 50`. 485 sont du `noise` engendré par un LCG à graine FIXE (`sound.ts:308`), donc bit-à-bit identiques et démarrés au même `ctx.currentTime`.

**Ce que le joueur vit** — AUJOURD'HUI : rien — et c'est un accident, pas une garde. Le contexte n'est pas réveillé à cet instant (D11-9), donc `engine.ts:63` jette les 486 en silence.

**Direction de correction** — Le même plafond de voix que D11-3, à un autre ordre de grandeur. Ne surtout pas découpler de D11-9, dont le correctif lève le masque. Le tri de « quels faits de l'amorce méritent d'être joués » est un arbitrage (un village PNJ bâti au tick 0 n'est pas un fait qui vient de se produire).

*`packages/client/src/worker/sim-worker.ts` · `packages/client/src/audio/engine.ts` · `packages/client/src/audio/sound.ts`*

### R-M2 · Chaque mise à mort sonne DEUX fois, et le chant de mort ne distingue pas la bête de l'homme

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus. C'est pourtant la hiérarchie que `sound.test.ts:120-127` garde explicitement (« la chute d'un village est plus longue et plus grave qu'une mort d'homme », `docs/decisions.md:596` ④) : la diluer sur le gibier vide la garde de son sens.

**Preuve** — `combat.ts:885-893` : `die()` émet inconditionnellement `entity_died` avec `wasMonster: monster !== undefined` ; `combat.ts:950`, même appel, même tick, `emitEvent(state, { type: 'monster_slain', … })`. Aucune branche ne peut les séparer (vérifié). Côté son, `WorldScene.ts:2285` joue les deux : `sine 160→70, 1,1 s, gain 0,11` (`sound.ts:69-70`) et `triangle 180→90, 0,22 s, gain 0,1` (`:71-72`). `wasMonster` n'est jamais lu par `soundForEvent` ; ses deux lecteurs sont `chronicle.ts:162` (`if (!e.wasMonster) push("Quelqu'un est tombé.")`) et `scenario.ts:264`.

**Ce que le joueur vit** — Sur chaque lapin, une sinusoïde grave d'une seconde — le chant que le TEXTE réserve à « Quelqu'un est tombé ». La voix la plus solennelle se banalise sur la boucle de chasse.

**Direction de correction** — Deux arbitrages, aucun par un agent : (1) une bête et un homme doivent-ils partager une voix ? La donnée est là (`wasMonster`), la chronique a déjà tranché NON. (2) Une mise à mort doit-elle produire une voix ou deux ?

*`packages/sim/src/combat.ts` · `packages/client/src/audio/sound.ts` · `packages/sim/src/chronicle.ts`*

### R-M3 · La Brume n'a aucun rendu à l'écran, et ses deux sons portent la position sans jamais la dire

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:267` — BRUME-1 (mineur, `ajuste`) et son détail `docs/audit-2026-08-20-mineurs.md:1277-1284` : « La nappe létale est INVISIBLE … le joueur entend la Brume et meurt dedans sans jamais la voir » ; jumelé à GEL-1 (`mineurs.md:1286`) et à `docs/audit-complet-2026-08-20.md:693` Décisions #4 et #5. Le seul apport neuf est que les deux voix portent `tx,ty` — ce qui relève de UI-09 (annexe:172).

**Preuve** — `grep -rn "brumeCentre|dansLaBrume|brumeJourEligible" packages/client/src packages/server/src` → 0 ; la Brume est absente de `protocol.ts` ; `packages/sim/src/index.ts:119` l'écrit au futur. C'est pourtant un danger réel : `temperature.ts:123` soustrait `brumeColdAt(state, x, y, tick)` à l'exposition. Ses deux voix portent `tx, ty` (dérivé par le compilateur) et sont jouées par `WorldScene.ts:2285`, qui ne passe aucune position.

**Ce que le joueur vit** — Une nappe de froid létal en plein jour, annoncée à l'oreille et au journal, jamais à l'écran ni sur la carte, et sans direction. Le seul retour direct est « VOUS GELEZ. Trouvez un feu. » (`WorldScene.ts:2255`), quand il est tard.

**Direction de correction** — À trancher par Alexis : (1) la nappe doit-elle se VOIR (la géométrie est déjà une fonction pure) ? (2) tant qu'elle reste invisible, ses deux voix doivent-elles porter la direction, puisqu'elles sont le seul canal spatial ?

**Vérification** — CONTRADICTION INTERNE DU CORPUS, à trancher avant de recopier l'un ou l'autre. `audit-complet-2026-08-20.md` (Décisions #5) affirme « aucune Brume ne peut se lever en Veillée solo — le trou ne mord qu'en multi » ; `mineurs.md:1284` (vérif de BRUME-1) affirme l'inverse (« `worldEvents` vaut `true` par défaut, donc la nappe est bien vivante dans la Veillée »). LE CODE DONNE RAISON À BRUME-1 : `sim.ts:490` `worldEvents: options.worldEvents ?? true` ; `sim.ts:781` `advanceBrume(state)` sous ce même interrupteur ; `BRUME.CHANCE_PER_DAY = [0, 0.35, 0.5]` (`balance.ts:3216`) donc actes II et III ; et la Veillée joue 60 jours (`veillee.ts:49`, `VEILLEE_SEASON_CYCLES = 6`) sur une carte qui porte `map.cendre`. La Brume se lève bien en solo.

*`packages/sim/src/brume.ts` · `packages/sim/src/sim.ts` · `packages/sim/src/temperature.ts` · `packages/client/src/scenes/WorldScene.ts`*

### R-M4 · La récolte est bornée à « moi » pour éviter un vacarme ; son grand frère, deux fois plus fort, ne l'est pas — et les PNJ le déclenchent

`MINEUR` · `design` · `MESURÉ` · statut : CONNU_OUVERT

**Référence au corpus** — `docs/audit-2026-08-20-annexe.md:172` — UI-09. C'est l'instance MESURÉE de D11-2 : les 32 `node_depleted` sont la majorité des 54 voix/cycle que le banc de D11-2 comptait. L'apport neuf est l'asymétrie (`resource_harvested` gardé, `node_depleted` non) et le chiffre ; le défaut est nommé.

**Preuve** — `sound.ts:189-190` : `case 'resource_harvested': return onMe ? { … } : null`, gardé par un test qui nomme la raison (`sound.test.ts:49-51`, « sinon un vacarme de fond »). `sound.ts:227-240` ne consulte jamais `onMe` : `node_depleted` sonne pour tout le monde, voix d'arbre `{ noise, dur: 0.5, gain: 0.11, lowpass: 1100 }`. Le fait vient du chemin de récolte commun (`economy.ts:602`) et les PNJ l'empruntent (`npc.ts:503`). Banc sans aucun joueur : 32 `node_depleted` en 48 minutes réelles, contre 0 `entity_died` et 0 `village_fell`.

**Ce que le joueur vit** — Toutes les minute et demie, sans rien faire, un arbre craque et tombe — un bruit plein d'une demi-seconde, aussi fort que la mort d'un homme, produit par un PNJ à l'autre bout de la carte.

**Direction de correction** — À poser à Alexis, pas à câbler : soit `node_depleted` prend la garde de son petit frère, soit il devient une voix de MONDE assumée. La troisième voie (une portée en tuiles) dépend de D11-1 et d'une position que l'événement ne porte pas.

*`packages/client/src/audio/sound.ts` · `packages/sim/src/economy.ts` · `packages/sim/src/npc.ts`*

### D11-6 · `alarm_raised` est la seule voix plate du jeu, et l'exception n'est pas nommée à côté du cas

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU

**Référence au corpus** — Rien dans le corpus.

**Preuve** — Balayage exhaustif : une seule pente PLATE — `sound.ts:158` `{ wave: 'square', freq: 660, freqEnd: 660, dur: 0.18, gain: 0.1, lowpass: 2600 }`, `freqEnd === freq`. Les exceptions voisines, elles, sont argumentées en commentaire (`cendreux_prowl` `sound.ts:79-81`, `node_depleted` `:210-222`).

**Ce que le joueur vit** — Un bip carré qui n'ouvre ni ne ferme. Il sait en revanche très bien de QUI il s'agit : l'alarme ne se lève que pour son village (`WorldScene.ts:2391` `event.villageId === this.myVillageId`).

**Direction de correction** — Décider si l'alarme est un signal HORS grammaire (un objet fabriqué par des hommes, donc légitimement plat) ou un fait qui doit se ranger. Aujourd'hui c'est un commentaire qui manque, pas un son.

*`packages/client/src/audio/sound.ts`*

---

## L1 — Captures — premier contact  *(16 constats)*

### L1-01 · Le second clic au même endroit détruit la sauvegarde

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — Géométrie relevée au pixel. Croix ✕ de la ligne 2 (accueil-deux-vallees.png) : bordure verticale en x=316 et x=338, horizontale en y=460 et y=483 → boîte x[316,338] × y[460,483], CENTRE (327 ; 471,5). Bouton EFFACER de la même ligne (accueil-effacer.png) : remplissage de x=277 à x=336 sur la ligne y=478, bordure haute y=468 et basse y=490 → boîte x[276,337] × y[468,490]. Le centre de la croix tombe DANS le rectangle du bouton de destruction. Et le passage est instantané : packages/client/src/scenes/ui/menu-dom.ts:222-228, le clic sur [data-x] fait `vue.mode = 'effacer'` puis `peindre()` — un repaint synchrone, sans délai ni garde.

**Ce que le joueur vit** — Il clique la petite croix pour se débarrasser d'une case. Sous son curseur, qui n'a pas bougé d'un pixel, la croix vient d'être remplacée par un bouton EFFACER. Un double-clic, un clic réflexe de confirmation, une souris qui rebondit — et le monde est parti. C'est le seul geste irréversible du jeu, et c'est celui qui demande le moins de mouvement. (Danger souris uniquement : le repaint détruit le nœud focalisé, le clavier ne peut pas enchaîner.)

**Direction de correction** — Déplacer la cible destructive hors de l'empreinte de la croix : soit intervertir les deux boutons (le refuge « revenir en arrière » à droite, sous le curseur, et EFFACER à gauche), soit poser la confirmation sur la ligne du dessous, soit — le plus sûr — n'activer EFFACER qu'après un court délai d'horloge Phaser. À vérifier ensuite en rejouant le smoke : le centre de la croix ne doit plus intersecter la boîte du bouton rouge.

*`accueil-deux-vallees.png` · `accueil-effacer.png`*

### L1-04 · Trois libellés de texte échouent AA à leur valeur spécifiée — le pire à 3,17:1 (et non 2,45)

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — La teinte fautive est `#6b6558`, écrite en dur cinq fois dans menu-dom.ts (lignes 769, 775, 788, 844, 864) et nulle part ailleurs dans le dépôt. Composites CSS calculés : fond de ligne = rgba(27,27,34,.55) sur #0f0b08 = #161416 ; fond de page = #0f0b08 ; fond de champ = #14100c. Ratios NOMINAUX (indépendants de la résolution) : nom d'une case vide 3,17 — invite « VALLÉE 2 » du champ de nom 3,27 — croix ✕ 3,17 — bouton ↺ 3,38 — groupes « SE DÉPLACER »/« AGIR » 3,38. Tous sous les 4,5 exigés. Et RELEVÉS sur les captures, où l'antialiasing les érode encore : « VALLÉE 2 » 3,19 · invite 3,27 · ✕ 2,88 · ↺ 3,09 · « SE DÉPLACER » 2,49 · « AGIR » 2,45. Pour la croix et le ↺, le seuil applicable est aussi celui des composants non textuels (3:1) : leur bordure ne les sauve pas — #3a3a44 sur #161416 ne fait que 1,63:1. La garde existante (palette.test.ts:72-89) ne prouve que `HEX.faint` ; une valeur en dur dans un module d'écran lui échappe entièrement.

**Ce que le joueur vit** — Les quatre cases vides de la liste des vallées portent leur nom dans un gris qu'on devine plus qu'on ne le lit. La croix qui détruit un monde est le bouton le MOINS visible de l'écran (2,88:1) alors que c'est le plus dangereux. Et dans les options, « SE DÉPLACER » et « AGIR » — la seule structure des seize lignes — sont à 2,45:1 : la table paraît être une liste plate parce que ses intertitres ne se voient pas.

**Direction de correction** — Calculer une valeur de remplacement, ne pas la choisir à l'œil : viser ≥ 4,5:1 sur les TROIS fonds concernés à la fois (#161416, #0f0b08, #14100c) tout en restant sous `dim` (#9a8f78) pour garder l'échelle d'encre. `#8b8474` (faint) y arrive déjà (4,93 / 5,27 / 5,13) — mais il faut alors trancher si `#6b6558` disparaît ou si on invente un cran entre les deux. Et surtout : ÉTENDRE la garde de contraste. Elle ne doit plus lire le seul objet `HEX`, mais balayer les sources des modules d'écran (`import.meta.glob`, l'idiome du dépôt) pour toute teinte de texte écrite en dur, et la rendre contre les trois fonds. On la prouve en glissant un `color:#6b6558` de test et en vérifiant qu'elle rougit EN NOMMANT le fichier et la ligne.

*`accueil-vallees.png` · `accueil-semer.png` · `accueil-options.png`*

### L1-16 · Le monde se rend en DAMIER de blocs clairs de 8 tuiles EXACTEMENT (RELIEF.MOTIF), sur tout le cadre — pas « deux lavis », et le sol seul

`MAJEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU (requalifié)

**Preuve** — MESURÉ, la description : deux quadrilatères translucides chauds recouvrent la moitié droite de la scène — l'un environ x[300,1200] × y[40,110], l'autre x[585,1200] × y[95,410]. Les arêtes sont RECTILIGNES et alignées sur les axes : la marche de luminance relative vaut 0,11 à 0,18 sur une transition de 6-7 px, et le bord vertical retombe sur x=585 pour y=160, 310 et 335. Le lavis teinte AUSSI les sprites, pas seulement le sol : un tronc lit #422c1b dehors et #504f24 dedans ; le sol #448b37 dehors et #a6c054 dedans. Il s'arrête net au bord du canvas (la bande noire y<40 reste #0e0e13, la première ligne de jeu y=42 est déjà teintée). SUSPECTÉ pour la CAUSE, et je ne l'ai pas résolue : la teinte chaude ressemble au `vec3(1.0, 0.94, 0.72)` des taches de soleil (soleil-layer.ts), mais leur shader est un bruit dappled borné à alpha 0,30 et ne produirait pas un aplat ; `clairiereForet` (zone-content.ts:1151-1157) quantifie bien par blocs de RELIEF.MOTIF = 8 tuiles avec une frontière FRANCHE, ce qui produirait mécaniquement des marches rectangulaires, mais je n'ai pas pu vérifier que la maille observée fait 8 tuiles.

**Ce que le joueur vit** — La toute première seconde de sa partie : une prairie coupée par deux grands rectangles de lumière jaune à angles droits. Rien dans un monde vu de dessus n'a d'arêtes droites de six cents pixels.

**Direction de correction** — Ne rien corriger sur cette base — la cause n'est pas établie et le lavis pourrait être une intention de direction artistique (le dépôt quantifie délibérément ses FX de lumière sur la grille de l'art). À passer au lot RENDU avec la mesure ci-dessus, et une question précise : est-ce un état de PREMIÈRE FRAME (le masque des taches est bâti au premier peuplement puis rafraîchi sur throttle — WorldScene.ts:364, 1668 — donc il peut être incomplet à t=0) ou un état permanent ? Une capture à t+3 s au même endroit tranche en une prise.

*`accueil-monde-seme.png`*

### L1-02 · L'invite de capture est tronquée par sa colonne : la case affiche « pressez un… »

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Recadrage ×8 de accueil-capture.png sur x[240,350] × y[455,480] : la case affiche littéralement « pressez un… », ellipse comprise. Le libellé posé est `pressez une touche…` (menu-dom.ts:500) dans une case de 106 px de grille (menu-dom.ts:848, `grid-template-columns:1fr 106px 28px`) avec `overflow:hidden;text-overflow:ellipsis` (menu-dom.ts:853-855). À 12 px de chasse fixe + 1 px d'interlettrage, moins 12 px de padding et 4 px de bordure, il reste la place d'environ onze signes — onze signes sont affichés.

**Ce que le joueur vit** — Il clique sur « Z · W · ↑ » pour changer sa touche. La case s'allume — bien — et lui dit « pressez un… ». Le seul moment de tout l'écran où l'interface doit donner un ordre, elle le donne à moitié. Le commentaire du code dit vouloir éviter « un état d'attente muet qui ferait croire à un clic perdu » : l'état est bien là, mais sa phrase ne tient pas.

**Direction de correction** — Raccourcir le libellé à ce que la case peut porter — « pressez… » (9 signes) tient, « une touche ? » aussi — ou sortir l'invite de la case (une ligne d'état sous la table). Poser un garde-fou de longueur : le libellé de capture ne doit jamais dépasser la largeur de colonne, et un test qui le mesure en signes tombera si quelqu'un rallonge la phrase.

*`accueil-capture.png`*

### L1-05 · Deux étiquettes passent AA sur le papier et échouent une fois rendues — c'est la taille, pas la teinte

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — `#8b8474` (le `faint` du dépôt, calculé et documenté) donne 4,93:1 sur le fond de ligne #161416 : conforme. Relevé sur la capture, la même teinte rend 3,53:1 sur « fonder une vallée » et 3,87:1 sur « à l'instant ». La cause est géométrique, pas chromatique : la planche est calée à 1920×1080 et mise à l'échelle par `fit()` = min(1280/1920, 800/1080) = 0,667 (menu-dom.ts:345-348) — vérifié par trois mesures indépendantes (padding 48 CSS → x=32 ; ligne 78 CSS → 52 px écran ; hauteur de capitale 11 px CSS → 6 px). Un libellé de 11 px CSS est donc peint sur 7,3 px physiques : ses fûts n'atteignent jamais leur couleur nominale. Même mécanique pour « v0.1.0 · ALPHA » (2,51-2,53:1) et le tampon de build (2,41:1). C'est dépendant de la résolution : absent à 1920×1080 exactement, présent à 1280×800 et pire en dessous.

**Ce que le joueur vit** — « fonder une vallée » — l'indice qui dit ce que fait une case vide — et l'horodatage d'un monde sont plus pâles sur son écran qu'ils ne le sont dans la maquette. Sur un portable 1366×768 ce sera pire encore.

**Direction de correction** — NE PAS RETEINDRE `faint` : sa valeur a été calculée (5,09 / 4,61 / 5,27 sur les trois fonds) et la remonter à l'œil casserait l'échelle d'encre documentée. Le levier est la taille : remonter les libellés de 11 px CSS à 13 px dans le rail (ils rendraient à 8,7 px physiques), ou cesser de faire porter une phrase par le plus petit corps de l'échelle. Une garde utile ici n'est pas un ratio de plus mais un plancher : aucun texte de l'écran sous N px CSS une fois la mise à l'échelle appliquée.

*`accueil-vallees.png` · `accueil-principal.png`*

### L1-06 · Le bouton EFFACER au repos est sous AA — l'image ne montre que son état survolé

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Le remplissage relevé dans accueil-effacer.png est #5d2720, or rgba(224,90,74,.3) — la règle `:hover` (menu-dom.ts:811) — composée sur le fond de ligne #24120f donne exactement #5c2821, tandis que le repos rgba(224,90,74,.16) (menu-dom.ts:810) donnerait #421d18. Le bouton photographié est donc SURVOLÉ, et à ce titre il est très lisible (texte #e9dfc6 sur #5d2720 = 8,91:1). Le REPOS, lui, est calculé et non photographié : #e05a4a sur #421d18 = 4,01:1 — sous les 4,5. À titre de comparaison, la phrase d'avertissement rouge #e05a4a sur le fond de ligne #24120f passe, elle, à 4,88:1.

**Ce que le joueur vit** — Tant que sa souris n'est pas dessus, le mot EFFACER est le texte le moins lisible de sa propre ligne d'avertissement. Ce n'est pas grave en soi — mais c'est le seul endroit du jeu où l'on doit lire avant de cliquer.

**Direction de correction** — Monter le remplissage de repos (rgba .16 → .26 ramènerait le texte au-dessus de 4,5) ou éclaircir le texte vers `bodyBright` sur ce bouton précis. Et refaire une capture du repos : le smoke doit écarter le curseur avant de déclencher, sinon aucun état de repos n'est jamais photographié.

*`accueil-effacer.png`*

### L1-07 · La ligne de fondation colle à son propre cadre, en haut comme en bas

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Profils verticaux relevés en x=100. La ligne fait y[446,497] (bordures comprises), soit 52 px écran = 78 CSS, la hauteur fixe annoncée. En mode REPOS (accueil-vallees.png) le contenu vit entre 389 et 429 : 7 px de blanc en haut, 9 en bas. En mode EFFACER : 20 px en haut, 7 en bas. En mode FONDATION (accueil-semer.png) : la bordure haute du champ de nom est en y=448, à DEUX pixels de la bordure de ligne (446-447), et la bordure basse des champs/boutons est en y=496, contre la bordure de ligne en 497 — zéro pixel. Le recadrage ×4 montre le doublement de trait qui en résulte, en haut comme en bas.

**Ce que le joueur vit** — Les quatre autres lignes respirent ; celle où il tape le nom de son monde est bourrée à ras bord, ses champs soudés au cadre. C'est le seul moment de l'écran où il écrit, et c'est le moment qui a l'air mal fini.

**Direction de correction** — Le mode `semer` empile deux rangées de contrôles dans une hauteur taillée pour deux rangées de TEXTE. Soit réduire le padding/la chasse des champs pour rentrer avec la même respiration que les autres modes, soit — mieux — laisser la ligne de fondation grandir (la raison de la hauteur fixe, « la liste ne doit pas sauter sous le curseur », vaut pour l'armement d'un EFFACEMENT, pas pour une ligne qu'on vient de cliquer et où l'on va taper).

*`accueil-semer.png` · `accueil-vallees.png` · `accueil-effacer.png`*

### L1-08 · Le bouton « seed au hasard » est un carré vide : le caractère n'existe pas dans la police

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Recadrage ×12 de accueil-semer.png sur x[120,148] × y[474,498] : le bouton de 32 CSS px (21 px écran) contient un rectangle ambre creux avec une marque interne indéchiffrable — pas les cinq points d'un dé. Le caractère posé est `⚄` (U+2684, menu-dom.ts:538). La police du voile est `'JetBrains Mono',ui-monospace,monospace` et n'embarque QUE les sous-ensembles latin 400 et 700 (game-font.ts:15-16, `jetbrains-mono-latin-400-normal.woff2` / `-700-`). U+2684 est hors du latin : SUSPECTÉ que ce soit le rectangle de glyphe manquant du navigateur. À noter que les émojis voisins (🔥 et ⛺ des tuiles JOUER) rendent, eux, parfaitement — c'est bien un symbole non-émoji qui manque, pas la couche émoji.

**Ce que le joueur vit** — À côté du champ « 2026 » il y a un petit bouton dont il ne peut pas savoir ce qu'il fait. Son infobulle (`title="une seed au hasard"`) n'apparaît qu'après une seconde de survol, et jamais au doigt. C'est précisément le bouton qui existe pour éviter d'avoir à comprendre ce qu'est une seed : il est illisible.

**Direction de correction** — Remplacer le glyphe par quelque chose que la police porte — un mot (« au hasard »), l'émoji 🎲 (la couche émoji fonctionne, c'est prouvé par 🔥/⛺), ou un petit SVG inline. Et poser un garde-fou : la liste des caractères non-ASCII employés par les modules UI DOM confrontée à ce que les woff2 embarqués couvrent — la même mécanique de lecture des sources que palette.test/typography.test.

*`accueil-semer.png`*

### L1-10 · Pendant la première seconde et demie, 70 % de l'écran d'accueil est noir

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — accueil-principal.png rend le même pixel de vitrine à #393622 quand accueil-vallees.png le rend à #ffffa0 ; la luminance moyenne de la zone vitrine (x 430-1276, y 40-760) y est de 0,0048 contre 0,0172 sur les autres frames — 28 %. Ce n'est PAS le voile du menu qui est en fondu : le titre y mesure exactement #e8763a et le fond du rail exactement #18110a, comme partout. C'est la vitrine seule. Le mécanisme est dans les images clés : `@keyframes bmVitrine{0%{opacity:0} … }` avec `VITRINE_FONDU_S = 1.6` (menu-dom.ts:83, 666-671) — la première vue naît à zéro et monte sur 1,6 s. Conséquence : la vitrine est plus SOMBRE que la colonne de menu (0,0144) pendant ce temps.

**Ce que le joueur vit** — Il lance le jeu. Pendant une seconde et demie, il a un logo, trois boutons, et un grand vide noir aux deux tiers droits de l'écran. Puis un village apparaît. Ce n'est pas cassé, mais c'est la première seconde du produit, et elle est vide.

**Direction de correction** — Deux réponses possibles, et c'est un choix de ton : faire naître la première vue à pleine opacité (image clé de départ à 1 pour la seule première vue, comme le fait déjà la règle `prefers-reduced-motion`), ou assumer un lever de rideau et le rendre volontaire. La deuxième conséquence, elle, est purement technique : le banc de smoke déclenche AVANT la fin du fondu — pour photographier l'accueil il faut attendre 1,6 s ou figer la boucle, sinon toutes les captures d'accueil mentiront sur la vitrine.

*`accueil-principal.png` · `accueil-vallees.png`*

### L1-11 · Le titre d'écran des OPTIONS n'a pas de rang à lui : 13 px, exactement la taille d'une ligne de la table

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Hauteurs de capitale relevées sur accueil-options.png (boîte englobante des pixels au-dessus du seuil de luminance) : « OPTIONS » (titre d'écran) 7 px · « LE SON » 6 px · « LES TOUCHES » 6 px · « SE DÉPLACER » 6 px · « Avancer » (une simple ligne de la table) 7 px. Le titre de l'écran est donc EXACTEMENT de la taille d'une ligne ordinaire. Le CSS le confirme : `.mw-sect` 13 px et `.op-sect` 12 px, même couleur #c98b3a, même interlettrage 4 px (menu-dom.ts:747, 819). Par contraste, l'écran des vallées sépare bien ses rangs : « VOS VALLÉES » 8 px contre « VALLÉE 1 » 11 px.

**Ce que le joueur vit** — Il ouvre les options et son œil ne trouve pas d'entrée : « OPTIONS », « LE SON », « LES TOUCHES », « SE DÉPLACER » sont quatre étiquettes ambre de la même taille, empilées. Rien ne dit ce qui contient quoi. C'est exactement la hiérarchie plate où l'œil ne sait pas où aller.

**Direction de correction** — Donner au titre d'écran un rang à lui — l'échelle typographique du dépôt est délibérément courte, il n'y a donc pas de taille à inventer : le distinguer par la graisse (700 comme les titres de ligne) et/ou par l'encre (`title`/`bodyBright` plutôt que l'accent ambre, en réservant l'ambre aux sections). Puis descendre les groupes (« SE DÉPLACER ») d'un cran net une fois leur contraste réparé (L1-04).

*`accueil-options.png` · `accueil-vallees.png`*

### L1-12 · Aucune capture ne montre le bas de la table des touches — le reste du constat (« le défilement ne se signale presque pas ») tient à la capture, pas au jeu

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — `ACTIONS` compte 16 entrées réparties en 5 groupes (keymap-perso.ts:28-45 : SE DÉPLACER ×6, AGIR ×3, BÂTIR ×2, OUVRIR ×4, LE SON ×1). La capture en montre sept nommées (Avancer → Parer) plus un fragment de la huitième : `.op-liste{max-height:352px}` (menu-dom.ts:836) soit 235 px écran. Le seul indice de continuation est le fondu de 22 px du `mask-image` — le code note lui-même que la barre de défilement mesure 0 px en Chromium headless. Et aucune capture ne montre le bas de la liste : le diff pixel entre accueil-options.png et accueil-options-fin.png ne trouve que l'étincelle de l'anneau et un survol de bouton ↺ ; la liste n'a pas défilé. Les neuf dernières lignes ne sont donc contrôlées par personne.

**Ce que le joueur vit** — Il ouvre les touches et voit six façons de marcher plus une de parer. « Personnage (sac, artisanat) », « Carte », « Chronique » — ce qu'on cherche vraiment — sont sous le pli, derrière un fondu de 22 px facile à prendre pour la fin de l'écran. La cause de fond est que la table des touches vit dans un rail de 30 % pendant que 70 % de l'écran montre une photo.

**Direction de correction** — Le rail à 30 % est LE nombre de cet écran et tout s'y réfère : l'élargir pour les options seules est une décision d'Alexis, pas un patch. Ce qui est du ressort technique : le smoke doit défiler la liste jusqu'en bas et capturer sa fin (« accueil-options-fin » ne montre pas la fin — le nom ment), sinon neuf lignes restent hors de tout contrôle visuel.

*`accueil-options.png` · `accueil-options-fin.png`*

### L1-14 · « son actif » nomme l'état, pas le geste — on ne sait pas ce que le clic va faire

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — menu-dom.ts:515 : le libellé du bouton est `${son.muted ? 'son coupé' : 'son actif'}` — il DÉCRIT l'état courant. Visuellement (recadrage ×4) c'est un bouton fantôme banal, sans case à cocher, sans témoin, sans icône ; rien ne le distingue d'un bouton d'action comme « annuler » ou « ← retour », qui, eux, nomment bien un geste. Le texte mesure 4,95:1, il est lisible : le problème est sémantique, pas chromatique.

**Ce que le joueur vit** — Il lit « son actif » sur un bouton. Est-ce qu'il clique pour ACTIVER le son, ou est-ce que ça lui dit que le son EST actif et qu'un clic le coupera ? Il doit essayer pour savoir. Un geste dont on ne peut pas prédire le résultat.

**Direction de correction** — Deux grammaires possibles, à trancher une fois pour tout le jeu (le menu pause a le même bouton) : le bouton dit le GESTE (« couper le son » / « rétablir le son »), ou il devient un témoin d'état visible comme tel (une case, un pictogramme allumé/éteint) et cesse de ressembler à un bouton d'action.

*`accueil-options.png`*

### L1-15 · Le volume est un vrai curseur, mais une cible de 9 px sans repères

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — C'est bien un `<input type="range">` (menu-dom.ts:513) avec un pouce ambre custom — le recadrage ×4 le montre en butée à droite, valeur « 100 % » à côté. Mais : rail 4 px CSS → 2,7 px physiques, et son ambiance #3a3225 sur #0f0b08 ne fait que 1,55:1 (seuil des composants non textuels : 3:1) ; pouce 14 px CSS → 9,3 px physiques. Aucune graduation, aucun 0/100 aux extrémités, aucune icône de haut-parleur — la seule chose qui dit « c'est du volume » est le mot « LE SON » deux lignes plus haut, et le nombre « 100 % » à droite (9,53:1, lui, très lisible).

**Ce que le joueur vit** — Une ligne presque invisible avec un petit point orange au bout. Le point est visible (6,75:1), la ligne ne l'est pas — donc on ne voit pas la COURSE, on voit une pastille posée dans le vide. Attraper 9 px à la souris demande de viser.

**Direction de correction** — Épaissir le rail (6-8 px CSS) et le remonter à au moins 3:1 contre le fond — `controlRail` #3a3225 est déjà nommé dans la palette pour ce rôle exact, c'est sa VALEUR qui est trop basse pour un fond aussi noir, ou bien il lui faut une piste remplie en ambre à gauche du pouce (qui rendrait la course lisible sans toucher au token). Élargir la zone cliquable du pouce sans grossir son dessin.

*`accueil-options.png`*

### L1-17 · Le premier conseil du jeu se pose à nu sur le monde et se dissout sur les zones claires

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Le conseil « F : cueillir baies & fibre. TAB : votre sac et l'artisanat. » est peint sans plaque, centré en haut, et traverse le lavis clair. Le remplissage est blanc : contre l'herbe normale #448b37 il fait 4,21:1 (sous AA), contre la zone claire #a7c153 il tombe à 2,02:1. Ce qui le sauve est le contour d'encre (`STROKE = #14141a`, épaisseur 3, typography.ts:26) qui, lui, rend 9,08:1 contre la zone claire — le texte reste lisible, mais comme des lettres SOMBRES cerclées, pas comme du texte blanc. Le recadrage ×2 le montre : sur la zone claire, le blanc a disparu et il ne reste que le tracé.

**Ce que le joueur vit** — La toute première consigne du jeu change d'apparence selon le sol qu'elle survole : blanche sur l'herbe sombre, noire et grêle sur les zones claires. Elle reste déchiffrable, mais elle n'a jamais l'air posée — elle flotte.

**Direction de correction** — Le contour fait déjà son travail (c'est exactement ce pour quoi il existe) ; ce qui manque est une plaque. Donner au conseil d'accueil le fond semi-opaque des autres bandeaux, ou l'ancrer dans une bande de largeur fixe — un message qui n'apparaît qu'une fois dans une partie mérite d'être vu comme un message, pas comme du texte flottant. À rapprocher du compteur « 0 / 60 » sous les médaillons, mesuré à 2,07:1 sur l'herbe, qui souffre du même défaut d'ancrage.

*`accueil-monde-seme.png`*

### L1-18 · L'effacement d'un monde ne produit aucun accusé de réception

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Comparaison accueil-effacer.png → accueil-apres-effacement.png : la ligne 2 redevient simplement « VALLÉE 2 / — case vide — / fonder une vallée ». Aucun bandeau, aucune ligne d'état, rien. Le code confirme qu'il n'y a pas d'autre retour : menu-dom.ts:288-302, `onDelete(slot)` puis `.finally(rouvrirToutes)` — la liste se repeint, un point. Et la branche `.catch` est explicitement vide (« le disque a refusé : la case reste telle quelle ») : un échec de suppression est donc, à l'écran, INDISTINGUABLE d'un succès sauf à relire la ligne.

**Ce que le joueur vit** — Il détruit soixante jours de jeu, et l'interface hausse les épaules. Dans le cas normal la case redevenue vide suffit à peu près ; dans le cas d'échec disque, il croira avoir effacé un monde qui est toujours là — ou l'inverse.

**Direction de correction** — Le succès peut rester muet (la case vide EST le retour). L'échec, lui, ne peut pas : donner au `.catch` une trace visible — la ligne qui reste pleine et se signale, ou un bandeau bref. Un geste irréversible qui échoue en silence est la pire des deux issues.

*`accueil-effacer.png` · `accueil-apres-effacement.png`*

### L1-19 · Le seed est exposé au tout premier écran, sans un mot pour l'expliquer

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — La sous-ligne de REPRENDRE, la seule phrase de l'écran d'accueil, lit « VALLÉE 1 — jour 1 · seed 2026 · à l'instant ». Le mot revient sur chaque ligne pleine des vallées (« jour 1 · seed 31415 ») et sur le champ de fondation, qui affiche « 2026 » nu. Nulle part il n'est glosé : la seule explication existante est l'`aria-label="seed de la vallée"` (menu-dom.ts:537), invisible à l'écran, et l'infobulle du dé (« une seed au hasard », ligne 538) dont le bouton est lui-même illisible (L1-08). En revanche il n'est PAS dangereux, et c'est mesurable : `brancherVallees` (menu-dom.ts:204-212) route une ligne PLEINE vers `onContinue(slot)` et n'ouvre le mode `semer` que sur une case vide — fonder ne peut jamais écraser une sauvegarde. Le champ est borné (`seedValide` : entier 0…999 999 999, mondes.ts:38-40) et refuse en se colorant en rouge plutôt qu'en silence.

**Ce que le joueur vit** — Le premier mot technique qu'il rencontre est « seed », et c'est sur la ligne qui décrit sa propre partie. Il ne peut rien casser avec — mais il ne peut rien en faire non plus, et le bouton qui existe justement pour qu'il n'ait pas à comprendre est un carré vide.

**Direction de correction** — Décision de ton, pas de code : « seed » a-t-il sa place sur l'écran d'accueil, ou seulement dans la ligne de fondation où il est un réglage ? La retirer de la sous-ligne de REPRENDRE (qui garderait « VALLÉE 1 — jour 1 · à l'instant ») coûte zéro information utile au joueur qui reprend. Là où il reste — le champ de fondation — c'est le dé réparé (L1-08) qui fait le travail d'explication, pas un texte.

*`accueil-principal.png` · `accueil-vallees.png` · `accueil-semer.png`*

---

## L2 — Captures — entrée en jeu  *(12 constats)*

### L2-01 · L'horloge de l'onboarding compte depuis le boot, pas depuis que le monde est prêt

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — /home/alexis/projects/ashes/packages/client/src/scenes/ui/onboarding.ts:23 documente le contrat : « msAlive : Millisecondes écoulées depuis que le monde est prêt ». /home/alexis/projects/ashes/packages/client/src/scenes/WorldScene.ts:2232 passe `msAlive: this.time.now` — l'horloge de la boucle Phaser, qui tourne pendant TOUTE la génération. Corroboré par le banc, qui a capté Text("Ramassez du bois : il vo") pendant le chargement : ce conseil exige msAlive ≥ MAKE_FIRE_DELAY_MS = 12000 (onboarding.ts:43), donc les 12 s étaient déjà consommées avant la première frame du monde. Les deux seuils (2000 et 12000) sont satisfaits dès l'instant zéro du joueur.

**Ce que le joueur vit** — Rien de visible — et c'est le problème : les deux conseils d'ouverture ont vieilli de 15,8 secondes derrière un voile noir avant que le joueur ait vu un seul pixel du monde.

**Direction de correction** — L'appelant doit fournir l'horloge que le contrat annonce : le temps écoulé depuis `worldReady` (WorldScene.ts:1021), pas `this.time.now`. Le résolveur pur et ses tests n'ont pas à bouger.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/chargement/chargement-fini.png` · `/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/default/monde.png`*

### L2-04 · Le poids porté (« ▲ 0 / 60 ») est invisible sur l'herbe : 1,04:1 pour l'encre, 3,44:1 pour son liseré

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — Sur monde.png, boîte x 12..86 / y 726..750. L'encre déclarée est `#7e8a94` (/home/alexis/projects/ashes/packages/client/src/scenes/ui/hud-core.ts:49, tier `light`), soit (126,138,148) ; le fond mesuré derrière est (123,141,69). Contraste WCAG calculé : 1,04:1 — les deux couleurs ont pratiquement la même luminance relative (0,2474 contre 0,2369). Sur les 1 776 pixels de la boîte, 15 seulement atteignent la couleur d'encre voulue ; 24 seulement sont plus bleus que rouges. Ce qui reste perceptible est le liseré d'un pixel `#14141a` (INK_OUTLINE, /home/alexis/projects/ashes/packages/client/src/scenes/ui/hud-dom.ts:80) : encre franche mesurée (45,54,38) contre fond (123,141,69) = 3,44:1, sous le seuil AA de 4,5:1. Le crop ×8 le confirme à l'œil : « ▲ » se devine, « 0 / 60 » est un fantôme creux.

**Ce que le joueur vit** — La jauge qui dit quand on ne pourra plus rien ramasser est illisible dès la première seconde, parce qu'elle est posée sur de l'herbe claire à 12 px.

**Direction de correction** — Deux leviers indépendants : la teinte `light` de CARRY_COLOR est un gris-bleu froid choisi sans référence au fond du jeu (l'herbe) ; et INK_OUTLINE à 1 px ne suffit pas à 12 px sur fond clair (le HUD utilise déjà INK_OUTLINE_STRONG à 1,5 px + ombre portée pour `.hc-day`, qui, lui, mesure 5,62:1). Le même défaut vaut a priori pour `.hc-zone`, `.hc-board` et `.hc-skills`, qui partagent `#9a8f78` + INK_OUTLINE.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/default/monde.png`*

### L2-03 · L'avatar est un rectangle bicolore plat — l'art de personnage n'existe pas encore, et le dépôt le sait

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Au centre exact de la caméra dans monde.png : un rectangle de 26×58 px, remplissage (221,201,162), cadre brun. Vu à ×10, aucune tête, aucun membre, aucune silhouette. Le code le dit littéralement — /home/alexis/projects/ashes/packages/client/src/render/lit-props.ts:183 : `draw: (c) => { c.fillStyle = '#8a6f3c'; c.fillRect(0, 0, 12, 24); c.fillStyle = '#f0e6c8'; c.fillRect(1, 1, 10, 22) }` ; et /home/alexis/projects/ashes/packages/client/src/scenes/BootScene.ts:28 : `this.makeSprite('spr-player', 0xf0e6c8, 0x8a6f3c)`. Le même bouchon sert d'avatar dans l'écran personnage (hud-character.ts:156 lit `spr-player` en base64). Autour de lui, les arbres, les champignons et les touffes sont des props cubiques finis.

**Ce que le joueur vit** — Le premier regard sur ASHES montre un monde peint et un joueur qui n'est pas dessiné. Toute la crédibilité de la scène tombe sur l'objet qu'on regarde le plus.

**Direction de correction** — Ce n'est pas un défaut réparable sans arbitrage : il faut décider l'investissement art (silhouette cubique 12×24 selon la recette existante — passes:1 / k:3.5 — et son miroir `_lit_m`), et jusqu'où va la lisibilité de l'orientation. Alexis tranche le budget et la direction ; la recette technique, elle, est déjà connue.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/default/monde.png`*

### L2-06 · La piste de l'anneau est invisible (1,15:1) : la jauge n'a pas d'état « ce qui reste »

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — /home/alexis/projects/ashes/packages/client/src/scenes/ui/loading.ts:107 peint `conic-gradient(#c98b3a <frac>%, #241a10 0)` sur le fond `#0f0b08` (loading.ts:178). Contraste WCAG calculé entre la piste #241a10 et le fond #0f0b08 : 1,15:1. Sur la capture à 92 %, l'échantillonnage à r=78 donne L=146 tout autour de l'anneau et L=47 au seul azimut 345° — le peu de piste restant ne se distingue pas du fond ; à r=82 (hors anneau) on lit L=18..27, c'est-à-dire le fond plus la lueur radiale.

**Ce que le joueur vit** — À 30 %, il ne voit pas un anneau rempli à un tiers : il voit un arc ambre isolé qui flotte, sans cercle de référence. La jauge ne dit sa fraction qu'au texte en dessous.

**Direction de correction** — La piste a besoin d'être séparable du fond (une teinte d'encre au-dessus de 3:1, ou un liseré). L'anneau est censé ÊTRE la progression (loading.ts:7-8) — sans piste visible, il ne l'est qu'à moitié.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/chargement/chargement.png`*

### L2-07 · L'écran de chargement ne nomme jamais la vallée qu'on vient de semer

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Le joueur nomme sa vallée et sème sa seed dans l'écran des mondes — l'hôte les reçoit et les garde (`mondeNom = nom`, /home/alexis/projects/ashes/packages/client/src/worker/sim-worker.ts:418 ; « le nom n'a de sens qu'ici : une vallée se nomme quand on la fonde »), et la seed « traverse TOUTES les passes » (/home/alexis/projects/ashes/packages/client/src/worker/veillee.ts:75-78). La planche de l'écran de chargement (loading.ts:190-211) ne contient que l'anneau, ASHES, « la Veillée », le geste et le pourcentage : aucune fente pour le nom ni pour la seed. Confirmé sur chargement.png : rien de tel n'apparaît.

**Ce que le joueur vit** — Il baptise un lieu, puis attend seize secondes devant un écran qui ne lui répète pas ce qu'il est en train de faire naître. Le geste le plus personnel de l'entrée est oublié entre deux écrans.

**Direction de correction** — Une ligne à ajouter ou à ne pas ajouter — mais c'est une décision de ton (le titre générique ASHES contre le nom propre de LA vallée du joueur), donc Alexis. Je note seulement que la matière existe déjà côté hôte et n'a pas besoin d'être fabriquée.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/chargement/chargement.png`*

### L2-08 · Le compteur ARPENTÉ n'a qu'un cran par point : « < 1 % » tient au moins la première minute de marche, puis avance d'un entier par ~240 tuiles

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Diff pixel à pixel entre brouillard-spawn.png et brouillard-apres-marche.png sur la boîte du bandeau (y 60..82, x 420..860) : 0 pixel au-dessus de 4 de luminance. Sur les onglets (y 50..80, x 20..250) : 0 également. La cause est dans /home/alexis/projects/ashes/packages/client/src/scenes/UIScene.ts:588 : `pct < 1 && pct > 0 ? '< 1' : Math.round(pct)` — tout ce qui est sous 1 % tombe dans un seul seau, puis le chiffre avance par entiers. Le banc a mesuré la progression réelle : 0,137 % → 0,17 %. Or ce bandeau a été écrit exactement pour ça (UIScene.ts:386-389 : « Nommer la part parcourue retourne le vide en JAUGE… C'est la ligne qui transforme le brouillard en moteur »).

**Ce que le joueur vit** — Il marche, il rouvre la carte, et le chiffre est le même mot pour mot. Le seul retour chiffré de l'exploration reste muet sur toute l'ouverture de la partie.

**Direction de correction** — Le seau « < 1 » ne rend rien de la première heure de jeu, qui est justement celle où le brouillard doit motiver. Il faut une résolution qui bouge dans ce régime (décimale, ou une unité autre que le pourcentage — cellules arpentées). Je ne peux pas mesurer sur deux frames au bout de combien de temps le chiffre franchit 1 % ; ce serait une mesure à faire au banc.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/brouillard/brouillard-spawn.png` · `/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/brouillard/brouillard-apres-marche.png`*

### L2-09 · Le brouillard n'existe pas dans le monde : il faut ouvrir un panneau pour savoir qu'on découvre quelque chose

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — `estVu` (/home/alexis/projects/ashes/packages/client/src/render/fog.ts:79) n'est appelé nulle part dans WorldScene : la recherche sur WorldScene.ts ne rend que `revele(...)` (lignes 1098 et 2326), la création (915) et la sauvegarde (1959). Le brouillard n'est consommé qu'en peinture de la texture de carte (UIScene.ts:560-582). monde.png le confirme : le monde est visible jusqu'aux bords du cadre, sans aucun masque. Et les deux captures de brouillard montrent que la carte est un onglet PLEIN ÉCRAN opaque (#14100c, UIScene.ts:379) : la consulter éteint le monde.

**Ce que le joueur vit** — En marchant, rien ne lui signale qu'il découvre. La mécanique n'a d'existence perceptible que s'il pense à ouvrir un panneau qui masque le jeu — et là elle lui montre une tache de 50 px dans un rectangle noir de 1048×563.

**Direction de correction** — Conséquence de jeu, donc Alexis. La spec assume explicitement la portée côté client et refuse un troisième état « vu mais pas en vue » (UIScene.ts:555-559) ; la question ouverte n'est pas celle-là mais : la découverte doit-elle avoir un signe DANS le monde (un accusé au franchissement d'une cellule neuve) ou reste-t-elle un savoir qu'on va consulter ? En l'état, la révélation avance par blocs de 8 tuiles (FOG_PAS, fog.ts:31 ; `r = ceil(22/8) = 3` cellules dans `revele`, fog.ts:59) — donc par paliers, jamais continûment.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/default/monde.png` · `/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/brouillard/brouillard-spawn.png`*

### L2-10 · Les cases de ceinture vides laissent voir les cailloux du monde : l'état « vide » n'a pas été dessiné

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — `.hc-slot{background:rgba(27,27,34,.8)}` (/home/alexis/projects/ashes/packages/client/src/scenes/ui/hud-core.ts:416) — 20 % de transparence. Le HUD DOM est au-dessus du canvas (z-index 40, hud-dom.ts:65), donc rien du monde ne peut être peint PAR-DESSUS : les taches sombres visibles à l'intérieur des cases 1, 2, 3 et 4 sur le crop ×6 sont du décor qui transparaît. On le vérifie : une même tache continue à travers l'interstice de 3,3 px entre les cases 1 et 2. Par ailleurs, aucun pixel ambre dans toute la bande de la ceinture (0 pixel proche de `#c98b3a` sur x 470..812, y 686..748) : le surlignage de case tenue (`.hc-slot-active`, hud-core.ts:313-314) est absent — cohérent avec `activeSlot = -1`, mains nues — et les six numéros mesurent la même encre terne (pixel le plus clair : 111 à 143 de luminance).

**Ce que le joueur vit** — Six carrés sombres où traînent des formes noires. Il ne peut pas dire si ses cases sont vides ou pleines, ni laquelle il « tient ». Aucun mot ne nomme la ceinture.

**Direction de correction** — Un fond de case à 0,8 d'alpha sur un monde contrasté ne peut pas porter un état vide. L'état « vide » et l'état « mains nues » sont deux états non dessinés, distincts de l'état « case tenue » qui, lui, existe déjà dans le CSS.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/default/monde.png`*

### L2-11 · Deux façons de fermer la carte, dans deux coins, avec deux touches — et la plus visible n'est pas la principale

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Sur brouillard-spawn.png, lisible dans l'image : « TAB — FERMER » en haut-droite et « molette : zoom · glisser : déplacer · M : fermer » en bas-droite (/home/alexis/projects/ashes/packages/client/src/scenes/UIScene.ts:383). Contrastes mesurés sur les pixels rendus : « TAB — FERMER » = 3,61:1 (encre (114,108,95) sur fond (19,17,16)), sous AA ; l'aide du bas = 6,54:1 ; le bandeau ARPENTÉ = 5,06:1 ; les onglets PERSONNAGE/MÉTIERS/CARTE = 15,32:1. Deux registres typographiques en plus : majuscules espacées + tiret cadratin d'un côté, minuscules + deux-points de l'autre.

**Ce que le joueur vit** — La sortie de l'écran est écrite deux fois, à deux endroits, avec deux touches différentes, et la mention la mieux placée est la moins lisible de l'écran — 4,2 fois moins contrastée que les onglets juste à côté.

**Direction de correction** — Une seule façon de nommer la sortie, à un seul endroit, au-dessus de 4,5:1 ; et une casse unique pour les libellés d'aide de cet écran.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/brouillard/brouillard-spawn.png`*

### L2-12 · Le bord du brouillard est un dégradé de 5 à 6 px, alors que le code promet des carrés francs

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Profils de luminance sur brouillard-spawn.png. Horizontal, y=340, bord gauche : x552=20 · 553=36 · 554=50 · 555=67 · 556=86 · 557=113 — six pixels de rampe. Bord droit : x590=128 · 591=105 · 592=80 · 593=56 · 594=31 · 595=20. Vertical, x=573 : y319=20 · 320=39 · 321=58 · 322=76 · 323=97 · 324=117. Deux directions orthogonales rampent, donc ce n'est pas un escalier de cellules. Or l'alpha écrit est binaire (`img.data[k+3] = fog.vu[i] ? 0 : 255`, UIScene.ts:578), le filtre est demandé en NEAREST (UIScene.ts:432) et l'intention est écrite trois fois : « étirée en NEAREST » (UIScene.ts:70), « le grossissement en NEAREST donne des carrés francs, la grammaire » (UIScene.ts:425), « des carrés francs, comme tout le reste du jeu » (fog.ts:30-31). Pour comparaison, dans le monde les arêtes de clairière sont des marches d'UN pixel (x622=149 → x623=187).

**Ce que le joueur vit** — Le brouillard s'ouvre en halo flou, comme une lampe, au lieu de se découper en blocs — la carte parle une autre langue que le reste du jeu.

**Direction de correction** — L'observation est mesurée ; la CAUSE ne l'est pas et je la marque comme telle. Piste à vérifier au harnais et non à l'œil : le masque `cols×rows` est gonflé à `map.width * TILE_PX` par `setDisplaySize` (UIScene.ts:435), soit un grossissement d'environ ×128, avant que `mapLayer.setScale(this.mapFit)` (UIScene.ts:540) ne le réduise — c'est dans cette chaîne agrandissement/réduction qu'un filtrage peut se réintroduire sous swiftshader malgré `setFilter(NEAREST)`.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/brouillard/brouillard-spawn.png` · `/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/brouillard/brouillard-apres-marche.png`*

### L2-13 · Le sol de la première vue se lit en grands rectangles à arête franche

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Sur monde.png, les teintes de sol mesurées dans deux plages voisines : (176,202,88) µ=188,43 σ=8,68 contre (68,134,54) µ=114,07 σ=13,81 — un rapport de luminance de 1,65×. Les arêtes sont des MARCHES D'UN PIXEL, pas des transitions : profil moyenné sur 80 lignes, x614..622 = 150 puis x623..630 = 187 ; et x901..909 = 189 puis x910..917 = 148. L'énergie de bord verticale moyennée sur 580 lignes fait ressortir des fronts droits à x=298, 333, 585, 622, 909, 946, 1161, 1198 — tous congrus à 9 modulo 36, c'est-à-dire tous alignés sur la grille des tuiles (zoom 2,25 ⇒ 36 px/tuile, VISIBLE_TILES_TALL=20 dans /home/alexis/projects/ashes/packages/client/src/render/framing.ts:24). Le code REVENDIQUE cette grammaire : « Tout est rectiligne (R32) : le champ décide, le carré de 8 exécute » (/home/alexis/projects/ashes/packages/sim/src/racine-relief.ts:65-67) et « LES CLAIRIÈRES : décidées par BLOC → des trouées RECTANGULAIRES » (/home/alexis/projects/ashes/packages/sim/src/zone-content.ts:1106, 1144-1146). Je mesure les arêtes ; le pas de 8 tuiles, lui, vient du code et non de mes profils (mes écarts entre fronts forts valaient 7,97 · 9 · 7 tuiles).

**Ce que le joueur vit** — La première image du monde est un damier de grands rectangles clairs et sombres à angles droits. Selon l'œil, c'est un parti pris graphique franc — ou une carte de tuiles pas finie.

**Direction de correction** — Rien à réparer : c'est écrit comme intentionnel. La seule question, et elle est pour Alexis : à un zoom de 2,25 (un bloc de 8 tuiles fait 288 px, soit près d'un quart de la largeur de l'écran) et avec un écart de teinte de 1,65×, la grammaire rectiligne se lit-elle comme direction artistique ou comme couture ? Je ne touche à rien avant.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/default/monde.png` · `/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/chargement/chargement-fini.png`*

### L2-14 · Les quatre vitales n'ont ni chiffre ni nom au repos : l'infobulle est le seul libellé

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Quatre disques pleins de 70 px (rouge, jaune, vert, bleu) avec une icône en silhouette noire (`filter:brightness(0)`, /home/alexis/projects/ashes/packages/client/src/scenes/ui/hud-core.ts:406). Le remplissage est un liquide qui monte (`.hc-fill{height:0 → n%}`, hud-core.ts:405) : à plein, le médaillon est un aplat, et rien ne distingue 100 de 95. Le seul libellé est `.hc-tip`, `opacity:0` sauf `:hover` (hud-core.ts:407-408) — absent des captures, et hors de portée d'une manette ou d'un joueur qui ne survole pas. Profils verticaux mesurés au centre des quatre disques : aucune graduation, aucun chiffre.

**Ce que le joueur vit** — À l'entrée dans le jeu, quatre ronds de couleur avec des pictogrammes et aucun mot. Rien ne dit lequel est la faim, laquelle est la température, ni à combien il en est.

**Direction de correction** — Question de parti pris (HUD muet et lu à la couleur, contre HUD nommé), donc Alexis. Le fait mesurable à lui soumettre est que l'unique canal de nommage dépend d'un survol souris, qui n'existe pas au premier regard ni sur manette.

*`/tmp/claude-1001/-home-alexis-projects-ashes/f86d9bee-e930-4dcd-ba94-0929e6833e95/scratchpad/ux/default/monde.png`*

---

## L3 — Captures — panneaux  *(12 constats)*

### L3-03 · L'artisanat n'a pas d'état vide DESSINÉ — le vide de la minute zéro est correct (D2), mais rien ne le dit et « STATIONS ABSENTES ICI » oriente vers la mauvaise cause

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — `craftRows(seen, query)` filtre sur `seen` (craft-panel.ts:127 `if (!seen.includes(id)) return false`) ; `craft-panel.test.ts:37` affirme littéralement `expect(craftRows([], '')).toEqual([])`. Côté rendu, hud-character.ts:428 `listEl.innerHTML = ''` puis la boucle sur `rows` — quand `rows` est vide il ne se passe plus rien, et le CSS ne contient ni `:empty`, ni classe de vide (grep `:empty|hch-vide` sur hud-character.ts : aucune occurrence). Le vide lui-même est LÉGITIME : `decouverte.ts` (règle D2, 2026-08-01) ne révèle une recette qu'au contact de sa matière, donc `seen` est vide à la minute zéro par construction. Le défaut est donc précis : l'état vide voulu n'a pas de dessin. Aggravant, MESURÉ dans la même session (build 2026-08-20 12:25:33 sur les cinq captures) : le bandeau d'onboarding de sac-hud.png promet « TAB : votre sac et **l'artisanat** ». Et le même fichier SAIT dessiner un état vide 26 lignes plus haut — `.hch-mp-none` « une pente, pas des marches », mesuré à 4,64:1, pour la colonne Artisan.

**Ce que le joueur vit** — Le tutoriel dit « TAB : votre sac et l'artisanat », on presse TAB, et la moitié droite de l'écran — 600 px de large, 530 px de haut, un tiers de la surface — est vide sous un titre et un champ de recherche. Rien ne dit si c'est cassé, s'il manque des ressources, ou s'il faut débloquer quelque chose. La seule phrase présente, « STATIONS ABSENTES ICI », suggère la MAUVAISE réponse : le joueur va croire qu'il lui manque un atelier, alors qu'il lui manque simplement d'avoir ramassé sa première fibre.

**Direction de correction** — Dessiner l'état vide de `.hch-list`, dans la même grammaire que `.hch-mp-none` : une phrase centrée qui dit la RÈGLE (« ramasse une matière et sa recette apparaît ici ») et non l'absence. Distinguer les deux vides : « rien de découvert » ≠ « la recherche ne rend rien ». Et prouver la garde : un test qui monte le panneau avec `seen: []` et exige un nœud non vide dans `.hch-list`, cassé volontairement d'abord.

*`craft.png` · `sac-inventaire-ouvert.png` · `sac-hud.png`*

### L3-01 · À 0,667 d'échelle, la SEULE règle à 9px du dépôt — les six étiquettes DÉCORATIVES du paperdoll — tombe à 2,5–3,6:1 ; au-delà de 10px l'encre atteint bien sa valeur

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — La planche DOM est à 1920×1080 et mise à l'échelle FIT (hud-dom.ts:44, `Math.min(window.innerWidth/1920, window.innerHeight/1080)`) : à 1280×800 le facteur vaut exactement 0,667. Étiquette d'équipement `.hch-eq-lbl` (hud-character.ts:594) : `font-size:9px;color:#8b8474` → 6,0 px rendus. Valeur DÉCLARÉE sur son vrai fond (`rgba(27,27,34,.5)` sur `#14100c` = #171517) : 4,89:1, AA. Pixel le plus clair MESURÉ dans le mot « TÊTE » (zone 490,131,24×10 de craft.png) : #5d574e sur #181617 = **2,52:1**. Aucun pixel du glyphe n'atteint la couleur déclarée — le lissage l'a dilué avant. Même mécanisme sur `.hc-craft-tag` (hud-core.ts:386, 10px → 6,7 px rendus).

**Ce que le joueur vit** — Les six étiquettes du paperdoll (TÊTE, DOS, TORSE, JAMBES, MAINS, PIEDS) sont des taches grises dont on devine la longueur, pas des mots. On ne sait pas ce que chaque case du personnage accueille — et comme aucune n'est remplie, l'écran central du jeu est six carrés muets.

**Direction de correction** — Le ratio doit se calculer sur le px RENDU, pas sur le px de maquette. Poser un plancher de taille dans la planche 1920 (aucun texte sous ~14px de maquette = 9,3px à 1280) et rendre le ratio des teintes de texte à la taille où elles vivent vraiment. Réserve honnête : à 1920×1080 le facteur vaut 1,0 et ces échecs disparaissent — mais à 1366×768 il vaut 0,711 et à 1600×900 0,833, donc tout écran de portable est concerné, pas seulement le banc.

*`craft.png` · `sac-inventaire-ouvert.png` · `juice-toasts.png`*

### L3-02 · Une encre anonyme sous AA (3,13:1 mesuré) porte les 8 paliers verrouillés — la garde de palette ne regarde ni `panelWarm` ni les teintes sans nom

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — hud-character.ts:710 `.hch-mp.is-locked{color:#6f685a;}` sur la carte `#16120d`. Calculé : **3,38:1** (AA demande 4,5). Pixel le plus clair MESURÉ dans la ligne « niv 5 Le vert est au plus large… » (zone 128,261,212×16 de craft-metiers.png) : #6a6355 → **3,13:1**. Le marqueur hud-character.ts:711 `#4a453a` : 1,96:1 calculé, 1,90:1 mesuré. Décompte exact des lignes, vérifié dans skill-guide.ts (l.116-119, 131-135, 150-153) et dans l'image : Bûcheron [2,5,5,8], Mineur [2,5,5,8,10], Cueilleur [3,6], Artisan [] = 11 lignes, dont 3 « ▶ » et **8 verrouillées**. Le mécanisme : `palette.test.ts:88` ne teste AA que pour `HEX.faint`, et seulement sur `bgWarm/panel/bg` — `panelWarm` (#16120d, le fond de ces cartes) n'est pas dans la liste, et une teinte ANONYME n'entre jamais dans la boucle. #6f685a est le frère jumeau du #6f6a60 retiré le 2026-07-24 à 3,52:1 : la valeur bannie est revenue sans nom, par la porte que la garde ne surveille pas.

**Ce que le joueur vit** — Sur l'onglet MÉTIERS, ce qui est ACQUIS et ce qui est PROCHAIN se lisent bien ; tout ce qui reste à conquérir — c'est-à-dire la promesse entière du métier, huit lignes sur onze — s'efface dans le fond. Le joueur voit qu'il y a « quelque chose plus tard » sans pouvoir lire quoi. La fiche vend le métier avec l'argument illisible.

**Direction de correction** — Calculer la teinte de remplacement (comme pour faint en juillet) : il faut ≥4,5:1 sur #16120d tout en restant sous `dim` (#9a8f78, 5,84:1 sur ce fond) pour préserver l'écart. Et élargir `palette.test.ts` : ajouter `panelWarm` à la liste des fonds, et surtout faire échouer la garde sur toute teinte de TEXTE sous 4,5:1, nommée ou pas — la prouver en la cassant sur #6f685a et en vérifiant qu'elle NOMME hud-character.ts:710.

*`craft-metiers.png`*

### L3-04 · Seul le palier « léger » diverge vraiment — olive dans l'écran perso contre le « gris acier » que la spec nomme ; la DOUBLE lecture, elle, est PRESCRITE par portage P11

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Dans craft.png, deux éléments simultanés disent la charge. En bas-gauche, hud-core.ts:291 `▲ ${carry} / ${CARRY.CAPACITY}` coloré par `CARRY_COLOR` (hud-core.ts:48, `light: '#7e8a94'`) — pixel mesuré en (16,731) : **#7e8a94**, un gris-bleu. En bas-centre, hud-character.ts:512 `${w} / ${CARRY_CAP} — ${TIER_LABEL[tier]}` coloré par `TIER_COLOR` (hud-character.ts:60, `light: '#8a9a4a'`) — pixel mesuré en (718,554) : **#8a9a4a**, un olive. Deux fichiers, deux rampes complètes qui divergent sur trois des quatre paliers (`medium` #c98b3a vs #c9a24a, `heavy` #e8763a vs #d07a2a, seul `overloaded` #e05a4a coïncide). Une troisième rampe dort dans inventory-panel.ts:176 — code MORT, `createInventoryPanel` (l.224) n'est appelé nulle part (grep : seules les fonctions pures du fichier sont importées).

**Ce que le joueur vit** — À 660 px d'écart sur le même écran, deux chiffres disent la même chose de deux façons : « ▲ 0 / 60 » en gris-bleu et « 0.0 / 60 — LÉGER » en vert. Le joueur ne peut pas savoir que c'est la même jauge — la couleur, qui est censée être le code d'état, dit deux choses différentes du même état.

**Direction de correction** — Une seule rampe, nommée, dans palette.ts, importée par les deux écrans (les seuils viennent déjà de `carryTier` côté /sim — c'est la COULEUR qui a été recopiée). Et supprimer la rampe morte d'inventory-panel.ts avant qu'elle soit re-branchée : au passage, c'est le seul endroit du dépôt où la conséquence est écrite (« lourd (pas de sprint) »), et personne ne la lit.

*`craft.png` · `sac-inventaire-ouvert.png` · `sac-hud.png`*

### L3-05 · Les cases du sac — de vraies cibles de dépôt — sont à 1,11:1 contre la page ; les fiches de métier et le rail de jauge, eux, ne sont pas des composants au sens de 1.4.11

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Calculs sur les valeurs du CSS, confirmés au pixel dans craft.png / craft-metiers.png. Case du sac `#1b1b22` sur la page `#14100c` : **1,11:1** ; sa bordure `#14141a` sur la page : **1,03:1** ; la bordure contre sa propre case : 1,07:1. Fiche de métier `#16120d` sur la page : **1,02:1**, bordure 1,03:1 (mesuré : le bord gauche de la colonne 1 est une raie de 2 px à x=86-87). Rail de jauge `#2a2320` sur la fiche : 1,21:1. Case ARMÉE de la ceinture contre la case au repos, MESURÉ : #1a191f contre #1a191d = **1,00:1** — la différence de fond ne vaut rien, seul le liseré ambre (6,53:1) porte l'état. WCAG 1.4.11 demande 3:1 pour la frontière d'un composant.

**Ce que le joueur vit** — La grille du sac et les quatre fiches de métier sont SUGGÉRÉES, pas dessinées : on devine des rectangles un peu moins noirs que le noir. Sur un sac vide, il faut chercher où sont les cases. Sur MÉTIERS, les quatre colonnes flottent sans cadre — l'œil ne sait pas si c'est un tableau ou quatre paragraphes.

**Direction de correction** — Un seul geste corrige les cinq instances : remonter la bordure des conteneurs à ≥3:1 contre la page (une valeur autour de #3a3a44 — `HEX.bordSombre` existe déjà et vaut 1,7:1, il faut plus clair), ou creuser le fond de page. Rendre le ratio conteneur/page comme on rend celui du texte, et le garder par un test.

*`craft.png` · `craft-metiers.png` · `sac-inventaire-ouvert.png`*

### L3-06 · Dix tailles de police pour une échelle qui en déclare quatre — et les trois titres de section n'en partagent aucune

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — `typography.ts:57` : « L'ÉCHELLE est courte, exprès » — `SIZE = { title: 15, body: 14, label: 12, small: 11 }`, et `SECTION_TITLE` = 15px. Comptage sur les sources : hud-character.ts déclare 9, 11, 12, 13, 14, 16, 17, 18 px (8 valeurs, 29 déclarations) ; hud-core.ts déclare 10, 11, 12, 14, 15 px. Union : **dix tailles**. Les trois titres de section du même écran : `.hch-sac-t` « SAC » = 13px (l.571), `.hch-art-t` « ARTISANAT » = 17px (l.633), `.hch-doll-h` « PERSONNAGE » = 17px (l.589). Aucun n'emploie SECTION_TITLE. « SAC » est 24 % plus petit que ses deux voisins. Le garde `typography.test.ts` verrouille la CHASSE (`fontFamily`), pas l'ÉCHELLE — c'est pourquoi la dérive est passée.

**Ce que le joueur vit** — Sur un même écran, trois en-têtes de même rang ont trois poids visuels : ARTISANAT et PERSONNAGE s'imposent, SAC a l'air d'une sous-légende. L'œil ne sait plus quels blocs sont des pairs. Et comme tout se rend à 0,667, l'écart entre 12 et 13 px de maquette vaut 0,7 px à l'écran : dix tailles produisent trois différences perceptibles et sept bruits.

**Direction de correction** — Étendre le garde de typographie à l'ÉCHELLE : aucun `font-size` hors de la liste de `SIZE` dans les modules UI DOM (avec un rendu des px effectifs à 0,667). Prouver la garde en cassant un `font-size:13px` et en vérifiant qu'elle nomme le fichier et la ligne.

*`craft.png` · `sac-inventaire-ouvert.png` · `craft-metiers.png`*

### L3-07 · « LOURD » ne dit pas qu'il refuse le sprint — régression contre portage.md P11, déjà tranchée

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — hud-character.ts:512 compose `${w.toFixed(1)} / ${CARRY_CAP} — ${TIER_LABEL[tier]}` : ni unité, ni où commence le palier suivant. Les seuils existent et sont durs (`CARRY.LIGHT_MAX 0.33`, `MEDIUM_MAX 0.66`, `HEAVY_MAX 1` — balance.ts:4068), les conséquences aussi : `SPEED_MEDIUM 0.85`, `SPEED_HEAVY 0.7`, `SPEED_FLOOR 0.2` (balance.ts:4073-4082) et surtout sim.ts:643 `const canSprint = tier === 'light' || tier === 'medium'` — dès LOURD, le sprint est REFUSÉ, pas ralenti. Rien de tout cela n'est écrit à l'écran ; le seul texte du dépôt qui le dit, « lourd (pas de sprint) » (inventory-panel.ts:185), est dans du code mort.

**Ce que le joueur vit** — On lit « 0.0 / 60 », on ne sait pas de quoi (kg ? litres ? unités ?), on lit « LÉGER » sans savoir à quel chiffre ça cesse de l'être, et surtout on découvre la sanction en la subissant : un jour on ne sprinte plus et on ne sait pas pourquoi. La décision de charger — qui est censée être un vrai arbitrage de survie — se prend à l'aveugle.

**Direction de correction** — À prouver puis à trancher par Alexis : faut-il écrire la conséquence dans la ligne (« LOURD — plus de sprint »), marquer les seuils sur une jauge, ou laisser le joueur l'apprendre par le corps ? Je note seulement que la phrase qui le disait a existé et a été perdue en changeant d'écran, et que les deux écrans qui affichent la charge aujourd'hui ne le disent ni l'un ni l'autre.

*`craft.png` · `sac-inventaire-ouvert.png` · `sac-hud.png`*

### L3-08 · Le rail de la barre de métier est à 1,21:1 — sous le seuil non-textuel (il n'est pas invisible, et le « niveau 0 » est un état de spawn)

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — `paintMet` (hud-character.ts:257-274) écrit `niveau ${level}` et fixe la largeur du remplissage à `frac` — aucun chiffre d'expérience, aucun « il te reste N ». Au niveau 0 sans xp, `frac = 0` : `.hch-met-fill` a une largeur de 0 %, il ne reste que le rail `.hch-met-bar{height:5px;background:#2a2320}` → 3,3 px rendus à **1,21:1** contre la carte. Vérifié dans craft-metiers.png : les quatre barres sont des raies vides. Ce qui MARCHE en revanche : le prochain palier est marqué « ▶ » et dit ce qu'il débloque, en toutes lettres (« La hache d'atelier rend à plein (×3) »).

**Ce que le joueur vit** — On sait ce que le niveau 2 donnera. On n'a aucune idée de la distance qui en sépare : la barre est vide, il n'y a pas de nombre, et rien ne dit si c'est trois arbres ou trente. La fiche promet sans jamais chiffrer l'effort — au niveau 0, la progression n'a aucun retour du tout.

**Direction de correction** — Prouvé, à trancher par Alexis : montrer l'xp brute, une fraction (« 12 / 100 vers niv 1 »), ou un compte concret d'actions restantes ? Correctif purement technique et indépendant, lui, de mon ressort : rendre le rail visible (1,21:1 aujourd'hui) pour qu'une barre à 0 % se distingue d'une barre absente.

*`craft-metiers.png` · `sac-inventaire-ouvert.png`*

### L3-10 · Une partie neuve ne donne au joueur aucune case courante à la ceinture

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Scan de la bande de ceinture de sac-hud.png (470,685,340×62) : **0 pixel** dans un rayon de ±26 sur #c98b3a — aucune case active. Idem dans craft.png (les 6 bordures mesurent #14141a). La capture sac-inventaire-ouvert.png en montre une (case 2, ambre mesuré) : le rendu de l'état actif FONCTIONNE. La cause est en amont : `UIScene.ts:739` `getHud(this.registry,'activeSlot') ?? -1`, et `hud-bridge.ts:48` recopie `me.activeSlot` de la sim. Donc « aucune case » est le rendu CORRECT de « rien de sélectionné » — ce n'est pas un défaut d'affichage.

**Ce que le joueur vit** — À la première seconde, la ceinture est une rangée de six cases vides dont aucune n'est désignée. Rien ne dit qu'on peut en tenir une, ni laquelle est « en main » quand on cliquera sur un arbre. L'affordance principale du HUD démarre éteinte.

**Direction de correction** — Prouvé, à trancher par Alexis : une partie neuve doit-elle démarrer sur la case 1 armée (comme Rust/Minecraft) ou la sélection doit-elle se mériter au premier objet ? C'est une décision de sim (`me.activeSlot` à la création), pas d'UI — je ne la prends pas.

*`sac-hud.png` · `craft.png` · `sac-inventaire-ouvert.png`*

### L3-11 · Deux fiches de métier sur quatre sont au tiers vides, et le bloc entier flotte au-dessus de 184 px de rien

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Sur craft-metiers.png, les quatre cartes s'étirent à la même hauteur (bordures mesurées y=104..507, gauche x=87 et droite x=1192 — `.hch-met-row` est un flex en `stretch`). Balayage du dernier pixel encré par colonne : Bûcheron y=469 (38 px de vide), Mineur y=486 (21 px), **Cueilleur y=372 (135 px)**, **Artisan y=360 (147 px, soit 220 px de maquette — 36 % de la carte)**. Sous les cartes, `.hch-met{bottom:120px}` réserve jusqu'à y=680 alors que le contenu s'arrête à 507 : 184 px de bande vide jusqu'à la ceinture. Détail qui aggrave la lecture : Bûcheron et Mineur portent chacun DEUX lignes consécutives étiquetées « niv 5 » — légitime côté sim (skill-guide.ts:116+118 et 131+133 tombent au même niveau) mais l'œil lit un doublon.

**Ce que le joueur vit** — Quatre colonnes de même taille dont deux sont manifestement inachevées : Artisan est une carte pleine hauteur avec un tiers de vide en bas et une seule phrase là où les autres ont une échelle. Le métier a l'air non fini plutôt que différent. Et l'ensemble est tassé dans la moitié haute de l'écran, avec un grand rien entre les fiches et la ceinture.

**Direction de correction** — Deux choses séparables. Technique : laisser les cartes prendre leur hauteur propre (`align-items:flex-start` sur la rangée) plutôt que s'étirer sur la plus longue, et recentrer verticalement le bloc dans l'espace qui lui est réservé. Lisibilité : regrouper les paliers de même niveau sous un seul « niv 5 » — ils désignent le même moment de la progression.

*`craft-metiers.png`*

### L3-13 · Ce lot ne permet PAS de juger le sac rempli, les quantités, ni aucun survol

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Les douze cases du sac sont vides dans les cinq captures (mesuré : `.hch-cell` uniforme #1b1b22 sur 100 % de la zone échantillonnée), la ceinture est vide, la liste de recettes est vide. Je n'ai donc AUCUNE preuve sur : la distinction case pleine / case vide, la lisibilité du compte `×N`, l'usure `.hch-wbg`, le survol `.hch-rec:hover{background:#2a2a34}` (1,06:1 contre la ligne au repos — un écart que je peux calculer mais pas voir), l'état d'erreur, l'état de chargement. Projection non prouvée : `.hch-ct` (11px → 7,3 px rendus, hud-character.ts:576) et `.hch-num` (idem) tombent dans le même piège de lissage que L3-01, donc leurs 12,99:1 et 5,36:1 déclarés sont probablement optimistes — mais je ne l'ai pas MESURÉ.

**Ce que le joueur vit** — Inconnu. C'est précisément le point : la moitié des états de ces panneaux n'a été photographiée par personne.

**Direction de correction** — Réclamer au banc un lot complémentaire : sac avec objets empilés (compte ≥ 10) et un outil usé, liste d'artisanat avec les trois états (FAISABLE / MANQUE / EXIGE) et un survol tenu, un conteneur ouvert. Sans ces frames, les questions ② et le survol restent sans réponse — et je ne les inventerai pas.


### L3-12 · Trois noms et deux orthographes pour la même chose : MÉTIERS / NIVEAUX / « niv 0 » vs « niveau 0 »

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Dans sac-inventaire-ouvert.png, l'onglet s'appelle « MÉTIERS » et la section de gauche qui liste les quatre mêmes entrées s'appelle « NIVEAUX » (mesuré à (38,289), pic #c58838). Les fiches compactes écrivent `niv 0` (hud-character.ts:166) ; les fiches pleines de l'onglet MÉTIERS écrivent `niveau 0` (hud-character.ts:196 et 262, mesuré à (1120,125)). Même donnée, même écran, trois libellés.

**Ce que le joueur vit** — Deux listes des mêmes quatre métiers, sous deux titres différents, avec deux abréviations du même mot. Rien n'est faux, mais rien ne dit non plus que c'est la même chose — l'onglet MÉTIERS a l'air d'un contenu nouveau alors qu'il détaille la colonne déjà lue.

**Direction de correction** — Un seul mot pour la chose (MÉTIERS partout, la section de gauche incluse) et une seule forme pour le rang (`niveau N` ou `niv N`, pas les deux). Le libellé du métier vient déjà d'une source unique (`SKILL_LABELS`) : le rang peut suivre le même chemin.

*`sac-inventaire-ouvert.png` · `craft-metiers.png`*

---

## L4 — Captures — affordances dans le monde  *(13 constats)*

### L4-3 · L'arbre n'a pas de contour, et c'est DÉCIDÉ — mais sa compensation est cinq fois plus faible que son propre état d'échec

`MAJEUR` · `design` · `MESURÉ` · statut : NOUVEAU

**Preuve** — C'est un choix écrit et argumenté, pas un oubli : `aim.ts:615-625` — « Un arbre ou un rocher se récolte au CLIC, pas à `F` — ils ne sont donc pas des cibles d'interaction », et `snapshot-view.ts:1905-1909` — « la teinte dit “c'est ce que je vise” (tout nœud, arbre compris), le contour dit “`F` agit dessus” (la cueillette seule) ». L'arbre a donc SA propre affordance : `AIM_TINT = 0xffe9a8` en `TintModes.MULTIPLY` (1896, 2023). Or MULTIPLY ne peut que RETIRER de la couleur — le fichier lui-même l'a consigné huit lignes plus haut (`snapshot-view.ts:108-110`, « mesuré le 2026-08-20 »). Appliquée aux pixels RÉELS d'un houppier de mes captures (#357634, L=99,4, σ interne 26,7) : à portée, #356c22, L=91,0 — l'arbre s'ASSOMBRIT de 8,5 %, Weber 0,085, ΔL/σ = 0,32 ; hors de portée (#8a8a92), L=54,1, −45,6 %, Weber 0,456, ΔL/σ = 1,70. Même verdict sur un tronc (0,076 vs 0,463) et sur un buisson (0,075 vs 0,458). PROVENANCE : pixels mesurés dans les captures, opérateur pris à la source ; AUCUNE capture de ce lot ne montre un arbre teinté.

**Ce que le joueur vit** — Le buisson s'allume d'un trait blanc franc, la pile s'allume, le Feu s'allume. L'arbre, lui, s'assombrit de 8 % — un tiers de sa propre bigarrure. Le joueur qui a appris « ce qui s'allume, je peux le toucher » lit l'arbre comme du décor. Pire : le seul état où l'arbre RÉAGIT nettement (−46 %) est celui qui dit « tu ne peux pas ». Le signal d'interdiction crie, le signal d'invitation chuchote.

**Direction de correction** — CONSÉQUENCE DE JEU, JE NE TRANCHE PAS. Trois voies s'excluent : (a) étendre le contour à tout nœud visé et le décliner par état (le clic aussi est un verbe) — mais il faudrait passer par le MÊME résolveur, jamais une seconde cascade (voir « ce qui marche ») ; (b) garder l'arbre hors du contour mais rendre sa teinte de visée VISIBLE, ce qui exige un aplat (`TintModes.FILL`) ou une seconde couche, puisque MULTIPLY ne peut pas éclaircir ; (c) assumer que l'arbre s'apprend par le geste et non par le survol — alors il faut l'ENSEIGNER (voir L4-11). Alexis décide.

*`contour-buisson.png` · `abattage-jauge.png` · `epuisement-arbre.png`*

### L4-1 · Le liseré blanc n'est pas éclairé : sa force varie d'un facteur 3,4 du jour à la nuit — mais sur tous les fonds réellement mesurés il tient au-dessus de 3:1

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Liseré mesuré sur les 4 captures de contour (pixels ≥235 dans la boîte de l'objet) contre le fond dans un anneau de 4 px : buisson à 11 H #fdfdfd µ=252,6 σ=5,2 σ/µ=0,020 contre fond #547b47 µ=110,7 σ=17,4 → 4,80:1 · pile 4,06:1 · feu 3,78:1 · la MÊME nuit à 00 H, trait identique (µ=252,6) contre fond µ=47,8 → 12,91:1. Sur le sol clair mesuré dans ces mêmes images (#b3cc5f L=190,8 dans epuisement-vegetal ; moyenne des px de sol clair #aac059) le blanc pur ne rend plus que 1,79 à 2,02:1. Ce sol clair couvre 2,9 % (contour-buisson), 3,2 % (epuisement-vegetal), 8,2 % (contour-feu) de la zone monde. Cause au code : `snapshot-view.ts:1596` peint les 8 copies en `TintModes.FILL` blanc pur, sans halo sombre dessous et sans éclairage — sa lisibilité EST celle du fond, rien d'autre.

**Ce que le joueur vit** — Le survol se voit magnifiquement la nuit et dans l'herbe sombre, et s'évanouit exactement là où l'on cueille le plus : dans les clairières ensoleillées, où le sol est presque blanc. L'écart entre le meilleur et le pire cas est d'un facteur 7,2 — le joueur ne peut pas apprendre à faire confiance à un signal dont la force varie autant sans raison lisible.

**Direction de correction** — Le défaut est mesurable et objectif ; le REMÈDE touche la grammaire visuelle et revient à Alexis. Deux voies : (a) doubler le liseré d'un sous-trait sombre (le trait blanc reste, une copie d'un cran de plus en encre #14141a passe dessous) — c'est déjà la recette du texte du HUD (stroke 3 px), et c'est le seul moyen d'être indépendant du fond ; (b) laisser le blanc et accepter qu'il faiblisse au soleil. Ne PAS passer par un glow (post-FX interdit) ni par un liseré éclairé (il suivrait le fond au lieu de s'en détacher).

*`contour-buisson.png` · `contour-pile.png` · `contour-feu.png` · `contour-nuit.png` · `epuisement-vegetal.png`*

### L4-2 · Hors de portée, une PILE et le FEU n'ont que le liseré gris (1,4–1,7:1 sur l'herbe) — mais un buisson, lui, s'assombrit de 46 % en même temps

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — La constante est `AIM_TINT_FAR = 0x8a8a92` (`snapshot-view.ts:97`), employée pour le liseré hors portée (`snapshot-view.ts:1596`) ET pour la teinte du nœud visé hors portée (1896, 2023). Contre les fonds RÉELLEMENT mesurés dans mes captures : contre l'herbe du buisson #547b47 → 1,43:1 (ΔL=+27,8 pour un fond de σ=17,4, soit 1,6 σ) ; contre l'herbe de la pile → 1,22:1 (ΔL=+17,5 pour σ=36,7, soit 0,48 σ) ; contre l'herbe du feu → 1,14:1 (ΔL=+13,8 pour σ=27,2, soit 0,51 σ) ; contre le sol clair #839649 → 1,05:1. Deux fonds sur trois : l'écart du trait au fond est PLUS PETIT que la variation naturelle du fond. Le blanc et ce gris se distinguent bien l'un de l'autre (3,43:1, ΔL=116,4) — le problème n'est pas là. PROVENANCE : les fonds sont mesurés au pixel, la couleur du trait vient de la source ; AUCUNE capture de ce lot ne montre l'état grisé (le banc le relève en lisant la teinte, pas en la photographiant).

**Ce que le joueur vit** — Je vise une pile de bois trop loin. Le jeu SAIT que je la vise (la cible tient, le banc le prouve) mais à l'écran il ne se passe rien de distinguable de « je ne vise rien du tout ». Je crois que l'objet n'est pas interactif, alors qu'il suffisait de faire trois pas. C'est le pire des deux malentendus : le signal existe, il est simplement au niveau du bruit.

**Direction de correction** — Faire porter l'état « hors de portée » par autre chose que la seule luminance d'un gris moyen — la valeur #8a8a92 est prise en sandwich entre l'herbe sombre et le sol clair, aucun réglage de gris ne s'en sortira. Il faut soit un liseré à deux tons (comme L4-1), soit une différence de FORME (trait continu à portée / trait ajouré hors portée), qui ne dépend d'aucun fond. Le choix est une décision de grammaire : Alexis tranche.

*`contour-buisson.png` · `contour-pile.png` · `contour-feu.png`*

### L4-4 · La jauge d'abattage n'est ATTESTÉE nulle part dans le dépôt : la capture qui porte son nom n'en contient pas un pixel, et le banc s'interdit lui-même de la saisir

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — Balayage exhaustif de abattage-jauge.png (1 024 000 px) sur les cinq couleurs de `fell-gauge.ts` : GREEN #8ef06a → 0 px, AMBER #f2c65a → 0 px, HEAD #fffbe8 → 0 px, TRACK #3d3d47 → 741 px tous situés dans la ceinture DOM (amas x 320–383, y 672–703), FRAME #0d0d12 → uniquement les bandes noires du letterbox. Même balayage sur epuisement-arbre.png : 0 px. Le banc l'écrit lui-même (`tools/smoke.mjs:10331-10333`) : « le dessin lui-même est confirmé à part, la boucle de rendu de Chromium headless étant trop throttlée pour le saisir en direct avant que l'auto-frappe ne vide la charge ». Le ✓ du banc porte sur `scene.fells` — la DONNÉE, pas le dessin. Et rien ne peut la masquer : `OVERLAY_DEPTH = 10_000_000` (`framing.ts:86`). Sa taille, si elle dessine : BAR_W=38 px monde × zoom 2,5 (`zoomForFraming(20, 16, 800)`) = 95 px d'écran, haute de 12,5 px, posée 3 px monde sous le pied du tronc.

**Ce que le joueur vit** — Rien ne le prouve — et c'est précisément le constat. Le geste à maîtrise du jeu (charger, relâcher dans le vert) n'a jamais montré son retour à l'écran dans ce dépôt. Le banc a un ✓ vert sur une donnée et une capture nommée d'après un objet qu'elle ne contient pas : c'est exactement le piège « la capture peut mentir », posé cette fois dans l'instrument.

**Direction de correction** — Ce n'est pas un correctif de rendu, c'est un trou d'instrument : le scénario doit FIGER la boucle (`game.loop.sleep()`) pendant que la charge est à mi-course, puis capturer — la recette déjà éprouvée pour les bandeaux éphémères et pour les FX (`s'accrocher à la fabrique, figer, avancer par game.step`). Tant que ce n'est pas fait, aucune affirmation sur la lisibilité de la jauge ne peut entrer au journal.

*`abattage-jauge.png` · `epuisement-arbre.png`*

### L4-5 · Au niveau 0, la fenêtre du coup propre dure 150 ms et occupe 12 px d'une barre de 95 px

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — `balance.ts:395-399` : FELL_CHARGE_MAX_TICKS = 24 (1,2 s à 20 Hz), FELL_GREEN_START_TICKS = 14 (0,70 s), FELL_GREEN_WIDTH_BASE_TICKS = 3 (0,15 s au niveau 0), plafond 8. `fell-gauge.ts` : le vert commence à (14/24)·38 = 22,2 px monde et fait max(1, (3/24)·38) = 4,75 px monde de large, soit 12,5 % de la barre. Au zoom 2,5 : barre de 95 px d'écran, vert de 11,9 px, fenêtre de 150 ms. Le relevé du banc confirme la donnée réelle : `[{"nodeId":4,"ticks":24,"level":0}]`.

**Ce que le joueur vit** — Au premier arbre de sa première Veillée, le joueur doit relâcher dans une fenêtre de 150 ms visée sur douze pixels — et s'il la rate, l'auto-frappe part quand même à plein (« le coup a porté (auto-frappe à plein) : bois 0 → 1 »). Deux lectures possibles et opposées : soit la maîtrise est un vrai geste et il faut la RÉUSSIR, soit l'auto-frappe la rend décorative et l'échec ne coûte rien.

**Direction de correction** — CONSÉQUENCE DE JEU : quel est le prix de rater le vert au niveau 0 ? Si l'auto-frappe rend l'échec indolore, la jauge enseigne un geste sans enjeu ; si l'échec coûte, 150 ms au premier arbre est très serré. Alexis tranche — et la réponse conditionne s'il faut élargir FELL_GREEN_WIDTH_BASE_TICKS ou pas. À ne pas trancher avant d'avoir VU la jauge (L4-4).

*`abattage-jauge.png`*

### L4-7 · « Le houppier couché coiffe le monde » : la garde du banc est auto-contradictoire, et aucune capture ne montre le défaut

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — La garde (`tools/smoke.mjs:11206`) exige `r3.hd < 900000 && r3.hd < m.joueur.d`. Le premier terme PASSE (hd = 2040, très loin de la bande canopée à 900 000) ; c'est le second qui échoue. Or le même scénario téléporte le bûcheron en `t.ty + 0.5`, donc AU NORD du pied du tronc (`ty + 1`), et affirme deux lignes plus haut « il tombe À L'OPPOSÉ du bûcheron (angle +1,78 = vers l'est) ». Avec `hy = py − cos(1,783)·ancrage` et cos(1,783) = −0,208, le houppier se pose au SUD du pied — donc devant un joueur qui est au nord. Le tri Y a raison ; c'est l'attente qui est impossible à satisfaire en même temps que l'assertion voisine. Mes deux captures de la chute ne montrent aucune occlusion fautive : le houppier couché est à l'est de l'avatar, sans recouvrement, et un tronc debout passe devant lui.

**Ce que le joueur vit** — Rien de prouvé. Le ✗ rouge du banc ne décrit pas, en l'état, un défaut visible.

**Direction de correction** — Réécrire la garde pour qu'elle teste ce qu'elle veut dire : le houppier couché est-il hors de la bande canopée (< 900 000, déjà vrai) ET trié comme un objet au sol, c'est-à-dire par la rangée où il s'est posé. Le comparer au joueur exige de placer le bûcheron du côté où l'arbre NE tombe PAS — sinon les deux assertions du même scénario s'annulent.

*`epuisement-arbre.png` · `epuisement-arbre-pres.png`*

### L4-8 · Sur un objet au sol INCLINÉ, le liseré n'est plus un trait : c'est une poussière — 12 % de ses pixels sont détachés

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Comptage des pixels blancs (≥235) ayant au plus UN voisin orthogonal blanc, dans la boîte de l'objet souligné : hache posée au sol (inclinée ~32°) → 21 px sur 169, soit 12 %, avec des runs horizontaux de médiane 3 et jusqu'à 6 px d'un côté du manche ; buisson (sprite droit) → 0 sur 185, soit 0 %, runs de médiane 2 ; feu → 1 sur 268, soit 0,4 % ; buisson la nuit → 0 sur 208. Cause : `peindreContour` recopie `sprite.rotation` sur les 8 copies décalées de ±1 px MONDE (`CONTOUR_PX = 1`, `snapshot-view.ts:158`) ; sous `roundPixels` et à 2,5× de zoom, huit silhouettes tournées de 32° et décalées d'un pixel monde n'atterrissent pas sur la même grille — le liseré s'épaissit d'un côté et se pulvérise de l'autre. Visible à l'œil dans le recadrage ×9.

**Ce que le joueur vit** — L'objet le plus banal du monde — un outil tombé par terre — est le seul dont le survol a l'air sale. Ce n'est pas un cerne, c'est une auréole. À côté, le buisson et le Feu ont un trait impeccable : la même affordance change de qualité selon la chose visée, et c'est cette incohérence qui se remarque, pas la finesse du trait.

**Direction de correction** — Le commentaire du code a raison sur le principe (un contour qui ne tourne pas avec la flèche ferait une croix) ; c'est la granularité qui cloche. Piste sans arbitrage : ne pas tourner les copies mais construire le liseré à partir de la silhouette DÉJÀ tournée, ou décaler d'un pixel d'ÉCRAN plutôt que d'un pixel monde quand le sprite est incliné. À vérifier par capture (`smoke --scenario contour`) et à mesurer par le même compteur de pixels isolés — la garde est déjà écrite ici.

*`contour-pile.png`*

### L4-9 · Le refus « rien à récolter » s'écrit à ~250 px de l'objet, dans le canal fixe du bas de l'écran

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Le refus est `errorText` (`UIScene.ts:283`), encre #ff7a6b, posé en (largeur/2, hauteur−110) dans le canevas 1280×720, soit (640, 650) à l'écran ; mesuré en x 578–706, y 646–668. Contraste de l'encre NOMINALE #ff7a6b (L=149,2) contre le fond local : 1,74:1 sur la clairière #6c7f40, 1,42:1 sur le sol clair #b3cc5f — très en dessous de 4,5:1 (AA texte) et même de 3:1. La capture d'epuisement-arbre a saisi le texte en plein fondu (pic #c5835f, alpha apparent ≈ 0,61, contraste réel 1,43:1), mais le verdict tient au nominal, donc le fondu n'est pas la cause. Ce qui le sauve est le cerne : `stroke: '#14141a', strokeThickness: 3` (UIScene.ts:187-188) → cerne/fond 3,17:1 et 8,44:1. On lit un halo noir, pas une lettre. Distance du message au nœud refusé (arbre épuisé à ~(690, 405)) : 257 px. Sur epuisement-vegetal, même message pour un buisson à ~(685, 395) : 265 px.

**Ce que le joueur vit** — Je frappe, il ne se passe rien, et la seule explication du jeu s'écrit tout en bas de l'écran, en rouge délavé sur du vert de même clarté, à un quart d'écran de l'objet que je regarde. Dans le meilleur des cas je la rate ; dans le pire je crois que mon coup n'a pas été enregistré et je recommence.

**Direction de correction** — Deux défauts indépendants, tous deux réparables : (a) le corail #ff7a6b n'a de contraste contre AUCUN sol du jeu — il lui faut sa propre plaque sombre, pas seulement un cerne de 3 px ; (b) un refus qui parle d'un objet précis doit se poser SUR cet objet (le monde a déjà le mécanisme : `renderFunctions` pose des étiquettes flottantes ancrées à une tuile). Le choix « refus au corps de l'objet » vs « refus au bas de l'écran » est une décision de grammaire : Alexis tranche le OÙ, la lisibilité de l'encre est à réparer dans tous les cas.

*`epuisement-arbre.png` · `epuisement-vegetal.png`*

### L4-10 · La récompense s'affiche à 640 px du geste, dans le coin le plus éloigné du regard, à 2,0:1

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — « +12 PIERRE » mesuré en x 1202–1266, y 56–69 (centre ≈ 1234, 62) ; le rocher récolté était à ~(690, 400). Distance = √(544² + 338²) = 640 px, soit la moitié de la diagonale de l'écran. Contraste de l'encre ambre contre le brouillard derrière : glyphe #ba8137 (L=135,8) contre fond #5c5c53 (L=91,4) → 2,02:1 ; identique pour « +1 BOIS » (1,95:1) et « +8 BAIES » (2,00:1). Là encore, seul le cerne noir (2,58–2,67:1 contre le fond) rend le texte lisible. Rien n'apparaît AU NŒUD : la gerbe d'éclats part bien du nœud, mais elle ne dit pas le COMBIEN.

**Ce que le joueur vit** — Je frappe une pierre, la pierre éclate, la pierre disparaît — et le chiffre de ce que j'ai gagné se pose dans le coin opposé de l'écran, au-dessus de la ligne d'horizon, là où je ne regarde jamais pendant un geste. Le seul retour au bon endroit est la gerbe, et elle est muette sur la quantité. Le geste rapporte sans jamais dire qu'il rapporte.

**Direction de correction** — CONSÉQUENCE DE FEEL : faut-il un chiffre au point d'impact (le « +12 » qui monte du nœud, comme dans tout jeu de récolte) ou la retenue actuelle ? La retenue est un choix de ton défendable pour un jeu de survie austère — mais alors la gerbe doit porter TOUT le retour, et elle ne le porte qu'à moitié (L4-11). Alexis tranche.

*`epuisement-pierre.png` · `epuisement-arbre.png` · `epuisement-vegetal.png`*

### L4-11 · Un tiers de la gerbe d'éclats est invisible : l'éclat clair d'un buisson est à 1,2:1 de l'herbe où il retombe

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Le banc donne les trois teintes tirées de la texture du nœud : végétal #2e5122 / #3b682b / #487f34, pierre #81818b / #6a6a72 / #535359, 21 éclats, 4/4 quadrants. Contre l'herbe RÉELLEMENT mesurée autour de la cible (buisson : #4f8f3e, L=123,4, σ=12,2) : #2e5122 → ΔL=−53,2, 4,36 σ, 2,30:1 (net) ; #3b682b → ΔL=−33,4, 2,73 σ, 1,67:1 (visible) ; #487f34 → ΔL=−13,5, 1,11 σ, 1,22:1 (noyé). Pour la pierre (herbe #4f9140, L=125,1, σ=11,1) : #535359 → 3,74 σ, 1,98:1 ; #6a6a72 → 1,66 σ ; #81818b → ΔL=+4,7, 0,42 σ, contraste 1,00:1 — la même luminance exacte que l'herbe, sauvée seulement par sa teinte grise, hors du vert ambiant. Confirmé à l'œil : dans le recadrage ×6 de la pierre, les éclats gris se détachent bien ; dans celui du buisson, seuls les carrés sombres se lisent, les clairs se fondent.

**Ce que le joueur vit** — Frapper un rocher au milieu de l'herbe est jouissif : vingt éclats gris giclent tout autour, on voit la matière quitter la pierre. Frapper un buisson dans l'herbe donne la même gerbe, mais un tiers de ses éclats est de la couleur de l'herbe — le geste rend visiblement moins que l'autre, sans que rien ne le justifie. Le retour du verbe le plus fréquent du jeu (la cueillette) est le plus faible.

**Direction de correction** — CONSÉQUENCE DE DA : la règle « les éclats sont à la couleur du nœud » est belle et elle est tenue ; c'est elle qui produit le défaut, puisqu'un buisson vert sur de l'herbe verte n'a nulle part où se détacher. Deux voies incompatibles : (a) garder la fidélité de teinte et ne tirer que la déclinaison la plus SOMBRE des trois quand le nœud et le sol sont de la même famille ; (b) donner à tout éclat une arête sombre d'un pixel (grain 4 px, jamais lissée), au prix d'un peu de fidélité. Alexis tranche.

*`epuisement-vegetal.png` · `epuisement-pierre.png`*

### L4-13 · Le contour dit ce que je VISE, jamais ce que le geste FERA : cueillir, ramasser et ouvrir le Feu portent le même trait blanc

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Une seule constante pour trois verbes : `CONTOUR_TINT = 0xffffff` (`snapshot-view.ts:148`), peinte à l'identique quelle que soit la famille de la cible (`peindreContour`, 1595-1617). Mesuré : buisson #fdfdfd, pile #fcfcfb, feu #fcfbfa — les trois traits sont la même couleur à 1,6/255 près. Or `interactTargetAt` distingue bien trois issues très différentes : `fire` ouvre un MODAL, `node` déclenche `harvest whole`, `pile` déclenche `pick_up` (`aim.ts:615-626`). Et rien d'autre dans l'image ne les sépare : aucune étiquette, aucun verbe, aucun curseur particulier — j'ai vérifié les trois captures.

**Ce que le joueur vit** — Trois objets s'allument pareil, et l'un des trois va me couper le monde par un panneau plein écran pendant que les deux autres me donneront un objet sans rien interrompre. C'est la définition d'une couture : un même signe pour deux registres d'action, dont l'un est modal.

**Direction de correction** — CONSÉQUENCE DE GRAMMAIRE, PAS DE TECHNIQUE. Le résolveur connaît déjà le `kind` de la cible : il suffirait de le laisser passer jusqu'au trait (teinte par famille, ou une étiquette-verbe au-dessus, sur le modèle des étiquettes de fonction déjà en place). Mais la palette est encre + 2 accents pour l'UI, et multiplier les couleurs de liseré est une décision de DA. Alexis tranche — et notez qu'un liseré coloré aggraverait L4-1 (le blanc est déjà le plus lumineux qu'on puisse peindre).

*`contour-buisson.png` · `contour-pile.png` · `contour-feu.png`*

### L4-6 · À l'instant de la chute, le houppier saute d'alpha 0,22 à 1,0 — une discontinuité d'une frame sur le sprite qui tombe

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Dans epuisement-arbre.png, houppier COUCHÉ (x 700–755, y 400–435) : moyenne #508645, saturation µ=0,484 p95=0,566, L µ=117,6 σ=24,1 σ/µ=0,204. Houppiers DEBOUT du même bosquet, à la même distance du joueur : moyenne #787e6b, saturation µ=0,152 p95=0,202, σ/µ=0,071 — c'est-à-dire délavés. Pour référence, un houppier debout HORS du disque de découvert : saturation 0,52–0,56, σ/µ 0,21–0,27, soit exactement le régime du houppier couché. Cause au code : `crownAlpha` (`framing.ts`, CROWN_ALPHA_MIN = 0,22 dans CROWN_R_IN) n'est appliqué que dans la boucle de nœuds (`snapshot-view.ts:2029`) ; `chute-arbre.ts:203` pose `c.houppier.setAlpha(opacite)` avec opacite = 1 jusqu'au fondu final. L'arbre abattu quitte donc le disque de découvert à l'instant où il tombe. Visible à l'œil dans le recadrage : on voit les troncs à travers tous les houppiers debout, jamais à travers celui qui est couché.

**Ce que le joueur vit** — L'arbre que je viens d'abattre devient, une seconde et demie durant, la seule masse pleine du sous-bois — un pavé vert saturé posé sur une forêt de fantômes. Au lieu de lire « il est tombé », l'œil lit « quelque chose d'un autre jeu vient d'apparaître ». Et c'est le seul objet du couvert capable de me cacher le sol au moment précis où je regarde ce que la coupe a laissé.

**Direction de correction** — Le houppier qui tombe doit hériter de la même règle d'alpha que celui qui était debout un instant plus tôt — `crownAlpha(distance du joueur)` multiplié par le fondu de fin de vie, plutôt que 1 × fondu. Rien à arbitrer : c'est la continuité d'une règle déjà écrite, pas une nouvelle règle.

*`epuisement-arbre.png` · `epuisement-arbre-pres.png`*

### L4-14 · Au jour, le sol porte une marche de clarté à bord rectiligne : +41 % d'un pixel à l'autre, éteinte la nuit

`COSMÉTIQUE` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Dans contour-buisson.png, bande y 660–740 : dedans (x 200–700) #839649, µ=140,7 σ=47,6 ; dehors (x 20–140) #5a6b35, µ=99,4 σ=31,2 — ratio 1,415. La transition est franche : sur la ligne y=660, x=157 #3f7b33 (L=105,0) → x=158 #679240 (L=130,9), ΔL=25,9 en UN pixel. Ce bord est RECTILIGNE : le même saut se retrouve à x=158 sur toutes les lignes de y=632 à y=752, avec une marche à x=122 à partir de y=664. Dans contour-nuit.png — MÊME lieu, MÊME cadrage, 00 H — la région disparaît : ratio 0,911. C'est donc bien la couche de lumière du jour (`soleil-layer.ts`, « la nuit éteint tout »). CE QUE JE N'AI PAS PROUVÉ : pourquoi ce bord est rectiligne sur des centaines de pixels ; le masque est 1 px/tuile en NEAREST, mais les marches mesurées (36 px en x, 32 px en y) ne tombent ni sur la tuile (40 px d'écran) ni sur le bloc de clairière (8 tuiles = 320 px). Je laisse la cause ouverte.

**Ce que le joueur vit** — En plein jour, une partie du pré est nettement plus claire que l'autre, séparée par une droite d'un pixel. Ça ne lit pas comme une trouée de lumière dans une canopée : ça lit comme deux textures d'herbe mises bout à bout. Et c'est directement le fond sur lequel le liseré blanc perd sa lisibilité (L4-1).

**Direction de correction** — Hors de mon lot pour la cause, mais il faut le nommer parce qu'il conditionne L4-1. À trancher par Alexis : la clarté de la lumière du sous-bois doit-elle s'arrêter net sur une droite, ou s'éteindre en pente sur quelques tuiles ? (Une pente est compatible avec la quantification : c'est la DENSITÉ des taches qui décroît, pas leur taille — même geste que les brumes.)

*`contour-buisson.png` · `contour-feu.png` · `contour-nuit.png` · `cueillette.png`*

---

## L5 — Captures — bâtir et habiter  *(12 constats)*

### L5-01 · Le scénario `construction` est structurellement incapable d'échouer : six ✗, deux ✓ creux, code de sortie 0

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — batch.log:162-173 (run du jour) : six ✗ puis « ◀ SCÉNARIO construction — fin — code=0 ». (a) R20 cherche `ui.children.list.find(o => o.type === 'Text' && o.text === 'MARTEAU')` (smoke.mjs:12419-12423) ; un grep de « MARTEAU » sur tout le dépôt ne rend AUCUN objet Text de ce nom — le menu est en DOM (`packages/client/src/scenes/ui/build-menu.ts:2` « Rendu ISO à la maquette Turn 4A, en DOM ») et son titre est `titre: 'CONSTRUCTION'` (build-menu.ts:80). R20 ne peut donc jamais passer, et R21 (« menu éteint ✓ ») ne peut jamais échouer : une garde qui rend la même réponse quoi que fasse le jeu. (b) R22 accepte n'importe quel Text contenant « Forge » dans la scène ; le format d'étiquette de fonction est `${FUNCTION_LABEL[f.functionId]} · N${f.tier}` (`snapshot-view.ts:1641`) et s'affiche pour TOUTE fonction en vue, y compris celle d'un autre village — d'où deux lignes voisines du même run qui se contredisent : « Forge (R9-R10) → ABSENTE ✗ » (batch.log:166) puis « overlay « Forge » (R22) → affiché ✓ » (batch.log:167). (c) « murs continus → 60 murs ✓ » (batch.log:165) : le compteur est `st.filter(s => s.type === 'wall').length` (smoke.mjs:12490) — TOUS les murs du snapshot, pas les trois posés. (d) les six verdicts partent en `console.log`, pas en `console.error('!! …')` : `verdictsRompus` n'est jamais incrémenté (smoke.mjs:14380-14385), d'où code=0. Que le scénario échoue n'est PAS neuf — smoke.mjs:14369 l'écrit noir sur blanc (« le scénario construction échoue sur six vérifications depuis un moment »). Ce qui est neuf, c'est POURQUOI.

**Ce que le joueur vit** — Rien directement — mais c'est le seul juge automatique du système de construction, et il rend VERT sur un système qu'il n'a pas testé. Tant qu'il ment, une régression du mode bâtir passera sans être vue.

**Direction de correction** — Lire le menu là où il vit : le DOM (`.bmn`, titre « CONSTRUCTION »), pas le graphe Phaser. Compter les murs POSÉS (delta avant/après), pas ceux du monde. Restreindre R22 aux fonctions de MON village (`view.functions` filtré sur mon villageId) plutôt qu'à un texte quelconque. Et faire passer ces six verdicts par la convention `!!` pour qu'un ✗ pèse sur le code de sortie.

*`construction.png`*

### L5-02 · La sonde de fondation attrape le premier feu du MONDE (un village PNJ), pas celui du joueur — d'où les cinq refus « hors du carré »

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Le scénario ne se téléporte QUE sur `spawn + offset`, offsets ∈ {0, ±24, ±48} (smoke.mjs:12468) : tout Feu qu'il allume est à ≤ 48 tuiles du spawn. Deux autres scénarios du MÊME batch, sur le MÊME monde, fondent à (690, 361) (batch.log:179 et batch.log:366) — c'est donc là le voisinage du spawn. Or batch.log:164 annonce « Feu posé en (1472, 192) ✓ » : 782 tuiles à l'est, 169 au nord. Ce Feu est HORS de portée de la boucle : il ne peut pas être celui qu'elle a allumé. La cause est la sonde elle-même, `view.structures.find(x => x.type === 'fire')` (smoke.mjs:12474) — le PREMIER feu du tableau, pas le sien. Conséquence en sim : le village du joueur reste au spawn (le HUD de construction.png affiche « VILLAGE : 4 MEMBRES », le village créé par `light_fire`), et chaque pose à (1474±k, 192) tombe hors de `chebyshev(village.fireTx, village.fireTy, tx, ty) > fireRadius(village.tier)` avec R=10 au palier 1 (`packages/sim/src/village.ts:1033`, message `out_of_square: 'hors du carré du Feu'` village.ts:521, `FIRE_RADIUS_BY_TIER = [10, 13, 16]` balance.ts:63). Le jeu a raison ; l'instrument pose à 780 tuiles de chez lui.

**Ce que le joueur vit** — Rien — le jeu refuse correctement. Mais l'audit croit depuis des semaines que la construction est cassée alors que c'est la sonde qui vise ailleurs.

**Direction de correction** — Identifier le Feu par appartenance, pas par type : prendre celui de MON village (`view.villages` / le structureId rendu par la fondation), comme le fait déjà `fonderPres` dans le scénario `village` (smoke.mjs:302-316) — et faire échouer bruyamment si aucun Feu ne m'appartient, au lieu d'attraper le premier venu.

*`construction.png`*

### L5-03 · `debug_grant` met « en main » un objet qui est dans le SAC — et la ceinture n'a que 6 cases

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — `packages/sim/src/debug.ts:228-230` : « On le met EN MAIN […] » puis `const slot = entity.inventory.findIndex(…); if (slot >= 0) entity.activeSlot = slot` — l'index est cherché dans TOUT le sac (18 cases), sans borne. Or `heldSlot` rend `null` dès que `activeSlot >= SLOTS.BELT` (`inventory-actions.ts:142`) et `SLOTS.BELT = 6` (`balance.ts:1781`). Le scénario grante 9 objets (hammer, berries, wood×30 = 2 piles, enclume, furnace, workshop, silo, parcelle) : les trois derniers atterrissent au-delà de la case 6 → « il faut un composant ou un coffre en main » sur l'Atelier, le Grenier et la Ferme (batch.log:168-170, garde `village.ts:1024`). Et c'est exactement ce que la capture montre : 0 pixel d'anneau ambre dans construction.png, les six bordures à (28,32,29), contre 290 px d'anneau (194,140,61) sur la case 5 de village.png — `activeSlot` pointe hors de la ceinture affichée. Le jeu réel, lui, borne : `if (action.slot < 0 || action.slot >= SLOTS.BELT) return reject('hors de la ceinture')` (`inventory-actions.ts:177`). C'est donc un défaut de l'outil de debug, pas du jeu.

**Ce que le joueur vit** — Rien en partie normale. En banc : tout scénario qui grante plus de six sortes d'objets se retrouve les mains vides sans le savoir, et impute au jeu un refus qu'il a lui-même provoqué.

**Direction de correction** — Que `debug_grant` ne pose `activeSlot` que si la case trouvée est dans la ceinture — sinon laisser la main inchangée ; le commentaire qui promet « en main » doit devenir vrai ou disparaître.

*`construction.png`*

### L5-07 · Sur l'herbe, l'encre discrète et surtout le rouge d'alerte du HUD échouent à AA malgré leur contour d'encre — l'alarme de surcharge à 1,46:1 est le pire texte du cadre

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Même frame, village.png. Ligne 1 « JOUR 1 — ACTE I — 12H » : glyphe (249,249,249) sur le feuillage sombre qui se trouve derrière → 7,06:1, très lisible. Mais la moitié droite de la MÊME image est une prairie à (175,188,93) : ce même blanc y tomberait à 1,96:1. Ligne 3 « TABLEAU : … » : les traits de glyphe relevés directement au dump y86-96 / x16-30 valent (118,110,95) à (129,120,103) ; le fond réel sous la fin de la ligne (x250-470) est (70,130,58) dominant → environ 1,6:1. Ligne 2 « VILLAGE : 1 MEMBRE — FEU : NEUTRE » : le mot « FEU » traverse un tronc sombre et s'y perd. Dans construction.png, « LE BOIS NOIR » et « partie sauvegardée » sont dans le même cas. Le symptôme structurel se lit dans le calcul : pour les lignes 2, 3 et 4, le pixel au 97ᵉ centile de la bande est de l'HERBE (79,146,62), pas un glyphe — le texte n'a aucun pixel plus clair que le fond qu'il traverse. Et le pire cas est l'alarme : « ▲ 64.2 / 60 » (surcharge, au-dessus de son propre plafond) est peint en (192,85,67) sur (56,100,49) → 1,52:1, le texte le MOINS lisible du cadre est celui qui crie.

**Ce que le joueur vit** — Il ne lit pas son tableau de corvées, il ne lit pas où il est, et surtout il ne voit pas qu'il est en surcharge — l'unique chiffre rouge de l'écran est celui qu'on distingue le moins. Rien n'est cassé : c'est simplement du texte posé nu sur un monde qui change de couleur sous lui.

**Direction de correction** — Donner à la colonne de texte du HUD un support qui ne dépende pas du monde : plaque d'encre translucide derrière le bloc, ou contour sombre 1 px sur les glyphes — c'est exactement ce que font déjà les étiquettes du monde (« Atelier · N1 » tient ~3,6:1 contre son pire fond grâce à son liseré noir). Et remonter l'alarme de surcharge au moins au niveau de la ligne 1.

*`construction.png` · `village.png`*

### L5-04 · Aucune des quatre captures n'est prise en mode bâtir — et la sonde R20 qui devait le dire est morte (elle cherche du Phaser là où le menu est du DOM)

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — 0 pixel d'anneau de sélection dans la ceinture (mesuré : bordures des 6 cases à ~(28,32,29) ; référence armée (194,140,61) sur 290 px dans village.png). Or tout le mode bâtir est conditionné à une seule ligne : `const hammerHeld = activeSlot >= 0 && inv[activeSlot]?.item === 'hammer'` (`packages/client/src/scenes/UIScene.ts:772`), qui pilote `buildMenu.setVisible`, `selected` (le fantôme), `marteau` (le liseré) et `demolir` (UIScene.ts:774-787). La frontière EXISTE et est aboutie — `packages/client/src/scenes/world/carre-village.ts` porte trois couches (A le liseré au bord exact + un second trait effacé sur le carré réservé, B le tapis teinté par pièce armée, C le dehors assombri en MULTIPLY pour ne pas délaver) — mais elle s'allume au marteau en main, et aucune des quatre captures ne l'a en main.

**Ce que le joueur vit** — Rien de nouveau : la question « voit-on le carré, le fantôme, la portée, le coût ? » reste SANS RÉPONSE pour ce lot. Il n'existe aucune capture du mode bâtir dans les quatre images. Danger : conclure « le carré ne se voit pas » ferait reconstruire une couche déjà écrite.

**Direction de correction** — Ajouter au scénario une capture prise MARTEAU EN MAIN et pièce ARMÉE (vérifier `registry.get('marteau') === true` et `selected !== null` AVANT le screenshot), une posable et une refusée, pour que le liseré, le tapis, le dehors et le fantôme entrent enfin dans l'audit.

*`construction.png`*

### L5-06 · Entrer efface le couvert de la pièce où l'on est — décision datée du 2026-08-10 ; reste à savoir si ça suffit quand la pièce fait deux tuiles

`MINEUR` · `design` · `SUSPECTÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Entre les deux vues alignées (dy=302, dx=0), la SEULE différence imputable au franchissement est la dalle de paille : 661 px de couleur toit dehors (bbox 43×43 en x[629..671] y[40..82]) contre 2 px dedans ; la bande y342-362 bascule de (225,170,72) dominant à (175,188,93) dominant. Soit 0,065 % des 1 024 000 px du cadre. Tout le reste de la bâtisse est déjà ouvert AVANT d'entrer : le sol, l'alcôve et le feu sont visibles depuis 14 tuiles. Aucun bandeau, aucun changement de lumière mesurable (le rouge-bleu du sol juste au sud du bâti vaut +68,5, contre +69,6 pour un témoin d'herbe à x=900 sur les mêmes lignes : aucun débord de la lueur du feu à midi), aucune bordure de seuil. La porte existe mais n'est qu'une échancrure brun foncé de 14×20 px dans le mur sud (x634-647, y405-424) : pas de dormant, pas de linteau, pas de surbrillance à l'approche.

**Ce que le joueur vit** — Il franchit un mur et rien ne le lui dit. « Je suis dedans » n'est pas un moment : c'est un carré de paille qui s'efface au coin de l'œil, alors même que l'endroit contient le Feu du village — le lieu le plus important de sa partie.

**Direction de correction** — À Alexis de trancher ce que « dedans » doit valoir : un changement d'ambiance (le dehors s'assombrit comme le fait déjà `carre-village.ts` couche C, en MULTIPLY), un cadrage de seuil sur la porte, ou rien du tout parce que le jeu veut rester lisible du dehors. La conséquence de jeu — ce qu'on voit venir quand on est dedans — n'est pas de mon ressort.

*`village-exterieur.png` · `village-interieur.png`*

### L5-08 · ④ L'empilement ne produit aucun artefact visuel — il a mangé la Forge

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Le diag du run cité (batch.log:181) : « tuile forge 1: [floor+roof], tuile 2: [fire+floor+roof] ». La tuile 2 porte le FEU DU VILLAGE. Or les fonctions reconnues sont « atelier N1, grenier N1 » (batch.log:180) : aucune forge. L'enclume et le four visaient (ox+1, oy+1) et (ox+2, oy+1) — la seconde est occupée par le Feu, et `place_component` refuse sur `fullTileAt` → « tuile occupée » (`village.ts:1041`). Côté pixels, aucun défaut : je n'ai trouvé ni mur mangé ni pièce recouverte. Le seul recouvrement mesurable est une étiquette, pas une structure (voir L5-09), et la lueur du feu ne bave pas hors des murs (R−B +68,5 au sud du bâti contre +69,6 au témoin x=900, mêmes lignes). Ce qu'on appelle « la Forge » dans les images est donc un appentis muré et toité de 87×74 px contenant le Feu du village, avec un établi et un silo posés DEHORS de part et d'autre.

**Ce que le joueur vit** — L'empilement sol+toit+feu tient graphiquement : rien ne se marche dessus. En revanche la scène montrée comme « une forge » n'en est pas une, et personne ne peut le déduire de l'image — les deux étiquettes présentes nomment des objets extérieurs au bâtiment.

**Direction de correction** — Le scénario doit choisir son bloc 4×3 en excluant la tuile du Feu (le scan ne teste aujourd'hui que l'absence de NŒUD, smoke.mjs:12625-12640), et refuser de capturer si la forge n'a pas émergé — sinon la prise de vue de référence documente un bâtiment qui n'est pas celui qu'on croit.

*`village.png` · `village-exterieur.png` · `village-interieur.png`*

### L5-10 · La ceinture est translucide : le monde la traverse et change son apparence de 26 %

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — La MÊME case vide se rend à (61,60,47) — L=59,3 — au-dessus de la prairie de village.png, et à (34,48,34) — L=44,0 — au-dessus du sous-bois de construction.png : 26 % d'écart de luminance sur le panneau lui-même, dû au fond qui transparaît (opacité déduite ≈ 0,85-0,88). Le résultat se voit à l'œil dans construction.png : un tronc de bouleau pâle (x633-643) reste lisible À TRAVERS les cases 3 et 4, et le compte « ×18 » de la case 4 se lit sur un fond vert clair alors que celui de la case 3 se lit sur du brun.

**Ce que le joueur vit** — La barre d'objets n'a pas la même tête selon l'endroit où il se trouve, et les petits chiffres de compte changent de fond d'une case à l'autre. Ce n'est jamais illisible, mais rien n'est jamais posé au même endroit deux fois de la même façon.

**Direction de correction** — Opacifier le fond des cases (ou n'appliquer la transparence qu'à la marge du panneau, pas sous les icônes et les compteurs), pour que la ceinture ait une seule apparence.

*`construction.png` · `village.png`*

### L5-11 · Le tableau de corvées liste deux fois la même tâche

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Lisible dans village.png au grossissement ×3 de la zone x10-490 / y50-100 : « TABLEAU : récolter des baies, récolter des baies, couper du bois, ramasser des fibres. » — « récolter des baies » apparaît deux fois de suite.

**Ce que le joueur vit** — Le seul texte qui lui dit quoi faire se répète. Ça lit comme un bug d'affichage même si la sim a bien deux corvées distinctes derrière — rien à l'écran ne les distingue (ni quantité, ni assignataire, ni avancement).

**Direction de correction** — Deux corvées identiques doivent ou fusionner avec un compte (« récolter des baies ×2 »), ou porter ce qui les différencie. À Alexis de dire lequel — c'est le ton du tableau qui décide.

*`village.png`*

### L5-12 · Au cadrage du banc, le village de JOUR 1 tient peu de place et le sol varie plus que lui — mesuré sur une frame dézoomée par l'instrument

`MINEUR` · `design` · `SUSPECTÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Dans village.png, le corps brun de l'unique bâtisse fait 87×74 px = 6 438 px, soit 0,63 % du cadre. En face, le sol : luminance moyenne par cellule de 43×43 px sur la prairie sud-est (x780-1280, y430-760) de 101,1 à 188,5 — σ/µ = 0,109, amplitude 87,4 points, avec des transitions étalées sur 20 à 120 px que l'art pixel quantifie en marches. Le motif clair/sombre du sol n'a aucun rapport avec le village : il ne trace ni cour, ni sente, ni enceinte, et il est aussi contrasté que le bâtiment. Autour, deux objets de 20×18 px (l'établi, le silo) et deux étiquettes flottantes ; aucun chemin, aucune clôture, aucun seuil, aucune trace d'usage. La seule marque explicite du domaine existe dans le code (`carre-village.ts`, trois couches) mais ne s'allume que marteau en main (`UIScene.ts:772-781`), donc jamais ici.

**Ce que le joueur vit** — Un pré très grand, un cabanon, deux caisses, deux étiquettes. Rien ne dit « on habite ici » ; rien ne donne envie d'y revenir. L'œil est attiré par le damier du sol, qui ne veut rien dire, plutôt que par la bâtisse, qui veut dire quelque chose.

**Direction de correction** — Décision d'Alexis : ce qui doit faire LIEU (sol foulé autour du Feu, sentes entre les bâtiments, une enceinte visible en permanence plutôt qu'au marteau, une lueur de Feu qui porte de jour). Je ne tranche pas : cela change ce qu'on repère de loin, donc ce qu'on voit venir.

*`village.png` · `village-exterieur.png`*

### L5-13 · Trois captures pour deux plans : village.png est le doublon exact de village-interieur.png

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Statistiques sur la bande utile y40-759 : village.png µ=132,6 σ=36,7 σ/µ=0,277 p01=42 p10=81 p50=133 p90=183 p99=202 ; village-interieur.png µ=132,6 σ=36,7 σ/µ=0,277 p01=43 p10=81 p50=133 p90=183 p99=202. Seuls 3,68 % des pixels diffèrent (delta moyen 68,5), répartis uniformément sur toute l'image — c'est l'animation de la végétation, pas un changement de scène : la zone du bâtiment est la MOINS différente du cadre (30,6 % de pixels changés contre 62 à 93 % sur des témoins d'herbe). Le scénario prend le dernier screenshot sans avoir bougé depuis le précédent (smoke.mjs, dernière ligne du scénario `village`).

**Ce que le joueur vit** — Rien. Mais l'audit croit avoir trois vues du village et n'en a que deux — et il manque justement celle qui répondrait à « le village se lit-il comme un lieu ? » : un plan d'ensemble, dézoomé, montrant le Feu, le carré et les fonctions ensemble.

**Direction de correction** — Remplacer la troisième prise par un vrai plan d'ensemble (dézoom, caméra centrée sur le Feu, pas sur l'avatar) — c'est la vue qui manque au lot.

*`village.png` · `village-interieur.png`*

### L5-09 · L'étiquette « Grenier · N1 » se pose sur le mur de la bâtisse

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Le bâti occupe x[607..694] ; les glyphes de « Grenier · N1 » commencent vers x=676 — une vingtaine de pixels de texte, contour compris, se posent sur le haut du mur droit (visible au grossissement ×4 de la zone x580-730). L'étiquette d'en face, « Atelier · N1 », s'arrête juste au bord gauche (x≈608) : c'est le même défaut de l'autre côté, à un pixel près. Les étiquettes sont posées au-dessus de leur amas (`snapshot-view.ts:1625-1641`) sans tenir compte de ce qu'elles recouvrent.

**Ce que le joueur vit** — Une phrase collée sur un mur. Avec trois ou quatre fonctions autour d'un même bâtiment, les étiquettes se recouvriront entre elles et masqueront la bâtisse — c'est une couture qui grandit avec le village.

**Direction de correction** — Décaler l'étiquette hors de la silhouette du bâti (ou la déporter au-dessus du toit), et gérer la collision entre étiquettes voisines.

*`village.png` · `village-interieur.png`*

---

## L6 — Captures — combat et arc  *(13 constats)*

### L6-1 · Les deux ✗ du banc ne mesurent rien : à ratio 1 le code GARANTIT eclat = 0 (et la boucle n'est même pas gelée)

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — batch.log, scénario `tir` : les deux ✗ sont encadrés par « ✓ l'arc est bandé à fond (ratio 1) » et « ✓ à fond, les éclats CESSENT et la garde se pose (0 front sur 1,6 s, pleine=true) ». Chaîne : tools/smoke.mjs:791 `g.loop.sleep()` endort la boucle ; smoke.mjs:806 la boucle de « crête » est gardée par `eclat < 0.8` (vraie, elle steppe 40 fois sans jamais atteindre 0,8) ; smoke.mjs:871 la boucle de « creux » est gardée par `eclat > 0.05` — or attack-fx.ts:605 pose `bande = { eclat: 0, pleine: mur }` et attack-fx.ts:626 coupe le clignotement à ratio 1 : `eclat` vaut 0 en permanence, la garde est FAUSSE À L'ENTRÉE, `g.step` n'est jamais appelé entre les deux relevés. Les trois « crêtes » et les trois « creux » sont donc lus sur la même image figée : 0,8 / 1,6 / 0 est le résidu de recomposition de six captures 1×1 px sous SwiftShader, pas un effet faible.

**Ce que le joueur vit** — Rien — c'est l'instrument qui parle. Mais le message dit « le flash ne se lit pas sur le corps » alors qu'il n'a pas pu contenir un seul photon de flash : la prémisse du brief (« le flash d'impact à 1,6/255 ») est fausse deux fois — ce n'est ni l'impact (c'est le clignotement de BANDE de l'arc), ni une mesure (c'est du bruit d'échantillonnage).

**Direction de correction** — Ne lancer la sonde ΔL que si `eclat ≥ 0.8` a réellement été atteint ; sinon SAUTER le contrôle et l'écrire (« bande jamais observée sous ratio 0,9 — contrôle non joué »), jamais rendre un ✗. Geler la boucle AVANT la première frame de charge pour tenir un ratio < 0,9. Et renommer le message : il mesure le clignotement de bande, pas un flash d'impact.

*`tir-0-eclat.png` · `tir-1-bande.png`*

### L6-2 · Aucun cadre du lot ne montre un coup qui PORTE — mais le scénario qui photographie la chaîne d'impact existe (`sang`), il n'a simplement pas été joué

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Les trois captures de combat ne contiennent aucune entité hostile (crops de 160×90 px autour de l'avatar : herbe, clutter, avatar seul) ; le log du scénario combat ne dit que « coup simple : parti (7 d'endurance) » — jamais un `entity_damaged`. Les six cadres de tir décochent vers l'est sur du vide et la flèche finit plantée au sol. Donc : étincelle (attack-fx.ts:496), chiffre de dégâts, teinte d'impact, gerbe de brisures, sang, secousse de caméra, voile rouge à l'écran — rien de tout cela n'apparaît dans le lot.

**Ce que le joueur vit** — Impossible à dire depuis ces images. La question posée — « le geste le plus mortel a-t-il le retour le plus fort ? » — ne peut PAS être tranchée sur ce lot : on n'y voit que des zones peintes sur de l'herbe vide.

**Direction de correction** — Le scénario `combat` doit poser une cible (bête téléportée à portée, invulnérabilité debug), figer la boucle au tick où `entity_damaged` tombe, capturer, puis relever la luminance du corps touché AVANT/APRÈS sur la silhouette entière.

*`combat-poing.png` · `combat-lance.png` · `combat-hache.png` · `tir-3-trait.png`*

### L6-3 · La traîne du trait est faible mais pas au bord de l'invisible (ΔL ~12, 1,14:1) — et le tireur qu'elle sert à localiser n'existe pas en solo

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — tir-3-trait, différentiel entre la ligne de vol (moyenne de y 390-396) et le sol immédiatement au-dessus/dessous (y 380-386 et 400-406), tous les 20 px : x=600 +7,5 · 620 +9,9 · 640 +10,6 · 660 +9,7 · 680 +9,4 · 700 +6,5 · 720 +7,8 · 740 +7,6 · 760 +6,1 · 780 +3,7. Explication exacte : attack-fx.ts:774 `blade.lineStyle(…, BLADE, 0.24 * fondu)` avec `fondu = 1 − t²` → à mi-vol l'alpha vaut 0,18, et le commentaire juste au-dessus l'avoue : « Réglée À L'ŒIL sur capture ». La TÊTE, elle, se lit : 29 × 7 px, (224,219,180) contre (180,175,112) = 1,61:1. Étalon du dépôt : smoke.mjs:7120 qualifie un ΔL de +1,2 d'« invisible ».

**Ce que le joueur vit** — La flèche se voit passer (un tiret crème de 29 px), mais la ligne qui devrait rester derrière elle et dire d'où le tir est venu s'efface pendant le vol — et elle est la plus faible à la FIN, c'est-à-dire au moment où on la cherche parce qu'on vient d'encaisser. À seize tuiles, on encaisse sans savoir où se mettre à couvert.

**Direction de correction** — Conséquence de jeu (ce qu'on voit venir) : Alexis tranche l'intensité. Piste mesurable : remonter le plancher de la traîne (alpha ≥ 0,20 constant, ou `fondu` en √ au lieu de t²) et re-mesurer le ΔL à t = 0,9 ; viser ≥ 25 sur le pire sol clair.

*`tir-3-trait.png`*

### L6-4 · La portée ne se dessine qu'une fois le geste ENGAGÉ (vrai) — mais le coup simple ne RESTE pas pâle : son télégraphe monte à 0,22 / 0,75 avant que le coup ne tombe

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Deux appels seulement peignent une zone : WorldScene.ts:1263 `attackFx.charge(…)` (bouton maintenu) et WorldScene.ts:1289 `attackFx.telegraph(…)` depuis `w of this.windups` (le coup déjà parti). Au repos, rien n'est peint. Les trois captures montrent l'état le PLUS FORT — la charge mûre : attack-fx.ts:597 `mur ? 0.14 + 0.06*pulse : …` (remplissage), `mur ? 0.55 + 0.45*pulse : …` (contour), largeur 3 — mesuré à 1,80:1 (contour 228 contre sol 167) et +12 L de remplissage. Le coup SIMPLE, lui, naît à attack-fx.ts:575-577 avec remplissage 0,06 et contour 0,25 en largeur 1,5 : un tiers de l'alpha et la moitié de la largeur de ce qu'on voit ici. Aucun cadre du lot ne le montre.

**Ce que le joueur vit** — On ne peut pas jauger l'allonge de sa lance sans attaquer : la zone apparaît après avoir cliqué, pendant les 300-500 ms du wind-up. On l'apprend donc en ratant. Et le télégraphe du clic ordinaire démarre trois fois plus pâle que les images de ce lot ne le laissent croire.

**Direction de correction** — Deux temps. (a) Technique : capturer un wind-up de coup simple (progress 0,2) et mesurer son contraste — le lot ne le prouve pas. (b) Design, décision d'Alexis : faut-il une prévisualisation de portée arme dégainée (au survol, ou un liseré permanent), ou l'apprentissage par l'échec est-il assumé ?

*`combat-poing.png` · `combat-lance.png` · `combat-hache.png`*

### L6-5 · La teinte d'impact meurt trois fois plus tôt sur une bête que sur moi — mécanisme complet en code, mais jamais observé à l'exécution

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU (requalifié)

**Preuve** — attack-fx.ts:660 `sprite.setTint(IMPACT_TINT)` — mode par défaut MULTIPLY, donc 0xff8877 ne peut qu'assombrir/rougir. attack-fx.ts:830-836 rend la teinte après `IMPACT_MS` = 160 ms. Mais snapshot-view.ts:1145 `record.sprite.setTint(beastTint(…))` la REPOSE à chaque snapshot (dans `syncEntities`, appelée par `apply`), et WorldScene.ts:2003 `view.apply(msg…)` passe AVANT :2008 `processEvents(msg)` : la teinte tient donc jusqu'au snapshot suivant, soit un intervalle — 50 ms au rythme nominal (sim-worker.ts poste un snapshot par tick, tick à 20 Hz). Sur le sprite du joueur, aucun autre `setTint` n'existe (grep sur `playerSprite`) : 160 ms pleins. Le recul peint (`peindreRecul`, même map `impacts`) court 160 ms dans les DEUX cas. Note : l'en-tête du fichier (ligne 26) promet « elle blanchit » ; le code rougit — mais c'est un choix documenté et délibéré (ligne 658), pas le défaut.

**Ce que le joueur vit** — Le loup qu'on frappe encaisse un voile rouge qui s'éteint au tick suivant pendant que son corps continue de reculer encore 110 ms : la teinte et le recul se désolidarisent. Le même coup pris SUR SOI dure trois fois plus longtemps. Deux poids, deux mesures pour le retour du geste central.

**Direction de correction** — Réappliquer la teinte d'impact APRÈS `view.apply` à chaque frame — exactement le remède déjà écrit pour le clignotement de bande (`peindreBande`, dont l'en-tête raconte ce même piège : « un flash appliqué plus tôt dans la frame est effacé dans la même frame »). À défaut, aligner IMPACT_MS sur un intervalle de snapshot pour que la teinte et le recul finissent ensemble.


### L6-6 · La ligne de visée passe sous le seuil non-textuel 3:1 sur les sols clairs (1,58:1) — mais l'écart de luminance y reste de 51 points

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — tir-2-suivi, profils perpendiculaires à la ligne : sur clairière claire (245,248,233) contre (183,209,96) = 1,58:1 (ΔL 51) ; sur herbe moyenne (237,243,230) contre (127,174,78) = 2,30:1 ; sur herbe d'ombre (231,241,229) contre (81,151,64) = 3,10:1. L'anneau de chute passe par les mêmes valeurs : (214,220,194) contre (164,187,88) = 1,5:1 sur son bord droit.

**Ce que le joueur vit** — Le seul retour qui dise « jusqu'où, maintenant » est deux fois moins lisible sur les sols clairs — c'est-à-dire dans les clairières et les taches de soleil, précisément là où on tire loin.

**Direction de correction** — Un liseré sombre d'un pixel sous la ligne et sous l'anneau (contraste garanti quel que soit le sol), plutôt que de monter l'alpha d'un blanc déjà à 0,95.

*`tir-2-suivi.png` · `tir-1-bande.png`*

### L6-7 · « À fond » est un CHANGEMENT, pas un état : un cadre isolé ne permet pas de le lire

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — tir-0-eclat et tir-1-bande sont tous deux à ratio 1 (ligne de 5-6 px = largeur 2,5 × zoom 2,25, L 242-246 et 224-235 = alpha 0,95·souffle, attack-fx.ts:628) et le corps n'y est jamais blanc, parce qu'à `mur` le clignotement est coupé net (attack-fx.ts:626 `aClignoter = { sprite, blanc: false }`). La « garde » du message du banc n'est pas un objet à l'écran : c'est le booléen `pleine` lu par smoke.mjs:940-960. Il n'y a donc, dans l'image, ni jauge, ni marque, ni changement de couleur — seulement un trait plus épais et l'ARRÊT d'un clignotement.

**Ce que le joueur vit** — Qui n'a pas regardé la montée ne sait pas qu'il est à fond : le signal est différentiel (le corps cesse de clignoter, la ligne épaissit de ×1,67). Le fichier assume ce choix (« le signal change de NATURE, pas d'intensité », attack-fx.ts:620-624) — reste qu'un joueur qui regarde sa CIBLE, pas son avatar, n'a plus rien à lire.

**Direction de correction** — Décision d'Alexis (le choix est déjà consigné). Prérequis technique avant d'en rediscuter : capturer un ratio ≈ 0,5 et mesurer le delta réel de largeur et d'alpha à l'écran — le lot ne contient aucune frame de montée.

*`tir-0-eclat.png` · `tir-1-bande.png` · `tir-1b-arc-de-pres.png`*

### L6-8 · La ligne de tir et le trait partent 17 px SOUS la flèche encochée

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — tir-1-bande : la hampe grise de la flèche encochée (168,173,179) occupe y 377-378 ; la ligne de visée occupe y 393-397 (centre 395). Écart 17 px écran = 7,6 px monde ≈ 0,47 tuile. Cause : WorldScene.ts:1265 (charge) et :1309 (trait) passent `sprite.y − ANCRE_SOL_PX`, c'est-à-dire l'ancre de SOL — juste pour les zones de mêlée, qui sont des surfaces au sol, mais la ligne d'arc et la flèche en vol n'en sont pas. Visible à l'œil nu dans tir-1b : deux traits parallèles.

**Ce que le joueur vit** — La flèche semble quitter les pieds de l'archer et non son arc ; de près, on voit deux lignes là où il n'y a qu'un tir.

**Direction de correction** — Pour la LIGNE et le TRAIT seulement, partir de la hauteur de l'arc (l'ancre de sol reste juste pour les zones peintes au sol).

*`tir-1b-arc-de-pres.png` · `tir-1-bande.png`*

### L6-9 · La flèche retombée a la taille et le ton du décor ; le contour de ramassage existe mais n'est pas prouvé par ce lot

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — tir-4-repos : la pile occupe x 1203-1217 × y 364-394, soit 15 × 30 px sur un écran de 1280×800 ; fût (124,95,58) contre sol (146,156,81) = 2,00:1. Elle est de la même famille de tailles et de tons que les souches et bâtons semés partout dans le cadre. L'affordance existe bien côté code — snapshot-view.ts:1592-1594 (le contour blanc recopie l'inclinaison ±32° de la flèche plantée) branché sur `interactTarget` → `pick_up` (input-bindings.ts:692) — mais elle ne s'allume que curseur dessus, et le curseur est ailleurs sur cette capture : l'image ne la prouve ni ne l'infirme.

**Ce que le joueur vit** — Une flèche tirée à seize tuiles se cherche à l'œil dans un sol semé d'objets de même gabarit — sauf à savoir déjà où passer le curseur. Une ressource récupérable qu'on ne retrouve pas est une ressource perdue.

**Direction de correction** — Prouver d'abord : une capture curseur SUR la flèche (contour allumé) — le contrôle manque au scénario `tir`. Ensuite seulement, décision d'Alexis sur un repère passif (le trait qui reste au sol quelques secondes, ou un scintillement).

*`tir-4-repos.png` · `tir-5-au-sol.png`*

### L6-10 · Le clignotement de bande ne PEUT pas se lire sur le torse : un aplat blanc n'y gagne que ΔL 11,4

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — tir-0-eclat, boîte de 32 × 44 px prise sur le corps de l'avatar : 678 px sur ~1400 valent (255,245,196)/(255,244,195), L 243,6 — un remplissage blanc (255,255,255) n'y gagne donc que ΔL 11,4, SOUS le seuil de réussite du banc lui-même (`dLum >= 12`, smoke.mjs:881). Le gain vit sur les pixels sombres du sprite, (143,111,69) L 114,8 → +140, mais ils ne sont que ~125 px, 9 % de la boîte. Une sonde à trois pixels tire donc à pile ou face selon l'endroit où elle tombe — ce que le banc a d'ailleurs déjà constaté en commentaire (« mesuré : 22,7 une fois, 8,9 la suivante, pour le même effet »).

**Ce que le joueur vit** — Même quand il part vraiment, le blanchiment du corps ne peut se lire que sur les détails sombres de l'avatar (l'œil, les mains, l'arc) — pas sur les neuf dixièmes crème de sa silhouette.

**Direction de correction** — Mesurer la MOYENNE de la silhouette entière (bornes du sprite) au lieu de trois pixels ; et si le signal doit se voir de loin, le porter par un liseré (le contour à huit copies existe déjà, snapshot-view.ts:1576) plutôt que par un aplat sur un corps déjà clair.

*`tir-0-eclat.png`*

### L6-11 · L'orbe FAIM pleine a la couleur de l'herbe : 1,14:1

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — tir-4-repos et combat-poing : l'intérieur de la troisième orbe vaut (139,156,74) — exactement `hunger.fill = #8a9a4a` (packages/client/src/scenes/ui/palette.ts:99), donc l'orbe est PLEINE. L'herbe hors HUD vaut (156,178,84) à 14H → 1,31:1, et (145,166,75) à 09H → 1,14:1.

**Ce que le joueur vit** — Sur prairie, la jauge de faim ressemble à un trou dans le HUD : pleine et vide se distinguent à peine, seuls le cerne et l'icône se lisent. Les trois autres orbes (rouge, ambre, bleu-gris) se détachent, elle non.

**Direction de correction** — Sortir le vert de la faim de la bande du terrain (décaler vers l'ocre ou désaturer), ou poser un fond d'encre sous les orbes.

*`combat-poing.png` · `tir-4-repos.png`*

### L6-12 · Barre d'action : le numéro de slot à 1,35:1, et le décor traverse les cases

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — tir-4-repos : le chiffre « 1 » du slot vaut (47,47,38) sur un panneau (68,67,50) = 1,35:1. Le compte de flèches « ×4 » culmine à (176,171,147) = 4,41:1, mais sur des glyphes de 8 px de haut, la plupart de leurs pixels étant à mi-chemin. Au crop ×4, on voit le clutter du sol (bâtons, cailloux) à travers les cases 4 et 5 : les panneaux sont translucides.

**Ce que le joueur vit** — En plein tir, on ne compte pas ses flèches d'un coup d'œil, et on hésite sur la case qu'on va sélectionner : le repère numérique est presque au niveau du fond, et le sol qui défile derrière la barre ajoute du bruit là où il faut lire un chiffre.

**Direction de correction** — Monter le contraste des numéros de slot (encre claire, ou plaque opaque sous la barre) et donner au compte de pile la même encre que le libellé du jour.

*`tir-4-repos.png` · `tir-1-bande.png`*

### L6-13 · Le coût d'endurance — la monnaie du combat — n'existe qu'en niveau de liquide

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — hud-core.ts:279-285 : la vitale ne pose qu'une hauteur de remplissage et une couleur ; le chiffre part dans une infobulle (`tips.get(v.id).textContent = ...`). Dans les captures, l'orbe ⚡ est un disque ambre uni, sans graduation ni chiffre. Or le banc mesure des écarts qui décident du combat : 7 → 26 au poing, 15 → 32 à la lance, 18 → 34 à la hache.

**Ce que le joueur vit** — On tient un coup lourd sans savoir ce qu'il va coûter ni ce qu'il reste — dans un système explicitement conçu comme « un combat de coût », la ressource qu'on dépense n'est jamais chiffrée à l'écran.

**Direction de correction** — Conséquence de jeu (la difficulté et la décision de tenir ou lâcher) : Alexis tranche. Pistes : graduation sur l'orbe, chiffre permanent, ou empreinte du coût prévisualisée dans l'orbe pendant la charge.

*`combat-poing.png` · `combat-hache.png`*

---

## L7 — Captures — moments cérémoniels  *(18 constats)*

### L7-01 · L'indicateur de sauvegarde est toujours illisible sur un sol clair — à l'endroit précis où le dépôt écrit qu'il l'a réparé

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — sauvegarde.png, coin haut-gauche, zone x 12-140 / y 68-92 : le pixel de glyphe le plus clair est rgb(133,123,105) (l'élément est composé à --hud-alpha .85), l'herbe locale est rgb(51,98,44). Ratio WCAG = 1,72:1. Teinte déclarée #9a8f78 seule contre cette herbe : 2,25:1. Contre les TROIS fonds officiels de la palette elle passe pourtant largement — bg #0f0b08 : 6,13 · bgWarm #14100c : 5,93 · panel #1b1b22 : 5,36. Le défaut n'est donc pas la teinte, c'est le FOND : cet élément vit sur un quatrième fond (le monde éclairé) que la palette ne modélise pas. Or hud-core.ts:372-376 dit exactement le contraire : « Teinte dim (#9a8f78) et non faint (#8b8474) : au premier essai, l'indicateur était ILLISIBLE sur un sol clair ». Et palette.ts:47-56 cite ce même indicateur comme le précédent qui a fait relever `faint`. Le seul soutien réel est le contour d'encre 1 px (hud-dom.ts:80) : 4,30:1 du glyphe contre son propre contour, sur 1 pixel de large, à 11 px de corps.

**Ce que le joueur vit** — Il vient de sauver sa partie. Le jeu le lui dit, mais il ne peut pas le lire : à moins de savoir où regarder, la ligne se confond avec l'herbe. La seule réassurance du jeu sur ce qui est écrit au disque est un chuchotement dans le bruit — et elle ne dure que 3,2 s + 0,7 s de fondu.

**Direction de correction** — Ne pas re-choisir une teinte à l'œil : ce texte a besoin d'un FOND à lui (une plaque `bgWarm` ou `ink` à ~85 %, comme les infobulles `.hc-tip` en ont une) ou d'un contour bien plus épais. Toute nouvelle teinte se rend avec ses trois ratios ET son ratio sur l'herbe ensoleillée rgb(122,163,70) et la neige — les fonds du monde méritent d'entrer dans la table de calcul de la palette.

*`ux/sauvegarde/sauvegarde.png`*

### L7-06 · Deux lignes du voile de mort échouent au contraste sur le fond RÉEL du voile — et l'une d'elles est un vert, quatrième teinte hors charte

`MAJEUR` · `technique` · `MESURÉ` · statut : NOUVEAU

**Preuve** — Le voile n'est opaque qu'à 86 % (death-veil.ts:84) : le fond réel est un composite. Mesuré sur mort-voile.png (y 480-500) : rgb(35,36,39). Ratios calculés, teinte déclarée → fond nominal #14141a / fond composite mesuré / fond `panel` : `.dv-skills` #6f8a70 (13 px, death-veil.ts:100) = 4,84 / **4,10** / 4,52 ; `.dv-learn` #8a8172 (13 px, :99) = 4,77 / **4,04** / 4,45. Les deux passent sous 4,5:1 dès que la scène derrière est éclairée, et le calcul du même composite sur une scène de neige (~rgb(45,45,50)) donne 3,62 et 3,56. Le pixel confirme : « Vos mains, elles, n'ont rien oublié. » mesure rgb(111,138,112) contre rgb(35,36,39) = 4,10:1. Second point, indépendant : #6f8a70 est un VERT. La charte de palette.ts:11-13 dit « ENCRE + 2 ACCENTS, jamais plus », l'ambre et le rouge, le gel étant conditionnel. Le vert n'est ni l'un ni l'autre — et il ne porte ici aucune notion de froid.

**Ce que le joueur vit** — À sa mort, la ligne la plus consolante — « vos compétences vous restent » — est la moins lisible de l'écran, et elle est peinte dans une couleur que le jeu n'emploie nulle part ailleurs. Sur une mort en plein soleil ou dans la neige, elle passe sous le seuil de lecture.

**Direction de correction** — Deux corrections distinctes. (1) Contraste : ces deux lignes doivent être calculées contre le composite du voile, pas contre #14141a — soit relever les teintes, soit opacifier le voile (la stèle est à .94, la pause à .985 ; le voile de mort est le seul à .86). (2) La teinte verte est une question de CHARTE, donc d'Alexis : si « les compétences restent » doit se distinguer, l'écart peut se faire par l'encre (`faint` → `body`) sans introduire une couleur.

*`ux/mort/mort-voile.png`*

### L7-04 · L'écran de rupture est en Phaser et diverge visuellement des trois cérémonies DOM — dont une teinte de titre anonyme, #e8842c au lieu d'`ember`

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Trois cérémonies (mort, stèle, pause) sont du DOM plein écran (`position:fixed;inset:0`) — death-veil.ts:82, season-veil.ts:74, pause-menu.ts:93. La rupture est un `Phaser.GameObjects.Container` de rectangles (fatal.ts:34-86). Conséquences toutes visibles dans rupture.png : (a) titre rgb(232,132,44) = #e8842c, alors que les trois autres titres mesurent tous rgb(201,139,58) = #c98b3a — mesuré sur mort-voile y 305-340, saison-stele y 142-176, pause-menu y 76-100 ; (b) aucun interlettrage, quand les trois autres portent letter-spacing 6px ; (c) une BOÎTE de 720×300 cernée de rouge, quand les trois autres sont en pleine page sans cadre ; (d) un bouton PLEIN brun #8a4a2e à libellé crème (5,14:1) contre des boutons bordés-ambre à libellé #e8c66a (7,90:1 sur la stèle, 9,39:1 en pause) ; (e) ni surtitre, ni filet, ni lueur de braise ; (f) un seul geste, sans second choix ; (g) `const W = scene.scale.width` est lu UNE fois à la construction (fatal.ts:35-38) et aucun `resize` n'est écouté dans le fichier — le panneau reste au centre de la fenêtre d'AVANT, alors que les trois voiles DOM se recadrent seuls.

**Ce que le joueur vit** — Toutes les cérémonies du jeu se ressemblent — sauf celle qui arrive quand ça casse. Là, l'écran change de dialecte : autre orange, autre bouton, une boîte au milieu du noir. Le jeu a l'air d'avoir cédé la parole à un autre logiciel, exactement au moment où il faudrait qu'il rassure.

**Direction de correction** — Refaire la rupture en DOM, sur le patron des trois voiles (surtitre, titre #c98b3a interlettré, filet, corps, rangée de boutons bordés) : c'est le même écran à écrire, sans logique. Le seul argument pour Phaser serait « le DOM peut être mort aussi » — il ne tient pas, les trois autres voiles sont déjà du DOM. Si Phaser reste, alors au minimum : la teinte du titre depuis la palette, et un écouteur de redimensionnement.

*`ux/rupture/rupture.png` · `ux/mort/mort-voile.png` · `ux/saison/saison-stele.png` · `ux/pause/pause-menu.png`*

### L7-05 · L'écran de rupture ne dit pas ce qu'on perd, et laisse le motif technique en vedette — mais « erreur du worker » est le libellé de repli, pas la phrase du jeu

`MINEUR` · `design` · `SUSPECTÉ` · statut : NOUVEAU (requalifié)

**Preuve** — rupture.png, ligne saumon centrale, y 348-368. La chaîne est composée dans WorldScene.ts:841 : `hôte perdu : ${message}`, où `message` est le texte brut de l'erreur d'hôte ; l'autre chemin (WorldScene.ts:890-892) affiche « protocole hôte v3 ≠ client v4 ». Le corps ajoute « L'hôte de simulation ne répond plus » (fatal.ts:66). « worker » et « hôte de simulation » n'existent nulle part ailleurs dans l'UI joueur. À l'inverse, « seed » N'EST PAS du jargon ici : le mot est déjà exposé au joueur dans le menu des vallées (menu-dom.ts:468 « seed ${s.seed} », :537 le champ de semis) — cette moitié de la phrase est cohérente, ce qui rend le reste d'autant plus dissonant. Et sur ce qui est perdu : l'en-tête de fatal.ts:14-16 sait que « ce qui est perdu, c'est la progression de la session en cours », mais l'ÉCRAN ne le dit pas. Il promet seulement « Recharger régénère la même vallée » — ce qui parle du monde, jamais de la partie.

**Ce que le joueur vit** — Le jeu s'arrête net et lui parle de « worker ». Il ne peut ni comprendre la cause (ce n'est pas de son ressort), ni savoir ce qu'il perd : sa dernière sauvegarde ? son sac ? sa journée ? Le seul bouton disponible lui demande un acte de foi. rupture-recharge.png montre bien un monde jouable après le clic — mais avec une ceinture vide et « JOUR 1 », donc rien dans la frame ne dit s'il a repris sa partie ou recommencé.

**Direction de correction** — Alexis tranche le registre et la promesse. Ce que je peux prouver : il manque UNE phrase qui dise l'état de la partie (« Votre dernière sauvegarde est intacte — vous reprendrez à … », ou « la partie de cette session est perdue »), et le motif technique devrait vivre en second plan (petite ligne « détail : erreur du worker »), pas en vedette sous le titre. La sonde du banc devrait vérifier ce que RECHARGER restitue réellement (jour + contenu du sac avant/après), ce qu'elle ne mesure pas aujourd'hui.

*`ux/rupture/rupture.png` · `ux/rupture/rupture-recharge.png`*

### L7-07 · #8a8172 : un jumeau anonyme de `faint` #8b8474, à un chiffre hexadécimal près, dans le voile de mort

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — death-veil.ts:99 déclare `.dv-learn{color:#8a8172}` = rgb(138,129,114). palette.ts:58 nomme `faint: '#8b8474'` = rgb(139,132,116) — trois unités d'écart sur trois canaux, indiscernables à l'œil. `#8a8172` n'apparaît que dans ce fichier (grep sur packages/client/src : 1 fichier), donc la règle du mérite ne l'oblige à rien. Mais `faint` porte, dans son propre commentaire (palette.ts:47-56), l'histoire d'un relèvement CALCULÉ pour AA ; une copie anonyme de cette teinte ne bénéficiera d'aucun futur relèvement et dérivera au premier réglage — c'est exactement le scénario que le commentaire de `borderWarmHover` (palette.ts:73-78) décrit comme déjà arrivé (« trois rouges pour un seul accent »).

**Ce que le joueur vit** — Rien aujourd'hui. Demain : deux gris presque identiques qui divergent, l'un corrigé, l'autre non.

**Direction de correction** — Remplacer #8a8172 par `HEX.faint` — même rôle, même valeur à l'œil, et la ligne suit désormais les corrections de la palette. (Ne pas lancer de refactor de masse pour autant : c'est un remplacement d'un caractère dans un fichier, justifié par l'identité de rôle, pas par un décompte.)

*`ux/mort/mort-voile.png`*

### L7-08 · « Le Ravin est partie » : la stèle affiche une faute d'accord, deux fois, sur le verdict des voisins

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — saison-stele.png, ligne y 527-545 : « Le Ravin est partie les bras pleins (valeur 240). » — sujet masculin, participe féminin. finale.png, ligne y 555-570 : « le Clan du Levant est partie les bras pleins (valeur 42). » — même faute. La chaîne est écrite en dur dans /sim : packages/sim/src/worldevents.ts:306, `outcome: \`est partie les bras pleins (valeur ${granaryValue})\``. Le féminin y a été écrit en pensant « la Meute » (le test chronicle.test.ts:97 emploie d'ailleurs « la Meute des Cendres »), mais le sujet rendu à l'écran est le NOM DU VILLAGE, tiré du générateur de toponymes, souvent masculin.

**Ce que le joueur vit** — Sur l'écran-climax du jeu, la première phrase qu'il lit sur ses voisins est fautive. Le charme de la « voix du monde » tombe d'un cran.

**Direction de correction** — L'outcome ne peut pas être une phrase figée si son sujet varie : soit la formule évite l'accord (« a tout emporté », « est repartie chargée » → « repart les bras pleins »), soit /sim porte le genre du toponyme et l'accorde. Un test de /sim doit balayer les noms générés et affirmer qu'aucun verdict ne produit d'accord fautif — c'est une propriété, pas trois cas choisis.

*`ux/saison/saison-stele.png` · `ux/finale/finale.png`*

### L7-09 · « (valeur 240) » : une statistique brute au milieu d'une phrase de cérémonie

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — saison-stele.png y 535 et finale.png y 561 : « … est partie les bras pleins (valeur 240). » / « (valeur 42). ». Source worldevents.ts:306. Les autres verdicts de la même fonction, eux, sont entièrement diégétiques : « a sauvé 3 vies dont 2 évacuées », « a tenu jusqu'à la Cendre (1 debout) », « s'est éteint ». Le mot « valeur » désigne un score interne (`granaryValue`) et n'a aucun référent pour le joueur : 240 de quoi, comparé à quoi ?

**Ce que le joueur vit** — Au milieu de la seule page que le jeu écrit pour être relue, une parenthèse de tableur. Il ne sait pas si 240 est beaucoup.

**Direction de correction** — Décision d'Alexis : soit le chiffre disparaît, soit il se traduit en chose du monde (« … les bras pleins : trois greniers »). Je constate seulement que c'est le seul nombre non-diégétique des cinq verdicts.

*`ux/saison/saison-stele.png` · `ux/finale/finale.png`*

### L7-11 · Le menu pause cache 6 de ses 17 lignes de touches ET toute la section « LE SON » sous le pli, en aplatissant les groupes que la source porte déjà

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — pause-menu.png à 1280×800 : la dernière ligne visible est « Tourner ce qu'on pose / E » (y 715-728), déjà à demi effacée par le dégradé de la rangée collante (son texte mesure 3,80:1 contre 5,73-5,89:1 pour les lignes du dessus — la teinte est la même #9a8f78, c'est le dégradé qui la mange). Or la table compte 17 lignes : keymap-perso.ts:29-44 en déclare 16, plus « Ceinture (objet en main) » ajoutée en pause-menu.ts:34. Restent donc invisibles : Personnage, Carte, Chronique, Menu pause, Couper le son, Ceinture — puis la section « LE SON » entière avec son curseur de volume (pause-menu.ts:141-145). Second point : chaque action porte un champ `groupe` ('SE DÉPLACER', 'AGIR', 'BÂTIR', 'OUVRIR', 'LE SON', keymap-perso.ts:29-44) que pause-menu.ts:33 ignore — les 17 lignes sont rendues à plat, sans intertitre, dans un écran qui déborde déjà.

**Ce que le joueur vit** — Il ouvre la pause pour retrouver une touche ou baisser le son. Il voit une liste de 17 lignes sans relief, s'arrête à la 11e parce que le bas s'efface, et n'apprendra jamais qu'il y a un curseur de volume ici. L'œil n'a aucun point d'accroche dans le tableau des touches.

**Direction de correction** — Les groupes existent : les rendre (intertitre par `groupe`, comme « LE CLIC GAUCHE » et « LES TOUCHES » le sont déjà) donne à la fois la hiérarchie et des points de repère au défilement. Et remonter « LE SON » au-dessus de la liste des touches : c'est le seul RÉGLAGE de l'écran, tout le reste est un rappel.

*`ux/pause/pause-menu.png`*

### L7-12 · « upkeep » : un mot anglais de game-design dans une UI française, sur l'écran qui enseigne le jeu

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — pause-menu.png, tableau du clic gauche, ligne 5 (y 300-315) : « du bois, sur le Feu → le NOURRIR (il tient l'upkeep) ». Source pause-menu.ts:19. Le reste de l'écran est intégralement en français, y compris les notions inventées (« le Feu », « la ceinture », « parer »).

**Ce que le joueur vit** — Sur la fiche qui lui explique la règle centrale du jeu, un mot qu'il ne connaît pas et qui n'est pas du monde. Le seul endroit où l'auteur parle au lieu du jeu.

**Direction de correction** — Décision d'Alexis sur le mot juste (« l'entretien », « la faim du Feu », « ce qu'il consomme »). Je constate seulement que c'est un hapax : aucun autre anglicisme de conception dans les cinq écrans du lot.

*`ux/pause/pause-menu.png`*

### L7-13 · Le voile de mort donne 3,2 s pour 123 signes — et sa ligne la plus tendre est à la fois la dernière et la moins lisible

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — DEATH_VEIL_MS = 3200 et DEATH_FADE_MS = 550 (death-veil.ts:64,69) ; UIScene.ts:800 arme le retrait à 3200 ms. Le texte affiché dans mort-voile.png compte 123 caractères sur 4 lignes (« VOUS ÊTES TOMBÉ » 15 + « Le froid vous a pris. » 21 + « Vous ne portiez rien — la mort ne vous a rien pris. » 51 + « Vos mains, elles, n'ont rien oublié. » 36), soit ~23 mots. En retirant le fondu d'entrée, la fenêtre à pleine opacité est d'environ 2,6 s, ce qui exige ~8,8 mots/s. Et la 4e ligne, la dernière révélée par la lecture naturelle, est celle mesurée à 4,10:1 (constat L7-06).

**Ce que le joueur vit** — Il vient de mourir — donc il est distrait, contrarié, il regarde peut-être ailleurs. Le jeu lui écrit quatre phrases soignées et les retire avant qu'il ait fini la troisième. La consolation (« vos mains n'ont rien oublié ») est celle qu'il rate.

**Direction de correction** — Décision d'Alexis : allonger, ou ne rien retirer avant un geste. Ce que je peux dire techniquement : la stèle de saison est TERMINALE et attend un clic ; le voile de mort est le seul écran cérémoniel temporisé, et c'est le seul qui ne donne aucun geste. Si la durée reste, la ligne la plus importante doit remonter (2e position) plutôt que fermer la liste.

*`ux/mort/mort-voile.png`*

### L7-14 · Le conseil du monde est peint à 78 % en noir : un contour de 3 px sur un corps de 16 px avale la teinte ambre

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — sauvegarde.png (et à l'identique dans rupture-recharge.png et retour-seconde-veillee.png), ligne « F : cueillir baies & fibre. TAB : votre sac et l'artisanat. », zone x 400-880 / y 114-136. Comptage par tolérance ±28 : 500 pixels au cœur ambre #e8c66a, 1772 pixels au contour d'encre #14141a — soit 78 % de la masse du glyphe en noir. La déclaration est UIScene.ts:290-291 (`color: '#e8c66a'`) avec le style commun UIScene.ts:183-189 (`stroke: '#14141a', strokeThickness: 3`) : à 16 px, JetBrains Mono a des fûts de ~2 px, le contour de 1,5 px de chaque côté domine. Ratios : l'ambre seul contre l'herbe claire rgb(122,163,70) ne vaut que 1,78:1 ; c'est le contour qui porte la lisibilité (contour contre herbe : 6,25:1 ; ambre contre contour : 11,11:1).

**Ce que le joueur vit** — Le conseil est lisible — mais il est NOIR. L'intention (« encre chaude neutre », UIScene.ts:287-289) n'arrive pas à l'écran : le seul texte pédagogique du jeu a l'air d'un sous-titre incrusté, pas d'une voix du monde.

**Direction de correction** — Le contour est nécessaire (le texte flotte sur le monde) mais 3 px est calibré pour du 20-24 px, pas du 16. Soit épaissir le corps, soit descendre le contour à 2 px et compenser par une ombre portée, soit — plus sûr — donner à cette ligne la même plaque de fond que je recommande pour l'indicateur de sauvegarde (L7-01) : un seul remède pour les deux textes qui vivent sur le monde.

*`ux/sauvegarde/sauvegarde.png` · `ux/rupture/rupture-recharge.png` · `ux/retour/retour-seconde-veillee.png`*

### L7-17 · Deux bleus pour deux sens, et un « rouge de la Meute » qui est en fait une pêche voisine de l'ambre

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Pixels prélevés dans finale.png : puce du voisin Foyer = rgb(125,165,255) #7da5ff (x 513, y 534) ; puce du voisin Meute = rgb(255,165,115) #ffa573 (x 396, y 561). Ce sont exactement les sorties de `warmthColor(±100)` (lighting.ts:47-53). Or la palette réserve le bleu au GEL, `gel: '#6f93a0'` (palette.ts:64), « accent conditionnel : le froid » — deux bleus coexistent donc, l'un pour le froid, l'autre pour un village chaleureux. Et le « rouge » de la Meute n'est pas rouge : #ffa573 a une teinte de ~21°, coincée entre `alert` #e05a4a (~8°) et `ember` #c98b3a (~33°), et il est PLUS clair que les deux (10,15:1 sur `bg`, contre 6,75 pour l'ambre). Le commentaire de season-veil.ts:15-17 revendique cette couleur comme diégétique et « jamais le gel ni l'alerte » — l'intention est explicite, mais le rendu la contredit sur les deux bords.

**Ce que le joueur vit** — Deux puces de 6 px portent seules l'information « qui était quoi ». La bleue peut se lire comme du froid ; l'orangée se confond avec l'ambre de l'interface, qui est partout ailleurs sur le même écran (titres, filets, bouton).

**Direction de correction** — Décision d'Alexis, parce que c'est un arbitrage entre la langue du MONDE (la couleur qu'a brûlée le Feu, lue tout l'hiver) et la charte de l'INTERFACE. Ce que je peux offrir : la puce n'a pas besoin de porter seule le sens — un mot (« Foyer » / « Meute ») à côté du nom rendrait la couleur redondante plutôt que porteuse, ce qui règle aussi le cas du joueur daltonien.

*`ux/finale/finale.png` · `ux/saison/saison-stele.png`*

### L7-18 · La stèle terminale n'offre aucune sortie vers le menu : après soixante jours, le seul chemin est de rouvrir la même vallée

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — saison-stele.png : deux boutons, « ROUVRIR LA VALLÉE » et « relire la chronique ». C'est tout ce qu'il y a — season-veil.ts:149-152 ne déclare que `.sv-reopen` et `.sv-chron-toggle`, et l'écran est délibérément TERMINAL (« pas de retrait auto », en-tête :9-10). Le menu pause, lui, offre les deux directions (REPRENDRE + « retour au menu principal », pause-menu.ts:146-149). Le geste « ROUVRIR » relance la MÊME seed vidée (UIScene.ts:251-254, commentaire :166-169) — pour fonder une autre vallée il faut passer par l'écran des vallées, joignable seulement depuis le menu principal.

**Ce que le joueur vit** — Il vient de finir une saison de soixante jours. Le jeu lui propose de tout recommencer au même endroit, ou de relire. Pour changer de vallée, revoir ses sauvegardes ou simplement s'arrêter, il n'y a aucune porte — il faut fermer l'onglet.

**Direction de correction** — Décision d'Alexis sur ce qu'on offre au bout. Techniquement, le troisième bouton existe déjà ailleurs (le `quitMondes` du menu pause, UIScene.ts:262-263) : l'ajouter à la stèle en bouton fantôme, à côté de « relire la chronique », est un branchement, pas une invention.

*`ux/saison/saison-stele.png` · `ux/finale/finale.png`*

### L7-19 · Le retour dans une seconde Veillée n'est marqué par rien : c'est la frame d'un premier jour

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — retour-seconde-veillee.png : bandeau « JOUR 1 — ACTE I — 09H », ceinture vide, poids « △ 0 / 40 », conseil d'onboarding « F : cueillir baies & fibre. TAB : votre sac et l'artisanat. » — le même conseil de premier pas qu'en sauvegarde.png et rupture-recharge.png. Aucun élément de la frame ne distingue un RETOUR d'un premier lancement. Le jeu sait pourtant ce qu'il rouvre (WorldScene.ts:899-900 pose `veillee: { slot, seed }` dès le `ready`).

**Ce que le joueur vit** — Il revient dans sa vallée — celle qu'il a quittée — et le jeu l'accueille comme un inconnu, en lui réexpliquant la touche F. Le fil de la partie précédente n'est repris nulle part à l'écran.

**Direction de correction** — Décision d'Alexis sur ce qui doit se dire au retour (rien, une ligne, une carte de reprise). Ce que je constate : le conseil d'onboarding se réaffiche sur une partie reprise — c'est au minimum un état à conditionner, et c'est mesurable (le même texte apparaît dans les trois frames de monde du lot).

*`ux/retour/retour-seconde-veillee.png` · `ux/sauvegarde/sauvegarde.png` · `ux/rupture/rupture-recharge.png`*

### L7-20 · Le poids porté souffre du même défaut que la sauvegarde, dans le même coin : 2,03:1 sur l'herbe, et une teinte froide

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — retour-seconde-veillee.png et rupture-recharge.png, zone x 14-70 / y 732-748 : le « △ 0 / 40 » apparaît en glyphes sombres sur l'herbe (agrandissement ×4 vérifié). La teinte du palier `light` est #7e8a94 (hud-core.ts:48-49), rendue via `.hc-weight` sans couleur de feuille (hud-core.ts:411). Ratios calculés : 2,03:1 sur l'herbe d'ombre rgb(51,98,44), 1,20:1 sur l'herbe ensoleillée rgb(122,163,70). Accessoirement #7e8a94 est un gris BLEU, voisin du `gel` #6f93a0 (palette.ts:64) — un troisième emploi du bleu, pour une notion qui n'est ni le froid ni le Foyer.

**Ce que le joueur vit** — La charge qu'il porte — qui décide de sa vitesse — est le chiffre le moins lisible du HUD, et il n'est lisible qu'aux paliers d'alerte (ambre, orange, rouge), c'est-à-dire trop tard.

**Direction de correction** — Même remède que L7-01 (une plaque de fond pour les textes du HUD posés sur le monde) : c'est un seul chantier pour trois éléments (`.hc-save`, `.hc-weight`, le conseil). Le palier `light` doit aussi se choisir par calcul contre les fonds du monde, pas par « discret ».

*`ux/retour/retour-seconde-veillee.png` · `ux/rupture/rupture-recharge.png`*

### L7-03 · La plaque du couronnement tient sa couleur d'une affectation en ligne, sans repli dans la feuille — risque de maintenance, sans effet aujourd'hui

`COSMÉTIQUE` · `technique` · `SUSPECTÉ` · statut : NOUVEAU (requalifié)

**Preuve** — season-veil.ts:94 — `.sv-you-name{font-size:26px;font-weight:700;letter-spacing:1px;margin-top:8px;}` : pas de `color`. Idem :92 pour le conteneur `.sv-you`. La couleur n'existe que par `youName.style.color = archetypeColor(...)` à la ligne 193. Et la branche « joueur sans Feu » (:197-202) ne l'affecte JAMAIS : elle se contente de vider le texte et de poser `display:none`. `document.body` ne déclarant ni police ni couleur, la valeur héritée est le noir initial. Si ce chemin se rouvre un jour (un archétype inconnu, un `show()` réordonné, un futur écran qui réutilise la plaque), le nom se peint à 1,17:1 sur le fond mesuré de la stèle rgb(26,22,16) — invisible. C'est aussi la seule explication cohérente de la valeur rgb(0,0,0) qu'a rapportée la sonde (voir L7-02) : ce noir EXISTE dans la feuille, il n'est simplement pas celui qui a été peint ici.

**Ce que le joueur vit** — Aujourd'hui rien. Mais le moment le plus cérémoniel du jeu tient son unique couleur diégétique sur une ligne de JavaScript sans filet — et cette couleur ne tombe pas sur une teinte dégradée, elle tombe sur du noir sur noir.

**Direction de correction** — Poser un repli dans la feuille (`.sv-you-name{color:var(--sv-you,#ffffff)}`, l'archétype n'écrivant plus que la variable) : le blanc `neutre` est déjà la valeur de `warmthColor(0)`, donc le repli est le comportement voulu, pas un pis-aller. Puis PROUVER le garde-fou dans les deux sens : un test qui supprime l'affectation en ligne doit rougir en nommant `.sv-you-name`.

*`ux/saison/saison-stele.png`*

### L7-10 · Deux apostrophes cohabitent, y compris à deux lignes d'écart dans la même fonction

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Chaînes AFFICHÉES : apostrophe DROITE dans season-veil.ts:136 « LA VALLÉE S'ÉTEINT » et :138 « ce qu'on a tenu », et dans death-veil.ts:109 « n'ont rien oublié » — visibles comme un trait vertical dans saison-stele.png (y 158) et mort-voile.png (y 490). Apostrophe COURBE dans fatal.ts:53 « LA VEILLÉE S'EST ROMPUE » et :66 « L'hôte », dans pause-menu.ts:137 « L'OBJET EN MAIN DÉCIDE » et :19 « l'upkeep », dans onboarding.ts:46 « l'artisanat ». Et dans /sim, worldevents.ts:312 met les deux à deux lignes d'intervalle : « a tenu jusqu'à la Cendre » (droite) puis « s'est éteint » (courbe).

**Ce que le joueur vit** — Deux titres cérémoniels côte à côte, deux apostrophes différentes. Ça ne se nomme pas, ça se sent : l'écran a l'air moins tenu.

**Direction de correction** — Choisir la courbe (majoritaire, et correcte en typographie française) et la faire tenir par un garde-fou du même idiome que les autres : un test qui lit les sources par `import.meta.glob` et refuse toute apostrophe droite dans une chaîne affichée. Le prouver dans les deux sens en cassant volontairement une chaîne — le test doit nommer le fichier fautif.

*`ux/saison/saison-stele.png` · `ux/rupture/rupture.png` · `ux/pause/pause-menu.png`*

### L7-16 · L'italique de la chronique est une oblique SYNTHÉTIQUE : le jeu n'embarque aucune fonte italique

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — saison-chronique.png, ligne J47 « Quelqu'un est tombé. » (y 603-618) : les glyphes sont penchés. La déclaration est season-veil.ts:106 (`.sv-cl.sv-intime .sv-cl-text{font-style:italic;…}`), mais game-font.ts:15-16 et :29-30 n'injectent que deux `@font-face`, tous deux `font-style:normal` (latin 400 et 700). Le navigateur fabrique donc l'inclinaison par transformation — c'est le seul style synthétisé de toute l'interface.

**Ce que le joueur vit** — La ligne « intime » de la chronique — le poids le plus rare, réservé aux morts — est rendue par un faux italique : les contreformes s'écrasent et la ligne paraît plus légère que les autres, alors qu'elle est censée être la plus grave.

**Direction de correction** — Deux issues honnêtes : embarquer la variante italique de JetBrains Mono (un `@font-face` de plus dans game-font.ts), ou distinguer le poids « intime » autrement (l'échelle d'encre le fait déjà — la ligne est en `dim`). Choix d'Alexis, mais la voie « ne rien changer » revient à garder un style que la fonte ne sait pas dire.

*`ux/saison/saison-chronique.png`*

---

## L8 — Captures — lumière, heure, vivant  *(13 constats)*

### L8-01 · À l'heure dorée l'avatar vire au gris NEUTRE : les deux chaînes d'éclairage divergent — mais son contour s'y détache MIEUX qu'à toute autre heure (3,28:1)

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Même caméra, même tuile, pixel à pixel sur la ligne y=370. Corps de l'avatar (x 632..644) : midi (255,249,199) L=248 · dorée (106,108,108) L=107,7 · minuit (67,78,95) L=76,6. Sol immédiatement à droite (x 660..672) : midi (167,181,86) L=165,6 · dorée (152,144,61) L=137,5 · minuit (52,60,48) L=56,2. Contraste avatar/sol : 2,60:1 à midi (avatar PLUS CLAIR, Δ+82) → 1,20:1 à 20h (avatar PLUS SOMBRE, Δ−30) → 1,54:1 à minuit. Le sol, lui, est un multiply propre : de midi à minuit (167,181,86)→(52,60,48), soit (0,311·0,331·0,558), à 3 % près du multiplicateur annoncé M=(0,303·0,320·0,540) dans night-veil.ts/lighting.ts:157. Aucun multiply chaud appliqué à l'albédo (255,249,199) ne donne un gris parfaitement neutre à 43 % de sa luminance : l'avatar ne reçoit PAS la même lumière que le sol. Mécanisme, lu dans le code : le sol est un Mesh2D hors Light2D, teinté par le voile de l'heure (lighting.ts:177 — à 20h GOLDEN_COLOR, α 0,34, MULTIPLY) ; l'avatar est sur spr-player_lit et passe par le LightsManager (WorldScene.ts:1596-1598). Or dynamic-lighting.ts:100 `sun.intensity = day*1.2` et :107 `moon.intensity = (1-day)*0.32`, avec daylight(20)=0,2 (lighting.ts:80) → soleil 0,240 contre LUNE 0,256. À 20h la lune passe devant le soleil, et leurs teintes opposées (GOLDEN 0xffb060 vs MOON_COLOR 0xaec2e6) s'annulent en gris ; l'ambiante Light2D est déjà à lerp(0x33415f,0xb6ad9c,0,2) = (77,87,107), bleutée. Deux chaînes d'éclairage, et à 20h elles ne sont pas à la même heure.

**Ce que le joueur vit** — À l'heure exacte où le jeu dit « la nuit approche, rentre au feu », son propre personnage se fond dans le sol : gris neutre sur sol doré, 1,20:1. C'est le moment de la journée où l'on court, où l'on cherche le feu des yeux — et c'est le moment où l'on se perd soi-même dans le décor. À minuit il se voit MIEUX qu'à 20h.

**Direction de correction** — Faire porter à la lune une fenêtre de nuit comme le voile en a une, ou plafonner la lune sous le soleil tant que day>0 (elle ne doit jamais le dépasser au crépuscule) ; et vérifier que l'ambiante Light2D suit la même courbe horaire que le voile MULTIPLY du sol, sinon les deux chaînes continueront de diverger à d'autres heures. Le nombre à tenir : le contraste avatar/sol ne doit jamais descendre sous celui de minuit (1,54:1), et ne doit pas changer de POLARITÉ au fil de la journée.

*`ux/etalonnage/etalonnage-midi.png` · `ux/etalonnage/etalonnage-doree.png` · `ux/etalonnage/etalonnage-minuit.png`*

### L8-02 · À minuit le détail médian d'un bloc 16×16 vaut 1 niveau — et le scénario `etalonnage` n'ASSERTE rien du tout

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Le banc a raison sur son critère et je le confirme sur mes propres pixels (ROI x0..1280 / y40..660) : midi µ=131,7 σ/µ=0,280 · dorée µ=105,5 σ/µ=0,320 · minuit µ=45,5 σ/µ=0,272 — courbe monotone, contraste relatif tenu (mes µ diffèrent des 146,1/114,3/49,1 du banc parce que j'exclus le letterbox et la bande HUD ; les RAPPORTS concordent : 2,89 vs 2,98 pour midi/minuit). Le critère qui manque est ABSOLU. σ local sur blocs 16×16 (ROI y48..650) : p50 = 3,1 (midi) / 2,4 (dorée) / 1,0 (minuit) ; p90 = 27,9 / 28,4 / 9,6. À minuit le détail médian d'un bloc de 16×16 pèse UN niveau de code. Répartition des niveaux à minuit : 97,6 % de l'image sous 64, 45,0 % sous 40, 3,6 % sous 24 (contre 3,0 % / 0,3 % / 0,0 % à midi). Et sur les objets qui comptent, mêmes ROI aux trois heures : tronc/sol 2,64:1 (midi) → 1,32:1 (minuit) ; bloc rocheux/sol 1,32:1 → 1,14:1. CAVEAT ESSENTIEL : etalonnage-minuit ne contient AUCUN Feu, or tout le design du voile est « la nuit que le feu creuse » (night-veil.ts). Cette mesure porte donc sur la nuit LOIN DE TOUT FEU — le cas dangereux que le jeu met en scène, mais pas la nuit complète.

**Ce que le joueur vit** — Dans une pièce noire, la nuit d'ASHES est belle et lisible : l'œil obéit à Weber, le rapport conservé suffit. Dans un salon éclairé, sur un portable, la lumière ambiante réfléchie par la dalle ajoute un plancher CONSTANT qui détruit un contraste RELATIF : les 97,6 % de l'image sous le niveau 64 s'écrasent, un tronc à 1,32:1 disparaît, un bloc rocheux à 1,14:1 n'a jamais existé. On se cogne à des obstacles qu'on ne voit pas, la nuit où les loups sortent.

**Direction de correction** — Ajouter un critère ABSOLU au scénario `etalonnage` à côté de σ/µ : le σ local médian (blocs 16×16) et la part de l'image sous un seuil, avec un plancher à tenir à minuit (p. ex. σ_loc p50 ≥ 3 et < 60 % de l'image sous 64). Puis relancer la même mesure AVEC un Feu allumé dans le cadre : c'est le seul chiffre qui dira si la nuit conçue — celle que le feu creuse — passe le seuil, et il n'existe pas aujourd'hui.

*`ux/etalonnage/etalonnage-minuit.png` · `ux/etalonnage/etalonnage-midi.png`*

### L8-03 · Aucun calibrage d'ÉCRAN nulle part — la nuit a bien une manette (le feu la creuse), pas le moniteur

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — L'écran OPTIONS ne contient que deux sections, lues dans le source : `menu-dom.ts:486-519` — « LE SON » (un slider de volume + un bouton muet) et « LES TOUCHES » (rebind + reset). Le menu de pause n'en a pas davantage : `pause-menu.ts:132-148` — clics, touches, son, REPRENDRE, retour au menu. Un `grep -rn "luminosit|gamma|brightness" packages/client/src` ne rend que quatre `backdrop-filter` de voiles internes (pause, saison, mort) et un `filter:brightness(0)` d'icône HUD : aucun réglage exposé au joueur. Croisé avec L8-02 : 97,6 % de la frame de minuit sous le niveau 64, et rien pour la relever.

**Ce que le joueur vit** — Un joueur sur une dalle TN bon marché, ou simplement assis face à une fenêtre, ne peut RIEN faire. Il ne joue pas une nuit difficile : il joue un écran noir. Or la nuit n'est pas une ambiance ici, c'est la règle la plus dure du jeu (les loups, le froid, le feu) — et c'est la seule règle qu'on ne peut pas rendre visible.

**Direction de correction** — Décision d'Alexis, pas la mienne. Les options que la mesure autorise : (a) un curseur de luminosité/gamma dans OPTIONS avec la mire habituelle « montez jusqu'à voir à peine ce logo » ; (b) un plancher de noir plus haut à minuit, mais cela coûte de la peur ; (c) assumer et exiger une pièce sombre. Ce que je peux mesurer une fois la décision prise : le σ local médian et la part sous seuil à minuit, avec et sans Feu.

*`ux/etalonnage/etalonnage-minuit.png`*

### L8-04 · La caméra ne rattrape pas l'avatar sous swiftshader — mais elle n'est responsable que d'UN des trois résultats incriminés

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — `WorldScene.ts:1013` : `startFollow(playerSprite, true, 0.16, 0.16)` — le lerp de Phaser s'applique PAR FRAME, pas par unité de temps. Sous swiftshader (peu d'images/s), la caméra reste très loin derrière. Mesuré dans les captures : dans feeling-remous l'avatar est à x≈5 alors que le centre est 640, soit 635 px = 17,6 tuiles hors centre (36 px/tuile : VISIBLE_TILES_TALL=20, framing.ts:22, zoom 2,25). Et le recalage image-à-image des quatre captures de brume contre celle de midi donne dx = +572 px → +226 → +52 → 0 : la caméra était ENCORE en train de se recentrer pendant toute la série A6. Conséquences directes : (1) A5 photographie un avatar à 31 tuiles de l'eau ; (2) les captures 0530 et 0600 sont prises 8 à 16 tuiles à l'ouest du point choisi et ne contiennent plus une goutte d'eau ; (3) la bande noire de L8-09 n'apparaît que dans les frames où la caméra galope.

**Ce que le joueur vit** — Rien, sur une machine normale : à 60 im/s et 6 tuiles/s la caméra ne décroche que de quelques pixels. C'est le BANC qui est faussé, et avec lui trois verdicts du lot. (À noter tout de même : le retard croît en 1/FPS — une chute d'images fait décrocher le cadrage, pas seulement saccader.)

**Direction de correction** — Côté banc : avant CHAQUE mesure ou capture, re-téléporter puis attendre que la caméra soit recalée — une garde `|cam.centre − avatar| < 1 tuile` avant de déclencher, plutôt qu'un `waitForTimeout`. Côté jeu (à trancher séparément) : rendre le lerp de suivi indépendant du delta, sinon le cadrage change de comportement avec le taux d'images.

*`ux/feeling/feeling-remous.png` · `ux/feeling/feeling-brume-0530.png` · `ux/feeling/feeling-brume-0600.png`*

### L8-05 · A5 n'affirme jamais sa prémisse : ses DEUX ✓ sont aussi vides que son ✗

`MINEUR` · `technique` · `SUSPECTÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Ce que la capture montre : dans feeling-remous.png l'avatar (rectangle crème, x=0..10, y=342..394) est plaqué contre le bord GAUCHE du cadre et l'eau ne commence qu'à x≈1140 — 1130 px, soit 31 tuiles. Il n'y a rien à photographier. Ce que le scénario fait : `smoke.mjs:1462` téléporte à `gue.x + 3.5, gue.y + 3.5` — un coin de ZONE décalé de 3,5 tuiles, pas une tuile d'eau ; `:1538-1554` attend 1,2 s, enfonce KeyQ (plein ouest), échantillonne 6×160 ms, PUIS capture — la touche est encore enfoncée pendant la capture (~1 s en headless) ; aucun re-téléport, et surtout aucune assertion que `terrain[avatar] === TERRAIN_SHALLOW_WATER` avant d'affirmer que marcher fait un sillage. Le gué est une rivière NORD-SUD (visible dans feeling-gue-jour) : partir plein ouest en sort. Le chemin de code, lui, existe : `WorldScene.ts:1502-1509` (`if (!shallow …) continue` puis `waders.push({… strength: force …})`) et `water-layer.ts:905/913` le consomme.

**Ce que le joueur vit** — Indéterminé, et c'est le point : ce lot ne permet PAS de dire si le remous existe en jeu. Le ✗ mesure l'instrument, pas le jeu. Je ne peux pas non plus affirmer que la fonctionnalité marche — seulement que le câblage est là et que la preuve manque.

**Direction de correction** — A5 doit se poser sur une tuile d'eau CHOISIE (balayer `map.terrain` pour un `=== 4` proche du gué), l'AFFIRMER avant de marcher (`terrain[floor(y)][floor(x)] === 4`, sinon ✗ instrument), marcher PERPENDICULAIREMENT au fil (nord-sud dans une rivière nord-sud), et relâcher la touche avant la capture. Et le journal ne doit pas recevoir « pas de remous » tant que cette garde n'existe pas.

*`ux/feeling/feeling-remous.png` · `ux/feeling/feeling-gue-jour.png`*

### L8-06 · Le banc teste la dérive sur le SEUL nœud que la spec en exempte — un rouge permanent sur une décision d'Alexis

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — `tools/smoke.mjs:11319` choisit le nœud à raser : `s.view.nodes.find((n) => n.type === 'berry_bush' && n.stock > 0)`. Or `packages/sim/src/economy.ts:598` : `if (def.skill !== 'mining' && node.type !== 'berry_bush' && !dansEmprise(...))` — le buisson à baies est explicitement exclu de la relocalisation. `docs/specs/recolte-vivante.md` D1 le dit mot pour mot : « Le buisson à baies est VIVACE (décision Alexis 2026-07-19) : comme un arbre fruitier, il reste sur sa tuile et ses baies repoussent dessus. » Le ✗ affirme donc un défaut là où le code respecte une décision d'Alexis. Corollaire : `smoke.mjs:11353` se téléporte ensuite en `after.tx+0.5, after.ty+1.5`, c'est-à-dire la MÊME tuile — `vivante-pousse.png` rephotographie `vivante-trace.png` en la légendant « la pousse à sa nouvelle place ». Les trois captures montrent un seul endroit.

**Ce que le joueur vit** — Rien — le jeu se comporte comme prévu. C'est un rouge permanent au banc, du genre qui apprend à ne plus lire les rouges.

**Direction de correction** — Faire choisir au scénario un nœud dont la famille DÉRIVE (`def.skill !== 'mining'` ET `type !== 'berry_bush'` — un arbre, une plante à fibre), et garder le buisson pour un second volet qui affirme l'INVERSE (« vivace : il ne bouge pas »), puisque c'est aussi une règle à protéger. Retirer aussi la capture `vivante-pousse` tant qu'elle vise la même tuile.

*`ux/recolte_vivante/vivante-avant.png` · `ux/recolte_vivante/vivante-trace.png` · `ux/recolte_vivante/vivante-pousse.png`*

### L8-07 · Vider un buisson à baies déplace 40 pixels — trois crans de baies pour toute une réserve, par décision du 2026-07-19

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Différence pixel à pixel entre vivante-avant et vivante-trace (le buisson a été rasé jusqu'à stock 0, 8 baies sont entrées au sac). Comptage des pixels rouges sur la ROI du buisson (x 655..700, y 380..410) : 40 → 0. Statistiques de la même ROI : µ 92,0 → 91,7 · σ 30,8 → 30,4 — inchangée. Sur toute la frame, les SEULS blocs 32×32 dont la luminance moyenne bouge de plus de 3 sont à y=104 : le bandeau tutoriel qui s'estompe. Le buisson garde exactement sa taille, sa forme, sa place et sa couleur. C'est conforme à l'intention : `snapshot-view.ts:266-277` — « Un buisson vidé (stock 0) reste dessiné NU (-0) », au plus 3 baies dessinées, proportionnellement au stock. Le rendement est donc lisible sur TROIS crans pour toute une réserve, et l'épuisement se dit par la disparition de deux carrés de 4 px sur une silhouette de ~30×28 px.

**Ce que le joueur vit** — Il frappe huit fois, la case 1 de sa barre se remplit — mais le monde ne dit rien. Le buisson qu'il vient de dépouiller ressemble trait pour trait à celui d'à côté qui est plein. Rien n'apprend « ce coin-ci est fini, va voir ailleurs », qui est pourtant toute l'idée de la récolte vivante. C'est le seul objet du lot qui reste identique après qu'on a agi dessus.

**Direction de correction** — À Alexis de trancher, parce que « le buisson est vivace et reste sur sa tuile » est SA décision (2026-07-19) et qu'il ne faut pas la rouvrir par la bande. Ce que la mesure autorise sans y toucher : donner au buisson vidé un état visible qui n'est pas un déplacement — feuillage qui se dégarnit ou se ternit sur la durée [tick, regrowAt] (le timer caché devient lisible, exactement ce que promet R3), ou une pousse à l'échelle comme les autres familles. Décision de jeu, conséquence : ce qui devient visible ou non pour choisir où cueillir.

*`ux/recolte_vivante/vivante-avant.png` · `ux/recolte_vivante/vivante-trace.png`*

### L8-08 · Le Cendreux sort à 0,70 tuile de son trou (et non 1,25) — le corps marche déjà que le cratère reste béant à côté

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Bounding-box du corps (bleu-gris) sur les trois captures d'extraction : enfoui → x 642..655, une seule ligne à y=411, cx=648,5 ; mi-corps → x 577..616, y 373..417 (h=45 px), cx=596,5 ; sorti → x 577..616, y 326..413 (h=88 px), cx=596,5. Bounding-box du tertre, stable : centre x=641,5 aux cinq captures. Le corps saute donc de 52 px vers l'ouest ENTRE « enfoui » et « mi-corps », et finit à 45 px (1,25 tuile) du cratère, qui reste béant à sa droite. Le code ne l'en empêche pas : `snapshot-view.ts:993-1001` ne coupe le sprite qu'en VERTICAL (`setCrop(0, 0, frame.width, …)`) et pose sa position sur celle de la sim (`sprite.setPosition(p.px, p.py - lift + coupe + 2*immersion)`) ; et `packages/sim/src/morts.ts:288-300` fait naître le Cendreux avec `targetId = r.preyId` et `huntTargetId` posés au même tick, sans le moindre étourdissement ni wind-up. Le FX d'émergence dure 900 ms côté client ; la sim, elle, chasse dès le tick suivant. Le harnais (qui avance l'horloge de rendu à la main pendant que la sim tourne en temps réel) exagère l'ampleur ; il ne l'invente pas.

**Ce que le joueur vit** — La plus belle mise en scène du jeu se casse à son point culminant. Le sol travaille, le cratère s'ouvre — et le mort ne sort pas de LÀ : un demi-torse dérape sur l'herbe à côté, pendant que le trou reste vide derrière lui. Le lien de cause à effet entre le tertre et la créature se défait à l'image même où il devait se sceller.

**Direction de correction** — Tenir l'entité immobile le temps de l'extraction : soit la sim lui donne un wind-up d'émergence (elle sait déjà faire, les wind-ups de combat font 300-500 ms — et c'est aussi une décision de jeu : un Cendreux qui sort de terre est-il attaquable gratuitement pendant 900 ms ? à Alexis), soit le client ancre le sprite au site du réveil tant que `enfouissement > 0` et ne le rend à la sim qu'à la fin. Vérifiable au banc : ajouter à `reveil` un relevé de `|sprite.x − site.x|` aux trois instants, attendu < 0,25 tuile tant que la coupe est > 0.

*`ux/reveil/reveil-sortie-enfoui.png` · `ux/reveil/reveil-sortie-mi-corps.png` · `ux/reveil/reveil-sortie-sorti.png` · `ux/reveil/reveil-cran-3.png`*

### L8-09 · A6 promet « la brume visible sur l'eau » et photographie de la prairie — la brume, elle, est déjà mesurée ailleurs

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (requalifié)

**Preuve** — Recalage des frames par corrélation (la caméra a bougé entre elles, cf. L8-04) : 0800→1200 dx=+52, dy=0, résidu 0,056 — c'est la seule paire assez propre pour conclure, et c'est justement celle qui oppose densité 0,329 à densité 0. Ajustement affine par canal sur ~78 000 paires de pixels recalés : gain (0,974 · 0,954 · 0,844), OFFSET ADDITIF (−0,3 · −2,0 · +5,8) sur 255. La différence entre 8h et midi est un multiply presque pur : il n'y a AUCUN voile additif. Une nappe à densité 0,329 avec les crans de `morning-mist.ts` (α au pic 0,284/0,351/0,418) laisserait des dizaines de niveaux d'offset. (Les paires 0530→1200 et 0600→1200 ont des résidus de 0,189 et 0,217 — je n'en tire aucun chiffre.) Pourquoi : l'en-tête de `morning-mist.ts` pose que la brume est un CHAMP DE DISTANCE À L'EAU, plafonné à `DIST_FIELD_MAX = 15` tuiles (`mist-layer.ts:39`) — « elle NAÎT DE L'EAU ». Or les quatre captures ne contiennent pas une goutte d'eau : la caméra a suivi l'avatar loin à l'ouest du Gué (L8-04). Et la sonde `smoke.mjs:1567` lit `ly.density`, c'est-à-dire le réglage GLOBAL de la marée — une fonction pure de l'heure — et non ce qui est peint à l'écran.

**Ce que le joueur vit** — Indéterminé pour ce lot. Je ne peux dire ni que la brume est belle, ni qu'elle gêne, ni si le passage de 0,329 à 0 est progressif : elle n'était pas dans le cadre. Ce que je peux affirmer, c'est que le banc dit « brume 0,38 » sur une image qui n'en a pas un pixel — un vert qui ne prouve rien.

**Direction de correction** — A6 doit (1) se re-téléporter au bord de l'eau et attendre le recalage caméra avant CHAQUE heure, (2) affirmer sa prémisse — « il y a de l'eau dans la vue » — sinon ✗ instrument, et (3) remplacer `ly.density` par une mesure DE PIXELS : offset additif moyen par canal entre l'heure testée et la même vue à midi (le protocole ci-dessus, recalage + ajustement affine, marche et donne un nombre franc). Alors seulement la question « la brume s'estompe-t-elle en pente continue de 8h à midi ? » aura une réponse.

*`ux/feeling/feeling-brume-0530.png` · `ux/feeling/feeling-brume-0600.png` · `ux/feeling/feeling-brume-0800.png` · `ux/feeling/feeling-brume-1200.png`*

### L8-10 · « Un Cendreux vous ont senti » — la phrase la plus dramatique du jeu est fautive au singulier

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Lisible en toutes lettres au bas de reveil-cran-0.png et reveil-cran-3.png : « Un raclement dans le noir. Un Cendreux vous ont senti. » Source : `packages/client/src/scenes/WorldScene.ts:2407` — `const combien = event.count > 1 ? \`${event.count} Cendreux\` : 'Un Cendreux'` puis `publishError(..., \`Un raclement dans le noir. ${combien} vous ont senti.\`)`. Le verbe est figé au pluriel alors que le sujet bascule. Le même défaut, à la même construction, quatre lignes plus haut pour la meute : `:2401` — « Un hurlement, tout près. Un loup vous ont choisi. »

**Ce que le joueur vit** — Les deux seuls avertissements que le jeu donne avant de le faire chasser — le hurlement et le raclement — sont ceux qui portent une faute de grammaire. Le GDD §9bis exige « annoncés, pas surprises » : l'annonce arrive, mais elle se lit comme un placeholder, et le frisson tombe.

**Direction de correction** — Accorder le verbe avec le compte, aux deux endroits : `event.count > 1 ? \`${count} Cendreux vous ont senti\` : 'Un Cendreux vous a senti'` (et `Un loup vous a choisi` / `N loups vous ont choisi` en :2401). Une garde de texte sur les deux branches de chaque phrase suffit à ce que ça ne revienne pas.

*`ux/reveil/reveil-cran-0.png` · `ux/reveil/reveil-cran-3.png`*

### L8-11 · Une bande noire au bord de l'écran quand la caméra file : le sol est peint une frame en retard

`MINEUR` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — feeling-remous.png, ligne y=370 : x 0..10 = l'avatar (211,200,162), x=12..53 = noir uni (18,15,13), x=54 = le sol (167,147,88). La bande fait 42 px de large ici, court de y=60 à y=600 (toute la hauteur utile) et se retrouve à 31 px dans feeling-brume-0530, puis disparaît en 0800 et 1200. Elle n'est PAS hors carte : des accessoires de flore y sont dessinés (champignon à ~(9,222), touffe à ~(10,286) dans brume-0530), donc les tuiles existent — c'est le sol qui manque. Mécanisme (SUSPECTÉ, mais l'arithmétique colle) : `ground-layer.ts:47-54` reconstruit la fenêtre du Mesh2D depuis `camera.worldView` avec une marge d'UNE tuile ; `WorldScene.ts:1353` appelle `this.ground.render(this.cameras.main)` dans `update()`, donc AVANT que Phaser n'applique le lerp de suivi au preRender. Le sol est peint pour la caméra de la frame précédente. Marge disponible : 1 tuile = 36 px d'écran. Bande observée : 42 et 54 px — la marge est dépassée exactement quand la caméra galope (L8-04).

**Ce que le joueur vit** — À 60 im/s et 6 tuiles/s la caméra ne bouge que de ~3,6 px par frame, très à l'intérieur des 36 px de marge : invisible. Le défaut n'apparaît qu'au bas taux d'images — donc chez le joueur sur machine faible, ou pendant une chute d'images, sous forme d'un liseré noir clignotant au bord de l'écran dans le sens de la marche.

**Direction de correction** — Construire la fenêtre du sol depuis la position de la caméra APRÈS le suivi (le rendre au preRender/postUpdate plutôt que dans `update`), ou élargir la marge de `ground-layer.ts:51-54` à 2 tuiles. Le second est une ligne et suffit à couvrir la plage de FPS réaliste.

*`ux/feeling/feeling-remous.png` · `ux/feeling/feeling-brume-0530.png`*

### L8-12 · Les clairières sont des RECTANGLES et ça se voit à l'œil nu, à toute heure

`MINEUR` · `design` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — etalonnage-midi.png, balayage de la ligne y=200 : marches de luminance nettes à x=585 (+36), x=622-623 (+35/+38), x=909-910 (−44), x=946-947 (−37). Soit une marche d'une tuile (37 px) puis un plateau de 287 px — exactement 8 tuiles (36 px/tuile : `framing.ts:22`, VISIBLE_TILES_TALL=20, zoom 2,25), c'est-à-dire `RELIEF.MOTIF = 8` (`racine-relief.ts:67`). Le bord vertical à x≈623 court de y=51 à y=685, la pleine hauteur du cadre. Amplitude : (122,174,73) → (179,207,91), L 156,5 → 187,9, soit +20 % à midi ; sur la MÊME arête à minuit (40,57,41) → (56,68,50), L 51,9 → 62,7, +21 %. Le multiply conserve la marche : elle survit intacte à la nuit. Origine assumée dans la sim : `zone-content.ts:1106` — « LES CLAIRIÈRES : décidées par BLOC (cf. clairiereForet) → des trouées RECTANGULAIRES » ; `zone-content.ts:1151` : `clairiereForet` évalue `fbm2` au CENTRE du bloc de 8 tuiles et rend la même valeur pour les 64 tuiles. Le semis d'arbres l'évide, le sol y verdit — les deux au bord franc du bloc.

**Ce que le joueur vit** — Le monde est pavé de grands carrés de 8 tuiles plus clairs, aux arêtes parfaitement horizontales et verticales, hautes de tout l'écran. À midi c'est un damier discret. À minuit c'est pire : avec un σ local médian de 1 niveau (L8-02), cette marche de 10,8 niveaux est DIX FOIS plus forte que le détail réel le plus fin — la chose la plus visible dans la nuit d'ASHES est un artefact de génération, pas le terrain ni un obstacle.

**Direction de correction** — À Alexis, parce que c'est une conséquence de lecture du monde, pas un bug. La mesure suggère : adoucir la clairière sur sa marge (évaluer `clairiereForet` par TUILE avec le centre de bloc comme socle, pour que le bord soit une rampe d'une ou deux tuiles au lieu d'une marche), ou casser l'alignement axial (décalage seedé par bloc). Ce qu'il faut peser : la clairière est aussi une CHAMBRE DE LUMIÈRE lisible de loin — l'adoucir peut coûter cette lisibilité-là. Je ne tranche pas.

*`ux/etalonnage/etalonnage-midi.png` · `ux/etalonnage/etalonnage-minuit.png` · `ux/feeling/feeling-brume-1200.png`*

### L8-13 · « partie sauvegardée » : le seul texte du HUD dont le contraste dépende du sol qu'on foule

`COSMÉTIQUE` · `technique` · `MESURÉ` · statut : NOUVEAU (non réfuté)

**Preuve** — Cœur de glyphe relevé au pixel (ligne y=78) : (115,108,92), L=108,6 — constant aux deux heures. Fond immédiat : à 08h l'herbe (52,93,43) L=79 → 1,58:1 ; à 01h (28,44,34) L=39,7 → 2,85:1. Le libellé au-dessus, lui, tient : `.hc-day` en #ffffff mesure 4,99:1 à 08h et 11,67:1 à 01h contre le même monde. Source : `hud-core.ts:377` — `.hc-save{font-size:11px;color:#9a8f78;letter-spacing:2px;…}` avec `INK_OUTLINE` (contour d'encre d'UN pixel, `hud-dom.ts:80`), contre `INK_OUTLINE_STRONG` pour `.hc-day` (`:365`). C'est le liseré d'encre qui sauve la ligne, pas sa couleur : le rapport glyphe/monde varie du simple au double selon l'heure et le terrain.

**Ce que le joueur vit** — La confirmation de sauvegarde — le seul retour que le jeu donne sur « ton monde est à l'abri » — est presque invisible en plein jour sur de l'herbe claire, et lisible la nuit. Ce n'est pas discret par intention, c'est aléatoire selon le sol.

**Direction de correction** — Soit passer `.hc-save` en `INK_OUTLINE_STRONG` comme sa ligne sœur, soit lui donner un fond de bandeau (le même scrim que le reste du bloc de date) pour que son contraste ne dépende plus du terrain. Ne pas confondre avec la mesure AA des jetons de palette : ici le contour porte la lisibilité, et le chiffre à tenir est le rapport glyphe/MONDE, pas glyphe/jeton.

*`ux/feeling/feeling-brume-0800.png` · `ux/reveil/reveil-cran-3.png`*

---

## Écartés — 22 constats

*Ce qui n'a pas survécu, et pourquoi. Un audit qui cache ses échecs oblige le suivant à les refaire.*

- **D1-9 · Un commentaire promet qu'un clic ramasse une pile au sol — fusionné dans D4-7** — `DOUBLON_INTERNE` : Fusionné dans **D4-7**, qui survit : il porte le balayage (0 `pick_up` sur 225 792 lignes), la péremption de `gate1-finition.md:105`, et la correction du réfuteur (un seul des deux commentaires ment).
- **R-M2 · La ligne « une arme en main » du menu pause est fausse pour un arc — fusionné dans D3-R3** — `DOUBLON_INTERNE` : Fusionné dans **D3-R3**, qui survit : il cite la raison d'être du fichier (`pause-menu.ts:1-12`) et le contraste avec la table des touches, dérivée elle.
- **D2-8 · « Rien ne montre qu'un PNJ saigne » est FAUX depuis le chantier du sang — reste que panser un tiers ne rend aucun retour de geste** — `DÉJÀ_CORRIGÉ` : Le corpus ne le porte pas ; c'est un COMMENTAIRE DU CODE qui a été pris pour un fait — `packages/client/src/audio/inventaire.ts:225-228` « RESTE OUVERT : l'affordance à l'écran (rien ne montre encore qu'un PNJ saigne) ». — Le code d'aujourd'hui contredit ce commentaire : `packages/client/src/scenes/world/snapshot-view.ts:1147-1152` — « LA PLAIE GOUTTE… `if (monster ? saigneBete(monster, this.tick) : entity.wounds.bleeding === true) { this.goutteDe(entity.id, …) }` » — dans `syncEntities`, donc pour TOUTE entité, livré par le commit f4e0e81. Le commentaire d'`inventaire.ts` est périmé et doit être barré.
- **D2-15 · L'inventaire du son annonce 66 faits — fusionné dans R2-M2** — `DOUBLON_INTERNE` : Fusionné dans **R2-M2**, qui survit : son verdict de réfutation est plein (celui de D2-15 est « NON VÉRIFIÉ ») et il porte le comptage programmatique.
- **D3-5 · Arc en main, le clic gauche ne fait rien et le conseil enseigne ce geste — fusionné dans D1-4** — `DOUBLON_INTERNE` : Fusionné dans **D1-4**, qui survit : mêmes citations (`aim.ts:518`, `onboarding.ts:58`, `WorldScene.ts:2235`), plus le balayage de la copie.
- **D3-10 · Le clic gauche sur un buisson est totalement muet — silence ACTÉ, et la mitigation promise a bien été livrée** — `DÉJÀ_CORRIGÉ` : docs/decisions.md:512 (2026-07-24) : le silence du clic est acté (« elle laisse le CLIC strictement inchangé : une arme frappe toujours, un clic de panique ne part jamais cueillir »), et la découvrabilité y est déclarée TRAITÉE (« E est au menu pause […] et dans l'onboarding »). — La mitigation existe et est JUSTE aujourd'hui, à une surface près : le menu pause dérive la bonne touche (`pause-menu.ts:31-36` × `keymap-perso.ts:37` « Cueillir, interagir » → F) et l'onboarding dit F (`onboarding.ts:46`). Ce qui a dérivé depuis, c'est la lettre de la décision (E) et une TROISIÈME surface créée après elle, `skill-guide.ts:149`, qui dit encore E — c'est D1-3, et c'est là qu'est le défaut vivant.
- **D3-R4 · Le conseil qui enseigne la cueillette code sa touche en dur — fusionné dans D1-6** — `DOUBLON_INTERNE` : Fusionné dans **D1-6**, qui survit : il couvre les DEUX chaînes en dur (`onboarding.ts:46` et `:58`) et prouve que le rebinding est effectif en jeu.
- **D4-6 · La table CLICKS n'enseigne que six gestes — fusionné dans D1-5** — `DOUBLON_INTERNE` : Fusionné dans **D1-5**, qui survit avec le meilleur titre (il porte AUSSI le libellé périmé « se panser »). Ce que D4-6 apporte et qui est reversé dans D1-5 : deux des trois choses que son joueur cherche sont déjà répondues sur le même écran — la table LES TOUCHES donne « Cueillir, interagir — F » (`pause-menu.ts:139-140` × `keymap-perso.ts:37`), et TAB ouvre le cadavre le plus proche (`input-bindings.ts:307-313`, `nearestContainer` `:109-130`).
- **D5-R2 · Le canal d'apprentissage a TROIS producteurs — couper le son ou se réveiller au Feu efface la leçon en cours** — `DOUBLON_INTERNE` : FUSIONNÉ DANS D5-1 — le `correctif` du constat le dit lui-même (« Même correctif que D5-1 »). Apport propre conservé : l'énumération des deux autres producteurs (`WorldScene.ts:701`, `:2555`), à verser dans la preuve de D5-1.
- **R6-B · TAB pendant qu'on tape au chat ouvre l'écran personnage — la garde de saisie existe et les touches de sortie s'en dispensent** — `DOUBLON_INTERNE` : FUSIONNÉ DANS D6-5 (même cause racine : les deux touches de sortie hors garde de saisie, même correctif d'une ligne). Apport propre conservé et versé dans D6-5 : le volet TAB et le précédent `forage` (`:670-671`).
- **D7-4 · « L'échelle est COURTE : quatre tailles » — la garde est verte, les écrans DOM en emploient vingt** — `DOUBLON_INTERNE` : D7-4 + D8-10 → survivant D8-10
- **D7-14 · Le vert des médaillons est devenu une encre de texte pour « c'est bon » — mais le catalogue dit la même chose en ambre** — `DOUBLON_INTERNE` : D7-14 + D8-6 → survivant D8-6
- **REF-2 · Deux des trois états du Feu s'écrivent sous le seuil AA — dont ÉTEINT, sur le fond réel de la carte** — `DOUBLON_INTERNE` : REF-2 + D7-10 → survivant D7-10
- **D10-18 · Un seul bus audio : on ne peut pas baisser l'ambiance sans baisser les alertes** — `DOUBLON_INTERNE` : DOUBLON de D11-11 (« Un seul robinet pour tout »), qui garde le titre et la meilleure preuve : les gains mesurés (clapotis ≤ 0,0168 crête, pépiement 0,028, hurlement 0,09) et l'atténuation par distance déjà faite dans l'appelant (`eau-audio.ts:60,64`). Ids à fusionner : D10-18 + D11-11.
- **L3-09 · Le retour de récompense vit à 645-670 px du joueur, en glyphes de 6,7 à 10 px** — `RÉFUTÉ` : LA PREUVE PORTANTE EST UN ARTEFACT D'INSTRUMENT, ET LE PLACEMENT EST UNE DÉCISION ÉCRITE. ① La phrase qui fait tout tenir — « dans cette frame, RIEN n'a changé au centre » — décrit le harnais, pas le jeu. Le scénario `juice` (tools/smoke.mjs:5427-5454) N'A JOUÉ AUCUN GESTE : il SÈME les files à la main, `r.set('pickups'…)`, `r.set('crafts', [{item:'axe'}])`, `r.set('levelUps', [{skill:'woodcutting', level:3}])`, puis `game.loop.sleep()` dès deux bandeaux présents. Aucune hache n'a été fabriquée, aucun arbre abattu, aucun `item_crafted` sim n'a été émis. Rien ne POUVAIT changer au centre. ② Et dans le vrai jeu, quelque chose y change : WorldScene.ts:2330-2336, sur `item_crafted` de MOI, `publishCraft(…)` PUIS `this.attackFx.spark(this.playerSprite.x, this.playerSprite.y − 6, 0, false, this.time.now)` — une étincelle SUR LE CORPS, au centre exact que le constat déclare vide. ③ Le coin haut-droite n'est pas un défaut à faire trancher, c'est une décision prise et motivée : docs/decisions.md:487 (2026-07-23, « Audit UI/UX P0 ») — « Étincelle-monde sur le corps au craft = extra assumé (souvent le sac masque le monde ; le bandeau, lui, se voit toujours) » ; le bandeau NIVEAU y est designé exprès comme « le plus rare, le plus gros […] un bandeau doré à deux lignes […] avec une lueur qui s'éteint ». La même entrée qualifie d'avance la capture : « FIGE la boucle Phaser […] artefact du headless, pas du jeu ». Silence décidé, pas couture. ④ Un canal entier est ignoré : les deux événements ont leur son dédié — sound.ts:265-266 `item_crafted` et 273-274 `skill_level_up` (triangle 440→659 Hz, 0,42 s, gain 0,08, le plus long et le plus fort de la famille progression). Une récompense « en glyphes de 6,7 px » qui sonne pendant une demi-seconde n'est pas la même chose. ⑤ CE QUE JE NE RÉFUTE PAS, pour que rien ne disparaisse : la géométrie est arithmétiquement juste (j'ai re-mesuré le bandeau dans juice-toasts.png : x≈1194..1253, y≈60..85, centre (1223,72) → 670 px du centre canvas, et j'ai vérifié que l'avatar EST bien centré — le rectangle beige à (641,373) est le sprite joueur, identifié par recoupement avec combat-hache.png où il tient la hache : le piège du lerp caméra ne s'applique pas ici) ; les citations CSS (hud-core.ts:386-393) et le commentaire l.215 sont exacts. Mais les « 6,7 px » sont une propriété de la FENÊTRE du banc, pas du jeu : hud-dom.ts:44 `k = Math.min(innerWidth/1920, innerHeight/1080)` → à 1280×800, k=0,667 ; à la résolution de la planche (1920×1080) k=1 et `.hc-craft-tag` rend à 10 px. Le constat lui-même renvoie ce point à L3-01. Il ne reste donc rien qui soit propre à C08.
- **L2-02 · Le conseil qui ouvre la partie est « cueillir des baies », pas « il vous faut un feu avant la nuit »** — `RÉFUTÉ` : La prémisse est contredite par le fichier même que le constat cite. Il lit l'ordre de `nextOnboardingHint` comme une chronologie : c'est un départage de SIMULTANÉITÉ. La chronologie, ce sont les deux délais, et leurs commentaires tranchent la question posée à Alexis. onboarding.ts:40 « Le conseil de base attend un souffle (le temps de voir le monde) » ; :42 « Le rappel du feu ne presse qu'après un moment sans en avoir fait — PAS DÈS LE SPAWN » ; :82 (règle 4) « RAPPEL du feu — seulement si l'on n'en a toujours pas, après un délai » ; :83-84 (règle 5) « LES BASES — LE TOUT PREMIER CONSEIL, après un souffle ». Ce que la capture montre (basics ouvre la partie) est donc exactement l'intention écrite, pas une couture. Le constat demande un arbitrage sur une décision déjà prise et documentée dans le code. Deux citations dérivent au passage : renderHint est à UIScene.ts:695 (686 = `this.fatal.show`), le retour anticipé `if (!this.revealed)` à :699 (pas 697) — l'observation, elle, est juste : renderHint tourne avant la garde. Ce qui reste de vrai dans la preuve — les deux seuils échus dans la même frame, make-fire publié puis écrasé — est C09 ; et la question (b) « annuler plutôt que brûler » est le correctif de C09. Rien ne subsiste en propre. Enfin la conséquence annoncée (« la seule contrainte mortelle a été dépensée ») est partiellement couverte ailleurs : WorldScene.ts:2255 crie « VOUS GELEZ. Trouvez un feu. » et :2256 « Le froid vous prend. »
- **L2-05 · Les 13 crans de la barre ne mesurent pas le même travail, et la passe en cours n'est jamais nommée** — `RÉFUTÉ` : ① L'INSTRUMENT NE PEUT PAS MESURER CE QU'IL AFFIRME. La sonde est une boucle `page.evaluate` toutes les 100 ms (tools/smoke.mjs:3988-4005) — or `page.evaluate` ne s'exécute PAS pendant que le thread principal génère. Les échantillons ne sont pris qu'aux instants où le thread est LIBRE : 5 états sur 13 attrapés, 6/13 sauté (batch.log:7-12). La répartition des 15,8 s entre les crans n'a été chronométrée par rien. L'étiquette MESURÉ est fausse sur le seul chiffre qui porte le constat. ② LA MAGNITUDE EST 20× FAUSSE. « 54 % de la barre s'expédie en ~7 frames » est contredit par le code lui-même : loading.ts:78-79 « Une étape de montage peut bloquer le thread une demi-seconde », et WorldScene.ts:1978 « ~3 s mesurées » pour le montage des couches. Les 7 étapes montent PoiLayer, BorneLayer, CombeMist, MorningMist, MistBanks, ClutterLayer, NightVeil, DynamicLighting, SoleilLayer, MeteoLayer, GelLayer… ce ne sont pas des frames vides. ③ L'ÉCART EST CONNU ET DÉJÀ PAYÉ : loading.ts:71-79 (`EASE_MS = 140`) lisse l'anneau sur le TEMPS et non sur les frames, « précisément parce que les dernières étapes consomment une frame chacune ». Le défaut décrit est la raison d'être de la constante. ④ `phase` MORT N'EST PAS UN OUBLI, c'est écrit deux lignes au-dessus de la ligne citée : hud-state.ts:103-105 « `phase`, elle, ne s'affiche jamais — l'écran raconte autre chose » ; loading.ts:12-15 tranche contre « le rapport d'ingénieur déguisé en poème ». Le constat a cité :106 et sauté le commentaire. ⑤ « Seize secondes, sans repère » est doublement un artefact : run `--dev` (Vite non bundlé) sous SwiftShader, et la capture chargement.png — prise au premier sondage où frac ≥ 0,4 — montre 92 % avec un anneau lisse : elle démontre le biais d'échantillonnage, pas une jauge bloquée.
- **L1-03 · L'anneau et le titre — le point fixe de l'interface — sautent de 100 px entre les écrans** — `RÉFUTÉ` : Chiffres tous retrouvés au pixel (anneau x=192 : 202/191/124/102 ; bande #e8763a 314-352, 303-341, 236-274, 214-252), frames comparables (vallees=semer=124, options=capture=options-fin=102). Mais le défaut n'existe pas. docs/decisions.md:605, 2026-07-28, DEMANDE D'ALEXIS : « le corps est ancré AU PIED et le chapeau prend tout le reste et se centre dedans », « il remonte au lieu de se comprimer, et c'est la seule chose qui le déplace », et surtout « Le fichier le disait ne bouge JAMAIS : corrigé, la promesse tenue est qu'il SURVIT au changement d'écran, pas qu'il est immobile ». Le constat cite la phrase corrigée comme une promesse trahie, alors que le même commentaire dit deux lignes plus bas que l'anneau « flotte au milieu de ce qui est libre, quel que soit l'écran » — et que peindre() n'écrit que corpsEl.innerHTML (l.129-130) : « ne bouge pas » est une affirmation de PERSISTANCE DOM. Le journal chiffre même la dérive attendue (halo 18 %, anneau à 15 % vs 29 % de la hauteur ≈ 151 px de planche ; j'ai mesuré 100 px écran à k=0,667 = 150 px de planche). Enfin le parcours du récit n'existe pas : options se rejoint depuis l'accueil, pas depuis vallées (menu-dom.ts:388, 409-410).
- **L1-09 · Rien sur l'écran d'accueil ne dit ce qu'est ASHES — et la vraie première fois n'est sur aucune capture** — `RÉFUTÉ` : Les faits de code tiennent (ecranAccueil bien l.402, tuiles l.441/446 citées mot pour mot, aucune phrase sur l'accueil — je l'ai vu sur accueil-principal.png). Mais docs/decisions.md:605 ① tranche la question posée, à la même date et sur le même écran : « DEUX MENTIONS RETIRÉES : la baseline (Survie · une vallée de 60 jours · l'alignement émerge)… La première expliquait le jeu à quelqu'un qui l'a déjà lancé. » C'est exactement le texte de genre que le constat réclame, supprimé exprès. Un silence décidé n'est pas une couture. Deux autres appuis : decisions.md:603 dit « Vérifié au navigateur sur les six états (accueil avec et sans REPRENDRE…) », ce qui contredit « le seul écran que personne n'a regardé » ; et vitrine.ts documente la vitrine comme LE canal qui dit ce qu'est le jeu (« l'accueil ne peut pas promettre un jeu qui n'existe pas »), sa première vue étant « un hameau de bois endormi autour de son feu, sa palissade close, avant le jour » — un signal de survie, pas un lieu muet. Enfin l'étiquette MESURÉ est indue : le cœur du constat porte sur un écran non photographié et sur ce qu'un inconnu comprendrait — inférence, pas mesure. Résidu utile, mais c'est une lacune d'INSTRUMENT et non un défaut du jeu : le banc devrait produire une frame « installation neuve ».
- **L1-13 · « LES TOUCHES » ne parle jamais de la souris, qui porte pourtant tous les verbes du jeu** — `RÉFUTÉ` : « Le seul endroit du premier contact censé enseigner les commandes » est faux, et la preuve est à trois fichiers de là. `pause-menu.ts` (ESC, câblé en UIScene.ts:257) ouvre sur la section « LE CLIC GAUCHE — L'OBJET EN MAIN DÉCIDE » (pause-menu.ts:137), AVANT « LES TOUCHES » : six lignes en dur (pause-menu.ts:41-48) qui disent frapper (« maintenu : coup lourd »), se panser, manger, DONNER, nourrir le Feu, réparer. Son en-tête documente exactement le manque que le constat croit trouver : « la règle centrale — l'OBJET EN MAIN décide du clic — est puissante mais invisible […] Ce menu la garde à portée d'ESC » (pause-menu.ts:1-12). Troisième canal, en contexte : onboarding.ts:58 « MAINTENEZ le clic : un coup lourd s'arme. » Et l'absence de la souris dans OPTIONS n'est pas une omission mais une frontière de contrat : le passage cité (keymap.ts:111-129) dit que le clic a été SORTI de `KEYMAP` le 2026-07-12 sur décision utilisateur ; une table de REBINDING n'a pas de ligne pour ce qui ne se rebinde pas — c'est le même raisonnement que keymap-perso.ts:46-57, qui a refusé une ligne « qui ne peut RIEN faire ». Reste un résidu vrai et étroit, que je clos ici plutôt que de le laisser ouvert : le joueur qui ouvre OPTIONS depuis l'accueil, avant d'avoir lancé une partie, est la seule fenêtre que le menu pause ne couvre pas. Mais la prémisse qui portait le « majeur » — « il ouvre OPTIONS pour apprendre à jouer, c'est le réflexe de tout le monde » — n'est mesurée nulle part, et sous la règle du lot elle ne peut porter aucune gravité.
- **L4-12 · Rien, nulle part, n'enseigne le clic sur un nœud — le verbe qui donne le bois et la pierre n'est jamais nommé** — `RÉFUTÉ` : Le verbe est nommé, mot pour mot, dans un écran que le lot de captures a lui-même photographié. packages/client/src/scenes/ui/pause-menu.ts:41-48 porte la table CLICKS, rendue sous le titre « LE CLIC GAUCHE — L'OBJET EN MAIN DÉCIDE » (pause-menu.ts:137-138), et sa PREMIÈRE ligne est : ['un arbre, un rocher', 'abattre, miner (maintenu)']. Je l'ai lue à l'écran dans ux/pause/pause-menu.png, la capture du même batch (recadrage x300-1000, y100-700) : « un arbre, un rocher → abattre, miner (maintenu) », suivie de la table des touches. L'écran s'ouvre à ESC et fige le monde le temps qu'on le lise. Mieux : l'en-tête du module (pause-menu.ts:1-9) documente ce menu comme la RÉPONSE DÉLIBÉRÉE à exactement ce manque — « la règle centrale, l'OBJET EN MAIN décide du clic, est puissante mais invisible : rien à l'écran ne rappelle que du bois sur le Feu le NOURRIT [...] Ce menu la garde à portée d'ESC ». Le reste du constat est exact : HINT_TEXT est bien à onboarding.ts:44-60, les six textes sont cités au caractère près, aucun ne nomme le clic sur un nœud, et aim.ts:617-618 réserve bien l'interaction F à la cueillette. Mais le titre et la gravité ne tiennent qu'à « rien, nulle part » et « jamais nommé » — deux absolus démentis par la pièce. Un silence de l'onboarding qui est un choix écrit (« trois, pas trente », onboarding.ts:9-11) et compensé par un écran dédié n'est pas une couture. Ce qui resterait — la découvrabilité de ce menu — est une autre affirmation, non mesurée, que le constat n'a pas faite.
- **L5-05 · village-exterieur.png rate son sujet : la bâtisse est plaquée contre le bord haut et son toit est coupé** — `RÉFUTÉ` : Deux erreurs de fait, chacune suffisante. (1) « un seul pan de 43×43 est à l'écran — le second est hors cadre » est faux, et le constat porte en lui le chiffre qui le tue : il écrit « 14 tuiles → 302 px », soit 21,57 px/tuile. C'est exact — `TILE_PX = 16` (framing.ts:17) et le scénario pose `cameras.main.setZoom(1.35)` juste avant la prise. La bande de 43 px de chaume, c'est donc LES DEUX pans côte à côte (2 × 21,6), pas un seul de 43×43. Et ils ne pourraient de toute façon pas être l'un hors cadre : le scénario les pose sur la MÊME rangée (`for (let x = 1; x <= 2; x++) build roof at (ox+x, oy+1)`), donc côte à côte en x, à 86 px du bord gauche du bâti — largement dans l'image. (2) La bbox y[40..82] est fabriquée : balayage ligne à ligne de la paille, elle court de y40 à y61 et s'arrête là (43 large × 22 haut = 2×1 tuiles) ; y62..126 est du mur brun. Et par dérivation, un toit se dessine exactement MUR_HT au-dessus de sa tuile (`bati-art.ts:135-138`, MUR_HT = 32 px monde = 43,2 px à ce zoom) : la rangée toitée occupant y83..105, le toit tombe à y≈39,6..61 — il TOUCHE la première ligne du canvas, il en manque au plus un pixel ou deux, rien qui change ce que l'image montre. J'ai recadré et agrandi ×4 la zone : les quatre murs, l'échancrure de porte (x635..644), le chaume entier et le Feu qui brille dedans se lisent sans effort. « On ne peut RIEN conclure » est donc faux. Ce qui reste est réel mais cosmétique : le sujet est collé en haut, avec ~630 px d'herbe vide dessous.
