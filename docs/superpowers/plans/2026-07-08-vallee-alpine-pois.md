# POIs de la Vallée alpine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peupler la carte alpine de ~90 POIs bien espacés (semis Poisson-disk pur) et variés (26 types assignés par biome), chacun posé en `Zone` nommée ; les gisements/carrières branchent des nœuds, les tanières/repaires spawn des monstres au runtime.

**Architecture:** `poissonPoints` (bruit bleu pur, `hash2`) pose les points ; `placePois` (pur, muté dans `generateAlpineTerrain`) leur assigne un type par biome (table pondérée, plafonds durs) et pousse des `Zone{kind}` dans `map.zones` ; `generateNodes` (inchangé) branche gisement/carrière ; `spawnPoiMonsters` (runtime) lit les zones et spawn sanglier/cendreux ; la vignette gagne des pastilles par famille pour le réglage.

**Tech Stack:** TypeScript pur (`packages/sim`), Vitest ; script Node `scripts/vignette.mjs`.

## Global Constraints

- **`/sim` pur** (aucun import Phaser/Colyseus/Node) ; **génération de carte PURE** (pas de `SimState`, pas de `rng.ts` à état) — l'aléa vient de **`hash2(x,y,seed): float [0,1)`** (noise.ts).
- **Déterministe au bit près** : `+ - * /`, `Math.sqrt/abs/floor/ceil/min/max` + **constantes** (`Math.SQRT1_2` OK). **PAS** de `sin/cos/pow/exp/log/**`/`Math.random`/`Date`. Le candidat Poisson dans l'anneau se tire par **reject-sampling dans un carré** (pas de trigo).
- **Scalable ∝ dimensions** : rayon d'exclusion = fraction de `D = min(width,height)` ; le nombre de POIs suit la surface (prouvé à deux tailles, cf. `alpinegen.test.ts:103-105`).
- **Zéro nouvelle ressource / créature** (spec figée) : seuls les kinds `gisement`/`carriere` branchent `generateNodes` (inchangé) ; seuls `boar`/`cendreux` sont spawnés.
- **Monstres au runtime** : `spawnPoiMonsters(state, seed)` (a besoin de `SimState`) — jamais dans la génération pure.
- **Équilibrage/contenu** : constantes de placement (rayon, plafonds) = **contenu de carte**, à côté du générateur (pas dans `balance.ts` — convention SP1 : les densités de carte vivent avec le générateur).
- Commentaires **français**, identifiants **anglais**.
- **API (vérifiée)** : `generateAlpineTerrain(w,h,seed): WorldMap` (alpinegen.ts:328, mute un map local, insérer la passe POI entre `paintAvalanches` l.336 et `sealBorderRing` l.337) ; `Zone{name,x,y,w,h,kind?}` + `map.zones: Zone[]` + `zoneAt(map,x,y)` (map.ts:11,26,60) ; `hash2(x,y,seed=0)` (noise.ts:11) ; `terrainAt(map,tx,ty)`/`elevationAt(map,tx,ty)` (map.ts:42,48) ; `generateNodes(map,seed)` branche `zone.kind==='gisement'|'carriere'` (economy.ts:229, INCHANGÉ) ; `spawnMonster(state,type,x,y): number` (monsters.ts:31) ; `renderVignette(map,maxDim): {w,h,rgb}` (vignette.ts:37) ; ids terrain (balance.ts:202+) : scree 9, rock 5, boulders 16, glacier 15, burnt_forest 21, peat_bog 18, reed_marsh 19, alpine_meadow 12, alpine_flowers 20, old_growth 22, snow 10, heath 11, pine 13, larch 14, flower_meadow 17, forest 3, grass 1, marsh 8.
- Vérifs avant commit : `pnpm check && pnpm lint && pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts`.

## File Structure

- **Create** `packages/sim/src/poisson.ts` — `poissonPoints` (bruit bleu pur).
- **Create** `packages/sim/src/poi.ts` — `POI_TYPES` (table), `placePois` (pur), `spawnPoiMonsters` (runtime), `POI_PLACEMENT` (constantes de contenu).
- **Create** `packages/sim/src/poi.test.ts` + `poisson.test.ts`.
- **Modify** `packages/sim/src/alpinegen.ts` — appel `placePois(map, seed)`.
- **Modify** `packages/sim/src/vignette.ts` — pastilles POI par famille.
- **Modify** `packages/sim/src/index.ts` — exports.

