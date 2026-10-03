# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ASHES

*(ex-BRAISES — renommé le 2026-07-28, jusqu'aux paquets (`@ashes/*`) et au GDD (`ashes-gdd.md`). **Les clés de stockage, elles, restent en `braises`** — base IndexedDB, brouillard, son, touches : ce sont des ADRESSES, et les renommer orphelinerait toutes les sauvegardes existantes. Et « braises » reste du vocabulaire de jeu : un feu qui couve est en braises.)*

Survival top-down 2D **solo / coop**. On naît en bas d'une vallée de montagne et le jeu pousse à **monter d'étage en étage** : la **braise** qu'on porte tient le froid (une barre de *crans* qui dit jusqu'où on peut monter, et qui se vide du haut), les **balises** qu'on allume avec elle sont les bases et la rechargent, et la **saison est la marée** qui ouvre et referme les paliers — un étage vaut une saison, donc un hiver au palier *k* est un été au palier *k+1*.

⚠ **LA CIBLE A CHANGÉ LE 2026-09-28** (décision d'Alexis, « définitif »). Les sources de vérité du design sont désormais, dans cet ordre : **`docs/specs/braise.md`** (le cœur), **`docs/specs/ascension.md`** (la colonne vertébrale), puis **`ashes-gdd.md`** — dont **deux des trois piliers du §1 sont morts** (« le village est le personnage », « la morale est une mécanique »), ainsi que le §3 entier (l'alignement) et le cadre multi persistant de la fiche d'identité. Le GDD porte en tête un bandeau qui dit ce qui survit. **Sortent du jeu** : les villages PNJ, l'alignement comme moteur, les vêtements de froid, la saison persistante multi. La **nourriture n'est plus une survie** (elle applique des buffs thématiques) et le **combustible est la seule monnaie de survie**. Les quatorze décisions : `grep 2026-09-28 docs/decisions.md`. Le critère d'arbitrage d'Alexis, qui vaut plus que n'importe quelle ligne de doc : *« j'adore les jeux élégants dans leurs mécaniques : un gameplay profond lorsqu'on le maîtrise. »*

## Commandes

```bash
pnpm install      # workspace complet
pnpm check        # tsc --noEmit sur tous les packages
pnpm test         # LES QUATRE SUITES — sim, client, serveur, banc de scénario (tools/suites.mjs).
                  # Il juge sur les COMPTES de tests Vitest, pas l'exit code (flaky « onTaskUpdate » absorbé).
                  # CHAQUE SUITE A UN PLANCHER (SUITES dans suites.mjs) : une suite qui MAIGRIT
                  # fait rougir, même toute verte — c'est le fichier évaporé qu'on attrape. Retirer
                  # un test devenu faux est permis ; relever le plancher quand une suite a grossi.
                  # Un seul fichier : pnpm --filter @ashes/sim exec vitest run src/tir.test.ts
                  # LES CARTES DE TEST SONT EN CACHE (tools/carte-cache.ts) : `carteDeTest(...)`
                  # rend, au bit près, ce que rendrait generateZonedTerrain — mais une seule fois
                  # par (graine, joueurs, monde). Le cache se périme sur l'EMPREINTE de tout
                  # packages/sim/src : toucher /sim régénère. ASHES_SANS_CACHE=1 le court-circuite,
                  # et la suite doit rendre le même compte. Un test qui éprouve la GÉNÉRATION
                  # (déterminisme, budget A13) appelle generateZonedTerrain en direct — jamais le cache.
pnpm lint         # eslint, dont les garde-fous de pureté de /sim
pnpm dev          # client Vite SUR L'HÔTE (jeu jouable sur http://localhost:3000)
pnpm --filter @ashes/server dev   # zone LAN Colyseus sur ws://localhost:2567
                                  # le client s'y branche par VITE_SERVER_URL
pnpm scenario     # banc d'équilibrage. ⚠ IL NE JOUE PLUS UN TICK depuis le 2026-09-29 : ses
                  # deux gardes longues étaient gelées par FEATURES.VILLAGES_PNJ (26/09) puis
                  # supprimées avec SimState.npcs (tranche 3). Ce qui reste éprouve le MONDE
                  # CONSTRUIT (construireMondeDuBanc), pas le monde JOUÉ, et SCENARIO_DAYS ne
                  # commande plus rien. Le banc n'a jamais eu d'avatar : le rallumer demande
                  # d'abord de lui donner un corps. Coût MESURÉ, pour ce jour-là :
                  # runScenario 1 j = 132 s, 2 j = +315 s.
pnpm plans        # régénère plans-batis.genere.ts depuis packages/sim/src/plans/*.plan
                  # L'ATELIER — LE PORTAIL DE TOUS LES OUTILS WEB, une seule adresse :
                  # pnpm dev → http://localhost:3000/atelier.html (dev seulement, hors dist)
                  #   onglet PLANS (#plans) : l'éditeur graphique du bâti, spec atelier-plans.md
                  #   onglet SON   (#son)   : le banc d'écoute — le vrai routage audio sur le
                  #     vrai moteur, avec la distance et le côté (spatialisation).
                  #   onglet GI    (#gi)    : le banc de la lumière globale — chaque passe de la
                  #     chaîne relue au texel contre l'oracle sur une scène fixe, et le coût d'une
                  #     image sur le GPU qui l'ouvre (spec lumiere-globale.md LG-A1/A3/A14).
                  # Les outils se montent À LA DEMANDE : ouvrir #son ne boote pas Phaser.
                  # /banc-son.html reste et redirige vers #son.
# Stack Docker : `docker compose up -d` → jeu sur http://ashes.test via le proxy Traefik
# PARTAGÉ (~/projects/proxy, à lancer d'abord : cd ~/projects/proxy && docker compose up -d)
pnpm build        # build web statique → packages/client/dist
pnpm smoke        # pilote le VRAI jeu dans Chromium et rapporte ce qu'il voit
```

