# Relief continu par warp — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le relief en escalier (paliers + faces de falaise) par un sol qui se déforme en continu selon l'élévation (Y-shear), avec picking exact et vallée ouverte vers la caméra.

**Architecture:** Un module pur `warp.ts` (client, sans Phaser) est la source de vérité : `lift` (monde→décalage écran) sert au rendu, `unproject` (écran→monde) sert au picking — les deux ne peuvent pas diverger. Le sol se dessine en `Mesh2D` déformé (grille de sommets `x,y,u,v`, fenêtrée à la vue, texturée par le bake `map-demo` existant) ; les billboards se soulèvent de `lift` ; le tri Y reste `ySortDepth(worldY)`. La gen alpine s'ouvre au sud pour garantir zéro repli.

**Tech Stack:** TypeScript, Vitest, Phaser 4.2 (`GameObjects.Mesh2D`), monorepo pnpm (`@braises/sim` + client).

## Global Constraints

- **`/sim` pur et déterministe** : la Task 6 (gen) n'utilise QUE `+ - * /`, `Math.min/max/round/floor/abs`, `clamp01` — aucune transcendante, aucun `Math.random`/`Date`. Le warp lui-même est **client-only** (aucun code dans `/sim`).
- **`H` est une constante CLIENT** (px d'écran par unité d'élévation), dans `framing.ts` — jamais dans `packages/sim/balance.ts` (le sim ignore les pixels d'écran).
- **Français** pour code/commentaires/docs ; identifiants en anglais.
- **Verts avant tout commit** : `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **TILE_PX = 16** (importé de `framing.ts`, jamais redéclaré).

---

### Task 1 : Le module pur `warp.ts` — projection, picking, garde anti-repli

**Files:**
- Create: `packages/client/src/render/warp.ts`
- Test: `packages/client/src/render/warp.test.ts`

**Interfaces:**
- Consumes : `SampleElevation` de `packages/client/src/render/hillshade.ts` (`(tx, ty) => number`, clampé aux bords).
- Produces :
  - `elevAtBilinear(txf: number, tyf: number, sample: SampleElevation): number`
  - `createWarp(sample: SampleElevation, h: number, tilePx: number): Warp`
  - `interface Warp { lift(txf: number, tyf: number): number; unproject(flatPxX: number, flatPxY: number): { x: number; y: number }; readonly h: number }`
  - `maxSouthGradient(elevation: number[], width: number, height: number): number`
  - `assertNoFold(elevation: number[], width: number, height: number, h: number, tilePx: number): void`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// packages/client/src/render/warp.test.ts
import { describe, expect, it } from 'vitest'
import type { SampleElevation } from './render/hillshade' // ajuster si chemin relatif
import { assertNoFold, createWarp, elevAtBilinear, maxSouthGradient } from './warp'

/** Champ plat à altitude constante. */
const flat = (v: number): SampleElevation => () => v
/** Champ = rampe linéaire en ty (monte vers le sud), pente `slope` par tuile. */
const rampSouth = (slope: number): SampleElevation => (_tx, ty) => Math.max(0, Math.min(1, ty * slope))

describe('elevAtBilinear', () => {
  it('interpole entre deux tuiles voisines', () => {
    const s: SampleElevation = (tx) => (tx === 0 ? 0 : tx === 1 ? 1 : 0)
    expect(elevAtBilinear(0.5, 0, s)).toBeCloseTo(0.5, 6)
  })
})

describe('createWarp.lift', () => {
  it('soulève de elev·H', () => {
    const w = createWarp(flat(0.5), 40, 16)
    expect(w.lift(3, 7)).toBeCloseTo(20, 6) // 0.5 × 40
  })
})

describe('createWarp.unproject', () => {
  it('X exact : jamais cisaillé', () => {
    const w = createWarp(flat(0.3), 40, 16)
    expect(w.unproject(123, 456).x).toBe(123)
  })

  it('aller-retour : unproject(project(p)) ≈ p sur un versant', () => {
    const H = 40, TILE = 16
    const w = createWarp(rampSouth(0.02), H, TILE)
    // Un point monde vrai (tuiles) → son py écran-monde plat, puis on ré-inverse.
    for (const tyTrue of [1, 5, 12, 20]) {
      const txTrue = 4
      const flatY = tyTrue * TILE - w.lift(txTrue, tyTrue)
      const flatX = txTrue * TILE
      const back = w.unproject(flatX, flatY)
      expect(back.x / TILE).toBeCloseTo(txTrue, 4)
      expect(back.y / TILE).toBeCloseTo(tyTrue, 3)
    }
  })

  it('sol plat : unproject = identité (elev constante nulle)', () => {
    const w = createWarp(flat(0), 40, 16)
    const back = w.unproject(80, 160)
    expect(back.x).toBe(80)
    expect(back.y).toBeCloseTo(160, 4)
  })
})

describe('garde anti-repli', () => {
  it('maxSouthGradient lit la plus forte montée vers le sud', () => {
    // 2×3 : colonne x=0 monte de 0→0.5→0.9 (gradients sud 0.5 puis 0.4).
    const elevation = [0, 0, 0.5, 0.1, 0.9, 0.2]
    expect(maxSouthGradient(elevation, 2, 3)).toBeCloseTo(0.5, 6)
  })

  it('assertNoFold passe quand H·gradient < TILE', () => {
    const elevation = [0, 0.1, 0.2, 0.3] // 1×4, gradient sud max 0.1
    expect(() => assertNoFold(elevation, 1, 4, 40, 16)).not.toThrow() // 0.1×40=4 < 16
  })

  it('assertNoFold jette quand H·gradient ≥ TILE', () => {
    const elevation = [0, 0.5, 1, 1] // 1×4, gradient sud max 0.5
    expect(() => assertNoFold(elevation, 1, 4, 40, 16)).toThrow(/replie/) // 0.5×40=20 ≥ 16
  })
})
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `pnpm --filter @braises/client test warp`
Expected: FAIL — « Cannot find module './warp' » / exports absents.

- [ ] **Step 3 : Écrire l'implémentation**

```ts
// packages/client/src/render/warp.ts
/**
 * Relief continu — le sol se déforme par l'élévation (Y-shear vertical). Math
 * PURE, aucun import Phaser. Source de vérité du RENDU (`lift`, transcrit dans le
 * tracé du sol) ET du PICKING (`unproject`) — les deux ne peuvent pas diverger.
 * Spec : docs/superpowers/specs/2026-07-10-relief-continu-warp-design.md.
 *
 * Convention : `screenY = worldY·TILE − elevation·H`, X jamais cisaillé.
 */
import type { SampleElevation } from './hillshade'

export interface Warp {
  /** Décalage écran (px) à SOUSTRAIRE du py plat d'un point monde (tuiles). */
  lift(txf: number, tyf: number): number
  /** Écran-monde PLAT (px, tel que `positionToCamera` le rend) → monde VRAI (px).
   *  X exact ; Y par résolution 1-D monotone de colonne. LE picking. */
  unproject(flatPxX: number, flatPxY: number): { x: number; y: number }
  /** Facteur d'élévation à l'écran (px/unité) — exposé pour un futur tracé GPU. */
  readonly h: number
}

/** Échantillonnage BILINÉAIRE du champ à une position fractionnaire (tuiles) :
 *  le versant est lisse, jamais en gradins. */
export function elevAtBilinear(txf: number, tyf: number, sample: SampleElevation): number {
  const x0 = Math.floor(txf)
  const y0 = Math.floor(tyf)
  const fx = txf - x0
  const fy = tyf - y0
  const a = sample(x0, y0)
  const b = sample(x0 + 1, y0)
  const c = sample(x0, y0 + 1)
  const d = sample(x0 + 1, y0 + 1)
  const top = a + (b - a) * fx
  const bot = c + (d - c) * fx
  return top + (bot - top) * fy
}

export function createWarp(sample: SampleElevation, h: number, tilePx: number): Warp {
  const lift = (txf: number, tyf: number): number => elevAtBilinear(txf, tyf, sample) * h
  const unproject = (flatPxX: number, flatPxY: number): { x: number; y: number } => {
    const txf = flatPxX / tilePx // X n'est jamais cisaillé → exact.
    // flatPxY = tyVrai·tilePx − elev(txf, tyVrai)·h. elev ∈ [0,1] ⇒ lift ∈ [0,h]
    // ⇒ tyVrai ∈ [flatPxY/tile, flatPxY/tile + h/tile]. screenY(ty) monotone
    // croissant (garde anti-repli) → bissection sur cet encadrement.
    const lo0 = flatPxY / tilePx
    let lo = lo0
    let hi = lo0 + h / tilePx
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      const screenY = mid * tilePx - lift(txf, mid)
      if (screenY < flatPxY) lo = mid
      else hi = mid
    }
    return { x: flatPxX, y: ((lo + hi) / 2) * tilePx }
  }
  return { lift, unproject, h }
}

