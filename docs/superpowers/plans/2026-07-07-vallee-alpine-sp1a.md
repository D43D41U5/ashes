# Vallée alpine — SP1a (height + bandes + vignette) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produire, headless et déterministe, la première tranche du substrat alpin : un champ d'élévation complexe (enceinte scellée + relief multi-échelle warpé + crêtes ridged), un champ d'humidité, des bandes de terrain façon Whittaker (prairie/marsh/forêt/éboulis/roche/neige), et un **outil de vignette PNG** (hillshade + teinte biome) pour juger l'ambiance alpine et caler la barre — AVANT l'hydrologie/features/chemins (SP1b).

**Architecture:** Pipeline pur dans un nouveau module `alpinegen.ts` : `computeElevation` → `computeMoisture` → `paintAlpineBands`, assemblé par `generateAlpineTerrain(width,height,seed): WorldMap`. Le bruit gagne un `ridgedFbm2` (arêtes vives). `WorldMap` gagne un champ **`elevation`** (distinct de `height`, qui est la dimension en tuiles). Un outil de dev hors-sim (`vignette`) transforme la carte en PNG pour la revue visuelle.

**Tech Stack:** TypeScript pur (`packages/sim`), Vitest. L'écriture PNG (outil dev) utilise Node `zlib` — hors `/sim`, pas soumise à la pureté.

## Global Constraints

- **`/sim` pur** : zéro import Phaser/Colyseus/Node dans les modules de jeu (`balance.ts`, `noise.ts`, `map.ts`, `alpinegen.ts`). L'outil vignette est un script dev séparé (Node autorisé là).
- **Déterministe bit-exact** : opérations autorisées UNIQUEMENT `+ − × /`, `Math.sqrt`, `abs floor ceil round trunc sign min max imul fround`, `>>> ^ | &`, constantes. **INTERDIT** : `sin cos tan pow exp log ** hypot Math.random Date`. Lint de pureté vert.
- **Nommage** : le champ d'élévation s'appelle **`elevation`** (number[], une valeur [0,1] par tuile). NE PAS l'appeler `height` — `WorldMap.height` est déjà la hauteur de la carte en tuiles. `elevation` est **optionnel** dans `WorldMap` (rétro-compat de `createEmptyMap`/tiled).
- **Nouveaux terrains** : `scree` id **9** (walkable, speedFactor **0.7**), `snow` id **10** (walkable **false**, speedFactor 0). Constantes `TERRAIN_SCREE=9`, `TERRAIN_SNOW=10`.
- **Dimensions = paramètres** : `generateAlpineTerrain(width, height, seed)`. Toute échelle/amplitude est une **fraction de `min(width,height)`**, jamais un entier supposant une taille. Testé à deux tailles.
- **Barre AAA** : on juge à la **vignette** (hillshade + couleurs de biome) ; on ne déclare pas « bon » un rendu « bof ». Les seuils de bande sont des constantes de contenu réglées à l'œil.
- **Hors périmètre SP1a** (→ SP1b) : hydrologie (rivières/lacs), placement de features/ancres, chemins, re-siting des villages, banc de scénario, tableaux typés. SP1a n'a **pas d'eau** — la vignette juge le relief et les bandes sèches.
- Vérifs : `pnpm --filter @braises/sim exec vitest run src/<fichier>` (un fichier) ; `pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts` (suite) ; `pnpm check && pnpm lint`.

---

### Task 1: Terrains d'altitude — `scree` et `snow`

