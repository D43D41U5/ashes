# Les PNJ — villageois simulés, tableau du village

*Source : GDD §10 (mode Veillée, RimWorld-light), §5 (PNJ = main-d'œuvre, pas citoyens ; « plus d'humains = moins de bras »), §6 (le tableau du village). Statut : **implémenté** (2026-07-05, A1-A8 verts — dont la survie 10 jours — + smoke test navigateur). Jalon : V5.*

> **⚠⚠ 2026-09-29 — LES VILLAGES PNJ SORTENT DU JEU** (décision d'Alexis du 2026-09-28, `braise.md`
> § 4 : *« à bandeauter, pas à réécrire »*). Ils étaient déjà ÉTEINTS derrière `FEATURES.VILLAGES_PNJ`
> depuis le 26/09 ; le retrait du code a commencé, par tranches, et cette spec cesse d'être une
> cible. **MESURÉ avant de couper** : dans le jeu joué, aucun PNJ ne peut naître — le drapeau ferme
> `foundNpcVillage`, le client fonde par `found_village` (qui pose `npcsArrived: true`, « aucun PNJ
> d'accueil », décision d'Alexis), et `light_fire` — le seul chemin qui en amènerait trois — n'a
> **aucun émetteur côté client**. `state.npcs` reste donc vide dans tout monde NÉ après le 26/09.
>
> ⚠ **UNE VIEILLE SAUVEGARDE, ELLE, PORTE ENCORE SES PNJ** : `FEATURES.VILLAGES_PNJ` a éteint la
> FONDATION, pas la persistance — une Veillée commencée avant le 26/09 recharge ses villages et ses
> villageois. Pour eux, la tranche 1 arrête seulement la croissance (plus de colon, plus de palier,
> plus de porte rituelle) ; ils restent là. Ce que devient un tel monde quand l'IA des villageois
> partira à son tour est la question que la tranche 2 doit trancher, pas un détail de migration.
>
> **Tranche 1 (faite)** : `village-growth.ts` — la porte rituelle (R7), la montée de palier (R6) et
> le colon (R9), dont la boucle entière était gardée par `chiefId === 0`. Avec eux les événements
> `village_stage_up` et `settler_arrived`.
>
> ⚠ **P-A2 devient SANS OBJET, il n'est pas corrigé.** Ses quatre conditions de terminaison
> inatteignables — au premier chef la réparation qui ne s'achève jamais quand le Feu est à sec, et
> qui mange le bois même qui manque au Feu — étaient inventoriées et non réparées. Elles partent
> avec la machine, elles ne sont pas résolues : quiconque ressusciterait ce code depuis git les
> ressusciterait avec.

## Objectif de design

Peupler les villages. Un village 100 % PNJ doit *survivre* seul (le joueur y prospère, GDD §10) : les villageois mangent, dorment, travaillent, et le tableau du village orchestre le travail — le même tableau que les joueurs liront et alimenteront plus tard. C'est le système qui fait du solo un jeu et du serveur un monde déjà habité.

## Règles

### Principe fondateur : les PNJ jouent au même jeu

