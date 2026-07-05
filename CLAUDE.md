# BRAISES

Survival multijoueur top-down 2D persistant, saisons de 60 jours, villages de joueurs, alignement émergent. La source de vérité du design est **`braises-gdd.md`** — le lire avant tout travail sur un système de jeu.

## Commandes

```bash
pnpm install      # workspace complet
pnpm check        # tsc --noEmit sur tous les packages
pnpm test         # vitest sur tous les packages (aujourd'hui : /sim)
pnpm lint         # eslint, dont les garde-fous de pureté de /sim
pnpm dev          # client Vite (jeu jouable sur http://localhost:3000)
pnpm build        # build web statique → packages/client/dist
```

Pour un smoke test navigateur headless : le Playwright du projet Manif est réutilisable (`/home/alexis/projects/demo/node_modules/playwright-core`), voir l'historique git de V2.

Les trois dernières doivent passer avant tout commit. Elles sont rapides — les lancer souvent.

## Structure

```
packages/sim      ← TOUTE la logique de jeu. TypeScript pur, testé en unitaire.
packages/client   ← Phaser 4 + Vite. Rendu, input, interpolation, UI. (placeholder)
packages/server   ← Node + Colyseus. Boucle autoritative, rooms, persistance. (placeholder)
docs/specs/       ← specs par système, extraites du GDD, avec critères d'acceptation
docs/decisions.md ← journal des décisions (ADR léger) — à tenir à jour
```

## Invariants d'architecture — NON NÉGOCIABLES

Ils viennent du GDD §11 et §14 (« décisions actées »). Ne pas les rouvrir en session ; si l'un d'eux doit vraiment changer, c'est une décision utilisateur à consigner dans `docs/decisions.md`.

1. **`/sim` est pur.** Zéro import de Phaser, Colyseus, ou API Node. Il doit tourner à l'identique dans un Web Worker (mode Veillée solo) et sur Node (multi). Un lint ESLint fait respecter cette règle — ne jamais la contourner ni désactiver.
2. **`/sim` est déterministe — au bit près, entre moteurs JS.** Pas de `Math.random` (PRNG seedé dans `rng.ts`, état dans le `SimState`), pas de `Date`/`performance`/timers — le temps est le numéro de tick. Et pas de fonctions Math approximées (`sin`, `cos`, `pow`, `hypot`, `exp`, `log`, `**`…) : la spec ECMAScript ne garantit pas leur résultat d'un moteur à l'autre, or un replay enregistré dans un navigateur doit rejouer exactement sur Node. Opérations autorisées : `+ - * /`, `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`, les constantes. Même seed + mêmes inputs = même état ET même flux d'événements : contrats testés par `sim.test.ts`, `replay.test.ts` et `events.test.ts`.
3. **Serveur autoritatif, client bête.** Le client envoie des inputs et interpole des snapshots. Seule prédiction locale : le déplacement de son propre avatar.
4. **Pas de moteur physique** (ni Arcade ni Matter) : grille + AABB maison. Pathfinding : grille + flow fields pour les hordes.
5. **Tick fixe 10-15 Hz** (`BALANCE.TICK_RATE_HZ`), wind-ups de combat 300-500 ms, interpolation client ~100 ms.
6. **Persistance : PostgreSQL seul**, write-behind. Pas de Redis, pas de queue, pas de microservices. Infra : 1 VPS + Docker Compose — résister à Kubernetes.
7. **Une simulation, pas deux jeux.** Le solo (Veillée) = `/sim` dans un Worker ; le multi = `/sim` sur Node. Toute feature se développe dans `/sim` d'abord, headless, testée — le rendu vient après.

## Règles de travail

- **Équilibrage** : tout nombre d'équilibrage vit dans `packages/sim/src/balance.ts`, jamais en dur dans la logique. Les valeurs sont des ordres de grandeur (GDD §15), calibrées en playtest.
- **Événements de domaine** : tout fait de jeu discret et signifiant (spawn, récolte, don, premier sang, pacte…) est émis comme `SimEvent` (`events.ts`) au moment où la logique l'exécute. L'alignement, la chronique de saison, le tableau du village et la réputation sont des *consommateurs* de ce flux — on n'instrumente jamais la logique après coup. Haute fréquence ≠ domaine : un déplacement n'est pas un événement.
- **État de sim JSON-sérialisable** : pas de classes, pas de `Map`/`Set` dans `SimState` — snapshot, transport Worker et persistance en dépendent.
- **Specs avant systèmes** : avant d'implémenter un système de jeu (combat, alignement, économie…), extraire/compléter sa spec dans `docs/specs/` avec des critères d'acceptation testables, puis implémenter contre ces critères.
- **Décisions** : toute décision de design ou d'architecture prise en session s'ajoute en une ligne dans `docs/decisions.md`. Les 14 décisions fondatrices sont dans le GDD §14.
- **Tests** : l'effort de test se concentre sur `/sim`. Chaque système livré arrive avec ses tests headless. Les bugs se reproduisent par un test `seed + inputs → état attendu` avant d'être corrigés.
- Le code et les docs du projet sont en **français** (comme le GDD) ; les identifiants de code en anglais.

## Roadmap — état courant

Le plan d'implémentation complet est dans **`docs/roadmap.md`** (jalons V0-V10 → LAN → Vallée → Saison 0, avec critères de sortie et gates). Le cadre vient du GDD §13.

**Jalon courant : V6 — Le combat** (endurance, télégraphes 300-500 ms, blessures, mort/respawn au Feu, PvE faune + zombies ; écrire `docs/specs/combat.md` d'abord). V0-V5 faits le 2026-07-05 (specs `monde`, `client`, `village`, `economie`, `pnj`). Reste de V2 : brancher le déploiement Cloudflare Pages (action Alexis).

MVP gouvernance (Veillée/LAN) : rang unique + Chef + propriété individuelle. MVP alignement : deux axes + Foyer/Meute seulement.
