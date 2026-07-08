/**
 * Les POIs de la Vallée alpine (spec figée 2026-07-08, 26 types). Placement PUR :
 * un semis bruit bleu pose ~90 points, chacun reçoit un type valide pour son biome
 * local (table pondérée, plafonds durs), et devient une Zone nommée. hash2 = seul aléa.
 */
import { hash2 } from './noise'
import { poissonPoints } from './poisson'
import { elevationAt, terrainAt, type WorldMap } from './map'
import { spawnMonster } from './monsters'
import type { SimState } from './sim'

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
  // 0.11 laissait les types à faible poids (gisement, carrière) disparaître
  // trop souvent sur les cartes de taille modeste — sous-échantillonnage.
  // 0.08 double grossièrement la densité et garantit leur présence en
  // pratique tout en restant proche de la cible ~90 POIs sur 2400×3600.
  SPACING_FRAC: 0.08,
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
    // Centre l'empreinte sur le point échantillonné : le biome a été validé au
    // point (tx,ty), donc le centre de la Zone doit retomber sur ce même point
    // (et non son coin), sans quoi une empreinte >1 tuile peut déborder sur un
    // biome voisin non autorisé.
    const half = Math.floor(f / 2)
    map.zones.push({ name: `${picked.name} ${roman(count)}`, x: tx - half, y: ty - half, w: f, h: f, kind: picked.slug })
  }
}

const ROMANS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV']
function roman(n: number): string { return ROMANS[n] ?? String(n) }

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
