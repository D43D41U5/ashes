# Arbres hauts à hitbox de tronc — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un arbre devient haut de trois tuiles et fin d'un tronc — collision sous-tuile dans `/sim`, houppier à disque de découvert côté client — sans casser le déterminisme ni la parité prédiction/autorité.

**Architecture:** `NODE_DEFS.blocks: boolean` devient `blockHalfSub: number` (demi-côté du carré bloquant, en sous-tuiles). `collision.ts` bascule son cœur en unités de **sous-tuile** (8 par tuile) : `moveAxis`, `lineBlocked` et `overlapsBlocking` deviennent sous-tuile-exacts, tandis que `isBlockedAt` / `makeIndexedIsBlockedAt` gardent leur sémantique **tuile** (le pathfinding ne change pas). Côté client, `nd-tree` se scinde en `nd-tree_trunk` (opaque, tri inchangé) et `nd-tree_crown` (32×32, bande de profondeur dédiée au-dessus des acteurs, alpha fonction de la distance au joueur).

**Tech Stack:** TypeScript pur (`/sim`), Phaser 4 + Vite (`/client`), Vitest.

**Spec de référence :** `docs/superpowers/specs/2026-07-10-arbres-hauts-hitbox-tronc-design.md`
**Branche :** `feat/relief-terrasses`

## Global Constraints

- **`/sim` est pur** : zéro import Phaser / Colyseus / Node. Un lint ESLint le fait respecter — ne jamais le contourner.
- **`/sim` est déterministe au bit près.** Opérations autorisées : `+ - * /`, `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`, les constantes. **Interdit** : `sin`, `cos`, `pow`, `hypot`, `exp`, `log`, `**`, `Math.random`, `Date`, `performance`, timers.
- **Tout nombre d'équilibrage vit dans `packages/sim/src/balance.ts`**, jamais en dur dans la logique.
- **`SimState` reste JSON-sérialisable** : pas de classes, pas de `Map`/`Set` dedans. (Les `Map` locales d'index, jetées dans l'appel, restent permises — cf. `makeIndexedIsBlockedAt`.)
- **Non-régression, le filet du plan** : `collision.test.ts`, `prediction.test.ts`, `replay.test.ts`, `sim.test.ts`, `events.test.ts` passent **sans qu'une seule assertion existante soit modifiée**. Si l'un demande à être retouché, c'est l'implémentation qui a tort, pas le test.
- **Avant chaque commit** : `pnpm check`, `pnpm test`, `pnpm lint` doivent passer.
- Code et docs en **français**, identifiants de code en **anglais**.

## Constantes exactes (copiées de la spec, à ne pas réinventer)

| Constante | Valeur | Où |
|---|---|---|
| `BALANCE.SUBTILES_PER_TILE` | `8` | `packages/sim/src/balance.ts` |
| `blockHalfSub` — `rock`, `iron_vein`, `coal_seam` | `4` (tuile pleine) | `NODE_DEFS` |
| `blockHalfSub` — `tree` | `1` (tronc, 0,25 tuile) | `NODE_DEFS` |
| `blockHalfSub` — `fiber_plant`, `berry_bush` | `0` (ne bloque pas) | `NODE_DEFS` |
| `CROWN_BASE` | `900_000` | `packages/client/src/render/framing.ts` |
| `CROWN_R_IN` | `1.5` | idem |
| `CROWN_R_OUT` | `4.0` | idem |
| `CROWN_ALPHA_MIN` | `0.22` | idem |
| Tronc `nd-tree_trunk` | 16 px large × 22 px haut | `BootScene` |
| Houppier `nd-tree_crown` | 32 px large × 32 px haut, recouvre le tronc de 6 px | `BootScene` |

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `packages/sim/src/balance.ts` | `SUBTILES_PER_TILE` ; `NodeDef.blockHalfSub` remplace `blocks` | 1, 2 |
| `packages/sim/src/collision.ts` | Cœur sous-tuile : `blockedSubAt`, `lineBlockedSub`, `moveAxis`, `overlapsBlocking`. `blockedAt` (tuile) inchangé sémantiquement | 1, 2 |
| `packages/sim/src/collision.test.ts` | Filet de non-régression + 7 critères de collision | 1, 2 |
| `packages/client/src/render/framing.ts` | `crownDepth`, `crownAlpha` + constantes — math PURE, aucun Phaser | 3 |
| `packages/client/src/render/framing.test.ts` | Critères 8 et 9 | 3 |
| `packages/client/src/scenes/BootScene.ts` | Textures `nd-tree_trunk` / `nd-tree_crown` | 4 |
| `packages/client/src/scenes/world/snapshot-view.ts` | Pool de houppiers, culling élargi, alpha du disque | 5 |
| `packages/client/src/scenes/WorldScene.ts` | Passe la position du joueur à `renderNodes` | 5 |
| `docs/decisions.md` | Une ligne de décision | 6 |

**Pourquoi Task 1 avant Task 2.** Task 1 bascule toute la machinerie en sous-tuiles **en gardant `tree` à `blockHalfSub: 4`** — donc à comportement rigoureusement identique. Le filet de non-régression y devient une preuve exécutable de l'exactitude au bit près (`fl(8a − 8b) = 8·fl(a − b)`). Task 2 ne fait plus que tourner un `4` en `1`. Si quelque chose casse, on sait immédiatement si c'est la machinerie ou la géométrie.

---

## Task 1: Le cœur sous-tuile, à comportement identique (`/sim`)

