# Lumière & ambiance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au client une lumière et une ambiance réalistes — teinte selon l'heure (heure dorée matin/soir, nuit bleutée lisible), pénombre locale sous le couvert forestier, et îlots chauds autour des Feux.

**Architecture:** 100 % rendu client, `/sim` intact. Un module pur `render/lighting.ts` (testé comme `framing.ts`) fournit les courbes ; trois couches composées dans `WorldScene` au-dessus des sprites — pénombre de canopée (texture cuite), teinte d'ambiance (rectangle monde), halos additifs des Feux — plus le nettoyage de l'ancien overlay de nuit dans `UIScene`.

**Tech Stack:** TypeScript, Phaser 4, Vitest. Rendu par textures générées au boot (pattern R8), blend `ADD` pour les halos, `createRadialGradient` (canvas) pour la texture de halo.

## Global Constraints

- **`/sim` intact** — aucune modification de `packages/sim`. La lumière ne consomme que `GameTime.hourOfCycle`, `WorldMap.terrain`, et les structures `fire` + `villages[].warmth` du snapshot.
- **Ambiance purement visuelle** — non-autoritative, aucune conséquence de gameplay.
- **Math libre côté client** — `Math.sin`/`floor`/`round`/gradients autorisés (l'interdit des approximations est *sim-only*).
- **Convention couleur du Feu (existante, à réutiliser telle quelle)** : `warmth > 0` → **bleu** (Foyer), `warmth < 0` → **rouge** (Meute), `0` → blanc. Formule exacte dans `snapshot-view.ts:167-171`.
- **Horloge murale** (déjà en place) : `hourOfCycle ∈ [0,24)`, aube 6 h, midi 12 h, nuit 21 h → 6 h.
- **Constantes de rendu** : nommées dans le module client (pas dans `balance.ts`, qui est réservé au `/sim`), comme les constantes de `framing.ts`.
- Verts obligatoires avant tout commit final : `pnpm check`, `pnpm test`, `pnpm lint`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/client/src/render/lighting.ts` | **NOUVEAU** — fonctions pures : `warmthColor`, `ambientTint`, `daylight`, `canopyDensity`, `canopyStrength`, `fireGlow`, constante `NIGHT_ALPHA_MAX`. |
| `packages/client/src/render/lighting.test.ts` | **NOUVEAU** — tests unitaires des courbes. |
| `packages/client/src/scenes/BootScene.ts` | **MODIF** — génère la texture `glow` (dégradé radial). |
| `packages/client/src/scenes/world/fire-glow.ts` | **NOUVEAU** — sprites de halo additifs par Feu (cycle de vie par diff `seen`). |
| `packages/client/src/scenes/WorldScene.ts` | **MODIF** — cuisson texture `canopy`, image canopée + rectangle d'ambiance, stockage `lastTime`, pilotage des 3 couches chaque frame. |
| `packages/client/src/scenes/world/snapshot-view.ts` | **MODIF** — réutilise `warmthColor` (DRY) pour le tint du Feu. |
| `packages/client/src/scenes/UIScene.ts` | **MODIF** — retire `nightAlpha`/`nightOverlay` (l'ambiance passe dans WorldScene) ; l'alarme obtient son propre overlay rouge dédié. |

---

## Task 1: Module pur `lighting.ts` — scalaires (warmthColor, daylight, canopy)

**Files:**
- Create: `packages/client/src/render/lighting.ts`
- Test: `packages/client/src/render/lighting.test.ts`

**Interfaces:**
- Consumes: rien (module racine, pur).
- Produces :
  - `NIGHT_ALPHA_MAX: number`
  - `warmthColor(warmth: number): number` — couleur packée `0xRRGGBB`.
  - `daylight(hour: number): number` — facteur ∈ [0,1].
  - `canopyDensity(terrain: number): number` — densité de couvert ∈ [0,~0.45].
  - `canopyStrength(day: number): number` — opacité globale de la couche canopée.
  - (interne, non exporté) `lerp`, `lerpColor`, `bracket`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/lighting.test.ts
import { describe, expect, it } from 'vitest'
import { canopyDensity, canopyStrength, daylight, warmthColor } from './lighting'

const r = (c: number): number => (c >> 16) & 0xff
const b = (c: number): number => c & 0xff

describe('warmthColor (convention Feu existante)', () => {
  it('warmth positif → bleu (Foyer)', () => {
    const c = warmthColor(80)
    expect(b(c)).toBeGreaterThan(r(c))
  })
  it('warmth négatif → rouge (Meute)', () => {
    const c = warmthColor(-80)
    expect(r(c)).toBeGreaterThan(b(c))
  })
  it('warmth nul → blanc', () => {
    expect(warmthColor(0)).toBe(0xffffff)
  })
})

describe('daylight (facteur de lumière du jour)', () => {
  it('borné dans [0,1]', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = daylight(h)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
  it('≈ 0 à minuit, ≈ 1 à midi', () => {
    expect(daylight(0)).toBeCloseTo(0, 5)
    expect(daylight(12)).toBeCloseTo(1, 5)
  })
  it('croît (au sens large) de minuit vers midi', () => {
    let prev = -1
    for (const h of [0, 3, 6, 9, 12]) {
      const d = daylight(h)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })
})

describe('canopyDensity / canopyStrength', () => {
  it('forêt > marais > ciel ouvert', () => {
    expect(canopyDensity(3)).toBeGreaterThan(canopyDensity(8))
    expect(canopyDensity(8)).toBeGreaterThan(canopyDensity(1))
    expect(canopyDensity(1)).toBe(0)
  })
  it('la canopée est plus opaque de jour que de nuit', () => {
    expect(canopyStrength(1)).toBeGreaterThan(canopyStrength(0))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @braises/client exec vitest run src/render/lighting.test.ts`
Expected: FAIL — `Failed to resolve import "./lighting"` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/render/lighting.ts
/**
 * Lumière & ambiance — fonctions PURES de l'heure murale et du terrain.
 * Aucune dépendance Phaser : testé en unitaire (lighting.test.ts), comme
 * framing.ts. Le rendu (couches, blend) vit dans les scènes ; ici, uniquement
 * les courbes. Côté client, Math.sin/floor/round sont autorisés (l'interdit des
 * approximations est sim-only).
 */

/** Alpha maximal de la teinte de nuit — plafonné pour que la nuit reste lisible. */
export const NIGHT_ALPHA_MAX = 0.5

function lerp(a: number, c: number, t: number): number {
  return a + (c - a) * t
}

function lerpColor(c1: number, c2: number, t: number): number {
  const rr = Math.round(lerp((c1 >> 16) & 0xff, (c2 >> 16) & 0xff, t))
  const gg = Math.round(lerp((c1 >> 8) & 0xff, (c2 >> 8) & 0xff, t))
  const bb = Math.round(lerp(c1 & 0xff, c2 & 0xff, t))
  return (rr << 16) | (gg << 8) | bb
}

/** Paire de keyframes encadrant `hour` (horloge murale) + facteur d'interpolation. */
function bracket<T extends { hour: number }>(keys: T[], hour: number): { lo: T; hi: T; t: number } {
  const h = ((hour % 24) + 24) % 24
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i]
    const hi = keys[i + 1]
    if (h >= lo.hour && h <= hi.hour) {
      const span = hi.hour - lo.hour
      return { lo, hi, t: span === 0 ? 0 : (h - lo.hour) / span }
    }
  }
  const last = keys[keys.length - 1]
  return { lo: last, hi: last, t: 0 }
}

