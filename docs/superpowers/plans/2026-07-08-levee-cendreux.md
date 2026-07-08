# La levée des Cendreux — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un mort `cause:'cold'`, seul et loin d'un feu, se relève en Cendreux (nouveau monstre lent, PV bas / dégâts hauts, IA jour/nuit en A\*) qui porte le loot du défunt.

**Architecture:** La mort (`die()`) marque un cadavre non-décantable (`risesAt`) si le critère tient ; un système `advanceCendreux` spawn le monstre à l'échéance (ou annule si un feu l'a veillé) ; une branche `cendreux` dans `advanceMonsters` porte l'IA jour/nuit (A\* via `findPath`). Le type et les seuils vivent dans `balance.ts`.

**Tech Stack:** TypeScript pur (`packages/sim`), Vitest.

## Global Constraints

- **`/sim` pur** ; **déterministe au bit près** (`+ - * /`, `sqrt/abs/floor/min/max` ; pas de `Math.random`/`Date`/transcendantes — `findPath`, `getGameTime`, `roll(state)` sont déjà purs/déterministes).
- **`SimState` JSON-sérialisable** : `Corpse.risesAt?: number` et `Monster.path?: {tx,ty}[]` sont OK (types plats).
- **Équilibrage dans `balance.ts`** : bloc `CENDREUX` (seuils) + `MONSTER_DEFS.cendreux` (stats) ; pas de nombre magique dans la logique.
- **Événements de domaine** : la levée émet un `SimEvent` `cendreux_risen` (consommable par la chronique) — instrumenté au moment où la logique l'exécute, pas après coup.
- **NE PAS toucher** les branches `zombie`/`boar` de `advanceMonsters` (IA scopée au type `cendreux`).
- Commentaires en **français**.
- **API (vérifiée)** : `die(state,entity,byEntityId,cause?)` (combat.ts:256) ; `Corpse {id,x,y,inventory,decayAt}` (combat.ts:19) ; décantation `combat.ts:360` `corpses.filter(c => c.decayAt > tick)` ; `spawnMonster(state,type,x,y): number` (monsters.ts:29, entity.inventory init `{}`) ; `Monster` (monsters.ts:17) ; `findPath(world,{tx,ty},{tx,ty}): {tx,ty}[]|null` ; monde monstre = `{map,structures,nodes,moverVillageId:null}` ; `getGameTime(state).isNight` ; `startAttack(state,entity,dx,dy,{windupTicks,damage})` ; `distSq` (geometry). Nouveau `ticksFor` déjà utilisé dans `balance.ts`.
- Vérifs avant chaque commit : `pnpm check && pnpm lint && pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts`.

## File Structure

- **Modify** `packages/sim/src/balance.ts` — `MonsterType` gagne `'cendreux'` ; `MONSTER_DEFS.cendreux` ; bloc `CENDREUX`.
- **Modify** `packages/sim/src/combat.ts` — `Corpse.risesAt?` ; critère + cadavre marqué dans `die()` ; loot-merge ; filtre de décantation.
- **Modify** `packages/sim/src/events.ts` — `SimEvent` `cendreux_risen`.
- **Create** `packages/sim/src/cendreux.ts` — `willRiseAsCendreux`, `advanceCendreux` (réveil), `cendreuxStep` (IA), `nearestWarmth`.
- **Modify** `packages/sim/src/monsters.ts` — branche `cendreux` (appelle `cendreuxStep`) ; `Monster.path?`.
- **Modify** `packages/sim/src/sim.ts` — `advanceCendreux(state)` dans `step`.
- **Modify** `packages/sim/src/index.ts` — exports.
- **Create** `packages/sim/src/cendreux.test.ts` — tests.

---

### Task 1 : Fondation — type `cendreux`, stats, champs d'état, constantes

**Files:**
- Modify: `packages/sim/src/balance.ts` (`MonsterType`, `MONSTER_DEFS`, bloc `CENDREUX`)
- Modify: `packages/sim/src/combat.ts` (`Corpse.risesAt?`)
- Modify: `packages/sim/src/monsters.ts` (`Monster.path?`)
- Test: `packages/sim/src/cendreux.test.ts` (créer)

