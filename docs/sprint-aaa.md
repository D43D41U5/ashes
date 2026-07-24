# Sprint POLISH AAA — porter l'existant au standard AAA

> **Mandat (Alexis, 2026-07-23).** Améliorer le jeu EXISTANT le plus loin possible — UX, UI, rendu, mapgen, feel de gameplay, gestion des sauvegardes, options — pour atteindre un **standard AAA**. **CONTRAINTE DURE : aucun NOUVEAU système de gameplay.** S'organiser comme un studio de 20 personnes (rôles/expertises), s'inspirer des meilleurs hits du marché, refontes profondes de la code-base autorisées.

## Le cadre

- **Ce qu'on fait** : polir, raffiner, approfondir, rendre plus beau/lisible/satisfaisant ce qui existe. Rendu (par la technique, pas des assets dessinés — on n'a pas d'artiste), UI/UX/juice, worldgen (déterministe pur), sauvegardes, options, feel.
- **Ce qu'on NE fait PAS** : de nouveaux systèmes/verbes de gameplay. (L'agriculture était le dernier.) On ne rouvre pas non plus le chantier IA-village (en pause).
- **Invariants non négociables** (rappel) : `/sim` pur et déterministe au bit près (pas de `sin/cos/pow`, pas de `Math.random`/`Date`, le décompte d'entités décale le PRNG) ; FX lumière pixellisés (alpha, pas taille) ; timing UI sur l'horloge Phaser ; palette encre+2 accents ; typo mono (`typography.test`). Vérifier à CHAQUE étape (`pnpm check`, tests, `lint`, smokes).

## Le process (production lead)

1. **Audit spécialiste** (fait) — 4 panels : rendu/atmosphère, UI-UX/juice, worldgen, saves/options. Chacun : références marché + audit code + liste priorisée d'améliorations buildables.
2. **Synthèse → backlog priorisé** (impact AAA × faisabilité × risque). Ci-dessous.
3. **Exécution en VAGUES** — une tranche verticale à la fois, menée au vert (tests + smoke) avant la suivante. Client-only d'abord (risque nul) ; `/sim` (worldgen) traité comme danger de déterminisme.
4. **Vérif visuelle** systématique au smoke pour tout ce qui se voit.

## L'ÉQUIPE — protocole permanent (mandat Alexis, 2026-07-24)

### Le constat qui fonde tout le reste

Sur quatre sessions menées en équipe : **quand un spécialiste a lu du code, il a produit du plausible-et-faux ; quand il a mesuré, il a produit du vrai.**

| Ce qui a été *lu* | Ce que la mesure a dit |
| --- | --- |
| Deux hypothèses de perf (boucle de repousse, `nearestAliveNode`) | **Fausses toutes les deux.** Le vrai coût : `findPath` à 40 %, l'index de collision rebâti à chaque appel → 8,8× de gain |
| Un audit recommandait de rétrécir la Racine | 1 nœud / 20 tuiles, 6-7 des 8-10 coins de chasse : recommandation **réfutée** |
| Le voile d'ambiance « bien réglé » | µ = 104,3 à l'heure dorée contre 93,5 à midi — **le crépuscule éclairait plus que le zénith** |
| Le gris `faint` « un peu discret » | 3,52:1 — **échoue au contraste AA** |
| Le loup vient et hurle, tests verts | Il ne **mord** jamais : la promesse centrale n'était pas tenue |

**Règle d'organisation qui en découle : un rôle mérite une définition permanente quand il possède un instrument que le dépôt sait faire tourner.** Les rôles sans instrument propre (systèmes, UI, éclaireur) le compensent par un **artefact de preuve** obligatoire — respectivement un test rouge, un calcul de contraste ou un garde-fou vu tomber, et une citation `fichier:ligne`.

### Le contrat de restitution

Tout constat porte une étiquette, et une seule :

- **`MESURÉ`** — avec la commande exacte et le nombre (ou le test rouge, ou la citation). **Seuls les constats `MESURÉ` peuvent entrer dans `docs/decisions.md`.**
- **`SUSPECTÉ`** — hypothèse sans instrument. Elle se dit franchement.

Ce contrat existe parce qu'une explication plausible est entrée au journal comme un fait et a dû être **barrée** (voir l'entrée du 2026-07-23 sur le banc de calibrage). Une hypothèse coûte plus cher que rien : on agit dessus.

### Le contrat d'isolement