**Files:**
- Modify: `packages/sim/src/balance.ts` (table `TERRAINS`, + constantes d'id)
- Test: `packages/sim/src/balance.test.ts` (créer si absent) ou ajouter au test terrain existant

**Interfaces:**
- Produces: `TERRAIN_SCREE = 9`, `TERRAIN_SNOW = 10` ; `TERRAINS[9] = { name:'scree', walkable:true, speedFactor:0.7 }`, `TERRAINS[10] = { name:'snow', walkable:false, speedFactor:0 }`.

- [ ] **Step 1: Écrire le test**

Créer `packages/sim/src/balance.test.ts` (ou ajouter à un test terrain existant si présent — vérifier d'abord `ls packages/sim/src/*balance*`) :

```typescript
import { describe, expect, it } from 'vitest'
import { TERRAINS, TERRAIN_SCREE, TERRAIN_SNOW } from './balance'

describe('terrains d’altitude alpins', () => {
  it('scree est marchable et lent (éboulis)', () => {
    expect(TERRAIN_SCREE).toBe(9)
    expect(TERRAINS[TERRAIN_SCREE]).toEqual({ name: 'scree', walkable: true, speedFactor: 0.7 })
  })
  it('snow est bloquant (pics)', () => {
    expect(TERRAIN_SNOW).toBe(10)
    expect(TERRAINS[TERRAIN_SNOW]!.walkable).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer (RED)**

Run: `pnpm --filter @braises/sim exec vitest run src/balance.test.ts`
Expected: FAIL — `TERRAIN_SCREE`/`TERRAIN_SNOW` non exportés.

- [ ] **Step 3: Ajouter les terrains**

Dans `packages/sim/src/balance.ts`, ajouter les deux lignes à la table `TERRAINS` (après l'id 8) :

```typescript
  8: { name: 'marsh', walkable: true, speedFactor: 0.6 },
  9: { name: 'scree', walkable: true, speedFactor: 0.7 },
  10: { name: 'snow', walkable: false, speedFactor: 0 },
```

Et près des autres constantes d'id de terrain (chercher `TERRAIN_MARSH` pour trouver l'endroit) ajouter :

```typescript
export const TERRAIN_SCREE = 9
export const TERRAIN_SNOW = 10
```

- [ ] **Step 4: Lancer (GREEN)**

Run: `pnpm --filter @braises/sim exec vitest run src/balance.test.ts`
Expected: PASS.

- [ ] **Step 5: Vérifier suite + pureté**

Run: `pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts && pnpm check && pnpm lint`
Expected: vert (les nouveaux terrains n'affectent aucun code existant).

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/balance.ts packages/sim/src/balance.test.ts
git commit -m "feat(sim): terrains alpins scree (marchable lent) et snow (bloquant)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Bruit « ridged » — arêtes alpines

**Files:**
- Modify: `packages/sim/src/noise.ts` (ajout `ridgedFbm2`)
- Modify: `packages/sim/src/index.ts` (export)
- Test: `packages/sim/src/noise.test.ts`

**Interfaces:**
- Consumes: `gradientNoise2` (existant).
- Produces: `ridgedFbm2(x, y, scale, seed = 0): number` → `[0, 1]`, déterministe. Produit des **crêtes vives** (valeurs hautes concentrées le long de lignes) plutôt que des collines douces.

- [ ] **Step 1: Écrire les tests (RED)**

Ajouter dans `packages/sim/src/noise.test.ts`, dans le `describe` existant, et l'import :

```typescript
  it('ridgedFbm2 est stable, dans [0,1], et « crêté » (variance haute)', () => {
    expect(ridgedFbm2(12, 34, 20, 7)).toBe(ridgedFbm2(12, 34, 20, 7))
    let min = 1, max = 0, sum = 0, n = 0
    for (let i = 0; i < 800; i++) {
      const v = ridgedFbm2(i * 1.3, i * 0.7, 20, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      min = Math.min(min, v); max = Math.max(max, v); sum += v; n++
    }
    // Un bruit ridged doit couvrir une large plage (crêtes ↔ creux).
    expect(max - min).toBeGreaterThan(0.6)
  })
```

Import ligne 2 : `import { fbm2, fbmWarp2, gradientNoise2, hash2, ridgedFbm2 } from './noise'`

- [ ] **Step 2: Lancer (RED)**

Run: `pnpm --filter @braises/sim exec vitest run src/noise.test.ts`
Expected: FAIL — `ridgedFbm2` non exporté.

- [ ] **Step 3: Implémenter**

Ajouter à la fin de `packages/sim/src/noise.ts` :

```typescript
/**
 * Bruit fractal « ridged » — crêtes vives pour des arêtes alpines. Chaque
 * octave : r = 1 − |2·grad − 1| (pic quand grad ≈ 0.5) élevé au carré (arêtes
 * plus nettes), sommé sur 4 octaves normalisées. N'utilise que abs + − × / :
 * exact au bit près, pas de trigo.
 */
export function ridgedFbm2(x: number, y: number, scale: number, seed = 0): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let o = 0; o < 4; o++) {
    const g = gradientNoise2((x * freq) / scale, (y * freq) / scale, (seed ^ (o * 0x68e31da)) | 0)
    const r = 1 - Math.abs(2 * g - 1)
    sum += r * r * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}
```

- [ ] **Step 4: Exporter**

Dans `packages/sim/src/index.ts`, ajouter `ridgedFbm2` à l'export depuis `./noise` :

```typescript
export { hash2, gradientNoise2, fbm2, fbmWarp2, ridgedFbm2 } from './noise'
```

- [ ] **Step 5: Lancer (GREEN) + pureté**

Run: `pnpm --filter @braises/sim exec vitest run src/noise.test.ts && pnpm check && pnpm lint`
Expected: PASS, 0 erreur pureté.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/noise.ts packages/sim/src/noise.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): ridgedFbm2 — bruit à crêtes vives pour arêtes alpines

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `WorldMap.elevation` (champ d'altitude, distinct de la dimension)

**Files:**
- Modify: `packages/sim/src/map.ts` (champ optionnel `elevation` + helper `elevationAt`)
- Test: `packages/sim/src/map.test.ts` (ajouter ; créer si absent)

**Interfaces:**
- Produces: `WorldMap.elevation?: number[]` (une valeur `[0,1]` par tuile, indexée `ty*width+tx`, comme `terrain`). `elevationAt(map, tx, ty): number` → l'élévation de la tuile, ou `0` hors carte / si absent.

- [ ] **Step 1: Écrire le test (RED)**

Ajouter (ou créer) `packages/sim/src/map.test.ts` :

```typescript
import { describe, expect, it } from 'vitest'
import { createEmptyMap, elevationAt, type WorldMap } from './map'

describe('WorldMap.elevation', () => {
  it('elevationAt lit le champ, 0 hors carte ou si absent', () => {
    const map: WorldMap = createEmptyMap(4, 4, 1)
    expect(elevationAt(map, 1, 1)).toBe(0) // absent → 0
    map.elevation = new Array(16).fill(0)
    map.elevation[1 * 4 + 2] = 0.7
    expect(elevationAt(map, 2, 1)).toBeCloseTo(0.7)
    expect(elevationAt(map, -1, 0)).toBe(0) // hors carte
  })
})
```

- [ ] **Step 2: Lancer (RED)**

Run: `pnpm --filter @braises/sim exec vitest run src/map.test.ts`
Expected: FAIL — `elevationAt` non exporté / `elevation` inconnu.

- [ ] **Step 3: Implémenter**

Dans `packages/sim/src/map.ts`, ajouter le champ optionnel à l'interface `WorldMap` (après `zones`) :

```typescript
  /** Altitude par tuile [0,1] (substrat alpin). Optionnel — absent sur les
   *  cartes qui n'en produisent pas. NE PAS confondre avec `height` (dimension). */
  elevation?: number[]
```

Et le helper (près de `terrainAt`) :

```typescript
export function elevationAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.elevation?.[ty * map.width + tx] ?? 0
}
```

- [ ] **Step 4: Lancer (GREEN) + suite + pureté**

Run: `pnpm --filter @braises/sim exec vitest run src/map.test.ts && pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts && pnpm check && pnpm lint`
Expected: vert (champ optionnel → aucun consommateur existant cassé).

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/map.ts packages/sim/src/map.test.ts
git commit -m "feat(sim): WorldMap.elevation optionnel + elevationAt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Champ d'élévation — `computeElevation`

**Files:**
- Create: `packages/sim/src/alpinegen.ts`
- Test: `packages/sim/src/alpinegen.test.ts`

**Interfaces:**
- Consumes: `fbmWarp2`, `ridgedFbm2` (Tasks 2), `hash2`.
- Produces: `computeElevation(width: number, height: number, seed: number): number[]` → `width*height` valeurs `[0,1]` (index `ty*width+tx`). **Enceinte scellée** : élévation ≈ 1 sur l'anneau de bord. **Intérieur varié** : relief warpé + crêtes ridged.
- Produces (constantes exportées pour réglage) : `ALPINE` (objet de fractions/poids documenté).

- [ ] **Step 1: Écrire les tests (RED)**

Créer `packages/sim/src/alpinegen.test.ts` :

```typescript
import { describe, expect, it } from 'vitest'
import { computeElevation } from './alpinegen'

describe('computeElevation — le relief alpin', () => {
  const W = 120, H = 180

  it('déterministe : même dims + seed → même champ', () => {
    expect(computeElevation(W, H, 7)).toEqual(computeElevation(W, H, 7))
    expect(computeElevation(W, H, 8)).not.toEqual(computeElevation(W, H, 7))
  })

  it('dans [0,1]', () => {
    const el = computeElevation(W, H, 7)
    for (const v of el) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })

  it('enceinte scellée : le bord est haut (pics), le centre plus bas en moyenne', () => {
    const el = computeElevation(W, H, 7)
    const at = (x: number, y: number): number => el[y * W + x]!
    // anneau de bord ≈ 1
    let borderMin = 1
    for (let x = 0; x < W; x++) { borderMin = Math.min(borderMin, at(x, 0), at(x, H - 1)) }
    for (let y = 0; y < H; y++) { borderMin = Math.min(borderMin, at(0, y), at(W - 1, y)) }
    expect(borderMin).toBeGreaterThan(0.9)
    // moyenne d'une fenêtre centrale nettement < 1
    let sum = 0, n = 0
    for (let y = H / 2 - 10; y < H / 2 + 10; y++) for (let x = W / 2 - 10; x < W / 2 + 10; x++) { sum += at(x, y); n++ }
    expect(sum / n).toBeLessThan(0.7)
  })

  it('intérieur varié : forte variance (crêtes ↔ creux), pas un plat', () => {
    const el = computeElevation(W, H, 7)
    let min = 1, max = 0
    for (let y = 20; y < H - 20; y++) for (let x = 20; x < W - 20; x++) {
      const v = el[y * W + x]!; min = Math.min(min, v); max = Math.max(max, v)
    }
    expect(max - min).toBeGreaterThan(0.5)
  })
})
```

- [ ] **Step 2: Lancer (RED)**

Run: `pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts`
Expected: FAIL — module/fonction absents.

- [ ] **Step 3: Implémenter `computeElevation`**

Créer `packages/sim/src/alpinegen.ts` :

```typescript
/**
 * Le substrat alpin (SP1a) — champ d'élévation, d'humidité, et bandes de terrain
 * façon Whittaker. Pur et déterministe (noise.ts, arithmétique autorisée). Pas
 * d'hydrologie ni de features ici (SP1b). Toutes les échelles/amplitudes sont des
 * fractions de min(width,height) → scalable à toute taille.
 */
import { fbmWarp2, ridgedFbm2 } from './noise'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Constantes de forme du relief — contenu de carte, réglées à la vignette. */
export const ALPINE = {
  RIM_FRAC: 0.06,     // épaisseur de l'anneau de pics (fraction de min(W,H))
  MACRO_FRAC: 0.55,   // grande structure de vallée
  MID_FRAC: 0.18,     // reliefs secondaires
  RIDGE_FRAC: 0.26,   // arêtes ridged
  WARP_FRAC: 0.05,    // amplitude de domain warping
  BASE_WEIGHT: 0.6,   // part du relief doux vs ridged
  RIDGE_WEIGHT: 0.4,
}

export function computeElevation(width: number, height: number, seed: number): number[] {
  const D = Math.min(width, height)
  const rimDepth = Math.max(2, Math.round(D * ALPINE.RIM_FRAC))
  const macro = D * ALPINE.MACRO_FRAC
  const mid = D * ALPINE.MID_FRAC
  const ridge = D * ALPINE.RIDGE_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const el = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y)
      const rim = clamp01((rimDepth - edge) / rimDepth) // 1 au bord → pics
      const base =
        0.7 * fbmWarp2(x, y, macro, (seed ^ 0x1a2b3c) | 0, warp) +
        0.3 * fbmWarp2(x, y, mid, (seed ^ 0x4d5e6f) | 0, warp)
      const ridged = ridgedFbm2(x, y, ridge, (seed ^ 0x7a8b9c) | 0)
      const interior = ALPINE.BASE_WEIGHT * base + ALPINE.RIDGE_WEIGHT * ridged
      el[y * width + x] = clamp01(Math.max(rim, interior))
    }
  }
  return el
}
```

- [ ] **Step 4: Lancer (GREEN)**

Run: `pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts`
Expected: PASS. Si « enceinte » échoue (bord < 0.9), augmenter `RIM_FRAC` ou le plancher ; si « intérieur varié » échoue, ajuster `RIDGE_WEIGHT`. Ce sont des réglages de contenu — noter le changement.

- [ ] **Step 5: Pureté**

Run: `pnpm check && pnpm lint`
Expected: 0 erreur (aucune trigo ; `Math.max/min/round/abs` OK).

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/alpinegen.ts packages/sim/src/alpinegen.test.ts
git commit -m "feat(sim): computeElevation — relief alpin (enceinte scellée + warp + ridged)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Champ d'humidité — `computeMoisture`

**Files:**
- Modify: `packages/sim/src/alpinegen.ts`
- Test: `packages/sim/src/alpinegen.test.ts`

**Interfaces:**
- Consumes: `fbmWarp2`, le tableau `elevation` (Task 4).
- Produces: `computeMoisture(width, height, elevation, seed): number[]` → `[0,1]` par tuile. Plus humide en **basse altitude** (bonus `1-elevation`) et selon un bruit warpé propre.

- [ ] **Step 1: Écrire le test (RED)**

Ajouter à `alpinegen.test.ts` :

```typescript
import { computeMoisture } from './alpinegen'