**Interfaces:**
- Produces: `MONSTER_DEFS.cendreux` ; `CENDREUX` (balance) ; `Corpse.risesAt?: number` ; `Monster.path?: {tx,ty}[]`.

- [ ] **Step 1 : Test qui échoue**

Créer `packages/sim/src/cendreux.test.ts` :
```ts
import { describe, it, expect } from 'vitest'
import { MONSTER_DEFS, CENDREUX } from './balance'

describe('type cendreux (fondation)', () => {
  it('MONSTER_DEFS.cendreux : PV bas, dégâts hauts, très lent', () => {
    const d = MONSTER_DEFS.cendreux
    expect(d.hp).toBe(20) // 2 coups d'arme basique
    expect(d.damage).toBe(34) // 3 coups tuent un avatar 100 PV
    expect(d.speed).toBeLessThan(2) // très lent (joueur = 4)
  })
  it('constantes CENDREUX présentes', () => {
    expect(CENDREUX.WITNESS_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.HEARTH_WARD_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.RISE_DELAY).toBeGreaterThan(0)
    expect(CENDREUX.WARMTH_SEEK_RANGE).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm --filter @braises/sim exec vitest run src/cendreux.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter**

Dans `balance.ts` : `export type MonsterType = 'zombie' | 'boar' | 'cendreux'`. Ajouter à `MONSTER_DEFS` :
```ts
  cendreux: {
    hp: 20, damage: 34, speed: 1.3,
    windupTicks: ticksFor(0.7), attackCooldownTicks: ticksFor(2.5), aggroRange: 5,
    thinkEveryTicks: ticksFor(0.5), wanderChance: 0, chargeChance: 0,
    loot: {}, // il porte celui du cadavre (voir levée)
  },
```
Ajouter le bloc exporté :
```ts
/** La levée des Cendreux (spec 2026-07-08). Ordres de grandeur, calibrage playtest. */
export const CENDREUX = {
  WITNESS_RADIUS: 8, // « seul » : aucun allié vivant dans ce rayon à la mort
  HEARTH_WARD_RADIUS: 12, // « loin d'un feu » : aucune structure feu (mort ET réveil)
  RISE_DELAY: ticksFor(300), // délai mort→levée (~5 min ; le cadavre marqué ne décante pas d'ici là)
  WARMTH_SEEK_RANGE: 20, // rayon de recherche de chaleur la nuit
}
```
Dans `combat.ts`, ajouter à l'interface `Corpse` : `risesAt?: number`.
Dans `monsters.ts`, ajouter à l'interface `Monster` : `path?: { tx: number; ty: number }[]`.

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/cendreux.test.ts && pnpm check` → PASS.

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/balance.ts packages/sim/src/combat.ts packages/sim/src/monsters.ts packages/sim/src/cendreux.test.ts
git commit -m "feat(sim): fondation Cendreux — type, stats, risesAt, path, constantes"
```

---

### Task 2 : La levée — critère à la mort + cadavre non-décantable

**Files:**
- Create: `packages/sim/src/cendreux.ts` (`willRiseAsCendreux`)
- Modify: `packages/sim/src/combat.ts` (`die()` : marquage ; filtre de décantation)
- Test: `packages/sim/src/cendreux.test.ts`

**Interfaces:**
- Produces: `willRiseAsCendreux(state, entity): boolean`. `die()` crée un cadavre `risesAt` si critère.

- [ ] **Step 1 : Test qui échoue**

Ajouter dans `cendreux.test.ts` :
```ts
import { createSim, spawnEntity, type SimState } from './sim'
import { die } from './combat'
import { CENDREUX } from './balance'
import { COMBAT } from './balance'

function humanAt(state: SimState, x: number, y: number) {
  const id = spawnEntity(state, x, y)
  const e = state.entities.find((en) => en.id === id)!
  return e
}

