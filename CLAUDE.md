# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ASHES

*(ex-BRAISES — renommé le 2026-07-28, jusqu'aux paquets (`@ashes/*`) et au GDD (`ashes-gdd.md`). **Les clés de stockage, elles, restent en `braises`** — base IndexedDB, brouillard, son, touches : ce sont des ADRESSES, et les renommer orphelinerait toutes les sauvegardes existantes. Et « braises » reste du vocabulaire de jeu : un feu qui couve est en braises.)*

Survival multijoueur top-down 2D persistant, saisons de 60 jours, villages de joueurs, alignement émergent. La source de vérité du design est **`ashes-gdd.md`** — le lire avant tout travail sur un système de jeu.

## Commandes

```bash
pnpm install      # workspace complet
pnpm check        # tsc --noEmit sur tous les packages
pnpm test         # LES QUATRE SUITES — sim, client, serveur, banc de scénario (tools/suites.mjs).
                  # Il juge sur les COMPTES de tests Vitest, pas l'exit code (flaky « onTaskUpdate » absorbé).
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
pnpm scenario     # banc d'équilibrage : le vrai worldgen joué sur des milliers de ticks
                  # (SCENARIO_DAYS=60 pnpm scenario pour une saison entière)
pnpm plans        # régénère plans-batis.genere.ts depuis packages/sim/src/plans/*.plan
                  # L'ATELIER — LE PORTAIL DE TOUS LES OUTILS WEB, une seule adresse :
                  # pnpm dev → http://localhost:3000/atelier.html (dev seulement, hors dist)
                  #   onglet PLANS (#plans) : l'éditeur graphique du bâti, spec atelier-plans.md
                  #   onglet SON   (#son)   : le banc d'écoute — le vrai routage audio sur le
                  #     vrai moteur, avec la distance et le côté (spatialisation).
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
- `pnpm smoke --dev` — contre `pnpm dev`, **le seul mode où le debug est armé** : `veillee.ts` arme `debug` sur `import.meta.env.DEV`, donc TP/heure/invulnérabilité sont **inertes dans un build de production**. Un scénario qui se téléporte doit passer par là.

Le jeu s'expose via `window.__BRAISES__.scene` : le smoke test **lit** l'état, il ne le fabrique pas.

**Avant tout commit : `pnpm check`, `pnpm test`, `pnpm lint`** — les trois passent, plus le
`smoke --scenario` du système touché s'il se voit. Rapides : les lancer souvent.

## Structure

```
packages/sim      ← TOUTE la logique de jeu. TypeScript pur, testé en unitaire.
packages/client   ← Phaser 4 + Vite. Rendu ISO, input, interpolation, HUD/menus DOM, prédiction locale.
                    scenes/ (le plus gros : WorldScene + scenes/ui/ en DOM) · render/ (couches,
                    éclairage, art procédural) · worker/ (la sim en Veillée) · audio/ · assets/
packages/server   ← Node + Colyseus. Boucle autoritative, rooms, replay-log (L1 fait). Persistance PostgreSQL encore à venir (Vallée).
tools/            ← les instruments. `smoke.mjs` (navigateur), `suites.mjs` (les 4 suites),
                    `plans-compile.mts` (= pnpm plans), et une batterie de sondes headless :
                    profileurs (`profil-tick`, `profil-banc`, `empreinte-sim`), diagnostics par
                    système (`diag-loup`, `diag-raid`, `diag-recolte`…), mesures (`mesure-bande`,
                    `apercu-carte`, `trace-corvee`…). Ils vivent ICI et non dans /sim parce que le
                    lint y interdit `Date`/`performance`, or c'est de chronométrage qu'on a
                    besoin. `node --import tsx tools/profil-tick.mts`.
docs/specs/       ← specs par système, extraites du GDD, avec critères d'acceptation
docs/gate1-finition.md ← le backlog de finition solo priorisé (P0/P1/P2) — ce qui reste vraiment à construire
docs/decisions.md ← journal des décisions (ADR léger) — à tenir à jour
docs/superpowers/ ← notes et plans de conception détaillés (juillet 06→11), COMPLÉMENT de docs/specs/ :
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

- **Équilibrage** : tout nombre d'équilibrage vit dans `packages/sim/src/balance.ts`, **jamais en dur dans un corps de fonction** — un nombre qu'on ne peut trouver qu'en lisant le code n'est pas réglable. Les valeurs sont des ordres de grandeur (GDD §15), calibrées en playtest. **Une exception, délibérée** : le réglage d'un générateur de carte vit à côté de son générateur (`MONDE`, `RELIEF`, `EAU`, `SENTES`, `SET_PIECES`, `CREUX`, `CONTENU`, `POI_PLACEMENT`, `CENDRE`) — la ligne de partage est *comment on calibre* : `balance.ts` = ce qui se règle en JOUANT, les blocs du worldgen = ce qui se règle en REGARDANT UNE CARTE. Détail dans l'en-tête de `balance.ts`.
- **Catalogue du bâti** : toute pièce posable est UNE entrée du registre `PIECES` (`packages/sim/src/pieces.ts`) — `StructureType` en est dérivé (`keyof typeof PIECES`), et collision, client et Atelier en découlent. Ajouter une pièce = compléter le registre, pas toucher quinze fichiers (décision 2026-08-01 ; la palissade d'avant-registre avait coûté 19 fichiers). Les lieux (POI, grottes…) se COMPOSENT de ces pièces via les plans `packages/sim/src/plans/*.plan` — « tout en pièces, partout » (2026-08-10).
- **Événements de domaine** : tout fait de jeu discret et signifiant (spawn, récolte, don, premier sang, pacte…) est émis comme `SimEvent` (`events.ts`) au moment où la logique l'exécute. L'alignement, la chronique de saison, le tableau du village et la réputation sont des *consommateurs* de ce flux — on n'instrumente jamais la logique après coup. Haute fréquence ≠ domaine : un déplacement n'est pas un événement.
- **État de sim JSON-sérialisable** : pas de classes, pas de `Map`/`Set` dans `SimState` — snapshot, transport Worker et persistance en dépendent.
- **Specs avant systèmes** : avant d'implémenter un système de jeu (combat, alignement, économie…), extraire/compléter sa spec dans `docs/specs/` avec des critères d'acceptation testables, puis implémenter contre ces critères.
- **Décisions** : toute décision de design ou d'architecture prise en session s'ajoute en une ligne dans `docs/decisions.md`. Les 14 décisions fondatrices sont dans le GDD §14.
- **Travail en équipe de spécialistes** : six rôles ont une définition permanente dans `.claude/agents/` (`perf`, `da-rendu`, `determinisme-sim`, `systemes-jeu`, `ui-access`, `eclaireur-etat`), chacun avec l'instrument qu'il possède. Le protocole — **contrat `MESURÉ`/`SUSPECTÉ`** (seul `MESURÉ` entre au journal), worktree obligatoire pour qui écrit, et la liste de ce qu'on ne sait PAS encore mesurer — vit dans `docs/sprint-aaa.md` § L'ÉQUIPE. On convoque un spécialiste quand il y a un instrument à lancer ou une spec à confronter, jamais pour brainstormer.
- **Tests** : l'effort de test se concentre sur `/sim`. Chaque système livré arrive avec ses tests headless. Les bugs se reproduisent par un test `seed + inputs → état attendu` avant d'être corrigés.
- Le code et les docs du projet sont en **français** (comme le GDD) ; les identifiants de code en anglais.

## Roadmap — état courant

Le plan d'implémentation complet est dans **`docs/roadmap.md`** (jalons V0-V10 → LAN → Vallée → Saison 0, avec critères de sortie et gates). Le cadre vient du GDD §13.

**La Phase Veillée (V0-V10) est complète** (cœur posé le 2026-07-05, près de quarante specs dans `docs/specs/` ; calibrage et pivots poursuivis depuis — worldgen graphe-de-zones puis stratigraphie, construction Rust puis catalogue `PIECES`, récolte vivante, l'arc, lieux bâtis composés en pièces + Atelier des plans). En attente d'actions humaines : brancher Cloudflare Pages (`pnpm build` → `packages/client/dist`) et jouer le **GATE 1** (la boucle solo est-elle fun 5 sessions d'affilée ?). Ce qui reste **constructible** d'ici là est priorisé dans **`docs/gate1-finition.md`** — le lire avant de choisir un chantier solo. **Phase LAN — jalon L1 en cours** (voir roadmap — `packages/server` + Colyseus substantiellement livrés le 2026-07-18, une zone ; le protocole `packages/sim/src/protocol.ts` est déjà le protocole réseau, seul le transport change ; reste : validation à plusieurs et GATE 2). Le calibrage continue via `pnpm scenario`. *(État réel et pistes : `docs/audit-gameplay-phase1.md`, `docs/axes-amelioration-phase2.md`, `docs/direction-design.md`.)*

MVP gouvernance (Veillée/LAN) : rang unique + Chef + propriété individuelle. MVP alignement : deux axes + Foyer/Meute seulement.
