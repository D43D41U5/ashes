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
import { fbm2, hash2 } from './noise'
import { isWater, type Paint, paintPolyline, type ValleyPoint } from './valleygen-primitives'

const paintShallow: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? undefined : TERRAIN_SHALLOW_WATER)
const paintDeep: Paint = () => TERRAIN_DEEP_WATER

/**
 * Plan d'eau à contour IRRÉGULIER — on DÉFORME la position d'échantillonnage par
 * un bruit basse fréquence (domain warping) avant le test de disque : le contour
 * gagne des lobes et de l'allongement au lieu de rester un rond (les vrais plans
 * d'eau ne sont jamais circulaires). Deux appels concentriques (même seed) →
 * cœur profond bien à l'intérieur de la berge. `warpAmp` = fraction du rayon.
 */
function stampWaterBody(
  map: WorldMap, cx: number, cy: number, rx: number, ry: number, paint: Paint, seed: number, warpAmp: number,
): void {
  const W = map.width
  const H = map.height
  const rmax = Math.max(rx, ry)
  const rr = Math.ceil(rmax * (1 + warpAmp)) + 1
  const scale = Math.max(3, rmax)
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
      const wx = dx + warpAmp * rmax * (fbm2(tx, ty, scale, seed) * 2 - 1)
      const wy = dy + warpAmp * rmax * (fbm2(tx, ty, scale, (seed ^ 0x9e3779b9) | 0) * 2 - 1)
      const ex = wx / rx // ellipse : rx ≠ ry → forme allongée (sans trigo)
      const ey = wy / ry
      if (ex * ex + ey * ey > 1) continue
      const next = paint(map.terrain[ty * W + tx] ?? 0)
      if (next !== undefined) map.terrain[ty * W + tx] = next
    }
  }
}

/** Constantes d'hydrologie — contenu de carte, réglées à la vignette. */
export const HYDRO = {
  LAKE_R_FRAC: 0.055,     // rayon du lac (fraction de min(W,H))
  RIVER_HW: 2,            // demi-largeur du cœur du tronc
  MAIN_AMP_FRAC: 0.05,    // amplitude de méandre du tronc central
  MAIN_SCALE_FRAC: 0.22,  // longueur d'onde du méandre du tronc
  MELT_DENSITY: 0.00015,  // sources de fonte par tuile intérieure (modéré)
  MELT_LO: 0.6,           // altitude min d'une source de fonte (limite des neiges basse)
  MELT_HI: 0.86,          // altitude max (sous le pic scellé)
  ABSORB_AT: 0.34,        // altitude à laquelle un ruisseau atteint le FOND et est
                          //  absorbé (meadow/marais) — l'empêche de traverser le
                          //  fond plat vers un lac lointain (mirroir de BANDS.FLOOR)
  POOL_R_FRAC: 0.013,     // rayon d'une mare de fonte au pied de pente (fond de vallée)
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
  let bx = margin, by = margin, be = -2
  for (let y = margin; y < H - margin; y++) {
    for (let x = margin; x < W - margin; x++) {
      const e = flow[y * W + x]!
      if (e > be) { be = e; bx = x; by = y } // le plus haut de l'intérieur (marge exclut déjà les pics)
    }
  }
  return { x: bx, y: by }
}

/**
 * Place 1 à 4 lacs (nombre aléatoire selon la seed) dans les bassins d'écoulement
 * les plus bas, ESPACÉS, chacun de taille et de FORME diverses (ellipse allongée
 * + domain-warp → ronds, oblongs, lobés). Renvoie le lac PRINCIPAL (le plus bas,
 * exutoire de la rivière et du drainage).
 */