- **R1 — Un PNJ agit par le pipeline d'actions validées**, exactement comme un joueur : son IA émet des intentions (`move + action`) qui passent par `applyEconomyAction`/`applyVillageAction`. Aucun PNJ ne triche (pas de téléportation, pas de ressources ex nihilo) — l'égalité des règles est ce qui rend le remplacement PNJ → humain honnête (GDD §10 : « prendre la place d'un PNJ »).
- **R2 — L'IA vit dans `/sim`** (GDD §11) et tire son aléa du PRNG de la sim : un village PNJ est rejouable au bit près. `step()` fait agir les PNJ après les inputs des joueurs, dans l'ordre des ids.

### L'IA : deux étages, pas de GOAP

- **R3 — Étage 1, les besoins** (priorité absolue) : faim < 30 → manger (inventaire, sinon aller retirer au grenier) ; nuit et énergie < 40 → aller dormir. **Étage 2, le tableau** : sinon, prendre la tâche libre la plus prioritaire compatible, l'exécuter, recommencer. Les égalités se départagent par id (déterminisme). Pas d'arbre de comportement, pas de planification — des seuils et une file.
- **R4 — L'énergie est un besoin de PNJ** (0-100, dans l'état PNJ, pas sur l'Entity) : elle baisse éveillé, remonte endormi — **×2 plus vite dans sa maison qu'au Feu**. La maison n'est pas cosmétique : elle est le régulateur de la main-d'œuvre (GDD §5).

### Le tableau du village (GDD §6)

- **R5 — Le système poste, les PNJ prennent.** Des règles de seuil sur les stocks du **grenier** (= les coffres d'accès `village`) génèrent les tâches : nourriture < cible → `récolter baies` ; bois < cible → `couper du bois` ; baies ≥ 4 et ragoûts < cible → `cuisiner` ; structure endommagée → `réparer` (le PNJ va chercher du bois puis répare, `executeRepair`). Recalcul toutes les `BOARD_REFRESH_TICKS` (5 s). Une tâche a `{ id, kind, priority, claimedBy }` — une seule réclamation à la fois. *(Hors tableau : un PNJ peut aussi porter une **expédition** inter-villages — raid de Meute / don de Foyer selon l'alignement, cf. `alignement.md` R13-R14 ; l'expédition prime sur le tableau mais cède à la survie du porteur.)*
- **R6 — Le fruit du travail va au grenier** : le PNJ dépose sa récolte dans un coffre `village` (il garde de quoi manger). Les joueurs voient le tableau (HUD) — en V5 ils ne postent pas encore de tâches manuelles (ça vient avec la réputation locale).

### La maison et la navigation

- **R7 — La maison** entre au catalogue (reportée de V3) : 8 bois, 1×1, un PNJ s'y assigne (première maison libre du village). Sans maison, il dort au Feu (récupération ÷2). *Plus tard : un humain qui rejoint prend la maison d'un PNJ.*
- **R8 — A\* sur la grille en V5.** Les arbres et les murs bloquent : la marche gloutonne ne suffit plus. A\* déterministe (coûts entiers, départage stable), chemin recalculé si bloqué. Les flow fields restent pour les hordes (V7) — l'A\* individuel et le flow field de masse sont deux outils différents.

### Le peuplement

- **R9 — Fonder attire** : quand un joueur allume un Feu, `NPC_PER_VILLAGE` (3) PNJ arrivent et deviennent membres (spawn aux abords). Le régulateur « plus d'humains = moins de bras » attend le multi.
- **R10 — `foundNpcVillage(state, tx, ty, count)`** : crée un village autonome complet (Feu, grenier, `count` maisons et PNJ) — l'outil du mode Veillée, des tests, et du peuplement de la vallée. La vallée de démo en reçoit un. *(> ⚠️ **À trancher.** La Veillée réellement jouée n'en fonde aujourd'hui aucun — seul le banc `scenario.ts` le fait, donc l'alignement ne se déclenche jamais en solo ; peupler la Veillée de voisins est le chantier R-A / tension T1, cf. `direction-design.md`.)*

## Critères d'acceptation

- **A1** — Grenier sous les seuils → le tableau génère les tâches attendues ; deux PNJ ne réclament jamais la même tâche.
- **A2** — Un PNJ affamé sans vivres va au grenier, retire, mange — sa faim remonte.
- **A3** — La nuit tombée, le PNJ fatigué dort (dans sa maison si assignée) ; son énergie remonte ×2 en maison vs au Feu ; au matin il retravaille.
- **A4** — A\* : un PNJ atteint une cible derrière un bosquet d'arbres bloquants (la ligne droite échouerait) ; le chemin est identique à chaque run.
- **A5** — Cycle complet du travail : tâche `récolter baies` → le PNJ y va, récolte, revient, dépose au grenier — le stock du village monte.
- **A6** — Fonder en tant que joueur → 3 PNJ membres apparaissent ; `foundNpcVillage` produit un village complet et fonctionnel.
- **A7 — LE critère (roadmap)** : un village 100 % PNJ (4 PNJ, grenier, maisons, buissons et arbres alentour) tient **10 jours simulés** en calendrier accéléré, headless : aucun PNJ ne tombe à 0 de faim après la mise en route, et le grenier n'est jamais à sec plus d'un cycle.
- **A8** — Le déterminisme tient avec l'IA active : même seed = même village au bit près après 10 jours, et le replay d'une partie avec PNJ est exact (l'IA ne consomme que le PRNG de la sim).

## Hors périmètre (et où ça revient)

- Patrouilles (rondes proactives) → plus tard. *(La **milice réactive** et la **réaction aux alarmes** sont livrées : `npc.ts` `handleDefense`, spec combat R13 — tout PNJ combat une menace près du Feu.)*
- Tâches postées par les joueurs, réputation locale, promotion → quand de vrais groupes jouent (LAN/Vallée).
- PNJ bâtisseurs (construire des structures) → plus tard ; en V5 ils récoltent, cuisinent, transportent, **réparent** et **défendent** (la construction, elle, reste au joueur).
- Un humain prend la maison d'un PNJ → Phase LAN (il faut des humains qui rejoignent).
- Simulation dégradée hors zone active → Phase Vallée (multi-rooms).
- Dialogue, personnalité, humeurs → jamais en mécanique pure ; de la texture plus tard.

## Ajouts à `balance.ts`

`NPC_PER_VILLAGE = 3`, `NPC_HUNGER_EAT_THRESHOLD = 30`, `NPC_ENERGY_SLEEP_THRESHOLD = 40`, `ENERGY_PER_CYCLE_HOUR` (baisse éveillé), `SLEEP_RECOVERY_HOME = 2` (×maison), `SLEEP_RECOVERY_FIRE = 1`, `BOARD_REFRESH_TICKS = 60`, cibles du grenier `VILLAGE_FOOD_TARGET`, `VILLAGE_WOOD_TARGET`, `VILLAGE_STEW_TARGET`, coût maison `{ wood: 8 }`.

---

## La passe sur la machine du village — ouverte, puis SUSPENDUE le 2026-09-26

> ⛔ **SUSPENDUE LE JOUR MÊME, ET LES VILLAGES PNJ SONT ÉTEINTS — décision d'Alexis :** *« stop les
> villages. Masque-les avec une feature flag (idem pour les tests) »*, puis la raison : *« je veux
> qu'on finisse la worldgen avant »*. Le drapeau est `FEATURES.VILLAGES_PNJ` (`packages/sim/src/features.ts`),
> éteint, et il ne ferme **qu'une porte** : la fondation, dans `peuplerLesVoisins`. L'élection des
> sites et le RÉSEAU DE SENTES tournent toujours — les routes du monde joué sont inchangées, elles
> mènent seulement à des clairières vides.
>
> **CE QUI EST LIVRÉ ET TIENT** : P-A1 (la vivacité du tableau) et P-A3 (le gardien du Feu), avec
> leurs gardes, et P-A4 (l'attribution du coût, qui a corrigé le 1,36 ms en amorçage).
> ⚠ **CE QUI EST INVENTORIÉ ET NON CORRIGÉ — à lire AVANT de rallumer le drapeau** : les **quatre**
> conditions de terminaison inatteignables de P-A2, au premier chef **la réparation qui ne s'achève
> jamais quand le Feu est à sec et qui mange le bois même qui manque au Feu** ; le mur de pierre qui
> ne se répare jamais au-delà du cinquième de sa solidité ; le froid dont on ne sort jamais ;
> `fetch_water` sans branche de purge ; et la corvée qu'un dormeur garde toute la nuit alors qu'elle
> est unique au tableau. **Rallumer les villages sans traiter P-A2 rallumerait ces défauts avec.**
> ⚠ **ET LE GEL A SA CAUSE, trouvée juste avant l'arrêt** : le pic de 517 à 607 ms tombe au tick
> UNIQUE du crépuscule, où `assignErrands` (`npc-errands.ts`) assigne les expéditions et où **chaque
> villageois lance un A\* complet sur 1581×1700**. Ce n'est pas un défaut de l'A\* mais leur NOMBRE
> sur un seul tick ; et le corriger (étaler l'assignation, ou la plafonner) **décale le flux des
> événements et du PRNG** — donc c'est un changement de JEU à trancher avec Alexis, pas une
> optimisation transparente. Le drapeau éteint supprime le gel en attendant.
> L'instrument qui a établi tout cela survit : `tools/profil-villageois.mts` et ses trois lecteurs.
>
> ⚠ **LA RÉVERSIBILITÉ EST MESURÉE, ELLE N'EST PAS GARDÉE.** Le drapeau remis à `true`, le banc rend
> ses **quatre gardes vertes** et les mêmes chiffres qu'avant (*villages écartés de 221 tuiles, marge
> de ciblage 9,4 %*) : allumé, le code exécuté est `if (true)` autour de la boucle d'avant, à
> l'identique. **Mais rien ne surveille cette propriété tant que le drapeau est éteint** — *« idem
> pour les tests »* veut dire `it.skipIf`, donc aucune garde ne rejoue `fonder = true`, et ni
> `empreinte-sim` ni `replay-monde-reel` ne l'éprouvent (tous deux appellent `foundNpcVillage` en
> direct, sans traverser `peuplerLesVoisins`). C'est un fait à REFAIRE du même geste — basculer le
> drapeau, jouer le banc — et non un invariant. La règle ① de `features.ts` n'est donc pas honorée
> par une garde pour ce drapeau-ci, et c'est écrit là-bas aussi.
>
> **CE QUI EST GELÉ, PAR SUJET ET NON PAR PRÉSENCE** : quatre gardes seulement (V-A2 de
> `veillee.test.ts`, trois du banc) — les ~29 fichiers qui se servent d'un village comme DÉCOR
> appellent `foundNpcVillage` en direct et ne sont pas traversés. Deux pièges méritaient le geste :
> `A8 — la météo armée ne tue aucun PNJ` **passait au VERT sans un seul PNJ** (trivialement vraie sur
> une population nulle), et `mesure le monde qu'on JOUE` est gardée ENTIÈRE, seul son dernier bloc
> gelé — avec un ELSE qui AFFIRME `villages.length === 0`, pour qu'une fondation revenue par une
> autre porte ne passe pas en silence. Côté navigateur, même partage : `gi-face` (sa scène LG-A17
> était bâtie sur une enceinte PNJ tamponnée) et `village-pnj` déclarent n'avoir plus de sujet ;
> `vitrine` saute ses prises de village en le disant ; `trainer` perd ses trois branches d'annonce de
> Feu — perte assumée ; `gi-temoin`, `epuisement`, `flore` et `arete` sont intacts.

### Le périmètre d'origine, tel qu'il avait été arrêté

> **POURQUOI ELLE EXISTE.** En une semaine, le banc a sorti **trois défauts de la même machine** :
> le villageois qui ne sait pas rentrer à son Feu (V-R11, budget d'A\*), le site de récolte
> enclavé qu'il réélit sans fin (V-R12), et le tableau que gèle une corvée inexécutable
> (V-A9bis). Aucun n'était visible au diff ni au test unitaire ; les trois se sont vus **en
> jouant des ticks**. Plus un plafond : **~1,36 ms par villageois** (MESURÉ le 2026-09-21), dont
> on ne sait pas encore où il part — à quinze villageois les PNJ pèsent 73 % du tick, et c'est ce
> qui interdit « beaucoup de villages en bas » (`ascension.md` V-R4).
>
> **DÉCISION D'ALEXIS du 2026-09-26** : on arrête de rustiner, on reprend la machine d'un bloc.

**LE PÉRIMÈTRE, ET IL EST FERMÉ.** Trois volets, pas quatre :

1. **le Feu** — comment un village le garde allumé ;
2. **le coût du villageois** — attribué, puis baissé ;
3. **des gardes qui attrapent ce genre de blocage AVANT le banc.**

**HORS PÉRIMÈTRE, explicitement** : la gouvernance (`village.md` R10-R12), l'évolution du bâti
(`village-pnj-evolution.md`), les raids, et le peuplement par palier (`ascension.md` V-R4 seconde
moitié, V-A3) — le volet ② le débloque, il n'en fait pas partie. Ce n'est pas une passe sur le
village comme sujet de design : c'est une passe sur sa **machine**.

### Critères de sortie

- **P-A1 — LA VIVACITÉ DU TABLEAU.** ✅ **LIVRÉE le 2026-09-26** (`npc.test.ts`, la garde
  générique). La loi ne nomme aucune corvée : *un village qui a encore quelqu'un de vivant
  travaille, quoi qu'il lui manque*. Un empêchement que le village ne peut pas lever a le droit
  de laisser une corvée inexécutable ; il n'a pas le droit d'arrêter les autres. Quatre
  empêchements au tableau, chacun avec sa voie de sortie nommée, chacun prouvant sa prémisse
  (tableau non vide, villageois vivants) avant de conclure. **MESURÉ, et c'est ce qui la rend
  honnête : 4 rouges sur 4 sur `7ea2121`** (le commit d'avant V-A9bis), toutes à **zéro tick de
  travail sur 9 000 possibles** — et le cas « réparation seule, Feu plein » rougit à part, donc
  les deux moitiés du correctif étaient nécessaires. Ajouter un empêchement se fait en une ligne
  du tableau `EMPECHEMENTS`, jamais en un test de plus.
- **P-A2 — AUCUNE CONDITION DE TERMINAISON INATTEIGNABLE, ou alors documentée.** `advanceNpcs`
  tourne **avant** `advanceUpkeep` : un villageois voit toujours un état qui vient de subir son
  tick d'usure, donc toute garde comparée à un plein exact est aveugle. La loi qui en découle :
  *toute grandeur écrite par une phase POSTÉRIEURE est lue par les PNJ telle qu'elle était à la
  fin du tick précédent — donc « le max moins un tick d'usure » dès qu'elle avait été remise au
  plein.* ⚠ **INVENTAIRE FAIT le 2026-09-26** (`eclaireur-etat`, garde exhaustive contre l'ordre
  réel des phases de `step`, `sim.ts:968`). On en connaissait UNE ; il y en a **quatre**, et les
  trois neuves sont MESURÉES au code. Et le tableau porte **12 `kind`, pas 4** — les sept récoltes
  passent toutes par `executeGather` (`TaskKind`, `village.ts:211-237`).

  | # | la garde | ce qu'elle ne peut pas observer |
  |---|---|---|
  | ① | `fuel >= FIRE_UPKEEP.CAPACITY` (`npc.ts`) et `room <= 0` (`village.ts`) | le drain du Feu est inconditionnel. *Précision utile : la garde reste atteignable pour le geste du JOUEUR, qui passe par la phase d'inputs — jamais pour un PNJ.* |
  | ② | **NEUVE, et c'est la JUMELLE EXACTE du défaut du Feu** : `hp >= STRUCTURE_HP[type]` (`npc.ts`) et la purge `s.hp < STRUCTURE_HP[s.type]` (`village-board.ts`), **quand le Feu est à sec** | à `fuel <= 0`, `advanceUpkeep` abîme CHAQUE mur, vantail et palissade du village à TOUS les ticks. Le PNJ lit toujours `hp = max − 0,0025` : la réparation **ne termine jamais et n'est jamais purgée**, et chaque coup mange **1 bois toutes les 20 ticks** — précisément le bois qui manque au Feu. Un village dont le Feu s'est éteint dépense donc son bois à rafistoler au lieu de rallumer. |
  | ③ | **NEUVE — le maximum comparé N'EST PAS le maximum** : `STRUCTURE_HP[type]` (bois, 200) contre le PV réellement posé, `floor(baseHp × hpBonus)` — pierre 500, métal 1000, ×1,25 pour un village d'archétype `foyer` | un mur de pierre ne se répare **jamais au-delà de 200 sur 500**, et n'est déclaré à réparer qu'en dessous de 120, soit **24 % de son vrai max**. La voie `upgrade` connaît le max par matériau ; `repair` l'ignore. L'asymétrie est locale. |
  | ④ | **NEUVE — `entity.temperature >= NPC_COLD_RESUME` (37)** contre le clamp `CORPS_SAIN = 37` | la dérive thermique est **asymptotique**. MESURÉ en boucle : parti de 33, après 20 millions d'itérations `t = 36,999999999982` — point fixe, l'incrément passe sous le demi-ulp de 37. Un villageois qui a eu froid ne sort de l'hystérésis que par la branche abri. |

  ⚠ **ET DEUX TROUS DE LA MÊME FAMILLE, hors « plein inatteignable » :** (a) `fetch_water`
  n'a **aucune branche de purge** dans `refreshBoard` ; (b) **les besoins ne lâchent pas la
  corvée** — `npc-needs.ts` ne contient pas un seul `dropTask`, et l'aiguillage fait `continue`.
  Un villageois qui s'endort **garde sa réclamation toute la nuit**, or `feed_fire`, `build` et
  `fetch_water` sont **uniques** au tableau : personne ne peut la reprendre. *(Structure MESURÉE ;
  la conséquence — un Feu qui s'assèche parce que son porteur dort — reste SUSPECTÉE, c'est ce que
  le banc doit dire.)*

  **Vérifié NON défectueux, pour que la garde soit exhaustive et non choisie** : `hp` atteint bien
  son max quand le Feu brûle (la décroissance est conditionnée à `fuel <= 0`) ; `npc.energy` est
  clampé à 100 mais aucune garde ne compare à 100 ; faim, endurance et file de craft comparent à
  un coût ou à une présence, jamais à un plein ; et les fenêtres modulo du tableau
  (`BOARD_REFRESH_TICKS = 100`, les cadences de chantier et d'eau) sont toutes des multiples de
  100, donc tombent exactement sur un rafraîchissement.

  **Trouvé au passage, hors périmètre de la passe, à ne pas perdre** : `npc-errands.ts` teste
  « à l'aube » par un modulo BRUT du tick alors que le jeu joué démarre à **9 h**
  (`cycleOffset`) — le décrochage des raiders et le don du Foyer tombent donc à l'heure de départ,
  pas à l'aube ; son voisin d'à côté avait été corrigé et son propre commentaire décrit le piège.
  Jumeau restant : `meteo.ts:809`.
- **P-A3 — LE RYTHME DU FEU EST UNE DÉCISION ÉCRITE, pas un effet de bord.** Aujourd'hui le Feu
  est maintenu au maximum **par accident** : la garde du plein étant inatteignable, un villageois
  reste collé au Feu en permanence et y verse une bûche entière — dix minutes de flamme — pour
  racheter un vingtième de seconde. MESURÉ : 75 des 92 `fire_fed` de la graine 2026 tombent dans
  un Feu déjà plein. Le critère est rempli quand le gaspillage a disparu **et** que la façon dont
  le village garde son Feu est un choix consigné. Les durées réelles pour le trancher : un Feu
  plein tient **1 h 45** en saison douce et **52 min** au Grand Froid ; une bûche vaut **10 min 30**
  (5 min 15 au Grand Froid) ; du plein au seuil d'alerte, **1 h 03** — 32 min au Grand Froid.

  ✅ **LE VERROU EST LEVÉ — LES « 4 FEUX ÉTEINTS » SONT ATTRIBUÉS, ET CE N'EST PAS LE RYTHME.**
  MESURÉ le 2026-09-26 (`tools/__feu-rythme.mts`, worktrees isolés, météo armée, 3 jours, le
  relevé pris AU TICK MÊME de la mort — après la chute, les structures sont déshéritées et le
  grenier devient invisible). Deux bras :

  | bras | ce qu'il change | graines | Feux morts | dont VRAIS |
  |---|---|---|---|---|
  | **C — « par fournées »** | la terminaison devient atteignable (`CAPACITY − fuel < FEED_PER_WOOD`), le Feu court du plein au seuil | 2026 · 1 · 42 · 777 · 2027 | **4** | **1** |
  | **B — « gardien assumé »** | on ne verse jamais une bûche dans un trou plus petit qu'elle, et le villageois VEILLE au lieu de spammer l'action | 2026 · 777 | **1** | **0** |

  ⚠ **TROIS DES QUATRE MORTS DU BRAS C SONT DES VILLAGES EXTERMINÉS** — `vivants: 0/0` (graines 1,
  777, 2027), exactement l'angle mort dont la lettre de V-A9 vient d'être corrigée. Ce ne sont pas
  des défauts de rythme : personne ne marchait plus. **La quatrième est réelle et nommée** : graine
  42, les Braises Hautes, **`vivants: 1/1`** — un seul survivant, et **zéro bois au grenier au
  franchissement du seuil, zéro maximum depuis, zéro à la mort**. C'est une économie qui a échoué,
  pas un rythme : un homme seul ne ramène pas de quoi nourrir un Feu.

  ⚠ **ET CE CHIFFRE TUE L'OPTION « RÉSERVE DE BOIS »** (mettre N bûches de côté au grenier,
  intouchables par la construction) : la seule mort réelle s'est produite sur un grenier **vide
  depuis le franchissement**. Il n'y avait rien à réserver. La réserve résolvait un problème qui
  n'existe pas — retirée des options, mesure à l'appui, sans avoir coûté sa migration de sauvegarde.

  **CE QUI DISTINGUE ENCORE LES DEUX BRAS, mesuré :** sous le gardien le village vit au large —
  **1 franchissement** du seuil par village, combustible de fin 171 à 239 ; sous les fournées il
  vit au bord — **3 franchissements**, combustible de fin 143 à 168. Le choix n'est donc plus
  « lequel tue des Feux » (aucun des deux) mais **combien de bras le village consacre à son Feu**.

  ✅ **TRANCHÉ ET LIVRÉ le 2026-09-26 — LE GARDIEN ASSUMÉ (décision d'Alexis).** Le village
  consacre un bras à son Feu et le tient au large. Deux lignes, et la seconde n'est pas cosmétique :
  (a) `feedVillageFire` refuse un trou plus petit qu'une bûche — la garde se **dérive de
  `FEED_PER_WOOD`**, jamais de `CAPACITY`, parce que c'est `CAPACITY` qu'un tick de drain rend
  inobservable ; (b) `executeFeedFire` **rend la main** dans ce cas au lieu d'appeler l'action,
  sinon le gardien récolterait un `action_rejected` par tick — vingt par seconde et par gardien
  dans un flux qui est un contrat, pas un log. Les deux seuils sont le MÊME, et deux seuils qui se
  désaccorderaient rouvriraient le gaspillage qu'on ferme.

  ⚠ **ET LA GARDE A DÛ ÊTRE REFAITE — LE PIÈGE MÉRITE D'ÊTRE ÉCRIT.** La forme évidente (juger
  chaque nourrissage en remontant de `fuel`, que porte l'événement, à la place qu'il y avait avant,
  par soustraction du bois versé) est **structurellement aveugle** : `feedVillageFire` ÉCRÊTE
  (`Math.min(CAPACITY, …)`), donc dans le cas gaspilleur `fuel` vaut exactement `CAPACITY` et la
  soustraction rend toujours `room = FEED_PER_WOOD` pile. MESURÉ : cette garde-là était **verte sur
  le code fautif**, 35 versements tous reconstruits à « 24,000 de place ». La loi qui tient est une
  **conservation** — sur la fenêtre, le bois versé ne peut pas dépasser ce que le Feu était capable
  d'absorber (son déficit de départ, plus ce qu'il pouvait brûler), tout dérivé de `balance.ts`.
  Ainsi écrite elle est **rouge sur `152401a` : 40 bûches versées en 3 000 ticks, 35 versements dont
  33 d'affilée, pour 7,5 absorbables** — et verte après, avec une marge de 5×.

  ⚠ **UN TEST EXISTANT ENCODAIT LE GASPILLAGE DANS SON CORPS TOUT EN S'APPELANT « pas de
  gaspillage »** (`upkeep.test.ts`) : il posait un Feu à `CAPACITY − 1` et exigeait qu'une bûche
  entière y soit engloutie pour racheter un point. Réécrit aux trois tailles de trou — plus petit
  qu'une bûche (refusé, et le refus est DIT au joueur, sinon il croirait avoir nourri son Feu), la
  place d'une bûche exactement (accepté, plafonné pile), un grand trou (plusieurs bûches, jamais
  au-delà de la capacité — la garde d'origine, qui reste vraie).
- **P-A4 — LE COÛT DU VILLAGEOIS EST ATTRIBUÉ, PUIS BAISSÉ.** ✅ **ATTRIBUÉ le 2026-09-26**
  (`perf`, graine 2026, `MONDE_JOUE`, 1581×1700, 190 762 nœuds, 5 villages × 3 = 15 PNJ, témoin
  inerte à 0 village, **hors `tsx`** — bundle esbuild + `node` nu, donc la majoration de 25 % de
  `tsx` ne s'y applique pas). Trois corrections, et la troisième déplace le chantier.

  ⚠ **① LE 1,36 ms/VILLAGEOIS ÉTAIT L'AMORÇAGE DU VILLAGE, PAS SON RÉGIME DE CROISIÈRE.** Il
  venait de `profil-tick 50 500` — **les 500 premiers ticks**. Sur cette même fenêtre la re-mesure
  donne 1,499 : le chiffre était bon pour ce qu'il mesurait. Mais le coût réel vaut **0,898 ms**
  tous régimes confondus et **0,768 à midi, en croisière** — l'amorçage coûte ~1,7× la croisière.
  *Conséquence directe sur `ascension.md` : la projection « dix villages = 48 ms, 97 % du budget »
  était bâtie sur le chiffre d'amorçage. Recalculée en croisière, dix villages (30 villageois)
  pèsent ~29 ms, soit ~58 % du budget. **« Beaucoup de villages en bas » n'est plus interdit par la
  moyenne.*** ⚠ Mais voir ③ : ce n'est plus la moyenne qui borne.

  ⚠ **② JOUR ET NUIT SONT INDISTINGUABLES SUR LA MOYENNE** — 0,886 contre 0,907, +2,4 %, quand le
  plancher de bruit de l'instrument mesuré sur le MÊME travail (`rngState` identique) vaut **5,4 %**.
  L'écart est sous le bruit. Les « `advanceNpcs` à 85-94 % du tick » des régressions du 21/09
  n'étaient donc pas un régime de moyenne : c'était un PIC.

  ⚠ **③ ET C'EST LE PIC LE PROBLÈME, PAS LA MOYENNE. LE TICK OÙ LA NUIT TOMBE COÛTE 517,6 ms.**
  Au tick près, avec le témoin : **tick 15505 = 517,58 ms à 5 villages, 5,12 ms à zéro village.**
  Les ticks voisins coûtent 18-20 ms. **Un gel de 10,4× le budget, une fois par cycle**, et
  village-causé sans ambiguïté. Plus **quatre ticks de fin de nuit à 148-157 ms** (~3× le budget),
  là où le témoin ne dépasse jamais 49 ms. La « pire seconde à 95,6 % du budget » n'est que la
  moyenne de ce gel unique sur vingt ticks — **ce qu'on ressent, c'est le gel**. La cause reste
  **SUSPECTÉE** : deux lignes de `pathfinding.ts` passent de zéro à un delta net sur cette tranche
  (dont l'index d'occupation que **chaque** appel d'A\* rebâtit), plus l'alarme de
  `worldevents.ts` — compatible avec « la nuit tombe, les oisifs se replient au Feu et une horde se
  planifie, tous sur le même tick d'égalité ». Il faut un profil de ce seul tick.

  ⚠ **LE SUSPECT ÉCRIT ÉTAIT À MOITIÉ FAUX, et le vrai premier poste n'était pas dans la liste.**
  Attribution par ligne dans `advanceNpcs` (parts fermes ; les ms de cette passe-là sont invalides,
  machine chargée — mais toutes les fonctions d'une même tranche ont subi la même charge au même
  instant, et l'ordre est le même aux deux niveaux de charge) :

  | ligne | ce que c'est | jour | nuit | verdict |
  |---|---|---|---|---|
  | `alignment.ts:90` | `isThreatTo` → `state.monsters.some(…)`, atteint par `handleDefense` (`npc.ts:1460`) | **35,1 %** | **46,4 %** | **LE PREMIER POSTE, et il n'était pas soupçonné** |
  | `npc.ts:750` | `state.nodes.find(n => n.id === task.nodeId)` | **21,7 %** | 11,1 % | **CONFIRMÉ — mais c'est une recherche par ID, pas un balayage par zone** |
  | `npc.ts:269/:270` | le balayage des 190 762 nœuds de `nearestAliveNode` | 3,1 % | 4,9 % | **INNOCENTÉ pour l'essentiel** — le suspect principal de la spec était le plus petit des trois |
  | `npc.ts:1113`, `:1165` | les `find` d'`executeBuild` | **0** | **0** | **INNOCENTÉS, mesurés NULS** (zéro échantillon sur ~1,2 M) |
  | `executeFeedFire` | le Feu | ≈ 0,0 % | ≈ 0,0 % | le gaspillage coûtait du BOIS, pas du temps |

  **Le mécanisme du premier poste** : `handleDefense` boucle sur **tout `state.entities`** (142) et
  appelle `isThreatTo` pour chacune **avant** le filtre de distance au Feu ; `isThreatTo` commence
  par un `state.monsters.some(…)` sur 127 à 157 monstres. Soit ~300 000 comparaisons par tick à
  quinze villageois — et `handleDefense` tourne pour **chaque villageois éveillé, à chaque tick,
  quelle que soit sa corvée** (donc le correctif du Feu ne le déplace pas). **Le même motif existe
  une seconde fois**, `worldevents.ts:409`, par village, pour l'alarme.

  ⚠ **ET N'ATTENDS PAS DE CE CORRECTIF QU'IL EFFACE LE COÛT DU VILLAGEOIS.** `advanceNpcs` ne
  vaut que ~40 % du surcoût le jour et ~28 % la nuit ; **les 8 à 10 ms/tick restants sont induits
  HORS `advanceNpcs`** — `advanceEconomy` et `advanceMonsters` pèsent 26 % du tick chacun — et ils
  ne sont **pas décomposés**, faute d'un profil du témoin. Corriger `isThreatTo` vaudrait, en ordre
  de grandeur, **1,8 à 3 ms/tick**. Et le témoin rend le code PNJ inerte, pas le MONDE : à zéro
  village le monde porte 127 monstres constants, à cinq il en porte 128 à 157 (le décompte
  d'entités décale le flux du PRNG), donc le Δ inclut une population de monstres différente —
  MESURÉ pour la taille, SUSPECTÉ pour la cause.

  **CE QUI RESTE À FAIRE, dans cet ordre** : (a) un profil propre, jour et nuit, avec le profil du
  témoin — aucun régime n'a encore été profilé au calme ; (b) une fenêtre serrée sur le **seul tick
  15505**, pour prouver la cause du gel ; (c) l'A/B d'`handleDefense` — **remonter le filtre de
  distance au Feu AVANT `isThreatTo`**, identique au bit par construction puisque le test de
  distance est pur et déjà présent deux lignes plus bas.
