# Les lieux — savoir, répit, récit : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charger les onze POI de famille `reward` en trois devises (savoir, répit, récit), et reprendre au joueur la carte qui lui était offerte au tick 0.

**Architecture:** Un module `/sim` neuf (`poi-discovery.ts`) porte la table des charges et l'étape de tick `advancePois`, appelée juste après la boucle d'inputs (la découverte est la conséquence du pas qu'on vient de faire). Deux helpers de zones rejoignent `map.ts` (à côté de `zoneAt`). Le répit se branche sur les systèmes existants — `temperature.ts` (bulle de chaleur, abri) et la régén d'endurance de `combat.ts`. Le récit passe par le bus d'événements, déjà posé en V0 pour cela, et `chronicle.ts` le formate. Le client filtre ses pastilles.

**Tech Stack:** TypeScript pur (`/sim`), Vitest, Phaser 4 (`/client`). Aucune dépendance nouvelle.

## Global Constraints

Copiées de `CLAUDE.md` et de `docs/specs/lieux.md` — elles s'appliquent à **toutes** les tâches :

- **`/sim` est pur** : zéro import de Phaser, Colyseus, ou API Node. Un lint ESLint le vérifie.
- **`/sim` est déterministe au bit près.** Pas de `Math.random`, pas de `Date`/`performance`. **Fonctions Math interdites** : `sin`, `cos`, `pow`, `hypot`, `exp`, `log`, `**`. **Autorisées** : `+ - * /`, `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`. → **Toutes les distances de ce plan se comparent AU CARRÉ.**
- **État de sim JSON-sérialisable** : pas de classes, pas de `Map`/`Set` **dans le `SimState`**. (Un `Set` local à une fonction est permis — `advanceTemperature` en utilise un.)
- **Tout nombre d'équilibrage vit dans `balance.ts`**, jamais en dur dans la logique.
- **Le code et les commentaires sont en français** ; les identifiants en anglais.
- **Aucun POI de famille `reward` n'ajoute d'item à un inventaire.** Jamais. C'est le cœur du design (spec, critère A9).
- Avant chaque commit : `pnpm check && pnpm test && pnpm lint` doivent passer.

**Rappel de contexte que le spec ne dit pas :** un « joueur » n'a pas de drapeau dans `Entity`. C'est une entité qui n'est **ni un PNJ ni un monstre** — on l'établit par exclusion, exactement comme `advanceTemperature` (`temperature.ts:84`) :

```ts
const npcIds = new Set(state.npcs.map((n) => n.entityId))
const monsterIds = new Set(state.monsters.map((m) => m.entityId))
// joueur = !npcIds.has(e.id) && !monsterIds.has(e.id)
```

**Bonne nouvelle sur le protocole (R14) :** aucun changement n'est nécessaire. `SnapshotMessage.entities` transporte déjà des `Entity` **entières** (`protocol.ts:105`) — `knownPois` voyagera tout seul. L'optimisation en delta décrite en R14 appartient au chantier d'*interest management* déjà consigné (décision 2026-07-09) ; ne la faites pas ici.

---

### Task 1: Les fondations pures — helpers de zones, bloc `POI`, table des charges

**Files:**
- Modify: `packages/sim/src/map.ts` (après `zoneAt`, ligne 62)
- Modify: `packages/sim/src/balance.ts` (nouveau bloc `POI`, à la suite du bloc `TEMPERATURE`)
- Create: `packages/sim/src/poi-discovery.ts`
- Test: `packages/sim/src/poi-discovery.test.ts`

**Interfaces:**
- Consumes: `WorldMap`, `Zone` (`map.ts`) ; `POI_TYPES`, `PoiType` (`poi.ts`).
- Produces:
  - `poisAt(map: WorldMap, x: number, y: number): number[]` — les `poiId` des zones-POI contenant le point.
  - `poiCenter(z: Zone): { x: number; y: number }`
  - `POI` (bloc de `balance.ts`)
  - `PoiCharge` (type) et `POI_CHARGES: Record<string, PoiCharge>` (`poi-discovery.ts`)
  - `poiFamily(kind: string): PoiType['family'] | undefined`

- [ ] **Step 1: Write the failing test**

Créer `packages/sim/src/poi-discovery.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyMap, poisAt, poiCenter } from './map'
import { TERRAIN_GRASS } from './balance'
import { POI_CHARGES, poiFamily } from './poi-discovery'

/** Carte de test : 3 zones, dont une SANS `kind` (un simple toponyme). */
function mapWithZones() {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push({ name: 'le Belvédère I', x: 10, y: 10, w: 2, h: 2, kind: 'belvedere' }) // poiId 0
  map.zones.push({ name: 'le Pont', x: 20, y: 20, w: 4, h: 4 }) //                          poiId 1 — PAS un POI
  map.zones.push({ name: 'le Cairn I', x: 30, y: 30, w: 1, h: 1, kind: 'cairn' }) //        poiId 2
  return map
}

describe('poisAt', () => {
  it('retourne le poiId de la zone foulée', () => {
    expect(poisAt(mapWithZones(), 10.5, 10.5)).toEqual([0])
  })

  it('ignore les zones sans kind (les toponymes ne sont pas des lieux)', () => {
    expect(poisAt(mapWithZones(), 21, 21)).toEqual([])
  })

  it('ne retourne rien hors de toute zone', () => {
    expect(poisAt(mapWithZones(), 50, 50)).toEqual([])
  })

  it('retourne TOUTES les zones qui se recouvrent, pas seulement la première', () => {
    const map = mapWithZones()
    map.zones.push({ name: 'la Grotte I', x: 10, y: 10, w: 2, h: 2, kind: 'grotte' }) // poiId 3, superposée
    expect(poisAt(map, 10.5, 10.5)).toEqual([0, 3])
  })
})

describe('poiCenter', () => {
  it('donne le centre du rectangle', () => {
    expect(poiCenter({ name: 'x', x: 10, y: 20, w: 4, h: 2 })).toEqual({ x: 12, y: 21 })
  })
})

describe('POI_CHARGES', () => {
  it('charge les onze lieux de famille reward, et EUX SEULS', () => {
    const charged = Object.keys(POI_CHARGES).sort()
    expect(charged).toEqual(
      ['arbre', 'arche', 'belvedere', 'cairn', 'cascade', 'erratique', 'grotte', 'petroglyphes', 'sanctuaire', 'source_chaude', 'tarn'].sort(),
    )
  })

  it('ne charge que des POI de famille reward', () => {
    for (const kind of Object.keys(POI_CHARGES)) {
      expect(poiFamily(kind)).toBe('reward')
    }
  })

  it('répartit les onze en 4 savoir / 3 répit / 4 récit', () => {
    const count = (d: string) => Object.values(POI_CHARGES).filter((c) => c.devise === d).length
    expect(count('savoir')).toBe(4)
    expect(count('repit')).toBe(3)
    expect(count('recit')).toBe(4)
  })
})
```

> **Vérification préalable :** ces onze slugs sont relevés dans `packages/sim/src/poi.ts` (`POI_TYPES`, les entrées `family: 'reward'`). Rouvrez-le pour confirmer plutôt que de me croire — si un slug a bougé depuis la rédaction, **c'est le fichier qui a raison**, pas le plan.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: FAIL — `poisAt`/`poiCenter` n'existent pas dans `map.ts`, `poi-discovery.ts` n'existe pas.

- [ ] **Step 3: Ajouter les deux helpers à `map.ts`**

À la fin de `packages/sim/src/map.ts`, après `zoneAt` :

```ts
/**
 * Les `poiId` de TOUTES les zones-POI contenant le point (spec lieux R6).
 * Le poiId EST l'index dans `map.zones` (spec R4) — `placePois` est déterministe,
 * donc cet index est stable pour une seed donnée. Une zone sans `kind` est un
 * simple toponyme, jamais un lieu.
 *
 * On retourne toutes les zones, pas la première (contrairement à `zoneAt`) :
 * deux empreintes de POI peuvent se recouvrir.
 */
export function poisAt(map: WorldMap, x: number, y: number): number[] {
  const out: number[] = []
  for (let i = 0; i < map.zones.length; i += 1) {
    const z = map.zones[i]!
    if (z.kind === undefined) continue
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) out.push(i)
  }
  return out
}

/** Centre d'une zone, en tuiles. */
export function poiCenter(z: Zone): { x: number; y: number } {
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 }
}
```

- [ ] **Step 4: Ajouter le bloc `POI` à `balance.ts`**

Juste après le bloc `TEMPERATURE` :

```ts
/**
 * Les lieux chargés (spec `docs/specs/lieux.md`). Ordres de grandeur, à
 * calibrer en jeu — pas des vérités.
 */
export const POI = {
  /** Du Belvédère, on voit loin : rayon de révélation, en tuiles. */
  REVEAL_BELVEDERE_TILES: 40,
  /** De l'Arche, on voit les abris de l'autre versant. */
  REVEAL_ARCHE_TILES: 30,
  /** La Source chaude est un feu qu'on n'a pas allumé (mêmes unités que FIRE_WARMTH/FIRE_RANGE). */
  HOTSPRING_WARMTH: 75,
  HOTSPRING_RANGE_TILES: 4,
  /** Le Tarn est une halte : régén d'endurance multipliée sur son empreinte. */
  TARN_STAMINA_FACTOR: 1.5,
  /** Ce que les Pétroglyphes savent montrer : les lieux ANCIENS. */
  ANCIENT_KINDS: ['ruines', 'mine', 'sanctuaire', 'oratoire'] as readonly string[],
}
```

- [ ] **Step 5: Créer `poi-discovery.ts` avec la table des charges**

```ts
/**
 * Les lieux chargés — savoir, répit, récit (spec `docs/specs/lieux.md`).
 *
 * Les onze POI de famille `reward` étaient placés, nommés, et inertes :
 * `family === 'reward'` n'était lu que par la vignette, pour une couleur de
 * pastille. On leur donne une charge — et JAMAIS du butin (spec, critère A9) :
 * le butin tuerait le lieu à la première visite et fabriquerait une tournée de
 * ramassage, exactement la corvée que le GDD §8bis interdit.
 *
 * Les trois devises n'ont pas la même horloge, et c'est le cœur du système :
 * le savoir paye UNE FOIS (et change la carte), le répit paye TOUJOURS (et
 * change les trajets), le récit paye LA PREMIÈRE FOIS (et change ce qu'on
 * racontera).
 */
import { POI } from './balance'
import { POI_TYPES, type PoiType } from './poi'

/** Ce qu'un lieu donne quand on le foule. Aucune variante ne donne d'item. */
export type PoiCharge =
  /** Révèle tous les lieux d'un rayon (éventuellement filtrés par famille). */
  | { devise: 'savoir'; reveal: 'radius'; radiusTiles: number; family?: PoiType['family'] }
  /** Révèle LE lieu inconnu le plus proche (éventuellement parmi certains `kind`). */
  | { devise: 'savoir'; reveal: 'nearest'; kinds?: readonly string[] }
  /** Effet continu de terrain — chaleur, abri, repos. N'émet aucun événement. */
  | { devise: 'repit' }
  /** Première visite → une ligne dans la chronique. */
  | { devise: 'recit' }

export const POI_CHARGES: Record<string, PoiCharge> = {
  // ── Le savoir : quatre lieux qui rendent la carte ──
  // On monte, on regarde, on voit. C'est le lieu qui fait grimper.
  belvedere: { devise: 'savoir', reveal: 'radius', radiusTiles: POI.REVEAL_BELVEDERE_TILES },
  // La porte de pierre montre où l'on peut dormir de l'autre côté.
  arche: { devise: 'savoir', reveal: 'radius', radiusTiles: POI.REVEAL_ARCHE_TILES, family: 'shelter' },
  // Un jalon de sentier : les cairns se suivent et tirent vers l'inconnu.
  cairn: { devise: 'savoir', reveal: 'nearest' },
  // Quelqu'un a gravé ça pour dire « c'est par là ».
  petroglyphes: { devise: 'savoir', reveal: 'nearest', kinds: POI.ANCIENT_KINDS },

  // ── Le répit : trois lieux qui refont les trajets ──
  source_chaude: { devise: 'repit' },
  grotte: { devise: 'repit' },
  tarn: { devise: 'repit' },

  // ── Le récit : quatre lieux qui entrent dans la chronique ──
  sanctuaire: { devise: 'recit' },
  arbre: { devise: 'recit' },
  erratique: { devise: 'recit' },
  cascade: { devise: 'recit' },
}

/** La famille d'un `kind` de POI (undefined si le kind est inconnu). */
export function poiFamily(kind: string): PoiType['family'] | undefined {
  return POI_TYPES.find((t) => t.slug === kind)?.family
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: PASS (9 tests).

Puis la suite complète : `pnpm check && pnpm test && pnpm lint` → tout vert.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/map.ts packages/sim/src/balance.ts packages/sim/src/poi-discovery.ts packages/sim/src/poi-discovery.test.ts
git commit -m "feat(sim): fondations des lieux chargés — poisAt, bloc POI, table des charges"
```

---

### Task 2: `knownPois` et la règle de base — un lieu foulé entre dans la carte

C'est le socle (spec R6.1) : **la marche est la source primaire du savoir.** Les quatre charges de la tâche 3 ne feront que l'accélérer.

**Files:**
- Modify: `packages/sim/src/sim.ts` (`Entity` ~ligne 39-73, `SimState` ~ligne 75-116, `createSim` ~ligne 140, `spawnEntity` ~ligne 184, `step` ~ligne 286)
- Modify: `packages/sim/src/events.ts` (union `SimEvent`)
- Modify: `packages/sim/src/poi-discovery.ts` (ajout de `advancePois`)
- Modify: `packages/sim/src/index.ts` (exports)
- Test: `packages/sim/src/poi-discovery.test.ts` (ajouts)

**Interfaces:**
- Consumes: `poisAt` (Task 1), `POI_CHARGES` (Task 1).
- Produces:
  - `Entity.knownPois: number[]` — vide à la création, sur TOUTES les entités (forme uniforme = snapshot stable) ; **mutée pour les joueurs seuls**.
  - `SimState.visitedPois: number[]` — global (servira à la tâche 4).
  - `advancePois(state: SimState): void` — une étape de tick.
  - Événement `poi_discovered { tick, poiId, kind, byEntityId }`.

- [ ] **Step 1: Write the failing test**

Ajouter à `packages/sim/src/poi-discovery.test.ts` :

```ts
import { createSim, spawnEntity, step, type SimState } from './sim'

/** Une sim de test avec une carte à zones et un joueur posé où on veut. */
function simWith(zones: { name: string; x: number; y: number; w: number; h: number; kind?: string }[]) {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push(...zones)
  const state = createSim(1, { map })
  const playerId = spawnEntity(state, 0.5, 0.5)
  return { state, playerId }
}

/** Téléporte le joueur et joue un tick sans input (le pas est déjà fait). */
function walkTo(state: SimState, playerId: number, x: number, y: number) {
  const p = state.entities.find((e) => e.id === playerId)!
  p.x = x
  p.y = y
  state.events.length = 0
  step(state, [])
}

describe('la règle de base : un lieu foulé entre dans la carte', () => {
  it('au tick 0, le joueur ne connaît AUCUN lieu', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([])
  })

  it('fouler un Gisement (aucune charge) suffit à le connaître, et émet poi_discovered', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0])
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(1)
  })

  it('le retraverser n’émet plus rien (idempotent)', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    walkTo(state, playerId, 10.5, 10.5)
    walkTo(state, playerId, 10.6, 10.6) // toujours dedans, tick suivant
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0])
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('une zone SANS kind (un toponyme) n’entre jamais dans la carte', () => {
    const { state, playerId } = simWith([{ name: 'le Pont', x: 10, y: 10, w: 2, h: 2 }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: FAIL — `knownPois` n'existe pas sur `Entity`.

- [ ] **Step 3: Étendre `Entity`, `SimState`, `createSim`, `spawnEntity`**

Dans `packages/sim/src/sim.ts`, à la fin de `interface Entity` (après `god?: true`) :

```ts
  /**
   * Les lieux connus de ce joueur (spec lieux R3) — index dans `map.zones`.
   * Un tableau, pas un `Set` : l'état de sim reste JSON-sérialisable.
   * Présent sur toutes les entités (forme uniforme = snapshot stable), mais
   * SEULS LES JOUEURS l'alimentent : les PNJ n'ont pas de carte.
   */
  knownPois: number[]
```

Dans `interface SimState`, après `evacuation` :

```ts
  /** Lieux déjà atteints par un joueur, tous joueurs confondus (spec lieux R12).
   *  Global : il n'y a qu'un premier — en multi, c'est une course. */
  visitedPois: number[]
```

Dans `createSim`, après `evacuation: null,` :

```ts
    visitedPois: [],
```

Dans `spawnEntity`, dans le littéral poussé, après `engagement: 0,` :

```ts
    knownPois: [],
```

- [ ] **Step 4: Ajouter l'événement dans `events.ts`**

Dans l'union `SimEvent`, à la suite des autres :

```ts
  | { type: 'poi_discovered'; tick: number; poiId: number; kind: string; byEntityId: number }
```

- [ ] **Step 5: Écrire `advancePois` dans `poi-discovery.ts`**

Ajouter les imports en tête du fichier :

```ts
import { emitEvent } from './events'
import { poisAt } from './map'
import type { SimState } from './sim'
```

Puis, à la fin :

```ts
/**
 * Un joueur connaît-il déjà ce lieu ? (garde d'idempotence — appliquer une
 * charge deux fois est un non-événement, cette garde suffit ; rien à mémoriser
 * d'un tick à l'autre.)
 */
function know(state: SimState, entityId: number, knownPois: number[], poiId: number): boolean {
  if (knownPois.includes(poiId)) return false
  knownPois.push(poiId)
  const kind = state.map.zones[poiId]?.kind ?? ''
  emitEvent(state, { type: 'poi_discovered', tick: state.tick, poiId, kind, byEntityId: entityId })
  return true
}

/**
 * Une étape de tick : les lieux foulés par les JOUEURS entrent dans leur carte.
 * Appelée juste après la boucle d'inputs — la découverte est la conséquence du
 * pas qu'on vient de faire.
 */
export function advancePois(state: SimState): void {
  const npcIds = new Set(state.npcs.map((n) => n.entityId))
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))

  for (const entity of state.entities) {
    if (npcIds.has(entity.id) || monsterIds.has(entity.id)) continue // les PNJ n'ont pas de carte

    for (const poiId of poisAt(state.map, entity.x, entity.y)) {
      // R6.1 — la règle de base : fouler suffit à connaître (les 26 types).
      know(state, entity.id, entity.knownPois, poiId)
      // Les charges (savoir, récit) arrivent aux tâches 3 et 4.
    }
  }
}
```

- [ ] **Step 6: Brancher `advancePois` dans le tick**

Dans `packages/sim/src/sim.ts`, importer :

```ts
import { advancePois } from './poi-discovery'
```

Puis, dans `step`, **juste après la boucle `for (const input of inputs)` et AVANT `advanceWorldEvents(state)`** :

```ts
  // La découverte est la conséquence du pas qu'on vient de faire (spec lieux R6).
  advancePois(state)
  // Le monde d'abord (spawns/alarmes), puis PNJ, monstres, résolution.
  advanceWorldEvents(state)