function carveLakes(map: WorldMap, flow: number[], seed: number): ValleyPoint {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(3, Math.round(D * 0.05))
  const count = 1 + Math.floor(hash2(seed, 0x3c1a, 0x9) * 3.999) // 1..4
  const excludeR = Math.round(D * 0.14)
  const base = D * HYDRO.LAKE_R_FRAC
  const placed: ValleyPoint[] = []
  for (let i = 0; i < count; i++) {
    // Le point le plus bas pas déjà proche d'un lac placé.
    let bx = -1, by = -1, be = 1e9
    for (let y = margin; y < H - margin; y++) {
      for (let x = margin; x < W - margin; x++) {
        const e = flow[y * W + x]!
        if (e >= be) continue
        let ok = true
        for (const p of placed) {
          const ddx = x - p.x; const ddy = y - p.y
          if (ddx * ddx + ddy * ddy < excludeR * excludeR) { ok = false; break }
        }
        if (ok) { be = e; bx = x; by = y }
      }
    }
    if (bx < 0) break
    const ks = (seed ^ (i * 0x51ed)) | 0
    const size = 0.5 + hash2(ks, 1, 0x11) * 1.3          // 0.5×..1.8×
    const aspect = 0.65 + hash2(ks, 2, 0x22) * 0.85      // 0.65..1.5 (allongement)
    const warpAmp = 0.4 + hash2(ks, 3, 0x33) * 0.35      // 0.4..0.75 (irrégularité)
    const r = Math.max(4, Math.round(base * size))
    const rx = Math.max(3, Math.round(r * aspect))
    const ry = Math.max(3, Math.round(r / aspect))
    stampWaterBody(map, bx, by, rx + 2, ry + 2, paintShallow, ks, warpAmp)
    stampWaterBody(map, bx, by, rx, ry, paintDeep, ks, warpAmp)
    placed.push({ x: bx, y: by })
  }
  return placed[0] ?? lowestInterior(flow, W, H, margin)
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
function carveIceStreams(
  map: WorldMap, dir: number[], seed: number,
): Array<{ source: ValleyPoint; outlet: ValleyPoint }> {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(3, Math.round(D * 0.05))
  const interior = (W - 2 * margin) * (H - 2 * margin)
  const count = Math.round(HYDRO.MELT_DENSITY * interior)
  const maxSteps = W + H
  const streams: Array<{ source: ValleyPoint; outlet: ValleyPoint }> = []
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
    let poolX = -1
    let poolY = -1
    let lastX = -1
    let lastY = -1
    while (c >= 0 && steps < maxSteps) {
      const t = map.terrain[c]!
      if (t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER) break // se jette dans l'eau → toile
      if (t === TERRAIN_MARSH) break // absorbé par le marais
      const cx = c % W; const cy = (c / W) | 0
      if (elevationAt(map, cx, cy) < HYDRO.ABSORB_AT) { poolX = cx; poolY = cy; break } // atteint le fond → forme une mare
      map.terrain[c] = TERRAIN_SHALLOW_WATER // filet de fonte franchissable
      lastX = cx; lastY = cy // dernière tuile d'eau posée = exutoire du ruisseau
      const next = dir[c]!
      if (next >= 0) {
        // Pas vers l'aval diagonal ? les deux tuiles ne se touchent que par le
        // coin → le filet paraît « cassé ». On pose une tuile-pont orthogonale
        // (la plus basse des deux : l'eau va vers le bas), ce qui rend le
        // ruisseau 4-connexe sans l'épaissir sur les segments droits.
        const nx = next % W; const ny = (next / W) | 0
        const ddx = nx - cx; const ddy = ny - cy
        if (ddx !== 0 && ddy !== 0) {
          const ea = elevationAt(map, nx, cy) // candidate horizontale
          const eb = elevationAt(map, cx, ny) // candidate verticale
          const useH = ea < eb || (ea === eb && hash2(cx, cy, 0x6d) < 0.5)
          const pi = useH ? cy * W + nx : ny * W + cx
          const pt = map.terrain[pi]
          if (pt !== TERRAIN_DEEP_WATER && pt !== TERRAIN_SHALLOW_WATER && pt !== TERRAIN_MARSH) {
            map.terrain[pi] = TERRAIN_SHALLOW_WATER
          }
        }
      }
      c = next
      steps++
    }
    if (lastX >= 0) streams.push({ source: { x: sx, y: sy }, outlet: { x: lastX, y: lastY } })
    if (poolX >= 0) {
      // Mare de fonte au pied de la pente : le ruisseau finit dans un vrai point
      // d'eau, et le fond de vallée se pique de mares (au lieu d'être sec).
      const pr = Math.max(2, Math.round(D * HYDRO.POOL_R_FRAC))
      stampWaterBody(map, poolX, poolY, pr + 1, pr + 1, paintShallow, (seed ^ (k * 71)) | 0, 0.5)
      if (pr >= 3) stampWaterBody(map, poolX, poolY, pr, pr, paintDeep, (seed ^ (k * 71)) | 0, 0.5)
    }
  }
  return streams
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
    stampWaterBody(map, x, y, r + 1, r + 1, paintShallow, (seed ^ (k * 53)) | 0, 0.5)
    stampWaterBody(map, x, y, r, r, paintDeep, (seed ^ (k * 53)) | 0, 0.5)
    placed += 1
  }
}

/**
 * Fusionne les plans d'eau TRÈS PROCHES : fermeture morphologique du masque d'eau
 * (dilatation de rayon R puis érosion de rayon R). Ne comble que les petits
 * interstices (≤ 2R tuiles) entre deux eaux voisines — deux mares côte à côte
 * deviennent un seul plan d'eau, les fins liserés de terre disparaissent — sans
 * jamais rétrécir une vraie eau ni relier des eaux éloignées. Le comblement est
 * peu profond (un col d'eau franchissable entre les deux). Pur, déterministe.
 */
function mergeNearbyWater(map: WorldMap, r: number): void {
  const W = map.width
  const H = map.height
  const N = W * H
  const isW = (i: number): boolean => {
    const t = map.terrain[i]
    return t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER
  }
  // Dilatation : marque toute tuile à ≤ r (Chebyshev) d'une eau.
  const dil = new Uint8Array(N)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let any = 0
      for (let dy = -r; dy <= r && any === 0; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          if (isW(ny * W + nx)) { any = 1; break }
        }
      }
      dil[y * W + x] = any
    }
  }
  // Érosion de la dilatation → « fermeture » ; les tuiles de terre entièrement
  // enveloppées par la dilatation (donc dans un interstice ≤ 2r) sont comblées.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (isW(i)) continue
      let all = 1
      for (let dy = -r; dy <= r && all === 1; dy++) {
        const ny = y + dy
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || dil[ny * W + nx] === 0) { all = 0; break }
        }
      }
      if (all === 1) map.terrain[i] = TERRAIN_SHALLOW_WATER
    }
  }
}

/** Grave tout le réseau d'eau dans une carte alpine (après les bandes de terrain).
 *  `flow` = computeFlowField (macro lisse) pour situer lac & tête de vallée. */
export function carveHydrology(
  map: WorldMap, flow: number[], seed: number,
): Array<{ source: ValleyPoint; outlet: ValleyPoint }> {
  const lake = carveLakes(map, flow, seed)               // 1..4 lacs, formes diverses ; principal renvoyé
  carveMainRiver(map, flow, seed, lake)                  // le tronc (les affluents s'y jettent)
  const dir = computeDrainageDir(map, seed, lake.x, lake.y)
  const streams = carveIceStreams(map, dir, seed)        // ruisseaux de fonte → rivière/lac/marais
  carveTarns(map, seed)
  mergeNearbyWater(map, 2)                               // fusionne les plans d'eau très proches
  return streams                                         // (source, exutoire) par ruisseau — pour tests de continuité
}