---

### Task 1 : `poissonPoints` — le semis en bruit bleu (pur)

**Files:**
- Create: `packages/sim/src/poisson.ts`, `packages/sim/src/poisson.test.ts`
- Modify: `packages/sim/src/index.ts`

**Interfaces:**
- Produces: `poissonPoints(width:number, height:number, seed:number, radius:number, k?:number): {x:number,y:number}[]`.

- [ ] **Step 1 : Tests qui échouent**
```ts
import { describe, it, expect } from 'vitest'
import { poissonPoints } from './poisson'

const minPairDist = (pts: {x:number,y:number}[]): number => {
  let m = Infinity
  for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) {
    const dx=pts[i]!.x-pts[j]!.x, dy=pts[i]!.y-pts[j]!.y
    m = Math.min(m, Math.sqrt(dx*dx+dy*dy))
  }
  return m
}

describe('poissonPoints (bruit bleu)', () => {
  it('aucun couple à moins de radius (invariant blue-noise)', () => {
    const pts = poissonPoints(400, 600, 7, 40)
    expect(pts.length).toBeGreaterThan(10)
    expect(minPairDist(pts)).toBeGreaterThanOrEqual(40 - 1e-6)
  })
  it('déterministe : même seed → mêmes points', () => {
    const a = poissonPoints(400, 600, 7, 40)
    const b = poissonPoints(400, 600, 7, 40)
    expect(a).toEqual(b)
    const c = poissonPoints(400, 600, 8, 40)
    expect(c).not.toEqual(a)
  })
  it('densité ∝ surface : ~4× plus de points pour 2× chaque dimension', () => {
    const small = poissonPoints(200, 300, 5, 30).length
    const big = poissonPoints(400, 600, 5, 30).length
    expect(big).toBeGreaterThan(small * 3)
    expect(big).toBeLessThan(small * 5)
  })
  it('tous les points dans les bornes', () => {
    for (const p of poissonPoints(400, 600, 7, 40)) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThan(400)
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThan(600)
    }
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm --filter @braises/sim exec vitest run src/poisson.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter** — créer `poisson.ts` :
```ts
/**
 * Semis en bruit bleu (Bridson) — PUR et déterministe : l'aléa vient de hash2,
 * le candidat dans l'anneau [r,2r] est tiré par reject-sampling dans un carré
 * (aucune trigonométrie). Garantit : aucun couple de points à moins de `radius`.
 */
import { hash2 } from './noise'

export function poissonPoints(width: number, height: number, seed: number, radius: number, k = 30): { x: number; y: number }[] {
  const cell = radius * Math.SQRT1_2 // r/√2 : au plus un point par cellule
  const gw = Math.ceil(width / cell)
  const gh = Math.ceil(height / cell)
  const grid = new Int32Array(gw * gh).fill(-1)
  const pts: { x: number; y: number }[] = []
  const active: number[] = []
  let draws = 0
  const rand = (): number => hash2(draws++, seed, 0x504f49) // salt 'POI'

  const gset = (i: number): void => {
    const gx = Math.floor(pts[i]!.x / cell)
    const gy = Math.floor(pts[i]!.y / cell)
    grid[gy * gw + gx] = i
  }
  const farEnough = (x: number, y: number): boolean => {
    const gx = Math.floor(x / cell)
    const gy = Math.floor(y / cell)
    for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++) {
      for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
        const i = grid[yy * gw + xx]!
        if (i < 0) continue
        const dx = pts[i]!.x - x
        const dy = pts[i]!.y - y
        if (dx * dx + dy * dy < radius * radius) return false
      }
    }
    return true
  }

  pts.push({ x: rand() * width, y: rand() * height })
  active.push(0)
  gset(0)

  while (active.length > 0) {
    const ai = Math.floor(rand() * active.length)
    const p = pts[active[ai]!]!
    let found = false
    for (let i = 0; i < k; i++) {
      let cx = 0, cy = 0, d2 = 0
      let guard = 0
      do {
        cx = (rand() * 4 - 2) * radius
        cy = (rand() * 4 - 2) * radius
        d2 = cx * cx + cy * cy
        guard++
      } while ((d2 < radius * radius || d2 > 4 * radius * radius) && guard < 16)
      const nx = p.x + cx
      const ny = p.y + cy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      if (farEnough(nx, ny)) {
        pts.push({ x: nx, y: ny })
        active.push(pts.length - 1)
        gset(pts.length - 1)
        found = true
        break
      }
    }
    if (!found) active.splice(ai, 1)
  }
  return pts
}
```
`index.ts` : `export { poissonPoints } from './poisson'`.

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/poisson.test.ts && pnpm check && pnpm lint` → PASS (aucune transcendante ; `Math.SQRT1_2`/`sqrt` OK).

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/poisson.ts packages/sim/src/poisson.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): poissonPoints — semis en bruit bleu pur (Bridson, hash2, sans trigo)"
```

---

### Task 2 : Table POI + `placePois` (assignation par biome, plafonds, Zones)

**Files:**
- Create: `packages/sim/src/poi.ts`
- Test: `packages/sim/src/poi.test.ts`
- Modify: `packages/sim/src/index.ts`

**Interfaces:**
- Consumes: `poissonPoints`, `terrainAt`/`elevationAt`, `WorldMap`/`Zone`.
- Produces: `POI_TYPES` ; `POI_PLACEMENT` ; `placePois(map: WorldMap, seed: number): void` (mute `map.zones`).

- [ ] **Step 1 : Tests qui échouent**
```ts
import { describe, it, expect } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { placePois, POI_TYPES } from './poi'
import { terrainAt } from './map'

