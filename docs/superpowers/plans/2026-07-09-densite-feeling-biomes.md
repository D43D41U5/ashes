# Densité & feeling des biomes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre chaque biome visuellement dense et vivant (décor cosmétique client) et la récolte plus lisible/groupée (clustering des nœuds), à budget de transport constant.

**Architecture:** Deux systèmes découplés. (1) `/sim` : `generateNodes` regroupe les nœuds via un champ de bruit spatial quand la carte est sous-échantillonnée (`density < 1`), sans changer le total. (2) Client : une couche de décor cosmétique **culled à la vue**, jamais dans le sim ni les snapshots — un module pur (`clutterAt` + table `BIOME_CLUTTER`) plus un helper de scène qui pool les sprites. Les deux dérivent leurs champs du **même seed** pour que bosquets de nœuds et massifs de décor coïncident.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Phaser 4. Bruit déterministe via `@braises/sim` (`fbm2`, `hash2` dans `noise.ts`).

## Global Constraints

Copiées verbatim de la spec (`docs/superpowers/specs/2026-07-09-densite-feeling-biomes-design.md`) et des invariants CLAUDE.md :

- **`/sim` pur** : zéro import Phaser/Colyseus/Node dans `packages/sim`. Le décor cosmétique vit UNIQUEMENT dans `packages/client`.
- **`/sim` déterministe bit-exact** : opérations autorisées `+ - * / Math.sqrt abs floor ceil round trunc sign min max imul fround` + constantes. INTERDITS : `Math.random`, `Date`, `sin/cos/pow/exp/log/hypot`, `**`. `fbm2`/`hash2` respectent déjà cette règle.
- **INV-1** : le décor cosmétique n'a AUCUNE collision (il n'existe pas dans `/sim`) — structurellement non bloquant.
- **INV-2** : props décoratifs plus petits (~0,6×), ternis, sans « fruit »/affordance — jamais confondus avec un nœud récoltable.
- **INV-3** : déterminisme `generateNodes` préservé (mêmes seed+tuiles → mêmes nœuds).
- **INV-4** : total de nœuds dans ±10 % de l'ancien (budget de transport inchangé).
- **INV-5** : décor déterministe par tuile → aucun scintillement au pan/zoom.
- **INV-6** : répartition organique par champ spatial + affinité au voisinage, signature par biome, jamais un tirage uniforme par tuile.
- **État sim JSON-sérialisable** : pas de classe/Map/Set ajoutés à `SimState`.
- **Tests** : `pnpm check`, `pnpm test`, `pnpm lint` verts avant chaque commit. Code/docs en français, identifiants en anglais.

## File Structure

- `packages/sim/src/economy.ts` — MODIFIER : import `fbm2`, ajouter le clustering spatial dans `generateNodes` (branche `density < 1`).
- `packages/sim/src/economy.test.ts` — MODIFIER : tests budget (±10 %) + sur-dispersion (clustering) + déterminisme préservé.
- `packages/client/src/render/clutter.ts` — CRÉER : module pur `BIOME_CLUTTER`, `clutterAt`, helpers d'affinité. Aucun import Phaser.
- `packages/client/src/render/clutter.test.ts` — CRÉER : déterminisme, table, non-uniformité, affinité eau, jitter borné.
- `packages/client/src/scenes/BootScene.ts` — MODIFIER : `makeClutter()` → textures placeholder `cl-<kind>` (procédurales, ternies).
- `packages/client/src/scenes/world/clutter-layer.ts` — CRÉER : `ClutterLayer` (pool de sprites, culling, LOD, profondeur).
- `packages/client/src/scenes/WorldScene.ts` — MODIFIER : instancier `ClutterLayer`, l'appeler dans `update()`, lire `this.worldSeed`.
- `packages/client/src/protocol.ts` — MODIFIER : ajouter `seed: number` au message hôte `ready`.
- `packages/client/src/worker/sim-worker.ts` — MODIFIER : `seed: sim.seed` dans le post `ready`.

---

### Task 1: Clustering spatial des nœuds (`/sim`)

**Files:**
- Modify: `packages/sim/src/economy.ts` (import + helper + branche `density < 1` de `generateNodes`, ~ligne 218-291)
- Test: `packages/sim/src/economy.test.ts`

**Interfaces:**
- Consumes: `fbm2(x, y, scale, seed)` et `hash2(x, y, seed)` de `./noise` (déjà exportés).
- Produces: signature de `generateNodes(map, seed, density = 1)` INCHANGÉE. Le clustering n'agit QUE si `density < 1` — donc tous les appels existants (`density` par défaut = 1) sont bit-identiques à avant.

- [ ] **Step 1: Écrire les tests qui échouent**

D'abord, ajouter `TERRAIN_FOREST` à l'import de `./balance` en tête de `packages/sim/src/economy.test.ts` (la ligne est `import { ALIGNMENT, BALANCE, TERRAIN_DEEP_WATER, TERRAIN_GRASS, TERRAIN_MARSH } from './balance'` → y insérer `TERRAIN_FOREST`).