```

- [ ] **Step 7: Exporter depuis `index.ts`**

Ajouter à `packages/sim/src/index.ts` :

```ts
export { POI_CHARGES, poiFamily, advancePois, type PoiCharge } from './poi-discovery'
export { poisAt, poiCenter } from './map'
```

(Suivre le style d'export existant du fichier.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: PASS.

Puis `pnpm check && pnpm test && pnpm lint`.

> **Attendu : des tests de replay/snapshot peuvent devenir rouges** si l'un d'eux compare un snapshot à une chaîne JSON figée — deux champs neufs (`knownPois`, `visitedPois`) s'y ajoutent. C'est une régression **légitime** : mettez à jour l'attendu. En revanche, si `replay.test.ts` ou `events.test.ts` échouent sur une **divergence entre deux runs**, c'est un vrai bug de déterminisme — arrêtez-vous et signalez-le.

- [ ] **Step 9: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/events.ts packages/sim/src/poi-discovery.ts packages/sim/src/poi-discovery.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): knownPois — un lieu foulé entre dans la carte"
```

---

### Task 3: Les quatre charges de savoir

**Files:**
- Modify: `packages/sim/src/poi-discovery.ts` (`applyKnowledge`, appelée depuis `advancePois`)
- Test: `packages/sim/src/poi-discovery.test.ts` (ajouts)

