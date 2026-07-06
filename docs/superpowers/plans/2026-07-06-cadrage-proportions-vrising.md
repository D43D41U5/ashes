# Cadrage & proportions (façon V Rising) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rapprocher le rendu de Braises d'un V Rising (avatar présent, cadrage resserré, caméra qui regarde vers le curseur) tout en découplant la résolution de l'art de la grille — sans quitter le top-down orthogonal.

**Architecture:** Toute la math de cadrage/placement est extraite dans un module client **pur** `packages/client/src/render/framing.ts` (aucun import Phaser → unit-testable en vitest). `WorldScene` ne fait que câbler ces fonctions dans Phaser (zoom, `followOffset`, origine/`setDisplaySize`/`depth` des sprites). Zéro ligne touchée dans `/sim`.

**Tech Stack:** TypeScript, Phaser 4, Vite, Vitest.

## Global Constraints

- **Zéro impact `/sim`.** Aucune modification sous `packages/sim/`. Le cadrage, les proportions et la profondeur sont des concepts de rendu, 100 % client. (CLAUDE.md invariant #1/#3.)
- **`framing.ts` est pur.** Aucun import de Phaser ni d'API DOM/Node ; que des maths (`+ - * /`, `Math.sqrt`). Il doit être testable en isolation. (Ce n'est PAS `/sim` — les restrictions ESLint de `/sim` ne s'y appliquent pas — mais on garde la pureté pour la testabilité.)
- **Identité top-down orthogonale préservée.** Pas de perspective ¾, pas de hauteur 3D. (Spec `docs/specs/client.md` §« Cadrage & proportions », statut spec.)
- **Constantes de réglage nommées, jamais de nombre magique** dans la logique caméra/placement (miroir de la règle d'équilibrage `/sim`, appliquée ici côté client).
- **Les 3 gates passent avant chaque commit** : `pnpm check`, `pnpm test`, `pnpm lint` (CLAUDE.md). `pnpm build` en plus pour les tâches qui touchent le rendu.
- Code et docs en **français**, identifiants en anglais.

**Contexte figé (vérifié dans le repo au 2026-07-06) :**
- `TILE_PX = 16` (constante en tête de `WorldScene.ts`). Résolution interne **1280×720** en `Scale.FIT` (`main.ts`), donc centre écran = **(640, 360)** et hauteur viewport = **720**.
- `BALANCE.AVATAR_HITBOX_TILES = 0.6` (importable depuis `@braises/sim`).
- Sprites placeholder générés dans `BootScene.ts` : humanoïdes (`spr-player`/`spr-npc`/`spr-zombie`/`spr-boar`) en **12×12 px**, `spr-corpse` et `st-*`/`nd-*` en **16×16 px**. Le découplage (R12) rend ces tailles natives sans importance.
- Profondeurs fixes actuelles : map 0, `spr-corpse` 3, `nd-*` 4, `st-fire` 5, autres `st-*` 6, `evacMarker` 7, `ghost` 8, `spr-npc` 9, `spr-player` 10.
- `WorldScene.syncSprite(sprite, x, y)` fait aujourd'hui `sprite.setPosition(x * TILE_PX, y * TILE_PX)` ; les sprites d'acteurs sont créés par `this.add.image(0, 0, key)` (origine par défaut 0,5/0,5). Caméra : `this.cameras.main.setBounds(...).startFollow(this.playerSprite, true, 0.12, 0.12).setZoom(2)`.

---

## File Structure

- **Create** `packages/client/src/render/framing.ts` — math pure de cadrage/lookahead/placement. Responsabilité unique : convertir des grandeurs logiques (tuiles, position pointeur écran) en grandeurs de rendu (zoom, offset caméra px monde, position/taille/depth de sprite). Aucun Phaser.
- **Create** `packages/client/src/render/framing.test.ts` — tests vitest du module pur.
- **Modify** `packages/client/package.json` — ajout devDep `vitest` + script `test`.
- **Modify** `packages/client/src/scenes/WorldScene.ts` — câblage Phaser (zoom dérivé, `followOffset`, origine pieds + `setDisplaySize`, Y-sort).

---

## Task 1: Module pur `framing.ts` + infra de test client

**Files:**
- Create: `packages/client/src/render/framing.ts`
- Test: `packages/client/src/render/framing.test.ts`
- Modify: `packages/client/package.json`

**Interfaces:**
- Consumes: rien (module feuille).
- Produces (signatures que les tâches suivantes câblent) :
  - `zoomForFraming(visibleTilesTall: number, tilePx: number, viewportHeight: number): number`
  - `lookaheadOffset(pointerX: number, pointerY: number, centerX: number, centerY: number, strength: number, maxTiles: number, tilePx: number): { x: number; y: number }` — décalage en **pixels monde**, vers le curseur, borné.
  - `interface ActorFootprint { widthTiles: number; heightTiles: number }`
  - `interface ActorPlacement { px: number; py: number; displayW: number; displayH: number; depth: number }`
  - `actorPlacement(x: number, y: number, footprint: ActorFootprint, tilePx: number, hitboxTiles: number): ActorPlacement` — origine **pieds** ; `depth` = `ACTOR_DEPTH_BASE + feetY`.
  - `structureDepth(ty: number): number` — Y-sort d'une structure 1-tuile (pieds = bord bas `ty + 1`).
  - `const ACTOR_DEPTH_BASE = 1000`
  - `const OVERLAY_DEPTH = 100000`

- [ ] **Step 1: Ajouter vitest au package client**

Modifier `packages/client/package.json` — ajouter le script `test` et la devDep `vitest` (même version que `/sim`) :

```json
{
  "name": "@braises/client",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@braises/sim": "workspace:*",
    "phaser": "^4.1.0"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vite": "^6.2.4",
    "vitest": "^3.2.4"
  }
}
```

Puis installer :

Run: `pnpm install`
Expected: résout sans erreur, vitest ajouté à `@braises/client`.

- [ ] **Step 2: Écrire les tests (qui échouent)**

Create `packages/client/src/render/framing.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import {
  ACTOR_DEPTH_BASE,
  actorPlacement,
  lookaheadOffset,
  structureDepth,
  zoomForFraming,
} from './framing'

const TILE = 16

describe('zoomForFraming (R10)', () => {
  it('dérive le zoom du cadrage voulu : 20 tuiles de haut sur 720 px → 2,25', () => {
    expect(zoomForFraming(20, TILE, 720)).toBeCloseTo(2.25, 5)
  })
  it('un cadrage plus serré donne un zoom plus fort', () => {
    expect(zoomForFraming(18, TILE, 720)).toBeGreaterThan(zoomForFraming(20, TILE, 720))
  })
})

describe('lookaheadOffset (R11)', () => {
  const CX = 640
  const CY = 360
  it('pointeur au centre → aucun décalage', () => {
    expect(lookaheadOffset(CX, CY, CX, CY, 0.2, 6, TILE)).toEqual({ x: 0, y: 0 })
  })
  it('décale vers le curseur (signe conservé)', () => {
    const off = lookaheadOffset(CX + 100, CY - 50, CX, CY, 0.2, 6, TILE)
    expect(off.x).toBeGreaterThan(0)
    expect(off.y).toBeLessThan(0)
  })
  it('borne le décalage à maxTiles (clamp radial)', () => {
    // strength énorme → doit être clampé à 6 tuiles = 96 px, en magnitude
    const off = lookaheadOffset(CX + 640, CY, CX, CY, 10, 6, TILE)
    const mag = Math.sqrt(off.x * off.x + off.y * off.y)
    expect(mag).toBeCloseTo(6 * TILE, 5)
  })
  it('le clamp est radial (diagonale bornée à maxTiles, pas maxTiles par axe)', () => {
    const off = lookaheadOffset(CX + 640, CY + 360, CX, CY, 10, 6, TILE)
    const mag = Math.sqrt(off.x * off.x + off.y * off.y)
    expect(mag).toBeCloseTo(6 * TILE, 5)
  })
})

describe('actorPlacement (R12 + R13)', () => {
  it('ancre les pieds au bas de l’emprise logique et découple la taille de l’art', () => {
    const p = actorPlacement(5, 10, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    // feetY = 10 + 0.6/2 = 10.3
    expect(p.px).toBeCloseTo(80, 5) // 5 * 16, centre horizontal inchangé
    expect(p.py).toBeCloseTo(10.3 * TILE, 5) // pieds
    expect(p.displayW).toBeCloseTo(16, 5) // 1 tuile — indépendant du 12×12 natif
    expect(p.displayH).toBeCloseTo(25.6, 5) // 1,6 tuile : le sprite « monte »
    expect(p.depth).toBeCloseTo(ACTOR_DEPTH_BASE + 10.3, 5)
  })
  it('la taille d’affichage ne dépend QUE de l’emprise et de tilePx (A9)', () => {
    const a = actorPlacement(0, 0, { widthTiles: 2, heightTiles: 2 }, 32, 0.6)
    expect(a.displayW).toBe(64)
    expect(a.displayH).toBe(64)
  })
  it('un acteur plus au sud (y plus grand) a une depth plus grande → rendu devant', () => {
    const nord = actorPlacement(0, 5, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    const sud = actorPlacement(0, 8, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    expect(sud.depth).toBeGreaterThan(nord.depth)
  })
})

describe('structureDepth (R13)', () => {
  it('trie une structure par son bord bas, dans la même couche que les acteurs', () => {
    expect(structureDepth(9)).toBeCloseTo(ACTOR_DEPTH_BASE + 10, 5) // pieds = ty+1
  })
  it('un acteur au nom d’une structure (feetY < ty+1) passe DERRIÈRE elle', () => {
    const wallDepth = structureDepth(9) // pieds à y=10
    const actorNord = actorPlacement(0, 9, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6) // feetY=9.3
    expect(actorNord.depth).toBeLessThan(wallDepth) // dessous → occulté
  })
})
```

- [ ] **Step 3: Lancer les tests → échec attendu**

Run: `pnpm --filter @braises/client test`
Expected: FAIL — `Cannot find module './framing'` (le module n'existe pas encore).

- [ ] **Step 4: Écrire l'implémentation**

Create `packages/client/src/render/framing.ts` :

```ts
/**
 * Cadrage & proportions (façon V Rising) — math PURE, aucun import Phaser.
 *
 * Convertit des grandeurs logiques (tuiles, position écran du pointeur) en
 * grandeurs de rendu (zoom, décalage caméra en px monde, position/taille/depth
 * d'un sprite). Extrait de `WorldScene` pour être unit-testable en isolation.
 * Spec : docs/specs/client.md §« Cadrage & proportions » (R10-R13).
 */

/** Toutes les entités « hautes » (acteurs + structures verticales) trient leur
 * profondeur au-dessus de cette base, laissant le sol/les nœuds/les cadavres
 * dessous. La valeur exacte importe peu : elle doit juste dominer les depths
 * fixes du sol (≤ 5) et laisser de la marge pour `base + y`. */
export const ACTOR_DEPTH_BASE = 1000

/** Au-dessus de tout : aperçu de construction, marqueurs d'objectif. */
export const OVERLAY_DEPTH = 100000

/** R10 — zoom dérivé du cadrage voulu (« je veux voir N tuiles de haut »). */
export function zoomForFraming(visibleTilesTall: number, tilePx: number, viewportHeight: number): number {
  return viewportHeight / (visibleTilesTall * tilePx)
}

/**
 * R11 — décalage caméra « Foxhole » : voir plus loin là où l'on vise.
 *
 * Calculé en ÉCRAN-espace (écart du pointeur au centre), JAMAIS depuis la
 * position monde du curseur : sinon la caméra suivrait le curseur dont la
 * position monde dépend de la caméra → boucle de rétroaction. Retourne un
 * décalage en pixels MONDE, borné radialement à `maxTiles`.
 */
export function lookaheadOffset(
  pointerX: number,
  pointerY: number,
  centerX: number,
  centerY: number,
  strength: number,
  maxTiles: number,
  tilePx: number,
): { x: number; y: number } {
  let x = (pointerX - centerX) * strength
  let y = (pointerY - centerY) * strength
  const maxPx = maxTiles * tilePx
  const mag = Math.sqrt(x * x + y * y)
  if (mag > maxPx && mag > 0) {
    x = (x / mag) * maxPx
    y = (y / mag) * maxPx
  }
  return { x, y }
}

/** Emprise VISUELLE d'un acteur (en tuiles) — découplée de la résolution de
 * l'art. L'art peut être plus haut que l'emprise logique de collision. */
export interface ActorFootprint {
  widthTiles: number
  heightTiles: number
}

export interface ActorPlacement {
  /** position pixel du sprite (à utiliser avec une origine PIEDS 0,5/1) */
  px: number
  py: number
  /** taille d'affichage en pixels — dépend UNIQUEMENT de l'emprise et de tilePx */
  displayW: number
  displayH: number
  /** Y-sort : croît vers le bas (pieds plus bas = devant) */
  depth: number
}

/**
 * R12 + R13 — place un acteur logique (x,y = centre, en tuiles) avec ancrage
 * PIEDS et taille d'affichage découplée de la résolution de l'art. Les pieds
 * sont au bas de l'emprise logique (`y + hitbox/2`), de sorte qu'un sprite plus
 * haut que l'emprise « monte » au-dessus de sa tuile sans décaler collision ni
 * cible de clic (qui restent gérées en espace-tuile ailleurs).
 */
export function actorPlacement(
  x: number,
  y: number,
  footprint: ActorFootprint,
  tilePx: number,
  hitboxTiles: number,
): ActorPlacement {
  const feetY = y + hitboxTiles / 2
  return {
    px: x * tilePx,
    py: feetY * tilePx,
    displayW: footprint.widthTiles * tilePx,
    displayH: footprint.heightTiles * tilePx,
    depth: ACTOR_DEPTH_BASE + feetY,
  }
}

/** R13 — profondeur Y-sort d'une structure 1-tuile (origine coin haut-gauche à
 * `ty`) : ses pieds sont son bord bas `ty + 1`, dans la même couche que les
 * acteurs → un acteur au nord passe derrière, au sud devant. */
export function structureDepth(ty: number): number {
  return ACTOR_DEPTH_BASE + (ty + 1)
}
```

- [ ] **Step 5: Lancer les tests → succès attendu**

Run: `pnpm --filter @braises/client test`
Expected: PASS (tous les `describe`).

- [ ] **Step 6: Gates + commit**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout vert (les tests client s'exécutent désormais via `pnpm -r run test`).

```bash
git add packages/client/package.json packages/client/src/render/framing.ts packages/client/src/render/framing.test.ts pnpm-lock.yaml
git commit -m "feat(client): module pur de cadrage/proportions (framing.ts) + tests

Math pure et unit-testée du cadrage V Rising (R10-R13) : zoom dérivé,
lookahead écran-espace, placement pieds découplé de l'art, Y-sort.
Ajoute vitest au package client. Aucun câblage Phaser encore.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Câblage caméra — cadrage dérivé (R10) + lookahead Foxhole (R11)

**Files:**
- Modify: `packages/client/src/scenes/WorldScene.ts` (constantes en tête ; `create()` caméra ; `update()`).

**Interfaces:**
- Consumes: `zoomForFraming`, `lookaheadOffset` de `framing.ts`.
- Produces: rien pour les tâches suivantes (câblage terminal).

- [ ] **Step 1: Importer les helpers et ajouter les constantes de cadrage**

Dans `WorldScene.ts`, ajouter l'import (près de l'import `../protocol`) :

```ts
import { lookaheadOffset, zoomForFraming } from '../render/framing'
```

Sous `const TILE_PX = 16`, ajouter les constantes de réglage nommées :

```ts
/** Cadrage caméra (spec client R10) : « je veux voir ~N tuiles de haut ». */
const VISIBLE_TILES_TALL = 20
/** Caméra « Foxhole » (R11) : force du décalage vers le curseur (px écran → px monde). */
const LOOKAHEAD_STRENGTH = 0.18
/** Borne radiale du décalage caméra, en tuiles. */
const LOOKAHEAD_MAX_TILES = 6
```

- [ ] **Step 2: Dériver le zoom dans `create()`**

Remplacer la ligne caméra actuelle :

```ts
    this.cameras.main.startFollow(this.playerSprite, true, 0.12, 0.12).setZoom(2)
```

par (zoom dérivé du cadrage, suivi un cran plus serré) :

```ts
    const zoom = zoomForFraming(VISIBLE_TILES_TALL, TILE_PX, this.scale.height)
    this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16).setZoom(zoom)
```

- [ ] **Step 3: Appliquer le lookahead chaque frame dans `update()`**

À la fin de `update()` (après la ligne `this.registry.set('zone', ...)`), ajouter :

```ts
    // Caméra « Foxhole » (R11) : le point suivi se décale vers le curseur pour
    // voir plus loin là où l'on vise. Calcul en ÉCRAN-espace (écart au centre),
    // jamais depuis la position monde du pointeur → pas de boucle caméra↔curseur.
    const p = this.input.activePointer
    const off = lookaheadOffset(
      p.x, p.y, this.scale.width / 2, this.scale.height / 2,
      LOOKAHEAD_STRENGTH, LOOKAHEAD_MAX_TILES, TILE_PX,
    )
    // followOffset est SOUSTRAIT du point suivi → on nie pour pencher VERS le curseur.
    this.cameras.main.setFollowOffset(-off.x, -off.y)
```

- [ ] **Step 4: Gates**

Run: `pnpm check && pnpm lint && pnpm build`
Expected: tout vert, build produit `packages/client/dist`.

- [ ] **Step 5: Vérif visuelle (smoke test headless)**

Lancer `pnpm dev` et charger `http://localhost:3000` (ou piloter le Chromium en cache via le playwright-core du projet demo, cf. historique git V2). Vérifier :
- l'avatar occupe une part nettement plus grande de l'écran qu'avant (cadrage ~20 tuiles de haut) ;
- en bougeant la souris vers un bord, la vue se décale **vers** le curseur et se **stabilise** (pas d'oscillation), et ne montre jamais le void près des bords de carte (clamp `setBounds`).

Si la caméra penche à l'OPPOSÉ du curseur, inverser le signe au Step 3 (`setFollowOffset(off.x, off.y)`) et re-vérifier — la sémantique exacte du signe de `followOffset` est confirmée ici, en jeu.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): cadrage caméra dérivé + lookahead Foxhole (R10, R11)

Zoom dérivé de VISIBLE_TILES_TALL (fini le 2 magique) ; la caméra se
décale vers le curseur (calcul écran-espace, borné, clampé aux bords).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Découplage art↔grille — ancrage pieds + `setDisplaySize` (R12)

**Files:**
- Modify: `packages/client/src/scenes/WorldScene.ts` (constantes footprints ; création des sprites acteurs ; `syncSprite` ; application après `setTexture`).

**Interfaces:**
- Consumes: `actorPlacement`, `ActorFootprint` de `framing.ts` ; `BALANCE.AVATAR_HITBOX_TILES`.
- Produces: convention de placement des acteurs (origine pieds + display size), réutilisée par la Task 4 pour la depth.

Note : `BALANCE` est déjà importé de `@braises/sim` dans `WorldScene.ts` — vérifier qu'`AVATAR_HITBOX_TILES` est accessible via `BALANCE.AVATAR_HITBOX_TILES` (il l'est).

- [ ] **Step 1: Importer et déclarer les emprises visuelles**

Ajouter à l'import `framing` (Task 2) le type et la fonction :

```ts
import { actorPlacement, type ActorFootprint, lookaheadOffset, zoomForFraming } from '../render/framing'
```

Sous les constantes de cadrage, déclarer les emprises visuelles par texture (placeholders ; l'art réel les ajustera sans toucher au layout) :

```ts
/** Emprise VISUELLE par texture d'acteur (tuiles) — R12. Découplée de la
 * résolution native de l'art : un placeholder 12×12 rend ici à ces proportions.
 * L'emprise logique (collision/clic) reste AVATAR_HITBOX_TILES, inchangée. */
const ACTOR_FOOTPRINTS: Record<string, ActorFootprint> = {
  'spr-player': { widthTiles: 1, heightTiles: 1.6 },
  'spr-npc': { widthTiles: 1, heightTiles: 1.6 },
  'spr-zombie': { widthTiles: 1, heightTiles: 1.6 },
  'spr-boar': { widthTiles: 1.4, heightTiles: 1 },
}
const DEFAULT_FOOTPRINT: ActorFootprint = { widthTiles: 1, heightTiles: 1.6 }
```

- [ ] **Step 2: Helper d'application de l'emprise (origine pieds + display size)**

Ajouter une méthode privée à la classe `WorldScene` (près de `syncSprite`) :

```ts
  /** Applique l'emprise visuelle d'un acteur (R12) : origine PIEDS + taille
   * d'affichage en tuiles. À rappeler après chaque `setTexture` (setDisplaySize
   * dépend de la frame courante). */
  private applyFootprint(sprite: Phaser.GameObjects.Image, textureKey: string): void {
    const fp = ACTOR_FOOTPRINTS[textureKey] ?? DEFAULT_FOOTPRINT
    sprite.setOrigin(0.5, 1)
    sprite.setDisplaySize(fp.widthTiles * TILE_PX, fp.heightTiles * TILE_PX)
  }
```

- [ ] **Step 3: Réécrire `syncSprite` pour ancrer aux pieds**

Remplacer :

```ts
  private syncSprite(sprite: Phaser.GameObjects.Image, x: number, y: number): void {
    sprite.setPosition(x * TILE_PX, y * TILE_PX)
  }
```

par (position aux pieds via le module pur ; la depth Y-sort viendra en Task 4) :

```ts
  private syncSprite(sprite: Phaser.GameObjects.Image, x: number, y: number): void {
    const p = actorPlacement(x, y, DEFAULT_FOOTPRINT, TILE_PX, BALANCE.AVATAR_HITBOX_TILES)
    sprite.setPosition(p.px, p.py)
  }
```

(Seule la position dépend de l'emprise ici, et `px`/`py` n'en dépendent pas — `DEFAULT_FOOTPRINT` est un simple porteur.)

- [ ] **Step 4: Appliquer l'emprise à la création du joueur**

Dans `create()`, après `this.playerSprite = this.add.image(0, 0, 'spr-player').setDepth(10)`, insérer :

```ts
    this.applyFootprint(this.playerSprite, 'spr-player')
```

- [ ] **Step 5: Appliquer l'emprise aux autres entités (création + changements de texture)**

Dans `onHostMessage`, à la création d'une entité distante — après `const sprite = this.add.image(0, 0, 'spr-npc').setDepth(9)` — ajouter :

```ts
        this.applyFootprint(sprite, 'spr-npc')
```

Puis, comme la texture des autres est réassignée à chaque snapshot (bloc monstre/PNJ), réappliquer l'emprise après chaque `setTexture`. Remplacer le bloc :

```ts
      const monster = this.monsters.find((m) => m.entityId === entity.id)
      if (monster) {
        record.sprite.setTexture(monster.type === 'zombie' ? 'spr-zombie' : 'spr-boar')
        record.sprite.setTint(entity.windup ? 0xffffff : 0xdddddd)
      } else {
        record.sprite.setTexture('spr-npc')
        record.sprite.setTint(entity.windup ? 0xff8866 : npc ? 0xe8d9a0 : 0xffffff)
      }
```

par :

```ts
      const monster = this.monsters.find((m) => m.entityId === entity.id)
      if (monster) {
        const key = monster.type === 'zombie' ? 'spr-zombie' : 'spr-boar'
        record.sprite.setTexture(key)
        this.applyFootprint(record.sprite, key)
        record.sprite.setTint(entity.windup ? 0xffffff : 0xdddddd)
      } else {
        record.sprite.setTexture('spr-npc')
        this.applyFootprint(record.sprite, 'spr-npc')
        record.sprite.setTint(entity.windup ? 0xff8866 : npc ? 0xe8d9a0 : 0xffffff)
      }
```

- [ ] **Step 6: Gates**

Run: `pnpm check && pnpm test && pnpm lint && pnpm build`
Expected: tout vert.

- [ ] **Step 7: Vérif visuelle**

Charger le jeu. Vérifier : l'avatar et les PNJ sont plus « debout » (plus hauts que larges, ancrés aux pieds sur leur tuile) ; le sanglier est trapu/large ; se déplacer contre un rocher donne toujours les mêmes collisions (l'emprise logique n'a pas bougé) ; cliquer sur un nœud/une structure vise toujours la bonne tuile.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): découplage art↔grille — ancrage pieds + setDisplaySize (R12)

Les acteurs sont ancrés aux pieds et dimensionnés en tuiles, indépendamment
de la résolution native de l'art : un placeholder 12×12 rend aux bonnes
proportions. L'emprise logique (collision/clic) est inchangée.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Profondeur par Y (Y-sort) — R13

**Files:**
- Modify: `packages/client/src/scenes/WorldScene.ts` (`syncSprite` depth ; `syncStructures` depth ; profondeurs des overlays ghost/evac).

**Interfaces:**
- Consumes: `actorPlacement` (déjà importé), `structureDepth`, `OVERLAY_DEPTH` de `framing.ts`.
- Produces: rien (câblage terminal).

- [ ] **Step 1: Étendre l'import framing**

```ts
import {
  actorPlacement,
  type ActorFootprint,
  lookaheadOffset,
  OVERLAY_DEPTH,
  structureDepth,
  zoomForFraming,
} from '../render/framing'
```

- [ ] **Step 2: Trier les acteurs par Y dans `syncSprite`**

Compléter `syncSprite` pour poser aussi la depth (les acteurs partagent la couche `ACTOR_DEPTH_BASE + feetY`) :

```ts
  private syncSprite(sprite: Phaser.GameObjects.Image, x: number, y: number): void {
    const p = actorPlacement(x, y, DEFAULT_FOOTPRINT, TILE_PX, BALANCE.AVATAR_HITBOX_TILES)
    sprite.setPosition(p.px, p.py)
    sprite.setDepth(p.depth)
  }
```

Comme `syncSprite` pose désormais la depth chaque frame, retirer les `.setDepth(10)` / `.setDepth(9)` devenus inutiles à la création du joueur et des autres (ils sont écrasés). Le joueur :

```ts
    this.playerSprite = this.add.image(0, 0, 'spr-player')
    this.applyFootprint(this.playerSprite, 'spr-player')
```

Les autres :

```ts
        const sprite = this.add.image(0, 0, 'spr-npc')
        this.applyFootprint(sprite, 'spr-npc')
```

- [ ] **Step 3: Trier les structures par Y dans `syncStructures`**

Dans `syncStructures`, à la création du sprite de structure, remplacer la depth fixe :

```ts
        sprite = this.add
          .image(s.tx * TILE_PX, s.ty * TILE_PX, `st-${s.type}`)
          .setOrigin(0)
          .setDepth(s.type === 'fire' ? 5 : 6)
```

par (le Feu reste un marqueur au sol sous les acteurs ; les autres structures trient par leur bord bas) :

```ts
        sprite = this.add
          .image(s.tx * TILE_PX, s.ty * TILE_PX, `st-${s.type}`)
          .setOrigin(0)
          .setDepth(s.type === 'fire' ? 5 : structureDepth(s.ty))
```

- [ ] **Step 4: Garder les overlays au-dessus de la couche Y-sort**

Le fantôme de construction et le marqueur d'évacuation étaient à depth 8 et 7 — désormais sous les acteurs (≥ 1000). Les remonter.

Création du ghost dans `create()` — remplacer `.setDepth(8)` par :

```ts
      .setDepth(OVERLAY_DEPTH)
```

Marqueur d'évacuation dans `onHostMessage` — remplacer `.setDepth(7)` par :

```ts
            .setDepth(OVERLAY_DEPTH)
```

- [ ] **Step 5: Gates**

Run: `pnpm check && pnpm test && pnpm lint && pnpm build`
Expected: tout vert.

- [ ] **Step 6: Vérif visuelle (A8)**

Charger le jeu, bâtir un mur (`1` puis clic). Vérifier : en passant l'avatar **au nord** du mur, il est **occulté** par le mur ; **au sud**, il **recouvre** le mur. Le fantôme de construction et un éventuel marqueur d'évacuation restent visibles au-dessus des acteurs. Le Feu reste sous l'avatar (on marche « dessus »).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/WorldScene.ts
git commit -m "feat(client): Y-sort acteurs + structures (R13)

Acteurs et structures verticales trient leur profondeur par leur bord bas
(depth = base + feetY) : un acteur passe derrière ce qui est au nord de lui,
devant ce qui est au sud. Overlays (ghost, évac) remontés au-dessus.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Marquer la spec implémentée

**Files:**
- Modify: `docs/specs/client.md` (statut de la section « Cadrage & proportions »).
- Modify: `docs/decisions.md` (ligne de clôture).

- [ ] **Step 1: Passer le statut de la section à « implémenté »**

Dans `docs/specs/client.md`, section « Cadrage & proportions », remplacer :

```
*Statut : **spec, non implémenté** (2026-07-06). Incrément client, ...
```

par :

```
*Statut : **implémenté** (2026-07-06 — R10-R13, critères A5-A9 ; A5/A9 couverts par `packages/client/src/render/framing.test.ts`, A6/A7/A8 vérifiés en jeu). Incrément client, ...
```

- [ ] **Step 2: Ligne de décision**

Ajouter en fin de `docs/decisions.md` :

```
- 2026-07-06 — [client] Cadrage & proportions façon V Rising IMPLÉMENTÉ (R10-R13) : math pure isolée et testée dans `packages/client/src/render/framing.ts` (vitest ajouté au package client), câblée dans `WorldScene` — zoom dérivé de `VISIBLE_TILES_TALL`, caméra « Foxhole » (`followOffset` piloté par un lookahead écran-espace borné), acteurs ancrés aux pieds + `setDisplaySize` en tuiles (l'art n'est plus prisonnier du 12×12/16×16), Y-sort acteurs+structures par bord bas. Zéro ligne touchée dans `/sim`. Restent ouverts à la direction artistique : filtrage nearest/linéaire, résolution interne, chunk du bake carte.
```

- [ ] **Step 3: Gates + commit**

Run: `pnpm check && pnpm test && pnpm lint`
Expected: tout vert.

```bash
git add docs/specs/client.md docs/decisions.md
git commit -m "docs: cadrage & proportions V Rising — spec implémentée (R10-R13)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (rempli par l'auteur du plan)

**Couverture spec** (docs/specs/client.md §Cadrage & proportions) :
- R10 (zoom dérivé) → Task 1 (`zoomForFraming` + test) + Task 2 (câblage). A5 → test `zoomForFraming`.
- R11 (caméra Foxhole écran-espace) → Task 1 (`lookaheadOffset` + tests clamp/centre/signe) + Task 2 (câblage `setFollowOffset`). A6 → tests + vérif jeu.
- R12 (découplage pieds + setDisplaySize) → Task 1 (`actorPlacement` + test A9) + Task 3 (câblage). A7/A9 → test + vérif jeu.
- R13 (Y-sort) → Task 1 (`actorPlacement.depth` + `structureDepth` + tests d'ordre) + Task 4 (câblage). A8 → vérif jeu.
- Embranchements ouverts (filtrage, résolution interne) + dette (chunk bake) : explicitement HORS périmètre, laissés tels quels — conforme au statut spec.

**Placeholders** : aucun — chaque step porte son code/commande complets.

**Cohérence des types** : `ActorFootprint`/`ActorPlacement`/`actorPlacement`/`structureDepth`/`zoomForFraming`/`lookaheadOffset`/`ACTOR_DEPTH_BASE`/`OVERLAY_DEPTH` définis en Task 1, consommés à l'identique en Tasks 2-4.

**Point à confirmer en jeu** (non bloquant, noté au Step de vérif) : le signe de `setFollowOffset` (Phaser soustrait `followOffset` → le plan nie l'offset ; à inverser en jeu si la caméra penche à l'opposé du curseur).