Puis, dans `packages/sim/src/economy.test.ts`, ajouter à la fin du fichier (après le `describe` « les nœuds carrière ») :

```ts
describe('clustering spatial des nœuds (densité-feeling 2026-07-09)', () => {
  // Grille homogène de forêt : p(arbre) = 0.22, density 0.025.
  const W = 300
  const H = 300
  const D = 0.025
  const forestMap = () => createEmptyMap(W, H, TERRAIN_FOREST)

  it('déterministe sous-échantillonné (INV-3)', () => {
    const a = generateNodes(forestMap(), 99, D)
    const b = generateNodes(forestMap(), 99, D)
    expect(a).toEqual(b)
  })

  it('budget préservé à ±10 % (INV-4)', () => {
    const nodes = generateNodes(forestMap(), 99, D)
    const expected = W * H * D * 0.22 // ≈ 495
    expect(nodes.length).toBeGreaterThan(expected * 0.9)
    expect(nodes.length).toBeLessThan(expected * 1.1)
  })

  it('sur-dispersion : les nœuds se regroupent (INV-6)', () => {
    const nodes = generateNodes(forestMap(), 99, D)
    // Bucketing en cellules 20×20 → variance/moyenne >> 1 (Poisson uniforme ≈ 1).
    const cell = 20
    const cols = W / cell
    const counts = new Array<number>((W / cell) * (H / cell)).fill(0)
    for (const n of nodes) {
      const ci = Math.floor(n.tx / cell)
      const cj = Math.floor(n.ty / cell)
      counts[cj * cols + ci]! += 1
    }
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length
    const variance = counts.reduce((s, c) => s + (c - mean) * (c - mean), 0) / counts.length
    expect(variance / mean).toBeGreaterThan(1.5) // clustering ⇒ sur-dispersion
  })
})
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @braises/sim test -- economy`
Expected: le test « sur-dispersion » ÉCHOUE (variance/moyenne ≈ 1 avec le sous-échantillonnage uniforme actuel). Les tests budget/déterminisme peuvent passer.

- [ ] **Step 3: Ajouter l'import `fbm2`**

Dans `packages/sim/src/economy.ts`, l'import existant `import { fbm2 }` n'est pas présent — `hash2` vient de `./noise` (déjà utilisé via `hash2`). Vérifier l'import de `hash2` en tête de `economy.ts` ; ajouter `fbm2` à la même ligne d'import depuis `./noise` :

```ts
import { fbm2, hash2 } from './noise'
```

