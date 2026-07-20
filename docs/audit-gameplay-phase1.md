# Audit gameplay — Phase 1 : revue de l'existant

> **Nature du document.** Revue de game design externe et tranchée de BRAISES, produite le 2026-07-19 à partir du **code source** (la source de vérité ; le GDD et les specs sont confrontés au code, jamais l'inverse). Objectif : cartographier les mécaniques réelles, juger leur cohérence entre elles, pointer les trous, et prendre position sur ce qui tient et ce qui ne tient pas. Ce fichier est autosuffisant : tout ce qu'il affirme est lisible ici, avec les références `fichier:ligne` pour vérifier.
>
> **Méthode.** 14 passes de cartographie (une par système) sur `packages/sim` + `packages/client` + `packages/server`, puis analyse croisée des interactions, détection des ressources orphelines et des trous, scan des constantes d'équilibrage, et une passe critique de complétude. ~95 % de l'effort porte sur `/sim` (la logique de jeu).
>
> **Caveat capital, à garder en tête pour tout le document.** Tous les verdicts « fonctionnel / partiel / stub » sont des jugements d'**analyse statique** : « le chemin de code existe et les tests passent », **pas** « ça se joue et c'est fun ». Aucun constat ici ne repose sur une session réellement jouée ou un smoke-test observé. La qualité de *feel* (lisibilité des télégraphes, feedback d'impact, fluidité) n'est donc **pas** évaluée — c'est une limite assumée de cette revue, et le premier chantier de vérification à mener (cf. §9).

---

## 1. Résumé exécutif

BRAISES a un **moteur de simulation remarquable** — déterministe au bit près, testé comme un moteur d'échecs, et plusieurs de ses systèmes (la faune, le cœur du combat de mêlée, le geste de récolte, le moteur de construction émergente, la marée de Cendre, le moteur d'alignement, l'IA villageoise) sont, **en isolation**, du travail de première main. Techniquement, ce projet est en avance sur sa réputation de « phase Veillée ».

Et pourtant, **le jeu réellement jouable est bien plus mince que la somme de ses systèmes.** Un motif revient sur presque chaque mécanique auditée : la logique vit dans `/sim`, verte dans les tests, mais **le dernier maillon vers la partie jouée manque**. Trois causes, qui structurent tout ce rapport :

1. **Le moteur sans transmission (§4).** Des pans entiers sont codés et testés mais jamais atteints par une main de joueur : la **parade** est câblée à `false` en dur, le **bandage** n'est jamais émis par le client, la **montée de palier du Feu** n'a aucun bouton, le **bannissement** non plus, et — le plus grave — **l'alignement, pilier n°1 annoncé, ne se déclenche jamais en solo** parce que la Veillée ne fonde aucun village voisin.

2. **Pas d'enjeu terminal (§5).** Le Feu est à `999999` PV et indémolissable, aucun village n'est jamais retiré de l'état, le joueur respawn à l'infini, et l'**upkeep n'existe pas**. Résultat : à l'échelle de la saison, **le jeu ne peut être ni perdu ni gagné**. Pour un jeu dont le pitch est « une vallée de 60 jours qu'on perd », l'acte de la perdre n'est pas implémenté.

3. **Une économie de stock déguisée en flux (§6).** Sans upkeep ni combustible ni dégradation, tout ce qui n'est pas nourriture ou outil est un stock permanent : on bâtit une fois, on plafonne, on devient autosuffisant — exactement ce que le GDD §8 déclare mortel.

**Le verdict d'une phrase :** le socle technique est solide et parfois brillant, mais la **boucle cœur réellement jouée en Veillée** se réduit aujourd'hui à *récolter → crafter → bâtir (décor) → chasser de la viande → manger → tenir le froid près d'un feu* — une boucle honnête mais courte, très loin du pitch, dont on ne peut pas encore dire si elle est amusante 45 minutes, encore moins « 5 sessions d'affilée » (le seul critère de sortie posé, GATE 1). **La priorité n°1 n'est pas d'ajouter des systèmes : c'est de brancher ceux qui existent déjà.**

---

## 2. Vue d'ensemble : statut des systèmes

La colonne clé est **« Atteint le joueur ? »** : c'est l'écart entre ce qui est codé et ce qui se joue réellement en Veillée solo (le seul mode livré).

| Système | Cœur `/sim` | Atteint le joueur (Veillée) ? | En une ligne |
|---|---|---|---|
| **Faune & chasse** | ✅ Solide (chef-d'œuvre) | ✅ Oui | Le meilleur système du jeu — méfiance à 3 canaux, hardes, sang, coins fixes — mais **îlot** : ne produit que de la viande, zéro cuir. |
| **Combat — cœur mêlée** | ✅ Solide | ⚠️ À moitié | Endurance-reine, télégraphes, charge qui change de forme : excellent. Mais **parade et bandage injouables**, non-létal et raid absents. |
| **Récolte — le geste** | ✅ Solide | ✅ Oui | 3 verbes réels (abattage/minage/cueillette), gate doux de maîtrise : un bijou. Mais l'économie-monde autour est à moitié bâtie. |
| **Noyau / déterminisme** | ✅ Solide (le meilleur code) | ✅ Oui | Sim pure, rejouable, testée. Mais **persistance Veillée non câblée** → GATE 1 bloqué. |
| **Temps / saison / Cendre** | ✅ Solide | ✅ Oui (partiel) | Squelette temporel + marée de Cendre excellents. Mais le **climax de fin (méga-horde, évac) est un trompe-l'œil**. |
| **Construction émergente** | 🟡 Moteur solide, transmission absente | ⚠️ Tier 1 seulement | Amas → fonction → palier : beau moteur. Mais palier du Feu sans bouton, forge/atelier/ferme sans effet : **décor**. |
| **PNJ / IA villageoise** | 🟡 Moteur solide | ✅ Oui (online) | Village 100 % PNJ qui tient 10 jours headless. Mais **pas de défense offline, pas d'escorte, pas de patrouille/panique**. |
| **Inventaire / portage** | 🟡 Cœur solide | ✅ Oui | Sac Rust, 4 paliers de charge, sprint refusé : propre. Mais « le transport = la moitié du jeu » **non tenu**, et `CAPACITY` doublé a désamorcé sa tension. |
| **Alignement (pilier n°1)** | ✅ Moteur complet et testé | ❌ **Débranché** | Le paradoxe du projet : le mieux codé ET le moins joué. **En solo, il ne se déclenche jamais** (aucun village voisin). |
| **Progression / Maîtrises** | 🟡 Petit système cohérent | ✅ Oui | 4 métiers de récolte ≠ les 15 branches du GDD ; **des multiplicateurs, pas les déblocages** que le GDD exige. |
| **Monde / lieux** | 🟡 Substrat solide | ✅ Oui (partiel) | Économie **géographique** (bonne idée), découverte de POI câblée. Mais carte quasi fixe, banc de calibrage sur une **autre** carte, minerai des POI mort. |
| **Victoire / défaite / tension** | ❌ Plomberie sans enjeu | ⚠️ Cosmétique | La tension existe **au tick** (faim/froid tuent) mais **pas à la partie** : pas de défaite ni de victoire ressenties. Pas de `tension.ts`. |
| **Serveur / multi (LAN)** | 🟡 Substantiellement codé | ⏸️ Non éprouvé | Colyseus, tick-driver, replay-log présents et compilent — mais **jamais validés bout-en-bout** (3 clients + monde peuplé). |
| **Survie — jauges** | 🟡 Socle partiel | ✅ Oui | Faim/froid/endurance/charge/blessures conséquents. Mais **moral, sommeil joueur, santé par localisation, vêtements = absents**. |

**Lecture :** aucune colonne « Atteint le joueur » n'est un « non » technique sur le cœur — sauf l'alignement, qui est un « non » d'un seul appel manquant. Le reste des ⚠️ sont des maillons finaux non branchés. **C'est une bonne nouvelle : la dette est en grande partie du câblage, pas de la conception.**

---

## 3. Le cœur solide : ce qui, aujourd'hui, tient vraiment

Avant les problèmes, il faut nommer ce qui est bon, parce que c'est sur ça qu'on construit.

- **La faune (`faune.ts`, 2607 lignes, 123 tests).** Un vrai système d'approche émergent : une jauge de méfiance continue qui *poursuit* un stimulus (montée en s², décrue lente — c'est ce différentiel qui fabrique le stop-and-go, `faune.ts:512`), trois canaux de perception dont on garde le max (vue directionnelle, ouïe omnidirectionnelle, odorat qui descend le vent, `faune.ts:441-460`), le portage qui interdit le silence, le sang au sol qui trace la bête et appelle les prédateurs, les hardes en boids avec sentinelle dérivée et scission à la fuite, le sanglier à 4 verbes, le loup à encerclement/alpha/hurlement. C'est le seul système qui atteint la promesse « tutorial de combat permanent » du GDD §7. **On n'y touche pas — il est fini.**

- **Le cœur du combat de mêlée (`combat.ts`).** Un seul pipeline pour joueurs/PNJ/bêtes/Cendreux (« personne ne triche »). L'endurance gate tout (`combat.ts:315`), les télégraphes portent leur vraie zone dans le snapshot, la charge change de *forme* selon l'arme (la lance rue et traverse, la hache tourbillonne à 360°), deux récupérations distinctes punissent le raté et non l'engagement. La mort est chère et bien faite (loot case-par-case, respawn au Feu). C'est du niveau Rust/PZ comme visé.

- **Le geste de récolte (`economy.ts`).** Trois verbes réellement distincts, tous jugés dans la sim et rejouables : jauge charge-relâche à l'abattage (le « vert » s'élargit avec la maîtrise), lecture de flanc au minage, perception du bon coin en cueillette. Le **gate doux** est une vraie trouvaille : un outil trop bon rend comme ton palier maîtrisé, jamais *rien* — la compétence a du poids sans jamais bloquer l'accès (`economy.ts:283-299`).

- **Le noyau déterministe (`sim.ts`, `rng.ts`, `replay.ts`).** Une seule simulation, PRNG dans l'état, aucune fonction Math approximée sur les chemins critiques, ordre du `step()` réfléchi. Rejouable au bit près, testé à 3 avatars. C'est le meilleur travail du projet.

- **La marée de Cendre (`cendre.ts`).** Une menace géographique dérivée du **seul tick**, zéro octet dans le `SimState`, calibrée par carte pour brûler 60 % de la zone racine : « la difficulté monte » devient « le sol brûle derrière toi » (`cendre.ts:166-249`). Élégant et à dents.

- **L'IA villageoise (`npc.ts`).** Deux étages (besoins puis tableau), zéro GOAP, une obsession du livelock avec une garde documentée sur chaque handler (« la faim ne tue pas, le figeage si »). Un village 100 % PNJ tient 10 jours headless au bit près.

Ces six-là sont la fondation. **Le problème n'est presque jamais leur qualité interne — c'est leur raccordement au reste et au joueur.**

---

## 4. Motif structurel n°1 — le moteur sans transmission

C'est **le** constat central de cette revue, et il touche presque tous les systèmes. Des fonctionnalités entièrement codées et vertes dans les tests ne sont **jamais atteintes par le joueur**, pour l'une de trois raisons : le client ne les câble pas, le monde ne les instancie pas, ou aucun consommateur ne les lit.

### 4.1 Fonctionnalités codées mais débranchées côté client

| Fonctionnalité | État sim | Ce qui manque | Référence |
|---|---|---|---|
| **Parade / blocage directionnel** | Complet, testé (arc frontal, −70 %, coût d'endurance) | `WorldScene.ts` force `const block = false` en dur | `WorldScene.ts:788` ; sim `combat.ts:449-455` |
| **Bandage / soin** | Action complète (3 fibres, stoppe le saignement, soigne un allié) | Jamais construite dans le client (grep : uniquement en test) | `combat.ts:230` ; aucun `{type:'bandage'}` client |
| **Montée de palier du Feu** | `upgrade_fire` complet (le carré grandit, débloque T2/T3) | Aucun appel client → palier **figé à 1**, tout le contenu T2/T3 injouable | `village.ts:725` ; grep client = 0 |
| **Bannissement (gouvernance)** | Verbe `banish` testé | Aucun input client | `village.ts:164` ; grep client = 0 |

**Conséquence brutale la plus grave : le bandage.** Le saignement de combat (`BLEED_HP_PER_S = 1.5`, `combat.ts:719-724`) n'a **aucun arrêt naturel** pour un avatar (contrairement au gibier qui a `bleedUntil`), et les plaies ne guérissent jamais seules. Comme le bandage est injouable, **un joueur qui reçoit « saignement » est condamné à mort**, sans comprendre pourquoi — la seule « cure » est de mourir (le respawn remet `wounds = {}`). Toute la boucle *blessure → retraite → médecin* du GDD §7 se retourne en « PV secs + condamnation déterministe ». Des pans entiers de `balance.ts` (`BLOCK_*`, `BANDAGE_*`) sont ainsi purement décoratifs.

### 4.2 Le monde qui n'instancie pas — l'alignement débrayé

**Le paradoxe le plus frappant du projet.** L'alignement — pilier n°1 du GDD, « la morale est une mécanique » — est le système **le mieux codé** (moteur complet, deux axes nourris par de vrais actes, premier sang, agrégation plafonnée, inertie, effets câblés, raids/dons PNJ, teinte du Feu, chronique — tests A1-A8 verts) **et le moins joué**.

Cause chirurgicale : `veillee.ts` (le worker solo) ne fonde **aucun village PNJ** — le seul `foundNpcVillage` hors tests est dans le banc headless `scenario.ts`. Or tout le déclenchement passe par `isOutsider()` (`alignment.ts:27-33`), qui exige une cible d'un **autre** village. En Veillée il n'existe qu'un village (celui du joueur) : `warmth`/`engagement` ne bougent **jamais**, le Feu reste blanc, aucun archétype n'est atteint, aucun raid ni don ne vise jamais le joueur.

> Réf : `veillee.ts:82-96` (aucun `foundNpcVillage`) vs `scenario.ts:38-40` (banc) ; verrou `alignment.ts:27-33`.

Le correctif est **trivial et à très fort levier** : appeler `foundNpcVillage` sur 2-3 emplacements dans `veillee.ts` branche instantanément *toute* la mécanique dans la boucle jouée. Mais c'est une **décision de design** (combien de voisins, quel caractère, à quelle distance) — donc à trancher par Alexis, pas un correctif purement technique.

### 4.3 Le consommateur manquant — la construction émergente et le cuir

- **Construction (`construction.ts`).** Le moteur d'émergence est beau — les amas de composants font émerger forge/atelier/grenier/ferme, palier = richesse de l'amas, tout est dérivé pur dans le snapshot. Mais **une seule fonction sur quatre paie** : le Grenier (ralentit la pourriture, `economy.ts:769`). Forge (durabilité) et Atelier (vitesse) déclarent un `enclosureBonus` que **personne ne lit** (`balance.ts:600-608`) ; la Ferme n'a même pas de boucle agricole. Pire, **le craft ne passe pas par les fonctions** : il se déclenche sur la présence brute d'un `StructureType` (`workshop`/`furnace`) à portée, jamais sur le `FunctionId+tier` reconnu (`Recipe.station` ne connaît que `fire|workshop|furnace|null`, `balance.ts:829`). Construire une « forge d'acier » reconnue **ne forge rien**. La grammaire d'émergence est une décoration posée sur une logique de proximité-de-type.

- **Le cuir.** La plus belle chasse du genre survival ne débouche que sur `raw_meat` : **aucun item cuir/peau n'existe**, aucune action de dépeçage, le champ `clean` (mise à mort propre) est « un point d'ancrage » suspendu dans le vide (`combat.ts:642`). Toute la chaîne promise (dépeçage → tannage → Couture → tenues d'hiver) n'a pas de matière. **C'est le meilleur retour sur investissement du projet** : un item, une recette de tannage, une ligne dans deux tables de loot — et d'un coup la faune irrigue l'économie, la couture et la température d'hiver.

---

## 5. Motif structurel n°2 — pas d'enjeu terminal

Le jeu a une **fin** (jour 61, `season_ended`), il n'a pas d'**enjeu de fin**. Raison unique et structurelle : **rien ne meurt de façon terminale.**

- **Le Feu est increvable.** `STRUCTURE_HP.fire = 999999` (`balance.ts:1998`) et explicitement indémolissable (`village.ts:792`). Les hordes/méga-horde le ciblent mais ne peuvent l'abattre.
- **Aucun village n'est jamais retiré.** `state.villages` n'est filtré nulle part (grep négatif) : un village peut perdre tous ses PNJ et toutes ses structures, l'objet persiste, coquille vide. Donc **pas de ruine pillable, pas de mémoire de carte**.
- **Le joueur respawn à l'infini** au Feu (PV 50, inventaire lâché, `combat.ts:670-689`). Pas de permadeath. Seuls les PNJ meurent pour de bon.
- **L'upkeep n'existe pas** — le seul mécanisme qui pourrait tuer une communauté par négligence (`balance.ts:515`, « R16 différée »).

**Le contresens le plus grave du projet.** On a réétiqueté le Feu « tool cupboard façon Rust » (décision 2026-07-18) en gardant exactement **l'inverse** de ce qui fait un tool cupboard : sa *vulnérabilité*. À Rust, tout l'endgame est de défendre/raider le cupboard. Ici il est indestructible et sans entretien — c'est un totem, pas un enjeu. Tant que ce chiffre reste, il n'y a ni siège, ni chute de village, ni ruine, donc pas de multi qui tienne.

**Le climax de fin est un trompe-l'œil.** La méga-horde de la Cendre est une horde ordinaire de 16 zombies qui **se dissipe à l'aube** comme les autres (`worldevents.ts:119-128`). L'évacuation (jour 55) est **un rond jaune + un test de proximité** : aucune action d'embarquement, aucune sortie de carte, aucun écran de victoire (`worldevents.ts:163-199`). Les « trois victoires par archétype » sont trois *strings* dans un event : le Foyer « sauve des vies » = compte ses propres PNJ (il n'y a personne d'autre à sauver, pas de réfugiés) ; la Meute « part les bras pleins » = valeur du grenier **sans jamais vérifier le départ**. Et la sim continue de tourner après `season_ended` (`sim.ts:505`) : le client n'ouvre qu'un panneau de journal. **Le joueur ne gagne ni ne perd rien qu'il puisse sentir.**

**Incohérence de calibrage liée : le froid n'est jamais létal sur la plaine.** `BASE 90 − ACT_COLD 40 − NIGHT_COLD 30 = 20`, soit *exactement* le seuil `HYPOTHERMIA`, où `coldDamagePerTick = 0` (`temperature.ts:60-85`). Sur les Prés Bas, même en acte III de nuit, le froid **ne retire jamais un PV** — il ne fait que ralentir. La « létalité du Grand Froid / de la Cendre » n'existe que sur biome froid (neige/glacier). Le discours contredit les nombres.

---

## 6. Motif structurel n°3 — une économie de stock déguisée en flux

Le système se titre « économie de flux » (GDD §8 : *« un serveur où tout le monde a plafonné en semaine 2 est mort en semaine 3 »*) mais fonctionne en **stock** :

- **Aucun upkeep, aucune dégradation de structure, aucun combustible de Feu.** Tout ce qui n'est pas nourriture ou outil est un stock permanent (`balance.ts:515`).
- **Deux seuls éviers réels** — l'usure d'outil et la péremption — et tous deux **facilement contournables** : re-crafter un outil est trivial, manger frais évite la péremption. Pire, le niveau de crafting **réduit l'usure** (`SKILL_WEAR_REDUCTION`, `economy.ts:500`) : plus on se spécialise, moins on consomme d'outils, plus l'autosuffisance est totale. La progression **érode** l'un des deux seuls éviers.

**Conséquence :** on bâtit une fois, on plafonne, on devient autosuffisant. Sans évier permanent, il n'y a **pas de débouché durable pour l'artisan, pas de cible pérenne pour le raid, pas de moteur de commerce** — précisément le scénario que le GDD déclare mortel.

**Et le geste qui aggrave tout :** `CARRY.CAPACITY` doublé de 30 à 60 le 2026-07-19 (`balance.ts:2286`). Le portage était le seul évier *tendu* du jeu ; le doublement le désamorce une semaine après l'avoir posé. La spec l'admet noir sur blanc (`portage.md:73`) : le gate « deux voyages pour fonder un village » saute. On a construit un mur, puis percé une porte dedans. En prime, ce doublement dé-calibre toute la table `ITEM_WEIGHT` posée contre 30 (ses commentaires sont désormais faux : « un sac de trente unités ne ramène que dix pierres de taille » en ramène maintenant vingt).

---

## 7. Tableau des interactions inter-systèmes

38 paires analysées. Voici les plus significatives, groupées par verdict. **Le motif d'ensemble :** les couplages *de survie à la minute* (faim/froid/portage ↔ endurance/combat) sont réels et bien faits ; les couplages *structurants et politiques* (économie ↔ endgame, alignement ↔ combat, chasse ↔ économie, PNJ ↔ défense) sont neutres, contradictoires ou débranchés.

### 7.1 Bien emboîtées (`meshed`) — le socle qui marche

| A ↔ B | Pourquoi ça marche | Réf |
|---|---|---|
| Faim ↔ endurance de combat | `hunger>70` → régén ×1,25 ; `≤0` → ×0,5. Bien nourri = souffle plus long. | `combat.ts:754` |
| Froid ↔ endurance | Le froid rabote la régén d'endurance : combattre gelé = souffle court. La bulle de feu achète de l'endurance. | `combat.ts:749` |
| **Surcharge ↔ combat** | Le meilleur couplage vivant : surchargé → régén ×0,25 **et** sprint refusé → le porteur ne se bat ni ne fuit, il rentre. Le PvP léger des routes, câblé. | `combat.ts:748`, `sim.ts:485` |
| Portage (bruit) ↔ chasse (ouïe) | Au palier lourd, on ne peut plus s'approcher en silence : le retour de chasse est bruyant. Deux systèmes qui se répondent. | `faune.ts:374` |
| Abattage ↔ pression de chasse | Tuer pose une zone de silence plus large que l'anneau de naissance : le gibier est une ressource de **territoire**, pas de temps. | `faune.ts` (`QUIET_RADIUS 46`) |
| **Saison/actes ↔ pression éco.** | Le meilleur mesh : `ACT_HUNGER_FACTOR [1,2,3]` double puis triple la conso ; repousse ×[1,1,5,2] ; la Cendre supprime les nœuds. Les actes serrent la vis à des endroits mesurables. | `economy.ts:790` |
| Cendre ↔ migration | Le front brûle les nœuds franchis → appauvrissement qui pousse le départ. (Mesh *soft* : rien ne force, il reste 40 % de vallée.) | `cendre.ts:227` |
| Maîtrise ↔ outil (gate doux) | Une vraie trouvaille : l'outil rend comme ton palier maîtrisé, jamais rien ; pas de blocage circulaire. | `economy.ts:283-299` |

### 7.2 Contradictoires (`contradictory`) — un système punit ce qu'un autre encourage

| A ↔ B | Le problème | Réf |
|---|---|---|
| **Feu (999999) ↔ raid / fin de partie** | On étiquette « tool cupboard Rust » un totem increvable : pas de siège, pas de chute, pas de ruine. Le totem nie l'enjeu qu'il incarne. | `balance.ts:1998` |
| **Économie de stock ↔ tension** | « Économie de flux » sans upkeep : on plafonne et on s'autosuffit — ce que le GDD déclare mortel. | `balance.ts:515` |
| **Respawn infini + Feu invincible ↔ pouvoir perdre** | La tension au tick est réelle, mais à l'échelle de la partie le jeu n'est **pas** perdable. | `combat.ts:670` |
| Blessures ↔ soin (bandage) | Le saignement de combat n'a aucun arrêt et le bandage est injouable : la boucle « blessure → médecin » se retourne en condamnation. | `combat.ts:719-724` |
| Acte III « froid létal » ↔ température plaine | Les nombres disent l'inverse du discours : ambiant plancher = seuil, dégâts 0. | `temperature.ts:60-85` |
| Cycle jour/nuit ↔ calendrier de saison | Découplage : une saison Veillée dure ~2-3 nuits réelles → toute la pression nocturne par acte est **quasi inobservable en solo**. | `worldevents.ts:104-116` |
| PNJ (récolte map-wide) ↔ défense | Les PNJ récoltent toute la carte sans rayon : vider les nœuds proches disperse la garnison → la récolte **désarme** la défense. | `npc.ts:99-111` |
| Chasse nocturne ↔ verdict Foyer | La nuit exclut les PNJ : un Foyer ne perd jamais un membre aux loups → « a sauvé N vies » est vide de sens. | `nighthunt.ts:48` |

### 7.3 Neutres (`neutral`) — juxtaposées, sans se parler

Les plus coûteuses stratégiquement :

- **Prospérité collective ↔ moral ↔ perf individuelle** — le pilier identitaire du GDD. Le **moral n'existe pas** en code : la prospérité d'un village ne confère **aucun** avantage de combat ou d'apprentissage sur le solo. L'interdépendance forcée, cœur du jeu, est débranchée faute de son moyeu. (`sim.ts:53-146`)
- **Chasse/faune ↔ économie (cuir)** — le chef-d'œuvre du `/sim` est un **îlot économique** : aucun cuir, aucun tannage. Ratio effort-de-simulation / conséquence-économique le plus déséquilibré du jeu. (`balance.ts:1187`)
- **Alignement ↔ combat létal/non-létal** — le GDD fait du non-létal « le lieu où l'alignement s'incarne ». **Zéro code** : on ne peut que tuer.
- **Progression ↔ combat** — `combat.ts` ne lit aucun skill : les familles Mêlée/Tir/Défense n'existent pas.
- **Archétype/paliers ↔ capacités débloquées** — le GDD acte « des déblocages, pas des multiplicateurs » ; le code fait l'exact inverse. Être Meute = « +20 % dégâts / −25 % récolte », pas un *build*. Rien de nouveau ne devient *faisable* en montant.
- **Portage ↔ raid (extraction)** — « la moitié du gameplay » sans consommateur : pas de charrette, pas d'extraction, serveur placeholder.

### 7.4 Trivialisantes (`trivializing`) — l'une annule l'autre

- **Chasse (rapporter le gibier) ↔ portage.** `raw_meat` pèse 1 (stack 5) : un cerf entier = 5 de charge = *léger*. Le système censé le plus « rapporter » ne rapporte **aucun** poids. (`balance.ts:2230`)
- **`CARRY.CAPACITY` 30→60 ↔ fondation de village.** Le doublement désamorce le seul évier tendu, la spec l'admet. (`balance.ts:2286`, `portage.md:73`)
- **Régén passive de PV ↔ métier de médecin.** `HP_REGEN_PER_MIN = 2` remonte les PV dès `hunger>50` — le corps se répare tout seul, ce que le GDD §6bis interdit explicitement pour **protéger** le futur médecin. (`combat.ts:733`)

---

## 8. Trous, orphelins et incohérences — liste priorisée

Classés par impact sur le gameplay, du plus structurant au plus mineur.

### Priorité 1 — cassent la promesse du jeu

1. **Aucun enjeu terminal** — Feu `999999`, villages jamais retirés, respawn infini, upkeep absent. Le jeu n'est ni perdable ni gagnable à l'échelle d'une saison. → `balance.ts:1998`, `combat.ts:670`, `village.ts:792`
2. **Alignement débrayé du solo** — `veillee.ts` ne fonde aucun village voisin ; le pilier n°1 ne se déclenche jamais. → `veillee.ts:82-96`, `alignment.ts:27-33`
3. **Économie de stock, pas de flux** — pas d'upkeep/combustible/dégradation ; on plafonne et on s'autosuffit. → `balance.ts:515`
4. **Parade injouable** — `block = false` en dur : la moitié défensive du combat de coût n'existe pas en jeu. → `WorldScene.ts:788`
5. **Bandage injouable → saignement = mort déterministe** — l'action existe mais le client ne l'émet jamais. → `combat.ts:230,719-724`
6. **Persistance Veillée non câblée + chronique non persistée** — aucun `serializeSim`/IndexedDB ; `state.events` drainé chaque tick → un monde repris serait amnésique. **GATE 1 (« 5 sessions sur le même monde ») infranchissable en l'état.** → `sim-worker.ts:84`, `WorldScene.ts:132`, `persistence-veillee.md:32`

### Priorité 2 — vident des systèmes de leur sens

7. **Le ladder de stations T2/T3 est inerte** — forge/atelier/ferme reconnues mais sans consommateur ; aucune recette n'exige `four_acier`/`tour_meca`/`atelier_lourd`. La moitié haute du pivot Rust est un cul-de-sac. → `economy.ts:769`, `balance.ts:829`
8. **Montée de palier du Feu sans bouton** — `upgrade_fire` jamais appelé côté client → palier figé à 1, tout le contenu T2/T3 injouable. → `village.ts:725`
9. **Chasse → viande seulement (zéro cuir)** — le système le plus sophistiqué ne débouche que sur `raw_meat` ; la chaîne Couture/tannage/tenues d'hiver n'a pas de matière. → `balance.ts:1215`, `combat.ts:642`
10. **La Ferme est un stub complet** — parcelle/serre/terroir craftables, fonction « ferme » reconnue, mais **aucune logique de culture** ; `terroir` est le seul débouché de `hardwood` et ne produit rien. → `construction.ts:246`, `balance.ts:610-615`
11. **Progression = multiplicateurs, pas déblocages** — 4 métiers de récolte (≠ les 15 branches GDD), aucune capacité/recette nommée débloquée, aucun budget de spé ni érosion. C'est le modèle que le GDD interdit en gras. → `economy.ts:283-299`, `items.ts:166`
12. **Climax de fin trompe-l'œil** — méga-horde qui se dissipe à l'aube, évacuation = rond jaune passif, victoires = strings de verdict. → `worldevents.ts:110-199`
13. **Non-létal absent** — assommer/capturer/rançonner : 0 ligne. Le pilier « l'alignement incarné dans le combat » n'existe pas. → grep vide

### Priorité 3 — orphelins et frictions localisées

14. **Ressources orphelines : `ash`, `peat`, `components`** — récoltables, gatées par outil, pèsent au sac, consommées par **rien**. Du lore qui encombre. → `balance.ts:711,713,714`
15. **`hardwood`** — consommé seulement par `terroir`, station qui ne produit rien : cul-de-sac via un débouché mort. → `balance.ts:505,570`
16. **Le POI « Gisement » ment** — dans le chemin joué, `placeZoneNodes` ignore le `nodeKind` ; un « Gisement » ne pose que de la roche. Anti-lisibilité exacte que le design veut éviter. → `economy.ts:955`, `veillee.ts:72`
17. **Trois cercles de risque = code mort** — `circleFactor`/`CIRCLES` ne vivent que dans `generateNodes`, appelé par le seul banc. La rareté est devenue purement zonale (bon), mais aucun gradient de **danger** n'est corrélé à la richesse. → `economy.ts:910-934`
18. **Deux stacks de génération de carte** — le banc de calibrage (`pnpm scenario`) tourne sur `valleygen` + `generateNodes`, **une carte que le joueur ne voit jamais**. Tout nombre calibré là est suspect. → `scenario.ts:36` vs `veillee.ts:61`
19. **Milice online-only + gloutonne** — aucune défense offline (pilier de raid) ; la milice marche sans A*, kitable. → `npc.ts:537,576`
20. **PNJ débordent le cercle domestique** — `nearestAliveNode` scanne toute la carte sans rayon (règle GDD violée, exploitable). → `npc.ts:99-111`
21. **Bras blessé sans coût économique** — `harvestStrike` n'inspecte jamais `wounds` : un bras cassé ne coûte rien au travail (le GDD dit « bras = attaque **et** travail »). → `economy.ts:458`
22. **Endurance ne gate pas le travail** — `harvestStrike` ne touche jamais la stamina : un bûcheron abat toute la journée sans fatigue. Défendable, mais « la logistique de l'endurance » ne pèse pas là où le joueur passe l'essentiel de son temps.
23. **Mémoire d'agression = 1 cycle** — le premier sang devrait marquer « pour tout l'engagement » ; passé 1 cycle, l'agresseur se blanchit tout seul. → `balance.ts:2115`
24. **`SPRINT_MAX_TIER` = constante morte** — jamais lue, le seuil est en dur dans `sim.ts:485`. Viole la règle CLAUDE.md « aucun nombre d'équilibrage en dur » sur le nombre emblématique du portage. → `balance.ts:2321`

---

## 9. Constantes d'équilibrage suspectes

Extrait du scan de `balance.ts` (2400 lignes). Les plus parlantes :

| Constante | Valeur | Pourquoi suspecte | Réf |
|---|---|---|---|
| `STRUCTURE_HP.fire` | `999999` | Interrupteur « off » déguisé en valeur : rend le Feu increvable, contredit le pivot Rust. | `balance.ts:1998` |
| `CARRY.CAPACITY` | `60` | Doublée 30→60 : désamorce le seul évier + dé-calibre toute la table `ITEM_WEIGHT`. | `balance.ts:2286` |
| `COMBAT.HP_REGEN_PER_MIN` | `2` | Régén passive de PV, interdite par le GDD §6bis (« sinon le médecin ne sert à rien »). | `balance.ts:1980` |
| `TEMPERATURE.INSULATION_BODY` | `1` | Stub explicite, jamais modulé : aucun vêtement ne réchauffe, toute la branche Couture sans hook. | `balance.ts:64` |
| `TEMPERATURE.ACT_COLD` | `[0,25,40]` | `40` tombe pile sur le seuil d'hypothermie → froid jamais létal sur plaine. `+1` ou assumer. | `balance.ts:42` |
| `COMBAT.BLEED_HP_PER_S` | `1.5` | 3× le saignement de chasse + bandage injouable = condamnation à mort. | `balance.ts:1978` |
| `CIRCLES.*_STOCK` | `0.5/1/1.6` | Facteurs de richesse par cercle **morts** dans le jeu réel (calibrer un monde que personne ne joue). | `balance.ts:638-640` |
| `MONSTER_DEFS.cendreux` | `dmg 34 / hp 20` | Glass cannon non calibré : le monstre qui donne son nom au jeu meurt en 2 coups. | `balance.ts:1194` |
| `COMBAT.EXHAUSTION_TICKS` | `5 min` | Placeholder auto-avoué (« GDD vise ~30 min ») : la mort est 6× moins punitive que prévu. | `balance.ts:1986` |
| `WORLD_EVENTS.REPAIR_*` | `1 bois / 50 PV` | Réparer coûte 2× plus par PV que bâtir neuf, et est agnostique au matériau (réparer un mur métal au bois). | `balance.ts:2026` |
| `SKILL_YIELD_STEP` / gate fer | `8` / `niv.5` | Seuils calibrés trop haut : niveau 8 = 6400 XP, niveau 5 = 2500 coups → leviers de rendement quasi hors de portée d'une Veillée. | `balance.ts:342-344` |

---

## 10. Angles morts de la revue (ce que même cet audit a failli manquer)

La passe critique de complétude a levé des lièvres que la cartographie par système ne voyait pas :

- **Audio totalement absent — et c'est fatal au chef-d'œuvre.** La chasse repose sur trois canaux de perception dont l'**ouïe** : la faune *entend* le joueur, mais **le joueur n'entend rien**. Le hurlement d'avertissement du loup, le sanglier qui souffle, le bruit qu'on fait chargé, la bête qui charge hors-champ — tout est émis comme événement de domaine **sans retour sonore**. Le « stop-and-go qui émerge » se joue *sourd*. Idem combat (jeu d'action à télégraphes, aucun impact sonore). Différé « après GATE 1 », mais aucune des 14 cartes ne l'avait relevé. → `WorldScene.ts:1156`
- **Zéro onboarding + spawn mains vides + verbes non-évidents ou secrètement morts.** Le nouveau joueur naît sans rien, sans tutoriel, et doit deviner : la jauge charge-relâche de l'abattage, la lecture de flanc au minage, la ceinture qui arme l'outil. **Pire, il appuiera sur « parer » et rien ne se passera** (`block=false`), sans message. Cela menace directement le seul critère de sortie posé (GATE 1 : « fun 5 sessions d'affilée »).
- **Interaction *fonctionnelle* oubliée par la matrice : Construction × Température.** Un bâti à **toit** (`isSheltered`) divise par deux l'exposition nuit+biome (`SHELTER_FACTOR 0,5`, +15 °C testé) : **bâtir une maison couverte réchauffe réellement**. C'est un second débouché de survie de la construction, déjà branché — la carte Construction le sous-estime. → `temperature.ts:70`, `temperature.test.ts:64`
- **La couche client / feel / rendu n'est quasiment pas auditée** (81 fichiers TS) — or pour un jeu d'action top-down, le feel est la moitié du produit, et la mémoire projet pose « Feel = pente continue » comme priorité.
- **Gouvernance (MVP « rang + Chef + propriété »)** — `banish` et `upgrade_fire` existent mais ne sont câblés à aucun input : la moitié des verbes de pouvoir du Chef sont morts côté joueur.
- **Chat de proximité** — seul canal social joueur-à-joueur, **inerte en solo** (un seul joueur naît) et non éprouvé avant la LAN.
- **Soif / eau** — mécanique de survie attendue, **absente** (0 occurrence `thirst`/`soif`). Idem Cicatrices, réputation locale, migration de gibier map-wide, brouillard de guerre.
- **La META, la plus importante :** aucune carte ne cite une observation du jeu **réellement joué**. Tous les verdicts reposent sur « le code existe et les tests passent ». À lire comme de l'analyse statique, jamais comme un verdict de fun.

---

## 11. Avis de design (position tranchée)

On me demande de ne pas rester évasif. Voici mon opinion de designer sur l'état du jeu.

**Ce qui est le cœur solide, sans réserve :** la **faune** est un vrai chef-d'œuvre de systémier — je la défendrais contre toute tentation d'y « ajouter de la profondeur », elle n'en a pas besoin. Le **cœur du combat de mêlée**, le **geste de récolte**, le **noyau déterministe** et la **marée de Cendre** sont du travail de première main. Ce projet n'a pas un problème de compétence technique ; il en a même un excès rare pour un solo.

**Ce qui est encore du remplissage — ou pire, du décor qui coche des labels :** la **construction émergente** au-delà du tier 1 (on bâtit une « forge » qui ne forge rien), la **progression** (un compteur de récolte déguisé en identité), les **victoires par archétype** (trois *strings* dans un event), l'**évacuation** (un rond jaune), et une bonne partie du **portage** (une taxe de vitesse solo tant qu'il n'y a ni charrette ni extraction ni PvP). Ce ne sont pas des systèmes ratés — ce sont des *maquettes jouables* vendues par la prose de vision comme des systèmes finis.

**Où est le plus gros risque pour le fun à moyen terme.** Il est double, et il ne se voit pas dans les tests :

1. **La boucle cœur réellement jouée est mince.** Quand on soustrait tout ce qui est débranché — alignement, victoire/défaite, parade, bandage, palier du Feu, moral, PNJ voisins — la Veillée livrée se réduit à : *récolter → crafter → bâtir un décor → chasser de la viande → manger → tenir le froid près d'un feu*. C'est honnête, mais c'est **très loin du pitch** (« la morale est une mécanique », « ton village est ton personnage »), et surtout **personne n'a encore vérifié que c'est amusant deux heures d'affilée**, encore moins cinq sessions. Le jeu a été construit système par système, en profondeur, mais **jamais évalué comme une expérience de session**.

2. **Il n'y a pas d'enjeu.** Rien ne meurt terminalement. Le pitch entier — « un monde qui meurt en 60 jours », « on ne joue pas pour garder mais pour ce qu'on racontera » — repose sur une *condamnation* qui, dans le code, est un décor : la Cendre appauvrit mais ne tue pas, la méga-horde égratigne des murs, le Feu est éternel. Un survival sans perte possible est un bac à sable ; ce n'est pas ce que BRAISES prétend être.

**Mon diagnostic global :** BRAISES est un **moteur de simulation d'exception attaché à une expérience de jeu encore embryonnaire**. La disproportion est inhabituelle — d'ordinaire c'est l'inverse. La conséquence est que **le prochain travail à plus fort levier n'est pas d'écrire du code neuf, mais de brancher, peupler et rendre mortel ce qui existe déjà.** Le ratio valeur-de-jeu / effort de ces branchements est énorme : peupler la Veillée de 2 villages PNJ (quelques lignes) allume le pilier n°1 ; une ligne de cuir dans deux tables de loot fait irriguer toute la chasse ; rendre le Feu tuable ouvre l'endgame. Ce sont des gestes petits aux effets massifs — et plusieurs sont des **décisions de design qu'Alexis doit trancher**, pas des correctifs techniques.

---

## 12. Recommandations macro (première passe — matière pour la Phase 2)

Intuitions fortes, pas des specs. À creuser en Phase 2. Ordonnées par ratio impact/effort décroissant.

1. **Peupler la Veillée de villages PNJ voisins.** Le geste unique qui allume le pilier n°1 (alignement, raids, dons, couleur du Feu) dans le mode livré. *Décision de design : combien, quel caractère, à quelle distance.* → cf. §4.2
2. **Poser la chaîne du cuir.** Un item `leather`, une recette de tannage, une ligne dans deux tables de loot : la faune (chef-d'œuvre inexploité) se met à irriguer économie, couture et température d'hiver. Le meilleur ROI du projet. → cf. §4.3
3. **Rendre le Feu tuable et brancher l'upkeep.** Sans « un village PEUT tomber », il n'y a ni endgame, ni raid, ni économie de flux, ni multi qui tienne. C'est le déblocage structurel dont dépend le reste. → cf. §5, §6
4. **Rebrancher les deux boucles de combat mortes : parade + bandage.** Une case « pansement » dans la ceinture, un input de blocage. Sans elles, « blessures plutôt que PV secs » se retourne en « PV secs + condamnation ». → cf. §4.1
5. **Câbler la persistance Veillée + la mémoire de chronique côté hôte.** Sans reprise du *même* monde avec sa mémoire, GATE 1 (« 5 sessions ») est infranchissable, quelle que soit la qualité de la boucle. → cf. §8 (P1-6)
6. **Faire *payer* la construction émergente.** Brancher les recettes sur `FunctionId+tier` et faire lire les bonus forge/atelier ; câbler `upgrade_fire`. Sinon le pivot Rust reste une maquette T1. → cf. §4.3
7. **Transformer l'endgame en *acte* et non en tri de score.** L'évacuation/l'arche comme objet à construire et atteindre, avec fenêtre et risque ; la méga-horde comme vrai climax lié à la fin. → cf. §5
8. **Trancher la question des maîtrises : au moins UN déblocage nommé par branche vivante + un budget/érosion.** C'est le seul mécanisme qui transforme un compteur en identité (« la trappeuse de l'Est »). *Décision de design majeure.* → cf. §8 (P2-11)
9. **Corréler danger et richesse (les trois cercles), et faire tourner les filons miniers.** Aujourd'hui on récolte « ailleurs », pas « plus riche mais plus risqué » ; et la dérive des nœuds saute précisément la mine, la seule famille que le GDD voulait voir « rouvrir ailleurs ». → cf. §7.3, §8 (P3-17)
10. **Résoudre le découplage cycle/calendrier et le froid non-létal sur plaine.** Deux décisions de cohérence : soit la nuit qui chasse et les hordes se cadencent sur le calendrier (sinon le solo ne les voit jamais), soit on assume ; soit la plaine peut tuer par le froid en acte III, soit on arrête d'écrire « froid létal ». → cf. §5, §7.2

**Ménage transverse (petit effort, dette qui grandit) :** synchroniser les specs désynchronisées (`economie.md`, `inventaire.md`, `monde.md`, header `pnj.md`), retirer les constantes mortes (`SPRINT_MAX_TIER`, `CIRCLES` en jeu, vestiges `MONDE.*`), et migrer le banc de calibrage sur `zonegen` (la carte réellement jouée).

---

## 13. Synthèse finale : la boucle tient-elle debout ?

**Honnêtement : le socle oui, la boucle pas encore.**

Le *socle* — la simulation — tient remarquablement debout. Déterministe, testé, avec plusieurs systèmes d'une qualité qu'on voit rarement sur un projet solo à ce stade. Rien de tout cela n'est à jeter ; presque tout est à *raccorder*.

La *boucle de jeu*, elle, ne tient pas encore debout comme une expérience — pour trois raisons qui sont les trois motifs de ce rapport : trop de systèmes finis restent **débranchés** du mode joué ; il n'y a **pas d'enjeu terminal** (on ne peut ni perdre ni gagner une saison) ; et l'économie **plafonne** au lieu de couler. Résultat, la Veillée livrée est une boucle de survie honnête mais mince, dont personne n'a encore vérifié qu'elle est fun sur la durée — et qui ne raconte pas encore l'histoire que le pitch promet (le village-personnage, la morale-mécanique, le monde condamné).

La bonne nouvelle est que le diagnostic est **encourageant** : la distance entre « ce qui est codé » et « le jeu que BRAISES veut être » se comble surtout par du **branchement, du peuplement et de la mortalité**, pas par des années de code neuf. Les cinq ou six gestes à plus fort levier (peupler la Veillée, poser le cuir, rendre le Feu tuable, rebrancher parade/bandage, câbler la persistance) sont petits au regard de ce qu'ils débloquent. **La Phase 2 devra transformer ces intuitions en axes concrets — et l'essentiel du travail sera de finir de connecter un très bon moteur à un jeu qui existe déjà à 80 % dans `/sim`, mais que le joueur n'atteint qu'à moitié.**

---

*Fin de la Phase 1. La Phase 2 (`docs/axes-amelioration-phase2.md`) creusera ces recommandations en axes d'amélioration priorisés, en distinguant ajustements d'équilibrage, refontes et nouvelles mécaniques. La Phase 3 (`docs/direction-design.md`) en tirera la direction de design et synchronisera la documentation.*
