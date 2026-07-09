# Relief en terrasses — tranche 1 « je vois le dénivelé » — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire *voir* le dénivelé de la vallée alpine — ombrage du sol par la pente, et falaises dessinées comme des parois verticales — sans rien bloquer.

**Architecture:** `/sim` dérive `WorldMap.level` (un entier par tuile) de `elevation` par lissage + quantification, dans une passe pure et déterministe placée **après** l'hydrologie. Le client lit `level` pour dessiner : (a) un hillshade cuit dans la texture du sol, constant par tuile donc compatible avec le bake 1 px/tuile étiré ×16 en NEAREST ; (b) des parois, sprites d'une tuile de large ancrés par les pieds et triés dans la bande Y unique — une paroi se rend exactement comme un arbre.

**Tech Stack:** TypeScript, Vitest, Phaser 4, pnpm workspace.

**Spec :** `docs/superpowers/specs/2026-07-09-relief-terrasses-design.md`

## Global Constraints

- **`/sim` est pur** : zéro import Phaser / Colyseus / Node. Le lint ESLint le garde.
- **`/sim` est déterministe au bit près** : pas de `Math.random`, pas de `Date`. **Aucune fonction Math approximée** (`sin`, `cos`, `pow`, `hypot`, `exp`, `log`, `**`). Autorisés : `+ - * /`, `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`. La passe de terrassement n'utilise que `+`, `/`, `*`, `Math.floor`, `Math.min`, `Math.max`.
- **État de sim JSON-sérialisable** : `level` est un `number[]`, jamais un `Map`/`Set`/`Int32Array`.
- **Nombres d'équilibrage dans `balance.ts`** (côté `/sim`). Les grandeurs en **pixels** sont du rendu : elles vivent côté client, jamais dans `balance.ts` qui ne connaît que la tuile.
- **Code et docs en français, identifiants en anglais.**
- **Rien ne bloque dans cette tranche** : aucune modification de `collision.ts`, `pathfinding.ts`, ni de `isBlockingTile`.
- Avant chaque commit : `pnpm check`, `pnpm test`, `pnpm lint` doivent passer.

