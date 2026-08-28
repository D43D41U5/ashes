import { describe, it, expect } from 'vitest'
import {
  FAUNA,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_SHALLOW_WATER,
  WOOD_TERRAINS,
  createEmptyMap,
  terrainAt,
  type WorldMap,
} from '@ashes/sim'
import { tracesDuCoin, tracesDuMonde } from './traces'

/**
 * A38 (faune R24) — les traces se DÉRIVENT des données du coin : déterministes,
 * dans le canton, sur la structure réelle (coulée, gagnage, lisière du massif).
 */

const GROUND = { x: 60.5, y: 40.5 }

function carte(): WorldMap {
  const map = createEmptyMap(120, 80, TERRAIN_GRASS)
  // Un massif au nord-est du coin, de l'eau à l'ouest.
  for (let ty = 20; ty < 33; ty++) {
    for (let tx = 80; tx < 93; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  }
  for (let ty = 0; ty < 80; ty++) {
    for (let tx = 30; tx < 33; tx++) map.terrain[ty * map.width + tx] = TERRAIN_SHALLOW_WATER
  }
  // Une coulée : une descente droite du gagnage vers l'eau, finie à la rive.
  const chemin: number[] = []
  for (let tx = 55; tx >= 34; tx--) chemin.push(40 * map.width + tx)
  map.coulees = [...chemin, -1]
  return map
}

describe('les traces du coin (A38)', () => {
  it('déterministes : deux appels rendent exactement la même chose', () => {
    const map = carte()
    const a = tracesDuCoin(map, GROUND, 2026)
    const b = tracesDuCoin(map, GROUND, 2026)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('chaque sorte est posée sur SA structure — coulée, gagnage ouvert, lisière du bois', () => {
    const map = carte()
    const traces = tracesDuCoin(map, GROUND, 2026)
    const empreintes = traces.filter((t) => t.sorte === 'empreinte')
    const fumees = traces.filter((t) => t.sorte === 'fumees')
    const frottis = traces.filter((t) => t.sorte === 'frottis')
    expect(empreintes.length).toBeGreaterThan(3)
    expect(fumees.length).toBeGreaterThan(0)
    expect(frottis.length).toBeGreaterThan(0)

    const surCoulee = new Set(map.coulees!.filter((i) => i >= 0))
    for (const t of empreintes) {
      // Sur le chemin, au jet de côté près — et un CAP (le sens de la descente).
      expect(surCoulee.has(Math.floor(t.y) * map.width + Math.floor(t.x))).toBe(true)
      expect(t.cap).toBeDefined()
    }
    for (const t of fumees) {
      const terrain = terrainAt(map, Math.floor(t.x), Math.floor(t.y))
      expect(WOOD_TERRAINS.includes(terrain), 'les fumées sont au gagnage, pas sous les arbres').toBe(false)
    }
    for (const t of frottis) {
      const tx = Math.floor(t.x)
      const ty = Math.floor(t.y)
      expect(WOOD_TERRAINS.includes(terrainAt(map, tx, ty)), 'un frottis est SUR un arbre').toBe(true)
      const bord =
        !WOOD_TERRAINS.includes(terrainAt(map, tx - 1, ty)) ||
        !WOOD_TERRAINS.includes(terrainAt(map, tx + 1, ty)) ||
        !WOOD_TERRAINS.includes(terrainAt(map, tx, ty - 1)) ||
        !WOOD_TERRAINS.includes(terrainAt(map, tx, ty + 1))
      expect(bord, 'un frottis est en LISIÈRE, pas au cœur du bois').toBe(true)
    }
  })

  it('tout reste dans le canton, et un monde sans coin n’a aucune trace', () => {
    const map = carte()
    const traces = tracesDuMonde(map, [GROUND], 2026)
    const marge = FAUNA.GROUND_COVER_NEAR + 2
    for (const t of traces) {
      expect(Math.abs(t.x - GROUND.x)).toBeLessThanOrEqual(marge)
      expect(Math.abs(t.y - GROUND.y)).toBeLessThanOrEqual(marge)
    }
    expect(tracesDuMonde(map, [], 2026)).toHaveLength(0)
  })

  it('un coin sans coulée à portée n’a pas d’empreintes — la trace ne ment jamais', () => {
    const map = carte()
    delete map.coulees
    const traces = tracesDuCoin(map, GROUND, 2026)
    expect(traces.filter((t) => t.sorte === 'empreinte')).toHaveLength(0)
    expect(traces.length, 'fumées et frottis restent').toBeGreaterThan(0)
  })
})
