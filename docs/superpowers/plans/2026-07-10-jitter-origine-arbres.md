# Décalage d'origine des arbres — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Décaler l'origine de chaque arbre d'une quantité pseudo-aléatoire déterministe par tuile — sprite ET collision ensemble — pour casser l'alignement des troncs en grille.

**Architecture:** Une fonction pure `treeJitter(tx, ty)` dans `/sim` dérive un décalage `{dx, dy}` en tuiles depuis `hash2` avec deux sels constants. Deux consommateurs l'appellent à l'identique — la collision (`blockedSubAt`, pour les arbres seuls) et le rendu (`renderNodes`, ancre + profondeur du tronc et du houppier). Aucun nouveau champ d'état, aucun seed propagé.

**Tech Stack:** TypeScript pur (`/sim`), Phaser 4 + Vite (`/client`), Vitest.

**Spec de référence :** `docs/superpowers/specs/2026-07-10-jitter-origine-arbres-design.md`
**Branche :** `feat/relief-terrasses`

## Global Constraints

- **`/sim` est pur** : zéro import Phaser / Colyseus / Node. Un lint ESLint le fait respecter — ne jamais le contourner.
- **`/sim` est déterministe au bit près.** Opérations autorisées : `+ - * /`, `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`, les constantes. **Interdit** : `sin`, `cos`, `pow`, `hypot`, `exp`, `log`, `**`, `Math.random`, `Date`, `performance`, timers. `hash2` (déjà dans `noise.ts`) n'utilise que `imul`, xor, shifts, `+`, `*` — bit-exact, autorisé.
- **Tout nombre d'équilibrage vit dans `packages/sim/src/balance.ts`**, jamais en dur dans la logique. Les sels de hash, eux, sont des constantes de module dans `economy.ts` (pas des nombres d'équilibrage) — même statut que `nodeSeed`/`keepSeed`/`0x6c8e9a3b` déjà présents.
- **`SimState` reste JSON-sérialisable** : pas de nouveau champ, pas de classes, pas de `Map`/`Set` dedans. Le décalage est **dérivé**, jamais stocké.
- **Parité prédiction/autorité** : `treeJitter` est une fonction pure de `(tx, ty)`, appelée à l'identique par le tick serveur, la prédiction et le rendu. C'est la garantie par construction — ne jamais la faire dépendre d'un état mutable.
- **Non-régression du filet de déterminisme** : `prediction.test.ts`, `replay.test.ts`, `sim.test.ts`, `events.test.ts` passent **sans qu'une assertion existante bouge** — ils garantissent la parité et le déterminisme, que ce changement ne doit pas toucher. Le banc `scenario.test.ts` peut changer de trajectoire (les PNJ frôlent des troncs déplacés) — attendu ; non-régression seulement s'il y a effondrement réel (villages vivants, greniers positifs).
- **Exception documentée — `collision.test.ts` A1-A7** : ces tests, ajoutés à la tranche « hitbox de tronc », affirment des positions de tronc **au centre exact de la tuile** (clamp `8.075`, couloir `0.75`, `overlapsBlocking` en des points précis). Le décalage d'origine change délibérément cette géométrie : A2, A3 (arbre en `(8,4)`) et A1, A7 (paire `(6,4)/(7,4)`) deviennent faux et **doivent être reformulés en fonction de `treeJitter(tx, ty)`** (Task 2, Step 3bis). Ce n'est pas masquer une régression — c'est que ces tests encodaient une hypothèse que cette feature lève. A4/A5/A6 (rochers, stock 0, requête tuile) survivent tels quels : le jitter ne les touche pas.
- **Avant chaque commit** : `pnpm check`, `pnpm test`, `pnpm lint` doivent passer.
- Code et docs en **français**, identifiants de code en **anglais**.

## Constantes exactes (copiées de la spec)

| Constante | Valeur | Où |
|---|---|---|
| `BALANCE.TREE_JITTER_TILES` | `0.22` (départ, calibré en jeu) | `packages/sim/src/balance.ts` |
| `JITTER_SALT_X` | `0x1f83d9ab` | constante de module, `economy.ts` |
| `JITTER_SALT_Y` | `0x5be0cd19` | constante de module, `economy.ts` |
| Borne dure | `TREE_JITTER_TILES + blockHalfSub/SUB ≤ 0.5` | invariant testé (Task 2) |