**Smoke test navigateur** — `tools/smoke.mjs`. Il bâtit, sert et éteint son propre serveur : rien à lancer à côté. Playwright est une devDependency du workspace et le navigateur vit **sous `node_modules`** (`pnpm smoke:install`, une fois) — aucune dépendance vers un cache partagé ni vers un autre dépôt.

- `pnpm smoke --scenario lieux` — un scénario nommé (voir `SCENARIOS` dans le fichier).
- `pnpm smoke --headed` — à l'œil, fenêtre ouverte.
- `pnpm smoke --dev` — contre un serveur de dev, **le seul mode où le debug est armé** : `veillee.ts` arme `debug` sur `import.meta.env.DEV`, donc TP/heure/invulnérabilité sont **inertes dans un build de production**. Un scénario qui se téléporte doit passer par là.
  ⚠ **il vise `http://ashes.test/` par défaut** — la stack Docker PARTAGÉE, donc le code d'une autre
  session. Pour éprouver le sien : `SMOKE_URL=http://localhost:3000/ pnpm smoke --dev …`.
  La recette complète (vite isolé, debug, capture) : skill **`verif-navigateur`**.

Le jeu s'expose via `window.__BRAISES__.scene` : le smoke test **lit** l'état, il ne le fabrique pas.

**Avant tout commit : `pnpm check`, `pnpm test`, `pnpm lint`** — les trois passent, plus le
`smoke --scenario` du système touché s'il se voit. Rapides : les lancer souvent.

**Pièges connus** (chacun a coûté une session) :
- Après un edit de `/sim`, des « timed out 30000ms » au 1er `pnpm test` sont le cache de cartes
  froid, pas des défauts : rejouer le fichier. Et ne jamais éditer `/sim` PENDANT qu'une suite
  tourne — elle écrirait une carte périmée sous une empreinte à jour.
- `smoke --dev` : éditer `packages/client` pendant le run déclenche le HMR, recharge la page et
  tue le scénario. Ne toucher que `tools/`.
- Une autre session peut tourner sur cet arbre : jamais `pkill -f <motif>` — garder le PID ou
  `fuser -k <port>/tcp`.

## Structure

