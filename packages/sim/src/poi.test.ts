import { describe, it, expect } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { POI_TYPES, POI_PLACEMENT, spawnPoiMonsters } from './poi'
import { terrainAt } from './map'
import { createSim } from './sim'

describe('placePois', () => {
  // generateAlpineTerrain appelle désormais placePois en interne (Task 3) : ne
  // pas la rappeler ici, sous peine de poser les POIs une seconde fois sur la
  // même carte (doublons, plafonds contournés car `used` repart de zéro).
  it('assigne chaque POI à un biome autorisé pour son type', () => {
    const map = generateAlpineTerrain(240, 360, 5)
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
    const count = (slug: string) => map.zones.filter((z) => z.kind === slug).length
    const gis = POI_TYPES.find((t) => t.slug === 'gisement')!
    expect(count('gisement')).toBeLessThanOrEqual(gis.cap)
  })
  it('déterministe : même seed → mêmes zones', () => {
    const a = generateAlpineTerrain(200, 300, 9)
    const b = generateAlpineTerrain(200, 300, 9)
    expect(a.zones).toEqual(b.zones)
  })
  it('pose des zones gisement/carriere (pour generateNodes)', () => {
    const map = generateAlpineTerrain(360, 540, 5)
    // au moins un des deux kinds ressource présent sur une carte de cette taille
    expect(map.zones.some((z) => z.kind === 'gisement' || z.kind === 'carriere')).toBe(true)
  })
})

describe('POIs dans la carte alpine', () => {
  it('generateAlpineTerrain pose des POIs (map.zones peuplée)', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    expect(map.zones.length).toBeGreaterThan(5)
  })
  it('densité ∝ surface (scalable, à D = min(largeur,hauteur) fixe)', () => {
    // Une mise à l'échelle UNIFORME (mêmes proportions ×k) ne peut PAS servir
    // ici : le rayon d'exclusion est une fraction de D = min(w,h), donc un
    // ×k uniforme multiplie aussi le rayon par k — le semis obtenu est une
    // homothétie exacte du même tirage hash2 (mêmes indices de tirage), donc
    // un nombre de POIs strictement IDENTIQUE quelle que soit la surface
    // (vérifié empiriquement : 180×270 et 360×540 posent le même nombre de
    // zones). Pour observer une vraie dépendance à la surface, on la fait
    // varier à D fixe (même largeur mini, hauteur allongée) : ça casse
    // l'homothétie sans toucher au calibrage de placePois. La croissance
    // reste sous-linéaire au-delà d'un certain point (plafonds durs par
    // type, spec figée : 107 POIs au total sur 26 types).
    const small = generateAlpineTerrain(240, 360, 5).zones.length
    const big = generateAlpineTerrain(240, 1440, 5).zones.length // même D=240, 4× la surface
    expect(big).toBeGreaterThan(small * 1.15)
  })
  it('espacement mini respecté (centres de zones POI)', () => {
    const map = generateAlpineTerrain(240, 360, 5)
    const radius = POI_PLACEMENT.SPACING_FRAC * Math.min(240, 360)
    const c = map.zones.map((z) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 }))
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
      const dx = c[i]!.x - c[j]!.x, dy = c[i]!.y - c[j]!.y
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(radius - 1.5) // ±1 tuile (floor)
    }
  })
})

describe('spawnPoiMonsters (runtime)', () => {
  it('pose un sanglier par tanière et un cendreux par repaire', () => {
    const map = generateAlpineTerrain(360, 540, 5) // zones POI incluses
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
