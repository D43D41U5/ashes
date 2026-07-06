# La Vallée organique (sous-projet 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la vallée générée organique et scalable — contours bruités (lac, enceinte, roche), réseau d'eau (ruisseaux + étangs), et refonte de la Mine (Collines dégagées + mines en galeries dans la bordure) — sans toucher le rendu client ni la collision. Conforme à `docs/superpowers/specs/2026-07-06-vallee-organique-design.md`.

**Architecture:** Tout vit dans `packages/sim/src/valleygen.ts` (générateur pur) + son squelette `valley-veillee.ts`, avec deux nouveaux modules purs `valleygen-water.ts` et `valleygen-mines.ts` quand les passes grossissent. Le principe transversal : **aucune quantité en dur** — tout « combien » est une densité × une mesure (surface marchable, périmètre de bordure) lue dans le squelette, prouvé par un test qui génère la carte à deux tailles.

**Tech Stack:** TypeScript pur dans `/sim`, testé avec vitest.

## Global Constraints

- `/sim` est **pur** (zéro import Phaser/Colyseus/Node) et **déterministe au bit près** : seuls `+ - * /`, `Math.sqrt/abs/floor/ceil/round/trunc/sign/min/max/imul/fround` et les constantes. **Jamais** `Math.random`, `Date`, `sin`, `cos`, `pow`, `**`, `exp`, `log`, `hypot`.
- **SCALABILITÉ (contrainte non négociable)** : aucune quantité en dur. Tout « combien » = `Math.round(densité × mesure)` où la mesure est lue des dimensions du squelette. Amplitudes de bruit = fraction de la feature. Le générateur lit ses extents de `skeleton.width/height`, jamais `192`. Prouvé par le test R6 (génération à deux tailles).
- État de sim JSON-sérialisable : pas de classes, pas de `Map`/`Set` dans `WorldMap`.
- Les densités et amplitudes de carte sont du **contenu**, pas de l'équilibrage : elles vivent en constantes documentées à côté du générateur, **pas** dans `balance.ts`.
- Code et docs en **français**, identifiants de code en **anglais**.
- Avant **chaque** commit : `pnpm check && pnpm test && pnpm lint` doivent passer (racine `/home/alexis/projects/braises`). Le `pnpm test` inclut le scénario ~70 s — c'est normal.
- **Ne JAMAIS stager** `docs/decisions.md`, `docs/specs/client.md`, `packages/client/src/scenes/WorldScene.ts` — ils portent des modifications utilisateur non commitées.
- **Hors périmètre** : le Pont (blob rond actuel) — reporté au sous-projet 2. Ne pas le retoucher.

