import { describe, expect, it } from 'vitest'
import { isBlockingTile, terrainAt } from './map'
import {
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_WALL,
} from './balance'
import { generateValley, type ValleySkeleton } from './valleygen'
import { generateNodes } from './economy'

/** Petit squelette d'exercice — chaque primitive y est représentée. */
export const TEST_SKELETON: ValleySkeleton = {
  width: 48,
  height: 48,
  borderThickness: 3,
  ridges: [{ points: [{ x: 4, y: 20 }, { x: 20, y: 20 }], halfWidth: 1 }],
  river: { points: [{ x: 30, y: 4 }, { x: 30, y: 40 }], halfWidth: 2 },
  lake: { x: 30, y: 40, r: 4 },
  roads: [[{ x: 8, y: 30 }, { x: 40, y: 30 }]],
  crossings: [{ kind: 'bridge', x: 30, y: 30 }],
  clearings: [{ x: 10, y: 30, r: 3 }],
  ruins: [{ x: 12, y: 34 }],
  regions: [{ x: 4, y: 4, w: 40, h: 12, forest: 0.9 }],
  landmarks: [{ name: 'le Pont', x: 27, y: 27, w: 7, h: 7 }],
}

describe('generateValley — le socle', () => {
  it('est déterministe : même squelette + même seed → même carte, bit à bit', () => {
    const a = generateValley(TEST_SKELETON, 7)
    const b = generateValley(TEST_SKELETON, 7)
    expect(a.terrain).toEqual(b.terrain)
    expect(a.zones).toEqual(b.zones)
    const c = generateValley(TEST_SKELETON, 8)
    expect(c.terrain).not.toEqual(a.terrain)
  })

  it("l'enceinte est étanche : tout le bord est bloquant", () => {
    const map = generateValley(TEST_SKELETON, 7)
    for (let i = 0; i < 48; i++) {
      expect(isBlockingTile(map, i, 0)).toBe(true)
      expect(isBlockingTile(map, i, 47)).toBe(true)
      expect(isBlockingTile(map, 0, i)).toBe(true)
      expect(isBlockingTile(map, 47, i)).toBe(true)
    }
  })

  it('la région forestière est majoritairement boisée', () => {
    const map = generateValley(TEST_SKELETON, 7)
    let forest = 0
    let total = 0
    for (let ty = 8; ty < 14; ty++) {
      for (let tx = 10; tx < 28; tx++) {
        total += 1
        if (terrainAt(map, tx, ty) === TERRAIN_FOREST) forest += 1
      }
    }
    expect(forest / total).toBeGreaterThan(0.6)
  })

  it('la frontière de biome n\'est pas une couture rectangulaire droite', () => {
    // Squelette à deux régions accolées de densité forêt très différente :
    // sans warp, TOUTE la forêt tomberait exactement à gauche de x = 24.
    const skel: ValleySkeleton = {
      ...TEST_SKELETON,
      regions: [
        { x: 4, y: 4, w: 20, h: 40, forest: 0.85 }, // ouest : dense
        { x: 24, y: 4, w: 20, h: 40, forest: 0.05 }, // est : quasi nu
      ],
    }
    const map = generateValley(skel, 7)
    // À cause du warp, des tuiles de forêt débordent à l'EST de la frontière
    // x = 24 (le bord droit devient irrégulier, pas une ligne verticale).
    let forestEastOfSeam = 0
    for (let ty = 10; ty < 38; ty++) {
      for (let tx = 24; tx < 30; tx++) {
        if (terrainAt(map, tx, ty) === TERRAIN_FOREST) forestEastOfSeam += 1
      }
    }
    expect(forestEastOfSeam).toBeGreaterThan(0)
  })

  it('la crête est un mur de roche', () => {
    const map = generateValley(TEST_SKELETON, 7)
    for (let tx = 6; tx <= 18; tx++) expect(isBlockingTile(map, tx, 20)).toBe(true)
  })

  it('les zones sont copiées depuis les landmarks (pas de référence partagée)', () => {
    const map = generateValley(TEST_SKELETON, 7)
    expect(map.zones).toEqual(TEST_SKELETON.landmarks)
    expect(map.zones[0]).not.toBe(TEST_SKELETON.landmarks[0])
  })
})