describe('computeMoisture', () => {
  const W = 100, H = 100
  it('déterministe, dans [0,1], et corrélé négativement à l’altitude', () => {
    const el = computeElevation(W, H, 3)
    const m = computeMoisture(W, H, el, 3)
    expect(m).toEqual(computeMoisture(W, H, el, 3))
    for (const v of m) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    // moyenne d'humidité des tuiles basses > celle des tuiles hautes
    let loSum = 0, loN = 0, hiSum = 0, hiN = 0
    for (let i = 0; i < el.length; i++) {
      if (el[i]! < 0.3) { loSum += m[i]!; loN++ }
      else if (el[i]! > 0.7) { hiSum += m[i]!; hiN++ }
    }
    expect(loSum / loN).toBeGreaterThan(hiSum / hiN)
  })
})
```

- [ ] **Step 2: Lancer (RED)**

Run: `pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts -t moisture`
Expected: FAIL — `computeMoisture` absent.

- [ ] **Step 3: Implémenter**

Ajouter à `alpinegen.ts` (après `computeElevation`) :

```typescript
export function computeMoisture(width: number, height: number, elevation: number[], seed: number): number[] {
  const D = Math.min(width, height)
  const scale = D * 0.3
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const m = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const noise = fbmWarp2(x, y, scale, (seed ^ 0x2fed01) | 0, warp)
      // Plus bas = plus humide (l'eau descend). 0.6 bruit + 0.4 (1 − altitude).
      m[i] = clamp01(0.6 * noise + 0.4 * (1 - elevation[i]!))
    }
  }
  return m
}
```

- [ ] **Step 4: Lancer (GREEN) + pureté**

Run: `pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts && pnpm check && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/alpinegen.ts packages/sim/src/alpinegen.test.ts
git commit -m "feat(sim): computeMoisture — humidité (bruit + bonus basse altitude)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Bandes de terrain façon Whittaker + assemblage `generateAlpineTerrain`

