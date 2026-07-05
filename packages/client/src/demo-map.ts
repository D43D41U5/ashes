/**
 * Vallée de démo V2 — carte procédurale déterministe, en attendant les
 * vraies cartes Tiled (le squelette artisanal arrive avec le contenu).
 * Rivière, pont, route, forêts, affleurements rocheux, deux zones nommées.
 */
import { createEmptyMap, type WorldMap } from '@braises/sim'

export const DEMO_MAP_SIZE = 64
export const PLAYER_SPAWN = { x: 10.5, y: 32.5 }

const GRASS = 1
const ROAD = 2
const FOREST = 3
const SHALLOW = 4
const ROCK = 5
const DEEP_WATER = 6

/** Hash 2D → [0, 1), déterministe (même recette que le PRNG de /sim). */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function createDemoMap(): WorldMap {
  const size = DEMO_MAP_SIZE
  const map = createEmptyMap(size, size, GRASS)
  const set = (x: number, y: number, id: number) => {
    map.terrain[y * size + x] = id
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = hash2(x, y)
      if (r < 0.14) set(x, y, FOREST)
      else if (r < 0.18) set(x, y, ROCK)
    }
  }

  // La rivière (nord-sud) et ses berges.
  for (let y = 0; y < size; y++) {
    const meander = Math.floor(3 * hash2(0, Math.floor(y / 8)))
    const rx = 40 + meander
    set(rx - 1, y, SHALLOW)
    set(rx, y, DEEP_WATER)
    set(rx + 1, y, DEEP_WATER)
    set(rx + 2, y, SHALLOW)
  }

  // La route (est-ouest) et le pont qui enjambe la rivière.
  for (let x = 1; x < size - 1; x++) {
    set(x, 32, ROAD)
    set(x, 33, ROAD)
  }

  // L'enceinte de la vallée.
  for (let i = 0; i < size; i++) {
    set(i, 0, ROCK)
    set(i, size - 1, ROCK)
    set(0, i, ROCK)
    set(size - 1, i, ROCK)
  }

  // Une clairière sûre autour du spawn.
  for (let y = 29; y <= 36; y++) {
    for (let x = 7; x <= 14; x++) {
      if (map.terrain[y * size + x] !== ROAD) set(x, y, GRASS)
    }
  }

  map.zones = [
    { name: 'le Pont', x: 38, y: 30, w: 7, h: 6 },
    { name: 'la Clairière', x: 7, y: 29, w: 8, h: 8 },
    // Le gisement T2, de l'autre côté de la rivière : y aller coûte (spec économie R3).
    { name: 'la Mine du Levant', kind: 'gisement', x: 48, y: 10, w: 12, h: 10 },
  ]
  return map
}