/**
 * Couleur du Feu selon l'alignement — MÊME formule que snapshot-view (DRY) :
 * warmth > 0 → bleu (Foyer), warmth < 0 → rouge (Meute), 0 → blanc.
 */
export function warmthColor(warmth: number): number {
  const t = Math.max(-1, Math.min(1, warmth / 100))
  const red = t > 0 ? Math.floor(255 - 130 * t) : 255
  const green = Math.floor(255 - 90 * Math.abs(t))
  const blue = t < 0 ? Math.floor(255 + 140 * t) : 255
  return (red << 16) | (green << 8) | blue
}

interface DayKey {
  hour: number
  value: number
}
/** Facteur de lumière du jour : 0 = nuit noire … 1 = plein midi. */
const DAYLIGHT_KEYS: DayKey[] = [
  { hour: 0, value: 0 },
  { hour: 5, value: 0 },
  { hour: 6, value: 0.15 },
  { hour: 8, value: 0.7 },
  { hour: 10, value: 1 },
  { hour: 15, value: 1 },
  { hour: 18, value: 0.7 },
  { hour: 20, value: 0.2 },
  { hour: 21, value: 0.05 },
  { hour: 24, value: 0 },
]

export function daylight(hour: number): number {
  const { lo, hi, t } = bracket(DAYLIGHT_KEYS, hour)
  return lerp(lo.value, hi.value, t)
}

