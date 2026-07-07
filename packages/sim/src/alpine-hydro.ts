/**
 * L'hydrologie alpine (SP1b) — l'eau DÉCOULE du relief : un lac au point le plus
 * bas, une rivière tracée en descente le long du thalweg, des ruisseaux depuis
 * des sources de pente, et des tarns dans les cuvettes hautes. Le tracé se fait
 * sur le CHAMP D'ÉCOULEMENT (macro lisse, computeFlowField) pour ne pas se piéger
 * dans les micro-pits du relief fin ; les tarns, eux, épousent les vraies
 * cuvettes de l'élévation détaillée. Pur et déterministe (hash2, arithmétique
 * autorisée, pas de trigo). Réutilise stampBlob/paintPolyline.
 */
import { TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from './balance'
import { elevationAt, type WorldMap } from './map'
import { hash2 } from './noise'
import { isWater, type Paint, paintPolyline, stampBlob, type ValleyPoint } from './valleygen-primitives'

const paintShallow: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? undefined : TERRAIN_SHALLOW_WATER)
const paintDeep: Paint = () => TERRAIN_DEEP_WATER

/** Constantes d'hydrologie — contenu de carte, réglées à la vignette. */
export const HYDRO = {
  LAKE_R_FRAC: 0.055,     // rayon du lac (fraction de min(W,H))
  RIVER_HALFWIDTH: 3,     // demi-largeur du cœur profond de la rivière (bien lisible)
  STREAM_DENSITY: 0.00028,// sources de ruisseau par tuile intérieure (désencombré)
  STREAM_SOURCE_FRAC: 0.5,// altitude d'écoulement min d'une source de ruisseau
  TARN_DENSITY: 0.00008,  // tarns par tuile intérieure
  TARN_MIN_FRAC: 0.4,     // altitude min d'un tarn (au-dessus du fond)
  TARN_MAX_FRAC: 0.68,    // altitude max d'un tarn (sous l'éboulis/roche)
  TARN_R_FRAC: 0.014,     // rayon d'un tarn
}

const at = (field: number[], W: number, x: number, y: number): number => field[y * W + x]!

/** La tuile intérieure au plus bas écoulement (loin du bord) — le bassin du lac. */
function lowestInterior(flow: number[], W: number, H: number, margin: number): ValleyPoint {
  let bx = margin, by = margin, be = 2
  for (let y = margin; y < H - margin; y++) {
    for (let x = margin; x < W - margin; x++) {
      const e = at(flow, W, x, y)
      if (e < be) { be = e; bx = x; by = y }
    }
  }
  return { x: bx, y: by }
}

/**
 * Descente (steepest-descent D8) sur le champ d'écoulement `flow` : à chaque pas,
 * va au voisin strictement le plus bas ; s'arrête sur une tuile d'eau du terrain,
 * un minimum local, ou après maxSteps. Départage déterministe par hash2.
 */
function traceDownhill(map: WorldMap, flow: number[], sx: number, sy: number, maxSteps: number, seed: number): ValleyPoint[] {
  const W = map.width
  const H = map.height
  const pts: ValleyPoint[] = [{ x: sx, y: sy }]
  let x = sx
  let y = sy
  for (let step = 0; step < maxSteps; step++) {
    let bestX = -1
    let bestY = -1
    let bestE = at(flow, W, x, y)
    let bestTie = -1
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const e = at(flow, W, nx, ny)
        const tie = hash2(nx, ny, seed)
        if (e < bestE || (e === bestE && bestX >= 0 && tie > bestTie)) {
          bestE = e
          bestX = nx
          bestY = ny
          bestTie = tie
        }
      }
    }
    if (bestX < 0) break // minimum local (cuvette)
    x = bestX
    y = bestY
    pts.push({ x, y })
    if (isWater(map.terrain[y * W + x] ?? 0)) break // atteint l'eau existante
  }
  return pts
}

/** Le lac au point d'écoulement le plus bas : cœur profond, berges bruitées. */
function carveLake(map: WorldMap, flow: number[], seed: number): void {
  const D = Math.min(map.width, map.height)
  const margin = Math.max(3, Math.round(D * 0.05))
  const c = lowestInterior(flow, map.width, map.height, margin)
  const r = Math.max(4, Math.round(D * HYDRO.LAKE_R_FRAC))
  stampBlob(map, c.x, c.y, r + 2, paintShallow, (seed ^ 0x1ac1) | 0, 0.22)
  stampBlob(map, c.x, c.y, r, paintDeep, (seed ^ 0x1ac1) | 0, 0.22)
}