**Files:**
- Modify: `packages/sim/src/alpinegen.ts` (`paintAlpineBands`, `generateAlpineTerrain`)
- Test: `packages/sim/src/alpinegen.test.ts`

**Interfaces:**
- Consumes: `computeElevation`, `computeMoisture`, `createEmptyMap`, `sealBorderRing` (de `valleygen`), les constantes de terrain.
- Produces:
  - `generateAlpineTerrain(width, height, seed): WorldMap` — carte complète avec `terrain` (bandes) + `elevation` peuplé.
  - Bandes : `elevation < T_FLOOR` → prairie/marsh (selon humidité) ; `< T_FOREST` → forêt (dense si humide, clairsemée près de la limite) ; `< T_SCREE` → éboulis ; `< T_SNOW` → roche ; sinon neige. Anneau de bord scellé.

- [ ] **Step 1: Écrire les tests (RED)**

Ajouter à `alpinegen.test.ts` :

```typescript
import { generateAlpineTerrain } from './alpinegen'
import { isBlockingTile, terrainAt } from './map'
import {
  TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_MARSH, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW,
} from './balance'

describe('generateAlpineTerrain — bandes & assemblage', () => {
  const W = 160, H = 240

  it('déterministe (terrain + elevation)', () => {
    const a = generateAlpineTerrain(W, H, 5)
    const b = generateAlpineTerrain(W, H, 5)
    expect(a.terrain).toEqual(b.terrain)
    expect(a.elevation).toEqual(b.elevation)
  })

  it('enceinte scellée : tout le bord est bloquant', () => {
    const map = generateAlpineTerrain(W, H, 5)
    for (let x = 0; x < W; x++) { expect(isBlockingTile(map, x, 0)).toBe(true); expect(isBlockingTile(map, x, H - 1)).toBe(true) }
    for (let y = 0; y < H; y++) { expect(isBlockingTile(map, 0, y)).toBe(true); expect(isBlockingTile(map, W - 1, y)).toBe(true) }
  })

  it('bandes ordonnées : la neige est en moyenne plus haute que la roche > éboulis > forêt > prairie', () => {
    const map = generateAlpineTerrain(W, H, 5)
    const avgEl: Record<number, { s: number; n: number }> = {}
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const t = terrainAt(map, tx, ty); const e = map.elevation![ty * W + tx]!
      ;(avgEl[t] ??= { s: 0, n: 0 }); avgEl[t]!.s += e; avgEl[t]!.n += 1
    }
    const mean = (t: number): number => (avgEl[t] ? avgEl[t]!.s / avgEl[t]!.n : 0)
    expect(mean(TERRAIN_SNOW)).toBeGreaterThan(mean(TERRAIN_ROCK))
    expect(mean(TERRAIN_ROCK)).toBeGreaterThan(mean(TERRAIN_SCREE))
    expect(mean(TERRAIN_SCREE)).toBeGreaterThan(mean(TERRAIN_FOREST))
    expect(mean(TERRAIN_FOREST)).toBeGreaterThan(mean(TERRAIN_GRASS))
  })

  it('variété : au moins 5 terrains distincts présents au-dessus d’un seuil de surface', () => {
    const map = generateAlpineTerrain(W, H, 5)
    const count: Record<number, number> = {}
    for (const t of map.terrain) count[t] = (count[t] ?? 0) + 1
    const present = [TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW, TERRAIN_MARSH]
      .filter((t) => (count[t] ?? 0) > W * H * 0.01)
    expect(present.length).toBeGreaterThanOrEqual(5)
  })

  it('scalabilité : proportions de bandes stables entre deux tailles (mêmes seuils)', () => {
    const small = generateAlpineTerrain(120, 180, 5)
    const big = generateAlpineTerrain(240, 360, 5)
    const frac = (m: typeof small, t: number): number => m.terrain.filter((x) => x === t).length / m.terrain.length
    // la part de neige varie peu avec la taille (même modèle, mêmes seuils)
    expect(Math.abs(frac(small, TERRAIN_SNOW) - frac(big, TERRAIN_SNOW))).toBeLessThan(0.08)
  })
})
```