/** Gradient d'élévation maximal vers le SUD (ty croissant). `H·ce gradient <
 *  tilePx` garantit `screenY` monotone donc l'absence de repli. */
export function maxSouthGradient(elevation: number[], width: number, height: number): number {
  let max = 0
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const g = elevation[(y + 1) * width + x]! - elevation[y * width + x]!
      if (g > max) max = g
    }
  }
  return max
}

/** Assert de dev : le `H` visé ne replie jamais le sol sur ce champ. */
export function assertNoFold(
  elevation: number[],
  width: number,
  height: number,
  h: number,
  tilePx: number,
): void {
  const g = maxSouthGradient(elevation, width, height)
  if (g * h >= tilePx) {
    throw new Error(
      `relief: H=${h} replie le sol (gradient sud max ${g}, H·g=${g * h} ≥ tile ${tilePx}). ` +
        `Baisse RELIEF_H ou adoucis la pente sud.`,
    )
  }
}
```

- [ ] **Step 4 : Corriger l'import de test**

Dans `warp.test.ts` Step 1, l'import de `SampleElevation` doit être `'./hillshade'` (même dossier). Corriger si nécessaire.

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run: `pnpm --filter @braises/client test warp`
Expected: PASS (tous les `describe`).

- [ ] **Step 6 : Commit**

```bash
git add packages/client/src/render/warp.ts packages/client/src/render/warp.test.ts
git commit -m "feat(client): warp.ts — projection continue du relief + picking exact + garde anti-repli"
```

---

### Task 2 : Ouvrir la vallée vers le sud (gen `/sim`)

**Files:**
- Modify: `packages/sim/src/alpinegen.ts` (`computeElevation` ~L52, `computeFlowField` ~L84)
- Test: `packages/sim/src/alpinegen.test.ts`

**Interfaces:**
- Consumes : rien de neuf.
- Produces : `computeElevation`/`computeFlowField` inchangés en signature ; le champ produit a une **bordure sud basse** (l'altitude au centre-sud ≈ fond, pas un mur).

**Contexte :** aujourd'hui `edge = Math.min(x, y, width-1-x, height-1-y)` fait une cuvette scellée sur 4 côtés. On **exclut le sud** (grand `y`, bord bas de l'écran = vers la caméra) du calcul de distance au bord, de sorte que ni la forme de vallée ni l'enceinte `rim` ne montent au sud.

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// Ajouter dans packages/sim/src/alpinegen.test.ts
import { computeElevation } from './alpinegen'

describe('vallée ouverte au sud (relief continu)', () => {
  it('le centre-sud est BAS, le centre-nord reste HAUT', () => {
    const W = 120, H = 180, seed = 42
    const el = computeElevation(W, H, seed)
    const at = (x: number, y: number) => el[y * W + x]!
    const cx = Math.floor(W / 2)
    const south = at(cx, H - 1) // bord bas (vers la caméra)
    const north = at(cx, 0) // bord haut
    expect(south).toBeLessThan(0.35) // ouvert : proche du fond
    expect(north).toBeGreaterThan(0.7) // mur du fond conservé
  })

  it('les flancs est/ouest restent hauts', () => {
    const W = 120, H = 180, seed = 7
    const el = computeElevation(W, H, seed)
    const at = (x: number, y: number) => el[y * W + x]!
    const cy = Math.floor(H / 2)
    expect(at(0, cy)).toBeGreaterThan(0.7)
    expect(at(W - 1, cy)).toBeGreaterThan(0.7)
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm --filter @braises/sim test alpinegen`
Expected: FAIL — `south` est haut (mur sud actuel).

