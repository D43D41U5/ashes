# Jauge Température — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une sixième jauge du corps, `temperature` (0-100), qui dérive vers une température ambiante (altitude/biome/nuit/acte, réchauffée par feu/abri) et devient mortelle par le froid.

**Architecture:** Modèle thermostat. Un helper **pur** `ambientTemperature(state, x, y)` compose la cible ; `advanceTemperature(state)` (nouvelle étape de tick, après `advanceEconomy`) fait dériver chaque humain vers elle, applique les bandes (malus endurance/vitesse en engourdissement, dégâts PV en hypothermie), et tue avec la cause `cold`. Tout vit dans un nouveau module `temperature.ts` ; les constantes dans `balance.ts`.

**Tech Stack:** TypeScript pur (`packages/sim`), Vitest.

## Global Constraints

- **`/sim` pur** : aucun import de Phaser/Colyseus/Node. (invariant #1)
- **Déterministe au bit près** : opérations autorisées `+ - * /`, `Math.sqrt/abs/floor/ceil/min/max`, constantes. **Aucune** transcendante (`sin/cos/pow/exp/log/**`…). Pas de `Math.random`/`Date`. (invariant #2)
- **État JSON-sérialisable** : pas de classe/Map/Set sur `SimState` (le snapshot est `JSON.stringify(state)`).
- **Équilibrage dans `balance.ts`** : aucun nombre magique dans la logique.
- **Nommage** : `warmth` reste l'axe MORAL (Foyer↔Meute) — ne jamais réutiliser pour le froid physique ; la jauge s'appelle `temperature`.
- Code/commentaires en **français**, identifiants en anglais.
- **API rappelée (vérifiée)** : `createSim(seed: number, options?)` — le seed est **positionnel**. `spawnEntity(state, x, y): number` **retourne l'id** (pas l'objet). `getGameTime(state)` → `{ isNight, act, … }`. `elevationAt(map,tx,ty)`, `terrainAt(map,tx,ty)`. `state.map`, `state.structures` (`{type,tx,ty,…}`), `state.monsters` (`{entityId,type}`).
- Vérifs avant chaque commit : `pnpm check && pnpm lint && pnpm --filter @braises/sim test` (verts).

## File Structure

- **Create** `packages/sim/src/temperature.ts` — helpers purs (`ambientTemperature`, `fireBubble`, `isSheltered`, `driftStep`, `coldDamagePerTick`, `coldEffectRamp`, `coldSpeedFactor`, `coldStaminaRegenFactor`) + `advanceTemperature(state)`.
- **Create** `packages/sim/src/temperature.test.ts` — tests + helpers locaux `spawn`/`flatMap`.
- **Modify** `packages/sim/src/sim.ts` — champ `temperature` sur `Entity`, init dans `spawnEntity`, appel `advanceTemperature` dans `step`, `temperature` dans le `Pick` de `speedScaleFor` + malus vitesse.
- **Modify** `packages/sim/src/balance.ts` — bloc `TEMPERATURE`.
- **Modify** `packages/sim/src/combat.ts` — `die()` gagne `cause`, exporté ; malus de froid sur la régén d'endurance.
- **Modify** `packages/sim/src/events.ts` — champ optionnel `cause` sur `entity_died`.
- **Modify** `packages/sim/src/index.ts` — exports publics (`ambientTemperature`, `advanceTemperature`).

---

### Task 1 : Champ `temperature` sur l'entité (+ helpers de test)

**Files:**
- Modify: `packages/sim/src/sim.ts` (interface `Entity` ~31-61 ; `spawnEntity` ~164-186)
- Test: `packages/sim/src/temperature.test.ts` (créer)

**Interfaces:**
- Produces: `Entity.temperature: number` (0-100, init 100).

- [ ] **Step 1 : Test qui échoue**

Créer `packages/sim/src/temperature.test.ts` (les helpers `spawn`/`flatMap` servent à toutes les tâches suivantes) :
```ts
import { describe, it, expect } from 'vitest'
import { createSim, spawnEntity, type Entity, type SimState } from './sim'

/** spawnEntity retourne un id → on récupère l'objet entité. */
function spawn(state: SimState, x: number, y: number): Entity {
  const id = spawnEntity(state, x, y)
  return state.entities.find((e) => e.id === id)!
}

/** Remplit toute la carte d'un terrain + une élévation uniformes. */
function flatMap(state: SimState, terrain: number, elevation: number): void {
  const n = state.map.width * state.map.height
  state.map.terrain = new Array(n).fill(terrain)
  state.map.elevation = new Array(n).fill(elevation)
}

describe('jauge temperature', () => {
  it('un nouvel avatar naît à température 100', () => {
    const state = createSim(1)
    expect(spawn(state, 5, 5).temperature).toBe(100)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts`
Expected: FAIL — `temperature` absent du type / `undefined`.

- [ ] **Step 3 : Implémenter**

Dans `sim.ts`, ajouter à l'interface `Entity` (près de `hunger`) :
```ts
  /** Jauge 0-100 (spec température). 100 = au chaud, 0 = gelé (hypothermie). */
  temperature: number
```
Dans `spawnEntity`, à la création de l'objet entité (près de `hunger: 100`) :
```ts
    temperature: 100,
```

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts`
Expected: PASS. Puis `pnpm --filter @braises/sim test` — suite complète verte (le champ s'ajoute au snapshot `JSON.stringify` ; les contrats de replay comparent deux runs identiques → inchangés).

- [ ] **Step 5 : Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/temperature.test.ts
git commit -m "feat(sim): champ temperature (0-100) sur l'entité"
```

---

### Task 2 : `ambientTemperature` — la cible composée

**Files:**
- Create: `packages/sim/src/temperature.ts`
- Modify: `packages/sim/src/balance.ts` (bloc `TEMPERATURE`)
- Modify: `packages/sim/src/index.ts` (export `ambientTemperature`)
- Test: `packages/sim/src/temperature.test.ts`

**Interfaces:**
- Consumes: `state.map`, `elevationAt`, `terrainAt` (`map.ts`), `getGameTime` (`time.ts`), `DAY_TICKS_PER_CYCLE` (`time.ts`), `state.structures`.
- Produces: `ambientTemperature(state, x, y): number` ; `fireBubble(state, x, y): number` ; `isSheltered(state, tx, ty): boolean` ; `BALANCE.TEMPERATURE`.

- [ ] **Step 1 : Test qui échoue**

Ajouter dans `temperature.test.ts` :
```ts
import { ambientTemperature } from './temperature'
import { DAY_TICKS_PER_CYCLE } from './time'

describe('ambientTemperature', () => {
  it('fond de vallée, jour, acte I = confort (≥60)', () => {
    const state = createSim(1) // tick 0 = aube (jour), acte I
    flatMap(state, 1 /* grass */, 0)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThanOrEqual(60)
  })

  it('glacier en altitude = glacial (≤20)', () => {
    const state = createSim(1)
    flatMap(state, 15 /* glacier */, 0.85)
    expect(ambientTemperature(state, 5, 5)).toBeLessThanOrEqual(20)
  })

  it("près d'un feu, la cible remonte au chaud (>60)", () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85) // sinon glacial
    state.structures.push({ type: 'fire', tx: 5, ty: 5 } as never)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThan(60)
  })

  it('sous abri, le froid nocturne est amorti (~moitié)', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit dès le tick 0
    flatMap(state, 1 /* grass */, 0)
    const exposed = ambientTemperature(state, 5, 5)
    state.structures.push({ type: 'house', tx: 5, ty: 5 } as never)
    const sheltered = ambientTemperature(state, 5, 5)
    expect(sheltered).toBeGreaterThan(exposed)
    expect(sheltered - exposed).toBeCloseTo(10, 5) // pénalité nocturne 20 → 10
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts`
Expected: FAIL — `ambientTemperature` introuvable.

- [ ] **Step 3 : Implémenter**

Dans `balance.ts`, ajouter un bloc exporté et l'inclure dans l'objet `BALANCE` (mêmes conventions que les autres blocs) :
```ts
/** Jauge Température (spec 2026-07-08). Ordres de grandeur, à calibrer en playtest. */
export const TEMPERATURE = {
  BASE: 90, // cible d'un bas de vallée, jour, acte I
  ALT_COLD: 70, // refroidissement max au sommet (elevation 1)
  NIGHT_COLD: 20,
  ACT_COLD: [0, 25, 40] as const, // par acte (I, Grand Froid, Cendre), soustrait
  /** Décalage signé par terrain (id de TERRAINS). Absent = 0. */
  BIOME_OFFSET: {
    3: 5, 13: 5, 14: 5, 22: 5, // forêts (couvert)
    8: -5, 18: -5, 19: -5, // marais/tourbière/roselière (mouillé)
    10: -10, // neige
    15: -15, // glacier
  } as Record<number, number>,
  FIRE_WARMTH: 80, // cible au contact d'un feu
  FIRE_RANGE: 6, // tuiles
  SHELTER_FACTOR: 0.5, // sous toit : nuit+biome × 0.5
}
```

Créer `packages/sim/src/temperature.ts` :
```ts
/**
 * Jauge Température (spec 2026-07-08) — modèle thermostat, pur et déterministe.
 * La cible = BASE − altitude − acte + (nuit+biome amortis par l'abri), plancherée
 * par la bulle d'un feu. Aucune fonction transcendante (seul `sqrt`, autorisé).
 */
import { BALANCE } from './balance'
import { elevationAt, terrainAt } from './map'
import { getGameTime } from './time'
import type { SimState } from './sim'

const T = BALANCE.TEMPERATURE

function clampTemp(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/** Sur l'empreinte d'une structure à toit (maison) → abrité. */
export function isSheltered(state: SimState, tx: number, ty: number): boolean {
  return state.structures.some((s) => s.tx === tx && s.ty === ty && s.type === 'house')
}

/** Réchauffement du feu le plus proche : FIRE_WARMTH au contact, linéaire → 0 à FIRE_RANGE. */
export function fireBubble(state: SimState, x: number, y: number): number {
  let best = 0
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    const dx = s.tx - x
    const dy = s.ty - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist >= T.FIRE_RANGE) continue
    const warmth = T.FIRE_WARMTH * (1 - dist / T.FIRE_RANGE)
    if (warmth > best) best = warmth
  }
  return best
}

/** Température ambiante cible (0-100) au lieu (x,y) et à l'instant courant. */
export function ambientTemperature(state: SimState, x: number, y: number): number {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  const time = getGameTime(state)
  const elev = elevationAt(state.map, tx, ty)
  const biome = T.BIOME_OFFSET[terrainAt(state.map, tx, ty)] ?? 0

  const base = T.BASE - elev * T.ALT_COLD - T.ACT_COLD[time.act - 1]! // non coupé par un toit
  const exposed = biome - (time.isNight ? T.NIGHT_COLD : 0) // amorti par l'abri
  const shelter = isSheltered(state, tx, ty) ? T.SHELTER_FACTOR : 1
  const ambient = clampTemp(base + shelter * exposed)

  return Math.max(ambient, fireBubble(state, x, y)) // le feu ne peut que réchauffer
}
```

Dans `index.ts`, ajouter :
```ts
export { ambientTemperature } from './temperature'
```

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts && pnpm check && pnpm lint`
Expected: PASS ; lint vert (seul `sqrt` — autorisé).

- [ ] **Step 5 : Commit**

```bash
git add packages/sim/src/temperature.ts packages/sim/src/temperature.test.ts packages/sim/src/balance.ts packages/sim/src/index.ts
git commit -m "feat(sim): ambientTemperature — cible thermostat (altitude/biome/nuit/acte/feu/abri)"
```

---

### Task 3 : Dérive — `advanceTemperature` dans le tick

**Files:**
- Modify: `packages/sim/src/temperature.ts` (`driftStep`, `advanceTemperature`)
- Modify: `packages/sim/src/balance.ts` (`K_DRIFT`, `INSULATION_BODY`)
- Modify: `packages/sim/src/sim.ts` (appel dans `step`, après `advanceEconomy`)
- Modify: `packages/sim/src/index.ts` (export `advanceTemperature`)
- Test: `packages/sim/src/temperature.test.ts`

**Interfaces:**
- Produces: `driftStep(current, ambient, insulation): number` (pur) ; `advanceTemperature(state): void`.

- [ ] **Step 1 : Test qui échoue**

Ajouter dans `temperature.test.ts` :
```ts
import { advanceTemperature, driftStep } from './temperature'

describe('dérive thermostat', () => {
  it('driftStep rapproche de l\'ambiant ; une meilleure isolation ralentit', () => {
    const d1 = driftStep(100, 0, 1)
    const d2 = driftStep(100, 0, 2)
    expect(d1).toBeLessThan(100) // refroidit vers 0
    expect(100 - d2).toBeLessThan(100 - d1) // isolation 2 → moins de perte
  })

  it('un humain sur glacier refroidit strictement', () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85)
    const e = spawn(state, 5, 5)
    const before = e.temperature
    advanceTemperature(state)
    expect(e.temperature).toBeLessThan(before)
  })

  it('reste au confort (≥60) sur un ambiant doux, indéfiniment', () => {
    const state = createSim(1, { calendarScale: 1 }) // reste en acte I
    flatMap(state, 1, 0)
    const e = spawn(state, 5, 5)
    for (let i = 0; i < 5000; i++) advanceTemperature(state)
    expect(e.temperature).toBeGreaterThanOrEqual(60)
  })

  it('les monstres sont ignorés (pas de température)', () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85)
    const e = spawn(state, 5, 5)
    state.monsters.push({ entityId: e.id, type: 'zombie' } as never)
    const before = e.temperature
    advanceTemperature(state)
    expect(e.temperature).toBe(before)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts`
Expected: FAIL — `advanceTemperature`/`driftStep` introuvables.

- [ ] **Step 3 : Implémenter**

Dans `balance.ts`, ajouter au bloc `TEMPERATURE` :
```ts
  /** Fraction de l'écart à l'ambiant comblée par tick (÷ isolation). Calibrage :
   *  ~2 min réelles vers l'engourdissement, ~6 min vers l'hypothermie à ambiant 0. */
  K_DRIFT: 0.0002,
  /** Isolation du corps nu (stub ; la Couture la fera monter plus tard). */
  INSULATION_BODY: 1,
```

Dans `temperature.ts` :
```ts
/** Un pas de dérive vers l'ambiant, freiné par l'isolation. Pur. */
export function driftStep(current: number, ambient: number, insulation: number): number {
  return current + ((ambient - current) * T.K_DRIFT) / insulation
}

/** Fait dériver chaque humain vers son ambiant. Une étape de tick. */
export function advanceTemperature(state: SimState): void {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  for (const entity of state.entities) {
    if (monsterIds.has(entity.id)) continue // pas de température pour les monstres
    const ambient = ambientTemperature(state, entity.x, entity.y)
    entity.temperature = clampTemp(driftStep(entity.temperature, ambient, T.INSULATION_BODY))
  }
}
```

Dans `sim.ts`, dans `step`, juste après `advanceEconomy(state)` :
```ts
  advanceTemperature(state)
```
et importer en tête : `import { advanceTemperature } from './temperature'`.

Dans `index.ts`, compléter l'export : `export { ambientTemperature, advanceTemperature } from './temperature'`.

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/sim/src/temperature.ts packages/sim/src/balance.ts packages/sim/src/sim.ts packages/sim/src/index.ts
git commit -m "feat(sim): dérive thermostat — advanceTemperature dans le tick"
```

---

### Task 4 : Hypothermie — dégâts PV et cause de mort `cold`

**Files:**
- Modify: `packages/sim/src/balance.ts` (`COMFORT`, `HYPOTHERMIA`, `HYPOTHERMIA_DAMAGE_MAX`)
- Modify: `packages/sim/src/events.ts` (`cause` sur `entity_died`)
- Modify: `packages/sim/src/combat.ts` (`die` gagne `cause`, exporté)
- Modify: `packages/sim/src/temperature.ts` (`coldDamagePerTick`, dégâts dans `advanceTemperature`)
- Test: `packages/sim/src/temperature.test.ts`

**Interfaces:**
- Consumes: `die(state, entity, byEntityId, cause?)` de `combat.ts`.
- Produces: `coldDamagePerTick(temp): number` ; event `entity_died` avec `cause?: 'cold'`.

- [ ] **Step 1 : Test qui échoue**

Ajouter dans `temperature.test.ts` :
```ts
import { coldDamagePerTick } from './temperature'

describe('hypothermie', () => {
  it('aucun dégât au-dessus du seuil, dégât croissant en dessous', () => {
    expect(coldDamagePerTick(60)).toBe(0)
    expect(coldDamagePerTick(20)).toBe(0)
    expect(coldDamagePerTick(10)).toBeGreaterThan(0)
    expect(coldDamagePerTick(0)).toBeGreaterThan(coldDamagePerTick(10))
  })

  it('mourir de froid émet entity_died cause=cold', () => {
    const state = createSim(1)
    flatMap(state, 15, 0.85)
    const e = spawn(state, 5, 5)
    e.temperature = 0
    e.hp = 1
    state.events.length = 0
    advanceTemperature(state)
    const died = state.events.find((ev) => ev.type === 'entity_died')
    expect(died).toBeDefined()
    expect((died as { cause?: string }).cause).toBe('cold')
    expect(e.hp).toBe(0)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts`
Expected: FAIL — `coldDamagePerTick` introuvable / `cause` absent.

- [ ] **Step 3 : Implémenter**

Dans `balance.ts`, ajouter au bloc `TEMPERATURE` :
```ts
  COMFORT: 60, // au-dessus : aucun effet
  HYPOTHERMIA: 20, // en dessous : dégâts
  HYPOTHERMIA_DAMAGE_MAX: 0.3, // PV/tick à température 0
```

Dans `events.ts`, sur la variante `entity_died`, ajouter le champ optionnel :
```ts
  | { type: 'entity_died'; tick: number; entityId: number; byEntityId: number; wasMonster: boolean; cause?: 'cold' }
```

Dans `combat.ts`, rendre `die` exporté avec `cause` optionnel, et l'émettre :
```ts
export function die(state: SimState, entity: Entity, byEntityId: number, cause?: 'cold'): void {
  const monster = state.monsters.find((m) => m.entityId === entity.id)
  emitEvent(state, {
    type: 'entity_died',
    tick: state.tick,
    entityId: entity.id,
    byEntityId,
    wasMonster: monster !== undefined,
    ...(cause ? { cause } : {}),
  })
  // … (reste du corps inchangé)
```
Les appels existants (`die(state, target, byEntityId)`, `die(state, entity, 0)`) restent valides.

Dans `temperature.ts`, importer `die` et brancher les dégâts :
```ts
import { die } from './combat'
```
```ts
/** Dégâts PV/tick dus au froid : 0 au-dessus de HYPOTHERMIA, linéaire jusqu'à 0. */
export function coldDamagePerTick(temp: number): number {
  if (temp >= T.HYPOTHERMIA) return 0
  return ((T.HYPOTHERMIA - temp) / T.HYPOTHERMIA) * T.HYPOTHERMIA_DAMAGE_MAX
}
```
Dans `advanceTemperature`, après la mise à jour de `entity.temperature` :
```ts
    const dmg = coldDamagePerTick(entity.temperature)
    if (dmg > 0) {
      const before = entity.hp
      entity.hp = Math.max(0, entity.hp - dmg)
      if (before > 0 && entity.hp <= 0) die(state, entity, 0, 'cold')
    }
```

> **Cycle d'imports** : `temperature.ts` importera `die` de `combat.ts`. Vérifier au Step 4 qu'aucun cycle de *valeur* n'apparaît (les deux n'importent `sim`/`balance` que pour types + constantes). Si le build signale un cycle, ne PAS contourner à la va-vite — le remonter (déplacer `die` dans un module neutre serait la vraie correction).

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts && pnpm check && pnpm --filter @braises/sim test`
Expected: PASS, aucun cycle.

- [ ] **Step 5 : Commit**

```bash
git add packages/sim/src/temperature.ts packages/sim/src/balance.ts packages/sim/src/events.ts packages/sim/src/combat.ts
git commit -m "feat(sim): hypothermie — dégâts de froid et cause de mort cold"
```

---

### Task 5 : Engourdissement — malus d'endurance et de vitesse

**Files:**
- Modify: `packages/sim/src/balance.ts` (`SPEED_FLOOR`, `STAMINA_FLOOR`)
- Modify: `packages/sim/src/temperature.ts` (`coldEffectRamp`, `coldSpeedFactor`, `coldStaminaRegenFactor`)
- Modify: `packages/sim/src/sim.ts` (`speedScaleFor`)
- Modify: `packages/sim/src/combat.ts` (régén d'endurance)
- Test: `packages/sim/src/temperature.test.ts`

**Interfaces:**
- Produces: `coldEffectRamp(temp)`, `coldSpeedFactor(temp)`, `coldStaminaRegenFactor(temp)`.
- Consumes: `speedScaleFor(entity, opts)` (sim.ts:200) ; régén d'endurance (combat.ts:~347).

- [ ] **Step 1 : Test qui échoue**

Ajouter dans `temperature.test.ts` :
```ts
import { coldEffectRamp, coldSpeedFactor, coldStaminaRegenFactor } from './temperature'

