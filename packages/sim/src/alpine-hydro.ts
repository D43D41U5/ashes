/**
 * L'hydrologie alpine (SP1b) — modèle : l'eau vient surtout de la FONTE DE LA
 * GLACE en altitude, dévale, et se jette toujours dans quelque chose (la rivière
 * principale, le lac, ou est absorbée par le marais) — jamais « dans le vide ».
 * Elle converge en TOILE (les ruisseaux fusionnent en descendant).
 *
 * Mise en œuvre pure & déterministe :
 *  - lac au point d'écoulement le plus bas ;
 *  - tronc central méandré (tête de vallée → lac), tracé explicitement ;
 *  - arbre de drainage vers le lac (priority-flood, Barnes 2014) → chaque tuile
 *    connaît sa tuile aval, sans cycle ;
 *  - ruisseaux de fonte : sources en HAUTE altitude (limite des neiges), tracés
 *    en aval sur l'arbre jusqu'au premier corps d'eau OU marais (→ ils fusionnent
 *    en toile et se terminent toujours quelque part) ;
 *  - tarns dans les vraies cuvettes hautes.
 * hash2 pour l'échantillonnage/départage ; arithmétique autorisée, pas de trigo.
 */
import { TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_SHALLOW_WATER } from './balance'
import { elevationAt, type WorldMap } from './map'
import { hash2 } from './noise'
import { isWater, type Paint, paintPolyline, stampBlob, type ValleyPoint } from './valleygen-primitives'

const paintShallow: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? undefined : TERRAIN_SHALLOW_WATER)
const paintDeep: Paint = () => TERRAIN_DEEP_WATER

/** Constantes d'hydrologie — contenu de carte, réglées à la vignette. */
export const HYDRO = {
  LAKE_R_FRAC: 0.055,     // rayon du lac (fraction de min(W,H))
  RIVER_HW: 2,            // demi-largeur du cœur du tronc
  MAIN_AMP_FRAC: 0.05,    // amplitude de méandre du tronc central
  MAIN_SCALE_FRAC: 0.22,  // longueur d'onde du méandre du tronc
  MELT_DENSITY: 0.00015,  // sources de fonte par tuile intérieure (modéré)
  MELT_LO: 0.6,           // altitude min d'une source de fonte (limite des neiges basse)
  MELT_HI: 0.86,          // altitude max (sous le pic scellé)
  TARN_DENSITY: 0.00007,  // tarns par tuile intérieure
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

/** Le point d'écoulement le plus HAUT à l'intérieur (pas le pic scellé) — la tête de vallée. */
function highestInterior(flow: number[], W: number, H: number, margin: number): ValleyPoint {
  let bx = margin, by = margin, be = -1
  for (let y = margin; y < H - margin; y++) {
    for (let x = margin; x < W - margin; x++) {
      const e = flow[y * W + x]!
      if (e > be && e < 0.85) { be = e; bx = x; by = y }
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

/** Le tronc central méandré, tête de vallée → lac (le fond est trop plat pour
 *  qu'un fleuve s'y creuse par accumulation ; on le pose procéduralement). */
function carveMainRiver(map: WorldMap, flow: number[], seed: number, lake: ValleyPoint): void {
  const D = Math.min(map.width, map.height)
  const margin = Math.max(3, Math.round(D * 0.08))
  const src = highestInterior(flow, map.width, map.height, margin)
  const hw = HYDRO.RIVER_HW
  const meander = {
    amp: Math.max(2, Math.round(D * HYDRO.MAIN_AMP_FRAC)),
    scale: Math.max(8, Math.round(D * HYDRO.MAIN_SCALE_FRAC)),
    seed: (seed ^ 0x51ec) | 0,
  }
  const pts: ValleyPoint[] = [src, { x: lake.x, y: lake.y }]
  paintPolyline(map, pts, hw + 1, paintShallow, meander)
  paintPolyline(map, pts, hw, paintDeep, meander)
}

/**
 * Arbre de drainage vers le lac par priority-flood : comble les cuvettes du
 * relief et, ce faisant, donne à chaque tuile sa tuile AVAL (`dir`, l'index du
 * voisin par lequel elle a été « inondée » = un pas vers le lac). Suivre `dir`
 * mène toujours au lac, sans cycle (c'est un arbre).
 */
function computeDrainageDir(map: WorldMap, seed: number, sinkX: number, sinkY: number): number[] {
  const W = map.width
  const H = map.height
  const N = W * H
  const el = map.elevation!
  const INF = 2
  const filled = new Array<number>(N).fill(INF)
  const dir = new Array<number>(N).fill(-1)
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
      dir[ni] = c // aval = la tuile par laquelle on a été inondé (vers le lac)
      push(ni)
    }
  }
  return dir
}

/**
 * Ruisseaux de FONTE : sources en haute altitude (limite des neiges), chacune
 * tracée en aval sur l'arbre de drainage jusqu'au premier corps d'eau (rivière,
 * lac, ou un autre ruisseau déjà tracé → fusion en TOILE) ou jusqu'au marais qui
 * l'absorbe. Ils partent donc de la glace et se jettent toujours quelque part.
 */
function carveIceStreams(map: WorldMap, dir: number[], seed: number): void {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(3, Math.round(D * 0.05))
  const interior = (W - 2 * margin) * (H - 2 * margin)
  const count = Math.round(HYDRO.MELT_DENSITY * interior)
  const maxSteps = W + H
  for (let k = 0; k < count; k++) {
    // Source de fonte : la plus haute parmi quelques candidats, dans la tranche
    // d'altitude de la limite des neiges (au-dessus de la forêt, sous le pic).
    let sx = -1; let sy = -1; let se = -1
    for (let s = 0; s < 10; s++) {
      const x = margin + Math.floor(hash2(k * 149 + s, seed, 0x2b7) * (W - 2 * margin))
      const y = margin + Math.floor(hash2(seed, k * 149 + s, 0x4e9) * (H - 2 * margin))
      const e = elevationAt(map, x, y)
      if (e >= HYDRO.MELT_LO && e <= HYDRO.MELT_HI && e > se) { se = e; sx = x; sy = y }
    }
    if (sx < 0) continue
    let c = sy * W + sx
    let steps = 0
    while (c >= 0 && steps < maxSteps) {
      const t = map.terrain[c]!
      if (t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER) break // se jette dans l'eau → toile
      if (t === TERRAIN_MARSH) break // absorbé par le marais
      map.terrain[c] = TERRAIN_SHALLOW_WATER // filet de fonte franchissable
      c = dir[c]!
      steps++
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
 *  `flow` = computeFlowField (macro lisse) pour situer lac & tête de vallée. */
export function carveHydrology(map: WorldMap, flow: number[], seed: number): void {
  const lake = carveLake(map, flow, seed)
  carveMainRiver(map, flow, seed, lake)                  // le tronc (les affluents s'y jettent)
  const dir = computeDrainageDir(map, seed, lake.x, lake.y)
  carveIceStreams(map, dir, seed)                        // ruisseaux de fonte → rivière/lac/marais
  carveTarns(map, seed)
}
