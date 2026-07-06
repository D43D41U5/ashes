# Plan d'implémentation — La Vallée de la Veillée (192×192)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la carte de démo 64×64 par une vallée 192×192 générée par squelette déclaratif + chair procédurale (`packages/sim/src/valleygen.ts`), conformément à `docs/superpowers/specs/2026-07-06-vallee-veillee-design.md`.

**Architecture:** Un module pur `/sim` en deux étages — un `ValleySkeleton` déclaratif (rivière, crêtes, routes, landmarks : de la donnée) et une génération procédurale seedée (biomes par bruit de valeur, enceinte, tampons). Le squelette de la Veillée (`VEILLEE_SKELETON`) est consommé par le client (`veillee.ts`) et le banc de calibrage (`scenario.ts`).

**Tech Stack:** TypeScript pur dans `/sim` (vitest), Phaser 4 côté client (rendu inchangé — la carte transite déjà par le message `ready`).

## Global Constraints

- `/sim` est **pur** (zéro import Phaser/Colyseus/Node) et **déterministe au bit près** : seuls `+ - * /`, `Math.sqrt/abs/floor/ceil/round/trunc/sign/min/max/imul/fround` et les constantes sont autorisés. **Jamais** `Math.random`, `Date`, `sin`, `cos`, `pow`, `**`, `exp`, `log`, `hypot`.
- État de sim JSON-sérialisable : pas de classes, pas de `Map`/`Set` dans les données de la carte.
- Code et docs en **français**, identifiants de code en **anglais**.
- Avant **chaque** commit : `pnpm check && pnpm test && pnpm lint` doivent passer (racine du repo : `/home/alexis/projects/braises`).
- Tout nombre d'équilibrage vit dans `packages/sim/src/balance.ts`. Les coordonnées et seuils de biome du squelette sont du **contenu** (donnée de carte), pas de l'équilibrage — ils vivent avec le squelette.
- `docs/decisions.md` et `docs/specs/client.md` ont des **modifications préexistantes non commitées** appartenant à l'utilisateur : ne jamais les inclure dans un `git add`.
- Écart assumé vis-à-vis de la spec (découvert au planning) : la spec promet un Marais « fibres et baies riches » mais liste `generateNodes` dans « ce qui ne change pas » — contradiction. Résolution : on ajoute un cas `marsh` à `generateNodes` (Task 2). C'est la géographie qui prime.

**Repères existants utiles :**
- `packages/sim/src/map.ts` : `WorldMap { width, height, terrain: number[], zones: Zone[] }`, `createEmptyMap`, `terrainAt`, `isBlockingTile`, `zoneAt`. `Zone { name, x, y, w, h, kind? }`.
- `packages/sim/src/balance.ts:136` : table `TERRAINS` (0 void, 1 grass, 2 road ×1.25, 3 forest ×0.8, 4 shallow_water ×0.5, 5 rock, 6 deep_water, 7 wall).
- `packages/sim/src/economy.ts:200` : `generateNodes(map, seed)` — un tirage PRNG par tuile marchable, ordre row-major ; la Mine via `zoneAt(...).kind === 'gisement'`. **`zoneAt` retourne la première zone contenant le point** → dans `map.zones`, les landmarks spécifiques doivent précéder les grandes zones-régions.
- `packages/sim/src/index.ts` : API publique organisée par sections commentées.

---

### Task 1: Le bruit déterministe de `/sim` (`noise.ts`)