**Files:**
- Modify: `packages/sim/src/balance.ts` (le champ `blocks` de `NodeDef`, lignes 240-259 ; ajout dans `BALANCE` près de `AVATAR_HITBOX_TILES` ligne 79)
- Modify: `packages/sim/src/collision.ts` (intégralement le cœur privé)
- Test: `packages/sim/src/collision.test.ts` (aucune assertion existante modifiée ; un test neuf d'exactitude)

**Interfaces:**
- Consumes: rien (première tâche).
- Produces:
  - `BALANCE.SUBTILES_PER_TILE: number` (= 8)
  - `NodeDef.blockHalfSub: number` (remplace `blocks: boolean`)
  - `blockedSubAt(world: MoveWorld, sx: number, sy: number): boolean` (privé à `collision.ts`)
  - `overlapsBlocking(world: MoveWorld, x: number, y: number): boolean` — devient sous-tuile-exact (signature inchangée)
  - `isBlockedAt(world, tx, ty): boolean` et `makeIndexedIsBlockedAt(world): (tx, ty) => boolean` — sémantique **tuile** inchangée

- [ ] **Step 1: Ajouter `SUBTILES_PER_TILE` dans `BALANCE`**

Dans `packages/sim/src/balance.ts`, juste après `AVATAR_HITBOX_TILES` (ligne 79) :

```ts
  /** Côté de la hitbox AABB d'un avatar, en tuiles (spec monde R9). */
  AVATAR_HITBOX_TILES: 0.6,

  /** Résolution de la collision sous-tuile : sous-tuiles par côté de tuile.
   * PUISSANCE DE DEUX obligatoire — la collision multiplie et divise par cette
   * valeur, et seule une puissance de deux garantit `fl(8a − 8b) = 8·fl(a − b)`,
   * donc l'exactitude au bit près face à l'ancienne collision en tuiles pleines
   * (invariant 2). 8 permet un tronc centré de 2 sous-tuiles (0,25 tuile) qui
   * laisse 0,75 tuile d'écart entre deux troncs voisins — l'avatar (0,6) passe. */
  SUBTILES_PER_TILE: 8,
```

- [ ] **Step 2: Remplacer `blocks` par `blockHalfSub` dans `NodeDef`**

Dans `packages/sim/src/balance.ts`, remplacer le champ (ligne 242-244) :

```ts
  /** Arbres, affleurements et filons sont des obstacles (spec économie R1). */
  blocks: boolean
```

par :

```ts
  /** Demi-côté du carré bloquant, en SOUS-TUILES depuis le centre de la tuile
   * (spec économie R1, spec arbres hauts). La tuile `t` couvre les sous-tuiles
   * `[8t, 8t+8)`, son centre est `8t+4`, et le carré bloquant est
   * `[8t+4−h, 8t+4+h)`. `h = 4` → tuile entière ; `h = 0` → ne bloque pas ;
   * `h = 1` → tronc de 0,25 tuile. */
  blockHalfSub: number
```

Puis la table `NODE_DEFS` (lignes 252-259). **`tree` reste à `4` pour l'instant** : cette tâche ne doit RIEN changer au comportement.

```ts
export const NODE_DEFS: Record<NodeType, NodeDef> = {
  tree: { item: 'wood', stock: 10, blockHalfSub: 4, skill: 'woodcutting', tool: 'axe', requiresTool: false },
  rock: { item: 'stone', stock: 12, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', requiresTool: false },
  fiber_plant: { item: 'fiber', stock: 6, blockHalfSub: 0, skill: 'foraging', tool: null, requiresTool: false },
  berry_bush: { item: 'berries', stock: 8, blockHalfSub: 0, skill: 'foraging', tool: null, requiresTool: false },
  iron_vein: { item: 'iron_ore', stock: 8, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', requiresTool: true },
  coal_seam: { item: 'coal', stock: 8, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', requiresTool: true },
}
```

- [ ] **Step 3: Lancer `pnpm check` pour lister les consommateurs de `blocks`**

Run: `pnpm check`
Expected: FAIL — exactement deux erreurs, `packages/sim/src/collision.ts:46` et `:95` (`Property 'blocks' does not exist on type 'NodeDef'`). Aucun autre fichier ne lit `blocks` (vérifié : `grep -rn "\.blocks" packages/*/src` ne rend que ces deux lignes).

- [ ] **Step 4: Écrire le test d'exactitude au bit près**

**Ce ne sont pas des tests TDD** — ce sont des **verrous de non-régression**, et c'est délibéré. Task 1 ne doit changer AUCUN comportement : il n'existe donc pas d'état « rouge » à observer. Ces trois tests passeraient déjà sur `main` ; leur rôle est d'échouer si la bascule en sous-tuiles introduit la moindre erreur d'arrondi, en exigeant `toBe` (égalité binaire) là où un `toBeCloseTo` laisserait passer une dérive. Ils s'exécutent au Step 6, avec le reste du filet.

Ajouter à la fin de `packages/sim/src/collision.test.ts` :

```ts
describe('cœur sous-tuile (préparation des arbres hauts)', () => {
  it('un clamp contre un nœud pleine tuile est EXACT, pas approché (bit à bit)', () => {
    const map = createEmptyMap(16, 16, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'rock', tx: 8, ty: 4, stock: 12, regrowAt: 0 }]
    const world = { map, nodes }
    // Marche vers l'est jusqu'au contact, puis un pas de plus : clamp flush.
    let p = { x: 5.5, y: 4.5 }
    for (let t = 0; t < 40; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBe(8 - HALF) // `toBe`, pas `toBeCloseTo` : l'égalité est exacte
    expect(p.y).toBe(4.5)
  })

  it('le clamp par l’ouest est exact lui aussi', () => {
    const map = createEmptyMap(16, 16, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'rock', tx: 4, ty: 4, stock: 12, regrowAt: 0 }]
    const world = { map, nodes }
    let p = { x: 7.5, y: 4.5 }
    for (let t = 0; t < 40; t++) p = moveAvatar(world, p.x, p.y, -1, 0, TICK_DT_S)
    expect(p.x).toBe(5 + HALF) // bord droit de la tuile 4, plus le demi-avatar
  })

  it('un nœud épuisé (stock 0) ne bloque pas', () => {
    const map = createEmptyMap(16, 16, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'rock', tx: 8, ty: 4, stock: 0, regrowAt: 100 }]
    const world = { map, nodes }
    let p = { x: 7.5, y: 4.5 }
    for (let t = 0; t < 20; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBeGreaterThan(8.5) // il l'a traversé
  })
})
```

Ajouter en tête de `collision.test.ts` l'import du type :

```ts
import type { ResourceNode } from './economy'
```

- [ ] **Step 5: Réécrire le cœur de `collision.ts` en sous-tuiles**

Remplacer, dans `packages/sim/src/collision.ts`, le bloc qui va de la déclaration de `EPS`/`HALF` jusqu'à la fin de `overlapsBlocking`. Voici le contenu final des parties touchées (tout le reste du fichier — `MoveWorld`, `isBlockedAt`, `resolveMove`, `moveAvatar`, `moveAvatarStepped` — est inchangé sauf là où c'est indiqué).

Les constantes, en tête :