/** Densité de couvert par code terrain sim (0 = ciel ouvert). */
export function canopyDensity(terrain: number): number {
  if (terrain === 3) return 0.45 // forêt
  if (terrain === 8) return 0.15 // marais
  return 0
}

/** Opacité globale de la couche canopée : l'ombre du sous-bois se lit surtout de jour. */
export function canopyStrength(day: number): number {
  return lerp(0.4, 1, day)
}

// `lerpColor` sert dès la Task 2 (ambientTint) ; exporté indirectement via elle.
export { lerpColor as _lerpColorForTasks }
```

> Note d'implémentation : `_lerpColorForTasks` n'est qu'un ré-export temporaire pour éviter un warning « unused » entre tasks. Il DISPARAÎT en Task 2 quand `ambientTint` consomme `lerpColor`. Si tu implémentes Task 1 et Task 2 d'affilée, saute ce ré-export et garde `lerpColor` privé.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @braises/client exec vitest run src/render/lighting.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/lighting.ts packages/client/src/render/lighting.test.ts
git commit -m "feat(client): lighting.ts — courbes pures (warmthColor, daylight, canopée)"
```

---

## Task 2: `ambientTint` — teinte d'ambiance selon l'heure

**Files:**
- Modify: `packages/client/src/render/lighting.ts`
- Test: `packages/client/src/render/lighting.test.ts`

**Interfaces:**
- Consumes: `lerp`, `lerpColor`, `bracket`, `NIGHT_ALPHA_MAX` (Task 1).
- Produces: `ambientTint(hour: number): { color: number; alpha: number }`.

- [ ] **Step 1: Write the failing test**

Ajouter à `lighting.test.ts` :

```ts
import { ambientTint, NIGHT_ALPHA_MAX } from './lighting'

describe('ambientTint (teinte selon l’heure)', () => {
  it('midi : aucune teinte (alpha ≈ 0)', () => {
    expect(ambientTint(12).alpha).toBeCloseTo(0, 2)
  })
  it('nuit profonde : alpha au plafond, couleur bleue froide', () => {
    const t = ambientTint(0)
    expect(t.alpha).toBeCloseTo(NIGHT_ALPHA_MAX, 5)
    expect(t.color & 0xff).toBeGreaterThan((t.color >> 16) & 0xff) // bleu > rouge
  })
  it('alpha ne dépasse jamais le plafond de nuit', () => {
    for (let h = 0; h < 24; h += 0.5) {
      expect(ambientTint(h).alpha).toBeLessThanOrEqual(NIGHT_ALPHA_MAX + 1e-9)
    }
  })
  it('aube (6 h) et crépuscule (20 h) : teinte chaude, alpha intermédiaire', () => {
    for (const h of [6, 20]) {
      const t = ambientTint(h)
      expect((t.color >> 16) & 0xff).toBeGreaterThan(t.color & 0xff) // rouge > bleu (chaud)
      expect(t.alpha).toBeGreaterThan(0)
      expect(t.alpha).toBeLessThan(NIGHT_ALPHA_MAX)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @braises/client exec vitest run src/render/lighting.test.ts`
Expected: FAIL — `ambientTint is not a function`.

- [ ] **Step 3: Write minimal implementation**

Dans `lighting.ts` : SUPPRIMER le ré-export temporaire `_lerpColorForTasks` (ligne finale de Task 1) et ajouter :

```ts
interface TintKey {
  hour: number
  color: number
  alpha: number
}
const NIGHT_COLOR = 0x0b1030 // bleu froid
const GOLDEN_COLOR = 0xc8702a // ambre chaud (heure dorée)
const NEUTRAL_COLOR = 0x101018

/** Keyframes de la teinte d'ambiance sur 24 h (bornes 0 h et 24 h identiques). */
const AMBIENT_KEYS: TintKey[] = [
  { hour: 0, color: NIGHT_COLOR, alpha: NIGHT_ALPHA_MAX },
  { hour: 5, color: NIGHT_COLOR, alpha: 0.44 },
  { hour: 6, color: GOLDEN_COLOR, alpha: 0.32 },
  { hour: 8, color: GOLDEN_COLOR, alpha: 0.1 },
  { hour: 10, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 15, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 18, color: GOLDEN_COLOR, alpha: 0.12 },
  { hour: 20, color: GOLDEN_COLOR, alpha: 0.34 },
  { hour: 21, color: NIGHT_COLOR, alpha: 0.42 },
  { hour: 24, color: NIGHT_COLOR, alpha: NIGHT_ALPHA_MAX },
]

export function ambientTint(hour: number): { color: number; alpha: number } {
  const { lo, hi, t } = bracket(AMBIENT_KEYS, hour)
  return { color: lerpColor(lo.color, hi.color, t), alpha: lerp(lo.alpha, hi.alpha, t) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @braises/client exec vitest run src/render/lighting.test.ts`