(Si `hash2` est déjà importé seul depuis `./noise`, remplacer par la ligne ci-dessus. Ne pas dupliquer l'import.)

- [ ] **Step 4: Ajouter le helper de clustering au-dessus de `generateNodes`**

Juste avant `export function generateNodes` (~ligne 218) :

```ts
// --- Clustering spatial des nœuds (INV-6, spec densité-feeling 2026-07-09) ---
// Quand la carte est sous-échantillonnée (density < 1, grandes cartes), on ne
// garde plus les tuiles candidates UNIFORMÉMENT : un champ de bruit basse
// fréquence les regroupe en bosquets/gisements, à budget CONSTANT — le facteur
// `groveBoost` est de moyenne ≈ 1 sur le domaine, donc le nombre total attendu
// de nœuds ne change pas (INV-4). Pur, exact au bit près (fbm2 : + - * / floor).
const GROVE_MEAN_SQ = 0.30 // ≈ E[fbm2²] — calibré pour préserver le total
interface GroveParams { scale: number; stretch: number } // scale = taille des amas (tuiles)
const GROVE_DEFAULT: GroveParams = { scale: 20, stretch: 1 }
// Signature de répartition par biome : grands massifs en forêt, poches serrées
// en lande, veines allongées (stretch) dans la pierre d'éboulis/blocs.
const GROVE_PARAMS: Partial<Record<number, GroveParams>> = {
  [TERRAIN_FOREST]: { scale: 28, stretch: 1 },
  [TERRAIN_OLD_GROWTH]: { scale: 28, stretch: 1 },
  [TERRAIN_PINE]: { scale: 24, stretch: 1 },
  [TERRAIN_LARCH]: { scale: 22, stretch: 1 },
  [TERRAIN_HEATH]: { scale: 14, stretch: 1 },
  [TERRAIN_SCREE]: { scale: 18, stretch: 2.5 },
  [TERRAIN_BOULDERS]: { scale: 16, stretch: 2.2 },
}
function groveBoost(tx: number, ty: number, terrain: number, seed: number): number {
  const p = GROVE_PARAMS[terrain] ?? GROVE_DEFAULT
  // stretch > 1 → amas allongés en X (veines de pierre). fbm2 ∈ [0,1), moyenne ≈ 0.5.
  const g = fbm2(tx / p.stretch, ty, p.scale, (seed ^ 0x6c8e9a3b) | 0)
  return (g * g) / GROVE_MEAN_SQ // (g² normalisé) : moyenne ≈ 1, contraste amas/trouées
}
```

- [ ] **Step 5: Remplacer le filtre uniforme par le clustering**

Dans `generateNodes`, remplacer la ligne :

```ts
      if (density < 1 && hash2(tx, ty, keepSeed) >= density) continue // sous-échantillonnage grande carte
```

par :

```ts
      // Sous-échantillonnage CLUSTERISÉ (grande carte) : le champ groveBoost
      // concentre les nœuds gardés en bosquets, à budget constant (INV-4/INV-6).
      if (density < 1) {
        const keep = Math.min(1, density * groveBoost(tx, ty, terrain, keepSeed))
        if (hash2(tx, ty, keepSeed) >= keep) continue
      }
```

(`terrain` est déjà calculé plus haut dans la boucle ; `keepSeed` existe déjà.)

- [ ] **Step 6: Lancer les tests, ajuster `GROVE_MEAN_SQ` si besoin**

Run: `pnpm --filter @braises/sim test -- economy`
Expected: tous PASS. Si « budget préservé » échoue (total hors ±10 %), ajuster `GROVE_MEAN_SQ` : total trop BAS → baisser la constante ; total trop HAUT → l'augmenter. Re-lancer jusqu'au vert. Si « sur-dispersion » est trop juste, augmenter le contraste (utiliser `g * g * g` et recalibrer `GROVE_MEAN_SQ ≈ E[fbm2³] ≈ 0.19`).

- [ ] **Step 7: Vérifier la non-régression globale du sim**

Run: `pnpm --filter @braises/sim test`
Expected: PASS — en particulier les tests A6 existants (déterminisme, positionnel) qui appellent `generateNodes(map, seed)` avec `density = 1` doivent être INCHANGÉS (la branche clustering ne s'exécute pas).

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/economy.ts packages/sim/src/economy.test.ts
git commit -m "feat(sim): clustering spatial des nœuds sur carte sous-échantillonnée (budget constant)"
```

---

### Task 2: Module pur de décor cosmétique (`clutter.ts`)

**Files:**
- Create: `packages/client/src/render/clutter.ts`
- Test: `packages/client/src/render/clutter.test.ts`
- Modify: `packages/sim/src/index.ts` (exporter les constantes de terrain manquantes)

**Interfaces:**
- Consumes: `fbm2`, `hash2` de `@braises/sim` ; constantes de terrain de `@braises/sim` (`TERRAIN_FOREST`, etc.).
- NB : le barrel `@braises/sim` (`packages/sim/src/index.ts`) n'exporte aujourd'hui que `TERRAIN_FOREST/GRASS/ROAD/ROCK/VOID`. Les biomes alpins utilisés ici doivent être ajoutés à cet export (Step 0).
- Produces:
  - `type PropKind` (union de chaînes).
  - `interface PropInstance { kind: PropKind; ox: number; oy: number; scale: number; mirror: boolean }` — `ox/oy` en fraction de tuile ∈ (-0.5, 0.5).
  - `type SampleTerrain = (tx: number, ty: number) => number`
  - `BIOME_CLUTTER: Record<number, BiomeClutter>` avec `interface BiomeClutter { density: number; scale: number; understory: boolean; props: PropKind[] }`
  - `clutterAt(tx: number, ty: number, terrain: number, seed: number, sample: SampleTerrain): PropInstance[]`
  - `distToWater(tx: number, ty: number, sample: SampleTerrain, cap: number): number` (exporté pour test).

- [ ] **Step 0: Exporter les constantes de terrain manquantes**

Dans `packages/sim/src/index.ts`, dans le bloc `export { ... } from './balance'`, ajouter les constantes de biome utilisées par `clutter.ts` (à côté de `TERRAIN_FOREST`) :

```ts
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_LARCH,
  TERRAIN_BURNT_FOREST,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_HEATH,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_MARSH,
  TERRAIN_REED_MARSH,
  TERRAIN_PEAT_BOG,
  TERRAIN_SCREE,
  TERRAIN_BOULDERS,
  TERRAIN_SNOW,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
```

Run: `pnpm --filter @braises/sim check`
Expected: PASS (ré-exports purs, ces constantes existent déjà dans `balance.ts`).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/client/src/render/clutter.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { TERRAIN_FOREST, TERRAIN_DEEP_WATER, TERRAIN_REED_MARSH } from '@braises/sim'
import { BIOME_CLUTTER, clutterAt, distToWater, type SampleTerrain } from './clutter'

const allForest: SampleTerrain = () => TERRAIN_FOREST
const SEED = 2026

describe('clutterAt', () => {
  it('rien sur un terrain sans décor (eau)', () => {
    expect(clutterAt(5, 5, TERRAIN_DEEP_WATER, SEED, () => TERRAIN_DEEP_WATER)).toEqual([])
  })

  it('déterministe (INV-5)', () => {
    const a = clutterAt(12, 34, TERRAIN_FOREST, SEED, allForest)
    const b = clutterAt(12, 34, TERRAIN_FOREST, SEED, allForest)
    expect(a).toEqual(b)
  })

  it('ne pose que des props de la table du biome (INV-2 cohérence)', () => {
    const allowed = new Set(BIOME_CLUTTER[TERRAIN_FOREST]!.props)
    for (let ty = 0; ty < 40; ty++) {
      for (let tx = 0; tx < 40; tx++) {
        for (const p of clutterAt(tx, ty, TERRAIN_FOREST, SEED, allForest)) {
          expect(allowed.has(p.kind)).toBe(true)
          expect(p.ox).toBeGreaterThan(-0.5)
          expect(p.ox).toBeLessThan(0.5)
          expect(p.oy).toBeGreaterThan(-0.5)
          expect(p.oy).toBeLessThan(0.5)
        }
      }
    }
  })

  it('répartition organique : sur-dispersion sur forêt homogène (INV-6)', () => {
    const cell = 8
    const N = 96
    const cols = N / cell
    const counts = new Array<number>((N / cell) * (N / cell)).fill(0)
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const k = clutterAt(tx, ty, TERRAIN_FOREST, SEED, allForest).length
        counts[Math.floor(ty / cell) * cols + Math.floor(tx / cell)]! += k
      }
    }
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length
    const variance = counts.reduce((s, c) => s + (c - mean) * (c - mean), 0) / counts.length
    expect(mean).toBeGreaterThan(0)
    expect(variance / mean).toBeGreaterThan(1.5)
  })
})

describe('distToWater (affinité réaliste, INV-6)', () => {
  // Colonne d'eau en x = 0 ; le reste roselière.
  const grid: SampleTerrain = (tx) => (tx <= 0 ? TERRAIN_DEEP_WATER : TERRAIN_REED_MARSH)

  it('0 au contact, croît en s\'éloignant, plafonne', () => {
    expect(distToWater(1, 5, grid, 3)).toBe(1)
    expect(distToWater(2, 5, grid, 3)).toBe(2)
    expect(distToWater(10, 5, grid, 3)).toBe(3) // plafonné au cap
  })

  it('les roseaux sont plus denses au bord de l\'eau qu\'au loin', () => {
    const near = clutterAt(1, 20, TERRAIN_REED_MARSH, SEED, grid).length
    let far = 0
    for (let ty = 0; ty < 60; ty++) far += clutterAt(12, ty, TERRAIN_REED_MARSH, SEED, grid).length
    const nearTotal = (() => {
      let s = 0
      for (let ty = 0; ty < 60; ty++) s += clutterAt(1, ty, TERRAIN_REED_MARSH, SEED, grid).length
      return s
    })()
    expect(nearTotal).toBeGreaterThan(far)
    expect(near).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm --filter @braises/client test -- clutter`
Expected: FAIL — `./clutter` n'existe pas encore.

- [ ] **Step 3: Créer le module `clutter.ts`**

Créer `packages/client/src/render/clutter.ts` :

```ts
/**
 * Décor cosmétique des biomes — couche PUREMENT visuelle, jamais dans /sim ni
 * dans les snapshots (INV-1 : aucune collision). Sélection déterministe par
 * tuile (INV-5) via bruit spatial (amas + trouées, INV-6) et affinité au
 * voisinage (roseaux près de l'eau, sous-bois de lisière). Le rendu/pooling
 * vit dans scenes/world/clutter-layer.ts ; ce module ne dépend PAS de Phaser.
 */
import {
  fbm2,
  hash2,
  TERRAIN_FOREST,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_LARCH,
  TERRAIN_BURNT_FOREST,
  TERRAIN_GRASS,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_HEATH,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_MARSH,
  TERRAIN_REED_MARSH,
  TERRAIN_PEAT_BOG,
  TERRAIN_SCREE,
  TERRAIN_BOULDERS,
  TERRAIN_SNOW,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
} from '@braises/sim'

export type PropKind =
  | 'conifer' | 'big_trunk' | 'stump' | 'fern' | 'pine' | 'larch' | 'burnt_trunk'
  | 'grass_tuft' | 'flower' | 'pebbles' | 'boulder' | 'low_bush'
  | 'reed' | 'sphagnum' | 'lichen' | 'snowdrift'

export interface PropInstance {
  kind: PropKind
  ox: number // décalage en fraction de tuile, ∈ (-0.5, 0.5)
  oy: number
  scale: number // multiplicateur d'échelle (~0.7..1.0)
  mirror: boolean
}

export type SampleTerrain = (tx: number, ty: number) => number

export interface BiomeClutter {
  density: number // fraction de tuiles portant un prop AU PIC d'amas
  scale: number // taille des massifs (tuiles) — signature du biome (INV-6)
  understory: boolean // 2e strate en couvert dense
  props: PropKind[]
}

// Table de calibration — l'équivalent de balance.ts pour le feeling. Densités =
// ordres de grandeur, à affiner en playtest.
export const BIOME_CLUTTER: Record<number, BiomeClutter> = {
  [TERRAIN_FOREST]: { density: 0.62, scale: 26, understory: true, props: ['conifer', 'fern', 'stump'] },
  [TERRAIN_OLD_GROWTH]: { density: 0.7, scale: 28, understory: true, props: ['big_trunk', 'fern'] },
  [TERRAIN_PINE]: { density: 0.4, scale: 22, understory: false, props: ['pine', 'grass_tuft', 'pebbles'] },
  [TERRAIN_LARCH]: { density: 0.35, scale: 20, understory: false, props: ['larch', 'grass_tuft'] },
  [TERRAIN_BURNT_FOREST]: { density: 0.4, scale: 22, understory: false, props: ['burnt_trunk', 'grass_tuft'] },
  [TERRAIN_GRASS]: { density: 0.28, scale: 16, understory: false, props: ['grass_tuft', 'flower', 'pebbles'] },
  [TERRAIN_FLOWER_MEADOW]: { density: 0.5, scale: 16, understory: false, props: ['flower', 'grass_tuft'] },
  [TERRAIN_HEATH]: { density: 0.42, scale: 14, understory: false, props: ['low_bush', 'pebbles'] },
  [TERRAIN_ALPINE_MEADOW]: { density: 0.3, scale: 15, understory: false, props: ['grass_tuft', 'flower', 'pebbles'] },
  [TERRAIN_ALPINE_FLOWERS]: { density: 0.5, scale: 15, understory: false, props: ['flower', 'grass_tuft'] },
  [TERRAIN_MARSH]: { density: 0.45, scale: 14, understory: false, props: ['reed', 'grass_tuft'] },
  [TERRAIN_REED_MARSH]: { density: 0.6, scale: 13, understory: false, props: ['reed'] },
  [TERRAIN_PEAT_BOG]: { density: 0.45, scale: 14, understory: false, props: ['sphagnum', 'reed'] },
  [TERRAIN_SCREE]: { density: 0.4, scale: 16, understory: false, props: ['pebbles', 'lichen'] },
  [TERRAIN_BOULDERS]: { density: 0.5, scale: 16, understory: false, props: ['boulder', 'lichen'] },
  [TERRAIN_SNOW]: { density: 0.2, scale: 18, understory: false, props: ['snowdrift', 'pebbles'] },
}

const CLUTTER_MEAN_SQ = 0.30 // ≈ E[fbm2²] — normalise le champ d'amas (moyenne ≈ 1)
const WATER = new Set<number>([TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER])
const REEDY = new Set<number>([TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_PEAT_BOG])
const WOODED = new Set<number>([TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH])

/** Distance de Chebyshev à la tuile d'eau la plus proche, plafonnée à `cap`. */
export function distToWater(tx: number, ty: number, sample: SampleTerrain, cap: number): number {
  for (let r = 0; r <= cap; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue // seulement l'anneau
        if (WATER.has(sample(tx + dx, ty + dy))) return r
      }
    }
  }
  return cap
}

/** Un des 4 voisins est-il un biome ouvert différent ? (lisière de forêt) */
function isForestEdge(tx: number, ty: number, sample: SampleTerrain): boolean {
  return !WOODED.has(sample(tx + 1, ty)) || !WOODED.has(sample(tx - 1, ty))
    || !WOODED.has(sample(tx, ty + 1)) || !WOODED.has(sample(tx, ty - 1))
}

/** Multiplicateur d'affinité réaliste selon le voisinage (INV-6). */
function affinity(terrain: number, tx: number, ty: number, sample: SampleTerrain): number {
  if (REEDY.has(terrain)) {
    const d = distToWater(tx, ty, sample, 3)
    return d === 0 ? 1.6 : d === 1 ? 1.3 : d === 2 ? 1.0 : 0.7 // roseaux collés à l'eau
  }
  if (WOODED.has(terrain)) return isForestEdge(tx, ty, sample) ? 1.35 : 1.0 // sous-bois de lisière
  return 1
}

function pick<T>(arr: T[], h: number): T {
  return arr[Math.floor(h * arr.length) % arr.length]!
}

function makeProp(cfg: BiomeClutter, tx: number, ty: number, seed: number, slot: number): PropInstance {
  const h1 = hash2(tx, ty, (seed ^ (0x1000 + slot)) | 0)
  const h2 = hash2(tx, ty, (seed ^ (0x2000 + slot)) | 0)
  const h3 = hash2(tx, ty, (seed ^ (0x3000 + slot)) | 0)
  const h4 = hash2(tx, ty, (seed ^ (0x4000 + slot)) | 0)
  return {
    kind: pick(cfg.props, h1),
    ox: (h2 - 0.5) * 0.8, // ∈ (-0.4, 0.4)
    oy: (h3 - 0.5) * 0.8,
    scale: 0.7 + h4 * 0.3, // 0.7..1.0
    mirror: hash2(tx, ty, (seed ^ (0x5000 + slot)) | 0) < 0.5,
  }
}

export function clutterAt(
  tx: number,
  ty: number,
  terrain: number,
  seed: number,
  sample: SampleTerrain,
): PropInstance[] {
  const cfg = BIOME_CLUTTER[terrain]
  if (!cfg) return []
  // Champ d'amas (moyenne ≈ 1) → massifs pleins troués de clairières (INV-6).
  const field = fbm2(tx, ty, cfg.scale, (seed ^ 0x2b1c9f0d) | 0)
  const local = Math.min(
    1,
    cfg.density * ((field * field) / CLUTTER_MEAN_SQ) * affinity(terrain, tx, ty, sample),
  )
  const u = hash2(tx, ty, (seed ^ 0x77aa1133) | 0)
  if (u >= local) return []
  const props: PropInstance[] = [makeProp(cfg, tx, ty, seed, 0)]
  if (cfg.understory && u < local * 0.45) props.push(makeProp(cfg, tx, ty, seed, 1))
  return props
}
```

- [ ] **Step 4: Lancer les tests, ajuster les seuils si besoin**

Run: `pnpm --filter @braises/client test -- clutter`
Expected: PASS. Si « sur-dispersion » échoue de peu, augmenter le contraste (`field * field * field` + `CLUTTER_MEAN_SQ ≈ 0.19`). Si l'affinité eau échoue, vérifier que `distToWater` renvoie bien 0 seulement sur eau (une tuile roselière n'est pas de l'eau).

- [ ] **Step 5: Vérifier types + lint**

Run: `pnpm --filter @braises/client check && pnpm lint`
Expected: PASS (aucun import Phaser dans `clutter.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/index.ts packages/client/src/render/clutter.ts packages/client/src/render/clutter.test.ts
git commit -m "feat(client): module pur de décor cosmétique par biome (clutterAt + affinité)"
```

---

### Task 3: Sprites placeholder du décor (`BootScene`)

**Files:**
- Modify: `packages/client/src/scenes/BootScene.ts` (ajouter `makeClutter()` et son appel)

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: une texture Phaser `cl-<kind>` pour chaque `PropKind` de Task 2 (16×16), ternie/désaturée (INV-2), destinée à être teintée plus sombre au rendu.

- [ ] **Step 1: Repérer l'appel des générateurs de textures**

Lire `packages/client/src/scenes/BootScene.ts` : trouver où `makeNodes()` est appelé (dans `create()` ou `preload()`). Ajouter l'appel `this.makeClutter()` juste après.

- [ ] **Step 2: Ajouter la méthode `makeClutter()`**

Après `makeNodes()` dans la classe `BootScene`, ajouter (placeholders volontairement ternes — art définitif plus tard) :

```ts
  /** Textures placeholder du décor cosmétique (cl-*). Ternies pour ne jamais
   * être confondues avec les nœuds récoltables (INV-2). */
  private makeClutter(): void {
    const g = this.add.graphics()
    const tex = (key: string): void => {
      g.generateTexture(key, 16, 16)
      g.clear()
    }

    g.fillStyle(0x24401f).fillTriangle(8, 1, 2, 13, 14, 13) // conifère (sombre, terne)
    tex('cl-conifer')

    g.fillStyle(0x3a2c1a).fillRect(6, 4, 4, 11) // gros tronc
    g.fillStyle(0x24401f).fillCircle(8, 4, 5)
    tex('cl-big_trunk')

    g.fillStyle(0x4a3826).fillRect(6, 9, 4, 5) // souche
    tex('cl-stump')

    g.fillStyle(0x3f6238) // fougère (touffe basse)
    g.fillRect(5, 10, 2, 5).fillRect(8, 9, 2, 6).fillRect(11, 11, 2, 4)
    tex('cl-fern')

    g.fillStyle(0x2f5030).fillTriangle(8, 3, 4, 13, 12, 13) // pin clair
    tex('cl-pine')

    g.fillStyle(0x6f7a3a).fillTriangle(8, 3, 5, 12, 11, 12) // mélèze doré terne
    tex('cl-larch')

    g.fillStyle(0x2b2b2f).fillRect(7, 4, 2, 10) // tronc calciné
    tex('cl-burnt_trunk')

    g.fillStyle(0x5a6e33) // touffe d'herbe
    g.fillRect(5, 9, 2, 5).fillRect(8, 8, 2, 6).fillRect(11, 10, 2, 4)
    tex('cl-grass_tuft')

    g.fillStyle(0x50662f).fillCircle(8, 11, 3) // fleur (tige + corolle discrète)
    g.fillStyle(0x9a7bb0).fillCircle(8, 6, 2)
    tex('cl-flower')

    g.fillStyle(0x6a6a6e).fillCircle(6, 11, 2).fillCircle(10, 12, 2).fillCircle(8, 10, 1.5) // cailloux
    tex('cl-pebbles')

    g.fillStyle(0x5f5f64).fillCircle(8, 10, 5) // gros bloc
    g.fillStyle(0x6f6f75).fillCircle(6, 9, 2)
    tex('cl-boulder')

    g.fillStyle(0x4b4a2e).fillCircle(7, 11, 3).fillCircle(10, 11, 2) // buisson bas (lande)
    tex('cl-low_bush')

    g.fillStyle(0x6d7a40) // roseau
    g.fillRect(6, 4, 1, 11).fillRect(9, 3, 1, 12).fillRect(11, 6, 1, 9)
    tex('cl-reed')

    g.fillStyle(0x6a6a3a).fillCircle(8, 11, 4) // sphaigne (coussin)
    tex('cl-sphagnum')

    g.fillStyle(0x777c50).fillCircle(6, 10, 2).fillCircle(9, 11, 2) // lichen
    tex('cl-lichen')

    g.fillStyle(0xd8dde6).fillCircle(8, 12, 4) // congère
    tex('cl-snowdrift')

    g.destroy()
  }
```

- [ ] **Step 3: Vérifier que le jeu charge (pas de texture manquante)**

Run: `pnpm --filter @braises/client build`
Expected: build OK. (La vérification visuelle vient en Task 5.)

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/scenes/BootScene.ts
git commit -m "feat(client): sprites placeholder du décor cosmétique (cl-*, ternis)"
```

---

### Task 4: Couche de rendu culled + LOD (`ClutterLayer`) et câblage

**Files:**
- Create: `packages/client/src/scenes/world/clutter-layer.ts`
- Modify: `packages/client/src/scenes/WorldScene.ts` (instancier, appeler dans `update`, stocker `this.worldSeed`)
- Modify: `packages/client/src/protocol.ts` (ajouter `seed: number` au message `ready`)
- Modify: `packages/client/src/worker/sim-worker.ts` (`seed: sim.seed` dans le post `ready`)

**Interfaces:**
- Consumes: `clutterAt`, `BIOME_CLUTTER` de `../../render/clutter` ; `TILE_PX` de `../../render/framing` ; `WorldMap` de `@braises/sim`.
- Produces: `class ClutterLayer { constructor(scene, map, seed); update(camera): void; destroy(): void }`.

- [ ] **Step 1: Propager le seed du monde jusqu'au client**

Dans `packages/client/src/protocol.ts`, dans l'interface du message hôte `ready` (celle qui contient `map: WorldMap`), ajouter :

```ts
  seed: number
```

Dans `packages/client/src/worker/sim-worker.ts`, dans le `post({ type: 'ready', ... })`, ajouter `seed: sim.seed,` à côté de `map: sim.map,`.

- [ ] **Step 2: Créer `ClutterLayer`**

Créer `packages/client/src/scenes/world/clutter-layer.ts` :

```ts
/**
 * Rendu du décor cosmétique : sprites POOLÉS, culled à la vue caméra, avec LOD
 * (coupé quand on dézoome trop). Purement visuel — aucune collision (INV-1).
 * La décision « quel prop sur quelle tuile » vit dans render/clutter.ts (pur) ;
 * ici on ne fait que du pooling Phaser et du placement.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { TILE_PX } from '../../render/framing'
import { clutterAt, type SampleTerrain } from '../../render/clutter'

const CLUTTER_MIN_ZOOM = 1.2 // en-deçà, on coupe le décor (props illisibles) : le canopy prend le relais
const CLUTTER_DEPTH_BASE = 2 // sous les cadavres (3)/nœuds (4) → les vrais nœuds ressortent (INV-2)
const CLUTTER_TINT = 0xbfc4bd // léger assombrissement/désaturation (INV-2)
const MARGIN_TILES = 2 // marge de culling pour éviter le pop en bordure d'écran
const MAX_SPRITES = 4000 // borne dure de perf (cap silencieux : on log si dépassé)

export class ClutterLayer {
  private readonly pool: Phaser.GameObjects.Image[] = []
  private readonly sample: SampleTerrain
  private warned = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    private readonly seed: number,
  ) {
    this.sample = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
      return map.terrain[ty * map.width + tx] ?? -1
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    let used = 0
    if (camera.zoom >= CLUTTER_MIN_ZOOM) {
      const v = camera.worldView
      const x0 = Math.max(0, Math.floor(v.x / TILE_PX) - MARGIN_TILES)
      const y0 = Math.max(0, Math.floor(v.y / TILE_PX) - MARGIN_TILES)
      const x1 = Math.min(this.map.width - 1, Math.ceil((v.x + v.width) / TILE_PX) + MARGIN_TILES)
      const y1 = Math.min(this.map.height - 1, Math.ceil((v.y + v.height) / TILE_PX) + MARGIN_TILES)
      for (let ty = y0; ty <= y1 && used < MAX_SPRITES; ty++) {
        for (let tx = x0; tx <= x1 && used < MAX_SPRITES; tx++) {
          const terrain = this.map.terrain[ty * this.map.width + tx] ?? -1
          const props = clutterAt(tx, ty, terrain, this.seed, this.sample)
          for (const p of props) {
            if (used >= MAX_SPRITES) break
            const sprite = this.acquire(used++)
            sprite.setTexture(`cl-${p.kind}`)
            sprite.setPosition((tx + 0.5 + p.ox) * TILE_PX, (ty + 1 + p.oy) * TILE_PX)
            sprite.setDisplaySize(TILE_PX * p.scale, TILE_PX * p.scale)
            sprite.setFlipX(p.mirror)
            // Y-sort interne au décor, borné à [BASE, BASE+1) → toujours sous les nœuds.
            sprite.setDepth(CLUTTER_DEPTH_BASE + ty / this.map.height)
            sprite.setVisible(true)
          }
        }
      }
      if (used >= MAX_SPRITES && !this.warned) {
        // eslint-disable-next-line no-console
        console.warn(`[clutter] cap de ${MAX_SPRITES} sprites atteint — décor tronqué à la vue`)
        this.warned = true
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false)
  }

  private acquire(i: number): Phaser.GameObjects.Image {
    let sprite = this.pool[i]
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, 'cl-grass_tuft').setOrigin(0.5, 1).setTint(CLUTTER_TINT)
      this.pool[i] = sprite
    }
    return sprite
  }

  destroy(): void {
    for (const s of this.pool) s.destroy()
    this.pool.length = 0
  }
}
```

- [ ] **Step 3: Câbler dans `WorldScene`**

Dans `packages/client/src/scenes/WorldScene.ts` :

1. Import en tête : `import { ClutterLayer } from './world/clutter-layer'`
2. Champ privé près des autres (`private worldReady = false`) :
```ts
  private worldSeed = 0
  private clutter?: ClutterLayer
```
3. Dans le handler du message `ready` (là où `this.map = msg.map` — ~ligne 249), après le bake des textures (après `this.bakeCanopyTexture()` / dans la même séquence de setup, ~ligne 256-258) :
```ts
    this.worldSeed = msg.seed
    this.clutter = new ClutterLayer(this, this.map, this.worldSeed)
```
4. Dans `update()`, après le garde `if (!this.worldReady) return` (~ligne 277) :
```ts
    this.clutter?.update(this.cameras.main)
```

- [ ] **Step 4: Vérifier types, lint, build**

Run: `pnpm --filter @braises/client check && pnpm lint && pnpm --filter @braises/client build`
Expected: PASS. Corriger toute erreur de type (nom exact de l'interface `ready` dans protocol.ts, champ `sim.seed`).

- [ ] **Step 5: Vérifier la non-régression des tests client**

Run: `pnpm --filter @braises/client test`
Expected: PASS (les tests existants + `clutter` de Task 2).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/world/clutter-layer.ts packages/client/src/scenes/WorldScene.ts packages/client/src/protocol.ts packages/client/src/worker/sim-worker.ts
git commit -m "feat(client): couche de rendu du décor cosmétique (culling + LOD) câblée à WorldScene"
```

---

### Task 5: Vérification visuelle en jeu + artefact de revue

**Files:** aucun (vérification). Produit un artefact de revue avec captures.

**Interfaces:** utilise le smoke test navigateur du projet (mémoire `browser-smoke-test` : `pnpm build` + preview + Chromium mis en cache, pilotage via `window.__BRAISES__`).

- [ ] **Step 1: Build + preview**

Run: `pnpm --filter @braises/client build && pnpm --filter @braises/client preview` (préférer build+preview au `pnpm dev` bloqué par le cache `.vite` root — cf. mémoire).

- [ ] **Step 2: Piloter le navigateur et capturer 4 biomes**

Via Playwright (Chromium mis en cache), charger la Veillée, se placer/téléporter (`window.__BRAISES__`) dans 4 biomes distincts (forêt, lande, marais/roselière, éboulis) et prendre une capture de chacun, à zoom de jeu.

- [ ] **Step 3: Vérifier les critères d'acceptation à l'œil**

Confirmer sur les captures : (a) forêt visiblement dense (massifs + clairières, pas de semis uniforme) ; (b) chaque biome montre son décor caractéristique ; (c) les vrais nœuds (arbres/rochers récoltables) ressortent du décor ; (d) traverser un « tronc » décoratif ne bloque pas (INV-1) ; (e) pan/zoom sans scintillement (INV-5) ; (f) dézoom max → décor coupé, perf tenable (LOD).

- [ ] **Step 4: Publier l'artefact de revue (grille 2×2)**

Composer un artefact HTML avec les 4 captures en grille 2×2 (préférence Alexis : ~4 vignettes) + une légende par biome. Publier via l'outil Artifact.

- [ ] **Step 5: Vérification finale complète**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: TOUT PASS.

- [ ] **Step 6: Commit éventuel de calibration**

Si le playtest visuel a mené à ajuster des densités dans `BIOME_CLUTTER` ou `GROVE_PARAMS` :

```bash
git add -A
git commit -m "chore(client): calibration des densités de décor après revue visuelle"
```