```ts
const EPS = 1e-6
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2

/* ── Le cœur travaille en SOUS-TUILES ───────────────────────────────────────
 *
 * Un obstacle n'occupe plus forcément sa tuile entière : un tronc d'arbre est un
 * carré de 2 sous-tuiles centré dans la sienne. La géométrie se déduit de la
 * tuile et d'un entier (`NodeDef.blockHalfSub`) — aucune AABB stockée, rien de
 * neuf dans `SimState`.
 *
 * DÉTERMINISME (invariant 2). `SUB` est une puissance de deux, donc multiplier
 * et diviser par lui est exact en binaire, et l'arrondi commute avec la mise à
 * l'échelle : `fl(8a − 8b) = 8·fl(a − b)`. Le résultat est donc identique AU BIT
 * PRÈS à l'ancienne collision en tuiles pleines pour tout obstacle `h = 4`.
 * `EPS_SUB = EPS × SUB` (et non `EPS`) : c'est ce qui rend les seuils de
 * `Math.floor` équivalents à l'échelle près, et non huit fois plus serrés.
 */
const SUB = BALANCE.SUBTILES_PER_TILE
const HALF_SUB = HALF * SUB
const EPS_SUB = EPS * SUB
```

`blockedAt` — sémantique **tuile**, seule la lecture de `NodeDef` change :

```ts
function blockedAt(world: MoveWorld, tx: number, ty: number): boolean {
  if (isBlockingTile(world.map, tx, ty)) return true
  if (world.structures) {
    const s = structureAt(world.structures, tx, ty)
    if (s !== undefined && structureBlocks(s, world.moverVillageId ?? null)) return true
  }
  if (world.nodes) {
    const n = nodeAt(world.nodes, tx, ty)
    if (n !== undefined && n.stock > 0 && NODE_DEFS[n.type].blockHalfSub > 0) return true
  }
  return false
}
```

Dans `makeIndexedIsBlockedAt`, la ligne 95 devient de même :

```ts
    if (entry.node !== undefined && entry.node.stock > 0 && NODE_DEFS[entry.node.type].blockHalfSub > 0) return true
```

Le nouveau prédicat sous-tuile, à placer juste après `makeIndexedIsBlockedAt` :

```ts
/**
 * Une SOUS-TUILE est-elle bloquante ? Terrain et structures bloquent leur tuile
 * entière ; un nœud ne bloque que le carré `[c−h, c+h)` autour du centre `c` de
 * sa tuile, où `h = blockHalfSub`. Pour `h = 4` on retrouve exactement la tuile.
 */
function blockedSubAt(world: MoveWorld, sx: number, sy: number): boolean {
  const tx = Math.floor(sx / SUB)
  const ty = Math.floor(sy / SUB)
  if (isBlockingTile(world.map, tx, ty)) return true
  if (world.structures) {
    const s = structureAt(world.structures, tx, ty)
    if (s !== undefined && structureBlocks(s, world.moverVillageId ?? null)) return true
  }
  if (world.nodes) {
    const n = nodeAt(world.nodes, tx, ty)
    if (n !== undefined && n.stock > 0) {
      const h = NODE_DEFS[n.type].blockHalfSub
      if (h > 0) {
        const cx = tx * SUB + SUB / 2
        const cy = ty * SUB + SUB / 2
        if (sx >= cx - h && sx < cx + h && sy >= cy - h && sy < cy + h) return true
      }
    }
  }
  return false
}
```

`tileSpan` disparaît au profit de `subSpan`, et `lineBlocked` devient `lineBlockedSub` :

```ts
/** Plage de SOUS-TUILES recouvertes par l'intervalle [min, max) donné en sous-tuiles. */
function subSpan(min: number, max: number): [number, number] {
  return [Math.floor(min + EPS_SUB), Math.floor(max - EPS_SUB)]
}

/** Une colonne (horizontal) ou ligne (vertical) de SOUS-TUILES contient-elle un obstacle ? */
function lineBlockedSub(
  world: MoveWorld,
  fixedSub: number,
  crossMinSub: number,
  crossMaxSub: number,
  horizontal: boolean,
): boolean {
  const [c0, c1] = subSpan(crossMinSub, crossMaxSub)
  for (let c = c0; c <= c1; c++) {
    const blocked = horizontal ? blockedSubAt(world, fixedSub, c) : blockedSubAt(world, c, fixedSub)
    if (blocked) return true
  }
  return false
}
```

`moveAxis` — même structure, unités de sous-tuile, une seule division en sortie :

```ts
/**
 * Déplace `pos` de `delta` sur un axe, clampé flush contre le premier obstacle
 * rencontré. Tout se calcule en SOUS-TUILES ; on ne divise qu'une fois, en
 * sortie — c'est ce qui préserve l'exactitude au bit près (cf. en-tête).
 * `crossMin/crossMax` : étendue de l'AABB sur l'autre axe, en tuiles.
 */
function moveAxis(
  world: MoveWorld,
  pos: number,
  delta: number,
  crossMin: number,
  crossMax: number,
  horizontal: boolean,
): number {
  if (delta === 0) return pos
  const target = pos + delta
  const posSub = pos * SUB
  const targetSub = target * SUB
  const crossMinSub = crossMin * SUB
  const crossMaxSub = crossMax * SUB
  if (delta > 0) {
    const firstNew = Math.floor(posSub + HALF_SUB - EPS_SUB) + 1
    const lastNew = Math.floor(targetSub + HALF_SUB - EPS_SUB)
    for (let s = firstNew; s <= lastNew; s++) {
      if (lineBlockedSub(world, s, crossMinSub, crossMaxSub, horizontal)) return (s - HALF_SUB) / SUB
    }
  } else {
    const firstNew = Math.floor(posSub - HALF_SUB + EPS_SUB) - 1
    const lastNew = Math.floor(targetSub - HALF_SUB + EPS_SUB)
    for (let s = firstNew; s >= lastNew; s--) {
      if (lineBlockedSub(world, s, crossMinSub, crossMaxSub, horizontal)) return (s + 1 + HALF_SUB) / SUB
    }
  }
  return target
}
```

`overlapsBlocking` — devient sous-tuile-exact :