Expected: PASS (tous les tests, dont les 4 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/lighting.ts packages/client/src/render/lighting.test.ts
git commit -m "feat(client): ambientTint — heure dorée matin/soir, nuit bleutée plafonnée"
```

---

## Task 3: `fireGlow` — paramètres du halo d'un Feu

**Files:**
- Modify: `packages/client/src/render/lighting.ts`
- Test: `packages/client/src/render/lighting.test.ts`

**Interfaces:**
- Consumes: `warmthColor`, `daylight` (Task 1).
- Produces: `fireGlow(warmth: number, day: number): { color: number; radius: number; alpha: number }` — `radius` en TUILES, `day` = valeur `daylight(hour) ∈ [0,1]`.

- [ ] **Step 1: Write the failing test**

Ajouter à `lighting.test.ts` :

```ts
import { fireGlow } from './lighting'

describe('fireGlow (halo des Feux)', () => {
  it('brille la nuit, s’éteint à midi', () => {
    const night = fireGlow(0, daylight(0))
    const noon = fireGlow(0, daylight(12))
    expect(night.alpha).toBeGreaterThan(noon.alpha)
    expect(noon.alpha).toBeCloseTo(0, 5)
  })
  it('couleur = alignement (Foyer bleu, Meute rouge)', () => {
    const foyer = fireGlow(80, daylight(0)).color
    const meute = fireGlow(-80, daylight(0)).color
    expect(foyer & 0xff).toBeGreaterThan((foyer >> 16) & 0xff) // bleu > rouge
    expect((meute >> 16) & 0xff).toBeGreaterThan(meute & 0xff) // rouge > bleu
  })
  it('un Feu plus engagé rayonne plus loin', () => {
    expect(fireGlow(90, daylight(0)).radius).toBeGreaterThan(fireGlow(10, daylight(0)).radius)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @braises/client exec vitest run src/render/lighting.test.ts`
Expected: FAIL — `fireGlow is not a function`.

- [ ] **Step 3: Write minimal implementation**

Dans `lighting.ts` :

```ts
const GLOW_MAX_ALPHA = 0.9
const GLOW_MIN_RADIUS_TILES = 3
const GLOW_SPAN_TILES = 5

/**
 * Halo d'un Feu : couleur d'alignement, plus fort la nuit (∝ 1 - day) et pour un
 * village plus engagé (∝ |warmth|). `radius` en tuiles, `alpha` pour blend ADD.
 */
export function fireGlow(warmth: number, day: number): { color: number; radius: number; alpha: number } {
  const engage = Math.min(1, Math.abs(warmth) / 100)
  const dark = 1 - day
  const alpha = Math.min(GLOW_MAX_ALPHA, GLOW_MAX_ALPHA * dark * (0.6 + 0.4 * engage))
  const radius = GLOW_MIN_RADIUS_TILES + GLOW_SPAN_TILES * engage
  return { color: warmthColor(warmth), radius, alpha }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @braises/client exec vitest run src/render/lighting.test.ts`
Expected: PASS (tous les tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/lighting.ts packages/client/src/render/lighting.test.ts
git commit -m "feat(client): fireGlow — halo coloré par alignement, fort la nuit"
```

---

## Task 4: Texture `glow` (dégradé radial) au boot

**Files:**
- Modify: `packages/client/src/scenes/BootScene.ts`

**Interfaces:**
- Consumes: rien.
- Produces: une texture Phaser `'glow'` (256×256, blanc au centre → transparent), consommée en Task 6.

> Pas de test unitaire : génération de texture Phaser, vérifiée à l'intégration (Task 8) via typecheck + smoke visuel. Le « cycle de test » de cette task est `pnpm --filter @braises/client check`.

- [ ] **Step 1: Add the glow texture generator**

Dans `BootScene.ts`, ajouter une méthode et l'appeler dans `create()` AVANT `this.scene.start('world')` :

```ts
// dans create(), juste avant `this.scene.start('world')` :
this.makeGlowTexture()
```

```ts
/** Halo radial doux (blanc centre → transparent) pour l'éclairage additif des Feux. */
private makeGlowTexture(): void {
  const size = 256
  const tex = this.textures.createCanvas('glow', size, size)
  if (!tex) return
  const ctx = tex.getContext()
  const c = size / 2
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  tex.refresh()
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @braises/client check`
Expected: PASS (aucune erreur tsc).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/scenes/BootScene.ts
git commit -m "feat(client): texture 'glow' — dégradé radial pour les halos de Feu"
```

---

## Task 5: Couches canopée + ambiance dans `WorldScene`

**Files:**
- Modify: `packages/client/src/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: `canopyDensity`, `canopyStrength`, `ambientTint`, `daylight` (Tasks 1-2), `hash2` (déjà importé), `GameTime` (type `@braises/sim`).
- Produces: `this.lastTime: GameTime | null` et les objets `canopyImage` / `ambientRect` (consommés en Task 6 pour l'ordre de profondeur : la Task 6 dessine les halos AU-DESSUS, à la profondeur 2200).

> Pas de test unitaire (rendu Phaser). Cycle de test : `pnpm --filter @braises/client check` + smoke visuel en Task 8.

- [ ] **Step 1: Import lighting + GameTime**

Dans le bloc d'import `@braises/sim` (WorldScene.ts:13-28), ajouter `type GameTime` à la liste. Ajouter après les imports de framing (ligne 33) :

```ts
import { ambientTint, canopyDensity, canopyStrength, daylight } from '../render/lighting'
```

- [ ] **Step 2: Add depth constants + fields**

Après les constantes en tête de fichier (près de `EVENT_LOG_CAP`), ajouter :

```ts
/** Profondeurs des couches de lumière (au-dessus des sprites ~1000-1200, sous le ghost à OVERLAY_DEPTH). */
const CANOPY_DEPTH = 2000
const AMBIENT_DEPTH = 2100
```

Dans la classe, ajouter les champs (près de `private map!: WorldMap`) :

```ts
private canopyImage: Phaser.GameObjects.Image | null = null
private ambientRect: Phaser.GameObjects.Rectangle | null = null
private lastTime: GameTime | null = null
```

- [ ] **Step 3: Bake canopy + create layers in onReady**

Dans `onReady`, juste après `this.add.image(0, 0, 'map-demo').setOrigin(0).setDepth(-1)` (ligne 203) et avant le calcul de `worldPx` (ou juste après, en réutilisant `worldPx`) :

```ts
this.bakeCanopyTexture()
this.canopyImage = this.add.image(0, 0, 'canopy').setOrigin(0).setDepth(CANOPY_DEPTH)
const worldPxSize = this.map.width * TILE_PX
this.ambientRect = this.add
  .rectangle(0, 0, worldPxSize, worldPxSize, 0x000000, 0)
  .setOrigin(0)
  .setDepth(AMBIENT_DEPTH)
```

> `worldPx` existe déjà ligne 204 (`const worldPx = this.map.width * TILE_PX`). Réutilise-le au lieu de `worldPxSize` si tu insères ce bloc APRÈS sa déclaration — sinon garde `worldPxSize`. Ne double pas la constante.

Ajouter la méthode de cuisson (près de `bakeMapTexture`) :

```ts
/** Cuit la pénombre de couvert en une texture monde : tuiles boisées assombries, mouchetées. */
private bakeCanopyTexture(): void {
  const g = this.add.graphics()
  for (let ty = 0; ty < this.map.height; ty++) {
    for (let tx = 0; tx < this.map.width; tx++) {
      const density = canopyDensity(this.map.terrain[ty * this.map.width + tx] ?? 0)
      if (density <= 0) continue
      const a = Math.min(1, density * (0.85 + 0.3 * hash2(tx, ty)))
      g.fillStyle(0x040807, a)
      g.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX)
    }
  }
  g.generateTexture('canopy', this.map.width * TILE_PX, this.map.height * TILE_PX)
  g.destroy()
}
```

- [ ] **Step 4: Store lastTime on each snapshot**

Dans `onHostMessage`, après `publishTimeAndVillage(this.registry, msg.time, myVillage)` (ligne 286) :

```ts
this.lastTime = msg.time
```

- [ ] **Step 5: Drive the layers each frame**

Dans `update()`, juste après la garde `if (!this.worldReady) return` (ligne 215) :

```ts
if (this.lastTime) {
  const hour = this.lastTime.hourOfCycle
  const amb = ambientTint(hour)
  this.ambientRect?.setFillStyle(amb.color).setAlpha(amb.alpha)
  this.canopyImage?.setAlpha(canopyStrength(daylight(hour)))
}
```

- [ ] **Step 6: Verify it typechecks**

Run: `pnpm --filter @braises/client check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): couches canopée (locale) + ambiance (heure) dans WorldScene"
```

---

## Task 6: Halos additifs des Feux — `fire-glow.ts` + câblage

**Files:**
- Create: `packages/client/src/scenes/world/fire-glow.ts`
- Modify: `packages/client/src/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: `fireGlow` (Task 3), texture `'glow'` (Task 4), `TILE_PX` (framing), `Structure` (`@braises/sim`), `SnapshotMessage` (protocol), `this.view.structures` / `this.view.villages` / `daylight` (Task 5).
- Produces: classe `FireGlow` avec `update(structures, villages, day): void`.

> Pas de test unitaire (rendu Phaser). Cycle de test : `check` + smoke visuel (Task 8).

- [ ] **Step 1: Create the FireGlow helper**

```ts
// packages/client/src/scenes/world/fire-glow.ts
/**
 * Les halos de lumière des Feux : un sprite additif par structure `fire`, teinté
 * par l'alignement du village et dosé par l'heure (module pur `lighting`). Cycle
 * de vie par diff `seen`, comme les autres sprites de snapshot-view. AUCUNE
 * logique de jeu — pur habillage (spec lumière & ambiance).
 */
import Phaser from 'phaser'
import type { Structure } from '@braises/sim'
import { fireGlow } from '../../render/lighting'
import { TILE_PX } from '../../render/framing'
import type { SnapshotMessage } from '../../protocol'

/** Au-dessus de la couche d'ambiance (AMBIENT_DEPTH=2100) → le halo perce la nuit. */
const GLOW_DEPTH = 2200

export class FireGlow {
  private sprites = new Map<number, Phaser.GameObjects.Image>()

  constructor(private scene: Phaser.Scene) {}

  /** Réconcilie les halos avec les Feux du snapshot, à l'heure courante (`day`). */
  update(structures: Structure[], villages: SnapshotMessage['villages'], day: number): void {
    const seen = new Set<number>()
    for (const s of structures) {
      if (s.type !== 'fire') continue
      seen.add(s.id)
      let sprite = this.sprites.get(s.id)
      if (!sprite) {
        sprite = this.scene.add
          .image(s.tx * TILE_PX + TILE_PX / 2, s.ty * TILE_PX + TILE_PX / 2, 'glow')
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(GLOW_DEPTH)
        this.sprites.set(s.id, sprite)
      }
      const warmth = villages.find((v) => v.id === s.villageId)?.warmth ?? 0
      const glow = fireGlow(warmth, day)
      const diameterPx = glow.radius * TILE_PX * 2
      sprite.setTint(glow.color)
      sprite.setAlpha(glow.alpha)
      sprite.setDisplaySize(diameterPx, diameterPx)
    }
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }
}
```

- [ ] **Step 2: Wire FireGlow into WorldScene**

Import (près de l'import SnapshotView, WorldScene.ts:43) :

```ts
import { FireGlow } from './world/fire-glow'
```

Champ dans la classe :

```ts
private fireGlow: FireGlow | null = null
```

Dans `onReady`, après la création de `this.ambientRect` (Task 5, Step 3) :

```ts
this.fireGlow = new FireGlow(this)
```

Dans `update()`, dans le bloc `if (this.lastTime) { … }` ajouté en Task 5 (Step 5), ajouter la ligne des halos (elle a besoin de `this.view` — disponible) :

```ts
this.fireGlow?.update(this.view.structures, this.view.villages, daylight(hour))
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm --filter @braises/client check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/scenes/world/fire-glow.ts packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): halos additifs des Feux — îlots chauds la nuit"
```

---

## Task 7: Nettoyage `UIScene` + `snapshot-view` (DRY)

**Files:**
- Modify: `packages/client/src/scenes/UIScene.ts`
- Modify: `packages/client/src/scenes/world/snapshot-view.ts`

**Interfaces:**
- Consumes: `warmthColor` (Task 1).
- Produces: rien (nettoyage). L'ambiance de nuit vit désormais dans WorldScene (Task 5) ; `UIScene` ne garde que le HUD et l'alarme.

> Pas de test unitaire ajouté ; les tests client existants (`framing`, `keymap`) doivent rester verts. Cycle de test : `check` + `test` + `lint`.

- [ ] **Step 1: snapshot-view réutilise warmthColor (DRY)**

Dans `snapshot-view.ts`, remplacer le calcul manuel du tint de Feu (lignes ~165-171) :

```ts
      if (s.type === 'fire') {
        // La couleur du Feu (spec alignement R9) : bleu ↔ blanc ↔ rouge.
        const warmth = this.villages.find((v) => v.id === s.villageId)?.warmth ?? 0
        const t = Math.max(-1, Math.min(1, warmth / 100))
        const r = t > 0 ? Math.floor(255 - 130 * t) : 255
        const g = Math.floor(255 - 90 * Math.abs(t))
        const b = t < 0 ? Math.floor(255 + 140 * t) : 255
        sprite.setTint(Phaser.Display.Color.GetColor(r, g, b))
      } else {
```

par :

```ts
      if (s.type === 'fire') {
        // La couleur du Feu (spec alignement R9) : bleu ↔ blanc ↔ rouge. Même
        // formule que les halos de lumière (module pur `lighting`).
        const warmth = this.villages.find((v) => v.id === s.villageId)?.warmth ?? 0
        sprite.setTint(warmthColor(warmth))
      } else {
```

Ajouter l'import en tête de `snapshot-view.ts` :

```ts
import { warmthColor } from '../../render/lighting'
```

- [ ] **Step 2: Run client tests to confirm no regression**

Run: `pnpm --filter @braises/client exec vitest run`
Expected: PASS (framing + keymap + lighting).

- [ ] **Step 3: UIScene — retirer nightAlpha et les constantes de crépuscule**

Dans `UIScene.ts`, SUPPRIMER le bloc de constantes (lignes ~54-62) :

```ts
/** Heures affichées par cycle — horloge murale de `getGameTime` (hourOfCycle ∈ [0,24), minuit = 0h). */
const CYCLE_HOURS = 24
/** Aube murale (le cycle démarre au lever du jour) — 6 h par défaut. */
const DAWN_HOUR = BALANCE.CYCLE_DAWN_HOUR
/** Frontière jour/nuit dérivée de la sim (isNight bascule à cette heure) — 21 h : aube 6 h + 15 h de jour. */
const NIGHTFALL_HOUR = DAWN_HOUR + CYCLE_HOURS * BALANCE.CYCLE_DAY_FRACTION
/** Le crépuscule est un pur habillage : fondu entamé un peu avant la nuit logique, fini un peu après. */
const DUSK_START = NIGHTFALL_HOUR - 1.5
const DUSK_END = NIGHTFALL_HOUR + 1
/** L'aube visuelle : l'obscurité fond sur la dernière portion de la nuit, jusqu'au lever du jour. */
const DAWN_START = DAWN_HOUR - 1.5
```

et SUPPRIMER la fonction `nightAlpha` (lignes ~79-86) en entier.

- [ ] **Step 4: UIScene — retirer l'import BALANCE désormais inutilisé**

`BALANCE` n'était utilisé que dans les constantes supprimées. Dans l'import ligne 7, retirer `BALANCE,` :

```ts
import { skillLevel, zoneAt, type Inventory, type SkillId, type VillageTask, type WorldMap } from '@braises/sim'
```

- [ ] **Step 5: UIScene — renommer nightOverlay → alarmOverlay (usage unique : alarme)**

Déclaration du champ (~ligne 89) :

```ts
  private alarmOverlay!: Phaser.GameObjects.Rectangle
```

Création dans `create()` (~lignes 128-130) — couleur rouge, alpha 0 :

```ts
    this.alarmOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x8a1a10, 0)
      .setOrigin(0)
```

Dans `update()`, SUPPRIMER la ligne d'ambiance de nuit (~ligne 318) :

```ts
    this.nightOverlay.setAlpha(nightAlpha(time.hourOfCycle))
```

Remplacer le bloc alarme final (~lignes 405-412) :

```ts
    const alarm = getHud(this.registry, 'alarm')
    if (alarm && this.time.now - alarm.at < 3000) {
      const pulse = 0.25 + 0.2 * Math.sin(this.time.now / 90)
      this.alarmOverlay.setAlpha(pulse)
    } else {
      this.alarmOverlay.setAlpha(0)
    }
```

- [ ] **Step 6: Verify typecheck + lint (unused imports/vars caught here)**

Run: `pnpm --filter @braises/client check && pnpm lint`
Expected: PASS. Si lint signale un `BALANCE`/`nightAlpha`/`CYCLE_HOURS` résiduel, supprimer la référence oubliée.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/UIScene.ts packages/client/src/scenes/world/snapshot-view.ts
git commit -m "refactor(client): ambiance de nuit → WorldScene ; alarme sur overlay dédié ; tint Feu DRY"
```

---

## Task 8: Vérification visuelle + gate complet

**Files:** aucun (vérification).

**Interfaces:** consomme tout ce qui précède.

- [ ] **Step 1: Full gate**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout vert (sim 19 fichiers, client incluant `lighting.test.ts`, lint propre).

- [ ] **Step 2: Build + preview + smoke visuel**

Suivre la mémoire `browser-smoke-test` : `pnpm build` puis `pnpm --filter @braises/client preview`, piloter via le Chromium en cache (`playwright-core` du projet demo) et le hook `window.__BRAISES__`.

Pour forcer l'heure sans attendre le cycle réel, exposer/forcer le tick via le hook si dispo, ou capturer aux moments naturels. Captures attendues (dossier scratchpad) :
- **Midi** : image quasi neutre, pas de voile.
- **Aube (~6 h)** / **crépuscule (~20 h)** : voile ambré chaud.
- **Minuit** : voile bleu, encore lisible (jamais noir total).
- **Nuit près d'un Feu** : îlot chaud additif autour du Feu, teinté par l'alignement (bleu Foyer / rouge Meute).
- **Sous-bois vs clairière (de jour)** : les tuiles de forêt sont visiblement plus sombres que la plaine adjacente.

- [ ] **Step 3: Vérifier les critères d'acceptation visuels de la spec**

Confronter les captures aux critères 3 (heure dorée), 5 (halo nuit), 8 (progression + sous-bois) du design. Noter tout écart d'intensité à ajuster via les constantes de `lighting.ts` (`NIGHT_ALPHA_MAX`, `AMBIENT_KEYS`, densités canopée, `GLOW_*`).

- [ ] **Step 4: Ajustement d'intensité si besoin (optionnel)**

Si une intensité déplaît en jeu, ajuster UNIQUEMENT les constantes de `lighting.ts`, relancer `pnpm --filter @braises/client exec vitest run src/render/lighting.test.ts` (les tests tolèrent les valeurs tant que les invariants tiennent), puis recommit.

- [ ] **Step 5: Commit final éventuel**

```bash
git add -A
git commit -m "chore(client): calibrage d'intensité lumière & ambiance après smoke visuel"
```

---

## Self-Review

**Spec coverage :**
- Hue selon l'heure (matin/soir chauds, nuit froide, midi neutre) → Task 2 (`ambientTint`) + Task 5 (rendu). ✓
- Nuit sombre mais lisible (plafond) → `NIGHT_ALPHA_MAX` (Task 1/2), critère testé. ✓
- Îlots chauds des Feux → Tasks 3, 4, 6. ✓
- Couvert forestier local → Task 1 (`canopyDensity`) + Task 5 (texture cuite + `canopyStrength`). ✓
- Module pur testé `lighting.ts` → Tasks 1-3 avec tests. ✓
- Alarme sur overlay dédié / retrait `nightAlpha` → Task 7. ✓
- DRY couleur du Feu → Task 7 (snapshot-view réutilise `warmthColor`). ✓
- Vérif (check/test/lint + smoke) → Task 8. ✓
- Hors scope (torche, fog autoritatif, Light2D, halo perso) → respecté (aucune task). ✓

**Correction vs spec :** le critère d'acceptation #6 de la spec (« fireGlow(+80) → rouge ») était **inversé** par rapport à la convention réelle du code (`warmth>0 → bleu`, cf. `snapshot-view.ts`). Le plan réutilise la formule existante (`warmthColor`) et teste dans le bon sens (Foyer bleu / Meute rouge). Le fichier spec sera corrigé en marge lors de l'implémentation.

**Placeholder scan :** aucun TBD/TODO ; code complet à chaque step.

**Type consistency :** `warmthColor(number)→number`, `daylight(number)→number`, `ambientTint(number)→{color,alpha}`, `canopyDensity(number)→number`, `canopyStrength(number)→number`, `fireGlow(number,number)→{color,radius,alpha}`, `FireGlow.update(Structure[], villages, number)` — cohérents entre tasks. `this.view.structures`/`this.view.villages` sont publics (vérifié dans `snapshot-view.ts`). `msg.time: GameTime` (vérifié dans `protocol.ts`). `hash2` déjà importé dans WorldScene.