**Interfaces:**
- Consumes: `know()`, `advancePois()` (Task 2) ; `poiCenter`, `POI_CHARGES`, `poiFamily` (Task 1).
- Produces: rien de neuf à l'extérieur — `advancePois` révèle désormais à distance.

**Règle de déterminisme, non négociable :** distances **au carré** (jamais `Math.hypot` ni `sqrt`), et « le plus proche » départage les égalités exactes par **`poiId` croissant** (spec R8).

- [ ] **Step 1: Write the failing test**

Ajouter à `packages/sim/src/poi-discovery.test.ts` :

```ts
describe('le savoir — quatre lieux qui rendent la carte', () => {
  it('le Belvédère révèle tout dans son rayon, et RIEN au-delà', () => {
    const { state, playerId } = simWith([
      { name: 'le Belvédère I', x: 10, y: 10, w: 2, h: 2, kind: 'belvedere' }, // 0 — centre (11,11)
      { name: 'la Grotte I', x: 20, y: 10, w: 2, h: 2, kind: 'grotte' }, //       1 — à ~10 tuiles → DEDANS
      { name: 'le Tarn I', x: 55, y: 55, w: 2, h: 2, kind: 'tarn' }, //           2 — à ~63 tuiles → DEHORS (rayon 40)
    ])
    walkTo(state, playerId, 11, 11)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toContain(0) // lui-même, par la règle de base
    expect(known).toContain(1)
    expect(known).not.toContain(2)
  })

  it('le Belvédère ne se déclenche qu’une fois', () => {
    const { state, playerId } = simWith([
      { name: 'le Belvédère I', x: 10, y: 10, w: 2, h: 2, kind: 'belvedere' },
      { name: 'la Grotte I', x: 20, y: 10, w: 2, h: 2, kind: 'grotte' },
    ])
    walkTo(state, playerId, 11, 11)
    walkTo(state, playerId, 11.1, 11.1)
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('le Cairn révèle exactement UN lieu — le plus proche encore inconnu', () => {
    const { state, playerId } = simWith([
      { name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }, //  0 — centre (10.5, 10.5)
      { name: 'la Grotte I', x: 14, y: 10, w: 1, h: 1, kind: 'grotte' }, // 1 — proche
      { name: 'le Tarn I', x: 30, y: 10, w: 1, h: 1, kind: 'tarn' }, //     2 — loin
    ])
    walkTo(state, playerId, 10.5, 10.5)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toEqual([0, 1]) // lui-même + le plus proche. PAS le Tarn.
  })

  it('à distance exactement égale, le Cairn départage par poiId croissant', () => {
    const { state, playerId } = simWith([
      { name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }, //   0 — centre (10.5, 10.5)
      { name: 'la Grotte I', x: 20, y: 10, w: 1, h: 1, kind: 'grotte' }, // 1 — à +9.5 en x
      { name: 'le Tarn I', x: 0, y: 10, w: 1, h: 1, kind: 'tarn' }, //      2 — centre 0.5 : dx = −10 : ÉGALITÉ
    ])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0, 1]) // le plus petit poiId gagne
  })

  it('un Cairn dont tout le voisinage est déjà connu ne révèle rien de plus', () => {
    const { state, playerId } = simWith([{ name: 'le Cairn I', x: 10, y: 10, w: 1, h: 1, kind: 'cairn' }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0]) // lui-même, et c'est tout
  })

  it('les Pétroglyphes ne révèlent qu’un lieu ANCIEN', () => {
    const { state, playerId } = simWith([
      { name: 'les Pétroglyphes I', x: 10, y: 10, w: 1, h: 1, kind: 'petroglyphes' }, // 0
      { name: 'la Grotte I', x: 12, y: 10, w: 1, h: 1, kind: 'grotte' }, //              1 — proche mais PAS ancien
      { name: 'les Ruines I', x: 20, y: 10, w: 1, h: 1, kind: 'ruines' }, //             2 — ancien, plus loin
    ])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0, 2]) // saute la Grotte
  })

  it('l’Arche ne révèle que des abris (family shelter)', () => {
    const { state, playerId } = simWith([
      { name: 'l’Arche I', x: 10, y: 10, w: 1, h: 1, kind: 'arche' }, //     0
      { name: 'le Tarn I', x: 12, y: 10, w: 1, h: 1, kind: 'tarn' }, //      1 — reward, pas shelter
      { name: 'la Cabane I', x: 14, y: 10, w: 1, h: 1, kind: 'cabane' }, //  2 — shelter ✓
      { name: 'les Ruines I', x: 16, y: 10, w: 1, h: 1, kind: 'ruines' }, // 3 — shelter ✓
    ])
    walkTo(state, playerId, 10.5, 10.5)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toContain(2)
    expect(known).toContain(3)
    expect(known).not.toContain(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: FAIL — aucune révélation à distance n'a lieu (seule la règle de base joue).

- [ ] **Step 3: Implémenter `applyKnowledge`**

Dans `poi-discovery.ts`, ajouter l'import de `poiCenter` (`import { poiCenter, poisAt } from './map'`), puis :

```ts
/** Distance AU CARRÉ entre deux centres de zones. Jamais de sqrt : invariant #2. */
function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Un candidat à la révélation : ni le lieu source, ni un lieu déjà connu, ni un toponyme. */
function isCandidate(state: SimState, knownPois: number[], sourceId: number, poiId: number): boolean {
  if (poiId === sourceId) return false
  if (knownPois.includes(poiId)) return false
  return state.map.zones[poiId]?.kind !== undefined
}

