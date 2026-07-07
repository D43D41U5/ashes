# Vallée organique — bruit gradient + macro-structure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la carte de la Vallée organique en remplaçant le moteur de value noise par du bruit gradient (Perlin), en warpant les frontières de biome, et en faisant méandrer rivière et routes — sans casser le déterminisme ni affamer un village au banc de scénario.

**Architecture:** Trois couches, du fond vers la surface. (1) `noise.ts` : `gradientNoise2` devient la base du fractal `fbm2` (signature inchangée), plus un helper `fbmWarp2` (domain warping) ; `valueNoise2` retiré. (2) `valleygen.ts` → `paintBiomes` : lookup de région et seuil de biome passent par des coordonnées warpées → les coutures rectangulaires deviennent organiques. (3) `valleygen-primitives.ts` → `paintPolyline` : paramètre `meander` optionnel (décalage perpendiculaire bruité, fondu aux extrémités) consommé par rivière/routes ; croisements élargis pour rester sur l'eau. Un dernier lot recalibre les densités et prouve le banc vert.

**Tech Stack:** TypeScript pur (`packages/sim`), Vitest. Aucune dépendance ajoutée.

## Global Constraints

- **`/sim` pur** — zéro import Phaser/Colyseus/Node. (invariant n°1)
- **Déterminisme bit-exact entre moteurs JS** — opérations autorisées uniquement : `+ − × /`, `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`, `>>>`, constantes. **Interdit** : `sin`, `cos`, `pow`, `exp`, `log`, `**`, `hypot`, `Math.random`, `Date`. Le lint (`pnpm lint`) le fait respecter — jamais le contourner. (invariant n°2)
- **State JSON-sérialisable** — pas de classes/`Map`/`Set` dans les structures de sim. (ici : la table de gradients est une constante de module, pas de l'état.)
- **Scalabilité** — amplitudes de warp/méandre = **fractions de la feature** (dimension de carte, `halfWidth`), jamais des entiers supposant 192×192. Ce sont du **contenu de carte** (constantes documentées à côté du générateur), pas de l'équilibrage (`balance.ts` reste intact).
- **Français** pour code/docs ; identifiants en anglais.
- Vérif de référence à lancer souvent : `pnpm check && pnpm test && pnpm lint`.

---

### Task 1: Moteur de bruit gradient — `gradientNoise2`, base de `fbm2`, retrait de `valueNoise2`

**Files:**
- Modify: `packages/sim/src/noise.ts`
- Modify: `packages/sim/src/noise.test.ts`
- Modify: `packages/sim/src/index.ts:19`
- Test: `packages/sim/src/noise.test.ts`

**Interfaces:**
- Consumes: `hash2(x, y, seed)` (existant, inchangé).
- Produces:
  - `gradientNoise2(x: number, y: number, seed?: number): number` → `[0, 1)`, vaut exactement `0.5` aux coordonnées entières.
  - `fbm2(x: number, y: number, scale: number, seed?: number): number` → `[0, 1)`, **signature et sémantique de `scale` inchangées** ; base interne = `gradientNoise2`.
  - `valueNoise2` **n'existe plus**.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `packages/sim/src/noise.test.ts`, remplacer l'import ligne 2 et le test de continuité de `valueNoise2` (lignes 23-27) par des tests de `gradientNoise2`. Fichier cible :

```typescript
import { describe, expect, it } from 'vitest'
import { fbm2, gradientNoise2, hash2 } from './noise'

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

  it('gradientNoise2 vaut exactement 0.5 aux nœuds entiers (signature du bruit gradient)', () => {
    // Le fade quintique annule la contribution des coins voisins aux entiers.
    expect(gradientNoise2(5, 9, 3)).toBe(0.5)
    expect(gradientNoise2(0, 0, 0)).toBe(0.5)
    expect(gradientNoise2(-4, 12, 99)).toBe(0.5)
  })

  it('gradientNoise2 est stable, dans [0, 1), et continu', () => {
    expect(gradientNoise2(3.2, 5.7, 1)).toBe(gradientNoise2(3.2, 5.7, 1))
    for (let i = 0; i < 1000; i++) {
      const v = gradientNoise2(i * 1.3, i * 0.7, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    const a = gradientNoise2(3.0, 5.0, 1)
    const b = gradientNoise2(3.002, 5.0, 1)
    expect(Math.abs(a - b)).toBeLessThan(0.02)
  })

  it('gradientNoise2 a une moyenne empirique proche de 0.5 (symétrique autour de 0)', () => {
    let sum = 0
    let n = 0
    for (let i = 0; i < 400; i++) {
      sum += gradientNoise2(i * 0.37 + 0.13, i * 0.61 + 0.29, 7)
      n += 1
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.05)
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

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @braises/sim test -- noise.test.ts`
Expected: FAIL — `gradientNoise2` n'est pas exporté (`No known export 'gradientNoise2'`).

- [ ] **Step 3: Implémenter `gradientNoise2` et rebaser `fbm2`**

Dans `packages/sim/src/noise.ts`, remplacer `valueNoise2` (lignes 17-33) par `gradientNoise2`, et changer la base de `fbm2` (lignes 36-41). `hash2` (lignes 11-15) reste tel quel.

```typescript
/**
 * Bruit gradient (Perlin) 2D → [0, 1). Vaut 0.5 aux nœuds entiers (le fade
 * quintique y annule les coins voisins) : les features naissent ENTRE les
 * nœuds, pas calées sur la grille des entiers — remède à l'artefact « patates
 * alignées » du value noise. N'utilise que + - * / floor min max et hash2 :
 * exact au bit près entre moteurs JS (invariant n°2).
 */
const GRAD2: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
]
// Étalement du produit scalaire brut (~[-0.7, 0.7]) vers [0, 1). Clampé pour
// garantir l'intervalle quelle que soit la seed. Constante de contenu.
const GRAD_SCALE = 0.7

function gradAt(ix: number, iy: number, seed: number): readonly [number, number] {
  const idx = Math.min(7, Math.floor(hash2(ix, iy, seed) * 8))
  return GRAD2[idx]!
}

export function gradientNoise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const g00 = gradAt(x0, y0, seed)
  const g10 = gradAt(x0 + 1, y0, seed)
  const g01 = gradAt(x0, y0 + 1, seed)
  const g11 = gradAt(x0 + 1, y0 + 1, seed)
  const d00 = g00[0] * fx + g00[1] * fy
  const d10 = g10[0] * (fx - 1) + g10[1] * fy
  const d01 = g01[0] * fx + g01[1] * (fy - 1)
  const d11 = g11[0] * (fx - 1) + g11[1] * (fy - 1)
  // fade quintique 6t⁵−15t⁴+10t³ (polynôme → exact, C² continu)
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const nx0 = d00 + (d10 - d00) * u
  const nx1 = d01 + (d11 - d01) * u
  const n = nx0 + (nx1 - nx0) * v
  return Math.min(0.9999999, Math.max(0, n * GRAD_SCALE + 0.5))
}

/** Bruit fractal (3 octaves) à l'échelle `scale` (en tuiles) → [0, 1). */
export function fbm2(x: number, y: number, scale: number, seed = 0): number {
  const a = gradientNoise2(x / scale, y / scale, seed)
  const b = gradientNoise2((x * 2) / scale, (y * 2) / scale, (seed ^ 0x9e3779b9) | 0)
  const c = gradientNoise2((x * 4) / scale, (y * 4) / scale, (seed ^ 0x51ab3f77) | 0)
  return (a * 4 + b * 2 + c) / 7
}
```

- [ ] **Step 4: Retirer l'export de `valueNoise2`**

Dans `packages/sim/src/index.ts:19`, remplacer :

```typescript
export { hash2, valueNoise2, fbm2 } from './noise'
```

par :

```typescript
export { hash2, gradientNoise2, fbm2 } from './noise'
```

- [ ] **Step 5: Lancer les tests du bruit**

Run: `pnpm --filter @braises/sim test -- noise.test.ts`
Expected: PASS (6 tests verts).

- [ ] **Step 6: Vérifier pureté + types**

Run: `pnpm check && pnpm lint`
Expected: 0 erreur. (Aucune opération Math interdite ; `valueNoise2` n'est plus référencé nulle part.)

Si `pnpm lint`/`check` signale un `valueNoise2` orphelin ailleurs (autre que déjà traité), le corriger avant de commiter.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/noise.ts packages/sim/src/noise.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): bruit gradient (Perlin) en base de fbm2, retrait du value noise

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Domain warping — helper `fbmWarp2`

**Files:**
- Modify: `packages/sim/src/noise.ts`
- Modify: `packages/sim/src/noise.test.ts`
- Modify: `packages/sim/src/index.ts:19`
- Test: `packages/sim/src/noise.test.ts`

**Interfaces:**
- Consumes: `fbm2` (Task 1).
- Produces: `fbmWarp2(x: number, y: number, scale: number, seed: number, warpAmp: number): number` → `[0, 1)`. `warpAmp === 0` ⇒ **identique** à `fbm2(x, y, scale, seed)` (bit à bit) ; `warpAmp > 0` ⇒ déplace l'échantillonnage.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter dans `packages/sim/src/noise.test.ts`, à l'intérieur du `describe`, après le test `fbm2` :

```typescript
  it('fbmWarp2 à amplitude 0 est identique à fbm2 (bit à bit)', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 1.9 + 0.3
      const y = i * 0.8 + 0.7
      expect(fbmWarp2(x, y, 24, 2026, 0)).toBe(fbm2(x, y, 24, 2026))
    }
  })

  it('fbmWarp2 à amplitude > 0 déplace l’échantillonnage (diffère de fbm2)', () => {
    let differ = 0
    for (let i = 0; i < 200; i++) {
      const x = i * 1.9 + 0.3
      const y = i * 0.8 + 0.7
      if (fbmWarp2(x, y, 24, 2026, 8) !== fbm2(x, y, 24, 2026)) differ += 1
    }
    expect(differ).toBeGreaterThan(150) // la grande majorité des points bougent
  })

  it('fbmWarp2 est stable et dans [0, 1)', () => {
    expect(fbmWarp2(40, 60, 24, 7, 8)).toBe(fbmWarp2(40, 60, 24, 7, 8))
    for (let i = 0; i < 400; i++) {
      const v = fbmWarp2(i * 1.3, i * 0.7, 16, 5, 8)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
```

Et ajouter `fbmWarp2` à l'import ligne 2 :

```typescript
import { fbm2, fbmWarp2, gradientNoise2, hash2 } from './noise'
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @braises/sim test -- noise.test.ts`
Expected: FAIL — `fbmWarp2` non exporté.

- [ ] **Step 3: Implémenter `fbmWarp2`**

Ajouter à la fin de `packages/sim/src/noise.ts` :

```typescript
/**
 * Domain warping — décale les coordonnées d'échantillonnage par un champ de
 * bruit basse fréquence avant d'évaluer fbm2. C'est le multiplicateur
 * d'organicité : il tord toute frontière qu'il touche (biomes) sans changer
 * la quantité échantillonnée. `warpAmp` en tuiles ; 0 ⇒ pas de warp.
 * N'utilise que + - * et fbm2 → exact.
 */
export function fbmWarp2(x: number, y: number, scale: number, seed: number, warpAmp: number): number {
  const qx = fbm2(x, y, scale * 2, (seed ^ 0x1b56c4f9) | 0)
  const qy = fbm2(x, y, scale * 2, (seed ^ 0x7d2ac03b) | 0)
  return fbm2(x + warpAmp * (qx * 2 - 1), y + warpAmp * (qy * 2 - 1), scale, seed | 0)
}
```

- [ ] **Step 4: Exporter `fbmWarp2`**

Dans `packages/sim/src/index.ts:19` :

```typescript
export { hash2, gradientNoise2, fbm2, fbmWarp2 } from './noise'
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @braises/sim test -- noise.test.ts`
Expected: PASS (9 tests verts).

- [ ] **Step 6: Vérifier pureté + types**

Run: `pnpm check && pnpm lint`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/noise.ts packages/sim/src/noise.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): fbmWarp2 — domain warping déterministe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Frontières de biome warpées — `paintBiomes`