describe('placePois', () => {
  it('assigne chaque POI à un biome autorisé pour son type', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    placePois(map, 5)
    const bySlug = new Map(POI_TYPES.map((t) => [t.slug, t]))
    for (const z of map.zones) {
      const t = bySlug.get(z.kind!)
      if (!t) continue
      const terr = terrainAt(map, Math.floor(z.x + z.w / 2), Math.floor(z.y + z.h / 2))
      expect(t.biomes.includes(terr)).toBe(true) // biome-cohérence
    }
  })
  it('respecte les plafonds durs (gisement rare, cairn fréquent)', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    placePois(map, 5)
    const count = (slug: string) => map.zones.filter((z) => z.kind === slug).length
    const gis = POI_TYPES.find((t) => t.slug === 'gisement')!
    expect(count('gisement')).toBeLessThanOrEqual(gis.cap)
  })
  it('déterministe : même seed → mêmes zones', () => {
    const a = generateAlpineTerrain(200, 300, 9); placePois(a, 9)
    const b = generateAlpineTerrain(200, 300, 9); placePois(b, 9)
    expect(a.zones).toEqual(b.zones)
  })
  it('pose des zones gisement/carriere (pour generateNodes)', () => {
    const map = generateAlpineTerrain(360, 540, 5); placePois(map, 5)
    // au moins un des deux kinds ressource présent sur une carte de cette taille
    expect(map.zones.some((z) => z.kind === 'gisement' || z.kind === 'carriere')).toBe(true)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — FAIL.

- [ ] **Step 3 : Implémenter** — créer `poi.ts`. La table encode, pour chaque type : `slug`, `name` (nom de base), `family`, `biomes` (ids terrain autorisés), `weight` (poids relatif), `cap` (plafond dur), `minElev?`/`maxElev?`, `footprint` (côté de la zone), `nodeKind?` (`'gisement'|'carriere'`), `monster?` (`'boar'|'cendreux'`, consommé par Task 4).
```ts
/**
 * Les POIs de la Vallée alpine (spec figée 2026-07-08, 26 types). Placement PUR :
 * un semis bruit bleu pose ~90 points, chacun reçoit un type valide pour son biome
 * local (table pondérée, plafonds durs), et devient une Zone nommée. hash2 = seul aléa.
 */
import { hash2 } from './noise'
import { poissonPoints } from './poisson'
import { elevationAt, terrainAt, type WorldMap, type Zone } from './map'

// ids terrain (balance.ts) — repris localement pour lisibilité de la table.
const SCREE = 9, ROCK = 5, BOULDERS = 16, GLACIER = 15, BURNT = 21, PEAT = 18, REED = 19,
  AL_MEADOW = 12, AL_FLOWERS = 20, OLD_GROWTH = 22, HEATH = 11, PINE = 13, FLOWER = 17,
  FOREST = 3, GRASS = 1

export interface PoiType {
  slug: string
  name: string
  family: 'eco' | 'shelter' | 'danger' | 'reward'
  biomes: number[]
  weight: number
  cap: number
  minElev?: number
  maxElev?: number
  footprint: number
  nodeKind?: 'gisement' | 'carriere'
  monster?: 'boar' | 'cendreux'
}

/** Rayon d'exclusion du semis = fraction de min(w,h). Calibré à la vignette. */
export const POI_PLACEMENT = {
  SPACING_FRAC: 0.11, // ~90 POIs sur 2400×3600 ; à régler à la vignette
  CANONICAL: { width: 2400, height: 3600 },
}

export const POI_TYPES: PoiType[] = [
  // Économie
  { slug: 'gisement', name: 'le Gisement', family: 'eco', biomes: [SCREE, ROCK, BOULDERS], minElev: 0.55, weight: 2, cap: 3, footprint: 4, nodeKind: 'gisement' },
  { slug: 'carriere', name: 'la Carrière', family: 'eco', biomes: [SCREE, BOULDERS], weight: 3, cap: 4, footprint: 4, nodeKind: 'carriere' },
  { slug: 'saline', name: 'la Saline', family: 'eco', biomes: [AL_MEADOW, AL_FLOWERS, HEATH], weight: 2, cap: 3, footprint: 3 },
  { slug: 'verger', name: 'le Verger sauvage', family: 'eco', biomes: [FLOWER, GRASS, AL_MEADOW], weight: 3, cap: 4, footprint: 3 },
  // Abris
  { slug: 'ruines', name: 'les Ruines', family: 'shelter', biomes: [OLD_GROWTH, FOREST, GRASS], weight: 3, cap: 4, footprint: 4 },
  { slug: 'cabane', name: 'la Cabane de berger', family: 'shelter', biomes: [AL_MEADOW, AL_FLOWERS], weight: 4, cap: 5, footprint: 2 },
  { slug: 'abri', name: "l'Abri sous roche", family: 'shelter', biomes: [ROCK, BOULDERS, SCREE], weight: 5, cap: 6, footprint: 2 },
  { slug: 'mine', name: 'la Mine abandonnée', family: 'shelter', biomes: [SCREE, ROCK], minElev: 0.5, weight: 3, cap: 3, footprint: 3 },
  { slug: 'oratoire', name: 'l’Oratoire', family: 'shelter', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.55, weight: 3, cap: 3, footprint: 2 },
  { slug: 'bivouac', name: 'le Vieux bivouac', family: 'shelter', biomes: [GRASS, AL_MEADOW, HEATH, FOREST, SCREE, FLOWER, OLD_GROWTH, PINE], weight: 4, cap: 4, footprint: 2 },
  // Danger
  { slug: 'taniere', name: 'la Tanière', family: 'danger', biomes: [FOREST, PINE, GRASS], weight: 6, cap: 8, footprint: 3, monster: 'boar' },
  { slug: 'repaire', name: 'le Repaire de Cendrés', family: 'danger', biomes: [BURNT, ROCK, SCREE], weight: 4, cap: 5, footprint: 3, monster: 'cendreux' },
  { slug: 'epave', name: "l'Épave d'avalanche", family: 'danger', biomes: [SCREE, BOULDERS], minElev: 0.55, weight: 3, cap: 3, footprint: 2 },
  { slug: 'fondriere', name: 'la Fondrière', family: 'danger', biomes: [PEAT, REED], weight: 3, cap: 3, footprint: 3 },
  { slug: 'crevasses', name: 'le Champ de crevasses', family: 'danger', biomes: [GLACIER], weight: 3, cap: 3, footprint: 4 },
  // Récompense / paysage
  { slug: 'belvedere', name: 'le Belvédère', family: 'reward', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.75, weight: 3, cap: 4, footprint: 2 },
  { slug: 'grotte', name: 'la Grotte', family: 'reward', biomes: [ROCK, SCREE], weight: 4, cap: 5, footprint: 2 },
  { slug: 'cascade', name: 'la Cascade', family: 'reward', biomes: [ROCK, SCREE], minElev: 0.4, weight: 2, cap: 4, footprint: 2 },
  { slug: 'erratique', name: 'le Bloc erratique', family: 'reward', biomes: [BOULDERS, AL_MEADOW, GRASS, FLOWER], weight: 4, cap: 5, footprint: 2 },
  { slug: 'arbre', name: "l'Arbre remarquable", family: 'reward', biomes: [OLD_GROWTH], weight: 2, cap: 3, footprint: 2 },
  { slug: 'cairn', name: 'le Cairn', family: 'reward', biomes: [GRASS, AL_MEADOW, HEATH, SCREE, ROCK, FLOWER, AL_FLOWERS, FOREST, PINE], weight: 12, cap: 14, footprint: 1 },
  { slug: 'sanctuaire', name: 'le Sanctuaire', family: 'reward', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.7, weight: 1, cap: 2, footprint: 2 },
  { slug: 'source_chaude', name: 'la Source chaude', family: 'reward', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.55, weight: 2, cap: 2, footprint: 2 },
  { slug: 'arche', name: "l'Arche de roche", family: 'reward', biomes: [ROCK, SCREE], weight: 2, cap: 2, footprint: 2 },
  { slug: 'tarn', name: 'le Tarn', family: 'reward', biomes: [AL_MEADOW, SCREE, AL_FLOWERS], minElev: 0.45, weight: 3, cap: 3, footprint: 3 },
  { slug: 'petroglyphes', name: 'les Pétroglyphes', family: 'reward', biomes: [ROCK, SCREE], minElev: 0.55, weight: 2, cap: 2, footprint: 2 },
]

/** Types valides pour la tuile (biome + altitude). */
function candidatesFor(map: WorldMap, tx: number, ty: number, used: Map<string, number>): PoiType[] {
  const terr = terrainAt(map, tx, ty)
  const el = elevationAt(map, tx, ty)
  return POI_TYPES.filter(
    (t) => t.biomes.includes(terr) && el >= (t.minElev ?? 0) && el <= (t.maxElev ?? 1) && (used.get(t.slug) ?? 0) < t.cap,
  )
}

/** Pose les POIs comme Zones nommées dans map.zones (pur, déterministe). */
export function placePois(map: WorldMap, seed: number): void {
  const radius = POI_PLACEMENT.SPACING_FRAC * Math.min(map.width, map.height)
  const pts = poissonPoints(map.width, map.height, seed, radius)
  const used = new Map<string, number>()
  let n = 0
  for (const p of pts) {
    const tx = Math.floor(p.x)
    const ty = Math.floor(p.y)
    const cands = candidatesFor(map, tx, ty, used)
    if (cands.length === 0) continue // biome sans POI valide → point sauvage (l'entre-deux)
    // Tirage pondéré déterministe.
    const total = cands.reduce((s, t) => s + t.weight, 0)
    let r = hash2(tx, ty, seed ^ 0x504f49) * total
    let picked = cands[cands.length - 1]!
    for (const t of cands) {
      if (r < t.weight) { picked = t; break }
      r -= t.weight
    }
    const count = (used.get(picked.slug) ?? 0) + 1
    used.set(picked.slug, count)
    const f = picked.footprint
    map.zones.push({ name: `${picked.name} ${roman(count)}`, x: tx, y: ty, w: f, h: f, kind: picked.slug })
    n++
  }
}

const ROMANS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV']
function roman(n: number): string { return ROMANS[n] ?? String(n) }
```
`index.ts` : `export { placePois, spawnPoiMonsters, POI_TYPES, POI_PLACEMENT } from './poi'` (spawnPoiMonsters arrive en Task 4 ; si `check` casse ici, n'exporter que `placePois, POI_TYPES, POI_PLACEMENT` et compléter en Task 4).

> Note : le nom `roman()` évite deux POIs homonymes ; le `name` doit rester déterministe (compteur d'ordre d'insertion, pas de hasard).

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/poi.test.ts && pnpm check && pnpm lint` → PASS.

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/poi.ts packages/sim/src/poi.test.ts packages/sim/src/index.ts
git commit -m "feat(sim): placePois — 26 types assignés par biome (table pondérée, plafonds, Zones)"
```

---

### Task 3 : Câblage dans `generateAlpineTerrain` + densité/scalabilité/connectivité

**Files:**
- Modify: `packages/sim/src/alpinegen.ts` (appel `placePois`)
- Test: `packages/sim/src/poi.test.ts`

**Interfaces:** aucune nouvelle.

- [ ] **Step 1 : Tests qui échouent**
```ts
import { zoneAt } from './map'
import { POI_PLACEMENT } from './poi'

describe('POIs dans la carte alpine', () => {
  it('generateAlpineTerrain pose des POIs (map.zones peuplée)', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    expect(map.zones.length).toBeGreaterThan(5)
  })
  it('densité ∝ surface (scalable, deux tailles)', () => {
    const small = generateAlpineTerrain(180, 270, 5).zones.length
    const big = generateAlpineTerrain(360, 540, 5).zones.length
    expect(big).toBeGreaterThan(small * 2) // 4× surface → nettement plus de POIs
  })
  it('espacement mini respecté (centres de zones POI)', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    const radius = POI_PLACEMENT.SPACING_FRAC * Math.min(240, 360)
    const c = map.zones.map((z) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 }))
    for (let i=0;i<c.length;i++) for (let j=i+1;j<c.length;j++) {
      const dx=c[i]!.x-c[j]!.x, dy=c[i]!.y-c[j]!.y
      expect(Math.sqrt(dx*dx+dy*dy)).toBeGreaterThanOrEqual(radius - 1.5) // ±1 tuile (floor)
    }
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — FAIL (zones vides).

- [ ] **Step 3 : Implémenter** — dans `alpinegen.ts`, `generateAlpineTerrain`, insérer **avant `sealBorderRing(map)`** (l.337) :
```ts
  placePois(map, seed)
```
et l'import `import { placePois } from './poi'`.

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/poi.test.ts src/alpinegen.test.ts && pnpm check && pnpm lint` → PASS (les tests substrat existants restent verts : `placePois` n'ajoute que des zones, ne touche pas le terrain).

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/alpinegen.ts packages/sim/src/poi.test.ts
git commit -m "feat(sim): les POIs peuplent generateAlpineTerrain (scalable)"
```

---

### Task 4 : `spawnPoiMonsters` — sanglier en tanière, cendreux en repaire (runtime)

**Files:**
- Modify: `packages/sim/src/poi.ts` (`spawnPoiMonsters`)
- Modify: `packages/sim/src/index.ts` (export)
- Test: `packages/sim/src/poi.test.ts`

**Interfaces:**
- Consumes: `spawnMonster` (`./monsters`), `SimState`.
- Produces: `spawnPoiMonsters(state: SimState, seed: number): void`.

- [ ] **Step 1 : Tests qui échouent**
```ts
import { createSim } from './sim'
import { spawnPoiMonsters } from './poi'

describe('spawnPoiMonsters (runtime)', () => {
  it('pose un sanglier par tanière et un cendreux par repaire', () => {
    const map = generateAlpineTerrain(360, 540, 5); // zones POI incluses
    const state = createSim(5, { map })
    const tanieres = state.map.zones.filter((z) => z.kind === 'taniere').length
    const repaires = state.map.zones.filter((z) => z.kind === 'repaire').length
    spawnPoiMonsters(state, 5)
    expect(state.monsters.filter((m) => m.type === 'boar').length).toBe(tanieres)
    expect(state.monsters.filter((m) => m.type === 'cendreux').length).toBe(repaires)
  })
  it('déterministe : mêmes positions de monstres', () => {
    const m1 = generateAlpineTerrain(360, 540, 5); const s1 = createSim(5, { map: m1 }); spawnPoiMonsters(s1, 5)
    const m2 = generateAlpineTerrain(360, 540, 5); const s2 = createSim(5, { map: m2 }); spawnPoiMonsters(s2, 5)
    expect(s1.entities.map((e) => [e.x, e.y])).toEqual(s2.entities.map((e) => [e.x, e.y]))
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — FAIL.

- [ ] **Step 3 : Implémenter** — dans `poi.ts` (importer `spawnMonster` de `./monsters`, `type SimState` de `./sim`) :
```ts
/** Spawn runtime des monstres de POI (tanière → sanglier, repaire → cendreux). Déterministe. */
export function spawnPoiMonsters(state: SimState, seed: number): void {
  for (const z of state.map.zones) {
    const t = POI_TYPES.find((p) => p.slug === z.kind)
    if (!t?.monster) continue
    // Position déterministe dans l'empreinte de la zone.
    const jx = hash2(z.x, z.y, seed ^ 0x4d4f4e) // 'MON'
    const jy = hash2(z.y, z.x, seed ^ 0x4d4f4e)
    const x = z.x + Math.min(z.w - 1, Math.floor(jx * z.w)) + 0.5
    const y = z.y + Math.min(z.h - 1, Math.floor(jy * z.h)) + 0.5
    spawnMonster(state, t.monster, x, y)
  }
}
```
`index.ts` : compléter l'export avec `spawnPoiMonsters`.

> Note perf/déterminisme : `spawnMonster` utilise `spawnEntity` (id incrémental) → ordre déterministe car on itère `state.map.zones` dans l'ordre d'insertion (stable). Aucun `SimState.rngState` consommé.

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/poi.test.ts && pnpm check && pnpm lint && pnpm --filter @braises/sim exec vitest run --exclude src/scenario.test.ts` → PASS.

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/poi.ts packages/sim/src/index.ts packages/sim/src/poi.test.ts
git commit -m "feat(sim): spawnPoiMonsters — faune/cendrés des POIs au runtime"
```

---

### Task 5 : Pastilles POI sur la vignette (réglage visuel)

**Files:**
- Modify: `packages/sim/src/vignette.ts`
- Test: `packages/sim/src/poi.test.ts` (un test léger d'invariant couleur)

**Interfaces:** `renderVignette` inchangée (lit déjà `map.zones`).

- [ ] **Step 1 : Test qui échoue**
```ts
import { renderVignette } from './vignette'
import { POI_FAMILY_RGB } from './vignette'

describe('vignette POI', () => {
  it('expose une couleur par famille de POI', () => {
    expect(POI_FAMILY_RGB.eco).toHaveLength(3)
    expect(POI_FAMILY_RGB.danger).toHaveLength(3)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — FAIL (`POI_FAMILY_RGB` absent).

- [ ] **Step 3 : Implémenter** — dans `vignette.ts`, exporter la table et peindre les pastilles après la boucle principale (avant le `return`). Importer `POI_TYPES` de `./poi`.
```ts
export const POI_FAMILY_RGB: Record<string, [number, number, number]> = {
  eco: [230, 200, 60], // or/jaune
  shelter: [90, 160, 230], // bleu
  danger: [220, 70, 60], // rouge
  reward: [150, 220, 120], // vert
}
```
Après le remplissage des pixels de terrain (juste avant `return`), ajouter :
```ts
  const familyOf = new Map(POI_TYPES.map((t) => [t.slug, t.family]))
  for (const z of map.zones) {
    const fam = familyOf.get(z.kind ?? '')
    if (!fam) continue
    const col = POI_FAMILY_RGB[fam]!
    const px = Math.floor((z.x + z.w / 2) / step)
    const py = Math.floor((z.y + z.h / 2) / step)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx, y = py + dy
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const o = (y * w + x) * 3
        rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2]
      }
    }
  }
```
(adapter `w`/`h`/`step`/`rgb` aux noms réels du corps de `renderVignette`, vignette.ts:37-59.)

- [ ] **Step 4 : Vérifier** — `pnpm --filter @braises/sim exec vitest run src/poi.test.ts && pnpm check && pnpm lint` → PASS.

- [ ] **Step 5 : Commit**
```bash
git add packages/sim/src/vignette.ts packages/sim/src/poi.test.ts
git commit -m "feat(sim): pastilles POI par famille sur la vignette (réglage visuel)"
```

---

## Notes d'exécution

- **Finale de réglage à la vignette (contrôleur, hors subagent)** : après la Task 5, rendre 4 vignettes (2 seeds × 2 tailles, ou 4 seeds) via `scripts/vignette.mjs` et les montrer à Alexis en **grille 2×2** (préférence artefact `[[artifact-images-preference]]`) pour caler `SPACING_FRAC` (~90 POIs) et vérifier la répartition/variété à l'œil. Itérer `SPACING_FRAC` / poids / plafonds ici.
- **Après ce plan** : brancher `generateNodes(map, seed)` + `spawnPoiMonsters(state, seed)` là où l'hôte montera la carte alpine (pas encore la carte live — la Veillée tourne toujours sur `generateValley`). Rendu client des POIs = travail client. Ours/loup + variantes d'abri = faune ultérieure.
- **Calibrage** : `SPACING_FRAC`, poids et plafonds sont des ordres de grandeur, réglés à la vignette (règle projet). La cible ~90 vaut pour 2400×3600.