describe("generateValley — rivière, routes, franchissements", () => {
  const map = generateValley(TEST_SKELETON, 7)

  it("la rivière coule : eau profonde au centre, berges en eau peu profonde", () => {
    expect(terrainAt(map, 30, 20)).toBe(TERRAIN_DEEP_WATER)
    expect(terrainAt(map, 33, 20)).toBe(TERRAIN_SHALLOW_WATER)
  })

  it("le lac est en eau, bordé de berges", () => {
    expect(terrainAt(map, 30, 40)).toBe(TERRAIN_DEEP_WATER)
  })

  it("le pont porte la route par-dessus la rivière — la traversée est continue", () => {
    expect(terrainAt(map, 30, 30)).toBe(TERRAIN_ROAD)
    for (let tx = 9; tx <= 39; tx++) {
      expect(isBlockingTile(map, tx, 30)).toBe(false)
    }
  })

  it("un gué traverse en eau peu profonde (marchable, lent)", () => {
    const ford: ValleySkeleton = {
      ...TEST_SKELETON,
      crossings: [{ kind: "ford", x: 30, y: 30 }],
    }
    const m = generateValley(ford, 7)
    expect(terrainAt(m, 30, 30)).toBe(TERRAIN_SHALLOW_WATER)
    expect(isBlockingTile(m, 30, 30)).toBe(false)
  })

  it("la route ne remplace jamais l'eau hors franchissement", () => {
    // la rivière coupe la route : sans le pont, l'eau resterait de l'eau
    const sans: ValleySkeleton = { ...TEST_SKELETON, crossings: [] }
    const m = generateValley(sans, 7)
    expect(terrainAt(m, 30, 30)).toBe(TERRAIN_DEEP_WATER)
  })

  it("la clairière est nettoyée (herbe ou route uniquement)", () => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = terrainAt(map, 10 + dx, 30 + dy)
        expect([TERRAIN_GRASS, TERRAIN_ROAD]).toContain(t)
      }
    }
  })

  it("la ruine pose des murs brisés sur sol nettoyé", () => {
    expect(terrainAt(map, 12, 34)).toBe(TERRAIN_WALL)
    expect(isBlockingTile(map, 14, 35)).toBe(false) // la brèche
  })
})

describe('stampBlob — contours organiques (Lac)', () => {
  it("le Lac n'est plus un disque parfait : sa berge ondule", () => {
    const map = generateValley(TEST_SKELETON, 7)
    const { x, y, r } = TEST_SKELETON.lake
    // On compare la frontière de l'eau du Lac (berge = rayon r+2) à un disque
    // parfait de même rayon. La colonne de la rivière (qui débouche dans le Lac)
    // est exclue pour ne mesurer que la berge. Un disque net ne produirait AUCUN
    // écart ; une berge bruitée par stampBlob en produit plusieurs.
    let flips = 0
    for (let dy = -(r + 3); dy <= r + 3; dy++) {
      for (let dx = -(r + 3); dx <= r + 3; dx++) {
        if (dx >= -3 && dx <= 3) continue
        const d2 = dx * dx + dy * dy
        const t = terrainAt(map, x + dx, y + dy)
        const wet = t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER
        const perfect = d2 <= (r + 2) * (r + 2)
        if (wet !== perfect) flips++
      }
    }
    expect(flips).toBeGreaterThan(3)
  })
})

describe('roche en amas (dé-confettisage)', () => {
  it('la roche de biome forme des blocs, pas des tuiles isolées', () => {
    // Squelette d'exercice : une seule grande région rocheuse, pas d'eau/route.
    const rocky: ValleySkeleton = {
      ...TEST_SKELETON,
      ridges: [], river: { points: [{ x: 2, y: 2 }, { x: 2, y: 3 }], halfWidth: 0 },
      lake: { x: 2, y: 2, r: 0 }, roads: [], crossings: [], clearings: [], ruins: [],
      regions: [{ x: 6, y: 6, w: 36, h: 36, rock: 0.25 }],
    }
    const map = generateValley(rocky, 3)
    const isRock = (tx: number, ty: number): boolean => terrainAt(map, tx, ty) === TERRAIN_ROCK
    let rockTiles = 0
    let isolated = 0
    for (let ty = 8; ty < 40; ty++) {
      for (let tx = 8; tx < 40; tx++) {
        if (!isRock(tx, ty)) continue
        rockTiles++
        const neighbours = (isRock(tx + 1, ty) ? 1 : 0) + (isRock(tx - 1, ty) ? 1 : 0)
          + (isRock(tx, ty + 1) ? 1 : 0) + (isRock(tx, ty - 1) ? 1 : 0)
        if (neighbours === 0) isolated++
      }
    }
    expect(rockTiles).toBeGreaterThan(20) // la région est bien rocheuse
    // En amas : la vaste majorité des tuiles de roche touchent une autre roche.
    expect(isolated / rockTiles).toBeLessThan(0.25)
  })
})