**Constantes de calibrage (valeurs de départ, à tourner à l'œil en tâche 8) :**

| Constante | Valeur | Où |
|---|---|---|
| `TERRACE.LEVELS` | `8` | `sim/balance.ts` |
| `TERRACE.SMOOTH_RADIUS` | `6` | `sim/balance.ts` |
| `TERRACE.SMOOTH_PASSES` | `2` | `sim/balance.ts` |
| `STEP_PX` | `10` | `client/render/cliffs.ts` |
| `MAX_DROP` | `6` | `client/render/cliffs.ts` |
| `HILLSHADE_STRENGTH` | `4` | `client/render/hillshade.ts` |

---

## Structure des fichiers

**`packages/sim/src/`**

| Fichier | Responsabilité |
|---|---|
| `terrace.ts` *(nouveau)* | `smoothField` (moyenne locale séparable) et `computeLevel` (quantification). Pur, déterministe. Ne connaît que des tableaux. |
| `terrace.test.ts` *(nouveau)* | Déterminisme, bornes, monotonie, non-mutation de l'entrée. |
| `map.ts` | Champ `level?: number[]`, accesseur `levelAt`. |
| `map.test.ts` | Test de `levelAt`. |
| `balance.ts` | Objet `TERRACE`. |
| `alpinegen.ts` | Câblage : `map.level = computeLevel(...)` après l'hydro. |
| `alpinegen.test.ts` | `level` produit, borné, déterministe. |
| `index.ts` | Exports. |

**`packages/client/src/`**

| Fichier | Responsabilité |
|---|---|
| `render/hillshade.ts` *(nouveau)* | `hillshadeAt` (pente → facteur lumineux) et `stepShadeAt` (pied d'une marche E/O/N). Pur, aucun Phaser. |
| `render/hillshade.test.ts` *(nouveau)* | |
| `render/cliffs.ts` *(nouveau)* | `cliffAt` (cette tuile porte-t-elle une face ?), `faceHeightPx`, `cliffPlacement`. Pur, aucun Phaser. |
| `render/cliffs.test.ts` *(nouveau)* | |
| `render/framing.ts` | `TIE_CLIFF`, décalage de `TIE_CORPSE`. |
| `scenes/world/cliff-layer.ts` *(nouveau)* | Pool + culling caméra. Calqué sur `clutter-layer.ts`. Seul fichier Phaser du lot. |
| `scenes/WorldScene.ts` | Hillshade dans `bakeMapTexture`, `bakeCliffTextures`, instanciation et update du `CliffLayer`. |

---

## Task 1: La passe de terrassement (`/sim`)

**Files:**
- Create: `packages/sim/src/terrace.ts`
- Create: `packages/sim/src/terrace.test.ts`
- Modify: `packages/sim/src/balance.ts` (ajout de l'objet `TERRACE`)

**Interfaces:**
- Consumes: rien.
- Produces:
  - `TERRACE: { LEVELS: number; SMOOTH_RADIUS: number; SMOOTH_PASSES: number }` (depuis `balance.ts`)
  - `smoothField(src: number[], width: number, height: number, r: number, passes: number): number[]`
  - `computeLevel(elevation: number[], width: number, height: number): number[]`

- [ ] **Step 1: Ajouter l'objet `TERRACE` dans `balance.ts`**

À la fin de `packages/sim/src/balance.ts`, après l'objet `BALANCE` :

```ts
/**
 * Terrassement du relief (spec 2026-07-09-relief-terrasses).
 * Calibré à l'œil sur captures en jeu, jamais sur une théorie.
 */
export const TERRACE = {
  /** Nombre de paliers sur l'amplitude d'altitude [0,1]. */
  LEVELS: 8,
  /** Rayon (en tuiles) de la moyenne locale. Décide de tout : quantifier le
   *  champ brut, qui porte crêtes et bruit de détail, donnerait des
   *  micro-terrasses déchiquetées sur chaque bosse. */
  SMOOTH_RADIUS: 6,
  /** Nombre de passes de lissage (deux passes ≈ une gaussienne). */
  SMOOTH_PASSES: 2,
} as const
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `packages/sim/src/terrace.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { TERRACE } from './balance'
import { computeLevel, smoothField } from './terrace'

/** Champ d'altitude en rampe : croît strictement d'ouest en est, de 0 à 1. */
function rampField(w: number, h: number): number[] {
  const f = new Array<number>(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = x / (w - 1)
  return f
}

describe('smoothField', () => {
  it('laisse un champ constant inchangé (aux erreurs d’arrondi près)', () => {
    const w = 16, h = 16
    const flat = new Array<number>(w * h).fill(0.42)
    const out = smoothField(flat, w, h, 3, 2)
    for (const v of out) expect(v).toBeCloseTo(0.42, 10)
  })

  it('ne mute pas son entrée et conserve la longueur', () => {
    const w = 8, h = 8
    const src = rampField(w, h)
    const copy = src.slice()
    const out = smoothField(src, w, h, 2, 1)
    expect(src).toEqual(copy)
    expect(out).toHaveLength(w * h)
  })

  it('atténue un pic isolé', () => {
    const w = 9, h = 9
    const src = new Array<number>(w * h).fill(0)
    src[4 * w + 4] = 1
    const out = smoothField(src, w, h, 2, 1)
    expect(out[4 * w + 4]!).toBeLessThan(0.2)
    expect(out[4 * w + 3]!).toBeGreaterThan(0)
  })
})

describe('computeLevel', () => {
  it('est déterministe : même entrée → même sortie', () => {
    const w = 24, h = 24
    const src = rampField(w, h)
    expect(computeLevel(src, w, h)).toEqual(computeLevel(src, w, h))
  })

  it('borne les paliers dans [0, LEVELS-1]', () => {
    const w = 24, h = 24
    // hors bornes volontaires : le clamp doit tenir
    const src = rampField(w, h).map((v) => v * 1.5 - 0.2)
    for (const l of computeLevel(src, w, h)) {
      expect(l).toBeGreaterThanOrEqual(0)
      expect(l).toBeLessThanOrEqual(TERRACE.LEVELS - 1)
      expect(Number.isInteger(l)).toBe(true)
    }
  })

  it('est monotone : sur une rampe, le palier ne redescend jamais vers l’est', () => {
    const w = 64, h = 8
    const level = computeLevel(rampField(w, h), w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        expect(level[y * w + x]!).toBeGreaterThanOrEqual(level[y * w + x - 1]!)
      }
    }
  })

  it('produit plus d’un palier sur une rampe pleine amplitude', () => {
    const w = 64, h = 4
    const level = computeLevel(rampField(w, h), w, h)
    expect(new Set(level).size).toBeGreaterThan(2)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm --filter @braises/sim exec vitest run src/terrace.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "./terrace"`.

- [ ] **Step 4: Écrire l'implémentation minimale**

Créer `packages/sim/src/terrace.ts` :

```ts
/**
 * Terrassement — quantifie l'altitude CONTINUE en PALIERS discrets
 * (spec docs/superpowers/specs/2026-07-09-relief-terrasses-design.md).
 *
 * `elevation` reste le grain continu (ombrage, futur coût de pente) ; `level`
 * est l'entier qui portera murs et plateaux (tranches 2+). Il se DÉRIVE, il ne
 * s'invente pas.
 *
 * Pur et déterministe : uniquement `+`, `*`, `/`, `Math.floor` — aucune
 * transcendante (invariant /sim §2). Le lissage n'est pas cosmétique : sans lui,
 * quantifier un champ qui porte crêtes et bruit de détail donne des
 * micro-terrasses déchiquetées sur chaque bosse.
 */
import { TERRACE } from './balance'

const clampIndex = (i: number, n: number): number => (i < 0 ? 0 : i >= n ? n - 1 : i)

/**
 * Moyenne locale SÉPARABLE (box blur), rayon `r`, bords clampés sur la bordure.
 * Retourne un NOUVEAU tableau ; `src` n'est jamais muté.
 *
 * Coût O(width × height × r × passes) — la vallée canonique (1200×1800, r=6,
 * 2 passes) tient dans quelques centaines de ms, une fois, à la génération.
 */
export function smoothField(
  src: number[],
  width: number,
  height: number,
  r: number,
  passes: number,
): number[] {
  const cur = src.slice()
  const tmp = new Array<number>(width * height).fill(0)
  const taps = 2 * r + 1
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let d = -r; d <= r; d++) sum += cur[row + clampIndex(x + d, width)]!
        tmp[row + x] = sum / taps
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let d = -r; d <= r; d++) sum += tmp[clampIndex(y + d, height) * width + x]!
        cur[y * width + x] = sum / taps
      }
    }
  }
  return cur
}

/** Altitude continue [0,1] → palier entier [0, TERRACE.LEVELS-1]. */
export function computeLevel(elevation: number[], width: number, height: number): number[] {
  const smooth = smoothField(elevation, width, height, TERRACE.SMOOTH_RADIUS, TERRACE.SMOOTH_PASSES)
  const n = width * height
  const top = TERRACE.LEVELS - 1
  const level = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const q = Math.floor(smooth[i]! * TERRACE.LEVELS)
    level[i] = q < 0 ? 0 : q > top ? top : q
  }
  return level
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

```bash
pnpm --filter @braises/sim exec vitest run src/terrace.test.ts
```

Attendu : PASS, 7 tests.

- [ ] **Step 6: Vérifier les garde-fous globaux**

```bash
pnpm check && pnpm test && pnpm lint
```

Attendu : tout vert. En particulier, le lint de pureté de `/sim` ne doit rien signaler sur `terrace.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/terrace.ts packages/sim/src/terrace.test.ts packages/sim/src/balance.ts
git commit -m "feat(sim): passe de terrassement — lissage + quantification de l'élévation en paliers"
```

---

## Task 2: `WorldMap.level` et `levelAt` (`/sim`)

**Files:**
- Modify: `packages/sim/src/map.ts:28` (après le champ `elevation`), et après `elevationAt`
- Modify: `packages/sim/src/map.test.ts`
- Modify: `packages/sim/src/index.ts:66-67`

**Interfaces:**
- Consumes: rien (le champ est indépendant de la tâche 1).
- Produces:
  - `WorldMap.level?: number[]`
  - `levelAt(map: WorldMap, tx: number, ty: number): number` — hors carte ou absent → `0`
  - exports depuis `@braises/sim` : `elevationAt`, `levelAt`, `computeLevel`, `smoothField`, `TERRACE`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/map.test.ts`, après le bloc `describe('WorldMap.elevation', …)` :

```ts
describe('WorldMap.level', () => {
  it('levelAt lit le champ, 0 hors carte ou si absent', () => {
    const map: WorldMap = createEmptyMap(4, 4, 1)
    expect(levelAt(map, 1, 1)).toBe(0) // absent → 0
    map.level = new Array(16).fill(0)
    map.level[1 * 4 + 2] = 3
    expect(levelAt(map, 2, 1)).toBe(3)
    expect(levelAt(map, -1, 0)).toBe(0) // hors carte
    expect(levelAt(map, 4, 0)).toBe(0) // hors carte
  })
})
```

Et compléter l'import en tête du fichier :

```ts
import { createEmptyMap, elevationAt, levelAt, type WorldMap } from './map'
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm --filter @braises/sim exec vitest run src/map.test.ts
```

Attendu : ÉCHEC — `levelAt` n'est pas exporté par `./map`.

- [ ] **Step 3: Ajouter le champ et l'accesseur**

Dans `packages/sim/src/map.ts`, dans l'interface `WorldMap`, juste après `elevation?: number[]` :

```ts
  /** Palier de terrasse par tuile (ENTIER), row-major. Dérivé de `elevation`
   *  par `computeLevel` (terrace.ts). Optionnel — absent des cartes sans
   *  élévation (generateValley). Ne bloque rien : tranche 1 est visuelle. */
  level?: number[]
```

Et juste après la fonction `elevationAt` :

```ts
/** Palier de terrasse à une tuile. Hors carte ou absent = 0. */
export function levelAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.level?.[ty * map.width + tx] ?? 0
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
pnpm --filter @braises/sim exec vitest run src/map.test.ts
```

Attendu : PASS.

- [ ] **Step 5: Exporter depuis l'index**

Dans `packages/sim/src/index.ts`, remplacer la ligne 66 :

```ts
export { createEmptyMap, terrainAt, isBlockingTile, zoneAt } from './map'
```

par :

```ts
export { createEmptyMap, terrainAt, elevationAt, levelAt, isBlockingTile, zoneAt } from './map'
```

Puis ajouter, à côté de la ligne `export { generateAlpineTerrain } from './alpinegen'` :

```ts
export { computeLevel, smoothField } from './terrace'
```

Et ajouter `TERRACE` à la liste des exports de `balance.ts` déjà présente dans `index.ts` (rechercher `from './balance'` et compléter la liste existante ; ne pas créer une seconde ligne d'export pour le même module).

- [ ] **Step 6: Vérifier**

```bash
pnpm check && pnpm test && pnpm lint
```

Attendu : tout vert.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/map.ts packages/sim/src/map.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): WorldMap.level + levelAt, jumeaux de elevation/elevationAt"
```

---

## Task 3: Câbler le terrassement dans la génération alpine (`/sim`)

**Files:**
- Modify: `packages/sim/src/alpinegen.ts:329-342` (fonction `generateAlpineTerrain`)
- Modify: `packages/sim/src/alpinegen.test.ts`

**Interfaces:**
- Consumes: `computeLevel` (tâche 1), `WorldMap.level` (tâche 2).
- Produces: `generateAlpineTerrain(w, h, seed).level` — `number[]` de longueur `w*h`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/alpinegen.test.ts` :

```ts
describe('generateAlpineTerrain — paliers', () => {
  it('produit un level dérivé, borné et de la bonne longueur', () => {
    const map = generateAlpineTerrain(64, 64, 7)
    expect(map.level).toBeDefined()
    expect(map.level).toHaveLength(64 * 64)
    for (const l of map.level!) {
      expect(Number.isInteger(l)).toBe(true)
      expect(l).toBeGreaterThanOrEqual(0)
      expect(l).toBeLessThanOrEqual(TERRACE.LEVELS - 1)
    }
  })

  it('le fond de vallée est d’un palier plus BAS que le mur de bordure', () => {
    const map = generateAlpineTerrain(96, 96, 11)
    const centre = levelAt(map, 48, 48)
    const bord = levelAt(map, 2, 48)
    expect(centre).toBeLessThan(bord)
  })

  it('est déterministe : même seed → même level', () => {
    expect(generateAlpineTerrain(48, 48, 3).level).toEqual(generateAlpineTerrain(48, 48, 3).level)
  })
})
```

Compléter les imports en tête du fichier de test : `TERRACE` depuis `./balance`, `levelAt` depuis `./map`.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts
```

Attendu : ÉCHEC — `expected undefined to be defined` (`map.level`).

- [ ] **Step 3: Câbler la passe**

Dans `packages/sim/src/alpinegen.ts`, ajouter l'import en tête :

```ts
import { computeLevel } from './terrace'
```

Puis, dans `generateAlpineTerrain`, insérer entre `sealBorderRing(map)` et `placePois(map, seed)` :

```ts
  // Terrassement APRÈS l'hydro : une rivière qui franchit une frontière de
  // palier devient une CASCADE. Terrasser avant ferait couler l'eau sur des
  // marches et rendrait l'hydrologie folle. (spec 2026-07-09-relief-terrasses §4.1)
  map.level = computeLevel(map.elevation, width, height)
```

Le corps final de la fonction doit être :

```ts
export function generateAlpineTerrain(width: number, height: number, seed: number): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  map.elevation = computeElevation(width, height, seed)
  const moisture = computeMoisture(width, height, map.elevation, seed)
  paintAlpineBands(map, moisture, seed)
  const flow = computeFlowField(width, height, seed)
  carveHydrology(map, flow, seed) // lac, rivière (thalweg), ruisseaux, tarns — l'eau suit l'écoulement
  paintScatterBiomes(map, seed) // bosquets, prés fleuris, blocs, vieille forêt, brûlis (après l'eau)
  paintAvalanches(map, seed) // couloirs d'avalanche (blocs qui dévalent)
  sealBorderRing(map) // l'anneau externe reste bloquant quoi qu'ait creusé l'eau
  // Terrassement APRÈS l'hydro : une rivière qui franchit une frontière de
  // palier devient une CASCADE. Terrasser avant ferait couler l'eau sur des
  // marches et rendrait l'hydrologie folle. (spec 2026-07-09-relief-terrasses §4.1)
  map.level = computeLevel(map.elevation, width, height)
  placePois(map, seed) // POIs APRÈS le scellage : le biome sous le centre d'un POI est le terrain FINAL
  //                      (sinon un POI validé sur du bord verrait son terrain réécrit en roche par le scellage → incohérence)
  return map
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
pnpm --filter @braises/sim exec vitest run src/alpinegen.test.ts
```

Attendu : PASS.

- [ ] **Step 5: Vérifier que rien d'autre n'a bougé**

```bash
pnpm check && pnpm test && pnpm lint
```

Attendu : tout vert, **y compris le banc de scénario** (`pnpm test` de `/sim` lance `test:scenario`). Il passe par `generateValley`, qui ne produit pas d'élévation : `level` y est absent, aucun échantillon affamé de plus.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/alpinegen.ts packages/sim/src/alpinegen.test.ts
git commit -m "feat(sim): generateAlpineTerrain dérive map.level après l'hydro (cascades)"
```

---

## Task 4: Ombrage du sol — fonctions pures (client)

**Files:**
- Create: `packages/client/src/render/hillshade.ts`
- Create: `packages/client/src/render/hillshade.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type SampleElevation = (tx: number, ty: number) => number` (échantillonneur **clampé** aux bords)
  - `type SampleLevel = (tx: number, ty: number) => number` (hors carte → `-1`)
  - `hillshadeAt(tx: number, ty: number, sample: SampleElevation): number` → facteur dans `[0.55, 1.45]`
  - `stepShadeAt(tx: number, ty: number, sample: SampleLevel): number` → `1` ou `0.85`
  - constantes `HILLSHADE_STEP`, `HILLSHADE_STRENGTH`, `HILLSHADE_MIN`, `HILLSHADE_MAX`, `STEP_SHADE`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/client/src/render/hillshade.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { hillshadeAt, HILLSHADE_MAX, HILLSHADE_MIN, stepShadeAt, STEP_SHADE } from './hillshade'

/** Échantillonneur d'altitude sur une pente : altitude = a*tx + b*ty. */
const slope = (a: number, b: number) => (tx: number, ty: number) => a * tx + b * ty

describe('hillshadeAt', () => {
  it('un terrain plat ne change pas la couleur', () => {
    expect(hillshadeAt(5, 5, () => 0.5)).toBeCloseTo(1, 10)
  })

  it('une pente qui monte vers l’est/le sud s’assombrit (soleil au nord-ouest)', () => {
    expect(hillshadeAt(5, 5, slope(0.01, 0.01))).toBeLessThan(1)
  })

  it('une pente qui monte vers l’ouest/le nord s’éclaircit', () => {
    expect(hillshadeAt(5, 5, slope(-0.01, -0.01))).toBeGreaterThan(1)
  })

  it('reste borné même sur une falaise verticale', () => {
    expect(hillshadeAt(5, 5, slope(10, 10))).toBe(HILLSHADE_MIN)
    expect(hillshadeAt(5, 5, slope(-10, -10))).toBe(HILLSHADE_MAX)
  })
})

describe('stepShadeAt', () => {
  /** Palier 1 partout, sauf une bande haute (palier 2) à l'ouest de x=5. */
  const lvl = (tx: number, ty: number): number => {
    if (tx < 0 || ty < 0 || tx > 9 || ty > 9) return -1
    return tx < 5 ? 2 : 1
  }

  it('assombrit la tuile basse au pied d’une marche à l’ouest', () => {
    expect(stepShadeAt(5, 5, lvl)).toBe(STEP_SHADE)
  })

  it('n’assombrit pas la tuile haute', () => {
    expect(stepShadeAt(4, 5, lvl)).toBe(1)
  })

  it('n’assombrit pas en terrain de palier constant', () => {
    expect(stepShadeAt(8, 5, lvl)).toBe(1)
  })

  it('vaut 1 quand la carte n’a pas de paliers (échantillon -1)', () => {
    expect(stepShadeAt(3, 3, () => -1)).toBe(1)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm --filter @braises/client exec vitest run src/render/hillshade.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "./hillshade"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/client/src/render/hillshade.ts` :

```ts
/**
 * Ombrage du sol par le RELIEF — math PURE, aucun import Phaser.
 *
 * Le bake du sol module aujourd'hui la couleur du biome par un bruit par tuile.
 * Il gagne ici deux facteurs : la PENTE (hillshade, soleil au nord-ouest) et le
 * PIED D'UNE MARCHE (les décrochements est/ouest/nord, dont la face ne regarde
 * pas la caméra et n'est donc pas dessinée en paroi).
 *
 * CONTRAINTE DURE : le facteur est CONSTANT PAR TUILE. C'est ce qui autorise le
 * bake à 1 px/tuile étiré ×16 en NEAREST (WorldScene.bakeMapTexture).
 *
 * Port du hillshade de sim/vignette.ts, l'outil de revue headless — c'est le
 * même calcul, il n'avait simplement jamais atteint le rendu jeu.
 */

/** Altitude [0,1] à une tuile. DOIT clamper aux bords (jamais NaN, jamais -1). */
export type SampleElevation = (tx: number, ty: number) => number
/** Palier entier à une tuile. Hors carte ou carte sans paliers → -1. */
export type SampleLevel = (tx: number, ty: number) => number

/** Écart d'échantillonnage du gradient, en tuiles. Large = lit la pente MACRO du
 *  versant plutôt que chaque bosse — un lissage du pauvre, gratuit. */
export const HILLSHADE_STEP = 3
export const HILLSHADE_STRENGTH = 4
export const HILLSHADE_MIN = 0.55
export const HILLSHADE_MAX = 1.45
/** Assombrissement de la tuile basse au pied d'une marche est/ouest/nord. */
export const STEP_SHADE = 0.85

/** Facteur lumineux dû à la pente, soleil au nord-ouest. Plat → 1. */
export function hillshadeAt(tx: number, ty: number, sample: SampleElevation): number {
  const dzdx = sample(tx + HILLSHADE_STEP, ty) - sample(tx - HILLSHADE_STEP, ty)
  const dzdy = sample(tx, ty + HILLSHADE_STEP) - sample(tx, ty - HILLSHADE_STEP)
  const s = 1 + HILLSHADE_STRENGTH * (-dzdx - dzdy)
  return s < HILLSHADE_MIN ? HILLSHADE_MIN : s > HILLSHADE_MAX ? HILLSHADE_MAX : s
}

/**
 * Facteur lumineux dû au pied d'une marche. Une tuile dont un voisin nord, est
 * ou ouest est d'un palier PLUS HAUT est à l'ombre de ce décrochement.
 * Les faces SUD ne sont pas concernées : elles sont couvertes par un sprite de
 * paroi (render/cliffs.ts), pas par la texture du sol.
 */
export function stepShadeAt(tx: number, ty: number, sample: SampleLevel): number {
  const here = sample(tx, ty)
  if (here < 0) return 1
  const north = sample(tx, ty - 1)
  const east = sample(tx + 1, ty)
  const west = sample(tx - 1, ty)
  return north > here || east > here || west > here ? STEP_SHADE : 1
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
pnpm --filter @braises/client exec vitest run src/render/hillshade.test.ts
```

Attendu : PASS, 8 tests.

- [ ] **Step 5: Vérifier et committer**

```bash
pnpm check && pnpm test && pnpm lint
git add packages/client/src/render/hillshade.ts packages/client/src/render/hillshade.test.ts
git commit -m "feat(client): hillshade et ombre de marche — fonctions pures"
```

---

## Task 5: Cuire le relief dans la texture du sol (client)

**Files:**
- Modify: `packages/client/src/scenes/WorldScene.ts:481-493` (`bakeMapTexture`)

**Interfaces:**
- Consumes: `hillshadeAt`, `stepShadeAt`, `SampleElevation`, `SampleLevel` (tâche 4) ; `map.elevation`, `map.level` (tâches 2-3).
- Produces: rien de nouveau (effet visuel).

Pas de test unitaire : c'est du câblage Phaser, les fonctions pures sont déjà couvertes. La vérification est visuelle (tâche 8). Les fonctions dégradent proprement sur une carte sans élévation (`generateValley`) : `sampleElev` renvoie `0` partout → gradient nul → facteur `1` ; `sampleLevel` renvoie `-1` → facteur `1`.

- [ ] **Step 1: Ajouter l'import**

Dans `packages/client/src/scenes/WorldScene.ts`, après l'import de `../render/lighting` :

```ts
import { hillshadeAt, stepShadeAt, type SampleElevation, type SampleLevel } from '../render/hillshade'
```

- [ ] **Step 2: Remplacer `bakeMapTexture`**

Remplacer intégralement la méthode (lignes 481-493) par :

```ts
  /** Bake la carte statique en une texture (R8) — API generateTexture éprouvée dans Manif.
   *  La couleur d'une tuile = biome × grain (bruit par tuile) × relief (pente + marches).
   *  Le facteur reste CONSTANT PAR TUILE : c'est ce qui autorise le bake à 1 px/tuile. */
  private bakeMapTexture(): void {
    const { width, height } = this.map
    // Échantillonneur d'altitude CLAMPÉ aux bords : le gradient au bord ne doit
    // jamais lire hors carte (ça créerait un liseré sombre sur l'anneau).
    const sampleElev: SampleElevation = (tx, ty) => {
      const cx = tx < 0 ? 0 : tx >= width ? width - 1 : tx
      const cy = ty < 0 ? 0 : ty >= height ? height - 1 : ty
      return this.map.elevation?.[cy * width + cx] ?? 0
    }
    const sampleLevel: SampleLevel = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return -1
      return this.map.level?.[ty * width + tx] ?? -1
    }
    const g = this.add.graphics()
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const base = TERRAIN_COLORS[this.map.terrain[ty * width + tx] ?? 0] ?? 0xff00ff
        const grain = 0.92 + 0.16 * hash2(tx, ty)
        const relief = hillshadeAt(tx, ty, sampleElev) * stepShadeAt(tx, ty, sampleLevel)
        g.fillStyle(shade(base, grain * relief))
        g.fillRect(tx, ty, 1, 1) // 1 px/tuile — étiré à la taille monde par setDisplaySize
      }
    }
    g.generateTexture('map-demo', width, height)
    g.destroy()
  }
```

- [ ] **Step 3: Vérifier que ça compile et que rien ne casse**

```bash
pnpm check && pnpm test && pnpm lint && pnpm build
```

Attendu : tout vert, `packages/client/dist` produit.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): le sol s'ombre par la pente et les marches"
```

---

## Task 6: Où va une paroi — fonctions pures (client)

**Files:**
- Modify: `packages/client/src/render/framing.ts:39-43` (constantes de départage)
- Create: `packages/client/src/render/cliffs.ts`
- Create: `packages/client/src/render/cliffs.test.ts`

**Interfaces:**
- Consumes: `ySortDepth`, `TILE_PX` (`framing.ts`) ; `SampleLevel` (tâche 4).
- Produces:
  - `TIE_CLIFF = 0` (et `TIE_CORPSE` déplacé à `0.1`)
  - `STEP_PX = 10`, `MAX_DROP = 6`
  - `interface CliffFace { tx: number; ty: number; drop: number }`
  - `cliffAt(tx, ty, sample: SampleLevel): CliffFace | null`
  - `faceHeightPx(drop: number): number`
  - `interface CliffPlacement { px, py, displayW, displayH, depth, drop }`
  - `cliffPlacement(face: CliffFace, tilePx: number): CliffPlacement`

**Géométrie retenue.** La face est portée par la tuile **haute** `(tx, ty)` dont le voisin **sud** est plus bas. Elle **pend depuis l'arête** : son bord haut est à la frontière `(ty+1)`, son bord bas à `(ty+1)*tilePx + hauteur`. Avec une origine pieds `(0.5, 1)`, ses « pieds » sont donc son bord bas.

Conséquence, voulue et conforme à la spec §5.3 : un acteur **au pied** de la falaise (plus au sud) a un `feetY` plus grand → il se dessine **devant**. Un acteur qui **entre dans la bande** de la paroi (tranche 1 : rien ne bloque) a un `feetY` plus petit → il se dessine **derrière**, donc caché. C'est exactement la bande de tuiles qui deviendra solide en tranche 2.

- [ ] **Step 1: Ajouter `TIE_CLIFF` dans `framing.ts`**

Remplacer les lignes 37-43 de `packages/client/src/render/framing.ts` :

```ts
/** Départage à pixel de pieds ÉGAL. Dans [0,1) : jamais assez pour renverser un
 * écart de profondeur réel, puisqu'une unité de depth vaut un pixel monde. */
export const TIE_CORPSE = 0
export const TIE_CLUTTER = 0.2
export const TIE_NODE = 0.4
export const TIE_STRUCTURE = 0.6
export const TIE_ACTOR = 0.8
```

par :

```ts
/** Départage à pixel de pieds ÉGAL. Dans [0,1) : jamais assez pour renverser un
 * écart de profondeur réel, puisqu'une unité de depth vaut un pixel monde.
 * Une PAROI de falaise est tout en bas : à pieds égaux, tout la recouvre. */
export const TIE_CLIFF = 0
export const TIE_CORPSE = 0.1
export const TIE_CLUTTER = 0.2
export const TIE_NODE = 0.4
export const TIE_STRUCTURE = 0.6
export const TIE_ACTOR = 0.8
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `packages/client/src/render/cliffs.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { cliffAt, cliffPlacement, faceHeightPx, MAX_DROP, STEP_PX } from './cliffs'
import { corpseDepth, TILE_PX, ySortDepth, TIE_ACTOR } from './framing'
import type { SampleLevel } from './hillshade'

/** Plateau (palier 3) au nord de ty=4 ; sol bas (palier 1) au sud. Carte 10×10. */
const lvl: SampleLevel = (tx, ty) => {
  if (tx < 0 || ty < 0 || tx > 9 || ty > 9) return -1
  return ty <= 4 ? 3 : 1
}

describe('cliffAt', () => {
  it('la tuile HAUTE dont le voisin sud est plus bas porte une face', () => {
    expect(cliffAt(5, 4, lvl)).toEqual({ tx: 5, ty: 4, drop: 2 })
  })

  it('pas de face en terrain de palier constant', () => {
    expect(cliffAt(5, 2, lvl)).toBeNull()
    expect(cliffAt(5, 7, lvl)).toBeNull()
  })

  it('pas de face sur une MONTÉE vers le sud', () => {
    const monte: SampleLevel = (_tx, ty) => (ty <= 4 ? 1 : 3)
    expect(cliffAt(5, 4, monte)).toBeNull()
  })

  it('pas de face au bord de carte (voisin sud hors carte)', () => {
    expect(cliffAt(5, 9, lvl)).toBeNull()
  })

  it('pas de face sur une carte sans paliers', () => {
    expect(cliffAt(5, 4, () => -1)).toBeNull()
  })
})

describe('faceHeightPx', () => {
  it('une marche d’un palier fait STEP_PX de haut', () => {
    expect(faceHeightPx(1)).toBe(STEP_PX)
  })

  it('croît avec le décrochement', () => {
    expect(faceHeightPx(3)).toBe(3 * STEP_PX)
  })

  it('plafonne à MAX_DROP (l’art n’est cuit que jusque-là)', () => {
    expect(faceHeightPx(99)).toBe(MAX_DROP * STEP_PX)
  })
})

describe('cliffPlacement', () => {
  const face = { tx: 5, ty: 4, drop: 2 }

  it('pend depuis l’arête : bord haut à la frontière, pieds en dessous', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(p.px).toBe((5 + 0.5) * TILE_PX)
    expect(p.py).toBe((4 + 1) * TILE_PX + faceHeightPx(2))
    expect(p.displayW).toBe(TILE_PX)
    expect(p.displayH).toBe(faceHeightPx(2))
    expect(p.drop).toBe(2)
  })

  it('plafonne le drop rapporté (clé de texture)', () => {
    expect(cliffPlacement({ tx: 0, ty: 0, drop: 99 }, TILE_PX).drop).toBe(MAX_DROP)
  })

  it('un acteur AU PIED se dessine DEVANT la paroi', () => {
    const p = cliffPlacement(face, TILE_PX)
    const acteurAuPied = ySortDepth(7, TILE_PX, TIE_ACTOR) // pieds rangée 7, bien au sud
    expect(acteurAuPied).toBeGreaterThan(p.depth)
  })

  it('un acteur SUR LE PLATEAU se dessine DERRIÈRE la paroi', () => {
    const p = cliffPlacement(face, TILE_PX)
    const acteurSurPlateau = ySortDepth(5, TILE_PX, TIE_ACTOR) // pieds au bord de l'arête
    expect(acteurSurPlateau).toBeLessThan(p.depth)
  })

  it('à pieds égaux, un cadavre passe devant la paroi', () => {
    const p = cliffPlacement(face, TILE_PX)
    expect(corpseDepth(p.py / TILE_PX, TILE_PX)).toBeGreaterThan(p.depth)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm --filter @braises/client exec vitest run src/render/cliffs.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "./cliffs"`.

- [ ] **Step 4: Écrire l'implémentation**

Créer `packages/client/src/render/cliffs.ts` :

```ts
/**
 * Où va une paroi de falaise — math PURE, aucun import Phaser.
 * Le pooling/placement Phaser vit dans scenes/world/cliff-layer.ts.
 *
 * On ne dessine que les décrochements vers le SUD : seule orientation dont la
 * face regarde la caméra (convention Zelda ALTTP). Est, ouest et nord reçoivent
 * une simple ombre cuite dans le sol (render/hillshade.ts : stepShadeAt).
 *
 * Une paroi se rend EXACTEMENT comme un arbre : un sprite plus haut qu'une
 * tuile, ancré par les pieds, trié dans la bande Y unique. L'occlusion « je
 * passe derrière la falaise » sort gratuitement de ySortDepth.
 *
 * TRANCHE 1 : purement visuel. Rien ne bloque. Un acteur qui entre dans la bande
 * de la paroi y est CACHÉ — c'est laid et assumé, cette bande devient solide en
 * tranche 2 (spec §5.3).
 */
import { TIE_CLIFF, TILE_PX, ySortDepth } from './framing'
import type { SampleLevel } from './hillshade'

/** Hauteur à l'écran d'une paroi d'UN palier, en px. Réglage visuel. */
export const STEP_PX = 10
/** Décrochement maximal doté d'un art cuit. Au-delà, la paroi est plafonnée. */
export const MAX_DROP = 6

/** Une face portée par la tuile HAUTE `(tx, ty)`, dont le voisin sud est plus bas. */
export interface CliffFace {
  tx: number
  ty: number
  /** Nombre de paliers de chute vers le sud. Toujours ≥ 1. */
  drop: number
}

export interface CliffPlacement {
  /** position pixel du sprite (origine pieds 0.5/1) */
  px: number
  py: number
  displayW: number
  displayH: number
  /** Y-sort : croît vers le bas */
  depth: number
  /** décrochement PLAFONNÉ — sert de clé de texture (`cliff-${drop}`) */
  drop: number
}

/** Cette tuile porte-t-elle une face sud ? `null` sinon (bord de carte compris). */
export function cliffAt(tx: number, ty: number, sample: SampleLevel): CliffFace | null {
  const here = sample(tx, ty)
  const south = sample(tx, ty + 1)
  if (here < 0 || south < 0 || here <= south) return null
  return { tx, ty, drop: here - south }
}

/** Hauteur à l'écran d'une paroi de `drop` paliers, plafonnée à MAX_DROP. */
export function faceHeightPx(drop: number): number {
  return (drop < MAX_DROP ? drop : MAX_DROP) * STEP_PX
}

/**
 * La paroi PEND depuis l'arête : bord haut à la frontière `ty+1`, pieds en
 * dessous, sur le sol bas. D'où : l'acteur au pied (plus au sud) passe devant,
 * l'acteur sur le plateau passe derrière.
 */
export function cliffPlacement(face: CliffFace, tilePx: number = TILE_PX): CliffPlacement {
  const h = faceHeightPx(face.drop)
  const py = (face.ty + 1) * tilePx + h
  return {
    px: (face.tx + 0.5) * tilePx,
    py,
    displayW: tilePx,
    displayH: h,
    depth: ySortDepth(py / tilePx, tilePx, TIE_CLIFF),
    drop: face.drop < MAX_DROP ? face.drop : MAX_DROP,
  }
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm --filter @braises/client exec vitest run src/render/cliffs.test.ts src/render/framing.test.ts
```

Attendu : PASS. `framing.test.ts` (21 tests) doit rester vert : `TIE_CORPSE` passe de `0` à `0.1`, ce qui ne change aucun **ordre** (le cadavre reste sous le décor, au-dessus de la paroi).

- [ ] **Step 6: Vérifier et committer**

```bash
pnpm check && pnpm test && pnpm lint
git add packages/client/src/render/cliffs.ts packages/client/src/render/cliffs.test.ts packages/client/src/render/framing.ts
git commit -m "feat(client): géométrie et tri des parois de falaise — fonctions pures"
```

---

## Task 7: Dessiner les parois (client)

**Files:**
- Create: `packages/client/src/scenes/world/cliff-layer.ts`
- Modify: `packages/client/src/scenes/WorldScene.ts` (imports, champ `cliffs`, `bakeCliffTextures`, instanciation, `update`)

**Interfaces:**
- Consumes: `cliffAt`, `cliffPlacement`, `faceHeightPx`, `MAX_DROP`, `STEP_PX` (tâche 6) ; `SampleLevel` (tâche 4) ; `map.level` (tâches 2-3).
- Produces: `class CliffLayer { constructor(scene, map); update(camera); destroy() }`

Pas de test unitaire : c'est du pooling Phaser, la décision est déjà testée en tâche 6. Vérification visuelle en tâche 8.

- [ ] **Step 1: Créer la couche**

Créer `packages/client/src/scenes/world/cliff-layer.ts` :

```ts
/**
 * Rendu des parois de falaise : sprites POOLÉS, cullés à la vue caméra.
 * Purement visuel — aucune collision (tranche 1 : rien ne bloque).
 * La décision « quelle tuile porte une face, de quelle hauteur » vit dans
 * render/cliffs.ts (pur) ; ici on ne fait que du pooling Phaser et du placement.
 *
 * Calqué sur clutter-layer.ts, à deux différences près : pas de coupe au dézoom
 * (une falaise est structurelle, elle doit rester lisible de loin), et une marge
 * de culling NORD élargie — une paroi PEND sous son arête, donc une face née
 * juste au-dessus du champ de vision doit quand même être dessinée.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { cliffAt, cliffPlacement, MAX_DROP, STEP_PX } from '../../render/cliffs'
import type { SampleLevel } from '../../render/hillshade'
import { TILE_PX } from '../../render/framing'

/** Marge de culling : assez au nord pour attraper une paroi qui pend dans la vue. */
const MARGIN_TILES = 2 + Math.ceil((MAX_DROP * STEP_PX) / TILE_PX)
const MAX_SPRITES = 3000 // borne dure de perf (cap : on log si dépassé)

export class CliffLayer {
  private readonly pool: Phaser.GameObjects.Image[] = []
  private readonly sample: SampleLevel
  private warned = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
  ) {
    this.sample = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
      return map.level?.[ty * map.width + tx] ?? -1
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    let used = 0
    const v = camera.worldView
    const x0 = Math.max(0, Math.floor(v.x / TILE_PX) - MARGIN_TILES)
    const y0 = Math.max(0, Math.floor(v.y / TILE_PX) - MARGIN_TILES)
    const x1 = Math.min(this.map.width - 1, Math.ceil((v.x + v.width) / TILE_PX) + MARGIN_TILES)
    const y1 = Math.min(this.map.height - 1, Math.ceil((v.y + v.height) / TILE_PX) + MARGIN_TILES)
    for (let ty = y0; ty <= y1 && used < MAX_SPRITES; ty++) {
      for (let tx = x0; tx <= x1 && used < MAX_SPRITES; tx++) {
        const face = cliffAt(tx, ty, this.sample)
        if (!face) continue
        const p = cliffPlacement(face, TILE_PX)
        const sprite = this.acquire(used++)
        sprite.setTexture(`cliff-${p.drop}`)
        sprite.setPosition(p.px, p.py)
        sprite.setDisplaySize(p.displayW, p.displayH)
        sprite.setDepth(p.depth)
        sprite.setVisible(true)
      }
    }
    if (used >= MAX_SPRITES && !this.warned) {
      console.warn(`[cliffs] cap de ${MAX_SPRITES} sprites atteint — parois tronquées à la vue`)
      this.warned = true
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false)
  }

  private acquire(i: number): Phaser.GameObjects.Image {
    let sprite = this.pool[i]
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, 'cliff-1').setOrigin(0.5, 1)
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

- [ ] **Step 2: Cuire les textures de paroi dans `WorldScene`**

Ajouter les imports dans `packages/client/src/scenes/WorldScene.ts` :

```ts
import { CliffLayer } from './world/cliff-layer'
import { faceHeightPx, MAX_DROP } from '../render/cliffs'
```

Ajouter le champ, à côté de `private clutter?: ClutterLayer` (ligne 150) :

```ts
  private cliffs?: CliffLayer
```

Ajouter la méthode, à côté de `bakeCanopyTexture` :

```ts
  /** Cuit une texture de paroi par décrochement (1..MAX_DROP) : corps de roche,
   *  arête claire en haut, base assombrie. Art placeholder — calibré à l'œil. */
  private bakeCliffTextures(): void {
    const ROCK = 0x6e6a66
    for (let drop = 1; drop <= MAX_DROP; drop++) {
      const key = `cliff-${drop}`
      if (this.textures.exists(key)) continue
      const h = faceHeightPx(drop)
      const g = this.add.graphics()
      g.fillStyle(shade(ROCK, 0.72))
      g.fillRect(0, 0, TILE_PX, h) // corps de la paroi
      g.fillStyle(shade(ROCK, 1.15))
      g.fillRect(0, 0, TILE_PX, 2) // arête claire (l'herbe du plateau accroche la lumière)
      g.fillStyle(shade(ROCK, 0.45))
      g.fillRect(0, h - 3, TILE_PX, 3) // base assombrie (ombre portée au pied)
      g.generateTexture(key, TILE_PX, h)
      g.destroy()
    }
  }
```

- [ ] **Step 3: Instancier et mettre à jour la couche**

Dans `WorldScene`, juste après la ligne 272 (`this.clutter = new ClutterLayer(...)`) :

```ts
    this.bakeCliffTextures()
    this.cliffs = new CliffLayer(this, this.map)
```

Et dans `update`, juste après la ligne 293 (`this.clutter?.update(this.cameras.main)`) :

```ts
    this.cliffs?.update(this.cameras.main)
```

- [ ] **Step 4: Vérifier que ça compile et se construit**

```bash
pnpm check && pnpm test && pnpm lint && pnpm build
```

Attendu : tout vert.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/world/cliff-layer.ts packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): les falaises se dessinent en parois verticales Y-sortées"
```

---

## Task 8: Le regard — quatre captures, et les quatre boutons

**Files:**
- Modify (calibrage seulement, si besoin) : `packages/sim/src/balance.ts` (`TERRACE`), `packages/client/src/render/cliffs.ts` (`STEP_PX`), `packages/client/src/render/hillshade.ts` (`HILLSHADE_STRENGTH`)

**Interfaces:**
- Consumes: tout le reste.
- Produces: un verdict — *ça lit comme les Alpes* ou *c'est de la soupe d'escalier*.

**Rappel d'environnement** (mémoire `browser-smoke-test`) : `pnpm dev` est bloqué par un cache `.vite` appartenant à root. Passer par `build` + `preview`, piloter le Chromium mis en cache par `playwright-core` du projet Manif (`/home/alexis/projects/demo/node_modules/playwright-core`), et mener l'avatar via `window.__BRAISES__`.

- [ ] **Step 1: Construire et servir**

```bash
pnpm build
pnpm --filter @braises/client exec vite preview --port 4173
```

- [ ] **Step 2: Prendre les quatre captures**

Piloter Chromium (swiftshader) sur `http://localhost:4173`, mener l'avatar via `window.__BRAISES__`, et capturer :

1. **Un versant au soleil** — vérifier que le nord-ouest s'éclaircit et le sud-est s'assombrit.
2. **Un plateau vu de son pied** — vérifier que la paroi a du volume, que l'arête accroche la lumière, et qu'un acteur au pied se dessine **devant** elle.
3. **Une cascade** — une rivière franchissant une frontière de palier.
4. **Un plan large de la vallée** — dézoomé : les terrasses lisent-elles comme un relief, ou comme du bruit quantifié ?

- [ ] **Step 3: Présenter les captures en artefact**

Publier un artefact HTML avec les quatre captures en **grille 2×2** (préférence d'Alexis, mémoire `artifact-images-preference`), légendées, avec les valeurs des quatre boutons utilisées.

- [ ] **Step 4: Tourner les boutons**

En boucle courte, sans spec ni plan par itération (mémoire `fast-iteration-worldfeel`) :

| Symptôme | Bouton |
|---|---|
| Terrasses déchiquetées, escalier dans l'escalier | `TERRACE.SMOOTH_RADIUS` ↑ |
| Trop peu de marches, vallée en toboggan | `TERRACE.LEVELS` ↑ |
| Trop de marches, sol en gradins de rizière | `TERRACE.LEVELS` ↓ |
| Parois écrasées, pas de volume | `STEP_PX` ↑ |
| Versants délavés / trop contrastés | `HILLSHADE_STRENGTH` |
| L'ombrage brouille la lecture des marches | `HILLSHADE_STRENGTH` ↓ (spec §9) |

- [ ] **Step 5: Rendre le verdict**

- **Ça lit comme les Alpes** → consigner une ligne dans `docs/decisions.md`, et ouvrir la tranche 2 (collision orientée, rampes, pathfinding dirigé).
- **C'est de la soupe d'escalier** → consigner le verdict. `computeElevation` doit être refait pour émettre plateaux et cols *par construction* (approche B de la spec §9). La tranche 1 aura fait son travail d'instrument de mesure.

- [ ] **Step 6: Commit du calibrage**

```bash
git add packages/sim/src/balance.ts packages/client/src/render/cliffs.ts packages/client/src/render/hillshade.ts docs/decisions.md
git commit -m "chore(relief): calibrage des paliers, des parois et du hillshade à la capture"
```

---

## Récapitulatif des garde-fous

- Aucun fichier de `/sim` autre que `terrace.ts`, `map.ts`, `balance.ts`, `alpinegen.ts`, `index.ts` (+ leurs tests) n'est touché.
- `collision.ts`, `pathfinding.ts`, `isBlockingTile` : **intacts**. Rien ne bloque.
- Le banc de scénario (`generateValley`, sans élévation) reste vert par construction.
- Les fonctions client dégradent proprement sur une carte sans `elevation`/`level` : facteur `1`, aucune paroi.