/** La rivière : d'une source haute au lac, en suivant l'écoulement. Cœur profond + berges. */
function carveRiver(map: WorldMap, flow: number[], seed: number): void {
  const D = Math.min(map.width, map.height)
  const margin = Math.max(3, Math.round(D * 0.06))
  // Source : le point d'écoulement le PLUS HAUT parmi des candidats intérieurs
  // (mais pas le pic scellé) — la rivière descend de là jusqu'au lac.
  let sx = margin
  let sy = margin
  let se = -1
  for (let s = 0; s < 96; s++) {
    const x = margin + Math.floor(hash2(s * 91 + 1, seed, 0x5c1) * (map.width - 2 * margin))
    const y = margin + Math.floor(hash2(seed, s * 91 + 1, 0x9d3) * (map.height - 2 * margin))
    const e = at(flow, map.width, x, y)
    if (e > se && e < 0.9) { se = e; sx = x; sy = y }
  }
  const path = traceDownhill(map, flow, sx, sy, map.width + map.height, (seed ^ 0x71fe) | 0)
  if (path.length < 4) return
  const hw = HYDRO.RIVER_HALFWIDTH
  paintPolyline(map, path, hw + 1, paintShallow)
  paintPolyline(map, path, hw, paintDeep)
}

/** Ruisseaux : des sources de pente dévalent vers l'eau (peu profond, franchissable). */
function carveStreams(map: WorldMap, flow: number[], seed: number): void {
  const D = Math.min(map.width, map.height)
  const margin = Math.max(3, Math.round(D * 0.05))
  const interior = (map.width - 2 * margin) * (map.height - 2 * margin)
  const count = Math.round(HYDRO.STREAM_DENSITY * interior)
  for (let k = 0; k < count; k++) {
    // meilleure source parmi quelques candidats hauts (en écoulement)
    let sx = margin
    let sy = margin
    let se = -1
    for (let s = 0; s < 8; s++) {
      const x = margin + Math.floor(hash2(k * 131 + s, seed, 0x2b7) * (map.width - 2 * margin))
      const y = margin + Math.floor(hash2(seed, k * 131 + s, 0x4e9) * (map.height - 2 * margin))
      const e = at(flow, map.width, x, y)
      if (e > se) { se = e; sx = x; sy = y }
    }
    if (se < HYDRO.STREAM_SOURCE_FRAC || se >= 0.9) continue
    const path = traceDownhill(map, flow, sx, sy, map.width, (seed ^ (k * 0x2777)) | 0)
    if (path.length < 3) continue
    paintPolyline(map, path, 0, paintShallow) // filet franchissable, jamais de cœur profond
  }
}

/** Tarns : petites cuvettes d'altitude (minima locaux du relief RÉEL) → poches d'eau. */
function carveTarns(map: WorldMap, seed: number): void {
  const D = Math.min(map.width, map.height)
  const margin = Math.max(4, Math.round(D * 0.06))
  const interior = (map.width - 2 * margin) * (map.height - 2 * margin)
  const count = Math.round(HYDRO.TARN_DENSITY * interior)
  const r = Math.max(2, Math.round(D * HYDRO.TARN_R_FRAC))
  let placed = 0
  for (let k = 0; k < count * 16 && placed < count; k++) {
    const x = margin + Math.floor(hash2(k * 977 + 3, seed, 0x3f1) * (map.width - 2 * margin))
    const y = margin + Math.floor(hash2(seed, k * 977 + 3, 0x7c5) * (map.height - 2 * margin))
    const e = elevationAt(map, x, y)
    if (e < HYDRO.TARN_MIN_FRAC || e > HYDRO.TARN_MAX_FRAC) continue
    if (isWater(map.terrain[y * map.width + x] ?? 0)) continue
    // cuvette : plus bas que ses voisins à 2 tuiles (relief détaillé)
    let isBasin = true
    for (let dy = -2; dy <= 2 && isBasin; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        if (dx === 0 && dy === 0) continue
        if (elevationAt(map, x + dx, y + dy) < e) { isBasin = false; break }
      }
    }
    if (!isBasin) continue
    stampBlob(map, x, y, r + 1, paintShallow, (seed ^ (k * 53)) | 0, 0.3)
    stampBlob(map, x, y, r, paintDeep, (seed ^ (k * 53)) | 0, 0.3)
    placed += 1
  }
}

/** Grave tout le réseau d'eau dans une carte alpine (après les bandes de terrain).
 *  `flow` = computeFlowField (macro lisse) pour lac/rivière/ruisseaux. */
export function carveHydrology(map: WorldMap, flow: number[], seed: number): void {
  carveLake(map, flow, seed)
  carveRiver(map, flow, seed)
  carveStreams(map, flow, seed)
  carveTarns(map, seed)
}