```ts
/**
 * L'AABB d'un avatar centré en (x, y) recouvre-t-elle un obstacle ?
 *
 * SOUS-TUILE-EXACT, et il le FAUT : `collision.test.ts` et `prediction.test.ts`
 * affirment qu'un avatar n'est jamais dans un obstacle. Avec une sémantique
 * tuile, un avatar légalement debout entre deux troncs les ferait échouer à tort.
 */
export function overlapsBlocking(world: MoveWorld, x: number, y: number): boolean {
  const [sx0, sx1] = subSpan((x - HALF) * SUB, (x + HALF) * SUB)
  const [sy0, sy1] = subSpan((y - HALF) * SUB, (y + HALF) * SUB)
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      if (blockedSubAt(world, sx, sy)) return true
    }
  }
  return false
}
```

Enfin, mettre à jour l'en-tête de module (le paragraphe « Sémantique d'occupation ») en y ajoutant une phrase :

```
 * Deux familles de requêtes, et la frontière est nette : les requêtes TUILE
 * (`isBlockedAt`, `makeIndexedIsBlockedAt` — pathfinding, IA, spawns) répondent
 * « cette tuile porte-t-elle un obstacle ? » ; les requêtes SOUS-TUILE (le
 * déplacement, `overlapsBlocking`) répondent « ce point est-il dans un
 * obstacle ? ». Un arbre bloque sa tuile pour l'A* et son seul tronc pour l'avatar.
```

- [ ] **Step 6: Lancer le filet de non-régression**

Run: `pnpm test`
Expected: PASS, **toute la suite**, sans qu'une assertion existante ait bougé. C'est la preuve exécutable de `fl(8a − 8b) = 8·fl(a − b)` : `collision.test.ts` (dont la marche aléatoire de 10 000 ticks), `prediction.test.ts`, `replay.test.ts`, `sim.test.ts`, `events.test.ts` sont tous verts.

Si `replay.test.ts` ou `sim.test.ts` échoue, l'exactitude au bit près est rompue : ne PAS ajuster le test. Vérifier d'abord que `EPS_SUB` vaut bien `EPS * SUB` (et non `EPS`), et que `moveAxis` ne divise qu'en sortie.

- [ ] **Step 7: Vérifier les garde-fous**