(Les deux sels sont des mots de 32 bits arbitraires et distincts — repris des constantes d'init SHA-512 pour n'avoir aucune structure commune. Toute paire de constantes distinctes conviendrait ; ces valeurs sont fixées ici pour que le motif de décalage soit reproductible.)

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `packages/sim/src/balance.ts` | `TREE_JITTER_TILES` dans le bloc `BALANCE` | 1 |
| `packages/sim/src/economy.ts` | `treeJitter(tx, ty)` pure + les deux sels | 1 |
| `packages/sim/src/index.ts` | réexport de `treeJitter` (barrel, pour le client) | 1 |
| `packages/sim/src/economy.test.ts` | critères 1-4 (déterminisme, bornes, décorrélation) | 1 |
| `packages/sim/src/collision.ts` | `blockedSubAt` décale le centre pour les arbres | 2 |
| `packages/sim/src/collision.test.ts` | critères 5-8 (non-débordement, clamp jittéré, rochers, fourré) | 2 |
| `packages/client/src/scenes/world/snapshot-view.ts` | `renderNodes` : ancre + profondeur décalées | 3 |
| `docs/decisions.md`, la spec | verdict et calibrage | 4 |

**Ordre des tâches.** Task 1 livre la fonction pure et ses tests, isolément. Task 2 la branche dans la collision (le seul point de correction délicat : la borne de non-débordement). Task 3 est du rendu pur, jugé à l'œil. Task 4 calibre `J` en jeu.

---

## Task 1: `treeJitter` — la fonction de décalage (`/sim`)

**Files:**
- Modify: `packages/sim/src/balance.ts` (ajout dans le bloc `BALANCE`, près de `SUBTILES_PER_TILE`)
- Modify: `packages/sim/src/economy.ts` (nouvelle fonction exportée + deux sels ; `hash2` est déjà importé de `./noise` à la ligne 39)
- Modify: `packages/sim/src/index.ts` (réexport)
- Test: `packages/sim/src/economy.test.ts`

**Interfaces:**
- Consumes: `hash2(x, y, seed)` de `./noise` (déjà importé), `BALANCE` de `./balance`.
- Produces: `export function treeJitter(tx: number, ty: number): { dx: number; dy: number }` — décalage en **tuiles**, chaque composante dans `[−J, +J]` où `J = BALANCE.TREE_JITTER_TILES`.

- [ ] **Step 1: Ajouter `TREE_JITTER_TILES` dans `BALANCE`**

Dans `packages/sim/src/balance.ts`, juste après le bloc `SUBTILES_PER_TILE` (la constante ajoutée à la tranche précédente, vers la ligne 80) :

```ts
  /** Amplitude du décalage pseudo-aléatoire de l'origine d'un arbre, en tuiles
   * (spec décalage d'origine). Chaque arbre est décalé de ±cette valeur en X et
   * en Y pour casser l'alignement des troncs en grille. BORNE DURE :
   * `TREE_JITTER_TILES + blockHalfSub(tree)/SUBTILES_PER_TILE ≤ 0.5`, sinon le
   * carré bloquant d'un arbre décalé déborde dans la tuile voisine et échappe à
   * la collision (testé). Avec blockHalfSub 1 et SUB 8 : plafond 0,375. Calibré
   * en jeu (départ 0,22). */
  TREE_JITTER_TILES: 0.22,
```

- [ ] **Step 2: Écrire les tests qui échouent**

Ajouter à la fin de `packages/sim/src/economy.test.ts`. D'abord vérifier l'import en tête du fichier — ajouter `treeJitter` à l'import existant depuis `./economy` (et `BALANCE` depuis `./balance` s'il n'y est pas déjà) :

```ts
import { BALANCE } from './balance'
// ... et ajouter treeJitter à l'import { ... } from './economy'
```

Puis les tests :

