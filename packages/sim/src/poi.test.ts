import { describe, it, expect } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { POI_TYPES, POI_PLACEMENT, spawnPoiMonsters } from './poi'
import { terrainAt, createEmptyMap } from './map'
import { poissonPoints } from './poisson'
import { TERRAINS } from './balance'
import { createSim } from './sim'
import { POI_FAMILY_RGB } from './vignette'

const ROCK_ID = 5 // TERRAINS[5].name === 'rock', walkable: false
const GRASS_ID = 1 // TERRAINS[1].name === 'grass', walkable: true

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

  /**
   * Non-régression : les POIs ne doivent pas s'agglutiner autour de `pts[0]` du semis.
   *
   * `poissonPoints` renvoie ses points dans l'ordre d'acceptation — une vague de croissance
   * partant de `pts[0]`. `placePois` consommant des plafonds durs au fil de l'itération, les
   * points proches de `pts[0]` raflaient les quotas : gradient de densité (ratio près/loin
   * mesuré à 1,31–2,50 selon la seed ; 54 POIs au nord contre 31 au sud sur la seed du jeu).
   * Corrigé par un mélange déterministe des points avant assignation.
   *
   * On mesure près/loin RELATIVEMENT à `pts[0]` (et non nord/sud) : le biais pointait vers
   * `pts[0]`, dont la position dépend de la seed — un test nord/sud ne l'aurait pas capté
   * pour toutes les seeds. Seuil 1,30 : sous le minimum d'avant-fix (1,31), au-dessus du
   * maximum d'après-fix (1,20).
   */
  it("les POIs ne se concentrent pas autour du premier point du semis", () => {
    const W = 240, H = 360
    for (const seed of [2026, 99, 2718, 31415]) {
      const radius = POI_PLACEMENT.SPACING_FRAC * Math.min(W, H)
      const pts = poissonPoints(W, H, seed, radius)
      const p0 = pts[0]!
      const d2 = (x: number, y: number): number => (x - p0.x) * (x - p0.x) + (y - p0.y) * (y - p0.y)
      // Médiane des distances du SEMIS : partage les points en deux moitiés équipotentes.
      const median = pts.map((p) => d2(p.x, p.y)).sort((a, b) => a - b)[Math.floor(pts.length / 2)]!

      const pois = generateAlpineTerrain(W, H, seed).zones.filter((z) => z.kind !== undefined)
      let near = 0, far = 0
      for (const z of pois) {
        if (d2(z.x + z.w / 2, z.y + z.h / 2) <= median) near++
        else far++
      }

      expect(far).toBeGreaterThan(0)
      expect(near / far).toBeLessThan(1.3)
    }
  })
})

describe('vignette POI', () => {
  it('expose une couleur par famille de POI', () => {
    expect(POI_FAMILY_RGB.eco).toHaveLength(3)
    expect(POI_FAMILY_RGB.danger).toHaveLength(3)
  })
})

describe('spawnPoiMonsters (runtime)', () => {
  it('pose au plus un sanglier par tanière et un cendreux par repaire (zones sans tuile marchable = pas de spawn)', () => {
    const map = generateAlpineTerrain(360, 540, 5) // zones POI incluses
    const state = createSim(5, { map })
    const tanieres = state.map.zones.filter((z) => z.kind === 'taniere').length
    const repaires = state.map.zones.filter((z) => z.kind === 'repaire').length
    spawnPoiMonsters(state, 5)
    expect(state.monsters.filter((m) => m.type === 'boar').length).toBeLessThanOrEqual(tanieres)
    expect(state.monsters.filter((m) => m.type === 'cendreux').length).toBeLessThanOrEqual(repaires)
  })
  it('chaque monstre de POI spawne sur une tuile marchable', () => {
    const map = generateAlpineTerrain(360, 540, 5) // zones POI incluses, dont repaire (ROCK/SCREE/BURNT)
    const state = createSim(5, { map })
    spawnPoiMonsters(state, 5)
    expect(state.monsters.length).toBeGreaterThan(0)
    for (const m of state.monsters) {
      const e = state.entities.find((ent) => ent.id === m.entityId)!
      const terr = terrainAt(state.map, Math.floor(e.x), Math.floor(e.y))
      expect(TERRAINS[terr]?.walkable).toBe(true)
    }
  })
  it('un repaire posé entièrement sur du rock (empreinte 3×3 impraticable) retombe sur la seule tuile marchable de l’anneau, sans bloquer le cendreux', () => {
    // Empreinte reproduisant le bug de revue : le tirage naïf dans
    // [z.x, z.x+z.w) × [z.y, z.y+z.h) ne vérifiait pas la marchabilité, or
    // rock (id 5) est walkable:false. Ici l'empreinte entière est du rock —
    // sur l'ancienne version, le cendreux atterrit TOUJOURS sur une tuile
    // bloquante, quelle que soit la seed.
    const map = createEmptyMap(10, 10, ROCK_ID)
    // Unique tuile marchable de toute la carte, dans l'anneau +1 autour de
    // l'empreinte [3,6)×[3,6) (donc hors empreinte) : (4,2).
    map.terrain[2 * map.width + 4] = GRASS_ID
    map.zones.push({ name: 'repaire test', x: 3, y: 3, w: 3, h: 3, kind: 'repaire' })
    const state = createSim(1, { map })
    spawnPoiMonsters(state, 1)
    expect(state.monsters.length).toBe(1)
    expect(state.monsters[0]!.type).toBe('cendreux')
    const e = state.entities.find((ent) => ent.id === state.monsters[0]!.entityId)!
    const terr = terrainAt(state.map, Math.floor(e.x), Math.floor(e.y))
    expect(TERRAINS[terr]?.walkable).toBe(true)
    expect([e.x, e.y]).toEqual([4.5, 2.5]) // seule candidate → tirage déterministe forcé
  })
  it('un repaire sans AUCUNE tuile marchable (empreinte + anneau tout rock) ne spawne pas de monstre', () => {
    const map = createEmptyMap(10, 10, ROCK_ID) // pas de tuile marchable du tout
    map.zones.push({ name: 'repaire test', x: 3, y: 3, w: 3, h: 3, kind: 'repaire' })
    const state = createSim(1, { map })
    spawnPoiMonsters(state, 1)
    expect(state.monsters.length).toBe(0)
  })
  it('déterministe : mêmes positions de monstres', () => {
    const m1 = generateAlpineTerrain(360, 540, 5); const s1 = createSim(5, { map: m1 }); spawnPoiMonsters(s1, 5)
    const m2 = generateAlpineTerrain(360, 540, 5); const s2 = createSim(5, { map: m2 }); spawnPoiMonsters(s2, 5)
    expect(s1.entities.map((e) => [e.x, e.y])).toEqual(s2.entities.map((e) => [e.x, e.y]))
  })
})