Run: `pnpm check && pnpm lint`
Expected: PASS. `pnpm lint` vérifie notamment la pureté de `/sim` — aucune fonction Math approximée n'a été introduite (`blockedSubAt` n'utilise que `Math.floor` et des comparaisons).

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/balance.ts packages/sim/src/collision.ts packages/sim/src/collision.test.ts
git commit -m "refactor(sim): la collision travaille en sous-tuiles, à comportement identique"
```

---

## Task 2: Le tronc — `tree` passe à `blockHalfSub: 1` (`/sim`)

**Files:**
- Modify: `packages/sim/src/balance.ts` (une valeur : `tree.blockHalfSub`)
- Test: `packages/sim/src/collision.test.ts` (les 7 critères de collision de la spec)

**Interfaces:**
- Consumes: `BALANCE.SUBTILES_PER_TILE`, `NodeDef.blockHalfSub`, `overlapsBlocking`, `isBlockedAt` (Task 1).
- Produces: un arbre qui bloque 0,25 tuile pour l'avatar et sa tuile entière pour le pathfinding. Aucune nouvelle signature.

**Géométrie, une fois pour toutes.** Un arbre en `tx` bloque les sous-tuiles `[8·tx+3, 8·tx+5)`, soit les tuiles-fractions `[tx+0,375 ; tx+0,625)`. Deux arbres orthogonalement voisins (`tx`, `tx+1`) laissent donc libre `[tx+0,625 ; tx+1,375)` = **0,75 tuile** > 0,6 (avatar). Un avatar buté par l'ouest se clampe à `tx + 0,375 − 0,3 = tx + 0,075`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `packages/sim/src/collision.test.ts` (après le bloc de Task 1) :

```ts
describe('arbres hauts : la collision se limite au tronc', () => {
  const forest = (trees: Array<[number, number]>): { map: WorldMap; nodes: ResourceNode[] } => ({
    map: createEmptyMap(16, 16, TERRAIN_GRASS),
    nodes: trees.map(([tx, ty], i) => ({ id: i + 1, type: 'tree' as const, tx, ty, stock: 10, regrowAt: 0 })),
  })

  it('A1 — l’avatar (0,6) se faufile entre deux arbres orthogonalement voisins (écart 0,75)', () => {
    const world = forest([
      [6, 4],
      [7, 4],
    ])
    // Le couloir libre est [6,625 ; 7,375[ : son milieu est 7,0.
    let p = { x: 7, y: 2.5 }
    for (let t = 0; t < 60; t++) p = moveAvatar(world, p.x, p.y, 0, 1, TICK_DT_S)
    expect(p.y).toBeGreaterThan(6) // il est passé au sud de la rangée d'arbres
    expect(p.x).toBe(7)
  })

  it('A2 — buté frontalement sur un tronc, il se clampe à tx + 0,075', () => {
    const world = forest([[8, 4]])
    let p = { x: 5.5, y: 4.5 }
    for (let t = 0; t < 40; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBeCloseTo(8.075, 9)
    expect(p.y).toBe(4.5)
  })

  it('A3 — il glisse le long d’un tronc sans s’y accrocher (résolution par axe)', () => {
    const world = forest([[8, 4]])
    // Flush contre le tronc par l'ouest, poussée diagonale sud-est : X bloque, Y glisse.
    const start = { x: 8.075, y: 4.5 }
    const p = moveAvatar(world, start.x, start.y, 1, 1, TICK_DT_S)
    expect(p.x).toBeCloseTo(8.075, 9)
    expect(p.y).toBeGreaterThan(4.5)
  })

  it('A4 — rock, iron_vein et coal_seam bloquent toujours leur tuile ENTIÈRE', () => {
    for (const type of ['rock', 'iron_vein', 'coal_seam'] as const) {
      const world = {
        map: createEmptyMap(16, 16, TERRAIN_GRASS),
        nodes: [{ id: 1, type, tx: 8, ty: 4, stock: 8, regrowAt: 0 }],
      }
      let p = { x: 5.5, y: 4.5 }
      for (let t = 0; t < 40; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
      expect(p.x).toBe(8 - HALF)
    }
  })

  it('A5 — un arbre à stock 0 ne bloque plus rien', () => {
    const world = {
      map: createEmptyMap(16, 16, TERRAIN_GRASS),
      nodes: [{ id: 1, type: 'tree' as const, tx: 8, ty: 4, stock: 0, regrowAt: 200 }],
    }
    let p = { x: 7.5, y: 4.5 }
    for (let t = 0; t < 20; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBeGreaterThan(8.5)
  })

  it('A6 — contrat TUILE : isBlockedAt reste true sur une tuile portant un arbre vivant', () => {
    const world = forest([[8, 4]])
    expect(isBlockedAt(world, 8, 4)).toBe(true) // le pathfinding contourne toujours
    expect(isBlockedAt(world, 7, 4)).toBe(false)
    const indexed = makeIndexedIsBlockedAt(world)
    expect(indexed(8, 4)).toBe(true) // A* et flow fields voient la même chose
  })

  it('A7 — contrat SOUS-TUILE : overlapsBlocking distingue le couloir du tronc', () => {
    const world = forest([
      [6, 4],
      [7, 4],
    ])
    expect(overlapsBlocking(world, 7, 4.5)).toBe(false) // debout dans le couloir : légal
    expect(overlapsBlocking(world, 6.5, 4.5)).toBe(true) // à cheval sur le tronc de (6,4)
  })
})
```

Ajouter les imports manquants en tête de `collision.test.ts` :

```ts
import { isBlockedAt, makeIndexedIsBlockedAt, moveAvatar, moveAvatarStepped, overlapsBlocking } from './collision'
```

(`makeIndexedIsBlockedAt` n'est pas réexporté par `index.ts` ; on l'importe directement depuis `./collision`, comme le reste du fichier de test.)

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm --filter @braises/sim exec vitest run src/collision.test.ts -t "arbres hauts"`
Expected: FAIL. A1 échoue (l'avatar bute sur la rangée d'arbres pleine tuile, `p.y` reste ≈ 3,7), A2 échoue (`p.x` vaut `7.7` = `8 − HALF` au lieu de `8.075`), A7 échoue (`overlapsBlocking(7, 4.5)` rend `true`). A3, A4, A5, A6 passent déjà.

- [ ] **Step 3: Tourner le `4` en `1`**

Dans `packages/sim/src/balance.ts`, une seule ligne de `NODE_DEFS` :

```ts
  tree: { item: 'wood', stock: 10, blockHalfSub: 1, skill: 'woodcutting', tool: 'axe', requiresTool: false },
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `pnpm --filter @braises/sim exec vitest run src/collision.test.ts`
Expected: PASS — les 7 critères, **et** tous les tests préexistants du fichier.

- [ ] **Step 5: Relancer le filet complet**

Run: `pnpm test`
Expected: PASS. Ni `replay.test.ts` ni `sim.test.ts` ni `events.test.ts` ne bougent : aucun d'eux ne place d'arbre sur la trajectoire d'un avatar. Si `scenario.test.ts` change de trajectoire (les PNJ frôlent des arbres), c'est **attendu** — la géométrie du monde a changé. Ne relâcher aucune assertion sans avoir vérifié qu'il n'y a pas d'effondrement réel (villages vivants, greniers positifs) ; consigner la constatation.

- [ ] **Step 6: Mesurer le coût, ne pas le supposer**

`lineBlockedSub` balaie ~5 sous-tuiles au lieu d'1 tuile sur l'axe transverse. La spec veut une mesure.

Run: `time pnpm scenario`
Expected: PASS. Noter la durée et la comparer à celle de `main` (`git stash && time pnpm scenario && git stash pop`). Consigner le facteur observé dans le message de commit. Le pathfinding, lui, ne paie rien (requêtes tuile).

- [ ] **Step 7: Vérifier les garde-fous et committer**

```bash
pnpm check && pnpm test && pnpm lint
git add packages/sim/src/balance.ts packages/sim/src/collision.test.ts
git commit -m "feat(sim): un arbre ne bloque plus que son tronc (0,25 tuile)"
```

---

## Task 3: `crownDepth` et `crownAlpha` — fonctions pures (client)

**Files:**
- Modify: `packages/client/src/render/framing.ts`
- Test: `packages/client/src/render/framing.test.ts`

**Interfaces:**
- Consumes: `Y_SORT_BASE`, `CANOPY_DEPTH`, `TILE_PX` (déjà dans `framing.ts`).
- Produces:
  - `CROWN_BASE = 900_000`, `CROWN_R_IN = 1.5`, `CROWN_R_OUT = 4.0`, `CROWN_ALPHA_MIN = 0.22`
  - `crownDepth(feetY: number, tilePx: number): number`
  - `crownAlpha(distTiles: number): number`

**Pourquoi une bande à part.** Un houppier ne s'étend que vers le **haut** de l'écran : celui d'un arbre planté en `ty` couvre les rangées `ty−2` à `ty`. Un acteur en `ty−1` est derrière l'arbre — l'occulter est juste. Un acteur en `ty+1` est devant — le houppier ne l'atteint pas. « Toujours au-dessus des acteurs » est donc correct **sans cas particulier**, et les houppiers n'ont qu'à se trier entre eux.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `packages/client/src/render/framing.test.ts` :

```ts
describe('houppiers : la bande de profondeur (A9)', () => {
  it('un houppier coiffe TOUT acteur atteignable sur la vallée canonique (3600 tuiles)', () => {
    const acteurLePlusAuSud = ySortDepth(3600, TILE, TIE_ACTOR)
    expect(crownDepth(0, TILE)).toBeGreaterThan(acteurLePlusAuSud)
  })

  it('un houppier reste SOUS la canopée, la nuit et les halos', () => {
    expect(crownDepth(3601, TILE)).toBeLessThan(CANOPY_DEPTH)
  })

  it('deux houppiers se trient entre eux par leur rangée', () => {
    expect(crownDepth(11, TILE)).toBeGreaterThan(crownDepth(10, TILE))
  })
})

describe('houppiers : le disque de découvert (A8)', () => {
  it('sous la cime (d ≤ R_IN) le houppier s’efface à A_MIN', () => {
    expect(crownAlpha(0)).toBe(CROWN_ALPHA_MIN)
    expect(crownAlpha(CROWN_R_IN)).toBe(CROWN_ALPHA_MIN)
  })

  it('au-delà de R_OUT la forêt est un couvert opaque', () => {
    expect(crownAlpha(CROWN_R_OUT)).toBe(1)
    expect(crownAlpha(50)).toBe(1)
  })

  it('entre les deux, l’alpha croît continûment (pas de scintillement en marchant)', () => {
    const mid = crownAlpha((CROWN_R_IN + CROWN_R_OUT) / 2)
    expect(mid).toBeGreaterThan(CROWN_ALPHA_MIN)
    expect(mid).toBeLessThan(1)
    let prev = crownAlpha(0)
    for (let d = 0; d <= 6; d += 0.05) {
      const a = crownAlpha(d)
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9) // monotone croissante
      prev = a
    }
  })

  it('les jointures sont continues (R_IN et R_OUT)', () => {
    expect(crownAlpha(CROWN_R_IN + 1e-6)).toBeCloseTo(CROWN_ALPHA_MIN, 5)
    expect(crownAlpha(CROWN_R_OUT - 1e-6)).toBeCloseTo(1, 5)
  })
})
```

Compléter l'import en tête du fichier :

```ts
import {
  actorPlacement,
  AMBIENT_DEPTH,
  CANOPY_DEPTH,
  CROWN_ALPHA_MIN,
  CROWN_R_IN,
  CROWN_R_OUT,
  crownAlpha,
  crownDepth,
  clutterDepth,
  corpseDepth,
  GROUND_FIRE_DEPTH,
  lookaheadOffset,
  nodeDepth,
  OVERLAY_DEPTH,
  structureDepth,
  TIE_ACTOR,
  Y_SORT_BASE,
  ySortDepth,
  zoomForFraming,
} from './framing'
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm --filter @braises/client exec vitest run src/render/framing.test.ts`
Expected: FAIL — `crownDepth is not a function` / `crownAlpha is not a function` (et l'import échoue à la compilation TS).

- [ ] **Step 3: Écrire l'implémentation**

Dans `packages/client/src/render/framing.ts`, juste avant `/** Coiffent le monde : canopée... */` (le bloc `CANOPY_DEPTH`) :

```ts
/* ── Les houppiers : une bande à eux seuls ───────────────────────────────────
 *
 * Au-dessus de tous les acteurs (la bande de tri Y plafonne à
 * `Y_SORT_BASE + 57 600` sur la vallée canonique de 3600 tuiles) et sous la
 * canopée. Correct SANS cas particulier : un houppier ne déborde que vers le
 * HAUT de l'écran, donc n'occulte que des acteurs situés au nord de son tronc —
 * qui sont bel et bien derrière lui. Les houppiers ne se trient qu'entre eux.
 */
export const CROWN_BASE = 900_000

/** Rayon du disque de découvert, en tuiles : en deçà, le houppier est effacé. */
export const CROWN_R_IN = 1.5
/** Au-delà, la forêt est un couvert opaque. */
export const CROWN_R_OUT = 4.0
/** Opacité résiduelle sous la cime : on devine le feuillage, on voit le sol. */
export const CROWN_ALPHA_MIN = 0.22
```

Puis, à la suite de `nodeDepth` :

```ts
/** Profondeur d'un houppier, dans sa bande propre, triée par la rangée de son
 * tronc. Même unité que la bande Y (le pixel monde) — mais jamais mêlée à elle. */
export function crownDepth(feetY: number, tilePx: number): number {
  return CROWN_BASE + feetY * tilePx
}

/**
 * Le disque de découvert : les houppiers s'effacent autour du joueur, les troncs
 * restent opaques. `distTiles` se mesure des pieds du joueur au PIED DU TRONC —
 * l'arbre à ton contact s'efface, celui dont la cime te survole de loin reste
 * opaque.
 *
 * Un alpha par sprite, fonction CONTINUE de la position du joueur : pas de
 * masque, pas de `RenderTexture`, pas d'`erase`, et donc aucun scintillement
 * quand on marche.
 */
export function crownAlpha(distTiles: number): number {
  if (distTiles <= CROWN_R_IN) return CROWN_ALPHA_MIN
  if (distTiles >= CROWN_R_OUT) return 1
  const t = (distTiles - CROWN_R_IN) / (CROWN_R_OUT - CROWN_R_IN)
  return CROWN_ALPHA_MIN + (1 - CROWN_ALPHA_MIN) * t
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `pnpm --filter @braises/client exec vitest run src/render/framing.test.ts`
Expected: PASS, y compris le test préexistant « la vallée canonique (3600 tuiles) ne perce pas la canopée ni la nuit ».

- [ ] **Step 5: Vérifier et committer**

```bash
pnpm check && pnpm test && pnpm lint
git add packages/client/src/render/framing.ts packages/client/src/render/framing.test.ts
git commit -m "feat(client): profondeur et alpha des houppiers — fonctions pures"
```

---

## Task 4: Les deux textures — tronc et houppier (client)

**Files:**
- Modify: `packages/client/src/scenes/BootScene.ts` (méthode `makeNodes`, lignes 101-145)

**Interfaces:**
- Consumes: rien.
- Produces: deux clés de texture Phaser — `nd-tree_trunk` (16×22) et `nd-tree_crown` (32×32). La clé `nd-tree` **disparaît**.

**Géométrie du sprite.** Le tronc s'ancre par les pieds (`tileFeetAnchor`, origine `0.5/1`) : il monte de 22 px au-dessus du bord bas de sa tuile. Le houppier s'ancre 6 px plus bas que le sommet du tronc, soit `py − 16`, et fait 32 px de haut. Total : `22 + 32 − 6 = 48` px = **trois tuiles**. Il est large de 32 px (deux tuiles) pour que la canopée se referme à 22 % de densité au lieu de faire des pois.

- [ ] **Step 1: Remplacer le bloc `nd-tree` par les deux textures**

Dans `makeNodes()`, remplacer les quatre lignes actuelles :

```ts
    g.fillStyle(0x4a3620).fillRect(6, 9, 4, 6) // arbre : tronc + houppier
    g.fillStyle(0x1e4d22).fillCircle(8, 6, 6)
    g.fillStyle(0x2d6b32).fillCircle(6, 5, 3)
    g.generateTexture('nd-tree', 16, 16)
    g.clear()
```

par :

```ts
    // Un arbre est HAUT (3 tuiles) et FIN (un tronc) — spec arbres hauts. Deux
    // sprites : le tronc, opaque et trié avec les acteurs ; le houppier, qui
    // coiffe le monde et s'efface autour du joueur.
    g.fillStyle(0x4a3620).fillRect(6, 0, 4, 22) // tronc : 4 px de large, 22 de haut
    g.fillStyle(0x5c4429).fillRect(6, 0, 2, 22) // une arête claire, pour le volume
    g.generateTexture('nd-tree_trunk', 16, 22)
    g.clear()

    g.fillStyle(0x1e4d22).fillCircle(16, 16, 15) // houppier : deux tuiles de large
    g.fillStyle(0x2d6b32).fillCircle(12, 12, 8) // lumière au nord-ouest (cf. hillshade)
    g.fillStyle(0x18401d).fillCircle(21, 22, 6) // ombre au sud-est
    g.generateTexture('nd-tree_crown', 32, 32)
    g.clear()
```

- [ ] **Step 2: Vérifier qu'aucune référence à `nd-tree` ne subsiste**

Run: `grep -rn "'nd-tree'" packages/client/src`
Expected: aucun résultat. (`snapshot-view.ts` construit sa clé par `` `nd-${n.type}` `` — c'est Task 5 qui la corrige ; à ce stade le jeu afficherait un carré vert manquant pour les arbres, ce qui est attendu et transitoire.)

- [ ] **Step 3: Vérifier et committer**

```bash
pnpm check && pnpm lint
git add packages/client/src/scenes/BootScene.ts
git commit -m "feat(client): textures placeholder du tronc et du houppier"
```

---

## Task 5: Dessiner les arbres hauts (client)

**Files:**
- Modify: `packages/client/src/scenes/world/snapshot-view.ts` (`renderNodes`, lignes 226-257 ; champs de pool, ligne 74)
- Modify: `packages/client/src/scenes/WorldScene.ts` (ligne 301, l'appel à `renderNodes`)

**Interfaces:**
- Consumes: `crownAlpha`, `crownDepth` (Task 3) ; `nd-tree_trunk`, `nd-tree_crown` (Task 4) ; `BALANCE.AVATAR_HITBOX_TILES`.
- Produces: `renderNodes(camera, playerX, playerY)` — la signature gagne deux paramètres (position logique de l'avatar prédit, en tuiles).

**Culling.** La fenêtre s'élargit de **3 rangées vers le bas** (la cime d'un arbre planté juste sous le bord de l'écran monte dans la vue) et d'**une colonne de chaque côté** (le houppier déborde d'une demi-tuile).

- [ ] **Step 1: Ajouter le pool de houppiers**

Dans `packages/client/src/scenes/world/snapshot-view.ts`, à côté de `private nodePool` (ligne 74) :

```ts
  private nodePool: Phaser.GameObjects.Image[] = []
  /** Pool SÉPARÉ : un arbre est deux sprites (tronc trié avec les acteurs,
   * houppier dans sa bande propre). Les autres nœuds n'en consomment aucun. */
  private crownPool: Phaser.GameObjects.Image[] = []
```

- [ ] **Step 2: Compléter les imports**

```ts
import {
  actorPlacement,
  corpseDepth,
  crownAlpha,
  crownDepth,
  GROUND_FIRE_DEPTH,
  nodeDepth,
  structureDepth,
  tileFeetAnchor,
  TILE_PX,
  type ActorFootprint,
} from '../../render/framing'
```

- [ ] **Step 3: Réécrire `renderNodes`**

Remplacer intégralement la méthode :

```ts
  /** Dessine les nœuds visibles (pool réutilisé). N'itère que la FENÊTRE de
   * tuiles caméra (≤1 nœud/tuile via l'index) — coût borné à la vue, jamais
   * O(nombre total de nœuds). Appelé chaque frame ; un nœud épuisé s'estompe.
   *
   * Un arbre est DEUX sprites : le tronc (opaque, trié avec les acteurs) et le
   * houppier (bande propre, alpha du disque de découvert). `playerX/playerY` sont
   * la position LOGIQUE de l'avatar en tuiles : le disque suit l'avatar, pas la
   * caméra, sinon il glisserait avec le lookahead du pointeur. */
  renderNodes(camera: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number): void {
    const v = camera.worldView
    // La fenêtre s'élargit : 3 rangées vers le BAS (les cimes des arbres plantés
    // sous le bord de l'écran montent dans la vue) et 1 colonne de chaque côté
    // (le houppier déborde d'une demi-tuile).
    const tx0 = Math.floor(v.x / TILE_PX) - 2
    const ty0 = Math.floor(v.y / TILE_PX) - 1
    const tx1 = Math.ceil((v.x + v.width) / TILE_PX) + 2
    const ty1 = Math.ceil((v.y + v.height) / TILE_PX) + 4
    const feetY = playerY + BALANCE.AVATAR_HITBOX_TILES / 2
    let used = 0
    let crownsUsed = 0
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const n = this.nodeByTile.get(tx * NODE_TILE_STRIDE + ty)
        if (n === undefined) continue
        const isTree = n.type === 'tree'
        const texture = isTree ? 'nd-tree_trunk' : `nd-${n.type}`
        let sprite = this.nodePool[used]
        if (!sprite) {
          sprite = this.scene.add.image(0, 0, texture).setOrigin(0.5, 1)
          this.nodePool[used] = sprite
        }
        const a = tileFeetAnchor(tx, ty, TILE_PX)
        sprite.setPosition(a.px, a.py)
        // Le sprite est POOLÉ : sa depth suit la tuile qu'il occupe cette frame,
        // jamais celle où il a été créé.
        sprite.setDepth(nodeDepth(ty, TILE_PX))
        sprite.setTexture(texture)
        // Le tronc reste OPAQUE en toutes circonstances : les troncs dessinent la
        // structure de la forêt, ce sont les houppiers qui s'ouvrent.
        sprite.setAlpha(n.stock > 0 ? 1 : 0.25)
        sprite.setVisible(true)
        used++
        if (!isTree) continue

        // Le houppier : ancré 6 px sous le sommet du tronc (22 px), donc à py−16.
        let crown = this.crownPool[crownsUsed]
        if (!crown) {
          crown = this.scene.add.image(0, 0, 'nd-tree_crown').setOrigin(0.5, 1)
          this.crownPool[crownsUsed] = crown
        }
        crown.setPosition(a.px, a.py - 16)
        crown.setDepth(crownDepth(ty + 1, TILE_PX))
        // Distance des pieds du joueur au PIED DU TRONC : l'arbre à ton contact
        // s'efface, celui dont la cime te survole de loin reste opaque.
        const dx = playerX - (tx + 0.5)
        const dy = feetY - (ty + 1)
        const d = Math.sqrt(dx * dx + dy * dy)
        crown.setAlpha(n.stock > 0 ? crownAlpha(d) : 0.25)
        crown.setVisible(true)
        crownsUsed++
      }
    }
    for (let i = used; i < this.nodePool.length; i++) this.nodePool[i]!.setVisible(false)
    for (let i = crownsUsed; i < this.crownPool.length; i++) this.crownPool[i]!.setVisible(false)
  }
```

(`BALANCE` est déjà importé de `@braises/sim` en tête du fichier.)

- [ ] **Step 4: Passer la position du joueur depuis `WorldScene`**

Dans `packages/client/src/scenes/WorldScene.ts`, ligne 301 :

```ts
    this.view.renderNodes(this.cameras.main)
```

devient :

```ts
    this.view.renderNodes(this.cameras.main, this.predicted.x, this.predicted.y)
```

- [ ] **Step 5: Vérifier que ça compile et que rien ne casse**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: PASS. Aucun test ne pilote Phaser (le cadrage est testé via `framing.ts`, pur) — c'est Task 6 qui juge à l'œil.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/world/snapshot-view.ts packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): l'arbre devient tronc + houppier, effacé par un disque autour du joueur"
```

---

## Task 6: Le regard — capture en forêt, calibrage, verdict

**Files:**
- Modify (calibrage seulement, si besoin) : `packages/client/src/render/framing.ts` (`CROWN_R_IN`, `CROWN_R_OUT`, `CROWN_ALPHA_MIN`), `packages/client/src/scenes/WorldScene.ts` (alpha du voile `canopy`)
- Modify: `docs/decisions.md` (une ligne)
- Modify: `docs/superpowers/specs/2026-07-10-arbres-hauts-hitbox-tronc-design.md` (statut → implémenté)

**Interfaces:**
- Consumes: tout le reste.
- Produces: un verdict — *la forêt est un sous-bois traversable* ou *c'est un mur de brocoli*.

**Rappel d'environnement** (mémoire `browser-smoke-test`) : `pnpm dev` est bloqué par un cache `.vite` appartenant à root. Passer par `build` + `preview`, piloter le Chromium mis en cache par `playwright-core` du projet Manif (`/home/alexis/projects/demo/node_modules/playwright-core`), et mener l'avatar via `window.__BRAISES__`.

**Rappel de méthode** (mémoire `fast-iteration-worldfeel`) : à partir d'ici, boucle courte — capture, tourne un bouton, recapture. Pas de spec ni de plan par itération.

- [ ] **Step 1: Construire et servir**

```bash
pnpm build
pnpm --filter @braises/client exec vite preview --port 4173
```

- [ ] **Step 2: Prendre les quatre captures**

Piloter Chromium (swiftshader) sur `http://localhost:4173`, mener l'avatar via `window.__BRAISES__`, et capturer :

1. **Un arbre isolé en prairie** — les trois tuiles de haut se lisent-elles ? le tronc est-il posé sur sa tuile ?
2. **L'avatar sous la canopée en forêt dense** — le disque de découvert s'ouvre-t-il ? les troncs restent-ils opaques ?
3. **L'avatar se faufilant entre deux troncs** — passe-t-il vraiment ? la collision se lit-elle comme le sprite le promet ?
4. **Un plan large de forêt** — la canopée se referme-t-elle à 22 % de densité, ou fait-elle des pois ?

- [ ] **Step 3: Présenter les captures en artefact**

Publier un artefact HTML avec les quatre captures en **grille 2×2** (préférence d'Alexis, mémoire `artifact-images-preference`), légendées, avec les valeurs des boutons utilisées.

- [ ] **Step 4: Tourner les boutons**

| Symptôme | Bouton |
|---|---|
| La forêt est un mur opaque, on ne voit plus ses pieds | `CROWN_ALPHA_MIN` ↓ ou `CROWN_R_IN` ↑ |
| Le trou autour du joueur est un projecteur, ça clignote | `CROWN_R_OUT` ↑ (transition plus douce) |
| Sous-bois trop sombre : le voile `canopy` ET les houppiers assombrissent deux fois | alpha du voile `canopy` (`WorldScene.ts:273`) ↓ |
| La canopée fait des pois, elle ne se referme pas | largeur du houppier (32 px) ↑, **avant** de toucher aux densités de `generateNodes` |
| Les houppiers noient les nœuds récoltables | `CROWN_ALPHA_MIN` ↓ |

- [ ] **Step 5: Rendre le verdict**

- **La forêt est un sous-bois traversable** → consigner une ligne dans `docs/decisions.md`, passer le statut de la spec à « implémenté », et rendre la main. Le décor cosmétique (`clutter.ts`, `cl-conifer` d'une tuile au pied d'arbres de trois) se juge **maintenant**, sur ces captures — c'est le hors-périmètre qui redevient d'actualité.
- **C'est un mur de brocoli** → consigner le verdict. Les boutons du disque ne suffisent pas : c'est la densité de `generateNodes` (22 % / 30 %) qui doit baisser, ce qui rejoint la spec `2026-07-09-noeuds-denses-recoltables-design.md` — le second projet en attente.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions.md docs/superpowers/specs/2026-07-10-arbres-hauts-hitbox-tronc-design.md packages/client/src/render/framing.ts
git commit -m "chore(arbres): calibrage à la capture — disque de découvert et voile de sous-bois"
```

---

## Ce que ce plan ne fait pas (hors périmètre, spec §Hors périmètre)

- Le décor cosmétique (`clutter.ts`, `cl-conifer`, `cl-big_trunk`) — jugé sur capture, après (Task 6 Step 5).
- `combat.ts` : aucune occultation du corps-à-corps. Le coup reste un arc de 90° à portée 1,4. On frappe à travers un tronc, comme on frappait déjà à travers un arbre pleine tuile.
- Le combat à distance, qui n'existe pas encore.
- Le pathfinding : il reste en tuiles pleines. Le joueur se faufile, la horde contourne — **la forêt devient un refuge**. C'est un fait de gameplay assumé, pas un défaut.
- La récolte : elle continue de viser la tuile du tronc. Cliquer un houppier ne récolte rien, ce qui est acceptable puisque le tronc reste toujours visible sous lui.