```ts
describe('treeJitter — décalage déterministe de l’origine des arbres', () => {
  const J = BALANCE.TREE_JITTER_TILES

  it('est déterministe : deux appels sur la même tuile rendent le même décalage', () => {
    const a = treeJitter(37, 91)
    const b = treeJitter(37, 91)
    expect(a).toEqual(b)
  })

  it('est borné à ±J sur un large échantillon de tuiles', () => {
    for (let ty = 0; ty < 40; ty++) {
      for (let tx = 0; tx < 40; tx++) {
        const { dx, dy } = treeJitter(tx, ty)
        expect(Math.abs(dx)).toBeLessThanOrEqual(J)
        expect(Math.abs(dy)).toBeLessThanOrEqual(J)
      }
    }
  })

  it('n’est pas diagonal : dx et dy sont décorrélés (au moins une tuile avec dx ≠ dy)', () => {
    let seenDifferent = false
    for (let tx = 0; tx < 20 && !seenDifferent; tx++) {
      const { dx, dy } = treeJitter(tx, 5)
      if (dx !== dy) seenDifferent = true
    }
    expect(seenDifferent).toBe(true)
  })

  it('couvre le négatif ET le positif sur les deux axes (pas de biais d’un côté)', () => {
    let hasNegX = false, hasPosX = false, hasNegY = false, hasPosY = false
    for (let ty = 0; ty < 40; ty++) {
      for (let tx = 0; tx < 40; tx++) {
        const { dx, dy } = treeJitter(tx, ty)
        if (dx < 0) hasNegX = true
        if (dx > 0) hasPosX = true
        if (dy < 0) hasNegY = true
        if (dy > 0) hasPosY = true
      }
    }
    expect(hasNegX && hasPosX && hasNegY && hasPosY).toBe(true)
  })
})
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm --filter @braises/sim exec vitest run src/economy.test.ts -t "treeJitter"`
Expected: FAIL — `treeJitter is not a function` (l'import ne résout pas).

- [ ] **Step 4: Écrire `treeJitter` et les sels**

Dans `packages/sim/src/economy.ts`, près des autres constantes de sel (au-dessus de `generateNodes`, à côté de `GROVE_MEAN_SQ`) :

```ts
/* Sels du décalage d'origine des arbres. Deux mots de 32 bits DISTINCTS (init
 * SHA-512, aucune structure commune) : X et Y doivent être décorrélés, sinon
 * dx = dy et les arbres ne se décalent qu'en diagonale. Ce ne sont pas des
 * nombres d'équilibrage — le motif de décalage est fixe, pas un réglage. */
const JITTER_SALT_X = 0x1f83d9ab
const JITTER_SALT_Y = 0x5be0cd19
```

Et la fonction (à côté de `generateNodes`, exportée) :

```ts
/**
 * Décalage pseudo-aléatoire de l'origine d'un arbre, DÉTERMINISTE par tuile et
 * borné à ±`BALANCE.TREE_JITTER_TILES` (tuiles), en X et en Y. Pure, sans état,
 * sans seed de monde : `hash2(tx, ty, sel)` à sels constants suffit — identique
 * sur le serveur, dans la prédiction du client et au rendu (invariant 2).
 * `hash2 ∈ [0,1)` → `(h·2−1)·J ∈ [−J, J)`. N'utilise que `+ − * /` et `hash2`.
 * Appelée dans la boucle chaude de la collision : la garder triviale.
 */
export function treeJitter(tx: number, ty: number): { dx: number; dy: number } {
  const j = BALANCE.TREE_JITTER_TILES
  const dx = (hash2(tx, ty, JITTER_SALT_X) * 2 - 1) * j
  const dy = (hash2(tx, ty, JITTER_SALT_Y) * 2 - 1) * j
  return { dx, dy }
}
```

- [ ] **Step 5: Réexporter depuis le barrel**

Dans `packages/sim/src/index.ts`, à la ligne qui exporte `generateNodes` (ligne 101) :

```ts
export { generateNodes, treeJitter } from './economy'
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `pnpm --filter @braises/sim exec vitest run src/economy.test.ts`
Expected: PASS — les 4 tests neufs, et tout le fichier préexistant.

- [ ] **Step 7: Vérifier les garde-fous**

Run: `pnpm check && pnpm lint`
Expected: PASS. `pnpm lint` vérifie la pureté de `/sim` — `treeJitter` n'utilise que `hash2`, `+ − *` et une constante.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/balance.ts packages/sim/src/economy.ts packages/sim/src/index.ts packages/sim/src/economy.test.ts
git commit -m "feat(sim): treeJitter — décalage déterministe de l'origine d'un arbre"
```

---

## Task 2: La collision suit le tronc décalé (`/sim`)

**Files:**
- Modify: `packages/sim/src/collision.ts` (`blockedSubAt`, le bloc `if (world.nodes)` vers les lignes 137-147 ; ajout de l'import `treeJitter`)
- Test: `packages/sim/src/collision.test.ts` (nouvelle série B ; **suppression** de A1/A2/A3/A7, cf. Step 4)

**Interfaces:**
- Consumes: `treeJitter(tx, ty)` de `./economy` (Task 1) ; `BALANCE.SUBTILES_PER_TILE`, `NODE_DEFS[type].blockHalfSub` (déjà en place).
- Produces: `blockedSubAt` décale le centre du carré bloquant **pour les arbres seuls**. Aucune nouvelle signature publique.

**Rappel de géométrie.** Le carré bloquant d'un arbre est `[cx−h, cx+h) × [cy−h, cy+h)` avec `h = blockHalfSub` (en sous-tuiles) et, sans jitter, `cx = tx·SUB + SUB/2`. Le jitter ajoute `dx·SUB` (et `dy·SUB`) au centre. La borne dure `J + h/SUB ≤ 0,5` garantit que ce carré reste dans `[tx·SUB, (tx+1)·SUB)`, donc `blockedSubAt` n'a toujours qu'à consulter le nœud de la tuile courante.

**Le couloir est vertical.** Deux arbres orthogonalement voisins `(tx, ty)` et `(tx+1, ty)` sont sur la même rangée ; le passage entre eux est la fente **verticale** qu'un avatar franchit en montant/descendant à `x ≈ tx+1`. Sa largeur = `0,75 + dx(tx+1) − dx(tx)` (la face droite du tronc gauche à la face gauche du tronc droit). Pincée sous 0,6 → l'avatar qui descend est bloqué ; large → il passe.

**Consolidation des tests (décision d'Alexis, 2026-07-10).** Le jitter rend faux quatre tests centrés-tronc de la tranche « hitbox de tronc » (A1, A2, A3, A7 — clamp `8.075`, couloir `0.75`, `overlapsBlocking` en points fixes). On les **retire** et la série B ci-dessous devient la source unique, jitter-aware. A4/A5/A6 (rochers, stock 0, requête tuile) restent : le jitter ne les touche pas, et A4 couvre déjà « les rochers ne sont pas décalés » — on ne le re-teste pas en B.

- [ ] **Step 1: Écrire la série B (tests qui échouent)**

Vérifier d'abord les imports en tête de `collision.test.ts`. Ajouter `treeJitter` à l'import depuis `./economy`, et `NODE_DEFS` à l'import depuis `./balance` :

```ts
import { BALANCE, NODE_DEFS, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_ROCK, TICK_DT_S } from './balance'
import { isBlockedAt, makeIndexedIsBlockedAt, moveAvatar, moveAvatarStepped, overlapsBlocking } from './collision'
import { treeJitter, type ResourceNode } from './economy'
```

(Adapter à l'existant : garder les autres symboles déjà importés de `./balance` et `./collision`. L'essentiel : `NODE_DEFS` et `treeJitter` deviennent disponibles.)

Puis, à la fin du fichier, la série B :

```ts
describe('décalage d’origine des arbres : la collision suit le tronc', () => {
  const SUB = BALANCE.SUBTILES_PER_TILE
  const J = BALANCE.TREE_JITTER_TILES
  const H_TREE = NODE_DEFS.tree.blockHalfSub / SUB // demi-côté du tronc, en tuiles (0,125)
  const treeWorld = (trees: Array<[number, number]>, width = 16): { map: WorldMap; nodes: ResourceNode[] } => ({
    map: createEmptyMap(width, 16, TERRAIN_GRASS),
    nodes: trees.map(([tx, ty], i) => ({ id: i + 1, type: 'tree' as const, tx, ty, stock: 10, regrowAt: 0 })),
  })
  /** Le couloir vertical (tuiles) entre les arbres (tx,ty) et (tx+1,ty). */
  const corridor = (tx: number, ty: number): number =>
    0.75 + treeJitter(tx + 1, ty).dx - treeJitter(tx, ty).dx
  /** Centre X du couloir, face droite du tronc gauche → face gauche du tronc droit. */
  const corridorCenter = (tx: number, ty: number): number => {
    const left = tx + 0.5 + treeJitter(tx, ty).dx + H_TREE
    const right = tx + 1.5 + treeJitter(tx + 1, ty).dx - H_TREE
    return (left + right) / 2
  }

  it('B1 — borne de non-débordement : le carré d’un arbre décalé reste dans sa tuile', () => {
    // Garde-fou contre un futur recalibrage de J OU de blockHalfSub : la borne DOIT tenir.
    expect(J + H_TREE).toBeLessThanOrEqual(0.5)
    // Et concrètement, sur un échantillon : les bords du carré ∈ [tx,tx+1[ × [ty,ty+1[.
    for (let ty = 0; ty < 30; ty++) {
      for (let tx = 0; tx < 30; tx++) {
        const { dx, dy } = treeJitter(tx, ty)
        const cx = tx + 0.5 + dx
        const cy = ty + 0.5 + dy
        expect(cx - H_TREE).toBeGreaterThanOrEqual(tx)
        expect(cx + H_TREE).toBeLessThanOrEqual(tx + 1)
        expect(cy - H_TREE).toBeGreaterThanOrEqual(ty)
        expect(cy + H_TREE).toBeLessThanOrEqual(ty + 1)
      }
    }
  })

  it('B2 — un avatar bute sur le tronc DÉCALÉ, pas sur le centre de la tuile', () => {
    const TX = 8, TY = 4
    const { dx } = treeJitter(TX, TY)
    const world = treeWorld([[TX, TY]])
    const expected = TX + 0.5 + dx - H_TREE - HALF // face gauche du tronc décalé − demi-avatar
    let p = { x: 5.5, y: TY + 0.5 }
    for (let t = 0; t < 60; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBeCloseTo(expected, 9)
    expect(p.y).toBe(TY + 0.5)
  })

  it('B3 — le fourré est réel : une paire pincée bloque un avatar de 0,6 qui descend à travers', () => {
    const TY = 4
    let best = { tx: -1, gap: Infinity }
    for (let tx = 0; tx < 400; tx++) {
      const g = corridor(tx, TY)
      if (g < best.gap) best = { tx, gap: g }
    }
    // À J=0,22 des fourrés existent forcément (sinon le choix « franc » serait vide).
    expect(best.gap).toBeLessThan(BALANCE.AVATAR_HITBOX_TILES)
    const world = treeWorld([[best.tx, TY], [best.tx + 1, TY]], best.tx + 3)
    let p = { x: corridorCenter(best.tx, TY), y: TY - 1.5 }
    for (let t = 0; t < 120; t++) p = moveAvatar(world, p.x, p.y, 0, 1, TICK_DT_S)
    expect(p.y).toBeLessThan(TY) // arrêté AVANT la rangée : le fourré bloque
  })

  it('B4 — au couloir large, l’avatar (0,6) se faufile entre deux arbres voisins', () => {
    const TY = 4
    let best = { tx: -1, gap: -Infinity }
    for (let tx = 0; tx < 400; tx++) {
      const g = corridor(tx, TY)
      if (g > best.gap) best = { tx, gap: g }
    }
    expect(best.gap).toBeGreaterThan(BALANCE.AVATAR_HITBOX_TILES) // des passages existent
    const world = treeWorld([[best.tx, TY], [best.tx + 1, TY]], best.tx + 3)
    let p = { x: corridorCenter(best.tx, TY), y: TY - 1.5 }
    for (let t = 0; t < 60; t++) p = moveAvatar(world, p.x, p.y, 0, 1, TICK_DT_S)
    expect(p.y).toBeGreaterThan(TY + 1) // passé au sud de la rangée
  })

  it('B5 — contrat SOUS-TUILE : overlapsBlocking suit le tronc décalé', () => {
    const TX = 8, TY = 4
    const { dx, dy } = treeJitter(TX, TY)
    const world = treeWorld([[TX, TY]])
    expect(overlapsBlocking(world, TX + 0.5 + dx, TY + 0.5 + dy)).toBe(true) // sur le tronc décalé
    expect(overlapsBlocking(world, TX + 0.5, TY - 2)).toBe(false) // deux tuiles au nord : rien
  })
})
```

- [ ] **Step 2: Lancer la série B pour vérifier qu'elle échoue**

Run: `pnpm --filter @braises/sim exec vitest run src/collision.test.ts -t "décalage d’origine"`
Expected : **B2 et B3 échouent** — ce sont les discriminants nets. Sans le décalage dans la collision, B2 clampe au centre (`TX + 0,375 − 0,3`) au lieu de la face décalée, et B3 laisse l'avatar **traverser** un couloir que la géométrie dit pincé (`p.y > TY`, l'assertion `< TY` casse). B1 passe déjà (géométrie pure sur `treeJitter`). B4 et B5 sont des propriétés de **correction côté GREEN** : elles peuvent passer dès le RED selon la géométrie des tuiles — c'est normal, elles ne sont pas des discriminants. **Ne pas continuer tant que B2 et B3 ne sont pas rouges pour ces raisons.**

- [ ] **Step 3: Décaler le centre dans `blockedSubAt`**

Dans `packages/sim/src/collision.ts`, ajouter `treeJitter` à l'import existant depuis `./economy` :

```ts
import { nodeAt, treeJitter, type ResourceNode } from './economy'
```

Puis remplacer le bloc `if (world.nodes)` de `blockedSubAt` (lignes ~137-147) par :

```ts
  if (world.nodes) {
    const n = nodeAt(world.nodes, tx, ty)
    if (n !== undefined && n.stock > 0) {
      const h = NODE_DEFS[n.type].blockHalfSub
      if (h > 0) {
        // Un arbre est décalé dans sa tuile (spec décalage d'origine) ; les
        // autres nœuds restent centrés. La borne J + h/SUB ≤ 0,5 garantit que le
        // carré décalé reste dans la tuile, donc regarder le seul nœud d'ici suffit.
        let cx = tx * SUB + SUB / 2
        let cy = ty * SUB + SUB / 2
        if (n.type === 'tree') {
          const { dx, dy } = treeJitter(tx, ty)
          cx += dx * SUB
          cy += dy * SUB
        }
        if (sx >= cx - h && sx < cx + h && sy >= cy - h && sy < cy + h) return true
      }
    }
  }
```

- [ ] **Step 4: Retirer A1, A2, A3, A7 (superssédés par la série B)**

Dans le describe `'arbres hauts : la collision se limite au tronc'` de `collision.test.ts`, **supprimer** les quatre blocs `it('A1 …')`, `it('A2 …')`, `it('A3 …')`, `it('A7 …')`. **Garder** `it('A4 …')`, `it('A5 …')`, `it('A6 …')` et le helper `forest` (encore utilisé par A6). Ne rien changer d'autre dans ces trois-là.

Justification à mettre dans le message de commit : A1-A3/A7 affirmaient des positions de tronc **centrées** que le décalage rend fausses ; B2 (clamp jittéré), B3 (fourré), B4 (passage), B5 (overlaps jittéré) reprennent leur intention en version jitter-aware, sans doublon.

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `pnpm --filter @braises/sim exec vitest run src/collision.test.ts`
Expected: PASS — la série B (B1-B5), A4/A5/A6, et tout le reste du fichier. Plus aucune trace de A1/A2/A3/A7.

- [ ] **Step 6: Relancer le filet complet**

Run: `pnpm test`
Expected: PASS. `prediction.test.ts`, `replay.test.ts`, `sim.test.ts`, `events.test.ts` ne bougent pas (aucun ne place d'arbre sur la trajectoire d'un avatar ; le déterminisme est préservé — `treeJitter` est pur). Si `scenario.test.ts` change de trajectoire, vérifier l'absence d'effondrement réel (villages vivants, greniers positifs) avant de conclure.

- [ ] **Step 7: Vérifier et committer**

```bash
pnpm check && pnpm test && pnpm lint
git add packages/sim/src/collision.ts packages/sim/src/collision.test.ts
git commit -m "feat(sim): la collision d'un arbre suit son tronc décalé

Le centre du carré bloquant d'un arbre est décalé de treeJitter(tx,ty)
(les autres nœuds restent centrés). Série B jitter-aware : non-débordement
(B1), clamp sur le tronc décalé (B2), fourré pincé qui bloque (B3),
couloir large qui passe (B4), overlapsBlocking décalé (B5). A1/A2/A3/A7
(centrés-tronc) retirés — supersédés ; A4/A5/A6 (rochers, stock 0,
requête tuile) inchangés car le jitter ne les touche pas."
```

## Task 3: Le rendu suit le tronc décalé (client)

**Files:**
- Modify: `packages/client/src/scenes/world/snapshot-view.ts` (`renderNodes`, le corps de la boucle, lignes ~250-290)

**Interfaces:**
- Consumes: `treeJitter(tx, ty)` de `@braises/sim` (réexporté au barrel, Task 1) ; `nodeDepth`, `crownDepth`, `tileFeetAnchor`, `TILE_PX` de `framing.ts` (déjà importés).
- Produces: le sprite du tronc, le sprite du houppier et **leur profondeur de tri** décalés du même `{dx, dy}` que la collision.

**Rappel des profondeurs.** `nodeDepth(ty)` calcule en interne `ySortDepth(ty + 1, …)` — le pied est `ty + 1`. `crownDepth(feetY)` prend le pied directement, et l'appelant passe `ty + 1`. Pour intégrer le jitter Y au tri, on remplace `ty` par `ty + dy` dans `nodeDepth` (qui rajoute son `+1`) et `ty + 1` par `ty + 1 + dy` dans `crownDepth`.

- [ ] **Step 1: Ajouter l'import `treeJitter`**

Dans `packages/client/src/scenes/world/snapshot-view.ts`, l'import depuis `@braises/sim` en tête du fichier liste déjà `BALANCE`, `type ResourceNode`, etc. Ajouter `treeJitter` :

```ts
import {
  BALANCE,
  STRUCTURE_HP,
  treeJitter,
  type Corpse,
  type Entity,
  type Monster,
  type Npc,
  type ResourceNode,
  type Structure,
} from '@braises/sim'
```

(Respecter l'ordre existant de l'import ; l'essentiel est que `treeJitter` y figure.)

- [ ] **Step 2: Décaler l'ancre et la profondeur dans `renderNodes`**

Dans la boucle de `renderNodes`, le tronc/nœud est aujourd'hui posé ainsi :

```ts
        const a = tileFeetAnchor(tx, ty, TILE_PX)
        sprite.setPosition(a.px, a.py)
        // Le sprite est POOLÉ : sa depth suit la tuile qu'il occupe cette frame,
        // jamais celle où il a été créé.
        sprite.setDepth(nodeDepth(ty, TILE_PX))
        sprite.setTexture(texture)
```

Le remplacer par (le décalage n'est calculé que pour les arbres ; les autres nœuds gardent l'ancre de tuile exacte) :

```ts
        // Un arbre est décalé dans sa tuile (spec décalage d'origine) — MÊME
        // fonction pure que la collision, donc sprite et hitbox coïncident au bit
        // près. Les autres nœuds restent centrés sur leur tuile.
        const j = isTree ? treeJitter(tx, ty) : { dx: 0, dy: 0 }
        const a = tileFeetAnchor(tx, ty, TILE_PX)
        const px = a.px + j.dx * TILE_PX
        const py = a.py + j.dy * TILE_PX
        sprite.setPosition(px, py)
        // Le sprite est POOLÉ : sa depth suit la tuile qu'il occupe cette frame,
        // jamais celle où il a été créé. Le pied réel intègre le décalage Y, pour
        // que deux arbres proches se trient par leur vrai pied, pas par le pool.
        sprite.setDepth(nodeDepth(ty + j.dy, TILE_PX))
        sprite.setTexture(texture)
```

- [ ] **Step 3: Décaler le houppier du même `{dx, dy}`**

Plus bas dans la même boucle, le houppier est aujourd'hui :

```ts
        crown.setPosition(a.px, a.py - 16)
        crown.setDepth(crownDepth(ty + 1, TILE_PX))
```

Le remplacer par (réutiliser `px`, `py` et `j` calculés au Step 2 — ils sont dans la portée de la même itération) :

```ts
        crown.setPosition(px, py - 16)
        crown.setDepth(crownDepth(ty + 1 + j.dy, TILE_PX))
```

Le disque de découvert (`dx`/`dy` du joueur au pied du tronc, quelques lignes plus bas) reste mesuré vers `(tx + 0.5, ty + 1)` : décaler la cible du disque du jitter est possible mais non demandé par la spec, et la différence (≤ 0,22 tuile) est en deçà de la résolution du disque (R_IN 1,5 / R_OUT 4,0). **Ne pas y toucher.**

- [ ] **Step 4: Vérifier que ça compile et que rien ne casse**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: PASS. Aucun test ne pilote Phaser ; le rendu se juge à l'œil en Task 4. `pnpm check` valide que `treeJitter` est bien exporté par `@braises/sim` et que les types collent.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/world/snapshot-view.ts
git commit -m "feat(client): le tronc et le houppier suivent l'origine décalée de l'arbre"
```

---

## Task 4: Le regard — la grille a-t-elle disparu ?

**Files:**
- Modify (calibrage seulement, si besoin) : `packages/sim/src/balance.ts` (`TREE_JITTER_TILES`)
- Modify: `docs/decisions.md` (une ligne), la spec (statut → implémenté)

**Interfaces:**
- Consumes: tout le reste.
- Produces: un verdict — *la grille a disparu* ou *il en faut plus / moins* — et la valeur calibrée de `J`.

**Rappel d'environnement** (mémoire `browser-smoke-test`) : `pnpm dev` est bloqué par un cache `.vite` root. Passer par `build` + `preview`, piloter le Chromium en cache de `playwright-core` (`/home/alexis/projects/demo/node_modules/playwright-core`), mener l'avatar via `window.__BRAISES__`. **L'autorité resnappe tout téléport forcé de `prediction.base`** : pour cadrer une forêt, mener l'avatar AU CLAVIER depuis le spawn (leçon de la tranche précédente).

**Rappel de méthode** (mémoire `fast-iteration-worldfeel`) : boucle courte — capture, tourne `J`, recapture. Pas de spec ni de plan par itération.

- [ ] **Step 1: Construire et servir**

```bash
pnpm build
pnpm --filter @braises/client exec vite preview --port 4173
```

- [ ] **Step 2: Capturer avant/après en forêt dense**

Piloter Chromium (swiftshader) sur `http://localhost:4173`, mener l'avatar au clavier jusqu'à un bloc de forêt dense (chercher la tuile la plus dense en arbres près du spawn, comme à la tranche précédente). Deux captures qui parlent :

1. **La forêt dense au repos** — la grille de troncs a-t-elle disparu ? les troncs semblent-ils semés, pas plantés au cordeau ?
2. **Un couloir** — reste-t-il des passages, ou la forêt est-elle devenue un mur de fourrés pincés ?

Pour un contrôle net, capturer aussi une fois avec `J = 0` (troncs centrés, l'ancienne grille) et une fois avec `J` courant, au **même endroit** — l'écart doit sauter aux yeux.

- [ ] **Step 3: Présenter les captures en artefact**

Publier un artefact HTML avec les captures en **grille 2×2** (préférence d'Alexis, mémoire `artifact-images-preference`), légendées, avec la valeur de `J` utilisée.

- [ ] **Step 4: Tourner le bouton**

| Symptôme | Bouton |
|---|---|
| La grille se lit encore, troncs trop réguliers | `TREE_JITTER_TILES` ↑ (plafond dur **0,375**) |
| Trop de fourrés pincés, la forêt devient un mur | `TREE_JITTER_TILES` ↓ |
| Les troncs semblent flotter hors de leur touffe de décor | à regarder avec le décor cosmétique, hors périmètre |

Après chaque changement de `J` : `pnpm build` puis recapture. **Ne jamais dépasser 0,375** (au-delà, le test B1 de non-débordement casse — la collision deviendrait fausse).

- [ ] **Step 5: Rendre le verdict**

- **La grille a disparu, la forêt reste traversable** → consigner `J` final et une ligne dans `docs/decisions.md`, passer le statut de la spec à « implémenté ». Si `J` a changé, relancer `pnpm test` (le test B1 verrouille la borne ; B4 dépend de `J`).
- **Compromis impossible à ce plafond** (grille encore visible à 0,375, ou fourrés déjà trop dense avant que la grille ne casse) → consigner le constat. La piste suivante serait un tronc plus fin (`blockHalfSub` de 1 → réduire encore relâche la borne à `J ≤ 0,5 − h/SUB`), à rouvrir en brainstorm.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions.md docs/superpowers/specs/2026-07-10-jitter-origine-arbres-design.md packages/sim/src/balance.ts
git commit -m "chore(arbres): calibrage du décalage d'origine à la capture"
```

---

## Hors périmètre (spec §Hors périmètre)

- Le décor cosmétique (`cl-conifer`, souches) et sa relation aux troncs décalés — jugé avec lui, séparément.
- Toute rotation ou mise à l'échelle par arbre — seul le décalage d'origine est demandé.
- Le pathfinding (reste en tuiles pleines ; une tuile à arbre est bloquée où que soit le tronc) et la coupe de coin A* (dette `milice-livelock`).
- La récolte (vise la tuile ; le tronc décalé y reste).