/**
 * La charge de savoir d'un lieu qu'on vient de fouler : elle révèle D'AUTRES
 * lieux, à distance. C'est une ACCÉLÉRATION de la règle de base (fouler suffit
 * à connaître) — jamais un substitut.
 */
function applyKnowledge(state: SimState, entityId: number, knownPois: number[], sourceId: number): void {
  const charge = POI_CHARGES[state.map.zones[sourceId]?.kind ?? '']
  if (charge === undefined || charge.devise !== 'savoir') return

  const origin = poiCenter(state.map.zones[sourceId]!)

  if (charge.reveal === 'radius') {
    const r2 = charge.radiusTiles * charge.radiusTiles
    for (let poiId = 0; poiId < state.map.zones.length; poiId += 1) {
      if (!isCandidate(state, knownPois, sourceId, poiId)) continue
      const zone = state.map.zones[poiId]!
      if (charge.family !== undefined && poiFamily(zone.kind!) !== charge.family) continue
      if (dist2(origin, poiCenter(zone)) > r2) continue
      know(state, entityId, knownPois, poiId)
    }
    return
  }

  // reveal === 'nearest' : LE plus proche, égalités départagées par poiId croissant.
  // On itère en ordre croissant et on n'accepte qu'un `<` STRICT : le premier
  // rencontré à distance égale gagne donc naturellement (spec R8).
  let bestId = -1
  let bestD2 = Infinity
  for (let poiId = 0; poiId < state.map.zones.length; poiId += 1) {
    if (!isCandidate(state, knownPois, sourceId, poiId)) continue
    const zone = state.map.zones[poiId]!
    if (charge.kinds !== undefined && !charge.kinds.includes(zone.kind!)) continue
    const d2 = dist2(origin, poiCenter(zone))
    if (d2 < bestD2) {
      bestD2 = d2
      bestId = poiId
    }
  }
  if (bestId >= 0) know(state, entityId, knownPois, bestId)
}
```

- [ ] **Step 4: Appeler `applyKnowledge` depuis `advancePois`**

Remplacer le corps de la boucle interne d'`advancePois` :

```ts
    for (const poiId of poisAt(state.map, entity.x, entity.y)) {
      // R6.1 — la règle de base : fouler suffit à connaître (les 26 types).
      const fresh = know(state, entity.id, entity.knownPois, poiId)
      // R6.2 — la charge de savoir, si le lieu en porte une, ne joue qu'à la
      // PREMIÈRE foulée : `fresh` est notre garde d'idempotence.
      if (fresh) applyKnowledge(state, entity.id, entity.knownPois, poiId)
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: PASS.

Puis `pnpm check && pnpm test && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/poi-discovery.ts packages/sim/src/poi-discovery.test.ts
git commit -m "feat(sim): les quatre charges de savoir — Belvédère, Cairn, Pétroglyphes, Arche"
```

---

### Task 4: Le récit — `poi_first_visit` et la chronique

**Files:**
- Modify: `packages/sim/src/events.ts` (union `SimEvent`)
- Modify: `packages/sim/src/poi-discovery.ts` (`advancePois`)
- Modify: `packages/sim/src/chronicle.ts` (nouveau `case`)
- Test: `packages/sim/src/poi-discovery.test.ts` (ajouts)

**Interfaces:**
- Consumes: `SimState.visitedPois` (Task 2), `POI_CHARGES` (Task 1).
- Produces: événement `poi_first_visit { tick, poiId, kind, name, byEntityId }`.

**Le partage des rôles (spec R12-R13), à ne pas confondre :** l'événement est émis pour **TOUS** les POI (le bus reste complet — on n'instrumente jamais la logique après coup) ; c'est la **chronique** qui ne formate que les quatre lieux de devise `recit`.

