# Spec — La levée des Cendreux

**Date** : 2026-07-08 · **Statut** : design validé (brainstorming), à implémenter (TDD).
Aboutissement de la direction de lore **A×C** (« le monstre, c'est toi sans ta braise ») et de la
chaîne Température → mort `cause:'cold'` → IA PNJ de chaleur (qui fournit des morts de froid *sensées*).
Quand une braise s'éteint seule dans le froid, le corps se relève en **Cendreux**.

## Contexte (câblage existant)

- **Mort** (`combat.ts die()`) : émet `entity_died` (avec `cause?:'cold'`). PNJ → mort définitive
  + cadavre-loot ; joueur → **respawn au Foyer** + cadavre-loot ; monstre → retiré. Le cadavre
  (`Corpse {id,x,y,inventory,decayAt}`) n'est créé **que s'il y a du loot**.
- **Monstres** : `MONSTER_DEFS` (zombie, boar) ; `spawnMonster(state,type,x,y): number` ; IA dans
  `advanceMonsters` **dispatchée par `monster.type`** (branche zombie : errance/aggro + flow-field de
  horde ; branche boar). `Monster {entityId,type,targetId,thinkAt,wanderDx/Dy,fleeing,lastAttackerId}`.
- **Pathfinding** : `findPath(world, from, to, maxExplored)` (A\*, déterministe) — utilisé par les PNJ.
  `getGameTime(state).isNight`. PRNG `roll(state)`.

## Décisions actées (brainstorming)

- **Qui se relève** : PNJ **et** joueur (le beat « récupère ton stuff sur ton corps gelé » est le cœur du lore).
- **IA scopée au type `cendreux`** (zombies/hordes inchangés), écrite réutilisable.
- **Repaires** (nids pré-placés), **méga-horde**, **attirance-chaleur généralisée aux zombies**,
  **Cendreux qui défoncent les murs** (siège), **traînage de cadavre** → **différés** (voir Hors périmètre).

## Design

### 1 · La levée (déclencheur, à la mort)

Dans `die()`, une fois `cause` connu, évaluer le **critère de levée** :
`cause === 'cold'` **ET** *seul* (aucun **allié vivant** — membre du même village — dans
`CENDREUX.WITNESS_RADIUS` ~8) **ET** *loin d'un feu* (aucune structure `type:'fire'` dans
`CENDREUX.HEARTH_WARD_RADIUS` ~12).

Si le critère tient :
- **Toujours créer un cadavre** à `(x,y)` (même inventaire vide), avec un champ **`risesAt = tick + CENDREUX.RISE_DELAY`**.
- Ce cadavre **ne décante pas** tant que `risesAt` est défini (il ne disparaît pas avant de se lever).
- Pour le **joueur** : le respawn au Foyer a lieu **normalement** (inchangé) ; c'est le **cadavre** qui se lève, en parallèle.

Sinon : comportement actuel inchangé (cadavre seulement si loot, `decayAt` normal).

`Corpse` gagne un champ optionnel `risesAt?: number`.

### 2 · Le réveil (chaque tick)

Nouvelle étape `advanceCendreux(state)` (ou dans le système cadavres), pour chaque cadavre avec
`risesAt !== undefined` :
- Si `state.tick < risesAt` : rien (mais **ne pas décanter** ce cadavre).
- Si `state.tick >= risesAt` :
  - **Annulation au réveil (agency « veille tes morts au feu »)** : re-vérifier *loin d'un feu*. Si une
    structure feu est désormais dans `HEARTH_WARD_RADIUS` du cadavre → **annuler** : effacer `risesAt`,
    rendre le cadavre décantable (`decayAt = tick + CORPSE_TICKS`). Pas de Cendreux.
  - Sinon **lever** : `spawnMonster(state,'cendreux',corpse.x,corpse.y)`, **transférer l'inventaire du
    cadavre** à l'entité spawné (`entity.inventory = corpse.inventory`), **retirer le cadavre**, émettre
    l'événement de domaine **`cendreux_risen`** (`{tick, entityId, x, y}`) — consommable par la chronique.

Le Cendreux **porte** donc le loot du défunt ; le tuer le redépose (le flux mort-de-monstre de `die()`
doit inclure `entity.inventory`, voir §5).

### 3 · Le type `cendreux` (stats de départ, calibrables)

