# IA PNJ de recherche de chaleur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un besoin critique `handleCold` : un PNJ qui a froid et n'est pas déjà au chaud rentre à son propre Foyer, sans jamais se figer si le feu est inatteignable.

**Architecture:** Nouvelle fonction dans `npc-needs.ts`, sur le modèle exact de `handleSleep`/`handleHunger`, insérée dans la chaîne `advanceNpcs` entre `sleep` et `hunger`. Réutilise les helpers purs `fireBubble`/`isSheltered` (température) et le pathfinding existant `setPathTo`/`followPath`. Un flag `Npc.seekingWarmth` porte l'hystérésis.

**Tech Stack:** TypeScript pur (`packages/sim`), Vitest.

## Global Constraints

- **`/sim` pur** : aucun import Phaser/Colyseus/Node. (invariant #1)
- **Déterministe au bit près** : `+ - * /`, `Math.sqrt/abs/floor/…`, pas de `Math.random`/`Date`/transcendantes. (invariant #2)
- **État JSON-sérialisable** : `Npc.seekingWarmth` est un `boolean` — OK (pas de classe/Map/Set).
- **Équilibrage dans `balance.ts`** : `NPC_COLD_SEEK`/`NPC_COLD_RESUME` dans le bloc `BALANCE`, à côté des autres seuils PNJ (`NPC_ENERGY_SLEEP_THRESHOLD` — accès `BALANCE.NPC_COLD_SEEK`).
- **ANTI-LIVELOCK (leçon `[[milice-livelock]]`)** : si `setPathTo` échoue (feu inatteignable), `handleCold` **rend la main (`return false`)** — jamais de figeage. C'est le point le plus important du plan.
- Commentaires en **français**, identifiants en anglais.
- **API (vérifiée)** : `setPathTo(state,npc,entity,tx,ty): boolean` (true = chemin trouvé). `near(entity,tx,ty,r): boolean`. `fireBubble(state,x,y): number`, `isSheltered(state,tx,ty): boolean` (de `./temperature`). `Npc` interface à npc.ts:38 ; PNJ créé à npc.ts:442-450. Structures : `{type:'fire', tx, ty, villageId, …}`. Helper de test local `npcVillageSim(count, extraNodes?)` dans `npc.test.ts` (village fondé à (12,12) avec un Feu).
- Vérifs avant chaque commit : `pnpm check && pnpm lint && pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts` (verts). Ne pas lancer la suite scénario (lente) sauf en Task 2.

## File Structure

- **Modify** `packages/sim/src/npc.ts` — champ `seekingWarmth` sur `Npc` (interface + init) ; appel `handleCold` dans `advanceNpcs` entre sleep et hunger + import.
- **Modify** `packages/sim/src/npc-needs.ts` — `handleCold` + imports `fireBubble`/`isSheltered`.
- **Modify** `packages/sim/src/balance.ts` — `NPC_COLD_SEEK`/`NPC_COLD_RESUME` dans le bloc `BALANCE`.
- **Modify** `packages/sim/src/npc.test.ts` — tests de `handleCold` (réutilise `npcVillageSim`).

---

### Task 1 : `handleCold` — le besoin réactif

**Files:**
- Modify: `packages/sim/src/npc.ts` (interface `Npc` ~38-47 ; init ~442-450 ; `advanceNpcs` ~403)
- Modify: `packages/sim/src/npc-needs.ts` (nouvelle fonction + imports)
- Modify: `packages/sim/src/balance.ts` (bloc `BALANCE`, près de `NPC_ENERGY_SLEEP_THRESHOLD`)
- Test: `packages/sim/src/npc.test.ts`

**Interfaces:**
- Consumes: `fireBubble`/`isSheltered` (`./temperature`), `setPathTo`/`followPath`/`near`/`Npc` (`./npc`).
- Produces: `handleCold(state, village, npc, entity): boolean` ; `Npc.seekingWarmth: boolean` ; `BALANCE.NPC_COLD_SEEK`/`NPC_COLD_RESUME`.

- [ ] **Step 1 : Tests qui échouent**

Dans `npc.test.ts`, ajouter l'import puis un bloc `describe` (réutilise `npcVillageSim`, déjà défini en tête de fichier ; `TERRAIN_ROCK` est déjà importé) :
```ts
import { handleCold } from './npc-needs'
```
```ts
describe('recherche de chaleur (handleCold)', () => {
  const setup = () => {
    const sim = npcVillageSim(1)
    const npc = sim.npcs[0]!
    const entity = sim.entities.find((e) => e.id === npc.entityId)!
    const village = sim.villages[0]!
    return { sim, npc, entity, village }
  }

  it('un PNJ froid à découvert file vers son Foyer (et prend le tick)', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; entity.temperature = 30; npc.path = []
    expect(handleCold(sim, village, npc, entity)).toBe(true)
    expect(npc.path.length).toBeGreaterThan(0)
    expect(npc.seekingWarmth).toBe(true)
  })

  it('un PNJ froid déjà dans la bulle du feu rend la main', () => {
    const { sim, npc, entity, village } = setup()
    const fire = sim.structures.find((s) => s.type === 'fire' && s.villageId === village.id)!
    entity.x = fire.tx; entity.y = fire.ty; entity.temperature = 30; npc.path = []
    expect(handleCold(sim, village, npc, entity)).toBe(false)
    expect(npc.path.length).toBe(0)
  })

  it('anti-livelock : froid mais aucun chemin vers un feu → rend la main, pas de figeage', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; entity.temperature = 30; npc.path = []
    // Piéger le PNJ dans un anneau de roche (aucun chemin vers le Feu à (12,12)).
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        sim.map.terrain[(3 + dy) * sim.map.width + (3 + dx)] = TERRAIN_ROCK
      }
    expect(handleCold(sim, village, npc, entity)).toBe(false)
    expect(npc.path.length).toBe(0)
  })

  it('hystérésis : reste en recherche entre 40 et 60, s\'arrête à 60', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; npc.path = []; npc.seekingWarmth = true
    entity.temperature = 50
    expect(handleCold(sim, village, npc, entity)).toBe(true) // continue à chercher
    entity.temperature = 60
    expect(handleCold(sim, village, npc, entity)).toBe(false)
    expect(npc.seekingWarmth).toBe(false)
  })

  it('pas de déclenchement au chaud (≥40, jamais en recherche)', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; entity.temperature = 45; npc.path = []
    expect(handleCold(sim, village, npc, entity)).toBe(false)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @braises/sim exec vitest run src/npc.test.ts`
Expected: FAIL — `handleCold` introuvable / `seekingWarmth` absent.

- [ ] **Step 3 : Implémenter**

Dans `balance.ts`, dans le bloc `export const BALANCE = { … }`, près de `NPC_ENERGY_SLEEP_THRESHOLD` :
```ts
  /** Sous ce seuil de température, un PNJ lâche sa tâche et rentre au feu (spec IA chaleur).
   *  Sous l'ambiant vallée acte III (50) → la vie normale ne le déclenche pas ; au-dessus de
   *  l'hypothermie (20) avec marge (dérive lente). */
  NPC_COLD_SEEK: 40,
  /** Hystérésis : arrêt de la recherche au retour au confort. */
  NPC_COLD_RESUME: 60,
```

Dans `npc.ts`, ajouter à l'interface `Npc` (près de `sleeping`) :
```ts
  /** En cours de repli vers un feu à cause du froid (hystérésis, spec IA chaleur). */
  seekingWarmth: boolean
```
et à l'init du PNJ (~ligne 448, près de `sleeping: false`) :
```ts
    seekingWarmth: false,
```

Dans `npc-needs.ts`, compléter les imports :
```ts
import { fireBubble, isSheltered } from './temperature'
```
et ajouter la fonction (après `handleSleep`) :
```ts
/**
 * Le froid (spec IA chaleur). Sous NPC_COLD_SEEK, un PNJ à découvert rentre à SON feu.
 * Rend la main dès qu'il se réchauffe (bulle de feu / abri) → il mange et travaille au coin
 * du feu (le village se blottit autour du Foyer). Anti-livelock : si le feu est inatteignable,
 * on rend la main plutôt que de figer le PNJ (mort de froid légitime, pas un yo-yo).
 */
export function handleCold(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
  // Assez chaud ? (hystérésis : une fois en recherche, on continue jusqu'au confort)
  if (!npc.seekingWarmth && entity.temperature >= BALANCE.NPC_COLD_SEEK) return false
  if (entity.temperature >= BALANCE.NPC_COLD_RESUME) {
    npc.seekingWarmth = false
    return false
  }
  // Déjà en train de se réchauffer ? → on laisse manger/travailler au coin du feu.
  if (fireBubble(state, entity.x, entity.y) > 0 || isSheltered(state, Math.floor(entity.x), Math.floor(entity.y))) {
    npc.seekingWarmth = false
    return false
  }
  // Froid et à découvert → repli vers son propre feu.
  npc.seekingWarmth = true
  const home = npc.homeId !== null ? state.structures.find((s) => s.id === npc.homeId) : undefined
  const target = home ?? state.structures.find((s) => s.type === 'fire' && s.villageId === village.id)
  if (!target) return false
  if (npc.path.length === 0) {
    if (!setPathTo(state, npc, entity, target.tx, target.ty)) return false // ANTI-LIVELOCK
  }
  followPath(state, npc, entity)
  return true
}
```

Dans `npc.ts`, dans `advanceNpcs`, insérer l'appel **entre `handleSleep` et `handleHunger`** :
```ts
    if (handleSleep(state, npc, entity)) continue
    if (handleCold(state, village, npc, entity)) continue
    if (handleHunger(state, village, npc, entity)) continue
```
et compléter l'import : `import { handleCold, handleHunger, handleSleep } from './npc-needs'`.

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @braises/sim exec vitest run src/npc.test.ts && pnpm check && pnpm lint`
Expected: PASS ; lint vert (pas de transcendante ajoutée).

- [ ] **Step 5 : Commit**

```bash
git add packages/sim/src/npc.ts packages/sim/src/npc-needs.ts packages/sim/src/balance.ts packages/sim/src/npc.test.ts
git commit -m "feat(sim): IA PNJ — besoin de chaleur (handleCold, anti-livelock)"
```

---

### Task 2 : Priorité, déterminisme, non-régression

**Files:**
- Test: `packages/sim/src/npc.test.ts`
- Verify: suite `/sim` + `pnpm scenario`

**Interfaces:**
- Consumes: `advanceNpcs` (`./npc`), `DAY_TICKS_PER_CYCLE` (`./time`) — déjà importés dans `npc.test.ts`.

- [ ] **Step 1 : Test de priorité (sommeil prime sur froid)**

Ajouter dans le `describe('recherche de chaleur…')` de `npc.test.ts` :
```ts
  it('priorité : le sommeil prime sur le froid (un PNJ endormi et froid reste endormi)', () => {
    const { sim, npc, entity } = setup()
    sim.cycleOffset = DAY_TICKS_PER_CYCLE // nuit dès le tick 0
    npc.sleeping = true
    entity.temperature = 30 // froid
    advanceNpcs(sim)
    expect(npc.sleeping).toBe(true) // handleSleep a consommé le tick avant handleCold
  })
```
> `DAY_TICKS_PER_CYCLE` est déjà importé dans `npc.test.ts` (de `./time`). **`advanceNpcs` ne l'est pas** — l'ajouter : `import { advanceNpcs } from './npc'` (le fichier importe déjà d'autres symboles de `./npc` — compléter la liste).

- [ ] **Step 2 : Vérifier (vert) + déterminisme + suite**

Run: `pnpm check && pnpm lint && pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts`
Expected: vert. Le test de déterminisme PNJ existant (`npc.test.ts` A8 — même seed = même village au bit près) reste vert : `seekingWarmth` est déterministe (dérive de la température, elle-même déterministe).

- [ ] **Step 3 : Banc scénario (non-régression)**

Run: `pnpm scenario`
Expected: **vert** (le banc n'assère que 6 jours = acte I, où l'ambiant de vallée reste ≥ 60, donc `handleCold` ne se déclenche jamais → comportement PNJ inchangé sur ce banc). Si rouge : investiguer (le froid ne devrait rien déclencher en acte I — une régression signalerait un effet de bord inattendu de `handleCold`, à remonter, PAS à masquer).

- [ ] **Step 4 : Commit**

```bash
git add packages/sim/src/npc.test.ts
git commit -m "test(sim): IA chaleur — priorité sommeil>froid + non-régression"
```

---

## Notes d'exécution

- **Vérification profonde (hors plan, optionnelle)** : rejouer l'instrument 60 jours conservé
  (`scratchpad/sdd/instrument-cold-deaths-60d.test.ts.txt`, à remettre temporairement dans `src/`)
  et confirmer que les morts de froid PNJ en actes II/III **chutent** vs avant `handleCold`. Lent
  (~300 s), à faire manuellement, ne pas laisser dans la suite.
- **Après ce plan** : la file parquée reste — **levée Cendreux** (les morts `cause:'cold'`, désormais
  *sensées* grâce à cette IA), puis **placement des POIs de la Vallée alpine** (but initial).
- **Calibrage** : `NPC_COLD_SEEK`/`NPC_COLD_RESUME` sont des ordres de grandeur (règle projet).