- [ ] **Step 2: Lancer (RED)**

Run: `pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts -t "bandes"`
Expected: FAIL — `generateAlpineTerrain`/`paintAlpineBands` absents.

- [ ] **Step 3: Implémenter**

Ajouter à `alpinegen.ts`. Import en tête : `import { createEmptyMap, type WorldMap } from './map'`, `import { sealBorderRing } from './valleygen'`, et les terrains `import { TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_MARSH, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW } from './balance'`, plus `import { fbm2 } from './noise'`.

```typescript
/** Seuils de bande sur l'altitude — contenu de carte, réglés à la vignette. */
export const BANDS = {
  FLOOR: 0.30,   // < FLOOR : fond (prairie / marsh)
  FOREST: 0.55,  // < FOREST : pentes boisées
  SCREE: 0.72,   // < SCREE : éboulis
  SNOW: 0.85,    // ≥ SNOW : neige ; entre SCREE et SNOW : roche
  MARSH_MOIST: 0.62,   // fond très humide → marsh
  FOREST_MOIST: 0.38,  // pente assez humide → forêt (sinon prairie clairsemée)
}

function bandFor(elevation: number, moisture: number, tx: number, ty: number, seed: number): number {
  if (elevation < BANDS.FLOOR) {
    return moisture > BANDS.MARSH_MOIST ? TERRAIN_MARSH : TERRAIN_GRASS
  }
  if (elevation < BANDS.FOREST) {
    // Limite des arbres : plus on approche de FOREST, plus la forêt se clairsème
    // (mélange forêt/prairie via un bruit fin), et l'humidité conditionne la densité.
    const treeline = (BANDS.FOREST - elevation) / (BANDS.FOREST - BANDS.FLOOR) // 1 en bas, 0 en haut
    const dense = fbm2(tx, ty, 6, (seed ^ 0x515f) | 0)
    if (moisture > BANDS.FOREST_MOIST && dense < 0.35 + 0.5 * treeline) return TERRAIN_FOREST
    return TERRAIN_GRASS
  }
  if (elevation < BANDS.SCREE) return TERRAIN_SCREE
  if (elevation < BANDS.SNOW) return TERRAIN_ROCK
  return TERRAIN_SNOW
}

export function paintAlpineBands(map: WorldMap, moisture: number[], seed: number): void {
  const { width, height } = map
  const el = map.elevation!
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      map.terrain[i] = bandFor(el[i]!, moisture[i]!, tx, ty, seed)
    }
  }
}

export function generateAlpineTerrain(width: number, height: number, seed: number): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  map.elevation = computeElevation(width, height, seed)
  const moisture = computeMoisture(width, height, map.elevation, seed)
  paintAlpineBands(map, moisture, seed)
  sealBorderRing(map) // l'anneau externe reste bloquant quoi qu'ait fait le bruit
  return map
}
```