describe('la levée — critère à la mort', () => {
  it('mort cold, seul, loin d\'un feu → cadavre marqué risesAt', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 5) < 1 && Math.abs(c.y - 5) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })
  it('mort cold mais un feu à portée → pas de marquage', () => {
    const state = createSim(1)
    state.structures.push({ type: 'fire', tx: 5, ty: 5, villageId: 0 } as never)
    const e = humanAt(state, 6, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)
    expect(corpse).toBeUndefined()
  })
  it('mort non-cold → pas de marquage', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0) // combat
    expect(state.corpses.find((c) => c.risesAt !== undefined)).toBeUndefined()
  })
})
```
> (Le cas « un allié à portée → pas de marquage » nécessite un village ; il est couvert par le critère `willRiseAsCendreux` — ajouter un test unitaire direct de `willRiseAsCendreux` si le montage village est simple, sinon s'appuyer sur la vérification du feu + non-cold ici et le test d'intégration Task 5.)

- [ ] **Step 2 : Vérifier l'échec** — FAIL (pas de `risesAt`).

- [ ] **Step 3 : Implémenter**

Créer `packages/sim/src/cendreux.ts` :
```ts
/**
 * La levée des Cendreux (spec 2026-07-08). Critère de mort, réveil, IA. Pur/déterministe.
 */
import { CENDREUX } from './balance'
import { distSq } from './geometry'
import type { Entity, SimState } from './sim'

/** Vrai si cette mort (déjà connue `cold`) donnera un Cendreux : seul ET loin d'un feu. */
export function willRiseAsCendreux(state: SimState, entity: Entity): boolean {
  // Loin d'un feu : aucune structure feu dans HEARTH_WARD_RADIUS.
  const nearFire = state.structures.some(
    (s) => s.type === 'fire' && distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y) <= CENDREUX.HEARTH_WARD_RADIUS ** 2,
  )
  if (nearFire) return false
  // Seul : aucun allié vivant (même village) dans WITNESS_RADIUS.
  const village = state.villages.find((v) => v.memberIds.includes(entity.id))
  if (village) {
    const hasAlly = state.entities.some(
      (e) => e.id !== entity.id && e.hp > 0 && village.memberIds.includes(e.id) &&
        distSq(e.x, e.y, entity.x, entity.y) <= CENDREUX.WITNESS_RADIUS ** 2,
    )
    if (hasAlly) return false
  }
  return true
}
```
> `**` est interdit en /sim (invariant #2). **Remplacer `X ** 2` par `X * X`** dans le code ci-dessus (l'écrire avec `const r = CENDREUX.HEARTH_WARD_RADIUS; … <= r * r`). Ne pas livrer de `**`.

Dans `combat.ts`, `die()` : importer `willRiseAsCendreux` et `CENDREUX`. Remplacer le bloc de création du cadavre (actuellement `if (Object.keys(loot).length > 0) { push corpse decayAt }`) par :
```ts
  const willRise = !monster && cause === 'cold' && willRiseAsCendreux(state, entity)
  if (willRise) {
    state.corpses.push({
      id: state.nextCorpseId, x: entity.x, y: entity.y, inventory: loot,
      decayAt: state.tick + COMBAT.CORPSE_TICKS, risesAt: state.tick + CENDREUX.RISE_DELAY,
    })
    state.nextCorpseId += 1
  } else if (Object.keys(loot).length > 0) {
    state.corpses.push({
      id: state.nextCorpseId, x: entity.x, y: entity.y, inventory: loot,
      decayAt: state.tick + COMBAT.CORPSE_TICKS,
    })
    state.nextCorpseId += 1
  }