**Repères existants (déjà en place, à consommer) :**
- `packages/sim/src/valleygen.ts` : `generateValley(skeleton, seed)`, types `ValleyPoint`/`ValleyRegion`/`ValleySkeleton`, et les helpers internes **non exportés** `setTile(map, tx, ty, id)`, type `Paint = (current: number) => number | undefined`, `stampDisk(map, cx, cy, r, paint)`, `paintPolyline(map, points, halfWidth, paint)`, `isWater(t)`, `paintClear`. Ordre des passes dans `generateValley` : biomes → border → ridges → river → roads → crossings → clearings → ruins → zones.
- `packages/sim/src/noise.ts` : `hash2(x, y, seed?)`, `valueNoise2(...)`, `fbm2(x, y, scale, seed?)` — tous → `[0, 1)`, déterministes.
- `packages/sim/src/balance.ts:170` : `NodeType = 'tree' | 'rock' | 'fiber_plant' | 'berry_bush' | 'iron_vein' | 'coal_seam'`. `NODE_DEFS.rock = { item:'stone', stock:12, blocks:true, ... }`, `iron_vein`/`coal_seam` = T2. Constantes terrain : `TERRAIN_GRASS=1`, `TERRAIN_ROAD=2`, `TERRAIN_FOREST=3`, `TERRAIN_SHALLOW_WATER=4`, `TERRAIN_ROCK=5`, `TERRAIN_DEEP_WATER=6`, `TERRAIN_WALL=7`, `TERRAIN_MARSH=8`.
- `packages/sim/src/economy.ts:201` `generateNodes(map, seed)` : un tirage PRNG par tuile marchable (ordre row-major), `zoneAt(tx+0.5, ty+0.5)` → `kind`. `kind:'gisement'` pose fer/charbon.
- `packages/sim/src/map.ts` : `WorldMap { width, height, terrain: number[], zones: Zone[] }`, `Zone { name, x, y, w, h, kind? }`, `terrainAt`, `isBlockingTile`, `zoneAt`.
- `packages/sim/src/valley-veillee.ts` : `VEILLEE_SKELETON`, `VEILLEE_SITES`. `valley-veillee.test.ts` contient déjà un helper `reachable(map, sx, sy)` (flood-fill 4-voisins, retourne `Set<number>` d'indices de tuiles) et les critères R1-R5bis.

---

### Task 1: `stampBlob` — le disque à contour bruité, appliqué au Lac

**Files:**
- Modify: `packages/sim/src/valleygen.ts` (ajout de `stampBlob`, usage dans `paintRiver` pour le Lac)
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `stampDisk`, `Paint`, `setTile`, `fbm2` (existants).
- Produces: `stampBlob(map, cx, cy, r, paint, seed, wobble)` — helper interne non exporté. `wobble` est une fraction (0..1) du rayon : contour perturbé par `fbm2`. Réutilisé en Task 4 (étangs) et Task 6 (chambres de mine).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/valleygen.test.ts` (le fichier importe déjà `terrainAt`, `TERRAIN_*`, `generateValley`, `TEST_SKELETON`). Nouveau `describe` :

```ts
describe('stampBlob — contours organiques (Lac)', () => {
  it("le Lac n'est plus un disque parfait : son contour est irrégulier", () => {
    const map = generateValley(TEST_SKELETON, 7)
    const { x, y, r } = TEST_SKELETON.lake
    // Sur l'anneau du rayon nominal, un disque parfait donnerait un mélange net ;
    // un contour bruité met de l'eau au-delà de r ET de la terre en-deçà.
    let waterBeyond = 0
    let landWithin = 0
    for (let ty = y - r - 3; ty <= y + r + 3; ty++) {
      for (let tx = x - r - 3; tx <= x + r + 3; tx++) {
        const d2 = (tx - x) * (tx - x) + (ty - y) * (ty - y)
        const t = terrainAt(map, tx, ty)
        const wet = t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER
        if (d2 > (r + 1) * (r + 1) && wet) waterBeyond++
        if (d2 < (r - 1) * (r - 1) && !wet) landWithin++
      }
    }
    // Au moins l'un des deux est franc : le bord ondule, pas un cercle net.
    expect(waterBeyond + landWithin).toBeGreaterThan(8)
  })

  it('reste déterministe : même seed → même carte', () => {
    expect(generateValley(TEST_SKELETON, 7).terrain).toEqual(generateValley(TEST_SKELETON, 7).terrain)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: FAIL — le Lac est un disque parfait (`waterBeyond + landWithin` = 0).

- [ ] **Step 3: Implémenter `stampBlob` et l'utiliser pour le Lac**

Dans `packages/sim/src/valleygen.ts`, ajouter après `stampDisk` (vers la ligne 98) :

```ts
/**
 * Tamponne un disque à contour perturbé par le bruit fractal — une berge
 * organique au lieu d'un cercle net. `wobble` est une fraction du rayon.
 * N'utilise que + - * / et fbm2 (déterministe, exact) : pas de trigo.
 */
function stampBlob(
  map: WorldMap, cx: number, cy: number, r: number, paint: Paint, seed: number, wobble: number,
): void {
  const amp = wobble * r
  const rr = Math.ceil(r + amp) + 1
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
      // Seuil bruité : rayon effectif r + amp·(fbm−½)·2, comparé au carré.
      const noisy = r + amp * (fbm2(tx, ty, r, seed) * 2 - 1)
      if (dx * dx + dy * dy > noisy * noisy) continue
      const next = paint(map.terrain[ty * map.width + tx] ?? 0)
      if (next !== undefined) setTile(map, tx, ty, next)
    }
  }
}
```

Puis dans `paintRiver`, remplacer les deux `stampDisk` du Lac par `stampBlob` (garder les `paintPolyline` de la rivière tels quels) :

```ts
function paintRiver(map: WorldMap, skeleton: ValleySkeleton): void {
  const { points, halfWidth } = skeleton.river
  paintPolyline(map, points, halfWidth + 1, () => TERRAIN_SHALLOW_WATER)
  paintPolyline(map, points, halfWidth, () => TERRAIN_DEEP_WATER)
  const { x, y, r } = skeleton.lake
  stampBlob(map, x, y, r + 2, () => TERRAIN_SHALLOW_WATER, 0xa17e5 | 0, 0.28)
  stampBlob(map, x, y, r, () => TERRAIN_DEEP_WATER, 0xa17e5 | 0, 0.28)
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS. Si `waterBeyond + landWithin` reste sous 8, augmenter `wobble` à 0.32 (contenu de carte, ajustable) — pas le seuil du test.

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe (le Lac reste connecté et non bloquant, R7 de `valley-veillee.test.ts` vert).

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): stampBlob — berge du Lac bruitée, plus de cercle parfait"
```

---

### Task 2: La roche en amas, plus en confetti

**Files:**
- Modify: `packages/sim/src/valleygen.ts` (`paintBiomes`)
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `fbm2`, `paintBiomes` existant.
- Produces: rien de nouveau — `paintBiomes` change son critère de roche (bruit fractal contigu au lieu de `hash2` par tuile).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/valleygen.test.ts` :

```ts
describe('roche en amas (dé-confettisage)', () => {
  it('la roche de biome forme des blocs, pas des tuiles isolées', () => {
    // Squelette d'exercice : une seule grande région rocheuse, pas d'eau/route.
    const rocky: ValleySkeleton = {
      ...TEST_SKELETON,
      ridges: [], river: { points: [{ x: 2, y: 2 }, { x: 2, y: 3 }], halfWidth: 0 },
      lake: { x: 2, y: 2, r: 0 }, roads: [], crossings: [], clearings: [], ruins: [],
      regions: [{ x: 6, y: 6, w: 36, h: 36, rock: 0.25 }],
    }
    const map = generateValley(rocky, 3)
    const isRock = (tx: number, ty: number): boolean => terrainAt(map, tx, ty) === TERRAIN_ROCK
    let rockTiles = 0
    let isolated = 0
    for (let ty = 8; ty < 40; ty++) {
      for (let tx = 8; tx < 40; tx++) {
        if (!isRock(tx, ty)) continue
        rockTiles++
        const neighbours = (isRock(tx + 1, ty) ? 1 : 0) + (isRock(tx - 1, ty) ? 1 : 0)
          + (isRock(tx, ty + 1) ? 1 : 0) + (isRock(tx, ty - 1) ? 1 : 0)
        if (neighbours === 0) isolated++
      }
    }
    expect(rockTiles).toBeGreaterThan(20) // la région est bien rocheuse
    // En amas : la vaste majorité des tuiles de roche touchent une autre roche.
    expect(isolated / rockTiles).toBeLessThan(0.25)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: FAIL — le semis `hash2` par tuile donne une majorité de tuiles isolées (`isolated/rockTiles` ~0.5+).

- [ ] **Step 3: Remplacer le critère de roche dans `paintBiomes`**

Dans `packages/sim/src/valleygen.ts`, `paintBiomes`, remplacer la branche roche :

```ts
      } else if (hash2(tx, ty, (seed ^ 0x7f4a21) | 0) < rock) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
```

par un seuil sur bruit fractal (contigu → amas) :

```ts
      } else if (rock > 0 && fbm2(tx, ty, 7, (seed ^ 0x7f4a21) | 0) > 1 - rock) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
```

`hash2` n'est peut-être plus utilisé dans le fichier : si le lint le signale, retirer `hash2` de l'import `from './noise'`.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS. Note : `fbm2 > 1 - rock` donne une densité *voisine* de `rock` mais pas identique (le bruit n'est pas uniforme) — c'est voulu, la densité reste une densité (scalable). Si `rockTiles` tombe sous 20, l'échelle de bruit 7 est trop grosse pour la petite région de test : la ramener à 5.

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe. R7 de `valley-veillee.test.ts` peut bouger (la roche change de disposition) mais la sanité marchable 55-85 % doit tenir ; si elle casse, c'est une recalibration de squelette réservée à la Task 7 — signaler et continuer seulement si vert.

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): roche de biome en amas (fbm) au lieu de confetti (hash par tuile)"
```

---

### Task 3: L'enceinte et la crête organiques

**Files:**
- Modify: `packages/sim/src/valleygen.ts` (`paintBorder`, et le tracé des `ridges` dans `generateValley`)
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `fbm2`, `hash2`, `paintBorder`, `setTile`.
- Produces: `paintBorder` à épaisseur multi-octave + éboulis détachés ; les crêtes gagnent un `halfWidth` bruité. Invariant préservé : **le tout dernier anneau de tuiles reste bloquant** (on ne sort pas de la carte).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/valleygen.test.ts` :

```ts
describe('enceinte organique', () => {
  const map = generateValley(TEST_SKELETON, 7)

  it('le tout dernier anneau reste bloquant (on ne sort pas de la carte)', () => {
    const w = map.width, h = map.height
    for (let i = 0; i < w; i++) {
      expect(isBlockingTile(map, i, 0)).toBe(true)
      expect(isBlockingTile(map, i, h - 1)).toBe(true)
    }
    for (let j = 0; j < h; j++) {
      expect(isBlockingTile(map, 0, j)).toBe(true)
      expect(isBlockingTile(map, w - 1, j)).toBe(true)
    }
  })

  it("l'épaisseur de l'enceinte varie (bords non rectilignes)", () => {
    // Profondeur de roche depuis le bord haut, échantillonnée sur plusieurs colonnes.
    const depths: number[] = []
    for (let tx = 5; tx < map.width - 5; tx += 3) {
      let d = 0
      while (d < map.height && isBlockingTile(map, tx, d)) d++
      depths.push(d)
    }
    const mean = depths.reduce((a, b) => a + b, 0) / depths.length
    const variance = depths.reduce((a, b) => a + (b - mean) * (b - mean), 0) / depths.length
    expect(variance).toBeGreaterThan(1) // pas une bande d'épaisseur constante
  })
})
```

(`isBlockingTile` s'importe depuis `./map` — vérifier qu'il est dans les imports du test, sinon l'ajouter.)

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: FAIL sur la variance — l'enceinte actuelle (`borderThickness + floor(4·fbm2)`) varie trop peu / de façon trop douce pour dépasser 1 sur cet échantillonnage. (Si par chance elle passe, le test reste valide comme garde-fou.)

- [ ] **Step 3: Enceinte multi-octave + éboulis, crête bruitée**

Dans `packages/sim/src/valleygen.ts`, remplacer `paintBorder` :

```ts
/**
 * L'enceinte montagneuse — épaisseur à deux octaves (baies + crénelage) et
 * quelques éboulis détachés vers l'intérieur. Le dernier anneau reste
 * bloquant : on ne sort jamais de la carte. Amplitudes fractions de
 * borderThickness → scalable.
 */
function paintBorder(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const base = skeleton.borderThickness
  const lowAmp = base * 1.5   // baies et avancées (basse fréquence)
  const highAmp = base * 0.5  // crénelage (haute fréquence)
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const d = Math.min(tx, ty, map.width - 1 - tx, map.height - 1 - ty)
      const low = fbm2(tx, ty, base * 6, (seed ^ 0xb0bd91) | 0)
      const high = fbm2(tx, ty, base * 1.5, (seed ^ 0x2f1c07) | 0)
      const th = base + Math.floor(lowAmp * low + highAmp * high)
      if (d < th) {
        setTile(map, tx, ty, TERRAIN_ROCK)
      } else if (d < th + base && hash2(tx, ty, (seed ^ 0x5ee7) | 0) < 0.06) {
        // Éboulis détaché : roche isolée juste devant l'enceinte (densité).
        setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
  }
  // Le dernier anneau, toujours bloquant quoi qu'ait fait le bruit.
  for (let i = 0; i < map.width; i++) {
    setTile(map, i, 0, TERRAIN_ROCK)
    setTile(map, i, map.height - 1, TERRAIN_ROCK)
  }
  for (let j = 0; j < map.height; j++) {
    setTile(map, 0, j, TERRAIN_ROCK)
    setTile(map, map.width - 1, j, TERRAIN_ROCK)
  }
}
```

Puis dans `generateValley`, donner aux crêtes un `halfWidth` bruité — remplacer la boucle des ridges :

```ts
  for (const ridge of skeleton.ridges) {
    paintRidge(map, ridge.points, ridge.halfWidth, seed)
  }
```

et ajouter le helper (après `paintPolyline`) :

```ts
/** Une crête à largeur bruitée — un mur de roche irrégulier, pas un ruban net. */
function paintRidge(map: WorldMap, points: ValleyPoint[], halfWidth: number, seed: number): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1) * 2
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const px = Math.round(a.x + (b.x - a.x) * t)
      const py = Math.round(a.y + (b.y - a.y) * t)
      const hw = halfWidth + Math.floor(halfWidth * (fbm2(px, py, 6, (seed ^ 0x1d3a) | 0) * 2 - 1))
      stampDisk(map, px, py, Math.max(1, hw), () => TERRAIN_ROCK)
    }
  }
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS (dernier anneau bloquant + variance > 1).

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe. La connectivité des landmarks (R7) doit tenir — le Col et les clairières restent creusés *après* l'enceinte dans l'ordre des passes. Si un landmark devient injoignable (l'enceinte plus épaisse mord dedans), c'est une recalibration de Task 7 ; signaler et ne continuer que si vert.

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): enceinte multi-octave + éboulis + crête bruitée (bords organiques)"
```

---

### Task 4: Le réseau d'eau — ruisseaux et étangs, par densité

**Files:**
- Create: `packages/sim/src/valleygen-water.ts`
- Modify: `packages/sim/src/valleygen.ts` (champs de squelette + appels des passes), `packages/sim/src/valley-veillee.ts` (densités du squelette de la Veillée)
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `stampBlob` (Task 1), `paintPolyline`, `isWater`, `Paint`, `setTile`, `TERRAIN_SHALLOW_WATER`, `TERRAIN_DEEP_WATER`, `fbm2`, `hash2`.
- Produces (dans `valleygen-water.ts`, exportés pour `generateValley`) : `paintStreams(map, skeleton, seed)` et `paintPonds(map, skeleton, seed)`. `ValleySkeleton` gagne `water?: { streamDensity?: number; pondDensity?: number }` (optionnel → `TEST_SKELETON` reste valide). `generateValley` appelle les deux passes **après** `paintRiver` (l'eau existe) et **avant** `paintRoads`.

> **Note d'architecture** : `stampBlob`, `setTile`, `paintPolyline`, `isWater`, `Paint` sont pour l'instant privés à `valleygen.ts`. Pour que `valleygen-water.ts` les consomme, les **exporter** (sans `export` de barrel — juste `export function`/`export type` dans `valleygen.ts`). Garder l'API publique `@braises/sim` (`index.ts`) inchangée : ces helpers ne sont pas ré-exportés depuis `index.ts`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/valleygen.test.ts` :

```ts
describe('réseau d’eau', () => {
  // Squelette avec de la place, une rivière et des densités d'eau explicites.
  const watery: ValleySkeleton = {
    ...TEST_SKELETON,
    regions: [{ x: 6, y: 6, w: 36, h: 20, rock: 0.2 }],
    water: { streamDensity: 0.004, pondDensity: 0.002 },
  }

  it('les ruisseaux sont peu profonds (marchables) et touchent une eau existante', () => {
    const map = generateValley(watery, 11)
    // Toute tuile d'eau peu profonde hors rivière/lac reste marchable.
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (terrainAt(map, tx, ty) === TERRAIN_SHALLOW_WATER) {
          expect(isBlockingTile(map, tx, ty)).toBe(false)
        }
      }
    }
  })

  it('les étangs existent et restent rares (densité basse)', () => {
    const map = generateValley(watery, 11)
    // Compter les composantes d'eau peu profonde loin de la rivière = étangs+ruisseaux.
    let shallow = 0
    for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] === TERRAIN_SHALLOW_WATER) shallow++
    expect(shallow).toBeGreaterThan(0)
  })

  it('déterministe', () => {
    expect(generateValley(watery, 11).terrain).toEqual(generateValley(watery, 11).terrain)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: FAIL — `water` n'est pas dans le type `ValleySkeleton` (erreur TS) puis, une fois le champ ajouté, aucun ruisseau/étang n'est peint.

- [ ] **Step 3: Créer `valleygen-water.ts`**

D'abord, dans `packages/sim/src/valleygen.ts`, **exporter** les helpers partagés et le champ de squelette :
- ajouter `export` devant `function setTile`, `function stampBlob`, `function paintPolyline`, `const isWater`, et `type Paint`.
- ajouter à l'interface `ValleySkeleton` :

```ts
  /** Densités du réseau d'eau procédural (par tuile marchable). Optionnel. */
  water?: { streamDensity?: number; pondDensity?: number }
```

Créer `packages/sim/src/valleygen-water.ts` :

```ts
/**
 * Le réseau d'eau procédural (design 2026-07-06, volet B) — ruisseaux et
 * étangs, entièrement par densité (scalable). Les ruisseaux sont peu profonds
 * et FRANCHISSABLES : décor, jamais obstacle ; un seul vrai franchissement
 * politique reste (la rivière). Tout est déterministe (noise.ts + hash).
 */
import { TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from './balance'
import type { WorldMap } from './map'
import { fbm2, hash2 } from './noise'
import { isWater, type Paint, paintPolyline, setTile, stampBlob, type ValleySkeleton } from './valleygen'

const paintShallow: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? undefined : TERRAIN_SHALLOW_WATER)

/** Surface marchable actuelle (mesure de densité). */
function walkableCount(map: WorldMap): number {
  let n = 0
  for (let i = 0; i < map.terrain.length; i++) {
    const t = map.terrain[i] ?? 0
    if (t === 1 || t === 2 || t === 3 || t === 4 || t === 8) n++ // grass/road/forest/shallow/marsh
  }
  return n
}

/** La tuile d'eau existante la plus proche de (sx, sy), ou null. Balayage borné. */
function nearestWater(map: WorldMap, sx: number, sy: number, maxR: number): { x: number; y: number } | null {
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue // seulement l'anneau
        const tx = sx + dx, ty = sy + dy
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
        if (isWater(map.terrain[ty * map.width + tx] ?? 0)) return { x: tx, y: ty }
      }
    }
  }
  return null
}

/**
 * Ruisseaux : des sources échantillonnées dans les zones rocheuses/hautes
 * dévalent vers l'eau la plus proche. Nombre = round(densité × surface).
 */
export function paintStreams(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const density = skeleton.water?.streamDensity ?? 0
  if (density <= 0) return
  const count = Math.round(density * walkableCount(map))
  const maxReach = Math.max(map.width, map.height)
  for (let k = 0; k < count; k++) {
    // Source seedée, biaisée vers les hauteurs (fort fbm de bordure).
    let best: { x: number; y: number; score: number } | null = null
    for (let s = 0; s < 24; s++) {
      const hx = 4 + Math.floor(hash2(k * 131 + s, seed, 0x511) * (map.width - 8))
      const hy = 4 + Math.floor(hash2(seed, k * 131 + s, 0x733) * (map.height - 8))
      const score = fbm2(hx, hy, 12, (seed ^ 0x9a11) | 0)
      if (!best || score > best.score) best = { x: hx, y: hy, score }
    }
    if (!best) continue
    const target = nearestWater(map, best.x, best.y, maxReach)
    if (!target) continue // pas d'eau atteinte → pas de mare pendante
    paintPolyline(map, [{ x: best.x, y: best.y }, target], 0, paintShallow)
  }
}

/**
 * Étangs : petites poches d'eau, rares (densité basse). Berge bruitée.
 * Nombre = round(densité × surface). Positionnés loin de l'eau/route existante.
 */
export function paintPonds(map: WorldMap, skeleton: ValleySkeleton, seed: number): void {
  const density = skeleton.water?.pondDensity ?? 0
  if (density <= 0) return
  const count = Math.round(density * walkableCount(map))
  for (let k = 0; k < count; k++) {
    const cx = 6 + Math.floor(hash2(k * 977, seed, 0x1b7) * (map.width - 12))
    const cy = 6 + Math.floor(hash2(seed, k * 977, 0x2c9) * (map.height - 12))
    const cur = map.terrain[cy * map.width + cx] ?? 0
    if (cur === 2 || isWater(cur)) continue // pas sur une route ni dans l'eau
    const r = 2 + Math.floor(hash2(k, seed, 0x3f1) * 3) // 2..4
    stampBlob(map, cx, cy, r + 1, paintShallow, (seed ^ (k * 31)) | 0, 0.3)
    if (r >= 3) stampBlob(map, cx, cy, r - 1, () => TERRAIN_DEEP_WATER, (seed ^ (k * 31)) | 0, 0.3)
  }
}
```

Dans `packages/sim/src/valleygen.ts`, importer et appeler les passes dans `generateValley`, **après `paintRiver`, avant `paintRoads`** :

```ts
import { paintPonds, paintStreams } from './valleygen-water'
// ...
  paintRiver(map, skeleton)
  paintStreams(map, skeleton, seed)
  paintPonds(map, skeleton, seed)
  paintRoads(map, skeleton)
```

- [ ] **Step 4: Câbler la densité dans le squelette de la Veillée**

Dans `packages/sim/src/valley-veillee.ts`, ajouter au `VEILLEE_SKELETON` (après `lake:` ou en fin d'objet, avant `landmarks` — l'ordre des clés est libre) :

```ts
  // Réseau d'eau procédural (scalable) : ruisseaux et étangs rares.
  water: { streamDensity: 0.0008, pondDensity: 0.0004 },
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS (3 nouveaux). Si aucun `shallow` n'apparaît sur `watery`, augmenter les densités du test (`streamDensity: 0.006`) — pas les seuils.

- [ ] **Step 6: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe. Les ruisseaux/étants sont marchables → n'affectent pas la connectivité (R7 vert).

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen-water.ts packages/sim/src/valley-veillee.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): réseau d'eau procédural — ruisseaux franchissables + étangs rares, par densité"
```

---

### Task 5: `generateNodes` — le `kind: 'carriere'` pose de la pierre

**Files:**
- Modify: `packages/sim/src/economy.ts:214-234` (`generateNodes`)
- Test: `packages/sim/src/economy.test.ts`

**Interfaces:**
- Consumes: `generateNodes`, `zoneAt`, `NODE_DEFS.rock` (existants).
- Produces: une zone `kind:'carriere'` fait poser des nœuds `rock` (pierre) ; le `kind:'gisement'` existant reste fer+charbon. Consommé en Task 6 (chambres de mine simples).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/economy.test.ts` (adopter le style d'import du fichier) :

```ts
it('une zone carrière ne pose que de la pierre (spec mines 2026-07-06)', () => {
  const map = createEmptyMap(20, 20, TERRAIN_GRASS)
  map.zones = [{ name: 'la Carrière', kind: 'carriere', x: 4, y: 4, w: 12, h: 12 }]
  const nodes = generateNodes(map, 5)
  const inZone = nodes.filter((n) => n.tx >= 4 && n.tx < 16 && n.ty >= 4 && n.ty < 16)
  expect(inZone.length).toBeGreaterThan(0)
  expect(inZone.every((n) => n.type === 'rock')).toBe(true)
  expect(inZone.some((n) => n.type === 'iron_vein' || n.type === 'coal_seam')).toBe(false)
})
```

(`createEmptyMap` depuis `./map`, `TERRAIN_GRASS` depuis `./balance` — compléter les imports du test.)

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/economy.test.ts`
Expected: FAIL — aucune branche `carriere`, donc `inZone.length` = 0.

- [ ] **Step 3: Ajouter la branche `carriere`**

Dans `packages/sim/src/economy.ts`, `generateNodes`, ajouter une branche **avant** le `else if (terrain === TERRAIN_FOREST)` (une zone prime sur le terrain, comme `gisement`) :

```ts
      if (zone?.kind === 'gisement') {
        if (r < 0.07) push('iron_vein', tx, ty)
        else if (r < 0.13) push('coal_seam', tx, ty)
      } else if (zone?.kind === 'carriere') {
        if (r < 0.15) push('rock', tx, ty)
      } else if (terrain === TERRAIN_FOREST) {
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/economy.test.ts`
Expected: PASS (dont le nouveau ; les cas existants inchangés — aucune carte actuelle n'a de zone `carriere`).

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe.

```bash
git add packages/sim/src/economy.ts packages/sim/src/economy.test.ts
git commit -m "feat(sim): kind 'carriere' → nœuds de pierre (mines simples)"
```

---

### Task 6: Les mines en galeries dans la bordure

**Files:**
- Create: `packages/sim/src/valleygen-mines.ts`
- Modify: `packages/sim/src/valleygen.ts` (champ `mines?` du squelette + appel de la passe + zones de mine ajoutées à `map.zones`)
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `stampBlob`, `paintPolyline`, `setTile`, `Paint` (exportés en Task 4), `TERRAIN_GRASS`, `TERRAIN_ROCK`, `hash2`, `fbm2`, type `Zone`.
- Produces (dans `valleygen-mines.ts`) : `carveMines(map, skeleton, seed): Zone[]` — creuse les galeries et **retourne les zones de chambre** (à concaténer à `map.zones` par `generateValley`, AVANT les landmarks-régions pour que `zoneAt` les voie). `ValleySkeleton` gagne `mines?: { deep: { x; y; toward: 'top'|'bottom'|'left'|'right' }[]; simpleDensity?: number }`. Les mines profondes (`deep`) sont artisanales ; les simples sont procédurales par densité de périmètre.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/sim/src/valleygen.test.ts` :

```ts
describe('mines dans la bordure', () => {
  const mined: ValleySkeleton = {
    ...TEST_SKELETON,
    mines: {
      deep: [{ x: 30, y: 10, toward: 'top' }],
      simpleDensity: 0.02,
    },
  }

  it('la chambre profonde est un gisement, creusée et atteignable', () => {
    const map = generateValley(mined, 9)
    const gisement = map.zones.find((z) => z.kind === 'gisement')
    expect(gisement).toBeDefined()
    // Au moins une tuile marchable dans la chambre (creusée dans la roche).
    let walkable = 0
    for (let ty = gisement!.y; ty < gisement!.y + gisement!.h; ty++) {
      for (let tx = gisement!.x; tx < gisement!.x + gisement!.w; tx++) {
        if (!isBlockingTile(map, tx, ty)) walkable++
      }
    }
    expect(walkable).toBeGreaterThan(0)
  })

  it('les mines simples sont des carrières (kind carriere)', () => {
    const map = generateValley(mined, 9)
    expect(map.zones.some((z) => z.kind === 'carriere')).toBe(true)
  })

  it('déterministe', () => {
    expect(generateValley(mined, 9).zones).toEqual(generateValley(mined, 9).zones)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: FAIL — `mines` absent du type, puis aucune zone `gisement`/`carriere` créée.

- [ ] **Step 3: Créer `valleygen-mines.ts`**

Dans `packages/sim/src/valleygen.ts`, ajouter le champ au type `ValleySkeleton` :

```ts
  /** Mines creusées dans la bordure. `deep` = artisanales (gisement T2) ;
   *  `simpleDensity` = carrières procédurales par unité de périmètre. */
  mines?: {
    deep: { x: number; y: number; toward: 'top' | 'bottom' | 'left' | 'right' }[]
    simpleDensity?: number
  }
```

Créer `packages/sim/src/valleygen-mines.ts` :

```ts
/**
 * Les mines en galeries (design 2026-07-06, volet C). Une mine = un couloir de
 * sol marchable qui mord dans la bordure rocheuse, terminé par une chambre ;
 * les filons y seront posés par generateNodes via le `kind` de la chambre.
 * Les profondes (gisement fer+charbon) sont artisanales ; les simples
 * (carrière/pierre) sont procédurales par densité de périmètre (scalable).
 */
import { TERRAIN_GRASS } from './balance'
import type { WorldMap, Zone } from './map'
import { hash2 } from './noise'
import { paintPolyline, setTile, stampBlob, type ValleySkeleton } from './valleygen'

type Dir = 'top' | 'bottom' | 'left' | 'right'

const paintFloor = (): number => TERRAIN_GRASS // creuse : sol marchable dans la roche

/** Vecteur intérieur d'une bordure (vers le centre de la carte). */
function inward(dir: Dir): { dx: number; dy: number } {
  if (dir === 'top') return { dx: 0, dy: 1 }
  if (dir === 'bottom') return { dx: 0, dy: -1 }
  if (dir === 'left') return { dx: 1, dy: 0 }
  return { dx: -1, dy: 0 }
}

/**
 * Creuse une galerie depuis la bouche (près de la bordure) vers l'intérieur,
 * finissant par une chambre. Retourne la zone nommée de la chambre.
 */
function carveGallery(
  map: WorldMap, x: number, y: number, dir: Dir, length: number, chamberR: number,
  name: string, kind: 'gisement' | 'carriere', seed: number, branch: boolean,
): Zone {
  const { dx, dy } = inward(dir)
  const ex = x + dx * length
  const ey = y + dy * length
  // Le couloir (sol marchable percé dans la roche).
  paintPolyline(map, [{ x, y }, { x: ex, y: ey }], 1, paintFloor)
  if (branch) {
    // Une ramification perpendiculaire à mi-galerie (mine « complexe »).
    const mx = x + dx * ((length / 2) | 0)
    const my = y + dy * ((length / 2) | 0)
    const bl = (chamberR + 2)
    paintPolyline(map, [{ x: mx, y: my }, { x: mx + dy * bl, y: my + dx * bl }], 1, paintFloor)
  }
  // La chambre au fond.
  stampBlob(map, ex, ey, chamberR, paintFloor, (seed ^ 0x6d1e) | 0, 0.3)
  return {
    name, kind,
    x: ex - chamberR - 1, y: ey - chamberR - 1,
    w: chamberR * 2 + 3, h: chamberR * 2 + 3,
  }
}

/**
 * Creuse toutes les mines et retourne leurs zones de chambre. Les profondes
 * (artisanales) sont longues, ramifiées et riches ; les simples (procédurales
 * par densité de périmètre) sont courtes et ne donnent que de la pierre.
 */
export function carveMines(map: WorldMap, skeleton: ValleySkeleton, seed: number): Zone[] {
  const zones: Zone[] = []
  const spec = skeleton.mines
  if (!spec) return zones

  let n = 0
  for (const d of spec.deep) {
    zones.push(carveGallery(map, d.x, d.y, d.toward, 14, 3, `la Mine profonde ${n + 1}`, 'gisement', (seed ^ (n * 7)) | 0, true))
    n++
  }

  const density = spec.simpleDensity ?? 0
  if (density > 0) {
    const perimeter = 2 * (map.width + map.height)
    const count = Math.round(density * perimeter / 100) // densité par 100 tuiles de périmètre
    for (let k = 0; k < count; k++) {
      // Position seedée sur l'un des quatre bords.
      const side = Math.floor(hash2(k * 53, seed, 0x88) * 4)
      const dir: Dir = side === 0 ? 'top' : side === 1 ? 'bottom' : side === 2 ? 'left' : 'right'
      const along = 8 + Math.floor(hash2(seed, k * 53, 0x91) * (Math.max(map.width, map.height) - 16))
      const mouth = mouthOnSide(map, dir, along, skeleton.borderThickness + 1)
      zones.push(carveGallery(map, mouth.x, mouth.y, dir, 6, 2, `la Carrière ${k + 1}`, 'carriere', (seed ^ (k * 17)) | 0, false))
    }
  }
  return zones
}

/** Point de bouche sur un bord donné, à `depth` tuiles du bord. */
function mouthOnSide(map: WorldMap, dir: Dir, along: number, depth: number): { x: number; y: number } {
  if (dir === 'top') return { x: Math.min(map.width - 2, along), y: depth }
  if (dir === 'bottom') return { x: Math.min(map.width - 2, along), y: map.height - 1 - depth }
  if (dir === 'left') return { x: depth, y: Math.min(map.height - 2, along) }
  return { x: map.width - 1 - depth, y: Math.min(map.height - 2, along) }
}
```

Dans `packages/sim/src/valleygen.ts`, importer et appeler `carveMines` dans `generateValley`, **après `paintBorder`/ridges** (les galeries percent la roche) et concaténer les zones **avant** les landmarks (priorité `zoneAt`) :

```ts
import { carveMines } from './valleygen-mines'
// ... dans generateValley, après la boucle des ridges :
  const mineZones = carveMines(map, skeleton, seed)
// ... et à la fin, remplacer l'assignation des zones :
  map.zones = [...mineZones, ...skeleton.landmarks.map((z) => ({ ...z }))]
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS (3 nouveaux). Si la chambre n'a aucune tuile marchable, c'est que la bouche part trop loin dans la roche — vérifier que `d.x/d.y` du test tombe bien sur la bordure (Task 7 les câblera correctement pour la Veillée).

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe.

```bash
git add packages/sim/src/valleygen.ts packages/sim/src/valleygen-mines.ts packages/sim/src/valleygen.test.ts
git commit -m "feat(sim): mines en galeries dans la bordure — profondes (gisement) + carrières procédurales"
```

---

### Task 7: Le test de scalabilité (R6) — la contrainte prouvée

**Files:**
- Test: `packages/sim/src/valleygen.test.ts`

**Interfaces:**
- Consumes: `generateValley`, `generateNodes`, les densités `water`/`mines`.
- Produces: rien de code — un critère qui **prouve** que les quantités procédurales suivent la taille de carte.

- [ ] **Step 1: Écrire le test de scalabilité**

Ajouter à `packages/sim/src/valleygen.test.ts` (importe `generateNodes` depuis `./economy`) :

```ts
describe('R6 — scalabilité : les features suivent la taille de la carte', () => {
  // Deux tailles, mêmes densités. Un doublement de côté ≈ ×4 surface.
  const base = (w: number, h: number): ValleySkeleton => ({
    width: w, height: h, borderThickness: 4, ridges: [],
    river: { points: [{ x: (w / 2) | 0, y: 4 }, { x: (w / 2) | 0, y: h - 4 }], halfWidth: 2 },
    lake: { x: (w / 2) | 0, y: h - 8, r: 5 }, roads: [], crossings: [], clearings: [], ruins: [],
    regions: [{ x: 6, y: 6, w: w - 12, h: h - 12, forest: 0.2, rock: 0.15 }],
    water: { streamDensity: 0.003, pondDensity: 0.003 },
    mines: { deep: [], simpleDensity: 0.4 },
    landmarks: [],
  })

  function shallowCount(map: { terrain: number[] }): number {
    let n = 0
    for (const t of map.terrain) if (t === 4) n++ // shallow_water
    return n
  }

  it('plus de carrières sur un plus grand périmètre', () => {
    const small = generateValley(base(96, 96), 1)
    const big = generateValley(base(192, 192), 1)
    const carr = (m: typeof small): number => m.zones.filter((z) => z.kind === 'carriere').length
    // Périmètre ×2 → ~×2 carrières. On exige strictement plus, pas l'égalité.
    expect(carr(big)).toBeGreaterThan(carr(small))
  })

  it('plus d’eau procédurale et plus de nœuds sur une plus grande surface', () => {
    const small = generateValley(base(96, 96), 2)
    const big = generateValley(base(192, 192), 2)
    expect(shallowCount(big)).toBeGreaterThan(shallowCount(small))
    expect(generateNodes(big, 2).length).toBeGreaterThan(generateNodes(small, 2).length)
  })

  it('aucune quantité figée : la petite carte n’est pas vide', () => {
    const small = generateValley(base(96, 96), 3)
    expect(small.zones.some((z) => z.kind === 'carriere')).toBe(true)
    expect(shallowCount(small)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Lancer le test**

Run: `pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts`
Expected: PASS. Si une carrière n'apparaît pas sur la petite carte (`simpleDensity` trop bas pour un périmètre de 384), c'est que la conversion `× perimeter / 100` de Task 6 est mal calibrée — l'ajuster dans `valleygen-mines.ts` (contenu), pas le test.

- [ ] **Step 3: Commiter**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout passe.

```bash
git add packages/sim/src/valleygen.test.ts
git commit -m "test(sim): R6 — scalabilité prouvée (features proportionnelles à la taille de carte)"
```

---

### Task 8: Recalibrer le squelette de la Veillée + non-régression + smoke visuel

**Files:**
- Modify: `packages/sim/src/valley-veillee.ts` (Collines dégagées, mine profonde du NE, densités)
- Modify: `packages/sim/src/valley-veillee.test.ts` (si un seuil de non-régression doit être ajusté — le documenter)
- Modify: `docs/decisions.md` (une ligne — **non stagée**)
- Test / vérif : `valley-veillee.test.ts` (R7), smoke Playwright

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `VEILLEE_SKELETON` acté — Collines habitables, une mine profonde du NE adossée à la bordure est, mines simples et eau procédurales. Les critères R1-R5bis restent verts (non-régression).

- [ ] **Step 1: Dégager les Collines et déclarer la mine profonde**

Dans `packages/sim/src/valley-veillee.ts` :
- Baisser la densité de roche des Collines : dans `regions`, la ligne `{ x: 126, y: 8, w: 60, h: 84, forest: 0.3, rock: 0.2 }` → `rock: 0.06`.
- Retirer le `kind: 'gisement'` du landmark `'la Mine du Levant'` (elle redevient une zone-région ordinaire, ou la renommer/retirer si elle n'a plus de rôle — garder le nom comme landmark de région sans `kind`). **Décision** : garder le landmark `la Mine du Levant` **sans** `kind` (repère toponymique), le gisement vit désormais dans la galerie.
- Ajouter une clairière de futur site de village dans les Collines : dans `clearings`, ajouter `{ x: 150, y: 40, r: 6 }`.
- Ajouter le champ `mines` (la mine profonde adossée à la **bordure est**, près des Collines, et une densité de carrières) :

```ts
  mines: {
    deep: [{ x: 176, y: 46, toward: 'right' }], // adossée à la bordure est
    simpleDensity: 0.15,
  },
  water: { streamDensity: 0.0008, pondDensity: 0.0004 },
```

(Si `water` a déjà été ajouté en Task 4, ne pas le dupliquer.)

- [ ] **Step 2: Lancer les critères d'acceptation de la Veillée**

Run: `pnpm --filter @braises/sim exec vitest run src/valley-veillee.test.ts`
Expected: idéalement PASS. Points de rupture probables et leur remède (ajuster le **squelette**, jamais le générateur ni le sens des tests) :
- *Connectivité d'un landmark* (l'enceinte organique ou la roche en amas a bougé) → élargir la clairière concernée ou décaler le landmark de 1-2 tuiles.
- *La chambre profonde n'est pas atteignable depuis le spawn* → la galerie doit déboucher sur du sol relié : rapprocher `deep.x/y` de la bordure réelle (l'épaisseur d'enceinte varie maintenant — viser `x` à `width - borderThickness - 2` environ), et vérifier que la bouche tombe dans la roche de bordure.
- *Sanité marchable hors 55-85 %* → ajuster les densités de roche/forêt des régions.

Si un seuil de test lui-même est devenu faux (ex. une zone renommée), corriger le test en documentant pourquoi dans le message de commit — mais ne jamais affaiblir la connectivité ni le déterminisme.

- [ ] **Step 3: Vérifier les gates complets**

Run: `pnpm check && pnpm test && pnpm lint` (inclut le scénario ~70 s)
Expected: tout vert. Le scénario tourne sur la nouvelle carte : si l'invariant de faim casse, c'est un déplacement de site de village (contenu, comme au sous-projet précédent) — le corriger dans le squelette et relancer.

- [ ] **Step 4: Smoke visuel**

Rebuild et capturer (méthode connue — `pnpm dev` bloqué par le cache `.vite` root, utiliser build + preview + Chromium en cache via `/home/alexis/projects/demo/node_modules/playwright-core`, `window.__BRAISES__`) :

```bash
pnpm build
pnpm --filter @braises/client exec vite preview --port 4173 &
```

Écrire un script dans `$CLAUDE_JOB_DIR/tmp/smoke-organique.mjs` qui charge http://localhost:4173, attend `window.__BRAISES__`, temporise 2 s, et capture une vue au spawn + une vue large (zoom caméra dézoomé si `__BRAISES__` l'expose). Lire les PNG (outil Read) et **juger** : le Lac a-t-il une berge irrégulière ? Les bords ondulent-ils ? La roche est-elle en amas et non en confetti ? Voit-on de l'eau vive et des étangs ? La zone Collines est-elle dégagée ? Ajuster les amplitudes/densités (contenu) si un critère visuel n'est pas atteint, puis re-vérifier les gates. Tuer le serveur (`kill %1`) à la fin.

- [ ] **Step 5: Consigner la décision (NON stagée) et commiter le squelette**

Ajouter à `docs/decisions.md` (même format, à la suite) :

```markdown
- 2026-07-06 — [carte] Passe d'organicité (sous-projet 1, spec 2026-07-06-vallee-organique) : stampBlob (berges bruitées), roche de biome en amas (fbm) au lieu de confetti, enceinte multi-octave + éboulis, ruisseaux franchissables + étangs rares (densité), mines en galeries dans la bordure (une profonde gisement au NE + carrières procédurales), Collines dégagées (rock 0.2→0.06) et habitables. Tout procédural est par densité × dimensions → scalable (test R6 à deux tailles). Le Pont (travée droite + passage dessous) reste au sous-projet 2.
```

**Ne pas stager `docs/decisions.md`** (modifications utilisateur préexistantes) — le signaler à l'utilisateur. Commiter uniquement le code :

```bash
git add packages/sim/src/valley-veillee.ts packages/sim/src/valley-veillee.test.ts
git commit -m "feat(sim): la Vallée de la Veillée organique — Collines dégagées, mine profonde du Levant, eau vive"
```

- [ ] **Step 6: Bilan**

Présenter à l'utilisateur : les captures, le résultat du scénario, la liste des ajustements de densité faits au smoke, et rappeler la ligne `decisions.md` en attente. Le sous-projet 2 (Pont à deux niveaux) reste à faire dans son propre cycle.

---

## Self-review (fait à la rédaction)

- **Couverture spec** : Volet A → Task 1 (stampBlob/lac), Task 2 (roche amas), Task 3 (enceinte/crête). Volet B → Task 4 (ruisseaux + étangs). Volet C → Task 5 (carriere/nodes) + Task 6 (galeries) + Task 8 step 1 (Collines dégagées). Scalabilité (principe + R6) → densités partout + Task 7. Non-régression R7 → Task 8 step 2-3. Smoke → Task 8 step 4. Pont explicitement hors périmètre (rappelé en Global Constraints et Task 8 step 6).
- **Cohérence des types** : `stampBlob(map,cx,cy,r,paint,seed,wobble)` défini Task 1, consommé Tasks 4 & 6 avec la même signature. `Paint`, `setTile`, `paintPolyline`, `isWater` exportés Task 4, consommés Tasks 4 & 6. `carveMines(map,skeleton,seed): Zone[]` défini Task 6, appelé dans `generateValley`. Champs de squelette `water?`/`mines?` optionnels → `TEST_SKELETON` (Task précédente) et les squelettes de test restent valides. `kind:'carriere'` défini Task 5, produit par Task 6, consommé par `generateNodes`.
- **Placeholders** : aucun — chaque étape porte son code. Les seuils de test et densités portent des valeurs initiales explicites, avec l'indication d'où ajuster (contenu, jamais le test).
- **Ordre des passes** (contrat) : biomes → border → ridges → **carveMines** → river → **streams** → **ponds** → roads → crossings → clearings → ruins → zones (mines + landmarks). Documenté dans Tasks 4 et 6.