describe('réseau d’eau', () => {
  // Squelette avec de la place, une rivière et des densités d'eau explicites.
  const watery: ValleySkeleton = {
    ...TEST_SKELETON,
    regions: [{ x: 6, y: 6, w: 36, h: 20, rock: 0.2 }],
    water: { streamDensity: 0.004, pondDensity: 0.002 },
  }

  /**
   * Repousse la rivière ET le lac hors-carte (coordonnées négatives) : tous
   * les tampons de paintRiver (paintPolyline/stampBlob) rejettent chaque
   * tuile candidate via leur garde de bornes, donc AUCUNE eau ne vient de la
   * rivière/du lac — contrairement à un simple `halfWidth/r: 0` sur un point
   * dans la carte, qui laisse toujours un résidu (le lac tamponne un rayon
   * `r + 2`, jamais nul). Toute eau peu profonde observée dans les tests
   * ci-dessous vient donc forcément de paintStreams/paintPonds : un no-op des
   * deux ferait tomber ces tests à zéro (voir preuve de gate dans le rapport).
   */
  const riverless = (
    w: number, h: number, water: { streamDensity?: number; pondDensity?: number },
  ): ValleySkeleton => ({
    width: w,
    height: h,
    borderThickness: 3,
    ridges: [],
    river: { points: [{ x: -60, y: -60 }, { x: -60, y: -59 }], halfWidth: 0 },
    lake: { x: -60, y: -60, r: 0 },
    roads: [],
    crossings: [],
    clearings: [],
    ruins: [],
    regions: [{ x: 6, y: 6, w: w - 12, h: h - 12 }],
    landmarks: [],
    water,
  })

  function countShallow(map: { terrain: number[] }): number {
    let n = 0
    for (const t of map.terrain) if (t === TERRAIN_SHALLOW_WATER) n++
    return n
  }

  it("le réseau procédural peint bien de l'eau sans aucune rivière/lac — la passe n'est pas un no-op", () => {
    const map = generateValley(riverless(96, 96, { streamDensity: 0.004, pondDensity: 0.006 }), 11)
    expect(countShallow(map)).toBeGreaterThan(0)
  })

  it('scalabilité (R6) : plus de tuiles d’eau procédurale sur une plus grande surface, mêmes densités', () => {
    const water = { streamDensity: 0.004, pondDensity: 0.006 }
    const small = generateValley(riverless(96, 96, water), 11)
    const big = generateValley(riverless(192, 192, water), 11)
    const smallCount = countShallow(small)
    const bigCount = countShallow(big)
    expect(smallCount).toBeGreaterThan(0)
    expect(bigCount).toBeGreaterThan(smallCount)
    // Surface ×4 (192² vs 96²) → on attend une croissance du même ordre ;
    // tolérance large pour ne pas être fragile au bruit de placement.
    expect(bigCount).toBeGreaterThan(smallCount * 1.5)
  })

  it('les étangs ne percent ni la bordure ni les clairières', () => {
    const withClearing: ValleySkeleton = {
      ...TEST_SKELETON,
      // Rivière/lac neutralisés hors de la zone testée : la SEULE eau profonde
      // possible dans [18,30]² serait alors le cœur d'un étang — le test gate
      // réellement sur le garde-fou de paintPonds, pas sur la rivière.
      river: { points: [{ x: 2, y: 2 }, { x: 2, y: 3 }], halfWidth: 0 },
      lake: { x: 2, y: 2, r: 0 },
      crossings: [],
      regions: [{ x: 6, y: 6, w: 36, h: 36 }],
      clearings: [{ x: 24, y: 24, r: 6 }],
      water: { streamDensity: 0, pondDensity: 0.02 },
    }
    const map = generateValley(withClearing, 4)
    // anneau externe bloquant
    for (let i = 0; i < map.width; i++) {
      expect(isBlockingTile(map, i, 0)).toBe(true)
      expect(isBlockingTile(map, i, map.height - 1)).toBe(true)
    }
    // pas d'eau profonde dans la clairière
    for (let ty = 18; ty <= 30; ty++)
      for (let tx = 18; tx <= 30; tx++)
        expect(terrainAt(map, tx, ty)).not.toBe(TERRAIN_DEEP_WATER)
  })

  it('déterministe', () => {
    expect(generateValley(watery, 11).terrain).toEqual(generateValley(watery, 11).terrain)
  })
})