**Files:**
- Modify: `packages/sim/src/valleygen.ts` (import + `paintBiomes`, lignes 22-34 et 76-95)
- Modify: `packages/sim/src/valleygen.test.ts`
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `fbm2`, `fbmWarp2` (Tasks 1-2) ; `ValleyRegion` (existant).
- Produces: comportement interne — aucune signature publique nouvelle. `paintBiomes` warpe le lookup de région ET le seuil de biome avec la même amplitude `BIOME_WARP_AMP`, dérivée de la dimension de carte (scalable).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `packages/sim/src/valleygen.test.ts`, dans le `describe('generateValley — le socle', …)` :

```typescript
  it('la frontière de biome n’est pas une couture rectangulaire droite', () => {
    // Squelette à deux régions accolées de densité forêt très différente :
    // sans warp, TOUTE la forêt tomberait exactement à gauche de x = 24.
    const skel: ValleySkeleton = {
      ...TEST_SKELETON,
      regions: [
        { x: 4, y: 4, w: 20, h: 40, forest: 0.85 }, // ouest : dense
        { x: 24, y: 4, w: 20, h: 40, forest: 0.05 }, // est : quasi nu
      ],
    }
    const map = generateValley(skel, 7)
    // À cause du warp, des tuiles de forêt débordent à l'EST de la frontière
    // x = 24 (le bord droit devient irrégulier, pas une ligne verticale).
    let forestEastOfSeam = 0
    for (let ty = 10; ty < 38; ty++) {
      for (let tx = 24; tx < 30; tx++) {
        if (terrainAt(map, tx, ty) === TERRAIN_FOREST) forestEastOfSeam += 1
      }
    }
    expect(forestEastOfSeam).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `pnpm --filter @braises/sim test -- valleygen.test.ts`
Expected: FAIL — `forestEastOfSeam` vaut 0 (frontière droite, aucune forêt à l'est de la couture).

- [ ] **Step 3: Warper le lookup et le seuil dans `paintBiomes`**

Dans `packages/sim/src/valleygen.ts`, ajouter `fbmWarp2` à l'import depuis `./noise` (ligne 22) :

```typescript
import { fbm2, fbmWarp2, hash2 } from './noise'
```

Ajouter la constante de warp juste après `const DEFAULT_BIOME` (ligne 38) :

```typescript
// Amplitude du warp des biomes (tuiles) : fraction de la plus petite dimension
// de carte → scalable. À 192×192 ≈ 8 tuiles (modéré : crédible sans chaos).
// Contenu de carte, pas d'équilibrage. Seeds décorrélés du warp de lookup.
const BIOME_WARP_FRAC = 0.04
const BIOME_WARP_SCALE = 40
const BIOME_WARP_SEED_X = 0x2c1a9f
const BIOME_WARP_SEED_Y = 0x5f3e7b
```

Remplacer `paintBiomes` (lignes 76-95) par :

```typescript
/** La chair : biomes par région, seuils sur bruit fractal WARPÉ (frontières
 *  organiques au lieu de coutures rectangulaires). Même warp pour le lookup de
 *  région et pour le seuil → frontière et texture bougent ensemble. */