```
packages/sim      ← TOUTE la logique de jeu. TypeScript pur, testé en unitaire.
packages/client   ← Phaser 4 + Vite. Rendu ISO, input, interpolation, HUD/menus DOM, prédiction locale.
                    scenes/ (le plus gros : WorldScene + scenes/world/ ses couches et FX ; scenes/ui/ en DOM) · render/ (couches,
                    éclairage, art procédural) · worker/ (la sim en Veillée) · audio/ · assets/
packages/server   ← Node + Colyseus. Boucle autoritative, rooms, replay-log (L1 fait). Persistance PostgreSQL encore à venir (Vallée).
tools/            ← les instruments. `smoke.mjs` (navigateur), `suites.mjs` (les 4 suites),
                    `plans-compile.mts` (= pnpm plans), `decisions-index.mjs` (l'index du
                    journal), et une batterie de sondes headless :
                    profileurs (`profil-tick`, `profil-banc`, `empreinte-sim`), diagnostics par
                    système (`diag-loup`, `diag-contagion`…), mesures (`mesure-bande`,
                    `apercu-carte`, `mesure-glanage`…). Ils vivent ICI et non dans /sim parce que le
                    lint y interdit `Date`/`performance`, or c'est de chronométrage qu'on a
                    besoin. `node --import tsx tools/profil-tick.mts`.
                    Une sonde JETABLE de session se nomme `tools/__*.mts` : gitignorée, elle meurt
                    avec la session ; ce qui doit survivre perd son préfixe et prend un nom.
docs/specs/       ← specs par système, extraites du GDD, avec critères d'acceptation
docs/decisions.md ← L'INDEX du journal des décisions (ADR léger). Les entrées vivent dans
                    docs/decisions/ — CINQ VOLETS par thème (monde-worldgen, rendu-da,
                    gameplay-systemes, interface-outillage, architecture-infra). L'index
                    chronologique de decisions.md est ce qui garde résolubles les renvois du
                    code, qui citent une DATE : `grep 2026-07-05 docs/decisions.md` rend les
                    entrées du jour, et la lettre de la bonne ligne dit le volet. ⚠ Les « ci-dessus »
                    du journal (32 entrées, supersession encodée par la POSITION) ne désignent PLUS
                    la ligne du dessus : pour 11 d'entre elles l'antécédent est dans un autre volet.
docs/superpowers/ ← notes et plans de conception détaillés (juillet 06→11, puis au fil des gros
                    chantiers), COMPLÉMENT de docs/specs/ :
                    encore amendés quand le système bouge (bannière « chiffres révisés » en tête) — donc
                    lire le bandeau avant les nombres, qui vivent dans le code et ses gardes.
```

## Invariants d'architecture — NON NÉGOCIABLES

Ils viennent du GDD §11 et §14 (« décisions actées »). Ne pas les rouvrir en session ; si l'un d'eux doit vraiment changer, c'est une décision utilisateur à consigner dans `docs/decisions.md`.

1. **`/sim` est pur.** Zéro import de Phaser, Colyseus, ou API Node. Il doit tourner à l'identique dans un Web Worker (mode Veillée solo) et sur Node (multi). Un lint ESLint fait respecter cette règle — ne jamais la contourner ni désactiver.
2. **`/sim` est déterministe — au bit près, entre moteurs JS.** Pas de `Math.random` (PRNG seedé dans `rng.ts`, état dans le `SimState`), pas de `Date`/`performance`/timers — le temps est le numéro de tick. Et pas de fonctions Math approximées (`sin`, `cos`, `pow`, `hypot`, `exp`, `log`, `**`…) : la spec ECMAScript ne garantit pas leur résultat d'un moteur à l'autre, or un replay enregistré dans un navigateur doit rejouer exactement sur Node. Opérations autorisées : `+ - * /`, `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`, les constantes. Même seed + mêmes inputs = même état ET même flux d'événements : contrats testés par `sim.test.ts`, `replay.test.ts` et `events.test.ts`.
3. **Serveur autoritatif, client bête.** Le client envoie des inputs et interpole des snapshots. Seule prédiction locale : le déplacement de son propre avatar.
4. **Pas de moteur physique** (ni Arcade ni Matter) : grille + AABB maison. Pathfinding : grille + flow fields pour les hordes.
5. **Tick fixe à `BALANCE.TICK_RATE_HZ`** — 20 Hz par dérogation actée (docs/decisions.md 2026-07-05 ; le GDD disait 10-15 Hz). Wind-ups de combat 300-500 ms, interpolation client d'un intervalle de tick.
6. **Persistance : PostgreSQL seul**, write-behind. Pas de Redis, pas de queue, pas de microservices. Infra : 1 VPS + Docker Compose — résister à Kubernetes.
7. **Une simulation, pas deux jeux.** Le solo (Veillée) = `/sim` dans un Worker ; le multi = `/sim` sur Node. Toute feature se développe dans `/sim` d'abord, headless, testée — le rendu vient après.

## Règles de travail