describe('mines dans la bordure', () => {
  const mined: ValleySkeleton = {
    ...TEST_SKELETON,
    mines: {
      deep: [{ x: 30, y: 10, toward: 'top' }],
      simpleDensity: 2,
    },
  }

  it('la chambre profonde est un gisement, creusée et atteignable', () => {
    const map = generateValley(mined, 9)
    const gisement = map.zones.find((z) => z.kind === 'gisement')
    expect(gisement).toBeDefined()
    // Au moins une tuile marchable dans la chambre (creusée dans la roche).
    let walkable = 0
    for (let ty = gisement!.y; ty < gisement!.y + gisement!.h; ty++) {
      for (let tx = gisement!.x; tx < gisement!.x + gisement!.w; tx++) {
        if (!isBlockingTile(map, tx, ty)) walkable++
      }
    }
    expect(walkable).toBeGreaterThan(0)
  })

  it('les mines simples sont des carrières (kind carriere)', () => {
    const map = generateValley(mined, 9)
    expect(map.zones.some((z) => z.kind === 'carriere')).toBe(true)
  })

  it('déterministe', () => {
    expect(generateValley(mined, 9).zones).toEqual(generateValley(mined, 9).zones)
  })
})

describe('enceinte organique', () => {
  const map = generateValley(TEST_SKELETON, 7)

  it('le tout dernier anneau reste bloquant (on ne sort pas de la carte)', () => {
    const w = map.width, h = map.height
    for (let i = 0; i < w; i++) {
      expect(isBlockingTile(map, i, 0)).toBe(true)
      expect(isBlockingTile(map, i, h - 1)).toBe(true)
    }
    for (let j = 0; j < h; j++) {
      expect(isBlockingTile(map, 0, j)).toBe(true)
      expect(isBlockingTile(map, w - 1, j)).toBe(true)
    }
  })

  it("l'épaisseur de l'enceinte varie (bords non rectilignes)", () => {
    // Profondeur de roche depuis le bord haut, échantillonnée sur plusieurs colonnes.
    const depths: number[] = []
    for (let tx = 5; tx < map.width - 5; tx += 3) {
      let d = 0
      while (d < map.height && isBlockingTile(map, tx, d)) d++
      depths.push(d)
    }
    const mean = depths.reduce((a, b) => a + b, 0) / depths.length
    const variance = depths.reduce((a, b) => a + (b - mean) * (b - mean), 0) / depths.length
    expect(variance).toBeGreaterThan(1) // pas une bande d'épaisseur constante
  })
})

describe('R6 — scalabilité : les features suivent la taille de la carte', () => {
  // Deux tailles, mêmes densités. Un doublement de côté ≈ ×4 surface.
  const base = (w: number, h: number): ValleySkeleton => ({
    width: w, height: h, borderThickness: 4, ridges: [],
    river: { points: [{ x: (w / 2) | 0, y: 4 }, { x: (w / 2) | 0, y: h - 4 }], halfWidth: 2 },
    lake: { x: (w / 2) | 0, y: h - 8, r: 5 }, roads: [], crossings: [], clearings: [], ruins: [],
    regions: [{ x: 6, y: 6, w: w - 12, h: h - 12, forest: 0.2, rock: 0.15 }],
    water: { streamDensity: 0.003, pondDensity: 0.003 },
    mines: { deep: [], simpleDensity: 0.4 },
    landmarks: [],
  })

  function shallowCount(map: { terrain: number[] }): number {
    let n = 0
    for (const t of map.terrain) if (t === TERRAIN_SHALLOW_WATER) n++
    return n
  }

  it('plus de carrières sur un plus grand périmètre', () => {
    const small = generateValley(base(96, 96), 1)
    const big = generateValley(base(192, 192), 1)
    const carr = (m: typeof small): number => m.zones.filter((z) => z.kind === 'carriere').length
    // Périmètre ×2 → ~×2 carrières. On exige strictement plus, pas l'égalité.
    expect(carr(big)).toBeGreaterThan(carr(small))
  })

  it("plus d'eau procédurale et plus de nœuds sur une plus grande surface", () => {
    const small = generateValley(base(96, 96), 2)
    const big = generateValley(base(192, 192), 2)
    expect(shallowCount(big)).toBeGreaterThan(shallowCount(small))
    expect(generateNodes(big, 2).length).toBeGreaterThan(generateNodes(small, 2).length)
  })

  it("aucune quantité figée : la petite carte n'est pas vide", () => {
    const small = generateValley(base(96, 96), 3)
    expect(small.zones.some((z) => z.kind === 'carriere')).toBe(true)
    expect(shallowCount(small)).toBeGreaterThan(0)
  })
})