`MONSTER_DEFS.cendreux` : **hp 20** (2 coups d'arme basique — épieu 16 ou hache 10 : 2 coups suffisent), **damage 34** (3 coups tuent un avatar
100 PV), **speed 1.3** t/s (très lent — kité facilement en solo), **windupTicks `ticksFor(0.7)`**,
**attackCooldownTicks `ticksFor(2.5)`** (télégraphié), **aggroRange 5** (vue courte de jour),
**thinkEveryTicks `ticksFor(0.5)`**, **wanderChance 0** (pas d'errance aléatoire), **chargeChance 0**,
**loot {}** (il porte celui du cadavre). **Danger = densité**, purement émergent (peu = trivial,
beaucoup = on est submergé).

### 4 · L'IA `cendreux` (branche dédiée dans `advanceMonsters`, A\* via `findPath`)

Toujours **très lent**. Jamais de marche gloutonne : déplacement par **A\*** (calcul `findPath` à la
cadence de décision, on avance vers le prochain nœud du chemin — mémoriser le chemin sur le `Monster`,
champ `path?`). Deux régimes selon `getGameTime(state).isNight` :

- **Jour — « au chaud, repos »** : dormant. On ne bouge **que si** une **proie vivante** est dans
  `aggroRange` (5) → on va vers elle en A\* et on frappe au contact. Sinon : immobile.
- **Nuit — « a froid, cherche la chaleur »** : cible = **point de chaleur le plus proche** dans
  `CENDREUX.WARMTH_SEEK_RANGE` ~20 — une **structure feu/Foyer OU un corps vivant** (`nearestWarmth`,
  qui étend `nearestPrey` avec les feux). On dérive vers elle en A\* ; si la cible est un vivant atteint,
  on frappe. Si aucune chaleur dans le rayon : immobile (pas d'errance).

Zombies/boar : branches **inchangées**.

### 5 · Le cadavre *devient* le Cendreux (loot hérité)

Dans `die()`, la ligne de loot du monstre devient
`const loot = monster ? { ...MONSTER_DEFS[monster.type].loot, ...entity.inventory } : { ...entity.inventory }`.
Zombie/boar ayant un `entity.inventory` vide, c'est neutre pour eux ; pour le Cendreux (dont
`entity.inventory` = loot hérité), ça redépose le stuff à sa mort. Minimal et sûr.

### 6 · Constantes (balance.ts, bloc `CENDREUX`)

| Constante | Départ | Rôle |
|---|---|---|
| `WITNESS_RADIUS` | 8 | « seul » : aucun allié vivant dans ce rayon à la mort. |
| `HEARTH_WARD_RADIUS` | 12 | « loin d'un feu » : aucune structure feu dans ce rayon (mort ET réveil). |
| `RISE_DELAY` | `ticksFor(300)` (~5 min, ordre de grandeur « plus tard cette nuit ») | délai mort→levée. Le cadavre marqué ne décante pas d'ici là. |
| `WARMTH_SEEK_RANGE` | 20 | rayon de recherche de chaleur la nuit. |

Ordres de grandeur, calibrage playtest (règle projet). Stats du monstre dans `MONSTER_DEFS`.

## Critères d'acceptation (headless)

1. **Déterminisme** : même seed + inputs → même levée et même IA bit à bit (`findPath`/`getGameTime`/`roll` purs).
2. **Levée** : un PNJ meurt `cold`, seul, loin d'un feu → un cadavre marqué `risesAt` est créé ; à
   `risesAt`, un `cendreux` existe à l'endroit, le cadavre a disparu, l'événement `cendreux_risen` est émis.
3. **Critères négatifs** : (a) mort `cold` avec un feu dans `HEARTH_WARD_RADIUS` → pas de marquage ;
   (b) mort `cold` avec un allié vivant dans `WITNESS_RADIUS` → pas de marquage ; (c) mort non-`cold` → pas de marquage.
4. **Annulation au réveil** : cadavre marqué, un feu placé à portée avant `risesAt` → à `risesAt`,
   **aucun** Cendreux ; le cadavre redevient décantable.
5. **Non-décantation** : un cadavre marqué ne disparaît pas entre la mort et `risesAt` (même au-delà de `CORPSE_TICKS`).
6. **Loot hérité** : le Cendreux levé porte l'inventaire du défunt ; le tuer redépose ce loot dans un cadavre.
7. **Joueur** : un joueur mort `cold`/seul/loin **respawn au Foyer** ET son cadavre se lève (les deux à la fois).
8. **Stats** : un `cendreux` meurt en 2 coups d'arme basique ; il tue un avatar 100 PV en 3 coups (dégâts appliqués).
9. **IA jour** : sans proie → immobile ; une proie dans `aggroRange` → il s'en rapproche (un chemin A\* est posé).
10. **IA nuit** : une source de chaleur (feu ou vivant) dans `WARMTH_SEEK_RANGE` → il dérive vers elle
    (chemin posé) ; aucun feu/vivant → immobile.
11. **Non-régression** : les branches zombie/boar de `advanceMonsters` sont inchangées ; `pnpm scenario` reste vert.
12. **Pureté** : `/sim` pur, `pnpm lint` vert.

## Hors périmètre

- **Repaires** (nids de Cendreux pré-placés sur lieux de catastrophe) → session **POI** (réutilise le type `cendreux`).
- **Méga-horde** du Grand Froid, **attirance-chaleur généralisée aux zombies** → itérations suivantes.
- **Siège** : Cendreux qui défoncent les murs pour atteindre un Foyer clos → différé (v1 : A\* contourne, sinon immobile).
- **Traînage de cadavre** vers un feu → non fait (l'annulation par un feu à portée suffit comme agency v1).
- **Rendu client** du Cendreux → travail client (lit le snapshot ; `monster.type:'cendreux'`).
- **Perf** : `findPath` par Cendreux à la cadence de décision — OK pour la levée sauvage (rare/épars) ;
  la montée en charge (méga-horde) reposera sur les flow-fields existants, hors de ce lot.
