/**
 * L'hydrologie alpine (SP1b) — l'eau DÉCOULE du relief par ACCUMULATION DE FLUX,
 * la vraie méthode : (1) on comble les cuvettes du relief détaillé pour que tout
 * s'écoule vers le lac (priority-flood, Barnes 2014) ; (2) chaque tuile pointe
 * vers son voisin le plus bas ; (3) on accumule l'aire drainée en aval ; (4) on
 * grave les chenaux selon le flux — d'où une RIVIÈRE PRINCIPALE (le tronc, plus
 * gros flux) et des affluents qui MÉANDRENT le long du terrain réel (organique).
 * Les tarns épousent les vraies cuvettes hautes. Pur et déterministe (hash2, tri
 * à ordre total, arithmétique autorisée — pas de trigo).
 */
import { TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from './balance'
import { elevationAt, type WorldMap } from './map'
import { hash2 } from './noise'
import { isWater, type Paint, stampBlob, stampDisk, type ValleyPoint } from './valleygen-primitives'

const paintShallow: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? undefined : TERRAIN_SHALLOW_WATER)
const paintDeep: Paint = () => TERRAIN_DEEP_WATER

/** Constantes d'hydrologie — contenu de carte, réglées à la vignette. */
export const HYDRO = {
  LAKE_R_FRAC: 0.055,     // rayon du lac (fraction de min(W,H))
  ACC_STREAM: 0.0002,     // aire drainée min (fraction de N) → ruisseau franchissable
  ACC_RIVER: 0.0018,      // → rivière (cœur profond + berges)
  ACC_DEEP: 0.01,         // → tronc large (la rivière principale)
  RIVER_HW: 2,            // demi-largeur du cœur du tronc
  TARN_DENSITY: 0.00008,  // tarns par tuile intérieure
  TARN_MIN_FRAC: 0.4,     // altitude min d'un tarn
  TARN_MAX_FRAC: 0.68,    // altitude max d'un tarn
  TARN_R_FRAC: 0.014,     // rayon d'un tarn
}

const NX = [-1, 0, 1, -1, 1, -1, 0, 1]
const NY = [-1, -1, -1, 0, 0, 1, 1, 1]

/** La tuile intérieure au plus bas écoulement (loin du bord) — le bassin du lac. */
function lowestInterior(flow: number[], W: number, H: number, margin: number): ValleyPoint {
  let bx = margin, by = margin, be = 2
  for (let y = margin; y < H - margin; y++) {
    for (let x = margin; x < W - margin; x++) {
      const e = flow[y * W + x]!
      if (e < be) { be = e; bx = x; by = y }
    }
  }
  return { x: bx, y: by }
}

/** Le lac au point d'écoulement le plus bas : cœur profond, berges bruitées. */
function carveLake(map: WorldMap, flow: number[], seed: number): ValleyPoint {
  const D = Math.min(map.width, map.height)
  const margin = Math.max(3, Math.round(D * 0.05))
  const c = lowestInterior(flow, map.width, map.height, margin)
  const r = Math.max(4, Math.round(D * HYDRO.LAKE_R_FRAC))
  stampBlob(map, c.x, c.y, r + 2, paintShallow, (seed ^ 0x1ac1) | 0, 0.22)
  stampBlob(map, c.x, c.y, r, paintDeep, (seed ^ 0x1ac1) | 0, 0.22)
  return c
}

/**
 * Réseau hydrographique par accumulation de flux, sur le relief DÉTAILLÉ, drainé
 * vers le lac (sink). Comble les cuvettes, calcule les directions d'écoulement,
 * accumule l'aire drainée, puis grave selon le flux.
 */
