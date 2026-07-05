/**
 * Importeur Tiled → WorldMap (spec monde R7-R8).
 *
 * Tiled est l'outil, jamais le format runtime. Convention de mapping :
 * l'index local d'une tuile dans le tileset (gid - firstgid) EST l'id de
 * terrain (voir TERRAINS dans balance.ts) — le tileset de travail doit donc
 * ranger ses tuiles dans l'ordre de la table. gid 0 (vide) = void.
 *
 * Couches reconnues : `terrain` (calque de tuiles, requis), `obstacles`
 * (calque de tuiles, une tuile non vide prime sur le terrain), `zones`
 * (calque d'objets rectangulaires nommés, en pixels → convertis en tuiles).
 * Toute autre couche est ignorée avec un avertissement — jamais d'erreur
 * silencieuse.
 */
import type { WorldMap, Zone } from './map'

interface TiledTileLayer {
  type: 'tilelayer'
  name: string
  width: number
  height: number
  data: number[]
}

interface TiledObject {
  name: string
  x: number
  y: number
  width: number
  height: number
}

interface TiledObjectLayer {
  type: 'objectgroup'
  name: string
  objects: TiledObject[]
}

export interface TiledMapFile {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  layers: (TiledTileLayer | TiledObjectLayer | { type: string; name: string })[]
  tilesets?: { firstgid: number }[]
}

export interface TiledImportResult {
  map: WorldMap
  warnings: string[]
}

export function importTiledMap(file: TiledMapFile): TiledImportResult {
  const warnings: string[] = []
  const firstgid = file.tilesets?.[0]?.firstgid ?? 1
  if ((file.tilesets?.length ?? 0) > 1) {
    warnings.push('plusieurs tilesets : seul le premier est utilisé pour le mapping des terrains')
  }

  let terrainLayer: TiledTileLayer | undefined
  let obstaclesLayer: TiledTileLayer | undefined
  let zonesLayer: TiledObjectLayer | undefined

  for (const layer of file.layers) {
    if (layer.type === 'tilelayer' && layer.name === 'terrain') {
      terrainLayer = layer as TiledTileLayer
    } else if (layer.type === 'tilelayer' && layer.name === 'obstacles') {
      obstaclesLayer = layer as TiledTileLayer
    } else if (layer.type === 'objectgroup' && layer.name === 'zones') {
      zonesLayer = layer as TiledObjectLayer
    } else {
      warnings.push(`couche ignorée : « ${layer.name} » (type ${layer.type})`)
    }
  }

  if (!terrainLayer) {
    throw new Error('carte Tiled invalide : couche de tuiles « terrain » absente')
  }
  if (terrainLayer.width !== file.width || terrainLayer.height !== file.height) {
    throw new Error('carte Tiled invalide : dimensions de la couche terrain ≠ dimensions de la carte')
  }

  const toTerrainId = (gid: number): number => (gid === 0 ? 0 : gid - firstgid)
  const terrain = terrainLayer.data.map(toTerrainId)

  if (obstaclesLayer) {
    for (let i = 0; i < terrain.length; i++) {
      const gid = obstaclesLayer.data[i] ?? 0
      if (gid !== 0) terrain[i] = toTerrainId(gid)
    }
  }

  const zones: Zone[] = (zonesLayer?.objects ?? []).map((o) => ({
    name: o.name,
    x: o.x / file.tilewidth,
    y: o.y / file.tileheight,
    w: o.width / file.tilewidth,
    h: o.height / file.tileheight,
  }))

  return {
    map: { width: file.width, height: file.height, terrain, zones },
    warnings,
  }
}