- [ ] **Step 3 : Modifier `computeElevation`**

Dans `packages/sim/src/alpinegen.ts`, remplacer la ligne du `edge` (L52) :

```ts
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y)
```

par (sud exclu — le bord bas de l'écran s'ouvre vers la caméra) :

```ts
      // Sud EXCLU (grand y = bord bas = vers la caméra) : la vallée s'ouvre de ce
      // côté, ni forme de vallée ni enceinte n'y montent → zéro repli du warp
      // (spec relief-continu §3). Fermeture sud = bord de carte (déjà bornant).
      const edge = Math.min(x, y, width - 1 - x)
```

- [ ] **Step 4 : Modifier `computeFlowField` à l'identique**

Dans le même fichier, `computeFlowField` (~L84) porte la MÊME ligne `edge`. La remplacer par la même expression `Math.min(x, y, width - 1 - x)` (avec le même commentaire court), pour que l'hydrologie reste cohérente avec le relief.

- [ ] **Step 5 : Lancer les tests, vérifier le succès et réparer les goldens**

Run: `pnpm --filter @braises/sim test alpinegen`
Expected: les deux nouveaux tests PASS. **D'autres tests d'alpinegen peuvent casser** s'ils affirment une symétrie de cuvette (4 bords hauts). Pour chacun : si l'assertion suppose un bord sud haut, la corriger pour refléter le sud ouvert (bord sud non testé, ou testé bas). Ne PAS affaiblir les assertions d'ordre structurel des bandes (prairie→forêt→éboulis→roche→neige par altitude) : elles restent valides, la neige est juste absente au sud.

- [ ] **Step 6 : Suite complète `/sim` verte**

Run: `pnpm --filter @braises/sim test`
Expected: PASS, dont `replay.test.ts` et `events.test.ts` (même seed → même monde → même flux).

- [ ] **Step 7 : Commit**

```bash
git add packages/sim/src/alpinegen.ts packages/sim/src/alpinegen.test.ts
git commit -m "feat(sim): la vallée s'ouvre au sud — prérequis du relief continu sans repli"
```

---

### Task 3 : La constante `H` et la garde au boot

**Files:**
- Modify: `packages/client/src/render/framing.ts` (ajouter `RELIEF_H`)
- Modify: `packages/client/src/scenes/WorldScene.ts` (`onReady`, créer `this.warp` + `assertNoFold`)

**Interfaces:**
- Consumes : `createWarp`, `assertNoFold` (Task 1) ; `SampleElevation` (`hillshade.ts`).
- Produces : `RELIEF_H: number` (framing) ; `WorldScene.warp: Warp` (champ privé, créé dans `onReady`, source du rendu et du picking pour les Tasks 4-6).

- [ ] **Step 1 : Ajouter la constante**

Dans `packages/client/src/render/framing.ts`, après `TILE_PX` (L13) :