function carveDrainage(map: WorldMap, seed: number, sinkX: number, sinkY: number): void {
  const W = map.width
  const H = map.height
  const N = W * H
  const el = map.elevation!
  const INF = 2

  // (1) Priority-flood depuis le lac : filled[c] = altitude relevée pour qu'un
  //     chemin descendant vers le lac existe partout (cuvettes comblées).
  const filled = new Array<number>(N).fill(INF)
  const heap = new Array<number>(N)
  let hn = 0
  const lower = (a: number, b: number): boolean =>
    filled[a]! < filled[b]! || (filled[a]! === filled[b]! && a < b)
  const swap = (i: number, j: number): void => { const t = heap[i]!; heap[i] = heap[j]!; heap[j] = t }
  const push = (i: number): void => {
    heap[hn] = i; let c = hn; hn++
    while (c > 0) { const p = (c - 1) >> 1; if (lower(heap[c]!, heap[p]!)) { swap(c, p); c = p } else break }
  }
  const pop = (): number => {
    const top = heap[0]!; hn--; heap[0] = heap[hn]!
    let c = 0
    for (;;) {
      const l = 2 * c + 1; const r = l + 1; let m = c
      if (l < hn && lower(heap[l]!, heap[m]!)) m = l
      if (r < hn && lower(heap[r]!, heap[m]!)) m = r
      if (m === c) break
      swap(c, m); c = m
    }
    return top
  }
  const sink = sinkY * W + sinkX
  filled[sink] = el[sink]!
  push(sink)
  while (hn > 0) {
    const c = pop()
    const cx = c % W; const cy = (c / W) | 0
    for (let d = 0; d < 8; d++) {
      const nx = cx + NX[d]!; const ny = cy + NY[d]!
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      if (filled[ni]! !== INF) continue
      filled[ni] = el[ni]! > filled[c]! ? el[ni]! : filled[c]!
      push(ni)
    }
  }

  // (2+3) Directions d'écoulement (steepest-descent sur filled) et accumulation,
  //       en traitant les tuiles de la plus haute à la plus basse.
  const order = new Array<number>(N)
  for (let i = 0; i < N; i++) order[i] = i
  order.sort((a, b) => (filled[b]! - filled[a]!) || (a - b))
  const accum = new Array<number>(N).fill(1)
  for (let k = 0; k < N; k++) {
    const c = order[k]!
    const cx = c % W; const cy = (c / W) | 0
    const fc = filled[c]!
    const dc = (cx - sinkX) * (cx - sinkX) + (cy - sinkY) * (cy - sinkY)
    // Voisin d'écoulement : jamais plus haut ; on préfère plus BAS, puis (à
    // égalité — fond plat comblé) plus PROCHE DU LAC, puis hash. Le critère
    // « proche du lac » fait qu'un fond plat draine vers le lac en un tronc
    // cohérent (la rivière principale) au lieu de s'étaler ; il décroît en
    // distance donc pas de cycle.
    let bi = -1; let be = 2; let bd = dc; let bt = -1
    for (let d = 0; d < 8; d++) {
      const nx = cx + NX[d]!; const ny = cy + NY[d]!
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      const e = filled[ni]!
      if (e > fc) continue // jamais vers le haut
      const nd = (nx - sinkX) * (nx - sinkX) + (ny - sinkY) * (ny - sinkY)
      if (e === fc && nd >= dc) continue // sur le plat, exiger un vrai rapprochement du lac
      const tie = hash2(nx, ny, seed)
      if (e < be || (e === be && nd < bd) || (e === be && nd === bd && tie > bt)) {
        be = e; bd = nd; bt = tie; bi = ni
      }
    }
    if (bi >= 0) accum[bi]! += accum[c]!
  }

  // (4) Gravure selon l'aire drainée : ruisseau → rivière → tronc large.
  const tStream = N * HYDRO.ACC_STREAM
  const tRiver = N * HYDRO.ACC_RIVER
  const tDeep = N * HYDRO.ACC_DEEP
  for (let i = 0; i < N; i++) {
    const a = accum[i]!
    if (a < tStream) continue
    const x = i % W; const y = (i / W) | 0
    if (a >= tRiver) {
      const hw = a >= tDeep ? HYDRO.RIVER_HW : 1
      stampDisk(map, x, y, hw + 1, paintShallow)
      stampDisk(map, x, y, hw, paintDeep)
    } else if (map.terrain[i] !== TERRAIN_DEEP_WATER) {
      map.terrain[i] = TERRAIN_SHALLOW_WATER // filet franchissable
    }
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
 *  `flow` = computeFlowField (macro lisse) pour situer le lac. */
export function carveHydrology(map: WorldMap, flow: number[], seed: number): void {
  const lake = carveLake(map, flow, seed)
  carveDrainage(map, seed, lake.x, lake.y)
  carveTarns(map, seed)
}
