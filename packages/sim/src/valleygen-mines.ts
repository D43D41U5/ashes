/**
 * Les mines en galeries (design 2026-07-06, volet C). Une mine = un couloir de
 * sol marchable qui mord dans la bordure rocheuse, terminé par une chambre ;
 * les filons y seront posés par generateNodes via le `kind` de la chambre.
 * Les profondes (gisement fer+charbon) sont artisanales ; les simples
 * (carrière/pierre) sont procédurales par densité de périmètre (scalable).
 */
import { TERRAIN_GRASS } from './balance'
import type { WorldMap, Zone } from './map'
import { hash2 } from './noise'
import { paintPolyline, stampBlob, type ValleySkeleton } from './valleygen'

type Dir = 'top' | 'bottom' | 'left' | 'right'

const paintFloor = (): number => TERRAIN_GRASS // creuse : sol marchable dans la roche

/** Vecteur intérieur d'une bordure (vers le centre de la carte). */
function inward(dir: Dir): { dx: number; dy: number } {
  if (dir === 'top') return { dx: 0, dy: 1 }
  if (dir === 'bottom') return { dx: 0, dy: -1 }
  if (dir === 'left') return { dx: 1, dy: 0 }
  return { dx: -1, dy: 0 }
}

/**
 * Creuse une galerie depuis la bouche (près de la bordure) vers l'intérieur,
 * finissant par une chambre. Retourne la zone nommée de la chambre.
 */
function carveGallery(
  map: WorldMap, x: number, y: number, dir: Dir, length: number, chamberR: number,
  name: string, kind: 'gisement' | 'carriere', seed: number, branch: boolean,
): Zone {
  const { dx, dy } = inward(dir)
  const ex = x + dx * length
  const ey = y + dy * length
  // Le couloir (sol marchable percé dans la roche).
  paintPolyline(map, [{ x, y }, { x: ex, y: ey }], 1, paintFloor)
  if (branch) {
    // Une ramification perpendiculaire à mi-galerie (mine « complexe »).
    const mx = x + dx * ((length / 2) | 0)
    const my = y + dy * ((length / 2) | 0)
    const bl = (chamberR + 2)
    paintPolyline(map, [{ x: mx, y: my }, { x: mx + dy * bl, y: my + dx * bl }], 1, paintFloor)
  }
  // La chambre au fond.
  stampBlob(map, ex, ey, chamberR, paintFloor, (seed ^ 0x6d1e) | 0, 0.3)
  return {
    name, kind,
    x: ex - chamberR - 1, y: ey - chamberR - 1,
    w: chamberR * 2 + 3, h: chamberR * 2 + 3,
  }
}

/**
 * Creuse toutes les mines et retourne leurs zones de chambre. Les profondes
 * (artisanales) sont longues, ramifiées et riches ; les simples (procédurales
 * par densité de périmètre) sont courtes et ne donnent que de la pierre.
 */
export function carveMines(map: WorldMap, skeleton: ValleySkeleton, seed: number): Zone[] {
  const zones: Zone[] = []
  const spec = skeleton.mines
  if (!spec) return zones

  let n = 0
  for (const d of spec.deep) {
    zones.push(carveGallery(map, d.x, d.y, d.toward, 14, 3, `la Mine profonde ${n + 1}`, 'gisement', (seed ^ (n * 7)) | 0, true))
    n++
  }

  const density = spec.simpleDensity ?? 0
  if (density > 0) {
    const perimeter = 2 * (map.width + map.height)
    // scalable : densité = mines par 100 tuiles de périmètre
    const count = Math.round((density * perimeter) / 100)
    for (let k = 0; k < count; k++) {
      // Position seedée sur l'un des quatre bords.
      const side = Math.floor(hash2(k * 53, seed, 0x88) * 4)
      const dir: Dir = side === 0 ? 'top' : side === 1 ? 'bottom' : side === 2 ? 'left' : 'right'
      const along = 8 + Math.floor(hash2(seed, k * 53, 0x91) * (Math.max(map.width, map.height) - 16))
      const mouth = mouthOnSide(map, dir, along, skeleton.borderThickness + 1)
      zones.push(carveGallery(map, mouth.x, mouth.y, dir, 6, 2, `la Carrière ${k + 1}`, 'carriere', (seed ^ (k * 17)) | 0, false))
    }
  }
  return zones
}

/** Point de bouche sur un bord donné, à `depth` tuiles du bord. */
function mouthOnSide(map: WorldMap, dir: Dir, along: number, depth: number): { x: number; y: number } {
  if (dir === 'top') return { x: Math.min(map.width - 2, along), y: depth }
  if (dir === 'bottom') return { x: Math.min(map.width - 2, along), y: map.height - 1 - depth }
  if (dir === 'left') return { x: depth, y: Math.min(map.height - 2, along) }
  return { x: map.width - 1 - depth, y: Math.min(map.height - 2, along) }
}