Note : `sealBorderRing` pose `TERRAIN_ROCK` sur l'anneau ; comme le bord est déjà en pics (neige/roche via l'enceinte), c'est cohérent — le test « enceinte scellée » vérifie juste le blocage.

- [ ] **Step 4: Lancer (GREEN)**

Run: `pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts`
Expected: tous verts. Si « variété » échoue (< 5 terrains), ajuster les seuils `BANDS`/`*_MOIST` pour que chaque bande ait de la surface (réglage contenu, documenté). Si « bandes ordonnées » échoue, c'est un bug de seuil (les bornes doivent être croissantes).

- [ ] **Step 5: Suite + pureté**

Run: `pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts && pnpm check && pnpm lint`
Expected: vert.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/alpinegen.ts packages/sim/src/alpinegen.test.ts
git commit -m "feat(sim): bandes de terrain Whittaker + generateAlpineTerrain

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Vignette PNG — l'outil de revue visuelle

**Files:**
- Create: `packages/sim/src/vignette.ts` (pur : carte → buffer RGB, downscalé, hillshade + couleurs de biome)
- Create: `packages/sim/scripts/vignette.mjs` (Node : écrit le PNG — hors `/sim`, `zlib`/`fs` autorisés)
- Test: `packages/sim/src/vignette.test.ts` (déterminisme du buffer)