```
Filtre de décantation (combat.ts:360) : ne pas décanter un cadavre marqué —
`state.corpses = state.corpses.filter((c) => c.risesAt !== undefined || c.decayAt > state.tick)`.

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/cendreux.test.ts && pnpm check && pnpm lint` → PASS (vérifier l'absence de `**`).

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/cendreux.ts packages/sim/src/combat.ts packages/sim/src/cendreux.test.ts
git commit -m "feat(sim): levée — critère de mort (cold+seul+loin d'un feu) → cadavre marqué"
```

---

### Task 3 : Le réveil — `advanceCendreux` (spawn/héritage/annulation) + événement

**Files:**
- Modify: `packages/sim/src/cendreux.ts` (`advanceCendreux`)
- Modify: `packages/sim/src/events.ts` (`cendreux_risen`)
- Modify: `packages/sim/src/combat.ts` (`die()` loot-merge du monstre)
- Modify: `packages/sim/src/sim.ts` (appel dans `step`)
- Modify: `packages/sim/src/index.ts` (export `advanceCendreux`)
- Test: `packages/sim/src/cendreux.test.ts`

**Interfaces:**
- Consumes: `spawnMonster` (`./monsters`), `emitEvent` (`./events`).
- Produces: `advanceCendreux(state): void` ; event `cendreux_risen`.

- [ ] **Step 1 : Test qui échoue**
```ts
import { advanceCendreux } from './cendreux'
import { step } from './sim'

describe('le réveil', () => {
  it('à risesAt : un cendreux naît, porte le loot, le cadavre disparaît, event émis', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    e.inventory = { berries: 3 }
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.tick = corpse.risesAt!
    state.events.length = 0
    advanceCendreux(state)
    const risen = state.monsters.find((m) => m.type === 'cendreux')
    expect(risen).toBeDefined()
    const ent = state.entities.find((en) => en.id === risen!.entityId)!
    expect(ent.inventory.berries).toBe(3) // loot hérité
    expect(state.corpses.find((c) => c.id === corpse.id)).toBeUndefined()
    expect(state.events.some((ev) => ev.type === 'cendreux_risen')).toBe(true)
  })
  it('annulation : un feu à portée au réveil → pas de cendreux', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.structures.push({ type: 'fire', tx: 5, ty: 5, villageId: 0 } as never) // veillé
    state.tick = corpse.risesAt!
    advanceCendreux(state)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeUndefined()
    expect(state.corpses.find((c) => c.id === corpse.id)?.risesAt).toBeUndefined()
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — FAIL.

- [ ] **Step 3 : Implémenter**

Dans `events.ts`, ajouter à l'union `SimEvent` :
```ts
  | { type: 'cendreux_risen'; tick: number; entityId: number; x: number; y: number }
```
Dans `combat.ts`, la ligne de loot du monstre devient (pour que tuer un Cendreux redépose son loot hérité) :
```ts
  const loot = monster ? { ...MONSTER_DEFS[monster.type].loot, ...entity.inventory } : { ...entity.inventory }
```
Dans `cendreux.ts`, ajouter (importer `spawnMonster` de `./monsters`, `emitEvent` de `./events`, `COMBAT`/`CENDREUX` de `./balance`, `distSq`) :
```ts
/** Réveil : les cadavres marqués se lèvent en Cendreux (ou sont annulés par un feu). */
export function advanceCendreux(state: SimState): void {
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  for (const corpse of [...state.corpses]) {
    if (corpse.risesAt === undefined || state.tick < corpse.risesAt) continue
    // Veillé par un feu à portée → annulation.
    const warded = state.structures.some(
      (s) => s.type === 'fire' && distSq(s.tx + 0.5, s.ty + 0.5, corpse.x, corpse.y) <= ward * ward,
    )
    if (warded) {
      corpse.risesAt = undefined
      corpse.decayAt = state.tick + COMBAT.CORPSE_TICKS
      continue
    }
    // Levée : le cadavre devient le Cendreux, portant son loot.
    const id = spawnMonster(state, 'cendreux', corpse.x, corpse.y)
    const ent = state.entities.find((e) => e.id === id)!
    ent.inventory = { ...corpse.inventory }
    state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
    emitEvent(state, { type: 'cendreux_risen', tick: state.tick, entityId: id, x: corpse.x, y: corpse.y })
  }
}
```
Dans `sim.ts`, dans `step`, après `advanceMonsters(state)` : `advanceCendreux(state)` (+ import). Dans `index.ts` : `export { advanceCendreux, willRiseAsCendreux } from './cendreux'`.

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/cendreux.test.ts && pnpm check && pnpm --filter @braises/sim test` (hors scénario) → PASS.

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/cendreux.ts packages/sim/src/events.ts packages/sim/src/combat.ts packages/sim/src/sim.ts packages/sim/src/index.ts packages/sim/src/cendreux.test.ts
git commit -m "feat(sim): réveil — le cadavre se lève en Cendreux (loot hérité, event, annulation par le feu)"
```

---

### Task 4 : L'IA `cendreux` — jour/nuit en A\*

**Files:**
- Modify: `packages/sim/src/cendreux.ts` (`cendreuxStep`, `nearestWarmth`)
- Modify: `packages/sim/src/monsters.ts` (branche `cendreux` dans `advanceMonsters`)
- Test: `packages/sim/src/cendreux.test.ts`

**Interfaces:**
- Consumes: `findPath` (`./pathfinding`), `getGameTime` (`./time`), `startAttack` (`./combat`), `moveToward`/`nearestPrey` (monsters.ts — les exporter si besoin).
- Produces: `cendreuxStep(state, monster, entity)` ; `nearestWarmth(state, entity, range)`.

- [ ] **Step 1 : Tests qui échouent**
```ts
import { spawnMonster } from './monsters'
import { advanceMonsters } from './monsters'
import { DAY_TICKS_PER_CYCLE } from './time'

describe('IA cendreux (jour/nuit)', () => {
  it('jour, sans proie → immobile', () => {
    const state = createSim(1) // tick 0 = jour
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const ent = state.entities.find((e) => e.id === id)!
    const x0 = ent.x, y0 = ent.y
    for (let i = 0; i < 40; i++) advanceMonsters(state)
    expect(ent.x).toBe(x0); expect(ent.y).toBe(y0) // dormant
  })
  it('jour, une proie en vue → se rapproche (chemin posé)', () => {
    const state = createSim(1)
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    humanAt(state, 8, 5) // proie dans aggroRange 5
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
  })
  it('nuit → dérive vers une source de chaleur (feu) dans le rayon', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    state.structures.push({ type: 'fire', tx: 15, ty: 5, villageId: 0 } as never) // dans WARMTH_SEEK_RANGE 20
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — FAIL (branche cendreux absente).

- [ ] **Step 3 : Implémenter**

Dans `monsters.ts` : exporter `moveToward` et `nearestPrey` (retirer `function` privé → `export function`) pour réutilisation. Dans `advanceMonsters`, tout en haut de la boucle (avant la branche `zombie`) :
```ts
    if (monster.type === 'cendreux') {
      cendreuxStep(state, monster, entity)
      continue
    }
```
(importer `cendreuxStep` de `./cendreux`.)

Dans `cendreux.ts` (importer `findPath` de `./pathfinding`, `getGameTime` de `./time`, `startAttack`/`COMBAT` de `./combat`, `MONSTER_DEFS` de `./balance`, `moveToward`/`nearestPrey` de `./monsters`, `distSq`, types `Monster`) :
```ts
/** La source de chaleur la plus proche dans `range` : un feu OU un vivant. */
export function nearestWarmth(state: SimState, entity: Entity, range: number): { x: number; y: number; prey?: Entity } | undefined {
  const r2 = range * range
  let best: { x: number; y: number; prey?: Entity } | undefined
  let bestD = r2
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    const d = distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y)
    if (d < bestD) { bestD = d; best = { x: s.tx + 0.5, y: s.ty + 0.5 } }
  }
  const prey = nearestPrey(state, entity, range)
  if (prey) {
    const d = distSq(prey.x, prey.y, entity.x, entity.y)
    if (d < bestD) { bestD = d; best = { x: prey.x, y: prey.y, prey } }
  }
  return best
}

/** IA du Cendreux : dormant le jour (rampe vers une proie en vue), cherche la chaleur la nuit. A*. */
export function cendreuxStep(state: SimState, monster: Monster, entity: Entity): void {
  const def = MONSTER_DEFS.cendreux
  if (entity.windup) return
  const night = getGameTime(state).isNight

  // Cible du tick de décision.
  if (state.tick >= (monster.thinkAt ?? 0)) {
    monster.thinkAt = state.tick + def.thinkEveryTicks
    let goal: { x: number; y: number; prey?: Entity } | undefined
    if (night) {
      goal = nearestWarmth(state, entity, CENDREUX.WARMTH_SEEK_RANGE)
    } else {
      const prey = nearestPrey(state, entity, def.aggroRange)
      if (prey) goal = { x: prey.x, y: prey.y, prey }
    }
    monster.targetId = goal?.prey?.id ?? null
    if (goal) {
      const world = { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null }
      const path = findPath(world, { tx: Math.floor(entity.x), ty: Math.floor(entity.y) }, { tx: Math.floor(goal.x), ty: Math.floor(goal.y) })
      monster.path = path ?? []
    } else {
      monster.path = []
    }
  }

  // Attaque si une proie ciblée est au contact.
  const target = monster.targetId !== null ? state.entities.find((e) => e.id === monster.targetId) : undefined
  if (target && distSq(entity.x, entity.y, target.x, target.y) <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
    if (state.tick >= entity.cooldownUntil && startAttack(state, entity, target.x - entity.x, target.y - entity.y, { windupTicks: def.windupTicks, damage: def.damage })) {
      entity.cooldownUntil = state.tick + def.attackCooldownTicks
    }
    return
  }
  // Sinon, avancer d'un pas vers le prochain nœud du chemin (A*).
  const wp = monster.path?.[0]
  if (wp) {
    const dx = wp.tx + 0.5 - entity.x
    const dy = wp.ty + 0.5 - entity.y
    if (dx * dx + dy * dy < 0.45 * 0.45) monster.path!.shift()
    else moveToward(state, monster, entity, wp.tx + 0.5, wp.ty + 0.5, false)
  }
}
```
> `moveToward` applique déjà `def.speed` (vitesse lente du Cendreux). Vérifier sa signature exacte dans `monsters.ts` et l'adapter si besoin (elle prend `(state, monster, entity, tx, ty, flee)`).

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/cendreux.test.ts && pnpm check && pnpm lint` → PASS. Vérifier que `src/monsters` (zombie/boar) reste vert (`pnpm --filter @braises/sim exec vitest run src/monsters.test.ts` s'il existe, sinon la suite).

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/cendreux.ts packages/sim/src/monsters.ts packages/sim/src/cendreux.test.ts
git commit -m "feat(sim): IA Cendreux — dormant le jour, cherche la chaleur la nuit (A*)"
```

---

### Task 5 : Intégration — stats, joueur, déterminisme, non-régression

**Files:**
- Test: `packages/sim/src/cendreux.test.ts`
- Verify: suite `/sim` + `pnpm scenario`

- [ ] **Step 1 : Tests**
```ts
import { MONSTER_DEFS as DEFS } from './balance'

describe('intégration Cendreux', () => {
  it('stats : meurt en 2 coups de hache (10), tue un avatar 100 PV en 3 coups', () => {
    expect(Math.ceil(DEFS.cendreux.hp / 10)).toBe(2) // 2 coups d'arme basique (hache 10)
    expect(Math.ceil(100 / DEFS.cendreux.damage)).toBe(3) // 3 coups sur 100 PV
  })
  it('zombie inchangé (aggro + errance)', () => {
    const state = createSim(1)
    const id = spawnMonster(state, 'zombie', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    humanAt(state, 7, 5)
    advanceMonsters(state)
    expect(monster.targetId).not.toBeNull() // aggro comme avant
  })
})
```

- [ ] **Step 2 : Vérifier** — PASS.

- [ ] **Step 3 : Déterminisme + suite** — `pnpm check && pnpm lint && pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts` → vert (les contrats replay/events restent verts : `risesAt`/`path`/`cendreux` sont déterministes).

- [ ] **Step 4 : Banc scénario** — `pnpm scenario` → **vert** (acte I, vallée chaude : aucune mort de froid → aucune levée ; zombies/hordes inchangés). Si rouge : investiguer/remonter, ne pas masquer.

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/cendreux.test.ts
git commit -m "test(sim): Cendreux — stats, zombie inchangé, non-régression"
```

---

## Notes d'exécution

- **Interdits /sim** : pas de `**` (utiliser `x * x`), pas de transcendante. `findPath`/`getGameTime`/`roll` sont purs.
- **Après ce plan** : la file restante = **placement des POIs de la Vallée alpine** (but initial ; les repaires y placeront des `cendreux`). Vérification profonde optionnelle : l'instrument 60 j confirmera des levées sensées en actes II/III.
- **Calibrage** : stats et seuils `CENDREUX` sont des ordres de grandeur (règle projet).
