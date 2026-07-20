# Axes d'amélioration — Phase 2 : backlog de profondeur de gameplay

> **Nature du document.** Backlog de référence de BRAISES, dérivé de l'audit `docs/audit-gameplay-phase1.md` (à lire d'abord). Objectif : transformer les constats de Phase 1 en axes qui ajoutent de la **profondeur** — pas de la complexité gratuite. Chaque axe répond à un problème réel identifié, ou exploite un potentiel inexploité d'une mécanique déjà en place, et **priorise les dilemmes de décision** (compromis, ressource limitée à arbitrer, risque/récompense) sur l'empilement de features.
>
> **Comment lire ce document.** Il est pensé pour être repris n'importe quand sur plusieurs mois. §1 pose le principe directeur ; §2 le **graphe des dépendances** (rien en aval ne mord tant que sa racine n'a pas atterri) ; §3 les **4 vagues séquencées** — le backlog proprement dit, chaque item avec sa catégorie, sa complexité, son dilemme, son articulation et son risque ; §4 ce qu'on a **coupé/rogné** et pourquoi ; §5 les corrections factuelles à propager ; §6 les **décisions de design** groupées, à trancher par Alexis une question à la fois.
>
> **Méthode.** 9 chantiers développés puis stress-testés par un critique adversarial (« vrai dilemme ou feature empilée ? scope creep ? rupture d'équilibre ? »), puis priorisés transversalement. Le code fait foi : toute affirmation est ancrée `fichier:ligne`.
>
> **Catégories.** **[AJ]** ajustement d'équilibrage rapide · **[REF]** refonte d'un système existant · **[NEW]** nouvelle mécanique. **Complexité** S/M/L/XL (ordre de grandeur, pas un chiffrage).

---

## 1. Principe directeur

L'audit tranche le sens du travail : **brancher / peupler / rendre mortel ce qui existe, avant d'ajouter.** BRAISES a un moteur d'exception dont une grande partie ne touche pas le joueur ; le plus fort ratio valeur/effort est donc dans le *raccordement*, pas dans le code neuf.

Ce backlog applique ce principe mécaniquement : **les déblocages de câblage et les ajustements de nombres passent avant les refontes, qui passent avant les mécaniques neuves.** Seule exception : quand une mécanique plus lourde est le *prérequis* de plusieurs autres (l'upkeep du Feu, le peuplement de la Veillée), elle remonte dans les vagues malgré son coût.

Trois fusions actées d'emblée (confirmées par les critiques) :
- **Upkeep du Feu ≡ combustible du Feu** — un seul scalaire `village.fuel`, une seule livraison (les chantiers C3 et C5 convergeaient dessus).
- **Méga-horde = siège ≡ Feu tuable appliqué à la fin** — pas un axe autonome, la face « climax » du Feu mortel.
- **Recalibrage du saignement ⊂ bandage rejouable** — une sous-tâche de calibrage, pas une proposition.

---

## 2. Le graphe des dépendances — sept nœuds racines

Rien en aval ne mord tant que sa racine n'a pas atterri. **Financer ces racines est la vraie priorité stratégique.**

| Racine | Ce que c'est | Débloque |
|---|---|---|
| **R-A · Peupler la Veillée** de villages voisins (`foundNpcVillage` dans `veillee.ts`) | Sans un second village, `isOutsider()` renvoie toujours `false` (`alignment.ts:27-33`) et tout le moteur d'alignement tourne à vide. | Verbes chauds, Marché franc, non-létal, enseignement, érosion des maîtrises, réfugiés, moral gaté collectivement. |
| **R-B · Combustible / upkeep du Feu** (champ `village.fuel`) | Le scalaire qui transforme le Feu en organe à métabolisme : le **seul évier permanent possible**. | Toute l'économie de flux, coût de mort communautaire, décay du Feu à sec, dégradation des structures. |
| **R-C · Feu tuable** (`999999` → PV finis par palier) | Le flow-field vise déjà le Feu, il bloque déjà, `applyStructureDamage` gère déjà destruction+spill : seul le `999999` verrouille l'endgame. | Ruine pillable, siège terminal/méga-horde, mordant du gradient de danger et du moral. |
| **R-D · Chaîne du cuir** (peau → cuir+sel → tenue) | Maillon par maillon. | Couture / tenue d'hiver → la branche température (`INSULATION_BODY` stub), la besace de portage. Pont explicite **cuir → couture → température**. |
| **R-E · Cadence sur le calendrier** (`C8-P1`) | Vérifié au tick : la méga-horde ne tire **jamais** en Veillée jouée (1ᵉʳ crépuscule-cycle d'acte III à ~126 min, saison finie à ~120 min). | L'**observabilité** des raids PNJ, de la courbe 4/8/12, du climax, de la fenêtre d'évacuation. |
| **R-F · Station = fonction reconnue** (`C6-P1`) | Reclé le craft sur `FunctionId+tier` au lieu du `StructureType` brut. | Lecture des bonus forge/atelier, sens du gate `unlockTier`, déblocage-recette « Le fer / L'acier ». |
| **R-G · Le Gisement honnête** (`placeZoneNodes` honore `nodeKind`) | Sur la carte jouée, un POI « Gisement » ne pose que de la roche. | Le gradient de danger (il n'a rien à garder sans minerai réellement posé). |

**Dépendances secondaires notables :** câbler `upgrade_fire` (C6-P3) lève le gate `unlockTier` → sans lui, tout le ladder T2/T3 reste hors d'atteinte (trio C6 indissociable) · le bandage rejouable est prérequis de « bras → travail » (sans cure, un malus permanent recrée la condamnation) · le retrait de la régén passive est conditionné à un **comportement de soin PNJ** (sinon les PNJ spiralent à mort et cassent R-A) · le dilemme du sel n'a de sens que tannage + salaison couplés sur un sel plafonné (livrer en un bundle).

---

## 3. Les vagues séquencées — le backlog

### VAGUE 0 — Déblocages à fort levier, faible coût (câblage + nombres)

*Le cœur de la thèse de l'audit. Presque tout est du recâblage client ou de l'ajustement de constantes ; peu de décisions bloquantes. À sortir en premier, en parallèle.*

**[V0-1] Rebrancher la parade** — `[REF, S]` · gardé (joyau)
- **Problème** (audit §4.1) : `WorldScene.ts:788 const block = false` verrouille toute la moitié défensive du combat de coût — pourtant complète et testée (arc 120°, −70 %, coût d'endurance, ralenti 0,3).
- **Dilemme** : fort, déjà simulé (gérer sa jauge en défense vs frapper). **Articulation** : recâblage pur d'un système `/sim` existant. **Risque** : nul, systémique.
- **Décision Alexis** : l'input (reco : clic droit maintenu) + un retour visuel/sonore **obligatoire** de garde (sinon le joueur ne sait pas qu'il pare).

**[V0-2] Rebrancher le bandage** — `[REF, S]` · gardé
- **Problème** (audit §4.1) : `combat.ts:230` complet, jamais émis par le client → un saignement de combat est une **condamnation à mort déterministe**.
- **Dilemme** : lève la condamnation (retraite pour se soigner). **Articulation** : une case « pansement » dans la ceinture + clic (la grammaire `keymap.ts:48` la prévoit déjà). **Risque** : bas. Le bandage reste **hors budget de maîtrise** (GDD).
- **Correctif technique** (le recalibrage du saignement, `BLEED_HP_PER_S`, ne vient qu'**après** que le bandage soit jouable).

**[V0-3] Câbler `upgrade_fire`** — `[REF→AJ, S]` · gardé
- **Problème** (audit §4.3) : `upgrade_fire` complet en sim (`village.ts:725`), aucun bouton client → palier figé à 1, tout le contenu T2/T3 injouable.
- **Dilemme** : lève le gate `unlockTier` et pose un vrai sink de matériaux (T3 = cut_stone 30 + iron 8). **Articulation** : prérequis dur du trio C6. **Risque** : bas. Ne **pas** resserrer le rayon du carré dans la foulée.

**[V0-4] La peau brute** — `[NEW, S]` · gardé (meilleur ROI du projet)
- **Problème** (audit §4.3) : la faune ne produit que `raw_meat` ; l'ancre `slainClean` (`combat.ts:642`) est morte.
- **Dilemme** : greffe un coût d'opportunité (coup **propre** → peau de qualité, lent et risqué, vs viande sûre) sur une mécanique déjà en place. **Articulation** : un `ItemId` + ~15 lignes dans la table de loot ; l'ancre `slainClean` est déjà lisible dans `die()`. Aucun spawn → **pas de fragilité RNG**. **Risque** : bas.

**[V0-5] Retendre le portage / faire peser le gros gibier** — `[AJ, S/M]` · gardé (meilleur ratio dilemme/coût)
- **Problème** (audit §7.4) : un cerf entier = 5 de charge = *léger* ; la chasse annule le portage.
- **Dilemme** : un `ItemId` « quartier » lourd (~4-5) sur le **gros gibier seul** crée le vrai dilemme de retour (poids + péremption). **Articulation** : ne rouvre **pas** `CARRY=60` ni ne re-décale toute la table `ITEM_WEIGHT`. **Risque** : bas.
- **Décision Alexis** : le barème de poids par bête.

**[V0-6] Le Gisement honnête + migrer le banc** — `[REF, S]` · gardé (R-G)
- **Problème** (audit §8-P3-16) : `placeZoneNodes` ignore le `nodeKind` → un « Gisement » ne pose que de la roche ; le banc de calibrage tourne sur une **autre** carte.
- **Correctif technique** : honorer le `nodeKind` dans `placeZoneNodes` et poser le fer là. Socle de V2-19 (gradient de danger). Le serveur utilise déjà `placeZoneNodes` ; seul le banc sim (`pnpm scenario`) reste à migrer (budgéter la recalibration).

**[V0-7] Raboter l'érosion d'usure** — `[AJ, S]` · gardé
- **Problème** (critique §10) : le niveau de crafting réduit l'usure d'outil (`SKILL_WEAR_REDUCTION`) → la spécialisation **érode** l'un des deux seuls éviers.
- **Correctif** : relever `TOOL_WEAR_MIN` / baisser `SKILL_WEAR_REDUCTION`. **Décision Alexis** : le chiffre. Met à jour `economy.test.ts`.

**[V0-8] Arbitrer les jauges de survie** — `[AJ, coût nul]` · gardé
- **Décisions de NON-build** qui clarifient le périmètre (audit §10) : **rejet de la soif** (absente du GDD, pure microgestion punitive que le GDD refuse) ; **sommeil-joueur = contributeur de moral**, pas un drain létal ; **santé localisée réduite au bras** (tête/torse/vêtements différés). À entériner maintenant.

**[V0-9] Verrouiller la cadence sur le calendrier + fix `cycleOffset`** — `[REF, M]` · gardé (enabler critique, R-E)
- **Problème** (audit §7.2) : découplage cycle/calendrier → une saison Veillée dure ~2-3 nuits réelles ; toute la pression nocturne par acte est inobservable en solo, et la méga-horde ne tire jamais.
- **Articulation** : sans lui, **rien** de l'endgame ni des raids n'est observable en solo. **Risque** : **déterminisme-critique** — le reflow RNG casse `replay.test` ; isoler sur chemin neuf, re-baseliner sim/replay/events. Retirer du menu l'option « cycle mural accéléré + sommeil » (chantier séparé).
- **Décision Alexis** : le modèle de cadence (voir §6, load-bearing).

---

### VAGUE 1 — Les refontes structurantes qui allument les piliers

*Les nœuds racines. Coût M-L mais dépendance maximale : tout le reste s'y adosse.*

**[V1-10] Peupler la Veillée + brancher les verbes chauds** — `[REF, M]` · gardés, **fusionnés** (R-A)
- **Problème** (audit §4.2, §7.3) : le pilier n°1 ne se déclenche jamais en solo (`veillee.ts` ne fonde aucun voisin) ; et même peuplée, la Veillée ne laisse le joueur que **descendre** sa chaleur (attaquer) — les verbes chauds (`give`, dépôt-étranger, soin d'un `isOutsider`) existent en `/sim` mais ne sont jamais émis.
- **Dilemme** : c'est **le** dilemme fondateur, réglé par un curseur — la **distance** des voisins. Une Meute proche pille ton grenier de nuit → tu arbitres récolter / fortifier / frapper le premier (premier sang −20) ; un Foyer proche → tu commerces pour engranger de la chaleur ou l'égorges comme proie facile. Sans les verbes chauds, ce dilemme n'a qu'un bouton (piller).
- **Articulation** : appeler `foundNpcVillage` (`worldgen.ts:18`, ensemence déjà warmth ±60) sur 2 sites de `emplacementsDeVillage` (la carte **réellement jouée**). **⚠ Ne pas recycler les `VEILLEE_SITES` du banc** (`scenario.ts:38-40`, posés sur l'ancienne carte). Une fois posés, tout s'allume sans code neuf. Câbler côté client `{type:'give'...}`, le dépôt-étranger (`creditForeignDeposit` se déclenche seul), le soin d'allié.
- **Risque** : **RNG fragile** (spawn d'entités → décale le flux seedé, casse des tests sim/replay sans rapport) → isoler sur chemin neuf, régénérer les fixtures à part. Scope creep vers escortes/patrouilles/panique : s'en tenir au peuplement nu. Équilibre : une Meute trop proche transforme la Veillée en tower-defense (le solo joue mécaniquement un Ermitage, GDD §4).
- **Décision Alexis** (load-bearing, voir §6-Groupe 1) : combien de voisins, à quelle distance, le joueur est-il cible dès le spawn.

**[V1-11] L'upkeep du Feu (combustible)** — `[NEW, L]` · gardé (R-B, seul dilemme fort de son chantier)
- **Problème** (audit §5, §6) : économie de stock sans évier permanent ; R16 écrite mais différée (`balance.ts:515`).
- **Dilemme** : chaque bûche jetée au Feu est une bûche non investie ailleurs ; à sec, les murs se dégradent puis le village tombe. Le dilemme s'aiguise au Grand Froid (conso ×, alors que la Cendre brûle le bois autour) → « rester et alimenter vs migrer ». Version PNJ : « nourrir le Feu » = tâche village-board prioritaire → une garnison qui alimente ne récolte/défend pas.
- **Articulation** : un champ `fuel: number` sur `Village` (JSON-sérialisable), décrément par tick modulé par la température ambiante. Livrer **d'abord** la conséquence-à-sec = **murs qui se dégradent seuls** (via `applyStructureDamage`, déjà là), **sans** couper la bulle de chaleur (double-peine à calibrer plus tard). Jamais d'extinction sèche : état « braises » dormant. Réhabilite `peat`/`ash` comme combustibles denses (orphelins §8-14).
- **Risque** : un taux trop mordant = corvée anti-fun en solo (calibrer pour qu'un joueur seul tienne, ~3-4 j spec A7) ; régression de tests température.
- **Décision Alexis** (load-bearing, §6-Groupe 3) : taux, combustibles, conséquence à sec (murs seuls vs aussi la chaleur), multiplicateur Grand Froid.
- **Correction à porter** : gater `fireBubble` **ne** rend **pas** le froid létal sur la plaine (elle floore à 20 = seuil) — c'est un ajustement séparé (`+1 ACT_COLD`), pas une conséquence de l'upkeep.

**[V1-12] Le Feu tuable** — `[REF→AJ, M]` · gardé (R-C, enabler quasi-gratuit)
- **Problème** (audit §5) : `STRUCTURE_HP.fire = 999999` + indémolissable = le contresens le plus grave (« tool cupboard » increvable).
- **Dilemme** (mince en propre, mais habilitant) : monter le palier du Feu en fait une cible plus précieuse → investir dans le palier (offense éco.) vs les murs (défense). Couplé à R-B, tranchant : un Feu à sec ne se défend plus **et** peut être abattu (le cupboard Rust à la lettre).
- **Articulation** : reclasser en **ajustement** — `999999` → PV finis indexés sur le palier (comme `WALL_TIERS`). La plomberie existe (`applyStructureDamage` gère destruction+spill ; le Feu a un hitbox depuis `f2fbd15`, donc `structureBlocks` renvoie déjà `true`). Le maillon manquant : faire du Feu un **but** de flow-field pour la méga-horde d'acte III. **Commentaire `balance.ts:1994` « non-bloquant donc jamais ciblé » = périmé.** Garder le garde-fou `demolish` (un Chef ne s'auto-éteint pas) ; c'est la destruction **par dégâts** qui s'ouvre.
- **Risque** : un Feu trop fragile rend la Veillée solo instantanément perdable (un joueur ne défend pas un siège seul de nuit — PV à caler pour l'absence de garnison humaine). Point de vigilance : quand le Feu tombe, `fireTx/fireTy` pointe une tuile vide → le respawn et le flow-field visent le néant (à résoudre avec V2-20).
- **Décision Alexis** (§6-Groupe 3) : tuable en permanence ou seulement à sec (reco : **à sec**, converge tout le chantier) ; PV par palier ; qui peut l'abattre.

**[V1-13] La construction qui paie** — `[REF, M]` · gardés, liés (R-F)
- **Problème** (audit §4.3) : moteur d'émergence sans transmission — une seule fonction sur 4 paie, le craft se déclenche sur le `StructureType` brut, pas sur `FunctionId+tier`.
- **Dilemme** : conditionner à `enclosed` (clore/ouvrir = un vrai sink de murs+toit) ; approfondir (upgrade in-place) vs étendre (nouvelle fonction) sous contrainte de place dans le carré.
- **Articulation** : reclé le craft sur `FunctionId+tier`, **mais** coupler à un payoff acier **minimal** (1-2 recettes T3 réelles) sinon ce n'est qu'un nerf furtif. Pour les bonus : garder atelier-vitesse + toit-chaleur (déjà lu par `temperature.ts:70`) ; **remplacer forge-durabilité** (qui aggrave l'érosion de l'évier, V0-7) par un **gate d'accès aux recettes acier**. Inclut V0-3 (`upgrade_fire` déjà câblé).
- **Risque** : nerf furtif si aucun payoff acier livré ; casser les tests de placement en resserrant le rayon (ne pas le faire).
- **Décision Alexis** (§6-Groupe 5) : mapping du ladder de recettes ; bonus forge = durabilité (érode !) vs gate acier (reco) ; ferme voie A vs B (voir V3-29).

**[V1-14] Décision régén passive de PV** — `[REF, M, conditionnée]` · rogné, séparé du bandage
- **Problème** (audit §7.2) : `HP_REGEN_PER_MIN = 2` (`combat.ts:733`) trivialise d'avance le métier de médecin, ce que le GDD interdit explicitement.
- **Articulation** : c'est **ce retrait**, pas le bandage, qui fait naître le médecin. À ne livrer qu'avec un **comportement de soin PNJ** (auto-bandage/repos), sinon garder une régén **résiduelle** — sans quoi les PNJ spiralent à mort après le moindre combat et cassent R-A. Calibrer conjointement froid/faim.
- **Décision Alexis** (load-bearing, §6-Groupe 4) : 0 strict (le médecin naît) vs valeur résiduelle.

---

### VAGUE 2 — Les nouvelles mécaniques moyennes qui approfondissent

*Adossées aux racines de la Vague 1. Chacune porte un vrai dilemme une fois son prérequis en place.*

**[V2-15] Le sel, le tannage et la salaison** — `[NEW, L + AJ]` · rognés, **bundle obligatoire** (R-D suite)
- **Dilemme** : le sel — ressource localisée unique (GDD) — s'arbitre entre **tannage** (cuir) et **salaison** (conserves d'hiver), sur un stock plafonné. N'existe que couplé.
- **Articulation** : **pas de station tannerie neuve** (réutiliser le feu) ; réutiliser l'analogue `source_chaude` pour le `nodeKind` du sel, isolé sur chemin neuf ; `viande_salee` avec `SPOIL_CYCLES` élevé mais **non infini** (sinon annule l'évier péremption).
- **Prérequis dur** : trancher la **létalité du froid** avant (sinon on bâtit du worldgen pour un cuir qui ne protège de rien).
- **Décision Alexis** (load-bearing, §6-Groupe 2) : rareté du sel ; peau binaire vs graduée (reco : gradué) ; dépeçage auto (reco) vs verbe.

**[V2-16] La tenue d'hiver** — `[REF, L]` · rogné (dilemme faible : c'est le payoff de la chaîne)
- **Articulation** : une seule « tenue » (pas de slots torse/jambes/tête) ; faire lire à `advanceTemperature` l'isolation de l'entité (le hook `insulation` de `driftStep` existe déjà). **Usure obligatoire** dès la tranche minimale (c'est là qu'est le seul vrai dilemme et le premier évier de vêtement).
- **Risque** : `driftStep` divise la dérive par l'insulation = levier de **vitesse**, pas de plancher → sans décision de calibrage, la tenue est cosmétique sur plaine (lié à la décision froid).

**[V2-17] Déblocage-recette « Le fer / L'acier »** — `[REF, M]` · rogné au seul déblocage crafting
- **Problème** (audit §8-P2-11) : la progression n'a **aucun** déblocage nommé (le modèle que le GDD interdit).
- **Articulation** : hard-gate sur le tier de four ; branche directement le ladder T2/T3 de V1-13. **Abandonner la piste hardwood** (fausse : `old_tree` produit déjà du hardwood ; le problème est la **consommation**, `terroir` mort). Mining/foraging = soft-paliers cosmétiques différés.

**[V2-18] Le plafond de budget de spécialisation** — `[NEW, M]` · rogné (plafond maintenant, érosion différée)
- **Dilemme** : poser le **plafond** (≈2 branches P4 + 2-3 P2) crée un vrai *build* même en solo, sans rien punir. **Différer l'érosion** jusqu'au peuplement PNJ (sinon corvée d'auto-suffisance solo).
- **Articulation** : décroissance strictement **arithmétique** keyée sur `state.tick`, **zéro tirage PRNG**. Pas d'écran de gestion.
- **Décision Alexis** (§6-Groupe 5) : forme du budget ; taux/plancher de l'érosion.

**[V2-19] Le gradient de danger** — `[REF, M]` · gardé (seul dilemme fort de C9, porte « plus riche, plus risqué »)
- **Problème** (audit §7.3, §8-P3-17) : la rareté est zonale mais **aucun gradient de danger** n'est corrélé à la richesse.
- **Articulation** : choisir **un** mécanisme (reco : `dens` ancrées aux amas structurants + « parfum de richesse » calqué sur le sang), pas les quatre. **Escalade douce par actes** (sinon soft-lock : si l'unique source de fer devient trop dangereuse tôt → jamais de T2 → mort). Isoler le spawn sur chemin neuf. Ne mord vraiment qu'avec R-C (mortalité).
- **Décision Alexis** (§6-Groupe 7).

**[V2-20] Le village PEUT tomber → ruine pillable** — `[NEW, L→M]` · rogné au strict « coquille »
- **Dilemme** : le charognard (piller une ruine loin, en zone appauvrie, sans bulle de chaleur — le voyage en vaut-il le froid ?) et le revers du défenseur (négliger l'upkeep livre tout le stock accumulé).
- **Articulation** : en aval de V1-12 — quand `applyStructureDamage` détruit le Feu, transition « ruine » : `chiefId=0`, accès `public` sur les structures survivantes (`set_access` existe), retrait de l'agrégation d'alignement, event `village_fell` que la chronique consomme. **Refondation-sur-ruine et mémoire de carte DÉFÉRÉES en Vallée** (`construction.md:171`).
- **Risque** : c'est LA proposition où tenir la borne. Trou dur : le **respawn du joueur dont le Feu tombe** (`combat.ts:671` cherche le village par `memberIds` ; fallback `homeX/homeY` à vérifier).
- **Décision Alexis** (§6-Groupe 3) : seuil de bascule ; pillable instantané vs gelé ; que devient le joueur.

**[V2-21] Le coût de mort croissant** — `[REF, S puis M]` · rogné
- **Problème** (audit §5, §9) : respawn infini gratuit ; `EXHAUSTION_TICKS` est un placeholder auto-avoué (5 min, GDD vise ~30).
- **Articulation** : cœur S = `deathCount` + `exhaustedUntil` croissant avec **plafond ET reset** (sinon spirale de mort). Remplace le placeholder. La ponction de `village.fuel` (dilemme communautaire : ta mort affaiblit le foyer commun) = itération 2 gatée sur R-B.
- **Décision Alexis** (§6-Groupe 3) : la monnaie (épuisement vs fuel commun — reco : communautaire, sert le pilier village-personnage) ; plafond/reset.

**[V2-22] Le moral** — `[NEW, M]` · rogné + dé-priorisé
- **Problème** (audit §7.3) : le moyeu prospérité→perf est absent ; c'est *le* pont manquant de l'interdépendance forcée. **Mais** tel que le GDD le décrit (per-entity, bonus-only), il n'ajoute aucune tension et ne punit pas le loup solitaire.
- **Articulation** : **gater collectivement** la prospérité haute (N habitants actifs, plusieurs maisons habitées, Feu palier >1) et séquencer **après** l'arrivée d'une vraie rareté (R-B) — sinon l'arbitrage confort-vs-défense n'existe pas. Jamais mortel (bonus-only), horizontal (jamais un dieu).
- **Décision Alexis** (§6-Groupe 7) : signaux de prospérité, magnitude, gate collectif.

**[V2-23] Le Marché franc** — `[NEW, M]` · rogné (Racket coupé)
- **Problème** (audit §7.3) : l'archétype ne débloque que des multiplicateurs ; le GDD veut des **capacités**.
- **Articulation** : garder le **Marché franc** (une zone de trêve où le premier sang est impossible) — un `StructureType` + un test dans `recordHostility`/`isThreatTo`, rayon **petit** et nombre **limité** (sinon annule le premier sang map-wide). **Couper le Racket** (présuppose une extraction de tribut inexistante : le raid *smashe* le chest, ne loote qu'un cadavre). Séquencer après validation de la boucle chaude (V1-10).
- **Décision Alexis** (§6-Groupe 1) : retire-t-on les multiplicateurs d'archétype (le GDD penche pour) ?

**[V2-24] L'arche à embarquer** — `[NEW, L→M]` · rogné à la v1 squelette
- **Problème** (audit §5, §7.2) : l'évacuation est un rond jaune passif ; les victoires ne vérifient jamais le départ.
- **Articulation** : tick de départ dur + `computeVerdicts` ne compte **que** l'embarqué au départ (tue le bug « part sans partir »). Pose le dilemme cargo-vs-temps. **Interdire tout véhicule pilotable** (un point fixe qui part). L'axe passagers dépend de V2-25.
- **Décision Alexis** (§6-Groupe 6) : slots passagers vs cargo ; longueur de la fenêtre ; manquer l'arche = mort vs zéro bonus.

**[V2-25] Les réfugiés d'acte III** — `[NEW, L→XL]` · rogné à une vague scriptée
- **Problème** : le verdict Foyer « sauve des vies » n'a personne à sauver (pas de réfugiés).
- **Articulation** : une vague **scriptée** du sud (pas de village-overrun, qui empilerait peuplement + retrait de village + reflow RNG). Fournit le référent moral du Foyer et les passagers de l'arche à moindre risque. Le couplage Cendre→village voisin submergé = stretch goal.

*(Différée conditionnellement — n'ouvrir que si le playtest le réclame :)*
**[V2-26] Dégradation douce des structures** — `[REF, M]` · différé
- N'ouvrir que si l'upkeep du Feu (R-B) seul ne donne pas assez de raison de récolter. **Ne pas livrer deux timers « doux » simultanés** (le GDD interdit les quotas quotidiens). Murs/toits uniquement, **jamais** les composants (renverserait R17). Recalibrer `REPAIR` au passage (aujourd'hui réparer coûte 2× bâtir neuf, audit §9).

---

### VAGUE 3 — Grosses mécaniques lourdes / différées (dont LAN)

*Coût XL, ou dilemme qui ne s'allume qu'en multi, ou dépendances multiples non atterries.*

**[V3-27] Le non-létal** — `[NEW, L→XL]` · sorti de C1/C4, chantier propre
- Couper captif/rançon/entretien (dépendent d'une milice de garde cassée et d'un évier de nourriture inexistant). Garder au mieux le **non-létal minimal** : mode assommant → achever (acte froid + **Cicatrice**, à créer) ou épargner (acte chaud). Gaté sur R-A (sans extérieurs à capturer, débranché à la naissance).
- **Décision Alexis** (§6-Groupe 4) : mode toujours dispo vs déblocage de maîtrise ; Cicatrices à effet mécanique ou informatives (le GDD dit **informatives**).

**[V3-28] Progression de capacité / besace** — `[NEW, M]` · coupé de C5
- Bloqué sur R-D (cuir) **et** contradictoire avec V0-5 (rend de la capacité pendant qu'on la fait peser). Ne rouvrir qu'après R-D et calibrage de V0-5, gaté **strictement** derrière le cuir disputé (pas de palier bois+fibre qui redonne de la capacité gratuite).

**[V3-29] L'agriculture (ferme voie A)** — `[NEW, L]` · différé
- La **voie B** (retrait de `parcelle/serre/terroir` + redirection du `hardwood`) se fait dans V1-13 comme nettoyage `[AJ, S]`. La **voie A** (graine→pousse→récolte) sort en chantier flux dédié, gaté **derrière la mortalité** (R-C) : la ferme n'a de dilemme (produire vs conserver) que quand l'ancrage au village coûte vraiment.

**[V3-30] La charrette** — `[NEW, L→XL]` · différé au jalon LAN
- La proposition la plus additive ; son dilemme (vol, embuscade, escorte) ne s'allume qu'en **multi** ; la « notion de route » est un gouffre. Rien à coder en Veillée.

**[V3-31] L'enseignement** — `[NEW, M]` · coupé, rattaché à R-A
- Sans spécialiste PNJ autour, ne fait littéralement rien en solo. N'en garder qu'une **graine gratuite** : enseigner un `isOutsider` = acte chaud (réutilise `recordAct`).

**[V3-32] Maîtrises de combat** — `[NEW]` · scindé
- La partie « Garde gatée » = décision de design mineure dans le budget de maîtrise (déblocage de **capacité** pur, jamais de +% dégâts — le 2v1 doit faire peur au vétéran). La capture/non-létal rejoint V3-27.
- **Correction** : la « riposte » du GDD n'a **aucun hook** existant (`combat.ts:552` est une remise d'alignement, pas le contre-après-blocage).

---

## 4. Propositions coupées ou rognées — motifs

**Coupées** (sorties de leur chantier ou différées LAN) : **Racket** (présuppose une extraction de tribut ; l'éco est de stock) · **non-létal captif/rançon** (XL, contredit « ne pas ajouter », empile peuplement + milice cassée + évier captif inexistant) · **besace/progression de portage** (bloquée sur le cuir, sape V0-5) · **charrette** (dilemme multi-only, système de route entier) · **enseignement** (inerte en solo) · **agriculture voie A** (système L neuf hors périmètre, gaté derrière la mortalité).

**Rognées** (cœur conservé, extensions différées) : **bandage + retrait régén** (scindé : bandage tout de suite, retrait conditionné à un soin PNJ) · **tenue d'hiver** (unique + usure, pas de slots) · **déblocage nommé** (réduit au fer/acier ; piste hardwood abandonnée) · **budget de maîtrise** (plafond maintenant, érosion différée) · **moral** (gate collectif obligatoire, dé-priorisé) · **ruine** (coquille pillable seule) · **coût de mort** (épuisement d'abord, ponction fuel en it. 2) · **arche/réfugiés** (squelette + vague scriptée) · **dégradation des structures** (différée pour ne pas doubler la corvée) · **Feu tuable + méga-horde siège** (reclassés en ajustement + fusionnés).

---

## 5. Corrections factuelles à propager (relevées par les critiques)

Ces points corrigent ou précisent l'audit Phase 1 et **doivent être répercutés en Phase 3** (synchro doc) :

- Le froid n'est jamais létal sur plaine à cause d'un **calibrage** (`ACT_COLD[2]=40` = seuil), **pas** à cause de l'upkeep/de la bulle de chaleur — deux chantiers distincts.
- Le flow-field des hordes **vise déjà le Feu** et le monstre **frappe déjà** la structure bloquante : le Feu tuable est un **chiffre**, pas une refonte d'IA de siège. Le commentaire `balance.ts:1994` est périmé.
- Le **charbon n'est PAS orphelin** (consommé par `iron_ingot`) ; seule la **tourbe** l'est. *(À corriger vs l'audit §8-14 qui listait `ash`/`peat`/`components`.)*
- Le **hardwood est produit** par `old_tree` ; son orphelinat est côté **consommation** (`terroir` mort), pas production.
- La « **riposte** » du GDD n'a **aucun hook** existant dans le code.

---

## 6. Décisions de design pour Alexis (groupées)

À trancher **une question à la fois** (préférence projet), reco en premier, impact concret. Les décisions **[LOAD-BEARING]** gatent plusieurs chantiers en amont de tout code.

**Groupe 1 — Peuplement & alignement** *(gate la Vague 1)*
- Combien de voisins (2 Foyer+Meute vs +1 neutre) et à quelle **distance** (la portée d'une phase de nuit est le curseur réel du dilemme).
- Le joueur est-il cible de raid dès le spawn (via un stash raidable) ou seulement après avoir fondé un village + chest `access:'village'` ? (sinon spectateur du Foyer-vs-Meute PNJ).
- Le geste d'input du don (reco : clic mains vides / item non-arme sur un PNJ).
- Marché franc : **retire-t-on les multiplicateurs d'archétype** (le GDD penche pour) ou les garde-t-on ? Rayon et nombre (petits).

**Groupe 2 — Chaîne cuir & froid** *(gate la Vague 2 cuir)*
- **[LOAD-BEARING] La létalité du froid** : rendre la plaine létale en acte III (+ qq points `ACT_COLD`) OU assumer la tenue comme outil d'expédition en altitude ? Et : l'insulation **plafonne**-t-elle l'exposition (vraie protection) ou seulement la ralentit-elle (modèle actuel) ? *À trancher AVANT d'investir dans le sel/tannage.*
- **[LOAD-BEARING] La rareté du sel** : le calibrage qui décide si le dilemme tannage-vs-salaison a des dents.
- Peau : binaire vs graduée à 2 crans (reco : gradué) ; dépeçage auto (reco) vs verbe ; barème par bête.
- Salaison : `SPOIL_CYCLES` élevé mais non-infini, au prix d'un sel rare (préserver l'évier péremption).
- Modèle de tenue : unique (reco) vs slots ; usure obligatoire (reco).

**Groupe 3 — Enjeu terminal** *(gate la Vague 1-2 mortalité)*
- Upkeep : taux de combustion + facteur Grand Froid ; combustibles (bois seul d'abord vs tourbe/charbon) ; conséquence à sec = murs seuls (reco) vs aussi la bulle de chaleur ; braises dormantes (reco) vs extinction sèche ; imposé au solo ou pensé multi ?
- Feu tuable : abattable en permanence vs seulement à sec (reco : **à sec**, converge tout le chantier) ; PV par palier ; qui peut l'abattre.
- Ruine : seuil de bascule (Feu 0 PV vs aussi « plus aucun membre ») ; pillable instantané vs gelé ; **que devient le joueur dont le Feu tombe** ; confirmer refondation-sur-ruine différée Vallée.
- Coût de mort : monnaie (épuisement croissant simple vs ponction du fuel commun) ; plafond + règle de reset ; individuel vs communautaire (reco : **communautaire**).

**Groupe 4 — Combat** *(gate la Vague 0-1)*
- Input de la parade (reco : clic droit maintenu) ; ajouter la Riposte maintenant ou la réserver à Progression ?
- **[LOAD-BEARING] Régén passive de PV** : 0 strict (le médecin naît) vs valeur résiduelle ? Conditionnée à un comportement de soin PNJ.
- Gradient de soin : jusqu'où (bandage / attelle / repos) sans déborder tout l'arbre Médecine.
- Recalibrage du saignement (après bandage jouable seulement).
- Non-létal (Vague 3) : mode toujours dispo vs déblocage de maîtrise ; Cicatrices à effet mécanique ou informatives (le GDD dit informatives).

**Groupe 5 — Construction & maîtrises** *(gate la Vague 1-2)*
- Mapping du ladder de recettes + au moins 1-2 recettes acier **réelles** (sinon V1-13 = nerf furtif).
- **Bonus forge** : durabilité (érode l'évier !) vs gate d'accès aux recettes acier (reco) ; conditionné à `enclosed` (reco) vs au tier seul.
- Resserrer `FIRE_RADIUS_BY_TIER` pour rendre la place mordante, ou non (reco : **non**, casse les tests de placement pour un gain incertain).
- Ferme : voie B retrait (reco, dans V1-13) vs voie A agriculture (chantier flux différé) ; redirection du hardwood.
- Déblocage soft-gate (confort cumulé) vs hard-gate (crée l'ordre) par branche (reco : hard là où un consommateur existe — crafting fer/acier).
- Budget de spé : forme (≈2 P4 + 2-3 P2) ; érosion (taux, plancher P1-à-vie ?, solo maintenant ou différée — reco : différée).
- Garde : gatée derrière Mêlée P1 vs universelle ? (jamais de +% dégâts).

**Groupe 6 — Endgame & temporel** *(gate la Vague 0-2)*
- **[LOAD-BEARING] Modèle de cadence** : verrouiller N nuits d'assaut par acte sur le calendrier (reco) — combien de nuits pour que la montée 4/8/12 se **sente** en 2 h ? Méga-horde persistante vs vagues montantes.
- Arche : slots passagers vs cargo (fongibles ?) ; longueur de la fenêtre ; manquer l'arche = mort (Cendre submerge) vs zéro bonus ; PNJ s'embarquent seuls vs escorte ; point fixe vs multiples.
- Réfugiés : source scriptée v1 (reco) vs village-overrun ; un réfugié « sauvé » compte-t-il s'il survit ou seulement s'il embarque ?

**Groupe 7 — Jauges & géographie** *(gate la Vague 0-2)*
- Moral : quels signaux composent la prospérité + poids ; magnitude (horizontale, jamais un dieu) ; **gate collectif obligatoire** ; plancher neutre (bonus-only, jamais mortel).
- Danger : mécanisme de corrélation (reco : `dens` ancrées + parfum de richesse) ; escalade par acte (accès précoce clément).
- Filon minier : s'épuise-et-rouvre-ailleurs (frontière mouvante, anti-stock — reco) vs robinet en place ?
- Jauges (entérinées en V0-8) : rejet de la soif ; sommeil-joueur = moral, pas drain ; santé localisée = bras→travail seul, livré **uniquement** avec le bandage jouable.

---

## 7. Note de séquençage finale

**Les trois décisions load-bearing à trancher en tout premier**, parce qu'elles conditionnent des chantiers entiers avant tout code :
1. **Le modèle de cadence** (V0-9) — débloque l'observabilité de tout l'endgame et des raids.
2. **La létalité du froid** (Groupe 2) — décide si la chaîne cuir a une raison d'être avant qu'on n'investisse dans le sel.
3. **Le retrait de la régén passive** (Groupe 4) — décide si le métier de médecin existe.

**Les deux nœuds racines à financer en priorité absolue** restent le **peuplement de la Veillée** (R-A, allume le pilier n°1 pour quelques lignes) et l'**upkeep du Feu** (R-B, seul évier permanent possible) — l'audit les nomme comme le plus fort ratio valeur/effort du projet.

**Le fil rouge à ne jamais lâcher :** chaque axe doit poser un **dilemme** (ressource limitée à arbitrer, risque/récompense). Un axe qui n'en crée pas est suspect — soit il se rattache à un autre qui en porte un, soit il attend son prérequis, soit on le coupe. On ne « complète » pas BRAISES en ajoutant des systèmes ; on l'allume en branchant, peuplant et rendant mortel ce qui existe déjà — et en s'assurant que chaque branchement rende une décision *intéressante*.

---

*Fin de la Phase 2. La Phase 3 (`docs/direction-design.md`) synthétise la direction de design qui émerge de ce backlog + du code, et synchronise la documentation `.md` du projet en conséquence.*