**Interfaces:**
- Consumes: `generateAlpineTerrain`, `elevationAt`, `TERRAINS`.
- Produces: `renderVignette(map, maxDim = 512): { w: number; h: number; rgb: Uint8Array }` — image downscalée : couleur de biome par tuile **modulée par un hillshade** calculé sur le gradient d'`elevation`. Pur (l'écriture disque est dans le script Node).

- [ ] **Step 1: Écrire le test (RED)**

Créer `packages/sim/src/vignette.test.ts` :

```typescript
import { describe, expect, it } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { renderVignette } from './vignette'

describe('renderVignette', () => {
  it('produit un buffer RGB déterministe aux bonnes dimensions', () => {
    const map = generateAlpineTerrain(200, 300, 9)
    const a = renderVignette(map, 100)
    const b = renderVignette(map, 100)
    expect(a.w).toBeGreaterThan(0)
    expect(a.h).toBeGreaterThan(a.w) // 300 > 200 → plus haut que large
    expect(a.rgb.length).toBe(a.w * a.h * 3)
    expect(Array.from(a.rgb)).toEqual(Array.from(b.rgb))
    // pas un buffer uniforme (il se passe quelque chose)
    expect(a.rgb.some((v, i) => v !== a.rgb[0])).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer (RED)**

Run: `pnpm --filter @braises/sim exec vitest run src/vignette.test.ts`
Expected: FAIL — `renderVignette` absent.

- [ ] **Step 3: Implémenter `renderVignette` (pur)**

Créer `packages/sim/src/vignette.ts` :

```typescript
/**
 * Vignette de revue (outil de dev, headless) — transforme une carte alpine en
 * image RGB downscalée : couleur de biome modulée par un hillshade calculé sur
 * le gradient d'élévation. Pur (aucun accès disque ici — le script Node écrit le
 * PNG). Sert à juger l'ambiance « ça sent l'alpin » avant que le rendu jeu (SP2)
 * existe. Pas du code de gameplay : n'a pas besoin d'être bit-exact.
 */
import { TERRAINS } from './balance'
import { elevationAt, type WorldMap } from './map'

/** Couleur de base par nom de terrain (placeholder alpin — la vraie palette = SP3). */
const BIOME_RGB: Record<string, [number, number, number]> = {
  grass: [110, 150, 78],
  forest: [42, 82, 54],
  marsh: [86, 104, 74],
  scree: [150, 146, 138],
  rock: [110, 106, 102],
  snow: [238, 242, 248],
  shallow_water: [120, 170, 190],
  deep_water: [58, 110, 140],
  road: [178, 156, 120],
  void: [20, 20, 20],
}

export function renderVignette(map: WorldMap, maxDim = 512): { w: number; h: number; rgb: Uint8Array } {
  const step = Math.max(1, Math.ceil(Math.max(map.width, map.height) / maxDim))
  const w = Math.floor(map.width / step)
  const h = Math.floor(map.height / step)
  const rgb = new Uint8Array(w * h * 3)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const tx = px * step
      const ty = py * step
      const t = TERRAINS[map.terrain[ty * map.width + tx] ?? 0]
      const base = BIOME_RGB[t?.name ?? 'void'] ?? BIOME_RGB.void!
      // Hillshade : pente selon le gradient d'élévation, éclairée depuis le NO.
      const dzdx = elevationAt(map, tx + step, ty) - elevationAt(map, tx - step, ty)
      const dzdy = elevationAt(map, tx, ty + step) - elevationAt(map, tx, ty - step)
      // Normale (−dzdx, −dzdy, k)·soleil(1,1,1)/… → un scalaire ; k règle l'intensité.
      const shade = clampShade(0.75 + 6 * (-dzdx - dzdy))
      const o = (py * w + px) * 3
      rgb[o] = clampByte(base[0] * shade)
      rgb[o + 1] = clampByte(base[1] * shade)
      rgb[o + 2] = clampByte(base[2] * shade)
    }
  }
  return { w, h, rgb }
}