```ts
/** Relief continu — hauteur ÉCRAN (px) d'une unité d'élévation [0,1] pleine.
 * Purement visuel (jamais dans /sim). Calibré en jeu, comme TREE_JITTER_TILES :
 * grand = relief spectaculaire mais borné par la garde anti-repli
 * (H·pente_sud_max < TILE_PX) ; départ prudent. */
export const RELIEF_H = 40
```

- [ ] **Step 2 : Créer le warp au boot, avec garde**

Dans `WorldScene.ts`, repérer l'échantillonneur `sampleElev` déjà présent dans `bakeMapTexture` (L475). Extraire un helper de classe réutilisable et créer le warp dans `onReady` juste après `this.map = msg.map` (L252) :

```ts
  // Échantillonneur d'altitude clampé aux bords — partagé bake/warp/hillshade.
  private sampleElevation(tx: number, ty: number): number {
    const { width, height } = this.map
    const cx = tx < 0 ? 0 : tx >= width ? width - 1 : tx
    const cy = ty < 0 ? 0 : ty >= height ? height - 1 : ty
    return this.map.elevation?.[cy * width + cx] ?? 0
  }
```

Puis dans `onReady`, après `this.map = msg.map` :

```ts
    // Garde anti-repli : un H trop grand replierait le sol sur les pentes sud.
    if (this.map.elevation) {
      assertNoFold(this.map.elevation, this.map.width, this.map.height, RELIEF_H, TILE_PX)
    }
    this.warp = createWarp((tx, ty) => this.sampleElevation(tx, ty), RELIEF_H, TILE_PX)
```

Déclarer le champ dans la classe : `private warp!: import('../render/warp').Warp` (ou import nommé en tête de fichier : `import { createWarp, assertNoFold, type Warp } from '../render/warp'` et `private warp!: Warp`). Importer aussi `RELIEF_H` depuis `framing`.

- [ ] **Step 3 : Vérifier check + build**

Run: `pnpm --filter @braises/client check && pnpm --filter @braises/client build`
Expected: PASS (aucun repli lancé à la génération de la vallée ouverte au sud).

- [ ] **Step 4 : Commit**

```bash
git add packages/client/src/render/framing.ts packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): constante RELIEF_H + warp créé au boot avec garde anti-repli"
```

---

### Task 4 : Le sol se déforme — `Mesh2D` fenêtré, texturé par le bake

**Files:**
- Create: `packages/client/src/scenes/world/ground-layer.ts`
- Modify: `packages/client/src/scenes/WorldScene.ts` (remplacer l'image `map-demo` par la couche ; garder `bakeMapTexture` comme source de texture ; appeler le rendu par frame)
- Test: `packages/client/src/scenes/world/ground-layer.test.ts` (géométrie de grille pure)

**Interfaces:**
- Consumes : `Warp.lift` (Task 1) ; `map.width`/`map.height` ; la texture `map-demo` déjà cuite par `WorldScene.bakeMapTexture` (aplat 1 px/tuile).
- Produces :
  - `gridMesh(tx0, ty0, tx1, ty1, lift, tilePx, mapW, mapH): { vertices: number[]; indices: number[] }` (pur, testable) — sommets `x,y,u,v` (step 4) + indices `a,b,c,page` (step 4) d'une fenêtre de grille déformée.
  - `class GroundLayer { constructor(scene, map, warp, textureKey); render(camera): void; destroy(): void }`

**Décision (révisée vs Graphics) :** on rend le sol en `Phaser.GameObjects.Mesh2D` — une grille de sommets `x,y,u,v` déformée par `lift`, texturée par le bake `map-demo` EXISTANT (on garde `bakeMapTexture`). Deux raisons : (1) c'est la primitive du chemin artistique — de vraies tuiles Aseprite plus tard = un **échange de texture**, pas une réécriture ; (2) le filtrage LINÉAIRE interpole les couleurs du bake sur les versants → ombrage **lisse**, pas facetté (ce que `Graphics` en aplats ne peut pas). API confirmée : `add.mesh2d(x, y, texture, vertices, indices)`, sommet = `x,y,u,v` (pas de couleur par sommet — l'ombrage vient de la texture). Vertex-shader statique = optimisation différée (spec §4.1).

- [ ] **Step 1 : Écrire le test de géométrie (pur)**

```ts
// packages/client/src/scenes/world/ground-layer.test.ts
import { describe, expect, it } from 'vitest'
import { gridMesh } from './ground-layer'

describe('gridMesh', () => {
  it('fenêtre 1×1 plate : 4 sommets (x,y,u,v), 2 triangles', () => {
    // carte 10×10, tuile 16, lift nul. Fenêtre = la seule tuile (2,3).
    const m = gridMesh(2, 3, 2, 3, () => 0, 16, 10, 10)
    // 4 sommets × 4 composantes = 16 nombres.
    expect(m.vertices).toHaveLength(16)
    // coin haut-gauche (gx=2,gy=3) : x=32, y=48, u=0.2, v=0.3
    expect(m.vertices.slice(0, 4)).toEqual([32, 48, 0.2, 0.3])
    // coin bas-droite (gx=3,gy=4) est le 4e sommet : x=48, y=64, u=0.3, v=0.4
    expect(m.vertices.slice(12, 16)).toEqual([48, 64, 0.3, 0.4])
    // 2 triangles × (a,b,c,page) = 8 indices.
    expect(m.indices).toHaveLength(8)
  })

  it('les sommets remontent de lift', () => {
    const lift = (x: number, y: number) => (x === 2 && y === 3 ? 10 : 0)
    const m = gridMesh(2, 3, 2, 3, lift, 16, 10, 10)
    expect(m.vertices[1]).toBe(38) // y du coin (2,3) = 48 − 10
    expect(m.vertices[5]).toBe(48) // y du coin (3,3) = 48 − 0
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm --filter @braises/client test ground-layer`
Expected: FAIL — module absent.