Tout spécialiste qui écrit travaille en **worktree** (`isolation: worktree` dans sa définition, pas dans le prompt d'appel — donc impossible à oublier). Un panel de 19 agents a sali l'arbre partagé et modifié un fichier en cours d'édition ailleurs. L'éclaireur, lui, est en **lecture seule** : pas de worktree, pas de coût.

**Qui écrit quoi** : un spécialiste écrit quand le changement est **mécanique et isolable** (propager une teinte sur 25 occurrences, une migration, un renommage) ; il rend un **plan** quand le changement demande de tenir tous les invariants à la fois (déterminisme + RNG + palette + timing) — là, l'intégration revient au lead.

### Discipline de coût

**On convoque un spécialiste quand il y a un instrument à lancer ou une spec à confronter — jamais pour brainstormer.** Le seul panel qui a coûté sans rien rendre est celui qui a produit des avis.

### L'effectif et son instrument

| Rôle (`.claude/agents/`) | Instrument | Règle non négociable |
| --- | --- | --- |
| `perf` | `tools/profil-tick.mts` | Aucune hypothèse par lecture. On profile, puis on parle. |
| `da-rendu` | `pnpm smoke` (35 scénarios), dont `etalonnage` (µ/σ/σ-sur-µ sur les pixels rendus) | Un constat de rendu arrive avec des nombres, ou il n'arrive pas. |
| `determinisme-sim` | Canaris `sim`/`replay`/`events` + lint de pureté | Liste de contrôle mécanique, jamais discrétionnaire. |
| `systemes-jeu` | `docs/specs/` et leurs critères d'acceptation | Aucun bug déclaré sans **test rouge d'abord**. |
| `ui-access` | `palette.test`, `typography.test`, `css-template.test`, calcul WCAG | « Lisible » est un calcul. Un garde-fou se prouve **dans les deux sens**. |
| `eclaireur-etat` *(lecture seule)* | — (discipline) | Chaque affirmation porte son `fichier:ligne`. |

### Ce qu'on ne sait PAS mesurer — la liste qui dit qui recruter ensuite

Un rôle sans instrument ne rend que du goût. Trois trous connus, par ordre de coût :

1. **Le banc d'équilibrage tourne sur une carte fantôme.** Il n'appelle pas `placeHuntingGrounds` : il juge la faim dans un monde où l'on ne peut pas chasser. **Tous les seuils de famine sont calés contre un fantôme.** La migration est écrite et le chantier de perf l'a rendue plausible ; elle n'a jamais été validée de bout en bout.
2. **Le feel temporel n'a aucun instrument.** Les bêtes *glissent* — pas de terme temporel dans la synchro des acteurs — et rien dans le dépôt ne sait mesurer ça. Un « DA animation » convoqué aujourd'hui ne rendrait que du goût.
3. **Aucune mesure de l'engagement.** « La map t0 pousse-t-elle à explorer ? » n'a pas d'instrument — seulement le GATE 1, c'est-à-dire Alexis.

### Ce qui ne se délègue jamais

Une **conséquence de jeu** (difficulté, létalité, ce qu'on voit venir, ce qui devient invisible) n'est pas un arbitrage technique. Le spécialiste la **prouve et la chiffre** ; Alexis tranche. Les correctifs purement techniques, eux, restent du ressort de l'équipe.

## Backlog priorisé

### Vague 1 — les plus gros leviers, client-only, risque nul — **LIVRÉE (7 tranches)**

V1.1 jus craft/niveau · V1.2 ombres acteurs · V1.3 ombres nœuds · V1.4 garde-fou d'effacement ·
V1.5 vignette · V1.6 mouvement réduit global · V1.7 indicateur de sauvegarde. Détail au journal
ci-dessous et dans `docs/decisions.md`.

### Vague 2 — DIRECTION ARTISTIQUE (panel élargi, mandat Alexis 2026-07-24)

Trois DA en revue **sur captures réelles**, lecture seule : (a) sprites & pixel art — lisibilité,
silhouettes, **paires de zones confusables** ; (b) menus & écrans — grammaire partagée, hiérarchie,
contraste ; (c) HUD & UI en jeu — design d'information, épreuve du coup d'œil, lisibilité sur fond
variable. Contrainte dure rappelée à chacun : **aucun asset dessiné à la main** (pas d'artiste au
projet) — tout doit être atteignable par la technique. Toute teinte hors « encre + 2 accents » est
remontée comme décision d'Alexis, jamais appliquée d'office.

### Vague 3 — WORLDMAP GEN (`/sim`, déterministe) — **priorité demandée**

Audit d'architecture fait (pipeline, points de consommation du PRNG, état réel vs backlog).

**La règle de survie a été CORRIGÉE par la mesure, et elle était trop peureuse.** On croyait que
tout changement de worldgen risquait de décaler le flux PRNG et de casser des tests sans rapport.
Vérifié dans le code : **faux pour ce domaine.** Les trois canaris (`sim`, `replay`, `events`) ne
construisent jamais de carte générée — ils retombent sur `createEmptyMap`. Un changement de worldgen
**ne peut pas** les casser ; il rebaseline les tests de worldgen, ce qui est le comportement attendu.
Tout l'aléa de génération est d'ailleurs déjà positionnel et salé (`hash2(x, y, seed ^ CONSTANTE)`),
hors du PRNG partagé.

**Ce qui reste réellement sensible**, et qu'il faut surveiller à chaque tranche : (1) tout ce qui
change la **marchabilité** ou le **type de terrain** (le semis de nœuds, l'habitat de faune et les
emplacements de village s'y accrochent) ; (2) le **nombre de POI**, qui commande le nombre de bêtes
de lieu — donc le flux, dès le tick 0 ; (3) le banc `pnpm scenario`, qui tourne **encore sur la carte
LEGACY** : les nombres d'équilibrage sont mesurés sur une carte que plus personne ne joue. Angle mort
à traiter avant toute recalibration.

### Vague 4 — LA RACINE (T0) ENGAGEANTE — **mandat Alexis 2026-07-24**

*« La map T0 doit être engageante et pousser à l'exploration, par nécessité comme pour le plaisir
de découvrir. »* Audit d'abord (le backlog ment par pessimisme). Ce qu'il a établi :

- **La nécessité est DÉJÀ bien construite** — le charbon n'existe pas dans la Racine, donc pas de
  fer, donc pas de palier 3 sans expédition ; le Feu palier 3 exige **trois zones**. La géographie
  EST la porte. Rien à refaire de ce côté.
- **Le plaisir, lui, manquait entièrement.** La Racine était la SEULE zone du jeu **sans skyline** :
  ses cinq lieux plafonnent à 50 px quand la canopée fait 44 — aucun ne perce, donc rien ne se voit
  venir, donc rien n'indique une direction.
- **Deux de ses cinq lieux ne font RIEN** (`verger`, `bivouac` : aucune charge, aucun contenu).
- **Le teaser de fer est introuvable par construction** : un `ResourceNode` (jamais dans `knownPois`),
  posé à la tuile la plus lointaine d'une zone de ~820 000 tuiles.
- **Six minutes de traversée** pour une densité d'événements calibrée à la baisse (`PAS_SEMIS` ÷5).

### File d'attente — décisions d'Alexis (regroupées, jamais tranchées seul)

Étalonnage couleur · couche de tokens (≈250 hex en dur, 2 ambres + 3 rouges divergents) ·
sort du gris `faint #6f6a60` (échoue au contraste). Les trois touchent la grammaire de palette,
qui est un invariant d'architecture — donc une conversation, pas trois interruptions.

## Journal du sprint
_(chaque tranche livrée = une ligne, comme decisions.md)_

- **V1.4 — GARDE-FOU d'effacement sur « nouvelle Veillée »** (saves). Le bouton du menu pause effaçait la partie au PREMIER clic, sans retour, à côté de « REPRENDRE ». Confirmation explicite (rouge d'alerte) qui nomme ce qu'on perd ; désarmée à la fermeture. Pas de garde-fou à la stèle de fin de saison (rien à protéger). Deux bugs attrapés par la CAPTURE et non l'assertion (`[hidden]` écrasé par `display:flex` ; confirmation sous le pli). Détail : `docs/decisions.md`.
- **V1.3 — les ombres de contact s'étendent aux NŒUDS** (rendu #1b, décidé sur capture). La futaie flottait encore autour d'un avatar posé : même fonction, pool parallèle au `nodePool` servi/libéré par le même compteur. Décor plat toujours exclu.
- **V1.2 — OMBRES DE CONTACT sous les acteurs** (rendu #1). Les billboards flottaient ; une flaque sombre bakée en NEAREST les pose au sol. Noir en alpha normal (pas MULTIPLY), CENTRÉE (pas de `sunDirection` — ce serait la promotion de l'éclairage dynamique, réservée à Alexis), constante. Posée depuis `syncActor` via `setData('shadow')` — un seul point, joueur + autres. Bornée aux ACTEURS ; troncs = suite, décor plat = jamais. Smoke `ombres`. Détail : `docs/decisions.md`.
- **V1.1 — JUS des boucles FABRIQUER / MONTER DE MÉTIER** (audit UI/UX P0, « le trou le plus visible au regard du standard AAA »). Deux bandeaux dédiés, branchés sur `item_crafted`/`skill_level_up` (jamais le clic), signature plus lourde qu'une récolte (chip **FABRIQUÉ**, bandeau doré 2 lignes **NIVEAU**), lueur du palier gatée reduced-motion. Libellés de métier dédupliqués (`ui/skill-labels.ts`). Smoke `juice` (fige la boucle Phaser pour capturer les toasts malgré l'horloge headless rapide). Client-only, zéro `/sim`. Détail : `docs/decisions.md`.
- **V1.6 — MOUVEMENT RÉDUIT, garde-fou GLOBAL** (accessibilité). 2 modules sur ~11 respectaient `prefers-reduced-motion` ; une règle unique dans `index.html` couvre tout l'existant ET le futur. Écrase la DURÉE (0.01ms) et non `none`, sinon `transitionend` ne se déclenche plus et le voile de mort — qui n'a pas de timer de secours — resterait à l'écran. Smoke `mouvement` prouve la règle dans les deux sens + rejoue le cycle du voile.
- **V1.5 — VIGNETTE** (rendu #2, moitié libre). Bords assombris vers l'encre : l'image gagne un centre. En DOM (un post-FX Phaser risquait de rendre blanc sous swiftshader = perte du juge visuel). N'ajoute AUCUNE teinte — l'étalonnage, lui, est différé à Alexis (invariant « encre + 2 accents »). Assertion : `elementFromPoint` au centre renvoie le CANVAS (sinon la vignette mangeait tous les clics monde).
- **V4.3 — le VERGER SAUVAGE porte de vrais fruits.** 2 des 5 lieux de la Racine étaient des noms sans contenu. Le verger sème de VRAIS buissons récoltables (`hash2` salé `'VERG'`, zéro tirage partagé) ; le test MESURE que le lieu paie. **Décision de NE PAS faire** : le `bivouac` devait recevoir `repit` — vérification faite, **rien ne consomme `repit` dans tout le projet**, donc ça aurait créé un 3ᵉ nom vide. Devise non implémentée à l'échelle du jeu = chantier à part.
- **V4.2 — LE GRAND CHÊNE : la Racine cesse d'être la seule zone sans horizon.** Repère unique, 92 px pour une canopée à 44, qui **ouvre la carte alentour** quand on l'atteint. `SIGHT_TILES` 14 → 30 (on découvrait un lieu déjà visible ; pire, le sol se dévoilait AVANT le monument). Trois défauts attrapés par les tests : `cap: 1` posait DEUX chênes (d'où `unique?: boolean`, la notion qui manquait), trois garde-fous de roster à mettre à jour, et **le lieu était placé et invisible** (pas de fonction de dessin) — seul le smoke l'a vu, d'où `poi-art.test.ts` qui rend la classe de bug impossible.
- **V4.1 — LE BROUILLARD DE GUERRE (R19)**, décision d'Alexis de juillet restée non codée. La vallée ne se donne plus : 0,05 % connue au spawn, marcher l'ouvre (mesuré dans les deux sens). Module pur (9 tests), persistance tassée à 1 bit/cellule. « ARPENTÉ : < 1 % » retourne le noir en jauge — sans quoi la première ouverture se lit comme une panne.
- **V3.1 — WORLDGEN : le test de rejouabilité MENTAIT** (premier geste du chantier : mesurer, pas construire). A8 signait sur les *slugs*, or `melange` permute les identités — il lisait une permutation d'étiquettes comme de la variété. Mesuré sur 24 seeds : **topologie 1**, déplacement max **2,5 %** de la carte, identités **24/24**. Une vallée, 24 baptêmes. A8bis épingle l'état réel ; sa chute future prouvera que la variété est arrivée. **Croyance corrigée** : le worldgen ne peut PAS casser `sim`/`replay`/`events` (leurs canaris tournent sur `createEmptyMap`) — je le sur-freinais.
- **V2.1 — TROIS ÉCRANS EN TIMES NEW ROMAN** (panel DA). `font-family:inherit` sur `document.body`, qui ne déclare aucune police. Le garde-fou ne testait que `fontFamily:` (camelCase Phaser) : vert sur un jeu à deux polices. Corrigé + 3 garde-fous neufs (dont un anti-backtick prouvé dans ses trois états, sa 1re version étant un faux vert). Passe de mise en page couplée : grille, rangée d'actions collante (REPRENDRE était sous le pli), fond opaque.
- **V1.7 — INDICATEUR DE SAUVEGARDE** (saves). La sauvegarde était déjà solide (autosave 30 s, écriture à la sortie) mais MUETTE. L'hôte répond `saved {at, ok}` ; le HUD dit « partie sauvegardée » (fugace) et « SAUVEGARDE IMPOSSIBLE » (rouge, permanent) — un échec silencieux est pire que pas d'indicateur. Testé de bout en bout (ESC → écriture réelle → message → HUD). Ajout de TYPE seul dans `/sim`.