const clampShade = (s: number): number => (s < 0.35 ? 0.35 : s > 1.5 ? 1.5 : s)
const clampByte = (v: number): number => {
  const r = Math.round(v)
  return r < 0 ? 0 : r > 255 ? 255 : r
}
```

- [ ] **Step 4: Lancer (GREEN)**

Run: `pnpm --filter @braises/sim exec vitest run src/vignette.test.ts`
Expected: PASS.

- [ ] **Step 5: Le script Node d'écriture PNG**

Créer `packages/sim/scripts/vignette.mjs` (utilise `zlib` + un encodeur PNG minimal ; importe le module compilé via le runner du repo). Contenu :

```javascript
// Écrit des vignettes PNG de la carte alpine. Lancé via vitest-as-runner ou tsx.
// Usage (depuis packages/sim) : node --import tsx scripts/vignette.mjs [seed] [W] [H]
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { generateAlpineTerrain } from '../src/alpinegen.ts'
import { renderVignette } from '../src/vignette.ts'

const [seed = '7', W = '480', H = '720'] = process.argv.slice(2)
const map = generateAlpineTerrain(Number(W), Number(H), Number(seed))
const { w, h, rgb } = renderVignette(map, 640)

// Encodeur PNG minimal (RGB, 8-bit, non entrelacé).
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
const raw = Buffer.alloc(h * (1 + w * 3))
for (let y = 0; y < h; y++) {
  raw[y * (1 + w * 3)] = 0 // filtre None
  for (let x = 0; x < w * 3; x++) raw[y * (1 + w * 3) + 1 + x] = rgb[y * w * 3 + x]
}
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
const out = `/tmp/alpine-seed${seed}-${W}x${H}.png`
writeFileSync(out, png)
console.log('wrote', out, `${w}x${h}`)
```

Vérifier qu'il tourne : `cd packages/sim && node --import tsx scripts/vignette.mjs 7 480 720` (si `tsx` indisponible en `--import`, l'implémenteur adapte le runner : compiler le module ou passer par un test qui écrit le PNG). Le but : **produire un PNG lisible** que le contrôleur ouvrira pour juger.

- [ ] **Step 6: Générer une vignette et la regarder**

Produire au moins une vignette (ex. seed 7, 480×720) dans `/tmp` ou le scratchpad. Le **contrôleur l'ouvre** (Read) pour juger l'ambiance alpine : bandes lisibles (fond vert → forêt → éboulis → roche → neige au bord), relief ombré donnant du volume aux crêtes. C'est le critère « on y est / pas encore ».

- [ ] **Step 7: Suite + pureté + commit**

Run: `pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts && pnpm check && pnpm lint`
Expected: vert (`vignette.ts` est pur ; le `.mjs` est hors périmètre lint sim — le placer sous `scripts/`).

```bash
git add packages/sim/src/vignette.ts packages/sim/src/vignette.test.ts packages/sim/scripts/vignette.mjs
git commit -m "feat(sim): vignette PNG (hillshade + biomes) — revue visuelle du substrat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes d'exécution

- **Ordre** : 1 → 2 → 3 → 4 → 5 → 6 → 7. Chaque tâche laisse la suite (hors scénario) verte.
- **Le juge de SP1a = la vignette (Task 7)**. Après le plan, le contrôleur génère des vignettes à plusieurs seeds/tailles, les montre à Alexis, et on **règle les constantes** (`ALPINE`, `BANDS`) à l'œil pour atteindre la barre alpine avant d'ouvrir SP1b (hydrologie/features/chemins/villages).
- **Pas d'eau en SP1a** : la vignette montre le relief sec. Les rivières/lacs/tarns turquoise viennent avec l'hydrologie (SP1b) — ne pas les bricoler ici.
- **`elevation` ≠ `height`** : ne jamais réutiliser `height` pour l'altitude (c'est la dimension). Toute confusion casse `terrainAt`/collision.
- **Pureté** : `alpinegen.ts` et `vignette.ts` sont dans `/sim` → aucune trigo/`pow`. Le script `.mjs` est un outil dev (Node OK) sous `scripts/`, à exclure du périmètre de jeu.