- [ ] **Step 3 : Écrire `ground-layer.ts`**

```ts
// packages/client/src/scenes/world/ground-layer.ts
/**
 * Le sol qui se DÉFORME : un `Mesh2D` dont les sommets sont soulevés par
 * l'élévation (spec relief-continu §4.1). Remplace l'image `map-demo` plate,
 * mais RÉUTILISE sa texture (le bake 1 px/tuile) — UV-mappée sur la grille
 * déformée. En filtrage linéaire, les couleurs du bake s'interpolent sur les
 * versants → ombrage lisse. De vraies tuiles plus tard = un échange de texture.
 *
 * Rendu FENÊTRÉ à la vue (comme les nœuds) : coût borné à l'écran. Les sommets
 * sont aux coins ENTIERS (partagés entre tuiles voisines) → surface continue,
 * sans couture. AUCUNE logique de jeu ici — rendu pur d'état reçu.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import type { Warp } from '../../render/warp'

/** Sommets `x,y,u,v` (step 4) + indices `a,b,c,page` (step 4) d'une fenêtre de
 *  grille [tx0..tx1]×[ty0..ty1], déformée par `lift` (px) aux coins ENTIERS.
 *  UV = coin/dimension carte → échantillonne la texture `map-demo`. */
export function gridMesh(
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  lift: (x: number, y: number) => number,
  tilePx: number,
  mapW: number,
  mapH: number,
): { vertices: number[]; indices: number[] } {
  const cols = tx1 - tx0 + 1
  const rows = ty1 - ty0 + 1
  const vertsPerRow = cols + 1
  const vertices: number[] = []
  for (let gy = ty0; gy <= ty1 + 1; gy++) {
    for (let gx = tx0; gx <= tx1 + 1; gx++) {
      vertices.push(gx * tilePx, gy * tilePx - lift(gx, gy), gx / mapW, gy / mapH)
    }
  }
  const indices: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * vertsPerRow + c
      const b = a + 1
      const d = a + vertsPerRow
      const e = d + 1
      indices.push(a, b, e, 0, a, e, d, 0) // deux triangles, page 0
    }
  }
  return { vertices, indices }
}

export class GroundLayer {
  private mesh: Phaser.GameObjects.Mesh2D

  constructor(
    scene: Phaser.Scene,
    private map: WorldMap,
    private warp: Warp,
    textureKey: string,
  ) {
    this.mesh = scene.add.mesh2d(0, 0, textureKey, [], []).setDepth(GROUND_MAP_DEPTH)
    // Linéaire : interpole les couleurs du bake sur les versants (ombrage lisse).
    // Levier de calibration en jeu — NEAREST rend croustillant mais facetté.
    scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.LINEAR)
  }

  /** Reconstruit la grille de la fenêtre visible, chaque frame. */
  render(camera: Phaser.Cameras.Scene2D.Camera): void {
    const { width, height } = this.map
    const v = camera.worldView
    // Marge basse généreuse : les tuiles hautes du fond montent dans la vue.
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 64)
    const m = gridMesh(tx0, ty0, tx1, ty1, (x, y) => this.warp.lift(x, y), TILE_PX, width, height)
    this.mesh.vertices = m.vertices
    this.mesh.indices = m.indices
  }

  destroy(): void {
    this.mesh.destroy()
  }
}
```

- [ ] **Step 4 : Brancher dans `WorldScene`**

Dans `onReady`, GARDER `this.bakeMapTexture()` (L259 — il produit la texture `map-demo`), et remplacer la ligne de l'image plate (L260) :

```ts
    this.add.image(0, 0, 'map-demo').setOrigin(0).setDepth(GROUND_MAP_DEPTH).setDisplaySize(worldW, worldH)
```

par :

```ts
    this.ground = new GroundLayer(this, this.map, this.warp, 'map-demo')
```

Déclarer `private ground!: GroundLayer` et importer `GroundLayer`. Dans la boucle `update` (là où `this.clutter`/`this.cliffs` sont rendus, ~L326), ajouter :

```ts
    this.ground.render(this.cameras.main)
```

- [ ] **Step 5 : Rafraîchissement du `Mesh2D` — à confirmer en jeu**

Après `this.mesh.vertices = …` / `this.mesh.indices = …`, vérifier que `Mesh2D` re-rend bien la nouvelle géométrie. Si un cache d'indices (`indicesOrdered`/`useOrderedIndices`) l'empêche, forcer le rafraîchissement selon l'API 4.2 (le champ existe sur la classe — `grep -n "indicesOrdered\|useOrderedIndices\|dirty" node_modules/.pnpm/phaser@4.2.0/node_modules/phaser/types/phaser.d.ts`). Le mesh est petit (~2800 sommets) : à défaut, le recréer par frame reste acceptable.