**Files:**
- Create: `packages/sim/src/noise.ts`
- Test: `packages/sim/src/noise.test.ts`
- Modify: `packages/sim/src/index.ts` (section des utilitaires, à côté de l'export `rng.ts`, ligne ~18)

**Interfaces:**
- Consumes: rien (feuille).
- Produces: `hash2(x: number, y: number, seed?: number): number` (défaut `seed = 0`, **identique bit à bit** à l'ancien `hash2` de `demo-map.ts` quand `seed = 0` — le shading client en dépend), `valueNoise2(x: number, y: number, seed?: number): number`, `fbm2(x: number, y: number, scale: number, seed?: number): number`. Tous retournent `[0, 1)`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/sim/src/noise.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { fbm2, hash2, valueNoise2 } from './noise'

describe('le bruit déterministe', () => {
  it('hash2 est stable, seedé, et dans [0, 1)', () => {
    expect(hash2(12, 34)).toBe(hash2(12, 34))
    expect(hash2(12, 34)).not.toBe(hash2(34, 12))
    expect(hash2(12, 34, 7)).not.toBe(hash2(12, 34, 8))
    for (let i = 0; i < 1000; i++) {
      const v = hash2(i, i * 31, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('hash2 sans seed reproduit le hash historique de demo-map (shading client)', () => {
    let h = (12 * 374761393 + 34 * 668265263) >>> 0
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
    const expected = ((h ^ (h >>> 16)) >>> 0) / 4294967296
    expect(hash2(12, 34)).toBe(expected)
  })

  it('valueNoise2 est continu (deux points proches → valeurs proches)', () => {
    const a = valueNoise2(3.0, 5.0, 1)
    const b = valueNoise2(3.001, 5.0, 1)
    expect(Math.abs(a - b)).toBeLessThan(0.01)
  })

  it('fbm2 est stable et dans [0, 1)', () => {
    expect(fbm2(40, 60, 24, 2026)).toBe(fbm2(40, 60, 24, 2026))
    for (let i = 0; i < 500; i++) {
      const v = fbm2(i * 1.7, i * 0.9, 24, 99)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/noise.test.ts`
Expected: FAIL — « Cannot find module './noise' » (ou équivalent).

- [ ] **Step 3: Implémenter `noise.ts`**

```ts
/**
 * Le bruit déterministe de /sim — hash 2D et bruit de valeur fractal.
 *
 * Uniquement des opérations exactes au bit près (imul, >>>, + - * /,
 * polynômes) : même résultat sur tout moteur JS (invariant n°2). C'est la
 * source de « chair » procédurale de la génération de carte — PAS une source
 * d'aléatoire de gameplay (ça, c'est rng.ts, dont l'état vit dans SimState).
 */

/** Hash 2D seedé → [0, 1). Avec seed = 0 : identique au hash2 historique. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + Math.imul(seed | 0, 974634749)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Bruit de valeur lissé — interpolation bilinéaire du hash aux quatre coins. */
export function valueNoise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  // smoothstep — un polynôme, donc exact
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x0 + 1, y0, seed)
  const n01 = hash2(x0, y0 + 1, seed)
  const n11 = hash2(x0 + 1, y0 + 1, seed)
  const nx0 = n00 + (n10 - n00) * sx
  const nx1 = n01 + (n11 - n01) * sx
  return nx0 + (nx1 - nx0) * sy
}

/** Bruit fractal (3 octaves) à l'échelle `scale` (en tuiles) → [0, 1). */
export function fbm2(x: number, y: number, scale: number, seed = 0): number {
  const a = valueNoise2(x / scale, y / scale, seed)
  const b = valueNoise2((x * 2) / scale, (y * 2) / scale, (seed ^ 0x9e3779b9) | 0)
  const c = valueNoise2((x * 4) / scale, (y * 4) / scale, (seed ^ 0x51ab3f77) | 0)
  return (a * 4 + b * 2 + c) / 7
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `pnpm --filter @braises/sim exec vitest run src/noise.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Exporter depuis l'API publique**

Dans `packages/sim/src/index.ts`, juste après la ligne `export { rngNext, rngFloat, rngRoll } from './rng'` :

```ts
export { hash2, valueNoise2, fbm2 } from './noise'
```

- [ ] **Step 6: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe (le lint de pureté valide `noise.ts`).

```bash
git add packages/sim/src/noise.ts packages/sim/src/noise.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): bruit déterministe hash2/valueNoise2/fbm2 (noise.ts)"
```

---

### Task 2: Le terrain marais + la chair du Marais dans `generateNodes`

**Files:**
- Modify: `packages/sim/src/balance.ts:136-153` (table `TERRAINS` + constantes nommées)
- Modify: `packages/sim/src/economy.ts:200-233` (`generateNodes`)
- Test: `packages/sim/src/economy.test.ts` (ajout d'un cas)

**Interfaces:**
- Consumes: `TERRAINS`, `generateNodes` existants.
- Produces: `TERRAIN_SHALLOW_WATER = 4`, `TERRAIN_DEEP_WATER = 6`, `TERRAIN_WALL = 7`, `TERRAIN_MARSH = 8` (exportés de `balance.ts`) ; `TERRAINS[8] = { name: 'marsh', walkable: true, speedFactor: 0.6 }` ; `generateNodes` produit baies + fibres sur les tuiles marais.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `packages/sim/src/economy.test.ts`, ajouter (adopter le style d'import du fichier existant) :

```ts
it('le marais est riche en baies et fibres (spec vallée 2026-07-06)', () => {
  const map = createEmptyMap(20, 20, TERRAIN_MARSH)
  const nodes = generateNodes(map, 7)
  const berries = nodes.filter((n) => n.type === 'berry_bush').length
  const fibers = nodes.filter((n) => n.type === 'fiber_plant').length
  expect(berries).toBeGreaterThan(0)
  expect(fibers).toBeGreaterThan(0)
  // ~3× plus dense que l'herbe : 400 tuiles → attendre nettement plus que ~11
  expect(berries + fibers).toBeGreaterThan(25)
})
```

(`TERRAIN_MARSH` s'importe depuis `./balance`, `createEmptyMap` depuis `./map` — compléter les imports en tête de fichier.)

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/economy.test.ts`
Expected: FAIL — `TERRAIN_MARSH` n'existe pas (erreur de compilation) ; après l'étape balance seule, le test échouerait sur `berries > 0`.

- [ ] **Step 3: Implémenter**

Dans `packages/sim/src/balance.ts`, table `TERRAINS` — ajouter l'entrée 8 :

```ts
  7: { name: 'wall', walkable: false, speedFactor: 0 },
  8: { name: 'marsh', walkable: true, speedFactor: 0.6 },
}
```

Puis compléter le bloc des constantes nommées (après `TERRAIN_FOREST`) :

```ts
export const TERRAIN_SHALLOW_WATER = 4
export const TERRAIN_DEEP_WATER = 6
export const TERRAIN_WALL = 7
export const TERRAIN_MARSH = 8
```

Dans `packages/sim/src/economy.ts`, fonction `generateNodes`, ajouter une branche après le cas `TERRAIN_GRASS` (importer `TERRAIN_MARSH` en tête) :

```ts
      } else if (terrain === TERRAIN_MARSH) {
        // Le Marais : récolte riche parce qu'on y est lent et vulnérable.
        if (r < 0.05) push('berry_bush', tx, ty)
        else if (r < 0.13) push('fiber_plant', tx, ty)
      }
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `pnpm --filter @braises/sim exec vitest run src/economy.test.ts`
Expected: PASS (tous les cas du fichier, dont le nouveau).

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe — en particulier `sim.test.ts`/`replay.test.ts` (le nouveau terrain ne change aucun tirage existant : les cartes actuelles n'ont pas de tuile 8).

```bash
git add packages/sim/src/balance.ts packages/sim/src/economy.ts packages/sim/src/economy.test.ts
git commit -m "feat(sim): terrain marais (0.6×) + baies/fibres riches au marais"
```

---

### Task 3: `valleygen.ts` — squelette, biomes, enceinte, crêtes

**Files:**
- Create: `packages/sim/src/valleygen.ts`
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `createEmptyMap`, types `WorldMap`/`Zone` (`./map`) ; `fbm2`, `hash2` (`./noise`) ; constantes terrain (`./balance`).
- Produces: `ValleyPoint { x, y }`, `ValleyRegion { x, y, w, h, forest?, rock?, marsh? }`, `ValleySkeleton` (voir code), `generateValley(skeleton: ValleySkeleton, seed: number): WorldMap`. Les helpers internes `stampDisk`/`paintPolyline` (non exportés) sont réutilisés en Task 4.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/sim/src/valleygen.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { isBlockingTile, terrainAt } from './map'
import { TERRAIN_FOREST } from './balance'
import { generateValley, type ValleySkeleton } from './valleygen'

/** Petit squelette d'exercice — chaque primitive y est représentée. */
export const TEST_SKELETON: ValleySkeleton = {
  width: 48,
  height: 48,
  borderThickness: 3,
  ridges: [{ points: [{ x: 4, y: 20 }, { x: 20, y: 20 }], halfWidth: 1 }],
  river: { points: [{ x: 30, y: 4 }, { x: 30, y: 44 }], halfWidth: 2 },
  lake: { x: 30, y: 40, r: 4 },
  roads: [[{ x: 8, y: 30 }, { x: 40, y: 30 }]],
  crossings: [{ kind: 'bridge', x: 30, y: 30 }],
  clearings: [{ x: 10, y: 30, r: 3 }],
  ruins: [{ x: 12, y: 34 }],
  regions: [{ x: 4, y: 4, w: 40, h: 12, forest: 0.9 }],
  landmarks: [{ name: 'le Pont', x: 27, y: 27, w: 7, h: 7 }],
}

describe('generateValley — le socle', () => {
  it('est déterministe : même squelette + même seed → même carte, bit à bit', () => {
    const a = generateValley(TEST_SKELETON, 7)
    const b = generateValley(TEST_SKELETON, 7)
    expect(a.terrain).toEqual(b.terrain)
    expect(a.zones).toEqual(b.zones)
    const c = generateValley(TEST_SKELETON, 8)
    expect(c.terrain).not.toEqual(a.terrain)
  })

  it("l'enceinte est étanche : tout le bord est bloquant", () => {
    const map = generateValley(TEST_SKELETON, 7)
    for (let i = 0; i < 48; i++) {
      expect(isBlockingTile(map, i, 0)).toBe(true)
      expect(isBlockingTile(map, i, 47)).toBe(true)
      expect(isBlockingTile(map, 0, i)).toBe(true)
      expect(isBlockingTile(map, 47, i)).toBe(true)
    }
  })

  it('la région forestière est majoritairement boisée', () => {
    const map = generateValley(TEST_SKELETON, 7)
    let forest = 0
    let total = 0
    for (let ty = 8; ty < 14; ty++) {
      for (let tx = 10; tx < 28; tx++) {
        total += 1
        if (terrainAt(map, tx, ty) === TERRAIN_FOREST) forest += 1
      }
    }
    expect(forest / total).toBeGreaterThan(0.6)
  })

  it('la crête est un mur de roche', () => {
    const map = generateValley(TEST_SKELETON, 7)
    for (let tx = 6; tx <= 18; tx++) expect(isBlockingTile(map, tx, 20)).toBe(true)
  })

  it('les zones sont copiées depuis les landmarks (pas de référence partagée)', () => {
    const map = generateValley(TEST_SKELETON, 7)
    expect(map.zones).toEqual(TEST_SKELETON.landmarks)
    expect(map.zones[0]).not.toBe(TEST_SKELETON.landmarks[0])
  })
})
```

Note : à ce stade la rivière/lac/routes du squelette sont **déclarées mais pas encore peintes** (Task 4) — aucun test de cette task n'en dépend.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: FAIL — « Cannot find module './valleygen' ».

- [ ] **Step 3: Implémenter le socle de `valleygen.ts`**

```ts
/**
 * Le générateur de vallée — squelette déclaratif + chair procédurale (GDD §9,
 * design 2026-07-06). Le squelette est de la donnée artisanale (rivière,
 * crêtes, routes, landmarks) ; la génération remplit les biomes depuis la
 * seed. Tout est exact au bit près (noise.ts, arithmétique autorisée).
 *
 * C'est l'équivalent en code du couple « squelette Tiled + remplissage » des
 * vraies cartes de saison : quand Tiled arrivera (V9/S0), l'import remplira
 * le même WorldMap — l'architecture ne bouge pas.
 */
import {
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_WALL,
} from './balance'
import { createEmptyMap, type WorldMap, type Zone } from './map'
import { fbm2, hash2 } from './noise'

export interface ValleyPoint {
  x: number
  y: number
}

/** Rectangle de biome : seuils de densité [0, 1] pour la chair procédurale. */
export interface ValleyRegion {
  x: number
  y: number
  w: number
  h: number
  forest?: number
  rock?: number
  marsh?: number
}

export interface ValleySkeleton {
  width: number
  height: number
  /** Épaisseur minimale de l'enceinte montagneuse (bruitée par-dessus). */
  borderThickness: number
  /** Crêtes internes — ex. le mur qui isole le Plateau, percé au Col. */
  ridges: { points: ValleyPoint[]; halfWidth: number }[]
  river: { points: ValleyPoint[]; halfWidth: number }
  lake: { x: number; y: number; r: number }
  roads: ValleyPoint[][]
  crossings: { kind: 'bridge' | 'ford'; x: number; y: number }[]
  /** Clairières forcées en herbe — spawn, sites de village. */
  clearings: { x: number; y: number; r: number }[]
  /** Tampons de ruines (murs brisés) — le Hameau. */
  ruins: ValleyPoint[]
  regions: ValleyRegion[]
  /** Deviennent map.zones dans cet ordre — les plus spécifiques d'abord. */
  landmarks: Zone[]
}

const DEFAULT_BIOME = { forest: 0.3, rock: 0.05, marsh: 0 }

export function generateValley(skeleton: ValleySkeleton, seed: number): WorldMap {
  const map = createEmptyMap(skeleton.width, skeleton.height, TERRAIN_GRASS)
  paintBiomes(map, skeleton, seed)
  paintBorder(map, skeleton, seed)
  for (const ridge of skeleton.ridges) {
    paintPolyline(map, ridge.points, ridge.halfWidth, () => TERRAIN_ROCK)
  }
  map.zones = skeleton.landmarks.map((z) => ({ ...z }))
  return map
}

function setTile(map: WorldMap, tx: number, ty: number, id: number): void {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return
  map.terrain[ty * map.width + tx] = id
}

/** Décide du terrain à poser selon l'existant ; undefined = ne pas toucher. */
type Paint = (current: number) => number | undefined

/** Tamponne un disque (distance euclidienne au carré — pas de trigo). */
function stampDisk(map: WorldMap, cx: number, cy: number, r: number, paint: Paint): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
      const next = paint(map.terrain[ty * map.width + tx] ?? 0)
      if (next !== undefined) setTile(map, tx, ty, next)
    }
  }
}

/** Trace une polyligne en tamponnant des disques le long des segments. */
function paintPolyline(map: WorldMap, points: ValleyPoint[], halfWidth: number, paint: Paint): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1) * 2
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      stampDisk(map, Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t), halfWidth, paint)
    }
  }
}

/** La chair : biomes par région, seuils sur bruit fractal. */
function paintBiomes(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const region = skeleton.regions.find(
        (r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h,
      )
      const marsh = region?.marsh ?? DEFAULT_BIOME.marsh
      const forest = region?.forest ?? DEFAULT_BIOME.forest
      const rock = region?.rock ?? DEFAULT_BIOME.rock
      if (marsh > 0 && fbm2(tx, ty, 16, (seed ^ 0x33aa17) | 0) < marsh) {
        setTile(map, tx, ty, TERRAIN_MARSH)
      } else if (fbm2(tx, ty, 24, seed) < forest) {
        setTile(map, tx, ty, TERRAIN_FOREST)
      } else if (hash2(tx, ty, (seed ^ 0x7f4a21) | 0) < rock) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
  }
}

/** L'enceinte montagneuse — épaisseur bruitée, aucun passage. */
function paintBorder(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const d = Math.min(tx, ty, map.width - 1 - tx, map.height - 1 - ty)
      const th = skeleton.borderThickness + Math.floor(4 * fbm2(tx, ty, 12, (seed ^ 0xb0bd91) | 0))
      if (d < th) setTile(map, tx, ty, TERRAIN_ROCK)
    }
  }
}
```

Note : `TERRAIN_DEEP_WATER`, `TERRAIN_SHALLOW_WATER`, `TERRAIN_ROAD`, `TERRAIN_WALL` sont importés dès maintenant mais utilisés en Task 4 — si le lint refuse les imports morts, ne les ajouter qu'en Task 4.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS (5 tests). Si « la région forestière » échoue de peu, c'est un seuil de bruit — vérifier `fbm2` (moyenne ~0,5) avant de toucher au test.

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe.

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): generateValley — squelette déclaratif, biomes, enceinte, crêtes"
```

---

### Task 4: `valleygen.ts` — rivière, lac, routes, franchissements, clairières, ruines

**Files:**
- Modify: `packages/sim/src/valleygen.ts`
- Test: `packages/sim/src/valleygen.test.ts` (nouveau `describe`)

**Interfaces:**
- Consumes: helpers de Task 3 (`stampDisk`, `paintPolyline`, `setTile`, type `Paint`).
- Produces: `generateValley` complet — l'ordre des passes est le contrat : biomes → enceinte → crêtes → rivière/lac → routes (qui épargnent l'eau) → franchissements (pont = route sur l'eau, gué = eau peu profonde) → clairières → ruines → zones.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `packages/sim/src/valleygen.test.ts` :

```ts
describe('generateValley — rivière, routes, franchissements', () => {
  const map = generateValley(TEST_SKELETON, 7)

  it("la rivière coule : eau profonde au centre, berges en eau peu profonde", () => {
    expect(terrainAt(map, 30, 20)).toBe(TERRAIN_DEEP_WATER)
    expect(terrainAt(map, 33, 20)).toBe(TERRAIN_SHALLOW_WATER)
  })

  it('le lac est en eau, bordé de berges', () => {
    expect(terrainAt(map, 30, 40)).toBe(TERRAIN_DEEP_WATER)
  })

  it("le pont porte la route par-dessus la rivière — la traversée est continue", () => {
    expect(terrainAt(map, 30, 30)).toBe(TERRAIN_ROAD)
    for (let tx = 9; tx <= 39; tx++) {
      expect(isBlockingTile(map, tx, 30)).toBe(false)
    }
  })

  it("un gué traverse en eau peu profonde (marchable, lent)", () => {
    const ford: ValleySkeleton = {
      ...TEST_SKELETON,
      crossings: [{ kind: 'ford', x: 30, y: 30 }],
    }
    const m = generateValley(ford, 7)
    expect(terrainAt(m, 30, 30)).toBe(TERRAIN_SHALLOW_WATER)
    expect(isBlockingTile(m, 30, 30)).toBe(false)
  })

  it('la route ne remplace jamais l'eau hors franchissement', () => {
    // la rivière coupe la route : sans le pont, l'eau resterait de l'eau
    const sans: ValleySkeleton = { ...TEST_SKELETON, crossings: [] }
    const m = generateValley(sans, 7)
    expect(terrainAt(m, 30, 30)).toBe(TERRAIN_DEEP_WATER)
  })

  it('la clairière est nettoyée (herbe ou route uniquement)', () => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = terrainAt(map, 10 + dx, 30 + dy)
        expect([TERRAIN_GRASS, TERRAIN_ROAD]).toContain(t)
      }
    }
  })

  it('la ruine pose des murs brisés sur sol nettoyé', () => {
    expect(terrainAt(map, 12, 34)).toBe(TERRAIN_WALL)
    expect(isBlockingTile(map, 14, 35)).toBe(false) // la brèche
  })
})
```

Compléter les imports du fichier de test : `TERRAIN_DEEP_WATER, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER, TERRAIN_WALL` depuis `./balance`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: FAIL — les nouveaux cas (la rivière n'est pas peinte : herbe à la place).

- [ ] **Step 3: Implémenter les passes restantes**

Dans `generateValley`, remplacer le corps par l'ordre complet :

```ts
export function generateValley(skeleton: ValleySkeleton, seed: number): WorldMap {
  const map = createEmptyMap(skeleton.width, skeleton.height, TERRAIN_GRASS)
  paintBiomes(map, skeleton, seed)
  paintBorder(map, skeleton, seed)
  for (const ridge of skeleton.ridges) {
    paintPolyline(map, ridge.points, ridge.halfWidth, () => TERRAIN_ROCK)
  }
  paintRiver(map, skeleton)
  paintRoads(map, skeleton)
  paintCrossings(map, skeleton)
  for (const c of skeleton.clearings) stampDisk(map, c.x, c.y, c.r, paintClear)
  for (const r of skeleton.ruins) paintRuin(map, r.x, r.y)
  map.zones = skeleton.landmarks.map((z) => ({ ...z }))
  return map
}
```

Et ajouter en fin de fichier :

```ts
const isWater = (t: number): boolean => t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER

/** Nettoie en herbe — sans toucher l'eau ni la route. */
const paintClear: Paint = (cur) => (isWater(cur) || cur === TERRAIN_ROAD ? undefined : TERRAIN_GRASS)

function paintRiver(map: WorldMap, skeleton: ValleySkeleton): void {
  const { points, halfWidth } = skeleton.river
  paintPolyline(map, points, halfWidth + 1, () => TERRAIN_SHALLOW_WATER)
  paintPolyline(map, points, halfWidth, () => TERRAIN_DEEP_WATER)
  const { x, y, r } = skeleton.lake
  stampDisk(map, x, y, r + 2, () => TERRAIN_SHALLOW_WATER)
  stampDisk(map, x, y, r, () => TERRAIN_DEEP_WATER)
}

/** Les routes percent tout SAUF l'eau — le franchissement est une décision. */
function paintRoads(map: WorldMap, skeleton: ValleySkeleton): void {
  const paintRoad: Paint = (cur) => (isWater(cur) ? undefined : TERRAIN_ROAD)
  for (const road of skeleton.roads) paintPolyline(map, road, 1, paintRoad)
}

/** Pont : la route enjambe l'eau. Gué : l'eau devient peu profonde. */
function paintCrossings(map: WorldMap, skeleton: ValleySkeleton): void {
  const r = skeleton.river.halfWidth + 2
  for (const c of skeleton.crossings) {
    stampDisk(map, c.x, c.y, r, () => (c.kind === 'bridge' ? TERRAIN_ROAD : TERRAIN_SHALLOW_WATER))
  }
}

/** Un pan de bâtiment effondré — murs percés de brèches, sol nettoyé. */
const RUIN_WALLS: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [2, 0], [4, 0],
  [0, 1], [4, 1],
  [0, 3], [1, 3], [3, 3], [4, 3],
]

function paintRuin(map: WorldMap, x: number, y: number): void {
  stampDisk(map, x + 2, y + 1, 4, paintClear)
  for (const [dx, dy] of RUIN_WALLS) setTile(map, x + dx, y + dy, TERRAIN_WALL)
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS (12 tests). Le cas « ruine » vérifie (12,34) mur et (14,35) libre : avec le tampon en (12,34), les murs sont aux offsets de `RUIN_WALLS` — (14,35) correspond à l'offset (2,1) qui n'y figure pas.

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe.

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): generateValley complet — rivière, routes, pont/gué, clairières, ruines"
```

---

### Task 5: Le squelette de la Veillée (`valley-veillee.ts`) + critères d'acceptation

**Files:**
- Create: `packages/sim/src/valley-veillee.ts`
- Test: `packages/sim/src/valley-veillee.test.ts`
- Modify: `packages/sim/src/index.ts` (section hôte, à côté de `foundNpcVillage`)

**Interfaces:**
- Consumes: `ValleySkeleton`, `generateValley` (Task 3-4) ; `generateNodes` (`./economy`).
- Produces: `VEILLEE_SKELETON: ValleySkeleton` (192×192) et `VEILLEE_SITES` — `{ spawn: {x,y}, foyer: {x,y}, meute: {x,y}, neutre: {x,y}, boars: {x,y}[], zombies: {x,y}[] }`. Exportés de l'index. Les consommateurs (Task 6-7) appellent `generateValley(VEILLEE_SKELETON, seed)` et placent villages/monstres sur `VEILLEE_SITES`.

- [ ] **Step 1: Écrire les tests d'acceptation qui échouent**

Créer `packages/sim/src/valley-veillee.test.ts` — ce sont les critères de la spec :

```ts
import { describe, expect, it } from 'vitest'
import { isBlockingTile, zoneAt, type WorldMap } from './map'
import { TERRAINS } from './balance'
import { generateNodes } from './economy'
import { generateValley } from './valleygen'
import { VEILLEE_SITES, VEILLEE_SKELETON } from './valley-veillee'

/** Flood-fill 4-voisins depuis (sx, sy) → indices de tuiles atteignables. */
function reachable(map: WorldMap, sx: number, sy: number): Set<number> {
  const seen = new Set<number>()
  const stack = [sy * map.width + sx]
  seen.add(stack[0]!)
  while (stack.length > 0) {
    const idx = stack.pop()!
    const tx = idx % map.width
    const ty = (idx - tx) / map.width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = tx + dx
      const ny = ty + dy
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue
      const nidx = ny * map.width + nx
      if (seen.has(nidx) || isBlockingTile(map, nx, ny)) continue
      seen.add(nidx)
      stack.push(nidx)
    }
  }
  return seen
}

describe('la Vallée de la Veillée — critères d'acceptation', () => {
  const map = generateValley(VEILLEE_SKELETON, 2026)
  const from = reachable(map, Math.floor(VEILLEE_SITES.spawn.x), Math.floor(VEILLEE_SITES.spawn.y))

  it('R1 — déterminisme : même seed → même carte', () => {
    const again = generateValley(VEILLEE_SKELETON, 2026)
    expect(again.terrain).toEqual(map.terrain)
    expect(again.zones).toEqual(map.zones)
  })

  it('R2 — connectivité : chaque landmark a au moins une tuile atteignable depuis le spawn', () => {
    for (const zone of map.zones) {
      let ok = false
      for (let ty = zone.y; ty < zone.y + zone.h && !ok; ty++) {
        for (let tx = zone.x; tx < zone.x + zone.w && !ok; tx++) {
          if (from.has(ty * map.width + tx)) ok = true
        }
      }
      expect(ok, `zone « ${zone.name} » injoignable depuis le spawn`).toBe(true)
    }
  })

  it('R2bis — les sites (spawn, villages, monstres) sont sur des tuiles marchables atteignables', () => {
    const sites = [
      VEILLEE_SITES.spawn, VEILLEE_SITES.foyer, VEILLEE_SITES.meute, VEILLEE_SITES.neutre,
      ...VEILLEE_SITES.boars, ...VEILLEE_SITES.zombies,
    ]
    for (const s of sites) {
      expect(from.has(Math.floor(s.y) * map.width + Math.floor(s.x))).toBe(true)
    }
  })

  it('R3 — les landmarks attendus existent ; la Mine est un gisement', () => {
    const names = map.zones.map((z) => z.name)
    for (const n of [
      'la Clairière', 'la Croisée', 'le Pont', 'le Gué', 'le Col', 'le Hameau abandonné',
      'la Mine du Levant', 'le Lac', 'le Plateau', 'la Vieille Forêt',
      'les Collines du Levant', 'le Marais', 'la Plaine',
    ]) {
      expect(names, `landmark « ${n} » absent`).toContain(n)
    }
    const mine = map.zones.find((z) => z.name === 'la Mine du Levant')!
    expect(mine.kind).toBe('gisement')
    // zoneAt au centre de la Mine doit retourner la Mine (ordre des zones :
    // spécifiques d'abord) — generateNodes en dépend pour poser le minerai.
    expect(zoneAt(map, mine.x + mine.w / 2, mine.y + mine.h / 2)?.name).toBe('la Mine du Levant')
  })

  it('R4 — sanité : 55-85 % de tuiles marchables, dimensions 192×192', () => {
    expect(map.width).toBe(192)
    expect(map.height).toBe(192)
    const walkable = map.terrain.filter((t) => TERRAINS[t]?.walkable).length
    expect(walkable / map.terrain.length).toBeGreaterThan(0.55)
    expect(walkable / map.terrain.length).toBeLessThan(0.85)
  })

  it('R5 — la chair : minerai à la Mine, T1 en Plaine, fibres au Marais', () => {
    const nodes = generateNodes(map, 2026)
    const inZone = (name: string, type: string): number => {
      const z = map.zones.find((zz) => zz.name === name)!
      return nodes.filter(
        (n) => n.type === type && n.tx >= z.x && n.tx < z.x + z.w && n.ty >= z.y && n.ty < z.y + z.h,
      ).length
    }
    expect(inZone('la Mine du Levant', 'iron_vein')).toBeGreaterThan(0)
    expect(inZone('la Mine du Levant', 'coal_seam')).toBeGreaterThan(0)
    expect(inZone('la Plaine', 'berry_bush')).toBeGreaterThan(3)
    expect(inZone('la Plaine', 'tree')).toBeGreaterThan(3)
    expect(inZone('le Marais', 'fiber_plant')).toBeGreaterThan(5)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valley-veillee.test.ts`
Expected: FAIL — « Cannot find module './valley-veillee' ».

- [ ] **Step 3: Écrire le squelette**

Créer `packages/sim/src/valley-veillee.ts` :

```ts
/**
 * La Vallée de la Veillée — le squelette artisanal de la carte solo
 * (design 2026-07-06). Coordonnées en tuiles, axe y vers le sud.
 *
 * Cinq régions : la Plaine (ouest, domestique), la Vieille Forêt (nord-ouest,
 * dense), les Collines du Levant (nord-est, la Mine), le Marais et le Lac
 * (sud), le Plateau (nord, derrière le Col). La rivière descend du nord et se
 * jette dans le Lac ; deux franchissements — le Pont (route) et le Gué.
 *
 * Les seuils de biome sont du contenu de carte, ajustés à l'œil au smoke
 * test — pas des nombres d'équilibrage (balance.ts).
 */
import type { ValleySkeleton } from './valleygen'

export const VEILLEE_SKELETON: ValleySkeleton = {
  width: 192,
  height: 192,
  borderThickness: 4,
  // La crête du Plateau, percée au Col (x 48-60) ; le bras est meurt dans la
  // gorge de la rivière — on peut remonter la berge à gué, c'est voulu.
  ridges: [
    { points: [{ x: 6, y: 38 }, { x: 48, y: 38 }], halfWidth: 2 },
    { points: [{ x: 60, y: 38 }, { x: 114, y: 38 }], halfWidth: 2 },
  ],
  river: {
    points: [
      { x: 118, y: 6 }, { x: 116, y: 28 }, { x: 112, y: 52 }, { x: 106, y: 76 },
      { x: 108, y: 100 }, { x: 114, y: 120 }, { x: 120, y: 138 }, { x: 126, y: 152 },
    ],
    halfWidth: 2,
  },
  lake: { x: 126, y: 152, r: 13 },
  roads: [
    // la grand-route ouest-est : Clairière → Croisée → Pont → l'Est
    [{ x: 22, y: 118 }, { x: 76, y: 118 }, { x: 146, y: 118 }, { x: 170, y: 118 }],
    // la route de la Mine, depuis l'est du Pont
    [{ x: 146, y: 118 }, { x: 150, y: 90 }, { x: 154, y: 60 }, { x: 156, y: 46 }],
    // le sentier du Gué : Croisée → nord → gué → les Collines
    [{ x: 76, y: 118 }, { x: 72, y: 90 }, { x: 84, y: 64 }, { x: 104, y: 48 }, { x: 122, y: 44 }, { x: 148, y: 44 }],
    // le sentier du Col : bifurcation vers le Plateau
    [{ x: 72, y: 90 }, { x: 62, y: 66 }, { x: 54, y: 44 }, { x: 50, y: 22 }],
    // le sentier du Hameau : Croisée → sud → le Marais
    [{ x: 76, y: 118 }, { x: 82, y: 132 }, { x: 90, y: 144 }, { x: 98, y: 154 }],
  ],
  crossings: [
    { kind: 'bridge', x: 113, y: 118 },
    { kind: 'ford', x: 113, y: 45 },
  ],
  clearings: [
    { x: 22, y: 116, r: 6 },   // la Clairière (spawn)
    { x: 38, y: 108, r: 7 },   // site du village Foyer
    { x: 146, y: 110, r: 7 },  // site du village Meute
    { x: 40, y: 132, r: 6 },   // site du village neutre (scénario)
    { x: 54, y: 37, r: 5 },    // le Col — toujours ouvert
  ],
  ruins: [
    { x: 86, y: 138 },
    { x: 93, y: 143 },
  ],
  regions: [
    { x: 8, y: 8, w: 100, h: 28, forest: 0.42, rock: 0.1 },    // le Plateau
    { x: 8, y: 40, w: 100, h: 56, forest: 0.62, rock: 0.04 },  // la Vieille Forêt
    { x: 126, y: 8, w: 60, h: 84, forest: 0.3, rock: 0.2 },    // les Collines
    { x: 8, y: 96, w: 112, h: 52, forest: 0.35, rock: 0.03 },  // la Plaine
    { x: 56, y: 148, w: 88, h: 38, marsh: 0.55, forest: 0.1 }, // le Marais
  ],
  landmarks: [
    // Les spécifiques d'abord : zoneAt prend la première zone contenante,
    // et generateNodes lit kind='gisement' via zoneAt.
    { name: 'la Clairière', x: 16, y: 110, w: 12, h: 12 },
    { name: 'la Croisée', x: 72, y: 114, w: 9, h: 9 },
    { name: 'le Pont', x: 108, y: 113, w: 11, h: 10 },
    { name: 'le Gué', x: 108, y: 40, w: 11, h: 10 },
    { name: 'le Col', x: 48, y: 30, w: 12, h: 14 },
    { name: 'le Hameau abandonné', x: 84, y: 136, w: 14, h: 12 },
    { name: 'la Mine du Levant', kind: 'gisement', x: 146, y: 36, w: 16, h: 14 },
    { name: 'la Tanière des Sangliers', kind: 'taniere', x: 34, y: 64, w: 6, h: 6 },
    { name: 'la Vieille Tanière', kind: 'taniere', x: 58, y: 82, w: 6, h: 6 },
    { name: 'le Lac', x: 113, y: 139, w: 26, h: 26 },
    // Les régions ensuite — le HUD nomme la région quand rien de plus précis.
    { name: 'le Plateau', x: 8, y: 8, w: 100, h: 28 },
    { name: 'la Vieille Forêt', x: 8, y: 40, w: 100, h: 56 },
    { name: 'les Collines du Levant', x: 126, y: 8, w: 60, h: 84 },
    { name: 'le Marais', x: 56, y: 148, w: 88, h: 38 },
    { name: 'la Plaine', x: 8, y: 96, w: 112, h: 52 },
  ],
}

/** Les sites du scénario — où l'hôte pose spawn, villages et monstres. */
export const VEILLEE_SITES = {
  spawn: { x: 22.5, y: 116.5 },
  foyer: { x: 38, y: 108 },
  meute: { x: 146, y: 110 },
  neutre: { x: 40, y: 132 },
  boars: [
    { x: 36, y: 66 }, { x: 60, y: 84 }, { x: 46, y: 74 },
  ],
  zombies: [
    { x: 90, y: 142 }, { x: 86, y: 148 },          // le Hameau
    { x: 100, y: 158 }, { x: 118, y: 172 },        // le Marais
    { x: 40, y: 20 }, { x: 64, y: 16 },            // le Plateau
  ],
}
```

- [ ] **Step 4: Itérer jusqu'au vert**

Run: `pnpm --filter @braises/sim exec vitest run src/valley-veillee.test.ts`
Expected: PASS (6 tests). C'est l'étape de calibrage : si la connectivité échoue, les suspects sont (dans l'ordre) un site de monstre tombé sur une tuile de roche/bruit (déplacer le site de 1-2 tuiles), une zone entièrement recouverte par le bruit (ajouter une clairière), le Col obstrué (élargir sa clairière). **Ajuster les coordonnées du squelette, pas le générateur ni les tests.**

- [ ] **Step 5: Exporter depuis l'API publique**

Dans `packages/sim/src/index.ts`, dans la section hôte (à côté de `export { foundNpcVillage } from './worldgen'`) :

```ts
export { generateValley } from './valleygen'
export type { ValleySkeleton, ValleyRegion, ValleyPoint } from './valleygen'
export { VEILLEE_SKELETON, VEILLEE_SITES } from './valley-veillee'
```

- [ ] **Step 6: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe.

```bash
git add packages/sim/src/valley-veillee.ts packages/sim/src/valley-veillee.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): VEILLEE_SKELETON — la Vallée de la Veillée 192×192, critères d'acceptation"
```

---

### Task 6: Le client joue dans la Vallée (suppression de `demo-map.ts`)

**Files:**
- Modify: `packages/client/src/worker/veillee.ts`
- Modify: `packages/client/src/scenes/WorldScene.ts:29` (import `hash2`) et `:79-89` (couleur marais)
- Delete: `packages/client/src/demo-map.ts`

**Interfaces:**
- Consumes: `generateValley`, `VEILLEE_SKELETON`, `VEILLEE_SITES`, `hash2` — tous depuis `@braises/sim` (Task 1, 5).
- Produces: `veillee.ts` continue d'exporter `VEILLEE_SEED`, `VEILLEE_CALENDAR_SCALE`, `VEILLEE_SPAWN`, `createVeillee()` — mêmes signatures, `sim-worker.ts` ne change pas.

- [ ] **Step 1: Réécrire `veillee.ts`**

Remplacer le contenu de `packages/client/src/worker/veillee.ts` :

```ts
/**
 * Le scénario de la Veillée — il appartient à l'HÔTE, pas au client.
 *
 * Seed, carte, rythme du calendrier et peuplement sont des décisions d'hôte :
 * en Phase LAN, ce module (ou son équivalent) vivra sur le serveur, et le
 * client ne fera que `join`. Le client reçoit la carte dans `ready`.
 */
import {
  createSim,
  foundNpcVillage,
  generateNodes,
  generateValley,
  spawnEntity,
  spawnMonster,
  VEILLEE_SITES,
  VEILLEE_SKELETON,
  type SimState,
} from '@braises/sim'

export const VEILLEE_SEED = 2026
/** Démo : un jour de saison toutes les 2 minutes. */
export const VEILLEE_CALENDAR_SCALE = 720
export const VEILLEE_SPAWN = VEILLEE_SITES.spawn

export function createVeillee(): { sim: SimState; playerId: number } {
  // Le squelette artisanal ; la « chair » (biomes puis ressources) vient de la seed.
  const map = generateValley(VEILLEE_SKELETON, VEILLEE_SEED)
  const nodes = generateNodes(map, VEILLEE_SEED)
  const sim = createSim(VEILLEE_SEED, { map, calendarScale: VEILLEE_CALENDAR_SCALE, nodes })
  // Les voisins à caractère (spec alignement R12) : le Foyer dans la Plaine,
  // la Meute à l'est du Pont — sur la route de la Mine, évidemment.
  foundNpcVillage(sim, VEILLEE_SITES.foyer.x, VEILLEE_SITES.foyer.y, 4, 'foyer')
  foundNpcVillage(sim, VEILLEE_SITES.meute.x, VEILLEE_SITES.meute.y, 3, 'meute')
  // La menace et le gibier : sangliers aux tanières, zombies au Hameau, au
  // Marais et sur le Plateau.
  for (const p of VEILLEE_SITES.boars) spawnMonster(sim, 'boar', p.x, p.y)
  for (const p of VEILLEE_SITES.zombies) spawnMonster(sim, 'zombie', p.x, p.y)
  // Le joueur commence les mains vides (spec économie) — pas de kit de départ.
  const playerId = spawnEntity(sim, VEILLEE_SPAWN.x, VEILLEE_SPAWN.y)
  return { sim, playerId }
}
```

- [ ] **Step 2: Adapter `WorldScene.ts` et supprimer `demo-map.ts`**

Dans `packages/client/src/scenes/WorldScene.ts` :
- Ligne 29 : remplacer `import { hash2 } from '../demo-map'` par un ajout de `hash2` à l'import existant depuis `'@braises/sim'`.
- Table `TERRAIN_COLORS` (ligne ~79) : ajouter après l'entrée `7` :

```ts
  8: 0x556b4a, // marais
```

Puis :

```bash
rm packages/client/src/demo-map.ts
```

- [ ] **Step 3: Vérifier qu'aucune référence ne survit**

Run: `grep -rn "demo-map\|createDemoMap\|DEMO_MAP_SIZE\|PLAYER_SPAWN" packages/client/src packages/sim/src`
Expected: aucun résultat.

- [ ] **Step 4: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe (dont `framing.test.ts` côté client, qui ne dépend pas de la carte).

```bash
git add packages/client/src/worker/veillee.ts packages/client/src/scenes/WorldScene.ts packages/client/src/demo-map.ts
git commit -m "feat(client): la Veillée se joue dans la Vallée 192×192 — demo-map supprimée"
```

---

### Task 7: Le banc de calibrage sur la Vallée (`scenario.ts`)

**Files:**
- Modify: `packages/sim/src/scenario.ts:33-41`

**Interfaces:**
- Consumes: `generateValley`, `VEILLEE_SKELETON`, `VEILLEE_SITES` (Task 5).
- Produces: `runScenario(seed, days)` inchangé en signature — le rapport tourne désormais sur la vraie Vallée (spec : « scenario.ts consomme la même vallée »).

- [ ] **Step 1: Basculer la carte du scénario**

Dans `packages/sim/src/scenario.ts`, remplacer les lignes 34-41 (la carte 48×48 artisanale) par :

```ts
  const map = generateValley(VEILLEE_SKELETON, seed)
  const nodes = generateNodes(map, seed)
  const sim = createSim(seed, { map, nodes, calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE })
  foundNpcVillage(sim, VEILLEE_SITES.foyer.x, VEILLEE_SITES.foyer.y, 4, 'foyer')
  foundNpcVillage(sim, VEILLEE_SITES.meute.x, VEILLEE_SITES.meute.y, 3, 'meute')
  foundNpcVillage(sim, VEILLEE_SITES.neutre.x, VEILLEE_SITES.neutre.y, 3, 'neutre')
```

Adapter les imports : ajouter `generateValley` (`./valleygen`), `VEILLEE_SKELETON, VEILLEE_SITES` (`./valley-veillee`) ; retirer `createEmptyMap`, `TERRAIN_GRASS`, `TERRAIN_ROAD` s'ils deviennent inutilisés.

- [ ] **Step 2: Jouer le scénario — c'est le gate de calibrage**

Run: `pnpm scenario`
Expected: PASS — `starvationSamples ≤ 3`, le Foyer a des survivants, la chronique a > 2 entrées. Lire le rapport imprimé.

**Si l'invariant de faim casse** : les PNJ récoltent le cercle domestique — vérifier que les clairières des villages (Task 5) laissent des buissons à portée ; au besoin, déplacer le site du village de quelques tuiles vers une zone à baies (c'est un ajustement de **squelette**, pas de `balance.ts`). Relancer aussi `SCENARIO_DAYS=20 pnpm scenario` une fois pour vérifier la tenue à moyen terme, et coller le rapport dans le message de commit.

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe.

```bash
git add packages/sim/src/scenario.ts
git commit -m "feat(sim): le banc de calibrage tourne sur la Vallée de la Veillée"
```

---

### Task 8: Vérification visuelle + journal des décisions

**Files:**
- Modify: `docs/decisions.md` (une ligne — **ne pas commiter**, le fichier a des modifications utilisateur non commitées)
- Create (temporaire): `$CLAUDE_JOB_DIR/tmp/smoke-vallee.mjs`

**Interfaces:**
- Consumes: le jeu buildé (`pnpm build` → `packages/client/dist`).
- Produces: une capture d'écran de la Vallée + la ligne de décision. Aucun code livré.

- [ ] **Step 1: Builder et servir**

```bash
pnpm build
pnpm --filter @braises/client exec vite preview --port 4173 &
```

(`pnpm dev` est bloqué par un cache `.vite` root — c'est connu, utiliser build+preview.)

- [ ] **Step 2: Capturer la Vallée au chargement**

Localiser le Chromium en cache : `ls ~/.cache/ms-playwright/` (sinon réutiliser celui du projet Manif — voir l'historique git V2 du smoke test). Écrire `$CLAUDE_JOB_DIR/tmp/smoke-vallee.mjs` :

```js
import { chromium } from '/home/alexis/projects/demo/node_modules/playwright-core/index.mjs'

const executablePath = process.env.CHROMIUM_PATH // chemin trouvé à l'étape précédente
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:4173')
await page.waitForFunction(() => window.__BRAISES__ !== undefined, { timeout: 15000 })
await page.waitForTimeout(2000) // laisser la sim démarrer et la texture se générer
await page.screenshot({ path: process.env.CLAUDE_JOB_DIR + '/tmp/vallee-spawn.png' })
await browser.close()
```

Run: `CHROMIUM_PATH=<chemin trouvé> node $CLAUDE_JOB_DIR/tmp/smoke-vallee.mjs`
Expected: `vallee-spawn.png` montre la Clairière, la route vers l'est, la lisière de la Vieille Forêt au nord — des régions **distinctes à l'œil**, pas un bruit uniforme. Regarder la capture (outil Read) et l'évaluer contre l'objectif de lisibilité de la spec ; ajuster les seuils de biome du squelette si une région ne se détache pas.

- [ ] **Step 3: Consigner la décision**

Ajouter à `docs/decisions.md` (à la suite des entrées existantes, même format) :

```markdown
- 2026-07-06 — La Vallée de la Veillée : 192×192, générée par squelette déclaratif en code (`valleygen.ts` + `VEILLEE_SKELETON`) selon « squelette artisanal, chair procédurale » (GDD §9) ; Tiled reste réservé aux vraies cartes (V9/S0). Nouveau terrain `marsh` (0.6×), `generateNodes` enrichi (baies/fibres au marais). `scenario.ts` calibre désormais sur cette vallée.
```

**Ne pas commiter ce fichier** (modifications utilisateur préexistantes) — signaler à l'utilisateur que la ligne est ajoutée et qu'il committera avec ses propres changements.

- [ ] **Step 4: Nettoyage et bilan**

```bash
kill %1  # arrêter vite preview
```

Vérifier une dernière fois : `pnpm check && pnpm test && pnpm lint`. Présenter à l'utilisateur : la capture d'écran, le rapport de scénario, et rappeler le point en attente (relecture de la ligne de décision).

---

## Self-review (fait à la rédaction)

- **Couverture spec** : géographie (Task 5 — squelette), 5 régions + landmarks + 2 franchissements (Task 4-5), marais nouveau terrain (Task 2), valleygen dans /sim (Task 3-4), VEILLEE_SKELETON partagé client/scénario (Task 6-7), demo-map supprimée + couleur marais (Task 6), decisions.md (Task 8), critères R1-R5 de la spec → tests de Task 5 (déterminisme, connectivité, présence, sanité, chair). Écart assumé documenté en Global Constraints (generateNodes/marais).
- **Cohérence des types** : `ValleySkeleton`/`VEILLEE_SITES` identiques entre Task 3, 5, 6, 7 ; `hash2(x, y, seed?)` compatible avec l'appel `hash2(tx, ty)` de WorldScene.
- **Placeholders** : aucun — chaque étape porte son code ou sa commande exacte. Les seuils de biome sont des valeurs initiales explicites, ajustables au smoke test (Task 5 step 4 et Task 8 step 2 disent où et comment).