- [ ] **Step 1: Write the failing test**

```ts
import { chronicleFromEvents } from './chronicle'

describe('le récit — la première fois seulement', () => {
  it('la première arrivée au Sanctuaire émet poi_first_visit, la seconde non', () => {
    const { state, playerId } = simWith([{ name: 'le Sanctuaire I', x: 10, y: 10, w: 2, h: 2, kind: 'sanctuaire' }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.events.filter((e) => e.type === 'poi_first_visit')).toHaveLength(1)
    expect(state.visitedPois).toEqual([0])

    // Un SECOND joueur y va à son tour : c'est SA découverte, mais plus une première.
    const other = spawnEntity(state, 0.5, 0.5)
    walkTo(state, other, 10.5, 10.5)
    expect(state.events.filter((e) => e.type === 'poi_first_visit')).toHaveLength(0)
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(1) // lui, il découvre
  })

  it('un PNJ qui traverse le Sanctuaire ne produit RIEN — ni carte, ni découverte, ni première', () => {
    const { state } = simWith([{ name: 'le Sanctuaire I', x: 10, y: 10, w: 2, h: 2, kind: 'sanctuaire' }])
    const npcEntityId = spawnEntity(state, 10.5, 10.5)
    state.npcs.push({
      entityId: npcEntityId,
      villageId: 1,
      homeId: null,
      energy: 100,
      sleeping: false,
      seekingWarmth: false,
    } as (typeof state.npcs)[number])
    state.events.length = 0
    step(state, [])
    expect(state.entities.find((e) => e.id === npcEntityId)!.knownPois).toEqual([])
    expect(state.visitedPois).toEqual([])
    expect(state.events.filter((e) => e.type === 'poi_first_visit')).toHaveLength(0)
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('la chronique écrit une ligne pour le Sanctuaire (devise récit)', () => {
    const { state, playerId } = simWith([{ name: 'le Sanctuaire I', x: 10, y: 10, w: 2, h: 2, kind: 'sanctuaire' }])
    walkTo(state, playerId, 10.5, 10.5)
    const lines = chronicleFromEvents(state.events, state.calendarScale, {})
    expect(lines.some((l) => l.includes('le Sanctuaire I'))).toBe(true)
  })

  it('la chronique NE parle PAS d’un Gisement (devise absente) ni d’un Cairn (devise savoir)', () => {
    const { state, playerId } = simWith([
      { name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' },
      { name: 'le Cairn I', x: 30, y: 30, w: 1, h: 1, kind: 'cairn' },
    ])
    walkTo(state, playerId, 10.5, 10.5)
    const eventsA = [...state.events]
    walkTo(state, playerId, 30.5, 30.5)
    const lines = chronicleFromEvents([...eventsA, ...state.events], state.calendarScale, {})
    expect(lines.some((l) => l.includes('Gisement'))).toBe(false)
    expect(lines.some((l) => l.includes('Cairn'))).toBe(false)
  })
})
```