- [ ] **Step 6 : Test unitaire + check + build**

Run: `pnpm --filter @braises/client test ground-layer && pnpm --filter @braises/client check && pnpm --filter @braises/client build`
Expected: PASS.

- [ ] **Step 7 : Vérification EN JEU (obligatoire, rendu)**

Suivre la mémoire `browser-smoke-test` (build+preview, Chromium via playwright-core de demo, piloter par `window.__BRAISES__`). Capturer une vue de versant. Attendu : le sol **ondule** (les pentes se lisent), ombrage lisse, pas de couture, pas de repli. Le décor/nœuds/acteurs restent à plat pour l'instant (Task 5) — état WIP visuel normal. Comparer LINEAR vs NEAREST sur une capture ; noter le choix (calibration, spec §7).

- [ ] **Step 8 : Commit**

```bash
git add packages/client/src/scenes/world/ground-layer.ts packages/client/src/scenes/world/ground-layer.test.ts packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): le sol se déforme — Mesh2D fenêtré texturé par le bake"
```

---

### Task 5 : Soulever les billboards du même `lift`

**Files:**
- Modify: `packages/client/src/scenes/world/snapshot-view.ts` (acteurs, arbres+houppiers, structures, cadavres)
- Modify: `packages/client/src/scenes/WorldScene.ts` (passer `warp` à la vue ; fantôme de construction)

**Interfaces:**
- Consumes : `Warp.lift` (Task 1) ; `BALANCE.AVATAR_HITBOX_TILES`, `treeJitter`.
- Produces : `SnapshotView.setWarp(warp: Warp): void` ; tous les billboards rendus à `py − lift(pied)`.

**Principe :** chaque sprite ancré PIEDS voit son `py` diminué de `lift(txFoot, tyFoot)`, où `(txFoot, tyFoot)` est la position monde (tuiles) de ses pieds. Le tri `depth` reste `ySortDepth(worldY)` — inchangé (spec §4.3).

- [ ] **Step 1 : Ajouter `setWarp` et l'appliquer dans `syncActor`**

Dans `snapshot-view.ts`, ajouter un champ et un setter à `SnapshotView` :

```ts
  private warp?: import('../../render/warp').Warp
  setWarp(warp: import('../../render/warp').Warp): void {
    this.warp = warp
  }
```

Modifier `syncActor` (L113) — soustraire le lift au pied de l'acteur :

```ts
  syncActor(sprite: Phaser.GameObjects.Image, x: number, y: number, textureKey: string): void {
    const footprint = ACTOR_FOOTPRINTS[textureKey] ?? DEFAULT_FOOTPRINT
    const p = actorPlacement(x, y, footprint, TILE_PX, BALANCE.AVATAR_HITBOX_TILES)
    const feetY = y + BALANCE.AVATAR_HITBOX_TILES / 2
    const lift = this.warp?.lift(x, feetY) ?? 0
    sprite.setPosition(p.px, p.py - lift)
    sprite.setDepth(p.depth)
    sprite.setDisplaySize(p.displayW, p.displayH)
  }
```

- [ ] **Step 2 : Soulever troncs, houppiers et cadavres**

Dans `renderNodes` (L270), après le calcul de `px`/`py`, soustraire le lift au pied réel de l'arbre `(tx + 0.5 + j.dx, ty + 1 + j.dy)` :

```ts
        const lift = this.warp?.lift(tx + 0.5 + j.dx, ty + 1 + j.dy) ?? 0
        sprite.setPosition(px, py - lift)
```

et pour le houppier (L289) :

```ts
        crown.setPosition(px, py - 16 - lift)
```

Dans `syncStructures` (L187-191), soulever l'ancre au pied de la structure `(s.tx + 0.5, s.ty + 1)` :

```ts
        const a = tileFeetAnchor(s.tx, s.ty, TILE_PX)
        const lift = this.warp?.lift(s.tx + 0.5, s.ty + 1) ?? 0
        sprite = this.scene.add
          .image(a.px, a.py - lift, `st-${s.type}`)
```

(La structure est statique : appliquer le lift à la création suffit.) Dans `syncCorpses` (L313), soulever aussi :

```ts
        const lift = this.warp?.lift(c.x, c.y) ?? 0
        const sprite = this.scene.add
          .image(c.x * TILE_PX, c.y * TILE_PX - lift, 'spr-corpse')
```

- [ ] **Step 3 : Câbler `setWarp` et soulever le fantôme**

Dans `WorldScene.onReady`, après création du warp et de la vue, appeler `this.view.setWarp(this.warp)`. Le fantôme de construction (L329) suit le pointeur aligné à la grille — le soulever à la tuile visée :

```ts
    const gx = Math.floor(pw.x / TILE_PX)
    const gy = Math.floor(pw.y / TILE_PX)
    const glift = this.warp.lift(gx + 0.5, gy + 1)
    this.ghost.setPosition(gx * TILE_PX, gy * TILE_PX - glift)
```