function paintBiomes(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const warpAmp = Math.max(2, Math.round(Math.min(map.width, map.height) * BIOME_WARP_FRAC))
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      // Coordonnée de lookup warpée : la frontière de région devient irrégulière.
      const wx = fbm2(tx, ty, BIOME_WARP_SCALE, (seed ^ BIOME_WARP_SEED_X) | 0)
      const wy = fbm2(tx, ty, BIOME_WARP_SCALE, (seed ^ BIOME_WARP_SEED_Y) | 0)
      const lx = tx + warpAmp * (wx * 2 - 1)
      const ly = ty + warpAmp * (wy * 2 - 1)
      const region = skeleton.regions.find(
        (r) => lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h,
      )
      const marsh = region?.marsh ?? DEFAULT_BIOME.marsh
      const forest = region?.forest ?? DEFAULT_BIOME.forest
      const rock = region?.rock ?? DEFAULT_BIOME.rock
      if (marsh > 0 && fbmWarp2(tx, ty, 16, (seed ^ 0x33aa17) | 0, warpAmp) < marsh) {
        setTile(map, tx, ty, TERRAIN_MARSH)
      } else if (fbmWarp2(tx, ty, 24, seed, warpAmp) < forest) {
        setTile(map, tx, ty, TERRAIN_FOREST)
      } else if (rock > 0 && fbmWarp2(tx, ty, 4, (seed ^ 0x7f4a21) | 0, warpAmp) > 1 - rock) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
  }
}
```

- [ ] **Step 4: Lancer les tests valleygen**

Run: `pnpm --filter @braises/sim test -- valleygen.test.ts`
Expected: le nouveau test PASS. Le test existant « la région forestière est majoritairement boisée » (region `forest: 0.9`) doit rester vert — le warp déforme le bord, pas la densité globale. S'il devient rouge (le grain gradient concentré autour de 0.5 peut baisser un peu la proportion), abaisser son seuil d'assertion d'un cran (ex. `forest / total > 0.6` → `> 0.5`) ET le noter comme re-pinning de grain, pas comme régression.

- [ ] **Step 5: Vérifier pureté + types**

Run: `pnpm check && pnpm lint`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): frontières de biome warpées — fini les coutures rectangulaires

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Méandre des polylignes — `paintPolyline` + rivière/routes/croisements

**Files:**
- Modify: `packages/sim/src/valleygen-primitives.ts` (`paintPolyline`, lignes 105-116)
- Modify: `packages/sim/src/valleygen.ts` (`paintRiver` 140-147, `paintRoads` 150-153, `paintCrossings` 156-161)
- Modify: `packages/sim/src/valleygen.test.ts`
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `stampDisk`, `fbm2` (existants) ; `Paint`, `ValleyPoint` (existants).
- Produces: `paintPolyline(map, points, halfWidth, paint, meander?)` où `meander?: { amp: number; scale: number; seed: number }`. **`meander` absent ⇒ tracé bit-identique à l'actuel** (les appelants ruisseaux/mines ne changent pas). Présent ⇒ chaque disque décalé perpendiculairement, amplitude fondue à 0 aux deux extrémités de la polyligne.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter dans `packages/sim/src/valleygen.test.ts`, dans le `describe('generateValley — le socle', …)` :

```typescript
  it('la rivière méandre (n’est plus une ligne droite) mais atteint le Lac', () => {
    // TEST_SKELETON : rivière verticale x = 30 de y = 4 à y = 40, Lac en (30,40).
    const map = generateValley(TEST_SKELETON, 7)
    const xsWithDeep = new Set<number>()
    for (let ty = 8; ty < 36; ty++) {
      for (let tx = 24; tx < 36; tx++) {
        if (terrainAt(map, tx, ty) === TERRAIN_DEEP_WATER) xsWithDeep.add(tx)
      }
    }
    // Sans méandre, l'eau profonde serait sur une seule colonne (x = 30).
    expect(xsWithDeep.size).toBeGreaterThan(1)
    // Le Lac reste de l'eau (la jonction rivière→Lac n'a pas bougé — taper).
    expect(terrainAt(map, 30, 40)).toBe(TERRAIN_DEEP_WATER)
  })

  it('le Pont retombe sur de l’eau malgré le méandre de la rivière', () => {
    // crossing bridge en (30,30) → route ; sous le disque, la rivière est là.
    const map = generateValley(TEST_SKELETON, 7)
    // Le disque de pont écrase en route ; on vérifie qu'il borde bien l'eau
    // (au moins une tuile d'eau dans un rayon proche du croisement).
    let waterNearBridge = 0
    for (let ty = 26; ty <= 34; ty++) {
      for (let tx = 26; tx <= 34; tx++) {
        const t = terrainAt(map, tx, ty)
        if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) waterNearBridge += 1
      }
    }
    expect(waterNearBridge).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @braises/sim test -- valleygen.test.ts`
Expected: FAIL — `xsWithDeep.size` vaut 1 (rivière droite sur x = 30).

- [ ] **Step 3: Ajouter le paramètre `meander` à `paintPolyline`**

Dans `packages/sim/src/valleygen-primitives.ts`, remplacer `paintPolyline` (lignes 105-116) par :

```typescript
/** Décalage perpendiculaire bruité d'une polyligne — la rivière serpente. */
export interface Meander {
  amp: number
  scale: number
  seed: number
}

/**
 * Trace une polyligne en tamponnant des disques le long des segments. Avec
 * `meander`, chaque disque est décalé perpendiculairement au segment d'une
 * valeur bruitée le long de l'abscisse curviligne, fondue à 0 aux deux bouts
 * (les jonctions du squelette ne bougent pas). Sans `meander` : tracé
 * identique à l'origine (bit à bit). Que + - * / sqrt fbm2 → exact.
 */
export function paintPolyline(
  map: WorldMap, points: ValleyPoint[], halfWidth: number, paint: Paint, meander?: Meander,
): void {
  // Longueur totale (euclidienne) pour l'abscisse curviligne globale du taper.
  let total = 0
  const segLen: number[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const dx = points[i + 1]!.x - points[i]!.x
    const dy = points[i + 1]!.y - points[i]!.y
    const len = Math.sqrt(dx * dx + dy * dy)
    segLen.push(len)
    total += len
  }
  if (total <= 0) total = 1
  let arcBefore = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = segLen[i]!
    const inv = len > 0 ? 1 / len : 0
    const nx = -dy * inv // normale unitaire au segment
    const ny = dx * inv
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1) * 2
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      let ox = 0
      let oy = 0
      if (meander) {
        const arc = arcBefore + len * t
        const u = arc / total
        const taper = Math.min(1, 4 * u * (1 - u)) // 0 aux bouts, 1 au milieu
        const m = meander.amp * taper * (fbm2(arc, 0, meander.scale, meander.seed) * 2 - 1)
        ox = nx * m
        oy = ny * m
      }
      stampDisk(map, Math.round(a.x + dx * t + ox), Math.round(a.y + dy * t + oy), halfWidth, paint)
    }
    arcBefore += len
  }
}
```

- [ ] **Step 4: Câbler le méandre sur rivière et routes, élargir les croisements**

Dans `packages/sim/src/valleygen.ts`, importer `Meander` depuis les primitives (ajouter à l'import lignes 24-33) :

```typescript
import {
  isWater,
  type Meander,
  type Paint,
  paintPolyline,
  setTile,
  stampBlob,
  stampDisk,
  type ValleyPoint,
  type ValleySkeleton,
} from './valleygen-primitives'
```

Ajouter les constantes de méandre après le bloc `BIOME_WARP_*` (Task 3) :

```typescript
// Méandre (tuiles) : fraction de la largeur de la feature → scalable. Modéré.
const RIVER_MEANDER_AMP = 3
const RIVER_MEANDER = { amp: RIVER_MEANDER_AMP, scale: 24, seed: 0x9a12c7 }
const ROAD_MEANDER: Meander = { amp: 1, scale: 20, seed: 0x3d81f5 }
```

Remplacer `paintRiver` (lignes 140-147) — **le même objet méandre pour les deux passes** (peu profonde et profonde) pour qu'elles restent concentriques :

```typescript
function paintRiver(map: WorldMap, skeleton: ValleySkeleton): void {
  const { points, halfWidth } = skeleton.river
  paintPolyline(map, points, halfWidth + 1, () => TERRAIN_SHALLOW_WATER, RIVER_MEANDER)
  paintPolyline(map, points, halfWidth, () => TERRAIN_DEEP_WATER, RIVER_MEANDER)
  const { x, y, r } = skeleton.lake
  stampBlob(map, x, y, r + 2, () => TERRAIN_SHALLOW_WATER, 0xa17e5 | 0, 0.18)
  stampBlob(map, x, y, r, () => TERRAIN_DEEP_WATER, 0xa17e5 | 0, 0.18)
}
```

Remplacer `paintRoads` (lignes 150-153) :

```typescript
function paintRoads(map: WorldMap, skeleton: ValleySkeleton): void {
  const paintRoad: Paint = (cur) => (isWater(cur) ? undefined : TERRAIN_ROAD)
  for (const road of skeleton.roads) paintPolyline(map, road, 1, paintRoad, ROAD_MEANDER)
}
```

Remplacer `paintCrossings` (lignes 156-161) — rayon élargi de `ceil(amp)` pour rester sur l'eau méandrée :

```typescript
/** Pont : la route enjambe l'eau. Gué : l'eau devient peu profonde.
 *  Rayon élargi du méandre de la rivière → le croisement retombe sur l'eau. */