> **Note pour l'implémenteur :** le littéral `Npc` du deuxième test doit satisfaire l'interface réelle. Ouvrez `packages/sim/src/npc.ts` et complétez les champs manquants plutôt que de forcer le `as` — si l'interface a bougé, c'est elle qui a raison. Le seul champ dont ce test dépend vraiment est `entityId`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: FAIL — `poi_first_visit` n'existe pas.

- [ ] **Step 3: Ajouter l'événement dans `events.ts`**

```ts
  | { type: 'poi_first_visit'; tick: number; poiId: number; kind: string; name: string; byEntityId: number }
```

- [ ] **Step 4: Émettre la première visite dans `advancePois`**

Dans la boucle interne d'`advancePois`, **après** le bloc `know`/`applyKnowledge` :

```ts
      // R12 — la première visite d'un JOUEUR, tous joueurs confondus. Il n'y a
      // qu'un premier : en multi, c'est une course. Émis pour TOUS les POI ; la
      // chronique, elle, ne formatera que les quatre lieux de devise `recit`.
      if (!state.visitedPois.includes(poiId)) {
        state.visitedPois.push(poiId)
        const zone = state.map.zones[poiId]!
        emitEvent(state, {
          type: 'poi_first_visit',
          tick: state.tick,
          poiId,
          kind: zone.kind ?? '',
          name: zone.name,
          byEntityId: entity.id,
        })
      }
```

- [ ] **Step 5: Formater le récit dans `chronicle.ts`**

Ajouter l'import : `import { POI_CHARGES } from './poi-discovery'`

Puis un `case` dans le `switch` :

```ts
      case 'poi_first_visit':
        // Seuls les quatre lieux de devise `recit` entrent dans la chronique.
        // Le bus, lui, porte toutes les premières visites : c'est le FORMATEUR
        // qui choisit, jamais la logique qui filtre.
        if (POI_CHARGES[e.kind]?.devise === 'recit') {
          lines.push(`${d} — ${e.name} a été atteint pour la première fois.`)
        }
        break
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: PASS.

Puis `pnpm check && pnpm test && pnpm lint`.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/events.ts packages/sim/src/poi-discovery.ts packages/sim/src/chronicle.ts packages/sim/src/poi-discovery.test.ts
git commit -m "feat(sim): le récit — première visite d'un lieu, et la chronique l'écrit"
```

---

### Task 5: Le répit — la Source chaude, la Grotte, le Tarn (+ la garde anti-butin)

Le répit n'émet **aucun événement** : c'est un effet **continu de terrain**, comme le `speedFactor`. On y revient autant qu'on veut — c'est le but.

