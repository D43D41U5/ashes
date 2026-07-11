/**
 * La carte — grille de terrains + zones nommées (spec monde R5-R8).
 *
 * Le déplacement est continu (positions en flottants) ; la grille ne décrit
 * que le décor. La tuile est l'unité de distance de /sim — le rendu en pixels
 * est une affaire de /client.
 */
import { TERRAINS } from './balance'

/** Rectangle nommé — landmark de chronique, future zone interdite, futur room. */
export interface Zone {
  name: string
  x: number
  y: number
  w: number
  h: number
  /** Rôle mécanique optionnel (ex. 'gisement' : accueille le T2 — spec économie R3). */
  kind?: string
}

export interface WorldMap {
  width: number
  height: number
  /** Id de terrain par tuile, row-major (index = y * width + x). */
  terrain: number[]
  zones: Zone[]
  /** Altitude par tuile [0,1] (substrat alpin). Optionnel — absent sur les
   *  cartes qui n'en produisent pas. NE PAS confondre avec `height` (dimension). */
  elevation?: number[]
}

export function createEmptyMap(width: number, height: number, fillTerrainId: number): WorldMap {
  return {
    width,
    height,
    terrain: new Array<number>(width * height).fill(fillTerrainId),
    zones: [],
  }
}

/** Id de terrain à une tuile. Hors carte = void (0). */
export function terrainAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.terrain[ty * map.width + tx] ?? 0
}

/** Altitude à une tuile [0,1]. Hors carte ou absent = 0. */
export function elevationAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.elevation?.[ty * map.width + tx] ?? 0
}

/** Une tuile bloque-t-elle le déplacement ? Hors carte et terrain inconnu bloquent. */
export function isBlockingTile(map: WorldMap, tx: number, ty: number): boolean {
  const def = TERRAINS[terrainAt(map, tx, ty)]
  return def === undefined || !def.walkable
}

/** Première zone nommée contenant le point (x, y), ou undefined. */
export function zoneAt(map: WorldMap, x: number, y: number): Zone | undefined {
  return map.zones.find((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h)
}

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