describe('engourdissement (malus)', () => {
  it('rampe : 0 au confort, 1 à l\'hypothermie, linéaire', () => {
    expect(coldEffectRamp(60)).toBe(0)
    expect(coldEffectRamp(20)).toBe(1)
    expect(coldEffectRamp(40)).toBeCloseTo(0.5, 5)
  })
  it('facteurs = 1 au confort, < 1 dès l\'engourdissement', () => {
    expect(coldSpeedFactor(70)).toBe(1)
    expect(coldStaminaRegenFactor(70)).toBe(1)
    expect(coldSpeedFactor(20)).toBeLessThan(1)
    expect(coldStaminaRegenFactor(20)).toBeLessThan(1)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts`
Expected: FAIL — fonctions introuvables.

- [ ] **Step 3 : Implémenter**

Dans `balance.ts`, ajouter au bloc `TEMPERATURE` :
```ts
  SPEED_FLOOR: 0.6, // vitesse au plus froid
  STAMINA_FLOOR: 0.5, // régén d'endurance au plus froid
```

Dans `temperature.ts` :
```ts
/** 0 au confort (≥60), 1 à l'hypothermie (≤20), linéaire entre les deux. */
export function coldEffectRamp(temp: number): number {
  if (temp >= T.COMFORT) return 0
  if (temp <= T.HYPOTHERMIA) return 1
  return (T.COMFORT - temp) / (T.COMFORT - T.HYPOTHERMIA)
}

export function coldSpeedFactor(temp: number): number {
  return 1 - coldEffectRamp(temp) * (1 - T.SPEED_FLOOR)
}

export function coldStaminaRegenFactor(temp: number): number {
  return 1 - coldEffectRamp(temp) * (1 - T.STAMINA_FLOOR)
}
```

Dans `sim.ts`, `speedScaleFor` : ajouter `'temperature'` au `Pick<Entity, …>` du 1er paramètre, et appliquer près de `if (entity.hunger <= 0) scale *= BALANCE.HUNGER_SPEED_MALUS` :
```ts
  scale *= coldSpeedFactor(entity.temperature)
```
Compléter l'import en tête : `import { advanceTemperature, coldSpeedFactor } from './temperature'`.

Dans `combat.ts`, à la régén d'endurance (après `let perS = entity.moved ? … : …`) :
```ts
    perS *= coldStaminaRegenFactor(entity.temperature)
```
Importer : `import { coldStaminaRegenFactor } from './temperature'`.

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts && pnpm check && pnpm lint && pnpm --filter @braises/sim test`
Expected: tout vert.

- [ ] **Step 5 : Commit**

```bash
git add packages/sim/src/temperature.ts packages/sim/src/balance.ts packages/sim/src/sim.ts packages/sim/src/combat.ts
git commit -m "feat(sim): engourdissement — malus de vitesse et de régén d'endurance"
```

---

### Task 6 : Intégration — tyrannie de l'acte, suite complète, banc scénario

**Files:**
- Test: `packages/sim/src/temperature.test.ts`
- Verify: suite `/sim` + `pnpm scenario`

- [ ] **Step 1 : Test de monotonie d'acte (déterministe)**

`TICKS_PER_SEASON_DAY` (= 1 728 000) est un multiple exact de `TICKS_PER_CYCLE` (= 57 600) → `tick = (jour−1)×TICKS_PER_SEASON_DAY` retombe toujours à l'aube (même phase, jour). Avec `calendarScale = 1`, `seasonDay = jour`. On isole donc l'acte. Ajouter :
```ts
import { TICKS_PER_SEASON_DAY } from './time'

describe('tyrannie de l\'acte', () => {
  it('même lieu/heure : ambiant strictement décroissant I → II → III', () => {
    const ambientAtDay = (day: number): number => {
      const state = createSim(1, { calendarScale: 1 })
      flatMap(state, 9 /* scree, offset biome 0 */, 0.4)
      state.tick = (day - 1) * TICKS_PER_SEASON_DAY
      return ambientTemperature(state, 5, 5)
    }
    const a1 = ambientAtDay(10) // acte I  (≤ 21)
    const a2 = ambientAtDay(30) // acte II (Grand Froid, 22-42)
    const a3 = ambientAtDay(50) // acte III (Cendre, > 42)
    expect(a2).toBeLessThan(a1)
    expect(a3).toBeLessThan(a2)
  })
})
```

- [ ] **Step 2 : Vérifier (vert)**

Run: `pnpm --filter @braises/sim exec vitest run src/temperature.test.ts`
Expected: PASS (a1≈62, a2≈37, a3≈22).

- [ ] **Step 3 : Suite complète + check/lint**

Run: `pnpm check && pnpm lint && pnpm --filter @braises/sim test`
Expected: vert (le champ `temperature` est déterministe → `sim.test.ts`/`replay.test.ts`/`events.test.ts` restent verts).

- [ ] **Step 4 : Banc scénario (non-régression écosystème)**

Run: `pnpm scenario`
**Observer l'effet des morts de froid PNJ sur la saison 60 jours. Deux issues :**
- **Vert (0 affamé, caractères tenus)** → parfait.
- **Régression (PNJ gelés)** → plausible si les PNJ s'aventurent en zones froides sans IA de mise à l'abri. **Ne pas bricoler les nombres pour masquer.** C'est le signal que l'**IA PNJ de recherche de chaleur** (gagner le Foyer la nuit / au Grand Froid) est le prochain maillon — même famille que la mémoire `[[milice-livelock]]` (besoin non arbitré). Contingence à **décider avec Alexis, pas unilatéralement** : garder les dégâts létaux pour le joueur mais poser un garde sur les dégâts (pas la jauge) pour les PNJ en attendant l'IA. Remonter le constat avec les chiffres du banc.

- [ ] **Step 5 : Commit**

```bash
git add packages/sim/src/temperature.test.ts
git commit -m "test(sim): température — tyrannie de l'acte + intégration verte"
```

---

## Notes d'exécution

- **Après ce plan, reprendre la file parquée** — ne pas la perdre :
  1. **Levée Cendreux** (lore A×C, task #3 parké) : un mort `cause:'cold'`, **seul** (aucun allié proche) et **loin d'un feu** se relève en Cendreux après un délai ; repaires = lieux de catastrophe.
  2. **Placement des POIs de la Vallée alpine** (`docs/superpowers/specs/2026-07-08-vallee-alpine-poi-design.md`) — le but initial de la session (Poisson-disk + table par biome, ~90 POIs).
- **Calibrage** : tous les nombres de `TEMPERATURE` sont des ordres de grandeur (règle projet) — réglage fin en playtest, pas dans ce plan.