- **Équilibrage** : tout nombre d'équilibrage vit dans `packages/sim/src/balance.ts`, **jamais en dur dans un corps de fonction** — un nombre qu'on ne peut trouver qu'en lisant le code n'est pas réglable. Les valeurs sont des ordres de grandeur (GDD §15), calibrées en playtest. **Une exception, délibérée** : le réglage d'un générateur de carte vit à côté de son générateur — le bloc `export const X = {` en tête du fichier (`MONDE`, `RELIEF`, `EAU`, `SENTES`, `SET_PIECES`, `CREUX`, `ROCHE`, `SOCLE`, `EAUX_ZONES`, `COULEES`, `CLAIRIERE`, `CONTENU`, `POI_PLACEMENT`, `CENDRE`…) ; une nouvelle strate amène le sien — la ligne de partage est *comment on calibre* : `balance.ts` = ce qui se règle en JOUANT, les blocs du worldgen = ce qui se règle en REGARDANT UNE CARTE. Détail dans l'en-tête de `balance.ts`.
- **Catalogue du bâti** : toute pièce posable est UNE entrée du registre `PIECES` (`packages/sim/src/pieces.ts`) — `StructureType` en est dérivé (`keyof typeof PIECES`), et collision, client et Atelier en découlent. Ajouter une pièce = compléter le registre, pas toucher quinze fichiers (décision 2026-08-01 ; la palissade d'avant-registre avait coûté 19 fichiers). Les lieux (POI, grottes…) se COMPOSENT de ces pièces via les plans `packages/sim/src/plans/*.plan` — « tout en pièces, partout » (2026-08-10).
- **Événements de domaine** : tout fait de jeu discret et signifiant (spawn, récolte, don, premier sang, pacte…) est émis comme `SimEvent` (`events.ts`) au moment où la logique l'exécute. La chronique de saison est un *consommateur* de ce flux (le tableau du village et la réputation en étaient deux autres, partis avec les villages PNJ le 2026-09-29) — on n'instrumente jamais la logique après coup. Haute fréquence ≠ domaine : un déplacement n'est pas un événement.
- **État de sim JSON-sérialisable** : pas de classes, pas de `Map`/`Set` dans `SimState` — snapshot, transport Worker et persistance en dépendent.
- **Specs avant systèmes** : avant d'implémenter un système de jeu (combat, alignement, économie…), extraire/compléter sa spec dans `docs/specs/` avec des critères d'acceptation testables, puis implémenter contre ces critères.
- **Décisions** : toute décision de design ou d'architecture prise en session s'ajoute **en une ligne** — le format déclaré, `AAAA-MM-JJ — [domaine] Décision. (pourquoi, en quelques mots)` — à la fin de son volet dans `docs/decisions/`, puis `node tools/decisions-index.mjs` régénère `docs/decisions.md` (ne pas l'éditer à la main). Les 14 décisions fondatrices sont dans le GDD §14. *(Le format a dérivé : à la coupe du 2026-09-07, 34 entrées sur 740 tenaient en une ligne, la médiane pesait 2 Ko. Le journal est EN AJOUT SEUL — on ne réécrit pas l'existant, mais on ne l'aggrave pas.)*
- **Travail en équipe de spécialistes** : six rôles ont une définition permanente dans `.claude/agents/` (`perf`, `da-rendu`, `determinisme-sim`, `systemes-jeu`, `ui-access`, `eclaireur-etat`), chacun avec l'instrument qu'il possède. Le protocole — **contrat `MESURÉ`/`SUSPECTÉ`** (seul `MESURÉ` entre au journal), worktree obligatoire pour qui écrit, et la liste de ce qu'on ne sait PAS encore mesurer — vit dans `docs/sprint-aaa.md` § L'ÉQUIPE. On convoque un spécialiste quand il y a un instrument à lancer ou une spec à confronter, jamais pour brainstormer. **Tout item de backlog repris commence par `eclaireur-etat`** (lecture seule) : le backlog est souvent pessimiste — trois items donnés « à faire » étaient déjà construits.
- **Tests** : l'effort de test se concentre sur `/sim`. Chaque système livré arrive avec ses tests headless. Les bugs se reproduisent par un test `seed + inputs → état attendu` avant d'être corrigés.
- Le code et les docs du projet sont en **français** (comme le GDD) ; les identifiants de code en anglais.

## Roadmap — état courant

⚠ **La roadmap V0-V10 → LAN → Vallée → Saison 0 (`docs/roadmap.md`) décrit l'ANCIENNE cible.** Elle garde sa valeur pour le *séquencement* (sim-first, tranche verticale par jalon) et pour l'inventaire de ce qui est livré — pas pour la destination. *(Les dix documents de juillet-août qui l'accompagnaient — les sept audits, `axes-amelioration-phase2`, `direction-design`, `gate1-finition` — ont été **supprimés** le 2026-09-28 : ils décrivaient un jeu qui n'existe plus. Ils restent dans git, et le journal du jour les nomme.)* `docs/roadmap.md` garde son bandeau.

**Ce qui est acquis.** La Phase Veillée (V0-V10) est complète ; le **worldgen est le chantier le plus abouti du projet** (stratigraphie, flanc en quatre paliers, terrasses et rampes, réseau de sentes, lumière globale 2D) et la **carte actuelle est le MVP** — aucune zone neuve, aucun biome neuf (décision du 2026-09-19). `packages/server` + Colyseus sont substantiellement livrés et restent utiles pour la **coop** : l'invariant « une simulation, pas deux jeux » n'a pas bougé.

**Le chantier courant est `docs/specs/braise.md`**, et son ordre de construction est dans son § 3. **L'étape 1, `FROID_PAR_ETAGE`, est LIVRÉE le 2026-09-30** : monter refroidit de **28 °C par palier** (`TEMPERATURE.FROID_PAR_ETAGE`, l'amplitude de l'année — un étage vaut une saison), le terme vit dans le SOCLE **hors du facteur d'abri** (« l'altitude ne s'abrite pas », décision d'Alexis) et la demande se lira sur `airNonBorneAt`, une lecture d'air **non bornée** à côté de la lecture bornée qui reste l'ancre du corps. **L'ÉTAPE 2 EST LIVRÉE le 2026-10-02** : la garde de gel est LOCALE, avec ses **deux bornes par palier** — `plancherDuPalier` / `gelPossibleAuPalier` (« ici rien ne gèle ») et `plafondDuPalier` (« ici tout gèle », qui rend vrai *sans lire une température*). MESURÉ, en régime, A/B alterné dans un seul processus (`tools/profil-gel-bornes.mts`, qui chronomètre **les deux régimes de cendre** — voir plus bas pourquoi c'est obligatoire) :

| à midi, palier 0 | mi-Éclosion | mi-Ardeur | Pluies | Grand Froid |
|---|---|---|---|---|
| borne **serrée** | ×10,2 | ×9,5 | **×10,4** | ×1,08 |
| borne **élargie** | **×0,97** | **×12,9** | **×1,00** | **×1,09** |

**⚠ SEULES LES CASES EN GRAS SONT ATTEIGNABLES EN JEU, et mon premier tableau ne le disait pas.** Le monde ouvre au jour **61**, c'est-à-dire au premier jour des **Pluies**, et la cendre s'éveille au jour **91** : la borne serrée ne vit donc que pendant **les trente premiers jours, en Pluies**. Mi-Éclosion et mi-Ardeur ne sont jamais jouées avec elle. En jeu réel : **la vallée gagne en Pluies de l'an 1, puis plus qu'en Ardeur, pour toujours.** Le palier 3, lui, gagne ×8,0 à ×10,5 **aux quatre saisons et dans les deux régimes** — c'est le plafond, et c'est lui qui portait le vrai problème.

Le ×1,08 au Grand Froid en bas est **juste** : c'est le seul instant où le gel dépend vraiment de la lecture locale. L'altitude, elle, gagne **aux quatre saisons** — c'est le plafond. ⚠ **LE RÉGIME QUE LE JEU JOUE EST DATÉ, pas supposé** : `cendreAge` naît vide et ne se remplit qu'au premier franchissement de jour après le réveil de la cendre — **jour 91** (`max((CENDRE.ACTE_DEPART−1) × ACT_DAYS + 1, jourDeDepart)`), alors que le monde ouvre au jour **61**. Les **30 premiers jours de jeu** portent donc la borne serrée ; à partir du jour 92 elle est élargie pour le reste de la partie, `cendreAge` ne se vidant jamais.

⚠ **TROIS CHOSES QUE J'AVAIS ÉCRITES FAUX CE JOUR-LÀ, ET QUI SONT DÉMENTIES ICI.**

**① Le plancher n'était PAS un minorant, et le défaut est plus vieux que l'étape 2.** `expositionSansMeteo` retranche **cinq** termes (`biome − nuit − brume − fumerolle − cendre`) ; `plancherDuPalier` en omettait les deux derniers, qui sont des froids ≥ 0 — donc la porte affirmait « ici rien ne gèle » sur des gués réellement pris. **REPRODUIT avant correction** : **1 540 divergences** sur l'année (graine 2026, cendre vieillie ; 416 tuiles d'eau portent un souffle jusqu'à **8,09 °C**, aux paliers 0, 1 et 2, T jusqu'à −3,6 °C). Le trou était **vivant avant le 2026-09-30** (la porte coupait 120/240), le froid d'étage l'a **masqué** (0/240 — une porte qui ne coupe jamais ne peut pas se tromper), et l'étape 2 le **réveille** : *une borne qu'on rend utile redevient faillible*. Bouché par un majorant **dérivé de la table des caractères** (`FUMEROLLE.FROID × max(cadran froid) + CENDRE.FROID_COEUR`), et payé **seulement si la carte peut porter ces froids** — sans `map.cendreCout` ni `cendreAge`, la borne reste serrée au bit près. **C'est ce correctif qui coûte les deux ×1,0 du tableau** : passé le jour 91, le palier 0 ne récupère plus que mi-Ardeur. Les deux majorants ont des conditions DIFFÉRENTES (le souffle exige `cendreAge` non vide, le froid de cendre non — `profondeurNueDeCendre` lit `?? 0` et calcule quand même) : les gater ensemble était faux en droit, et la séparation ne coûte rien (les 2 °C de `CENDRE.FROID_COEUR` ne font basculer aucun cardinal).

**② Ma garde de prémisse ne pouvait pas échouer.** Elle appelait `sousLaRoche(sim, tx, ty)` à **trois** arguments, alors que la fonction s'ouvre sur `etage !== undefined && …` : elle rend **toujours faux** sans toucher la carte. Mon « 0 tuile sur 321 649 » était une **tautologie déguisée en mesure** — il est retiré. La prémisse se prouve maintenant en deux clauses, l'arité (`estGele` lit l'air sans `etage`, donc la branche grotte est structurellement inatteignable) et la carte (`terrainAEtage(map, −(p+1), …)`), la première servant de **contrôle positif** à la seconde.

**③ « Zéro tuile changée » n'était vrai que pour un monde sans cendre.** L'équivalence exhaustive (toute l'eau × 8 instants = 2,57 M tuiles) tourne sur un `createSim` dont `cendreAge` est **vide** : elle est structurellement aveugle à ①. Un montage qui ne porte pas la prémisse ne peut pas voir ce qui en dépend — d'où une garde séparée qui **vieillit la cendre** et balaie l'année entière (la fenêtre du défaut s'ouvrait au **jour 1**, qu'aucun des huit cardinaux ne visite).

**Les deux trous de couverture des bornes sont bouchés le 2026-10-03** (rapportés par `determinisme-sim` à l'audit de fusion ; aucun n'était un défaut de code, les deux étaient des preuves non jouées). ① **La météo** : tout le bloc des bornes tournait en `meteoActive: false`, donc ni « la météo ne peut que REFROIDIR » (le plafond) ni `effetOrage × intensite ≤ coldMaximal` (le plancher) n'avaient de test — or ces deux inégalités vivent dans `meteo.ts`. La garde neuve joue les **quatre classes de front × huit instants** en cendre vieillie et affirme le majorant dans sa forme LOCALE, **le minorant EN DIRECT** (⚠ indispensable : sous l'orage la porte ne coupe JAMAIS — 0 coupure contre 2 par classe ailleurs —, donc l'équivalence de `estGele` ne peut pas prendre la borne en défaut ; marge MESURÉE **2,0 °C**), l'équivalence de `estGele`, le **contact au bit** sous l'orage (22 °C appliqués = 22 retranchés : la marge du plancher est *exactement* nulle) et le contrôle négatif du brouillard. ② **La monotonie du plancher en palier** — toute la justesse de la délégation de `gelPossible` au plus haut palier : triviale avant `map.souffleMax`, devenue conditionnelle à `FROID_PAR_ETAGE > SOUFFLE_GLOBAL` (28 contre 12,6 ; marge minimale MESURÉE **28,0 °C**). ⚠ **Et ma première version de ② ne pouvait pas échouer** : elle affirmait une implication entre PORTES, dont le conséquent (`gelPossible`) est **une tautologie** — la porte du palier 3 est ouverte à tout instant de l'année. D'où la seule ligne de production du jour : **`plancherDuPalier` est exportée**, parce que la monotonie vit dans la VALEUR et qu'un SEUIL franchi à toute saison ne peut pas l'observer. Les deux gardes rougissent sous inversion de leur prédicat — contrôle positif joué.

⚠ **Et un dernier piège de mesure** : deux lots séparés d'un profileur mentaient de **×3,4** sur un *callee froid* — le bloc qui court-circuite partout ailleurs est le premier du processus à exécuter `baselineTemperature` (90,6 ms au 1ᵉʳ tour contre 11,1 en régime). D'où l'A/B alterné. Ce que ça coûte au client est **SUSPECTÉ**, non mesuré au navigateur.

**Cette piste est TRANCHÉE ET LIVRÉE le même jour, et le gain est PARTIEL** (`map.souffleMax`, décision d'Alexis : « on suit ta reco »). Le pire souffle de fumerolle est désormais **précalculé par palier** à l'amorce (`souffleMaxParPalier`, passe de queue du worldgen, **5,2 ms**) et retranché à la place des 12,6 °C globaux. Il est **indépendant de l'âge de la cendre** — c'est ce qui le rend précalculable : seul `auCoeurDeLaCendre` dépend du calendrier parmi les trois filtres de `fumerollesAutour`, et l'omettre donne les bouches *possibles*, dont l'éveillé est toujours un sous-ensemble. Il est **exact, assert au bit** : 8,09 / 8,09 / 9,75 / 9,75 °C, soit exactement le pire souffle que prend vraiment l'eau de chaque palier. **Ce que ça rend** : la porte recoupe **126 points de l'année sur 480 au palier 0 contre 74**, fenêtre de midi de **31 à 47 jours** sur 120, et le pire écran du palier 0 au jour 65 de l'an 2 passe de **66,4 à 5,7 ms** (×11,7 ; ×52 avec 800 structures) — A/B attribué par le témoin `ASHES_SANS_SOUFFLEMAX=1`, verdict de `estGele` inchangé. ⚠ **Mais ce n'est pas le remboursement complet** : 8,09 °C est le pire souffle VRAI du palier 0, donc aucun majorant par palier ne peut faire mieux, et **mi-Pluies (jour 75) reste ouvert à 66 ms**. Fermer les 73 jours restants demanderait un index **par tuile** (plafond mesuré : 260/480, et seulement aux heures chaudes) — **pas écrit, décision non prise**. Le champ absent (carte d'avant, façade client, banc) retombe sur le majorant global : plus lent, **jamais faux**.

**Et le second levier est pris le 2026-10-03 (« Go n2 ») : LES STRUCTURES S'INDEXENT PAR TUILE.** `isSheltered` balayait `state.structures` **deux fois par tuile** (`roofAt`, puis un `.some` pour `house`) — O(tuiles × structures) pour une question locale, et c'est ce qui faisait grimper la cuisson du pire écran de 66 ms à **286 ms sur une base de 800 structures**. Un index mémoïsé par **référence ET longueur** (`structuresDeLaTuile`, `village.ts` — `WeakMap` hors du `SimState`, le patron exact d'`indexDesConnecteurs`) la ramène à **61,0 ms à 800 structures, et PLAT en N** ; **au cœur de nuit — le pire instant, où aucune borne ne coupe — 60,0 ms à 0 structure contre 62,9 à 800**. Verdict de `estGele` inchangé partout. Il n'indexe que la TUILE (tout le reste du prédicat se relit sur l'objet) ; l'équivalence d'ordre est **prouvée** et non espérée ; ⚠ **la péremption a demandé QUATRE termes** — (référence, longueur) ne voit pas un `structures.length = 0` suivi de deux `push`, ce que fait `temperature.test.ts` à chaque tour de boucle, d'où l'identité du premier et du dernier élément, et **mon grep des verbes de mutation excluait les tests** : c'est l'oubli qui a coûté le rouge ; la portée est étroite et délibérée — `structureAt`/`solidAt`/`floorAt` nourrissent la collision et le pathfinding, donc le tick et le replay, et **l'index les attend sans les prendre de force**. ⚠ **Les 61 ms à zéro structure RESTENT, et ce ne sont pas les structures** : ce sont les froids de fumerolle et de cendre (les deux tiers de `baselineTemperatureAt`). L'index retire la croissance, pas le socle.

**LES ÉTAPES 3 ET 4 SONT LIVRÉES LE 2026-10-03 : LA BRAISE EXISTE.** `Entity.braise = { niveau, charge }` (un champ porté, pas un item du sac), `cransExiges` (B-R4) sur une **troisième lecture de l'air** — non bornée ET planchée par les feux, parce que ni `ambientTemperature` ni `airNonBorneAt` ne répondaient à B-R5 —, `cransCouverts` en `floor` (B-R7b : un cran ne vaut que plein, donc le palier de demande `N` se touche sans s'habiter), la vidange qui **ne court que quand elle couvre** (B-R8 : l'été en bas, la grotte et le pied d'un feu sont gratuits), et le corps qui ne lit plus qu'un **déficit en crans** (B-R6). La charge est un **budget de ticks entier** — la barre est donc exacte au bit. Dix-sept gardes (`braise.test.ts`), dont la table de B-R4b au cran près sur les quatre paliers aux deux solstices et `(N − d) × T` mesuré au tick près. ⚠ **Deux choses à savoir** : ⓐ **`airRessenti` est re-borné et la spec ne le disait pas** — sa formule nue rend −82 °C à quatre crans de retard, l'emballement même que B-R6 interdit ; conséquence, **au-delà d'un cran le déficit SATURE** (mourir au palier 3 sans braise n'est pas plus rapide qu'au palier 2), et un vrai gradient d'altitude serait une décision ; ⓑ **`tenue_hiver` écrase encore la braise** (elle plancher le déficit à −5,2 °C) jusqu'à l'étape 5, qui est la suivante. Détail : `braise.md` § 3 point 4 ⓐ→ⓘ.

⚠ **ET L'ÉTAPE 4 OUVRE UNE QUESTION DE DESIGN, non tranchée (`braise.md` § 5.11) : la braise rend l'avatar PLUS RAPIDE QUE LE LOUP.** En couvrant le froid elle lève le malus de `coldSpeedFactor` — sprint tenu MESURÉ à **4,880 t/s avec une braise qui couvre contre 4,744 braise vide**, pour un loup à **4,80** : R1 (« on ne distance pas des loups ») est dépassée de 1,7 %. *(⚠ 4,744 n'est pas la valeur d'avant la braise — c'est le régime « rien ne couvre » ; celle d'avant est encadrée, non mesurée : ] 4,744 ; 4,800 [.)* Trois issues (retoucher `WINDED_SPEED`, accélérer le loup, l'accepter) ; ma reco est la première. La garde A1quinquies mesure désormais les deux régimes et n'affirme que ce qui reste vrai.

**ET LA MOITIÉ BRAISE DE B-R11 A ÉTÉ AVANCÉE ICI** (`respawn` rend `braiseNeuve(niveau)` : l'échelle traverse la mort, la charge repart au plein ; la position « en bas » reste l'étape 9), parce que **rien ne recharge une braise avant la balise** — MESURÉ sur le monde joué (graine 2026, naissance, aucun input, météo éteinte, 14 jours, contrôle positif au tick près) : le froid ne mord que **14,9 %** des ticks en bas, les cinq premiers jours sont gratuits, la braise tombe sous un cran au **jour 67**, puis c'était **quatre morts en quatorze jours** — là où le corps d'AVANT la braise passait les mêmes 14 jours **sans perdre un PV**. ⚠ **Ce qui reste, et qui est la pression voulue par B-R16, pas un défaut** : sans balise le bas de la vallée devient létal vers le jour 67 (≈ 3 h de jeu) pour qui ne campe jamais au feu — camper ne coûte rien (B-R8). C'est l'étape 6 qui répond.

**L'AUDIT DE FUSION EST PASSÉ** (`determinisme-sim`, même jour) : **aucun défaut de logique** — charge entière sur 80 000 ticks, flux du PRNG et compte d'entités identiques au bit, migration conforme, champ bien pris dans le hachage de `replay.test.ts`. Trois **commentaires** faux corrigés, dont la justification de `CRANS_DEPART` **décalée d'un palier** (deux crans n'en couvrent qu'un sous `floor` : p0 seul en hiver, p0-p1 en été), et quatre gardes neuves (charge entière, sauvegarde AVEC le champ, « aucun monstre ne porte de braise », et **la météo** — un front ne peut qu'ajouter des crans : orage 24/32, brouillard 0, zéro baisse). ⚠ **Et quatre conséquences de design attendent un arbitrage** (`braise.md` § 5.13-16), dont **une à régler avant d'écrire la balise** : le cercle gratuit d'un feu ne vaut que **57 % de son rayon** (3,43 t sur 6 — `fireBubble` est linéaire et la demande ne tombe à 0 qu'au-dessus d'`AMBIANT_DOUX`), donc « camper ne coûte rien » cesse d'être vrai au-delà, et la balise hérite de cette géométrie.

**L'ÉTAPE 5 EST LIVRÉE LE 2026-10-03 : `tenue_hiver` ne planche plus rien** (B-R15). Une ligne de production et `TENUE_FLOOR` sortent ; les **six fichiers** que B-A9 nommait sont réécrits — « la tenue plancher » devient « la braise planche », et la garde du glacier affirme B-A9 au mot : **le vêtu meurt comme le nu, au bit**. L'objet, lui, reste craftable : B-R15 renvoie la chaîne chasse → cuir → couture à `cuir.md`, et ce n'est pas tranché. **L'étape suivante est la 6, la balise** — sans elle rien ne recharge encore une braise ; ⚠ et elle demande d'abord la réponse au § 5.13 (le rayon du feu), dont elle hérite la géométrie. Et la conséquence du froid d'étage sur l'eau est **tranchée** (2026-10-01, `braise.md` § 5.0) : **on garde** — rien à écrire, c'est une récompense de mobilité pour qui monte, et la braise barre par le FROID et non par la géométrie. Le détail mesuré (tableau refait, le premier était faux) : le lac était déjà un pont **une nuit par an** ; il devient **saisonnier au palier 1** (il rouvre en Ardeur) et **permanent aux paliers 2-3** ; le gué, lui, est pris dès le palier 1 et ne rouvre plus.

**Ce qui n'est plus la cible** : le GATE 2 multi, les MVP gouvernance et alignement, et l'ancien backlog de finition solo. La *question* du GATE 1 — « la boucle solo est-elle fun 5 sessions d'affilée ? » — reste la bonne ; c'est la boucle qui a changé.
