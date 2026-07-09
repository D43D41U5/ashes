# Nœuds denses & récoltables — transport par deltas + index O(1)

**Date** : 2026-07-09
**Branche** : feat/vallee-alpine
**Statut** : design validé, en attente de plan d'implémentation
**Suite de** : `2026-07-09-densite-feeling-biomes-design.md` (le décor a rendu la pénurie de récoltables flagrante)

## Problème

Mesuré sur la carte Veillée (1200×1800) :

| | Mesure |
|---|---|
| Tuiles boisées (forêt + vieille forêt + pins + mélèzes) | 614 560 |
| Arbres **récoltables** sur toute la carte | 2 917 |
| Ratio | 1 récoltable pour 211 tuiles boisées (0,48 %) |
| À l'écran (~1000 tuiles, zoom jeu) | ~5 arbres récoltables |
| Conifères **cosmétiques** en forêt | ~60 % des tuiles |

La forêt a l'air pleine (décor cosmétique dense) mais **~1 arbre sur ~100 est récoltable**. Le décor n'a pas retiré d'arbres — il a rendu la pénurie préexistante flagrante.

**Cause racine** : `generateNodes(map, seed, 0.025)` sous-échantillonne les nœuds à 2,5 % — soit ~5 000 nœuds sur toute la carte. Ce plafond existe parce que **`sim-worker.ts` clone `sim.nodes` EN ENTIER dans chaque snapshot** (20×/s) : le coût de transport croît avec le nombre de nœuds. Le clustering (sous-projet précédent) a regroupé ces 2 917 arbres en bosquets mais n'en a **ajouté aucun** — c'était la décision « budget constant », qui se révèle insuffisante.

## Objectif

Rendre les forêts (et tous les biomes) **réellement denses à récolter**, en **découplant le nombre de nœuds du coût de transport par tick**, de sorte que la densité puisse monter fortement sans saturer le réseau ni le CPU.

Cible retenue : **densité 0.30** (≈ 60 000 nœuds, ~57 arbres récoltables/écran).

## Décisions actées (session 2026-07-09)

1. On abandonne le « budget constant » : le vrai correctif est le refactor du transport, différé jusqu'ici.
2. **Densité cible 0.30** (~60k nœuds), réglable via une constante.
3. Trois pièces : transport par deltas, index O(1) tuile→nœud, montée de densité + réaccord du décor forêt.
4. Aucune pièce ne rouvre les invariants d'architecture (état sérialisable, sim pure/déterministe, client bête, pas de moteur physique).

## Invariants (non négociables)

- **INV-A — `/sim` inchangé côté transport.** La logique « une fois + deltas » vit dans le **worker/protocole**, jamais dans `/sim` (client bête : le client applique des snapshots). `/sim` reste pur et déterministe.
- **INV-B — État sérialisable.** L'index tuile→nœud est un **dérivé local, jamais dans `SimState`** (pas de `Map`/`Set` en état) — même statut que le flow-cache des hordes et que `makeIndexedIsBlockedAt` (construit et jeté dans l'appel/tick).
- **INV-C — Collision inchangée au bit près.** L'index doit rendre **exactement les mêmes décisions de blocage** que `blockedAt` aujourd'hui — la prédiction/réconciliation client en dépend (cf. `client-prediction-saga`). Testé indexé ≡ non-indexé.
- **INV-D — Déterminisme sim préservé.** `generateNodes` reste déterministe ; monter la densité change les nœuds mais reste reproductible.
- **INV-E — Nœuds stables au runtime.** Le jeu de nœuds est fixé à l'init (généré puis filtré par `worldgen.ts`) ; au runtime seuls `stock`/`regrowAt` changent (récolte/repousse), aucun ajout/retrait. Les deltas ne portent donc que des changements de `stock`.

## Système 1 — Transport : nœuds une fois + deltas

Aujourd'hui (`sim-worker.ts` `tick()`), chaque snapshot porte `nodes: sim.nodes` (clone complet, 20×/s).

**Changement (protocole + worker + client, `/sim` intact) :**