**Files:**
- Modify: `packages/sim/src/temperature.ts` (`isSheltered` ~ligne 19, `fireBubble` ~ligne 24, `ambientTemperature` ~ligne 39)
- Modify: `packages/sim/src/combat.ts` (boucle de régén d'endurance, ~lignes 372-382)
- Modify: `packages/sim/src/poi-discovery.ts` (`isOnPoiKind`, `staminaPoiFactor`)
- Test: `packages/sim/src/poi-discovery.test.ts` (ajouts)

**Interfaces:**
- Consumes: `poisAt` (Task 1), `POI` (Task 1).
- Produces:
  - `isOnPoiKind(state: SimState, x: number, y: number, kind: string): boolean`
  - `naturalWarmth(state: SimState, x: number, y: number): number` (dans `temperature.ts`) — généralise `fireBubble`.
  - `staminaPoiFactor(state: SimState, x: number, y: number): number` (dans `poi-discovery.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { ambientTemperature, isSheltered, naturalWarmth } from './temperature'
import { POI } from './balance'
import { DAY_TICKS_PER_CYCLE } from './time'

/**
 * Une sim qui démarre LA NUIT. Indispensable pour mesurer une source chaude :
 * de jour, en Acte I, l'ambiante d'un fond de vallée vaut ~90 et la source ~75 —
 * `ambientTemperature` prend le `max`, donc la source serait INVISIBLE et le test
 * vert-menteur. Une source chaude ne se voit que quand il fait froid (critère A5).
 */
function simDeNuit(zones: { name: string; x: number; y: number; w: number; h: number; kind?: string }[]) {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push(...zones)
  const state = createSim(1, { map, cycleOffset: DAY_TICKS_PER_CYCLE }) // 0 = aube ; ici : tombée de nuit
  const playerId = spawnEntity(state, 0.5, 0.5)
  return { state, playerId }
}

describe('le répit — la vallée comme réseau', () => {
  it('la Source chaude réchauffe : c’est un feu qu’on n’a pas allumé', () => {
    const { state } = simDeNuit([{ name: 'la Source chaude I', x: 10, y: 10, w: 2, h: 2, kind: 'source_chaude' }])
    const surLaSource = ambientTemperature(state, 11, 11) // le centre de la zone
    const aCote = ambientTemperature(state, 11 + POI.HOTSPRING_RANGE_TILES + 2, 11) // hors rayon

    expect(surLaSource).toBeGreaterThan(aCote)
    expect(surLaSource).toBeGreaterThanOrEqual(POI.HOTSPRING_WARMTH - 1) // planchée par la source
    expect(state.structures).toHaveLength(0) // et personne n'a rien allumé
  })

  it('la chaleur de la source décroît avec la distance, et s’annule au bord du rayon', () => {
    const { state } = simDeNuit([{ name: 'la Source chaude I', x: 10, y: 10, w: 2, h: 2, kind: 'source_chaude' }])
    const auContact = naturalWarmth(state, 11, 11)
    const aMiChemin = naturalWarmth(state, 11 + POI.HOTSPRING_RANGE_TILES / 2, 11)
    const auBord = naturalWarmth(state, 11 + POI.HOTSPRING_RANGE_TILES, 11)

    expect(auContact).toBeCloseTo(POI.HOTSPRING_WARMTH)
    expect(aMiChemin).toBeCloseTo(POI.HOTSPRING_WARMTH / 2)
    expect(auBord).toBe(0)
  })

  it('la Grotte abrite', () => {
    const { state } = simWith([{ name: 'la Grotte I', x: 10, y: 10, w: 2, h: 2, kind: 'grotte' }])
    expect(isSheltered(state, 10, 10)).toBe(true)
    expect(isSheltered(state, 13, 13)).toBe(false)
  })

  it('le Tarn accélère la régén d’endurance', () => {
    const { state, playerId } = simWith([{ name: 'le Tarn I', x: 10, y: 10, w: 2, h: 2, kind: 'tarn' }])
    const p = state.entities.find((e) => e.id === playerId)!

    p.x = 11
    p.y = 11
    p.stamina = 50
    step(state, [])
    const surLeTarn = p.stamina - 50

    p.x = 30
    p.y = 30
    p.stamina = 50
    step(state, [])
    const ailleurs = p.stamina - 50

    expect(surLeTarn).toBeGreaterThan(ailleurs)
  })
})

describe('la règle qui protège l’émerveillement', () => {
  it('AUCUN lieu de famille reward n’ajoute d’item à l’inventaire (critère A9)', () => {
    const rewardKinds = POI_TYPES.filter((t) => t.family === 'reward').map((t) => t.slug)
    expect(rewardKinds).toHaveLength(11) // garde-fou : si ça change, ce test doit être relu

    const zones = rewardKinds.map((kind, i) => ({
      name: `${kind} I`,
      x: 4 + i * 5,
      y: 10,
      w: 2,
      h: 2,
      kind,
    }))
    const { state, playerId } = simWith(zones)
    const p = state.entities.find((e) => e.id === playerId)!

    for (const z of zones) {
      p.x = z.x + 1
      p.y = z.y + 1
      step(state, [])
    }
    expect(p.inventory).toEqual({}) // les mains vides, après les onze
  })
})
```

(Ajouter `import { POI_TYPES } from './poi'` en tête du fichier de test.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: FAIL sur la Source chaude, la Grotte et le Tarn. **Le test anti-butin (A9) doit déjà PASSER** — rien dans le code ne donne d'item. C'est voulu : c'est un test de **non-régression**, il garde la porte pour l'avenir.

- [ ] **Step 3: Ajouter `isOnPoiKind` et `staminaPoiFactor` à `poi-discovery.ts`**

```ts
/** Le point est-il sur l'empreinte d'un POI de ce `kind` ? (effets continus de terrain) */
export function isOnPoiKind(state: SimState, x: number, y: number, kind: string): boolean {
  return poisAt(state.map, x, y).some((poiId) => state.map.zones[poiId]?.kind === kind)
}

/** Multiplicateur de régén d'endurance dû au lieu — le Tarn est une halte. 1 partout ailleurs. */
export function staminaPoiFactor(state: SimState, x: number, y: number): number {
  return isOnPoiKind(state, x, y, 'tarn') ? POI.TARN_STAMINA_FACTOR : 1
}
```

- [ ] **Step 4: Généraliser la chaleur et l'abri dans `temperature.ts`**

Ajouter l'import : `import { isOnPoiKind } from './poi-discovery'` et compléter `import { POI, TEMPERATURE } from './balance'`.

Étendre `isSheltered` :

```ts
/** Sur l'empreinte d'une structure à toit (maison) — ou d'une Grotte → abrité. */
export function isSheltered(state: SimState, tx: number, ty: number): boolean {
  if (state.structures.some((s) => s.tx === tx && s.ty === ty && s.type === 'house')) return true
  return isOnPoiKind(state, tx, ty, 'grotte')
}
```

Ajouter `naturalWarmth` juste après `fireBubble` :

```ts
/**
 * Réchauffement des sources chaudes — MÊME LOI que `fireBubble` (linéaire,
 * max au contact → 0 au bord du rayon). C'est un feu qu'on n'a pas allumé :
 * sur une carte où le Grand Froid mord, il réécrit les itinéraires.
 */
export function naturalWarmth(state: SimState, x: number, y: number): number {
  let best = 0
  for (const z of state.map.zones) {
    if (z.kind !== 'source_chaude') continue
    const dx = z.x + z.w / 2 - x
    const dy = z.y + z.h / 2 - y
    const dist = Math.sqrt(dx * dx + dy * dy) // sqrt est autorisé (invariant #2)
    if (dist >= POI.HOTSPRING_RANGE_TILES) continue
    const warmth = POI.HOTSPRING_WARMTH * (1 - dist / POI.HOTSPRING_RANGE_TILES)
    if (warmth > best) best = warmth
  }
  return best
}
```

Puis, dans `ambientTemperature`, remplacer la dernière ligne :

```ts
  // Ni le feu ni la source chaude ne peuvent refroidir : ils ne font que plancher.
  return Math.max(ambient, fireBubble(state, x, y), naturalWarmth(state, x, y))
```

- [ ] **Step 5: Brancher le Tarn dans la régén d'endurance (`combat.ts`)**

Ajouter l'import : `import { staminaPoiFactor } from './poi-discovery'`

Dans la boucle de régén d'endurance (~ligne 372), **après** `perS *= coldStaminaRegenFactor(entity.temperature)** :

```ts
    perS *= staminaPoiFactor(state, entity.x, entity.y) // le Tarn est une halte
```

> **Attention aux cycles d'import.** `combat.ts` et `temperature.ts` importeront `poi-discovery.ts`, qui n'importe **ni l'un ni l'autre** — pas de cycle. Ne laissez pas `poi-discovery.ts` importer `combat.ts` ou `temperature.ts` ; si vous en ressentez le besoin, c'est que la responsabilité est mal placée : signalez-le.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @braises/sim test poi-discovery`
Expected: PASS (toute la suite du fichier).

Puis `pnpm check && pnpm test && pnpm lint`.

> **Vigilance :** `pnpm scenario` (le banc de calibrage) peut bouger — les sources chaudes réchauffent aussi les PNJ, et c'est **voulu** (le monde est le même pour tous). S'il devient rouge, regardez POURQUOI avant de toucher un chiffre.

- [ ] **Step 7: Vérifier le déterminisme et le replay (critère A10)**

Run: `pnpm --filter @braises/sim test replay events sim`
Expected: PASS. Même seed + mêmes inputs → mêmes `knownPois`, mêmes `visitedPois`, même flux d'événements.

Si l'un de ces trois fichiers montre une **divergence entre deux runs**, arrêtez-vous : c'est un bug de déterminisme, pas un attendu à mettre à jour.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/temperature.ts packages/sim/src/combat.ts packages/sim/src/poi-discovery.ts packages/sim/src/poi-discovery.test.ts
git commit -m "feat(sim): le répit — Source chaude, Grotte, Tarn ; et la garde anti-butin"
```

---

### Task 6: Le client — la carte ne montre que ce qu'on connaît

La soustraction fondatrice. La carte plein écran (`M`) affiche aujourd'hui **toutes** les pastilles dès le tick 0 : la vallée est divulguée avant le premier pas. **On cache les lieux, jamais le terrain** (spec R1-R2).

**Files:**
- Modify: `packages/client/src/hud-state.ts` (clé `knownPois`)
- Modify: `packages/client/src/scenes/world/hud-bridge.ts` (`publishPlayerVitals`)
- Modify: `packages/client/src/scenes/UIScene.ts` (construction des pastilles ~lignes 247-255, visibilité, et le survol)

**Interfaces:**
- Consumes: `Entity.knownPois` (Task 2), transporté tel quel par `SnapshotMessage.entities`.
- Produces: rien pour `/sim`.

- [ ] **Step 1: Ajouter la clé au HUD**

Dans `packages/client/src/hud-state.ts`, dans l'interface d'état, à côté de `mapData` :

```ts
  /** Les lieux que MON joueur connaît (spec lieux R1) — index dans `mapData.zones`.
   *  La carte plein écran ne montre que ceux-là : le terrain est offert, les lieux se gagnent. */
  knownPois: number[]
```

Ajouter la valeur initiale `knownPois: []` là où les autres clés sont initialisées (suivre le motif existant du fichier).

- [ ] **Step 2: Publier depuis le snapshot**

Dans `packages/client/src/scenes/world/hud-bridge.ts`, `publishPlayerVitals` — c'est déjà la fonction qui publie l'état de MON avatar :

```ts
/** Les jauges et l'inventaire de MON avatar (l'entité autoritative du snapshot). */
export function publishPlayerVitals(registry: Registry, me: Entity): void {
  setHud(registry, 'inv', me.inventory)
  setHud(registry, 'hunger', me.hunger)
  setHud(registry, 'skills', me.skills)
  setHud(registry, 'hp', me.hp)
  setHud(registry, 'stamina', me.stamina)
  setHud(registry, 'wounds', me.wounds)
  setHud(registry, 'knownPois', me.knownPois)
}
```

- [ ] **Step 3: Indexer les pastilles par `poiId`**

Dans `UIScene.ts`, la construction actuelle (~ligne 249) **perd le `poiId`** : elle filtre puis mappe, donc l'index du tableau de pastilles n'est plus l'index de la zone. Il faut le conserver.

Changer la déclaration du champ (~ligne 95) :

```ts
  /** Une pastille par POI (zone avec un `kind`), AVEC son poiId — l'index dans `map.zones`,
   *  qui est l'identité d'un lieu (spec lieux R4). Le filtre `knownPois` en dépend. */
  private mapPoiDots: { poiId: number; dot: Phaser.GameObjects.Arc }[] = []
```

Et la construction :

```ts
    // Une pastille par POI (zone porteuse d'un `kind` ; les zones sans `kind` sont de simples
    // toponymes). Créées une fois — leur VISIBILITÉ, elle, suit `knownPois` (spec lieux R1).
    this.mapPoiDots = map.zones
      .map((z, poiId) => ({ z, poiId }))
      .filter(({ z }) => z.kind !== undefined)
      .map(({ z, poiId }) => ({
        poiId,
        dot: this.add
          .circle(this.mapLocalX(map, z.x + z.w / 2), this.mapLocalY(map, z.y + z.h / 2), MAP_POI_RADIUS, MAP_POI_FILL)
          .setStrokeStyle(1, MAP_POI_STROKE)
          .setVisible(false), // rien n'est connu au départ
      }))
```

Et la ligne du conteneur, juste en dessous :

```ts
    this.mapLayer = this.add.container(W / 2, H / 2, [this.mapImage, ...this.mapPoiDots.map((p) => p.dot), this.mapMarker])
```

- [ ] **Step 4: Faire suivre la visibilité**

Dans la méthode `update` de `UIScene` (ou là où le HUD est relu à chaque frame — suivre le motif du fichier), quand la carte est ouverte :

```ts
    // Les lieux se gagnent : on ne montre que ceux qu'on connaît (spec lieux R1).
    const known = getHud(this.registry, 'knownPois')
    for (const { poiId, dot } of this.mapPoiDots) dot.setVisible(known.includes(poiId))
```

- [ ] **Step 5: Le survol ne doit pas trahir non plus**

`updateMapHover` révèle le nom de la zone sous le curseur. Un lieu inconnu ne doit **rien** dire — sinon la soustraction est vaine, il suffirait de balayer la carte à la souris.

Repérer l'appel à `zoneAt` dans `updateMapHover` et le garder :

```ts
    // Une zone inconnue ne se nomme pas : le survol ne peut pas trahir ce que
    // la pastille cache (sinon il suffirait de balayer la carte à la souris).
    const zone = zoneAt(map, tx, ty)
    const poiId = zone ? map.zones.indexOf(zone) : -1
    const hidden = zone?.kind !== undefined && !getHud(this.registry, 'knownPois').includes(poiId)
    if (!zone || hidden) {
      this.mapHover.setVisible(false)
      return
    }
```

(Adapter au corps réel de la méthode : le principe est qu'un POI non connu se comporte comme « pas de zone ». Les toponymes sans `kind` — le Pont, le Col — restent nommés : ils font partie de la forme de la vallée, pas de son secret.)

- [ ] **Step 6: Vérifier en jeu**

`pnpm check && pnpm test && pnpm lint` d'abord.

Puis lancer le jeu et **regarder** — c'est le seul test qui vaille ici :

1. Ouvrir la carte (`M`) au démarrage → **aucune pastille**, mais le terrain entier (relief, biomes, rivière, routes).
2. Marcher jusqu'à un lieu quelconque → il apparaît sur la carte.
3. Survoler une pastille non découverte → **rien** ne s'affiche.
4. Atteindre un Belvédère → **une grappe** de pastilles s'allume d'un coup dans les environs.

Le mode debug (F1) et le TP par clic sur la carte aident beaucoup pour le point 4.

> **Rappel de la mémoire projet :** `pnpm dev` est bloqué par un cache `.vite` appartenant à root — passer par **build + preview** et le Chromium en cache de playwright-core (voir la mémoire `browser-smoke-test`).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/hud-state.ts packages/client/src/scenes/world/hud-bridge.ts packages/client/src/scenes/UIScene.ts
git commit -m "feat(client): la carte ne montre que les lieux connus — le terrain reste offert"
```

---

## Après le plan

Mettre à jour :
- `docs/specs/lieux.md` : statut **brouillon → implémenté**, avec la date et les critères verts.
- `docs/decisions.md` : une ligne de bilan (ce qui a été livré, ce qui a dévié du plan et pourquoi, ce qui reste).

Ce qui reste hors périmètre, et où ça revient (rappel de la spec) : les **rumeurs** achetables au marchand (`knownPois` en est déjà la structure de données) et la **brume irradiée** → chantier 2 ; les **villages PNJ** et les **Réfugiés** → chantier 3 ; l'**ambiance visuelle** des lieux → chantier ambiance, et c'est là, et seulement là, que la question du moteur de rendu se rejouera.