(Note : `pw` reste le point plat ici ; le picking exact du fantôme vient en Task 6, qui remplace `pw`.)

- [ ] **Step 4 : Check + build**

Run: `pnpm --filter @braises/client check && pnpm --filter @braises/client build`
Expected: PASS.

- [ ] **Step 5 : Vérification EN JEU**

Capture d'un arbre sur un versant : le tronc **monte avec le sol sous lui** (plus de flottement), le houppier suit. Un acteur qui marche sur la pente épouse la surface. Comparer avant/après à la même tuile.

- [ ] **Step 6 : Commit**

```bash
git add packages/client/src/scenes/world/snapshot-view.ts packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): les billboards se soulèvent du relief — sol et acteurs cohérents"
```

---

### Task 6 : Basculer le picking sur `unproject`

**Files:**
- Modify: `packages/client/src/scenes/world/input-bindings.ts` (`pointerToWorld` ~L44)
- Modify: `packages/client/src/scenes/WorldScene.ts` (fantôme : utiliser `unproject`)

**Interfaces:**
- Consumes : `Warp.unproject` (Task 1). Le warp doit être atteignable depuis `input-bindings` — l'exposer via les `deps` de `installInputBindings` (repérer la fabrique de deps dans `WorldScene`).
- Produces : `pointerToWorld` renvoie désormais la position monde CORRIGÉE de l'élévation (px), consommée telle quelle par les appelants (visée, réparation, placement) qui divisent déjà par `TILE_PX`.

**Principe :** `positionToCamera` rend la position monde PLATE `(flatX, flatY)`. Comme le warp a soulevé tout le rendu de `elev·H`, cette position plate est exactement `screenY` en espace-monde → `unproject(flatX, flatY)` rend la tuile réellement visée. X est déjà exact.

- [ ] **Step 1 : Exposer `unproject` aux deps d'input**

Dans `WorldScene`, là où les `deps` de `installInputBindings` sont construits, ajouter :

```ts
      unproject: (px: number, py: number) => this.warp.unproject(px, py),
```

et étendre le type `deps` correspondant avec `unproject: (px: number, py: number) => { x: number; y: number }`.

- [ ] **Step 2 : Réécrire `pointerToWorld`**

Dans `input-bindings.ts`, remplacer (L44-45) :

```ts
  const pointerToWorld = (pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 =>
    pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2
```

par :

```ts
  // Le pointeur en monde PLAT, puis corrigé de l'élévation : la tuile réellement
  // SOUS le curseur, pas celle du sol non déformé (spec relief-continu §4.4).
  const pointerToWorld = (pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 => {
    const flat = pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2
    const w = deps.unproject(flat.x, flat.y)
    return new Phaser.Math.Vector2(w.x, w.y)
  }
```

- [ ] **Step 3 : Corriger le fantôme dans `WorldScene`**

Remplacer le bloc fantôme de la Task 5 Step 3 par une version qui part de `unproject` :

```ts
    const pw = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
    const world = this.warp.unproject(pw.x, pw.y)
    const gx = Math.floor(world.x / TILE_PX)
    const gy = Math.floor(world.y / TILE_PX)
    this.ghost.setPosition(gx * TILE_PX, gy * TILE_PX - this.warp.lift(gx + 0.5, gy + 1))
```

- [ ] **Step 4 : Check + build**

Run: `pnpm --filter @braises/client check && pnpm --filter @braises/client build`
Expected: PASS.

- [ ] **Step 5 : Vérification EN JEU (parité picking)**

Sur un versant, viser une tuile précise et attaquer/placer : la cible tombe sur la tuile **visuellement sous le curseur**, pas décalée verticalement. Le fantôme de construction se pose exactement sur la tuile survolée, épousant le relief. Mesurer avant/après à graine égale.

- [ ] **Step 6 : Commit**

```bash
git add packages/client/src/scenes/world/input-bindings.ts packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): picking exact sur le relief — pointerToWorld passe par unproject"
```

---

### Task 7 : Mettre les falaises et les paliers à la retraite