function paintCrossings(map: WorldMap, skeleton: ValleySkeleton): void {
  const r = skeleton.river.halfWidth + 2 + Math.ceil(RIVER_MEANDER_AMP)
  for (const c of skeleton.crossings) {
    stampDisk(map, c.x, c.y, r, () => (c.kind === 'bridge' ? TERRAIN_ROAD : TERRAIN_SHALLOW_WATER))
  }
}
```

- [ ] **Step 5: Lancer les tests valleygen**

Run: `pnpm --filter @braises/sim test -- valleygen.test.ts`
Expected: les deux nouveaux tests PASS ; les tests existants (déterminisme, enceinte étanche, forêt majoritaire) restent verts. Si « l'enceinte est étanche » casse, c'est que `sealBorderRing` (appelé après les croisements dans `generateValley`) protège déjà le bord — vérifier que l'ordre d'appel n'a pas changé ; ne pas toucher.

- [ ] **Step 6: Vérifier que ruisseaux et mines n'ont pas bougé (méandre absent = bit-identique)**

Run: `pnpm --filter @braises/sim test`
Expected: toute la suite sim (hors scénario) verte. `paintStreams`/`carveMines` appellent `paintPolyline` **sans** `meander` → tracé inchangé. Si un test de mine/ruisseau casse, c'est une régression du chemin `meander` absent — revoir Step 3 (le calcul de `ox/oy` doit rester 0 quand `meander` est `undefined`).

- [ ] **Step 7: Vérifier pureté + types**

Run: `pnpm check && pnpm lint`
Expected: 0 erreur.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/valleygen-primitives.ts packages/sim/src/valleygen.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): méandre rivière/routes, croisements élargis

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Recalibrage — banc de scénario vert, non-régression monde, smoke test, décision

**Files:**
- Modify (si nécessaire) : `packages/sim/src/valley-veillee.ts` (densités `forest`/`rock` des régions)
- Modify (si nécessaire) : `packages/sim/src/valley-veillee.test.ts` (re-pinning de seuils décalés par le grain)
- Modify: `docs/decisions.md` (nouvelle ligne)
- Test: `packages/sim/src/scenario.test.ts`, `packages/sim/src/valley-veillee.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède (Tasks 1-4).
- Produces: banc de scénario **propre** (0 échantillon affamé), suite complète verte, décision consignée.

