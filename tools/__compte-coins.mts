import { MONDE_JOUE, terrainAt,
  TERRAIN_GRASS, TERRAIN_FLOWER_MEADOW, TERRAIN_ALPINE_MEADOW, TERRAIN_ALPINE_FLOWERS,
  TERRAIN_HEATH, TERRAIN_WET_MEADOW, TERRAIN_JUNIPER_HEATH } from '../packages/sim/src/index'
import { placeHuntingGrounds } from '../packages/sim/src/faune'
import { carteDeTest } from './carte-cache'
const OPEN = [TERRAIN_GRASS, TERRAIN_FLOWER_MEADOW, TERRAIN_ALPINE_MEADOW, TERRAIN_ALPINE_FLOWERS, TERRAIN_HEATH, TERRAIN_WET_MEADOW, TERRAIN_JUNIPER_HEATH]
const seed = Number(process.argv[2] ?? 7)
console.error('① imports ok, rss=', Math.round(process.memoryUsage().rss / 1e6), 'MB')
const map = carteDeTest(seed, undefined, MONDE_JOUE).map
console.error('② carte ok', map.width, 'x', map.height, 'rss=', Math.round(process.memoryUsage().rss / 1e6), 'MB')
const grounds = placeHuntingGrounds(map, seed)
console.error('③ grounds ok, rss=', Math.round(process.memoryUsage().rss / 1e6), 'MB')
let open = 0
for (const g of grounds) if (OPEN.includes(terrainAt(map, Math.floor(g.x), Math.floor(g.y)))) open++
console.log(`seed ${seed}: carte ${map.width}x${map.height}, ${grounds.length} coins — ${open} clairières, ${grounds.length - open} souilles`)
