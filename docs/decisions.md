# Journal des décisions

ADR léger : une ligne par décision, en ajout seul (on ne réécrit pas l'histoire ; une décision annulée est notée comme nouvelle décision). Les **14 décisions fondatrices** sont dans `braises-gdd.md` §14 — ce journal commence après elles.

Format : `AAAA-MM-JJ — [domaine] Décision. (pourquoi, en quelques mots)`

---

- 2026-07-05 — [outillage] Monorepo pnpm workspaces, TypeScript strict partout, Vitest, ESLint flat config. (GDD §11 acté ; ESLint sert de garde-fou exécutable à la pureté de /sim)
- 2026-07-05 — [sim] La pureté ET le déterminisme de /sim sont imposés par lint : imports Phaser/Colyseus/Node interdits, `Math.random`/`Date`/timers interdits. (une règle codée vaut mieux qu'une règle écrite)
- 2026-07-05 — [sim] PRNG mulberry32, état 32 bits stocké dans le `SimState`. (sérialisable avec l'état → snapshots et replays exacts au bit près)
- 2026-07-05 — [sim] `SimState` JSON-sérialisable, pas de classes ni Map/Set ; `snapshot()` = `JSON.stringify`. (transport Worker/réseau et comparaison d'états triviaux)
- 2026-07-05 — [sim] Tick rate par défaut 12 Hz dans `balance.ts`. (milieu de la fourchette 10-15 Hz du GDD ; à calibrer)
- 2026-07-05 — [process] Tous les nombres d'équilibrage vivent dans `balance.ts`, jamais en dur. (tuning diffable et testable par bots)
- 2026-07-05 — [process] Replay log implémenté jour 1 dans /sim (`replay.ts`), avant même le serveur. (GDD §11 : « 3 soirées au jour 1, 3 semaines en greffe tardive »)
- 2026-07-05 — [sim] Bus d'événements de domaine (`events.ts`) dès le jour 1 : /sim émet des `SimEvent` typés, buffer dans le `SimState`, drainé par l'hôte. (alignement §3, chronique §2, tableau/réputation §5 et tribunal §11 sont tous des consommateurs de ce flux — impossible à greffer proprement après coup)
- 2026-07-05 — [sim] Fonctions Math approximées (sin, cos, pow, hypot, exp, log, `**`…) interdites dans /sim par lint. (non déterministes entre moteurs JS ; un replay navigateur doit rejouer au bit près sur Node — seuls + - * /, sqrt et les arrondis sont exacts IEEE 754)