- [ ] **Step 1: Lancer la suite complète sim + non-régression monde**

Run: `pnpm --filter @braises/sim test`
Expected: vert. Noter tout test rouge dans `valley-veillee.test.ts` : ce sont des invariants (connectivité landmarks, spawn atteignable, minerai atteignable) — s'ils cassent, **ne pas** relâcher l'invariant, mais comprendre pourquoi le nouveau grain le viole (ex. une clairière de spawn trop boisée). Corriger par le squelette (`valley-veillee.ts`), pas par l'assertion, sauf s'il s'agit d'un seuil de *proportion* (forêt majoritaire) légitimement décalé par le grain — dans ce cas re-pinner d'un cran et documenter.

- [ ] **Step 2: Lancer le banc de scénario (le gate)**

Run: `pnpm --filter @braises/sim test:scenario`
Expected attendu APRÈS calibrage : **0 échantillon affamé**, villages tenus sur 6 jours (seed 2026).

Si un village s'affame (le nouveau grain a redistribué son écosystème vivrier via le flux RNG séquentiel de `generateNodes`) : ajuster les densités de biome de la ou des régions concernées dans `VEILLEE_SKELETON.regions` (`packages/sim/src/valley-veillee.ts`, lignes 81-87) — typiquement remonter un peu la forêt/l'herbe autour du site affamé pour restaurer baies/fibres — puis relancer. Itérer jusqu'au banc vert. C'est le cœur du travail de ce lot, pas un imprévu. Ne jamais désactiver ni assouplir le banc.