**Files:**
- Delete: `packages/client/src/render/cliffs.ts`, `packages/client/src/render/cliffs.test.ts`
- Delete: `packages/client/src/scenes/world/cliff-layer.ts`
- Delete: `packages/sim/src/terrace.ts`, `packages/sim/src/terrace.test.ts`
- Modify: `packages/client/src/render/hillshade.ts` (retirer `stepShadeAt`, `SampleLevel`, `STEP_SHADE`) + `hillshade.test.ts`
- Modify: `packages/client/src/scenes/WorldScene.ts` (retirer `bakeCliffTextures`, `CliffLayer`, tout usage)
- Modify: `packages/sim/src/index.ts` (retirer les exports `computeLevel`/`smoothField` si présents)
- Modify: `packages/sim/src/map.ts` (retirer le champ `level` s'il n'a plus de consommateur), `alpinegen.ts` (retirer l'appel à `computeLevel`)

**Interfaces:**
- Consumes : rien.
- Produces : plus aucune référence à `cliff*`, `terrace`, `computeLevel`, `stepShadeAt`, `map.level`.

- [ ] **Step 1 : Recenser les consommateurs avant de couper**

Run: `grep -rnE "cliff|Cliff|terrace|computeLevel|smoothField|stepShade|SampleLevel|\.level\b|map\.level|bakeCliff" packages/ --include=*.ts | grep -v test`
Lire chaque résultat. Confirmer que `map.level` n'a pas d'autre usage que les falaises (sinon, s'arrêter et réévaluer avec Alexis avant suppression).

- [ ] **Step 2 : Supprimer les fichiers falaise/terrasse**

```bash
git rm packages/client/src/render/cliffs.ts packages/client/src/render/cliffs.test.ts \
       packages/client/src/scenes/world/cliff-layer.ts \
       packages/sim/src/terrace.ts packages/sim/src/terrace.test.ts
```

- [ ] **Step 3 : Retirer `stepShadeAt` du hillshade**

Dans `packages/client/src/render/hillshade.ts`, supprimer `stepShadeAt`, `SampleLevel` et `STEP_SHADE` (garder `hillshadeAt`, `SampleElevation`, `HILLSHADE_*`). Dans `hillshade.test.ts`, supprimer les tests de `stepShadeAt`.

- [ ] **Step 4 : Nettoyer `WorldScene`**

Retirer : l'import et le champ `CliffLayer`/`cliffs`, l'appel `this.bakeCliffTextures()` (L264), `this.cliffs = new CliffLayer(...)` (L265), le rendu `this.cliffs.render(...)` dans `update`, la méthode `bakeCliffTextures` (L500-530), et les imports devenus inutiles (`faceHeightPx`, `MAX_DROP`, `STEP_PX`, `SIDE_PX`, `stepShadeAt`, `SampleLevel`).

**GARDER `bakeMapTexture`** (elle produit la texture `map-demo` que le `Mesh2D` de la Task 4 échantillonne), mais la SIMPLIFIER : retirer l'échantillonneur `sampleLevel` et le facteur `stepShadeAt`, de sorte que le relief ne soit plus que l'ombrage de pente :

```ts
        const relief = hillshadeAt(tx, ty, sampleElev) // plus de stepShadeAt : relief continu
```

- [ ] **Step 5 : Nettoyer `/sim`**

Dans `alpinegen.ts` `generateAlpineTerrain`, retirer la ligne qui calcule `map.level = computeLevel(...)`. Dans `map.ts`, retirer le champ `level?` de l'interface `WorldMap` (confirmé sans consommateur au Step 1). Dans `index.ts`, retirer les réexports de `terrace`/`computeLevel`.

- [ ] **Step 6 : Tout vert**

Run: `pnpm check && pnpm lint && pnpm test && pnpm build`
Expected: PASS partout, zéro référence morte, zéro import inutilisé (le lint le garantit).

- [ ] **Step 7 : Vérification EN JEU finale**

Capture d'ensemble : le relief se lit **entièrement par la déformation continue** (aucune paroi verticale nulle part), la vallée s'ouvre vers la caméra, murs du fond et flancs en versants qui montent, picking exact sur les pentes. Artefact 2×2 (mémoire `artifact-images-preference`) : vue large, versant proche, arbres sur pente, visée sur versant.

- [ ] **Step 8 : Commit**

```bash
git add -A
git commit -m "refactor: retraite des falaises et des paliers — le relief est désormais continu"
```

---

## Self-review (couverture spec)

- Spec §2 (Y-shear) → Task 1 (`lift`/`projectY` via `lift`) + Task 4 (tracé). ✅
- Spec §3 (vallée ouverte au sud) → Task 2. ✅
- Spec §4.1 (sol GPU fenêtré) → Task 4 (`Mesh2D` texturé par le bake ; vertex-shader statique différé). ✅
- Spec §4.2 (billboards soulevés) → Task 5. ✅
- Spec §4.3 (Y-sort inchangé) → Tasks 4-5 ne touchent que `py`, jamais `depth`. ✅
- Spec §4.4 (picking exact) → Task 1 (`unproject`) + Task 6 (bascule). ✅
- Spec §5 (retraite) → Task 7. ✅
- Spec §6 (garde anti-repli) → Task 1 (`assertNoFold`) + Task 3 (au boot). ✅
- Spec §7 (art ouvert) → v1 `Mesh2D` texturé par le bake, art-neutre ; de vraies tuiles = échange de texture (Task 4). Filtrage LINEAR/NEAREST = levier de calibration. ✅
- Spec §8 (invariants) → warp client-only ; Task 2 pure/déterministe, goldens + replay/events verts. ✅
- Spec §9 critères → tests warp (T1), gen (T2), en jeu (T4/T5/T6/T7). ✅

**Correction actée vs spec :** `H` vit côté client (`framing.ts`), pas dans `BALANCE` — le sim est pur, sans px d'écran (la spec disait « BALANCE », lapsus). **Choix de primitive (Task 4) :** `Mesh2D` texturé par le bake `map-demo`, PAS `Graphics` en aplats — l'API 4.2 est confirmée (`add.mesh2d`, sommet `x,y,u,v`), c'est la primitive du futur art tuilé (échange de texture, pas réécriture) et le filtrage linéaire donne un ombrage lisse non facetté. On garde `bakeMapTexture` comme source de texture.