- **Message `ready`** (porte déjà `map`) : ajouter `nodes: ResourceNode[]` — la liste complète, **une seule fois**.
- **Message `snapshot`** : remplacer `nodes: ResourceNode[]` par `nodeDeltas: NodeDelta[]`, avec `interface NodeDelta { id: number; stock: number }`.
- **Worker** : maintient une **ombre locale** `Map<id, stock>` (état du worker, pas du sim). Chaque tick, scan de `sim.nodes` (local, **zéro clone**) : pour chaque nœud dont `stock` ≠ ombre, pousser `{ id, stock }` et mettre à jour l'ombre. Un tick sans récolte/repousse ⇒ `nodeDeltas` vide.
- **Client** (`snapshot-view.ts`) : au `ready`, `initNodes(nodes)` crée tous les sprites une fois et remplit `this.nodes`. Par snapshot, `applyNodeDeltas(deltas)` met à jour `stock` du nœud (dans `this.nodes`) et l'alpha du sprite par id. Le client **conserve la liste complète** — tous ses consommateurs (ciblage de récolte, HUD) lisent `this.nodes` comme avant.

C'est aussi le protocole du futur multi (nœuds au join, deltas ensuite) — seul le transport change, pas le protocole logique.

## Système 2 — Index O(1) tuile→nœud

`nodeAt` (economy.ts:60) est un `find` O(N). Il est appelé par :
- la **collision de déplacement** : `resolveMove` → `blockedAt` → `nodeAt`, par entité mobile et par tick ;
- l'**IA PNJ** : `isBlockedAt` (npc.ts) ;
- la **récolte** : une fois par action (rare — reste O(N), acceptable).

À 60k nœuds, les deux premiers deviennent le goulot (scan complet par tuile testée par entité par tick).

**Changement :** réutiliser le pattern **`makeIndexedIsBlockedAt`** (collision.ts:62) — une occupation `Map` clé `ty*width+tx`, dérivé local **jamais dans `SimState`** (INV-B), aux **règles strictement identiques** à `blockedAt` (INV-C). Construire cet index **une fois par tick** (au début de `step()`) et le passer aux consommateurs chauds (résolution de déplacement, IA PNJ) au lieu du `find` O(N). L'occupation (structures + nœuds) est indépendante du mover ; seule la décision finale (propriété de village d'une structure) dépend du mover et s'applique à la requête.

La récolte garde son `nodeAt` O(N) direct (une fois par action, négligeable) — pas de sur-ingénierie.

## Système 3 — Densité 0.30 + réaccord du décor

- `packages/client/src/worker/veillee.ts` : `generateNodes(map, VEILLEE_SEED, 0.025)` → **densité via constante** (`NODE_DENSITY = 0.30`), pour ~60k nœuds. (Le clustering du sous-projet précédent reste actif : les nœuds sont groupés en bosquets.)
- `BIOME_CLUTTER` (clutter.ts) : **baisser la densité de décor forêt** (`FOREST` 0.62 → ~0.40, `OLD_GROWTH` 0.7 → ~0.45) pour que les arbres récoltables (plus nombreux ET distincts) ressortent, sans dépeupler la forêt.

## Hors périmètre (YAGNI)

- **File de repousse** : `advanceEconomy` garde son scan O(N)/tick (bon jusqu'à ~100k ; à 60k c'est négligeable). À revoir seulement si on vise 0.5+.
- **Persistance Postgres des nœuds** : la Veillée n'a pas de persistance ; hors sujet.
- **Index partagé collision/pathfinding** : le pathfinding continue de bâtir son propre index par appel (déjà en place) ; on ne mutualise pas cette itération-ci.
- Pas de nouveaux types de nœuds ni de biomes.

## Critères d'acceptation

1. **Densité récoltable** : en forêt à zoom jeu, des dizaines d'arbres récoltables à l'écran (mesuré ≥ ~40), regroupés en bosquets — plus « pleins d'arbres dont aucun n'est récoltable ».
2. **Transport découplé** : le snapshot par tick ne porte plus la liste complète des nœuds ; un tick sans récolte a `nodeDeltas` vide. La récolte/repousse d'un nœud se reflète correctement côté client (alpha).
3. **INV-C (collision identique)** : test prouvant que la collision indexée rend les mêmes décisions que `blockedAt` non-indexé sur un échantillon de tuiles ; prédiction client inchangée (pas de traversée de nœud bloquant).
4. **Perf** : le banc `pnpm scenario` reste vert et dans une enveloppe de temps raisonnable à 60k nœuds (pas de régression d'ordre de grandeur).
5. **INV-D** : `generateNodes` déterministe à la nouvelle densité ; `pnpm test` vert.
6. **Réaccord décor** : la forêt reste visuellement dense mais les récoltables se distinguent nettement (revue visuelle en jeu, artefact 2×2 mis à jour).
7. `pnpm check`, `pnpm test`, `pnpm lint` verts avant chaque commit.