- [ ] **Step 3: Vérif de référence complète**

Run: `pnpm check && pnpm test && pnpm lint && pnpm build`
Expected: les quatre verts.

- [ ] **Step 4: Smoke test navigateur — juger « organique » sur le vrai rendu**

Suivre le pattern de la mémoire `browser-smoke-test` (build + preview, Chromium en cache de `demo/node_modules/playwright-core`, piloté via `window.__BRAISES__`). Charger la Veillée, ouvrir la carte plein écran (touche M), et vérifier à l'œil :
- les frontières forêt/plaine ne sont plus des lignes droites verticales/horizontales ;
- la rivière serpente entre le nord et le Lac, le Pont et le Gué restent sur l'eau ;
- le grain des biomes n'est plus « aligné grille » (patates orientées, pas carrées).

Capturer une image avant/après si possible. Ce juge visuel prime pour le critère « organique ».

- [ ] **Step 5: Consigner la décision**

Ajouter une ligne à `docs/decisions.md` (format des lignes existantes, daté 2026-07-07, tag `[carte]`) résumant : moteur de bruit gradient (Perlin) en remplacement du value noise (`valueNoise2` retiré), domain warping (`fbmWarp2`), frontières de biome warpées, méandre rivière/routes ; amplitudes modérées, scalables (fractions de feature) ; recalibrage des densités de région pour banc de scénario vert (préciser lesquelles ont bougé, le cas échéant) ; complément au sous-projet 1, indépendant du Pont (sous-projet 2).

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "feat(sim): Vallée organique — bruit gradient + macro, banc recalibré vert

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes d'exécution

- **Ordre impératif** : 1 → 2 → 3 → 4 → 5. Chaque tâche laisse la suite sim (hors scénario) verte ; seul le banc de scénario est le gate final (Task 5).
- **Risque n°1 = calibrage** (Task 5, Step 2), pas la technique. Prévoir des itérations sur les densités de `VEILLEE_SKELETON.regions`. Précédent : au sous-projet 1, une carrière déplacée avait effondré un village en 6 jours — même mécanisme, `generateNodes` en passe RNG séquentielle.
- **Ne jamais** contourner le lint de pureté ni assouplir le banc de scénario pour « faire passer ».
- Le grain gradient est concentré autour de 0.5 (contre l'uniformité relative du value noise) : quelques seuils de *proportion* dans les tests peuvent légitimement se re-pinner d'un cran — c'est du grain, pas une régression, et ça se documente.
